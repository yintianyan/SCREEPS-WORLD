/** Empire Strategy 系统测试（R6a/R7a 发布层 — 容量分档 + 议程归因）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { empireStrategySystem } from "../../../src/systems/empire-strategy";
import { mockBudget, mockController, mockSnapshot, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

function makeContext(snapshot?: any): any {
  const snap = snapshot ?? mockSnapshot();
  const b = mockBudget("healthy");
  return {
    tick: (globalThis as any).Game.time,
    budget: b,
    globalSiteCount: 0,
    getSnapshot: () => snap,
    snapshots: function* () { yield snap; },
  };
}

function setupRoom(opts: { pressure?: number; storage?: number; progress?: number; hostileAgo?: number } = {}): any {
  const { pressure = 0.1, storage = 40000, progress = 12000, hostileAgo } = opts;
  const controller: any = mockController({ my: true });
  controller.progress = progress;
  const snap = mockSnapshot({
    rcl: 6,
    storage: { store: { getUsedCapacity: () => storage } } as any,
    controller,
  });
  (globalThis as any).Memory.rooms.W7N4 = {
    spawnQueue: [],
    buildQueue: [],
    colonyState: "normal",
    economyPressure: pressure,
    ...(hostileAgo !== undefined ? { lastHostileAt: (globalThis as any).Game.time - hostileAgo } : {}),
  };
  return snap;
}

function events(kind: number): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === kind);
}

describe("empire-strategy — 容量发布（R7a）", () => {
  it("按 cpuAvg10/limit 分档写入 Memory.kernel.capacity", () => {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    (globalThis as any).Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect((globalThis as any).Memory.kernel.capacity?.tier).toBe("abundant");
    expect((globalThis as any).Memory.kernel.capacity?.since).toBe((globalThis as any).Game.time);
  });

  it("有效上限取 min(cpuLimit, tickLimit)", () => {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 4, cpuMax10: 4 };
    (globalThis as any).Game.cpu = {
      limit: 100, tickLimit: 10, bucket: 10000, getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    // avg 4 / min(100,10)=10 → 40% → comfortable（非 abundant）。
    expect((globalThis as any).Memory.kernel.capacity?.tier).toBe("comfortable");
  });
});

describe("empire-strategy — 议程归因（R7a AgendaOutcome）", () => {
  it("退出 rcl-push 时记录进度增量与窗口时长", () => {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.agenda = {
      initiative: "rcl-push",
      since: (globalThis as any).Game.time - 500,
      progressBase: 10000,
    };
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    (globalThis as any).Game.cpu = {
      limit: 20, tickLimit: 500, bucket: 10000, getUsed: () => 0,
    };
    // storage 低于冲级线 → 议程目标 develop（驻留已满 → 切换）。
    const snap = setupRoom({ storage: 5000, progress: 12500, hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect((globalThis as any).Memory.kernel.agenda?.initiative).toBe("develop");
    const outcome = events(29)[0];
    expect(outcome?.d).toEqual([2, 2500, 500]); // [rcl-push, progressGained, duration]
    // 切换事件仍记录。
    expect(events(25)[0]?.d?.[0]).toBe(3); // AgendaChange → develop
  });

  it("进入 rcl-push 时记录 progressBase；未退出不记录 AgendaOutcome", () => {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    (globalThis as any).Game.cpu = {
      limit: 20, tickLimit: 500, bucket: 10000, getUsed: () => 0,
    };
    // 首次评估（无 prev）：直接采纳 rcl-push（storage 充足、无威胁）。
    const snap = setupRoom({ storage: 90000, progress: 8000, hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    const agenda = (globalThis as any).Memory.kernel.agenda;
    expect(agenda?.initiative).toBe("rcl-push");
    expect(agenda?.progressBase).toBe(8000);
    expect(events(29)).toHaveLength(0);
  });
});
