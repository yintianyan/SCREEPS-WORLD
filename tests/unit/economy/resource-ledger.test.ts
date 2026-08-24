import { describe, it, expect } from "vitest";
import {
  emptyCounters,
  counterAdd,
  counterDelta,
  counterInflow,
  counterOutflow,
  counterNetFlow,
  emptyStock,
  stockTotal,
  stockReserve,
  rollupResourceWindow,
  resourceDriftLimit,
  isResourceDriftExcessive,
  updateProductionRateEma,
  emptyLedgerEntry,
  createResourceLedger,
  initResourceLedger,
  getOrCreateEntry,
  getActiveResources,
  computeTransferable,
  computeSurplus,
  computeDeficit,
  aggregateLedgers,
} from "../../../src/domain/economy/resource-ledger";

describe("Resource Ledger", () => {
  describe("ResourceCounters", () => {
    it("emptyCounters 返回全零", () => {
      const c = emptyCounters();
      expect(c.produced).toBe(0);
      expect(c.consumed).toBe(0);
      expect(c.imported).toBe(0);
      expect(c.exported).toBe(0);
      expect(c.bought).toBe(0);
      expect(c.sold).toBe(0);
      expect(c.lost).toBe(0);
    });

    it("counterAdd 正数累加", () => {
      const c = emptyCounters();
      counterAdd(c, "produced", 100);
      counterAdd(c, "consumed", 50);
      expect(c.produced).toBe(100);
      expect(c.consumed).toBe(50);
    });

    it("counterAdd 忽略负数和零", () => {
      const c = emptyCounters();
      counterAdd(c, "produced", -10);
      counterAdd(c, "produced", 0);
      expect(c.produced).toBe(0);
    });

    it("counterDelta 计算差值", () => {
      const start = emptyCounters();
      counterAdd(start, "produced", 100);
      const end = emptyCounters();
      counterAdd(end, "produced", 150);
      const delta = counterDelta(start, end);
      expect(delta.produced).toBe(50);
    });

    it("counterInflow = produced + imported + bought", () => {
      const c = emptyCounters();
      counterAdd(c, "produced", 100);
      counterAdd(c, "imported", 50);
      counterAdd(c, "bought", 25);
      expect(counterInflow(c)).toBe(175);
    });

    it("counterOutflow = consumed + exported + sold + lost", () => {
      const c = emptyCounters();
      counterAdd(c, "consumed", 80);
      counterAdd(c, "exported", 30);
      counterAdd(c, "sold", 10);
      counterAdd(c, "lost", 5);
      expect(counterOutflow(c)).toBe(125);
    });

    it("counterNetFlow = inflow - outflow", () => {
      const c = emptyCounters();
      counterAdd(c, "produced", 200);
      counterAdd(c, "consumed", 100);
      expect(counterNetFlow(c)).toBe(100);
    });
  });

  describe("ResourceStockSnapshot", () => {
    it("emptyStock 返回全零", () => {
      const s = emptyStock();
      expect(stockTotal(s)).toBe(0);
    });

    it("stockTotal 计算合计", () => {
      const s = { ...emptyStock(), storage: 1000, terminal: 500, containers: 200 };
      expect(stockTotal(s)).toBe(1700);
    });

    it("stockReserve = storage + terminal", () => {
      const s = { ...emptyStock(), storage: 1000, terminal: 500, containers: 200 };
      expect(stockReserve(s)).toBe(1500);
    });
  });

  describe("rollupResourceWindow", () => {
    it("drift 为零当账实一致", () => {
      const startCounters = emptyCounters();
      const endCounters = emptyCounters();
      counterAdd(endCounters, "produced", 100);
      counterAdd(endCounters, "consumed", 30);

      const startStock = { ...emptyStock(), storage: 1000 };
      const endStock = { ...emptyStock(), storage: 1070 }; // +100 - 30 = +70

      const w = rollupResourceWindow("energy", 0, 100, startCounters, endCounters, startStock, endStock);
      expect(w.drift).toBe(0);
      expect(w.inflow).toBe(100);
      expect(w.outflow).toBe(30);
      expect(w.netFlow).toBe(70);
      expect(w.productionRate).toBe(1); // 100/100
    });

    it("drift 非零当账实不一致", () => {
      const startCounters = emptyCounters();
      const endCounters = emptyCounters();
      counterAdd(endCounters, "produced", 100);

      const startStock = { ...emptyStock(), storage: 1000 };
      const endStock = { ...emptyStock(), storage: 1050 }; // 应为 1100，drift = -50

      const w = rollupResourceWindow("energy", 0, 100, startCounters, endCounters, startStock, endStock);
      expect(w.drift).toBe(-50);
    });
  });

  describe("drift 容差", () => {
    it("resourceDriftLimit = max(floor, throughput × ratio)", () => {
      const w = {
        resource: "energy" as const, t0: 0, t1: 100, ticks: 100,
        delta: emptyCounters(), inflow: 1000, outflow: 800, netFlow: 200,
        stockStart: 5000, stockEnd: 5200, drift: 0,
        productionRate: 10, consumptionRate: 8,
      };
      expect(resourceDriftLimit(w, 50, 0.05)).toBe(90); // max(50, 1800*0.05)
    });

    it("isResourceDriftExcessive 超容差时 true", () => {
      const w = {
        resource: "energy" as const, t0: 0, t1: 100, ticks: 100,
        delta: emptyCounters(), inflow: 1000, outflow: 800, netFlow: 200,
        stockStart: 5000, stockEnd: 5200, drift: 200,
        productionRate: 10, consumptionRate: 8,
      };
      expect(isResourceDriftExcessive(w, 50, 0.05)).toBe(true);
    });
  });

  describe("EMA 速率", () => {
    it("首窗直接取现值", () => {
      expect(updateProductionRateEma(undefined, 5.0, 0.1)).toBe(5.0);
    });

    it("后续窗口 EMA 平滑", () => {
      const prev = 10.0;
      const next = updateProductionRateEma(prev, 20.0, 0.1);
      expect(next).toBeCloseTo(11.0, 5); // 10 + 0.1*(20-10) = 11
    });
  });

  describe("ResourceLedger", () => {
    it("createResourceLedger 返回空 Map", () => {
      const ledger = createResourceLedger();
      expect(ledger.size).toBe(0);
    });

    it("initResourceLedger 预创建条目", () => {
      const ledger = initResourceLedger(["energy", "U" as never]);
      expect(ledger.size).toBe(2);
      expect(ledger.has("energy")).toBe(true);
    });

    it("getOrCreateEntry 不存在时创建", () => {
      const ledger = createResourceLedger();
      const entry = getOrCreateEntry(ledger, "energy");
      expect(entry.resource).toBe("energy");
      expect(ledger.has("energy")).toBe(true);
    });

    it("computeTransferable = reserve - reserved - safety", () => {
      const entry = emptyLedgerEntry("energy");
      entry.stock = { ...emptyStock(), storage: 10000, terminal: 5000 };
      entry.reserved = 2000;
      expect(computeTransferable(entry, 3000)).toBe(10000); // 15000 - 2000 - 3000
    });

    it("computeSurplus = transferable - demand", () => {
      const entry = emptyLedgerEntry("energy");
      entry.stock = { ...emptyStock(), storage: 10000, terminal: 5000 };
      entry.reserved = 2000;
      expect(computeSurplus(entry, 3000, 1000)).toBe(9000); // 10000 - 1000
    });

    it("computeDeficit = safety + consumption - reserve - inTransit", () => {
      const entry = emptyLedgerEntry("energy");
      entry.stock = { ...emptyStock(), storage: 1000 };
      entry.inTransit = 500;
      expect(computeDeficit(entry, 5000, 2000)).toBe(5500); // 5000 + 2000 - 1000 - 500
    });

    it("getActiveResources 只返回有存量或有流入的", () => {
      const ledger = createResourceLedger();
      const energyEntry = getOrCreateEntry(ledger, "energy");
      energyEntry.stock = { ...emptyStock(), storage: 1000 };

      const mineralEntry = getOrCreateEntry(ledger, "U" as never);
      // mineralEntry 无存量无流入

      const active = getActiveResources(ledger);
      expect(active).toContain("energy");
      expect(active).not.toContain("U");
    });
  });

  describe("aggregateLedgers", () => {
    it("聚合多个房间的账本", () => {
      const room1 = createResourceLedger();
      const e1 = getOrCreateEntry(room1, "energy");
      e1.stock = { ...emptyStock(), storage: 5000 };
      counterAdd(e1.counters, "produced", 1000);

      const room2 = createResourceLedger();
      const e2 = getOrCreateEntry(room2, "energy");
      e2.stock = { ...emptyStock(), storage: 3000 };
      counterAdd(e2.counters, "produced", 500);

      const empire = aggregateLedgers([room1, room2]);
      const empEntry = empire.get("energy")!;
      expect(empEntry.stock.storage).toBe(8000);
      expect(empEntry.counters.produced).toBe(1500);
    });
  });
});
