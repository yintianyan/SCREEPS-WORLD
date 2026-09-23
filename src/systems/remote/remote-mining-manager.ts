/** Remote Mining Manager — run 编排；账本/回收/情报/道路分别见 ./remote/ 子模块。 */
import { CONFIG } from "../../config";
import { selectBody } from "../../config/bodies";
import type { Priority, System, TickContext, ColonyState } from "../../kernel/contracts";
import { selectRemoteTargets, effectiveMaxOperations } from "../../domain/remote/targeting";
import { INVADER_USERNAME } from "../../domain/intel";
import { evaluateRemoteDemand } from "../../domain/remote/demand";
import { submitRequest } from "../../domain/spawn/queue";
import {
  globalCache,
  querySquad,
  peekRemoteOpLedger,
  setRemoteOpLedger,
  pruneRemoteOpLedgers,
} from "../../kernel/global-cache";
import { emptyOpLedger, toOpLedgerSnapshot, recordOpCpu } from "../../domain/remote/op-ledger";
import { intelPayloadView } from "../intelligence";
import {
  decideRemoteDefenseAction,
  type RemoteOperationState,
  type EmpireContext,
  type LogisticsContext,
  type MilitaryContext,
} from "../../domain/defense/remote-defense";
import { log } from "../../kernel/log";
import {
  maintainExistingOps,
  censusStalledOps,
  countActiveOps,
  roomReadyForNewRemote,
  reevaluateActiveOps,
  enforceMeasuredEconomics,
  syncOpLedger,
  logRemoteLedgers,
} from "./op-lifecycle";
import {
  collectRemoteCreeps,
  recycleExcessRemoteCreeps,
  recycleBlockedRoomCreeps,
  recycleRemoteCreepsForRoom,
  recycleRemoteDismantlers,
} from "./creep-recycle";
import {
  collectRemoteThreats,
  collectRemoteBlockers,
  buildRemoteThreatAssessment,
  collectEmpireEnergyReserve,
  estimateCreepInvestment,
} from "./blocker-intel";
import {
  fulfillContainerRequests,
  planRemotePathRoads,
  detectPathWallBlockers,
  detectRoadCoverage,
} from "./road-planner";

// 保留既有导入面（单测直接从 remote-mining-manager 引用各子模块的 @internal 导出）。
export { syncOpLedger, enforceMeasuredEconomics, roomReadyForNewRemote } from "./op-lifecycle";
export { recycleExcessRemoteCreeps } from "./creep-recycle";
export {
  collectRemoteThreats,
  classifyInvaderCores,
  collectRemoteBlockers,
  type RemoteBlockerState,
} from "./blocker-intel";
export { fulfillContainerRequests, selectRemoteRoadTiles } from "./road-planner";

export const remoteMiningManagerSystem: System = {
  name: "remote-mining-manager",
  priority: 2 as Priority,
  interval: CONFIG.remote.managerInterval,
  run(ctx: TickContext): void {
    // 跨房去重：汇总全帝国已运营的远矿目标（非 abandoned）。
    // FINDING-17 修复：只遍历自有房的 remoteOps（ctx.snapshots()），
    // 不再遍历 Object.keys(Memory.rooms)——失守房 grace 期内残留的
    // remoteOps 会被错误计入 globalActiveTargets，排除兄弟房可用远矿。
    const globalActiveTargets = new Set<string>();
    for (const snap of ctx.snapshots()) {
      const ops = Memory.rooms[snap.roomName]?.remoteOps;
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

    // IntelQuery payload 视图（subject 全局去重；RoomIntel 字段集与 legacy 一致）。
    const intel = intelPayloadView();

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // RCL 门禁：低于 minRcl 不启动远矿。
      if (snapshot.rcl < CONFIG.remote.minRcl) continue;

      const remoteOps = roomMem.remoteOps ?? {};

      // 1. 评估现有运营：暂停过期、清理废弃、检测敌占/敌方预定、入口封死。
      //    RM-3：被自己 claim 的房 + 敌方预定的房 — 现役远矿 creep 一并回收。
      const { selfClaimed: selfClaimedRooms, hostileReserved: hostileReservedRooms } =
        maintainExistingOps(
          remoteOps,
          snapshot.roomName,
          intel,
          ctx.tick,
          snapshot.controller?.owner?.username,
        );

      // 1b. v33 空转止损：编队全员空转超时的 op 废弃（物理上无法作业或
      //     全员卡死 — 线上实证 W36S58 墙线困编队空转 44k tick 无产出）。
      censusStalledOps(remoteOps, snapshot.roomName, ctx.tick);

      // 2. 如果 active 运营数不足，从 intel 评选新目标。
      //    战略门禁：开辟新远矿点须获 empire-strategy 姿态授权
      //    （fortify/war 时收缩战线不铺新点）；现役运营不受影响。
      const activeCount = countActiveOps(remoteOps);
      const newOpsAllowed = Memory.kernel?.strategy?.newRemoteOpsAllowed === true;
      // 上限 = 消化能力（storage 有无）与生产能力（spawn 数）取最小。
      const maxOps = effectiveMaxOperations(snapshot.storage !== undefined, snapshot.spawns.length);
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
          intel[roomName]?.pathCost ?? (op.haulerNeed ?? 1) * 20;
        const active = Object.entries(remoteOps)
          .filter(([, op]) => op.state === "active")
          .sort((a, b) => costOf(b[0], b[1]) - costOf(a[0], a[1]) || a[0].localeCompare(b[0]));
        for (let i = 0; i < activeCount - maxOpsWithCapacity; i++) {
          const [roomName, op] = active[i]!;
          op.state = "abandoned";
          log.info(
            "remote-mining-manager",
            `remote/${snapshot.roomName}: 超额收缩，废弃 ${roomName}` +
              `（active ${activeCount} > 上限 ${maxOpsWithCapacity}，通勤成本=${costOf(roomName, op)}）`,
          );
        }
      }

      // remoteHauler 单只运力：按当前能量档位的 body carry 数 ×50。
      // 提前计算：既供新开点评选，也供现役 op 周期重估（A-3/B-6）。
      // hasRoad=false：远矿路径通常无道路，selectBody 选 1:1 平原满速配比档
      // （CARRY 少但 MOVE 多，无疲劳），carry 数与 2:1 档不同 → 必须同口径。
      // 检测每个远矿房的道路覆盖状态：有视野时扫描通勤路径上已建成 road 的覆盖率。
      // 失明时保守 0（无路），与现有逻辑一致。道路修好后覆盖率上升，使 body 和
      // haulerNeed 同步切到 2:1 道路满速档（运力 ×1.5，编制可缩编）。
      const roadStatus = detectRoadCoverage(snapshot.roomName, remoteOps);
      // haulerCapacity 取无路档（保守下界）做评选，避免道路未覆盖时高估运力。
      const haulerBody = selectBody("remoteHauler", snapshot.energyCapacityAvailable, {
        hasRoad: false,
      });
      const haulerCapacity = haulerBody.filter(p => p === CARRY).length * CARRY_CAPACITY;

      // 现役 op 周期重估：用当前 pathCost + 当前 body 运力重算 netScore/haulerNeed。
      // 一次性快照的反面 —— 开点时勉强达标、后续变差（路况恶化/source 被抢）的
      // 边际 op 若不重估会永续；body 变大后 haulerNeed 也需缩编避免过配。
      // A4.4 决策权退休（2026-09 实测教训）：曾设计「Plan 的 scope="operation" 请求
      // 拥有 haulerNeed 决策权、重估降级为信号」，但 planLogistics 实际只产
      // "empire" scope（contracts/deficits 两源），operation 请求从未存在 ——
      // 消费端永不触发，而重估被 planActive（planner 每 100t 刷新 → plannedAt
      // 几乎恒新）永久哑火。双写端全部静默 = op.haulerNeed 冻结在开点值：
      // W36S58 冻结在 1（2 源满产 20 e/t vs 单 hauler ~2.5 e/t 运力），
      // container 长期溢出、18k tick 零交付、15 万孵化投入归零。
      // 修复后重估是唯一决策源，每 interval 按实测 pathCost/body 重算。
      reevaluateActiveOps(
        remoteOps,
        intel,
        snapshot.roomName,
        haulerCapacity,
        roadStatus,
        ctx.tick,
      );

      // 逐房就绪门（Phase 1b）：帝国姿态放行（newOpsAllowed）之外，本房还须自身经济
      // 成熟才「新开」远矿 — RCL≥roomMinRcl 且 colonyState=normal 且 storage 盈余，
      // 防 RCL4 新占嫩房过早分兵远矿（本该闷头冲级）。现役 op 维护/重估不受影响。
      if (
        newOpsAllowed &&
        roomReadyForNewRemote(snapshot, roomMem.colonyState) &&
        activeCount < maxOpsWithCapacity
      ) {
        const candidates = selectRemoteTargets({
          homeRoom: snapshot.roomName,
          intel,
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
          // Invader 预定 = Core 占坑：无视野时也先标 needCoreClear，demand 首波孵
          // clearer 而不是经济编队（否则第一波 harvester 进房即被核心压制、再走
          // 回收→失明）。有视野后 collectRemoteBlockers 会按 lesser/stronghold/clear 校正。
          const reservedByInvader = intel[candidate.roomName]?.reservedBy === INVADER_USERNAME;
          remoteOps[candidate.roomName] = {
            state: "active",
            sources: candidate.sources,
            haulerNeed: candidate.haulerNeed,
            createdAt: ctx.tick,
            lastSeen: ctx.tick,
            ...(reservedByInvader ? { needCoreClear: true } : {}),
          };
          // 同 tick 双房去重：globalActiveTargets 在快照循环外构建，本轮新开的目标
          // 不在集合里 —— 后续兄弟房同 tick 评选时会把它当未占用目标重复开点
          // （双编队抢同一 source）。开点即加入，保证集合与新开动作同步。
          globalActiveTargets.add(candidate.roomName);
          // 账本窗口从开点 tick 起算：首笔交付前孵化成本就已发生，
          // 若从首笔交付起算，投入会被漏计（窗口越长偏差越大）。
          setRemoteOpLedger(snapshot.roomName, candidate.roomName, emptyOpLedger(ctx.tick));
        }
      }

      // 3. 更新 remoteOps 到 Memory。
      if (Object.keys(remoteOps).length > 0) {
        roomMem.remoteOps = remoteOps;
      }

      // 3b. 账本 GC：按「op 记录是否还存在」清理，而非「是否 active」。
      //     废弃 op 的账本留到记录被删：既保留复盘数据，也避免其现役 creep 在
      //     余命内继续交付时把账本反复删了又建（heap 空壳 → 计数丢失）。
      //     重新开同一目标房时由开点播种显式重置，不会继承旧计数。
      pruneRemoteOpLedgers(snapshot.roomName, new Set(Object.keys(remoteOps)));

      // 3c. 账本 Memory ↔ heap 同步并回写。heap 是实时累加器（creeps 层只写 heap，
      //     remoteOps 归本管理器唯一写入），Memory 负责跨 global reset 存活。
      for (const [target, op] of Object.entries(remoteOps)) {
        op.ledger = toOpLedgerSnapshot(
          syncOpLedger(snapshot.roomName, target, op.ledger, ctx.tick),
        );
      }

      // 3d. 实测经济门：账本已同步到本 tick，据此收缩实测亏损的远矿线。
      enforceMeasuredEconomics(remoteOps, snapshot.roomName, ctx.tick);

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
      // A5.1：有视野确认有威胁时，额外调用 decideRemoteDefenseAction() 做结构化决策。
      // decideRemoteDefenseAction 是纯函数 (O(1))，仅在有威胁时调用，CPU 影响可忽略。
      // 决策结果写入 globalCache.remoteDefenseDecisions 供诊断观测。
      const gRemoteDecisions = (globalCache().remoteDefenseDecisions ??= new Map());
      gRemoteDecisions.clear(); // 每 interval 清空旧决策
      const posture = Memory.kernel?.strategy?.posture ?? "develop";
      const cpuTier = Memory.kernel?.capacity?.tier ?? "comfortable";
      const empireEnergyReserve = collectEmpireEnergyReserve();
      const activeRemoteCount = countActiveOps(remoteOps);
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

        // dangerUntil 失明保护：失明（observed=undefined）且 threatUntil 已清除但
        // dangerUntil 仍有效时，继续冻结经济孵化。该房最近发生过危险事件，
        // 冷却期内不给对手送兵。有视野时信任新鲜观测，不应用此保护。
        if (
          observed === undefined &&
          remoteThreats[rn] !== true &&
          op.dangerUntil !== undefined &&
          ctx.tick < op.dangerUntil
        ) {
          remoteThreats[rn] = true;
        }

        // A5.1：对有视野且确认有威胁的远矿房做结构化防御决策。
        // 仅在有视野 (observed !== undefined) 且有威胁 (remoteThreats[rn] === true) 时调用。
        // 无视野时维持现有 threatUntil 逻辑（失明保持），不做决策（信息不足）。
        if (remoteThreats[rn] === true) {
          const remoteThreatAssessment = buildRemoteThreatAssessment(
            rn,
            snapshot.roomName,
            ctx.tick,
            op,
            roomMem.colonyState ?? "normal",
          );
          if (remoteThreatAssessment) {
            const remoteOpState: RemoteOperationState = {
              targetRoom: rn,
              homeRoom: snapshot.roomName,
              state: op.state as "active" | "paused" | "abandoned",
              sources: op.sources ?? 1,
              haulerNeed: op.haulerNeed ?? 1,
              creepCount: remoteCreeps.filter(c => c.remoteTarget === rn).length,
              creepInvestment: estimateCreepInvestment(op, snapshot.energyCapacityAvailable),
              pathCost: intel[rn]?.pathCost,
              threatUntil: op.threatUntil,
              dangerUntil: op.dangerUntil,
              createdAt: op.createdAt,
              lastSeen: op.lastSeen,
            };
            const empireContext: EmpireContext = {
              tick: ctx.tick,
              posture: posture as "develop" | "expand" | "fortify" | "war",
              empireEnergyReserve,
              cpuTier: cpuTier as "abundant" | "comfortable" | "tight" | "constrained",
              activeRemoteCount,
              maxRemoteOps: effectiveMaxOperations(
                snapshot.storage !== undefined,
                snapshot.spawns.length,
              ),
            };
            const logisticsContext: LogisticsContext = {
              avgHaulerCommute: intel[rn]?.pathCost ?? 1,
              availableHaulers: remoteCreeps.filter(c => c.role === "remoteHauler").length,
            };
            const defenderBody = selectBody("remoteDefender", snapshot.energyCapacityAvailable);
            const militaryContext: MilitaryContext = {
              availableDefenders: remoteCreeps.filter(c => c.role === "remoteDefender").length,
              defenderSpawnCost: defenderBody.reduce((sum, p) => sum + BODYPART_COST[p], 0),
              defenderCommuteTicks: (intel[rn]?.pathCost ?? 1) * 50,
              atWar: posture === "war",
            };
            const decision = decideRemoteDefenseAction({
              threat: remoteThreatAssessment,
              remoteOp: remoteOpState,
              empireContext,
              logisticsContext,
              militaryContext,
            });
            gRemoteDecisions.set(rn, decision);

            // 根据决策结果更新 op 状态。
            // ESCORT / CONTINUE → 保持 active（defender 由 evaluateRemoteDemand 生成）。
            // PAUSE → 维持 threatUntil（已有逻辑），不额外操作。
            // RETREAT → 标记 creep 回收 + op.state = "paused"。
            // ABORT → 标记 creep 回收 + op.state = "abandoned"。
            if (decision.action === "RETREAT" || decision.action === "ABORT") {
              recycleRemoteCreepsForRoom(snapshot.roomName, rn);
              op.state = decision.action === "ABORT" ? "abandoned" : "paused";
              op.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
              log.info(
                "remote-mining-manager",
                `remote/A5.1: ${snapshot.roomName} → ${rn} ` +
                  `${decision.action} (${decision.reason})`,
              );
            }
          }
        }
      }

      // 收集 InvaderCore 压制房（结构不是 creep，FIND_HOSTILE_CREEPS 检测不到）。
      // 核心 100,000 hits，defender/reserver 均无力处理 — 该房进入止损模式：
      // 打上危险冷却 + 暂停孵化 + 回收现役 creep，等核心自然 decay 后自动恢复。
      const remoteBlockers = collectRemoteBlockers(remoteOps, remoteThreats);
      // 压制状态持久化：瞬时视野检测 + Memory 冷却双轨合并 — 只用瞬时集合的死角：
      // 回收 creep 后该房失明 → 检测集合清空 → 孵化恢复 → 新 creep 发现核心 → 再回收
      // — 死循环每轮白送整编 creep。规则：有视野见核心 → 写/续期 blockedUntil；
      // 有视野确认消失 → 立即清除；无视野 → 冷却未到期即视为仍被压制。
      const blockedRooms = new Set<string>();
      const clearRooms = new Set<string>();
      for (const [rn, op] of Object.entries(remoteOps)) {
        if (op.state !== "active") continue;
        const observed = remoteBlockers[rn];
        if (!observed || observed.kind === "unknown") {
          // 无视野：冷却未到期 → 仍视为被压制，保持冻结（防回收→失明→重孵死循环）；
          // 冷却已到期 → 解封，恢复孵化以重获视野再评估（否则永失明、永冻结）。
          if (op.blockedUntil !== undefined) {
            if (ctx.tick < op.blockedUntil) blockedRooms.add(rn);
            else op.blockedUntil = undefined;
          }
          if (op.needCoreClear) clearRooms.add(rn);
          continue;
        }
        if (observed.kind === "clear") {
          // 有视野且确认核心消失 — 提前解封两类标记。
          if (op.blockedUntil !== undefined) op.blockedUntil = undefined;
          if (op.needCoreClear) op.needCoreClear = undefined;
          continue;
        }
        if (observed.kind === "stronghold") {
          // 大要塞（带守卫/建筑）：维持现有 blockedUntil + recycle 规避，等自然 decay。
          op.blockedUntil = ctx.tick + CONFIG.remote.coreBlockCooldown;
          if (op.needCoreClear) op.needCoreClear = undefined; // 不是可拆的 lesser core
          blockedRooms.add(rn);
          continue;
        }
        // observed.kind === "lesser"：次级 reserve-only 核心，无守卫 → 派 clearer 拆，不阻塞。
        // 不写 blockedUntil（核心清除后 demand 立即恢复），只标 needCoreClear 驱动孵 clearer。
        if (op.needCoreClear !== true) op.needCoreClear = true;
        clearRooms.add(rn);
      }

      // 路径阻断 wall 检测（有视野时）：通勤路径上若有 neutral wall（非我方建造），
      // hauler 的寻路矩阵会标 255 导致绕行或卡死。标记 needWallClear 驱动 demand
      // 孵 dismantler 前往拆除。与 foreign spawn dismantle 并行——两种拆除目标可同时存在。
      detectPathWallBlockers(snapshot.roomName, remoteOps);

      // 外国前置 spawn 拆除任务检测（有视野时）：远矿房出现非我方已建成 spawn 且
      // controller 仍 neutral → 任务成立，evaluateRemoteDemand 孵 dismantler 去拆。
      // claim 前是唯一低成本拆除窗（neutral 房无塔无防御）；对方 claim 后任务不成立
      // —— 打 claimed 房是对等战争（safeMode 风险），改走 war 战役路径，在役
      // dismantler 标记归航。失明时维持上一判定（request key 幂等，不抖动）。
      // 回收条件：既无 foreign spawn 也无 needWallClear（两种拆除任务共用 dismantler）。
      const dismantleTargets: Record<string, boolean> = {};
      for (const [rn, op] of Object.entries(remoteOps)) {
        if (op.state !== "active") continue;
        const room = Game.rooms[rn];
        if (!room) continue;
        const neutralController =
          room.controller !== undefined &&
          !room.controller.my &&
          room.controller.owner === undefined;
        const foreignSpawn =
          room.find(FIND_HOSTILE_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_SPAWN,
          }).length > 0;
        dismantleTargets[rn] = neutralController && foreignSpawn;
        if (!dismantleTargets[rn] && !op.needWallClear)
          recycleRemoteDismantlers(snapshot.roomName, rn);
        // 反向清除：当 needWallClear 或 dismantleTargets 有效时，清除旧 tick 遗留的
        // recycle 标记 — 否则 dismantler 被 spawn-manager 回收，无法执行拆墙任务。
        if (dismantleTargets[rn] || op.needWallClear) {
          for (const entry of querySquad({
            home: snapshot.roomName,
            remoteTarget: rn,
            role: "dismantler",
          })) {
            const c = Game.creeps[entry.name];
            if (c && c.memory.recycle) c.memory.recycle = false;
          }
        }
      }

      // 远矿路径修路（enableRoadPlanning）：PathFinder 规划 home 锚→source container
      // 跨房路径，在远矿房侧铺 road site；施工由通勤 hauler（1W body）边走边建。
      // 限速：每轮 ≤roadSitesPerRun 个新站，单 op 挂起 ≤maxRoadSitesPerOp，
      // 全局工地预算（maxGlobalSites）共用判定 —— 一次性 9K 级基建投入换疲劳减半。
      if (CONFIG.remote.enableRoadPlanning) {
        planRemotePathRoads(snapshot.roomName, remoteOps, ctx);
      }

      // 威胁写入 remoteOps（P1-G：从 intel.dangerUntil 迁移至此）：出现威胁的远矿房
      // 打危险冷却 — 冷却期内不作为新远矿/扩张候选（止损：不给对手送兵）；现役运营
      // 不因此暂停 — defender 已接通，先应战再评估。大要塞压制房同样打冷却。
      for (const [threatRoom, hasThreat] of Object.entries(remoteThreats)) {
        if (!hasThreat && !blockedRooms.has(threatRoom)) continue;
        const op = remoteOps[threatRoom];
        if (op) {
          op.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
        }
      }

      // 压制房（大要塞 + 次级核心）/ 敌占房的现役远矿 creep 全部标记回收 —
      // harvester 采集被压制、reserver 空耗寿命，留守是持续净亏损。次级核心房的
      // 经济 creep 同样无法采集（核心压制 source），但清核者(coreClearer)本身
      // 不被回收（recycleBlockedRoomCreeps 内豁免），需在场拆核。
      // RM-3：被自己 claim 的房同样回收（运营已废弃，该房转本地闭环）；
      // 敌方预定房同样回收现役 creep，并写 dangerUntil 冷却防评选侧立即重开
      // （照 InvaderCore 双轨止损：视野消失后靠冷却维持「该房已被占」判断）。
      for (const rn of hostileReservedRooms) {
        const op = remoteOps[rn];
        if (op) op.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
      }
      const blockedOrClear = new Set([...blockedRooms, ...clearRooms]);
      const recycleRooms =
        selfClaimedRooms.length > 0 || hostileReservedRooms.length > 0
          ? new Set([...blockedOrClear, ...selfClaimedRooms, ...hostileReservedRooms])
          : blockedOrClear;
      recycleBlockedRoomCreeps(snapshot.roomName, recycleRooms, blockedRooms);

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
        colonyState === "recovery" || colonyState === "bootstrap" || colonyState === "defense";
      if (!crisisPaused) {
        const cpuBefore = Game.cpu.getUsed();
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
          clearRooms,
          travelCosts: Object.fromEntries(
            Object.keys(remoteOps).map(roomName => [roomName, intel[roomName]?.pathCost]),
          ),
          // 道路覆盖状态驱动 body 档位选择：有路 → 2:1 道路满速档（运力大），
          // 无路 → 1:1 平原满速档（无疲劳，效率高）。detectRoadCoverage 在上方算出。
          roadStatus,
          dismantleTargets,
          wallClearRooms: new Set(
            Object.entries(remoteOps)
              .filter(([, op]) => op.needWallClear)
              .map(([rn]) => rn),
          ),
        });

        // 推入 spawnQueue。
        for (const req of requests) {
          submitRequest(queue, req);
        }
        roomMem.spawnQueue = queue;

        // E9：将本房 demand 评估 CPU 按 active op 数均摊，更新各 op 账本的 cpuPerTick EMA。
        // 这是「观测期」测量——只记录、不定价，把 netRate 与 cpu/tick 并列供人工校准。
        const cpuAfter = Game.cpu.getUsed();
        if (activeRemoteCount > 0) {
          const cpuPerOp = (cpuAfter - cpuBefore) / activeRemoteCount;
          for (const [rn, op] of Object.entries(remoteOps)) {
            if (op.state !== "active") continue;
            const ledger = peekRemoteOpLedger(snapshot.roomName, rn);
            if (ledger) recordOpCpu(ledger, cpuPerOp);
          }
        }
      }

      // 5. 回收过量远矿 creep（超过配置上限的旧 creep 标记回收，节省 CPU）。
      recycleExcessRemoteCreeps(snapshot.roomName, remoteOps, intel);
    }

    logRemoteLedgers(ctx.tick);
  },
};
