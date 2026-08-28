import { CONFIG, tierLimits, tierMaxPriority } from "../config";
import { globalCache } from "./global-cache";
import { log } from "./log";
import { EventKind, recordEvent } from "./event-log";
import type { Budget, CpuTier, Priority } from "./contracts";

/** 各档位的 bucket 阈值（降级立即生效）。
 * 单一真相源：CONFIG.cpu.tiers[*].min — 此处仅做按档位索引的视图，
 * 避免 config 与 scheduler 双源漂移（调 config 不生效的静默陷阱）。 */
const TIER_BUCKET_MIN: Readonly<Record<CpuTier, number>> = {
  healthy: CONFIG.cpu.tiers.healthy.min,
  guarded: CONFIG.cpu.tiers.guarded.min,
  conserve: CONFIG.cpu.tiers.conserve.min,
  recovery: CONFIG.cpu.tiers.recovery.min,
};

/** 从高到低排列的档位顺序，用于扫描。 */
const TIER_ORDER: readonly CpuTier[] = ["healthy", "guarded", "conserve", "recovery"];

/**
 * 根据 bucket 带滞回地确定 CPU 档位。
 * 降级立即生效（bucket 低时必须马上限流）；升级需 bucket 超过下一档阈值至少
 * recoveryHysteresis 并持续 recoveryTicks 个 tick，避免频繁抖动。
 * @param voluntaryDrain 自愿放血宽限（generatePixel 后的窗口期）：tier 地板抬到
 *   conserve — pixel 清零 bucket 只损失突发容量，每 tick 限额不变，P2 经济角色
 *   不应被 recovery 档冻结。仅影响 recovery 判定；真实 CPU 超支仍由硬上限兜底。
 */
export function resolveTier(
  prevTier: CpuTier | undefined,
  prevRecoveryTicks: number,
  bucket: number,
  voluntaryDrain = false,
): {
  tier: CpuTier;
  recoveryTicks: number;
} {
  const result = resolveTierNatural(prevTier, prevRecoveryTicks, bucket);
  // 自愿放血宽限：recovery 地板抬到 conserve；不影响 recoveryTicks 记账，
  // 滞回升级逻辑照常从真实档位爬升。
  if (voluntaryDrain && result.tier === "recovery") {
    return { tier: "conserve", recoveryTicks: result.recoveryTicks };
  }
  return result;
}

function resolveTierNatural(prevTier: CpuTier | undefined, prevRecoveryTicks: number, bucket: number): {
  tier: CpuTier;
  recoveryTicks: number;
} {
  // 降级（更差的档位）立即生效；升级（更好的档位）逐步升级并带滞回。
  // tierRank: healthy=0 < guarded=1 < conserve=2 < recovery=3（数值越大越差）。
  const naturalTier = bucketToTier(bucket);

  if (prevTier === undefined || tierRank(naturalTier) >= tierRank(prevTier)) {
    return { tier: naturalTier, recoveryTicks: 0 };
  }

  // 升级目标是当前档位的上一档（而非自然档位）。
  const currentRank = tierRank(prevTier);
  const targetTier = TIER_ORDER[currentRank - 1] ?? naturalTier;
  const hysteresisThreshold = TIER_BUCKET_MIN[targetTier] + CONFIG.cpu.tiers[prevTier].recoveryHysteresis;

  if (bucket >= hysteresisThreshold) {
    const ticks = prevRecoveryTicks + 1;
    if (ticks >= CONFIG.cpu.tiers[prevTier].recoveryTicks) {
      return { tier: targetTier, recoveryTicks: 0 };
    }
    return { tier: prevTier, recoveryTicks: ticks };
  }

  // bucket 低于滞回阈值 — 重置恢复计数器。
  return { tier: prevTier, recoveryTicks: 0 };
}

function bucketToTier(bucket: number): CpuTier {
  for (const tier of TIER_ORDER) {
    if (bucket >= TIER_BUCKET_MIN[tier]) return tier;
  }
  return "recovery";
}

function tierRank(tier: CpuTier): number {
  return TIER_ORDER.indexOf(tier);
}

/** 基于 Game.cpu 的具体 Budget 实现。 */
export class CpuBudget implements Budget {
  readonly tier: CpuTier;
  readonly softLimit: number;
  readonly hardLimit: number;
  /** Emergency Survival Mode（Recovery 档内的紧急安全状态，非第五档 CpuTier）：
   * true 时仅 P0 车道放行。 */
  readonly emergency: boolean;

  constructor(tier: CpuTier, emergency = false) {
    this.tier = tier;
    this.emergency = emergency;
    const ratios = tierLimits(tier);
    // 有效 CPU 限制取 Game.cpu.limit 与 tickLimit 较小值：tickLimit 含 bucket 借用，
    // bucket 低位时可能临时低于 limit — 取较小值不透支当前 tick 真实预算。
    // Fallback 20 仅用于测试环境（Game.cpu 未注入）。
    const effectiveLimit = Math.min(
      Game.cpu.limit ?? 20,
      Game.cpu.tickLimit ?? 20,
    );
    // 双重保护：比例上限（随 limit 自适应）+ 绝对余量（保护低 limit 服务器，
    // 如 10 CPU 下 0.8 reserve 占比更高，防止系统开销挤占关键环）。
    this.hardLimit = Math.min(
      effectiveLimit * ratios.hardRatio,
      effectiveLimit - CONFIG.kernel.cpuReserve,
    );
    // softLimit 兜底 0：极端低 limit（limit < reserve）时 hardLimit-reserve 可能为负，
    // 负 softLimit 使 spent()>=softLimit 恒真、canStart 语义混乱；softLimit=0 时
    // 非 P0 全拒是正确的极限降级行为。
    this.softLimit = Math.max(
      0,
      Math.min(effectiveLimit * ratios.softRatio, this.hardLimit - 1),
    );
  }

  canStart(priority: Priority): boolean {
    if (this.isExhausted()) return false;
    // ESM：紧急安全状态下仅 P0 车道（spawn/快照/room-state/塔防/交通）放行。
    if (this.emergency && priority > 0) return false;
    const max = tierMaxPriority(this.tier);
    if (priority > max) return false;
    // P0 始终尝试（必须保持廉价）。非 P0 遵守软上限。
    if (priority > 0 && this.spent() >= this.softLimit) return false;
    // P1-2 前馈预测：历史 CPU 持续高位时收紧非 P0 任务的通过率。
    // cpuAvg10/cpuMax10 是最近 10 个采样点（~100 tick）的均值/峰值，
    // 非 real-time 但能反映本 tick 的基线 CPU 消耗水平。
    // 守卫：cpuMax10/cpuAvg10 必须为正数才视为有效历史数据 —
    // 测试环境或 reset 首 tick stats 可能未初始化（值为 0 或 undefined），
    // 此时不应启用前馈预测，避免残留/空数据错误拒绝低优先级任务。
    // 审计修复（线上 W37S58 P3 全族饥饿 ~13h 实证）：旧判据
    // 「cpuMax10 ≥ hardLimit*0.8 → 拒 P2+」用**峰值**做永久惩罚 —— 任何一次
    // 尖峰（行情调用/战斗 tick/reload 后首拍）都会让 10 样本窗口 max 长期
    // 高于阈值，而 P2/P3 被冻结恰恰保证窗口 max 不回落 → 自锁死循环：
    // telemetry-collector/terminal/factory/pixel 等 P3 系统整体停摆，
    // stats 冻结后前馈又以冻结值持续拒绝（本事故根因）。修正为：
    //   - 峰值判据仅在「上窗真实触顶」(max10 ≥ hardLimit) 时硬拒 P2+；
    //   - 基线压力由 avg 把守：avg ≥ softLimit 拒 P3+（P2 仍放行）。
    // 自愈旁路（expectations E2 触发时由 kernel 设置）：P3 饥饿期间跳过前馈
    // 拒绝，让冻结系统复活、窗口 max 自然回落打破自锁；软/硬上限仍生效，
    // bucket 低位时旁路自动失效（不拿生存换观测）。
    const p3Escape =
      (Memory.kernel?.p3StarveBypassUntil ?? 0) > Game.time && (Game.cpu.bucket ?? 0) >= 3000;
    if (priority >= 2 && !p3Escape) {
      const stats = Memory.kernel?.stats;
      if (stats && (stats.cpuMax10 ?? 0) > 0 && (stats.cpuAvg10 ?? 0) > 0) {
        // 上窗峰值真实触及硬上限 → 本 tick 大概率透支，P2+ 拒绝。
        if (stats.cpuMax10! >= this.hardLimit) return false;
        // 基线持续高位 → P3+ 拒绝（P2 仍放行）。
        if (priority >= 3 && stats.cpuAvg10! >= this.softLimit) return false;
      }
    }
    return true;
  }

  isExhausted(): boolean {
    return Game.cpu.getUsed() >= this.hardLimit;
  }

  spent(): number {
    return Game.cpu.getUsed();
  }
}

/** 为当前 tick 创建预算，并更新 Memory 中的档位跟踪。 */
export function createBudget(): Budget {
  const bucket = Game.cpu.bucket ?? 10000;
  const prevTier = Memory.kernel?.tier;
  const prevTicks = Memory.kernel?.recoveryTicks ?? 0;

  // Emergency Survival Mode 状态机（Recovery 档内的再收缩层；进入 bucket<100、
  // 退出 bucket≥500，保命态不做恢复滞回）。活动标志存 globalCache（heap 可重建，
  // 不新增 Memory schema 字段）；进入/退出沿记遥测事件。
  const gCache = globalCache();
  const wasEmergency = gCache.emergencySurvival === true;
  const emergency = wasEmergency ? bucket < 500 : bucket < 100;
  if (emergency && !wasEmergency) {
    gCache.emergencySurvival = true;
    recordEvent(EventKind.EmergencySurvival, "kernel", [1]);
    log.info("kernel", `emergency survival: ENTER (bucket=${bucket}) — P0 车道 + harvester 最小采集`);
  } else if (!emergency && wasEmergency) {
    gCache.emergencySurvival = false;
    recordEvent(EventKind.EmergencySurvival, "kernel", [0]);
    log.info("kernel", `emergency survival: EXIT (bucket=${bucket}) — 回 Recovery 常规语义`);
  }

  // 自愿放血宽限：generatePixel 清零 bucket 后的窗口期内，
  // recovery 地板抬到 conserve（P2 经济角色照常运行）。
  const pixelAt = Memory.kernel?.pixelAt;
  const voluntaryDrain =
    pixelAt !== undefined && Game.time - pixelAt < CONFIG.cpu.pixelGraceTicks;

  const { tier, recoveryTicks } = resolveTier(prevTier, prevTicks, bucket, voluntaryDrain);

  // 持久化档位跟踪，供下一 tick 使用。
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.tier = tier;
  Memory.kernel.recoveryTicks = recoveryTicks;

  return new CpuBudget(tier, emergency);
}
