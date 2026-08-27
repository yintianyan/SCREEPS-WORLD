/** Segment Store — RawMemory segment 的类型安全读写层。 */
import { CONFIG } from "../config";
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

// 【F1/G-D】segment id 真相源 = CONFIG.memory.segments 配额表（FREEZE §9）；
// 此处仅保留兼容别名。新增段必须先在配额表登记（≤10 active）。
const SEG_IDS = CONFIG.memory.segments as Record<string, { id: number } | number>;
function segId(name: string, fallback: number): number {
  const entry = SEG_IDS[name];
  return typeof entry === "number" ? fallback : (entry?.id ?? fallback);
}
export const SEGMENT_LAYOUT = segId("layout", 0);
export const SEGMENT_CPU = segId("cpu", 1);
export const SEGMENT_EVENT_LOG = segId("eventLog", 2);
export const SEGMENT_ECONOMY = segId("economy", 3);
/** Segment 4: Prometheus metrics text（screeps-exporter 读取）。 */
export const SEGMENT_PROMETHEUS = segId("prometheus", 4);
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
  layout?: LayoutSegmentData;
  layoutDirty?: boolean;
  cpuSeg?: CpuSegmentData;
  cpuDirty?: boolean;
  economySeg?: EconomySegmentData;
  economyDirty?: boolean;
  eventLog?: EventLogSegmentData;
  eventLogDirty?: boolean;
  /** Prometheus text（纯文本 exposition format）。 */
  prometheusText?: string;
  prometheusDirty?: boolean;
  requested?: boolean;
  /** 首次请求激活 segment 的 tick（global reset 后重建）— 可用性守卫用。 */
  requestedAt?: number;
  /** 迁移是否已完成（防止重复迁移）。 */
  migrated?: boolean;
}

function segCache(): SegmentCache {
  const g = globalCache() as any;
  if (!g.__segStore) g.__segStore = {};
  return g.__segStore as SegmentCache;
}

/**
 * P1-2 可用性守卫：setActiveSegments 下一 tick 才生效 [Facts] — global reset 后
 * 首 tick RawMemory.segments[N] 为 undefined（未激活），并非没有数据。
 * 此时若创建空结构并缓存，采样/写入会把空数据 flush 回 RawMemory，整体覆盖
 * 历史 segment（时序清零、layout 冷数据丢失）。
 * 判定：raw 为 undefined 且本 tick 恰是首次请求激活的 tick（requestedAt === Game.time）；
 * 下一 tick 起 undefined 视为「从未写入」（新服务器），照常初始化。
 * 未调用 requestSegments 的环境（单测）requestedAt 为 undefined，守卫不生效。
 */
function segmentUnavailable(segmentId: number): boolean {
  return (
    RawMemory.segments[segmentId] === undefined &&
    segCache().requestedAt === Game.time
  );
}

/**
 * layout segment 本 tick 是否可安全读写 — 供依赖 segment 的迁移做就绪门禁。
 * reset 首 tick segment 未加载时返回 false，迁移链应在此中断、下 tick 重试，
 * 否则迁移数据会被写进 readLayoutSegment 返回的临时空结构后随源字段删除而丢失。
 */
export function layoutSegmentReady(): boolean {
  return !segmentUnavailable(SEGMENT_LAYOUT);
}

// ─── 公共 API ───────────────────────────────────────────────

/** 在 tick 开始时调用 — 声明需要激活的 segment（4 个，在 10 个上限内 [Facts]）。 */
export function requestSegments(): void {
  const cache = segCache();
  if (cache.requested) return;
  cache.requested = true;
  cache.requestedAt = Game.time;
  RawMemory.setActiveSegments([
    SEGMENT_LAYOUT,
    SEGMENT_CPU,
    SEGMENT_EVENT_LOG,
    SEGMENT_ECONOMY,
    SEGMENT_PROMETHEUS,
  ]);
}

/** 读取 layout segment 数据（带缓存）。首次调用从 RawMemory.segments 解析；global reset 后自动重建。 */
export function readLayoutSegment(): LayoutSegmentData {
  const cache = segCache();
  if (cache.layout) return cache.layout;

  // reset 后首 tick segment 未加载 — 返回临时空结构且不缓存，防止空数据覆盖历史 segment。
  if (segmentUnavailable(SEGMENT_LAYOUT)) return {};

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

/** 获取指定房间的 layout 冷数据；不存在时自动创建空条目。 */
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

/** 读取 CPU segment 数据（带缓存）：CPU 时序 + 最新人口普查快照。
 * 自动迁移：检测到旧格式（segment 1 含 economy 字段）时把 economy 迁到 segment 3。 */
export function readCpuSegment(): CpuSegmentData {
  const cache = segCache();
  if (cache.cpuSeg) return cache.cpuSeg;

  // segment 未加载 → 临时空结构且不缓存（见 segmentUnavailable）。
  if (segmentUnavailable(SEGMENT_CPU)) return createEmptyCpuSegment();

  const raw = RawMemory.segments[SEGMENT_CPU];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.cpu) {
        // 检测旧格式（包含 economy 字段）— 触发迁移。
        if (parsed.economy && !cache.migrated) {
          migrateLegacyTimeseries(parsed as LegacyTimeseriesData);
          // 迁移已重建 cpuSeg，直接返回。
          if (cache.cpuSeg) return cache.cpuSeg;
        }
        // 非迁移路径：清理可能残留的 null 空洞（JSON 往返后 undefined → null）。
        cache.cpuSeg = {
          cpu: rebuildRingBuffer(parsed.cpu, CPU_RING_CAPACITY),
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

/** 读取经济 segment 数据（带缓存）：经济时序环形缓冲（按房间混合，每 50 tick 一条）。
 * 自动迁移：segment 3 为空时尝试从旧 segment 1 提取 economy 数据。 */
export function readEconomySegment(): EconomySegmentData {
  const cache = segCache();
  if (cache.economySeg) return cache.economySeg;

  // segment 未加载 → 临时空结构且不缓存（见 segmentUnavailable）。
  if (segmentUnavailable(SEGMENT_ECONOMY)) return createEmptyEconomySegment();

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
        // 清理可能残留的 null 空洞。
        cache.economySeg = {
          economy: rebuildRingBuffer(parsed.economy, ECONOMY_RING_CAPACITY),
        };
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

/** 旧格式 segment 1（CPU + economy + population 混存）→ segment 1 仅 CPU + population，
 * economy 迁到 segment 3。幂等（已迁移直接返回）；迁移后立即标记 dirty 供 tick 末尾 flush。 */
function migrateLegacyTimeseries(legacy: LegacyTimeseriesData): void {
  const cache = segCache();
  if (cache.migrated) return;
  cache.migrated = true;

  console.log("[segment] migrating legacy segment 1 → segment 1 (cpu) + segment 3 (economy)");

  // 重建 economy ring buffer — 过滤旧裁剪逻辑留下的 null/undefined 空洞。
  if (legacy.economy) {
    const cleanEconomy = rebuildRingBuffer(legacy.economy, ECONOMY_RING_CAPACITY);
    cache.economySeg = { economy: cleanEconomy };
    cache.economyDirty = true;
  }

  // 重建 cpu ring buffer — 同样过滤空洞。
  if (legacy.cpu) {
    const cleanCpu = rebuildRingBuffer(legacy.cpu, CPU_RING_CAPACITY);
    cache.cpuSeg = {
      cpu: cleanCpu,
      population: legacy.population,
    };
    cache.cpuDirty = true;
  }
}

/** 从可能含 null/undefined 空洞的旧 ring buffer 重建干净版本，保留有效数据与时间顺序。 */
function rebuildRingBuffer<T>(old: RingBuffer<T>, capacity: number): RingBuffer<T> {
  const clean = createRingBuffer<T>(capacity);
  const valid = ringToArray(old); // ringToArray 已过滤 null/undefined
  for (const item of valid) {
    ringPush(clean, item);
  }
  return clean;
}

// ─── 事件日志 segment (Segment 2) ───────────────────────────

/** 读取事件日志 segment 数据（带缓存）。 */
export function readEventLogSegment(): EventLogSegmentData {
  const cache = segCache();
  if (cache.eventLog) return cache.eventLog;

  // reset 后首 tick segment 未加载 — 返回临时空结构且不缓存（见 segmentUnavailable）。
  if (segmentUnavailable(SEGMENT_EVENT_LOG)) {
    return { events: createRingBuffer<GameEvent>(EVENT_RING_CAPACITY) };
  }

  const raw = RawMemory.segments[SEGMENT_EVENT_LOG];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as EventLogSegmentData;
      if (parsed.events) {
        // 清理可能残留的 null 空洞。
        cache.eventLog = {
          events: rebuildRingBuffer(parsed.events, EVENT_RING_CAPACITY),
        };
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
 * 写入 Prometheus exposition format text 到 segment 4。
 * 由 TelemetryFlush 在 flush 时调用。tick 末尾 flushSegments 会写入 RawMemory。
 * 安全不变式：空字符串也会写入（exporter 需要区分「无数据」与「未更新」）。
 */
export function writePrometheusSegment(text: string): void {
  const cache = segCache();
  cache.prometheusText = text;
  cache.prometheusDirty = true;
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

/** 在 tick 末尾调用 — 将所有 dirty segment 刷写回 RawMemory（仅在有新写入时 JSON.stringify，避免 CPU 浪费）。 */
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

  // Segment 4: Prometheus metrics — 存纯文本 Prom exposition format。
  // 不走 JSON（screeps-exporter 直接读取文本作为 /metrics 响应体）。
  // 由 TelemetryFlush 在 runFlush 中调用 writePrometheusSegment 写入。
  if (cache.prometheusDirty) {
    const text = cache.prometheusText ?? "";
    // 容量守卫：100KB 上限，超出截断（理论上不会超 — 指标数量有限）
    RawMemory.segments[SEGMENT_PROMETHEUS] = text.length > 95 * 1024
      ? text.slice(0, 95 * 1024)
      : text;
    cache.prometheusDirty = false;
  }
}
