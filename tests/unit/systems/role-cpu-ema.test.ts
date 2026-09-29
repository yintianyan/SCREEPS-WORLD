/**
 * 角色 CPU 榜的平滑口径 —— 扩张那道「养得起多大规模」的判断必须有角色侧才结得平账，
 * 而角色侧此前只有环里的 top-3 可见（判「creep 逻辑吃多少」只能猜）。
 * 立案见 src/systems/telemetry-collector.ts 的 updateRoleCpuEma 注释。
 */
import { describe, expect, it } from "vitest";
import { updateRoleCpuEma, computeCpuRate } from "../../../src/systems/telemetry-collector";

describe("updateRoleCpuEma", () => {
  it("按 alpha 平滑，首轮从当前值起表", () => {
    expect(updateRoleCpuEma(undefined, { harvester: 2 })).toEqual({ harvester: 0.4 });
    const ema = updateRoleCpuEma({ harvester: 2 }, { harvester: 2 });
    expect(ema.harvester).toBeCloseTo(2, 4); // 稳定输入不会被拖低
  });

  it("消失的角色按 0 参与平滑并退出账本（不是把旧账永久挂在榜上）", () => {
    let ema = updateRoleCpuEma({ hauler: 1 }, {});
    for (let i = 0; i < 40; i++) ema = updateRoleCpuEma(ema, {});
    expect(ema.hauler).toBeUndefined();
    expect(ema).toEqual({});
  });

  it("新出现的角色与已有角色同表共存，互不遮蔽", () => {
    const ema = updateRoleCpuEma({ harvester: 1 }, { harvester: 1, upgrader: 3 });
    expect(ema.harvester).toBeCloseTo(1, 4);
    expect(ema.upgrader).toBeCloseTo(0.6, 4);
  });
});

describe("computeCpuRate", () => {
  it("速率 = 累计 ÷ 观测拍数，未归因剩余 = 总量 − 两份归因", () => {
    const r = computeCpuRate(
      { total: 1000, systems: { a: 600, b: 300 }, roles: { harvester: 50 } },
      100,
    );
    expect(r.windowTicks).toBe(100);
    expect(r.total).toBe(10);
    expect(r.unexplained).toBe(0.5);
    expect(r.bySystem.a).toBe(6);
    expect(r.byRole.harvester).toBe(0.5);
  });

  it("刚重启（窗口 0 拍）按 1 拍算，不产出 Infinity", () => {
    const r = computeCpuRate({ total: 3, systems: { a: 1 }, roles: {} }, 0);
    expect(r.windowTicks).toBe(1);
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.unexplained).toBe(2);
  });

  // 立案依据（线上）：同一进程里 `cpuRate.total=9.76/t`（1884 拍）而环上独立采样的
  // `cpuAvg10=12.7/t`，稳定差 ~2.9/t。用 `Game.time − boot` 当分母时，中途 CPU 触顶、
  // 没走到拍尾采样那一行的拍**白占分母却不进分子**，而那些恰恰是最贵的拍 ——
  // 于是这份"权威均值"永远朝"还有余量"的方向偏。
  it("分母用真正采到的拍数：没走到拍尾的拍不许白占分母", () => {
    // 200 拍窗口里只有 100 拍走到拍尾，采到 1000 CPU。
    const r = computeCpuRate(
      { total: 1000, systems: { a: 600, b: 300 }, roles: { harvester: 50 }, ticks: 100 },
      200,
    );
    expect(r.sampledTicks).toBe(100);
    expect(r.unsampledTicks).toBe(100); // 黑洞就摆在这里，不再被平均稀释掉
    expect(r.total).toBe(10); // 1000 ÷ 100，而不是 1000 ÷ 200 = 5
    expect(r.bySystem.a).toBe(6);
    expect(r.unexplained).toBe(0.5);
  });

  it("没有 ticks 计数时退回窗口分母，且把「未知」写成 0/-1 而不是冒充「没有黑洞」", () => {
    const r = computeCpuRate({ total: 1000, systems: { a: 1000 }, roles: {} }, 100);
    expect(r.total).toBe(10); // 与改动前逐字一致
    expect(r.sampledTicks).toBe(0); // 0 = 这个构建还没记 ticks
    expect(r.unsampledTicks).toBe(-1); // -1 = 未知，绝不是"一拍都没丢"
  });

  it("ticks 超出窗口（跨 reset 的脏计数）按窗口封顶，算不出负黑洞", () => {
    const r = computeCpuRate({ total: 100, systems: {}, roles: {}, ticks: 500 }, 100);
    expect(r.unsampledTicks).toBe(0);
    expect(r.total).toBe(0.2);
  });

  it("榜可以截断到前 10，但 total/unexplained 必须用全量（截断不能让账结不平）", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 25; i++) many[`s${i}`] = 10;
    const r = computeCpuRate({ total: 500, systems: many, roles: {} }, 10);
    expect(Object.keys(r.bySystem)).toHaveLength(10);
    expect(r.total).toBe(50);
    expect(r.unexplained).toBe(25);
  });

  it("相位账单独成桶：unphased 只减相位，不与系统/角色榜混算", () => {
    const r = computeCpuRate(
      { total: 100, systems: { a: 40 }, roles: { h: 10 }, phases: { systems: 60 } },
      10,
    );
    expect(r.unexplained).toBe(5); // (100 − 40 − 10) ÷ 10
    expect(r.unphased).toBe(4); // (100 − 60) ÷ 10：相位是嵌套跨度，不能再减一次榜
    expect(r.byPhase.systems).toBe(6);
  });

  it("拍尾差单独成桶：tail 是 unexplained 里「有名有姓」的那一段，不能再减一次", () => {
    const r = computeCpuRate({ total: 140, systems: { a: 40 }, roles: { h: 10 }, tail: 30 }, 10);
    expect(r.total).toBe(14);
    expect(r.unexplained).toBe(9); // 拍尾花费仍算在榜外剩余里，只是被认出来了
    expect(r.tail).toBe(3);
    expect(r.tail).toBeLessThanOrEqual(r.unexplained);
  });

  it("没有 tail（reset 后首拍/旧 heap 记录）按 0 计，不得污染 total", () => {
    const r = computeCpuRate({ total: 100, systems: {}, roles: {} }, 10);
    expect(r.tail).toBe(0);
    expect(r.total).toBe(10);
  });
});
