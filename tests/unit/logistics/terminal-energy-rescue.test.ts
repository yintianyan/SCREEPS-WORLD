/**
 * withdrawTerminalEnergy 无市场回流测试（W7 止血）。
 *
 * 背景：无市场（私服）时 terminal 能量无消费方、无回流路径 → 永久锁死
 * （W7N3/W7N4 实测各 ~10k、真实可用储备 3-9k）。hauler 从 terminal 取能量
 * 回 storage（work 链 fillStorage 承接），仅无市场 + storage 枯竭时触发。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { withdrawTerminalEnergy } from "../../../src/creeps/engine/actions/industry";
import { haulerRole } from "../../../src/creeps/roles/hauler";
import { mockContext, mockCreep, mockSnapshot, mockStructure, resetGlobals } from "../../role-helpers";

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

  it("无市场 + storage 枯竭 → resolve 返回 terminal（取能相）", () => {
    const { ac } = makeAc();
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeDefined();
  });

  it("有市场 → resolve 返回 undefined（运费储备不得挪用）", () => {
    (globalThis as any).Game.market = { getAllOrders: () => [], credits: 0 };
    const { ac } = makeAc();
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("storage 已有能量但有空位 → 仍触发（无市场全量排空，评审修正 P2-2）", () => {
    const { ac } = makeAc({ storageEnergy: 30000 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeDefined();
  });

  it("storage 无剩余容量 → 不触发", () => {
    const { ac } = makeAc({ storageEnergy: 1000000 });
    expect(withdrawTerminalEnergy().resolve!(ac)).toBeUndefined();
  });

  it("terminal 无能量 → 不触发", () => {
    const { ac } = makeAc({ terminalEnergy: 0 });
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
  it("无市场 + terminal 有能量 + storage 有空位 → hauler 从 terminal 取能", () => {
    const storage = mockStructure("storage", { id: "st", energy: 0, capacity: 1000000 });
    const terminal = mockStructure("terminal", { id: "tm", energy: 10400, capacity: 1000000 });
    const snap = mockSnapshot({ storage, terminal });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 300, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.withdraw).toHaveBeenCalledWith(terminal, "energy", 300);
  });
});
