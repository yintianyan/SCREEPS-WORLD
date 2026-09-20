/**
 * E2E-030 CPU 规模外推 —— cpu/tick 与引擎意图签发数随 creep 数的增长斜率。
 *
 * 定标已确立成本模型 `tick CPU ≈ Σ(每 creep 每 tick 的引擎意图签发数) × ≈0.2`，
 * 但单房夹具的人口卡在个位数，任何「省了 X%」都换算不到目标规模。本场景把自有房数
 * 推到 3 房，让自然演化把人口拉上几十只，再对 creep 数做最小二乘回归求出：
 *   · 每 creep 的边际 CPU（斜率）与固定成本（截距）
 *   · 每 creep 每 tick 的意图签发数（模型的核心自变量）
 *   → 由此外推给定 CPU 预算下的人口上限。
 *
 * 观测档位全程记录，用来证明读数不是被 CPU 上限掐住的结果（throttled 会使斜率失真）。
 * 产物 tmp/cpu-scaling.json（已 gitignore）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ScenarioRunner } from "../framework";
import { developedRoom } from "../fixtures/rooms";
import type { RoomSetup } from "../framework/WorldBuilder";
import {
  buildProbe,
  collectProbes,
  toProbeSample,
  linreg,
  percentile,
  aggregate,
  type ProbeSample,
} from "../framework/CpuProbe";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
/** 自有房数（含主房）。规模外推自变量，可用 env 覆盖做多档对照。 */
const HOME_RCL = Number(process.env.CPU_SCALE_HOME_RCL ?? 6);
const COLONY_RCL = Number(process.env.CPU_SCALE_COLONY_RCL ?? 5);
const ROOMS = Math.max(1, Number(process.env.CPU_SCALE_ROOMS ?? 3));
/** 暖机 tick 数：让 spawn 需求分析把人口推到与房间数相称的水平。 */
const WARMUP = Number(process.env.CPU_SCALE_WARMUP ?? 1800);
const SAMPLED = Number(process.env.CPU_SCALE_WINDOW ?? 1200);

const COLONY_NAMES = ["W0N2", "W0N3", "W0N4", "W0N5", "W0N6", "W0N7", "W0N8"].slice(
  0,
  Math.max(0, ROOMS - 1),
);

/** 每 tick 引擎意图签发总数。 */
const issuedTotal = (s: ProbeSample): number =>
  Object.values(s.issued).reduce((a, b) => a + b.total, 0);
/** 每 tick 无效签发数（非 OK 返回码）。 */
const issuedRefused = (s: ProbeSample): number =>
  Object.values(s.issued).reduce(
    (a, b) => a + Object.values(b.codes).reduce((x, n) => x + n, 0),
    0,
  );

describe("E2E-030 CPU 规模外推 — 每 creep 边际成本与人口上限", () => {
  const runner = new ScenarioRunner();
  const samples: ProbeSample[] = [];
  let errorsSeen = 0;

  beforeAll(async () => {
    // 规模场景必须跑在「已开发房」上：白送高 RCL 而无 extension 的世界会卡在
    // energyCapacityAvailable=300 的死循环里，人口与编制读数全部失真。
    const colonies: RoomSetup[] = COLONY_NAMES.map(name => developedRoom(name, COLONY_RCL));
    await runner.setup({
      roomName: HOME,
      rooms: [developedRoom(HOME, HOME_RCL), ...colonies],
      controllerLevel: 6,
      ownedRooms: COLONY_NAMES.map(name => ({ name, level: 5 })),
      maxTicks: WARMUP + SAMPLED + 600,
    });
  }, 300000);

  afterAll(async () => {
    await runner.teardown();
  });

  it("多房自然增长下回归 cpu/tick 与签发数对 creep 数的斜率", async () => {
    const warm = await runner.runTicks(WARMUP);
    errorsSeen += warm.flatMap(s => s.consoleLogs).filter(isJsError).length;
    expect(warm.at(-1)?.totalCreeps ?? 0, "暖机后人口为 0").toBeGreaterThan(0);

    const probe = buildProbe();
    for (let i = 0; i < SAMPLED; i++) {
      await runner.bot.sendConsole(probe);
      const snap = await runner.tick();
      errorsSeen += snap.consoleLogs.filter(isJsError).length;
      for (const p of collectProbes(snap.consoleLogs, "CPUB|", toProbeSample)) {
        if (!samples.some(s => s.tick === p.tick)) samples.push(p);
      }
    }

    expect(errorsSeen, `采样过程出现 ${errorsSeen} 条 JS 致命错误`).toBe(0);
    expect(samples.length, "探针未取回任何样本").toBeGreaterThan(0);

    const creepCounts = samples.map(s => s.creeps);
    const minCreeps = Math.min(...creepCounts);
    const maxCreeps = Math.max(...creepCounts);
    const popSpread = maxCreeps - minCreeps;

    const cpuFit = linreg(samples.map(s => [s.creeps, s.cpuAtProbe] as [number, number]));
    const issuedFit = linreg(samples.map(s => [s.creeps, issuedTotal(s)] as [number, number]));
    const refusedFit = linreg(samples.map(s => [s.creeps, issuedRefused(s)] as [number, number]));

    // 读数有效性：bucket 全程高于 guarded 阈值 ⇒ 引擎未限制本 tick CPU，斜率反映的是真实
    // 需求而非被节流后的截断值。跌破则本次外推不可信，必须重跑而不是照单收下斜率。
    const bucketMin = Math.min(...samples.map(s => s.bucket));
    // 节流判据两路：档位只看 bucket，但 mockup 的 bucket 可能全程常量 —— 所以再直接
    // 查「本 tick 用量是否贴到引擎给的上限」，贴顶说明读数被截断，斜率是断出来的。
    const atCeiling = samples.filter(
      s => s.tickLimit > 0 && s.cpuAtProbe >= s.tickLimit * 0.98,
    ).length;
    const throttled = bucketMin < 3000 || atCeiling > 0;

    const byRole = aggregate(samples, s => s.roleCpu);
    const byAction = aggregate(samples, s => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.actionCpu)) out[k] = v.totalCpu;
      return out;
    });
    const meanRoleCounts = aggregate(samples, s => s.roleCounts).map(r => ({
      role: r.name,
      meanCreeps: r.meanCpu,
    }));
    // 每 creep 每 tick 的决策成本：角色 CPU ÷ 在编数（角色 CPU 是全体该角色 creep 之和）。
    const countOf = new Map(meanRoleCounts.map(r => [r.role, r.meanCreeps]));
    const perCreep = byRole.map(r => ({
      role: r.name,
      meanCpu: r.meanCpu,
      creeps: countOf.get(r.name) ?? 0,
      cpuPerCreep: r.meanCpu / Math.max(countOf.get(r.name) ?? 0, 1e-9),
    }));

    const artifact = {
      meta: {
        rooms: ROOMS,
        colonyNames: COLONY_NAMES,
        warmupTicks: WARMUP,
        samples: samples.length,
        creepRange: [minCreeps, maxCreeps],
        bucketMin,
        tickLimit: Math.max(...samples.map(s => s.tickLimit)),
        ticksAtCeiling: atCeiling,
        throttled,
        /** action 级归因需要 CONFIG.debug.actionProfiling=true 的构建，否则 byAction 为空。 */
        actionProfilingEnabled: byAction.length > 0,
      },
      fit: {
        cpuPerTick: cpuFit,
        intentsPerTick: issuedFit,
        refusedPerTick: refusedFit,
        meanIntentsPerCreep:
          samples.reduce((a, s) => a + issuedTotal(s), 0) /
          Math.max(
            samples.reduce((a, s) => a + s.creeps, 0),
            1,
          ),
      },
      perCreepRoleCpu: perCreep,
      byAction,
    };

    mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
    const outPath = resolve(process.cwd(), "tmp/cpu-scaling.json");
    writeFileSync(outPath, JSON.stringify({ ...artifact, samples }, null, 2), "utf8");

    const cpuAt = (creeps: number): number => cpuFit.intercept + cpuFit.slope * creeps;
    // 只在拟合可信时外推，否则给 NaN 而不是假装有个数。
    const maxCreepsFor = (budget: number): number =>
      cpuFit.r2 > 0.5 && cpuFit.slope > 0 ? (budget - cpuFit.intercept) / cpuFit.slope : NaN;

    console.log(
      [
        `[CPU-SCALE] rooms=${ROOMS} samples=${samples.length} creeps=${minCreeps}..${maxCreeps} bucketMin=${bucketMin}`,
        [
          `[CPU-SCALE] cpu/tick = ${cpuFit.intercept.toFixed(2)} + ${cpuFit.slope.toFixed(4)}×creeps  (R²=${cpuFit.r2.toFixed(3)})`,
          `[CPU-SCALE] intents/tick = ${issuedFit.intercept.toFixed(2)} + ${issuedFit.slope.toFixed(4)}×creeps  (R²=${issuedFit.r2.toFixed(3)})`,
          `[CPU-SCALE] refused/tick = ${refusedFit.intercept.toFixed(2)} + ${refusedFit.slope.toFixed(4)}×creeps  (R²=${refusedFit.r2.toFixed(3)})`,
          `[CPU-SCALE] mean intents per creep per tick = ${artifact.fit.meanIntentsPerCreep.toFixed(3)}`,
        ].join("\n"),
        `[CPU-SCALE] cpu at 20/40/60 creeps = ${[20, 40, 60]
          .map(c => `${c}:${cpuAt(c).toFixed(2)}`)
          .join(" ")}`,
        `[CPU-SCALE] creeps fitting in 20/100 CPU = ${maxCreepsFor(20).toFixed(0)} / ${maxCreepsFor(100).toFixed(0)} (R²=${cpuFit.r2.toFixed(3)})`,
        `[CPU-SCALE] roles (mean/tick, per creep): ${perCreep
          .map(
            r =>
              `${r.role}=${r.meanCpu.toFixed(2)}/${r.creeps.toFixed(1)}=${r.cpuPerCreep.toFixed(3)}`,
          )
          .join("  ")}`,
        `[CPU-SCALE] mean cpu/tick=${(samples.reduce((a, s) => a + s.cpuAtProbe, 0) / samples.length).toFixed(3)} p95=${percentile(
          samples.map(s => s.cpuAtProbe),
          0.95,
        ).toFixed(3)}`,
        `[CPU-SCALE] top systems: ${aggregate(samples, s => s.systemCpu)
          .slice(0, 6)
          .map(x => `${x.name}=${x.meanCpu.toFixed(3)}(${x.sharePct.toFixed(0)}%)`)
          .join(" ")}`,
        byAction.length
          ? `[CPU-SCALE] top actions: ${byAction
              .slice(0, 10)
              .map(x => `${x.name}=${x.meanCpu.toFixed(3)}(${x.sharePct.toFixed(0)}%)`)
              .join(" ")}`
          : "[CPU-SCALE] byAction 为空 —— CONFIG.debug.actionProfiling 未开，本次无 action 级归因",
        Math.max(...samples.map(s => s.spawnEnergyCap)) <= 300
          ? "[CPU-SCALE] WARN 全域 energyCapacityAvailable=300（零 extension）：creep 全是最小 body，" +
            "人口数与每 creep 签发数不代表设计规模"
          : "",
        `[CPU-SCALE] ecap=${Math.max(...samples.map(s => s.spawnEnergyCap))} structs=${Math.max(
          ...samples.map(s => s.structures),
        )} popSpread=${popSpread}`,
        `[CPU-SCALE] artifact -> ${outPath}`,
      ].join("\n"),
    );

    expect(samples.length).toBeGreaterThan(50);
    // 散布门槛放在报表与产物之后：不达标仍然失败，但失败时数据必须已经落盘 ——
    // 否则「世界已进均衡、自然变化不足以回归」这种有价值的结果会连同样本一起被丢掉。
    expect(
      popSpread,
      `人口散布仅 ${popSpread}，无法回归（改用 E2E-031 台阶差分）`,
    ).toBeGreaterThanOrEqual(5);
    if (throttled) {
      // 不 fail：节流本身是合法世界状态，但斜率不可外推，日志已标 throttled=true。
      console.log("[CPU-SCALE] WARN bucket 跌破 guarded 阈值，斜率外推不可信");
    }
  }, 900000);
});
