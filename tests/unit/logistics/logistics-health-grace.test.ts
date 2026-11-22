/** logistics-health 交付宽限测试（2026-11-22）。
 *
 * 线上实证：2 条刚在册的请求（delivered=0/lost=0、age<200t）把交付率打成 0%
 * ⇒ level=critical/score=0，与 empireHealth 的 logistics=1.0 互相打脸。
 * 语义：零证据的在途请求不算交付率分母（单列 inFlight）；超过宽限仍零证据
 * ⇒ 真饿死，照常入分母 —— 宽限绝不掩盖真饥饿。
 */
import { describe, expect, it } from "vitest";
import {
  computeLogisticsHealth,
  LOGISTICS_DELIVERY_GRACE_TICKS,
} from "../../../src/domain/logistics/logistics-health";
import {
  createAccounting,
  recordDelivered,
} from "../../../src/domain/logistics/transport-accounting";
import type { TransportRequestV2 } from "../../../src/domain/logistics/transport-request";

const TICK = 1_000_000;

function req(status: string = "pending"): TransportRequestV2 {
  return { requestId: "r", status, amount: 100 } as unknown as TransportRequestV2;
}

describe("computeLogisticsHealth — 在途宽限", () => {
  it("年轻零证据请求 → 在途单列，不进交付率分母（线上 critical 误报的复现与修复）", () => {
    const young = createAccounting("young", 1000, TICK - 50); // age 50 < 200
    const r = computeLogisticsHealth([young], [req()], 30, TICK);
    expect(r.deliveryRate).toBe(1); // 分母空 → 中性
    expect(r.level).toBe("healthy");
    expect(r.message).toContain("inFlight=1");
  });

  it("同一条请求超过宽限仍零证据 → 真饿死，照常入分母（宽限不掩盖真饥饿）", () => {
    const starved = createAccounting("starved", 1000, TICK - (LOGISTICS_DELIVERY_GRACE_TICKS + 1));
    const r = computeLogisticsHealth([starved], [req()], 30, TICK);
    expect(r.deliveryRate).toBe(0);
    expect(r.level).toBe("critical");
  });

  it("有交付证据的请求不受宽限影响，照常计分", () => {
    const done = recordDelivered(createAccounting("done", 1000, TICK - 10), 800);
    const r = computeLogisticsHealth([done], [], 30, TICK);
    expect(r.deliveryRate).toBe(0.8);
  });

  it("混合：在途 + 已交付并存时，交付率只按已裁决请求算", () => {
    const done = recordDelivered(createAccounting("done", 1000, TICK - 300), 500);
    const young = createAccounting("young", 1000, TICK - 30);
    const r = computeLogisticsHealth([done, young], [], 30, TICK);
    expect(r.deliveryRate).toBe(0.5); // 分母 = done 的 1000，young 不进分母
    expect(r.message).toContain("inFlight=1");
  });

  it("无 createdAt 的旧快照按已过宽限处理（缺列不伪装成在途）", () => {
    const legacy = { ...createAccounting("legacy", 1000), createdAt: undefined };
    const r = computeLogisticsHealth([legacy], [], 30, TICK);
    expect(r.deliveryRate).toBe(0); // 零证据 + 视为过宽限 → 入分母
  });
});
