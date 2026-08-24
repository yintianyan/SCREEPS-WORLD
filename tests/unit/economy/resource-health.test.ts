import { describe, it, expect } from "vitest";
import {
  evaluateResourceHealth,
  healthRank,
  isHealthProblematic,
  isHealthGood,
  DEFAULT_RESOURCE_HEALTH_OPTIONS,
} from "../../../src/domain/economy/resource-health";
import { emptyLedgerEntry, emptyStock, emptyCounters } from "../../../src/domain/economy/resource-ledger";
import { counterAdd } from "../../../src/domain/economy/resource-ledger";

describe("Resource Health", () => {
  describe("evaluateResourceHealth", () => {
    it("无储备无生产 = critical", () => {
      const entry = emptyLedgerEntry("energy");
      const result = evaluateResourceHealth(entry);
      expect(result.health).toBe("critical");
      expect(result.critical).toBe(true);
    });

    it("无储备有消费 = critical", () => {
      const entry = emptyLedgerEntry("energy");
      entry.productionRate = 0;
      entry.consumptionRate = 5;
      const result = evaluateResourceHealth(entry);
      expect(result.health).toBe("critical");
    });

    it("储备极低 + 入不敷出 = deficit", () => {
      const entry = emptyLedgerEntry("energy");
      entry.stock = { ...emptyStock(), storage: 50 };
      entry.productionRate = 2;
      entry.consumptionRate = 5;
      const result = evaluateResourceHealth(entry);
      expect(result.health).toBe("deficit");
    });

    it("净流为负 = degraded", () => {
      const entry = emptyLedgerEntry("energy");
      entry.stock = { ...emptyStock(), storage: 20000 };
      entry.productionRate = 5;
      entry.consumptionRate = 8;
      const result = evaluateResourceHealth(entry);
      expect(result.health).toBe("degraded");
    });

    it("储备充足 + 净流非负 = healthy", () => {
      const entry = emptyLedgerEntry("energy");
      entry.stock = { ...emptyStock(), storage: 100000 };
      entry.productionRate = 10;
      entry.consumptionRate = 5;
      const result = evaluateResourceHealth(entry);
      expect(result.health).toBe("healthy");
    });

    it("矿物默认非关键", () => {
      const entry = emptyLedgerEntry("U" as never);
      entry.stock = { ...emptyStock(), storage: 100 };
      const result = evaluateResourceHealth(entry);
      expect(result.critical).toBe(false);
    });
  });

  describe("healthRank", () => {
    it("critical = 0（最差）", () => {
      expect(healthRank("critical")).toBe(0);
    });
    it("healthy = 4（最好）", () => {
      expect(healthRank("healthy")).toBe(4);
    });
  });

  describe("isHealthProblematic", () => {
    it("critical/deficit/degraded = true", () => {
      expect(isHealthProblematic("critical")).toBe(true);
      expect(isHealthProblematic("deficit")).toBe(true);
      expect(isHealthProblematic("degraded")).toBe(true);
    });
    it("stable/healthy = false", () => {
      expect(isHealthProblematic("stable")).toBe(false);
      expect(isHealthProblematic("healthy")).toBe(false);
    });
  });

  describe("isHealthGood", () => {
    it("stable/healthy = true", () => {
      expect(isHealthGood("stable")).toBe(true);
      expect(isHealthGood("healthy")).toBe(true);
    });
    it("critical/deficit/degraded = false", () => {
      expect(isHealthGood("critical")).toBe(false);
      expect(isHealthGood("deficit")).toBe(false);
      expect(isHealthGood("degraded")).toBe(false);
    });
  });
});
