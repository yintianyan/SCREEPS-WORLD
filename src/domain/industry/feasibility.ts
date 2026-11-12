/**
 * 工业目标可达性判定（纯函数）。
 *
 * 背景：私服 `market.orders` 为空，基础矿 U/X 无法采购；当反应链锁定的目标
 * 缺这类原料时，`reactionWait` 会无限增长、每 tick 重规划 + 幽灵采购，而 lab
 * 永远等不到料。这里提供"本地能否闭环"与"何时放弃"两把尺，由 lab-system 注入。
 */
import { CONFIG } from "../../config";
import { planReactionChain } from "./reactions";
import type { Compound } from "./types";

/** 放弃当前目标后的降级顺序：从高价值到基础，逐个检查本地可闭环性。 */
export const LOCAL_FALLBACK_TARGETS: readonly Compound[] = ["XGH2O", "GH2O", "GH", "OH"];

/**
 * 目标是否本地可闭环：反应链第一步的两个 input 必须已在库存，或属于本房可采矿物。
 *
 * 只检查第一步（基础→中间产物）—— 后续步骤依赖前一步产物，第一步可行即说明
 * "不靠市场也能启动"；若库存只有中间产物（如 G），planReactionChain 会直接把
 * 它当作在手库存，第一步就成了更深一层的反应。
 */
export function isReactionLocallyFeasible(
  target: Compound,
  inventory: Readonly<Record<string, number>>,
  ownMineralTypes: readonly string[] = [],
  amount = 300,
): boolean {
  const plan = planReactionChain(target, amount, inventory);
  const first = plan?.steps[0];
  if (!first) return false;
  return [first.input1, first.input2].every(
    input => (inventory[input] ?? 0) > 0 || ownMineralTypes.includes(input),
  );
}

/**
 * 按 `LOCAL_FALLBACK_TARGETS` 顺序选出第一个本地可闭环目标；全部不可行返回 undefined。
 */
export function selectLocallyFeasibleTarget(
  inventory: Readonly<Record<string, number>>,
  ownMineralTypes: readonly string[] = [],
  amount = 300,
): Compound | undefined {
  return LOCAL_FALLBACK_TARGETS.find(t =>
    isReactionLocallyFeasible(t, inventory, ownMineralTypes, amount),
  );
}

/**
 * 是否应放弃当前反应目标：市场不可用且缺料等待已超过 3 个市场周期。
 *
 * 市场可用时永远不放弃 —— 买入只是延迟，不是不可达；等待不足 3 个周期也不放弃，
 * 避免把刚发布、尚在途的采购需求误判成不可达。
 */
export function shouldAbandonReaction(
  reactionWait: number | undefined,
  tick: number,
  marketAvailable: boolean,
  interval: number = CONFIG.market.interval,
): boolean {
  if (marketAvailable || reactionWait === undefined) return false;
  return tick - reactionWait > interval * 3;
}
