/** Tower 交战盈亏判定 — 纯函数。 */

/** 塔满伤（range ≤ TOWER_OPTIMAL_RANGE）。 */
const TOWER_POWER_ATTACK = 600;
/** 满伤距离上限。 */
const TOWER_OPTIMAL_RANGE = 5;
/** 衰减终点距离（≥ 此距离伤害不再下降）。 */
const TOWER_FALLOFF_RANGE = 20;
/** 最大衰减比例（衰减终点伤害 = 满伤 × (1 - FALLOFF)）。 */
const TOWER_FALLOFF = 0.75;
/** 单 HEAL 部件近身治疗量。 */
const HEAL_POWER = 12;

/** 参与判定的单塔摘要。 */
export interface TowerSummary {
  /** 塔当前能量（无能量的塔不产出伤害）。 */
  energy: number;
  /** 塔到焦点目标的距离。 */
  rangeToTarget: number;
}

/** 参与判定的敌方编队摘要（全体威胁 creep，非仅焦点目标）。 */
export interface HostileSquadSummary {
  /** 编队 HEAL 部件总数。 */
  totalHealParts: number;
  /** 是否有威胁 creep 处于强制交战半径内（核心结构告急，必须开火）。 */
  breachingCore: boolean;
}

/** 单塔对指定距离目标的期望伤害（≤5 格满伤、≥20 格衰减到底，之间线性）。 */
export function towerDamageAt(range: number): number {
  if (range <= TOWER_OPTIMAL_RANGE) return TOWER_POWER_ATTACK;
  const effectiveRange = Math.min(range, TOWER_FALLOFF_RANGE);
  const falloffProgress =
    (effectiveRange - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
  return Math.floor(TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * falloffProgress));
}

/** 交战判定结果。 */
export interface EngagementDecision {

  engage: boolean;
  /** 全塔合计期望伤害（诊断用）。 */
  expectedDamage: number;
  /** 敌方编队合计治疗量（诊断用）。 */
  expectedHeal: number;
}

/**
 * 判定全塔集火是否有净收益：合计伤害 > 编队合计治疗 → 开火（每发都在真实掉血）；
 * 打不动且未突破核心 → 停火蓄能，等敌方近身或撤退；敌人突入核心区 → 无条件开火
 * （结构被拆的损失恒大于塔能量，且近身处塔伤接近满值，通常已过盈亏线）。
 */
export function assessEngagement(
  towers: readonly TowerSummary[],
  squad: HostileSquadSummary,
): EngagementDecision {
  let expectedDamage = 0;
  for (const t of towers) {
    if (t.energy < 10) continue; // 单次攻击耗 10 能量，不足者不计入火力。
    expectedDamage += towerDamageAt(t.rangeToTarget);
  }
  const expectedHeal = squad.totalHealParts * HEAL_POWER;

  const engage = squad.breachingCore || expectedDamage > expectedHeal;
  return { engage, expectedDamage, expectedHeal };
}
