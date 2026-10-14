/**
 * Plan Stability Policy 的行为钉（#107 的"接线 or 删除"决策需要先有一张回归网）。
 *
 * 立案＝roadmap 补330／补331：`domain/operation/stability.ts` 五枚导出在 src 内**零消费者**
 * （路径／名字／符号三种形状逐个查过，`shouldRebalance` 的 6 处命中经逐处验伪＝用的是
 * rebalance.ts 的返回字段，不是这里的同名函数）。本文件不改任何行为，只把"它此刻到底判什么"
 * 钉住——包括一件反直觉的事（见最后一组）：**这条政策救不了 #181**。
 */
import { describe, expect, it } from "vitest";
import {
  getStabilityParams,
  hasMinimumCommitment,
  isInHysteresis,
  shouldCancelOperation,
  shouldRebalance,
} from "../../../src/domain/operation/stability";
import type { OperationContext } from "../../../src/domain/operation/agenda-item";
import type { NetworkSnapshot } from "../../../src/domain/operation/network-snapshot";

/** 只给被测函数真正读到的字段——多给一个键都会让"这条政策看什么"变成猜谜。 */
function op(over: Partial<OperationContext> = {}): OperationContext {
  return {
    status: "running",
    createdAt: 1000,
    deliveredAmount: 0,
    ...over,
  } as OperationContext;
}

function snap(over: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  return {
    totalSupply: 1000,
    totalRemaining: 1000,
    gap: 0,
    activeOperationCount: 2,
    ...over,
  } as NetworkSnapshot;
}

describe("stability — hysteresis 与 commitment", () => {
  it("hysteresis 是严格小于：第 199 拍仍在保护期，第 200 拍已出", () => {
    expect(isInHysteresis(op(), 1000 + 199)).toBe(true);
    expect(isInHysteresis(op(), 1000 + 200)).toBe(false);
  });

  it("commitment 两个或项各自独立成立（交付过 或 载体跑过一趟）", () => {
    expect(hasMinimumCommitment(op({ deliveredAmount: 1 }), false)).toBe(true);
    expect(hasMinimumCommitment(op({ deliveredAmount: 0 }), true)).toBe(true);
    // 前提检查：两项都缺时才是 false——否则上面两条可能只是在读同一个真值
    expect(hasMinimumCommitment(op({ deliveredAmount: 0 }), false)).toBe(false);
  });
});

describe("stability — shouldCancelOperation 的四道闸", () => {
  it("终态 op 不取消（isActive 假）", () => {
    for (const status of ["completed", "failed", "cancelled", "expired"] as const) {
      expect(shouldCancelOperation(op({ status }), 5000, true)).toBe(false);
    }
  });

  it("保护期内不取消，出保护期后取消", () => {
    expect(shouldCancelOperation(op(), 1100, false)).toBe(false);
    expect(shouldCancelOperation(op(), 1300, false)).toBe(true);
  });

  it("「已绑载体但还没承诺」＝拒绝取消；「绑过且承诺了」＝放行", () => {
    expect(shouldCancelOperation(op({ carrierName: "c-1" }), 1300, false)).toBe(false);
    expect(shouldCancelOperation(op({ carrierName: "c-1" }), 1300, true)).toBe(true);
    expect(shouldCancelOperation(op({ deliveredAmount: 50 }), 1300, false)).toBe(true);
    // 没有绑定的 op 不受 commitment 保护：这条与上一条成对照，否则"保护"读成"永不取消"
    expect(shouldCancelOperation(op(), 1300, false)).toBe(true);
  });

  it("★这条政策救不了 #181：名字解析不到活体时它依旧拒绝取消（模块里没有「悬挂」这个概念）", () => {
    // 线上形状（补328／补329）：deliveredAmount=0、所绑载体绑后 8 拍死亡、没跑成任何一趟。
    // 直觉会说"按这条政策它就不算有效绑定"——读码与这条用例共同否证：:56 只看
    // `op.carrierName` 这个字符串在不在，不看它解析得到什么，因此返回 false＝**保护**该 op
    // 不被取消。⇒ #181 需要的是一个新的"绑定是否仍指向活体"判定，
    //   把悬挂名塞进 hasMinimumCommitment 会是第二次"一名两义"。
    expect(shouldCancelOperation(op({ carrierName: "carrier-dead" }), 5000, false)).toBe(false);
  });
});

describe("stability — shouldRebalance 的阈值与冷却", () => {
  it("首拍必规划（previous 缺席）", () => {
    expect(shouldRebalance(snap(), undefined, 0, 10_000)).toBe(true);
  });

  it("冷却期内不重排，哪怕变化巨大", () => {
    expect(
      shouldRebalance(snap({ totalSupply: 100 }), snap({ totalSupply: 1000 }), 900, 1000),
    ).toBe(false);
  });

  it("阈值边界：9.9% 不触发、10% 触发（>= 才算咬到）", () => {
    // 冷却已过（tick 差 ≥200）才轮到阈值说话
    const justBelow = snap({ totalSupply: 901, totalRemaining: 1000 }); // 9.9%
    const atThreshold = snap({ totalSupply: 900, totalRemaining: 1000 }); // 10.0%
    const prev = snap({ totalSupply: 1000, totalRemaining: 1000 });
    expect(shouldRebalance(justBelow, prev, 0, 1000)).toBe(false);
    expect(shouldRebalance(atThreshold, prev, 0, 1000)).toBe(true);
  });

  it("★缺口反转与 op 数量变化都是**行为死支**＝到达它们的前提里已经有阈值咬合，:100 必然返回 true", () => {
    const prev = snap({ totalSupply: 1000, totalRemaining: 1000, gap: 0 });
    // 缺口方向反转，但两侧变化都 <10% ⇒ :92 先短路返回 false（反转触发不了任何东西）
    const flipNoCross = snap({ totalSupply: 980, totalRemaining: 1010, gap: 30 });
    expect(shouldRebalance(flipNoCross, prev, 0, 1000)).toBe(false);
    // 阈值咬了、缺口不反转、op 数量不动 ⇒ 仍然 true ⇒ 决定结果的只有阈值这一件事
    const crossOnly = snap({ totalSupply: 1100, totalRemaining: 1000, gap: -100 });
    expect(shouldRebalance(crossOnly, prev, 0, 1000)).toBe(true);
    // 反向配对：缺口反转＋op 数量同时大变，但阈值不咬 ⇒ 依旧 false（两条"触发器"都不是自主要件）
    const bothButSmall = snap({
      totalSupply: 1005,
      totalRemaining: 1004,
      gap: -1,
      activeOperationCount: 9,
    });
    const prevGapPos = snap({
      totalSupply: 1000,
      totalRemaining: 1000,
      gap: 5,
      activeOperationCount: 2,
    });
    expect(shouldRebalance(bothButSmall, prevGapPos, 0, 1000)).toBe(false);
  });

  it("冷却严格小于 200 拍挡在前面（第 200 拍放行）", () => {
    const prev = snap();
    const moved = snap({ totalSupply: 800 }); // 20% 变化，过了阈值
    expect(shouldRebalance(moved, prev, 1000, 1199)).toBe(false);
    expect(shouldRebalance(moved, prev, 1000, 1200)).toBe(true);
  });

  it("对外参数表与内部常数是同一份（防「改了一个数忘了另一个」）", () => {
    const p = getStabilityParams();
    expect(p.hysteresisTicks).toBe(200);
    expect(p.rebalanceCooldown).toBe(200);
    expect(p.rebalanceThreshold).toBe(0.1);
    expect(p.minimumCommitmentRuns).toBe(1);
    // 参数表与判定必须一致：200 拍出保护期 ⇔ hysteresisTicks=200
    expect(isInHysteresis(op(), 1000 + p.hysteresisTicks)).toBe(false);
    expect(
      shouldRebalance(
        snap({ totalSupply: 1000 }),
        snap({ totalSupply: 1000 }),
        0,
        p.rebalanceCooldown,
      ),
    ).toBe(false);
  });
});
