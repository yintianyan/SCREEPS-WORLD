/** withdrawStorageLink ②b 守卫口径回归（A 修复，2026-08-01）。 */
import { describe, expect, it, beforeEach } from "vitest";
import { withdrawStorageLink } from "../../../src/creeps/engine/actions/withdraw";
import { mockContext, mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";

function makeAc(opts: { ctrlLinkEnergy?: number; storageLinkEnergy?: number } = {}) {
  const { ctrlLinkEnergy = 799, storageLinkEnergy = 800 } = opts;
  const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
  const storageLink = mockStructure("link", { id: "sl", energy: storageLinkEnergy, capacity: 800 });
  storageLink.pos = { x: 33, y: 29, getRangeTo: () => 1 } as never;
  const ctrlLink = mockStructure("link", { id: "cl", energy: ctrlLinkEnergy, capacity: 800 });
  ctrlLink.pos = { x: 39, y: 11, getRangeTo: () => 1 } as never;
  const controller = { id: "c", my: true, pos: { x: 39, y: 12, getRangeTo: () => 1 } } as any;
  const snap = mockSnapshot({ storage, links: [storageLink, ctrlLink], controller });
  const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
  const ctx = mockContext(snap);
  return { ac: { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx }, storageLink };
}

describe("withdrawStorageLink — ②b 守卫口径（A 修复）", () => {
  beforeEach(() => resetGlobals());

  it("RCL8 停供后 controller link 残留 799（free=1）→ 不挡排空（旧口径死锁回归）", () => {
    const { ac, storageLink } = makeAc();
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  it("controller link 急需（能量 < 400）→ 让路升级链", () => {
    const { ac } = makeAc({ ctrlLinkEnergy: 300 });
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("controller link 不存在 → 正常排空", () => {
    const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    const storageLink = mockStructure("link", { id: "sl", energy: 800, capacity: 800 });
    storageLink.pos = { x: 33, y: 29, getRangeTo: () => 1 } as never;
    const snap = mockSnapshot({ storage, links: [storageLink] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
    const ctx = mockContext(snap);
    const ac = { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx };
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  it("storage link 无能量 → undefined", () => {
    const { ac } = makeAc({ storageLinkEnergy: 0 });
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });
});
