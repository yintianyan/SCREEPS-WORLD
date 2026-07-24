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

      // 1. 计算总储备 = energyAvailable + containers + storage + 在途 creep 携带能量。
      // 计入 creep 身上能量（P1-5 ①）：hauler 取/送不再改变 reserve，避免物流搬运制造假危机信号。
      let reserve = snapshot.energyAvailable;
      for (const c of snapshot.containers) {
        reserve += c.store.getUsedCapacity(RESOURCE_ENERGY);
      }
      if (snapshot.storage) {
        reserve += snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
      }
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

      // 3. 评估殖民相位（带迟滞的纯函数）。
      const prevPhase: PhaseState = {
        phase: roomMem.phase?.phase ?? "growth",
        prevReserve: roomMem.phase?.reserve,
        drainScore: roomMem.phase?.drainScore ?? 0,
        liquidityScore: roomMem.phase?.liquidityScore ?? 0,
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
        harvesterCount,
        sourceCount: snapshot.sources.length,
        rcl: snapshot.rcl,
      };

      // 5. 映射为 ColonyState 并写入 RoomMemory。
      const hasHostiles = snapshot.threatCreeps.length > 0;
      roomMem.colonyState = phaseToColonyState(phaseResult.phase, hasHostiles);

      // 5.5 经济压力梯度信号 (0.0–1.0)。
      // 取双维度最大值（方案 C）：偿付危机（drainScore）与流动性危机（liquidityScore）
      // 任一升高都推高压力，使建造门禁 / P2 缩放对「富得流油却花不出去」也做出反应。
      // score 0→40 映射 pressure 0.0→0.5（健康→谨慎）
      // score 40→100 映射 pressure 0.5→1.0（紧张→危机）
      const score = Math.max(phaseResult.drainScore, phaseResult.liquidityScore);
      roomMem.economyPressure = score <= 40
        ? (score / 40) * 0.5
        : 0.5 + ((score - 40) / 60) * 0.5;

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

      // 6. 检测控制器降级风险。
      const controller = snapshot.controller;
      roomMem.controllerDowngradeRisk =
        controller != null &&
        controller.my &&
        controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;
    }
  },
};
