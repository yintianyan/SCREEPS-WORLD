/**
 * RCL8 升级耗能的账本补记。
 *
 * 根因：`economy` 的 `upgraded` 桶来自 `controller.progress` 差分，而 RCL8 的升级
 * 计入 GCL、progress 恒不增长 ⇒ 差分恒 0，整只 upgrader 的消耗不入账（W8N3 实测
 * Σdrift −14 e/t ≈ 1 只 15W 的 15 e/t）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeController } from "../../../src/creeps/engine/actions/upgrade";
import type { ActionContext } from "../../../src/creeps/engine/action-types";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockBudget,
  mockController,
  mockCreep,
  mockSnapshot,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  // resetGlobals 把 Game.time 固定回 1000，而额度按 (房, tick) 共享 ——
  // 不清掉会让后续用例在同一 tick 上撞到上一条用尽的额度。
  globalCache().upgradeLedgerTick = undefined;
});

function upgradedOf(room = "W8N3"): number {
  return globalCache().energyLedger?.rooms[room]?.upgraded ?? 0;
}

/** 指定 WORK 部件数与背包能量、level 的升级上下文。 */
function makeAc(opts: {
  work: number;
  energy: number;
  level?: number;
  result?: number;
}): ActionContext {
  const creep = mockCreep({ name: "upgrader_1", role: "upgrader", home: "W8N3" });
  creep.body = Array.from({ length: opts.work }, () => ({ type: "work", hits: 100 }));
  creep.store = {
    getUsedCapacity: (r?: string) => (r === undefined || r === RESOURCE_ENERGY ? opts.energy : 0),
    getFreeCapacity: () => Math.max(0, 50 - opts.energy),
    getCapacity: () => 50,
  };
  creep.upgradeController = vi.fn(() => opts.result ?? OK);

  const snapshot = mockSnapshot({
    roomName: "W8N3",
    rcl: opts.level ?? 8,
    controller: mockController({ level: opts.level ?? 8 }),
  });
  return {
    creep,
    snapshot,
    assignment: undefined,
    budget: mockBudget("healthy"),
    ctx: {} as any,
  };
}

describe("countUpgrade — RCL8 升级入账", () => {
  it("RCL8 + 15 WORK + 背包 15 ⇒ 记 15（满速）", () => {
    const ac = makeAc({ work: 15, energy: 15 });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(15);
  });

  it("RCL8 + 5 WORK ⇒ 记 5（WORK 部件数封顶）", () => {
    const ac = makeAc({ work: 5, energy: 50 });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(5);
  });

  it("RCL8 + 20 WORK ⇒ 记 15（引擎 CONTROLLER_MAX_UPGRADE_PER_TICK 封顶）", () => {
    const ac = makeAc({ work: 20, energy: 50 });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(15);
  });

  it("RCL8 + 15 WORK + 背包仅 7 ⇒ 记 7（背包封顶）", () => {
    const ac = makeAc({ work: 15, energy: 7 });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(7);
  });

  it("RCL8 + 背包 0 ⇒ 不记账", () => {
    const ac = makeAc({ work: 15, energy: 0 });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(0);
  });

  it("RCL7 ⇒ 不补记（progress 差分负责，避免重复计数）", () => {
    const ac = makeAc({ work: 15, energy: 15, level: 7 });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(0);
  });

  it("签发失败（ERR_NOT_IN_RANGE）⇒ 不记账", () => {
    const ac = makeAc({ work: 15, energy: 15, result: ERR_NOT_IN_RANGE });
    upgradeController().execute(ac, ac.snapshot.controller!);
    expect(upgradedOf()).toBe(0);
  });

  it("同一 tick 两只 15W 各签发一次 ⇒ 合计只记 15（引擎每 controller 15 e/t 上限）", () => {
    const a = makeAc({ work: 15, energy: 15 });
    const b = makeAc({ work: 15, energy: 15 });
    upgradeController().execute(a, a.snapshot.controller!);
    upgradeController().execute(b, b.snapshot.controller!);
    expect(upgradedOf()).toBe(15);
  });

  it("跨 tick 签发累加：三个 tick 各记 15", () => {
    for (let i = 0; i < 3; i++) {
      (globalThis as any).Game.time += 1;
      const ac = makeAc({ work: 15, energy: 15 });
      upgradeController().execute(ac, ac.snapshot.controller!);
    }
    expect(upgradedOf()).toBe(45);
  });
});
