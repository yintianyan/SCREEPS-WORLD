/** 远矿 hauler container 加权分散测试（组②-2c / E-2）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRemoteContainer } from "../../../src/creeps/roles/remote-hauler";
import { mockCreep, resetGlobals } from "../../support/factories";

const targetRoom = "W2N1";

beforeEach(() => {
  resetGlobals();
});

function mockContainer(id: string, energy: number) {
  return {
    id,
    structureType: STRUCTURE_CONTAINER,
    store: { getUsedCapacity: (_r?: unknown) => energy },
    pos: { x: 10, y: 10, roomName: targetRoom },
  };
}

function makeHauler(name: string, containers: unknown[]) {
  const creep = mockCreep({ name, role: "remoteHauler" });
  creep.memory.remoteTarget = targetRoom;
  creep.memory.remoteContainerId = undefined;
  creep.room = {
    name: targetRoom,
    find: vi.fn((t: number) => (t === FIND_STRUCTURES ? containers : [])),
  };
  return creep;
}

describe("remote-hauler — findRemoteContainer 加权分散", () => {
  it("选满的 container 而非数组序最近的近乎空 container（反羊群）", () => {
    const g = globalThis as any;
    // 数组首个是近乎空的（旧 findClosestByRange 会误选它），第二个是满的。
    const nearEmpty = mockContainer("c-empty", 50);
    const full = mockContainer("c-full", 1800);
    const hauler = makeHauler("rhaul-1", [nearEmpty, full]);
    g.Game.creeps = { "rhaul-1": hauler };

    const picked = findRemoteContainer(hauler);
    expect(picked?.id).toBe("c-full");
  });
});
