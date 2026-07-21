/**
 * 反应链规划 — 纯函数，无 Game API 依赖。
 *
 * 给定目标产物和当前库存，反向推导完整反应链。
 * 每个 lab 每 tick 产出 5 单位产物（LAB_REACTION_AMOUNT）。
 */
import { REACTIONS, type Compound, type ReactionPlan, type ReactionStep } from "./types";

/** 每个 lab 每 tick 的反应产出量。 */
export const LAB_REACTION_AMOUNT = 5;

/**
 * 反向推导反应链：从目标产物回溯到基础矿物。
 *
 * @param target       目标化合物
 * @param amount       目标数量
 * @param available    当前库存（storage + terminal 中的化合物数量）
 * @returns 有序反应步骤列表（从基础到高级），或 null（配方不存在）
 */
export function planReactionChain(
  target: Compound,
  amount: number,
  available: Readonly<Record<string, number>>,
): ReactionPlan | null {
  const steps: ReactionStep[] = [];
  const needed = new Map<Compound, number>();
  needed.set(target, amount);

  // BFS 反向展开：从目标回溯到基础矿物
  const queue: Compound[] = [target];
  const visited = new Set<Compound>();

  while (queue.length > 0) {
    const compound = queue.shift()!;
    if (visited.has(compound)) continue;
    visited.add(compound);

    const need = needed.get(compound) ?? 0;
    const have = available[compound] ?? 0;
    const deficit = need - have;

    if (deficit <= 0) continue; // 库存足够，无需生产

    const recipe = REACTIONS[compound];
    if (!recipe) continue; // 基础矿物，无法再分解

    const [input1, input2] = recipe;
    // 每个反应产出 5 单位，需要 ceil(deficit / 5) 次反应
    const batches = Math.ceil(deficit / LAB_REACTION_AMOUNT);
    const inputNeeded = batches * LAB_REACTION_AMOUNT;

    // 记录反应步骤
    steps.push({ input1, input2, output: compound, amount: batches * LAB_REACTION_AMOUNT });

    // 递归需求：输入物也需要足够量
    needed.set(input1, (needed.get(input1) ?? 0) + inputNeeded);
    needed.set(input2, (needed.get(input2) ?? 0) + inputNeeded);

    queue.push(input1, input2);
  }

  // 反转：从基础到高级
  steps.reverse();

  return { steps, target, targetAmount: amount };
}

/**
 * 判断当前库存是否满足反应链的下一步输入需求。
 *
 * @param step      当前反应步骤
 * @param available 当前库存
 * @returns 是否可以执行此步骤
 */
export function canExecuteStep(
  step: ReactionStep,
  available: Readonly<Record<string, number>>,
): boolean {
  const need1 = LAB_REACTION_AMOUNT;
  const need2 = LAB_REACTION_AMOUNT;
  return (available[step.input1] ?? 0) >= need1 && (available[step.input2] ?? 0) >= need2;
}

/**
 * 从反应计划中获取下一个可执行的步骤。
 *
 * @param plan      反应计划
 * @param available 当前库存
 * @returns 下一个可执行步骤，或 null（全部完成或原料不足）
 */
export function getNextExecutableStep(
  plan: ReactionPlan,
  available: Readonly<Record<string, number>>,
): ReactionStep | null {
  for (const step of plan.steps) {
    // 检查输出是否已满足
    const outputHave = available[step.output] ?? 0;
    if (outputHave >= step.amount) continue;
    // 检查输入是否足够
    if (canExecuteStep(step, available)) return step;
    // 输入不足 — 需要先生产输入物（但步骤已排序，前面的应该先执行）
    return null;
  }
  return null;
}

/**
 * 计算生产目标产物所需的总 tick 数（单 lab 对）。
 * 用于估算和优先级排序。
 */
export function estimateTicks(plan: ReactionPlan): number {
  return plan.steps.reduce((total, step) => {
    const batches = Math.ceil(step.amount / LAB_REACTION_AMOUNT);
    return total + batches;
  }, 0);
}
