/** Economy 系统 — 能量收支核算（模块 1.5，SYSTEM_BOUNDARIES §1.5 合同）。 */
import type { Priority, RoomSnapshot, System, TickContext } from "../kernel/contracts";
import { globalCache, bumpEnergyCounter, type RoomEnergyCounters } from "../kernel/global-cache";
import { EventKind, recordEvent } from "../kernel/event-log";
import {
  INITIAL_EFFICIENCY_FACTOR,
  emptyLedger,
  emptyPools,
  rollupWindow,
  isDriftExcessive,
  updateNetFlowEma,
  updateEfficiencyFactor,
  riskBufferTicks,
  estimateIncome,
  contractReserveOf,
  toMemorySnapshot,
  diffRoomFlows,
  type EnergyLedger,
  type EnergyPools,
  type RoomFlowSample,
} from "../domain/economy/accounting";
import { CONFIG } from "../config";

/** RoomEnergyCounters（kernel 镜像结构）→ EnergyLedger（domain 权威结构）。结构一致，直接换型。 */
function toLedger(c: RoomEnergyCounters | undefined): EnergyLedger {
  return c ?? emptyLedger();
}

/** 单房 heap 派生态（窗口基线 + 平滑指标）。 */
interface RoomEconState {
  /** 上次窗口边界 tick；undefined=尚无基线（下一窗只播种不结算）。 */
  lastTick?: number;
  lastLedger: EnergyLedger;
  lastPools: EnergyPools;
  netFlowEma?: number;
  effFactor?: number;
  /** 连续超容差窗数（≥2 触发 AccountingDrift 事件——先修核算再发展）。 */
  driftStreak: number;
}

/** heap 派生态（模块级；global reset 随堆消亡，由 Memory 快照恢复平滑值）。 */
const econRooms = new Map<string, RoomEconState>();

/** 每房流采样基线（同上 heap 态；失去视野后残留基线无消费方，重见即差分）。 */
const flowSamples = new Map<string, RoomFlowSample>();

/**
 * 跨 tick 实测采样 — 每个有视野的运营房每 tick 执行（economy interval=1）。
 * harvested / upgraded / built 的唯一可靠口径是房间状态差分：creep 侧 intent
 * 延迟结算（官服 store 同 tick 差值恒 0），room 级差分跨过 tick 边界恰好
 * 覆盖一整个结算窗。预算紧张导致本系统被跳过的 tick 由下次差分自动补账。
 *
 * owned 房复用 ctx 快照预构建的 sources / myConstructionSites，避免重复 room.find；
 * 远矿目标房无快照（非 owned），仍用 room.find 直查。
 */
function sampleRoomFlows(ctx: TickContext): void {
  // 采样范围：owned 房 + 远矿目标（外来房的 source 由别人采，不属本帝国收支）。
  // remoteTargetRooms 由 Kernel.buildSnapshots 预构建，避免本系统每 tick 全量扫描 Memory.rooms。
  const remoteTargets = globalCache().remoteTargetRooms;
  for (const room of Object.values(Game.rooms)) {
    const owned = room.controller?.my === true;
    if (!owned && !(remoteTargets?.has(room.name))) continue;

    // owned 房优先用快照（kernel 已预构建 sources + myConstructionSites），
    // 避免对自有房重复 room.find；远矿房无快照，仍用 room.find 直查。
    const snap = owned ? ctx.getSnapshot(room.name) : undefined;
    const sources = snap?.sources ?? room.find(FIND_SOURCES);

    const cur: RoomFlowSample = {
      sources: sources.reduce((sum, s) => sum + s.energy, 0),
      progress: owned ? (room.controller?.progress ?? 0) : 0,
      sites: {},
    };
    const sites = snap?.myConstructionSites ?? room.find(FIND_MY_CONSTRUCTION_SITES);
    for (const site of sites) {
      cur.sites[site.id] = [site.progress, site.progressTotal];
    }

    const prev = flowSamples.get(room.name);
    if (prev) {
      const flows = diffRoomFlows(prev, cur);
      if (flows.harvested > 0) bumpEnergyCounter(room.name, "harvested", flows.harvested);
      if (flows.upgraded > 0) bumpEnergyCounter(room.name, "upgraded", flows.upgraded);
      if (flows.built > 0) bumpEnergyCounter(room.name, "built", flows.built);
    }
    flowSamples.set(room.name, cur);
  }
}

function stateFor(roomName: string): RoomEconState {
  let st = econRooms.get(roomName);
  if (!st) {
    st = { lastLedger: emptyLedger(), lastPools: emptyPools(), driftStreak: 0 };
    econRooms.set(roomName, st);
  }
  return st;
}

/** 房间名错峰散列（稳定、零成本）。 */
function roomHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 从快照组装池划分（ENERGY_ACCOUNTING_MODEL §3 口径）。 */
function collectPools(s: RoomSnapshot): EnergyPools {
  let containers = 0;
  for (const c of s.containers) containers += c.store.getUsedCapacity(RESOURCE_ENERGY);
  let links = 0;
  for (const l of s.links) links += l.store.getUsedCapacity(RESOURCE_ENERGY);
  let loose = 0;
  for (const d of s.droppedEnergy) loose += d.amount;
  for (const t of s.tombstones) loose += t.store.getUsedCapacity(RESOURCE_ENERGY);
  for (const r of s.ruins) loose += r.store.getUsedCapacity(RESOURCE_ENERGY);
  const other = (s.factory?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0)
    + (s.powerSpawn?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0);
  let towers = 0;
  for (const t of s.towers) towers += t.store.getUsedCapacity(RESOURCE_ENERGY);
  return {
    spawnExt: s.energyAvailable,
    carry: s.creepEnergy ?? 0,
    towers,
    containers,
    storage: s.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    terminal: s.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    links,
    loose,
    other,
  };
}

/**
 * 查询口（Public Interface）：返回房间最近一次核算快照；未核算过返回 undefined。
 * 消费方（Storage-aware Spawn / 请求池 / 门控）只经此读取，不直读 Memory 结构。
 */
export interface EconomyQuery {
  tick: number;
  /** 净流 EMA（能量/tick，可负）。 */
  netFlow: number;
  /** 合同储备（storage+terminal+link 水位）。 */
  contractReserve: number;
  /** 风险缓冲（断供耐受 tick 数）。 */
  riskBuffer: number;
  /** 最近一窗 drift。 */
  drift: number;
  /** 估计收入（产能×效率系数，能量/tick）。 */
  estimatedIncome: number;
  /** 效率系数（0..1）。 */
  efficiency: number;
}

export function queryEconomy(roomName: string): EconomyQuery | undefined {
  const mem = Memory.rooms[roomName]?.economy;
  if (!mem) return undefined;
  return {
    tick: mem.t,
    netFlow: mem.nf / 100,
    contractReserve: mem.cr,
    riskBuffer: mem.rb / 10,
    drift: mem.dr,
    estimatedIncome: mem.ei / 10,
    efficiency: mem.ef / 100,
  };
}

export const economySystem: System = {
  name: "economy",
  priority: 1 as Priority,
  // 每 tick 被调度（近零成本：仅房间级取模门控）；实际核算按 windowTicks
  // 房间错峰结算——kernel 的 systemPhase 已按系统名错峰，若此处再用
  // interval=windowTicks 会与房间散列双重取模导致多数房间永不结算。
  interval: 1,
  run(ctx: TickContext): void {
    const g = globalCache();
    const acc = CONFIG.economy.accounting;
    sampleRoomFlows(ctx);
    for (const snapshot of ctx.snapshots()) {
      const roomName = snapshot.roomName;
      // 房间错峰：windowTicks 内稳定散列，避免同 tick 全房重算（ECONOMY §3 刷新合同）。
      if ((ctx.tick + roomHash(roomName)) % acc.windowTicks !== 0) continue;
      const roomMem = Memory.rooms[roomName];
      if (!roomMem) continue;

      const st = stateFor(roomName);
      const cum = toLedger(g.energyLedger?.rooms[roomName]);
      const pools = collectPools(snapshot);

      // 无基线或断档（reset/跳窗）→ 只播种窗口起点，不结算（防跨断口假漂移）。
      // 基线必须是**拷贝**：cum 是全局累计账的活引用，别名会让窗口差值恒为 0。
      if (st.lastTick === undefined || ctx.tick - st.lastTick !== acc.windowTicks) {
        st.lastTick = ctx.tick;
        st.lastLedger = { ...cum };
        st.lastPools = { ...pools };
        // Memory 快照恢复平滑值（仅首见时；断档重播种保留既有 EMA）。
        if (st.netFlowEma === undefined && roomMem.economy) {
          st.netFlowEma = roomMem.economy.nf / 100;
          st.effFactor = roomMem.economy.ef / 100;
        }
      continue;
      }

      // 合同初值语义：效率系数从 0.7 起点由实测 EMA 校准，而非首窗实测直取
      // （首窗可能尚无采集发生，测得 0 不代表产能为零——ECONOMY §2.1-1）。
      if (st.effFactor === undefined) st.effFactor = INITIAL_EFFICIENCY_FACTOR;

      const w = rollupWindow(st.lastTick, ctx.tick, st.lastLedger, cum, st.lastPools, pools);
      const netPerTick = (w.income - w.consumption + w.refunds) / w.ticks;
      st.netFlowEma = updateNetFlowEma(st.netFlowEma, netPerTick, acc.netFlowAlpha);
      st.effFactor = updateEfficiencyFactor(st.effFactor, w.incomePerTick, snapshot.sources.length, acc.efficiencyAlpha);

      const reserve = contractReserveOf(pools);
      const rb = riskBufferTicks(reserve, w.p0p1PerTick, acc.riskEpsilon);

      // 漂移门：连续 2 窗超容差 → AccountingDrift 事件（先修核算，禁带病发展）。
      if (isDriftExcessive(w, acc.driftFloor, acc.driftRatio)) {
        st.driftStreak++;
        if (st.driftStreak === 2) {
          recordEvent(EventKind.AccountingDrift, roomName, [Math.round(w.drift), st.driftStreak]);
        }
      } else {
        st.driftStreak = 0;
      }


      roomMem.economy = toMemorySnapshot(
        ctx.tick,
        st.netFlowEma,
        reserve,
        rb,
        w.drift,
        estimateIncome(snapshot.sources.length, st.effFactor ?? INITIAL_EFFICIENCY_FACTOR),
        st.effFactor ?? INITIAL_EFFICIENCY_FACTOR,
      );

      st.lastTick = ctx.tick;
      st.lastLedger = { ...cum };
      st.lastPools = pools;
    }
  },
};