/**
 * #93 — `controller.progressTotal` 必须与 progress 同处落盘。
 *
 * 立案依据（线上实测 2026-10-03，W38S56 RCL4）：`room-state` 原先只存 `controllerProgressSeen`
 * 与 `controllerProgressChangedAt`，于是现场**只能报速率、报不出「还有多久」**：同一份读数下
 * 两个会话算出的 RCL5 ETA 差出 ~2,000 拍，分歧全部来自那个读不到的分母
 * （`controller.progressTotal` 从不落盘；`economy.ts` 里那个 `progressTotal` 是**工地**的）。
 *
 * 这几条用例锁的是**口径**而不是实现细节：
 *   ① 分母只在「进度那一拍」刷新 ⇒ 零额外读盘成本；
 *   ② 进度不动时**不得**刷新（反向实验：若哪天有人把它挪到分支外面，本条会红）；
 *   ③ 无 controller / 无 progressTotal 时**不得**写出 NaN —— NaN 落进 Memory 会把余量算成 NaN 并一路传染。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { roomStateSystem } from "../../../src/systems/room/room-state";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { mockRoomStateCtx } from "../../support/factories";

function makeSnapshot(
  progress: number | undefined,
  progressTotal: number | undefined,
): RoomSnapshot {
  const controller =
    progress === undefined
      ? undefined
      : ({
          my: true,
          level: 4,
          ticksToDowngrade: 20000,
          progress,
          progressTotal,
        } as unknown as StructureController);
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
    controller,
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
    rcl: 4,
  } as unknown as RoomSnapshot;
}

function run(snapshot: RoomSnapshot, tick: number): void {
  roomStateSystem.run(mockRoomStateCtx([snapshot], tick));
}

describe("#93 controller.progressTotal 与 progress 同处落盘", () => {
  let savedMemory: typeof Memory | undefined;

  beforeEach(() => {
    savedMemory = (globalThis as Record<string, unknown>).Memory as typeof Memory | undefined;
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {
        W1N1: {
          phase: {
            phase: "growth",
            reserve: 1000,
            drainScore: 0,
            liquidityScore: 0,
            bandTicks: 0,
          },
        },
      },
    } as unknown as typeof Memory;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Memory = savedMemory;
  });

  const mem = () => (Memory.rooms.W1N1 ?? {}) as Record<string, number | undefined>;

  it("进度变化的那一拍：分母写进来，且等于 snapshot 的 progressTotal", () => {
    run(makeSnapshot(1000, 405000), 100);
    expect(mem().controllerProgressSeen).toBe(1000);
    expect(mem().controllerProgressTotalSeen).toBe(405000);
  });

  it("余量因此可直接算出（这正是要买的量）", () => {
    run(makeSnapshot(375591, 405000), 100);
    const remaining = mem().controllerProgressTotalSeen! - mem().controllerProgressSeen!;
    expect(remaining).toBe(29409);
  });

  it("反向实验：进度不动 ⇒ 分母不刷新（写必须在变化分支内）", () => {
    run(makeSnapshot(1000, 405000), 100);
    run(makeSnapshot(1000, 999999), 101); // 同一 progress ⇒ 不该再写
    expect(mem().controllerProgressTotalSeen).toBe(405000);
    expect(mem().controllerProgressChangedAt).toBe(100);
  });

  it("进度继续爬 ⇒ 分母跟着新一拍的值走", () => {
    run(makeSnapshot(1000, 405000), 100);
    run(makeSnapshot(1008, 405000), 101);
    expect(mem().controllerProgressTotalSeen).toBe(405000);
    expect(mem().controllerProgressChangedAt).toBe(101);
  });

  it("无 controller 时不写键、不写 NaN（旧值若存在则保留）", () => {
    run(makeSnapshot(1000, 405000), 100);
    run(makeSnapshot(undefined, undefined), 101); // controller undefined
    expect(mem().controllerProgressTotalSeen).toBe(405000);
    expect(Number.isFinite(mem().controllerProgressTotalSeen!)).toBe(true);
  });

  it("progressTotal 缺失（私服形状）时退回旧值而非 undefined/NaN", () => {
    run(makeSnapshot(1000, 405000), 100);
    run(makeSnapshot(1008, undefined), 101); // 进度在动，但引擎没给分母
    expect(mem().controllerProgressTotalSeen).toBe(405000);
    expect(Number.isNaN(mem().controllerProgressTotalSeen!)).toBe(false);
  });

  it("全新房间首拍即有分母（不要求先有一次变化）", () => {
    run(makeSnapshot(0, 100), 100);
    expect(mem().controllerProgressTotalSeen).toBe(100);
  });
});
