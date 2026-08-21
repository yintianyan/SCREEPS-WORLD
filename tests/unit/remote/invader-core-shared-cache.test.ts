/**
 * InvaderCore 共享探测缓存回归测试（键冲突修复）。
 *
 * 背景：reserver 与 core-clearer 曾各自以同名键 __remoteInvaderCore 写不同形状
 * （{tick,blocked} vs {tick,list}）。同 tick 同房共存时执行序随 kernel 的 TTL
 * 升序排序波动，两种交错方向各有一种失败模式：
 *   - clearer 先写 {list} → reserver 读 .blocked = undefined（falsy）→ 恒判无核心空耗；
 *   - reserver 先写 {blocked} → clearer 读 .list = undefined → TypeError 进冷却螺旋。
 * 修复：单一写者 support/invader-core，形状 {tick,cores}。本文件锁定双消费方在
 * 任意调用顺序下的正确性、同 tick 缓存命中与跨 tick 失效行为。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findInvaderCores, roomHasInvaderCore } from "../../../src/creeps/support/invader-core";
import { resetGlobals } from "../../role-helpers";

function makeCoreRoom(name: string, coreCount = 1): { name: string; find: ReturnType<typeof vi.fn> } {
  const find = vi.fn((type: number) => {
    if (type === FIND_HOSTILE_STRUCTURES) {
      return Array.from({ length: coreCount }, (_, i) => ({
        structureType: "invaderCore",
        hits: 100000,
        level: 0,
        pos: { x: 20 + i, y: 20 },
      }));
    }
    return [];
  });
  return { name, find };
}

beforeEach(() => {
  resetGlobals();
});

describe("invader-core 共享缓存 — 键冲突回归（单写者单形状）", () => {
  it("顺序 A：clearer 语义先查（数组）→ reserver 后查仍判 true", () => {
    const room = makeCoreRoom("W2N1") as unknown as Room;
    expect(findInvaderCores(room)).toHaveLength(1);
    expect(roomHasInvaderCore(room)).toBe(true);
  });

  it("顺序 B：reserver 语义先查（布尔）→ clearer 后查仍拿到核心", () => {
    const room = makeCoreRoom("W2N1") as unknown as Room;
    expect(roomHasInvaderCore(room)).toBe(true);
    expect(findInvaderCores(room)).toHaveLength(1);
  });

  it("无核心房：两种语义一致为 false / 空数组", () => {
    const room = makeCoreRoom("W2N1", 0) as unknown as Room;
    expect(roomHasInvaderCore(room)).toBe(false);
    expect(findInvaderCores(room)).toHaveLength(0);
  });

  it("同 tick 多次调用只触发一次 room.find（缓存命中）", () => {
    const room = makeCoreRoom("W2N1") as unknown as Room;
    roomHasInvaderCore(room);
    roomHasInvaderCore(room);
    findInvaderCores(room);
    expect(room.find).toHaveBeenCalledTimes(1);
  });

  it("跨 tick 失效重算", () => {
    const room = makeCoreRoom("W2N1") as unknown as Room;
    roomHasInvaderCore(room);
    (globalThis as { Game: { time: number } }).Game.time = 1001;
    findInvaderCores(room);
    expect(room.find).toHaveBeenCalledTimes(2);
  });

  it("返回的是真实核心结构（非 undefined 派生值）— falsy 回归锁定", () => {
    const room = makeCoreRoom("W2N1", 2) as unknown as Room;
    // 先走 boolean 路径再取结构：旧实现此处会因形状不符拿到 undefined.list 抛错
    expect(roomHasInvaderCore(room)).toBe(true);
    const cores = findInvaderCores(room);
    expect(cores).toHaveLength(2);
    expect(cores[0]?.structureType).toBe("invaderCore");
  });
});
