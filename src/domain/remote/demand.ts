/** 远矿需求评估 — 纯函数，不访问 Game/Memory。为每个 active 远矿运营评估所需 */

import { CONFIG } from "../../config";
import { selectBody } from "../../config/bodies";
import type { ColonyState } from "../../kernel/contracts";
import type { RoomIntel } from "../intel";
import { spawnKey, countPending } from "../spawn/queue";
import { remoteHaulerTarget, remoteReplacementThreshold, computeHaulerNeed } from "./staffing";

/** 远矿 creep 摘要（与本地 CreepSummary 对齐但精简）。 */
export interface RemoteCreepSummary {
  name: string;
  role: string;
  remoteTarget?: string;
  ticksToLive?: number;
  bodyLength: number;
}

export interface RemoteDemandInput {
  homeRoom: string;
  /** ColonyState（bootstrap 暂停、recovery 限补员，见 R3b 门禁）。 */
  colonyState: ColonyState;
  energyCapacityAvailable: number;
  tick: number;
  /** 远矿运营列表（key = 目标房名）。 */
  remoteOps: Readonly<
    Record<string, { state: string; sources?: number; haulerNeed?: number; lastSeen: number }>
  >;
  /** 所有存活 + 孵化中的远矿 creep 摘要。 */
  remoteCreeps: readonly RemoteCreepSummary[];
  /** 孵化队列（用于 pending 计数）。 */
  spawnQueue: readonly SpawnRequest[];
  /** 远矿房威胁信息（从 Game.rooms 检测，key = 房间名，value = 是否有威胁）。 */
  remoteThreats?: Readonly<Record<string, boolean>>;
  /** 远矿通勤成本（来自 intel，运行时输入，不写入 RemoteOp）。 */
  travelCosts?: Readonly<Record<string, number | undefined>>;
  /** 远矿路径道路覆盖率（key = 目标房名，0-1 连续值）。
   * 覆盖率 ≥ 0.6 时 hauler body 走 2:1 道路满速配比（运力大），< 0.6 时走 1:1 平原满速配比。
   * 缺失时默认 1（保守：2:1 档运力更大优先选）。 */
  roadStatus?: Readonly<Record<string, number | undefined>>;
  /** 外国前置 spawn 拆除任务（key = 目标房名，value = 该房有非我方 spawn 且 controller
   * 仍 neutral）。系统层有视野时检测；claim 一旦发生任务即不成立（对等战争走 war
   * 战役路径，避免 safeMode 风险）。任务存在时该 op 孵 1 只 dismantler 拆除外国
   * spawn，不阻塞经济孵化。 */
  dismantleTargets?: Readonly<Record<string, boolean | undefined>>;
  /** 路径阻断 wall 待拆的远矿房集合 — 通勤路径上有 neutral wall 阻断通行，
   * 需 dismantler 前往拆除。与 dismantleTargets 可同时成立（同一房既有 foreign
   * spawn 又有阻断 wall）。不阻塞经济孵化。 */
  wallClearRooms?: ReadonlySet<string>;
  /**
   * 被 InvaderCore 压制的远矿房集合 — 暂停该房一切孵化（含 defender）。
   * 拆核是纯送死（INVADER_CORE_HITS=100k，defender 20 dmg/tick × 1500 tick
   * 寿命 ≈ 需 5000 tick，且 reserver 对核心的预约无效）；正确策略是止损：
   * 停孵化、撤现役，等核心 decay/冷却后重评估。
   */
  blockedRooms?: ReadonlySet<string>;
  /**
   * 被 level-0 reserve-only 次级核心压制的远矿房集合 — 派轻量 coreClearer 拆核回收名额，
   * 不阻塞运营（核心清除后 demand 立即恢复经济孵）。与 blockedRooms（大要塞规避）互斥。
   */
  clearRooms?: ReadonlySet<string>;
}

export interface RemoteDemandResult {
  requests: SpawnRequest[];
}

/** 评估远矿孵化需求：遍历 active 运营，按目标编制与替换窗口生成 SpawnRequest。纯函数。 */
export function evaluateRemoteDemand(input: RemoteDemandInput): RemoteDemandResult {
  const {
    homeRoom,
    colonyState,
    energyCapacityAvailable,
    tick,
    remoteOps,
    remoteCreeps,
    spawnQueue,
  } = input;
  const requests: SpawnRequest[] = [];

  // 安全门禁（R3b）：bootstrap 暂停（保命孵化优先）；recovery 允许现役 op 补员
  // （远矿是唯一增量收入，冻结致贫困陷阱 — W7N3/W7N4 实证）。
  if (colonyState === "bootstrap") {
    return { requests };
  }

  // CPU 预算保护由系统层把关（conserve 以下不孵化远矿）；本层只查 colonyState。

  for (const [targetRoom, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;

    const counts = countRemoteCreepsByRole(remoteCreeps, targetRoom);

    // InvaderCore 压制房：暂停一切孵化（含 defender）；现役 creep 由
    // remote-mining-manager 的 recycle 通道撤回，核心消失后自动恢复。
    if (input.blockedRooms?.has(targetRoom)) continue;

    // 次级核心清除房：派轻量 clearer 拆核（拆完自动回收），核心清除前不孵经济
    // creep（无法采集）；核心消失后 needCoreClear 清除、demand 正常恢复经济孵。
    const needsClear = input.clearRooms?.has(targetRoom) ?? false;
    if (needsClear) {
      const clearerPending = countRemotePending(spawnQueue, "coreClearer", targetRoom);
      const clearerTotal = (counts.coreClearer ?? 0) + clearerPending;
      if (clearerTotal < 1) {
        const key = spawnKey("coreClearer", homeRoom, clearerTotal, targetRoom);
        const body = selectBody("coreClearer", energyCapacityAvailable);
        requests.push(
          createRemoteRequest(
            "coreClearer",
            homeRoom,
            targetRoom,
            clearerTotal,
            key,
            1,
            body,
            tick,
          ),
        );
      }
      continue;
    }

    // 外国前置 spawn 拆除任务：远矿房出现非我方已建成 spawn 且 controller 仍
    // neutral —— spawn 完成 = 对方随时可 claim，claim 后本 op 变成入侵他人领土
    // （塔 + safeMode 风险），拆除成本翻数倍。claim 前是唯一的低成本拆除窗
    // （neutral 房无塔无防御，dismantle 免费伤害，顶档 dismantler 500 dmg/tick
    // 拆 5000 hits 仅 10 tick）。每 op 同时至多 1 只；不 continue —— 拆迁与
    // 经济采集并行，任务结束（拆完/对方 claim）由系统层回收标记。
    if (
      CONFIG.remote.enableDismantleForeignSpawn &&
      (input.dismantleTargets?.[targetRoom] ?? false)
    ) {
      const dismantlePending = countRemotePending(spawnQueue, "dismantler", targetRoom);
      const dismantleTotal = (counts.dismantler ?? 0) + dismantlePending;
      if (dismantleTotal < 1) {
        const key = spawnKey("dismantler", homeRoom, dismantleTotal, targetRoom);
        const body = selectBody("dismantler", energyCapacityAvailable);
        requests.push(
          createRemoteRequest(
            "dismantler",
            homeRoom,
            targetRoom,
            dismantleTotal,
            key,
            1,
            body,
            tick,
          ),
        );
      }
    }

    // 路径阻断 wall 拆除任务：通勤路径上有 neutral wall 导致 hauler 绕行或卡死。
    // dismantler 前往拆除路径上的 wall（目标查找走 FIND_STRUCTURES 而非
    // FIND_HOSTILE_STRUCTURES，因 neutral wall 无 owner 不属于敌方结构）。
    // 与 foreign spawn dismantle 共享 dismantler 编制（至多 1 只 per op），
    // 不继续 —— 拆墙与经济采集并行，墙拆完后系统层清除 needWallClear + 回收。
    if (input.wallClearRooms?.has(targetRoom)) {
      const dismantlePending = countRemotePending(spawnQueue, "dismantler", targetRoom);
      const dismantleTotal = (counts.dismantler ?? 0) + dismantlePending;
      if (dismantleTotal < 1) {
        const key = spawnKey("dismantler", homeRoom, dismantleTotal, targetRoom);
        const body = selectBody("dismantler", energyCapacityAvailable);
        requests.push(
          createRemoteRequest(
            "dismantler",
            homeRoom,
            targetRoom,
            dismantleTotal,
            key,
            1,
            body,
            tick,
          ),
        );
      }
    }

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
        requests.push(
          createRemoteRequest(
            "remoteDefender",
            homeRoom,
            targetRoom,
            defenderTotal,
            key,
            1,
            body,
            tick,
          ),
        );
      }
    }

    // RM-2：威胁在场（含失明冷却期，系统层已合并进 remoteThreats）暂停经济**扩编**
    // 孵化 — 经济 creep 零战力，威胁未清时扩一批送一批；defender 已在上方评估。
    // 但**替补**放行（replacementKey 绑濒死者 + healthy+pending<target 双门控不变）：
    // dangerUntil 窗口远长于实际袭击时长，连替补也停会让远矿出勤率整个窗口内塌方
    // （线上实证：威胁窗内 remoteHarvester 换代停摆，提取量掉半）。编制不扩只补
    // 濒死者——anti-添油语义保留在扩编侧。
    const economySuppressed = hasThreats;

    // 1. Remote Harvester — 每 source 1 个（2-source 房需 2 只，否则第二源白费）；
    //    op.sources 缺失时回退 harvestersPerTarget，上限 harvestersMaxPerTarget
    //    防未知房 sources 异常虚增编制。
    const harvesterTarget = Math.min(
      op.sources ?? CONFIG.remote.harvestersPerTarget,
      CONFIG.remote.harvestersMaxPerTarget,
    );
    const harvesterTotal = (counts.remoteHarvester ?? 0) + pending.remoteHarvester;
    if (harvesterTotal < harvesterTarget && !economySuppressed) {
      const key = spawnKey("remoteHarvester", homeRoom, harvesterTotal, targetRoom);
      const body = selectBody("remoteHarvester", energyCapacityAvailable);
      requests.push(
        createRemoteRequest(
          "remoteHarvester",
          homeRoom,
          targetRoom,
          harvesterTotal,
          key,
          1,
          body,
          tick,
        ),
      );
    }
    if (harvesterTotal >= harvesterTarget || economySuppressed) {
      const pathCost = input.travelCosts?.[targetRoom];
      const replacement = findReplacement(remoteCreeps, "remoteHarvester", targetRoom, pathCost);
      // 守卫：健康数（含孵化中替补）+ pending 不足编制才补，防替换风暴（见 countHealthyByRole 注释）。
      const healthy = countHealthyByRole(remoteCreeps, "remoteHarvester", targetRoom, pathCost);
      if (replacement && healthy + pending.remoteHarvester < harvesterTarget) {
        // 替补 key 绑定濒死 creep 名而非 total 索引：submitRequest 按 key 幂等合并，队列内始终只有一条替补。
        const key = replacementKey("remoteHarvester", homeRoom, targetRoom, replacement);
        const body = selectBody("remoteHarvester", energyCapacityAvailable);
        requests.push(
          createRemoteRequest(
            "remoteHarvester",
            homeRoom,
            targetRoom,
            harvesterTotal,
            key,
            1,
            body,
            tick,
            replacement,
          ),
        );
      }
    }

    // 2. Remote Hauler — 按当前 body 运力 + pathCost 动态算出所需数量。
    //    不依赖缓存的 haulerNeed，而是用孵化时实际选择的 body 重新算：
    //    RCL 升级后 body 变大，单只吞吐可能覆盖全部 source，haulerNeed 降到 1。
    //    公式：haulerNeed = ceil(source总产出 / 单只吞吐)。
    //    余量（运力 - 产出）超 10% 视为过配，但不在这里缩编（等 manager 重估）。
    const harvestersReady = (counts.remoteHarvester ?? 0) + pending.remoteHarvester;
    const roadCoverage = input.roadStatus?.[targetRoom] ?? 1;
    const hasRoadForHauler = roadCoverage >= 0.6;
    const haulerBody = selectBody("remoteHauler", energyCapacityAvailable, {
      hasRoad: hasRoadForHauler,
    });
    const haulerCarryParts = haulerBody.filter(p => p === CARRY).length;
    const pathCostForHauler = input.travelCosts?.[targetRoom];
    // pathCost 缺失时用缓存 haulerNeed 回退（无 intel 时无法算）。
    const haulerNeed =
      pathCostForHauler !== undefined
        ? computeHaulerNeed(
            op.sources,
            10, // reserved 单 source 10 e/tick
            haulerCarryParts,
            pathCostForHauler,
            roadCoverage,
          ).haulerNeed
        : op.haulerNeed;
    const haulerTarget = remoteHaulerTarget(op.sources, haulerNeed, harvestersReady);
    const haulerTotal = (counts.remoteHauler ?? 0) + pending.remoteHauler;
    if (haulerTotal < haulerTarget && !economySuppressed) {
      const key = spawnKey("remoteHauler", homeRoom, haulerTotal, targetRoom);
      requests.push(
        createRemoteRequest(
          "remoteHauler",
          homeRoom,
          targetRoom,
          haulerTotal,
          key,
          1,
          haulerBody,
          tick,
        ),
      );
    }
    if (haulerTotal >= haulerTarget || economySuppressed) {
      const pathCost = input.travelCosts?.[targetRoom];
      const replacement = findReplacement(remoteCreeps, "remoteHauler", targetRoom, pathCost);
      const healthy = countHealthyByRole(remoteCreeps, "remoteHauler", targetRoom, pathCost);
      if (replacement && healthy + pending.remoteHauler < haulerTarget) {
        // 稳定替补 key（同 harvester 分支）。
        const key = replacementKey("remoteHauler", homeRoom, targetRoom, replacement);
        requests.push(
          createRemoteRequest(
            "remoteHauler",
            homeRoom,
            targetRoom,
            haulerTotal,
            key,
            1,
            haulerBody,
            tick,
            replacement,
          ),
        );
      }
    }

    // 3. Reserver — 每目标 1 个（RCL 门禁由系统层检查）。R3b：仅 normal 生成 —
    //    recovery 下 P2 角色被 kernel 门禁跳过，孵出即在 home 闲置白耗孵化窗。
    //    reserver 不受 economySuppressed 冻结：它是无战力纯 CLAIM 单位，不参与战斗；
    //    reservation 过期 → source 容量减半（3000→1500）→ 5W harvester 采集速率
    //    10/tick > 再生 5/tick → source 被采空 → harvester 空窗，产能损失远大于
    //    reserver 孵化成本（650 能量/600 tick）。
    if (CONFIG.remote.enableReserver && colonyState === "normal") {
      const reserverTotal = (counts.reserver ?? 0) + pending.reserver;
      if (reserverTotal < 1) {
        const key = spawnKey("reserver", homeRoom, reserverTotal, targetRoom);
        const body = selectBody("reserver", energyCapacityAvailable);
        // CLAIM 需 650 能量，低容量时 body 选择回退到 RECOVERY_BODY —
        // 无 claim 部件则跳过，等容量提升后再孵化。
        if (body.includes("claim" as BodyPartConstant)) {
          requests.push(
            createRemoteRequest(
              "reserver",
              homeRoom,
              targetRoom,
              reserverTotal,
              key,
              2,
              body,
              tick,
            ),
          );
        }
      }
      if (reserverTotal >= 1) {
        const pathCost = input.travelCosts?.[targetRoom];
        const replacement = findReplacement(remoteCreeps, "reserver", targetRoom, pathCost);
        const healthy = countHealthyByRole(remoteCreeps, "reserver", targetRoom, pathCost);
        if (replacement && healthy + pending.reserver < 1) {
          // 稳定替补 key（同 harvester 分支）。
          const key = replacementKey("reserver", homeRoom, targetRoom, replacement);
          const body = selectBody("reserver", energyCapacityAvailable);
          if (body.includes("claim" as BodyPartConstant)) {
            requests.push(
              createRemoteRequest(
                "reserver",
                homeRoom,
                targetRoom,
                reserverTotal,
                key,
                2,
                body,
                tick,
                replacement,
              ),
            );
          }
        }
      }
    }

    // 4. Remote Defender — 已前置到经济孵化之前评估（RM-2：先应战，
    //    威胁未清时经济孵化整体暂停，见循环顶部 hasThreats 分支）。
  }

  return { requests };
}

// ── 辅助函数 ──

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
 * creep 是否在替换窗口内（即将死亡，不计入有效编制）。
 * 阈值 = body.length*3 + replaceBuffer + 基于实测 pathCost 的通勤余量；
 * 孵化中/新生 creep（ticksToLive 未定义）视为满编制。
 */
function inReplacementWindow(creep: RemoteCreepSummary, pathCost: number | undefined): boolean {
  if (creep.ticksToLive === undefined) return false;
  const threshold = remoteReplacementThreshold(creep.bodyLength, pathCost);
  return creep.ticksToLive <= threshold;
}

/**
 * 统计「健康」存活数 — 排除替换窗口内濒死者，计入孵化中替补。
 * 替换风暴守卫：原实现只要找到濒死者就补（无编制上限），replacement 出队后
 * pending 归零而濒死者仍在窗口 → 每周期重复触发（线上实测单个 dying reserver
 * 连出 6 个替换，live 飙到 5、配额仅 1）；以「健康数 + pending < target」为闸。
 */
function countHealthyByRole(
  creeps: readonly RemoteCreepSummary[],
  role: string,
  targetRoom: string,
  pathCost: number | undefined,
): number {
  let n = 0;
  for (const c of creeps) {
    if (c.role !== role || c.remoteTarget !== targetRoom) continue;
    if (inReplacementWindow(c, pathCost)) continue;
    n++;
  }
  return n;
}

/** 查找需要替换的远矿 creep（返回第一个进入替换窗口的濒死者名）。 */
function findReplacement(
  creeps: readonly RemoteCreepSummary[],
  role: string,
  targetRoom: string,
  pathCost: number | undefined,
): string | undefined {
  for (const creep of creeps) {
    if (creep.role !== role) continue;
    if (creep.remoteTarget !== targetRoom) continue;
    if (inReplacementWindow(creep, pathCost)) return creep.name;
  }
  return undefined;
}

/**
 * 替补请求稳定去重 key — 绑定被替换 creep 名（P1-5）。
 * 不用 spawnKey(role, home, total, target)：total 随 pending 每周期漂移，
 * 同一濒死者会产生一串不同 key 的重复请求；creep 名生命周期内唯一稳定，天然幂等。
 */
function replacementKey(
  role: string,
  home: string,
  target: string,
  dyingCreepName: string,
): string {
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
