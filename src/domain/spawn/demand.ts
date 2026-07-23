import { CONFIG } from "../../config";
import { degradeBody, selectBody } from "../../config/bodies";
import { getRoleBounds, getAllRoleBounds } from "../../config/tuned";
import type { ColonyState, RoomSnapshot } from "../../kernel/contracts";
import { countPending, spawnKey } from "./queue";

/** 各角色降级时必需保留的最小部件组合。hauler 无需 WORK。 */
export const ROLE_REQUIRED_PARTS: Readonly<Record<string, readonly BodyPartConstant[]>> = {
  hauler: ["carry", "move"],
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

  // 单次遍历获取所有角色计数。
  const counts = countCreepsByRole(creeps, spawning, home);
  const pending = {
    harvester: countPending(queue, "harvester"),
    worker: countPending(queue, "worker"),
    hauler: countPending(queue, "hauler"),
    upgrader: countPending(queue, "upgrader"),
    builder: countPending(queue, "builder"),
  };

  // P0：恢复 worker — 当没有存活 harvester/worker 时。
  // 仅看存活数（counts），不看 pending — pending 中的 stale 请求可能永远无法孵化
  // （如能量不足降级失败），若计入会导致 harvesterCount > 0 → P0 worker 不创建 → 死锁。
  const livingHarvesters = (counts.harvester ?? 0) + (counts.worker ?? 0);

  if (livingHarvesters === 0) {
    const key = spawnKey("worker", home, 0);
    requests.push(createRequest("worker", home, 0, key, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
    return { requests }; // P0 阻塞其他所有请求
  }

  // P1：Harvester — 基于实际占用分配到最少拥挤的 source。
  // 使用本地占用副本，确保同一轮多次孵化时后续迭代能看到前面的分配。
  const harvesterConfig = getRoleBounds("harvester", home);
  const harvesterLiving = counts.harvester ?? 0;
  const harvesterTotal = harvesterLiving + pending.harvester;

  if (harvesterTotal < harvesterConfig.minCount) {
    // 本地占用映射：从快照复制，循环内累加，避免同轮重复分配同一 source。
    const localOccupancy = new Map<string, number>(
      [...snapshot.sourceOccupancy.entries()].map(([k, v]) => [k, v] as [string, number]),
    );

    for (let i = harvesterTotal; i < harvesterConfig.minCount; i++) {
      // 找到占用最少的 source。
      let bestSource: Source | undefined;
      let bestCount = Infinity;
      for (const source of snapshot.sources) {
        const count = localOccupancy.get(source.id) ?? 0;
        if (count < bestCount) {
          bestCount = count;
          bestSource = source;
        }
      }
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
  const haulerConfig = getRoleBounds("hauler", home);
  const haulerTotal = (counts.hauler ?? 0) + pending.hauler;
  const hasLogistics = snapshot.containers.length > 0 || snapshot.storage !== undefined;
  let dynamicHaulerTarget = 0;
  if (hasLogistics) {
    for (const c of snapshot.containers) {
      const capacity = c.store.getCapacity(RESOURCE_ENERGY) || 1;
      const fillRatio = c.store.getUsedCapacity(RESOURCE_ENERGY) / capacity;
      if (fillRatio > 0.8) dynamicHaulerTarget += 2;
      else if (fillRatio > 0.4) dynamicHaulerTarget += 1;
    }
    // 至少 minCount（保证基本物流不断），至多 maxCount。
    dynamicHaulerTarget = Math.min(haulerConfig.maxCount, Math.max(haulerConfig.minCount, dynamicHaulerTarget));
  }
  // 能量危机：收缩 hauler 到 minCount —— 仅保留把能量搬回 spawn 供孵化 harvester 的最小力量，
  // 避免孵出一堆无能量可搬的空闲 hauler，白白浪费孵化能量。
  const haulerTarget = inCrisis
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
      upgraderTarget = Math.min(upgraderConfig.maxCount, 2);
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

    // P2：Builder — 仅当存在建造 site 时。
    // 动态数量：每个活跃 site 配 1 个 builder，但上限受经济承载力约束。
    // 修复：旧实现 target=sites.length 导致 5 个 site 时孵 4 个 builder，
    // 全部竞争有限能量（2 harvester 仅产 4/tick），大部分 builder 空闲在 acquire。
    // 新上限：min(sites, harvester 存活数 + 1) — builder 数量不超过经济能供养的范围。
    if (snapshot.myConstructionSites.length > 0) {
      const builderConfig = getRoleBounds("builder", home);
      const builderTotal = (counts.builder ?? 0) + pending.builder;
      const economyCap = (counts.harvester ?? 0) + (counts.worker ?? 0) + 1;
      const dynamicBuilderTarget = Math.min(
        builderConfig.maxCount,
        economyCap,
        Math.max(builderConfig.minCount, snapshot.myConstructionSites.length),
      );
      // 梯度缩放：用 economyPressure 连续信号替代二值 crisis 开关。
      // pressure 0.0–0.3: 满目标（健康）
      // pressure 0.3–1.0: 线性从满目标缩到 minCount（builder 始终保留 minCount 处理关键重建）
      const builderPressure = roomCtx.economyPressure;
      let builderTarget: number;
      if (builderPressure <= 0.3) {
        builderTarget = dynamicBuilderTarget;
      } else {
        const t = (builderPressure - 0.3) / 0.7;
        builderTarget = Math.round(dynamicBuilderTarget + t * (builderConfig.minCount - dynamicBuilderTarget));
        builderTarget = Math.max(builderTarget, builderConfig.minCount);
      }
      if (builderTotal < builderTarget) {
        for (let i = builderTotal; i < builderTarget; i++) {
          const key = spawnKey("builder", home, i);
          if (!hasKey(queue, key)) {
            requests.push(createRequest("builder", home, i, key, 2, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
          }
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
    // builder 无建造 site 时不替换（避免孵化无事可做的 builder）。
    if (role === "builder" && snapshot.myConstructionSites.length === 0) continue;
    // upgrader 在 colonyState 不允许时不替换。
    if (role === "upgrader" && !allowUpgrader) continue;

    // 门禁 2：maxCount 硬上限。
    const livingCount = counts[role] ?? 0;
    const pendingCount = countPending(queue, role) + requests.filter(r => r.role === role).length;
    if (livingCount + pendingCount >= config.maxCount) continue;

    // 门禁 3：盈余检查 — 如果去掉这个将死的 creep 后仍 >= minCount，说明有多余，不替换。
    // 只有当 "将死 creep 是维持 minCount 的必要成员" 时才提前替换（利用 overlap 无缝衔接）。
    if (livingCount - 1 + pendingCount >= config.minCount) continue;

    // 门禁 4：稳定 key — 不含 sourceId，防止 assignment 重分配导致 key 漂移。
    const index = creep.spawnIndex ?? 0;
    const key = spawnKey(role, home, index);
    if (!hasKey(queue, key) && !requests.some(r => r.key === key)) {
      const priority = role === "harvester" || role === "worker" ? 1 : 2;
      const req = createRequest(role, home, index, key, priority, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick, creep.sourceId);
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
  const shouldDegrade = priority === 0 || colonyState === "bootstrap" || colonyState === "recovery";
  if (shouldDegrade) {
    const fullBody = selectBody(role, energyCapacity, { rcl });
    const requiredParts = ROLE_REQUIRED_PARTS[role];
    // 优雅降级：孵化当前能量能负担的最大 body。宁可先出一个较小的 harvester（低效但维持 colony 存活），
    // 也不要为等待大 body 而让 harvester 断档归零（曾因此陷入「无 harvester→无收入→永远孵不起」死锁）。
    body = degradeBody(fullBody, energyAvailable, requiredParts) ?? selectBody(role, energyAvailable, { rcl });
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
    retries: 0,
  };
}
