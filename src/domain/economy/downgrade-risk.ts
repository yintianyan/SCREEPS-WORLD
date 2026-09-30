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
 * 把一对「进入/退出」迟滞阈值折进该 RCL 自己的 ticksToDowngrade 值域。
 *
 * 立案依据（线上实测 2026-09-30，W38S56 RCL2）：引擎的降级缓冲表**不是单调的** —
 * `CONTROLLER_DOWNGRADE = {1:20000, 2:10000, 3:20000, 4:40000, …}`，RCL2 的上限只有 10000，
 * 而两处退出线是 15000（controllerDowngradeRisk）与 20000（claimSecure）⇒
 * **RCL2 房间一旦进入就永远出不来**：实测该房 `ttd` 恒等于上限 10000（升级道在跑、缓冲满值），
 * 两个标志却同时恒真。后果不是读数难看，而是 `developmentGate` 对每个非关键发展任务
 * 永久返回 "claim-secure" ⇒ 幼房整条道路建造道停摆（buildQueue 7 条 road 全部 attempts=0）。
 *
 * 规则：退出线高于本级上限时，两条线按 `cap/exit` 等比压缩，退出线取 `cap` 本身
 * （缓冲回到满值即解除）；`cap ≥ exit` 时原样返回 ⇒ RCL1/RCL3+ 的行为逐字不变。
 */
export function downgradeRiskBand(
  levelCapTicks: number | undefined,
  enter: number,
  exit: number,
): { enter: number; exit: number } {
  if (levelCapTicks === undefined || levelCapTicks <= 0 || levelCapTicks >= exit) {
    return { enter, exit };
  }
  const scale = levelCapTicks / exit;
  return { enter: Math.floor(enter * scale), exit: levelCapTicks };
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
