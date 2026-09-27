/**
 * 「控制器降级风险」的唯一判据（单一真相源）。
 *
 * 立案依据（线上实测 2026-09-27，W37S58 RCL8）：这条风险信号原先有**三把尺**同时在读 —
 * room-state 写的迟滞标志（ttd<10000 进入 / ≥15000 退出）、upgrader 角色的原始阈值自判、
 * links 的 controller link 停供判定。执行器与状态机分尺时互锁：ttd 一爬回 10000 上沿，
 * 唯一的 upgrader 就当拍停手 → ttd 永远够不到 15000 的退出阈值 → 标志恒真（线上读数
 * 9,976 / 10,043 / 10,062 / 10,086 贴着 10000 振荡，而 RCL8 上限 200,000 ⇒ 缓冲只有 5%），
 * 并且这房的稳定分被恒真标志永久扣分。
 *
 * 规则：**要"要不要保级"这个语义，就调本函数**，不要再抄一次阈值。
 * 迟滞标志由调用方从房间记忆里读出来传进（domain 层不碰运行时全局，见架构守卫 R1）；
 * 标志缺失（首 tick、无该房记忆、global reset 后 room-state 还没跑）时退回原始进入阈值 —
 * 宁可多干一拍，不可漏掉保级。
 */
import { CONFIG } from "../../config";

/** 只需这两个字段即可判风险；StructureController 天然满足，纯数据夹具也可传入。 */
export interface ControllerRiskView {
  my: boolean;
  ticksToDowngrade: number;
}

/**
 * @param latched 房间记忆里的迟滞标志（`controllerDowngradeRisk`）；undefined = 本 tick 还没写过。
 */
export function resolveControllerDowngradeRisk(
  latched: boolean | undefined,
  controller: ControllerRiskView | undefined,
): boolean {
  if (controller == null || !controller.my) return false;
  return latched ?? controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;
}
