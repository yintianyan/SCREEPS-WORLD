/** UOEM Core — Identity Model. */

// ── Branded Types ─────────────────────────────────────────────

/**
 * OperationId — Operation 的唯一生命周期身份。

 * 格式：`op:{target}:{consumeTick}`
 * 不允许从 target 单独推导；不允许从 startedAt 推导；不允许用 decisionId 代替。
 */
export type OperationId = string & { readonly __brand: "OperationId" };

/**
 * DecisionId — DecisionRecord 的唯一标识。

 * 格式：`D-{tick}-{seq}`
 * decisionId ≠ operationId（attribution identity ≠ lifecycle identity）。
 */
export type DecisionId = string & { readonly __brand: "DecisionId" };

/**
 * EventId — UOEM Event 的全局唯一标识。

 * 格式：`E-{tick}-{seq}`
 * 确定性：由 tick + 自增 seq 组成，不依赖 Date.now() / Math.random()。
 */
export type EventId = string & { readonly __brand: "EventId" };

// ── 工厂函数（纯函数，确定性）─────────────────────────────────

/**
 * 铸造 OperationId — 确定性纯函数。

 * @param target 目标房名（business attribute，非 identity）
 * @param consumeTick Operation 消费 Plan 的 tick
 * @returns `op:{target}:{consumeTick}`
 */
export function createOperationId(target: string, consumeTick: number): OperationId {
  return `op:${target}:${consumeTick}` as OperationId;
}

/**
 * 铸造 DecisionId — 确定性纯函数。

 * @param tick DecisionRecord 创建 tick
 * @param seq 自增序号
 * @returns `D-{tick}-{seq}`
 */
export function createDecisionId(tick: number, seq: number): DecisionId {
  return `D-${tick}-${seq}` as DecisionId;
}

/**
 * 铸造 EventId — 确定性纯函数。

 * @param tick 事件发生 tick
 * @param seq 自增序号
 * @returns `E-{tick}-{seq}`
 */
export function createEventId(tick: number, seq: number): EventId {
  return `E-${tick}-${seq}` as EventId;
}

// ── 解析 / 验证函数（纯函数）───────────────────────────────────

/**
 * 解析 OperationId 字符串，验证格式合法性。

 * @returns null 如果格式不合法
 */
export function parseOperationId(raw: string): OperationId | null {
  if (!raw.startsWith("op:")) return null;
  const rest = raw.slice(3);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const tickStr = rest.slice(lastColon + 1);
  if (!/^\d+$/.test(tickStr)) return null;
  return raw as OperationId;
}

/**
 * 验证字符串是否为合法的 OperationId 格式。
 */
export function isValidOperationId(raw: string): raw is OperationId {
  return parseOperationId(raw) !== null;
}

/**
 * 验证字符串是否为合法的 DecisionId 格式。
 */
export function isValidDecisionId(raw: string): raw is DecisionId {
  if (!raw.startsWith("D-")) return false;
  const rest = raw.slice(2);
  const lastDash = rest.lastIndexOf("-");
  if (lastDash <= 0) return false;
  const tickStr = rest.slice(0, lastDash);
  const seqStr = rest.slice(lastDash + 1);
  return /^\d+$/.test(tickStr) && /^\d+$/.test(seqStr);
}
