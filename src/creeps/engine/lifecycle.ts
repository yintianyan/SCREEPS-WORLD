import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { moveTowardRoom, recordTraffic, findSafestExit } from "../movement";
import { releaseFromTask } from "../support/assignment-adapter";

/** 根据能量存储更新 creep 模式。仅在阈值跨越时写入。 */
export function updateMode(creep: Creep): void {
  const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const mode = creep.memory.mode ?? "acquire";

  if (mode === "acquire" && free === 0) {
    creep.memory.mode = "work";
  } else if (mode === "work" && used === 0) {
    creep.memory.mode = "acquire";
  } else if (mode === "idle" || mode === "flee") {
    // idle/flee 恢复：有能量时转 work 去消耗，空载时转 acquire 去采集。
    // 修复：原实现缺少 idle 和 flee 分支导致 creep 一旦进入这些模式就永久卡死。
    // flee 场景：敌人离开后 shouldFlee 返回 false，但 mode 仍为 flee，需要恢复。
    creep.memory.mode = used > 0 ? "work" : "acquire";
  } else if (!creep.memory.mode) {
    creep.memory.mode = used > 0 ? "work" : "acquire";
  }
}

/**
 * 检查 creep 是否应逃跑（P1-1：距离分级）。
 * 仅当威胁 creep 在 fleeRange 范围内时才触发逃跑。
 * 远端过境的威胁（如 scout / reserver 穿越房间边缘）不会中断经济。
 */
export function shouldFlee(creep: Creep, snapshot: RoomSnapshot): boolean {
  if (snapshot.threatCreeps.length === 0) return false;
  const range = CONFIG.defense.fleeRange;
  return snapshot.threatCreeps.some(t => creep.pos.getRangeTo(t.pos) <= range);
}

// ─── 远矿角色威胁检测 ──────────────────────────────────────

/**
 * 获取指定房间的 hostile creep 列表（per-tick per-room 缓存）。
 * 用于远矿角色在无 snapshot 的房间（远矿房 / 过境中间房）检测威胁。
 * 缓存生命周期：单 tick，globalCache 自动重置。
 */
function getRoomThreats(roomName: string): Creep[] {
  const g = globalCache() as any;
  if (!g.__remoteThreats) g.__remoteThreats = {};
  if (g.__remoteThreats[roomName]?.tick === Game.time) {
    return g.__remoteThreats[roomName].creeps as Creep[];
  }
  const room = Game.rooms[roomName];
  if (!room) return [];
  const hostiles = room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) => {
      // 联盟白名单过滤。
      const allies = CONFIG.defense.allies;
      return !allies.includes(c.owner.username);
    },
  });
  // 过滤出真正有威胁的 creep（有攻击部件）。
  const threats = hostiles.filter(c =>
    c.body.some(p =>
      p.type === ATTACK || p.type === RANGED_ATTACK ||
      p.type === HEAL || p.type === WORK || p.type === CLAIM,
    ),
  );
  g.__remoteThreats[roomName] = { tick: Game.time, creeps: threats };
  return threats;
}

/**
 * 远矿角色威胁检测 — 在任意「非 home 房」检查当前房间的敌人。
 *
 * 覆盖范围（修复 transit 盲区）：
 *   - 在 remoteTarget 房间作业时
 *   - 在 home ↔ remoteTarget 之间的过境中间房通勤时
 * 旧实现仅在 creep.room.name === remoteTarget 时检测，导致过境中间房遇袭不逃跑。
 *
 * 仅对设置了 remoteTarget 的远矿角色生效；本地角色由 shouldFlee（home snapshot）处理。
 * 与 shouldFlee 的区别：直接从 Game.rooms 扫描当前房（远矿房/中间房均无 snapshot）。
 */
export function shouldFleeForeignRoom(creep: Creep): boolean {
  if (!creep.memory.remoteTarget) return false;
  const home = creep.memory.home;
  // 在 home 房时由 shouldFlee（home snapshot）处理，此处只负责外部房间。
  if (home && creep.room.name === home) return false;
  const threats = getRoomThreats(creep.room.name);
  if (threats.length === 0) return false;
  const range = CONFIG.defense.fleeRange;
  return threats.some(t => creep.pos.getRangeTo(t.pos) <= range);
}

/**
 * 远矿角色逃跑 — 向 home 方向移动（无 snapshot 可用，简化路径）。
 * 释放 assignment（如有），然后直接 moveTowardRoom 到 home。
 * 不使用 flee() 中的 spawn/exit 逻辑 — 远矿房/中间房无 snapshot，
 * 且最快逃生路径是回到 home 房的塔防范围。
 */
export function fleeToHome(creep: Creep): void {
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }
  const home = creep.memory.home;
  if (home && creep.room.name !== home) {
    moveTowardRoom(creep, home);
  }
}

/**
 * 逃跑到安全位置 — 遵循约束 G-DF-02/03/09。
 * 策略分三级：
 *   1) spawn 比最近敌人更近时走向 spawn（塔防范围内）
 *   2) spawn 不可达时，走向敌人反向出口（避免冲向敌人）
 *   3) 无安全出口时走向任意最远出口
 * flee 期间释放普通 assignment（G-SM-05），仅移动不执行经济动作。
 *
 * P0-2 修复：hauler 已到达安全位置（距 spawn ≤ safeRefuelRange）时，
 * 允许执行"防御圈内安全充能"——向最近的需能量结构（tower 优先）转移能量。
 * 这细化了 G-SM-05 的语义：移动阶段不动作（防被击杀），到达安全区后允许关键补给。
 * 解决战斗中 Tower 能量耗尽、hauler 全部 flee 导致无人补给的防御死局。
 */
export function flee(creep: Creep, snapshot: RoomSnapshot): void {
  // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  const nearestHostile = creep.pos.findClosestByRange(snapshot.threatCreeps as Creep[]) ?? undefined;

  // ── P0-2 修复：hauler 已到达安全位置时执行防御圈内充能 ──
  // 仅当 hauler 携带能量且已在 spawn 防御圈内时触发。
  // 目标也必须在防御圈内，且不在敌人侧（避免 hauler 向敌人移动）。
  if (
    creep.memory.role === "hauler" &&
    creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
    trySafeRefuel(creep, snapshot, nearestHostile)
  ) {
    return;
  }

  // 策略 1：spawn 比最近敌人更近时走向 spawn（spawn 在安全侧、塔防范围内）。
  if (snapshot.spawns.length > 0 && nearestHostile) {
    const spawn = snapshot.spawns[0]!;
    const creepToSpawn = creep.pos.getRangeTo(spawn);
    const hostileToSpawn = nearestHostile.pos.getRangeTo(spawn);
    if (creepToSpawn < hostileToSpawn) {
      if (creepToSpawn > 3) {
        // G-DF-04: flee 期间使用 ignoreCreeps: false 以绕过阻挡。
        const result = creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
        if (result === OK || result === ERR_TIRED) recordTraffic(creep);
      }
      return;
    }
  }

  // 策略 2/3：spawn 不安全或不可达 — 走向敌人反向出口。
  if (nearestHostile) {
    const safeExit = findSafestExit(creep, nearestHostile.pos);
    if (safeExit) {
      const result = creep.moveTo(safeExit, { reusePath: 5, ignoreCreeps: false });
      if (result === OK || result === ERR_TIRED) recordTraffic(creep);
      return;
    }
  }

  // G-DF-03：已在 home 但 spawn 不安全且无安全出口时 —
  // 优先走向敌人反向出口（上面已尝试）；无出口时至少向 spawn 移动（比站着好）。
  const home = creep.memory.home;
  if (home && creep.room.name !== home) {
    moveTowardRoom(creep, home);
    return;
  }
  if (snapshot.spawns.length > 0) {
    const spawn = snapshot.spawns[0];
    if (spawn && creep.pos.getRangeTo(spawn) > 3) {
      const result = creep.moveTo(spawn, { reusePath: 5, ignoreCreeps: false });
      if (result === OK || result === ERR_TIRED) recordTraffic(creep);
    }
  }
}

/**
 * Hauler 在 flee 状态下的"防御圈内安全充能"尝试。
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
 */
function trySafeRefuel(
  creep: Creep,
  snapshot: RoomSnapshot,
  nearestHostile: Creep | undefined,
): boolean {
  if (snapshot.spawns.length === 0) return false;
  if (snapshot.fillTargets.length === 0) return false;

  const spawn = snapshot.spawns[0]!;
  const safeRange = CONFIG.defense.safeRefuelRange;

  // hauler 必须已在 spawn 安全区内
  if (creep.pos.getRangeTo(spawn.pos) > safeRange) return false;

  // 找最近的需能量结构（优先级与 getHaulFillTarget 对齐）
  const target = findClosestRefuelTarget(creep, snapshot, spawn.pos, safeRange);
  if (!target) return false;

  // 安全检查：目标不能在敌人侧（目标距敌人 < hauler 距敌人 = 向敌人移动）
  if (nearestHostile) {
    const hostileToTarget = nearestHostile.pos.getRangeTo(target.pos);
    const creepToHostile = creep.pos.getRangeTo(nearestHostile.pos);
    if (hostileToTarget < creepToHostile) return false;
  }

  const dist = creep.pos.getRangeTo(target.pos);
  if (dist <= 1) {
    // fillTargets 类型为 StructureSpawn | StructureExtension | StructureTower | StructureContainer，
    // 均支持 transfer；用 AnyStructure 断言以匹配 creep.transfer 的目标签名。
    creep.transfer(target as unknown as AnyStructure, RESOURCE_ENERGY);
    return true;
  }

  // 移动到目标（仍在防御圈内）
  creep.moveTo(target, { reusePath: 5, ignoreCreeps: false });
  return true;
}

/**
 * 在 spawn 安全区内找最近的需能量结构。
 * 优先级与 getHaulFillTarget 对齐：threat 存在时 tower 优先，
 * 否则 spawn/extension 优先。结构必须在 spawn 的 safeRange 范围内。
 */
function findClosestRefuelTarget(
  creep: Creep,
  snapshot: RoomSnapshot,
  spawnPos: RoomPosition,
  safeRange: number,
): StructureSpawn | StructureExtension | StructureTower | StructureContainer | undefined {
  const hasThreats = snapshot.threatCreeps.length > 0;
  // 优先级分组：threat 时 [tower] → [spawn/extension] → [其余]；
  // 无 threat 时 [spawn/extension] → [tower] → [其余]。
  const typeBuckets: readonly string[][] = hasThreats
    ? [[STRUCTURE_TOWER], [STRUCTURE_SPAWN, STRUCTURE_EXTENSION], []]
    : [[STRUCTURE_SPAWN, STRUCTURE_EXTENSION], [STRUCTURE_TOWER], []];

  for (const types of typeBuckets) {
    let best: StructureSpawn | StructureExtension | StructureTower | StructureContainer | undefined;
    let bestDist = Infinity;
    for (const t of snapshot.fillTargets) {
      if (types.length > 0 && !types.includes(t.structureType)) continue;
      if (t.pos.getRangeTo(spawnPos) > safeRange) continue;
      const d = creep.pos.getRangeTo(t.pos);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best) return best;
  }
  return undefined;
}
