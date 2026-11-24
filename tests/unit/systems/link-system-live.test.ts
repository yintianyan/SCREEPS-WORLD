import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLiveLinks, linkSystem } from "../../../src/systems/room/link-system";
import { mockContext, mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("link-system — 陈旧快照对象", () => {
  it("按 id 重取后只执行仍存在的 Link", () => {
    const live = {
      id: "live-link",
      structureType: "link",
      my: true,
      pos: mockPos(20, 20),
      cooldown: 0,
      store: {
        getUsedCapacity: vi.fn(() => 0),
        getCapacity: vi.fn(() => 800),
      },
      transferEnergy: vi.fn(),
    } as unknown as StructureLink;
    const stale = {
      id: "gone-link",
      get cooldown(): number {
        throw new Error("stale link");
      },
    } as unknown as StructureLink;
    const snapshot = mockSnapshot({ links: [stale, live] });
    Object.assign(Game, {
      getObjectById: vi.fn((id: string) => (id === live.id ? live : null)),
    });

    expect(getLiveLinks(snapshot)).toEqual([live]);
    expect(() => linkSystem.run(mockContext(snapshot))).not.toThrow();
  });

  it("快照中的 Link 全部失效时安全跳过", () => {
    const stale = { id: "gone-link" } as StructureLink;
    const snapshot = mockSnapshot({ links: [stale] });
    Object.assign(Game, { getObjectById: vi.fn(() => null) });

    expect(getLiveLinks(snapshot)).toEqual([]);
    expect(() => linkSystem.run(mockContext(snapshot))).not.toThrow();
  });
});
