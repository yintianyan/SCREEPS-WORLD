import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock globalCache ──────────────────────────────────────

const mockGlobal: Record<string, unknown> = {};

vi.mock("../../../src/kernel/global-cache", () => ({
    globalCache: () => mockGlobal,
}));

// ── Mock DecisionRegistry.recordOutcome ───────────────────
vi.mock("../../../src/telemetry/DecisionRegistry", () => ({
    recordOutcome: vi.fn(),
    drainDecisions: vi.fn(() => []),
    shouldFlushDecisions: vi.fn(() => false),
    drainOutcomes: vi.fn(() => []),
}));

// ── Mock Game ─────────────────────────────────────────────

let mockGameTime = 1000;

vi.stubGlobal("Game", {
    time: 1000,
    cpu: { getUsed: () => 0.5, bucket: 5000, limit: 20 },
    rooms: {},
    creeps: {},
    spawns: {},
    gcl: { level: 3 },
    gpl: { level: 1 },
});

// Suppress console.log during tests
vi.stubGlobal("console", {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
});

// ── Import after mocks ────────────────────────────────────

import {
    declareExpected,
    resolveOutcome,
    evaluatePending,
    getStrategyFeedback,
    pendingCount,
    recentResolved,
    shouldEvaluate,
    resetEvaluation,
    computeDeviations,
    aggregate,
    determineStatus,
} from "../../../src/telemetry/EvaluationRegistry";

import type { ExpectedOutcome, ActualOutcome } from "../../../src/telemetry/EvaluationRegistry";

// ── Helpers ──────────────────────────────────────────────

function makeExpected(overrides: Partial<ExpectedOutcome> = {}): ExpectedOutcome {
    return {
        id: `test-${mockGameTime}`,
        declaredAtTick: mockGameTime,
        domain: "empire",
        decision: "TEST_DECISION",
        target: undefined,
        expectedDeadlineTick: mockGameTime + 200,
        expectedMetrics: { value: 100 },
        confidence: 0.7,
        ...overrides,
    };
}

function makeActual(overrides: Partial<ActualOutcome> = {}): ActualOutcome {
    return {
        resolvedAtTick: mockGameTime,
        actualMetrics: { value: 100 },
        result: "COMPLETED",
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────

beforeEach(() => {
    // Clean all global state
    for (const key of Object.keys(mockGlobal)) {
        delete mockGlobal[key];
    }
    mockGameTime = 1000;
    (Game as any).time = mockGameTime;
    resetEvaluation();
});

describe("T3: EvaluationRegistry — Pure Functions", () => {
    describe("computeDeviations", () => {
        it("should return 0% deviation when actual matches expected", () => {
            const dev = computeDeviations({ energy: 100 }, { energy: 100 });
            expect(dev.energy).toBe(0);
        });

        it("should return positive deviation when actual exceeds expected", () => {
            const dev = computeDeviations({ energy: 100 }, { energy: 120 });
            expect(dev.energy).toBe(20); // +20%
        });

        it("should return negative deviation when actual is below expected", () => {
            const dev = computeDeviations({ energy: 100 }, { energy: 50 });
            expect(dev.energy).toBe(-50); // -50%
        });

        it("should treat missing actual as 0", () => {
            const dev = computeDeviations({ energy: 100 }, {});
            expect(dev.energy).toBe(-100); // 0 - 100 = -100%
        });

        it("should handle multiple metrics", () => {
            const dev = computeDeviations(
                { energy: 100, rooms: 2 },
                { energy: 90, rooms: 3 },
            );
            expect(dev.energy).toBe(-10);
            expect(dev.rooms).toBe(50); // (3-2)/max(2,1) = 50%
        });

        it("should handle zero expected (denom = max(0, 1) = 1)", () => {
            const dev = computeDeviations({ count: 0 }, { count: 5 });
            expect(dev.count).toBe(500); // (5-0)/max(0,1) = 500%
        });
    });

    describe("aggregate", () => {
        it("should return 0 for empty deviations", () => {
            expect(aggregate({})).toBe(0);
        });

        it("should return the mean of all deviation values", () => {
            expect(aggregate({ a: 10, b: 20, c: 30 })).toBe(20);
        });

        it("should handle negative values", () => {
            expect(aggregate({ a: -10, b: -20 })).toBe(-15);
        });

        it("should handle mixed positive and negative", () => {
            expect(aggregate({ a: 10, b: -30 })).toBe(-10);
        });
    });

    describe("determineStatus", () => {
        it("should return fulfilled when all deviations within ±10%", () => {
            const expected = makeExpected({ expectedMetrics: { v: 100 } });
            const actual = makeActual({ actualMetrics: { v: 95 } });
            const deviations = { v: -5 };
            expect(determineStatus(expected, actual, deviations)).toBe("fulfilled");
        });

        it("should return missed when any deviation below -10%", () => {
            const expected = makeExpected({ expectedMetrics: { v: 100 } });
            const actual = makeActual({ actualMetrics: { v: 50 } });
            const deviations = { v: -50 };
            expect(determineStatus(expected, actual, deviations)).toBe("missed");
        });

        it("should return missed when result is FAILED", () => {
            const expected = makeExpected();
            const actual = makeActual({ result: "FAILED" });
            const deviations = { v: 0 };
            expect(determineStatus(expected, actual, deviations)).toBe("missed");
        });

        it("should return missed when result is CANCELLED", () => {
            const expected = makeExpected();
            const actual = makeActual({ result: "CANCELLED" });
            const deviations = { v: 0 };
            expect(determineStatus(expected, actual, deviations)).toBe("missed");
        });
    });
});

describe("T3: EvaluationRegistry — Lifecycle", () => {
    describe("declareExpected", () => {
        it("should add a pending expectation", () => {
            declareExpected(makeExpected({ id: "exp-1" }));
            expect(pendingCount()).toBe(1);
        });

        it("should be idempotent (same id not duplicated)", () => {
            declareExpected(makeExpected({ id: "exp-1" }));
            declareExpected(makeExpected({ id: "exp-1" }));
            expect(pendingCount()).toBe(1);
        });

        it("should not override existing pending with same id", () => {
            declareExpected(makeExpected({ id: "exp-1", decision: "FIRST" }));
            declareExpected(makeExpected({ id: "exp-1", decision: "SECOND" }));
            expect(pendingCount()).toBe(1);
        });
    });

    describe("resolveOutcome", () => {
        it("should resolve a pending expectation", () => {
            declareExpected(makeExpected({ id: "exp-1" }));
            resolveOutcome("exp-1", makeActual());
            expect(pendingCount()).toBe(0);
            const resolved = recentResolved(1);
            expect(resolved).toHaveLength(1);
            expect(resolved[0]!.id).toBe("exp-1");
            expect(resolved[0]!.status).toBe("fulfilled");
        });

        it("should be safe when id not found (silent skip)", () => {
            resolveOutcome("nonexistent", makeActual());
            expect(pendingCount()).toBe(0);
            expect(recentResolved(1)).toHaveLength(0);
        });

        it("should compute deviations on resolve", () => {
            declareExpected(
                makeExpected({
                    id: "exp-1",
                    expectedMetrics: { energy: 100, rooms: 2 },
                }),
            );
            resolveOutcome("exp-1", makeActual({ actualMetrics: { energy: 80, rooms: 3 } }));
            const resolved = recentResolved(1);
            expect(resolved[0]!.deviations.energy).toBe(-20);
            expect(resolved[0]!.deviations.rooms).toBe(50);
            expect(resolved[0]!.aggregateDeviation).toBe(15); // (-20 + 50) / 2
        });
    });

    describe("evaluatePending", () => {
        it("should expire pending expectations past deadline + grace", () => {
            declareExpected(
                makeExpected({
                    id: "exp-1",
                    declaredAtTick: 500,
                    expectedDeadlineTick: 600,
                }),
            );
            // Advance time past deadline + grace (600 + 50 = 650)
            mockGameTime = 700;
            (Game as any).time = mockGameTime;

            const feedback = evaluatePending(mockGameTime);

            expect(pendingCount()).toBe(0);
            const resolved = recentResolved(1);
            expect(resolved).toHaveLength(1);
            expect(resolved[0]!.status).toBe("expired");
        });

        it("should not expire pending within deadline", () => {
            declareExpected(
                makeExpected({
                    id: "exp-1",
                    declaredAtTick: 500,
                    expectedDeadlineTick: 700,
                }),
            );
            mockGameTime = 600;
            (Game as any).time = mockGameTime;

            evaluatePending(mockGameTime);

            expect(pendingCount()).toBe(1);
        });

        it("should produce Strategy Feedback with underperforming domain", () => {
            // Declare two missed expectations for expansion domain
            declareExpected(
                makeExpected({
                    id: "exp-1",
                    domain: "expansion",
                    declaredAtTick: 800,
                    expectedMetrics: { value: 100 },
                }),
            );
            resolveOutcome("exp-1", makeActual({
                actualMetrics: { value: 10 },
                result: "FAILED",
            }));

            declareExpected(
                makeExpected({
                    id: "exp-2",
                    domain: "expansion",
                    declaredAtTick: 850,
                    expectedMetrics: { value: 100 },
                }),
            );
            resolveOutcome("exp-2", makeActual({
                actualMetrics: { value: 20 },
                result: "FAILED",
            }));

            mockGameTime = 1100;
            (Game as any).time = mockGameTime;

            const feedback = evaluatePending(mockGameTime);

            const exp = feedback.byDomain["expansion"];
            expect(exp).toBeDefined();
            expect(exp!.missed).toBe(2);
            expect(exp!.sampleCount).toBe(2);
            // avgDeviation should be very negative
            expect(exp!.avgDeviation).toBeLessThan(-15);
            expect(feedback.underperformingDomains).toContain("expansion");
        });

        it("should produce Strategy Feedback with overperforming domain", () => {
            declareExpected(
                makeExpected({
                    id: "exp-1",
                    domain: "war",
                    declaredAtTick: 800,
                    expectedMetrics: { value: 100 },
                }),
            );
            resolveOutcome("exp-1", makeActual({
                actualMetrics: { value: 150 },
                result: "COMPLETED",
            }));

            declareExpected(
                makeExpected({
                    id: "exp-2",
                    domain: "war",
                    declaredAtTick: 850,
                    expectedMetrics: { value: 100 },
                }),
            );
            resolveOutcome("exp-2", makeActual({
                actualMetrics: { value: 140 },
                result: "COMPLETED",
            }));

            mockGameTime = 1100;
            (Game as any).time = mockGameTime;

            const feedback = evaluatePending(mockGameTime);

            const war = feedback.byDomain["war"];
            expect(war).toBeDefined();
            expect(war!.fulfilled).toBe(2);
            expect(feedback.overperformingDomains).toContain("war");
        });

        it("should write feedback to globalCache", () => {
            mockGameTime = 1100;
            (Game as any).time = mockGameTime;
            const feedback = evaluatePending(mockGameTime);
            expect(mockGlobal.strategyFeedback).toBeDefined();
            expect((mockGlobal.strategyFeedback as { tick: number }).tick).toBe(mockGameTime);
        });
    });

    describe("getStrategyFeedback", () => {
        it("should return undefined when no evaluation has run", () => {
            expect(getStrategyFeedback()).toBeUndefined();
        });

        it("should return feedback after evaluatePending", () => {
            mockGameTime = 1100;
            (Game as any).time = mockGameTime;
            evaluatePending(mockGameTime);
            expect(getStrategyFeedback()).toBeDefined();
        });
    });

    describe("shouldEvaluate", () => {
        it("should return true when enough ticks have passed", () => {
            // First evaluation at tick 1000
            mockGameTime = 1000;
            (Game as any).time = mockGameTime;
            evaluatePending(mockGameTime);

            // Not enough time has passed
            mockGameTime = 1050;
            (Game as any).time = mockGameTime;
            expect(shouldEvaluate(mockGameTime)).toBe(false);

            // 100 ticks later
            mockGameTime = 1100;
            (Game as any).time = mockGameTime;
            expect(shouldEvaluate(mockGameTime)).toBe(true);
        });
    });

    describe("Ring Buffer", () => {
        it("should not grow resolved beyond MAX_RESOLVED", () => {
            // Fill with more than MAX_RESOLVED (200) entries
            for (let i = 0; i < 210; i++) {
                declareExpected(makeExpected({ id: `exp-${i}` }));
                resolveOutcome(`exp-${i}`, makeActual());
            }
            // Should be capped at 200
            expect(recentResolved(300)).toHaveLength(200);
        });
    });

    describe("Global Reset Recovery", () => {
        it("should rebuild from empty after global reset", () => {
            declareExpected(makeExpected({ id: "exp-1" }));
            expect(pendingCount()).toBe(1);

            // Simulate global reset
            for (const key of Object.keys(mockGlobal)) {
                delete mockGlobal[key];
            }
            resetEvaluation();

            expect(pendingCount()).toBe(0);
            expect(getStrategyFeedback()).toBeUndefined();
        });
    });
});
