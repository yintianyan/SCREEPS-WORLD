import type { Priority, System, TickContext } from "../kernel/contracts";
import type { ColonyPhase } from "../domain/economy/phase";
import { scanNeighborIntel, type RoomIntel } from "../domain/intel";
import { globalCache } from "../kernel/global-cache";

/**
 * 相位诊断日志的固定打印间隔（tick）。
 * 相位变化时立即打印；无变化时每 50 tick 打印一次完整快照，便于在控制台观察趋势。
 */
const PHASE_LOG_INTERVAL = 50;

/** 邻居情报刷新间隔（tick）。房态/归属变化慢，50 tick 足够且零 CPU 压力。 */
const INTEL_SCAN_INTERVAL = 50;

/** Observer 视野请求间隔（tick）。每次挑一个最陈旧的邻房刷新。 */
const OBSERVE_INTERVAL = 25;

/** intel 视野数据的陈旧阈值（tick）— 超过则值得用 observer 刷新。 */
const INTEL_STALE_AFTER = 2000;

/**
 * 房间观察器 — P3 房间级诊断与情报采集。
 * 职责：相位诊断日志（趋势观察）；邻居房情报采集（出口/房态/SK 分类零视野可得，
 * 资源/归属字段需视野补全）；observer 视野调度。
 * 系统 interval 必须为 1：observeRoom 的视野只存续下一 tick — 本 tick 请求 → 下 tick
 * 捕获；内部各任务自带取模门控，非触发 tick 的开销仅为几次条件判断。
 * 经济状态计算（ColonyPhase → ColonyState）已移至 room-state 系统（P0，每 tick）。
 */
export const roomObserverSystem: System = {
  name: "room-observer",
  priority: 3 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    // 上一 tick 通过 observer 请求的视野本 tick 生效 — 优先捕获（仅一次机会）。
    captureObservedIntel(ctx.tick);

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // 诊断日志：相位变化时立即打印；无变化时按固定间隔打印快照。
      // room-state 系统每 tick 更新 roomMem.phase，此处仅读取并输出。
      const phase = roomMem.phase;
      if (phase) {
        logPhaseIfChangedOrDue(
          ctx.tick,
          snapshot.roomName,
          undefined, // 前一个相位名称不再在此追踪（room-state 已写入）
          phase.phase as ColonyPhase,
          phase,
        );
      }

      // 邻居房情报 — 远矿/扩张选址的数据源。
      if (ctx.tick % INTEL_SCAN_INTERVAL === 0) {
        refreshNeighborIntel(snapshot.roomName, roomMem, ctx.tick);
        // 补算通勤成本：每次刷新至多为 1 个 pathCost 缺失的 normal 邻房计算，
        // 逐次分摊 PathFinder 开销（地形静态，算一次终身缓存）。
        backfillPathCost(snapshot.roomName, roomMem);
      }

      // Observer 视野调度：挑最陈旧的邻房请求视野，下一 tick 捕获。
      if (snapshot.observer && ctx.tick % OBSERVE_INTERVAL === 0) {
        requestObservation(snapshot.observer, snapshot.roomName, roomMem, ctx.tick);
      }
    }
  },
};

/** 待捕获的 observer 视野请求（heap，单 tick 生命周期）。 */
interface PendingObservation {
  tick: number;
  targetRoom: string;
  /** intel 归属的自有房名。 */
  homeRoom: string;
}

function pendingSlot(): { pending?: PendingObservation } {
  const g = globalCache() as { __observePending?: { pending?: PendingObservation } };
  if (!g.__observePending) g.__observePending = {};
  return g.__observePending;
}

/**
 * 挑选最值得刷新的邻房并请求 observer 视野。
 * 优先级：从未有过视野（sources 未知）> 视野数据最陈旧且超过阈值。
 */
function requestObservation(
  observer: StructureObserver,
  homeRoom: string,
  roomMem: RoomMemory,
  tick: number,
): void {
  const intel = roomMem.intel;
  if (!intel) return;

  let target: string | undefined;
  let staleness = -1;
  for (const [neighbor, info] of Object.entries(intel)) {
    if (info.kind === "highway") continue; // 公路房无 source/controller，观察无收益。
    if (info.sources === undefined) {
      // 从未有过视野 — 最高优先。
      target = neighbor;
      staleness = Infinity;
      break;
    }
    const age = tick - info.lastSeen;
    if (age > INTEL_STALE_AFTER && age > staleness) {
      target = neighbor;
      staleness = age;
    }
  }
  if (!target) return;

  if (observer.observeRoom(target) === OK) {
    pendingSlot().pending = { tick, targetRoom: target, homeRoom };
  }
}

/**
 * 捕获上一 tick observer 请求的视野 — observeRoom 的视野只在下一 tick 存在，
 * 错过本次窗口就要等下个 OBSERVE_INTERVAL。
 */
function captureObservedIntel(tick: number): void {
  const slot = pendingSlot();
  const pending = slot.pending;
  if (!pending) return;
  if (pending.tick !== tick - 1) {
    slot.pending = undefined;
    return;
  }
  slot.pending = undefined;

  const room = Game.rooms[pending.targetRoom];
  const roomMem = Memory.rooms[pending.homeRoom];
  if (!room || !roomMem?.intel) return;

  const status = Game.map.getRoomStatus(pending.targetRoom).status;
  roomMem.intel[pending.targetRoom] = scanNeighborIntel(
    pending.targetRoom,
    status,
    tick,
    {
      sources: room.find(FIND_SOURCES).length,
      mineralType: room.find(FIND_MINERALS)[0]?.mineralType,
      owner: room.controller?.owner?.username,
      reservation: room.controller?.reservation?.username,
      towers: countHostileTowers(room),
    },
    roomMem.intel[pending.targetRoom], // prev — 保留危险冷却。
  );
}

/**
 * 刷新本房出口邻房的情报记录。
 * describeExits + getRoomStatus 无需视野；Game.rooms 有视野时补资源/归属字段。
 * 只写短字段（每邻房 ≤6 个标量），Memory 体积有界。
 */
function refreshNeighborIntel(roomName: string, roomMem: RoomMemory, tick: number): void {
  const exits = Game.map.describeExits(roomName);
  if (!exits) return;

  const intel: Record<string, RoomIntel> = roomMem.intel ?? {};
  for (const neighbor of Object.values(exits)) {
    if (!neighbor) continue;
    const status = Game.map.getRoomStatus(neighbor).status;
    const visible = Game.rooms[neighbor];
    intel[neighbor] = scanNeighborIntel(
      neighbor,
      status,
      tick,
      visible
        ? {
            sources: visible.find(FIND_SOURCES).length,
            mineralType: visible.find(FIND_MINERALS)[0]?.mineralType,
            owner: visible.controller?.owner?.username,
            reservation: visible.controller?.reservation?.username,
            towers: countHostileTowers(visible),
          }
        : undefined,
      intel[neighbor], // prev — 保留危险冷却与上次观测值。
    );
  }
  roomMem.intel = intel;
}

/** 统计房间内敌方 tower 数（进攻/远矿风险评估的核心变量）。 */
function countHostileTowers(room: Room): number {
  return room
    .find(FIND_HOSTILE_STRUCTURES)
    .filter(s => s.structureType === STRUCTURE_TOWER).length;
}

/**
 * 为一个 pathCost 缺失的 normal 邻房补算通勤成本（远矿评选的距离账本）。
 *
 * 锚点 = 本房 storage（无则首个 spawn）；目标 = 邻房中心 (25,25) range 15
 * （无视野时不知 source 位置，用房中心近似）。swampCost:5 让沼泽自然折算
 * 成等效路程。PathFinder incomplete（跨房无路）时写线性距离 ×70 保守估算，
 * 不重试 — 地形静态，一次定终身。
 *
 * 每次刷新至多算 1 个（PathFinder 是 CPU 大户，逐次分摊）；只算 normal 房
 * （只有它能做远矿候选）。
 */
function backfillPathCost(homeRoom: string, roomMem: RoomMemory): void {
  const intel = roomMem.intel;
  if (!intel) return;
  const home = Game.rooms[homeRoom];
  if (!home) return;
  const anchor = home.storage ?? home.find(FIND_MY_SPAWNS)[0];
  if (!anchor) return;

  for (const neighbor in intel) {
    const info = intel[neighbor]!;
    if (info.kind !== "normal" || info.pathCost !== undefined) continue;
    const result = PathFinder.search(
      anchor.pos,
      { pos: new RoomPosition(25, 25, neighbor), range: 15 },
      { plainCost: 1, swampCost: 5, maxRooms: 2, maxOps: 4000 },
    );
    info.pathCost = result.incomplete
      ? Game.map.getRoomLinearDistance(homeRoom, neighbor) * 70
      : result.cost;
    return; // 每次只算一个，分摊 CPU。
  }
}

/**
 * 相位诊断日志输出（限频）。
 *
 * 触发条件：
 *   - 到达 PHASE_LOG_INTERVAL 周期：打印完整快照，标记 [PERIODIC]
 *
 * 无变化且未到周期：静默，避免控制台刷屏。
 */
function logPhaseIfChangedOrDue(
  tick: number,
  roomName: string,
  _prevPhase: ColonyPhase | undefined,
  newPhase: ColonyPhase,
  state: NonNullable<RoomMemory["phase"]>,
): void {
  const due = tick % PHASE_LOG_INTERVAL === 0;
  if (!due) return;

  console.log(
    `[PERIODIC] phase/${roomName}: phase=${newPhase}` +
      ` reserve=${state.reserve} delta=${state.reserveDelta >= 0 ? "+" : ""}${state.reserveDelta}` +
      ` drain=${state.drainScore} harv=${state.harvesterCount}/${state.sourceCount} rcl=${state.rcl}` +
      ` state=${Memory.rooms[roomName]?.colonyState ?? "?"}`,
  );
}
