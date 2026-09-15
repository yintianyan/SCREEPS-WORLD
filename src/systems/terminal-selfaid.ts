/** Terminal 跨房协作 — nuke 资产抢救与帝国能量/矿物互济（非市场交易通道）。 */
import { CONFIG } from "../config";
import type { TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import { log } from "../kernel/log";
import { planEnergyAid, type RoomEnergyState } from "../domain/economy/energy-logistics";
import { planMineralAid, type RoomMineralState } from "../domain/economy/mineral-logistics";
import {
  pickSalvageRecipient,
  planSalvageShipment,
  type SalvageCandidate,
} from "../domain/defense/nuke-response";
import { collectMineralInventory } from "./terminal-market";

/**
 * nuke 资产抢救：警报房（incomingNukes 非空）的 terminal 库存
 * 逐轮 send 到无警报兄弟房 — power/G/化合物优先，能量留运费地板后兜底全发。
 * 节奏：interval 200 × send 不限量 × 50000 tick 预警窗口 = 足以转空。
 * 无合格接收房（单房帝国/兄弟房全在警报）静默 — 感知事件已记录，无可抢救动作。
 */
export function tryNukeSalvage(ctx: TickContext): void {
  const snapshots = [...ctx.snapshots()];
  const alertRooms = snapshots.filter(s => (s.incomingNukes?.length ?? 0) > 0);
  if (alertRooms.length === 0) return;

  // 接收房候选：一次构建，全体警报房复用。
  const candidates: SalvageCandidate[] = snapshots.map(s => ({
    roomName: s.roomName,
    hasTerminal: s.terminal !== undefined,
    nukeAlert: (s.incomingNukes?.length ?? 0) > 0,
    terminalFree: s.terminal?.store.getFreeCapacity() ?? 0,
  }));

  for (const snapshot of alertRooms) {
    const terminal = snapshot.terminal;
    if (!terminal || terminal.cooldown > 0) continue;
    const recipient = pickSalvageRecipient(candidates, snapshot.roomName);
    if (!recipient) continue;

    // terminal 库存枚举（引擎 store 为资源→数量的普通对象映射）。
    const resources = new Map<string, number>(
      Object.entries(terminal.store as unknown as Record<string, number>),
    );
    const plan = planSalvageShipment(
      resources,
      recipient.roomName,
      CONFIG.market.terminalEnergyReserveFloor,
    );
    if (!plan) continue;

    if (terminal.send(plan.resourceType as ResourceConstant, plan.amount, plan.to) === OK) {
      recordEvent(EventKind.NukeSalvage, snapshot.roomName, [
        salvageResourceCode(plan.resourceType),
        plan.amount,
      ]);
      log.info(
        "terminal",
        `[${Game.time}] nuke-salvage: ${snapshot.roomName} → ${plan.to} ${plan.amount} ${plan.resourceType}`,
      );
    }
  }
}

/** NukeSalvage 事件的资源编码：0=power/1=G/2=浓缩化合物(X*)/3=battery/4=基础矿物/5=能量/6=其他。 */
function salvageResourceCode(resourceType: string): number {
  if (resourceType === RESOURCE_POWER) return 0;
  if (resourceType === RESOURCE_GHODIUM) return 1;
  if (resourceType.startsWith("X")) return 2;
  if (resourceType === RESOURCE_BATTERY) return 3;
  if (["H", "O", "U", "L", "K", "Z"].includes(resourceType)) return 4;
  if (resourceType === RESOURCE_ENERGY) return 5;
  return 6;
}

/**
 * 帝国能量互济 — 每轮至多一笔（决策纯函数，本函数只做采集与执行）。
 * 发送方 terminal 须同时承担 货量 + 能量运费 + 储备地板；
 * calcTransactionCost 不可用（部分私服）时整体跳过。
 */
export function tryEmpireEnergyAid(ctx: TickContext): void {
  if (typeof Game.market?.calcTransactionCost !== "function") return;
  const snapshots = [...ctx.snapshots()];
  if (snapshots.length < 2) return;

  const rooms: RoomEnergyState[] = snapshots.map(s => ({
    roomName: s.roomName,
    storageEnergy: s.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    canSend: s.terminal !== undefined && s.terminal.cooldown === 0,
    canReceive: s.terminal !== undefined,
  }));

  const plan = planEnergyAid(rooms, {
    recipientFloor: CONFIG.energy.aidRecipientFloor,
    donorFloor: CONFIG.energy.aidDonorFloor,
    maxTransfer: CONFIG.energy.aidMaxTransfer,
    minTransfer: CONFIG.energy.aidMinTransfer,
  });
  if (!plan) return;

  const terminal = ctx.getSnapshot(plan.from)?.terminal;
  if (!terminal || terminal.cooldown > 0) return;

  // 发送方 terminal 须同时承担 货量 + 运费 + 储备地板。
  const fee = Game.market.calcTransactionCost(plan.amount, plan.from, plan.to);
  const energyInTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  if (energyInTerminal < plan.amount + fee + CONFIG.market.terminalEnergyReserveFloor) return;

  const result = terminal.send(RESOURCE_ENERGY, plan.amount, plan.to);
  if (result === OK) {
    recordEvent(EventKind.EnergyTransfer, plan.to, [plan.amount]);
    log.info(
      "terminal",
      `[${Game.time}] energy-aid: ${plan.from} → ${plan.to} ${plan.amount} energy (fee=${fee})`,
    );
  }
}

/**
 * 帝国矿物互济 — 每轮至多一笔（决策纯函数 planMineralAid，本函数只做采集与执行）。
 * 与能量互济同款预算口径：发送方 terminal 须同时承担 货量 + 能量运费 + 储备地板。
 */
export function tryEmpireMineralAid(ctx: TickContext): void {
  if (typeof Game.market?.calcTransactionCost !== "function") return;
  const snapshots = [...ctx.snapshots()];
  if (snapshots.length < 2) return;

  const rooms: RoomMineralState[] = snapshots.map(s => {
    const inventory = collectMineralInventory(s);
    const homeMineral = s.minerals[0]?.mineralType;
    return {
      roomName: s.roomName,
      homeMineral,
      homeStock: homeMineral ? (inventory[homeMineral] ?? 0) : 0,
      inventory,
      canSend: s.terminal !== undefined && s.terminal.cooldown === 0,
      canReceive: s.terminal !== undefined,
    };
  });

  const plan = planMineralAid(rooms, {
    donorReserve: CONFIG.market.sellReserve,
    maxTransfer: CONFIG.market.maxDealAmount,
    minTransfer: CONFIG.market.mineralAidMinTransfer,
  });
  if (!plan) return;

  const terminal = ctx.getSnapshot(plan.from)?.terminal;
  if (!terminal || terminal.cooldown > 0) return;

  const fee = Game.market.calcTransactionCost(plan.amount, plan.from, plan.to);
  const energyInTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  if (energyInTerminal < fee + CONFIG.market.terminalEnergyReserveFloor) return;

  const result = terminal.send(plan.mineral as ResourceConstant, plan.amount, plan.to);
  if (result === OK) {
    recordEvent(EventKind.MineralTransfer, plan.to, [plan.amount]);
    log.info(
      "terminal",
      `[${Game.time}] mineral-aid: ${plan.from} → ${plan.to} ${plan.amount} ${plan.mineral} (fee=${fee})`,
    );
  }
}
