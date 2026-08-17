/**
 * Healer 角色行为测试（heal-tank 最小闭环治疗端）。
 *
 * 覆盖：
 *   - 受伤己方最近者：range 1 → heal；range 2-3 → rangedHeal + 贴近；远 → moveTo
 *   - 满血 buddy attacker：range > 1 跟随贴身；range 1 静默待命
 *   - 自身受伤且无他人 → 自奶
 *   - 编队不存在（无受伤无 attacker）→ 自标记 recycle 止损
 *   - 自身低血（< retreatRatio）→ markRetreat 接管，不治疗
 *   - build 相位（warPlan.phase="build"）→ attackerHold 集结复用生效（归建）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { healerRole } from "../../../src/creeps/roles/healer";
import { mockContext, mockCreep, mockPos, mockSnapshot, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
});

/** mockPos.getRangeTo 恒 1 — 距离敏感分支需要真实 Chebyshev 补丁。 */
function realRangePos(pos: any): any {
  pos.getRangeTo = (t: any) =>
    Math.max(Math.abs(pos.x - (t.x ?? t.pos?.x ?? 0)), Math.abs(pos.y - (t.y ?? t.pos?.y ?? 0)));
  return pos;
}

/** 战友 mock（attacker）— findBuddy/findWounded 只读这些字段。 */
function buddyCreep(
  name: string,
  overrides: { hits?: number; x?: number; roomName?: string } = {},
): any {
  return {
    name,
    memory: { role: "attacker" },
    room: { name: overrides.roomName ?? "W6N4" },
    pos: realRangePos(mockPos(overrides.x ?? 26, 25, "W6N4")),
    hits: overrides.hits ?? 1000,
    hitsMax: 1000,
  };
}

/** 构造已到达 war 目标房（W6N4）的 healer。 */
function healerInTarget(overrides: { hits?: number; x?: number } = {}): any {
  const creep = mockCreep({
    name: "healer_1",
    role: "healer",
    mode: "acquire",
    home: "W7N4",
    used: 0,
    capacity: 0,
    pos: realRangePos(mockPos(overrides.x ?? 25, 25, "W6N4")),
  });
  creep.memory.remoteTarget = "W6N4";
  creep.room = { name: "W6N4", findExitTo: vi.fn(() => 3), lookForAt: vi.fn(() => []) };
  creep.heal = vi.fn(() => 0);
  creep.rangedHeal = vi.fn(() => 0);
  if (overrides.hits !== undefined) creep.hits = overrides.hits;
  return creep;
}

/** Game.creeps 填充（healer 自身 + 战友）。 */
function setGameCreeps(...creeps: any[]): void {
  const map: Record<string, any> = {};
  for (const c of creeps) map[c.name] = c;
  (globalThis as any).Game.creeps = map;
}

describe("healer 角色 — 救治", () => {
  it("受伤己方在 range 1 → 全额 heal", () => {
    const healer = healerInTarget();
    const wounded = buddyCreep("attacker_1", { hits: 400, x: 25 });
    setGameCreeps(healer, wounded);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.heal).toHaveBeenCalledWith(wounded);
  });

  it("受伤己方在 range 3 → rangedHeal 过渡 + 继续贴近", () => {
    const healer = healerInTarget();
    const wounded = buddyCreep("attacker_1", { hits: 400, x: 28 });
    setGameCreeps(healer, wounded);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.rangedHeal).toHaveBeenCalledWith(wounded);
    expect(healer.moveTo).toHaveBeenCalled();
  });

  it("自身受伤且无他人 → 自奶", () => {
    const healer = healerInTarget({ hits: 500 });
    setGameCreeps(healer);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.heal).toHaveBeenCalledWith(healer);
  });
});

describe("healer 角色 — 跟随", () => {
  it("满血 buddy 在 range > 1 → 跟随贴身（不 heal）", () => {
    const healer = healerInTarget();
    const buddy = buddyCreep("attacker_1", { x: 30 });
    setGameCreeps(healer, buddy);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.heal).not.toHaveBeenCalled();
    expect(healer.moveTo).toHaveBeenCalled();
  });

  it("满血 buddy 在 range 1 → 静默待命（无任何意图）", () => {
    const healer = healerInTarget();
    const buddy = buddyCreep("attacker_1", { x: 25 });
    setGameCreeps(healer, buddy);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.heal).not.toHaveBeenCalled();
    expect(healer.moveTo).not.toHaveBeenCalled();
  });
});

describe("healer 角色 — 异常与止损", () => {
  it("编队不存在（无受伤无 attacker）→ 自标记 recycle", () => {
    const healer = healerInTarget();
    setGameCreeps(healer);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.memory.recycle).toBe(true);
    expect(healer.heal).not.toHaveBeenCalled();
  });

  it("自身低血 → markRetreat 接管（回收撤退，不再治疗他人）", () => {
    const healer = healerInTarget({ hits: 200 });
    const wounded = buddyCreep("attacker_1", { hits: 400, x: 25 });
    setGameCreeps(healer, wounded);

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.memory.recycle).toBe(true);
    expect(healer.heal).not.toHaveBeenCalled();
  });

  it("build 相位 → attackerHold 集结复用：在外归建（不作战）", () => {
    const healer = healerInTarget();
    setGameCreeps(healer);
    // warPlan build 相位 + healer 在 home 之外（W6N4 ≠ home W7N4）。
    (globalThis as any).Memory.kernel = {
      warPlan: {
        targetRoom: "W6N4",
        sponsor: "W7N4",
        squadSize: 3,
        since: 900,
        towersSeen: 0,
        phase: "build",
      },
    };

    healerRole.run(healer, mockContext(mockSnapshot()));

    expect(healer.heal).not.toHaveBeenCalled();
  });
});
