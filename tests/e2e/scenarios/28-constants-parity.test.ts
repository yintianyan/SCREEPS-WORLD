/**
 * E2E-028 常量 parity 哨兵（FREEZE R20② / T1）。
 *
 * 防漂移机制：support/constants（SSOT = @screeps/driver constants + 补充表）
 * 注入 unit/integration 全局的值，必须与真实引擎运行时暴露的全局常量逐键一致。
 * 本场景 boot 一次真实 server，经 console 求值玩家可见常量子集，规范化比对。
 *
 * 编号说明：27 号留作 E2E-027 退役墓碑（与 11 缺号同例），本场景取 28。
 * 命中失败即「测试私有常量与引擎语义分叉」——修 support/constants，禁止改哨兵放行。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ScenarioRunner } from "../framework";
import { t0Base } from "../fixtures/base";
import { GAME_GLOBAL_CONSTANTS } from "../../support/constants";

/** 比对子集：旧 setup.ts 手写过/跨层语义敏感的玩家可见常量 + 核心数值表。 */
const PARITY_KEYS = [
  // find
  "FIND_SOURCES", "FIND_SOURCES_ACTIVE", "FIND_DROPPED_RESOURCES", "FIND_STRUCTURES",
  "FIND_MY_STRUCTURES", "FIND_HOSTILE_STRUCTURES", "FIND_CONSTRUCTION_SITES",
  "FIND_MY_CONSTRUCTION_SITES", "FIND_HOSTILE_CREEPS", "FIND_MY_CREEPS", "FIND_CREEPS",
  "FIND_MY_SPAWNS", "FIND_MINERALS", "FIND_EXIT", "FIND_EXIT_TOP", "FIND_EXIT_RIGHT",
  "FIND_EXIT_BOTTOM", "FIND_EXIT_LEFT", "FIND_TOMBSTONES", "FIND_RUINS", "FIND_NUKES",
  // structures
  "STRUCTURE_SPAWN", "STRUCTURE_EXTENSION", "STRUCTURE_ROAD", "STRUCTURE_WALL",
  "STRUCTURE_RAMPART", "STRUCTURE_LINK", "STRUCTURE_STORAGE", "STRUCTURE_TOWER",
  "STRUCTURE_OBSERVER", "STRUCTURE_POWER_SPAWN", "STRUCTURE_EXTRACTOR", "STRUCTURE_LAB",
  "STRUCTURE_TERMINAL", "STRUCTURE_NUKER", "STRUCTURE_CONTAINER", "STRUCTURE_FACTORY",
  "STRUCTURE_POWER_BANK", "STRUCTURE_INVADER_CORE",
  // return codes
  "OK", "ERR_NOT_OWNER", "ERR_NO_PATH", "ERR_BUSY", "ERR_NOT_FOUND",
  "ERR_NOT_ENOUGH_ENERGY", "ERR_NOT_ENOUGH_RESOURCES", "ERR_INVALID_TARGET",
  "ERR_FULL", "ERR_NOT_IN_RANGE", "ERR_INVALID_ARGS", "ERR_TIRED",
  "ERR_NO_BODYPART", "ERR_RCL_NOT_ENOUGH", "ERR_GCL_NOT_ENOUGH",
  // body / misc
  "WORK", "CARRY", "MOVE", "ATTACK", "RANGED_ATTACK", "HEAL", "CLAIM", "TOUGH",
  "CARRY_CAPACITY", "RESOURCE_ENERGY", "ORDER_SELL", "ORDER_BUY",
  "TOP", "TOP_RIGHT", "RIGHT", "BOTTOM_RIGHT", "BOTTOM", "BOTTOM_LEFT", "LEFT", "TOP_LEFT",
  "TERRAIN_MASK_WALL", "TERRAIN_MASK_SWAMP",
  "LOOK_STRUCTURES", "LOOK_CONSTRUCTION_SITES", "LOOK_CREEPS", "BASE_MINERALS",
  // 数值表
  "BODYPART_COST", "CONTROLLER_STRUCTURES", "CONTROLLER_LEVELS",
  "REPAIR_POWER", "BUILD_POWER", "HARVEST_POWER", "UPGRADE_CONTROLLER_POWER",
] as const;

/**
 * mockup 运行时已知缺失的官方全局（保真度限制登记，非 SSOT 错误）：
 * - BASE_MINERALS：官服全局（docs constants），mockup VM 沙箱未暴露；
 *   src/domain/industry/procurement.ts 引用它但该路径在现有 e2e 场景未触发。
 * 反向断言：若 mockup 未来补齐，本表会导致哨兵红——届时移除对应条目即可。
 */
const KNOWN_RUNTIME_MISSING = ["BASE_MINERALS"] as const;

/** driver console 输出经 HTML 实体转义（" → &#x22; 等），求值前需还原。 */
function decodeConsoleEntities(s: string): string {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#x22;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 键序无关的规范化序列化（数组保序、对象按键排序）。 */
function canon(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v !== null && typeof v === "object") {
    return (
      "{" +
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v);
}

describe("E2E-028 常量 parity 哨兵 — support/constants ↔ 真实引擎运行时全局", () => {
  const runner = new ScenarioRunner();
  let runtimeDump: Record<string, unknown> | null = null;

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [t0Base("W0N1")],
      maxTicks: 50,
    });
    // console 求值：逐键 typeof 兜底，单键缺失不掩盖其余键的比对。
    const pairs = PARITY_KEYS.map((k) => `${k}: (typeof ${k} !== "undefined" ? ${k} : "__MISSING__")`);
    await runner.bot.sendConsole(`console.log("CONSTPARITY " + JSON.stringify({ ${pairs.join(", ")} }));`);
    const snaps = await runner.runTicks(1);
    const line = snaps
      .flatMap((s) => s.consoleLogs)
      .find((l) => l.includes("CONSTPARITY "));
    expect(line, "未捕获 CONSTPARITY 输出 — console 注入链路失败").toBeDefined();
    runtimeDump = JSON.parse(
      decodeConsoleEntities(line!.split("CONSTPARITY ")[1]!),
    );
  }, 180000);

  afterAll(async () => {
    await runner.teardown();
  });

  it(
    "玩家可见常量子集与 SSOT 逐键一致",
    () => {
      const mismatches: string[] = [];
      for (const k of PARITY_KEYS) {
        const expected = (GAME_GLOBAL_CONSTANTS as Record<string, unknown>)[k];
        const actual = runtimeDump![k];
        if (canon(expected) !== canon(actual)) {
          // 已登记的 mockup 保真度缺口：要求 runtime 确实缺失，否则仍红。
          if ((KNOWN_RUNTIME_MISSING as readonly string[]).includes(k)) {
            expect(
              actual,
              `${k} 在 KNOWN_RUNTIME_MISSING 白名单中但 runtime 已补齐 — 移除白名单条目`,
            ).toBe("__MISSING__");
            continue;
          }
          mismatches.push(`${k}: SSOT=${canon(expected)} runtime=${canon(actual)}`);
        } else if ((KNOWN_RUNTIME_MISSING as readonly string[]).includes(k)) {
          // SSOT 与 runtime 意外一致 → 白名单条目过时，红以提醒移除。
          mismatches.push(`${k}: 白名单已过时（runtime 已补齐）— 移除 KNOWN_RUNTIME_MISSING 条目`);
        }
      }
      expect(
        mismatches,
        "常量漂移（R20② 哨兵命中）— 修 support/constants，禁止改本哨兵放行:\n" +
          mismatches.join("\n"),
      ).toEqual([]);
    },
    60000,
  );
});
