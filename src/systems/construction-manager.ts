import { CONFIG } from "../config";
import type { Priority, System, TickContext, RoomSnapshot } from "../kernel/contracts";
import { globalCache } from "../kernel/global-cache";
import {
  syncTaskStates,
  cleanTasks,
  assessEmergencyRebuild,
  isEmergencyTask,
  isCriticalDevelopmentTask,
  hasCriticalStructureGap,
  evaluateDevelopmentGate,
  evaluateDevelopmentLane,
  type EmergencyRebuildStatus,
  type DevelopmentGateReason,
  type DevelopmentLaneReason,
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

      // 2. 清理完成 / 阻塞 / 超龄的任务（纯函数 — domain/construction/queue）。
      //    永久冲突（3 次 ERR_INVALID_TARGET）被清除的 key 记入 segment 黑名单，
      //    layout-planner 在冷却期内不会按同 key 重新入队。超龄 queued 任务
      //    （R2 队列治理）仅清除 + 计数观测，不进黑名单。
      const cleaned = cleanTasks(queue, ctx.tick, {
        maxQueuedAge: CONFIG.construction.maxQueuedTaskAge,
      });
      if (cleaned.blacklistedKeys.length > 0) {
        const segData = getRoomLayoutData(snapshot.roomName);
        segData.blocked ??= {};
        for (const key of cleaned.blacklistedKeys) {
          segData.blocked[key] = {
            code: 1, // ERR_INVALID_TARGET 类永久冲突
            retryAt: ctx.tick + CONFIG.construction.blockedRetryDelay,
          };
        }
        markLayoutDirty();
      }
      for (const _key of cleaned.staleKeys) {
        recordConstructionSkip(snapshot.roomName, "stale-evict", queue, snapshot);
      }

      // 3. 评估紧急重建状态。
      const emergency = assessEmergencyRebuild(snapshot);

      // 4. 开发门禁（结构化原因码 — R2 可观测性）。
      //    注意：normal 槽位永远按「发展规则」严格判定（emergencyAny=false）—
      //    emergency 豁免只属于 emergency 槽位。否则 emergency 长期激活的房
      //    （2 source 房 container 配额排队）会借豁免把普通任务也绕过能量地板。
      const strictGateInputs = {
        economyPressure: roomMem.economyPressure ?? 0,
        budgetTier: ctx.budget.tier,
        claimSecure: roomMem.claimSecure ?? false,
        threatCount: snapshot.threatCreeps.length,
        hasP0SpawnRequest: (roomMem.spawnQueue ?? []).some(r => r.priority === 0),
        energyAvailable: snapshot.energyAvailable,
        energyCapacityAvailable: snapshot.energyCapacityAvailable,
        globalSiteCount: ctx.globalSiteCount + getRemoteSiteTotal(),
        maxGlobalSites: CONFIG.construction.maxGlobalSites,
      };
      const normalGateReason = evaluateDevelopmentGate({
        ...strictGateInputs,
        emergencyAny: false,
      });
      // 5. site 创建 — emergency 与 normal 是两个独立槽位（蓝图 §3：每 tick
      //    各 1 个，先到先得），不是 if/else 互斥分支。
      //    R2 根因修复：旧结构 `if (emergency && canEmergency) else if (canNormal)`
      //    在 emergency 长期激活的房（如 2 source 房第二处 container 在 critical
      //    配额=1 下排队 → needsSourceContainerRebuild 恒真）永久饿死 normal 槽位
      //    — extension 永远建不出来，直到 RCL3 tower emergency 才自愈。
      // 5a. Emergency 槽位 — 仅紧急重建任务（事件式签发；普通任务禁止搭车
      //     绕过能量/门禁 — 搭车曾在能量危机时放行 extension site）。
      if (emergency.any && counters.canCreateEmergency) {
        if (tryCreateSite(queue, snapshot, emergency, snapshot.roomName, "emergency")) {
          counters.markEmergency();
        }
      }

      // 5b. Normal 槽位 — 严格发展门禁通过时全队列可竞争；被拒时走 R2 关键
      //     发展通道（extension / controller container）。
      if (counters.canCreateNormal) {
        if (normalGateReason === "ok") {
          if (tryCreateSite(queue, snapshot, emergency, snapshot.roomName)) {
            counters.markNormal();
          }
        } else {
          // R2 关键发展通道：严格门禁拒绝但生存前提齐备时，extension /
          // controller container 仍可创建 site（修复 RCL2 停摆闭环）。通道不绕过
          // 每房/全局配额与 Game API — tryCreateSite 内部照常执行；创建消耗
          // normal tick 槽位（每 tick 全局 1 个，即「每 tick 只允许有限数量」）。
          // 严格门禁原因本身也计数 — 门禁可观测性主通道。
          recordConstructionSkip(snapshot.roomName, normalGateReason, queue, snapshot);
          const laneReason = evaluateDevelopmentLane({
            rcl: snapshot.rcl,
            laneMaxRcl: CONFIG.construction.developmentLaneMaxRcl,
            budgetTier: ctx.budget.tier,
            threatCount: snapshot.threatCreeps.length,
            hasP0SpawnRequest: (roomMem.spawnQueue ?? []).some(r => r.priority === 0),
            // 生存级缺口 = spawn/tower/storage 缺失；source container 缺失是
            // 经济效率缺口（由 emergency 槽位并行处理），不冻结发展通道。
            survivalGapActive: emergency.spawn || emergency.tower || emergency.storage,
            energyAvailable: snapshot.energyAvailable,
            laneEnergyFloor: CONFIG.construction.developmentLaneEnergyFloor,
            globalSiteCount: ctx.globalSiteCount + getRemoteSiteTotal(),
            maxGlobalSites: CONFIG.construction.maxGlobalSites,
            readyLaneTaskCount: queue.filter(
              t => t.state === "queued" && Game.time >= t.retryAt &&
                isCriticalDevelopmentTask(t, snapshot),
            ).length,
          });
          if (laneReason === "ok") {
            // 创建失败的具体原因（配额/ERR_FULL/invalid-target）已由 tryCreateSite
            // 内部按原因计数 — 此处无需重复记录。
            if (tryCreateSite(queue, snapshot, emergency, snapshot.roomName, "lane")) {
              counters.markNormal();
            }
          } else {
            recordConstructionSkip(
              snapshot.roomName,
              `lane:${laneReason}` as ConstructionSkipReason,
              queue, snapshot,
            );
          }
        }
      }
      if (!counters.canCreateNormal && queue.some(t => t.state === "queued")) {
        // normal 槽位本 tick 被占用（多为远矿 site 先到先得）。
        recordConstructionSkip(snapshot.roomName, "tick-quota", queue, snapshot);
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
 * 逻辑已下沉到 domain 层纯函数 evaluateDevelopmentGate（R2 可观测性：
 * 每个拒绝都携带原因码）；本函数保留布尔签名供既有调用方与测试使用。
 *
 * 紧急重建（source container / tower / spawn / storage 缺失）豁免 economyPressure / budget /
 * P0 队列 / 能量门禁 / claim-secure 护栏，但不豁免威胁检测 — 敌人脚下不建工地。
 */
export function developmentGate(
  snapshot: RoomSnapshot,
  ctx: TickContext,
  emergency: EmergencyRebuildStatus,
): boolean {
  const roomMem = Memory.rooms[snapshot.roomName];
  return evaluateDevelopmentGate({
    emergencyAny: emergency.any,
    economyPressure: roomMem?.economyPressure ?? 0,
    budgetTier: ctx.budget.tier,
    claimSecure: roomMem?.claimSecure ?? false,
    threatCount: snapshot.threatCreeps.length,
    hasP0SpawnRequest: (roomMem?.spawnQueue ?? []).some(r => r.priority === 0),
    energyAvailable: snapshot.energyAvailable,
    energyCapacityAvailable: snapshot.energyCapacityAvailable,
    globalSiteCount: ctx.globalSiteCount + getRemoteSiteTotal(),
    maxGlobalSites: CONFIG.construction.maxGlobalSites,
  }) === "ok";
}

// ─── R2：skip reason 结构化观测 ─────────────────────────────

/**
 * construction-manager 跳过原因全集 — 开发门禁原因码 + site 创建阶段原因。
 * heap L1 计数（global reset 丢失可接受），每 CONFIG.construction.skipReportInterval
 * tick 输出一条结构化日志后清零（STATE_OWNERSHIP §3.10：观测计数不上 Memory）。
 */
export type ConstructionSkipReason =
  | Exclude<DevelopmentGateReason, "ok">
  | `lane:${DevelopmentLaneReason}`
  | `per-room-site-cap:${string}`
  | "tick-quota"
  | "stale-evict"
  | "no-eligible-task"
  | "invalid-target"
  | "rcl-not-enough"
  | "err-full"
  | "unknown-error";

/** 记录一次跳过（heap L1 计数 + 低频结构化日志，双路径共用）。 */
export function recordConstructionSkip(
  roomName: string,
  reason: ConstructionSkipReason,
  queue: readonly BuildTask[],
  snapshot: RoomSnapshot,
): void {
  const g = globalCache();
  const skips = (g.constructionSkips ??= { rooms: {}, total: 0 });
  const roomStats = (skips.rooms[roomName] ??= {});
  roomStats[reason] = (roomStats[reason] ?? 0) + 1;
  skips.total += 1;

  // 低频结构化输出：每 skipReportInterval tick 且窗口内有跳过时输出一次。
  const interval = CONFIG.construction.skipReportInterval;
  if (skips.lastReportTick === Game.time || Game.time % interval !== 0) return;
  skips.lastReportTick = Game.time;

  for (const [room, stats] of Object.entries(skips.rooms)) {
    const reasons = Object.entries(stats)
      .map(([r, n]) => `${r}=${n}`)
      .join(" ");
    if (!reasons) continue;
    const q = Memory.rooms[room]?.buildQueue ?? [];
    const queued = q.filter(t => t.state === "queued").length;
    const site = q.filter(t => t.state === "site").length;
    const blocked = q.filter(t => t.state === "blocked").length;
    console.log(
      `[construction-skip] t=${Game.time} room=${room} window=${interval}t ` +
      `${reasons} queue=${q.length}(q${queued}/s${site}/b${blocked}) sites=${snapshot.myConstructionSites.length}`,
    );
  }
  // 窗口清零（日志已承载窗口聚合值）。
  skips.rooms = {};
  skips.total = 0;
}

/** 运行时 min-cut 产生的历史硬墙任务必须被拒绝，防止不可逆围城继续扩大。 */
export function isRuntimeDefenseWallTask(task: BuildTask): boolean {
  return task.structureType === STRUCTURE_WALL && task.key.startsWith("defense.mincut.");
}

/** 尝试从队列创建一个建造 site。成功创建返回 true。
 *  roomName：跳过原因计数归属房间（R2 可观测性）。
 *  mode："emergency" — 仅紧急重建任务（emergency 槽位语义：事件式签发，
 *  禁止普通任务搭车绕过能量/门禁）；"lane" — 仅关键发展任务（R2 发展通道，
 *  已通过 evaluateDevelopmentLane 全部生存前提检查）；undefined — 全部队列。 */
export function tryCreateSite(
  queue: BuildTask[],
  snapshot: RoomSnapshot,
  emergency: EmergencyRebuildStatus,
  roomName?: string,
  mode?: "emergency" | "lane",
): boolean {
  // 按紧急重建 + 优先级排序：紧急任务排到最前，确保关键基建第一时间创建 site。
  const sorted = queue
    .filter(t => t.state === "queued" && Game.time >= t.retryAt)
    .filter(t => {
      if (mode === "emergency") return isEmergencyTask(t, snapshot, emergency);
      if (mode === "lane") {
        // R2 验收加固：lane 任务必须是当前 RCL 已解锁的结构（防 controller
        // 降级后残留的过期任务借通道提前签发——降级场景由 ERR_RCL_NOT_ENOUGH
        // 瞬态重试链路处理，不归 lane）。
        if (!isCriticalDevelopmentTask(t, snapshot)) return false;
        return (CONTROLLER_STRUCTURES[t.structureType]?.[snapshot.rcl] ?? 0) > 0;
      }
      return true;
    })
    .sort((a, b) => {
      const aEmergency = isEmergencyTask(a, snapshot, emergency);
      const bEmergency = isEmergencyTask(b, snapshot, emergency);
      if (aEmergency !== bEmergency) return aEmergency ? -1 : 1;
      return a.priority - b.priority;
    });

  if (sorted.length === 0 && roomName) {
    // 队列非空但全部处于 retryAt 冷却 — 静默空转的可观测出口。
    recordConstructionSkip(roomName, "no-eligible-task", queue, snapshot);
  }

  // 检查每房 site 限制。道路与 source container 单独计额，避免被 extension 永久挤占。
  const adjacentToSource = (x: number, y: number): boolean =>
    snapshot.sources.some(s => Math.abs(s.pos.x - x) <= 1 && Math.abs(s.pos.y - y) <= 1);
  const isSourceContainerSite = (s: ConstructionSite): boolean =>
    s.structureType === STRUCTURE_CONTAINER && adjacentToSource(s.pos.x, s.pos.y);

  const roadSites = snapshot.myConstructionSites.filter(
    s => s.structureType === STRUCTURE_ROAD,
  ).length;
  const sourceContainerSites = snapshot.myConstructionSites.filter(isSourceContainerSite).length;
  // wall/rampart 独立计额 — 防御规划器当前只签发 rampart；保留 wall 计额
  // 仅用于兼容既有世界中的人工/历史墙任务，不允许新 min-cut 增长硬墙。
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
    // 线上 min-cut 曾生成 constructed wall，可能永久封死未来蓝图位置。
    // 防线硬墙必须来自版本化蓝图/显式迁移，不能由运行时临时签发；旧队列任务
    // 在创建 site 前终止，避免部署修复后继续扩大不可逆损害。
    if (isRuntimeDefenseWallTask(task)) {
      task.state = "blocked";
      task.attempts = 3;
      continue;
    }
    const isCritical = task.structureType === STRUCTURE_TOWER || task.structureType === STRUCTURE_SPAWN;
    const isRoad = task.structureType === STRUCTURE_ROAD;
    const isStorage = task.structureType === STRUCTURE_STORAGE;
    const isWall = task.structureType === STRUCTURE_WALL;
    const isRampart = task.structureType === STRUCTURE_RAMPART;
    const isSourceContainer =
      task.structureType === STRUCTURE_CONTAINER && adjacentToSource(task.pos.x, task.pos.y);

    // 检查每房限制。
    let quotaBlocked = false;
    if (isCritical) {
      quotaBlocked = criticalSites >= CONFIG.construction.maxCriticalSitesPerRoom;
    } else if (isStorage) {
      quotaBlocked = storageSites >= 1;
    } else if (isRoad) {
      quotaBlocked = roadSites >= CONFIG.construction.maxRoadSitesPerRoom;
    } else if (isWall) {
      quotaBlocked = wallSites >= CONFIG.construction.maxWallSitesPerRoom;
    } else if (isRampart) {
      quotaBlocked = rampartSites >= CONFIG.construction.maxRampartSitesPerRoom;
    } else if (isSourceContainer) {
      quotaBlocked = sourceContainerSites >= CONFIG.construction.maxCriticalSitesPerRoom;
    } else {
      quotaBlocked = normalSites >= CONFIG.construction.maxNormalSitesPerRoom;
    }
    if (quotaBlocked) {
      if (roomName) {
        // R2 诊断：按「结构类型 × 拒绝原因」计数，定位哪类任务在持续吃配额拒绝。
        recordConstructionSkip(roomName, `per-room-site-cap:${task.structureType}`, queue, snapshot);
      }
      continue;
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
      if (roomName) recordConstructionSkip(roomName, "invalid-target", queue, snapshot);
      continue;
    }

    if (result === ERR_RCL_NOT_ENOUGH) {
      // 瞬态重试：仅覆盖 controller 降级后配额缩水、等待回升的场景。
      // 「类型已在别处建满配额」的幽灵任务不会走到这里 —
      // syncTaskStates 的类型饱和判定已在同步阶段将其转 done 清除。
      task.retryAt = Game.time + 50;
      if (roomName) recordConstructionSkip(roomName, "rcl-not-enough", queue, snapshot);
      continue;
    }

    if (result === ERR_FULL) {
      task.retryAt = Game.time + 10;
      if (roomName) recordConstructionSkip(roomName, "err-full", queue, snapshot);
      return false;
    }

    // 未知错误 — 指数退避。
    task.attempts++;
    task.retryAt = Game.time + Math.min(10 * Math.pow(2, task.attempts), 200);
    if (roomName) recordConstructionSkip(roomName, "unknown-error", queue, snapshot);
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
