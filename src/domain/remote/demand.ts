/**
 * 远矿需求评估 — 纯函数，不访问 Game/Memory。
 *
 * 评估每个 active 远矿运营所需的 creep 数量，生成 SpawnRequest。
 *
 * 与本地 evaluateDemand 的区别：
 *   - 远矿需求独立评估，不经过本房的 evaluateDemand
 *   - 远矿 creep 的 home = 孵化房，remoteTarget = 远矿房
 *   - 远矿请求直接推入 spawnQueue，与本地请求共享优先级排序
 *
 * 优先级设计：
 *   - remoteHarvester: P1（经济引擎，与本地 harvester 同级）
 *   - remoteHauler: P1（物流链，与本地 hauler 同级）
 *   - reserver: P2（防御性，不阻塞经济）
 *
 * 安全门禁：
 *   - colonyState 非 normal 时暂停远矿孵化（远矿是扩张行为，危机时收缩）
 *   - CPU tier <= conserve 时不孵化远矿（CPU 预算保护）
 */

import { CONFIG } from "../../config";
import { selectBody } from "../../config/bodies";
import type { ColonyState } from "../../kernel/contracts";
import type { RoomIntel } from "../intel";
import { spawnKey, countPending } from "../spawn/queue";

/** 远矿 creep 摘要（与本地 CreepSummary 对齐但精简）。 */
export interface RemoteCreepSummary {
  name: string;
  role: string;
  remoteTarget?: string;
  ticksToLive?: number;
  bodyLength: number;
}

/** 远矿需求评估输入。 */
export interface RemoteDemandInput {
  /** 孵化房名。 */
  homeRoom: string;
  /** 当前 ColonyState（非 normal 时暂停远矿）。 */
  colonyState: ColonyState;
  /** 房间能量容量（用于 body 选择）。 */
  energyCapacityAvailable: number;
  /** 当前 tick。 */
  tick: number;
  /** 远矿运营列表（key = 目标房名）。 */
  remoteOps: Readonly<Record<string, { state: string; sources?: number; lastSeen: number }>>;
  /** 所有存活 + 孵化中的远矿 creep 摘要。 */
  remoteCreeps: readonly RemoteCreepSummary[];
  /** 孵化队列（用于 pending 计数）。 */
  spawnQueue: readonly SpawnRequest[];
  /** 远矿房威胁信息（从 Game.rooms 检测，key = 房间名，value = 是否有威胁）。 */
  remoteThreats?: Readonly<Record<string, boolean>>;
  /**
   * 被 InvaderCore 压制的远矿房集合 — 该房暂停一切孵化（含 defender）。
   *
   * InvaderCore 是 100,000 hits 的结构（INVADER_CORE_HITS），remoteDefender
   * [2A,2M] 仅 20 dmg/tick、寿命 1500 tick — 拆核需 5000 tick，派 defender
   * 是纯送死；reserver 的 attackController 对核心持续续期的预约也无效。
   * 正确策略是止损：停孵化、撤现役、等核心自然 decay 或冷却后重评估。
   */
  blockedRooms?: ReadonlySet<string>;
}

/** 远矿需求评估结果。 */
export interface RemoteDemandResult {
  requests: SpawnRequest[];
}

/**
 * 评估远矿孵化需求。
 *
 * 纯函数 — 接收预收集的数据，返回待提交的 SpawnRequest 列表。不访问 Game/Memory。
 *
 * 评估逻辑：
 *   1. 遍历 active 状态的远矿运营
 *   2. 对每个运营，统计已分配的 harvester/hauler/reserver 数量
 *   3. 不足目标数量则生成 SpawnRequest
 *   4. 替换逻辑：creep 即将死亡时提前替补
 */
export function evaluateRemoteDemand(input: RemoteDemandInput): RemoteDemandResult {
  const { homeRoom, colonyState, energyCapacityAvailable, tick, remoteOps, remoteCreeps, spawnQueue } = input;
  const requests: SpawnRequest[] = [];

  // 安全门禁：危机/恢复状态时暂停远矿孵化（远矿是扩张行为，危机时收缩）。
  if (colonyState === "recovery" || colonyState === "bootstrap") {
    return { requests };
  }

  // CPU 预算保护：conserve 以下不孵化远矿。
  // 注意：这里只检查 colonyState，CPU tier 检查由系统层在调用前完成。

  for (const [targetRoom, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;

    // InvaderCore 压制的房：暂停一切孵化（含 defender）— 打不动就不送兵。
    // 现役 creep 由 remote-mining-manager 的 recycle 通道撤回；
    // 核心消失（自然 decay / 视野确认清空）后本集合不再包含该房，孵化自动恢复。
    if (input.blockedRooms?.has(targetRoom)) continue;

    // 统计该远矿目标已分配的各角色数量。
    const counts = countRemoteCreepsByRole(remoteCreeps, targetRoom);
    const pending = {
      remoteHarvester: countRemotePending(spawnQueue, "remoteHarvester", targetRoom),
      remoteHauler: countRemotePending(spawnQueue, "remoteHauler", targetRoom),
      reserver: countRemotePending(spawnQueue, "reserver", targetRoom),
    };

    // Remote Defender — 有威胁时生成（先应战）。
    const hasThreats = input.remoteThreats?.[targetRoom] ?? false;
    if (CONFIG.remote.enableDefender && hasThreats) {
      const defenderPending = countRemotePending(spawnQueue, "remoteDefender", targetRoom);
      const defenderTotal = (counts.remoteDefender ?? 0) + defenderPending;
      if (defenderTotal < 1) {
        const key = spawnKey("remoteDefender", homeRoom, defenderTotal, targetRoom);
        const body = selectBody("remoteDefender", energyCapacityAvailable);
        requests.push(createRemoteRequest(
          "remoteDefender", homeRoom, targetRoom, defenderTotal,
          key, 1, body, tick,
        ));
      }
    }

    // RM-2：威胁在场（含失明冷却期 — 系统层已把 threatUntil 合并进
    // remoteThreats）时暂停经济孵化：经济 creep 零战力，威胁未清时
    // 补充的每一批都是送死。defender 已在上方评估（先应战再恢复运营）。
    if (hasThreats) continue;

    // 1. Remote Harvester — 每目标 1 个（可配置）。
    const harvesterTarget = CONFIG.remote.harvestersPerTarget;
    const harvesterTotal = (counts.remoteHarvester ?? 0) + pending.remoteHarvester;
    if (harvesterTotal < harvesterTarget) {
      const key = spawnKey("remoteHarvester", homeRoom, harvesterTotal, targetRoom);
      const body = selectBody("remoteHarvester", energyCapacityAvailable);
      requests.push(createRemoteRequest(
        "remoteHarvester", homeRoom, targetRoom, harvesterTotal,
        key, 1, body, tick,
      ));
    } else {
      // 替换逻辑：检查即将死亡的 remoteHarvester。
      const replacement = findReplacement(remoteCreeps, "remoteHarvester", targetRoom, tick);
      if (replacement) {
        // 替补 key 绑定濒死 creep 名而非 total 索引：total = 存活 + pending，
        // 随替补请求入队而增长，同一濒死 creep 会在每个评估周期产生新 key 的重复请求；
        // 稳定 key 使 submitRequest 按 key 幂等合并，替换窗口内始终只有一条替补请求。
        const key = replacementKey("remoteHarvester", homeRoom, targetRoom, replacement);
        const body = selectBody("remoteHarvester", energyCapacityAvailable);
        requests.push(createRemoteRequest(
          "remoteHarvester", homeRoom, targetRoom, harvesterTotal,
          key, 1, body, tick, replacement,
        ));
      }
    }

    // 2. Remote Hauler — 每目标 1 个（可配置）。
    const haulerTarget = CONFIG.remote.haulersPerTarget;
    const haulerTotal = (counts.remoteHauler ?? 0) + pending.remoteHauler;
    if (haulerTotal < haulerTarget) {
      const key = spawnKey("remoteHauler", homeRoom, haulerTotal, targetRoom);
      const body = selectBody("remoteHauler", energyCapacityAvailable);
      requests.push(createRemoteRequest(
        "remoteHauler", homeRoom, targetRoom, haulerTotal,
        key, 1, body, tick,
      ));
    } else {
      const replacement = findReplacement(remoteCreeps, "remoteHauler", targetRoom, tick);
      if (replacement) {
        // 稳定替补 key（同 harvester 分支）。
        const key = replacementKey("remoteHauler", homeRoom, targetRoom, replacement);
        const body = selectBody("remoteHauler", energyCapacityAvailable);
        requests.push(createRemoteRequest(
          "remoteHauler", homeRoom, targetRoom, haulerTotal,
          key, 1, body, tick, replacement,
        ));
      }
    }

    // 3. Reserver — 每目标 1 个（可配置，RCL 门禁由系统层检查）。
    if (CONFIG.remote.enableReserver) {
      const reserverTotal = (counts.reserver ?? 0) + pending.reserver;
      if (reserverTotal < 1) {
        const key = spawnKey("reserver", homeRoom, reserverTotal, targetRoom);
        const body = selectBody("reserver", energyCapacityAvailable);
        // reserver body 可能无法在低容量时生成（CLAIM 需要 650 能量）。
        // 如果 body 选择失败（回退到 RECOVERY_BODY），跳过 — 等容量提升后再孵化。
        if (body.includes("claim" as BodyPartConstant)) {
          requests.push(createRemoteRequest(
            "reserver", homeRoom, targetRoom, reserverTotal,
            key, 2, body, tick,
          ));
        }
      } else {
        const replacement = findReplacement(remoteCreeps, "reserver", targetRoom, tick);
        if (replacement) {
          // 稳定替补 key（同 harvester 分支）。
          const key = replacementKey("reserver", homeRoom, targetRoom, replacement);
          const body = selectBody("reserver", energyCapacityAvailable);
          if (body.includes("claim" as BodyPartConstant)) {
            requests.push(createRemoteRequest(
              "reserver", homeRoom, targetRoom, reserverTotal,
              key, 2, body, tick, replacement,
            ));
          }
        }
      }
    }

    // 4. Remote Defender — 已前置到经济孵化之前评估（RM-2：先应战，
    //    威胁未清时经济孵化整体暂停，见循环顶部 hasThreats 分支）。
  }

  return { requests };
}

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────

/** 统计指定远矿目标的各角色存活 creep 数。 */
function countRemoteCreepsByRole(
  creeps: readonly RemoteCreepSummary[],
  targetRoom: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const creep of creeps) {
    if (creep.remoteTarget !== targetRoom) continue;
    const role = creep.role ?? "unknown";
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

/** 统计指定远矿目标的某角色 pending 请求数。 */
function countRemotePending(
  queue: readonly SpawnRequest[],
  role: string,
  targetRoom: string,
): number {
  let count = 0;
  for (const req of queue) {
    if (req.role !== role) continue;
    if (req.memory.remoteTarget !== targetRoom) continue;
    count++;
  }
  return count;
}

/**
 * 查找需要替换的远矿 creep。
 * 阈值 = body.length * 3 + replaceBuffer + travelTicks（跨房通勤更远，加 50 tick 余量）。
 */
function findReplacement(
  creeps: readonly RemoteCreepSummary[],
  role: string,
  targetRoom: string,
  tick: number,
): string | undefined {
  for (const creep of creeps) {
    if (creep.role !== role) continue;
    if (creep.remoteTarget !== targetRoom) continue;
    if (creep.ticksToLive === undefined) continue;
    const threshold = (creep.bodyLength ?? 3) * 3 + CONFIG.spawn.replaceBuffer + 50;
    if (creep.ticksToLive <= threshold) {
      return creep.name;
    }
  }
  return undefined;
}

/**
 * 替补请求的稳定去重 key — 绑定被替换 creep 的名字。
 *
 * 不使用 spawnKey(role, home, total, target)：total = 存活 + pending 之和，
 * 每个评估周期随 pending 增长而漂移，同一濒死 creep 会产生一串不同 key 的
 * 重复请求（P1-5）。creep 名在其生命周期内唯一且稳定，天然幂等。
 */
function replacementKey(role: string, home: string, target: string, dyingCreepName: string): string {
  return `${role}:${home}:${target}:repl:${dyingCreepName}`;
}

/** 创建远矿 SpawnRequest。 */
function createRemoteRequest(
  role: string,
  home: string,
  target: string,
  index: number,
  key: string,
  priority: 0 | 1 | 2 | 3 | 4,
  body: BodyPartConstant[],
  tick: number,
  replaceBy?: string,
): SpawnRequest {
  const req: SpawnRequest = {
    key,
    role,
    home,
    priority,
    body,
    memory: {
      role,
      home,
      mode: "acquire",
      spawnIndex: index,
      remoteTarget: target,
    },
    createdAt: tick,
    // 请求带 TTL：需求消失（运营 paused/abandoned）后的 stale 请求
    // 由 cleanQueue 按 expiresAt 清除，不会永久排队直至孵化。
    expiresAt: tick + CONFIG.spawn.requestTtl,
    retries: 0,
  };
  if (replaceBy) {
    req.replaceBy = tick;
  }
  return req;
}
