/**
 * 恢复动作链的端到端证明：FailureNode → prioritizeRecovery → recovery-execution → 孵化请求落地。
 *
 * 为什么要这条测试：#57 要把「发展停摆」接进失败图，而接线之前必须先证明
 * **被接的那条管道真的会执行** —— 现状是 `population_rebuild` 一类的动作只有 unit 层覆盖
 * （abort-recovery / a4-6-recovery-lifecycle / recovery-record-room-source）与一条执行序守卫
 * （execution-order.test.ts:36），没有任何测试跑过真实 kernel 走完 失败→动作→提交→追踪 四步。
 *
 * 症状从哪来（诚实声明）：这里用 `roomMem.phase = recovery` 触发既有迟滞带
 * （phase.ts:521 `inCrisisBand && (crisisScore > recoveryClearScore || !dwellSatisfied)`，
 * minBandTicks=100 ⇒ 带子至少撑 100 拍评估）。**注入的是症状，被测的是响应链**：
 * empire-health 的采样、失败图、优先级、预算、幂等、translateAndSubmit、actionTable 全走真实代码。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ScenarioBuilder, TickRunner } from "../framework";
import type { TestWorld } from "../framework";
import { globalCache } from "../../../src/kernel/global-cache";
import { E5_STALE_TICKS } from "../../../src/kernel/expectations";

let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

const g = () => globalThis as any;
const heap = () => globalCache() as any;

interface ActionLite {
  type: string;
  domain: string;
  room?: string;
  targetFailureId?: string;
  description?: string;
}
interface QueueItemLite {
  key?: string;
  role?: string;
  memory?: { recoveryCorrelationId?: string };
}
interface RecordLite {
  state: string;
}

function buildRoom(): TestWorld {
  return new ScenarioBuilder("W1N1")
    .rcl(3, 12345)
    .flat()
    .spawn("Spawn1", 25, 25)
    .controllerAt(30, 35)
    .source("s1", 15, 15)
    .source("s2", 35, 15)
    .sourceRegen(10)
    .containerDecay(0)
    .cpu(10000)
    .preseedRoomState()
    .build();
}

/** 把相位状态机放进危机带（recovery），bandTicks=0 ⇒ 按 minBandTicks=100 至少驻留 100 拍。 */
function seedRecoveryBand(world: TestWorld): void {
  const roomMem = g().Memory.rooms.W1N1;
  roomMem.controllerProgressSeen = world.controller?.progress ?? 0;
  roomMem.controllerProgressChangedAt = g().Game.time;
  roomMem.phase = {
    phase: "recovery",
    reserve: roomMem.phase?.reserve ?? 2000,
    storageEnergyPrev: roomMem.phase?.storageEnergyPrev ?? 0,
    drainScore: 0,
    liquidityScore: 0,
    liquidityTrapTicks: 0,
    bandTicks: 0,
    srcStallTicks: 0,
    bootstrapTicks: 0,
  };
}

describe("恢复动作链 — 失败→优先级→执行→追踪", () => {
  it("recovery 带内的房 → population_rebuild 动作 → 提交成带 recoveryCorrelationId 的孵化请求", () => {
    const world = buildRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    const actionTypes: string[] = [];
    const roomScopedColonyActions: string[] = [];
    const states: string[] = [];
    let submittedCorrelationId: string | undefined;
    let recoveryTicks = 0;

    runner.run(world, 240, {
      onTick: (w, t) => {
        if (t === 1) seedRecoveryBand(w);

        if (g().Memory.rooms.W1N1?.colonyState === "recovery") recoveryTicks++;

        const acts: ActionLite[] = heap().recoveryActions ?? [];
        for (const a of acts) {
          if (!actionTypes.includes(a.type)) actionTypes.push(a.type);
          // 房级 colony 节点（colonyState=recovery 才有）与 colony 维度节点（人口/健康度）
          // 是两个生产者；#57 要接的是前者，故按 targetFailureId 的形状区分来源。
          if (a.targetFailureId?.startsWith("failure:colony:W1N1:")) {
            if (!roomScopedColonyActions.includes(a.type)) roomScopedColonyActions.push(a.type);
          }
        }

        const queue: QueueItemLite[] = g().Memory.rooms.W1N1?.spawnQueue ?? [];
        for (const item of queue) {
          const corr = item.memory?.recoveryCorrelationId;
          if (corr) submittedCorrelationId = corr;
        }

        const table: Map<string, RecordLite> | undefined = heap().recoveryActionTable;
        if (table) {
          for (const rec of table.values()) {
            if (!states.includes(rec.state)) states.push(rec.state);
          }
        }
      },
    });

    const roomMem = g().Memory.rooms.W1N1;
    const diag =
      `动作集=${JSON.stringify(actionTypes)} 房级colony动作=${JSON.stringify(roomScopedColonyActions)} ` +
      `记录状态=${JSON.stringify(states)} recoveryTicks=${recoveryTicks} ` +
      `colonyState=${roomMem?.colonyState} phase=${roomMem?.phase?.phase}`;

    // ① 注入的症状确实进了失败图，并**按房**产出动作
    //    （colony 维度那条路只给 `failure:colony:<tick>`，不带房名；带房名的才是 recovery 带节点）。
    expect(
      roomScopedColonyActions,
      `recovery 带应产出房级 colony 动作（#57 要接的就是这条路）；${diag}`,
    ).toContain("population_rebuild");

    // ② 动作被执行层翻译成孵化请求 —— 这才是"响应真的发生"。
    expect(
      submittedCorrelationId,
      `孵化队列应出现带 recoveryCorrelationId 的请求；${diag}`,
    ).toEqual(expect.any(String));

    // ③ 生命周期表留下了追踪记录（提交→执行→验收的凭据）。
    expect(states.length, `recoveryActionTable 应留下记录；${diag}`).toBeGreaterThan(0);
  });

  it("控制组：不在 recovery 带的同一房，房级 colony 节点不产出动作（ isolate 出被测的那条生产者）", () => {
    // 诚实声明：这个夹具是**无 creep 的空房**，所以 empire-health 的 colony *维度*
    // （人口/健康度）本来就会报故障 —— 上一次跑就是 spawn_recovery+energy_redirect+
    // terminal_trade+population_rebuild 四条齐全。因此控制组**不能**断言"零动作"，
    // 只能断言"没有**房级** colony 节点"（`failure:colony:<room>:<tick>`），
    // 那才是 #57 要接的生产者；维度节点是 `failure:<dim>:<tick>`，不带房名。
    const world = buildRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    const actionTypes: string[] = [];
    const roomScopedColonyActions: string[] = [];
    let colonyStateLast: string | undefined;

    runner.run(world, 240, {
      onTick: (w, t) => {
        if (t === 1) {
          const roomMem = g().Memory.rooms.W1N1;
          roomMem.controllerProgressSeen = w.controller?.progress ?? 0;
          roomMem.controllerProgressChangedAt = g().Game.time;
        }
        const acts: ActionLite[] = heap().recoveryActions ?? [];
        for (const a of acts) {
          if (!actionTypes.includes(a.type)) actionTypes.push(a.type);
          if (a.targetFailureId?.startsWith("failure:colony:W1N1:")) {
            if (!roomScopedColonyActions.includes(a.type)) roomScopedColonyActions.push(a.type);
          }
        }
        colonyStateLast = g().Memory.rooms.W1N1?.colonyState;
      },
    });

    expect(
      colonyStateLast,
      `对照组应不在 recovery 带；动作集=${JSON.stringify(actionTypes)}`,
    ).not.toBe("recovery");
    expect(
      roomScopedColonyActions,
      `不在 recovery 带却有房级 colony 动作 ⇒ 上一条的通过不能归因于注入；` +
        `colonyState=${colonyStateLast} 动作集=${JSON.stringify(actionTypes)}`,
    ).toEqual([]);
  });

  it("发展停摆（锚点陈旧 + 不在 recovery 带）→ development_resume → 请求的是 upgrader 而非 harvester", () => {
    // 这一例钉的是 #57 的全部主张：信号源是**跨部署的停滞锚点**（不是相位带抽样），
    // 响应方向是**加消费出口**（升级/建造），而不是给花不出去的房子再加采集。
    const world = buildRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    const devActionTypes = new Set<string>();
    const requestedRoles = new Set<string>();
    const correlationIds = new Set<string>();
    let colonyStateLast: string | undefined;

    runner.run(world, 1300, {
      onTick: (w, t) => {
        if (t === 1) {
          const roomMem = g().Memory.rooms.W1N1;
          roomMem.controllerProgressSeen = w.controller?.progress ?? 0;
          roomMem.controllerProgressChangedAt = g().Game.time - (E5_STALE_TICKS + 1);
        }
        const acts: ActionLite[] = heap().recoveryActions ?? [];
        for (const a of acts) {
          if (a.targetFailureId?.startsWith("failure:development:W1N1:"))
            devActionTypes.add(a.type);
        }
        const queue: QueueItemLite[] = g().Memory.rooms.W1N1?.spawnQueue ?? [];
        for (const item of queue) {
          const corr = item.memory?.recoveryCorrelationId;
          if (corr && item.role) {
            correlationIds.add(corr);
            requestedRoles.add(item.role);
          }
        }
        colonyStateLast = g().Memory.rooms.W1N1?.colonyState;
      },
    });

    const diag = `colonyState=${colonyStateLast} 房级development动作=${JSON.stringify([...devActionTypes])} 请求角色=${JSON.stringify([...requestedRoles])}`;
    expect([...devActionTypes], `陈旧锚点应产出房级 development 定向动作；${diag}`).toContain(
      "development_resume",
    );
    expect([...requestedRoles], `响应应落到升级产能上；${diag}`).toContain("upgrader");
    expect([...requestedRoles], `不该给停摆房加采集（病灶是花不出去）；${diag}`).not.toContain(
      "harvester",
    );
    // 防刷：节点每 100 拍重报一次，但提交侧幂等键是 `domain:type:room`（**不含 tick**，
    // recoveryIdempotencyKey），加 maxAttempts=2 / cooldown=1000 / 活跃租约（executing 期间不再提交）。
    // 实测值 = 1（1300 拍里只成交一次：首条请求留在队列里，hasRequest 也把后续挡掉）。
    // 上限给 2 是为了容忍"验证收口后再补一次"这条合法路径；若键真的按 node 实例（含 tick）去重，
    // 这里会看到 ~13 次 —— 所以这条断言真的在盯那件事。
    expect(
      correlationIds.size,
      `同一停摆的提交次数应受"每保留窗 ≤2 次"约束；实得 ${correlationIds.size} 个 correlationId；${diag}`,
    ).toBeLessThanOrEqual(2);
  });

  it("恢复动作烧穿重试预算 → 清单进 Memory 且事件不逐拍重复（#59）", () => {
    // 为什么跑这么久：升级烧穿要走完 提交 → 执行 → 验证（no_progress→failed）→ 第二次尝试 → terminal
    // → escalation 这条完整时间线，短窗口只能测到前半段。
    const world = buildRoom();
    const runner = new TickRunner();
    runner.setLoop(loop);

    let escalations: Array<{ room: string; domain: string; actionType: string; repeats: number }> =
      [];
    let sawTerminal = false;

    runner.run(world, 6000, {
      onTick: (w, t) => {
        if (t === 1) {
          const roomMem = g().Memory.rooms.W1N1;
          roomMem.controllerProgressSeen = w.controller?.progress ?? 0;
          roomMem.controllerProgressChangedAt = g().Game.time - (E5_STALE_TICKS + 1);
        }
        const list = g().Memory.kernel?.escalations;
        if (Array.isArray(list) && list.length > 0) {
          escalations = list.map(e => ({
            room: e.room,
            domain: e.domain,
            actionType: e.actionType,
            repeats: e.repeats,
          }));
          if (list.some(e => e.terminal === true)) sawTerminal = true;
        }
      },
    });

    expect(
      escalations.length,
      "烧穿重试预算后 Memory.kernel.escalations 应留下案例条目（换码也带得走）",
    ).toBeGreaterThan(0);
    expect(escalations[0]!.room, "清单条目必须带房名（幂等键同口径）").toBe("W1N1");
    expect(
      escalations.every(e => e.repeats <= escalations[0]!.repeats + escalations.length),
      "同一案例只应更新一条，不得逐拍追加",
    ).toBe(true);
    expect(escalations.length, "清单条数应有界").toBeLessThanOrEqual(12);
    // terminal 位只在真判不可恢复时才置 1 —— 没走到也无妨，但必须能区分（不伪装成已验证）
    if (!sawTerminal) {
      console.log("[known-gap] 本轮窗口内未走到 terminal 判定，escalation 只记到 failed 沿");
    }
  });
});
