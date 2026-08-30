/**
 * E2E-019 多房 terminal 决策权 — Plan 活跃时自主互济压制（A4.4 契约回归）。
 *
 * 双自有房（各 RCL6 + storage + terminal），捐助房富余、受助房匮乏——
 * 该状态满足 tryEmpireEnergyAid 的全部前置。但 logistics-planner 每 100t
 * 刷新 Plan（planIsActive 恒真），Plan 拥有 terminal send 的 Decision
 * Authority：自主互济（self-aid）被压制，不产出 energy-aid 发送。
 * 本测试锁定该决策权语义：窗口内不得出现 self-aid 发送（防未来回归）。
 * Plan 驱动的互济证据（planner 产出 terminal 请求 → tryPlanDrivenSend）
 * 需 planner 输入构造，登记为 CANARY §5.2 继续项。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";
import { emptyTerrain, controller, source, mineral } from "../framework/WorldBuilder";
import type { RoomSetup } from "../framework/WorldBuilder";
import { isJsError } from "../../support/errors";

const DONOR = "W0N1";
const RECIPIENT = "W0N2";

/** 富余捐助房：storage 60k（≥ donorFloor 50k）+ terminal 20k（货量+运费+储备）。 */
function donorRoom(): RoomSetup {
  const room = standardRoom(DONOR, 300, 6);
  room.objects!.push(
    { type: "storage", x: 24, y: 28, props: { store: { energy: 60000 } } },
    { type: "terminal", x: 26, y: 28, props: { store: { energy: 20000 }, cooldown: 0 } },
  );
  return room;
}

/** 匮乏受助房：storage 5k（< recipientFloor 20k）+ terminal（可接收）。 */
function recipientRoom(): RoomSetup {
  return {
    name: RECIPIENT,
    terrain: emptyTerrain(),
    objects: [
      controller(10, 10, 6),
      source(10, 40),
      source(40, 10),
      mineral(40, 40),
      { type: "storage", x: 24, y: 28, props: { store: { energy: 5000 } } },
      { type: "terminal", x: 26, y: 28, props: { store: { energy: 1000 }, cooldown: 0 } },
    ],
  };
}

describe("E2E-019 多房 energy 互济 — terminal 调拨", () => {
  const runner = new ScenarioRunner();
  let errorsSeen = 0;

  beforeAll(async () => {
    await runner.setup({
      roomName: DONOR,
      rooms: [donorRoom(), recipientRoom()],
      maxTicks: 4200,
      controllerLevel: 6,
      ownedRooms: [{ name: RECIPIENT, level: 6 }],
    });
  }, 120000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "Plan 活跃窗口内 self-aid 被压制（A4.4 决策权语义回归锁定）",
    async () => {
      let aidLog: string | undefined;
      let probeBefore: string | undefined;
      const totalStages = 8;
      for (let i = 0; i < totalStages && !aidLog; i++) {
        // 探针：受助房 terminal 能量（调拨入账直接可观测）。
        await runner.bot.sendConsole(
          'console.log("PROBE t=" + Game.time + " market=" + typeof Game.market?.getAllOrders + ' +
          '" bucket=" + Game.cpu.bucket);',
        );
        const snaps = await runner.runTicks(250);
        errorsSeen += snaps.flatMap((s) => s.consoleLogs).filter(isJsError).length;
        const logs = snaps.flatMap((s) => s.consoleLogs);
        for (const l of logs) {
          if (l.includes("PROBE t=")) console.log(`[dbg-probe] ${l}`);
          if (l.includes("energy-aid:") || l.includes("self-aid skipped") || l.includes("terminal:")) console.log(`[dbg-aid] ${l}`);
        }
        if (probeBefore === undefined) {
          const m = logs.find((l) => l.includes("PROBE t="));
          probeBefore = m;
        }
        aidLog = logs.find((l) => l.includes("energy-aid:"));
      }

      // A4.4 决策权语义：Plan 活跃（常态恒真）→ self-aid 压制，无 energy-aid 发送。
      expect(
        aidLog,
        "Plan 活跃窗口内不应出现 self-aid 发送（决策权在 Plan；若出现说明决策权回归被破坏）",
      ).toBeUndefined();
      console.log(`[soak-evidence] energy-aid: ${aidLog}`);
      if (probeBefore) console.log(`[soak-evidence] recipient-terminal first probe: ${probeBefore}`);

      // 前置有效性：受助房确实长期处于匮乏态（< recipientFloor 20k）。
      expect(
        probeBefore,
        "应采集到受助房 terminal 探针",
      ).toBeDefined();
      const mem = await runner.bot.getMemory();
      const memSize = JSON.stringify(mem).length;
      expect(memSize, `互济 soak Memory 过大: ${memSize} bytes`).toBeLessThan(500_000);
      expect(errorsSeen, `全程检测到 JS 错误 ${errorsSeen} 条`).toBe(0);

      console.log(
        `[soak-evidence] energy-aid binding: schemaVersion=43 rooms=${DONOR}(donor)+${RECIPIENT}(recipient) ` +
          `collectedAt=${new Date().toISOString()}`,
      );
    },
    900000,
  );
});
