import { CONFIG } from "../config";
import { globalCache } from "./global-cache";
import { recordCreepDeath } from "./event-log";
import { readLayoutSegment, markLayoutDirty, layoutSegmentReady } from "./segment-store";

/** 从版本 N 到 N+1 的迁移函数。每个必须幂等。
 * ready（可选）：迁移依赖的外部资源（如 RawMemory segment）是否就绪 —
 * 未就绪时迁移链在此中断，版本停在断点，下 tick 重试。 */
const MIGRATIONS: ReadonlyArray<{ from: number; to: number; ready?: () => boolean; run: () => void }> = [
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
    // 就绪门禁：reset 首 tick segment 未加载时 readLayoutSegment 返回不缓存的
    // 临时空结构 — 若照常迁移，overrides/blocked 会被写进临时对象后随 Memory
    // 删除而永久丢失。segment 就绪（下一 tick）后再执行。
    ready: () => layoutSegmentReady(),
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
  {
    from: 10,
    to: 11,
    run: () => {
      // v11：扩张系统 — expansion / expansionBlacklist / lostRooms 均为
      // Memory.kernel 下的可选字段，惰性创建，无需回填；
      // 此处仅做畸形数据自愈（幂等）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      if (kernel.expansion !== undefined && typeof kernel.expansion !== "object") {
        delete kernel.expansion;
      }
      if (kernel.expansionBlacklist !== undefined && typeof kernel.expansionBlacklist !== "object") {
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
      // v12：威胁情报与受袭记忆 — roomMem.lastHostileAt 与
      // intel 条目的 towers/dangerUntil 均为可选数字字段，惰性写入，
      // 无需回填；此处仅做畸形数据自愈（幂等）。
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
      // v14：相位驻留计数 — 为已有 phase 状态回填 bandTicks。
      // 缺失时按 0（未入危机带）处理；处于危机带的房间从 0 重新计驻留，
      // 最坏情况是本次危机多停留一个驻留窗口，安全方向的保守默认。
      // 幂等：仅当字段缺失时写入。
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
      // v15：P0-A 远矿 site 收编 — RemoteOp 新增 siteCount 字段（可选，惰性写入）。
      // 此迁移仅做畸形数据自愈（幂等）：siteCount 存在但非数字时清除。
      // 实际值由 remote-mining-manager 每 managerInterval tick 用 lookForAtArea 实测校正，
      // 首次运行时从 undefined 自然收敛到真实值，无需回填。
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
      // v16：P1-G dangerUntil 搬家 — 从 intel[room].dangerUntil 迁移到
      // remoteOps[room].dangerUntil（remote-mining-manager 成为唯一写者）。
      // 幂等：仅当 intel 条目存在 dangerUntil 时处理。对应 remoteOps 条目
      // 存在且尚无 dangerUntil 时搬运；否则仅删除 intel 侧旧字段。
      // remoteOps 条目不存在时（房间已从 remoteOps 清除）仅删旧字段 —
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
          // 搬运到对应 remoteOps 条目（如有且尚无 dangerUntil）。
          if (ops && ops[intelRoomName] && ops[intelRoomName]!.dangerUntil === undefined) {
            ops[intelRoomName]!.dangerUntil = entry.dangerUntil;
          }
          delete entry.dangerUntil;
        }
      }
    },
  },
  {
    from: 16,
    to: 17,
    run: () => {
      // v17：P1-F layout 4-stage 分片 — LayoutMemory 新增 planStage 字段。
      // 可选字段，惰性创建；此处仅幂等回填 planStage=0（视为空闲态）。
      // 畸形数据自愈：非数字值清除回 undefined（layout-planner 视作 0）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        const layout = room.layout as Record<string, unknown> | undefined;
        if (!layout) continue;
        if (layout.planStage === undefined) {
          layout.planStage = 0;
        } else if (
          typeof layout.planStage !== "number" ||
          layout.planStage < 0 ||
          layout.planStage > 3
        ) {
          delete layout.planStage;
        }
      }
    },
  },
  {
    from: 17,
    to: 18,
    run: () => {
      // v18：P1-I tuning 版本戳 — TuningMemory 新增 baselineVersion 字段（可选）。
      //
      // 设计决策：迁移只做「建档」不做「定版」——故意不写 baselineVersion
      // 当前值（CONFIG.tuning.baselineVersion=1），让 tuning-engine 首次
      // 评估时检测 undefined ≠ CONFIG 值 → 触发清空 rooms 覆盖（清零重来
      // 语义，task summary 已确认）。若迁移直接定版为 CONFIG 值，则存量
      // 旧覆盖会保留并继续压制新基线，违背 P1-I 修复目标。
      //
      // 幂等：仅做畸形数据自愈（非数字值清除），不写当前版本号。
      // tuning-engine 是 baselineVersion 的唯一写者（迁移除外）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const tuning = kernel.tuning as Record<string, unknown> | undefined;
      if (!tuning) return;
      if (
        tuning.baselineVersion !== undefined &&
        typeof tuning.baselineVersion !== "number"
      ) {
        delete tuning.baselineVersion;
      }
    },
  },
  {
    from: 18,
    to: 19,
    run: () => {
      // v19：P1-J demand 纯度收口 — RoomMemory 的 distScaleUpSince 与
      // builderPressureState 字段原本由 domain/spawn/demand.ts 直读写，
      // 现收敛为适配层（spawn-manager）显式输入输出。
      //
      // 字段本身在 RoomMemory 类型中早已登记（global.d.ts:215/221），
      // 但游离在迁移体系外。本迁移将其纳入 schema 管理：幂等畸形自愈
      // （distScaleUpSince 非数字清除、builderPressureState 非 'full'/'shrinking' 清除）。
      //
      // 语义不变：v18 之前 demand 直接写 Memory，v19 之后由 spawn-manager
      // 适配层 prevHysteresis/nextHysteresis 读写，行为与之前逐 tick 一致
      // （已由集成测试验证）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        if (
          room.distScaleUpSince !== undefined &&
          typeof room.distScaleUpSince !== "number"
        ) {
          delete room.distScaleUpSince;
        }
        if (
          room.builderPressureState !== undefined &&
          room.builderPressureState !== "full" &&
          room.builderPressureState !== "shrinking"
        ) {
          delete room.builderPressureState;
        }
      }
    },
  },
];

/**
 * 执行版本化迁移（K-5：与日常维护拆分为独立错误边界）。
 * 迁移中途 throw 不再连坐死 creep 清理/房间兜底 — 持续失败的迁移
 * 曾使 maintainMemory 后半段整 tick 跳过，Memory.creeps 慢性泄漏。
 */
export function runMigrations(): void {
  const current = Memory.schemaVersion ?? 0;
  if (current < CONFIG.memory.schemaVersion) migrateMemory(current);
}

/**
 * 维护 Memory：清理死亡 creep、初始化默认值、失守房宽限清理。
 * 每 tick 开头调用一次（迁移由 runMigrations 独立执行，见 K-5）。
 */
export function maintainMemory(): void {
  // 确保根结构存在。
  Memory.creeps ??= {};
  Memory.rooms ??= {};
  Memory.kernel ??= {};

  // 每 tick 清理死亡 creep memory（小帝国 — 安全且廉价）。
  // 清理前记录死亡事件（战斗黑匣子 M9）— 这是死亡的唯一系统性检测点。
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      recordCreepDeath(name);
      delete Memory.creeps[name];
    }
  }

  // 确保每个自有房间有 RoomMemory 条目。
  const ownedRooms = new Set<string>();
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room || !room.controller?.my) continue;
    ownedRooms.add(roomName);
    if (!Memory.rooms[roomName]) {
      Memory.rooms[roomName] = { spawnQueue: [], buildQueue: [] };
    } else {
      const rm = Memory.rooms[roomName];
      rm.spawnQueue ??= [];
      rm.buildQueue ??= [];
    }
  }

  // 失守房间清理：Memory.rooms 中不再拥有的房间条目延迟清除。
  // 自有房恒有视野（结构提供视野），条目房不在拥有集合即为失守/放弃。
  // 宽限期防止 claim 边界抖动误删布局与队列数据；到期后连同
  // tuning 覆盖值一并清除，避免失守房数据永久滞留（慢性泄漏）。
  const LOST_ROOM_GRACE = 20000;
  Memory.kernel.lostRooms ??= {};
  const lostRooms = Memory.kernel.lostRooms;
  for (const roomName in Memory.rooms) {
    if (ownedRooms.has(roomName)) {
      if (lostRooms[roomName] !== undefined) delete lostRooms[roomName];
      continue;
    }
    const lostAt = lostRooms[roomName] ??= Game.time;
    if (Game.time - lostAt > LOST_ROOM_GRACE) {
      delete Memory.rooms[roomName];
      delete lostRooms[roomName];
      if (Memory.kernel.tuning?.rooms[roomName]) {
        delete Memory.kernel.tuning.rooms[roomName];
      }
      if (Memory.kernel.tuning?.lastEval?.[roomName]) {
        delete Memory.kernel.tuning.lastEval[roomName];
      }
    }
  }
}

/** 按升序执行迁移。每个迁移都是幂等的。
 *
 * 迁移链中断语义：某步的 ready() 未就绪时停在断点、保留当前版本，
 * 下 tick 从断点续跑 — 幂等性保证重复执行安全。
 * 版本号只随实际执行的迁移递增，不做无条件盖章：
 * 若未来 MIGRATIONS 出现断号，版本会停在缺口处暴露问题，
 * 而不是被盖章静默掩盖、永久丢失缺口步骤。
 */
function migrateMemory(currentVersion: number): void {
  let version = currentVersion;
  for (const migration of MIGRATIONS) {
    if (version !== migration.from) continue;
    if (migration.ready && !migration.ready()) break;
    migration.run();
    version = migration.to;
    Memory.schemaVersion = version;
  }
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
