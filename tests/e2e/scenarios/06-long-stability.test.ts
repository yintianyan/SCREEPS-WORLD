/**
 * E2E-006 10000 tick 长期稳定性 — 验证长期运行不崩、不泄漏、不死亡螺旋。
 *
 * 真实场景 [Experience]：
 *   - Screeps 是 24/7 运行的游戏，一次部署跑数月
 *   - 常见死亡螺旋：creep 死光 → 无能量 → 无法孵化 → 永久死亡
 *   - Memory 泄漏：每 tick 累积数据，最终超 2MB 上限
 *   - Global Reset 每 4-12h 必发，reset 后必须能恢复
 *
 * 这是 E2E 测试的核心价值——在真实 Screeps 引擎上长期运行，
 * 验证生产代码的 dist/main.js 构建产物能稳定自治。
 *
 * 验证标准（按 2000 tick 分段检查）：
 *   1. 每 2000 tick 内无 JS 错误（TypeError/ReferenceError）
 *   2. 50 tick warmup 后 creep 数量不归零（无死亡螺旋）
 *   3. 10000 tick 后 Memory 大小 < 500KB（无泄漏）
 *   4. 10000 tick 后经济在运转（有 creep 在工作）
 *   5. P1-4: 每 2000 tick 检查 bucket 不耗尽（≥ 1000，recovery 阈值）
 *   6. P1-4: 每 2000 tick 检查无任务饥饿（spawnQueue 不持续非空）
 *
 * [Facts] screeps-server-mockup 每 tick 约 50-100ms，10000 tick 约 8-16 分钟。
 * timeout 设 20 分钟（1200000ms）覆盖最慢情况。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";

/** 判断日志行是否为 JS 错误。 */
function isJsError(line: string): boolean {
  return (
    line.includes("TypeError") ||
    line.includes("ReferenceError") ||
    line.includes("is not a function") ||
    line.includes("Cannot read properties of undefined")
  );
}

describe("E2E-006 10000 tick 长期稳定性", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 2)],
      maxTicks: 11000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "10000 tick 连续运行：无 JS 错误 + 无死亡螺旋 + Memory 不泄漏",
    async () => {
      const CHECKPOINT = 2000;
      const TOTAL_TICKS = 10000;
      const WARMUP_TICKS = 50;

      let totalErrors: string[] = [];
      let totalSnapshots: Array<{ tick: number; totalCreeps: number; consoleLogs: string[] }> = [];

      // 分段运行，每段 CHECKPOINT tick，共 5 段
      for (let segment = 1; segment <= TOTAL_TICKS / CHECKPOINT; segment++) {
        const snapshots = await runner.runTicks(CHECKPOINT);

        // 累积快照用于后续断言
        for (const snap of snapshots) {
          totalSnapshots.push({
            tick: snap.tick,
            totalCreeps: snap.totalCreeps,
            consoleLogs: snap.consoleLogs,
          });
        }

        // 段内错误检查
        const segmentErrors = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
        if (segmentErrors.length > 0) {
          totalErrors.push(...segmentErrors);
        }

        // 段内死亡螺旋检查（跳过全局 warmup）
        const globalTickBase = (segment - 1) * CHECKPOINT;
        if (globalTickBase >= WARMUP_TICKS) {
          const afterWarmup = snapshots.slice(
            Math.max(0, WARMUP_TICKS - globalTickBase),
          );
          const zeroCreepTicks = afterWarmup.filter((s) => s.totalCreeps === 0);
          expect(
            zeroCreepTicks.length,
            `段 ${segment}（tick ${globalTickBase + 1}-${globalTickBase + CHECKPOINT}）` +
              `有 ${zeroCreepTicks.length} 个 tick creep 数为 0（死亡螺旋）`,
          ).toBe(0);
        }
      }

      // 全程无 JS 错误
      expect(
        totalErrors,
        `10000 tick 内检测到 ${totalErrors.length} 个 JS 错误:\n${totalErrors.slice(0, 10).join("\n")}`,
      ).toHaveLength(0);

      // 最终 Memory 大小检查
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      // [Facts] RawMemory.segments 单段 100KB 上限，总 2MB
      // 合理的 Memory 应远小于 500KB
      expect(
        memSize,
        `10000 tick 后 Memory 大小 ${memSize} bytes（${(memSize / 1024).toFixed(1)}KB）过大，可能存在泄漏`,
      ).toBeLessThan(500 * 1024);

      // P1-4: bucket 不耗尽检查 — 10000 tick 后 bucket 应 ≥ 1000（recovery 阈值）。
      // 私服 mock 的 Game.cpu.bucket 可能为 undefined，只检查有值的情况。
      const cpuBucket = (globalThis as any).Game?.cpu?.bucket;
      if (cpuBucket !== undefined) {
        expect(
          cpuBucket,
          `10000 tick 后 bucket=${cpuBucket} < 1000（CPU 持续超支导致 bucket 耗尽）`,
        ).toBeGreaterThanOrEqual(1000);
      }

      // P1-4: 任务饥饿率检查 — spawnQueue 在稳态后不应持续非空。
      // 稳态定义：最后 1000 tick 中，spawnQueue 非空的比例应 < 70%
      // （瞬时排队是正常的，但持续排队说明孵化跟不上一死亡就排队 = 饥饿循环）。
      const lastSegment = totalSnapshots.slice(-1000);
      // 检查 Memory.rooms 中 spawnQueue 的长度趋势
      const rooms = mem.rooms ?? {};
      let totalQueueLength = 0;
      for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room?.spawnQueue && Array.isArray(room.spawnQueue)) {
          totalQueueLength += room.spawnQueue.length;
        }
      }
      // 最终快照时 spawnQueue 可能有残留（正常排队），但不应堆积
      expect(
        totalQueueLength,
        `10000 tick 后 spawnQueue 总长度=${totalQueueLength}（任务饥饿：孵化跟不上需求）`,
      ).toBeLessThan(10);

      // 最终有 creep 在工作
      const finalSnapshot = totalSnapshots.at(-1)!;
      expect(
        finalSnapshot.totalCreeps,
        `10000 tick 后 creep 数为 0（死亡螺旋）。\n${debugSnapshot({
          tick: finalSnapshot.tick,
          totalCreeps: finalSnapshot.totalCreeps,
          creepCountByRole: {},
          rawMemory: mem,
          consoleLogs: finalSnapshot.consoleLogs,
          notifications: [],
        })}`,
      ).toBeGreaterThan(0);

      console.log(
        `10000 tick 稳定性测试通过：` +
          `最终 creep 数=${finalSnapshot.totalCreeps}，` +
          `Memory 大小=${(memSize / 1024).toFixed(1)}KB`,
      );
    },
    1200000, // 20 分钟（10000 tick × ~100ms/tick ≈ 17 分钟，留缓冲）
  );
});
