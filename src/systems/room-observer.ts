import { CONFIG } from "../config";
import type { Priority, System, TickContext } from "../kernel/contracts";

/**
 * 房间观察器 — P3 房间级策略协调器。
 *
 * 低频运行用于：
 *   - 检测控制器降级风险并记录到房间 memory
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
    }
  },
};
