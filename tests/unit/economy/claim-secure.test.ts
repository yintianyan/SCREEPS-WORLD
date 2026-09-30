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

/**
 * RCL2 的降级缓冲上限只有 10000（引擎 CONTROLLER_DOWNGRADE，2026-09-30 线上与
 * @screeps/driver 双向核对：{1:20000, 2:10000, 3:20000, …}）—— 比 RCL1/RCL3 还低。
 * 用固定的 15000/20000 当阈值时，退出线在 RCL2 **按构造不可达**：
 * 线上 W38S56 实测 `ttd=10000`（满缓冲、3 只 upgrader 在跑）却 `claimSecure=true` 恒真，
 * developmentGate 于是对该房每条 road 永久返回 "claim-secure"（buildQueue 7 条全 attempts=0）。
 * 传 levelCapTicks 之后：进入 7500 / 退出 10000，护栏回到「真的临近降级才拉闸」的语义。
 */
describe("computeClaimSecure / isClaimSecure — RCL2（本级 cap=10000）折带后可自愈", () => {
  const CAP2 = 10000;

  it("满缓冲（ttd == 本级上限）→ 不判风险（这条在改前恒真，就是线上那个假阳性）", () => {
    expect(computeClaimSecure(2, CAP2, true, CAP2)).toBe(false);
    expect(isClaimSecure(2, CAP2, CAP2)).toBe(false);
  });

  it("迟滞：进入线 7500，带内维持、带外触发", () => {
    expect(computeClaimSecure(2, 7500, false, CAP2)).toBe(false); // 等于进入线不进入
    expect(computeClaimSecure(2, 7499, false, CAP2)).toBe(true); // 跌破进入线
    expect(computeClaimSecure(2, 9000, true, CAP2)).toBe(true); // 回升但 < 退出线 → 维持
    expect(computeClaimSecure(2, 10000, true, CAP2)).toBe(false); // 回到满值 → 解除
  });

  it("不传 cap（等级未知 / 常量未注入）→ 退回旧阈值对，绝不放宽护栏", () => {
    expect(computeClaimSecure(2, 10000, true)).toBe(true);
    expect(isClaimSecure(2, 0)).toBe(true);
  });

  it("RCL1/RCL3（cap 20000 ≥ 退出线）→ 折带不动，逐字沿用旧行为", () => {
    expect(computeClaimSecure(3, 19999, true, 20000)).toBe(true);
    expect(computeClaimSecure(3, 20000, true, 20000)).toBe(false);
    expect(computeClaimSecure(1, 14999, false, 20000)).toBe(true);
  });
});
