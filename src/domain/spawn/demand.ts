import { CONFIG } from "../../config";
import { degradeBody, minimalBodyFor, RECOVERY_BODY, selectBody } from "../../config/bodies";
import { getRoleBounds, getAllRoleBounds } from "../../config/tuned";
import type { ColonyState, RoomSnapshot } from "../../kernel/contracts";
import { countPending, spawnKey } from "./queue";

/** 各角色降级时必需保留的最小部件组合。hauler/distributor 无需 WORK。 */
export const ROLE_REQUIRED_PARTS: Readonly<Record<string, readonly BodyPartConstant[]>> = {
  hauler: ["carry", "move"],
  distributor: ["carry", "move"],
  remoteHarvester: ["work", "carry", "move"],
  remoteHauler: ["carry", "move"],
  reserver: ["claim", "move"],
  claimer: ["claim", "move"],
  remoteDefender: ["attack", "move"],
  defender: ["attack", "move"],
};

/**
 * 单个 creep 的摘要信息 — 供纯函数消费，不持有 Creep 对象。
 *
 * 适配层（系统/角色层）从 `Game.creeps` 收集后传入。
 */
export interface CreepSummary {
  name: string;
  role: string;
  home: string;
  ticksToLive?: number;
  bodyLength: number;
  sourceId?: Id<Source>;
  spawnIndex?: number;
  /** B1：是否已标记为待回收（上一 tick 或更早被 recyclePass 标记）。 */
  recycle?: boolean;
}

/** 正在孵化中的 creep 摘要。 */
export interface SpawningSummary {
  name: string;
  role: string;
  home: string;
}

/**
 * 房间经济上下文 — 从 Memory/Game 收集的标志位，供纯函数消费。
 *
 * 适配层负责从 `Memory.rooms[roomName]` 和 `Game.rooms[roomName]` 读取后传入。
 */
export interface RoomDemandContext {
  colonyState: ColonyState;
  controllerDowngradeRisk: boolean;
  energyAvailable: number;
  /** 经济压力梯度信号 (0.0–1.0)。0=健康，1=危机。用于梯度缩放 P2 角色数量。 */
  economyPressure: number;
  /** Storage 能量超过满仓阈值时为 true。触发限采 + 加速消费。 */
  storageNearFull?: boolean;
  /**
   * 流动性危机分数 (0-100)，方案 C。高值 = 能量冻在 container、spawn 破产的物流死锁。
   * 用于区分流动性危机（需要更多 hauler 搬运冻结能量）与偿付危机（收缩 hauler 节能）。
   */
  liquidityScore?: number;
  /** 偿付危机分数 (0-100)。与 liquidityScore 比较以判定危机由哪个维度主导。 */
  drainScore?: number;
}

interface DemandResult {
  requests: SpawnRequest[];
}

/**
 * 统计指定房间内所有角色的存活 creep 数（含孵化中）。
 *
 * 纯函数 — 接收预收集的 creep 和 spawning 摘要列表，不访问 Game/Memory。
 */
export function countCreepsByRole(
  creeps: readonly CreepSummary[],
  spawning: readonly SpawningSummary[],
  roomName: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const creep of creeps) {
    if (creep.home !== roomName) continue;
    const role = creep.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  for (const s of spawning) {
    if (s.home !== roomName) continue;
    const role = s.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

/**
 * 判断 creep 是否即将需要替换。
 * 阈值 = body.length * 3（孵化耗时）+ buffer（安全余量）+ travelTicks（通勤路程）。
 * 纯函数 — 接收显式参数，不访问 Creep 对象。
 */
export function needsReplacement(
  ticksToLive: number | undefined,
  bodyLength: number,
  travelTicks = 0,
): boolean {
  if (ticksToLive === undefined) return false;
  const threshold = bodyLength * 3 + CONFIG.spawn.replaceBuffer + travelTicks;
  return ticksToLive <= threshold;
}

/**
 * 估算 harvester 从 spawn 到其 source 的通勤 tick 数（Chebyshev 距离 × 1.5 地形系数，上限 50）。
 * 用于提前替补的替换阈值，防止「替补走完路程前矿工已死」的采集断档。
 */
export function estimateTravelTicks(
  snapshot: RoomSnapshot,
  sourceId: Id<Source> | undefined,
): number {
  if (!sourceId) return 0;
  const spawn = snapshot.spawns[0];
  if (!spawn) return 0;
  const source = snapshot.sources.find(s => s.id === sourceId);
  if (!source) return 0;
  const range = spawn.pos.getRangeTo(source.pos);
  return Math.min(50, Math.ceil(range * 1.5));
}

// ─── Body 感知配额（数量 × body 大小 = 能力，配额按能力而非头数计）───

/**
 * 降级回退守卫：降级失败后 selectBody(energyAvailable) 的回退产物若缺
 * 角色必需部件（RECOVERY_BODY 兜底对非 W/C/M 角色是陷阱 — defender 会
 * 拿到无 ATTACK 的假防御者），或干脆就是 RECOVERY_BODY 本身
 * （hauler 平白多买 WORK 死重 — carry/move 恰好齐备骗过缺件检查），
 * 改用角色最低档模板：请求带最低档 body 排队等能量，而非孵出不可用单位。
 * 仅对显式声明 requiredParts 的专职角色生效 — worker/harvester 等
 * W/C/M 角色的 RECOVERY_BODY 兜底是正确语义，不动。
 */
function guardRoleFallback(role: string, body: BodyPartConstant[]): BodyPartConstant[] {
  const required = ROLE_REQUIRED_PARTS[role];
  if (!required) return body;
  const isRecoveryFallback =
    body.length === RECOVERY_BODY.length && body.every((p, i) => p === RECOVERY_BODY[i]);
  if (isRecoveryFallback || !required.every(p => body.includes(p))) {
    return minimalBodyFor(role);
  }
  return body;
}

/**
 * 估算「本 tick 若孵化该角色，实际会得到的 body」。
 * 与 createRequest 的降级路径同口径：bootstrap/recovery 按 energyAvailable 降级
 * （速出保命的小 body），normal 按 energyCapacity 满配。
 * 口径不一致的后果：危机时按满配 body 折算数量 → 头数偏少 + 实际孵出小 body
 * → 能力双重缺口。
 */
export function estimatePlannedBody(
  role: string,
  energyCapacity: number,
  energyAvailable: number,
  colonyState: ColonyState,
  rcl: number,
): BodyPartConstant[] {
  const fullBody = selectBody(role, energyCapacity, { rcl });
  if (colonyState === "bootstrap" || colonyState === "recovery") {
    return (
      degradeBody(fullBody, energyAvailable, ROLE_REQUIRED_PARTS[role]) ??
      guardRoleFallback(role, selectBody(role, energyAvailable, { rcl }))
    );
  }
  return fullBody;
}

/** 统计 body 中指定部件的数量（至少 1，防除零）。 */
export function countBodyParts(
  body: readonly BodyPartConstant[],
  part: BodyPartConstant,
): number {
  return Math.max(1, body.filter(p => p === part).length);
}

// ─── 矿位分配（专职矿工口径）───────────────────────────────

/**
 * 构建专职 harvester 的矿位占用映射 — 只统计 harvester（存活 + 队列 pending），
 * 排除 worker 等流动角色。
 *
 * 口径原因：worker 是灾后万金油，采集只是它的临时行为（随后去填充/升级、
 * 最终退役），把它的 sourceId 计入占用会误导分配 — 团灭恢复期实测：
 * worker 挂名南源 → 两只专职 harvester 因「平局偏向 sources[0]」全被
 * 分到北源，南源满血荒废，恢复期采集吞吐减半。
 *
 * @param excludeName 排除的 creep 名（替换场景：垂死者矿位视为已空出）
 */
export function buildHarvesterOccupancy(
  creeps: readonly CreepSummary[],
  queue: readonly SpawnRequest[],
  home: string,
  excludeName?: string,
): Map<string, number> {
  const occupancy = new Map<string, number>();
  for (const c of creeps) {
    if (c.home !== home || c.role !== "harvester") continue;
    if (excludeName !== undefined && c.name === excludeName) continue;
    if (!c.sourceId) continue;
    occupancy.set(c.sourceId as string, (occupancy.get(c.sourceId as string) ?? 0) + 1);
  }
  // 队列中未孵化的 harvester 请求同样占用矿位（防同轮/跨轮重复分配）。
  for (const req of queue) {
    if (req.role !== "harvester" || req.home !== home) continue;
    const sid = req.memory.sourceId as string | undefined;
    if (sid) occupancy.set(sid, (occupancy.get(sid) ?? 0) + 1);
  }
  return occupancy;
}

/** 从占用映射中选最少拥挤的 source（平局取遍历序第一个）。 */
export function pickLeastCrowdedSource(
  sources: readonly Source[],
  occupancy: ReadonlyMap<string, number>,
): Source | undefined {
  let best: Source | undefined;
  let bestCount = Infinity;
  for (const source of sources) {
    const count = occupancy.get(source.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = source;
    }
  }
  return best;
}

/**
 * 评估房间孵化需求。
 *
 * 纯函数 — 接收预收集的所有数据（快照、队列、creep 摘要、房间上下文），
 * 返回待提交的 SpawnRequest 列表。不访问 Game/Memory。
 *
 * 优先级顺序：
 *   P0 — 无 harvester 时的恢复 worker
 *   P1 — harvester 至 minCount，带 source 分配（基于实际占用）
 *   P1 — hauler 至 minCount
 *   P2 — upgrader 至 minCount
 *   P2 — builder 至 minCount（仅当存在建造 site 时）
 */
export function evaluateDemand(
  snapshot: RoomSnapshot,
  queue: readonly SpawnRequest[],
  colonyState: ColonyState,
  creeps: readonly CreepSummary[],
  spawning: readonly SpawningSummary[],
  roomCtx: RoomDemandContext,
  tick: number,
): DemandResult {
  const requests: SpawnRequest[] = [];
  const home = snapshot.roomName;
  const energyCapacity = snapshot.energyCapacityAvailable;
  // 统一经济状态：recovery 涵盖 crisis + recovery 相位，收缩非关键消耗。
  const inCrisis = colonyState === "recovery";
  // Storage 满仓信号 — 限采 + 加速消费。
  const storageNearFull = roomCtx.storageNearFull === true;

  // 单次遍历获取所有角色计数。
  // pending 计数带 home 过滤 — sponsor 房代孵的拓荒请求（home 指向新房）
  // 寄宿在本房队列，不得计入本房人口预算。
  const counts = countCreepsByRole(creeps, spawning, home);
  const pending = {
    harvester: countPending(queue, "harvester", home),
    worker: countPending(queue, "worker", home),
    hauler: countPending(queue, "hauler", home),
    distributor: countPending(queue, "distributor", home),
    upgrader: countPending(queue, "upgrader", home),
    builder: countPending(queue, "builder", home),
  };

  // P0：恢复 worker — 当没有存活 harvester/worker 时。
  // 仅看存活数（counts），不看 pending — pending 中的 stale 请求可能永远无法孵化
  // （如能量不足降级失败），若计入会导致 harvesterCount > 0 → P0 worker 不创建 → 死锁。
  const livingHarvesters = (counts.harvester ?? 0) + (counts.worker ?? 0);

  if (livingHarvesters === 0) {
    // W-3：P0 恢复不无视 defense 态 — 团灭现场若威胁仍在，先孵的 worker
    // 出门即被杀（200 能量白送）。威胁在场时先入队 P0 defender 清场，
    // worker 请求同队跟进（sortQueue 同优先级按 createdAt，defender 先孵）。
    // 塔健在的房威胁通常已被塔压制（threatCreeps 有像才成立），不受影响。
    if (snapshot.threatCreeps.length > 0) {
      const defKey = spawnKey("defender", home, 0);
      if (!hasKey(queue, defKey)) {
        requests.push(createRequest("defender", home, 0, defKey, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
    const key = spawnKey("worker", home, 0);
    requests.push(createRequest("worker", home, 0, key, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
    return { requests }; // P0 阻塞其他所有请求
  }

  // P1：Defender — 房内出现威胁时的防御响应（防御优先于经济扩员）。
  // 塔负责远程集火，defender 贴脸补刀；无塔窗口期（RCL1-2 / 塔被打空）
  // defender 是唯一主动防线。数量按威胁数缩放、受 maxCount 封顶；
  // 威胁清除后不再补充，存量 defender 自然到期（minCount=0，替换门禁不触发）。
  // M11 威胁分级：小队威胁（≥2 武装或武装+治疗）升级响应 — 编制保底 2 只
  // 且优先级升至 P0（与灾后恢复同级，插队所有经济孵化）。defender 的定位
  // 是威胁离场后的清剿与护航复工，不是救火 — 救火由塔与集结避险承担。
  if (snapshot.threatCreeps.length > 0) {
    const defenderConfig = getRoleBounds("defender", home);
    const defenderPending = countPending(queue, "defender", home);
    const defenderTotal = (counts.defender ?? 0) + defenderPending;
    const squad = snapshot.squadThreat;
    const defenderTarget = squad
      ? Math.min(Math.max(2, snapshot.threatCreeps.length), defenderConfig.maxCount)
      : Math.min(snapshot.threatCreeps.length, defenderConfig.maxCount);
    const defenderPriority = squad ? 0 : 1;
    for (let i = defenderTotal; i < defenderTarget; i++) {
      const key = spawnKey("defender", home, i);
      if (!hasKey(queue, key)) {
        requests.push(
          createRequest("defender", home, i, key, defenderPriority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick),
        );
      }
    }
  }

  // P1：Harvester — 基于实际占用分配到最少拥挤的 source。
  // 使用本地占用副本，确保同一轮多次孵化时后续迭代能看到前面的分配。
  const harvesterConfig = getRoleBounds("harvester", home);
  const harvesterLiving = counts.harvester ?? 0;
  const harvesterTotal = harvesterLiving + pending.harvester;

  // P0-1: Storage 满仓时限采 — 有效目标降为 source 数（每 source 1 个矿工保底），
  // 不再补到 minCount。满仓时 harvester 产出被 drop 浪费，省下孵化能量给 upgrader/builder 消化库存。
  //
  // Body 感知饱和封顶：source 再生 10/tick，harvestWorkingParts(5) 个 WORK 即采空。
  // 每 source 所需矿工数 = ceil(5 / 单体 WORK 数)，受 maxMinersPerSource 站位上限约束。
  // 5W 时代（600 容量+）每 source 1 个矿工即饱和 — 超出饱和线的头数无产出可采，
  // 纯属浪费孵化能量与 CPU（tuned minCount 是头数思维，body 长大后不会自动缩）。
  const harvesterBody = estimatePlannedBody("harvester", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
  const workPerHarvester = countBodyParts(harvesterBody, "work");
  const minersPerSource = Math.min(
    CONFIG.assignment.maxMinersPerSource,
    Math.ceil(CONFIG.economy.harvestWorkingParts / workPerHarvester),
  );
  const saturationTarget = snapshot.sources.length * minersPerSource;
  const harvesterTarget = storageNearFull
    ? Math.min(snapshot.sources.length, harvesterConfig.minCount)
    : Math.min(harvesterConfig.minCount, saturationTarget);
  if (harvesterTotal < harvesterTarget) {
    // 专职矿工口径的占用映射（排除 worker 等流动角色），循环内累加，
    // 避免同轮重复分配同一 source。
    const localOccupancy = buildHarvesterOccupancy(creeps, queue, home);

    for (let i = harvesterTotal; i < harvesterTarget; i++) {
      const bestSource = pickLeastCrowdedSource(snapshot.sources, localOccupancy);
      const sourceId = bestSource?.id as Id<Source> | undefined;
      // 累加本地占用，确保下一个 harvester 分配到不同 source。
      if (sourceId) {
        localOccupancy.set(sourceId as string, (localOccupancy.get(sourceId as string) ?? 0) + 1);
      }
      const key = spawnKey("harvester", home, i, sourceId as string | undefined);
      if (!hasKey(queue, key)) {
        // 危机时 harvester 提为 P0：经济引擎优先于一切，尽快恢复采集。
        requests.push(
          createRequest("harvester", home, 1, key, inCrisis ? 0 : 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, sourceId),
        );
      }
    }
  }

  // P1：Hauler — 仅在有 container 或 storage 时才创建（hauler 无 WORK，不能自采）。
  // 能量驱动配额：根据 container 实际积压量决定 hauler 数量，而非固定乘数。
  // 逻辑：container 能量 > 80% 容量 → 需要 2 个 hauler（严重积压，搬运能力不足）
  //       container 能量 > 40% 容量 → 需要 1 个 hauler（正常物流压力）
  //       container 能量 < 40% → 不需要额外 hauler（搬运能力过剩，不孵）
  // 这确保 hauler 数量跟随实际物流压力动态调整，不会在 container 空时白孵。
  //
  // RCL5+ Link-aware 物流：
  //   当 source link 在线时，harvester 优先倒能到 link（而非 container），
  //   source container 几乎不填 → container 贡献自然降为 0（反馈 loop 正常工作）。
  //   但 link 网络把能量瞬移到 storage link，需要 hauler 排空（withdrawStorageLink）。
  //   这是 RCL5+ 的新物流任务，必须纳入需求信号，否则 storage link 积压无人搬。
  //   同时，storage link 排空后需求降到 0 → minCount 地板兜底 → tuning-engine
  //   观测到 container/link 持续空置（containerFillRatio 代理信号，无 container 时按 0 计）
  //   → 降低 minCount → hauler 数量自然减少。
  //   这就是「RCL5 后 link 参与物流，hauler 数量慢慢减少」的机制。
  const haulerConfig = getRoleBounds("hauler", home);
  const haulerTotal = (counts.hauler ?? 0) + pending.hauler;
  const hasLogistics = snapshot.containers.length > 0 || snapshot.storage !== undefined;
  let dynamicHaulerTarget = 0;
  if (hasLogistics) {
    // 1. Source container 积压信号（RCL1-4 主物流路径）。
    for (const c of snapshot.containers) {
      const capacity = c.store.getCapacity(RESOURCE_ENERGY) || 1;
      const fillRatio = c.store.getUsedCapacity(RESOURCE_ENERGY) / capacity;
      if (fillRatio > 0.8) dynamicHaulerTarget += 2;
      else if (fillRatio > 0.4) dynamicHaulerTarget += 1;
    }
    // 2. Storage link 积压信号（RCL5+ link 网络的「最后一公里」）。
    //    link-system 将 source link 能量瞬移到 storage link，hauler 需排空到 storage。
    //    无 storage 时不存在 storage link（classifyLink 回退为 hub）。
    if (snapshot.storage) {
      const storageLink = snapshot.links.find(
        l => l.pos.getRangeTo(snapshot.storage!) <= 2,
      );
      if (storageLink) {
        const linkCap = storageLink.store.getCapacity(RESOURCE_ENERGY) || 1;
        const linkFillRatio = storageLink.store.getUsedCapacity(RESOURCE_ENERGY) / linkCap;
        if (linkFillRatio > 0.8) dynamicHaulerTarget += 2;
        else if (linkFillRatio > 0.4) dynamicHaulerTarget += 1;
      }
    }
    // 运力归一化：积压档位（+1/+2）按基准运力（referenceCarryCapacity = 6 CARRY）标定。
    // body 随容量长大（RCL4 道路档 16C = 800 运力）后，同样积压需要的头数按比例折减；
    // 早期小 body（2C = 100 运力）则按比例扩编。头数 × 单体运力 ≈ 恒定总运力，
    // 消除「配额公式不随 body 变化」的浪费（大 body 时代多孵的每一头都是纯闲置）。
    if (dynamicHaulerTarget > 0) {
      const haulerBody = estimatePlannedBody("hauler", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
      const carryPerHauler = countBodyParts(haulerBody, "carry") * 50;
      dynamicHaulerTarget = Math.ceil(
        (dynamicHaulerTarget * CONFIG.economy.referenceCarryCapacity) / carryPerHauler,
      );
    }
    // 至少 minCount（保证基本物流不断），至多 maxCount。
    dynamicHaulerTarget = Math.min(haulerConfig.maxCount, Math.max(haulerConfig.minCount, dynamicHaulerTarget));

    // TD-015：economyPressure 梯度衰减 — pressure > 0.6 时线性降低 hauler 配额，
    // 让物流端平滑感知经济压力（而非仅靠 inCrisis 二值开关突然砍）。
    // pressure=0.6 无衰减，pressure=1.0 缩至 minCount。
    const haulerPressure = roomCtx.economyPressure;
    if (haulerPressure > 0.6) {
      dynamicHaulerTarget = Math.max(haulerConfig.minCount, Math.round(dynamicHaulerTarget * (1 - (haulerPressure - 0.6) / 0.4)));
    }
  }
  // 能量危机收缩（仅偿付危机适用）：收缩 hauler 到 minCount —— 仅保留把能量搬回 spawn
  // 供孵化 harvester 的最小力量，避免孵出一堆无能量可搬的空闲 hauler，白白浪费孵化能量。
  // 方案 C：流动性危机例外 —— 能量冻在 container（liquidityScore 主导）时 hauler 是解药，
  // 必须按 dynamicTarget 满量孵化才能搬空积压、打破「spawn 破产」死锁。
  // 此时收缩 hauler 会让死锁永久化（W37S58 根因之一）。
  const liquidityScore = roomCtx.liquidityScore ?? 0;
  const drainScore = roomCtx.drainScore ?? 0;
  const liquidityDriven = liquidityScore >= 40 && liquidityScore >= drainScore;
  const haulerTarget = (inCrisis && !liquidityDriven)
    ? Math.min(dynamicHaulerTarget, haulerConfig.minCount)
    : dynamicHaulerTarget;
  if (haulerTotal < haulerTarget && hasLogistics) {
    for (let i = haulerTotal; i < haulerTarget; i++) {
      const key = spawnKey("hauler", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("hauler", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
  }

  // P1：Distributor — 仅在有 storage 时才创建（RCL4+）。
  // 职责：从 storage 取能分发给 spawn/extension/tower/lab。
  // 与 hauler 的职责分离：hauler 是收集者（源→storage），distributor 是分发者（storage→sink）。
  // 无 storage 时不存在 distributor 的需求 — hauler 直接 container→sink 直送。
  // 数量：基于 fillTarget 需求量。spawn/extension/tower 未满时需要 distributor。
  const distConfig = getRoleBounds("distributor", home);
  const distTotal = (counts.distributor ?? 0) + pending.distributor;
  const hasStorage = snapshot.storage !== undefined;
  let distTarget = 0;
  if (hasStorage) {
    // fillTarget 数量决定需求，按单体运力折算头数：每 150 运力承接 1 个 fillTarget
    // （基准 body 6C=300 运力 → 2 个/头，与原「每 2 个 fillTarget 配 1 个」口径一致；
    // RCL4 道路档 16C=800 运力 → 5 个/头，大 body 时代自动减员）。
    // D-3 修复：编制信号与服务范围同口径 — tier ≥ 1（storage < full 50k）时
    // distributor 拒服 tower（水位节流），tower 就不得计入需求信号；
    // 否则「按含 tower 的缺口扩编 → 扩出来的编制不服务 tower」，
    // 信号虚高一档，尖峰期多孵的每一头都是常驻浪费。
    const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    const servesTowerFully = storageEnergy >= CONFIG.economy.distributorTiers.full;
    const towerAmmoFloor = CONFIG.economy.distributorTiers.towerAmmoFloor;
    // SN-1 连带：非 full 档编制信号排除 controllerContainer — 它容量 2000
    // 几乎恒有空位，计入会把需求信号抬高一个常量（cc 由既有编制顺路服务）。
    // tower 与服务范围同口径：full 档全量计入；战备线档（≥ low）只计
    // 低于弹药地板的塔 — 该信号是瞬态的（补到地板即消失），不会常驻虚高。
    const fillCount = servesTowerFully
      ? snapshot.fillTargets.length
      : snapshot.fillTargets.filter(t => {
          if (t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION) return true;
          return t.structureType === STRUCTURE_TOWER &&
            storageEnergy >= CONFIG.economy.distributorTiers.low &&
            t.store.getUsedCapacity(RESOURCE_ENERGY) < towerAmmoFloor;
        }).length;
    const distBody = estimatePlannedBody("distributor", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
    const fillPerDistributor = Math.max(2, Math.floor((countBodyParts(distBody, "carry") * 50) / 150));
    distTarget = Math.min(distConfig.maxCount, Math.max(distConfig.minCount, Math.ceil(fillCount / fillPerDistributor)));
    // 高耗远距 sink 排空反馈（镜像 hauler 的 container 积压反馈，方向相反）：
    // 上面的 fillCount 把 controller container 当「1 个待填结构」，但 cc 是高抽取率
    // sink（upgrader 连续抽）且常远离 storage，缺的是并行运力（多头轮流跑），不是
    // 「多算 1 个目标」（大 body 的 fillPerDistributor 会把它稀释掉）。无 controller
    // link 时 cc 见底即「供能不足」症状 —— 按 hauler 同款 +1/+2 档补 distributor 头数；
    // 有 link 则由 link 供能、不补。距离/速率由 fill 症状隐式覆盖（补了仍低 = 更远/更耗）。
    // 只在 storage 够养升级（tier<2 口径，≥sustained）时补，crisis/pressure 仍在下方裁剪。
    if (
      snapshot.controllerContainer !== undefined &&
      snapshot.controller?.my === true &&
      storageEnergy >= CONFIG.economy.distributorTiers.sustained
    ) {
      const hasControllerLink = snapshot.links.some(
        l => snapshot.controller != null && l.pos.getRangeTo(snapshot.controller) <= 2,
      );
      if (!hasControllerLink) {
        const ccCap = snapshot.controllerContainer.store.getCapacity(RESOURCE_ENERGY) || 1;
        const ccFill = snapshot.controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY) / ccCap;
        // fill 低 = 被抽干 = 运力不足；不做运力归一化 —— 远距 sink 要并行头数而非大 body。
        if (ccFill < 0.2) distTarget += 2;
        else if (ccFill < 0.5) distTarget += 1;
        distTarget = Math.min(distConfig.maxCount, distTarget);
      }
    }
    // TD-015：economyPressure 梯度衰减 — 与 hauler 同公式，pressure > 0.6 时线性降低 distributor 配额。
    const distPressure = roomCtx.economyPressure;
    if (distPressure > 0.6) {
      distTarget = Math.max(distConfig.minCount, Math.round(distTarget * (1 - (distPressure - 0.6) / 0.4)));
    }
    // 危机时收缩到 minCount。
    if (inCrisis) distTarget = Math.min(distTarget, distConfig.minCount);

    // 升编趋势确认：spawn 孵化瞬间抽干 spawn/extension → fillTargets 尖峰，
    // 这是 distributor 的日常工作信号而非缺员信号（在途编制一两趟即可补满）。
    // 扩编（超出现有编制且超出 minCount 地板）必须等需求持续
    // distributorScaleUpDelay tick 才放行；补足 minCount 与缩编即时生效。
    // 不确认的后果：一次 50 tick 的尖峰入队的请求活在队列里直至孵化，
    // 换来多个活 1500 tick 的常驻编制（与 builderPressureState 同为 Memory 短 key 迟滞先例）。
    const distMem = Memory.rooms[home];
    if (distTarget > distTotal && distTarget > distConfig.minCount) {
      const since = distMem?.distScaleUpSince;
      if (since === undefined) {
        // 需求首现 — 记录起点，本轮压回地板（现有编制或 minCount 的较大者）。
        if (distMem) distMem.distScaleUpSince = tick;
        distTarget = Math.min(distTarget, Math.max(distTotal, distConfig.minCount));
      } else if (tick - since < CONFIG.spawn.distributorScaleUpDelay) {
        // 确认窗口未满 — 继续压回地板。
        distTarget = Math.min(distTarget, Math.max(distTotal, distConfig.minCount));
      }
      // 窗口已满 → 需求真实持续，放行扩编（distTarget 保持折算值）。
    } else if (distMem?.distScaleUpSince !== undefined) {
      // 需求回落或编制已满足 — 尖峰未获确认，重置计时器。
      distMem.distScaleUpSince = undefined;
    }
  }
  if (distTotal < distTarget && hasStorage) {
    for (let i = distTotal; i < distTarget; i++) {
      const key = spawnKey("distributor", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("distributor", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
  }

  // P2：Upgrader — 仅在 normal 状态下，不在 bootstrap/recovery。
  // 当控制器存在降级风险时，即使在 recovery/bootstrap 也允许生成 upgrader（P1 优先级）。
  const hasDowngradeRisk = roomCtx.controllerDowngradeRisk;
  const allowUpgrader = colonyState === "normal" || hasDowngradeRisk;

  if (allowUpgrader) {
    const upgraderConfig = getRoleBounds("upgrader", home);
    const upgraderTotal = (counts.upgrader ?? 0) + pending.upgrader;

    // A2：升级功率改由「storage 水位 + 大 body WORK 数」驱动，替代固定小 body 数量梯度。
    // 老玩家认知：防御与 spawn 供能之外，盈余能量应优先灌 controller —— RCL 是复利。
    // 大 body 站桩（15W@1650）让 1 个 upgrader 即可跑满 ≈15/tick，creep 数更少、CPU 更省。
    const stationUpgradeOnline = snapshot.controllerContainer !== undefined;
    const ctrl = snapshot.controller;
    const crisisNeedsGuard =
      inCrisis && ctrl !== undefined && ctrl.ticksToDowngrade < CONFIG.economy.crisis.downgradeGuard;

    const pressure = roomCtx.economyPressure;
    const upgradeCfg = CONFIG.economy.upgrade;
    const workPerBody =
      selectBody("upgrader", energyCapacity, { rcl: snapshot.rcl }).filter(p => p === "work").length || 1;
    const hasStorage = snapshot.storage !== undefined;
    const storageEnergy = hasStorage ? snapshot.storage!.store.getUsedCapacity(RESOURCE_ENERGY) : 0;

    let upgraderTarget: number;
    if (hasDowngradeRisk || crisisNeedsGuard) {
      // 保级紧急：拉满（自采也要保级）。
      upgraderTarget = upgraderConfig.maxCount;
    } else if (!stationUpgradeOnline) {
      // 无 controller container：多 upgrader 长途自采，通勤浪费抵消数量优势，保持 minCount。
      upgraderTarget = pressure <= 0.7 ? upgraderConfig.minCount : 0;
    } else if (hasStorage && storageEnergy >= upgradeCfg.sprintStorage && pressure <= 0.3) {
      // 冲刺：库存充足且经济健康，烧库存换 RCL 复利（2 个满 body 站桩）。
      // P0-1: Storage 满仓时拉满 maxCount — 盈余能量必须被消化，否则在源头被浪费。
      upgraderTarget = storageNearFull
        ? upgraderConfig.maxCount
        : Math.min(upgraderConfig.maxCount, 2);
    } else if (hasStorage && storageEnergy >= upgradeCfg.sustainedStorage) {
      // 维持：1 个大 body 站桩 ≈ 15/tick，盈余全喂 controller。
      upgraderTarget = 1;
    } else if (!hasStorage) {
      // RCL1-3 早期猛冲（无 storage，能量不升级也是浪费）：沿用 pressure 梯度。
      // pressure 0.0–0.3 满目标；0.3–0.7 线性缩到 minCount；0.7–1.0 缩到 0。
      const fullTarget = stationUpgradeOnline ? upgraderConfig.maxCount : upgraderConfig.minCount;
      if (pressure <= 0.3) {
        upgraderTarget = fullTarget;
      } else if (pressure <= 0.7) {
        const t = (pressure - 0.3) / 0.4;
        upgraderTarget = Math.round(fullTarget + t * (upgraderConfig.minCount - fullTarget));
      } else {
        const t = (pressure - 0.7) / 0.3;
        upgraderTarget = Math.round(upgraderConfig.minCount * (1 - t));
      }
    } else {
      // storage 低水位（< sustained）：最多 1 个大 body，pressure 高则停升级攒库存。
      upgraderTarget = pressure <= 0.5 ? 1 : 0;
    }

    // RCL8 官方限速：controller 每 tick 最多吃 15 能量升级。
    // 按当前 body 的 WORK 数折算 creep 数上限（15W body → 1 个，恰好顶满）。
    if (snapshot.rcl >= 8) {
      const maxCountByWork = Math.max(1, Math.floor(upgradeCfg.rcl8MaxWorkParts / workPerBody));
      upgraderTarget = Math.min(upgraderTarget, maxCountByWork);
    }
    // 保级覆盖：控制器快降级时至少保留 minCount。
    if (crisisNeedsGuard || hasDowngradeRisk) {
      upgraderTarget = Math.max(upgraderTarget, upgraderConfig.minCount);
    }

    if (upgraderTotal < upgraderTarget) {
      // 降级风险时提升为 P1 优先级，确保快速保级。
      const upgraderPriority: 0 | 1 | 2 | 3 | 4 = hasDowngradeRisk ? 1 : 2;
      for (let i = upgraderTotal; i < upgraderTarget; i++) {
        const key = spawnKey("upgrader", home, i);
        if (!hasKey(queue, key)) {
          requests.push(createRequest("upgrader", home, i, key, upgraderPriority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
        }
      }
    }

  }

  // P2：Builder — 独立于 upgrader 门禁。
  // 灾后重建（recovery）时 builder 是生存角色，不是发展角色——必须允许 spawn。
  // bootstrap 时不孵 builder（新手房优先建立能量链）。
  // 动态数量：每个活跃 site 配 1 个 builder，但上限受经济承载力约束。
  //
  // 道路维修需求信号：成熟房布局建成后 site 归零 → builder 消亡，
  // 但道路持续衰减且塔不修路（只修 critical 与 wall/rampart）——
  // 无此信号时道路只能塌毁重建（重建耗能约为维修 6 倍 + 塌毁窗口期物流减速）。
  // 待修道路达到门槛时，即使无 site 也维持 1 个 builder 巡修
  //（builder work 链自带 repairRoads，无需新增行为）。
  const roadsNeedingRepair = snapshot.roads.filter(
    r => r.hits < r.hitsMax * CONFIG.construction.roadRepairThreshold,
  ).length;
  const roadRepairDemand = roadsNeedingRepair >= CONFIG.construction.roadRepairBuilderFloor;
  if (colonyState !== "bootstrap" && (snapshot.myConstructionSites.length > 0 || roadRepairDemand)) {
    const builderConfig = getRoleBounds("builder", home);
    const builderTotal = (counts.builder ?? 0) + pending.builder;
    const economyCap = (counts.harvester ?? 0) + (counts.worker ?? 0) + 1;
    let dynamicBuilderTarget = Math.min(
      builderConfig.maxCount,
      economyCap,
      Math.max(
        builderConfig.minCount,
        snapshot.myConstructionSites.length,
        // 纯维修需求保底 1 个 — minCount 可能为 0（成熟房 tuning 收缩后）。
        roadRepairDemand ? 1 : 0,
      ),
    );
    // B-5：编制感知取能供给（水位权限表）— site 数是需求信号，
    // 但编制不得超过能量供给可承载的数量：
    //   storage < low(2k)：builderStorageLimit 已拒绝取能，builder 只能
    //     container/直采 → 封顶 minCount（多孵的每一头都在排队等能量）；
    //   storage < sustained(10k)：50/趟 的涓流供给只养得起 1 个。
    // 无 storage（RCL1-3）时直采供给由 economyCap（harvester+worker+1）近似。
    if (snapshot.storage) {
      const builderStorageEnergy = snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
      const supplyTiers = CONFIG.economy.distributorTiers;
      if (builderStorageEnergy < supplyTiers.low) {
        dynamicBuilderTarget = Math.min(dynamicBuilderTarget, builderConfig.minCount);
      } else if (builderStorageEnergy < supplyTiers.sustained) {
        dynamicBuilderTarget = Math.min(dynamicBuilderTarget, Math.max(builderConfig.minCount, 1));
      }
    }
    // 梯度缩放：用 economyPressure 迟滞带替代单阈值开关（TD-016）。
    // 迟滞窗：进入收缩 > 0.35，退出收缩 <= 0.25，带内保持当前状态。
    // 消除 pressure 在阈值附近波动时 builder 目标反复跳变的振荡。
    const builderPressure = roomCtx.economyPressure;
    const roomMem = Memory.rooms[home];
    let state = roomMem?.builderPressureState ?? 'full';
    if (state === 'full' && builderPressure > 0.35) {
      state = 'shrinking';
      if (roomMem) roomMem.builderPressureState = state;
    } else if (state === 'shrinking' && builderPressure <= 0.25) {
      state = 'full';
      if (roomMem) roomMem.builderPressureState = state;
    }
    let builderTarget: number;
    if (state === 'full') {
      builderTarget = dynamicBuilderTarget;
    } else {
      // shrinking：从 0.35 开始线性收缩，到 1.0 缩至 minCount。
      const t = Math.min(1, (builderPressure - 0.35) / 0.65);
      builderTarget = Math.round(dynamicBuilderTarget + t * (builderConfig.minCount - dynamicBuilderTarget));
      builderTarget = Math.max(builderTarget, builderConfig.minCount);
    }
    if (builderTotal < builderTarget) {
      // recovery 时提升为 P1（重建被毁基建是生存行为）；normal 时保持 P2（发展）。
      const builderPriority: 0 | 1 | 2 | 3 | 4 = inCrisis ? 1 : 2;
      for (let i = builderTotal; i < builderTarget; i++) {
        const key = spawnKey("builder", home, i);
        if (!hasKey(queue, key)) {
          requests.push(createRequest("builder", home, i, key, builderPriority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
        }
      }
    }
  }

  // 即将死亡的 creep 的替换请求。
  // 老玩家四重门禁，防止 creep 数量激增：
  //   1. 角色存在性门禁（worker 有 harvester 时不替换，builder 无 site 不替换）
  //   2. maxCount 硬上限（living + pending 已达上限不替换）
  //   3. 盈余检查（living + pending > minCount 说明有多余，不替换）
  //   4. 稳定 key（不含 sourceId，防止 assignment 重分配导致 key 漂移产生重复）
  const roleConfigs = getAllRoleBounds(home);

  for (const creep of creeps) {
    if (creep.home !== home) continue;
    // A4：harvester 的替换阈值计入 spawn→source 通勤路程，
    // 防止替补还没走到矿位老矿工已死、采集断档。
    const travelTicks = creep.role === "harvester" ? estimateTravelTicks(snapshot, creep.sourceId) : 0;
    if (!needsReplacement(creep.ticksToLive, creep.bodyLength, travelTicks)) continue;
    const role = creep.role;
    const config = roleConfigs[role];
    if (!config) continue;

    // 门禁 1：角色存在性 — worker 是紧急角色，harvester 建立后不再替换。
    if (role === "worker" && (counts.harvester ?? 0) + (counts.worker ?? 0) > 1) continue;
    // builder 无建造 site 且无道路维修需求时不替换（避免孵化无事可做的 builder）。
    if (role === "builder" && snapshot.myConstructionSites.length === 0 && !roadRepairDemand) continue;
    // upgrader 在 colonyState 不允许时不替换。
    if (role === "upgrader" && !allowUpgrader) continue;

    // 门禁 2：maxCount 硬上限。
    const livingCount = counts[role] ?? 0;
    const pendingCount = countPending(queue, role, home) + requests.filter(r => r.role === role).length;
    if (livingCount + pendingCount >= config.maxCount) continue;

    // 门禁 3：盈余检查 — 如果去掉这个将死的 creep 后仍 >= minCount，说明有多余，不替换。
    // 只有当 "将死 creep 是维持 minCount 的必要成员" 时才提前替换（利用 overlap 无缝衔接）。
    if (livingCount - 1 + pendingCount >= config.minCount) continue;

    // 门禁 4：稳定 key — 不含 sourceId，防止 assignment 重分配导致 key 漂移。
    const index = creep.spawnIndex ?? 0;
    const key = spawnKey(role, home, index);
    if (!hasKey(queue, key) && !requests.some(r => r.key === key)) {
      const priority = role === "harvester" || role === "worker" ? 1 : 2;
      // harvester 替补重选矿位：垂死者的矿位视为已空出，按专职口径重挑。
      // 常态下会选回原矿位（无缝接班语义不变）；但当历史错配存在
      // （如两只矿工挤同源）时，替补会自动纠偏到最空的 source，
      // 而不是盲目继承垂死者矿位让错配永续。
      let assignSourceId = creep.sourceId;
      if (role === "harvester" && snapshot.sources.length > 0) {
        const occ = buildHarvesterOccupancy(creeps, queue, home, creep.name);
        assignSourceId =
          (pickLeastCrowdedSource(snapshot.sources, occ)?.id as Id<Source> | undefined) ?? creep.sourceId;
      }
      const req = createRequest(role, home, index, key, priority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, assignSourceId);
      req.replaceBy = tick + req.body.length * 3 + CONFIG.spawn.replaceBuffer + travelTicks;
      requests.push(req);
    }
  }

  return { requests };
}

function hasKey(queue: readonly SpawnRequest[], key: string): boolean {
  return queue.some(r => r.key === key);
}

/**
 * 创建孵化请求（纯函数）。
 *
 * energyAvailable 和 tick 由调用方显式传入，不从 Game/Memory 读取。
 */
function createRequest(
  role: string,
  home: string,
  index: number,
  key: string,
  priority: 0 | 1 | 2 | 3 | 4,
  energyCapacity: number,
  energyAvailable: number,
  colonyState: ColonyState,
  rcl: number,
  tick: number,
  sourceId?: Id<Source>,
): SpawnRequest {
  // X-16：body 选择策略按角色和状态分层：
  //   P0（紧急 worker）/ crisis / recovery / bootstrap：基于 energyAvailable 降级，速出保命。
  //   P1 harvester 在 normal 状态：使用 energyCapacity 满配 body，不降级。
  //     原因：2W harvester（300 能量）产出 4/tick vs 1W（200 能量）产出 2/tick，
  //     多等 100 能量（~50 tick）换来整个生命周期（1500 tick）双倍产出，ROI 极高。
  //     trySpawn 对非 P0 请求会自动等待能量足够再孵化，无需在请求层面降级。
  //   P2+（upgrader/builder）：使用 energyCapacity 满配。
  let body: BodyPartConstant[];
  // defender 始终降级：防御是时间敏感的 — 敌人正在拆家时，
  // 30 tick 后出场的满配不如现在就出场的半配（塔在补足火力差）。
  const shouldDegrade =
    priority === 0 ||
    role === "defender" ||
    colonyState === "bootstrap" ||
    colonyState === "recovery";
  if (shouldDegrade) {
    const fullBody = selectBody(role, energyCapacity, { rcl });
    const requiredParts = ROLE_REQUIRED_PARTS[role];
    // 优雅降级：孵化当前能量能负担的最大 body。宁可先出一个较小的 harvester（低效但维持 colony 存活），
    // 也不要为等待大 body 而让 harvester 断档归零（曾因此陷入「无 harvester→无收入→永远孵不起」死锁）。
    // 回退产物过 guardRoleFallback：能量连最低档都不够时（如 defender @130），
    // 宁可带最低档 body 排队等能量，也不铸出缺必需部件的废件。
    body =
      degradeBody(fullBody, energyAvailable, requiredParts) ??
      guardRoleFallback(role, selectBody(role, energyAvailable, { rcl }));
  } else {
    body = selectBody(role, energyCapacity, { rcl });
  }

  const memory: CreepMemory = {
    role,
    home,
    mode: "acquire",
    spawnIndex: index,
    ...(sourceId ? { sourceId } : {}),
  };

  return {
    key,
    role,
    home,
    priority,
    body,
    memory,
    createdAt: tick,
    // 请求带 TTL：需求消失后的 stale 请求由 cleanQueue 清除；
    // 需求仍在时下一 tick 以同 key 重建（hasKey 守卫解除）。
    // 副作用收益：重建时按当时容量重选 body，避免入队后 body 长期冻结。
    // TTL(1000) > 饥饿降级窗口（见 CONFIG.spawn.requestTtl 注释），不干扰降级计时。
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  };
}
