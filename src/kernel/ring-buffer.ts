/** Ring Buffer — 固定容量环形缓冲区。 */

/** 环形缓冲区的序列化形态。 */
export interface RingBuffer<T> {
  /** 数据数组（固定长度，空位为 undefined）。 */
  d: (T | undefined)[];
  /** 下一个写入位置（head 指针）。 */
  h: number;
  /** 已写入数量（达到 capacity 后不再增长）。 */
  c: number;
}

/** 创建一个容量为 capacity 的空环形缓冲区。 */
export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
  return { d: new Array(capacity), h: 0, c: 0 };
}

/** 向缓冲区推入一条数据。满则覆盖最老数据。 */
export function ringPush<T>(buf: RingBuffer<T>, entry: T): void {
  buf.d[buf.h] = entry;
  buf.h = (buf.h + 1) % buf.d.length;
  if (buf.c < buf.d.length) buf.c++;
}

/** 按时间顺序返回所有有效数据（最老在前）。 */
export function ringToArray<T>(buf: RingBuffer<T>): T[] {
  if (buf.c === 0) return [];
  const cap = buf.d.length;
  const result: T[] = [];
  // 如果缓冲区未满，head 指针之前的都是有效数据（从 0 到 head-1）。
  // 如果缓冲区已满，head 指向最老的数据（它将被下一次 push 覆盖）。
  const start = buf.c < cap ? 0 : buf.h;
  for (let i = 0; i < buf.c; i++) {
    const idx = (start + i) % cap;
    const val = buf.d[idx];
    // 同时过滤 undefined 和 null：
    // JSON.stringify 将 undefined 转为 null，反序列化后 null 残留在 d 数组中。
    // 旧裁剪逻辑可能留下 undefined 空洞，经 segment 往返后变为 null。
    if (val != null) result.push(val);
  }
  return result;
}

/** 获取缓冲区当前有效数据数量。 */
export function ringSize<T>(buf: RingBuffer<T>): number {
  return buf.c;
}

/** 清空缓冲区（保留容量）。 */
export function ringClear<T>(buf: RingBuffer<T>): void {
  buf.d = new Array(buf.d.length);
  buf.h = 0;
  buf.c = 0;
}
