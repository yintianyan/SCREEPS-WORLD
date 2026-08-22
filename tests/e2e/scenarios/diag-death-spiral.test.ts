/**
 * 【Phase 3A 诊断 v5 极简】镜像 E2E-006 全程，输出人口曲线与 spawn 决策值。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";

describe("DIAG v5 人口曲线", () => {
  const runner = new ScenarioRunner();
  const botLines: string[] = [];

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 2)],
      maxTicks: 2100,
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it("11000t 人口曲线", async () => {
    const timeline: any[] = [];
    let lastDump = -500;
    for (let seg = 0; seg < 11; seg++) {
      const snaps = await runner.runTicks(1000);
      for (const s of snaps) {
        if (s.tick % 50 === 0) {
          timeline.push({ tick: s.tick, n: s.totalCreeps, roles: s.creepCountByRole });
        }
        if (s.tick - lastDump >= 500) {
          lastDump = s.tick;
          botLines.push(...runner.bot.drainConsole());
          const k = (s.rawMemory?.kernel ?? {}) as any;
          timeline.push({
            tick: s.tick,
            smTry: k._smTry ?? null,
            smLast: k._smTryLast ?? null,
            early: k._smTryEarly ?? null,
            probe: k._smProbe ?? null,
            lastError: k.stats?.lastError ?? null,
            col: s.rawMemory?.rooms?.W0N1?.colonyState,
            q: (s.rawMemory?.rooms?.W0N1?.spawnQueue ?? []).map((x: any) => x.role),
          });
        }
      }
    }
    for (const t of timeline) console.log(JSON.stringify(t));
    botLines.push(...runner.bot.drainConsole());
    const interestingBot = botLines.filter(l => l.includes('[TEMP]') || l.includes('WARN') || l.includes('spawn-manager:') || l.includes('quarantined'));
    console.log('=== BOT INTERESTING (' + interestingBot.length + '/' + botLines.length + ') ===');
    for (const l of interestingBot.slice(0, 20)) console.log(l);
    if (interestingBot.length > 20) { console.log('...'); for (const l of interestingBot.slice(-10)) console.log(l); }
    writeFileSync("/tmp/diag-v5.json", JSON.stringify(timeline));
    expect(timeline.length).toBeGreaterThan(100);
    const endMem2 = await runner.bot.getMemory();
    console.log("LAST_ERROR_STACK=" + JSON.stringify((endMem2.kernel as any)?.stats?.lastError));
  }, 1200000);

  afterAll(async () => {
    await runner.teardown();
  });
});
