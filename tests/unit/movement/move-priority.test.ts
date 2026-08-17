/**
 * movePriorityFor 卡位升级测试（v33-R12）。
 *
 * 语义：连续 stuck（≥ stuckThreshold）时优先级临时抬到 stuckEscalation(70) —
 * 高于 anchorStation(60) 让锁死者有权推开站桩者，低于 anchorMiner(90)
 * （站桩矿工永不被挤）与 flee(100)（逃命最高）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { movePriorityFor } from "../../../src/creeps/movement/intent";
import { CONFIG } from "../../../src/config";
import { mockCreep, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

describe("movePriorityFor — 卡位升级", () => {
  it("未卡位：按 mode 定优先级", () => {
    expect(movePriorityFor(mockCreep({ mode: "work" }))).toBe(CONFIG.movement.trafficPriority.work);
    expect(movePriorityFor(mockCreep({ mode: "acquire" }))).toBe(CONFIG.movement.trafficPriority.acquire);
  });

  it("stuck 达阈值：acquire/work 升级到 stuckEscalation", () => {
    const c = mockCreep({ mode: "acquire" });
    c.memory.stuckTicks = CONFIG.kernel.stuckThreshold;
    expect(movePriorityFor(c)).toBe(CONFIG.movement.trafficPriority.stuckEscalation);

    const w = mockCreep({ mode: "work" });
    w.memory.stuckTicks = CONFIG.kernel.stuckThreshold + 1;
    expect(movePriorityFor(w)).toBe(CONFIG.movement.trafficPriority.stuckEscalation);
  });

  it("stuck 未达阈值：不升级", () => {
    const c = mockCreep({ mode: "acquire" });
    c.memory.stuckTicks = CONFIG.kernel.stuckThreshold - 1;
    expect(movePriorityFor(c)).toBe(CONFIG.movement.trafficPriority.acquire);
  });

  it("flee 不受升级影响（100 保持最高）；升级不超过 anchorMiner（矿工不被挤）", () => {
    const f = mockCreep({ mode: "flee" });
    f.memory.stuckTicks = 10;
    expect(movePriorityFor(f)).toBe(CONFIG.movement.trafficPriority.flee);

    const w = mockCreep({ mode: "work" });
    w.memory.stuckTicks = 10;
    expect(movePriorityFor(w)).toBeLessThan(CONFIG.movement.trafficPriority.anchorMiner);
    expect(movePriorityFor(w)).toBeGreaterThan(CONFIG.movement.trafficPriority.anchorStation);
  });
});
