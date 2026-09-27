/** computeControllerLinkTarget — 需求驱动的 controller link 供能水位。 */
import { describe, expect, it } from "vitest";
import { computeControllerLinkTarget } from "../../../src/systems/room/link-system";
import { CONFIG } from "../../../src/config";

const ctrl = (ttd: number) => ({ my: true, ticksToDowngrade: ttd }) as any;

describe("computeControllerLinkTarget — 需求驱动供能水位", () => {
  it("RCL8 满级无风险 → 停供（0）", () => {
    expect(computeControllerLinkTarget(8, ctrl(20000), 60000, 800, false)).toBe(0);
  });

  it("RCL8 + 降级风险 → 保级水位 maintainTarget", () => {
    expect(computeControllerLinkTarget(8, ctrl(5000), 60000, 800, true)).toBe(
      CONFIG.economy.link.maintainTarget,
    );
  });

  /**
   * 立案依据（线上实测 2026-09-27 W37S58）：本函数原先自己拿 ttd<10000 判风险，
   * 而 room-state 的标志是「10000 进 / 15000 出」的迟滞带 —— 两根钟让带内（10k~15k）出现
   * "upgrader 在保级、link 却按无风险停供"的错位。现在风险是**入参**，ttd 数值本身不再决定结果。
   */
  it("带内 ttd=12000：风险入参说了算（标志置位即供能，清零即停供）", () => {
    expect(computeControllerLinkTarget(8, ctrl(12000), 60000, 800, true)).toBe(
      CONFIG.economy.link.maintainTarget,
    );
    expect(computeControllerLinkTarget(8, ctrl(12000), 60000, 800, false)).toBe(0);
  });

  it("RCL7 + storage ≥ sustained(10k) → 满功率供能", () => {
    expect(computeControllerLinkTarget(7, ctrl(20000), 20000, 800, false)).toBe(800);
  });

  it("RCL7 + 低水位（6k）→ 半供 40%", () => {
    expect(computeControllerLinkTarget(7, ctrl(20000), 6000, 800, false)).toBe(320);
  });

  it("RCL7 + 枯竭（2k）→ 保级 20%", () => {
    expect(computeControllerLinkTarget(7, ctrl(20000), 2000, 800, false)).toBe(160);
  });

  it("无 controller / 非我方 → 0", () => {
    expect(computeControllerLinkTarget(7, undefined, 20000, 800, false)).toBe(0);
    expect(
      computeControllerLinkTarget(
        7,
        { my: false, ticksToDowngrade: 20000 } as any,
        20000,
        800,
        true,
      ),
    ).toBe(0);
  });
});
