/** 孤儿工地清扫测试（Phase 3）。 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  computeSiteKeepRooms,
  cleanOrphanConstructionSites,
} from "../../../src/systems/construction-manager";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

function siteIn(roomName: string) {
  return { pos: { roomName }, remove: vi.fn() };
}

describe("computeSiteKeepRooms — 保留集", () => {
  it("己方殖民地 + 非 abandoned 远矿目标 + 扩张目标保留；abandoned 远矿与他人房不保留", () => {
    const g = globalThis as any;
    g.Game.rooms = {
      W7N4: { controller: { my: true } },
      W1N1: { controller: { my: false } }, // 有视野但非我方
    };
    g.Memory.rooms = {
      W7N4: { remoteOps: { W8N3: { state: "active" }, W6N3: { state: "abandoned" } } },
      W7N3: { remoteOps: { W8N5: { state: "paused" } } },
    };
    g.Memory.kernel = { expansion: { target: "W9N9" } };

    const keep = computeSiteKeepRooms();
    expect(keep.has("W7N4")).toBe(true); // 己方殖民地
    expect(keep.has("W8N3")).toBe(true); // active 远矿
    expect(keep.has("W8N5")).toBe(true); // paused 远矿（非 abandoned）
    expect(keep.has("W9N9")).toBe(true); // 扩张目标
    expect(keep.has("W6N3")).toBe(false); // abandoned 远矿 → 不保留
    expect(keep.has("W1N1")).toBe(false); // 他人房 → 不保留
  });
});

describe("cleanOrphanConstructionSites — 孤儿清扫", () => {
  it("孤儿房工地被移除，保留集房工地不动（W6N3 spawn/container 孤儿场景）", () => {
    const g = globalThis as any;
    g.Game.rooms = { W7N4: { controller: { my: true } } };
    g.Memory.rooms = { W7N4: { remoteOps: { W8N3: { state: "active" } } } };
    g.Memory.kernel = {};

    const ownedSite = siteIn("W7N4"); // 己方殖民地工地 — 保留
    const remoteSite = siteIn("W8N3"); // 活跃远矿工地 — 保留
    const orphanSpawn = siteIn("W6N3"); // 无主房孤儿 spawn — 删
    const orphanContainer = siteIn("W6N3"); // 无主房孤儿 container — 删
    g.Game.constructionSites = { a: ownedSite, b: remoteSite, c: orphanSpawn, d: orphanContainer };

    cleanOrphanConstructionSites();

    expect(ownedSite.remove).not.toHaveBeenCalled();
    expect(remoteSite.remove).not.toHaveBeenCalled();
    expect(orphanSpawn.remove).toHaveBeenCalledTimes(1);
    expect(orphanContainer.remove).toHaveBeenCalledTimes(1);
  });

  it("无孤儿时不误删任何工地", () => {
    const g = globalThis as any;
    g.Game.rooms = { W7N4: { controller: { my: true } } };
    g.Memory.rooms = {};
    g.Memory.kernel = {};
    const s = siteIn("W7N4");
    g.Game.constructionSites = { a: s };

    cleanOrphanConstructionSites();
    expect(s.remove).not.toHaveBeenCalled();
  });
});
