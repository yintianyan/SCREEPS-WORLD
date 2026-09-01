/** RemoteHarvester */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { CONFIG } from "../../config";
import { moveToTarget, registerAnchor, registerStaticBlocker } from "../movement";
import { getObjectById } from "../support/obj-cache";
import { findSourcesCached, findMyCreepsCached } from "../support/room-scans";

/** 改绑阈值：连续 stuck 达到此值时重评绑定（stuckThreshold=2/repathLimit=2 →
 * L3 在 stuck≥4 重置，此值取 3 = 每个 L3 周期恰好在重置前查一次，零额外节流）。 */
const REBIND_STUCK_TICKS = 3;

/** 改绑冷却（tick）：防 A↔B 改绑振荡。 */
const REBIND_COOLDOWN_TICKS = 200;

/** container 维修触发血量比例 — 与本地 repairContainerDecay/repairNearbyContainer 同口径 0.8。 */
const CONTAINER_REPAIR_THRESHOLD = 0.8;

/**
 * 获取远矿 source — 从缓存 sourceId 或占用感知分配。首次入房执行一次 find，之后复用 sourceId。
 * 占用感知（E-1 修复）：远矿房无 RoomSnapshot/sourceOccupancy，改为统计同房同 target 的兄弟
 * remoteHarvester 已绑 sourceId。原实现单纯选最近 + 入房位置偏置 → 2-source 房两只挤同一
 * source，第二源白白再生浪费。现选占用最少者；平局用名哈希决定遍历起点（每 tick 稳定不抖动），
 * 把多只稳定散布到不同 source。导出仅供接线测试验证占用分散行为。
 */
export function getRemoteSource(creep: Creep): Source | undefined {
  // 优先使用缓存的 sourceId。
  if (creep.memory.sourceId) {
    const source = getObjectById(creep.memory.sourceId);
    if (source) {
      // 在位工作或未到改绑阈值 → 稳定复用缓存（不每 tick 重评）。
      if (
        creep.pos.getRangeTo(source) <= 1 ||
        (creep.memory.stuckTicks ?? 0) < REBIND_STUCK_TICKS
      ) {
        return source;
      }
      // 锁死改绑自愈：长期够不到自己的 source（矿位被占/被封，stuck 连续累积）
      // 时重评占用 — 房内存在无主 source 则改绑，终结「两人挤一源、另一源空缺」
      // （线上实证：W36S58 采集者矿位被占锁死 + W37S57 双源只配一只的变体）。
      // 自限：改绑后新 source 即被自身占用；下次重评时原 source 由兄弟占着、
      // 无空缺 → 不会来回振荡。
      const rebound = rebindToVacantSource(creep, source);
      if (rebound) return rebound;
      return source;
    }
    // source 消失（如 SK 房 source 被占领），清除缓存。
    creep.memory.sourceId = undefined;
  }

  return bindInitialSource(creep);
}

/**
 * 统计兄弟 remoteHarvester（同房同 target）对各 source 的占用数。
 * 已绑 sourceId 计绑定；未绑定的按物理站位计（range<=1 即实际站桩占用）—
 * 兜底同 tick 首绑竞态（两只同时入房、都还没写缓存时，站桩者已可见）。
 * P2-O：occupancy 统计仅在 sourceId 未缓存（首次/失效/改绑）时执行，
 * 且收窄到 findMyCreepsCached（此时 creep 已在 target 房）。
 */
function countSiblingOccupancy(
  creep: Creep,
  sources: readonly Source[],
): Map<Id<Source>, number> {
  const target = creep.memory.remoteTarget;
  const occupancy = new Map<Id<Source>, number>();
  for (const other of findMyCreepsCached(creep.room)) {
    if (other.name === creep.name) continue;
    if (other.memory.role !== "remoteHarvester") continue;
    if (other.memory.remoteTarget !== target) continue;
    const sid = other.memory.sourceId as Id<Source> | undefined;
    if (sid) {
      occupancy.set(sid, (occupancy.get(sid) ?? 0) + 1);
      continue;
    }
    for (const s of sources) {
      if (other.pos.getRangeTo(s.pos) <= 1) {
        occupancy.set(s.id, (occupancy.get(s.id) ?? 0) + 1);
        break;
      }
    }
  }
  return occupancy;
}

/** 首次绑定（或缓存失效）：占用最少者优先，平局用名哈希稳定散布。 */
function bindInitialSource(creep: Creep): Source | undefined {
  const room = creep.room;
  const sources = findSourcesCached(room);
  if (sources.length === 0) return undefined;
  if (sources.length === 1) {
    creep.memory.sourceId = sources[0]!.id;
    return sources[0]!;
  }

  const occupancy = countSiblingOccupancy(creep, sources);

  // 名哈希决定遍历起点：占用平局时稳定散布到不同 source。
  let nameHash = 0;
  for (let i = 0; i < creep.name.length; i++) {
    nameHash = (nameHash * 31 + creep.name.charCodeAt(i)) | 0;
  }
  const offset = Math.abs(nameHash) % sources.length;
  let best = sources[offset]!;
  let bestCount = occupancy.get(best.id) ?? 0;
  for (let i = 1; i < sources.length; i++) {
    const s = sources[(offset + i) % sources.length]!;
    const count = occupancy.get(s.id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = s;
    }
  }
  creep.memory.sourceId = best.id;
  return best;
}

/** 锁死改绑：房内存在无兄弟占用的 source 时改绑过去；无空缺返回 undefined。 */
function rebindToVacantSource(creep: Creep, current: Source): Source | undefined {
  const sources = findSourcesCached(creep.room);
  if (sources.length <= 1) return undefined;
  // 改绑冷却：改绑后原 source 即变「空缺」，无冷却会下一轮改回去 → A↔B 振荡。
  // 200 tick（约 4 个编队工作周期）足够验证新源是否可作业；新源也不可达时
  // 至少把振荡周期压到 200 tick，配合 op 级空转止损兜底。
  const last = creep.memory.lastRebindAt ?? 0;
  if (Game.time - last < REBIND_COOLDOWN_TICKS) return undefined;
  const occupancy = countSiblingOccupancy(creep, sources);
  let best: Source | undefined;
  let bestDist = Infinity;
  for (const s of sources) {
    if (s.id === current.id) continue;
    if ((occupancy.get(s.id) ?? 0) > 0) continue;
    const dist = creep.pos.getRangeTo(s.pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  if (best) {
    creep.memory.sourceId = best.id;
    creep.memory.lastRebindAt = Game.time;
    return best;
  }
  return undefined;
}

/** 容器扫描冷却 tick 数 — container 不常变，缓存失效时也无需每 tick 扫描。 */
const CONTAINER_RESCAN_INTERVAL = 10;

/**
 * 查找 source 旁的 container（range<=1）。
 * 缓存 containerId 到 memory.sourceContainerId，避免每 tick 调 lookForAtArea。
 * 缓存命中时直接 getObjectById 返回，零 lookForAtArea 开销。
 * 缓存失效（container 被摧毁）时降频重扫，避免每 tick lookForAtArea。
 */
function findSourceContainer(creep: Creep, source: Source): StructureContainer | undefined {
  // 优先使用缓存的 containerId。
  if (creep.memory.sourceContainerId) {
    const cached = getObjectById(creep.memory.sourceContainerId as Id<StructureContainer>);
    if (cached) {
      if (cached.pos.getRangeTo(source.pos) <= 1) return cached;
    }
    // 缓存失效 — container 被摧毁或移位。
    creep.memory.sourceContainerId = undefined;
    // 降频重扫：仅在跨 tick 缓存失效时降频（用 lastContainerScanTick 区分
    // 同 tick 内首次找到但 getObjectById 不认 vs 跨 tick 的 container 摧毁）。
    // 同 tick 内（lastContainerScanTick === Game.time）不降频，直接重扫。
    if (creep.memory.lastContainerScanTick !== undefined &&
        creep.memory.lastContainerScanTick !== Game.time) {
      const phase = (Game.time + hashName(creep.name)) % CONTAINER_RESCAN_INTERVAL;
      if (phase !== 0) return undefined;
    }
  }

  // 首次查找或降频窗口到达：lookForAtArea 扫描 source 周围 3x3 区域。
  creep.memory.lastContainerScanTick = Game.time;
  const structures = creep.room.lookForAtArea(
    LOOK_STRUCTURES,
    Math.max(0, source.pos.y - 1),
    Math.max(0, source.pos.x - 1),
    Math.min(49, source.pos.y + 1),
    Math.min(49, source.pos.x + 1),
    true,
  );
  for (const entry of structures) {
    if (entry.structure.structureType === STRUCTURE_CONTAINER) {
      const container = entry.structure as StructureContainer;
      creep.memory.sourceContainerId = container.id as Id<StructureContainer>;
      return container;
    }
  }
  return undefined;
}

/** 轻量名哈希 — 用于相位偏移分散扫描。 */
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 远矿采集 + 站桩倒能。 */
function remoteStationaryMine(): ActionCandidate<Source> {
  return {
    name: "remote-harvest:stationary-mine",
    resolve: (ac) => {
      const source = getRemoteSource(ac.creep);
      if (!source) return undefined;
      // 检查是否在采集范围内。
      if (ac.creep.pos.getRangeTo(source) > 1) return undefined;
      // 满载且旁边没有 container 可倒 → 让位给后续候选（work 链的 dropEnergy）。
      // 无此门禁：work 链在 stationaryMine 截停（其 resolve 无条件匹配在位者），
      // harvest 返 ERR_FULL、dropEnergy 永远轮不到 → 满载永久停摆、零产出
      // （集成场景 400 tick 实证 + 线上 W36S58 满载空转同机制）。有 container 时
      // 仍走本候选（同 tick 倒能，吞吐最高）；有 site 时 buildSourceContainer
      // 排在前面先行匹配，本门禁不影响 RM-1 自建路径。
      if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        if (!findSourceContainer(ac.creep, source)) return undefined;
      }
      return source;
    },
    execute: (ac, source) => {
      // 在矿位 → 锚定 + 静态占位自报（与本地 harvester 的 anchorMiner 同口径）。
      // 外房无 RoomSnapshot，站桩占位无法预载 — 角色自报后，兄弟采集者/搬运工的
      // 寻路矩阵才看得见这里有人，绕到其他矿位而不是逐 tick 意图撞被占格、
      // 被解算器拒绝后空转锁死（线上实证：W36S58 采集者被占位挤死）。
      // anchorMiner(90) 仅低于 flee(100)：逃命可推挤站桩矿工，工作/空载均不可。
      registerAnchor(ac.creep, CONFIG.movement.trafficPriority.anchorMiner);
      registerStaticBlocker(ac.creep.room.name, ac.creep.pos);
      const harvestResult = ac.creep.harvest(source);
      if (harvestResult === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
        return;
      }
      // 站位修正：harvest 返回 OK 说明在 source range 1 内，但可能不在 container 格上 —
      // 如 source 旁有多格可站，creep 落在非 container 格，能采但 transfer 够不到 container
      // → 能量无法倒入 → 满载后走 dropEnergy → 地面堆积衰减（线上实证：远矿产能损失 ~40%）。
      // 镜像本地 harvester 的 stationaryMine container 站位逻辑（harvest.ts L109-111）：
      // move 与 harvest 是独立 intent，移动期间继续采集，零吞吐损失。
      const container = findSourceContainer(ac.creep, source);
      if (container && !ac.creep.pos.isEqualTo(container.pos)) {
        moveToTarget(ac.creep, container.pos, 0);
      }
      // 同 tick 倒能：背包有能量且旁边有 container 时倒入。
      // 维修期留税：container 血量低于维修线时每 tick 留 WORK 数能量不倒 —
      // 若全额倒空，下 tick repair 门禁（背包有料）在「采 N 倒 N」稳态下
      // 永远不满足（resolve 时刻背包恒空），维修链死锁（集成场景实证：
      // 600 tick 零维修、container 单调衰减）。留税让节拍变为
      // 「采 N 倒 N-W、修 W」交替，维修与采集并行不断流。
      if (container && ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const freeCap = container.store.getFreeCapacity(RESOURCE_ENERGY);
        if (freeCap > 0) {
          const workParts = ac.creep.body.filter((p) => p.type === WORK).length;
          const reserve = container.hits < container.hitsMax * CONTAINER_REPAIR_THRESHOLD
            ? workParts
            : 0;
          const amount = ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) - reserve;
          if (amount > 0) {
            ac.creep.transfer(container, RESOURCE_ENERGY, amount);
          }
        }
      }
    },
  };
}

/** 移动到 source 并采集（未到达站桩位时）。 */
function remoteHarvestSource(): ActionCandidate<Source> {
  return {
    name: "remote-harvest:move-and-mine",
    resolve: (ac) => {
      const source = getRemoteSource(ac.creep);
      if (!source) return undefined;
      // range≤1 时让位：acquire 链由前置 stationaryMine 接管；work 链必须
      // 让位给 dropEnergy（否则满载在位者被本候选截停，harvest 徒劳
      // ERR_FULL，drop 永远轮不到 — 满载停摆在另一候选重演）。
      if (ac.creep.pos.getRangeTo(source) <= 1) return undefined;
      return source;
    },
    execute: (ac, source) => {
      const result = ac.creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
      } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
        ac.creep.memory.mode = "idle";
      }
    },
  };
}

/** dropEnergy 的 resolve 返回类型。 */
type DropEnergyTarget =
  | { type: "transfer"; container: StructureContainer }
  | { type: "drop" };

/** 采满且无 container 时 drop 能量（避免产能停滞）。 */
function dropEnergy(): ActionCandidate<DropEnergyTarget> {
  return {
    name: "remote-harvest:drop",
    resolve: (ac) => {
      if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return undefined;
      // 检查旁边是否有 container 可倒入。
      const source = getRemoteSource(ac.creep);
      if (source) {
        const container = findSourceContainer(ac.creep, source);
        if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          return { type: "transfer" as const, container };
        }
      }
      // 无 container 或 container 满 → drop
      return { type: "drop" as const };
    },
    execute: (ac, resolved) => {
      if (resolved.type === "transfer") {
        ac.creep.transfer(resolved.container, RESOURCE_ENERGY);
      } else {
        ac.creep.drop(RESOURCE_ENERGY);
      }
    },
  };
}

/** buildSourceContainer 的 resolve 返回类型。 */
type ContainerBuildTarget =
  | { kind: "build"; site: ConstructionSite }
  | { kind: "request" };

/**
 * RM-1：满载时自建 source container — 终结 drop-mining 衰减税。
 * 线上实测（W37S57）：无 container 的 active 远矿房地面堆积 3300+ 能量，稳态衰减 ~4/tick
 * ≈ 单源产出的 40% — 远超「补建造链」决策阈值（5%）。
 * P0-A 收编后行为（site 创建权从角色层收归 remote-mining-manager）：有 site → build（5
 * energy/WORK/tick 转进度，零衰减）；无 site → 写 needContainer=true 申请标记，由 manager 每
 * managerInterval tick 消费（创建 site / 失败写冷却）；申请期间走 dropEnergy 释放产能（最多等
 * 10 tick），避免满载停摆。建成后 findSourceContainer 缓存接手，hauler 倒能链自然激活。
 * 架构约束（docs/architecture/CONSTRUCTION_ARCHITECTURE.md）：角色层禁止调 createConstructionSite — site 创建的单一写者。
 */
function buildSourceContainer(): ActionCandidate<ContainerBuildTarget> {
  return {
    name: "remote-harvest:build-container",
    resolve: (ac) => {
      // 仅满载时投入建造 — 半载继续采集（建造用的是必然溢出的能量）。
      if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return undefined;
      const source = getRemoteSource(ac.creep);
      if (!source || ac.creep.pos.getRangeTo(source) > 1) return undefined;
      if (findSourceContainer(ac.creep, source)) return undefined;
      // 已有 container site → 优先建造（cooldown 不阻断 build 路径 —
      // 即使上一次申请失败在冷却期，已有 site 照常投入建造）。
      const sites = ac.creep.room.lookForAtArea(
        LOOK_CONSTRUCTION_SITES,
        Math.max(0, source.pos.y - 1),
        Math.max(0, source.pos.x - 1),
        Math.min(49, source.pos.y + 1),
        Math.min(49, source.pos.x + 1),
        true,
      );
      for (const entry of sites) {
        if (entry.constructionSite.structureType === STRUCTURE_CONTAINER) {
          return { kind: "build" as const, site: entry.constructionSite };
        }
      }
      // 无 site。建 site 失败冷却（ERR_FULL / 位置冲突等持久失败）：冷却期内放行后续候选
      // （dropEnergy）— 否则本候选每 tick 命中、申请无意义重复、候选链终止，满载永久停摆。
      const cooldown = ac.creep.memory.containerSiteCooldown;
      if (cooldown !== undefined && Game.time < cooldown) return undefined;
      // 已申请但 manager 尚未处理 → 等待（跳到 dropEnergy 释放产能）。
      if (ac.creep.memory.needContainer) return undefined;
      // 无 site、无冷却、无在途申请 → 发起申请（resolve 禁止游戏 API 副作用）。
      return { kind: "request" as const };
    },
    execute: (ac, target) => {
      if (target.kind === "build") {
        ac.creep.build(target.site);
      } else {
        // 写申请标记，由 remote-mining-manager 消费（创建 site 或写冷却）。
        // sourceId 已存于 creep.memory.sourceId，manager 据此定位建 site 位置。
        ac.creep.memory.needContainer = true;
      }
    },
  };
}

/**
 * RM-2：维修衰减中的 source container — 远矿房无 builder/tower 兜底，
 * 采集者是 container 唯一的维护者（hauler/reserver 均无 WORK 部件）。
 * container 摧毁 = 远矿产能归零直到 P0-A 全链重启（申请→建站→建造），
 * 而维修税极低：衰减 1 hit/tick，1 energy 修 100 hits/WORK — 5 WORK body
 * 每 ~37500 tick 仅需 75 tick 维修期，约占产能 0.1%。
 * 与本地 harvester 的「倒能后余量才修」原则不同：本地有 builder+tower 兜底
 * 才敢等余量，远矿采集者独行 — 血量 < 80% 且背包有能量即修。
 * 必须同时挂 acquire/work 两链：采集者稳态是「采 N 倒 N」背包近空，FSM
 * 长期停在 acquire（集成场景 600 tick 实证：work 链的维修零触发、container
 * 单调衰减到摧毁）— 只挂 work 链则维修窗口仅剩「container 满 + 背包满」
 * 的偶发交集，等价于永不维修。链序在 stationaryMine 之前同理：stationaryMine
 * 命中即短路，置后永远轮不到；置前把维修 tick 按需插入采集流（背包空让位
 * 回采，半载先修后采 — resolve 门禁已保证采集优先回补）。
 */
function repairSourceContainer(): ActionCandidate<StructureContainer> {
  return {
    name: "remote-harvest:repair-container",
    resolve: (ac) => {
      // 背包空 → 让位采集链（维修无料，采集优先回补）。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return undefined;
      const source = getRemoteSource(ac.creep);
      if (!source) return undefined;
      const container = findSourceContainer(ac.creep, source);
      if (!container) return undefined;
      // 超出维修射程 → 让位归位链（move-and-mine 负责移动，不在此追修）。
      if (ac.creep.pos.getRangeTo(container.pos) > 3) return undefined;
      return container.hits < container.hitsMax * CONTAINER_REPAIR_THRESHOLD
        ? container
        : undefined;
    },
    execute: (ac, container) => {
      if (ac.creep.repair(container) === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, container);
      }
    },
  };
}

const policy: RolePolicy = {
  acquire: [
    // RM-2：维修衰减中的 source container（采集者稳态近空载、FSM 长期
    // acquire — 维修必须在本链可达，详见函数注释）。
    repairSourceContainer(),
    // 站桩采集 + 同 tick 倒能（到达矿位后）。
    remoteStationaryMine(),
    // 移动到 source 并采集（通勤中）。
    remoteHarvestSource(),
  ],
  work: [
    // RM-1：满载且无 container → 自建（必须在 stationaryMine 之前 —
    // stationaryMine 的 resolve 只查在位与否，满载时会继续采集溢出）。
    buildSourceContainer(),
    // RM-2：维修衰减中的 source container（远矿无 builder/tower 兜底，
    // 采集者是唯一维护者；详见函数注释）。
    repairSourceContainer(),
    // 站桩采集 + 同 tick 倒能（work 模式也继续采）。
    remoteStationaryMine(),
    // 移动到 source 并采集（带能但被挤离矿位时归位）— 线上实证：采集者
    // 被占位挤到 range 2 且携带能量时，work 链原三候选全部 resolve 失败
    // → 「无匹配候选 → idle + park」，既不满载（dropEnergy 不触发）又永不
    // 空载（acquire 链轮不到）→ 永久趴窝。补此候选后归位并恢复采集。
    remoteHarvestSource(),
    // 采满无处倒 → drop 释放产能。
    dropEnergy(),
  ],
};

export const remoteHarvesterRole = defineRole("remoteHarvester", 1 as Priority, policy);
