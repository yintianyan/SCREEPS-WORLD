/**
 * Cargo Loss — A4.3 Phase 4：货物损失计算。
 *
 * 合同锚点：A4.3 Architecture Audit §2.1 #8（无 Hauler Death Cargo Recovery）、
 * §10 #21。
 *
 * 设计意图：
 *   Hauler 死亡后 cargo 凭空消失。Cargo Loss 将死亡时携带的资源计入
 *   Transport Accounting，使资源账本平衡。
 *
 *   与 flow-accounting.ts（A4.1）的关系：
 *   - flow-accounting 追踪远矿的 Produced/Transported/Delivered/Lost
 *   - cargo-loss 追踪所有运输的 cargo loss（含房内/跨房/远矿）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { ResourceType } from "../operation/agenda-item";
import type { TransportAccounting } from "./transport-accounting";
import { recordLost } from "./transport-accounting";

// ─── Cargo Loss 事件 ──────────────────────────────────────

/**
 * Cargo Loss 事件。
 */
export interface CargoLossEvent {
  /** 死亡的 creep 名称。 */
  creepName: string;
  /** 关联的 Assignment ID（如有）。 */
  assignmentId?: string;
  /** 资源类型。 */
  resourceType: ResourceType;
  /** cargo 数量。 */
  cargoAmount: number;
  /** 死亡房间。 */
  deathRoom: string;
  /** 死亡位置。 */
  deathPos: { x: number; y: number };
  /** 死亡 tick。 */
  tick: number;
  /** 是否可回收（掉落为 tombstone）。 */
  recoverable: boolean;
}

/**
 * Cargo Loss 记录结果。
 */
export interface CargoLossResult {
  /** 更新后的 Transport Accounting。 */
  accounting: TransportAccounting;
  /** 损失量。 */
  lossAmount: number;
  /** 是否已记录。 */
  recorded: boolean;
  /** 消息。 */
  message: string;
}

// ─── 核心算法 ──────────────────────────────────────────────

/**
 * 记录 Cargo Loss。
 *
 * 当 creep 死亡时调用，将 cargo 计入 Transport Accounting。
 * 如果 cargo 可回收（tombstone），标记为可回收但仍然计入 loss
 * （tombstone 可能被其他 creep 拾取，但不保证）。
 *
 * 纯函数。
 */
export function recordCargoLoss(
  acc: TransportAccounting,
  loss: CargoLossEvent,
): CargoLossResult {
  const lossAmount = Math.max(0, loss.cargoAmount);

  if (lossAmount <= 0) {
    return {
      accounting: acc,
      lossAmount: 0,
      recorded: false,
      message: `creep ${loss.creepName} had no cargo`,
    };
  }

  const accounting = recordLost(acc, lossAmount);
  const recoverableMsg = loss.recoverable ? " (recoverable from tombstone)" : "";

  return {
    accounting,
    lossAmount,
    recorded: true,
    message: `creep ${loss.creepName} died with ${lossAmount} ${loss.resourceType} in ${loss.deathRoom}${recoverableMsg}`,
  };
}

/**
 * 计算多个 Cargo Loss 事件的总损失量。
 * 纯函数。
 */
export function totalCargoLoss(events: readonly CargoLossEvent[]): number {
  let total = 0;
  for (const e of events) {
    total += Math.max(0, e.cargoAmount);
  }
  return total;
}

/**
 * 按资源类型分组计算损失。
 * 纯函数。
 */
export function cargoLossByResource(
  events: readonly CargoLossEvent[],
): Map<ResourceType, number> {
  const byResource = new Map<ResourceType, number>();
  for (const e of events) {
    const current = byResource.get(e.resourceType) ?? 0;
    byResource.set(e.resourceType, current + Math.max(0, e.cargoAmount));
  }
  return byResource;
}

/**
 * 按房间分组计算损失。
 * 纯函数。
 */
export function cargoLossByRoom(
  events: readonly CargoLossEvent[],
): Map<string, number> {
  const byRoom = new Map<string, number>();
  for (const e of events) {
    const current = byRoom.get(e.deathRoom) ?? 0;
    byRoom.set(e.deathRoom, current + Math.max(0, e.cargoAmount));
  }
  return byRoom;
}

/**
 * 计算可回收的损失量。
 * 纯函数。
 */
export function recoverableLoss(events: readonly CargoLossEvent[]): number {
  let total = 0;
  for (const e of events) {
    if (e.recoverable) {
      total += Math.max(0, e.cargoAmount);
    }
  }
  return total;
}
