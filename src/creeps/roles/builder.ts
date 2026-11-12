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
  withdrawClosestContainer,
  withdrawClosestNonSourceContainer,
  withdrawStorageCapped,
} from "../engine/actions";
import { releaseAssignment } from "../support/assignment-adapter";
import { getObjectById } from "../support/obj-cache";
import { claimedRepair } from "../support/repair-reservations";
import { defineRole } from "../engine/role-runner";
import { scored } from "../engine/arbiter";

/** 血量缺口（0=满血，1=归零）— 维修类效用的共同尺度。 */
function hpDeficit(s: { hits: number; hitsMax: number }): number {
  // R684：效用评分在 resolve 之后才发现目标已消失时，对象 getter 会抛
  // "Could not find an object with ID" 并中断整只 creep（R676 只护了 execute 侧）。
  // 返回 0 让该候选失去效用，由其它候选继续。
  try {
    if (!(s.hitsMax > 0)) return 0;
    return Math.max(0, 1 - s.hits / s.hitsMax);
  } catch {
    return 0;
  }
}

/** 建造类效用加成：存在性阻塞（spawn/tower）> 关键 container > 临近完工。 */
function siteUtility(ac: ActionContext, site: ConstructionSite): number {
  let bonus = 0;
  if (site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER) {
    bonus += 50;
  }
  if (site.structureType === STRUCTURE_CONTAINER) {
    const near = (p?: { x: number; y: number }) =>
      p !== undefined && Math.abs(site.pos.x - p.x) <= 1 && Math.abs(site.pos.y - p.y) <= 1;
    if (near(ac.snapshot.controller?.pos) || ac.snapshot.sources.some(s => near(s.pos)))
      bonus += 20;
  }
  // R681：RCL4 尚未建成 storage 时，storage 工地是经济解锁项，排在常规维护之前
  // （150 = 60 基础 + 90；仍低于 fresh rampart 180，濒死城防急救不被抢）。
  if (site.structureType === STRUCTURE_STORAGE && ac.snapshot.storage === undefined) bonus += 90;
  if (site.progressTotal > 0 && site.progress / site.progressTotal >= 0.8) bonus += 15;
  return bonus;
}

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
  isRepairWorker: true,
  executionOrder: 4,
  // R674：work 模式效用仲裁 —— 用分数而不是链序分配注意力，避免建造永远命中、
  // 修路/工事被链尾饿死（历史实测 16 条路 8 条破 40%）。acquire 仍走链式。
  arbitration: "utility",
  // R3a：builder 声明生存豁免 — recovery 重建被毁基建 + bootstrap 建造关键基建
  // 都是生存行为，不是发展。colonyStateFreezesRole 读此标志放行。
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
    // 2.5 别无选择时：从最近的**任意**有能量 container 取（含物流 container）。
    //     幼房（RCL3，无 storage）的全部 container 都是 source/controller container ⇒ 第 2 步恒空，
    //     原实现直接落到 harvest：builder 离开工位去源上自采，实测工地进度只有 **0.077/t**
    //     （同房三只 2W1C2M builder 的能力是 40/t），三块 extension 各要 3000 进度 ⇒ 爬级被拖成上万拍。
    //     这里的"礼让 hauler"并不成立：builder 在源上自采**消耗的是同一份源再生**，只是多绕几十拍，
    //     而线上实测 source container 是 2000/2000 满载（hauler 自己也存不进去）⇒ 取走它反而解堵。
    //     排在第 2 步之后 ⇒ 真有非物流 container 可用时，礼让语义原样保留。
    withdrawClosestContainer(),
    // 3. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
  ],

  work: [
    // 急救：新生 rampart 灌血过生存线（建成仅 1 hit，100 tick 内必死于衰减）。
    // 效用最高档：灌血十几 tick，建 site 上百 tick；顺序反了就是「建了就塌」死循环。
    scored(claimedRepair(repairFreshRampart()), () => 180),
    // 急救：血量 < 15% 的危路（塌毁重建耗能 6 倍 + site 占建造名额）。
    scored(claimedRepair(repairUrgentRoads()), (_ac, r) => 80 + 120 * hpDeficit(r)),
    // 建造 assignment 指定的 site / 最近 site。
    scored(buildAssignmentSite({ recoverySkip: true }), (ac, s) => 60 + siteUtility(ac, s)),
    // 有 build 租约且目标仍存在时让位给 assignment（保留任务池的 maxWorkers/去向语义）；
    // 目标消失时租约即将被回收，本候选立即接管，避免空等。急救维修仍可抢占。
    scored(buildNearestSite(false, { recoverySkip: true }), (ac, s) =>
      ac.assignment?.targetId && getObjectById(ac.assignment.targetId)
        ? 0
        : 50 + siteUtility(ac, s),
    ),
    // 紧急：修复衰减中的 container（< 80% 血量）— 失去 container = 物流链断裂。
    // R674b：按缺口缩放（80% 时≈40，50%≈85，20%≈130），避免「刚破 80%」就压过建造；
    // claimedRepair 保证每目标每 tick 至多 1 人（线上实证 3/3 builder 同修一个容器）。
    scored(claimedRepair(repairContainerDecay()), (_ac, c) => {
      const ratio = c.hitsMax > 0 ? c.hits / c.hitsMax : 1;
      const pressure = Math.max(0, 0.8 - ratio) / 0.8;
      return 40 + 120 * pressure;
    }),
    // 紧急：修复血量 < 50% 的关键结构。
    scored(claimedRepair(repairCritical()), (_ac, t) => 130 + 100 * hpDeficit(t)),
    // fallback: 填充 spawn/extension。
    scored(fillTarget(), () => 35),
    // fallback: 修复衰减中的道路（< 40% 血量）。常规修路礼让建造（< 15% 的危路由
    // repairUrgentRoads 接管），但老化会把它周期性提到链首，防「永远没人修路」。
    scored(claimedRepair(repairRoads()), (_ac, r) => 15 + 35 * hpDeficit(r)),
    // fallback: 防御工事维修（盈余门禁 + 无威胁时）。
    // 分数按血量分档：垫底的 10+15×deficit（≤25）会被 fillTarget(35) 与 repairRoads(≤50)
    // 永久压住 ⇒ rampart 在排队中衰减到塌毁（W6N1 实测 4 分钟塌 18 个、防线出缺口）。
    // 基础防护档的成本其实极低（全房补一遍约 1,000 能量），必须先于填能与修路执行：
    //   - < 3,000 hits：真濒死（约 500 tick 生命），提到 150 —— 高于建造，低于 fresh(180)
    //   - < 10,000 hits：基础防护档，提到 70 —— 高于 buildNearest(≤50) 与 fillTarget(35)
    //   - 其余：保持链尾（常规档只在 fortifyActive 时才有目标，本就是宽裕期工作）
    scored(claimedRepair(repairFortifications()), (_ac, f) =>
      f.hits < 3000 ? 150 : f.hits < 10000 ? 70 : 10 + 15 * hpDeficit(f),
    ),
    // 所有候选均不匹配 → park 待命。builder 不 fallback 到升级 — 升级是 upgrader 的职责，
    // 等待新 construction site 出现而非消耗能量去升级。
  ],
};

export const builderRole = defineRole("builder", 2 as Priority, policy);
