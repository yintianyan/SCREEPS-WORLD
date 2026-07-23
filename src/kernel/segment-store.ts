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
 *   1 — 时序数据环形缓冲（CPU + 经济 + 人口，供事后趋势分析）
 *   2 — 事件日志环形缓冲（Phase/Tier/ColonyState 转换等离散事件）
 *   3-9 — 预留（多房间 intel / market / 路径缓存）
 */
import { globalCache } from "./global-cache";
import type { TimeseriesSegmentData, CpuSample, EconomySample } from "./timeseries";
import type { EventLogSegmentData, GameEvent } from "./event-log";
import { createRingBuffer } from "./ring-buffer";

// ─── Segment ID 常量 ────────────────────────────────────────

export const SEGMENT_LAYOUT = 0;
export const SEGMENT_TIMESERIES = 1;
export const SEGMENT_EVENT_LOG = 2;

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
  /** 时序 segment 数据缓存。 */
  timeseries?: TimeseriesSegmentData;
  /** 时序 segment 是否有未刷写的修改。 */
  timeseriesDirty?: boolean;
  /** 事件日志 segment 数据缓存。 */
  eventLog?: EventLogSegmentData;
  /** 事件日志 segment 是否有未刷写的修改。 */
  eventLogDirty?: boolean;
  /** 本 tick 是否已请求激活 segment。 */
  requested?: boolean;
}

function segCache(): SegmentCache {
  const g = globalCache() as any;
  if (!g.__segStore) g.__segStore = {};
  return g.__segStore as SegmentCache;
}

// ─── 公共 API ───────────────────────────────────────────────

/**
 * 在 tick 开始时调用 — 声明需要激活的 segment。
 * RawMemory.setActiveSegments 必须在 tick 早期调用，数据在下一 tick 可用。
 * 但由于 Screeps 的 segment 在 setActiveSegments 后同 tick 即可读取（如果之前已激活），
 * 我们每 tick 都调用以确保连续性。
 *
 * 激活 3 个 segment（layout + timeseries + eventLog）仍在 10 个上限内 [Facts]。
 */
export function requestSegments(): void {
  const cache = segCache();
  if (cache.requested) return;
  cache.requested = true;
  RawMemory.setActiveSegments([
    SEGMENT_LAYOUT,
    SEGMENT_TIMESERIES,
    SEGMENT_EVENT_LOG,
  ]);
}

/**
 * 读取 layout segment 数据（带缓存）。
 * 首次调用时从 RawMemory.segments 解析；global reset 后自动重建。
 */
export function readLayoutSegment(): LayoutSegmentData {
  const cache = segCache();
  if (cache.layout) return cache.layout;

  // 从 RawMemory 解析。
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

/**
 * 标记 layout segment 为 dirty — tick 末尾 flush 时写回 RawMemory。
 */
export function markLayoutDirty(): void {
  segCache().layoutDirty = true;
}

// ─── 时序 segment (Segment 1) ───────────────────────────────

/**
 * 读取时序 segment 数据（带缓存）。
 * 首次调用时从 RawMemory.segments 解析；global reset 后自动重建。
 * 如果 segment 不存在或解析失败，返回空环形缓冲区。
 */
export function readTimeseriesSegment(): TimeseriesSegmentData {
  const cache = segCache();
  if (cache.timeseries) return cache.timeseries;

  const raw = RawMemory.segments[SEGMENT_TIMESERIES];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as TimeseriesSegmentData;
      // 验证环形缓冲区结构完整性（global reset 后可能拿到畸形数据）
      if (parsed.cpu && parsed.economy) {
        cache.timeseries = parsed;
      } else {
        cache.timeseries = createEmptyTimeseries();
      }
    } catch {
      cache.timeseries = createEmptyTimeseries();
    }
  } else {
    cache.timeseries = createEmptyTimeseries();
  }
  return cache.timeseries;
}

/** 标记时序 segment 为 dirty — tick 末尾 flush 时写回。 */
export function markTimeseriesDirty(): void {
  segCache().timeseriesDirty = true;
}

/** 创建带空环形缓冲区的初始时序 segment 数据。 */
function createEmptyTimeseries(): TimeseriesSegmentData {
  return {
    cpu: createRingBuffer<CpuSample>(CPU_RING_CAPACITY),
    economy: createRingBuffer<EconomySample>(ECONOMY_RING_CAPACITY),
  };
}

// ─── 事件日志 segment (Segment 2) ───────────────────────────

/**
 * 读取事件日志 segment 数据（带缓存）。
 * 首次调用时从 RawMemory.segments 解析；global reset 后自动重建。
 * 如果 segment 不存在或解析失败，返回空环形缓冲区。
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

/**
 * 在 tick 末尾调用 — 将所有 dirty segment 刷写回 RawMemory。
 * 仅在有新写入时执行 JSON.stringify（避免无变化时的 CPU 浪费）。
 * 多个 dirty segment 分开 stringify，避免一次性序列化大对象。
 */
export function flushSegments(): void {
  const cache = segCache();

  if (cache.layoutDirty && cache.layout) {
    RawMemory.segments[SEGMENT_LAYOUT] = JSON.stringify(cache.layout);
    cache.layoutDirty = false;
  }

  if (cache.timeseriesDirty && cache.timeseries) {
    let serialized = JSON.stringify(cache.timeseries);
    // Size guard：segment 上限 100KB [Facts]，留 5KB 余量。
    // 超限时裁剪 CPU 缓冲区最老 25% 数据（CPU 是体积大户）。
    if (serialized.length > 95 * 1024) {
      const buf = cache.timeseries.cpu;
      const trimCount = Math.max(1, Math.floor(buf.c * 0.25));
      for (let i = 0; i < trimCount; i++) {
        const oldest = buf.h < buf.c ? (buf.h - buf.c + buf.d.length) % buf.d.length : (buf.h + i) % buf.d.length;
        buf.d[oldest] = undefined;
      }
      buf.c = Math.max(0, buf.c - trimCount);
      serialized = JSON.stringify(cache.timeseries);
    }
    RawMemory.segments[SEGMENT_TIMESERIES] = serialized;
    cache.timeseriesDirty = false;
  }

  if (cache.eventLogDirty && cache.eventLog) {
    RawMemory.segments[SEGMENT_EVENT_LOG] = JSON.stringify(cache.eventLog);
    cache.eventLogDirty = false;
  }
}
