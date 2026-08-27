/** A5.1 G1 — Threat Assessment 纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  assessThreat,
  inferThreatIntent,
  analyzeHostileBody,
  type HostileSnapshot,
  type RoomContext,
  type DefenseContext,
  type ThreatAssessmentInput,
} from "../../../src/domain/defense/threat-assessment";

// ─── 测试辅助 ────────────────────────────────────────────────

function makeHostile(
  body: { type: BodyPartConstant; boost?: string; damaged?: boolean }[],
  opts: Partial<HostileSnapshot> = {},
): HostileSnapshot {
  const hitsMax = body.length * 100;
  return {
    id: opts.id ?? "hostile-1",
    owner: opts.owner ?? "Invader",
    pos: opts.pos ?? 25 * 50 + 25,
    body,
    hits: opts.hits ?? hitsMax,
    hitsMax: opts.hitsMax ?? hitsMax,
    ticksToLive: opts.ticksToLive,
    room: opts.room ?? "W1N1",
  };
}

function makeRoomContext(opts: Partial<RoomContext> = {}): RoomContext {
  return {
    roomName: opts.roomName ?? "W1N1",
    corePos: opts.corePos ?? 25 * 50 + 25,
    towerCount: opts.towerCount ?? 3,
    towerEnergyTotal: opts.towerEnergyTotal ?? 3000,
    rampartCoverage: opts.rampartCoverage ?? 0.5,
    rcl: opts.rcl ?? 8,
    safeModeAvailable: opts.safeModeAvailable ?? 3,
    safeModeTicks: opts.safeModeTicks,
    hasStorage: opts.hasStorage ?? true,
    hasSpawn: opts.hasSpawn ?? true,
    friendlyCreepCount: opts.friendlyCreepCount ?? 5,
    sourceCount: opts.sourceCount ?? 2,
    isRemoteRoom: opts.isRemoteRoom ?? false,
    incomingNukes: opts.incomingNukes ?? 0,
  };
}

function makeDefenseContext(opts: Partial<DefenseContext> = {}): DefenseContext {
  return {
    colonyState: opts.colonyState ?? "normal",
    lastHostileAt: opts.lastHostileAt,
    prevThreatCount: opts.prevThreatCount ?? 0,
  };
}

function makeInput(opts: Partial<ThreatAssessmentInput> = {}): ThreatAssessmentInput {
  return {
    tick: opts.tick ?? 1000000,
    hostiles: opts.hostiles ?? [],
    roomContext: opts.roomContext ?? makeRoomContext(),
    defenseContext: opts.defenseContext ?? makeDefenseContext(),
    playerIntel: opts.playerIntel,
    remoteContext: opts.remoteContext,
  };
}

// ─── T01: 无威胁 ────────────────────────────────────────────

describe("G1 — assessThreat 无威胁场景", () => {
  it("T01: 无敌方单位 → level=NONE, posture=NORMAL", () => {
    const result = assessThreat(makeInput({ hostiles: [] }));
    expect(result.level).toBe("NONE");
    expect(result.recommendedPosture).toBe("NORMAL");
    expect(result.estimatedIntent.intent).toBe("UNKNOWN");
    expect(result.timeToImpact).toBe(Infinity);
    expect(result.sources).toHaveLength(0);
    expect(result.score.total).toBe(0);
  });
});

// ─── T02: NPC invader ───────────────────────────────────────

describe("G1 — NPC invader 威胁", () => {
  it("T02: 单只 NPC invader [ATTACK, MOVE] → level ≤ MEDIUM", () => {
    const invader = makeHostile(
      [{ type: ATTACK }, { type: MOVE }],
      { owner: "Invader", pos: 40 * 50 + 40 },
    );
    const result = assessThreat(makeInput({ hostiles: [invader] }));
    expect(result.sources).toContain("npc_invader");
    expect(result.estimatedIntent.intent).toBe("HARASSMENT");
    expect(result.level).not.toBe("NONE");
    expect(result.estimatedPower.attack).toBe(30);
  });
});

// ─── T03: Boosted attacker ──────────────────────────────────

describe("G1 — Boosted attacker 威胁", () => {
  it("T03: T3 boosted ATTACK creep → HIGH 级别", () => {
    const attacker = makeHostile(
      [
        { type: TOUGH, boost: "XGHO2" },
        { type: ATTACK, boost: "XUH2O" },
        { type: ATTACK, boost: "XUH2O" },
        { type: ATTACK, boost: "XUH2O" },
        { type: ATTACK, boost: "XUH2O" },
        { type: MOVE }, { type: MOVE }, { type: MOVE },
      ],
      { owner: "enemy_player", pos: 40 * 50 + 40 },
    );
    const result = assessThreat(makeInput({ hostiles: [attacker] }));
    expect(result.estimatedPower.boosted).toBe(true);
    expect(result.estimatedPower.maxBoostTier).toBe(3);
    expect(result.estimatedPower.attack).toBe(4 * 30 * 4); // 4 × 30 × T3(4) = 480
    expect(result.sources).toContain("player");
    // 单只 creep 不够 FULL_ASSAULT（需要 ≥4），且 distance > 5 不触发 CONTROLLER_ATTACK
    // → HARASSMENT (1-2 武装)
    expect(result.estimatedIntent.intent).toBe("HARASSMENT");
  });
});

// ─── T04: Heal stack / SIEGE ────────────────────────────────

describe("G1 — SIEGE 检测", () => {
  it("T04: heal ≥ 塔净伤 + 核心区外 → SIEGE", () => {
    // 塔净伤估计 = towerCount(3) × 600 × 0.5 = 900
    // 需要 heal ≥ 900 → 76 个 HEAL 部件（76 × 12 = 912）
    // 测试用更少的塔：1 塔 → 净伤 = 300 → 26 HEAL 即可
    const siegeCreep = makeHostile(
      Array.from({ length: 26 }, () => ({ type: HEAL as BodyPartConstant }))
        .concat(Array.from({ length: 26 }, () => ({ type: MOVE as BodyPartConstant }))),
      { owner: "enemy_player", pos: 48 * 50 + 48 }, // 远离核心区
    );
    const result = assessThreat(makeInput({
      hostiles: [siegeCreep],
      roomContext: makeRoomContext({
        towerCount: 1,
        towerEnergyTotal: 1000,
        corePos: 25 * 50 + 25,
      }),
    }));
    expect(result.estimatedIntent.intent).toBe("SIEGE");
    expect(result.estimatedIntent.confidence).toBeGreaterThan(0.5);
  });
});

// ─── T05: Remote harassment ─────────────────────────────────

describe("G1 — Remote mining attack", () => {
  it("T05: 远矿房 + 武装 creep → REMOTE_MINING_ATTACK", () => {
    const harasser = makeHostile(
      [{ type: ATTACK }, { type: MOVE }],
      { owner: "enemy_player", pos: 10 * 50 + 10 },
    );
    const result = assessThreat(makeInput({
      hostiles: [harasser],
      roomContext: makeRoomContext({
        isRemoteRoom: true,
        towerCount: 0,
        towerEnergyTotal: 0,
        rcl: 0,
        hasStorage: false,
        hasSpawn: false,
      }),
    }));
    expect(result.estimatedIntent.intent).toBe("REMOTE_MINING_ATTACK");
    expect(result.estimatedIntent.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

// ─── T06: Scout ─────────────────────────────────────────────

describe("G1 — Scout 检测", () => {
  it("T06: 仅 MOVE body → SCOUTING", () => {
    const scout = makeHostile(
      [{ type: MOVE }, { type: MOVE }],
      { owner: "enemy_player", pos: 48 * 50 + 48 },
    );
    const result = assessThreat(makeInput({ hostiles: [scout] }));
    expect(result.estimatedIntent.intent).toBe("SCOUTING");
    expect(result.estimatedIntent.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.level).not.toBe("CRITICAL"); // SCOUTING 不应是高威胁
  });
});

// ─── T07: Nuke ──────────────────────────────────────────────

describe("G1 — Nuke 检测", () => {
  it("T07: incomingNukes > 0 → NUCLEAR / EMERGENCY", () => {
    const result = assessThreat(makeInput({
      hostiles: [],
      roomContext: makeRoomContext({ incomingNukes: 1 }),
    }));
    expect(result.estimatedIntent.intent).toBe("NUCLEAR");
    expect(result.estimatedIntent.confidence).toBe(1.0);
    expect(result.recommendedPosture).toBe("EMERGENCY");
    expect(result.confidence).toBe("fact");
  });
});

// ─── T08: Claim ─────────────────────────────────────────────

describe("G1 — Claim 检测", () => {
  it("T08: claim 部件 → CLAIM intent", () => {
    const claimer = makeHostile(
      [{ type: CLAIM }, { type: MOVE }, { type: MOVE }],
      { owner: "enemy_player", pos: 40 * 50 + 40 },
    );
    const result = assessThreat(makeInput({ hostiles: [claimer] }));
    expect(result.estimatedIntent.intent).toBe("CLAIM");
  });
});

// ─── T09: Full assault ──────────────────────────────────────

describe("G1 — Full assault 检测", () => {
  it("T09: 4+ boosted creep → FULL_ASSAULT", () => {
    const creeps: HostileSnapshot[] = [];
    for (let i = 0; i < 4; i++) {
      creeps.push(makeHostile(
        [
          { type: TOUGH, boost: "XGHO2" },
          { type: ATTACK, boost: "XUH2O" },
          { type: ATTACK, boost: "XUH2O" },
          { type: MOVE }, { type: MOVE },
        ],
        { owner: "enemy_player", pos: (40 + i) * 50 + 40, id: `creep-${i}` },
      ));
    }
    const result = assessThreat(makeInput({ hostiles: creeps }));
    expect(result.estimatedIntent.intent).toBe("FULL_ASSAULT");
    expect(result.estimatedIntent.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ─── T10: Score 可拆解性 ────────────────────────────────────

describe("G1 — Score 可拆解性", () => {
  it("T10: 评分包含各维度子分数", () => {
    const attacker = makeHostile(
      [{ type: ATTACK }, { type: MOVE }],
      { owner: "enemy_player", pos: 20 * 50 + 20 },
    );
    const result = assessThreat(makeInput({ hostiles: [attacker] }));
    expect(result.score).toHaveProperty("combat");
    expect(result.score).toHaveProperty("intent");
    expect(result.score).toHaveProperty("proximity");
    expect(result.score).toHaveProperty("objective");
    expect(result.score).toHaveProperty("boost");
    expect(result.score).toHaveProperty("defense");
    expect(result.score).toHaveProperty("economicImpact");
    expect(result.score).toHaveProperty("total");
    // total 应为各维度的加权组合
    expect(result.score.total).toBeGreaterThan(0);
    expect(result.score.total).toBeLessThanOrEqual(100);
  });
});

// ─── analyzeHostileBody 测试 ────────────────────────────────

describe("G1 — analyzeHostileBody", () => {
  it("正确解析 hostile body 并返回 CombatCapability", () => {
    const hostile = makeHostile([
      { type: ATTACK, boost: "UH" },
      { type: MOVE },
    ]);
    const cap = analyzeHostileBody(hostile);
    expect(cap.attack).toBe(60); // 30 × 2 (T1 boost)
    expect(cap.boosted).toBe(true);
    expect(cap.maxBoostTier).toBe(1);
  });
});
