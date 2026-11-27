import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalCache } from "../../../src/kernel/global-cache";
import { depositHarvesterRole } from "../../../src/creeps/roles/deposit-harvester";
import {
  mockContext,
  mockCreep,
  mockPos,
  mockSnapshot,
  mockStructure,
  registerObject,
  resetGlobals,
} from "../../support/factories";

const { moveTowardRoomMock } = vi.hoisted(() => ({ moveTowardRoomMock: vi.fn() }));

vi.mock("../../../src/creeps/movement", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../src/creeps/movement")>()),
  moveTowardRoom: moveTowardRoomMock,
}));

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

function makeDepositHarvester(opts: { roomName: string; mode: string; used: number }) {
  const creep = mockCreep({
    name: "depositHarvester-W38S56-0-84509179-t0q",
    role: "depositHarvester",
    home: "W38S56",
    mode: opts.mode,
    used: opts.used,
    capacity: 500,
    pos: mockPos(20, 20),
  });
  creep.memory.remoteTarget = "W40S55";
  creep.memory.depositId = "deposit1";
  creep.memory.depositType = "metal";
  creep.room = {
    name: opts.roomName,
    find: vi.fn(() => []),
    findExitTo: vi.fn(() => 3),
    lookForAt: vi.fn(() => []),
  };
  registerObject("deposit1", {
    id: "deposit1",
    type: "deposit",
    pos: mockPos(20, 20),
    depositType: "metal",
  });
  return creep;
}

describe("depositHarvester 满载返航", () => {
  it("remoteTarget 满载且 idle：保持 work 并立即朝 home 移动", () => {
    const creep = makeDepositHarvester({ roomName: "W40S55", mode: "idle", used: 500 });

    depositHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.memory.mode).toBe("work");
    expect(moveTowardRoomMock).toHaveBeenCalledWith(creep, "W38S56");
    expect(globalCache().obs?.roles?.[creep.name]).toMatchObject({
      exit: "return-home",
      candidate: "deposit-harvester:return-home",
      load: 500,
    });
  });

  it("remoteTarget 空载：不返航，继续采集", () => {
    const creep = makeDepositHarvester({ roomName: "W40S55", mode: "idle", used: 0 });

    depositHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(moveTowardRoomMock).not.toHaveBeenCalled();
    expect(creep.harvest).toHaveBeenCalled();
  });

  it("deposit 消失且空包：保留具体 gate 回执，不被通用 gate-blocked 覆盖", () => {
    const creep = makeDepositHarvester({ roomName: "W40S55", mode: "acquire", used: 0 });
    registerObject("deposit1", null);

    depositHarvesterRole.run(creep, mockContext(mockSnapshot()));

    expect(creep.memory.recycle).toBe(true);
    expect(globalCache().obs?.roles?.[creep.name]).toMatchObject({
      exit: "gate",
      sinkReason: "deposit-missing-empty",
    });
  });

  it("已到家满载：直接落仓，不再触发返航", () => {
    const storage = mockStructure("storage", { id: "storage1", energy: 0, capacity: 1_000_000 });
    const creep = makeDepositHarvester({ roomName: "W38S56", mode: "work", used: 500 });

    depositHarvesterRole.run(creep, mockContext(mockSnapshot({ storage })));

    expect(moveTowardRoomMock).not.toHaveBeenCalled();
    expect(creep.transfer).toHaveBeenCalledWith(storage, "metal");
  });
});
