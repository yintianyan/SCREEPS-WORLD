import type { RoomSnapshot } from "../../kernel/contracts";
import { CONFIG } from "../../config";
import { globalCache } from "../../kernel/global-cache";
import { moveTowardRoom, stepToward, findSafestExit, moveToTarget, registerAnchor } from "../movement";
import { releaseFromTask } from "../support/assignment-adapter";
import { classifyThreats } from "../../domain/defense/threat";

/** 根据背包存储更新 creep 模式。仅在阈值跨越时写入。 */
export function updateMode(creep: Creep): void {
  // 总量口径（不限 RESOURCE_ENERGY）：满/空判断须计入矿物等非能量资源，
  // 否则满背包矿物的 creep（如 mineralMiner）被误判"空载"而永久冻结（线上实证）。
  // 注意：携非能量 cargo 的角色（distributor 卸 lab 化合物、hauler loot 矿物）在总量口径下
  // 会保持 work 直到卸空 —— 其 fill 动作必须在 resolve 前置"携非能量则放行后续候选卸货"门禁
  // （见 fill.ts distributorFillTarget/haulFillTarget），否则转能量静默失败终止候选链。
  const used = creep.store.getUsedCapacity();
  const free = creep.store.getFreeCapacity();
  const mode = creep.memory.mode ?? "acquire";

  if (mode === "acquire" && free === 0) {
    creep.memory.mode = "work";
  } else if (mode === "work" && used === 0) {
    creep.memory.mode = "acquire";
  } else if (mode === "idle" || mode === "flee") {
    // idle/flee 恢复：有货转 work 去消耗，空载转 acquire 去采集。
    // 修复：原实现缺 idle/flee 分支，进入后永久卡死（flee 场景：敌人离开后需恢复）。
    creep.memory.mode = used > 0 ? "work" : "acquire";
  } else if (!creep.memory.mode) {
    creep.memory.mode = used > 0 ? "work" : "acquire";
  }
}

/** P1-1 距离分级：仅当威胁在 fleeRange 范围内才触发逃跑，远端过境威胁不中断经济。 */
export function shouldFlee(creep: Creep, snapshot: RoomSnapshot): boolean {
  if (snapshot.threatCreeps.length === 0) return false;
  const range = CONFIG.defense.fleeRange;
  return snapshot.threatCreeps.some(t => creep.pos.getRangeTo(t.pos) <= range);
}

// ─── 远矿角色威胁检测 ───

/**
 * 获取指定房间的 hostile creep 列表（per-tick per-room 缓存，globalCache 自动重置）。
 * 用于远矿角色在无 snapshot 的房间（远矿房/过境中间房）检测威胁。
 */
function getRoomThreats(roomName: string): Creep[] {
  const g = globalCache() as any;
  if (!g.__remoteThreats) g.__remoteThreats = {};
  if (g.__remoteThreats[roomName]?.tick === Game.time) {
    return g.__remoteThreats[roomName].creeps as Creep[];
  }
  const room = Game.rooms[roomName];
  if (!room) return [];
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  // body-aware 威胁判定 — 与远矿 manager 的 collectRemoteThreats 共用同一
  // classifyThreats（同一 THREAT_PARTS），消除"两个威胁探测器口径分裂"（F-2）。
  const threats = classifyThreats(hostiles, CONFIG.defense.allies);
  g.__remoteThreats[roomName] = { tick: Game.time, creeps: threats };
  return threats;
}

/**
 * 远矿角色威胁检测 — 在任意「非 home 房」检查当前房敌人（修复 transit 盲区：旧实现仅在
 * remoteTarget 房检测，过境中间房遇袭不逃跑）。仅对设置 remoteTarget 的角色生效；
 * 本地角色由 shouldFlee（home snapshot）处理。与 shouldFlee 的区别：直接从 Game.rooms 扫当前房。
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
 * 远矿角色逃跑 — 释放 assignment 后直接 moveTowardRoom 回 home。
 * 不使用 flee() 的 spawn/exit 逻辑：远矿房/中间房无 snapshot，最快逃生路径是回 home 塔防范围。
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
 * 战时集结避险（M11）— 小队威胁在场时非战斗 creep 撤入核心锚点（storage 优先，无则 spawn）
 * shelterRadius 圈内：圈内即塔火力覆盖，敌人追进来吃满塔伤，不追则收割失败。
 * rampart 掩体：已站自家 rampart 格则原地锚定，不主动找空 rampart 格（核心区 rampart 几乎
 * 都叠在不可站立的建筑格上，逐格 lookFor 是徒劳 CPU）。无核心设施退回通用 flee；
 * mode 置 flee — 威胁清除后 updateMode 既有分支自动恢复工作状态。
 */
export function shelterAtCore(creep: Creep, snapshot: RoomSnapshot): void {
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }
  const anchor = snapshot.storage ?? snapshot.spawns[0];
  if (!anchor) {
    flee(creep, snapshot);
    return;
  }
  const radius = CONFIG.defense.shelterRadius;
  if (creep.pos.getRangeTo(anchor.pos) <= radius) {
    // 已在集结圈内 — 锚定站位（防被过路 creep 推出塔火力圈）。
    registerAnchor(creep, CONFIG.movement.trafficPriority.anchorStation);
    return;
  }
  moveToTarget(creep, anchor, radius);
}

/**
 * 逃跑到安全位置 — 遵循约束 G-DF-02/03/09。三级策略：
 *   1) spawn 比最近敌人更近时走向 spawn（塔防范围内）
 *   2) spawn 不可达时走向敌人反向出口（避免冲向敌人）
 *   3) 无安全出口时走向任意最远出口
 * flee 期间释放普通 assignment（G-SM-05），仅移动不执行经济动作。
 * P0-2 修复：haul 的"防御圈内安全充能"已移入 RolePolicy.onFlee 钩子，
 * flee() 只负责通用移动逻辑，不感知任何具体角色。
 */
export function flee(creep: Creep, snapshot: RoomSnapshot): void {
  // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  const nearestHostile = creep.pos.findClosestByRange(snapshot.threatCreeps as Creep[]) ?? undefined;

  // 策略 1：spawn 比最近敌人更近时走向 spawn（spawn 在安全侧、塔防范围内）。
  if (snapshot.spawns.length > 0 && nearestHostile) {
    const spawn = snapshot.spawns[0]!;
    const creepToSpawn = creep.pos.getRangeTo(spawn);
    const hostileToSpawn = nearestHostile.pos.getRangeTo(spawn);
    if (creepToSpawn < hostileToSpawn) {
      if (creepToSpawn > 3) {
        // G-DF-04: flee 期间绕过阻挡（stepToward 双模出口：traffic 关闭时
        // 即 moveTo(ignoreCreeps:false)；开启时 flee 优先级在解算中最高）。
        stepToward(creep, spawn);
      }
      return;
    }
  }

  // 策略 2/3：spawn 不安全或不可达 — 走向敌人反向出口。
  if (nearestHostile) {
    const safeExit = findSafestExit(creep, nearestHostile.pos);
    if (safeExit) {
      stepToward(creep, safeExit);
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
      stepToward(creep, spawn);
    }
  }
}
