/** Action 共享辅助 — 跨领域复用的 execute 层工具函数。 */
import { moveToTarget } from "../../movement";
import { bumpEnergyCounter } from "../../../kernel/global-cache";

/** P3 能量核算入账字段（动作层可触达的子集；spawn/tower 归系统侧埋点）。 */
export type CountedField = "harvested" | "pickedUp" | "upgraded" | "built" | "repaired";

/** 动作成功后按背包差值入账（实测流量，不依赖引擎常量换算）。 */
function accountFlow(creep: Creep, before: number, result: number, field: CountedField): void {
  if (result !== OK) return;
  const delta = creep.store.getUsedCapacity(RESOURCE_ENERGY) - before;
  if (delta === 0) return;
  // 采集为正增量、升级/建造/维修为负增量，均取绝对值记入各自字段。
  bumpEnergyCounter(creep.memory.home ?? creep.room.name, field, Math.abs(delta));
}

/**
 * 带 L1 核算的动作执行（ENERGY_ACCOUNTING_MODEL §2）：以执行前后背包差值实测
 * 流量。result===OK 且差值非零才入账——ERR_FULL / ERR_NOT_IN_RANGE 天然零账。
 */
export function runCountedAction(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  field: CountedField,
  action: () => number,
  handlers?: ErrorHandlers,
): number {
  const before = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const result = runAction(creep, target, action, handlers);
  accountFlow(creep, before, result, field);
  return result;
}

/** 采集一次并入账（供裸调用点复用）；返回引擎结果码。 */
export function countedHarvest(creep: Creep, source: Source): number {
  const before = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const result = creep.harvest(source);
  accountFlow(creep, before, result, "harvested");
  return result;
}

/** 升级控制器一次并入账；返回引擎结果码。 */
export function countedUpgrade(creep: Creep, controller: StructureController): number {
  const before = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const result = creep.upgradeController(controller);
  accountFlow(creep, before, result, "upgraded");
  return result;
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
