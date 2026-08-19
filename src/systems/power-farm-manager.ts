/**
 * Power Farm Manager — P3 系统，PB 野采任务的唯一决策者（审计缺口 2）。
 *
 * 战略定位：power 是 GPL 硬通货 — 野采是市场买入之外的正收益供给源
 * （买 power 纯消耗 credit，野采只花编队折旧）。复用 war 编队基础设施
 * （attacker/healer body、spawn 队列、recycle 通道），编队 creep 经
 * memory.mission="powerBank" 分流（不集结直接推进 + 专用 PB 攻击候选 —
 * PB 是 FIND_STRUCTURES 中立结构，attacker 的 hostile 链打不到）。
 *
 * 任务生命周期（Memory.kernel.powerFarm，唯一写者）：
 *   无任务 → 扫描 intel（新鲜 powerBank=true + 距离内 + 未占用）→ 建任务
 *     （war 姿态/战争计划存续时冻结 — 军事资源不双线，既有任务立即收摊让路）；
 *   strike → 维持编队（squadSize attacker + ratio healer）；
 *     编队到达后房内视野自查 PB 存活：PB 消失（击破/自灭）→ phase=collect；
 *   collect → 回收战斗编队 + 孵 pbCollector 捡运掉落 power；
 *     collector 消失（捡完送回/阵亡）且宽限期内未复现 → 收摊清任务。
 *
 * 队列纪律：寄宿请求撤销走 queue.ts API（removeRequestsByMission 按
 * mission 标记过滤 — attacker/healer 与 war 编队共用角色名）。
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
import {
  countPendingByMission,
  hasRequest,
  removeRequestsByMission,
  submitRequest,
} from "../domain/spawn/queue";
import { selectBody } from "../config/bodies";
import { querySquad } from "../kernel/global-cache";

export const powerFarmManagerSystem: System = {
  name: "power-farm-manager",
  priority: 3 as Priority,
  interval: CONFIG.powerFarm.interval,
  run(ctx: TickContext): void {
    // war 姿态/战争计划存续：军事资源不双线 — 既有任务立即收摊让路。
    const atWar = Memory.kernel?.strategy?.posture === "war" || !!Memory.kernel?.warPlan;
    if (atWar) {
      if (Memory.kernel?.powerFarm) concludeFarm(ctx.tick, 3); // war-preempt
      return;
    }

    let mission = Memory.kernel?.powerFarm;
    if (!mission) {
      // 开任务当轮即进入 strike 维护（不留空窗 — PB 生命周期按 tick 计）。
      startFarmIfWorth(ctx);
    }
    mission = Memory.kernel?.powerFarm;
    if (!mission) return;

    const healerCount = decideHealerCount(
      CONFIG.powerFarm.squadSize,
      CONFIG.powerFarm.healerSquadRatio,
    );
    const squadTotal = CONFIG.powerFarm.squadSize + healerCount;

    // 止损：编队损耗超限（PB 房无塔，超额损耗 = 路途截杀 — 停手）。
    if (isPowerFarmAttritionLost(mission.spawned, squadTotal, CONFIG.powerFarm.casualtyMultiplier)) {
      concludeFarm(ctx.tick, 1); // attrition
      return;
    }
    // 超时：击破 + 捡运总预算耗尽（PB 自身 5000 tick 也会消失）。
    if (isPowerFarmTimedOut(mission.since, ctx.tick, CONFIG.powerFarm.missionTimeout)) {
      concludeFarm(ctx.tick, 2); // timeout
      return;
    }

    // strike 阶段：房内视野自查 PB 存活（编队到达后提供视野）。
    if (mission.phase === "strike") {
      const targetRoom = Game.rooms[mission.targetRoom];
      if (targetRoom) {
        const pbAlive = targetRoom.find(FIND_STRUCTURES).some(
          s => s.structureType === STRUCTURE_POWER_BANK,
        );
        if (!pbAlive) {
          // PB 消失（我方击破或自然到期）→ 转捡运：停战、收编队、派 collector。
          mission.phase = "collect";
          recordEvent(EventKind.PowerFarmOutcome, mission.targetRoom, [4, mission.spawned]);
          console.log(
            `[${Game.time}] power-farm: ${mission.targetRoom} PB 已消失，转 collect 阶段`,
          );
        }
      }
      if (mission.phase === "strike") {
        maintainSquad(ctx, mission, healerCount);
        return;
      }
    }

    // collect 阶段：回收战斗编队（仍在途的及时止损）+ 孵/等 collector。
    recycleSquad(mission.targetRoom);
    const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
    if (!queue) return; // sponsor 失守 — 超时兜底收摊
    const collectorLive = countRoleLive("pbCollector", mission.targetRoom);
    const collectorPending = countPendingByMission(queue, "pbCollector", "powerCollect");
    if (collectorLive + collectorPending === 0) {
      if (mission.collectorSpawnedAt === undefined) {
        // 首次：派 collector。
        submitFarmRequest(queue, mission, "pbCollector", 0, 1300, ctx.tick);
        mission.collectorSpawnedAt = ctx.tick;
        return;
      }
      // collector 已派且消失：捡完送回（done）或阵亡 — 宽限期后收摊
      //（阵亡重派由宽限窗内下轮的 collectorLive 通道兜底，本实现宽限后直接收摊止损）。
      if (ctx.tick - mission.collectorSpawnedAt > CONFIG.powerFarm.collectGraceTicks) {
        concludeFarm(ctx.tick, 0); // done
      }
      return;
    }
    // collector 在途/在岗：等待（捡运由角色自管理，完成 recycle 后走上方收摊路径）。
  },
};

/** 从各 home 的 intel 采集 PB 候选并择优开任务。 */
function startFarmIfWorth(ctx: TickContext): void {
  // 占用集合：远矿运营/扩张目标房不选（编队过境干扰主线）。
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

  // sponsor 必须是现存自有房（失守房的 spawnQueue 无人消费）。
  const myRooms = new Set<string>();
  for (const snap of ctx.snapshots()) myRooms.add(snap.roomName);
  if (myRooms.size === 0) return;

  const candidates: PowerBankCandidate[] = [];
  for (const home of Object.keys(Memory.rooms)) {
    if (!myRooms.has(home)) continue;
    const intel = Memory.rooms[home]?.intel;
    if (!intel) continue;
    for (const roomName of Object.keys(intel)) {
      const e = intel[roomName];
      if (!e?.powerBank) continue;
      candidates.push({
        roomName,
        home,
        lastSeen: e.lastSeen,
        powerBank: true,
        linearDistance: roomLinearDistance(home, roomName),
        occupied: occupied.has(roomName),
      });
    }
  }

  const target = selectPowerBankTarget(candidates, ctx.tick, {
    freshness: CONFIG.powerFarm.intelFreshness,
    maxRange: CONFIG.powerFarm.maxRange,
  });
  if (!target) return;

  if (!Memory.kernel) Memory.kernel = {};
  Memory.kernel.powerFarm = {
    targetRoom: target.roomName,
    sponsor: target.home,
    since: ctx.tick,
    spawned: 0,
    phase: "strike",
  };
  recordEvent(EventKind.PowerFarmOutcome, target.roomName, [4, 0]);
  console.log(
    `[${Game.time}] power-farm: 开任务 ${target.home} → ${target.roomName} (dist=${target.linearDistance})`,
  );
}

/** strike 阶段维持编队（attacker + healer，live+pending 编制补位）。 */
function maintainSquad(
  ctx: TickContext,
  mission: NonNullable<KernelMemory["powerFarm"]>,
  healerCount: number,
): void {
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (!queue) return;
  const cap = ctx.getSnapshot(mission.sponsor)?.energyCapacityAvailable ?? 1300;

  let attackerLive = 0;
  let healerLive = 0;
  // P0-1：从全局编队索引取子集，替代独立全量遍历 Game.creeps。
  const squad = querySquad({ home: mission.sponsor, remoteTarget: mission.targetRoom, mission: "powerBank" });
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
  mission: NonNullable<KernelMemory["powerFarm"]>,
  role: "attacker" | "healer" | "pbCollector",
  index: number,
  cap: number,
  tick: number,
): void {
  const key = `pf-${role}-${mission.sponsor}-${index}-${mission.targetRoom}`;
  if (hasRequest(queue, key)) return;
  if (role !== "pbCollector") {
    mission.spawned = (mission.spawned ?? 0) + 1; // 止损账本只计战斗件
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

/** 统计指定角色的存活数（按 remoteTarget 过滤）。
 * P0-1：从全局编队索引取子集，替代全量遍历 Game.creeps。 */
function countRoleLive(role: string, targetRoom: string): number {
  return querySquad({ role, remoteTarget: targetRoom }).length;
}

/** 回收指定目标房的战斗编队（attacker/healer，mission 过滤防误伤 war 编队）。
 * P0-1：从全局编队索引取子集，按 name 精确定位 Creep 对象标记 recycle。 */
function recycleSquad(targetRoom: string): void {
  const squad = querySquad({ remoteTarget: targetRoom, mission: "powerBank" });
  for (const e of squad) {
    if (e.role === "attacker" || e.role === "healer") {
      const creep = Game.creeps[e.name];
      if (creep) creep.memory.recycle = true;
    }
  }
}

/** 收摊（幂等）：回收编队 + 撤销寄宿请求（mission 标记过滤）+ 清任务。
 * reason：0=done / 1=attrition / 2=timeout / 3=war-preempt。 */
function concludeFarm(tick: number, reason: number): void {
  const mission = Memory.kernel?.powerFarm;
  if (!mission) return;
  recycleSquad(mission.targetRoom);
  const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
  if (queue) {
    removeRequestsByMission(queue, "powerBank");
    removeRequestsByMission(queue, "powerCollect");
  }
  delete Memory.kernel!.powerFarm;
  recordEvent(EventKind.PowerFarmOutcome, mission.targetRoom, [
    reason,
    mission.spawned ?? 0,
  ]);
  console.log(`[${Game.time}] power-farm: 收摊 ${mission.targetRoom} (reason=${reason})`);
}
