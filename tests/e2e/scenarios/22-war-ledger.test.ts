/**
 * E2E-022 war 账本（Scenario F 验收 W3）— 战争全程经济不越红线。
 *
 * 场景：主房走 warRoom（RCL6 核心区含 extension + 有主塔 + 200k storage，见夹具注释）；
 * 邻房 W1N1 为**真实战争目标**——敌方有主房 + 1 座塔（hits 1000 压低保证
 * 可破），常驻长 TTL 侦察兵维持视野 → 情报恒处 fact 窗（ROOM_THREAT_TTL
 * 200t，room-observer interval=1 连续刷新）→ 与 E2E-021 诱饵（stale 不授权）
 * 互为镜像：fact 级真目标必须被授权。
 *
 * 战争驱动：主房持续注入 invader（200..6000t）→ fortify≈t2 → warPatience
 * 5000 驻留 → war≈t5002 → 编队孵化（build 相位，boost 宽限 2500t 后裸攻
 * advance）→ 跨房进攻破塔。
 *
 * 账本断言（红线四门 + 账本两门）：
 *  1. 前置条件：立项那一刻**底层 phase** 不在危机带（读 phase 不读 colonyState —— 有活敌时
 *     colonyState 恒为 defense，会把危机盖住，「打得起才开打」就从表面信号验不出来）；
 *  2. war 窗口内 colonyState 不入 recovery/bootstrap（和平期入带只登记为证据：那是冷启动
 *     与物流节奏的事，归 07/09/18 经济场景管，本场景判它只会把夹具噪声记到战争头上）；
 *  3. economyPressure 立项前一刻与收官时 ≤ warMaxPressure(0.4)，
 *     kernel.strategy.warPressureTicks 峰值 < 1000（经济可持续止损从未触发）；
 *  4. storage 全程 ≥ 8000（colonizeSponsorFloor 饥饿兜底线）；
 *  5. warPlan.spawned（战损账本）≤ fullSquadSize × casualtyMultiplier(2.5)
 *     —— 消耗战止损账本有界，无添油失控；
 *  6. war 达成后中途不降级 fortify（R-04 振荡防线：无 war↔fortify 抖动；降级与危机带同刻
 *     即「撤资」路径，失败信息直接贴出那一段的通道读数）。
 * 判据一律逐 tick（快照 rawMemory）：war 窗口实测可短至 47 tick，250t 探针网格必漏。
 * 另断言授权镜像：warPlan.targetRoom === W1N1（fact 真目标被授权）；
 * 破塔（twr 1→0）作为战果证据登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CONFIG } from "../../../src/config";
import { writeFileSync } from "node:fs";
import { ScenarioRunner } from "../framework";
import { warRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import {
  injectEnemyRoom,
  injectHostileTower,
  injectFriendlyCreep,
  injectHostile,
} from "../fixtures/inject";
import { isJsError } from "../../support/errors";
import { DEFAULT_PHASE_OPTIONS } from "../../../src/domain/economy/phase";

const HOME = "W0N1";
const TARGET = "W1N1";

interface ProbeSample {
  tick: number;
  cs: string;
  pressure: number;
  warPressureTicks: number;
  posture: string;
  since: number;
  spawned: number;
  targetRoom: string;
  storage: number;
  towers: number;
}

/**
 * 逐 tick 观测样本（来自快照 rawMemory，零额外往返）。
 *
 * 三个口径必须逐 tick 而不是按 250t 探针网格：posture（war 窗口可能只有几十 tick，
 * 网格采样会「根本没看到」→ 误判成未立项，同一个坑在本场景踩过三次）、
 * warPlan（授权与战损账本同理）、colonyState（入带代价 = 连续 tick 数，不是出现次数）。
 * phase 子对象是 phase.ts 的持久化输入，带它才能把「这次入带是哪条通道造成的」
 * 分辨清楚（drainScore=偿付、liquidityScore=物流、srcStallTicks=采集塌方）。
 */
interface TickSample {
  tick: number;
  posture?: string;
  pressure: number;
  colonyState?: string;
  phase?: string;
  reserve: number;
  reserveDelta: number;
  drainScore: number;
  liquidityScore: number;
  bandTicks: number;
  srcStallTicks: number;
  warTarget?: string;
  spawned: number;
  /** 编制读数：phase 的 bootstrap 判据输入（harvesterCount < max(1, sourceCount)）。 */
  harvesters: number;
  sources: number;
}

/** 解析 PROBE 行（key=value 空格分隔，值可能为 undefined）。 */
function parseProbe(line: string): ProbeSample | null {
  if (!line.includes("PROBE t=")) return null;
  const body = line.replace(/^.*PROBE /, "");
  const kv = new Map<string, string>();
  for (const pair of body.split(/\s+/)) {
    const eq = pair.indexOf("=");
    if (eq > 0) kv.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const num = (k: string, dflt: number) => {
    const v = kv.get(k);
    return v !== undefined && v !== "undefined" && !Number.isNaN(Number(v)) ? Number(v) : dflt;
  };
  return {
    tick: num("t", 0),
    cs: kv.get("cs") ?? "?",
    pressure: num("p", -1),
    warPressureTicks: num("wpt", -1),
    posture: kv.get("post") ?? "?",
    since: num("since", -1),
    spawned: num("spawned", -1),
    targetRoom: kv.get("tgt") ?? "?",
    storage: num("stor", -1),
    towers: num("twr", -1),
  };
}

describe("E2E-022 war 账本 — 战争全程经济不越红线（Scenario F · W3）", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;
  /** 逐 tick 的姿态/经济压力/colonyState，取自快照自带 rawMemory —— 用于精确定位立项发生的那个 tick，
   *  以及把「recovery 只闪了一下」与「真陷恢复期」分开（只按 250t 采样报"出现过 1 次"判不了代价）。 */
  const tickSeries: Array<TickSample> = [];
  const probes: ProbeSample[] = [];
  const postureTimeline: string[] = [];
  const warLogs: string[] = [];

  beforeAll(async () => {
    // 真实战争目标：敌方有主房（war 目标形态）+ 1 座有主塔（hits 压到 1000
    // 保证满编可破）。塔必须在 addEnemyOwnedRoom 之后由 addHostileTower 注入
    // （带 user id——无主建筑对 FIND_HOSTILE_STRUCTURES 隐形，情报与军队都看不见）。
    const targetRoom: RoomSetup = {
      name: TARGET,
      terrain: emptyTerrain(),
      objects: [controller(10, 10, 1), source(10, 40), source(40, 10), mineral(40, 40)],
    };
    // 主房军事化走 warRoom：RCL6 核心区带 extension（口袋不再是 300）+ 有能量塔 + 60k storage。
    // 夹具理由见 fixtures/rooms.ts 的 warRoom 注释 —— 没有 extension 的 RCL6 房打不起战争，
    // 测出来的「战争被撤资」是夹具事实，不是战争平衡。
    const home = warRoom(HOME);
    await runner.setup({
      roomName: HOME,
      rooms: [home, targetRoom],
      maxTicks: 9200,
      controllerLevel: 6,
    });
    await injectEnemyRoom(runner, TARGET, "Enemy", 1);
    await injectHostileTower(runner, TARGET, 25, 25, "Enemy");
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it("war 授权真目标、编队孵化、全程经济不越红线", async () => {
    // ── 常驻侦察（视野 = fact 情报的生命线）──
    // 每 500t 补种一只 scout（周期换位防同格冲突）：情报 towers 字段走
    // ROOM_THREAT_TTL(200t) 短窗，room-observer 50t 邻房扫描 + intelligence
    // 10t 采用维持 observedAt 新鲜 → 情报在 war 立项时点（t≈5001）必然
    // fact 级（与 E2E-021 诱饵镜像：诱饵靠 scout 死后情报过期，真目标靠
    // 持续侦察保鲜——生产语义由 intelNeedsRescout 驱动重侦察，测试侧等价注入）。
    const scoutSpots: Array<[number, number]> = [
      [23, 23],
      [27, 23],
      [23, 27],
      [27, 27],
      [25, 23],
      [23, 25],
      [27, 25],
      [25, 27],
      [22, 24],
      [28, 24],
      [24, 22],
      [24, 28],
      [26, 22],
      [26, 28],
      [22, 26],
      [28, 26],
      [25, 21],
      [25, 29],
    ];

    // ── 种满编劳动力（同 E2E-021：跳过零人口冷启动的 bootstrap 闪烁）──
    await injectFriendlyCreep(
      runner,
      HOME,
      11,
      40,
      ["work", "work", "work", "work", "move", "move"],
      "seed-harv-1",
      { role: "harvester", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      40,
      11,
      ["work", "work", "work", "work", "move", "move"],
      "seed-harv-2",
      { role: "harvester", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      26,
      25,
      ["work", "work", "work", "work", "move", "move"],
      "seed-harv-3",
      { role: "harvester", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      25,
      26,
      ["carry", "carry", "carry", "carry", "move", "move", "move", "move"],
      "seed-hauler-1",
      { role: "hauler", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      23,
      30,
      ["carry", "carry", "carry", "move", "move"],
      "seed-dist-1",
      { role: "distributor", home: HOME },
    );
    await injectFriendlyCreep(
      runner,
      HOME,
      11,
      11,
      ["work", "work", "work", "carry", "move", "move"],
      "seed-upgr-1",
      { role: "upgrader", home: HOME },
    );

    const totalStages = 36;
    for (let i = 0; i < totalStages; i++) {
      const tick = i * 250;
      // 每 500t（偶数 stage）补种一只 scout 维持目标房视野。
      if (i % 2 === 0) {
        const spot = scoutSpots[(i / 2) % scoutSpots.length] ?? [25, 26];
        const [sx, sy] = spot;
        await injectFriendlyCreep(runner, TARGET, sx, sy, ["move"], `scout-wt-${i}`, {
          role: "scout",
          home: HOME,
          remoteTarget: TARGET,
        });
      }
      // 高频再注入：塔击杀保经济，目击刷新 lastHostileAt 维持 threatRecent
      // ——「反复试探性攻击维持战争姿态」是生产语义。从 t0 注入使 fortify
      // since≈2 → war≈5002，为 build(2500 boost 宽限)+孵化+行军留足窗口。
      if (tick <= 6000) {
        await injectHostile(runner, HOME, 35, 35, ["attack", "move"], `invader-${i}`, "invader");
      }

      // 账本探针：红线四门（cs/p/wpt/stor）+ 账本两门（spawned/post）+ 战果（twr）
      // + warPlan/warBlacklist 原始 JSON（诊断立项/黑名单状态）。
      await runner.bot.sendConsole(
        'console.log("PROBE t=" + Game.time + " cs=" + Memory.rooms["W0N1"].colonyState +' +
          ' " p=" + Memory.rooms["W0N1"].economyPressure +' +
          ' " wpt=" + Memory.kernel.strategy?.warPressureTicks +' +
          ' " post=" + Memory.kernel.strategy?.posture + " since=" + Memory.kernel.strategy?.since +' +
          ' " spawned=" + Memory.kernel.warPlan?.spawned + " tgt=" + Memory.kernel.warPlan?.targetRoom +' +
          ' " stor=" + (Game.rooms["W0N1"].storage ? Game.rooms["W0N1"].storage.store.getUsedCapacity(RESOURCE_ENERGY) : -1) +' +
          ' " twr=" + (Game.rooms["W1N1"] ? Game.rooms["W1N1"].find(FIND_STRUCTURES).filter(function(s){return s.structureType==="tower";}).length : -1) +' +
          ' " wp=" + JSON.stringify(Memory.kernel.warPlan ?? null).slice(0,150) +' +
          ' " bl=" + JSON.stringify(Memory.kernel.warBlacklist ?? {}))',
      );
      const snaps = await runner.runTicks(250);
      errorsSeen += snaps.flatMap(s => s.consoleLogs).filter(isJsError).length;
      // console 探针每 250 tick 才发一次，用它找到的 firstWar 可能比真实立项晚多达 250 tick，
      // 于是读到的是「开战之后」的压力。economyPressure 在 500t 尺度上能从 0.79 跳到 0，
      // 拿滞后样本判红线会把正确行为误判成越线（实测踩过）。rawMemory 随快照自带，零额外往返。
      for (const snap of snaps) {
        const rm = snap.rawMemory as Record<string, any> | undefined;
        const room = rm?.rooms?.[HOME];
        const ph = room?.phase;
        tickSeries.push({
          tick: snap.tick,
          posture: rm?.kernel?.strategy?.posture as string | undefined,
          pressure: Number(room?.economyPressure ?? -1),
          colonyState: room?.colonyState as string | undefined,
          phase: ph?.phase as string | undefined,
          // 豁免判据的两个输入：绝对总储备 与赤字分累积。入带 tick 若 reserve 已在线之上
          // 且 drainScore=0，说明这次入带不是「花得起的消费被记成失血」，而是别的通道
          // （liquidityScore 物流 / srcStallTicks 采集塌方 / bootstrap 编制不足）——
          // investmentReserveFloor 管不到它，修法也不同。
          reserve: Number(ph?.reserve ?? -1),
          reserveDelta: Number(ph?.reserveDelta ?? 0),
          drainScore: Number(ph?.drainScore ?? -1),
          liquidityScore: Number(ph?.liquidityScore ?? -1),
          bandTicks: Number(ph?.bandTicks ?? -1),
          srcStallTicks: Number(ph?.srcStallTicks ?? -1),
          warTarget: rm?.kernel?.warPlan?.targetRoom as string | undefined,
          spawned: Number(rm?.kernel?.warPlan?.spawned ?? -1),
          harvesters: Number(ph?.harvesterCount ?? -1),
          sources: Number(ph?.sourceCount ?? -1),
        });
      }
      for (const l of snaps.flatMap(s => s.consoleLogs)) {
        const sample = parseProbe(l);
        if (sample) probes.push(sample);
        // war 链路关键日志全量收集（立项 log.error / demobilize log.info / 姿态切换 / W3 诊断）
        if (/war-planning:|demobilize|war:|posture |DIAG-W3/.test(l)) warLogs.push(l.slice(0, 800));
      }
      const last = snaps.at(-1)!;
      const mem = await runner.bot.getMemory();
      postureTimeline.push(`t${last.tick}:${mem?.kernel?.strategy?.posture ?? "?"}`);
    }

    // ── 证据登记 ──
    // 授权/动员/红线判据全部取自 tickSeries（逐 tick，rawMemory）：war 窗口实测可短至
    // 47 tick，250t 探针网格必然漏看，用它判据会把「已立项又被止损」误报成「从未立项」，
    // 把已授权目标误报成未授权 —— 本场景已因此第三次修正采样口径。
    // probes 只保留 rawMemory 读不到的引擎侧读数（塔存活、storage 实际容量）。
    const firstWarTick = tickSeries.find(s => s.posture === "war");
    const maxPressure = Math.max(...tickSeries.map(s => s.pressure));
    const maxWarPressureTicks = Math.max(...probes.map(s => s.warPressureTicks));
    const minStorageWholeRun = Math.min(...probes.filter(s => s.storage >= 0).map(s => s.storage));
    const finalSpawned = Math.max(...tickSeries.map(s => s.spawned));
    const realTargetAuthorized = tickSeries.some(s => s.warTarget === TARGET);
    const towersFirst = probes.find(s => s.towers >= 0)?.towers ?? -1;
    const towersFinal = probes.filter(s => s.towers >= 0).at(-1)?.towers ?? -1;

    // war 窗口（含降级后的 fortify，用于判断中途降级次数）。
    const warTicks = tickSeries.filter(s => s.posture === "war");
    const warSpan = warTicks.length
      ? warTicks[warTicks.length - 1]!.tick - warTicks[0]!.tick + 1
      : 0;

    // storage 红线量的是**战争期间**（打着打着不能饿死）与收官时刻；取全程 min 会把
    // 战后重建期的正常抽干算到战争头上 —— 与 band 指标同款口径错误（实测：war 窗口内
    // reserve 始终 41k~93k，而跌破 8000 发生在停战之后的 t7400+）。
    const warStart = firstWarTick?.tick ?? Number.POSITIVE_INFINITY;
    const warEnd = warTicks.length ? warTicks[warTicks.length - 1]!.tick : 0;
    const warStorage = probes.filter(s => s.storage >= 0 && s.tick >= warStart && s.tick <= warEnd);
    // 战争期净流量读数：reserve 的总增减 + 「赤字 tick 占比」+ drainScore 峰值。
    // 危机分数统计的是**踩空 footfall 的次数**（draining 一次 +15，不 draining 一次 −40），
    // 不是流量大小 —— 所以"小步进、大步出"的战争经济（进 20.8/tick × 66%，出 88.6/tick × 33%）
    // 净亏 6 万能量却几乎全程 drainScore=0。这几项打进失败信息，红一次就说清一次。
    const warFlows = tickSeries.filter(x => x.posture === "war");
    const flowSum = warFlows.reduce((a, x) => a + x.reserveDelta, 0);
    const deficitTicks = warFlows.filter(x => x.reserveDelta < 0).length;
    const maxDrainInWar = warFlows.length ? Math.max(...warFlows.map(x => x.drainScore)) : 0;
    const minWarStorage = warStorage.length ? Math.min(...warStorage.map(s => s.storage)) : -1;
    const storageTimeline = probes
      .filter(s => s.storage >= 0)
      .map(s => `t${s.tick}:${s.storage}`)
      .join(",");

    // 危机带连续段：colonyState 是 phase 的映射结果，段长（tick）才是代价 ——
    // recovery 会暂停远矿、降级 body、收缩 spawn 编制（含军事编制），而"250t 采样撞上 1 次"
    // 既分不清闪了一下还是占战争期 1/3，也定不出是哪条通道把它带进来的。
    interface BandRun {
      from: number;
      to: number;
      len: number;
      onset: TickSample;
    }
    const inBand = (s: TickSample | undefined): boolean =>
      s?.colonyState === "recovery" || s?.colonyState === "bootstrap";
    const bandRuns: BandRun[] = [];
    for (let i = 0; i < tickSeries.length; i++) {
      if (!inBand(tickSeries[i])) continue;
      let j = i;
      while (j + 1 < tickSeries.length && inBand(tickSeries[j + 1])) j++;
      bandRuns.push({
        from: tickSeries[i]!.tick,
        to: tickSeries[j]!.tick,
        len: tickSeries[j]!.tick - tickSeries[i]!.tick + 1,
        onset: tickSeries[i]!,
      });
      i = j;
    }
    const bandTicksTotal = bandRuns.reduce((a, r) => a + r.len, 0);

    // 立项前一刻（转换前最后一个 tick）：授权门槛看到的是这个状态。
    const entryIdx = tickSeries.findIndex(s => s.posture === "war");
    const preEntry = entryIdx > 0 ? tickSeries[entryIdx - 1]! : (tickSeries[entryIdx] ?? null);
    const finalSample = tickSeries.at(-1)!;
    const firstWarProbe = probes.find(s => s.posture === "war");

    // war→非 war 降级（逐 tick 计转换次数，探针网格会把相邻转换合并成 0 或 1 次）。
    const midWarDowngrades: number[] = [];
    for (let i = 1; i < tickSeries.length; i++) {
      if (
        tickSeries[i - 1]!.posture === "war" &&
        tickSeries[i]!.posture !== undefined &&
        tickSeries[i]!.posture !== "war" &&
        tickSeries[i]!.tick < 8600
      ) {
        midWarDowngrades.push(tickSeries[i]!.tick);
      }
    }

    // 逐 tick 原始序列落盘：一条断言只能判一次，但「立项那一 tick 底层 phase 是什么」
    // 「入带是哪条通道造成的」这类问题要来回问好几轮 —— 每次重跑 3 分钟，不如把序列
    // 留在 tmp 里离线查（tmp/ 已被 .gitignore 覆盖）。
    writeFileSync("tmp/war22-series.json", JSON.stringify(tickSeries));

    // war 窗口内的入带 tick（这才是本场景的合同对象：和平期的入带属于经济场景的职责，
    // 而「战争期间经济退化」才是 Scenario F 要拦的）。
    const warWindowBand = bandRuns.filter(
      r => firstWarTick && r.to >= firstWarTick.tick && r.from <= (warTicks.at(-1)?.tick ?? 0),
    );
    const warWindowBandTicks = warWindowBand.reduce((a, r) => a + r.len, 0);

    const fmtOnset = (r: BandRun): string =>
      `t${r.from}(${r.len}t) ph=${r.onset.phase ?? "?"} cs=${r.onset.colonyState ?? "?"} ` +
      `reserve=${r.onset.reserve.toFixed(0)} Δ=${r.onset.reserveDelta.toFixed(0)} ` +
      `drain=${r.onset.drainScore.toFixed(0)} liq=${r.onset.liquidityScore.toFixed(0)} ` +
      `stall=${r.onset.srcStallTicks.toFixed(0)} band=${r.onset.bandTicks.toFixed(0)} ` +
      `p=${r.onset.pressure.toFixed(2)}`;

    console.log(
      `[soak-evidence] war-ledger: firstWar=${firstWarTick?.tick ?? "never"} warSpan=${warSpan}t ` +
        `maxPressure=${maxPressure.toFixed(3)} maxWarPressureTicks=${maxWarPressureTicks} ` +
        `minWarStorage=${minWarStorage} minStorageWholeRun=${minStorageWholeRun} ` +
        `finalSpawned=${finalSpawned} ` +
        `bandTicks(war window)=${warWindowBandTicks} bandTicks(whole run)=${bandTicksTotal}`,
    );
    console.log(
      `[soak-evidence] war-ledger: realTargetAuthorized=${realTargetAuthorized} ` +
        `towers ${towersFirst}→${towersFinal} jsErrors=${errorsSeen} ` +
        `war->fortify downgrades=${midWarDowngrades.join(",") || "none"}`,
    );
    console.log(
      `[soak-evidence] war-ledger crisis-band runs (${bandRuns.length}, ${bandTicksTotal}t of ${tickSeries.length}t sampled): ${ 
        bandRuns.length ? bandRuns.slice(0, 6).map(fmtOnset).join(" | ") : "none" 
        } (investmentReserveFloor=50000; drain=偿付通道/liq=物流通道/stall=采集塌方通道)`,
    );
    console.log(
      `[soak-evidence] war-ledger entry resolution: warTick=${entryIdx >= 0 ? tickSeries[entryIdx]!.tick : "never"} ` +
        `warEntry(cs=${tickSeries[entryIdx]?.colonyState ?? "?"}/ph=${tickSeries[entryIdx]?.phase ?? "?"}) ` +
        `preEntry(cs=${preEntry?.colonyState ?? "?"}/ph=${preEntry?.phase ?? "?"}) ` +
        `preEntryPressure=${preEntry ? preEntry.pressure.toFixed(3) : "n/a"} ` +
        `laggedProbeTick=${firstWarProbe?.tick ?? "missed"} ` +
        `laggedProbePressure=${firstWarProbe ? firstWarProbe.pressure.toFixed(3) : "n/a"}`,
    );
    console.log(
      `[soak-evidence] war-ledger towers timeline: ${
        probes
          .filter(s => s.towers >= 0)
          .map(s => `t${s.tick}:${s.towers}`)
          .join(",") || "(no vision samples)"
      }`,
    );
    console.log(`[soak-evidence] war-ledger posture: ${postureTimeline.join(" | ")}`);
    console.log(
      `[soak-evidence] war-ledger warLogs (${warLogs.length}):\n  ${warLogs.slice(0, 20).join("\n  ")}`,
    );
    console.log(
      `[soak-evidence] war-ledger binding: schemaVersion=${CONFIG.memory.schemaVersion} gcl=1 collectedAt=${new Date().toISOString()}`,
    );

    // 数据出处守卫：rawMemory 若读空则逐 tick 序列全为 -1/undefined，下面的所有断言都会
    // 「因为没数据」而通过 —— 先证明逐 tick 口径真的取到了东西。
    expect(
      tickSeries.filter(s => s.pressure >= 0).length,
      "逐 tick 压力序列为空 —— 快照 rawMemory 口径不对，本场景所有断言不可信",
    ).toBeGreaterThan(100);
    expect(
      tickSeries.some(s => s.colonyState !== undefined),
      "逐 tick colonyState 序列为空 —— rawMemory 读不到 rooms[].colonyState，断言不可信",
    ).toBe(true);

    // ── 断言：授权与战力 ──
    expect(
      firstWarTick,
      `9000 tick 内未达成 war 姿态（fortify 驻留 + 威胁维持应升 war）：\n${postureTimeline.join(", ")}`,
    ).toBeDefined();
    expect(
      realTargetAuthorized,
      `fact 级真目标 ${TARGET} 未被授权 warPlan——授权门槛把真战争也挡住了：\n${postureTimeline.join(", ")}`,
    ).toBe(true);
    expect(
      finalSpawned,
      `编队未孵化（spawned=${finalSpawned} < 3）——战争机器没有实际动员：\n${postureTimeline.join(", ")}`,
    ).toBeGreaterThanOrEqual(3);

    // ── 断言：经济红线（Scenario F 合同口径）──
    // 合同对象是**战争窗口内**的经济，不是和平期：和平期入带属于经济场景（07/09/18）的职责，
    // 让本场景去判它只会把夹具的冷启动噪声（种下的一批 creep 同一 tick 集体 TTL 到期 →
    // bootstrap 闪烁）记到战争头上。全程入带统计仍打印为证据，只是不当判据。
    //
    // 前置条件（夹具合同）：立项那一刻**底层 phase** 必须健康。必须读 phase 而不是
    // colonyState —— 有活敌时 colonyState 恒为 "defense"（phaseToColonyState 的第一优先级），
    // 把危机盖掉；而授权门槛（posture 的 anyRecovery）读的正是被盖掉的那个值，
    // 所以「打得起才开打」只有从底层 phase 才验得出来。
    expect(
      preEntry?.phase === "crisis" || preEntry?.phase === "recovery",
      `war 立项前底层相位已在危机带（phase=${preEntry?.phase} reserve=${preEntry?.reserve.toFixed(0)}）—— ` +
        `两种可能，看上面 crisis-band runs 的通道归因：drain/liq/stall 全 0 却仍入带 = 相位机误判` +
        `（产品缺陷）；某通道打满且储备在跌 = 夹具真给了一间打不起战争的房。` +
        `注意 colonyState=${preEntry?.colonyState} 会把它盖住（有活敌时恒为 defense）`,
    ).toBe(false);
    expect(
      warWindowBandTicks,
      `war 窗口内 colonyState 入 recovery/bootstrap ${warWindowBandTicks} tick（${warWindowBand.length} 段）` +
        `—— 战争期经济退化：\n${warWindowBand.slice(0, 5).map(fmtOnset).join("\n")}`,
    ).toBe(0);
    expect(
      maxWarPressureTicks,
      `warPressureTicks 峰值 ${maxWarPressureTicks} 达到 1000 —— 经济可持续止损已被触发`,
    ).toBeLessThan(1000);
    // war 立项时点与收官时点经济必须在红线内（打得起才开打、打完仍健康）。
    expect(
      preEntry?.pressure ?? Number.NaN,
      `war 立项前一刻经济压力 ${(preEntry?.pressure ?? NaN).toFixed(3)} 越红线（打不起就不打）`,
    ).toBeLessThanOrEqual(0.4);
    expect(
      finalSample.pressure,
      `收官时经济压力 ${finalSample.pressure.toFixed(3)} 未回到红线内`,
    ).toBeLessThanOrEqual(0.4);
    expect(
      minWarStorage,
      `war 窗口内 storage 谷值 ${minWarStorage} 跌破 8000 饥饿兜底线（colonizeSponsorFloor）。` +
        `战争期净流量 Δ=${flowSum.toFixed(0)} E（${warFlows.length} tick 里 ${deficitTicks} tick 在跌，` +
        `占 ${((100 * deficitTicks) / Math.max(1, warFlows.length)).toFixed(0)}%），` +
        `而 drainScore 峰值只有 ${maxDrainInWar.toFixed(0)}/${DEFAULT_PHASE_OPTIONS.drainEnterScore} ` +
        `→ 危机分数按次数不按流量大小，看不见这种"小步进大步出"的失血。` +
        `\nreserve 谷值 ${Math.min(...warFlows.map(x => x.reserve)).toFixed(0)}，` +
        `storage(每 250t 采样)=${storageTimeline}`,
    ).toBeGreaterThanOrEqual(8000);

    // ── 断言：账本有界 + 姿态稳定 ──
    expect(
      finalSpawned,
      `战损账本 spawned=${finalSpawned} 超过消耗战止损上限（fullSquadSize 8 × 2.5 = 20）`,
    ).toBeLessThanOrEqual(20);
    // R-04 振荡防线：war 达成后至 t<8600（威胁窗自然衰减前）不得降级 fortify。
    // 降级时刻与危机带同 tick 出现 = 「撤资」路径（posture 的 anyRecovery 早退），
    // 把造成它的那一段信号读数直接贴进失败信息，省一轮复跑。
    const downgradeCause = midWarDowngrades
      .map(tk => bandRuns.find(r => tk >= r.from && tk <= r.to + 3))
      .filter((r): r is BandRun => r !== undefined);
    expect(
      midWarDowngrades.length,
      `war 达成后中途降级 ${midWarDowngrades.length} 次（war↔fortify 振荡，R-04）：${midWarDowngrades.join(",")}${ 
        downgradeCause.length
          ? `\n降级与危机带同刻（撤资路径），入带读数：\n${downgradeCause.map(fmtOnset).join("\n")}`
          : "\n降级时刻没有对应的危机带 —— 不是撤资路径，另查（威胁窗/止损/授权链）"}`,
    ).toBe(0);

    // 全程无 JS 错误。
    expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);
  }, 1200000);
});
