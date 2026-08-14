/**
 * Boost 决策 — 纯函数（无 Game API 依赖）。
 * 取舍：boost 是锦上添花，库存/能量不足时放弃，绝不阻塞经济；
 * 高价值角色优先，策略经 BoostPolicy 参数可扩展（预留多房间）。
 */
import { BOOST_EFFECTS, type BoostPolicy, type BoostRequest, type Compound } from "./types";

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
  },
  minRcl: 6,
  reserveAmount: 100, // 保留 100 单位化合物用于反应链
};

/** 角色 boost 优先级（越高越先执行）。 */
const ROLE_BOOST_PRIORITY: Readonly<Record<string, number>> = {
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
 */
export const BOOST_REPORT_TTL = 1400;

/**
 * 计算当前 tick 的 boost 请求列表（按优先级降序）；policy 默认 DEFAULT_BOOST_POLICY。
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
    if (creep.boosted) continue;

    if (creep.ticksToLive < BOOST_REPORT_TTL) continue;

    const targetCompound = policy.roleBoosts[creep.role];
    if (!targetCompound) continue;

    const available = (storage[targetCompound] ?? 0) - policy.reserveAmount;
    if (available < 30) continue; // boost 成本 = bodyParts × 30

    const priority = ROLE_BOOST_PRIORITY[creep.role] ?? 0;
    requests.push({
      creepName: creep.name,
      compound: targetCompound,
      bodyParts: 5, // 默认 boost 5 个 body parts
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
