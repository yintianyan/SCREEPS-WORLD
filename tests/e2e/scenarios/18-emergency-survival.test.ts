/**
 * E2E-018 Emergency Survival Mode — Recovery 档内的紧急安全状态实测（RELEASE_GATE §5.2）。
 *
 * mockup driver 按每 tick 记账（cpuAvailable += cpu − used），cpu≈实际用量时
 * bucket 稳在注入值 —— 据此做确定性 ESM 注入：
 *   ①bucket=50（< 100）→ ESM 进入（遥测事件 + log + 仅 P0 车道 + 非 harvester 让位）
 *   ②bucket=400（[100,500) 带内）→ ESM 保持（不抖动退出）
 *   ③bucket=800（≥ 500）→ ESM 退出回 Recovery 常规语义
 * 证据绑定：commit / schemaVersion / 注入时间线在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { injectCpu } from "../fixtures/inject";
import { isJsError } from "../../support/errors";

const ROOM = "W0N1";

describe("E2E-018 Emergency Survival Mode — 进入/保持/退出", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;

  beforeAll(async () => {
    await runner.setup({
      roomName: ROOM,
      rooms: [standardRoom(ROOM, 300, 3)],
      maxTicks: 2200,
      cpuLimit: 2,
      cpuBucket: 8000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "bucket<100 进入、带内保持、≥500 退出；ESM 期间 P1+ 让位、bot 存活",
    async () => {
      // ── 暖机：bucket≈8000，无 ESM ──
      let logs = (await runner.runTicks(200)).flatMap((s) => s.consoleLogs);
      errorsSeen += logs.filter(isJsError).length;

      // ── ①注入 bucket=50 → ESM 进入 ──
      await injectCpu(runner, { cpuAvailable: 50 });
      logs = (await runner.runTicks(200)).flatMap((s) => s.consoleLogs);
      errorsSeen += logs.filter(isJsError).length;
      const enterSeen = logs.some((l) => l.includes("emergency survival: ENTER"));
      expect(enterSeen, `bucket<100 应触发 ESM 进入。日志尾部: ${logs.slice(-8).join(" | ")}`).toBe(true);

      // ESM 期间：非 harvester 角色 + P1+ 系统让位（skip 记账）。
      const mem1 = await runner.bot.getMemory();
      const skips = Object.keys(mem1?.kernel?.skipReasons ?? {});
      const emergencyCreepSkips = skips.some((k) => k.startsWith("creep/") && k.endsWith("/emergency"));
      const budgetSystemSkips = skips.some((k) => k.startsWith("system/") && k.endsWith("/budget"));
      expect(
        emergencyCreepSkips,
        `ESM 期间应记非 harvester 角色让位 skip: ${JSON.stringify(skips.slice(0, 12))}`,
      ).toBe(true);
      expect(
        budgetSystemSkips,
        `ESM 期间 P1+ 系统应记 budget skip: ${JSON.stringify(skips.slice(0, 12))}`,
      ).toBe(true);

      // ── ②注入 bucket=400 + cpu=1（净流失）→ 带内保持（不退出）──
      // ESM 让位后用量低于 2，cpu=2 会净回流爬过 500 合法退出——cpu=1 保持带内。
      await injectCpu(runner, { cpu: 1, cpuAvailable: 400 });
      logs = (await runner.runTicks(200)).flatMap((s) => s.consoleLogs);
      errorsSeen += logs.filter(isJsError).length;
      const exitDuringBand = logs.some((l) => l.includes("emergency survival: EXIT"));
      expect(
        exitDuringBand,
        "bucket∈[100,500) 带内不应退出 ESM（保命态无滞回但退出阈为 ≥500）",
      ).toBe(false);

      // ── ③注入 bucket=800 → 退出 ──
      await injectCpu(runner, { cpuAvailable: 800 });
      logs = (await runner.runTicks(200)).flatMap((s) => s.consoleLogs);
      errorsSeen += logs.filter(isJsError).length;
      const exitSeen = logs.some((l) => l.includes("emergency survival: EXIT"));
      expect(exitSeen, "bucket≥500 应触发 ESM 退出").toBe(true);

      // ── 全程存活 + Memory 有界 ──
      const lastSnap = (await runner.runTicks(1)).at(-1)!;
      expect(
        lastSnap.totalCreeps,
        `ESM 全链走完后无 creep。\ntick=${lastSnap.tick}`,
      ).toBeGreaterThanOrEqual(1);
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `ESM soak Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);

      console.log(
        `[soak-evidence] esm binding: schemaVersion=43 sequence=50(enter)→400(band-hold)→800(exit) ` +
          `ticks=800 collectedAt=${new Date().toISOString()}`,
      );
    },
    600000,
  );
});
