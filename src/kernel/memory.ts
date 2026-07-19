import { CONFIG } from "../config";

export function maintainMemory(): void {
  if (Memory.schemaVersion !== CONFIG.memory.schemaVersion) migrateMemory();

  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }
}

function migrateMemory(): void {
  // Add migrations here in ascending version order. Migrations must be idempotent.
  Memory.creeps ??= {};
  Memory.rooms ??= {};
  Memory.schemaVersion = CONFIG.memory.schemaVersion;
}
