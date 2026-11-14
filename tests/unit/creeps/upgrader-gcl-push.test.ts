/** RCL8 冲 GCL 容量比例富线（gclPushStartRatio）— 奢侈品消费让位储备。 */
import { describe, expect, it } from "vitest";
import { rcl8GclPushAllowed } from "../../../src/creeps/roles/upgrader";
import { gclPushCapacity } from "../../../src/domain/economy/links";
import { CONFIG } from "../../../src/config";

const START = Math.round(gclPushCapacity() * CONFIG.economy.upgrade.gclPushStartRatio);

describe("rcl8GclPushAllowed — RCL8 GCL 容量比例富线", () => {
  it("storage < 50% 容量 → 不冲（旧 50K 刻度只有容量 2%，20 倍差）", () => {
    expect(rcl8GclPushAllowed(START - 1, false, false)).toBe(false);
    expect(rcl8GclPushAllowed(50000, false, false)).toBe(false);
  });

  it("storage ≥ 50% 容量 → 开冲", () => {
    expect(rcl8GclPushAllowed(START, false, false)).toBe(true);
    expect(rcl8GclPushAllowed(gclPushCapacity(), false, false)).toBe(true);
  });

  it("降级风险豁免（保级优先于储备）", () => {
    expect(rcl8GclPushAllowed(0, true, false)).toBe(true);
  });

  it("背包已载能豁免（烧完再停，防抱能死亡掉落）", () => {
    expect(rcl8GclPushAllowed(0, false, true)).toBe(true);
  });
});
