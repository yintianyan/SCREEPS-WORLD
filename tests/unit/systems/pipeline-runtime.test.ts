/** Pipeline Runtime Tests — Phase 6 验证 pipeline 顺序和错误隔离。 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tacticalRuntimePipelineSystem } from "../../../src/systems/tactical-runtime-pipeline";

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

