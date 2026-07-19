import type { System } from "../kernel/contracts";

/** Extension point for room-level planning. Keep strategic state in RoomMemory. */
export const roomObserverSystem: System = {
  name: "room-observer",
  run(): void {
    for (const room of Object.values(Game.rooms)) {
      if (!room.controller?.my) continue;
      // Reserve this system for room planning, spawn policy, and defense coordination.
    }
  },
};
