/** Builder */
import type { Priority } from "../../kernel/contracts";
import type { ActionContext, RolePolicy } from "../engine/action-types";
import { CONFIG } from "../../config";
import {
  buildAssignmentSite,
  buildNearestSite,
  fillTarget,
  harvestSource,
  pickupDroppedEnergy,
  repairContainerDecay,
  repairCritical,
  repairFortifications,
  repairFreshRampart,
  repairRoads,
  repairUrgentRoads,
  withdrawClosestNonSourceContainer,
  withdrawStorageCapped,
} from "../engine/actions";
import { releaseAssignment } from "../support/assignment-adapter";
import { getObjectById } from "../support/obj-cache";
import { defineRole } from "../engine/role-runner";

/** recovery tier 门禁：释放 assignment（不建造）。 */
function builderGate(ac: ActionContext): boolean {
  if (ac.budget.tier === "recovery") {
    releaseAssignment(ac.creep);
    return true;
  }
  // conserve 下不释放 assignment — construction-manager 的 developmentGate 已在 conserve 下
  // 做了建造门禁（emergency 豁免），builder 不需要二次过滤；site 存在即应去建。
  return true;
}

/**
 * 动态计算 builder 从 storage 取能上限 — 水位权限表（绝对能量刻度）。
 * B-1 修复：原比例制（>20%/>10%）在发展期房间永远落在最低两档（8 万库存只给 50/趟）—
 * 与 distributorTiers 的历史教训同型（比例刻度系统性错误）。改绝对阈值且比 distributor
 * 保守一档（builder 是 P2 发展角色）：≥full(50k) 满载；≥sustained(10k) 200/趟；
 * ≥low(2k) 50/趟；<low 0 — withdrawStorageCapped resolve 拒绝，fallthrough container/harvest
 * （floor 下沉，与 upgrader 同手法）。
 */
function builderStorageLimit(ac: ActionContext): number {
  const st = ac.snapshot.storage;
  if (!st) return 0;
  const energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
  const tiers = CONFIG.economy.distributorTiers;
  if (energy >= tiers.full) return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (energy >= tiers.sustained) return 200;
  if (energy >= tiers.low) return 50;
  return 0;
}

const policy: RolePolicy = {
  park: true,
  // R3a：builder 迁移到 recoveryEligible 钩子（替代 kernel 硬编码角色名）。
  // recovery 时重建被毁基建是生存行为，不是发展。
  recoveryEligible: true,
  gate: builderGate,

  acquire: [
    // 0. 拾取地上掉落能量（衰减资源，最优先回收）。
    pickupDroppedEnergy(),
    // 1. 从 storage 取能（RCL4+ 主力源 — hauler 持续填充，最可靠）。
    //    无 storage 时 predicate=false，自动跳过。
    withdrawStorageCapped(builderStorageLimit),
    // 2. 取最近非物流 container 的能量（不抢 hauler/upgrader 的物流源）。
    withdrawClosestNonSourceContainer(),
    // 3. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
  ],

  work: [
    // 急救：新生 rampart 灌血过生存线（建成仅 1 hit，100 tick 内必死于衰减）。
    // 必须排在 build 之前 — 灌血十几 tick，建 site 上百 tick；顺序反了就是
    // 「建了就塌、塌了再建」死循环，防线永远立不起来。
    repairFreshRampart(),
    // 急救：血量 < 15% 的危路（塌毁重建耗能 6 倍 + site 占建造名额）。与 rampart 急救同层
    // 排在 build 之前 — construction 流水线持续放行 site 时建造永远命中，链尾常规修路被饿死
    // （线上实测 16 条路 8 条破 40%、最烂 4%）。急救只拉出险区（40%）即放手，不霸占建造工时。
    repairUrgentRoads(),
    // 建造 assignment 指定的 site（recovery 跳过）。
    buildAssignmentSite({ recoverySkip: true }),
    // 建造最近 site（recovery 跳过）。conserve 下不再过滤 criticalOnly —
    // construction-manager 的 developmentGate 已控制哪些 site 该存在，builder 只需去建。
    buildNearestSite(false, { recoverySkip: true }),
    // 紧急：修复衰减中的 container（< 80% 血量）。
    // 优先级高于 fill — 失去 container = 物流链断裂 = 经济崩溃。
    repairContainerDecay(),
    // 紧急：修复血量 < 50% 的关键结构（spawn/tower/extension/container）。
    // P2 修复：原位于 fillTarget 之后，现提前 — 结构快塌了比填能量更紧急。
    repairCritical(),
    // fallback: 填充 spawn/extension。
    fillTarget(),
    // fallback: 修复衰减中的道路（< 40% 血量）。
    // P1 修复：原先道路无任何维修覆盖，塌毁后交通变慢浪费 CPU。
    repairRoads(),
    // fallback: 防御工事维修（B3：盈余门禁 + 无威胁时，修 wall/rampart 至分级血量）。
    // 维修权从塔移交 creep —— 塔修墙是能量黑洞，creep 修是 1 energy/100 hits/WORK。
    repairFortifications(),
    // 所有候选均不匹配 → park 待命。builder 不 fallback 到升级 — 升级是 upgrader 的职责，
    // 等待新 construction site 出现而非消耗能量去升级。
  ],
};

export const builderRole = defineRole("builder", 2 as Priority, policy);
