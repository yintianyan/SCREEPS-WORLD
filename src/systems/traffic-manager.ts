/** Traffic Manager — 后置系统（phase=post，P0）。 */

import type { RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import { safeRun } from "../kernel/safe-run";
import { trafficEnabled } from "../creeps/movement/intent";
import { recordTraffic } from "../creeps/movement/traffic";
import { invalidateCreepPath } from "../creeps/movement/pathfinding";
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
        // 一次性建占位表：优先从 snapshot.creepPositions 读取（零额外 find），
        // 消除独立 room.find(FIND_CREEPS) 扫描（~0.3 CPU/tick）。
        // snapshot 只含自有房；远矿/过境房无 snapshot → 回退 find。
        const snapshot = ctx.getSnapshot(roomName);
        if (snapshot?.creepPositions) {
          for (const [packed, info] of snapshot.creepPositions) {
            b.occupancy.set(packed, info.name);
            if (!info.my || info.fatigue > 0) b.immovable.add(info.name);
          }
        } else {
          const room = Game.rooms[roomName];
          if (room && typeof room.find === "function") {
            for (const c of room.find(FIND_CREEPS)) {
              b.occupancy.set(c.pos.x * 50 + c.pos.y, c.name);
              if (!c.my || c.fatigue > 0) b.immovable.add(c.name);
            }
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
      // 快路径：单房仅 1 个移动意图且无锚定时，目标格未被占 → 直接签发，跳过完整解算。
      if (batch.intents.length <= 1 && batch.anchors.size === 0) {
        if (batch.intents.length === 1) {
          const intent = batch.intents[0]!;
          const creep = Game.creeps[intent.name];
          if (creep && !batch.immovable.has(intent.name)) {
            const occupied = batch.occupancy.get(intent.to);
            if (occupied === undefined) {
              const tx = Math.floor(intent.to / 50);
              const ty = intent.to % 50;
              const dir = creep.pos.getDirectionTo(tx, ty);
              if (dir) {
                const result = creep.move(dir);
                if (result === OK || result === ERR_TIRED) {
                  recordTraffic(creep);
                } else if (result !== ERR_BUSY) {
                  invalidateCreepPath(intent.name);
                }
              }
              continue;
            }
          }
        }
        // 无可签发意图或目标被占 → 走完整解算。
        if (batch.intents.length === 0) continue;
      }
      safeRun(`traffic-manager/${roomName}`, () => resolveAndDispatch(roomName, batch, ctx.getSnapshot(roomName)), false);
    }
  },
};

function resolveAndDispatch(roomName: string, batch: RoomBatch, snapshot: RoomSnapshot | undefined): void {
  const room = Game.rooms[roomName];
  if (!room) return;
  // 能力守卫：精简 room mock（单元测试）无 getTerrain 时跳过 —
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
    // 防御纵深：意图目标格是不可站立结构格（如 rampart 叠盾下的 spawn —
    // 路径矩阵一旦有洞，穿结构的意图会被解算器放行、引擎逐 tick 拒绝，
    // 车队在其身后永久冻结）时在入口剔除。被剔除的 creep 本 tick 原地，
    // 位置不变 → stuckTicks 累积 → Level 1+ 强制重算路径自愈。
    intents: batch.intents.filter(it => !parkData?.blocking.has(it.to)),
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
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
    } else if (result !== ERR_BUSY) {
      // v33：引擎拒绝签发（目标格被静态阻挡 — 新墙/新落成结构/敌方结构）→
      // 立即失效该 creep 的持久化路径，下一 tick 强制重算绕行。陈旧路径每 tick
      // 撞同一堵墙时，仅靠 stuck 计时器自愈要数百 tick（线上实证 W36S58 钉死事件）。
      // ERR_BUSY（孵化中）不失效；占用冲突由解算器提前仲裁，一般不走到这里。
      invalidateCreepPath(name);
    }
  }
}
