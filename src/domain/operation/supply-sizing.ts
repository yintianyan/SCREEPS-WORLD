/** 单趟 supply 调拨的容量上限 — 与 carrier 孵化共用同一 body 选择。 */
import { selectBody } from "../../config/bodies";

export function capSupplyToCarrier(requested: number, energyCapacityAvailable: number): number {
  const body = selectBody("carrier", energyCapacityAvailable);
  const carry = body.filter(p => p === CARRY).length * CARRY_CAPACITY;
  return Math.max(0, Math.min(requested, carry));
}
