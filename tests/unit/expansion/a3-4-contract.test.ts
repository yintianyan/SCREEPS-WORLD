/** Contract Tests — Colony Autonomy & Stability 合约测试。 */

import { describe, it, expect } from "vitest";
import {
  evaluateExpansionCooldown,
  DEFAULT_COOLDOWN_CONFIG,
} from "../../../src/domain/expansion/expansion-cooldown";

// ── 1. Autonomy Age ──────────────────────────────────────────

// ── 2. Stability Score ───────────────────────────────────────

// ── 3. Colony Failure Detection ─────────────────────────────

// ── 4. Expansion Cooldown & Rate Limit ──────────────────────

describe("Cooldown — 冷却窗口内阻止", () => {
  it("刚完成不允新扩张", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: 5000,
      activeExpansionCount: 0,
      currentTick: 8000,
      config: { cooldownTicks: 10000, maxConcurrentExpansions: 1 },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("cooldown");
    expect(result.remainingCooldown).toBe(7000);
  });

  it("冷却窗口过后允许", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: 5000,
      activeExpansionCount: 0,
      currentTick: 16000,
      config: { cooldownTicks: 10000, maxConcurrentExpansions: 1 },
    });
    expect(result.allowed).toBe(true);
    expect(result.blockedReason).toBeNull();
  });
});

describe("Cooldown — Rate Limit", () => {
  it("活跃扩张达上限不允新扩张", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: undefined,
      activeExpansionCount: 1,
      currentTick: 1000,
      config: { cooldownTicks: 10000, maxConcurrentExpansions: 1 },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("rate_limit");
  });

  it("无活跃扩张 + 无完成记录 → 允许", () => {
    const result = evaluateExpansionCooldown({
      lastCompletedTick: undefined,
      activeExpansionCount: 0,
      currentTick: 1000,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("Cooldown — 默认配置", () => {
  it("默认冷却 10000 tick", () => {
    expect(DEFAULT_COOLDOWN_CONFIG.cooldownTicks).toBe(10000);
  });

  it("默认并发上限 1", () => {
    expect(DEFAULT_COOLDOWN_CONFIG.maxConcurrentExpansions).toBe(1);
  });
});

// ── 5. Expansion ROI Tracker ────────────────────────────────

// ── 6. Colony Stability Dashboard ────────────────────────────

// ── 辅助函数 ─────────────────────────────────────────────────
