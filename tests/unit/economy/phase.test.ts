import { describe, expect, it } from "vitest";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  DEFAULT_PHASE_OPTIONS,
  type ColonyPhase,
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
    // P0-1 新增字段默认值：srcRatio=0 + storageDrainRate=0 → 不触发 srcRatio 通道，
    // 保持既有 drainScore/liquidityScore 测试行为不变。
    srcRatio: 0,
    storageDrainRate: 0,
    ...overrides,
  };
}

function opts(overrides: Partial<PhaseOptions> = {}): PhaseOptions {
  return { ...DEFAULT_PHASE_OPTIONS, ...overrides };
}

/** 关闭最短驻留的选项 — 用于只验证分数迟滞机制的用例。 */
const NO_DWELL = opts({ minBandTicks: 0 });

/**
 * 关闭流动性驻留闸的选项 — 用于只验证 liquidityScore 步长/迟滞**机制**的用例。
 * 闸门本身（陷阱需连续成立多久才开始计分）有专属用例，别让机制测试去趟它。
 */
const NO_LIQ_GATE = opts({ liquidityEnterTicks: 1 });
const NO_GATE_NO_DWELL = opts({ liquidityEnterTicks: 1, minBandTicks: 0 });

const FRESH: PhaseState = {
  phase: "growth",
  prevReserve: undefined,
  drainScore: 0,
  liquidityScore: 0,
};

/** 连续 n 次评估，reserve 每步变化 step。返回最终结果。 */
function runDrain(
  state: PhaseState,
  start: number,
  step: number,
  n: number,
  options?: PhaseOptions,
) {
  const s = state;
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
    // bootstrapEnterTicks=1：本用例钉的是"欠员判据的轴"（下限 vs source 数），
    // 驻留闸另有专属用例，别让两者混在一起判。
    const r = evaluateColonyPhase(
      input({ harvesterCount: 1, sourceCount: 2, reserve: 2000 }),
      FRESH,
      opts({ bootstrapEnterTicks: 1 }),
    );
    expect(r.phase).toBe("bootstrap");
  });

  it("reports steady at RCL8 when fully staffed", () => {
    const r = evaluateColonyPhase(input({ rcl: 8, harvesterCount: 2, sourceCount: 2 }), FRESH);
    expect(r.phase).toBe("steady");
  });

  it("enters crisis after sustained reserve drain", () => {
    // 流量口径：45 E/tick 的净流失 = 15 分（drainEnergyPerPoint=3），enter 150 → 需 10 次。
    // 取 45 是为了让"一次典型赤字 tick 值 15 分"与旧次数计同量级，迟滞带的算绪不变。
    const after9 = runDrain(FRESH, 2000, -45, 10); // 第1次 delta=0，之后 9 次赤字 = 135
    expect(after9.drainScore).toBe(135);
    expect(after9.phase).not.toBe("crisis");
    const after10 = runDrain(FRESH, 2000, -45, 11); // 10 次赤字 = 150
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
    const inCrisis = runDrain(FRESH, 2000, -45, 11);
    expect(inCrisis.phase).toBe("crisis");
    // 非对称折算：45 E 盈余 = -40 分（×recoveryBias 2.67），恢复比进入更快。
    // drainScore 递减：150→110→70→30(crisis 迟滞)→0(exits)。
    // NO_DWELL：本用例只验证分数迟滞；驻留机制有专属用例。
    const recover3 = runDrain(inCrisis, 1595, 45, 3, NO_DWELL); // →30, 仍在 crisis 迟滞带
    expect(recover3.drainScore).toBe(30);
    expect(recover3.phase).toBe("crisis");
    const recover4 = runDrain(inCrisis, 1595, 45, 4, NO_DWELL); // →0, 退出
    expect(recover4.drainScore).toBe(0);
    expect(recover4.phase).toBe("growth");
  });

  it("breaks oscillation with asymmetric recovery step (P0-2)", () => {
    // 交替赤字/盈余：旧对称步长下净变化=0，永远卡在 crisis。
    // 同一对赤字+盈余每轮净 -25 分（+15 / -40），最终退出。
    let state = runDrain(FRESH, 2000, -45, 11); // 进入 crisis, drainScore=150
    expect(state.phase).toBe("crisis");

    // 交替 8 轮（1赤字+1盈余）— NO_DWELL 隔离分数机制。
    for (let i = 0; i < 8; i++) {
      state = evaluateColonyPhase(
        input({ reserve: (state.prevReserve ?? 1500) - 45 }),
        state,
        NO_DWELL,
      );
      state = evaluateColonyPhase(
        input({ reserve: (state.prevReserve ?? 1400) + 45 }),
        state,
        NO_DWELL,
      );
    }
    // drainScore 从 100 下降到 0，振荡被打破。
    expect(state.drainScore).toBe(0);
    expect(state.phase).toBe("growth");
  });

  it("clamps drainScore to [0, enterScore]", () => {
    const drained = runDrain(FRESH, 5000, -45, 20);
    expect(drained.drainScore).toBe(DEFAULT_PHASE_OPTIONS.drainEnterScore);
  });

  // ── TD-003 极限环治理：主动消费豁免 ──
  // 根因 A：drainScore 把「刻意消费」（孵化/升级/建造）与「生产崩溃」同等计为赤字，
  // recovery 收缩支出 → 盈余 → 秒退 → normal 恢复支出 → 再入，形成极限环。

  it("falling reserve with healthy spendableRatio does not accumulate drainScore (主动消费豁免)", () => {
    // spawn 口袋健康（≥ drainSpendableFloor 0.5）时的储备下降是升级/建造投资。
    const s: PhaseState = FRESH;
    let last = evaluateColonyPhase(input({ reserve: 5000, spendableRatio: 0.9 }), s);
    for (let i = 1; i < 15; i++) {
      last = evaluateColonyPhase(input({ reserve: 5000 - i * 100, spendableRatio: 0.9 }), last);
    }
    expect(last.drainScore).toBe(0);
    expect(last.phase).toBe("growth");
  });

  it("falling reserve with strained spendableRatio still accumulates drainScore", () => {
    // 真实失血：储备下降且 spawn 口袋吃紧 — 豁免不得掩盖生产崩溃。
    const drained = runDrain(FRESH, 2000, -45, 11); // input 默认 spendableRatio 0.3
    expect(drained.drainScore).toBe(150);
    expect(drained.phase).toBe("crisis");
  });

  // ── TD-003 极限环治理：危机带最短驻留 ──
  // 根因 B：盈余折算（45 E ⇒ -40 分）快速清分后秒退回 normal，支出立刻恢复、赤字重新累积。

  it("crisis band enforces minimum dwell before returning to normal", () => {
    const dwellOpts = opts({ minBandTicks: 8 });
    let state = runDrain(FRESH, 2000, -45, 11, dwellOpts); // 进入 crisis，bandTicks=1
    expect(state.phase).toBe("crisis");

    // 持续盈余：分数 150→110→70→30→0，第 4 次评估起分数已清，
    // 但驻留未满 → 停在 recovery 攒缓冲；驻留满后才回 growth。
    const phases: string[] = [];
    let reserve = 1550;
    for (let i = 0; i < 8; i++) {
      reserve += 45;
      state = evaluateColonyPhase(input({ reserve }), state, dwellOpts);
      phases.push(state.phase);
    }
    expect(phases).toEqual([
      "crisis",
      "crisis",
      "crisis",
      "recovery",
      "recovery",
      "recovery",
      "recovery",
      "growth",
    ]);
  });

  it("crisis exit always passes through recovery band (no 30→0 direct-to-normal skip)", () => {
    // 默认选项（minBandTicks=100）下，即使盈余折算把分数从迟滞带直接打到 0，
    // 驻留未满仍停在 recovery — crisis 不再直切 normal。
    const inCrisis = runDrain(FRESH, 2000, -45, 11);
    const after4 = runDrain(inCrisis, 1595, 45, 4); // 分数 →0
    expect(after4.drainScore).toBe(0);
    expect(after4.phase).toBe("recovery");
  });

  it("bandTicks counts inside the band and resets to zero on exit", () => {
    const dwellOpts = opts({ minBandTicks: 2 });
    let state = runDrain(FRESH, 2000, -45, 11, dwellOpts); // 入带
    expect(state.bandTicks).toBe(1);
    state = evaluateColonyPhase(input({ reserve: 1600 }), state, dwellOpts);
    expect(state.bandTicks).toBe(2);
    // 分数清零 + 驻留满足 → 出带归零。
    for (let i = 0; i < 4; i++) {
      state = evaluateColonyPhase(input({ reserve: 1600 + i * 45 }), state, dwellOpts);
    }
    expect(state.phase).toBe("growth");
    expect(state.bandTicks).toBe(0);
  });

  // ── 流动性维度（方案 C）──
  // W37S58 根因：总储备在涨（drainScore=0）但 94% 能量冻在 container、spawn 仅 5% 可达，
  // 旧模型判为 growth → 永久死锁。流动性维度修复这一失明。

  /** 连续 n 次处于流动性陷阱（spawn 空 + container 满），reserve 保持稳定（偿付健康）。 */
  function runLiquidityTrap(state: PhaseState, n: number, options?: PhaseOptions) {
    const s = state;
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
    const after9 = runLiquidityTrap(FRESH, 9, NO_LIQ_GATE); // 9 次 = 135
    expect(after9.liquidityScore).toBe(135);
    expect(after9.drainScore).toBe(0); // 偿付维度健康（reserve 在涨）
    expect(after9.phase).not.toBe("crisis");
    const after10 = runLiquidityTrap(FRESH, 10, NO_LIQ_GATE); // 10 次 = 150
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
    const inCrisis = runLiquidityTrap(FRESH, 10, NO_GATE_NO_DWELL);
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
    const trapped = runLiquidityTrap(FRESH, 20, NO_LIQ_GATE);
    expect(trapped.liquidityScore).toBe(DEFAULT_PHASE_OPTIONS.drainEnterScore);
  });

  // ── 流动性驻留闸（liquidityEnterTicks）──
  // 实测校准依据（E2E-022 富室战争夹具、9000 tick 逐 tick 序列）：19 段陷阱全部在
  // 3~25 tick 内自清，没有一段超过 30 tick；而步长配置下连踩 10 tick 就判 crisis，
  // 于是"孵化脉冲的瞬时形状"换来 ≥100 tick 的强制危机带（minBandTicks）并撤掉了战争。

  it("短于驻留门槛的瞬态陷阱完全不进危机带", () => {
    // 25 tick = 实测最长瞬态。用默认选项（闸开着）跑，分数必须一直贴 0。
    const s = runLiquidityTrap(FRESH, 25);
    expect(s.liquidityTrapTicks).toBe(25);
    expect(s.liquidityScore).toBe(0);
    expect(s.phase).not.toBe("crisis");
    // 同一串在闸关掉的对照下早已爆表 —— 证明红/绿差在闸，不在夹具输入。
    const control = runLiquidityTrap(FRESH, 25, NO_LIQ_GATE);
    expect(control.liquidityScore).toBe(DEFAULT_PHASE_OPTIONS.drainEnterScore);
    expect(control.phase).toBe("crisis");
  });

  it("陷阱一断即重新计数：两段各 40 tick 的陷阱不等于一段 80 tick 的死锁", () => {
    let s = runLiquidityTrap(FRESH, 40);
    expect(s.liquidityTrapTicks).toBe(40);
    // 中间插一 tick 正常物流（hauler 补上了口袋）—— 驻留归零。
    s = evaluateColonyPhase(input({ reserve: 6500, spendableRatio: 0.8, frozenRatio: 0.2 }), s);
    expect(s.liquidityTrapTicks).toBe(0);
    s = runLiquidityTrap(s, 40);
    expect(s.liquidityTrapTicks).toBe(40);
    expect(s.liquidityScore).toBe(0);
    expect(s.phase).not.toBe("crisis");
  });

  it("持续死锁穿过驻留闸后照旧判 crisis（灵敏度没有被关掉）", () => {
    // 门槛 50 tick + 10 tick 打满 = 60 tick；W37S58 那种 0 hauler 的死锁会一直踩着，
    // 60 tick 才进带相对"永久死锁"毫无损失，相对 25 tick 瞬态则是完全免疫。
    const s = runLiquidityTrap(FRESH, DEFAULT_PHASE_OPTIONS.liquidityEnterTicks + 10);
    expect(s.liquidityScore).toBe(DEFAULT_PHASE_OPTIONS.drainEnterScore);
    expect(s.phase).toBe("crisis");
  });

  it("驻留闸只关流动性：偿付赤字与 srcRatio 强制 crisis 通道不受影响", () => {
    // 陷阱 + 真赤字并存：drainScore 照样累加（它有自己的豁免体系，与闸无关）。
    let s = FRESH;
    for (let i = 0; i < 8; i++) {
      s = evaluateColonyPhase(
        input({ reserve: 2000 - i * 100, spendableRatio: 0.05, frozenRatio: 0.95 }),
        s,
      );
    }
    expect(s.drainScore).toBeGreaterThan(0);
    expect(s.liquidityScore).toBe(0); // 8 tick 未过闸
    // srcRatio 通道：与闸无关，按自己的驻留计数照样强制 crisis。
    let t = FRESH;
    for (let i = 0; i < DEFAULT_PHASE_OPTIONS.srcStallEnterTicks + 5; i++) {
      t = evaluateColonyPhase(input({ srcRatio: 0.98, storageDrainRate: -800 }), t);
    }
    expect(t.phase).toBe("crisis");
  });

  it("solvency drain still works independently when liquidity is healthy", () => {
    // 偿付崩溃（reserve 持续下跌）但流动性健康 → 仍由 drainScore 驱动危机。
    const drained = runDrain(FRESH, 2000, -45, 11);
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

// ── 绝对可支付豁免（investmentReserveFloor）──
// 立论：既有的 spendableRatio 豁免会被「花钱的那一 tick」自己打掉 —— 大额孵化正是把口袋
// 抽干的动作，于是「我选择花掉它」必然记成「我生产不出来」。军事动员期因此自造赤字，
// 而 recovery 反过来收缩军事编制 = 动员掐死动员自己。故加一道绝对储备豁免。
//
// 写法上两条硬要求（都被变异检验抓出来过）：
//   1. 豁免线必须显式传给用例，不能读 DEFAULT_PHASE_OPTIONS —— 否则变异该常量时用例里的
//      储备水位跟着同倍缩放，「豁免关闭」也照样全绿（自证式测试）；
//   2. 必须配同序列对照组（豁免关闭时确实入危机），否则只是步数不够造成的假阴。
describe("Phase — 绝对可支付豁免（reserve 高水位下的消费不是危机）", () => {
  const FLOOR = 50_000; // 用例自持的显式参照值，不跟随 CONFIG
  const EXEMPT = opts({ investmentReserveFloor: FLOOR });
  const NO_EXEMPT = opts({ investmentReserveFloor: Number.POSITIVE_INFINITY });
  const START = FLOOR * 8;
  const STEP = -FLOOR * 0.08;
  const N = 24; // 23 步赤字 ×15 = 345 ≫ drainEnterScore(150)

  it("同一串持续下降：豁免开启不入带，豁免关闭入危机（对照组）", () => {
    const withExempt = runDrain(FRESH, START, STEP, N, EXEMPT);
    expect(withExempt.drainScore).toBe(0);
    expect(withExempt.phase).toBe("growth");

    const without = runDrain(FRESH, START, STEP, N, NO_EXEMPT);
    expect(without.drainScore).toBeGreaterThanOrEqual(DEFAULT_PHASE_OPTIONS.drainEnterScore);
    expect(without.phase).toBe("crisis");
  });

  it("储备已在豁免线之下 → 同样的下降照计赤字（豁免只保护高水位）", () => {
    const r = runDrain(FRESH, FLOOR * 0.8, STEP, N, EXEMPT);
    expect(r.drainScore).toBeGreaterThanOrEqual(DEFAULT_PHASE_OPTIONS.drainEnterScore);
    expect(r.phase).toBe("crisis");
  });

  it("豁免线临界：整串都在线上即免，整串都在线下即计", () => {
    // 豁免按**当 tick 的 reserve** 判定，所以这里必须保证整串不跨线 ——
    // 让序列从 50k 起步再大跌会先跌破线，那是正确的计分而不是漏判。
    const above = runDrain(FRESH, FLOOR + 200, -20, 8, EXEMPT);
    expect(above.drainScore).toBe(0);
    const below = runDrain(FRESH, FLOOR - 200, -20, 8, EXEMPT);
    expect(below.drainScore).toBeGreaterThan(0);
  });

  it("流动性陷阱不被高储备豁免（W37S58 通道独立，且穿过驻留闸）", () => {
    let s: PhaseState = FRESH;
    // 驻留闸之后，陷阱要连续成立 liquidityEnterTicks 才开始计分，再 10 次打满 ——
    // 与 srcStall 通道同款写法（步长常量推导，不写死数字）。
    for (let i = 0; i < DEFAULT_PHASE_OPTIONS.liquidityEnterTicks + 10; i++) {
      s = evaluateColonyPhase(
        input({ reserve: FLOOR * 6, spendableRatio: 0.05, frozenRatio: 0.95 }),
        s,
        EXEMPT,
      );
    }
    expect(s.liquidityScore).toBeGreaterThanOrEqual(DEFAULT_PHASE_OPTIONS.drainEnterScore);
    expect(s.drainScore).toBe(0);
    expect(s.phase).toBe("crisis");
  });

  it("srcRatio 采集塌方的强制 crisis 不被高储备豁免（P0-1 通道独立）", () => {
    let s: PhaseState = FRESH;
    for (let i = 0; i < DEFAULT_PHASE_OPTIONS.srcStallEnterTicks + 5; i++) {
      s = evaluateColonyPhase(
        input({ reserve: FLOOR * 6, srcRatio: 0.98, storageDrainRate: -800 }),
        s,
        EXEMPT,
      );
    }
    expect(s.phase).toBe("crisis");
  });
});

/**
 * 绝对破产兜底（bankruptReserveFloor）—— 把"家底见底"从次数计分数里拿出来。
 *
 * 复现的实测缺陷：一场净烧 6.3 万能量的战争（涓流 +20.8/tick 占 67% 的 tick、
 * 脉冲 −88.6/tick 占 33%）在 97% 的 tick 上 drainScore=0、phase 全程 growth。
 * 因此这里的序列刻意做成**对分数不利**的形状：赤字 tick 只占 30%（<50%），
 * 但每步净流水为负 —— 让"分数看不见"成为前提而不是巧合。
 */
describe("Phase — 绝对破产兜底（reserve 水位即判据，不走分数）", () => {
  const BANK = 0.05; // storageRatio 非 undefined 才算"有银行"
  const FLOOR = DEFAULT_PHASE_OPTIONS.bankruptReserveFloor;
  /** 10 步里 3 步大额流出、7 步小额流入：净 −120 E/10 步，赤字 tick 占比 30%。 */
  const SAWTOOTH = [-89, 21, 21, -89, 21, 21, 21, -89, 21, 21];
  // spendableRatio 0.3：低于 drainSpendableFloor(0.5) ⇒ 赤字 tick 真会被判 draining；
  // 高于 liquiditySpendableRatio(0.15) ⇒ 物流通道不参与，本组只测兜底。
  const withBank = (reserve: number): PhaseInput =>
    input({ reserve, storageRatio: BANK, spendableRatio: 0.3 });
  const NO_FLOOR = opts({ bankruptReserveFloor: 0 });
  const START: PhaseState = { phase: "growth", drainScore: 0, liquidityScore: 0 };

  /** 跑一串交替流水，记录是否进带、以及分数峰值（峰值证明"分数看不见"）。 */
  function run(start: number, steps: number, options?: PhaseOptions) {
    let s = START;
    let reserve = start;
    let firstCrisisAt = -1;
    let maxDrain = 0;
    for (let i = 0; i < steps; i++) {
      reserve += SAWTOOTH[i % SAWTOOTH.length]!;
      s = evaluateColonyPhase(withBank(reserve), s, options);
      maxDrain = Math.max(maxDrain, s.drainScore);
      if (firstCrisisAt < 0 && s.phase === "crisis") firstCrisisAt = i;
    }
    return { last: s, reserve, firstCrisisAt, maxDrain };
  }

  it("序列本身：净流水为负而赤字 tick 不过半（缺陷前提成立）", () => {
    const net = SAWTOOTH.reduce((a, b) => a + b, 0);
    const deficitShare = SAWTOOTH.filter(v => v < 0).length / SAWTOOTH.length;
    expect(net).toBeLessThan(0);
    expect(deficitShare).toBeLessThan(0.5);
    // 没有兜底时，200 步（净 −2400 E）里分数峰值连退出迟滞带(30)都到不了。
    const r = run(FLOOR * 4, 200, NO_FLOOR);
    expect(r.maxDrain).toBeLessThan(DEFAULT_PHASE_OPTIONS.drainExitScore);
    expect(r.firstCrisisAt).toBe(-1);
  });

  it("跌穿绝对水位即进 crisis，且此刻分数仍远低于迟滞带", () => {
    // 200 步 × 净 −12 E/步 ≈ −2400 E，从 1.2× 兜底线走到线下。
    const r = run(FLOOR * 1.2, 200);
    expect(r.reserve).toBeLessThan(FLOOR);
    expect(r.firstCrisisAt, "跌穿兜底线却没进危机带 = 兜底没生效").toBeGreaterThanOrEqual(0);
    expect(r.maxDrain, "分数若已能打满，这条就没在复现那个缺陷").toBeLessThan(
      DEFAULT_PHASE_OPTIONS.drainExitScore,
    );
    // 兜底的意义在这里：生存带映射成 ColonyState=recovery ⇒ 战争授权/扩张健康门一起关掉。
    expect(phaseToColonyState("crisis", false)).toBe("recovery");
  });

  it("同一串关掉兜底后全程不进带（对照组：红绿差在兜底，不在夹具输入）", () => {
    const r = run(FLOOR * 1.2, 200, NO_FLOOR);
    expect(r.firstCrisisAt).toBe(-1);
    expect(r.last.phase).not.toBe("crisis");
  });

  it("水位守在兜底线之上时不越权：同样净流水的序列不强制进带", () => {
    const r = run(FLOOR * 10, 100);
    expect(r.firstCrisisAt).toBe(-1);
    expect(r.last.phase).not.toBe("crisis");
  });

  it("没有 storage 的房（RCL1-3）不被绝对线钉住 —— 早期游戏保护", () => {
    let s = START;
    for (let i = 0; i < 30; i++) {
      // storageRatio 缺省 undefined = 无 storage；reserve 只有几百 E 是真实早期水位。
      s = evaluateColonyPhase(input({ reserve: 400 + i, spendableRatio: 0.3 }), s);
    }
    expect(s.phase).not.toBe("crisis");
    expect(s.phase).not.toBe("recovery");
    expect(s.phase).toBe("growth");
  });

  it("欠员优先于破产：既欠员又见底的房标签是 bootstrap（不被 mask 成 crisis）", () => {
    // bootstrapEnterTicks=1：本用例钉的是两条判据的**先后次序**，不是驻留闸（专属用例在下面）。
    const r = evaluateColonyPhase(
      input({
        reserve: 500,
        storageRatio: BANK,
        spendableRatio: 0.3,
        harvesterCount: 1,
        sourceCount: 2,
      }),
      START,
      opts({ bootstrapEnterTicks: 1 }),
    );
    expect(r.phase).toBe("bootstrap");
  });

  it("进场确定、出场仍迟滞：水位回线后必须经完 minBandTicks 驻留才回 growth", () => {
    let s = evaluateColonyPhase(withBank(FLOOR - 100), START); // 跌穿 → 兜底进 crisis
    expect(s.phase).toBe("crisis");
    const phases: ColonyPhase[] = [];
    for (let i = 0; i < DEFAULT_PHASE_OPTIONS.minBandTicks + 5; i++) {
      s = evaluateColonyPhase(withBank(FLOOR * 6), s);
      phases.push(s.phase);
    }
    const backToGrowth = phases.findIndex(p => p === "growth");
    expect(phases[0], "回线第一 tick 就该停在 recovery，不能秒退").toBe("recovery");
    expect(backToGrowth).toBeGreaterThanOrEqual(1);
    // 分数全程为 0（当初就是它看不见），能拖住出场的只有驻留闸 —— 兜底没有拆掉防抖。
    expect(s.drainScore).toBe(0);
    expect(phases.slice(0, backToGrowth).every(p => p === "recovery")).toBe(true);
  });
});

// ─── 修法 A：drainScore 按流量而非次数（#11）────────────────────────
// 旧计分是「赤字 tick +15 / 其余 −40」，与亏多少无关 ⇒ 一间房进不进危机带取决于
// 赤字脉冲怎么排布。实测依据（同一套 5-source 夹具连跑两次，同一份 dist）：
// 一次 crisis+recovery 占 71.6%（而该局总账其实盈余：赤字合计 5519 vs 盈余 7230），
// 一次 0%。判据取决于排布就不是迟滞而是随机。
describe("Phase — drainScore 流量口径（#11-A）", () => {
  /** 按显式 delta 序列喂若干次评估（reserve 从 base 起累加；可从既有状态续算）。 */
  function runDeltas(
    deltas: number[],
    base = 2000,
    options?: PhaseOptions,
    from: PhaseState = FRESH,
  ) {
    let state = evaluateColonyPhase(input({ reserve: base }), from, options);
    for (const d of deltas) {
      base += d;
      state = evaluateColonyPhase(input({ reserve: base }), state, options);
    }
    return state;
  }

  const CAP = DEFAULT_PHASE_OPTIONS.drainStepCap;

  it("同样净亏的能量计同样的分：10×45 与 5×90 都进危机带", () => {
    expect(runDeltas(Array(10).fill(-45)).drainScore).toBeCloseTo(150, 6);
    expect(runDeltas(Array(5).fill(-90)).phase).toBe("crisis");
    // 少一截就不进：360 E 净亏 = 120 分 < 150。
    const partial = runDeltas(Array(4).fill(-90));
    expect(partial.drainScore).toBeCloseTo(120, 6);
    expect(partial.phase).toBe("growth");
  });

  it("零变化 tick 不再主动消分（慢性失血因此可见）", () => {
    const built = runDeltas(Array(6).fill(-45)); // 90 分，reserve 落在 1730
    const held = runDeltas([0, 0, 0, 0, 0], 1730, undefined, built);
    // 旧次数计在这里会 −40×5 → 归零；流量口径下无赤字的 tick 不计分也不消分。
    // 静止消分通道只在「已在危机带内 + 待够 idleDecayTicks」后才启动，
    // 而这里还没进带（90 < 150），所以分数分毫不动 —— 正是本用例要守的语义。
    expect(held.drainScore).toBeCloseTo(90, 6);
    expect(built.drainScore).toBeCloseTo(90, 6);
  });

  it("危机带内完全静止必须有限 tick 内出带（旧实现分数原地冻结、永不退出）", () => {
    let state = runDeltas(Array(10).fill(-45)); // 150 分 → crisis，reserve 落在 1550
    expect(state.phase).toBe("crisis");

    let ticks = 0;
    while (state.phase === "crisis" && ticks < 700) {
      state = evaluateColonyPhase(input({ reserve: 1550 }), state);
      ticks++;
    }
    expect(state.phase).not.toBe("crisis");
    // idleDecayTicks(200) + (150-30)/idleRecoveryStep(0.5) = 440，留余量。
    expect(ticks).toBeGreaterThan(DEFAULT_PHASE_OPTIONS.idleDecayTicks);
    expect(ticks).toBeLessThan(600);
  });

  it("出带前的静止宽限期不能被缩短成秒退（尸房不该反复进出危机带）", () => {
    const idle = DEFAULT_PHASE_OPTIONS.idleDecayTicks;
    let state = runDeltas(Array(10).fill(-45));
    // 宽限期内一分不减：把"进带即退"这种秒退式修法挡在门外。
    for (let i = 0; i < idle; i++) state = evaluateColonyPhase(input({ reserve: 1550 }), state);
    expect(state.drainScore).toBeCloseTo(150, 6);
    // 越过宽限期后按 idleRecoveryStep 慢消（判据是严格大于，故这一步才动）。
    state = evaluateColonyPhase(input({ reserve: 1550 }), state);
    expect(state.drainScore).toBeCloseTo(150 - DEFAULT_PHASE_OPTIONS.idleRecoveryStep, 6);
  });

  it("带内持续真实失血不会被静止通道抵消", () => {
    let state = runDeltas(Array(10).fill(-45));
    let reserve = 1550;
    for (let i = 0; i < 400; i++) {
      reserve -= 45; // 每 tick 净亏 45 E = +15 分/tick，静止消分只有 0.5/tick
      state = evaluateColonyPhase(input({ reserve }), state);
    }
    expect(state.phase).toBe("crisis");
    expect(state.drainScore).toBeCloseTo(150, 6);
  });

  it("每 3 tick 一次的稀疏失血照样攒进危机带（旧口径的盲区）", () => {
    // −30 E / 3 tick = 净 −10 E/tick 的慢性失血：流量计 +10 分/3tick → 45 tick 到 150。
    const pattern = [-30, 0, 0];
    const deltas: number[] = [];
    for (let i = 0; i < 15; i++) deltas.push(...pattern);
    const r = runDeltas(deltas);
    expect(r.drainScore).toBeCloseTo(150, 6);
    expect(r.phase).toBe("crisis");
  });

  it("赤字脉冲大但总账盈余的房不进危机带", () => {
    // 每 3 tick：−100 后两次 +60 ⇒ 净 +20。次数计只看"有没有赤字 tick"，
    // 流量计下盈余侧按 ×recoveryBias 抵得掉。
    const pattern = [-100, 60, 60];
    const deltas: number[] = [];
    for (let i = 0; i < 12; i++) deltas.push(...pattern);
    const r = runDeltas(deltas);
    expect(r.drainScore).toBe(0);
    expect(r.phase).toBe("growth");
  });

  it("单 tick 脉冲被 drainStepCap 封顶：一次巨亏不得独自判危机", () => {
    // 实测战争房有 −22540 的单 tick（大额孵化）。不封顶 → 7513 分，一击定危机。
    const one = runDeltas([-3000]);
    expect(one.drainScore).toBeCloseTo(CAP, 6);
    expect(one.phase).not.toBe("crisis");
    expect(CAP).toBeLessThan(DEFAULT_PHASE_OPTIONS.drainEnterScore);
    // 但持续巨亏仍能进带：3 次即越过 150。
    expect(runDeltas([-3000, -3000, -3000]).phase).toBe("crisis");
  });
});

// ─── bootstrap 驻留闸（#22 R-04 的闪断路径）───────────────────────
// 判据是"瞬时人头数"，而 bootstrap 属经济生存带 —— posture 的危机撤资在它出现的
// 第 1 tick 就把 war 降回 fortify。实测两类段长：闪断 1t / 12t，真替换窗 45t / 98t，
// 所以闸取 20（bootstrapEnterTicks）：吃掉闪断，真欠员只延后 20 tick。
describe("Phase — bootstrap 驻留闸", () => {
  const DWELL = DEFAULT_PHASE_OPTIONS.bootstrapEnterTicks;

  /** 连续 n 次评估，都保持欠员（harvesterCount 1 < 下限 2）。 */
  function runUnderstaffed(n: number, from: PhaseState = FRESH) {
    let state = from;
    for (let i = 0; i < n; i++) {
      state = evaluateColonyPhase(input({ harvesterCount: 1, sourceCount: 2 }), state);
    }
    return state;
  }

  it("闪断一 tick 不标 bootstrap，但计数已经在走", () => {
    const r = runUnderstaffed(1);
    expect(r.phase).toBe("growth"); // 旧行为：这里就是 bootstrap ⇒ 战争当场被撤资
    expect(r.bootstrapTicks).toBe(1);
  });

  it("连续欠员满 20 tick 才标 bootstrap（真实的替换/开局窗口原样保留）", () => {
    expect(runUnderstaffed(DWELL - 1).phase).toBe("growth");
    const sustained = runUnderstaffed(DWELL);
    expect(sustained.phase).toBe("bootstrap");
    expect(sustained.bootstrapTicks).toBe(DWELL);
    // 实测的真实窗口（45t / 98t）远在闸之外 —— 灵敏度没被换掉
    expect(runUnderstaffed(45).phase).toBe("bootstrap");
  });

  it("一断即归零：两段 12 tick 的欠员不得跨间隙累加成 24", () => {
    let state = runUnderstaffed(12);
    expect(state.bootstrapTicks).toBe(12);
    // 替补落地：一 tick 够员，计数必须清零（否则两次闪断就会攒开闸）
    state = evaluateColonyPhase(input({ harvesterCount: 2, sourceCount: 2 }), state);
    expect(state.bootstrapTicks).toBe(0);
    state = runUnderstaffed(12, state);
    expect(state.phase).toBe("growth");
    expect(state.bootstrapTicks).toBe(12);
  });

  it("forceCrisis 的早退路径也必须带走 bootstrapTicks（漏一行 = 每走它就清一次零）", () => {
    // 起点：欠员已踩 19 tick，且 srcRatio 通道正要触发（srcStallTicks 49 → 50）
    let state: PhaseState = {
      phase: "growth",
      prevReserve: 2000,
      drainScore: 0,
      liquidityScore: 0,
      bootstrapTicks: DWELL - 1,
      srcStallTicks: 49,
      storageDrainAccum: 1500,
    };
    const forced = evaluateColonyPhase(
      input({
        harvesterCount: 1,
        sourceCount: 2,
        srcRatio: 1,
        storageRatio: 0.5,
        storageDrainRate: -5,
      }),
      state,
    );
    expect(forced.phase).toBe("crisis"); // forceCrisis 绕过迟滞，优先于 bootstrap
    expect(forced.bootstrapTicks).toBe(DWELL); // 计数必须被带走，不能被这条 return 丢掉

    // 塌方信号消退后：欠员已持续够久 → 标签回到 bootstrap
    state = forced;
    const after = evaluateColonyPhase(
      input({ harvesterCount: 1, sourceCount: 2, srcRatio: 0, storageRatio: 0.5 }),
      state,
    );
    expect(after.bootstrapTicks).toBe(DWELL + 1);
  });
});
