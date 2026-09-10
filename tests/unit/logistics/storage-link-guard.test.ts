/**
 * withdrawStorageLink 回归测试。
 *
 * 守卫已移除（根因分析详见 AUDIT-ISSUES.md ISSUE-LINK-CHAIN）：
 * - link-system (P1 系统) 先于 hauler (P1 角色) 执行，已将 storage→controller 传输完毕
 * - hauler 排空的是 link-system 传输后的剩余能量，不影响 controller link 供能
 * - 守卫导致 storage link 锁在 799/800（free=1-3），source→storage 传输量 1-3，
 *   经 3% 损耗后到账 0-2 → 近零有效 → 链路背压瘫痪
 *
 * 现在只需验证：storage link 有能量时 hauler 正常排空，无能量时返回 undefined。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { withdrawStorageLink } from "../../../src/creeps/engine/actions/withdraw";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function makeAc(
  opts: {
    storageLinkEnergy?: number;
    storageEnergy?: number;
  } = {},
) {
  const { storageLinkEnergy = 800, storageEnergy = 0 } = opts;
  const storage = mockStructure("storage", { id: "st", energy: storageEnergy, capacity: 1000000 });
  const storageLink = mockStructure("link", { id: "sl", energy: storageLinkEnergy, capacity: 800 });
  storageLink.pos = { x: 33, y: 29, getRangeTo: () => 1 } as never;
  const snap = mockSnapshot({ storage, links: [storageLink] });
  const creep = mockCreep({
    name: "hauler_1",
    role: "hauler",
    used: 0,
    capacity: 300,
    mode: "acquire",
  });
  const ctx = mockContext(snap);
  return {
    ac: { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx },
    storageLink,
  };
}

describe("withdrawStorageLink — 无守卫直接排空", () => {
  beforeEach(() => resetGlobals());

  it("storage link 有能量 → 返回 link 供 hauler withdraw", () => {
    const { ac, storageLink } = makeAc({ storageLinkEnergy: 799 });
    const r = withdrawStorageLink().resolve!(ac)!;
    expect(r).toBe(storageLink);
  });

  it("storage link 满 800 → 仍返回 link（不阻止排空）", () => {
    const { ac, storageLink } = makeAc({ storageLinkEnergy: 800 });
    const r = withdrawStorageLink().resolve!(ac)!;
    expect(r).toBe(storageLink);
  });

  it("storage link 无能量 → undefined", () => {
    const { ac } = makeAc({ storageLinkEnergy: 0 });
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("无 storage → undefined", () => {
    const snap = mockSnapshot({});
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 0,
      capacity: 300,
      mode: "acquire",
    });
    const ctx = mockContext(snap);
    const ac = { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx };
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("无 link → undefined", () => {
    const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    const snap = mockSnapshot({ storage, links: [] });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 0,
      capacity: 300,
      mode: "acquire",
    });
    const ctx = mockContext(snap);
    const ac = { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx };
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });
});
