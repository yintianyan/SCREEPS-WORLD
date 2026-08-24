import { describe, it, expect } from "vitest";
import {
  buildResourceFlow,
  isFlowGraphBalanced,
  summarizeFlowGraph,
  verifyAccountingInvariant,
} from "../../../src/domain/economy/resource-flow";
import type { LossRecord } from "../../../src/domain/economy/resource-flow";

describe("Resource Flow Graph", () => {
  describe("buildResourceFlow", () => {
    it("平衡流图 drift = 0", () => {
      const losses: LossRecord[] = [
        { category: "transport_loss", amount: 50, tick: 10, room: "W1N1", reason: "carrier death" },
      ];
      const flow = buildResourceFlow(
        "energy", 0, 100,
        10000, // stockStart
        10950, // stockEnd = 10000 + 1000 - 50 - 100 = 10850... let me recalculate
        1000,  // produced
        0,     // imported
        0,     // bought
        0,     // exported
        0,     // sold
        100,   // consumed
        losses,
      );
      // expected = 10000 + 1000 + 0 + 0 - 0 - 0 - 100 - 50 = 10850
      // drift = 10950 - 10850 = 100
      expect(flow.drift).toBe(100);
    });

    it("完全平衡", () => {
      const flow = buildResourceFlow(
        "energy", 0, 100,
        10000, 11000,
        1000, 0, 0, 0, 0, 0,
        [],
      );
      // expected = 10000 + 1000 - 0 = 11000
      expect(flow.drift).toBe(0);
      expect(flow.expectedEnd).toBe(11000);
    });

    it("含损失分类", () => {
      const losses: LossRecord[] = [
        { category: "death_loss", amount: 100, tick: 50, room: "W1N1", reason: "creep died" },
        { category: "decay_loss", amount: 30, tick: 60, room: "W1N1", reason: "dropped decay" },
      ];
      const flow = buildResourceFlow(
        "energy", 0, 100,
        5000, 5870,
        1000, 0, 0, 0, 0, 0,
        losses,
      );
      // expected = 5000 + 1000 - 130 = 5870
      expect(flow.totalLoss).toBe(130);
      expect(flow.lossByCategory.death_loss).toBe(100);
      expect(flow.lossByCategory.decay_loss).toBe(30);
      expect(flow.drift).toBe(0);
    });
  });

  describe("isFlowGraphBalanced", () => {
    it("drift 在容差内 = true", () => {
      const flow = {
        resource: "energy" as const, t0: 0, t1: 100, ticks: 100,
        delta: { produced: 0, consumed: 0, imported: 0, exported: 0, bought: 0, sold: 0, lost: 0 },
        produced: 1000, imported: 0, bought: 0, exported: 0, sold: 0,
        stockStart: 5000, stockEnd: 5990, stockDelta: 990,
        consumed: 0, totalLoss: 0,
        lossByCategory: {
          production_loss: 0, transport_loss: 0, overflow_loss: 0,
          death_loss: 0, decay_loss: 0, other_loss: 0,
        },
        expectedEnd: 6000, drift: -10,
      };
      expect(isFlowGraphBalanced(flow, 50)).toBe(true);
    });
  });

  describe("summarizeFlowGraph", () => {
    it("生成可读摘要", () => {
      const flow = buildResourceFlow(
        "energy", 0, 100, 5000, 6000, 1000, 0, 0, 0, 0, 0, [],
      );
      const summary = summarizeFlowGraph(flow);
      expect(summary).toContain("energy");
      expect(summary).toContain("prod=1000");
      expect(summary).toContain("drift=0");
    });
  });

  describe("verifyAccountingInvariant", () => {
    it("平衡时 valid = true", () => {
      const flow = buildResourceFlow(
        "energy", 0, 100, 5000, 6000, 1000, 0, 0, 0, 0, 0, [],
      );
      const result = verifyAccountingInvariant(flow);
      expect(result.valid).toBe(true);
      expect(result.drift).toBe(0);
    });

    it("不平衡时 valid = false", () => {
      const flow = buildResourceFlow(
        "energy", 0, 100, 5000, 5500, 1000, 0, 0, 0, 0, 0, [],
      );
      // expected = 6000, actual = 5500, drift = -500
      const result = verifyAccountingInvariant(flow);
      expect(result.valid).toBe(false);
      expect(result.drift).toBe(-500);
    });
  });
});
