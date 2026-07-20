import { describe, expect, it } from "vitest";
import {
  evaluateEnergyCrisis,
  DEFAULT_CRISIS_OPTIONS,
  type CrisisState,
} from "../src/domain/economy/crisis";
import type { RoomSnapshot } from "../src/kernel/contracts";

function snap(overrides: {
  sources?: { energy: number; energyCapacity: number }[];
  energyAvailable?: number;
  energyCapacityAvailable?: number;
}): RoomSnapshot {
  return {
    sources: (overrides.sources ?? []).map(s => ({
      energy: s.energy,
      energyCapacity: s.energyCapacity,
    })),
    energyAvailable: overrides.energyAvailable ?? 800,
    energyCapacityAvailable: overrides.energyCapacityAvailable ?? 1000,
  } as unknown as RoomSnapshot;
}

const IDLE: CrisisState = { crisisScore: 0, energyCrisis: false };

/** 连续运行 n 次评估，返回最终状态。 */
function run(state: CrisisState, snapshot: RoomSnapshot, n: number): CrisisState {
  let s = state;
  for (let i = 0; i < n; i++) s = evaluateEnergyCrisis(snapshot, s, DEFAULT_CRISIS_OPTIONS);
  return s;
}

// 危机条件：source 高满（>=85%）且 energyAvailable < min(capacity*0.4, 400)。
const crisisSnapshot = () =>
  snap({
    sources: [
      { energy: 2900, energyCapacity: 3000 },
      { energy: 2800, energyCapacity: 3000 },
    ],
    energyAvailable: 100,
    energyCapacityAvailable: 1000,
  });

describe("Crisis — evaluateEnergyCrisis", () => {
  it("does not trigger when sources are depleted and energy healthy", () => {
    const s = evaluateEnergyCrisis(
      snap({ sources: [{ energy: 100, energyCapacity: 3000 }], energyAvailable: 800 }),
      IDLE,
    );
    expect(s.energyCrisis).toBe(false);
    expect(s.crisisScore).toBe(0);
  });

  it("does not trigger when sources are full but energy is healthy", () => {
    const s = evaluateEnergyCrisis(
      snap({ sources: [{ energy: 2900, energyCapacity: 3000 }], energyAvailable: 800 }),
      IDLE,
    );
    expect(s.energyCrisis).toBe(false);
  });

  it("does not trigger when energy is low but sources are being depleted", () => {
    const s = evaluateEnergyCrisis(
      snap({ sources: [{ energy: 100, energyCapacity: 3000 }], energyAvailable: 100 }),
      IDLE,
    );
    expect(s.energyCrisis).toBe(false);
  });

  it("does not trigger when there are no sources", () => {
    const s = evaluateEnergyCrisis(snap({ sources: [], energyAvailable: 100 }), IDLE);
    expect(s.energyCrisis).toBe(false);
  });

  it("accumulates score and enters crisis after sustained condition", () => {
    // scoreStep 10, enterScore 100 → 需 10 次持续危机评估。
    const after9 = run(IDLE, crisisSnapshot(), 9);
    expect(after9.energyCrisis).toBe(false);
    expect(after9.crisisScore).toBe(90);
    const after10 = run(IDLE, crisisSnapshot(), 10);
    expect(after10.energyCrisis).toBe(true);
    expect(after10.crisisScore).toBe(100);
  });

  it("holds crisis with hysteresis and exits only after sustained recovery", () => {
    const inCrisis: CrisisState = { crisisScore: 100, energyCrisis: true };
    // 恢复快照：source 被抽低 + 能量回升 → 危机条件不成立，分数递减。
    const recovered = snap({
      sources: [{ energy: 100, energyCapacity: 3000 }],
      energyAvailable: 800,
    });
    // exitScore 40：从 100 递减到 40 需 6 次（100→90→80→70→60→50→40）。
    const after5 = run(inCrisis, recovered, 5);
    expect(after5.crisisScore).toBe(50);
    expect(after5.energyCrisis).toBe(true); // 仍未到 exitScore
    const after6 = run(inCrisis, recovered, 6);
    expect(after6.crisisScore).toBe(40);
    expect(after6.energyCrisis).toBe(false); // 到达 exitScore，退出
  });

  it("score is clamped to [0, enterScore]", () => {
    const inCrisis: CrisisState = { crisisScore: 100, energyCrisis: true };
    const s = evaluateEnergyCrisis(crisisSnapshot(), inCrisis);
    expect(s.crisisScore).toBe(100); // 不超过上限
    const s2 = run(IDLE, snap({ sources: [{ energy: 100, energyCapacity: 3000 }], energyAvailable: 800 }), 20);
    expect(s2.crisisScore).toBe(0); // 不低于 0
  });
});
