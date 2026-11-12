/** Phase A：资源流契约分类与阈值。 */
import { describe, expect, it } from "vitest";
import {
  classifyFlowResource,
  FLOW_RESOURCE_CLASSES,
  getResourceBufferCap,
  getResourceContract,
  RESOURCE_CONTRACTS,
} from "../../../src/domain/economy/resource-contract";
import { REACTIONS } from "../../../src/domain/industry/types";

describe("classifyFlowResource", () => {
  it("特殊资源映射到对应分类", () => {
    expect(classifyFlowResource("energy")).toBe("energy");
    expect(classifyFlowResource("battery")).toBe("battery");
    expect(classifyFlowResource("power")).toBe("power");
    expect(classifyFlowResource("ops")).toBe("ops");
    expect(classifyFlowResource("pixel")).toBe("pixel");
    expect(classifyFlowResource("credit")).toBe("credit");
    expect(classifyFlowResource("G")).toBe("ghodium");
  });

  it("基础矿物与化合物分类", () => {
    for (const mineral of ["H", "O", "U", "L", "K", "Z", "X"]) {
      expect(classifyFlowResource(mineral)).toBe("baseMineral");
    }
    expect(classifyFlowResource("GH2O")).toBe("compound");
    expect(classifyFlowResource("OH")).toBe("compound");
    expect(classifyFlowResource("XGH2O")).toBe("compound");
    // 反应表里的非 G 化合物都应归入 compound。
    for (const output of Object.keys(REACTIONS)) {
      if (output === "G") continue;
      expect(classifyFlowResource(output)).toBe("compound");
    }
  });

  it("raw commodity 与其它 commodity 分类", () => {
    for (const raw of ["silicon", "metal", "biomass", "mist"]) {
      expect(classifyFlowResource(raw)).toBe("rawCommodity");
    }
    expect(classifyFlowResource("utrium_bar")).toBe("commodity");
    expect(classifyFlowResource("wire")).toBe("commodity");
    // 未登记的新资源按 commodity 兜底，避免 undefined 契约。
    expect(classifyFlowResource("future_commodity")).toBe("commodity");
  });
});

describe("RESOURCE_CONTRACTS", () => {
  it("每个分类都有契约，且 flowClass 自洽", () => {
    for (const cls of FLOW_RESOURCE_CLASSES) {
      const contract = RESOURCE_CONTRACTS[cls];
      expect(contract).toBeDefined();
      expect(contract.flowClass).toBe(cls);
    }
  });

  it("energy：L0，50K/100K 水位，factory 硬上限 12.5K", () => {
    const contract = getResourceContract("energy");
    expect(contract.criticality).toBe("L0");
    expect(contract.lowWater).toBe(50000);
    expect(contract.highWater).toBe(100000);
    expect(contract.buffers.terminal?.soft).toBe(10000);
    expect(contract.buffers.factory?.hard).toBe(12500);
    expect(contract.exits[0]).toBe("local-consumption");
  });

  it("battery：L3，terminal 50K，总硬上限 150K", () => {
    const contract = getResourceContract("battery");
    expect(contract.criticality).toBe("L3");
    expect(contract.highWater).toBe(100000);
    expect(contract.hardCap).toBe(150000);
    expect(contract.buffers.terminal?.soft).toBe(50000);
    expect(getResourceBufferCap("battery", "terminal")?.soft).toBe(50000);
  });

  it("baseMineral / commodity 的上限与停止阀", () => {
    const mineral = getResourceContract("H");
    expect(mineral.lowWater).toBe(500);
    expect(mineral.highWater).toBe(10000);
    expect(mineral.stopValve).toContain("mineralMiner");

    const commodity = getResourceContract("wire");
    expect(commodity.highWater).toBe(30000);
    expect(commodity.hardCap).toBe(50000);
    expect(commodity.exits[0]).toBe("market-sell");
  });

  it("未登记位置返回 undefined", () => {
    expect(getResourceBufferCap("energy", "lab")).toBeUndefined();
  });
});
