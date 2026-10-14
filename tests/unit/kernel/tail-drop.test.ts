/** #179 修法 A —— 调度环「预算尾丢」的聚合留痕。
 * 两层：纯函数 accumulateTailDrop 的算术；以及**调用点**（runSystems 的尾 break 真的记账了）。
 * 调用点那几例是本案的要点：光测纯函数测不到「出口忘了接」这个失效方式。 */
import { beforeEach, describe, expect, it } from "vitest";
import { Kernel } from "../../../src/kernel/kernel";
import { Registry } from "../../../src/kernel/registry";
import { globalCache } from "../../../src/kernel/global-cache";
import { systemPhase } from "../../../src/kernel/phase";
import type { Priority, System } from "../../../src/kernel/contracts";
import { accumulateTailDrop, freshTailDropStat } from "../../../src/kernel/tail-drop";
import { resetGlobals } from "../../support/factories";

describe("accumulateTailDrop — 聚合算术", () => {
  it("一次主环尾丢：拍数＋1、饿掉数按 cut 累加、记下肇事者与拍号", () => {
    const s = freshTailDropStat();
    accumulateTailDrop(s, "main", 3, "economy", 1000);
    expect(s).toEqual({
      mainTicks: 1,
      mainDueSkipped: 3,
      postTicks: 0,
      postDueSkipped: 0,
      maxCut: 3,
      lastCutTick: 1000,
      lastLoop: "main",
      lastCutSystem: "economy",
    });
  });

  it("第二次更严重时 maxCut 抬、更轻时不降；last* 覆写", () => {
    const s = freshTailDropStat();
    accumulateTailDrop(s, "main", 5, "a", 10);
    accumulateTailDrop(s, "main", 2, "b", 20);
    expect(s.mainTicks).toBe(2);
    expect(s.mainDueSkipped).toBe(7);
    expect(s.maxCut).toBe(5);
    expect(s.lastCutSystem).toBe("b");
    expect(s.lastCutTick).toBe(20);
  });

  it("cut<=0（break 落在最后一支）＝什么都没饿掉，整条不改写", () => {
    const s = freshTailDropStat();
    accumulateTailDrop(s, "main", 0, "last", 99);
    expect(s).toEqual(freshTailDropStat());
  });

  it("post 车道单独计数，不污染 main", () => {
    const s = freshTailDropStat();
    accumulateTailDrop(s, "post", 4, "traffic", 500);
    expect(s.postTicks).toBe(1);
    expect(s.postDueSkipped).toBe(4);
    expect(s.mainTicks).toBe(0);
    expect(s.mainDueSkipped).toBe(0);
    expect(s.lastLoop).toBe("post");
  });

  it("键数恒定（这条出口的设计约束＝不许淹没 skipHotspot）", () => {
    const s = freshTailDropStat();
    const width = Object.keys(s).length;
    for (let i = 1; i <= 200; i++) accumulateTailDrop(s, i % 2 ? "main" : "post", i, `sys${i}`, i);
    expect(Object.keys(s).length).toBe(width);
    expect(s.mainTicks + s.postTicks).toBe(200);
  });
});

// ── 调用点：真跑 runSystems ────────────────────────────────────────────────

function sys(name: string, interval?: number): System {
  return {
    name,
    priority: 1 as Priority,
    phase: "main",
    ...(interval === undefined ? {} : { interval }),
    run: () => {},
  };
}

/** runs 计数由系统自己涨：isExhausted 直接读它，避免依赖 measuredRun 的 CPU 读数。 */
function makeCtx(runs: { n: number }, exhaustAfter: number, tick: number) {
  return {
    budget: {
      tier: "healthy",
      softLimit: 12,
      hardLimit: 20,
      canStart: () => true,
      isExhausted: () => runs.n >= exhaustAfter,
      spent: () => 0,
    },
    snapshots: () => [],
    tick,
  } as any;
}

function kernelWith(systems: System[]) {
  const reg = new Registry();
  for (const s of systems) reg.registerSystem(s);
  return new Kernel(reg);
}

beforeEach(() => {
  resetGlobals();
  // heap 上自建的那两张表跨用例存活（resetGlobals 不抹 globalCache 的可选字段）⇒ 显式清掉。
  // 否则聚合计数器会把上一条用例的账并进来看起来像"记多了"（roleCpuEma 同族事故）。
  delete (globalCache() as { tailDrop?: unknown }).tailDrop;
  delete (globalCache() as { skipBuffer?: unknown }).skipBuffer;
});

describe("runSystems 尾 break — 调用点真的记了账", () => {
  it("第 2 支跑完就耗尽 ⇒ mainTicks=1、饿掉＝余下 2 支、肇事者＝第 2 支", () => {
    const runs = { n: 0 };
    const s1 = sys("s1");
    const s2 = sys("s2");
    s2.run = () => {
      runs.n++;
    };
    s1.run = () => {
      runs.n++;
    };
    const s3 = sys("s3");
    const s4 = sys("s4");
    const kernel = kernelWith([s1, s2, s3, s4]);

    (kernel as any).runSystems(makeCtx(runs, 2, 100000));

    const td = globalCache().tailDrop!;
    expect(td.mainTicks).toBe(1);
    expect(td.mainDueSkipped).toBe(2);
    expect(td.maxCut).toBe(2);
    expect(td.lastLoop).toBe("main");
    expect(td.lastCutSystem).toBe("s2");
    expect(td.lastCutTick).toBe(100000);
  });

  it("尾丢不写 system/* 的 skipReason（逐系统记会淹没 skipHotspot——这条是守卫）", () => {
    const runs = { n: 0 };
    const a = sys("a");
    a.run = () => {
      runs.n++;
    };
    const b = sys("b");
    b.run = () => {
      runs.n++;
    };
    const kernel = kernelWith([a, b, sys("c"), sys("d"), sys("e")]);

    (kernel as any).runSystems(makeCtx(runs, 1, 100000));

    const buffer = (globalCache().skipBuffer ?? {}) as Record<string, number>;
    expect(Object.keys(buffer).filter(k => k.startsWith("system/"))).toEqual([]);
    expect(globalCache().tailDrop!.mainDueSkipped).toBe(4);
  });

  it("余下那几支本拍没到期（interval 闸）⇒ 不计进饿掉数", () => {
    const runs = { n: 0 };
    const gated = sys("gated", 100);
    // 挑一个「gated 不到期」的拍号：phase+1 ⇒ tick % 100 ≠ phase
    const tick = 100_000 + systemPhase("gated", 100) + 1;
    const a = sys("a");
    a.run = () => {
      runs.n++;
    };
    const kernel = kernelWith([a, gated]);

    (kernel as any).runSystems(makeCtx(runs, 1, tick));

    const td = globalCache().tailDrop;
    // 唯一剩下的系统没到期 ⇒ 没有任何东西被饿掉 ⇒ 不该出现 phantom 事件
    expect(td === undefined || td.mainTicks === 0).toBe(true);
  });

  it("预算全程够用 ⇒ 一份账都不记", () => {
    const runs = { n: 0 };
    const a = sys("a");
    a.run = () => {
      runs.n++;
    };
    const kernel = kernelWith([a, sys("b"), sys("c")]);

    (kernel as any).runSystems(makeCtx(runs, 999, 100000));

    expect(globalCache().tailDrop).toBeUndefined();
  });
});
