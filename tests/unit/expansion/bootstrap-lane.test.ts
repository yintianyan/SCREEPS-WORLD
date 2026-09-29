/**
 * 自举车道的"放掉判据"回归（2026-09-29 第一次自主扩张驱动）。
 *
 * 起因（线上实测 W38S56）：claim 后 148 拍 `colonyState` 就被置成 `"normal"`，而当时
 * `spawns=0`、两个工地 `progress=0`、拓荒队还在隔壁房通勤 —— 车道的防重入门禁
 * （`colonyState==="normal" ⇒ delete bootstrap 账 + continue`）于是把**唯一有效的补给通道**
 * 在还需要它的时候关掉了。
 *
 * 那条门禁的逻辑形状本身就是错的：代码走到它之前已经先过了一遍
 * 「有自有 spawn ⇒ delete + continue」，所以**能到达门禁的房必然没有 spawn** ——
 * 也就是必然还需要代孵。判据应当是"它能不能自己孵"，不是它的 colonyState 叫什么。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runBootstrapLane } from "../../../src/systems/empire/expansion/bootstrap-lane";
import { mockRoomStateCtx, resetGlobals } from "../../support/factories";

const TICK = 200_000;
const COLONY = "W38S56";
const SPONSOR = "W37S58";

/**
 * @param ownSpawns 该房里属于我们的 spawn 数（决定车道第一个分支走不走）
 */
function roomMem(spawnCount: number, colonyState: string): void {
  const G = globalThis as any;
  G.Game.rooms[COLONY] = {
    controller: { my: true, ticksToDowngrade: 18000 },
    find: () => (spawnCount > 0 ? [{}, {}] : []),
  };
  G.Game.rooms[SPONSOR] = {
    controller: { my: true, ticksToDowngrade: 90000 },
    find: () => [{}, {}, {}], // sponsor 恒有自有 spawn
  };
  G.Memory.rooms[COLONY] = { spawnQueue: [], buildQueue: [], colonyState };
  // sponsor 必须同时满足「rcl ≥ sponsorMinRcl」与「colonyState === normal」才会进代孵池。
  G.Memory.rooms[SPONSOR] = { spawnQueue: [], buildQueue: [], colonyState: "normal" };
}

function ctx(): ReturnType<typeof mockRoomStateCtx> {
  return mockRoomStateCtx(
    [
      { roomName: COLONY, rcl: 1, controller: { my: true }, threatCreeps: [] },
      { roomName: SPONSOR, rcl: 8, controller: { my: true }, threatCreeps: [] },
    ] as never,
    TICK,
  );
}

beforeEach(() => {
  resetGlobals();
  const G = globalThis as any;
  G.Game.time = TICK;
  G.Memory.kernel = { bootstrap: {} };
});

describe("bootstrap 车道的放掉判据", () => {
  it("colonyState 被过早置 normal、但房里还没有 spawn ⇒ 继续代孵（不再被放掉）", () => {
    roomMem(0, "normal");

    runBootstrapLane(ctx());

    const G = globalThis as any;
    // 仍被跟踪 ⇒ 有账；且真的往 sponsor 队列里投了拓荒者。
    expect(G.Memory.kernel.bootstrap[COLONY]).toBeDefined();
    const queued = G.Memory.rooms[SPONSOR].spawnQueue.map((r: any) => r.memory.home);
    expect(queued).toContain(COLONY);
  });

  it("代孵必须**连 builder 一起派** —— 只有 builder 能领 build 任务，只派 worker 会让幼房失去建造能力", () => {
    // 线上实证：W38S56 的 4 只 builder 陆续到期（ttl 46/46/200/222），而该房没有 spawn、
    // 自己的队列里也没有任何 builder 请求 ⇒ spawn 工地永久停在 ~4400/15000。
    roomMem(0, "normal");

    runBootstrapLane(ctx());

    const roles = (globalThis as any).Memory.rooms[SPONSOR].spawnQueue.map((r: any) => r.role);
    expect(roles).toContain("builder");
    expect(roles).toContain("worker");
    // 且都归属殖民地，不是给 sponsor 自己补员。
    for (const req of (globalThis as any).Memory.rooms[SPONSOR].spawnQueue) {
      expect(req.memory.home).toBe(COLONY);
      expect(req.survival).toBe(false);
    }
  });

  it("对照组：该房已有自己的 spawn ⇒ 放掉车道，绝不再代孵（这条规则不能被改成永久投喂）", () => {
    roomMem(2, "normal");

    runBootstrapLane(ctx());

    const G = globalThis as any;
    expect(G.Memory.kernel.bootstrap[COLONY]).toBeUndefined();
    expect(G.Memory.rooms[SPONSOR].spawnQueue).toHaveLength(0);
  });
});
