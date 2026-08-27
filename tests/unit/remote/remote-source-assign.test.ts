/** 远矿 harvester source 占用分散测试（组②-2b / E-1）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRemoteSource } from "../../../src/creeps/roles/remote-harvester";
import { mockCreep, mockSource, resetGlobals } from "../../role-helpers";

const targetRoom = "W2N1";

beforeEach(() => {
  resetGlobals();
});

/** 构造一只在远矿房内的 remoteHarvester。
 *  find(FIND_SOURCES) 返回给定 source；find(FIND_MY_CREEPS) 动态读 Game.creeps
 *  模拟本房兄弟可见性（P2-O 后 occupancy 统计走本房 find 而非全帝国遍历）。
 */
function makeHarvester(name: string, sources: unknown[]) {
  const creep = mockCreep({ name, role: "remoteHarvester" });
  creep.memory.remoteTarget = targetRoom;
  creep.room = {
    name: targetRoom,
    find: vi.fn((t: number) => {
      if (t === FIND_SOURCES) return sources;
      // P2-O：occupancy 统计改为 creep.room.find(FIND_MY_CREEPS)。
      //   mock 动态返回 Game.creeps —— 模拟"本房兄弟可见"。
      if (t === FIND_MY_CREEPS) return Object.values((globalThis as any).Game.creeps ?? {});
      return [];
    }),
  };
  return creep;
}

describe("remote-harvester — getRemoteSource 占用分散", () => {
  it("2-source 房两只 harvester 分绑不同 source", () => {
    const g = globalThis as any;
    const srcA = mockSource("srcA");
    const srcB = mockSource("srcB");
    const sources = [srcA, srcB];

    const h1 = makeHarvester("rh-1", sources);
    const h2 = makeHarvester("rh-2", sources);
    g.Game.creeps = { "rh-1": h1, "rh-2": h2 };

    const s1 = getRemoteSource(h1); // 首绑：占用全 0，按名哈希起点选一个。
    const s2 = getRemoteSource(h2); // 次绑：h1 已占其一，选另一个。

    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(h1.memory.sourceId).not.toBe(h2.memory.sourceId);
  });

  it("单源房两只 harvester 都绑唯一 source（无第二源可分）", () => {
    const g = globalThis as any;
    const only = mockSource("srcOnly");
    const h1 = makeHarvester("rh-1", [only]);
    const h2 = makeHarvester("rh-2", [only]);
    g.Game.creeps = { "rh-1": h1, "rh-2": h2 };

    expect(getRemoteSource(h1)?.id).toBe("srcOnly");
    expect(getRemoteSource(h2)?.id).toBe("srcOnly");
  });

  it("缓存的 sourceId 稳定复用（不每 tick 重分配）", () => {
    const g = globalThis as any;
    const srcA = mockSource("srcA");
    const srcB = mockSource("srcB");
    const h1 = makeHarvester("rh-1", [srcA, srcB]);
    g.Game.creeps = { "rh-1": h1 };

    const first = getRemoteSource(h1);
    const cachedId = h1.memory.sourceId;
    const second = getRemoteSource(h1);
    expect(second?.id).toBe(cachedId);
    expect(second).toBe(first);
  });
});

// P2-O：occupancy 统计从 Object.values(Game.creeps) 收窄到 creep.room.find(FIND_MY_CREEPS)。
//   验证他房兄弟（在过路房但 remoteTarget 指向本房）不计入 occupancy —
//   这是性能优化的核心语义差异（罕见场景下可能短暂选同一 source，下 tick 自愈）。
describe("remote-harvester — P2-O occupancy 收窄到本房", () => {
  it("他房兄弟已绑 sourceId → 不计入 occupancy（当前 creep 不避开）", () => {
    const g = globalThis as any;
    const srcA = mockSource("srcA");
    const srcB = mockSource("srcB");

    // 当前 creep h1 在 target 房，无 sourceId（首绑）。
    // room.find(FIND_MY_CREEPS) 只返回本房 creep（[h1]）— h_other 不在 h1.room。
    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester" });
    h1.memory.remoteTarget = targetRoom;
    h1.room = {
      name: targetRoom,
      find: vi.fn((t: number) => {
        if (t === FIND_SOURCES) return [srcA, srcB];
        if (t === FIND_MY_CREEPS) return [h1]; // 只本房 creep
        return [];
      }),
    };

    // 他房兄弟 h_other 在过路房 W1N1，remoteTarget=targetRoom，已绑 srcA。
    const hOther = mockCreep({ name: "rh-other", role: "remoteHarvester" });
    hOther.memory.remoteTarget = targetRoom;
    hOther.memory.sourceId = "srcA";
    hOther.room = { name: "W1N1" };

    g.Game.creeps = { "rh-1": h1, "rh-other": hOther };

    const chosen = getRemoteSource(h1);

    // 名哈希 "rh-1" % 2 = 0 → 起点指向 srcA。occupancy 空（h_other 不计入）→ 选 srcA。
    //   旧实现（Object.values(Game.creeps)）：h_other 计入 occupancy[srcA]=1 → 避开 srcA 选 srcB。
    //   新实现（creep.room.find(FIND_MY_CREEPS)）：h_other 不在本房 → occupancy 空 → 选 srcA。
    expect(chosen?.id).toBe("srcA");
    expect(h1.memory.sourceId).toBe("srcA");
  });

  it("本房兄弟已绑 sourceId → 计入 occupancy（当前 creep 避开）", () => {
    const g = globalThis as any;
    const srcA = mockSource("srcA");
    const srcB = mockSource("srcB");

    // 本房已有兄弟 h_local 绑了 srcA。
    const hLocal = mockCreep({ name: "rh-local", role: "remoteHarvester" });
    hLocal.memory.remoteTarget = targetRoom;
    hLocal.memory.sourceId = "srcA";
    hLocal.room = {
      name: targetRoom,
      find: vi.fn((t: number) => {
        if (t === FIND_SOURCES) return [srcA, srcB];
        if (t === FIND_MY_CREEPS) return [hLocal]; // 本房有兄弟
        return [];
      }),
    };

    // 当前 creep h1 也在 target 房，首绑。
    // room.find(FIND_MY_CREEPS) 返回本房所有 creep（含 hLocal + h1）。
    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester" });
    h1.memory.remoteTarget = targetRoom;
    h1.room = {
      name: targetRoom,
      find: vi.fn((t: number) => {
        if (t === FIND_SOURCES) return [srcA, srcB];
        if (t === FIND_MY_CREEPS) return [hLocal, h1];
        return [];
      }),
    };

    g.Game.creeps = { "rh-1": h1, "rh-local": hLocal };

    const chosen = getRemoteSource(h1);

    // hLocal 占了 srcA → occupancy[srcA]=1 → h1 避开 srcA 选 srcB。
    expect(chosen?.id).toBe("srcB");
    expect(h1.memory.sourceId).toBe("srcB");
  });
});

// ─── v33-R11：物理站桩占用 + 锁死改绑自愈 ─────────────────────────

describe("remote-harvester — v33-R11 绑定自愈", () => {
  /** 带独立坐标的 source，getRangeTo 按 Chebyshev 距离计算。 */
  function posSource(id: string, x: number, y: number): any {
    const s = mockSource(id);
    s.pos = {
      x, y, roomName: targetRoom,
      getRangeTo: vi.fn((t: any) => {
        const tx = t.x ?? t.pos?.x ?? 0;
        const ty = t.y ?? t.pos?.y ?? 0;
        return Math.max(Math.abs(tx - x), Math.abs(ty - y));
      }),
    };
    return s;
  }

  /** 把 creep 的 pos 换成带坐标版本（getRangeTo 按 Chebyshev，
   *  兼容 RoomPosition 与 RoomObject 两种目标形态）。 */
  function placeCreep(creep: any, x: number, y: number): void {
    creep.pos = {
      x, y, roomName: targetRoom,
      getRangeTo: vi.fn((t: any) => {
        const tx = t.x ?? t.pos?.x ?? 0;
        const ty = t.y ?? t.pos?.y ?? 0;
        return Math.max(Math.abs(tx - x), Math.abs(ty - y));
      }),
    };
  }

  function makeRoom(creepsInRoom: any[], sources: any[]): any {
    return {
      name: targetRoom,
      find: vi.fn((t: number) => {
        if (t === FIND_SOURCES) return sources;
        if (t === FIND_MY_CREEPS) return creepsInRoom;
        return [];
      }),
    };
  }

  it("未绑定的兄弟物理站桩于 source 旁 → 计入占用（首绑避开）", () => {
    const g = globalThis as any;
    const srcA = posSource("srcA", 10, 10);
    const srcB = posSource("srcB", 30, 30);

    // 兄弟 h2 未写 sourceId，但已站桩在 srcA 旁（range 1）→ 物理占用。
    const h2 = mockCreep({ name: "rh-2", role: "remoteHarvester" });
    h2.memory.remoteTarget = targetRoom;
    placeCreep(h2, 11, 10); // 距 srcA (10,10) = 1，距 srcB = 19

    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester" });
    h1.memory.remoteTarget = targetRoom;
    placeCreep(h1, 9, 11);
    const room = makeRoom([h1, h2], [srcA, srcB]);
    h1.room = room;
    h2.room = room;
    g.Game.creeps = { "rh-1": h1, "rh-2": h2 };

    const chosen = getRemoteSource(h1);

    // h2 物理站桩 srcA → h1 避开 srcA 选 srcB（同 tick 首绑竞态兜底）。
    expect(chosen?.id).toBe("srcB");
    expect(h1.memory.sourceId).toBe("srcB");
  });

  it("锁死（stuck≥3 且 range>1）+ 存在无主 source → 改绑过去", () => {
    const g = globalThis as any;
    const srcA = posSource("srcA", 10, 10);
    const srcB = posSource("srcB", 30, 30);

    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "srcA" });
    h1.memory.remoteTarget = targetRoom;
    h1.memory.stuckTicks = 3;
    placeCreep(h1, 10, 20); // 距 srcA=10（>1），够不到
    const room = makeRoom([h1], [srcA, srcB]);
    h1.room = room;
    g.Game.creeps = { "rh-1": h1 };

    const chosen = getRemoteSource(h1);

    // srcB 无兄弟占用 → 改绑 srcB，终结「挤占+空缺」。
    expect(chosen?.id).toBe("srcB");
    expect(h1.memory.sourceId).toBe("srcB");
  });

  it("锁死但另一源已被兄弟占用 → 保持原绑定（不抢兄弟的源）", () => {
    const g = globalThis as any;
    const srcA = posSource("srcA", 10, 10);
    const srcB = posSource("srcB", 30, 30);

    const h2 = mockCreep({ name: "rh-2", role: "remoteHarvester", sourceId: "srcB" });
    h2.memory.remoteTarget = targetRoom;
    placeCreep(h2, 30, 30);

    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "srcA" });
    h1.memory.remoteTarget = targetRoom;
    h1.memory.stuckTicks = 3;
    placeCreep(h1, 10, 20);
    const room = makeRoom([h1, h2], [srcA, srcB]);
    h1.room = room;
    h2.room = room;
    g.Game.creeps = { "rh-1": h1, "rh-2": h2 };

    expect(getRemoteSource(h1)?.id).toBe("srcA");
    expect(h1.memory.sourceId).toBe("srcA");
  });

  it("改绑冷却：改绑后立即重评不会改回去（防 A↔B 振荡）", () => {
    const g = globalThis as any;
    const srcA = posSource("srcA", 10, 10);
    const srcB = posSource("srcB", 30, 30);

    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "srcA" });
    h1.memory.remoteTarget = targetRoom;
    h1.memory.stuckTicks = 3;
    placeCreep(h1, 30, 20); // 改绑到 srcB 后仍在 range>1（够不到 srcB）
    const room = makeRoom([h1], [srcA, srcB]);
    h1.room = room;
    g.Game.creeps = { "rh-1": h1 };

    expect(getRemoteSource(h1)?.id).toBe("srcB"); // 首轮改绑 srcB
    // 冷却期内：srcA 现在「空缺」，但不得立刻改回去。
    expect(getRemoteSource(h1)?.id).toBe("srcB");
    expect(h1.memory.sourceId).toBe("srcB");

    // 冷却过期后允许再次改绑（仍锁死在新源时）。
    g.Game.time += 250;
    const again = getRemoteSource(h1);
    expect(again?.id).toBe("srcA"); // 200 tick 后允许改回 srcA（此时 A 空缺）
  });

  it("单源房锁死：无第二源可分，保持原绑定", () => {
    const g = globalThis as any;
    const only = posSource("srcOnly", 10, 10);
    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "srcOnly" });
    h1.memory.remoteTarget = targetRoom;
    h1.memory.stuckTicks = 5;
    placeCreep(h1, 10, 20);
    const room = makeRoom([h1], [only]);
    h1.room = room;
    g.Game.creeps = { "rh-1": h1 };

    expect(getRemoteSource(h1)?.id).toBe("srcOnly");
    expect(h1.memory.sourceId).toBe("srcOnly");
  });

  it("未锁死（range≤1 或 stuck<3）→ 缓存稳定复用，不触发改绑", () => {
    const g = globalThis as any;
    const srcA = posSource("srcA", 10, 10);
    const srcB = posSource("srcB", 30, 30);
    const h1 = mockCreep({ name: "rh-1", role: "remoteHarvester", sourceId: "srcA" });
    h1.memory.remoteTarget = targetRoom;
    placeCreep(h1, 11, 10); // range 1 — 在矿位
    const room = makeRoom([h1], [srcA, srcB]);
    h1.room = room;
    g.Game.creeps = { "rh-1": h1 };

    expect(getRemoteSource(h1)?.id).toBe("srcA");
    expect(h1.memory.sourceId).toBe("srcA");
  });
});
