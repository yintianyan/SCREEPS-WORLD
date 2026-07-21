import type {
  Budget,
  CreepRole,
  RoomSnapshot,
  System,
  TickContext,
} from "./contracts";
import { recordSkip, flushSkips, maintainMemory } from "./memory";
import { measuredRun, safeRun, safeRunBuild } from "./safe-run";
import { createBudget } from "./scheduler";
import { emitSummary, initTelemetry } from "./telemetry";
import { Registry } from "./registry";
import { buildRoomSnapshot } from "../systems/room-snapshot";

/** 具体 TickContext，包含用于内核设置的内部变更方法。 */
class Context implements TickContext {
  readonly tick: number;
  readonly budget: Budget;
  private readonly _snapshots = new Map<string, RoomSnapshot>();

  constructor(budget: Budget) {
    this.tick = Game.time;
    this.budget = budget;
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

  constructor(private readonly registry: Registry) {
    // 缓存 roleMap 和 sortedSystems — Registry 内容在 tick 间不变，避免每 tick 重建和排序。
    this.roleMap = new Map(registry.getRoles().map(r => [r.name, r] as const));
    this.sortedSystems = registry.getSystems();
  }

  run(): void {
    // 1. 预算 — 根据 bucket 带滞回地确定 CPU 档位。
    const budget = createBudget();

    // 2. Memory — 迁移、清理、默认值。关键步骤：永不冷却。
    safeRun("memory", () => maintainMemory(), true);

    // 3. 遥测 — 初始化单 tick 计数器。
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

    // 8. 遥测摘要。
    emitSummary(budget);

    // 9. 将 skip 原因从 global 缓冲区刷入 Memory。
    safeRun("flush-skips", () => flushSkips(), true);
  }

  private buildSnapshots(ctx: Context): void {
    // 预构建全局 source 占用映射，避免每个房间独立遍历全部 Game.creeps。
    // 仅统计实际采矿角色（harvester/worker），其他角色的 sourceId 仅用于 acquire 寻路，
    // 不占用采矿位。
    const globalSourceOccupancy = new Map<string, number>();
    for (const creep of Object.values(Game.creeps)) {
      const role = creep.memory.role;
      if (role !== "harvester" && role !== "worker") continue;
      const sid = creep.memory.sourceId;
      if (sid) {
        globalSourceOccupancy.set(sid as string, (globalSourceOccupancy.get(sid as string) ?? 0) + 1);
      }
    }

    for (const room of Object.values(Game.rooms)) {
      if (!room.controller?.my) continue;
      const snapshot = safeRunBuild(room.name, () =>
        buildRoomSnapshot(room, globalSourceOccupancy),
      );
      if (snapshot) ctx._addSnapshot(snapshot);
    }
  }

  private runSystems(ctx: Context): void {
    // 使用缓存的已排序 systems 列表（构造时构建）。
    for (const system of this.sortedSystems) {
      if (!this.shouldRunSystem(system, ctx)) {
        recordSkip(`system/${system.name}/interval`);
        continue;
      }
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

  private shouldRunSystem(system: System, ctx: Context): boolean {
    // 间隔检查：最多每 N tick 运行一次。
    if (system.interval && system.interval > 1) {
      if (ctx.tick % system.interval !== 0) return false;
    }
    return true;
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
      if (!ctx.budget.canStart(role.priority)) {
        recordSkip(`creep/${role.name}/budget`);
        continue;
      }
      if (ctx.budget.isExhausted()) break;

      // 每房殖民地状态门禁：在 recovery/bootstrap 时允许 P0 和 P1（能量链），
      // 但跳过 P2+（发展角色如 upgrader/builder）。
      // 状态由 room-state 系统每 tick 写入 RoomMemory.colonyState。
      const home = creep.memory.home;
      const roomState = home ? Memory.rooms[home]?.colonyState ?? "normal" : "normal";
      if (
        (roomState === "recovery" || roomState === "bootstrap") &&
        role.priority > 1
      ) {
        recordSkip(`creep/${role.name}/colony-state`);
        continue;
      }

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
