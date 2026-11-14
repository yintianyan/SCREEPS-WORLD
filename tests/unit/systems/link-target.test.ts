/** computeControllerLinkTarget — 需求驱动的 controller link 供能水位。 */
import { afterEach, describe, expect, it } from "vitest";
import { computeControllerLinkTarget } from "../../../src/systems/room/link-system";
import { CONFIG } from "../../../src/config";

const ctrl = (ttd: number) => ({ my: true, ticksToDowngrade: ttd }) as any;

const ORIGINAL_GCL = CONFIG.economy.upgrade.gclUpgrade;

/** CONFIG 为 readonly 声明，测试需临时覆盖开关（用断言绕开只读修饰）。 */
function setGclUpgrade(enabled: boolean): void {
  (CONFIG.economy.upgrade as unknown as { gclUpgrade: boolean }).gclUpgrade = enabled;
}

afterEach(() => {
  setGclUpgrade(ORIGINAL_GCL);
});

describe("computeControllerLinkTarget — RCL8 GCL 升级模式", () => {
  it("GCL 开启 + storage ≥ gclPushStart(50% 容量 = 500K) → 满功率供能（累计 GCL）", () => {
    setGclUpgrade(true);
    expect(computeControllerLinkTarget(8, ctrl(20000), 600000, 800, false)).toBe(800);
  });

  it("GCL 开启 + 富线以下(300K-500K) → 半供涓流（保级量级）", () => {
    setGclUpgrade(true);
    expect(computeControllerLinkTarget(8, ctrl(20000), 400000, 800, false)).toBe(320);
  });

  it("GCL 开启 + 停冲线以下(300K 以下) → 保级最低水位", () => {
    setGclUpgrade(true);
    expect(computeControllerLinkTarget(8, ctrl(20000), 100000, 800, false)).toBe(
      Math.round(800 * CONFIG.economy.link.maintainRatio),
    );
  });

  it("GCL 开启 + 降级风险 → 保级水位豁免（旧绝对刻度不再适用）", () => {
    setGclUpgrade(true);
    expect(computeControllerLinkTarget(8, ctrl(20000), 100000, 800, true)).toBe(
      Math.max(
        Math.round(800 * CONFIG.economy.link.maintainRatio),
        CONFIG.economy.link.maintainTarget,
      ),
    );
  });

  it("GCL 开启 + 枯竭(2k) → 保级 20%", () => {
    setGclUpgrade(true);
    expect(computeControllerLinkTarget(8, ctrl(20000), 2000, 800, false)).toBe(160);
  });

  it("GCL 开启 + 降级风险 → 不低于 maintainTarget", () => {
    setGclUpgrade(true);
    expect(computeControllerLinkTarget(8, ctrl(5000), 2000, 800, true)).toBe(
      Math.max(
        Math.round(800 * CONFIG.economy.link.maintainRatio),
        CONFIG.economy.link.maintainTarget,
      ),
    );
  });

  it("GCL 关闭 + 无风险 → 停供（0，旧行为）", () => {
    setGclUpgrade(false);
    expect(computeControllerLinkTarget(8, ctrl(20000), 60000, 800, false)).toBe(0);
  });

  it("GCL 关闭 + 降级风险 → 保级水位 maintainTarget（旧行为）", () => {
    setGclUpgrade(false);
    expect(computeControllerLinkTarget(8, ctrl(5000), 60000, 800, true)).toBe(
      CONFIG.economy.link.maintainTarget,
    );
  });

  it("GCL 关闭 + 带内 ttd=12000：风险入参说了算", () => {
    setGclUpgrade(false);
    expect(computeControllerLinkTarget(8, ctrl(12000), 60000, 800, true)).toBe(
      CONFIG.economy.link.maintainTarget,
    );
    expect(computeControllerLinkTarget(8, ctrl(12000), 60000, 800, false)).toBe(0);
  });
});

describe("computeControllerLinkTarget — RCL<8 与边界", () => {
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
