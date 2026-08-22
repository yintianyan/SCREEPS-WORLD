/**
 * 【F1/G-E】指标四元组目录（FREEZE §12 / 研究文档 21 号）。
 * 规则：每个进入遥测的指标必须在此登记 {name, source, consumer, action}——
 * 无 consumer/action 的指标不许存在（防虚荣指标与观测税）。
 * 本目录 v1 登记「已存在」的指标；新增指标必须同步登记。
 */

/** 指标消费后可触发的行动类型（约束 action 字段的取值域）。 */
export type MetricAction =
  | "capacity-downgrade" // 触发 capacity 分档下移
  | "agenda-switch"     // 触发议程切换评估
  | "aid-trigger"       // 触发跨房互济
  | "contraction"       // 触发结构性收缩议程
  | "audit";            // 仅审计/复盘用途（须说明理由）

export interface MetricEntry {
  /** 指标键（telemetry/timeseries 中的实际字段路径）。 */
  name: string;
  /** 采集源（哪个模块写入）。 */
  source: string;
  /** 主要消费者。 */
  consumer: string;
  /** 绑定行动。 */
  action: MetricAction | string;
}

export const METRICS_CATALOG: readonly MetricEntry[] = [
  { name: "cpu.usedTick", source: "kernel/telemetry", consumer: "watchdog", action: "capacity-downgrade" },
  { name: "cpu.p99", source: "timeseries.cpu", consumer: "capacity", action: "capacity-downgrade" },
  { name: "bucket", source: "Game.cpu", consumer: "scheduler.tier", action: "capacity-downgrade" },
  { name: "memory.bytes", source: "RawMemory", consumer: "maintenance", action: "contraction" },
  { name: "errors.rate", source: "safe-run", consumer: "expectations", action: "audit" },
  { name: "net.energy", source: "room-state/economy", consumer: "agenda", action: "agenda-switch" },
  { name: "spawn.queueDepth", source: "spawn-manager", consumer: "spawn-starved detector", action: "contraction" },
  { name: "task.ageP95", source: "assignment-service", consumer: "logistics gate", action: "audit" },
  { name: "hauler.emptyRate", source: "role-runner", consumer: "unified-pool trigger", action: "audit" },
  { name: "link.lossTotal", source: "link-system", consumer: "economy audit", action: "audit" },
  { name: "terminal.freightShare", source: "terminal-manager", consumer: "economy audit", action: "audit" },
  { name: "expansion.successRate", source: "ExpansionOutcome 台账", consumer: "rhythm-adaptive (R7b)", action: "contraction" },
  { name: "war.spendRate", source: "war-planner", consumer: "fortify exit", action: "agenda-switch" },
  { name: "threat.level", source: "defense FSM", consumer: "posture", action: "agenda-switch" },
  { name: "intel.freshCoverage", source: "prospect/intel", consumer: "prospect scheduler", action: "audit" },
];

/** 目录完整性自检用：全部 name 唯一。 */
export function assertCatalogUnique(): void {
  const seen = new Set<string>();
  for (const m of METRICS_CATALOG) {
    if (seen.has(m.name)) throw new Error("duplicate metric in catalog: " + m.name);
    seen.add(m.name);
  }
}