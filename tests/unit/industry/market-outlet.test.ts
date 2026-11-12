/** Phase C：市场买盘出口判定（yes/no/unknown）。 */
import { describe, expect, it } from "vitest";
import {
  collectBuyOrderResources,
  marketOutletState,
  type MarketOrderCacheView,
} from "../../../src/domain/industry/market-outlet";

function cache(
  orders: Record<string, { id: string; price: number; amount: number; roomName: string }[]>,
  tick = 1000,
): MarketOrderCacheView {
  return { tick, orders };
}

describe("marketOutletState", () => {
  it("缓存缺失/过期 → unknown（判不了不拦）", () => {
    expect(marketOutletState("H", undefined, 1000, 250)).toBe("unknown");
    expect(marketOutletState("H", cache({}, 1000), 1300, 250)).toBe("unknown");
  });

  it("缓存新鲜但无买单 → no", () => {
    expect(marketOutletState("H", cache({}), 1000, 250)).toBe("no");
    expect(marketOutletState("H", cache({ "buy/H": [] }), 1000, 250)).toBe("no");
  });

  it("存在数量 > 0 的买单 → yes", () => {
    const view = cache({
      "buy/H": [{ id: "o1", price: 10, amount: 100, roomName: "W1N1" }],
    });
    expect(marketOutletState("H", view, 1000, 250)).toBe("yes");
  });

  it("买单数量为 0 → no", () => {
    const view = cache({
      "buy/H": [{ id: "o1", price: 10, amount: 0, roomName: "W1N1" }],
    });
    expect(marketOutletState("H", view, 1000, 250)).toBe("no");
  });
});

describe("collectBuyOrderResources", () => {
  it("只收买盘且数量 > 0 的资源", () => {
    const view = cache({
      "buy/H": [{ id: "h", price: 10, amount: 100, roomName: "W1N1" }],
      "buy/O": [{ id: "o", price: 10, amount: 0, roomName: "W1N1" }],
      "sell/U": [{ id: "u", price: 10, amount: 100, roomName: "W1N1" }],
    });
    expect([...collectBuyOrderResources(view, 1000, 250)]).toEqual(["H"]);
  });

  it("缓存缺失/过期 → 空集合", () => {
    expect([...collectBuyOrderResources(undefined, 1000, 250)]).toEqual([]);
    expect([...collectBuyOrderResources(cache({}, 1000), 1300, 250)]).toEqual([]);
  });
});
