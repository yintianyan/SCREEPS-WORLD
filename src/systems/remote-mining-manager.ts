/**
 * Remote Mining Manager — P2 系统，远矿运营的中央调度器。
 *
 * 职责：
 *   - 从 RoomMemory.intel 评选远矿目标（selectRemoteTargets）
 *   - 创建/更新 RoomMemory.remoteOps 状态
 *   - 评估远矿 spawn 需求（evaluateRemoteDemand）
 *   - 将远矿请求推入 spawnQueue
 *   - 暂停过期运营、清理废弃运营
 *
 * 数据流：
 *   room-observer（每 50 tick 采集 intel）
 *     → remote-mining-manager（每 10 tick 评估）
 *       → selectRemoteTargets（纯函数筛选候选）
 *       → evaluateRemoteDemand（纯函数生成请求）
 *       → spawnQueue（推入请求）
 *         → spawn-manager（孵化执行）
 *
 * 优先级：P2 — 远矿是扩张行为，不阻塞本房经济。
 * 间隔：10 tick — 平衡响应速度与 CPU 开销。
 *
 * 安全门禁：
 *   - colonyState 非 normal 时暂停新远矿孵化
 *   - CPU tier conserve 以下不孵化远矿
 *   - RCL < minRcl 时不启动远矿
 *   - 远矿目标数不超过 maxOperations
 */
import { CONFIG } from "../config";
import type { Priority, System, TickContext, ColonyState } from "../kernel/contracts";
import { selectRemoteTargets, shouldPauseOperation } from "../domain/remote/targeting";
import { evaluateRemoteDemand, type RemoteCreepSummary } from "../domain/remote/demand";
import { submitRequest } from "../domain/spawn/queue";

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

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // RCL 门禁：低于 minRcl 不启动远矿。
      if (snapshot.rcl < CONFIG.remote.minRcl) continue;

      const remoteOps = roomMem.remoteOps ?? {};

      // 1. 评估现有运营：暂停过期、清理废弃。
      //    RM-3：返回被自己 claim 的房 — 现役远矿 creep 一并回收。
      const selfClaimedRooms = maintainExistingOps(remoteOps, ctx.tick);

      // 2. 如果 active 运营数不足，从 intel 评选新目标。
      //    战略门禁：开辟新远矿点须获 empire-strategy 姿态授权
      //    （fortify/war 时收缩战线不铺新点）；现役运营不受影响。
      const activeCount = countActiveOps(remoteOps);
      const newOpsAllowed = Memory.kernel?.strategy?.newRemoteOpsAllowed === true;
      if (newOpsAllowed && activeCount < CONFIG.remote.maxOperations) {
        const candidates = selectRemoteTargets({
          homeRoom: snapshot.roomName,
          intel: roomMem.intel,
          existingOps: remoteOps,
          tick: ctx.tick,
          staleThreshold: CONFIG.remote.staleThreshold,
          globalActiveTargets,
        });
        // 只补充到 maxOperations。
        const needed = CONFIG.remote.maxOperations - activeCount;
        for (let i = 0; i < Math.min(needed, candidates.length); i++) {
          const candidate = candidates[i]!;
          remoteOps[candidate.roomName] = {
            state: "active",
            sources: candidate.sources,
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
      // 只用瞬时集合的死角：威胁在场 → 经济 creep 被杀/flee 回家 → 房间失明
      // → 检测集合空 → 经济孵化恢复 → 新 creep 抵达送死 — 循环送兵。
      // 规则：有视野见威胁 → 写/续期 threatUntil；有视野确认清空 → 清除；
      // 无视野 → 冷却未到期即维持威胁态（宁可少采一轮，不送一批兵）。
      // collectRemoteThreats 只对有视野的房写键 — 键缺失即无视野。
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
      // 压制状态持久化：瞬时视野检测 + Memory 冷却双轨合并。
      // 只用瞬时集合的死角：回收 creep 后该房失明 → 检测集合清空 → 孵化恢复
      // → 新 creep 抵达发现核心 → 再回收 — 死循环，每轮白送整编 creep。
      // 规则：有视野见核心 → 写/续期 blockedUntil；有视野确认消失 → 立即清除；
      // 无视野 → 冷却未到期即视为仍被压制（宁可少采 5000 tick，不送一轮兵）。
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

      // 威胁写入情报层：出现威胁的远矿房打上危险冷却标记 —
      // 冷却期内该房不作为新的远矿/扩张候选（止损：不给对手送兵）。
      // 现役运营不因此暂停 — defender 已接通，先应战再评估。
      // InvaderCore 压制房同样打冷却 — 核心存续期间不重复选点。
      if (roomMem.intel) {
        for (const [threatRoom, hasThreat] of Object.entries(remoteThreats)) {
          if (!hasThreat && !blockedRooms.has(threatRoom)) continue;
          const info = roomMem.intel[threatRoom];
          if (info) {
            info.dangerUntil = ctx.tick + CONFIG.remote.dangerCooldown;
          }
        }
      }

      // InvaderCore 压制房的现役远矿 creep 全部标记回收 —
      // harvester 采集被压制、reserver 空耗寿命，留守是持续净亏损。
      // RM-3：被自己 claim 的房同样回收（运营已废弃，该房转本地闭环）。
      recycleBlockedRoomCreeps(
        snapshot.roomName,
        selfClaimedRooms.length > 0
          ? new Set([...blockedRooms, ...selfClaimedRooms])
          : blockedRooms,
      );

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

      // 5. 回收过量远矿 creep（超过配置上限的旧 creep 标记回收，节省 CPU）。
      recycleExcessRemoteCreeps(snapshot.roomName, remoteOps);
    }
  },
};

/**
 * 维护现有远矿运营：暂停过期运营、更新 lastSeen、清理废弃。
 */
function maintainExistingOps(
  remoteOps: Record<string, RemoteOp>,
  tick: number,
): string[] {
  // RM-3：被自己 claim 的远矿房（扩张升级为正式殖民地）— 返回给调用方回收现役 creep。
  const selfClaimed: string[] = [];
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
  return selfClaimed;
}

/** 统计 active 状态的运营数。 */
function countActiveOps(remoteOps: Readonly<Record<string, RemoteOp>>): number {
  let count = 0;
  for (const op of Object.values(remoteOps)) {
    if (op.state === "active") count++;
  }
  return count;
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

  for (const [, entry] of byTarget) {
    markExcess(entry.harvester, CONFIG.remote.harvestersPerTarget);
    markExcess(entry.hauler, CONFIG.remote.haulersPerTarget);
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
 * 用于触发 remoteDefender 孵化需求。
 */
function collectRemoteThreats(remoteOps: Readonly<Record<string, RemoteOp>>): Record<string, boolean> {
  const threats: Record<string, boolean> = {};
  for (const [roomName, op] of Object.entries(remoteOps)) {
    if (op.state !== "active") continue;
    const room = Game.rooms[roomName];
    if (!room) continue;
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) => {
        const allies = CONFIG.defense.allies;
        return !allies.includes(c.owner.username);
      },
    });
    threats[roomName] = hostiles.length > 0;
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

