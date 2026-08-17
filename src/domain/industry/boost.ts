/**
 * Boost 决策 — 纯函数（无 Game API 依赖）。
 * 取舍：boost 是锦上添花，库存/能量不足时放弃，绝不阻塞经济；
 * 高价值角色优先，策略经 BoostPolicy 参数可扩展（预留多房间）。
 */
import { BOOST_EFFECTS, BOOST_EFFECT_PART, type BoostPolicy, type BoostRequest, type Compound } from "./types";

/** 默认 boost 策略：RCL6+ 启用，优先 upgrader。 */
export const DEFAULT_BOOST_POLICY: BoostPolicy = {
  roleBoosts: {
    // 化合物线路与 types.ts BOOST_EFFECTS 对齐：GH=upgrade、UO=harvest、
    // LH=build/repair、UH=attack（勿混），倍率为 X 系 T3 最高档。
    upgrader: "XGH2O",   // upgradeController ×2
    harvester: "XUHO2",  // harvest ×7
    builder: "XLH2O",    // build/repair ×2
    // defender 是威胁期短窗口角色，boost 属即时战力。
    defender: "XUH2O",   // attack ×4
    // war 编队（boost 战前强化链）：attacker 顶塔 DPS、healer 治疗翻倍 —
    // X 系 T3 是编队战力的数量级提升，无 boost 的编队在塔下即送。
    attacker: "XUH2O",   // attack ×4
    healer: "XLHO2",     // heal ×4
  },
  minRcl: 6,
  reserveAmount: 100, // 保留 100 单位化合物用于反应链
};

/** 角色 boost 优先级（越高越先执行）。 */
const ROLE_BOOST_PRIORITY: Readonly<Record<string, number>> = {
  // war 编队最高 — 战时闭环的即时战力，优先于一切经济投资。
  attacker: 30,
  healer: 25,
  // defender 只在威胁期存在，boost 属即时战力而非长期投资。
  defender: 20,
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
export const WAR_BOOST_ROLES: ReadonlySet<string> = new Set(["attacker", "healer"]);

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
  if (!warActive) return undefined;
  for (const compound of compounds) {
    if ((inventory[compound] ?? 0) < stockpileTarget) return compound;
  }
  return undefined;
}

/** 请求生成的 creep 输入（body 为可选的最小结构 — 传入即按实际匹配部件数备料）。 */
export interface BoostCreepSummary {
  name: string;
  role: string;
  ticksToLive: number;
  boosted: boolean;
  /** 可选：creep body（传入则按匹配部件数生成请求，缺省回退 5 部件权宜值）。
   * boost 用 unknown — 官方 typings 中 CLAIM 部件为 string|number，此处只做真值判断。 */
  body?: readonly { type: BodyPartConstant; boost?: unknown }[];
}

/**
 * 计算当前 tick 的 boost 请求列表（按优先级降序）；policy 默认 DEFAULT_BOOST_POLICY。
 * warBuildPhase：war 编队 build 相位时放宽报到窗口（见 isWithinBoostWindow）。
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

    const targetCompound = policy.roleBoosts[creep.role];
    if (!targetCompound) continue;

    const available = (storage[targetCompound] ?? 0) - policy.reserveAmount;
    if (available < 30) continue; // boost 成本 = bodyParts × 30

    // 按实际可强化部件数备料（传入 body 时）：备料不足时 lab-system 执行端
    // 会按库存封顶做部分强化 — 部分强化优于零强化，剩余部件等前馈补产。
    const effect = BOOST_EFFECTS[targetCompound];
    const partType = effect ? BOOST_EFFECT_PART[effect] : undefined;
    const matchedParts = partType && creep.body
      ? creep.body.filter(p => p.type === partType && !p.boost).length
      : 0;
    const bodyParts = matchedParts > 0 ? matchedParts : 5;

    const priority = ROLE_BOOST_PRIORITY[creep.role] ?? 0;
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

export function isValidBoostForRole(role: string, compound: Compound, policy: BoostPolicy = DEFAULT_BOOST_POLICY): boolean {
  return policy.roleBoosts[role] === compound;
}

/** boost 效果描述（用于日志/遥测）。 */
export function getBoostEffect(compound: Compound): string {
  return BOOST_EFFECTS[compound] ?? "unknown";
}
