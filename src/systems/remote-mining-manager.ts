/**
 * Remote Mining Manager — P2 系统，远矿运营的中央调度器（interval 10）。
 * 数据流：room-observer（每 50 tick 采 intel）→ 本系统（每 10 tick 评估）→
 * selectRemoteTargets（纯函数筛选）→ evaluateRemoteDemand（纯函数生成请求）→
 * spawnQueue → spawn-manager（孵化执行）。
 * 安全门禁：colonyState 非 normal 暂停新远矿孵化；CPU conserve 以下不孵化；
 * RCL < minRcl 不启动；目标数不超过 maxOperations。P2 — 远矿是扩张行为，不阻塞本房经济。
 */
import { CONFIG } from "../config";
import { selectBody } from "../config/bodies";
import type { Priority, System, TickContext, ColonyState, RoomSnapshot } from "../kernel/contracts";
import { selectRemoteTargets, shouldPauseOperation, effectiveMaxOperations, scoreRemoteCandidate, roomLinearDistance } from "../domain/remote/targeting";
import { evaluateRemoteDemand, type RemoteCreepSummary } from "../domain/remote/demand";
import { classifyThreats } from "../domain/defense/threat";
import { submitRequest } from "../domain/spawn/queue";
import { getRemoteSiteTotal, getTickSiteCounters } from "./site-quota";

export const remoteMiningManagerSystem: System = {
  name: "remote-mining-manager",
  priority: 2 as Priority,
  interval: CONFIG.remote.managerInterval,
  run(ctx: TickContext): void {
    // 跨房去重：汇总全帝国已运营的远矿目标（非 abandoned）。
    // 每个 home 房独立评选时必须排除兄弟房的现役目标 — 双编队抢同一
    // source 收益不变成本翻倍（见 RemoteTargetingInput.globalActiveTargets）。
    const globalActiveTargets = new Set<string>();
    for (const rn of Object.keys(Memory.rooms)) {
      const ops = Memory.rooms[rn]?.remoteOps;
      if (!ops) continue;
      for (const [target, op] of Object.entries(ops)) {
        if (op.state !== "abandoned") globalActiveTargets.add(target);
      }
    }

    // 我方所有殖民地房名（权威 controller.my）— 传入评选以硬排除己方房作远矿目标。
    // 根因：新占殖民地的 intel 滞后未记 owner，selectRemoteTargets 的 info.owner
    // 筛选漏过 → 己方邻居房被当高分目标反复开→被 self-claim 废弃→重选（churn，白孵）。
    const ownedRooms = new Set<string>();
    for (const rn of Object.keys(Game.rooms)) {
      if (Game.rooms[rn]?.controller?.my) ownedRooms.add(rn);
    }

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // RCL 门禁：低于 minRcl 不启动远矿。
      if (snapshot.rcl < CONFIG.remote.minRcl) continue;

      const remoteOps = roomMem.remoteOps ?? {};

      // 1. 评估现有运营：暂停过期、清理废弃、检测敌占/敌方预定、入口封死。
      //    RM-3：被自己 claim 的房 + 敌方预定的房 — 现役远矿 creep 一并回收。
      const { selfClaimed: selfClaimedRooms, hostileReserved: hostileReservedRooms } =
        maintainExistingOps(remoteOps, roomMem.intel, ctx.tick, snapshot.controller?.owner?.username);

      // 1b. v33 空转止损：编队全员空转超时的 op 废弃（物理上无法作业或
      //     全员卡死 — 线上实证 W36S58 墙线困编队空转 44k tick 无产出）。
      censusStalledOps(remoteOps, snapshot.roomName, ctx.tick);

      // 2. 如果 active 运营数不足，从 intel 评选新目标。
      //    战略门禁：开辟新远矿点须获 empire-strategy 姿态授权
      //    （fortify/war 时收缩战线不铺新点）；现役运营不受影响。
      const activeCount = countActiveOps(remoteOps);
      const newOpsAllowed = Memory.kernel?.strategy?.newRemoteOpsAllowed === true;
      // 上限 = 消化能力（storage 有无）与生产能力（spawn 数）取最小。
      const maxOps = effectiveMaxOperations(
        snapshot.storage !== undefined,
        snapshot.spawns.length,
      );
      // R7b：算力容量加码 — abundant 档（余量稳定充足）放宽 1 个远矿点，
      // constrained/tight 不额外收紧（本地收缩已由 tier 看门狗与 posture 处理）。
      const capacityTier = Memory.kernel?.capacity?.tier;
      const maxOpsWithCapacity = capacityTier === "abundant" ? maxOps + 1 : maxOps;

      // 2a. 超额收缩：active 数超上限时废弃通勤最贵的。排序键优先 intel 实测 pathCost
      //     （越远越先砍 — 对应编制成本与孵化位占用），无 intel 回退 haulerNeed；
      //     平局按房名字典序保证确定性（线上教训：仅用 haulerNeed 时双远矿同为 3 形成
      //     平局，字典序误砍了更近的房）。
      //     历史场景：storage 建成放开上限到 2 开双远矿，远程编制 ~11 只占满唯一 spawn，
      //     本地角色饿死。收缩用 abandoned 而非 paused — paused 会被 maintainExistingOps
      //     在 creep 尚在时自动复活（震荡）；abandoned 停止一切孵化、现役 creep 不召回
      //     （沉没成本已付，自然寿终榨干残值）。上限输入都是建筑级稳定量，不会抖动。
      if (activeCount > maxOpsWithCapacity) {
        const costOf = (roomName: string, op: RemoteOp): number =>
          roomMem.intel?.[roomName]?.pathCost ?? (op.haulerNeed ?? 1) * 20;
        const active = Object.entries(remoteOps)
          .filter(([, op]) => op.state === "active")
          .sort((a, b) =>
            costOf(b[0], b[1]) - costOf(a[0], a[1]) ||
            a[0].localeCompare(b[0]),
          );
        for (let i = 0; i < activeCount - maxOpsWithCapacity; i++) {
          const [roomName, op] = active[i]!;
          op.state = "abandoned";
          console.log(
            `[${ctx.tick}] remote/${snapshot.roomName}: 超额收缩，废弃 ${roomName}` +
            `（active ${activeCount} > 上限 ${maxOpsWithCapacity}，通勤成本=${costOf(roomName, op)}）`,
          );
        }
      }

      // remoteHauler 单只运力：按当前能量档位的 body carry 数 ×50。
      // 提前计算：既供新开点评选，也供现役 op 周期重估（A-3/B-6）。
      const haulerBody = selectBody("remoteHauler", snapshot.energyCapacityAvailable);
      const haulerCapacity = haulerBody.filter(p => p === CARRY).length * CARRY_CAPACITY;

      // 现役 op 周期重估：用当前 pathCost + 当前 body 运力重算 netScore/haulerNeed。
      // 一次性快照的反面 —— 开点时勉强达标、后续变差（路况恶化/source 被抢）的
      // 边际 op 若不重估会永续；body 变大后 haulerNeed 也需缩编避免过配。
      reevaluateActiveOps(remoteOps, roomMem, snapshot.roomName, haulerCapacity, ctx.tick);

      // 逐房就绪门（Phase 1b）：帝国姿态放行（newOpsAllowed）之外，本房还须自身经济
      // 成熟才「新开」远矿 — RCL≥roomMinRcl 且 colonyState=normal 且 storage 盈余，
      // 防 RCL4 新占嫩房过早分兵远矿（本该闷头冲级）。现役 op 维护/重估不受影响。
      if (newOpsAllowed && roomReadyForNewRemote(snapshot, roomMem.colonyState) && activeCount < maxOpsWithCapacity) {
        const candidates = selectRemoteTargets({
          homeRoom: snapshot.roomName,
          intel: roomMem.intel,
          existingOps: remoteOps,
          tick: ctx.tick,
          staleThreshold: CONFIG.remote.staleThreshold,
          globalActiveTargets,
          haulerCapacity,
          myUsername: snapshot.controller?.owner?.username,
          ownedRooms,
        });
        // 只补充到有效上限。
        const needed = maxOpsWithCapacity - activeCount;
        for (let i = 0; i < Math.min(needed, candidates.length); i++) {
          const candidate = candidates[i]!;
          remoteOps[candidate.roomName] = {
            state: "active",
            sources: candidate.sources,
            haulerNeed: candidate.haulerNeed,
            createdAt: ctx.tick,
            lastSeen: ctx.tick,
          };
        }
      }

      // 3. 更新 remoteOps 到 Memory。
      if (Object.keys(remoteOps).length > 0) {
        roomMem.remoteOps = remoteOps;
      }

      // 4. 评估远矿 spawn 需求。
      const colonyState: ColonyState = roomMem.colonyState ?? "normal";
      const queue = roomMem.spawnQueue ?? [];

      // 收集远矿 creep 摘要（从 Game.creeps 遍历一次）。
      const remoteCreeps = collectRemoteCreeps(snapshot.roomName);

      // 收集远矿房威胁（有视野的 active 运营房）— evaluateRemoteDemand 据此
      // 生成 remoteDefender 请求；缺少此输入时 defender 分支永不触发。
      const remoteThreats = collectRemoteThreats(remoteOps);

      // RM-2：威胁失明持久化 — 与 InvaderCore blockedUntil 同款双轨。
      // 只用瞬时集合的死角：威胁在场 → 经济 creep 被杀/flee 回家 → 房间失明 →
      // 检测集合空 → 经济孵化恢复 → 新 creep 抵达送死 — 循环送兵。
      // 规则：有视野见威胁 → 写/续期 threatUntil；有视野确认清空 → 清除；
      // 无视野 → 冷却未到期即维持威胁态（宁可少采一轮，不送一批兵）。
      for (const [rn, op] of Object.entries(remoteOps)) {
        if (op.state !== "active") continue;
        const observed = rn in remoteThreats ? remoteThreats[rn] : undefined;
        if (observed === true) {
          op.threatUntil = ctx.tick + CONFIG.remote.threatBlindHold;
        } else if (observed === false) {
          if (op.threatUntil !== undefined) op.threatUntil = undefined;
        } else if (op.threatUntil !== undefined) {
          if (ctx.tick < op.threatUntil) {
            remoteThreats[rn] = true; // 失明期间维持威胁态。
          } else {
            op.threatUntil = undefined;
          }
        }
      }

      // 收集 InvaderCore 压制房（结构不是 creep，FIND_HOSTILE_CREEPS 检测不到）。
      // 核心 100,000 hits，defender/reserver 均无力处理 — 该房进入止损模式：
      // 打上危险冷却 + 暂停孵化 + 回收现役 creep，等核心自然 decay 后自动恢复。
      const remoteBlockers = collectRemoteBlockers(remoteOps);
      // 压制状态持久化：瞬时视野检测 + Memory 冷却双轨合并 — 只用瞬时集合的死角：
      // 回收 creep 后该房失明 → 检测集合清空 → 孵化恢复 → 新 creep 发现核心 → 再回收
      // — 死循环每轮白送整编 creep。规则：有视野见核心 → 写/续期 blockedUntil；
      // 有视野确认消失 → 立即清除；无视野 → 冷却未到期即视为仍被压制。
      const blockedRooms = new Set<string>();
      for (const [rn, op] of Object.entries(remoteOps)) {
        if (op.state !== "active") continue;
        const observed = remoteBlockers[rn];
        if (observed === true) {
          // 有视野且核心在场 — 写入/续期压制冷却。
          op.blockedUntil = ctx.tick + CONFIG.remote.coreBlockCooldown;
          blockedRooms.add(rn);
        } else if (observed === false) {
          // 有视野且确认核心消失 — 提前解封。
          if (op.blockedUntil !== undefined) op.blockedUntil = undefined;
        } else if (op.blockedUntil !== undefined) {
          // 无视野 — 冷却期内维持压制；到期后放行（恢复孵化以重获视野再评估）。
          if (ctx.tick < op.blockedUntil) {
            blockedRooms.add(rn);
          } else {
            op.blockedUntil = undefined;
          }
        }
      }

      // 威胁写入 remoteOps（P1-G：从 intel.dangerUntil 迁移至此）：出现威胁的远矿房
      // 打危险冷却 — 冷却期内不作为新远矿/扩张候选（止损：不给对手送兵）；现役运营
      // 不因此暂停 — defender 已接通，先应战再评估。InvaderCore 压制房同样打冷却。
      for (const [threatRoom, hasThreat] of Object.entries(remoteThreats)) {
        if (!hasThreat && !blockedRooms.has(threatRoom)) continue;
        const op = remoteOps[threatRoom];
        if (op) {
          op.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
        }
      }

      // InvaderCore 压制房的现役远矿 creep 全部标记回收 — harvester 采集被压制、
      // reserver 空耗寿命，留守是持续净亏损。
      // RM-3：被自己 claim 的房同样回收（运营已废弃，该房转本地闭环）；
      // 敌方预定房同样回收现役 creep，并写 dangerUntil 冷却防评选侧立即重开
      // （照 InvaderCore 双轨止损：视野消失后靠冷却维持「该房已被占」判断）。
      for (const rn of hostileReservedRooms) {
        const op = remoteOps[rn];
        if (op) op.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
      }
      const recycleRooms =
        selfClaimedRooms.length > 0 || hostileReservedRooms.length > 0
          ? new Set([...blockedRooms, ...selfClaimedRooms, ...hostileReservedRooms])
          : blockedRooms;
      recycleBlockedRoomCreeps(snapshot.roomName, recycleRooms);

      // P0-A：远矿 container site 收编 — 消费 needContainer 申请标记。
      // siteCount 实测校正 + tick 配额仲裁（让位 emergency）+ 全局总量判定。
      fulfillContainerRequests(remoteOps, ctx, snapshot.roomName);

      // P0-2：主房 crisis 期暂停远矿 spawn 推送（病灶 2 根因）。
      // 旧逻辑 colonyState 只挡「新开点」（roomReadyForNewRemote）+ demand 内部挡
      // bootstrap/reserver，不挡现役 op 的 remoteHarvester/remoteHauler 推送 — 主房
      // RCL5 危机期远矿持续与主房 harvester 竞争 spawn，吸血 54795 tick。
      // 现役远矿 creep 不召回（沉没成本已付，自然寿终榨干残值）；维护逻辑已在上方
      // 运行完毕，本块只跳过新请求推送；下方 recycleExcessRemoteCreeps 仍执行
      // （清理双孵事故冗余）。恢复 normal 后下次 run（≤ managerInterval）即恢复推送。
      const crisisPaused =
        colonyState === "recovery" ||
        colonyState === "bootstrap" ||
        colonyState === "defense";
      if (!crisisPaused) {
        const { requests } = evaluateRemoteDemand({
          homeRoom: snapshot.roomName,
          colonyState,
          energyCapacityAvailable: snapshot.energyCapacityAvailable,
          tick: ctx.tick,
          remoteOps,
          remoteCreeps,
          spawnQueue: queue,
          remoteThreats,
          blockedRooms,
        });

        // 推入 spawnQueue。
        for (const req of requests) {
          submitRequest(queue, req);
        }
        roomMem.spawnQueue = queue;
      }

      // 5. 回收过量远矿 creep（超过配置上限的旧 creep 标记回收，节省 CPU）。
      recycleExcessRemoteCreeps(snapshot.roomName, remoteOps);
    }
  },
};

/**
 * 现役 op 周期经济重估（A-3/B-6）。用当前 intel.pathCost + 当前 body 运力重算
 * netScore/haulerNeed：haulerNeed 写回（body 变大→缩编，防过配）；netScore 连续
 * 低于门槛超过宽限期 → 废弃（防边际 op 永续）。抗抖动：单次波动不撤，回升即清零。
 */
function reevaluateActiveOps(
  remoteOps: Record<string, RemoteOp>,
  roomMem: RoomMemory,
  homeRoom: string,
  haulerCapacity: number,
  tick: number,
): void {
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const info = roomMem.intel?.[roomName];
    const { netScore, haulerNeed } = scoreRemoteCandidate({
      pathCost: info?.pathCost,
      linearDistance: roomLinearDistance(homeRoom, roomName),
      sources: op.sources ?? info?.sources,
      haulerCapacity,
    });
    // 写回最新 haulerNeed（body 档位提升后单只运力增大 → 需要的 hauler 数下降）。
    op.haulerNeed = haulerNeed;
    if (netScore < CONFIG.remote.minNetScore) {
      if (op.lowScoreSince === undefined) {
        op.lowScoreSince = tick; // 首次跌破 — 起算宽限期。
      } else if (tick - op.lowScoreSince > CONFIG.remote.lowScoreGrace) {
        op.state = "abandoned";
        console.log(
          `[${tick}] remote/${homeRoom}: 经济重估废弃 ${roomName}` +
          `（netScore=${netScore.toFixed(1)} < ${CONFIG.remote.minNetScore}，` +
          `持续 ${tick - op.lowScoreSince} tick）`,
        );
      }
    } else if (op.lowScoreSince !== undefined) {
      op.lowScoreSince = undefined; // 回升到门槛以上 — 清除低分计时。
    }
  }
}

/**
 * 维护现有远矿运营：暂停过期运营、更新 lastSeen、清理废弃、检测敌占/敌方预定。
 * 返回需回收现役 creep 的房：selfClaimed（转本地）+ hostileReserved（敌方预定，需写冷却）。
 */
function maintainExistingOps(
  remoteOps: Record<string, RemoteOp>,
  intel: Record<string, import("../domain/intel").RoomIntel> | undefined,
  tick: number,
  myUsername?: string,
): { selfClaimed: string[]; hostileReserved: string[] } {
  // RM-3：被自己 claim 的远矿房（扩张升级为正式殖民地）— 返回给调用方回收现役 creep。
  const selfClaimed: string[] = [];
  // 敌方预定房 — 派 reserver 去只能打无谓拉锯，运行时退出（评选侧已挡新开点，
  // 此处处理"开点后目标房被敌方预定"的运行时发现，照 InvaderCore 止损链模板）。
  const hostileReserved: string[] = [];
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state === "abandoned") continue;

    // 归属校验（需视野）：目标房已有 owner → 废弃运营。
    // intel 对从未有视野的房间记录不到 owner（盲选是远矿自举的必经之路 —
    // 第一只远矿 creep 进房才产生视野），因此把校验放在获得视野之后，
    // 而非在候选筛选阶段排除所有未知房。
    // RM-3 修复：原判定 `owner && !my` 漏掉「被自己 claim」— 该房已转入
    // 本地经济闭环，远矿角色继续运营会与本地 harvester 抢矿位、
    // reserver 对自有 controller 空耗 CLAIM 寿命 — 同样废弃并回收。
    const targetRoom = Game.rooms[roomName];
    if (targetRoom?.controller?.owner) {
      op.state = "abandoned";
      if (targetRoom.controller.my) selfClaimed.push(roomName);
      continue;
    }

    // v33-R11 补丁：现场视野校正 op.sources — 开点时 sources 是 intel 一次性
    // 快照，可能低估（线上实证：W37S57 开点记 1 源，实际 2 源，南源长期无
    // 采集者、满能量空转）。有视野（编队在场）时用实测 source 数校正，
    // 需求侧（harvestersNeeded 以 op.sources 为准）随之补齐配员；
    // 上限仍由 harvestersMaxPerTarget(2) 兜底，未知房异常虚增不会爆编制。
    if (targetRoom) {
      const liveSources = targetRoom.find(FIND_SOURCES).length;
      if (liveSources > 0 && liveSources !== op.sources) {
        op.sources = liveSources;
      }
    }

    // 敌方预定检测（需视野）：controller 被他人预定 → 废弃 + 回收 + 打冷却。
    // 与 owner 检测同层，覆盖"开点后目标房被敌方 reserver 占据"的运行时场景。
    // 己方续期（reservation.username === myUsername）不触发。
    const reservedBy = targetRoom?.controller?.reservation?.username;
    if (reservedBy && reservedBy !== myUsername) {
      op.state = "abandoned";
      hostileReserved.push(roomName);
      continue;
    }

    // v33 入口封死检测（需视野情报）：目标房全部出口都被人工墙封死 → 编队
    // 物理上无法进入，运营=无限白孵 → 废弃。部分封死（如 W36S58 仅西侧墙线）
    // 不废弃 — 编队从其余出口进入后由管线寻路绕行，正常作业。
    // 遗迹 spawn（enemySpawns>0 且 controller 无主）不在此列 — 前任玩家的
    // 房仍可运营远矿（威胁出现时 threatUntil/flee 链接管），占领才需先拆 spawn
    // （见 expansion evaluator 筛选）。
    const info = intel?.[roomName];
    const sealed = info?.sealedExits;
    if (sealed && sealed.length > 0) {
      const exits = Game.map.describeExits(roomName);
      if (exits) {
        const exitDirs = Object.keys(exits).map(Number);
        if (exitDirs.length > 0 && exitDirs.every((d) => sealed.includes(d))) {
          op.state = "abandoned";
          console.log(
            "[" + tick + "] remote/" + (myUsername ?? "?") + ": 入口封死废弃 " + roomName +
            "（sealedExits=[" + sealed.join(",") + "]，编队无法进入）",
          );
          continue;
        }
      }
    }

    // 检查是否有 creep 在该远矿房（有则更新 lastSeen）。
    const hasCreep = hasCreepInRoom(roomName);
    if (hasCreep) {
      op.lastSeen = tick;
    }

    // 过期暂停。
    if (shouldPauseOperation(op, tick, CONFIG.remote.staleThreshold)) {
      if (op.state === "active") {
        op.state = "paused";
      }
    } else if (op.state === "paused") {
      // 恢复：有新视野或 creep 到达时恢复 active。
      if (hasCreep) {
        op.state = "active";
        op.lastSeen = tick;
      }
    }
  }

  // 清理长期废弃的运营（超过 staleThreshold * 3 且无 creep）。
  const abandonThreshold = CONFIG.remote.staleThreshold * 3;
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state === "paused" && tick - op.lastSeen > abandonThreshold) {
      op.state = "abandoned";
    }
  }

  // 清理 abandoned 超过 10000 tick 的记录（防止 Memory 膨胀）。
  const cleanupThreshold = CONFIG.remote.staleThreshold * 6;
  for (const roomName of Object.keys(remoteOps)) {
    const op = remoteOps[roomName]!;
    if (op.state === "abandoned" && tick - op.lastSeen > cleanupThreshold) {
      delete remoteOps[roomName];
    }
  }
  return { selfClaimed, hostileReserved };
}

/** 逐房「新开远矿」就绪门（Phase 1b，纯函数便于单测）。
 *
 * 帝国姿态放行（newRemoteOpsAllowed）之外的**本房**门槛：本房经济须自身成熟，
 * 才允许再新开远矿点——RCL≥roomMinRcl 且 colonyState=normal 且 storage 盈余
 * ≥roomMinStorage。防止新占嫩房（RCL4、无 storage 缓冲）过早分兵远矿。
 * 只影响「是否新开」，不影响现役 op 的维护/重估/回收。 */
export function roomReadyForNewRemote(
  snapshot: RoomSnapshot,
  colonyState: ColonyState | undefined,
): boolean {
  if (snapshot.rcl < CONFIG.remote.roomMinRcl) return false;
  if (colonyState !== "normal") return false;
  const storageEnergy = snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
  return storageEnergy >= CONFIG.remote.roomMinStorage;
}

/** 统计 active 状态的运营数。 */
function countActiveOps(remoteOps: Readonly<Record<string, RemoteOp>>): number {
  let count = 0;
  for (const op of Object.values(remoteOps)) {
    if (op.state === "active") count++;
  }
  return count;
}

/**
 * v33 远矿空转普查 — 对每个 active op 统计编队健康度，全员空转超时 → 废弃。
 * 反馈闭环：manager 原本只看「账面」指标（sources/pathCost/netScore），看不到
 * 「编队实际在不在干活」— W36S58 线上实证：账面上 2 源近距高分房，实际编队
 * 被前任玩家墙线困住空转 44k tick、零产出、无限补员。本普查是吞吐反馈安全网。
 *
 * 空转判定（单只）：mode 为 idle/flee，或 stuckTicks ≥ CONFIG.remote.stallStuckTicks。
 * 通勤中的 acquire/work、正常采集搬运均计为工作。全员空转计时进 op.stallSince；
 * 任一成员恢复工作（或编队归零 — 孵化替换窗口）立即清零（抗抖动）。
 * 成本：每 managerInterval 一次 Game.creeps 全遍历（O(creeps)，10 tick 分摊）。
 */
function censusStalledOps(
  remoteOps: Record<string, RemoteOp>,
  homeRoom: string,
  tick: number,
): void {
  // 单次遍历全部 creep，按 remoteTarget 归组（远矿编队规模小，Map 摊还成本可忽略）。
  const byTarget = new Map<string, { total: number; stalled: number }>();
  for (const creep of Object.values(Game.creeps)) {
    if (creep.spawning || creep.memory.recycle) continue;
    if (creep.memory.home !== homeRoom) continue;
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const op = remoteOps[target];
    if (!op || op.state !== "active") continue;
    let entry = byTarget.get(target);
    if (!entry) {
      entry = { total: 0, stalled: 0 };
      byTarget.set(target, entry);
    }
    entry.total++;
    const mode = creep.memory.mode;
    const stuck = creep.memory.stuckTicks ?? 0;
    if (mode === "idle" || mode === "flee" || stuck >= CONFIG.remote.stallStuckTicks) {
      entry.stalled++;
    }
  }

  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const entry = byTarget.get(roomName);
    if (!entry || entry.total === 0) {
      // 编队归零（新开点孵化中 / 换代替换窗口）— 不计空转。
      if (op.stallSince !== undefined) op.stallSince = undefined;
      continue;
    }
    if (entry.stalled === entry.total) {
      if (op.stallSince === undefined) {
        op.stallSince = tick;
      } else if (tick - op.stallSince > CONFIG.remote.stallAbandonTicks) {
        op.state = "abandoned";
        console.log(
          "[" + tick + "] remote/" + homeRoom + ": 空转止损废弃 " + roomName +
          "（编队 " + entry.total + " 只全员空转持续 " + (tick - op.stallSince) + " tick）",
        );
      }
    } else if (op.stallSince !== undefined) {
      op.stallSince = undefined;
    }
  }
}

/** 检查是否有 creep 在指定房间（通过 Game.rooms 判断可见性 + creep 存在）。 */
function hasCreepInRoom(roomName: string): boolean {
  const room = Game.rooms[roomName];
  if (!room) return false;
  // 检查是否有自己的 creep 在该房间。
  return Object.values(Game.creeps).some(
    (c) => c.room.name === roomName && c.my,
  );
}

/**
 * 回收过量远矿 creep。
 *
 * 当某远矿目标的存活 creep 数超过配置上限时，标记多余的 creep 回收。
 * 回收标记由 spawn-manager 的 recyclePass 实际执行（spawn.recycleCreep）。
 *
 * 交接豁免（关键）：demand 的 findReplacement 会在老 creep 进入替换窗口时
 * 提前孵化替补 — 交接重叠期同角色 2 只并存是**设计行为**，不是超额。
 * 无豁免的后果（线上实测的孵化→秒杀→再孵化循环）：
 *   1. 孵化中的替补 ticksToLive 为 undefined，按 ?? 0 排序被当成「最老」
 *      标记回收 — 替补出场即走向 spawn 消融；
 *   2. collectRemoteCreeps 排除 recycle 标记者 → demand 视角编制归零 →
 *      立即再孵 → 新替补再次与垂死者并存 → 再被标记，能量无限空烧
 *      （reserver 因 CLAIM 寿命仅 600 tick 替换最频繁，观感最明显）。
 * 因此：孵化中的不参与判定；替换窗口内的垂死者豁免（交接退场方，
 * 任其自然寿终 — 远矿角色被标记后跨房走回家的路程往往长于余命，
 * 回收残值拿不到还白丢交接期产出）；只有多只健康成员并存（双孵事故）
 * 才是真超额，保留最年轻、回收其余。
 *
 * @internal 导出仅供单元测试（tests/unit/remote/recycle-excess.test.ts）—
 *           业务代码唯一入口是 remoteMiningManagerSystem.run。
 */
export function recycleExcessRemoteCreeps(
  homeRoom: string,
  remoteOps: Readonly<Record<string, RemoteOp>>,
): void {
  // 收集每个 active 目标的远矿 creep，按角色分组。
  const byTarget = new Map<string, { harvester: Creep[]; hauler: Creep[]; reserver: Creep[]; defender: Creep[] }>();

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    if (creep.memory.recycle) continue; // 已标记回收的跳过。
    if (creep.spawning) continue; // 孵化中的替补未上岗，不参与配额判定。
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const op = remoteOps[target];
    if (!op || op.state !== "active") continue;

    let entry = byTarget.get(target);
    if (!entry) {
      entry = { harvester: [], hauler: [], reserver: [], defender: [] };
      byTarget.set(target, entry);
    }
    const role = creep.memory.role;
    if (role === "remoteHarvester") entry.harvester.push(creep);
    else if (role === "remoteHauler") entry.hauler.push(creep);
    else if (role === "reserver") entry.reserver.push(creep);
    else if (role === "remoteDefender") entry.defender.push(creep);
  }

  // 替换窗口判定 — 与 demand 的 findReplacement 完全同口径。
  const inReplacementWindow = (c: Creep): boolean =>
    c.ticksToLive !== undefined &&
    c.ticksToLive <= c.body.length * 3 + CONFIG.spawn.replaceBuffer + 50;

  // 组内标记：豁免垂死交接者后，健康成员超出配额的部分回收（保留最年轻）。
  const markExcess = (creeps: Creep[], quota: number): void => {
    const healthy = creeps.filter(c => !inReplacementWindow(c));
    if (healthy.length <= quota) return;
    healthy.sort((a, b) => (b.ticksToLive ?? 0) - (a.ticksToLive ?? 0));
    for (let i = quota; i < healthy.length; i++) {
      healthy[i]!.memory.recycle = true;
    }
  };

  for (const [target, entry] of byTarget) {
    // harvester 配额必须与 demand 侧同口径（B-1：按 op.sources 孵化，上限
    // harvestersMaxPerTarget）。若此处仍用固定 harvestersPerTarget=1，则
    // demand 孵 2（2-source）、回收判超额杀 1 — 与下方 hauler 曾经的口径分裂
    // 同源，形成孵化→回收→重孵死循环。
    markExcess(
      entry.harvester,
      Math.min(
        remoteOps[target]?.sources ?? CONFIG.remote.harvestersPerTarget,
        CONFIG.remote.harvestersMaxPerTarget,
      ),
    );
    // hauler 配额必须与 demand 侧同口径（op.haulerNeed 动态编制，回退
    // haulersPerTarget）。远矿 2.0 引入动态编制时此处漏改，口径分裂成
    // 「孵化按 haulerNeed=2-3、回收按固定值 1」— 编制内的健康 hauler
    // 被反复标记回收，collectRemoteCreeps 又排除被标记者，demand 视角
    // 缺编再孵，形成孵化→回收死循环（线上实测：W7N3 编制 2 只，第 2 只
    // 永远 recycle=true，每轮白烧一具 body + 跨房返程）。
    markExcess(entry.hauler, remoteOps[target]?.haulerNeed ?? CONFIG.remote.haulersPerTarget);
    markExcess(entry.reserver, 1);
    markExcess(entry.defender, 1);
  }
}

/** 收集归属于本房的所有远矿 creep 摘要。 */
function collectRemoteCreeps(homeRoom: string): RemoteCreepSummary[] {
  const result: RemoteCreepSummary[] = [];
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    // RD-1：回收中的 creep 不算编制 — 半血撤退的 defender / 被撤回的
    // 经济 creep 已退出战斗力序列，计入会挡住接替者的孵化。
    if (creep.memory.recycle === true) continue;
    const role = creep.memory.role ?? "unknown";
    // 只收集远矿角色。
    if (role !== "remoteHarvester" && role !== "remoteHauler" && role !== "reserver" && role !== "remoteDefender") {
      continue;
    }
    result.push({
      name: creep.name,
      role,
      remoteTarget: creep.memory.remoteTarget,
      ticksToLive: creep.ticksToLive,
      bodyLength: creep.body.length,
    });
  }
  return result;
}

/**
 * 收集远矿房威胁信息 — 检测 active 运营的远矿房是否有 hostile creep。
 * 用于触发 remoteDefender 孵化需求。导出供接线测试验证 body-aware 口径。
 */
export function collectRemoteThreats(remoteOps: Readonly<Record<string, RemoteOp>>): Record<string, boolean> {
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
 * 收集 InvaderCore 压制信息 — 检测 active 运营的远矿房是否被 InvaderCore 占据。
 *
 * InvaderCore 是敌对结构而非 creep，FIND_HOSTILE_CREEPS 检测不到 —
 * 「房里只有一个核心、没有 Invader creep」的场景在旧实现中完全漏报，
 * 运营继续送 harvester/reserver 空耗。检测需要视野（active 房通常有驻场 creep）。
 * 导出供接线测试验证检测链路。
 */
export function collectRemoteBlockers(remoteOps: Readonly<Record<string, RemoteOp>>): Record<string, boolean> {
  const blockers: Record<string, boolean> = {};
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) continue;
    const cores = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
    });
    blockers[roomName] = cores.length > 0;
  }
  return blockers;
}

/**
 * 回收 InvaderCore 压制房的现役远矿 creep。
 *
 * 核心压制期间该房是净亏损：source 被敌方预约压在 1500 容量、
 * reserver 打不动核心持续续期的预约。标记 recycle 后 role-runner 短路停工，
 * spawn-manager 的 recyclePass 引导回收；孵化冻结由 blockedRooms 负责，
 * 核心 decay 后运营自动恢复（remoteOps 状态与 intel 均保留）。
 */
function recycleBlockedRoomCreeps(homeRoom: string, blockedRooms: ReadonlySet<string>): void {
  if (blockedRooms.size === 0) return;
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    if (creep.memory.recycle) continue;
    const target = creep.memory.remoteTarget;
    if (!target || !blockedRooms.has(target)) continue;
    creep.memory.recycle = true;
  }
}

/**
 * P0-A：远矿 container site 收编 — 消费 remoteHarvester 的 needContainer 申请标记。
 *
 * 职责（每 managerInterval tick 运行一次）：
 *   1. **siteCount 实测校正**（评审修正必须）：用 room.find 统计该房现存 container
 *      construction site 数，写回 op.siteCount — site 建成（变结构）/被移除/失效时
 *      递减，防只增不减永久占满 maxGlobalSites 饿死自有房重建。
 *   2. **消费申请**：收集 needContainer=true 的 remoteHarvester，按 source 分组处理。
 *   3. **配额仲裁**：远矿 site 永远让位自有房 emergency（emergency > 0 → 跳过）；
 *      normal 槽位与 construction-manager 公平竞争（normal > 0 → 跳过）；
 *      总量 ctx.globalSiteCount + remoteSiteTotal < maxGlobalSites。
 *   4. **创建 site**：在站桩位 creep 脚下创建 container site，成功后清标记 +
 *      递增 siteCount + 标记 normal 槽位已用；失败写 containerSiteCooldown 防重试。
 *
 * 回收：远矿 site 的孤儿清扫复用 construction-manager.ts 的 cleanOrphanConstructionSites
 * （abandoned 房不在 computeSiteKeepRooms 保留集，低频被 remove）— 不新增第二条删除路径。
 *
 * @internal 导出仅供单元测试 — 业务代码唯一入口是 remoteMiningManagerSystem.run。
 */
export function fulfillContainerRequests(
  remoteOps: Record<string, RemoteOp>,
  ctx: TickContext,
  homeRoom: string,
): void {
  const counters = getTickSiteCounters();

  // R3：申请者收集提到 per-room 循环外，单遍按 remoteTarget 分桶。
  // R 个 active 远矿房原本需 R 次全量 Game.creeps 遍历（O(R×M)），
  // 提桶后降为 O(M) 一次。managerInterval 低频，但多远矿房时仍是可见节流。
  // 分桶仅保留 needContainer=true 且有 sourceId 的 creep，per-room 循环内
  // 二次按 sourceId 分组（与原逻辑等价）。
  const requestingByRemote = new Map<string, Creep[]>();
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.home !== homeRoom) continue;
    if (!creep.memory.needContainer) continue;
    const target = creep.memory.remoteTarget;
    if (!target) continue;
    const sid = creep.memory.sourceId as string | undefined;
    if (!sid) continue;
    let arr = requestingByRemote.get(target);
    if (!arr) { arr = []; requestingByRemote.set(target, arr); }
    arr.push(creep);
  }

  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) continue; // 无视野，无法校正也无法创建。

    // 1. siteCount 实测校正 — 同时收集每个 site 附近 source（R2）。
    //    R2：旧实现"actualSites > 0 即清全部 source 组申请标记"，多源远矿房中
    //    A 源建成会一并清 B 源申请 → B 源 creep 等不到 site；A 源 site 成孤儿时
    //    B 被一并阻塞至 orphan sweep 清场。收窄到"已有 site 的 source 组"：
    //    用 room.find 一次拿到 sites 与 sources，对每个 site 找 range<=1 的 source。
    const sites = room.find(FIND_CONSTRUCTION_SITES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    op.siteCount = sites.length;

    const sourcesWithSite = new Set<string>();
    if (sites.length > 0) {
      const sources = room.find(FIND_SOURCES);
      for (const site of sites) {
        for (const src of sources) {
          if (site.pos.getRangeTo(src) <= 1) {
            sourcesWithSite.add(src.id);
          }
        }
      }
    }

    // 2. 取本房申请者，按 sourceId 二次分组。
    const candidates = requestingByRemote.get(roomName) ?? [];
    const requestingBySource = new Map<string, Creep[]>();
    for (const creep of candidates) {
      const sid = creep.memory.sourceId as string | undefined;
      if (!sid) continue;
      let group = requestingBySource.get(sid);
      if (!group) { group = []; requestingBySource.set(sid, group); }
      group.push(creep);
    }

    // 3. 已有 site 的 source 组 → 清除该组申请标记（site 存在即申请已 fulfilled，
    //    build 路径接管）并从 pending Map 移除。R2：未在 sourcesWithSite 中的
    //    source 组（无 site）申请标记保留，继续走创建路径。
    for (const sid of sourcesWithSite) {
      const group = requestingBySource.get(sid);
      if (group) {
        for (const creep of group) creep.memory.needContainer = false;
        requestingBySource.delete(sid);
      }
    }

    // 4. 无 pending 申请 → 跳过（所有 source 都已有 site 或本就无申请）。
    if (requestingBySource.size === 0) continue;

    // 5. tick 配额仲裁：远矿让位 emergency（自有房紧急重建优先）；normal 槽位公平竞争。
    if (counters.emergency > 0) continue;
    if (!counters.canCreateNormal) continue;

    // 6. 总量判定：自有房 site + 远矿 site < maxGlobalSites。
    const remoteTotal = getRemoteSiteTotal();
    if (ctx.globalSiteCount + remoteTotal >= CONFIG.construction.maxGlobalSites) continue;

    // 7. 处理第一个有效申请（找到站桩位 creep 创建 site）。
    let fulfilled = false;
    for (const [sid, group] of requestingBySource) {
      // R2 防御性跳过：该 source 已有 site（step 3 应已 delete，但 Set 校验双保险）。
      if (sourcesWithSite.has(sid)) continue;
      const source = Game.getObjectById(sid as Id<Source>);
      if (!source) continue;
      // 找到在 source 旁 1 格内的 creep（站桩位 = container 位）。
      const positioned = group.find(c => c.pos.getRangeTo(source) <= 1);
      if (!positioned) continue;

      const result = room.createConstructionSite(positioned.pos, STRUCTURE_CONTAINER);
      if (result === OK) {
        // 成功：递增 siteCount（校正值已为 0，直接设 1）、标记 normal 槽位。
        op.siteCount = 1;
        counters.markNormal();
        fulfilled = true;
      } else {
        // 持久失败（ERR_FULL / ERR_INVALID_TARGET）：写冷却让 resolve 放行 dropEnergy。
        for (const c of group) c.memory.containerSiteCooldown = Game.time + 100;
      }
      // 无论成功失败，清除该 source 组的申请标记（防重复申请）。
      for (const c of group) c.memory.needContainer = false;
      break; // 每 tick 每房最多处理 1 个 source（tick 配额已由 counters 限制全局 1 个）。
    }

    // 如果本房成功创建，后续房让出 normal 槽位（counters.canCreateNormal 已变 false）。
    if (fulfilled) break;
  }
}

