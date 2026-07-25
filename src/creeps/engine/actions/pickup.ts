/**
 * Pickup actions — 拾取地上掉落的资源。
 */
import type { ActionCandidate } from "../action-types";
import { moveToTarget } from "../../movement";
import { actOrMove } from "./helpers";
import { selectDroppedEnergy } from "../../support/targeting";

/**
 * 拾取地上掉落的能量。
 *
 * 掉落能量来源：creep 死亡掉落、harvester 溢出、container 被摧毁残留等。
 * 掉落能量会随时间衰减（每 tick 减少 ceil(amount/1000)），因此应尽快拾取。
 * 目标选择由 selectDroppedEnergy 统一处理（优先身边最大堆，否则走向最近堆）。
 *
 * "未装满则继续拾取"：本动作位于 acquire 候选链，而 updateMode 仅在 free===0 时才切
 * work。因此只要背包未满且快照中还有掉落能量，creep 会逐 tick 继续拾取不同的堆，
 * 直到装满才转入 work。
 */
export function pickupDroppedEnergy(): ActionCandidate<Resource> {
  return {
    name: "pickup:dropped-energy",
    resolve: (ac) => selectDroppedEnergy(ac.creep, ac.snapshot.droppedEnergy),
    execute: (ac, resource) => {
      const result = actOrMove(ac.creep, resource, () => ac.creep.pickup(resource));
      if (result === ERR_FULL) {
        ac.creep.memory.mode = "work";
      }
    },
  };
}

/**
 * 拾取身边的掉落能量（仅 range 内，不离开站桩位）。
 *
 * 专供 upgrader 等站桩角色使用：衰减资源应优先回收，但不能为了捡远处
 * 的掉落能量离开 controller 旁的站桩位。range 默认 2 — 覆盖站桩位
 * 周围一圈，足够捡起 harvester 溢出到 controller container 旁的能量。
 */
export function pickupNearbyDroppedEnergy(range = 2): ActionCandidate<Resource> {
  return {
    name: "pickup:nearby-dropped-energy",
    resolve: (ac) => {
      const nearby = ac.snapshot.droppedEnergy.filter(
        r => ac.creep.pos.getRangeTo(r) <= range,
      );
      return selectDroppedEnergy(ac.creep, nearby);
    },
    execute: (ac, resource) => {
      const result = ac.creep.pickup(resource);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, resource);
      } else if (result === ERR_FULL) {
        ac.creep.memory.mode = "work";
      }
    },
  };
}
