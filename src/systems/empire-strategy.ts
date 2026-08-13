/**
 * Empire Strategy — P1 系统，帝国姿态的唯一裁决者与发布者。
 *
 * 架构定位（6 层模型的 Strategy 层）：
 *   State（room-state 写入的 colonyState/economyPressure/lastHostileAt）
 *     → 本系统评估姿态（domain/strategy/posture 纯函数）
 *     → 写 Memory.kernel.strategy
 *     → 执行系统消费指令（expansion-manager / remote-mining-manager / 未来进攻系统）
 *
 * 铁律：执行系统不得自行裁决「是否该扩张/开战」— 它们读姿态指令行事。
 * 局部安全门禁（RCL 门槛、bucket 保护等）可以叠加收紧，但不得放宽姿态。
 * 进攻执行器未来接入时同样：war 姿态是授权来源，代码存在不等于战争开始。
 *
 * 运行成本：每 tick 读几个 Memory 字段做一次纯函数评估（<0.05 CPU），
 * P1 保证在 P2/P3 消费者之前完成本 tick 姿态刷新。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  evaluateEmpirePosture,
  type RoomStrategyInput,
} from "../domain/strategy/posture";

export const empireStrategySystem: System = {
  name: "empire-strategy",
  priority: 1 as Priority,
  interval: 1,
  run(ctx: TickContext): void {
    // 采集各房战略输入（room-state P0 已在本 tick 更新过这些字段）。
    const rooms: RoomStrategyInput[] = [];
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;
      rooms.push({
        colonyState: roomMem.colonyState ?? "normal",
        economyPressure: roomMem.economyPressure ?? 0,
        lastHostileAt: roomMem.lastHostileAt,
        rcl: snapshot.rcl,
        storageEnergy: snapshot.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
      });
    }

    if (!Memory.kernel) Memory.kernel = {};
    const prev = Memory.kernel.strategy;

    const result = evaluateEmpirePosture({
      tick: ctx.tick,
      rooms,
      gclLevel: Game.gcl?.level ?? 1,
      bucket: Game.cpu.bucket ?? 10000,
      prev: prev ? { posture: prev.posture, since: prev.since } : undefined,
      // R4：war 可持续性计数跨 tick 回传（pressure 滞回输入）。
      warPressureTicks: prev?.warPressureTicks,
    });

    // 姿态变更时打日志 — 战略转向是帝国级事件，必须可观测。
    if (prev?.posture !== result.posture) {
      console.log(
        `[${ctx.tick}] strategy: posture ${prev?.posture ?? "(none)"} → ${result.posture}` +
        ` (rooms=${rooms.length}, gcl=${Game.gcl?.level ?? 1}, bucket=${Game.cpu.bucket ?? "?"})`,
      );
    }

    Memory.kernel.strategy = {
      posture: result.posture,
      since: result.since,
      expansionAllowed: result.expansionAllowed,
      newRemoteOpsAllowed: result.newRemoteOpsAllowed,
      warPressureTicks: result.warPressureTicks,
    };
  },
};
