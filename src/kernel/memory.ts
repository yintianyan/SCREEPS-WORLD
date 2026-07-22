import { CONFIG } from "../config";
import { globalCache } from "./global-cache";
import { readLayoutSegment, markLayoutDirty } from "./segment-store";

/** 从版本 N 到 N+1 的迁移函数。每个必须幂等。 */
const MIGRATIONS: ReadonlyArray<{ from: number; to: number; run: () => void }> = [
  {
    from: 0,
    to: 1,
    run: () => {
      Memory.creeps ??= {};
      Memory.rooms ??= {};
    },
  },
  {
    from: 1,
    to: 2,
    run: () => {
      // v2：添加 kernel 跟踪，确保房间有孵化/建造队列。
      Memory.kernel ??= {};
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName];
        if (!room) continue;
        room.spawnQueue ??= [];
        room.buildQueue ??= [];
        room.layout ??= {
          version: 1,
          templateId: "compact-core-v1",
          state: "accepted",
          revision: 0,
          nextPlanTick: 0,
        };
      }
      // 迁移遗留 creep memory：从 working 标志设置 mode。
      for (const name in Memory.creeps) {
        const creep = Memory.creeps[name];
        if (creep && !creep.mode) {
          creep.mode = creep.working ? "work" : "acquire";
        }
      }
    },
  },
  {
    from: 2,
    to: 3,
    run: () => {
      // v3：扩展 LayoutMemory 添加 overrides 和 blocked 字段。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName];
        if (!room) continue;
        if (room.layout) {
          room.layout.overrides ??= {};
          room.layout.blocked ??= {};
        }
      }
    },
  },
  {
    from: 3,
    to: 4,
    run: () => {
      // v4：将 layout 冷数据（overrides/blocked）从 Memory 迁移到 RawMemory segment 0。
      // 减少每 tick JSON.stringify(Memory) 的体积。
      const segData = readLayoutSegment();
      let migrated = false;
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName];
        if (!room?.layout) continue;
        const overrides = room.layout.overrides;
        const blocked = room.layout.blocked;
        if (overrides || blocked) {
          segData[roomName] = {
            overrides: overrides ?? {},
            blocked: blocked ?? {},
          };
          delete room.layout.overrides;
          delete room.layout.blocked;
          migrated = true;
        }
      }
      if (migrated) markLayoutDirty();
    },
  },
  {
    from: 4,
    to: 5,
    run: () => {
      // v5：建档 CreepMemory.recycle? 与 RoomMemory.intel?（B1 回收通道 / C2 邻居情报）。
      // 两者均为可选字段，无需回填；此处仅做畸形数据自愈（幂等）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName];
        if (!room) continue;
        if (room.intel !== undefined && typeof room.intel !== "object") {
          delete room.intel;
        }
      }
      for (const name in Memory.creeps) {
        const creep = Memory.creeps[name];
        if (!creep) continue;
        if (creep.recycle !== undefined && typeof creep.recycle !== "boolean") {
          delete creep.recycle;
        }
      }
    },
  },
];

/**
 * 维护 Memory：执行版本化迁移、清理死亡 creep、初始化默认值。
 * 每 tick 开头调用一次。
 */
export function maintainMemory(): void {
  const current = Memory.schemaVersion ?? 0;
  if (current < CONFIG.memory.schemaVersion) migrateMemory(current);

  // 确保根结构存在。
  Memory.creeps ??= {};
  Memory.rooms ??= {};
  Memory.kernel ??= {};

  // 每 tick 清理死亡 creep memory（小帝国 — 安全且廉价）。
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 确保每个自有房间有 RoomMemory 条目。
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room || !room.controller?.my) continue;
    if (!Memory.rooms[roomName]) {
      Memory.rooms[roomName] = { spawnQueue: [], buildQueue: [] };
    } else {
      const rm = Memory.rooms[roomName];
      rm.spawnQueue ??= [];
      rm.buildQueue ??= [];
    }
  }
}

/** 按升序执行迁移。每个迁移都是幂等的。 */
function migrateMemory(currentVersion: number): void {
  let version = currentVersion;
  for (const migration of MIGRATIONS) {
    if (version === migration.from) {
      migration.run();
      version = migration.to;
      Memory.schemaVersion = version;
    }
  }
  // 如果没有迁移执行，强制将 schema 版本设为目标值。
  Memory.schemaVersion = CONFIG.memory.schemaVersion;
}

/**
 * 记录跳过原因，用于遥测和诊断。
 * 单 tick 内累加到 global 缓冲区，tick 末尾由 flushSkips 低频刷入 Memory，
 * 避免在 CPU 压力下产生频繁 Memory 写入。
 */
export function recordSkip(reason: string): void {
  const g = globalCache();
  if (!g.skipBuffer) g.skipBuffer = {};
  g.skipBuffer[reason] = (g.skipBuffer[reason] ?? 0) + 1;

  // 同时递增单 tick 遥测计数器。
  if (g.telemetry && g.telemetry.tick === Game.time) {
    g.telemetry.skipped++;
  }
}

/**
 * 将 global 中的 skipBuffer 刷入 Memory，并执行低频清理。
 * 由 Kernel 在 tick 末尾调用。
 */
export function flushSkips(): void {
  const g = globalCache();
  if (!g.skipBuffer) return;

  if (!Memory.kernel) Memory.kernel = {};
  if (!Memory.kernel.skipReasons) Memory.kernel.skipReasons = {};

  for (const [reason, count] of Object.entries(g.skipBuffer)) {
    // 累加但设上限，防止数字溢出。
    const current = Memory.kernel.skipReasons[reason] ?? 0;
    Memory.kernel.skipReasons[reason] = Math.min(current + count, 100000);
  }
  g.skipBuffer = {};

  // 每 500 tick 重置统计窗口，保留最近数据，防止无限增长。
  if (Game.time % 500 === 0) {
    Memory.kernel.skipReasons = {};
  }
}
