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
  /** 有视野且 controller 被预定时记录的预定者名（区分己方/敌方续期与拉锯）。 */
  reservedBy?: string;
  /** 有视野时记录的敌方 tower 数（进攻/远矿风险评估的核心变量）。 */
  towers?: number;
  /** 危险冷却到期 tick：远矿房出现威胁时标记，冷却期内不作为远矿/扩张候选。 */
  dangerUntil?: number;
  /** home 锚点到该房中心的 PathFinder 实测成本（swampCost:5 计入地形）。
   * 远矿评选的通勤账本 — 地形静态，算一次终身缓存（room-observer 逐 tick
   * 补算）；缺失时评选方回退线性距离估算。 */
  pathCost?: number;
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

/** 扫描单个邻房的情报。visibleRoom 为 undefined 时只落房名分类与房态。
 *
 * prev：既有条目 — 跨刷新保留的字段（dangerUntil；无视野时还保留上次的
 * sources/mineral/owner/towers 观测值）。不传则视为首次建档。
 * 危险标记必须跨刷新存活：它由威胁事件写入，常规情报刷新不得冲掉。
 */
export function scanNeighborIntel(
  roomName: string,
  status: string,
  tick: number,
  visibleRoom?: {
    sources: number;
    mineralType?: string;
    owner?: string;
    reservation?: string;
    towers?: number;
  },
  prev?: RoomIntel,
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
    // reservedBy 与 owner 同模式：有视野且被预定则记录，否则不设（=清除）——
    // 有视野确认无预定即视为预定已失效，让评选/维护立即恢复该房资格。
    if (visibleRoom.reservation) intel.reservedBy = visibleRoom.reservation;
    if (visibleRoom.towers !== undefined) intel.towers = visibleRoom.towers;
  } else if (prev) {
    // 无视野：沿用上次观测值（数据会随 lastSeen 保持但陈旧度由消费方判断）。
    if (prev.sources !== undefined) intel.sources = prev.sources;
    if (prev.mineral !== undefined) intel.mineral = prev.mineral;
    if (prev.owner !== undefined) intel.owner = prev.owner;
    if (prev.reservedBy !== undefined) intel.reservedBy = prev.reservedBy;
    if (prev.towers !== undefined) intel.towers = prev.towers;
    // 无视野时 lastSeen 不应前移（视野数据没有更新）。
    intel.lastSeen = prev.lastSeen;
  }
  // 危险冷却：未到期则保留（与视野无关 — 由威胁事件独立管理）。
  if (prev?.dangerUntil !== undefined && tick < prev.dangerUntil) {
    intel.dangerUntil = prev.dangerUntil;
  }
  // 通勤成本：地形静态，终身保留（由 room-observer 一次性计算，刷新不冲掉）。
  if (prev?.pathCost !== undefined) {
    intel.pathCost = prev.pathCost;
  }
  return intel;
}
