/** Boost 报到拦截测试。 */
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

describe("boost-report — 战时报到窗口放宽（boost 战前强化链）", () => {
  /** 建立 war build 相位计划（编队目标 W6N4）。 */
  function setWarPlan(phase: "build" | "advance"): void {
    (globalThis as Record<string, any>).Memory.kernel = {
      warPlan: { targetRoom: "W6N4", sponsor: "W7N4", phase },
    };
  }

  it("war build 相位 + 编队 attacker + 窗口已过 → 仍接管报到", () => {
    setWarPlan("build");
    const creep = mockCreep({ role: "attacker", home: "W7N4" });
    creep.memory.remoteTarget = "W6N4";
    creep.ticksToLive = 500; // 通用窗口外 — 战时前馈产化合物慢，窗口放宽。
    setAssignments({ [creep.name]: { labId: "lab1", ready: true } });
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    expect(interceptForBoost(creep)).toBe(true);
  });

  it("war advance 相位（战斗推进中）→ 窗口规则不放宽，放行", () => {
    setWarPlan("advance");
    const creep = mockCreep({ role: "attacker", home: "W7N4" });
    creep.memory.remoteTarget = "W6N4";
    creep.ticksToLive = 500;
    setAssignments({ [creep.name]: { labId: "lab1", ready: true } });
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    expect(interceptForBoost(creep)).toBe(false);
  });

  it("war build 相位 + 非本计划编队的 creep（remoteTarget 不匹配）→ 放行", () => {
    setWarPlan("build");
    const creep = mockCreep({ role: "attacker", home: "W7N4" });
    creep.memory.remoteTarget = "W9N9";
    creep.ticksToLive = 500;
    setAssignments({ [creep.name]: { labId: "lab1", ready: true } });
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    expect(interceptForBoost(creep)).toBe(false);
  });

  it("war build 相位 + 非编队角色（upgrader）→ 窗口规则不放宽，放行", () => {
    setWarPlan("build");
    const creep = mockCreep({ role: "upgrader", home: "W7N4" });
    creep.ticksToLive = 500;
    setAssignments({ [creep.name]: { labId: "lab1", ready: true } });
    registerObject("lab1", { id: "lab1", pos: mockPos(20, 20) });

    expect(interceptForBoost(creep)).toBe(false);
  });
});
