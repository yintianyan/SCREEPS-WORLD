/**
 * computeControllerLinkTarget — 需求驱动的 controller link 供能水位。
 *
 * 背景（W7N4 存不下能量主因）：旧实现 controller link 永远被 source 优先喂满，
 * RCL8 满级后升级零收益仍 15/tick 白烧。目标水位让 controller 变成受控消费者：
 * 满级停供、降级风险保级、RCL<8 按 storage 水位分级。
 */
import { describe, expect, it } from "vitest";
import { computeControllerLinkTarget } from "../../../src/systems/link-system";
import { CONFIG } from "../../../src/config";

const ctrl = (ttd: number) => ({ my: true, ticksToDowngrade: ttd }) as any;

describe("computeControllerLinkTarget — 需求驱动供能水位", () => {
  it("RCL8 满级无风险 → 停供（0）", () => {
    expect(computeControllerLinkTarget(8, ctrl(20000), 60000, 800)).toBe(0);
  });

  it("RCL8 + 降级风险 → 保级水位 maintainTarget", () => {
    expect(computeControllerLinkTarget(8, ctrl(5000), 60000, 800))
      .toBe(CONFIG.economy.link.maintainTarget);
  });

  it("RCL7 + storage ≥ sustained(10k) → 满功率供能", () => {
    expect(computeControllerLinkTarget(7, ctrl(20000), 20000, 800)).toBe(800);
  });

  it("RCL7 + 低水位（6k）→ 半供 40%", () => {
    expect(computeControllerLinkTarget(7, ctrl(20000), 6000, 800)).toBe(320);
  });

  it("RCL7 + 枯竭（2k）→ 保级 20%", () => {
    expect(computeControllerLinkTarget(7, ctrl(20000), 2000, 800)).toBe(160);
  });

  it("无 controller / 非我方 → 0", () => {
    expect(computeControllerLinkTarget(7, undefined, 20000, 800)).toBe(0);
    expect(computeControllerLinkTarget(7, { my: false, ticksToDowngrade: 20000 } as any, 20000, 800)).toBe(0);
  });
});
