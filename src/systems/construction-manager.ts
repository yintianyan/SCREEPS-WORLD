import { CONFIG } from "../config";
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
import {
  syncTaskStates,
  cleanTasks,
  assessEmergencyRebuild,
  isEmergencyTask,
  hasCriticalStructureGap,
  type EmergencyRebuildStatus,
} from "../domain/construction/queue";
import { getRoomLayoutData, markLayoutDirty } from "../kernel/segment-store";
import { getRemoteSiteTotal, getTickSiteCounters } from "./site-quota";
import {
  getDismantlePlans,
  clearDismantlePlan,
  isRoomInDefense,
  markLinkConstrained,
  clearDeadAssetLink,
  transitionDismantlePlan,
  DISMANTLE_VALIDATION_DELAY,
} from "./link-system";
import type { DismantlePlan } from "../kernel/global-cache";
import { globalCache } from "../kernel/global-cache";

/**
 * 建造管理器 — 自有房 site 创建的唯一模块（远机房由 remote-mining-manager 负责）。
 * 职责：同步 BuildTask 状态与实际建造 site（domain/construction/queue）；强制执行
 * 每房与全局 site 限制（含远矿 siteCount 账本）；应用开发门禁（恢复态或 P0/P1 缺口
 * 时不建造）；全局每 tick 最多 1 normal + 1 emergency site（与 remote-mining-manager
 * 共享计数器）。纯逻辑已提取到 domain/construction/queue.ts，本模块只处理 Game API 调用。
 * P2（发展性工作 — 不能与生存竞争）。
 */
export const constructionManagerSystem: System = {
  name: "construction-manager",
  priority: 2 as Priority,
  interval: 1,
  /**
   * P1-F：recoveryEligible 钩子 — buildQueue 有 P0 queued 关键基建时
   * 自报 true，让 kernel 将本系统提升为 P1 等效优先级通过 budget 拦截。
   *
   * 关键基建 = storage / tower / spawn（经济链路断裂三件套）。
   * 「P0 queued」表示 layout-planner 已为缺失结构推入任务但尚未创建 site，
   * 此时若 budget tier 拦截 construction-manager，关键基建永远建不成 → 死锁。
   */
  recoveryEligible: (): boolean => hasCriticalStructureGap(Memory.rooms),
  run(ctx: TickContext): void {
    // P0-A：tick 配额计数器提升到 globalCache，与 remote-mining-manager 共享。
    // normal 与 emergency 两个独立槽位（每 tick 各 1 个），先到先得。
    const counters = getTickSiteCounters();

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      const queue = roomMem.buildQueue ?? [];

      // 1. 同步任务状态与实际 site（纯函数 — domain/construction/queue）。
      syncTaskStates(queue, snapshot);

      // 2. 清理完成 / 阻塞的任务（纯函数 — domain/construction/queue）。
      //    永久冲突（3 次 ERR_INVALID_TARGET）被清除的 key 记入 segment 黑名单，
      //    layout-planner 在冷却期内不会按同 key 重新入队。
      const purgedKeys = cleanTasks(queue, ctx.tick);
      if (purgedKeys.length > 0) {
        const segData = getRoomLayoutData(snapshot.roomName);
        segData.blocked ??= {};
        for (const key of purgedKeys) {
          segData.blocked[key] = {
            code: 1, // ERR_INVALID_TARGET 类永久冲突
            retryAt: ctx.tick + CONFIG.construction.blockedRetryDelay,
          };
        }
        markLayoutDirty();
      }

      // 3. 评估紧急重建状态。
      const emergency = assessEmergencyRebuild(snapshot);

      // 4. 检查开发门禁。
      if (!developmentGate(snapshot, ctx, emergency)) continue;

      // 5. 尝试从队列创建一个 site。
      // 紧急重建独立计额 — 允许每 tick 创建 1 个紧急 + 1 个普通 site，
      // 避免普通建造任务挤占关键基建重建窗口。
      if (emergency.any && counters.canCreateEmergency) {
        const created = tryCreateSite(queue, snapshot, emergency);
        if (created) counters.markEmergency();
      } else if (counters.canCreateNormal) {
        const created = tryCreateSite(queue, snapshot, emergency);
        if (created) counters.markNormal();
      }

      roomMem.buildQueue = queue;

      // 6. P1-4 拆改执行：
      //    处理本房的活跃拆改计划 — 替代 link 建成后 destroy 死资产 link。
      //    战时暂停（colonyState=defense）保留计划待恢复。
      processDismantlePlans(snapshot, ctx.tick, queue);
    }

    // 7. 孤儿工地清扫（Phase 3，低频 catch-all）。收口所有孤儿来源：扩张超时/失守、
    //    远矿 abandoned、房间失守——它们各自路径都不清 Game 层 site，此处统一兜底。
    if (ctx.tick % CONFIG.construction.orphanSweepInterval === 0) {
      cleanOrphanConstructionSites();
    }
  },
};

/**
 * 计算「应保留我方工地」的房间集合：己方殖民地 ∪ 非 abandoned 远矿目标 ∪ 当前扩张目标。
 * 保守保留集——只有三者都不是的房间，其工地才判为孤儿。
 */
export function computeSiteKeepRooms(): Set<string> {
  const keep = new Set<string>();
  // 己方殖民地（拥有 controller）。
  for (const roomName in Game.rooms) {
    if (Game.rooms[roomName]?.controller?.my) keep.add(roomName);
  }
  // 各房的远矿目标（非 abandoned — 现役/暂停的远矿有合法 container/road 工地）。
  for (const roomName in Memory.rooms) {
    const ops = Memory.rooms[roomName]?.remoteOps;
    if (!ops) continue;
    for (const target in ops) {
      if (ops[target]?.state !== "abandoned") keep.add(target);
    }
  }
  // 当前扩张目标（claiming/pioneering 期间目标房工地合法）。
  const expTarget = Memory.kernel?.expansion?.target;
  if (expTarget) keep.add(expTarget);
  return keep;
}

/**
 * 移除位于「非保留集」房间的我方建造 site（孤儿工地）。
 * 用 Game.constructionSites（全局列出所有我方 site，无视野也可 remove），
 * 故能清理已失去视野的失守/废弃房间的残留工地（如 claim 失败后 controller 降级的房）。
 */
export function cleanOrphanConstructionSites(): void {
  const keep = computeSiteKeepRooms();
  for (const id in Game.constructionSites) {
    const site = Game.constructionSites[id];
    if (!site) continue;
    if (!keep.has(site.pos.roomName)) {
      site.remove();
    }
  }
}

/**
 * 开发门禁 — 创建任何新 site 前必须满足。
 * 返回 true 表示允许建造。
 *
 * 紧急重建（source container / tower / spawn / storage 缺失）豁免 economyPressure / budget /
 * P0 队列 / 能量门禁 / claim-secure 护栏，但不豁免威胁检测 — 敌人脚下不建工地。
 */
export function developmentGate(
  snapshot: RoomSnapshot,
  ctx: TickContext,
  emergency: EmergencyRebuildStatus,
): boolean {
  if (!emergency.any) {
    // 梯度门禁：economyPressure 替代二值 colonyState — 0.0–0.3 正常建造；
    // 0.3–0.8 线性提高能量阈值（基础 → 90% 容量）；> 0.8 完全阻塞非紧急建造。
    const pressure = Memory.rooms[snapshot.roomName]?.economyPressure ?? 0;
    if (pressure > 0.8) return false;
    if (ctx.budget.tier === "recovery" || ctx.budget.tier === "conserve") return false;

    // 脆弱新房护栏（claim-secure）：RCL<4 且 controller 临近降级时，集中能量保
    // controller —— 抑制一切非紧急 site 创建。紧急重建（spawn/tower/storage 缺失）
    // 走 emergency 路径豁免本门禁（上方 !emergency.any 包裹），确保关键基建仍可建。
    if (Memory.rooms[snapshot.roomName]?.claimSecure) return false;
  }

  // 有威胁 creep 时不建造（过境 scout 不影响建造）。
  // 紧急重建也不豁免此条 — 敌人脚下建工地 = 送钱。
  if (snapshot.threatCreeps.length > 0) return false;

  if (!emergency.any) {
    // 检查 P0 孵化队列缺口 — 仅 P0（紧急恢复 worker）阻塞建造。
    const roomMem = Memory.rooms[snapshot.roomName];
    if (roomMem?.spawnQueue) {
      const hasEmergencySpawn = roomMem.spawnQueue.some(r => r.priority === 0);
      if (hasEmergencySpawn) return false;
    }

    // 检查能量盈余 — 梯度阈值：pressure 0.0–0.3 基础阈值（容量 60%），
    // 0.3–0.8 线性提高到容量 90%。
    const pressure = Memory.rooms[snapshot.roomName]?.economyPressure ?? 0;
    const baseRatio = 0.6;
    const maxRatio = 0.9;
    const ratio = pressure <= 0.3
      ? baseRatio
      : baseRatio + ((pressure - 0.3) / 0.5) * (maxRatio - baseRatio);
    const buildThreshold = Math.min(
      Math.floor(snapshot.energyCapacityAvailable * ratio),
      CONFIG.economy.buildEnergySurplus + CONFIG.spawn.recoveryEnergyReserve,
    );
    if (snapshot.energyAvailable < buildThreshold) return false;
  }

  // 全局 site 上限 — 紧急重建豁免自设限额（仍受游戏硬上限约束）。
  // P0-A：总量 = 自有房 site（快照）+ 远矿 site（remoteOps.siteCount 账本），
  // 防远矿 site 静默顶满 maxGlobalSites 饿死自有房重建。
  if (!emergency.any && ctx.globalSiteCount + getRemoteSiteTotal() >= CONFIG.construction.maxGlobalSites) return false;

  return true;
}

/** 尝试从队列创建一个建造 site。成功创建返回 true。 */
function tryCreateSite(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
  emergency: EmergencyRebuildStatus,
): boolean {
  // 按紧急重建 + 优先级排序：紧急任务排到最前，确保关键基建第一时间创建 site。
  const sorted = queue
    .filter(t => t.state === "queued" && Game.time >= t.retryAt)
    .sort((a, b) => {
      const aEmergency = isEmergencyTask(a, snapshot, emergency);
      const bEmergency = isEmergencyTask(b, snapshot, emergency);
      if (aEmergency !== bEmergency) return aEmergency ? -1 : 1;
      return a.priority - b.priority;
    });

  // 检查每房 site 限制。道路与 source container 单独计额，避免被 extension 永久挤占。
  const adjacentToSource = (x: number, y: number): boolean =>
    snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
  const isSourceContainerSite = (s: ConstructionSite): boolean =>
    s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y);

  const roadSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_ROAD,
  ).length;
  const sourceContainerSites = snapshot.myConstructionSites.filter(isSourceContainerSite).length;
  // wall/rampart 独立计额 — min-cut v3 割集顶点改用 wall（阻挡通行），
  // 核心覆盖 + 有结构位置的割集用 rampart。若归入 normalSites（上限 3），
  // 防御建筑会被 extension 永久挤占，防御线建不起来。
  const wallSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_WALL,
  ).length;
  const rampartSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_RAMPART,
  ).length;
  const normalSites = snapshot.myConstructionSites.filter(
    s =>
      s.structureType !== STRUCTURE_SPAWN &&
      s.structureType !== STRUCTURE_TOWER &&
      s.structureType !== STRUCTURE_ROAD &&
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART &&
      !isSourceContainerSite(s),
  ).length;
  const criticalSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_TOWER || s.structureType === STRUCTURE_SPAWN,
  ).length;
  // storage 独立计额 — 不与 extension 竞争 normal 名额，也不与 tower/spawn 竞争 critical 名额。
  // storage 是单例结构（每房最多 1 个），独立计数避免被 3 个 extension site 永久挤占。
  const storageSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_STORAGE,
  ).length;

  for (const task of sorted) {
    const isCritical = task.structureType === STRUCTURE_TOWER || task.structureType === STRUCTURE_SPAWN;
    const isRoad = task.structureType === STRUCTURE_ROAD;
    const isStorage = task.structureType === STRUCTURE_STORAGE;
    const isWall = task.structureType === STRUCTURE_WALL;
    const isRampart = task.structureType === STRUCTURE_RAMPART;
    const isSourceContainer =
      task.structureType === STRUCTURE_CONTAINER && adjacentToSource(task.pos.x, task.pos.y);

    // 检查每房限制。
    if (isCritical) {
      if (criticalSites >= CONFIG.construction.maxCriticalSitesPerRoom) continue;
    } else if (isStorage) {
      if (storageSites >= 1) continue;
    } else if (isRoad) {
      if (roadSites >= CONFIG.construction.maxRoadSitesPerRoom) continue;
    } else if (isWall) {
      if (wallSites >= CONFIG.construction.maxWallSitesPerRoom) continue;
    } else if (isRampart) {
      if (rampartSites >= CONFIG.construction.maxRampartSitesPerRoom) continue;
    } else if (isSourceContainer) {
      if (sourceContainerSites >= CONFIG.construction.maxCriticalSitesPerRoom) continue;
    } else {
      if (normalSites >= CONFIG.construction.maxNormalSitesPerRoom) continue;
    }

    // 尝试创建 site。
    const room = Game.rooms[task.pos.roomName];
    if (!room) continue;

    const result = room.createConstructionSite(task.pos.x, task.pos.y, task.structureType);

    if (result === OK) {
      task.state = "site";
      task.attempts = 0;
      return true;
    }

    if (result === ERR_INVALID_TARGET) {
      task.state = "blocked";
      task.attempts++;
      task.retryAt = Game.time + 100;
      continue;
    }

    if (result === ERR_RCL_NOT_ENOUGH) {
      // 瞬态重试：仅覆盖 controller 降级后配额缩水、等待回升的场景。
      // 「类型已在别处建满配额」的幽灵任务不会走到这里 —
      // syncTaskStates 的类型饱和判定已在同步阶段将其转 done 清除。
      task.retryAt = Game.time + 50;
      continue;
    }

    if (result === ERR_FULL) {
      task.retryAt = Game.time + 10;
      return false;
    }

    // 未知错误 — 指数退避。
    task.attempts++;
    task.retryAt = Game.time + Math.min(10 * Math.pow(2, task.attempts), 200);
  }

  return false;
}

// ─── P1-4 拆改执行 ───

/**
 * 处理本房的活跃拆改计划。
 *
 * 状态机（每 tick 推进）：
 *   waiting    → 检查替代任务 state：done → 转 validating；ttl 到期 → abort
 *   validating → 检查替代 link energy：>0 → success（destroy 旧 link）；
 *                超时（DISMANTLE_VALIDATION_DELAY）且 energy=0 → fallback
 *
 * 战时降级：colonyState === "defense" 时跳过处理（保留计划，不 destroy）。
 * 替代任务被清理（cleanTasks）：abort（保留旧 link，避免空窗）。
 *
 * @param snapshot  本房快照
 * @param tick      当前 tick
 * @param queue     本房 buildQueue（查找替代任务状态）
 */
function processDismantlePlans(
  snapshot: RoomSnapshot,
  tick: number,
  queue: readonly BuildTask[],
): void {
  const plans = getDismantlePlans();
  if (plans.size === 0) return;

  // 战时暂停：defense 状态下不处理拆改（保留计划待恢复 peace）。
  if (isRoomInDefense(snapshot.roomName)) return;

  for (const [deadLinkId, plan] of plans) {
    if (plan.roomName !== snapshot.roomName) continue;
    processSinglePlan(plan, deadLinkId, tick, queue, snapshot);
  }
}

/**
 * 处理单个拆改计划的状态转移（纯逻辑 + Game API 调用）。
 *
 * 终态处理（区分两类 abort 防止 churn）：
 *   success            → deadLink.destroy() + clearDismantlePlan + clearDeadAssetLink
 *   abort(ttl 到期)    → markLinkConstrained + clearDismantlePlan + clearDeadAssetLink
 *                        几何受限 — 替代任务长期未建成视为放不下，与 fallback 同策略。
 *                        若不标记，DISMANTLE_COOLDOWN(1000) < DISMANTLE_TTL(1500) 会导致
 *                        cooldown 过期后 layout-planner 为同一死资产创建新拆改计划，无限 churn。
 *   abort(任务/link 消失) → clearDismantlePlan（保留旧 link — 外部清理，给重试机会）
 *   fallback(验证超时) → markLinkConstrained + clearDismantlePlan + clearDeadAssetLink
 */
function processSinglePlan(
  plan: DismantlePlan,
  deadLinkId: string,
  tick: number,
  queue: readonly BuildTask[],
  snapshot: RoomSnapshot,
): void {
  // ttl 到期 → 几何受限（替代任务长期未建成视为放不下）。
  // 必须 markLinkConstrained + clearDeadAssetLink，否则 cooldown 过期后无限 churn。
  if (tick >= plan.expiresAt) {
    markLinkConstrained(plan.roomName, tick);
    clearDismantlePlan(deadLinkId);
    clearDeadAssetLink(deadLinkId);
    console.log(
      `[dismantle] abort+constrained: ttl expired for link ${deadLinkId} in ${plan.roomName}, ` +
      `marking linkConstrained to prevent churn`,
    );
    return;
  }

  if (plan.state === "waiting") {
    // 查找替代任务在 buildQueue 中的状态。
    const replacementTask = queue.find(t => t.key === plan.replacementKey);
    if (!replacementTask) {
      // 替代任务被清理（cleanTasks purge 或 blocked）→ abort。
      clearDismantlePlan(deadLinkId);
      console.log(`[dismantle] abort: replacement task ${plan.replacementKey} not found for ${deadLinkId}`);
      return;
    }
    if (replacementTask.state === "done") {
      // 替代 link 已建成 → 转 validating，开始等待灌能验证。
      // 注意：此时不 destroy 旧 link，先验证新 link 被灌能（energy > 0）再拆旧，
      // 避免新 link 也是死资产时「拆了旧的、新的也不工作」空窗。
      // 使用 transitionDismantlePlan 纯函数转移状态，写回 Map 保持单一状态机来源（DRY）。
      const updated = transitionDismantlePlan(plan, tick);
      globalCache().dismantlePlans?.set(deadLinkId, updated);
      console.log(`[dismantle] validating: replacement built for ${deadLinkId}, waiting for energy`);
    }
    return;
  }

  if (plan.state === "validating") {
    // 查找替代 link 结构（按位置匹配）。
    const replacementLink = snapshot.links.find(
      l => l.pos.x === plan.replacementPos.x && l.pos.y === plan.replacementPos.y,
    );
    if (!replacementLink) {
      // 替代 link 消失（被毁？）→ abort，保留旧 link。
      clearDismantlePlan(deadLinkId);
      console.log(`[dismantle] abort: replacement link disappeared for ${deadLinkId}`);
      return;
    }
    const replacementEnergy = replacementLink.store.getUsedCapacity(RESOURCE_ENERGY);
    if (replacementEnergy > 0) {
      // 验证成功：替代 link 被灌能 → destroy 旧 link + 清理。
      const deadLink = Game.getObjectById(deadLinkId as Id<StructureLink>);
      if (deadLink) {
        const result = deadLink.destroy();
        if (result === OK) {
          clearDismantlePlan(deadLinkId);
          clearDeadAssetLink(deadLinkId);
          console.log(`[dismantle] success: destroyed dead link ${deadLinkId}, replacement energized`);
        }
      } else {
        // 旧 link 已不存在（可能被手动拆除）→ 清理计划。
        clearDismantlePlan(deadLinkId);
        clearDeadAssetLink(deadLinkId);
      }
      return;
    }
    // 替代 link 未灌能 → 检查验证超时。
    const validatingSince = plan.validatingSince ?? tick;
    if (tick - validatingSince >= DISMANTLE_VALIDATION_DELAY) {
      // 验证超时：替代位置也是死资产 → fallback（标记 linkConstrained，避免重复空转）。
      markLinkConstrained(plan.roomName, tick);
      clearDismantlePlan(deadLinkId);
      clearDeadAssetLink(deadLinkId);
      console.log(
        `[dismantle] fallback: replacement link not energized after ${DISMANTLE_VALIDATION_DELAY}t, ` +
        `marking ${plan.roomName} linkConstrained`,
      );
    }
  }
}
