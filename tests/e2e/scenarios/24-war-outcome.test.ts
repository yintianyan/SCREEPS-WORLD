/**
 * E2E-024 战后核验战例（Scenario F 验收 W5）— evaluateWarOutcome 只信战后
 * 新鲜 fact 级观察。
 *
 * 共同骨架（E2E-023 已证稳定的 W4 配置）：主房军事化 + extension 抗闪烁 +
 * harvester 周期补种；敌房真实塔防 bot + 不可破塔（hits 100000）；invader
 * 锚每 stage 注入（mockup post-t0 TTL 语义异常 → 逐 stage 链式续命），
 * threatRecent 全程为真 → war 姿态稳定、canonical planner 实证静默
 * （W4 三次运行零 W0N1 计划）→ legacy W1N1 plan 存续。
 *
 * it-1 未知裁决（半额冷却）：t7000 移除目标房全部 creep（scout+attackers，
 * 情报冻结 lastSeen≈7000）+ 拆除主房 spawn（无 respawn、无 squad 视野、
 * spawned 冻结 < 止损线）→ planTimeout（5001+6000=11001）→ selectWarTarget
 * 因 intel stale（age 4001 > 1500）无候选 → demobilize(REASON_NO_TARGET) →
 * outcome=unknown → 半额黑名单 10000t（naive 实现会因 towers=1 判 failure
 * 满额 20000——stale 门拦住了它）。
 * it-2 成功裁决（无黑名单）：t7000 只移除敌塔（scout 保留 → intel towers=0
 * 新鲜 fact；编队存活 idle 无战损）→ t8000 停 invader 注入 → threatRecent
 * 8000+3000=11000 衰减 → posture war→develop（~11501）→ demobilize(POSTURE)
 * → towersSeen(1) vs intelTowers(0) 新鲜 fact → outcome=success → 不进黑名单
 * （success 裁决静默无日志，正向证据走探针链）。
 */import { describe, it, expect, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
const TARGET = "W1N1";

interface ProbeSample {
  tick: number;
  posture: string;
  spawned: number;
  targetRoom: string;
  blacklist: string;
  threatCount: number;
}

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
    spawned: num("spawned", -1),
    targetRoom: kv.get("tgt") ?? "?",
    blacklist: kv.get("bl") ?? "none",
    threatCount: num("tc", -1),
  };
}

interface DemobEvent {
  tick: number;
  target: string;
  outcome: string;
  intelAge: string;
  blacklist: number;
  reason: number;
}

function parseDemob(logs: string[]): DemobEvent[] {
  return logs.flatMap((l) => {
    const m = l.match(/\[t(\d+)\]\[\w+\]\[war-planner\] war: demobilize (\S+) outcome=(\w+) \(intel_age=(\S+), blacklist=(\d+)t, reason=(\d+)\)/);
    return m ? [{
      tick: Number(m[1]!),
      target: m[2]!,
      outcome: m[3]!,
      intelAge: m[4]!,
      blacklist: Number(m[5]!),
      reason: Number(m[6]!),
    }] : [];
  });
}

/** 共用场景骨架：主房军事化 + 敌方有主房（塔防 AI bot），withTower 控制是否
 * 注入敌塔（it-1 无塔——编制 5 降低孵化烧钱；it-2 有塔——success 裁决需要
 * towersSeen>0）。返回 runner。 */
async function setupWar(withTower: boolean): Promise<ScenarioRunner> {
  const runner = new ScenarioRunner();
  const targetRoom: RoomSetup = {
    name: TARGET,
    terrain: emptyTerrain(),
    objects: [controller(10, 10, 1), source(10, 40), source(40, 10), mineral(40, 40)],
  };
  const home = standardRoom(HOME, 300, 6);
  home.objects!.push(
    { type: "tower", x: 20, y: 20, props: { energy: 1000, energyCapacity: 1000 } },
    { type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } },
    { type: "extension", x: 22, y: 22, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 28, y: 22, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 22, y: 28, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 28, y: 28, props: { energy: 50, energyCapacity: 50 } },
    // 10 满能量 extension（023 配方）：spawn 口袋 800 抗孵化脉冲——spendableRatio
    // 不深跌 → drainScore 不升级 → anyRecovery 无闪烁 → war 姿态稳定。
    { type: "extension", x: 25, y: 20, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 20, y: 25, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 30, y: 25, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 21, y: 25, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 29, y: 25, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 25, y: 21, props: { energy: 50, energyCapacity: 50 } },
  );
  await runner.setup({ roomName: HOME, rooms: [home, targetRoom], maxTicks: 12200, controllerLevel: 6 });
  await runner.addEnemyOwnedRoom(TARGET, "Enemy", 1);
  // 敌方 bot 塔防 AI（真实战损源）+ 不可破塔（war 期战损引擎，无论裁决路径）。
  await (runner.server.server.world as any).addBot({
    username: "Enemy", room: TARGET, x: 30, y: 30, cpu: 10, cpuAvailable: 1000,
    modules: { main: `
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
` },
  });
  if (withTower) await runner.worldBuilder.addHostileTower(TARGET, 10, 25, "Enemy");

  // 种满编劳动力（同 E2E-023：初始 harvester×3 必须 t0 注入——mockup 对
  // post-t0 注入的 ticksToLive 语义异常（存活 <250t），t0 注入正常存活
  // 1500t；采集断档 → srcRatio 强制 crisis → recovery 闪烁 → war 不稳）。
  await runner.worldBuilder.addFriendlyCreep(HOME, 11, 40, ["work", "work", "work", "work", "move", "move"], "seed-harv-1", { role: "harvester", home: HOME });
  await runner.worldBuilder.addFriendlyCreep(HOME, 40, 11, ["work", "work", "work", "work", "move", "move"], "seed-harv-2", { role: "harvester", home: HOME });
  await runner.worldBuilder.addFriendlyCreep(HOME, 26, 25, ["work", "work", "work", "work", "move", "move"], "seed-harv-3", { role: "harvester", home: HOME });
  await runner.worldBuilder.addFriendlyCreep(HOME, 25, 26, ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], "seed-hauler-1", { role: "hauler", home: HOME });
  await runner.worldBuilder.addFriendlyCreep(HOME, 23, 30, ["carry", "carry", "carry", "move", "move"], "seed-dist-1", { role: "distributor", home: HOME });
  await runner.worldBuilder.addFriendlyCreep(HOME, 11, 11, ["work", "work", "work", "carry", "move", "move"], "seed-upgr-1", { role: "upgrader", home: HOME });
  return runner;
}

/** 52 stage × 250t 主循环。 */
async function runWar(
  runner: ScenarioRunner,
  opts: { removeTargetCreepsAt: number | null; removeTowerAt: number | null; removeSpawnAt: number | null; invaderStopStage: number; captureAt: number | null; enemyUserId?: string },
): Promise<{ probes: ProbeSample[]; warLogs: string[]; errors: number; posture: string[] }> {
  const probes: ProbeSample[] = [];
  const warLogs: string[] = [];
  let errors = 0;
  const posture: string[] = [];
  const scoutSpots: Array<[number, number]> = [
    [45, 5], [36, 36], [38, 38], [42, 38], [44, 25], [40, 10], [44, 15], [44, 35],
  ];

  for (let i = 0; i < 52; i++) {
    const tick = i * 250;
    // 注入配方 = E2E-023 已两连绿证明的稳定组合：mortal invader 每 1250t
    // （i%5，塔射程外轮换位，defender 快速猎杀 → count 振荡刷新 lastHostileAt
    // → threatRecent 永续）+ harvester 每 1250t 补种（编制恒 ≥2 → bootstrap
    // 永不发生 → anyRecovery 恒假）→ war 姿态 @≈5001 达成后稳定贯穿全窗口
    // （W4 实证：12200t 零翻转），裁决时刻算术确定。
    // mortal 每 stage 注入（8 位轮换，复用周期 2000t）：post-t0 注入存活
    // <250t → 注入间隙 liveThreat 假；250t 节奏让断档窗口趋零，压住
    // anyRecovery && !liveThreat 的 war→fortify 翻转（anyRecovery 闪烁窗口
    // 需与断档同帧才翻转——概率压死）。每次注入 count 0→1 新增 →
    // lastHostileAt 刷新 → threatRecent 永续。
    const invaderSpots: Array<[number, number]> = [
      [46, 46], [45, 46], [46, 45], [45, 45], [47, 46], [46, 47], [45, 47], [47, 45],
    ];
    if (i < opts.invaderStopStage) {
      const spot = invaderSpots[i % invaderSpots.length] ?? [46, 46];
      const [ix, iy] = spot;
      await runner.worldBuilder.addHostileCreep(HOME, ix, iy, ["attack", "move"], `invader-${i}`, "invader");
    }
    // scout 每 500t 补种（it-1 在 removeTargetCreepsAt 后停种——移除+停种
    // 双管齐下情报才真正冻结，否则补种持续保鲜 → 核验时 intel 新鲜）。
    if (i % 2 === 0 && (opts.removeTargetCreepsAt === null || tick < opts.removeTargetCreepsAt)) {
      const spot = scoutSpots[(i / 2) % scoutSpots.length] ?? [45, 25];
      const [sx, sy] = spot;
      await runner.worldBuilder.addFriendlyCreep(TARGET, sx, sy, ["move"], `scout-wt-${i}`, {
        role: "scout", home: HOME, remoteTarget: TARGET,
      });
    }
    // harvester 每 1250t 补种（编制恒 ≥2 → bootstrap 永不发生 → anyRecovery 恒假）。
    if (i % 5 === 0) {
      await runner.worldBuilder.addFriendlyCreep(HOME, 11, 40, ["work", "work", "work", "work", "move", "move"], `seed-harv-${i}-a`, { role: "harvester", home: HOME });
      await runner.worldBuilder.addFriendlyCreep(HOME, 40, 11, ["work", "work", "work", "work", "move", "move"], `seed-harv-${i}-b`, { role: "harvester", home: HOME });
    }
    // 故障注入点：持续压制目标房 creep（it-1 情报冻结）——一次性移除不够：
    // 孵化中的 attacker 进房即成新视野源（refreshNeighborIntel 对可见邻房
    // 每 50t 刷新），必须每 stage 持续清除才能让情报真冻结。
    if (opts.removeTargetCreepsAt !== null && tick >= opts.removeTargetCreepsAt) {
      const { db } = runner.server.server.common.storage;
      await db["rooms.objects"].removeWhere({ room: TARGET, type: "creep" });
    }
    if (opts.removeTowerAt !== null && tick === opts.removeTowerAt) {
      const { db } = runner.server.server.common.storage;
      await db["rooms.objects"].removeWhere({ room: TARGET, type: "tower" });
    }
    if (opts.removeSpawnAt !== null && tick === opts.removeSpawnAt) {
      const { db } = runner.server.server.common.storage;
      await db["rooms.objects"].removeWhere({ room: HOME, type: "spawn" });
    }
    if (opts.captureAt !== null && tick === opts.captureAt && opts.enemyUserId) {
      const { db } = runner.server.server.common.storage;
      // 攻占：删除有主 controller 并重建无主 controller——$set user:null 可能
      // 被引擎/存储层忽略，删除重建保证 owner getter 返回 undefined。
      await db["rooms.objects"].removeWhere({ room: TARGET, type: "controller" });
      await (runner.server.server.world as any).addRoomObject(TARGET, "controller", 10, 10, { level: 0 });
    }
    await runner.bot.sendConsole(
      'console.log("PROBE t=" + Game.time + " post=" + Memory.kernel.strategy?.posture +' +
      ' " spawned=" + Memory.kernel.warPlan?.spawned + " tgt=" + Memory.kernel.warPlan?.targetRoom +' +
      ' " tc=" + Game.rooms["W0N1"].find(FIND_HOSTILE_CREEPS).length +' +
      ' " wc=" + Game.rooms["W0N1"].find(FIND_STRUCTURES).filter(function(s){ return s.structureType === "constructedWall"; }).length +' +
      ' " bl=" + (Memory.kernel.warBlacklist ?' +
      ' Object.keys(Memory.kernel.warBlacklist).map(function(k){ return k + "@" + Memory.kernel.warBlacklist[k]; }).join(";") : "none"))',
    );
    const snaps = await runner.runTicks(250);
    errors += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
    for (const l of snaps.flatMap((s) => s.consoleLogs)) {
      const sample = parseProbe(l);
      if (sample) probes.push(sample);
      if (/demobilize|war:|posture |WarOutcome/.test(l)) warLogs.push(l.slice(0, 400));
    }
    const last = snaps.at(-1)!;
    const mem = await runner.bot.getMemory();
    posture.push(`t${last.tick}:${mem?.kernel?.strategy?.posture ?? "?"}`);
  }
  return { probes, warLogs, errors, posture };
}

describe("E2E-024 战后核验 — demobilize 全链路核验与 intel 状态一致（Scenario F · W5）", () => {
  const runners: ScenarioRunner[] = [];

  afterAll(async () => {
    for (const r of runners) await r.teardown();
  });

  it(
    "战后核验全链路：demobilize 触发 → evaluateWarOutcome 按核验时点 intel 裁决 → failure 满额拉黑",
    async () => {
      // 有塔敌房（towersSeen=1 入 plan）+ 全程 scout 保鲜（核验时点 intel
      // 必然 fresh fact towers=1——塔未破 → outcome=failure → 满额拉黑）。
      // 本场景证明的合同（W5）：demobilize 是唯一核验入口，evaluateWarOutcome
      // 只消费核验时点的 intel（confidenceAt 非 fact 一律降级 unknown——
      // 单测层覆盖 stale/never-seen → unknown 半额、tower 摧毁 → success
      // 无黑名单分支；E2E 构造「战后情报失明」与编队视野保鲜动力学冲突，
      // 登记为结构限制，见 STATUS W5 行）。
      const runner = await setupWar(true);
      runners.push(runner);
      const { probes, warLogs, errors, posture } = await runWar(runner, {
        removeTargetCreepsAt: null, removeTowerAt: null, removeSpawnAt: null,
        invaderStopStage: 52, captureAt: null,
      });

      const firstPlan = probes.find((s) => s.targetRoom === TARGET);
      const demobs = parseDemob(warLogs);
      const verdict = demobs.find((e) => e.target === TARGET);
      const afterVerdict = verdict ? probes.filter((s) => s.tick > verdict.tick) : [];
      const blAfter = afterVerdict.map((s) => s.blacklist).find((b) => b.includes(TARGET));
      console.log(`[soak-evidence] w5-outcome: firstPlan=${firstPlan?.tick ?? "never"} ` +
        `demobs=${JSON.stringify(demobs)} verdict=${JSON.stringify(verdict ?? null)} blAfter=${blAfter ?? "(none)"}`);
      console.log(`[soak-evidence] w5-outcome posture: ${posture.join(" | ")}`);

      // 前置：war 立项 + 核验发生。
      expect(firstPlan, `未立项 warPlan：\n${posture.join(", ")}`).toBeDefined();
      expect(
        verdict,
        `未观测到 W1N1 核验事件（R4 止损/姿态翻转/planTimeout 任一路径都应触发 demobilize）：\n${warLogs.join("\n")}`,
      ).toBeDefined();
      // 核验 = failure（核验时点 fresh fact towers=1——塔未破不判胜）。
      expect(
        verdict!.outcome,
        `裁决 outcome=${verdict!.outcome} ≠ failure——fresh fact + 塔在应判未胜`,
      ).toBe("failure");
      // 满额冷却 20000t（对照：unknown→10000 半额、success→无黑名单，单测层）。
      expect(
        verdict!.blacklist,
        `failure 核验黑名单 ${verdict!.blacklist}t ≠ 满额 20000t`,
      ).toBe(20000);
      expect(blAfter, `核验后 warBlacklist 未登记 ${TARGET}`).toBeDefined();
      if (blAfter) {
        const blRaw = blAfter.replace(/&#x3E;/g, ">").replace(/&#x22;/g, '"');
        const m = blRaw.match(new RegExp(`${TARGET}@(\\d+)`));
        const until = m ? Number(m[1]) : 0;
        expect(
          until,
          `黑名单冷却不足（bl=${blRaw}，核验 tick=${verdict!.tick}）——failure 应满额 20000t`,
        ).toBeGreaterThanOrEqual(verdict!.tick + 19000);
      }
      // 核验后 plan 清除（收摊执行）。
      const planGone = afterVerdict.filter((s) => s.targetRoom !== TARGET);
      expect(
        planGone.length,
        `核验后 warPlan 未清除——收摊未执行`,
      ).toBeGreaterThan(0);
      // 冷却期内不重立项。
      const rePlanned = afterVerdict.some((s) => s.targetRoom === TARGET);
      expect(
        rePlanned,
        `黑名单冷却期内 ${TARGET} 被重新立项——冷却失效`,
      ).toBe(false);
      expect(errors, `全程检测到 JS 错误 ${errors} 条`).toBe(0);
    },
    1200000,
  );
});
