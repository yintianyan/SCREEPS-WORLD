import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";
import { evaluateEnergyCrisis } from "../domain/economy/crisis";

/**
 * 房间观察器 — P3 房间级策略协调器。
 *
 * 低频运行用于：
 *   - 检测控制器降级风险并记录到房间 memory
 *   - 检测能量危机（带迟滞）并记录到房间 memory，供 spawn/建造/分配收缩消耗
 *   - 触发布局规划（未来）
 *   - 协调防御响应（未来）
 *
 * 此系统刻意保持轻量。繁重的规划工作应放在
 * 拥有独立间隔和 CPU 预算的专用系统中。
 */
export const roomObserverSystem: System = {
  name: "room-observer",
  priority: 3 as Priority,
  interval: 5,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // 检查控制器降级风险并记录到房间 memory 供诊断。
      const controller = snapshot.controller;
      if (controller && controller.my && controller.ticksToDowngrade < CONFIG.economy.controllerDowngradeThreshold) {
        roomMem.controllerDowngradeRisk = true;
      } else {
        roomMem.controllerDowngradeRisk = false;
      }

      // 能量危机检测（带迟滞）— 写入 memory 供 spawn/建造/分配在危机时收缩消耗、保 harvester。
      const crisis = evaluateEnergyCrisis(
        snapshot,
        { crisisScore: roomMem.crisisScore ?? 0, energyCrisis: roomMem.energyCrisis ?? false },
        CONFIG.economy.crisis,
      );
      roomMem.crisisScore = crisis.crisisScore;
      roomMem.energyCrisis = crisis.energyCrisis;
    }
  },
};
