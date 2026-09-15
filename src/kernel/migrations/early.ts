/** 早期迁移 v0→v15：基础结构初始化（creeps/rooms/kernel/队列/layout 骨架/segment 冷数据）。 */
import type { MigrationStep } from "./types";
import { readLayoutSegment, markLayoutDirty, layoutSegmentReady } from "../segment-store";

export const EARLY_MIGRATIONS: MigrationStep[] = [
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
    // 就绪门禁：segment 未就绪时 readLayoutSegment 返回临时空结构，迁移会把数据
    // 写进临时对象后随 Memory 删除而永久丢失 — 就绪（下一 tick）后再执行。
    ready: () => layoutSegmentReady(),
    run: () => {
      // v4：layout 冷数据（overrides/blocked）迁到 RawMemory segment 0，
      // 减小每 tick JSON.stringify(Memory) 体积。
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
      // v6：核心模板 compact-core-v1 → v2（偶校验棋盘格）。v1 的 cell 坐标作废：
      // 清理未开工的 core.* 任务（已建结构保留不拆），版本号+1 触发重规划。
      // 幂等：仅当 templateId 仍为 v1 时执行。
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
      // v7：新增 Memory.kernel.tuning（参数自调优）— 可选字段，tuning-engine
      // 首次运行时自动初始化；此迁移仅做畸形数据自愈。
      if (!Memory.kernel) Memory.kernel = {};
      if (Memory.kernel.tuning !== undefined) {
        const t = Memory.kernel.tuning as any;
        if (typeof t !== "object" || t === null) {
          delete Memory.kernel.tuning;
        } else {
          if (typeof t.lastTuned !== "number") t.lastTuned = 0;
          if (typeof t.rooms !== "object" || t.rooms === null) t.rooms = {};
          // lastEval 从早期单对象格式 { tick, room, adjustments, signals, skipped }
          // 迁移为 Record<room, {...}>。
          if (
            t.lastEval !== undefined &&
            typeof t.lastEval === "object" &&
            !Array.isArray(t.lastEval)
          ) {
            const oldEval = t.lastEval as any;
            if (typeof oldEval.room === "string" && typeof oldEval.tick === "number") {
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
            // 已是 Record 格式（无 room 字段）则保持不变。
          }
        }
      }
    },
  },
  {
    from: 7,
    to: 8,
    run: () => {
      // v8：清除 CreepMemory.working 遗留字段 — v1→v2 已把 working 转为
      // mode，但字段本身从未被删除。
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
      // v9：方案 C 流动性维度 — 为 phase 回填 liquidityScore=0（不假定存在
      // 流动性危机；分数由 room-state 每 tick 从实时信号累加）。幂等：仅缺失时写入。
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
      // 清理 creep 的 remoteTarget 畸形遗留。
      for (const name in Memory.creeps) {
        const creep = Memory.creeps[name] as any;
        if (creep && creep.remoteTarget !== undefined && typeof creep.remoteTarget !== "string") {
          delete creep.remoteTarget;
        }
      }
    },
  },
  {
    from: 10,
    to: 11,
    run: () => {
      // v11：扩张系统 — expansion/expansionBlacklist/lostRooms 均为 kernel 下
      // 可选字段，惰性创建；仅畸形自愈。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      if (kernel.expansion !== undefined && typeof kernel.expansion !== "object") {
        delete kernel.expansion;
      }
      if (
        kernel.expansionBlacklist !== undefined &&
        typeof kernel.expansionBlacklist !== "object"
      ) {
        delete kernel.expansionBlacklist;
      }
      if (kernel.lostRooms !== undefined && typeof kernel.lostRooms !== "object") {
        delete kernel.lostRooms;
      }
    },
  },
  {
    from: 11,
    to: 12,
    run: () => {
      // v12：威胁情报与受袭记忆 — lastHostileAt 与 intel 条目的 towers/
      // dangerUntil 均为可选数字字段，惰性写入；仅畸形自愈。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        if (room.lastHostileAt !== undefined && typeof room.lastHostileAt !== "number") {
          delete room.lastHostileAt;
        }
        const intel = room.intel as Record<string, Record<string, unknown>> | undefined;
        if (!intel) continue;
        for (const entry of Object.values(intel)) {
          if (entry.towers !== undefined && typeof entry.towers !== "number") {
            delete entry.towers;
          }
          if (entry.dangerUntil !== undefined && typeof entry.dangerUntil !== "number") {
            delete entry.dangerUntil;
          }
        }
      }
    },
  },
  {
    from: 12,
    to: 13,
    run: () => {
      // v13：帝国姿态 — kernel.strategy 为可选字段，empire-strategy 每 tick
      // 重建，无需回填；此处仅做畸形数据自愈（幂等）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      if (kernel.strategy !== undefined && typeof kernel.strategy !== "object") {
        delete kernel.strategy;
      }
    },
  },
  {
    from: 13,
    to: 14,
    run: () => {
      // v14：相位驻留计数 — 为已有 phase 回填 bandTicks=0（未入危机带；
      // 危机带房间从 0 重计驻留，多停留一个窗口是安全方向的保守默认）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName];
        if (room?.phase && room.phase.bandTicks === undefined) {
          room.phase.bandTicks = 0;
        }
      }
    },
  },
  {
    from: 14,
    to: 15,
    run: () => {
      // v15：P0-A 远矿 site 收编 — RemoteOp 新增 siteCount（可选，惰性写入）；
      // 实际值由 remote-mining-manager 每 managerInterval 实测校正，无需回填。
      // 此处仅畸形自愈。
      for (const roomName in Memory.rooms) {
        const ops = Memory.rooms[roomName]?.remoteOps;
        if (!ops) continue;
        for (const op of Object.values(ops)) {
          if (op.siteCount !== undefined && typeof op.siteCount !== "number") {
            delete op.siteCount;
          }
        }
      }
    },
  },
  {
    from: 15,
    to: 16,
    run: () => {
      // v16：P1-G dangerUntil 搬家 — intel[room].dangerUntil → remoteOps[room].dangerUntil
      // （remote-mining-manager 成为唯一写者）。对应条目存在且无 dangerUntil 时搬运，
      // 否则仅删 intel 旧字段；remoteOps 条目已清除时也仅删旧字段 —
      // dangerCooldown(2000) << cleanupThreshold(30000)，冷却早已过期。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        const intel = room.intel as Record<string, Record<string, unknown>> | undefined;
        if (!intel) continue;
        const ops = room.remoteOps as Record<string, Record<string, unknown>> | undefined;
        for (const intelRoomName in intel) {
          const entry = intel[intelRoomName];
          if (!entry || entry.dangerUntil === undefined) continue;
          if (typeof entry.dangerUntil !== "number") {
            delete entry.dangerUntil;
            continue;
          }
          if (ops && ops[intelRoomName] && ops[intelRoomName]!.dangerUntil === undefined) {
            ops[intelRoomName]!.dangerUntil = entry.dangerUntil;
          }
          delete entry.dangerUntil;
        }
      }
    },
  },
];
