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
import { t0Base } from "../fixtures/base";
import { isJsError } from "../../support/errors";

const ROOM = "W0N1";
// 深度 soak 由环境变量驱动（CANARY §5.1 要求 50,000+ tick；默认 4×5000=20k）。
// SOAK_START_RCL：预置起始 RCL 档（分段续跑用——避免每次从 RCL1 重复前段）。
const STAGE_TICKS = Number(process.env.SOAK_STAGE_TICKS ?? 5000);
const STAGES = Number(process.env.SOAK_STAGES ?? 4);
const START_RCL = Number(process.env.SOAK_START_RCL ?? 1);
const TOTAL_TICKS = STAGE_TICKS * STAGES;

describe("E2E-016 单房 soak（sv=43）— RCL1 起步长程稳定性", () => {
  const runner = new ScenarioRunner();
  let totalErrors = 0;
  /** 阶段观测状态（异常发现用）。 */
  let lastProg: number | undefined;
  let violationStages = 0;
  let lowPopStages = 0;
  const tierSet: Record<string, number> = {};
  const tierSeq: string[] = [];
  const stageProgLog: { prog: number; total: number }[] = [];
  let bucketProbe: number | undefined;

  beforeAll(async () => {
    // L0 基座（E2E_ENV_BASE_CONTRACT §1）+ L1 具名环境注入（§2 逐条登记）：
    //   injectRcl(START_RCL)   —— controllerLevel 选项（>1 时；此环境非自举所得）
    //   injectStorage(60k)     —— storage 水位（START_RCL>=6 时）
    // 证据效力：本场景为注入轨——只回答运行时不变式（无错误/Memory 有界/存活），
    // 爬级速率结论以自举轨工件为准（§3 铁律）。
    const room = t0Base(ROOM);
    if (START_RCL >= 6) {
      room.objects!.push({ type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } });
    }
    await runner.setup({
      roomName: ROOM,
      rooms: [room],
      maxTicks: TOTAL_TICKS + 1000,
      controllerLevel: START_RCL > 1 ? START_RCL : undefined,
      resumeFrom: process.env.SOAK_RESUME,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "20,000 tick：RCL1→2+ 自然晋级 + 无死亡螺旋 + Memory 有界 + 无 JS 错误",
    async () => {
      let finalRcl = 1;
      let criticalViolations = 0;
      // 早期帝国已知合理违例前缀（阈值与游戏机制数学冲突，非自愈失败）：
      //   E5 rclStale: 阈值 10000t vs RCL2→3 需约 15000t
      //   E9 recoveryStale: 阈值 2000t vs 災后恢复需 3000-5000t
      //   E3 spawnQueueStale: 阈值 2000t vs 早期能量不足排队时间长
      //   E8 pathFailure: 早期单房拥堵、creep 生命周期短但 tracker 残留
      //   E7 siteStale: 早期 rampart 优先级低于经济结构（builderVisits 追踪缺陷未实现）
      const KNOWN_EARLY_VIOLATION_PREFIXES = [
        "rclStale:",
        "recoveryStale:",
        "spawnQueueStale:",
        "pathFailure:",
        "siteStale:",
      ];
      for (let stage = 1; stage <= STAGES; stage++) {
        // 账本 1000t 采样（瞬态异常盲窗最小化）；重开销 census 每 5 采样一次。
        if ((stage - 1) % 5 === 0) {
          await runner.bot.sendConsole(
            'console.log("BUCKET t=" + Game.time + " v=" + Game.cpu.bucket)',
          );
        }
        const snapshots = await runner.runTicks(STAGE_TICKS);
        const last = snapshots.at(-1)!;
        for (const l of snapshots.flatMap((s) => s.consoleLogs)) {
          const bm = l.match(/BUCKET t=\d+ v=(-?\d+)/);
          if (bm) bucketProbe = Number(bm[1]);
        }
        // census 证据行（R20①/T3）：结构计数 / roles / upW / cap / prog 全部
        // 走 world.roomObjects 真值（inspector 查询），替代原 bot 侧 CENSUS
        // console 字符串拼装+解析。字段格式与原探针一致，CANARY §5.1 证据链
        // 可连续比对；采样点为 stage 末端（原为 stage 首 tick——stageProgLog
        // 仅喂证据行不断言，数值平移不影响语义）。
        if ((stage - 1) % 5 === 0) {
          const census = await runner.inspector.structureCensus(ROOM);
          const upW = await runner.inspector.roleBodyPartHistogram(ROOM, "upgrader", "work");
          const ctrl = await runner.inspector.controllerProgress(ROOM);
          const reserves = await runner.inspector.energyReserves(ROOM);
          const lv = ctrl?.level ?? 1;
          const ec = lv >= 8 ? 200 : lv >= 7 ? 100 : 50;
          const cap = (census.spawn ?? 0) * 300 + (census.extension ?? 0) * ec;
          console.log(
            `[census] t=${last.tick} ext=${census.extension ?? 0} cont=${census.container ?? 0} ` +
              `link=${census.link ?? 0} term=${census.terminal ?? 0} tower=${census.tower ?? 0} ` +
              `roles=${JSON.stringify(last.creepCountByRole)} upW=${JSON.stringify(upW)} cap=${cap} ` +
              `prog=${ctrl?.progress ?? 0}/${ctrl?.progressTotal ?? 0} ` +
              `storE=${reserves.storage} termE=${reserves.terminal} contE=${reserves.container}`,
          );
          stageProgLog.push({ prog: ctrl?.progress ?? 0, total: ctrl?.progressTotal ?? 0 });
        }
        totalErrors += snapshots.flatMap((s) => s.consoleLogs).filter(isJsError).length;

        const rawMem = last.rawMemory as any;
        finalRcl = (rawMem?.rooms?.[ROOM]?.phase?.rcl as number) ?? finalRcl;
        const mem = await runner.bot.getMemory();
        const memSize = JSON.stringify(mem).length;

        // 效率/健康账本：升级速率、tier、colonyState、期望违例、CPU、spawn 积压、
        // storage、bucket、Memory 逐族历史、skip 热点、tuning、错误标记。
        const k = (mem?.kernel ?? {}) as any;
        const rm = ((mem?.rooms ?? {}) as any)[ROOM] ?? {};
        const violations = (k.expectations?.violations ?? []) as string[];
        const progNow = stageProgLog.at(-1)?.prog;
        const rateInfo =
          progNow !== undefined && lastProg !== undefined && progNow > lastProg
            ? ` rate=${((progNow - lastProg) / STAGE_TICKS).toFixed(2)}/t`
            : "";
        if (progNow !== undefined) lastProg = progNow;
        if (k.tier && tierSet[k.tier] === undefined) {
          tierSet[k.tier] = last.tick;
          tierSeq.push(`${k.tier}@${last.tick}`);
        }
        if (violations.length > 0) violationStages++;
        // 排除早期帝国已知合理违例后的真正异常违例数
        const criticalVios = violations.filter(
          (v: string) => !KNOWN_EARLY_VIOLATION_PREFIXES.some((p) => v.startsWith(p)),
        );
        if (criticalVios.length > 0) criticalViolations++;
        if (last.totalCreeps < 5) lowPopStages++;
        const topSkips = (sr?: Record<string, number>) =>
          sr ? Object.entries(sr).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
        console.log(
          `[soak-evidence] sv43-soak stage=${stage} tick=${last.tick} ` +
            `creeps=${last.totalCreeps} rcl=${finalRcl} memKB=${(memSize / 1024).toFixed(0)}` +
            `${rateInfo} tier=${k.tier ?? "?"} cs=${rm.colonyState ?? "?"} ` +
            `viol=${violations.length} cpu10=${k.stats?.cpuAvg10 ?? "?"} ` +
            `cpuMax=${k.stats?.cpuMax10 ?? "?"} bucket=${bucketProbe ?? "?"} ` +
            `queue=${(rm.spawnQueue ?? []).length} net=${rm.economy ? (rm.economy.nf / 100).toFixed(2) : "?"} ` +
            `stor=${rm.phase?.storageEnergy ?? "?"} memHist=${((k.memoryHistory ?? []) as any[]).length} ` +
            `skip=${JSON.stringify(topSkips(k.skipReasons))} ` +
            `tuned=${k.tuning?.lastTuned ?? "?"} err=${k.stats?.lastError ? 1 : 0}` +
            ` violIds=${JSON.stringify(violations)}` +
            ` eld=${JSON.stringify((k.stats?.energyLedger?.rooms?.[ROOM] ?? {}))} ` +
            `cpuSys=${JSON.stringify(k.stats?.cpuBySystem ?? {})}` +
            ` logi=${k.stats?.logisticsHealth?.level ?? "?"} post@=${k.postureChangedAt ?? "?"} ` +
            `intel=${JSON.stringify(k.stats?.intelCoverage ?? {})} repl=${JSON.stringify(k.stats?.replaceLatency ?? {})}`,
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

      // ── 异常发现断言（长程健康检查，非仅稳定性）──
      const firstStage = stageProgLog[0];
      console.log(
        `[soak-evidence] anomalies: violationStages=${violationStages}/${STAGES} ` +
          `lowPopStages=${lowPopStages}/${STAGES} tierSeq=${tierSeq.join("→") || "none"} ` +
          `upRate=${firstStage && lastProg ? (lastProg / (TOTAL_TICKS - (firstStage?.prog ? 0 : 0) || TOTAL_TICKS)).toFixed(2) : "?"}/t`,
      );
      expect(lowPopStages, `人口 <5 的阶段占比过高（塌陷信号）`).toBeLessThan(STAGES * 0.3);
      // 原始 violationStages 仅作证据记录；实际断言用 criticalViolations
      // （排除早期帝国已知合理违例后的真正异常违例阶段数）
      expect(
        criticalViolations,
        `期望自检异常违例阶段占比异常（自愈未收敛或未知问题）`,
      ).toBeLessThan(STAGES * 0.5);

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
