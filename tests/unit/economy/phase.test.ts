import { describe, expect, it } from "vitest";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  DEFAULT_PHASE_OPTIONS,
  type PhaseInput,
  type PhaseState,
} from "../../../src/domain/economy/phase";

function input(overrides?: Partial<PhaseInput>): PhaseInput {
  return {
    reserve: 2000,
    spendable: 300,
    harvesterCount: 2,
    sourceCount: 2,
    rcl: 3,
    ...overrides,
  };
}

const FRESH: PhaseState = { phase: "growth", prevReserve: undefined, drainScore: 0 };

/** 连续 n 次评估，reserve 每步变化 step。返回最终结果。 */
function runDrain(state: PhaseState, start: number, step: number, n: number) {
  let s = state;
  let reserve = start;
  let last = evaluateColonyPhase(input({ reserve }), s);
  for (let i = 1; i < n; i++) {
    reserve += step;
    last = evaluateColonyPhase(input({ reserve }), last);
  }
  return last;
}

describe("Phase — evaluateColonyPhase", () => {
  it("first observation has zero reserveDelta and stays growth when staffed", () => {
    const r = evaluateColonyPhase(input({ reserve: 2000 }), FRESH);
    expect(r.reserveDelta).toBe(0);
    expect(r.phase).toBe("growth");
  });

  it("reports bootstrap when harvesters are fewer than sources", () => {
    const r = evaluateColonyPhase(input({ harvesterCount: 1, sourceCount: 2, reserve: 2000 }), FRESH);
    expect(r.phase).toBe("bootstrap");
  });

  it("reports steady at RCL8 when fully staffed", () => {
    const r = evaluateColonyPhase(input({ rcl: 8, harvesterCount: 2, sourceCount: 2 }), FRESH);
    expect(r.phase).toBe("steady");
  });

  it("enters crisis after sustained reserve drain", () => {
    // scoreStep 20, enter 100 → 需 5 次持续赤字。
    const after4 = runDrain(FRESH, 2000, -100, 5); // 第1次 delta=0，之后 4 次赤字 = 80
    expect(after4.drainScore).toBe(80);
    expect(after4.phase).not.toBe("crisis");
    const after5 = runDrain(FRESH, 2000, -100, 6); // 5 次赤字 = 100
    expect(after5.drainScore).toBe(100);
    expect(after5.phase).toBe("crisis");
  });

  it("does not enter crisis when reserve is stable or growing", () => {
    const stable = runDrain(FRESH, 2000, 0, 10);
    expect(stable.drainScore).toBe(0);
    expect(stable.phase).toBe("growth");
    const growing = runDrain(FRESH, 2000, 50, 10);
    expect(growing.phase).toBe("growth");
  });

  it("exits crisis through recovery with hysteresis", () => {
    // 先进入 crisis。
    const inCrisis = runDrain(FRESH, 2000, -100, 6);
    expect(inCrisis.phase).toBe("crisis");
    // P0-2：非对称步长（recoveryStep=30 > scoreStep=20），恢复比进入更快。
    // drainScore 递减：100→70→40(crisis)→10(exits)→0。
    const recover2 = runDrain(inCrisis, 1500, 100, 3); // →10
    expect(recover2.drainScore).toBe(10);
    // 10 > recoveryClearScore(10)? No → 直接退出到 growth（跳过 recovery 相位）。
    expect(recover2.phase).toBe("growth");
    const cleared = runDrain(inCrisis, 1500, 100, 4); // →0
    expect(cleared.drainScore).toBe(0);
    expect(cleared.phase).toBe("growth");
  });

  it("breaks oscillation with asymmetric recovery step (P0-2)", () => {
    // 交替赤字/盈余：旧对称步长下净变化=0，永远卡在 crisis。
    // 新非对称步长（recoveryStep=30 > scoreStep=20）每轮净 -10，最终退出。
    let state = runDrain(FRESH, 2000, -100, 6); // 进入 crisis, drainScore=100
    expect(state.phase).toBe("crisis");

    // 交替 8 轮（1赤字+1盈余）
    for (let i = 0; i < 8; i++) {
      state = evaluateColonyPhase(
        input({ reserve: (state.prevReserve ?? 1500) - 100 }),
        state,
      );
      state = evaluateColonyPhase(
        input({ reserve: (state.prevReserve ?? 1400) + 100 }),
        state,
      );
    }
    // drainScore 从 100 下降到 0，振荡被打破。
    expect(state.drainScore).toBe(0);
    expect(state.phase).toBe("growth");
  });

  it("clamps drainScore to [0, enterScore]", () => {
    const drained = runDrain(FRESH, 5000, -100, 20);
    expect(drained.drainScore).toBe(DEFAULT_PHASE_OPTIONS.drainEnterScore);
  });
});

// ── phaseToColonyState ──
describe("Phase — phaseToColonyState", () => {
  it("returns defense when hostiles present, regardless of phase", () => {
    expect(phaseToColonyState("growth", true)).toBe("defense");
    expect(phaseToColonyState("steady", true)).toBe("defense");
    expect(phaseToColonyState("crisis", true)).toBe("defense");
  });

  it("returns bootstrap when phase is bootstrap", () => {
    expect(phaseToColonyState("bootstrap", false)).toBe("bootstrap");
  });

  it("returns recovery when phase is crisis or recovery", () => {
    expect(phaseToColonyState("crisis", false)).toBe("recovery");
    expect(phaseToColonyState("recovery", false)).toBe("recovery");
  });

  it("returns normal when phase is growth or steady", () => {
    expect(phaseToColonyState("growth", false)).toBe("normal");
    expect(phaseToColonyState("steady", false)).toBe("normal");
  });
});
