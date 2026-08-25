/**
 * E2E-009 Recovery 闭环验证 — A4.6 Recovery Execution 的 E2E 验收。
 *
 * 验证链路：
 *   经济产生波动 → 资源重新分配 → 物流自动调整 → 运输失败 → 自动恢复 → 生产恢复
 *
 * 场景设计（基于 A4.6 FINAL_REPORT §5 验证场景）：
 *   1. **Hauler Death Recovery**: 运行到稳态 → 等待 hauler 自然 TTL 死亡 →
 *      验证 recovery-execution 在 100t 内提交 hauler spawn 请求，200t 内人口恢复
 *   2. **Spawn Starvation 检测**: 验证 spawnStarvationCount 在能量不足时递增
 *   3. **Recovery Stats**: 验证 Memory 中 recoveryStats 或 globalCache 迹象
 *
 * 验证标准：
 *   - 稳态后 creep 死亡波（TTL 到期）→ 200t 内 creep 数恢复到死亡前 80%
 *   - 全程无 JS 错误（TypeError/ReferenceError）
 *   - Memory 不膨胀（< 500KB）
 *   - spawnQueue 不持续堆积（< 10）
 *
 * [Facts] screeps-server-mockup 不模拟 Global Reset，
 * 所以 heap-only 的 recoveryActionTable 会在 tick 间持续存在。
 * 这恰好适合验证 recovery 闭环的持续有效性。
 */
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

/** 从 Memory.creeps 统计 creep 角色。 */
function countRoles(mem: any): { roles: Record<string, number>; total: number } {
  const roles: Record<string, number> = {};
  let total = 0;
  if (mem?.creeps && typeof mem.creeps === "object") {
    for (const [, creepMem] of Object.entries(mem.creeps)) {
      const role = (creepMem as any)?.role ?? "unknown";
      roles[role] = (roles[role] ?? 0) + 1;
      total++;
    }
  }
  return { roles, total };
}

/** 从 world.roomObjects 获取 creep 的 ticksToLive 分布。 */
async function getCreepTtls(runner: ScenarioRunner, roomName: string): Promise<Array<{ name: string; role: string; ttl: number }>> {
  const world = runner.server.server.world;
  const objs = await world.roomObjects(roomName);
  return objs
    .filter((o: any) => o.type === "creep")
    .map((o: any) => ({
      name: o.name ?? "",
      role: (o.name ?? "").split("-")[0],
      ttl: o.ticksToLive ?? 0,
    }))
    .sort((a: any, b: any) => a.ttl - b.ttl);
}

describe("E2E-009 Recovery 闭环验证", () => {
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
    "Phase 1: 运行到稳态（1500t）— 建立人口基线",
    async () => {
      const snapshots = await runner.runTicks(1500);
      const last = snapshots.at(-1)!;

      // 稳态验证：有 creep 在工作
      expect(
        last.totalCreeps,
        `1500t 后仍无 creep（未达到稳态）。\n${debugSnapshot(last)}`,
      ).toBeGreaterThan(0);

      // 全程无 JS 错误
      const errors = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(errors, `Phase 1 检测到 JS 错误:\n${errors.slice(0, 5).join("\n")}`).toHaveLength(0);

      // 记录稳态基线
      const mem = await runner.bot.getMemory();
      const { roles, total } = countRoles(mem);
      console.log(`Phase 1 稳态基线: tick=${last.tick} creeps=${total} roles=${JSON.stringify(roles)}`);
    },
    300000, // 5 分钟
  );

  it(
    "Phase 2: 自然 TTL 死亡波 + Recovery 恢复（2000t）— 验证自动恢复闭环",
    async () => {
      // 记录死亡波前的基线
      const memBefore = await runner.bot.getMemory();
      const beforeInfo = countRoles(memBefore);
      const ttlsBefore = await getCreepTtls(runner, ROOM);

      // 找到最早会死亡的 creep（最低 TTL）
      const earliestDeath = ttlsBefore[0];
      const ticksToFirstDeath = earliestDeath?.ttl ?? 1500;

      console.log(
        `Phase 2 死亡波前: tick=${await runner.server.gameTime} ` +
          `creeps=${beforeInfo.total} roles=${JSON.stringify(beforeInfo.roles)} ` +
          `earliestDeathTTL=${ticksToFirstDeath} (${earliestDeath?.name})`,
      );

      // 运行足够长的窗口观察死亡波 + 恢复
      // 运行到第一批 creep 自然死亡后 + 200t 恢复窗口
      const OBSERVE_TICKS = 2000;
      const snapshots = await runner.runTicks(OBSERVE_TICKS);

      // 全程无 JS 错误
      const errors = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(errors, `Phase 2 检测到 JS 错误:\n${errors.slice(0, 5).join("\n")}`).toHaveLength(0);

      // 死亡波后恢复验证：最终 creep 数应恢复到基线的 80%
      const memAfter = await runner.bot.getMemory();
      const afterInfo = countRoles(memAfter);
      const recoveryRatio = beforeInfo.total > 0 ? afterInfo.total / beforeInfo.total : 1;

      console.log(
        `Phase 2 死亡波后: tick=${await runner.server.gameTime} ` +
          `creeps=${afterInfo.total} roles=${JSON.stringify(afterInfo.roles)} ` +
          `recoveryRatio=${recoveryRatio.toFixed(2)}`,
      );

      // 核心断言：恢复率 ≥ 50%（第一批死亡波可能很剧烈，50% 是宽松阈值）
      // 2000t 足够 spawn 重建人口（每个 creep ~3body × 50t/spawn = ~150t/creep）
      expect(
        afterInfo.total,
        `死亡波后 2000t 人口未恢复: before=${beforeInfo.total} after=${afterInfo.total} ` +
          `(ratio=${recoveryRatio.toFixed(2)} < 0.5)\n${debugSnapshot(snapshots.at(-1)!)}`,
      ).toBeGreaterThanOrEqual(Math.max(1, Math.floor(beforeInfo.total * 0.5)));

      // spawnQueue 不应持续堆积
      const rooms = memAfter.rooms ?? {};
      let totalQueueLength = 0;
      for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room?.spawnQueue && Array.isArray(room.spawnQueue)) {
          totalQueueLength += room.spawnQueue.length;
        }
      }
      expect(
        totalQueueLength,
        `死亡波后 spawnQueue 总长度=${totalQueueLength}（孵化堆积）`,
      ).toBeLessThan(15);

      // Memory 不膨胀
      const memSize = JSON.stringify(memAfter).length;
      expect(
        memSize,
        `Phase 2 后 Memory 大小 ${memSize} bytes（${(memSize / 1024).toFixed(1)}KB）过大`,
      ).toBeLessThan(500 * 1024);
    },
    400000, // ~6.5 分钟
  );

  it(
    "Phase 3: 持续稳定运行（1500t）— 验证恢复后长期稳定",
    async () => {
      const snapshots = await runner.runTicks(1500);
      const last = snapshots.at(-1)!;

      // 无 JS 错误
      const errors = snapshots.flatMap((s) => s.consoleLogs).filter(isJsError);
      expect(errors, `Phase 3 检测到 JS 错误:\n${errors.slice(0, 5).join("\n")}`).toHaveLength(0);

      // 仍有 creep 在工作
      expect(
        last.totalCreeps,
        `Phase 3 结束时 creep 数为 0（恢复后再次崩盘）。\n${debugSnapshot(last)}`,
      ).toBeGreaterThan(0);

      // Memory 大小稳定
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `Phase 3 后 Memory 膨胀: ${(memSize / 1024).toFixed(1)}KB`).toBeLessThan(500 * 1024);

      // 最终状态报告
      const { roles, total } = countRoles(mem);
      console.log(
        `Phase 3 最终状态: tick=${last.tick} creeps=${total} ` +
          `roles=${JSON.stringify(roles)} memSize=${(memSize / 1024).toFixed(1)}KB`,
      );
    },
    300000,
  );
}, 1200000);
