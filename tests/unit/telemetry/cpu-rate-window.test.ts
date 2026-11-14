/**
 * CPU 速率滑动窗口径单测。
 *
 * 立案：`g.cpuCumulative` 自进程启动累计，旧实现用 `computeCpuRate(cum, Game.time - boot)`
 * 读出的永远是「生涯均值」。容量闸据此判档后，早期高开销会把均值长期钉在
 * constrained 以上 —— 线上扩张被 G6 锁死，而同一时刻的真实负载早已回落。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  appendCpuRateSnapshot,
  buildCpuRateWindow,
  computeCpuRate,
  updateCpuRateWindow,
  CPU_RATE_WINDOW_TICKS,
} from "../../../src/systems/telemetry-collector";
import { globalCache } from "../../../src/kernel/global-cache";

function cum(
  total: number,
  ticks: number,
  systems: Record<string, number> = {},
  roles: Record<string, number> = {},
) {
  return { total, ticks, systems, roles };
}

/** 以 10 拍间隔持续采样，模拟遥测的实际节奏。 */
function snapshotsUpTo(endTick: number): ReturnType<typeof appendCpuRateSnapshot> {
  let snapshots = appendCpuRateSnapshot(undefined, cum(0, 0), 0);
  for (let tick = 10; tick <= endTick; tick += 10) {
    // 每拍 10 CPU、且每拍都走到拍尾：total 与 ticks 同步增长。
    snapshots = appendCpuRateSnapshot(snapshots, cum(tick * 10, tick), tick);
  }
  return snapshots;
}

describe("CPU 速率滑动窗", () => {
  it("窗口内均值取代进程寿命均值", () => {
    let snapshots = appendCpuRateSnapshot(undefined, cum(5000, 1000), 1000);
    const current = cum(11000, 1600);
    snapshots = appendCpuRateSnapshot(snapshots, current, 1600);

    const window = buildCpuRateWindow(current, snapshots, 1600);
    expect(window).toBeDefined();
    expect(window?.windowTicks).toBe(600);

    const rate = computeCpuRate(window!.cum, window!.windowTicks);
    expect(rate.total).toBe(10); // 6000 / 600
    expect(rate.sampledTicks).toBe(600);
    expect(rate.unsampledTicks).toBe(0);

    // 反面：寿命口径是 11000 / 1600 = 6.88，正是会把容量闸读松的旧行为。
    expect(computeCpuRate(current, 1600).total).toBe(6.88);
  });

  it("漏采的拍进入 unsampledTicks，且不被摊进每拍均值", () => {
    let snapshots = appendCpuRateSnapshot(undefined, cum(5000, 1000), 1000);
    // 600 拍跨度里只有 540 拍真正走到拍尾（其余 60 拍 CPU 触顶提前退出）。
    const current = cum(11000, 1540);
    snapshots = appendCpuRateSnapshot(snapshots, current, 1600);

    const window = buildCpuRateWindow(current, snapshots, 1600)!;
    const rate = computeCpuRate(window.cum, window.windowTicks);
    expect(rate.windowTicks).toBe(600);
    expect(rate.unsampledTicks).toBe(60);
    expect(rate.total).toBe(11.11); // 6000 / 540
  });

  it("少于两枚快照 ⇒ 窗未建立，返回 undefined（消费侧退回 avg10）", () => {
    expect(buildCpuRateWindow(cum(100, 10), undefined, 10)).toBeUndefined();
    expect(buildCpuRateWindow(cum(100, 10), [], 10)).toBeUndefined();
    const only = appendCpuRateSnapshot(undefined, cum(100, 10), 10);
    expect(buildCpuRateWindow(cum(100, 10), only, 10)).toBeUndefined();
  });

  it("同拍重复采样覆盖而非追加，旧于窗口的快照被裁掉", () => {
    let snapshots = appendCpuRateSnapshot(undefined, cum(100, 10), 10);
    snapshots = appendCpuRateSnapshot(snapshots, cum(110, 11), 10);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.total).toBe(110);

    for (let tick = 20; tick <= 700; tick += 10) {
      snapshots = appendCpuRateSnapshot(snapshots, cum(tick, tick), tick);
    }
    expect(snapshots[snapshots.length - 1]!.t).toBe(700);
    expect(snapshots[0]!.t).toBe(700 - CPU_RATE_WINDOW_TICKS);
    expect(snapshots).toHaveLength(CPU_RATE_WINDOW_TICKS / 10 + 1);
  });

  it("采样长期间断后丢弃过期基线，避免把长窗当成 600 拍", () => {
    let snapshots = appendCpuRateSnapshot(undefined, cum(100, 10), 10);
    snapshots = appendCpuRateSnapshot(snapshots, cum(2000, 200), 2000);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.t).toBe(2000);
  });

  it("明细归因同样按窗口做差，而不是携带寿命累计", () => {
    let snapshots = appendCpuRateSnapshot(
      undefined,
      cum(1000, 100, { spawn: 300 }, { hauler: 200 }),
      100,
    );
    const current = cum(1600, 160, { spawn: 480 }, { hauler: 320 });
    snapshots = appendCpuRateSnapshot(snapshots, current, 160);

    const window = buildCpuRateWindow(current, snapshots, 160)!;
    expect(window.cum.systems.spawn).toBe(180);
    expect(window.cum.roles.hauler).toBe(120);
  });

  it("满窗滚动时窗口速率保持稳定，不随时间漂移", () => {
    const snapshots = snapshotsUpTo(1200);
    // 最新快照在 1200，起点被裁到 600：跨度 600。
    expect(snapshots[0]!.t).toBe(600);
    const current = cum(1200 * 10, 1200);
    const window = buildCpuRateWindow(current, snapshots, 1200)!;
    expect(computeCpuRate(window.cum, window.windowTicks).total).toBe(10);
  });
});

/**
 * 新鲜度：cpuRate 的推进从「每 100 拍的 Memory 体积采样」迁到「每趟遥测（10 拍）」，
 * 并写入 `at` 采样拍，供 capacity 拒绝超龄读数。
 */
describe("updateCpuRateWindow — 每趟推进 + 采样时刻", () => {
  const g = globalCache() as ReturnType<typeof globalCache> & {
    cpuCumulative?: {
      total: number;
      ticks: number;
      systems: Record<string, number>;
      roles: Record<string, number>;
    };
    cpuRateSnapshots?: ReturnType<typeof appendCpuRateSnapshot>;
  };

  beforeEach(() => {
    (globalThis as unknown as { Memory: unknown }).Memory = {
      kernel: {
        stats: {
          lastSample: 0,
          cpuAvg10: 0,
          cpuMax10: 0,
          bucketMin10: 0,
          crisisCount: 0,
          tierTransitions: 0,
          errorHotspot: "",
          skipHotspot: "",
        },
      },
    };
    delete g.cpuCumulative;
    delete g.cpuRateSnapshots;
  });

  afterEach(() => {
    delete g.cpuCumulative;
    delete g.cpuRateSnapshots;
  });

  it("无累计账（kernel 尚未写入）时删除旧读数，避免消费侧读到上个进程的窗口", () => {
    const stats = (Memory as unknown as { kernel: { stats: { cpuRate?: unknown } } }).kernel.stats;
    stats.cpuRate = { windowTicks: 600, sampledTicks: 600, unsampledTicks: 0, total: 9 };
    updateCpuRateWindow(100);
    expect(stats.cpuRate).toBeUndefined();
  });

  it("首枚快照只建窗不产出读数；第二枚（10 拍后）产出带 at 的读数", () => {
    g.cpuCumulative = { total: 0, ticks: 0, systems: {}, roles: {} };
    updateCpuRateWindow(100);
    const stats = (Memory as unknown as { kernel: { stats: { cpuRate?: Record<string, number> } } })
      .kernel.stats;
    expect(stats.cpuRate).toBeUndefined();

    g.cpuCumulative = { total: 100, ticks: 10, systems: {}, roles: {} };
    updateCpuRateWindow(110);
    const rate = stats.cpuRate as unknown as {
      at: number;
      windowTicks: number;
      total: number;
      sampledTicks: number;
    };
    expect(rate.at).toBe(110);
    expect(rate.windowTicks).toBe(10);
    expect(rate.total).toBe(10);
    expect(rate.sampledTicks).toBe(10);
  });

  it("同一拍重复调用幂等（快照覆盖、不重复追加）", () => {
    g.cpuCumulative = { total: 0, ticks: 0, systems: {}, roles: {} };
    updateCpuRateWindow(100);
    g.cpuCumulative = { total: 100, ticks: 10, systems: {}, roles: {} };
    updateCpuRateWindow(110);
    updateCpuRateWindow(110);
    expect(g.cpuRateSnapshots).toHaveLength(2);
  });
});
