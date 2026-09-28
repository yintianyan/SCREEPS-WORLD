/**
 * 通勤热度账 —— 把「本次进程踩过哪些格」跨进程续上的那一步。
 *
 * 为什么需要：远矿修路的落点判据是**被走过**，而走动记录（`creeps/movement/traffic.ts`）住在
 * heap。heap 每次 global reset 归零，而本仓库每次 push 都会让 CI 重新部署（实测一小时内三次
 * 重启），一趟通勤往返又要 50-100 tick —— 也就是说「攒够 3 次踩格」这件事以前**每次部署都从头
 * 开始**，规划器于是长期停在「没有证据 → 既不铺也不扫」这一支：决策要的是几天的尺度，
 * 账本住的却是几分钟的 heap。
 *
 * 所以热度分两层：heap 是**增量缓冲**（每拍写，零成本），Memory 上是**跨进程累计**（按窗口合并、
 * 带衰减）。本函数只做数字合并，不碰运行时全局，合并的时机与写回在 `systems/remote/road-planner`。
 *
 * 衰减是必需的而不是修饰：没有遗忘，几万次偶然路过会把整房的开阔地都加热成"证据"，
 * 回收器于是永远找不到它要回收的东西 —— 车道又被锁死，只是换了个锁法。
 */

export interface WalkHeatOptions {
  /** 每次合并对旧值乘的系数（0-1）—— 遗忘速率。 */
  decay: number;
  /** 低于此累计次数的格不入账（判「通勤真的走过」的下限）。 */
  minWalks: number;
  /** 条目上限 —— 只保留最热的 cap 格，防 Memory 无界生长。 */
  cap: number;
}

/**
 * 合并一个窗口的增量：`new = floor(old × decay) + delta`，过门槛才留，超上限截断。
 *
 * 返回新对象（不改 prev）：调用方把它写回 Memory，而 prev 可能还被人引用（同一 op 上的旧账）。
 */
export function mergeWalkHeat(
  prev: Readonly<Record<string, number>> | undefined,
  delta: Readonly<Record<string, number>> | undefined,
  options: WalkHeatOptions,
): Record<string, number> {
  const merged = new Map<string, number>();
  if (prev) {
    for (const [key, value] of Object.entries(prev)) {
      const decayed = Math.floor(value * options.decay);
      if (decayed > 0) merged.set(key, decayed);
    }
  }
  if (delta) {
    for (const [key, value] of Object.entries(delta)) {
      merged.set(key, (merged.get(key) ?? 0) + value);
    }
  }

  const hot: { key: string; walks: number }[] = [];
  for (const [key, walks] of merged) {
    if (walks >= options.minWalks) hot.push({ key, walks });
  }
  if (hot.length > options.cap) {
    // 同分按键定序：同一输入必须得同一份账，否则两次合并写出两份热度，观测端对不上。
    hot.sort((a, b) => b.walks - a.walks || a.key.localeCompare(b.key));
    hot.length = options.cap;
  }
  const result: Record<string, number> = {};
  for (const { key, walks } of hot) result[key] = walks;
  return result;
}
