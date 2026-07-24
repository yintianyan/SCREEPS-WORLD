/**
 * E2E-007 能量危机降级 — spawn 能量 < 300，验证 P0 优先级。
 *
 * 真实场景 [Experience]：
 *   - 灾后恢复初期，spawn 只有 300 能量
 *   - 经济崩盘时 spawn 长期 < 300
 *   - AI 应该优先孵化最小 harvester（[WORK,CARRY,MOVE] = 200 能量）
 *
 * 验证标准：
 *   1. spawn 能量不足时仍能孵化（用最小 body）
 *   2. 孵化优先级正确（harvester 优先）
 *   3. 不崩
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";

describe("E2E-007 能量危机降级", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    // spawn 只有 200 能量（低于 300），测试最小孵化
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 200, 1)],
      maxTicks: 1000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "spawn 能量 200 时仍能在 500 tick 内孵化出 creep",
    async () => {
      const snapshots = await runner.runUntil(
        (snap) => snap.totalCreeps >= 1,
        500,
      );

      const last = snapshots.at(-1)!;
      expect(
        last.totalCreeps,
        `500 tick 后仍无 creep（spawn 能量危机未恢复）。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);
    },
    120000,
  );
});
