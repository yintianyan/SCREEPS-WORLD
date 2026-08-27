/** Prometheus Exporter — 将 flush package 转换为 Prometheus text format。 */

import type { FlushPackage } from "../TelemetryBuffer";
import type { MetricSnapshot } from "../MetricRegistry";

/**
 * 将 flush package 转换为 Prometheus text format。

 * @param pkg flush package
 * @returns Prometheus exposition format text
 */
export function exportPrometheusText(pkg: FlushPackage): string {
  const lines: string[] = [];

  // ── Metrics ──────────────────────────────────────
  for (const metric of pkg.metrics) {
    lines.push(...formatMetric(metric));
  }

  // ── Events（不进入 Prometheus，1.md §33）──────────
  // Events → Event Store / Loki（未来），当前仅 console

  // ── Decisions（不进入 Prometheus）─────────────────
  // Decisions → 独立存储，不作为 Prom metric

  return lines.join("\n");
}

/** 将单个 metric 转换为 Prometheus text 行。 */
function formatMetric(metric: MetricSnapshot): string[] {
  const lines: string[] = [];

  // HELP 和 TYPE 声明
  lines.push(`# HELP ${metric.name} ${metric.help}`);
  lines.push(`# TYPE ${metric.name} ${metric.kind}`);

  if (metric.kind === "counter") {
    // Counter: _total 后缀
    const name = metric.name.endsWith("_total") ? metric.name : `${metric.name}_total`;
    for (const entry of metric.entries) {
      const labelStr = formatLabels(entry.labels);
      lines.push(`${name}${labelStr} ${entry.value}`);
    }
  } else if (metric.kind === "gauge") {
    for (const entry of metric.entries) {
      const labelStr = formatLabels(entry.labels);
      lines.push(`${metric.name}${labelStr} ${entry.value}`);
    }
  } else if (metric.kind === "histogram") {
    // Histogram: 输出 _bucket, _sum, _count
    for (const histEntry of metric.histogramEntries ?? []) {
      const labelStrBase = formatLabels(histEntry.labels);
      for (const bc of histEntry.bucketCounts) {
        lines.push(`${metric.name}_bucket{le="${bc.threshold}"${labelStrBase ? "," + labelStrBase.slice(1, -1) : ""}} ${bc.count}`);
      }
      lines.push(`${metric.name}_bucket{le="+Inf"${labelStrBase ? "," + labelStrBase.slice(1, -1) : ""}} ${histEntry.count}`);
      lines.push(`${metric.name}_sum${labelStrBase} ${histEntry.sum}`);
      lines.push(`${metric.name}_count${labelStrBase} ${histEntry.count}`);
    }
  }

  return lines;
}

/** 格式化 label set 为 Prometheus label format: {key="value",...} */
function formatLabels(labels: Record<string, string | undefined>): string {
  const entries = Object.entries(labels).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => `${k}="${v}"`);
  return `{${parts.join(",")}}`;
}

/**
 * 构建 Recording Rules 建议列表（1.md §23）。
 * 这些规则可配置到 Prometheus 中，预先计算常用查询。
 */
export function getRecordingRulesSuggestions(): readonly RecordingRule[] {
  return RECORDING_RULES;
}

interface RecordingRule {
  readonly name: string;
  readonly expr: string;
}

const RECORDING_RULES: readonly RecordingRule[] = [
  {
    name: "runtime:cpu_used:rate5m",
    expr: "avg_over_time(screeps_runtime_cpu_used[5m])",
  },
  {
    name: "runtime:bucket:avg5m",
    expr: "avg_over_time(screeps_runtime_cpu_bucket[5m])",
  },
  {
    name: "kernel:process_failed:rate5m",
    expr: "rate(screeps_kernel_process_failed_total[5m])",
  },
  {
    name: "economy:energy_net:avg5m",
    expr: "avg_over_time(screeps_economy_energy_net[5m])",
  },
  {
    name: "spawn:queue_length:avg5m",
    expr: "avg_over_time(screeps_spawn_queue_length[5m])",
  },
  {
    name: "creep:alive:avg5m",
    expr: "avg_over_time(screeps_creep_alive[5m])",
  },
  {
    name: "logistics:delivery_efficiency:avg5m",
    expr: "avg_over_time(screeps_logistics_delivery_efficiency_ratio[5m])",
  },
] as const;
