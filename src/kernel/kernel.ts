import type {
  Budget,
  CreepRole,
  CpuTier,
  Priority,
  RoomSnapshot,
  System,
  TickContext,
} from "./contracts";
import { recordSkip, flushSkips, maintainMemory, runMigrations } from "./memory";
import { systemPhase } from "./phase";
import { requestSegments, flushSegments } from "./segment-store";
import { measuredRun, safeRun, safeRunBuild } from "./safe-run";
import { createBudget } from "./scheduler";
import { evaluateExpectations, P3_BYPASS_WINDOW_TICKS, type P3SystemRef } from "./expectations";
import { EventKind, recordEvent } from "./event-log";
import { emitSummary, initTelemetry } from "./telemetry";
import { Registry } from "./registry";
import { buildRoomSnapshot } from "../systems/room-snapshot";
// R9 登记：kernel 直接 import 业务模块 pathfinding 的清理函数，形式上违反 §2.1「内核不感知业务」。
// 权衡接受现状：pruneDeadCreepCache 本质是 global 状态卫生（清理死 creep 缓存残留），非经济策略/角色行为；
//   100 tick 低频触发，无每 tick 耦合。为 1 个钩子引入 registry 维护钩子机制（接口+注册+遍历）属过度工程。
// 演化条件：当出现 3+ 个周期性维护钩子时，提取为 registry 维护钩子机制（kernel 只遍历注册表）。
import { pruneDeadCreepCache } from "../creeps/movement/pathfinding";
import { globalCache, type SquadIndexEntry } from "./global-cache";
import { CONFIG } from "../config";
import { classifyThreats } from "../domain/defense/threat";

/** 具体 TickContext，包含用于内核设置的内部变更方法。 */
class Context implements TickContext {
  readonly tick: number;
  readonly budget: Budget;
  private readonly _snapshots = new Map<string, RoomSnapshot>();
  private _globalSiteCount = 0;

  constructor(budget: Budget) {
    this.tick = Game.time;
    this.budget = budget;
  }

  get globalSiteCount(): number {
    return this._globalSiteCount;
  }

  getSnapshot(roomName: string): RoomSnapshot | undefined {
    return this._snapshots.get(roomName);
  }

  snapshots(): Iterable<RoomSnapshot> {
    return this._snapshots.values();
  }

  /** @internal */
  _addSnapshot(snapshot: RoomSnapshot): void {
    this._snapshots.set(snapshot.roomName, snapshot);
    this._globalSiteCount += snapshot.myConstructionSites.length;
  }
}

/** 同优先级角色内的执行顺序（约束 X-19）：harvester 在 hauler 前，先填 container 再取，避免 hauler 空跑。 */
const ROLE_EXECUTION_ORDER: Readonly<Record<string, number>> = {
  worker: 0,
  harvester: 1,
  hauler: 2,
  upgrader: 3,
  builder: 4,
};

/**
 * Idle creep 降频执行的 tick 间隔（cadence）——按 CPU tier 自适应。
 * idle creep 每 N tick 检查一次是否有新任务，跳过的 tick 省 role-runner 管线开销。
 * tier 越紧张 N 越大（省更多 CPU），但响应延迟同步增大：
 *   - healthy: 5 tick（~0.2s 游戏时间，响应灵敏）
 *   - guarded: 8 tick（bucket 在恢复中，适度节流）
 *   - conserve: 12 tick（CPU 紧张，最大化节流）
 *   - recovery: 不跳过（P0 恢复期间每 tick 都需检测 threats/assignment）
 */
function idleCadenceTicks(tier: CpuTier): number {
  switch (tier) {
    case "healthy": return 5;
    case "guarded": return 8;
    case "conserve": return 12;
    default: return 1; // recovery — 不跳过
  }
}

/** 轻量字符串哈希 — 用 creep 名做相位偏移，避免所有 idle creep 同 tick 扎堆检查。 */
function hashCreepName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export class Kernel {
  private readonly roleMap: Map<string, CreepRole>;
  private readonly sortedSystems: readonly System[];
  private readonly postSystems: readonly System[];

  constructor(private readonly registry: Registry) {
    // 缓存 roleMap 和 sortedSystems — Registry 内容在 tick 间不变，避免每 tick 重建和排序。
    this.roleMap = new Map(registry.getRoles().map(r => [r.name, r] as const));
    // 按执行阶段拆分：main 在角色之前，post 在所有角色之后
    // （post 系统消费角色执行期产出的 per-tick 数据，如移动意图账本）。
    const all = registry.getSystems();
    this.sortedSystems = all.filter(s => (s.phase ?? "main") === "main");
    this.postSystems = all.filter(s => s.phase === "post");
  }

  run(): void {
    // 预算：根据 bucket 带滞回地确定 CPU 档位。
    const budget = createBudget();

    // Segment 声明必须在 maintainMemory 之前：迁移（如 v4）会调用 readLayoutSegment，
    // 而 segmentUnavailable 守卫依赖 requestSegments 写入的 requestedAt 判断
    // 「reset 首 tick segment 未加载」。若迁移先执行，守卫失效，空结构可能被
    // 缓存并在 flush 时整体覆盖 segment 历史数据。
    safeRun("segments-request", () => requestSegments(), true);

    // Memory — 迁移与日常维护拆分为两个错误边界（K-5）：迁移 throw 不连坐
    // 死 creep 清理/房间兜底（防 Memory.creeps 慢性泄漏）。关键步骤：永不冷却。
    safeRun("memory-migrate", () => runMigrations(), true);
    safeRun("memory", () => maintainMemory(), true);

    // P2-L：每 100 tick 清理 __creepPathCache 中死 creep 残留 — global 状态无析构，
    // 残留条目累积内存；低频触发（非每 tick）— 清理是兜底卫生，不值得常态 CPU。
    if (Game.time % 100 === 0) {
      safeRun("prune-path-cache", () => pruneDeadCreepCache());
    }

    initTelemetry(Game.time);

    const ctx = new Context(budget);

    // 房间快照（P0 — 必须在任何读取快照的系统之前运行）。
    this.buildSnapshots(ctx);

    // room-state (P0) 在 spawn-manager (P0) 之前注册，先计算每房 ColonyState。
    this.runSystems(ctx);

    this.runCreeps(ctx);

    // 后置系统 — 消费角色执行期产出的 per-tick 数据（如 traffic-manager
    // 集中解算移动意图并统一签发 move）。
    this.runPostSystems(ctx);

    emitSummary(budget);

    safeRun("expectations", () => this.runExpectations(ctx));
    safeRun("flush-skips", () => flushSkips(), true);

    safeRun("segments-flush", () => flushSegments(), true);
  }

  private buildSnapshots(ctx: Context): void {
    // 预构建全局 source 占用映射，避免每房独立遍历 Game.creeps。
    // 仅统计实际采矿角色（harvester/worker）— 其他角色的 sourceId 仅用于 acquire 寻路，不占采矿位。
    const globalSourceOccupancy = new Map<string, number>();
    // 同时汇总每房 creep 身上携带的能量（按 memory.home 归属），
    // 供 room-state 的 reserve 计入在途能量，避免物流搬运造成危机信号抖动（P1-5 ①）。
    const globalCreepEnergy = new Map<string, number>();
    // P1-3：预构建拥有维修 creep（builder/worker）的房间集合，
    // 供 tower-defense 消费，避免塔防系统独立全量扫描 Game.creeps。
    const globalRepairRooms = new Set<string>();
    // 预构建拥有存活 distributor 的房间集合，供 hauler 的 fillStorage 消费：
    // 泵断供时 hauler 不得继续把能量锁进 storage（角色层禁止全局扫描，由 kernel
    // 复用本遍历构建）。孵化中的也计入 — 泵即将上岗，防兜底抖动。
    const globalDistributorRooms = new Set<string>();
    // 拥有存活 hauler 的房间集合：source container 的「物流源」身份以此为前提 —
    // 拓荒爬坡期无 hauler，container 无物流消费者，builder/upgrader 应可直取
    // （withdraw.ts 的 isLogisticsContainer 消费）。
    const globalHaulerRooms = new Set<string>();
    // P0-1：预构建每房「待计入」harvester/worker 数量。
    // 包括已存活但尚未分配 sourceId 的 + 正在孵化中的，避免替换期间的假 bootstrap。
    const globalPendingHarvesters = new Map<string, number>();
    // 战斗黑匣子（M9）：记录每个 creep 的当前位置，供下 tick 死亡事件取
    // 生前最后位置（maintainMemory 先于本函数运行，死者读到的是旧 Map）。
    const creepLastSeen = new Map<string, { r: string; x: number; y: number }>();
    // P0-1：全局编队索引 — 在已有的 Game.creeps 遍历中顺便按编队维度归组，
    // 供 war-planner / power-farm-manager / prospect-manager / expansion-manager
    // 复用，消除各系统独立全量遍历的 O(4N) → O(N)。
    // 只收录有 remoteTarget 或 mission 标记的 creep（编队判定域）— 纯本地角色
    // （harvester/hauler/builder/upgrader/distributor 无 remoteTarget）不进索引，
    // 减少内存占用。
    const squadIndex: SquadIndexEntry[] = [];
    for (const creep of Object.values(Game.creeps)) {
      creepLastSeen.set(creep.name, { r: creep.room.name, x: creep.pos.x, y: creep.pos.y });
      const home = creep.memory.home;
      if (home) {
        const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (carried > 0) {
          globalCreepEnergy.set(home, (globalCreepEnergy.get(home) ?? 0) + carried);
        }
      }
      const role = creep.memory.role;
      if (role === "builder" || role === "worker") {
        const repairHome = home ?? creep.room.name;
        if (repairHome) globalRepairRooms.add(repairHome);
      }
      if (role === "distributor") {
        const pumpHome = home ?? creep.room.name;
        if (pumpHome) globalDistributorRooms.add(pumpHome);
      }
      if (role === "hauler") {
        const haulHome = home ?? creep.room.name;
        if (haulHome) globalHaulerRooms.add(haulHome);
      }
      // P0-1：编队索引收录 — 有 remoteTarget 或 mission 标记的 creep 才入索引。
      if (creep.memory.remoteTarget || creep.memory.mission) {
        squadIndex.push({
          name: creep.name,
          role: role ?? "unknown",
          home: home ?? creep.room.name,
          remoteTarget: creep.memory.remoteTarget,
          mission: creep.memory.mission,
          boosted: creep.body.some(p => p.boost !== undefined),
          spawning: creep.spawning === true,
        });
      }
      if (role !== "harvester" && role !== "worker") continue;
      const sid = creep.memory.sourceId;
      if (sid) {
        globalSourceOccupancy.set(sid as string, (globalSourceOccupancy.get(sid as string) ?? 0) + 1);
      } else {
        const pendingHome = home ?? creep.room.name;
        if (pendingHome) {
          globalPendingHarvesters.set(pendingHome, (globalPendingHarvesters.get(pendingHome) ?? 0) + 1);
        }
      }
    }

    // 孵化中的 creep 已存在于 Game.creeps（spawning=true），上方循环已覆盖 —
    // 再遍历 Game.spawns 会把同一 creep 二次计入 pending，虚增 harvesterCount、
    // 掩盖真实 bootstrap 信号。

    // 写入 globalCache 供 tower-defense 读取。
    globalCache().repairRooms = globalRepairRooms;
    // distributorRooms 供 hauler fillStorage 的泵断供兜底判据。
    globalCache().distributorRooms = globalDistributorRooms;
    // haulerRooms 供 isLogisticsContainer 判定 source container 是否真有物流消费者。
    globalCache().haulerRooms = globalHaulerRooms;
    // creepLastSeen 供下 tick 的死亡事件（战斗黑匣子）取生前最后位置。
    globalCache().creepLastSeen = creepLastSeen;
    // P0-1：编队索引供 war-planner / power-farm-manager / prospect-manager /
    // expansion-manager 复用，消除各自独立全量遍历 Game.creeps。
    globalCache().squadIndex = squadIndex;

    for (const room of Object.values(Game.rooms)) {
      if (!room.controller?.my) continue;
      const snapshot = safeRunBuild(room.name, () =>
        buildRoomSnapshot(room, globalSourceOccupancy, globalCreepEnergy, globalPendingHarvesters),
        // K-1：快照是 P0 级基础设施 — 构建失败通常是确定性代码 bug，非 critical
        // 会在连续 3 次失败后冷却 80 tick，该房对所有消费快照的系统/角色隐身。
        // critical=true 让失败走限流日志暴露而非静默冷却，与 maintainMemory 同待遇。
        true,
      );
      if (snapshot) ctx._addSnapshot(snapshot);
    }
  }

  private runSystems(ctx: Context): void {
    for (const system of this.sortedSystems) {
      if (!this.shouldRunSystem(system, ctx)) {
        // K-6：interval 跳过是计划内行为，不记 skipReason —
        // 与 budget/colony-state 等异常跳过混入同一表会让遥测
        // skipHotspot 长期被百级 interval 计数淹没，真实信号不可见。
        continue;
      }
      // Recovery / 关键基建缺失豁免（P1-F）：system 通过 recoveryEligible 钩子
      // 自报是否需要 P1 等效优先级。kernel 只读钩子，不感知具体系统名
      // （plan.md §2.1）；原硬编码 "construction-manager"/"layout-planner" 判断已移除。
      // - construction-manager: buildQueue 有 P0 queued 关键基建（hasCriticalStructureGap，在 domain/construction/queue.ts）
      // - layout-planner: 任一 snapshot 命中 assessEmergencyRebuild().any
      const isRecoveryExempt = system.recoveryEligible?.(ctx) === true;
      const effectivePriority = isRecoveryExempt
        ? (1 as Priority)
        : system.priority;
      if (!ctx.budget.canStart(effectivePriority)) {
        recordSkip(`system/${system.name}/budget`);
        continue;
      }
      measuredRun(`system/${system.name}`, () =>
        safeRun(
          `system/${system.name}`,
          () => system.run(ctx),
          system.priority === 0, // P0 系统是关键的 — 永不冷却。
        ),
      );
      const gRun = globalCache();
      (gRun.systemLastRun ??= {})[system.name] = ctx.tick;
      if (ctx.budget.isExhausted()) break;
    }
  }

  /** 期望自检（E1 遥测新鲜度 / E2 P3 存活）→ 违例入 Memory + 事件；
   * P3 饥饿时设置前馈旁路窗口（scheduler 消费），恢复后自动摘除。 */
  private runExpectations(ctx: Context): void {
    const kernelMem = Memory.kernel;
    if (!kernelMem) return;
    const g = globalCache();
    const p3Systems: P3SystemRef[] = [...this.sortedSystems, ...this.postSystems]
      .filter((s) => s.priority === 3)
      .map((s) => ({ name: s.name, interval: s.interval }));
    const res = evaluateExpectations({
      tick: ctx.tick,
      statsLastSample: kernelMem.stats?.lastSample,
      systemLastRun: g.systemLastRun ?? {},
      p3Systems,
    });
    if (res.violations.length > 0) {
      kernelMem.expectations = {
        tick: ctx.tick,
        violations: res.violations.map((v) => v.id + "(" + v.detail + ")").slice(0, 10),
      };
      recordEvent(EventKind.ExpectationViolation, "kernel", [res.violations.length]);
      if (res.p3Starved) {
        kernelMem.p3StarveBypassUntil = ctx.tick + P3_BYPASS_WINDOW_TICKS;
        console.log(
          "[" + ctx.tick + "] expectations: P3 starvation — feed-forward bypass until " + kernelMem.p3StarveBypassUntil,
        );
      }
    } else {
      kernelMem.expectations = { tick: ctx.tick, violations: [] };
      if (kernelMem.p3StarveBypassUntil !== undefined) delete kernelMem.p3StarveBypassUntil;
    }
  }

  private shouldRunSystem(system: System, ctx: Context): boolean {
    // 间隔检查：最多每 N tick 运行一次。K-6：按系统名哈希做相位偏移 —
    // 原先 tick % interval === 0 使同 interval 的系统在同一 tick 扎堆运行
    // （每 10 tick 一个 CPU 尖峰节律），「错峰」原则未落实到系统层。
    // 内部有二级取模调度的系统必须用 systemPhase() 做相位相对判定。
    if (system.interval && system.interval > 1) {
      const phase = systemPhase(system.name, system.interval);
      if (ctx.tick % system.interval !== phase) return false;
    }
    return true;
  }

  /** 后置系统 — 在所有 creep 角色之后运行，复用 main 阶段的 budget/safeRun/measuredRun 管线。 */
  private runPostSystems(ctx: Context): void {
    for (const system of this.postSystems) {
      if (!this.shouldRunSystem(system, ctx)) continue;
      if (!ctx.budget.canStart(system.priority)) {
        recordSkip(`system/${system.name}/budget`);
        continue;
      }
      measuredRun(`system/${system.name}`, () =>
        safeRun(
          `system/${system.name}`,
          () => system.run(ctx),
          system.priority === 0, // P0 系统是关键的 — 永不冷却。
        ),
      );
      const gRun = globalCache();
      (gRun.systemLastRun ??= {})[system.name] = ctx.tick;
      if (ctx.budget.isExhausted()) break;
    }
  }

  private runCreeps(ctx: Context): void {
    const roleMap = this.roleMap;

    const creepEntries: Array<{ creep: Creep; role: CreepRole }> = [];
    for (const creep of Object.values(Game.creeps)) {
      const role = roleMap.get(creep.memory.role);
      if (!role) {
        // 自愈：清除未知角色的旧目标/分配；用稳定 label（按角色名而非 creep 名）限频。
        creep.memory.targetId = undefined;
        creep.memory.assignment = undefined;
        safeRun(`creep/unknown-role/${creep.memory.role}`, () => {
          console.log(
            `[${Game.time}] creep/${creep.name}: unknown role '${creep.memory.role}', cleared targets`,
          );
        });
        continue;
      }
      creepEntries.push({ creep, role });
    }

    // 排序：角色优先级升序（P0 在前）→ 同优先级按执行顺序（X-19）→ ticksToLive 升序。
    creepEntries.sort((a, b) => {
      if (a.role.priority !== b.role.priority) return a.role.priority - b.role.priority;
      const aOrder = ROLE_EXECUTION_ORDER[a.role.name] ?? 99;
      const bOrder = ROLE_EXECUTION_ORDER[b.role.name] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aTtl = a.creep.ticksToLive ?? 1500;
      const bTtl = b.creep.ticksToLive ?? 1500;
      return aTtl - bTtl;
    });

    // 战争/在房威胁紧急旁路：combat 角色在 war 姿态或本房有真实在房威胁时不被
    // recovery 冻结（帝国不能冻自己的军队；真被入侵时更要让作战单位跑起来）。
    const posture = Memory.kernel?.strategy?.posture;
    // P0-3：自有房威胁集合（snapshot.threatCreeps）。
    const liveThreatRooms = new Set(
      Array.from(ctx.snapshots())
        .filter(s => (s.threatCreeps?.length ?? 0) > 0)
        .map(s => s.roomName),
    );
    // P0-3：远矿房威胁集合 — combat 角色可能正在远矿房/扩张目标房作战，
    // 这些房不在 ctx.snapshots()（只含 controller.my 的房）中。
    // 遍历 Game.rooms 中非自有房的房，检测有 hostile creep 的房名 —
    // combat 角色当前所在房有威胁时同样需要旁路。
    // 只扫描 combat 角色可能出现的房（减少扫描量）：收集 combat 角色所在房名。
    const combatRooms = new Set<string>();
    for (const { creep, role } of creepEntries) {
      if (role.combat !== true) continue;
      // creep.room 是当前视野所在房（自有/远矿/敌方）— 可能为 undefined（测试 mock）。
      const roomName = creep.room?.name;
      if (roomName && !liveThreatRooms.has(roomName)) {
        combatRooms.add(roomName);
      }
    }
    for (const roomName of combatRooms) {
      const room = Game.rooms[roomName];
      if (!room) continue; // 无视野
      // FIND_HOSTILE_CREEPS 在非自有房也可用（需视野）。
      // 复用 classifyThreats 统一威胁口径（THREAT_PARTS = ATTACK/RANGED_ATTACK/HEAL/WORK/CLAIM）—
      // 与 room-snapshot / remote-mining-manager / flee 判定同口径，消除分裂。
      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      if (classifyThreats(hostiles, CONFIG.defense.allies).length > 0) {
        liveThreatRooms.add(roomName);
      }
    }

    for (const { creep, role } of creepEntries) {
      // 每房殖民地状态门禁：recovery/bootstrap 时允许 P0/P1（能量链），跳过 P2+。
      // 例外（R3a）：recovery 时允许角色自报的 survival/income 豁免（recoveryEligible）—
      // kernel 只读钩子，不再硬编码角色名（与 System recoveryEligible 同一模式）。
      // 例外（战争紧急旁路）：combat 角色在 war 姿态或本房有活敌时继续运行（见
      // colonyStateFreezesRole）。状态由 room-state 每 tick 写入 RoomMemory.colonyState。
      // P1-2（CPU 死亡螺旋修复）：colony-state 门禁在 budget 检查之前执行 —
      // 原先 budget.canStart 先挡住 P2 builder，使豁免形同虚设。
      const home = creep.memory.home;
      const roomState = home ? Memory.rooms[home]?.colonyState ?? "normal" : "normal";
      const isRecoveryExempt = roomState === "recovery" && role.recoveryEligible === true;
      // P0-3：combat 角色可能在远矿房作战 — 威胁检查同时看 home 和当前所在房。
      const inThreatRoom = liveThreatRooms.has(home ?? "") || liveThreatRooms.has(creep.room?.name ?? "");
      if (colonyStateFreezesRole(roomState, role, posture, inThreatRoom)) {
        recordSkip(`creep/${role.name}/colony-state`);
        continue;
      }

      // Idle cadence：idle 且无 stuck 的 creep 降频执行。每 tick 都完整走
      // role-runner 管线（威胁检测 → ensureHome → updateMode → 候选遍历 →
      // parkIdleCreep）对 idle creep 纯属浪费——它不在做任何事，下一 tick
      // 也不会突然有活干（任务由 assignment-service 分配，与 creep 自身无关）。
      // 降频检查（每 cadenceTicks tick 一次）保持响应性：
      //   - 每次检查仍走完整管线 → 发现新任务即恢复每 tick 执行（mode 切回 acquire/work）
      //   - 用 creep 名哈希做相位偏移，idle creep 不扎堆同一 tick 检查
      //   - stuck > 0 的 idle creep 不跳过（可能需要自愈脱困）
      //   - recycle 标记的 creep 不跳过（spawn-manager 每 tick 驱动归航回收）
      //   - remoteTarget 存在的 creep 不跳过（跨房通勤中 idle 可能需导航）
      //   - home/所在房有威胁时不跳过（role-runner 内部威胁检测不可漏帧，
      //     否则 idle creep 在敌袭 tick 不会 flee——PvP 场景 5 tick 延迟可致命）
      const mode = creep.memory.mode ?? "acquire";
      const stuck = creep.memory.stuckTicks ?? 0;
      const inThreatArea = liveThreatRooms.has(home ?? "") || liveThreatRooms.has(creep.room?.name ?? "");
      const cadence = idleCadenceTicks(ctx.budget.tier);
      if (
        mode === "idle" &&
        stuck === 0 &&
        !creep.memory.recycle &&
        !creep.memory.remoteTarget &&
        !inThreatArea &&
        cadence > 1 &&
        (Game.time + hashCreepName(creep.name)) % cadence !== 0
      ) {
        recordSkip(`creep/${role.name}/idle-cadence`);
        continue;
      }

      // Budget 检查 — 被豁免的角色用 P1 等效优先级，获得 CPU 逃生通道。
      const budgetPriority = isRecoveryExempt ? (1 as Priority) : role.priority;
      if (!ctx.budget.canStart(budgetPriority)) {
        recordSkip(`creep/${role.name}/budget`);
        continue;
      }
      if (ctx.budget.isExhausted()) break;

      // Per-room CPU 记账：复用 measuredRun 返回的 CPU 消耗值，零额外 getUsed() 调用。
      // telemetry-collector 采样写入 Memory，供 empire-strategy 评估每房真实成本。
      const cpuCost = measuredRun(`creep/${creep.name}/${role.name}`, () =>
        safeRun(
          `creep/${creep.name}/${role.name}`,
          () => role.run(creep, ctx),
          role.priority === 0, // P0 角色是关键的 — 永不冷却。
        ),
      );
      const homeKey = home ?? creep.room?.name ?? "unknown";
      const byHome = globalCache().cpuByHome;
      if (byHome) {
        byHome.set(homeKey, (byHome.get(homeKey) ?? 0) + cpuCost);
      }
    }
  }
}

// ─── 纯函数（可独立测试）────────────────────────────────────

/**
 * recovery/bootstrap 殖民地态门禁（纯函数）：
 * 冻结 P2+ 非豁免角色，保住能量链。战斗角色(combat)在 war 姿态或本房有真实在房威胁时
 * 旁路——帝国不能冻自己的军队，真被入侵时更要让作战单位跑起来（紧急旁路）。
 * 抽成纯函数便于单测，避免整段 runCreeps 难以覆盖。
 */
export function colonyStateFreezesRole(
  roomState: string,
  role: { readonly priority: number; readonly recoveryEligible?: boolean; readonly combat?: boolean },
  posture: string | undefined,
  liveThreatInRoom: boolean,
): boolean {
  if (roomState !== "recovery" && roomState !== "bootstrap") return false;
  if (role.priority <= 1) return false; // P0/P1（能量链/防御）永远放行
  if (roomState === "recovery" && role.recoveryEligible === true) return false; // R3a 豁免
  // 紧急旁路：战争或真实入侵时，作战单位必须照常运行（帝国存续所系）。
  if (role.combat === true && (posture === "war" || liveThreatInRoom)) return false;
  return true;
}

// P1-F：hasCriticalStructureGap 已搬到 src/domain/construction/queue.ts
// （construction-manager 的 recoveryEligible 钩子）；kernel 经
// system.recoveryEligible 钩子间接消费，不再直接持有。
