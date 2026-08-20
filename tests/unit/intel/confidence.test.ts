import { describe, expect, it } from "vitest";
import { getIntelConfidence } from "../../../src/domain/intel";

describe("getIntelConfidence — 情报时效分级 (P1-1)", () => {
  it("lastSeen 缺失返回 unknown", () => {
    expect(getIntelConfidence(undefined, 1000, 500, 2000)).toBe("unknown");
  });

  it("age <= freshTtl 返回 fresh", () => {
    expect(getIntelConfidence(600, 1000, 500, 2000)).toBe("fresh"); // age=400
    expect(getIntelConfidence(500, 1000, 500, 2000)).toBe("fresh"); // age=500 边界
    expect(getIntelConfidence(999, 1000, 500, 2000)).toBe("fresh"); // age=1
    expect(getIntelConfidence(1000, 1000, 500, 2000)).toBe("fresh"); // age=0 当 tick
  });

  it("freshTtl < age <= staleTtl 返回 stale", () => {
    expect(getIntelConfidence(499, 1000, 500, 2000)).toBe("stale"); // age=501
    expect(getIntelConfidence(0, 1000, 500, 2000)).toBe("stale"); // age=1000
    expect(getIntelConfidence(-1000, 1000, 500, 2000)).toBe("stale"); // age=2000 边界
  });

  it("age > staleTtl 返回 expired", () => {
    expect(getIntelConfidence(-1001, 1000, 500, 2000)).toBe("expired"); // age=2001
    expect(getIntelConfidence(0, 5000, 500, 2000)).toBe("expired"); // age=5000
  });

  it("不同消费方的典型 TTL 组合", () => {
    // 战争情报：极新鲜要求（freshTtl=500, staleTtl=1000）
    expect(getIntelConfidence(600, 1000, 500, 1000)).toBe("fresh");
    expect(getIntelConfidence(400, 1000, 500, 1000)).toBe("stale");
    expect(getIntelConfidence(-100, 1000, 500, 1000)).toBe("expired");

    // 远矿情报：容忍较旧（freshTtl=1000, staleTtl=3000）
    expect(getIntelConfidence(500, 1000, 1000, 3000)).toBe("fresh");
    expect(getIntelConfidence(-500, 1000, 1000, 3000)).toBe("stale");
    expect(getIntelConfidence(-2500, 1000, 1000, 3000)).toBe("expired");

    // 扩张评选：中等（freshTtl=500, staleTtl=2000）
    expect(getIntelConfidence(800, 1000, 500, 2000)).toBe("fresh");
    expect(getIntelConfidence(300, 1000, 500, 2000)).toBe("stale");
    expect(getIntelConfidence(-1500, 1000, 500, 2000)).toBe("expired");
  });
});
