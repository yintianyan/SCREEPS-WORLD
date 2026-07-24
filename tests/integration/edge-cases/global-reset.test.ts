/**
 * Global Reset 恢复韧性集成测试。
 *
 * 验证系统在 Global Reset（heap 全清，Memory 保留）后能：
 *   - 无 runtime error
 *   - 从 Memory 重建 heap 缓存
 *   - 恢复能量循环
 *   - 不丢失 creep / Memory 状态
 *
 * 这是模型7（韧性优先于完美）的核心验证——
 * Screeps 每 4-12h 必发 Global Reset，恢复路径必须可靠。
 * 一个不能从 Global Reset 恢复的系统，扩展到多房间只是放大故障面。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { TickRunner, Assertions, rcl3Economy } from "../framework";

// 动态导入生产代码（确保全局对象已安装后再加载）
let loop: () => void;

beforeAll(async () => {
  const main = await import("../../../src/main");
  loop = main.loop;
});

/**
 * 模拟 Screeps Global Reset：
 * 清空所有 globalCache heap 字段（模拟沙箱重建），保留 Memory（持久化）。
 *
 * 字段清单来源：src/kernel/global-cache.ts 的 GlobalCache 接口 +
 * 各消费者用 `globalCache() as any` 写入的私有字段。
 *
 * 注意：不删除 Game / PathFinder / RoomPosition / Memory / RawMemory ——
 *   - Game 由 TickRunner.refreshGameGlobals() 维护
 *   - Memory / RawMemory 是持久化数据，Global Reset 后保留
 */
function simulateGlobalReset(): void {
  const g = globalThis as Record<string, unknown>;

  // ── GlobalCache 接口字段（src/kernel/global-cache.ts）──
  delete g.errorLog;
  delete g.errorCounts;
  delete g.pluginCooldowns;
  delete g.telemetry;
  delete g.roomTraffic;
  delete g.prevRoomTraffic;
  delete g.skipBuffer;
  delete g.eventBuffer;
  delete g.assignment;
  delete g.fillReservations;
  delete g.fillReservationTick;
  delete g.repairRooms;

  // ── per-tick 缓存（movement/obj-cache/targeting）──
  delete g.__objCache;
  delete g.__objCacheTick;
  delete g.__pathShare;
  delete g.__pathShareTick;
  delete g.__structCache;
  delete g.__coreCenter;
  delete g.__creepPathCache;
  delete g.__interRoomCache;
  delete g.__yieldRequests;

  // ── defense-planner 缓存 ──
  delete g.__minCutCache;
  delete g.__exitCache;

  // ── segment-store 缓存 ──
  delete g.__segStore;

  // ── telemetry-collector 缓存 ──
  delete g.__telemetryPrevState;
}

describe("Global Reset 恢复韧性", () => {
  it("Global Reset 后系统从 Memory 重建 heap 缓存并恢复运行", () => {
    // ── 1. 建立 RCL3 稳态场景（spawn + 10 extensions + 1 tower + 3 containers）──
    const world = rcl3Economy("W1N1").build();

    const runner = new TickRunner();
    runner.setLoop(loop);

    // ── 2. 运行 300 tick 建立稳态（产生 creep + 填充 Memory + heap 缓存）──
    const result1 = runner.run(world, 300, {
      stopWhen: (w) => w.creeps.length >= 3,
    });

    const assertions1 = new Assertions(world, result1.records);
    assertions1.assertNoRuntimeError("reset 前稳态");
    expect(world.creeps.length).toBeGreaterThan(0);

    // ── 3. 记录 reset 前关键状态 ──
    const mem = (globalThis as any).Memory;
    const schemaVersionBefore = mem.schemaVersion;
    const creepCountBefore = world.creeps.length;
    const roomCountBefore = Object.keys(mem.rooms).length;
    const creepMemCountBefore = Object.keys(mem.creeps).length;

    // 确认 reset 前 heap 缓存已存在（稳态运行后应有数据）
    const g = globalThis as any;
    expect(g.telemetry).toBeDefined();
    expect(g.repairRooms).toBeDefined();

    // ── 4. 模拟 Global Reset ──
    simulateGlobalReset();

    // 验证 global 已被清空
    expect(g.telemetry).toBeUndefined();
    expect(g.eventBuffer).toBeUndefined();
    expect(g.repairRooms).toBeUndefined();
    expect(g.__structCache).toBeUndefined();

    // ── 5. 继续运行 200 tick（reset 后恢复）──
    const result2 = runner.run(world, 200, {});

    const assertions2 = new Assertions(world, result2.records);
    assertions2.assertNoRuntimeError("reset 后恢复");

    // ── 6. 验证 Memory 持久化（Global Reset 不丢 Memory）──
    expect(mem.schemaVersion).toBe(schemaVersionBefore);
    expect(Object.keys(mem.rooms).length).toBe(roomCountBefore);
    expect(Object.keys(mem.creeps).length).toBeGreaterThanOrEqual(creepMemCountBefore);

    // ── 7. 验证 heap 缓存被重建 ──
    // telemetry 由 kernel.run() 的 initTelemetry 步骤重建（kernel.ts:82）
    expect(g.telemetry).toBeDefined();
    expect(g.telemetry.tick).toBe((globalThis as any).Game.time);
    // repairRooms 由 kernel.buildSnapshots 重建（kernel.ts:88 → 160）
    expect(g.repairRooms).toBeDefined();
    // __structCache 由 pathfinding.ts 的 ensureStructureCache 惰性重建
    // （下次 creep 移动时触发，不强制断言——只要不崩即可）

    // ── 8. 验证 creep 不丢失（Memory 持久化 + Game.creeps 由 TestWorld 维护）──
    expect(world.creeps.length).toBeGreaterThanOrEqual(creepCountBefore);

    // ── 9. 验证能量循环继续运转 ──
    expect(result2.finalSnapshot.stats.totalHarvested).toBeGreaterThan(0);
  });

  it("Global Reset 后 schemaVersion 不回退（迁移幂等）", () => {
    const world = rcl3Economy("W1N1").build();
    const runner = new TickRunner();
    runner.setLoop(loop);

    // 建立稳态
    runner.run(world, 100, {});

    const mem = (globalThis as any).Memory;
    const schemaBefore = mem.schemaVersion;
    expect(schemaBefore).toBeGreaterThan(0);

    // Global Reset
    simulateGlobalReset();

    // 继续运行
    runner.run(world, 50, {});

    // 迁移不回退、不重复执行（maintainMemory 会检查 schemaVersion，
    // 已是最新版本则不执行 MIGRATIONS）
    expect(mem.schemaVersion).toBe(schemaBefore);
  });

  it("连续两次 Global Reset 仍能恢复", () => {
    // 验证多次 reset 不累积状态损坏
    const world = rcl3Economy("W1N1").build();
    const runner = new TickRunner();
    runner.setLoop(loop);

    // 初始稳态
    const result1 = runner.run(world, 200, {});
    new Assertions(world, result1.records).assertNoRuntimeError("第一次稳态");

    const creepCountAfterStable = world.creeps.length;

    // 第一次 Global Reset
    simulateGlobalReset();
    const result2 = runner.run(world, 100, {});
    new Assertions(world, result2.records).assertNoRuntimeError("第一次 reset 后");

    // 第二次 Global Reset
    simulateGlobalReset();
    const result3 = runner.run(world, 100, {});
    new Assertions(world, result3.records).assertNoRuntimeError("第二次 reset 后");

    // 两次 reset 后 creep 数量不归零
    expect(world.creeps.length).toBeGreaterThan(0);
    expect(world.creeps.length).toBeGreaterThanOrEqual(creepCountAfterStable - 1);
  });
});
