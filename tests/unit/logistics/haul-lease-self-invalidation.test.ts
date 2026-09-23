/**
 * 回归 —— haul 任务不得因为「自己的租约把并发占满」而出池。
 *
 * 线上症状：事件环每 tick 一对 AssignmentExpired(d=[4]＝任务已出池) + AssignmentAssigned，
 * W37S58 两只 hauler 的一只在两个 container 间来回甩（`assignedAt` 每 tick 刷新）——
 * 一半本地运力在空转。
 * 根因是层间错位：请求池用「占满就不生成请求」表达并发，而这张池同时是 assignment
 * 有效性（AS-1）的唯一判据 ⇒ 持有者用自己的租约把自己的任务抹掉，下一 tick 被自己判死。
 * 并发改由任务条目的 assignedCreeps/maxWorkers 在**选择时**挡（选择器本来就有这道门）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { logisticsSystem } from "../../../src/systems/room/logistics";
import { globalCache } from "../../../src/kernel/global-cache";
import type { AssignmentTaskEntry } from "../../../src/domain/assignment/service";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

const HOME = "W1N1";
const CID = "container_src_1";
const TASK = `collect:${HOME}:${CID}`;
const HOLDER = "hauler-W1N1-0";
const g = (): any => globalThis as any;

function holderAssigned(tick: number): void {
  const hauler = mockCreep({
    name: HOLDER,
    role: "hauler",
    home: HOME,
    mode: "acquire",
    assignment: {
      id: TASK,
      kind: "haul",
      sourceId: CID,
      revision: 0,
      assignedAt: tick,
      leaseUntil: tick + 50,
    },
  });
  g().Game.creeps = { [HOLDER]: hauler };
  // 本测试走 Game.creeps 回退路径（logistics 优先消费共享 creepRefs）。
  globalCache().creepRefs = undefined;
  g().Memory.rooms[HOME].layout = { revision: 0 };
}

function run(tick: number): void {
  g().Game.time = tick;
  const container = mockStructure("container", { id: CID, energy: 1200, capacity: 2000 });
  const snap = mockSnapshot({ roomName: HOME, containers: [container], rcl: 6 });
  logisticsSystem.run(mockContext(snap));
}

/** 本房任务池（transportPool 的类型是宽松的，这里按任务条目收窄）。 */
function roomTasks(): readonly AssignmentTaskEntry[] {
  return (globalCache().transportPool?.rooms[HOME] ?? []) as readonly AssignmentTaskEntry[];
}

function poolTask(tick: number): AssignmentTaskEntry | undefined {
  run(tick);
  return roomTasks().find(t => t.id === TASK);
}

beforeEach(() => {
  resetGlobals();
  g().Memory.rooms[HOME] = { colonyState: "normal", spawnQueue: [] };
});

describe("haul 租约不得把自己的任务挤出池（AS-1 自失效回归）", () => {
  it("持有者占满并发时：任务仍在池里，且 assignedCreeps 记着持有者", () => {
    holderAssigned(1000);
    const mine = poolTask(1000);
    expect(mine, "持有者自己的租约不该把任务从池里抹掉").toBeDefined();
    expect(mine!.maxWorkers).toBe(1);
    expect(mine!.assignedCreeps).toEqual([HOLDER]);
  });

  it("连续两 tick 同一持有者 → 任务 id 与占用者都不变（线上是每 tick 翻转）", () => {
    holderAssigned(1000);
    const first = poolTask(1000);
    const second = poolTask(1001);
    // 先钉"存在"再钉"稳定" —— 否则两边都是 undefined 也会通过（空判当绿）。
    expect(first?.id).toBe(TASK);
    expect(second?.id).toBe(TASK);
    expect(second?.assignedCreeps).toEqual([HOLDER]);
  });

  it("源被抽干（available=0）才真的出池 —— AS-1 的僵尸释放语义不变", () => {
    holderAssigned(1000);
    g().Game.time = 1001;
    const empty = mockStructure("container", { id: CID, energy: 0, capacity: 2000 });
    logisticsSystem.run(mockContext(mockSnapshot({ roomName: HOME, containers: [empty], rcl: 6 })));
    const gone = roomTasks().find(t => t.id === TASK);
    expect(gone, "空源仍留任务会让僵尸 hauler 守着不存在的能量").toBeUndefined();
  });
});
