/** Boost 决策 — 纯函数（无 Game API 依赖）。 */
import { CONFIG } from "../../config";
import {
  BOOST_EFFECTS,
  BOOST_EFFECT_PART,
  type BoostPolicy,
  type BoostRequest,
  type Compound,
} from "./types";

/** 默认 boost 策略：RCL6+ 启用，优先 upgrader。 */
export const DEFAULT_BOOST_POLICY: BoostPolicy = {
  roleBoosts: {
    // 化合物线路与 types.ts BOOST_EFFECTS 对齐：GH=upgrade、UO=harvest、
    // LH=build/repair、UH=attack（勿混），倍率为 X 系 T3 最高档。
    upgrader: "XGH2O", // upgradeController ×2
    harvester: "XUHO2", // harvest ×7
    builder: "XLH2O", // build/repair ×2
    // defender 是威胁期短窗口角色，boost 属即时战力。
    defender: "XUH2O", // attack ×4
    // war 编队（boost 战前强化链）：attacker 顶塔 DPS、healer 治疗翻倍 —
    // X 系 T3 是编队战力的数量级提升，无 boost 的编队在塔下即送。
    attacker: "XUH2O", // attack ×4
    healer: "XLHO2", // heal ×4
    // rangedAttacker kiting 编队：rangedAttack ×3，远程压制。
    rangedAttacker: "XKHO2", // rangedAttack ×3
    // dismantler 拆迁编队：dismantle ×4，快速拆墙。
    dismantler: "XZH2O", // dismantle ×4
  },
  // 降级 boost 链：T3 库存不足时按序降级到 T2/T1。
  // 降级 boost 远好于零 boost：T2 upgrade ×1.8 vs 无 boost ×1.0。
  // 降级只用于经济角色（upgrader/harvester/builder）—
  // 战斗角色（attacker/healer/defender/rangedAttacker/dismantler）
  // 不降级：T2 战斗 boost 倍率不足以在塔下存活，裸攻止损链兜底更安全。
  fallbackBoosts: {
    upgrader: ["GH2O", "GH"], // T2 → T1
    harvester: ["UHO2", "UO"], // T2 → T1
    builder: ["LH2O", "LH"], // T2 → T1
  },
  minRcl: 6,
  // P0-C：保留量从 CONFIG 读取（默认 100），调优/私服环境可单独调整而不改代码。
  reserveAmount: CONFIG.boost.reserveAmount,
};

/** 角色 boost 优先级（越高越先执行）。 */
const ROLE_BOOST_PRIORITY: Readonly<Record<string, number>> = {
  // war 编队最高 — 战时闭环的即时战力，优先于一切经济投资。
  attacker: 30,
  healer: 25,
  // defender 只在威胁期存在，boost 属即时战力而非长期投资。
  defender: 20,
  rangedAttacker: 18,
  dismantler: 15,
  upgrader: 10,
  harvester: 8,
  builder: 5,
};

/**
 * 新生 creep 的 boost 报到窗口（ticksToLive 高于此值 = 刚出生，约 100 tick 内）。
 * 请求生成与「去 lab 报到」拦截共用此阈值 — 窗口一过两者同时失效，
 * 天然防止 creep 在 lab 旁永久等待。
 * 例外：war build 相位的编队角色不受此限（见 isWithinBoostWindow）—
 * 编队集结本就是待命状态，去 lab 报到无机会成本；而 war 前馈生产
 * 化合物需数百 tick，固定 100 tick 窗口会让编队永远错过强化。
 */
export const BOOST_REPORT_TTL = 1400;

/** war 编队角色（战时放宽报到窗口的适用范围）。 */
export const WAR_BOOST_ROLES: ReadonlySet<string> = new Set([
  "attacker",
  "healer",
  "rangedAttacker",
  "dismantler",
]);

/**
 * 报到窗口判定：通用窗口内 → true；war 编队角色在 build 相位 → 全程可报到。
 * warBuildPhase 由调用方判定（warPlan.phase === "build" 且 creep 属于该编队）。
 */
export function isWithinBoostWindow(
  role: string,
  ticksToLive: number,
  warBuildPhase: boolean,
): boolean {
  if (ticksToLive >= BOOST_REPORT_TTL) return true;
  return warBuildPhase && WAR_BOOST_ROLES.has(role);
}

/**
 * war 前馈反应目标（纯函数）：war 姿态激活时按固定顺序检查编队化合物库存，
 * 缺口（< stockpileTarget）即返回该化合物让反应链预产 — 不等 boost 请求出现。
 * 请求驱动是滞后的（库存 ≥ reserve+30 才生成请求），而 T3 化合物从基础矿
 * 到产出需数百 tick；等编队出生再产 = 编队集结完了化合物还没好。
 * 顺序：XUH2O（attacker，无 DPS 再多奶也无用）→ XLHO2（healer）。
 */
export function decideWarReactionTarget(
  warActive: boolean,
  inventory: Readonly<Record<string, number>>,
  stockpileTarget: number,
  compounds: readonly Compound[] = ["XUH2O", "XLHO2"],
): Compound | undefined {
  return decideCombatReactionTarget(warActive, inventory, stockpileTarget, compounds);
}

/**
 * combat 前馈反应目标：war 姿态与 PB 野采任务共用同一化合物链
 * （attacker XUH2O → healer XLHO2）。PB 编队的 killWindow 由 creep 寿命
 * 反推后事实上以 boost 为前提（裸 body 满足不了窗口，见 power-farm.ts），
 * 所以 PB 任务存在期间必须与 war 一样前馈备产，而不是等新生 creep 的
 * boost 请求 —— 请求驱动滞后数百 tick，编队等不起。
 */
export function decideCombatReactionTarget(
  active: boolean,
  inventory: Readonly<Record<string, number>>,
  stockpileTarget: number,
  compounds: readonly Compound[] = ["XUH2O", "XLHO2"],
): Compound | undefined {
  if (!active) return undefined;
  for (const compound of compounds) {
    if ((inventory[compound] ?? 0) < stockpileTarget) return compound;
  }
  return undefined;
}

/**
 * PB 编队 healer 的 lab 分配优先级增量（healer 25 + 10 = 35 > attacker 30）。
 * PB 孵化序是 healer 先行（先到 PB 房等编队），lab 必须同序供给 —
 * war 的 attacker-first 口径会让后孵的 attacker 永远等不到 lab。
 */
export const PB_HEALER_LAB_PRIORITY_BUMP = 10;

/**
 * PB 编队 boost 驻留的寿命下限（剩余寿命 ≥ 此值时驻留等强化）。
 * = 驻留上限 800t（1500 − 700）：超龄未强化成员放行出征，由任务超时/
 * 战损止损兜底 — 不在 home 永久罚站烧寿命，也不无限占住 boost 请求。
 */
export const PB_BOOST_HOLD_MIN_TTL = 700;

// ─── PB 编队强化（原子对 + 分层） ───────────────────────────

/**
 * PB 编队 boost 化合物分档（先 T3 后 T2 兜底）。
 *
 * 为什么 PB 允许 T2 而 war 战斗角色不允许：PB 房无塔，反弹伤害与自身 DPS
 * 成正比 — T2（×3）同样满足寿命反推的击杀窗口（kill 556 ≤ 750）与治疗覆盖
 * （8×36×4... 288×8 ≥ 900×2），而 T3 需要催化剂 X（私服实证 W8N3 无 X，
 * XGH2O 链直接断供休眠，XUH2O 同样断供）— T2 只吃 U/H/O 基础矿，供给链
 * 完全本地。war 的塔下 alpha 伤害必须 ×4 治疗才站得住，那条不降级规则不适用。
 */
export const PB_SQUAD_BOOST_TIERS: ReadonlyArray<{
  attackFactor: number;
  healFactor: number;
  attack: Compound;
  heal: Compound;
}> = [
  { attackFactor: 4, healFactor: 4, attack: "XUH2O" as Compound, heal: "XLHO2" as Compound },
  { attackFactor: 3, healFactor: 3, attack: "UH2O" as Compound, heal: "LHO2" as Compound },
];

/** 兼容别名（闸门/前馈默认 T3 口径）。 */
export const PB_SQUAD_COMPOUNDS = PB_SQUAD_BOOST_TIERS[0]!;

/** 任务实际选用的 boost 档位（闸门/前馈/boost 请求三方共用）。 */
export interface PbBoostTierChoice {
  attack: Compound;
  heal: Compound;
  attackFactor: number;
  healFactor: number;
}

/** PB 编队的 boost 备料需求（按规划的部件数 × 30/部件，引擎 boostCreep 消耗）。 */
export interface PbBoostNeed {
  attackUnits: number;
  healUnits: number;
}

/** 按编队规划计算两种化合物的需求量。 */
export function pbSquadBoostNeed(
  attackers: number,
  attackParts: number,
  healers: number,
  healParts: number,
): PbBoostNeed {
  return {
    attackUnits: attackers * attackParts * 30,
    healUnits: healers * healParts * 30,
  };
}

/**
 * PB boost 库存原子判定：指定化合物对必须同时够量才允许该档位。
 *
 * 为什么必须成对：boost 后攻击手 DPS ×N → 反弹也 ×N（引擎 POWER_BANK_HIT_BACK
 * 按「实际造成伤害」的 50% 回打攻击者本人），治疗若不 ×N，反弹覆盖崩盘，
 * 攻击手速死；反过来只 boost 治疗则击杀窗口打不进（killTicks 超寿命）—
 * 两种单边状态都比全裸更糟。任一化合物缺料 → 整体按裸 body 口径（1.0）规划。
 */
export function isPbBoostStockSufficient(
  need: PbBoostNeed,
  inventory: Readonly<Record<string, number>>,
  reserveAmount: number,
  compounds: { attack: Compound; heal: Compound } = PB_SQUAD_COMPOUNDS,
): boolean {
  return (
    (inventory[compounds.attack] ?? 0) - reserveAmount >= need.attackUnits &&
    (inventory[compounds.heal] ?? 0) - reserveAmount >= need.healUnits
  );
}

/**
 * 分层选档：按 T3 → T2 顺序找第一档「两种化合物都够量」的组合。
 * 返回 undefined = 全档缺料（前馈按最低可产档位补产）。
 */
export function selectPbBoostTier(
  need: PbBoostNeed,
  inventory: Readonly<Record<string, number>>,
  reserveAmount: number,
): PbBoostTierChoice | undefined {
  for (const tier of PB_SQUAD_BOOST_TIERS) {
    if (isPbBoostStockSufficient(need, inventory, reserveAmount, tier)) {
      return {
        attack: tier.attack,
        heal: tier.heal,
        attackFactor: tier.attackFactor,
        healFactor: tier.healFactor,
      };
    }
  }
  return undefined;
}

/**
 * PB 前馈目标（纯函数）：按指定化合物对逐个检查缺口。
 * 缺口顺序 attack → heal（无 DPS 再多奶也无用）。
 */
export function decidePbReactionTarget(
  inventory: Readonly<Record<string, number>>,
  needAttackUnits: number,
  needHealUnits: number,
  compounds: { attack: Compound; heal: Compound } = PB_SQUAD_COMPOUNDS,
): Compound | undefined {
  if ((inventory[compounds.attack] ?? 0) < needAttackUnits) {
    return compounds.attack;
  }
  if ((inventory[compounds.heal] ?? 0) < needHealUnits) {
    return compounds.heal;
  }
  return undefined;
}

/** 请求生成的 creep 输入（body 为可选的最小结构 — 传入即按实际匹配部件数备料）。 */
export interface BoostCreepSummary {
  name: string;
  role: string;
  ticksToLive: number;
  boosted: boolean;
  /** memory.mission — PB 编队（powerBank）据此抬高 healer 的 lab 分配优先级。 */
  mission?: string;
  /**
   * PB 任务档位化合物（sponsor 任务 boostCompounds 透传）：PB creep 的请求
   * 按「任务实际档位」选化合物，而不是 policy 的固定 T3 — 防任务用 T2
   * 而请求仍要 XUH2O 的错位（X 断供时请求永远发不出）。
   */
  missionBoost?: { attack: Compound; heal: Compound };
  /** 可选：creep body（传入则按匹配部件数生成请求，缺省回退 5 部件权宜值）。
   * boost 用 unknown — 官方 typings 中 CLAIM 部件为 string|number，此处只做真值判断。 */
  body?: readonly { type: BodyPartConstant; boost?: unknown }[];
}

/**
 * 从 storage 中选择可用的 boost 化合物：首选 → fallback 降级链。
 * 返回 undefined = 无可用化合物（库存均不足 reserveAmount + 30）。
 * 降级只走 fallbackBoosts 中声明的替代品；未声明 fallback 的角色仅用首选。
 */
export function selectBoostCompound(
  role: string,
  storage: Readonly<Record<string, number>>,
  policy: BoostPolicy,
): Compound | undefined {
  const primary = policy.roleBoosts[role];
  if (primary && (storage[primary] ?? 0) - policy.reserveAmount >= 30) return primary;
  // 降级链：按 fallback 声明顺序尝试更低 tier 的化合物。
  const fallbacks = policy.fallbackBoosts?.[role];
  if (!fallbacks) return undefined;
  for (const fb of fallbacks) {
    if ((storage[fb] ?? 0) - policy.reserveAmount >= 30) return fb;
  }
  return undefined;
}

/**
 * 计算当前 tick 的 boost 请求列表（按优先级降序）；policy 默认 DEFAULT_BOOST_POLICY。
 * warBuildPhase：war 编队 build 相位时放宽报到窗口（见 isWithinBoostWindow）。
 * 降级 boost：当首选 T3 库存不足时，自动沿 fallbackBoosts 链降级到 T2/T1。
 */
export function evaluateBoostRequests(
  creeps: readonly BoostCreepSummary[],
  rcl: number,
  storage: Readonly<Record<string, number>>,
  policy: BoostPolicy = DEFAULT_BOOST_POLICY,
  warBuildPhase = false,
): BoostRequest[] {
  if (rcl < policy.minRcl) return [];

  const requests: BoostRequest[] = [];

  for (const creep of creeps) {
    if (creep.boosted) continue;

    if (!isWithinBoostWindow(creep.role, creep.ticksToLive, warBuildPhase)) continue;

    // PB 编队按任务档位选化合物（任务契约），其余角色走 policy 降级链。
    let targetCompound: Compound | undefined;
    if (creep.mission === "powerBank" && creep.missionBoost) {
      const mine = creep.role === "healer" ? creep.missionBoost.heal : creep.missionBoost.attack;
      targetCompound = (storage[mine] ?? 0) - policy.reserveAmount >= 30 ? mine : undefined;
    } else {
      // 降级 boost 选择：首选 T3 不足时自动降级到 T2/T1。
      targetCompound = selectBoostCompound(creep.role, storage, policy);
    }
    if (!targetCompound) continue;

    // 按实际可强化部件数备料（传入 body 时）：备料不足时 lab-system 执行端
    // 会按库存封顶做部分强化 — 部分强化优于零强化，剩余部件等前馈补产。
    const effect = BOOST_EFFECTS[targetCompound];
    const partType = effect ? BOOST_EFFECT_PART[effect] : undefined;
    const matchedParts =
      partType && creep.body ? creep.body.filter(p => p.type === partType && !p.boost).length : 0;
    const bodyParts = matchedParts > 0 ? matchedParts : 5;

    // PB 编队 healer 抬到 attacker 之上：war 是「先炮后奶」（DPS 优先抢占 lab），
    // PB 相反 — healer 先孵先强化（healer 先到 PB 房等编队），attacker 后孵；
    // 若 lab 优先级沿用 war 口径，attacker 出生时 3 个 lab 全被 healer 之外的
    // 请求占住/换矿中，报到窗口（100t）一过就裸奔出征，反弹 600/t 无覆盖必死。
    const basePriority = ROLE_BOOST_PRIORITY[creep.role] ?? 0;
    const priority =
      basePriority +
      (creep.mission === "powerBank" && creep.role === "healer" ? PB_HEALER_LAB_PRIORITY_BUMP : 0);
    requests.push({
      creepName: creep.name,
      compound: targetCompound,
      bodyParts,
      priority,
    });
  }

  requests.sort((a, b) => b.priority - a.priority);
  return requests;
}

export function isValidBoostForRole(
  role: string,
  compound: Compound,
  policy: BoostPolicy = DEFAULT_BOOST_POLICY,
): boolean {
  return policy.roleBoosts[role] === compound;
}

/** boost 效果描述（用于日志/遥测）。 */
export function getBoostEffect(compound: Compound): string {
  return BOOST_EFFECTS[compound] ?? "unknown";
}
