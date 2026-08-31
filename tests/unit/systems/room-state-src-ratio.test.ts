import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { roomStateSystem } from "../../../src/systems/room-state";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { mockCapacityStore, mockRoomStateCtx } from "../../support/factories";

/**
 * P0-1 room-state srcRatio + storageDrainRate 信号采集 — 单元测试。

 * 覆盖病灶 1 中 room-state 层的信号采集逻辑：
 *   - srcRatio：取最满 source 的填充率（source.energy / energyCapacity）
 *   - storageDrainRate：跨 tick 计算（current - prev，负值=流失）
 *   - storageEnergyPrev：持久化供下一 tick 使用

 * 设计取舍：无 storage 时 srcRatio 通道永不触发（storageDrainRate=0），
 * 因 storageDrainThreshold=-2，0 < -2 不成立。
 */

const makeStore = (energy: number) => mockCapacityStore(energy, 1000000);

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomName: "W1N1",
    spawns: [],
    extensions: [],
    containers: [],
    storage: undefined,
    terminal: undefined,
    towers: [],
    labs: [],
    extractor: undefined,
    factory: undefined,
    sources: [{ id: "src1" } as Source],
    controller: { my: true, level: 6, ticksToDowngrade: 10000 } as unknown as StructureController,
    mineral: undefined,
    minerals: [],
    constructionSites: [],
    myConstructionSites: [],
    hostileCreeps: [],
    threatCreeps: [],
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    fillTargets: [],
    needsRecovery: false,
    sourceOccupancy: new Map([["src1", 1]]),
    pendingHarvesters: 0,
    creepEnergy: 0,
    droppedEnergy: [],
    rcl: 6,
    ...overrides,
  } as unknown as RoomSnapshot;
}

// makeCtx 已归并到 factories.mockRoomStateCtx（T4 批②）。

describe("room-state — P0-1 srcRatio + storageDrainRate 信号采集", () => {
  let savedMemory: typeof Memory | undefined;

  beforeEach(() => {
    savedMemory = (globalThis as Record<string, unknown>).Memory as typeof Memory | undefined;
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {
        W1N1: {
          phase: { phase: "growth", reserve: 1000, drainScore: 0, liquidityScore: 0, bandTicks: 0 },
        },
      },
    };
  });

  afterEach(() => {
    if (savedMemory !== undefined) {
      (globalThis as Record<string, unknown>).Memory = savedMemory;
    } else {
      delete (globalThis as Record<string, unknown>).Memory;
    }
  });

  function getRoomMem() {
    return ((globalThis as Record<string, unknown>).Memory as typeof Memory).rooms["W1N1"]!;
  }

  it("多 source 取最满的填充率作为 srcRatio（不误触发 crisis）", () => {
    // 两个 source：2500/3000 + 2900/3000 → srcRatio=2900/3000≈0.967（>0.9）
    // 但 storageDrainRate=0（无 storage）→ srcRatio 通道不触发，phase 保持 growth
    const snap = makeSnapshot({
      sources: [
        { id: "s1", energy: 2500, energyCapacity: 3000 } as Source,
        { id: "s2", energy: 2900, energyCapacity: 3000 } as Source,
      ],
    });
    roomStateSystem.run(mockRoomStateCtx([snap]));
    expect(getRoomMem().phase!.phase).not.toBe("crisis");
  });

  it("source.energyCapacity 缺失时回退默认 3000（防除零/NaN）", () => {
    // energy 缺失字段也按 0 处理，energyCapacity 缺失按 3000 → srcRatio=0/3000=0
    const snap = makeSnapshot({
      sources: [{ id: "s1", energy: 2900 } as Source],
    });
    expect(() => roomStateSystem.run(mockRoomStateCtx([snap]))).not.toThrow();
  });

  it("storage 净流出率跨 tick 计算正确（storageEnergyPrev 持久化更新）", () => {
    // 上一 tick storage=10000，本 tick storage=9000 → 流失 1000 E
    // drainRate = 9000 - 10000 = -1000（负值=流失，符合 PhaseInput 语义）
    const roomMem = Memory.rooms.W1N1!;
    roomMem.phase = {
      phase: "growth",
      reserve: 10000,
      reserveDelta: 0,
      drainScore: 0,
      liquidityScore: 0,
      storageEnergyPrev: 10000,
      harvesterCount: 1,
      sourceCount: 1,
      rcl: 6,
    };
    const snap = makeSnapshot({
      storage: { store: makeStore(9000) } as unknown as StructureStorage,
    });
    roomStateSystem.run(mockRoomStateCtx([snap]));
    // 验证 storageEnergyPrev 更新为本 tick 的 9000（供下一 tick 计算）
    expect(getRoomMem().phase!.storageEnergyPrev).toBe(9000);
  });
});
