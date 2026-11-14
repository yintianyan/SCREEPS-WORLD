/** Power Farm Manager — 多任务并行版。
 * 同时追踪多个 PB 目标，每个任务独立维护编队和状态。
 * 任务数量上限由 CONFIG.powerFarm.maxConcurrentMissions 控制（默认 2）。
 */
import { recordTyped } from "../../kernel/event-log";
import { CONFIG } from "../../config";
import { bodyCost, selectBody } from "../../config/bodies";
import type { Priority, System, TickContext } from "../../kernel/contracts";
import type { Compound } from "../../domain/industry/types";
import { EventKind } from "../../kernel/event-log";
import {
  isPowerFarmAttritionLost,
  isPowerFarmTimedOut,
  planPowerFarmSquad,
  reconcilePowerFarmRoster,
  selectPowerBankTarget,
  splitShare,
  type PowerBankCandidate,
  type PowerFarmPlan,
} from "../../domain/war/power-farm";
import {
  isPbBoostStockSufficient,
  PB_SQUAD_BOOST_TIERS,
  pbSquadBoostNeed,
  type PbBoostNeed,
  type PbBoostTierChoice,
} from "../../domain/industry/boost";
import { collectFullInventory } from "../../domain/industry/inventory";
import { decideHealerCount } from "../../domain/war/planning";
import { roomLinearDistance } from "../../domain/remote/targeting";
import {
  evaluateMarchRoute,
  rememberedThreatRooms,
  rememberThreatRooms,
  threatRoomsFromIntel,
} from "../../domain/war/march-threats";
import { roomBoxRooms, type RoomIntel } from "../../domain/intel";
import { queryRoomIntel } from "../intelligence";
import {
  countPendingByMission,
  hasRequest,
  removeRequestsByMission,
  submitRequest,
  buildSpawnRequest,
} from "../../domain/spawn/queue";
import { querySquad } from "../../kernel/global-cache";
import { log } from "../../kernel/log";

/**
 * 名册对账的「寿终」阈值：上轮观测剩余寿命低于此值后消失，不计战损。
 * 取 300 = 6× manager interval(50)，容忍系统被 CPU 预算跳过几轮；
 * 剩余寿命 > 300 却消失的个体只可能是战损/事故/主动回收。
 */
const NATURAL_DEATH_TTL = 300;

/**
 * 收摊后复用健康编队的最低剩余寿命：低于此值让它走 recyclePass 归航回收残值，
 * 不值得再跨房折返参战。
 */
const REVIVE_MIN_TTL = 300;

/** 孵化中/数据缺失时的寿命兜底（标准 creep 寿命）。 */
const DEFAULT_CREEP_LIFETIME = 1500;

/** CARRY 单部件容量（引擎常量 50；测试环境可能没有全局常量）。 */
const CARRY_PER_PART = 50;

/** creep 寿命（引擎 CREEP_LIFE_TIME=1500；highway 无 renew，战斗编队无法续命）。 */
const CREEP_LIFETIME_TICKS = 1500;

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

    // 情报快照（heap）：路线威胁检查与目标规划共用一次构建。
    const intelByRoom = new Map<string, RoomIntel>();
    for (const entry of queryRoomIntel()) intelByRoom.set(entry.subject, entry.payload);

    // 开新任务（多任务并行：每轮尝试开新任务直到达到上限或无候选）。
    if (missions.length < (CONFIG.powerFarm.maxConcurrentMissions ?? 2)) {
      startFarmIfWorth(ctx, missions, intelByRoom);
      missions = Memory.kernel?.powerFarmMissions ?? [];
    }

    // 逐任务维护。
    const survivorMissions: PowerFarmMission[] = [];
    for (const mission of missions) {
      const alive = maintainMission(ctx, mission, intelByRoom);
      if (alive) survivorMissions.push(mission);
    }
    if (Memory.kernel) {
      Memory.kernel.powerFarmMissions = survivorMissions;
    }

    // 孤儿编队自愈：任务已收摊（超时/战损/路线威胁/手工清理）但 creep 仍带
    // powerBank/powerCollect 标记时，下一轮任务不会再认领它们 —— 不清理就会
    // 永久停在 PB 房空转。带 power 的 collector 先让它回家卸货。
    reapOrphanSquads(new Set(survivorMissions.map(m => m.targetRoom)));
  },
};

/** 清理没有对应任务的 PB 编队标记（带 power 的 collector 除外）。 */
function reapOrphanSquads(activeTargets: ReadonlySet<string>): void {
  for (const e of querySquad({ mission: "powerBank" })) {
    if (!e.remoteTarget || activeTargets.has(e.remoteTarget)) continue;
    const creep = Game.creeps[e.name];
    if (creep && creep.memory.recycle !== true) creep.memory.recycle = true;
  }
  for (const e of querySquad({ mission: "powerCollect" })) {
    if (!e.remoteTarget || activeTargets.has(e.remoteTarget)) continue;
    const creep = Game.creeps[e.name];
    if (!creep || creep.memory.recycle === true) continue;
    // 已经抢到 power：让它先回家卸货（recyclePass 会连货一起销毁）。
    if (creep.store.getUsedCapacity(RESOURCE_POWER) > 0) continue;
    creep.memory.recycle = true;
  }
}

/**
 * 威胁全集：本轮 intel 观测 + 跨重启记忆（threatMemoryTicks TTL 洗白）。
 * intel 的 room 域是 heap、global reset 即空 —— 驻守房只有 kernel.threatRooms
 * 这一份记忆；本轮新观测顺手 write-through 回记忆，行军规避在重启后依然成立。
 */
function currentThreatSet(
  intelByRoom: ReadonlyMap<string, RoomIntel>,
  myUsername: string | undefined,
  tick: number,
): Set<string> {
  const observed = threatRoomsFromIntel(intelByRoom, myUsername, CONFIG.defense.allies);
  if (observed.length > 0) {
    if (!Memory.kernel) Memory.kernel = {};
    Memory.kernel.threatRooms = rememberThreatRooms(Memory.kernel, observed, tick);
  }
  return new Set([
    ...observed,
    ...rememberedThreatRooms(Memory.kernel ?? {}, tick, CONFIG.powerFarm.threatMemoryTicks),
  ]);
}

/** findRoute 规避已知威胁房取行军路线（home → target 全房序列）；无路返回 undefined。 */
function findMarchRoute(
  home: string,
  target: string,
  threats: ReadonlySet<string>,
): string[] | undefined {
  if (typeof Game.map?.findRoute !== "function") return undefined;
  const route = Game.map.findRoute(home, target, {
    // fromRoomName === "" 是起点房：对起点打 Infinity 会让整条路由直接失败
    // （scout 管线同款坑），起点威胁交给房内逻辑处理。
    routeCallback(roomName: string, fromRoomName: string): number {
      return threats.has(roomName) && fromRoomName !== "" ? Infinity : 1;
    },
  });
  if (route === ERR_NO_PATH) return undefined;
  return [home, ...(route as { room: string }[]).map(step => step.room)];
}

/** findRoute 不可用（私服/测试环境）时的兜底：盒扫描威胁 + Manhattan 通勤估算。 */
function fallbackRouteCheck(
  home: string,
  target: string,
  threats: ReadonlySet<string>,
): { ok: boolean; threatRoom?: string; distance: number } {
  for (const rn of roomBoxRooms(home, target)) {
    if (rn === home || rn === target) continue;
    if (threats.has(rn)) return { ok: false, threatRoom: rn, distance: 0 };
  }
  return { ok: true, distance: manhattanDistance(home, target) };
}

/** 正交口径房距（|Δx| + |Δy|）— 跨房行军的真实下界，Chebyshev 会低估斜穿。 */
function manhattanDistance(a: string, b: string): number {
  const parse = (rn: string): { x: number; y: number } | undefined => {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(rn);
    if (!m) return undefined;
    const x = (m[1] === "W" ? -1 : 1) * Number(m[2]);
    const y = (m[3] === "S" ? -1 : 1) * Number(m[4]);
    return { x, y };
  };
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return roomLinearDistance(a, b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/** 维护单个 PB 任务。返回 true = 任务继续，false = 已收摊。 */
function maintainMission(
  ctx: TickContext,
  mission: PowerFarmMission,
  intelByRoom: ReadonlyMap<string, RoomIntel>,
): boolean {
  // 旧任务没有规划字段 → 回退到历史配置，保证部署后能自然收敛。
  const attackerTarget = mission.attackers ?? CONFIG.powerFarm.squadSize;
  const healerTarget =
    mission.healers ?? decideHealerCount(attackerTarget, CONFIG.powerFarm.healerSquadRatio);

  // 超时（strike/collect 全域共用）。
  if (isPowerFarmTimedOut(mission.since, ctx.tick, CONFIG.powerFarm.missionTimeout)) {
    concludeMission(mission, ctx.tick, 2); // timeout
    return false;
  }

  // boost 停滞收摊：boost 口径任务长期没有任何成员强化成功（lab 供给链断 —
  // 无 labTender / 化合物中途耗尽 / 换矿死锁），编队驻留只是烧寿命。
  // 收摊止损；combat 前馈继续补产，化合物到位后下一轮重开（存活 creep 复用）。
  if (
    mission.boostPlanned === true &&
    mission.phase === "strike" &&
    ctx.tick - mission.since > CONFIG.powerFarm.boostStallTicks
  ) {
    const anyBoosted = querySquad({
      remoteTarget: mission.targetRoom,
      mission: "powerBank",
    }).some(e => e.boosted === true);
    if (!anyBoosted) {
      concludeMission(mission, ctx.tick, 6); // boost-stall
      return false;
    }
  }

  // 路线威胁复核：用「本轮 intel + 跨重启威胁记忆」的最新威胁集，对联盟每个
  // sponsor 的行军路线（开任务时规避生成的 marchPaths；findRoute 不可用的旧
  // 任务回退几何盒扫描）逐房复核 — intel 更新发现驻守房切断了某条路线 →
  // 立即收摊止损（实测 W8N3→W9N10 的编队穿过 W9N9（3 塔），治疗手在到达
  // PB 前就被点名）。
  if (mission.phase === "strike") {
    const myUsername = Game.rooms[mission.sponsor]?.controller?.owner?.username;
    const threatSet = currentThreatSet(intelByRoom, myUsername, ctx.tick);
    const sponsors = mission.sponsors ?? [mission.sponsor];
    let routeCompromised: string | undefined;
    for (const sponsor of sponsors) {
      const path = mission.marchPaths?.[sponsor];
      if (path) {
        const verdict = evaluateMarchRoute(path, threatSet);
        if (!verdict.ok) {
          routeCompromised = verdict.threatRoom;
          break;
        }
      } else if (sponsor === mission.sponsor || !mission.marchPaths) {
        // 旧任务无 marchPaths：只对 sponsor[0] 做盒扫描兜底（联盟任务升级前形态）。
        const legacy = fallbackRouteCheck(sponsor, mission.targetRoom, threatSet);
        if (!legacy.ok) {
          routeCompromised = legacy.threatRoom;
          break;
        }
      }
    }
    if (routeCompromised !== undefined) {
      log.info(
        "power-farm-manager",
        `power-farm: 收摊 ${mission.targetRoom} (reason=route-threat:${routeCompromised})`,
      );
      concludeMission(mission, ctx.tick, 5);
      return false;
    }
  }

  // strike 阶段：房内视野自查 PB 存活 + 刷新实测参数。
  if (mission.phase === "strike") {
    const targetRoom = Game.rooms[mission.targetRoom];
    if (targetRoom) {
      const pb = targetRoom
        .find(FIND_STRUCTURES)
        .find(s => s.structureType === STRUCTURE_POWER_BANK) as StructurePowerBank | undefined;
      if (!pb) {
        mission.phase = "collect";
        // 预置 collector 模式：宽限从 PB 消失起算；旧任务（无 collectors）保留
        // 「首次补派 collector 时才起算」的历史语义，由下方 collect 分支设置。
        if (mission.collectors !== undefined) mission.collectorSpawnedAt ??= ctx.tick;
        recordTyped(EventKind.PowerFarmOutcome, mission.targetRoom, {
          reasonCode: 4,
          spawned: mission.spawned,
        });
        log.info(
          "power-farm-manager",
          `power-farm: ${mission.targetRoom} PB 已消失，转 collect 阶段`,
        );
      } else {
        // 实测刷新：供遥测/后续任务规划（攻击进度、剩余生命）。
        mission.powerBankHits = pb.hits;
        mission.powerBankUntil = ctx.tick + (pb.ticksToDecay ?? 0);
        mission.powerBankPower = pb.power;
      }
    }
    if (mission.phase === "strike") {
      // 名册对账 + 补员；返回 true = 非寿终损失超限，应立即收摊。
      if (maintainSquad(ctx, mission, attackerTarget, healerTarget)) {
        concludeMission(mission, ctx.tick, 1); // attrition
        return false;
      }
      // collector 必须在击破前到位：PB 的 power 只在 ruin 里保留 10 tick。
      maintainCollectors(ctx, mission);
      return true;
    }
  }

  // collect 阶段：回收战斗编队；预置 collector 已带着 power 回家。
  recycleSquad(mission.targetRoom);

  // 旧任务没有预置 collector（mission.collectors 缺失）→ 保留一次性补派路径。
  if (mission.collectors === undefined) {
    const queue = Memory.rooms[mission.sponsor]?.spawnQueue;
    if (!queue) return false; // sponsor 失守
    const collectorLive = countRoleLive("pbCollector", mission.targetRoom);
    const collectorPending = countPendingByMission(
      queue,
      "pbCollector",
      "powerCollect",
      mission.targetRoom,
    );
    if (collectorLive + collectorPending === 0) {
      if (mission.collectorSpawnedAt === undefined) {
        submitFarmRequest(
          queue,
          mission.sponsor,
          mission,
          "pbCollector",
          0,
          spawnCapacity(ctx, mission.sponsor),
          ctx.tick,
        );
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

  // 预置 collector 模式：只等宽限窗，让它们完成撤离/归仓后收摊。
  if (mission.collectorSpawnedAt === undefined) mission.collectorSpawnedAt = ctx.tick;
  if (ctx.tick - mission.collectorSpawnedAt > CONFIG.powerFarm.collectGraceTicks) {
    concludeMission(mission, ctx.tick, 0); // done
    return false;
  }
  return true;
}

/** 从各 home 的 intel 采集 PB 候选，逐个做编队可行性规划后择优开任务。 */
function startFarmIfWorth(
  ctx: TickContext,
  existingMissions: readonly PowerFarmMission[],
  intelByRoom: ReadonlyMap<string, RoomIntel>,
): void {
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

  // 已下单任务的能量成本按 sponsor 分摊（多任务并行 + 联盟：同一间房被多个
  // 任务点名时，它的 storage 预算要扣掉所有已承诺份额）。
  const committedByRoom: Record<string, number> = {};
  for (const m of existingMissions) {
    for (const sponsor of m.sponsors ?? [m.sponsor]) {
      committedByRoom[sponsor] = (committedByRoom[sponsor] ?? 0) + (m.energyCost ?? 0);
    }
  }

  const feasible: PowerBankCandidate[] = [];
  const plans = new Map<string, PlanForCandidateResult>();
  const coalitions = new Map<string, Array<{ room: string; distance: number; path?: string[] }>>();

  const myRoomSnaps = [...ctx.snapshots()];
  let myUsername: string | undefined;
  for (const snap of myRoomSnaps) {
    const owner = snap.controller?.owner?.username;
    if (owner) {
      myUsername = owner;
      break;
    }
  }
  const threatSet = currentThreatSet(intelByRoom, myUsername, ctx.tick);

  for (const entry of queryRoomIntel()) {
    if (!myRooms.has(entry.observedBy)) continue;
    if (!entry.payload.powerBank) continue;
    if (activeTargets.has(entry.subject)) continue; // 已有任务

    const candidate: PowerBankCandidate = {
      roomName: entry.subject,
      home: entry.observedBy,
      lastSeen: entry.observedAt,
      powerBank: true,
      linearDistance: roomLinearDistance(entry.observedBy, entry.subject),
      occupied: occupied.has(entry.subject),
      hits: entry.payload.powerBankHits,
      until: entry.payload.powerBankUntil,
      power: entry.payload.powerBankPower,
    };

    // 联盟组建（多房协同出力）：每个自有房独立过「路由规避 + 距离闸」，
    // 就近取房出一份编队份额 — 单房扛整套编队 = 能量/串行孵化/喂料三重瓶颈。
    const coalition: Array<{ room: string; distance: number; path?: string[] }> = [];
    for (const snap of myRoomSnaps) {
      const room = snap.roomName;
      const routeRooms = findMarchRoute(room, candidate.roomName, threatSet);
      if (routeRooms) {
        const verdict = evaluateMarchRoute(routeRooms, threatSet);
        if (!verdict.ok) {
          log.info(
            "power-farm-manager",
            `power-farm: skip ${room}→${candidate.roomName} (route-threat:${verdict.threatRoom})`,
          );
          continue;
        }
        coalition.push({ room, distance: routeRooms.length - 1, path: routeRooms });
      } else {
        const legacy = fallbackRouteCheck(room, candidate.roomName, threatSet);
        if (!legacy.ok) {
          log.info(
            "power-farm-manager",
            `power-farm: skip ${room}→${candidate.roomName} (route-threat:${legacy.threatRoom})`,
          );
          continue;
        }
        coalition.push({ room, distance: legacy.distance });
      }
    }
    coalition.sort((a, b) => a.distance - b.distance);
    const chosen = coalition.slice(0, CONFIG.powerFarm.maxSponsors);
    if (chosen.length === 0) {
      log.info(
        "power-farm-manager",
        `power-farm: skip →${candidate.roomName} (no-route: 所有自有房路线不可行/超距)`,
      );
      continue;
    }

    // 出击距离闸门（正交口径）：maxRange 限的是**行军路线长度**而非 Chebyshev —
    // 规避驻守房会把路线拉长，Chebyshev 7 的目标正交 11 房，creep 寿命根本不够
    // 用（私服实测：11 房路线 + hold 等料把编队烧到寿终）。寿命账本是精确门，
    // 本闸是同口径的显式上限，两者任一不过都不出击。
    const planDistance = Math.max(...chosen.map(c => c.distance));
    if (planDistance > CONFIG.powerFarm.maxRange) {
      log.info(
        "power-farm-manager",
        `power-farm: skip →${candidate.roomName} (range:${planDistance}>${CONFIG.powerFarm.maxRange})`,
      );
      continue;
    }

    const planned = planForCandidate(ctx, candidate, planDistance);
    if (planned.boostDemand) {
      // 数学可行但库存不足：需求留痕给 lab 前馈（deadline 内补产，逐 sponsor
      // 按份额拆）— 本轮不开任务，裸 body 口径满足不了窗口，硬开就是送编队。
      if (!Memory.kernel) Memory.kernel = {};
      const demand: NonNullable<KernelMemory["pbBoostDemand"]> = {};
      for (const [roomName, entry] of Object.entries(Memory.kernel.pbBoostDemand ?? {})) {
        if (entry.until > ctx.tick) demand[roomName] = entry;
      }
      chosen.forEach((member, i) => {
        demand[member.room] = {
          attackUnits: splitShare(planned.boostDemand!.attackUnits, i, chosen.length),
          healUnits: splitShare(planned.boostDemand!.healUnits, i, chosen.length),
          until: ctx.tick + CONFIG.powerFarm.boostDemandTtlTicks,
          compounds: {
            attack: planned.boostTier!.attack,
            heal: planned.boostTier!.heal,
          },
        };
      });
      Memory.kernel.pbBoostDemand = demand;
      log.info(
        "power-farm-manager",
        `power-farm: skip →${candidate.roomName} (boost-stock ` +
          `need=${planned.boostDemand.attackUnits}/${planned.boostDemand.healUnits}, 前馈补产中)`,
      );
      continue;
    }
    if (!planned.plan.feasible) {
      log.info(
        "power-farm-manager",
        `power-farm: skip →${candidate.roomName} (${planned.plan.reason})`,
      );
      continue;
    }

    // 份额预算：每个 sponsor 的份额成本 ≤ 自己 storage×0.75（多房分摊 = 单房
    // 预算闸压力减半）；不过者剔除联盟并重拆份额，直到全员达标或联盟空。
    const unitCosts = planned.unitCosts;
    let members = [...chosen];
    for (;;) {
      const n = members.length;
      if (n === 0) break;
      const failing = members.filter(m => {
        const idx = members.indexOf(m);
        const shareCost =
          splitShare(planned.plan.attackers, idx, n) * unitCosts.attacker +
          splitShare(planned.plan.healers, idx, n) * unitCosts.healer +
          splitShare(planned.plan.collectors, idx, n) * unitCosts.collector;
        const storageEnergy =
          ctx.getSnapshot(m.room)?.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        const committed = committedByRoom[m.room] ?? 0;
        return (
          storageEnergy > 0 &&
          committed + shareCost > storageEnergy * CONFIG.powerFarm.maxStorageFraction
        );
      });
      if (failing.length === 0) break;
      // 剔除存储最薄的失败者（最可能长期供不起），重拆份额再核。
      const weakest = failing.reduce((a, b) => {
        const ea = ctx.getSnapshot(a.room)?.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        const eb = ctx.getSnapshot(b.room)?.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
        return ea <= eb ? a : b;
      });
      members = members.filter(m => m.room !== weakest.room);
    }
    if (members.length === 0) {
      log.info(
        "power-farm-manager",
        `power-farm: skip →${candidate.roomName} (budget: 联盟全员份额超 storage 红线)`,
      );
      continue;
    }
    members.sort((a, b) => a.distance - b.distance);

    feasible.push(candidate);
    plans.set(candidate.roomName, planned);
    coalitions.set(candidate.roomName, members);
  }

  const target = selectPowerBankTarget(feasible, ctx.tick, {
    freshness: CONFIG.powerFarm.intelFreshness,
    maxRange: CONFIG.powerFarm.maxRange,
  });
  if (!target) return;
  const planned = plans.get(target.roomName)!;
  const plan = planned.plan;
  const coalition = coalitions.get(target.roomName)!;
  const sponsors = coalition.map(c => c.room);
  const marchPaths: Record<string, string[]> = {};
  for (const member of coalition) {
    if (member.path) marchPaths[member.room] = member.path;
  }
  const marchPath = marchPaths[sponsors[0]!];
  const avoidRooms = [...threatSet].slice(0, 40);

  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.powerFarmMissions) Memory.kernel.powerFarmMissions = [];
  const newMission: PowerFarmMission = {
    targetRoom: target.roomName,
    sponsor: sponsors[0]!,
    sponsors,
    since: ctx.tick,
    spawned: 0,
    phase: "strike",
    attackers: plan.attackers,
    healers: plan.healers,
    collectors: plan.collectors,
    collectorSeq: 0,
    powerBankHits: target.hits,
    powerBankUntil: target.until,
    powerBankPower: target.power,
    energyCost: plan.energyCost,
    boostPlanned: planned.boostPlanned,
    ...(planned.boostNeed ? { boostNeed: { ...planned.boostNeed } } : {}),
    ...(planned.boostTier ? { boostCompounds: { ...planned.boostTier } } : {}),
    ...(marchPath ? { marchPath } : {}),
    ...(Object.keys(marchPaths).length > 0 ? { marchPaths } : {}),
    avoidRooms,
  };
  Memory.kernel.powerFarmMissions.push(newMission);
  recordTyped(EventKind.PowerFarmOutcome, target.roomName, { reasonCode: 4, spawned: 0 });
  log.info(
    "power-farm-manager",
    `power-farm: 开任务 ${sponsors.join("+")} → ${target.roomName} ` +
      `(route=${marchPath ? `${marchPath.length - 1}房` : "box"} dist=${target.linearDistance} A=${plan.attackers} H=${plan.healers} C=${plan.collectors}` +
      `${planned.boostPlanned ? " boosted×4" : " unboosted"} ` +
      `kill=${plan.killTicks}t dmg/t=${plan.dps} heal/t=${plan.healPerTick}/${plan.reflectPerTick} ` +
      `cost=${plan.energyCost}` +
      `${plan.powerOverflow ? ` overflow=${plan.powerOverflow}` : ""})`,
  );
}

/** planForCandidate 的输出：规划结果 + boost 口径元数据（供任务孵化闸共用）。 */
interface PlanForCandidateResult {
  plan: PowerFarmPlan;
  /** boost 口径规划时为真；孵化闸据此检查化合物库存。 */
  boostPlanned: boolean;
  /** boost 口径下全套编队的化合物需求（闸门判据）。 */
  boostNeed?: PbBoostNeed;
  /** 实际选用的档位（化合物对 + 因子）；闸门/前馈/请求三方共用。 */
  boostTier?: PbBoostTierChoice;
  /** 单个 body 的孵化成本（联盟份额预算用；按 sponsor[0] 容量口径）。 */
  unitCosts: { attacker: number; healer: number; collector: number };
  /**
   * 「数学可行但库存不足」时的需求留痕：任务不开立，但需求写进
   * kernel.pbBoostDemand 驱动 lab 前馈补产 — 否则前馈只认已开立的任务，
   * 闸门在任务开立前查库存 → 鸡生蛋死锁，PB 永远无法自启。
   */
  boostDemand?: PbBoostNeed;
}

/** 为一个候选计算编队规划（body 按 sponsor 当前容量现选；boost 口径优先）。
 * distance 用行军路线长度（正交口径，规避驻守房后的真实通勤）而非 Chebyshev。 */
function planForCandidate(
  ctx: TickContext,
  candidate: PowerBankCandidate,
  distance: number,
): PlanForCandidateResult {
  const capacity = spawnCapacity(ctx, candidate.home);
  const snapshot = ctx.getSnapshot(candidate.home);
  const spawnCount = snapshot?.spawns?.length ?? 1;
  const attackerBody = selectBody("attacker", capacity);
  const healerBody = selectBody("healer", capacity);
  const collectorBody = selectBody("pbCollector", capacity);
  const availableTicks = Math.min(
    CONFIG.powerFarm.missionTimeout,
    candidate.until !== undefined ? candidate.until - ctx.tick : CONFIG.powerFarm.missionTimeout,
  );

  const planInput = (boost?: { attackFactor: number; healFactor: number }) =>
    planPowerFarmSquad({
      hits: candidate.hits ?? CONFIG.powerFarm.defaultPowerBankHits,
      power: candidate.power,
      distance,
      availableTicks,
      spawnCount,
      attacker: {
        parts: attackerBody.length,
        cost: bodyCost(attackerBody),
        attackParts: countParts(attackerBody, "attack"),
      },
      healer: {
        parts: healerBody.length,
        cost: bodyCost(healerBody),
        healParts: countParts(healerBody, "heal"),
      },
      collector: {
        parts: collectorBody.length,
        cost: bodyCost(collectorBody),
        carry: countParts(collectorBody, "carry") * CARRY_PER_PART,
      },
      ...(boost ? { boost } : {}),
      limits: {
        maxAttackers: CONFIG.powerFarm.maxAttackers,
        maxHealers: CONFIG.powerFarm.maxHealers,
        maxCollectors: CONFIG.powerFarm.maxCollectors,
        killWindowTicks: CONFIG.powerFarm.killWindowTicks,
        travelTicksPerRoom: CONFIG.powerFarm.travelTicksPerRoom,
        spawnTicksPerPart: CONFIG.powerFarm.spawnTicksPerPart,
        safetyTicks: CONFIG.powerFarm.planSafetyTicks,
        minPowerLoot: CONFIG.powerFarm.minPowerLoot,
        defaultPower: CONFIG.powerFarm.defaultPowerBankPower,
        creepLifetimeTicks: CREEP_LIFETIME_TICKS,
        boostWaitTicks: CONFIG.powerFarm.boostWaitTicks,
      },
    });

  // boost 口径优先：killWindow 由 creep 寿命反推后，裸 body 满足不了窗口
  // （RCL8 裸编队 heal 覆盖打满也只有 3 攻击手 → kill 1112 > 窗口），PB 野采
  // 事实上以 boost 为前提。化合物库存原子判定（XUH2O 与 XLHO2 同时够全套
  // 含 reserve）才允许 ×4 因子 — 单边 boost 会让反弹/治疗失配，编队烧光。
  const unitCosts = {
    attacker: bodyCost(attackerBody),
    healer: bodyCost(healerBody),
    collector: bodyCost(collectorBody),
  };

  // 分层 boost（T3 → T2）：两步解耦 — 先收集**数学可行**档位，再按 T3 → T2
  // 顺序做**库存选档**。旧实现把两步耦合（T3 数学可行但缺料就直接留痕返回，
  // 永远轮不到 T2 库存检查）。全档缺料 → 需求留痕按**最低可行档**（T2 只吃
  // U/H/O 基础矿必可产，不依赖催化剂 X），前馈补产后下一轮开任务。
  const inventory = snapshot ? collectFullInventory(snapshot) : {};
  const mathFeasible: Array<{
    tier: (typeof PB_SQUAD_BOOST_TIERS)[number];
    plan: PowerFarmPlan;
    need: PbBoostNeed;
  }> = [];
  for (const tier of PB_SQUAD_BOOST_TIERS) {
    const plan = planInput({
      attackFactor: tier.attackFactor,
      healFactor: tier.healFactor,
    });
    if (!plan.feasible) continue;
    mathFeasible.push({
      tier,
      plan,
      need: pbSquadBoostNeed(
        plan.attackers,
        countParts(attackerBody, "attack"),
        plan.healers,
        countParts(healerBody, "heal"),
      ),
    });
  }
  for (const { tier, plan, need } of mathFeasible) {
    if (isPbBoostStockSufficient(need, inventory, CONFIG.boost.reserveAmount, tier)) {
      return {
        plan,
        boostPlanned: true,
        boostNeed: need,
        boostTier: {
          attack: tier.attack,
          heal: tier.heal,
          attackFactor: tier.attackFactor,
          healFactor: tier.healFactor,
        },
        unitCosts,
      };
    }
  }
  if (mathFeasible.length > 0) {
    // 全档缺料：需求留痕按最低可行档（保供给链确定性），本轮不开任务。
    const lowest = mathFeasible[mathFeasible.length - 1]!;
    return {
      plan: lowest.plan,
      boostPlanned: false,
      boostDemand: lowest.need,
      boostTier: {
        attack: lowest.tier.attack,
        heal: lowest.tier.heal,
        attackFactor: lowest.tier.attackFactor,
        healFactor: lowest.tier.healFactor,
      },
      unitCosts,
    };
  }

  // 裸 body 口径兜底：近距离 PB（通勤短）可能仍满足寿命约束。
  return { plan: planInput(), boostPlanned: false, unitCosts };
}

/** sponsor 的孵化能量容量（优先 snapshot，缺省回退 war 的保守值）。 */
function spawnCapacity(ctx: TickContext, homeRoom: string): number {
  return ctx.getSnapshot(homeRoom)?.energyCapacityAvailable ?? CONFIG.war.fallbackCapacity;
}

/**
 * strike 阶段维持编队（attacker + healer，live+pending 编制补位）。
 * 返回 true = 非寿终损失超限（调用方收摊）。
 */
function maintainSquad(
  ctx: TickContext,
  mission: PowerFarmMission,
  attackerTarget: number,
  healerTarget: number,
): boolean {
  // 上一轮被收摊的健壮编队（同目标）优先复用：省一次全套孵化。
  reviveHealthySquad(mission);

  // 名册只统计「未标记 recycle」的成员：recycle 的个体由 recyclePass 接管，不作战，
  // 旧实现把它们算作在编 → 新任务不补员、旧编队又不打，形成永久空转。
  const currentRoster: Record<string, number> = {};
  for (const e of querySquad({
    remoteTarget: mission.targetRoom,
    mission: "powerBank",
  })) {
    const creep = Game.creeps[e.name];
    if (!creep || creep.memory.recycle === true) continue;
    currentRoster[e.name] = creep.ticksToLive ?? DEFAULT_CREEP_LIFETIME;
  }

  const firstObservation = mission.roster === undefined;
  const diff = reconcilePowerFarmRoster(mission.roster, currentRoster, NATURAL_DEATH_TTL);
  mission.losses = (mission.losses ?? 0) + diff.losses;
  mission.spawned = (firstObservation ? 0 : (mission.spawned ?? 0)) + diff.spawned;
  mission.roster = diff.roster;

  // 多房协同（sponsor 联盟）：每个 sponsor 孵化自己的份额（splitShare 均摊），
  // 各自过 boost 闸（份额口径）— 单房扛整套编队是三重瓶颈（能量/串行孵化/喂料）。
  const sponsors = mission.sponsors ?? [mission.sponsor];
  for (let i = 0; i < sponsors.length; i++) {
    const sponsor = sponsors[i]!;
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) continue;
    const cap = spawnCapacity(ctx, sponsor);
    const attackerShare = splitShare(attackerTarget, i, sponsors.length);
    const healerShare = splitShare(healerTarget, i, sponsors.length);

    const live = countSquadByRole(sponsor, mission.targetRoom);
    const pendingAttackers = countPendingByMission(
      queue,
      "attacker",
      "powerBank",
      mission.targetRoom,
    );
    const pendingHealers = countPendingByMission(queue, "healer", "powerBank", mission.targetRoom);

    // boost 孵化闸（份额口径 + 任务档位）：本 sponsor 只需备齐自己那份编队的
    // 化合物（T3 或 T2 档）— 多房协同把闸门压力也分摊了。闸关期间本房不提交
    // （前馈按任务档位补产中）。
    if (mission.boostPlanned === true) {
      const attackerBody = selectBody("attacker", cap);
      const healerBody = selectBody("healer", cap);
      const shareNeed = pbSquadBoostNeed(
        attackerShare,
        countParts(attackerBody, "attack"),
        healerShare,
        countParts(healerBody, "heal"),
      );
      const compounds = mission.boostCompounds
        ? {
            attack: mission.boostCompounds.attack as Compound,
            heal: mission.boostCompounds.heal as Compound,
          }
        : undefined;
      const snapshot = ctx.getSnapshot(sponsor);
      const inventory = snapshot ? collectFullInventory(snapshot) : {};
      if (!isPbBoostStockSufficient(shareNeed, inventory, CONFIG.boost.reserveAmount, compounds)) {
        continue;
      }
    }

    // 治疗优先：PB 反弹会先杀死攻击手，缺治疗的输出等于送死。
    if (live.healers + pendingHealers < healerShare) {
      submitFarmRequest(
        queue,
        sponsor,
        mission,
        "healer",
        live.healers + pendingHealers,
        cap,
        ctx.tick,
      );
    }
    if (live.attackers + pendingAttackers < attackerShare) {
      submitFarmRequest(
        queue,
        sponsor,
        mission,
        "attacker",
        live.attackers + pendingAttackers,
        cap,
        ctx.tick,
      );
    }
  }

  return isPowerFarmAttritionLost(
    mission.losses ?? 0,
    attackerTarget + healerTarget,
    CONFIG.powerFarm.casualtyMultiplier,
  );
}

/** 本 sponsor 名下（home+remoteTarget）的在编攻击手/治疗手数。 */
function countSquadByRole(
  sponsor: string,
  targetRoom: string,
): { attackers: number; healers: number } {
  let attackers = 0;
  let healers = 0;
  for (const e of querySquad({
    home: sponsor,
    remoteTarget: targetRoom,
    mission: "powerBank",
  })) {
    const creep = Game.creeps[e.name];
    if (!creep || creep.memory.recycle === true) continue;
    if (e.role === "attacker") attackers++;
    else if (e.role === "healer") healers++;
  }
  return { attackers, healers };
}

/**
 * 复用健康编队：新任务开立或旧任务收摊后，同目标房里仍有回收标记的健壮个体时，
 * 清除 recycle 让它们直接参战（PB 房里已经到位，重孵一套要 1,500+ tick 通勤）。
 * 只在 sponsor 有视野且控制器仍属我方时执行，避免给撤离中的房子复活编队。
 */
function reviveHealthySquad(mission: PowerFarmMission): number {
  const home = Game.rooms[mission.sponsor];
  if (!home?.controller?.my) return 0;
  let revived = 0;
  for (const e of querySquad({
    remoteTarget: mission.targetRoom,
    mission: "powerBank",
  })) {
    const creep = Game.creeps[e.name];
    if (!creep || creep.spawning || creep.memory.recycle !== true) continue;
    const hits = creep.hits;
    const hitsMax = creep.hitsMax;
    if (typeof hits !== "number" || typeof hitsMax !== "number" || hitsMax <= 0) continue;
    if (hits < hitsMax * CONFIG.war.retreatRatio) continue;
    if ((creep.ticksToLive ?? 0) < REVIVE_MIN_TTL) continue;
    creep.memory.recycle = false;
    revived++;
  }
  return revived;
}

/**
 * strike 阶段预置 collector：PB 摧毁后 power 只在 ruin 里保留 10 tick，
 * 必须击破前到位并一次抢完（数量 = ceil(power / 单趟 carry)）。
 * 每轮最多补 2 只，避免挤占战斗编队的孵化位。
 */
function maintainCollectors(ctx: TickContext, mission: PowerFarmMission): void {
  const planned = mission.collectors;
  if (planned === undefined || planned <= 0) return;
  const sponsors = mission.sponsors ?? [mission.sponsor];
  const live = countRoleLive("pbCollector", mission.targetRoom);
  let pendingTotal = 0;
  for (const sponsor of sponsors) {
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) continue;
    pendingTotal += countPendingByMission(queue, "pbCollector", "powerCollect", mission.targetRoom);
  }
  const missing = planned - (live + pendingTotal);
  if (missing <= 0) return;
  // 每房每轮最多 2 只（分摊孵化位），份额 splitShare 均摊到联盟。
  for (let i = 0; i < sponsors.length && missing > 0; i++) {
    const sponsor = sponsors[i]!;
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) continue;
    const cap = spawnCapacity(ctx, sponsor);
    const share = splitShare(planned, i, sponsors.length);
    const sharePending = countPendingByMission(
      queue,
      "pbCollector",
      "powerCollect",
      mission.targetRoom,
    );
    const shareMissing = Math.max(0, share - sharePending);
    const batch = Math.min(2, shareMissing);
    for (let j = 0; j < batch; j++) {
      const seq = mission.collectorSeq ?? 0;
      submitFarmRequest(queue, sponsor, mission, "pbCollector", seq, cap, ctx.tick);
      mission.collectorSeq = seq + 1;
    }
  }
}

/** PB 任务的孵化请求（稳定 key 幂等；mission 标记分流角色行为）。 */
function submitFarmRequest(
  queue: NonNullable<RoomMemory["spawnQueue"]>,
  sponsor: string,
  mission: PowerFarmMission,
  role: "attacker" | "healer" | "pbCollector",
  index: number,
  cap: number,
  tick: number,
): void {
  const key = `pf-${role}-${sponsor}-${index}-${mission.targetRoom}`;
  if (hasRequest(queue, key)) return;
  const body = selectBody(role, cap);
  // 战斗编队 P2 优先；collector P3 让位（击破还需 2k+ tick，通勤足够追上）。
  const priority = role === "pbCollector" ? 3 : 2;
  submitRequest(
    queue,
    buildSpawnRequest(tick, {
      key,
      role,
      home: sponsor,
      priority,
      survival: false,
      body,
      memory: {
        role,
        home: mission.sponsor,
        mode: "acquire",
        spawnIndex: index,
        remoteTarget: mission.targetRoom,
        mission: role === "pbCollector" ? "powerCollect" : "powerBank",
        // 行军规避：已知威胁房全集（moveTowardRoom 用 findRoute 绕行，
        // intel 中途更新出的新威胁也随任务复核收摊兜底）。
        ...(mission.avoidRooms && mission.avoidRooms.length > 0
          ? { avoidRooms: mission.avoidRooms }
          : {}),
      },
    }),
  );
}

/** 统计指定角色的存活数（按 remoteTarget 过滤；回收标记中的不算在编）。 */
function countRoleLive(role: string, targetRoom: string): number {
  let count = 0;
  for (const e of querySquad({ role, remoteTarget: targetRoom })) {
    const creep = Game.creeps[e.name];
    if (creep && creep.memory.recycle !== true) count++;
  }
  return count;
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

/** 回收指定目标房的预置 collector（带 power 的先放回家卸货）。 */
function recycleCollectors(targetRoom: string): void {
  for (const e of querySquad({ remoteTarget: targetRoom, mission: "powerCollect" })) {
    const creep = Game.creeps[e.name];
    if (!creep || creep.memory.recycle === true) continue;
    if (creep.store.getUsedCapacity(RESOURCE_POWER) > 0) continue;
    creep.memory.recycle = true;
  }
}

/** body 中指定部件的数量。 */
function countParts(body: readonly BodyPartConstant[], type: BodyPartConstant): number {
  let count = 0;
  for (const p of body) if (p === type) count++;
  return count;
}

/** 收摊（幂等）：回收编队/collector + 撤销本任务目标的请求 + 记录事件。
 * reason：0=done / 1=attrition / 2=timeout / 3=war-preempt / 5=route-threat / 6=boost-stall。 */
function concludeMission(mission: PowerFarmMission, _tick: number, reason: number): void {
  recycleSquad(mission.targetRoom);
  // 非成功收摊（战损/超时/战争/路线威胁）时预置 collector 也失去意义；
  // 成功收摊（reason=0）保留它们完成卸货，避免销毁已抢到的 power。
  if (reason !== 0) recycleCollectors(mission.targetRoom);
  // 撤本任务目标的请求：联盟里每个 sponsor 的队列都要撤（同房可能并行另一任务）。
  for (const sponsor of mission.sponsors ?? [mission.sponsor]) {
    const queue = Memory.rooms[sponsor]?.spawnQueue;
    if (!queue) continue;
    removeRequestsByMission(queue, "powerBank", mission.targetRoom);
    removeRequestsByMission(queue, "powerCollect", mission.targetRoom);
  }
  recordTyped(EventKind.PowerFarmOutcome, mission.targetRoom, {
    reasonCode: reason,
    spawned: mission.spawned ?? 0,
  });
  log.info(
    "power-farm-manager",
    `power-farm: 收摊 ${mission.targetRoom} (reason=${reason}` +
      ` sponsors=${(mission.sponsors ?? [mission.sponsor]).join("+")})`,
  );
}
