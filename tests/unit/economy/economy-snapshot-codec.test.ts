/** 瘦快照 codec 对称性 — 写端乘数与读端除数共享同一张缩放表，漂移即红。 */
import { describe, expect, it } from "vitest";
import {
  ECONOMY_SNAPSHOT_SCALE,
  fromMemorySnapshot,
  toMemorySnapshot,
} from "../../../src/domain/economy/accounting";
import {
  EMPIRE_ECONOMY_SCALE,
  HEALTH_CODES,
  HEALTH_NAMES_BY_CODE,
} from "../../../src/domain/economy/empire-snapshot";

describe("RoomMemory.economy 瘦快照 codec", () => {
  it("写端乘数 × 缩放表 → 读端除数还原原值（roundtrip）", () => {
    const snap = toMemorySnapshot(
      1000,
      11.85,
      123456,
      321.5,
      -7,
      88.8,
      0.97,
      undefined,
      undefined,
      12.34,
    );
    expect(snap.nf).toBe(1185);
    expect(snap.nf / ECONOMY_SNAPSHOT_SCALE.nf).toBeCloseTo(11.85, 10);
    expect(snap.rb / ECONOMY_SNAPSHOT_SCALE.rb).toBeCloseTo(321.5, 10);
    expect(snap.ei / ECONOMY_SNAPSHOT_SCALE.ei).toBeCloseTo(88.8, 10);
    expect(snap.ef / ECONOMY_SNAPSHOT_SCALE.ef).toBeCloseTo(0.97, 10);
    expect((snap.cx ?? 0) / ECONOMY_SNAPSHOT_SCALE.cx).toBeCloseTo(12.34, 10);
  });

  it("cx 零值缺键：读侧回退 0，语义=无资本支出而非没测到", () => {
    const snap = toMemorySnapshot(1000, 1, 2, 3, 4, 5, 6, undefined, undefined, 0);
    expect(snap.cx).toBeUndefined();
    expect((snap.cx ?? 0) / ECONOMY_SNAPSHOT_SCALE.cx).toBe(0);
  });

  it("fromMemorySnapshot 恢复 nf/ef（含负值）", () => {
    const snap = toMemorySnapshot(1000, -3.75, 0, 0, 0, 0, 0.86);
    const restored = fromMemorySnapshot(snap);
    expect(restored.netFlowEma).toBeCloseTo(-3.75, 10);
    expect(restored.effFactor).toBeCloseTo(0.86, 10);
    expect(fromMemorySnapshot(undefined).netFlowEma).toBeUndefined();
  });
});

describe("empireEconomy 瘦快照 codec", () => {
  it("缩放表覆盖全部 ×1 以外字段", () => {
    expect(EMPIRE_ECONOMY_SCALE.tp).toBe(10);
    expect(EMPIRE_ECONOMY_SCALE.nf).toBe(100);
    expect(EMPIRE_ECONOMY_SCALE.rb).toBe(10);
    expect(EMPIRE_ECONOMY_SCALE.ef).toBe(100);
    expect(EMPIRE_ECONOMY_SCALE.sm).toBe(100);
  });

  it("健康度码表：写端对象与读端反查数组逐项一致", () => {
    expect(HEALTH_CODES.critical).toBe(0);
    expect(HEALTH_NAMES_BY_CODE[0]).toBe("critical");
    expect(HEALTH_NAMES_BY_CODE[4]).toBe("healthy");
    for (const [name, code] of Object.entries(HEALTH_CODES)) {
      expect(HEALTH_NAMES_BY_CODE[code]).toBe(name);
    }
  });
});
