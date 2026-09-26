/**
 * B4-⑰ — war-planning-system 的兼容投影（warPlan.sponsor / 换目标收摊）。
 *
 * 钉的是两个写者之间的契约，而不是任何一方的内部算术：
 * 1. sponsor = 「谁来出这支兵」，只能由世界态解析（domain 的 spawnRequirement[].home
 *    填的是目标房）。写错的下场不是数值偏差，是 war-planner 在
 *    `Memory.rooms[sponsor].spawnQueue` 上读到 undefined 后整链静默停摆。
 * 2. A5 改判换目标必须先走 demobilize（唯一实现了收摊义务的地方）：旧编队标 recycle、
 *    旧 sponsor 的在队请求撤回、止损信号上报 —— 且不判负、不拉黑（主动撤换 ≠ 战败）。
 *
 * 本文件此前不存在：warPlanningSystem.run() 在单测里从未被真实调用过（只有
 * architecture/compliance 引用它），所以真写者的覆写行为一直无人作证。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { warPlanningSystem } from "../../../src/systems/military/war-planning-system";
import { demobilize, warPlannerSystem } from "../../../src/systems/military/war-planner";
import { mapAbortToRecoveryAction } from "../../../src/domain/military/abort-recovery";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import type { ThreatAssessment } from "../../../src/domain/defense/threat-assessment";
import type { EmpireHealthResult } from "../../../src/domain/strategy/empire-health";
import {
  mockContext,
  mockRoomStateCtx,
  mockSnapshot,
  resetGlobals,
  syncSquadIndex,
} from "../../support/factories";

const TICK = 1000;
/** 自有房：远矿 W6N4 的运营方，也是编队的孵化方。 */
const HOST = "W7N4";
/** 我方远矿运营房（不属于我们），被敌方开采队威胁。 */
const REMOTE = "W6N4";

const G = () => globalThis as any;
const SNAP = () =>
  mockSnapshot({
    roomName: HOST,
    rcl: 5,
    spawns: [{} as never],
    energyCapacityAvailable: 1300,
  });
const CTX = () => mockRoomStateCtx([SNAP()], TICK);
const MILITARY_ROLES = new Set(["attacker", "healer"]);

function threat(intent: string, level = "HIGH"): ThreatAssessment {
  return {
    level,
    score: {
      combat: 40,
      intent: 60,
      proximity: 50,
      objective: 50,
      boost: 0,
      defense: 30,
      economicImpact: 30,
      total: 55,
    },
    confidence: "fact",
    multiConfidence: {
      factConfidence: 0.9,
      combatConfidence: 0.9,
      intentConfidence: 0.7,
      terrainConfidence: 0.6,
      intelConfidence: 0.5,
      overallConfidence: 0.8,
    },
    estimatedPower: {
      attack: 100,
      rangedAttack: 50,
      heal: 80,
      effectiveHP: 1500,
      dismantle: 0,
      toughParts: 2,
      boosted: false,
      maxBoostTier: 0,
    },
    enemyCombatPower: {
      burstDamage: 150,
      effectiveHP: 1500,
      healOutput: 80,
      dismantlePower: 0,
      powerScore: 350,
      creepCount: 3,
      mobility: 1,
      boosted: false,
    },
    estimatedIntent: { intent, confidence: 0.7, evidence: ["fixture"] },
    timeToImpact: 50,
    sources: ["player"],
    recommendedPosture: "FORTIFY",
    tick: TICK,
  } as unknown as ThreatAssessment;
}

/** 受威胁房集合 —— A5 的输入主体（空 Map 即"无威胁"，A5 不出计划）。 */
function seedThreats(entries: ReadonlyArray<[string, ThreatAssessment]>): void {
  globalCache().threatAssessments = new Map(entries);
}

/** 经观察交接通道播种情报（与生产采集路径一致），供 war-planner 的存续期复核读取。 */
function seedIntel(subject: string): void {
  __resetIntelStateForTests();
  globalCache().intelHandoff = [
    {
      subject,
      home: HOST,
      source: "observer",
      payload: {
        kind: "normal",
        status: "normal",
        lastSeen: TICK - 100,
        owner: "Enemy",
        towers: 0,
      },
    },
  ];
  intelligenceSystem.run(mockContext(SNAP()));
}

function setup(opts: { remoteOp?: boolean } = {}): void {
  resetGlobals();
  G().Game.time = TICK;
  G().Game.rooms = {
    [HOST]: { controller: { my: true, owner: { username: "Me" } } },
    ...(opts.remoteOp ? { [REMOTE]: { controller: { my: false } } } : {}),
  };

  G().Memory.rooms[HOST] = { spawnQueue: [], buildQueue: [] };
  if (opts.remoteOp) {
    G().Memory.rooms[HOST].remoteOps = {
      [REMOTE]: { state: "active", createdAt: TICK - 5000, lastSeen: TICK - 10 },
    };
  }
  G().Memory.kernel.strategy = {
    posture: "war",
    since: TICK - 200,
    expansionAllowed: false,
    newRemoteOpsAllowed: false,
  };
  globalCache().empireHealth = { level: "stable" } as unknown as EmpireHealthResult;
  G().Game.creeps = {};
  syncSquadIndex();
}

/** 让 A5 + war-planner 对远矿建起一支编队，返回当时的 warPlan。 */
function squadAtRemote(): any {
  setup({ remoteOp: true });
  seedIntel(REMOTE);
  seedThreats([[REMOTE, threat("REMOTE_MINING_ATTACK")]]);
  const c = CTX();
  warPlanningSystem.run(c);
  warPlannerSystem.run(c);
  return G().Memory.kernel.warPlan;
}

beforeEach(() => {
  setup();
});

describe("B4-⑰ sponsor 解析：谁出这支兵", () => {
  it("远矿房受威胁 → warPlan.sponsor 是运营它的自有房，不是目标房", () => {
    setup({ remoteOp: true });
    seedIntel(REMOTE);
    seedThreats([[REMOTE, threat("REMOTE_MINING_ATTACK")]]);

    warPlanningSystem.run(CTX());

    const plan = G().Memory.kernel.warPlan;
    expect(plan).toBeDefined();
    expect(plan.targetRoom).toBe(REMOTE);
    // 旧行为：sponsor ≡ spawnRequirement[0].home ≡ 目标房（一间不属于我们的房）。
    expect(plan.sponsor).toBe(HOST);
    expect(globalCache().warLogisticsDemand?.sponsor).toBe(HOST);
  });

  it("sponsor 解析对了之后，war-planner 才真的在 host 队列里补员（旧行为整链停摆）", () => {
    setup({ remoteOp: true });
    seedIntel(REMOTE);
    seedThreats([[REMOTE, threat("REMOTE_MINING_ATTACK")]]);

    const c = CTX();
    warPlanningSystem.run(c);
    warPlannerSystem.run(c);

    const queue = G().Memory.rooms[HOST].spawnQueue;
    const roles = queue.map((r: any) => r.role as string);
    expect(roles).toContain("attacker");
    expect(roles).toContain("healer");
    // 编队归属：home = 孵化房，remoteTarget = 作战目标房。
    for (const req of queue) {
      expect(req.memory.home).toBe(HOST);
      expect(req.memory.remoteTarget).toBe(REMOTE);
    }
    // warPlan 的消耗战账本随之启动（停摆时恒 0）。
    expect(G().Memory.kernel.warPlan.spawned).toBeGreaterThan(0);
  });

  it("受威胁的是自有房 → 就地防御，sponsor 即目标房本身", () => {
    seedThreats([[HOST, threat("SIEGE")]]);

    warPlanningSystem.run(CTX());

    const plan = G().Memory.kernel.warPlan;
    expect(plan.targetRoom).toBe(HOST);
    expect(plan.sponsor).toBe(HOST);
  });

  it("一间能孵兵的自有房都看不到 → 不落笔，不把目标房冒充 sponsor", () => {
    setup({ remoteOp: true });
    // 自有房全部失视野：Game.rooms 里没有 controller.my，快照也没有。
    G().Game.rooms = { [REMOTE]: { controller: { my: false } } };
    seedThreats([[REMOTE, threat("REMOTE_MINING_ATTACK")]]);

    warPlanningSystem.run(mockRoomStateCtx([], TICK));

    expect(G().Memory.kernel.warPlan).toBeUndefined();
    expect(globalCache().warLogisticsDemand).toBeUndefined();
  });
});

describe("B4-⑰ 换目标必须收摊", () => {
  it("A5 改判到另一间房 → 旧编队标 recycle、旧请求撤回", () => {
    squadAtRemote();
    // 在役编队（squadIndex 按 home + remoteTarget 键住它们）。
    G().Game.creeps = {
      "attacker-1": {
        name: "attacker-1",
        memory: { role: "attacker", home: HOST, remoteTarget: REMOTE },
        body: [{ type: "attack" }],
      },
      "healer-1": {
        name: "healer-1",
        memory: { role: "healer", home: HOST, remoteTarget: REMOTE },
        body: [{ type: "heal" }],
      },
    };
    syncSquadIndex();
    const queue = G().Memory.rooms[HOST].spawnQueue;
    expect(queue.filter((r: any) => MILITARY_ROLES.has(r.role)).length).toBeGreaterThan(0);

    // 威胁改判：自家房被围 → 新目标是 HOST。
    seedThreats([[HOST, threat("SIEGE")]]);
    warPlanningSystem.run(CTX());

    expect(G().Game.creeps["attacker-1"].memory.recycle).toBe(true);
    expect(G().Game.creeps["healer-1"].memory.recycle).toBe(true);
    // 旧行为的下场：这两只 creep 再没有任何系统会查到（新计划的 remoteTarget 是 HOST），
    // 请求则永久占着 host 的孵化位。
    expect(queue.filter((r: any) => MILITARY_ROLES.has(r.role))).toEqual([]);
  });

  it("换目标是主动撤换：止损信号带 TARGET_SWITCH、不判负、不拉黑旧目标", () => {
    squadAtRemote();
    seedThreats([[HOST, threat("SIEGE")]]);

    warPlanningSystem.run(CTX());

    const signal = globalCache().warAbortSignals;
    expect(signal?.reason).toBe("TARGET_SWITCH");
    expect(signal?.targetRoom).toBe(REMOTE);
    expect(signal?.sponsor).toBe(HOST);
    expect(signal?.outcome).toBe("unknown");
    // 换目标不是打败仗：把旧目标拉黑会让威胁回来时选不到它。
    expect(G().Memory.kernel.warBlacklist?.[REMOTE]).toBeUndefined();
    // 新计划已就位（换目标 = 整组重置）。
    expect(G().Memory.kernel.warPlan.targetRoom).toBe(HOST);
    expect(G().Memory.kernel.warPlan.since).toBe(TICK);
    expect(G().Memory.kernel.warPlan.spawned).toBe(0);
  });

  it("同目标续期不收摊（since/spawned 保留、无止损信号）", () => {
    const first = squadAtRemote();
    expect(first.spawned).toBeGreaterThan(0);

    warPlanningSystem.run(CTX());

    const plan = G().Memory.kernel.warPlan;
    expect(plan.since).toBe(first.since);
    expect(plan.spawned).toBe(first.spawned);
    expect(globalCache().warAbortSignals).toBeUndefined();
  });

  it("demobilize(TARGET_SWITCH)：撤摊后无计划可收 → 幂等空转", () => {
    setup({ remoteOp: true });
    expect(G().Memory.kernel.warPlan).toBeUndefined();
    expect(() => demobilize(TICK, 5)).not.toThrow();
  });

  it("撤换式收摊不置休战闸（换目标后新计划立刻可用）", () => {
    squadAtRemote();
    const queue = G().Memory.rooms[HOST].spawnQueue;

    demobilize(TICK, 5);

    expect(G().Memory.kernel.warStandDownUntil).toBeUndefined();
    expect(G().Memory.kernel.warPlan).toBeUndefined();
    expect(queue.filter((r: any) => MILITARY_ROLES.has(r.role))).toEqual([]);
  });
});

describe("B4-⑰ TARGET_SWITCH 的恢复语义", () => {
  it("TARGET_SWITCH 映射到 auto_resolve：新计划自己声明补员需求，不抢恢复预算", () => {
    const action = mapAbortToRecoveryAction({
      tick: TICK,
      reason: "TARGET_SWITCH",
      targetRoom: REMOTE,
      sponsor: HOST,
      spawned: 4,
      outcome: "unknown",
    });
    // 表里没有这个 reason 时返回 null —— 信号被静默丢弃，恢复侧无从归因。
    expect(action).not.toBeNull();
    expect(action!.type).toBe("auto_resolve");
    expect(action!.urgent).toBe(false);
    expect(action!.room).toBe(HOST);
  });
});
