/**
 * Room Registry — A3.0 多房帝国执行基础（EMPIRE_SYSTEM_MODEL §1）。
 *
 * 帝国已知房间的注册表 — 维护自有房的运行时经济画像快照，
 * 供 Agenda Manager / Allocation Policy / Transport Planner 消费。
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 * 所有输入由参数注入（调用方 = 系统侧薄壳 agenda-manager）。
 */

import type { RoomEconomicProfile } from "../economy/room-profile";

/**
 * Room Registry Entry — 单房注册项。
 * 从 RoomEconomicProfile 派生的瘦结构（只保留跨房调度所需字段）。
 */
export interface RoomRegistryEntry {
  /** 房间名。 */
  roomName: string;
  /** 经济分类。 */
  economicClass: RoomEconomicProfile["economicClass"];
  /** RCL。 */
  rcl: number;
  /** 是否有 storage。 */
  hasStorage: boolean;
  /** 是否有 terminal。 */
  hasTerminal: boolean;
  /** storage 能量。 */
  storageEnergy: number;
  /** storage 容量。 */
  storageCapacity: number;
  /** storage 水位比例。 */
  storageRatio: number;
  /** 净流 EMA。 */
  netFlow: number;
  /** 估计收入。 */
  estimatedIncome: number;
  /** 效率系数。 */
  efficiency: number;
  /** 风险缓冲。 */
  riskBuffer: number;
  /** 是否困难态。 */
  isStruggling: boolean;
  /** 是否可对外输出。 */
  canExport: boolean;
  /** 是否需要援助。 */
  needsAid: boolean;
  /** 可调拨量（由 ownership.ts computeTransferable 计算）。 */
  transferable: number;
  /** 最近更新 tick。 */
  updatedAt: number;
}

/**
 * Room Registry — 帝国已知房间注册表。
 * Map 结构：roomName → RoomRegistryEntry。
 */
export type RoomRegistry = Map<string, RoomRegistryEntry>;

/**
 * 从 RoomEconomicProfile + 预计算的 transferable 创建/更新注册项。
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function makeRegistryEntry(
  profile: RoomEconomicProfile,
  transferable: number,
  tick: number,
): RoomRegistryEntry {
  return {
    roomName: profile.roomName,
    economicClass: profile.economicClass,
    rcl: profile.rcl,
    hasStorage: profile.hasStorage,
    hasTerminal: profile.hasTerminal,
    storageEnergy: profile.storageEnergy,
    storageCapacity: profile.storageCapacity,
    storageRatio: profile.storageRatio,
    netFlow: profile.netFlow,
    estimatedIncome: profile.estimatedIncome,
    efficiency: profile.efficiency,
    riskBuffer: profile.riskBuffer,
    isStruggling: profile.isStruggling,
    canExport: false, // 由调用方设置（需 canExportEnergy 判定）
    needsAid: false, // 由调用方设置（需 needsEnergyAid 判定）
    transferable,
    updatedAt: tick,
  };
}

/**
 * 获取 surplus 房间列表（可对外输出的房间）。
 * 按 transferable 降序排列（最富余的优先）。
 */
export function getSurplusRooms(registry: RoomRegistry): RoomRegistryEntry[] {
  const out: RoomRegistryEntry[] = [];
  for (const entry of registry.values()) {
    if (entry.canExport && entry.transferable > 0) {
      out.push(entry);
    }
  }
  out.sort((a, b) => b.transferable - a.transferable);
  return out;
}

/**
 * 获取 deficit 房间列表（需要援助的房间）。
 * 按 riskBuffer 升序排列（最危险的优先）。
 */
export function getDeficitRooms(registry: RoomRegistry): RoomRegistryEntry[] {
  const out: RoomRegistryEntry[] = [];
  for (const entry of registry.values()) {
    if (entry.needsAid) {
      out.push(entry);
    }
  }
  out.sort((a, b) => a.riskBuffer - b.riskBuffer);
  return out;
}

/**
 * 获取指定房间的注册项（不存在返回 undefined）。
 */
export function getRoom(registry: RoomRegistry, roomName: string): RoomRegistryEntry | undefined {
  return registry.get(roomName);
}

/**
 * 移除已失守的房间（empire-strategy / maintainMemory 检测到失守时调用）。
 */
export function removeRoom(registry: RoomRegistry, roomName: string): void {
  registry.delete(roomName);
}

/**
 * 清理终态：移除所有 isStruggling 且 transferable=0 的房间。
 * （实际清理由 maintainMemory 的失守房检测驱动，此处仅提供工具函数。）
 */
export function pruneInactive(registry: RoomRegistry): void {
  for (const [name, entry] of registry) {
    if (entry.transferable === 0 && entry.needsAid && entry.riskBuffer <= 0) {
      registry.delete(name);
    }
  }
}
