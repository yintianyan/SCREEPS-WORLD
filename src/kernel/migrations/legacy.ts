/**
 * 旧备份 Memory 的一次性原子变换 —— 迁移链归并后的唯一迁移步骤。
 *
 * 运行时角色：
 * - 现行 Memory（schemaVersion = SCHEMA_VERSION）：本变换休眠（runMigrations 直接跳过）。
 * - 全新 Memory：各域为空，变换纯空转（结构 ??= 初始化除外）。
 * - 恢复 schemaVersion 低于现行的旧备份：一次性原子变换——9 个数据搬家/退役/
 *   畸形自愈变换按原链顺序执行，全部字段存在性守卫、幂等。
 *
 * 归并原则：旧链 49 步中仅保留「数据搬家/改名/退役/畸形自愈」类（缺一步则恢复
 * 的旧备份丢失数据或喂进畸形结构）；「逐版本补可选字段」类（40 余步）随归并
 * 移除——所有读取方都以 ?? 默认值兜底，字段缺失与补齐语义等价。
 *
 * 顺序契约：按原链目标版本升序——to:16 的 dangerUntil 搬家必须在 to:43 的
 * intel 整体退役之前（搬完才删）。
 */

import { readLayoutSegment, markLayoutDirty, layoutSegmentReady } from "../segment-store";
import type { LegacyTransform } from "./types";

export const LEGACY_TRANSFORMS: LegacyTransform[] = [
  {
    name: "layout-cold-data-to-segment",
    // 就绪门禁：segment 未就绪时 readLayoutSegment 返回临时空结构，数据会写进
    // 临时对象后随 Memory 删除而永久丢失——就绪（下一 tick）后再执行。
    // RawMemory 缺失（测试夹具）= segment 基建不可用：视为就绪并在 run 内跳过
    // （数据留在 RoomMemory.layout 原位，不阻断版本盖章）。
    ready: () => typeof RawMemory === "undefined" || layoutSegmentReady(),
    run: () => {
      if (typeof RawMemory === "undefined") return;
      // layout 冷数据（overrides/blocked）迁到 RawMemory segment 0，减小每拍
      // JSON.stringify(Memory) 体积。
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
    name: "layout-template-v2-replan",
    run: () => {
      // 核心模板 compact-core-v1 → v2（偶校验棋盘格）。v1 的 cell 坐标作废：
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
    name: "danger-until-to-remote-ops",
    run: () => {
      // dangerUntil 搬家：intel[room].dangerUntil → remoteOps[room].dangerUntil
      // （remote-mining-manager 成为唯一写者）。对应条目存在且无 dangerUntil 时搬运，
      // 否则仅删旧字段——dangerCooldown(2000) << cleanupThreshold(30000)，冷却早已过期。
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
  {
    name: "outcome-channel-field-compression",
    run: () => {
      // OutcomeChannel 字段名压缩：旧字段名 (queue/seen/duplicateRejected/
      // overflowEvicted) 迁移到压缩字段名 (q/s/dr/oe)。幂等五步合同：先写新字段、
      // 验证、删旧字段、盖章、重复执行无副作用。
      // getOutcomeChannel 有惰性迁移作为运行时安全网，但本变换是 schema 层的
      // 确定性保证（无 expansion 事件的恢复场景下惰性初始化可能不被触发）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const ch = kernel.outcomeEvents as Record<string, unknown> | undefined;
      if (!ch) {
        // 确定性初始化：保证 outcomeEvents 存在且字段完整。
        kernel.outcomeEvents = { q: [], s: [], dr: 0, oe: 0 };
        return;
      }
      if (!ch.q && Array.isArray(ch.queue)) ch.q = ch.queue;
      if (!Array.isArray(ch.q)) ch.q = [];
      if (!ch.s && Array.isArray(ch.seen)) ch.s = ch.seen;
      if (!Array.isArray(ch.s)) ch.s = [];
      if (ch.dr === undefined && typeof ch.duplicateRejected === "number") {
        ch.dr = ch.duplicateRejected;
      }
      if (typeof ch.dr !== "number") ch.dr = 0;
      if (ch.oe === undefined && typeof ch.overflowEvicted === "number") {
        ch.oe = ch.overflowEvicted;
      }
      if (typeof ch.oe !== "number") ch.oe = 0;
      delete ch.queue;
      delete ch.seen;
      delete ch.duplicateRejected;
      delete ch.overflowEvicted;
    },
  },
  {
    name: "build-queue-created-at-backfill",
    run: () => {
      // BuildTask 可选 queuedAt（入队 tick）回填为当前 tick——年龄从迁移时刻起算，
      // 避免「缺省=0」被误判为超龄遭清除。幂等：仅当 undefined 时写入。
      const now = Game.time;
      for (const roomName in Memory.rooms) {
        const queue = Memory.rooms[roomName]?.buildQueue;
        if (!Array.isArray(queue)) continue;
        for (const task of queue) {
          if (task && task.queuedAt === undefined) task.queuedAt = now;
        }
      }
    },
  },
  {
    name: "legacy-intel-retirement",
    run: () => {
      // legacy 情报桥退役：RoomMemory.intel（旧内嵌邻房情报）写侧已下线，
      // IntelState 为唯一情报状态；存量数据一次性清理（情报按观察管线重访重建，
      // 无可恢复性损失）。幂等：仅当字段存在时删除。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (room && "intel" in room) delete room.intel;
      }
    },
  },
  {
    name: "strategy-overrides-self-heal",
    run: () => {
      // TuningMemory.strategyOverrides 畸形自愈：非对象 → 删除；条目非
      // StrategyOverrideEntry 结构 → 删除该条目（缺失视为无 override，
      // empire-strategy 回退 CONFIG.posture 默认）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const tuning = kernel.tuning as Record<string, unknown> | undefined;
      if (!tuning || typeof tuning !== "object") return;
      const overrides = tuning.strategyOverrides as Record<string, unknown> | undefined;
      if (overrides === undefined) return;
      if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
        delete tuning.strategyOverrides;
        return;
      }
      for (const key in overrides) {
        const entry = overrides[key] as Record<string, unknown> | undefined;
        if (!entry || typeof entry !== "object") {
          delete overrides[key];
          continue;
        }
        if (typeof entry.value !== "number" || typeof entry.adjustedAt !== "number") {
          delete overrides[key];
        }
      }
    },
  },
  {
    name: "power-farm-single-to-missions",
    run: () => {
      // PB 多任务并行：KernelMemory.powerFarm（单对象）迁移为
      // KernelMemory.powerFarmMissions（数组）。旧对象 → [旧对象]；畸形 → 删除。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const oldFarm = kernel.powerFarm as Record<string, unknown> | undefined;
      if (oldFarm === undefined) {
        delete kernel.powerFarm;
        return;
      }
      if (typeof oldFarm !== "object" || oldFarm === null || Array.isArray(oldFarm)) {
        delete kernel.powerFarm;
        return;
      }
      const phase = oldFarm.phase as string | undefined;
      if (phase !== "strike" && phase !== "collect") {
        delete kernel.powerFarm;
        return;
      }
      kernel.powerFarmMissions = [
        {
          targetRoom: oldFarm.targetRoom as string,
          sponsor: oldFarm.sponsor as string,
          since: oldFarm.since as number,
          spawned: (oldFarm.spawned as number) ?? 0,
          phase: phase as "strike" | "collect",
          collectorSpawnedAt: oldFarm.collectorSpawnedAt as number | undefined,
        },
      ];
      delete kernel.powerFarm;
    },
  },
  {
    name: "remote-op-ledger-self-heal",
    run: () => {
      // RemoteOp.ledger（短字段 d/s/r/i/w）畸形自愈——宁可丢一段观测，也不把
      // NaN/畸形结构喂进净营收计算。有限性检查不能省：typeof NaN === "number"，
      // 只查类型会让 NaN 混进账本。
      const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
      for (const roomName in Memory.rooms) {
        const ops = Memory.rooms[roomName]?.remoteOps;
        if (!ops) continue;
        for (const op of Object.values(ops)) {
          const raw: unknown = op.ledger;
          if (raw === undefined) continue;
          if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            delete op.ledger;
            continue;
          }
          const l = raw as Record<string, unknown>;
          if (!isCount(l.d) || !isCount(l.s) || !isCount(l.r) || !isCount(l.i) || !isCount(l.w)) {
            delete op.ledger;
          }
        }
      }
    },
  },
];
