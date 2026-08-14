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
          if (t.lastEval !== undefined && typeof t.lastEval === "object" && !Array.isArray(t.lastEval)) {
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
  {
    from: 16,
    to: 17,
    run: () => {
      // v17：P1-F layout 4-stage 分片 — 新增 planStage；回填 0（空闲态），
      // 非数字值清除（layout-planner 视作 0）。
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
      // v18：P1-I tuning 版本戳 — TuningMemory 新增 baselineVersion（可选）。
      // 设计决策：只「建档」不「定版」——故意不写 CONFIG.tuning.baselineVersion，
      // 让 tuning-engine 首次评估检测 undefined ≠ CONFIG → 清空 rooms 覆盖
      // （清零重来）；若直接定版，存量旧覆盖会继续压制新基线，违背 P1-I 目标。
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
      // v19：P1-J demand 纯度收口 — distScaleUpSince/builderPressureState 由
      // domain/spawn/demand.ts 直读写收敛为 spawn-manager 适配层显式输入输出
      // （字段早已登记于 global.d.ts:215/221，但游离在迁移体系外，本迁移纳入
      // schema 管理）。语义不变：v18 前 demand 直写 Memory，v19 后由适配层
      // prev/nextHysteresis 读写，行为逐 tick 一致（集成测试验证）。
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
  {
    from: 19,
    to: 20,
    run: () => {
      // v20：tuning 改进 A — 新增 pendingValidation + frozenParams。
      // 设计决策（同 v18）：只建档 + 畸形自愈，不写字段值；tuning-engine 是两字段唯一写者。
      // 自愈：非对象删除；条目缺关键字段删除（pendingValidation: adjustTick/preAdjustValue/
      // expectedDirection∈{improve,worsen}/adjustDirection∈{up,down}；
      // frozenParams: frozenAt/frozenUntil/rollbackCount）。Step 0 清空 rooms 后为空操作，保留无害。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const tuning = kernel.tuning as Record<string, unknown> | undefined;
      if (!tuning || typeof tuning !== "object") return;
      const rooms = (tuning as Record<string, unknown>).rooms as Record<string, any> | undefined;
      if (!rooms) return;

      for (const roomName in rooms) {
        const room = rooms[roomName];
        if (!room || typeof room !== "object") continue;

        if (room.pendingValidation !== undefined) {
          if (typeof room.pendingValidation !== "object" || room.pendingValidation === null) {
            delete room.pendingValidation;
          } else {
            for (const param in room.pendingValidation) {
              const pv = room.pendingValidation[param];
              if (!pv || typeof pv !== "object" ||
                  typeof pv.adjustTick !== "number" ||
                  typeof pv.preAdjustValue !== "number" ||
                  typeof pv.expectedDirection !== "string" ||
                  typeof pv.adjustDirection !== "string" ||
                  (pv.expectedDirection !== "improve" && pv.expectedDirection !== "worsen") ||
                  (pv.adjustDirection !== "up" && pv.adjustDirection !== "down")) {
                delete room.pendingValidation[param];
              }
            }
            if (Object.keys(room.pendingValidation).length === 0) {
              delete room.pendingValidation;
            }
          }
        }

        if (room.frozenParams !== undefined) {
          if (typeof room.frozenParams !== "object" || room.frozenParams === null) {
            delete room.frozenParams;
          } else {
            for (const param in room.frozenParams) {
              const fp = room.frozenParams[param];
              if (!fp || typeof fp !== "object" ||
                  typeof fp.frozenAt !== "number" ||
                  typeof fp.frozenUntil !== "number" ||
                  typeof fp.rollbackCount !== "number") {
                delete room.frozenParams[param];
              }
            }
            if (Object.keys(room.frozenParams).length === 0) {
              delete room.frozenParams;
            }
          }
        }
      }
    },
  },
  {
    from: 20,
    to: 21,
    run: () => {
      // v21：目标清单布局闭环 — 新增 KernelMemory.layoutGaps（缺口观测）与
      // LayoutMemory.nextGapPlanTick（缺口慢速重试节流）。
      // 设计决策（同 v18/v20）：只建档 + 畸形自愈，不写字段值；layout-planner 是两字段唯一写者。
      // 自愈：非对象删除、空对象回收；nextGapPlanTick 非数字删除（缺失视为 0：允许立即 gap-force）。
      // 房间侧自愈不依赖 kernel 是否存在 — 先跑（勿被下方 kernel 守卫拦截）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        const layout = room.layout as Record<string, unknown> | undefined;
        if (!layout) continue;
        if (
          layout.nextGapPlanTick !== undefined &&
          typeof layout.nextGapPlanTick !== "number"
        ) {
          delete layout.nextGapPlanTick;
        }
      }
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const layoutGaps = kernel.layoutGaps as Record<string, unknown> | undefined;
      if (layoutGaps === undefined) return;
      if (typeof layoutGaps !== "object" || layoutGaps === null || Array.isArray(layoutGaps)) {
        delete kernel.layoutGaps;
        return;
      }
      for (const roomName in layoutGaps) {
        const gaps = layoutGaps[roomName] as Record<string, unknown> | undefined;
        if (typeof gaps !== "object" || gaps === null || Array.isArray(gaps)) {
          delete layoutGaps[roomName];
          continue;
        }
        for (const type in gaps) {
          if (typeof gaps[type] !== "number") delete gaps[type];
        }
        if (Object.keys(gaps).length === 0) delete layoutGaps[roomName];
      }
      if (Object.keys(layoutGaps).length === 0) delete kernel.layoutGaps;
    },
  },
  {
    from: 21,
    to: 22,
    run: () => {
      // v22：P0-1 srcRatio 强制 crisis 通道 — 新增 phase.srcStallTicks 与
      // phase.storageEnergyPrev（可选）。设计决策（同 v20/v21）：只建档 + 畸形自愈；
      // room-state 是两字段唯一写者，缺失视为 0 / 当前 storage 能量（current 兜底，drainRate=0）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        const phase = room.phase as Record<string, unknown> | undefined;
        if (!phase || typeof phase !== "object") continue;
        if (
          phase.srcStallTicks !== undefined &&
          typeof phase.srcStallTicks !== "number"
        ) {
          delete phase.srcStallTicks;
        }
        if (
          phase.storageEnergyPrev !== undefined &&
          typeof phase.storageEnergyPrev !== "number"
        ) {
          delete phase.storageEnergyPrev;
        }
      }
    },
  },
  {
    from: 22,
    to: 23,
    run: () => {
      // v23：P0-3 spawn churn 熔断 — 新增 RoomMemory.churnFreezeUntil（可选）。
      // 设计决策（同 v20）：只建档 + 畸形自愈；spawn-manager 是唯一写者
      // （cleanQueue 触发 churn 计数 → 熔断写入），demand 读取跳过。缺失视为无熔断。
      // 自愈：非对象删除；[role] 非数字删除（视为到期）；空对象回收防膨胀。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        const freeze = room.churnFreezeUntil as Record<string, unknown> | undefined;
        if (freeze === undefined) continue;
        if (typeof freeze !== "object" || freeze === null || Array.isArray(freeze)) {
          delete room.churnFreezeUntil;
          continue;
        }
        for (const role in freeze) {
          if (typeof freeze[role] !== "number") {
            delete freeze[role];
          }
        }
        if (Object.keys(freeze).length === 0) {
          delete room.churnFreezeUntil;
        }
      }
    },
  },
  {
    from: 23,
    to: 24,
    run: () => {
      // v24：P0-1 srcRatio 通道修正 — 新增 phase.storageDrainAccum：累积净流失量
      // 替代单 tick drainRate 判定（实测稀疏大脉冲下单 tick 失效）。
      // room-state 是唯一写者，缺失视为 0（phase.ts ?? 0 兜底）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        const phase = room.phase as Record<string, unknown> | undefined;
        if (!phase || typeof phase !== "object") continue;
        if (
          phase.storageDrainAccum !== undefined &&
          typeof phase.storageDrainAccum !== "number"
        ) {
          delete phase.storageDrainAccum;
        }
      }
    },
  },
  {
    from: 24,
    to: 25,
    run: () => {
      // v25：P1-3 defense 误触发修复 — 新增 RoomMemory.prevThreatCount：威胁新增
      // （count 增加）时才刷新 lastHostileAt，防旧威胁永久维持 defense 姿态。
      // room-state 是唯一写者，缺失视为 0（首威胁即新增）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        if (
          room.prevThreatCount !== undefined &&
          typeof room.prevThreatCount !== "number"
        ) {
          delete room.prevThreatCount;
        }
      }
    },
  },
  {
    from: 25,
    to: 26,
    run: () => {
      // v26：R3 战时闭环 — 新增 KernelMemory.warPlan（war-planner 写入）。
      // 畸形自愈：非对象 / targetRoom 或 sponsor 非字符串 / squadSize 非数字 → 删除（下 tick 重建）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const wp = kernel.warPlan as Record<string, unknown> | undefined;
      if (wp === undefined) return;
      if (
        typeof wp !== "object" ||
        typeof (wp as { targetRoom?: unknown }).targetRoom !== "string" ||
        typeof (wp as { sponsor?: unknown }).sponsor !== "string" ||
        typeof (wp as { squadSize?: unknown }).squadSize !== "number"
      ) {
        delete kernel.warPlan;
      }
    },
  },
  {
    from: 26,
    to: 27,
    run: () => {
      // v27：R4 战争自治升级 — warPlan 扩展 phase/spawned；新增 warBlacklist、
      // strategy.warPressureTicks。设计决策（同 v20/v21）：只建档 + 畸形自愈；
      // 唯一写者：warPlan/warBlacklist = war-planner，warPressureTicks = empire-strategy。
      // 缺失语义：phase 缺失视为 build（保守：满编才推进）、spawned 缺失视为 0、
      // warPressureTicks 缺失视为 0（压力未持续）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const wp = kernel.warPlan as Record<string, unknown> | undefined;
      if (wp !== undefined && typeof wp === "object") {
        if (wp.phase !== undefined && wp.phase !== "build" && wp.phase !== "advance") {
          delete wp.phase;
        }
        if (wp.spawned !== undefined && typeof wp.spawned !== "number") {
          delete wp.spawned;
        }
      }

      const bl = kernel.warBlacklist as Record<string, unknown> | undefined;
      if (bl !== undefined) {
        if (typeof bl !== "object" || bl === null || Array.isArray(bl)) {
          delete kernel.warBlacklist;
        } else {
          for (const roomName in bl) {
            if (typeof bl[roomName] !== "number") delete bl[roomName];
          }
          if (Object.keys(bl).length === 0) delete kernel.warBlacklist;
        }
      }

      if (
        kernel.warStandDownUntil !== undefined &&
        typeof kernel.warStandDownUntil !== "number"
      ) {
        delete kernel.warStandDownUntil;
      }

      const strategy = kernel.strategy as Record<string, unknown> | undefined;
      if (
        strategy !== undefined &&
        typeof strategy === "object" &&
        strategy.warPressureTicks !== undefined &&
        typeof strategy.warPressureTicks !== "number"
      ) {
        delete strategy.warPressureTicks;
      }
    },
  },
  {
    from: 27,
    to: 28,
    run: () => {
      // v28：R6a 帝国议程 — 新增 KernelMemory.agenda（empire-strategy 每 tick
      // 重建，缺失视为 develop 兜底）。建档 + 畸形自愈：非对象 / initiative
      // 不在枚举 / since 非数字 → 删除整个字段（下 tick 重建）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const agenda = kernel.agenda as Record<string, unknown> | undefined;
      if (agenda === undefined) return;
      const validInitiatives = ["recovery", "defense-readiness", "rcl-push", "develop"];
      if (
        typeof agenda !== "object" ||
        agenda === null ||
        !validInitiatives.includes(agenda.initiative as string) ||
        typeof agenda.since !== "number"
      ) {
        delete kernel.agenda;
      }
    },
  },
  {
    from: 28,
    to: 29,
    run: () => {
      // v29：R6b 主动情报 — 新增 KernelMemory.prospect / prospectCooldown
      // （prospect-manager 唯一写者）。建档 + 畸形自愈：prospect 非对象 /
      // target/sponsor 非字符串 / startedAt/spawned 非数字 → 删除（管理器重建）；
      // prospectCooldown 非对象或条目非数字 → 删除该条目/字段。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const prospect = kernel.prospect as Record<string, unknown> | undefined;
      if (prospect !== undefined) {
        if (
          typeof prospect !== "object" ||
          prospect === null ||
          typeof (prospect as { target?: unknown }).target !== "string" ||
          typeof (prospect as { sponsor?: unknown }).sponsor !== "string" ||
          typeof (prospect as { startedAt?: unknown }).startedAt !== "number" ||
          typeof (prospect as { spawned?: unknown }).spawned !== "number"
        ) {
          delete kernel.prospect;
        }
      }

      const cooldown = kernel.prospectCooldown as Record<string, unknown> | undefined;
      if (cooldown !== undefined) {
        if (typeof cooldown !== "object" || cooldown === null || Array.isArray(cooldown)) {
          delete kernel.prospectCooldown;
        } else {
          for (const roomName in cooldown) {
            if (typeof cooldown[roomName] !== "number") delete cooldown[roomName];
          }
          if (Object.keys(cooldown).length === 0) delete kernel.prospectCooldown;
        }
      }
    },
  },
  {
    from: 29,
    to: 30,
    run: () => {
      // v30：R7a 容量感知 — 新增 KernelMemory.capacity（empire-strategy 每 tick
      // 重建）、agenda.progressBase（rcl-push 归因基线）。建档 + 畸形自愈：
      // capacity 非对象 / tier 不在枚举 / since·upgradeTicks 非数字 → 删除；
      // progressBase 非数字 → 删除（缺失视为无基线，窗口归因跳过）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const capacity = kernel.capacity as Record<string, unknown> | undefined;
      if (capacity !== undefined) {
        const validTiers = ["abundant", "comfortable", "tight", "constrained"];
        if (
          typeof capacity !== "object" ||
          capacity === null ||
          !validTiers.includes(capacity.tier as string) ||
          typeof capacity.since !== "number" ||
          typeof capacity.upgradeTicks !== "number"
        ) {
          delete kernel.capacity;
        }
      }

      const agenda = kernel.agenda as Record<string, unknown> | undefined;
      if (agenda !== undefined && typeof agenda === "object") {
        if (agenda.progressBase !== undefined && typeof agenda.progressBase !== "number") {
          delete agenda.progressBase;
        }
      }
    },
  },
  {
    from: 30,
    to: 31,
    run: () => {
      // v31：R7b 扩张节奏自适应 — 新增 KernelMemory.expansionRhythm /
      // expansionPausedUntil（expansion-manager 唯一写者）。建档 + 畸形自愈：
      // expansionRhythm 非对象 → 删除；ring 非数组或条目非数字 → 清空 ring；
      // blacklistMultiplier/minSources 非数字或越界 → 回默认；pausedUntil 非数字 → 删除。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const rhythm = kernel.expansionRhythm as Record<string, unknown> | undefined;
      if (rhythm !== undefined) {
        if (typeof rhythm !== "object" || rhythm === null || Array.isArray(rhythm)) {
          delete kernel.expansionRhythm;
        } else {
          if (!Array.isArray(rhythm.ring)) {
            rhythm.ring = [];
          } else {
            rhythm.ring = (rhythm.ring as unknown[]).filter(
              (v): v is number => typeof v === "number" && v >= 0 && v <= 4,
            );
          }
          if (
            typeof rhythm.blacklistMultiplier !== "number" ||
            rhythm.blacklistMultiplier < 0.5 ||
            rhythm.blacklistMultiplier > 1.5
          ) {
            rhythm.blacklistMultiplier = 1;
          }
          if (
            typeof rhythm.minSources !== "number" ||
            rhythm.minSources < 1 ||
            rhythm.minSources > 2
          ) {
            rhythm.minSources = 1;
          }
        }
      }

      if (
        kernel.expansionPausedUntil !== undefined &&
        typeof kernel.expansionPausedUntil !== "number"
      ) {
        delete kernel.expansionPausedUntil;
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

/** 维护 Memory：清理死亡 creep、初始化默认值、失守房宽限清理（迁移由 runMigrations 独立执行，见 K-5）。 */
export function maintainMemory(): void {
  Memory.creeps ??= {};
  Memory.rooms ??= {};
  Memory.kernel ??= {};

  // 每 tick 清理死亡 creep memory（小帝国安全且廉价）；清理前记录死亡事件
  // （战斗黑匣子 M9 — 这是死亡的唯一系统性检测点）。
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      recordCreepDeath(name);
      delete Memory.creeps[name];
    }
  }

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

  // 失守房清理：条目房不在拥有集合即为失守（自有房恒有视野）。
  // 宽限期防 claim 边界抖动误删布局与队列数据；到期后连同 tuning 覆盖
  // 一并清除，避免失守房数据永久滞留（慢性泄漏）。
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

/** 按升序执行迁移（每个幂等）。ready() 未就绪时停在断点、保留版本，下 tick 续跑。
 * 版本号只随实际执行的迁移递增，不做无条件盖章：若未来出现断号，版本停在
 * 缺口处暴露问题，而不是被盖章静默掩盖、永久丢失缺口步骤。 */
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

/** 记录跳过原因，用于遥测和诊断。
 * 单 tick 内累加到 global 缓冲区，tick 末尾由 flushSkips 低频刷入 Memory，
 * 避免 CPU 压力下频繁 Memory 写入。 */
export function recordSkip(reason: string): void {
  const g = globalCache();
  if (!g.skipBuffer) g.skipBuffer = {};
  g.skipBuffer[reason] = (g.skipBuffer[reason] ?? 0) + 1;

  if (g.telemetry && g.telemetry.tick === Game.time) {
    g.telemetry.skipped++;
  }
}

/** 将 global 的 skipBuffer 刷入 Memory 并低频清理。由 Kernel 在 tick 末尾调用。 */
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
