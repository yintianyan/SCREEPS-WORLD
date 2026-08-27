/** E2E-003 Storage 建造 — RCL4 解锁 storage，验证建造链路启动。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { rcl4Room } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";

describe("E2E-003 Storage 建造（RCL4）", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [rcl4Room("W0N1")],
      maxTicks: 5000,
      controllerLevel: 4,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "RCL4 后出现 builder 角色",
    async () => {
      // controllerLevel: 4 已在 setup 中生效，RCL4 解锁 storage 建造链路。
      // 等待 builder 出现（storage site 创建后应触发 builder 角色）
      const snapshots = await runner.runUntil(
        (snap) => (snap.creepCountByRole["builder"] ?? 0) >= 1,
        2800,
      );

      const last = snapshots.at(-1)!;
      expect(
        last.creepCountByRole["builder"] ?? 0,
        `RCL4 后 2800 tick 内无 builder。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    300000,
  );

  it(
    "全程无 JS 错误，经济在运转",
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

      // 最终应有 creep 在工作
      const last = snapshots.at(-1)!;
      expect(
        last.totalCreeps,
        `1500 tick 后无 creep（经济未运转）。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    180000,
  );

  it(
    "Memory 持久存在且 schemaVersion 稳定",
    async () => {
      const mem1 = await runner.bot.getMemory();
      const schema1 = mem1.schemaVersion;

      await runner.runTicks(100);

      const mem2 = await runner.bot.getMemory();
      const schema2 = mem2.schemaVersion;

      // schemaVersion 应存在且稳定（迁移幂等）
      expect(schema1, "schemaVersion 应存在").toBeDefined();
      expect(schema2, "schemaVersion 应持续存在").toBe(schema1);

      // Memory.rooms 应存在（生产代码应跟踪房间状态）
      expect(mem2.rooms, "Memory.rooms 应存在").toBeDefined();
      expect(
        Object.keys(mem2.rooms ?? {}).length,
        "Memory.rooms 应至少有当前房间",
      ).toBeGreaterThan(0);
    },
    60000,
  );
});
