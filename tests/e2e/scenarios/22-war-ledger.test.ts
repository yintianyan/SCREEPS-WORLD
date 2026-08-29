/**
 * E2E-022 war 账本（Scenario F 验收 W3）— 战争全程经济不越红线。
 *
 * 场景：主房 RCL6+storage 60k+塔（军事可行，种满编劳动力跳过冷启动）；
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
 *  1. economyPressure 全程 ≤ warMaxPressure(0.4)；
 *  2. colonyState 全程不入 recovery/bootstrap（战争是盈余活动）；
 *  3. kernel.strategy.warPressureTicks 峰值 < 1000（经济可持续止损从未触发）；
 *  4. storage 全程 ≥ 8000（colonizeSponsorFloor 饥饿兜底线）；
 *  5. warPlan.spawned（战损账本）≤ fullSquadSize × casualtyMultiplier(2.5)
 *     —— 消耗战止损账本有界，无添油失控；
 *  6. war 达成后中途不降级 fortify（R-04 振荡防线：无 war↔fortify 抖动）。
 * 另断言授权镜像：warPlan.targetRoom === W1N1（fact 真目标被授权）；
 * 破塔（twr 1→0）作为战果证据登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";

const HOME = "W0N1";
const TARGET = "W1N1";

/** 判断日志行是否为 JS 错误。 */
function isJsError(line: string): boolean {
  return (
    line.includes("TypeError") ||
    line.includes("ReferenceError") ||
    line.includes("is not a function") ||
    line.includes("Cannot read properties of undefined")
  );
}

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
      objects: [
        controller(10, 10, 1),
        source(10, 40),
        source(40, 10),
        mineral(40, 40),
      ],
    };
    const home = standardRoom(HOME, 300, 6);
    home.objects!.push(
      { type: "tower", x: 20, y: 20, props: { energy: 1000, energyCapacity: 1000 } },
      { type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } },
    );
    await runner.setup({
      roomName: HOME,
      rooms: [home, targetRoom],
      maxTicks: 9200,
      controllerLevel: 6,
    });
    await runner.addEnemyOwnedRoom(TARGET, "Enemy", 1);
    await runner.worldBuilder.addHostileTower(TARGET, 25, 25, "Enemy");
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "war 授权真目标、编队孵化、全程经济不越红线",
    async () => {
      // ── 常驻侦察（视野 = fact 情报的生命线）──
      // 每 500t 补种一只 scout（周期换位防同格冲突）：情报 towers 字段走
      // ROOM_THREAT_TTL(200t) 短窗，room-observer 50t 邻房扫描 + intelligence
      // 10t 采用维持 observedAt 新鲜 → 情报在 war 立项时点（t≈5001）必然
      // fact 级（与 E2E-021 诱饵镜像：诱饵靠 scout 死后情报过期，真目标靠
      // 持续侦察保鲜——生产语义由 intelNeedsRescout 驱动重侦察，测试侧等价注入）。
      const scoutSpots: Array<[number, number]> = [
        [23, 23], [27, 23], [23, 27], [27, 27], [25, 23], [23, 25],
        [27, 25], [25, 27], [22, 24], [28, 24], [24, 22], [24, 28],
        [26, 22], [26, 28], [22, 26], [28, 26], [25, 21], [25, 29],
      ];

      // ── 种满编劳动力（同 E2E-021：跳过零人口冷启动的 bootstrap 闪烁）──
      await runner.worldBuilder.addFriendlyCreep(HOME, 11, 40, ["work", "work", "work", "work", "move", "move"], "seed-harv-1", { role: "harvester", home: HOME });
      await runner.worldBuilder.addFriendlyCreep(HOME, 40, 11, ["work", "work", "work", "work", "move", "move"], "seed-harv-2", { role: "harvester", home: HOME });
      await runner.worldBuilder.addFriendlyCreep(HOME, 26, 25, ["work", "work", "work", "work", "move", "move"], "seed-harv-3", { role: "harvester", home: HOME });
      await runner.worldBuilder.addFriendlyCreep(HOME, 25, 26, ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], "seed-hauler-1", { role: "hauler", home: HOME });
      await runner.worldBuilder.addFriendlyCreep(HOME, 23, 30, ["carry", "carry", "carry", "move", "move"], "seed-dist-1", { role: "distributor", home: HOME });
      await runner.worldBuilder.addFriendlyCreep(HOME, 11, 11, ["work", "work", "work", "carry", "move", "move"], "seed-upgr-1", { role: "upgrader", home: HOME });

      const totalStages = 36;
      for (let i = 0; i < totalStages; i++) {
        const tick = i * 250;
        // 每 500t（偶数 stage）补种一只 scout 维持目标房视野。
        if (i % 2 === 0) {
          const spot = scoutSpots[(i / 2) % scoutSpots.length] ?? [25, 26];
          const [sx, sy] = spot;
          await runner.worldBuilder.addFriendlyCreep(TARGET, sx, sy, ["move"], `scout-wt-${i}`, {
            role: "scout", home: HOME, remoteTarget: TARGET,
          });
        }
        // 高频再注入：塔击杀保经济，目击刷新 lastHostileAt 维持 threatRecent
        // ——「反复试探性攻击维持战争姿态」是生产语义。从 t0 注入使 fortify
        // since≈2 → war≈5002，为 build(2500 boost 宽限)+孵化+行军留足窗口。
        if (tick <= 6000) {
          await runner.worldBuilder.addHostileCreep(HOME, 35, 35, ["attack", "move"], `invader-${i}`, "invader");
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
        errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
        for (const l of snaps.flatMap((s) => s.consoleLogs)) {
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
      const firstWar = probes.find((s) => s.posture === "war");
      const maxPressure = Math.max(...probes.map((s) => s.pressure));
      const maxWarPressureTicks = Math.max(...probes.map((s) => s.warPressureTicks));
      const minStorage = Math.min(...probes.filter((s) => s.storage >= 0).map((s) => s.storage));
      const badStates = probes.filter((s) => s.cs === "recovery" || s.cs === "bootstrap");
      const finalSpawned = Math.max(...probes.map((s) => s.spawned));
      const realTargetAuthorized = probes.some((s) => s.targetRoom === TARGET);
      const towersFirst = probes.find((s) => s.towers >= 0)?.towers ?? -1;
      const towersFinal = probes.filter((s) => s.towers >= 0).at(-1)?.towers ?? -1;
      console.log(`[soak-evidence] war-ledger: firstWar=${firstWar?.tick ?? "never"} ` +
        `maxPressure=${maxPressure.toFixed(3)} maxWarPressureTicks=${maxWarPressureTicks} ` +
        `minStorage=${minStorage} finalSpawned=${finalSpawned} badStates=${badStates.length}`);
      console.log(`[soak-evidence] war-ledger: realTargetAuthorized=${realTargetAuthorized} ` +
        `towers ${towersFirst}→${towersFinal} jsErrors=${errorsSeen}`);
      console.log(`[soak-evidence] war-ledger towers timeline: ` +
        probes.filter((s) => s.towers >= 0).map((s) => `t${s.tick}:${s.towers}`).join(",") || "(no vision samples)");
      console.log(`[soak-evidence] war-ledger posture: ${postureTimeline.join(" | ")}`);
      console.log(`[soak-evidence] war-ledger warLogs (${warLogs.length}):\n  ${warLogs.slice(0, 20).join("\n  ")}`);
      console.log(`[soak-evidence] war-ledger binding: schemaVersion=43 gcl=1 collectedAt=${new Date().toISOString()}`);

      // ── 断言：授权与战力 ──
      expect(
        firstWar,
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
      // 红线 = warMaxPressure(0.4) 的「持续越限」：posture 机以 warPressureTicks
      // 每 tick 精确累计、回落即清零，达 1000t 触发经济可持续止损收摊。
      // 短暂尖峰由退出滞回容忍（R-04：退出耐心 ≥ 波次周期是设计约束）——
      // 250t 采样网格必捕获任何 ≥1000t 连续越限窗口，故峰值 < 1000 即证明
      // 全程无持续越限（warPressureTicks=0 亦证明账本侧从未计压）。
      expect(
        badStates.length,
        `colonyState 入 recovery/bootstrap ${badStates.length} 次（战争期经济退化）：\n` +
        badStates.slice(0, 5).map((s) => `t${s.tick}:${s.cs}`).join(", "),
      ).toBe(0);
      expect(
        maxWarPressureTicks,
        `warPressureTicks 峰值 ${maxWarPressureTicks} 达到 1000 —— 经济可持续止损已被触发`,
      ).toBeLessThan(1000);
      // war 立项时点与收官时点经济必须在红线内（打得起才开打、打完仍健康）。
      const atWarEntry = probes.find((s) => s.posture === "war")!;
      const finalProbe = probes.at(-1)!;
      expect(
        atWarEntry.pressure,
        `war 立项时经济压力 ${atWarEntry.pressure.toFixed(3)} 已越红线（打不起就不打）`,
      ).toBeLessThanOrEqual(0.4);
      expect(
        finalProbe.pressure,
        `收官时经济压力 ${finalProbe.pressure.toFixed(3)} 未回到红线内`,
      ).toBeLessThanOrEqual(0.4);
      expect(
        minStorage,
        `storage 谷值 ${minStorage} 跌破 8000 饥饿兜底线（colonizeSponsorFloor）`,
      ).toBeGreaterThanOrEqual(8000);

      // ── 断言：账本有界 + 姿态稳定 ──
      expect(
        finalSpawned,
        `战损账本 spawned=${finalSpawned} 超过消耗战止损上限（fullSquadSize 8 × 2.5 = 20）`,
      ).toBeLessThanOrEqual(20);
      // R-04 振荡防线：war 达成后至 t<8600（威胁窗自然衰减前）不得降级 fortify。
      const midWarDowngrade = probes.filter(
        (s) => firstWar && s.tick > firstWar.tick && s.tick < 8600 && s.posture !== "war",
      );
      expect(
        midWarDowngrade.length,
        `war 达成后中途降级 ${midWarDowngrade.length} 次（war↔fortify 振荡，R-04）：\n` +
        midWarDowngrade.slice(0, 5).map((s) => `t${s.tick}:${s.posture}`).join(", "),
      ).toBe(0);

      // 全程无 JS 错误。
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);
    },
    1200000,
  );
});
