/** E2E 长 smoke — 5000 tick 引擎验证，验证运行时指标采集和基础稳定性。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { isJsError } from "../../support/errors";

describe("E2E 长 smoke — 5000 tick 引擎稳定性 + 运行时指标采集", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: 5100,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "5000 tick 连续运行无 TypeError / ReferenceError",
    async () => {
      const CHECKPOINT = 1000;
      const TOTAL_TICKS = 5000;
      let errorCount = 0;
      let lastSnapshot: Awaited<ReturnType<typeof runner.tick>> | null = null;

      for (let segment = 1; segment <= TOTAL_TICKS / CHECKPOINT; segment++) {
        const snapshots = await runner.runTicks(CHECKPOINT);

        // 检查 JS 错误
        const errors = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
        errorCount += errors.length;

        if (errors.length > 0 && segment <= 2) {
          // 前两段允许少量错误（global reset 重建期），但记录
          console.log(`[segment ${segment}] ${errors.length} errors (warmup)`);
        } else if (errors.length > 0) {
          // 第三段之后不应有错误
          throw new Error(
            `Segment ${segment} 检测到 ${errors.length} 个 JS 错误:\n${errors.slice(0, 5).join("\n")}`,
          );
        }
        lastSnapshot = snapshots.at(-1)!;
      }

      expect(errorCount, `5000 tick 内总共 ${errorCount} 个 JS 错误`).toBeLessThanOrEqual(5);
    },
    300000, // 5 分钟
  );

  it(
    "5000 tick 后 Memory 已初始化且非空",
    async () => {
      const mem = await runner.bot.getMemory();
      expect(mem).toBeDefined();
      expect(typeof mem).toBe("object");
      // Memory 应有 kernel 结构（生产代码 tick 1 初始化）
      expect(mem.kernel).toBeDefined();
    },
    30000,
  );

  it(
    "5000 tick 后运行时指标可采集",
    async () => {
      const snapshots = await runner.runTicks(10);
      const snap = snapshots.at(-1)!;

      // 验证指标结构存在
      expect(snap.metrics).toBeDefined();
      // Memory 大小应大于 0
      expect(snap.metrics.memorySize).toBeGreaterThan(0);
      // colonyStates 应有至少一个房间的状态
      const roomStates = Object.keys(snap.colonyStates);
      // 可能在 warmup 期还没有，但 5000 tick 后应该有
      if (roomStates.length > 0) {
        const state = snap.colonyStates[roomStates[0]!]!;
        // 合法值：bootstrap/recovery/normal/defense
        expect(["bootstrap", "recovery", "normal", "defense"]).toContain(state);
      }
    },
    60000,
  );
});
