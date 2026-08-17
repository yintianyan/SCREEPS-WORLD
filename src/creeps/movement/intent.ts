/**
 * 移动意图账本 — Traffic Manager 的登记入口。
 * 开关开启：movement 层所有移动出口把「本 tick 想走哪一格」登记到 per-tick 账本，
 * tick 末 traffic-manager 后置系统按房集中解算后统一签发 creep.move。
 * 开关关闭：registerMove 直通 creep.move + recordTraffic — 与旧行为逐字节等价，唯一的回滚通道。
 * 账本存 globalCache 并带 tick 戳，跨 tick 自动失效（global reset 安全）。
 */

import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { packPos, recordTraffic } from "./traffic";
import { DIR_DELTA } from "./stuck-recovery";

/** 账本条目：意图（想去的格）与锚定（声明不动、拒绝被推挤）。 */
export interface IntentLedger {
  tick: number;
  /** creep 名 → 意图。同 creep 后写覆盖先写（正常管线每 tick 至多一条）。 */
  intents: Map<string, { from: number; to: number; priority: number; roomName: string }>;
  /** creep 名 → 锚定优先级。仅对无移动意图的 creep 生效（意图优先于锚）。 */
  anchors: Map<string, number>;
}

/** Traffic Manager 是否启用。 */
export function trafficEnabled(): boolean {
  return CONFIG.movement.trafficManager;
}

/** 取本 tick 账本（惰性按 tick 重建）。 */
export function getIntentLedger(): IntentLedger {
  const g = globalCache();
  if (!g.__moveIntents || g.__moveIntents.tick !== Game.time) {
    g.__moveIntents = { tick: Game.time, intents: new Map(), anchors: new Map() };
  }
  return g.__moveIntents;
}

/**
 * 按 creep 当前 FSM 模式推导移动优先级。
 * flee 逃命 > work 携能交付 > acquire 取能 > 其余（通勤/未知模式）。
 * v33-R12 卡位升级：连续 stuck（≥ stuckThreshold）时优先级临时抬到
 * stuckEscalation — 高于 anchorStation（60）低于 anchorMiner（90）：
 * 锁死移动方有权把占住目标格的站桩 creep 推到相邻格（线上实证 W36S58 —
 * 采集者目标格被锚定 reserver 占据、同档不推 → 意图逐 tick 被拒永久锁死）；
 * 站桩矿工（anchorMiner）永不被挤，flee 仍最高。
 */
export function movePriorityFor(creep: Creep): number {
  const p = CONFIG.movement.trafficPriority;
  const base = (() => {
    switch (creep.memory.mode) {
      case "flee": return p.flee;
      case "work": return p.work;
      case "acquire": return p.acquire;
      default: return p.commute;
    }
  })();
  const stuck = creep.memory.stuckTicks ?? 0;
  if (stuck >= CONFIG.kernel.stuckThreshold && base < p.stuckEscalation) {
    return p.stuckEscalation;
  }
  return base;
}

/**
 * 登记单步移动意图（Traffic Manager 的唯一移动出口）。
 * 开关关闭：直通 creep.move(dir) + recordTraffic（旧行为）。
 * 开关开启：疲劳中返 ERR_TIRED 不入账（引擎语义对齐）；目标格越界返 ERR_INVALID_ARGS；
 * 否则登记意图返 OK — 「登记成功」不保证最终移动（可能在解算中败给更高优意图）。
 */
export function registerMove(creep: Creep, dir: DirectionConstant, priority: number): ScreepsReturnCode {
  if (!trafficEnabled()) {
    const result = creep.move(dir);
    if (result === OK || result === ERR_TIRED) recordTraffic(creep);
    return result;
  }
  if (creep.fatigue > 0) return ERR_TIRED;
  const delta = DIR_DELTA[dir];
  if (!delta) return ERR_INVALID_ARGS;
  const nx = creep.pos.x + delta[0];
  const ny = creep.pos.y + delta[1];
  if (nx < 0 || nx > 49 || ny < 0 || ny > 49) return ERR_INVALID_ARGS;
  const ledger = getIntentLedger();
  ledger.intents.set(creep.name, {
    from: packPos(creep.pos),
    to: nx * 50 + ny,
    priority,
    roomName: creep.room.name,
  });
  return OK;
}

/**
 * 登记锚定声明 — creep 本 tick 原地工作，拒绝被低优先级移动方推挤。
 * 典型：站桩矿工（让出矿位 = 吞吐崩塌）、贴 lab 等 boost、站桩 upgrader。
 * 同 tick 又登记移动意图时解算器以意图为准（锚自动失效）。开关关闭时为 no-op。
 */
export function registerAnchor(creep: Creep, priority: number): void {
  if (!trafficEnabled()) return;
  const ledger = getIntentLedger();
  const existing = ledger.anchors.get(creep.name);
  if (existing === undefined || priority > existing) {
    ledger.anchors.set(creep.name, priority);
  }
}

/**
 * 从缓存路径提取下一步方向（moveByPath 出口的意图化替身）。
 * creep 在路径上 → 走向下一格；不在路径上但紧邻路径起点 → 走向起点（上路）；
 * 否则返回 undefined（等价 ERR_NOT_FOUND，调用方走缓存失效/重算路径）。
 */
export function nextDirFromPath(creep: Creep, path: readonly RoomPosition[]): DirectionConstant | undefined {
  if (path.length === 0) return undefined;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.roomName !== creep.room.name) continue;
    if (p.x === creep.pos.x && p.y === creep.pos.y) {
      const nextPos = path[i + 1];
      if (!nextPos || nextPos.roomName !== creep.room.name) return undefined; // 路径终点/跨房断点。
      return creep.pos.getDirectionTo(nextPos.x, nextPos.y) as DirectionConstant;
    }
  }
  const first = path[0]!;
  if (
    first.roomName === creep.room.name &&
    Math.max(Math.abs(first.x - creep.pos.x), Math.abs(first.y - creep.pos.y)) === 1
  ) {
    return creep.pos.getDirectionTo(first.x, first.y) as DirectionConstant;
  }
  return undefined;
}
