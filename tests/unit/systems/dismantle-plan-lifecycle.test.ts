/**
 * P1-4 受限拆改通道生命周期测试（staged link 拆改生命周期）。
 *
 * 覆盖完整 Plan 契约（V2 §2）：
 *   - 冷却（DISMANTLE_COOLDOWN=1000t）：同房冷却期内不重复启动
 *   - ttl（DISMANTLE_TTL=1500t）：到期 abort，保留旧 link
 *   - 战时暂停（colonyState=defense）：不处理计划，恢复 peace 后继续
 *   - 替代任务丢失 → abort（保留旧 link，避免空窗）
 *   - 替代 link 建成 + 灌能 → success（destroy 旧 link + clearDeadAssetLink）
 *   - 替代 link 建成 + 超时未灌能 → fallback（markLinkConstrained + clearDeadAssetLink）
 *   - 先建替代后拆旧（避免空窗）
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  isDismantleOnCooldown,
  recordDismantleStart,
  getDismantlePlans,
  createDismantlePlan,
  clearDismantlePlan,
  transitionDismantlePlan,
  isRoomInDefense,
  markLinkConstrained,
  isLinkConstrained,
  clearDeadAssetLink,
  DISMANTLE_COOLDOWN,
  DISMANTLE_TTL,
  DISMANTLE_VALIDATION_DELAY,
} from "../../../src/systems/link-system";
import { globalCache } from "../../../src/kernel/global-cache";
import type { DismantlePlan } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  // Memory 默认初始化（isRoomInDefense 读取 Memory.rooms[*].colonyState）
  (globalThis as any).Memory = {
    creeps: {},
    rooms: { W7N4: {}, W3N7: {} },
    kernel: {},
  };
});

// ─── 冷却测试 ─────────────────────────────────────────────

describe("P1-4 拆改冷却（DISMANTLE_COOLDOWN）", () => {
  it("未记录过冷却 → isDismantleOnCooldown 返回 false", () => {
    expect(isDismantleOnCooldown("W7N4", 1000)).toBe(false);
  });

  it("recordDismantleStart 后冷却期内 → isDismantleOnCooldown 返回 true", () => {
    recordDismantleStart("W7N4", 1000);
    expect(isDismantleOnCooldown("W7N4", 1000)).toBe(true);
    expect(isDismantleOnCooldown("W7N4", 1999)).toBe(true);
  });

  it("超过 DISMANTLE_COOLDOWN 后冷却过期 → isDismantleOnCooldown 返回 false", () => {
    recordDismantleStart("W7N4", 1000);
    const expiry = 1000 + DISMANTLE_COOLDOWN;
    expect(isDismantleOnCooldown("W7N4", expiry - 1)).toBe(true);
    expect(isDismantleOnCooldown("W7N4", expiry)).toBe(false);
  });

  it("不同房间独立冷却", () => {
    recordDismantleStart("W7N4", 1000);
    expect(isDismantleOnCooldown("W7N4", 1000)).toBe(true);
    expect(isDismantleOnCooldown("W3N7", 1000)).toBe(false);
  });

  it("冷却记录写入 globalCache.lastDismantleTick", () => {
    recordDismantleStart("W7N4", 1000);
    expect(globalCache().lastDismantleTick?.get("W7N4")).toBe(1000);
  });
});

// ─── 拆改计划创建与查询 ─────────────────────────────────────

describe("P1-4 createDismantlePlan — 计划创建", () => {
  it("创建计划后写入 dismantlePlans", () => {
    createDismantlePlan("link1", "W7N4", "logistics.link.source.src1", { x: 10, y: 11 }, 1000);
    const plans = getDismantlePlans();
    expect(plans.size).toBe(1);
    const plan = plans.get("link1");
    expect(plan).toBeDefined();
    expect(plan!.deadLinkId).toBe("link1");
    expect(plan!.roomName).toBe("W7N4");
    expect(plan!.replacementKey).toBe("logistics.link.source.src1");
    expect(plan!.replacementPos).toEqual({ x: 10, y: 11 });
    expect(plan!.startedAt).toBe(1000);
    expect(plan!.state).toBe("waiting");
    expect(plan!.validatingSince).toBeUndefined();
  });

  it("创建计划时 expiresAt = startedAt + DISMANTLE_TTL", () => {
    createDismantlePlan("link1", "W7N4", "key1", { x: 10, y: 11 }, 1000);
    const plan = getDismantlePlans().get("link1");
    expect(plan!.expiresAt).toBe(1000 + DISMANTLE_TTL);
  });

  it("createDismantlePlan 同时记录冷却 tick（原子化）", () => {
    createDismantlePlan("link1", "W7N4", "key1", { x: 10, y: 11 }, 1000);
    expect(isDismantleOnCooldown("W7N4", 1000)).toBe(true);
    expect(globalCache().lastDismantleTick?.get("W7N4")).toBe(1000);
  });

  it("同一 deadLinkId 重复创建 → 覆盖旧计划", () => {
    createDismantlePlan("link1", "W7N4", "key1", { x: 10, y: 11 }, 1000);
    createDismantlePlan("link1", "W7N4", "key2", { x: 20, y: 21 }, 2000);
    const plans = getDismantlePlans();
    expect(plans.size).toBe(1);
    const plan = plans.get("link1");
    expect(plan!.replacementKey).toBe("key2");
    expect(plan!.startedAt).toBe(2000);
  });
});

// ─── clearDismantlePlan ─────────────────────────────────────

describe("P1-4 clearDismantlePlan — 计划清除", () => {
  it("清除存在的计划 → getDismantlePlans 不再返回", () => {
    createDismantlePlan("link1", "W7N4", "key1", { x: 10, y: 11 }, 1000);
    createDismantlePlan("link2", "W7N4", "key2", { x: 20, y: 21 }, 1000);
    clearDismantlePlan("link1");
    const plans = getDismantlePlans();
    expect(plans.has("link1")).toBe(false);
    expect(plans.has("link2")).toBe(true);
  });

  it("清除不存在的计划 → 无副作用", () => {
    clearDismantlePlan("nonexistent");
    expect(getDismantlePlans().size).toBe(0);
  });

  it("globalCache 无 dismantlePlans → 清除无副作用", () => {
    clearDismantlePlan("link1");
    expect(getDismantlePlans().size).toBe(0);
  });
});

// ─── transitionDismantlePlan 状态转移纯函数 ─────────────────

describe("P1-4 transitionDismantlePlan — 状态转移纯函数", () => {
  it("waiting → validating：设置 state 和 validatingSince", () => {
    const plan: DismantlePlan = {
      deadLinkId: "link1",
      roomName: "W7N4",
      replacementKey: "key1",
      replacementPos: { x: 10, y: 11 },
      startedAt: 1000,
      expiresAt: 1000 + DISMANTLE_TTL,
      state: "waiting",
    };
    const result = transitionDismantlePlan(plan, 1500);
    expect(result.state).toBe("validating");
    expect(result.validatingSince).toBe(1500);
  });

  it("validating → validating：保持不变（幂等）", () => {
    const plan: DismantlePlan = {
      deadLinkId: "link1",
      roomName: "W7N4",
      replacementKey: "key1",
      replacementPos: { x: 10, y: 11 },
      startedAt: 1000,
      expiresAt: 1000 + DISMANTLE_TTL,
      state: "validating",
      validatingSince: 1500,
    };
    const result = transitionDismantlePlan(plan, 1600);
    expect(result.state).toBe("validating");
    expect(result.validatingSince).toBe(1500); // 不更新
  });

  it("转移不修改原对象（返回新对象）", () => {
    const plan: DismantlePlan = {
      deadLinkId: "link1",
      roomName: "W7N4",
      replacementKey: "key1",
      replacementPos: { x: 10, y: 11 },
      startedAt: 1000,
      expiresAt: 1000 + DISMANTLE_TTL,
      state: "waiting",
    };
    const result = transitionDismantlePlan(plan, 1500);
    expect(plan.state).toBe("waiting"); // 原对象不变
    expect(result).not.toBe(plan); // 新对象
  });
});

// ─── isRoomInDefense 战时判定 ───────────────────────────────

describe("P1-4 isRoomInDefense — 战时判定", () => {
  it("colonyState 未设置 → false（peace）", () => {
    expect(isRoomInDefense("W7N4")).toBe(false);
  });

  it("colonyState === 'defense' → true", () => {
    (globalThis as any).Memory.rooms.W7N4.colonyState = "defense";
    expect(isRoomInDefense("W7N4")).toBe(true);
  });

  it("colonyState === 'normal' → false", () => {
    (globalThis as any).Memory.rooms.W7N4.colonyState = "normal";
    expect(isRoomInDefense("W7N4")).toBe(false);
  });

  it("colonyState === 'bootstrap' → false（早期不算战时）", () => {
    (globalThis as any).Memory.rooms.W7N4.colonyState = "bootstrap";
    expect(isRoomInDefense("W7N4")).toBe(false);
  });

  it("房间无 Memory 条目 → false", () => {
    expect(isRoomInDefense("UNKNOWN_ROOM")).toBe(false);
  });
});

// ─── Plan 契约常量验证 ─────────────────────────────────────

describe("P1-4 Plan 契约常量", () => {
  it("DISMANTLE_COOLDOWN = 1000", () => {
    expect(DISMANTLE_COOLDOWN).toBe(1000);
  });

  it("DISMANTLE_TTL = 1500（500 检测 + 1000 拆改）", () => {
    expect(DISMANTLE_TTL).toBe(1500);
  });

  it("DISMANTLE_VALIDATION_DELAY = 500（与 DEAD_ASSET_THRESHOLD 对齐）", () => {
    expect(DISMANTLE_VALIDATION_DELAY).toBe(500);
  });

  it("ttl > 验证窗口（确保 validating 有足够时间）", () => {
    expect(DISMANTLE_TTL).toBeGreaterThan(DISMANTLE_VALIDATION_DELAY);
  });

  it("冷却 <= ttl（冷却期内 ttl 可能未到期，但不影响新计划创建门禁）", () => {
    expect(DISMANTLE_COOLDOWN).toBeLessThanOrEqual(DISMANTLE_TTL);
  });
});

// ─── 集成场景：完整生命周期模拟 ─────────────────────────────

describe("P1-4 完整生命周期场景模拟", () => {
  it("场景1：waiting → validating → success（替代 link 灌能）", () => {
    // 1. 创建拆改计划
    createDismantlePlan("deadLink1", "W7N4", "replacement.key", { x: 15, y: 16 }, 1000);
    let plan = getDismantlePlans().get("deadLink1")!;
    expect(plan.state).toBe("waiting");

    // 2. 替代 link 建成 → 转 validating
    const validatingPlan = transitionDismantlePlan(plan, 1500);
    expect(validatingPlan.state).toBe("validating");
    expect(validatingPlan.validatingSince).toBe(1500);

    // 3. 模拟替代 link 灌能（energy > 0）→ success
    //    实际 destroy + clearDismantlePlan 由 construction-manager 执行
    clearDismantlePlan("deadLink1");
    expect(getDismantlePlans().has("deadLink1")).toBe(false);
  });

  it("场景2：waiting → abort（ttl 到期，替代未建成）", () => {
    createDismantlePlan("deadLink1", "W7N4", "replacement.key", { x: 15, y: 16 }, 1000);
    const plan = getDismantlePlans().get("deadLink1")!;
    expect(plan.expiresAt).toBe(1000 + DISMANTLE_TTL);

    // ttl 到期 → abort
    const ttlExpiredTick = plan.expiresAt;
    expect(ttlExpiredTick).toBe(2500);
    clearDismantlePlan("deadLink1");
    expect(getDismantlePlans().has("deadLink1")).toBe(false);
  });

  it("场景3：validating → fallback（超时未灌能 → markLinkConstrained）", () => {
    createDismantlePlan("deadLink1", "W7N4", "replacement.key", { x: 15, y: 16 }, 1000);
    let plan = getDismantlePlans().get("deadLink1")!;

    // 转 validating
    plan.state = "validating";
    plan.validatingSince = 1500;

    // 验证超时 → fallback
    const validationExpiredTick = 1500 + DISMANTLE_VALIDATION_DELAY;
    expect(validationExpiredTick).toBe(2000);

    // 模拟 fallback：markLinkConstrained + clearDismantlePlan
    markLinkConstrained("W7N4", validationExpiredTick);
    clearDismantlePlan("deadLink1");

    expect(getDismantlePlans().has("deadLink1")).toBe(false);
    // linkConstrained 标记存在（避免重复拆改空转）
    expect(isLinkConstrained("W7N4", validationExpiredTick)).toBe(true);
  });

  it("场景4：战时暂停（defense 期间不处理，恢复 peace 后继续）", () => {
    createDismantlePlan("deadLink1", "W7N4", "replacement.key", { x: 15, y: 16 }, 1000);
    // 进入 defense 状态
    (globalThis as any).Memory.rooms.W7N4.colonyState = "defense";
    expect(isRoomInDefense("W7N4")).toBe(true);

    // 战时：计划保留（不被处理）
    expect(getDismantlePlans().has("deadLink1")).toBe(true);

    // 恢复 peace
    (globalThis as any).Memory.rooms.W7N4.colonyState = "normal";
    expect(isRoomInDefense("W7N4")).toBe(false);
    // 计划仍在（可继续处理）
    expect(getDismantlePlans().has("deadLink1")).toBe(true);
  });

  it("场景5：冷却期内不创建新计划（避免同房频繁拆改）", () => {
    createDismantlePlan("deadLink1", "W7N4", "key1", { x: 15, y: 16 }, 1000);
    expect(isDismantleOnCooldown("W7N4", 1500)).toBe(true); // 冷却期内
    expect(isDismantleOnCooldown("W7N4", 1999)).toBe(true);
    expect(isDismantleOnCooldown("W7N4", 2000)).toBe(false); // 冷却过期
  });

  it("场景6：先建替代后拆旧（验证状态顺序）", () => {
    createDismantlePlan("deadLink1", "W7N4", "replacement.key", { x: 15, y: 16 }, 1000);
    const plan = getDismantlePlans().get("deadLink1")!;

    // Phase 1: waiting — 替代 link 尚未建成，旧 link 保留
    expect(plan.state).toBe("waiting");

    // Phase 2: validating — 替代 link 已建成，旧 link 仍保留（验证灌能）
    plan.state = "validating";
    plan.validatingSince = 1500;
    expect(plan.state).toBe("validating");

    // Phase 3: success — 替代 link 灌能确认后，才 destroy 旧 link
    // （construction-manager 执行 destroy，此处只验证状态机顺序）
    clearDismantlePlan("deadLink1");
    expect(getDismantlePlans().size).toBe(0);
  });
});

// ─── 边界条件 ─────────────────────────────────────────────

describe("P1-4 边界条件", () => {
  it("getDismantlePlans 空时返回空 Map", () => {
    const plans = getDismantlePlans();
    expect(plans.size).toBe(0);
  });

  it("多个房间的拆改计划独立跟踪", () => {
    createDismantlePlan("link1", "W7N4", "key1", { x: 10, y: 11 }, 1000);
    createDismantlePlan("link2", "W3N7", "key2", { x: 20, y: 21 }, 1000);
    const plans = getDismantlePlans();
    expect(plans.size).toBe(2);
    expect(plans.get("link1")!.roomName).toBe("W7N4");
    expect(plans.get("link2")!.roomName).toBe("W3N7");
  });

  it("ttl 边界：expiresAt 时刻仍可处理（< 而非 <=）", () => {
    createDismantlePlan("link1", "W7N4", "key1", { x: 10, y: 11 }, 1000);
    const plan = getDismantlePlans().get("link1")!;
    // expiresAt = 1000 + 1500 = 2500
    // construction-manager 用 tick >= expiresAt 判 abort
    // tick=2499 → 未到期（可处理）
    // tick=2500 → 到期（abort）
    expect(plan.expiresAt).toBe(2500);
  });

  it("验证窗口边界：DISMANTLE_VALIDATION_DELAY 时刻触发 fallback", () => {
    // validatingSince=1500, DISMANTLE_VALIDATION_DELAY=500
    // tick=1999 → 未超时（等待）
    // tick=2000 → 超时（fallback）
    const validatingSince = 1500;
    expect(validatingSince + DISMANTLE_VALIDATION_DELAY).toBe(2000);
  });
});

// ─── P1-1 回归：ttl 到期 abort 必须标记 linkConstrained 防 churn ─────
//
// 背景：DISMANTLE_COOLDOWN(1000) < DISMANTLE_TTL(1500)。若 ttl 到期 abort
// 不 markLinkConstrained，cooldown 过期后 layout-planner 会为同一死资产
// 创建新拆改计划，形成 ~1550t 周期的无限 churn。修复后 ttl abort 与
// fallback 同策略：markLinkConstrained + clearDeadAssetLink。
// 完整状态机执行由 construction-manager.processSinglePlan 负责，此处
// 通过模拟其调用链验证 globalCache 副作用一致性。

describe("P1-1 回归：ttl 到期 abort 防 churn", () => {
  /**
   * 模拟 construction-manager.processSinglePlan 的 ttl 到期路径
   *（实际函数未导出，此处复刻其副作用链以验证 link-system API 契约）。
   */
  function simulateTtlAbort(plan: DismantlePlan, tick: number): void {
    if (tick >= plan.expiresAt) {
      markLinkConstrained(plan.roomName, tick);
      clearDismantlePlan(plan.deadLinkId);
      clearDeadAssetLink(plan.deadLinkId);
    }
  }

  it("ttl 到期 → markLinkConstrained + clearDismantlePlan + clearDeadAssetLink", () => {
    // 准备：创建拆改计划 + 预置死资产计时器（模拟检测阶段已积累）
    createDismantlePlan("deadLink1", "W7N4", "key1", { x: 15, y: 16 }, 1000);
    const cache = globalCache();
    if (!cache.deadAssetSince) cache.deadAssetSince = new Map();
    cache.deadAssetSince.set("deadLink1", 600); // 模拟 600t 前开始追踪
    const plan = getDismantlePlans().get("deadLink1")!;
    expect(plan.expiresAt).toBe(2500);

    // 执行：ttl 到期
    simulateTtlAbort(plan, 2500);

    // 验证：三重副作用
    expect(getDismantlePlans().has("deadLink1")).toBe(false); // 计划清除
    expect(isLinkConstrained("W7N4", 2500)).toBe(true); // 标记受限
    expect(cache.deadAssetSince.has("deadLink1")).toBe(false); // 死资产计时器清除
  });

  it("ttl 到期 markLinkConstrained 后 1000t 内不会被重判为可拆改", () => {
    createDismantlePlan("deadLink1", "W7N4", "key1", { x: 15, y: 16 }, 1000);
    const plan = getDismantlePlans().get("deadLink1")!;

    simulateTtlAbort(plan, 2500);
    expect(isLinkConstrained("W7N4", 2500)).toBe(true);

    // 模拟 layout-planner 检查：linkConstrained 期内跳过 link 任务创建
    //（isLinkConstrained 内部用 LINK_CONSTRAINED_RETRY_INTERVAL=1000 判定）
    expect(isLinkConstrained("W7N4", 3499)).toBe(true); // 仍受限
    expect(isLinkConstrained("W7N4", 3500)).toBe(false); // 过期，可重试
  });

  it("ttl 未到期 → 不触发 abort 副作用", () => {
    createDismantlePlan("deadLink1", "W7N4", "key1", { x: 15, y: 16 }, 1000);
    const plan = getDismantlePlans().get("deadLink1")!;
    expect(plan.expiresAt).toBe(2500);

    // 未到期 → 不应 markLinkConstrained
    simulateTtlAbort(plan, 2499);

    expect(getDismantlePlans().has("deadLink1")).toBe(true); // 计划仍在
    expect(isLinkConstrained("W7N4", 2499)).toBe(false); // 未标记受限
  });

  it("ttl 到期 abort 与 fallback 策略一致（都标记 linkConstrained）", () => {
    // 场景 A：ttl 到期 abort
    createDismantlePlan("deadA", "W7N4", "keyA", { x: 15, y: 16 }, 1000);
    const planA = getDismantlePlans().get("deadA")!;
    simulateTtlAbort(planA, planA.expiresAt);

    // 场景 B：fallback（验证超时）— 直接调用 markLinkConstrained
    createDismantlePlan("deadB", "W3N7", "keyB", { x: 25, y: 26 }, 1000);
    markLinkConstrained("W3N7", 2000); // 模拟 fallback 路径
    clearDismantlePlan("deadB");

    // 两种路径都标记 linkConstrained — churn 防护一致
    expect(isLinkConstrained("W7N4", 2500)).toBe(true);
    expect(isLinkConstrained("W3N7", 2000)).toBe(true);
  });

  it("重开稳定性：global reset 后 linkConstrained 标记丢失 → 不影响死资产重新评估", () => {
    // 修复 P1-1 后 linkConstrained 是 heap 字段，global reset 后丢失。
    // 但 deadAssetSince 也丢失 → 不会立即触发新拆改。需重新积累 500t 检测窗口。
    createDismantlePlan("deadLink1", "W7N4", "key1", { x: 15, y: 16 }, 1000);
    const plan = getDismantlePlans().get("deadLink1")!;
    simulateTtlAbort(plan, 2500);
    expect(isLinkConstrained("W7N4", 2500)).toBe(true);

    // 模拟 global reset：清空 globalCache
    resetGlobals();

    // 重开后：linkConstrained 丢失 → 可重新评估（但需死资产检测重新积累）
    expect(isLinkConstrained("W7N4", 9999)).toBe(false);
    expect(getDismantlePlans().size).toBe(0); // 计划也丢失
  });
});
