/**
 * Tier A 收尾修复回归（Batch 5 — AS-1 / TU-1）。
 *
 * AS-1：assignment 续约必须校验「任务仍在本 tick 池中」— 僵尸 assignment
 *（container 抽空后任务出池但对象还在）不得无限续约。
 * TU-1：tuning 的 upgrader 降编不得把「storage 未解锁（RCL2-3）」
 * 误判为「storage 枯竭」。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getAssignment } from "../../../src/creeps/support/assignment-adapter";
import { TaskPool } from "../../../src/domain/assignment/task-pool";
import { evaluateTuning } from "../../../src/domain/tuning/evaluator";
import type { TuningSignals } from "../../../src/domain/tuning/types";
import { mockContext, mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../role-helpers";

const g = (): any => globalThis as any;

beforeEach(() => {
  resetGlobals();
});

// ─── AS-1：僵尸 assignment ───────────────────────────────────

describe("AS-1 — assignment 续约的任务在池校验", () => {
  function installPool(tasks: any[]): TaskPool {
    const pool = new TaskPool();
    pool.init(g().Game.time);
    pool.setRoomTasks("W7N4", tasks);
    g().assignment = { tick: g().Game.time, pool };
    return pool;
  }

  function assignedCreep(taskId: string): any {
    // 注册 container 使 sourceId 存在性检查通过 — 隔离「任务出池」这一条。
    // revision=1 对齐 role-helpers 的 Memory.rooms.W7N4.layout.revision。
    const container = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    void container;
    return mockCreep({
      name: "hauler_1", role: "hauler", used: 0, capacity: 100,
      assignment: {
        id: taskId, kind: "haul", sourceId: "c1",
        revision: 1, assignedAt: 900, leaseUntil: g().Game.time + 30,
      },
    });
  }

  it("任务已出池（container 抽空）：assignment 失效并清除 — 不再僵尸续约", () => {
    installPool([]); // 池中无任务。
    const creep = assignedCreep("haul:W7N4:c1");
    const ctx = mockContext(mockSnapshot());

    const result = getAssignment(creep, ctx);

    expect(creep.memory.assignment?.id).not.toBe("haul:W7N4:c1");
    // 池为空 → 无新任务可选。
    expect(result).toBeUndefined();
  });

  it("任务仍在池中：正常续约（保留 assignedAt，不走重选）", () => {
    installPool([{
      id: "haul:W7N4:c1", kind: "haul", sourceId: "c1",
      priority: 1, maxWorkers: 1, assignedCreeps: ["hauler_1"],
    }]);
    const creep = assignedCreep("haul:W7N4:c1");
    const ctx = mockContext(mockSnapshot());

    const result = getAssignment(creep, ctx);

    expect(result?.id).toBe("haul:W7N4:c1");
    expect(result!.leaseUntil).toBe(ctx.tick + 50);
    expect(result!.assignedAt).toBe(900); // 续约保留原 assignedAt — 非重选。
  });

  it("池缺失（reset 首 tick）：保守放行不误杀", () => {
    delete g().assignment;
    const creep = assignedCreep("haul:W7N4:c1");
    const ctx = mockContext(mockSnapshot());

    const result = getAssignment(creep, ctx);

    expect(result?.id).toBe("haul:W7N4:c1");
    expect(result!.assignedAt).toBe(900);
  });
});

// ─── TU-1：upgrader 降编的 storage 解锁区分 ──────────────────

describe("TU-1 — tuning upgrader 降编不误伤无 storage 房间", () => {
  function signals(overrides: Partial<TuningSignals> = {}): TuningSignals {
    return {
      avgReserveDelta: 50, avgPressure: 0.2, avgDrainScore: 0, crisisRatio: 0,
      avgStorageEnergy: 0, containerFillRatio: 0.4, spawnFillRatio: 0.7,
      haulerCount: 2, harvesterCount: 2, upgraderCount: 2, builderCount: 1,
      buildQueueBacklog: 1, srcRatio: 0, tierRank: 0, rcl: 3,
      ...overrides,
    };
  }
  const bounds = {
    hauler: { minCount: 2, maxCount: 4 },
    harvester: { minCount: 2, maxCount: 4 },
    upgrader: { minCount: 1, maxCount: 3 },
    builder: { minCount: 1, maxCount: 4 },
  };

  it("RCL3 无 storage（avgStorageEnergy=0）：不产生 upgrader 降编趋势", () => {
    const result = evaluateTuning(signals({ rcl: 3, avgStorageEnergy: 0 }), bounds, {}, 5000, {});
    expect(result.newTrend["upgrader.maxCount"]).not.toBe("down");
  });

  it("RCL4+ storage 枯竭（< 10k）：照常降编（原语义不回归）", () => {
    const result = evaluateTuning(signals({ rcl: 5, avgStorageEnergy: 3000 }), bounds, {}, 5000, {});
    expect(result.newTrend["upgrader.maxCount"]).toBe("down");
  });

  it("经济高压：无论 RCL 照常降编", () => {
    const result = evaluateTuning(signals({ rcl: 3, avgStorageEnergy: 0, avgPressure: 0.6 }), bounds, {}, 5000, {});
    expect(result.newTrend["upgrader.maxCount"]).toBe("down");
  });
});
