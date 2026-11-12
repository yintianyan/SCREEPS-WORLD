/** Distributor */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  distributorFillTarget,
  reclaimFactoryOutput,
  salvageStorageToTerminal,
  stockFactoryBattery,
  stockFactoryComponents,
  stockFactoryEnergy,
  stockNuker,
  stockPowerSpawn,
  stockTerminalEnergy,
  supplyLabs,
  terminalExportLane,
  returnEnergyToStorage,
} from "../engine/actions";
import { countedIntent } from "../engine/actions/helpers";
import { defineRole } from "../engine/role-runner";
import { scored } from "../engine/arbiter";
import { getRoomTaskLedger, ledgerValue } from "../support/task-ledger";
import { getObjectById } from "../support/obj-cache";
import { moveToTarget } from "../movement";
import { computeDistributorTier, hasDistributorFillDemand } from "../support/targeting";
import type { DistributorTier } from "../support/targeting";

/** 各档位对应的单次最大取能量。tier 0 = 满载（carry 容量）。 */
const TIER_WITHDRAW_CAP: readonly [number, number, number, number] = [
  Infinity, // tier 0: 满载
  Infinity, // tier 1: 满载（但目标类型受限）
  400, // tier 2: 限取 400/tick
  200, // tier 3: 限取 200/tick
];

/** 从 storage 限量取能 — 带水位分级节流。
 * 需求门禁（本角色核心设计）：没有本档位可服务的 fillTarget 时禁止从 storage 取能，
 * 从架构上消除 storage→storage 循环。门禁必须与投放阶段（distributorFillTarget）用同一套
 * tier 过滤口径 — 否则会为档位内拒绝服务的目标（如 tier≥1 时的 tower）取能，随后携能 idle。
 * 水位分级（由 gate 写入 memory.distributorTier，阈值 CONFIG.economy.distributorTiers）：
 * tier 0 (≥50k) 满载全目标；tier 1 (≥10k) 满载仅 spawn/extension；tier 2 (≥2k) 限取 400；
 * tier 3 (<2k) 限取 200 — 低水位靠取能限额节流；spawn/extension 是同一孵化能量池，任何档位不裁剪。
 */
/**
 * Phase 1：从 deliver 任务的 sourceId 取能（storage/container）。
 * 必须在其余 acquire 之前 — 租约明确指定了取能源，不再走动态需求门禁。
 */
function withdrawAssignedSource(): ActionCandidate<AnyStructure> {
  return {
    name: "withdraw:assigned-source",
    resolve: ac => {
      const a = ac.assignment;
      if (!a || a.kind !== "deliver" || a.sourceId === undefined) return undefined;
      const obj = getObjectById(a.sourceId as unknown as Id<AnyStructure>);
      if (!obj) return undefined;
      if (obj.structureType !== STRUCTURE_STORAGE && obj.structureType !== STRUCTURE_CONTAINER) {
        return undefined;
      }
      const store = (obj as AnyStoreStructure).store;
      if (store === undefined || store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return obj;
    },
    execute: (ac, obj) => {
      const store = (obj as AnyStoreStructure).store;
      const amount = Math.min(
        store.getUsedCapacity(RESOURCE_ENERGY),
        ac.creep.store.getFreeCapacity(RESOURCE_ENERGY),
      );
      const result = countedIntent("withdraw", () =>
        ac.creep.withdraw(obj, RESOURCE_ENERGY, amount),
      );
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, obj);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/**
 * Phase 1：把能量送到 deliver 任务的 targetId（storage link / controller container）。
 * 目标满时返回 undefined，让 work 链回落到通用 fill（能量不丢，改投生产池）。
 */
function deliverAssignedTarget(): ActionCandidate<AnyStructure> {
  return {
    name: "deliver:assigned-target",
    resolve: ac => {
      const a = ac.assignment;
      if (!a || a.kind !== "deliver") return undefined;
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;

      let obj: AnyStructure | undefined;
      if (a.targetGroup === "core") {
        // Phase 2：core 汇组任务 — 交付时解析最近的空闲 spawn/extension。
        const pool = ac.snapshot.fillTargets.filter(
          t =>
            (t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION) &&
            t.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        );
        obj =
          pool.length > 0
            ? (ac.creep.pos.findClosestByRange(pool as unknown as AnyStructure[]) ??
              (pool[0] as unknown as AnyStructure))
            : undefined;
      } else if (a.targetId !== undefined) {
        obj = getObjectById(a.targetId as unknown as Id<AnyStructure>) ?? undefined;
      } else {
        return undefined;
      }

      if (!obj || obj.structureType === STRUCTURE_CONTROLLER) return undefined;
      const store = (obj as AnyStoreStructure).store;
      if (store === undefined || store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return obj;
    },
    execute: (ac, obj) => {
      const result = countedIntent("transfer", () => ac.creep.transfer(obj, RESOURCE_ENERGY));
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, obj);
      } else if (result === ERR_FULL) {
        // 目标满：保留租约，下一 tick work 链会回落到通用 fill。
      }
    },
  };
}

function withdrawStorageForDistribution(): ActionCandidate {
  return {
    name: "withdraw:storage-for-distribution",
    resolve: ac => {
      const st = ac.snapshot.storage;
      if (!st || st.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      // 需求门禁：本档位无可服务的 fillTarget 时禁止从 storage 取能。
      const tier = (ac.creep.memory.distributorTier as DistributorTier) ?? 0;
      if (!hasDistributorFillDemand(ac.snapshot, tier)) return undefined;
      return st;
    },
    execute: (ac, target) => {
      const st = target as StructureStorage;
      const available = st.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      // 水位分级限取：tier 由 gate 每 tick 计算并持久化到 memory。
      const tier = (ac.creep.memory.distributorTier as 0 | 1 | 2 | 3) ?? 0;
      const cap = TIER_WITHDRAW_CAP[tier];
      const amount = Math.min(available, carryFree, cap);
      const result = countedIntent("withdraw", () =>
        ac.creep.withdraw(st, RESOURCE_ENERGY, amount),
      );
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, st);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 无 storage 时降级为 hauler — 处理 storage 被毁后 distributor 残留的场景。
 * demand 系统无 storage 时不孵新 distributor（正确），但已有 distributor 无 storage 可取 →
 * acquire 返回 undefined → idle 空转。降级为 hauler 后从 container 取能、填充 spawn/extension，
 * 继续工作；storage 重建后 demand 会孵新 distributor。body 兼容：两者都是纯 CARRY+MOVE，
 * 角色转换安全。水位分级计算：每 tick 按 storage 水位写 distributorTier，供限取与目标过滤共用。
 *
 * F12 修复：标记 distributorDegraded，hauler gate 检查此标记 — storage 重建后转回 distributor，
 * 避免永久降级。
 */
function distributorGate(ac: ActionContext): boolean {
  if (!ac.snapshot.storage) {
    ac.creep.memory.role = "hauler";
    ac.creep.memory.distributorDegraded = true;
    return false; // 跳过本 tick，下一 tick 以 hauler 角色运行
  }
  // 每 tick 重新计算水位档位，供本 tick 的 acquire/work 阶段读取。
  ac.creep.memory.distributorTier = computeDistributorTier(ac.snapshot.storage);
  return true;
}

/** 投放目标价值：distributor 的本职是保 spawn/extension，故核心档固定高于账本基础值。 */
function distributorFillValue(ac: ActionContext, t: AnyOwnedStructure): number {
  const ledger = getRoomTaskLedger(ac.snapshot);
  if (t.structureType === STRUCTURE_SPAWN || t.structureType === STRUCTURE_EXTENSION) {
    return Math.max(105, ledgerValue(ledger, "fill-core", 70));
  }
  if (t.structureType === STRUCTURE_TOWER) return ledgerValue(ledger, "fill-tower", 85);
  return ledgerValue(ledger, "fill-cc", 50);
}

const policy: RolePolicy = {
  park: true,
  isDistributor: true,
  isLifeLine: true,
  // R675：work 模式走任务账本 + 效用仲裁；acquire 保持链式（storage 取能/需求门禁）。
  arbitration: "utility",
  // R676：物流任务稳定，10 拍决策一次，降低全量评分开销。
  decisionInterval: 10,
  gate: distributorGate,
  acquire: [
    // Phase 1：deliver 租约指定的取能源优先。
    withdrawAssignedSource(),
    // nuke 资产抢救（nuke 警报房才激活，常态零开销）：storage → terminal 搬运，
    // 支撑 terminal-manager 逐轮 send。置顶 — 50000 tick 倒计时的资产迁移
    // 压倒一切经济取料（withdraw 相不与 fillTarget 需求门禁冲突 — 各自独立）。
    salvageStorageToTerminal(),
    // factory 积压回收（取料相）— **必须排在 withdrawStorageForDistribution 之前**。
    // 后者的门禁含 tower / controller-link，而 W8N3 的 controller link 恒 799/800（差 1 点）
    // ⇒ 取能链每拍命中，factory 的 42,010 能量永远排不上队（实测 3 分钟零下降）。
    // factory 容量 50k，堆满后 produce 返 ERR_FULL 会让解压链静默死锁；
    // 普通分发只是少搬一趟，不会死锁 —— 所以回收优先。
    reclaimFactoryOutput(),
    // Phase B：terminal 出口车道（取料相）— 非 energy 资源的 storage↔terminal 双向搬运。
    terminalExportLane(),
    // 唯一取能源：storage（带需求门禁）— 没有 fillTarget 时 predicate=false → idle → 不补孵。
    withdrawStorageForDistribution(),
    // terminal 能量备货（storage 富余时）— 无 fillTarget 需求时的低优先级取能，保证市场运费储备不断供。
    stockTerminalEnergy(),
    // factory battery 解压原料补给（storage 低于解压目标水位时触发：
    // 从 storage/terminal 搬 battery 到 factory 供解压回能）。先于压缩原料 —
    // crisis 救助优先于满仓止损。
    stockFactoryBattery(),
    // factory 压缩原料备货（仅 storage 满仓时触发）。
    stockFactoryEnergy(),
    // commodity 生产补料（审计缺口 6：按 factory-manager 目标补组件进 factory）。
    stockFactoryComponents(),
    // lab 供料（取料/卸料相）— 必须挂在 acquire 链：work 模式要求满载进入，空载的
    //「从 storage 取化合物 / 从 lab 清错矿」只有 acquire 阶段能执行；只挂 work 链则取料相永不可达。
    supplyLabs(),
    // powerSpawn 原料补给（能量/POWER 取料相）— GPL 涓流是最奢侈的下游，排在最后。
    stockPowerSpawn(),
    // nuker 威慑备弹装填（能量/G 取料相）— 战略投资受高水位地板门禁，与 powerSpawn 同档垫底。
    stockNuker(),
  ],

  work: [
    // Phase 1：deliver 租约指定的目标优先（目标满时 resolve 返回 undefined，自动回落）。
    scored(deliverAssignedTarget(), () => 140),
    // nuke 资产抢救（deposit 相）— 置顶理由同 acquire 链。
    scored(salvageStorageToTerminal(), () => 200),
    // distributor 专用填充：spawn/extension 绝对优先 > tower > controller container（仅无 link 兜底）。
    // 不复用 haulFillTarget — 避免被 divert 去喂 controller container 而饿死 spawn。
    scored(distributorFillTarget(), distributorFillValue),
    // terminal 能量备货（deposit 相）— 排在经济 sink 之后、lab 供料之前：
    // 携能状态下 supplyLabs 的取料相无法执行（背包已满），先卸给 terminal。
    scored(stockTerminalEnergy(), () => 40),
    // Phase B：terminal 出口车道（投放相）— trim 送 storage、export 送 terminal。
    // 价值高于普通填充分发：terminal 容量/出口断了，整条贸易与工业落地都会停摆。
    scored(terminalExportLane(), () => 120),
    // factory battery 回收（投放相）— 先于投料 deposit，避免携 battery 与投料互相顶占背包。
    // crisis 时此 action 也会把 factory 内解压产出的能量 deposit 到 storage。
    // Phase D：110 → 130，必须高于 terminalExportLane(120)。factory 容量 50k，
    // 解压积压堆到 ERR_FULL 会让整条链静默死锁（W8N3 实测 42,010 能量卡住不动，
    // 而 distributor 全被 terminal trim 占用）；terminal 只是摆放优化，不会死锁。
    scored(reclaimFactoryOutput(), () => 130),
    // factory battery 解压原料补给（deposit 相，crisis 时触发）。
    scored(stockFactoryBattery(), () => 100),
    // factory 压缩原料备货（deposit 相，仅满仓时触发）。
    scored(stockFactoryEnergy(), () => 85),
    // commodity 生产补料（deposit 相）。
    scored(stockFactoryComponents(), () => 95),
    // 化合物供料到 lab。R675：账本按搬运条目数提权（90–130），不再被 fillTarget 永久遮蔽。
    scored(supplyLabs(), ac => ledgerValue(getRoomTaskLedger(ac.snapshot), "supply-labs", 90)),
    // powerSpawn 原料投放相。
    scored(stockPowerSpawn(), () => 45),
    // nuker 威慑备弹投放相。
    scored(stockNuker(), () => 35),
    // 所有 sink 均满 — 原地待命。注意：distributor 没有 fillStorage — 架构约束，
    // 加上就会重新引入 storage→storage 循环。
    // Phase C 例外：所有 sink 满 + storage 低于恢复线时，把背包能量回吐 storage。
    // 只兜「真的无处可送」的满载卡死（W8N3 实测 3 只共 ~1,110 能量长期卡背包），
    // 且 storage ≥ richStorageResume 时自动退出，不会形成 storage→storage 循环。
    scored(returnEnergyToStorage(), () => 20),
  ],
};

export const distributorRole = defineRole("distributor", 1 as Priority, policy);
