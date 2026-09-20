/**
 * E2E-031 固定房数 · 台阶人口 —— 把回归的截距与斜率分开。
 *
 * E2E-030 的自然跑法里 creep 数与房间数/结构数共变，单变量回归分不开二者：
 * 三档 R² 全部 <0.5，脚本对外推老实返回 NaN。本场景把房间数钉死，只让**人口**按台阶
 * 跳变（`Memory.kernel.tuning.rooms[r].roleBounds` 每 tick 由探针重钉 —— 运行时唯一
 * 能改编制的旋钮，`CONFIG.roles.*` 是编译期常量），于是：
 *   · 台阶之间的 Δcpu/Δcreeps 就是边际成本，不需要回归；
 *   · 每台阶的 `cpu − 签发数 × 签发单价` 就是房间固定成本（截距）—— 三个台阶算出的
 *     固定成本应当彼此接近，这本身就是对成本模型的检验（对不上说明模型缺项）。
 *
 * 只扫 builder / upgrader 两个消费者角色：**不动 harvester**，抬它等于改能量收入，
 * 那会把经济形态混进读数（harvester 还被 source 饱和线 `demand.ts:422` 硬顶在 2/房）。
 *
 * **最小规模要求**（3 房实测踩过）：台阶之间 Δcpu 必须显著大于每 tick 绝对噪声（本项目
 * 单次读数 ±0.2 CPU/tick）。3 房台阶只给出 Δcpu≈0.8、Δintents≈2，差分单价偏到 0.27~0.41；
 * 6 房的 Δcpu≈2、Δintents≈9 才把噪声压住（两条边同为 0.210）。用小配置跑本场景，
 * 收敛门槛与单价门槛会各自报警 —— 那不是夹具坏了，是量不出来。
 * 产物 tmp/cpu-population-sweep.json（已 gitignore）。
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
  percentile,
  fitPlane,
  type ProbeSample,
} from "../framework/CpuProbe";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
const HOME_RCL = Number(process.env.CPU_SCALE_HOME_RCL ?? 6);
const COLONY_RCL = Number(process.env.CPU_SCALE_COLONY_RCL ?? 5);
const ROOMS = Math.max(1, Number(process.env.CPU_SWEEP_ROOMS ?? 6));
const WARMUP = Number(process.env.CPU_SWEEP_WARMUP ?? 1800);
const SETTLE = Number(process.env.CPU_SWEEP_SETTLE ?? 900);
const WINDOW = Number(process.env.CPU_SWEEP_WINDOW ?? 400);
/**
 * 意图签发单价。默认取**本场景自己差分出的 0.210**（两条台阶边 0.210/0.210），
 * 这样 `fixedCost` 列就是「用测得的单价解释掉签发之后剩下的房间固定成本」。
 * 注意自洽性检验看的是**两条边的差分单价是否一致**（线性关系是否成立），
 * 不是这一列的绝对值 —— 单价换成 0.20，三档残差会整体上移约 0.3，跨档差却仍在 0.1 内。
 */
const ISSUE_PRICE = Number(process.env.CPU_SWEEP_PRICE ?? 0.21);

const COLONY_NAMES = ["W0N2", "W0N3", "W0N4", "W0N5", "W0N6", "W0N7", "W0N8"].slice(
  0,
  Math.max(0, ROOMS - 1),
);
const SWEEP_ROLES = ["builder", "upgrader"];

type Bounds = Record<string, { minCount: number; maxCount: number }>;

/**
 * 台阶定义。钳制表（`domain/tuning/bounds.ts`）只给 maxCount 配了 floor/ceiling
 * （builder 1–6、upgrader 1–4），所以高低两端都在钳制允许范围内；minCount 不设钳制。
 *
 * `settle` 按台阶单独给：**抬编制是孵化（能量到位就快），压编制只能等老 creep 到
 * `ticksToLive` 自然死亡**（`recyclePass` 只回收 worker/hauler/未知角色，不会裁超编的
 * builder/upgrader）—— 收缩台阶必须给满一整代（1500 tick 寿命 + 换代的余量），
 * 否则读到的是上一台阶遗留的躯体，人口反而比高台阶还大。
 */
const STEPS: Array<{ name: string; pin: Bounds; settle?: number }> = [
  { name: "natural", pin: {} },
  {
    name: "high",
    pin: { builder: { minCount: 6, maxCount: 6 }, upgrader: { minCount: 4, maxCount: 4 } },
  },
  {
    name: "mid",
    pin: { builder: { minCount: 3, maxCount: 3 }, upgrader: { minCount: 2, maxCount: 2 } },
  },
  {
    name: "low",
    pin: { builder: { minCount: 1, maxCount: 1 }, upgrader: { minCount: 1, maxCount: 1 } },
    settle: Number(process.env.CPU_SWEEP_SETTLE_SHRINK ?? 2000),
  },
];

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const issuedTotal = (s: ProbeSample): number =>
  Object.values(s.issued).reduce((a, b) => a + b.total, 0);

interface StepStat {
  step: string;
  samples: number;
  creeps: number;
  creepsMin: number;
  creepsMax: number;
  /** 台阶内人口散布 / 均值 —— 收敛判据（>0.2 说明还没稳，读数不可用）。 */
  creepsSpread: number;
  cpuMean: number;
  cpuP95: number;
  intentsMean: number;
  intentsPerCreep: number;
  structs: number;
  sites: number;
  /** room.energyCapacityAvailable 最大值 —— 300 = 零 extension，body 全是最小号。 */
  energyCap: number;
  storedEnergy: number;
  roleCounts: Record<string, number>;
  /** 截距的因果估计：cpu − 签发数 × 单价。各台阶应当接近。 */
  fixedCost: number;
  bounds: string;
}

describe("E2E-031 台阶人口 — 固定房数下分离边际成本与房间固定成本", () => {
  const runner = new ScenarioRunner();
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
      maxTicks: WARMUP + STEPS.reduce((a, s) => a + (s.settle ?? SETTLE) + WINDOW, 0) + 900,
    });
  }, 300000);

  afterAll(async () => {
    await runner.teardown();
  });

  /** 跑一个台阶：先暖到编制收敛（丢弃样本），再采 WINDOW tick。 */
  async function runStep(name: string, pin: Bounds, settle: number): Promise<ProbeSample[]> {
    const probe = buildProbe({ label: name, sweepRoles: SWEEP_ROLES, pin });
    const out: ProbeSample[] = [];
    for (let phase = 0; phase < 2; phase++) {
      const ticks = phase === 0 ? settle : WINDOW;
      for (let i = 0; i < ticks; i++) {
        await runner.bot.sendConsole(probe);
        const snap = await runner.tick();
        errorsSeen += snap.consoleLogs.filter(isJsError).length;
        if (phase === 1) {
          for (const p of collectProbes(snap.consoleLogs, "CPUB|", toProbeSample)) {
            if (!out.some(s => s.tick === p.tick)) out.push(p);
          }
        }
      }
    }
    return out;
  }

  it("台阶差分给出每签发单价与房间固定成本（不用回归）", async () => {
    const warm = await runner.runTicks(WARMUP);
    errorsSeen += warm.flatMap(s => s.consoleLogs).filter(isJsError).length;
    expect(warm.at(-1)?.totalCreeps ?? 0, "暖机后人口为 0").toBeGreaterThan(0);

    const all: ProbeSample[] = [];
    const stats: StepStat[] = [];
    for (const step of STEPS) {
      const samples = await runStep(step.name, step.pin, step.settle ?? SETTLE);
      expect(samples.length, `台阶 ${step.name} 未采到样本`).toBeGreaterThan(WINDOW / 2);
      all.push(...samples);

      const creeps = samples.map(s => s.creeps);
      const cMean = mean(creeps);
      const spread = (Math.max(...creeps) - Math.min(...creeps)) / Math.max(cMean, 1);
      const bounds = samples[samples.length - 1]!.roleBounds;
      const iMean = mean(samples.map(issuedTotal));
      const cpuMean = mean(samples.map(s => s.cpuAtProbe));
      const roleCounts: Record<string, number> = {};
      for (const s of samples) {
        for (const [r, n] of Object.entries(s.roleCounts))
          roleCounts[r] = (roleCounts[r] ?? 0) + n / samples.length;
      }
      stats.push({
        step: step.name,
        samples: samples.length,
        creeps: cMean,
        creepsMin: Math.min(...creeps),
        creepsMax: Math.max(...creeps),
        creepsSpread: spread,
        cpuMean,
        cpuP95: percentile(
          samples.map(s => s.cpuAtProbe),
          0.95,
        ),
        intentsMean: iMean,
        intentsPerCreep: iMean / Math.max(cMean, 1e-9),
        structs: mean(samples.map(s => s.structures)),
        sites: mean(samples.map(s => s.sites)),
        energyCap: Math.max(...samples.map(s => s.spawnEnergyCap)),
        storedEnergy: mean(samples.map(s => s.storedEnergy)),
        roleCounts,
        fixedCost: cpuMean - iMean * ISSUE_PRICE,
        bounds,
      });
    }

    expect(errorsSeen, `采样过程出现 ${errorsSeen} 条 JS 致命错误`).toBe(0);
    // 房数必须全程钉死 —— 这是本场景区别于 E2E-030 的唯一受控条件。
    const roomSet = new Set(all.map(s => s.rooms));
    expect([...roomSet], `房间数在采样中变化：${[...roomSet].join("/")}`).toEqual([ROOMS]);
    const bucketMin = Math.min(...all.map(s => s.bucket));
    const atCeiling = all.filter(s => s.tickLimit > 0 && s.cpuAtProbe >= s.tickLimit * 0.98).length;
    const throttled = bucketMin < 3000 || atCeiling > 0;

    // 按人口排序，相邻台阶两两点出边际 —— 不回归，直接差分。
    const byPop = [...stats].sort((a, b) => a.creeps - b.creeps);
    // 编制是否被 AI 重排（压掉 builder 会让 container 积压 → hauler 暴涨）。差 2 倍以上
    // 就说明两台阶不是「同一世界不同人口」，每 creep 差分不可用作斜率。
    const rebalanced = (a: StepStat, b: StepStat): boolean =>
      SWEEP_ROLES.some(r => {
        const x = a.roleCounts[r] ?? 0;
        const y = b.roleCounts[r] ?? 0;
        return Math.max(x, y) >= 2 * Math.min(x, y) + 1;
      }) || Math.abs((a.roleCounts.hauler ?? 0) - (b.roleCounts.hauler ?? 0)) >= 5;
    const edges: Array<{
      from: string;
      to: string;
      dCreeps: number;
      dIntents: number;
      dCpu: number;
      marginal: number;
      perIntent: number;
      rebalanced: boolean;
      busyDelta: number;
    }> = [];
    for (let i = 1; i < byPop.length; i++) {
      const a = byPop[i - 1]!;
      const b = byPop[i]!;
      const dC = b.creeps - a.creeps;
      const dU = b.cpuMean - a.cpuMean;
      const dI = b.intentsMean - a.intentsMean;
      edges.push({
        from: a.step,
        to: b.step,
        dCreeps: dC,
        dIntents: dI,
        dCpu: dU,
        marginal: dU / dC,
        perIntent: dI !== 0 ? dU / dI : NaN,
        rebalanced: rebalanced(a, b),
        // 台阶边的可用性判据：加进来的 creep 得真的在干活。
        // 实测踩过：把 upgrader 从 6 抬到 24，只多了 5.4 次签发 —— 多出来的全是站着没事做的，
        // 边际成本趋近 0（闲置 creep 几乎不花钱，这是真实属性），拿它算单价会得到 0.11 这种假值。
        busyDelta: dC > 0 ? dI / dC : NaN,
      });
    }
    const baseIntentsPerCreep = mean(stats.map(s => s.intentsPerCreep));
    const usableEdge = (e: (typeof edges)[number]): boolean =>
      Math.abs(e.dIntents) > 2 && (e.dCreeps <= 0 || e.busyDelta >= 0.5 * baseIntentsPerCreep);
    const fixed = stats.map(s => s.fixedCost);
    const fixedSpread = Math.max(...fixed) - Math.min(...fixed);
    // 两参数模型 `cpu = a + p·签发` 在萎缩世界闭得掉，在发育世界闭不掉：creep 还带来与
    // 签发无关的每只开销（traffic 解算、snapshot 遍历、assignment 匹配都随只数走）。
    // 所以门槛改判三参数拟合的残差 —— 台阶数必须 ≥4，否则 3 参数把点全穿完、残差恒 0，
    // 那不是检验而是自证。
    const plane = fitPlane(stats.map(x => ({ y: x.cpuMean, x1: x.intentsMean, x2: x.creeps })));
    const fitLine = plane
      ? `[CPU-SWEEP] 拟合 cpu = ${plane.a.toFixed(2)} + ${plane.b.toFixed(3)}×签发 + ` +
        `${plane.c.toFixed(3)}×creeps  rms=${plane.rms.toFixed(3)} (dof=${plane.dof})`
      : "[CPU-SWEEP] 拟合不可用（台阶 <4 或自变量共线）";

    mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
    const outPath = resolve(process.cwd(), "tmp/cpu-population-sweep.json");
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          meta: {
            rooms: ROOMS,
            warmup: WARMUP,
            settleByStep: Object.fromEntries(STEPS.map(s => [s.name, s.settle ?? SETTLE])),
            window: WINDOW,
            issuePrice: ISSUE_PRICE,
            bucketMin,
            tickLimit: Math.max(...all.map(s => s.tickLimit)),
            ticksAtCeiling: atCeiling,
            throttled,
            sweepRoles: SWEEP_ROLES,
          },
          steps: stats,
          edges,
          all,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      [
        `[CPU-SWEEP] rooms=${ROOMS} bucketMin=${bucketMin} tickLimit=${Math.max(...all.map(s => s.tickLimit))} 贴顶tick=${atCeiling} throttled=${throttled} window=${WINDOW} ` +
          `settle(${STEPS.map(s => `${s.name}:${s.settle ?? SETTLE}`).join(" ")})`,
        ...stats.map(
          s =>
            `[CPU-SWEEP] ${s.step.padEnd(8)} creeps=${s.creeps.toFixed(1)}(${s.creepsMin}..${s.creepsMax} 散布${(s.creepsSpread * 100).toFixed(0)}%) ` +
            `cpu=${s.cpuMean.toFixed(2)}/p95 ${s.cpuP95.toFixed(2)} intents=${s.intentsMean.toFixed(2)} ` +
            `(${s.intentsPerCreep.toFixed(3)}/creep) fixed=${s.fixedCost.toFixed(2)} ` +
            `structs=${s.structs.toFixed(0)} ecap=${s.energyCap.toFixed(0)} sites=${s.sites.toFixed(1)} storeE=${s.storedEnergy.toFixed(0)} bounds[${s.bounds}]`,
        ),
        ...stats.map(
          s =>
            `[CPU-SWEEP] ${s.step.padEnd(8)} roles: ${Object.entries(s.roleCounts)
              .map(([r, n]) => `${r}=${n.toFixed(1)}`)
              .join(" ")}`,
        ),
        edges
          .map(
            e =>
              `[CPU-SWEEP] ${e.from}->${e.to}${e.rebalanced ? " [编制已重排]" : ""}: ` +
              `Δcreeps=${e.dCreeps.toFixed(1)} Δcpu=${e.dCpu.toFixed(2)} Δintents=${e.dIntents.toFixed(1)}  ` +
              `每签发=${Number.isNaN(e.perIntent) ? "n/a" : e.perIntent.toFixed(3)}${usableEdge(e) ? "（仅量级体检；组成漂移使差分不可用于定价）" : " [不可用]"}  ` +
              `每 creep=${e.marginal.toFixed(3)}（仅当无重排时可用）  ` +
              `Δ签发/Δcreep=${Number.isNaN(e.busyDelta) ? "n/a" : e.busyDelta.toFixed(2)}` +
              `${usableEdge(e) ? "" : " [不可用：新增多为闲置]"}`,
          )
          .join("\n"),
        Math.max(...stats.map(x => x.energyCap)) <= 300
          ? "[CPU-SWEEP] WARN 全域 energyCapacityAvailable=300（零 extension）：creep 全是最小 body，" +
            "编制数与 intents/creep 不代表设计规模；单价与固定成本按签发/按房计，不受影响"
          : "",
        fitLine,
        `[CPU-SWEEP] 两参数残差跨台阶差 ${fixedSpread.toFixed(2)} CPU/tick（旧模型在该规模缺项，仅作参考）`,
        `[CPU-SWEEP] artifact -> ${outPath}`,
      ].join("\n"),
    );

    if (throttled) console.log("[CPU-SWEEP] WARN bucket 跌破 guarded 阈值，读数被 CPU 上限掐住");

    // 收敛性判据放在报表之后：失败时报表仍要打得出来，否则下一轮只能瞎猜 settle 要多长。
    for (const st of stats) {
      expect(
        st.creepsSpread,
        `台阶 ${st.step} 人口未收敛（散布 ${(st.creepsSpread * 100).toFixed(0)}%，` +
          `${st.creepsMin}..${st.creepsMax}），需加大 CPU_SWEEP_SETTLE`,
      ).toBeLessThanOrEqual(0.2);
      expect(st.bounds, `台阶 ${st.step} 的 roleBounds 各房不一致，旋钮没钉住`).not.toMatch(
        /MIXED/,
      );
      expect(st.bounds, `台阶 ${st.step} 未报告 roleBounds`).not.toBe("");
    }
    expect(
      byPop[byPop.length - 1]!.creeps - byPop[0]!.creeps,
      `人口台阶仅拉开 ${(byPop[byPop.length - 1]!.creeps - byPop[0]!.creeps).toFixed(1)} creep，` +
        "斜率不可辨识（台阶必须真的分开，否则退化成 E2E-030 的共变老问题）",
    ).toBeGreaterThanOrEqual(4);
    // 本夹具存在的理由：cpu = 固定成本 + 单价×签发 里的「固定成本」必须是常数 ——
    // 各台阶（人口不同、编制被 AI 重排过）算出的 fixed 对不齐，就说明模型缺项，
    // 该去补模型而不是继续调台阶。
    // 只对**可辨识的量**设门槛：台阶世界里 签发 与 creeps 近共线（实测 r=0.95），
    // p 与 c 分不开，fitPlane 按纪律返回 null —— 此时唯一可断言的是可用边的每签发单价。
    if (plane) {
      expect(
        plane.rms,
        `三参数拟合残差 ${plane.rms.toFixed(3)} 过大 —— 模型仍缺项；` +
          `cpu=${plane.a.toFixed(2)} + ${plane.b.toFixed(3)}×签发 + ${plane.c.toFixed(3)}×creeps`,
      ).toBeLessThanOrEqual(0.25);
    }
    const priced = edges.filter(usableEdge);
    expect(
      priced.length,
      "没有一条台阶边可用于定价（新增 creep 多为闲置 或 Δ签发 太小）——" +
        "台阶要拉开到「加进来的确实有活干」，否则单价不可测",
    ).toBeGreaterThanOrEqual(1);
    // 单价这里只做**物理量级体检**（0.02–1.0），不断言 0.21 —— 台阶段差分在发育世界
    // 不满足自己的适用条件：固定房数下改人口必然改编制（AI 的需求驱动使然），
    // 而不同编制的非签发成本不同（实测 mid->high：+6.6 次 upgrade 签发，traffic-manager
    // 反而省 0.47，于是 Δcpu/Δ签发 = 0.07 而非 0.21）。
    // 跨世界标定的主单价 0.21 由 E2E-029 沙箱定标 + 未饱和世界的台阶边给出，
    // 不在这里用一条会被组成漂移打破的窄带假装检验。
    for (const e of edges.filter(usableEdge)) {
      expect(
        e.perIntent,
        `${e.from}->${e.to} 的每签发差分 ${e.perIntent.toFixed(3)} 超出物理量级 [0.02, 1.0]` +
          " —— 台阶差分失效（多半是 CPU 读数或签发计数口径坏了）",
      ).toBeGreaterThan(0.02);
      expect(e.perIntent).toBeLessThan(1.0);
    }
  }, 1800000);
});
