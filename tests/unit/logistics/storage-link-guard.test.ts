/**
 * withdrawStorageLink 守卫口径回归。
 *
 * 守卫判据从 minTransfer(400) 硬编码改为 computeControllerLinkTarget 的动态目标值，
 * 消除 [target, minTransfer) 区间的双向锁死：
 *   - link-system 认为 controller 不需能量（needs=0，已达 target）
 *   - hauler 守卫认为 controller 急需（< minTransfer）→ 禁止取
 *   → storage link 能量被永久锁死。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { withdrawStorageLink } from "../../../src/creeps/engine/actions/withdraw";
import { mockContext, mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";

function makeAc(opts: {
  ctrlLinkEnergy?: number;
  storageLinkEnergy?: number;
  rcl?: number;
  storageEnergy?: number;
  ticksToDowngrade?: number;
} = {}) {
  const {
    ctrlLinkEnergy = 799,
    storageLinkEnergy = 800,
    rcl = 8,
    storageEnergy = 0,
    ticksToDowngrade = 20000,
  } = opts;
  const storage = mockStructure("storage", { id: "st", energy: storageEnergy, capacity: 1000000 });
  const storageLink = mockStructure("link", { id: "sl", energy: storageLinkEnergy, capacity: 800 });
  storageLink.pos = { x: 33, y: 29, getRangeTo: () => 1 } as never;
  const ctrlLink = mockStructure("link", { id: "cl", energy: ctrlLinkEnergy, capacity: 800 });
  ctrlLink.pos = { x: 39, y: 11, getRangeTo: () => 1 } as never;
  const controller = {
    id: "c",
    my: true,
    ticksToDowngrade,
    level: rcl,
    pos: { x: 39, y: 12, getRangeTo: () => 1 },
  } as any;
  const snap = mockSnapshot({ rcl, storage, links: [storageLink, ctrlLink], controller });
  const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
  const ctx = mockContext(snap);
  return { ac: { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx }, storageLink };
}

describe("withdrawStorageLink — 守卫口径（computeControllerLinkTarget）", () => {
  beforeEach(() => resetGlobals());

  // ── RCL8 停供场景（target=0）──

  it("RCL8 停供后 controller link 残留 799（free=1）→ 不挡排空", () => {
    // target=0 → controller 不需要能量 → 守卫不触发
    const { ac, storageLink } = makeAc({ rcl: 8, ctrlLinkEnergy: 799 });
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  it("RCL8 停供 + 降级风险（target=200）→ controller link < 200 才挡", () => {
    const base = { rcl: 8, ticksToDowngrade: 5000 };
    // controller link = 199 < 200 → 挡
    expect(withdrawStorageLink().resolve!(makeAc({ ...base, ctrlLinkEnergy: 199 }).ac)).toBeUndefined();
    // controller link = 200 = target → 不挡
    const { ac, storageLink } = makeAc({ ...base, ctrlLinkEnergy: 200 });
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  // ── 低水位保级场景（target=160，storage=0）── 这是本次修复的核心回归 ──

  it("RCL7 storage=0 → target=160，controller link=160（已达 target）→ 不挡排空", () => {
    // 旧口径：160 < minTransfer(400) → 守卫误触发 → storage link 锁死
    // 新口径：160 >= target(160) → 守卫不触发 → hauler 可排空
    const { ac, storageLink } = makeAc({
      rcl: 7, ctrlLinkEnergy: 160, storageEnergy: 0, storageLinkEnergy: 799,
    });
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  it("RCL7 storage=0 → target=160，controller link=159（缺口 1）→ 挡（让路升级链）", () => {
    const { ac } = makeAc({
      rcl: 7, ctrlLinkEnergy: 159, storageEnergy: 0, storageLinkEnergy: 799,
    });
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("RCL6 storage=0 → target=160，controller link=300（> target, < minTransfer）→ 不挡", () => {
    // 旧口径：300 < 400 → 误挡
    // 新口径：300 >= 160 → 不挡
    const { ac, storageLink } = makeAc({
      rcl: 6, ctrlLinkEnergy: 300, storageEnergy: 0, storageLinkEnergy: 500,
    });
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  // ── 满功率冲刺场景（target=800）──

  it("RCL7 storage=10k → target=800，controller link=500 → 挡（未达 target）", () => {
    const { ac } = makeAc({
      rcl: 7, ctrlLinkEnergy: 500, storageEnergy: 10000, storageLinkEnergy: 800,
    });
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("RCL7 storage=10k → target=800，controller link=800 → 不挡", () => {
    const { ac, storageLink } = makeAc({
      rcl: 7, ctrlLinkEnergy: 800, storageEnergy: 10000, storageLinkEnergy: 500,
    });
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });

  // ── 边界场景 ──

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
    // 用独立 mock 避免 ctrlLink 的 getRangeTo 恒 1 干扰 find
    const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    const storageLink = mockStructure("link", { id: "sl", energy: 0, capacity: 800 });
    storageLink.pos = { x: 33, y: 29, getRangeTo: () => 1 } as never;
    const ctrlLink = mockStructure("link", { id: "cl", energy: 799, capacity: 800 });
    ctrlLink.pos = { x: 39, y: 11, getRangeTo: () => 99 } as never; // 远离 storage
    const controller = {
      id: "c", my: true, ticksToDowngrade: 20000, level: 8,
      pos: { x: 39, y: 12, getRangeTo: () => 1 },
    } as any;
    const snap = mockSnapshot({ rcl: 8, storage, links: [storageLink, ctrlLink], controller });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
    const ctx = mockContext(snap);
    const ac = { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx };
    expect(withdrawStorageLink().resolve!(ac)).toBeUndefined();
  });

  it("controller 非我方 → target=0 → 不挡", () => {
    const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    const storageLink = mockStructure("link", { id: "sl", energy: 800, capacity: 800 });
    storageLink.pos = { x: 33, y: 29, getRangeTo: () => 1 } as never;
    const ctrlLink = mockStructure("link", { id: "cl", energy: 100, capacity: 800 });
    ctrlLink.pos = { x: 39, y: 11, getRangeTo: () => 1 } as never;
    const controller = {
      id: "c", my: false, ticksToDowngrade: 0, level: 7,
      pos: { x: 39, y: 12, getRangeTo: () => 1 },
    } as any;
    const snap = mockSnapshot({ rcl: 7, storage, links: [storageLink, ctrlLink], controller });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
    const ctx = mockContext(snap);
    const ac = { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx };
    expect(withdrawStorageLink().resolve!(ac)).toBe(storageLink);
  });
});
