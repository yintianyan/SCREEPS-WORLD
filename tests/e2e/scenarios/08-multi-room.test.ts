/** E2E-008 多房间 remote mining — 验证跨房物流。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { remoteMiningRooms } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";

describe("E2E-008 多房间场景（remote mining 基础）", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: remoteMiningRooms(),
      maxTicks: 1500,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "双房场景稳定运行 500 tick 不崩",
    async () => {
      const snapshots = await runner.runTicks(500);

      const last = snapshots.at(-1)!;
      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(
        (line) =>
          line.includes("TypeError") ||
          line.includes("ReferenceError") ||
          line.includes("Cannot read properties of undefined"),
      );

      expect(errorLogs, `双房场景检测到错误:\n${errorLogs.join("\n")}`).toHaveLength(0);
      console.log("双房场景最后快照:", debugSnapshot(last));
    },
    120000,
  );
});
