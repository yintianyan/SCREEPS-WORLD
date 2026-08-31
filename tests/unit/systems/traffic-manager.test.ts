/** Traffic Manager 系统测试 — 意图登记双模、tick 末集中解算与统一签发。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../../src/config";
import { trafficManagerSystem } from "../../../src/systems/traffic-manager";
import { getIntentLedger, registerAnchor, registerMove } from "../../../src/creeps/movement/intent";
import { mockContext, resetGlobals } from "../../support/factories";

const setTraffic = (on: boolean): void => {
  (CONFIG.movement as { trafficManager: boolean }).trafficManager = on;
};

/** 由坐标差计算方向常量（测试内简版，与引擎语义一致）。 */
function dirBetween(fx: number, fy: number, tx: number, ty: number): number {
  const dx = Math.sign(tx - fx);
  const dy = Math.sign(ty - fy);
  const table: Record<string, number> = {
    "0,-1": TOP, "1,-1": TOP_RIGHT, "1,0": RIGHT, "1,1": BOTTOM_RIGHT,
    "0,1": BOTTOM, "-1,1": BOTTOM_LEFT, "-1,0": LEFT, "-1,-1": TOP_LEFT,
  };
  return table[`${dx},${dy}`] ?? RIGHT;
}

/** 平地房间 mock：全地形可走 + find 返回己方 creep 列表。 */
function flatRoom(creeps: any[]): any {
  return {
    name: "W7N4",
    getTerrain: () => ({ get: () => 0 }),
    find: vi.fn(() => creeps),
  };
}

function trafficCreep(name: string, x: number, y: number, room: any, mode = "work"): any {
  const creep: any = {
    name,
    my: true,
    fatigue: 0,
    room,
    memory: { mode },
    move: vi.fn(() => 0),
    pos: {
      x, y, roomName: "W7N4",
      getDirectionTo: (tx: number, ty: number) => dirBetween(x, y, tx, ty),
      getRangeTo: () => 5,
      isEqualTo: () => false,
    },
  };
  return creep;
}

beforeEach(() => {
  resetGlobals();
  delete (globalThis as any).__moveIntents;
  delete (globalThis as any).__parkRoomData;
});

afterEach(() => {
  setTraffic(false);
});

describe("intent — 登记双模", () => {
  it("开关关闭：registerMove 直通 creep.move（旧行为回滚通道）", () => {
    setTraffic(false);
    const room = flatRoom([]);
    const creep = trafficCreep("c1", 25, 25, room);

    const result = registerMove(creep, RIGHT as DirectionConstant, 60);

    expect(creep.move).toHaveBeenCalledWith(RIGHT);
    expect(result).toBe(OK);
  });

  it("开关开启：registerMove 只入账不直发；疲劳 creep 返回 ERR_TIRED 不入账", () => {
    setTraffic(true);
    const room = flatRoom([]);
    const creep = trafficCreep("c1", 25, 25, room);

    expect(registerMove(creep, RIGHT as DirectionConstant, 60)).toBe(OK);
    expect(creep.move).not.toHaveBeenCalled();
    expect(getIntentLedger().intents.get("c1")).toEqual({
      from: 25 * 50 + 25, to: 26 * 50 + 25, priority: 60, roomName: "W7N4",
    });

    const tired = trafficCreep("c2", 30, 30, room);
    tired.fatigue = 4;
    expect(registerMove(tired, RIGHT as DirectionConstant, 60)).toBe(ERR_TIRED);
    expect(getIntentLedger().intents.has("c2")).toBe(false);
  });
});

describe("traffic-manager — 解算与签发", () => {
  it("开关关闭：即使账本被手工填充也空转", () => {
    setTraffic(true);
    const room = flatRoom([]);
    const creep = trafficCreep("c1", 25, 25, room);
    (globalThis as any).Game.rooms.W7N4 = room;
    (globalThis as any).Game.creeps.c1 = creep;
    registerMove(creep, RIGHT as DirectionConstant, 60);

    setTraffic(false);
    trafficManagerSystem.run(mockContext());

    expect(creep.move).not.toHaveBeenCalled();
  });

  it("单意图无冲突：签发对应方向的 move 并记录交通热度", () => {
    setTraffic(true);
    const creep = trafficCreep("c1", 25, 25, undefined);
    const room = flatRoom([creep]);
    creep.room = room;
    (globalThis as any).Game.rooms.W7N4 = room;
    (globalThis as any).Game.creeps.c1 = creep;

    registerMove(creep, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(creep.move).toHaveBeenCalledWith(RIGHT);
    expect((globalThis as any).roomTraffic?.W7N4).toBeDefined();
  });

  it("同格争抢：高优先级签发，低优先级本 tick 原地", () => {
    setTraffic(true);
    // high(24,25) 与 low(26,25) 都想进 (25,25)（空格）。
    const high = trafficCreep("high", 24, 25, undefined, "work");
    const low = trafficCreep("low", 26, 25, undefined, "acquire");
    const room = flatRoom([high, low]);
    high.room = room;
    low.room = room;
    (globalThis as any).Game.rooms.W7N4 = room;
    Object.assign((globalThis as any).Game.creeps, { high, low });

    registerMove(low, LEFT as DirectionConstant, 40);
    registerMove(high, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(high.move).toHaveBeenCalledWith(RIGHT);
    expect(low.move).not.toHaveBeenCalled();
  });

  it("推挤静止者：mover 放行、idler 被推到邻格；锚定者不被推", () => {
    setTraffic(true);
    const mover = trafficCreep("mover", 24, 25, undefined, "work");
    const idler = trafficCreep("idler", 25, 25, undefined, "idle");
    const room = flatRoom([mover, idler]);
    mover.room = room;
    idler.room = room;
    (globalThis as any).Game.rooms.W7N4 = room;
    Object.assign((globalThis as any).Game.creeps, { mover, idler });

    registerMove(mover, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(mover.move).toHaveBeenCalledWith(RIGHT);
    expect(idler.move).toHaveBeenCalledTimes(1); // 被推挤到某个可走邻格。

    // 第二轮：idler 换成高优先级锚定者 — 不可推挤，mover 也不放行。
    resetGlobals();
    delete (globalThis as any).__moveIntents;
    const mover2 = trafficCreep("mover2", 24, 25, undefined, "work");
    const miner = trafficCreep("miner", 25, 25, undefined, "acquire");
    const room2 = flatRoom([mover2, miner]);
    mover2.room = room2;
    miner.room = room2;
    (globalThis as any).Game.rooms.W7N4 = room2;
    Object.assign((globalThis as any).Game.creeps, { mover2, miner });

    registerAnchor(miner, CONFIG.movement.trafficPriority.anchorMiner);
    registerMove(mover2, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(mover2.move).not.toHaveBeenCalled();
    expect(miner.move).not.toHaveBeenCalled();
  });

  it("账本跨 tick 失效：过期账本不签发", () => {
    setTraffic(true);
    const creep = trafficCreep("c1", 25, 25, undefined);
    const room = flatRoom([creep]);
    creep.room = room;
    (globalThis as any).Game.rooms.W7N4 = room;
    (globalThis as any).Game.creeps.c1 = creep;

    registerMove(creep, RIGHT as DirectionConstant, 60);
    (globalThis as any).Game.time = 1001; // 账本 tick=1000，已过期。
    trafficManagerSystem.run(mockContext());

    expect(creep.move).not.toHaveBeenCalled();
  });

  // ─── v33：移动失败反馈（静态阻挡 → 立即失效持久化路径）─────────────

  it("引擎拒绝签发（静态阻挡）：立即失效该 creep 的持久化路径，下 tick 强制重算", () => {
    setTraffic(true);
    const creep = trafficCreep("c1", 25, 25, undefined);
    creep.move = vi.fn(() => ERR_INVALID_TARGET);
    const room = flatRoom([creep]);
    creep.room = room;
    const g = globalThis as any;
    g.Game.rooms.W7N4 = room;
    g.Game.creeps.c1 = creep;

    // 种子：该 creep 的持久化路径缓存（线上场景：新墙落成后陈旧路径撞墙）。
    g.__creepPathCache = {
      c1: { targetKey: 1, structRevision: 1, path: [{ x: 26, y: 25, roomName: "W7N4" }] },
    };

    registerMove(creep, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(creep.move).toHaveBeenCalledWith(RIGHT);
    expect(g.__creepPathCache.c1).toBeUndefined(); // 已失效 → 下一 tick PathFinder 绕墙重算
  });

  it("ERR_BUSY（孵化中）：不失效路径缓存", () => {
    setTraffic(true);
    const creep = trafficCreep("c1", 25, 25, undefined);
    creep.move = vi.fn(() => ERR_BUSY);
    const room = flatRoom([creep]);
    creep.room = room;
    const g = globalThis as any;
    g.Game.rooms.W7N4 = room;
    g.Game.creeps.c1 = creep;
    g.__creepPathCache = {
      c1: { targetKey: 1, structRevision: 1, path: [{ x: 26, y: 25, roomName: "W7N4" }] },
    };

    registerMove(creep, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(g.__creepPathCache.c1).toBeDefined(); // BUSY 是孵化瞬态，不清缓存
  });

  it("正常签发（OK）：路径缓存不动", () => {
    setTraffic(true);
    const creep = trafficCreep("c1", 25, 25, undefined);
    const room = flatRoom([creep]);
    creep.room = room;
    const g = globalThis as any;
    g.Game.rooms.W7N4 = room;
    g.Game.creeps.c1 = creep;
    g.__creepPathCache = {
      c1: { targetKey: 1, structRevision: 1, path: [{ x: 26, y: 25, roomName: "W7N4" }] },
    };

    registerMove(creep, RIGHT as DirectionConstant, 60);
    trafficManagerSystem.run(mockContext());

    expect(g.__creepPathCache.c1).toBeDefined();
  });
});
