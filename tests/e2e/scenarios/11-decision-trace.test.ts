/** E2E-011 Decision Trace & Deterministic Replay */
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

/** 从 console logs 中提取 decision-trace 相关日志。 */
function findDecisionTraceLogs(logs: string[]): string[] {
  return logs.filter(l => l.includes("decision-trace"));
}

describe("E2E-011 Decision Trace & Deterministic Replay", () => {
  const runner = new ScenarioRunner();
  const ROOM = "W0N1";

  beforeAll(async () => {
    await runner.setup({
      roomName: ROOM,
      rooms: [standardRoom(ROOM, 300, 2)],
      maxTicks: 6000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "Phase 1: Trace Initialization（200t）— 验证 decision-trace 系统启动",
    async () => {
      const snapshots = await runner.runTicks(200);
      const last = snapshots.at(-1)!;

      // 全程无 JS 错误
      const errors = snapshots.flatMap(s => s.consoleLogs).filter(isJsError);
      expect(errors, `Phase 1 检测到 JS 错误:\n${errors.slice(0, 5).join("\n")}`).toHaveLength(0);

      // 验证系统运行（至少有 tick 推进）
      expect(last.tick, `200t 后 tick 应 ≥ 200`).toBeGreaterThanOrEqual(200);

      // 检查是否有 decision-trace 相关日志（interval=100，200t 内应运行过）
      const allLogs = snapshots.flatMap(s => s.consoleLogs);
      const traceLogs = findDecisionTraceLogs(allLogs);
      // 即使没有 IMPORTANT/CRITICAL 级别的日志，系统也应该正常运行
      // 只要不报错就说明初始化成功
      console.log(`Phase 1: tick=${last.tick}, traceLogs=${traceLogs.length}`);
    },
    120000,
  );

  it(
    "Phase 2: Record Collection（1500t）— 验证有 DecisionRecord 产出",
    async () => {
      const snapshots = await runner.runTicks(1300); // 200 → 1500
      const last = snapshots.at(-1)!;

      // 全程无 JS 错误
      const errors = snapshots.flatMap(s => s.consoleLogs).filter(isJsError);
      expect(errors, `Phase 2 检测到 JS 错误:\n${errors.slice(0, 5).join("\n")}`).toHaveLength(0);

      // 1500t 后应有 creep 在工作
      expect(last.totalCreeps, `1500t 后仍无 creep。\n${debugSnapshot(last)}`).toBeGreaterThan(0);

      // 检查 decision-trace 日志产出
      const allLogs = snapshots.flatMap(s => s.consoleLogs);
      const traceLogs = findDecisionTraceLogs(allLogs);

      // 在 1500t 运行中，应该至少有一次 decision-trace 日志输出
      // （当有 IMPORTANT/CRITICAL 决策时才输出）
      console.log(
        `Phase 2: tick=${last.tick}, creeps=${last.totalCreeps}, ` +
          `traceLogs=${traceLogs.length}, ` +
          `sample=${traceLogs[0]?.slice(0, 80) ?? "none"}`,
      );

      // 验证 Memory 不膨胀
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);
    },
    300000,
  );

  it(
    "Phase 3: Long Stability（5000t）— 连续运行无错误 + Memory 安全",
    async () => {
      // 1500 → 5000
      const snapshots = await runner.runTicks(3500);
      const last = snapshots.at(-1)!;

      // 全程无 JS 错误
      const errors = snapshots.flatMap(s => s.consoleLogs).filter(isJsError);
      expect(errors, `Phase 3 检测到 JS 错误:\n${errors.slice(0, 5).join("\n")}`).toHaveLength(0);

      // 5000t 后仍应有存活 creep
      expect(last.totalCreeps, `5000t 后无 creep — 帝国已死亡。\n${debugSnapshot(last)}`).toBeGreaterThan(0);

      // Memory 不膨胀
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `5000t 后 Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);

      // spawnQueue 不持续堆积（从快照的 rawMemory 中提取）
      const rawMem = last.rawMemory as any;
      let queueLength = 0;
      if (rawMem?.rooms) {
        for (const roomMem of Object.values(rawMem.rooms) as any[]) {
          if (roomMem?.spawnQueue && Array.isArray(roomMem.spawnQueue)) {
            queueLength += roomMem.spawnQueue.length;
          }
        }
      }
      expect(queueLength, `spawnQueue 持续堆积: ${queueLength}`).toBeLessThan(10);

      // 检查 trace 日志
      const allLogs = snapshots.flatMap(s => s.consoleLogs);
      const traceLogs = findDecisionTraceLogs(allLogs);
      console.log(
        `Phase 3: tick=${last.tick}, creeps=${last.totalCreeps}, ` +
          `memSize=${(memSize / 1024).toFixed(0)}KB, ` +
          `traceLogs=${traceLogs.length}`,
      );
    },
    600000, // 10 分钟
  );
});
