/**
 * Tuned Config — 运行时参数覆盖层：不改静态 CONFIG，在其上叠加 tuning-engine
 * 产生的运行时覆盖值。消费者经 getRoleBounds() 查询：先查
 * Memory.kernel.tuning 覆盖值，回退到 CONFIG 默认。
 * 安全保证：覆盖值永远在 TUNING_BOUNDS 的 floor/ceiling 范围内；无 Memory /
 * global reset 后自动回退 CONFIG 默认；消费者无需感知调优系统的存在。
 */

import { CONFIG } from "./index";
import { clampParam } from "../domain/tuning/bounds";

/**
 * 可调优角色全集 — 与 CONFIG.roles 的 key 集合对齐（role-config-parity 测试
 * 已断言 CONFIG.roles 与 bootstrap 注册表双向一致）。单一来源：ROLE_PARAM_MAP
 * 与 tuning-engine 的 bounds 快照循环都从本数组派生，避免双源漂移
 * （P1-I 评审修正：原稿 7 角色 map 与 4 角色快照双漂移）。
 * TUNING_BOUNDS（domain/tuning/bounds.ts）目前只为前 4 角色
 * （hauler/harvester/upgrader/builder）配置 floor/ceiling，其余角色的
 * clampParam 是 no-op — 补全集是防未来 tuning 接管新角色时漏配钳制规则
 * 写出离谱值的前置准备。
 */
export const TUNABLE_ROLES = [
  "hauler",
  "harvester",
  "upgrader",
  "builder",
  "remoteHarvester",
  "remoteHauler",
  "reserver",
  "distributor",
  "worker",
  "defender",
  "remoteDefender",
  "claimer",
  "scout",
  "mineralMiner",
  "attacker",
  "healer",
  "pbCollector",
  "coreClearer",
] as const;

/** 角色 → 参数路径映射，用于 clampParam 安全钳制。从 TUNABLE_ROLES 派生。 */
const ROLE_PARAM_MAP: Readonly<Record<string, { min: string; max: string }>> = Object.fromEntries(
  TUNABLE_ROLES.map(role => [role, { min: `${role}.minCount`, max: `${role}.maxCount` }]),
);

/**
 * 获取角色的有效数量边界（CONFIG 默认 + 运行时覆盖）。
 * roomName 可选，用于查 per-room 覆盖。
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
