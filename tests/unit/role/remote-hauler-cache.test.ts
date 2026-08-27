/** remote-hauler container 查找的共享缓存接线测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRemoteContainer } from "../../../src/creeps/roles/remote-hauler";
import { mockPos, mockStore, registerObject, resetGlobals } from "../../role-helpers";

function makeRoom(find: ReturnType<typeof vi.fn>) {
  return { name: "W5N5", find };
}

function makeHauler(name: string, room: unknown): any {
  const pos = mockPos(20, 20, "W5N5");
  return {
    name,
    memory: { role: "remoteHauler", home: "W7N4", remoteTarget: "W5N5" },
    room,
    pos,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("remote-hauler — findRemoteContainer 共享缓存（硬约束：禁止每 tick 全房 find）", () => {
  it("同 tick 同房多只 hauler 只触发一次 room.find", () => {
    const container: any = {
      id: "c1",
      structureType: "container",
      store: mockStore(800, 2000),
      pos: mockPos(10, 10, "W5N5"),
    };
    registerObject("c1", container);
    const find = vi.fn(() => [container]);
    const room = makeRoom(find);

    const a = makeHauler("rh1", room);
    const b = makeHauler("rh2", room);

    expect(findRemoteContainer(a)).toBe(container);
    expect(findRemoteContainer(b)).toBe(container);
    // 接线断言：第二只 hauler 命中共享缓存，find 不重复。
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("per-creep 缓存命中时完全不 find（既有行为不回归）", () => {
    const container: any = {
      id: "c1",
      structureType: "container",
      store: mockStore(800, 2000),
      pos: mockPos(10, 10, "W5N5"),
    };
    registerObject("c1", container);
    const find = vi.fn(() => [container]);
    const room = makeRoom(find);

    const a = makeHauler("rh1", room);
    a.memory.remoteContainerId = "c1";

    expect(findRemoteContainer(a)).toBe(container);
    expect(find).not.toHaveBeenCalled();
  });

  it("无 container 时共享缓存同样生效（空窗期是原 bug 的高发场景）", () => {
    const find = vi.fn(() => []);
    const room = makeRoom(find);

    const a = makeHauler("rh1", room);
    const b = makeHauler("rh2", room);

    expect(findRemoteContainer(a)).toBeUndefined();
    expect(findRemoteContainer(b)).toBeUndefined();
    expect(find).toHaveBeenCalledTimes(1);
  });
});
