/** 扩张节奏自适应纯函数测试（R7b）。 */
import { describe, expect, it } from "vitest";
import {
  appendOutcome,
  DEFAULT_RHYTHM_OPTIONS,
  evaluateExpansionRhythm,
  type ExpansionOutcomeKind,
} from "../../../src/domain/expansion/rhythm";

const O = DEFAULT_RHYTHM_OPTIONS;

describe("evaluateExpansionRhythm — 连续失败暂停", () => {
  it("连续失败达阈值 → 暂停；未达 → 不暂停", () => {
    const r = evaluateExpansionRhythm(["stolen", "timeout", "lost"], O);
    expect(r.consecutiveFailures).toBe(3);
    expect(r.pauseTicks).toBe(O.pauseTicks);

    const r2 = evaluateExpansionRhythm(["success", "stolen", "timeout"], O);
    expect(r2.consecutiveFailures).toBe(2);
    expect(r2.pauseTicks).toBe(0);
  });

  it("成功打断连续失败计数", () => {
    const r = evaluateExpansionRhythm(["lost", "lost", "success", "timeout"], O);
    expect(r.consecutiveFailures).toBe(1);
  });
});

describe("evaluateExpansionRhythm — stolen 频发收紧门禁", () => {
  it("窗口内 ≥2 次 stolen → minSources=2", () => {
    const r = evaluateExpansionRhythm(
      ["success", "stolen", "success", "stolen"],
      O,
    );
    expect(r.minSources).toBe(2);
  });

  it("stolen 不足阈值 → 保持基线", () => {
    const r = evaluateExpansionRhythm(["stolen", "success", "success"], O);
    expect(r.minSources).toBe(1);
  });
});

describe("evaluateExpansionRhythm — 黑名单缩放", () => {
  it("窗口 ≥3 且成功率达标 → ×0.5", () => {
    const r = evaluateExpansionRhythm(
      ["success", "success", "timeout"],
      O,
    );
    expect(r.blacklistMultiplier).toBe(0.5);
  });

  it("窗口 ≥3 且零成功 → ×1.5", () => {
    const r = evaluateExpansionRhythm(["stolen", "timeout", "lost"], O);
    expect(r.blacklistMultiplier).toBe(1.5);
  });

  it("窗口不足 3 或混合 → ×1.0", () => {
    expect(evaluateExpansionRhythm(["success", "stolen"], O).blacklistMultiplier).toBe(1);
    expect(evaluateExpansionRhythm(["success", "timeout", "lost"], O).blacklistMultiplier).toBe(1);
  });
});

describe("appendOutcome — 有界 ring", () => {
  it("超长自动截断保留最新 ringSize 条", () => {
    const outcomes: ExpansionOutcomeKind[] = [];
    let ring = outcomes;
    for (const k of ["lost", "lost", "lost", "lost", "stolen", "stolen", "stolen", "stolen", "success", "success"] as ExpansionOutcomeKind[]) {
      ring = appendOutcome(ring, k, O.ringSize);
    }
    expect(ring).toHaveLength(O.ringSize);
    expect(ring[ring.length - 1]).toBe("success");
  });
});
