/** P3 物流请求池完整版测试 — 租约超时回收、tower 补给请求。 */
import { describe, it, expect } from "vitest";
import {
  supplyLedger,
  buildTransportRequests,
  type LeaseSummary,
  type SupplySource,
} from "../../../src/domain/assignment/request-pool";

const src = (id: string, available: number): SupplySource => ({
  id,
  pos: { x: 10, y: 10 },
  available,
});
const lease = (sourceId?: string, valid = true): LeaseSummary => ({ sourceId, valid });

describe("租约超时回收 — leaseExpired → valid=false", () => {
  it("过期租约标记 invalid → 不占并发槽位 → 源重新可用", () => {
    const sources = [src("c1", 1000)];
    // 两个租约：一个过期（valid=false），一个活跃（valid=true）。
    const leases: LeaseSummary[] = [
      lease("c1", false), // 过期租约
      lease("c1", true), // 活跃租约
    ];
    const ledger = supplyLedger(sources, leases, 1);
    // 过期租约不占槽位 → activeLeases 只计 1（活跃的） → remainingSlots=0。
    expect(ledger.get("c1")!.activeLeases).toBe(1);
    expect(ledger.get("c1")!.remainingSlots).toBe(0);
  });

  it("全部租约过期 → 源完全可用（remainingSlots = maxConcurrent）", () => {
    const sources = [src("c1", 500)];
    const leases: LeaseSummary[] = [lease("c1", false), lease("c1", false)];
    const ledger = supplyLedger(sources, leases, 1);
    expect(ledger.get("c1")!.activeLeases).toBe(0);
    expect(ledger.get("c1")!.remainingSlots).toBe(1);
  });

  it("活跃租约正常占位 → 防超卖仍有效", () => {
    const sources = [src("c1", 500)];
    const leases: LeaseSummary[] = [lease("c1", true)];
    const ledger = supplyLedger(sources, leases, 1);
    expect(ledger.get("c1")!.activeLeases).toBe(1);
    expect(ledger.get("c1")!.remainingSlots).toBe(0);
  });
});

describe("tower 补给请求 — 低能量塔生成独立搬运任务", () => {
  it("towerStarving 时收集请求整体提级 P0", () => {
    const reqs = buildTransportRequests({
      roomName: "W1N1",
      supplies: [src("a", 100)],
      leases: [],
      towerStarving: true,
      maxConcurrentPerSource: 1,
      basePriority: 1,
      boostedPriority: 0,
    });
    expect(reqs[0]!.priority).toBe(0);
  });

  it("非 towerStarving 时保持基线优先级", () => {
    const reqs = buildTransportRequests({
      roomName: "W1N1",
      supplies: [src("a", 100)],
      leases: [],
      towerStarving: false,
      maxConcurrentPerSource: 1,
      basePriority: 1,
      boostedPriority: 0,
    });
    expect(reqs[0]!.priority).toBe(1);
  });
});
