/**
 * Empire Strategy — P1 系统，帝国姿态与议程的唯一裁决者与发布者（6 层模型的 Strategy 层）：
 * State（room-state 写入的 colonyState/economyPressure/lastHostileAt）
 *   → 本系统用 domain/strategy/posture 纯函数评估姿态 → 写 Memory.kernel.strategy
 *   → 执行系统（expansion-manager / remote-mining-manager / 未来进攻系统）消费指令。
 * 铁律：执行系统不得自行裁决「是否该扩张/开战」— 它们读姿态指令行事；
 * 局部安全门禁（RCL 门槛、bucket 保护等）可以叠加收紧，但不得放宽姿态。
 * 进攻执行器未来接入时同样：war 姿态是授权来源，代码存在不等于战争开始。
 * R6a：同批评估帝国议程（domain/strategy/agenda 纯函数）→ 写 Memory.kernel.agenda —
 * 姿态回答「处于什么状态」，议程回答「主动在做什么」，切换记录 AgendaChange 事件。
 */
import type { Priority, System, TickContext } from "../kernel/contracts";
import {
  evaluateEmpirePosture,
  type RoomStrategyInput,
} from "../domain/strategy/posture";
import { evaluateAgenda } from "../domain/strategy/agenda";
import { CONFIG } from "../config";
import { EventKind, recordEvent } from "../kernel/event-log";

/** AgendaChange 事件的 initiative 编码（与 event-log 注释对齐）。 */
const AGENDA_CODES: Record<string, number> = {
  recovery: 0,
  "defense-readiness": 1,
  "rcl-push": 2,
  develop: 3,
};

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

    // ── R6a：帝国议程 — 姿态回答状态，议程回答主动目标 ──
    const prevAgenda = Memory.kernel.agenda;
    const agenda = evaluateAgenda(
      {
        tick: ctx.tick,
        rooms,
        prev: prevAgenda,
      },
      {
        threatWindow: CONFIG.agenda.threatWindow,
        rclPushStorage: CONFIG.agenda.rclPushStorage,
        rclPushMaxPressure: CONFIG.agenda.rclPushMaxPressure,
        minDwell: CONFIG.agenda.minDwell,
      },
    );
    if (prevAgenda?.initiative !== agenda.initiative) {
      console.log(
        `[${ctx.tick}] agenda: ${prevAgenda?.initiative ?? "(none)"} → ${agenda.initiative}`,
      );
      recordEvent(EventKind.AgendaChange, "", [AGENDA_CODES[agenda.initiative] ?? 3]);
    }
    Memory.kernel.agenda = agenda;
  },
};
