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
 *   1-9 — 预留（多房间 intel / market / 路径缓存）
 */
import { globalCache } from "./global-cache";

// ─── Segment ID 常量 ────────────────────────────────────────

export const SEGMENT_LAYOUT = 0;

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
 */
export function requestSegments(): void {
  const cache = segCache();
  if (cache.requested) return;
  cache.requested = true;
  RawMemory.setActiveSegments([SEGMENT_LAYOUT]);
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

/**
 * 在 tick 末尾调用 — 将 dirty segment 刷写回 RawMemory。
 * 仅在有新写入时执行 JSON.stringify（避免无变化时的 CPU 浪费）。
 */
export function flushSegments(): void {
  const cache = segCache();
  if (!cache.layoutDirty || !cache.layout) return;

  RawMemory.segments[SEGMENT_LAYOUT] = JSON.stringify(cache.layout);
  cache.layoutDirty = false;
}
