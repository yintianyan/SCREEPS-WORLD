/**
 * Safe mode 出口账本（#119）——「最后防线该响没响」必须可归因，而不是事后猜。
 *
 * 立案理由（线上，CAPABILITY-MATRIX §21）：`tryActivateSafeMode()` 原先丢弃
 * `activateSafeMode()` 的返回码，且四条前置不齐时静默跳过 ⇒ "核心被拆而什么都没发生"
 * 这一现象有三种互相矛盾的解释（没次数／在冷却／引擎拒绝），三种要的动作不同。
 * 本文件不测算术，测**接线**：每一列都由一条真实分支写出，且**触发判据一个都没动**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tryActivateSafeMode } from "../../../src/systems/military/tower-defense";
import { safeModeCounters } from "../../../src/kernel/global-cache";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

/** 只造这道判据真正读的那几个字段（口径与 `RoomSnapshot.controller` 一致）。 */
function snap(opts: {
  my?: boolean;
  safeMode?: number | undefined;
  cooldown?: number | undefined;
  available?: number;
  code?: number;
  noController?: boolean;
}): any {
  const activateSafeMode = vi.fn(() => opts.code ?? OK);
  return {
    snapshot: {
      roomName: "W37S58",
      controller: opts.noController
        ? undefined
        : {
            my: opts.my ?? true,
            safeMode: opts.safeMode,
            safeModeCooldown: opts.cooldown,
            safeModeAvailable: opts.available ?? 1,
            activateSafeMode,
          },
    },
    activateSafeMode,
  };
}

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
  g().safeModeLedger = undefined; // heap 账本跨用例必须清，否则计数串味
});

describe("safeModeCounters — tower-defense 的每条分支都有写者", () => {
  it("建行处的零值把每列都摆出来（体检脚本据此分清「从未执行」与「读到 0」）", () => {
    expect(safeModeCounters("W37S58")).toEqual({ tried: 0, guardMiss: 0, codes: {} });
  });

  it("四前置齐 + 引擎 OK → tried++，codes 不记（OK 不是失败，不进直方图）", () => {
    const { snapshot, activateSafeMode } = snap({});
    tryActivateSafeMode(snapshot);
    expect(activateSafeMode).toHaveBeenCalledTimes(1);
    const c = safeModeCounters("W37S58");
    expect(c.tried).toBe(1);
    expect(c.guardMiss).toBe(0);
    expect(c.codes).toEqual({});
  });

  it("引擎回 ERR_RCL_NOT_ENOUGH(-15) → 按原始码建直方图，tried 仍计（证明码没被吞）", () => {
    tryActivateSafeMode(snap({ code: -15 }).snapshot);
    const c = safeModeCounters("W37S58");
    expect(c.tried).toBe(1);
    expect(c.codes["-15"]).toBe(1);
    expect(c.guardMiss).toBe(0);
  });

  it("在冷却（safeModeCooldown 在场）→ guardMiss++、不发调用（三种解释里的一种，可分了）", () => {
    const { snapshot, activateSafeMode } = snap({ cooldown: 1200 });
    tryActivateSafeMode(snapshot);
    expect(activateSafeMode).not.toHaveBeenCalled();
    const c = safeModeCounters("W37S58");
    expect(c.guardMiss).toBe(1);
    expect(c.tried).toBe(0);
  });

  it("没次数（safeModeAvailable=0）→ 同样 guardMiss++（与冷却同列，两列合起来才判「该响没响」）", () => {
    tryActivateSafeMode(snap({ available: 0 }).snapshot);
    const c = safeModeCounters("W37S58");
    expect(c.guardMiss).toBe(1);
    expect(c.tried).toBe(0);
    expect(c.codes).toEqual({});
  });

  it("controller 缺失 → guardMiss++ 且不抛（这道判据一直容 null，记数不能改变它）", () => {
    expect(() => tryActivateSafeMode(snap({ noController: true }).snapshot)).not.toThrow();
    expect(safeModeCounters("W37S58").guardMiss).toBe(1);
  });

  it("账本按房分桶 —— 两口自有房不能记在同一行上", () => {
    tryActivateSafeMode({ roomName: "W37S58", controller: undefined } as any);
    tryActivateSafeMode({ roomName: "W38S56", controller: undefined } as any);
    expect(safeModeCounters("W37S58").guardMiss).toBe(1);
    expect(safeModeCounters("W38S56").guardMiss).toBe(1);
    expect(Object.keys(g().safeModeLedger).sort()).toEqual(["W37S58", "W38S56"]);
  });
});
