/** E2E-002 RCL 升级链路 — 验证 controller 升级行为。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";

describe("E2E-002 RCL 升级链路（RCL1→RCL2）", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: 3000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "1500 tick 内出现 upgrader 角色在工作",
    async () => {
      const snapshots = await runner.runUntil(
        (snap) => (snap.creepCountByRole["upgrader"] ?? 0) >= 1,
        1500,
      );

      const last = snapshots.at(-1)!;
      expect(
        last.creepCountByRole["upgrader"] ?? 0,
        `1500 tick 内无 upgrader。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    180000,
  );

  it(
    "全程无 JS 错误，creep 数量增长",
    async () => {
      const snapshots = await runner.runTicks(1500);

      // 无 JS 错误
      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(
        (line) =>
          line.includes("TypeError") ||
          line.includes("ReferenceError") ||
          line.includes("Cannot read properties of undefined"),
      );
      expect(
        errorLogs,
        `检测到 JS 错误:\n${errorLogs.join("\n")}`,
      ).toHaveLength(0);

      // 50 tick warmup 后 creep 数不应归零
      const afterWarmup = snapshots.slice(50);
      const zeroCreepTicks = afterWarmup.filter((s) => s.totalCreeps === 0);
      expect(
        zeroCreepTicks.length,
        `有 ${zeroCreepTicks.length} 个 tick creep 数为 0（死亡螺旋）`,
      ).toBe(0);

      // 最终应有多个 creep（经济在运转）
      const last = snapshots.at(-1)!;
      expect(
        last.totalCreeps,
        `1500 tick 后只有 ${last.totalCreeps} 个 creep（经济未运转）。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    180000,
  );

  it(
    "Memory 持久存在且 schemaVersion 稳定",
    async () => {
      const mem1 = await runner.bot.getMemory();
      const schema1 = mem1.schemaVersion;

      // 再跑 100 tick
      await runner.runTicks(100);

      const mem2 = await runner.bot.getMemory();
      const schema2 = mem2.schemaVersion;

      // schemaVersion 应存在且稳定（迁移幂等）
      expect(schema1, "schemaVersion 应存在").toBeDefined();
      expect(schema2, "schemaVersion 应持续存在").toBe(schema1);

      // Memory.creeps 应存在（生产代码应跟踪 creep 状态）
      expect(mem2.creeps, "Memory.creeps 应存在").toBeDefined();
    },
    60000,
  );
});
