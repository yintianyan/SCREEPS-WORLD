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
        const creep = Memory.creeps[name] as any;
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
  {
    from: 5,
    to: 6,
    run: () => {
      // v6：核心模板 compact-core-v1 → v2（偶校验棋盘格，修复全密封实心块）。
      // v1 的 cell 坐标全部作废：清理 buildQueue 中未开工的 core.* 任务
      // （site/done 的已建结构保留，不拆不改），版本号+1、revision+1 触发重规划。
      // 幂等：仅当 templateId 仍为 v1 时执行，重复运行不再递增 revision。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName];
        if (!room?.layout) continue;
        if (room.layout.templateId === "compact-core-v2") continue;
        room.layout.templateId = "compact-core-v2";
        room.layout.version = 2;
        room.layout.revision = (room.layout.revision ?? 0) + 1;
        room.layout.nextPlanTick = 0;
        if (Array.isArray(room.buildQueue)) {
          room.buildQueue = room.buildQueue.filter(
            t => !(t.key.startsWith("core.") && (t.state === "queued" || t.state === "blocked")),
          );
        }
      }
    },
  },
  {
    from: 6,
    to: 7,
    run: () => {
      // v7：添加参数自调优 Memory 结构（Memory.kernel.tuning）。
      // tuning 字段可选——tuning-engine 首次运行时自动初始化。
      // 此迁移仅做畸形数据自愈（幂等）：如果 tuning 存在但结构不完整，修正它。
      if (!Memory.kernel) Memory.kernel = {};
      if (Memory.kernel.tuning !== undefined) {
        // 确保必要子字段存在。
        const t = Memory.kernel.tuning as any;
        if (typeof t !== "object" || t === null) {
          delete Memory.kernel.tuning;
        } else {
          if (typeof t.lastTuned !== "number") t.lastTuned = 0;
          if (typeof t.rooms !== "object" || t.rooms === null) t.rooms = {};
          // lastEval 从 v7 早期的单对象格式迁移为 Record<string, {...}>。
          // 旧格式有 room 字段，新格式以 room 为 key。
          if (t.lastEval !== undefined && typeof t.lastEval === "object" && !Array.isArray(t.lastEval)) {
            const oldEval = t.lastEval as any;
            if (typeof oldEval.room === "string" && typeof oldEval.tick === "number") {
              // 旧格式：单对象 { tick, room, adjustments, signals, skipped }
              const room = oldEval.room;
              const migrated: Record<string, any> = {};
              migrated[room] = {
                tick: oldEval.tick,
                adjustments: oldEval.adjustments ?? [],
                signals: oldEval.signals ?? {},
                skipped: oldEval.skipped,
              };
              t.lastEval = migrated;
            }
            // 如果已经是 Record 格式（无 room 字段），保持不变。
          }
        }
      }
    },
  },
  {
    from: 7,
    to: 8,
    run: () => {
      // v8：清除 CreepMemory.working 遗留字段。
      // v1→v2 迁移已将 working 转为 mode，但字段本身从未被删除。
      // 此迁移幂等地删除所有 creep 的 working 字段；
      // 如果 creep 没有 working 字段，delete 无副作用。
      for (const name in Memory.creeps) {
        const creep = Memory.creeps[name] as any;
        if (creep && creep.working !== undefined) {
          delete creep.working;
        }
      }
    },
  },
  {
    from: 8,
    to: 9,
    run: () => {
      // v9：方案 C 流动性维度 — 为每个房间的 phase 回填 liquidityScore 字段。
      // 旧 Memory 的 phase 无此字段；缺失时默认 0（不假定存在流动性危机，
      // 分数随后由 room-state 每 tick 从 spendableRatio/frozenRatio 实时信号累加）。
      // 幂等：仅当字段缺失时写入。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as any;
        if (room?.phase && room.phase.liquidityScore === undefined) {
          room.phase.liquidityScore = 0;
        }
      }
    },
  },
  {
    from: 9,
    to: 10,
    run: () => {
      // v10：远矿运营 — 为每个自有房间初始化 remoteOps 字段。
      // remoteOps 是可选字段，无需回填；此处仅做畸形数据自愈（幂等）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as any;
        if (!room) continue;
        if (room.remoteOps !== undefined && typeof room.remoteOps !== "object") {
          delete room.remoteOps;
        }
      }
      // 清理死亡 creep 的 remoteTarget 遗留（creep 死亡后 memory 已被清理，
      // 但防御性检查不伤害）。
      for (const name in Memory.creeps) {
        const creep = Memory.creeps[name] as any;
        if (creep && creep.remoteTarget !== undefined && typeof creep.remoteTarget !== "string") {
          delete creep.remoteTarget;
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
