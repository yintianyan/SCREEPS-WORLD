/** Empire Strategy 系统测试（R6a/R7a 发布层 — 容量分档 + 议程归因）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { empireStrategySystem } from "../../../src/systems/empire/empire-strategy";
import { mockBudget, mockController, mockSnapshot, resetGlobals } from "../../support/factories";

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
    *snapshots() {
      yield snap;
    },
  };
}

function setupRoom(
  opts: { pressure?: number; storage?: number; progress?: number; hostileAgo?: number } = {},
): any {
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
    ...(hostileAgo !== undefined
      ? { lastHostileAt: (globalThis as any).Game.time - hostileAgo }
      : {}),
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

  it("接线：stats.cpuRate 存在时用它分档，不是 cpuAvg10", () => {
    // 这条只守一个静默失效点：字段名写错时 pickCpuUsagePerTick 会「退回 cpuAvg10」并
    // 照常出一个 tier —— 前一条（只有 cpuAvg10）看不出接错，必须让两份读数故意不同档。
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = {
      cpuAvg10: 14, // 偏高读数 → tight
      cpuMax10: 15,
      cpuRate: { windowTicks: 420, sampledTicks: 420, unsampledTicks: 0, total: 10.56 }, // 真值 → comfortable
    };
    (globalThis as any).Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect((globalThis as any).Memory.kernel.capacity?.tier).toBe("comfortable");
  });

  it("有效上限取 min(cpuLimit, tickLimit)", () => {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 4, cpuMax10: 4 };
    (globalThis as any).Game.cpu = {
      limit: 100,
      tickLimit: 10,
      bucket: 10000,
      getUsed: () => 0,
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
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
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
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
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

/**
 * #94 — 决策那一拍的 `gclLevel` / `bucket` 必须随 `kernel.strategy` 落盘。
 *
 * 立案依据（线上实测 2026-10-03）：`expansionAllowed=false` 之后没人能回答"当时是哪一合取项在挡" ——
 * 七个合取项里五项可从 Memory 复算（colonyState / economyPressure / rcl / storage / stats.cpuByHome），
 * 偏偏喂给 `gclHeadroom` 与 `bucket ≥ expandMinBucket` 的那两个标量只活在 heap。
 * 现场证据：`kernel.gcl` 与 `kernel.bucket` 两个键都**不存在**。
 *
 * 这三条锁的是**记录值必须等于判定值**（含缺失时的兜底），不是锁某个姿态结论。
 */
describe("empire-strategy — #94 决策标量落盘", () => {
  function runWith(cpu: Record<string, unknown>, gcl: unknown): any {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    (globalThis as any).Game.cpu = { limit: 20, tickLimit: 500, getUsed: () => 0, ...cpu };
    (globalThis as any).Game.gcl = gcl;
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));
    return (globalThis as any).Memory.kernel.strategy;
  }

  it("两键都写，且等于本次判定实际用到的值", () => {
    const strategy = runWith({ bucket: 4321 }, { level: 5 });
    expect(strategy.gclLevel).toBe(5);
    expect(strategy.bucket).toBe(4321);
  });

  it("Game.gcl 缺失 ⇒ 记 1（兜底值就是判定值，不留 undefined）", () => {
    const strategy = runWith({ bucket: 8000 }, undefined);
    expect(strategy.gclLevel).toBe(1);
    expect(strategy.bucket).toBe(8000);
  });

  it("Game.cpu.bucket 缺失 ⇒ 记 10000，且不写 NaN", () => {
    const strategy = runWith({}, { level: 3 });
    expect(strategy.bucket).toBe(10000);
    expect(Number.isFinite(strategy.bucket)).toBe(true);
    expect(strategy.gclLevel).toBe(3);
  });

  it("既有字段不因加键而丢（posture/since/expansionAllowed 仍在）", () => {
    const strategy = runWith({ bucket: 7000 }, { level: 4 });
    expect(typeof strategy.expansionAllowed).toBe("boolean");
    expect(typeof strategy.newRemoteOpsAllowed).toBe("boolean");
    expect(strategy.posture).toBeDefined();
    expect(strategy.since).toBeDefined();
    expect(strategy.gclLevel).toBe(4);
  });
});
