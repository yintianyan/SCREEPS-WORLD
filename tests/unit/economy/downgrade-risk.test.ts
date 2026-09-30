/**
 * resolveControllerDowngradeRisk — 「要不要保级」的单一真相源（纯函数）。
 *
 * 立案依据（线上实测 2026-09-27，W37S58 RCL8）：这条信号曾同时存在三把尺（room-state 的
 * 迟滞标志 10k 进 / 15k 出、upgrader 角色自判 ttd<10k、link 供能自判 ttd<10k）。
 * 执行器与状态机分尺时互锁：ttd 一爬回 10000 上沿唯一 upgrader 就当拍停手 → 标志永远
 * 够不到 15000 的退出阈值 → 线上读数 9,976 / 10,043 / 10,062 / 10,086 贴着 10000 振荡，
 * 缓冲只有 RCL8 上限（200,000）的 5%，且该房稳定分被恒真标志永久扣分。
 *
 * 迟滞标志由调用方从房间记忆读出后传入（domain 不碰运行时全局 —— 架构守卫 R1 会拦）。
 */
import { describe, expect, it } from "vitest";
import {
  resolveControllerDowngradeRisk,
  downgradeRiskBand,
} from "../../../src/domain/economy/downgrade-risk";
import { CONFIG } from "../../../src/config";

const ctrl = (ttd: number, my = true) => ({ my, ticksToDowngrade: ttd });

describe("resolveControllerDowngradeRisk — 迟滞标志优先，缺失才退回原始阈值", () => {
  it("带内：标志已置位 → 判有风险（即使 ttd 早已越过进入阈值）", () => {
    expect(resolveControllerDowngradeRisk(true, ctrl(12000))).toBe(true);
  });

  it("带内反向：标志已清零 → 判无风险（ttd 低于原始阈值也认标志，不再抄第二把尺）", () => {
    expect(resolveControllerDowngradeRisk(false, ctrl(9000))).toBe(false);
  });

  it("标志缺失（首 tick / 无该房记忆）→ 退回原始进入阈值，宁可多干一拍不漏保级", () => {
    expect(resolveControllerDowngradeRisk(undefined, ctrl(9999))).toBe(true);
    expect(
      resolveControllerDowngradeRisk(undefined, ctrl(CONFIG.economy.controllerDowngradeThreshold)),
    ).toBe(false);
  });

  it("无控制器 / 非我方 → 无风险（不替别人的控制器保级）", () => {
    expect(resolveControllerDowngradeRisk(true, undefined)).toBe(false);
    expect(resolveControllerDowngradeRisk(true, ctrl(5000, false))).toBe(false);
  });
});

/**
 * downgradeRiskBand — 迟滞带必须落在本级 ticksToDowngrade 的值域内。
 *
 * 立案依据（线上实测 2026-09-30 07:4x，W38S56 RCL2）：引擎表 CONTROLLER_DOWNGRADE
 * = {1:20000, 2:10000, 3:20000, 4:40000, 5:80000, 6:120000, 7:150000, 8:200000}
 * —— **RCL2 的上限（10000）比 RCL1/RCL3（20000）还低**，而退出线写死 15000（risk）/ 20000
 * （claimSecure）⇒ 退出条件按构造不可达：现场读数 `ttd=10000`（缓冲满值、升级道在跑）
 * 而 `controllerDowngradeRisk=true`、`claimSecure=true` 同时恒真，后果是 developmentGate
 * 对该房每条 road 永久返回 "claim-secure"（buildQueue 7 条 road 全部 attempts=0、road=0）。
 */
describe("downgradeRiskBand — 退出线高于本级上限时按 cap/exit 等比折带", () => {
  it("RCL2（cap 10000 < exit 15000）：risk 对折带 → 进入 6666 / 退出 10000（可达）", () => {
    expect(
      downgradeRiskBand(
        10000,
        CONFIG.economy.controllerDowngradeThreshold,
        CONFIG.economy.controllerDowngradeExitThreshold,
      ),
    ).toEqual({ enter: 6666, exit: 10000 });
  });

  it("RCL2：claimSecure 对（15000/20000）→ 进入 7500 / 退出 10000（缓冲回到满值即解除）", () => {
    expect(
      downgradeRiskBand(
        10000,
        CONFIG.economy.claimSecureEnterTtd,
        CONFIG.economy.claimSecureExitTtd,
      ),
    ).toEqual({ enter: 7500, exit: 10000 });
  });

  it("cap ≥ exit 时逐字不变 ⇒ RCL1/RCL3+ 的行为一个都没动", () => {
    expect(downgradeRiskBand(20000, 15000, 20000)).toEqual({ enter: 15000, exit: 20000 });
    expect(downgradeRiskBand(200000, 10000, 15000)).toEqual({ enter: 10000, exit: 15000 });
  });

  it("cap 缺失（未知等级 / 常量未注入）→ 保守退回原始阈值，不放宽护栏", () => {
    expect(downgradeRiskBand(undefined, 15000, 20000)).toEqual({ enter: 15000, exit: 20000 });
    expect(downgradeRiskBand(0, 15000, 20000)).toEqual({ enter: 15000, exit: 20000 });
  });

  it("不变式：折带后 enter < exit ≤ cap（否则又是一个不可达的退出线）", () => {
    for (const cap of [10000, 20000, 40000, 200000]) {
      for (const [enter, exit] of [
        [10000, 15000],
        [15000, 20000],
      ] as const) {
        const band = downgradeRiskBand(cap, enter, exit);
        expect(band.enter).toBeLessThan(band.exit);
        expect(band.exit).toBeLessThanOrEqual(cap);
      }
    }
  });
});
