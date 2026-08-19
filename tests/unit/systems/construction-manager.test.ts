/**
 * construction-manager 单元测试 — claim-secure 护栏。
 *
 * 覆盖：
 *   - developmentGate：脆弱新房（claimSecure）抑制非紧急 site 创建，但紧急重建豁免。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { developmentGate } from "../../../src/systems/construction-manager";
import { mockContext, mockSnapshot, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).Memory.rooms.W7N4.claimSecure = false;
});

describe("developmentGate — claim-secure 抑制非紧急建造", () => {
  it("claimSecure=false 且默认健康态 → 允许建造", () => {
    const snap = mockSnapshot();
    const ctx = mockContext(snap);
    expect(developmentGate(snap, ctx, { any: false } as any)).toBe(true);
  });

  it("claimSecure=true（非紧急）→ 抑制，返回 false", () => {
    (globalThis as any).Memory.rooms.W7N4.claimSecure = true;
    const snap = mockSnapshot();
    const ctx = mockContext(snap);
    expect(developmentGate(snap, ctx, { any: false } as any)).toBe(false);
  });

  it("claimSecure=true 但 emergency 重建 → 豁免，仍允许（关键基建可建）", () => {
    (globalThis as any).Memory.rooms.W7N4.claimSecure = true;
    const snap = mockSnapshot();
    const ctx = mockContext(snap);
    // emergency.any=true 走 emergency 路径，不受 claimSecure 门禁阻挡。
    expect(developmentGate(snap, ctx, { any: true } as any)).toBe(true);
  });

  it("有威胁 creep 时无论 claimSecure 都禁止建造（敌人脚下不建工地）", () => {
    (globalThis as any).Memory.rooms.W7N4.claimSecure = true;
    const hostile = { id: "h1", owner: { username: "enemy" } };
    const snap = mockSnapshot({ threatCreeps: [hostile as any] });
    const ctx = mockContext(snap);
    expect(developmentGate(snap, ctx, { any: false } as any)).toBe(false);
  });
});
