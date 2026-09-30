/**
 * source container 礼让规则的作用域 — 礼让只在"另有选择"时成立。
 *
 * 线上量到的代价（17:1x，W38S56 幼房）：房里没有 storage，三个 container 全是
 * source(2000/2000 ×2) 与 controller(1996/2000) container ⇒ builder 的第 2 步（非物流 container）恒空，
 * 原实现直接落到 `harvest`：离开工位去源上自采，实测工地进度 **0.077/t**（同房三只 2W1C2M builder
 * 的能力是 40/t），三块 extension 各要 3000 进度 ⇒ 爬级被拖成上万拍。
 * 「礼让 hauler」在这里不成立：builder 在源上自采消耗的是**同一份源再生**，只是多绕几十拍并丢下工地，
 * 而满载(2000/2000)的 source container 连 hauler 自己都存不进去 ⇒ 取走它反而解堵。
 */
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
} from "../../support/factories";

/** source 旁 container（满载）+ 可选的一个非物流 container；本房有 hauler。 */
function scenario(withNonLogistics: boolean) {
  const source = { id: "s1", pos: mockPos(31, 14) } as any;
  const sourceContainer = mockStructure("container", { id: "c1", energy: 2000, capacity: 2000 });
  sourceContainer.pos.getRangeTo = vi.fn(() => 1); // 紧邻 source ⇒ 是物流 container
  const containers: any[] = [sourceContainer];

  if (withNonLogistics) {
    const other = mockStructure("container", { id: "c2", energy: 300, capacity: 2000 });
    other.pos.getRangeTo = vi.fn(() => 9); // 离 source 9 格 ⇒ 非物流 container
    containers.push(other);
    sourceContainer.pos.getRangeTo = vi.fn((t: any) => (t === other.pos ? 8 : 1));
  }

  const snap = mockSnapshot({ sources: [source], containers });
  const creep = mockCreep({
    name: "builder_1",
    role: "builder",
    used: 0,
    capacity: 50,
    mode: "acquire",
  });
  return { sourceContainer, other: containers[1], snap, creep };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  globalCache().haulerRooms = new Set([mockSnapshot({}).roomName, "W38S56"]);
});

describe("builder 取能 — 物流 container 礼让的作用域", () => {
  it("无 hauler 房（拓荒爬坡期）：builder 直取 source container", () => {
    const { sourceContainer, snap, creep } = scenario(false);
    globalCache().haulerRooms = new Set(); // 集合存在但不含本房 = 无 hauler。

    builderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(sourceContainer, "energy");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("有 hauler 且**另有非物流 container**：礼让照旧生效（取非物流那个，不动物流源）", () => {
    const { sourceContainer, other, snap, creep } = scenario(true);
    globalCache().haulerRooms = new Set([snap.roomName]);

    builderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(other, "energy");
    expect(creep.withdraw).not.toHaveBeenCalledWith(sourceContainer, "energy");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("有 hauler 但**整间房只有物流 container**（幼房实况）：取它，而不是丢下工地去自采", () => {
    const { sourceContainer, snap, creep } = scenario(false);
    globalCache().haulerRooms = new Set([snap.roomName]);

    builderRole.run(creep, mockContext(snap));

    expect(creep.withdraw).toHaveBeenCalledWith(sourceContainer, "energy");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("container 全空时新步骤不接管（不对着空 container 白跑一趟）", () => {
    const { sourceContainer, snap, creep } = scenario(false);
    sourceContainer.store.getUsedCapacity = vi.fn(() => 0);
    globalCache().haulerRooms = new Set([snap.roomName]);

    builderRole.run(creep, mockContext(snap));

    // 空 container 不该被选为取能目标；此后走采集/通勤兜底
    // （mock 的格距下 builder 是先走向 source 而非就地 harvest，故不断言 harvest 被调用）。
    expect(creep.withdraw).not.toHaveBeenCalled();
  });
});
