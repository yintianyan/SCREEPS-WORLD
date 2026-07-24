/**
 * E2E-008 多房间 remote mining — 验证跨房物流。
 *
 * 真实场景 [Experience]：
 *   - 单房 source 产能上限 3000/300tick = 10/tick
 *   - Remote mining 是突破单房能量上限的关键
 *   - 需要跨房 pathfinding、remote harvester、跨房 hauler
 *
 * 验证标准：
 *   1. 双房场景稳定运行
 *   2. 不崩
 *   3. 主房 creep 能正常工作
 *
 * 注意：这个场景验证的是"不崩"，不是"remote mining 成功"。
 * Remote mining 是高级功能，AI 可能还没实现。先确保不崩。
 */
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
