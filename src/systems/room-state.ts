import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  evaluateColonyPhase,
  phaseToColonyState,
  type PhaseState,
} from "../domain/economy/phase";

/**
 * 房间状态系统 — P0，每 tick 运行，在所有其他系统之前。
 *
 * 职责（plan §5.4 统一状态）：
 *   - 为每个自有房间计算殖民相位（evaluateColonyPhase）
 *   - 映射为 ColonyState 并写入 RoomMemory.colonyState
 *   - 检测控制器降级风险并写入 RoomMemory.controllerDowngradeRisk
 *
 * 这是所有经济/发展决策的「一处真相」：
 *   - spawn-manager 读 RoomMemory.colonyState 决定孵化优先级
 *   - assignment-service 读 RoomMemory.colonyState 决定任务生成
 *   - construction-manager 读 RoomMemory.colonyState 决定建造门禁
 *   - kernel.runCreeps 读 RoomMemory.colonyState 决定角色执行门禁
 *
 * 替代了：
 *   - kernel.computeColonyState（全局状态 → 每房状态）
 *   - economy/crisis.ts（source 满度启发式 → 储备趋势）
 *   - room-observer 中的危机/相位计算（P3/interval 5 → P0/每 tick）
 */
export const roomStateSystem: System = {
  name: "room-state",
  priority: 0 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // 1. 计算总储备 = energyAvailable + containers + storage + terminal + 在途 creep 携带能量。
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

      // 2. 统计有效采集者（已分配 source 的 harvester/worker）。
      // 复用 Kernel 预构建的 sourceOccupancy 求和，避免遍历全部 Game.creeps。
      // P0-1：加入 pendingHarvesters（已存活但未分配 sourceId 的 + 孵化中的），
      // 避免替换期间的假 bootstrap 导致 P2 角色被冻结。
      let harvesterCount = 0;
      for (const count of snapshot.sourceOccupancy.values()) {
        harvesterCount += count;
      }
      harvesterCount += snapshot.pendingHarvesters ?? 0;

      // 2.5 流动性信号（方案 C）—— 检测「富得流油却花不出去」的物流死锁。
      // spendableRatio：spawn 口袋的可达能量占容量比。低 = spawn 实际破产。
      const spendableRatio = snapshot.energyCapacityAvailable > 0
        ? snapshot.energyAvailable / snapshot.energyCapacityAvailable
        : 0;
      // frozenRatio：最满 container 的填充率。高 = 能量积压在 container 搬不走。
      // 两者同时极端（spawn 空 + container 满）= 搬运能力缺失 = 真死锁，而非正常物流中转。
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

      // 2.7 P0-1：storageDrainRate 信号 — 跨 tick storage 净流出率（E/tick）。
      // 负值 = 流失（storage 在被抽空），正值 = 充盈。无 storage 时为 0。
      // 用本 tick storage 能量减去上一 tick 持久化的 storageEnergyPrev。
      // 符号语义对齐 PhaseInput.storageDrainRate（负值=流失）与
      // DEFAULT_PHASE_OPTIONS.storageDrainThreshold=-2（drainRate < -2 触发）。
      const currentStorageEnergy = snapshot.storage
        ? snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY)
        : 0;
      const prevStorageEnergy = roomMem.phase?.storageEnergyPrev ?? currentStorageEnergy;
      // drainRate = current - prev：流失时 current < prev → 负值，符合 PhaseInput 语义。
      // 无 storage 时 drainRate=0（srcRatio 通道永不触发，因 storageDrainRate < -2 不成立）。
      // 首次运行（prevStorageEnergy 缺失）→ 用 current 兜底 → drainRate=0，避免假流失。
      const storageDrainRate = snapshot.storage
        ? currentStorageEnergy - prevStorageEnergy
        : 0;

      // 3. 评估殖民相位（带迟滞的纯函数）。
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
      // P1-3：lastHostileAt 只在威胁新增（count 增加）时刷新，防旧威胁停留永久维持 defense。
      // 旧逻辑每 tick 刷新 lastHostileAt → 消费方（tower-defense siegeMemory 等）永不过期。
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
      // lastHostileAt undefined 时不判 stale（无基线，首次到达由上方的 threatIncreased 刷新）。
      const lastHostileAge = roomMem.lastHostileAt !== undefined
        ? ctx.tick - roomMem.lastHostileAt
        : Infinity;
      const threatStale = threatCount > 0
        && roomMem.lastHostileAt !== undefined
        && lastHostileAge > CONFIG.defense.threatStaleTicks;
      const threatPresent = threatCount > 0 && !threatStale;
      // P1-3：退出 defense 迟滞 — 威胁消除后仍维持 defense 姿态 defenseExitHysteresis tick。
      // 防止敌人短暂进出导致 colonyState 高频抖动（525 次/327k tick），绕过 phase 状态机
      // minBandTicks 保护。进入 defense 仍 1 tick 触发（防御不延迟）；
      // lastHostileAt undefined 时无基线不迟滞（首次到达由 threatIncreased 刷新）。
      const prevInDefense = roomMem.colonyState === "defense";
      const inExitHysteresis = prevInDefense
        && roomMem.lastHostileAt !== undefined
        && lastHostileAge < CONFIG.defense.defenseExitHysteresis;
      const hasHostiles = threatPresent || inExitHysteresis;

      roomMem.colonyState = phaseToColonyState(phaseResult.phase, hasHostiles);

      // 5.5 经济压力梯度信号 (0.0–1.0)。
      // 取双维度最大值（方案 C）：偿付危机（drainScore）与流动性危机（liquidityScore）
      // 任一升高都推高压力，使建造门禁 / P2 缩放对「富得流油却花不出去」也做出反应。
      // score 0→midpoint 映射 pressure 0.0→0.5（健康→谨慎）
      // score midpoint→midpoint+range 映射 pressure 0.5→1.0（紧张→危机）
      // RS-1：clamp 到 1.0 — score 上限（drainEnterScore=150）大于
      // midpoint+range(100)，无 clamp 时深度危机输出 ~1.42，而所有消费端
      // （demand 衰减/建造门禁/P2 饥饿判定）都假设 0..1 闭区间，
      // 超界会让线性衰减公式产生负乘数等语义失真。
      const { midpoint, range } = CONFIG.economy.economyPressure;
      const score = Math.max(phaseResult.drainScore, phaseResult.liquidityScore);
      roomMem.economyPressure = Math.min(1, score <= midpoint
        ? (score / midpoint) * 0.5
        : 0.5 + ((score - midpoint) / range) * 0.5);

      // 6. Storage 满仓检测 — 超过阈值时标记，供 demand 限采 + 加速消费。
      // 满仓 = 能量在源头被浪费（harvester drop），必须加速升级/建造消化盈余。
      if (snapshot.storage) {
        const storageEnergy = snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
        const storageCapacity = snapshot.storage.store.getCapacity(RESOURCE_ENERGY);
        roomMem.storageNearFull = storageCapacity > 0
          && storageEnergy / storageCapacity >= CONFIG.economy.storageFullThreshold;
      } else {
        roomMem.storageNearFull = false;
      }

      // 6. 检测控制器降级风险（非对称迟滞带）。
      // 进入阈值 = controllerDowngradeThreshold (10000)：低于此值进入风险。
      // 退出阈值 = controllerDowngradeExitThreshold (15000)：高于此值才退出风险。
      // 利用 roomMem.controllerDowngradeRisk 旧值作为状态记忆，无需额外字段。
      const controller = snapshot.controller;
      if (controller != null && controller.my) {
        const ttd = controller.ticksToDowngrade;
        if (roomMem.controllerDowngradeRisk) {
          // 当前已在风险状态：需回升到退出阈值以上才解除
          roomMem.controllerDowngradeRisk = ttd < CONFIG.economy.controllerDowngradeExitThreshold;
        } else {
          // 当前不在风险状态：低于进入阈值才触发
          roomMem.controllerDowngradeRisk = ttd < CONFIG.economy.controllerDowngradeThreshold;
        }
      } else {
        roomMem.controllerDowngradeRisk = false;
      }
    }
  },
};
