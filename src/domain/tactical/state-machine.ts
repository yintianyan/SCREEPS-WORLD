/**
 * Tactical State Machine — A5.4.0 纯函数。
 *
 * transitionTacticalState(): 合法状态转换。
 * evaluateTacticalAction(): 从 Snapshot 推导 TacticalDecision。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 * 输入：TacticalSnapshot / DTO。
 * 输出：TacticalDecision / Transition。
 */

import type {
  TacticalState,
  TacticalDecision,
  TacticalSnapshot,
  MovementIntent,
  CombatIntent,
  FormationType,
  RejectedTacticalAlternative,
  TacticalAbortSignal,
  TacticalAbortReason,
} from "./types";
import type { IntelConfidence } from "../defense/player-intel";
import { validateAuthorization } from "./authorization";

// ═══════════════════════════════════════════════════════════
// §1. 合法状态转换表
// ═══════════════════════════════════════════════════════════

const VALID_TACTICAL_TRANSITIONS: Record<TacticalState, readonly TacticalState[]> = {
  FORMING: ["MOVING", "ABORTED", "COMPLETED"],
  MOVING: ["POSITIONING", "ENGAGING", "RETREATING", "REGROUPING", "ABORTED"],
  POSITIONING: ["ENGAGING", "RETREATING", "REGROUPING", "ABORTED"],
  ENGAGING: ["DISENGAGING", "RETREATING", "REGROUPING", "COMPLETED", "ABORTED"],
  DISENGAGING: ["RETREATING", "REGROUPING", "ENGAGING", "ABORTED"],
  RETREATING: ["REGROUPING", "ABORTED", "COMPLETED"],
  REGROUPING: ["MOVING", "POSITIONING", "ENGAGING", "ABORTED"],
  COMPLETED: [],
  ABORTED: [],
};

export function canTransitionTactical(from: TacticalState, to: TacticalState): boolean {
  const allowed = VALID_TACTICAL_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ═══════════════════════════════════════════════════════════
// §2. evaluateTacticalAction — 核心纯函数
// ═══════════════════════════════════════════════════════════

/**
 * 从 TacticalSnapshot 推导 TacticalDecision。
 *
 * 决策链（按优先级）：
 *   1. 授权检查 → 无授权 → ABORTED
 *   2. 止损检查 → 触发止损 → 产出 AbortSignal
 *   3. 情报检查 → STALE → REGROUPING
 *   4. 敌方能力检查 → 超标 → RETREATING
 *   5. 编队完整性 → 缺人 → REGROUPING
 *   6. 治疗者检查 → healer 全灭 → DISENGAGING
 *   7. 血量检查 → 低于撤退阈值 → DISENGAGING → RETREATING
 *   8. 正常接敌 → ENGAGING
 *   9. 移动 → MOVING → POSITIONING
 *
 * 确定性：相同 Snapshot 必须产生相同 Decision。
 */
export function evaluateTacticalAction(snapshot: TacticalSnapshot): TacticalDecision {
  const { tick, squad, objective, enemies, terrain, confidence, ourPower, ourCapability } = snapshot;
  const currentState = squad.state;
  const rejected: RejectedTacticalAlternative[] = [];
  const evidence: string[] = [];

  // ── 1. 授权检查 ──
  const isOffensive = isOffensiveState(currentState);
  const authCheck = validateAuthorization(objective.authorization, tick, isOffensive);
  if (!authCheck.valid) {
    evidence.push(...authCheck.evidence);
    rejected.push({ action: "CONTINUE_ENGAGEMENT", reason: "authorization invalid" });
    return buildDecision(
      "ABORTED", "HOLD", "NONE", squad.formation,
      `authorization invalid: ${authCheck.reason}`,
      evidence, rejected, snapshot,
    );
  }
  evidence.push("authorization valid");

  // ── 2. 止损检查 ──
  const abortSignal = checkAbortConditions(snapshot);
  if (abortSignal) {
    evidence.push(...abortSignal.evidence);
    rejected.push({ action: "CONTINUE", reason: `abort: ${abortSignal.reason}` });
    return buildDecision(
      "ABORTED", "RETREAT", "NONE", squad.formation,
      `tactical abort: ${abortSignal.reason}`,
      evidence, rejected, snapshot,
    );
  }

  // ── 3. 情报新鲜度检查 ──
  const intelFreshness = assessIntelFreshness(snapshot);
  if (intelFreshness === "STALE" || intelFreshness === "EXPIRED") {
    evidence.push(`intel ${intelFreshness}: cannot continue engagement`);
    rejected.push({ action: "ENGAGE", reason: `intel ${intelFreshness}` });
    // STALE intel → regroup / reposition（不追击旧位置）
    if (canTransitionTactical(currentState, "REGROUPING")) {
      return buildDecision(
        "REGROUPING", "REGROUP", "NONE", selectFormation(snapshot, "REGROUPING"),
        `intel ${intelFreshness} → regroup for fresh intel`,
        evidence, rejected, snapshot,
      );
    }
  }
  evidence.push(`intel freshness=${intelFreshness}`);

  // ── 4. 敌方能力检查 ──
  const enemySurge = checkEnemyCapabilitySurge(snapshot);
  if (enemySurge) {
    evidence.push("enemy capability surge detected");
    rejected.push({ action: "ENGAGE", reason: "enemy capability surge" });
    if (canTransitionTactical(currentState, "RETREATING")) {
      return buildDecision(
        "RETREATING", "RETREAT", "NONE", "CLUSTER",
        "enemy capability surge → retreat",
        evidence, rejected, snapshot,
      );
    }
  }

  // ── 5. 编队完整性检查 ──
  const squadBroken = checkSquadBroken(snapshot);
  if (squadBroken) {
    evidence.push("squad broken: member count below threshold");
    rejected.push({ action: "ENGAGE", reason: "squad broken" });
    if (canTransitionTactical(currentState, "REGROUPING")) {
      return buildDecision(
        "REGROUPING", "REGROUP", "NONE", "CLUSTER",
        "squad broken → regroup",
        evidence, rejected, snapshot,
      );
    }
  }

  // ── 6. 治疗者检查 ──
  const healerLost = checkHealerLost(snapshot);
  if (healerLost && squad.engagementPolicy.healerRequired) {
    evidence.push("healer lost and healerRequired=true");
    rejected.push({ action: "ENGAGE", reason: "healer lost" });
    if (canTransitionTactical(currentState, "DISENGAGING")) {
      return buildDecision(
        "DISENGAGING", "RETREAT", "NONE", "CLUSTER",
        "healer lost → disengage",
        evidence, rejected, snapshot,
      );
    }
  }

  // ── 7. 血量检查 ──
  const avgHpRatio = computeAvgHpRatio(squad);
  if (avgHpRatio < squad.engagementPolicy.retreatThreshold) {
    evidence.push(`avgHpRatio=${avgHpRatio.toFixed(2)} < retreatThreshold=${squad.engagementPolicy.retreatThreshold}`);
    rejected.push({ action: "ENGAGE", reason: "hp below retreat threshold" });
    if (canTransitionTactical(currentState, "DISENGAGING")) {
      return buildDecision(
        "DISENGAGING", "RETREAT", "NONE", "CLUSTER",
        `hp ratio ${avgHpRatio.toFixed(2)} below retreat threshold`,
        evidence, rejected, snapshot,
      );
    }
    if (canTransitionTactical(currentState, "RETREATING")) {
      return buildDecision(
        "RETREATING", "RETREAT", "NONE", "CLUSTER",
        `hp ratio ${avgHpRatio.toFixed(2)} below retreat threshold`,
        evidence, rejected, snapshot,
      );
    }
  }

  // ── 8. 正常接敌 / 移动 / 集结 ──
  switch (currentState) {
    case "FORMING": {
      // 检查编队是否满编
      const shortage = checkForceShortage(snapshot);
      if (shortage) {
        evidence.push(`force shortage: ${shortage}`);
        // 未满编但可以开始移动（部分编队）
      }
      const formation = selectFormation(snapshot, "MOVING");
      evidence.push(`forming complete, formation=${formation}`);
      return buildDecision(
        "MOVING", "ADVANCE", "NONE", formation,
        "squad formed → advance",
        evidence, rejected, snapshot,
      );
    }

    case "MOVING": {
      // 检查是否到达目标房
      const inTargetRoom = checkInTargetRoom(snapshot);
      if (inTargetRoom) {
        evidence.push("arrived at target room");
        const formation = selectFormation(snapshot, "POSITIONING");
        return buildDecision(
          "POSITIONING", "POSITION", "NONE", formation,
          "arrived → position for engagement",
          evidence, rejected, snapshot,
        );
      }
      evidence.push("in transit");
      return buildDecision(
        "MOVING", "ADVANCE", "NONE", "COLUMN",
        "advancing to target room",
        evidence, rejected, snapshot,
      );
    }

    case "POSITIONING": {
      // 检查是否有敌人在接敌范围内
      const target = selectEngagementTarget(snapshot);
      if (target) {
        evidence.push(`engagement target selected: ${target.id}`);
        const formation = selectFormation(snapshot, "ENGAGING");
        return buildDecision(
          "ENGAGING", "ADVANCE", determineCombatIntent(snapshot, target.id),
          formation, `engaging target ${target.id}`,
          evidence, rejected, snapshot, target.id,
        );
      }
      evidence.push("no enemy in range, holding position");
      return buildDecision(
        "POSITIONING", "HOLD", "NONE", squad.formation,
        "holding position, awaiting enemy",
        evidence, rejected, snapshot,
      );
    }

    case "ENGAGING": {
      // 选择当前最优目标
      const target = selectEngagementTarget(snapshot);
      if (target) {
        evidence.push(`engaging target: ${target.id}`);
        const formation = selectFormation(snapshot, "ENGAGING");
        return buildDecision(
          "ENGAGING", "HOLD", determineCombatIntent(snapshot, target.id),
          formation, `engaged with ${target.id}`,
          evidence, rejected, snapshot, target.id,
        );
      }
      // 无敌人 → 检查目标是否完成
      const objComplete = checkObjectiveComplete(snapshot);
      if (objComplete) {
        evidence.push("objective complete");
        return buildDecision(
          "COMPLETED", "HOLD", "NONE", squad.formation,
          "objective completed",
          evidence, rejected, snapshot,
        );
      }
      evidence.push("no enemy in range");
      return buildDecision(
        "ENGAGING", "ADVANCE", "NONE", squad.formation,
        "no enemy in range, advancing",
        evidence, rejected, snapshot,
      );
    }

    case "DISENGAGING": {
      // 检查是否成功脱离
      const disengaged = checkDisengaged(snapshot);
      if (disengaged) {
        evidence.push("successfully disengaged");
        if (canTransitionTactical("DISENGAGING", "RETREATING")) {
          return buildDecision(
            "RETREATING", "RETREAT", "NONE", "CLUSTER",
            "disengaged → retreating",
            evidence, rejected, snapshot,
          );
        }
      }
      evidence.push("still disengaging");
      return buildDecision(
        "DISENGAGING", "RETREAT", "NONE", "CLUSTER",
        "disengaging from combat",
        evidence, rejected, snapshot,
      );
    }

    case "RETREATING": {
      // 检查是否到达安全房
      const safe = checkInSafeRoom(snapshot);
      if (safe) {
        evidence.push("reached safe room");
        return buildDecision(
          "REGROUPING", "REGROUP", "NONE", "CLUSTER",
          "reached safe room → regroup",
          evidence, rejected, snapshot,
        );
      }
      evidence.push("retreating");
      return buildDecision(
        "RETREATING", "RETREAT", "NONE", "CLUSTER",
        "retreating to safe room",
        evidence, rejected, snapshot,
      );
    }

    case "REGROUPING": {
      // 检查是否重新集结完毕
      const regrouped = checkRegrouped(snapshot);
      if (regrouped) {
        evidence.push("regroup complete");
        const formation = selectFormation(snapshot, "MOVING");
        return buildDecision(
          "MOVING", "ADVANCE", "NONE", formation,
          "regrouped → advance",
          evidence, rejected, snapshot,
        );
      }
      evidence.push("regrouping");
      return buildDecision(
        "REGROUPING", "REGROUP", "NONE", "CLUSTER",
        "regrouping in progress",
        evidence, rejected, snapshot,
      );
    }

    case "COMPLETED":
      return buildDecision(
        "COMPLETED", "HOLD", "NONE", squad.formation,
        "already completed",
        evidence, rejected, snapshot,
      );

    case "ABORTED":
      return buildDecision(
        "ABORTED", "RETREAT", "NONE", squad.formation,
        "already aborted",
        evidence, rejected, snapshot,
      );

    default:
      return buildDecision(
        currentState, "HOLD", "NONE", squad.formation,
        `unknown state ${currentState}`,
        evidence, rejected, snapshot,
      );
  }
}

// ═══════════════════════════════════════════════════════════
// §3. 辅助检查函数
// ═══════════════════════════════════════════════════════════

function isOffensiveState(state: TacticalState): boolean {
  return state === "ENGAGING" || state === "DISENGAGING" || state === "MOVING";
}

function checkAbortConditions(snapshot: TacticalSnapshot): TacticalAbortSignal | null {
  const { squad, objective, tick, confidence } = snapshot;
  const reasons: TacticalAbortReason[] = [];
  const evidence: string[] = [];

  // CASUALTY_EXCEEDED: 伤亡超限
  const aliveCount = squad.members.filter(m => m.hits > 0).length;
  const totalCount = squad.members.length;
  const aliveRatio = totalCount > 0 ? aliveCount / totalCount : 0;
  if (aliveRatio < squad.regroupPolicy.memberRatioThreshold) {
    reasons.push("CASUALTY_EXCEEDED");
    evidence.push(`aliveRatio=${aliveRatio.toFixed(2)} < threshold=${squad.regroupPolicy.memberRatioThreshold}`);
  }

  // INTEL_STALE: 情报过期
  const overallConf = confidence.overallConfidence;
  if (overallConf < objective.constraints.minIntelConfidence) {
    reasons.push("INTEL_STALE");
    evidence.push(`confidence=${overallConf.toFixed(2)} < min=${objective.constraints.minIntelConfidence}`);
  }

  // AUTHORIZATION_REVOKED
  if (objective.authorization.operationAborted) {
    reasons.push("AUTHORIZATION_REVOKED");
    evidence.push("operation aborted");
  }

  // LOGISTICS_FAILURE: 后勤失败（简化检查——通过 confidence 判断）
  if (overallConf < 0.1) {
    reasons.push("LOGISTICS_FAILURE");
    evidence.push("confidence near zero → logistics failure suspected");
  }

  if (reasons.length === 0) return null;

  return {
    signalId: `tac-abort:${squad.squadId}:${tick}`,
    operationId: objective.operationId,
    objectiveId: objective.objectiveId,
    squadId: squad.squadId,
    reason: reasons[0]!,
    tick,
    detail: reasons.join("; "),
    evidence,
  };
}

function assessIntelFreshness(snapshot: TacticalSnapshot): "FRESH" | "RECENT" | "STALE" | "EXPIRED" {
  const { enemies, tick, confidence } = snapshot;

  if (enemies.length === 0) return "FRESH"; // 无敌人不需要情报

  // 检查最近观测时间
  const maxAge = Math.max(0, ...enemies.map(e => tick - e.lastSeenTick));

  if (maxAge <= 500) return "FRESH";
  if (maxAge <= 2000) return "RECENT";
  if (maxAge <= 10000) return "STALE";
  return "EXPIRED";
}

function checkEnemyCapabilitySurge(snapshot: TacticalSnapshot): boolean {
  const { enemies, ourPower, squad } = snapshot;
  if (enemies.length === 0) return false;

  const enemyTotalAttack = enemies.reduce((s, e) => s + e.capability.attack + e.capability.rangedAttack, 0);
  const enemyTotalHeal = enemies.reduce((s, e) => s + e.capability.heal, 0);
  const enemyTotalHP = enemies.reduce((s, e) => s + e.capability.effectiveHP, 0);

  // 敌方能力显著超过我方 → surge
  const ourBurst = ourPower.burstDamage;
  const ourHP = ourPower.effectiveHP;
  const ourHeal = ourPower.healOutput;

  // 敌方攻击力超过我方治疗+HP 的 1.5 倍 → surge
  if (enemyTotalAttack > (ourHeal + ourHP * 0.1) * 1.5) return true;

  // 敌方治疗力超过我方攻击力的 1.5 倍 → surge（打不动）
  if (enemyTotalHeal > ourBurst * 1.5) return true;

  // 敌方总 HP 超过我方总伤害的 10 倍 → surge（消耗战不利）
  if (enemyTotalHP > ourBurst * 10) return true;

  return false;
}

function checkSquadBroken(snapshot: TacticalSnapshot): boolean {
  const { squad } = snapshot;
  const aliveCount = squad.members.filter(m => m.hits > 0).length;
  const totalCount = squad.members.length;
  if (totalCount === 0) return true;
  const ratio = aliveCount / totalCount;
  return ratio < squad.regroupPolicy.memberRatioThreshold;
}

function checkHealerLost(snapshot: TacticalSnapshot): boolean {
  const { squad } = snapshot;
  const healers = squad.members.filter(m => m.role === "healer" && m.hits > 0);
  return healers.length === 0;
}

function computeAvgHpRatio(squad: { members: readonly { hits: number; hitsMax: number }[] }): number {
  if (squad.members.length === 0) return 0;
  const totalRatio = squad.members.reduce((s, m) => {
    return s + (m.hitsMax > 0 ? m.hits / m.hitsMax : 0);
  }, 0);
  return totalRatio / squad.members.length;
}

function checkInTargetRoom(snapshot: TacticalSnapshot): boolean {
  const { squad, objective } = snapshot;
  return squad.members.every(m => m.room === objective.authorization.targetRoom);
}

function checkInSafeRoom(snapshot: TacticalSnapshot): boolean {
  const { squad } = snapshot;
  return squad.members.every(m => m.room === squad.retreatPolicy.retreatRoom);
}

function checkDisengaged(snapshot: TacticalSnapshot): boolean {
  const { enemies, squad } = snapshot;
  if (enemies.length === 0) return true;
  // 所有敌人距离 > 3 格视为脱离
  return enemies.every(e => {
    return squad.members.every(m => {
      return Math.abs(Math.floor(e.pos / 50) - Math.floor(m.pos / 50)) > 3
        || Math.abs(e.pos % 50 - m.pos % 50) > 3;
    });
  });
}

function checkRegrouped(snapshot: TacticalSnapshot): boolean {
  const { squad, tick } = snapshot;
  const aliveMembers = squad.members.filter(m => m.hits > 0);
  if (aliveMembers.length === 0) return false;
  // 所有存活成员在集结房
  const allInRegroupRoom = aliveMembers.every(m => m.room === squad.regroupPolicy.regroupRoom);
  // 未超时
  const notTimedOut = tick - squad.createdTick < squad.regroupPolicy.timeoutTicks;
  return allInRegroupRoom && notTimedOut;
}

function checkObjectiveComplete(snapshot: TacticalSnapshot): boolean {
  const { objective, enemies, enemyStructures } = snapshot;

  // 目标类型判断
  if (objective.objectiveType === "ENGAGE_ENEMY") {
    return enemies.length === 0;
  }
  if (objective.objectiveType === "DESTROY_STRUCTURE") {
    // 目标建筑已被摧毁
    return !enemyStructures.some(s => s.id === objective.targetId);
  }
  if (objective.objectiveType === "HOLD_GROUND") {
    // 据守目标——时间未到即完成不了
    return false;
  }
  // 默认：无敌人即完成
  return enemies.length === 0;
}

function checkForceShortage(snapshot: TacticalSnapshot): string | null {
  const { squad } = snapshot;
  const aliveMembers = squad.members.filter(m => m.hits > 0);
  const roles = new Set(aliveMembers.map(m => m.role));
  if (!roles.has("attacker") && !roles.has("ranged")) {
    return "no damage dealers";
  }
  if (squad.engagementPolicy.healerRequired && !roles.has("healer")) {
    return "no healer";
  }
  return null;
}

function selectEngagementTarget(snapshot: TacticalSnapshot): { id: string } | null {
  const { enemies, enemyStructures, objective, squad } = snapshot;

  // 优先级：focus target > 敌方 creep > 敌方建筑
  if (squad.engagementPolicy.focusTargetId) {
    const focus = enemies.find(e => e.id === squad.engagementPolicy.focusTargetId)
      ?? enemyStructures.find(s => s.id === squad.engagementPolicy.focusTargetId);
    if (focus) return { id: focus.id };
  }

  // 目标类型决定候选池
  if (objective.objectiveType === "DESTROY_STRUCTURE" || objective.objectiveType === "DISMANTLE") {
    // 按 valueTier 降序 → hits 升序（集火残血）→ 确定性排序
    const sorted = [...enemyStructures].sort((a, b) => {
      if (b.valueTier !== a.valueTier) return b.valueTier - a.valueTier;
      // 同档内优先拆受伤者
      const damageA = a.hitsMax - a.hits;
      const damageB = b.hitsMax - b.hits;
      if (damageB !== damageA) return damageB - damageA;
      // 确定性 tie-break: ID 字典序
      return a.id < b.id ? -1 : 1;
    });
    return sorted.length > 0 ? { id: sorted[0]!.id } : null;
  }

  // 默认：选择敌方 creep
  // 排序：最脆优先（effectiveHP 升序）→ 治疗者优先 → 近距优先 → ID tie-break
  const sorted = [...enemies].sort((a, b) => {
    // 治疗者优先
    const aHealer = a.capability.heal > 0;
    const bHealer = b.capability.heal > 0;
    if (aHealer && !bHealer) return -1;
    if (!aHealer && bHealer) return 1;

    // 最脆优先
    const aHP = a.capability.effectiveHP;
    const bHP = b.capability.effectiveHP;
    if (aHP !== bHP) return aHP - bHP;

    // 确定性 tie-break: ID 字典序
    return a.id < b.id ? -1 : 1;
  });

  return sorted.length > 0 ? { id: sorted[0]!.id } : null;
}

function determineCombatIntent(snapshot: TacticalSnapshot, targetId: string): CombatIntent {
  const { enemies, enemyStructures, squad } = snapshot;

  // 查找目标
  const enemyCreep = enemies.find(e => e.id === targetId);
  const enemyStruct = enemyStructures.find(s => s.id === targetId);

  if (enemyCreep) {
    // 判断角色：healer → heal, attacker → attack, ranged → rangedAttack
    const myRole = squad.members.find(m => m.hits > 0)?.role;
    if (myRole === "healer") return "HEAL";
    if (myRole === "ranged") return "RANGED_ATTACK";
    return "ATTACK";
  }

  if (enemyStruct) {
    // 建筑 → dismantle 或 attack
    const myRole = squad.members.find(m => m.hits > 0)?.role;
    if (myRole === "dismantler") return "DISMANTLE";
    return "ATTACK";
  }

  return "NONE";
}

function selectFormation(snapshot: TacticalSnapshot, nextState: TacticalState): FormationType {
  const { terrain } = snapshot;

  // 撤退/重新集结 → CLUSTER
  if (nextState === "RETREATING" || nextState === "REGROUPING" || nextState === "DISENGAGING") {
    return "CLUSTER";
  }

  // 行军 → COLUMN（适合跨房和狭窄通道）
  if (nextState === "MOVING") {
    return "COLUMN";
  }

  // 接敌/阵位 → 根据地形选择
  if (nextState === "ENGAGING" || nextState === "POSITIONING") {
    switch (terrain.terrainType) {
      case "OPEN":
      case "OPEN_FIELD":
        return "WEDGE";
      case "CHOKEPOINT":
      case "CORRIDOR":
      case "CONFINED":
        return "COLUMN";
      case "FORTIFIED":
      case "CORE_DEFENSE":
        return "LINE";
      default:
        return "CLUSTER"; // UNKNOWN → 保守密集
    }
  }

  return "CLUSTER";
}

// ═══════════════════════════════════════════════════════════
// §4. Decision Builder + Hash
// ═══════════════════════════════════════════════════════════

function buildDecision(
  newState: TacticalState,
  movementIntent: MovementIntent,
  combatIntent: CombatIntent,
  formation: FormationType,
  reason: string,
  evidence: string[],
  rejected: readonly RejectedTacticalAlternative[],
  snapshot: TacticalSnapshot,
  targetId?: string,
): TacticalDecision {
  const decision: TacticalDecision = {
    newState,
    movementIntent,
    combatIntent,
    targetId,
    formation,
    reason,
    evidence,
    rejectedAlternatives: rejected,
    decisionHash: "",
  };

  return { ...decision, decisionHash: tacticalDecisionHash(decision, snapshot) };
}

/**
 * 计算决策 Hash — 确定性验证。
 *
 * 相同 Snapshot + 相同 Decision → 相同 Hash。
 */
export function tacticalDecisionHash(decision: TacticalDecision, snapshot: TacticalSnapshot): string {
  const payload = JSON.stringify({
    state: decision.newState,
    move: decision.movementIntent,
    combat: decision.combatIntent,
    target: decision.targetId ?? "",
    formation: decision.formation,
    squadId: snapshot.squad.squadId,
    objId: snapshot.objective.objectiveId,
    tick: snapshot.tick,
    enemyCount: snapshot.enemies.length,
    structCount: snapshot.enemyStructures.length,
    avgHp: computeAvgHpRatio(snapshot.squad).toFixed(2),
    confidence: snapshot.confidence.overallConfidence.toFixed(2),
  });

  return fnv1a32Hex(payload);
}

function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
