/** R675 房间任务账本 — 指标/价值/TTL/缓存。 */
import { beforeEach, describe, expect, it } from "vitest";
import { getRoomTaskLedger, ledgerValue } from "../../../src/creeps/support/task-ledger";
import { globalCache } from "../../../src/kernel/global-cache";
import {
  mockConstructionSite,
  mockSnapshot,
  mockStructure,
  resetGlobals,
} from "../../support/factories";

function labTable(room: string, loads: number, tick = (globalThis as any).Game.time) {
  globalCache().labDemands = {
    tick,
    byRoom: {
      [room]: {
        loads: Array.from({ length: loads }, (_, i) => ({
          labId: `lab${i}`,
          resource: "energy",
          amount: 200,
        })),
        unloads: [],
      },
    },
  };
}

beforeEach(() => resetGlobals());

describe("task-ledger — 指标与任务价值", () => {
  it("核心/CC/storage 指标与基础价值", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const ext = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 });
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 100000 });
    const snap = mockSnapshot({
      spawns: [spawn],
      extensions: [ext],
      controllerContainer: cc,
      storage,
      fillTargets: [spawn, ext, cc],
    });

    const ledger = getRoomTaskLedger(snap);
    expect(ledger.metrics.coreFreeRatio).toBeCloseTo(250 / 350);
    expect(ledger.metrics.ccLevel).toBeCloseTo(0.05);
    expect(ledgerValue(ledger, "fill-core")).toBeCloseTo(70 + 20 * (1 - 250 / 350));
    expect(ledgerValue(ledger, "fill-cc")).toBe(90); // 非施工期且低于半满
    expect(ledgerValue(ledger, "store-energy")).toBe(95);
  });

  it("R687：核心接近满(<25% free)且 CC 低于半满 ⇒ CC 抬到 96，压过 storage(95)", () => {
    // 线上 W39S55 的形状：核心 1200/1300、CC 224/2000。CC 的 90 低于 storage 95，
    // hauler 的效用仲裁永远选 storage，getHaulFillTarget 内部的 CC 半满优先档得不到调用。
    const spawn = mockStructure("spawn", { id: "sp1", energy: 320, capacity: 350 });
    const cc = mockStructure("container", { id: "cc1", energy: 200, capacity: 2000 });
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 100000 });
    const snap = mockSnapshot({
      spawns: [spawn],
      controllerContainer: cc,
      storage,
      fillTargets: [spawn, cc],
    });
    const ledger = getRoomTaskLedger(snap);
    expect(ledgerValue(ledger, "fill-cc")).toBe(96);
    expect(ledgerValue(ledger, "fill-cc")!).toBeGreaterThan(ledgerValue(ledger, "store-energy")!);
  });

  it("R687 控制组：核心不接近满时 CC 维持 90（升级不抢 spawn 的能量）", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 350 });
    const cc = mockStructure("container", { id: "cc1", energy: 200, capacity: 2000 });
    const storage = mockStructure("storage", { id: "st", energy: 50000, capacity: 100000 });
    const snap = mockSnapshot({
      spawns: [spawn],
      controllerContainer: cc,
      storage,
      fillTargets: [spawn, cc],
    });
    expect(ledgerValue(getRoomTaskLedger(snap), "fill-cc")).toBe(90);
  });

  it("施工期 CC 自动降档到 50（R672 教训：不锁死 hauler）", () => {
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 });
    const site = mockConstructionSite("extension", { id: "s1" });
    const snap = mockSnapshot({
      controllerContainer: cc,
      myConstructionSites: [site],
      fillTargets: [cc],
    });
    const ledger = getRoomTaskLedger(snap);
    expect(ledgerValue(ledger, "fill-cc")).toBe(50);
    expect(ledgerValue(ledger, "feed-construction")).toBe(75);
  });

  it("R680：crisis/recovery/bootstrap 期 CC 同样降档（核心优先）", () => {
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 });
    const snap = mockSnapshot({ controllerContainer: cc, fillTargets: [cc] });
    (Memory.rooms.W7N4 as any).phase = { phase: "crisis" };
    expect(ledgerValue(getRoomTaskLedger(snap), "fill-cc")).toBe(50);

    (globalThis as any).Game.time += 1;
    (Memory.rooms.W7N4 as any).phase = { phase: "growth" };
    expect(
      ledgerValue(
        getRoomTaskLedger(mockSnapshot({ controllerContainer: cc, fillTargets: [cc] })),
        "fill-cc",
      ),
    ).toBe(90);
  });

  it("lab 需求表在 TTL 内可用，超时归零", () => {
    const snap = mockSnapshot();
    labTable("W7N4", 2, (globalThis as any).Game.time - 10);
    const fresh = getRoomTaskLedger(snap);
    expect(fresh.metrics.labLoads).toBe(2);
    expect(ledgerValue(fresh, "supply-labs")).toBe(100);

    (globalThis as any).Game.time += 100;
    const stale = getRoomTaskLedger(mockSnapshot());
    expect(stale.metrics.labLoads).toBe(0);
    expect(ledgerValue(stale, "supply-labs")).toBe(0);
  });

  it("矿物积压按 70% 容器阈值计入", () => {
    const mineralStore = {
      H: 1500,
      getUsedCapacity: (r?: string) => (r === undefined ? 1500 : r === "H" ? 1500 : 0),
      getFreeCapacity: () => 500,
      getCapacity: () => 2000,
    };
    const c = mockStructure("container", { id: "mc", energy: 0, capacity: 2000 });
    (c as any).store = mineralStore;
    const snap = mockSnapshot({ containers: [c] });
    const ledger = getRoomTaskLedger(snap);
    expect(ledger.metrics.mineralBacklog).toBe(1500);
    expect(ledgerValue(ledger, "haul-minerals")).toBe(65);
  });

  it("同一 tick 同房返回同一账本对象（每房一次）", () => {
    const snap = mockSnapshot();
    expect(getRoomTaskLedger(snap)).toBe(getRoomTaskLedger(mockSnapshot()));
  });
});
