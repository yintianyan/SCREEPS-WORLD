/**
 * Combat Capability — A5.1 G2 纯函数。
 *
 * 从 CreepSnapshot（body + boost）解析结构化战斗能力。G1 威胁评估和后续
 * war-planning 编队可行性评估都消费本模块输出——单一 body 解析算法。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / Creep / Room / 任何 Runtime 对象。
 * 所有运行时数据由调用方（系统层薄壳）注入为 Snapshot。
 *
 * 引擎常量来源：docs/research/03_SCREEPS_GAME_CONSTRAINTS.md §7/§8（CONFIRMED）。
 */

// ═══════════════════════════════════════════════════════════
// §1. 引擎常量（从 docs/research/03 校准，非硬编码猜测）
// ═══════════════════════════════════════════════════════════

/** ATTACK 部件每 tick 伤害（引擎 ATTACK_POWER=30）。 */
export const ATTACK_POWER = 30;
/** RANGED_ATTACK 部件每 tick 伤害（引擎 RANGED_ATTACK_POWER=10）。 */
export const RANGED_ATTACK_POWER = 10;
/** HEAL 部件近身每 tick 治疗（引擎 HEAL_POWER=12）。 */
export const HEAL_POWER = 12;
/** HEAL 部件远程每 tick 治疗（引擎 RANGED_HEAL_POWER=4，range 2-3）。 */
export const RANGED_HEAL_POWER = 4;
/** WORK 部件 dismantle 每 tick 伤害（引擎 DISMANTLE_POWER=50，不产能量）。 */
export const DISMANTLE_POWER = 50;
/** 每部件基础血量（引擎 CREEP_HITS_PER_PART=100）。 */
export const HITS_PER_PART = 100;

/** Boost 倍率表（引擎常量，T1/T2/T3）。 */
export const BOOST_MULTIPLIERS = {
  // 战斗部件：×2/×3/×4
  attack:     [1, 2, 3, 4] as const,
  rangedAttack: [1, 2, 3, 4] as const,
  heal:       [1, 2, 3, 4] as const,
  // TOUGH 减伤系数：T1=0.7, T2=0.5, T3=0.3（值越低减伤越多）
  tough:      [1, 0.7, 0.5, 0.3] as const,
  // WORK (dismantle) 倍率：×1.5/×1.8/×2
  dismantle:  [1, 1.5, 1.8, 2] as const,
  // MOVE 倍率：×2/×3/×4（减少 fatigue）
  move:       [1, 2, 3, 4] as const,
  // CLAIM 倍率：×2/×3/×4（不延长寿命）
  claim:      [1, 2, 3, 4] as const,
} as const;

/** Boost 矿物 → tier 映射（从矿物类型推断 boost 等级）。 */
const BOOST_MINERAL_TIER: Record<string, 1 | 2 | 3> = {
  // T1 (base mineral)
  UH: 1, UO: 1, KH: 1, KO: 1, LH: 1, LO: 1, ZH: 1, ZO: 1, GH: 1, GO: 1,
  // T2 (compound)
  UH2O: 2, UHO2: 2, KH2O: 2, KHO2: 2, LH2O: 2, LHO2: 2, ZH2O: 2, ZHO2: 2, GH2O: 2, GHO2: 2,
  // T3 (crystal)
  XUH2O: 3, XUHO2: 3, XKH2O: 3, XKHO2: 3, XLH2O: 3, XLHO2: 3, XZH2O: 3, XZHO2: 3, XGH2O: 3, XGHO2: 3,
};

// ═══════════════════════════════════════════════════════════
// §2. Snapshot 类型（最小输入，不持有 Runtime 对象）
// ═══════════════════════════════════════════════════════════

/** 单个 body 部件的快照。 */
export interface BodyPartSnapshot {
  type: BodyPartConstant;
  /** boost 矿物类型（undefined = 未 boost）。 */
  boost?: string;
  /** 部件是否已被摧毁（false = 活跃，true = hits=0）。 */
  damaged?: boolean;
}

/** Creep 战斗快照——evaluateCombatCapability 的唯一输入。 */
export interface CreepSnapshot {
  id: string;
  owner: string;
  /** body 部件列表（按原始顺序）。 */
  body: readonly BodyPartSnapshot[];
  /** 当前总血量。 */
  hits: number;
  /** 最大血量 = body.length × HITS_PER_PART。 */
  hitsMax: number;
  /** 剩余寿命 tick。 */
  ticksToLive?: number;
  /** 所在房名。 */
  room: string;
  /** 坐标（packed: x*50+y）。 */
  pos: number;
}

// ═══════════════════════════════════════════════════════════
// §3. CombatCapability 输出
// ═══════════════════════════════════════════════════════════

/** 结构化战斗能力——每维度独立，不压缩为单一指标。 */
export interface CombatCapability {
  /** 近身攻击力/tick（ATTACK_POWER × count × boostMultiplier）。 */
  attack: number;
  /** 远程攻击力/tick（RANGED_ATTACK_POWER × count × boostMultiplier）。 */
  rangedAttack: number;
  /** 近身治疗力/tick（HEAL_POWER × count × boostMultiplier）。 */
  heal: number;
  /** 远程治疗力/tick（RANGED_HEAL_POWER × count × boostMultiplier）。 */
  rangedHeal: number;
  /** 拆除力/tick（DISMANTLE_POWER × count × boostMultiplier）。 */
  dismantle: number;
  /** Claim 能力（CLAIM 部件数 × boostMultiplier）。 */
  claim: number;
  /** 有效血量（考虑 TOUGH 减伤后的等效 HP）。 */
  effectiveHP: number;
  /** 移动力（estimate，非精确移动速度）。 */
  mobility: number;
  /** 辅助能力（WORK 用于 harvest/build/repair，非战斗维度）。 */
  support: number;
  /** TOUGH 部件数。 */
  toughParts: number;
  /** 是否有 boost（任一部件被 boost）。 */
  boosted: boolean;
  /** 最高 boost tier（0=无, 1/2/3）。 */
  maxBoostTier: 0 | 1 | 2 | 3;
  /** body 总部件数。 */
  totalParts: number;
  /** 活跃部件数（排除 damaged）。 */
  activeParts: number;
}

// ═══════════════════════════════════════════════════════════
// §4. 纯函数实现
// ═══════════════════════════════════════════════════════════

/** 从 boost 矿物类型解析 tier（0=无 boost, 1/2/3）。 */
export function boostTier(boost?: string): 0 | 1 | 2 | 3 {
  if (!boost) return 0;
  return BOOST_MINERAL_TIER[boost] ?? 0;
}

/** 获取部件的 boost 倍率（已校准引擎常量）。 */
function boostMultiplier(partType: BodyPartConstant, tier: 0 | 1 | 2 | 3): number {
  if (tier === 0) return 1;
  switch (partType) {
    case ATTACK:
      return BOOST_MULTIPLIERS.attack[tier];
    case RANGED_ATTACK:
      return BOOST_MULTIPLIERS.rangedAttack[tier];
    case HEAL:
      return BOOST_MULTIPLIERS.heal[tier];
    case TOUGH:
      return BOOST_MULTIPLIERS.tough[tier];
    case WORK:
      // dismantle 倍率（非 harvest/build 倍率——此处用于战斗能力评估）
      return BOOST_MULTIPLIERS.dismantle[tier];
    case MOVE:
      return BOOST_MULTIPLIERS.move[tier];
    case CLAIM:
      return BOOST_MULTIPLIERS.claim[tier];
    default:
      return 1;
  }
}

/**
 * 从 CreepSnapshot 解析结构化战斗能力。
 *
 * 算法：
 * 1. 遍历 body 部件，按 type 分组计数（排除 damaged）
 * 2. 对每个部件查 boost tier → 计算实际倍率
 * 3. 按引擎常量派生各维度能力值
 * 4. effectiveHP 考虑 TOUGH 减伤
 * 5. mobility 是 estimate（MOVE/body weight 比值），标记为估计值
 *
 * 复杂度：O(body.length)，通常 ≤ 50。
 */
export function evaluateCombatCapability(creep: CreepSnapshot): CombatCapability {
  let attack = 0;
  let rangedAttack = 0;
  let heal = 0;
  let rangedHeal = 0;
  let dismantle = 0;
  let claim = 0;
  let support = 0;
  let toughParts = 0;
  let totalParts = creep.body.length;
  let activeParts = 0;
  let maxBoostTier: 0 | 1 | 2 | 3 = 0;
  let toughReductionSum = 0; // 用于 effectiveHP 计算

  for (const part of creep.body) {
    if (part.damaged) continue; // 已摧毁部件不贡献能力
    activeParts++;

    const tier = boostTier(part.boost);
    if (tier > maxBoostTier) maxBoostTier = tier;

    const mult = boostMultiplier(part.type, tier);

    switch (part.type) {
      case ATTACK:
        attack += ATTACK_POWER * mult;
        break;
      case RANGED_ATTACK:
        rangedAttack += RANGED_ATTACK_POWER * mult;
        break;
      case HEAL:
        heal += HEAL_POWER * mult;
        rangedHeal += RANGED_HEAL_POWER * mult;
        break;
      case WORK:
        // WORK 部件双用途：dismantle（战斗）和 harvest/build/repair（辅助）
        // dismantle 倍率与 harvest 倍率不同（1.5/1.8/2 vs 3/5/7）
        // 此处 dismantle 用 BOOST_MULTIPLIERS.dismantle（已通过 boostMultiplier 应用）
        dismantle += DISMANTLE_POWER * mult;
        support += 1; // 辅助能力 = WORK 部件数（简化）
        break;
      case TOUGH:
        toughParts++;
        // tough 减伤系数累加（用于 effectiveHP 计算）
        // mult 此时是 tough multiplier（0.7/0.5/0.3），值越低减伤越多
        toughReductionSum += mult;
        break;
      case CLAIM:
        claim += mult;
        break;
      case MOVE:
        // mobility 在下方单独计算
        break;
      default:
        // CARRY 等非战斗部件不计入
        break;
    }
  }

  // effectiveHP 计算：
  // - 非 TOUGH 部件：每 part 100 hits
  // - TOUGH 部件：100 / tough_multiplier（T3 tough 的 100 hits 需要 ~333 伤害摧毁）
  // - 加上当前 hits 与 hitsMax 的比例缩放（受损 creep 的 effectiveHP 按比例降低）
  const hitsRatio = creep.hitsMax > 0 ? creep.hits / creep.hitsMax : 0;
  const nonToughHP = (activeParts - toughParts) * HITS_PER_PART;
  // tough 部件的 effectiveHP：每个 tough part 的等效 HP = 100 / multiplier
  // 无 boost tough: 100/1 = 100（不减伤）
  // T3 boost tough: 100/0.3 ≈ 333
  let toughHP = 0;
  for (const part of creep.body) {
    if (part.damaged) continue;
    if (part.type !== TOUGH) continue;
    const tier = boostTier(part.boost);
    const mult = BOOST_MULTIPLIERS.tough[tier];
    toughHP += HITS_PER_PART / mult;
  }
  const effectiveHP = Math.round((nonToughHP + toughHP) * hitsRatio);

  // mobility 估计（非精确移动速度）：
  // moveRatio = activeMoveParts / totalWeight
  // totalWeight = 非 MOVE 部件数（空 CARRY 不计重）
  // moveRatio > 1 = 路面无 fatigue（平原上每 tick 减 2 fatigue，1 MOVE 可动 1 body weight）
  // moveRatio = 0.5 = 平原 2 tick 一步
  // 此值是 estimate——真实移动速度受地形（路/平原/沼泽）和 fatigue 累积影响
  let moveParts = 0;
  let bodyWeight = 0;
  for (const part of creep.body) {
    if (part.damaged) continue;
    if (part.type === MOVE) {
      moveParts++;
    } else if (part.type !== CARRY) {
      // CARRY 空时不计重，满时计重——此处按满载保守估计
      bodyWeight++;
    }
  }
  // MOVE 部件的 boost 倍率影响 fatigue 恢复速度
  let moveBoostTier: 0 | 1 | 2 | 3 = 0;
  for (const part of creep.body) {
    if (part.damaged) continue;
    if (part.type === MOVE) {
      const tier = boostTier(part.boost);
      if (tier > moveBoostTier) moveBoostTier = tier;
      break;
    }
  }
  const moveMult = BOOST_MULTIPLIERS.move[moveBoostTier];
  const mobility = bodyWeight > 0
    ? (moveParts * moveMult * 2) / (bodyWeight * 2) // 标准化到平原地形
    : moveParts > 0
      ? 1 // 全 MOVE creep
      : 0; // 无 MOVE = 不可移动

  return {
    attack,
    rangedAttack,
    heal,
    rangedHeal,
    dismantle,
    claim,
    effectiveHP,
    mobility,
    support,
    toughParts,
    boosted: maxBoostTier > 0,
    maxBoostTier,
    totalParts,
    activeParts,
  };
}

// ═══════════════════════════════════════════════════════════
// §5. 编队聚合
// ═══════════════════════════════════════════════════════════

/** 编队聚合能力——多只 creep 的能力加总。 */
export interface AggregateCapability {
  totalAttack: number;
  totalRangedAttack: number;
  totalHeal: number;
  totalRangedHeal: number;
  totalDismantle: number;
  totalClaim: number;
  totalEffectiveHP: number;
  avgMobility: number;
  totalSupport: number;
  totalToughParts: number;
  boostedCount: number;
  maxBoostTier: 0 | 1 | 2 | 3;
  creepCount: number;
}

/**
 * 聚合多只 creep 的战斗能力。
 *
 * 设计原则：
 * - 各维度独立加总（attack/heal/dismantle 不互相折算）
 * - effectiveHP 是加总（编队总血池）
 * - avgMobility 取平均（编队速度受最慢成员限制——此处用平均作 estimate）
 * - boostedCount 统计被 boost 的成员数
 *
 * 复杂度：O(capabilities.length)。
 */
export function aggregateCombatCapability(
  capabilities: readonly CombatCapability[],
): AggregateCapability {
  if (capabilities.length === 0) {
    return {
      totalAttack: 0,
      totalRangedAttack: 0,
      totalHeal: 0,
      totalRangedHeal: 0,
      totalDismantle: 0,
      totalClaim: 0,
      totalEffectiveHP: 0,
      avgMobility: 0,
      totalSupport: 0,
      totalToughParts: 0,
      boostedCount: 0,
      maxBoostTier: 0,
      creepCount: 0,
    };
  }

  let totalAttack = 0;
  let totalRangedAttack = 0;
  let totalHeal = 0;
  let totalRangedHeal = 0;
  let totalDismantle = 0;
  let totalClaim = 0;
  let totalEffectiveHP = 0;
  let totalMobility = 0;
  let totalSupport = 0;
  let totalToughParts = 0;
  let boostedCount = 0;
  let maxBoostTier: 0 | 1 | 2 | 3 = 0;

  for (const cap of capabilities) {
    totalAttack += cap.attack;
    totalRangedAttack += cap.rangedAttack;
    totalHeal += cap.heal;
    totalRangedHeal += cap.rangedHeal;
    totalDismantle += cap.dismantle;
    totalClaim += cap.claim;
    totalEffectiveHP += cap.effectiveHP;
    totalMobility += cap.mobility;
    totalSupport += cap.support;
    totalToughParts += cap.toughParts;
    if (cap.boosted) boostedCount++;
    if (cap.maxBoostTier > maxBoostTier) maxBoostTier = cap.maxBoostTier;
  }

  return {
    totalAttack,
    totalRangedAttack,
    totalHeal,
    totalRangedHeal,
    totalDismantle,
    totalClaim,
    totalEffectiveHP,
    avgMobility: totalMobility / capabilities.length,
    totalSupport,
    totalToughParts,
    boostedCount,
    maxBoostTier,
    creepCount: capabilities.length,
  };
}

// ═══════════════════════════════════════════════════════════
// §6. CombatPower（编队级估计值，非万能指标）
// ═══════════════════════════════════════════════════════════

/** 编队上下文——影响战斗力评估的环境因素。 */
export interface FormationContext {
  /** 是否有塔覆盖（影响 effectiveHP 的有效价值——塔下作战需要更多 tough/heal）。 */
  towerCoverage: number; // 0-1, 0=无塔, 1=满塔覆盖
  /** 地形类型（影响 mobility 的有效价值）。 */
  terrain: "plain" | "swamp" | "road";
  /** 是否有 boost 支持（编队全员 boost → 战力乘数）。 */
  boosted: boolean;
}

/**
 * 编队战斗力估计——粗粒度参考值，严禁作为军事决策的唯一依据。
 *
 * Screeps 战斗胜负取决于位置/地形/Rampart/Tower/Heal/集中火力/移动/
 * Boost/撤退路径/编队/目标价值等因素，单一数字无法捕获这些维度。
 *
 * 正确用法：消费 burstDamage / effectiveHP / healOutput / dismantlePower
 * 等独立维度做精细判断；powerScore 仅用于粗粒度快速筛选（如「是否值得进一步评估」）。
 *
 * 错误用法：if (myPower > enemyPower) attack() — 这会输掉 PvP。
 */
export interface CombatPower {
  /** 爆发伤害/tick（近身 + 远程）。 */
  burstDamage: number;
  /** 有效血池（含 tough 减伤）。 */
  effectiveHP: number;
  /** 治疗输出/tick（近身，编队内互相治疗）。 */
  healOutput: number;
  /** 拆除能力/tick。 */
  dismantlePower: number;
  /** 综合战力评分（加权估计，非胜率）。 */
  powerScore: number;
  /** 编队人数。 */
  creepCount: number;
  /** 平均移动力。 */
  mobility: number;
  /** 编队是否被 boost。 */
  boosted: boolean;
}

/**
 * 计算编队战斗力估计值。
 *
 * ⚠ 重要警告——必须阅读：
 * - powerScore 只是加权估计，不能直接代表胜率，不能作为军事决策的唯一依据
 * - 10 heal 不一定胜 10 attack（治疗是被动的，攻击是主动的）
 * - 相同 powerScore 的两个编队在不同地形/塔覆盖/rampart 下结果可能完全相反
 * - 必须保留 AggregateCapability / CombatPower 各独立维度用于后续 Planner 的精细决策
 * - 下游消费者应优先使用 burstDamage / effectiveHP / healOutput 等维度，
 *   而非直接比较 powerScore
 *
 * 权重设计（粗粒度，非精确模型）：
 * - burstDamage: 1.0（直接杀伤能力）
 * - effectiveHP: 0.1（生存能力，1000 HP ≈ 100 分）
 * - healOutput: 0.5（续战能力，治疗是乘数效应）
 * - dismantlePower: 0.3（拆家能力，非直接战斗力）
 * - boost 乘数：T1=×1.1, T2=×1.2, T3=×1.3（反映 boost 是军备竞赛核心优势）
 * - tower 覆盖惩罚：towerCoverage 高时 effectiveHP 权重降低（塔伤绕过 tough）
 */
export function computeCombatPower(
  capabilities: readonly CombatCapability[],
  context?: FormationContext,
): CombatPower {
  const agg = aggregateCombatCapability(capabilities);
  const burstDamage = agg.totalAttack + agg.totalRangedAttack;
  const effectiveHP = agg.totalEffectiveHP;
  const healOutput = agg.totalHeal;
  const dismantlePower = agg.totalDismantle;

  // 权重计算
  const towerPenalty = context ? 1 - context.towerCoverage * 0.3 : 1;
  const hpWeight = 0.1 * towerPenalty;
  const healWeight = 0.5;
  const damageWeight = 1.0;
  const dismantleWeight = 0.3;

  let powerScore =
    burstDamage * damageWeight +
    effectiveHP * hpWeight +
    healOutput * healWeight +
    dismantlePower * dismantleWeight;

  // boost 乘数：任何 boost 都应该提升 powerScore
  // T1: ×1.1, T2: ×1.2, T3: ×1.3（反映 boost 是军备竞赛核心优势）
  if (agg.maxBoostTier > 0) {
    const boostMult = 1 + agg.maxBoostTier * 0.1;
    powerScore *= boostMult;
  }

  return {
    burstDamage,
    effectiveHP,
    healOutput,
    dismantlePower,
    powerScore: Math.round(powerScore * 10) / 10,
    creepCount: agg.creepCount,
    mobility: agg.avgMobility,
    boosted: agg.maxBoostTier > 0,
  };
}
