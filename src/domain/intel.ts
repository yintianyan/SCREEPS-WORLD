/**
 * 邻居房情报（C2：M7 远矿/扩张的数据源，零视野成本先行积累）。
 *
 * 老玩家认知：扩张选址依赖「邻房有什么」——source 数、矿物、归属、是否 SK 房。
 * 其中房名分类（highway/center/SK/normal）与房间状态（novice/respawn/closed）
 * 无需视野即可获得；source/矿物/归属需要视野（未来 scout/observer 补全）。
 *
 * 纯函数 — 不访问 Game/Memory，所有数据由调用方采集后传入。
 */

/** 邻房类型：普通房 / source keeper 房 / 中心房 / 公路房。 */
export type RoomKind = "normal" | "sk" | "center" | "highway";

/** 单个邻房的情报记录（存 RoomMemory.intel，短字段、有界）。 */
export interface RoomIntel {
  kind: RoomKind;
  /** Game.map.getRoomStatus 的 status（"normal" / "closed" / "novice" / "respawn"）。 */
  status: string;
  /** 有视野时记录的 source 数。 */
  sources?: number;
  /** 有视野时记录的矿物类型（如 "H" / "U" / "X"）。 */
  mineral?: string;
  /** 有视野且房间有主时记录的 owner 名。 */
  owner?: string;
  /** 最近更新 tick。 */
  lastSeen: number;
}

/**
 * 按房名分类房间（无需视野）。
 *
 * 官方地图规律：坐标个位（mod 10）决定房间性质——
 *   任一坐标 mod 10 == 0        → 公路房（highway，十字路口无 controller）
 *   双坐标 mod 10 == 5          → 中心房（center，3 source + 1 矿，无 controller）
 *   双坐标 mod 10 ∈ {4,5,6}     → source keeper 房（3 source，SK 把守）
 *   其余                        → 普通房（可 claim）
 */
export function classifyRoomByName(roomName: string): RoomKind {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!match) return "normal";
  const x = Number(match[2]) % 10;
  const y = Number(match[4]) % 10;
  if (x === 0 || y === 0) return "highway";
  if (x === 5 && y === 5) return "center";
  if (x >= 4 && x <= 6 && y >= 4 && y <= 6) return "sk";
  return "normal";
}

/** 扫描单个邻房的情报。visibleRoom 为 undefined 时只落房名分类与房态。 */
export function scanNeighborIntel(
  roomName: string,
  status: string,
  tick: number,
  visibleRoom?: {
    sources: number;
    mineralType?: string;
    owner?: string;
  },
): RoomIntel {
  const intel: RoomIntel = {
    kind: classifyRoomByName(roomName),
    status,
    lastSeen: tick,
  };
  if (visibleRoom) {
    intel.sources = visibleRoom.sources;
    if (visibleRoom.mineralType) intel.mineral = visibleRoom.mineralType;
    if (visibleRoom.owner) intel.owner = visibleRoom.owner;
  }
  return intel;
}
