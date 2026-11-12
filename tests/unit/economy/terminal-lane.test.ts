/** Phase B：terminal 出口车道票据（trim / export）。 */
import { describe, expect, it } from "vitest";
import {
  firstTicketOf,
  planTerminalLane,
  type TerminalLaneInput,
} from "../../../src/domain/economy/terminal-lane";

const EMPTY = new Set<string>();

function input(overrides: Partial<TerminalLaneInput> = {}): TerminalLaneInput {
  return {
    storageStocks: {},
    terminalStocks: {},
    terminalFree: 300000,
    homeMineral: undefined,
    buyOrderResources: EMPTY,
    surplusCompounds: undefined,
    aidNeeds: undefined,
    reserveFree: 50000,
    sellReserve: 3000,
    ...overrides,
  };
}

describe("planTerminalLane — trim", () => {
  it("terminal 超配额 → 搬回 storage，量为超出的部分", () => {
    const tickets = planTerminalLane(
      input({ terminalStocks: { battery: 210423 }, storageStocks: { battery: 50927 } }),
    );
    const trim = firstTicketOf(tickets, "trim");
    expect(trim?.resource).toBe("battery");
    // battery terminal 配额 50,000。
    expect(trim?.amount).toBe(160423);
    expect(trim?.reason).toBe("trim");
  });

  it("配额内不清退（控制组）", () => {
    const tickets = planTerminalLane(input({ terminalStocks: { battery: 50000 } }));
    expect(tickets.filter(t => t.direction === "trim")).toHaveLength(0);
  });

  it("energy 永不清退（由 stockTerminalEnergy 管理）", () => {
    const tickets = planTerminalLane(input({ terminalStocks: { energy: 150000 } }));
    expect(tickets.filter(t => t.direction === "trim")).toHaveLength(0);
  });

  it("未登记 terminal 配额的资源不清退（G/power 是战略物资）", () => {
    const tickets = planTerminalLane(input({ terminalStocks: { G: 9999, power: 500 } }));
    expect(tickets.filter(t => t.direction === "trim")).toHaveLength(0);
  });
});

describe("planTerminalLane — export", () => {
  it("无 ticket（无买盘、无 aid）→ 不搬，即使 storage 有货且配额有空", () => {
    const tickets = planTerminalLane(
      input({ storageStocks: { H: 71393, battery: 50927, wire: 5000, GH2O: 300 } }),
    );
    expect(tickets.filter(t => t.direction === "export")).toHaveLength(0);
  });

  it("有买盘 → 按配额搬 home mineral（保留 sellReserve）", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { H: 71393 },
        terminalStocks: {},
        homeMineral: "H",
        buyOrderResources: new Set(["H"]),
      }),
    );
    const ticket = firstTicketOf(tickets, "export");
    expect(ticket?.resource).toBe("H");
    // H 为 home mineral：保留 sellReserve 3000；terminal 配额 20,000。
    expect(ticket?.amount).toBe(20000);
    expect(ticket?.reason).toBe("sell");
  });

  it("非 home mineral 保留 criticalWater(200)", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { O: 50000 },
        homeMineral: "H",
        buyOrderResources: new Set(["O"]),
      }),
    );
    const ticket = firstTicketOf(tickets, "export");
    expect(ticket?.resource).toBe("O");
    expect(ticket?.amount).toBe(20000); // terminal 配额 20,000 是更紧的约束
  });

  it("battery 保留 criticalWater(5000)", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { battery: 50927 },
        buyOrderResources: new Set(["battery"]),
      }),
    );
    const ticket = firstTicketOf(tickets, "export");
    expect(ticket?.resource).toBe("battery");
    expect(ticket?.amount).toBe(45927); // 50927 - 5000，小于 terminal 配额 50000
  });

  it("battery 低于战略底仓 → 不搬", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { battery: 4000 },
        buyOrderResources: new Set(["battery"]),
      }),
    );
    expect(tickets.filter(t => t.direction === "export")).toHaveLength(0);
  });

  it("化合物只在 lab 发布盈余时搬（无盈余信号 → 不搬）", () => {
    const noSurplus = planTerminalLane(
      input({
        storageStocks: { GH2O: 300 },
        buyOrderResources: new Set(["GH2O"]),
      }),
    );
    expect(noSurplus.filter(t => t.direction === "export")).toHaveLength(0);

    const withSurplus = planTerminalLane(
      input({
        storageStocks: { GH2O: 300 },
        buyOrderResources: new Set(["GH2O"]),
        surplusCompounds: { GH2O: 120 },
      }),
    );
    const ticket = firstTicketOf(withSurplus, "export");
    expect(ticket?.resource).toBe("GH2O");
    expect(ticket?.amount).toBe(120);
  });

  it("commodity 有买盘即可搬，无本地保留", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { wire: 8000 },
        buyOrderResources: new Set(["wire"]),
      }),
    );
    const ticket = firstTicketOf(tickets, "export");
    expect(ticket?.resource).toBe("wire");
    expect(ticket?.amount).toBe(8000);
  });

  it("aid 优先于 sell", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { H: 20000, O: 20000 },
        homeMineral: "H",
        buyOrderResources: new Set(["O"]),
        aidNeeds: [{ resource: "H", amount: 5000 }],
      }),
    );
    const exports = tickets.filter(t => t.direction === "export");
    expect(exports[0]?.resource).toBe("H");
    expect(exports[0]?.reason).toBe("aid");
    expect(exports[0]?.amount).toBe(5000);
  });

  it("terminal 无剩余空间（扣掉保留空格）→ 不 export，但 trim 仍然存在", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { H: 20000, battery: 100000 },
        terminalStocks: { battery: 210423 },
        terminalFree: 50000,
        homeMineral: "H",
        buyOrderResources: new Set(["H"]),
      }),
    );
    expect(tickets.filter(t => t.direction === "export")).toHaveLength(0);
    expect(tickets.filter(t => t.direction === "trim")).toHaveLength(1);
  });

  it("多个 export 共享剩余空间，不会合计超出", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { H: 20000, O: 20000 },
        homeMineral: "H",
        buyOrderResources: new Set(["H", "O"]),
        terminalFree: 80000,
        reserveFree: 50000,
      }),
    );
    const total = tickets
      .filter(t => t.direction === "export")
      .reduce((sum, t) => sum + t.amount, 0);
    expect(total).toBeLessThanOrEqual(30000);
  });

  it("terminal 已有该资源时按配额余量决定搬入量", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { H: 20000 },
        terminalStocks: { H: 18000 },
        homeMineral: "H",
        buyOrderResources: new Set(["H"]),
      }),
    );
    const ticket = firstTicketOf(tickets, "export");
    expect(ticket?.amount).toBe(2000);
  });
});

describe("planTerminalLane — 顺序与空输入", () => {
  it("trim 排在 export 之前", () => {
    const tickets = planTerminalLane(
      input({
        storageStocks: { H: 20000 },
        terminalStocks: { battery: 210423 },
        homeMineral: "H",
        buyOrderResources: new Set(["H"]),
      }),
    );
    expect(tickets[0]?.direction).toBe("trim");
    expect(tickets.some(t => t.direction === "export")).toBe(true);
  });

  it("空仓库 → 空票据", () => {
    expect(planTerminalLane(input())).toEqual([]);
  });
});
