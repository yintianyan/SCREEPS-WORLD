/** 交通热度记录 — 供道路规划器使用。 */

import { globalCache } from "../../kernel/global-cache";

/** 将 RoomPosition 压缩为单个数字：x * 50 + y。 */
export function packPos(pos: RoomPosition): number {
  return pos.x * 50 + pos.y;
}

/**
 * 记录 creep 当前位置的交通热度。
 * 每次成功移动（OK 或 ERR_TIRED）后调用。
 */
export function recordTraffic(creep: Creep): void {
  const g = globalCache();
  if (!g.roomTraffic) g.roomTraffic = {};
  const roomName = creep.room.name;
  if (!g.roomTraffic[roomName]) g.roomTraffic[roomName] = {};
  const key = String(creep.pos.x * 50 + creep.pos.y);
  g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
}
