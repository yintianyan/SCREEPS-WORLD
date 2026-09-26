/**
 * B4 — recovery 的暂停请求与 op-lifecycle 的状态所有权交接。
 *
 * 钉住三件事：
 *   1. `state` 只由属主写；recovery 留的是有截止时刻的请求（见 recovery-execution-system）。
 *   2. 废弃计时以 `stateSince`（进入该状态多久）为起点，不是 `lastSeen`（最后一次看见）。
 *      混用的后果：一个早已失明、刚被恢复系统主动暂停的矿点，会在重新可见的同一
 *      tick 被判定"暂停超过 3×staleThreshold"而直接废弃。
 *   3. 节流窗口内不得被"看见 creep 就恢复"撤销 —— 否则两个系统逐周期互相改写。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainExistingOps } from "../../../src/systems/remote/op-lifecycle";
import { CONFIG } from "../../../src/config";

const HOME = "W1N1";
const TARGET = "W2N2";
const TICK = 100_000;

function op(overrides: Partial<RemoteOp> = {}): RemoteOp {
  return {
    state: "active",
    createdAt: 0,
    lastSeen: TICK,
    ...overrides,
  };
}

/** 给 TARGET 装一个"有自己 creep 在场"的视野。 */
function withCreepInTarget(): void {
  (globalThis as Record<string, any>).Game.rooms[TARGET] = {
    find: () => [{ memory: {} }],
    controller: { owner: undefined },
    terminal: undefined,
    storage: undefined,
  };
}

function run(remoteOps: Record<string, RemoteOp>): void {
  maintainExistingOps(remoteOps, HOME, undefined, TICK);
}

beforeEach(() => {
  (globalThis as Record<string, any>).Game = {
    time: TICK,
    rooms: {},
    creeps: {},
    map: { getRoomLinearDistance: () => 1 },
  };
  (globalThis as Record<string, any>).Memory = { rooms: { [HOME]: {} }, kernel: {} };
});

describe("recovery 暂停请求 → 属主落地", () => {
  it("请求被属主写成 paused，并刷新 stateSince", () => {
    const o = op({ recoveryPauseUntil: TICK + CONFIG.remote.staleThreshold });
    run({ [TARGET]: o });
    expect(o.state).toBe("paused");
    expect(o.stateSince).toBe(TICK);
  });

  it("失明的 active op 被恢复系统暂停时，不得在同一 tick 被判死", () => {
    // lastSeen 远早于 3×staleThreshold：旧写法以 lastSeen 当"暂停了多久"，
    // 于是暂停与废弃发生在同一次调用里，矿点当场消失且没有任何可复原的痕迹。
    const stale = CONFIG.remote.staleThreshold * 4;
    const o = op({
      lastSeen: TICK - stale,
      recoveryPauseUntil: TICK + CONFIG.remote.staleThreshold,
    });
    run({ [TARGET]: o });
    expect(o.state).toBe("paused");
    expect(o.stateSince).toBe(TICK);
  });

  it("节流窗口内不因 creep 到场而复活（防两个系统逐周期互相撤销）", () => {
    withCreepInTarget();
    const o = op({
      state: "paused",
      stateSince: TICK - 10,
      lastSeen: TICK - 10,
      recoveryPauseUntil: TICK + 100,
    });
    run({ [TARGET]: o });
    expect(o.state).toBe("paused");
  });

  it("窗口过期 + creep 到场 → 恢复 active", () => {
    withCreepInTarget();
    const o = op({
      state: "paused",
      stateSince: TICK - 10,
      lastSeen: TICK - 10,
      recoveryPauseUntil: TICK - 1,
    });
    run({ [TARGET]: o });
    expect(o.state).toBe("active");
    expect(o.lastSeen).toBe(TICK);
  });

  it("常规超时通道未被放松：暂停已久且无 creep 仍然废弃", () => {
    const stale = CONFIG.remote.staleThreshold * 4;
    const o = op({ state: "paused", lastSeen: TICK - stale, stateSince: TICK - stale });
    run({ [TARGET]: o });
    expect(o.state).toBe("abandoned");
  });
});
