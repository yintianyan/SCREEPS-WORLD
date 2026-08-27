/** Telemetry Flush — flush 管线：从 buffer 收集 → 导出 → segment 写入。 */

import { flush, shouldFlush, type FlushPackage } from "./TelemetryBuffer";
import { exportConsoleLine } from "./exporters/ConsoleExporter";
import { exportPrometheusText } from "./exporters/PrometheusExporter";
import { globalCache } from "../kernel/global-cache";
import { TELEMETRY_CPU_BUDGET_RATIO } from "./schema";

// ─── Flush Pipeline ───────────────────────────────────────

export interface FlushResult {
  readonly tick: number;
  readonly flushed: boolean;
  readonly cpuCost: number;
  readonly metricCount: number;
  readonly eventCount: number;
  readonly decisionCount: number;
  readonly skipped: boolean;
  readonly skipReason?: string;
}

/**
 * 执行一次 flush 周期。

 * @param tier CPU tier（用于降级判断）
 * @returns flush 结果
 */
export function runFlush(tier: string): FlushResult {
  const tick = Game.time;

  // 降级守卫：Recovery/Conserve tier 下跳过
  if (tier === "recovery" || tier === "conserve") {
    return {
      tick,
      flushed: false,
      cpuCost: 0,
      metricCount: 0,
      eventCount: 0,
      decisionCount: 0,
      skipped: true,
      skipReason: `tier=${tier}`,
    };
  }

  // 频率守卫：不是每 tick 都 flush
  if (!shouldFlush()) {
    return {
      tick,
      flushed: false,
      cpuCost: 0,
      metricCount: 0,
      eventCount: 0,
      decisionCount: 0,
      skipped: true,
      skipReason: "not_due",
    };
  }

  // CPU 预算守卫：Telemetry 自身 CPU 开销不得超过 0.5% CPU limit
  const cpuLimit = Game.cpu.limit ?? 500;
  const budget = cpuLimit * TELEMETRY_CPU_BUDGET_RATIO;

  const cpuBefore = Game.cpu.getUsed();
  if (Game.cpu.getUsed() > cpuLimit * 0.95) {
    // 当前 CPU 已接近上限，跳过 flush 保命
    return {
      tick,
      flushed: false,
      cpuCost: 0,
      metricCount: 0,
      eventCount: 0,
      decisionCount: 0,
      skipped: true,
      skipReason: "cpu_near_limit",
    };
  }

  try {
    // 1. 收集 flush package
    const pkg = flush();

    // 2. 导出：console line（供外部采集器）
    const consoleLine = exportConsoleLine(pkg);
    if (consoleLine) {
      console.log(consoleLine);
    }

    // 3. 导出：Prometheus text format（供 Prometheus exporter）
    const promText = exportPrometheusText(pkg);
    // Prometheus exporter 不在 tick 内发送 — 只产出文本，
    // 由外部 screeps-exporter 拉取（通过 console 或 segment）。

    // 4. 写入 segment（低频持久化）
    // 使用现有 segment 4-9 预留空间，后续接入 segment-store。
    // 当前阶段仅 console 输出。

    const cpuAfter = Game.cpu.getUsed();
    const cpuCost = cpuAfter - cpuBefore;

    // CPU 预算超支告警（不阻断本次，仅记录）
    if (cpuCost > budget) {
      console.log(
        `@ALERT telemetry-budget: flush cost ${cpuCost.toFixed(3)} > budget ${budget.toFixed(3)}`,
      );
    }

    return {
      tick,
      flushed: true,
      cpuCost,
      metricCount: pkg.metrics.length,
      eventCount: pkg.events.length,
      decisionCount: pkg.decisions.length,
      skipped: false,
    };
  } catch (err) {
    // 1.md §36：Telemetry Failure → AI continues running
    // 不向调用者抛出，静默吞掉
    console.log(`@ALERT telemetry-flush-error: ${String(err).slice(0, 200)}`);
    return {
      tick,
      flushed: false,
      cpuCost: Game.cpu.getUsed() - cpuBefore,
      metricCount: 0,
      eventCount: 0,
      decisionCount: 0,
      skipped: true,
      skipReason: "error",
    };
  }
}

// ─── Init ────────────────────────────────────────────────

/** 初始化 Telemetry flush 状态（global reset 后重建）。 */
export function initTelemetryFlush(): void {
  const g = globalCache() as Record<string, unknown>;
  if (!g.__telemetryBuffer) {
    g.__telemetryBuffer = {
      lastFlushTick: 0,
      flushCount: 0,
      lastFlushCpu: 0,
      lastMetricCount: 0,
      lastEventCount: 0,
      lastDecisionCount: 0,
    };
  }
}
