/** E2E 冒烟测试 — 验证 screeps-server-mockup + dist/main.js 基础链路。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { isJsError } from "../../support/errors";

describe("E2E 冒烟测试 — screeps-server-mockup + dist/main.js", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: 100,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "server 能启动并推进 10 tick",
    async () => {
      const snapshots = await runner.runTicks(10);

      expect(snapshots).toHaveLength(10);
      // tick 应该递增
      expect(snapshots.at(9)!.tick).toBeGreaterThan(snapshots.at(0)!.tick);
    },
    60000,
  );

  it(
    "bot 能读取 Memory（非空）",
    async () => {
      const mem = await runner.bot.getMemory();
      // 生产代码应该初始化 Memory 结构
      expect(mem).toBeDefined();
      expect(typeof mem).toBe("object");
    },
    30000,
  );

  it(
    "10 tick 内不产生 TypeError / ReferenceError",
    async () => {
      const snapshots = await runner.runTicks(10);
      const lastSnap = snapshots.at(-1)!;

      // 合并所有日志检查错误
      const allLogs = snapshots.flatMap((s) => s.consoleLogs);
      const errorLogs = allLogs.filter(isJsError);

      expect(errorLogs, `检测到 JS 错误: ${errorLogs.join("; ")}`).toHaveLength(0);
    },
    60000,
  );
});
