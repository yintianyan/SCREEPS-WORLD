/**
 * #99 — 战争候选漏斗计数。
 *
 * 钉的是"归因能力"本身：#95 的「war 零计划零编队」之所以不可归因，是因为选靶链路上
 * 每道筛子都是裸 `continue`/`return undefined` —— 跑一千小时也答不出"是没敌人、没情报、
 * 还是情报不够格"。本文件锁住三件事：
 * 1. 每道出口各归一位（不合并、不串味）；
 * 2. 终局四计数（noInput | noThreats | noPlan | plans）恰有一项成立 —— 漏斗闭合；
 * 3. 老化批的落盘语义：`war-planning 没跑过` ⇒ 缺键，而不是全零
 *    （全零会被读成"跑过且每道筛子都空"，那是两种完全不同的现场）。
 *
 * ⚠️本文件不判任何门槛：`CONFIG.war.maxTowers/targetFreshness/maxDistance` 一个都没动，
 * 计数只观察它们筛掉了什么。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { warPlanningSystem } from "../../../src/systems/military/war-planning-system";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { systemPhase } from "../../../src/kernel/phase";
import { globalCache } from "../../../src/kernel/global-cache";
import type { ThreatAssessment } from "../../../src/domain/defense/threat-assessment";
import type { EmpireHealthResult } from "../../../src/domain/strategy/empire-health";
import type { RoomIntel } from "../../../src/domain/intel";
import {
  mockContext,
  mockRoomStateCtx,
  mockSnapshot,
  resetGlobals,
  syncSquadIndex,
} from "../../support/factories";

const TICK = 1_000;
const HOST = "W7N4";
const ME = "Me";
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

/** 老化门触发 tick：与 intelligence.test.ts 同一条判据。 */
const PARENT_PHASE = systemPhase("intelligence", 10);
function agingTick(base: number): number {
  return base + ((((PARENT_PHASE - base) % 100) + 100) % 100);
}

function threat(intent: string): ThreatAssessment {
  return {
    level: "HIGH",
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

function setup(opts: { health?: boolean; remoteOp?: boolean } = {}): void {
  resetGlobals();
  __resetIntelStateForTests();
  G().Game.time = TICK;
  G().Game.rooms = {
    [HOST]: { controller: { my: true, owner: { username: ME } } },
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
  if (opts.health === false) {
    delete globalCache().empireHealth;
  } else {
    globalCache().empireHealth = { level: "stable" } as unknown as EmpireHealthResult;
  }
  G().Game.creeps = {};
  syncSquadIndex();
}

/** 经生产采集路径（观察交接 → intelligence）播种情报池。 */
function seedIntel(
  entries: Array<{ subject: string; source?: string; intel: Partial<RoomIntel> }>,
): void {
  globalCache().intelHandoff = entries.map(e => ({
    subject: e.subject,
    home: HOST,
    source: (e.source ?? "observer") as never,
    payload: {
      kind: "normal",
      status: "normal",
      lastSeen: TICK - 100,
      towers: 0,
      ...e.intel,
    } as RoomIntel,
  })) as never;
  intelligenceSystem.run(mockContext(SNAP()));
}

function funnel() {
  return globalCache().warFunnelScratch;
}

beforeEach(() => {
  setup();
});

describe("#99 出口计数：每道筛子各归一位", () => {
  it("非 fact / 无主 / 我方 / 非 normal 各记一位，活下来的进 candidates", () => {
    seedIntel([
      // ally 是非直接来源 ⇒ 置信度 inferred ⇒ 出口①
      { subject: "W5N1", source: "ally", intel: { owner: "Enemy" } },
      // 出口②：payload 没有 owner（看不到控制器归属）
      { subject: "W5N2", intel: {} },
      // 出口②′：owner 就是我方 —— 与"无主"分开记，否则"视野里只有自家"会被读成"没有敌人"
      { subject: "W5N3", intel: { owner: ME } },
      // 出口③：kind !== normal
      { subject: "W5N4", intel: { owner: "Enemy", kind: "center" } },
      // 唯一活过三道出口的候选
      { subject: "W5N5", intel: { owner: "Enemy" } },
    ]);
    globalCache().threatAssessments = new Map([[HOST, threat("SIEGE")]]);

    warPlanningSystem.run(CTX());

    const f = funnel()!;
    expect(f.tick).toBe(TICK);
    expect(f.intelEntries).toBe(5);
    expect(f.notFact).toBe(1);
    expect(f.unowned).toBe(1);
    expect(f.mine).toBe(1);
    expect(f.notNormal).toBe(1);
    expect(f.candidates).toBe(1);
  });

  it("自有远矿房仍是候选（occupied 是 domain 的第四道闸，本处不替它计数）", () => {
    setup({ remoteOp: true });
    seedIntel([{ subject: REMOTE, intel: { owner: "Enemy" } }]);
    globalCache().threatAssessments = new Map([[REMOTE, threat("REMOTE_MINING_ATTACK")]]);

    warPlanningSystem.run(CTX());

    // 三道出口都没拦它。occupied / blacklisted / stale / towers 四道闸在 domain 的 selectTarget 里，
    // 它们的拒因随 rejectedAlternatives 落进计划 —— 本表不替它们计数（复制一份判据只会与真判据漂移）。
    expect(funnel()!.candidates).toBe(1);
    expect(funnel()!.notFact).toBe(0);
  });
});

describe("#99 漏斗闭合：终局计数恰有一项成立", () => {
  /** 闭合不变式：每次 pass 落在且只落在一个终局。 */
  function assertClosed(f: NonNullable<ReturnType<typeof funnel>>): void {
    expect(f.noInput + f.noThreats + f.noPlan + f.plans).toBe(1);
  }

  it("候选池为空仍出计划 —— 因为 opType 恒为防御性，选靶支路不可达（本 pass 的实测真形）", () => {
    globalCache().threatAssessments = new Map([[HOST, threat("SIEGE")]]);

    warPlanningSystem.run(CTX());

    const f = funnel()!;
    expect(f.noInput).toBe(0);
    expect(f.intelEntries).toBe(0);
    expect(f.notFact + f.unowned + f.mine + f.notNormal + f.candidates).toBe(0);
    expect(f.noThreats).toBe(0);
    // ⚠️这一条不是"漏斗放行"，而是"漏斗根本不在路径上"：deriveOperationType 的 10 个
    // ThreatIntent 分支只返回 DEFEND/ESCORT/RETREAT，`isOffensive` 恒 false ⇒ domain 走
    // deriveTarget 的防御支，目标 = 受威胁房本身，selectTarget（连同 maxTowers/新鲜度/距离
    // 三道闸与整个候选表）永不被调用。零计划因此只能由 noThreats 解释，不能由候选筛子解释。
    expect(f.plans).toBe(1);
    expect(G().Memory.kernel.warPlan.targetRoom).toBe(HOST);
    assertClosed(f);
  });

  it("无威胁 ⇒ noThreats 单列一位，不与 noPlan 重复计数", () => {
    setup({ remoteOp: true });
    seedIntel([{ subject: REMOTE, intel: { owner: "Enemy" } }]);
    globalCache().threatAssessments = new Map();

    warPlanningSystem.run(CTX());

    const f = funnel()!;
    expect(f.noThreats).toBe(1);
    expect(f.noPlan).toBe(0);
    expect(f.plans).toBe(0);
    // 无威胁时域内在采集之后立刻 bail —— 候选计数仍如实反映池子（它答的是"有没有靶"，
    // 不是"有没有敌人"，两者不能互相顶替）。
    expect(f.candidates).toBe(1);
    assertClosed(f);
  });

  it("empireHealth 缺失 ⇒ 本 pass 从未走到采集：noInput=1 且采集侧计数全零", () => {
    setup({ health: false });
    seedIntel([{ subject: REMOTE, intel: { owner: "Enemy" } }]);
    globalCache().threatAssessments = new Map([[HOST, threat("SIEGE")]]);

    warPlanningSystem.run(CTX());

    const f = funnel()!;
    expect(f.noInput).toBe(1);
    expect(f.intelEntries).toBe(0);
    expect(f.plans + f.noPlan + f.noThreats).toBe(0);
    assertClosed(f);
  });

  it("每个 pass 从零计量：连续两次 pass 不留累加痕迹", () => {
    globalCache().threatAssessments = new Map([[HOST, threat("SIEGE")]]);

    warPlanningSystem.run(CTX());
    const first = { ...funnel()! };
    warPlanningSystem.run(CTX());
    const second = funnel()!;

    expect(second.plans).toBe(first.plans);
    expect(second.plans).toBe(1);
    expect(second.noPlan).toBe(0);
    assertClosed(second);
  });
});

describe("#99 落盘：intelligence 老化批与 intelCoverage 同拍快照", () => {
  beforeEach(() => {
    // 老化批先做 segment 冷存 I/O 再写 stats：`segmentUnavailable()` 第一行就读 RawMemory。
    // 单测环境没有这个全局（生产环境恒有），不补桩则整段被 safeRun 吞掉 ⇒ 两份读数都写不出。
    // 见 tests/unit/kernel/segment-store.test.ts 的同款桩。
    Object.assign(G(), {
      RawMemory: {
        segments: {} as Record<number, string | undefined>,
        setActiveSegments: () => undefined,
      },
    });
  });

  it("scratch 已就绪 ⇒ 快照是一份拷贝（后续 pass 改写 scratch 不会追改历史读数）", () => {
    setup({ health: true });
    seedIntel([{ subject: REMOTE, intel: { owner: "Enemy" } }]);
    globalCache().threatAssessments = new Map([[HOST, threat("SIEGE")]]);
    warPlanningSystem.run(CTX());
    G().Memory.kernel.stats = {};

    const at = agingTick(TICK);
    G().Game.time = at;
    intelligenceSystem.run(mockContext(SNAP()));

    const stats = G().Memory.kernel.stats;
    expect(stats.intelCoverage.tick).toBe(at);
    expect(stats.warFunnel).toEqual({ ...funnel()! });
    expect(stats.warFunnel.tick).toBe(TICK);
    expect(stats.warFunnel).not.toBe(funnel());
  });

  it("war-planning 自 boot 没跑过 ⇒ 键缺失（「未上线」这一态），不写成全零", () => {
    G().Memory.kernel.stats = {};
    G().Game.time = agingTick(TICK);

    intelligenceSystem.run(mockContext(SNAP()));

    const stats = G().Memory.kernel.stats;
    expect(stats.intelCoverage).toBeDefined();
    expect(stats.warFunnel).toBeUndefined();
  });
});
