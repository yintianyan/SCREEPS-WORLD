import { beforeEach, describe, expect, it } from "vitest";
import { linkKeeperRole } from "../../../src/creeps/roles/link-keeper";
import { findLinkKeeperStand, findStorageLink } from "../../../src/domain/economy/links";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function storageSetup(
  opts: { linkEnergy?: number; used?: number; cargo?: "storage" | "link" } = {},
) {
  const storage = mockStructure("storage", { id: "st", energy: 30000, capacity: 1000000 });
  storage.pos = mockPos(10, 10);
  const link = mockStructure("link", { id: "sl", energy: opts.linkEnergy ?? 800, capacity: 800 });
  link.pos = mockPos(11, 10);
  const snap = mockSnapshot({
    storage,
    links: [link],
    sources: [],
    spawns: [],
    controller: undefined,
    fillTargets: [],
  });
  const creep = mockCreep({
    name: "keeper",
    role: "linkKeeper",
    used: opts.used ?? 0,
    capacity: 200,
    mode: opts.used ? "work" : "acquire",
  });
  creep.memory.linkKeeperPost = "storage";
  if (opts.cargo) creep.memory.keeperCargo = opts.cargo;
  creep.pos = mockPos(10, 11) as never;
  creep.room.getTerrain = () => ({ get: () => 0 }) as never;
  return { creep, snap, ctx: mockContext(snap), storage, link };
}

function spawnSetup(opts: { linkEnergy?: number; used?: number; coreFull?: boolean } = {}) {
  const storage = mockStructure("storage", { id: "st", energy: 30000, capacity: 1000000 });
  storage.pos = mockPos(10, 10);
  const spawn = mockStructure("spawn", { id: "sp", energy: 0, capacity: 300 });
  spawn.pos = mockPos(20, 20);
  const link = mockStructure("link", { id: "spl", energy: opts.linkEnergy ?? 800, capacity: 800 });
  link.pos = mockPos(21, 20);
  const snap = mockSnapshot({
    storage,
    spawns: [spawn],
    links: [link],
    sources: [],
    controller: undefined,
    fillTargets: opts.coreFull ? [] : [spawn],
  });
  const creep = mockCreep({
    name: "keeper",
    role: "linkKeeper",
    used: opts.used ?? 0,
    capacity: 200,
    mode: opts.used ? "work" : "acquire",
  });
  creep.memory.linkKeeperPost = "spawn";
  creep.pos = mockPos(20, 21) as never;
  creep.room.getTerrain = () => ({ get: () => 0 }) as never;
  return { creep, snap, ctx: mockContext(snap), spawn, link };
}

beforeEach(() => resetGlobals());

describe("linkKeeper — storage 岗位", () => {
  it("Link 距 storage=3 时几何不合格，keeper 不作业", () => {
    const { creep, ctx, link } = storageSetup({ linkEnergy: 800 });
    link.pos = mockPos(13, 10);
    linkKeeperRole.run(creep, ctx);
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("Link 高水位时排空到 storage，单次最多背包装量", () => {
    const { creep, ctx, snap, storage, link } = storageSetup({ linkEnergy: 800 });
    expect(findStorageLink(snap)?.id).toBe(link.id);
    expect(findLinkKeeperStand(snap, link, storage, () => 0, creep.pos)).toEqual({ x: 10, y: 11 });
    linkKeeperRole.run(creep, ctx);
    expect(creep.withdraw).toHaveBeenCalledWith(link, "energy", 200);
    expect(creep.memory.keeperCargo).toBe("storage");
    expect(storage).toBeDefined();
  });

  it("Link 低水位时从 storage 灌入，受保留库存限制", () => {
    const { creep, ctx, storage, link } = storageSetup({ linkEnergy: 100 });
    linkKeeperRole.run(creep, ctx);
    expect(creep.withdraw).toHaveBeenCalledWith(storage, "energy", 200);
    expect(creep.memory.keeperCargo).toBe("link");
    expect(link).toBeDefined();
  });

  it("滞回带内不动作", () => {
    const { creep, ctx } = storageSetup({ linkEnergy: 400 });
    linkKeeperRole.run(creep, ctx);
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("带货回 storage；目标满时回灌 Link", () => {
    const draining = storageSetup({ used: 200, cargo: "storage", linkEnergy: 100 });
    linkKeeperRole.run(draining.creep, draining.ctx);
    expect(draining.creep.transfer).toHaveBeenCalledWith(draining.storage, "energy");

    const filling = storageSetup({ used: 200, cargo: "link", linkEnergy: 100 });
    filling.storage.store.getFreeCapacity = () => 0;
    linkKeeperRole.run(filling.creep, filling.ctx);
    expect(filling.creep.transfer).toHaveBeenCalledWith(filling.link, "energy");
  });
});

describe("linkKeeper — spawn 岗位", () => {
  it("只从 spawn Link 取能并送入孵化现金池", () => {
    const { creep, ctx, link } = spawnSetup({ linkEnergy: 800 });
    linkKeeperRole.run(creep, ctx);
    expect(creep.withdraw).toHaveBeenCalledWith(link, "energy", 200);

    const loaded = spawnSetup({ used: 200, linkEnergy: 600 });
    linkKeeperRole.run(loaded.creep, loaded.ctx);
    expect(loaded.creep.transfer).toHaveBeenCalledWith(loaded.spawn, "energy");
  });

  it("多 spawn 时围绕 Link 的实际最近 spawn 服务", () => {
    const { creep, snap, link } = spawnSetup({ linkEnergy: 800 });
    const other = mockStructure("spawn", { id: "other", energy: 300, capacity: 300 });
    other.pos = mockPos(10, 10);
    const multi = { ...snap, spawns: [other, ...snap.spawns] };

    linkKeeperRole.run(creep, mockContext(multi));

    expect(creep.withdraw).toHaveBeenCalledWith(link, "energy", 200);
  });

  it("现金池满时抱能等待，不随地丢弃", () => {
    const { creep, ctx } = spawnSetup({ used: 200, linkEnergy: 600, coreFull: true });
    linkKeeperRole.run(creep, ctx);
    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.drop).not.toHaveBeenCalled();
  });
});
