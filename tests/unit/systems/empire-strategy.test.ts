/** Empire Strategy 系统测试（发布层 — 容量分档 + 议程归因）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { empireStrategySystem } from "../../../src/systems/empire/empire-strategy";
import { globalCache } from "../../../src/kernel/global-cache";
import { EventKind } from "../../../src/kernel/event-log";
import { CONFIG } from "../../../src/config";
import type { TickContext } from "../../../src/kernel/contracts";
import { mockBudget, mockController, mockSnapshot, resetGlobals } from "../../support/factories";

// 测试夹具只构造部分引擎对象。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = (): any => globalThis as any;

beforeEach(() => {
  resetGlobals();
});

function makeContext(snapshot?: any): any {
  const snap = snapshot ?? mockSnapshot();
  const b = mockBudget("healthy");
  return {
    tick: g().Game.time,
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
  g().Memory.rooms.W7N4 = {
    spawnQueue: [],
    buildQueue: [],
    colonyState: "normal",
    economyPressure: pressure,
    ...(hostileAgo !== undefined ? { lastHostileAt: g().Game.time - hostileAgo } : {}),
  };
  return snap;
}

function events(kind: number): any[] {
  return ((globalThis as any).eventBuffer?.events ?? []).filter((e: any) => e.k === kind);
}

describe("empire-strategy — 容量发布", () => {
  it("按 cpuAvg10/limit 分档写入 g().Memory.kernel.capacity", () => {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect(g().Memory.kernel.capacity?.tier).toBe("abundant");
    expect(g().Memory.kernel.capacity?.since).toBe(g().Game.time);
  });

  it("接线：stats.cpuRate 存在时用它分档，不是 cpuAvg10", () => {
    // 这条只守一个静默失效点：字段名写错时 pickCpuUsagePerTick 会「退回 cpuAvg10」并
    // 照常出一个 tier —— 前一条（只有 cpuAvg10）看不出接错，必须让两份读数故意不同档。
    g().Memory.kernel = {};
    g().Memory.kernel.stats = {
      cpuAvg10: 14, // 偏高读数 → tight
      cpuMax10: 13.2,
      cpuRate: {
        windowTicks: 420,
        sampledTicks: 420,
        unsampledTicks: 0,
        total: 8.56,
        // 新鲜度：这份读数假定是「本拍刚采的」，缺 at 会被选择器当旧窗口拒绝。
        at: g().Game.time,
      }, // 真值 → comfortable
    };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect(g().Memory.kernel.capacity?.tier).toBe("comfortable");
  });

  it("P95 越线时峰值压过均值：均值 comfortable 但容量保持 tight", () => {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = {
      cpuAvg10: 8,
      cpuMax10: 12,
      cpuP95Window: 15,
      cpuPeakSamples: 300,
      cpuPeakSpanTicks: 2990,
    };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    const cap = g().Memory.kernel.capacity;
    expect(cap.tier).toBe("tight");
    expect(cap.limitedBy).toBe("peak");
    expect(cap.inputs.cpuP95).toBe(15);
    expect(cap.peakHeadroom).toBeCloseTo(0.25);
  });

  it("P95 样本不足时退回 cpuMax10，不把短窗当稳定峰值", () => {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = {
      cpuAvg10: 8,
      cpuMax10: 12,
      cpuP95Window: 19,
      cpuPeakSamples: CONFIG.capacity.peakMinSamples - 1,
      cpuPeakSpanTicks: 280,
    };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    const cap = g().Memory.kernel.capacity;
    expect(cap.tier).toBe("comfortable");
    expect(cap.inputs.cpuP95).toBeUndefined();
    expect(cap.inputs.cpuMax10).toBe(12);
  });

  it("有效上限取 min(cpuLimit, tickLimit)", () => {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = { cpuAvg10: 4, cpuMax10: 4 };
    g().Game.cpu = {
      limit: 100,
      tickLimit: 10,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    // avg 4 / min(100,10)=10 → 40% → comfortable（非 abundant）。
    expect(g().Memory.kernel.capacity?.tier).toBe("comfortable");
  });
});

describe("empire-strategy — 议程归因（AgendaOutcome）", () => {
  it("退出 rcl-push 时记录进度增量与窗口时长", () => {
    g().Memory.kernel = {};
    g().Memory.kernel.agenda = {
      initiative: "rcl-push",
      since: g().Game.time - 500,
      progressBase: 10000,
    };
    g().Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    // storage 低于冲级线 → 议程目标 develop（驻留已满 → 切换）。
    const snap = setupRoom({ storage: 5000, progress: 12500, hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect(g().Memory.kernel.agenda?.initiative).toBe("develop");
    const outcome = events(29)[0];
    expect(outcome?.d).toEqual([2, 2500, 500]); // [rcl-push, progressGained, duration]
    // 切换事件仍记录。
    expect(events(25)[0]?.d?.[0]).toBe(3); // AgendaChange → develop
  });

  it("进入 rcl-push 时记录 progressBase；未退出不记录 AgendaOutcome", () => {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    // 首次评估（无 prev）：直接采纳 rcl-push（storage 充足、无威胁）。
    const snap = setupRoom({ storage: 90000, progress: 8000, hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    const agenda = g().Memory.kernel.agenda;
    expect(agenda?.initiative).toBe("rcl-push");
    expect(agenda?.progressBase).toBe(8000);
    expect(events(29)).toHaveLength(0);
  });
});

/**
 * 决策那一拍的 `gclLevel` / `bucket` 必须随 `kernel.strategy` 落盘。
 *
 * 立案依据（线上实测 2026-10-03）：`expansionAllowed=false` 之后没人能回答"当时是哪一合取项在挡" ——
 * 七个合取项里五项可从 Memory 复算（colonyState / economyPressure / rcl / storage / stats.cpuByHome），
 * 偏偏喂给 `gclHeadroom` 与 `bucket ≥ expandMinBucket` 的那两个标量只活在 heap。
 * 现场证据：`kernel.gcl` 与 `kernel.bucket` 两个键都**不存在**。
 *
 * 这三条锁的是**记录值必须等于判定值**（含缺失时的兜底），不是锁某个姿态结论。
 */
describe("empire-strategy — 决策标量落盘", () => {
  function runWith(cpu: Record<string, unknown>, gcl: unknown): any {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      getUsed: () => 0,
      ...cpu,
    };
    g().Game.gcl = gcl;
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));
    return g().Memory.kernel.strategy;
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

describe("situation 的截断前留痕列", () => {
  it("跑一轮就落 adversariesTotal／conditionsTotal，且条数 >= 榜宽内实际条目数", () => {
    setupRoom();
    empireStrategySystem.run(makeContext());
    const sit = g().Memory.kernel.situation;
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
    const sit = g().Memory.kernel.situation;
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
    g().Memory.kernel = {};
    const tick = g().Game.time;
    const snaps: any[] = [];
    for (let i = 0; i < 7; i++) {
      const name = `R${i}`;
      const controller: any = mockController({ my: true });
      controller.ticksToDowngrade = 1000; // < CONTROLLER_PRESSURE_TTD(2000)
      controller.progress = 12000;
      g().Game.rooms[name] = { controller, name };
      g().Memory.rooms[name] = {
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
    const sit = g().Memory.kernel.situation;
    expect(sit.conditionsTotal).toBe(14);
    expect(sit.conditions.length).toBe(12);
    expect(sit.conditions.filter((c: any) => c.severity === 3).length).toBe(7);
    expect(sit.conditions.filter((c: any) => c.severity === 2).length).toBe(5);
  });
});

describe("empire-strategy — 生效参数集落盘（params）", () => {
  function runOnce(envProfile?: Record<string, unknown>): any {
    g().Memory.kernel = {};
    g().Memory.kernel.stats = { cpuAvg10: 2, cpuMax10: 4 };
    if (envProfile) g().Memory.kernel.environment = envProfile;
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      getUsed: () => 0,
      bucket: 9000,
    };
    g().Game.gcl = { level: 5 };
    setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext());
    return g().Memory.kernel.strategy;
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

  it("基线 low 档确实把威胁窗抬到 5000（误判的反向守卫：读 CONFIG 会得 3000）", async () => {
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

describe("empire-strategy — 容量闸的输入落盘（capacity.inputs）", () => {
  function runWithStats(stats: Record<string, unknown>): any {
    g().Memory.kernel = {};
    // 这里的用例都在测「窗长/漏采」这一维；新鲜度单独由 capacity 单测覆盖。
    // 这里统一把 at 盖成当前拍，避免每份夹具都重复一行（显式 at 优先）。
    const withFreshRate = stats.cpuRate
      ? {
          ...stats,
          cpuRate: { at: g().Game.time, ...(stats.cpuRate as object) },
        }
      : stats;
    g().Memory.kernel.stats = { cpuAvg10: 16, ...withFreshRate };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      getUsed: () => 0,
      bucket: 9000,
    };
    g().Game.gcl = { level: 5 };
    setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext());
    return g().Memory.kernel.capacity;
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

  it("留痕要带上『为什么采信哪把尺』的两个信任位（线上进过：窗 298／漏采 0 却记 usage=avg10，缺这两枚无法归因）", () => {
    // 可信腿：窗够长且零漏采 ⇒ usage=rateTotal，同时窗长与漏采数必须一起落盘。
    const trusted = runWithStats({ cpuRate: { total: 8, windowTicks: 300, unsampledTicks: 0 } });
    expect(trusted.inputs.rateWindowTicks).toBe(300);
    expect(trusted.inputs.rateUnsampledTicks).toBe(0);
    expect(trusted.inputs.usage).toBe(8);

    // 退回腿（窗内有漏采拍）：usage 换成一旁的 avg10，而理由必须留在 `rateUnsampledTicks` 上。
    const unsampled = runWithStats({ cpuRate: { total: 8, windowTicks: 300, unsampledTicks: 7 } });
    expect(unsampled.inputs.rateUnsampledTicks).toBe(7);
    expect(unsampled.inputs.usage).toBe(16);

    // 退回腿（窗未建立，低于 MIN_RATE_WINDOW_TICKS=100）：同样要可复算，不许只剩一个 usage。
    const youngWindow = runWithStats({ cpuRate: { total: 8, windowTicks: 50, unsampledTicks: 0 } });
    expect(youngWindow.inputs.rateWindowTicks).toBe(50);
    expect(youngWindow.inputs.usage).toBe(16);
  });
});

describe("empire-strategy — 姿态转换事件", () => {
  it("fortify→develop 那一拍写 PostureTransition=[2,0,6]，t 与单格同拍", () => {
    const now = g().Game.time;
    g().Memory.kernel = {
      strategy: { posture: "fortify", since: now - 2000 },
      stats: { cpuAvg10: 2, cpuMax10: 4 },
    };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    const ev = events(EventKind.PostureTransition)[0];
    expect(ev?.t).toBe(now);
    expect(ev?.d).toEqual([2, 0, 6]);
    expect(g().Memory.kernel.postureTransition).toEqual({
      from: "fortify",
      to: "develop",
      reason: "silence-elapsed",
      tick: now,
    });
    expect(g().Memory.kernel.strategy.since).toBe(now);
  });

  it("没有转换的那一拍不写 PostureTransition", () => {
    const now = g().Game.time;
    g().Memory.kernel = {
      strategy: { posture: "develop", since: now - 2000 },
      stats: { cpuAvg10: 2, cpuMax10: 4 },
    };
    g().Game.cpu = {
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      getUsed: () => 0,
    };
    const snap = setupRoom({ hostileAgo: 99999 });
    empireStrategySystem.run(makeContext(snap));

    expect(events(EventKind.PostureTransition)).toHaveLength(0);
  });
});

describe("empire-strategy — 低频尾段门（cadence 共存，2026-11-21 事故回归）", () => {
  // 事故：G6 cadence 覆盖（每 5 拍，运行拍 ≡4 mod 5）后，内部绝对门
  // tick%100===0 / ===16 永无交集 ⇒ 环境画像与专业化规划静默停摆 58 万拍。
  // 本组用例按事故节律只喂运行拍（tick ≡4 mod 5），断言两个子系统都在跑。
  const ZOMBIE = {
    i: "contract:W37S58:W38S56:energy",
    s: "W37S58",
    t: "W38S56",
    r: "E",
    tr: 180,
    mr: 200000,
    p: 0,
    st: "A",
    ca: 83316316,
    ua: 83316316,
    ac: 83316316,
    td: 0,
    cs: 0,
    dm: 50,
    rs: "network-surplus-deficit-pair",
  };

  beforeEach(() => {
    // heap 距离钟跨测试残留（globalCache 不随 resetGlobals 清空）—— 每组从头起表。
    const clocks = globalCache() as {
      __envLastSampleTick?: number;
      __specLastRunTick?: number;
    };
    delete clocks.__envLastSampleTick;
    delete clocks.__specLastRunTick;
  });

  function runOverRunTicks(startTick: number, count: number): void {
    const snap = mockSnapshot();
    g().Memory.rooms.W7N4 = {
      spawnQueue: [],
      buildQueue: [],
      colonyState: "normal",
    };
    for (let i = 0; i < count; i++) {
      const t = startTick + i * 5; // G6 cadence：运行拍 ≡ startTick (mod 5)
      g().Game.time = t;
      empireStrategySystem.run({
        tick: t,
        budget: mockBudget("healthy"),
        globalSiteCount: 0,
        getSnapshot: () => snap,
        *snapshots() {
          yield snap;
        },
      } as unknown as TickContext);
    }
  }

  it("G6 节律（≡4 mod 5）下环境画像照常采样（旧绝对门在本节律下永无命中）", () => {
    g().Memory = { rooms: {}, kernel: { bootTick: 0 } };
    g().Game.time = 83816504; // ≡4 mod 5，事故现场附近的运行拍
    runOverRunTicks(83816504, 3);
    const envTick = g().Memory.kernel?.environment?.tick;
    expect(envTick).toBe(83816504); // boot 即采样（旧门：83816504 % 100 = 4 ≠ 0，永不写）
  });

  it("距离钟：boot 采样后 100 拍内不重复采样，跨过 100 拍的运行拍再采", () => {
    g().Memory = { rooms: {}, kernel: { bootTick: 0 } };
    runOverRunTicks(83816504, 1);
    expect(g().Memory.kernel?.environment?.tick).toBe(83816504);
    runOverRunTicks(83816509, 19); // 推进 95 拍（19 个运行拍）— 仍在间隔内
    expect(g().Memory.kernel?.environment?.tick).toBe(83816504);
    runOverRunTicks(83816604, 1); // 距上次 100 拍
    expect(g().Memory.kernel?.environment?.tick).toBe(83816604);
  });

  it("供给合同僵尸在 G6 节律下被清理（专业化规划恢复运行；旧门下永不清）", () => {
    g().Memory = {
      rooms: {},
      kernel: { bootTick: 0, supplyContracts: [{ ...ZOMBIE }] },
    };
    runOverRunTicks(84402884, 3);
    const kept = g().Memory.kernel?.supplyContracts ?? [];
    expect(kept).toHaveLength(0); // ca=83316316 距今 > 宽限窗 ⇒ 清
  });
});
