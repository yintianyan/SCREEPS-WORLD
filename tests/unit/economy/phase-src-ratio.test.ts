import { describe, expect, it } from "vitest";
import {
  evaluateColonyPhase,
  DEFAULT_PHASE_OPTIONS,
  type PhaseInput,
  type PhaseOptions,
  type PhaseState,
} from "../../../src/domain/economy/phase";

/**
 * P0-1 srcRatio 累积净流失 crisis 通道 — 单元测试。
 *
 * 背景（病灶 1）：私服快照显示 srcRatio=1.0 持续 31000 tick 时，colonyState
 * 仍判 normal/growth — 双维度（drainScore/liquidityScore）在 spawn 口袋健康时
 * 看不到采集塌方。本测试覆盖 srcRatio + storageDrainAccum 累积净流失双条件
 * 强制 crisis 通道（绕过 drainScore 迟滞）。
 *
 * 修正历史：原方案用单 tick drainRate<-2 持续 50 tick 判定，但实测 storage
 * 流失是稀疏大脉冲（每~235tick一次-800，大部分tick静止），单 tick 差分大部分=0，
 * srcStallTicks 反复归零永远到不了 50。改为累积净流失量（流失累加、回填抵消、
 * srcRatio≤0.9 归零），超阈值(1000E) + 持续 50 tick 触发 crisis。
 */

function input(overrides?: Partial<PhaseInput>): PhaseInput {
  return {
    reserve: 2000,
    spendable: 300,
    spendableRatio: 0.3,
    frozenRatio: 0.0,
    harvesterCount: 2,
    sourceCount: 2,
    rcl: 3,
    srcRatio: 0, // 默认 source 完全空（不触发 srcRatio 通道）
    storageDrainRate: 0, // 默认 storage 无净流出
    ...overrides,
  };
}

function opts(overrides: Partial<PhaseOptions> = {}): PhaseOptions {
  return { ...DEFAULT_PHASE_OPTIONS, ...overrides };
}

const FRESH: PhaseState = {
  phase: "growth",
  prevReserve: undefined,
  drainScore: 0,
  liquidityScore: 0,
};

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

// ── 正常路径 ──
describe("P0-1 srcRatio 累积净流失 crisis 通道 — 正常路径", () => {
  it("srcRatio < 阈值（< 0.9）时不触发，accum 归零，沿用 drainScore 路径", () => {
    const r = evaluateColonyPhase(
      input({ srcRatio: 0.3, storageDrainRate: -5, reserve: 5000 }),
      FRESH,
    );
    expect(r.phase).toBe("growth");
    expect(r.srcStallTicks).toBe(0);
    expect(r.storageDrainAccum).toBe(0);
  });

  it("srcRatio > 0.9 但 storage 未流失（drainRate >= 0）→ accum=0，不触发", () => {
    // source 满载但 storage 在涨 = harvester 正常采空盈余入 storage，非失血
    const r = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: 5, reserve: 5000 }),
      FRESH,
    );
    expect(r.phase).toBe("growth");
    expect(r.srcStallTicks).toBe(0);
    expect(r.storageDrainAccum).toBe(0);
  });

  it("srcRatio>0.9 + 持续流失累积>阈值 + srcStallTicks达50 → 强制 crisis", () => {
    // 用低阈值(100)便于测试：-5/tick，21 tick 达 accum>100，再 49 tick srcStallTicks=50
    const o = opts({ storageDrainAccumThreshold: 100 });
    let state = FRESH;
    // 前 19 tick：accum=5..95 < 100，srcStalled=false
    for (let i = 0; i < 19; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
        state, o,
      );
      expect(state.phase).not.toBe("crisis");
      expect(state.storageDrainAccum).toBe((i + 1) * 5);
      expect(state.srcStallTicks).toBe(0);
    }
    // 第 20 tick：accum=100，不大于阈值（> 才触发），srcStalled=false
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
      state, o,
    );
    expect(state.storageDrainAccum).toBe(100);
    expect(state.srcStallTicks).toBe(0);
    // 第 21 tick：accum=105 > 100，srcStalled=true，srcStallTicks=1
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
      state, o,
    );
    expect(state.srcStallTicks).toBe(1);
    expect(state.phase).not.toBe("crisis");
    // 再 48 tick：srcStallTicks=2..49，不触发
    for (let i = 0; i < 48; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
        state, o,
      );
      expect(state.phase).not.toBe("crisis");
    }
    // 第 70 tick：srcStallTicks=50，forceCrisis
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
      state, o,
    );
    expect(state.phase).toBe("crisis");
    expect(state.srcStallTicks).toBe(50);
  });

  it("强制 crisis 优先级高于 drainScore 路径（即使 spawn 口袋健康也触发）", () => {
    // spendableRatio 高（0.8）→ drainScore 不计赤字；reserve 稳定 → drainScore=0
    // 唯一信号是 srcRatio + storageDrainAccum 累积，必须触发 crisis
    const o = opts({ storageDrainAccumThreshold: 100 });
    let state = FRESH;
    for (let i = 0; i < 70; i++) {
      state = evaluateColonyPhase(
        input({
          srcRatio: 0.95,
          storageDrainRate: -5,
          spendableRatio: 0.8,
          reserve: 5000,
        }),
        state, o,
      );
    }
    expect(state.phase).toBe("crisis");
  });
});

// ── 边界条件 ──
describe("P0-1 累积净流失 crisis 通道 — 边界条件", () => {
  it("srcRatio 恰好等于 0.9（边界）→ 不触发（> 才触发，accum 归零）", () => {
    let state = FRESH;
    for (let i = 0; i < 200; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.9, storageDrainRate: -5, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).not.toBe("crisis");
    expect(state.srcStallTicks).toBe(0);
    expect(state.storageDrainAccum).toBe(0);
  });

  it("间歇大脉冲累积：-800 脉冲 + 静止交替，达阈值后触发（真实场景）", () => {
    // 模拟实测场景：每~100tick 一次 -800 脉冲，其余 tick 静止
    let state = FRESH;
    // 第一次 -800：accum=800 < 1000，srcStalled=false
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    expect(state.storageDrainAccum).toBe(800);
    expect(state.srcStallTicks).toBe(0);
    // 99 tick 静止：accum 不变（0 不累积）
    for (let i = 0; i < 99; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: 0, reserve: 5000 }),
        state,
      );
    }
    expect(state.storageDrainAccum).toBe(800);
    // 第二次 -800：accum=1600 > 1000，srcStalled=true，srcStallTicks=1
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    expect(state.storageDrainAccum).toBe(1600);
    expect(state.srcStallTicks).toBe(1);
    // 再 49 tick 静止：srcStallTicks=2..50，第 50 触发
    for (let i = 0; i < 48; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: 0, reserve: 5000 }),
        state,
      );
      expect(state.phase).not.toBe("crisis");
    }
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: 0, reserve: 5000 }),
      state,
    );
    expect(state.phase).toBe("crisis");
    expect(state.srcStallTicks).toBe(50);
  });

  it("回填抵消：流失后回填，accum 减但 max(0) 不为负", () => {
    let state = FRESH;
    // -800 流失：accum=800
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    expect(state.storageDrainAccum).toBe(800);
    // +1000 回填：accum = max(0, 800-1000) = 0
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: 1000, reserve: 5000 }),
      state,
    );
    expect(state.storageDrainAccum).toBe(0);
    expect(state.srcStallTicks).toBe(0);
  });

  it("srcRatio≤0.9 时 accum 立即归零（采集正常，清除历史累积）", () => {
    let state = FRESH;
    // 先在 srcRatio>0.9 下累积
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    expect(state.storageDrainAccum).toBe(800);
    // srcRatio 降到 0.5：accum 归零（采集恢复正常，历史失血清零）
    state = evaluateColonyPhase(
      input({ srcRatio: 0.5, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    expect(state.storageDrainAccum).toBe(0);
    expect(state.srcStallTicks).toBe(0);
  });

  it("无 storage 时 drainRate=0 → accum 永不累积，不触发", () => {
    let state = FRESH;
    for (let i = 0; i < 200; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: 0, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).not.toBe("crisis");
    expect(state.srcStallTicks).toBe(0);
    expect(state.storageDrainAccum).toBe(0);
  });

  it("srcStallEnterTicks=0 时首次满足条件即触发（用于快速熔断场景）", () => {
    // 先累积到超阈值（tick 2 时 accum=1600>1000，srcStallTicks 已累积到 1）
    let state = FRESH;
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }),
      state,
    );
    // accum=1600 > 1000，srcStallEnterTicks=0 → srcStallTicks 继续累积到 2，2>=0 即触发
    const r = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: 0, reserve: 5000 }),
      state,
      opts({ srcStallEnterTicks: 0 }),
    );
    expect(r.phase).toBe("crisis");
    expect(r.srcStallTicks).toBe(2);
  });
});

// ── 异常情况 ──
describe("P0-1 累积净流失 crisis 通道 — 异常情况", () => {
  it("srcRatio 为 NaN（source 数据缺失）→ 不触发（保守，按 0 处理，accum=0）", () => {
    // NaN > 0.9 = false → srcRatioHigh=false → accum=0
    let state = FRESH;
    for (let i = 0; i < 200; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: NaN, storageDrainRate: -800, reserve: 5000 }),
        state,
      );
    }
    expect(state.phase).not.toBe("crisis");
    expect(state.srcStallTicks).toBe(0);
    expect(state.storageDrainAccum).toBe(0);
  });

  it("已有 drainScore crisis 时 srcRatio 通道不覆盖 bandTicks（叠加而非重置）", () => {
    // 先走 drainScore 路径进入 crisis（reserve 持续下降 + spendableRatio 低）
    let state = runDrain(FRESH, 2000, -100, 11);
    expect(state.phase).toBe("crisis");
    const prevBandTicks = state.bandTicks;
    // 下一 tick srcRatio 满载 + storage 流失，但 accum 未达阈值
    // forceCrisis 不触发，走既有 crisisScore 路径 — bandTicks 应叠加而非重置
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 1000 }),
      state,
    );
    expect(state.phase).toBe("crisis");
    expect(state.bandTicks).toBe(prevBandTicks! + 1);
  });

  it("强制 crisis 恢复时仍走 recovery 迟滞带（不秒退 normal）", () => {
    // 70 tick srcRatio 持续满载 + storage 流失累积 → 强制 crisis
    const o = opts({ storageDrainAccumThreshold: 100 });
    let state = FRESH;
    for (let i = 0; i < 70; i++) {
      state = evaluateColonyPhase(
        input({ srcRatio: 0.95, storageDrainRate: -5, reserve: 5000 }),
        state, o,
      );
    }
    expect(state.phase).toBe("crisis");
    // 下一 tick srcRatio 不再满载 + storage 回填 → accum 归零，forceCrisis=false
    // drainScore 仍是 0（reserve 稳定），crisisScore=0
    // 但 inCrisisBand=true 且 dwellSatisfied=false（bandTicks 不足 100）→ 停在 recovery
    state = evaluateColonyPhase(
      input({ srcRatio: 0.3, storageDrainRate: 5, reserve: 5000 }),
      state, o,
    );
    expect(state.phase).toBe("recovery");
  });
});

// ── P2-3 满仓豁免 ──
describe("P2-3 forceCrisis 满仓豁免", () => {
  it("满仓（storageRatio > 0.8）时 srcRatio 高 + storage 流失 → 不触发 crisis", () => {
    // 用低阈值快速触发：accumThreshold=100, enterTicks=1
    const o = opts({ storageDrainAccumThreshold: 100, srcStallEnterTicks: 1 });
    let state = FRESH;
    // 累积流失到超阈值
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000, storageRatio: 0.9 }),
      state, o,
    );
    // 满仓豁免：storageRatio=0.9 > 0.8 → srcStalled=false → srcStallTicks=0
    // 注意：storageDrainAccum 仍正常累积（800），但 srcStalled=false 不累加 srcStallTicks
    expect(state.srcStallTicks).toBe(0);
    expect(state.storageDrainAccum).toBe(800); // accum 累积不受 storageHigh 影响
    expect(state.phase).not.toBe("crisis");
  });

  it("非满仓（storageRatio <= 0.8）时 srcRatio 高 + storage 流失 → 正常触发 crisis", () => {
    const o = opts({ storageDrainAccumThreshold: 100, srcStallEnterTicks: 1 });
    let state = FRESH;
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000, storageRatio: 0.5 }),
      state, o,
    );
    // 非满仓：storageRatio=0.5 <= 0.8 → srcStalled=true → srcStallTicks=1 >= 1 → forceCrisis
    expect(state.srcStallTicks).toBe(1);
    expect(state.phase).toBe("crisis");
  });

  it("无 storage（storageRatio=undefined）时不豁免（正常触发）", () => {
    const o = opts({ storageDrainAccumThreshold: 100, srcStallEnterTicks: 1 });
    let state = FRESH;
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000 }), // storageRatio undefined
      state, o,
    );
    // 无 storage：storageRatio=undefined → (undefined ?? 0)=0 <= 0.8 → 不豁免
    expect(state.srcStallTicks).toBe(1);
    expect(state.phase).toBe("crisis");
  });

  // P2-3 边界测试（2026-08-03 加固）：
  // phase.ts:247 用 `>` 判断（storageRatio > forceCrisisStorageHigh）。
  // 边界值 0.8 应该不豁免（正常触发 crisis）—— 若未来误改为 `>=`，
  // 满仓边界会误触发 forceCrisis，导致 upgrader 冻结 → link 死锁正反馈。
  it("storageRatio 恰好 0.8（边界）→ 不豁免（> 才豁免），正常触发 crisis", () => {
    const o = opts({ storageDrainAccumThreshold: 100, srcStallEnterTicks: 1 });
    let state = FRESH;
    state = evaluateColonyPhase(
      input({ srcRatio: 0.95, storageDrainRate: -800, reserve: 5000, storageRatio: 0.8 }),
      state, o,
    );
    // storageRatio=0.8 不 > 0.8 → 不豁免 → srcStalled=true → srcStallTicks=1 >= 1 → forceCrisis
    expect(state.srcStallTicks).toBe(1);
    expect(state.phase).toBe("crisis");
  });
});
