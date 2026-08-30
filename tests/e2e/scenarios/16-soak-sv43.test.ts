/**
 * E2E-016 单房私服 soak（当前版本 sv=43 重跑）— CANARY §5.1。
 *
 * RCL1 起步长程运行：验证 RCL1→2 自然晋级、长程无 JS 错误、Memory 有界、
 * spawnQueue 不堆积、存活不死亡螺旋。深度按 20,000 tick 执行（CANARY §5.1
 * 完整 Soak-Verified 要求 50,000+，深度继续项见 CANARY §5.1 登记表）。
 * 证据绑定：commit / schemaVersion / tick / room / collectedAt 在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";

const ROOM = "W0N1";
// 深度 soak 由环境变量驱动（CANARY §5.1 要求 50,000+ tick；默认 4×5000=20k）。
// SOAK_START_RCL：预置起始 RCL 档（分段续跑用——避免每次从 RCL1 重复前段）。
const STAGE_TICKS = Number(process.env.SOAK_STAGE_TICKS ?? 5000);
const STAGES = Number(process.env.SOAK_STAGES ?? 4);
const START_RCL = Number(process.env.SOAK_START_RCL ?? 1);
const TOTAL_TICKS = STAGE_TICKS * STAGES;

/** 判断日志行是否为 JS 错误。 */
function isJsError(line: string): boolean {
  return (
    line.includes("TypeError") ||
    line.includes("ReferenceError") ||
    line.includes("is not a function") ||
    line.includes("Cannot read properties of undefined")
  );
}

describe("E2E-016 单房 soak（sv=43）— RCL1 起步长程稳定性", () => {
  const runner = new ScenarioRunner();
  let totalErrors = 0;

  beforeAll(async () => {
    // 预置起始档：RCL6 起跑附带 storage（经济成熟态，直接进入 RCL6→7 爬升）。
    const room = standardRoom(ROOM, 300, START_RCL);
    if (START_RCL >= 6) {
      room.objects!.push({ type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } });
    }
    await runner.setup({
      roomName: ROOM,
      rooms: [room],
      maxTicks: TOTAL_TICKS + 1000,
      controllerLevel: START_RCL > 1 ? START_RCL : undefined,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "20,000 tick：RCL1→2+ 自然晋级 + 无死亡螺旋 + Memory 有界 + 无 JS 错误",
    async () => {
      let finalRcl = 1;
      for (let stage = 1; stage <= STAGES; stage++) {
        const snapshots = await runner.runTicks(STAGE_TICKS);
        const last = snapshots.at(-1)!;
        totalErrors += snapshots.flatMap((s) => s.consoleLogs).filter(isJsError).length;

        const rawMem = last.rawMemory as any;
        finalRcl = (rawMem?.rooms?.[ROOM]?.phase?.rcl as number) ?? finalRcl;
        const mem = await runner.bot.getMemory();
        const memSize = JSON.stringify(mem).length;

        console.log(
          `[soak-evidence] sv43-soak stage=${stage} tick=${last.tick} ` +
            `creeps=${last.totalCreeps} rcl=${finalRcl} memKB=${(memSize / 1024).toFixed(0)}`,
        );

        expect(
          last.totalCreeps,
          `stage ${stage}（${last.tick}t）后无 creep — 死亡螺旋。\n` +
            `tick=${last.tick} rcl=${finalRcl}`,
        ).toBeGreaterThanOrEqual(1);
        expect(memSize, `stage ${stage} Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);

        let queueLength = 0;
        const rawMem2 = last.rawMemory as any;
        if (rawMem2?.rooms) {
          for (const roomMem of Object.values(rawMem2.rooms) as any[]) {
            if (roomMem?.spawnQueue && Array.isArray(roomMem.spawnQueue)) {
              queueLength += roomMem.spawnQueue.length;
            }
          }
        }
        expect(queueLength, `stage ${stage} spawnQueue 持续堆积: ${queueLength}`).toBeLessThan(10);
      }

      expect(
        finalRcl,
        `${TOTAL_TICKS} tick 未完成 RCL1→2 晋级（rcl=${finalRcl}）`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        totalErrors,
        `全程检测到 JS 错误 ${totalErrors} 条`,
      ).toBe(0);

      console.log(
        `[soak-evidence] sv43-soak binding: schemaVersion=43 ticks=${TOTAL_TICKS} ` +
          `room=${ROOM} rclFinal=${finalRcl} jsErrors=${totalErrors} ` +
          `collectedAt=${new Date().toISOString()}`,
      );
    },
    // 超时随深度走（实测 ~14ms/tick，留 2 倍余量）。
    Math.max(1_800_000, TOTAL_TICKS * 30),
  );
});
