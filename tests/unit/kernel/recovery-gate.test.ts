/** Kernel recovery 门禁 — 角色级 recoveryEligible 钩子（R3a）。 */
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
    // combat 紧急旁路依赖快照判断本房是否有活敌；此处无威胁场景，返回空即可。
    snapshots: () => [],
    tick: 100000,
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

  it("bootstrap 房：recoveryEligible 角色同样豁免（builder 建造关键基建）", () => {
    const kernel = makeKernel();
    const mSpy = vi.spyOn(mineralMinerRole, "run").mockImplementation(() => {});
    const bSpy = vi.spyOn(builderRole, "run").mockImplementation(() => {});
    (globalThis as any).Game.creeps = {
      mm: makeCreep("mm", "mineralMiner"),
      bd: makeCreep("bd", "builder"),
    };
    (globalThis as any).Memory.rooms = { W7N4: { colonyState: "bootstrap" } };

    (kernel as any).runCreeps(makeCtx());

    // builder 豁免：bootstrap 下建造关键基建是生存行为
    expect(bSpy).toHaveBeenCalledTimes(1);
    // mineralMiner 豁免：声明了 recoveryEligible，bootstrap 下也放行
    // （spawn demand 端已控制 bootstrap 不孵 mineralMiner，存量 creep 仍可运行）
    expect(mSpy).toHaveBeenCalledTimes(1);
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
