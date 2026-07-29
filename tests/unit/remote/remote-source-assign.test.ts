/**
 * 远矿 harvester source 占用分散测试（组②-2b / E-1）。
 *
 * 背景：原 getRemoteSource 单纯选最近 source + 入房位置偏置 → 2-source 房两只
 * harvester 挤同一 source，第二源白白再生浪费。修复后按兄弟 harvester 的
 * sourceId 占用统计分配，多只稳定散布到不同 source。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRemoteSource } from "../../../src/creeps/roles/remote-harvester";
import { mockCreep, mockSource, resetGlobals } from "../../role-helpers";

const targetRoom = "W2N1";

beforeEach(() => {
  resetGlobals();
});

/** 构造一只在远矿房内的 remoteHarvester（room.find(FIND_SOURCES) 返回给定 source）。 */
function makeHarvester(name: string, sources: unknown[]) {
  const creep = mockCreep({ name, role: "remoteHarvester" });
  creep.memory.remoteTarget = targetRoom;
  creep.room = { name: targetRoom, find: vi.fn((t: number) => (t === FIND_SOURCES ? sources : [])) };
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
