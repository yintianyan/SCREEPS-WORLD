/** 采购需求纯函数测试（阶段 1）。 */
import { describe, expect, it } from "vitest";
import {
  collectDemands,
  expandReactionDemands,
  expandCommodityDemands,
  isBaseMineral,
  isIntermediateCompound,
  computeMaxBuyPrice,
  adjustMaxPrice,
} from "../../../src/domain/industry/procurement";
import type { ProcurementDemand } from "../../../src/kernel/global-cache";

// ─── collectDemands ───────────────────────────────────────

describe("collectDemands — 汇总/排序/去重/过期清理", () => {
  it("多房间同资源去重：取 max priority + max amount", () => {
    const byRoom: Record<string, ProcurementDemand[]> = {
      W1N1: [{ resource: "H", amount: 100, priority: 25, deadline: 500, reason: "lab-reaction" }],
      W2N2: [{ resource: "H", amount: 200, priority: 30, deadline: 500, reason: "lab-reaction" }],
    };
    const result = collectDemands(byRoom, 100);
    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("H");
    expect(result[0]!.amount).toBe(200); // max amount
    expect(result[0]!.priority).toBe(30); // max priority
    expect(result[0]!.reason).toBe("lab-reaction");
  });

  it("过期需求被清除", () => {
    const byRoom: Record<string, ProcurementDemand[]> = {
      W1N1: [
        { resource: "H", amount: 100, priority: 25, deadline: 50, reason: "lab-reaction" }, // 过期
        { resource: "O", amount: 200, priority: 30, deadline: 500, reason: "lab-reaction" }, // 有效
      ],
    };
    const result = collectDemands(byRoom, 100);
    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("O");
  });

  it("priority 降序排列", () => {
    const byRoom: Record<string, ProcurementDemand[]> = {
      W1N1: [
        { resource: "H", amount: 100, priority: 10, deadline: 500, reason: "low" },
        { resource: "O", amount: 200, priority: 40, deadline: 500, reason: "high" },
        { resource: "U", amount: 50, priority: 25, deadline: 500, reason: "mid" },
      ],
    };
    const result = collectDemands(byRoom, 100);
    expect(result.map(d => d.resource)).toEqual(["O", "U", "H"]);
  });

  it("amount ≤ 0 被过滤", () => {
    const byRoom: Record<string, ProcurementDemand[]> = {
      W1N1: [
        { resource: "H", amount: 0, priority: 30, deadline: 500, reason: "zero" },
        { resource: "O", amount: -10, priority: 40, deadline: 500, reason: "neg" },
        { resource: "U", amount: 50, priority: 25, deadline: 500, reason: "ok" },
      ],
    };
    const result = collectDemands(byRoom, 100);
    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("U");
  });

  it("空 byRoom 返回空数组", () => {
    const result = collectDemands({}, 100);
    expect(result).toEqual([]);
  });
});

// ─── expandReactionDemands ───────────────────────────────

describe("expandReactionDemands — 反应链原料缺口展开（含中间产物）", () => {
  it("基础矿物和中间产物都展开", () => {
    // 反应链：OH ← O + H
    const plan = {
      steps: [{ input1: "O" as const, input2: "H" as const, output: "OH" as const, amount: 300 }],
      target: "OH",
      targetAmount: 300,
    };
    const inventory = {}; // 完全空库存
    const result = expandReactionDemands(plan, inventory, 100, 250);
    // O 和 H 是基础矿，都是输入原料 → 都展开
    expect(result).toHaveLength(2);
    const resources = result.map(d => d.resource).sort();
    expect(resources).toEqual(["H", "O"]);
  });

  it("已有库存抵扣缺口", () => {
    const plan = {
      steps: [{ input1: "O" as const, input2: "H" as const, output: "OH" as const, amount: 300 }],
      target: "OH",
      targetAmount: 300,
    };
    const inventory = { H: 300, O: 100 }; // H 够了，O 缺 200
    const result = expandReactionDemands(plan, inventory, 100, 250);
    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("O");
    expect(result[0]!.amount).toBe(200);
  });

  it("库存充足时无需求", () => {
    const plan = {
      steps: [{ input1: "O" as const, input2: "H" as const, output: "OH" as const, amount: 300 }],
      target: "OH",
      targetAmount: 300,
    };
    const inventory = { H: 500, O: 500 };
    const result = expandReactionDemands(plan, inventory, 100, 250);
    expect(result).toHaveLength(0);
  });

  it("多步骤反应链展开各层基础矿和中间产物", () => {
    // G ← ZK + UL, ZK ← Z + K, UL ← U + L
    const plan = {
      steps: [
        { input1: "Z" as const, input2: "K" as const, output: "ZK" as const, amount: 300 },
        { input1: "U" as const, input2: "L" as const, output: "UL" as const, amount: 300 },
        { input1: "ZK" as const, input2: "UL" as const, output: "G" as const, amount: 300 },
      ],
      target: "G",
      targetAmount: 300,
    };
    const inventory = {};
    const result = expandReactionDemands(plan, inventory, 100, 250);
    // Z, K, U, L 是基础矿；ZK, UL 是中间产物（也是输入）→ 阶段 3 扩展后都展开。
    // G 是最终产物，不是任何 step 的输入 → 不展开。
    const resources = result.map(d => d.resource).sort();
    expect(resources).toEqual(["K", "L", "U", "UL", "Z", "ZK"]);
    expect(result.find(d => d.resource === "G")).toBeUndefined();
  });

  it("中间产物 priority=20（低于基础矿 25）", () => {
    const plan = {
      steps: [
        { input1: "Z" as const, input2: "K" as const, output: "ZK" as const, amount: 300 },
        { input1: "ZK" as const, input2: "UL" as const, output: "G" as const, amount: 300 },
      ],
      target: "G",
      targetAmount: 300,
    };
    const result = expandReactionDemands(plan, {}, 100, 250);
    const base = result.find(d => d.resource === "Z");
    const intermediate = result.find(d => d.resource === "ZK");
    expect(base!.priority).toBe(25);
    expect(intermediate!.priority).toBe(20);
  });

  it("deadline = tick + deadlineOffset", () => {
    const plan = {
      steps: [{ input1: "O" as const, input2: "H" as const, output: "OH" as const, amount: 300 }],
      target: "OH",
      targetAmount: 300,
    };
    const result = expandReactionDemands(plan, {}, 1000, 250);
    expect(result[0]!.deadline).toBe(1250);
  });
});

// ─── expandCommodityDemands ──────────────────────────────

describe("expandCommodityDemands — commodity 原料缺口展开", () => {
  it("energy 不买（走能量互济通道）", () => {
    const components = { U: 10, energy: 50 };
    const result = expandCommodityDemands("wire", components, {}, 100, 250);
    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("U");
    expect(result.find(d => d.resource === "energy")).toBeUndefined();
  });

  it("已有库存抵扣", () => {
    const components = { U: 10, Z: 20 };
    const inventory = { U: 5, Z: 20 };
    const result = expandCommodityDemands("wire", components, inventory, 100, 250);
    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("U");
    expect(result[0]!.amount).toBe(5);
  });

  it("全部充足时无需求", () => {
    const components = { U: 10, Z: 20 };
    const inventory = { U: 20, Z: 30 };
    const result = expandCommodityDemands("wire", components, inventory, 100, 250);
    expect(result).toHaveLength(0);
  });

  it("priority 为 12（非生存）", () => {
    const result = expandCommodityDemands("wire", { U: 10 }, {}, 100, 250);
    expect(result[0]!.priority).toBe(12);
  });

  it("reason = factory-commodity", () => {
    const result = expandCommodityDemands("wire", { U: 10 }, {}, 100, 250);
    expect(result[0]!.reason).toBe("factory-commodity");
  });
});

// ─── isBaseMineral / isIntermediateCompound ──────────────

describe("isBaseMineral", () => {
  it("基础矿返回 true", () => {
    expect(isBaseMineral("H")).toBe(true);
    expect(isBaseMineral("O")).toBe(true);
    expect(isBaseMineral("U")).toBe(true);
    expect(isBaseMineral("L")).toBe(true);
    expect(isBaseMineral("K")).toBe(true);
    expect(isBaseMineral("Z")).toBe(true);
    expect(isBaseMineral("X")).toBe(true);
  });

  it("非基础矿返回 false", () => {
    expect(isBaseMineral("OH")).toBe(false);
    expect(isBaseMineral("ZK")).toBe(false);
    expect(isBaseMineral("G")).toBe(false);
    expect(isBaseMineral("XGH2O")).toBe(false);
    expect(isBaseMineral("power")).toBe(false);
    expect(isBaseMineral("energy")).toBe(false);
  });
});

describe("isIntermediateCompound", () => {
  it("中间产物返回 true", () => {
    expect(isIntermediateCompound("OH")).toBe(true);
    expect(isIntermediateCompound("ZK")).toBe(true);
    expect(isIntermediateCompound("UL")).toBe(true);
    expect(isIntermediateCompound("G")).toBe(true);
  });

  it("非中间产物返回 false", () => {
    expect(isIntermediateCompound("H")).toBe(false);
    expect(isIntermediateCompound("X")).toBe(false);
    expect(isIntermediateCompound("XGH2O")).toBe(false);
    expect(isIntermediateCompound("UH")).toBe(false);
  });
});

// ─── computeMaxBuyPrice ───────────────────────────────────

describe("computeMaxBuyPrice — 价格分级", () => {
  const maxBuyPrice = { H: 1.5, O: 1.5, U: 1.5, L: 1.5, K: 1.5, Z: 1.5, X: 5 };

  it("基础矿直接用配置值", () => {
    expect(computeMaxBuyPrice("H", maxBuyPrice)).toBe(1.5);
    expect(computeMaxBuyPrice("X", maxBuyPrice)).toBe(5);
  });

  it("中间产物 = 最贵基础矿 × 2", () => {
    // 最贵 = X(5) × 2 = 10
    expect(computeMaxBuyPrice("OH", maxBuyPrice)).toBe(10);
    expect(computeMaxBuyPrice("ZK", maxBuyPrice)).toBe(10);
    expect(computeMaxBuyPrice("UL", maxBuyPrice)).toBe(10);
  });

  it("G 作为中间产物走 ×2 通道", () => {
    // G 在 INTERMEDIATE_COMPOUNDS 集合中
    expect(computeMaxBuyPrice("G", maxBuyPrice)).toBe(10);
  });

  it("T1+ 化合物 = 最贵基础矿 × 5", () => {
    // 最贵 = X(5) × 5 = 25
    expect(computeMaxBuyPrice("UH", maxBuyPrice)).toBe(25);
    expect(computeMaxBuyPrice("XGH2O", maxBuyPrice)).toBe(25);
    expect(computeMaxBuyPrice("GHO2", maxBuyPrice)).toBe(25);
  });

  it("配置中已有的资源直接查表（如 G 配了价格）", () => {
    const withG = { ...maxBuyPrice, G: 2.0 };
    expect(computeMaxBuyPrice("G", withG)).toBe(2.0);
  });
});

// ─── adjustMaxPrice（阶段 5：动态价格调整）─────────────────

describe("adjustMaxPrice — 优先级动态价格调整", () => {
  it("高优先级(≥30)上浮50%", () => {
    expect(adjustMaxPrice(10, 30)).toBe(15);
    expect(adjustMaxPrice(10, 40)).toBe(15);
    expect(adjustMaxPrice(10, 100)).toBe(15);
  });

  it("低优先级(<30)维持基准价格", () => {
    expect(adjustMaxPrice(10, 0)).toBe(10);
    expect(adjustMaxPrice(10, 12)).toBe(10);
    expect(adjustMaxPrice(10, 25)).toBe(10);
    expect(adjustMaxPrice(10, 29)).toBe(10);
  });

  it("边界：priority=30 触发上浮", () => {
    expect(adjustMaxPrice(10, 29)).toBe(10);
    expect(adjustMaxPrice(10, 30)).toBe(15);
  });

  it("与 computeMaxBuyPrice 组合 — 基础矿 boost 需求", () => {
    const maxBuyPrice = { H: 1.5, O: 1.5, U: 1.5, L: 1.5, K: 1.5, Z: 1.5, X: 5 };
    // 基础矿 H，boost 级 priority=35
    const base = computeMaxBuyPrice("H", maxBuyPrice);
    const adjusted = adjustMaxPrice(base, 35);
    expect(base).toBe(1.5);
    expect(adjusted).toBe(2.25); // 1.5 × 1.5
  });

  it("与 computeMaxBuyPrice 组合 — 化合物 commodity 需求不上浮", () => {
    const maxBuyPrice = { H: 1.5, O: 1.5, U: 1.5, L: 1.5, K: 1.5, Z: 1.5, X: 5 };
    // 化合物 XGH2O，commodity 级 priority=12
    const base = computeMaxBuyPrice("XGH2O", maxBuyPrice);
    const adjusted = adjustMaxPrice(base, 12);
    expect(base).toBe(25); // 5 × 5
    expect(adjusted).toBe(25); // 不上浮
  });

  it("零价格不放大", () => {
    expect(adjustMaxPrice(0, 50)).toBe(0);
  });
});
