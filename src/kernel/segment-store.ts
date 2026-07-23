/**
 * Segment Store — RawMemory segment 的类型安全读写层。
 *
 * 设计原则：
 *   - 热数据留 Memory（每 tick 自动序列化），冷数据存 segment（按需加载）。
 *   - 读取走 globalCache 缓存（global reset 后从 RawMemory.segments 重建）。
 *   - 写入标记 dirty，tick 末尾统一 flush（避免多次 JSON.stringify）。
 *   - segment 需要在 tick 开始时通过 requestSegments() 声明激活。
 *
 * Segment 分配表：
 *   0 — layout 冷数据（overrides / blocked per room）
 *   1 — CPU 时序环形缓冲 + 人口普查快照（~52KB，远低于 100KB 上限）
 *   2 — 事件日志环形缓冲（Phase/Tier/ColonyState 转换等离散事件）
 *   3 — 经济时序环形缓冲（~28KB，远低于 100KB 上限）
 *   4-9 — 预留（多房间 intel / market / 路径缓存）
 *
 * 旧版将 CPU + Economy 混存于 segment 1，满载 ~81KB，逼近 100KB 上限。
 * 拆分后每个 segment 独立远低于上限，彻底消除溢出风险。
 * 激活 4 个 segment 仍在 10 个上限内 [Facts]。
 */
import { globalCache } from "./global-cache";
import type {
  CpuSegmentData,
  EconomySegmentData,
  LegacyTimeseriesData,
  CpuSample,
  EconomySample,
  PopulationSnapshot,
} from "./timeseries";
import type { EventLogSegmentData, GameEvent } from "./event-log";
import { createRingBuffer, ringToArray, ringPush, type RingBuffer } from "./ring-buffer";

// ─── Segment ID 常量 ────────────────────────────────────────

export const SEGMENT_LAYOUT = 0;
export const SEGMENT_CPU = 1;
export const SEGMENT_EVENT_LOG = 2;
export const SEGMENT_ECONOMY = 3;
/** @deprecated 使用 SEGMENT_CPU。保留用于迁移期间的代码引用。 */
export const SEGMENT_TIMESERIES = SEGMENT_CPU;

// ─── 容量常量 ───────────────────────────────────────────────

/** CPU 时序环形缓冲容量（每 10 tick 采样 → 300 条 = 3000 tick 窗口）。 */
const CPU_RING_CAPACITY = 300;
/** 经济时序环形缓冲容量（每 50 tick 采样 → 200 条 = 10000 tick 窗口）。 */
const ECONOMY_RING_CAPACITY = 200;
/** 事件日志环形缓冲容量（保留最近 500 条事件）。 */
const EVENT_RING_CAPACITY = 500;

// ─── 数据类型 ───────────────────────────────────────────────

/** Segment 0 的顶层结构：按房间名索引的 layout 冷数据。 */
export interface LayoutSegmentData {
  [roomName: string]: {
    overrides: Record<string, number>;
    blocked: Record<string, { code: number; retryAt: number }>;
  };
}

// ─── 内部状态（挂在 globalCache 上）─────────────────────────

interface SegmentCache {
  /** 已解析的 segment 数据缓存。 */
  layout?: LayoutSegmentData;
  /** 是否有未刷写的修改。 */
  layoutDirty?: boolean;
  /** CPU segment 数据缓存（segment 1）。 */
  cpuSeg?: CpuSegmentData;
  /** CPU segment 是否有未刷写的修改。 */
  cpuDirty?: boolean;
  /** 经济 segment 数据缓存（segment 3）。 */
  economySeg?: EconomySegmentData;
  /** 经济 segment 是否有未刷写的修改。 */
  economyDirty?: boolean;
  /** 事件日志 segment 数据缓存。 */
  eventLog?: EventLogSegmentData;
  /** 事件日志 segment 是否有未刷写的修改。 */
  eventLogDirty?: boolean;
  /** 本 tick 是否已请求激活 segment。 */
  requested?: boolean;
  /** 迁移是否已完成（防止重复迁移）。 */
  migrated?: boolean;
}

function segCache(): SegmentCache {
  const g = globalCache() as any;
  if (!g.__segStore) g.__segStore = {};
  return g.__segStore as SegmentCache;
}

// ─── 公共 API ───────────────────────────────────────────────

/**
 * 在 tick 开始时调用 — 声明需要激活的 segment。
 * 激活 4 个 segment（layout + cpu + eventLog + economy）在 10 个上限内 [Facts]。
 */
export function requestSegments(): void {
  const cache = segCache();
  if (cache.requested) return;
  cache.requested = true;
  RawMemory.setActiveSegments([
    SEGMENT_LAYOUT,
    SEGMENT_CPU,
    SEGMENT_EVENT_LOG,
    SEGMENT_ECONOMY,
  ]);
}

/**
 * 读取 layout segment 数据（带缓存）。
 * 首次调用时从 RawMemory.segments 解析；global reset 后自动重建。
 */
export function readLayoutSegment(): LayoutSegmentData {
  const cache = segCache();
  if (cache.layout) return cache.layout;

  const raw = RawMemory.segments[SEGMENT_LAYOUT];
  if (raw) {
    try {
      cache.layout = JSON.parse(raw) as LayoutSegmentData;
    } catch {
      cache.layout = {};
    }
  } else {
    cache.layout = {};
  }
  return cache.layout;
}

/**
 * 获取指定房间的 layout 冷数据。不存在时自动创建空条目。
 */
export function getRoomLayoutData(roomName: string): LayoutSegmentData[string] {
  const data = readLayoutSegment();
  if (!data[roomName]) {
    data[roomName] = { overrides: {}, blocked: {} };
  }
  return data[roomName]!;
}

/** 标记 layout segment 为 dirty — tick 末尾 flush 时写回 RawMemory。 */
export function markLayoutDirty(): void {
  segCache().layoutDirty = true;
}

// ─── CPU segment (Segment 1) ───────────────────────────────

/**
 * 读取 CPU segment 数据（带缓存）。
 * 包含 CPU 时序环形缓冲 + 最新人口普查快照。
 *
 * 自动迁移：如果检测到旧格式（segment 1 包含 economy 字段），
 * 会将 economy 数据迁移到 segment 3 并清理 segment 1。
 */
export function readCpuSegment(): CpuSegmentData {
  const cache = segCache();
  if (cache.cpuSeg) return cache.cpuSeg;

  const raw = RawMemory.segments[SEGMENT_CPU];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.cpu) {
        // 检测旧格式（包含 economy 字段）— 触发迁移。
        if (parsed.economy && !cache.migrated) {
          migrateLegacyTimeseries(parsed as LegacyTimeseriesData);
        }
        // 使用 cpu + population（忽略可能残留的 economy 字段）。
        cache.cpuSeg = {
          cpu: parsed.cpu,
          population: parsed.population,
        };
      } else {
        cache.cpuSeg = createEmptyCpuSegment();
      }
    } catch {
      cache.cpuSeg = createEmptyCpuSegment();
    }
  } else {
    cache.cpuSeg = createEmptyCpuSegment();
  }
  return cache.cpuSeg;
}

/** 标记 CPU segment 为 dirty — tick 末尾 flush 时写回。 */
export function markCpuDirty(): void {
  segCache().cpuDirty = true;
}

/** @deprecated 使用 readCpuSegment。保留用于过渡期兼容。 */
export function readTimeseriesSegment(): CpuSegmentData & { economy: RingBuffer<EconomySample> } {
  const cpuSeg = readCpuSegment();
  const econSeg = readEconomySegment();
  // 返回合并视图 — 消费方代码迁移后应直接使用各自 segment。
  return {
    cpu: cpuSeg.cpu,
    population: cpuSeg.population,
    economy: econSeg.economy,
  };
}

/** @deprecated 使用 markCpuDirty + markEconomyDirty。 */
export function markTimeseriesDirty(): void {
  markCpuDirty();
  markEconomyDirty();
}

/** 创建带空环形缓冲区的初始 CPU segment 数据。 */
function createEmptyCpuSegment(): CpuSegmentData {
  return {
    cpu: createRingBuffer<CpuSample>(CPU_RING_CAPACITY),
  };
}

// ─── Economy segment (Segment 3) ───────────────────────────

/**
 * 读取经济 segment 数据（带缓存）。
 * 包含经济时序环形缓冲（按房间混合，每 50 tick 一条）。
 *
 * 自动迁移：首次读取时如果 segment 3 为空，
 * 会尝试从旧 segment 1 中提取 economy 数据。
 */
export function readEconomySegment(): EconomySegmentData {
  const cache = segCache();
  if (cache.economySeg) return cache.economySeg;

  // 触发迁移检查（如果 segment 1 有旧格式数据）。
  if (!cache.migrated) {
    const raw1 = RawMemory.segments[SEGMENT_CPU];
    if (raw1) {
      try {
        const parsed = JSON.parse(raw1);
        if (parsed && parsed.economy) {
          // 旧格式 — 迁移 economy 到 segment 3。
          migrateLegacyTimeseries(parsed as LegacyTimeseriesData);
          // 迁移函数已设置 cache.economySeg。
          if (cache.economySeg) return cache.economySeg;
        }
      } catch {
        // segment 1 损坏 — 走正常初始化。
      }
    }
  }

  const raw3 = RawMemory.segments[SEGMENT_ECONOMY];
  if (raw3) {
    try {
      const parsed = JSON.parse(raw3) as EconomySegmentData;
      if (parsed && parsed.economy) {
        cache.economySeg = parsed;
      } else {
        cache.economySeg = createEmptyEconomySegment();
      }
    } catch {
      cache.economySeg = createEmptyEconomySegment();
    }
  } else {
    cache.economySeg = createEmptyEconomySegment();
  }
  return cache.economySeg;
}

/** 标记经济 segment 为 dirty — tick 末尾 flush 时写回。 */
export function markEconomyDirty(): void {
  segCache().economyDirty = true;
}

/** 创建带空环形缓冲区的初始经济 segment 数据。 */
function createEmptyEconomySegment(): EconomySegmentData {
  return {
    economy: createRingBuffer<EconomySample>(ECONOMY_RING_CAPACITY),
  };
}

// ─── 迁移逻辑 ───────────────────────────────────────────────

/**
 * 将旧格式 segment 1（CPU + economy + population 混存）
 * 迁移到新格式：segment 1 仅保留 CPU + population，economy 迁移到 segment 3。
 *
 * 迁移是幂等的：如果已迁移则直接返回。
 * 迁移后立即标记两个 segment 为 dirty，在 tick 末尾 flush 时写入正确格式。
 */
function migrateLegacyTimeseries(legacy: LegacyTimeseriesData): void {
  const cache = segCache();
  if (cache.migrated) return;
  cache.migrated = true;

  // 将 economy 数据放入 segment 3 缓存。
  if (legacy.economy) {
    cache.economySeg = { economy: legacy.economy };
    cache.economyDirty = true;
    console.log("[segment] migrating economy data from segment 1 → segment 3");
  }

  // 从 segment 1 缓存中移除 economy（仅保留 cpu + population）。
  if (legacy.cpu) {
    cache.cpuSeg = {
      cpu: legacy.cpu,
      population: legacy.population,
    };
    cache.cpuDirty = true;
  }
}

// ─── 事件日志 segment (Segment 2) ───────────────────────────

/**
 * 读取事件日志 segment 数据（带缓存）。
 */
export function readEventLogSegment(): EventLogSegmentData {
  const cache = segCache();
  if (cache.eventLog) return cache.eventLog;

  const raw = RawMemory.segments[SEGMENT_EVENT_LOG];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as EventLogSegmentData;
      if (parsed.events) {
        cache.eventLog = parsed;
      } else {
        cache.eventLog = { events: createRingBuffer<GameEvent>(EVENT_RING_CAPACITY) };
      }
    } catch {
      cache.eventLog = { events: createRingBuffer<GameEvent>(EVENT_RING_CAPACITY) };
    }
  } else {
    cache.eventLog = { events: createRingBuffer<GameEvent>(EVENT_RING_CAPACITY) };
  }
  return cache.eventLog;
}

/** 标记事件日志 segment 为 dirty — tick 末尾 flush 时写回。 */
export function markEventLogDirty(): void {
  segCache().eventLogDirty = true;
}

// ─── Size guard ─────────────────────────────────────────────

/** 安全阈值：序列化体积超过此值时触发裁剪。 */
const SEGMENT_SIZE_LIMIT = 90 * 1024;
/** 裁剪时保留的比例。 */
const TRIM_KEEP_RATIO = 0.75;

/**
 * 裁剪环形缓冲区 — 保留最新的 keepCount 条数据，重建缓冲区。
 * O(c) 复杂度，对于 300 条目约 0.01ms。
 */
function trimRingBuffer<T>(buf: RingBuffer<T>, keepCount: number): RingBuffer<T> {
  if (keepCount <= 0) return createRingBuffer<T>(buf.d.length);
  const all = ringToArray(buf);
  if (all.length <= keepCount) return buf;
  const keep = all.slice(all.length - keepCount);
  const newBuf = createRingBuffer<T>(buf.d.length);
  for (const item of keep) {
    ringPush(newBuf, item);
  }
  return newBuf;
}

/**
 * 在 tick 末尾调用 — 将所有 dirty segment 刷写回 RawMemory。
 * 仅在有新写入时执行 JSON.stringify（避免无变化时的 CPU 浪费）。
 */
export function flushSegments(): void {
  const cache = segCache();

  if (cache.layoutDirty && cache.layout) {
    RawMemory.segments[SEGMENT_LAYOUT] = JSON.stringify(cache.layout);
    cache.layoutDirty = false;
  }

  // CPU segment — 满载 ~52KB，远低于 100KB 上限。
  // 保留 size guard 作为 defense-in-depth。
  if (cache.cpuDirty && cache.cpuSeg) {
    let serialized = JSON.stringify(cache.cpuSeg);
    if (serialized.length > SEGMENT_SIZE_LIMIT) {
      cache.cpuSeg.cpu = trimRingBuffer(
        cache.cpuSeg.cpu,
        Math.floor(cache.cpuSeg.cpu.c * TRIM_KEEP_RATIO),
      );
      serialized = JSON.stringify(cache.cpuSeg);
    }
    RawMemory.segments[SEGMENT_CPU] = serialized;
    cache.cpuDirty = false;
  }

  // Economy segment — 满载 ~28KB，远低于 100KB 上限。
  if (cache.economyDirty && cache.economySeg) {
    let serialized = JSON.stringify(cache.economySeg);
    if (serialized.length > SEGMENT_SIZE_LIMIT) {
      cache.economySeg.economy = trimRingBuffer(
        cache.economySeg.economy,
        Math.floor(cache.economySeg.economy.c * TRIM_KEEP_RATIO),
      );
      serialized = JSON.stringify(cache.economySeg);
    }
    RawMemory.segments[SEGMENT_ECONOMY] = serialized;
    cache.economyDirty = false;
  }

  if (cache.eventLogDirty && cache.eventLog) {
    RawMemory.segments[SEGMENT_EVENT_LOG] = JSON.stringify(cache.eventLog);
    cache.eventLogDirty = false;
  }
}
