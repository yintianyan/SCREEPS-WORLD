/**
 * Hauler — P1 收集者角色。
 *
 * 职责：将能量从源（container/dropped/link）搬运到 sink（spawn/extension/storage）。
 * 数据流方向：源 → Storage/Sink（单向，永不从 storage 取能）。
 *
 * 与 distributor 的职责分离：
 *   - Hauler（收集者）：container/dropped/link → storage/sink
 *   - Distributor（分发者）：storage → spawn/extension/tower/lab
 *
 * 架构约束：hauler 永不从 storage 取能。
 * 这消除了旧架构中 hauler 同时从 storage 取能又存回 storage 的循环依赖。
 * storage → sink 的分发由 distributor 角色负责。
 *
 * 无 storage 时（RCL1-3）：hauler 直接 container → spawn/extension 直送，
 * 不需要 distributor。
 *
 * onFlee 钩子（P0-2 修复）：
 *   hauler 在 flee 状态下的"防御圈内安全充能"逻辑从 lifecycle.ts 移到此处。
 *   仅当 hauler 携带能量且已在 spawn 安全区内时触发，
 *   向防御圈内的需能量结构（threat 时 tower 优先）转移能量。
 *   解决战斗中 Tower 能量耗尽、hauler 全部 flee 导致无人补给的防御死局。
 *
 * 策略声明：
 *   acquire: assignment container > storage link（排空 link 网络）> 大额遗留能量
 *            （坟墓/废墟/掉落堆 ≥ lootThreshold，衰减资源优先）> 最满 container（主取能）
 *            > 零头遗留兜底
 *   work:    haul fillTarget（带 reservation）> minerals → storage > labs > storage > 待命
 *
 * acquire 顺序要点：零头 droppedEnergy 排最后。container 满溢时 harvester 会 drop 溢出能量，
 * 若先捡零头 drop 会让 hauler 半满离开、来回空转而抽不干满 container（溢出根源未除）；
 * 先抽最满 container 既满载搬运又从源头止住溢出。大额遗留（≥ lootThreshold）例外插队 —
 * 它们在衰减/限时灭失，container 能量不会。详见 acquire 链内注释。
 */
import { CONFIG } from "../../config";
import type { Priority } from "../../kernel/contracts";
import { globalCache } from "../../kernel/global-cache";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  fillStorage,
  haulFillTarget,
  haulMineralsToStorage,
  lootRemains,
  pickupDroppedEnergy,
  supplyLabs,
  withdrawTerminalEnergy,
  withdrawCapped,
  withdrawStorageLink,
} from "../engine/actions";
import { selectHaulSourceContainer, pickHaulFillTargetInRange } from "../support/targeting";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, stepToward } from "../movement";
import { getObjectById } from "../support/obj-cache";

/** 从 assignment 指定的 container 限量取能。
 *
 * TD-013 修复：增加运行时结构类型检查。
 * assignment service 已不再将 storage 作为 haul source，但防御性检查仍保留，
 * 防止未来回退路径 reintroduction 导致 hauler 隐蔽从 storage 取能。
 */
function withdrawAssignmentContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "withdraw:assignment-container",
    resolve: (ac) => {
      if (!ac.assignment?.sourceId) return undefined;
      const obj = getObjectById(ac.assignment.sourceId as unknown as Id<StructureContainer>);
      if (obj === null) return undefined;
      // 运行时类型守卫：仅允许 StructureContainer，拒绝 storage 等其他结构。
      // hauler 架构约束：永不从 storage 取能（storage → sink 由 distributor 负责）。
      if (obj.structureType !== STRUCTURE_CONTAINER) return undefined;
      const container = obj as StructureContainer;
      if (container.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
      return container;
    },
    execute: (ac, container) => {
      const available = container.store.getUsedCapacity(RESOURCE_ENERGY);
      const carryFree = ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(available, carryFree);
      const result = ac.creep.withdraw(container, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, container);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** 从最值得疏解的非 controller container 限量取能（满溢程度 + 距离权衡）。
 *
 * 禁止从 controller container 取能：hauler 的 work 链会向 controller container 倒能
 * （haulFillTarget 将低于半满的 controller container 列为最高优先级填充目标）。
 * 如果 acquire 链同时从 controller container 取能，会形成「取→倒→取→倒」振荡。
 *
 * 选择器由 findRichestContainer（纯最满、平局恒选首个）改为 selectHaulSourceContainer
 * （满溢程度 vs 距离权衡 + 名字哈希散布）：修复两侧 source container 同为满仓时
 * 所有 hauler 涌向同一个、另一侧持续溢出无人疏解的羊群偏置。
 */
function withdrawRichestCapped(): ActionCandidate {
  return withdrawCapped((ac: ActionContext) => {
    // 排除 controller container — 它是 hauler 的填充目标，不是取能来源。
    const candidates = ac.snapshot.controllerContainer
      ? ac.snapshot.containers.filter(c => c.id !== ac.snapshot.controllerContainer!.id)
      : ac.snapshot.containers;
    const best = selectHaulSourceContainer(ac.creep, candidates);
    if (!best || best.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
    return best;
  });
}

// ─── onFlee：防御圈内安全充能（P0-2 从 lifecycle.ts 迁移）─────────

/**
 * Hauler 在 flee 状态下的"防御圈内安全充能"。
 *
 * 触发条件（全部满足）：
 *   1. hauler 已在 spawn 安全区内（距 spawn ≤ safeRefuelRange）
 *   2. 存在需能量结构（fillTargets）且该结构也在防御圈内
 *   3. 目标不在敌人侧（目标距敌人 ≥ hauler 距敌人，避免向敌人移动）
 *
 * 执行：
 *   - 在 transfer 范围内（≤ 1）→ 执行 transfer
 *   - 否则 → 移动到目标（仍在防御圈内）
 *
 * 优先级与 getHaulFillTarget 对齐：threat 存在时 tower 优先。
 * 返回 true 表示已执行充能（transfer 或移动），flee 函数应跳过原移动逻辑。
 * 返回 false 表示未处理，需要通用 flee 移动逻辑接管。
 */
function haulerOnFlee(ac: ActionContext): boolean {
  const creep = ac.creep;
  const snapshot = ac.snapshot;

  // 仅携带能量的 hauler 才执行安全充能。
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return false;
  if (snapshot.spawns.length === 0) return false;
  if (snapshot.fillTargets.length === 0) return false;

  const spawn = snapshot.spawns[0]!;
  const safeRange = CONFIG.defense.safeRefuelRange;

  // hauler 必须已在 spawn 安全区内
  if (creep.pos.getRangeTo(spawn.pos) > safeRange) return false;

  const nearestHostile = creep.pos.findClosestByRange(snapshot.threatCreeps as Creep[]) ?? undefined;

  // 复用 getHaulFillTarget 的优先级层级（haulerFillTiers）选择防御圈内最近的需能量结构。
  // 不使用预约系统 — flee 是临时行为，不应消耗正常 hauler 的预约配额。
  const target = pickHaulFillTargetInRange(creep, snapshot, spawn.pos, safeRange);
  if (!target) return false;

  // 安全检查：目标不能在敌人侧（目标距敌人 < hauler 距敌人 = 向敌人移动）
  if (nearestHostile) {
    const hostileToTarget = nearestHostile.pos.getRangeTo(target.pos);
    const creepToHostile = creep.pos.getRangeTo(nearestHostile.pos);
    if (hostileToTarget < creepToHostile) return false;
  }

  const dist = creep.pos.getRangeTo(target.pos);
  if (dist <= 1) {
    creep.transfer(target, RESOURCE_ENERGY);
    return true;
  }

  // 移动到目标（仍在防御圈内，双模出口 — traffic 关闭时即 ignoreCreeps:false 绕行）
  stepToward(creep, target);
  return true;
}

/**
 * 顺路卸能（伴随动作，不占候选链）— acquire 途中携带上一趟残余能量、
 * 恰好路过 storage（range<=1）时顺手存入。transfer 与 move 是独立 intent，
 * 同 tick 可并行执行：零通勤成本把背包里的滞留能量变成 storage 可分发库存，
 * 半载凑单的长途路上能量不再是死资金。位置触发天然「顺路才卸」，
 * 不顺路自动不发生 — 绝不产生专程往返（半载专程卸货违背满载搬运原则）。
 *
 * 让位守卫（与 work 链 fillStorage 的让位逻辑同口径，防止把本该直送的
 * 能量提前锁仓）：
 *   - 威胁在场：能量应直送 tower（战时 fillStorage 同款让位）；
 *   - 泵断供（本房无存活 distributor）：能量应直送 spawn/extension —
 *     此时锁进 storage 即无人能取，会对冲掉泵断供兜底；
 *   - storage 满：transfer 必然失败，不发无效意图。
 * 恒返回 true — 这是副作用钩子，不拦截正常候选链。
 */
function haulerGate(ac: ActionContext): boolean {
  const creep = ac.creep;
  if (creep.memory.mode !== "acquire") return true;
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return true;
  const st = ac.snapshot.storage;
  if (!st || st.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return true;
  if (creep.pos.getRangeTo(st) > 1) return true;
  if (ac.snapshot.threatCreeps.length > 0) return true;
  const pumpRooms = globalCache().distributorRooms;
  if (pumpRooms && !pumpRooms.has(creep.memory.home ?? creep.room.name)) return true;
  creep.transfer(st, RESOURCE_ENERGY);
  return true;
}

const policy: RolePolicy = {
  park: true,
  gate: haulerGate,
  onFlee: haulerOnFlee,
  acquire: [
    // 0. 排空 storage link — link 物流链的「最后一公里」，永远最先。
    //    storage link 不排空则 source link 背压瘫痪：矿工向 source link
    //    倒能失败转而 drop，地面衰减堆越积越多 — 排水是溢出的止血源头。
    withdrawStorageLink(),
    // 1. 大额遗留能量 — 衰减资源优先原则的执行点，必须在 assignment 之前。
    //    坟墓/废墟/掉落堆都在衰减或限时灭失，container 能量不衰减：
    //    同样一车运力，先救会消失的。任务池只为 container 生成 haul 任务
    //    （任务层看不见地面能量），若 assignment 排在前面，持有任务的 hauler
    //    会被钉死在 container 上 — 线上实测：矿位 2500+ 的溢出堆每 tick 白丢
    //    3 能量，hauler 站在堆旁抽同格 container 的零头。阈值（lootThreshold）
    //    挡住零头，只有值得专程的大额遗留才插队；assignment 租约仍在身上，
    //    捡满卸货后下一趟自然回到任务 container。
    lootRemains(CONFIG.economy.lootThreshold),
    pickupDroppedEnergy(CONFIG.economy.lootThreshold),
    // 1.5 W7 止血（评审修正 P2-1）：无市场时 terminal 死能量回流 storage。
    //    必须排在衰减资源之后 — terminal 能量不衰减，不应抢占坟墓/掉落堆的
    //    抢救窗口；排在 assignment 之前 — 否则任务源命中后本动作永不触发。
    //    有市场时完全惰性 — terminal 能量是交易运费储备，不得挪用。
    withdrawTerminalEnergy(),
    // 2. assignment 指定的 container（任务驱动，定向搬运）。
    withdrawAssignmentContainer(),
    // 3. 回退到最满 container —— 主取能源。
    //    必须排在零头拾取之前：container 满溢时 harvester 会 drop 溢出能量，
    //    若先捡零头 drop（小堆、衰减），hauler 背包没装满就离开去卸货，回来时 harvester 又 drop，
    //    于是「捡零头→半满离开→返回→再捡零头」来回空转，满 container 始终没被抽干（溢出根源未除）。
    //    先抽最满 container：一口装满背包（满载搬运），且抽干 container 即消除溢出根源。
    withdrawRichestCapped(),
    // 4. 零头兜底 —— 残余清理（死亡掉落零头 / container 被毁残留 / 溢出小堆）。
    //    降至最后：仅当无 link / 大额遗留 / assignment / container 可取时才触发。
    lootRemains(1),
    pickupDroppedEnergy(),
    // 注意：hauler 永不从 storage 取能。
    // storage → sink 的分发由 distributor 角色负责。
    // 这从架构上消除了 storage→storage 循环。
  ],

  work: [
    // 矿物优先搬运（高价值资源不应滞留在 container）。
    haulMineralsToStorage(),
    // RCL4+: 优先填充 storage（distributor 从 storage 分发到 spawn/extension）。
    // RCL1-3: 无 storage → predicate=false → fallthrough 到 haulFillTarget。
    // 这修复了 storage 空置死锁：旧顺序 haulFillTarget 在前，spawn 不满时 hauler
    // 永远直送 spawn，storage 永远空，distributor 永远 idle。
    fillStorage(),
    // spawn/extension 紧急回退：storage 满或无 storage 时直送。
    haulFillTarget(),
    // 化合物供料到 lab。
    supplyLabs(),
    // 所有 sink 均满 — 原地待命。
    // hauler 无 WORK 部件，不能升级控制器（upgradeController 会 ERR_NO_BODYPART）。
    // 空闲是正确信号：供给 > 需求，demand 系统会据此减少 hauler 孵化数量。
  ],
};

export const haulerRole = defineRole("hauler", 1 as Priority, policy);
