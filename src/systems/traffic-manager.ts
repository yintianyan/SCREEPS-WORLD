/**
 * Traffic Manager — 后置系统（phase=post，P0）。
 *
 * 在所有 creep 角色执行完毕后运行，消费本 tick 移动意图账本（intent.ts），
 * 按房间集中解算（traffic-resolver）后统一签发 creep.move。
 *
 * 职责边界：只做「意图 → 引擎 move」的仲裁与签发，不决定 creep 去哪
 *（那是角色层 + pathfinding 的职责）。开关关闭时首行 return（意图账本
 * 此时也为空，因 registerMove 已直通签发）。
 *
 * 逐房 safeRun 隔离：单房解算异常不连坐他房移动。
 */

import type { RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { safeRun } from "../kernel/safe-run";
import { trafficEnabled } from "../creeps/movement/intent";
import { recordTraffic } from "../creeps/movement/traffic";
import { getParkRoomData } from "../creeps/movement/parking";
import { resolveTraffic, type MoveIntent } from "../creeps/movement/traffic-resolver";

/** 8 邻域偏移（含斜向）。 */
const NEIGHBOR_DELTAS: readonly [number, number][] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

interface RoomBatch {
  intents: MoveIntent[];
  /** 本房全部 creep：packed 占位 → 名。 */
  occupancy: Map<number, string>;
  /** 疲劳/敌方不可动 creep 名。 */
  immovable: Set<string>;
  /** 本房锚定声明：名 → 优先级。 */
  anchors: Map<string, number>;
}

export const trafficManagerSystem: System = {
  name: "traffic-manager",
  priority: 0,
  phase: "post",
  run(ctx: TickContext): void {
    if (!trafficEnabled()) return;
    const ledger = globalCache().__moveIntents;
    if (!ledger || ledger.tick !== Game.time || ledger.intents.size === 0) return;

    // 按房分批：意图、占位、锚定、不可动名单。
    const batches = new Map<string, RoomBatch>();
    const ensureBatch = (roomName: string): RoomBatch => {
      let b = batches.get(roomName);
      if (!b) {
        b = { intents: [], occupancy: new Map(), immovable: new Set(), anchors: new Map() };
        batches.set(roomName, b);
        // 一次性建占位表：本房全部 creep（含敌方 — 敌方视为硬墙）。
        const room = Game.rooms[roomName];
        if (room && typeof room.find === "function") {
          for (const c of room.find(FIND_CREEPS)) {
            b.occupancy.set(c.pos.x * 50 + c.pos.y, c.name);
            // 敌方 creep 与疲劳中的己方 creep 不可移动、不可被推挤。
            if (!c.my || c.fatigue > 0) b.immovable.add(c.name);
          }
        }
      }
      return b;
    };

    for (const [name, intent] of ledger.intents) {
      const batch = ensureBatch(intent.roomName);
      batch.intents.push({ name, from: intent.from, to: intent.to, priority: intent.priority });
    }
    for (const [name, priority] of ledger.anchors) {
      const creep = Game.creeps[name];
      if (!creep) continue;
      ensureBatch(creep.room.name).anchors.set(name, priority);
    }

    // 逐房解算并签发。
    for (const [roomName, batch] of batches) {
      safeRun(`traffic-manager/${roomName}`, () => resolveAndDispatch(roomName, batch, ctx.getSnapshot(roomName)), false);
    }
  },
};

/** 解算单房并把批准的意图签发为 creep.move。 */
function resolveAndDispatch(roomName: string, batch: RoomBatch, snapshot: RoomSnapshot | undefined): void {
  const room = Game.rooms[roomName];
  if (!room) return;
  // 能力守卫：精简 room mock（单元测试）无 getTerrain/find 时跳过 —
  // 与 parking 的守卫同款，缺失环境下不让 P0 系统崩溃。
  if (typeof room.getTerrain !== "function") return;

  // 推挤落格候选：复用 parking 的关键格/road/阻挡口径，保证与归位同源。
  // 优先序：非关键且非 road > 非关键 > 其余（关键格/road 尽量不作落点）。
  // 外部房间（远矿/过境）无快照 → parkData 缺省，仅按地形筛格。
  const parkData = snapshot ? getParkRoomData(snapshot) : undefined;
  const terrain = room.getTerrain();
  const shoveCandidates = (tile: number): number[] => {
    const tx = Math.floor(tile / 50);
    const ty = tile % 50;
    const scored: { packed: number; score: number }[] = [];
    for (const [dx, dy] of NEIGHBOR_DELTAS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
      if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
      const packed = nx * 50 + ny;
      if (parkData?.blocking.has(packed)) continue; // 不可站立结构格。
      let score = 0;
      if (parkData?.critical.has(packed)) score += 100;
      if (parkData?.roads.has(packed)) score += 10;
      scored.push({ packed, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map(s => s.packed);
  };

  const { moves } = resolveTraffic({
    intents: batch.intents,
    anchors: batch.anchors,
    occupancy: batch.occupancy,
    immovable: batch.immovable,
    shoveCandidates,
  });

  for (const [name, targetPacked] of moves) {
    const creep = Game.creeps[name];
    if (!creep) continue;
    const tx = Math.floor(targetPacked / 50);
    const ty = targetPacked % 50;
    const dir = creep.pos.getDirectionTo(tx, ty);
    if (!dir) continue;
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) recordTraffic(creep);
  }
}
