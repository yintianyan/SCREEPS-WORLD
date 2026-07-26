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
    spendableRatio: 1.0,
    frozenRatio: 0.0,
    harvesterCount: 2,
    sourceCount: 2,
    rcl: 3,
    ...overrides,
  };
}

const FRESH: PhaseState = { phase: "growth", prevReserve: undefined, drainScore: 0, liquidityScore: 0 };

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
    // scoreStep 15, enter 150 → 需 10 次持续赤字。
    const after9 = runDrain(FRESH, 2000, -100, 10); // 第1次 delta=0，之后 9 次赤字 = 135
    expect(after9.drainScore).toBe(135);
    expect(after9.phase).not.toBe("crisis");
    const after10 = runDrain(FRESH, 2000, -100, 11); // 10 次赤字 = 150
    expect(after10.drainScore).toBe(150);
    expect(after10.phase).toBe("crisis");
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
    const inCrisis = runDrain(FRESH, 2000, -100, 11);
    expect(inCrisis.phase).toBe("crisis");
    // 非对称步长（recoveryStep=40 > scoreStep=15），恢复比进入更快。
    // drainScore 递减：150→110→70→30(crisis 迟滞)→0(exits)。
    const recover3 = runDrain(inCrisis, 1500, 100, 3); // →30, 仍在 crisis 迟滞带
    expect(recover3.drainScore).toBe(30);
    expect(recover3.phase).toBe("crisis");
    const recover4 = runDrain(inCrisis, 1500, 100, 4); // →0, 退出
    expect(recover4.drainScore).toBe(0);
    expect(recover4.phase).toBe("growth");
  });

  it("breaks oscillation with asymmetric recovery step (P0-2)", () => {
    // 交替赤字/盈余：旧对称步长下净变化=0，永远卡在 crisis。
    // 非对称步长（recoveryStep=40 > scoreStep=15）每轮净 -25，最终退出。
    let state = runDrain(FRESH, 2000, -100, 11); // 进入 crisis, drainScore=150
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

  // ── 流动性维度（方案 C）──
  // W37S58 根因：总储备在涨（drainScore=0）但 94% 能量冻在 container、spawn 仅 5% 可达，
  // 旧模型判为 growth → 永久死锁。流动性维度修复这一失明。

  /** 连续 n 次处于流动性陷阱（spawn 空 + container 满），reserve 保持稳定（偿付健康）。 */
  function runLiquidityTrap(state: PhaseState, n: number) {
    let s = state;
    let last = evaluateColonyPhase(
      input({ reserve: 6000, spendableRatio: 0.05, frozenRatio: 0.94 }),
      s,
    );
    for (let i = 1; i < n; i++) {
      // reserve 微涨（harvester 持续填 container）→ reserveDelta > 0 → drainScore 不累加。
      last = evaluateColonyPhase(
        input({ reserve: 6000 + i * 10, spendableRatio: 0.05, frozenRatio: 0.94 }),
        last,
      );
    }
    return last;
  }

  it("liquidity trap drives crisis even while reserve is growing (W37S58)", () => {
    // liquidityStep 15，enter 150 → 需 10 次持续陷阱。
    const after9 = runLiquidityTrap(FRESH, 9); // 9 次 = 135
    expect(after9.liquidityScore).toBe(135);
    expect(after9.drainScore).toBe(0); // 偿付维度健康（reserve 在涨）
    expect(after9.phase).not.toBe("crisis");
    const after10 = runLiquidityTrap(FRESH, 10); // 10 次 = 150
    expect(after10.liquidityScore).toBe(150);
    expect(after10.drainScore).toBe(0); // 关键：drainScore 仍为 0，纯靠流动性维度入危机
    expect(after10.phase).toBe("crisis");
  });

  it("container full alone (normal logistics transit) does not trigger crisis", () => {
    // frozenRatio 高但 spendableRatio 健康 = hauler 正在搬运的正常中转，不是死锁。
    let s = FRESH;
    for (let i = 0; i < 10; i++) {
      s = evaluateColonyPhase(input({ frozenRatio: 0.94, spendableRatio: 0.8 }), s);
    }
    expect(s.liquidityScore).toBe(0);
    expect(s.phase).toBe("growth");
  });

  it("spawn empty alone (spawn pulse consumption) does not trigger crisis", () => {
    // spendableRatio 低但 container 也空 = 能量刚被孵化消耗，hauler 马上补回，不是死锁。
    let s = FRESH;
    for (let i = 0; i < 10; i++) {
      s = evaluateColonyPhase(input({ spendableRatio: 0.05, frozenRatio: 0.1 }), s);
    }
    expect(s.liquidityScore).toBe(0);
    expect(s.phase).toBe("growth");
  });

  it("exits liquidity crisis through recovery with hysteresis", () => {
    const inCrisis = runLiquidityTrap(FRESH, 10);
    expect(inCrisis.phase).toBe("crisis");
    // 物流恢复（hauler 补上了）：spendableRatio 回升 → 陷阱解除 → liquidityScore 递减。
    // liquidityRecoveryStep 50：150→100→50→0(脱离)。
    let s = inCrisis;
    for (let i = 0; i < 3; i++) {
      s = evaluateColonyPhase(input({ reserve: 6100, spendableRatio: 0.8, frozenRatio: 0.2 }), s);
    }
    expect(s.liquidityScore).toBe(0);
    expect(s.phase).toBe("growth");
  });

  it("clamps liquidityScore to [0, enterScore]", () => {
    const trapped = runLiquidityTrap(FRESH, 20);
    expect(trapped.liquidityScore).toBe(DEFAULT_PHASE_OPTIONS.drainEnterScore);
  });

  it("solvency drain still works independently when liquidity is healthy", () => {
    // 偿付崩溃（reserve 持续下跌）但流动性健康 → 仍由 drainScore 驱动危机。
    const drained = runDrain(FRESH, 2000, -100, 11);
    expect(drained.drainScore).toBe(150);
    expect(drained.liquidityScore).toBe(0);
    expect(drained.phase).toBe("crisis");
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
