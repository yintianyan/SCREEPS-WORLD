/** R688：扩张推进房 CPU 升级闸 — 满仓强制放行。 */
import { describe, expect, it } from "vitest";
import { cpuGateAllowsUpgrade } from "../../../src/creeps/roles/upgrader";

describe("cpuGateAllowsUpgrade", () => {
  it("满仓时任何 tier 都放行（盈余必须被消化）", () => {
    expect(cpuGateAllowsUpgrade("constrained", true)).toBe(true);
    expect(cpuGateAllowsUpgrade("tight", true)).toBe(true);
    expect(cpuGateAllowsUpgrade("comfortable", true)).toBe(true);
    expect(cpuGateAllowsUpgrade(undefined, true)).toBe(true);
  });

  it("未满仓时 tight/constrained 仍停（R632 原语义）", () => {
    expect(cpuGateAllowsUpgrade("tight", false)).toBe(false);
    expect(cpuGateAllowsUpgrade("constrained", false)).toBe(false);
  });

  it("未满仓时 comfortable/abundant/未知都放行", () => {
    expect(cpuGateAllowsUpgrade("comfortable", false)).toBe(true);
    expect(cpuGateAllowsUpgrade("abundant", false)).toBe(true);
    expect(cpuGateAllowsUpgrade(undefined, false)).toBe(true);
  });
});
