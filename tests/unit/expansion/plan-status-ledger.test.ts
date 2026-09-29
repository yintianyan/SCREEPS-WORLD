/**
 * B5-㉒ 扩张计划状态账：EXECUTING 是"在途"，不是"删除"。
 *
 * 起因：`updatePlanStatus(planId, status: string)` 收自由字符串，于是
 * plan-adapter 的硬失败分支写着 "EXECUTING" 而注释说 CANCELLED；而
 * ACTIVE_STATUSES 里根本没有 EXECUTING，`prunePlans` 的判据是"非 Active 且已过
 * 冷却即删"，expansion-planner 每周期把裁剪结果写回 Memory —— 任何被标成
 * EXECUTING 的计划都会在下一个 planner 周期连账一起消失。
 *
 * 于是三条后果（都是原来就在跑的）：
 * - 硬失败的计划没有进 CANCELLED → rebuildCooldown 从未生效 → 同一个不可 claim 的
 *   目标被逐周期重新立项；
 * - state-machine 的三处 COMPLETED / 一处 CANCELLED 都按 planId 找记录回写，
 *   记录已不在 → 全部空写；
 * - `deduplicatePlans` 的"同房不得有两个在途计划"看不见正在执行的那条。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  deduplicatePlans,
  isRebuildBlocked,
  prunePlans,
  DEFAULT_LIFECYCLE_OPTIONS,
} from "../../../src/domain/expansion/plan-lifecycle";
import type { ExpansionPlan, PlanStatus } from "../../../src/domain/expansion/plan";
import {
  tryConsumePlan,
  updatePlanStatus,
} from "../../../src/systems/empire/expansion/plan-adapter";
import { mockRoomStateCtx, resetGlobals } from "../../support/factories";
import { CONFIG } from "../../../src/config";

const TICK = 5000;
const ROOM = "W0N1";
const TARGET = "W1N1";

/**
 * prunePlans / deduplicatePlans / isRebuildBlocked 这三个纯函数只读
 * planId / roomName / status / updatedAt 四个字段，其余分支不碰。
 */
function planWith(roomName: string, status: PlanStatus, updatedAt: number): ExpansionPlan {
  return { planId: `${roomName}#${updatedAt}`, roomName, status, updatedAt } as ExpansionPlan;
}

function memoryPlan(st: PlanStatus, roomName = TARGET): any {
  return {
    pid: `${roomName}#${TICK}`,
    rn: roomName,
    sr: ROOM,
    rs: "resource",
    pr: "P1",
    sc: 70,
    tc: 5000,
    pb: 1000,
    roi: 2,
    rk: 20,
    rl: "LOW",
    st,
    ca: TICK - 100,
    ua: TICK - 100,
    aa: TICK - 50,
    ex: "",
  };
}

function setup(memoryPlans: unknown[]): void {
  resetGlobals();
  const G = globalThis as any;
  G.Game.time = TICK;
  // 主房在视野内（storage 决定扩张预算：availableExpansion = 自有房储能 × 0.3，
  // 20000 → 6000 ≥ 计划成本 5000，预算门才不让路）；目标房**不在**（无 controller
  // 可 claim）→ GATE_TARGET_CLAIMABLE 硬失败。
  G.Game.rooms = {
    [ROOM]: {
      controller: { my: true, owner: { username: "Me" } },
      storage: { store: { [RESOURCE_ENERGY]: 20000 } },
    },
  };
  G.Memory.rooms = { [ROOM]: { spawnQueue: [], buildQueue: [] } };
  G.Memory.kernel = {
    strategy: { posture: "expand", expansionAllowed: true },
    expansionPlans: memoryPlans,
  };
  // setup() 只把主房放进视野，目标房缺席 —— 那正是"看不见"而不是"不能 claim"。
  // 想测真正的不可 claim（有视野、controller 已有主），用 blockedTarget()。
}

beforeEach(() => {
  resetGlobals();
});

describe("B5-㉒ EXECUTING 算在途", () => {
  it("EXECUTING 的计划活过 prunePlans（任何时长都活）", () => {
    const executing = planWith(TARGET, "EXECUTING", 0);
    const wayOld = TICK - 10 * DEFAULT_LIFECYCLE_OPTIONS.rebuildCooldown;
    expect(prunePlans([planWith(TARGET, "EXECUTING", wayOld)], TICK)).toHaveLength(1);
    expect(prunePlans([executing], TICK)).toHaveLength(1);
  });

  it("终态照旧受冷却约束：CANCELLED 冷却内留、冷却外删；EXECUTING 不算终态", () => {
    const cool = DEFAULT_LIFECYCLE_OPTIONS.rebuildCooldown;
    const plans = [
      planWith("W2N2", "CANCELLED", TICK - cool + 1),
      planWith("W3N3", "CANCELLED", TICK - cool - 1),
      planWith("W4N4", "BLACKLISTED", TICK - cool - 1),
      planWith("W5N5", "COMPLETED", TICK - cool - 1),
    ];
    const kept = prunePlans(plans, TICK).map(p => p.roomName);
    expect(kept).toEqual(["W2N2"]);
  });

  it("正在执行的目标不会被重复立项（同房在途互斥含 EXECUTING）", () => {
    const inFlight = planWith(TARGET, "EXECUTING", TICK - 10);
    const fresh = planWith(TARGET, "READY", TICK);
    const result = deduplicatePlans([inFlight], fresh);
    expect(result.deduplicated).toBe(true);
    expect(result.plans).toHaveLength(1);
  });

  it("同一 planId 不允许记成两条：CANCELLED 孪生还在冷却期也不给重复身份留位置", () => {
    // planId = roomName + discoveredAt；候选的 discoveredAt 会活过一轮取消，
    // 于是同房重新立项会拿到同一个 id。终态回写按 planId 找第一条 —— 两条同 id 时
    // COMPLETED 会写进那条早已终态的孪生记录，真在执行的那条永远停在 EXECUTING，
    // 而同房互斥又把这间房永久挡死。
    const twin = planWith(TARGET, "CANCELLED", TICK - 100);
    const reborn = planWith(TARGET, "READY", TICK - 100);
    const result = deduplicatePlans([twin], reborn);

    expect(result.deduplicated).toBe(true);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.status).toBe("CANCELLED");
  });

  it("但「正在执行」不等于「刚失败」：EXECUTING 不进重建冷却", () => {
    // 界线要钉住：修上一条时若把 EXECUTING 塞进 isRebuildBlocked 的判据，
    // 一次成功的扩张就会把那片房锁 10000 tick。
    const plans = [planWith(TARGET, "EXECUTING", TICK)];
    expect(isRebuildBlocked(plans, TARGET, TICK)).toBe(false);
    expect(isRebuildBlocked([planWith(TARGET, "CANCELLED", TICK)], TARGET, TICK)).toBe(true);
  });
});

describe("B5-㉒ 硬失败必须落到 CANCELLED 并真的进冷却", () => {
  it("有视野且 controller 已有主（真不可 claim）→ 计划记 CANCELLED 而非 EXECUTING", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);
    // 看得见却被别人占着：这才是 GATE_TARGET_CLAIMABLE 要拦的那种事实。
    (globalThis as any).Game.rooms[TARGET] = {
      controller: { owner: { username: "someone-else" }, my: false },
    };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    const plans = (globalThis as any).Memory.kernel.expansionPlans;
    expect(plans[0].st).toBe("CANCELLED");
    expect(plans[0].ua).toBe(TICK);
    // 而且它现在会被 lifecycle 当作终态保留并在 10000t 内挡住重建。
    expect(
      isRebuildBlocked(
        plans.map((m: any) => planWith(m.rn, m.st as PlanStatus, m.ua)),
        TARGET,
        TICK,
      ),
    ).toBe(true);
  });

  it("目标房看不见 ≠ 不可 claim：不消费，也绝不取消计划", () => {
    // 回归钉：setup() 里目标房不在视野。旧实现在这里判 GATE_TARGET_CLAIMABLE 硬失败
    // → CANCELLED + 10k tick 重建冷却，等于让"信息缺失"否决掉一次合法扩张。
    setup([memoryPlan("WAITING_EXECUTION")]);
    const G = globalThis as any;
    G.Game.gcl = { level: 3 };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    expect(G.Memory.kernel.expansionPlans[0].st).toBe("WAITING_EXECUTION");
    expect(G.Memory.kernel.expansion).toBeUndefined();
  });

  it("成功接管 → 标 EXECUTING 的计划仍在账上，终态回写找得到它", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);
    // 目标房可见且 controller 无主 → claimable 通过；GCL 余量不足（owned=1, gcl=1）会在
    // 标记 EXECUTING 之前 return，因此这里显式给足 GCL。
    const G = globalThis as any;
    G.Game.rooms[TARGET] = { controller: {} };
    G.Game.gcl = { level: 3 };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    const plan = G.Memory.kernel.expansionPlans[0];
    expect(plan.st).toBe("EXECUTING");
    // 之后的终态按 planId 回写 —— 前提是这条记录还在（原行为会被 prune 抹掉）。
    updatePlanStatus(plan.pid, "COMPLETED");
    expect(G.Memory.kernel.expansionPlans[0].st).toBe("COMPLETED");
    const asPlans = G.Memory.kernel.expansionPlans.map((m: any) =>
      planWith(m.rn, m.st as PlanStatus, m.ua),
    );
    expect(prunePlans(asPlans, TICK)).toHaveLength(1);
  });

  it("updatePlanStatus：未知 planId / 空 planId 都是空写，不新建记录", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);
    const before = (globalThis as any).Memory.kernel.expansionPlans.length;

    updatePlanStatus("", "CANCELLED");
    updatePlanStatus("no-such-plan", "CANCELLED");

    const plans = (globalThis as any).Memory.kernel.expansionPlans;
    expect(plans).toHaveLength(before);
    expect(plans[0].st).toBe("WAITING_EXECUTION");
  });
});

/**
 * 执行期的复检：入口判过的否决，出口必须再判一次。
 *
 * 起因（2026-09-28 读代码，扩张链摸排）：重占排除与失败黑名单都只作用在**候选池**，
 * 而 Plan 另有一份持久化列表；消费这一侧把 candidateValid 写死成 `true`，于是
 * "门一开就把我们主动放弃过的房再 claim 一次"是通得过的 —— 释放后的房没有 owner
 * 也没有 reservation，GATE_TARGET_CLAIMABLE 拦不住它。
 */
describe("B5-㉓ 消费期的重占/黑名单复检", () => {
  /** 目标房可见、controller 无主 ⇒ 唯一还能拦住它的就是复检表。 */
  function claimableTarget(): any {
    const G = globalThis as any;
    G.Game.rooms[TARGET] = { controller: {} };
    G.Game.gcl = { level: 3 };
    return G;
  }

  it("房在立项之后才被放弃 → 拒绝并记 CANCELLED，绝不把它 claim 回来", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);
    const G = claimableTarget();
    G.Memory.kernel.releasedRooms = { [TARGET]: TICK - 1000 };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    expect(G.Memory.kernel.expansionPlans[0].st).toBe("CANCELLED");
    expect(G.Memory.kernel.expansion).toBeUndefined();
  });

  it("排除期已过 → 复检放行（这条判据不能变成永久否决）", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);
    const G = claimableTarget();
    G.Memory.kernel.releasedRooms = {
      [TARGET]: TICK - CONFIG.territory.releasedExclusionTicks - 1,
    };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    expect(G.Memory.kernel.expansionPlans[0].st).toBe("EXECUTING");
    expect(G.Memory.kernel.expansion).toBeDefined();
  });

  it("目标在失败黑名单冷却里 → 消费期同样拦住", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);
    const G = claimableTarget();
    G.Memory.kernel.expansionBlacklist = { [TARGET]: TICK + 1000 };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    expect(G.Memory.kernel.expansionPlans[0].st).toBe("CANCELLED");
    expect(G.Memory.kernel.expansion).toBeUndefined();
  });
});

/**
 * 队首阻塞（2026-09-29 16:54 线上实测立案）。
 *
 * `tryConsumePlan` 用 `plans.find(p => p.st === "WAITING_EXECUTION")` 取**第一条**，
 * 而那一条正好撞上"目标房看不见就整轮 return"的短路。线上当时 5 条 WAITING_EXECUTION：
 * 队首 W37S56 无视野，而 W38S56 / W38S58 **就在视野里且 controller 无人无预约**
 * （可 claim），W36S58 / W37S57 被自己的 reserver 挡着。于是 G0–G7 全绿、扩张预算 33 万、
 * GCL 5 > 实拥 1、黑名单空 —— 却没有一次 claim 开始。
 *
 * 上面那条"看不见 ≠ 不可 claim"的修复只解决了"别取消"，没解决"别挡住后面那条"。
 */
describe("队首不可见的计划不得钉住整条扩张管道", () => {
  /** 看得见且 controller 无主无预约 ⇒ 唯一可 claim 的形态。 */
  function makeClaimable(roomName: string): void {
    (globalThis as any).Game.rooms[roomName] = { controller: {} };
  }

  it("按序试跑：跳过看不见的队首，消费第二条可 claim 的计划", () => {
    setup([memoryPlan("WAITING_EXECUTION", "W1N1"), memoryPlan("WAITING_EXECUTION", "W2N2")]);
    const G = globalThis as any;
    G.Game.gcl = { level: 3 };
    makeClaimable("W2N2"); // W1N1 依旧不在视野里

    tryConsumePlan(mockRoomStateCtx([], TICK));

    expect(G.Memory.kernel.expansion?.target).toBe("W2N2");
    expect(G.Memory.kernel.expansionPlans[1].st).toBe("EXECUTING");
    // 队首只是本轮缺信息，绝不顺手取消它。
    expect(G.Memory.kernel.expansionPlans[0].st).toBe("WAITING_EXECUTION");
  });

  it("全部看不见 ⇒ 一条都不消费、一条都不取消（跳过不是否决）", () => {
    setup([memoryPlan("WAITING_EXECUTION", "W1N1"), memoryPlan("WAITING_EXECUTION", "W2N2")]);
    const G = globalThis as any;
    G.Game.gcl = { level: 3 };

    tryConsumePlan(mockRoomStateCtx([], TICK));

    expect(G.Memory.kernel.expansion).toBeUndefined();
    expect(G.Memory.kernel.expansionPlans.map((p: any) => p.st)).toEqual([
      "WAITING_EXECUTION",
      "WAITING_EXECUTION",
    ]);
  });

  it("GCL 满员仍然一条都不消费（这条检查与是哪条计划无关，已提到循环外）", () => {
    setup([memoryPlan("WAITING_EXECUTION", "W1N1"), memoryPlan("WAITING_EXECUTION", "W2N2")]);
    const G = globalThis as any;
    G.Game.gcl = { level: 1 };
    makeClaimable("W2N2");
    // 实拥 1 房 + GCL 1 ⇒ 无余量。
    const owned = [{ roomName: ROOM, controller: { my: true } }] as any[];

    tryConsumePlan(mockRoomStateCtx(owned, TICK));

    expect(G.Memory.kernel.expansion).toBeUndefined();
    expect(G.Memory.kernel.expansionPlans.map((p: any) => p.st)).toEqual([
      "WAITING_EXECUTION",
      "WAITING_EXECUTION",
    ]);
  });
});
