import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSnapshotStaticCacheForTests,
  buildRoomSnapshot,
} from "../../../src/systems/room-snapshot";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

function makeRoom(
  name: string,
  my: boolean,
  opts: { myStructures?: any[]; allStructures?: any[] } = {},
): any {
  const myStructures = opts.myStructures ?? [];
  const allStructures = opts.allStructures ?? [];
  const find = vi.fn((type: number) => {
    switch (type) {
      case FIND_MY_STRUCTURES:
        return [...myStructures];
      case FIND_STRUCTURES:
        return [...allStructures];
      case FIND_CONSTRUCTION_SITES:
      case FIND_MY_CONSTRUCTION_SITES:
      case FIND_SOURCES:
      case FIND_MINERALS:
      case FIND_HOSTILE_CREEPS:
      case FIND_CREEPS:
      case FIND_DROPPED_RESOURCES:
      case FIND_TOMBSTONES:
      case FIND_RUINS:
      case FIND_NUKES:
        return [];
      default:
        return [];
    }
  });
  return {
    name,
    controller: { my, level: 6, pos: { x: 25, y: 25 } },
    storage: undefined,
    terminal: undefined,
    energyAvailable: 300,
    energyCapacityAvailable: 550,
    find,
    lookForAt: vi.fn(() => []),
  };
}

function structuresFindCount(room: any): number {
  return room.find.mock.calls.filter((c: any[]) => c[0] === FIND_STRUCTURES).length;
}

function extension(id: string): any {
  return {
    id,
    structureType: STRUCTURE_EXTENSION,
    hits: 50,
    hitsMax: 50,
    pos: { x: 10, y: 10 },
    store: { getFreeCapacity: () => 50 },
  };
}

describe("room-snapshot — 自有房静态 TTL 缓存", () => {
  it("TTL 内复用静态 find，到期重取；非自有房逐拍清", () => {
    const room = makeRoom("W1N1", true);
    (globalThis as any).Game.time = 1000;
    buildRoomSnapshot(room);
    expect(structuresFindCount(room)).toBe(1);
    (globalThis as any).Game.time = 1005;
    buildRoomSnapshot(room);
    expect(structuresFindCount(room)).toBe(1);
    (globalThis as any).Game.time = 1011;
    buildRoomSnapshot(room);
    expect(structuresFindCount(room)).toBe(2);

    const remote = makeRoom("W2N1", false);
    (globalThis as any).Game.time = 2000;
    buildRoomSnapshot(remote);
    buildRoomSnapshot(remote);
    expect(structuresFindCount(remote)).toBe(2);
  });

  it("新建结构在 TTL 到期后可见，窗口内保持旧视图", () => {
    const myStructures: any[] = [];
    const room = makeRoom("W1N1", true, { myStructures });
    (globalThis as any).Game.time = 1000;
    expect(buildRoomSnapshot(room).extensions.length).toBe(0);

    myStructures.push(extension("e1"));
    (globalThis as any).Game.time = 1005;
    expect(buildRoomSnapshot(room).extensions.length).toBe(0);
    (globalThis as any).Game.time = 1011;
    expect(buildRoomSnapshot(room).extensions.length).toBe(1);
  });

  it("复位后立即重取（跨测试世界不串味）", () => {
    const room = makeRoom("W1N1", true);
    (globalThis as any).Game.time = 1000;
    buildRoomSnapshot(room);
    expect(structuresFindCount(room)).toBe(1);

    __resetSnapshotStaticCacheForTests();
    buildRoomSnapshot(room);
    expect(structuresFindCount(room)).toBe(2);
  });
});
