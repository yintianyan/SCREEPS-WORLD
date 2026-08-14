import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  type PhaseState,
} from "../domain/economy/phase";

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
      const threatCount = snapshot.threatCreeps.length;
      const prevThreatCount = roomMem.prevThreatCount ?? 0;
      const threatIncreased = threatCount > prevThreatCount;
      roomMem.prevThreatCount = threatCount;

      // lastHostileAt 只在威胁新增时刷新（首次到达或增援）。
      if (threatCount > 0 && threatIncreased) {
        roomMem.lastHostileAt = ctx.tick;
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
    }
  },
};
