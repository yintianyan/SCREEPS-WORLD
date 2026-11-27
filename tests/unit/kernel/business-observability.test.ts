import { beforeEach, describe, expect, it } from "vitest";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  recordDealObservation,
  recordLabObservation,
  recordRoleObservation,
} from "../../../src/kernel/observability";

function creep(name: string, overrides: Record<string, unknown> = {}): Creep {
  return {
    name,
    memory: { role: "depositHarvester", home: "W37S58", mode: "work" },
    room: { name: "W38S56" },
    store: { getUsedCapacity: () => 250 },
    ...overrides,
  } as unknown as Creep;
}

beforeEach(() => {
  Object.assign(globalThis, { Game: { time: 100 } });
  Object.assign(globalThis, { Memory: { kernel: { stats: {} } } });
  delete (globalThis as unknown as { obs?: unknown }).obs;
  delete (globalThis as unknown as { pendingDealCredits?: unknown }).pendingDealCredits;
});

describe("业务动作回执", () => {
  it("角色只保留最后一次动作及当时载荷", () => {
    const unit = creep("depositHarvester-W37S58-0");
    recordRoleObservation(unit, { exit: "harvest-deposit", rc: 0 });
    Game.time = 101;
    recordRoleObservation(unit, {
      exit: "return-home",
      candidate: "deposit-harvester:return-home",
      rc: 0,
    });

    const obs = globalCache().obs;
    expect(obs?.at).toBe(101);
    expect(obs?.roles?.[unit.name]).toEqual({
      at: 101,
      name: unit.name,
      role: "depositHarvester",
      home: "W37S58",
      room: "W38S56",
      mode: "work",
      load: 250,
      exit: "return-home",
      candidate: "deposit-harvester:return-home",
      rc: 0,
    });
  });

  it("同房同通道累计次数，但成交详情仍为 last-only", () => {
    const detail = {
      room: "W37S58",
      channel: "energySell",
      ok: true,
      rc: 0,
      orderId: "order-1",
      resourceType: RESOURCE_ENERGY,
      amount: 1000,
      price: 12,
      counterparty: "buyer",
      fee: 50,
      creditsBefore: 10_000,
      creditsAfter: 22_000,
    };
    recordDealObservation(detail);
    Game.time = 101;
    recordDealObservation({ ...detail, ok: false, rc: -8, fee: 0 });

    const obs = globalCache().obs;
    expect(obs?.deals?.["W37S58:energySell"]).toMatchObject({
      at: 101,
      ok: false,
      rc: -8,
      resourceType: RESOURCE_ENERGY,
      count: 2,
    });
  });

  it("lab 回执按 boost/reaction 分键并累计次数", () => {
    const detail = {
      room: "W37S58",
      ok: true,
      rc: 0,
      labIds: ["lab-1"],
      compound: "XGH2O",
      energyBefore: 40,
    };
    recordLabObservation({ ...detail, kind: "boost", target: "unit", parts: 3 });
    recordLabObservation({ ...detail, kind: "reaction", input1: 10, input2: 10 });

    const obs = globalCache().obs;
    expect(obs?.labs?.["W37S58:boost"]?.count).toBe(1);
    expect(obs?.labs?.["W37S58:reaction"]).toMatchObject({
      compound: "XGH2O",
      input1: 10,
      input2: 10,
      count: 1,
    });
  });

  it("容量满时淘汰最旧通道", () => {
    for (let i = 0; i < 33; i++) {
      Game.time = 100 + i;
      recordDealObservation({
        room: `W${i}S1`,
        channel: "market",
        ok: true,
        rc: 0,
        orderId: `order-${i}`,
        amount: 1,
        price: 1,
        counterparty: "buyer",
        fee: 0,
        creditsBefore: 10_000,
        creditsAfter: 10_000,
      });
    }

    const obs = globalCache().obs;
    expect(Object.keys(obs?.deals ?? {})).toHaveLength(32);
    expect(obs?.deals?.["W0S1:market"]).toBeUndefined();
    expect(obs?.deals?.["W32S1:market"]).toBeDefined();
  });

  it("记录回执不写 Memory", () => {
    const before = JSON.stringify(Memory);
    recordRoleObservation(creep("unit"), { exit: "idle" });
    recordDealObservation({
      room: "W37S58",
      channel: "market",
      ok: true,
      rc: 0,
      orderId: "order-1",
      amount: 1,
      price: 1,
      counterparty: "buyer",
      fee: 0,
      creditsBefore: 10_000,
      creditsAfter: 10_000,
    });
    recordLabObservation({
      room: "W37S58",
      kind: "reaction",
      ok: true,
      rc: 0,
      labIds: ["lab-1"],
      energyBefore: 10,
    });

    expect(JSON.stringify(Memory)).toBe(before);
  });
});
