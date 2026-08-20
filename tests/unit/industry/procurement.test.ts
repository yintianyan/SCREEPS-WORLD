/**
 * 采购需求纯函数测试（阶段 1）。
 *
 * 覆盖：
 *   collectDemands（汇总/排序/去重/过期清理）：
 *   - 多房间同资源去重（取 max priority + max amount）
 *   - 过期需求清除
 *   - priority 降序排列
 *   - amount ≤ 0 过滤
 *
 *   expandReactionDemands（反应链原料展开）：
 *   - 只展开基础矿物（中间产物不买）
 *   - 已有库存抵扣
 *   - 无缺口的资源不出现
 *
 *   expandCommodityDemands（commodity 原料展开）：
 *   - energy 不买
 *   - 已有库存抵扣
 *   - 无缺口的资源不出现
 */
import { describe, expect, it } from "vitest";
import {
  collectDemands,
  expandReactionDemands,
  expandCommodityDemands,
  isBaseMineral,
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

describe("expandReactionDemands — 反应链基础矿物缺口展开", () => {
  it("只展开基础矿物（中间产物不买）", () => {
    // 反应链：OH ← O + H
    const plan = {
      steps: [{ input1: "O" as const, input2: "H" as const, output: "OH" as const, amount: 300 }],
      target: "OH",
      targetAmount: 300,
    };
    const inventory = {}; // 完全空库存
    const result = expandReactionDemands(plan, inventory, 100, 250);
    expect(result).toHaveLength(2);
    const resources = result.map(d => d.resource).sort();
    expect(resources).toEqual(["H", "O"]);
    // 不应该有 OH（中间产物）
    expect(result.find(d => d.resource === "OH")).toBeUndefined();
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

  it("多步骤反应链正确展开各层基础矿", () => {
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
    // Z, K, U, L 是基础矿物；ZK, UL, G 不是
    const resources = result.map(d => d.resource).sort();
    expect(resources).toEqual(["K", "L", "U", "Z"]);
    // ZK/UL/G 不应该出现（不是基础矿物）
    expect(result.find(d => d.resource === "ZK")).toBeUndefined();
    expect(result.find(d => d.resource === "UL")).toBeUndefined();
    expect(result.find(d => d.resource === "G")).toBeUndefined();
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

// ─── isBaseMineral ───────────────────────────────────────

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
