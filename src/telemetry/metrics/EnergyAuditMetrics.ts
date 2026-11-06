/** 能量守恒审计指标 — 把 ε 结算所需的账本计数与物理池导出到 Prometheus 段（不依赖 Memory 端点）。 */

import { registerMetricGauge } from "../Telemetry";
import { setGauge } from "../MetricRegistry";
import { shouldCollect, markCollected } from "../TickAggregator";
import { globalCache } from "../../kernel/global-cache";

/** 与能量守恒闭式对应的账本列（市场买入/卖出、工业消耗、退款都在内）。 */
const AUDIT_FIELDS = [
  "harvested",
  "pickedUp",
  "spawned",
  "recycledRefund",
  "upgraded",
  "built",
  "repaired",
  "towerSpent",
  "bought",
  "sold",
  "imported",
  "exported",
  "tradeFee",
  "industrialSpend",
  "nukeSpend",
] as const;

const POOL_GENERAL = "screeps_economy_audit_pool_general";
const POOL_INDUSTRIAL = "screeps_economy_audit_pool_industrial";
const POOL_LOOSE = "screeps_economy_audit_pool_loose";
const POOL_CARRY = "screeps_economy_audit_pool_carry";
const POOL_SEEN = "screeps_economy_audit_seen";

let registered = false;

export function registerEnergyAuditMetrics(): void {
  if (registered) return;
  registered = true;
  registerMetricGauge("economy", "audit_tick", "Energy audit sample tick", []);
  registerMetricGauge("economy", "audit_seen", "Room visible in the energy audit sample", ["room"]);
  registerMetricGauge("economy", "audit_pool_general", "Tracked energy pool", ["room"]);
  registerMetricGauge("economy", "audit_pool_industrial", "Industrial energy pool", ["room"]);
  registerMetricGauge("economy", "audit_pool_loose", "Dropped, tombstone and ruin energy", [
    "room",
  ]);
  registerMetricGauge("economy", "audit_pool_carry", "Creep carried energy by home room", ["room"]);
  for (const field of AUDIT_FIELDS) {
    registerMetricGauge("economy", `audit_${field}`, `Energy ledger ${field} since boot`, ["room"]);
  }
}

function auditPoolKind(structureType: string): 0 | 1 | undefined {
  switch (structureType) {
    case STRUCTURE_CONTAINER:
    case STRUCTURE_STORAGE:
    case STRUCTURE_TERMINAL:
    case STRUCTURE_LINK:
    case STRUCTURE_TOWER:
    case STRUCTURE_SPAWN:
    case STRUCTURE_EXTENSION:
      return 0;
    case STRUCTURE_LAB:
    case STRUCTURE_FACTORY:
    case STRUCTURE_POWER_SPAWN:
    case STRUCTURE_NUKER:
      return 1;
    default:
      return undefined;
  }
}

/** 每 10 拍采样：账本累计值 + 可见房的四类物理池；样本时刻写在 audit_tick 上。 */
export function collectEnergyAuditMetrics(): void {
  if (!shouldCollect("energy_audit")) return;
  markCollected("energy_audit");

  try {
    setGauge("screeps_economy_audit_tick", Game.time);

    const ledger = globalCache().energyLedger?.rooms;
    if (ledger) {
      for (const roomName in ledger) {
        const row = ledger[roomName];
        if (!row) continue;
        for (const field of AUDIT_FIELDS) {
          setGauge(`screeps_economy_audit_${field}`, row[field], { room: roomName });
        }
      }
    }

    const seen = new Set<string>();
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      seen.add(roomName);

      let general = 0;
      let industrial = 0;
      for (const structure of room.find(FIND_STRUCTURES)) {
        const store = (structure as { store?: Store<RESOURCE_ENERGY, false> }).store;
        if (!store) continue;
        const amount = store.getUsedCapacity(RESOURCE_ENERGY);
        if (amount <= 0) continue;
        const kind = auditPoolKind(structure.structureType);
        if (kind === 0) general += amount;
        else if (kind === 1) industrial += amount;
      }

      let loose = 0;
      for (const dropped of room.find(FIND_DROPPED_RESOURCES)) {
        if (dropped.resourceType === RESOURCE_ENERGY) loose += dropped.amount;
      }
      for (const tombstone of room.find(FIND_TOMBSTONES)) {
        loose += tombstone.store.getUsedCapacity(RESOURCE_ENERGY);
      }
      for (const ruin of room.find(FIND_RUINS)) {
        loose += ruin.store.getUsedCapacity(RESOURCE_ENERGY);
      }

      setGauge(POOL_GENERAL, general, { room: roomName });
      setGauge(POOL_INDUSTRIAL, industrial, { room: roomName });
      setGauge(POOL_LOOSE, loose, { room: roomName });
    }

    const carry = new Map<string, number>();
    for (const creepName in Game.creeps) {
      const creep = Game.creeps[creepName];
      if (!creep) continue;
      const home = creep.memory?.home;
      if (!home) continue;
      const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY);
      carry.set(home, (carry.get(home) ?? 0) + amount);
    }
    for (const roomName of seen) {
      setGauge(POOL_CARRY, carry.get(roomName) ?? 0, { room: roomName });
    }
    for (const [home, amount] of carry) {
      if (!seen.has(home)) setGauge(POOL_CARRY, amount, { room: home });
    }

    const cache = globalCache() as { __energyAuditSeen?: string[] };
    for (const stale of cache.__energyAuditSeen ?? []) {
      if (!seen.has(stale)) setGauge(POOL_SEEN, 0, { room: stale });
    }
    for (const roomName of seen) setGauge(POOL_SEEN, 1, { room: roomName });
    cache.__energyAuditSeen = [...seen];
  } catch {
    // Telemetry 失败不得影响 AI
  }
}
