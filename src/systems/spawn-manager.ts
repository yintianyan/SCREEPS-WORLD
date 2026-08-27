import { CONFIG } from "../config";
import { bodyCost, degradeBody, RECOVERY_BODY } from "../config/bodies";
import { getRoleBounds } from "../config/tuned";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { evaluateDemand, ROLE_REQUIRED_PARTS, type CreepSummary, type SpawningSummary, type RoomDemandContext } from "../domain/spawn/demand";
import type { ColonyState } from "../kernel/contracts";
import { cleanQueue, removeRequestsByRole, sortQueue, submitRequest } from "../domain/spawn/queue";
import { selectRecycleCandidates } from "../domain/spawn/recycle";
import { moveToTarget, moveTowardRoom } from "../creeps/movement";
import { recordSkip } from "../kernel/memory";
import { globalCache, bumpEnergyCounter } from "../kernel/global-cache";

/**
 * 孵化管理器 — 唯一调用 spawnCreep 的模块。

 * 优先级请求；处理 P0 恢复、body 降级和重试限制。
 * P0（在所有依赖人口的其他系统之前运行）。
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

      // 1. 先清理过期 / 隔离的请求 — 必须在 evaluateDemand 之前运行，
      //    否则已达 maxRetries 的 stale 请求仍计入 pending → harvesterCount > 0 →
      //    P0 worker 恢复请求不创建 → 死锁。
      //    ：达重试上限的 key 记入黑名单冷却（1 个 TTL 窗口）— 持久性配置错误
      //    不再「删除 → demand 重建 → 再失败」无限翻炒。
      //    P2-K：onPurge 回调把两种 churn（retries 烧穿 / TTL 过期）转译为 recordSkip
      //    指标，按角色聚合 — key 形如 `role:home:source?:index`，split(':')[0] 取 role
      //    作标签（kebab-case 角色不含 ':'，split 安全）。
      const purgedKeys = cleanQueue(
        queue,
        ctx.tick,
        CONFIG.spawn.maxRetries,
        (key, reason) => {
          const role = key.split(":")[0] ?? "";
          recordSkip(`spawn/churn/${role}/${reason}`);
          // P0-3：同步写入 per-room churnCounter 供熔断判定（role 为空不计数防脏数据）。
          if (role) recordChurn(snapshot.roomName, role, ctx.tick);
        },
      );
      if (purgedKeys.length > 0) {
        roomMem.spawnBlacklist ??= {};
        // P0-3：经济命脉角色（采集 harvester/worker + 物流 hauler/distributor）永远豁免隔离。
        // 采集端：normal/crisis 态恰是能量低谷最常见态，隔离会把「等能量」变成真死锁
        // （线上 W37S58 死亡螺旋根因：1cca151 的隔离机制在 normal 态把 harvester 关 500 tick
        // → 某 source 停产 → 能量断链）。
        // 物流端（同构复发，2026-08-18 二次实证）：能量低谷 ea<最小 body 成本 → degradeBody
        // 返回 undefined → retries 连烧（spawn-manager trySpawn :371）→ purge → hauler/distributor
        // 被拉黑 1000 tick → distributor 是 storage→spawn/ext 唯一分发泵、hauler 是源→storage
        // 唯一运力，隔离它们 = 把恢复期命脉掐断 → spawn/ext 长期半空 → recovery 拖长。
        // 失败只留队列重试，能量恢复即孵化（pre-1cca151 自愈语义）；真配置错误由独立的
        // churn 熔断（200t 窗口 >20 次 → 冻 100 tick）兜底，不会无限翻炒。
        for (const key of purgedKeys) {
          const isLifeline = key.startsWith("worker:") || key.startsWith("harvester:")
            || key.startsWith("hauler:") || key.startsWith("distributor:");
          if (isLifeline) continue;
          const ttl = computeQuarantineTtl(key);
          roomMem.spawnBlacklist[key] = ctx.tick + ttl;
          console.log(`[${ctx.tick}] spawn/${snapshot.roomName}: quarantined ${key} for ${ttl} ticks`);
        }
      }
      // P0-3：churn 熔断检查 — 在 cleanQueue 之后、evaluateDemand 之前。
      // 200 tick 滑窗内同 role churn > 20 次 → 该 role 孵化冻结 100 tick（P0 worker 豁免）。
      checkChurnCircuitBreaker(ctx, roomMem, snapshot.roomName);
      // 到期条目顺手清理 — 防黑名单泄漏为永久封禁。
      if (roomMem.spawnBlacklist) {
        for (const [key, until] of Object.entries(roomMem.spawnBlacklist)) {
          if (ctx.tick >= until) delete roomMem.spawnBlacklist[key];
        }
      }

      // 1.5 请求撤销通道：需求前提消失时立即出队，不等 TTL（幽灵需求回收）—
      //     trySpawn 消费队列时不复核当前世界状态，按旧状态入队的请求在 TTL 窗口
      //     （最长 1000 tick）内仍会孵化，浪费能量。
      const colonyState: ColonyState = roomMem.colonyState ?? "normal";
      //     defender：威胁清除后不再需要（存量 defender 自然到期，见 demand 注释）。
      if (snapshot.threatCreeps.length === 0) {
        removeRequestsByRole(queue, "defender", snapshot.roomName);
      }
      //     upgrader：非 normal 且无降级风险时 demand 不再生成（allowUpgrader 门禁），
      //     对称撤销残留请求，避免 recovery 期间孵出发展角色加剧赤字。
      if (colonyState !== "normal" && roomMem.controllerDowngradeRisk !== true) {
        removeRequestsByRole(queue, "upgrader", snapshot.roomName);
      }
      //     distributor：填充需求已清零且存活编制达 minCount 地板时撤销扩编请求。
      //     不撤销的后果：请求在 TTL 窗口内仍会孵化 — 需求早已消失的常驻编制。
      //     minCount 守卫保证不误伤「storage 刚建成、首个 distributor 待孵」的请求。
      //     SN-1 修复：口径按 spawn/extension/tower 维度判空 — fillTargets 含
      //     controllerContainer（容量 2000 几乎永远有空位），按整表判空时撤单条件
      //     在有 controller container 的房间近乎永不成立。
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
      // P1-J：迟滞状态（distScaleUpSince / builderPressureState）原本由 demand 直读写
      // Memory，现收敛为显式输入输出 — 适配层从 RoomMemory 读出 prevHysteresis 注入、
      // 将 nextHysteresis 写回；domain 恢复纯函数，单测不再需要 mock Memory。
      const roomCtx: RoomDemandContext = {
        colonyState,
        controllerDowngradeRisk: roomMem.controllerDowngradeRisk === true,
        energyAvailable: Game.rooms[snapshot.roomName]?.energyAvailable ?? 200,
        economyPressure: roomMem.economyPressure ?? 0,
        storageNearFull: roomMem.storageNearFull === true,
        liquidityScore: roomMem.phase?.liquidityScore ?? 0,
        drainScore: roomMem.phase?.drainScore ?? 0,
        prevHysteresis: {
          distScaleUpSince: roomMem.distScaleUpSince,
          builderPressureState: roomMem.builderPressureState,
        },
        // P2-2：tuning pending 期间 hauler 主动收敛目标 — 上调 maxCount → preAdjustValue+1；
        // 下调 minCount → preAdjustValue-1；让 demand 扩编/缩编到合同目标（配合 isContractMet）。
        haulerPendingTarget: computeHaulerPendingTarget(snapshot.roomName),
        // R6a：议程注入（rcl-push 放宽 upgrader 冲刺门槛）。
        agendaInitiative: Memory.kernel?.agenda?.initiative,
        // 【G-J 合规】churn 冻结表注入（写者=本系统 cleanQueue；domain 不触 Memory）。
        churnFreezeUntil: roomMem?.churnFreezeUntil as Record<string, number> | undefined,
        // 【G-J 合规】建造 backlog 注入（数据源=construction-manager 维护的 RoomMemory.buildQueue；本系统为读者）。
        buildQueueBacklog: (roomMem?.buildQueue as readonly { state?: string }[] | undefined)?.filter(t => t.state === "queued").length ?? 0,
      };
      const demandResult = evaluateDemand(
        snapshot,
        queue,
        colonyState,
        creeps,
        spawning,
        roomCtx,
        ctx.tick,
      );
      const { requests, nextHysteresis } = demandResult;
      for (const req of requests) {
        // ：黑名单冷却中的 key 不重建（比较到期 tick — prune 已在步骤 1 执行，
        // 此处防御同 tick 新写入的条目）。
        if ((roomMem.spawnBlacklist?.[req.key] ?? 0) > ctx.tick) continue;
        submitRequest(queue, req);
      }
      // P1-J：写回迟滞状态。undefined 表示「清除」语义（如需求回落重置），
      // 用 delete 而非赋值 undefined 保持 Memory 体积精简（docs/architecture/CPU_EXECUTION_MODEL.md 性能优化）。
      if (nextHysteresis.distScaleUpSince === undefined) {
        delete roomMem.distScaleUpSince;
      } else {
        roomMem.distScaleUpSince = nextHysteresis.distScaleUpSince;
      }
      if (nextHysteresis.builderPressureState === undefined) {
        delete roomMem.builderPressureState;
      } else {
        roomMem.builderPressureState = nextHysteresis.builderPressureState;
      }
      roomMem.spawnQueue = queue;

      // 3. 按优先级排序。
      sortQueue(queue);

      // 4. 尝试孵化最高优先级的请求。
      //    ：房内存活采集者（harvester/worker）数传入 — 采集链濒临断裂（≤1 只）时
      //    为 P0 恢复预留 recoveryEnergyReserve；存活 distributor 数传入 — 泵断供时
      //    distributor 请求立即降级速出。
      const roomCreeps = creepsByRoom.get(snapshot.roomName) ?? [];
      const collectorCount = roomCreeps
        .filter(c => c.role === "harvester" || c.role === "worker").length;
      const distributorCount = roomCreeps.filter(c => c.role === "distributor").length;
      // P3 Reservation①前馈：任一采集者进入替换窗口（B1 对策，P3_BASELINE §6）。
      const replacementReserve = roomCreeps.some(
        c => (c.role === "harvester" || c.role === "worker")
          && c.ticksToLive !== undefined
          && c.ticksToLive < CONFIG.spawn.replacementHorizonTicks,
      );
      trySpawn(snapshot, queue, collectorCount, distributorCount, replacementReserve);

      // 5. B1：回收通道 — 标记退役 creep，引导至最近 spawn 回收残值能量。
      //    P3-3：传入预建的本房 creep 子集，避免全量 Game.creeps 扫描。
      recyclePass(snapshot, creepsByRoom.get(snapshot.roomName) ?? [], demandResult.haulerTarget);
    }
  },
};

/** 当前注册的角色集合（CONFIG.roles 是唯一权威）。 */
const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.keys(CONFIG.roles));

/**
 * P2-2：从 Memory 读取 hauler tuning pending 状态，计算主动收敛目标。
 * hauler.maxCount pending + up → preAdjustValue + 1（扩编到新上限）；
 * hauler.minCount pending + down → preAdjustValue - 1（缩编到新下限）；否则 undefined。
 * step=1 时 preAdjustValue±1 = newValue，与 isContractMet 合同目标对齐。
 */
function computeHaulerPendingTarget(roomName: string): number | undefined {
  const pending = Memory.kernel?.tuning?.rooms?.[roomName]?.pendingValidation;
  if (!pending) return undefined;
  const upMax = pending["hauler.maxCount"];
  if (upMax?.adjustDirection === "up") return upMax.preAdjustValue + 1;
  const downMin = pending["hauler.minCount"];
  if (downMin?.adjustDirection === "down") return downMin.preAdjustValue - 1;
  return undefined;
}

/**
 * B1 回收通道。
 * 标记规则（保守白名单，不做全量配额对账）：
 *   1. 废弃角色：role 不在 CONFIG.roles 中（角色已下线，creep 永远闲置）；
 *   2. 富余 worker：harvester 满编时保留 1 只作灾后保险，其余回收
 *      （worker 是过渡角色，不是常备军 — 与 demand 的存在性门禁语义一致）。
 * 执行：被标记 creep 走向本房最近 spawn（role-runner 对其短路 idle，不抢移动权），
 * 相邻时 spawn.recycleCreep 回收残值能量；spawn 忙碌时等待下一 tick。
 */
function recyclePass(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  roomCreeps: readonly CreepSummary[],
  haulerTarget?: number,
): void {
  const home = snapshot.roomName;

  // ── 标记（纯函数决策）──
  // roomCreeps 已按 home 预过滤，selectRecycleCandidates 内部 home 过滤为冗余 no-op，
  // 保留以维护纯函数自包含契约。
  // P1-1：tuning 下调 hauler.minCount 时传入下调目标，让 recyclePass 主动收敛。
  const haulerPendingDown = Memory.kernel?.tuning?.rooms?.[home]?.pendingValidation?.["hauler.minCount"];
  const haulerPendingDownTarget = haulerPendingDown?.adjustDirection === "down"
    ? haulerPendingDown.preAdjustValue - 1
    : undefined;
  const marked = selectRecycleCandidates(
    roomCreeps,
    home,
    KNOWN_ROLES,
    getRoleBounds("harvester", home).minCount,
    haulerTarget,
    haulerPendingDownTarget,
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
      // P3 L1 核算：返还额按 spawn 库存差值实测（引擎按剩余寿命比例退款）。
      const storeBefore = spawn.store.getUsedCapacity(RESOURCE_ENERGY);
      if (spawn.recycleCreep(creep) === OK) {
        const refunded = spawn.store.getUsedCapacity(RESOURCE_ENERGY) - storeBefore;
        if (refunded > 0) bumpEnergyCounter(home, "recycledRefund", refunded);
      }
    } else {
      moveToTarget(creep, spawn);
    }
  }
}
/**
 * 尝试从队列孵化 creep — 遍历所有空闲 spawn，多 spawn 房间可同 tick 并行开工。
 * 能量记账：room.energyAvailable 是 tick 开始快照，同 tick 多次 spawnCreep 的扣费
 * 在意图执行阶段才结算 — 若都按快照校验，第二个意图可能超支失败；因此用本地
 * energyBudget 逐次扣减，保证每个意图都在真实可用额度内。
 * 采集链濒临断裂（collectorCount ≤ 1）时，
 * 非 P0 请求的预算扣除 recoveryEnergyReserve — 低优先级孵化不得把能量花到 P0 团灭
 * 恢复无法立即出生的程度；常态不预留，避免浪费容量。
 * @internal 导出仅供单元测试（tests/unit/spawn/try-spawn.test.ts）— 业务代码
 *           不得直接调用，唯一入口是 spawnManagerSystem.run。
 */
export function trySpawn(
  snapshot: import("../kernel/contracts").RoomSnapshot,
  queue: SpawnRequest[],
  collectorCount: number,
  distributorCount = 1,
  replacementReserve = false,
): void {
  if (queue.length === 0) return;
  if (snapshot.spawns.length === 0) return;

  // 收集所有空闲 spawn — RCL7-8 有 2-3 个 spawn，逐个消费队列请求。
  const freeSpawns = snapshot.spawns.filter(s => !s.spawning);
  // 【Phase3A 修复】全部 spawn 忙（含孵化窗口）时本 tick 不孵化 —— 下 tick 重试。
  // 必须在访问 freeSpawns[0] 之前判空：空数组时 [0].room 会抛 TypeError
  // （E2E-006 实测 103 次 TypeError 中断孵化管线 → 死亡螺旋）。
  if (freeSpawns.length === 0) return;

  let spawnIdx = 0;
  // 【防御】mockup 环境 spawn 包装对象的 room 引用存在瞬态 undefined（孵化边界），
  // 此时本 tick 跳过孵化（下 tick 重试），避免 TypeError 中断整个系统。
  const primaryRoom = freeSpawns[0]!.room;
  if (!primaryRoom) return;
  let energyBudget = primaryRoom.energyAvailable;
  // ：非 P0 请求可用的预算（P0 本身可动用全部能量）。
  let reserve = collectorCount <= 1 ? CONFIG.spawn.recoveryEnergyReserve : 0;
  // P3 Reservation①扩展（ECONOMY §2.1-7）：RCL4+ 有中央储备时，风险缓冲低于地板
  // （断供耐受 tick 数不足）即同样为非 P0 预留恢复能源——堵 B1 类「P2 支出抽干
  // 替换能力」的死锁路径。仅 storage/terminal/link 任一存在时生效（低容量房无
  // 合同储备口径，维持原动态，避免 RCL1 孵化被饿死）。
  const econSnap = Memory.rooms[snapshot.roomName]?.economy;
  if (
    econSnap !== undefined
    && econSnap.cr > 0
    && econSnap.rb / 10 < CONFIG.spawn.lowRiskBufferTicks
  ) {
    reserve += CONFIG.spawn.recoveryEnergyReserve;
  }
  // Reservation①前馈（低容量房形态）：采集者进入替换窗口（TTL < horizon）时同样预留——
  // 防「P2 支出抽干孵化现金 → 首代替换失败级联」（B1 定量归因见 P3_BASELINE.md §6）。
  if (replacementReserve) {
    reserve += CONFIG.spawn.recoveryEnergyReserve;
  }

  // 如果有待处理的 P0 请求，不处理更低优先级的请求。
  const hasP0 = queue.some(r => r.priority === 0);

  // 按优先级顺序处理请求（queue 已排序；splice 会改数组，倒序快照遍历不可行 —
  // 这里遍历副本，出队用 indexOf 定位）。
  for (const req of [...queue]) {
    if (spawnIdx >= freeSpawns.length) return; // 空闲 spawn 用尽。
    const spawn = freeSpawns[spawnIdx]!;
    if (!req) continue;

    // P0 阻塞：如果存在 P0 请求但暂时无法满足，不孵化非 P0 creep。
    if (hasP0 && req.priority > 0) {
      return;
    }

    // 检查 body 是否有效。
    if (req.body.length === 0) {
      req.retries++;
      continue;
    }

    const cost = bodyCost(req.body);

    // ：非 P0 请求按预留后的额度校验 — P0 恢复能量不被低优先级侵占。
    // 采集角色（harvester/worker）豁免：它们本身就是恢复路径 —
    // 拦住采集者扩编会让「1 采集者 + 满能量」的房间永远孵不出第二只
    // （rcl1-survival 回归：预留挡住 harvester → spawn 永久 idle）。
    const isCollectorRole = req.role === "harvester" || req.role === "worker";
    const effectiveBudget = req.priority === 0 || isCollectorRole
      ? energyBudget
      : energyBudget - reserve;

    // 降级策略（六层）：
    //   1. P0 始终降级（紧急恢复）。
    //   2. P1 在 bootstrap/recovery 时降级（关键路径死锁防护）。
    //   3. P1 饥饿超时降级：请求等待超过 2× 孵化耗时仍未孵化 → spawn 实际饥饿但
    //      colonyState 可能仍为 normal（worker 维持 reserve 稳定，相位系统检测不到），
    //      不降级则「等满额能量 → 永远凑不够 → 永远排队」死锁。
    //      线上 W37S58 实测：crisisCount=93 但 colonyState=normal，hauler 排队 4000+ tick。
    //   4. P2 饥饿超时 + 经济压力降级：请求等待超 10× 孵化耗时 且 economyPressure > 0.5，
    //      双条件避免 bootstrap/低速增长期 P2 过早出小 body 占满人口配额（回归测试）。
    //   5. 饥饿降级成本地板：starved 路径产物须 ≥ starvationDegradeFloor，低于地板继续
    //      排队（不算失败，不烧 retries）— 无地板的后果（线上实测回路）：能量低谷铸出
    //      1C1M 残废 → 吞吐塌方 → 水位低迷 → 自强化直至人工干预。
    //   6. 泵断供降级：distributor 是 storage→spawn/extension 唯一分发泵，断供（存活 0）
    //      时 extension 无人填、满配永远凑不齐 — 等待即死锁，立即降级速出小泵重启循环。
    let body = req.body;
    if (cost > effectiveBudget) {
      const roomMem = Memory.rooms[snapshot.roomName];
      const roomState = roomMem?.colonyState ?? "normal";
      const economyPressure = roomMem?.economyPressure ?? 0;
      const spawnTime = req.body.length * 3;
      const waitTicks = Game.time - (req.createdAt ?? Game.time);
      const starvedP1 = req.priority === 1 && waitTicks >= spawnTime * 2;
      const starvedP2 = req.priority === 2 && waitTicks >= spawnTime * 10 && economyPressure > 0.5;
      const pumpOutage = req.role === "distributor" && distributorCount === 0;
      const allowDegrade = req.priority === 0 ||
        (req.priority === 1 && (roomState === "bootstrap" || roomState === "recovery")) ||
        starvedP1 ||
        starvedP2 ||
        pumpOutage;
      if (allowDegrade) {
        // 使用角色正确的 requiredParts，避免 hauler（无 WORK）降级时
        // 因默认要求 WORK 而返回 undefined。
        const requiredParts = ROLE_REQUIRED_PARTS[req.role];
        const degraded = degradeBody(req.body, effectiveBudget, requiredParts);
        if (!degraded) {
          // 降级失败说明能量连最小 body 都负担不起 — 必须递增 retries，否则请求
          // 永远留在队列中不被 cleanQueue 清除，持续阻塞 P0 worker 恢复 → 永久死锁。
          req.retries++;
          continue;
        }
        // 饥饿降级成本地板：starved 路径产物低于地板时继续排队等能量 — 等能量不是
        // 失败，不递增 retries（避免烧穿 maxRetries 进黑名单）；生存路径豁免。
        const survivalPath =
          req.priority === 0 || roomState === "bootstrap" || roomState === "recovery";
        if (!survivalPath && bodyCost(degraded) < CONFIG.spawn.starvationDegradeFloor) {
          continue;
        }
        body = degraded;
      } else {
        continue;
      }
    }

    // 检查 body 不超过容量上限。
    const capacity = spawn.room ? spawn.room.energyCapacityAvailable : 0;
    if (capacity === 0) continue; // 【防御】同上：room 引用瞬态缺失时跳过本次请求。
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
      // P3 L1 核算：孵化成功即全额计费（gross；recycle 返还在回收通道冲销）。
      bumpEnergyCounter(snapshot.roomName, "spawned", bodyCost(body));
      // 扣减本地能量预算，换下一个空闲 spawn 继续消费队列。
      energyBudget -= bodyCost(body);
      spawnIdx++;
      continue;
    }

    if (result === ERR_BUSY) {
      //  注释修正：防御性分支 — freeSpawns 已过滤 !spawning 且成功后换 spawn，
      // 正常流程不可达。命中时跳过本请求（下 tick 重试），换下一个空闲 spawn。
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
    // 若两个列表各计一次，countCreepsByRole 会双重计数，抑制孵化期间的真实需求。
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

// ─── P0-3：spawn churn 熔断 ────────────────────────────────────

/**
 * Churn 事件记录结构（存 globalCache.__churnCounter[roomName]）。
 * heap 存储 — global reset 丢失可接受（reset 极少，且持续 churn 会快速重建计数）。
 */
interface ChurnRecord {
  tick: number;
  role: string;
}

/** 熔断触发阈值：200 tick 滑窗内同 role churn 次数 > 此值 → 冻结。 */
const CHURN_THRESHOLD = 20;
/** 滑窗长度（tick）。 */
const CHURN_WINDOW = 200;
/** 熔断时长（tick）。冻结期间该 role 不孵化（P0 worker 路径豁免）。 */
const CHURN_FREEZE_TICKS = 100;

/**
 * P0-3：计算请求 key 的隔离冷却时长（tick）。

 * 采集角色（harvester/worker）用短冷却（requestTtl / 2 = 500 tick）—
 * 持续配置错误时更快进入熔断，比永久豁免避免无限 churn。
 * 其他角色用长冷却（requestTtl = 1000 tick）— 持久性配置错误的标准化隔离。

 * @internal 导出仅供单元测试 — 业务代码通过 spawnManagerSystem.run 间接调用。
 */
export function computeQuarantineTtl(key: string): number {
  const isCollector = key.startsWith("worker:") || key.startsWith("harvester:");
  return isCollector
    ? Math.floor(CONFIG.spawn.requestTtl / 2)
    : CONFIG.spawn.requestTtl;
}

/**
 * 记录一次 churn 事件到 per-room churnCounter。

 * 设计决策：churn 按 per-room 维度统计（spawn 是 per-room 资源，churnFreezeUntil
 * 也写在 RoomMemory），存 globalCache 按 roomName 索引的 records 数组。
 * heap 存储 — global reset 丢失可接受（reset 极少，且持续 churn 会快速重建）。

 * @internal 导出仅供单元测试 — 业务代码通过 cleanQueue 的 onPurge 回调间接调用。
 */
export function recordChurn(roomName: string, role: string, tick: number): void {
  const g = globalCache() as Record<string, unknown> & { __churnCounter?: Record<string, ChurnRecord[]> };
  if (!g.__churnCounter) g.__churnCounter = {};
  const perRoom = g.__churnCounter[roomName];
  if (perRoom) perRoom.push({ tick, role });
  else g.__churnCounter[roomName] = [{ tick, role }];
}

/**
 * P0-3：检查 churn 熔断状态，触发或清理 per-room 角色 熔断条目。

 * 流程：
 *   1. 读取 globalCache.__churnCounter[roomName]，清理 200 tick 滑窗外的过期记录。
 *   2. 按 role 聚合，200 tick 内同 role churn > 20 次 → 写入 churnFreezeUntil[role] = tick + 100。
 *      仅当该 role 当前未冻结时触发（防重复续期 — 一次熔断到期前不再叠加）。
 *   3. 清理到期熔断条目 + 异常类型自愈（非数字值视为到期清理，防 Memory 泄漏）。
 *   4. 空对象回收（删除整个 churnFreezeUntil 字段，保持 Memory 精简）。

 * 调用时机：cleanQueue 之后、evaluateDemand 之前 — demand 能读到本 tick 新写入的熔断。

 * @internal 导出仅供单元测试 — 业务代码通过 spawnManagerSystem.run 间接调用。
 */
export function checkChurnCircuitBreaker(
  ctx: TickContext,
  roomMem: RoomMemory,
  roomName: string,
): void {
  const g = globalCache() as Record<string, unknown> & { __churnCounter?: Record<string, ChurnRecord[]> };
  if (!g.__churnCounter) g.__churnCounter = {};

  // 1. 清理过期记录（200 tick 滑窗），回写压缩后的数组。
  const cutoff = ctx.tick - CHURN_WINDOW;
  const rawRecords = g.__churnCounter[roomName] ?? [];
  const freshRecords = rawRecords.filter(r => r.tick > cutoff);
  g.__churnCounter[roomName] = freshRecords;

  // 2. 按 role 聚合，触发熔断（仅当 role 当前未冻结时）。
  const byRole = new Map<string, number>();
  for (const r of freshRecords) {
    byRole.set(r.role, (byRole.get(r.role) ?? 0) + 1);
  }
  roomMem.churnFreezeUntil ??= {};
  for (const [role, count] of byRole) {
    if (count > CHURN_THRESHOLD && roomMem.churnFreezeUntil[role] === undefined) {
      roomMem.churnFreezeUntil[role] = ctx.tick + CHURN_FREEZE_TICKS;
      console.log(
        `[${ctx.tick}] spawn/${roomName}: CIRCUIT_BREAKER ${role} frozen for ${CHURN_FREEZE_TICKS} ticks (churn=${count}/${CHURN_WINDOW}t)`,
      );
    }
  }

  // 3. 清理到期熔断 + 异常类型自愈（非数字值视为到期）。
  for (const role of Object.keys(roomMem.churnFreezeUntil)) {
    const until = roomMem.churnFreezeUntil[role];
    if (typeof until !== "number" || ctx.tick >= until) {
      delete roomMem.churnFreezeUntil[role];
    }
  }

  // 4. 空对象回收（防 Memory 体积膨胀）。
  if (Object.keys(roomMem.churnFreezeUntil).length === 0) {
    delete roomMem.churnFreezeUntil;
  }
}
