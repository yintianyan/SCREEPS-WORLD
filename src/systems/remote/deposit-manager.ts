/**
 * Deposit Manager — 远矿 deposit 采集的最小派工闭环。
 *
 * 职责边界：
 * - 只做「发现可见 deposit → 选最近的自有房 → 提交一只 depositHarvester 请求」；
 * - 不执行 harvest/transfer（角色层负责），不维护 Memory 任务表（靠可见房每轮重扫）；
 * - 每 `interval` tick 重扫一次，存活/排队占用都从 Game.creeps 与 spawnQueue 现读，
 *   因此 global reset、部署、creep 死亡都不会留下悬挂状态。
 */
import type { Priority, RoomSnapshot, System, TickContext } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { selectBody } from "../../config/bodies";
import { buildSpawnRequest, hasRequest, spawnKey, submitRequest } from "../../domain/spawn/queue";
import {
  planDepositAssignments,
  type DepositHomeObservation,
  type DepositObservation,
} from "../../domain/remote/deposit";
import {
  rememberedThreatRooms,
  rememberThreatRooms,
  threatRoomsFromIntel,
} from "../../domain/war/march-threats";
import type { RoomIntel } from "../../domain/intel";
import { queryRoomIntel } from "../intelligence";
import { log } from "../../kernel/log";

/** 重扫间隔：deposit 位置/寿命变化缓慢，10 拍足够且几乎零 CPU。 */
const DEPOSIT_SCAN_INTERVAL = 10;

/** 每间 home 同时最多派几条 deposit 线（每条线 = 1 只采集者）。 */
const MAX_DEPOSIT_LINES_PER_HOME = 1;

/**
 * 剩余寿命绝对下限（tick）：低于此值无论多近都不派。
 * 引擎语义：每次 harvest 把 decayTime 重置为 +50000（DEPOSIT_DECAY_TIME），
 * 持续开采的 deposit 几乎不会自然过期 — 「剩余寿命」只约束能否及时到达
 * 开工（逐对跑道门见下），真正的采集预算是疲劳与采集者寿命，此值只是地板。
 */
const MIN_DEPOSIT_TICKS_TO_DECAY = 200;

/**
 * 派工绝对距离上限（房）。采集者寿命 1500、往返 2×50/房：d=4 时往返 400，
 * 在站窗口 ~1100 tick；d≥8 时窗口 <300，扣 2000 能量孵化 + CPU 接近负收益。
 * 产量端引擎口径：HARVEST_DEPOSIT_POWER=1/WORK/tick，疲劳随累计采集量指数
 * 增长 — 距离换不来产量，只换来回路费。
 */
const MAX_DEPOSIT_DISTANCE = 4;

/** 跨房通勤估算（tick/房，无路平原满速口径）。 */
const DEPOSIT_TRAVEL_TICKS_PER_ROOM = 50;

/** 到达时剩余寿命必须 ≥ 单程通勤 + 此余量（开工 runway）。 */
const DEPOSIT_ARRIVAL_RUNWAY_TICKS = 200;

/**
 * 疲劳门（引擎 4.3.2 实测：cooldown = ceil(0.001 × harvested^1.2)，harvested
 * 为跨采集者累计、永不重置）。lastCooldown > 30 时吞吐 < ~0.33 单位/tick，
 * 采集者 1500 寿命装不满一趟 carry（500）— 派工等于罚站。实时视野与 intel
 * 都可读 lastCooldown（同一疲劳口径；intel 观测滞后但疲劳单调不减，只会低估）。
 */
const EXHAUSTED_DEPOSIT_LAST_COOLDOWN = 30;

/**
 * 行军威胁房记忆 TTL（tick）— 与 PB 侧同口径：intel room 域是 heap、global reset
 * 即空，跨房采集者靠 kernel.threatRooms 记忆绕开驻守房。
 */
const THREAT_MEMORY_TICKS = 50000;

/** 行军规避房上限（写 creep memory.avoidRooms，短 key 有界口径）。 */
const AVOID_ROOMS_CAP = 40;

/** 行军威胁全集（本轮 intel 观测 + 跨重启记忆）；新观测 write-through 回记忆。 */
function currentThreatSet(tick: number, myUsername: string | undefined): Set<string> {
  const intelByRoom = new Map<string, RoomIntel>();
  for (const entry of queryRoomIntel()) {
    intelByRoom.set(entry.subject, entry.payload);
  }
  const observed = threatRoomsFromIntel(intelByRoom, myUsername, CONFIG.defense.allies);
  if (observed.length > 0 && Memory.kernel) {
    Memory.kernel.threatRooms = rememberThreatRooms(Memory.kernel, observed, tick);
  }
  return new Set([
    ...observed,
    ...rememberedThreatRooms(Memory.kernel ?? {}, tick, THREAT_MEMORY_TICKS),
  ]);
}

/**
 * intel 快照的最大可采信年龄（tick）。
 * deposit 寿命通常数万拍，5,000 拍前的观测仍可用来派工；再旧就必须等 observer 刷新，
 * 避免朝一个已经采空/消失的 deposit 送人。
 */
const DEPOSIT_INTEL_MAX_AGE_TICKS = 5000;

/** 已存活采集者占用的 deposit id（Game.creeps 是全帝国可见的，不受视野限制）。 */
function collectLiveDepositIds(): Set<string> {
  const live = new Set<string>();
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role !== "depositHarvester") continue;
    const id = creep.memory.depositId;
    if (id) live.add(id);
  }
  return live;
}

/** 各房 spawnQueue 中已排队请求占用的 deposit id。 */
function collectPendingDepositIds(): Set<string> {
  const pending = new Set<string>();
  for (const roomMem of Object.values(Memory.rooms)) {
    const queue = roomMem.spawnQueue;
    if (!queue) continue;
    for (const req of queue) {
      if (req.role !== "depositHarvester") continue;
      const id = req.memory.depositId;
      if (id) pending.add(id);
    }
  }
  return pending;
}

/** 各 home 当前在役/在队的 deposit 线数（防同一房超编）。 */
function collectDepositHomeLoad(): Record<string, number> {
  const load: Record<string, number> = {};
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role !== "depositHarvester") continue;
    const home = creep.memory.home;
    if (home) load[home] = (load[home] ?? 0) + 1;
  }
  for (const roomMem of Object.values(Memory.rooms)) {
    for (const req of roomMem.spawnQueue ?? []) {
      if (req.role !== "depositHarvester") continue;
      if (req.home) load[req.home] = (load[req.home] ?? 0) + 1;
    }
  }
  return load;
}

/** 可派工的自有房（有 spawn、有采集物落点、殖民地状态正常）。 */
function collectHomes(snapshots: Iterable<RoomSnapshot>): DepositHomeObservation[] {
  const homes: DepositHomeObservation[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.spawns.length === 0) continue;
    const roomMem = Memory.rooms[snapshot.roomName];
    if (!roomMem) continue;
    homes.push({
      roomName: snapshot.roomName,
      spawnCount: snapshot.spawns.length,
      hasDepositSink: snapshot.storage !== undefined || snapshot.terminal !== undefined,
      colonyState: roomMem.colonyState ?? "normal",
    });
  }
  return homes;
}

/** 实时视野中的 deposit（权威来源；有视野时以这份为准）。 */
function collectVisibleDeposits(): DepositObservation[] {
  const depositFind = (globalThis as { FIND_DEPOSITS?: FindConstant }).FIND_DEPOSITS;
  if (depositFind === undefined) return [];
  const deposits: DepositObservation[] = [];
  for (const room of Object.values(Game.rooms)) {
    const found = room.find(depositFind) as Deposit[];
    if (found.length === 0) continue;
    // 他人控制房不采（可能触发对等冲突）；有敌对 creeps 的房不送人。
    const controller = room.controller;
    if (controller?.owner !== undefined && !controller.my) continue;
    if (room.find(FIND_HOSTILE_CREEPS).length > 0) continue;
    for (const deposit of found) {
      // 疲劳门：lastCooldown 是累计采集量的单调函数（引擎 4.3.2 实测公式），
      // 超阈值 = 早期甜区已过，采集者寿命内装不满一趟 — 不送人罚站。
      if (deposit.lastCooldown > EXHAUSTED_DEPOSIT_LAST_COOLDOWN) continue;
      deposits.push({
        id: deposit.id,
        roomName: room.name,
        ticksToDecay: deposit.ticksToDecay,
        depositType: deposit.depositType,
      });
    }
  }
  return deposits;
}

/**
 * 从 RoomIntel 快照收集 deposit（observer 远距 highway 扫描的落点）。
 *
 * intel 里的 `decay` 是观测时刻的剩余寿命，这里按 `lastSeen` 折算当前值；
 * 超龄或折算后不足门槛的条目直接丢弃。他人控制房跳过（owner 不在我方名单）。
 */
function collectIntelDeposits(
  tick: number,
  myUsernames: ReadonlySet<string>,
): DepositObservation[] {
  const deposits: DepositObservation[] = [];
  for (const entry of queryRoomIntel()) {
    const payload = entry.payload;
    if (!payload.deposits || payload.deposits.length === 0) continue;
    const age = tick - payload.lastSeen;
    if (age < 0 || age > DEPOSIT_INTEL_MAX_AGE_TICKS) continue;
    if (payload.owner !== undefined && !myUsernames.has(payload.owner)) continue;
    for (const deposit of payload.deposits) {
      const ticksToDecay =
        deposit.decay === undefined ? Number.POSITIVE_INFINITY : deposit.decay - age;
      if (ticksToDecay < MIN_DEPOSIT_TICKS_TO_DECAY) continue;
      // 疲劳门：intel 快照携带观测时刻的 lastCooldown（疲劳单调不减，
      // 滞后观测只会低估当前值 — 阈值内偏乐观是可接受误差）。
      if ((deposit.cooldown ?? 0) > EXHAUSTED_DEPOSIT_LAST_COOLDOWN) continue;
      deposits.push({
        id: deposit.id,
        roomName: entry.subject,
        ticksToDecay,
        depositType: deposit.type,
      });
    }
  }
  return deposits;
}

export const depositManagerSystem: System = {
  name: "deposit-manager",
  priority: 2 as Priority,
  interval: DEPOSIT_SCAN_INTERVAL,
  run(ctx: TickContext): void {
    const snapshots = [...ctx.snapshots()];
    const homes = collectHomes(snapshots);
    // 无合格 home 时连 deposit 扫描都不做（早期帝国/全员危机的常态）。
    if (homes.length === 0) return;

    const myUsernames = new Set<string>();
    for (const snapshot of snapshots) {
      const owner = snapshot.controller?.owner?.username;
      if (owner) myUsernames.add(owner);
    }
    const myUsername = [...myUsernames][0];
    const avoidRooms = [...currentThreatSet(ctx.tick, myUsername)].slice(0, AVOID_ROOMS_CAP);

    // 双源：实时视野（权威）+ intel 快照（observer 远距 highway 扫描）。
    // 同一 id 以实时视野覆盖 intel，避免用旧寿命/旧类型派工。
    const byId = new Map<string, DepositObservation>();
    for (const deposit of collectIntelDeposits(ctx.tick, myUsernames)) {
      byId.set(deposit.id, deposit);
    }
    for (const deposit of collectVisibleDeposits()) {
      byId.set(deposit.id, deposit);
    }
    const deposits = [...byId.values()];
    if (deposits.length === 0) return;

    const assignments = planDepositAssignments({
      deposits,
      homes,
      liveDepositIds: collectLiveDepositIds(),
      pendingDepositIds: collectPendingDepositIds(),
      maxPerHome: MAX_DEPOSIT_LINES_PER_HOME,
      homeLoad: collectDepositHomeLoad(),
      minTicksToDecay: MIN_DEPOSIT_TICKS_TO_DECAY,
      maxDistance: MAX_DEPOSIT_DISTANCE,
      travelTicksPerRoom: DEPOSIT_TRAVEL_TICKS_PER_ROOM,
      arrivalRunwayTicks: DEPOSIT_ARRIVAL_RUNWAY_TICKS,
      distance: (a, b) => Game.map.getRoomLinearDistance(a, b),
    });
    if (assignments.length === 0) return;

    for (const assignment of assignments) {
      const homeRoom = Game.rooms[assignment.home];
      const homeMem = Memory.rooms[assignment.home];
      if (!homeRoom || !homeMem) continue;

      // intel 派工时 deposit 可能没有视野；类型由 intel 快照携带。
      const liveDeposit = Game.getObjectById(assignment.depositId as Id<Deposit>);
      const depositType = liveDeposit?.depositType ?? assignment.depositType;
      if (!depositType) continue;

      // 稳定 key 绑定 deposit：同一 deposit 的请求只会存在一条。
      const key = spawnKey("depositHarvester", assignment.home, 0, assignment.depositId);
      const queue = homeMem.spawnQueue ?? [];
      if (hasRequest(queue, key)) continue;

      const body = selectBody("depositHarvester", homeRoom.energyCapacityAvailable, {
        rcl: homeRoom.controller?.level,
      });
      submitRequest(
        queue,
        buildSpawnRequest(ctx.tick, {
          key,
          role: "depositHarvester",
          home: assignment.home,
          // P2：deposit 是额外收益，不得抢本地核心角色与远矿 source 线的孵化位。
          priority: 2,
          survival: false,
          body,
          memory: {
            role: "depositHarvester",
            home: assignment.home,
            mode: "acquire",
            spawnIndex: 0,
            depositId: assignment.depositId as Id<Deposit>,
            depositType: depositType as DepositConstant,
            remoteTarget: assignment.depositRoom,
            // 行军规避：跨房采集者与 PB 编队同款威胁记忆口径。
            ...(avoidRooms.length > 0 ? { avoidRooms } : {}),
          },
        }),
      );
      homeMem.spawnQueue = queue;
      log.info(
        "deposit-manager",
        `deposit: ${assignment.home} → ${assignment.depositRoom} ` +
          `(${assignment.depositId.slice(0, 6)}, ${depositType})`,
      );
    }
  },
};
