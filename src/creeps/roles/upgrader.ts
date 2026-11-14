/** Upgrader */
import { CONFIG } from "../../config";
import {
  brakeGateSum,
  isUpgradeReserveActive,
  upgradeBrakeAllows,
  upgradeBrakeFloor,
} from "../../domain/economy/accounting";
import { resolveControllerDowngradeRisk } from "../../domain/economy/downgrade-risk";
import { gclPushBand } from "../../domain/economy/links";
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, ActionContext, RolePolicy } from "../engine/action-types";
import {
  harvestSource,
  pickupNearbyDroppedEnergy,
  stationaryUpgrade,
  upgradeController,
  withdrawControllerContainer,
  withdrawControllerLink,
  withdrawRichestContainerEarly,
  withdrawRichestNonSourceContainer,
  withdrawStorageCapped,
} from "../engine/actions";
import { defineRole } from "../engine/role-runner";
import { moveToTarget, registerAnchor } from "../movement";

/** upgrader 视为「已在站桩位」的最大距离（controller container/controller 周边）。 */
const STATION_RANGE = 3;

/**
 * 空闲归站 — 不在站桩位附近时移动过去待命。

 * 根因：acquire 链全部落空（controller container 存在但空、无 link、storage
 * 低水位、gate 拦截直采）时，role-runner 置 idle 且 upgrader 被 parking 排除
 * （parking.ts 明文豁免站桩角色）→ 刚孵化的 upgrader 石化在 spawn 出口挡路。
 * 「站桩角色的 idle 是守在 controller 旁」这个前提只有 creep 已经在站桩位才成立。

 * 该动作作为 acquire 链兜底：已在站桩位 → resolve undefined（正常 idle 等补给）；
 * 不在 → 移动过去。到位后 hauler 一填 container 立即取能开工，零通勤延迟。
 */
function moveToStation(): ActionCandidate<
  StructureContainer | StructureController | StructureLink
> {
  return {
    name: "move:controller-station",
    resolve: ac => resolveStationAnchor(ac),
    execute: (ac, anchor) => {
      moveToTarget(ac.creep, anchor);
    },
  };
}

/** 解析站桩锚点；已在站桩位或无锚点时返回 undefined。 */
function resolveStationAnchor(
  ac: ActionContext,
): StructureContainer | StructureController | StructureLink | undefined {
  const ctrl = ac.snapshot.controller;
  // 站桩锚点真相源（优先级）：controller link > controller container > controller 本体。
  //   - controller link 优先：link 网络瞬移供能、无 hauler 依赖，是最优站桩取能位；
  //     归站到 link range1 后（若 ≤3 到 controller），stationaryUpgrade 的 link 分支
  //     直接接管，消除旧实现"归站奔 container、贴 link 靠 withdraw 走位副作用"的绕路。
  //   - 无 link 则 controller container（真正的取能位），再无则 controller 本体。
  const ctrlLink = ctrl?.my
    ? ac.snapshot.links.find(l => l.pos.getRangeTo(ctrl.pos) <= 2)
    : undefined;
  const anchor = ctrlLink ?? ac.snapshot.controllerContainer ?? (ctrl?.my ? ctrl : undefined);
  if (!anchor) return undefined;
  if (ac.creep.pos.getRangeTo(anchor.pos) <= STATION_RANGE) {
    // 已在站桩位（含等补给的 idle 期）— 登记交通锚，防被过路 creep 推离取能位。
    // 幂等副作用：本 tick 若又登记了移动意图，解算器以意图为准。
    registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
    return undefined;
  }
  return anchor;
}

/** gate 拦截路径的归站副作用 — 不在站桩位时移动过去（与 builderGate 的副作用先例一致）。 */
function nudgeToStation(ac: ActionContext): void {
  const anchor = resolveStationAnchor(ac);
  if (anchor) moveToTarget(ac.creep, anchor);
}

/**
 * 降级风险判据统一走 `resolveControllerDowngradeRisk()`（与 room-state 的迟滞带同一把尺）。
 * 本角色原先自判原始阈值（ttd<10000），与状态机的「10000 进 / 15000 出」互锁成两根钟 ——
 * 现场经过与规则见该函数所在模块 `domain/economy/downgrade-risk.ts`。
 */
function downgradeRisk(ac: ActionContext): boolean {
  return resolveControllerDowngradeRisk(
    Memory.rooms[ac.snapshot.roomName]?.controllerDowngradeRisk,
    ac.snapshot.controller,
  );
}

/**
 * RCL8 冲 GCL 的容量比例富线判定（纯函数便于单测）：
 * 富线（总容量 × gclPushStartRatio）以上才开冲，取带与 link 供能共用 gclPushBand；
 * 降级风险（保级优先）或背包已载能（烧完再停，防抱能死亡掉落）豁免。
 */
export function rcl8GclPushAllowed(
  storageEnergy: number,
  downgradeRisk: boolean,
  carryingEnergy: boolean,
): boolean {
  if (downgradeRisk || carryingEnergy) return true;
  return gclPushBand(storageEnergy) === "push";
}

/**
 * 能量地板门禁 — 仅阻止 acquire 模式取能，不阻止已满载的 upgrader 交付。
 * 降级风险时豁免；风险判据走 `downgradeRisk()`。

 * 关键修复：门禁只在 upgrader 需要直接采集时才阻止。
 * 如果 controller container / 任何 container 有能量，upgrader 不与 spawn 竞争，
 * 不应被 energyAvailable 地板阻止。
 */
/**
 * R688：扩张推进房的 CPU 升级闸。满仓时强制放行 —— storage 已无处可放，
 * 停升级只会把盈余白扔；升级器本来已存活，工作只增加动作开销。
 * 未满仓时维持 R632 原语义：tier 差于 comfortable（tight/constrained）就停。
 */
export function cpuGateAllowsUpgrade(tier: string | undefined, storageNearFull: boolean): boolean {
  if (storageNearFull) return true;
  return tier !== "tight" && tier !== "constrained";
}

function upgraderGate(ac: ActionContext): boolean {
  const isEmergency = downgradeRisk(ac);

  if (isEmergency) return true; // 紧急：不阻止

  // claim-secure 护栏：脆弱新房（RCL<4 且 controller 临近降级）保级压倒一切 ——
  // 放宽取能地板，让 upgrader 即使在 energyAvailable 偏低时也能喂 controller
  // （新房无 storage，能量结构紧张，builder 抢能量致 controller 降级风险，W38S59 实证）。
  // trade-off：spawn 孵化可能短暂让位，但 controller 降级（进度清零 + 重建成本）
  // 远大于短暂孵化延迟。RCL4+ 房间无此标记（claimSecure 仅在 RCL<4 置位）。
  const claimSecure = Memory.rooms[ac.snapshot.roomName]?.claimSecure ?? false;
  if (claimSecure) return true;

  // Phase 2.5：低储回血期暂停升级（闩锁 false = storage 曾跌破 50K 且未回到恢复线）。
  // Phase D：改读升级专用闸（恢复线 60K），不再被 lab/修墙的更高门槛拖住。
  // 已背着能量的个体先烧完再停 —— 能量已从 storage 取出，不升级只会随死亡掉落；
  // 空仓者直接 idle 归站，不再从 storage/container/link 取新能量。
  const upgradeLatch =
    Memory.rooms[ac.snapshot.roomName]?.upgradeActive ??
    Memory.rooms[ac.snapshot.roomName]?.storageRichActive;
  if (upgradeLatch === false && ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    nudgeToStation(ac);
    return false;
  }

  // R594 帝国失血闸 → R617 限定版扩张预留 → 本轮（剔资本支出）：
  // 全帝国 `brakeNetFlow` 之和为负时暂停升级。它与 `gateNetFlow` 只差一项 ——
  // 建造（`economy.cx`）不再记成失血，因为本闸唯一能掐的执行器是升级，
  // 把计划性投资算进"失血"只会让刹车对真 driver 无能为力
  // （线上实测：闸全程关死、升级支出 0，Σ 仍从 −8.6 深到 −28.4，控制器冻 27,624 拍）。
  // **仅当**本房 RCL≥7 且存在扩张推进态计划时，把刹车抬到 `upgradeReserveNetFlow`（5），
  // 把盈余留给扩张门 G4。早期房/无计划/终态计划保持原语义（0），避免 RCL 冲刺被压掉。
  const sumGate = brakeGateSum(Memory.kernel?.brakeNetFlow, Memory.kernel?.gateNetFlow);
  // 生效判定与门槛计算都在 accounting 里（签发车道与恢复臂共用同一对函数）。
  const expansionPush = isUpgradeReserveActive(ac.snapshot.rcl, Memory.kernel?.expansionPlans);
  const gateFloor = upgradeBrakeFloor(expansionPush, CONFIG.economy.upgradeReserveNetFlow);
  // 早期房（RCL1-3 无 storage）的负净流就是"在建自己"：需求侧已按 earlyRoom 放行，
  // 角色闸若再按帝国净流掐断，只会白付一只空转的升级器并把控制器冻在低 RCL。
  const earlyRoom = ac.snapshot.storage === undefined && ac.snapshot.rcl < 4;
  // 2026-11-08：storage 富余（≥ sprintStorage）时豁免净流失血闸。
  // 设计上这就是「烧库存换 RCL」的冲刺期：升级 80/tick 必然把净流压负，闸按 EMA
  // 关闭后净流回升又打开 —— 极限环把 progress 切成 0.2–8/tick 的碎拍（W8N3 实测：
  // 两只满能量 upgrader 停在 controller link 旁，160 tick progress 0）。
  // storage 90 万时停升级只是把能量留在仓库，不产生任何复利。
  // store 读取在 mock/边缘状态下可能抛异常（P0-4 有专门的降级用例）：
  // 读不到就按「非富余」处理，回落到原净流闸，不把异常冒泡成整只 creep 崩溃。
  let storageEnergy = 0;
  try {
    storageEnergy = ac.snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  } catch {
    storageEnergy = 0;
  }
  // Phase 2.5：与 demand 同一把闩锁；背着能量的个体在闩锁关闭时仍按「富余」放行，
  // 让它把已取出的能量烧完（否则会 idle 抱能，死亡时整包掉落）。
  // Phase D：优先读升级专用闸 upgradeActive。
  const storageLatch =
    Memory.rooms[ac.snapshot.roomName]?.upgradeActive ??
    Memory.rooms[ac.snapshot.roomName]?.storageRichActive;
  const richStorage =
    ac.snapshot.storage !== undefined &&
    (storageLatch === undefined
      ? storageEnergy >= CONFIG.economy.upgrade.sprintStorage
      : storageLatch || ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
  if (
    !earlyRoom &&
    !richStorage &&
    !upgradeBrakeAllows(sumGate, gateFloor, Memory.kernel?.upgradeBrake)
  ) {
    return false;
  }
  // R632：扩张推进态且 CPU 无余量（tier 差于 comfortable）时，连“净流够”的升级也停。
  // 升级是可选的 CPU 消费者，而 G6 正是扩张门；花 CPU 升级会把门自己顶死（与 R626 同构）。
  // R688：满仓时例外——storage 已无处可放，停升级只会把盈余白扔；升级器本来已存活，
  // 让它们工作只增加动作开销，不会让 G6 从“有解”变成“无解”。
  if (expansionPush) {
    const storageNearFull = Memory.rooms[ac.snapshot.roomName]?.storageNearFull === true;
    if (!cpuGateAllowsUpgrade(Memory.kernel?.capacity?.tier, storageNearFull)) return false;
  }

  // RCL8 满级：关闭 GCL 升级时停烧（存量 idle，不取能不升级，demand 停孵，自然老死）；
  // 背包残余能量随 creep 死亡掉落地面，hauler 回收 — 可接受的损耗。
  // 开启 gclUpgrade 后继续工作：RCL8 的 upgrade 计入 GCL 进度。
  // 降级风险（isEmergency）时上面已放行保级。
  if (ac.snapshot.rcl >= 8 && !CONFIG.economy.upgrade.gclUpgrade) return false;

  // RCL8 冲 GCL 容量比例富线：storage < gclPushStart(50% 容量) 不冲 —
  // RCL8 的 upgrade 只产出账号级 GCL（奢侈品），必须让位给 PB 任务/war/boost
  // 的储备需求（私服实测：绝对刻度 50K 只有容量 2%，storage 被抽穿警戒线）。
  // 背包已载能的个体放行烧完（同闩锁豁免口径）；降级风险豁免（保级优先）。
  if (ac.snapshot.rcl >= 8 && CONFIG.economy.upgrade.gclUpgrade) {
    if (
      !rcl8GclPushAllowed(
        storageEnergy,
        downgradeRisk(ac),
        ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      )
    ) {
      nudgeToStation(ac);
      return false;
    }
  }

  // 仅阻止 acquire 模式。
  if (ac.creep.memory.mode !== "acquire") return true;

  // 如果有替代能量源（非 source container / link 有能量），upgrader 不与 spawn 竞争，放行。
  // P0-3：仅检查非 source container — upgrader 不再从 source container 取能，
  // 若只有 source container 有能量，upgrader 会落到 harvestSource 与 spawn 竞争。
  // 注意：storage 不在此列 — storage 低于 floor 时正是要保护它不被 upgrader 抽干。
  const hasNonSourceContainerEnergy = ac.snapshot.containers.some(
    c =>
      c.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
      !ac.snapshot.sources.some(s => c.pos.getRangeTo(s.pos) <= 1),
  );
  const hasLinkEnergy = ac.snapshot.links.some(l => l.store.getUsedCapacity(RESOURCE_ENERGY) > 0);
  if (hasNonSourceContainerEnergy || hasLinkEnergy) return true;

  // 无替代能量源 — upgrader 只能直接采集，此时用能量地板门禁防止与孵化竞争。
  const hasStorage = ac.snapshot.storage !== undefined;
  const belowFloor =
    ac.snapshot.rcl >= 4 && hasStorage
      ? // 复用上面 try 读取的 storageEnergy：store 读取异常时按 0 处理（降级到地板以下），
        // 不让 gate 抛异常。原实现在这里直接读 store，richStorage 豁免把执行路径带到这里后
        // 会把 P0-4 的「store read throws」降级用例打成未捕获异常。
        storageEnergy < CONFIG.economy.upgradeEnergyFloorStorage
      : ac.snapshot.energyAvailable <
        Math.min(
          CONFIG.economy.upgradeEnergyFloor,
          Math.floor(ac.snapshot.energyCapacityAvailable * 0.4),
        );

  if (belowFloor) {
    // 门禁拦截前先归站：gate 返回 false 会直接 idle（不走 acquire 链的归站兜底），
    // 刚孵化的 upgrader 会石化在 spawn 出口挡路。移动到站桩位再 idle —
    // 能量恢复后零通勤开工，等待期间也不占用核心区交通格。
    nudgeToStation(ac);
    return false;
  }
  return true;
}

/**
 * 动态计算 storage 取能上限 — 水位权限表（绝对能量刻度）+ P0-4 净流出率门禁。

 * U-2 修复：原比例制三档（>50%/>15% 折合 50 万/15 万能量）在发展期房间
 * 永远落在最低档 — 与 distributorTiers 的历史教训同型（比例刻度系统性错误）。
 * 现改用与 distributorTiers/upgrade 调度同一参照系的绝对阈值：
 *   ≥ sprintStorage(50k)：carry 满载（库存盈余快速消化）
 *   ≥ sustainedStorage(10k)：perTickWithdrawLimit(500)
 *   ≥ upgradeEnergyFloorStorage(1k)：200（低水位节流）
 *   <  upgradeEnergyFloorStorage(1k)：0 — U-1 floor 下沉：
 *      withdrawStorageCapped 的 resolve 对 limit≤0 返回 undefined（D-0 同手法），
 *      彻底封死「gate 因 container 有能量放行 → storage 被抽穿地板」的旁路。

 * P0-4 修复（病灶 4）：srcRatio=1.0 期 storage 从 374K→0 持续流失 12 E/tick，
 * 旧逻辑只看绝对水位 → upgrader 抽到归零。新增跨 tick 净流出率门禁：
 *   - 复用 P0-1 写入的 roomMem.phase.storageEnergyPrev（room-state 每 tick 写入）。
 *   - 双门槛：低水位（< sustainedStorage*2）+ 流失（> drainRateLimit）→ 返回 0 停止取能。
 *     高水位期允许流失（盈余消化），低水位期流失即停抽让 storage 回血。
 *   - 降级风险豁免：`downgradeRisk()`（room-state 迟滞带）为真时跳过门禁（保级优先于止血）。
 *   - storage.store 读取异常防御：try/catch 退化为返回 0，role-runner 不感知。
 */
function dynamicStorageLimit(ac: ActionContext): number {
  const st = ac.snapshot.storage;
  if (!st) return CONFIG.economy.upgrade.perTickWithdrawLimit;
  const cfg = CONFIG.economy;

  // 防御：storage.store 读取异常（不应发生但 defensive）→ 退化为不取能，不抛错。
  // role-runner 的 candidate resolve 无 try/catch，此处不兜底会冒泡到 kernel safeRun，
  // 表现为 upgrader 整 tick 跳过 — 不如显式返回 0 让 withdrawStorageCapped fallthrough。
  let energy: number;
  try {
    energy = st.store.getUsedCapacity(RESOURCE_ENERGY);
  } catch {
    return 0;
  }

  if (energy < cfg.upgradeEnergyFloorStorage) return 0;

  // P0-4 异常豁免：降级风险时保级优先，跳过流失率门禁。
  // 判据与 upgraderGate 同一个函数 —— 两处若各用一把尺，会出现
  // "gate 放行取能、水位却按无风险节流"的带内自相矛盾。
  const hasDowngradeRisk = downgradeRisk(ac);
  // Phase 2.5：低储回血期不再从 storage 抽能（保级风险豁免）。
  // Phase D：跟随升级专用闸 upgradeActive。
  const withdrawLatch =
    Memory.rooms[ac.snapshot.roomName]?.upgradeActive ??
    Memory.rooms[ac.snapshot.roomName]?.storageRichActive;
  if (!hasDowngradeRisk && withdrawLatch === false) {
    return 0;
  }
  if (!hasDowngradeRisk) {
    // P0-4：storage 净流出率检查 — 跨 tick 跟踪
    // 复用 P0-1 写入的 roomMem.phase.storageEnergyPrev（room-state 每 tick 写入）。
    // 首次运行（prev 缺失）→ ?? energy 兜底 → drainRate=0，避免假流失。
    const roomMem = Memory.rooms[ac.snapshot.roomName];
    const prevEnergy = roomMem?.phase?.storageEnergyPrev ?? energy;
    const drainRate = prevEnergy - energy; // 正值 = 流失

    // 双门槛：低水位（< sustainedStorage*2）+ 流失（> drainRateLimit，严格大于）。
    // 边界语义：drainRate===drainRateLimit 不触发（> 才触发）；energy===sustainedStorage*2 不触发（< 才触发）。
    const lowWater = energy < cfg.upgrade.sustainedStorage * 2;
    const draining = drainRate > cfg.upgrade.drainRateLimit;
    if (lowWater && draining) {
      return 0; // 停止取能，让 storage 回血
    }
  }

  if (energy >= cfg.upgrade.sprintStorage) return ac.creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (energy >= cfg.upgrade.sustainedStorage) return cfg.upgrade.perTickWithdrawLimit;
  return 200;
}

/**
 * 升级动作的锚定包装 — 站桩升级中（range≤3 免通勤）登记交通锚，
 * 防止被过路 creep 从取能位/升级位推开；仍需通勤时不锚（移动意图优先）。
 */
function upgradeAnchored(): ActionCandidate<StructureController> {
  const inner = upgradeController();
  return {
    name: inner.name,
    resolve: inner.resolve,
    execute: (ac, ctrl) => {
      if (ac.creep.pos.getRangeTo(ctrl.pos) <= STATION_RANGE) {
        registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorStation);
      }
      inner.execute(ac, ctrl);
    },
  };
}

const policy: RolePolicy = {
  gate: upgraderGate,
  // R649：年轻房（RCL<4）recovery/bootstrap 下仍升级 —— 这是脱离危机的唯一路径。
  recoveryEligibleYoungRoom: true,
  executionOrder: 3,

  acquire: [
    // 0. 站桩同 tick 取+升 — 贴 controller link 且够到 controller 时，withdraw+upgrade
    //    同 tick 执行，让 WORK 满效（消除小 CARRY 的取能空耗 tick）。镜像 stationaryMine，
    //    同置 acquire[0]/work[0] 绕开单链限制；不满足条件回退下方常规取能链。
    stationaryUpgrade(),
    // 1. 拾取身边的掉落能量（range<=2，不离开站桩位）。
    pickupNearbyDroppedEnergy(2),
    // 2. controller 旁 link（0 通勤，link 瞬移供能）。
    withdrawControllerLink(),
    // 3. controller 旁 container（0 通勤）。
    withdrawControllerContainer(),
    // 4. storage（动态限量取能 — 按 storage 水位缩放，防止突降触发 economyPressure 连锁降级）。
    // P1-1: 高水位(>50%)时放开到 carry 满载；低水位(<15%)时收紧到 200，中间用固定值。
    withdrawStorageCapped(dynamicStorageLimit),
    // 5. 最满非物流 container（不抢 hauler 的物流源）。
    withdrawRichestNonSourceContainer(),
    // 5b. R647：RCL<4 且无 controller 容器/link/storage 可用时，允许从 source container 取能。
    //     成熟房返回 undefined，不改变物流分工。
    withdrawRichestContainerEarly(),
    // 6. 兜底：所有 container 无能量时直接采集。
    harvestSource(),
    // 7. 归站兜底：取能全部落空（container 空、source 占满等）时移动到
    //    controller 站桩位待命，而不是石化在 spawn 出口挡路。
    moveToStation(),
  ],

  work: [
    // 站桩同 tick 取+升优先（与 acquire[0] 同）；不满足条件回退常规升级（含通勤）。
    stationaryUpgrade(),
    upgradeAnchored(),
  ],

  // 2026-11-08：upgrader 不参与 idle-cadence。默认 idle creep 每 5 tick 才运行一次，
  // 而 upgrader 的 idle 往往是「link 暂时空了」的瞬态 —— 被节流后吞吐直接 1/5，
  // 实测两只满能量停在 controller 旁却只有 ~8 progress/tick（理论 80）。
  noIdleCadence: true,
};

export const upgraderRole = defineRole("upgrader", 2 as Priority, policy);
