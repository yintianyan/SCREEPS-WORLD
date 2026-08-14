/**
 * RemoteHarvester — P1 远矿采集者。在远矿房采集 source，倒入附近 container（或 drop 落地）。
 * 与本地 harvester 区别：工作在 remoteTarget 房（无 RoomSnapshot）；通过 Game.rooms[remoteTarget]
 * 直接发现 source（首次 find 后缓存 sourceId）；倒能优先 container，无则 drop（避免采满停滞）。
 * 架构约束：ensureHome 已适配 remoteTarget，本角色常驻 remoteTarget 房间。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";

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
    if (source) return source;
    // source 消失（如 SK 房 source 被占领），清除缓存。
    creep.memory.sourceId = undefined;
  }

  // 首次或缓存失效：从当前房间 find source。
  const room = creep.room;
  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) return undefined;
  if (sources.length === 1) {
    creep.memory.sourceId = sources[0]!.id;
    return sources[0]!;
  }

  // 统计兄弟 remoteHarvester（同房同 target）已绑各 source 的占用数。
  // P2-O：原 Object.values(Game.creeps) 全帝国遍历，多远矿房时累积 O(M) 成本；收窄到
  // room.find(FIND_MY_CREEPS) — occupancy 统计仅在 sourceId 未缓存（首次/失效）时执行，
  // 此时 creep 已在 target 房，本房兄弟即全部相关占用源。行为差异：过路房兄弟已绑时旧实现
  // 会计入、新实现不会 — 罕见场景（缓存失效+过路房兄弟已绑+同时到达）可能短暂选同一 source，
  // 下一 tick 自愈（对方绑定后重新统计）。性能收益覆盖此边缘情况。
  const target = creep.memory.remoteTarget;
  const occupancy = new Map<Id<Source>, number>();
  for (const other of creep.room.find(FIND_MY_CREEPS)) {
    if (other.name === creep.name) continue;
    if (other.memory.role !== "remoteHarvester") continue;
    if (other.memory.remoteTarget !== target) continue;
    const sid = other.memory.sourceId as Id<Source> | undefined;
    if (sid) occupancy.set(sid, (occupancy.get(sid) ?? 0) + 1);
  }

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

/**
 * 查找 source 旁的 container（range<=1）。
 * P2 优化：缓存 containerId 到 memory.sourceContainerId，避免每 tick 调 lookForAtArea
 * （0.05-0.1 CPU/次）。失效条件：container 被摧毁（getObjectById 返回 null）。
 */
function findSourceContainer(creep: Creep, source: Source): StructureContainer | undefined {
  // 优先使用缓存的 containerId。
  if (creep.memory.sourceContainerId) {
    const cached = getObjectById(creep.memory.sourceContainerId as Id<StructureContainer>);
    if (cached) {
      // 验证仍在 source 旁（防御性：container 可能被回收后在别处重建）。
      if (cached.pos.getRangeTo(source.pos) <= 1) return cached;
    }
    // 缓存失效 — 清除并重新扫描。
    creep.memory.sourceContainerId = undefined;
  }

  // 首次或缓存失效：lookForAtArea 扫描 source 周围 3x3 区域。
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
      // 缓存 containerId，后续 tick 直接用 getObjectById 取回。
      creep.memory.sourceContainerId = container.id as Id<StructureContainer>;
      return container;
    }
  }
  return undefined;
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
      return source;
    },
    execute: (ac, source) => {
      const harvestResult = ac.creep.harvest(source);
      if (harvestResult === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
        return;
      }
      // 同 tick 倒能：背包有能量且旁边有 container 时倒入。
      if (ac.creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const container = findSourceContainer(ac.creep, source);
        if (container) {
          const freeCap = container.store.getFreeCapacity(RESOURCE_ENERGY);
          if (freeCap > 0) {
            ac.creep.transfer(container, RESOURCE_ENERGY);
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
    resolve: (ac) => getRemoteSource(ac.creep),
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
 * 架构约束（plan.md §5.5）：角色层禁止调 createConstructionSite — site 创建的单一写者。
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

const policy: RolePolicy = {
  acquire: [
    // 站桩采集 + 同 tick 倒能（到达矿位后）。
    remoteStationaryMine(),
    // 移动到 source 并采集（通勤中）。
    remoteHarvestSource(),
  ],
  work: [
    // RM-1：满载且无 container → 自建（必须在 stationaryMine 之前 —
    // stationaryMine 的 resolve 只查在位与否，满载时会继续采集溢出）。
    buildSourceContainer(),
    // 站桩采集 + 同 tick 倒能（work 模式也继续采）。
    remoteStationaryMine(),
    // 采满无处倒 → drop 释放产能。
    dropEnergy(),
  ],
};

export const remoteHarvesterRole = defineRole("remoteHarvester", 1 as Priority, policy);
