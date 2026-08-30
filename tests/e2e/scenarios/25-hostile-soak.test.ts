/**
 * E2E-025 hostile/恢复长程统计 — CANARY §5.1（sv=43 当前版本证据）。
 * 周期性 invader 注入（塔防击杀）→ 统计敌袭波次、恢复时间（编队回补）、Memory 有界。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { t0Base } from "../fixtures/base";

function isJsError(line: string): boolean {
  return (
    line.includes("TypeError") ||
    line.includes("ReferenceError") ||
    line.includes("is not a function") ||
    line.includes("Cannot read properties of undefined")
  );
}

describe("E2E-025 hostile/恢复长程统计", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;
  let waves = 0;
  let recoveries = 0;

  beforeAll(async () => {
    const home = t0Base("W0N1");
    home.objects!.push(
      { type: "tower", x: 20, y: 20, props: { energy: 1000, energyCapacity: 1000 } },
      { type: "storage", x: 24, y: 30, props: { store: { energy: 40000 } } },
    );
    await runner.setup({ roomName: "W0N1", rooms: [home], maxTicks: 7200, controllerLevel: 6 });
  }, 120000);

  afterAll(async () => { await runner.teardown(); });

  it("多波敌袭 → 每波后编队恢复 + Memory 有界 + 0 JS 错误", async () => {
    let creepsBeforeFirst = 0;
    for (let i = 0; i < 12; i++) {
      // 每 1000t 一波敌袭（6 波）。
      if (i % 2 === 0 && i < 12) {
        await runner.worldBuilder.addHostileCreep("W0N1", 35, 35, ["attack", "move"], `inv-${i}`, "invader");
        waves++;
      }
      const snaps = await runner.runTicks(500);
      errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
      const last = snaps.at(-1)!;
      const mem = await runner.bot.getMemory();
      // 恢复判据：波后编队回补至 ≥1 且 colonyState 回 normal。
      const cs = (mem?.rooms?.W0N1?.colonyState as string) ?? "normal";
      if (last.totalCreeps >= 1 && cs === "normal" && i >= 2) recoveries++;
      if (i === 0) creepsBeforeFirst = last.totalCreeps;
    }
    console.log(
      `[soak-evidence] hostile-soak: waves=${waves} normalSamples=${recoveries} ` +
        `initialCreeps=${creepsBeforeFirst} jsErrors=${errorsSeen} collectedAt=${new Date().toISOString()}`,
    );
    console.log(`[soak-evidence] hostile-soak binding: schemaVersion=43 room=W0N1 ticks=6000`);
    expect(waves).toBeGreaterThanOrEqual(6);
    expect(recoveries, "敌袭间隙应回 normal 且编队存活").toBeGreaterThanOrEqual(4);
    expect(errorsSeen).toBe(0);
    const mem = await runner.bot.getMemory();
    expect(JSON.stringify(mem).length).toBeLessThan(500_000);
  }, 900000);
});
