/**
 * 远矿「废弃墓碑」测试 —— 8 条废弃路径必须各留一块可归因的碑。
 *
 * 立案理由（线上实证）：W37S55 的 remoteOps 从 4 掉到 2，事后查不出那两房叫什么、
 * 为什么被弃 —— abandoned 记录经 staleThreshold×6 被卫生层整条 delete，非自有房的
 * intel 只在 heap，而 8 条路径此前全都只 log 一行文本（其中 3 条连日志都没有）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  maintainExistingOps,
  reevaluateActiveOps,
  censusStalledOps,
  enforceMeasuredEconomics,
} from "../../../src/systems/remote/op-lifecycle";
import { setRemoteOpLedger } from "../../../src/kernel/global-cache";
import { emptyOpLedger } from "../../../src/domain/remote/op-ledger";
import {
  REMOTE_ABANDON,
  pushTombstone,
  type RemoteOpTombstone,
} from "../../../src/domain/remote/op-outcome";
import { CONFIG } from "../../../src/config";
import { resetGlobals, syncSquadIndex } from "../../support/factories";

const HOME = "W1N1";
const T = "W2N2";
const NOW = 100000;
const g = (): any => globalThis as any;

function opOf(overrides: Record<string, unknown> = {}): any {
  return {
    state: "active",
    sources: 2,
    haulerNeed: 1,
    createdAt: NOW - 20000,
    lastSeen: NOW,
    ...overrides,
  };
}

/** 每个用例的统一前置：home 房 Memory + 当前 tick。 */
function seedHome(remoteOps: Record<string, any>): void {
  g().Game.time = NOW;
  g().Memory.rooms[HOME] = { remoteOps, colonyState: "normal", spawnQueue: [] };
}

/** 目标房 mock（maintainExistingOps 会读 controller 与现场 source 数）。 */
function targetRoomMock(extra: Record<string, unknown> = {}): any {
  return { find: () => [], ...extra };
}

function yard(): RemoteOpTombstone[] {
  return g().Memory.rooms[HOME].remoteGraveyard ?? [];
}

beforeEach(() => {
  resetGlobals();
});

describe("pushTombstone — 定长与顺序", () => {
  it("未定义墓地 → 新建；按 cap 丢最旧，保留最新", () => {
    let y = pushTombstone(undefined, { t: "A", r: 0, at: 1 }, 3);
    y = pushTombstone(y, { t: "B", r: 1, at: 2 }, 3);
    y = pushTombstone(y, { t: "C", r: 2, at: 3 }, 3);
    expect(y.map(v => v.t)).toEqual(["A", "B", "C"]);
    y = pushTombstone(y, { t: "D", r: 3, at: 4 }, 3);
    expect(y.map(v => v.t)).toEqual(["B", "C", "D"]);
  });
});

describe("maintainExistingOps — 每条路径各留一块碑", () => {
  it("目标房已有他人 owner → Claimed，w=owner 名", () => {
    const ops = { [T]: opOf() };
    seedHome(ops);
    g().Game.rooms[T] = targetRoomMock({
      controller: { owner: { username: "Rival" }, my: false, level: 3 },
    });
    maintainExistingOps(ops, HOME, undefined, NOW, "me");
    expect(ops[T].state).toBe("abandoned");
    expect(yard()).toHaveLength(1);
    expect(yard()[0]).toMatchObject({ t: T, r: REMOTE_ABANDON.Claimed, at: NOW, w: "Rival" });
    expect(yard()[0]!.d).toEqual([0, 3]);
  });

  it("被自己 claim → 同码但 d[0]=1，并回给调用方回收现役", () => {
    const ops = { [T]: opOf() };
    seedHome(ops);
    g().Game.rooms[T] = targetRoomMock({
      controller: { owner: { username: "me" }, my: true, level: 5 },
    });
    const r = maintainExistingOps(ops, HOME, undefined, NOW, "me");
    expect(r.selfClaimed).toEqual([T]);
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.Claimed);
    expect(yard()[0]!.d?.[0]).toBe(1);
  });

  it("controller 被敌对玩家预定 → HostileReserved，w=预定者", () => {
    const ops = { [T]: opOf() };
    seedHome(ops);
    g().Game.rooms[T] = targetRoomMock({
      controller: { reservation: { username: "Rival" }, my: false },
    });
    const r = maintainExistingOps(ops, HOME, undefined, NOW, "me");
    expect(r.hostileReserved).toEqual([T]);
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.HostileReserved);
    expect(yard()[0]!.w).toBe("Rival");
  });

  it("四出口全封 → SealedAllExits，d=被封方向", () => {
    const ops = { [T]: opOf() };
    seedHome(ops);
    g().Game.rooms[T] = targetRoomMock({ controller: {} });
    maintainExistingOps(
      ops,
      HOME,
      {
        [T]: { kind: "normal", status: "normal", lastSeen: NOW, sealedExits: [1, 3, 5, 7] },
      } as never,
      NOW,
      "me",
    );
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.SealedAllExits);
    expect(yard()[0]!.d).toEqual([1, 3, 5, 7]);
  });

  it("paused 长期无人到站 → PausedTimeout（这条以前完全无痕）", () => {
    const stale = CONFIG.remote.staleThreshold * 3 + 10;
    const ops = { [T]: opOf({ state: "paused", lastSeen: NOW - stale }) };
    seedHome(ops);
    maintainExistingOps(ops, HOME, undefined, NOW, "me");
    expect(ops[T].state).toBe("abandoned");
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.PausedTimeout);
    expect(yard()[0]!.d?.[0]).toBeGreaterThanOrEqual(stale);
  });

  it("同一 op 重复扫到只落一块碑（首次原因不被后到的门冲掉）", () => {
    const ops = { [T]: opOf() };
    seedHome(ops);
    g().Game.rooms[T] = targetRoomMock({
      controller: { owner: { username: "Rival" }, my: false, level: 1 },
    });
    maintainExistingOps(ops, HOME, undefined, NOW, "me");
    maintainExistingOps(ops, HOME, undefined, NOW + 10, "me");
    expect(yard()).toHaveLength(1);
    expect(yard()[0]!.at).toBe(NOW);
  });
});

describe("enforceMeasuredEconomics — 账本两条路径", () => {
  /** 已过承诺期的 op 起点（承诺期内经济门一律不判）。 */
  const MATURE = NOW - CONFIG.remote.minDuration - 1;

  it("零交付且孵化投入烧穿门槛 → ZeroDelivery", () => {
    const ops = { [T]: opOf({ createdAt: MATURE }) };
    seedHome(ops);
    const l = emptyOpLedger(MATURE);
    l.delivered = 0;
    l.spawnCost = CONFIG.remote.zeroDeliverySpawnCost + 1;
    l.infraCost = 5;
    setRemoteOpLedger(HOME, T, l);

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[T].state).toBe("abandoned");
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.ZeroDelivery);
    // d = [零交付时长, spawnCost, infraCost, 门槛]
    expect(yard()[0]!.d?.[1]).toBeGreaterThanOrEqual(CONFIG.remote.zeroDeliverySpawnCost);
    expect(yard()[0]!.d?.[3]).toBe(CONFIG.remote.zeroDeliverySpawnCost);
  });

  it("有交付但净营收为负 → NetRateLoss", () => {
    const ops = { [T]: opOf({ createdAt: MATURE }) };
    seedHome(ops);
    const l = emptyOpLedger(MATURE);
    l.delivered = 10;
    l.spawnCost = 200000;
    l.infraCost = 1000;
    setRemoteOpLedger(HOME, T, l);

    enforceMeasuredEconomics(ops, HOME, NOW);

    expect(ops[T].state).toBe("abandoned");
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.NetRateLoss);
    // d[0] = netRate×100，必须真的是负的才叫亏损收缩
    expect(yard()[0]!.d?.[0]).toBeLessThan(0);
  });
});

describe("墓碑体积守门", () => {
  it("按 CONFIG.remote.graveyardCap 截断，只留最新", () => {
    const cap = CONFIG.remote.graveyardCap;
    const ops: Record<string, any> = {};
    const names: string[] = [];
    for (let i = 0; i < cap + 5; i++) {
      // 房名只是 remoteOps 的 key，maintainExistingOps 不做格式校验。
      const name = `W9S${i}`;
      names.push(name);
      ops[name] = opOf();
    }
    seedHome(ops);
    // 每次只让"当前这一个"房带 owner（其余已 abandoned 的会在循环开头跳过），
    // 于是碑数 == 废弃次数，正好压过 cap 验证"丢最旧、留最新"。
    for (const name of names) {
      g().Game.rooms[name] = targetRoomMock({
        controller: { owner: { username: "Rival" }, my: false, level: 1 },
      });
      maintainExistingOps(ops, HOME, undefined, NOW, "me");
    }
    expect(yard()).toHaveLength(cap);
    expect(yard()[yard().length - 1]!.t).toBe(names[names.length - 1]);
    expect(yard()[0]!.t).toBe(names[5]);
  });
});

describe("reevaluateActiveOps / censusStalledOps — 静态经济与安全网", () => {
  it("静态分长期低于门槛 → LowScore", () => {
    const ops = { [T]: opOf() };
    seedHome(ops);
    // 运力=1 → hauler 吞吐远低于需求，静态净分为负，必然低于 minNetScore
    // （300 档运力配 pathCost=140 的近距房会算出高分，只换 tick 数不触发废弃）。
    // 两次调用跨过 lowScoreGrace：第一次起算、第二次废弃。
    reevaluateActiveOps(ops, {}, HOME, 1, {}, NOW);
    expect(ops[T].lowScoreSince).toBe(NOW);
    reevaluateActiveOps(ops, {}, HOME, 1, {}, NOW + CONFIG.remote.lowScoreGrace + 1);
    expect(ops[T].state).toBe("abandoned");
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.LowScore);
    expect(yard()[0]!.d?.[1]).toBeGreaterThan(CONFIG.remote.lowScoreGrace);
  });

  it("编队全员空转超时 → Stalled，d 带编队数与空转时长", () => {
    const ops = { [T]: opOf({ stallSince: NOW - CONFIG.remote.stallAbandonTicks - 1 }) };
    seedHome(ops);
    g().Game.creeps = {
      r1: {
        name: "r1",
        spawning: false,
        ticksToLive: 1400,
        body: [],
        memory: {
          home: HOME,
          remoteTarget: T,
          role: "remoteHauler",
          mode: "idle",
          stuckTicks: 0,
          recycle: false,
        },
        room: { name: T },
      },
    };
    syncSquadIndex();
    censusStalledOps(ops, HOME, NOW);
    expect(ops[T].state).toBe("abandoned");
    expect(yard()[0]!.r).toBe(REMOTE_ABANDON.Stalled);
    expect(yard()[0]!.d?.[0]).toBe(1); // 编队总数
    expect(yard()[0]!.d?.[1]).toBeGreaterThan(CONFIG.remote.stallAbandonTicks);
  });
});
