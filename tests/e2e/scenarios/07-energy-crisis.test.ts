/** E2E-007 能量危机降级 — spawn 低能量前提下的最小孵化。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { injectSpawnEnergy } from "../fixtures/inject";
import { debugSnapshot } from "../helpers/assertions";

describe("E2E-007 能量危机降级", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: 1000,
    });
    // 前提真实化（R20/T6）：addBot 统一供 spawn（夹具 spawn 会被双 spawn 去重
    // 剔除——原 standardRoom("W0N1", 200) 的 200 能量从未进引擎）。改走具名
    // 注入把 spawn 压到 200，前提才真正落库。
    await injectSpawnEnergy(runner, "W0N1", 200);
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
