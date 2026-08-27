/** stockTerminalEnergy 无市场守卫测试（W7 止血）。 */
import { describe, expect, it, beforeEach } from "vitest";
import { stockTerminalEnergy } from "../../../src/creeps/engine/actions/industry";
import { mockContext, mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../role-helpers";

describe("stockTerminalEnergy — 无市场守卫（W7 止血）", () => {
  beforeEach(() => {
    resetGlobals();
  });

  function makeAc() {
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 1000000 });
    const terminal = mockStructure("terminal", { id: "tm", energy: 0, capacity: 1000000 });
    const snap = mockSnapshot({ storage, terminal });
    const creep = mockCreep({ role: "distributor", used: 0, capacity: 300 });
    const ctx = mockContext(snap);
    return {
      ac: { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx },
      terminal,
    };
  }

  it("Game.market 缺失（私服）→ resolve 返回 undefined，不向 terminal 灌能量", () => {
    const { ac } = makeAc();
    // resetGlobals 不注入 Game.market — 守卫应短路。
    expect(stockTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("Game.market 存在 → 正常 resolve（空载取 storage 相）", () => {
    (globalThis as any).Game.market = {
      getAllOrders: () => [],
      credits: 1000,
      calcTransactionCost: () => 0,
      deal: () => 0,
    };
    const { ac } = makeAc();
    const target = stockTerminalEnergy().resolve!(ac);
    expect(target).toBeDefined();
    expect(target!.phase).toBe("withdraw");
  });
});
