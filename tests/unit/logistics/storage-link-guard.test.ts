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
  mockPos,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function makeAc(
  opts: {
    storageLinkEnergy?: number;
    storageEnergy?: number;
    /** 传入则额外放一条 controller link；能量越低缺口越大。 */
    controllerLinkEnergy?: number;
  } = {},
) {
  const { storageLinkEnergy = 800, storageEnergy = 0, controllerLinkEnergy } = opts;
  const storage = mockStructure("storage", { id: "st", energy: storageEnergy, capacity: 1000000 });
  storage.pos = mockPos(10, 10);
  const storageLink = mockStructure("link", { id: "sl", energy: storageLinkEnergy, capacity: 800 });
  storageLink.pos = mockPos(12, 10);
  const links = [storageLink];
  if (controllerLinkEnergy !== undefined) {
    const ctrlLink = mockStructure("link", {
      id: "cl",
      energy: controllerLinkEnergy,
      capacity: 800,
    });
    ctrlLink.pos = mockPos(24, 25);
    links.push(ctrlLink);
  }
  const snap = mockSnapshot({ storage, links });
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

  it("storage link 满 800 → 仍返回 link（controller 不缺能时正常排空）", () => {
    const { ac, storageLink } = makeAc({ storageLinkEnergy: 800 });
    const r = withdrawStorageLink().resolve!(ac)!;
    expect(r).toBe(storageLink);
  });

  it("controller link 真缺能（free ≥ 400）→ 保留 storage link 给 link-system Step3", () => {
    // controller link 能量 300 ⇒ free 500 ≥ 400：hauler 不排空，让 storage→controller 先补。
    const { ac } = makeAc({ storageLinkEnergy: 700, controllerLinkEnergy: 300 });
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("controller link 接近满（free < 400）→ 恢复排空", () => {
    // controller link 能量 500 ⇒ free 300 < 400：正常排空。
    const { ac, storageLink } = makeAc({ storageLinkEnergy: 700, controllerLinkEnergy: 500 });
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
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
