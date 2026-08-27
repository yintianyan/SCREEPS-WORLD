/** 泵断供兜底测试 — distributor 归零时 hauler 的 fillStorage 让位直送。 */
import { beforeEach, describe, expect, it } from "vitest";
import { fillStorage } from "../../../src/creeps/engine/actions/fill";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../role-helpers";

function makeAc(overrides: { fillTargets?: any[]; storage?: any } = {}): any {
  const storage = overrides.storage ?? mockStructure("storage", { id: "st", energy: 30000, capacity: 1000000 });
  return {
    creep: mockCreep({ role: "hauler", home: "W7N4" }),
    snapshot: mockSnapshot({
      storage,
      fillTargets: overrides.fillTargets ?? [],
    }),
    assignment: undefined,
    budget: undefined,
    ctx: undefined,
  };
}

const setPumpRooms = (rooms: string[] | undefined): void => {
  // 经 globalCache 访问器写入 — 不依赖「globalCache 即 globalThis」的实现细节。
  globalCache().distributorRooms = rooms === undefined ? undefined : new Set(rooms);
};

beforeEach(() => {
  resetGlobals();
  setPumpRooms(undefined);
});

describe("fillStorage — 泵断供让位", () => {
  it("泵在岗：照常囤积 storage", () => {
    setPumpRooms(["W7N4"]);
    const ac = makeAc({ fillTargets: [mockStructure("extension", { energy: 0, capacity: 50 })] });

    expect(fillStorage().resolve!(ac)).toBe(ac.snapshot.storage);
  });

  it("泵断供 + spawn/extension 有缺口：让位（resolve undefined，放行直送）", () => {
    setPumpRooms([]); // 集合存在但不含 W7N4 = 断供。
    const ac = makeAc({ fillTargets: [mockStructure("extension", { energy: 0, capacity: 50 })] });

    expect(fillStorage().resolve!(ac)).toBeUndefined();
  });

  it("泵断供但核心 sink 无缺口：照常囤积（不为 controllerContainer 让位）", () => {
    setPumpRooms([]);
    const ac = makeAc({ fillTargets: [mockStructure("container", { energy: 100, capacity: 2000 })] });

    expect(fillStorage().resolve!(ac)).toBe(ac.snapshot.storage);
  });

  it("集合缺失（reset 首 tick / 精简环境）：默认泵在岗，维持原行为", () => {
    setPumpRooms(undefined);
    const ac = makeAc({ fillTargets: [mockStructure("extension", { energy: 0, capacity: 50 })] });

    expect(fillStorage().resolve!(ac)).toBe(ac.snapshot.storage);
  });
});
