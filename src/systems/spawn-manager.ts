import { CONFIG } from "../config";
import { bodyCost, degradeBody, RECOVERY_BODY } from "../config/bodies";
import { getRoleBounds } from "../config/tuned";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { evaluateDemand, ROLE_REQUIRED_PARTS, type CreepSummary, type SpawningSummary, type RoomDemandContext } from "../domain/spawn/demand";
import type { ColonyState } from "../kernel/contracts";
import { cleanQueue, removeRequestsByRole, sortQueue, submitRequest } from "../domain/spawn/queue";
import { selectRecycleCandidates } from "../domain/spawn/recycle";
import { moveToTarget, moveTowardRoom } from "../creeps/movement";

/**
 * 孵化管理器 — 唯一调用 spawnCreep 的模块。
 *
 * 职责：
 *   - 评估每房孵化需求
 *   - 在 Memory 中维护去重、按优先级排序的队列
 *   - 处理队列：尝试孵化最高优先级的请求
 *   - 处理 P0 恢复、body 降级和重试限制
 *
 * 优先级：P0（在所有依赖人口的其他系统之前运行）。
 */
export const spawnManagerSystem: System = {
  name: "spawn-manager",
  priority: 0 as Priority,
  run(ctx: TickContext): void {
    // P1-1：在循环外预构建全量摘要，避免 O(rooms × creeps) 重复遍历。
    // collectCreepSummaries / collectSpawningSummaries 遍历全部 Game.creeps / Game.spawns，
    // 原先在每房间循环内调用，N 房间 × M creep = O(N×M)。现改为 O(M) 一次构建。
    const creeps = collectCreepSummaries();
    const spawning = collectSpawningSummaries();

    // P3-3：预建 per-room 索引，避免 recyclePass 每房全量扫描 Game.creeps。
    // O(M) 一次构建，N 房间各取自己的子集 → 总计 O(M) 而非 O(N×M)。
    const creepsByRoom = new Map<string, CreepSummary[]>();
    for (const s of creeps) {
      const arr = creepsByRoom.get(s.home);
      if (arr) arr.push(s);
      else creepsByRoom.set(s.home, [s]);
    }

    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      const queue = roomMem.spawnQueue ?? [];

      // 1. 先清理过期 / 隔离的请求 — 必须在 evaluateDemand 之前运行。
      //    否则已达到 maxRetries 的 stale 请求仍被 evaluateDemand 计入 pending，
      //    导致 harvesterCount > 0 → P0 worker 恢复请求不创建 → 死锁。
      //    SP-2：达重试上限的 key 记入黑名单冷却（1 个 TTL 窗口）—
      //    持久性配置错误不再「删除 → demand 重建 → 再失败」无限翻炒。
      const purgedKeys = cleanQueue(queue, ctx.tick, CONFIG.spawn.maxRetries);
      if (purgedKeys.length > 0) {
        roomMem.spawnBlacklist ??= {};
        for (const key of purgedKeys) {
          // 采集角色豁免隔离（与 SP-1 同款）：它们的 retries 烧穿几乎总是
          // 「能量不足 → 降级失败」的暂时性资源问题（bootstrap 常态），
          // 不是隔离语义针对的持久性配置错误 — 隔离采集请求 1000 tick
          // 会把「等能量」变成真死锁（rcl1-survival 回归）。
          if (key.startsWith("worker:") || key.startsWith("harvester:")) continue;
          roomMem.spawnBlacklist[key] = ctx.tick + CONFIG.spawn.requestTtl;
          console.log(`[${ctx.tick}] spawn/${snapshot.roomName}: quarantined ${key} for ${CONFIG.spawn.requestTtl} ticks`);
        }
      }
      // 到期条目顺手清理 — 防黑名单泄漏为永久封禁。
      if (roomMem.spawnBlacklist) {
        for (const [key, until] of Object.entries(roomMem.spawnBlacklist)) {
          if (ctx.tick >= until) delete roomMem.spawnBlacklist[key];
        }
      }

      // 1.5 请求撤销通道：需求前提消失时立即出队，不等 TTL（幽灵需求回收）。
      //     trySpawn 消费队列时不复核当前世界状态 — 按旧状态入队的请求
      //     在 TTL 窗口（最长 1000 tick）内仍会被孵化，浪费能量。
      const colonyState: ColonyState = roomMem.colonyState ?? "normal";
      //     defender：威胁清除后不再需要（存量 defender 自然到期，见 demand 注释）。
      if (snapshot.threatCreeps.length === 0) {
        removeRequestsByRole(queue, "defender", snapshot.roomName);
      }
      //     upgrader：非 normal 且无降级风险时 demand 不再生成（allowUpgrader 门禁），
      //     与之对称地撤销残留请求，避免 recovery 期间孵出发展角色加剧赤字。
      if (colonyState !== "normal" && roomMem.controllerDowngradeRisk !== true) {
        removeRequestsByRole(queue, "upgrader", snapshot.roomName);
      }
      //     distributor：填充需求已清零（尖峰已被在途编制消化）
      //     且存活编制达 minCount 地板时，撤销尖峰期入队的扩编请求。
      //     不撤销的后果：请求在 TTL 窗口内仍会孵化 — 需求早已消失的常驻编制。
      //     minCount 守卫保证不误伤「storage 刚建成、首个 distributor 待孵」的请求。
      //     SN-1 修复：口径按 spawn/extension/tower 维度判空 — fillTargets 含
      //     controllerContainer（容量 2000 几乎永远有空位），按整表判空时
      //     撤单条件在有 controller container 的房间近乎永不成立。
      const coreFillDemand = snapshot.fillTargets.some(
        t => t.structureType === STRUCTURE_SPAWN ||
          t.structureType === STRUCTURE_EXTENSION ||
          t.structureType === STRUCTURE_TOWER,
      );
      if (!coreFillDemand) {
        const livingDist = (creepsByRoom.get(snapshot.roomName) ?? [])
          .filter(c => c.role === "distributor").length;
        if (livingDist >= getRoleBounds("distributor", snapshot.roomName).minCount) {
          removeRequestsByRole(queue, "distributor", snapshot.roomName);
        }
      }

      // 2. 从 Game/Memory 收集数据，调用纯函数评估需求。
      const roomCtx: RoomDemandContext = {
        colonyState,
        controllerDowngradeRisk: roomMem.controllerDowngradeRisk === true,
        energyAvailable: Game.rooms[snapshot.roomName]?.energyAvailable ?? 200,
        economyPressure: roomMem.economyPressure ?? 0,
        storageNearFull: roomMem.storageNearFull === true,
        liquidityScore: roomMem.phase?.liquidityScore ?? 0,
        drainScore: roomMem.phase?.drainScore ?? 0,
      };
      const { requests } = evaluateDemand(
        snapshot,
        queue,
        colonyState,
        creeps,
        spawning,
        roomCtx,
        ctx.tick,
      );
      for (const req of requests) {
        // SP-2：黑名单冷却中的 key 不重建（比较到期 tick — prune 已在
        // 步骤 1 执行，此处防御同 tick 新写入的条目）。
        if ((roomMem.spawnBlacklist?.[req.key] ?? 0) > ctx.tick) continue;
        submitRequest(queue, req);
      }
      roomMem.spawnQueue = queue;

      // 3. 按优先级排序。
      sortQueue(queue);

      // 4. 尝试孵化最高优先级的请求。
      //    SP-1：房内存活采集者（harvester/worker）数传入 — 采集链濒临
      //    断裂（≤1 只）时为 P0 恢复预留 recoveryEnergyReserve。
      const collectorCount = (creepsByRoom.get(snapshot.roomName) ?? [])
        .filter(c => c.role === "harvester" || c.role === "worker").length;
      trySpawn(snapshot, queue, collectorCount);

      // 5. B1：回收通道 — 标记退役 creep，引导至最近 spawn 回收残值能量。
      //    P3-3：传入预建的本房 creep 子集，避免全量 Game.creeps 扫描。
      recyclePass(snapshot, creepsByRoom.get(snapshot.roomName) ?? []);
    }
  },
};

/** 当前注册的角色集合（CONFIG.roles 是唯一权威）。 */
const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.keys(CONFIG.roles));

/**
 * B1 回收通道。
 *
 * 标记规则（保守白名单，不做全量配额对账）：
 *   1. 废弃角色：role 不在 CONFIG.roles 中（角色已下线，creep 永远闲置）；
 *   2. 富余 worker：harvester 满编时，worker 保留 1 只作灾后保险，其余回收
 *      （与 demand 的存在性门禁语义一致：worker 是过渡角色，不是常备军）。
 *
 * 执行：被标记 creep 走向本房最近 spawn（role-runner 对其短路 idle，不抢移动权），
 * 相邻时 spawn.recycleCreep 回收残值能量；spawn 忙碌时等待下一 tick。
 */
function recyclePass(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  roomCreeps: readonly CreepSummary[],
): void {
  const home = snapshot.roomName;

  // ── 标记（纯函数决策）──
  // roomCreeps 已按 home 预过滤，selectRecycleCandidates 内部的 home 过滤为冗余 no-op，
  // 但保留以维护纯函数的自包含契约。
  const marked = selectRecycleCandidates(
    roomCreeps,
    home,
    KNOWN_ROLES,
    getRoleBounds("harvester", home).minCount,
  );
  const markedSet = new Set(marked);
  for (const name of marked) {
    const creep = Game.creeps[name];
    if (creep && !creep.memory.recycle) creep.memory.recycle = true;
  }

  // ── 执行：引导至最近 spawn 并回收 ──
  // P3-3：仅遍历本房 creep 列表（来自预建索引），不再全量扫描 Game.creeps。
  // 待处理集合 = summary 中已有 recycle 标记的（旧标记）∪ 本 tick 新标记的（markedSet）。
  if (snapshot.spawns.length === 0) return;
  for (const s of roomCreeps) {
    if (!s.recycle && !markedSet.has(s.name)) continue;
    const creep = Game.creeps[s.name];
    if (!creep) continue; // creep 可能在本 tick 死亡
    // 跨房归航：回收 creep 可能身处远矿房/失守的扩张房 —
    // findClosestByRange 只在同房有效（跨房返回 null 会让 creep 原地卡死）。
    if (creep.room.name !== home) {
      moveTowardRoom(creep, home);
      continue;
    }
    const spawn = creep.pos.findClosestByRange(snapshot.spawns as StructureSpawn[]);
    if (!spawn) continue;
    if (creep.pos.getRangeTo(spawn) <= 1) {
      // ERR_BUSY（spawn 孵化中）时静默等待下一 tick，不算失败。
      spawn.recycleCreep(creep);
    } else {
      moveToTarget(creep, spawn);
    }
  }
}
/**
 * 尝试从队列孵化 creep — 遍历所有空闲 spawn，多 spawn 房间可同 tick 并行开工。
 *
 * 能量记账：room.energyAvailable 是 tick 开始的快照，同 tick 多次 spawnCreep
 * 的扣费引擎在意图执行阶段才结算 — 若都按快照校验，第二个意图可能超支失败。
 * 因此用本地 energyBudget 逐次扣减，保证每个意图都在真实可用额度内。
 * 处理 P0 降级、body 容量校验和错误重试。
 *
 * SP-1（plan.md「保留恢复能源」硬约束落地）：采集链濒临断裂
 * （collectorCount ≤ 1）时，非 P0 请求的预算扣除 recoveryEnergyReserve —
 * 低优先级孵化不得把能量花到 P0 团灭恢复无法立即出生的程度。
 * 常态（采集者充足）不预留，避免浪费容量。
 *
 * @internal 导出仅供单元测试（tests/unit/spawn/try-spawn.test.ts）—
 *           业务代码不得直接调用，唯一入口是 spawnManagerSystem.run。
 */
export function trySpawn(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  queue: SpawnRequest[],
  collectorCount: number,
): void {
  if (queue.length === 0) return;
  if (snapshot.spawns.length === 0) return;

  // 收集所有空闲 spawn — RCL7-8 有 2-3 个 spawn，逐个消费队列请求。
  const freeSpawns = snapshot.spawns.filter(s => !s.spawning);
  if (freeSpawns.length === 0) return; // 所有 spawn 忙 — 不是错误。

  let spawnIdx = 0;
  let energyBudget = freeSpawns[0]!.room.energyAvailable;
  // SP-1：非 P0 请求可用的预算（P0 本身可动用全部能量）。
  const reserve = collectorCount <= 1 ? CONFIG.spawn.recoveryEnergyReserve : 0;

  // 如果有待处理的 P0 请求，不处理更低优先级的请求。
  const hasP0 = queue.some(r => r.priority === 0);

  // 按优先级顺序处理请求（queue 已排序；splice 会改数组，倒序快照遍历不可行 —
  // 这里遍历副本，出队用 indexOf 定位）。
  for (const req of [...queue]) {
    if (spawnIdx >= freeSpawns.length) return; // 空闲 spawn 用尽。
    const spawn = freeSpawns[spawnIdx]!;
    if (!req) continue;

    // P0 阻塞：如果存在 P0 请求但暂时无法满足，不孵化非 P0 creep。
    if (hasP0 && req.priority > 0) return;

    // 检查 body 是否有效。
    if (req.body.length === 0) {
      req.retries++;
      continue;
    }

    const cost = bodyCost(req.body);

    // SP-1：非 P0 请求按预留后的额度校验 — P0 恢复能量不被低优先级侵占。
    // 采集角色（harvester/worker）豁免：它们本身就是恢复路径 —
    // 拦住采集者扩编会让「1 采集者 + 满能量」的房间永远孵不出第二只
    // （rcl1-survival 回归：预留挡住 harvester → spawn 永久 idle）。
    const isCollectorRole = req.role === "harvester" || req.role === "worker";
    const effectiveBudget = req.priority === 0 || isCollectorRole
      ? energyBudget
      : energyBudget - reserve;

    // 降级策略（三层）：
    //   1. P0 始终降级（紧急恢复）。
    //   2. P1 在 bootstrap/recovery 时降级（关键路径死锁防护）。
    //   3. P1 饥饿超时降级：请求等待超过 2× 孵化耗时仍未孵化，说明 spawn 实际饥饿
    //      但 colonyState 可能仍为 "normal"（worker 维持 reserve 稳定，相位系统检测不到危机）。
    //      此时必须降级，否则陷入「等满额能量 → 永远凑不够 → 请求永远排队」死锁。
    //      线上 W37S58 实测：crisisCount=93 但 colonyState=normal，hauler 请求排队 4000+ tick 未孵化。
    //   4. P2 饥饿超时 + 经济压力降级：P2（发展角色）仅在同时满足以下条件时降级——
    //      a) 请求等待超过 10× 孵化耗时（给发展角色充足等待窗口）
    //      b) economyPressure > 0.5（确认经济确实紧张，而非仅是能量积累慢）
    //      双条件避免 bootstrap/正常低速增长阶段 P2 过早出小 body 导致人口配额被低效 creep 占满
    //      （rcl1-survival / live-anomaly-reproduction 测试回归）。
    let body = req.body;
    if (cost > effectiveBudget) {
      const roomMem = Memory.rooms[snapshot.roomName];
      const roomState = roomMem?.colonyState ?? "normal";
      const economyPressure = roomMem?.economyPressure ?? 0;
      const spawnTime = req.body.length * 3;
      const waitTicks = Game.time - (req.createdAt ?? Game.time);
      const starvedP1 = req.priority === 1 && waitTicks >= spawnTime * 2;
      const starvedP2 = req.priority === 2 && waitTicks >= spawnTime * 10 && economyPressure > 0.5;
      const allowDegrade = req.priority === 0 ||
        (req.priority === 1 && (roomState === "bootstrap" || roomState === "recovery")) ||
        starvedP1 ||
        starvedP2;
      if (allowDegrade) {
        // 使用角色正确的 requiredParts，避免 hauler（无 WORK）降级时
        // 因默认要求 WORK 而返回 undefined。
        const requiredParts = ROLE_REQUIRED_PARTS[req.role];
        const degraded = degradeBody(req.body, effectiveBudget, requiredParts);
        if (!degraded) {
          // 降级失败说明能量连最小 body 都负担不起。
          // 必须递增 retries，否则请求永远留在队列中不被 cleanQueue 清除，
          // 持续阻塞 P0 worker 恢复请求的创建 → 永久死锁。
          req.retries++;
          continue;
        }
        body = degraded;
      } else {
        continue;
      }
    }

    // 检查 body 不超过容量上限。
    const capacity = spawn.room.energyCapacityAvailable;
    if (bodyCost(body) > capacity) {
      req.retries++;
      console.log(
        `[${Game.time}] spawn/${snapshot.roomName}: body exceeds capacity for ${req.key}`,
      );
      continue;
    }

    // 生成包含 spawnIndex 的唯一 creep 名以供追踪。
    const memSpawnIndex = req.memory.spawnIndex ?? 0;
    const name = `${req.role}-${snapshot.roomName}-${memSpawnIndex}-${Game.time}-${Math.random().toString(36).slice(2, 6)}`;

    const result = spawn.spawnCreep(body, name, {
      memory: { ...req.memory },
    });

    if (result === OK) {
      const queueIdx = queue.indexOf(req);
      if (queueIdx >= 0) queue.splice(queueIdx, 1);
      // 扣减本地能量预算，换下一个空闲 spawn 继续消费队列。
      energyBudget -= bodyCost(body);
      spawnIdx++;
      continue;
    }

    if (result === ERR_BUSY) {
      // SP-3 注释修正：防御性分支 — freeSpawns 已过滤 !spawning 且成功后
      // 换 spawn，正常流程不可达。命中时跳过本请求（下 tick 重试），
      // 换下一个空闲 spawn 处理后续请求。
      spawnIdx++;
      continue;
    }
    if (result === ERR_NOT_ENOUGH_ENERGY) continue;

    // 所有其他错误：递增重试次数并可能隔离。
    req.retries++;
    if (req.retries < CONFIG.spawn.maxRetries) {
      console.log(
        `[${Game.time}] spawn/${snapshot.roomName}: spawnCreep returned ${result} for ${req.key} (retry ${req.retries})`,
      );
    }
  }
}

/**
 * 适配层：从 Game.creeps 收集所有 creep 摘要。
 * 供纯函数 evaluateDemand 消费，避免领域层直接访问 Game。
 */
function collectCreepSummaries(): CreepSummary[] {
  const result: CreepSummary[] = [];
  for (const creep of Object.values(Game.creeps)) {
    // 跳过孵化中的 creep — 它们由 collectSpawningSummaries 单独收集。
    // Screeps 中孵化中的 creep 已存在于 Game.creeps（spawning=true），
    // 若两个列表各计一次，countCreepsByRole 会双重计数，孵化期间抑制真实需求。
    if (creep.spawning) continue;
    result.push({
      name: creep.name,
      role: creep.memory.role ?? "unknown",
      home: creep.memory.home ?? creep.room.name,
      ticksToLive: creep.ticksToLive,
      bodyLength: creep.body.length,
      sourceId: creep.memory.sourceId,
      spawnIndex: creep.memory.spawnIndex,
      recycle: creep.memory.recycle === true,
    });
  }
  return result;
}

/**
 * 适配层：从 Game.spawns 收集正在孵化中的 creep 摘要。
 * 供纯函数 evaluateDemand 消费，避免领域层直接访问 Game/Memory。
 */
function collectSpawningSummaries(): SpawningSummary[] {
  const result: SpawningSummary[] = [];
  for (const spawn of Object.values(Game.spawns)) {
    const spawning = spawn.spawning;
    if (!spawning) continue;
    const mem = Memory.creeps[spawning.name];
    if (!mem) continue;
    result.push({
      name: spawning.name,
      role: mem.role ?? "unknown",
      home: mem.home ?? spawn.room.name,
    });
  }
  return result;
}

