/** 供给合同派单闸：供需失配、保留量、共享额度。 */
import { describe, expect, it } from "vitest";
import {
  createActiveSupplyContract,
  isContractStale,
  SUPPLY_CONTRACT_STALE_TICKS,
} from "../../../src/domain/economy/supply-contract";
import { planLogistics, type PlannerInput } from "../../../src/domain/logistics/planner";
import { RouteCache } from "../../../src/domain/logistics/route-cache";
import type { SupplyNode } from "../../../src/domain/operation/supply-node";
import type { DemandNode } from "../../../src/domain/operation/demand-node";

const TICK = 1000;

function supply(room: string, available: number, safety: number): SupplyNode {
  return {
    room,
    resource: "energy",
    available,
    reserved: 0,
    safety,
    transferable: Math.max(0, available - safety),
    priority: 2,
    health: 0.8,
    capacity: 100000,
    timestamp: TICK,
  };
}

function demand(room: string, remaining: number): DemandNode {
  return {
    room,
    resource: "energy",
    requested: remaining,
    priority: 2,
    deadline: TICK + 2000,
    criticality: "normal",
    fulfilled: 0,
    remaining,
    firstSeen: TICK,
    timestamp: TICK,
  };
}

function input(overrides: Partial<PlannerInput>): PlannerInput {
  return {
    contracts: [],
    deficits: [],
    surpluses: [],
    capacity: { rooms: [], totalHaulerGap: 0, totalCarrierGap: 0 } as any,
    routeCache: new RouteCache(),
    threats: new Map(),
    tick: TICK,
    ...overrides,
  };
}

function contractRequests(plan: ReturnType<typeof planLogistics>, contractId: string) {
  return plan.requests.filter(r => r.origin === contractId);
}

describe("合同派单闸 — 供需必须仍然存在", () => {
  it("需求节点消失 ⇒ 不再派合同请求", () => {
    const contract = createActiveSupplyContract("W1N1", "W2N1", "energy", 10, 5000, 2, TICK);
    const plan = planLogistics(
      input({ contracts: [contract], surpluses: [supply("W1N1", 100000, 5000)], deficits: [] }),
    );
    expect(contractRequests(plan, contract.id)).toHaveLength(0);
  });

  it("供给节点消失 ⇒ 不再派合同请求", () => {
    const contract = createActiveSupplyContract("W1N1", "W2N1", "energy", 10, 5000, 2, TICK);
    const plan = planLogistics(
      input({ contracts: [contract], surpluses: [], deficits: [demand("W2N1", 10000)] }),
    );
    expect(contractRequests(plan, contract.id)).toHaveLength(0);
  });
});

describe("合同派单闸 — 保留量与额度", () => {
  it("请求量不超过「源库存 − 储备」；储备取合同与供给节点的较大值", () => {
    const contract = createActiveSupplyContract("W1N1", "W2N1", "energy", 100, 8000, 2, TICK);
    const plan = planLogistics(
      input({
        contracts: [contract],
        // available 12000 − max(minimumReserve 8000, safety 5000) = 4000
        surpluses: [supply("W1N1", 12000, 5000)],
        deficits: [demand("W2N1", 10000)],
      }),
    );
    const requests = contractRequests(plan, contract.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.amount).toBe(4000);
  });

  it("请求量不超过目标剩余需求", () => {
    const contract = createActiveSupplyContract("W1N1", "W2N1", "energy", 100, 5000, 2, TICK);
    const plan = planLogistics(
      input({
        contracts: [contract],
        surpluses: [supply("W1N1", 100000, 5000)],
        deficits: [demand("W2N1", 1500)],
      }),
    );
    const requests = contractRequests(plan, contract.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.amount).toBe(1500);
  });

  it("同一源房的多条合同共享可调拨额度，不会各自越过储备", () => {
    const first = createActiveSupplyContract("W1N1", "W2N1", "energy", 100, 5000, 2, TICK);
    const second = createActiveSupplyContract("W1N1", "W3N1", "energy", 100, 5000, 2, TICK);
    const plan = planLogistics(
      input({
        contracts: [first, second],
        // 可调拨 7000：第一条拿走全部，第二条拿 0。
        surpluses: [supply("W1N1", 12000, 5000)],
        deficits: [demand("W2N1", 10000), demand("W3N1", 10000)],
      }),
    );
    expect(contractRequests(plan, first.id)).toHaveLength(1);
    expect(contractRequests(plan, first.id)[0]!.amount).toBe(7000);
    expect(contractRequests(plan, second.id)).toHaveLength(0);
  });
});

describe("合同过期判定", () => {
  it("有 lastMatchedAt 时从该拍起算，缺失时回退 createdAt", () => {
    const contract = createActiveSupplyContract("W1N1", "W2N1", "energy", 10, 5000, 2, TICK);
    expect(isContractStale(contract, TICK + SUPPLY_CONTRACT_STALE_TICKS - 1)).toBe(false);
    expect(isContractStale(contract, TICK + SUPPLY_CONTRACT_STALE_TICKS)).toBe(true);

    const matched = { ...contract, lastMatchedAt: TICK + 500 };
    expect(isContractStale(matched, TICK + 1000)).toBe(false);
    expect(isContractStale(matched, TICK + 1100)).toBe(true);
  });
});
