import { describe, it, expect } from "vitest";
import {
  evaluateBottleneck,
  identifyBottlenecks,
  getTopBottleneck,
  DEFAULT_BOTTLENECK_OPTIONS,
} from "../../../src/domain/economy/bottleneck";
import { evaluateResourceHealth } from "../../../src/domain/economy/resource-health";
import {
  createResourceLedger,
  getOrCreateEntry,
  emptyStock,
} from "../../../src/domain/economy/resource-ledger";

describe("Bottleneck", () => {
  describe("evaluateBottleneck", () => {
    it("健康资源分数为 0（无瓶颈）", () => {
      const entry = { ...getOrCreateEntry(createResourceLedger(), "energy") };
      entry.stock = { ...emptyStock(), storage: 100000 };
      entry.productionRate = 10;
      entry.consumptionRate = 5;
      const health = evaluateResourceHealth(entry);
      const bn = evaluateBottleneck("energy", health);
      expect(bn.score).toBe(0);
    });

    it("critical 资源分数高", () => {
      const entry = { ...getOrCreateEntry(createResourceLedger(), "energy") };
      const health = evaluateResourceHealth(entry);
      const bn = evaluateBottleneck("energy", health);
      expect(bn.health).toBe("critical");
      expect(bn.score).toBeGreaterThan(0.5);
      expect(bn.critical).toBe(true);
    });

    it("关键资源加权", () => {
      const energyEntry = { ...getOrCreateEntry(createResourceLedger(), "energy") };
      const energyHealth = evaluateResourceHealth(energyEntry);
      const energyBn = evaluateBottleneck("energy", energyHealth);
      expect(energyBn.critical).toBe(true);

      const mineralEntry = { ...getOrCreateEntry(createResourceLedger(), "U" as never) };
      const mineralHealth = evaluateResourceHealth(mineralEntry);
      const mineralBn = evaluateBottleneck("U" as never, mineralHealth);
      expect(mineralBn.critical).toBe(false);
    });
  });

  describe("identifyBottlenecks", () => {
    it("返回排序的瓶颈列表", () => {
      const ledger = createResourceLedger();
      const energy = getOrCreateEntry(ledger, "energy");
      // energy: critical (no stock, no production)

      const mineral = getOrCreateEntry(ledger, "U" as never);
      mineral.stock = { ...emptyStock(), storage: 100000 };
      mineral.productionRate = 5;
      mineral.consumptionRate = 2;
      // mineral: healthy

      const list = identifyBottlenecks(ledger);
      expect(list.length).toBe(1); // only energy is bottleneck
      expect(list[0]!.resource).toBe("energy");
    });

    it("空 ledger 返回空列表", () => {
      const ledger = createResourceLedger();
      const list = identifyBottlenecks(ledger);
      expect(list).toEqual([]);
    });
  });

  describe("getTopBottleneck", () => {
    it("返回分数最高的瓶颈", () => {
      const ledger = createResourceLedger();
      const energy = getOrCreateEntry(ledger, "energy");
      const mineral = getOrCreateEntry(ledger, "U" as never);
      mineral.stock = { ...emptyStock(), storage: 50 };
      mineral.productionRate = 0;
      mineral.consumptionRate = 3;

      const top = getTopBottleneck(ledger);
      expect(top).toBeDefined();
      expect(top!.resource).toBe("energy"); // energy is critical = highest score
    });

    it("无瓶颈时返回 undefined", () => {
      const ledger = createResourceLedger();
      const energy = getOrCreateEntry(ledger, "energy");
      energy.stock = { ...emptyStock(), storage: 100000 };
      energy.productionRate = 10;
      energy.consumptionRate = 5;

      const top = getTopBottleneck(ledger);
      expect(top).toBeUndefined();
    });
  });
});
