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
 *
 * 降级立即生效 — bucket 低时必须马上限流。
 * 升级需要 bucket 超过下一档阈值至少 `recoveryHysteresis`，
 * 并持续 `recoveryTicks` 个 tick，避免频繁抖动。
 */
export function resolveTier(prevTier: CpuTier | undefined, prevRecoveryTicks: number, bucket: number): {
  tier: CpuTier;
  recoveryTicks: number;
} {
  // 根据 bucket 确定自然档位（降级立即生效）。
  const naturalTier = bucketToTier(bucket);

  // 降级（更差的档位）立即生效。
  // tierRank: healthy=0 < guarded=1 < conserve=2 < recovery=3（数值越大越差）
  if (prevTier === undefined || tierRank(naturalTier) >= tierRank(prevTier)) {
    return { tier: naturalTier, recoveryTicks: 0 };
  }

  // 升级（更好的档位）：逐步升级并带滞回。
  // 目标是当前档位的上一档（而非自然档位）。
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
    const limits = tierLimits(tier);
    // 有效硬上限：Game.cpu.limit 和 Game.cpu.tickLimit 的较小值减去安全余量。
    // tickLimit 可能临时低于 20。
    const cpuLimit = Math.min(Game.cpu.limit ?? 20, Game.cpu.tickLimit ?? 20);
    this.hardLimit = Math.min(limits.hard, cpuLimit - CONFIG.kernel.cpuReserve);
    this.softLimit = Math.min(limits.soft, this.hardLimit - 1);
  }

  canStart(priority: Priority): boolean {
    if (this.isExhausted()) return false;
    const max = tierMaxPriority(this.tier);
    if (priority > max) return false;
    // P0 始终尝试（必须保持廉价）。非 P0 遵守软上限。
    if (priority > 0 && this.spent() >= this.softLimit) return false;
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

  const { tier, recoveryTicks } = resolveTier(prevTier, prevTicks, bucket);

  // 持久化档位跟踪，供下一 tick 使用。
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.tier = tier;
  Memory.kernel.recoveryTicks = recoveryTicks;

  return new CpuBudget(tier);
}
