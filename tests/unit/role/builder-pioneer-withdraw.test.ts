/** source container 礼让豁免测试 — 拓荒房无 hauler 时可直取。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builderRole } from "../../../src/creeps/roles/builder";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../role-helpers";

/** source 旁 container 场景（拓荒房：无 storage、仅 source container 有能量）。 */
function pioneerScenario() {
  const source = { id: "s1", pos: mockPos(31, 14) } as any;
  const container = mockStructure("container", { id: "c1", energy: 558, capacity: 2000 });
  container.pos.getRangeTo = vi.fn(() => 1); // 紧邻 source → source container。
  const snap = mockSnapshot({ sources: [source], containers: [container] });
  const creep = mockCreep({ name: "builder_1", role: "builder", used: 0, capacity: 50, mode: "acquire" });
  return { container, snap, creep };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("source container 礼让 — 以本房有 hauler 为前提", () => {
  it("无 hauler 房（拓荒爬坡期）：builder 直取 source container", () => {
    const { container, snap, creep } = pioneerScenario();
    globalCache().haulerRooms = new Set(); // 集合存在但不含本房 = 无 hauler。

    builderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(container, "energy");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("有 hauler 房（成熟房）：builder 礼让 source container，落到 harvest", () => {
    const { container, snap, creep } = pioneerScenario();
    globalCache().haulerRooms = new Set([snap.roomName]);

    builderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).not.toHaveBeenCalledWith(container, "energy");
  });

  it("haulerRooms 缺失（global reset 首 tick）：保守礼让（视为有 hauler）", () => {
    const { container, snap, creep } = pioneerScenario();
    globalCache().haulerRooms = undefined;

    builderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).not.toHaveBeenCalledWith(container, "energy");
  });
});
