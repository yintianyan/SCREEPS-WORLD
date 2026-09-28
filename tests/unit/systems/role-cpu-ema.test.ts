/**
 * 角色 CPU 榜的平滑口径 —— 扩张那道「养得起多大规模」的判断必须有角色侧才结得平账，
 * 而角色侧此前只有环里的 top-3 可见（判「creep 逻辑吃多少」只能猜）。
 * 立案见 src/systems/telemetry-collector.ts 的 updateRoleCpuEma 注释。
 */
import { describe, expect, it } from "vitest";
import { updateRoleCpuEma } from "../../../src/systems/telemetry-collector";

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
