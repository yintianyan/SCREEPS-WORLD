/** 远矿威胁与阻断情报 — body-aware 威胁检测、InvaderCore 分类、防御决策输入构建。 */
import { CONFIG } from "../../config";
import { selectBody } from "../../config/bodies";
import { classifyThreats } from "../../domain/defense/threat";
import {
  assessThreat,
  type HostileSnapshot as ThreatHostileSnapshot,
  type RoomContext as ThreatRoomContext,
  type DefenseContext as ThreatDefenseContext,
  type ThreatAssessment as RemoteThreatAssessment,
} from "../../domain/defense/threat-assessment";

/**
 * 收集远矿房威胁信息 — 检测 active 运营的远矿房是否有 hostile creep。
 * 用于触发 remoteDefender 孵化需求。导出供接线测试验证 body-aware 口径。
 */
export function collectRemoteThreats(
  remoteOps: Readonly<Record<string, RemoteOp>>,
): Record<string, boolean> {
  const threats: Record<string, boolean> = {};
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) continue;
    // F-2：body-aware 威胁判定，与经济角色 flee 的 getRoomThreats 同口径
    // （classifyThreats 用同一 THREAT_PARTS）。原实现"任何非盟友即威胁"会为
    // 纯 MOVE 斥候空孵 defender（追不上也杀不了）+ 停产 300t，口径与 flee 分裂。
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    threats[roomName] = classifyThreats(hostiles, CONFIG.defense.allies).length > 0;
  }
  return threats;
}

/**
 * InvaderCore 压制分类：
 * - lesser：次级 reserve-only 核心（level 0、无守卫），不反击、无建筑 —— 派轻量 clearer 拆；
 * - stronghold：大要塞（level≥1 或带守卫 creep/防御建筑），需规避等自然 decay。
 */
export type RemoteBlockerState =
  { kind: "unknown" } | { kind: "clear" } | { kind: "lesser" } | { kind: "stronghold" };

/**
 * 纯函数：给定核心 + 守卫信息判定压制类型。导出供单测。
 * level===0 且无守卫 → lesser（可拆）；其余（level≥1 或存在守卫）→ stronghold（规避）。
 * 真实 InvaderCore 始终带 .level；缺失时保守判 stronghold（不送无治疗 creep 进未知险境）。
 */
export function classifyInvaderCores(input: {
  cores: ReadonlyArray<{ level?: number }>;
  hostileCreepCount: number;
}): "lesser" | "stronghold" {
  if (input.cores.length === 0) return "stronghold"; // 无核心由调用方按 clear 处理
  // 守卫判定：房内有任何敌对 creep 即视为被守卫（大要塞必带 NPC 护卫；次级核心无 creep）。
  // 次级(level 0)核心不刷护卫、不反击 —— 派轻量 clearer 拆；大要塞(level≥1)或带守卫 → 规避。
  const hasGuards = input.hostileCreepCount > 0;
  const anyStronghold = input.cores.some(c => (c.level ?? 1) >= 1);
  return anyStronghold || hasGuards ? "stronghold" : "lesser";
}

/**
 * 收集 InvaderCore 压制信息 — 检测 active 运营的远矿房是否被 InvaderCore 占据，并按
 * 核心等级二分（lesser/stronghold）。详见 classifyInvaderCores。

 * InvaderCore 是敌对结构而非 creep，FIND_HOSTILE_CREEPS 检测不到 —
 * 「房里只有一个核心、没有 Invader creep」的场景在旧实现中完全漏报，
 * 运营继续送 harvester/reserver 空耗。检测需要视野（active 房通常有驻场 creep）。
 * 导出供接线测试验证检测链路。
 */
export function collectRemoteBlockers(
  remoteOps: Readonly<Record<string, RemoteOp>>,
  remoteThreats?: Record<string, boolean>,
): Record<string, RemoteBlockerState> {
  const blockers: Record<string, RemoteBlockerState> = {};
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) {
      blockers[roomName] = { kind: "unknown" };
      continue;
    }
    const cores = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_INVADER_CORE,
    }) as StructureInvaderCore[];
    if (cores.length === 0) {
      blockers[roomName] = { kind: "clear" };
      continue;
    }
    // C1-FINDING-07: 复用 collectRemoteThreats 已采集的 hostile 信息，避免重复 FIND_HOSTILE_CREEPS
    const hostileCreepCount =
      remoteThreats && remoteThreats[roomName] !== undefined
        ? remoteThreats[roomName]
          ? 1
          : 0
        : room.find(FIND_HOSTILE_CREEPS).length;
    const kind = classifyInvaderCores({
      cores: cores.map(c => ({ level: c.level })),
      hostileCreepCount,
    });
    blockers[roomName] = { kind };
  }
  return blockers;
}

/**
 * 为远矿房构建 ThreatAssessment（A5.1：decideRemoteDefenseAction 集成支持）。
 * 系统层薄壳：从远矿房视野读取 hostile creeps，转换为 HostileSnapshot，
 * 委托给 assessThreat() 纯函数。无视野时返回 undefined。
 */
export function buildRemoteThreatAssessment(
  targetRoom: string,
  homeRoom: string,
  tick: number,
  op: RemoteOp,
  colonyState: string,
): RemoteThreatAssessment | undefined {
  const room = Game.rooms[targetRoom];
  if (!room) return undefined;

  const hostiles = room.find(FIND_HOSTILE_CREEPS) as Creep[];
  if (hostiles.length === 0) return undefined;

  // 核心锚点：远矿房无 spawn/controller 归我方，用 source 位置作锚点。
  const sources = room.find(FIND_SOURCES);
  const anchor = sources[0];
  if (!anchor) return undefined;

  const hostileSnapshots: ThreatHostileSnapshot[] = hostiles.map(c => ({
    id: c.id as string,
    owner: c.owner?.username ?? "unknown",
    pos: c.pos.x * 50 + c.pos.y,
    body: c.body.map(p => ({
      type: p.type,
      boost: p.boost as string | undefined,
      damaged: p.hits <= 0,
    })),
    hits: c.hits,
    hitsMax: c.hitsMax,
    ticksToLive: c.ticksToLive,
    room: c.room.name,
  }));

  const roomContext: ThreatRoomContext = {
    roomName: targetRoom,
    corePos: anchor.pos.x * 50 + anchor.pos.y,
    towerCount: 0, // 远矿房无塔
    towerEnergyTotal: 0,
    rampartCoverage: 0,
    rcl: room.controller?.level ?? 0,
    safeModeAvailable: 0,
    safeModeTicks: undefined,
    hasStorage: false,
    hasSpawn: false,
    friendlyCreepCount: 0,
    sourceCount: sources.length,
    isRemoteRoom: true,
    incomingNukes: room.find(FIND_NUKES).length,
  };

  const defenseContext: ThreatDefenseContext = {
    colonyState,
    lastHostileAt: op.lastSeen,
    prevThreatCount: 0,
  };

  return assessThreat({
    tick,
    hostiles: hostileSnapshots,
    roomContext,
    defenseContext,
    remoteContext: {
      homeRoom,
      targetRoom,
      remoteCreepCount: 0,
      incomePerTick: (op.sources ?? 1) * 10,
    },
  });
}

/** 估算帝国总能量储备（storage + terminal 能量之和）。 */
export function collectEmpireEnergyReserve(): number {
  let total = 0;
  for (const room of Object.values(Game.rooms)) {
    if (!room.controller?.my) continue;
    if (room.storage) {
      total += room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    }
    if (room.terminal) {
      total += room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    }
  }
  return total;
}

/**
 * 估算远矿 creep 投资成本（能量）。
 * 粗估：harvester + hauler + reserver 的 body 成本总和。
 */
export function estimateCreepInvestment(op: RemoteOp, energyCapacity: number): number {
  const harvesterBody = selectBody("remoteHarvester", energyCapacity);
  const haulerBody = selectBody("remoteHauler", energyCapacity, { hasRoad: false });
  const reserverBody = selectBody("reserver", energyCapacity);
  const cost = (body: readonly BodyPartConstant[]): number =>
    body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
  const harvesterCost = cost(harvesterBody) * (op.sources ?? 1);
  const haulerCost = cost(haulerBody) * (op.haulerNeed ?? 1);
  const reserverCost = cost(reserverBody);
  return harvesterCost + haulerCost + reserverCost;
}
