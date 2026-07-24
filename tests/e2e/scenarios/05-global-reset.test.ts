/**
 * E2E-005 Global Reset 恢复韧性 — 验证 Memory 持久性 + 长期运行稳定性。
 *
 * 真实场景 [Experience]：
 *   - Screeps 服务端每 4-12 小时触发 Global Reset
 *   - 所有 global 变量清空，只保留 Memory 和 RawMemory
 *   - AI 必须能从 Memory 种子重建运行时状态
 *
 * 架构说明 [Facts]：
 *   - screeps-server-mockup 的 bot 代码在 isolated-vm 中运行
 *   - mockup 没有公开 API 清空 isolate 的 global 对象
 *   - 因此 E2E 层无法真正模拟 Global Reset（清空 global）
 *
 * 分层验证策略：
 *   - **integration 层**（tests/integration/edge-cases/global-reset.test.ts）：
 *     通过 delete global.X 真正模拟 Global Reset，验证 heap 缓存重建
 *   - **E2E 层**（本文件）：验证 Global Reset 能恢复的**前提条件**：
 *     1. Memory 持久性——长期运行后 schemaVersion 不变、creep memory 不丢失
 *     2. 无错误累积——长期运行不产生 JS 错误
 *     3. 系统韧性——creep 持续存在，无死亡螺旋
 *
 * 验证标准：
 *   1. 500 tick 建立稳态，记录 Memory 快照
 *   2. 继续 1000 tick，验证 Memory 一致性
 *   3. schemaVersion 不变（迁移幂等）
 *   4. creep memory 数量不减（Memory 不丢）
 *   5. 全程无 JS 错误
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";

describe("E2E-005 Global Reset 恢复韧性", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 2)],
      maxTicks: 2000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "阶段1：500 tick 建立稳态并记录 Memory 快照",
    async () => {
      const snapshots = await runner.runTicks(500);
      const last = snapshots.at(-1)!;

      // 至少要有 creep 在运行
      expect(
        last.totalCreeps,
        `500 tick 后无 creep。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);

      // 记录 Memory 快照用于后续一致性验证
      const mem = await runner.bot.getMemory();
      expect(mem, "Memory 应存在").toBeDefined();
      expect(mem.creeps, "Memory.creeps 应存在").toBeDefined();

      // schemaVersion 应存在（生产代码初始化 Memory 时设置）
      expect(
        mem.schemaVersion,
        "schemaVersion 应存在（Memory 迁移系统应已初始化）",
      ).toBeDefined();
    },
    180000,
  );

  it(
    "阶段2：继续 1000 tick 后 Memory 持久性验证",
    async () => {
      // 读取阶段1结束时的 Memory 基线
      const memBefore = await runner.bot.getMemory();
      const schemaBefore = memBefore.schemaVersion;
      const creepMemCountBefore = memBefore.creeps
        ? Object.keys(memBefore.creeps).length
        : 0;
      const roomMemCountBefore = memBefore.rooms
        ? Object.keys(memBefore.rooms).length
        : 0;

      // 继续 1000 tick（模拟 Global Reset 后时间继续流逝）
      const snapshots = await runner.runTicks(1000);
      const last = snapshots.at(-1)!;

      // 全程无 JS 错误
      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(
        (line) =>
          line.includes("TypeError") ||
          line.includes("ReferenceError") ||
          line.includes("global is not defined") ||
          line.includes("Cannot read properties of undefined"),
      );
      expect(
        errorLogs,
        `1000 tick 内检测到 JS 错误:\n${errorLogs.join("\n")}`,
      ).toHaveLength(0);

      // 验证 Memory 持久性
      const memAfter = await runner.bot.getMemory();

      // schemaVersion 不变（迁移幂等，不重复执行）
      expect(
        memAfter.schemaVersion,
        `schemaVersion 变化：${schemaBefore} → ${memAfter.schemaVersion}（迁移系统不应回退）`,
      ).toBe(schemaBefore);

      // creep memory 数量不减（Memory 不丢失）
      const creepMemCountAfter = memAfter.creeps
        ? Object.keys(memAfter.creeps).length
        : 0;
      expect(
        creepMemCountAfter,
        `creep memory 数量减少：${creepMemCountBefore} → ${creepMemCountAfter}（Memory 不应丢失）`,
      ).toBeGreaterThanOrEqual(creepMemCountBefore);

      // room memory 数量不减
      const roomMemCountAfter = memAfter.rooms
        ? Object.keys(memAfter.rooms).length
        : 0;
      expect(
        roomMemCountAfter,
        `room memory 数量减少：${roomMemCountBefore} → ${roomMemCountAfter}`,
      ).toBeGreaterThanOrEqual(roomMemCountBefore);

      // creep 持续存在（无死亡螺旋）
      expect(
        last.totalCreeps,
        `1000 tick 后 creep 数为 0（死亡螺旋）。\n${debugSnapshot(last)}`,
      ).toBeGreaterThan(0);
    },
    300000,
  );

  it(
    "阶段3：Memory 大小合理（无泄漏）",
    async () => {
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;

      // [Facts] RawMemory.segments 单段 100KB，总 2MB
      // 1500 tick 后合理的 Memory 应远小于 200KB
      expect(
        memSize,
        `Memory 大小 ${memSize} bytes（${(memSize / 1024).toFixed(1)}KB）过大，可能存在泄漏`,
      ).toBeLessThan(200 * 1024);

      console.log(
        `Global Reset 韧性验证完成：` +
          `schemaVersion=${mem.schemaVersion}，` +
          `creeps=${Object.keys(mem.creeps ?? {}).length}，` +
          `rooms=${Object.keys(mem.rooms ?? {}).length}，` +
          `Memory=${(memSize / 1024).toFixed(1)}KB`,
      );
    },
    30000,
  );
});
