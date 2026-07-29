/**
 * 邻居房情报测试（C2）。
 *
 * 覆盖：房名分类（SK/中心/公路/普通）、无视野与有视野两种情报扫描。
 */
import { describe, expect, it } from "vitest";
import { classifyRoomByName, scanNeighborIntel } from "../../../src/domain/intel";

describe("intel — classifyRoomByName 房名分类", () => {
  it("任一坐标 mod 10 == 0 → 公路房", () => {
    expect(classifyRoomByName("W10N4")).toBe("highway");
    expect(classifyRoomByName("E0S0")).toBe("highway");
    expect(classifyRoomByName("E3S10")).toBe("highway");
  });

  it("双坐标 mod 10 == 5 → 中心房", () => {
    expect(classifyRoomByName("W5N5")).toBe("center");
    expect(classifyRoomByName("E15S25")).toBe("center");
  });

  it("双坐标 mod 10 ∈ [4,6] 且非 (5,5) → source keeper 房", () => {
    expect(classifyRoomByName("W4N5")).toBe("sk");
    expect(classifyRoomByName("E4N6")).toBe("sk");
    expect(classifyRoomByName("E6S4")).toBe("sk");
  });

  it("其余 → 普通房（可 claim）", () => {
    expect(classifyRoomByName("W7N4")).toBe("normal");
    expect(classifyRoomByName("E3N6")).toBe("normal"); // 单坐标在 4-6 不算 SK
    expect(classifyRoomByName("W1N1")).toBe("normal");
  });

  it("畸形房名回退 normal，不抛错", () => {
    expect(classifyRoomByName("sim")).toBe("normal");
    expect(classifyRoomByName("")).toBe("normal");
  });
});

describe("intel — scanNeighborIntel 情报扫描", () => {
  it("无视野时只落 kind/status/lastSeen", () => {
    const intel = scanNeighborIntel("W4N5", "normal", 1000);
    expect(intel.kind).toBe("sk");
    expect(intel.status).toBe("normal");
    expect(intel.lastSeen).toBe(1000);
    expect(intel.sources).toBeUndefined();
    expect(intel.owner).toBeUndefined();
  });

  it("有视野时补 source 数 / 矿物 / 归属", () => {
    const intel = scanNeighborIntel("W7N3", "normal", 1000, {
      sources: 2,
      mineralType: "H",
      owner: "somePlayer",
    });
    expect(intel.kind).toBe("normal");
    expect(intel.sources).toBe(2);
    expect(intel.mineral).toBe("H");
    expect(intel.owner).toBe("somePlayer");
  });

  it("有视野但无主房间不记录 owner", () => {
    const intel = scanNeighborIntel("W7N3", "normal", 1000, { sources: 1 });
    expect(intel.sources).toBe(1);
    expect(intel.owner).toBeUndefined();
  });

  it("有视野且被预定时记录 reservedBy", () => {
    const intel = scanNeighborIntel("W7N3", "normal", 1000, {
      sources: 2,
      reservation: "enemyPlayer",
    });
    expect(intel.reservedBy).toBe("enemyPlayer");
  });

  it("有视野确认无预定 → 清除旧 reservedBy（预定已失效）", () => {
    const prev = scanNeighborIntel("W7N3", "normal", 1000, { sources: 2, reservation: "enemy" });
    const next = scanNeighborIntel("W7N3", "normal", 2000, { sources: 2 }, prev);
    expect(next.reservedBy).toBeUndefined();
  });

  it("无视野时沿用上次的 reservedBy（陈旧度由消费方判断）", () => {
    const prev = scanNeighborIntel("W7N3", "normal", 1000, { sources: 2, reservation: "enemy" });
    const next = scanNeighborIntel("W7N3", "normal", 2000, undefined, prev);
    expect(next.reservedBy).toBe("enemy");
  });
});
