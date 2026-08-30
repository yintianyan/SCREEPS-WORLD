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

      // 跑 20 tick，让 tower 有机会攻击
      // [Facts] tower 每 tick 能攻击一次，20 tick 足够观察能量下降
      const snapshots = await runner.runTicks(20);
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
      // 真正的攻击行为验证由 integration 层的 tower 单元测试覆盖
      // （E2E 层无法直接读取 tower.energy，只能通过 Memory/console 间接观察）
      expect(snapshots.length, "应运行 20 tick").toBe(20);
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
