/**
 * 战斗黑匣子（M9）— creep 死亡事件测试。
 *
 * recordCreepDeath 由 maintainMemory 在清理死者 memory 时调用：
 * 出生 tick 从 creep 名解析（role-home-idx-birthTick-rand），位置取自
 * 上 tick 预构建的 creepLastSeen 缓存，natural 按角色寿命阈值判定。
 * 黑匣子的价值在非自然死亡（战损/事故）的复盘，事件字段必须精确。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  EventKind,
  recordCreepDeath,
  drainEventBuffer,
  roleCode,
  roleName,
} from "../../../src/kernel/event-log";
import { globalCache } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../role-helpers";

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
      "harvester", "hauler", "distributor", "upgrader", "builder", "worker",
      "defender", "remoteHarvester", "remoteHauler", "reserver", "claimer", "remoteDefender",
    ]) {
      expect(roleName(roleCode(role))).toBe(role);
    }
  });

  it("未知角色编码为 99，反查为 unknown", () => {
    expect(roleCode("ghost")).toBe(99);
    expect(roleName(99)).toBe("unknown");
  });
});
