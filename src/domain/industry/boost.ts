/**
 * Boost 决策 — 纯函数，无 Game API 依赖。
 *
 * 决定哪些 creep 应该被 boost、使用什么化合物、优先级如何。
 * 设计原则：
 *   - boost 是锦上添花，不能阻塞经济（能量不足时不 boost）
 *   - 优先 boost 高价值角色（upgrader > harvester > builder）
 *   - 预留多房间扩展：boost 策略可按房间配置
 */
import { BOOST_EFFECTS, type BoostPolicy, type BoostRequest, type Compound } from "./types";

/** 默认 boost 策略：RCL6+ 启用，优先 upgrader。 */
export const DEFAULT_BOOST_POLICY: BoostPolicy = {
  roleBoosts: {
    upgrader: "XGH2O",   // +400% upgrade power
    harvester: "XUH2O",  // +400% harvest power
    builder: "XLH2O",    // +400% repair/build power
  },
  minRcl: 6,
  reserveAmount: 100, // 保留 100 单位化合物用于反应链
};

/** 角色 boost 优先级（越高越先执行）。 */
const ROLE_BOOST_PRIORITY: Readonly<Record<string, number>> = {
  upgrader: 10,
  harvester: 8,
  builder: 5,
};

/**
 * 新生 creep 的 boost 报到窗口：ticksToLive 高于此值视为刚出生（约 100 tick 内）。
 * 请求生成与 creep 的「去 lab 报到」拦截共用此阈值 —
 * 窗口一过，请求不再生成、creep 也不再被引导去 lab，天然防止在 lab 旁永久等待。
 */
export const BOOST_REPORT_TTL = 1400;

/**
 * 计算当前 tick 的 boost 请求列表。
 *
 * @param creeps      当前存活 creep 摘要
 * @param rcl         房间 RCL
 * @param storage     storage 中各化合物数量
 * @param policy      boost 策略
 * @returns 按优先级排序的 boost 请求
 */
export function evaluateBoostRequests(
  creeps: readonly { name: string; role: string; ticksToLive: number; boosted: boolean }[],
  rcl: number,
  storage: Readonly<Record<string, number>>,
  policy: BoostPolicy = DEFAULT_BOOST_POLICY,
): BoostRequest[] {
  if (rcl < policy.minRcl) return [];

  const requests: BoostRequest[] = [];

  for (const creep of creeps) {
    // 已经 boost 过的不再请求
    if (creep.boosted) continue;

    // 只 boost 新生 creep（报到窗口内，即刚出生 100 tick 内）
    if (creep.ticksToLive < BOOST_REPORT_TTL) continue;

    const targetCompound = policy.roleBoosts[creep.role];
    if (!targetCompound) continue;

    // 检查库存是否足够（保留 reserve）
    const available = (storage[targetCompound] ?? 0) - policy.reserveAmount;
    if (available < 30) continue; // 至少需要 30 单位（boost 一个 creep 需要 bodyParts × 30）

    const priority = ROLE_BOOST_PRIORITY[creep.role] ?? 0;
    requests.push({
      creepName: creep.name,
      compound: targetCompound,
      bodyParts: 5, // 默认 boost 5 个 body parts
      priority,
    });
  }

  // 按优先级降序排列
  requests.sort((a, b) => b.priority - a.priority);
  return requests;
}

/**
 * 判断给定化合物是否是某个角色的有效 boost。
 */
export function isValidBoostForRole(role: string, compound: Compound, policy: BoostPolicy = DEFAULT_BOOST_POLICY): boolean {
  return policy.roleBoosts[role] === compound;
}

/**
 * 获取 boost 效果描述（用于日志/遥测）。
 */
export function getBoostEffect(compound: Compound): string {
  return BOOST_EFFECTS[compound] ?? "unknown";
}
