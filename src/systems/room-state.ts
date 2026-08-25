import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  computeClaimSecure,
  type PhaseState,
} from "../domain/economy/phase";
import { EventKind, recordEvent } from "../kernel/event-log";
import { globalCache } from "../kernel/global-cache";
import {
  assessThreat,
  type ThreatAssessment,
  type HostileSnapshot,
  type RoomContext,
  type DefenseContext,
} from "../domain/defense/threat-assessment";

/**
 * 房间状态系统 — P0，每 tick 运行，在所有其他系统之前（plan §5.4 统一状态）。
 * 为每个自有房间计算殖民相位（evaluateColonyPhase）→ ColonyState 写入
 * RoomMemory.colonyState，并检测控制器降级风险。这是所有经济/发展决策的
 * 「一处真相」：spawn-manager / assignment-service / construction-manager /
 * kernel.runCreeps 都读 colonyState 决定门禁。
 * 替代了 kernel.computeColonyState、economy/crisis.ts 与 room-observer 中的
 * 危机/相位计算（P3/interval 5 → P0/每 tick）。
 */
export const roomStateSystem: System = {
  name: "room-state",
  priority: 0 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // 1. 总储备 = energyAvailable + containers + storage + terminal + 在途 creep 携带能量。
      // 计入 creep 身上能量（P1-5 ①）：hauler 取/送不再改变 reserve，避免物流搬运制造假危机信号。
      let reserve = snapshot.energyAvailable;
      for (const c of snapshot.containers) {
        reserve += c.store.getUsedCapacity(RESOURCE_ENERGY);
      }
      if (snapshot.storage) {
        reserve += snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
      }
      reserve += snapshot.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      reserve += snapshot.creepEnergy ?? 0;

      // 2. 有效采集者 = Σ sourceOccupancy + pendingHarvesters。
      // 复用 Kernel 预构建映射避免遍历 Game.creeps；P0-1：pendingHarvesters 计入
      // 已存活未分配与孵化中的，避免替换期假 bootstrap 冻结 P2 角色。
      let harvesterCount = 0;
      for (const count of snapshot.sourceOccupancy.values()) {
        harvesterCount += count;
      }
      harvesterCount += snapshot.pendingHarvesters ?? 0;

      // 2.5 流动性信号（方案 C）—— 检测「富得流油却花不出去」的物流死锁。
      // spendableRatio：spawn 口袋可达能量占比，低 = spawn 实际破产。
      // frozenRatio：最满 container 填充率，高 = 能量积压搬不走。
      // 两者同时极端（spawn 空 + container 满）= 搬运能力缺失 = 真死锁，而非正常中转。
      const spendableRatio = snapshot.energyCapacityAvailable > 0
        ? snapshot.energyAvailable / snapshot.energyCapacityAvailable
        : 0;
      let frozenRatio = 0;
      for (const c of snapshot.containers) {
        const cap = c.store.getCapacity(RESOURCE_ENERGY);
        if (cap > 0) {
          const fill = c.store.getUsedCapacity(RESOURCE_ENERGY) / cap;
          if (fill > frozenRatio) frozenRatio = fill;
        }
      }

      // 2.6 P0-1：srcRatio 信号（病灶 1 — 采集塌方失明）。
      // 取最满 source 的填充率：harvester body 退化导致单体采集能力塌方时，
      // source 持续满载（3000/3000）但 spawn 口袋仍健康（hauler 持续补），
      // drainScore 走主动消费豁免不计赤字 → colonyState 误判 normal/growth。
      // srcRatio + storageDrainRate 双条件强制 crisis 通道绕过迟滞。
      let srcRatio = 0;
      for (const s of snapshot.sources) {
        const src = s as Source;
        const cap = src.energyCapacity ?? 3000;
        if (cap > 0) {
          const fill = (src.energy ?? 0) / cap;
          if (fill > srcRatio) srcRatio = fill;
        }
      }

      // 2.7 P0-1：storageDrainRate — 跨 tick storage 净流出率（E/tick），负值 = 流失。
      // 符号语义对齐 PhaseInput.storageDrainRate 与 DEFAULT_PHASE_OPTIONS.storageDrainThreshold=-2。
      const currentStorageEnergy = snapshot.storage
        ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
        : 0;
      const prevStorageEnergy = roomMem.phase?.storageEnergyPrev ?? currentStorageEnergy;
      // drainRate = current - prev（流失为负，符合 PhaseInput 语义）；无 storage 时为 0；
      // 首次运行用 current 兜底 → drainRate=0，避免假流失。
      const storageDrainRate = snapshot.storage
        ? currentStorageEnergy - prevStorageEnergy
        : 0;

      // 3. 评估殖民相位（带迟滞的纯函数），随后持久化相位状态供下一 tick 迟滞计算。
      const prevPhase: PhaseState = {
        phase: roomMem.phase?.phase ?? "growth",
        prevReserve: roomMem.phase?.reserve,
        drainScore: roomMem.phase?.drainScore ?? 0,
        liquidityScore: roomMem.phase?.liquidityScore ?? 0,
        bandTicks: roomMem.phase?.bandTicks ?? 0,
        srcStallTicks: roomMem.phase?.srcStallTicks ?? 0,
        storageDrainAccum: roomMem.phase?.storageDrainAccum,
      };
      const phaseResult = evaluateColonyPhase(
        {
          reserve,
          spendable: snapshot.energyAvailable,
          spendableRatio,
          frozenRatio,
          harvesterCount,
          sourceCount: snapshot.sources.length,
          rcl: snapshot.rcl,
          srcRatio,
          storageDrainRate,
          // P2-3：storage 水位供 forceCrisis 满仓豁免。无 storage 时 undefined。
          storageRatio: snapshot.storage
            ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
              / snapshot.storage.store.getCapacity(RESOURCE_ENERGY)
            : undefined,
        },
        prevPhase,
      );

      // 4. 持久化相位状态（供下一 tick 迟滞计算）。
      roomMem.phase = {
        phase: phaseResult.phase,
        reserve,
        reserveDelta: phaseResult.reserveDelta,
        drainScore: phaseResult.drainScore,
        liquidityScore: phaseResult.liquidityScore,
        bandTicks: phaseResult.bandTicks,
        srcStallTicks: phaseResult.srcStallTicks,
        // P0-1：持久化当前 storage 能量供下一 tick 计算 drainRate。
        // 无 storage 时记 0（下一 tick drainRate=0，srcRatio 通道永不触发）。
        storageEnergyPrev: currentStorageEnergy,
        // P0-1：持久化累积净流失量，供下一 tick 累积计算。
        storageDrainAccum: phaseResult.storageDrainAccum,
        harvesterCount,
        sourceCount: snapshot.sources.length,
        rcl: snapshot.rcl,
      };

      // 5. 映射为 ColonyState 并写入 RoomMemory。
      // P1-3：lastHostileAt 只在威胁新增（count 增加）时刷新，防旧威胁停留永久维持 defense
      // （旧逻辑每 tick 刷新 → 消费方 tower-defense siegeMemory 等永不过期）。
      // 审计登记（2026-08-21 深审复核）：这是有意经济取舍——武装敌人静止在场超
      // threatStaleTicks 即退出 defense 让经济恢复，代价是持续围攻期经济门禁放宽。
      // 接受依据：塔防实时开火不受此记忆影响；repairFortifications 在活敌在场时
      // 整体让位（threatCreeps>0 提前返回）；真正依赖 lastHostileAt 的只有经济
      // 门禁与下方 stale 判定。若未来出现「围攻中门禁放宽造成实证损失」，再引入
      // 损伤信号区分「静止驻留」与「交战中」，不为假想场景预建抽象。
      const threatCount = snapshot.threatCreeps.length;
      const prevThreatCount = roomMem.prevThreatCount ?? 0;
      const threatIncreased = threatCount > prevThreatCount;
      roomMem.prevThreatCount = threatCount;

      // lastHostileAt 只在威胁新增时刷新（首次到达或增援）。
      if (threatCount > 0 && threatIncreased) {
        roomMem.lastHostileAt = ctx.tick;
      }

      // nuke 落点预警差分（审计缺口 1）：新 nuke id 首次出现即报事件 + 限流
      // console（黑匣子可追溯）。已消失的（落地/记录误报）惰性清出集合。
      // 差分基线放 globalCache 而非 Memory — nuke 逐 tick 可见（timeToLand
      // 递减），无需持久化；global reset 后重报一次无害（事件为幂等记录）。
      const incoming = snapshot.incomingNukes ?? [];
      if (incoming.length > 0) {
        const g = globalCache() as { seenNukeIds?: Set<string> };
        if (!g.seenNukeIds) g.seenNukeIds = new Set();
        const aliveIds = new Set(incoming.map(n => n.id as string));
        for (const n of incoming) {
          if (g.seenNukeIds.has(n.id as string)) continue;
          g.seenNukeIds.add(n.id as string);
          recordEvent(EventKind.NukeDetected, snapshot.roomName, [n.timeToLand]);
          console.log(
            `[${ctx.tick}] nuke/${snapshot.roomName}: 落点预警！launch=${n.launchRoomName} timeToLand=${n.timeToLand} — 资产抢救链启动`,
          );
        }
        for (const id of g.seenNukeIds) {
          if (!aliveIds.has(id)) g.seenNukeIds.delete(id);
        }
      }

      // R7c：无害侦察观测 — 有敌对但无威胁部件（侦察兵）时记录目击。
      // 持续目击 = 有人盯防的信号（与 lastHostileAt 威胁记忆刻意分开：
      // 不触发 defense/姿态，纯情报）。塔侧由 tower-defense 放空动作让
      // 引擎自动点杀（见 tower-defense 的无害敌对分支）。
      const observerCount = Math.max(0, snapshot.hostileCreeps.length - threatCount);
      if (observerCount > 0) {
        const firstSighting = roomMem.observerSightings === undefined;
        roomMem.lastObserverAt = ctx.tick;
        roomMem.observerSightings = Math.min((roomMem.observerSightings ?? 0) + 1, 100000);
        // 首次目击 + 每 500 tick 限流日志 — 盯防信号必须可见但不刷屏。
        if (firstSighting || ctx.tick % 500 === 0) {
          console.log(
            `[${ctx.tick}] observer/${snapshot.roomName}: 无害侦察目击 #${roomMem.observerSightings}（hostile=${snapshot.hostileCreeps.length}）`,
          );
        }
      }

      // P1-3：威胁过期失效 — threatCreeps>0 但 lastHostileAt 超过 threatStaleTicks 未刷新
      // 视为 stale threat（旧威胁停留或快照未更新），不再触发 defense。
      const lastHostileAge = roomMem.lastHostileAt !== undefined
        ? ctx.tick - roomMem.lastHostileAt
        : Infinity;
      const threatStale = threatCount > 0
        && roomMem.lastHostileAt !== undefined
        && lastHostileAge > CONFIG.defense.threatStaleTicks;
      const threatPresent = threatCount > 0 && !threatStale;
      // P1-3：退出 defense 迟滞 — 威胁消除后仍维持 defense defenseExitHysteresis tick，
      // 防敌人短暂进出导致 colonyState 高频抖动（525 次/327k tick）绕过 phase 的
      // minBandTicks 保护；进入 defense 仍 1 tick 触发（防御不延迟）。
      const prevInDefense = roomMem.colonyState === "defense";
      const inExitHysteresis = prevInDefense
        && roomMem.lastHostileAt !== undefined
        && lastHostileAge < CONFIG.defense.defenseExitHysteresis;
      const hasHostiles = threatPresent || inExitHysteresis;

      roomMem.colonyState = phaseToColonyState(phaseResult.phase, hasHostiles);

      // A5.1：威胁评估集成 — threatCount > 0 时调用 assessThreat() 纯函数，
      // 将结构化威胁评估（含 intent / combatPower / recommendedPosture）写入
      // globalCache.threatAssessments，供 tower-defense / war-planner 消费。
      // CPU 预算：仅在有威胁时调用（绝大多数 tick 无威胁 → 零成本）；
      // assessThreat 复杂度 O(hostiles × body.length)，hostiles 通常 ≤ 10。
      // 无威胁时从 Map 中移除旧条目（防跨 tick 残留）。
      const gThreats = globalCache().threatAssessments ??= new Map();
      if (threatCount > 0 && threatPresent) {
        const threatAssessment = buildThreatAssessment(
          snapshot.threatCreeps,
          snapshot,
          ctx.tick,
          roomMem.lastHostileAt,
          prevThreatCount,
          roomMem.colonyState,
        );
        if (threatAssessment) {
          gThreats.set(snapshot.roomName, threatAssessment);
        }
      } else {
        gThreats.delete(snapshot.roomName);
      }

      // 5.5 经济压力梯度 (0.0–1.0)：取双维度最大值（方案 C），drainScore 与 liquidityScore
      // 任一升高都推高压力，使建造门禁 / P2 缩放对「富得流油却花不出去」也做出反应。
      // 映射：score 0→midpoint → pressure 0.0→0.5；midpoint→midpoint+range → 0.5→1.0。
      // RS-1：clamp 到 1.0 — score 上限（drainEnterScore=150）> midpoint+range(100)，
      // 无 clamp 时深度危机输出 ~1.42，而所有消费端都假设 0..1 闭区间，超界会产生负乘数等失真。
      const { midpoint, range } = CONFIG.economy.economyPressure;
      const score = Math.max(phaseResult.drainScore, phaseResult.liquidityScore);
      roomMem.economyPressure = Math.min(1, score <= midpoint
        ? (score / midpoint) * 0.5
        : 0.5 + ((score - midpoint) / range) * 0.5);

      // 6. Storage 满仓检测 — 超过阈值时标记，供 demand 限采 + 加速消费
      // （满仓 = 能量在源头被 harvester drop 浪费，必须加速升级/建造消化盈余）。
      if (snapshot.storage) {
        const storageEnergy = snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
        const storageCapacity = snapshot.storage.store.getCapacity(RESOURCE_ENERGY);
        roomMem.storageNearFull = storageCapacity > 0
          && storageEnergy / storageCapacity >= CONFIG.economy.storageFullThreshold;
      } else {
        roomMem.storageNearFull = false;
      }

      // 6. 控制器降级风险（非对称迟滞带）：进入阈值 controllerDowngradeThreshold (10000)，
      // 退出阈值 controllerDowngradeExitThreshold (15000)；用 roomMem.controllerDowngradeRisk
      // 旧值作状态记忆，无需额外字段。
      const controller = snapshot.controller;
      if (controller != null && controller.my) {
        const ttd = controller.ticksToDowngrade;
        if (roomMem.controllerDowngradeRisk) {
          // 已在风险状态：需回升到退出阈值以上才解除
          roomMem.controllerDowngradeRisk = ttd < CONFIG.economy.controllerDowngradeExitThreshold;
        } else {
          // 不在风险状态：低于进入阈值才触发
          roomMem.controllerDowngradeRisk = ttd < CONFIG.economy.controllerDowngradeThreshold;
        }
      } else {
        roomMem.controllerDowngradeRisk = false;
      }

      // 6.5 脆弱新房护栏标记（claim-secure）：RCL<4 且 controller 临近降级时标记，
      // 供 construction-manager 抑制非必要建造、upgrader 放宽取能地板 —— 集中能量
      // 保住 controller（新房无 storage 缓冲，builder 抢能量致降级实证：W38S59）。
      // 迟滞双门槛（enter/exit）防「保级/发展」在临界 ttd 高频振荡（ttd 最大重置值 20000）。
      if (controller != null && controller.my) {
        roomMem.claimSecure = computeClaimSecure(
          snapshot.rcl,
          controller.ticksToDowngrade,
          roomMem.claimSecure ?? false,
        );
      } else {
        roomMem.claimSecure = false;
      }

      // A4.6：spawnStarvationCount 派生 — 从真实 spawn/demand/capacity 状态派生。
      // 检测条件：spawnQueue 有 P0 请求但 energyAvailable < bodyCost(RECOVERY_BODY)
      // （即有紧急孵化需求但能量不够孵最小 body），或所有 spawn 都在忙碌且队列有 P0。
      // 每 tick 条件满足则递增，条件不满足则归零。
      const queue = roomMem.spawnQueue ?? [];
      const hasP0Request = queue.some(r => r.priority === 0);
      const allSpawnsBusy = snapshot.spawns.length > 0 && snapshot.spawns.every(s => s.spawning);
      const energyAvailable = snapshot.energyAvailable;
      // RECOVERY_BODY = [WORK, CARRY, MOVE] = 200 energy
      const minSpawnEnergy = 200;
      const isStarving = hasP0Request && (energyAvailable < minSpawnEnergy || allSpawnsBusy);

      if (isStarving) {
        const prev = (roomMem as RoomMemory & { spawnStarvationCount?: number }).spawnStarvationCount ?? 0;
        (roomMem as RoomMemory & { spawnStarvationCount?: number }).spawnStarvationCount = prev + 1;
      } else {
        // 条件不满足 → 归零（恢复后重置）
        const prev = (roomMem as RoomMemory & { spawnStarvationCount?: number }).spawnStarvationCount;
        if (prev !== undefined && prev > 0) {
          (roomMem as RoomMemory & { spawnStarvationCount?: number }).spawnStarvationCount = 0;
        }
      }
    }
  },
};

/**
 * A5.1：从 RoomSnapshot 构建 ThreatAssessmentInput 并调用 assessThreat()。
 *
 * 系统层薄壳：将 Runtime Creep 对象转换为纯数据 HostileSnapshot，
 * 然后委托给 assessThreat() 纯函数。转换成本 O(threats × body.length)。
 *
 * 返回 undefined 表示输入不完整（无核心锚点等），调用方跳过写入。
 */
function buildThreatAssessment(
  threatCreeps: readonly Creep[],
  snapshot: import("../kernel/contracts").RoomSnapshot,
  tick: number,
  lastHostileAt: number | undefined,
  prevThreatCount: number,
  colonyState: string,
): ThreatAssessment | undefined {
  if (threatCreeps.length === 0) return undefined;

  // 核心锚点：spawn 优先，无 spawn 退到 controller。
  const anchor = snapshot.spawns[0] ?? snapshot.controller;
  if (!anchor) return undefined;

  // 防御性检查：测试 mock 中的 threatCreeps 可能缺少 pos/room 属性。
  // 缺少必要属性时跳过评估（不破坏现有测试，也不影响生产行为——
  // 生产环境中的 RoomSnapshot.threatCreeps 始终是完整 Creep 对象）。
  if (threatCreeps.some(c => !c.pos || !c.room)) return undefined;

  // HostileSnapshot 转换 — 仅提取 assessThreat 需要的纯数据。
  const hostiles: HostileSnapshot[] = threatCreeps.map(c => ({
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

  // RoomContext 构建 — 从 snapshot 提取防御相关静态信息。
  const towerEnergyTotal = snapshot.towers.reduce(
    (sum: number, t) => sum + t.store.getUsedCapacity(RESOURCE_ENERGY), 0,
  );
  const rampartCoverage = snapshot.ramparts.length > 0
    ? Math.min(snapshot.ramparts.length / 20, 1) // 粗估：20 个 rampart = 满覆盖
    : 0;

  const roomContext: RoomContext = {
    roomName: snapshot.roomName,
    corePos: anchor.pos.x * 50 + anchor.pos.y,
    towerCount: snapshot.towers.length,
    towerEnergyTotal,
    rampartCoverage,
    rcl: snapshot.rcl,
    safeModeAvailable: snapshot.controller?.safeModeAvailable ?? 0,
    safeModeTicks: snapshot.controller?.safeMode ?? undefined,
    hasStorage: snapshot.storage !== undefined,
    hasSpawn: snapshot.spawns.length > 0,
    friendlyCreepCount: snapshot.creepPositions
      ? Array.from(snapshot.creepPositions.values()).filter((v: { name: string; my: boolean; fatigue: number }) => v.my).length
      : 0,
    sourceCount: snapshot.sources.length,
    isRemoteRoom: false, // 自有房不是远矿房
    incomingNukes: snapshot.incomingNukes?.length ?? 0,
  };

  const defenseContext: DefenseContext = {
    colonyState,
    lastHostileAt,
    prevThreatCount,
  };

  return assessThreat({
    tick,
    hostiles,
    roomContext,
    defenseContext,
    // playerIntel 和 remoteContext 在自有房场景不提供（A5.2 扩展点）
  });
}
