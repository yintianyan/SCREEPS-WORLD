/**
 * E2E-021 诱饵对抗（Scenario F）— 诱饵不触发授权（R18/W2，Phase 9 验收）。
 *
 * 场景：主房 RCL6+storage+塔（军事可行）；邻房 W1N1 为诱饵——早期情报显示
 * 「敌方无塔空城」（fact），此后不再刷新（威胁短窗 200t 内必然降级 stale）。
 * 同时对主房持续注入 NPC invader（threatWindow 3000t 内保持 threatRecent）
 * → fortify 驻留 5000t → 自然升 war 姿态。
 *
 * 断言：war 姿态达成后，诱饵目标（stale intel）不得触发 warPlan——
 * 授权只认 fact 级目标（INTELLIGENCE §5；欺骗最多骗到侦察预算，骗不到战争授权）。
 * 证据绑定：commit / schemaVersion / 姿态与授权时间线在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import { injectEnemyRoom, injectFriendlyCreep, injectHostile } from "../fixtures/inject";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
const DECOY = "W1N1";

describe("E2E-021 诱饵对抗 — 诱饵不触发授权（Scenario F）", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;
  let warSeen = false;
  let decoyAuthorized = false;
  const timeline: string[] = [];

  beforeAll(async () => {
    // 诱饵房：normal 邻房，controller 预置归敌对用户「Enemy」（war 目标形态）。
    const decoyRoom: RoomSetup = {
      name: DECOY,
      terrain: emptyTerrain(),
      objects: [controller(10, 10, 1), source(10, 40), source(40, 10), mineral(40, 40)],
    };
    // 主房军事化：塔（有能量）击杀 invader 保经济不受损——无塔时 invader 杀
    // harvester 触发经济可持续性门（avgPressure/anyRecovery）拦住 war（行为方差
    // 根因）；storage 60k 解除 war 预算门。
    const home = standardRoom(HOME, 300, 6);
    home.objects!.push(
      { type: "tower", x: 20, y: 20, props: { energy: 1000, energyCapacity: 1000 } },
      { type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } },
    );
    await runner.setup({
      roomName: HOME,
      rooms: [home, decoyRoom],
      maxTicks: 9200,
      controllerLevel: 6,
    });
    await injectEnemyRoom(runner, DECOY, "Enemy", 1);
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "war 姿态下 stale 诱饵情报不触发 warPlan；全程存活",
    async () => {
      // 经济鲁棒性（回归根因修复）：standardRoom 零 creep 冷启动会经历 bootstrap
      // （understaffed：harvester < 2 source）→ anyRecovery 拦截 fortify→war 门，
      // 且 war 达成后注入间隙的 anyRecovery 闪烁触发 war→fortify 立即降级
      // （posture.ts:163）→ since 重置重走 5000t 驻留。种子满编劳动力（生产角色，
      // 由 bot assignment 接管）跳过冷启动，war 门在场景开始即只依赖真实经济信号。
      // TTL 1500 自然死亡 → 替换走生产 spawn 路径（pendingHarvesters 防替换期假 bootstrap）。
      await injectFriendlyCreep(runner, HOME, 11, 40, ["work", "work", "work", "work", "move", "move"], "seed-harv-1", { role: "harvester", home: HOME });
      await injectFriendlyCreep(runner, HOME, 40, 11, ["work", "work", "work", "work", "move", "move"], "seed-harv-2", { role: "harvester", home: HOME });
      await injectFriendlyCreep(runner, HOME, 26, 25, ["work", "work", "work", "work", "move", "move"], "seed-harv-3", { role: "harvester", home: HOME });
      await injectFriendlyCreep(runner, HOME, 25, 26, ["carry", "carry", "carry", "carry", "move", "move", "move", "move"], "seed-hauler-1", { role: "hauler", home: HOME });
      await injectFriendlyCreep(runner, HOME, 23, 30, ["carry", "carry", "carry", "move", "move"], "seed-dist-1", { role: "distributor", home: HOME });
      await injectFriendlyCreep(runner, HOME, 11, 11, ["work", "work", "work", "carry", "move", "move"], "seed-upgr-1", { role: "upgrader", home: HOME });

      // 诱饵情报播种（生产路径）：t≈100 放一只 bot scout 进诱饵房 → 房间可见
      // → refreshNeighborIntel 带视野采集（owner=Enemy, towers=0, towers 字段
      // 触发威胁短窗 TTL 200t）。scout TTL 1500 自然死亡 → 视野消失 → 情报
      // 停在最后一次观测 → 决策时点（war 达成后）必然 stale（非 fact）。
      await injectFriendlyCreep(runner, DECOY, 25, 25, ["move"], "scout-decoy", {
        role: "scout", home: HOME, remoteTarget: DECOY,
      });

      const totalStages = 18;
      for (let i = 0; i < totalStages; i++) {
        const tick = i * 500;
        // 高频再注入：塔击杀保经济，目击刷新 lastHostileAt 维持 threatRecent——
        // 「反复试探性攻击维持战争姿态」是生产语义。
        if (tick >= 200 && tick <= 6000) {
          await injectHostile(runner, HOME, 35, 35, ["attack", "move"], `invader-${i}`, "invader");
        }

        // war 门三条件探针：colonyState（anyRecovery）/ economyPressure（压力门）/
        // since（驻留基准）/ phase.phase（闪烁溯源：bootstrap vs crisis 带）。
        // economyPressure 在 RoomMemory 顶层（room-state.ts 每 tick 写入，
        // phase 子对象无此字段——上一版探针读错路径导致 p=undefined 假象）。
        await runner.bot.sendConsole(
          'console.log("PROBE t=" + Game.time + " cs=" + Memory.rooms["W0N1"].colonyState + ' +
          '" ph=" + Memory.rooms["W0N1"].phase?.phase + ' +
          '" p=" + Memory.rooms["W0N1"].economyPressure + ' +
          '" since=" + Memory.kernel.strategy?.since + " post=" + Memory.kernel.strategy?.posture)',
        );
        const snaps = await runner.runTicks(500);
        const last = snaps.at(-1)!;
        errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
        for (const l of snaps.flatMap((s) => s.consoleLogs)) {
          if (l.includes("PROBE t=")) timeline.push(l.replace(/^.*PROBE /, "PROBE "));
        }
        const mem = await runner.bot.getMemory();
        const posture = mem?.kernel?.strategy?.posture;
        const warPlan = mem?.kernel?.warPlan;
        if (posture === "war") warSeen = true;
        if (warPlan && warPlan.targetRoom === DECOY) decoyAuthorized = true;
        timeline.push(`t${last.tick}:${posture ?? "?"}${warPlan ? `(plan→${warPlan.targetRoom})` : ""}`);
      }

      // ── 证据登记 ──
      console.log(`[soak-evidence] decoy probes: ${timeline.slice(-6).join(" | ")}`);
      console.log(
        `[soak-evidence] decoy: warSeen=${warSeen} decoyAuthorized=${decoyAuthorized} jsErrors=${errorsSeen}`,
      );
      console.log(
        `[soak-evidence] decoy binding: schemaVersion=43 gcl=1 collectedAt=${new Date().toISOString()}`,
      );

      // ── 断言 ──
      // war 姿态自然达成（fortify 驻留 5000t + 威胁未消 → war）。
      expect(
        warSeen,
        `8000 tick 内未达成 war 姿态（fortify 驻留 + 威胁维持应升 war）：\n${timeline.join(", ")}`,
      ).toBe(true);
      // 核心断言：诱饵（stale intel）不得触发对 W1N1 的 warPlan。
      expect(
        decoyAuthorized,
        `诱饵目标触发了授权——fact 硬门槛被绕过！\n${timeline.join(", ")}`,
      ).toBe(false);
      // 全程无 JS 错误。
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);
    },
    1200000,
  );
});
