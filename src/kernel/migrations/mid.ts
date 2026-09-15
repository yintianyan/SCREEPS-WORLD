/** 中期迁移 v16→v30：经济结构（link/terminal/lab/power）与远矿运营。 */
import type { MigrationStep } from "./types";

export const MID_MIGRATIONS: MigrationStep[] = [
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
      if (tuning.baselineVersion !== undefined && typeof tuning.baselineVersion !== "number") {
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
        if (room.distScaleUpSince !== undefined && typeof room.distScaleUpSince !== "number") {
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
              if (
                !pv ||
                typeof pv !== "object" ||
                typeof pv.adjustTick !== "number" ||
                typeof pv.preAdjustValue !== "number" ||
                typeof pv.expectedDirection !== "string" ||
                typeof pv.adjustDirection !== "string" ||
                (pv.expectedDirection !== "improve" && pv.expectedDirection !== "worsen") ||
                (pv.adjustDirection !== "up" && pv.adjustDirection !== "down")
              ) {
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
              if (
                !fp ||
                typeof fp !== "object" ||
                typeof fp.frozenAt !== "number" ||
                typeof fp.frozenUntil !== "number" ||
                typeof fp.rollbackCount !== "number"
              ) {
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
        if (layout.nextGapPlanTick !== undefined && typeof layout.nextGapPlanTick !== "number") {
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
        if (phase.srcStallTicks !== undefined && typeof phase.srcStallTicks !== "number") {
          delete phase.srcStallTicks;
        }
        if (phase.storageEnergyPrev !== undefined && typeof phase.storageEnergyPrev !== "number") {
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
        if (phase.storageDrainAccum !== undefined && typeof phase.storageDrainAccum !== "number") {
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
        if (room.prevThreatCount !== undefined && typeof room.prevThreatCount !== "number") {
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

      if (kernel.warStandDownUntil !== undefined && typeof kernel.warStandDownUntil !== "number") {
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
