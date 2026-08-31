/** Action 共享辅助 — 跨领域复用的 execute 层工具函数。 */
import { moveToTarget } from "../../movement";
import { bumpEnergyCounter } from "../../../kernel/global-cache";

/**
 * P3 能量核算入账字段（intent 计量子集）。
 * harvested / upgraded / built 归房间级跨 tick 差分采样（economy 系统）—
 * 这三类流量用 creep 背包差值或 intent 推算都不可靠：官服引擎资源结算在
 * tick 末 intent 解析，同 tick 的 store 差值恒 0；房间状态差分是唯一实测口径。
 */
export type CountedField = "pickedUp" | "repaired";

/**
 * 带 L1 核算的动作执行：intentAmount 在动作执行**前**求值（动作参数与目标
 * 状态推算意图量），result===OK 才入账 — ERR_FULL / ERR_NOT_IN_RANGE 天然零账。
 * 不可用「执行前后背包差值」计量：官服结算延迟使差值恒 0（mockup 同步结算
 * 会掩盖此差异，测试绿但线上失真）。
 */
export function runCountedAction(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  field: CountedField,
  action: () => number,
  handlers?: ErrorHandlers,
  intentAmount?: () => number,
): number {
  const amount = intentAmount?.();
  const result = runAction(creep, target, action, handlers);
  if (amount !== undefined && result === OK && amount > 0 && Number.isFinite(amount)) {
    bumpEnergyCounter(creep.memory.home ?? creep.room.name, field, amount);
  }
  return result;
}

/** 维修 intent 计量：hits 补量 = min(REPAIR_POWER × WORK 部件数, 目标缺口)。 */
export function repairIntentAmount(creep: Creep, target: Structure): number {
  const work = creep.body.filter(p => p.type === WORK).length;
  return Math.min(REPAIR_POWER * work, target.hitsMax - target.hits);
}

/**
 * 错误码 → 副作用处理器的映射。键为 Screeps 错误码常量，值为在 execute 闭包内
 * 自然捕获 ac/target 的无参闭包。`ERR_NOT_IN_RANGE` 由 runAction 自动处理
 * （触发移动），**不应**在此声明。
 */
export type ErrorHandlers = Partial<Record<number, () => void>>;

/**
 * 执行操作并统一处理错误码（统一 30+ action 的错误处理模式）：
 * ERR_NOT_IN_RANGE（-9）自动 moveToTarget；其他错误查 handlers 表执行对应闭包；
 * 未注册的错误码静默忽略（调用方可用返回值判断）。
 * 消除各 action 裸写 `if (result === ERR_xxx)` 分支的六种不一致模式。
 * @returns Screeps 结果码（供调用方自行判断）
 */
export function runAction(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
  handlers?: ErrorHandlers,
): number {
  const result = action();
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, target);
  } else if (handlers) {
    const handler = handlers[result];
    if (handler) handler();
  }
  return result;
}

/** 对目标执行操作；ERR_NOT_IN_RANGE 时移动。返回操作结果码。
 * @deprecated 使用 `runAction` 替代 — 保留为无 handler 调用点的语义别名。 */
export function actOrMove(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
): number {
  return runAction(creep, target, action);
}
