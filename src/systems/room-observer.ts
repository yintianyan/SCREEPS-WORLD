import type { Priority, System, TickContext } from "../kernel/contracts";
import { summarizeTerrain } from "../domain/layout/terrain-intel";
import { classifyRoomByName, highwayRoomNamesInRange } from "../domain/intel";
import type { ColonyPhase } from "../domain/economy/phase";
import {
  computeSealedExits,
  scanNeighborIntel,
  type DepositIntel,
  type IntelSource,
  type RoomIntel,
  type RoomObservation,
} from "../domain/intel";
import { getRoomIntel } from "./intelligence";
import { globalCache, observeCounters } from "../kernel/global-cache";
import { log } from "../kernel/log";
import { findSourcesCached } from "../creeps/support/room-scans";

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

/** observer 射程（线性距离，房数）。
 * 引擎上限是 10，但实测距离 10 的目标经常拿不到视野（lostVision），
 * 且 8 房以外的 deposit 通勤成本过高 —— 取 8，把观察预算留给可运营的资源点。 */
const OBSERVER_RANGE = 8;

/** 已知有 Deposit/Power Bank 的 highway 房刷新周期（tick）：资源点寿命约 5,000，1,500 足够。 */
const RESOURCE_HIGHWAY_REFRESH_AGE = 1500;

/** 空 highway 房的巡检周期（tick）：用于发现“后来新生成”的 Deposit/Power Bank。 */
const EMPTY_HIGHWAY_REFRESH_AGE = 3000;

/** 视野失败后的冷却（tick）：避免反复挑中不存在的房，把观察窗口全耗在 lostVision 上。 */
const OBSERVE_LOST_VISION_COOLDOWN = 5000;

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
  // P2：观察是 intelligence（P2 消费者）的上游生产者 —— 同为 P2 可保证
  // conserve 档（max=P2）下不被饿死；recovery 档仍按既有降级跳过。
  priority: 2 as Priority,
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
      // ⚠️这里的顺序特意是「先判到点，再判有没有楼」：原先 `snapshot.observer &&` 挡在最外层，
      // 于是 **#100 的三种形状在仪器上完全同形** —— 楼不存在 / 楼在但选不出目标 / 楼在但引擎
      // 报错，全都表现为「什么都不发生」。到点判断只是取模，CPU 曲线不变（账本不许改曲线）。
      if (ctx.tick % OBSERVE_INTERVAL === 0) {
        const counters = observeCounters(snapshot.roomName);
        counters.gate++;
        if (snapshot.observer) {
          requestObservation(snapshot.observer, snapshot.roomName, ctx.tick);
        } else {
          counters.noObserver++;
        }
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

/** 该房是否在「视野失败」冷却中（过期即清）。 */
function isObserveBlacklisted(roomName: string, tick: number): boolean {
  const blacklist = globalCache().observeBlacklist;
  if (!blacklist) return false;
  const until = blacklist[roomName];
  if (until === undefined) return false;
  if (tick >= until) {
    delete blacklist[roomName];
    return false;
  }
  return true;
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
 * 挑选最值得刷新的房间并请求 observer 视野。
 *
 * 候选优先级（从高到低）：
 * 1) 从未有过视野的普通邻房（扩张/远矿选址最需要）；
 * 2) 已知有 Deposit/Power Bank 的 highway 房（射程内，资源车道的数据源）；
 * 3) 超过 INTEL_STALE_AFTER 的普通邻房；
 * 4) 从未观测过的 highway 房（轮转，逐步扫完射程内高速网）；
 * 5) 超过 EMPTY_HIGHWAY_REFRESH_AGE 的空 highway 房（发现新生成的资源点）。
 *
 * 旧实现只考虑 `describeExits` 的 4 个邻房并显式跳过 highway ——
 * 而 highway 是 Deposit/Power Bank 的唯一产地，导致两类资源点永远进不了 intel。
 */
function requestObservation(observer: StructureObserver, homeRoom: string, tick: number): void {
  const counters = observeCounters(homeRoom);
  const exits = Game.map.describeExits(homeRoom);
  if (!exits) {
    // 本服实践中不发生（describeExits 对合法房名恒返回 4 出口）；归进 noTarget 而不是单独立列，
    // 但记下来 —— 「一次都没请求」的归因必须完整，否则 noTarget 会莫名其妙少一截。
    counters.noTarget++;
    return;
  }

  const normalNeighbors: string[] = [];
  const highwayTargets = new Set<string>();
  for (const neighbor of Object.values(exits)) {
    if (!neighbor) continue;
    if (classifyRoomByName(neighbor) === "highway") highwayTargets.add(neighbor);
    else normalNeighbors.push(neighbor);
  }
  // observer 射程内的 highway 房 — Deposit/Power Bank 的唯一产地。
  for (const name of highwayRoomNamesInRange(homeRoom, OBSERVER_RANGE)) {
    highwayTargets.add(name);
  }

  let target: string | undefined;
  let staleness = -1;
  // 1) 从未有视野的普通邻房 — 原地优先（与旧行为逐字一致）。
  for (const neighbor of normalNeighbors) {
    if (isObserveBlacklisted(neighbor, tick)) continue;
    const payload = getRoomIntel(neighbor)?.payload;
    if (payload?.sources === undefined) {
      target = neighbor;
      staleness = Infinity;
      break;
    }
  }

  // 2-5) 收集其余维度，按优先级裁决。
  if (!target) {
    let resourceHighway: { name: string; age: number } | undefined;
    let staleNormal: { name: string; age: number } | undefined;
    const unknownHighways: string[] = [];
    let emptyHighway: { name: string; age: number } | undefined;

    for (const neighbor of normalNeighbors) {
      if (isObserveBlacklisted(neighbor, tick)) continue;
      const payload = getRoomIntel(neighbor)?.payload;
      if (!payload) continue;
      const age = tick - payload.lastSeen;
      if (age > INTEL_STALE_AFTER && age > staleness) {
        staleness = age;
        staleNormal = { name: neighbor, age };
      }
    }

    for (const name of highwayTargets) {
      if (isObserveBlacklisted(name, tick)) continue;
      const entry = getRoomIntel(name);
      const payload = entry?.payload;
      if (!payload) {
        unknownHighways.push(name);
        continue;
      }
      const age = tick - payload.lastSeen;
      const hasResource = (payload.deposits?.length ?? 0) > 0 || payload.powerBank === true;
      if (hasResource && age >= RESOURCE_HIGHWAY_REFRESH_AGE) {
        if (!resourceHighway || age > resourceHighway.age) resourceHighway = { name, age };
      } else if (!hasResource && age >= EMPTY_HIGHWAY_REFRESH_AGE) {
        if (!emptyHighway || age > emptyHighway.age) emptyHighway = { name, age };
      }
    }

    if (resourceHighway) {
      target = resourceHighway.name;
    } else if (staleNormal) {
      target = staleNormal.name;
    } else if (unknownHighways.length > 0) {
      // 轮转选择：按观察序号取模，避免总盯同一个未观测房导致其余永远扫不到。
      unknownHighways.sort((a, b) => a.localeCompare(b));
      target = unknownHighways[Math.floor(tick / OBSERVE_INTERVAL) % unknownHighways.length];
    } else if (emptyHighway) {
      target = emptyHighway.name;
    }
  }

  if (!target) {
    counters.noTarget++;
    return;
  }

  const code = observer.observeRoom(target);
  // 观测留痕：stats.observe 只有分桶计数，回答不了“最近扫的是哪一间”；
  // 排查 Deposit/Power Bank 为什么没进 intel 时需要目标房名。
  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.observerLastRequest = { t: tick, r: target, c: code };
  if (code === OK) {
    counters.ok++;
    pendingSlot().pending = { tick, targetRoom: target, homeRoom };
  } else {
    // 按原始返回码建直方图，不按名字枚举 —— 本服的码集合按记忆写会错。
    // ERR_RCL_NOT_ENOUGH(-15) 与 ERR_NOT_IN_RANGE(-12) 是 #100 的两个候选答案（楼等级不够 vs 目标超出 10 房）。
    counters.codes[String(code)] = (counters.codes[String(code)] ?? 0) + 1;
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
  const counters = observeCounters(pending.homeRoom);
  if (pending.tick !== tick - 1) {
    slot.pending = undefined;
    // 请求成功过（ok++）但捕获那一拍没轮到 —— 系统被 CPU 档拒 / interval 错位。
    // 单独立一列，是因为它和「视野真没来」是两种病（一种修调度，一种什么也不用修）。
    counters.staleSlot++;
    return;
  }
  slot.pending = undefined;

  const room = Game.rooms[pending.targetRoom];
  if (!room) {
    counters.lostVision++;
    // 目标房不在视野/未必存在于 db.rooms：冷却期内不再重复挑它。
    const blacklist = (globalCache().observeBlacklist ??= {});
    blacklist[pending.targetRoom] = tick + OBSERVE_LOST_VISION_COOLDOWN;
    return;
  }

  const status = Game.map.getRoomStatus(pending.targetRoom).status;
  const payload = scanNeighborIntel(
    pending.targetRoom,
    status,
    tick,
    collectRoomVision(room),
    getRoomIntel(pending.targetRoom)?.payload, // prev — 保留 pathCost 等静态字段。
  );
  submitObservation(pending.targetRoom, pending.homeRoom, "observer", payload);
  // 自洽式右端：ok === captured + lostVision + staleSlot。左端有数而右端全 0 ⇒ 捕获侧坏了。
  counters.captured++;
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
  // R651：地形选点指标（normal 且非自有房才算；地形静态）。
  wallRatio?: number;
  swampRatio?: number;
  bestAnchorScore?: number;
  anchorToController?: number;
  anchorToSources?: number;
  anchorPlaceableRatio?: number;
  sources: number;
  mineralType?: string;
  owner?: string;
  reservation?: string;
  towers: number;
  enemySpawns: number;
  wallCount: number;
  sealedExits: number[];
  powerBank: boolean;
  /** PB 剩余 hits（有 PB 时记录）— 野采编队火力/时间可行性输入。 */
  powerBankHits?: number;
  /** PB 预计消失 tick（有 PB 时记录）。 */
  powerBankUntil?: number;
  /** PB 内含 power 数量（有 PB 时记录）— collector 规模/价值门输入。 */
  powerBankPower?: number;
  /** Highway 资源点（Deposit 车道的数据源）；空数组 = 有视野且确认当前无 deposit。 */
  deposits: DepositIntel[];
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
    s =>
      s.structureType === STRUCTURE_WALL ||
      (s.structureType === STRUCTURE_RAMPART && !(s as StructureRampart).my),
  );
  const powerBankStructure = structures.find(s => s.structureType === STRUCTURE_POWER_BANK) as
    StructurePowerBank | undefined;
  const powerBank = powerBankStructure !== undefined;
  // Deposit 观测：highway 房是唯一产地，有视野即全量覆写（空数组 = 已确认无）。
  // 私服/旧 mock 可能没有 FIND_DEPOSITS 常量，缺失时按空列表处理而不是抛错。
  const deposits: DepositIntel[] =
    typeof FIND_DEPOSITS === "undefined"
      ? []
      : room.find(FIND_DEPOSITS).map(deposit => ({
          id: deposit.id,
          type: deposit.depositType,
          decay: deposit.ticksToDecay,
          cooldown: deposit.lastCooldown,
        }));
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
  // R651：选点前置指标 —— 只对「可能被 claim 的 normal 非自有房」计算一次
  // （地形静态，落 intel 后终身复用）；highway/sk/自有房不花这份 CPU。
  const terrainIntel = (() => {
    if (!room.name) return {};
    if (classifyRoomByName(room.name) !== "normal") return {};
    if (room.controller?.my) return {};
    if (typeof room.getTerrain !== "function") return {};
    const sources = room.find(FIND_SOURCES) ?? [];
    if (sources.length === 0) return {};
    const terrain = room.getTerrain();
    const mineral = room.find(FIND_MINERALS)[0];
    return summarizeTerrain({
      getTerrainValue: (x: number, y: number) => terrain.get(x, y),
      sources: sources.map(s => ({ x: s.pos.x, y: s.pos.y })),
      controller: room.controller
        ? { x: room.controller.pos.x, y: room.controller.pos.y }
        : undefined,
      exits: (room.find(FIND_EXIT) ?? []).map(p => ({ x: p.x, y: p.y })),
      mineral: mineral ? { x: mineral.pos.x, y: mineral.pos.y } : undefined,
      // R651b：回 claim 房布局校验 —— 房内任何 spawn（含无主遗迹）到最佳锚点的距离。
      spawns: structures
        .filter(s => s.structureType === STRUCTURE_SPAWN)
        .map(s => ({ x: s.pos.x, y: s.pos.y })),
    });
  })();

  return {
    ...terrainIntel,
    sources: findSourcesCached(room).length,
    mineralType: room.find(FIND_MINERALS)[0]?.mineralType,
    owner: room.controller?.owner?.username,
    reservation: room.controller?.reservation?.username,
    towers,
    enemySpawns,
    wallCount: walls.length,
    sealedExits,
    powerBank,
    ...(powerBankStructure
      ? {
          powerBankHits: powerBankStructure.hits,
          powerBankUntil: Game.time + (powerBankStructure.ticksToDecay ?? 0),
          powerBankPower: powerBankStructure.power,
        }
      : {}),
    deposits,
  };
}

/**
 * 侦察兵视野捕获：prospect 任务存续期间，把站在目标房内的 scout
 * 视野写回情报状态。消费共享快照总线 creepRefs（不再全量遍历 Game.creeps），
 * scout 站定即每 tick 刷新 lastSeen — prospect-manager 据此判成功。
 * 复用 scanNeighborIntel 的 prev 语义（保留 pathCost 等静态字段）。
 */
function captureScoutVision(tick: number): void {
  const mission = Memory.kernel?.prospect;
  if (!mission) return;
  const refs = globalCache().creepRefs;
  if (!refs) return;
  for (const c of refs) {
    if (c.role !== "scout") continue;
    const target = c.remoteTarget;
    const home = c.home;
    if (!target || !home || c.roomName !== target) continue;
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
  log.info(
    "room-observer",
    `[PERIODIC] phase/${roomName}: phase=${newPhase}` +
      ` reserve=${state.reserve} delta=${state.reserveDelta >= 0 ? "+" : ""}${state.reserveDelta}` +
      ` drain=${state.drainScore} harv=${state.harvesterCount}/${state.sourceCount} rcl=${state.rcl}` +
      ` state=${Memory.rooms[roomName]?.colonyState ?? "?"}`,
  );
}

// RoomObservation 类型再导出占位（保持 import 面与语义一致）。
export type { RoomObservation };
