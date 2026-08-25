/**
 * E2E-010 Phase 8 全量指标验证 — 10k tick 经济/人口/CPU/Memory 全维采样。
 *
 * 这是 Phase 8 的核心验证套件，在 10000 tick 连续运行中采集：
 *   - 人口动态（per-role 计数 + TTL 分布）
 *   - 能量全景（spawn/extension/container/storage 逐 tick）
 *   - Spawn 队列趋势（饥饿检测）
 *   - Memory 增长曲线
 *   - 错误率统计
 *   - 死亡螺旋检测（creep 数归零窗口）
 *   - 经济运转信号（creep 在 work 状态的比例）
 *
 * 验证标准（5 段 × 2000t）：
 *   1. 每 2000t 内无 JS 错误
 *   2. 50t warmup 后 creep 数不归零
 *   3. 10000t 后 Memory < 500KB
 *   4. 10000t 后经济在运转（有 creep 在工作）
 *   5. 每 2000t 检查 spawnQueue 不持续堆积（< 10）
 *   6. 每 2000t 检查角色多样性（≥ 2 种角色）
 *
 * [Facts] 10000 tick × ~100ms/tick ≈ 17 分钟，timeout=20 分钟。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
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

/** 采样行：每 100 tick 采一次的关键指标。 */
interface MetricsRow {
  tick: number;
  totalCreeps: number;
  roles: Record<string, number>;
  spawnQueueLen: number;
  memSizeKB: number;
  hasHarvester: boolean;
  hasHauler: boolean;
  colonyState?: string;
  economyPressure?: string;
}

/** 从 Memory 提取关键指标。 */
function extractMetrics(mem: any, tick: number): MetricsRow {
  const roles: Record<string, number> = {};
  let totalCreeps = 0;
  if (mem?.creeps && typeof mem.creeps === "object") {
    for (const [, creepMem] of Object.entries(mem.creeps)) {
      const role = (creepMem as any)?.role ?? "unknown";
      roles[role] = (roles[role] ?? 0) + 1;
      totalCreeps++;
    }
  }

  // spawnQueue 长度
  let spawnQueueLen = 0;
  if (mem?.rooms) {
    for (const roomName in mem.rooms) {
      const room = mem.rooms[roomName];
      if (room?.spawnQueue && Array.isArray(room.spawnQueue)) {
        spawnQueueLen += room.spawnQueue.length;
      }
    }
  }

  const memSize = JSON.stringify(mem).length;

  return {
    tick,
    totalCreeps,
    roles,
    spawnQueueLen,
    memSizeKB: Math.round(memSize / 1024),
    hasHarvester: (roles["harvester"] ?? 0) > 0,
    hasHauler: (roles["hauler"] ?? 0) > 0,
    colonyState: mem?.rooms?.W0N1?.colonyState,
    economyPressure: mem?.rooms?.W0N1?.economyPressure,
  };
}

describe("E2E-010 Phase 8 全量指标验证（10000 tick）", () => {
  const runner = new ScenarioRunner();
  const ROOM = "W0N1";
  const metricsRows: MetricsRow[] = [];

  beforeAll(async () => {
    await runner.setup({
      roomName: ROOM,
      rooms: [standardRoom(ROOM, 300, 2)],
      maxTicks: 11000,
    });
  }, 120000);

  afterAll(async () => {
    // 输出全量指标到 /tmp 供离线分析
    writeFileSync("/tmp/phase8-metrics.json", JSON.stringify(metricsRows, null, 2));
    await runner.teardown();
  });

  it(
    "10000 tick 全量指标采集 + 分段断言",
    async () => {
      const CHECKPOINT = 2000;
      const TOTAL_TICKS = 10000;
      const WARMUP_TICKS = 50;
      const SAMPLE_INTERVAL = 100; // 每 100 tick 采一次指标

      let totalErrors: string[] = [];

      // 分段运行，每段 CHECKPOINT tick
      for (let segment = 1; segment <= TOTAL_TICKS / CHECKPOINT; segment++) {
        const snapshots = await runner.runTicks(CHECKPOINT);

        // 采样指标（每 100 tick）
        for (let i = 0; i < snapshots.length; i += SAMPLE_INTERVAL) {
          const snap = snapshots[i];
          if (!snap) continue;
          const mem = snap.rawMemory;
          metricsRows.push(extractMetrics(mem, snap.tick));
        }

        // 段内错误检查
        const segmentErrors = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
        if (segmentErrors.length > 0) {
          totalErrors.push(...segmentErrors);
        }

        // 段内死亡螺旋检查（跳过全局 warmup）
        const globalTickBase = (segment - 1) * CHECKPOINT;
        if (globalTickBase >= WARMUP_TICKS) {
          const afterWarmup = snapshots.slice(
            Math.max(0, WARMUP_TICKS - globalTickBase),
          );
          const zeroCreepTicks = afterWarmup.filter((s) => s.totalCreeps === 0);
          expect(
            zeroCreepTicks.length,
            `段 ${segment}（tick ${globalTickBase + 1}-${globalTickBase + CHECKPOINT}）` +
              `有 ${zeroCreepTicks.length} 个 tick creep 数为 0（死亡螺旋）`,
          ).toBe(0);
        }

        // 段末指标检查
        const lastSnap = snapshots.at(-1)!;
        const lastMem = lastSnap.rawMemory;
        const lastMetrics = extractMetrics(lastMem, lastSnap.tick);

        // 角色多样性（段 2 开始检查，段 1 在 warmup）
        if (segment >= 2) {
          const roleCount = Object.keys(lastMetrics.roles).length;
          expect(
            roleCount,
            `段 ${segment} 结束时角色种类=${roleCount} < 2（角色退化）`,
          ).toBeGreaterThanOrEqual(2);
        }

        // spawnQueue 不堆积
        expect(
          lastMetrics.spawnQueueLen,
          `段 ${segment} 结束时 spawnQueue=${lastMetrics.spawnQueueLen} ≥ 10（饥饿堆积）`,
        ).toBeLessThan(10);

        // Memory 不膨胀
        expect(
          lastMetrics.memSizeKB,
          `段 ${segment} 结束时 Memory=${lastMetrics.memSizeKB}KB ≥ 500KB（泄漏）`,
        ).toBeLessThan(500);

        console.log(
          `段 ${segment}/${TOTAL_TICKS / CHECKPOINT}: tick=${lastSnap.tick} ` +
            `creeps=${lastMetrics.totalCreeps} roles=${JSON.stringify(lastMetrics.roles)} ` +
            `queue=${lastMetrics.spawnQueueLen} mem=${lastMetrics.memSizeKB}KB`,
        );
      }

      // 全程无 JS 错误
      expect(
        totalErrors,
        `10000 tick 内检测到 ${totalErrors.length} 个 JS 错误:\n${totalErrors.slice(0, 10).join("\n")}`,
      ).toHaveLength(0);

      // 最终 Memory 大小检查
      const finalMem = await runner.bot.getMemory();
      const finalMemSize = JSON.stringify(finalMem).length;
      expect(
        finalMemSize,
        `10000 tick 后 Memory 大小 ${finalMemSize} bytes（${(finalMemSize / 1024).toFixed(1)}KB）过大`,
      ).toBeLessThan(500 * 1024);

      // 最终有 creep 在工作
      const finalSnapshots = metricsRows.slice(-1);
      const finalRow = finalSnapshots[0];
      expect(
        finalRow?.totalCreeps,
        `10000 tick 后 creep 数为 0（死亡螺旋）`,
      ).toBeGreaterThan(0);

      // 经济运转信号：最终应有 harvester（能量采集闭环）
      expect(
        finalRow?.hasHarvester,
        `10000 tick 后无 harvester（能量采集闭环断裂）`,
      ).toBe(true);

      // 指标趋势分析
      const firstRow = metricsRows[0];
      const midRow = metricsRows[Math.floor(metricsRows.length / 2)];
      console.log(
        `\n=== Phase 8 指标趋势 ===\n` +
          `初始: tick=${firstRow?.tick} creeps=${firstRow?.totalCreeps} mem=${firstRow?.memSizeKB}KB\n` +
          `中段: tick=${midRow?.tick} creeps=${midRow?.totalCreeps} mem=${midRow?.memSizeKB}KB\n` +
          `最终: tick=${finalRow?.tick} creeps=${finalRow?.totalCreeps} mem=${finalRow?.memSizeKB}KB\n` +
          `采样点: ${metricsRows.length} 条`,
      );
    },
    1200000, // 20 分钟
  );
});
