/** R681：RCL4 无 storage 且有 storage 工地 ⇒ 暂停升级，优先建成 storage。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import {
  mockConstructionSite,
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

function make(rcl: number, withStorage: boolean, withStorageSite: boolean) {
  const site = mockConstructionSite("storage", { id: "st_site" });
  const storage = withStorage
    ? mockStructure("storage", { id: "st", energy: 10000, capacity: 1000000 })
    : undefined;
  const snap = mockSnapshot({
    rcl,
    storage,
    myConstructionSites: withStorageSite ? [site] : [],
    fillTargets: [],
  });
  const creep = mockCreep({
    name: "upgrader_1",
    role: "upgrader",
    used: 50,
    capacity: 50,
    mode: "work",
  });
  return { creep, ctx: mockContext(snap), site };
}

describe("upgrader — R681 storage-first", () => {
  it("RCL4 无 storage + storage 工地 ⇒ 不升级，转 idle", () => {
    const { creep, ctx } = make(4, false, true);
    upgraderRole.run(creep, ctx);
    expect(creep.upgradeController).not.toHaveBeenCalled();
    expect(creep.memory.mode).toBe("idle");
  });

  it("storage 已建成 ⇒ 正常升级（门控解除）", () => {
    const { creep, ctx } = make(4, true, false);
    upgraderRole.run(creep, ctx);
    expect(creep.upgradeController).toHaveBeenCalled();
  });

  it("RCL3（未解锁 storage）⇒ 不受该门控影响", () => {
    const { creep, ctx } = make(3, false, false);
    upgraderRole.run(creep, ctx);
    // 无 storage 的 RCL3 不应因“缺 storage 工地”被停
    expect(creep.memory.mode).not.toBe(undefined);
    expect(creep.memory.mode).not.toBe("flee");
  });
});
