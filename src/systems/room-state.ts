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

      // 1. 计算总储备 = energyAvailable + containers + storage。
      let reserve = snapshot.energyAvailable;
      for (const c of snapshot.containers) {
        reserve += c.store.getUsedCapacity(RESOURCE_ENERGY);
      }
      if (snapshot.storage) {
        reserve += snapshot.storage.store.getUsedCapacity(RESOURCE_ENERGY);
      }

      // 2. 统计有效采集者（已分配 source 的 harvester/worker）。
      // 复用 Kernel 预构建的 sourceOccupancy 求和，避免遍历全部 Game.creeps。
      let harvesterCount = 0;
      for (const count of snapshot.sourceOccupancy.values()) {
        harvesterCount += count;
      }

      // 3. 评估殖民相位（带迟滞的纯函数）。
      const prevPhase: PhaseState = {
        phase: roomMem.phase?.phase ?? "growth",
        prevReserve: roomMem.phase?.reserve,
        drainScore: roomMem.phase?.drainScore ?? 0,
      };
      const phaseResult = evaluateColonyPhase(
        {
          reserve,
          spendable: snapshot.energyAvailable,
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
        harvesterCount,
        sourceCount: snapshot.sources.length,
        rcl: snapshot.rcl,
      };

      // 5. 映射为 ColonyState 并写入 RoomMemory。
      const hasHostiles = snapshot.hostileCreeps.length > 0;
      roomMem.colonyState = phaseToColonyState(phaseResult.phase, hasHostiles);

      // 5.5 经济压力梯度信号 (0.0–1.0)。
      // drainScore 0→40 映射 pressure 0.0→0.5（健康→谨慎）
      // drainScore 40→100 映射 pressure 0.5→1.0（紧张→危机）
      // 各子系统用此信号做梯度缩放，替代二值 crisis/normal 开关。
      const ds = phaseResult.drainScore;
      roomMem.economyPressure = ds <= 40
        ? (ds / 40) * 0.5
        : 0.5 + ((ds - 40) / 60) * 0.5;

      // 6. 检测控制器降级风险。
      const controller = snapshot.controller;
      roomMem.controllerDowngradeRisk =
        controller != null &&
        controller.my &&
        controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold;
    }
  },
};
