/**
 * 失血闸改造的三条判据：
 *  乙 = 回差 + 最短保持期（`nextUpgradeBrake` / `upgradeBrakeAllows`）
 *  丁 = 刹车输入剔资本支出（`brakeGateSum` / `economy.cx` / `profile.brakeNetFlow`）
 *  戊 = 恢复臂下孵前感知闸（`developmentResumeRoles`）
 *
 * 现场依据（W8N3，2026-11-07）：信号工作点 ±0.3 而阈值是 0 ⇒ 每 1–2 个 100 拍量子翻转；
 * 开闸窗 80–100 拍 < 一个取能-通勤循环（冷孵实测 518 拍才首次交付）⇒ 开窗等于没开；
 * 期间闸全程关死、升级支出 0，而 Σ 仍从 −8.6 深到 −28.4（流出是 20 万的 factory+labs）。
 */
import { describe, expect, it } from "vitest";
import {
  brakeGateSum,
  isUpgradeReserveActive,
  nextUpgradeBrake,
  toMemorySnapshot,
  upgradeBrakeAllows,
  upgradeBrakeFloor,
  type UpgradeBrakeState,
} from "../../../src/domain/economy/accounting";
import { buildRoomEconomicProfile } from "../../../src/domain/economy/room-profile";
import { developmentResumeRoles } from "../../../src/systems/room/recovery-execution-system";
import { mockSnapshot } from "../../support/factories";

// 便于读参数化断言：两侧保持期各 1200 拍（12 个 100 拍量子，与 CONFIG 默认同值）。
const MIN_CLOSED = 1200;
const MIN_OPEN = 1200;

describe("乙：nextUpgradeBrake —— 双向最短保持期（不是幅度回差）", () => {
  it("无历史 ⇒ 按当拍符号播种（换码后既不凭空开放也不凭空关死）", () => {
    expect(nextUpgradeBrake(undefined, -1, 1000, MIN_CLOSED, MIN_OPEN)).toEqual({
      closed: true,
      since: 1000,
    });
    expect(nextUpgradeBrake(undefined, 0, 1000, MIN_CLOSED, MIN_OPEN)).toEqual({
      closed: false,
      since: 1000,
    });
  });

  it("开 → 关：Σ<0 但没开满 ⇒ 不关（保护延迟有界，代价写在 config 注释里）", () => {
    const open: UpgradeBrakeState = { closed: false, since: 1000 };
    expect(nextUpgradeBrake(open, -9, 1000 + MIN_OPEN - 1, MIN_CLOSED, MIN_OPEN).closed).toBe(
      false,
    );
    expect(nextUpgradeBrake(open, -9, 1000 + MIN_OPEN, MIN_CLOSED, MIN_OPEN)).toEqual({
      closed: true,
      since: 2200,
    });
  });

  it("关 → 开：Σ≥0 即达标（无幅度带），但仍要关满 minClosedTicks", () => {
    const closed: UpgradeBrakeState = { closed: true, since: 1000 };
    expect(
      nextUpgradeBrake(closed, 0.05, 1000 + MIN_CLOSED - 100, MIN_CLOSED, MIN_OPEN).closed,
    ).toBe(true);
    expect(nextUpgradeBrake(closed, 0.05, 2200, MIN_CLOSED, MIN_OPEN)).toEqual({
      closed: false,
      since: 2200,
    });
  });

  it("反「永久关死」：健康但盈余只有 +0.4 ⇒ 待够仍要能开（上一版 deadband=2 在这里永不满足）", () => {
    let s: UpgradeBrakeState = { closed: true, since: 0 };
    for (let n = 1; n <= 20; n++) {
      s = nextUpgradeBrake(s, 0.4, n * 100, MIN_CLOSED, MIN_OPEN);
    }
    expect(s.closed).toBe(false);
  });

  it("Σ 在 0 附近来回摆 ⇒ 两侧窗长都 ≥ 保持期，单段开闸不会短于一个取能-通勤循环", () => {
    let s: UpgradeBrakeState = { closed: false, since: 0 };
    let runLen = 0;
    let minOpenRun = Infinity;
    for (let tick = 100; tick <= 12000; tick += 100) {
      // 每趟符号在 −0.3 / +0.3 之间翻（就是现网实测的噪声形状）
      const v = (tick / 100) % 2 === 0 ? 0.3 : -0.3;
      const before = s.closed;
      s = nextUpgradeBrake(s, v, tick, MIN_CLOSED, MIN_OPEN);
      if (s.closed === before) {
        if (!s.closed) runLen += 100;
      } else if (before === false) {
        // 刚从开转关：结算这一段开闸时长
        if (runLen > 0) minOpenRun = Math.min(minOpenRun, runLen);
        runLen = 0;
      }
    }
    expect(minOpenRun).toBeGreaterThanOrEqual(MIN_OPEN);
  });
});

describe("乙：upgradeBrakeAllows —— 三个读者共用同一评价", () => {
  it("缺列 ⇒ 开放（与旧 `?? {}` ⇒ sum 0 ⇒ 不关闸 同语义，fail-open）", () => {
    expect(upgradeBrakeAllows(0, 0, undefined)).toBe(true);
  });
  it("闩锁关着 ⇒ 即使 sum 达标也拒绝（这就是「开窗短于循环」那一族的入口）", () => {
    expect(upgradeBrakeAllows(10, 0, { closed: true, since: 1 })).toBe(false);
  });
  it("floor 仍生效：sum=1 而预留 floor=5 ⇒ 拒绝", () => {
    expect(upgradeBrakeAllows(1, 5, { closed: false, since: 1 })).toBe(false);
    expect(upgradeBrakeAllows(5, 5, { closed: false, since: 1 })).toBe(true);
  });
});

describe("乙/丁：门槛与求和口径", () => {
  it("isUpgradeReserveActive：RCL<7 或无推进态计划 ⇒ false；RCL7+EVALUATED ⇒ true", () => {
    expect(isUpgradeReserveActive(6, [{ st: "EVALUATED" }])).toBe(false);
    expect(isUpgradeReserveActive(7, [{ st: "COMPLETED" }])).toBe(false);
    expect(isUpgradeReserveActive(7, [{ st: "EVALUATED" }])).toBe(true);
    expect(isUpgradeReserveActive(7, undefined)).toBe(false);
  });
  it("upgradeBrakeFloor：生效取预留值，否则 0", () => {
    expect(upgradeBrakeFloor(false, 5)).toBe(0);
    expect(upgradeBrakeFloor(true, 5)).toBe(5);
  });
  it("brakeGateSum：新列整列缺席 ⇒ 回退旧列；某房缺键 ⇒ 按 0 参与（不触发回退）", () => {
    expect(brakeGateSum(undefined, { W8N3: -3 })).toBe(-3);
    expect(brakeGateSum({}, { W8N3: -3 })).toBe(0); // 新列已建立但空 ⇒ 不回退
    expect(brakeGateSum({ W8N3: 1 }, { W8N3: -99, W9W9: -50 })).toBe(1);
  });
  it("brakeGateSum：非有限值不入和（NaN/undefined 不会把刹车永久焊死或永久放开）", () => {
    expect(brakeGateSum({ a: 1, b: Number.NaN, c: undefined as unknown as number }, {})).toBe(1);
  });
});

describe("丁：资本支出落盘与只喂刹车", () => {
  it("toMemorySnapshot：cx 按 ×100 定点写入", () => {
    const snap = toMemorySnapshot(10, 5, 1000, 600, 0, 14, 0.7, undefined, undefined, 2.5);
    expect(snap.cx).toBe(250);
    expect(snap.nf).toBe(500);
  });
  it("cx=0 ⇒ 不写键（与 bk 同规矩），读侧 ?? 0 ⇒「本窗没有资本支出」", () => {
    const snap = toMemorySnapshot(10, 5, 1000, 600, 0, 14, 0.7, undefined, undefined, 0);
    expect("cx" in snap).toBe(false);
  });
  it("profile：brakeNetFlow = netFlow + capex；netFlow 一行不动 ⇒ G4 的口径未被顺手放宽", () => {
    const roomMem = {
      colonyState: "normal",
      economyPressure: 0.2,
      controllerDowngradeRisk: false,
      claimSecure: false,
      storageNearFull: false,
      phase: { phase: "growth", reserve: 400000, harvesterCount: 2, sourceCount: 2, rcl: 7 },
    } as never;
    const base = {
      tick: 1000,
      netFlow: -12,
      contractReserve: 400000,
      riskBuffer: 100,
      drift: 0,
      estimatedIncome: 18,
      efficiency: 0.9,
    };
    const withCapex = buildRoomEconomicProfile(
      mockSnapshot({ rcl: 7 }),
      roomMem,
      { ...base, capexFlow: 20 },
      1000,
    );
    const withoutCapex = buildRoomEconomicProfile(mockSnapshot({ rcl: 7 }), roomMem, base, 1000);

    expect(withCapex.netFlow).toBe(-12); // G4 看的还是这个数
    expect(withCapex.brakeNetFlow).toBe(8); // 刹车看的是"扣掉投资之后"
    expect(withoutCapex.brakeNetFlow).toBe(-12); // 缺 capexFlow ⇒ 退化为 netFlow
  });
});

describe("戊：DEVELOPMENT_RESUME 的角色真值表", () => {
  it("闸关 ⇒ 不孵 upgrader；有工地 ⇒ builder 照孵（不把建造道一起缴械）", () => {
    expect(developmentResumeRoles({ upgraderBrakeOpen: false, hasBuildQueue: true })).toEqual([
      "builder",
    ]);
  });
  it("闸关且无工地 ⇒ 本次不动作（这就是零收益闭环被掐断的那一格）", () => {
    expect(developmentResumeRoles({ upgraderBrakeOpen: false, hasBuildQueue: false })).toEqual([]);
  });
  it("闸开 ⇒ 原行为（upgrader，有工地再加 builder）", () => {
    expect(developmentResumeRoles({ upgraderBrakeOpen: true, hasBuildQueue: false })).toEqual([
      "upgrader",
    ]);
    expect(developmentResumeRoles({ upgraderBrakeOpen: true, hasBuildQueue: true })).toEqual([
      "upgrader",
      "builder",
    ]);
  });
});
