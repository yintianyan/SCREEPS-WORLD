import { CONFIG, tierLimits, tierMaxPriority } from "../config";
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

  constructor(tier: CpuTier) {
    this.tier = tier;
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
    const max = tierMaxPriority(this.tier);
    if (priority > max) return false;
    // P0 始终尝试（必须保持廉价）。非 P0 遵守软上限。
    if (priority > 0 && this.spent() >= this.softLimit) return false;
    // P1-2 前馈预测：历史 CPU 持续高位时收紧非 P0 任务的通过率。
    // cpuAvg10/cpuMax10 是最近 10 个采样点（~100 tick）的均值/峰值，
    // 非 real-time 但能反映本 tick 的基线 CPU 消耗水平。当历史峰值已接近
    // hardLimit 时，当前 tick 的增量工作很可能触发硬上限——提前拒绝 P2+
    // 任务比触发 isExhausted 后一刀切更平滑（P1 仍放行）。
    // 守卫：cpuMax10/cpuAvg10 必须为正数才视为有效历史数据 —
    // 测试环境或 reset 首 tick stats 可能未初始化（值为 0 或 undefined），
    // 此时不应启用前馈预测，避免残留/空数据错误拒绝低优先级任务。
    if (priority >= 2) {
      const stats = Memory.kernel?.stats;
      if (stats && (stats.cpuMax10 ?? 0) > 0 && (stats.cpuAvg10 ?? 0) > 0) {
        // cpuMax10 >= hardLimit*0.8 → 历史峰值已逼近硬上限，P2+ 拒绝。
        if (stats.cpuMax10! >= this.hardLimit * 0.8) return false;
        // cpuAvg10 >= softLimit*0.8 → 基线 CPU 持续高位，P3+ 拒绝（P2 仍放行）。
        if (priority >= 3 && stats.cpuAvg10! >= this.softLimit * 0.8) return false;
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

  return new CpuBudget(tier);
}
