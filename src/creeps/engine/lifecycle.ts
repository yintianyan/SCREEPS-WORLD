import type { RoomSnapshot } from "../../kernel/contracts";
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

/** 检查 creep 是否应逃跑（有威胁单位且非战斗单位）。 */
export function shouldFlee(snapshot: RoomSnapshot): boolean {
  return snapshot.threatCreeps.length > 0;
}

/**
 * 逃跑到安全位置 — 遵循约束 G-DF-02/03/09。
 * 策略分三级：
 *   1) spawn 比最近敌人更近时走向 spawn（塔防范围内）
 *   2) spawn 不可达时，走向敌人反向出口（避免冲向敌人）
 *   3) 无安全出口时走向任意最远出口
 * flee 期间释放普通 assignment（G-SM-05），仅移动不执行经济动作。
 */
export function flee(creep: Creep, snapshot: RoomSnapshot): void {
  // G-SM-05: flee 期间释放普通 assignment，仅移动到安全位置。
  if (creep.memory.assignment) {
    releaseFromTask(creep);
    creep.memory.assignment = undefined;
  }

  const nearestHostile = creep.pos.findClosestByRange(snapshot.threatCreeps as Creep[]);

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
