/**
 * Squad Movement Runtime — A5.4.2 系统层薄壳。
 *
 * 合同锚点：A5.4.2 §9 PathFinder Boundary + §10 Movement Execution。
 *
 * 职责（薄壳——只采集和编排，不做决策）：
 *   1. 从 globalCache / Game 采集 Squad 成员运行时状态
 *   2. 构建 SquadSnapshot（纯函数输入格式）
 *   3. 调用 domain 纯函数 produceSquadMovementIntent() → SquadMovementIntent
 *   4. 将 SquadMovementIntent 翻译为实际移动指令：
 *      a. Path Leader 走 PathFinder 共享路径（只算一次，其他成员跟随）
 *      b. 其他成员走 Formation Slot（registerMove 到 DesiredPosition）
 *   5. 编队级 Stuck Detection（Anchor 连续未前进 → Recovery）
 *
 * 禁止：
 *   - 不做任何战术决策（决策由 domain 纯函数裁决）
 *   - 不直接调用 attack() / heal()（那些是角色层职责）
 *   - 不修改 domain 层纯函数的输入/输出结构
 *
 * 频率：interval=1（每 tick 运行——编队移动需要每 tick 执行路径）
 * 优先级：P2（在 tactical-runtime 之后运行，消费其产出的 RoleActionIntent）
 * 阶段：main（在角色之前——先产出 SquadMovementIntent 供角色消费）
 * 存储：heap only — global reset 可丢（下个周期重建）。
 *
 * PathFinder 边界（A5.4.2 §9）：
 *   - Domain 层绝不调用 PathFinder / moveTo / registerMove
 *   - 本模块是唯一允许调用 PathFinder 的编队移动模块
 *   - Path Leader 算一条共享路径，其他成员沿路径方向走 Formation Slot
 *   - 每房每 tick 最多 1 次 PathFinder.search（编队共享）
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import { globalCache, querySquad, type GlobalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";
import {
  buildSquadSnapshot,
  produceSquadMovementIntent,
  detectSquadStuck,
  type SquadMemberRuntimeSnapshot,
  type SquadMovementIntent,
  type FormationAnchor,
  type FormationSlot,
  type SquadStuckDetection,
} from "../domain/tactical";
import type { TerrainContext } from "../domain/defense/terrain-context";
import type {
  SquadPlan,
  TacticalState,
  FormationType,
} from "../domain/tactical/types";
import { registerMove, registerAnchor, movePriorityFor, trafficEnabled } from "../creeps/movement/intent";
import { moveToTarget, moveTowardRoom } from "../creeps/movement/pathfinding";
import { packPos } from "../creeps/movement/traffic";
import { recordSkip } from "../kernel/memory";

// ═══════════════════════════════════════════════════════════
// §1. GlobalCache 扩展 — Squad Movement Runtime 状态
// ═══════════════════════════════════════════════════════════

/** Squad Movement Runtime 在 globalCache 上的扩展字段。 */
interface SquadMovementCache {
  /** 当前 tick 的 SquadMovementIntent（供角色层消费）。key = squadId。 */
  squadMovementIntents?: Map<string, SquadMovementIntent>;
  /** 上 tick Anchor 位置（编队级 Stuck Detection 用）。key = squadId。 */
  prevAnchorPos?: Map<string, number>;
  /** Anchor 连续未前进 tick 数。key = squadId。 */
  anchorStuckTicks?: Map<string, number>;
  /** 共享路径缓存（per-tick）。key = squadId。 */
  squadSharedPaths?: Map<string, RoomPosition[]>;
  /** 上次运行 tick。 */
  squadMovementLastRunTick?: number;
}

// ═══════════════════════════════════════════════════════════
// §2. 系统定义
// ═══════════════════════════════════════════════════════════

export const squadMovementSystem: System = {
  name: "squad-movement",
  priority: 2 as Priority,
  interval: 1,
  phase: "main",

  run(ctx: TickContext): void {
    const g = globalCache() as unknown as GlobalCache & SquadMovementCache;
    const tick = ctx.tick;

    // ── 1. 初始化缓存 ──
    if (!g.squadMovementIntents) g.squadMovementIntents = new Map();
    if (!g.prevAnchorPos) g.prevAnchorPos = new Map();
    if (!g.anchorStuckTicks) g.anchorStuckTicks = new Map();
    if (!g.squadSharedPaths) g.squadSharedPaths = new Map();

    // 每 tick 重置 per-tick 数据
    g.squadMovementIntents.clear();
    g.squadSharedPaths.clear();

    // ── 2. 无 warPlan 时跳过 ──
    const plan = Memory.kernel?.warPlan;
    if (!plan) {
      g.squadMovementLastRunTick = tick;
      return;
    }

    // ── 3. 构建 SquadPlan（复用 tactical-runtime 的构建逻辑） ──
    const squadPlan = buildSquadPlanFromWarPlan(plan, tick);
    if (!squadPlan) {
      g.squadMovementLastRunTick = tick;
      return;
    }

    // ── 4. 采集成员运行时数据 ──
    const runtimeMembers = collectRuntimeMembers(squadPlan);
    if (runtimeMembers.length === 0) {
      g.squadMovementLastRunTick = tick;
      return;
    }

    // ── 5. 构建 SquadSnapshot ──
    const targetRoom = plan.targetRoom;
    const targetPos = undefined; // 无精确目标位置（Objective 相对模式由 domain 决策）
    const terrain = buildDefaultTerrain(targetRoom, tick);
    const squadSnapshot = buildSquadSnapshot(
      squadPlan,
      runtimeMembers,
      tick,
      targetRoom,
      targetPos,
    );

    // ── 6. 调用纯函数产出 SquadMovementIntent ──
    const intent = produceSquadMovementIntent(squadSnapshot, squadPlan.state, terrain);

    // ── 7. 编队级 Stuck Detection ──
    const prevPos = g.prevAnchorPos.get(squadPlan.squadId);
    const prevStuck = g.anchorStuckTicks.get(squadPlan.squadId) ?? 0;
    const stuckDetection = detectSquadStuck(
      squadSnapshot,
      intent.anchor,
      prevPos,
      prevStuck,
    );

    // 更新 stuck 跟踪
    g.prevAnchorPos.set(squadPlan.squadId, intent.anchor.pos);
    g.anchorStuckTicks.set(squadPlan.squadId, stuckDetection.anchorStuckTicks);

    // ── 8. Stuck Recovery ──
    if (stuckDetection.level === "SQUAD_HEAVY" || stuckDetection.level === "SQUAD_BLOCKED") {
      // 严重卡位 — 清除共享路径，下 tick 重算
      g.squadSharedPaths.delete(squadPlan.squadId);
      recordSkip("squad-movement/stuck");
      console.log(
        `[${tick}] squad-movement: ${stuckDetection.level} for squad=${squadPlan.squadId}` +
        ` stuckTicks=${stuckDetection.anchorStuckTicks} reason="${stuckDetection.reason}"`,
      );
    }

    // ── 9. 执行移动（PathFinder boundary） ──
    executeSquadMovement(intent, stuckDetection);

    // ── 10. 写入缓存供角色层消费 ──
    g.squadMovementIntents.set(squadPlan.squadId, intent);

    g.squadMovementLastRunTick = tick;
  },
};

// ═══════════════════════════════════════════════════════════
// §3. 移动执行 — PathFinder Boundary
// ═══════════════════════════════════════════════════════════

/**
 * 执行编队移动 — 将 SquadMovementIntent 翻译为实际移动指令。
 *
 * 核心策略（A5.4.2 §9-10）：
 *   1. Path Leader 走 PathFinder 共享路径（只算一次）
 *   2. 其他成员沿共享路径方向走 Formation Slot
 *   3. 跨房时 Path Leader 走 moveTowardRoom，其他成员跟随
 *   4. ENGAGING 状态时不大范围移动（维持阵位）
 *   5. Cohesion BROKEN 时全员走 Regroup 点（CLUSTER 阵型）
 *
 * PathFinder 边界：
 *   - Domain 层只产出 Intent（DesiredPosition），不调 PathFinder
 *   - 本模块是唯一调 PathFinder 的编队移动模块
 *   - 共享路径：Path Leader 算一次，其他成员复用
 */
function executeSquadMovement(
  intent: SquadMovementIntent,
  stuck: SquadStuckDetection,
): void {
  const { anchor, slots, destination, destinationRoom, cohesion } = intent;

  // 无存活成员 — 无需移动
  if (cohesion.aliveCount === 0) return;

  // ENGAGING 状态 — 不大范围移动，维持阵位
  // 只有严重卡位时才强制重算路径
  if (intent.mode === "OBJECTIVE_RELATIVE" && cohesion.status === "INTACT" && stuck.level === "NONE") {
    // 阵型完整且无卡位 — 只微调成员到 DesiredPosition
    adjustMembersToSlots(slots);
    return;
  }

  // Path Leader — 走共享路径
  const leaderName = anchor.pathLeader;
  if (!leaderName) return;

  const leaderCreep = Game.creeps[leaderName];
  if (!leaderCreep) return;

  // 检查是否需要跨房移动
  const leaderInDestRoom = leaderCreep.pos.roomName === destinationRoom;

  if (!leaderInDestRoom) {
    // 跨房移动 — Path Leader 走 moveTowardRoom
    moveTowardRoom(leaderCreep, destinationRoom);

    // 其他成员跟随 Path Leader 的方向（走向同一目标房）
    for (const slot of slots) {
      if (slot.creepName === leaderName) continue;
      const creep = Game.creeps[slot.creepName];
      if (!creep) continue;
      if (creep.pos.roomName === destinationRoom) continue; // 已在目标房
      if (creep.fatigue > 0) continue;
      moveTowardRoom(creep, destinationRoom);
    }
  } else {
    // 同房移动 — Path Leader 走 PathFinder 到目标位置
    const destPos = new RoomPosition(
      Math.floor(destination / 50),
      destination % 50,
      destinationRoom,
    );

    // Path Leader 走 moveToTarget（复用现有三级缓存机制）
    moveToTarget(leaderCreep, destPos, intent.tolerance);

    // 其他成员 — 走 Formation Slot（DesiredPosition）
    adjustMembersToSlots(slots);
  }
}

/**
 * 将成员调整到 Formation Slot（DesiredPosition）。
 *
 * 每个成员走 registerMove 到自己的 DesiredPosition。
 * Traffic Manager 在 tick 末仲裁。
 *
 * 不调 PathFinder — 只走单步方向（getDirectionTo + registerMove）。
 * 长距离移动由 Path Leader 的 moveToTarget 处理。
 */
function adjustMembersToSlots(
  slots: readonly FormationSlot[],
): void {
  for (const slot of slots) {
    const creep = Game.creeps[slot.creepName];
    if (!creep) continue;
    if (creep.fatigue > 0) continue;

    // 成员已在 DesiredPosition — 锚定不动
    const currentPacked = packPos(creep.pos);
    if (currentPacked === slot.desiredPosition && creep.pos.roomName === slot.desiredRoom) {
      // 锚定 — 拒绝被推挤
      if (trafficEnabled()) {
        registerAnchor(creep, slot.priority);
      }
      continue;
    }

    // 跨房成员 — 不在同房时走 moveTowardRoom
    if (creep.pos.roomName !== slot.desiredRoom) {
      moveTowardRoom(creep, slot.desiredRoom);
      continue;
    }

    // 同房 — 走 registerMove 到 DesiredPosition
    const dx = Math.floor(slot.desiredPosition / 50) - creep.pos.x;
    const dy = (slot.desiredPosition % 50) - creep.pos.y;

    // 紧邻目标 — 单步直走
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      if (dx === 0 && dy === 0) continue;
      const dir = creep.pos.getDirectionTo(
        creep.pos.x + dx,
        creep.pos.y + dy,
      );
      if (dir !== null) {
        registerMove(creep, dir, movePriorityFor(creep));
      }
    } else {
      // 远距离 — 走 moveToTarget（有缓存机制）
      const targetPos = new RoomPosition(
        Math.floor(slot.desiredPosition / 50),
        slot.desiredPosition % 50,
        slot.desiredRoom,
      );
      moveToTarget(creep, targetPos, slot.tolerance);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// §4. SquadPlan 构建（复用 tactical-runtime 逻辑）
// ═══════════════════════════════════════════════════════════

/**
 * 从 warPlan + globalCache.squadIndex 构建 SquadPlan。
 *
 * 复用 tactical-runtime-system 的构建逻辑，但简化为只取编队信息。
 */
function buildSquadPlanFromWarPlan(
  plan: NonNullable<KernelMemory["warPlan"]>,
  tick: number,
): SquadPlan | null {
  const squadEntries = querySquad({
    home: plan.sponsor,
    remoteTarget: plan.targetRoom,
  });

  if (squadEntries.length === 0) return null;

  // 过滤出 attacker / healer（PB 野采编队跳过）
  const combatEntries = squadEntries.filter(
    e => (e.role === "attacker" || e.role === "healer") && e.mission !== "powerBank",
  );

  if (combatEntries.length === 0) return null;

  const members = combatEntries.map(entry => {
    const creep = Game.creeps[entry.name];
    return {
      name: entry.name,
      role: entry.role,
      pos: creep ? creep.pos.y * 50 + creep.pos.x : 25 * 50 + 25,
      room: creep ? creep.pos.roomName : plan.sponsor,
      hits: creep ? creep.hits : 0,
      hitsMax: creep ? creep.hitsMax : 0,
      boosted: entry.boosted,
      ticksToLive: creep?.ticksToLive,
      capability: {
        attack: 0, rangedAttack: 0, heal: 0, rangedHeal: 0,
        dismantle: 0, claim: 0, effectiveHP: creep?.hits ?? 0,
        mobility: 0, support: 0, toughParts: 0,
        boosted: entry.boosted, maxBoostTier: 0 as 0 | 1 | 2 | 3,
        totalParts: 0, activeParts: 0,
      },
    };
  });

  if (members.length === 0) return null;

  const roles = new Map<string, string>();
  for (const m of members) roles.set(m.name, m.role);

  return {
    squadId: `squad-${plan.sponsor}-${plan.targetRoom}`,
    operationId: `war-${plan.targetRoom}`,
    objectiveId: `tac-${plan.targetRoom}-${plan.since}`,
    members,
    roles,
    formation: "CLUSTER" as FormationType,
    engagementPolicy: {
      engageRange: 3,
      focusTargetId: undefined,
      minimumHpThreshold: 50,
      retreatThreshold: CONFIG.war.retreatRatio,
      regroupThreshold: CONFIG.war.waveRegroupRatio,
      healerRequired: true,
      enemyCapability: {
        totalAttack: 0, totalRangedAttack: 0, totalHeal: 0,
        totalRangedHeal: 0, totalDismantle: 0, totalClaim: 0,
        totalEffectiveHP: 0, avgMobility: 0, totalSupport: 0,
        totalToughParts: 0, boostedCount: 0, maxBoostTier: 0,
        creepCount: 0,
      },
      terrainRisk: 0.5,
      confidence: 0.5,
    },
    retreatPolicy: {
      retreatRoom: plan.sponsor,
      threshold: CONFIG.war.retreatRatio,
      minRetreatQuality: "POOR",
      allowRearguard: false,
    },
    regroupPolicy: {
      regroupRoom: plan.sponsor,
      regroupPos: 25 * 50 + 25,
      memberRatioThreshold: CONFIG.war.waveRegroupRatio,
      timeoutTicks: 500,
    },
    constraints: {
      maxCpuPerTick: 5,
      maxEnergyBudget: 10000,
      maxDuration: CONFIG.war.planTimeout,
      minIntelConfidence: 0.2,
      allowBoost: true,
      allowPursuit: false,
      maxPursuitDistance: 0,
    },
    state: deriveTacticalStateFromPhase(plan.phase ?? "build"),
    createdTick: plan.since,
  };
}

/** 从 warPlan phase 推导初始 TacticalState。 */
function deriveTacticalStateFromPhase(phase: string): TacticalState {
  if (phase === "build") return "FORMING";
  if (phase === "advance") return "MOVING";
  return "FORMING";
}

// ═══════════════════════════════════════════════════════════
// §5. 运行时成员采集
// ═══════════════════════════════════════════════════════════

/**
 * 从 Game.creeps 采集编队成员的运行时快照。
 */
function collectRuntimeMembers(squad: SquadPlan): SquadMemberRuntimeSnapshot[] {
  const result: SquadMemberRuntimeSnapshot[] = [];

  for (const member of squad.members) {
    const creep = Game.creeps[member.name];
    if (!creep) {
      // Creep 不存在 — 标记为死亡
      result.push({
        name: member.name,
        role: member.role,
        pos: member.pos,
        room: member.room,
        hits: 0,
        hitsMax: member.hitsMax,
        fatigue: 0,
        ticksToLive: 0,
        alive: false,
        boosted: member.boosted,
      });
      continue;
    }

    result.push({
      name: member.name,
      role: member.role,
      pos: creep.pos.y * 50 + creep.pos.x,
      room: creep.pos.roomName,
      hits: creep.hits,
      hitsMax: creep.hitsMax,
      fatigue: creep.fatigue,
      ticksToLive: creep.ticksToLive,
      alive: creep.hits > 0,
      boosted: member.boosted,
      capability: {
        attack: 0,
        rangedAttack: 0,
        heal: 0,
        effectiveHP: creep.hits,
      },
    });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// §6. 默认地形上下文
// ═══════════════════════════════════════════════════════════

/**
 * 构建默认 TerrainContext（简化版——完整版由 defense-planner 产出）。
 */
function buildDefaultTerrain(roomName: string, tick: number): TerrainContext {
  return {
    roomName,
    terrainType: "UNKNOWN",
    walkability: "UNKNOWN",
    openTileRatio: 0.5,
    wallDensity: 0.5,
    chokepoints: [],
    corridors: [],
    rampartCoverage: "UNKNOWN",
    towerCoverage: "UNKNOWN",
    coreExposure: 0.5,
    retreatQuality: "UNKNOWN",
    mobilityModifier: 1.0,
    tick,
  };
}

// ═══════════════════════════════════════════════════════════
// §7. 公共 API（供角色层查询）
// ═══════════════════════════════════════════════════════════

/**
 * 查询编队的移动意图（供角色层消费）。
 *
 * 角色层（attacker/healer）在 RolePolicy 中调用此函数，
 * 获取当前 tick 的编队移动指令（Formation Slot + 移动模式）。
 *
 * 如果返回 null，角色回退到原有行为（Legacy 兼容）。
 */
export function getSquadMovementIntent(squadId: string): SquadMovementIntent | null {
  const g = globalCache() as unknown as GlobalCache & SquadMovementCache;
  const intents = g.squadMovementIntents;
  if (!intents) return null;
  return intents.get(squadId) ?? null;
}

/**
 * 查询 creep 的 Formation Slot（供角色层消费）。
 *
 * 返回该 creep 在编队中的期望位置和移动指令。
 * 如果返回 null，角色回退到原有行为。
 */
export function getCreepFormationSlot(
  creepName: string,
): { slot: FormationSlot; intent: SquadMovementIntent } | null {
  const g = globalCache() as unknown as GlobalCache & SquadMovementCache;
  const intents = g.squadMovementIntents;
  if (!intents) return null;

  for (const [, intent] of intents) {
    const slot = intent.slots.find(s => s.creepName === creepName);
    if (slot) return { slot, intent };
  }
  return null;
}

