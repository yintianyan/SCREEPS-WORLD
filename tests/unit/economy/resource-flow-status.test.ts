/** Phase A：资源流量状态机（critical/deficit/healthy/surplus/stuck）。 */
import { describe, expect, it } from "vitest";
import {
  evaluateResourceFlow,
  evaluateResourceFlows,
} from "../../../src/domain/economy/resource-flow-status";

describe("evaluateResourceFlow", () => {
  it("energy：低于 crisis 线 → critical", () => {
    const result = evaluateResourceFlow({
      resource: "energy",
      stock: 1000,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(result.state).toBe("critical");
    expect(result.criticality).toBe("L0");
  });

  it("energy：低于低水位但高于 crisis → deficit", () => {
    const result = evaluateResourceFlow({
      resource: "energy",
      stock: 20000,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(result.state).toBe("deficit");
  });

  it("energy：水位区间内 → healthy", () => {
    const result = evaluateResourceFlow({
      resource: "energy",
      stock: 60000,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(result.state).toBe("healthy");
  });

  it("energy：超水位 + 净流入 + 零流出 → 先 surplus，累计到 500 tick 变 stuck", () => {
    const surplus = evaluateResourceFlow({
      resource: "energy",
      stock: 120000,
      inflowPerTick: 10,
      outflowPerTick: 0,
      previousStuckTicks: 0,
      elapsedTicks: 100,
    });
    expect(surplus.state).toBe("surplus");
    expect(surplus.stuckTicks).toBe(100);

    const stuck = evaluateResourceFlow({
      resource: "energy",
      stock: 120000,
      inflowPerTick: 10,
      outflowPerTick: 0,
      previousStuckTicks: 450,
      elapsedTicks: 100,
    });
    expect(stuck.state).toBe("stuck");
    expect(stuck.stuckTicks).toBe(550);
  });

  it("energy：有流出时视为仍在流动 → surplus，且 stuckTicks 归零", () => {
    const result = evaluateResourceFlow({
      resource: "energy",
      stock: 120000,
      inflowPerTick: 10,
      outflowPerTick: 5,
      previousStuckTicks: 450,
      elapsedTicks: 100,
    });
    expect(result.state).toBe("surplus");
    expect(result.stuckTicks).toBe(0);
    expect(result.stockTicks).toBe(24000);
  });

  it("battery：超过硬上限立即 stuck，不看流量方向", () => {
    const result = evaluateResourceFlow({
      resource: "battery",
      stock: 160000,
      inflowPerTick: 0,
      outflowPerTick: 10,
    });
    expect(result.state).toBe("stuck");
    expect(result.evidence).toContain("hardCap");
  });

  it("未启用契约（pixel）→ unknown", () => {
    const result = evaluateResourceFlow({
      resource: "pixel",
      stock: 100,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(result.state).toBe("unknown");
    expect(result.stockTicks).toBe(-1);
  });

  it("无流出时 stockTicks = -1", () => {
    const result = evaluateResourceFlow({
      resource: "energy",
      stock: 60000,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(result.stockTicks).toBe(-1);
  });

  it("基础矿物：0 → critical，300 → deficit，5000 → healthy", () => {
    const critical = evaluateResourceFlow({
      resource: "H",
      stock: 0,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(critical.state).toBe("critical");

    const deficit = evaluateResourceFlow({
      resource: "H",
      stock: 300,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(deficit.state).toBe("deficit");

    const healthy = evaluateResourceFlow({
      resource: "H",
      stock: 5000,
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
    expect(healthy.state).toBe("healthy");
  });

  it("批量评估保持输入顺序", () => {
    const results = evaluateResourceFlows([
      { resource: "energy", stock: 0, inflowPerTick: 0, outflowPerTick: 0 },
      { resource: "H", stock: 5000, inflowPerTick: 0, outflowPerTick: 0 },
    ]);
    expect(results.map(r => r.resource)).toEqual(["energy", "H"]);
    expect(results.map(r => r.state)).toEqual(["critical", "healthy"]);
  });
});
