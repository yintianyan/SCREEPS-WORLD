/** #179 修法 A —— 主环／post 环「预算尾丢」的聚合留痕。
 *
 * 为什么需要它：调度环在跑完一支系统后若预算耗尽就 `break`（kernel.ts 的两处
 * `isExhausted()`），而这条出口**故意不写 skipReason** —— 一次尾丢会让环里剩余
 * 全部系统整批不跑，逐系统记账会生成几十枚键，正是 `shouldRunSystem` 注释里
 * 警告的「skipHotspot 被淹没」那一类失败。后果＝这台机器唯一会「整批饿死」的
 * 通道在线上不可数：heap 的 systemLastRun 只存最后一次，看不见历史上的发作。
 *
 * 所以这里只记聚合标量：发生几拍、总共饿掉几个「本来该跑」的系统、最坏一趟几个、
 * 最后一次的拍号／车道／压垮预算的那一支。键数恒定，不随被跳系统数增长。
 */

export type TailDropLoop = "main" | "post";

export interface TailDropStat {
  /** 主环尾丢发生的拍数（自本次进程起，heap 计数，部署即清零）。 */
  mainTicks: number;
  /** 主环累计饿掉的「本拍该跑」系统数（上界口径见 countDueRemaining）。 */
  mainDueSkipped: number;
  postTicks: number;
  postDueSkipped: number;
  /** 最坏一趟饿掉的系统数——严重度，比总数更能指认「谁把预算吃光的下一位」。 */
  maxCut: number;
  lastCutTick: number;
  lastLoop: TailDropLoop | "";
  /** 压垮预算的那一支（尾丢发生前最后跑完的系统名）。 */
  lastCutSystem: string;
}

export function freshTailDropStat(): TailDropStat {
  return {
    mainTicks: 0,
    mainDueSkipped: 0,
    postTicks: 0,
    postDueSkipped: 0,
    maxCut: 0,
    lastCutTick: 0,
    lastLoop: "",
    lastCutSystem: "",
  };
}

/** 纯函数（可单测）：把一次尾丢并进计数器。cut<=0 ⇒ 什么都没被饿掉，整条不改写。 */
export function accumulateTailDrop(
  stat: TailDropStat,
  loop: TailDropLoop,
  cut: number,
  lastRan: string,
  tick: number,
): void {
  if (cut <= 0) return;
  if (loop === "main") {
    stat.mainTicks++;
    stat.mainDueSkipped += cut;
  } else {
    stat.postTicks++;
    stat.postDueSkipped += cut;
  }
  if (cut > stat.maxCut) stat.maxCut = cut;
  stat.lastCutTick = tick;
  stat.lastLoop = loop;
  stat.lastCutSystem = lastRan;
}

/** heap 侧的接线：计数器与 systemLastRun 同生命周期（都在 global reset 时清空）。 */
export function recordTailDrop(
  cache: { tailDrop?: TailDropStat },
  loop: TailDropLoop,
  cut: number,
  lastRan: string,
  tick: number,
): void {
  const stat = (cache.tailDrop ??= freshTailDropStat());
  accumulateTailDrop(stat, loop, cut, lastRan, tick);
}

/**
 * 尾丢那一拍还剩几个「本拍该跑」的系统。
 * 只过 interval 闸门（纯函数、零副作用），不调 canStart —— 后者的等价值需要
 * recoveryEligible 钩子，而那钩子读 Memory/快照，不该在让位路径上再花 CPU。
 * 因此口径是「本拍到期而未跑」的上界，不是「一定跑得成」的下界。
 */
export function countDueRemaining<T extends { name: string }>(
  remaining: readonly T[],
  isDue: (system: T) => boolean,
): number {
  let n = 0;
  for (const system of remaining) {
    if (isDue(system)) n++;
  }
  return n;
}
