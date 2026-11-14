/** 资源流状态（Phase A 接线）单测：库存差分、状态机落盘、读数新鲜度。 */
import { describe, expect, it } from "vitest";
import { diffResourceStocks } from "../../../src/domain/economy/resource-stock";
import {
  evaluateResourceFlows,
  readResourceFlowState,
  toResourceFlowMemory,
  RESOURCE_FLOW_MAX_AGE_TICKS,
  type ResourceFlowSample,
} from "../../../src/domain/economy/resource-flow-status";

function sample(overrides: Partial<ResourceFlowSample> & { resource: string }): ResourceFlowSample {
  return {
    stock: 0,
    inflowPerTick: 0,
    outflowPerTick: 0,
    elapsedTicks: 50,
    ...overrides,
  };
}

/** 评估 + 落盘一次窗口（与 economy 的调用顺序一致）。 */
function evaluateWindow(
  samples: ResourceFlowSample[],
  tick: number,
): ReturnType<typeof toResourceFlowMemory> {
  return toResourceFlowMemory(evaluateResourceFlows(samples), samples, tick, 50);
}

describe("diffResourceStocks — 相邻两窗库存差", () => {
  it("正增量折算为流入、负增量为流出", () => {
    const flows = diffResourceStocks({ energy: 1000 }, { energy: 1500 }, 50);
    expect(flows).toEqual([
      { resource: "energy", stock: 1500, inflowPerTick: 10, outflowPerTick: 0 },
    ]);
    expect(diffResourceStocks({ energy: 1500 }, { energy: 1000 }, 50)[0]).toEqual({
      resource: "energy",
      stock: 1000,
      inflowPerTick: 0,
      outflowPerTick: 10,
    });
  });

  it("持平读作零流量（同窗进出相抵 → 视为在流动）", () => {
    expect(diffResourceStocks({ energy: 1000 }, { energy: 1000 }, 50)[0]).toMatchObject({
      inflowPerTick: 0,
      outflowPerTick: 0,
    });
  });

  it("只存在于上一窗的资源按「归零」计入流出", () => {
    const flows = diffResourceStocks({ H: 500 }, {}, 50);
    expect(flows).toEqual([{ resource: "H", stock: 0, inflowPerTick: 0, outflowPerTick: 10 }]);
  });

  it("elapsedTicks 非法时按 1 拍兜底（防除零）", () => {
    expect(diffResourceStocks({ energy: 0 }, { energy: 10 }, 0)[0]!.inflowPerTick).toBe(10);
  });
});

describe("资源流状态机 → Memory 投影", () => {
  it("高水位 + 无流出：第 10 个 50 拍窗开始 stuck，计数跨窗累计", () => {
    // battery highWater=100000 / stuckTicksThreshold=500。
    // surplus 期间的 k 也必须落盘（否则下一窗从 0 重新累积，永远到不了阈值）。
    let memory = evaluateWindow(
      [sample({ resource: "battery", stock: 110_000, inflowPerTick: 20 })],
      1000,
    );
    expect(memory.r.battery).toMatchObject({ s: 3, k: 50, q: 110_000 });

    let stuckTicks = memory.r.battery!.k ?? 0;
    for (let window = 2; window <= 10; window++) {
      memory = evaluateWindow(
        [
          sample({
            resource: "battery",
            stock: 110_000,
            inflowPerTick: 20,
            previousStuckTicks: stuckTicks,
          }),
        ],
        1000 + window * 50,
      );
      stuckTicks = memory.r.battery!.k ?? 0;
      // 前 9 窗仍在累积（surplus），第 10 窗达到 500 拍阈值。
      expect(memory.r.battery!.s).toBe(window < 10 ? 3 : 4);
    }
    expect(memory.r.battery!.k).toBe(500);
    expect(readResourceFlowState(memory, "battery", 1500)).toBe("stuck");
  });

  it("低库存进入 critical，且不携带 stuck 计数", () => {
    const memory = evaluateWindow(
      [sample({ resource: "H", stock: 50, previousStuckTicks: 400 })],
      1000,
    );
    expect(memory.r.H).toMatchObject({ s: 0, q: 50 });
    expect(memory.r.H!.k).toBeUndefined();
  });

  it("disabled 资源（ops）不落盘，读取返回 undefined", () => {
    const memory = evaluateWindow([sample({ resource: "ops", stock: 5000 })], 1000);
    expect(memory.r.ops).toBeUndefined();
    expect(readResourceFlowState(memory, "ops", 1000)).toBeUndefined();
  });

  it("读数超龄（> 150 拍）⇒ 返回 undefined；恰好在窗口内仍有效", () => {
    const memory = evaluateWindow([sample({ resource: "battery", stock: 110_000 })], 1000);
    expect(
      readResourceFlowState(memory, "battery", 1000 + RESOURCE_FLOW_MAX_AGE_TICKS),
    ).toBeDefined();
    expect(
      readResourceFlowState(memory, "battery", 1001 + RESOURCE_FLOW_MAX_AGE_TICKS),
    ).toBeUndefined();
  });
});
