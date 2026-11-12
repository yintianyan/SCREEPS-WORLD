/** Phase A：房间长周期资源库存聚合。 */
import { describe, expect, it } from "vitest";
import { collectRoomResourceStocks } from "../../../src/domain/economy/resource-stock";
import { mockSnapshot } from "../../support/factories";

describe("collectRoomResourceStocks", () => {
  it("聚合 storage/terminal/factory/labs/containers，忽略零值与缺失位置", () => {
    const snapshot = mockSnapshot({
      storage: { store: { energy: 1000, battery: 50 } } as any,
      terminal: { store: { energy: 500, H: 100 } } as any,
      factory: { store: { energy: 200, battery: 10 } } as any,
      labs: [{ store: { energy: 100, GH2O: 20 } } as any],
      containers: [{ store: { energy: 50, H: 30 } } as any],
    });

    expect(collectRoomResourceStocks(snapshot)).toEqual({
      energy: 1850,
      battery: 60,
      H: 130,
      GH2O: 20,
    });
  });

  it("无 storage/terminal/factory/labs/containers 时返回空对象", () => {
    expect(collectRoomResourceStocks(mockSnapshot())).toEqual({});
  });

  it("忽略非数值、零值与负数条目", () => {
    const snapshot = mockSnapshot({
      storage: { store: { energy: 100, battery: 0, H: -5, method: () => {} } } as any,
    });

    expect(collectRoomResourceStocks(snapshot)).toEqual({ energy: 100 });
  });
});
