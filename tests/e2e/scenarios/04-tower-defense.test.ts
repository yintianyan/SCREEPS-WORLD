/** E2E-004 Tower 防御 — 注入 hostile creep，验证 tower 攻击行为。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { rcl3RoomWithTower } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";
import { isJsError } from "../../support/errors";

describe("E2E-004 Tower 防御", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [rcl3RoomWithTower("W0N1")],
      maxTicks: 2000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "RCL3 + tower 场景稳定运行 300 tick",
    async () => {
      const snapshots = await runner.runTicks(300);

      // 不崩即可
      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(errorLogs, `检测到 JS 错误:\n${errorLogs.join("\n")}`).toHaveLength(0);
    },
    120000,
  );

  it(
    "注入 hostile creep 后 tower 发起攻击",
    async () => {
      // 在房间中心注入 hostile creep（tower 在 20,20）
      // hostile 靠近 tower，确保在攻击范围内（tower 攻击范围 20 格）
      await runner.worldBuilder.addHostileCreep(
        "W0N1",
        22,
        22,
        ["attack", "move"],
        "Invader1",
        "invader",
      );

      // 记录注入前的 Memory 状态
      const memBefore = await runner.bot.getMemory();

      // 跑 400 tick：塔初始空能量（0/1000），需先经经济链补能再开火 ——
      // 20 tick 只够崩不崩检查，不够火力真值（R20/T6 前提修正）。
      const snapshots = await runner.runTicks(400);
      const last = snapshots.at(-1)!;

      // 注入 hostile 后，AI 应该检测到威胁并响应
      // 验证方式1：console 日志中可能有 tower 相关输出
      const towerLogs = last.consoleLogs.filter(
        (line) =>
          line.toLowerCase().includes("tower") ||
          line.toLowerCase().includes("attack") ||
          line.toLowerCase().includes("hostile") ||
          line.toLowerCase().includes("威胁"),
      );

      // 验证方式2：不崩（核心韧性——hostile 出现不能让 AI 崩溃）
      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(errorLogs, `注入 hostile 后检测到 JS 错误:\n${errorLogs.join("\n")}`).toHaveLength(0);

      // 验证方式3：Memory 中可能有威胁记录或 tower 状态
      // 不强制断言具体字段（生产代码结构可能变化），只验证 AI 没崩
      const memAfter = await runner.bot.getMemory();
      expect(memAfter, "hostile 注入后 Memory 应存在").toBeDefined();

      // 如果有 tower 日志，打印用于调试
      if (towerLogs.length > 0) {
        console.log("Tower 相关日志:", towerLogs.slice(-5));
      }

      // 核心断言：注入 hostile 后系统继续运行不崩
      expect(snapshots.length, "应运行 400 tick").toBe(400);

      // 火力真值断言（R20/T6）：hostile 受伤或被击杀（roomObjects 直读 hits，
      // 取代「E2E 无法读塔」的旧注释——经 inspector 的引擎真值查询已可读）。
      const after = await runner.inspector.creepHitPoints("W0N1", "Invader1");
      expect(
        after === undefined || after.hits < after.hitsMax,
        `hostile 400 tick 后无伤且未死亡（hits=${after?.hits}/${after?.hitsMax}）— tower 未开火`,
      ).toBe(true);
    },
    120000,
  );

  it(
    "hostile 清除后系统恢复正常",
    async () => {
      // hostile 有 ticksToLive，会自然消失；或被 tower 杀死
      // 继续跑 100 tick，验证系统恢复
      const snapshots = await runner.runTicks(100);

      const errorLogs = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(errorLogs, `恢复阶段检测到 JS 错误:\n${errorLogs.join("\n")}`).toHaveLength(0);
    },
    120000,
  );
});
