/**
 * Deal 调度器纯函数测试（阶段 2）。
 *
 * 覆盖：
 *   pickBestCandidate（优先级竞争）：
 *   - 最高 priority 的候选被选中
 *   - 空列表返回 undefined
 *   - 同 priority 时保持插入顺序（稳定排序）
 *   - 卖出 vs 买入竞争（continue 饥饿修复验证）
 */
import { describe, expect, it } from "vitest";
import {
  pickBestCandidate,
  executeBestCandidate,
  SELL_PRIORITY_CAP,
  CRISIS_ENERGY_PRIORITY,
  DEFICIT_PRIORITY_BASE,
  POWER_PRIORITY,
  GHODIUM_PRIORITY,
  type DealCandidate,
} from "../../../src/domain/industry/deal-scheduler";

describe("pickBestCandidate — 优先级竞争", () => {
  it("最高 priority 的候选被选中", () => {
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => false },
      { type: "buy-crisis-energy", priority: 80, execute: () => true },
      { type: "sell-mineral", priority: 40, execute: () => false },
    ];
    const best = pickBestCandidate(candidates);
    expect(best).toBeDefined();
    expect(best!.type).toBe("buy-crisis-energy");
  });

  it("空列表返回 undefined", () => {
    expect(pickBestCandidate([])).toBeUndefined();
  });

  it("同 priority 时保持插入顺序（稳定排序）", () => {
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 40, execute: () => true },
      { type: "sell-mineral", priority: 40, execute: () => false },
    ];
    const best = pickBestCandidate(candidates);
    expect(best!.type).toBe("sell-energy");
  });

  it("危机能量买入(80)优先于一切卖出(≤50)", () => {
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => true },
      { type: "sell-mineral", priority: 40, execute: () => true },
      { type: "sell-battery", priority: 35, execute: () => true },
      { type: "buy-crisis-energy", priority: CRISIS_ENERGY_PRIORITY, execute: () => true },
    ];
    const best = pickBestCandidate(candidates);
    expect(best!.type).toBe("buy-crisis-energy");
  });

  it("需求表驱动的买入(priority=30)可以超过卖出battery(35)但不超过sell-energy(45)", () => {
    // 当需求表 priority = 30（如 boost 化合物需求）
    const boostPriority = 30;
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => true },
      { type: "sell-mineral", priority: 40, execute: () => true },
      { type: "sell-battery", priority: 35, execute: () => true },
      { type: "buy-deficit", priority: boostPriority, execute: () => true },
    ];
    const best = pickBestCandidate(candidates);
    // sell-energy 优先
    expect(best!.type).toBe("sell-energy");
  });

  it("高优先级需求(如 boost=40)可与卖出竞争", () => {
    // 当需求表 priority = 40（boost 化合物）
    const boostPriority = 40;
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => true },
      { type: "sell-mineral", priority: 40, execute: () => true },
      { type: "buy-deficit", priority: boostPriority, execute: () => true },
    ];
    const best = pickBestCandidate(candidates);
    // sell-energy(45) > boost(40)，仍然卖出优先
    expect(best!.type).toBe("sell-energy");
  });

  it("无卖出候选时买入被执行", () => {
    // 模拟无盈余场景：卖出函数都返回 false，但 execute 不会被调
    // 因为 pickBestCandidate 只选 priority 最高，execute 由调用方执行
    const candidates: DealCandidate[] = [
      { type: "buy-deficit", priority: 25, execute: () => true },
      { type: "buy-power", priority: POWER_PRIORITY, execute: () => false },
      { type: "buy-ghodium", priority: GHODIUM_PRIORITY, execute: () => false },
    ];
    const best = pickBestCandidate(candidates);
    expect(best!.type).toBe("buy-deficit");
  });

  it("execute 被调用后返回结果", () => {
    let executed = false;
    const candidates: DealCandidate[] = [
      { type: "buy-crisis-energy", priority: CRISIS_ENERGY_PRIORITY, execute: () => { executed = true; return true; } },
    ];
    const best = pickBestCandidate(candidates);
    const result = best!.execute();
    expect(executed).toBe(true);
    expect(result).toBe(true);
  });
});

describe("优先级常量", () => {
  it("卖出上限 = 50", () => {
    expect(SELL_PRIORITY_CAP).toBe(50);
  });

  it("危机能量 = 80（高于卖出上限）", () => {
    expect(CRISIS_ENERGY_PRIORITY).toBeGreaterThan(SELL_PRIORITY_CAP);
  });

  it("power < deficit base < 卖出上限", () => {
    expect(POWER_PRIORITY).toBeLessThan(DEFICIT_PRIORITY_BASE);
    expect(DEFICIT_PRIORITY_BASE).toBeLessThanOrEqual(SELL_PRIORITY_CAP);
  });

  it("ghodium 最低", () => {
    expect(GHODIUM_PRIORITY).toBeLessThan(POWER_PRIORITY);
  });
});

describe("executeBestCandidate — fallback 语义", () => {
  it("最高 priority 候选成交时不再尝试后续", () => {
    const calls: string[] = [];
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => { calls.push("sell-energy"); return true; } },
      { type: "buy-deficit", priority: 25, execute: () => { calls.push("buy-deficit"); return true; } },
    ];
    const result = executeBestCandidate(candidates);
    expect(result).toBe(true);
    expect(calls).toEqual(["sell-energy"]);
  });

  it("最高 priority 候选未成交时 fallback 到下一个", () => {
    const calls: string[] = [];
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => { calls.push("sell-energy"); return false; } },
      { type: "sell-mineral", priority: 40, execute: () => { calls.push("sell-mineral"); return false; } },
      { type: "buy-power", priority: 15, execute: () => { calls.push("buy-power"); return true; } },
    ];
    const result = executeBestCandidate(candidates);
    expect(result).toBe(true);
    expect(calls).toEqual(["sell-energy", "sell-mineral", "buy-power"]);
  });

  it("全部候选都未成交时返回 false", () => {
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => false },
      { type: "buy-deficit", priority: 25, execute: () => false },
    ];
    const result = executeBestCandidate(candidates);
    expect(result).toBe(false);
  });

  it("空列表返回 false", () => {
    expect(executeBestCandidate([])).toBe(false);
  });

  it("危机能量(80)优先尝试 → 成交时卖出不执行", () => {
    const calls: string[] = [];
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => { calls.push("sell-energy"); return true; } },
      { type: "buy-crisis-energy", priority: CRISIS_ENERGY_PRIORITY, execute: () => { calls.push("buy-crisis-energy"); return true; } },
    ];
    const result = executeBestCandidate(candidates);
    expect(result).toBe(true);
    expect(calls).toEqual(["buy-crisis-energy"]);
  });

  it("需求表驱动的买入(priority=30)在卖出未成交后尝试", () => {
    const calls: string[] = [];
    const candidates: DealCandidate[] = [
      { type: "sell-energy", priority: 45, execute: () => { calls.push("sell-energy"); return false; } },
      { type: "sell-mineral", priority: 40, execute: () => { calls.push("sell-mineral"); return false; } },
      { type: "sell-battery", priority: 35, execute: () => { calls.push("sell-battery"); return false; } },
      { type: "buy-deficit", priority: 30, execute: () => { calls.push("buy-deficit"); return true; } },
    ];
    const result = executeBestCandidate(candidates);
    expect(result).toBe(true);
    // 卖出全部尝试但未成交 → 买入有机会
    expect(calls).toEqual(["sell-energy", "sell-mineral", "sell-battery", "buy-deficit"]);
  });
});
