import { describe, expect, it } from "vitest";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  DEFAULT_PHASE_OPTIONS,
  type PhaseInput,
  type PhaseOptions,
  type PhaseState,
} from "../../../src/domain/economy/phase";

function input(overrides?: Partial<PhaseInput>): PhaseInput {
  return {
    reserve: 2000,
    spendable: 300,
    // 默认 0.3（< drainSpendableFloor 0.5）：代表 spawn 口袋吃紧的真实失血场景，
    // 使 runDrain 的赤字计分生效。主动消费豁免有专属用例覆盖高 spendableRatio。
    spendableRatio: 0.3,
    frozenRatio: 0.0,
    harvesterCount: 2,
    sourceCount: 2,
    rcl: 3,
    ...overrides,
  };
}

function opts(overrides: Partial<PhaseOptions> = {}): PhaseOptions {
  return { ...DEFAULT_PHASE_OPTIONS, ...overrides };
}

/** 关闭最短驻留的选项 — 用于只验证分数迟滞机制的用例。 */
const NO_DWELL = opts({ minBandTicks: 0 });

const FRESH: PhaseState = { phase: "growth", prevReserve: undefined, drainScore: 0, liquidityScore: 0 };

/** 连续 n 次评估，reserve 每步变化 step。返回最终结果。 */
function runDrain(state: PhaseState, start: number, step: number, n: number, options?: PhaseOptions) {
  let s = state;
  let reserve = start;
  let last = evaluateColonyPhase(input({ reserve }), s, options);
  for (let i = 1; i < n; i++) {
    reserve += step;
    last = evaluateColonyPhase(input({ reserve }), last, options);
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
    // NO_DWELL：本用例只验证分数迟滞；驻留机制有专属用例。
    const recover3 = runDrain(inCrisis, 1500, 100, 3, NO_DWELL); // →30, 仍在 crisis 迟滞带
    expect(recover3.drainScore).toBe(30);
    expect(recover3.phase).toBe("crisis");
    const recover4 = runDrain(inCrisis, 1500, 100, 4, NO_DWELL); // →0, 退出
    expect(recover4.drainScore).toBe(0);
    expect(recover4.phase).toBe("growth");
  });

  it("breaks oscillation with asymmetric recovery step (P0-2)", () => {
    // 交替赤字/盈余：旧对称步长下净变化=0，永远卡在 crisis。
    // 非对称步长（recoveryStep=40 > scoreStep=15）每轮净 -25，最终退出。
    let state = runDrain(FRESH, 2000, -100, 11); // 进入 crisis, drainScore=150
    expect(state.phase).toBe("crisis");

    // 交替 8 轮（1赤字+1盈余）— NO_DWELL 隔离分数机制。
    for (let i = 0; i < 8; i++) {
      state = evaluateColonyPhase(
        input({ reserve: (state.prevReserve ?? 1500) - 100 }),
        state,
        NO_DWELL,
      );
      state = evaluateColonyPhase(
        input({ reserve: (state.prevReserve ?? 1400) + 100 }),
        state,
        NO_DWELL,
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

  // ── TD-003 极限环治理：主动消费豁免 ──
  // 根因 A：drainScore 把「刻意消费」（孵化/升级/建造）与「生产崩溃」同等计为赤字，
  // recovery 收缩支出 → 盈余 → 秒退 → normal 恢复支出 → 再入，形成极限环。

  it("falling reserve with healthy spendableRatio does not accumulate drainScore (主动消费豁免)", () => {
    // spawn 口袋健康（≥ drainSpendableFloor 0.5）时的储备下降是升级/建造投资。
    let s: PhaseState = FRESH;
    let last = evaluateColonyPhase(input({ reserve: 5000, spendableRatio: 0.9 }), s);
    for (let i = 1; i < 15; i++) {
      last = evaluateColonyPhase(
        input({ reserve: 5000 - i * 100, spendableRatio: 0.9 }),
        last,
      );
    }
    expect(last.drainScore).toBe(0);
    expect(last.phase).toBe("growth");
  });

  it("falling reserve with strained spendableRatio still accumulates drainScore", () => {
    // 真实失血：储备下降且 spawn 口袋吃紧 — 豁免不得掩盖生产崩溃。
    const drained = runDrain(FRESH, 2000, -100, 11); // input 默认 spendableRatio 0.3
    expect(drained.drainScore).toBe(150);
    expect(drained.phase).toBe("crisis");
  });

  // ── TD-003 极限环治理：危机带最短驻留 ──
  // 根因 B：recoveryStep(40) 快速清分后秒退回 normal，支出立刻恢复、赤字重新累积。

  it("crisis band enforces minimum dwell before returning to normal", () => {
    const dwellOpts = opts({ minBandTicks: 8 });
    let state = runDrain(FRESH, 2000, -100, 11, dwellOpts); // 进入 crisis，bandTicks=1
    expect(state.phase).toBe("crisis");

    // 持续盈余：分数 150→110→70→30→0，第 4 次评估起分数已清，
    // 但驻留未满 → 停在 recovery 攒缓冲；驻留满后才回 growth。
    const phases: string[] = [];
    let reserve = 1500;
    for (let i = 0; i < 8; i++) {
      reserve += 100;
      state = evaluateColonyPhase(input({ reserve }), state, dwellOpts);
      phases.push(state.phase);
    }
    expect(phases).toEqual([
      "crisis", "crisis", "crisis",
      "recovery", "recovery", "recovery", "recovery",
      "growth",
    ]);
  });

  it("crisis exit always passes through recovery band (no 30→0 direct-to-normal skip)", () => {
    // 默认选项（minBandTicks=100）下，即使 recoveryStep 把分数从迟滞带直接打到 0，
    // 驻留未满仍停在 recovery — crisis 不再直切 normal。
    const inCrisis = runDrain(FRESH, 2000, -100, 11);
    const after4 = runDrain(inCrisis, 1500, 100, 4); // 分数 →0
    expect(after4.drainScore).toBe(0);
    expect(after4.phase).toBe("recovery");
  });

  it("bandTicks counts inside the band and resets to zero on exit", () => {
    const dwellOpts = opts({ minBandTicks: 2 });
    let state = runDrain(FRESH, 2000, -100, 11, dwellOpts); // 入带
    expect(state.bandTicks).toBe(1);
    state = evaluateColonyPhase(input({ reserve: 1600 }), state, dwellOpts);
    expect(state.bandTicks).toBe(2);
    // 分数清零 + 驻留满足 → 出带归零。
    for (let i = 0; i < 4; i++) {
      state = evaluateColonyPhase(input({ reserve: 1700 + i * 100 }), state, dwellOpts);
    }
    expect(state.phase).toBe("growth");
    expect(state.bandTicks).toBe(0);
  });

  // ── 流动性维度（方案 C）──
  // W37S58 根因：总储备在涨（drainScore=0）但 94% 能量冻在 container、spawn 仅 5% 可达，
  // 旧模型判为 growth → 永久死锁。流动性维度修复这一失明。

  /** 连续 n 次处于流动性陷阱（spawn 空 + container 满），reserve 保持稳定（偿付健康）。 */
  function runLiquidityTrap(state: PhaseState, n: number, options?: PhaseOptions) {
    let s = state;
    let last = evaluateColonyPhase(
      input({ reserve: 6000, spendableRatio: 0.05, frozenRatio: 0.94 }),
      s,
      options,
    );
    for (let i = 1; i < n; i++) {
      // reserve 微涨（harvester 持续填 container）→ reserveDelta > 0 → drainScore 不累加。
      last = evaluateColonyPhase(
        input({ reserve: 6000 + i * 10, spendableRatio: 0.05, frozenRatio: 0.94 }),
        last,
        options,
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
    // liquidityRecoveryStep 50：150→100→50→0(脱离)。NO_DWELL 隔离分数机制。
    let s = inCrisis;
    for (let i = 0; i < 3; i++) {
      s = evaluateColonyPhase(
        input({ reserve: 6100, spendableRatio: 0.8, frozenRatio: 0.2 }),
        s,
        NO_DWELL,
      );
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
