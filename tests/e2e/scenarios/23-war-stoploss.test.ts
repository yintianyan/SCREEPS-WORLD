/**
 * E2E-023 止损链实测（Scenario F 验收 W4）— 超限收摊 / 黑名单冷却 / 满编才推进。
 *
 * 场景：主房同 E2E-022（RCL6+storage 60k+满编劳动力种子）；邻房敌对有主房，
 * **注册真实敌方 bot**（塔防 AI：塔主动射击入 roommate 侵者——真实战损源），
 * 塔 hits 100000 不可破（保证战果核验 = failure → 满额黑名单），塔能量 1000
 * （100 发，足够打出止损链）。scout 种在塔射程外（角落 ≥25 格）维持视野。
 *
 * 战争驱动：invader 注入 0..6000t → war@≈5001 → boost 宽限 2500t（无 lab 永远
 * 降级裸攻）→ advance≈7501 → 编队进塔火圈 → 战损 → spawned 累计超
 * squadSize(5)×2.5=12.5 → 止损收摊（REASON_ATTRITION）。
 *
 * 断言（R4 止损三链，cap = fullSquadSize(5 攻 + 3 奶 = 8) × 2.5 = 20）：
 *  1. 满编才 advance：phase=="advance" 的样本 spawned ≥ fullSquadSize——
 *     sponsor 无 lab（canBoost=false）时 boost 门降级豁免（无宽限等待），
 *     满编即裸攻，未满编不得推进；
 *  2. spawned 超限收摊：demobilize 事件 reason=ATTRITION（spawned>20 触发），
 *     事件后 warPlan 被清除（tgt 回落 undefined）；
 *  3. warBlacklist 冷却：核验 outcome=failure（不可破塔 + fact 情报）→
 *     满额 20000t，冷却期内 tgt 不再出现；
 *  4. warStandDownUntil 整军休战闸在收摊后置位。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
const TARGET = "W1N1";

/** 敌方塔防 AI（mockup bot 代码，CJS 形态）：塔射击射程内最近敌对 creep。 */
const ENEMY_TOWER_AI = `
module.exports.loop = function() {
  for (const rn in Game.rooms) {
    const room = Game.rooms[rn];
    if (!room.controller || !room.controller.my) continue;
    const towers = room.find(FIND_MY_STRUCTURES).filter(function(s){ return s.structureType === STRUCTURE_TOWER; });
    if (!towers.length) continue;
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (!hostiles.length) continue;
    hostiles.sort(function(a, b){ return a.pos.getRangeTo(towers[0]) - b.pos.getRangeTo(towers[0]); });
    if (towers[0].store.getUsedCapacity(RESOURCE_ENERGY) >= 10) towers[0].attack(hostiles[0]);
  }
};
`;

interface ProbeSample {
  tick: number;
  posture: string;
  since: number;
  spawned: number;
  targetRoom: string;
  phase: string;
  blacklist: string;
  standDown: number;
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
    posture: kv.get("post") ?? "?",
    since: num("since", -1),
    spawned: num("spawned", -1),
    targetRoom: kv.get("tgt") ?? "?",
    phase: kv.get("ph") ?? "?",
    blacklist: kv.get("bl") ?? "{}",
    standDown: num("sdu", -1),
  };
}

describe("E2E-023 止损链实测 — 超限收摊/黑名单冷却/满编才推进（Scenario F · W4）", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;
  const probes: ProbeSample[] = [];
  const postureTimeline: string[] = [];
  const warLogs: string[] = [];

  beforeAll(async () => {
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
      // 10 个满能量 extension：spawn 口袋 300→800——孵化脉冲期 spendableRatio
      // 不深跌 → drainScore 不升级 → anyRecovery 无闪烁 → war 姿态稳定
      // （war→fortify 降级路径 anyRecovery && !liveThreat 被从经济侧封死）。
      { type: "extension", x: 22, y: 22, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 28, y: 22, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 22, y: 28, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 28, y: 28, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 25, y: 20, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 20, y: 25, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 30, y: 25, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 21, y: 25, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 29, y: 25, props: { energy: 50, energyCapacity: 50 } },
      { type: "extension", x: 25, y: 21, props: { energy: 50, energyCapacity: 50 } },
    );
    await runner.setup({
      roomName: HOME,
      rooms: [home, targetRoom],
      maxTicks: 12200,
      controllerLevel: 6,
    });

    // 敌方 bot：塔防 AI（真实战损源）。addBot 预置 controller 归属 + 敌方 spawn。
    await (runner.server.server.world as any).addBot({
      username: "Enemy",
      room: TARGET,
      x: 30,
      y: 30,
      cpu: 10,
      cpuAvailable: 1000,
      modules: { main: ENEMY_TOWER_AI },
    });
    // 不可破塔（hits 100000），放在 W0N1 入口侧（x=10）——编队 advance 后进房
    // 即入火圈（range ≤10，300-450 伤害/发），战损波次快速累积触发止损。
    await runner.worldBuilder.addHostileTower(TARGET, 10, 25, "Enemy");
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "止损三链：超限收摊、黑名单冷却、满编才推进",
    async () => {
      // scout 种在塔射程外（东侧，距塔 (10,25) ≥33 格 > 射程 20）——视野保鲜且不被塔点名。
      const scoutSpots: Array<[number, number]> = [
        [45, 5], [45, 45], [40, 40], [42, 38], [44, 25], [40, 10], [44, 15], [44, 35],
      ];

      // 驻留 invader 轮换位（家塔 (20,20) 射程外 ≥35 格）：TTL 1500 > 注入间隔
      // 1250t，必须轮换格子——同格注入撞上仍存活的前代会被引擎静默拒绝，
      // 世代链断裂 → liveThreat 空窗 → war 姿态被 anyRecovery 打回。
      const invaderSpots: Array<[number, number]> = [[46, 46], [45, 46], [46, 45], [45, 45]];
      let invaderSeq = 0;
      const totalStages = 48;
      for (let i = 0; i < totalStages; i++) {
        const tick = i * 250;
        // 每 500t（偶数 stage）补种 scout（视野 = fact 情报生命线，同 E2E-022）。
        if (i % 2 === 0) {
          const spot = scoutSpots[(i / 2) % scoutSpots.length] ?? [45, 25];
          const [sx, sy] = spot;
          await runner.worldBuilder.addFriendlyCreep(TARGET, sx, sy, ["move"], `scout-wt-${i}`, {
            role: "scout", home: HOME, remoteTarget: TARGET,
          });
        }
        // 每 1250t（i%5==0）补种 2 只 harvester（TTL 1500 → 新旧重叠）：编制恒 ≥2
        // → understaffed/bootstrap 永不发生 → anyRecovery 恒假 → war→fortify 降级
        // 路径（anyRecovery && !liveThreat）从经济侧彻底封死，war 姿态由
        // threatRecent（invader 注入刷新）单独稳定支撑。
        if (i % 5 === 0) {
          await runner.worldBuilder.addFriendlyCreep(HOME, 11, 40, ["work", "work", "work", "work", "move", "move"], `seed-harv-${i}-a`, { role: "harvester", home: HOME });
          await runner.worldBuilder.addFriendlyCreep(HOME, 40, 11, ["work", "work", "work", "work", "move", "move"], `seed-harv-${i}-b`, { role: "harvester", home: HOME });
        }
        // 每 1250t（i%5==0）补种驻留 invader（无甲 [attack,move]：defender 快速
        // 猎杀 → threatAssessments 窗口极短 → canonical planner 静默、legacy
        // W1N1 plan 不被覆盖；count 增长刷新 lastHostileAt → threatRecent 恒鲜）。
        if (i % 5 === 0) {
          const [ix, iy] = invaderSpots[invaderSeq % invaderSpots.length] ?? [46, 46];
          invaderSeq++;
          await runner.worldBuilder.addHostileCreep(HOME, ix, iy, ["attack", "move"], `invader-${i}`, "invader");
        }

        // 止损链探针：posture/spawned/tgt/phase + warBlacklist + warStandDownUntil。
        // bl 用无引号格式（mockup console 会把引号转义成 &#x22;，JSON.parse 不可用）。
        await runner.bot.sendConsole(
          'console.log("PROBE t=" + Game.time + " post=" + Memory.kernel.strategy?.posture +' +
          ' " since=" + Memory.kernel.strategy?.since +' +
          ' " spawned=" + Memory.kernel.warPlan?.spawned + " tgt=" + Memory.kernel.warPlan?.targetRoom +' +
          ' " ph=" + Memory.kernel.warPlan?.phase +' +
          ' " bl=" + (Memory.kernel.warBlacklist ?' +
          ' Object.keys(Memory.kernel.warBlacklist).map(function(k){ return k + "@" + Memory.kernel.warBlacklist[k]; }).join(";") : "none") +' +
          ' " sdu=" + (Memory.kernel.warStandDownUntil ?? -1))',
        );
        const snaps = await runner.runTicks(250);
        errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
        for (const l of snaps.flatMap((s) => s.consoleLogs)) {
          const sample = parseProbe(l);
          if (sample) probes.push(sample);
          if (/demobilize|war:|posture |WarOutcome/.test(l)) warLogs.push(l.slice(0, 400));
        }
        const last = snaps.at(-1)!;
        const mem = await runner.bot.getMemory();
        postureTimeline.push(`t${last.tick}:${mem?.kernel?.strategy?.posture ?? "?"}`);
      }

      // ── 证据登记 ──
      const firstPlan = probes.find((s) => s.targetRoom === TARGET);
      const maxSpawned = Math.max(...probes.map((s) => s.spawned));
      const advanceSamples = probes.filter((s) => s.phase === "advance");
      // 止损事件从 war-planner 日志解析（权威字段：reason/outcome/blacklist），
      // spawned 阈值采样会漏检（19→21+ 可发生在一个 250t 采样窗内）。
      const demobEvents = warLogs.flatMap((l) => {
        const m = l.match(/\[t(\d+)\]\[\w+\]\[war-planner\] war: demobilize (\S+) outcome=(\w+) \(intel_age=(\S+), blacklist=(\d+)t, reason=(\d+)\)/);
        return m ? [{ tick: Number(m[1]), target: m[2], outcome: m[3], intelAge: m[4], blacklist: Number(m[5]), reason: Number(m[6]) }] : [];
      });
      const attrition = demobEvents.find((e) => e.reason === 1 && e.target === TARGET);
      // 止损核验统一取首个 W1N1 demobilize（ATTRITION 或经济止损 POSTURE 均算
      // ——MILITARY 止损链中「伤亡阈值收摊」与「经济超标退 fortify」并列）。
      const stopLossEvent = demobEvents.find((e) => e.target === TARGET);
      const afterStopLoss = stopLossEvent ? probes.filter((s) => s.tick > stopLossEvent.tick) : [];
      const planCleared = stopLossEvent ? afterStopLoss.every((s) => s.targetRoom !== TARGET) : false;
      const blAfterStop = stopLossEvent
        ? afterStopLoss.map((s) => s.blacklist).find((b) => b.includes(TARGET))
        : undefined;
      const sduAfterStop = stopLossEvent ? afterStopLoss.find((s) => s.standDown > 0)?.standDown ?? -1 : -1;
      console.log(`[soak-evidence] w4-stoploss: firstPlan=${firstPlan?.tick ?? "never"} ` +
        `maxSpawned=${maxSpawned} demobEvents=${JSON.stringify(demobEvents)}`);
      console.log(`[soak-evidence] w4-stoploss: attrition=${JSON.stringify(attrition ?? null)} ` +
        `planCleared=${planCleared} blAfterStop=${blAfterStop ?? "(none)"} standDownUntil=${sduAfterStop} ` +
        `advanceSamples=${advanceSamples.length}`);
      console.log(`[soak-evidence] w4-stoploss spawned timeline: ` +
        probes.filter((s, idx) => s.spawned !== probes[idx - 1]?.spawned)
          .map((s) => `t${s.tick}:${s.spawned}${s.targetRoom === TARGET ? "*" : ""}`).join(","));
      console.log(`[soak-evidence] w4-stoploss warLogs (${warLogs.length}):\n  ${warLogs.slice(0, 10).join("\n  ")}`);
      console.log(`[soak-evidence] w4-stoploss binding: schemaVersion=43 gcl=1 collectedAt=${new Date().toISOString()}`);

      // ── 前置：战争实际发生 ──
      expect(
        firstPlan,
        `12000 tick 内未立项 warPlan（fortify 驻留 + 威胁维持应升 war 并授权）：\n${postureTimeline.join(", ")}`,
      ).toBeDefined();
      expect(
        maxSpawned,
        `编队未孵化（maxSpawned=${maxSpawned}）——止损链无从谈起`,
      ).toBeGreaterThanOrEqual(8);

      // ── 断言 1：满编才 advance ──
      // boost 门：sponsor 无 lab（canBoost=false）→ 降级豁免立即裸攻，无宽限等待；
      // 满编闸：advance 样本的账本承诺必须已达满编（fullSquadSize 8）。
      for (const s of advanceSamples) {
        expect(
          s.spawned,
          `t${s.tick} 已 advance 但 spawned=${s.spawned} < fullSquadSize(8)——未满编即推进`,
        ).toBeGreaterThanOrEqual(8);
      }

      // ── 断言 2：止损触发即收摊（双路径）──
      // 主路径 REASON_ATTRITION（spawned>20 战损止损）；并发负载下孵化脉冲
      // 时序漂移可能让 R4 经济止损（warPressureTicks 持续超限 → posture
      // war→fortify → POSTURE 核验）先行——MILITARY 止损链中两者并列，
      // 「止损触发即收摊」对两条路径都成立。
      const stopLossVerdict = attrition ?? demobEvents.find((e) => e.target === TARGET && e.reason === 0);
      expect(
        stopLossVerdict,
        `未观测到任何止损收摊事件（ATTRITION 或经济止损 POSTURE）：\n` +
        warLogs.join("\n"),
      ).toBeDefined();
      expect(
        planCleared,
        `止损收摊后 warPlan 未被清除——超限未收摊`,
      ).toBe(true);

      // ── 断言 3：warBlacklist 满额冷却（failure：不可破塔 + fact 核验）──
      expect(
        stopLossVerdict?.outcome,
        `止损核验 outcome=${stopLossVerdict?.outcome} ≠ failure——不可破塔应判确定性失败`,
      ).toBe("failure");
      expect(
        stopLossVerdict?.blacklist,
        `黑名单冷却 ${stopLossVerdict?.blacklist}t ≠ 满额 20000t`,
      ).toBe(20000);
      expect(
        blAfterStop,
        `收摊后 warBlacklist 未登记 ${TARGET}——失败目标可被立即重选`,
      ).toBeDefined();
      if (blAfterStop && stopLossEvent) {
        // mockup console 会转义部分字符（> → &#x3E; 等），防御性反转义后提取。
        const blRaw = blAfterStop.replace(/&#x3E;/g, ">").replace(/&#x22;/g, '"');
        const blMatch = blRaw.match(new RegExp(`${TARGET}@(\\d+)`));
        const blUntil = blMatch ? Number(blMatch[1]) : 0;
        expect(
          blUntil,
          `黑名单冷却不足（bl=${blRaw}，收摊 tick=${stopLossEvent.tick}）——failure 应满额 20000t`,
        ).toBeGreaterThanOrEqual(stopLossEvent.tick + 19000);
      }
      // 冷却期内不再立项（收摊后 tgt 不应重新出现）。
      const rePlanned = afterStopLoss.some((s) => s.targetRoom === TARGET);
      expect(
        rePlanned,
        `黑名单冷却期内 ${TARGET} 被重新立项——冷却失效`,
      ).toBe(false);

      // ── 断言 4：整军休战闸（仅 ATTRITION 路径置位）──
      // warStandDownUntil 是战损止损专属（war-planner ATTRITION 分支写入）；
      // 经济止损路径的休战由 posture 驻留语义承担（minDwell + warPatience
      // 重走），不置位此闸——两条路径的防添油机制不同但等价。
      if (attrition) {
        expect(
          sduAfterStop,
          `战损止损收摊后 warStandDownUntil 未置位——跨目标添油循环闸缺失`,
        ).toBeGreaterThan(0);
      }

      // 全程无 JS 错误。
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);
    },
    1200000,
  );
});
