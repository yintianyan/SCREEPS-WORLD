/**
 * Observer 请求账本（#100 的仪器）—— 每条分支都必须有**被跑过**的写者。
 *
 * 立案理由（线上）：`room-observer` 的 observer 分支原先被 `snapshot.observer &&` 挡在最外层，
 * 于是「楼不存在」「楼在但选不出目标」「楼在但引擎回 ERR_*」三种形状在现有仪器上完全同形
 * （都表现为"什么都不发生"），四源取证全空（R307/R308）⇒ 「给选靶加权重」与「先盖楼」两个动作
 * 无法区分。本文件不测算术，测的是**接线**：每个桶各由一条真实分支写出，且自洽式
 * `ok === captured + lostVision + staleSlot` 在真实调用序列上成立。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roomObserverSystem } from "../../../src/systems/room-observer";
import { observeCounters } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../support/factories";
import type { TickContext } from "../../../src/kernel/contracts";

const g = (): any => globalThis as any;

/**
 * 125 是特意选的：`%OBSERVE_INTERVAL(25)===0` 但 `%INTEL_SCAN_INTERVAL(50)!==0`
 * ⇒ 用例只走进 observer 调度，不牵扯 refreshNeighborIntel/backfillPathCost 的 fixture。
 */
const DUE_TICK = 125;
const NEXT_TICK = 126;

function ctxAt(tick: number, opts: { observer?: { observeRoom: ReturnType<typeof vi.fn> } }): any {
  return {
    tick,
    snapshots: () => [{ roomName: "W7N4", observer: opts.observer }],
    getSnapshot: () => undefined,
    budget: { canStart: () => true, isExhausted: () => false, spent: () => 0, tier: "healthy" },
  } as unknown as TickContext;
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  g().observeLedger = undefined; // heap 账本跨用例必须清，否则计数串味
  g().__observePending = undefined;
  g().Memory.rooms["W7N4"] = {}; // run() 对无 Memory 的房直接 continue
});

describe("observeCounters — room-observer 的每条分支都有写者（#100 的接线证明）", () => {
  it("到点但没有 Observer 楼 → gate++ 且 noObserver++（这一列>0 就是「楼不在」的正面读数）", () => {
    roomObserverSystem.run(ctxAt(DUE_TICK, {}));
    const c = observeCounters("W7N4");
    expect(c.gate).toBe(1);
    expect(c.noObserver).toBe(1);
    expect(c.ok).toBe(0);
  });

  it("没到点 → 整条分支不计数（分母只数真正轮到观察的拍）", () => {
    roomObserverSystem.run(ctxAt(127, { observer: { observeRoom: vi.fn(() => OK) } }));
    const c = observeCounters("W7N4");
    expect(c.gate).toBe(0);
    expect(c.ok).toBe(0);
  });

  it("有楼且引擎 OK → ok++ 并登记待捕获；下一 tick 无视野则 lostVision++（自洽式在真实序列上成立）", () => {
    const observeRoom = vi.fn(() => OK);
    roomObserverSystem.run(ctxAt(DUE_TICK, { observer: { observeRoom } }));
    expect(observeRoom).toHaveBeenCalledTimes(1);
    expect(observeCounters("W7N4").ok).toBe(1);

    // 第二拍：resetGlobals 会重建 Game，但账本/待捕获槽由本用例保留 ⇒ 走捕获侧。
    roomObserverSystem.run(ctxAt(NEXT_TICK, {}));
    const c = observeCounters("W7N4");
    // Game.rooms 里没有目标房 ⇒ 视野没落下来。
    expect(c.lostVision).toBe(1);
    expect(c.captured).toBe(0);
    expect(c.staleSlot).toBe(0);
    // 仪器自己的谎警器：左端有写者、右端必须闭合。
    expect(c.ok).toBe(c.captured + c.lostVision + c.staleSlot);
  });

  it("引擎回非 OK 码 → 按原始码建直方图、ok 不涨（ERR_RCL_NOT_ENOUGH 与 ERR_NOT_IN_RANGE 在这里可分）", () => {
    const observeRoom = vi.fn(() => -15);
    roomObserverSystem.run(ctxAt(DUE_TICK, { observer: { observeRoom } }));
    const c = observeCounters("W7N4");
    expect(c.ok).toBe(0);
    expect(c.codes["-15"]).toBe(1);
    expect(c.noObserver).toBe(0);
  });

  it("describeExits 拿不到出口 → noTarget++ 且不发请求", () => {
    g().Game.map.describeExits = () => null;
    const observeRoom = vi.fn(() => OK);
    roomObserverSystem.run(ctxAt(DUE_TICK, { observer: { observeRoom } }));
    const c = observeCounters("W7N4");
    expect(c.noTarget).toBe(1);
    expect(observeRoom).not.toHaveBeenCalled();
  });

  it("待捕获槽的 tick 不是上一拍 → staleSlot++（系统被拒/错位，与「视野没来」是两种病）", () => {
    const observeRoom = vi.fn(() => OK);
    roomObserverSystem.run(ctxAt(DUE_TICK, { observer: { observeRoom } }));
    expect(observeCounters("W7N4").ok).toBe(1);
    // 跳过一拍（127 不是 125+1）⇒ 槽过期归因到 staleSlot。
    roomObserverSystem.run(ctxAt(127, {}));
    const c = observeCounters("W7N4");
    expect(c.staleSlot).toBe(1);
    expect(c.lostVision).toBe(0);
    expect(c.ok).toBe(c.captured + c.lostVision + c.staleSlot);
  });

  it("账本按房分桶 —— 两口自有房不能记在同一行上", () => {
    g().Memory.rooms["W7N5"] = {};
    roomObserverSystem.run({
      tick: DUE_TICK,
      snapshots: () => [
        { roomName: "W7N4", observer: undefined },
        { roomName: "W7N5", observer: undefined },
      ],
    } as unknown as TickContext);
    expect(observeCounters("W7N4").noObserver).toBe(1);
    expect(observeCounters("W7N5").noObserver).toBe(1);
    expect(Object.keys(g().observeLedger).sort()).toEqual(["W7N4", "W7N5"]);
  });
});
