/**
 * P1-F 测试 — layout-planner 相位偏移 + 4-stage 分片 + recoveryEligible 钩子。
 *
 * 覆盖（对应 docs/remediation-plan-2026-08.md §P1-F 验证清单）：
 *   1. roomPhase 纯函数（DJB-like 哈希，与 systemPhase 共用算法）
 *   2. assessEmergencyRebuild 纯函数（关键基建缺失检测）
 *   3. layoutPlannerSystem.recoveryEligible 钩子（kernel P1 等效提升判据）
 *   4. planStage 4-stage 状态机（转换 + global reset 恢复 + stage 0 门禁）
 *
 * 设计原则：
 *   - 纯函数测试不依赖 Game/Memory（roomPhase、assessEmergencyRebuild）
 *   - 钩子测试用 mockContext + mockSnapshot（recoveryEligible 只读 ctx.snapshots()）
 *   - 状态机测试用最小 Game.rooms + Memory + RawMemory mock，聚焦不变量而非
 *     各 stage 内部业务逻辑（constraint-placer / road-planner 自有单测覆盖）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roomPhase, systemPhase } from "../../../src/kernel/phase";
import {
  assessEmergencyRebuild,
  isEmergencyTask,
  type EmergencyRebuildStatus,
} from "../../../src/domain/construction/queue";
import { layoutPlannerSystem } from "../../../src/systems/layout-planner";
import { CONFIG } from "../../../src/config";
import { packPos } from "../../../src/domain/layout/types";
import {
  resetGlobals,
  mockSnapshot,
  mockStructure,
  mockSource,
  mockContext,
  mockBudget,
} from "../../role-helpers";
import type { RoomSnapshot, TickContext } from "../../../src/kernel/contracts";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  // segment-store 缓存重置（layout-planner 依赖 getRoomLayoutData）
  delete (globalThis as any).__segStore;
  // RawMemory mock（segment-store 读取所需）
  (globalThis as any).RawMemory = { segments: {}, setActiveSegments: () => {} };
});

// ─── 1. roomPhase 纯函数测试 ─────────────────────────────────

describe("P1-F.1 — roomPhase 相位偏移哈希", () => {
  it("返回值在 [0, interval) 内", () => {
    for (const name of ["W7N4", "W1N1", "E5S3", "W10N10", "W23S45"]) {
      const phase = roomPhase(name, 50);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(50);
    }
  });

  it("同名稳定（多次调用结果一致）", () => {
    const a = roomPhase("W7N4", 50);
    const b = roomPhase("W7N4", 50);
    expect(a).toBe(b);
  });

  it("与 systemPhase 共用 hashPhase 算法（同 key+interval 返回相同值）", () => {
    // roomPhase 与 systemPhase 都是 hashPhase 的语义包装 — 哈希族一致
    // 是 P1-F 的核心设计契约（plan.md §3.2 错峰）。
    expect(roomPhase("W7N4", 50)).toBe(systemPhase("W7N4", 50));
    expect(roomPhase("abc", 10)).toBe(systemPhase("abc", 10));
    expect(roomPhase("", 7)).toBe(systemPhase("", 7));
  });

  it("interval ≤ 1 时返回 0（每 tick 系统不受错峰影响）", () => {
    expect(roomPhase("W7N4", 0)).toBe(0);
    expect(roomPhase("W7N4", 1)).toBe(0);
  });

  it("多房间相位充分分布（10 个房至少有 3 个不同相位）", () => {
    // P1-F 目标：消除 N 个房每 50 tick 同 tick 扎堆规划。
    // 10 个房分散到 50 个槽位 — 至少 3 个不同值才算有效分散。
    const phases = new Set<number>();
    for (let i = 1; i <= 10; i++) {
      phases.add(roomPhase(`W${i}N4`, 50));
    }
    expect(phases.size).toBeGreaterThanOrEqual(3);
  });

  it("两房 nextPlanTick 错开（P1-F 核心契约：消除同 tick 扎堆规划）", () => {
    // 模拟 planStage3RoadsAndFinalize 中设置 nextPlanTick 的逻辑：
    //   nextPlanTick = ctx.tick + planInterval + roomPhase(roomName, planInterval)
    const tick = 1000;
    const planInterval = CONFIG.layout.planInterval;
    const nextA = tick + planInterval + roomPhase("W7N4", planInterval);
    const nextB = tick + planInterval + roomPhase("W1N1", planInterval);
    // 两房相位不同 → nextPlanTick 必不同 — 扎堆消除
    if (roomPhase("W7N4", planInterval) !== roomPhase("W1N1", planInterval)) {
      expect(nextA).not.toBe(nextB);
    }
  });
});

// ─── 2. assessEmergencyRebuild 纯函数测试 ─────────────────────

describe("P1-F.2 — assessEmergencyRebuild 关键基建缺失检测", () => {
  /** 构造一个全部满足的 snapshot（无紧急）。 */
  function healthySnapshot(rcl = 4): RoomSnapshot {
    const spawn = mockStructure("spawn", { id: "sp" });
    spawn.pos = { x: 25, y: 25, roomName: "W7N4" } as any;
    const source = mockSource("src1");
    source.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const container = mockStructure("container", { id: "c1" });
    container.pos = { x: 21, y: 20, roomName: "W7N4" } as any; // source 旁 1 格
    const tower = mockStructure("tower", { id: "t1" });
    const storage = mockStructure("storage", { id: "st1" });
    return mockSnapshot({
      rcl,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [container as any],
      towers: [tower as any],
      storage: storage as any,
    });
  }

  it("全部满足时 any=false（无紧急）", () => {
    const r = assessEmergencyRebuild(healthySnapshot());
    expect(r.sourceContainer).toBe(false);
    expect(r.tower).toBe(false);
    expect(r.spawn).toBe(false);
    expect(r.storage).toBe(false);
    expect(r.any).toBe(false);
  });

  it("spawn 缺失 → spawn=true, any=true（最严重的紧急状态）", () => {
    const snap = mockSnapshot({ rcl: 3, spawns: [] });
    const r = assessEmergencyRebuild(snap);
    expect(r.spawn).toBe(true);
    expect(r.any).toBe(true);
  });

  it("tower 缺失且 RCL≥3 → tower=true", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      towers: [],
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.tower).toBe(true);
    expect(r.any).toBe(true);
  });

  it("tower 缺失但 RCL<3 → tower=false（未解锁不算紧急）", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const source = mockSource("src1");
    source.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const container = mockStructure("container", { id: "c1" });
    container.pos = { x: 21, y: 20, roomName: "W7N4" } as any; // source 旁 1 格
    const snap = mockSnapshot({
      rcl: 2,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [container as any],
      towers: [],
      storage: undefined,
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.tower).toBe(false);
    expect(r.any).toBe(false);
  });

  it("storage 缺失且 RCL≥4 → storage=true", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const snap = mockSnapshot({
      rcl: 4,
      spawns: [spawn as any],
      storage: undefined,
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.storage).toBe(true);
    expect(r.any).toBe(true);
  });

  it("storage 缺失但 RCL<4 → storage=false（未解锁不算紧急）", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const source = mockSource("src1");
    source.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const container = mockStructure("container", { id: "c1" });
    container.pos = { x: 21, y: 20, roomName: "W7N4" } as any; // source 旁 1 格
    const tower = mockStructure("tower", { id: "tw1" });
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [container as any],
      towers: [tower as any], // rcl=3 已解锁 tower，需提供以避免 tower 紧急
      storage: undefined,
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.storage).toBe(false);
    expect(r.any).toBe(false);
  });

  it("source 缺 container → sourceContainer=true", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const source = mockSource("src1");
    source.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [], // source 旁无 container
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.sourceContainer).toBe(true);
    expect(r.any).toBe(true);
  });

  it("source 旁有在建 container site → sourceContainer=false", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const source = mockSource("src1");
    source.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const site = {
      structureType: STRUCTURE_CONTAINER,
      pos: { x: 21, y: 20, roomName: "W7N4" },
    } as any;
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [],
      constructionSites: [site],
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.sourceContainer).toBe(false);
  });

  it("多源中任一缺 container → sourceContainer=true", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const src1 = mockSource("s1");
    src1.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const src2 = mockSource("s2");
    src2.pos = { x: 30, y: 30, roomName: "W7N4" } as any;
    const container1 = mockStructure("container", { id: "c1" });
    container1.pos = { x: 21, y: 20, roomName: "W7N4" } as any; // src1 旁有
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      sources: [src1 as any, src2 as any],
      containers: [container1 as any], // src2 旁缺
    });
    const r = assessEmergencyRebuild(snap);
    expect(r.sourceContainer).toBe(true);
    expect(r.any).toBe(true);
  });

  it("isEmergencyTask：紧急状态下 tower 任务被识别为紧急", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      towers: [],
    });
    const emergency = assessEmergencyRebuild(snap);
    expect(emergency.tower).toBe(true);

    const task: BuildTask = {
      key: "constraint.tower.25.25",
      pos: { x: 25, y: 25, roomName: "W7N4" },
      structureType: STRUCTURE_TOWER,
      priority: 0,
      state: "queued",
      attempts: 0,
      retryAt: 0,
    };
    expect(isEmergencyTask(task, snap, emergency)).toBe(true);
  });

  it("isEmergencyTask：非紧急状态下不误判", () => {
    const snap = healthySnapshot();
    const emergency = assessEmergencyRebuild(snap);
    expect(emergency.any).toBe(false);

    const task: BuildTask = {
      key: "constraint.extension.26.25",
      pos: { x: 26, y: 25, roomName: "W7N4" },
      structureType: STRUCTURE_EXTENSION,
      priority: 2,
      state: "queued",
      attempts: 0,
      retryAt: 0,
    };
    expect(isEmergencyTask(task, snap, emergency)).toBe(false);
  });
});

// ─── 3. recoveryEligible 钩子集成测试 ─────────────────────────

describe("P1-F.3 — layoutPlannerSystem.recoveryEligible 钩子", () => {
  it("无紧急情况时返回 false（常规 50-tick 重规划不享受恢复档豁免）", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const source = mockSource("src1");
    source.pos = { x: 20, y: 20, roomName: "W7N4" } as any;
    const container = mockStructure("container", { id: "c1" });
    container.pos = { x: 21, y: 20, roomName: "W7N4" } as any; // source 旁 1 格
    const snap = mockSnapshot({
      rcl: 4,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [container as any],
      towers: [mockStructure("tower") as any],
      storage: mockStructure("storage") as any,
    });
    const ctx = mockContext(snap);
    // CTO 裁决：常规重规划不再享受 recovery 档豁免 — 仅关键基建缺失时提升
    expect(layoutPlannerSystem.recoveryEligible!(ctx)).toBe(false);
  });

  it("任一 snapshot 命中紧急重建时返回 true（storage 缺失）", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const snap = mockSnapshot({
      rcl: 4,
      spawns: [spawn as any],
      towers: [mockStructure("tower") as any],
      storage: undefined, // 缺 storage → 紧急
    });
    const ctx = mockContext(snap);
    expect(layoutPlannerSystem.recoveryEligible!(ctx)).toBe(true);
  });

  it("spawn 缺失时返回 true（最严重的紧急状态）", () => {
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [], // 无 spawn
    });
    const ctx = mockContext(snap);
    expect(layoutPlannerSystem.recoveryEligible!(ctx)).toBe(true);
  });

  it("多 snapshot 中任一紧急即返回 true", () => {
    const healthySnap = mockSnapshot({
      roomName: "W1N1",
      rcl: 4,
      spawns: [mockStructure("spawn", { id: "sp1" }) as any],
      towers: [mockStructure("tower", { id: "tw1" }) as any],
      storage: mockStructure("storage", { id: "st1" }) as any,
    });
    const emergencySnap = mockSnapshot({
      roomName: "W2N1",
      rcl: 4,
      spawns: [mockStructure("spawn", { id: "sp2" }) as any],
      towers: [], // 缺塔
      storage: mockStructure("storage", { id: "st2" }) as any,
    });
    const ctx: TickContext = {
      tick: 1000,
      budget: mockBudget(),
      globalSiteCount: 0,
      getSnapshot: (name: string) =>
        name === "W1N1" ? healthySnap : name === "W2N1" ? emergencySnap : undefined,
      snapshots: vi.fn(function* () {
        yield healthySnap;
        yield emergencySnap;
      }),
    };
    expect(layoutPlannerSystem.recoveryEligible!(ctx)).toBe(true);
  });

  it("空 snapshots 返回 false", () => {
    const ctx: TickContext = {
      tick: 1000,
      budget: mockBudget(),
      globalSiteCount: 0,
      getSnapshot: () => undefined,
      snapshots: vi.fn(function* () {
        /* empty */
      }),
    };
    expect(layoutPlannerSystem.recoveryEligible!(ctx)).toBe(false);
  });
});

// ─── 4. planStage 状态机测试 ─────────────────────────────────

describe("P1-F.4 — planStage 4-stage 分片状态机", () => {
  /**
   * 构造最小可用 room + Memory + snapshot 三元组。
   *
   * 关键：anchor 预设为 spawn 位置 — 跳过 diagnoseAnchor 的重路径
   * （computeDistanceField + room.find(FIND_EXIT) + 诊断日志），
   * 使 stage 0 prep 聚焦于 shouldPlan 门禁 + planStageData 写入。
   *
   * 同时提供 source+container 对 — 避免 assessEmergencyRebuild 误判
   * sourceContainer 缺失触发紧急重建路径（干扰 shouldPlan 门禁测试）。
   */
  function setupRoom(opts: {
    roomName?: string;
    planStage?: 0 | 1 | 2 | 3;
    nextPlanTick?: number;
    spawnPos?: { x: number; y: number };
    rcl?: number;
    layoutState?: "proposed" | "accepted" | "building" | "blocked" | "manual";
  }) {
    const roomName = opts.roomName ?? "W7N4";
    const spawnPos = opts.spawnPos ?? { x: 25, y: 25 };
    const rcl = opts.rcl ?? 3;
    const anchor = packPos(spawnPos.x, spawnPos.y);

    // Game.rooms[name] — stage 0 prep 的 room.getTerrain/find 在 anchor 已设置时
    // 不被调用（diagnoseAnchor 只在 layout.anchor===undefined 时跑）。
    (globalThis as any).Game.rooms[roomName] = {
      name: roomName,
      getTerrain: () => ({ get: () => 0 }), // 无墙
      find: () => [],
    };

    // Memory.rooms[name] — layout + buildQueue
    (globalThis as any).Memory.rooms[roomName] = {
      layout: {
        version: 2,
        templateId: "compact-core-v2",
        state: opts.layoutState ?? "accepted",
        revision: 0,
        nextPlanTick: opts.nextPlanTick ?? 1000,
        planStage: opts.planStage ?? 0,
        anchor,
      },
      buildQueue: [],
    };

    // snapshot — spawn 位置匹配 anchor + source+container 对（避免紧急重建误判）
    const spawn = mockStructure("spawn", { id: `spawn_${roomName}` });
    spawn.pos = { x: spawnPos.x, y: spawnPos.y, roomName } as any;
    const source = mockSource(`src_${roomName}`);
    source.pos = { x: 20, y: 20, roomName } as any;
    const container = mockStructure("container", { id: `c_${roomName}` });
    container.pos = { x: 21, y: 20, roomName } as any; // source 旁 1 格
    const snap = mockSnapshot({
      roomName,
      rcl,
      spawns: [spawn as any],
      sources: [source as any],
      containers: [container as any],
      towers: rcl >= 3 ? [mockStructure("tower", { id: `tw_${roomName}` }) as any] : [],
      storage: rcl >= 4 ? mockStructure("storage", { id: `st_${roomName}` }) as any : undefined,
    });

    return { roomName, snap, spawnPos, anchor };
  }

  /** 手动构造 planStageData（模拟 stage 0 已完成、stages 1-3 待跑）。 */
  function writePlanStageData(roomName: string, anchor: { x: number; y: number }): void {
    (globalThis as any).__planStageData = {
      [roomName]: {
        startTick: 999,
        anchor,
        completedKeys: new Set<string>(),
        structureCounts: new Map<string, number>(),
        occupiedSet: new Set<number>(),
        obstacleSet: new Set<number>(),
        minerals: [],
        validationOptions: {
          completedKeys: new Set<string>(),
          globalSiteCount: 0,
          maxGlobalSites: CONFIG.construction.maxGlobalSites,
          minerals: [],
          structureCounts: new Map<string, number>(),
          occupiedSet: new Set<number>(),
          obstacleSet: new Set<number>(),
        },
        segBlocked: {},
        existingKeys: new Set<string>(),
        existingPositions: new Set<string>(),
        tasksAdded: false,
        targetingChanged: false,
        queuedLinks: 0,
      },
    };
  }

  // ── stage 0 门禁 ──

  it("stage 0 + shouldPlan=false（nextPlanTick 未到期）→ 不推进", () => {
    const { snap } = setupRoom({ nextPlanTick: 2000 }); // 未来才到期
    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(0); // 未推进
    expect(layout.state).toBe("accepted"); // 未进入 building
    // planStageData 不应被写入
    expect((globalThis as any).__planStageData?.W7N4).toBeUndefined();
  });

  it("stage 0 + layout.state='manual' → 直接返回不规划", () => {
    const { snap } = setupRoom({
      nextPlanTick: 1000, // 到期
      layoutState: "manual",
    });
    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(0); // manual 状态不规划
    expect(layout.state).toBe("manual");
  });

  // ── stage 0 → stage 1 转换 ──

  it("stage 0 + shouldPlan=true（nextPlanTick 到期）→ 推进到 stage 1 + 写 planStageData", () => {
    const { snap, spawnPos } = setupRoom({ nextPlanTick: 1000 }); // 当 tick 到期
    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(1); // 推进到 stage 1
    expect(layout.state).toBe("building"); // 进入 building 状态

    // planStageData 写入 globalCache（不进 Memory — plan §7 大对象不持久化）
    const stageData = (globalThis as any).__planStageData?.W7N4;
    expect(stageData).toBeDefined();
    expect(stageData.startTick).toBe(1000);
    expect(stageData.anchor).toEqual({ x: spawnPos.x, y: spawnPos.y });
    expect(stageData.existingKeys).toBeInstanceOf(Set);
    expect(stageData.occupiedSet).toBeInstanceOf(Set);
    expect(stageData.tasksAdded).toBe(false);
    expect(stageData.targetingChanged).toBe(false);
  });

  it("stage 0 + layout.state='proposed' → 立即触发规划（不等 nextPlanTick）", () => {
    const { snap } = setupRoom({
      nextPlanTick: 2000, // 未来才到期
      layoutState: "proposed", // 人工 proposed 状态立即规划
    });
    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(1); // proposed 触发推进
    expect(layout.state).toBe("building");
  });

  // ── global reset 恢复路径 ──

  it("global reset 丢失 planStageData：planStage>0 但无 data → 重置为 0", () => {
    // 模拟 global reset 后：planStage 卡在 stage 2，但 planStageData 丢失
    const { snap } = setupRoom({
      planStage: 2,
      nextPlanTick: 1000,
    });
    // 不写入 __planStageData（模拟 global reset 丢失）
    delete (globalThis as any).__planStageData;

    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(0); // 重置为 0
    // 本 tick 不执行 stage 2 逻辑，下 tick 从 stage 0 重新开始
    // 最多损失一个规划周期（plan.md §P1-F 风险评估）
  });

  it("global reset 恢复对 stage 1 同样生效", () => {
    const { snap } = setupRoom({
      planStage: 1,
      nextPlanTick: 1000,
    });
    delete (globalThis as any).__planStageData;

    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(0); // stage 1 无 data 同样重置
  });

  it("global reset 恢复对 stage 3 同样生效", () => {
    const { snap } = setupRoom({
      planStage: 3,
      nextPlanTick: 1000,
    });
    delete (globalThis as any).__planStageData;

    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(0); // stage 3 无 data 同样重置
  });

  // ── stage 1 → stage 2 转换 ──

  it("stage 1 + data 存在 → 推进到 stage 2（constraint placer 运行）", () => {
    const { snap, spawnPos, anchor } = setupRoom({
      planStage: 1,
      nextPlanTick: 1000,
    });
    writePlanStageData("W7N4", spawnPos);

    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    // stage 1 执行后应推进到 stage 2 — constraint placer 在无墙地形上能正常放置
    expect(layout.planStage).toBe(2);
    // planStageData 仍在 globalCache（stage 2 还要消费）
    expect((globalThis as any).__planStageData?.W7N4).toBeDefined();
    void anchor;
  });

  // ── stage 2 → stage 3 转换 ──

  it("stage 2 + data 存在 → 推进到 stage 3（物流结构规划）", () => {
    const { snap, spawnPos } = setupRoom({
      planStage: 2,
      nextPlanTick: 1000,
      rcl: 3,
    });
    writePlanStageData("W7N4", spawnPos);

    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(3); // 推进到 stage 3
  });

  // ── stage 3 → stage 0 收尾 ──

  it("stage 3 + data 存在 → 收尾重置 planStage=0 + 清 planStageData", () => {
    const { snap, spawnPos } = setupRoom({
      planStage: 3,
      nextPlanTick: 1000,
      rcl: 3,
    });
    writePlanStageData("W7N4", spawnPos);

    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    // stage 3 收尾：planStage 回到 0，planStageData 清除
    expect(layout.planStage).toBe(0);
    expect((globalThis as any).__planStageData?.W7N4).toBeUndefined();

    // nextPlanTick 更新为 ctx.tick + planInterval + roomPhase（P1-F 相位偏移）
    const expectedNext = ctx.tick + CONFIG.layout.planInterval + roomPhase("W7N4", CONFIG.layout.planInterval);
    expect(layout.nextPlanTick).toBe(expectedNext);
  });

  // ── 完整 4-stage 链路（跨 tick 模拟）──

  it("完整 4-stage 链路：stage 0→1→2→3→0，每 tick 推进一个 stage", () => {
    const { snap, spawnPos } = setupRoom({
      planStage: 0,
      nextPlanTick: 1000,
      rcl: 3,
    });

    // tick 1: stage 0 → 1
    const ctx1 = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx1);
    expect((globalThis as any).Memory.rooms.W7N4.layout.planStage).toBe(1);

    // tick 2: stage 1 → 2
    (globalThis as any).Game.time = 1001;
    const ctx2 = {
      ...mockContext(snap),
      tick: 1001,
    };
    layoutPlannerSystem.planRoom(snap, ctx2);
    expect((globalThis as any).Memory.rooms.W7N4.layout.planStage).toBe(2);

    // tick 3: stage 2 → 3
    (globalThis as any).Game.time = 1002;
    const ctx3 = {
      ...mockContext(snap),
      tick: 1002,
    };
    layoutPlannerSystem.planRoom(snap, ctx3);
    expect((globalThis as any).Memory.rooms.W7N4.layout.planStage).toBe(3);

    // tick 4: stage 3 → 0（收尾）
    (globalThis as any).Game.time = 1003;
    const ctx4 = {
      ...mockContext(snap),
      tick: 1003,
    };
    layoutPlannerSystem.planRoom(snap, ctx4);
    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.planStage).toBe(0);
    expect((globalThis as any).__planStageData?.W7N4).toBeUndefined();
    // nextPlanTick 包含 P1-F 相位偏移
    expect(layout.nextPlanTick).toBe(1003 + CONFIG.layout.planInterval + roomPhase("W7N4", CONFIG.layout.planInterval));
    void spawnPos;
  });
});
