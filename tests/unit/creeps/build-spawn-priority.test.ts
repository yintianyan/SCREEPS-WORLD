/** R669：在建 spawn 工地全局优先（否则新房 spawn 永远被 extension/container 抢工时）。 */
import { describe, expect, it } from "vitest";
import { buildNearestSite } from "../../../src/creeps/engine/actions/build";

function site(id: string, type: string, x: number, y: number) {
  return { id, structureType: type, pos: { x, y } };
}

function makeAc(sites: any[], cached?: string): any {
  const creep = {
    memory: { targetId: cached },
    pos: {
      findClosestByRange: (arr: any[]) => arr.reduce((a, b) => (dist(a) <= dist(b) ? a : b)),
    },
  };
  const dist = (s: any) => Math.abs(s.pos.x - 10) + Math.abs(s.pos.y - 10);
  return {
    creep,
    snapshot: { myConstructionSites: sites },
    budget: { tier: "healthy" },
  } as any;
}

describe("buildNearestSite — R669 spawn 优先", () => {
  it("extension 更近时仍先建 spawn", () => {
    const ext = site("e1", STRUCTURE_EXTENSION, 11, 10);
    const spawn = site("s1", STRUCTURE_SPAWN, 30, 30);
    const ac = makeAc([ext, spawn]);
    expect(buildNearestSite().resolve!(ac)?.id).toBe("s1");
  });

  it("缓存目标是 extension，但出现 spawn 工地 ⇒ 改投 spawn", () => {
    const ext = site("e1", STRUCTURE_EXTENSION, 11, 10);
    const spawn = site("s1", STRUCTURE_SPAWN, 30, 30);
    (globalThis as any).Game = {
      getObjectById: (id: string) => [ext, spawn].find(s => s.id === id),
    };
    const ac = makeAc([ext, spawn], "e1");
    expect(buildNearestSite().resolve!(ac)?.id).toBe("s1");
  });

  it("无 spawn 工地时按最近的选", () => {
    const ext = site("e1", STRUCTURE_EXTENSION, 11, 10);
    const ext2 = site("e2", STRUCTURE_EXTENSION, 20, 20);
    const ac = makeAc([ext, ext2]);
    expect(buildNearestSite().resolve!(ac)?.id).toBe("e1");
  });
});
