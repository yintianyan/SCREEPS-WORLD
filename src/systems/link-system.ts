import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import type { LinkInfo, LinkRole } from "../domain/economy/links";
import { planLinkTransfers, classifyLinkRole, computeControllerLinkTarget } from "../domain/economy/links";
import { linkHasOutlet } from "../domain/economy/link-outlet";
import { globalCache } from "../kernel/global-cache";
import { CONFIG } from "../config";

/** re-export（纯函数已下沉 domain/economy/links，保持 link-system 导入面兼容）。 */
export { computeControllerLinkTarget } from "../domain/economy/links";

/**
 * 死资产判定阈值：source link 持续满足三重校验的 tick 数。
 *
 * 500t 足以过滤瞬态（hauler 短暂离岗、link 刚建成未灌能），且不超过
 * 拆改冷却（1000t）— 死资产检测到拆改启动应在同一周期内闭环。
 */
export const DEAD_ASSET_THRESHOLD = 500;

/**
 * Link 能量传输系统 — P1 系统，管理 link 间瞬时能量传输 + 死资产检测。
 *
 * 职责：
 *   - 将房间内 link 按位置分类（source / controller / storage / hub）
 *   - 调用 planLinkTransfers 计算传输计划
 *   - 执行 link.transferEnergy() 完成能量瞬移
 *   - 检测死资产 source link（三重校验 + 500t 持续），暴露给布局规划触发拆改
 *
 * link 链路是 RCL5+ 的核心物流：source link ← harvester 存能 →
 * controller link → upgrader 取能，全程 0 通勤替代 hauler 往返。
 * storage link 作为溢出回收和 controller 补给的枢纽。
 *
 * 优先级：P1 — link 传输极廉价（每房每 tick O(links) 查找 + 少量 API 调用），
 * 且直接关系升级吞吐，在能量链中优先级仅次于孵化。
 */
export const linkSystem: System = {
  name: "link-system",
  priority: 1 as Priority,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      if (snapshot.links.length === 0) continue;
      runRoomLinks(snapshot, ctx.tick);
    }
  },
};

/**
 * 执行单房 link 传输：分类 → 死资产检测 → 规划 → 执行。
 *
 * 死资产检测（2026-08-02）：
 *   三重校验（role=source + energy=0 + !linkHasOutlet）持续 500t → 死资产。
 *   死资产 link 的 id 暴露给 layout-planner 触发拆改规划（P1-4 通道）。
 */
function runRoomLinks(snapshot: RoomSnapshot, tick: number): void {
  const links = snapshot.links;
  const linkMap = new Map<string, StructureLink>();
  for (const l of links) linkMap.set(l.id, l);

  const infos: LinkInfo[] = links.map(l => ({
    id: l.id,
    energy: l.store.getUsedCapacity(RESOURCE_ENERGY),
    energyCapacity: l.store.getCapacity(RESOURCE_ENERGY),
    cooldown: l.cooldown,
    role: classifyLink(l, snapshot),
  }));

  // 死资产检测：每 tick 更新 deadAssetSince 计时器。
  updateDeadAssetTracking(infos, tick);

  // 需求驱动的 controller 目标水位（RCL8 停供 / 保级 / RCL<8 分级）。
  const controllerInfo = infos.find(i => i.role === "controller");
  const controllerTargetEnergy = controllerInfo
    ? computeControllerLinkTarget(
        snapshot.rcl,
        snapshot.controller,
        snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
        controllerInfo.energyCapacity,
      )
    : undefined;
  const transfers = planLinkTransfers(infos, {
    minTransfer: CONFIG.economy.link.minTransfer,
    controllerTargetEnergy,
  });
  for (const t of transfers) {
    const from = linkMap.get(t.fromId);
    const to = linkMap.get(t.toId);
    if (!from || !to) continue;
    from.transferEnergy(to, t.amount);
  }
}

/**
 * 计算新的死资产计时器状态（纯函数，便于单测三重校验逻辑）。
 *
 * 三重校验通过（source + energy=0 + 无 outlet）→ 记录首次 tick（沿用 prevSince 已有值）；
 * 任一校验失败 → 从结果中删除（瞬态恢复）。
 * 已消失的 link（不在 infos 中但仍在 prevSince 中）→ 从结果中删除。
 *
 * @param infos      本 tick 所有 link 的信息
 * @param tick       当前 tick
 * @param prevSince  上一 tick 的计时器状态（linkId → 首次检测 tick）
 * @returns 新的计时器状态
 */
export function computeDeadAssetSince(
  infos: readonly LinkInfo[],
  tick: number,
  prevSince: ReadonlyMap<string, number>,
): Map<string, number> {
  const next = new Map<string, number>();
  const currentIds = new Set<string>();
  for (const info of infos) {
    currentIds.add(info.id);
    const otherLinks = infos.filter(i => i.id !== info.id);
    const isDead =
      info.role === "source" &&
      info.energy === 0 &&
      !linkHasOutlet(info.role, otherLinks);
    if (isDead) {
      // 沿用已有计时器（首次记录 tick），否则记录当前 tick。
      next.set(info.id, prevSince.get(info.id) ?? tick);
    }
  }
  return next;
}

/**
 * 更新死资产计时器（每 tick 调用，写入 globalCache）。
 *
 * 持续 DEAD_ASSET_THRESHOLD(500) tick → 留在 Map 中，由 getDeadAssetLinks 暴露。
 * 注意：link 消失（被 destroy）后，其 id 不在 infos 中 → computeDeadAssetSince
 * 自动从结果中剔除。layout-planner 消费后应调用 clearDeadAssetLink 清除。
 */
function updateDeadAssetTracking(infos: readonly LinkInfo[], tick: number): void {
  const cache = globalCache();
  if (cache.deadAssetSince === undefined) cache.deadAssetSince = new Map();
  cache.deadAssetSince = computeDeadAssetSince(infos, tick, cache.deadAssetSince);
}

/**
 * 获取当前判定为死资产的 source link id 列表（持续 ≥ DEAD_ASSET_THRESHOLD tick）。
 *
 * layout-planner 消费：deadAssets 非空时触发规划（尝试拆改/补位）。
 * 消费后调用 clearDeadAssetLink(id) 清除，避免重复触发。
 *
 * @param tick 当前 tick（用于判定持续时长）
 * @returns 死资产 link id 列表（可能为空）
 */
export function getDeadAssetLinks(tick: number): readonly string[] {
  const cache = globalCache();
  const deadAssetSince = cache.deadAssetSince;
  if (deadAssetSince === undefined || deadAssetSince.size === 0) return [];
  const result: string[] = [];
  for (const [id, sinceTick] of deadAssetSince) {
    if (tick - sinceTick >= DEAD_ASSET_THRESHOLD) result.push(id);
  }
  return result;
}

/**
 * 清除指定 link 的死资产计时器（拆改启动或死资产消除后调用）。
 * 避免同一死资产 link 重复触发规划。
 */
export function clearDeadAssetLink(linkId: string): void {
  globalCache().deadAssetSince?.delete(linkId);
}

/**
 * link 几何受限重试间隔：标记后 1000t 内跳过 link 任务创建，避免空转。
 *
 * 1000t 足以覆盖拆改周期（500t 检测 + 1000t 拆改冷却），且与 GAP_RETRY_INTERVAL
 * 同量级。过期后自动重试（RCL 升级或拆改完成可能解锁几何约束）。
 */
export const LINK_CONSTRAINED_RETRY_INTERVAL = 1000;

/**
 * 检查房间是否处于 link 几何受限状态（controller + storage link 都放不下）。
 *
 * layout-planner 消费：标记期内跳过 link 任务创建，避免每周期重复尝试空转。
 * 标记自动过期（LINK_CONSTRAINED_RETRY_INTERVAL），过期后重新评估。
 */
export function isLinkConstrained(roomName: string, tick: number): boolean {
  const cache = globalCache();
  const since = cache.linkConstrained?.get(roomName);
  if (since === undefined) return false;
  return tick - since < LINK_CONSTRAINED_RETRY_INTERVAL;
}

/**
 * 标记房间 link 几何受限（controller + storage link 都几何放不下时调用）。
 */
export function markLinkConstrained(roomName: string, tick: number): void {
  const cache = globalCache();
  if (cache.linkConstrained === undefined) cache.linkConstrained = new Map();
  cache.linkConstrained.set(roomName, tick);
}

/**
 * 清除房间的 link 几何受限标记（RCL 升级或拆改完成后调用）。
 */
export function clearLinkConstrained(roomName: string): void {
  globalCache().linkConstrained?.delete(roomName);
}

// ─── P1-4 受限拆改通道 ───

/**
 * 拆改冷却：每房每 1000t 最多启动 1 个拆改计划。
 *
 * 1000t 足以覆盖单次拆改周期（500t 检测 + 替代建造 + 500t 验证），
 * 且与 LINK_CONSTRAINED_RETRY_INTERVAL 同量级。冷却避免受限地形频繁拆改空转。
 */
export const DISMANTLE_COOLDOWN = 1000;

/**
 * 拆改计划 ttl：1500t 未完成则 abort。
 *
 * 500t（死资产检测窗口）+ 1000t（拆改执行窗口，含替代建造 + 验证）。
 * 超时表示替代 link 迟迟未建或验证未通过，放弃拆改保留旧 link。
 */
export const DISMANTLE_TTL = 1500;

/**
 * 替代 link 灌能验证窗口：替代 link 建成后等待 500t 确认 harvester 灌能。
 *
 * 500t 与死资产检测阈值（DEAD_ASSET_THRESHOLD）对齐 — 足以过滤瞬态
 *（hauler 短暂离岗、link 刚建成未灌能），且不超过 ttl 的验证预算。
 */
export const DISMANTLE_VALIDATION_DELAY = 500;

/**
 * 检查房间是否处于拆改冷却期（1000t 内已启动过拆改）。
 *
 * layout-planner 消费：冷却期内不再为该房的新死资产创建拆改计划。
 */
export function isDismantleOnCooldown(roomName: string, tick: number): boolean {
  const cache = globalCache();
  const lastTick = cache.lastDismantleTick?.get(roomName);
  if (lastTick === undefined) return false;
  return tick - lastTick < DISMANTLE_COOLDOWN;
}

/**
 * 记录房间拆改启动 tick（用于冷却账本）。
 *
 * layout-planner 创建拆改计划时调用。
 */
export function recordDismantleStart(roomName: string, tick: number): void {
  const cache = globalCache();
  if (cache.lastDismantleTick === undefined) cache.lastDismantleTick = new Map();
  cache.lastDismantleTick.set(roomName, tick);
}

/**
 * 获取所有活跃的拆改计划（construction-manager 每 tick 消费）。
 */
export function getDismantlePlans(): ReadonlyMap<string, import("../kernel/global-cache").DismantlePlan> {
  return globalCache().dismantlePlans ?? new Map();
}

/**
 * 创建并登记拆改计划（layout-planner 消费）。
 *
 * 同时记录冷却 tick，确保冷却与计划创建原子化（避免冷却已记但计划未存的半成品状态）。
 */
export function createDismantlePlan(
  deadLinkId: string,
  roomName: string,
  replacementKey: string,
  replacementPos: { x: number; y: number },
  tick: number,
): void {
  const cache = globalCache();
  if (cache.dismantlePlans === undefined) cache.dismantlePlans = new Map();
  cache.dismantlePlans.set(deadLinkId, {
    deadLinkId,
    roomName,
    replacementKey,
    replacementPos,
    startedAt: tick,
    expiresAt: tick + DISMANTLE_TTL,
    state: "waiting",
  });
  recordDismantleStart(roomName, tick);
  incrementDismantleCount(roomName);
}

/**
 * 递增 per-room 拆改累计计数（globalCache.dismantleCount）。
 *
 * layout-metrics 的「拆改失效告警」消费此计数：dismantleCount 增长但
 * deadAssetRate 不降 → 拆改机制失效。heap 存储 — global reset 丢失可接受
 * （与 dismantlePlans 同策略），重开后从 0 重新计数。
 */
export function incrementDismantleCount(roomName: string): void {
  const cache = globalCache();
  if (cache.dismantleCount === undefined) cache.dismantleCount = new Map();
  cache.dismantleCount.set(roomName, (cache.dismantleCount.get(roomName) ?? 0) + 1);
}

/**
 * 清除指定拆改计划（终态：success / aborted / fallback）。
 */
export function clearDismantlePlan(deadLinkId: string): void {
  globalCache().dismantlePlans?.delete(deadLinkId);
}

/**
 * 更新拆改计划状态（construction-manager 每 tick 调用）。
 *
 * 纯函数版本便于单测状态机转移逻辑，实际 cache 写入由调用方负责。
 */
export function transitionDismantlePlan(
  plan: import("../kernel/global-cache").DismantlePlan,
  tick: number,
): import("../kernel/global-cache").DismantlePlan {
  if (plan.state === "waiting") {
    return { ...plan, state: "validating", validatingSince: tick };
  }
  return plan;
}

/**
 * 判定房间是否处于战时状态（colonyState === "defense"）。
 *
 * layout-planner + construction-manager 消费：战时暂停拆改（不新建计划、不 destroy 旧 link），
 * 保留现有计划待恢复 peace 后继续。
 */
export function isRoomInDefense(roomName: string): boolean {
  return Memory.rooms[roomName]?.colonyState === "defense";
}

/**
 * 根据可与 source/controller/storage 的距离分类（委托纯函数 classifyLinkRole）。
 *
 * 采用「最近锚获胜」而非旧的「source 固定最高优先级」：后者会把紧邻 controller/storage、
 * 却恰好落在某 source range≤2 内的 link 误判为 source（优先级劫持），令 controller/storage
 * link 从传输拓扑消失。分类逻辑与 harvester 灌能识别（harvest.ts sourceAdjacentLink）
 * 共用同一 classifyLinkRole，消除口径漂移致的「死 link」。详见 domain/economy/links.ts。
 */
function classifyLink(link: StructureLink, snapshot: RoomSnapshot): LinkRole {
  return classifyLinkRole(
    link.pos,
    snapshot.sources.map(s => s.pos),
    snapshot.controller?.pos,
    snapshot.storage?.pos,
    CONFIG.economy.link.anchorRange,
  );
}
