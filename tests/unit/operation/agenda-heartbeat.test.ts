import { beforeEach, describe, expect, it } from "vitest";
import { agendaManagerSystem } from "../../../src/systems/empire/agenda-manager";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("agenda-manager — 活跃预约心跳", () => {
  it("running op 的 reservation 在本趟被续期，不被 TTL 清扫", () => {
    const now = (globalThis as any).Game.time;
    const op = {
      id: "supply:A:B:energy",
      type: "supply",
      status: "running",
      sourceRoom: "A",
      targetRoom: "B",
      requestedAmount: 1200,
      deliveredAmount: 0,
      reservedAmount: 1200,
      priority: 2,
      resource: "energy",
      deadline: now + 2000,
      createdAt: now - 500,
      updatedAt: now - 500,
      retries: 0,
      maxRetries: 3,
    };
    (globalThis as any).Memory.kernel = {
      agendas: [op],
      reservations: {
        [op.id]: {
          operationId: op.id,
          sourceRoom: "A",
          targetRoom: "B",
          amount: 1200,
          createdAt: now - 500,
          expiresAt: now,
          lastHeartbeat: now - 500,
          resource: "energy",
        },
      },
    };
    const ctx: any = { tick: now, *snapshots() {}, getSnapshot: () => undefined };

    agendaManagerSystem.run(ctx);

    const reservation = (globalThis as any).Memory.kernel.reservations[op.id];
    expect(reservation.expiresAt).toBe(now + 500);
    expect(reservation.lastHeartbeat).toBe(now);
    expect((globalThis as any).Memory.kernel.agendas[0].status).toBe("running");
  });
});

describe("agenda-manager — verifying 预约心跳（防 over-delivery）", () => {
  it("verifying op 的 reservation 在本趟被续期，不被 TTL 清扫打回 blocked→retry", () => {
    const now = (globalThis as any).Game.time;
    const op = {
      id: "supply:A:B:energy",
      type: "supply",
      status: "verifying",
      sourceRoom: "A",
      targetRoom: "B",
      requestedAmount: 1650,
      deliveredAmount: 1650,
      reservedAmount: 1650,
      priority: 2,
      resource: "energy",
      deadline: now + 2000,
      createdAt: now - 900,
      updatedAt: now,
      retries: 0,
      maxRetries: 3,
    };
    (globalThis as any).Memory.kernel = {
      agendas: [op],
      reservations: {
        [op.id]: {
          operationId: op.id,
          sourceRoom: "A",
          targetRoom: "B",
          amount: 1650,
          createdAt: now - 900,
          expiresAt: now,
          lastHeartbeat: now - 500,
          resource: "energy",
        },
      },
    };
    const ctx: any = { tick: now, *snapshots() {}, getSnapshot: () => undefined };

    agendaManagerSystem.run(ctx);

    const reservation = (globalThis as any).Memory.kernel.reservations[op.id];
    expect(reservation.expiresAt).toBe(now + 500);
    expect(reservation.lastHeartbeat).toBe(now);
    const saved = (globalThis as any).Memory.kernel.agendas[0];
    expect(saved.status).toBe("verifying");
    expect(saved.deliveredAmount).toBe(1650);
  });
});

describe("agenda-manager — 供给 op deadline 与孵化延迟对齐", () => {
  function supplyOp(now: number) {
    return {
      id: "supply:A:B:energy",
      type: "supply",
      status: "running",
      sourceRoom: "A",
      targetRoom: "B",
      requestedAmount: 1650,
      deliveredAmount: 0,
      reservedAmount: 1650,
      priority: 2,
      resource: "energy",
      deadline: now - 100,
      createdAt: now - 2500,
      updatedAt: now - 2500,
      carrierName: "carrier-1",
      retries: 0,
      maxRetries: 3,
    };
  }

  it("deadline 已过但绑定载体仍活着 → 顶到 now+500，不判过期", () => {
    const now = (globalThis as any).Game.time;
    (globalThis as any).Memory.kernel = { agendas: [supplyOp(now)], reservations: {} };
    (globalThis as any).Game.creeps = { "carrier-1": { name: "carrier-1", spawning: false } };
    const ctx: any = { tick: now, *snapshots() {}, getSnapshot: () => undefined };

    agendaManagerSystem.run(ctx);

    const saved = (globalThis as any).Memory.kernel.agendas[0];
    expect(saved.status).not.toBe("expired");
    expect(saved.deadline).toBe(now + 500);
  });

  it("无载体且无孵化请求 → 按原 deadline 过期（控制组）", () => {
    const now = (globalThis as any).Game.time;
    const op = supplyOp(now);
    op.carrierName = undefined as unknown as string;
    (globalThis as any).Memory.kernel = { agendas: [op], reservations: {} };
    (globalThis as any).Game.creeps = {};
    const ctx: any = { tick: now, *snapshots() {}, getSnapshot: () => undefined };

    agendaManagerSystem.run(ctx);

    const saved = (globalThis as any).Memory.kernel.agendas[0];
    expect(saved.status).toBe("expired");
  });
});
