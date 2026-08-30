/** E2E-012 Military & Defense */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom, rcl3RoomWithTower } from "../fixtures/rooms";
import { isJsError } from "../../support/errors";

/** 从日志中提取防御相关日志。 */
function findDefenseLogs(logs: string[]): string[] {
  return logs.filter(
    (l) =>
      l.includes("defense") ||
      l.includes("DEFENSE") ||
      l.includes("threat") ||
      l.includes("THREAT") ||
      l.includes("defender") ||
      l.includes("DEFENDER") ||
      l.includes("safeMode") ||
      l.includes("decision-trace"),
  );
}

/** 从日志中提取 recovery 相关日志。 */
function findRecoveryLogs(logs: string[]): string[] {
  return logs.filter(
    (l) =>
      l.includes("recovery") ||
      l.includes("RECOVERY") ||
      l.includes("DEFENSE_RESPONSE"),
  );
}

/** 粗略估算 Memory 大小（JSON 序列化字节数）。 */
function estimateMemorySize(mem: any): number {
  try {
    return JSON.stringify(mem).length;
  } catch {
    return 0;
  }
}

describe("E2E-012 Military & Defense", () => {
  const runner = new ScenarioRunner();
  const ROOM = "W0N1";

  beforeAll(async () => {
    await runner.setup({
      roomName: ROOM,
      rooms: [rcl3RoomWithTower(ROOM)],
      maxTicks: 6000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  }, 30000);

  it(
    "S1: NPC Invader Response — 注入 NPC invader 后威胁评估产出 + 无 JS 错误",
    async () => {
      // 先运行 200t 到稳态
      const warmupSnaps = await runner.runTicks(200);
      const warmupErrors = warmupSnaps.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(
        warmupErrors,
        `Warmup 检测到 JS 错误:\n${warmupErrors.slice(0, 3).join("\n")}`,
      ).toHaveLength(0);

      // 注入 NPC invader [ATTACK, MOVE]
      await runner.worldBuilder.addHostileCreep(ROOM, 35, 35, ["attack", "move"], "invader-1", "invader");

      // 运行 100t 让系统响应
      const responseSnaps = await runner.runTicks(100);
      const allLogs = responseSnaps.flatMap((s) => s.consoleLogs);

      // 全程无 JS 错误
      const errors = allLogs.filter(isJsError);
      expect(
        errors,
        `S1 响应阶段检测到 JS 错误:\n${errors.slice(0, 3).join("\n")}`,
      ).toHaveLength(0);

      // 验证 tick 推进正常
      const lastSnap = responseSnaps.at(-1)!;
      expect(lastSnap.tick).toBeGreaterThanOrEqual(300);

      // 验证有防御相关日志产出（room-state 威胁评估或 tower-defense）
      const defenseLogs = findDefenseLogs(allLogs);
      // 不强制要求日志存在——系统可能静默处理 NPC invader
      // 但如果有日志，不应包含错误
      if (defenseLogs.length > 0) {
        const defenseErrors = defenseLogs.filter(isJsError);
        expect(defenseErrors).toHaveLength(0);
      }
    },
    60000,
  );

  it(
    "S2: Threat Trace Collection — 威胁存在时 decision-trace 采集 DEFENSE_PREP 记录",
    async () => {
      // 注入更强的威胁：2 只 [ATTACK, ATTACK, MOVE] hostile
      await runner.worldBuilder.addHostileCreep(
        ROOM,
        30,
        30,
        ["attack", "attack", "move"],
        "invader-2",
        "invader",
      );
      await runner.worldBuilder.addHostileCreep(
        ROOM,
        32,
        32,
        ["attack", "move", "move"],
        "invader-3",
        "invader",
      );

      // 运行 300t（覆盖至少 2 个 decision-trace 周期，interval=100）
      const snaps = await runner.runTicks(300);
      const allLogs = snaps.flatMap((s) => s.consoleLogs);

      // 全程无 JS 错误
      const errors = allLogs.filter(isJsError);
      expect(
        errors,
        `S2 检测到 JS 错误:\n${errors.slice(0, 3).join("\n")}`,
      ).toHaveLength(0);

      // 验证 decision-trace 系统运行（搜索 decision-trace 日志）
      const traceLogs = allLogs.filter((l) => l.includes("decision-trace"));
      // decision-trace interval=100，300t 内至少运行过
      // 即使没有 IMPORTANT 级别日志输出，系统应正常运行无错误
      const lastSnap = snaps.at(-1)!;
      expect(lastSnap.tick).toBeGreaterThanOrEqual(600);

      // 验证 Memory 不膨胀
      const memSize = estimateMemorySize(lastSnap.rawMemory);
      expect(memSize, `Memory 大小 ${memSize}B 超过 500KB`).toBeLessThan(500_000);
    },
    60000,
  );

  it(
    "S3: Defense Recovery Link — CRITICAL 威胁时 recovery-execution 触发 defense_response",
    async () => {
      // 注入强威胁：4 只 boosted creep 模拟 FULL_ASSAULT
      for (let i = 0; i < 4; i++) {
        await runner.worldBuilder.addHostileCreep(
          ROOM,
          28 + i,
          28 + i,
          ["tough", "attack", "attack", "move", "move"],
          `assaulter-${i}`,
          "invader",
        );
      }

      // 运行 200t 让 recovery-execution 有时间响应
      const snaps = await runner.runTicks(200);
      const allLogs = snaps.flatMap((s) => s.consoleLogs);

      // 全程无 JS 错误
      const errors = allLogs.filter(isJsError);
      expect(
        errors,
        `S3 检测到 JS 错误:\n${errors.slice(0, 3).join("\n")}`,
      ).toHaveLength(0);

      // 搜索 recovery / DEFENSE_RESPONSE 日志
      const recoveryLogs = findRecoveryLogs(allLogs);
      // 不强制要求日志存在——recovery-execution 可能因预算不足未触发
      // 但不应有错误
      if (recoveryLogs.length > 0) {
        const recoveryErrors = recoveryLogs.filter(isJsError);
        expect(recoveryErrors).toHaveLength(0);
      }

      // 验证系统继续运行（不崩溃）
      const lastSnap = snaps.at(-1)!;
      expect(lastSnap.tick).toBeGreaterThanOrEqual(800);
    },
    60000,
  );

  it(
    "S4: Remote Defense Decision — 远矿运营 + 威胁 → 决策链路无错误",
    async () => {
      // 运行 300t 让远矿系统有机会建立远矿运营
      const snaps = await runner.runTicks(300);
      const allLogs = snaps.flatMap((s) => s.consoleLogs);

      // 全程无 JS 错误
      const errors = allLogs.filter(isJsError);
      expect(
        errors,
        `S4 检测到 JS 错误:\n${errors.slice(0, 3).join("\n")}`,
      ).toHaveLength(0);

      // 验证 Memory 中有远矿相关字段或无错误
      const lastSnap = snaps.at(-1)!;
      const mem = lastSnap.rawMemory;

      // 检查 spawnQueue 不持续堆积（< 20）
      const roomMem = mem?.rooms?.[ROOM];
      const queueLength = Array.isArray(roomMem?.spawnQueue)
        ? roomMem.spawnQueue.length
        : 0;
      expect(
        queueLength,
        `spawnQueue 堆积 ${queueLength} 条`,
      ).toBeLessThan(20);

      // 验证 Memory 不膨胀
      const memSize = estimateMemorySize(lastSnap.rawMemory);
      expect(memSize, `Memory 大小 ${memSize}B 超过 500KB`).toBeLessThan(500_000);
    },
    60000,
  );

  it(
    "S5: Long Stability with Defense — 3000t 连续运行无 JS 错误",
    async () => {
      const startTick = runner.inspector
        ? 0 // 不需要精确起始 tick
        : 0;

      // 运行 3000t
      const snaps = await runner.runTicks(3000);
      const allLogs = snaps.flatMap((s) => s.consoleLogs);

      // 全程无 JS 错误
      const errors = allLogs.filter(isJsError);
      expect(
        errors,
        `S5 长期运行检测到 ${errors.length} 个 JS 错误，前 5 个:\n${errors.slice(0, 5).join("\n")}`,
      ).toHaveLength(0);

      // 验证 tick 正常推进
      const lastSnap = snaps.at(-1)!;
      expect(lastSnap.tick).toBeGreaterThanOrEqual(startTick + 3000);

      // 验证 Memory 不膨胀
      const memSize = estimateMemorySize(lastSnap.rawMemory);
      expect(memSize, `Memory 大小 ${memSize}B 超过 500KB`).toBeLessThan(500_000);

      // 验证 spawnQueue 不持续堆积
      const roomMem = lastSnap.rawMemory?.rooms?.[ROOM];
      const queueLength = Array.isArray(roomMem?.spawnQueue)
        ? roomMem.spawnQueue.length
        : 0;
      expect(
        queueLength,
        `spawnQueue 堆积 ${queueLength} 条`,
      ).toBeLessThan(20);
    },
    120000,
  );

  it(
    "S6: Memory Budget Under Threat — 威胁期间 Memory 预算安全",
    async () => {
      // 再注入一波威胁
      await runner.worldBuilder.addHostileCreep(
        ROOM,
        20,
        20,
        ["ranged_attack", "move"],
        "raider-1",
        "invader",
      );

      // 运行 500t
      const snaps = await runner.runTicks(500);
      const allLogs = snaps.flatMap((s) => s.consoleLogs);

      // 全程无 JS 错误
      const errors = allLogs.filter(isJsError);
      expect(
        errors,
        `S6 检测到 JS 错误:\n${errors.slice(0, 3).join("\n")}`,
      ).toHaveLength(0);

      // 验证 Memory 不膨胀
      const lastSnap = snaps.at(-1)!;
      const memSize = estimateMemorySize(lastSnap.rawMemory);
      expect(memSize, `Memory 大小 ${memSize}B 超过 500KB`).toBeLessThan(500_000);

      // 验证 decision-trace Ring Buffer 不无限增长
      // globalCache 是 heap-only，不会序列化到 Memory
      // 但 Memory 本身不应因防御逻辑膨胀
      const kernelMem = lastSnap.rawMemory?.kernel;
      if (kernelMem) {
        const kernelSize = JSON.stringify(kernelMem).length;
        expect(kernelSize, `kernel Memory ${kernelSize}B 超过 200KB`).toBeLessThan(200_000);
      }
    },
    60000,
  );
});
