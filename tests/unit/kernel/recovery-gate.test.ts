/**
 * Kernel recovery 门禁 — 角色级 recoveryEligible 钩子（R3a）。
 *
 * 背景：recovery 时 P2+ 角色默认被 colony-state 门禁跳过（保命优先）；builder
 * （重建基建）与 mineralMiner（矿物收入，不耗能量）是「生存/脱困路径」，由角色
 * 自报 recoveryEligible 豁免 — kernel 不再硬编码角色名。bootstrap 一律不豁免。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Kernel } from "../../../src/kernel/kernel";
import { Registry } from "../../../src/kernel/registry";
import { mineralMinerRole } from "../../../src/creeps/roles/mineral-miner";
import { builderRole } from "../../../src/creeps/roles/builder";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import { resetGlobals } from "../../role-helpers";

function makeCreep(name: string, role: string, home = "W7N4") {
  return { name, memory: { role, home }, ticksToLive: 1000 };
}

function makeKernel() {
  return new Kernel(
    new Registry()
      .registerRole(mineralMinerRole)
      .registerRole(builderRole)
      .registerRole(upgraderRole),
  );
}

/** recovery tier 预算：仅放行 P0/P1 — 豁免角色必须以等效 P1 通过。 */
function makeCtx() {
  return {
    budget: {
      tier: "recovery",
      softLimit: 0,
      hardLimit: 5,
      canStart: (p: number) => p <= 1,
      isExhausted: () => false,
      spent: () => 0,
    },
  };
}

beforeEach(() => {
  resetGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Kernel recovery 门禁 — recoveryEligible 角色豁免（R3a）", () => {
  it("recovery 房：mineralMiner/builder 豁免执行，upgrader 跳过", () => {
    const kernel = makeKernel();
    const mSpy = vi.spyOn(mineralMinerRole, "run").mockImplementation(() => {});
    const bSpy = vi.spyOn(builderRole, "run").mockImplementation(() => {});
    const uSpy = vi.spyOn(upgraderRole, "run").mockImplementation(() => {});
    (globalThis as any).Game.creeps = {
      mm: makeCreep("mm", "mineralMiner"),
      bd: makeCreep("bd", "builder"),
      up: makeCreep("up", "upgrader"),
    };
    (globalThis as any).Memory.rooms = { W7N4: { colonyState: "recovery" } };

    (kernel as any).runCreeps(makeCtx());

    expect(mSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).toHaveBeenCalledTimes(1);
    expect(uSpy).not.toHaveBeenCalled();
  });

  it("bootstrap 房：P2 全部跳过（豁免仅限 recovery）", () => {
    const kernel = makeKernel();
    const mSpy = vi.spyOn(mineralMinerRole, "run").mockImplementation(() => {});
    const bSpy = vi.spyOn(builderRole, "run").mockImplementation(() => {});
    (globalThis as any).Game.creeps = {
      mm: makeCreep("mm", "mineralMiner"),
      bd: makeCreep("bd", "builder"),
    };
    (globalThis as any).Memory.rooms = { W7N4: { colonyState: "bootstrap" } };

    (kernel as any).runCreeps(makeCtx());

    expect(mSpy).not.toHaveBeenCalled();
    expect(bSpy).not.toHaveBeenCalled();
  });

  it("recovery tier 预算：豁免角色以 P1 等效优先级通过（不被 maxPriority=1 拦截）", () => {
    const kernel = makeKernel();
    const mSpy = vi.spyOn(mineralMinerRole, "run").mockImplementation(() => {});
    (globalThis as any).Game.creeps = { mm: makeCreep("mm", "mineralMiner") };
    (globalThis as any).Memory.rooms = { W7N4: { colonyState: "recovery" } };

    (kernel as any).runCreeps(makeCtx());

    expect(mSpy).toHaveBeenCalledTimes(1);
  });
});
