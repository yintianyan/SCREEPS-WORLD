/**
 * Empire Economy 瘦快照契约 — 写端（empire-economy 系统）与读者（empire-health/
 * telemetry）共用的唯一类型与缩放真源。只存必要 Summary，不复制完整 RoomState。
 */

/** Empire Economy 瘦快照（写入 Memory.kernel.empireEconomy）。 */
export interface EmpireEconomySnapshot {
  /** 采样 tick。 */
  t: number;
  /** 帝国总能量。 */
  te: number;
  /** 帝国总生产 ×10。 */
  tp: number;
  /** 帝国总净流 ×100。 */
  nf: number;
  /** 帝国总储备。 */
  tr: number;
  /** 最差风险缓冲 ×10。 */
  rb: number;
  /** 平均效率 ×100。 */
  ef: number;
  /** 健康度枚举编码。 */
  h: number;
  /** deficit 房间数。 */
  dr: number;
  /** surplus 房间数。 */
  sr: number;
  /** 是否有 Imbalance。 */
  im: number;
  /** 扩张就绪度枚举编码。 */
  er: number;
  /** 安全边际分数 ×100。 */
  sm: number;
  /** 扩张预算。 */
  eb: number;
  /** 自由预算。 */
  fb: number;
  /** 储备预算。 */
  rr: number;
  /** 多资源帝国健康度编码。 */
  mh: number;
  /** 是否有矿物缺口（0/1）。 */
  md: number;
  /** 瓶颈资源编码（0 = energy, 1-7 = U/L/K/Z/O/H/X, 99 = none）。 */
  bn: number;
  /** 最差矿物健康度编码。 */
  wmh: number;
}

/** 缩放键的缩放倒数表 — 写端乘数与读者除数的唯一真源；×1 字段直读即真值。 */
export const EMPIRE_ECONOMY_SCALE = { tp: 10, nf: 100, rb: 10, ef: 100, sm: 100 } as const;

/** 健康度编码（节省 Memory 字符）；读端经 HEALTH_NAMES_BY_CODE 反查。 */
export const HEALTH_CODES: Record<string, number> = {
  critical: 0,
  deficit: 1,
  stable: 2,
  growing: 3,
  healthy: 4,
};

/** 编码 → 名称反查表（由 HEALTH_CODES 派生，顺序即码值升序）。 */
export const HEALTH_NAMES_BY_CODE: readonly string[] = Object.entries(HEALTH_CODES)
  .sort((a, b) => a[1] - b[1])
  .map(([name]) => name);
