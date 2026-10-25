/** Traffic Manager — 后置系统（phase=post，P0）。 */

import type { RoomSnapshot, System, TickContext } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import { recordSkip } from "../../kernel/memory";
import { safeRun, measuredRun } from "../../kernel/safe-run";
import { trafficEnabled } from "../../creeps/movement/intent";
import { recordIntent } from "../../kernel/telemetry";
import { recordTraffic } from "../../creeps/movement/traffic";
import { recordPathSuccess } from "../../creeps/movement/stuck-recovery";
import { invalidateCreepPath } from "../../creeps/movement/pathfinding";
import { getParkRoomData } from "../../creeps/movement/parking";
import { resolveTraffic, type MoveIntent } from "../../creeps/movement/traffic-resolver";

/** 8 邻域偏移（含斜向）。 */
const NEIGHBOR_DELTAS: readonly [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
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
      // 快路径（多意图）：目标格全空、互不重复、非阻挡结构格且无锚定时无冲突可解，
      // 直接逐条签发，跳过完整解算器（同格仲裁/推挤/环传播此时全为空操作）。
      if (tryFastDispatch(batch, ctx.getSnapshot(roomName))) continue;
      if (batch.intents.length === 0) continue;
      safeRun(
        `room/${roomName}/traffic`,
        // ⚠️必须套 measuredRun：safeRun 只管错误处理与冷却，**不记 CPU 跨度**，
        //   所以只写 safeRun 标签时 cpuPerTickByRoom 永远是空的（#45 的仪器第一次就踩了这个）。
        () =>
          measuredRun(`room/${roomName}/traffic`, () =>
            resolveAndDispatch(roomName, batch, ctx.getSnapshot(roomName)),
          ),
        false,
      );
    }
  },
};

/**
 * 快路径（多意图）：本房全部移动意图的目标格都未被占用、互不重复、不是阻挡结构格，
 * 且无锚定声明/疲劳个体时，逐条直接签发 move。完整解算器要做的同格仲裁、推挤与
 * 环传播在这种形状下全为空操作。任一条件不满足即回退 resolver——互换、跟车、
 * 目标被占、目标落到墙内结构格等旧形状仍走原路径（保守优先）。
 */
function tryFastDispatch(batch: RoomBatch, snapshot: RoomSnapshot | undefined): boolean {
  if (batch.anchors.size > 0) return false;
  const active = batch.intents.filter(it => it.to !== it.from);
  if (active.length === 0) return true;
  const parkData = snapshot ? getParkRoomData(snapshot) : undefined;
  const byName = new Map(batch.intents.map(it => [it.name, it] as const));
  const seen = new Set<number>();
  for (const it of active) {
    if (batch.immovable.has(it.name)) return false;
    if (parkData?.blocking.has(it.to)) return false;
    if (seen.has(it.to)) return false; // 同目标格必须先经 resolver 仲裁。
    seen.add(it.to);
    const blocker = batch.occupancy.get(it.to);
    if (blocker === undefined) continue;
    // 一级跟车：目标格被“本拍正要离开的 mover”占着，且它自己的目标格是空的、
    // 非阻挡格、非不可动 —— 两笔 move 同拍结算，引擎允许驶入被让出的格。
    // 只放行一级：blocker 的目标必须空 ⇒ 互换(A→B,B→A)与任何环都被这条件否掉
    // （环里每个 blocker 的目标都是另一个 mover 的 from，必被占）。
    const bi = byName.get(blocker);
    if (
      !bi ||
      bi.to === bi.from ||
      batch.immovable.has(blocker) ||
      batch.occupancy.has(bi.to) ||
      parkData?.blocking.has(bi.to)
    ) {
      return false;
    }
  }
  for (const it of active) {
    const creep = Game.creeps[it.name];
    if (!creep) continue;
    const tx = Math.floor(it.to / 50);
    const ty = it.to % 50;
    const dir = creep.pos.getDirectionTo(tx, ty);
    if (!dir) continue;
    const result = creep.move(dir);
    recordIntent("move", result);
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
      // 与完整解算路径同一条判据的两个出口：两处都必须记成功（#39）。
      recordPathSuccess(creep);
    } else if (result !== ERR_BUSY) {
      invalidateCreepPath(it.name);
    }
  }
  return true;
}

function resolveAndDispatch(
  roomName: string,
  batch: RoomBatch,
  snapshot: RoomSnapshot | undefined,
): void {
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
      // 推挤落格避开房间连接带 — 把被推挤者推上门坎格等于制造下一个堵点。
      if (parkData?.portals.has(packed)) score += 50;
      scored.push({ packed, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map(s => s.packed);
  };

  const { moves, shoveFails } = resolveTraffic({
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

  // 推挤被拒分诊（#38）：线上「stuck 顶格优先级的 creep 被静止者挡死到老死」此前只读得到
  // 结果（没签发），读不到原因 —— 不可动/锚定/无落格三种在观测上是同一个形状，修法无从裁决。
  // 走既有 skip 通道 ⇒ observe 的 `skip(500t)` 行自动带出，不加新读数管线。
  for (const [reason, count] of Object.entries(shoveFails)) {
    for (let i = 0; i < count; i++) recordSkip(`traffic/shove:${reason}`);
  }

  for (const [name, targetPacked] of moves) {
    const creep = Game.creeps[name];
    if (!creep) continue;
    const tx = Math.floor(targetPacked / 50);
    const ty = targetPacked % 50;
    const dir = creep.pos.getDirectionTo(tx, ty);
    if (!dir) continue;
    const result = creep.move(dir);
    recordIntent("move", result);
    if (result === OK || result === ERR_TIRED) {
      recordTraffic(creep);
      // 集中签发的这一拍就是该 creep 本轮的真实移动结果 —— 不记成功时，
      // 被 traffic 仲裁的 creep 的 pathFailure 计数器只有一条「第一次失败后永不归零」
      // 的路径（E8 因此在两间房、四类角色上批量报错警，实证见债单 #39）。
      recordPathSuccess(creep);
    } else if (result !== ERR_BUSY) {
      // v33：引擎拒绝签发（目标格被静态阻挡 — 新墙/新落成结构/敌方结构）→
      // 立即失效该 creep 的持久化路径，下一 tick 强制重算绕行。陈旧路径每 tick
      // 撞同一堵墙时，仅靠 stuck 计时器自愈要数百 tick（线上实证 W36S58 钉死事件）。
      // ERR_BUSY（孵化中）不失效；占用冲突由解算器提前仲裁，一般不走到这里。
      invalidateCreepPath(name);
    }
  }
}
