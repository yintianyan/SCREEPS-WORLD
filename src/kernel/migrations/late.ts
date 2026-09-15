/** 近期迁移 v31→v46：战时/扩张/调优/远矿账本等较新 schema 字段。 */
import type { MigrationStep } from "./types";

export const LATE_MIGRATIONS: MigrationStep[] = [
  {
    from: 31,
    to: 32,
    run: () => {
      // v32：R7c 无害侦察观测 — 新增 RoomMemory.lastObserverAt /
      // observerSightings（room-state 唯一写者）。建档 + 畸形自愈：
      // 非数字 → 删除（缺失视为无目击）。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (!room) continue;
        if (room.lastObserverAt !== undefined && typeof room.lastObserverAt !== "number") {
          delete room.lastObserverAt;
        }
        if (room.observerSightings !== undefined && typeof room.observerSightings !== "number") {
          delete room.observerSightings;
        }
      }
    },
  },
  {
    from: 32,
    to: 33,
    run: () => {
      // v33：完整情报 — RoomIntel 新增 enemySpawns / wallCount / sealedExits
      // （room-observer 唯一写者）。建档 + 畸形自愈：
      // 数字字段非数字 → 删除（缺失视为无观测）；sealedExits 非数组或
      // 含非数字条目 → 删除（缺失视为未知封口状态，不触发封死废弃）。
      for (const roomName in Memory.rooms) {
        const intel = Memory.rooms[roomName]?.intel as
          Record<string, Record<string, unknown>> | undefined;
        if (!intel) continue;
        for (const target in intel) {
          const info = intel[target];
          if (!info || typeof info !== "object") continue;
          if (info.enemySpawns !== undefined && typeof info.enemySpawns !== "number") {
            delete info.enemySpawns;
          }
          if (info.wallCount !== undefined && typeof info.wallCount !== "number") {
            delete info.wallCount;
          }
          if (info.sealedExits !== undefined) {
            const valid =
              Array.isArray(info.sealedExits) &&
              (info.sealedExits as unknown[]).every(d => typeof d === "number");
            if (!valid) delete info.sealedExits;
          }
        }
      }
    },
  },
  {
    from: 33,
    to: 34,
    run: () => {
      // v34：Power Creeps — 新增 KernelMemory.powerCreeps.homeAssignments
      // （power-creep-manager 唯一写者）。建档 + 畸形自愈：powerCreeps
      // 非对象 → 删除；homeAssignments 非对象 → 重置为空（缺失视为无驻留，
      // 系统下轮重新分配）；条目值非字符串 → 删除该条目。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const powerCreeps = kernel.powerCreeps as Record<string, unknown> | undefined;
      if (powerCreeps !== undefined) {
        if (typeof powerCreeps !== "object" || powerCreeps === null || Array.isArray(powerCreeps)) {
          delete kernel.powerCreeps;
        } else {
          if (
            powerCreeps.homeAssignments === undefined ||
            typeof powerCreeps.homeAssignments !== "object" ||
            powerCreeps.homeAssignments === null ||
            Array.isArray(powerCreeps.homeAssignments)
          ) {
            powerCreeps.homeAssignments = {};
          } else {
            const assignments = powerCreeps.homeAssignments as Record<string, unknown>;
            for (const pcName in assignments) {
              if (typeof assignments[pcName] !== "string") {
                delete assignments[pcName];
              }
            }
          }
        }
      }
    },
  },
  {
    from: 34,
    to: 35,
    run: () => {
      // v35：nuker 威慑链 — 新增 KernelMemory.nukesInFlight（war-planner 唯一写者）：
      // 目标房名 → 落地到期 tick 数组。引擎无全局核弹查询 API（FIND_NUKES 需
      // 目标房视野），自发核弹只能自查，台账即完整真相。建档 + 畸形自愈：
      // 非对象 → 删除；条目非数字数组 → 删除该条目（缺失视为无在途，安全侧）。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const ledger = kernel.nukesInFlight as Record<string, unknown> | undefined;
      if (ledger === undefined) return;
      if (typeof ledger !== "object" || ledger === null || Array.isArray(ledger)) {
        delete kernel.nukesInFlight;
        return;
      }
      for (const target in ledger) {
        const entries = ledger[target];
        if (!Array.isArray(entries) || !entries.every(v => typeof v === "number")) {
          delete ledger[target];
        }
      }
    },
  },
  {
    from: 35,
    to: 36,
    run: () => {
      // v36：PB 野采链 — 新增 KernelMemory.powerFarm（power-farm-manager 唯一
      // 写者，审计缺口 2）。建档 + 畸形自愈：非对象 → 删除；phase 非法 → 删除
      // （缺失视为无任务，安全侧）；其余字段缺失由管理器使用时兜底。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const mission = kernel.powerFarm as Record<string, unknown> | undefined;
      if (mission === undefined) return;
      if (typeof mission !== "object" || mission === null || Array.isArray(mission)) {
        delete kernel.powerFarm;
        return;
      }
      if (mission.phase !== "strike" && mission.phase !== "collect") {
        delete kernel.powerFarm;
      }
    },
  },
  {
    from: 36,
    to: 37,
    run: () => {
      // v37：P3 能量核算 — 新增 RoomMemory.rooms[r].economy 瘦快照（economy 系统
      // 唯一写者）。字段全部可选、惰性初始化，无存量数据需变换 —— 幂等 no-op，
      // 仅升版本登记结构变更（STATE_OWNERSHIP §4 迁移三件套之迁移步骤）。
    },
  },
  {
    from: 37,
    to: 38,
    run: () => {
      // v38：A3.0 多房帝国执行 — 新增 KernelMemory.agendas（agenda-manager 唯一
      // 写者，跨房调拨 Operation 生命周期）+ KernelMemory.reservations（资源预留
      // 表）。字段全部可选、惰性初始化，无存量数据需变换 —— 幂等 no-op，
      // 仅升版本登记结构变更（STATE_OWNERSHIP §4 迁移三件套之迁移步骤）。
    },
  },
  {
    from: 38,
    to: 39,
    run: () => {
      // v39：A4.2 多资源帝国经济 — 扩展 KernelMemory.empireEconomy 瘦快照新增
      // 4 个字段（mh/md/bn/wmh：多资源健康度/矿物缺口/瓶颈资源/最差矿物健康度）。
      // 字段全部可选、惰性初始化（empire-economy 系统 100t 后首次写入即填充）——
      // 幂等 no-op，仅升版本登记结构变更（STATE_OWNERSHIP §4 迁移三件套之迁移步骤）。
      // 存量快照无新字段 → 读取方用 ?? 默认值兜底，不影响正确性。
    },
  },
  {
    from: 39,
    to: 40,
    run: () => {
      // v40：Phase 6 UOEM — 新增 KernelMemory.outcomeEvents（OutcomeChannel Memory
      // 持久化，cap=16，压缩字段名，≤3.2KB）+ KernelMemory.expansion 新增 operationId/openedAt/
      // forcedAdvance 三个可选字段。存量 expansion 无新字段 → 下次 consume 时铸造
      // operationId，当前用 ?? 默认值兜底。outcomeEvents 惰性初始化（getOutcomeChannel
      // 首次调用时创建空结构）。幂等 no-op，仅升版本登记结构变更。
    },
  },
  {
    from: 40,
    to: 41,
    run: () => {
      // v41：OutcomeChannel 字段名压缩迁移 — 将 outcomeEvents 中的旧字段名
      // (queue/seen/duplicateRejected/overflowEvicted) 正式迁移到压缩字段名
      // (q/s/dr/oe)。
      //
      // MEMORY_ARCHITECTURE §3 幂等迁移五步合同：
      //   1. 先写新字段（如果旧字段存在且新字段不存在）
      //   2. 验证新字段有效（类型检查）
      //   3. 验证成功后删除旧字段
      //   4. 所有步骤成功才升版本（由 migrateMemory 框架保证）
      //   5. 幂等：重复执行无副作用（先检查目标态再动手）
      //
      // 注意：getOutcomeChannel 有惰性迁移作为运行时安全网，
      // 但正式 migration 是 schema 层的确定性保证，不可省略。
      //
      // 不破坏 operationId/openedAt/closedAt/forcedAdvance 等已有字段。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;

      const ch = kernel.outcomeEvents as Record<string, unknown> | undefined;
      if (!ch) {
        // 确定性初始化：outcomeEvents 惰性初始化在恢复/损坏 Memory 场景下
        // 可能不被触发（无 expansion 事件 → getOutcomeChannel 不被调用）。
        // v41 迁移确定性保证 outcomeEvents 存在且字段完整。
        kernel.outcomeEvents = { q: [], s: [], dr: 0, oe: 0 };
        return;
      }

      // 步骤 1+2：先写新字段并验证（损坏的可选字段归一化为安全默认值）。
      if (!ch.q && Array.isArray(ch.queue)) {
        ch.q = ch.queue;
      }
      if (!Array.isArray(ch.q)) ch.q = [];
      if (!ch.s && Array.isArray(ch.seen)) {
        ch.s = ch.seen;
      }
      if (!Array.isArray(ch.s)) ch.s = [];
      if (ch.dr === undefined && typeof ch.duplicateRejected === "number") {
        ch.dr = ch.duplicateRejected;
      }
      if (typeof ch.dr !== "number") ch.dr = 0;
      if (ch.oe === undefined && typeof ch.overflowEvicted === "number") {
        ch.oe = ch.overflowEvicted;
      }
      if (typeof ch.oe !== "number") ch.oe = 0;

      // 步骤 3：验证新字段有效后删除旧字段
      if (ch.q !== undefined && ch.queue !== undefined) {
        delete ch.queue;
      }
      if (ch.s !== undefined && ch.seen !== undefined) {
        delete ch.seen;
      }
      if (ch.dr !== undefined && ch.duplicateRejected !== undefined) {
        delete ch.duplicateRejected;
      }
      if (ch.oe !== undefined && ch.overflowEvicted !== undefined) {
        delete ch.overflowEvicted;
      }
    },
  },
  {
    from: 41,
    to: 42,
    run: () => {
      // v42：R2 队列治理 — BuildTask 新增可选 queuedAt（入队 tick）。存量任务
      // 无该字段 → 回填为当前 tick（年龄从迁移时刻起算，避免「缺省=0」被误判
      // 为超龄遭清除）。幂等：仅当 undefined 时写入；重复执行无副作用。
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
    from: 42,
    to: 43,
    run: () => {
      // v43：legacy 情报桥退役 — RoomMemory.intel（旧 RoomMemory 内嵌邻房情报）
      // 写侧已下线，IntelState 为唯一情报状态；存量数据一次性清理（情报按
      // 观察管线重访重建，无可恢复性损失）。幂等：仅当字段存在时删除。
      for (const roomName in Memory.rooms) {
        const room = Memory.rooms[roomName] as Record<string, unknown> | undefined;
        if (room && "intel" in room) delete room.intel;
      }
    },
  },
  {
    from: 43,
    to: 44,
    run: () => {
      // v44：自进化系统 L1 — 新增 TuningMemory.strategyOverrides
      // （strategy-reviewer 唯一写者，empire-strategy 消费）。建档 + 畸形自愈：
      // 非对象 → 删除；条目非 StrategyOverrideEntry 结构 → 删除该条目
      // （缺失视为无 override，empire-strategy 回退 CONFIG.posture 默认）。
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
    from: 44,
    to: 45,
    run: () => {
      // v45：自进化系统 L2 — 新增 TuningMemory.intakePending
      // （tuning-intake-system 唯一写者，strategy-reviewer 复核后清空）。
      // 建档 + 畸形自愈：非对象 → 删除；条目非 IntakePendingEntry 结构 → 删除该条目。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const tuning = kernel.tuning as Record<string, unknown> | undefined;
      if (!tuning || typeof tuning !== "object") return;
      const intake = tuning.intakePending as Record<string, unknown> | undefined;
      if (intake === undefined) return;
      if (typeof intake !== "object" || intake === null || Array.isArray(intake)) {
        delete tuning.intakePending;
        return;
      }
      for (const key in intake) {
        const entry = intake[key] as Record<string, unknown> | undefined;
        if (!entry || typeof entry !== "object") {
          delete intake[key];
          continue;
        }
        if (
          typeof entry.value !== "number" ||
          typeof entry.originalValue !== "number" ||
          typeof entry.receivedAt !== "number"
        ) {
          delete intake[key];
        }
      }
    },
  },
  {
    from: 45,
    to: 46,
    run: () => {
      // v46：PB 多任务并行 — 将 KernelMemory.powerFarm（单对象）迁移为
      // KernelMemory.powerFarmMissions（数组）。旧对象 → [旧对象]。
      const kernel = Memory.kernel as Record<string, unknown> | undefined;
      if (!kernel) return;
      const oldFarm = kernel.powerFarm as Record<string, unknown> | undefined;
      if (oldFarm === undefined) {
        // 无旧任务 → 无需迁移。
        delete kernel.powerFarm;
        return;
      }
      if (typeof oldFarm !== "object" || oldFarm === null || Array.isArray(oldFarm)) {
        // 畸形 → 删除。
        delete kernel.powerFarm;
        return;
      }
      // 将旧对象包装为数组元素。
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
    from: 46,
    to: 47,
    run: () => {
      // v47：远矿 op 实测账本 RemoteOp.ledger（短字段 d/s/r/i/w）。可选、惰性写入，
      // 实际值由 remote-mining-manager 每 managerInterval 回写，无需回填。
      // 此处仅畸形自愈 —— 宁可丢一段观测，也不把 NaN/畸形结构喂进净营收计算。
      // 有限性检查不能省：typeof NaN === "number"，只查类型会让 NaN 混进账本。
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
