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

  it("但「正在执行」不等于「刚失败」：EXECUTING 不进重建冷却", () => {
    // 界线要钉住：修上一条时若把 EXECUTING 塞进 isRebuildBlocked 的判据，
    // 一次成功的扩张就会把那片房锁 10000 tick。
    const plans = [planWith(TARGET, "EXECUTING", TICK)];
    expect(isRebuildBlocked(plans, TARGET, TICK)).toBe(false);
    expect(isRebuildBlocked([planWith(TARGET, "CANCELLED", TICK)], TARGET, TICK)).toBe(true);
  });
});

describe("B5-㉒ 硬失败必须落到 CANCELLED 并真的进冷却", () => {
  it("目标不可 claim（GATE_TARGET_CLAIMABLE）→ 计划被记成 CANCELLED 而非 EXECUTING", () => {
    setup([memoryPlan("WAITING_EXECUTION")]);

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
