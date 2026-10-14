/**
 * 载体绑定的有效性维护（纯函数，零 Game/Memory 引用）。
 *
 * 立案＝roadmap 补329／补331（#181，线上实证：`supply:*` op 恒 `deliveredAmount=0` 直到 deadline）。
 * 现场形状＝op 上挂着一个**解析不到活体**的 `carrierName`：
 *   - `hasCarrierForOp` 的三个或项里，"队名匹配到任意在册 carrier"这一项为真，于是既不补孵也不提前 return；
 *   - 而两段兜底绑定都 gate 在 `!op.carrierName`（`agenda-manager.ts:584/:593`），字符串还在 ⇒ 永不重绑；
 *   - 入账那一段要 `Game.creeps[carrierName]` 存在（`:611-617`），拿不到 ⇒ 永久 no-op。
 * 结果＝线上明明有一只能干活的载体，这条 op 却永远看不见它。
 *
 * 为什么放在 domain 而不是就地写三行：`agendaManagerSystem` 全库**没有任何测试夹具**（tests/ 里零处
 * 调用它），把判定写进 domain 才能被直接钉住——判定本身可测，调用点只是把它接上。
 * ⚠️不要用 `stability.hasMinimumCommitment` 代替本判定：那条政策的 :56 只看 `carrierName` 这个
 *   字符串在不在（不看解析到什么），悬挂名在它那里得到的是"保护、不取消"＝另一个语义
 *   （补330／`plan-stability-policy.test.ts` 第 10 例已把这个反直觉钉成断言）。
 */

import type { OperationContext } from "./agenda-item";

/**
 * 若绑定指向的载体已不在活体集合里，就摘掉这条悬挂引用，返回 true。
 *
 * @param op 被测 operation（就地改写：`carrierName` 是可选字段，delete 即回到"未绑"态）
 * @param liveCarrierNames 当前**可用**的载体名（调用方负责排除还在孵的个体——
 *        与 `hasCarrierForOp` 的 `!spawning` 口径保持一致，否则同趟内会出现"清了又绑回孵化中"的抖动）
 */
export function pruneStaleCarrierBinding(
  op: OperationContext,
  liveCarrierNames: ReadonlySet<string>,
): boolean {
  const bound = op.carrierName;
  if (!bound) return false;
  if (liveCarrierNames.has(bound)) return false;
  delete op.carrierName;
  return true;
}
