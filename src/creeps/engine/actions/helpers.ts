/** Action 共享辅助 — 跨领域复用的 execute 层工具函数。 */
import { moveToTarget } from "../../movement";
import { recordIntent } from "../../../kernel/telemetry";
import { bumpEnergyCounter, bumpRemoteOpLedger } from "../../../kernel/global-cache";

/**
 * P3 能量核算入账字段（intent 计量子集）。
 * harvested / upgraded / built 归房间级跨 tick 差分采样（economy 系统）—
 * 这三类流量用 creep 背包差值或 intent 推算都不可靠：官服引擎资源结算在
 * tick 末 intent 解析，同 tick 的 store 差值恒 0；房间状态差分是唯一实测口径。
 * imported = 跨房导入（远矿返程交付），由调用方按 creep 是否属远矿编队判定。
 */
export type CountedField = "pickedUp" | "repaired" | "imported";

/**
 * 记录一次**不走 runAction 收口**的引擎意图签发（角色体内的直调路径）。
 *
 * 存在理由：`intents/tick` 是本项目的主成本标量（一次签发 ≈0.2 CPU），但直调路径
 * 绕过收口、不被计数，会让 census 系统性低估。本函数只观察、不改变任何行为 ——
 * 原地包裹而非追加语句，因此对 `if (f() === ERR_x)` 这类既有写法零改写成本。
 */
export function countedIntent<T extends number>(kind: string, invoke: () => T): T {
  const result = invoke();
  recordIntent(kind, result);
  return result;
}

/**
 * 带 L1 核算的动作执行：intentAmount 在动作执行**前**求值（动作参数与目标
 * 状态推算意图量），result===OK 才入账 — ERR_FULL / ERR_NOT_IN_RANGE 天然零账。
 * 不可用「执行前后背包差值」计量：官服结算延迟使差值恒 0（mockup 同步结算
 * 会掩盖此差异，测试绿但线上失真）。
 */
export function runCountedAction(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  field: CountedField | undefined,
  action: () => number,
  handlers?: ErrorHandlers,
  intentAmount?: () => number,
): number {
  const amount = intentAmount?.();
  const result = runAction(creep, target, action, handlers);
  if (
    field !== undefined &&
    amount !== undefined &&
    result === OK &&
    amount > 0 &&
    Number.isFinite(amount)
  ) {
    const home = creep.memory.home ?? creep.room.name;
    bumpEnergyCounter(home, field, amount);
    // 跨房导入同时记入 op 账本：房间计数器只回答「本房收了多少」，
    // op 账本还要回答「这笔收入对应哪条远矿线、成本多少」。
    if (field === "imported") {
      bumpRemoteOpLedger(home, creep.memory.remoteTarget, "delivered", amount);
    }
  }
  return result;
}

/** 维修 intent 计量：能量消耗 = min(REPAIR_POWER × WORK 部件数, 目标缺口) ÷ REPAIR_POWER。
 * 1 energy 修 100 hits/WORK — ledger.repaired 契约是能量口径，与 hits 口径差 100 倍
 * （不一致时 ledgerConsumption/P0P1 速率把 hits 当 energy，消费与净流被高估百倍）。 */
export function repairIntentAmount(creep: Creep, target: Structure): number {
  const work = creep.body.filter(p => p.type === WORK).length;
  return Math.min(REPAIR_POWER * work, target.hitsMax - target.hits) / REPAIR_POWER;
}

/**
 * 错误码 → 副作用处理器的映射。键为 Screeps 错误码常量，值为在 execute 闭包内
 * 自然捕获 ac/target 的无参闭包。`ERR_NOT_IN_RANGE` 由 runAction 自动处理
 * （触发移动），**不应**在此声明。
 */
export type ErrorHandlers = Partial<Record<number, () => void>>;

/**
 * 走 runAction 的动作最大射程：build/repair/upgradeController/dismantle 为 3，
 * harvest/transfer/withdraw/pickup 为 1 —— 距离 >3 对其中任何一种都必然被引擎拒绝。
 */
const MAX_WORK_RANGE = 3;

/**
 * 执行操作并统一处理错误码（统一 30+ action 的错误处理模式）：
 * ERR_NOT_IN_RANGE（-9）自动 moveToTarget；其他错误查 handlers 表执行对应闭包；
 * 未注册的错误码静默忽略（调用方可用返回值判断）。
 * 消除各 action 裸写 `if (result === ERR_xxx)` 分支的六种不一致模式。
 *
 * 射程预判：一次意图首次签发实测 0.15 CPU（`move_B_firstIssue`），一次 getRangeTo
 * 0.0001 CPU —— 相差三个数量级。超出任何动作射程的调用必被引擎拒绝（引擎先做射程检查，
 * 因此 handlers 也不会因其他错误码被触发），而签发被拒意图的 CPU 已经花掉了。
 * 提前返回 ERR_NOT_IN_RANGE 与原行为等价：两条路径都以同样的参数调用 moveToTarget，
 * 只是不再为注定失败的调用买单。
 * @returns Screeps 结果码（供调用方自行判断）
 */
export function runAction(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  action: () => number,
  handlers?: ErrorHandlers,
): number {
  if (creep.pos.getRangeTo(target) > MAX_WORK_RANGE) {
    moveToTarget(creep, target);
    return ERR_NOT_IN_RANGE;
  }
  const result = action();
  recordIntent("action", result);
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, target);
  } else if (handlers) {
    const handler = handlers[result];
    if (handler) handler();
  }
  return result;
}
