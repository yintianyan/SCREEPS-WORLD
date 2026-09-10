/** 远矿道路状态检测与 body/haulerNeed 联动测试。 */
import { describe, expect, it } from "vitest";
import { scoreRemoteCandidate } from "../../../src/domain/remote/targeting";
import { computePerHaulerThroughput } from "../../../src/domain/remote/staffing";
import { selectBody } from "../../../src/config/bodies";

const CARRY_CAPACITY = 50;

describe("remote roadStatus — hasRoad 对 haulerNeed 的影响", () => {
  it("有路无路 haulerNeed 相同（道路不影响速度，只影响 body 配比选择）", () => {
    // 新模型：道路不改变 RTT（每 tick 最多 1 格），只影响 selectBody 选择
    // 2:1 配比（有路，更多 CARRY）或 1:1 配比（无路，平原满速）。
    // scoreRemoteCandidate 中 haulerCapacity 由调用方传入，hasRoad 不再折半 pathCost。
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
    // 同 haulerCapacity + 同 pathCost → 同 perHauler → 同 haulerNeed
    expect(hasRoad.haulerNeed).toBe(noRoad.haulerNeed);
  });

  it("近房 haulerNeed 降到 1-2", () => {
    // 新模型：pathCost=50, RTT=100, perHauler=800/100=8, demand=10 → ceil(10/8)=2
    // 旧模型错误地折半 pathCost → perHauler=16 → haulerNeed=1
    // 新模型正确：pathCost=50 的房间需要 2 只 hauler
    const result = scoreRemoteCandidate({
      pathCost: 50,
      linearDistance: 1,
      sources: 1,
      haulerCapacity: 800,
      hasRoad: true,
    });
    expect(result.haulerNeed).toBe(2);
  });

  it("远房仍可能需要多 hauler", () => {
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

  it("有路时 roundTripTime = pathCost × 2（道路不改变速度）", () => {
    // 新模型：道路不改变速度（每 tick 最多 1 格），RTT = pathCost × 2
    // 有路和无路的 RTT 相同；差异在 carryCapacity（有路可用 2:1 配比，更多 CARRY）
    const { throughput, roundTripTime, carryCapacity } = computePerHaulerThroughput(24, 70, true);
    expect(carryCapacity).toBe(1200);
    expect(roundTripTime).toBe(140); // pathCost × 2 = 70 × 2 = 140
    expect(throughput).toBeCloseTo(1200 / 140, 2);
  });

  it("有路无路同 carry 部件数时吞吐量相同", () => {
    // 新模型：道路不影响 RTT，只影响 body 选择（外部 selectBody）
    const noRoad = computePerHaulerThroughput(16, 70, false);
    const hasRoad = computePerHaulerThroughput(16, 70, true);
    expect(hasRoad.throughput).toBe(noRoad.throughput);
  });
});
