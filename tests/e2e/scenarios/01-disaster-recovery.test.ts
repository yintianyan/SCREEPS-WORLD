/** E2E-001 灾后恢复 — 0 creep + 300 能量，AI 必须自恢复到有 creep 工作。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { disasterRoom } from "../fixtures/rooms";
import { assertNoErrors, debugSnapshot } from "../helpers/assertions";

describe("E2E-001 灾后恢复（0 creep + 300 能量）", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [disasterRoom("W0N1")],
      maxTicks: 2000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "500 tick 内孵化出至少 1 个 creep",
    async () => {
      const snapshots = await runner.runUntil(
        (snap) => snap.totalCreeps >= 1,
        500,
      );

      const last = snapshots.at(-1)!;
      expect(
        last.totalCreeps,
        `500 tick 后仍无 creep。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    120000,
  );

  it(
    "1000 tick 内有 harvester 角色在工作",
    async () => {
      const snapshots = await runner.runUntil(
        (snap) => (snap.creepCountByRole["harvester"] ?? 0) >= 1,
        1000,
      );

      const last = snapshots.at(-1)!;
      const harvesterCount = last.creepCountByRole["harvester"] ?? 0;
      expect(
        harvesterCount,
        `1000 tick 内无 harvester。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    180000,
  );

  it(
    "全程不产生 JS 错误",
    async () => {
      // 再跑 200 tick 检查错误
      const snapshots = await runner.runTicks(200);
      const last = snapshots.at(-1)!;

      // 只检查严重的 JS 错误，不检查业务日志
      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(
        (line) =>
          line.includes("TypeError") ||
          line.includes("ReferenceError") ||
          line.includes("is not a function"),
      );

      expect(
        errorLogs,
        `检测到 JS 错误:\n${errorLogs.join("\n")}\n最后快照:\n${debugSnapshot(last)}`,
      ).toHaveLength(0);
    },
    120000,
  );
});
