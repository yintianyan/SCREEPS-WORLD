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

  it("榜可以截断到前 10，但 total/unexplained 必须用全量（截断不能让账结不平）", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 25; i++) many[`s${i}`] = 10;
    const r = computeCpuRate({ total: 500, systems: many, roles: {} }, 10);
    expect(Object.keys(r.bySystem)).toHaveLength(10);
    expect(r.total).toBe(50);
    expect(r.unexplained).toBe(25);
  });
});
