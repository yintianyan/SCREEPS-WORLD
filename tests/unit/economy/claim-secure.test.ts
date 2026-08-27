/** claim-secure 护栏纯函数测试。 */
import { describe, expect, it } from "vitest";
import { isClaimSecure, computeClaimSecure } from "../../../src/domain/economy/phase";

describe("isClaimSecure（瞬时谓词）", () => {
  it("RCL>=4 永不为 true（成熟房有 storage 缓冲，降级由 emergency 豁免处理）", () => {
    expect(isClaimSecure(4, 0)).toBe(false);
    expect(isClaimSecure(7, 100)).toBe(false);
    expect(isClaimSecure(8, 19999)).toBe(false);
  });

  it("RCL<4 且 ttd 缺失 → false（无 controller 或数据缺失，保守不触发）", () => {
    expect(isClaimSecure(3, undefined)).toBe(false);
    expect(isClaimSecure(1, undefined)).toBe(false);
  });

  it("RCL<4 且 ttd 恰好等于进入阈值 → false（门槛为严格小于）", () => {
    expect(isClaimSecure(3, 15000)).toBe(false);
  });

  it("RCL<4 且 ttd 低于进入阈值 → true", () => {
    expect(isClaimSecure(3, 14999)).toBe(true);
    expect(isClaimSecure(2, 0)).toBe(true);
    expect(isClaimSecure(1, 2000)).toBe(true);
  });
});

describe("computeClaimSecure（带迟滞状态记忆）", () => {
  it("RCL>=4 永不为 true（忽略 prev / ttd）", () => {
    expect(computeClaimSecure(4, 0, false)).toBe(false);
    expect(computeClaimSecure(8, 19999, true)).toBe(false);
  });

  it("ttd 缺失 → false（无论 prev）", () => {
    expect(computeClaimSecure(3, undefined, false)).toBe(false);
    expect(computeClaimSecure(3, undefined, true)).toBe(false);
  });

  it("prev=false：低于进入阈值才初次进入", () => {
    expect(computeClaimSecure(3, 15000, false)).toBe(false); // 等于阈值不进入
    expect(computeClaimSecure(3, 14999, false)).toBe(true);
  });

  it("prev=true：需回升到退出阈值以上才解除（双门槛防振荡）", () => {
    // 仍在退出阈值以下 → 维持 claim-secure（迟滞保持）
    expect(computeClaimSecure(3, 19999, true)).toBe(true);
    expect(computeClaimSecure(3, 15001, true)).toBe(true);
    // 回升到退出阈值（=最大重置 ttd）→ 解除
    expect(computeClaimSecure(3, 20000, true)).toBe(false);
  });

  it("迟滞自洽：进入后立刻回升到阈值之间仍维持，直到 >= 退出阈值", () => {
    // 先进入（ttd=14999 < 15000）
    expect(computeClaimSecure(3, 14999, false)).toBe(true);
    // 回升到 18000（< 20000 退出阈值）→ 维持
    expect(computeClaimSecure(3, 18000, true)).toBe(true);
    // 回升到 20000（>= 退出阈值）→ 解除
    expect(computeClaimSecure(3, 20000, true)).toBe(false);
    // 解除后再掉到 14999 → 重新进入
    expect(computeClaimSecure(3, 14999, false)).toBe(true);
  });
});
