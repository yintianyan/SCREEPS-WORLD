/**
 * 扩张计划/候选的 Memory 瘦结构 —— 类型契约唯一真源（自 types/global.d.ts 下沉，
 * Memory 缩写键保持不变：外部考古工具与既有读数零迁移）。
 * ⚠️`cr` 在此处是 cancelReason；RoomMemory.economy 的 `cr` 是 contractReserve ——
 * 两个缩写属于不同契约，各有 interface 归属，不再裸同形。
 */

/** 扩张计划的 Memory 瘦结构（只存 ID/枚举/少量数字/短 key）。 */
export interface ExpansionPlanMemory {
  /** 全局唯一 planId。 */
  pid: string;
  /** 候选房名。 */
  rn: string;
  /** Sponsor 房名。 */
  sr: string;
  /** 扩张动机。 */
  rs: string;
  /** 优先级。 */
  pr: string;
  /** 候选评分。 */
  sc: number;
  /** 估算总成本。 */
  tc: number;
  /** 回收周期（tick）。 */
  pb: number;
  /** ROI。 */
  roi: number;
  /** 风险分数。 */
  rk: number;
  /** 风险等级。 */
  rl: string;
  /** Plan 状态（受约束的枚举，不是自由字符串 —— 状态词写错曾被当成"删除计划"）。 */
  st: import("./plan").PlanStatus;
  /** 创建 tick。 */
  ca: number;
  /** 更新 tick。 */
  ua: number;
  /** 批准 tick。 */
  aa?: number;
  /** 取消原因。 */
  cr?: string;
  /** 连续满足 ready 的起始 tick（防抖计时；旧档缺失即从本轮重新起算）。 */
  rd?: number;
  /** 连续不满足 ready 的起始 tick（READY 降档计时）。 */
  nd?: number;
  /** 决策摘要。 */
  ex: string;
}

/** 扩张候选的 Memory 瘦结构。 */
export interface ExpansionCandidateMemory {
  /** 房名（稳定 key）。 */
  rn: string;
  /** Sponsor 房名。 */
  sr: string;
  /** 房间类型。 */
  k: string;
  /** 房态。 */
  rs: string;
  /** source 数。 */
  sc?: number;
  /** 矿物类型。 */
  mn?: string;
  /** 评分。 */
  s: number;
  /** 距离。 */
  d: number;
  /** 通勤成本。 */
  pc?: number;
  /** 最后观测 tick。 */
  ls: number;
  /** 候选状态。 */
  st: string;
  /** 发现 tick。 */
  da: number;
  /** 评估 tick。 */
  ea?: number;
  /** 否决原因。 */
  vr?: string;
}
