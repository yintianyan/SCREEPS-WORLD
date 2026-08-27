/** 异房归位（parkInForeignRoom）单测 — 2026-08-19「交通阻塞」修复的回归锁。 */
import { describe, it, expect, beforeEach } from "vitest";
import { parkIdleCreep } from "../../../src/creeps/movement";
import { resetGlobals } from "../../role-helpers";
import { globalCache } from "../../../src/kernel/global-cache";

const HOME = "W1N1";

/** 极简 Room mock：默认全平原，可标记墙/creep/阻挡结构。 */
function makeRoom(name: string): any {
  const terrain = new Uint8Array(2500);
  const creepsAt = new Map<number, any[]>();
  const structsAt = new Map<number, any[]>();
  return {
    name,
    getTerrain: () => ({ get: (x: number, y: number) => terrain[x * 50 + y] }),
    lookForAt: (type: any, x: number, y: number) => {
      if (type === LOOK_CREEPS) return creepsAt.get(x * 50 + y) ?? [];
      if (type === LOOK_STRUCTURES) return structsAt.get(x * 50 + y) ?? [];
      return [];
    },
    getPositionAt: (x: number, y: number) => ({ x, y, roomName: name }),
    __terrain: terrain,
    __creepsAt: creepsAt,
    __structsAt: structsAt,
  };
}

/** 极简 Creep mock：move 直接更新 pos（traffic 关闭时 registerMove 直通 move）。 */
function makeCreep(name: string, room: any, x: number, y: number): any {
  const c: any = {
    name,
    memory: {},
    fatigue: 0,
    room,
    pos: { x, y, roomName: room.name },
    move: (dir: number) => {
      const delta: Record<number, [number, number]> = {
        1: [0, -1], 2: [1, -1], 3: [1, 0], 4: [1, 1],
        5: [0, 1], 6: [-1, 1], 7: [-1, 0], 8: [-1, -1],
      };
      const d = delta[dir];
      if (!d) return -6;
      c.pos.x += d[0];
      c.pos.y += d[1];
      return 0;
    },
  };
  c.pos.getDirectionTo = (t: { x: number; y: number }) => {
    const dx = Math.sign(t.x - c.pos.x);
    const dy = Math.sign(t.y - c.pos.y);
    const table: Record<string, number> = {
      "0,-1": 1, "1,-1": 2, "1,0": 3, "1,1": 4,
      "0,1": 5, "-1,1": 6, "-1,0": 7, "-1,-1": 8,
    };
    return table[`${dx},${dy}`] ?? 3;
  };
  return c;
}

/** home 快照 mock — 异房分支只读 roomName；home 分支需空集合字段。 */
const homeSnapshot: any = {
  roomName: HOME,
  sources: [], spawns: [], controller: undefined, storage: undefined,
  extensions: [], towers: [], containers: [], roads: [], walls: [],
  ramparts: [], links: [], labs: [], myConstructionSites: [],
};

beforeEach(() => {
  resetGlobals();
});

describe("Parking — 异房归位（远矿/过境房启发式）", () => {
  it("边界格 (1,28) 的异房 creep 必须内移离开走廊带", () => {
    const room = makeRoom("W2N1");
    const c = makeCreep("c1", room, 1, 28);
    parkIdleCreep(c, homeSnapshot);
    // 单步内移 — 离开走廊带（x ≥2），y 在 27-29 邻域内即可（斜向合法）。
    expect(c.pos.x).toBeGreaterThanOrEqual(2);
    expect(Math.abs(c.pos.y - 28)).toBeLessThanOrEqual(1);
  });

  it("东走廊格 (48,30) → 内移到 x=47", () => {
    const room = makeRoom("W2N1");
    const c = makeCreep("c1", room, 48, 30);
    parkIdleCreep(c, homeSnapshot);
    expect(c.pos.x).toBe(47);
    expect(Math.abs(c.pos.y - 30)).toBeLessThanOrEqual(1);
  });

  it("已离开走廊带 (10,30) → 原地预约不动", () => {
    const room = makeRoom("W2N1");
    const c = makeCreep("c1", room, 10, 30);
    parkIdleCreep(c, homeSnapshot);
    expect(c.pos.x).toBe(10);
    expect(c.pos.y).toBe(30);
    // 预约缓存写入（防同 tick 重复寻路/防聚堆）。
    expect((globalCache() as any).__parkReservations.has(10 * 50 + 30)).toBe(true);
  });

  it("内移候选避开墙与阻挡结构", () => {
    const room = makeRoom("W2N1");
    // (2,28) 东侧 (3,28) 是墙 → 应选其他内移格（如 (2,27)/(2,29) 若可走）。
    room.__terrain[3 * 50 + 28] = 1; // TERRAIN_MASK_WALL
    const c = makeCreep("c1", room, 2, 28);
    parkIdleCreep(c, homeSnapshot);
    expect(c.pos.x === 3 && c.pos.y === 28).toBe(false); // 没走进墙。
    expect(c.pos.x).toBeGreaterThanOrEqual(2);
  });

  it("内移候选避开被 creep 占据的格（预约互斥）", () => {
    const room = makeRoom("W2N1");
    const blocker = { name: "other" };
    room.__creepsAt.set(3 * 50 + 28, [blocker]);
    const c = makeCreep("c1", room, 2, 28);
    parkIdleCreep(c, homeSnapshot);
    expect(c.pos.x === 3 && c.pos.y === 28).toBe(false); // 没踩上被占格。
  });

  it("home 房 creep 不走异房分支（回归保护）", () => {
    // home 房行为由 parking.test.ts 地形矩阵覆盖；此处仅验证分流：
    // home 房 + 边界格 creep 走原逻辑（快照关键格判定），不因本改动改变入口。
    const room = makeRoom(HOME);
    const c = makeCreep("c1", room, 1, 28);
    parkIdleCreep(c, homeSnapshot);
    // 原逻辑：开阔无结构 → (1,28) 非 critical 非 road → 「已安全」原地不动。
    expect(c.pos.x).toBe(1);
    expect(c.pos.y).toBe(28);
  });
});
