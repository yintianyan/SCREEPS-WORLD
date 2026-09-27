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
import { resolveControllerDowngradeRisk } from "../../../src/domain/economy/downgrade-risk";
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
