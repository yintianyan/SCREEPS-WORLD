/** Console Exporter — 将 flush package 导出为 @TELEMETRY 前缀的 JSON 行。 */

import type { FlushPackage } from "../TelemetryBuffer";
import type { MetricSnapshot } from "../MetricRegistry";

/**
 * 将 flush package 导出为单行 @TELEMETRY JSON。
 * 仅输出有信号的 flush（非空 metrics/decisions）。
 */
export function exportConsoleLine(pkg: FlushPackage): string | null {
  // 空包不输出
  if (pkg.metrics.length === 0 && pkg.decisions.length === 0) {
    return null;
  }

  // 构建摘要 payload（不是全量指标，而是关键摘要）
  const summary = buildSummary(pkg);

  // 如果有决策，附带决策列表
  if (pkg.decisions.length > 0) {
    summary.decisions = pkg.decisions.map(d => ({
      p: d.planner,
      d: d.decision,
      r: d.reason,
      ...(d.target ? { t: d.target } : {}),
      ...(d.confidence !== undefined ? { c: d.confidence } : {}),
    }));
  }

  return `@TELEMETRY ${JSON.stringify(summary)}`;
}

/** 构建 flush package 的关键摘要。 */
function buildSummary(pkg: FlushPackage): Record<string, unknown> {
  const s: Record<string, unknown> = {
    tick: pkg.tick,
    mc: pkg.metrics.length, // metric count
    dc: pkg.decisions.length, // decision count
  };

  // 从 metrics 中提取关键值（非全量，避免 console 行过长）
  for (const m of pkg.metrics) {
    if (m.entries.length === 0 && !m.histogramEntries) continue;

    // 仅输出单值 metric 的值（高基数 metric 不输出明细）
    if (m.kind === "gauge" && m.entries.length === 1 && !m.entries[0]!.labels.room) {
      // 全局 gauge：直接输出值
      s[m.name.replace("screeps_", "")] = Math.round(m.entries[0]!.value * 1000) / 1000;
    } else if (m.kind === "counter" && m.entries.length === 1 && !m.entries[0]!.labels.room) {
      // 全局 counter：输出值
      s[m.name.replace("screeps_", "")] = m.entries[0]!.value;
    }
  }

  return s;
}

/**
 * 将 flush package 导出为 @ALERT 前缀的告警行。
 * 用于阈值检查后的主动告警。
 */
export function exportAlertLine(type: string, message: string): string {
  return `@ALERT ${type}:${message}`;
}
