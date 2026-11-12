/**
 * 丁的**产线可达性**（不是纯函数算术）。
 *
 * 纯函数侧早已钉死 `brakeNetFlow = netFlow + capexFlow`（upgrade-brake.test.ts），但线上
 * `Memory.kernel.brakeNetFlow` 与 `Memory.kernel.gateNetFlow` 实测逐房逐位相同
 * （2026-11-12，六房全等，而 W6N1 `cx=1`／W7N1 `cx=7` 明明有值）——成因是两个系统调用点
 * 各自手抄了一份 EconomyQuery 字段白名单，`capexFlow` 落地时两处都没跟上。
 * 六个用例全在函数边界，一例也没穿过 `run()` ⇒ "有测试覆盖"再次不等于"产线可达"。
 *
 * 本文件的唯一职责：让**这条桥**有测试。反向实验＝把白名单抄回去，第 1、2 用例应红。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { empireEconomySystem } from "../../../src/systems/empire/empire-economy";
import { brakeGateSum } from "../../../src/domain/economy/accounting";
import { mockRoomStateCtx, mockSnapshot, resetGlobals } from "../../support/factories";

const TICK = 5000;
/** 有资本支出的房：nf=−400 ⇒ −4.0 e/拍，cx=700 ⇒ +7.0 e/拍 ⇒ 刹车进料 +3.0。 */
const WITH_CAPEX = "W8N3";
/** 没测过资本支出的房：cx 缺键 ⇒ 刹车进料退化为净流（与 gate 同值，但不是"等于净流"的假账）。 */
const WITHOUT_CAPEX = "W7N2";

const G = () => globalThis as any;

function snap(roomName: string): ReturnType<typeof mockSnapshot> {
  return mockSnapshot({ roomName, rcl: 7, energyCapacityAvailable: 45000, spawns: [{} as never] });
}

function ctxAt(tick: number) {
  return mockRoomStateCtx([snap(WITH_CAPEX), snap(WITHOUT_CAPEX)], tick);
}

function seed() {
  resetGlobals();
  G().Memory = {
    kernel: {},
    rooms: {
      [WITH_CAPEX]: {
        colonyState: "normal",
        economy: { t: TICK, nf: -400, cx: 700, cr: 100000, rb: 500, dr: 0, ei: 100, ef: 100 },
      },
      [WITHOUT_CAPEX]: {
        colonyState: "normal",
        economy: { t: TICK, nf: 300, cr: 100000, rb: 500, dr: 0, ei: 100, ef: 100 },
      },
    },
  };
}

describe("丁的过桥：empireEconomySystem.run 必须把 capexFlow 带到刹车", () => {
  beforeEach(() => seed());

  it("首趟播种：brake = nf/100 + cx/100，与 gate 相差恰好一个资本支出项", () => {
    empireEconomySystem.run(ctxAt(TICK));
    const k = G().Memory.kernel;
    // gate 只吃净流。
    expect(k.gateNetFlow[WITH_CAPEX]).toBeCloseTo(-4.0, 6);
    expect(k.gateNetFlow[WITHOUT_CAPEX]).toBeCloseTo(3.0, 6);
    // 白名单漏字段时这里会读成 −4.0（与 gate 全等）⇒ 用例立刻红。
    expect(k.brakeNetFlow[WITH_CAPEX]).toBeCloseTo(3.0, 6);
    expect(k.brakeNetFlow[WITH_CAPEX]).not.toBe(k.gateNetFlow[WITH_CAPEX]);
  });

  it("cx 缺键的房：刹车退化为净流（与 gate 同值），不是把「没测到」记成资本支出", () => {
    empireEconomySystem.run(ctxAt(TICK));
    const k = G().Memory.kernel;
    expect(k.brakeNetFlow[WITHOUT_CAPEX]).toBe(k.gateNetFlow[WITHOUT_CAPEX]);
  });

  it("第二趟起差值按 α·cx 递增：递推口径是「同一条递推、只差 capex 一项」", () => {
    empireEconomySystem.run(ctxAt(TICK));
    empireEconomySystem.run(ctxAt(TICK + 100));
    const k = G().Memory.kernel;
    const gap = k.brakeNetFlow[WITH_CAPEX] - k.gateNetFlow[WITH_CAPEX];
    // 播种趟差值 = cx = 7；第二趟差值 = 7 + 0.02·(10 − 7) − …＝仍为「慢尺上的 cx 项」量级。
    expect(gap).toBeGreaterThan(6.0);
    expect(gap).toBeLessThan(7.05);
  });

  it("读者求和口径走刹车列而不是 gate 列（Σbrake 与 Σgate 不再同值）", () => {
    empireEconomySystem.run(ctxAt(TICK));
    const k = G().Memory.kernel;
    expect(brakeGateSum(k.brakeNetFlow, k.gateNetFlow)).toBeCloseTo(6.0, 6); // 3.0 + 3.0
    expect(brakeGateSum(k.brakeNetFlow, k.gateNetFlow)).not.toBeCloseTo(
      brakeGateSum(undefined, k.gateNetFlow),
      1,
    );
  });

  it("闩锁由本趟唯一写者落盘，且 +3.0 的 Σ 不关闸", () => {
    empireEconomySystem.run(ctxAt(TICK));
    const brake = G().Memory.kernel.upgradeBrake;
    expect(brake).toBeDefined();
    expect(brake.closed).toBe(false);
  });
});
