import type {
  Budget,
  CreepRole,
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
import { emitSummary, initTelemetry } from "./telemetry";
import { Registry } from "./registry";
import { buildRoomSnapshot } from "../systems/room-snapshot";
import { globalCache } from "./global-cache";

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

/**
 * 同优先级角色内的执行顺序（约束 X-19）。
 * harvester 在 hauler 之前执行，确保先填 container 再取，避免 hauler 空跑。
 */
const ROLE_EXECUTION_ORDER: Readonly<Record<string, number>> = {
  worker: 0,
  harvester: 1,
  hauler: 2,
  upgrader: 3,
  builder: 4,
};

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
    // 1. 预算 — 根据 bucket 带滞回地确定 CPU 档位。
    const budget = createBudget();

    // 2. Segment — 声明本 tick 需要激活的 RawMemory segment。
    //    必须在 maintainMemory 之前：迁移（如 v4）会调用 readLayoutSegment，
    //    而 segmentUnavailable 守卫依赖 requestSegments 写入的 requestedAt 判断
    //    「reset 首 tick segment 未加载」。若迁移先执行，守卫失效，
    //    空结构可能被缓存并在 flush 时整体覆盖 segment 历史数据。
    safeRun("segments-request", () => requestSegments(), true);

    // 3. Memory — 迁移与日常维护拆分为两个错误边界（K-5）：
    //    迁移 throw 不连坐死 creep 清理/房间兜底（防 Memory.creeps 慢性泄漏）。
    //    关键步骤：永不冷却。
    safeRun("memory-migrate", () => runMigrations(), true);
    safeRun("memory", () => maintainMemory(), true);

    // 3.5 遥测 — 初始化单 tick 计数器。
    initTelemetry(Game.time);

    // 4. 构建上下文。
    const ctx = new Context(budget);

    // 5. 构建房间快照（P0 — 必须在任何读取快照的系统之前运行）。
    this.buildSnapshots(ctx);

    // 6. 按优先级排序运行系统。
    //    room-state (P0) 在 spawn-manager (P0) 之前注册，先计算每房 ColonyState。
    this.runSystems(ctx);

    // 7. 按优先级排序运行 creep 角色。
    this.runCreeps(ctx);

    // 7.5 后置系统 — 消费角色执行期产出的 per-tick 数据
    //     （如 traffic-manager 集中解算移动意图并统一签发 move）。
    this.runPostSystems(ctx);

    // 8. 遥测摘要。
    emitSummary(budget);

    // 9. 将 skip 原因从 global 缓冲区刷入 Memory。
    safeRun("flush-skips", () => flushSkips(), true);

    // 10. 将 dirty segment 数据刷写回 RawMemory。
    safeRun("segments-flush", () => flushSegments(), true);
  }

  private buildSnapshots(ctx: Context): void {
    // 预构建全局 source 占用映射，避免每个房间独立遍历全部 Game.creeps。
    // 仅统计实际采矿角色（harvester/worker），其他角色的 sourceId 仅用于 acquire 寻路，
    // 不占用采矿位。
    const globalSourceOccupancy = new Map<string, number>();
    // 同时汇总每房 creep 身上携带的能量（按 memory.home 归属），
    // 供 room-state 的 reserve 计入在途能量，避免物流搬运造成危机信号抖动（P1-5 ①）。
    const globalCreepEnergy = new Map<string, number>();
    // P1-3：预构建拥有维修 creep（builder/worker）的房间集合，
    // 供 tower-defense 消费，避免塔防系统独立全量扫描 Game.creeps。
    const globalRepairRooms = new Set<string>();
    // 预构建拥有存活 distributor 的房间集合，供 hauler 的 fillStorage 消费：
    // 分发泵断供时 hauler 不得继续把能量锁进 storage（角色层禁止全局扫描，
    // 由 kernel 复用本遍历一次构建）。孵化中的也计入 — 泵即将上岗，防止兜底抖动。
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
      if (role !== "harvester" && role !== "worker") continue;
      const sid = creep.memory.sourceId;
      if (sid) {
        globalSourceOccupancy.set(sid as string, (globalSourceOccupancy.get(sid as string) ?? 0) + 1);
      } else {
        // 已存活但尚未分配 sourceId 的新 harvester — 计入 pending。
        const pendingHome = home ?? creep.room.name;
        if (pendingHome) {
          globalPendingHarvesters.set(pendingHome, (globalPendingHarvesters.get(pendingHome) ?? 0) + 1);
        }
      }
    }

    // 孵化中的 creep 已存在于 Game.creeps（spawning=true），上方循环已覆盖：
    // 有 sourceId → 计入 occupancy；无 sourceId → 计入 pending。
    // 因此无需再遍历 Game.spawns 单独统计孵化中的 harvester/worker —
    // 那样会把同一 creep 第二次计入 pending，虚增 room-state 的 harvesterCount、
    // 掩盖真实 bootstrap 信号。

    // 将 repairRooms 写入 globalCache，供 tower-defense 读取。
    globalCache().repairRooms = globalRepairRooms;
    // distributorRooms 供 hauler fillStorage 的泵断供兜底判据。
    globalCache().distributorRooms = globalDistributorRooms;
    // haulerRooms 供 isLogisticsContainer 判定 source container 是否真有物流消费者。
    globalCache().haulerRooms = globalHaulerRooms;
    // creepLastSeen 供下 tick 的死亡事件（战斗黑匣子）取生前最后位置。
    globalCache().creepLastSeen = creepLastSeen;

    for (const room of Object.values(Game.rooms)) {
      if (!room.controller?.my) continue;
      const snapshot = safeRunBuild(room.name, () =>
        buildRoomSnapshot(room, globalSourceOccupancy, globalCreepEnergy, globalPendingHarvesters),
        // K-1：快照是 P0 级基础设施 — 构建失败通常是确定性代码 bug，
        // 非 critical 会在连续 3 次失败后冷却 80 tick，该房对所有消费
        // 快照的系统/角色隐身（spawn/塔防/全角色停摆）。critical=true
        // 让失败走限流日志暴露而非静默冷却，与 maintainMemory 同待遇。
        true,
      );
      if (snapshot) ctx._addSnapshot(snapshot);
    }
  }

  private runSystems(ctx: Context): void {
    // 检查是否有任何自有房间处于 recovery 状态。
    // recovery 时 colonyState="recovery"，意味着关键基建缺失或经济断裂。
    // 此时 construction-manager (P2) 和 layout-planner (P3) 必须能够运行：
    //   - layout-planner: 重新将被毁的关键结构任务推入 buildQueue
    //   - construction-manager: 为紧急任务创建 construction site
    // 这与 runCreeps 中 builder 的 recovery 豁免同理（P2 builder 在 recovery 时
    // 以 P1 等效优先级运行），确保灾后重建路径不被 budget tier 完全冻结。
    const anyRecovery = Object.values(Memory.rooms).some(
      r => r?.colonyState === "recovery",
    );
    // 关键基建缺失检测：storage/tower/spawn 在 buildQueue 中 P0 queued 但从未建成。
    // 此场景下 colonyState 可能为 "normal"（phase=growth），不触发 anyRecovery，
    // 但 construction-manager 仍被 budget tier 拦截 → 关键基建永远建不成 → 死锁。
    // anyCriticalGap 扩展豁免范围，覆盖"从未建成"与"被毁重建"两种情况。
    const anyCriticalGap = hasCriticalStructureGap(Memory.rooms);

    // 使用缓存的已排序 systems 列表（构造时构建）。
    for (const system of this.sortedSystems) {
      if (!this.shouldRunSystem(system, ctx)) {
        // K-6：interval 跳过是计划内行为，不记 skipReason —
        // 与 budget/colony-state 等异常跳过混入同一表会让遥测
        // skipHotspot 长期被百级 interval 计数淹没，真实信号不可见。
        continue;
      }
      // Recovery / 关键基建缺失豁免：construction-manager 和 layout-planner
      // 在 anyRecovery 或 anyCriticalGap 时以 P1 等效优先级通过 budget 检查，
      // 确保紧急重建路径可达。
      const isConstructionCritical =
        (anyRecovery || anyCriticalGap) &&
        (system.name === "construction-manager" || system.name === "layout-planner");
      const effectivePriority = isConstructionCritical
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
      if (ctx.budget.isExhausted()) break;
    }
  }

  private shouldRunSystem(system: System, ctx: Context): boolean {
    // 间隔检查：最多每 N tick 运行一次。
    // K-6：按系统名哈希做相位偏移 — 原先 tick % interval === 0 使同
    // interval 的系统全部在同一 tick 扎堆运行（每 10 tick 一个 CPU
    // 尖峰节律），plan「错峰」原则未落实到系统层。
    // 内部有二级取模调度的系统必须用 systemPhase() 做相位相对判定。
    if (system.interval && system.interval > 1) {
      const phase = systemPhase(system.name, system.interval);
      if (ctx.tick % system.interval !== phase) return false;
    }
    return true;
  }

  /**
   * 后置系统 — 在所有 creep 角色之后运行，消费角色执行期产出的
   * per-tick 数据（如 traffic-manager 解算移动意图账本并统一签发 move）。
   * 复用 main 阶段的 budget / safeRun / measuredRun 管线。
   */
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
      if (ctx.budget.isExhausted()) break;
    }
  }

  private runCreeps(ctx: Context): void {
    // 使用缓存的 roleMap（构造时构建）。
    const roleMap = this.roleMap;

    // 收集 creep 及其角色优先级用于排序。
    const creepEntries: Array<{ creep: Creep; role: CreepRole }> = [];
    for (const creep of Object.values(Game.creeps)) {
      const role = roleMap.get(creep.memory.role);
      if (!role) {
        // 自愈：清除未知角色的旧目标和分配。
        creep.memory.targetId = undefined;
        creep.memory.assignment = undefined;
        // 使用稳定 label（按角色名而非 creep 名）进行限频。
        safeRun(`creep/unknown-role/${creep.memory.role}`, () => {
          console.log(
            `[${Game.time}] creep/${creep.name}: unknown role '${creep.memory.role}', cleared targets`,
          );
        });
        continue;
      }
      creepEntries.push({ creep, role });
    }

    // 按角色优先级升序排序（P0 在前），同优先级内按角色执行顺序排序
    // （X-19：harvester 在 hauler 前），最后按 ticksToLive 升序排序。
    creepEntries.sort((a, b) => {
      if (a.role.priority !== b.role.priority) return a.role.priority - b.role.priority;
      const aOrder = ROLE_EXECUTION_ORDER[a.role.name] ?? 99;
      const bOrder = ROLE_EXECUTION_ORDER[b.role.name] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aTtl = a.creep.ticksToLive ?? 1500;
      const bTtl = b.creep.ticksToLive ?? 1500;
      return aTtl - bTtl;
    });

    for (const { creep, role } of creepEntries) {
      // 每房殖民地状态门禁：在 recovery/bootstrap 时允许 P0 和 P1（能量链），
      // 但跳过 P2+（发展角色如 upgrader）。
      // 例外：recovery 时允许 builder——重建被毁基建是生存行为，不是发展。
      // 状态由 room-state 系统每 tick 写入 RoomMemory.colonyState。
      //
      // P1-2（CPU 死亡螺旋修复）：colony-state 门禁在 budget 检查之前执行。
      // 原先 budget.canStart 先于 colony-state 检查，recovery tier 的 maxPriority=1
      // 会先挡住 P2 builder，使 colony-state 中的 builder 豁免形同虚设。
      // 现在：先计算 colony-state 豁免，被豁免的 builder 用 P1 等效优先级通过 budget。
      const home = creep.memory.home;
      const roomState = home ? Memory.rooms[home]?.colonyState ?? "normal" : "normal";
      const isBuilderRecoveryExempt = roomState === "recovery" && role.name === "builder";
      if (
        (roomState === "recovery" || roomState === "bootstrap") &&
        role.priority > 1 &&
        !isBuilderRecoveryExempt
      ) {
        recordSkip(`creep/${role.name}/colony-state`);
        continue;
      }

      // Budget 检查 — 被豁免的 builder 用 P1 等效优先级，获得 CPU 逃生通道。
      const budgetPriority = isBuilderRecoveryExempt ? (1 as Priority) : role.priority;
      if (!ctx.budget.canStart(budgetPriority)) {
        recordSkip(`creep/${role.name}/budget`);
        continue;
      }
      if (ctx.budget.isExhausted()) break;

      measuredRun(`creep/${creep.name}/${role.name}`, () =>
        safeRun(
          `creep/${creep.name}/${role.name}`,
          () => role.run(creep, ctx),
          role.priority === 0, // P0 角色是关键的 — 永不冷却。
        ),
      );
    }
  }
}

// ─── 纯函数（可独立测试）────────────────────────────────────

/**
 * 检测是否有任何房间的 buildQueue 中存在 P0 queued 的关键基建任务。
 *
 * 关键基建 = storage / tower / spawn — 这三类结构缺失时经济链路断裂，
 * 必须让 construction-manager 在任何 budget tier 下都能运行（以 P1 等效优先级）。
 *
 * 纯函数 — 不访问 Game/Memory，接收显式参数，可在 Vitest 中独立测试。
 */
export function hasCriticalStructureGap(
  rooms: Record<string, { buildQueue?: Array<{ priority: number; state: string; structureType: string }> } | undefined>,
): boolean {
  return Object.values(rooms).some(
    r => r?.buildQueue?.some(
      t => t.priority === 0 && t.state === "queued" &&
        (t.structureType === STRUCTURE_STORAGE ||
          t.structureType === STRUCTURE_TOWER ||
          t.structureType === STRUCTURE_SPAWN),
    ),
  );
}
