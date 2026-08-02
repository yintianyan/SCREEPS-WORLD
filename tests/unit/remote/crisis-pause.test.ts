/**
 * P0-2 远矿 crisis 暂停测试 — 主房危机期停止远矿 spawn 推送。
 *
 * 实现思路：
 *   - 工厂函数 seed() 统一构造 homeRoom=W1N1 的 Memory/Game mock，按用例覆盖
 *     colonyState / remoteOps / intel / creeps / rooms。
 *   - remoteReqs() 读取 spawnQueue 中 remote* 请求，作为危机暂停的断言锚点。
 *   - 10 用例分三组：正常路径（3）/ 边界条件（4）/ 异常情况（3），覆盖
 *     recovery/bootstrap/defense 暂停、normal 推送无回归、维护逻辑不中断、
 *     现役 creep 不召回、状态不丢失、recovery→normal 恢复推送。
 *
 * 事故背景：旧逻辑 colonyState 只挡「新开点」（roomReadyForNewRemote）+
 * demand 内部挡 bootstrap/reserver，不挡现役 op 的 remoteHarvester/
 * remoteHauler 推送 — 主房 RCL5 危机期远矿持续与主房 harvester 竞争 spawn，
 * 吸血 54795 tick。修复：系统层在 evaluateRemoteDemand 调用前根据
 * colonyState 跳过整个 spawn 推送块，现役 creep 自然寿终不召回。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { remoteMiningManagerSystem } from "../../../src/systems/remote-mining-manager";
import { CONFIG } from "../../../src/config";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";
import type { ColonyState, RoomSnapshot } from "../../../src/kernel/contracts";

const homeRoom = "W1N1";
const targetRoom = "W2N2";

/** 构造 active 状态的 RemoteOp（避免 state 被推断为 string）。 */
function activeOp(opts: {
  sources?: number;
  haulerNeed?: number;
  lastSeen?: number;
  lowScoreSince?: number;
} = {}): RemoteOp {
  const tick = (globalThis as any).Game.time as number;
  return {
    state: "active",
    sources: opts.sources ?? 1,
    haulerNeed: opts.haulerNeed ?? 1,
    createdAt: 0,
    lastSeen: opts.lastSeen ?? tick,
    ...(opts.lowScoreSince !== undefined ? { lowScoreSince: opts.lowScoreSince } : {}),
  };
}

interface SeedOpts {
  /** 主房殖民地状态（undefined 模拟字段缺失）。 */
  colonyState?: ColonyState | undefined;
  /** 远矿运营表（默认含一个 W2N2 active op）。 */
  remoteOps?: Record<string, RemoteOp>;
  /** 邻居房情报（pathCost 控制重估高低分）。 */
  intel?: Record<string, any>;
  /** Game.creeps mock（模拟现役远矿 creep）。 */
  creeps?: Record<string, any>;
  /** Game.rooms mock（模拟远矿房视野，触发 owner 检测等）。 */
  rooms?: Record<string, any>;
}

/**
 * 种子函数 — 设置 Memory.rooms[homeRoom] + Game.creeps/Game.rooms，
 * 返回匹配的 RoomSnapshot 供 mockContext 使用。
 * energyCapacityAvailable=1300 确保 remoteHauler 选 8-carry body（运力 400），
 * pathCost=60 时 netScore≈5.73（高分，不触发重估废弃）。
 */
function seed(opts: SeedOpts = {}): RoomSnapshot {
  const g = globalThis as any;

  g.Game.rooms = opts.rooms ?? {};
  g.Game.creeps = opts.creeps ?? {};

  g.Memory.rooms[homeRoom] = {
    // undefined 模拟 colonyState 字段缺失（roomMem.colonyState ?? "normal" 回退）
    colonyState: opts.colonyState,
    spawnQueue: [],
    remoteOps: opts.remoteOps ?? { [targetRoom]: activeOp() },
    ...(opts.intel ? { intel: opts.intel } : {}),
  };

  return mockSnapshot({
    roomName: homeRoom,
    rcl: 6,
    spawns: [{} as never],
    energyCapacityAvailable: 1300,
  });
}

/** 运行 remote-mining-manager 一个 tick。 */
function runRemoteMiningManager(snap: RoomSnapshot): void {
  remoteMiningManagerSystem.run(mockContext(snap));
}

/** 读取 homeRoom spawnQueue 中的 remote* 请求。 */
function remoteReqs(): any[] {
  const queue = (globalThis as any).Memory.rooms[homeRoom].spawnQueue ?? [];
  return queue.filter((r: any) => typeof r.role === "string" && r.role.startsWith("remote"));
}

/** 默认高分 intel（W2N2 近房，pathCost=60 → netScore≈5.73 ≥ minNetScore=3）。 */
const normalIntel = {
  [targetRoom]: { kind: "normal", status: "normal", lastSeen: 1000, pathCost: 60 },
};

beforeEach(() => {
  resetGlobals();
});

// ─── 正常路径 ───────────────────────────────────────────────

describe("P0-2 远矿 crisis 暂停 — 正常路径", () => {
  it("colonyState=recovery → 不推送任何 remote* spawn 请求", () => {
    // 主房恢复期：远矿停止吸血，spawn 槽位让给 P0 角色
    const snap = seed({
      colonyState: "recovery",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs()).toHaveLength(0);
  });

  it("colonyState=bootstrap → 不推送 remote* spawn 请求（嫩房不开远矿）", () => {
    // 嫩房起步期：本房自顾不暇，远矿 spawn 推送冻结
    const snap = seed({
      colonyState: "bootstrap",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs()).toHaveLength(0);
  });

  it("colonyState=normal → 正常推送 remote* spawn 请求（无回归）", () => {
    // 正常态：远矿 spawn 推送不受影响，remoteHarvester/remoteHauler 缺编即补
    const snap = seed({
      colonyState: "normal",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs().length).toBeGreaterThan(0);
  });
});

// ─── 边界条件 ───────────────────────────────────────────────

describe("P0-2 远矿 crisis 暂停 — 边界条件", () => {
  it("colonyState 缺失（undefined）→ 默认 normal，正常推送（保守不误伤）", () => {
    // 字段缺失走 ?? "normal" 回退 — 不误判为 crisis 冻结远矿
    const snap = seed({
      colonyState: undefined,
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs().length).toBeGreaterThan(0);
  });

  it("crisis 期 maintainExistingOps 仍运行（清理废弃 op 不中断）", () => {
    // 验证：crisis 期检测到敌方 owner 仍废弃 op — maintainExistingOps 在
    // crisis 暂停之前运行，不受 spawn 推送冻结影响
    const snap = seed({
      colonyState: "recovery",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 1 }) },
      intel: normalIntel,
      rooms: {
        // 给 W2N2 视野 + 敌方 owner → maintainExistingOps 废弃
        [targetRoom]: { controller: { owner: { username: "enemy" }, my: false } },
      },
    });
    runRemoteMiningManager(snap);
    expect((globalThis as any).Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("abandoned");
  });

  it("crisis 期 reevaluateActiveOps 仍运行（不停止经济重估）", () => {
    // 验证：crisis 期低分 op 仍被重估废弃 — 防止 crisis 期 op 状态滞后
    // 导致恢复后误判。reevaluateActiveOps 在 crisis 暂停之前运行。
    const g = globalThis as any;
    const now = g.Game.time as number;
    const started = now - CONFIG.remote.lowScoreGrace - 100; // 早已跌破宽限期
    const snap = seed({
      colonyState: "recovery",
      remoteOps: {
        [targetRoom]: activeOp({
          sources: 1,
          haulerNeed: 1,
          lastSeen: now,
          lowScoreSince: started,
        }),
      },
      // pathCost=5000 → netScore 远低于 minNetScore，触发低分废弃
      intel: { [targetRoom]: { kind: "normal", status: "normal", lastSeen: now, pathCost: 5000 } },
    });
    runRemoteMiningManager(snap);
    expect((globalThis as any).Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("abandoned");
  });

  it("colonyState 从 recovery 恢复 normal 后 ≤ 1 个 interval 内恢复 spawn 推送", () => {
    // 验证：恢复 normal 后下次 manager run 即恢复推送（interval=10 ≤ 100 tick 指标）
    let snap = seed({
      colonyState: "recovery",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs()).toHaveLength(0);

    // 恢复 normal — 重新 seed 重置 remoteOps（避免上一轮重估副作用）
    snap = seed({
      colonyState: "normal",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs().length).toBeGreaterThan(0);
  });
});

// ─── 异常情况 ───────────────────────────────────────────────

describe("P0-2 远矿 crisis 暂停 — 异常情况", () => {
  it("crisis 期现役 remoteHarvester 自然寿终不被强制召回（沉没成本已付）", () => {
    // 验证：crisis 暂停只跳过 spawn 推送，不召回现役 creep。
    // recycleBlockedRoomCreeps 仅对 InvaderCore/hostile 触发（止损），
    // recycleExcessRemoteCreeps 仅标记超额（双孵事故）— crisis 本身不产生召回。
    const rh1 = {
      name: "rh_1",
      spawning: false,
      ticksToLive: 1000, // 健康，不在替换窗口
      body: [{ type: "work" }, { type: "move" }],
      memory: {
        role: "remoteHarvester",
        home: homeRoom,
        remoteTarget: targetRoom,
        recycle: false,
      },
    };
    const snap = seed({
      colonyState: "recovery",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 1 }) },
      intel: normalIntel,
      creeps: { rh_1: rh1 },
    });
    runRemoteMiningManager(snap);
    expect(rh1.memory.recycle).toBe(false);
  });

  it("crisis 期 remoteOps 状态不丢失（active 保持 active，不误转 abandoned）", () => {
    // 验证：crisis 期正常 op（高分 + 近期 lastSeen）不被误废弃/暂停。
    // 与"reevaluateActiveOps 仍运行"互补：低分仍废弃，高分保持 active。
    const snap = seed({
      colonyState: "recovery",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 1 }) },
      intel: normalIntel, // pathCost=60 高分，不触发重估废弃
    });
    runRemoteMiningManager(snap);
    expect((globalThis as any).Memory.rooms[homeRoom].remoteOps[targetRoom].state).toBe("active");
  });

  it("colonyState=defense 时也暂停远矿推送（战时统一收缩）", () => {
    // 验证：defense 态与 recovery/bootstrap 同列暂停 — 战时统一收缩战线
    const snap = seed({
      colonyState: "defense",
      remoteOps: { [targetRoom]: activeOp({ sources: 1, haulerNeed: 2 }) },
      intel: normalIntel,
    });
    runRemoteMiningManager(snap);
    expect(remoteReqs()).toHaveLength(0);
  });
});
