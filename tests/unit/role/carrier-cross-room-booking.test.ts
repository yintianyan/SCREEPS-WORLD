/**
 * 债单 #42 下半场（= 并行债单 #59）：carrier 是帝国里唯一绕过 `terminal.send` 的跨房通道
 * （幼房没有 terminal，走不到 terminal-selfaid 那条已补过的路），而它的装载/卸载原本都是裸调用
 * ⇒ 能量真的离开帝国一侧的池时，两侧都没有计数器接住，两间房的 drift 各自关不上。
 * 判据：**在"卸能成功"的同一拍成对入账** —— 收端按目标池所在房记 `imported`，发端按背包出发的房记 `exported`。
 * 取能时刻刻意不记：storage→carry 两头都在同一房的 tracked 池里，先记会把"满载但还没出门"当成已发出
 * （线上实测过满载 carrier 停在出生区耗完整段寿命的形态，见 carrier-idle-hook 回归）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { carrierRole } from "../../../src/creeps/roles/carrier";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

const HOME = "W37S58";
const TARGET = "W38S56";

/** 入账量（没建过条目 = 0）—— heap 计数器条目初始化即全 0，故用「等于 0」而不是「键不存在」。 */
function booked(room: string, field: string): number {
  const g = globalCache() as {
    energyLedger?: { rooms?: Record<string, Record<string, number>> };
  };
  return g.energyLedger?.rooms?.[room]?.[field] ?? 0;
}

/** 一只 carrier：身处 `at` 房、home=HOME、remoteTarget=TARGET，背包 used/capacity。 */
function makeCarrier(
  at: string,
  used: number,
  capacity: number,
  mode: string,
  storage?: unknown,
): any {
  const creep = mockCreep({
    name: `carrier-${HOME}-0-1-abcd`,
    role: "carrier",
    mode,
    home: HOME,
    used,
    capacity,
  });
  creep.memory.remoteTarget = TARGET;
  creep.room = {
    name: at,
    storage,
    find: vi.fn(() => []),
    findExitTo: vi.fn(() => 3),
    lookForAt: vi.fn(() => []),
  };
  return creep;
}

function runRole(creep: any): void {
  carrierRole.run(creep, mockContext(mockSnapshot({ roomName: creep.room.name })));
}

describe("carrier — 跨房输送在卸能那一拍两侧成对入账（#42 下半场 / #59）", () => {
  it("在 home 取能成功 → 两侧都不入账（storage→carry 是房内搬运）", () => {
    const storage = mockStructure("storage", { energy: 5000, capacity: 20000 });
    const creep = makeCarrier(HOME, 0, 1200, "acquire", storage);
    runRole(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(storage, RESOURCE_ENERGY, 1200);
    // 这条钉住"别把满载在途当发出"：旧口径若在此记 exported，本断言必红。
    expect(booked(HOME, "exported")).toBe(0);
    expect(booked(HOME, "imported")).toBe(0);
    expect(booked(TARGET, "imported")).toBe(0);
  });

  it("在 target 卸能 → 收房 imported + 发房 exported 同额成对", () => {
    const storage = mockStructure("storage", { energy: 1000, capacity: 10000 });
    const creep = makeCarrier(TARGET, 1200, 1200, "work", storage);
    runRole(creep);

    // free = 10000 − 1000 = 9000，carryUsed = 1200 ⇒ 1200
    expect(creep.transfer).toHaveBeenCalledWith(storage, RESOURCE_ENERGY, 1200);
    expect(booked(TARGET, "imported")).toBe(1200);
    expect(booked(HOME, "exported")).toBe(1200);
    // 关键反向断言：若按 creep.memory.home 记 imported（旧写法），这条会变红。
    expect(booked(HOME, "imported")).toBe(0);
    expect(booked(TARGET, "exported")).toBe(0);
  });

  it("卸能没到位（ERR_NOT_IN_RANGE）→ 零入账，不把没落地的搬运算成收入/发出", () => {
    const storage = mockStructure("storage", { energy: 1000, capacity: 10000 });
    const creep = makeCarrier(TARGET, 1200, 1200, "work", storage);
    creep.transfer = vi.fn(() => ERR_NOT_IN_RANGE);
    runRole(creep);

    expect(booked(TARGET, "imported")).toBe(0);
    expect(booked(HOME, "exported")).toBe(0);
  });

  it("收房 storage 已满 → 候选不成立，零入账（满载就等在原地）", () => {
    const storage = mockStructure("storage", { energy: 10000, capacity: 10000 });
    const creep = makeCarrier(TARGET, 1200, 1200, "work", storage);
    runRole(creep);

    expect(creep.transfer).not.toHaveBeenCalled();
    expect(booked(TARGET, "imported")).toBe(0);
    expect(booked(HOME, "exported")).toBe(0);
  });
});
