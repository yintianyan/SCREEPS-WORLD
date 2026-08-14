import { CONFIG } from "../../config";
import { degradeBody, minimalBodyFor, RECOVERY_BODY, selectBody } from "../../config/bodies";
import { getRoleBounds, getAllRoleBounds } from "../../config/tuned";
import type { ColonyState, RoomSnapshot } from "../../kernel/contracts";
import { countPending, spawnKey } from "./queue";
import { classifyLinkRole } from "../economy/links";

/** 各角色降级时必须保留的最小部件；hauler/distributor 无需 WORK。 */
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

/** 单个 creep 摘要 — 纯函数消费，不持有 Creep 对象；适配层从 Game.creeps 收集后传入。 */
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

/** 房间经济上下文 — 适配层从 Memory/Game 收集的标志位，供纯函数消费。 */
export interface RoomDemandContext {
  colonyState: ColonyState;
  controllerDowngradeRisk: boolean;
  energyAvailable: number;
  /** 经济压力梯度 (0–1)，0=健康、1=危机；用于梯度缩放 P2 角色数量。 */
  economyPressure: number;
  /** storage 超满仓阈值 — 触发限采 + 加速消费。 */
  storageNearFull?: boolean;
  /** 流动性危机分 (0-100)（方案 C）：能量冻在 container / spawn 破产的物流死锁；
   *  与 drainScore 比较判定危机由哪一维度主导（流动性需多 hauler，偿付需收缩）。 */
  liquidityScore?: number;
  /** 偿付危机分 (0-100)；与 liquidityScore 比较判定危机主导维度。 */
  drainScore?: number;
  /**
   * P1-J：上一 tick 迟滞状态（适配层从 RoomMemory 读出注入）：distScaleUpSince
   * （distributor 扩编确认计时器）与 builderPressureState（压力迟滞带）。
   * undefined = 首次运行 → 按首现处理；domain 不访问 Memory。
   */
  prevHysteresis?: {
    distScaleUpSince?: number;
    builderPressureState?: "full" | "shrinking";
  };
  /** P2-2：tuning pending（hauler min/maxCount pendingValidation）期间主动收敛到合同目标，
   *  配合 P1-1 isContractMet 让调参合同能真正满足；undefined = 无 pending，按常规计算。 */
  haulerPendingTarget?: number;
  /** R6a：帝国议程 initiative（empire-strategy 发布，spawn-manager 适配层注入）。
   *  "rcl-push" 时 upgrader 冲刺门槛放宽一档 — 目标驱动主动冲级，而非等水位自然触发。 */
  agendaInitiative?: string;
}

/**
 * 评估产出的下一 tick 迟滞状态（P1-J）。
 *
 * 由适配层写回 RoomMemory。与 prevHysteresis 同构 — demand 是状态机：
 * 输入上一状态 → 输出下一状态。原本由 demand 直读写 Memory，
 * 现收敛为显式输入输出，domain 恢复纯函数。
 */
export interface HysteresisState {
  distScaleUpSince?: number;
  builderPressureState?: "full" | "shrinking";
}

interface DemandResult {
  requests: SpawnRequest[];
  /** P1-J：本 tick 评估产出的迟滞状态，适配层负责写回 RoomMemory。 */
  nextHysteresis: HysteresisState;
  /** 本 tick hauler 编制目标（B3，2026-08-01）— 供回收通道判定「富余 hauler」：
   *  link 化后编制收缩不能只靠死亡不补（1500 tick/代）；无物流基建或 P0 短路时为 undefined。 */
  haulerTarget?: number;
}

/** 统计房间内各角色存活 creep 数（含孵化中；纯函数，接收预收集摘要）。 */
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

/** 是否即将需替换：阈值 = body.length×3（孵化耗时）+ buffer（安全余量）+ travelTicks（通勤）。 */
export function needsReplacement(
  ticksToLive: number | undefined,
  bodyLength: number,
  travelTicks = 0,
): boolean {
  if (ticksToLive === undefined) return false;
  const threshold = bodyLength * 3 + CONFIG.spawn.replaceBuffer + travelTicks;
  return ticksToLive <= threshold;
}

/** 估算 harvester 从 spawn 到 source 的通勤 tick（Chebyshev × 1.5 地形系数，上限 50）；
 *  用于替换阈值，防「替补未到矿工已死」的采集断档。 */
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
 * 降级回退守卫：selectBody 回退产物若缺角色必需部件或就是 RECOVERY_BODY 本身，
 * 改用最低档模板排队等能量而非孵出不可用单位。RECOVERY_BODY 兜底对非 W/C/M
 * 角色是陷阱（defender 会拿到无 ATTACK 的假防御者；hauler 平白多买 WORK 死重 —
 * carry/move 恰齐备会骗过缺件检查）。仅对显式声明 requiredParts 的角色生效 —
 * W/C/M 角色的兜底是正确语义，不动。
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
 * 估算「本 tick 若孵化该角色实际得到的 body」— 与 createRequest 降级路径同口径：
 * bootstrap/recovery 按 energyAvailable 降级速出保命、normal 按 energyCapacity 满配。
 * 口径不一致的后果：危机时按满配折算数量 → 头数偏少 + 实际孵出小 body → 能力双重缺口。
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
 * 专职 harvester 矿位占用映射 — 只统计 harvester（存活 + 队列 pending），排除 worker：
 * worker 采集只是临时行为，计入会误导分配（实测团灭恢复期 worker 挂名南源 → 两只专职
 * 矿工因平局偏向全分北源，南源荒废、采集吞吐减半）。
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
 * 评估房间孵化需求（纯函数）— 返回待提交 SpawnRequest 列表。
 * 优先级序：P0 恢复 worker（无 harvester 时）→ P1 harvester（source 分配）/hauler
 * → P2 upgrader/builder（builder 仅在有建造需求时）。
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
  /** B3：hauler 编制目标（供回收通道判定富余）。 */
  let haulerTarget: number | undefined;
  // 统一经济状态：recovery 涵盖 crisis + recovery 相位，收缩非关键消耗。
  const inCrisis = colonyState === "recovery";
  // Storage 满仓信号 — 限采 + 加速消费。
  const storageNearFull = roomCtx.storageNearFull === true;

  // P1-J：迟滞输出缓冲 — 从 prevHysteresis 复制（未变更字段透传），各评估块写入后返回。
  const nextHysteresis: HysteresisState = {
    distScaleUpSince: roomCtx.prevHysteresis?.distScaleUpSince,
    builderPressureState: roomCtx.prevHysteresis?.builderPressureState,
  };

  // P0-3：读取 churnFreezeUntil 构造冻结角色集（spawn-manager 在 cleanQueue 后写入）—
  // 熔断期间跳过对应角色评估。P0 worker 恢复路径（livingHarvesters===0）绝对不冻结 —
  // rcl1-survival 生命线（见下方 P0 块早期 return）。
  const frozenRoles = new Set<string>();
  const roomMem = Memory.rooms[home];
  if (roomMem?.churnFreezeUntil) {
    for (const [role, until] of Object.entries(roomMem.churnFreezeUntil)) {
      if (typeof until === "number" && tick < until) frozenRoles.add(role);
    }
  }

  // 角色计数单次遍历；pending 按 home 过滤 — sponsor 房代孵的拓荒请求（home 指向他房）
  // 寄宿本房队列，不得计入本房人口预算。
  const counts = countCreepsByRole(creeps, spawning, home);
  const pending = {
    harvester: countPending(queue, "harvester", home),
    worker: countPending(queue, "worker", home),
    hauler: countPending(queue, "hauler", home),
    distributor: countPending(queue, "distributor", home),
    upgrader: countPending(queue, "upgrader", home),
    builder: countPending(queue, "builder", home),
  };

  // P0：恢复 worker — 无存活 harvester/worker 时。仅看存活数不看 pending：
  // stale 请求可能永远无法孵化（能量不足降级失败），计入会导致 P0 worker 不创建而死锁。
  const livingHarvesters = (counts.harvester ?? 0) + (counts.worker ?? 0);

  if (livingHarvesters === 0) {
    // W-3：P0 恢复不无视 defense 态 — 威胁仍在时先孵的 worker 出门即被杀（200 能量白送）；
    // 先入队 P0 defender 清场，worker 同队跟进（同优先级按 createdAt，defender 先孵）。
    if (snapshot.threatCreeps.length > 0) {
      const defKey = spawnKey("defender", home, 0);
      if (!hasKey(queue, defKey)) {
        requests.push(createRequest("defender", home, 0, defKey, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
    const key = spawnKey("worker", home, 0);
    requests.push(createRequest("worker", home, 0, key, 0, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
    // P0 阻塞路径：迟滞状态透传 prevHysteresis（不更新，下一 tick 重新评估）。
    return { requests, nextHysteresis: roomCtx.prevHysteresis ?? {} };
  }

  // P1：Defender — 威胁响应（防御优先于经济扩员）：塔远程集火、defender 贴脸补刀；
  // 无塔窗口期（RCL1-2/塔被打空）它是唯一主动防线。数量按威胁数缩放、maxCount 封顶；
  // 威胁清除后不补充，存量自然到期（minCount=0）。M11：小队威胁（≥2 武装或武装+治疗）
  // 升级响应 — 保底 2 只且优先级升 P0（插队所有经济孵化）。定位是清剿护航，不是救火
  // （救火归塔与集结避险）。
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

  // P1：Harvester — 按实际占用分配到最少拥挤的 source；本地占用副本让同轮多次孵化
  // 看到前序分配。P0-3：churn 熔断跳过评估；P0 worker 已早期 return，不受影响（生命线不冻结）。
  const harvesterConfig = getRoleBounds("harvester", home);
  const harvesterLiving = counts.harvester ?? 0;
  const harvesterTotal = harvesterLiving + pending.harvester;

  // P0-1：storage 满仓时限采 — 目标降为 source 数（每 source 保底 1），不再补 minCount；
  // 满仓产出被 drop 浪费，省下能量给 upgrader/builder 消化库存。
  // Body 感知饱和封顶：source 再生 10/tick、5 个 WORK 即采空 → 每 source 矿工数 =
  // ceil(5/单体 WORK 数)，受 maxMinersPerSource 封顶。超出饱和线的头数无产出可采，
  // 纯浪费（tuned minCount 是头数思维，body 长大后不会自动缩）。
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
  if (harvesterTotal < harvesterTarget && !frozenRoles.has("harvester")) {
    // 专职口径占用映射（排除 worker 等流动角色）；循环内累加避免同轮重复分配同源。
    const localOccupancy = buildHarvesterOccupancy(creeps, queue, home);

    for (let i = harvesterTotal; i < harvesterTarget; i++) {
      const bestSource = pickLeastCrowdedSource(snapshot.sources, localOccupancy);
      const sourceId = bestSource?.id as Id<Source> | undefined;
      // 累加本地占用 — 确保下一只分配到不同 source。
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

  // P1：Hauler — 仅在有 container/storage 时创建（无 WORK 不能自采）。能量驱动配额：
  // container 能量 >80% → +2（严重积压）、>40% → +1（正常压力）、<40% → 0（过剩不孵），
  // 跟随实际积压而非固定乘数，container 空时不白孵。
  //
  // RCL5+ Link 物流：source link 在线时 harvester 优先倒 link，container 几乎不填 →
  // container 贡献自然降 0（反馈 loop 正常）；能量瞬移到 storage link 后需 hauler 排空
  // （withdrawStorageLink）— 这是新物流任务，必须纳入需求信号。排空后需求归 0 →
  // minCount 地板兜底 → tuning-engine 观测空置（containerFillRatio 代理）降 minCount →
  // hauler 数自然减少。这就是「RCL5 后 link 参与物流，hauler 慢慢变少」的机制。
  const haulerConfig = getRoleBounds("hauler", home);
  const haulerTotal = (counts.hauler ?? 0) + pending.hauler;
  const hasLogistics = snapshot.containers.length > 0 || snapshot.storage !== undefined;
  let dynamicHaulerTarget = 0;
  if (hasLogistics) {
    // 接收端可达性闸门：有 storage 时它是无限 sink，container 堆积必为运力不足 → 加人正确；
    // 无 storage 且所有 sink（spawn/ext/tower/cc）均满时，堆积是消费瓶颈而非运力瓶颈 —
    // 加 hauler 只会满载 idle 当移动仓库（单边积压反馈的盲点），回落 minCount；
    // sink 开口后 fillTargets 重现，backlog 信号自动恢复 — 安全、自愈。
    const canDeliver = snapshot.storage !== undefined || snapshot.fillTargets.length > 0;
    // 1. Source container 积压信号（RCL1-4 主物流路径；仅可投放时才算运力不足）。
    //    B1（2026-08-01）：剔除有 source link 的 container — link 化后容器满是背压症状
    //    （link 满倒不进 / storage link 未排空），不是「需更多 hauler」；真需求由下方
    //    storage link 信号处理。不剔除会致编制不降反升（W7N3/W7N4：满 2000 计 +2/+2
    //    而 4 只 hauler 已有空载在晃）。
    if (canDeliver) {
      const sourceWithLink = new Set<string>();
      for (const s of snapshot.sources) {
        const hasLink = snapshot.links.some(l =>
          l.pos.getRangeTo(s.pos) <= CONFIG.economy.link.anchorRange &&
          classifyLinkRole(
            l.pos,
            snapshot.sources.map(p => p.pos),
            snapshot.controller?.pos,
            snapshot.storage?.pos,
            CONFIG.economy.link.anchorRange,
          ) === "source",
        );
        if (hasLink) sourceWithLink.add(s.id);
      }
      for (const c of snapshot.containers) {
        const coveredByLink = snapshot.sources.some(
          s => sourceWithLink.has(s.id) && c.pos.getRangeTo(s.pos) <= 1,
        );
        if (coveredByLink) continue;
        const capacity = c.store.getCapacity(RESOURCE_ENERGY) || 1;
        const fillRatio = c.store.getUsedCapacity(RESOURCE_ENERGY) / capacity;
        if (fillRatio > 0.8) dynamicHaulerTarget += 2;
        else if (fillRatio > 0.4) dynamicHaulerTarget += 1;
      }
    }
    // 2. Storage link 积压信号（RCL5+ link 网络最后一公里）：link-system 将 source link
    //    能量瞬移到 storage link，需 hauler 排空到 storage；无 storage 时不存在 storage link。
    if (snapshot.storage) {
      const storageLink = snapshot.links.find(
        l => l.pos.getRangeTo(snapshot.storage!) <= 2,
      );
      if (storageLink) {
        // ②b 守卫：controller link 缺能时 storage link 被 distributor 用于灌升级链（非 source
        // 背压）且 withdrawStorageLink 挡住 hauler 不抽 — 满不代表需排空，不计入，避免过孵。
        const ctrl = snapshot.controller;
        const ctrlLink = ctrl
          ? snapshot.links.find(l => l.id !== storageLink.id && l.pos.getRangeTo(ctrl) <= 2)
          : undefined;
        const feedingController =
          ctrlLink !== undefined && ctrlLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
        if (!feedingController) {
          const linkCap = storageLink.store.getCapacity(RESOURCE_ENERGY) || 1;
          const linkFillRatio = storageLink.store.getUsedCapacity(RESOURCE_ENERGY) / linkCap;
          if (linkFillRatio > 0.8) dynamicHaulerTarget += 2;
          else if (linkFillRatio > 0.4) dynamicHaulerTarget += 1;
        }
      }
    }
    // 运力归一化：积压档（+1/+2）按基准运力（referenceCarryCapacity=6C）折算头数 —
    // 大 body 折减、小 body 扩编，头数 × 单体运力 ≈ 恒定总运力，消除「配额不随 body 变」
    // 的浪费（大 body 时代多孵的每一头都是纯闲置）。
    if (dynamicHaulerTarget > 0) {
      const haulerBody = estimatePlannedBody("hauler", energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl);
      const carryPerHauler = countBodyParts(haulerBody, "carry") * 50;
      dynamicHaulerTarget = Math.ceil(
        (dynamicHaulerTarget * CONFIG.economy.referenceCarryCapacity) / carryPerHauler,
      );
    }
    // 至少 minCount（保证基本物流不断），至多 maxCount。
    dynamicHaulerTarget = Math.min(haulerConfig.maxCount, Math.max(haulerConfig.minCount, dynamicHaulerTarget));

    // TD-015：economyPressure>0.6 时线性衰减（1.0 缩至 minCount），物流端平滑感知压力，
    // 而非 inCrisis 二值开关突砍。
    const haulerPressure = roomCtx.economyPressure;
    if (haulerPressure > 0.6) {
      dynamicHaulerTarget = Math.max(haulerConfig.minCount, Math.round(dynamicHaulerTarget * (1 - (haulerPressure - 0.6) / 0.4)));
    }
  }
  // 能量危机收缩（仅偿付危机适用）：缩到 minCount，只保留搬能量回 spawn 供孵化的最小力量，
  // 避免孵出无能量可搬的空闲头白耗能量。方案 C 例外：流动性危机（liquidityScore 主导、
  // 能量冻在 container）时 hauler 是解药，必须满量孵化搬空积压、打破「spawn 破产」死锁 —
  // 收缩会让死锁永久化（W37S58 根因之一）。
  const liquidityScore = roomCtx.liquidityScore ?? 0;
  const drainScore = roomCtx.drainScore ?? 0;
  const liquidityDriven = liquidityScore >= 40 && liquidityScore >= drainScore;
  haulerTarget = (inCrisis && !liquidityDriven)
    ? Math.min(dynamicHaulerTarget, haulerConfig.minCount)
    : dynamicHaulerTarget;
  // P2-2：tuning pending 期间收敛到合同目标（上调扩编/下调缩编），让 isContractMet 可满足；
  // 危机收缩优先级更高 — 危机时只留 minCount，合同延后到危机解除后验证。
  if (!(inCrisis && !liquidityDriven) && roomCtx.haulerPendingTarget !== undefined) {
    haulerTarget = roomCtx.haulerPendingTarget;
  }
  if (haulerTotal < haulerTarget && hasLogistics) {
    for (let i = haulerTotal; i < haulerTarget; i++) {
      const key = spawnKey("hauler", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("hauler", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
  }

  // P1：Distributor — 仅在有 storage 时创建（RCL4+）：storage→sink 分发
  // （spawn/extension/tower/lab）。与 hauler 职责分离：hauler 收集（源→storage）、
  // distributor 分发（storage→sink）；无 storage 时 hauler 直接 container→sink 直送。
  // 数量基于 fillTarget 需求量。
  const distConfig = getRoleBounds("distributor", home);
  const distTotal = (counts.distributor ?? 0) + pending.distributor;
  const hasStorage = snapshot.storage !== undefined;
  let distTarget = 0;
  if (hasStorage) {
    // fillTarget 数按单体运力折算头数：每 150 运力承接 1 个（6C=300 → 2 个/头、
    // 16C=800 → 5 个/头，大 body 自动减员）。D-3：编制信号与服务范围同口径 —
    // tier≥1（storage<full 50k）时 distributor 拒服 tower（水位节流），tower 就不得计入
    // 需求信号，否则「按含 tower 缺口扩编 → 扩出的编制不服务 tower」信号虚高一档、
    // 尖峰期多孵的每一头都是常驻浪费。
    const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    const servesTowerFully = storageEnergy >= CONFIG.economy.distributorTiers.full;
    const towerAmmoFloor = CONFIG.economy.distributorTiers.towerAmmoFloor;
    // SN-1 连带：非 full 档编制信号排除 controller container — 容量 2000 几乎恒有空位，
    // 计入会恒定抬高需求信号（cc 由既有编制顺路服务）。tower 与服务范围同口径：
    // full 档全量计入；战备线档（≥low）只计低于弹药地板的塔 — 信号瞬态，不常驻虚高。
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
    // 高耗远距 sink 排空反馈（镜像 hauler 积压反馈，方向相反）：fillCount 把 cc 当
    // 「1 个待填结构」，但 cc 是高抽取率 sink（upgrader 连续抽）且常远离 storage，
    // 缺的是并行运力而非「多算 1 个目标」（大 body 的 fillPerDistributor 会稀释）。
    // 无 controller link 时 cc 见底 = 供能不足 → 按 hauler 同款 +1/+2 档补头数；有 link
    // 由 link 供能不补。只在 storage ≥ sustained（养得起升级）时补，crisis/pressure 下方裁剪。
    if (
      snapshot.controllerContainer !== undefined &&
      snapshot.controller?.my === true &&
      storageEnergy >= CONFIG.economy.distributorTiers.sustained
    ) {
      // 判据用「link 在场且有能量」而非仅在场：link 网络未通（持续空）时 distributor
      // 必须接管 cc 供能，否则 upgrader 半饿（link 在场却没通）。
      const controllerLinkServing = snapshot.links.some(
        l => snapshot.controller != null &&
          l.pos.getRangeTo(snapshot.controller) <= 2 &&
          l.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      );
      if (!controllerLinkServing) {
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

    // 升编趋势确认：孵化瞬间抽干 spawn/extension 的 fillTargets 尖峰是日常工作信号
    // 而非缺员（在途编制一两趟即补满）。扩编（超现有编制且超 minCount 地板）须等需求
    // 持续 distributorScaleUpDelay tick 才放行；补 minCount 与缩编即时生效。
    // 不确认的后果：50 tick 尖峰换来活 1500 tick 的常驻编制（与 builderPressureState
    // 同为 Memory 短 key 迟滞先例）。P1-J：prev→next 显式传递，domain 不直读写 Memory。
    let nextDistScaleUpSince = roomCtx.prevHysteresis?.distScaleUpSince;
    if (distTarget > distTotal && distTarget > distConfig.minCount) {
      const since = nextDistScaleUpSince;
      if (since === undefined) {
        // 需求首现 — 记录起点，本轮压回地板（现有编制或 minCount 的较大者）。
        nextDistScaleUpSince = tick;
        distTarget = Math.min(distTarget, Math.max(distTotal, distConfig.minCount));
      } else if (tick - since < CONFIG.spawn.distributorScaleUpDelay) {
        // 确认窗口未满 — 继续压回地板。
        distTarget = Math.min(distTarget, Math.max(distTotal, distConfig.minCount));
      }
      // 窗口已满 → 需求真实持续，放行扩编（distTarget 保持折算值）。
    } else if (nextDistScaleUpSince !== undefined) {
      // 需求回落或编制已满足 — 尖峰未获确认，重置计时器。
      nextDistScaleUpSince = undefined;
    }
    // 缓存到外层 nextHysteresis（与 builder 状态合并）。
    nextHysteresis.distScaleUpSince = nextDistScaleUpSince;
  }
  if (distTotal < distTarget && hasStorage) {
    for (let i = distTotal; i < distTarget; i++) {
      const key = spawnKey("distributor", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("distributor", home, i, key, 1, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
  }

  // P2：Mineral Miner — RCL6+ 且 extractor 就位、mineral 未采空、有 terminal/storage 容纳
  // 时孵 1 个专职矿工（工业链第一环 extractor→container→hauler）。采空后不再孵
  // （minCount=0，存量老死不补，替换门禁 3 天然阻止）。R3a：normal 全量 / recovery 保底
  // （矿物收入不耗能量，是脱困路径）；bootstrap 不开（保命孵化优先）。
  const mineral = snapshot.minerals[0];
  if (
    (colonyState === "normal" || colonyState === "recovery") &&
    snapshot.rcl >= 6 &&
    snapshot.extractor !== undefined &&
    mineral !== undefined &&
    mineral.mineralAmount > 0 &&
    (snapshot.terminal !== undefined || hasStorage)
  ) {
    const minerConfig = getRoleBounds("mineralMiner", home);
    const minerTotal = (counts.mineralMiner ?? 0) + countPending(queue, "mineralMiner", home);
    for (let i = minerTotal; i < minerConfig.maxCount; i++) {
      const key = spawnKey("mineralMiner", home, i);
      if (!hasKey(queue, key)) {
        requests.push(createRequest("mineralMiner", home, i, key, 2, energyCapacity, roomCtx.energyAvailable, colonyState, snapshot.rcl, tick));
      }
    }
  }

  // P2：Upgrader — 仅 normal；有降级风险时 recovery/bootstrap 也允许（P1 优先级）。
  const hasDowngradeRisk = roomCtx.controllerDowngradeRisk;
  // RCL8 满级后升级零收益（progress=0）：无降级风险时停孵/停替换；
  // 存量由角色 gate 停烧（upgrader.ts）、老死不补。
  const rcl8NoUpgrade = snapshot.rcl >= 8 && !hasDowngradeRisk;
  const allowUpgrader = (colonyState === "normal" || hasDowngradeRisk) && !rcl8NoUpgrade;

  if (allowUpgrader && !frozenRoles.has("upgrader")) {
    const upgraderConfig = getRoleBounds("upgrader", home);
    const upgraderTotal = (counts.upgrader ?? 0) + pending.upgrader;

    // A2：升级功率由「storage 水位 + 大 body WORK 数」驱动，替代固定小 body 数量梯度 —
    // 盈余能量优先灌 controller（RCL 是复利）；15W 大 body 站桩 1 只即跑满 ≈15/tick，
    // creep 数更少、CPU 更省。
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

    // R6a：议程 rcl-push 时冲刺门槛放宽一档（sustained 水位即可冲刺、压力容忍至 0.4）—
    // 议程是帝国主动目标，允许比被动水位反应更进取；门禁仍由既有 pressure/水位逻辑兜底。
    const agendaPush = roomCtx.agendaInitiative === "rcl-push";
    const sprintStorageGate = agendaPush ? upgradeCfg.sustainedStorage : upgradeCfg.sprintStorage;
    const sprintPressureGate = agendaPush ? 0.4 : 0.3;

    let upgraderTarget: number;
    if (hasDowngradeRisk || crisisNeedsGuard) {
      // 保级紧急：拉满（自采也要保级）。
      upgraderTarget = upgraderConfig.maxCount;
    } else if (!stationUpgradeOnline) {
      // 无 controller container：多 upgrader 长途自采，通勤浪费抵消数量优势，保持 minCount。
      upgraderTarget = pressure <= 0.7 ? upgraderConfig.minCount : 0;
    } else if (hasStorage && storageEnergy >= sprintStorageGate && pressure <= sprintPressureGate) {
      // 冲刺：库存充足且经济健康，烧库存换 RCL 复利（2 个满 body 站桩）；
      // P0-1：storage 满仓时拉满 maxCount — 盈余必须被消化，否则在源头被浪费。
      upgraderTarget = storageNearFull
        ? upgraderConfig.maxCount
        : Math.min(upgraderConfig.maxCount, 2);
    } else if (hasStorage && storageEnergy >= upgradeCfg.sustainedStorage) {
      // 维持：1 个大 body 站桩 ≈ 15/tick，盈余全喂 controller。
      upgraderTarget = 1;
    } else if (!hasStorage) {
      // RCL1-3 早期猛冲（无 storage，能量不升级也是浪费）：pressure 0–0.3 满目标、
      // 0.3–0.7 线性缩到 minCount、0.7–1.0 缩到 0。
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

    // RCL8 官方限速：controller 每 tick 最多吃 15 能量升级 — 按 body WORK 数折算
    // creep 上限（15W → 1 个恰好顶满）。
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

  // P2：Builder — 独立于 upgrader 门禁：recovery 时是生存角色必须允许 spawn；bootstrap 不孵。
  // 动态数量：每活跃 site 配 1 个 builder，上限受经济承载力约束。
  // 道路维修需求信号：布局建成后 site 归零 → builder 消亡，但道路持续衰减且塔不修路
  // （只修 critical 与 wall/rampart）— 无此信号道路只能塌毁重建（重建耗能约 6 倍 +
  // 塌毁窗口物流减速）；待修道路达门槛时即使无 site 也维持 1 个 builder 巡修
  // （builder work 链自带 repairRoads，无需新增行为）。
  const roadsNeedingRepair = snapshot.roads.filter(
    r => r.hits < r.hitsMax * CONFIG.construction.roadRepairThreshold,
  ).length;
  const roadRepairDemand = roadsNeedingRepair >= CONFIG.construction.roadRepairBuilderFloor;
  // P1-1：纳入 buildQueue backlog（保守权重 0.5）— site 数受配额限制（默认 3）看不到
  // backlog，backlogWeighted 补盲；roomMem 由 construction-manager 每 tick 维护。
  const queuedBacklog = roomMem?.buildQueue
    ? roomMem.buildQueue.filter(t => t.state === "queued").length
    : 0;
  const backlogWeighted = Math.floor(queuedBacklog * 0.5);
  if (colonyState !== "bootstrap" && (snapshot.myConstructionSites.length > 0 || roadRepairDemand || backlogWeighted > 0) && !frozenRoles.has("builder")) {
    const builderConfig = getRoleBounds("builder", home);
    const builderTotal = (counts.builder ?? 0) + pending.builder;
    const economyCap = (counts.harvester ?? 0) + (counts.worker ?? 0) + 1;
    let dynamicBuilderTarget = Math.min(
      builderConfig.maxCount,
      economyCap,
      Math.max(
        builderConfig.minCount,
        snapshot.myConstructionSites.length,
        // backlog 按 0.5 权重折算编制，加速消化建造队列。
        backlogWeighted,
        // 纯维修需求保底 1 个 — minCount 可能为 0（成熟房 tuning 收缩后）。
        roadRepairDemand ? 1 : 0,
      ),
    );
    // B-5：编制感知取能供给（水位权限表）— site 数是需求信号，但编制不得超过供给可承载：
    // storage<low(2k) 时 builder 已被拒取能（只能 container/直采）→ 封顶 minCount
    // （多孵的每一头都在排队等能量）；<sustained(10k) 时 50/趟 涓流只养得起 1 个。
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
    // TD-016：economyPressure 迟滞带替代单阈值开关 — 进入收缩 >0.35、退出 <=0.25，
    // 带内保持状态，消除阈值附近的目标跳变振荡。P1-J：prev→next 显式传递，
    // domain 不直读写 Memory。
    const builderPressure = roomCtx.economyPressure;
    let state = roomCtx.prevHysteresis?.builderPressureState ?? 'full';
    if (state === 'full' && builderPressure > 0.35) {
      state = 'shrinking';
    } else if (state === 'shrinking' && builderPressure <= 0.25) {
      state = 'full';
    }
    nextHysteresis.builderPressureState = state;
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

  // 即将死亡 creep 的替换请求。四重门禁防数量激增：
  // 1. 角色存在性（worker 有 harvester 不替换、builder 无 site 不替换）
  // 2. maxCount 硬上限（living+pending 已达上限）3. 盈余检查（去掉将死者仍 ≥ minCount）
  // 4. 稳定 key（不含 sourceId，防 assignment 重分配致 key 漂移产生重复）。
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

    // P0-3：churn 熔断期间不替换 frozen 角色 — 替换会立即重建请求，与熔断「暂停该 role
    // 孵化」语义冲突；worker 不冻结（P0 生命线）。
    if (frozenRoles.has(role)) continue;

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

    // 门禁 3：盈余检查 — 去掉将死者后仍 ≥ minCount 说明有多余，不替换；只有将死者是维持
    // minCount 的必要成员时才提前替换（overlap 无缝衔接）。
    if (livingCount - 1 + pendingCount >= config.minCount) continue;

    // 门禁 4：稳定 key — 不含 sourceId，防止 assignment 重分配导致 key 漂移。
    const index = creep.spawnIndex ?? 0;
    const key = spawnKey(role, home, index);
    if (!hasKey(queue, key) && !requests.some(r => r.key === key)) {
      const priority = role === "harvester" || role === "worker" ? 1 : 2;
      // harvester 替补重选矿位：垂死者矿位视为已空出，按专职口径重挑 — 常态选回原矿位
      // （无缝接班语义不变）；历史错配（两只矿工挤同源）时替补自动纠偏到最空 source，
      // 不盲目继承垂死者矿位让错配永续。
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

  const result: DemandResult = { requests, nextHysteresis };
  if (haulerTarget !== undefined) result.haulerTarget = haulerTarget;
  return result;
}

function hasKey(queue: readonly SpawnRequest[], key: string): boolean {
  return queue.some(r => r.key === key);
}

/** 创建孵化请求（纯函数）；energyAvailable/tick 显式传入，不读 Game/Memory。 */
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
  // X-16：body 选择分层 — P0/crisis/recovery/bootstrap 按 energyAvailable 降级速出保命；
  // P1 harvester normal 用 energyCapacity 满配（2W=4/tick vs 1W=2/tick，多等 ~50 tick
  // 换 1500 tick 双倍产出，ROI 极高；trySpawn 对非 P0 会自动等能量，无需请求层降级）；
  // P2+ 满配。
  let body: BodyPartConstant[];
  // defender 始终降级：防御时间敏感 — 30 tick 后出场的满配不如现在出场的半配（塔补火力差）。
  const shouldDegrade =
    priority === 0 ||
    role === "defender" ||
    colonyState === "bootstrap" ||
    colonyState === "recovery";
  if (shouldDegrade) {
    const fullBody = selectBody(role, energyCapacity, { rcl });
    const requiredParts = ROLE_REQUIRED_PARTS[role];
    // 优雅降级：先出当前能量可负担的最大 body，宁可低效也要维持 colony 存活 —
    // 为等大 body 让 harvester 断档归零曾陷入「无 harvester→无收入→永远孵不起」死锁。
    // 能量连最低档都不够时（如 defender @130）带最低档排队等能量，不铸缺必需部件的废件。
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
    // 请求带 TTL：需求消失后的 stale 请求由 cleanQueue 清除；需求仍在时下一 tick 以同 key
    // 重建（hasKey 守卫解除）并按当时容量重选 body，避免入队后 body 长期冻结。
    // TTL(1000) > 饥饿降级窗口（见 CONFIG.spawn.requestTtl 注释），不干扰降级计时。
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  };
}
