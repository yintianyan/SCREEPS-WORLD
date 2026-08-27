/** A3-003: Resource Reservation 创建/消耗/释放 */
import { describe, expect, it } from "vitest";
import {
  createReservation,
  releaseReservation,
  heartbeatReservation,
  sweepExpired,
  sumReservationsByRoom,
  getReservationsByRoom,
  getReservation,
  reduceReservation,
  DEFAULT_RESERVATION_TTL,
  type ReservationTable,
} from "../../../src/domain/operation/reservation";

const TICK = 1000;

describe("A3-003/A3-004: Reservation CRUD", () => {
  it("创建预留并检索", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    expect(table.size).toBe(1);

    const entry = getReservation(table, "op-1");
    expect(entry).toBeDefined();
    expect(entry!.amount).toBe(2000);
    expect(entry!.sourceRoom).toBe("W1N1");
    expect(entry!.targetRoom).toBe("W2N1");
    expect(entry!.createdAt).toBe(TICK);
    expect(entry!.expiresAt).toBe(TICK + DEFAULT_RESERVATION_TTL);
  });

  it("释放预留", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    table = releaseReservation(table, "op-1");
    expect(table.size).toBe(0);
  });

  it("幂等释放（不存在时无操作）", () => {
    let table: ReservationTable = new Map();
    table = releaseReservation(table, "nonexistent");
    expect(table.size).toBe(0);
  });

  it("同 operationId 覆盖旧值", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    table = createReservation(table, "op-1", "W1N1", "W2N1", 3000, TICK + 10);
    expect(table.size).toBe(1);
    expect(getReservation(table, "op-1")!.amount).toBe(3000);
  });
});

describe("A3-004: TTL 过期自动清除（无 Phantom Reservation）", () => {
  it("过期预留被清扫", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK, 100);
    table = createReservation(table, "op-2", "W1N1", "W3N1", 1000, TICK, 500);

    // TICK + 150: op-1 过期（TTL=100），op-2 未过期（TTL=500）
    const result = sweepExpired(table, TICK + 150);
    expect(result.table.size).toBe(1);
    expect(result.expired).toContain("op-1");
    expect(getReservation(result.table, "op-2")).toBeDefined();
  });

  it("全部过期 → 空表", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK, 100);
    table = createReservation(table, "op-2", "W1N1", "W3N1", 1000, TICK, 100);
    const result = sweepExpired(table, TICK + 200);
    expect(result.table.size).toBe(0);
    expect(result.expired).toHaveLength(2);
  });

  it("无过期 → 不变", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK, 500);
    const result = sweepExpired(table, TICK + 100);
    expect(result.table.size).toBe(1);
    expect(result.expired).toHaveLength(0);
  });
});

describe("心跳续期", () => {
  it("heartbeat 延长 TTL", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK, 100);
    table = heartbeatReservation(table, "op-1", TICK + 50, 500);
    const entry = getReservation(table, "op-1");
    expect(entry!.expiresAt).toBe(TICK + 50 + 500);
    expect(entry!.lastHeartbeat).toBe(TICK + 50);
  });

  it("heartbeat 不存在时无操作", () => {
    let table: ReservationTable = new Map();
    const result = heartbeatReservation(table, "nonexistent", TICK + 50);
    expect(result.size).toBe(0);
  });
});

describe("部分消耗 + 释放", () => {
  it("reduceReservation 减少量", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    table = reduceReservation(table, "op-1", 500);
    expect(getReservation(table, "op-1")!.amount).toBe(1500);
  });

  it("reduceReservation 减至 0 时自动释放", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    table = reduceReservation(table, "op-1", 2000);
    expect(table.size).toBe(0);
  });

  it("reduceReservation 不存在时无操作", () => {
    let table: ReservationTable = new Map();
    const result = reduceReservation(table, "nonexistent", 500);
    expect(result.size).toBe(0);
  });
});

describe("sumReservationsByRoom + getReservationsByRoom", () => {
  it("按源房汇总预留量", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    table = createReservation(table, "op-2", "W1N1", "W3N1", 1000, TICK);
    table = createReservation(table, "op-3", "W2N1", "W3N1", 500, TICK);

    expect(sumReservationsByRoom(table, "W1N1")).toBe(3000);
    expect(sumReservationsByRoom(table, "W2N1")).toBe(500);
    expect(sumReservationsByRoom(table, "W3N1")).toBe(0);
  });

  it("按源房获取预留列表", () => {
    let table: ReservationTable = new Map();
    table = createReservation(table, "op-1", "W1N1", "W2N1", 2000, TICK);
    table = createReservation(table, "op-2", "W1N1", "W3N1", 1000, TICK);

    const list = getReservationsByRoom(table, "W1N1");
    expect(list).toHaveLength(2);
  });
});
