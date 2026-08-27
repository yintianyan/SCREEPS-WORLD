/**
 * Pipeline Runtime Tests — Phase 6 验证 pipeline 顺序和错误隔离。
 *
 * 覆盖：
 *   - tactical-runtime-pipeline stage 顺序
 *   - intelligence-pipeline-system cadence 保持
 *   - 单 stage 异常隔离（一个 stage 抛错不跳过后续 stage）
 *   - stage cadence 不死锁
 *   - pipeline 停止时 A6 不影响帝国主执行链
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tacticalRuntimePipelineSystem } from "../../../src/systems/tactical-runtime-pipeline";
import { intelligencePipelineSystem } from "../../../src/systems/intelligence/intelligence-pipeline-system";

// ─── Mock ─────────────────────────────────────────────────

// Mock safeRun to track calls and simulate errors
let safeRunCalls: { label: string; error?: string }[] = [];
vi.mock("../../../src/kernel/safe-run", () => ({
  safeRun: (label: string, action: () => void, critical?: boolean) => {
    safeRunCalls.push({ label });
    try {
      action();
    } catch (e) {
      // Simulate safeRun catching the error
      safeRunCalls[safeRunCalls.length - 1]!.error = String(e);
    }
  },
}));

// Mock systemPhase to return 0 (simplify cadence testing)
vi.mock("../../../src/kernel/phase", () => ({
  systemPhase: () => 0,
}));

// Mock stage systems
const tacticalRuntimeRun = vi.fn();
const squadMovementRun = vi.fn();
const tacticalEngagementRun = vi.fn();
const combatMicroRun = vi.fn();

vi.mock("../../../src/systems/tactical-runtime-system", () => ({
  tacticalRuntimeSystem: { name: "tactical-runtime", priority: 2, interval: 10, run: (ctx: unknown) => tacticalRuntimeRun(ctx) },
}));
vi.mock("../../../src/systems/squad-movement-runtime", () => ({
  squadMovementSystem: { name: "squad-movement", priority: 2, interval: 1, run: (ctx: unknown) => squadMovementRun(ctx) },
}));
vi.mock("../../../src/systems/tactical-engagement-runtime", () => ({
  tacticalEngagementSystem: { name: "tactical-engagement", priority: 2, interval: 3, run: (ctx: unknown) => tacticalEngagementRun(ctx) },
}));
vi.mock("../../../src/systems/combat-micro-runtime", () => ({
  combatMicroSystem: { name: "combat-micro", priority: 2, interval: 3, run: (ctx: unknown) => combatMicroRun(ctx) },
}));

// Mock intelligence pipeline stages
const experienceCollectorRun = vi.fn();
const strategyEvaluationRun = vi.fn();
const predictionRun = vi.fn();
const calibrationResolutionRun = vi.fn();
const intelligenceStateRun = vi.fn();
const recommendationEngineRun = vi.fn();

vi.mock("../../../src/systems/intelligence/experience-collector-system", () => ({
  experienceCollectorSystem: { name: "experience-collector", priority: 3, interval: 100, phase: "post", run: (ctx: unknown) => experienceCollectorRun(ctx) },
}));
vi.mock("../../../src/systems/intelligence/strategy-evaluation-system", () => ({
  strategyEvaluationSystem: { name: "strategy-evaluation", priority: 3, interval: 500, phase: "post", run: (ctx: unknown) => strategyEvaluationRun(ctx) },
}));
vi.mock("../../../src/systems/intelligence/prediction-system", () => ({
  predictionSystem: { name: "prediction", priority: 3, interval: 500, phase: "post", run: (ctx: unknown) => predictionRun(ctx) },
}));
vi.mock("../../../src/systems/intelligence/calibration-resolution-system", () => ({
  calibrationResolutionSystem: { name: "calibration-resolution", priority: 3, interval: 500, phase: "post", run: (ctx: unknown) => calibrationResolutionRun(ctx) },
}));
vi.mock("../../../src/systems/intelligence/intelligence-state-system", () => ({
  intelligenceStateSystem: { name: "intelligence-state", priority: 3, interval: 500, phase: "post", run: (ctx: unknown) => intelligenceStateRun(ctx) },
}));
vi.mock("../../../src/systems/intelligence/recommendation-engine-system", () => ({
  recommendationEngineSystem: { name: "recommendation-engine", priority: 3, interval: 500, phase: "post", run: (ctx: unknown) => recommendationEngineRun(ctx) },
}));

function makeCtx(tick: number) {
  return { tick, budget: { tier: "healthy" as const, softLimit: 20, hardLimit: 50, canStart: () => true, isExhausted: () => false, spent: () => 0 }, globalSiteCount: 0, getSnapshot: () => undefined, snapshots: () => [] } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  safeRunCalls = [];
});

// ─── Tactical Runtime Pipeline Tests ──────────────────────

describe("Tactical Runtime Pipeline: Stage 顺序", () => {
  it("tactical-runtime 在 squad-movement 之前运行（producer→consumer）", () => {
    // tick=0: phase=0, all stages at intervals 10/1/3/3 → tactical-runtime(10%0==0), squad(always), engagement(3%0==0), micro(3%0==0)
    tacticalRuntimePipelineSystem.run(makeCtx(0));

    const runOrder = [
      ...safeRunCalls.map(c => c.label),
    ];

    // tactical-runtime should be before squad-movement
    const trIdx = runOrder.indexOf("tactical-runtime-pipeline/tactical-runtime");
    const smIdx = runOrder.indexOf("tactical-runtime-pipeline/squad-movement");
    expect(trIdx).toBeGreaterThanOrEqual(0);
    expect(smIdx).toBeGreaterThanOrEqual(0);
    expect(trIdx).toBeLessThan(smIdx);
  });

  it("squad-movement 在 tactical-engagement 之前运行", () => {
    tacticalRuntimePipelineSystem.run(makeCtx(0));

    const runOrder = safeRunCalls.map(c => c.label);
    const smIdx = runOrder.indexOf("tactical-runtime-pipeline/squad-movement");
    const teIdx = runOrder.indexOf("tactical-runtime-pipeline/tactical-engagement");
    expect(smIdx).toBeLessThan(teIdx);
  });

  it("tactical-engagement 在 combat-micro 之前运行", () => {
    tacticalRuntimePipelineSystem.run(makeCtx(0));

    const runOrder = safeRunCalls.map(c => c.label);
    const teIdx = runOrder.indexOf("tactical-runtime-pipeline/tactical-engagement");
    const cmIdx = runOrder.indexOf("tactical-runtime-pipeline/combat-micro");
    expect(teIdx).toBeLessThan(cmIdx);
  });
});

describe("Tactical Runtime Pipeline: Cadence", () => {
  it("squad-movement 每 tick 运行", () => {
    for (let tick = 0; tick < 5; tick++) {
      squadMovementRun.mockClear();
      tacticalRuntimePipelineSystem.run(makeCtx(tick));
      expect(squadMovementRun).toHaveBeenCalledTimes(1);
    }
  });

  it("tactical-runtime 每 10 tick 运行", () => {
    for (let tick = 0; tick < 20; tick++) {
      tacticalRuntimeRun.mockClear();
      tacticalRuntimePipelineSystem.run(makeCtx(tick));
      if (tick % 10 === 0) {
        expect(tacticalRuntimeRun).toHaveBeenCalledTimes(1);
      } else {
        expect(tacticalRuntimeRun).not.toHaveBeenCalled();
      }
    }
  });

  it("tactical-engagement 和 combat-micro 每 3 tick 运行", () => {
    for (let tick = 0; tick < 10; tick++) {
      tacticalEngagementRun.mockClear();
      combatMicroRun.mockClear();
      tacticalRuntimePipelineSystem.run(makeCtx(tick));
      if (tick % 3 === 0) {
        expect(tacticalEngagementRun).toHaveBeenCalledTimes(1);
        expect(combatMicroRun).toHaveBeenCalledTimes(1);
      } else {
        expect(tacticalEngagementRun).not.toHaveBeenCalled();
        expect(combatMicroRun).not.toHaveBeenCalled();
      }
    }
  });
});

describe("Tactical Runtime Pipeline: 错误隔离", () => {
  it("tactical-runtime 抛错不跳过后续 stage", () => {
    tacticalRuntimeRun.mockImplementationOnce(() => { throw new Error("test error"); });
    // tick=0: all stages run
    tacticalRuntimePipelineSystem.run(makeCtx(0));

    // all stages should have been called despite error in tactical-runtime
    expect(squadMovementRun).toHaveBeenCalled();
    expect(tacticalEngagementRun).toHaveBeenCalled();
    expect(combatMicroRun).toHaveBeenCalled();
  });

  it("squad-movement 抛错不跳过后续 stage", () => {
    squadMovementRun.mockImplementationOnce(() => { throw new Error("test error"); });
    tacticalRuntimePipelineSystem.run(makeCtx(0));

    expect(tacticalEngagementRun).toHaveBeenCalled();
    expect(combatMicroRun).toHaveBeenCalled();
  });

  it("每个 stage 的 safeRun label 包含 pipeline 名和 stage 名", () => {
    tacticalRuntimePipelineSystem.run(makeCtx(0));

    const labels = safeRunCalls.map(c => c.label);
    expect(labels).toContain("tactical-runtime-pipeline/tactical-runtime");
    expect(labels).toContain("tactical-runtime-pipeline/squad-movement");
    expect(labels).toContain("tactical-runtime-pipeline/tactical-engagement");
    expect(labels).toContain("tactical-runtime-pipeline/combat-micro");
  });
});

// ─── Intelligence Pipeline Tests ──────────────────────────

describe("Intelligence Pipeline: Stage 顺序", () => {
  it("experience-collector 在 strategy-evaluation 之前运行", () => {
    intelligencePipelineSystem.run(makeCtx(0));

    const runOrder = safeRunCalls.map(c => c.label);
    const ecIdx = runOrder.indexOf("intelligence-pipeline/experience-collector");
    const seIdx = runOrder.indexOf("intelligence-pipeline/strategy-evaluation");
    expect(ecIdx).toBeGreaterThanOrEqual(0);
    expect(seIdx).toBeGreaterThanOrEqual(0);
    expect(ecIdx).toBeLessThan(seIdx);
  });

  it("strategy-evaluation 在 prediction 之前运行", () => {
    intelligencePipelineSystem.run(makeCtx(0));

    const runOrder = safeRunCalls.map(c => c.label);
    const seIdx = runOrder.indexOf("intelligence-pipeline/strategy-evaluation");
    const pIdx = runOrder.indexOf("intelligence-pipeline/prediction");
    expect(seIdx).toBeLessThan(pIdx);
  });
});

describe("Intelligence Pipeline: Cadence", () => {
  it("experience-collector 每 100t 运行（始终执行）", () => {
    for (const tick of [0, 100, 200, 300]) {
      experienceCollectorRun.mockClear();
      intelligencePipelineSystem.run(makeCtx(tick));
      expect(experienceCollectorRun).toHaveBeenCalledTimes(1);
    }
  });

  it("500t 阶段在 tick%500===0 时运行", () => {
    // tick=0: 500t stages run
    intelligencePipelineSystem.run(makeCtx(0));
    expect(strategyEvaluationRun).toHaveBeenCalledTimes(1);
    expect(predictionRun).toHaveBeenCalledTimes(1);
    expect(calibrationResolutionRun).toHaveBeenCalledTimes(1);
    expect(intelligenceStateRun).toHaveBeenCalledTimes(1);
    expect(recommendationEngineRun).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    // tick=100: 500t stages don't run
    intelligencePipelineSystem.run(makeCtx(100));
    expect(strategyEvaluationRun).not.toHaveBeenCalled();
    expect(predictionRun).not.toHaveBeenCalled();
  });

  it("cadence 不死锁：500t 阶段在 tick=500 时运行", () => {
    intelligencePipelineSystem.run(makeCtx(500));
    expect(strategyEvaluationRun).toHaveBeenCalledTimes(1);
    expect(predictionRun).toHaveBeenCalledTimes(1);
    expect(calibrationResolutionRun).toHaveBeenCalledTimes(1);
    expect(intelligenceStateRun).toHaveBeenCalledTimes(1);
    expect(recommendationEngineRun).toHaveBeenCalledTimes(1);
  });
});

describe("Intelligence Pipeline: 错误隔离", () => {
  it("experience-collector 抛错不跳过 strategy-evaluation", () => {
    experienceCollectorRun.mockImplementationOnce(() => { throw new Error("test error"); });
    intelligencePipelineSystem.run(makeCtx(0));

    expect(strategyEvaluationRun).toHaveBeenCalled();
    expect(predictionRun).toHaveBeenCalled();
  });

  it("pipeline 停止时 A6 不影响帝国主执行链（Shadow-Only 不变量）", () => {
    // 如果 pipeline 完全不运行，帝国照常安全运行
    // 这里验证的是：pipeline 的 safeRun label 不包含任何执行系统名
    intelligencePipelineSystem.run(makeCtx(0));
    const labels = safeRunCalls.map(c => c.label);
    for (const label of labels) {
      expect(label).not.toContain("spawn");
      expect(label).not.toContain("war-planner");
      expect(label).not.toContain("expansion-manager");
      expect(label).not.toContain("economy");
    }
  });
});
