/** R675 房间任务账本 — 每房每 tick 一次的需求汇总，供角色效用函数共享。
 *
 * 为什么要账本：效用一个候选一个公式，若每处各自扫 snapshot / globalCache，
 * 既费 CPU 又会得出互相矛盾的「有多急」。账本把房间级需求（核心填充、storage、
 * CC、施工、lab 搬运、矿物积压）折成一份带价值的任务表，角色只读结论。
 *
 * 当前阶段：账本提供**基础价值**与**需求计数**，目标选择仍由各动作 resolve 完成；
 * 老化/承诺/硬性公平由 arbiter 统一叠加。后续 P3 可把 maxWorkers 配额也搬进账本。
 */
import { CONFIG } from "../../config";
import type { RoomSnapshot } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";

export type LedgerTaskKind =
  | "fill-core"
  | "fill-tower"
  | "fill-cc"
  | "store-energy"
  | "feed-construction"
  | "supply-labs"
  | "haul-minerals";

export interface LedgerTask {
  readonly kind: LedgerTaskKind;
  /** 基础效用（>=0）。0 的条目不会出现在表里。 */
  readonly value: number;
  /** 需求计数（空闲能量 / 工地数 / lab 搬运条目数 / 矿物量）。 */
  readonly demand: number;
}

export interface RoomTaskLedger {
  readonly tick: number;
  readonly roomName: string;
  readonly tasks: readonly LedgerTask[];
  readonly metrics: {
    readonly hasSites: boolean;
    readonly sites: number;
    readonly coreFreeRatio: number;
    readonly towerFreeRatio: number;
    readonly ccFreeRatio: number;
    readonly ccLevel: number;
    readonly storageFreeRatio: number;
    readonly storageLevel: number;
    readonly labLoads: number;
    readonly mineralBacklog: number;
  };
}

function ratio(used: number, cap: number): number {
  return cap > 0 ? Math.max(0, Math.min(1, used / cap)) : 0;
}

function energyUsed(t: { store: Store<ResourceConstant, false> }): number {
  return t.store.getUsedCapacity(RESOURCE_ENERGY);
}

function energyCap(t: { store: Store<ResourceConstant, false> }): number {
  return t.store.getCapacity(RESOURCE_ENERGY);
}

/** 构建（或取本 tick 缓存的）房间任务账本。 */
export function getRoomTaskLedger(snapshot: RoomSnapshot): RoomTaskLedger {
  const g = globalCache();
  if (!g.roomTaskLedger || g.roomTaskLedger.tick !== Game.time) {
    g.roomTaskLedger = { tick: Game.time, byRoom: {} };
  }
  const cached = g.roomTaskLedger.byRoom[snapshot.roomName];
  if (cached) return cached;

  // 核心供给 = spawn + extension（同一孵化能量池）。
  let coreUsed = 0;
  let coreCap = 0;
  for (const s of [...snapshot.spawns, ...snapshot.extensions]) {
    coreUsed += energyUsed(s);
    coreCap += energyCap(s);
  }
  let towerUsed = 0;
  let towerCap = 0;
  for (const t of snapshot.towers) {
    towerUsed += energyUsed(t);
    towerCap += energyCap(t);
  }
  const cc = snapshot.controllerContainer;
  const ccUsed = cc ? energyUsed(cc) : 0;
  const ccCap = cc ? energyCap(cc) : 0;
  const st = snapshot.storage;
  const storageUsed = st ? energyUsed(st) : 0;
  const storageCap = st ? energyCap(st) : 0;

  const demands = g.labDemands;
  const labTable =
    demands && Game.time - demands.tick <= CONFIG.economy.labDemandTtl
      ? demands.byRoom[snapshot.roomName]
      : undefined;
  const labLoads = labTable ? labTable.loads.length + labTable.unloads.length : 0;

  const mineralThreshold = 1400; // 与 haulMineralTopUp 的 70% 容器阈值同口径
  let mineralBacklog = 0;
  for (const c of snapshot.containers) {
    let mineralTotal = 0;
    for (const res of Object.keys(c.store) as ResourceConstant[]) {
      if (res === RESOURCE_ENERGY) continue;
      const qty = c.store[res];
      if (typeof qty === "number") mineralTotal += qty;
    }
    if (mineralTotal >= mineralThreshold) mineralBacklog += mineralTotal;
  }

  const sites = snapshot.myConstructionSites.length;
  // R680：crisis/recovery/bootstrap 时 CC 不得压过核心（线上 W39S55：CC 低半满锁住
  // 唯一 work hauler，spawn 饿死、源容器积压、harvester idle ⇒ 人口 11→4）。
  const phase = Memory.rooms[snapshot.roomName]?.phase?.phase;
  const crisisLike = phase === "crisis" || phase === "recovery" || phase === "bootstrap";
  const coreFreeRatio = 1 - ratio(coreUsed, coreCap);
  const towerFreeRatio = 1 - ratio(towerUsed, towerCap);
  const ccFreeRatio = 1 - ratio(ccUsed, ccCap);
  const ccLevel = ratio(ccUsed, ccCap);
  const storageFreeRatio = 1 - ratio(storageUsed, storageCap);
  const storageLevel = ratio(storageUsed, storageCap);

  const tasks: LedgerTask[] = [];
  if (coreCap > 0 && coreFreeRatio > 0) {
    // 核心越空越急；上限 90 仍低于 storage（hauler 先入库、distributor 再分发）。
    tasks.push({
      kind: "fill-core",
      value: 70 + 20 * (1 - coreFreeRatio),
      demand: coreCap * coreFreeRatio,
    });
  }
  if (towerCap > 0 && towerFreeRatio > 0) {
    tasks.push({ kind: "fill-tower", value: 85, demand: towerCap * towerFreeRatio });
  }
  if (ccCap > 0 && ccFreeRatio > 0) {
    // 施工期不给 CC 优先档（R672 教训）；和平期低于半满时 CC 是升级生命线。
    // R680：危机/恢复期同样降档，核心填充优先。
    // R687：核心接近满时（free<25%）把 CC 抬到 96 — storage(95) 会永久压住 CC(90)，
    // hauler 的效用仲裁只在 CC 被选中时才会走 getHaulFillTarget 的半满优先档。
    // 线上 W39S55：核心 1200/1300、CC 224/2000、两只 8W upgrader 只有 0/42 能量，
    // controller 速率 ≈3.7/拍（RCL5 是扩张 youngestMature 门的最后一格）。
    // 核心空时仍用 90 以下的值——生存侧优先，不让升级抢 spawn 的能量。
    const coreNearlyFull = coreCap > 0 && coreFreeRatio < 0.25;
    const value = sites > 0 || crisisLike ? 50 : ccLevel < 0.5 ? (coreNearlyFull ? 96 : 90) : 50;
    tasks.push({ kind: "fill-cc", value, demand: ccCap * ccFreeRatio });
  }
  if (storageCap > 0 && storageFreeRatio > 0) {
    tasks.push({
      kind: "store-energy",
      value: storageLevel < 0.2 ? 100 : 95,
      demand: storageCap * storageFreeRatio,
    });
  }
  if (sites > 0) {
    tasks.push({ kind: "feed-construction", value: 75, demand: sites });
  }
  if (labLoads > 0) {
    tasks.push({ kind: "supply-labs", value: 90 + Math.min(40, labLoads * 5), demand: labLoads });
  }
  if (mineralBacklog > 0) {
    tasks.push({ kind: "haul-minerals", value: 65, demand: mineralBacklog });
  }

  const ledger: RoomTaskLedger = {
    tick: Game.time,
    roomName: snapshot.roomName,
    tasks,
    metrics: {
      hasSites: sites > 0,
      sites,
      coreFreeRatio,
      towerFreeRatio,
      ccFreeRatio,
      ccLevel,
      storageFreeRatio,
      storageLevel,
      labLoads,
      mineralBacklog,
    },
  };
  g.roomTaskLedger.byRoom[snapshot.roomName] = ledger;
  return ledger;
}

/** 取某类任务的基础价值；不存在（未达到触发条件）返回 fallback（默认 0）。 */
export function ledgerValue(ledger: RoomTaskLedger, kind: LedgerTaskKind, fallback = 0): number {
  return ledger.tasks.find(t => t.kind === kind)?.value ?? fallback;
}
