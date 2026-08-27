/**
 * 建造队列域模块 — BuildTask 状态同步与清理的纯函数。从 construction-manager
 * （系统层，负责 Game API）提取，使队列管理逻辑可独立测试；本模块只操作
 * BuildTask[] 数据结构 + RoomSnapshot 只读数据。
 */

import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";

/** 建造任务状态同步所需的已建结构摘要。 */
interface StructurePosRef {
  readonly pos: { readonly x: number; readonly y: number };
  readonly structureType: string;
}

/**
 * 同步 BuildTask 状态与房间内实际建造 site 和已建结构：queued + site 存在 → site；
 * queued + 结构已建成 → done；site + site 消失 → done（已建成）或 queued（被毁）。
 * 纯函数 — 不访问 Game/Memory，所有数据由参数传入。
 */
export function syncTaskStates(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
): void {
  // 位置 → site 映射，用于 queued→site 转换。
  // 注意：同一位置只可能有一个 site，但不同结构类型的任务可能指向同一位置，
  // 匹配时额外检查 structureType，防止误匹配。
  const sites = new Map<string, ConstructionSite>();
  for (const site of snapshot.myConstructionSites) {
    sites.set(`${site.pos.x},${site.pos.y}`, site);
  }

  // 预构建已建成结构的「位置:类型」集合，避免 lookForAt 调用。
  // 两个要点（幽灵任务循环的根因修复）：
  //   1. 必须含 rampart/wall/road/lab 等全部可入队类型 — 缺谁，谁的任务
  //      建成后就永远无法转 done，而是 site 消失 → 回退 queued → 重复建
  //      site 失败 → blocked → purge → 规划器再生成，无限 churn。
  //   2. key 必须带结构类型 — rampart 与建筑共格（core rampart 覆盖正是
  //      这么设计的），pos→单类型映射会让两者互相覆盖、判定失真。
  const builtPositions = new Set<string>();
  const builtStructures: StructurePosRef[] = [
    ...snapshot.spawns,
    ...snapshot.extensions,
    ...snapshot.towers,
    ...snapshot.containers,
    ...snapshot.links,
    ...snapshot.ramparts,
    ...snapshot.walls,
    ...snapshot.roads,
    ...snapshot.labs,
  ];
  if (snapshot.storage) {
    builtStructures.push(snapshot.storage);
  }
  if (snapshot.terminal) {
    builtStructures.push(snapshot.terminal);
  }
  if (snapshot.extractor) {
    builtStructures.push(snapshot.extractor);
  }
  if (snapshot.factory) {
    builtStructures.push(snapshot.factory);
  }
  if (snapshot.observer) {
    builtStructures.push(snapshot.observer);
  }
  if (snapshot.powerSpawn) {
    builtStructures.push(snapshot.powerSpawn);
  }
  if (snapshot.nuker) {
    builtStructures.push(snapshot.nuker);
  }
  for (const s of builtStructures) {
    builtPositions.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);
  }

  // 类型饱和判定 — 幽灵任务的唯一出口。
  // 布局代际漂移的遗留任务坐标为空、同类结构已在其他坐标建满当前 RCL 配额：
  // 逐格判定永远不会转 done，createConstructionSite 只会返回 ERR_RCL_NOT_ENOUGH
  // （瞬态重试语义，不 blocked 不进黑名单）→ 任务永久 queued 空转。
  // 危害三重：承诺计数虚高压制真实补建、RCL 升级瞬间在过时坐标真的建出结构、
  // Memory 常驻泄漏。饱和的类型直接转 done 清除 — RCL 提升产生真实缺口时，
  // 规划器按当前布局重新生成任务，队列不需要囤积过时坐标。
  // 结构被毁则计数下降、判定自动解除，不影响紧急重建路径。
  const builtCountByType = new Map<string, number>();
  for (const s of builtStructures) {
    builtCountByType.set(s.structureType, (builtCountByType.get(s.structureType) ?? 0) + 1);
  }
  const typeSaturated = (type: string): boolean => {
    const max = CONTROLLER_STRUCTURES[type as BuildableStructureConstant]?.[snapshot.rcl];
    if (max === undefined) return false;
    return (builtCountByType.get(type) ?? 0) >= max;
  };

  for (const task of queue) {
    const key = `${task.pos.x},${task.pos.y}`;
    const builtKey = `${key}:${task.structureType}`;
    if (task.state === "queued") {
      // 检查该位置是否存在**匹配结构类型**的 site。
      // 位置匹配必须检查类型：storage 的 site 若被误匹配给同位置的 extension
      // 任务，extension 永远不会变成 site 也不会被创建。
      const site = sites.get(key);
      if (site && site.structureType === task.structureType) {
        task.state = "site";
      } else if (builtPositions.has(builtKey)) {
        // 该位置已建成目标结构 — 避免 layout planner 反复重添已完成任务。
        task.state = "done";
      } else if (typeSaturated(task.structureType)) {
        // 同类结构已在其他坐标建满配额 — 本任务是漂移遗留的幽灵，转 done 清除。
        task.state = "done";
      }
    } else if (task.state === "site") {
      // 检查 site 是否消失（完成或被毁）或类型不匹配。
      const site = sites.get(key);
      if (!site || site.structureType !== task.structureType) {
        // 从快照结构数据检查是否已建成，避免 lookForAt。
        task.state = builtPositions.has(builtKey) ? "done" : "queued";
      }
    }
  }
}

/**
 * 移除已完成任务和过期阻塞任务：done → 删除；blocked + attempts>=3 → 删除
 * （永久冲突，防内存泄漏）；blocked + retryAt 过期 → 转回 queued（保留 attempts）。
 * R2 队列治理新增：queued 任务超龄（tick - queuedAt > maxQueuedAge）且非关键
 * （priority > 0）→ 清除（staleKeys 返回，仅计数观测，不进黑名单 — 超龄≠永久无效，
 * 规划器下周期可重新入队获得新 queuedAt）。
 * 返回被删除的永久冲突任务 key 列表（黑名单语义不变）+ 超龄清除 key 列表（观测语义）。
 */
export interface CleanTasksResult {
  /** 永久冲突任务 key（调用方应记入 segment 黑名单）。 */
  blacklistedKeys: string[];
  /** 超龄 queued 任务 key（仅观测，不进黑名单）。 */
  staleKeys: string[];
}

export function cleanTasks(
  queue: BuildTask[],
  tick: number,
  opts?: { maxQueuedAge?: number },
): CleanTasksResult {
  const blacklistedKeys: string[] = [];
  const staleKeys: string[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const task = queue[i];
    if (!task) continue;
    if (task.state === "done") {
      queue.splice(i, 1);
      continue;
    }
    if (task.state === "blocked") {
      // 超过 3 次重试的永久冲突任务直接删除，避免内存泄漏。
      if (task.attempts >= 3) {
        blacklistedKeys.push(task.key);
        queue.splice(i, 1);
        continue;
      }
      if (tick > task.retryAt) {
        task.state = "queued";
        // 注意：不重置 attempts，保留失败历史以达上限后删除。
      }
      continue;
    }
    // R2 队列治理：queued 任务超龄清除。priority 0（生存关键：spawn 重建等）
    // 永不清除 — 等待再久也必须建成。blocked 任务走上方专属链路，不在此列。
    if (
      task.state === "queued" &&
      opts?.maxQueuedAge !== undefined &&
      task.priority > 0 &&
      tick - (task.queuedAt ?? tick) > opts.maxQueuedAge
    ) {
      staleKeys.push(task.key);
      queue.splice(i, 1);
    }
  }
  return { blacklistedKeys, staleKeys };
}

/**
 * 检查是否有 source 缺少 container（且无在建 site）— 需紧急重建。
 * 缺失时 harvester 只能长途送能到 spawn，经济瘫痪；必须允许低能量/恢复状态下
 * 重建，否则陷入「能量低→不建造→无法重建→能量更低」死锁。
 */
export function needsSourceContainerRebuild(
  snapshot: RoomSnapshot,
): boolean {
  const adjacentContainer = (x: number, y: number): boolean =>
    snapshot.containers.some(c => Math.abs(c.pos.x - x) <= 1 && Math.abs(c.pos.y - y) <= 1);
  const adjacentContainerSite = (x: number, y: number): boolean =>
    snapshot.constructionSites.some(
      s => s.structureType === STRUCTURE_CONTAINER && Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1,
    );
  return snapshot.sources.some(
    s => !adjacentContainer(s.pos.x, s.pos.y) && !adjacentContainerSite(s.pos.x, s.pos.y),
  );
}

/**
 * 紧急重建状态 — 检测关键基建缺失：sourceContainer（harvester 无法就地存能）、
 * tower（RCL3+ 无塔 = 无防御纵深）、spawn（无法孵化）、storage（RCL4+ 无中央
 * 能量源）。紧急状态触发（construction-manager / layout-planner 消费）：
 * developmentGate 豁免 economyPressure/budget/能量门禁、shouldPlan 立即触发
 * （不等 50 tick 周期）、tryCreateSite 排序加权排到队首。
 */
export interface EmergencyRebuildStatus {
  /** Source container 缺失 — harvester 无法就地存能。 */
  readonly sourceContainer: boolean;
  /** Tower 缺失（RCL3+ 已解锁但无塔）— 防御真空。 */
  readonly tower: boolean;
  /** Spawn 缺失 — 无法孵化，人口只减不增。 */
  readonly spawn: boolean;
  /** Storage 缺失（RCL4+ 已解锁但无 storage）— 经济中枢断裂。 */
  readonly storage: boolean;

  readonly any: boolean;
}

/**
 * 评估房间的紧急重建需求。注意：spawn 缺失在初始 bootstrap 时也是 true —
 * 调用方应结合 layout.anchor 是否已设置区分「从未建造」与「被毁重建」；
 * construction-manager 的 developmentGate 不做此区分 — 缺 spawn 时无论初始
 * 还是重建都必须豁免门禁尽快恢复。
 */
export function assessEmergencyRebuild(
  snapshot: RoomSnapshot,
): EmergencyRebuildStatus {
  const sourceContainer = needsSourceContainerRebuild(snapshot);
  // RCL3 才解锁 tower；RCL < 3 时无塔是正常的，不算紧急。
  const tower = snapshot.rcl >= 3 && snapshot.towers.length === 0;
  // spawn 缺失 = 无法孵化，最严重的紧急状态。
  const spawn = snapshot.spawns.length === 0;
  // RCL4 才解锁 storage；RCL < 4 时无 storage 是正常的，不算紧急。
  // storage 被毁 = hauler 无处倒能 + builder/upgrader 无中央能量源 → 经济死循环。
  const storage = snapshot.rcl >= 4 && snapshot.storage === undefined;
  return {
    sourceContainer,
    tower,
    spawn,
    storage,
    any: sourceContainer || tower || spawn || storage,
  };
}

/**
 * 判断 BuildTask 是否属紧急重建任务 — 用于 tryCreateSite 排序加权，
 * 确保关键基建被毁后第一时间创建 site。
 */
export function isEmergencyTask(
  task: BuildTask,
  snapshot: RoomSnapshot,
  emergency: EmergencyRebuildStatus,
): boolean {
  if (emergency.tower && task.structureType === STRUCTURE_TOWER) return true;
  if (emergency.spawn && task.structureType === STRUCTURE_SPAWN) return true;
  if (emergency.storage && task.structureType === STRUCTURE_STORAGE) return true;
  if (emergency.sourceContainer && task.structureType === STRUCTURE_CONTAINER) {
    // 仅 source 旁的 container 才算紧急 — controller container 不在此列。
    return snapshot.sources.some(
      s => Math.abs(s.pos.x - task.pos.x) <= 1 && Math.abs(s.pos.y - task.pos.y) <= 1,
    );
  }
  return false;
}

/**
 * 检测是否有房间的 buildQueue 存在 P0 queued 的关键基建任务（storage/tower/spawn）
 * — 这类结构缺失时经济链路断裂，必须让 construction-manager 在任何 budget tier
 * 下都能运行（以 P1 等效优先级）。P1-F：从 kernel.ts 搬来，作为 recoveryEligible
 * 钩子实现 — kernel 只读钩子不识系统名（docs/architecture/KERNEL_ARCHITECTURE.md）。
 */
export function hasCriticalStructureGap(
  rooms: Record<string, { buildQueue?: Array<{ priority: number; state: string; structureType: string }> } | undefined>,
): boolean {
  return Object.values(rooms).some(
    r => r?.buildQueue?.some(
      t => t.priority === 0 && t.state === "queued" &&
        (t.structureType === STRUCTURE_STORAGE ||
          t.structureType === STRUCTURE_TOWER ||
          t.structureType === STRUCTURE_SPAWN),
    ),
  );
}

// ─── R2：developmentGate 结构化原因码（可观测性契约）──────────

/**
 * developmentGate 判定结果原因码。"ok" 表示允许建造；其余值即被跳过的具体原因。
 * 语义与 systems/construction-manager.developmentGate 的既有门禁链完全一致：
 *   1. 非紧急路径依次检查 pressure → cpu-tier → claim-secure；
 *   2. 威胁检查双路径生效（敌人脚下不建工地）；
 *   3. 非紧急路径继续检查 p0-spawn → energy-floor → global-site-cap。
 */
export type DevelopmentGateReason =
  | "ok"
  | "pressure"
  | "cpu-tier"
  | "claim-secure"
  | "threat"
  | "p0-spawn"
  | "energy-floor"
  | "global-site-cap";

/** evaluateDevelopmentGate 的全部输入（纯函数 — 禁止 Game/Memory 访问）。 */
export interface DevelopmentGateInputs {
  /** 紧急重建判定（assessEmergencyRebuild().any）。 */
  emergencyAny: boolean;
  /** 房间经济压力 0..1（RoomMemory.economyPressure）。 */
  economyPressure: number;
  /** 内核看门狗档位（ctx.budget.tier）。 */
  budgetTier: string;
  /** claim-secure 护栏标记（RoomMemory.claimSecure）。 */
  claimSecure: boolean;
  /** 威胁 creep 数（snapshot.threatCreeps.length）。 */
  threatCount: number;
  /** 孵化队列是否有 P0 请求（RoomMemory.spawnQueue）。 */
  hasP0SpawnRequest: boolean;
  /** 房间可用能量（snapshot.energyAvailable）。 */
  energyAvailable: number;
  /** 房间能量容量（snapshot.energyCapacityAvailable）。 */
  energyCapacityAvailable: number;
  /** 全局 site 占用 = 自有房 site + 远矿 site 账本。 */
  globalSiteCount: number;
  /** 全局 site 上限（CONFIG.construction.maxGlobalSites）。 */
  maxGlobalSites: number;
}

/**
 * developmentGate 的纯函数版本 — 按既有门禁链输出具体原因码。
 * 门禁顺序与阈值必须与历史行为逐条一致（本函数是唯一逻辑源，
 * systems 层 developmentGate 只是薄壳委托）。
 */
export function evaluateDevelopmentGate(
  inputs: DevelopmentGateInputs,
): DevelopmentGateReason {
  if (!inputs.emergencyAny) {
    // 梯度门禁：pressure > 0.8 完全阻塞非紧急建造。
    if (inputs.economyPressure > 0.8) return "pressure";
    if (inputs.budgetTier === "recovery" || inputs.budgetTier === "conserve") return "cpu-tier";
    if (inputs.claimSecure) return "claim-secure";
  }

  // 威胁检查双路径生效 — 紧急重建也不豁免（敌人脚下建工地 = 送钱）。
  if (inputs.threatCount > 0) return "threat";

  if (!inputs.emergencyAny) {
    if (inputs.hasP0SpawnRequest) return "p0-spawn";

    // 能量盈余梯度阈值：pressure 0.0–0.3 基础阈值（容量 60%），
    // 0.3–0.8 线性提高到容量 90%。
    const baseRatio = 0.6;
    const maxRatio = 0.9;
    const ratio = inputs.economyPressure <= 0.3
      ? baseRatio
      : baseRatio + ((inputs.economyPressure - 0.3) / 0.5) * (maxRatio - baseRatio);
    const buildThreshold = Math.min(
      Math.floor(inputs.energyCapacityAvailable * ratio),
      CONFIG.economy.buildEnergySurplus + CONFIG.spawn.recoveryEnergyReserve,
    );
    if (inputs.energyAvailable < buildThreshold) return "energy-floor";

    if (inputs.globalSiteCount >= inputs.maxGlobalSites) return "global-site-cap";
  }

  return "ok";
}

// ─── R2：关键发展建设通道（RCL2-3 development lane）──────────

/** 关键发展结构判定 — extension 与 controller 邻接 container（不含 source 邻接，
 * 后者归 emergency 车道）。extension 是 RCL2 唯一提升孵化容量的结构，是早期
 * 发展闭环的核心；controller container 让 upgrader 0 通勤站桩（RCL2 即解锁）。
 * 纯函数。 */
export function isCriticalDevelopmentTask(
  task: BuildTask,
  snapshot: RoomSnapshot,
): boolean {
  if (task.structureType === STRUCTURE_EXTENSION) return true;
  if (task.structureType === STRUCTURE_CONTAINER) {
    const adjacentToSource = snapshot.sources.some(
      s => Math.abs(s.pos.x - task.pos.x) <= 1 && Math.abs(s.pos.y - task.pos.y) <= 1,
    );
    if (adjacentToSource) return false;
    if (
      snapshot.controller &&
      Math.abs(snapshot.controller.pos.x - task.pos.x) <= 1 &&
      Math.abs(snapshot.controller.pos.y - task.pos.y) <= 1
    ) {
      return true;
    }
  }
  return false;
}

/** evaluateDevelopmentLane 判定结果原因码。"ok" = 允许走通道创建 site。 */
export type DevelopmentLaneReason =
  | "ok"
  | "rcl-window"
  | "recovery-tier"
  | "threat"
  | "p0-spawn"
  | "survival-gap"
  | "energy-floor"
  | "global-site-cap"
  | "no-lane-task";

/** evaluateDevelopmentLane 的全部输入（纯函数 — 禁止 Game/Memory 访问）。 */
export interface DevelopmentLaneInputs {
  /** 房间 RCL。 */
  rcl: number;
  /** 通道适用 RCL 上界（CONFIG.construction.developmentLaneMaxRcl）。 */
  laneMaxRcl: number;
  /** 内核看门狗档位（ctx.budget.tier）。 */
  budgetTier: string;
  /** 威胁 creep 数。 */
  threatCount: number;
  /** 孵化队列是否有 P0 请求。 */
  hasP0SpawnRequest: boolean;
  /** 生存级紧急缺口激活（spawn/tower/storage 缺失 — spawn 由 assessEmergencyRebuild
   *  的 spawn/tower/storage 字段 OR 而来）。source container 缺失是经济效率缺口
   *  而非生存缺口，不计入 — 它由 emergency 槽位并行处理，不应冻结发展通道
   *  （2 source 房第二处 container 在 critical 配额=1 下排队会使该状态长期存在）。 */
  survivalGapActive: boolean;
  /** 房间可用能量。 */
  energyAvailable: number;
  /** 通道能量地板（CONFIG.construction.developmentLaneEnergyFloor，绝对值）。 */
  laneEnergyFloor: number;
  /** 全局 site 占用（自有 + 远矿账本）。 */
  globalSiteCount: number;
  /** 全局 site 上限。 */
  maxGlobalSites: number;
  /** 队列中「可立即创建」的关键发展任务数（queued 且过 retryAt）。 */
  readyLaneTaskCount: number;
}

/**
 * RCL2 关键发展建设通道判定 — 修复「extension 作为普通背景 P2 被门禁永久阻塞」
 * 的 RCL2 停摆闭环（Phase R2 根因）。
 *
 * 通道语义：当 developmentGate 因 claimSecure / pressure / conserve 等门禁拒绝时，
 * 若房间满足全部生存前提（无敌人、无 P0 孵化缺口、无紧急重建缺口）且能量不低于
 * 绝对地板，则允许为 extension / controller container 创建 site。通道不绕过：
 * Game API、每房 site 配额、全局 site 上限、位置校验、construction-manager 唯一
 * 写者约束；创建仍消耗 normal tick 槽位（每 tick 全局 1 个 = 「每 tick 有限数量」）。
 * recovery 档由内核 maxPriority=1 拦截本系统（P2），此处显式拒绝保持语义一致。
 */
export function evaluateDevelopmentLane(
  inputs: DevelopmentLaneInputs,
): DevelopmentLaneReason {
  if (inputs.rcl < 2 || inputs.rcl > inputs.laneMaxRcl) return "rcl-window";
  if (inputs.budgetTier === "recovery") return "recovery-tier";
  if (inputs.threatCount > 0) return "threat";
  if (inputs.hasP0SpawnRequest) return "p0-spawn";
  if (inputs.survivalGapActive) return "survival-gap";
  if (inputs.energyAvailable < inputs.laneEnergyFloor) return "energy-floor";
  if (inputs.globalSiteCount >= inputs.maxGlobalSites) return "global-site-cap";
  if (inputs.readyLaneTaskCount === 0) return "no-lane-task";
  return "ok";
}
