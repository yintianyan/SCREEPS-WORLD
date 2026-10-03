/** 战斗黑匣子（M9）— creep 死亡事件测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  EventKind,
  recordCreepDeath,
  drainEventBuffer,
  roleCode,
  roleName,
} from "../../../src/kernel/event-log";
import { globalCache } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Game.time = 82000000;
});

describe("recordCreepDeath — 死亡事件字段", () => {
  it("战损死亡：解析出生 tick、取 lastSeen 位置、natural=0", () => {
    // 出生于 400 tick 前 — 远未到 1500 寿命，属战损。
    const name = `hauler-W37S58-2-${82000000 - 400}-ab3x`;
    globalCache().creepLastSeen = new Map([[name, { r: "W37S58", x: 31, y: 24 }]]);

    recordCreepDeath(name);

    const events = drainEventBuffer();
    expect(events).toHaveLength(1);
    expect(events[0]!.k).toBe(EventKind.CreepDeath);
    expect(events[0]!.r).toBe("W37S58");
    expect(events[0]!.d).toEqual([roleCode("hauler"), 31, 24, 400, 0]);
  });

  it("寿终正寝：age 达寿命阈值时 natural=1", () => {
    const name = `harvester-W37S58-0-${82000000 - 1495}-zz9q`;
    globalCache().creepLastSeen = new Map([[name, { r: "W37S58", x: 35, y: 4 }]]);

    recordCreepDeath(name);

    const [ev] = drainEventBuffer();
    expect(ev!.d[4]).toBe(1); // natural
    expect(ev!.d[3]).toBe(1495); // age
  });

  it("CLAIM 角色（reserver）按 600 寿命判定 natural", () => {
    const name = `reserver-W37S58-0-${82000000 - 590}-k2mm`;
    globalCache().creepLastSeen = new Map();

    recordCreepDeath(name);

    const [ev] = drainEventBuffer();
    expect(ev!.d[0]).toBe(roleCode("reserver"));
    expect(ev!.d[4]).toBe(1); // 590 >= 600-60 → 自然换代。
  });

  it("lastSeen 缺位（global reset 首 tick）：降级为无位置记录，不抛错", () => {
    const name = `builder-W38S58-1-${82000000 - 200}-p0aa`;
    globalCache().creepLastSeen = undefined;

    recordCreepDeath(name);

    const [ev] = drainEventBuffer();
    expect(ev!.r).toBe("");
    expect(ev!.d[1]).toBe(-1);
    expect(ev!.d[2]).toBe(-1);
  });

  it("非标准命名（外部/手工 creep）静默跳过", () => {
    recordCreepDeath("scout1");

    expect(drainEventBuffer()).toHaveLength(0);
  });
});

describe("roleCode/roleName — 编码往返", () => {
  it("全部在册角色编码可逆", () => {
    for (const role of [
      "harvester",
      "hauler",
      "distributor",
      "upgrader",
      "builder",
      "worker",
      "defender",
      "remoteHarvester",
      "remoteHauler",
      "reserver",
      "claimer",
      "remoteDefender",
    ]) {
      expect(roleName(roleCode(role))).toBe(role);
    }
  });

  it("未知角色编码为 99，反查为 unknown", () => {
    expect(roleCode("ghost")).toBe(99);
    expect(roleName(99)).toBe("unknown");
  });
});

/**
 * #96 — 跨部署存活的战损累计线 `Memory.kernel.stats.deathByCause`。
 *
 * 立案依据（线上实测 2026-10-03）：想回答"那两次目击到底有没有造成战损"时才发现
 * `CreepDeath` 事件环按**事件总数** 500 计 ⇒ 实测只回溯 ~846 拍；M11 的
 * `globalCache().recentCombatDeaths` 只保留 2×fleetLossFuse.windowTicks = 400 拍且住 heap（换码清零）。
 * 两条都够不到 2,642/5,508 拍前的目击 ⇒ #90 判据的「持续战损」半边不可测。
 *
 * 这几条锁的是"累计线存在且分得清两类原因"，不参与任何判定。
 */
describe("recordCreepDeath — #96 deathByCause 累计线", () => {
  const combatName = (offset: number): string =>
    `hauler-W37S58-2-${(globalThis as any).Game.time - offset}-ab3x`;
  const naturalName = (): string =>
    `harvester-W37S58-0-${(globalThis as any).Game.time - 1495}-zz9q`;

  const stats = () => (globalThis as any).Memory.kernel.stats;

  it("非寿终 ⇒ combat +1、natural 不动", () => {
    (globalThis as any).Memory.kernel = { stats: {} };
    recordCreepDeath(combatName(400));
    expect(stats().deathByCause).toEqual({ natural: 0, combat: 1 });
  });

  it("寿终 ⇒ natural +1、combat 不动", () => {
    (globalThis as any).Memory.kernel = { stats: {} };
    recordCreepDeath(naturalName());
    expect(stats().deathByCause).toEqual({ natural: 1, combat: 0 });
  });

  it("混跑累计：2 战损 + 3 寿终（只增不减）", () => {
    (globalThis as any).Memory.kernel = { stats: {} };
    recordCreepDeath(combatName(300));
    recordCreepDeath(combatName(400));
    recordCreepDeath(naturalName());
    recordCreepDeath(naturalName());
    recordCreepDeath(naturalName());
    expect(stats().deathByCause).toEqual({ natural: 3, combat: 2 });
  });

  it("旧形状（stats 在、deathByCause 缺）首拍即建，不写 NaN —— 这是加键到已存在持久对象那一族的靶心用例", () => {
    (globalThis as any).Memory.kernel = { stats: { deathAnchor: { hauler: 81999000 } } };
    recordCreepDeath(combatName(400));
    expect(stats().deathByCause).toEqual({ natural: 0, combat: 1 });
    expect(Number.isFinite(stats().deathByCause.combat)).toBe(true);
    // 同处的既有对象被保留，但 deathAnchor 按设计**每拍刷成 Game.time**（它是 P1 补位时延的起点锚），
    // 所以这里断言"锚被推进"而不是"锚没动" —— 写错这半边会把正确行为测成回归。
    expect(stats().deathAnchor.hauler).toBe((globalThis as any).Game.time);
  });

  it("stats 不存在时不抛错（与 deathAnchor 同一条前置守卫）", () => {
    (globalThis as any).Memory.kernel = {};
    expect(() => recordCreepDeath(combatName(400))).not.toThrow();
    expect(stats()).toBeUndefined();
  });
});
