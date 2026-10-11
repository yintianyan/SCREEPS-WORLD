/**
 * 敌意锚历史环的三条不变量 —— 立案见 roadmap 补223（commit 677d6bca）。
 *
 * 为什么要有这条环：判「NPC 骚扰多久来一次」需要的是**簇间隔分布**，而三样现有载体都不给：
 * 事件环跨度实测 3,162 拍 < 威胁窗 5,000 拍（按构造答不了频率）；`lastHostileAt` 只有最新值、
 * 每次覆写；巡检锁是散文。环只落盘、零消费者 ⇒ 不改任何判定，只把 #151/#92 的决策输入补齐。
 */
import { describe, expect, it } from "vitest";
import {
  HOSTILE_EDGE_HISTORY_CAP,
  recordHostileEdge,
  type HostileEdgeRecord,
} from "../../../src/systems/room/room-state";

const rec = (t: number, s: HostileEdgeRecord["s"] = "invader"): HostileEdgeRecord => ({ t, s });

describe("敌意锚历史环：有界、同拍不重复、间隔可算", () => {
  it("上限是有界的，且保留的是最新的若干条（旧→新）", () => {
    let h: HostileEdgeRecord[] = [];
    for (let i = 0; i < HOSTILE_EDGE_HISTORY_CAP + 25; i++) {
      h = recordHostileEdge(h, 1000 + i * 7, "invader");
    }
    expect(h).toHaveLength(HOSTILE_EDGE_HISTORY_CAP);
    expect(h.at(0)?.t).toBe(1000 + 25 * 7);
    expect(h.at(-1)?.t).toBe(1000 + (HOSTILE_EDGE_HISTORY_CAP + 24) * 7);
  });

  it("同一拍重复盖章不产生 0 拍毛刺（否则簇间隔分布被污染）", () => {
    let h = recordHostileEdge(undefined, 500, "invader");
    h = recordHostileEdge(h, 500, "invader");
    h = recordHostileEdge(h, 500, "invader");
    expect(h).toHaveLength(1);
    const gaps = h.slice(1).map((r, i) => r.t - Number(h[i]?.t));
    expect(gaps).toEqual([]);
  });

  it("同拍 unknown 可被真来源补正；反向不覆盖（player 不被 unknown 抹掉）", () => {
    const a = recordHostileEdge([rec(900, "invader")], 1000, "unknown");
    const b = recordHostileEdge(a, 1000, "player");
    expect(b.at(-1)?.s).toBe("player");
    const c = recordHostileEdge(b, 1000, "unknown");
    expect(c.at(-1)?.s).toBe("player");
  });

  it("间隔序列可直接算出（频率就是靠它答的）", () => {
    const h = [rec(100), rec(120, "player"), rec(5300)];
    const gaps = h.slice(1).map((r, i) => r.t - Number(h[i]?.t));
    expect(gaps).toEqual([120 - 100, 5300 - 120]);
    // 判「能不能出 war」的形状：相邻锚抬升 < 威胁窗 ⇒ 沿被重新抢跑
    expect(gaps.some(g => g < 5000)).toBe(true);
  });

  it("非数组的历史值（旧档／手改）不会被当可信输入", () => {
    const h = recordHostileEdge({ nope: true } as never, 700, "invader");
    expect(Array.isArray(h)).toBe(true);
    expect(h).toHaveLength(1);
  });
});
