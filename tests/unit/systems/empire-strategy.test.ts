/** Empire Strategy 系统测试（R6a/R7a 发布层 — 容量分档 + 议程归因）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { empireStrategySystem } from "../../../src/systems/empire/empire-strategy";
import { CONFIG } from "../../../src/config";
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

describe("situation 的截断前留痕列（#142 同族）", () => {
  it("跑一轮就落 adversariesTotal／conditionsTotal，且条数 >= 榜宽内实际条目数", () => {
    setupRoom();
    empireStrategySystem.run(makeContext());
    const sit = (globalThis as any).Memory.kernel.situation;
    expect(typeof sit.adversariesTotal).toBe("number");
    expect(typeof sit.conditionsTotal).toBe("number");
    // 本夹具没有威胁 ⇒ 全集应为 0；两列同时在场才说明写者接上了（缺席＝没接）
    expect(sit.adversariesTotal).toBe(0);
    expect(sit.conditionsTotal).toBeGreaterThanOrEqual(sit.conditions.length);
  });

  it("10 家对手 ⇒ adversariesTotal=10 而榜宽 8，且掉出去的是插入序尾部两家", () => {
    // 截断式聚合的排序键是 `b.rooms.length - a.rooms.length || b.lastSeen - a.lastSeen`：
    // 十家各占一房、lastSeen 同拍 ⇒ 两两比较全为 0 ⇒ 稳定排序保留 Map 插入序 = threatCreeps 序。
    // 因此"谁在榜外"是可命名的，不只是"少了几家"。
    setupRoom();
    const owners = Array.from({ length: 10 }, (_, i) => `adv-${i}`);
    const snap = mockSnapshot({
      threatCreeps: owners.map((o, i) => ({ owner: { username: o }, name: `c${i}` })) as any,
    });
    empireStrategySystem.run(makeContext(snap));
    const sit = (globalThis as any).Memory.kernel.situation;
    expect(sit.adversariesTotal).toBe(10);
    expect(Object.keys(sit.adversaries).length).toBe(8);
    expect(Object.keys(sit.adversaries)).toEqual(owners.slice(0, 8));
    expect(sit.adversaries["adv-8"]).toBeUndefined();
    expect(sit.adversaries["adv-9"]).toBeUndefined();
  });

  it("14 条条件 ⇒ conditionsTotal=14 而榜宽 12（severity 排序后掉出的是尾档）", () => {
    // 每房最多产两条（newbornColonyRisk + controllerUnderAttack），七房 ⇒ 14 > 12。
    // 两类的 severity：newborn 取 2（无 spawn + 敌情、TTD 未到 800）／controllerUnderAttack 取 3，
    // 排序 `b.severity - a.severity` ⇒ 七条 3 在前、七条 2 在后 ⇒ 被切掉的 2 条全是 severity 2，
    // 也就是「榜里的最低档不完整」——没有 conditionsTotal 就只能读成「帝国只有 12 个条件」。
    (globalThis as any).Memory.kernel = {};
    const tick = (globalThis as any).Game.time;
    const snaps: any[] = [];
    for (let i = 0; i < 7; i++) {
      const name = `R${i}`;
      const controller: any = mockController({ my: true });
      controller.ticksToDowngrade = 1000; // < CONTROLLER_PRESSURE_TTD(2000)
      controller.progress = 12000;
      (globalThis as any).Game.rooms[name] = { controller, name };
      (globalThis as any).Memory.rooms[name] = {
        spawnQueue: [],
        buildQueue: [],
        colonyState: "normal",
        economyPressure: 0.1,
      };
      snaps.push(
        mockSnapshot({
          roomName: name,
          rcl: 3,
          spawns: [] as any,
          storage: undefined,
          controller,
          threatCreeps: [{ owner: { username: "thief" }, name: "t" }] as any,
        }),
      );
    }
    const ctx: any = makeContext(snaps[0]);
    ctx.tick = tick;
    ctx.snapshots = () => snaps[Symbol.iterator]();
    ctx.getSnapshot = (n: string) => snaps.find(s => s.roomName === n);
    empireStrategySystem.run(ctx);
    const sit = (globalThis as any).Memory.kernel.situation;
    expect(sit.conditionsTotal).toBe(14);
    expect(sit.conditions.length).toBe(12);
    expect(sit.conditions.filter((c: any) => c.severity === 3).length).toBe(7);
    expect(sit.conditions.filter((c: any) => c.severity === 2).length).toBe(5);
  });
});

describe("empire-strategy — #186 生效参数集落盘（params）", () => {
  function runOnce(envProfile?: Record<string, unknown>): any {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    if (envProfile) (globalThis as any).Memory.kernel.environment = envProfile;
    (globalThis as any).Game.cpu = { limit: 20, tickLimit: 500, getUsed: () => 0, bucket: 9000 };
    (globalThis as any).Game.gcl = { level: 5 };
    setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext());
    return (globalThis as any).Memory.kernel.strategy;
  }

  it("环境画像缺席 ⇒ 中性档，params 存在且 threatWindow 等于合并后的值", () => {
    const strategy = runOnce();
    expect(strategy.params).toBeDefined();
    expect(strategy.params.neighborPressure).toBe("medium");
    expect(strategy.params.threatWindow).toBe(CONFIG.posture.threatWindow);
  });

  it("params 报的是**合并结果**而不是回读 CONFIG 字面量（改 CONFIG 立刻跟着变）", () => {
    const original = CONFIG.posture.threatWindow;
    const postureCfg = CONFIG.posture as unknown as { threatWindow: number };
    try {
      postureCfg.threatWindow = original + 777;
      expect(runOnce().params.threatWindow).toBe(original + 777);
    } finally {
      postureCfg.threatWindow = original;
    }
    expect(CONFIG.posture.threatWindow).toBe(original);
  });

  it("基线 low 档确实把威胁窗抬到 5000（R407 误判的反向守卫：读 CONFIG 会得 3000）", async () => {
    const { selectEnvBaseline } = await import("../../../src/domain/strategy/posture-baseline");
    const low = selectEnvBaseline({
      neighborPressure: "low",
      marketActivity: "moderate",
      gclProgressRate: 0,
      hasLiveThreat: false,
    } as any);
    expect(low.threatWindow).toBe(5000);
    expect(low.warPatience).toBe(3000);
    expect(low.threatWindow).not.toBe(CONFIG.posture.threatWindow);
  });
});

describe("empire-strategy — #188 容量闸的输入落盘（capacity.inputs）", () => {
  function runWithStats(stats: Record<string, unknown>): any {
    (globalThis as any).Memory.kernel = {};
    (globalThis as any).Memory.kernel.stats = { cpuAvg10: 16, ...stats };
    (globalThis as any).Game.cpu = { limit: 20, tickLimit: 500, getUsed: () => 0, bucket: 9000 };
    (globalThis as any).Game.gcl = { level: 5 };
    setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext());
    return (globalThis as any).Memory.kernel.capacity;
  }

  it("落盘的 usage 就是闸用的那一个数（可信窗取 rateTotal，而不是偏高的 cpuAvg10）", () => {
    const cap = runWithStats({
      cpuRate: { total: 8, windowTicks: 300, unsampledTicks: 0 },
    });
    expect(cap.inputs.usage).toBe(8);
    expect(cap.inputs.avg10).toBe(16); // 两把尺并排落盘 ⇒ 读者能看出走了哪条腿
    expect(cap.inputs.limit).toBe(20); // min(cpuLimit, tickLimit)
    expect(cap.headroom).toBeCloseTo(1 - 8 / 20, 6);
    expect(cap.inputs.tightRatio).toBe(CONFIG.capacity.tightRatio);
    // 由落盘输入即可复算档位：余量 0.6 ⇒ comfortable（G6 要的正是 tier ≤ comfortable）
    expect(cap.tier).toBe("comfortable");
  });

  it("窗不可信（有漏采拍）⇒ 退回偏高的 avg10，且落盘跟着退——留痕不许与判定分叉", () => {
    const cap = runWithStats({
      cpuRate: { total: 8, windowTicks: 300, unsampledTicks: 7 },
    });
    expect(cap.inputs.usage).toBe(16);
    expect(cap.headroom).toBeCloseTo(1 - 16 / 20, 6);
    expect(cap.tier).toBe("tight");
  });
});
