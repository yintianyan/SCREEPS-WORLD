/** withdrawTerminalEnergy 饥饿压缩测试（W7 止血修正）。 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { withdrawTerminalEnergy } from "../../../src/creeps/engine/actions/industry";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { mockContext, mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../support/factories";

describe("withdrawTerminalEnergy — 无市场死能量回流（W7 止血）", () => {
  beforeEach(() => {
    resetGlobals();
  });

  function makeAc(opts: { terminalEnergy?: number; storageEnergy?: number } = {}) {
    const { terminalEnergy = 10400, storageEnergy = 0 } = opts;
    const storage = mockStructure("storage", { id: "st", energy: storageEnergy, capacity: 1000000 });
    const terminal = mockStructure("terminal", { id: "tm", energy: terminalEnergy, capacity: 1000000 });
    const snap = mockSnapshot({ storage, terminal });
    const creep = mockCreep({ role: "hauler", used: 0, capacity: 300 });
    const ctx = mockContext(snap);
    return {
      ac: { creep, snapshot: snap, assignment: undefined, budget: ctx.budget, ctx },
      terminal,
      storage,
      creep,
    };
  }

  it("storage 枯竭 + terminal 有能量 → resolve 返回 terminal（取能相）", () => {
    const { ac } = makeAc();
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeDefined();
  });

  it("storage 已有能量但低于地板（如 5k）→ 仍触发（饥饿压缩）", () => {
    const { ac } = makeAc({ storageEnergy: 5000 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeDefined();
  });

  it("storage 高于地板（20k）→ 不触发（保留交易储备）", () => {
    const { ac } = makeAc({ storageEnergy: 30000 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("storage 无剩余容量 → 不触发", () => {
    const { ac } = makeAc({ storageEnergy: 1000000 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("terminal 无能量 → 不触发", () => {
    const { ac } = makeAc({ terminalEnergy: 0 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("有市场：terminal 高于 2k 地板 → 触发（只留运费余量）", () => {
    (globalThis as any).Game.market = { getAllOrders: () => [], credits: 0 };
    const { ac } = makeAc({ terminalEnergy: 10400 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeDefined();
  });

  it("有市场：terminal 已压到地板（≤2k）→ 不触发", () => {
    (globalThis as any).Game.market = { getAllOrders: () => [], credits: 0 };
    const { ac } = makeAc({ terminalEnergy: 2000 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("execute：在范围内 → withdraw 调用；超范围 → 只触发移动", () => {
    const { ac, terminal, creep } = makeAc();
    const action = withdrawTerminalEnergy();
    // 默认 mockPos.getRangeTo 返回 1 → 直接 withdraw。
    action.execute!(ac, terminal);
    expect(creep.withdraw).toHaveBeenCalledWith(terminal, RESOURCE_ENERGY, 300);

    // NOT_IN_RANGE → 触发 moveToTarget（移动铁律：仅主动作失败才移动）。
    // traffic 关闭（测试默认）时 registerMove 直通 creep.move。
    (creep.withdraw as ReturnType<typeof vi.fn>).mockReturnValueOnce(ERR_NOT_IN_RANGE);
    action.execute!(ac, terminal);
    expect(creep.move).toHaveBeenCalled();
  });
});

describe("hauler 角色接线 — terminal 救援参与 acquire 链", () => {
  it("storage 饥饿 + terminal 有能量 → hauler 从 terminal 取能", () => {
    const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    const terminal = mockStructure("terminal", { id: "tm", energy: 10400, capacity: 1000000 });
    const snap = mockSnapshot({ storage, terminal });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(terminal, "energy", 300);
  });
});
