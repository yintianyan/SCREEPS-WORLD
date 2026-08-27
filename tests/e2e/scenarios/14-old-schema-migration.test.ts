/**
 * E2E-014 旧 Schema 迁移 — 验证 Memory 迁移系统能从旧版 schema 升级。
 *
 * 真实场景：
 *   - 代码更新后 schemaVersion 提升，旧 Memory 需要迁移
 *   - 长时间未运行的 bot 重新上线时 Memory 版本很旧
 *   - 迁移必须幂等、安全、不丢数据
 *
 * 验证策略：
 *   1. 注入旧版 schema Memory（schemaVersion=1，只有最小字段）
 *   2. 运行 500 tick
 *   3. 验证 schemaVersion 升级到当前版本
 *   4. 验证帝国正常运转
 *
 * 注意：screeps-server-mockup 的 bot 没有 memory setter，
 * 通过 console() 方法注入 `Memory = {...}` 来模拟旧版 Memory。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { debugSnapshot } from "../helpers/assertions";
import { CONFIG } from "../../../src/config";

describe("E2E-014 旧 Schema 迁移", () => {
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
    "阶段1：注入 schemaVersion=1 的旧版 Memory 后迁移执行",
    async () => {
      // 先跑 1 tick 让 bot 初始化
      await runner.tick();

      // 注入旧版 Memory（schemaVersion=1，只有最基础的结构）
      // 模拟 v1 时代的 Memory：只有 creeps 和 rooms，没有 kernel/config 等
      // console 命令在下一 tick 开头执行，然后 loop 中迁移系统升级
      await runner.bot.sendConsole(
        'Memory = {"schemaVersion":1,"creeps":{},"rooms":{"W0N1":{}}}',
      );

      // 推进 1 tick：console 命令执行（注入旧版 Memory）+ loop 执行（迁移系统升级）
      await runner.tick();

      // 精确断言：schemaVersion 必须等于 CONFIG.memory.schemaVersion（=CONFIG.memory.schemaVersion）
      const mem = await runner.bot.getMemory();
      expect(mem.schemaVersion, "schemaVersion 应存在").toBeDefined();
      expect(mem.schemaVersion, "schemaVersion 必须等于 CONFIG.memory.schemaVersion").toBe(
        CONFIG.memory.schemaVersion,
      );
      expect(mem.schemaVersion, "schemaVersion 必须等于 CONFIG.memory.schemaVersion").toBe(CONFIG.memory.schemaVersion);

      // kernel 必须存在
      const kernel = mem.kernel as Record<string, unknown> | undefined;
      expect(kernel, "kernel 应存在").toBeDefined();

      // outcomeEvents 必须由生产消费者初始化，且只能使用压缩字段名
      const ch = kernel!.outcomeEvents as Record<string, unknown> | undefined;
      expect(ch, "outcomeEvents 必须存在").toBeDefined();
      expect(ch!.q, "channel q 必须为数组").toBeInstanceOf(Array);
      expect(ch!.s, "channel s 必须为数组").toBeInstanceOf(Array);
      expect(typeof ch!.dr, "channel dr 必须为数字").toBe("number");
      expect(typeof ch!.oe, "channel oe 必须为数字").toBe("number");
      expect(ch!.queue, "旧字段 queue 不得存在").toBeUndefined();
      expect(ch!.seen, "旧字段 seen 不得存在").toBeUndefined();
      expect(ch!.duplicateRejected, "旧字段 duplicateRejected 不得存在").toBeUndefined();
      expect(ch!.overflowEvicted, "旧字段 overflowEvicted 不得存在").toBeUndefined();

      // expansion 子结构类型验证
      const exp = kernel!.expansion as Record<string, unknown> | undefined;
      if (exp) {
        if (exp.operationId !== undefined) {
          expect(typeof exp.operationId, "operationId 应为 string").toBe("string");
        }
        if (exp.openedAt !== undefined) {
          expect(typeof exp.openedAt, "openedAt 应为 number").toBe("number");
        }
        if (exp.forcedAdvance !== undefined) {
          expect(typeof exp.forcedAdvance, "forcedAdvance 应为 boolean").toBe("boolean");
        }
      }
    },
    30000,
  );

  it(
    "阶段2：运行 500 tick 后迁移完成",
    async () => {
      const snapshots = await runner.runTicks(500);
      const last = snapshots.at(-1)!;

      // Phase 6: 验证迁移完成且 kernel 恢复
      // 精确断言：schemaVersion 必须等于 CONFIG.memory.schemaVersion（=CONFIG.memory.schemaVersion）
      const mem = await runner.bot.getMemory();
      expect(mem.schemaVersion, "schemaVersion 应存在").toBeDefined();
      expect(mem.schemaVersion, "schemaVersion 必须等于 CONFIG.memory.schemaVersion").toBe(
        CONFIG.memory.schemaVersion,
      );
      expect(mem.schemaVersion, "schemaVersion 必须等于 CONFIG.memory.schemaVersion").toBe(CONFIG.memory.schemaVersion);
      expect(mem.kernel, "kernel 应存在").toBeDefined();

      // 验证帝国正常运转
      expect(
        last.totalCreeps,
        `迁移后应有 creep 运转。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);

      // 验证迁移幂等——再读一次 schemaVersion 不变
      const memAgain = await runner.bot.getMemory();
      expect(memAgain.schemaVersion, "schemaVersion 应稳定不变").toBe(
        mem.schemaVersion,
      );
    },
    180000,
  );

  it(
    "阶段3：继续 500 tick 验证稳定性",
    async () => {
      const snapshots = await runner.runTicks(500);
      const last = snapshots.at(-1)!;

      // 验证帝国稳定运转
      expect(
        last.totalCreeps,
        `迁移后 1000 tick 应稳定运转。\n${debugSnapshot(last)}`,
      ).toBeGreaterThanOrEqual(1);

      // 验证无迁移错误日志
      const consoleLogs = runner.bot.drainConsole();
      const migrationErrors = consoleLogs.filter(
        (line) =>
          line.includes("migrate") &&
          (line.includes("ERROR") || line.includes("FATAL")),
      );
      expect(
        migrationErrors,
        `迁移有错误：\n${migrationErrors.join("\n")}`,
      ).toHaveLength(0);

      // 精确断言：schemaVersion 稳定且等于 CONFIG.memory.schemaVersion
      const mem = await runner.bot.getMemory();
      expect(mem.schemaVersion, "schemaVersion 应保持稳定").toBe(
        CONFIG.memory.schemaVersion,
      );
      expect(mem.schemaVersion, "schemaVersion 必须等于 CONFIG.memory.schemaVersion").toBe(CONFIG.memory.schemaVersion);
      // Phase 6: 验证有实际生产/执行行为
      expect(last.rawMemory?.kernel, "kernel 应存在").toBeDefined();
    },
    180000,
  );
});
