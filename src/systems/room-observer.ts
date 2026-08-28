import type { Priority, System, TickContext } from "../kernel/contracts";
import type { ColonyPhase } from "../domain/economy/phase";
import {
  computeSealedExits,
  scanNeighborIntel,
  type IntelSource,
  type RoomIntel,
  type RoomObservation,
} from "../domain/intel";
import { getRoomIntel } from "./intelligence";
import { globalCache } from "../kernel/global-cache";
import { log } from "../kernel/log";

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

/** 观察交接缓冲上限（条）。超限丢弃最旧——观察可复采，丢弃无损失风险。 */
const INTEL_HANDOFF_CAP = 128;

/**
 * 房间观察器 — P3 房间级诊断与情报采集。
 *
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
    // 侦察兵视野捕获 — prospect 任务存续期间，scout 所在目标房的
    // sources/owner/towers 落库为决策就绪情报（扩张评估器直接消费）。
    captureScoutVision(ctx.tick);

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
        refreshNeighborIntel(snapshot.roomName, ctx.tick);
        // 补算通勤成本：每次刷新至多为 1 个 pathCost 缺失的 normal 邻房计算，
        // 逐次分摊 PathFinder 开销（地形静态，算一次终身缓存）。
        backfillPathCost(snapshot.roomName);
      }

      // Observer 视野调度：挑最陈旧的邻房请求视野，下一 tick 捕获。
      if (snapshot.observer && ctx.tick % OBSERVE_INTERVAL === 0) {
        requestObservation(snapshot.observer, snapshot.roomName, ctx.tick);
      }
    }
  },
};

/** 待捕获的 observer 视野请求（heap，单 tick 生命周期）。 */
interface PendingObservation {
  tick: number;
  targetRoom: string;
  /** 观察归属的自有房名（sponsor 归属依据）。 */
  homeRoom: string;
}

function pendingSlot(): { pending?: PendingObservation } {
  const g = globalCache() as { __observePending?: { pending?: PendingObservation } };
  if (!g.__observePending) g.__observePending = {};
  return g.__observePending;
}

/**
 * 观察结果入队交接缓冲（intelligence 系统采用为 IntelEntry，本系统不直写状态）。
 */
function submitObservation(
  subject: string,
  home: string,
  source: IntelSource,
  payload: RoomIntel,
): void {
  const g = globalCache();
  const buf = (g.intelHandoff ??= []);
  if (buf.length >= INTEL_HANDOFF_CAP) buf.shift();
  buf.push({ subject, home, source, payload });
}

/**
 * 挑选最值得刷新的邻房并请求 observer 视野。
 * 优先级：从未有过视野（sources 未知）> 视野数据最陈旧且超过阈值。
 */
function requestObservation(observer: StructureObserver, homeRoom: string, tick: number): void {
  const exits = Game.map.describeExits(homeRoom);
  if (!exits) return;

  let target: string | undefined;
  let staleness = -1;
  for (const neighbor of Object.values(exits)) {
    if (!neighbor) continue;
    const payload = getRoomIntel(neighbor)?.payload;
    if (payload?.kind === "highway") continue; // 公路房无 source/controller，观察无收益。
    if (payload?.sources === undefined) {
      // 从未有过视野 — 最高优先。
      target = neighbor;
      staleness = Infinity;
      break;
    }
    const age = tick - payload.lastSeen;
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
  if (!room) return;

  const status = Game.map.getRoomStatus(pending.targetRoom).status;
  const payload = scanNeighborIntel(
    pending.targetRoom,
    status,
    tick,
    collectRoomVision(room),
    getRoomIntel(pending.targetRoom)?.payload, // prev — 保留 pathCost 等静态字段。
  );
  submitObservation(pending.targetRoom, pending.homeRoom, "observer", payload);
}

/**
 * 刷新本房出口邻房的情报记录。
 * describeExits + getRoomStatus 无需视野；Game.rooms 有视野时补资源/归属字段。
 * 只写短字段（每邻房 ≤6 个标量），状态体积有界。
 */
function refreshNeighborIntel(roomName: string, tick: number): void {
  const exits = Game.map.describeExits(roomName);
  if (!exits) return;

  for (const neighbor of Object.values(exits)) {
    if (!neighbor) continue;
    const status = Game.map.getRoomStatus(neighbor).status;
    const visible = Game.rooms[neighbor];
    const payload = scanNeighborIntel(
      neighbor,
      status,
      tick,
      visible ? collectRoomVision(visible) : undefined,
      getRoomIntel(neighbor)?.payload, // prev — 保留上次观测值。
    );
    submitObservation(neighbor, roomName, "observer", payload);
  }
}

/** 有视野时的完整房况载荷（scanNeighborIntel 的 visibleRoom 输入）。
 * v33 完整情报：enemySpawns（非我方 spawn，含无主遗迹）+ wallCount（人工墙）+
 * sealedExits（被墙完全封死的出口）。采集点三处（observer 捕获 / 邻房刷新 /
 * scout 视野）共用本函数，口径一致。 */
interface RoomVisionIntel {
  sources: number;
  mineralType?: string;
  owner?: string;
  reservation?: string;
  towers: number;
  enemySpawns: number;
  wallCount: number;
  sealedExits: number[];
  powerBank: boolean;
}

/**
 * 采集一个可见房间的完整视野情报。
 * 成本：3 次 find（hostile structures 复用 + 全结构扫描人工墙）+
 * sealedExits 仅在有人工墙时计算（≤4 出口 × 100 getTerrain）— 采集点均为
 * 低频（50 tick 邻房刷新 / observer 25 tick 单房 / scout 每 tick 单房），可接受。
 */
function collectRoomVision(room: Room): RoomVisionIntel {
  const hostileStructures = room.find(FIND_HOSTILE_STRUCTURES);
  const towers = hostileStructures.filter(s => s.structureType === STRUCTURE_TOWER).length;
  const enemySpawns = hostileStructures.filter(s => s.structureType === STRUCTURE_SPAWN).length;
  // 全结构扫描一次复用三途：人工墙口径 + PB 存在性（野采链，审计缺口 2）。
  const structures = room.find(FIND_STRUCTURES);
  // 人工墙口径与 movement CostMatrix 一致（pathfinding buildStructurePositions）：
  // constructedWall 恒 255；rampart 仅非我方时 255（我方 rampart 可通行，不封路）。
  const walls = structures.filter(
    s => s.structureType === STRUCTURE_WALL ||
      (s.structureType === STRUCTURE_RAMPART && !(s as StructureRampart).my),
  );
  const powerBank = structures.some(s => s.structureType === STRUCTURE_POWER_BANK);
  let sealedExits: number[] = [];
  if (walls.length > 0) {
    const wallSet = new Set<number>();
    for (const w of walls) wallSet.add(w.pos.x * 50 + w.pos.y);
    const exits = Game.map.describeExits(room.name);
    if (exits && room.getTerrain) {
      const terrain = room.getTerrain();
      sealedExits = computeSealedExits({
        roomName: room.name,
        exits,
        artificialWalls: wallSet,
        getTerrain: (x, y) => terrain.get(x, y),
      });
    }
  }
  return {
    sources: room.find(FIND_SOURCES).length,
    mineralType: room.find(FIND_MINERALS)[0]?.mineralType,
    owner: room.controller?.owner?.username,
    reservation: room.controller?.reservation?.username,
    towers,
    enemySpawns,
    wallCount: walls.length,
    sealedExits,
    powerBank,
  };
}

/**
 * 侦察兵视野捕获：prospect 任务存续期间，把站在目标房内的 scout
 * 视野写回情报状态。只扫描一次 Game.creeps（仅任务存续期间），
 * scout 站定即每 tick 刷新 lastSeen — prospect-manager 据此判成功。
 * 复用 scanNeighborIntel 的 prev 语义（保留 pathCost 等静态字段）。
 */
function captureScoutVision(tick: number): void {
  const mission = Memory.kernel?.prospect;
  if (!mission) return;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (!c || c.memory.role !== "scout") continue;
    const target = c.memory.remoteTarget;
    const home = c.memory.home;
    if (!target || !home || c.room.name !== target) continue;
    const room = Game.rooms[target];
    if (!room) continue;
    const status = Game.map.getRoomStatus(target).status;
    const payload = scanNeighborIntel(
      target,
      status,
      tick,
      collectRoomVision(room),
      getRoomIntel(target)?.payload,
    );
    submitObservation(target, home, "scout", payload);
  }
}

/**
 * 为一个 pathCost 缺失的 normal 邻房补算通勤成本（远矿评选的距离账本）。

 * 锚点 = 本房 storage（无则首个 spawn）；目标 = 邻房中心 (25,25) range 15
 * （无视野时不知 source 位置，用房中心近似）。swampCost:5 让沼泽自然折算
 * 成等效路程。PathFinder incomplete（跨房无路）时写线性距离 ×70 保守估算，
 * 不重试 — 地形静态，一次定终身。

 * 每次刷新至多算 1 个（PathFinder 是 CPU 大户，逐次分摊）；只算 normal 房
 * （只有它能做远矿候选）。富化观测不前移 lastSeen（lastSeen 沿用既有条目）。
 */
function backfillPathCost(homeRoom: string): void {
  const home = Game.rooms[homeRoom];
  if (!home) return;
  const anchor = home.storage ?? home.find(FIND_MY_SPAWNS)[0];
  if (!anchor) return;
  const exits = Game.map.describeExits(homeRoom);
  if (!exits) return;

  for (const neighbor of Object.values(exits)) {
    if (!neighbor) continue;
    const entry = getRoomIntel(neighbor);
    if (!entry || entry.payload.kind !== "normal" || entry.payload.pathCost !== undefined) continue;
    const result = PathFinder.search(
      anchor.pos,
      { pos: new RoomPosition(25, 25, neighbor), range: 15 },
      { plainCost: 1, swampCost: 5, maxRooms: 2, maxOps: 4000 },
    );
    const payload: RoomIntel = {
      ...entry.payload,
      pathCost: result.incomplete
        ? Game.map.getRoomLinearDistance(homeRoom, neighbor) * 70
        : result.cost,
    };
    submitObservation(neighbor, homeRoom, "observer", payload);
    return; // 每次只算一个，分摊 CPU。
  }
}

/**
 * 相位诊断日志输出（限频）。

 * 触发条件：
 *   - 到达 PHASE_LOG_INTERVAL 周期：打印完整快照，标记 [PERIODIC]

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
  void newPhase;
  log.info("room-observer", `[PERIODIC] phase/${roomName}: phase=${newPhase}` +
      ` reserve=${state.reserve} delta=${state.reserveDelta >= 0 ? "+" : ""}${state.reserveDelta}` +
      ` drain=${state.drainScore} harv=${state.harvesterCount}/${state.sourceCount} rcl=${state.rcl}` +
      ` state=${Memory.rooms[roomName]?.colonyState ?? "?"}`,);
}

// RoomObservation 类型再导出占位（保持 import 面与语义一致）。
export type { RoomObservation };
