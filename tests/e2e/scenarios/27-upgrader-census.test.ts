/** E2E-027 诊断探针 — RCL7 素房 upgrader 供给链普查（速率根因定位）。 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";

describe("E2E-027 upgrader 供给链普查", () => {
  const runner = new ScenarioRunner();
  beforeAll(async () => {
    const room = standardRoom("W0N1", 300, 7);
    room.objects!.push({ type: "storage", x: 24, y: 30, props: { store: { energy: 60000 } } });
    await runner.setup({ roomName: "W0N1", rooms: [room], maxTicks: 4200, controllerLevel: 7 });
  }, 120000);
  afterAll(async () => { await runner.teardown(); });

  it("分阶段打印 upgrader/body/container/storage 普查", async () => {
    for (let i = 0; i < 8; i++) {
      await runner.bot.sendConsole(
        'console.log("CENSUS t=" + Game.time + ' +
        '" roles=" + JSON.stringify(Object.values(Game.creeps).reduce((a,c)=>{const r=c.memory.role||"?";a[r]=(a[r]||0)+1;return a;},{})) + ' +
        '" upW=" + JSON.stringify(Object.values(Game.creeps).filter(c=>c.memory.role==="upgrader").map(c=>c.body.filter(p=>p.type==="work").length)) + ' +
        '" containers=" + JSON.stringify(Object.values(Game.rooms.W0N1.find(FIND_STRUCTURES)).filter(s=>s.structureType==="container").map(c=>[Math.round(c.pos.x/10),Math.round(c.pos.y/10),c.store.energy])) + ' +
        '" links=" + Object.values(Game.rooms.W0N1.find(FIND_STRUCTURES)).filter(s=>s.structureType==="link").length + ' +
        '" storage=" + (Game.rooms.W0N1.storage ? Game.rooms.W0N1.storage.store.energy : -1))',
      );
      const snaps = await runner.runTicks(500);
      for (const l of snaps.flatMap((s) => s.consoleLogs)) {
        if (l.includes("CENSUS")) console.log(l.replace(/^.*CENSUS/, "CENSUS"));
      }
    }
    expect(true).toBe(true);
  }, 900000);
});
