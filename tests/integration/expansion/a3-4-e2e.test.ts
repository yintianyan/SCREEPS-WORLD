/** E2E Tests — Colony Autonomy & Stability 端到端测试。 */

import { describe, it, expect } from "vitest";
import {
  evaluateExpansionCooldown,
  DEFAULT_COOLDOWN_CONFIG,
} from "../../../src/domain/expansion/expansion-cooldown";

// ── E2E-001: Colony Autonomy 完整链路 ─────────────────────

// ── E2E-002: Colony Failure Recovery ───────────────────────

// ── E2E-003: Expansion Cooldown ────────────────────────────

describe("Expansion Cooldown 完整链路", () => {
  it("完成后冷却窗口内阻止新扩张，窗口过后允许", () => {
    // 1. 扩张在 tick=5000 完成
    const completedTick = 5000;

    // 2. tick=8000 在冷却窗口内
    const blocked = evaluateExpansionCooldown({
      lastCompletedTick: completedTick,
      activeExpansionCount: 0,
      currentTick: 8000,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedReason).toBe("cooldown");
    expect(blocked.remainingCooldown).toBe(7000);

    // 3. tick=15001 冷却已过
    const allowed = evaluateExpansionCooldown({
      lastCompletedTick: completedTick,
      activeExpansionCount: 0,
      currentTick: 15001,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.blockedReason).toBeNull();

    // 4. 即便冷却已过，如果有活跃扩张也不允许
    const blockedByRate = evaluateExpansionCooldown({
      lastCompletedTick: completedTick,
      activeExpansionCount: 1,
      currentTick: 20000,
      config: DEFAULT_COOLDOWN_CONFIG,
    });
    expect(blockedByRate.allowed).toBe(false);
    expect(blockedByRate.blockedReason).toBe("rate_limit");
  });
});

// ── E2E-004: Expansion ROI ────────────────────────────────

// ── E2E-005: Bootstrap 防重门禁 ───────────────────────────
