/**
 * Distributor — P1 分发角色（RCL4+）。从 storage 取能分发给 spawn/extension/tower/lab；
 * 数据流 Storage → Sink（单向，永不回流）— 与 hauler 的「源 → Storage」分离，消除
 * 旧架构的 storage→storage 循环。仅 storage 存在时孵化；无 storage 时由 hauler 直送。
 * assignment-free 设计（修改前必读）：distributor 不参与 assignment 系统，直接读
 * RoomSnapshot.fillTargets。为什么：spawn 填充在所有状态（正常/低能量/敌袭）都应优先，
 * 紧急抢占会清空 assignment → 失任务 → spawn 不被填充 → 灾后无法恢复。限制：紧急抢占对
 * distributor 无效（设计意图）；仍受 shouldFlee 控制；需求门禁从架构上消除循环。
 * 维护约束：勿纳入 assignment 系统（除非引入「紧急态豁免」）；未来扩展走 snapshot 字段驱动。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  distributorFillTarget,
  reclaimFactoryOutput,
  stockFactoryEnergy,
  stockPowerSpawn,
  stockTerminalEnergy,
  supplyLabs,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { computeDistributorTier, hasDistributorFillDemand } from "../support/targeting";
import type { DistributorTier } from "../support/targeting";

/** 各档位对应的单次最大取能量。tier 0 = 满载（carry 容量）。 */
const TIER_WITHDRAW_CAP: readonly [number, number, number, number] = [
  Infinity, // tier 0: 满载
  Infinity, // tier 1: 满载（但目标类型受限）
  400,      // tier 2: 限取 400/tick
  200,      // tier 3: 限取 200/tick
];

/** 从 storage 限量取能 — 带水位分级节流。
 * 需求门禁（本角色核心设计）：没有本档位可服务的 fillTarget 时禁止从 storage 取能，
 * 从架构上消除 storage→storage 循环。门禁必须与投放阶段（distributorFillTarget）用同一套
 * tier 过滤口径 — 否则会为档位内拒绝服务的目标（如 tier≥1 时的 tower）取能，随后携能 idle。
 * 水位分级（由 gate 写入 memory.distributorTier，阈值 CONFIG.economy.distributorTiers）：
 * tier 0 (≥50k) 满载全目标；tier 1 (≥10k) 满载仅 spawn/extension；tier 2 (≥2k) 限取 400；
 * tier 3 (<2k) 限取 200 — 低水位靠取能限额节流；spawn/extension 是同一孵化能量池，任何档位不裁剪。
 */
function withdrawStorageForDistribution(): ActionCandidate {
  return {
    name: "withdraw:storage-for-distribution",
    resolve: (ac) => {
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
      const result = ac.creep.withdraw(st, RESOURCE_ENERGY, amount);
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
 */
function distributorGate(ac: ActionContext): boolean {
  if (!ac.snapshot.storage) {
    ac.creep.memory.role = "hauler";
    return false; // 跳过本 tick，下一 tick 以 hauler 角色运行
  }
  // 每 tick 重新计算水位档位，供本 tick 的 acquire/work 阶段读取。
  ac.creep.memory.distributorTier = computeDistributorTier(ac.snapshot.storage);
  return true;
}

const policy: RolePolicy = {
  park: true,
  gate: distributorGate,
  acquire: [
    // 唯一取能源：storage（带需求门禁）— 没有 fillTarget 时 predicate=false → idle → 不补孵。
    withdrawStorageForDistribution(),
    // terminal 能量备货（storage 富余时）— 无 fillTarget 需求时的低优先级取能，保证市场运费储备不断供。
    stockTerminalEnergy(),
    // factory battery 回收（取料相）— 先于投料：factory 堵死时继续投料无意义。
    reclaimFactoryOutput(),
    // factory 压缩原料备货（仅 storage 满仓时触发）。
    stockFactoryEnergy(),
    // lab 供料（取料/卸料相）— 必须挂在 acquire 链：work 模式要求满载进入，空载的
    //「从 storage 取化合物 / 从 lab 清错矿」只有 acquire 阶段能执行；只挂 work 链则取料相永不可达。
    supplyLabs(),
    // powerSpawn 原料补给（能量/POWER 取料相）— GPL 涓流是最奢侈的下游，排在最后。
    stockPowerSpawn(),
  ],

  work: [
    // distributor 专用填充：spawn/extension 绝对优先 > tower > controller container（仅无 link 兜底）。
    // 不复用 haulFillTarget — 避免被 divert 去喂 controller container 而饿死 spawn。
    distributorFillTarget(),
    // terminal 能量备货（deposit 相）— 排在经济 sink 之后、lab 供料之前：
    // 携能状态下 supplyLabs 的取料相无法执行（背包已满），先卸给 terminal。
    stockTerminalEnergy(),
    // factory battery 回收（投放相）— 先于投料 deposit，避免携 battery 与投料互相顶占背包。
    reclaimFactoryOutput(),
    // factory 压缩原料备货（deposit 相，仅满仓时触发）。
    stockFactoryEnergy(),
    // 化合物供料到 lab。
    supplyLabs(),
    // powerSpawn 原料投放相。
    stockPowerSpawn(),
    // 所有 sink 均满 — 原地待命。注意：distributor 没有 fillStorage — 架构约束，
    // 加上就会重新引入 storage→storage 循环。
  ],
};

export const distributorRole = defineRole("distributor", 1 as Priority, policy);
