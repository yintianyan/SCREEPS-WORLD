/**
 * E2E-026 site quota 极限注入 — CANARY §5.2（maxGlobalSites=7 上界实测）。
 * 双房 buildQueue 预置 20 任务/房 → construction-manager 消费 → 实际 site 数 ≤ 全局上限。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { t0Base } from "../fixtures/base";
import { isJsError } from "../../support/errors";

describe("E2E-026 site quota 极限注入", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [t0Base("W0N1"), t0Base("W0N2")],
      maxTicks: 3200,
      controllerLevel: 5,
      ownedRooms: [{ name: "W0N2", level: 4 }],
    });
  }, 120000);

  afterAll(async () => { await runner.teardown(); });

  it("双房各 20 队列任务 → 全局实际 site 数 ≤ maxGlobalSites", async () => {
    // 双房 buildQueue 各预置 20 个 queued 任务（over-quota 注入，console 写 Memory）。
    const mkQueue = (room: string) => JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({
        key: `ext.q${i}.${room}`,
        pos: { x: 20 + (i % 5) * 2, y: 20 + Math.floor(i / 5) * 2, roomName: room },
        structureType: "extension", priority: 2, state: "queued",
        attempts: 0, retryAt: 0, queuedAt: 0,
      })),
    );
    for (const room of ["W0N1", "W0N2"]) {
      await runner.bot.sendConsole(
        `Memory.rooms["${room}"].buildQueue = ${mkQueue(room)}; console.log("QSEEDED ${room}=" + Memory.rooms["${room}"].buildQueue.length)`,
      );
    }

    let maxSites = 0;
    for (let i = 0; i < 6; i++) {
      const snaps = await runner.runTicks(500);
      errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
      const last = snaps.at(-1)!;
      const raw = last.rawMemory as any;
      let sites = 0;
      if (raw?.rooms) {
        for (const rm of Object.values(raw.rooms) as any[]) {
          if (rm?.buildQueue && Array.isArray(rm.buildQueue)) {
            sites += rm.buildQueue.filter((t: any) => t && t.state === "site").length;
          }
        }
      }
      maxSites = Math.max(maxSites, sites);
    }
    console.log(
      `[soak-evidence] site-quota: maxActiveSites=${maxSites} cap=7 jsErrors=${errorsSeen} ` +
        `collectedAt=${new Date().toISOString()}`,
    );
    console.log(`[soak-evidence] site-quota binding: schemaVersion=43 rooms=W0N1+W0N2`);
    expect(maxSites, "全局实际 site 数越限").toBeLessThanOrEqual(7);
    expect(errorsSeen).toBe(0);
  }, 900000);
});
