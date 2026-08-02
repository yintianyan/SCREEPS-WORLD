/**
 * 死资产检测测试（2026-08-02，docs/layout-system-design-2026-08.md §3.3）。
 *
 * 覆盖：
 *   - computeDeadAssetSince：三重校验（source + energy=0 + 无 outlet）
 *   - 持续时长判定（getDeadAssetLinks 阈值过滤）
 *   - 瞬态恢复（校验失败 → 清除计时器）
 *   - link 消失 → 自动清理
 *   - clearDeadAssetLink 清除指定 link
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  computeDeadAssetSince,
  getDeadAssetLinks,
  clearDeadAssetLink,
  DEAD_ASSET_THRESHOLD,
} from "../../../src/systems/link-system";
import { globalCache } from "../../../src/kernel/global-cache";
import type { LinkInfo } from "../../../src/domain/economy/links";
import { resetGlobals } from "../../role-helpers";

function makeLink(
  id: string,
  role: LinkInfo["role"],
  energy = 0,
): LinkInfo {
  return { id, role, energy, energyCapacity: 800, cooldown: 0 };
}

describe("computeDeadAssetSince — 三重校验纯函数", () => {
  it("source link + energy=0 + 无 outlet → 记录首次 tick", () => {
    const infos = [makeLink("src1", "source", 0)];
    const next = computeDeadAssetSince(infos, 1000, new Map());
    expect(next.get("src1")).toBe(1000);
  });

  it("source link + energy>0 → 不记录（有能量不是死资产）", () => {
    const infos = [makeLink("src1", "source", 100)];
    const next = computeDeadAssetSince(infos, 1000, new Map());
    expect(next.has("src1")).toBe(false);
  });

  it("source link + energy=0 + 有 controller link → 不记录（有 outlet）", () => {
    const infos = [makeLink("src1", "source", 0), makeLink("ctrl1", "controller", 0)];
    const next = computeDeadAssetSince(infos, 1000, new Map());
    expect(next.has("src1")).toBe(false);
  });

  it("source link + energy=0 + 有 storage link → 不记录（有 outlet）", () => {
    const infos = [makeLink("src1", "source", 0), makeLink("stor1", "storage", 0)];
    const next = computeDeadAssetSince(infos, 1000, new Map());
    expect(next.has("src1")).toBe(false);
  });

  it("非 source link（controller/storage/hub）→ 永不记录（不需要 outlet）", () => {
    const infos = [
      makeLink("ctrl1", "controller", 0),
      makeLink("stor1", "storage", 0),
      makeLink("hub1", "hub", 0),
    ];
    const next = computeDeadAssetSince(infos, 1000, new Map());
    expect(next.size).toBe(0);
  });

  it("瞬态恢复：上 tick 死资产，本 tick 有能量 → 清除计时器", () => {
    const prev = new Map([["src1", 900]]);
    const infos = [makeLink("src1", "source", 100)]; // 本 tick 有能量
    const next = computeDeadAssetSince(infos, 1000, prev);
    expect(next.has("src1")).toBe(false);
  });

  it("瞬态恢复：上 tick 死资产，本 tick 有 controller link → 清除计时器", () => {
    const prev = new Map([["src1", 900]]);
    const infos = [makeLink("src1", "source", 0), makeLink("ctrl1", "controller", 0)];
    const next = computeDeadAssetSince(infos, 1000, prev);
    expect(next.has("src1")).toBe(false);
  });

  it("持续死资产：沿用首次记录 tick（不更新到当前 tick）", () => {
    const prev = new Map([["src1", 500]]);
    const infos = [makeLink("src1", "source", 0)]; // 持续死资产
    const next = computeDeadAssetSince(infos, 1000, prev);
    expect(next.get("src1")).toBe(500); // 沿用首次 tick
  });

  it("link 消失（不在 infos 中）→ 自动清理计时器", () => {
    const prev = new Map([["src1", 500], ["src2", 600]]);
    const infos = [makeLink("src1", "source", 0)]; // src2 消失
    const next = computeDeadAssetSince(infos, 1000, prev);
    expect(next.has("src1")).toBe(true);
    expect(next.has("src2")).toBe(false);
  });

  it("W3N7 死资产场景：2 个 source link 死资产 + 无 controller/storage", () => {
    const infos = [
      makeLink("src_link1", "source", 0),
      makeLink("src_link2", "source", 0),
    ];
    const next = computeDeadAssetSince(infos, 1000, new Map());
    expect(next.get("src_link1")).toBe(1000);
    expect(next.get("src_link2")).toBe(1000);
  });
});

describe("getDeadAssetLinks — 持续阈值过滤", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("空 globalCache → 返回空数组", () => {
    expect(getDeadAssetLinks(1000)).toEqual([]);
  });

  it("计时器存在但未达阈值 → 不返回", () => {
    const cache = globalCache();
    cache.deadAssetSince = new Map([["src1", 800]]);
    // 阈值 500，当前 800+400=1200 - 800 = 400 < 500
    expect(getDeadAssetLinks(1200)).toEqual([]);
  });

  it("计时器达到阈值 → 返回死资产 link id", () => {
    const cache = globalCache();
    cache.deadAssetSince = new Map([["src1", 500]]);
    // 1500 - 500 = 1000 >= 500
    expect(getDeadAssetLinks(1500)).toEqual(["src1"]);
  });

  it("多个死资产：达到阈值的返回，未达到的不返回", () => {
    const cache = globalCache();
    cache.deadAssetSince = new Map([
      ["src1", 500],  // 1500-500=1000 >= 500 ✓
      ["src2", 1100], // 1500-1100=400 < 500 ✗
    ]);
    expect(getDeadAssetLinks(1500)).toEqual(["src1"]);
  });

  it("刚好达到阈值（边界）→ 返回", () => {
    const cache = globalCache();
    cache.deadAssetSince = new Map([["src1", 1000]]);
    // 1000 + 500 = 1500, 1500 - 1000 = 500 >= 500 ✓
    expect(getDeadAssetLinks(1500)).toEqual(["src1"]);
  });
});

describe("clearDeadAssetLink — 清除指定计时器", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("清除指定 link id → getDeadAssetLinks 不再返回", () => {
    const cache = globalCache();
    cache.deadAssetSince = new Map([["src1", 500], ["src2", 500]]);
    clearDeadAssetLink("src1");
    expect(getDeadAssetLinks(1500)).toEqual(["src2"]);
  });

  it("清除不存在的 link id → 无副作用", () => {
    const cache = globalCache();
    cache.deadAssetSince = new Map([["src1", 500]]);
    clearDeadAssetLink("nonexistent");
    expect(getDeadAssetLinks(1500)).toEqual(["src1"]);
  });

  it("globalCache 无 deadAssetSince → 清除无副作用", () => {
    clearDeadAssetLink("src1");
    expect(getDeadAssetLinks(1500)).toEqual([]);
  });
});
