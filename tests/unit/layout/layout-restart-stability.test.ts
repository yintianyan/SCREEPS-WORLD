/**
 * 布局系统重开稳定性测试（docs/layout-system-design-2026-08.md §3.9 / §5.2）。
 *
 * 核心原则（§3.9）：
 *   布局决策必须可从「地形 + 锚点 + RCL」完全重推导，不依赖运行时状态。
 *
 * Global Reset 影响矩阵（§3.9 表格，仅列本文覆盖的 heap 字段）：
 *   - deadAssetSince      → 丢失 → 从 0 重新检测（500t 内不拆改，可接受避免抖动）
 *   - linkConstrained     → 丢失 → 重新评估一次（开销可忽略）
 *   - dismantlePlans      → 丢失 → 死资产重新检测 + 重新规划拆改
 *   - dismantleCount      → 丢失 → 从 0 重新计数（不影响死资产检测/拆改逻辑）
 *   - corridorPathCache   → 丢失 → 重新计算（已由 corridor-cache-invalidation.test.ts 覆盖）
 *   - planStageData       → 丢失 → 重置 planStage=0（已由 layout-planner.test.ts 覆盖）
 *
 * 验证策略：
 *   1. 建立「重置前」状态（写入 heap 缓存）
 *   2. 模拟 global reset（清空对应 heap 字段）
 *   3. 验证「重置后」行为符合设计预期（不报错、降级安全、可重建）
 *   4. 验证 layout-planner 从 Memory.layout.anchor 重新规划路径正确
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeDeadAssetSince,
  getDeadAssetLinks,
  isLinkConstrained,
  markLinkConstrained,
  DEAD_ASSET_THRESHOLD,
  getDismantlePlans,
  createDismantlePlan,
  isDismantleOnCooldown,
  DISMANTLE_COOLDOWN,
  LINK_CONSTRAINED_RETRY_INTERVAL,
} from "../../../src/systems/link-system";
import type { LinkInfo } from "../../../src/domain/economy/links";
import { layoutPlannerSystem } from "../../../src/systems/layout-planner";
import { globalCache } from "../../../src/kernel/global-cache";
import { packPos } from "../../../src/domain/layout/types";
import { CONFIG } from "../../../src/config";
import {
  resetGlobals,
  mockSnapshot,
  mockStructure,
  mockSource,
  mockContext,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  // segment-store 缓存重置（layout-planner 依赖 getRoomLayoutData）
  delete (globalThis as any).__segStore;
  // RawMemory mock（segment-store 读取所需）
  (globalThis as any).RawMemory = { segments: {}, setActiveSegments: () => {} };
});

// ─── 辅助工厂 ───────────────────────────────────────────────

/** 构造 LinkInfo（死资产检测的输入）。 */
function linkInfo(id: string, role: LinkInfo["role"], energy = 0): LinkInfo {
  return {
    id,
    energy,
    energyCapacity: 800,
    cooldown: 0,
    role,
  };
}

/** 模拟 global reset：清空所有 layout 相关 heap 字段。 */
function simulateGlobalReset(): void {
  const g = globalThis as any;
  delete g.deadAssetSince;
  delete g.linkConstrained;
  delete g.dismantlePlans;
  delete g.lastDismantleTick;
  delete g.dismantleCount;
  delete g.corridorPathCache;
  delete g.__planStageData;
}

// ─── 1. deadAssetSince 丢失 → 重新从 0 计时 ──────────────────

describe("重开稳定性 — deadAssetSince 丢失", () => {
  it("global reset 后 computeDeadAssetSince 收到空 prevSince → 重新记录当前 tick", () => {
    const tick = 1000;
    // 死资产 source link：role=source + energy=0 + 无 outlet（无 controller/storage link）。
    const infos = [linkInfo("link_dead", "source", 0)];

    // 重置前：已积累 400t 计时（未达 500t 阈值，还不是死资产）。
    const prevSince = new Map([["link_dead", 600]]);
    const beforeReset = computeDeadAssetSince(infos, tick, prevSince);
    expect(beforeReset.get("link_dead")).toBe(600); // 沿用已有 tick

    // global reset：deadAssetSince 丢失 → prevSince 为空 Map。
    const afterReset = computeDeadAssetSince(infos, tick, new Map());
    expect(afterReset.get("link_dead")).toBe(tick); // 重新记录当前 tick
  });

  it("global reset 后 getDeadAssetLinks 返回空（未达阈值，不误判死资产）", () => {
    const tick = 1000;
    // 重置前：link 已积累 600t（超过 500t 阈值）→ 是死资产。
    const cache = globalCache();
    cache.deadAssetSince = new Map([["link_dead", 400]]);
    expect(getDeadAssetLinks(tick)).toEqual(["link_dead"]);

    // global reset：deadAssetSince 丢失。
    simulateGlobalReset();

    // 重置后：deadAssetSince 为空 → 返回空数组（不误判）。
    expect(getDeadAssetLinks(tick)).toEqual([]);

    // 重新积累计时（模拟 link-system 每 tick 调用）。
    const infos = [linkInfo("link_dead", "source", 0)];
    const cache2 = globalCache();
    cache2.deadAssetSince = computeDeadAssetSince(infos, tick, cache2.deadAssetSince ?? new Map());
    // 首次记录 tick = 1000，需再过 500t 才会被判定为死资产。
    expect(getDeadAssetLinks(tick)).toEqual([]);
    expect(getDeadAssetLinks(tick + DEAD_ASSET_THRESHOLD)).toEqual(["link_dead"]);
  });
});

// ─── 2. linkConstrained 丢失 → 重新评估 ──────────────────────

describe("重开稳定性 — linkConstrained 丢失", () => {
  it("global reset 后 isLinkConstrained 返回 false（重新评估）", () => {
    const roomName = "W3N7";
    const tick = 1000;

    // 重置前：标记 link 几何受限。
    markLinkConstrained(roomName, tick);
    expect(isLinkConstrained(roomName, tick)).toBe(true);

    // global reset：linkConstrained 丢失。
    simulateGlobalReset();

    // 重置后：标记丢失 → isLinkConstrained 返回 false → 房间可重新尝试 link 放置。
    expect(isLinkConstrained(roomName, tick)).toBe(false);
  });

  it("重置后重新标记 → 正常工作（状态可重建）", () => {
    const roomName = "W3N7";
    const tick = 1000;

    simulateGlobalReset();

    // 重置后重新标记 → 标记生效（状态可重建，开销可忽略）。
    markLinkConstrained(roomName, tick);
    expect(isLinkConstrained(roomName, tick)).toBe(true);
    // 过期后自动失效。
    expect(isLinkConstrained(roomName, tick + LINK_CONSTRAINED_RETRY_INTERVAL)).toBe(false);
  });
});

// ─── 3. dismantlePlans 丢失 → 死资产重新检测 + 重新规划 ──────

describe("重开稳定性 — dismantlePlans 丢失", () => {
  it("global reset 后 getDismantlePlans 返回空 Map（计划丢失，需重新规划）", () => {
    const tick = 1000;

    // 重置前：创建拆改计划。
    createDismantlePlan("link_dead", "W3N7", "link.W3N7.20.41", { x: 20, y: 41 }, tick);
    const beforeReset = getDismantlePlans();
    expect(beforeReset.size).toBe(1);

    // global reset：dismantlePlans 丢失。
    simulateGlobalReset();

    // 重置后：getDismantlePlans 返回空 Map → construction-manager 无计划可执行。
    const afterReset = getDismantlePlans();
    expect(afterReset.size).toBe(0);
  });

  it("global reset 后 isDismantleOnCooldown 返回 false（冷却丢失，可重新启动）", () => {
    const roomName = "W3N7";
    const tick = 1000;

    // 重置前：启动拆改 → 进入冷却。
    createDismantlePlan("link_dead", roomName, "link.W3N7.20.41", { x: 20, y: 41 }, tick);
    expect(isDismantleOnCooldown(roomName, tick)).toBe(true);

    // global reset：lastDismantleTick 丢失。
    simulateGlobalReset();

    // 重置后：冷却丢失 → isDismantleOnCooldown 返回 false → 可重新启动拆改。
    expect(isDismantleOnCooldown(roomName, tick)).toBe(false);
  });

  it("重置后重新创建拆改计划 → 正常工作（状态可重建）", () => {
    const tick = 1000;
    simulateGlobalReset();

    // 重置后重新创建拆改计划 → 正常登记。
    createDismantlePlan("link_dead", "W3N7", "link.W3N7.20.41", { x: 20, y: 41 }, tick);
    const plans = getDismantlePlans();
    expect(plans.size).toBe(1);
    const plan = plans.get("link_dead")!;
    expect(plan.deadLinkId).toBe("link_dead");
    expect(plan.state).toBe("waiting");
    expect(plan.expiresAt).toBe(tick + 1500); // DISMANTLE_TTL
  });
});

// ─── 4. dismantleCount 丢失 → 从 0 重新计数 ──────────────────

describe("重开稳定性 — dismantleCount 丢失", () => {
  it("global reset 后 dismantleCount 丢失 → 从 0 重新计数（可接受）", () => {
    const tick = 1000;
    const roomName = "W3N7";

    // 重置前：累计 3 次拆改。
    createDismantlePlan("link1", roomName, "key1", { x: 20, y: 41 }, tick);
    createDismantlePlan("link2", roomName, "key2", { x: 21, y: 41 }, tick);
    createDismantlePlan("link3", roomName, "key3", { x: 22, y: 41 }, tick);
    const beforeReset = globalCache().dismantleCount?.get(roomName) ?? 0;
    expect(beforeReset).toBe(3);

    // global reset：dismantleCount 丢失。
    simulateGlobalReset();

    // 重置后：dismantleCount 不存在 → 从 0 重新计数。
    expect(globalCache().dismantleCount?.get(roomName) ?? 0).toBe(0);

    // 重新创建 1 次拆改 → 计数从 1 开始。
    createDismantlePlan("link1", roomName, "key1", { x: 20, y: 41 }, tick);
    expect(globalCache().dismantleCount?.get(roomName)).toBe(1);
  });
});

// ─── 5. layout-planner 从 Memory.layout.anchor 重新规划 ──────

describe("重开稳定性 — layout-planner 从 Memory 重新规划", () => {
  /**
   * 构造最小可用 room + Memory + snapshot 三元组（复用 layout-planner.test.ts 模式）。
   *
   * 关键：anchor 预设为 spawn 位置 — 模拟 global reset 后 Memory.layout.anchor
   * 仍在（持久化），layout-planner 可据此重新规划，不依赖 heap 缓存。
   */
  function setupRoomWithAnchor(opts: {
    spawnPos?: { x: number; y: number };
    rcl?: number;
    nextPlanTick?: number;
  }) {
    const roomName = "W7N4";
    const spawnPos = opts.spawnPos ?? { x: 25, y: 25 };
    const rcl = opts.rcl ?? 3;
    const anchor = packPos(spawnPos.x, spawnPos.y);

    (globalThis as any).Game.rooms[roomName] = {
      name: roomName,
      getTerrain: () => ({ get: () => 0 }),
      find: () => [],
    };

    const layout: any = {
      version: 2,
      templateId: "compact-core-v2",
      state: "accepted",
      revision: 0,
      nextPlanTick: opts.nextPlanTick ?? 1000,
      planStage: 0,
      anchor,
    };
    (globalThis as any).Memory.rooms[roomName] = { layout, buildQueue: [] };

    const spawn = mockStructure("spawn", { id: `spawn_${roomName}` });
    spawn.pos = { x: spawnPos.x, y: spawnPos.y, roomName } as any;
    const source = mockSource(`src_${roomName}`);
    source.pos = { x: 20, y: 20, roomName } as any;
    const container = mockStructure("container", { id: `c_${roomName}` });
    container.pos = { x: 21, y: 20, roomName } as any;
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

  it("global reset 后 planStageData 丢失 → planStage 重置为 0 → 重新规划", () => {
    // 重置前：正常规划一轮（planStage 推进到 1 + planStageData 写入）。
    const { snap } = setupRoomWithAnchor({ nextPlanTick: 1000 });
    const ctx = mockContext(snap);
    layoutPlannerSystem.planRoom(snap, ctx);

    const layoutBefore = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layoutBefore.planStage).toBe(1); // 推进到 stage 1
    expect((globalThis as any).__planStageData?.W7N4).toBeDefined(); // planStageData 已写入

    // global reset：planStageData 丢失，但 Memory.layout 保留。
    simulateGlobalReset();
    // 模拟 planStage 卡在 stage 2（global reset 后首 tick 的状态）。
    layoutBefore.planStage = 2;

    // 重置后：planStage>0 但无 planStageData → 重置为 0。
    layoutPlannerSystem.planRoom(snap, ctx);
    const layoutAfter = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layoutAfter.planStage).toBe(0); // 重置为 0

    // 下 tick 从 stage 0 重新开始 — anchor 仍从 Memory.layout.anchor 读取（不需重算）。
    layoutPlannerSystem.planRoom(snap, ctx);
    expect(layoutAfter.planStage).toBe(1); // 重新推进到 stage 1
    expect((globalThis as any).__planStageData?.W7N4).toBeDefined(); // planStageData 重新写入
  });

  it("global reset 后 anchor 仍从 Memory.layout.anchor 恢复（不依赖 heap）", () => {
    // 重置前：layout.anchor 已写入 Memory（stage 0 prep 时从 spawn 位置设置）。
    const { snap, spawnPos } = setupRoomWithAnchor({ nextPlanTick: 1000 });
    const expectedAnchor = packPos(spawnPos.x, spawnPos.y);

    // global reset：所有 heap 丢失，但 Memory.layout.anchor 保留。
    simulateGlobalReset();

    // 重置后：layout-planner 仍能从 Memory.layout.anchor 读取锚点。
    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.anchor).toBe(expectedAnchor);

    // 重新规划不报错 — anchor 不需重算（spawn 位置仍是 anchor 来源）。
    const ctx = mockContext(snap);
    expect(() => layoutPlannerSystem.planRoom(snap, ctx)).not.toThrow();
  });

  it("global reset 后 buildQueue 仍保留（Memory 持久化，不丢失）", () => {
    const { snap } = setupRoomWithAnchor({ nextPlanTick: 1000 });

    // 重置前：运行完整 4-stage 规划周期（stage 0→1→2→3），buildQueue 写入任务。
    const ctx = mockContext(snap);
    for (let i = 0; i < 5; i++) {
      layoutPlannerSystem.planRoom(snap, ctx);
    }
    const queueBefore = (globalThis as any).Memory.rooms.W7N4.buildQueue;
    expect(queueBefore.length).toBeGreaterThan(0);

    // global reset：heap 丢失，但 Memory.buildQueue 保留。
    simulateGlobalReset();

    // 重置后：buildQueue 仍在（持久化）。
    const queueAfter = (globalThis as any).Memory.rooms.W7N4.buildQueue;
    expect(queueAfter).toEqual(queueBefore); // 同一引用（Memory 未被清空）
    expect(queueAfter.length).toBe(queueBefore.length);
  });
});

// ─── 6. Layout 决策一致性 ───────────────────────────────────

describe("重开稳定性 — Layout 决策一致性", () => {
  /**
   * 核心原则（§3.9）：布局决策必须可从「地形 + 锚点 + RCL」完全重推导。
   *
   * 验证：相同 anchor + RCL + 地形 → 重启前后产生相同的 buildQueue 任务集
   * （key 集合一致）。这是「无状态重启」的根本保证 — heap 缓存只是性能优化，
   * 不影响决策结果。
   */
  it("相同 anchor + RCL → 重启前后 buildQueue 任务 key 集合一致", () => {
    const roomName = "W7N4";
    const spawnPos = { x: 25, y: 25 };
    const anchor = packPos(spawnPos.x, spawnPos.y);

    function setupAndPlan(): string[] {
      (globalThis as any).Game.rooms[roomName] = {
        name: roomName,
        getTerrain: () => ({ get: () => 0 }),
        find: () => [],
      };
      (globalThis as any).Memory.rooms[roomName] = {
        layout: {
          version: 2,
          templateId: "compact-core-v2",
          state: "accepted",
          revision: 0,
          nextPlanTick: 1000,
          planStage: 0,
          anchor,
        },
        buildQueue: [],
      };
      const spawn = mockStructure("spawn", { id: `spawn_${roomName}` });
      spawn.pos = { x: spawnPos.x, y: spawnPos.y, roomName } as any;
      const source = mockSource(`src_${roomName}`);
      source.pos = { x: 20, y: 20, roomName } as any;
      const container = mockStructure("container", { id: `c_${roomName}` });
      container.pos = { x: 21, y: 20, roomName } as any;
      const snap = mockSnapshot({
        roomName,
        rcl: 3,
        spawns: [spawn as any],
        sources: [source as any],
        containers: [container as any],
        towers: [mockStructure("tower", { id: `tw_${roomName}` }) as any],
      });
      const ctx = mockContext(snap);
      layoutPlannerSystem.planRoom(snap, ctx);

      // 运行到 stage 3 完成（4-stage 分片需 4 tick）。
      for (let i = 0; i < 4; i++) {
        layoutPlannerSystem.planRoom(snap, ctx);
      }
      return ((globalThis as any).Memory.rooms[roomName].buildQueue as any[])
        .map(t => t.key)
        .sort();
    }

    // 重置前：规划一轮，记录 buildQueue key 集合。
    const beforeReset = setupAndPlan();

    // global reset：所有 heap 丢失。
    simulateGlobalReset();

    // 重置后：重新规划，对比 key 集合。
    const afterReset = setupAndPlan();

    // 核心断言：相同 anchor + RCL + 地形 → 相同的 buildQueue 任务 key 集合。
    // heap 缓存（planStageData/corridorPathCache 等）只是性能优化，不影响决策结果。
    expect(afterReset).toEqual(beforeReset);
  });
});
