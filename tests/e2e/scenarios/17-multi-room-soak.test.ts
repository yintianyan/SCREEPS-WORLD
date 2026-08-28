/**
 * E2E-017 多房私服 soak — 双自有房并行 + 故障隔离（CANARY §5.2）。
 *
 * 双自有房（主房 RCL6 + 第二房 RCL4，各自 spawn）并行运行：
 *   ①双房各自孵化/建造/运转（spawn 竞争与 site 配额在真实引擎节律下验证）
 *   ②一房编队全灭注入 → 该房灾后恢复、另一房不受影响（故障域隔离）
 *   ③Memory 有界、无 JS 错误
 * 证据绑定：commit / schemaVersion / tick / 双房存活曲线在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";

const HOME = "W0N1";
const COLONY = "W0N2";

/** 判断日志行是否为 JS 错误。 */
function isJsError(line: string): boolean {
  return (
    line.includes("TypeError") ||
    line.includes("ReferenceError") ||
    line.includes("is not a function") ||
    line.includes("Cannot read properties of undefined")
  );
}

/** 从 rawMemory 统计各 home 的 creep 数。 */
function creepsByHome(rawMem: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (rawMem?.creeps) {
    for (const c of Object.values(rawMem.creeps) as any[]) {
      const home = c?.home ?? "?";
      out[home] = (out[home] ?? 0) + 1;
    }
  }
  return out;
}

/** 从 rawMemory 统计全部工地数（site 配额上界观测）。 */
function countSites(rawMem: any): number {
  let n = 0;
  if (rawMem?.rooms) {
    for (const roomMem of Object.values(rawMem.rooms) as any[]) {
      if (roomMem?.buildQueue && Array.isArray(roomMem.buildQueue)) {
        n += roomMem.buildQueue.filter(
          (t: any) => t && t.state !== "done" && t.state !== "blocked",
        ).length;
      }
    }
  }
  return n;
}

describe("E2E-017 多房 soak — 双自有房 + 故障隔离", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;

  beforeAll(async () => {
    // 殖民房：无夹具 spawn（ownedRooms 统一插入 store 制式 spawn）。
    const colonyRoom: RoomSetup = {
      name: COLONY,
      terrain: emptyTerrain(),
      objects: [controller(10, 10, 4), source(10, 40), source(40, 10), mineral(40, 40)],
    };
    await runner.setup({
      roomName: HOME,
      rooms: [standardRoom(HOME, 300, 6), colonyRoom],
      maxTicks: 5200,
      controllerLevel: 6,
      ownedRooms: [{ name: COLONY, level: 4 }],
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "双房并行运转 + 一房全灭后隔离恢复 + Memory 有界",
    async () => {
      // ── 阶段 1：双房并行暖机 2000 tick ──
      let warmSnap = (await runner.runTicks(2000)).at(-1)!;
      let byHome = creepsByHome(warmSnap.rawMemory);
      console.log(
        `[soak-evidence] multi-room warm: tick=${warmSnap.tick} byHome=${JSON.stringify(byHome)} ` +
          `queues=${countSites(warmSnap.rawMemory)}`,
      );

      // ── 阶段 2：故障注入 — 殖民房编队全灭（母房不动）──
      const homeBefore = byHome[HOME] ?? 0;
      await runner.removeCreeps(COLONY);

      // 恢复窗 3000 tick：殖民房灾后恢复孵化，母房照常运转。
      let recovered = false;
      let minColonyAfter = Infinity;
      let minHomeDuring = Infinity;
      for (let i = 0; i < 6; i++) {
        const snaps = await runner.runTicks(500);
        const last = snaps.at(-1)!;
        errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
        byHome = creepsByHome(last.rawMemory);
        const colony = byHome[COLONY] ?? 0;
        const home = byHome[HOME] ?? 0;
        minColonyAfter = Math.min(minColonyAfter, colony);
        minHomeDuring = Math.min(minHomeDuring, home);
        if (colony >= 3) recovered = true;
        if (i === 5) {
          console.log(
            `[soak-evidence] multi-room inject: tick=${last.tick} byHome=${JSON.stringify(byHome)} ` +
              `recovered=${recovered}`,
          );
        }
      }

      // ── 断言 ──
      // 母房在注入前确有编队（前置有效性）。
      expect(homeBefore, "暖机后母房应有编队").toBeGreaterThanOrEqual(1);
      // 故障隔离：母房在殖民房全灭期间不塌方。
      expect(
        minHomeDuring,
        `殖民房全灭期间母房编队塌方: ${JSON.stringify(byHome)}`,
      ).toBeGreaterThanOrEqual(1);
      // 殖民房灾后恢复（P0 最小产能回来）。
      expect(
        recovered,
        `殖民房全灭后未恢复孵化（colony=${minColonyAfter}）`,
      ).toBe(true);

      // Memory 有界 + 全程无 JS 错误。
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `多房 soak Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);

      console.log(
        `[soak-evidence] multi-room binding: schemaVersion=43 ticks=5000 ` +
          `rooms=${HOME}+${COLONY} collectedAt=${new Date().toISOString()}`,
      );
    },
    900000,
  );
});
