/**
 * E2E-015 低 CPU 私服 soak — CpuTier 降级链实测（CANARY §5.3）。
 *
 * mockup driver 按每 tick 记账（cpuAvailable += cpu − used），cpu≈实际用量时
 * bucket 净收支归零 —— 据此做确定性档位注入：cpu=2 使 bucket 稳在注入值，
 * 逐档步进（healthy→guarded→conserve→recovery）观察 bot 侧降级语义；
 * 末段恢复 cpu=100 观察 bucket 回充与滞回爬升。
 * 观测通道：经 bot console 探测引擎 Game.cpu.bucket，按 CONFIG.cpu.tiers
 * 阈值推导档位时间线。
 * 验证：四档全链发生、降级途中 bot 存活（P0 最小产能保留）、Memory 有界。
 * 证据绑定：commit / schemaVersion / tick / bucket-tier 时间线在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner, type BotSnapshot } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { CONFIG } from "../../../src/config";
import { isJsError } from "../../support/errors";

const ROOM = "W0N1";

/** CONFIG 阈值推导 CpuTier（与 scheduler bucketToTier 同口径）。 */
function bucketToTier(bucket: number): string {
  if (bucket >= CONFIG.cpu.tiers.healthy.min) return "healthy";
  if (bucket >= CONFIG.cpu.tiers.guarded.min) return "guarded";
  if (bucket >= CONFIG.cpu.tiers.conserve.min) return "conserve";
  return "recovery";
}

interface Probe {
  tick: number;
  bucket: number;
  tier: string;
}

describe("E2E-015 低 CPU soak — CpuTier 降级链", () => {
  const runner = new ScenarioRunner();
  const probes: Probe[] = [];
  let errorsSeen = 0;

  /** 探测一轮：发 console 探针 → 推进 → 解析 PROBE 行。 */
  async function probeAt(ticks: number): Promise<void> {
    await runner.bot.sendConsole(
      'console.log("PROBE tick=" + Game.time + " bucket=" + Game.cpu.bucket)',
    );
    const snapshots: BotSnapshot[] = await runner.runTicks(ticks);
    for (const snap of snapshots) {
      errorsSeen += snap.consoleLogs.filter(isJsError).length;
      for (const line of snap.consoleLogs) {
        const m = line.match(/PROBE tick=(\d+) bucket=(-?\d+)/);
        if (m) {
          probes.push({
            tick: Number(m[1]),
            bucket: Number(m[2]),
            tier: bucketToTier(Number(m[2])),
          });
        }
      }
    }
  }

  /** 运行一段（段首段尾各探测一次）。 */
  async function runStage(ticks: number): Promise<void> {
    const half = Math.floor(ticks / 2);
    await probeAt(half);
    await probeAt(ticks - half);
  }

  beforeAll(async () => {
    await runner.setup({
      roomName: ROOM,
      rooms: [standardRoom(ROOM, 300, 1)],
      maxTicks: 4200,
      cpuLimit: 2,
      cpuBucket: 8000,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "四档降级链全链发生（含滞回爬升）且 bot 存活、Memory 有界",
    async () => {
      // 段 1：cpu=2 / bucket=8000 — healthy 档基线。
      await runStage(400);
      // 段 2：注入 conserve 带（1000 ≤ b < 3000；guarded 为 3000–7000）。
      await runner.setUserCpu({ cpuAvailable: 2500 });
      await runStage(400);
      // 段 3：注入 conserve 档（b < 1000）。
      await runner.setUserCpu({ cpuAvailable: 800 });
      await runStage(400);
      // 段 4：注入 recovery 档（b 极低，逼近枯竭语义）。
      await runner.setUserCpu({ cpuAvailable: 200 });
      await runStage(600);
      // 段 5：恢复 cpu=100 + 半桶 — 回充 + 滞回爬升。
      await runner.setUserCpu({ cpu: 100, cpuAvailable: 6000 });
      await runStage(1200);

      // ── 证据登记（CANARY §4.2 绑定模板要素，供文档归档）──
      const tiers = probes.map((p) => p.tier);
      const distinctTiers = [...new Set(tiers)];
      console.log(
        `[soak-evidence] low-cpu: ticks≈3200 cpuStart=2 cpuRestored=100 ` +
          `probes=${probes.map((p) => `${p.tick}:${p.bucket}(${p.tier})`).join(",")} ` +
          `distinctTiers=${distinctTiers.join("/")} jsErrors=${errorsSeen}`,
      );

      // 四档全链发生（CANARY §5.3：tier 切换验证四档降级）。
      for (const tier of ["healthy", "guarded", "conserve", "recovery"]) {
        expect(
          distinctTiers,
          `CpuTier 时间线缺少 ${tier} 档: ${probes.map((p) => `${p.tick}:${p.bucket}(${p.tier})`).join(", ")}`,
        ).toContain(tier);
      }

      // 爬升段：最终 probe 回到 healthy（滞回升级收敛）。
      expect(
        probes.at(-1)!.tier,
        `恢复后未爬回 healthy: ${probes.map((p) => `${p.tick}:${p.bucket}(${p.tier})`).join(", ")}`,
      ).toBe("healthy");

      // 全程存活 + Memory 有界。
      const lastSnap = (await runner.runTicks(1)).at(-1)!;
      expect(
        lastSnap.totalCreeps,
        `低 CPU 降级链走完后无 creep — 死亡螺旋。\ntick=${lastSnap.tick}`,
      ).toBeGreaterThanOrEqual(1);
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `低 CPU soak Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);
    },
    600000,
  );
});
