/**
 * 孵化中的 creep 不进角色管线（kernel 侧闸门）。
 *
 * 依据是引擎语义而非风格：`Creep.prototype.move` 只在 `this.spawning` 时返回
 * ERR_BUSY（@screeps/engine game/creeps.js），也就是说给在孵 creep 跑候选链
 * 只会产出注定被拒的签发。实测 3 房发育世界：move BUSY 0.524/tick，占全部
 * 「花了 CPU 没产出」签发的 82%；且相关性干净 —— 在孵数=0 的 437 个 tick 上
 * move BUSY 恰为 0.000/tick，在孵 ≥1 的 763 个 tick 上是 0.824/tick。
 * 成本按 spawn 槽位数走而非按人口，所以帝国规模下这块只会更贵。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Kernel } from "../../../src/kernel/kernel";
import { Registry } from "../../../src/kernel/registry";
import { globalCache } from "../../../src/kernel/global-cache";
import { builderRole } from "../../../src/creeps/roles/builder";
import { upgraderRole } from "../../../src/creeps/roles/upgrader";
import { resetGlobals } from "../../support/factories";

function makeCreep(name: string, role: string, spawning = false) {
  return { name, memory: { role, home: "W7N4" }, spawning, ticksToLive: 1000 };
}

function makeCtx() {
  return {
    budget: {
      tier: "healthy",
      softLimit: 17.5,
      hardLimit: 19.2,
      canStart: () => true,
      isExhausted: () => false,
      spent: () => 0,
    },
    snapshots: () => [],
    tick: 100000,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("kernel — 孵化中的 creep 不进角色管线", () => {
  it("spawning=true 的角色一次都不跑，且跳过被记进 skip 遥测", () => {
    const kernel = new Kernel(new Registry().registerRole(builderRole).registerRole(upgraderRole));
    const bSpy = vi.spyOn(builderRole, "run").mockImplementation(() => {});
    (globalThis as any).Game.creeps = { b1: makeCreep("b1", "builder", true) };
    (globalThis as any).Memory.rooms = { W7N4: { colonyState: "normal" } };

    (kernel as any).runCreeps(makeCtx());

    expect(bSpy).not.toHaveBeenCalled();
    expect(globalCache().skipBuffer?.["creep/spawning"]).toBe(1);
  });

  it("同一只 creep 只是 spawning 变 false 就会跑 —— 上一条不是「谁都跑不了」的假绿", () => {
    const kernel = new Kernel(new Registry().registerRole(builderRole).registerRole(upgraderRole));
    const bSpy = vi.spyOn(builderRole, "run").mockImplementation(() => {});
    (globalThis as any).Game.creeps = { b2: makeCreep("b2", "builder", false) };
    (globalThis as any).Memory.rooms = { W7N4: { colonyState: "normal" } };

    (kernel as any).runCreeps(makeCtx());

    expect(bSpy).toHaveBeenCalledTimes(1);
    expect(globalCache().skipBuffer?.["creep/spawning"]).toBeUndefined();
  });
});
