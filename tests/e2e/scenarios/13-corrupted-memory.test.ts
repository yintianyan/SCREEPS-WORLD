/**
 * E2E-013 损坏 Memory 恢复 — 验证 Memory 迁移系统能从损坏状态恢复。
 *
 * 真实场景：
 *   - Screeps 服务端升级可能导致 Memory 格式不兼容
 *   - 手动 console 操作可能意外损坏 Memory 结构
 *   - 网络抖动导致 storage 写入不完整
 *
 * 验证策略：
 *   1. 注入损坏的 Memory（缺少必要字段、类型错误、null 值）
 *   2. 运行 500 tick
 *   3. 验证迁移系统修复了损坏字段
 *   4. 验证帝国正常运转（无 JS 错误、creep 存活）
 *
 * 注意：screeps-server-mockup 的 bot 没有 memory setter，
 * 但有 console() 方法可以执行 `Memory = {...}` 来注入。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";
import { CONFIG } from "../../../src/config";

describe("E2E-013 损坏 Memory 恢复", () => {
  const runner = new ScenarioRunner();

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 2)],
      maxTicks: 2000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "阶段1：注入损坏 Memory 后能恢复",
    async () => {
      // 先跑 1 tick 让 bot 初始化
      await runner.tick();

      // 注入损坏的 Memory：
      // - creeps 是 null 而非 object
      // - kernel 缺失
      // - schemaVersion 是字符串而非数字
      // - 多了一个无效的 garbage 字段
      await runner.bot.sendConsole(
        'Memory = {"schemaVersion":"bad","creeps":null,"garbage":"corrupt"}',
      );

      // 推进 1 tick 让损坏 Memory 生效
      await runner.tick();

      // 再注入一个更严重的损坏：Memory = null
      // 这模拟最坏情况——Memory 完全丢失
      await runner.bot.sendConsole("Memory = null");
      await runner.tick();

      // 现在跑 200 tick 让系统自愈
      const snapshots = await runner.runTicks(200);
      const last = snapshots.at(-1)!;

      // 验证系统恢复——至少有 creep 在运行
      // Phase 6: 有信息量断言——损坏 Memory 恢复后必须有 creep 在运行
      expect(
        last.totalCreeps,
        `损坏 Memory 恢复后应有至少 1 个 creep 运转。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);

      // 验证 Memory 被正确初始化
      const mem = await runner.bot.getMemory();
      expect(mem, "Memory 应存在").toBeDefined();

      // 精确断言：schemaVersion 必须等于 CONFIG.memory.schemaVersion（=41）
      expect(mem.schemaVersion, "schemaVersion 必须存在").toBeDefined();
      expect(mem.schemaVersion, "schemaVersion 必须等于 CONFIG.memory.schemaVersion").toBe(
        CONFIG.memory.schemaVersion,
      );
      expect(mem.schemaVersion, "schemaVersion 必须等于 41").toBe(41);
      expect(typeof mem.schemaVersion, "schemaVersion 应为数字").toBe("number");

      // kernel 必须存在且为 object
      expect(mem.kernel, "kernel 必须存在").toBeDefined();
      expect(typeof mem.kernel, "kernel 必须为 object").toBe("object");

      // creeps 应为 object 或 undefined（不应该是 null）
      if (mem.creeps !== undefined) {
        expect(typeof mem.creeps, "creeps 应为 object（迁移系统修正）").toBe("object");
      }

      // 验证恢复后有实际生产/执行行为
      expect(last.rawMemory?.kernel, "rawMemory.kernel 应存在").toBeDefined();

      // OutcomeChannel 必须被生产消费者初始化，并使用压缩字段名。
      // 旧字段名不得残留。
      const kernel = last.rawMemory?.kernel as Record<string, unknown> | undefined;
      expect(kernel, "kernel 应存在").toBeDefined();
      const ch = kernel!.outcomeEvents as Record<string, unknown> | undefined;
      expect(ch, "outcomeEvents 必须存在").toBeDefined();
      expect(ch!.q, "channel q 必须为数组").toBeInstanceOf(Array);
      expect(ch!.s, "channel s 必须为数组").toBeInstanceOf(Array);
      expect(typeof ch!.dr, "channel dr 必须为数字").toBe("number");
      expect(typeof ch!.oe, "channel oe 必须为数字").toBe("number");
      expect(ch!.queue, "旧字段 queue 不得存在（已迁移到 q）").toBeUndefined();
      expect(ch!.seen, "旧字段 seen 不得存在（已迁移到 s）").toBeUndefined();
      expect(ch!.duplicateRejected, "旧字段 duplicateRejected 不得存在").toBeUndefined();
      expect(ch!.overflowEvicted, "旧字段 overflowEvicted 不得存在").toBeUndefined();
    },
    120000,
  );

  it(
    "阶段2：继续 300 tick 后系统稳定",
    async () => {
      const snapshots = await runner.runTicks(300);
      const last = snapshots.at(-1)!;

      // 验证帝国恢复运转
      expect(
        last.totalCreeps,
        `300 tick 后应有 creep 恢复运转。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);

      // 验证无 JS 错误
      const consoleLogs = runner.bot.drainConsole();
      const errors = consoleLogs.filter(
        (line) =>
          line.includes("TypeError") ||
          line.includes("Cannot read") ||
          line.includes("is not a function"),
      );
      expect(
        errors,
        `恢复期间有 JS 错误：\n${errors.join("\n")}`,
      ).toHaveLength(0);
    },
    120000,
  );
});
