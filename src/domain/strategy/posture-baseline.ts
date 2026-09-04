/** 环境自适应姿态基线 — 根据环境画像选择 posture 参数的基线覆盖（纯函数，不访问 Game/Memory）。 */

import type { PostureOptions } from "./posture";

/** 环境画像输入（与 EnvironmentProfile 字段对齐，但作为独立接口避免耦合）。 */
export interface EnvBaselineInput {
  /** 市场活跃度：active / moderate / thin。 */
  marketActivity: "active" | "moderate" | "thin";
  /** 邻居竞争压力：high / medium / low。 */
  neighborPressure: "high" | "medium" | "low";
  /** GCL 进度速率（progress/tick）。 */
  gclProgressRate: number;
  /** 是否有活跃威胁（empire-strategy 传入，来自 posture 评估的 rooms 信号）。 */
  hasLiveThreat: boolean;
}

/**
 * 根据环境画像推导 posture 参数基线覆盖。
 *
 * 合并链：DEFAULT_POSTURE_OPTIONS → CONFIG.posture → **本函数输出** → strategyOverrides
 *
 * 设计原则：
 * - 只覆盖需要环境感知的参数，其余参数不返回（保持 CONFIG 默认）
 * - 覆盖值在 STRATEGY_BOUNDS 边界内（由 strategy-reviewer 的 clampStrategyParam 保证）
 * - 高压环境更保守（缩短扩张窗口、提高门槛），低压环境更激进
 * - CPU 紧张环境通过 capacity 系统已有分档，此处不重复
 */
export function selectEnvBaseline(
  env: EnvBaselineInput,
): Partial<PostureOptions> {
  const overrides: Partial<PostureOptions> = {};

  // ── 邻居压力 → 威胁/战争参数 ──
  switch (env.neighborPressure) {
    case "high":
      // 密集 PvP 区：威胁记忆窗口缩短（快速恢复扩张），战争耐心拉长（打得起才升级）
      overrides.threatWindow = 1500;
      overrides.warPatience = 7000;
      // 扩张更保守（邻居多 = 好房子少 + 容易被偷）
      overrides.expandMinBucket = 8000;
      overrides.expandMaxPressure = 0.3;
      break;
    case "medium":
      // 中等密度：保持默认值（CONFIG.posture 已覆盖）
      break;
    case "low":
      // 空旷安全区：威胁窗口拉长（少被打扰），战争耐心缩短（不值得长期战争）
      overrides.threatWindow = 5000;
      overrides.warPatience = 3000;
      // 扩张更激进（好房子多 + 安全）
      overrides.expandMinBucket = 6000;
      overrides.expandMaxPressure = 0.5;
      break;
  }

  // ── 市场活跃度 → 扩张 CPU 比例 ──
  // 市场活跃 = 可以靠买补缺口，扩张 CPU 余量可以收窄
  // 市场萧条 = 必须自给自足，扩张 CPU 余量保持保守
  switch (env.marketActivity) {
    case "active":
      overrides.expandMaxCpuRatio = 0.65; // 市场可兜底，稍微激进
      break;
    case "moderate":
      // 保持默认
      break;
    case "thin":
      overrides.expandMaxCpuRatio = 0.55; // 市场不可靠，多留余量
      break;
  }

  // ── GCL 速率 → 扩张门槛 ──
  // GCL 快速增长 = 玩家在积极冲级，扩张可以跟进
  // GCL 停滞 = 冲级停止，扩张也应放缓（没有 GCL 余量 claim 新房）
  // 注意：gclProgressRate=0 既可能是停滞也可能是首次采样（无 prev 数据），
  // 用 gclProgressRate < 0 作为「停滞」的判定（首次采样 = 0 不触发）。
  if (env.gclProgressRate > 0.0001) {
    // 有 GCL 进展 → 扩张门槛微降（可更快扩张）
    if (env.neighborPressure !== "high") {
      overrides.expandMinBucket = Math.max(
        5000,
        (overrides.expandMinBucket ?? 7000) - 500,
      );
    }
  }
  // GCL 速率无法区分停滞 vs 首次采样 → 不做「停滞」判定，
  // 避免新世界 / global reset 后误升扩张门槛。

  return overrides;
}
