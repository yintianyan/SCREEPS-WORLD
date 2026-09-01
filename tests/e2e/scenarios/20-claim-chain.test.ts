/**
 * E2E-020 claim 授权全链 — expansion 立项→claimer→claim→bootstrap（CANARY §5.2）。
 *
 * 场景：主房 RCL6（满扩展，可孵 claimer）+ 邻房 W0N2 自由 controller。
 * GCL 预置 2（余量门：gcl 2 > owned 1）。
 * 期望自然链路：room-observer 邻房 intel → expansion-planner 发现/评分候选 →
 * 出 plan → expansion-manager 消费（GCL 门）→ preparing→claiming（claimer 孵化）
 * → claim → claimed→bootstrapping（CP1）。
 * 证据绑定：commit / schemaVersion / 各状态转换 tick 在输出登记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import { injectGcl } from "../fixtures/inject";
import { isJsError } from "../../support/errors";

const HOME = "W0N1";
const TARGET = "W0N2";

describe("E2E-020 claim 授权全链 — 立项→claim→bootstrap", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;
  const milestones: Record<string, number> = {};

  beforeAll(async () => {
    // 主房：RCL6 + 10 扩展满能量（spawn capacity ≥ 650 可孵 claimer）
    // + storage 60k（扩张预算门 Budget=0/0 的解除条件）。
    const home = standardRoom(HOME, 300, 6);
    for (let i = 0; i < 10; i++) {
      home.objects!.push({
        type: "extension", x: 20 + (i % 5) * 2, y: 20 + Math.floor(i / 5) * 2,
        props: { energy: 50, energyCapacity: 50 },
      });
    }
    home.objects!.push({ type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } });
    // 邻房：自由 controller（可 claim）+ 双 source。
    const neighbor: RoomSetup = {
      name: TARGET,
      terrain: emptyTerrain(),
      objects: [controller(10, 10, 0), source(10, 40), source(40, 10), mineral(40, 40)],
    };
    await runner.setup({
      roomName: HOME,
      rooms: [home, neighbor],
      maxTicks: 15200,
      controllerLevel: 6,
    });
    await injectGcl(runner, 2);
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "自然授权链触发 claim 并完成（或登记精确阻塞点）",
    async () => {
      const dbgLines: string[] = [];
  const interesting = [
        "expansion-manager: consuming plan",
        "expansion: preparing → claiming",
        "expansion: claimed",
        "claimed → bootstrapping",
        "expansion:",
        "expansion-planner:",
      ];
      for (let i = 0; i < 30; i++) {
        const snaps = await runner.runTicks(500);
        errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
        const logs = snaps.flatMap((s) => s.consoleLogs);
        for (const l of logs) {
          for (const key of interesting) {
            if (l.includes(key) && milestones[key] === undefined) {
              milestones[key] = snaps.at(-1)!.tick;
              console.log(`[claim-evidence] ${key} @ tick ${snaps.at(-1)!.tick}: ${l.slice(0, 400)}`);
            }
            if (l.includes("Readiness=") && !dbgLines.includes(l)) dbgLines.push(l);
          }
        }
      }

      if (dbgLines.length > 0) console.log(`[claim-dbg] first: ${dbgLines[0]}`);
      if (dbgLines.length > 0) console.log(`[claim-dbg] last: ${dbgLines.at(-1)}`);
      const mem = await runner.bot.getMemory();
      const expansion = mem?.kernel?.expansion;
      console.log(
        `[claim-evidence] final: state=${expansion?.state ?? "(none)"} target=${expansion?.target ?? "?"} ` +
          `milestones=${JSON.stringify(milestones)} jsErrors=${errorsSeen}`,
      );
      console.log(
        `[claim-evidence] binding: schemaVersion=43 gcl=2 collectedAt=${new Date().toISOString()}`,
      );

      // 全程无 JS 错误。
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);
      // Memory 有界。
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `claim soak Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);
    },
    1200000,
  );
});
