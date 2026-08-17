/**
 * registerStaticBlocker 站桩占位自报测试（v33-R11）。
 *
 * 语义：外房无 RoomSnapshot 预载，静止角色在岗时自报占位，寻路矩阵
 * （applyStaticBlockers）据此把该格标 255，兄弟 creep 绕行而不是撞被占格。
 * per-tick 生命周期：与预载共用 __staticBlockersCache，同 tick 追加去重，
 * 旧 tick 条目被新自报/预载替换。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { preloadStaticBlockers, registerStaticBlocker } from "../../../src/creeps/movement";
import { resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  delete (globalThis as any).__staticBlockersCache;
});

describe("registerStaticBlocker — 站桩占位自报", () => {
  it("首个自报：创建本 tick 条目", () => {
    registerStaticBlocker("W2N1", { x: 11, y: 10 });
    const entry = (globalThis as any).__staticBlockersCache.W2N1;
    expect(entry.checkedTick).toBe((globalThis as any).Game.time);
    expect(entry.positions).toContain(11 * 50 + 10);
  });

  it("与预载合并：先预载再自报 → 追加去重", () => {
    preloadStaticBlockers("W7N4", [5]);
    registerStaticBlocker("W7N4", { x: 11, y: 10 });
    registerStaticBlocker("W7N4", { x: 11, y: 10 }); // 重复自报去重
    const entry = (globalThis as any).__staticBlockersCache.W7N4;
    expect(entry.positions).toEqual([5, 11 * 50 + 10]);
  });

  it("自报先于预载：预载覆盖自报（snapshot 预载是权威源）", () => {
    registerStaticBlocker("W7N4", { x: 11, y: 10 });
    preloadStaticBlockers("W7N4", [7]);
    const entry = (globalThis as any).__staticBlockersCache.W7N4;
    expect(entry.positions).toEqual([7]);
  });

  it("跨 tick 条目失效：旧 tick 条目被新自报替换", () => {
    registerStaticBlocker("W2N1", { x: 11, y: 10 });
    (globalThis as any).Game.time += 1;
    registerStaticBlocker("W2N1", { x: 12, y: 10 });
    const entry = (globalThis as any).__staticBlockersCache.W2N1;
    expect(entry.positions).toEqual([12 * 50 + 10]);
  });
});
