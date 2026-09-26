/** 交通热度记录 — 供道路规划器使用。 */

import { globalCache } from "../../kernel/global-cache";
import { packPos as layoutPackPos } from "../../domain/layout/types";

/**
 * 将 RoomPosition 压缩为单个数字 —— 全仓唯一编码是 `x * 50 + y`（与引擎 CostMatrix 同序），
 * 算术只在 `domain/layout/types.packPos` 一处，本函数仅是 RoomPosition 形态的适配器。
 */
export function packPos(pos: Pick<RoomPosition, "x" | "y">): number {
  return layoutPackPos(pos.x, pos.y);
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
  const key = String(packPos(creep.pos));
  g.roomTraffic[roomName][key] = (g.roomTraffic[roomName][key] ?? 0) + 1;
}
