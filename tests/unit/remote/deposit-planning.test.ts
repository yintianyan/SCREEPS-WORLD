/** 远矿 deposit 派工规划（纯函数）单测。 */
import { describe, expect, it } from "vitest";
import {
  planDepositAssignments,
  type DepositHomeObservation,
  type DepositObservation,
} from "../../../src/domain/remote/deposit";

const home = (
  roomName: string,
  overrides: Partial<DepositHomeObservation> = {},
): DepositHomeObservation => ({
  roomName,
  spawnCount: 1,
  hasDepositSink: true,
  colonyState: "normal",
  ...overrides,
});

const deposit = (id: string, roomName: string, ticksToDecay = 10_000): DepositObservation => ({
  id,
  roomName,
  ticksToDecay,
});

/** 按房名字典序给固定距离：W1N1=1, W1N2=2, W1N3=3 …（仅为测试可读性）。 */
const distance = (a: string, b: string): number => {
  const order = ["W1N1", "W1N2", "W1N3"];
  return Math.abs(order.indexOf(a) - order.indexOf(b));
};

describe("planDepositAssignments — 正常路径", () => {
  it("为每个未占用的 deposit 选最近的有落点自有房", () => {
    const result = planDepositAssignments({
      deposits: [deposit("d1", "W1N3")],
      homes: [home("W1N1"), home("W1N2")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result).toEqual([{ depositId: "d1", depositRoom: "W1N3", home: "W1N2" }]);
  });

  it("距离相同时按房名字典序确定性选房", () => {
    const equalDistance = (): number => 2;
    const result = planDepositAssignments({
      deposits: [deposit("d1", "W9N9")],
      homes: [home("W1N2"), home("W1N1")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance: equalDistance,
    });
    expect(result[0]?.home).toBe("W1N1");
  });

  it("多 deposit 时按 id 序号分配，且每房不超过 maxPerHome", () => {
    const result = planDepositAssignments({
      deposits: [deposit("d2", "W1N2"), deposit("d1", "W1N2")],
      homes: [home("W1N1")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.depositId).toBe("d1");
  });

  it("派工携带资源类型（intel 无视野派工时靠它写 creep memory）", () => {
    const result = planDepositAssignments({
      deposits: [{ ...deposit("d1", "W1N2"), depositType: "biomass" }],
      homes: [home("W1N1")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result[0]?.depositType).toBe("biomass");
  });

  it("home 已有在役/在队采集者时不再向它派工，改选次近的房", () => {
    const result = planDepositAssignments({
      deposits: [deposit("d1", "W1N2")],
      homes: [home("W1N1"), home("W1N3")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      // W1N1 满编（距离最近），只能落到 W1N3。
      homeLoad: { W1N1: 1 },
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result[0]?.home).toBe("W1N3");
  });
});

describe("planDepositAssignments — 防重与边界", () => {
  it("存活或已排队的 deposit 不再派工", () => {
    const result = planDepositAssignments({
      deposits: [deposit("live", "W1N2"), deposit("pending", "W1N2"), deposit("free", "W1N2")],
      homes: [home("W1N1")],
      liveDepositIds: new Set(["live"]),
      pendingDepositIds: new Set(["pending"]),
      maxPerHome: 2,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result.map(a => a.depositId)).toEqual(["free"]);
  });

  it("寿命低于门槛的 deposit 跳过（采不回孵化与通勤成本）", () => {
    const result = planDepositAssignments({
      deposits: [deposit("short", "W1N2", 1499), deposit("enough", "W1N2", 1500)],
      homes: [home("W1N1")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result.map(a => a.depositId)).toEqual(["enough"]);
  });

  it("距离超上限的 home 不参选（寿命 1500 的采集者跨房往返有形成本）", () => {
    const result = planDepositAssignments({
      deposits: [deposit("far", "W1N3", 50_000)],
      homes: [home("W1N1")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 200,
      maxDistance: 1, // W1N1→W1N3 距离 2，超上限
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result).toEqual([]);
  });

  it("剩余寿命不足以覆盖「单程通勤 + 开工余量」的组合 → 跳过该 (deposit, home) 对", () => {
    // 距离 2：跑道需求 = 2×50 + 200 = 300。寿命 299 的跳过、300 的放行。
    const result = planDepositAssignments({
      deposits: [deposit("short-runway", "W1N2", 299), deposit("just-arrives", "W1N2", 300)],
      homes: [home("W1N1")],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 200,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result.map(a => a.depositId)).toEqual(["just-arrives"]);
  });

  it("无 spawn / 无落点 / 非 normal 的房都不是候选", () => {
    const result = planDepositAssignments({
      deposits: [deposit("d1", "W1N2")],
      homes: [
        home("W1N1", { spawnCount: 0 }),
        home("W1N2", { hasDepositSink: false }),
        home("W1N3", { colonyState: "recovery" }),
      ],
      liveDepositIds: new Set(),
      pendingDepositIds: new Set(),
      maxPerHome: 1,
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    });
    expect(result).toEqual([]);
  });

  it("空输入与 maxPerHome=0 都返回空数组", () => {
    const base = {
      deposits: [deposit("d1", "W1N2")],
      homes: [home("W1N1")],
      liveDepositIds: new Set<string>(),
      pendingDepositIds: new Set<string>(),
      minTicksToDecay: 1500,
      maxDistance: 4,
      travelTicksPerRoom: 50,
      arrivalRunwayTicks: 200,
      distance,
    };
    expect(planDepositAssignments({ ...base, deposits: [], maxPerHome: 1 })).toEqual([]);
    expect(planDepositAssignments({ ...base, homes: [], maxPerHome: 1 })).toEqual([]);
    expect(planDepositAssignments({ ...base, maxPerHome: 0 })).toEqual([]);
  });
});
