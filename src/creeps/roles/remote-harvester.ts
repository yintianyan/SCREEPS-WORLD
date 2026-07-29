/**
 * RemoteHarvester — P1 远矿采集者。
 *
 * 职责：在远矿房采集 source，将能量倒入附近 container（或 drop 在地上）。
 * 与本地 harvester 的区别：
 *   - 工作在 remoteTarget 房间（无 RoomSnapshot）
 *   - 通过 Game.rooms[remoteTarget] 直接发现 source（首次 find 后缓存 sourceId）
 *   - 倒能优先 container，无 container 时 drop（避免采满停滞）
 *
 * 策略声明：
 *   acquire: 远矿 source 采集（站桩 + 倒能）
 *   work:    倒入 container > drop（采满无处倒时释放产能）
 *
 * 架构约束：ensureHome 已适配 remoteTarget，本角色常驻 remoteTarget 房间。
 */
import type { Priority } from "../../kernel/contracts";
import type { ActionCandidate, RolePolicy } from "../engine/action-types";
import { defineRole } from "../engine/role-runner";
import { moveToTarget } from "../movement";
import { getObjectById } from "../support/obj-cache";

/**
 * 获取远矿 source — 从缓存的 sourceId 或占用感知分配。
 * 首次进入远矿房时执行一次 room.find，之后复用 sourceId。
 *
 * 占用感知（E-1 修复）：远矿房无 RoomSnapshot/sourceOccupancy，改为扫描同房
 * 同 target 的兄弟 remoteHarvester 已绑 sourceId 统计占用。原实现单纯选最近 +
 * 入房位置偏置 → 2-source 房两只 harvester 挤同一 source，第二源白白再生浪费。
 * 现选占用最少的 source；平局用名哈希决定遍历起点（同 creep 每 tick 稳定、
 * 不抖动），把多只稳定散布到不同 source。
 *
 * 导出仅供接线测试验证占用分散行为。
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
  const target = creep.memory.remoteTarget;
  const occupancy = new Map<Id<Source>, number>();
  for (const other of Object.values(Game.creeps)) {
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
 * 查找 source 旁的 container（range <= 1）。
 *
 * P2 优化：缓存 containerId 到 creep.memory.sourceContainerId，
 * 避免每 tick 调用 lookForAtArea（0.05-0.1 CPU/次）。
 * 缓存失效条件：container 被摧毁（getObjectById 返回 null）。
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
      // 采集。
      const harvestResult = ac.creep.harvest(source);
      if (harvestResult === ERR_NOT_IN_RANGE) {
        moveToTarget(ac.creep, source);
        return;
      }
      // 同 tick 倒能：如果背包有能量且旁边有 container，倒入 container。
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
  | { kind: "create" };

/**
 * RM-1：满载时自建 source container — 终结 drop-mining 衰减税。
 *
 * 线上实测（W37S57）：无 container 的 active 远矿房地面堆积 3300+ 能量，
 * 稳态衰减 ~4/tick ≈ 单源产出的 40% — 远超「补建造链」决策阈值（5%）。
 *
 * 行为：满载 + 站桩位 + 无 container 时，把背包能量投入建造而非溢出：
 *   有 container site → build（5 energy/WORK/tick 转化为进度，零衰减）；
 *   无 site → 在脚下创建（站桩位即 container 位）。
 * 建成后 findSourceContainer 缓存接手，倒能路径与 hauler 的 container
 * withdraw 链自然激活。
 *
 * 架构注记：construction-manager 的「唯一 site 创建者」约束针对自有房
 * 布局管线（它只遍历自有房快照，远矿房不在管辖域）— 本 action 是远矿
 * source container 的唯一豁免点，不做任何其他类型的 site。
 */
function buildSourceContainer(): ActionCandidate<ContainerBuildTarget> {
  return {
    name: "remote-harvest:build-container",
    resolve: (ac) => {
      // 仅满载时投入建造 — 半载继续采集（建造用的是必然溢出的能量）。
      if (ac.creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return undefined;
      // 建 site 失败冷却（100 site 全局上限 / 位置冲突等持久失败）：
      // 冷却期内放行后续候选（dropEnergy）— 否则本候选每 tick 命中、
      // execute 静默失败、候选链终止，creep 满载永久停摆（比 drop 更差）。
      const cooldown = ac.creep.memory.containerSiteCooldown;
      if (cooldown !== undefined && Game.time < cooldown) return undefined;
      const source = getRemoteSource(ac.creep);
      if (!source || ac.creep.pos.getRangeTo(source) > 1) return undefined;
      if (findSourceContainer(ac.creep, source)) return undefined;
      // 已有 container site → 建造它。
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
      // 无 site → 在脚下创建（resolve 禁止游戏 API 副作用，交给 execute）。
      return { kind: "create" as const };
    },
    execute: (ac, target) => {
      if (target.kind === "build") {
        ac.creep.build(target.site);
      } else {
        const result = ac.creep.room.createConstructionSite(ac.creep.pos, STRUCTURE_CONTAINER);
        if (result !== OK) {
          // 持久失败（ERR_FULL 全局 site 上限 / ERR_INVALID_TARGET 占位冲突）：
          // 写冷却让 resolve 放行 dropEnergy，100 tick 后重试。
          ac.creep.memory.containerSiteCooldown = Game.time + 100;
        }
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
