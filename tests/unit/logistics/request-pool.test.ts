/**
 * 请求池纯函数单测——防超卖供给账/生成聚合/TTL 过期回执/饥饿老化。
 * 合同：LOGISTICS §2–§5；任务书 §22–§25。
 */
import { describe, it, expect } from "vitest";
import {
  supplyLedger, buildTransportRequests, reconcileRegistry, promoteAged, applyShrink,
  type SupplySource, type LeaseSummary, type TransportRequest,
} from "../../../src/domain/assignment/request-pool";

const src = (id: string, available: number): SupplySource => ({ id, pos: { x: 10, y: 10 }, available });
const lease = (sourceId?: string, valid = true): LeaseSummary => ({ sourceId, valid });

describe("supplyLedger — 防超卖供给账", () => {
  it("活跃租约占用并发槽位，失效租约不占", () => {
    const ledger = supplyLedger([src("c1", 1000)], [lease("c1"), lease("c1", false)], 1);
    expect(ledger.get("c1")!.activeLeases).toBe(1);
    expect(ledger.get("c1")!.remainingSlots).toBe(0);
  });
});

describe("buildTransportRequests — 生成/去重/聚合/提级", () => {
  it("每源一请求（拆分聚合），确定性 key 幂等", () => {
    const mk = () => buildTransportRequests({
      roomName: "W1N1",
      supplies: [src("a", 500), src("b", 300)],
      leases: [],
      towerStarving: false,
      maxConcurrentPerSource: 1,
      basePriority: 1,
      boostedPriority: 0,
    });
    const r1 = mk();
    const r2 = mk();
    expect(r1.map(r => r.key)).toEqual(["collect:W1N1:a", "collect:W1N1:b"]);
    expect(r1.map(r => r.key)).toEqual(r2.map(r => r.key)); // 重导出幂等 = dedup
    expect(r1.every(r => r.priority === 1)).toBe(true);
  });

  it("塔饥渴 → 收集请求整体提级 P0（需求侧聚合）", () => {
    const reqs = buildTransportRequests({
      roomName: "W1N1", supplies: [src("a", 100)], leases: [],
      towerStarving: true, maxConcurrentPerSource: 1,
      basePriority: 1, boostedPriority: 0,
    });
    expect(reqs[0]!.priority).toBe(0);
  });

  it("防超卖：并发占满的源不再生成请求；空源跳过", () => {
    const reqs = buildTransportRequests({
      roomName: "R", supplies: [src("busy", 800), src("empty", 0), src("free", 200)],
      leases: [lease("busy")],
      towerStarving: false, maxConcurrentPerSource: 1,
      basePriority: 1, boostedPriority: 0,
    });
    expect(reqs.map(r => r.sourceId)).toEqual(["free"]);
  });
});

describe("reconcileRegistry — TTL 过期回执与登记", () => {
  it("TTL 到期未认领 → expired 回执；认领过离池不算过期", () => {
    const registry = new Map();
    registry.set("k1", { firstSeen: 0, claimed: false });   // 300t 无认领 → expired
    registry.set("k2", { firstSeen: 0, claimed: true });     // 认领后离池 → fulfilled 语义
    registry.set("k3", { firstSeen: 250, claimed: false });  // 未到期即消失 → vanished
    const rec = reconcileRegistry(registry, new Set(["k4"]), 300, 300);
    expect(rec.expiredKeys).toEqual(["k1"]);
    expect(rec.vanishedKeys).toEqual(["k3"]);
    expect(registry.has("k1")).toBe(false);
    expect(registry.has("k4")).toBe(true);                   // 新 key 登记 firstSeen
    expect(registry.get("k4")!.firstSeen).toBe(300);
  });
});

describe("applyShrink — L2 池收缩", () => {
  it("收缩只保 P0/P1；不收缩原样返回（同一引用）", () => {
    const reqs: TransportRequest[] = [
      { key: "a", resource: "energy", amount: 10, priority: 0 },
      { key: "b", resource: "energy", amount: 10, priority: 1 },
      { key: "c", resource: "energy", amount: 10, priority: 2 },
    ];
    expect(applyShrink(reqs, false)).toBe(reqs);
    const out = applyShrink(reqs, true);
    expect(out.map(r => r.key)).toEqual(["a", "b"]);
  });
});

describe("promoteAged — 饥饿老化", () => {
  it("P≥2 且超龄提级一次；P0/P1 不适用", () => {
    const registry = new Map<string, { firstSeen: number; claimed: boolean; promotedOnce?: boolean }>([
      ["p3", { firstSeen: 0, claimed: false }],
      ["young", { firstSeen: 190, claimed: false }],
    ]);
    const reqs: TransportRequest[] = [
      { key: "p3", resource: "energy", amount: 10, priority: 3 },
      { key: "young", resource: "energy", amount: 10, priority: 2 },
      { key: "low", resource: "energy", amount: 10, priority: 1 },
    ];
    promoteAged(reqs, registry as never, 200, 150);
    expect(reqs.find(r => r.key === "p3")!.priority).toBe(2);
    expect(reqs.find(r => r.key === "low")!.priority).toBe(1); // P1 不老化
    promoteAged(reqs, registry as never, 210, 150);
    expect(reqs.find(r => r.key === "p3")!.priority).toBe(2); // 一次性，不连升
  });
});