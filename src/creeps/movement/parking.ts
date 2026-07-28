/**
 * 归位（Parking）— 非站桩角色 idle 时主动离开关键格/道路，根治交通阻塞。
 *
 * 根因：role-runner 在无匹配候选时设 mode=idle 后 return，creep 原地石化。
 * 它停在「最后一次干活的位置」——可能是 source 旁（堵矿工）、spawn 前（堵孵化出口）、
 * 工地旁（堵 builder）、road 上（堵所有过路 creep）。idle 位置是路径无关的随机残留，
 * 无法预测，只能用统一的归位行为收拢。
 *
 * 设计原则（方案 C 通用算法）：
 *   - 停车位完全从 per-room 实时快照推导（snapshot 的结构/工地 + room 地形 + 实时 creep 位置），
 *     不预设任何位置表，不引用其他房间数据。算法对任意房间地形成立。
 *   - 站桩角色（harvester/upgrader）不参与——它们的 idle 是守在矿位/controller 旁，
 *     本就正确。仅 hauler/distributor/builder/worker 归位（由 role-runner 的 park 标志控制）。
 *
 * 安全性判定（isSafeSpot）：当前位置同时满足
 *   1. 不是关键格（source/controller/spawn/storage/工地 旁 range≤1）
 *   2. 不在 road 上（road 是交通主干道，停上面挡移动方）
 *   → 已经安全则不动（避免每 tick 重新寻路浪费 CPU + 防振荡）。
 *
 * 归位策略（findParkSpot）：8 邻域选最优格，评分优先级
 *   非关键格 > 非 road > 靠近核心（spawn 方向，缩短下次出勤通勤）。
 *   只在邻域内单步移动——归位是「让出关键格/道路」，不是「长途跋涉找完美停车位」。
 *
 * 防聚堆：__parkReservations 每 tick 重置，已安全/已选目标的 creep 预约各自格子，
 *   多 creep 不会抢同一格、不会互相把对方挤来挤去（振荡）。
 *
 * 数据来源约束：结构/工地/道路全部来自 RoomSnapshot（per-tick 预构建，O(1) 查询），
 *   仅「实时 creep 占位」用 room.lookForAt(LOOK_CREEPS)（快照不含其他 creep 的瞬时位置）。
 *   不做 lookForAt(LOOK_STRUCTURES) — 避免与快照重复扫描，且保证测试与生产同源。
 */

import { globalCache } from "../../kernel/global-cache";
import type { RoomSnapshot } from "../../kernel/contracts";
import { packPos, recordTraffic } from "./traffic";
import { DIR_DELTA, checkAndExecuteYield } from "./stuck-recovery";

/** 归位预约缓存：本 tick 已被占用的目标格（packed pos 集合），每 tick 重置。 */
function getParkReservations(): Set<number> {
  const g = globalCache() as any;
  if (!g.__parkReservations || g.__parkReservationsTick !== Game.time) {
    g.__parkReservations = new Set<number>();
    g.__parkReservationsTick = Game.time;
  }
  return g.__parkReservations as Set<number>;
}

/** 每房每 tick 的归位推导数据：关键格、road 格、阻挡结构格。从快照一次构建。 */
interface ParkRoomData {
  critical: Set<number>;
  roads: Set<number>;
  blocking: Set<number>;
}

/**
 * 从快照构建本房归位数据（每房每 tick 缓存一次）。
 *
 * - critical：站桩工作位 + 结构出口旁（source/controller/spawn/storage/工地 的 range≤1 邻域）。
 *   idle creep 停在这些格会阻塞生产/孵化/建造。
 * - roads：道路格（交通主干道，idle 停上面挡移动方）。
 * - blocking：不可站立的阻挡结构格（墙/extension/tower 等；road/container/rampart 可站立不算）。
 *
 * 全部从 per-room 快照推导，对任意房间地形自适应，不依赖预设位置表。
 */
function getParkRoomData(snapshot: RoomSnapshot): ParkRoomData {
  const g = globalCache() as any;
  if (!g.__parkRoomData) g.__parkRoomData = {};
  const cached = g.__parkRoomData[snapshot.roomName];
  if (cached && cached.tick === Game.time) return cached.data as ParkRoomData;

  const critical = new Set<number>();
  const markAround = (x: number, y: number): void => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx <= 49 && ny >= 0 && ny <= 49) critical.add(nx * 50 + ny);
      }
    }
  };
  for (const s of snapshot.sources) markAround(s.pos.x, s.pos.y);
  if (snapshot.controller) markAround(snapshot.controller.pos.x, snapshot.controller.pos.y);
  for (const sp of snapshot.spawns) markAround(sp.pos.x, sp.pos.y);
  if (snapshot.storage) markAround(snapshot.storage.pos.x, snapshot.storage.pos.y);
  for (const site of snapshot.myConstructionSites) markAround(site.pos.x, site.pos.y);

  const roads = new Set<number>();
  for (const r of snapshot.roads) roads.add(packPos(r.pos));

  const blocking = new Set<number>();
  const addIfBlocking = (type: string, x: number, y: number): void => {
    // road/container/rampart 可站立（creep 能停上面），其余结构阻挡归位。
    if (
      type !== STRUCTURE_ROAD &&
      type !== STRUCTURE_CONTAINER &&
      type !== STRUCTURE_RAMPART
    ) {
      blocking.add(x * 50 + y);
    }
  };
  const allStructures: readonly { structureType: string; pos: RoomPosition }[] = [
    ...snapshot.spawns, ...snapshot.extensions, ...snapshot.towers, ...snapshot.containers,
    ...snapshot.roads, ...snapshot.walls, ...snapshot.ramparts, ...snapshot.links,
    ...snapshot.labs,
  ];
  for (const s of allStructures) addIfBlocking(s.structureType, s.pos.x, s.pos.y);
  if (snapshot.storage) addIfBlocking(snapshot.storage.structureType, snapshot.storage.pos.x, snapshot.storage.pos.y);
  if (snapshot.terminal) addIfBlocking(snapshot.terminal.structureType, snapshot.terminal.pos.x, snapshot.terminal.pos.y);
  if (snapshot.extractor) addIfBlocking(snapshot.extractor.structureType, snapshot.extractor.pos.x, snapshot.extractor.pos.y);
  if (snapshot.factory) addIfBlocking(snapshot.factory.structureType, snapshot.factory.pos.x, snapshot.factory.pos.y);
  for (const site of snapshot.myConstructionSites) addIfBlocking(site.structureType, site.pos.x, site.pos.y);

  const data: ParkRoomData = { critical, roads, blocking };
  g.__parkRoomData[snapshot.roomName] = { tick: Game.time, data };
  return data;
}

/** 地形是否可站立（非墙）。边界外视为墙。 */
function isWalkableTerrain(room: Room, x: number, y: number): boolean {
  if (x < 0 || x > 49 || y < 0 || y > 49) return false;
  return room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL;
}

/** 该格是否被 creep 占用（实时位置，快照不含其他 creep 瞬时位置）。 */
function hasCreepAt(room: Room, x: number, y: number): boolean {
  return (room.lookForAt(LOOK_CREEPS, x, y) as Creep[]).length > 0;
}

/**
 * 判断 creep 当前位置是否已安全（不需要归位）。
 * 安全 = 非关键格 且 非 road。
 */
export function isSafeSpot(creep: Creep, snapshot: RoomSnapshot): boolean {
  const packed = packPos(creep.pos);
  const data = getParkRoomData(snapshot);
  if (data.critical.has(packed)) return false;
  if (data.roads.has(packed)) return false;
  return true;
}

/**
 * 8 邻域选最优归位格。返回目标格坐标，无可用格则 undefined。
 *
 * 评分（越小越优）：
 *   +1000 关键格（绝不去——会把一个阻塞换成另一个阻塞）
 *   +100  road（尽量避开主干道）
 *   +到核心距离（靠近 spawn，缩短下次出勤通勤；无 spawn 时此项为 0）
 */
function findParkSpot(
  creep: Creep,
  snapshot: RoomSnapshot,
  data: ParkRoomData,
  reserved: Set<number>,
): { x: number; y: number } | undefined {
  const room = creep.room;
  const coreX = snapshot.spawns[0]?.pos.x;
  const coreY = snapshot.spawns[0]?.pos.y;
  const currentPacked = packPos(creep.pos);
  const onBlockingTile = data.critical.has(currentPacked) || data.roads.has(currentPacked);

  const coreDist = (x: number, y: number): number =>
    coreX !== undefined && coreY !== undefined
      ? Math.max(Math.abs(x - coreX), Math.abs(y - coreY))
      : 0;

  // 收集可站立邻格（地形可走、无阻挡结构、无 creep、未被预约）。
  interface Candidate { x: number; y: number; critical: boolean; road: boolean; core: number }
  const candidates: Candidate[] = [];
  for (const dir of Object.keys(DIR_DELTA)) {
    const delta = DIR_DELTA[Number(dir) as DirectionConstant];
    if (!delta) continue;
    const nx = creep.pos.x + delta[0];
    const ny = creep.pos.y + delta[1];
    const packed = nx * 50 + ny;
    if (!isWalkableTerrain(room, nx, ny)) continue;
    if (data.blocking.has(packed)) continue;
    if (hasCreepAt(room, nx, ny)) continue;
    if (reserved.has(packed)) continue;
    candidates.push({ x: nx, y: ny, critical: data.critical.has(packed), road: data.roads.has(packed), core: coreDist(nx, ny) });
  }
  if (candidates.length === 0) return undefined;

  // 阶段 1（逃离）：当前在关键格/road 上时，只选「非关键且非 road」的真逃离格，
  //   其中取最靠近核心者（缩短下次出勤通勤）。这保证只要存在逃离格，一步就离开阻塞格，
  //   绝不会被 core 距离牵引进关键区深处振荡。
  if (onBlockingTile) {
    let escape: Candidate | undefined;
    for (const c of candidates) {
      if (c.critical || c.road) continue;
      if (!escape || c.core < escape.core) escape = c;
    }
    if (escape) return { x: escape.x, y: escape.y };
  }

  // 阶段 2（尽力外移）：无真逃离格（深陷 3×3 关键区中心，四邻皆关键）时，
  //   退而求其次：非关键格优先，再取最靠近核心者，逐 tick 向外走直到出现逃离格。
  let best: Candidate | undefined;
  for (const c of candidates) {
    if (!best) { best = c; continue; }
    if (c.critical !== best.critical) { if (!c.critical) best = c; continue; }
    if (c.road !== best.road) { if (!c.road) best = c; continue; }
    if (c.core < best.core) best = c;
  }
  return best ? { x: best.x, y: best.y } : undefined;
}

/**
 * 归位主入口 — role-runner 在 creep 无匹配候选（即将 idle）时调用。
 *
 * 行为：
 *   1. 已在安全格 → 预约本格，不动（防振荡 + 防重复寻路）。
 *   2. 在关键格/road 上 → 单步移到最优邻格并预约。
 *   3. 无可用邻格 → 不动（保持 idle，下 tick 再试）。
 *
 * 仅对非站桩角色调用（harvester/upgrader 不参与，由 role-runner 的 park 标志控制）。
 */
export function parkIdleCreep(creep: Creep, snapshot: RoomSnapshot): void {
  const room = creep.room;
  // 能力守卫：归位需要地形查询与 lookForAt（探测实时 creep 占位）。
  // 精简 room mock（角色单元测试）不实现这些方法时跳过归位——归位是尽力行为，
  // 缺失环境下保持原 idle 行为即可，不应让角色管线崩溃。
  if (typeof room.getTerrain !== "function" || typeof room.lookForAt !== "function") {
    return;
  }

  // MV-3：parked creep 优先响应让路请求 — idle creep 无任务在身，
  // 是最该让路的对象。原先 yield 只在 moveToTarget 开头检查，
  // parked creep 不走该入口 → 让路请求对静止目标永不生效，
  // 挡路只能靠移动方 ignoreCreeps:false 绕行。
  if (checkAndExecuteYield(creep)) return;

  const reserved = getParkReservations();
  const currentPacked = packPos(creep.pos);
  const data = getParkRoomData(snapshot);

  // 已安全：预约本格，不动。
  if (!data.critical.has(currentPacked) && !data.roads.has(currentPacked)) {
    reserved.add(currentPacked);
    return;
  }

  const spot = findParkSpot(creep, snapshot, data, reserved);
  if (!spot) return;

  reserved.add(spot.x * 50 + spot.y);
  const spotPos = room.getPositionAt(spot.x, spot.y);
  if (!spotPos) return;
  const dir = creep.pos.getDirectionTo(spotPos);
  const result = creep.move(dir as DirectionConstant);
  if (result === OK || result === ERR_TIRED) recordTraffic(creep);
}
