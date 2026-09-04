import { describe, expect, it } from "vitest";
import { applyIntakeGuardrail, type IntakePayload } from "../../../src/domain/tuning/intake-guardrail";

describe("intake-guardrail", () => {
  const basePayload: IntakePayload = {
    v: 1,
    t: 10000,
    exp: 50000,
    sug: [{ p: "posture.minDwell", v: 800, r: "LLM suggests raise" }],
  };

  const currentTick = 10000;
  const cooldownTicks = 5000;

  it("接受合法建议包", () => {
    const result = applyIntakeGuardrail(basePayload, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.param).toBe("posture.minDwell");
    expect(result.accepted[0]!.value).toBe(800);
    expect(result.accepted[0]!.source).toBe("l2-external");
    expect(result.rejected).toHaveLength(0);
  });

  it("schema 校验失败 → 整包拒绝", () => {
    const bad = { v: 1, t: 100, exp: 500, sug: "not-array" };
    const result = applyIntakeGuardrail(bad, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("schema");
  });

  it("payload 为 null → 整包拒绝", () => {
    const result = applyIntakeGuardrail(null, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("schema");
  });

  it("payload 为非对象 → 整包拒绝", () => {
    const result = applyIntakeGuardrail("hello", currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it("过期建议包 → 整包拒绝", () => {
    const expired: IntakePayload = { ...basePayload, exp: 5000 };
    const result = applyIntakeGuardrail(expired, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("expired");
  });

  it("陈旧建议包（age > 10000t）→ 整包拒绝", () => {
    const stale: IntakePayload = { ...basePayload, t: 0, exp: 999999, sug: [{ p: "posture.minDwell", v: 800, r: "stale" }] };
    const result = applyIntakeGuardrail(stale, currentTick + 1, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("stale");
  });

  it("白名单外参数 → 拒绝该条", () => {
    const payload: IntakePayload = {
      ...basePayload,
      sug: [{ p: "posture.nonexistent", v: 100, r: "test" }],
    };
    const result = applyIntakeGuardrail(payload, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toBe("not_in_whitelist");
  });

  it("值域超出 → 钳制后接受", () => {
    const payload: IntakePayload = {
      ...basePayload,
      sug: [{ p: "posture.minDwell", v: 999999, r: "way too high" }],
    };
    const result = applyIntakeGuardrail(payload, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.value).toBeLessThan(999999);
    expect(result.accepted[0]!.originalValue).toBe(999999);
  });

  it("参数在冷却期内 → 拒绝该条", () => {
    const overrides = {
      "posture.minDwell": { value: 600, adjustedAt: 7000, reason: "prev" },
    };
    // currentTick=10000, adjustedAt=7000, cooldown=5000 → 3000 < 5000 → 冷却中
    const result = applyIntakeGuardrail(basePayload, currentTick, overrides, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("cooldown");
  });

  it("参数冷却期已过 → 接受", () => {
    const overrides = {
      "posture.minDwell": { value: 600, adjustedAt: 4000, reason: "prev" },
    };
    // currentTick=10000, adjustedAt=4000, cooldown=5000 → 6000 >= 5000 → 冷却已过
    const result = applyIntakeGuardrail(basePayload, currentTick, overrides, cooldownTicks);
    expect(result.accepted).toHaveLength(1);
  });

  it("混合建议包：部分接受部分拒绝", () => {
    const payload: IntakePayload = {
      ...basePayload,
      sug: [
        { p: "posture.minDwell", v: 800, r: "ok" },
        { p: "posture.invalid", v: 100, r: "bad param" },
        { p: "posture.warPatience", v: 3000, r: "ok2" },
      ],
    };
    const result = applyIntakeGuardrail(payload, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });

  it("建议超过 5 条 → 只处理前 5 条", () => {
    const sug = [];
    for (let i = 0; i < 8; i++) {
      sug.push({ p: "posture.minDwell", v: 800 + i, r: `test ${i}` });
    }
    const payload: IntakePayload = { ...basePayload, sug };
    const result = applyIntakeGuardrail(payload, currentTick, undefined, cooldownTicks);
    // 第 1 条接受，后续 4 条因冷却被拒（同一参数反复建议），第 6-8 条不处理
    expect(result.accepted.length + result.rejected.length).toBeLessThanOrEqual(5);
  });

  it("理由添加 L2 前缀", () => {
    const result = applyIntakeGuardrail(basePayload, currentTick, undefined, cooldownTicks);
    expect(result.accepted[0]!.reason).toContain("[L2]");
  });

  it("空建议列表 → 全部接受", () => {
    const payload: IntakePayload = { ...basePayload, sug: [] };
    const result = applyIntakeGuardrail(payload, currentTick, undefined, cooldownTicks);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });
});
