import { describe, it, expect } from "vitest";
import {
  getResourceDefinition,
  getResourceCategory,
  isTradable,
  isCriticalResource,
  defaultSafetyReserve,
  isMineral,
  isEnergy,
  getAllResourceTypes,
  getAllMineralTypes,
} from "../../../src/domain/economy/resource-definition";

describe("Resource Definition", () => {
  describe("getResourceDefinition", () => {
    it("energy 返回正确定义", () => {
      const def = getResourceDefinition("energy");
      expect(def.category).toBe("energy");
      expect(def.critical).toBe(true);
      expect(def.tradable).toBe(true);
      expect(def.stackable).toBe(true);
    });

    it("矿物返回正确定义", () => {
      const def = getResourceDefinition("U" as never);
      expect(def.category).toBe("mineral");
      expect(def.critical).toBe(false);
      expect(def.tradable).toBe(true);
    });
  });

  describe("isEnergy", () => {
    it("energy 返回 true", () => {
      expect(isEnergy("energy")).toBe(true);
    });
    it("矿物返回 false", () => {
      expect(isEnergy("U" as never)).toBe(false);
    });
  });

  describe("isMineral", () => {
    it("energy 返回 false", () => {
      expect(isMineral("energy")).toBe(false);
    });
    it("矿物返回 true", () => {
      expect(isMineral("L" as never)).toBe(true);
    });
  });

  describe("isCriticalResource", () => {
    it("energy 是关键资源", () => {
      expect(isCriticalResource("energy")).toBe(true);
    });
    it("矿物默认非关键", () => {
      expect(isCriticalResource("K" as never)).toBe(false);
    });
  });

  describe("defaultSafetyReserve", () => {
    it("energy 安全储备为 0（动态计算）", () => {
      expect(defaultSafetyReserve("energy")).toBe(0);
    });
    it("矿物安全储备为 1000", () => {
      expect(defaultSafetyReserve("Z" as never)).toBe(1000);
    });
  });

  describe("getAllResourceTypes", () => {
    it("包含 energy + 7 种矿物 = 8 种", () => {
      const types = getAllResourceTypes();
      expect(types).toContain("energy");
      expect(types.length).toBe(8);
    });
  });

  describe("getAllMineralTypes", () => {
    it("包含 7 种基础矿物", () => {
      const minerals = getAllMineralTypes();
      expect(minerals.length).toBe(7);
      expect(minerals).toContain("U");
      expect(minerals).toContain("L");
      expect(minerals).toContain("K");
      expect(minerals).toContain("Z");
      expect(minerals).toContain("O");
      expect(minerals).toContain("H");
      expect(minerals).toContain("X");
    });
  });

  describe("isTradable", () => {
    it("energy 可交易", () => {
      expect(isTradable("energy")).toBe(true);
    });
    it("矿物可交易", () => {
      expect(isTradable("O" as never)).toBe(true);
    });
  });
});
