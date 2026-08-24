/**
 * A3-020: Carrier Full Chain — 完整链路集成测试
 *
 * 验证跨房调拨的完整执行骨架：
 *   Operation 创建 → ready → running (carrier spawn 提交)
 *   → carrier 到达 target → 卸能 → verifyTransfer
 *   → 部分送达 → verifying → 全量送达 → completed
 *   → reservation 释放 → 归档
 *
 * 同时验证失败恢复链路：
 *   blocked → retryFromBlocked → ready → running
 *   → maxRetries → failed → reservation 释放
 */
import { describe, expect, it } from "vitest";
import {
  createOperation,
  makeOperationId,
  isActive,
  isTerminalStatus,
  type OperationContext,
} from "../../../src/domain/operation/agenda-item";
import {
  markReady,
  markRunning,
  markVerifying,
  markCompleted,
  markBlocked,
  markFailed,
  retryFromBlocked,
  checkExpiry,
  reportDelivery,
} from "../../../src/domain/operation/lifecycle";
import {
  createReservation,
  releaseReservation,
  getReservation,
  sumReservationsByRoom,
  type ReservationTable,
} from "../../../src/domain/operation/reservation";
import {
  verifyTransfer,
  shouldAbortVerification,
  shouldPartialComplete,
} from "../../../src/domain/operation/verification";
import { hasActiveOperation, pruneTerminal } from "../../../src/domain/operation/dedup";
import { computeTransferable } from "../../../src/domain/economy/ownership";
import type { RoomEconomicProfile } from "../../../src/domain/economy/room-profile";

const TICK = 1000;
const DEADLINE = TICK + 2000;

function makeProfile(overrides: Partial<RoomEconomicProfile> = {}): RoomEconomicProfile {
  return {
    roomName: "W1N1",
    rcl: 6,
    hasSpawn: true,
    hasStorage: true,
    hasTerminal: false,
    netFlow: 10,
    contractReserve: 5000,
    riskBuffer: 1000,
    estimatedIncome: 15,
    efficiency: 0.8,
    drift: 0,
    economyTick: TICK,
    storageEnergy: 200000,
    storageCapacity: 300000,
    storageRatio: 200000 / 300000,
    energyAvailable: 300,
    energyCapacityAvailable: 1300,
    storageNearFull: false,
    sourceCount: 2,
    colonyPhase: "growth",
    colonyState: "normal",
    economyPressure: 0.2,
    lastHostileAt: undefined,
    hasLiveThreat: false,
    controllerDowngradeRisk: false,
    claimSecure: false,
    economicClass: "core",
    netFlowPositive: true,
    selfSufficiency: 0.8,
    isStruggling: false,
    ...overrides,
  } as RoomEconomicProfile;
}

describe("A3-020: Carrier Full Chain — 完整链路", () => {
  describe("成功链路: Operation → Spawn → Carrier → Deliver → Verify → Complete", () => {
    it("完整成功链路", () => {
      // 1. 创建 Operation
      let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, DEADLINE, TICK);
      expect(op.status).toBe("planned");

      // 2. planned → ready
      let result = markReady(op, TICK);
      expect(result.ok).toBe(true);
      op = result.op;
      expect(op.status).toBe("ready");

      // 3. 创建 Reservation
      let table = createReservation(new Map(), op.id, "W1N1", "W2N1", 2000, TICK);
      expect(getReservation(table, op.id)).toBeDefined();
      expect(sumReservationsByRoom(table, "W1N1")).toBe(2000);

      // 4. ready → running (记录 baseline)
      op = markRunning(op, TICK).op;
      op.baselineEnergy = 10000; // target storage baseline
      expect(op.status).toBe("running");

      // 5. Carrier 到达 target 并卸能 — 模拟第一趟 1000 能量
      const firstDelivery = 1000;
      const currentAfterFirst = 10000 + firstDelivery;
      const verify1 = verifyTransfer(op, currentAfterFirst, op.baselineEnergy, TICK + 100);
      expect(verify1.actualDelta).toBe(firstDelivery);
      expect(verify1.verified).toBe(false); // 部分送达

      // 6. 部分送达 → reportDelivery + markVerifying
      op = reportDelivery(op, firstDelivery, TICK + 100);
      expect(op.deliveredAmount).toBe(firstDelivery);
      op = markVerifying(op, TICK + 100).op;
      expect(op.status).toBe("verifying");

      // 7. 第二趟送达剩余 1000
      const secondDelivery = 1000;
      const currentAfterSecond = currentAfterFirst + secondDelivery;
      const verify2 = verifyTransfer(op, currentAfterSecond, op.baselineEnergy!, TICK + 200);
      expect(verify2.actualDelta).toBe(firstDelivery + secondDelivery);
      expect(verify2.verified).toBe(true);

      // 8. verifying → completed
      op = markCompleted(op, TICK + 200).op;
      op = reportDelivery(op, secondDelivery, TICK + 200);
      expect(op.status).toBe("completed");
      expect(op.deliveredAmount).toBe(2000);

      // 9. 释放 Reservation
      table = releaseReservation(table, op.id);
      expect(getReservation(table, op.id)).toBeUndefined();
      expect(sumReservationsByRoom(table, "W1N1")).toBe(0);

      // 10. 归档
      expect(isTerminalStatus(op.status)).toBe(true);
      const pruned = pruneTerminal([op]);
      expect(pruned).toHaveLength(0);
    });

    it("baseline 正确记录并用于验证", () => {
      let op = createOperation("W1N1", "W2N1", "energy", 5000, 1, DEADLINE, TICK);
      op = markReady(op, TICK).op;
      op = markRunning(op, TICK).op;

      // 记录 baseline = target storage 当前的能量
      const baseline = 50000;
      op.baselineEnergy = baseline;

      // carrier 送达 3000
      const current = baseline + 3000;
      const verify = verifyTransfer(op, current, baseline, TICK + 100);
      expect(verify.actualDelta).toBe(3000);
      expect(verify.verified).toBe(false);

      // 送达完整 5000
      const currentFull = baseline + 5000;
      const verifyFull = verifyTransfer(op, currentFull, baseline, TICK + 200);
      expect(verifyFull.verified).toBe(true);
    });

    it("carrierName 关联到 Operation", () => {
      let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, DEADLINE, TICK);
      op = markReady(op, TICK).op;
      op = markRunning(op, TICK).op;

      // 模拟 carrier 孵化成功后记录 carrierName
      op.carrierName = "carrier_supply:W1N1:W2N1:energy_0";
      expect(op.carrierName).toContain("carrier_");
    });
  });

  describe("失败恢复链路: blocked → retry → ready → running", () => {
    it("blocked → retryFromBlocked → ready（重试一次）", () => {
      let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, DEADLINE, TICK, 3);
      op = markReady(op, TICK).op;
      op = markRunning(op, TICK).op;

      // Carrier 死亡 → blocked
      op = markBlocked(op, TICK + 50, "carrier death").op;
      expect(op.status).toBe("blocked");
      expect(op.lastError).toContain("carrier death");

      // 重试 → ready
      const retryResult = retryFromBlocked(op, TICK + 100);
      expect(retryResult.ok).toBe(true);
      expect(retryResult.op.status).toBe("ready");
      expect(retryResult.op.retries).toBe(1);
    });

    it("maxRetries → failed → reservation 释放", () => {
      let table: ReservationTable = new Map();
      let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, DEADLINE, TICK, 2);

      op = markReady(op, TICK).op;
      table = createReservation(table, op.id, "W1N1", "W2N1", 1000, TICK);
      expect(getReservation(table, op.id)).toBeDefined();

      // blocked → retry(1) → blocked → retry(2) → blocked → retry(3>=maxRetries=2) → failed
      op = markBlocked(op, TICK + 50, "fail1").op;
      op = retryFromBlocked(op, TICK + 60).op;
      expect(op.retries).toBe(1);

      op = markBlocked(op, TICK + 100, "fail2").op;
      op = retryFromBlocked(op, TICK + 110).op;
      expect(op.retries).toBe(2);

      op = markBlocked(op, TICK + 150, "fail3").op;
      const retry3 = retryFromBlocked(op, TICK + 160);
      expect(retry3.ok).toBe(false);
      expect(retry3.reason).toContain("max retries");

      // 标记 failed
      op = markFailed(op, TICK + 120, "max retries exceeded").op;
      expect(op.status).toBe("failed");
      expect(op.cooldownUntil).toBe(TICK + 320); // 200 tick 冷却

      // 释放 reservation
      table = releaseReservation(table, op.id);
      expect(getReservation(table, op.id)).toBeUndefined();
    });
  });

  describe("超时链路: running → expired", () => {
    it("deadline 超时 → expired", () => {
      let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK);
      op = markReady(op, TICK).op;
      op = markRunning(op, TICK).op;

      // 超时
      const expiry = checkExpiry(op, TICK + 200);
      expect(expiry.op.status).toBe("expired");
    });

    it("verifying 超时 + 零送达 → abort", () => {
      let op = createOperation("W1N1", "W2N1", "energy", 1000, 1, TICK + 100, TICK);
      op = markReady(op, TICK).op;
      op = markRunning(op, TICK).op;
      op = markVerifying(op, TICK).op;

      expect(shouldAbortVerification(op, TICK + 200)).toBe(true);
    });

    it("verifying 超时 + 部分送达 → partial complete", () => {
      let op = createOperation("W1N1", "W2N1", "energy", 2000, 1, TICK + 100, TICK);
      op = markReady(op, TICK).op;
      op = markRunning(op, TICK).op;
      op = markVerifying(op, TICK).op;
      op = reportDelivery(op, 500, TICK + 50);

      expect(shouldPartialComplete(op, TICK + 200)).toBe(true);
    });
  });

  describe("资源可调拨量验证", () => {
    it("storage 充足时可调拨", () => {
      const profile = makeProfile({
        storageEnergy: 200000,
        storageCapacity: 300000,
        contractReserve: 5000,
        isStruggling: false,
      });
      const transferable = computeTransferable(profile, 0);
      // 200000 - 5000 - max(300000*0.2, 5000) - 0 = 200000 - 5000 - 60000 = 135000
      expect(transferable).toBeGreaterThan(0);
      expect(transferable).toBe(135000);
    });

    it("storage 低于安全线时不可调拨", () => {
      const profile = makeProfile({
        storageEnergy: 50000,
        storageCapacity: 300000,
        contractReserve: 5000,
        isStruggling: false,
      });
      const transferable = computeTransferable(profile, 0);
      // 50000 - 5000 - 60000 = -15000 → max(0, -15000) = 0
      expect(transferable).toBe(0);
    });

    it("struggling 房不可调拨", () => {
      const profile = makeProfile({
        storageEnergy: 200000,
        storageCapacity: 300000,
        isStruggling: true,
      });
      const transferable = computeTransferable(profile, 0);
      expect(transferable).toBe(0);
    });

    it("活跃预留扣减可调拨量", () => {
      const profile = makeProfile({
        storageEnergy: 200000,
        storageCapacity: 300000,
        contractReserve: 5000,
        isStruggling: false,
      });
      const transferable = computeTransferable(profile, 50000);
      // 200000 - 5000 - 60000 - 50000 = 85000
      expect(transferable).toBe(85000);
    });
  });

  describe("幂等性", () => {
    it("同 (from, to, resource) 不重复创建活跃 Operation", () => {
      const ops = [
        createOperation("W1N1", "W2N1", "energy", 1000, 1, DEADLINE, TICK),
      ];
      expect(hasActiveOperation(ops, "W1N1", "W2N1", "energy")).toBe(true);
      expect(hasActiveOperation(ops, "W1N1", "W3N1", "energy")).toBe(false);
    });

    it("终态 Operation 不阻止新 Operation", () => {
      const ops = [
        { ...createOperation("W1N1", "W2N1", "energy", 1000, 1, DEADLINE, TICK), status: "completed" as const },
      ];
      expect(hasActiveOperation(ops, "W1N1", "W2N1", "energy")).toBe(false);
    });
  });
});
