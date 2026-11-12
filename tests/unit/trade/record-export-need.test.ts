/** Phase B：terminal 出口需求登记（现货不足 → distributor 补货票）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { recordExportNeed } from "../../../src/systems/trade/terminal-selfaid";
import { globalCache } from "../../../src/kernel/global-cache";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  delete (globalThis as any).exportNeeds;
});

const DEADLINE = 1000 + CONFIG.market.interval * 2;

describe("recordExportNeed", () => {
  it("首次登记创建条目并写入 deadline", () => {
    recordExportNeed("W7N4", "H", 5000, 1000);
    const list = globalCache().exportNeeds?.byRoom["W7N4"];
    expect(list).toHaveLength(1);
    expect(list?.[0]).toEqual({ resource: "H", amount: 5000, deadline: DEADLINE });
  });

  it("同资源重复登记取最大值并刷新 deadline", () => {
    recordExportNeed("W7N4", "H", 5000, 1000);
    recordExportNeed("W7N4", "H", 8000, 1100);
    const list = globalCache().exportNeeds?.byRoom["W7N4"];
    expect(list).toHaveLength(1);
    expect(list?.[0]?.amount).toBe(8000);
    expect(list?.[0]?.deadline).toBe(1100 + CONFIG.market.interval * 2);

    // 更小的需求不会覆盖更大的。
    recordExportNeed("W7N4", "H", 1000, 1200);
    expect(globalCache().exportNeeds?.byRoom["W7N4"]?.[0]?.amount).toBe(8000);
  });

  it("不同资源各自独立", () => {
    recordExportNeed("W7N4", "H", 5000, 1000);
    recordExportNeed("W7N4", "O", 3000, 1000);
    expect(globalCache().exportNeeds?.byRoom["W7N4"]).toHaveLength(2);
  });

  it("写入时清理本房过期条目", () => {
    globalCache().exportNeeds = {
      tick: 1000,
      byRoom: {
        W7N4: [
          { resource: "H", amount: 5000, deadline: 999 },
          { resource: "O", amount: 3000, deadline: 5000 },
        ],
      },
    };
    recordExportNeed("W7N4", "K", 100, 1000);
    const list = globalCache().exportNeeds?.byRoom["W7N4"] ?? [];
    expect(list.map(n => n.resource)).toEqual(["O", "K"]);
  });

  it("amount <= 0 不写入", () => {
    recordExportNeed("W7N4", "H", 0, 1000);
    expect(globalCache().exportNeeds).toBeUndefined();
  });
});
