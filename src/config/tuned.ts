/**
 * Tuned Config — 运行时参数覆盖层。
 *
 * 设计意图：不修改静态 CONFIG，而是在其之上叠加由 tuning-engine
 * 产生的运行时覆盖值。消费者通过 getRoleBounds() 查询，
 * 先查 Memory.kernel.tuning 中的覆盖值，回退到 CONFIG 默认值。
 *
 * 数据流：
 *   CONFIG (静态基线) ← getRoleBounds() ← demand.ts / spawn-manager.ts
 *                          ↑
 *   Memory.kernel.tuning.rooms[roomName].roleBounds (运行时覆盖)
 *                          ↑
 *   tuning-engine (每 500 tick 更新)
 *
 * 安全保证：
 *   - 覆盖值永远在 TUNING_BOUNDS 的 floor/ceiling 范围内。
 *   - 无 Memory / global reset 后自动回退到 CONFIG 默认值。
 *   - 消费者不需要感知调优系统的存在——只是换个函数读参数。
 */

import { CONFIG } from "./index";
import { clampParam } from "../domain/tuning/bounds";

/** 角色 → 参数路径映射，用于 clampParam 安全钳制。 */
const ROLE_PARAM_MAP: Readonly<Record<string, { min: string; max: string }>> = {
  hauler: { min: "hauler.minCount", max: "hauler.maxCount" },
  harvester: { min: "harvester.minCount", max: "harvester.maxCount" },
  upgrader: { min: "upgrader.minCount", max: "upgrader.maxCount" },
  builder: { min: "builder.minCount", max: "builder.maxCount" },
};

/**
 * 获取角色的有效数量边界（CONFIG 默认 + 运行时覆盖）。
 *
 * @param role     角色名（如 "hauler"）
 * @param roomName 房间名（可选，用于查 per-room 覆盖）
 * @returns { minCount, maxCount } 合并后的有效值
 */
export function getRoleBounds(
  role: string,
  roomName?: string,
): { minCount: number; maxCount: number } {
  const configBounds = CONFIG.roles[role as keyof typeof CONFIG.roles];
  if (!configBounds) {
    return { minCount: 0, maxCount: 0 };
  }

  let minCount: number = configBounds.minCount;
  let maxCount: number = configBounds.maxCount;

  // 查询运行时覆盖值
  if (roomName) {
    const roomTuning = Memory.kernel?.tuning?.rooms?.[roomName]?.roleBounds?.[role];
    if (roomTuning) {
      if (roomTuning.minCount !== undefined) minCount = roomTuning.minCount;
      if (roomTuning.maxCount !== undefined) maxCount = roomTuning.maxCount;
    }
  }

  // 安全钳制：确保覆盖值不超出硬边界
  const paramMap = ROLE_PARAM_MAP[role];
  if (paramMap) {
    minCount = clampParam(paramMap.min, minCount);
    maxCount = clampParam(paramMap.max, maxCount);
  }

  // 不变性：minCount <= maxCount
  if (minCount > maxCount) {
    minCount = maxCount;
  }

  return { minCount, maxCount };
}

/**
 * 获取所有角色的有效边界（用于 demand.ts 的批量查询）。
 */
export function getAllRoleBounds(
  roomName?: string,
): Record<string, { minCount: number; maxCount: number }> {
  const result: Record<string, { minCount: number; maxCount: number }> = {};
  for (const role of Object.keys(CONFIG.roles)) {
    result[role] = getRoleBounds(role, roomName);
  }
  return result;
}
