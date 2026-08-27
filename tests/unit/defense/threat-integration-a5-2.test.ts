/** A5.2 Threat Integration 测试。 */
import { describe, expect, it } from "vitest";
import {
  assessThreat,
  type HostileSnapshot,
  type RoomContext,
  type DefenseContext,
  type ThreatAssessmentInput,
} from "../../../src/domain/defense/threat-assessment";
import {
  buildTerrainContext,
  type TerrainSnapshot,
} from "../../../src/domain/defense/terrain-context";
import {
  buildPlayerIntelRecord,
  makeObservedFact,
  makeCombatLogFact,
  makeInference,
  makePrediction,
} from "../../../src/domain/defense/player-intel";

// ─── 测试辅助 ────────────────────────────────────────────────

const TICK = 1_000_000;

function makeStrongHostile(): HostileSnapshot {
  // T3 boosted attacker
  return {
    id: "strong-enemy",
    owner: "enemy1",
    pos: 20 * 50 + 20,
    body: [
      { type: TOUGH, boost: "XGHO2" },
      { type: TOUGH, boost: "XGHO2" },
      { type: ATTACK, boost: "XUH2O" },
      { type: ATTACK, boost: "XUH2O" },
      { type: ATTACK, boost: "XUH2O" },
      { type: ATTACK, boost: "XUH2O" },
      { type: HEAL, boost: "XLHO2" },
      { type: HEAL, boost: "XLHO2" },
      { type: MOVE, boost: "XZHO2" },
      { type: MOVE, boost: "XZHO2" },
    ],
    hits: 1000,
    hitsMax: 1000,
    room: "W1N1",
  };
}

function makeModerateHostile(): HostileSnapshot {
  return {
    id: "moderate-enemy",
    owner: "enemy2",
    pos: 30 * 50 + 30,
    body: [
      { type: ATTACK },
      { type: ATTACK },
      { type: MOVE },
      { type: MOVE },
    ],
    hits: 400,
    hitsMax: 400,
    room: "W1N1",
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

function makeOpenTerrain(): TerrainSnapshot {
  return {
    roomName: "W1N1",
    corePos: 25 * 50 + 25,
    rcl: 8,
    openTileCount: 2500,
    wallCount: 0,
    totalTiles: 2500,
    rampartPositions: [],
    towerPositions: [20 * 50 + 20, 30 * 50 + 30, 25 * 50 + 15],
    roadPositions: [],
    exitPositions: [0, 49, 2500, 2499],
    isWall: () => false,
    hasVision: true,
  };
}

function makeChokepointTerrain(): TerrainSnapshot {
  const isWall = (x: number, y: number): boolean => {
    if (x === 10) return y < 20 || y > 22;
    return false;
  };
  let wallCount = 0;
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (isWall(x, y)) wallCount++;
    }
  }
  return {
    roomName: "W1N1",
    corePos: 25 * 50 + 25,
    rcl: 8,
    openTileCount: 2500 - wallCount,
    wallCount,
    totalTiles: 2500,
    rampartPositions: [],
    towerPositions: [],
    roadPositions: [],
    exitPositions: [0],
    isWall,
    hasVision: true,
  };
}

function makeNoVisionTerrain(): TerrainSnapshot {
  return {
    roomName: "W1N1",
    corePos: 25 * 50 + 25,
    rcl: 8,
    openTileCount: 0,
    wallCount: 0,
    totalTiles: 2500,
    rampartPositions: [],
    towerPositions: [],
    roadPositions: [],
    exitPositions: [],
    isWall: () => false,
    hasVision: false,
  };
}

// ─── 测试 ─────────────────────────────────────────────────

describe("A5.2 Threat Integration — Terrain + Intel + Confidence", () => {
  it("T01: Enemy Strong + Open Terrain → HIGH/MEDIUM threat, terrain evidence recorded", () => {
    const terrain = buildTerrainContext(makeOpenTerrain(), TICK);
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeStrongHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
    };
    const result = assessThreat(input);

    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(result.level);
    expect(result.terrainEvidence).toBeDefined();
    expect(["OPEN", "OPEN_FIELD"]).toContain(result.terrainEvidence?.terrainType);
    expect(result.multiConfidence).toBeDefined();
    expect(result.multiConfidence?.terrainConfidence).toBeGreaterThan(0.5);
  });

  it("T02: Enemy Moderate + Chokepoint → terrain affects assessment", () => {
    const terrain = buildTerrainContext(makeChokepointTerrain(), TICK);
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeModerateHostile()],
      roomContext: makeRoomContext({ towerCount: 0 }),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
    };
    const result = assessThreat(input);

    expect(result.terrainEvidence).toBeDefined();
    // Chokepoint terrain should not be OPEN_FIELD (it has restricted passages)
    expect(result.terrainEvidence?.terrainType).not.toBe("OPEN_FIELD");
    expect(result.multiConfidence).toBeDefined();
  });

  it("T03: Enemy High Combat + Poor Retreat → terrain evidence shows poor retreat", () => {
    const terrain = buildTerrainContext(
      {
        ...makeOpenTerrain(),
        exitPositions: [0], // 只有 1 个出口 → poor retreat
      },
      TICK,
    );
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeStrongHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
    };
    const result = assessThreat(input);

    expect(result.terrainEvidence).toBeDefined();
    expect(["POOR", "CRITICAL"]).toContain(result.terrainEvidence?.retreatQuality);
  });

  it("T04: PlayerIntel Fresh → intelEvidence recorded, confidence boosted", () => {
    const terrain = buildTerrainContext(makeOpenTerrain(), TICK);
    const intel = buildPlayerIntelRecord(
      "enemy1",
      [
        makeObservedFact(TICK - 100, TICK, "Player attack with boosted military"),
        makeCombatLogFact(TICK - 50, TICK, "Combat: T3 boosted attackers"),
      ],
      TICK,
      true,
    );
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeStrongHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
      playerIntelRecord: intel,
    };
    const result = assessThreat(input);

    expect(result.intelEvidence).toBeDefined();
    expect(result.intelEvidence?.hasIntel).toBe(true);
    expect(result.intelEvidence?.threatIndex).toBeGreaterThan(50);
    expect(result.intelEvidence?.hasConflict).toBe(false);
    expect(result.multiConfidence?.intelConfidence).toBeGreaterThan(0.3);
  });

  it("T05: PlayerIntel Stale → intel confidence reduced", () => {
    const terrain = buildTerrainContext(makeOpenTerrain(), TICK);
    const freshIntel = buildPlayerIntelRecord(
      "enemy1",
      [makeObservedFact(TICK - 100, TICK, "Player attack")],
      TICK,
      false,
    );
    const staleIntel = buildPlayerIntelRecord(
      "enemy1",
      [makeObservedFact(TICK - 5000, TICK, "Player attack")],
      TICK,
      false,
    );

    const freshResult = assessThreat({
      tick: TICK,
      hostiles: [makeStrongHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
      playerIntelRecord: freshIntel,
    });
    const staleResult = assessThreat({
      tick: TICK,
      hostiles: [makeStrongHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
      playerIntelRecord: staleIntel,
    });

    // Stale intel should have lower or equal confidence
    expect(staleResult.multiConfidence?.intelConfidence)
      .toBeLessThanOrEqual(freshResult.multiConfidence?.intelConfidence ?? 1);
  });

  it("T06: Conflicting Intel → conflict recorded, confidence reduced", () => {
    const terrain = buildTerrainContext(makeOpenTerrain(), TICK);
    const conflictIntel = buildPlayerIntelRecord(
      "enemy1",
      [
        makeObservedFact(TICK - 200, TICK, "Player peaceful"),
        makeCombatLogFact(TICK - 100, TICK, "Player boosted attack"),
      ],
      TICK,
      false,
    );
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeStrongHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
      playerIntelRecord: conflictIntel,
    };
    const result = assessThreat(input);

    expect(result.intelEvidence).toBeDefined();
    expect(result.intelEvidence?.hasConflict).toBe(true);
    // Conflict should reduce overall confidence
    expect(result.multiConfidence?.intelConfidence).toBeLessThan(0.8);
  });

  it("T07: Terrain Unknown → terrainConfidence low, terrainType=UNKNOWN", () => {
    const terrain = buildTerrainContext(makeNoVisionTerrain(), TICK);
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeModerateHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
      terrainContext: terrain,
    };
    const result = assessThreat(input);

    expect(result.terrainEvidence).toBeDefined();
    expect(result.terrainEvidence?.terrainType).toBe("UNKNOWN");
    expect(result.multiConfidence?.terrainConfidence).toBeLessThanOrEqual(0.3);
  });

  it("Backward compat: no terrainContext or playerIntelRecord → still works", () => {
    const input: ThreatAssessmentInput = {
      tick: TICK,
      hostiles: [makeModerateHostile()],
      roomContext: makeRoomContext(),
      defenseContext: makeDefenseContext(),
    };
    const result = assessThreat(input);

    // Should still produce valid assessment
    expect(result.level).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.multiConfidence).toBeDefined();
    expect(result.terrainEvidence).toBeUndefined();
    expect(result.intelEvidence).toBeUndefined();
  });
});
