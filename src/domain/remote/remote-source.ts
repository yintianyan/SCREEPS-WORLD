/**
 * Remote Source Model — A4.0 Phase 3：远矿资源实体抽象。
 *
 * 合同锚点：A4.0 Architecture Audit §18.3（Remote Source 是评估层，不是执行层）。
 * 记忆约束 [[memory:17875714213295541337]]：Remote Source Model 应该产出 SupplyNode
 * 注入网络，而不是自己造一套调拨逻辑。
 *
 * 设计意图：
 *   Remote Source 是将远矿产出**注入 Empire Resource Network** 的适配器。
 *
 *   它不替代 remote-mining-manager 的执行链（spawn/haul/reserve 不变），
 *   只做三件事：
 *   1. 抽象远矿资源实体（sourceId/roomName/capacity/distance/risk/expectedYield/status）
 *   2. 为 remote-value.ts 提供评估输入（净价值 = 产出 - 运输 - 风险 - 基建）
 *   3. 为 remote-opportunity.ts 提供候选实体（Opportunity 排序的输入）
 *
 *   产出侧（未来 Phase 4）：Remote Source → SupplyNode 注入网络
 *
 * 纯函数律（DEP_GRAPH §3-5，SYSTEM_BOUNDARIES §2.3-3）：
 *   - 不引用 Game / Memory / RawMemory（lint 红线）
 *   - 全部输入由参数注入
 *   - 不写任何状态——只读计算
 */

import type { ResourceType } from "../operation/agenda-item";

// ─── Remote Source 状态 ──────────────────────────────────

/**
 * Remote Source Status — 远矿资源实体生命周期五态。
 *
 * 状态流转：
 *   AVAILABLE → ASSIGNED → DEGRADED → BLOCKED → INACTIVE
 *                    ↺           ↺
 *
 * - AVAILABLE: 可用——未分配给任何孵化房，可被 Opportunity 评估
 * - ASSIGNED: 已分配——已有 remote-mining-manager 运营此 source
 * - DEGRADED: 降级——产出低于预期（威胁/InvaderCore 压制/采集不足）
 * - BLOCKED: 阻塞——不可运营（敌方占领/封路/novice 区域）
 * - INACTIVE: 非活跃——被主动放弃或永久不可用
 */
export type RemoteSourceStatus =
  | "available"
  | "assigned"
  | "degraded"
  | "blocked"
  | "inactive";

/**
 * 所有 Remote Source 状态值。
 */
export const REMOTE_SOURCE_STATUSES: readonly RemoteSourceStatus[] = [
  "available",
  "assigned",
  "degraded",
  "blocked",
  "inactive",
] as const;

/**
 * 判定 Remote Source 是否可评估（可作为 Opportunity 候选）。
 * 纯函数。
 */
export function isEvaluatable(status: RemoteSourceStatus): boolean {
  return status === "available" || status === "degraded";
}

/**
 * 判定 Remote Source 是否活跃运营中。
 * 纯函数。
 */
export function isOperational(status: RemoteSourceStatus): boolean {
  return status === "assigned" || status === "degraded";
}

/**
 * 判定 Remote Source 是否终态（不可恢复）。
 * 纯函数。
 */
export function isRemoteSourceTerminal(status: RemoteSourceStatus): boolean {
  return status === "inactive";
}

// ─── Remote Source 模型 ──────────────────────────────────

/**
 * Remote Source — 远矿资源实体抽象。
 *
 * 从 RoomIntel + remoteOps 数据派生，不直接访问 Game/Memory。
 * 是 remote-value.ts 和 remote-opportunity.ts 的核心输入。
 *
 * 字段设计原则：
 * - 只存评估所需数据（不存运行时状态——那是 remote-mining-manager 的事）
 * - ID 幂等：sourceId = "remote:${homeRoom}:${targetRoom}"
 * - 可序列化为瘦快照（未来存 Memory）
 */
export interface RemoteSource {
  /** 幂等键："remote:${homeRoom}:${targetRoom}"。 */
  id: string;
  /** 孵化房（sponsor / 运营方）。 */
  homeRoom: string;
  /** 远矿目标房名。 */
  targetRoom: string;
  /** 资源类型（当前 energy，未来可扩展矿物）。 */
  resource: ResourceType;

  // ── 产能参数 ──
  /** source 数量（通常 1 或 2）。 */
  sourceCount: number;
  /**
   * 预期产出速率（能量/tick）。
   * reserved = 10/source/tick，unreserved = 5/source/tick。
   */
  expectedYield: number;
  /** 是否已预定（影响产出和成本）。 */
  reserved: boolean;

  // ── 距离与运输 ──
  /** PathFinder 实测通勤成本（plain=1, swamp=5）。 */
  pathCost: number;
  /** 线性距离（Game.map.getRoomLinearDistance）。 */
  linearDistance: number;
  /** 是否有路（影响运输效率）。 */
  hasRoad: boolean;

  // ── 风险 ──
  /** 风险等级（0=安全..3=高危）。 */
  riskLevel: number;
  /** 最近威胁 tick（undefined = 无已知威胁）。 */
  lastHostileAt: number | undefined;
  /** 是否被 InvaderCore 压制。 */
  hasInvaderCore: boolean;

  // ── 生命周期 ──
  /** 当前状态。 */
  status: RemoteSourceStatus;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近更新 tick。 */
  updatedAt: number;

  /** 人类可读的来源说明。 */
  origin: string;
}

// ─── Remote Source 创建 ──────────────────────────────────

/**
 * Remote Source 创建输入。
 */
export interface RemoteSourceInput {
  homeRoom: string;
  targetRoom: string;
  sourceCount: number;
  /** PathFinder 实测通勤成本。 */
  pathCost: number;
  /** 线性距离。 */
  linearDistance: number;
  /** 是否已预定。 */
  reserved: boolean;
  /** 是否有路。 */
  hasRoad: boolean;
  /** 风险等级（0..3）。 */
  riskLevel: number;
  /** 最近威胁 tick。 */
  lastHostileAt: number | undefined;
  /** 是否被 InvaderCore 压制。 */
  hasInvaderCore: boolean;
  /** 当前状态。 */
  status: RemoteSourceStatus;
  /** 当前 tick。 */
  tick: number;
  /** 来源说明。 */
  origin?: string;
}

/**
 * 计算预期产出速率。
 * reserved = 10 e/tick per source, unreserved = 5 e/tick per source.
 * 纯函数。
 */
export function computeExpectedYield(sourceCount: number, reserved: boolean): number {
  const perSource = reserved ? 10 : 5;
  return sourceCount * perSource;
}

/**
 * 生成 Remote Source 幂等键。
 * 纯函数。
 */
export function makeRemoteSourceId(homeRoom: string, targetRoom: string): string {
  return `remote:${homeRoom}:${targetRoom}`;
}

/**
 * 创建 Remote Source。
 *
 * 从显式参数构建——不访问 Game/Memory。
 * 调用方（系统侧薄壳）负责从 RoomIntel + remoteOps 采集数据。
 *
 * 纯函数。
 */
export function createRemoteSource(input: RemoteSourceInput): RemoteSource {
  const expectedYield = computeExpectedYield(input.sourceCount, input.reserved);
  return {
    id: makeRemoteSourceId(input.homeRoom, input.targetRoom),
    homeRoom: input.homeRoom,
    targetRoom: input.targetRoom,
    resource: "energy",
    sourceCount: input.sourceCount,
    expectedYield,
    reserved: input.reserved,
    pathCost: input.pathCost,
    linearDistance: input.linearDistance,
    hasRoad: input.hasRoad,
    riskLevel: input.riskLevel,
    lastHostileAt: input.lastHostileAt,
    hasInvaderCore: input.hasInvaderCore,
    status: input.status,
    createdAt: input.tick,
    updatedAt: input.tick,
    origin: input.origin ?? "intel-derived",
  };
}

// ─── 从 RoomIntel 派生 ───────────────────────────────────

/**
 * RoomIntel 的最小子集（避免直接依赖 intel.ts 以保持模块独立性）。
 * 调用方负责提供这些字段。
 */
export interface IntelForRemoteSource {
  sources?: number;
  pathCost?: number;
  reservedBy?: string;
  owner?: string;
  status: string;
  kind: string;
  lastSeen: number;
}

/**
 * 从 RoomIntel 派生 Remote Source。
 *
 * 这是系统侧薄壳调用的核心函数——
 * 将 intel.ts 的 RoomIntel 转换为 Remote Source Model。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param homeRoom 孵化房
 * @param targetRoom 目标房
 * @param intel 目标房情报
 * @param linearDistance 线性距离
 * @param riskLevel 风险等级（0..3）
 * @param lastHostileAt 最近威胁 tick
 * @param hasInvaderCore 是否被 InvaderCore 压制
 * @param hasRoad 是否有路
 * @param tick 当前 tick
 * @param status 初始状态
 */
export function deriveRemoteSource(
  homeRoom: string,
  targetRoom: string,
  intel: IntelForRemoteSource,
  linearDistance: number,
  riskLevel: number,
  lastHostileAt: number | undefined,
  hasInvaderCore: boolean,
  hasRoad: boolean,
  tick: number,
  status: RemoteSourceStatus = "available",
): RemoteSource | undefined {
  // 硬否决：非 normal 房 / 非正常状态 / 有主 → 不创建
  if (intel.kind !== "normal") return undefined;
  if (intel.status !== "normal") return undefined;
  if (intel.owner) return undefined;

  const sourceCount = intel.sources ?? 1;
  const pathCost = intel.pathCost ?? linearDistance * 70;
  const reserved = intel.reservedBy === undefined || intel.reservedBy === "Invader"
    ? false  // 无预定或 Invader 预定 → 视为未预定（Invader 预定时无法 reserve）
    : true;  // 己方预定 → reserved=true

  // 如果有 InvaderCore 且状态未指定，默认为 blocked
  const effectiveStatus = hasInvaderCore && status === "available" ? "blocked" : status;

  return createRemoteSource({
    homeRoom,
    targetRoom,
    sourceCount,
    pathCost,
    linearDistance,
    reserved,
    hasRoad,
    riskLevel,
    lastHostileAt,
    hasInvaderCore,
    status: effectiveStatus,
    tick,
    origin: "intel-derived",
  });
}

// ─── 状态更新 ────────────────────────────────────────────

/**
 * 更新 Remote Source 状态。
 * 纯函数 — 返回新对象。
 */
export function updateRemoteSourceStatus(
  source: RemoteSource,
  newStatus: RemoteSourceStatus,
  tick: number,
): RemoteSource {
  return { ...source, status: newStatus, updatedAt: tick };
}

/**
 * 更新 Remote Source 的风险信息。
 * 纯函数 — 返回新对象。
 */
export function updateRemoteSourceRisk(
  source: RemoteSource,
  riskLevel: number,
  lastHostileAt: number | undefined,
  hasInvaderCore: boolean,
  tick: number,
): RemoteSource {
  return {
    ...source,
    riskLevel,
    lastHostileAt,
    hasInvaderCore,
    updatedAt: tick,
  };
}

// ─── 查询 ────────────────────────────────────────────────

/**
 * 按 homeRoom 过滤 Remote Sources。
 * 纯函数。
 */
export function getSourcesByHome(
  sources: readonly RemoteSource[],
  homeRoom: string,
): RemoteSource[] {
  return sources.filter(s => s.homeRoom === homeRoom);
}

/**
 * 过滤出可评估的 Remote Sources（AVAILABLE 或 DEGRADED）。
 * 纯函数。
 */
export function filterEvaluatable(
  sources: readonly RemoteSource[],
): RemoteSource[] {
  return sources.filter(s => isEvaluatable(s.status));
}

/**
 * 过滤出活跃运营的 Remote Sources（ASSIGNED 或 DEGRADED）。
 * 纯函数。
 */
export function filterOperational(
  sources: readonly RemoteSource[],
): RemoteSource[] {
  return sources.filter(s => isOperational(s.status));
}

/**
 * 查找指定 homeRoom + targetRoom 的 Remote Source。
 * 纯函数。
 */
export function findRemoteSource(
  sources: readonly RemoteSource[],
  homeRoom: string,
  targetRoom: string,
): RemoteSource | undefined {
  const id = makeRemoteSourceId(homeRoom, targetRoom);
  return sources.find(s => s.id === id);
}

// ─── 序列化 ──────────────────────────────────────────────

/**
 * Remote Source 瘦快照（存入 Memory）。
 */
export interface RemoteSourceSnapshot {
  i: string;  // id
  h: string;  // homeRoom
  t: string;  // targetRoom
  sc: number; // sourceCount
  ey: number; // expectedYield
  rv: number; // reserved (0/1)
  pc: number; // pathCost
  ld: number; // linearDistance
  hr: number; // hasRoad (0/1)
  rl: number; // riskLevel
  lh: number | undefined; // lastHostileAt
  ic: number; // hasInvaderCore (0/1)
  st: string; // status code
  ca: number; // createdAt
  ua: number; // updatedAt
}

/**
 * 序列化 Remote Source 为瘦快照。
 * 纯函数。
 */
export function serializeRemoteSource(s: RemoteSource): RemoteSourceSnapshot {
  const statusCode = (status: RemoteSourceStatus): string => {
    switch (status) {
      case "available": return "A";
      case "assigned": return "S";
      case "degraded": return "D";
      case "blocked": return "B";
      case "inactive": return "I";
    }
  };
  return {
    i: s.id,
    h: s.homeRoom,
    t: s.targetRoom,
    sc: s.sourceCount,
    ey: Math.round(s.expectedYield),
    rv: s.reserved ? 1 : 0,
    pc: Math.round(s.pathCost),
    ld: s.linearDistance,
    hr: s.hasRoad ? 1 : 0,
    rl: s.riskLevel,
    lh: s.lastHostileAt,
    ic: s.hasInvaderCore ? 1 : 0,
    st: statusCode(s.status),
    ca: s.createdAt,
    ua: s.updatedAt,
  };
}

/**
 * 从瘦快照反序列化 Remote Source。
 * 纯函数。
 */
export function deserializeRemoteSource(snap: RemoteSourceSnapshot): RemoteSource {
  const codeToStatus = (c: string): RemoteSourceStatus => {
    switch (c) {
      case "A": return "available";
      case "S": return "assigned";
      case "D": return "degraded";
      case "B": return "blocked";
      case "I": return "inactive";
      default: return "available";
    }
  };
  return {
    id: snap.i,
    homeRoom: snap.h,
    targetRoom: snap.t,
    resource: "energy",
    sourceCount: snap.sc,
    expectedYield: snap.ey,
    reserved: snap.rv === 1,
    pathCost: snap.pc,
    linearDistance: snap.ld,
    hasRoad: snap.hr === 1,
    riskLevel: snap.rl,
    lastHostileAt: snap.lh,
    hasInvaderCore: snap.ic === 1,
    status: codeToStatus(snap.st),
    createdAt: snap.ca,
    updatedAt: snap.ua,
    origin: "deserialized",
  };
}
