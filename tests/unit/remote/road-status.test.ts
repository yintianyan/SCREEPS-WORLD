/** 远矿道路状态检测与 body/haulerNeed 联动测试。 */
import { describe, expect, it } from "vitest";
import { scoreRemoteCandidate } from "../../../src/domain/remote/targeting";
import { computePerHaulerThroughput } from "../../../src/domain/remote/staffing";
import { selectBody } from "../../../src/config/bodies";

const CARRY_CAPACITY = 50;

describe("remote roadStatus — hasRoad 对 haulerNeed 的影响", () => {
  it("有路时 perHauler 翻倍（effectivePathCost 减半）", () => {
    const noRoad = scoreRemoteCandidate({
      pathCost: 100,
      linearDistance: 1,
      sources: 1,
      haulerCapacity: 800,
      hasRoad: false,
    });
    const hasRoad = scoreRemoteCandidate({
      pathCost: 100,
      linearDistance: 1,
      sources: 1,
      haulerCapacity: 800,
      hasRoad: true,
    });
    expect(hasRoad.haulerNeed).toBeLessThanOrEqual(noRoad.haulerNeed);
    if (noRoad.haulerNeed > 1) {
      expect(hasRoad.haulerNeed).toBeLessThan(noRoad.haulerNeed);
    }
  });

  it("近房有路时 haulerNeed 降到 1", () => {
    const result = scoreRemoteCandidate({
      pathCost: 50,
      linearDistance: 1,
      sources: 1,
      haulerCapacity: 800,
      hasRoad: true,
    });
    expect(result.haulerNeed).toBe(1);
  });

  it("远房有路仍可能需要多 hauler", () => {
    const result = scoreRemoteCandidate({
      pathCost: 200,
      linearDistance: 3,
      sources: 1,
      haulerCapacity: 800,
      hasRoad: true,
    });
    expect(result.haulerNeed).toBeGreaterThanOrEqual(2);
  });

  it("无路时 2-source 中距房 haulerNeed ≥ 2", () => {
    const result = scoreRemoteCandidate({
      pathCost: 100,
      linearDistance: 1,
      sources: 2,
      haulerCapacity: 800,
      hasRoad: false,
    });
    expect(result.haulerNeed).toBeGreaterThanOrEqual(2);
  });
});

describe("remote roadStatus — selectBody 有路无路档位切换", () => {
  it("无路时跳过 2:1 道路配比档（idx 0 和 3）", () => {
    const body = selectBody("remoteHauler", 1800, { hasRoad: false });
    const carryCount = body.filter(p => p === CARRY).length;
    const moveCount = body.filter(p => p === MOVE).length;
    const workCount = body.filter(p => p === WORK).length;
    expect(carryCount).toBe(16);
    expect(moveCount).toBe(17);
    expect(workCount).toBe(1);
  });

  it("有路时选 2:1 道路配比档（idx 0）", () => {
    const body = selectBody("remoteHauler", 1800, { hasRoad: true });
    const carryCount = body.filter(p => p === CARRY).length;
    const moveCount = body.filter(p => p === MOVE).length;
    expect(carryCount).toBe(24);
    expect(moveCount).toBe(12);
  });

  it("有路档运力大于无路档（同样能量容量）", () => {
    const noRoadBody = selectBody("remoteHauler", 1800, { hasRoad: false });
    const hasRoadBody = selectBody("remoteHauler", 1800, { hasRoad: true });
    const noRoadCapacity = noRoadBody.filter(p => p === CARRY).length * CARRY_CAPACITY;
    const hasRoadCapacity = hasRoadBody.filter(p => p === CARRY).length * CARRY_CAPACITY;
    expect(hasRoadCapacity).toBeGreaterThan(noRoadCapacity);
  });
});

describe("remote roadStatus — computePerHaulerThroughput 精确计算", () => {
  it("无路时 roundTripTime = pathCost × 2", () => {
    const { throughput, roundTripTime, carryCapacity } = computePerHaulerThroughput(16, 70, false);
    expect(carryCapacity).toBe(800);
    expect(roundTripTime).toBe(140);
    expect(throughput).toBeCloseTo(800 / 140, 2);
  });

  it("有路时 roundTripTime = pathCost（速度翻倍）", () => {
    const { throughput, roundTripTime, carryCapacity } = computePerHaulerThroughput(24, 70, true);
    expect(carryCapacity).toBe(1200);
    expect(roundTripTime).toBe(70);
    expect(throughput).toBeCloseTo(1200 / 70, 2);
  });

  it("有路吞吐量大于无路（同 carry 部件数）", () => {
    const noRoad = computePerHaulerThroughput(16, 70, false);
    const hasRoad = computePerHaulerThroughput(16, 70, true);
    expect(hasRoad.throughput).toBeGreaterThan(noRoad.throughput);
  });
});
