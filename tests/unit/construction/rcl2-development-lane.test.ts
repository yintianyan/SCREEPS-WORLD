/**
 * Phase R2 — RCL2 关键发展通道 + 队列治理单元测试。
 *
 * 覆盖：
 *   1. evaluateDevelopmentGate：每个门禁拒绝时输出正确原因码（可观测性契约）；
 *      emergency 豁免链保持不变。
 *   2. evaluateDevelopmentLane：RCL2-3 通道真值表 — 门禁被 claimSecure/pressure/
 *      conserve 拉闸时，extension / controller container 在生存前提齐备下放行；
 *      威胁 / P0 spawn / emergency / 能量地板 / 全局配额仍拦截。
 *   3. isCriticalDevelopmentTask：extension 与 controller 邻接 container 属通道，
 *      source 邻接 container 属 emergency 车道，道路不属于。
 *   4. cleanTasks：超龄 queued 任务清除（观测语义，不进黑名单）；priority 0 豁免。
 *   5. makeTryAddTask：背景任务（priority>=2）队列硬上限 admission control；
 *      P0/P1 不受限。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  evaluateDevelopmentGate,
  evaluateDevelopmentLane,
  isCriticalDevelopmentTask,
  cleanTasks,
  type DevelopmentGateInputs,
  type DevelopmentLaneInputs,
} from "../../../src/domain/construction/queue";
import { makeTryAddTask } from "../../../src/domain/layout/planner";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../role-helpers";
import type { BuildTaskCandidate } from "../../../src/domain/layout/task-factory";

beforeEach(() => {
  resetGlobals();
});

// ─── 1. evaluateDevelopmentGate 原因码 ──────────────────────

function gateInputs(overrides: Partial<DevelopmentGateInputs> = {}): DevelopmentGateInputs {
  return {
    emergencyAny: false,
    economyPressure: 0,
    budgetTier: "healthy",
    claimSecure: false,
    threatCount: 0,
    hasP0SpawnRequest: false,
    energyAvailable: 500,
    energyCapacityAvailable: 800,
    globalSiteCount: 0,
    maxGlobalSites: CONFIG.construction.maxGlobalSites,
    ...overrides,
  };
}

describe("evaluateDevelopmentGate — 结构化原因码", () => {
  it("全部前提满足 → ok", () => {
    expect(evaluateDevelopmentGate(gateInputs())).toBe("ok");
  });

  it("pressure > 0.8 → pressure", () => {
    expect(evaluateDevelopmentGate(gateInputs({ economyPressure: 0.81 }))).toBe("pressure");
  });

  it("conserve / recovery tier → cpu-tier", () => {
    expect(evaluateDevelopmentGate(gateInputs({ budgetTier: "conserve" }))).toBe("cpu-tier");
    expect(evaluateDevelopmentGate(gateInputs({ budgetTier: "recovery" }))).toBe("cpu-tier");
  });

  it("claimSecure → claim-secure", () => {
    expect(evaluateDevelopmentGate(gateInputs({ claimSecure: true }))).toBe("claim-secure");
  });

  it("威胁 creep（含 emergency 路径）→ threat", () => {
    expect(evaluateDevelopmentGate(gateInputs({ threatCount: 1 }))).toBe("threat");
    expect(
      evaluateDevelopmentGate(gateInputs({ emergencyAny: true, threatCount: 1 })),
    ).toBe("threat");
  });

  it("P0 孵化请求 → p0-spawn", () => {
    expect(evaluateDevelopmentGate(gateInputs({ hasP0SpawnRequest: true }))).toBe("p0-spawn");
  });

  it("能量低于梯度阈值 → energy-floor", () => {
    // min(floor(800×0.6), 200+200) = min(480, 400) = 400 — 绝对上限封顶。
    expect(evaluateDevelopmentGate(gateInputs({ energyAvailable: 399 }))).toBe("energy-floor");
    expect(evaluateDevelopmentGate(gateInputs({ energyAvailable: 400 }))).toBe("ok");
  });

  it("全局 site 满额 → global-site-cap", () => {
    expect(
      evaluateDevelopmentGate(gateInputs({
        globalSiteCount: CONFIG.construction.maxGlobalSites,
      })),
    ).toBe("global-site-cap");
  });

  it("emergency 豁免 pressure / tier / claimSecure / P0 / 能量 / 全局配额（不豁免威胁）", () => {
    const base = {
      emergencyAny: true,
      economyPressure: 1,
      budgetTier: "recovery" as const,
      claimSecure: true,
      hasP0SpawnRequest: true,
      energyAvailable: 0,
      globalSiteCount: CONFIG.construction.maxGlobalSites,
    };
    expect(evaluateDevelopmentGate(gateInputs(base))).toBe("ok");
  });
});

// ─── 2. evaluateDevelopmentLane 真值表 ─────────────────────

function laneInputs(overrides: Partial<DevelopmentLaneInputs> = {}): DevelopmentLaneInputs {
  return {
    rcl: 2,
    laneMaxRcl: CONFIG.construction.developmentLaneMaxRcl,
    budgetTier: "healthy",
    threatCount: 0,
    hasP0SpawnRequest: false,
    survivalGapActive: false,
    energyAvailable: CONFIG.construction.developmentLaneEnergyFloor,
    laneEnergyFloor: CONFIG.construction.developmentLaneEnergyFloor,
    globalSiteCount: 0,
    maxGlobalSites: CONFIG.construction.maxGlobalSites,
    readyLaneTaskCount: 2,
    ...overrides,
  };
}

describe("evaluateDevelopmentLane — RCL2 关键发展通道", () => {
  it("RCL2 全前提满足 → ok（门禁拉闸时的放行通道）", () => {
    expect(evaluateDevelopmentLane(laneInputs())).toBe("ok");
  });

  it("RCL1 未解锁 / RCL4+ 超出窗口 → rcl-window", () => {
    expect(evaluateDevelopmentLane(laneInputs({ rcl: 1 }))).toBe("rcl-window");
    expect(evaluateDevelopmentLane(laneInputs({ rcl: 4 }))).toBe("rcl-window");
  });

  it("conserve 档 + 能量地板满足 → 仍放行（修复核心场景）", () => {
    expect(
      evaluateDevelopmentLane(laneInputs({ budgetTier: "conserve" })),
    ).toBe("ok");
  });

  it("recovery 档 → 拒绝（内核 maxPriority 语义一致）", () => {
    expect(evaluateDevelopmentLane(laneInputs({ budgetTier: "recovery" }))).toBe("recovery-tier");
  });

  it("威胁 → threat；P0 孵化缺口 → p0-spawn；生存级紧急缺口 → survival-gap", () => {
    expect(evaluateDevelopmentLane(laneInputs({ threatCount: 1 }))).toBe("threat");
    expect(evaluateDevelopmentLane(laneInputs({ hasP0SpawnRequest: true }))).toBe("p0-spawn");
    expect(
      evaluateDevelopmentLane(laneInputs({ survivalGapActive: true })),
    ).toBe("survival-gap");
  });

  it("source container 缺失（经济效率缺口）不阻塞通道 — 仅 spawn/tower/storage 计入 survival-gap", () => {
    // survivalGapActive 由调用方以 spawn||tower||storage 合成，不含 sourceContainer。
    expect(evaluateDevelopmentLane(laneInputs({ survivalGapActive: false }))).toBe("ok");
  });

  it("能量低于绝对地板 → energy-floor（conserve 下同样拦截）", () => {
    expect(
      evaluateDevelopmentLane(laneInputs({
        budgetTier: "conserve",
        energyAvailable: CONFIG.construction.developmentLaneEnergyFloor - 1,
      })),
    ).toBe("energy-floor");
  });

  it("全局 site 满额 → global-site-cap（通道不绕过全局配额）", () => {
    expect(
      evaluateDevelopmentLane(laneInputs({
        globalSiteCount: CONFIG.construction.maxGlobalSites,
      })),
    ).toBe("global-site-cap");
  });

  it("队列无可立即创建的发展任务 → no-lane-task", () => {
    expect(evaluateDevelopmentLane(laneInputs({ readyLaneTaskCount: 0 }))).toBe("no-lane-task");
  });
});

// ─── 3. isCriticalDevelopmentTask 分类 ─────────────────────

function task(structureType: BuildableStructureConstant, x = 25, y = 26): BuildTask {
  return {
    key: `t.${structureType}.${x}.${y}`,
    pos: { x, y, roomName: "W7N4" },
    structureType,
    priority: 1,
    state: "queued",
    attempts: 0,
    retryAt: 0,
  };
}

describe("isCriticalDevelopmentTask — 通道任务分类", () => {
  it("extension 属通道", () => {
    const snap = { sources: [], controller: { pos: { x: 30, y: 30 } } } as any;
    expect(isCriticalDevelopmentTask(task(STRUCTURE_EXTENSION), snap)).toBe(true);
  });

  it("controller 邻接 container 属通道", () => {
    const snap = { sources: [], controller: { pos: { x: 30, y: 30 } } } as any;
    expect(
      isCriticalDevelopmentTask(task(STRUCTURE_CONTAINER, 31, 30), snap),
    ).toBe(true);
  });

  it("source 邻接 container 不属通道（归 emergency 车道）", () => {
    const snap = { sources: [{ pos: { x: 20, y: 20 } }], controller: { pos: { x: 30, y: 30 } } } as any;
    expect(
      isCriticalDevelopmentTask(task(STRUCTURE_CONTAINER, 21, 20), snap),
    ).toBe(false);
  });

  it("道路 / 塔 / spawn 不属通道", () => {
    const snap = { sources: [], controller: { pos: { x: 30, y: 30 } } } as any;
    expect(isCriticalDevelopmentTask(task(STRUCTURE_ROAD), snap)).toBe(false);
    expect(isCriticalDevelopmentTask(task(STRUCTURE_TOWER), snap)).toBe(false);
    expect(isCriticalDevelopmentTask(task(STRUCTURE_SPAWN), snap)).toBe(false);
  });
});

// ─── 4. cleanTasks 超龄清除 ────────────────────────────────

function queuedTask(overrides: Partial<BuildTask> = {}): BuildTask {
  return {
    key: "t",
    pos: { x: 25, y: 26, roomName: "W7N4" },
    structureType: STRUCTURE_ROAD,
    priority: 3,
    state: "queued",
    attempts: 0,
    retryAt: 0,
    queuedAt: 0,
    ...overrides,
  };
}

describe("cleanTasks — R2 超龄清除", () => {
  it("queued 任务超过 maxQueuedAge → 清除并记入 staleKeys（不进黑名单）", () => {
    const queue = [queuedTask({ key: "old-road", queuedAt: 0 })];
    const result = cleanTasks(queue, CONFIG.construction.maxQueuedTaskAge + 1, {
      maxQueuedAge: CONFIG.construction.maxQueuedTaskAge,
    });
    expect(queue).toHaveLength(0);
    expect(result.staleKeys).toEqual(["old-road"]);
    expect(result.blacklistedKeys).toEqual([]);
  });

  it("未超龄任务保留", () => {
    const queue = [queuedTask({ key: "young", queuedAt: 10 })];
    const result = cleanTasks(queue, 100, { maxQueuedAge: 3000 });
    expect(queue).toHaveLength(1);
    expect(result.staleKeys).toEqual([]);
  });

  it("priority 0 任务永不清除（生存关键）", () => {
    const queue = [queuedTask({ key: "spawn", priority: 0, queuedAt: 0 })];
    const result = cleanTasks(queue, 99999, { maxQueuedAge: 3000 });
    expect(queue).toHaveLength(1);
    expect(result.staleKeys).toEqual([]);
  });

  it("无 opts 时行为与旧版一致（不做超龄清除）", () => {
    const queue = [queuedTask({ queuedAt: 0 })];
    const result = cleanTasks(queue, 99999);
    expect(queue).toHaveLength(1);
    expect(result.staleKeys).toEqual([]);
    expect(result.blacklistedKeys).toEqual([]);
  });

  it("blocked 永久冲突仍走黑名单链路", () => {
    const queue = [queuedTask({ key: "bad", state: "blocked", attempts: 3 })];
    const result = cleanTasks(queue, 100, { maxQueuedAge: 3000 });
    expect(queue).toHaveLength(0);
    expect(result.blacklistedKeys).toEqual(["bad"]);
    expect(result.staleKeys).toEqual([]);
  });
});

// ─── 5. makeTryAddTask admission control ───────────────────

function candidate(overrides: Partial<BuildTaskCandidate> = {}): BuildTaskCandidate {
  return {
    key: "c",
    pos: { x: 10, y: 10, roomName: "W7N4" },
    structureType: STRUCTURE_ROAD,
    priority: 3,
    phase: "rcl2",
    validation: "ok",
    ...overrides,
  };
}

describe("makeTryAddTask — 背景任务队列硬上限", () => {
  it("背景任务（priority>=2）达上限后拒绝", () => {
    const queue: BuildTask[] = [
      queuedTask({ key: "r1", priority: 3 }),
      queuedTask({ key: "r2", priority: 2 }),
    ];
    const tryAdd = makeTryAddTask(new Set(), new Set(), {}, queue, { maxBackgroundQueued: 2 });
    expect(tryAdd(candidate({ key: "r3" }))).toBe(false);
    expect(queue).toHaveLength(2);
  });

  it("P0/P1 任务不受上限约束", () => {
    const queue: BuildTask[] = [
      queuedTask({ key: "r1", priority: 3 }),
      queuedTask({ key: "r2", priority: 2 }),
    ];
    const tryAdd = makeTryAddTask(new Set(), new Set(), {}, queue, {
      maxBackgroundQueued: 2,
      nowTick: 5,
    });
    expect(tryAdd(candidate({ key: "ext", priority: 1, structureType: STRUCTURE_EXTENSION }))).toBe(true);
    expect(queue).toHaveLength(3);
    expect(queue[2]!.queuedAt).toBe(5);
  });

  it("上限拒绝计入 stats.capRejected", () => {
    const queue: BuildTask[] = [queuedTask({ key: "r1", priority: 3 })];
    const stats = { capRejected: 0 };
    const tryAdd = makeTryAddTask(new Set(), new Set(), {}, queue, {
      maxBackgroundQueued: 1,
      stats,
    });
    tryAdd(candidate({ key: "r2" }));
    tryAdd(candidate({ key: "r3", pos: { x: 12, y: 12, roomName: "W7N4" } }));
    expect(stats.capRejected).toBe(2);
  });
});
