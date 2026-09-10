/** Power Farm Manager — 多任务并行版。
 * 同时追踪多个 PB 目标，每个任务独立维护编队和状态。
 * 任务数量上限由 CONFIG.powerFarm.maxConcurrentMissions 控制（默认 2）。
 */
import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { EventKind, recordEvent } from "../kernel/event-log";
import {
  isPowerFarmAttritionLost,
  isPowerFarmTimedOut,
  selectPowerBankTarget,
  type PowerBankCandidate,
} from "../domain/war/power-farm";
import { decideHealerCount } from "../domain/war/planning";
import { roomLinearDistance } from "../domain/remote/targeting";
import { queryRoomIntel } from "./intelligence";
import {
  countPendingByMission,
  hasRequest,
  removeRequestsByMission,
  submitRequest,
} from "../domain/spawn/queue";
import { selectBody } from "../config/bodies";
import { querySquad } from "../kernel/global-cache";
import { log } from "../kernel/log";

export const powerFarmManagerSystem: System = {
  name: "power-farm-manager",
  priority: 3 as Priority,
  interval: CONFIG.powerFarm.interval,
  run(ctx: TickContext): void {
    // war 姿态/战争计划存续：军事资源不双线 — 既有任务立即收摊让路。
    const atWar = Memory.kernel?.strategy?.posture === "war" || !!Memory.kernel?.warPlan;
    if (atWar) {
      const missions = Memory.kernel?.powerFarmMissions ?? [];
      for (const m of missions) concludeMission(m, ctx.tick, 3); // war-preempt
      if (Memory.kernel) Memory.kernel.powerFarmMissions = [];
      return;
    }

    let missions = Memory.kernel?.powerFarmMissions ?? [];

    // 开新任务（多任务并行：每轮尝试开新任务直到达到上限或无候选）。
    if (missions.length < (CONFIG.powerFarm.maxConcurrentMissions ?? 2)) {
      startFarmIfWorth(ctx, missions);
      missions = Memory.kernel?.powerFarmMissions ?? [];
    }

    // 逐任务维护。
    const survivorMissions: PowerFarmMission[] = [];
    for (const mission of missions) {
      const alive = maintainMission(ctx, mission);
      if (alive) survivorMissions.push(mission);
    }
    if (Memory.kernel) {
      Memory.kernel.powerFarmMissions = survivorMissions;
    }
  },
};

/** 维护单个 PB 任务。返回 true = 任务继续，false = 已收摊。 */
function maintainMission(ctx: TickContext, mission: PowerFarmMission): boolean {
  const healerCount = decideHealerCount(
    CONFIG.powerFarm.squadSize,
    CONFIG.powerFarm.healerSquadRatio,
  );
  const squadTotal = CONFIG.powerFarm.squadSize + healerCount;

  // 止损：编队损耗超限。
  if (isPowerFarmAttritionLost(mission.spawned, squadTotal, CONFIG.powerFarm.casualtyMultiplier)) {
    concludeMission(mission, ctx.tick, 1); // attrition
    return false;
  }
  // 超时。
  if (isPowerFarmTimedOut(mission.since, ctx.tick, CONFIG.powerFarm.missionTimeout)) {
    concludeMission(mission, ctx.tick, 2); // timeout
    return false;
  }

  // strike 阶段：房内视野自查 PB 存活。
  if (mission.phase === "strike") {
    const targetRoom = Game.rooms[mission.targetRoom];
    if (targetRoom) {
      const pbAlive = targetRoom
        .find(FIND_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_POWER_BANK);
      if (!pbAlive) {
        mission.phase = "collect";
        recordEvent(EventKind.PowerFarmOutcome, mission.targetRoom, [4, mission.spawned]);
        log.info(
          "power-farm-manager",
          `power-farm: ${mission.targetRoom} PB 已消失，转 collect 阶段`,
        );
      }
    }
    if (mission.phase === "strike") {
      maintainSquad(ctx, mission, healerCount);
      return true;
    }
  }

  // collect 阶段：回收战斗编队 + 孵/等 collector。
  recycleSquad(mission.targetRoom);
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (!queue) return false; // sponsor 失守
  const collectorLive = countRoleLive("pbCollector", mission.targetRoom);
  const collectorPending = countPendingByMission(queue, "pbCollector", "powerCollect");
  if (collectorLive + collectorPending === 0) {
    if (mission.collectorSpawnedAt === undefined) {
      submitFarmRequest(queue, mission, "pbCollector", 0, 1300, ctx.tick);
      mission.collectorSpawnedAt = ctx.tick;
      return true;
    }
    if (ctx.tick - mission.collectorSpawnedAt > CONFIG.powerFarm.collectGraceTicks) {
      concludeMission(mission, ctx.tick, 0); // done
      return false;
    }
    return true;
  }
  return true;
}

/** 从各 home 的 intel 采集 PB 候选并择优开任务（避开已有任务的目标房）。 */
function startFarmIfWorth(ctx: TickContext, existingMissions: readonly PowerFarmMission[]): void {
  // 已有任务的目标房集合（不重复开）。
  const activeTargets = new Set(existingMissions.map(m => m.targetRoom));

  // 占用集合：远矿运营/扩张目标房不选。
  const occupied = new Set<string>();
  for (const rn of Object.keys(Memory.rooms)) {
    const ops = Memory.rooms[rn]?.remoteOps;
    if (ops) {
      for (const target of Object.keys(ops)) {
        if (ops[target] && ops[target]!.state !== "abandoned") occupied.add(target);
      }
    }
  }
  const expansionTarget = Memory.kernel?.expansion?.target;
  if (expansionTarget) occupied.add(expansionTarget);

  // sponsor 必须是现存自有房。
  const myRooms = new Set<string>();
  for (const snap of ctx.snapshots()) myRooms.add(snap.roomName);
  if (myRooms.size === 0) return;

  const candidates: PowerBankCandidate[] = [];
  for (const entry of queryRoomIntel()) {
    if (!myRooms.has(entry.observedBy)) continue;
    if (!entry.payload.powerBank) continue;
    if (activeTargets.has(entry.subject)) continue; // 已有任务
    candidates.push({
      roomName: entry.subject,
      home: entry.observedBy,
      lastSeen: entry.observedAt,
      powerBank: true,
      linearDistance: roomLinearDistance(entry.observedBy, entry.subject),
      occupied: occupied.has(entry.subject),
    });
  }

  const target = selectPowerBankTarget(candidates, ctx.tick, {
    freshness: CONFIG.powerFarm.intelFreshness,
    maxRange: CONFIG.powerFarm.maxRange,
  });
  if (!target) return;

  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.powerFarmMissions) Memory.kernel.powerFarmMissions = [];
  const newMission: PowerFarmMission = {
    targetRoom: target.roomName,
    sponsor: target.home,
    since: ctx.tick,
    spawned: 0,
    phase: "strike",
  };
  Memory.kernel.powerFarmMissions.push(newMission);
  recordEvent(EventKind.PowerFarmOutcome, target.roomName, [4, 0]);
  log.info(
    "power-farm-manager",
    `power-farm: 开任务 ${target.home} → ${target.roomName} (dist=${target.linearDistance})`,
  );
}

/** strike 阶段维持编队（attacker + healer，live+pending 编制补位）。 */
function maintainSquad(ctx: TickContext, mission: PowerFarmMission, healerCount: number): void {
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (!queue) return;
  const cap = ctx.getSnapshot(mission.sponsor)?.energyCapacityAvailable ?? 1300;

  let attackerLive = 0;
  let healerLive = 0;
  const squad = querySquad({
    home: mission.sponsor,
    remoteTarget: mission.targetRoom,
    mission: "powerBank",
  });
  for (const e of squad) {
    if (e.role === "attacker") attackerLive++;
    else if (e.role === "healer") healerLive++;
  }
  const pendingAttackers = countPendingByMission(queue, "attacker", "powerBank");
  const pendingHealers = countPendingByMission(queue, "healer", "powerBank");

  if (attackerLive + pendingAttackers < CONFIG.powerFarm.squadSize) {
    submitFarmRequest(queue, mission, "attacker", attackerLive + pendingAttackers, cap, ctx.tick);
  }
  if (healerLive + pendingHealers < healerCount) {
    submitFarmRequest(queue, mission, "healer", healerLive + pendingHealers, cap, ctx.tick);
  }
}

/** PB 任务的孵化请求（稳定 key 幂等；mission 标记分流角色行为）。 */
function submitFarmRequest(
  queue: NonNullable<RoomMemory["spawnQueue"]>,
  mission: PowerFarmMission,
  role: "attacker" | "healer" | "pbCollector",
  index: number,
  cap: number,
  tick: number,
): void {
  const key = `pf-${role}-${mission.sponsor}-${index}-${mission.targetRoom}`;
  if (hasRequest(queue, key)) return;
  if (role !== "pbCollector") {
    mission.spawned = (mission.spawned ?? 0) + 1;
  }
  const body = selectBody(role, cap);
  submitRequest(queue, {
    key,
    role,
    home: mission.sponsor,
    priority: 2,
    body,
    memory: {
      role,
      home: mission.sponsor,
      mode: "acquire",
      spawnIndex: index,
      remoteTarget: mission.targetRoom,
      mission: role === "pbCollector" ? "powerCollect" : "powerBank",
    },
    createdAt: tick,
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  });
}

/** 统计指定角色的存活数（按 remoteTarget 过滤）。 */
function countRoleLive(role: string, targetRoom: string): number {
  return querySquad({ role, remoteTarget: targetRoom }).length;
}

/** 回收指定目标房的战斗编队。 */
function recycleSquad(targetRoom: string): void {
  const squad = querySquad({ remoteTarget: targetRoom, mission: "powerBank" });
  for (const e of squad) {
    if (e.role === "attacker" || e.role === "healer") {
      const creep = Game.creeps[e.name];
      if (creep) creep.memory.recycle = true;
    }
  }
}

/** 收摊（幂等）：回收编队 + 撤销寄宿请求 + 记录事件。
 * reason：0=done / 1=attrition / 2=timeout / 3=war-preempt。 */
function concludeMission(mission: PowerFarmMission, tick: number, reason: number): void {
  recycleSquad(mission.targetRoom);
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (queue) {
    removeRequestsByMission(queue, "powerBank");
    removeRequestsByMission(queue, "powerCollect");
  }
  recordEvent(EventKind.PowerFarmOutcome, mission.targetRoom, [reason, mission.spawned ?? 0]);
  log.info("power-farm-manager", `power-farm: 收摊 ${mission.targetRoom} (reason=${reason})`);
}
