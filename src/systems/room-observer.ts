import type { Priority, System, TickContext } from "../kernel/contracts";
import type { ColonyPhase } from "../domain/economy/phase";
import { scanNeighborIntel, type RoomIntel } from "../domain/intel";

/**
 * 相位诊断日志的固定打印间隔（tick）。
 * 相位变化时立即打印；无变化时每 50 tick 打印一次完整快照，便于在控制台观察趋势。
 */
const PHASE_LOG_INTERVAL = 50;

/** 邻居情报刷新间隔（tick）。房态/归属变化慢，50 tick 足够且零 CPU 压力。 */
const INTEL_SCAN_INTERVAL = 50;

/**
 * 房间观察器 — P3 房间级诊断与未来策略协调器。
 *
 * 低频运行用于：
 *   - 相位诊断日志（趋势观察，供调参）
 *   - 邻居房情报采集（C2：出口/房态/SK 分类零视野可得；资源字段有待视野补全）
 *   - 触发布局规划（未来）
 *   - 协调防御响应（未来）
 *
 * 经济状态计算（ColonyPhase → ColonyState）已移至 room-state 系统（P0，每 tick）。
 */
export const roomObserverSystem: System = {
  name: "room-observer",
  priority: 3 as Priority,
  interval: 5,
  run(ctx: TickContext): void {
    for (const snapshot of ctx.snapshots()) {
      const roomMem = Memory.rooms[snapshot.roomName];
      if (!roomMem) continue;

      // 诊断日志：相位变化时立即打印；无变化时按固定间隔打印快照。
      // room-state 系统每 tick 更新 roomMem.phase，此处仅读取并输出。
      const phase = roomMem.phase;
      if (phase) {
        logPhaseIfChangedOrDue(
          ctx.tick,
          snapshot.roomName,
          undefined, // 前一个相位名称不再在此追踪（room-state 已写入）
          phase.phase as ColonyPhase,
          phase,
        );
      }

      // C2：邻居房情报 — M7 远矿/扩张选址的数据源。
      if (ctx.tick % INTEL_SCAN_INTERVAL === 0) {
        refreshNeighborIntel(snapshot.roomName, roomMem, ctx.tick);
      }
    }
  },
};

/**
 * 刷新本房出口邻房的情报记录。
 * describeExits + getRoomStatus 无需视野；Game.rooms 有视野时补资源/归属字段。
 * 只写短字段（每邻房 ≤6 个标量），Memory 体积有界。
 */
function refreshNeighborIntel(roomName: string, roomMem: RoomMemory, tick: number): void {
  const exits = Game.map.describeExits(roomName);
  if (!exits) return;

  const intel: Record<string, RoomIntel> = roomMem.intel ?? {};
  for (const neighbor of Object.values(exits)) {
    if (!neighbor) continue;
    const status = Game.map.getRoomStatus(neighbor).status;
    const visible = Game.rooms[neighbor];
    intel[neighbor] = scanNeighborIntel(
      neighbor,
      status,
      tick,
      visible
        ? {
            sources: visible.find(FIND_SOURCES).length,
            mineralType: visible.find(FIND_MINERALS)[0]?.mineralType,
            owner: visible.controller?.owner?.username,
          }
        : undefined,
    );
  }
  roomMem.intel = intel;
}

/**
 * 相位诊断日志输出（限频）。
 *
 * 触发条件：
 *   - 到达 PHASE_LOG_INTERVAL 周期：打印完整快照，标记 [PERIODIC]
 *
 * 无变化且未到周期：静默，避免控制台刷屏。
 */
function logPhaseIfChangedOrDue(
  tick: number,
  roomName: string,
  _prevPhase: ColonyPhase | undefined,
  newPhase: ColonyPhase,
  state: NonNullable<RoomMemory["phase"]>,
): void {
  const due = tick % PHASE_LOG_INTERVAL === 0;
  if (!due) return;

  console.log(
    `[PERIODIC] phase/${roomName}: phase=${newPhase}` +
      ` reserve=${state.reserve} delta=${state.reserveDelta >= 0 ? "+" : ""}${state.reserveDelta}` +
      ` drain=${state.drainScore} harv=${state.harvesterCount}/${state.sourceCount} rcl=${state.rcl}` +
      ` state=${Memory.rooms[roomName]?.colonyState ?? "?"}`,
  );
}
