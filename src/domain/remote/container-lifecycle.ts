/** Container Lifecycle */

// ─── 容器生命周期状态 ──────────────────────────────────

/**
 * Container Lifecycle State — 远矿 container 的六状态。
 */
export type ContainerLifecycleState =
  | "missing"
  | "planned"
  | "building"
  | "active"
  | "damaged"
  | "destroyed";

/** 所有状态。 */
export const CONTAINER_STATES: readonly ContainerLifecycleState[] = [
  "missing",
  "planned",
  "building",
  "active",
  "damaged",
  "destroyed",
] as const;

/** 判定状态是否为终态（需要重建）。纯函数。 */
export function isContainerTerminal(state: ContainerLifecycleState): boolean {
  return state === "destroyed";
}

/** 判定状态是否为可用（container 在位且功能正常）。纯函数。 */
export function isContainerUsable(state: ContainerLifecycleState): boolean {
  return state === "active" || state === "damaged";
}

/** 判定状态是否需要建造动作。纯函数。 */
export function isContainerUnderConstruction(
  state: ContainerLifecycleState,
): boolean {
  return state === "planned" || state === "building";
}

// ─── Container 状态快照 ─────────────────────────────────

/**
 * Container 在某一时刻的状态快照。
 * 用于 Operation 追踪和 Dashboard 展示。
 */
export interface ContainerSnapshot {
  /** 关联的 source ID。 */
  sourceId: string;
  /** 所在房间。 */
  roomName: string;
  /** 当前生命周期状态。 */
  state: ContainerLifecycleState;
  /** container 结构 ID（建成后有值，被摧毁后为 undefined）。 */
  structureId: string | undefined;
  /** construction site ID（建造中有值）。 */
  siteId: string | undefined;
  /** 当前 hits（建成后有值）。 */
  hits: number | undefined;
  /** 最大 hits（250,000 for container）。 */
  hitsMax: number;
  /** 状态变更 tick。 */
  updatedAt: number;
}

// ─── 转换规则 ──────────────────────────────────────────

/**
 * 合法状态转换表。
 * key = 当前状态，value = 可转换到的状态列表。
 */
const VALID_TRANSITIONS: Record<ContainerLifecycleState, ContainerLifecycleState[]> = {
  missing: ["planned"],
  planned: ["building", "missing"], // building=site 创建成功，missing=放弃
  building: ["active", "missing"], // active=建成，missing=site 被移除
  active: ["damaged", "destroyed"],
  damaged: ["active", "destroyed"], // active=修好，destroyed=彻底摧毁
  destroyed: ["planned"], // 重建
};

/**
 * 判定状态转换是否合法。
 * 纯函数。
 */
export function isValidTransition(
  from: ContainerLifecycleState,
  to: ContainerLifecycleState,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 执行状态转换（如果合法）。
 * 非法转换返回原状态。
 * 纯函数 — 返回新对象。
 */
export function transitionContainerState(
  snapshot: ContainerSnapshot,
  newState: ContainerLifecycleState,
  tick: number,
): ContainerSnapshot {
  if (!isValidTransition(snapshot.state, newState)) return snapshot;
  return {
    ...snapshot,
    state: newState,
    updatedAt: tick,
  };
}

// ─── 从游戏对象派生状态 ─────────────────────────────────

/**
 * 从 container 结构 + construction site + needContainer 标记派生生命周期状态。

 * 优先级：
 * 1. 有 ACTIVE container 且 hits >= repairThreshold → ACTIVE
 * 2. 有 ACTIVE container 且 hits < repairThreshold → DAMAGED
 * 3. 有 construction site → BUILDING
 * 4. 有 needContainer 标记 → PLANNED
 * 5. 曾有 container 但现在没了 → DESTROYED（如果之前是 ACTIVE/DAMAGED）
 * 6. 无任何痕迹 → MISSING

 * 纯函数 — 不访问 Game/Memory，从参数注入。
 */
export function deriveContainerState(input: {
  /** 是否有建成 container。 */
  hasContainer: boolean;
  /** container hits（如果有）。 */
  hits: number | undefined;
  /** container hitsMax。 */
  hitsMax: number;
  /** 是否有 construction site。 */
  hasSite: boolean;
  /** 是否有 needContainer 标记。 */
  needContainer: boolean;
  /** 上一个已知状态（用于判断 DESTROYED）。 */
  prevState: ContainerLifecycleState | undefined;
  /** 维修阈值（hits < hitsMax × ratio）。 */
  repairThresholdRatio: number;
}): ContainerLifecycleState {
  const { repairThresholdRatio } = input;
  const repairThreshold = input.hitsMax * repairThresholdRatio;

  // 1-2. 有建成的 container
  if (input.hasContainer && input.hits !== undefined) {
    if (input.hits <= 0) return "destroyed";
    if (input.hits < repairThreshold) return "damaged";
    return "active";
  }

  // 3. 有 construction site
  if (input.hasSite) return "building";

  // 4. 有 needContainer 标记
  if (input.needContainer) return "planned";

  // 5. 之前有 container（ACTIVE/DAMAGED），现在没了 → DESTROYED
  if (
    input.prevState === "active" ||
    input.prevState === "damaged"
  ) {
    return "destroyed";
  }

  // 6. 无任何痕迹
  return "missing";
}

// ─── 序列化 ──────────────────────────────────────────────

/**
 * Container 状态码映射（短码节省 Memory）。
 */
const CONTAINER_STATE_CODES: Record<ContainerLifecycleState, string> = {
  missing: "M",
  planned: "P",
  building: "B",
  active: "A",
  damaged: "D",
  destroyed: "X",
};

/** 状态码逆向映射。 */
const CONTAINER_STATE_DECODE: Record<string, ContainerLifecycleState> = {
  M: "missing",
  P: "planned",
  B: "building",
  A: "active",
  D: "damaged",
  X: "destroyed",
};

/**
 * Container 瘦快照（存入 Memory）。
 */
export interface ContainerSnapshotSerialized {
  si: string; // sourceId
  rn: string; // roomName
  st: string; // state code
  si2: string | undefined; // structureId
  si3: string | undefined; // siteId
  hi: number | undefined; // hits
  hm: number; // hitsMax
  ua: number; // updatedAt
}

/**
 * 序列化 Container 快照。
 * 纯函数。
 */
export function serializeContainerSnapshot(
  snap: ContainerSnapshot,
): ContainerSnapshotSerialized {
  return {
    si: snap.sourceId,
    rn: snap.roomName,
    st: CONTAINER_STATE_CODES[snap.state] ?? "M",
    si2: snap.structureId,
    si3: snap.siteId,
    hi: snap.hits,
    hm: snap.hitsMax,
    ua: snap.updatedAt,
  };
}

/**
 * 反序列化 Container 快照。
 * 纯函数。
 */
export function deserializeContainerSnapshot(
  s: ContainerSnapshotSerialized,
): ContainerSnapshot {
  return {
    sourceId: s.si,
    roomName: s.rn,
    state: CONTAINER_STATE_DECODE[s.st] ?? "missing",
    structureId: s.si2,
    siteId: s.si3,
    hits: s.hi,
    hitsMax: s.hm,
    updatedAt: s.ua,
  };
}

// ─── 创建快照 ──────────────────────────────────────────

/**
 * 创建初始 Container 快照（状态 = MISSING）。
 * 纯函数。
 */
export function createContainerSnapshot(
  sourceId: string,
  roomName: string,
  tick: number,
): ContainerSnapshot {
  return {
    sourceId,
    roomName,
    state: "missing",
    structureId: undefined,
    siteId: undefined,
    hits: undefined,
    hitsMax: 250000, // CONTAINER_HITS
    updatedAt: tick,
  };
}

// ─── 批量操作 ──────────────────────────────────────────

/**
 * 从快照列表中查找指定 source 的 container 状态。
 * 纯函数。
 */
export function findContainerSnapshot(
  snapshots: readonly ContainerSnapshot[],
  sourceId: string,
): ContainerSnapshot | undefined {
  return snapshots.find(s => s.sourceId === sourceId);
}

/**
 * 过滤出需要建造/修复的 container（PLANNED / BUILDING / DAMAGED / DESTROYED）。
 * 纯函数。
 */
export function filterContainersNeedingAttention(
  snapshots: readonly ContainerSnapshot[],
): ContainerSnapshot[] {
  return snapshots.filter(
    s =>
      s.state === "planned" ||
      s.state === "building" ||
      s.state === "damaged" ||
      s.state === "destroyed",
  );
}

/**
 * 过滤出可用的 container（ACTIVE / DAMAGED）。
 * 纯函数。
 */
export function filterUsableContainers(
  snapshots: readonly ContainerSnapshot[],
): ContainerSnapshot[] {
  return snapshots.filter(s => isContainerUsable(s.state));
}

/**
 * 统计指定状态的 container 数量。
 * 纯函数。
 */
export function countContainersByState(
  snapshots: readonly ContainerSnapshot[],
  state: ContainerLifecycleState,
): number {
  return snapshots.filter(s => s.state === state).length;
}
