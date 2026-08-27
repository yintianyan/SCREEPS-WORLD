/** 反应链规划 — 纯函数（无 Game API 依赖）：从目标产物反向推导完整反应链。 */
import { REACTIONS, type Compound, type ReactionPlan, type ReactionStep } from "./types";

/** 每个 lab 每 tick 的反应产出量。 */
export const LAB_REACTION_AMOUNT = 5;

/**
 * 从目标产物反向回溯到基础矿物，产出有序步骤（基础→高级）；
 * 目标为无配方的基础矿物时 steps 为空。
 */
export function planReactionChain(
  target: Compound,
  amount: number,
  available: Readonly<Record<string, number>>,
): ReactionPlan | null {
  const steps: ReactionStep[] = [];
  const needed = new Map<Compound, number>();
  needed.set(target, amount);

  // BFS 反向展开，从目标回溯到基础矿物
  const queue: Compound[] = [target];
  const visited = new Set<Compound>();

  while (queue.length > 0) {
    const compound = queue.shift()!;
    if (visited.has(compound)) continue;
    visited.add(compound);

    const need = needed.get(compound) ?? 0;
    const have = available[compound] ?? 0;
    const deficit = need - have;

    if (deficit <= 0) continue;

    const recipe = REACTIONS[compound];
    if (!recipe) continue;

    const [input1, input2] = recipe;
    // 每次反应产 5 单位 → 批次 = ceil(deficit / 5)（向上取整，宁多产）
    const batches = Math.ceil(deficit / LAB_REACTION_AMOUNT);
    const inputNeeded = batches * LAB_REACTION_AMOUNT;

    steps.push({ input1, input2, output: compound, amount: batches * LAB_REACTION_AMOUNT });

    needed.set(input1, (needed.get(input1) ?? 0) + inputNeeded);
    needed.set(input2, (needed.get(input2) ?? 0) + inputNeeded);

    queue.push(input1, input2);
  }

  // 反转步骤顺序：从基础到高级
  steps.reverse();

  return { steps, target, targetAmount: amount };
}

/** 库存是否满足单 tick 反应所需（各输入 ≥ 5，非整批 step.amount）。 */
export function canExecuteStep(
  step: ReactionStep,
  available: Readonly<Record<string, number>>,
): boolean {
  const need1 = LAB_REACTION_AMOUNT;
  const need2 = LAB_REACTION_AMOUNT;
  return (available[step.input1] ?? 0) >= need1 && (available[step.input2] ?? 0) >= need2;
}

/** 返回下一个可执行步骤；输出已满足或原料不足时返回 null。 */
export function getNextExecutableStep(
  plan: ReactionPlan,
  available: Readonly<Record<string, number>>,
): ReactionStep | null {
  for (const step of plan.steps) {
    const outputHave = available[step.output] ?? 0;
    if (outputHave >= step.amount) continue;
    if (canExecuteStep(step, available)) return step;
    // 原料不足 → 需先执行更早步骤（步骤已排序）
    return null;
  }
  return null;
}

/** 总生产 tick 估算（单 lab 对；用于优先级排序）。 */
export function estimateTicks(plan: ReactionPlan): number {
  return plan.steps.reduce((total, step) => {
    const batches = Math.ceil(step.amount / LAB_REACTION_AMOUNT);
    return total + batches;
  }, 0);
}

// ─── Lab 相邻校验（反应执行前置约束） ───────────────────────

/** Lab 的位置信息（用于相邻校验，纯数据）。 */
export interface LabPos {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** 反应三元组：一个 output lab + 两个 input lab 的 id。 */
export interface ReactionTrio {
  readonly input1: string;
  readonly input2: string;
  readonly output: string;
}

/** runReaction 要求两个 input lab 均在 output lab 的 range≤2 内。 */
export const REACTION_RANGE = 2;

/** 切比雪夫距离（Screeps 的 getRangeTo 语义）。 */
function chebyshev(a: LabPos, b: LabPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 挑选满足 runReaction 相邻约束（两个 input 均在 output 的 range≤2 内）的三元组。
 * RCL7-8 的 lab 分散布置时任意取 3 个可能永远无法反应 — 逐 output 扫描找两个
 * 邻近 input；凑不齐则返回 undefined。
 */
export function selectReactionTrio(labs: readonly LabPos[]): ReactionTrio | undefined {
  for (const output of labs) {
    const inputs = labs.filter(l => l.id !== output.id && chebyshev(l, output) <= REACTION_RANGE);
    if (inputs.length >= 2) {
      return { output: output.id, input1: inputs[0]!.id, input2: inputs[1]!.id };
    }
  }
  return undefined;
}

/**
 * 贪心选出多个互不相交的三元组（每个 lab 最多被一个三元组占用）。
 * RCL8 有 10 个 lab — 单三元组只利用 3 个（产能 5/tick），剩余 7 个 idle。
 * 多三元组可并行执行同一反应步骤，产能成倍提升（3 组 = 15/tick）。

 * 策略：按 output 候选的可用 input 数降序排列（input 多的 output 优先分配），
 * 贪心锁定后从可用池移除已分配 lab，继续选下一组。
 */
export function selectReactionTrios(labs: readonly LabPos[]): ReactionTrio[] {
  if (labs.length < 3) return [];
  const used = new Set<string>();
  const trios: ReactionTrio[] = [];

  // 预计算每个 lab 周围的可用邻居。
  const neighbors = new Map<string, LabPos[]>();
  for (const lab of labs) {
    neighbors.set(lab.id, labs.filter(
      l => l.id !== lab.id && chebyshev(l, lab) <= REACTION_RANGE,
    ));
  }

  // 按「可用 input 数降序」排列 output 候选（邻居多的 output 优先锁定，
  // 避免被邻居少的 output 先占走共享 lab 导致总组数减少）。
  const outputCandidates = [...labs].sort(
    (a, b) => (neighbors.get(b.id)!.length) - (neighbors.get(a.id)!.length),
  );

  for (const output of outputCandidates) {
    if (used.has(output.id)) continue;
    const available = neighbors.get(output.id)!.filter(l => !used.has(l.id));
    if (available.length < 2) continue;
    trios.push({
      output: output.id,
      input1: available[0]!.id,
      input2: available[1]!.id,
    });
    used.add(output.id);
    used.add(available[0]!.id);
    used.add(available[1]!.id);
  }

  return trios;
}
