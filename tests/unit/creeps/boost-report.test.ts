/**
 * Boost 报到拦截测试。
 *
 * 覆盖：报到窗口门禁（TTL）、分配表命中/未命中、lab 消失容错、
 * 相邻时原地等待（返回 true 且不移动）。
 *
 * 断链背景：boost 决策（evaluateBoostRequests）与执行（lab.boostCreep）之间
 * 缺「creep 走到 lab 旁」的就位环节时，boostCreep 因不相邻永不生效。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { interceptForBoost } from "../../../src/creeps/engine/boost-report";
import { BOOST_REPORT_TTL } from "../../../src/domain/industry/boost";
import { mockCreep, mockPos, registerObject, resetGlobals } from "../../role-helpers";

/** 在 globalCache（globalThis）上写入本 tick 的 boost 分配表。 */
function setAssignments(byCreep: Record<string, { labId: string; ready: boolean }>): void {
  (globalThis as Record<string, unknown>).boostAssignments = {
    tick: (globalThis as { Game: { time: number } }).Game.time,
    byCreep,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("boost-report — interceptForBoost", () => {
  it("报到窗口已过（TTL 低）→ 放行", () => {
    const creep = mockCreep({ role: "upgrader", home: "W7N4" });
    creep.ticksToLive = BOOST_REPORT_TTL - 100;
    setAssignments({ [creep.name]: { labId: "lab1", ready: true } });
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    expect(interceptForBoost(creep)).toBe(false);
  });

  it("无分配表 → 放行", () => {
    const creep = mockCreep({ role: "upgrader", home: "W7N4" });
    creep.ticksToLive = BOOST_REPORT_TTL + 50;

    expect(interceptForBoost(creep)).toBe(false);
  });

  it("分配表存在但不含本 creep → 放行", () => {
    const creep = mockCreep({ role: "upgrader", home: "W7N4" });
    creep.ticksToLive = BOOST_REPORT_TTL + 50;
    setAssignments({ "someone-else": { labId: "lab1", ready: true } });

    expect(interceptForBoost(creep)).toBe(false);
  });

  it("lab 已消失（getObjectById 为 null）→ 放行不卡死", () => {
    const creep = mockCreep({ role: "upgrader", home: "W7N4" });
    creep.ticksToLive = BOOST_REPORT_TTL + 50;
    setAssignments({ [creep.name]: { labId: "gone-lab", ready: true } });

    expect(interceptForBoost(creep)).toBe(false);
  });

  it("lab 化合物未就位（ready=false）→ 放行不罚站", () => {
    const creep = mockCreep({ role: "defender", home: "W7N4" });
    creep.ticksToLive = BOOST_REPORT_TTL + 50;
    setAssignments({ [creep.name]: { labId: "lab1", ready: false } });
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    // 威胁窗口角色在 lab 旁等搬运 = 战力真空，必须放行去干活。
    expect(interceptForBoost(creep)).toBe(false);
  });

  it("命中分配且已在 lab 旁 → 接管（原地等待 boostCreep）", () => {
    const creep = mockCreep({ role: "upgrader", home: "W7N4" });
    creep.ticksToLive = BOOST_REPORT_TTL + 50;
    setAssignments({ [creep.name]: { labId: "lab1", ready: true } });
    // mockPos.getRangeTo 默认返回 1 — 相邻，不触发移动。
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    expect(interceptForBoost(creep)).toBe(true);
  });
});
