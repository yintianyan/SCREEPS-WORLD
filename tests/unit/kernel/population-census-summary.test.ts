/**
 * 人口普查总数列（#141）的纯函数回归测试。
 *
 * 立案理由（线上）：段 1 的 `population` 只写 `hv/ha/up/bd/wk` 五个角色，
 * 现读某刻这五列之和 = **11**，而同拍 `Game.creeps` 实数 = **42**
 * ⇒ 任何"每只 creep 多少 CPU / 闲置率"若拿五列当分母，会**虚高约 4 倍**。
 * 修法刻意是**加列**（`n`/`rl`）而不是改那五列 —— 既有读数全部保持可比。
 *
 * 这里只钉汇总算术：写快照的 `samplePopulationData` 要动 RawMemory 段与 Game.creeps，
 * 为它手拼一套假引擎夹具，测到的是夹具而不是行为（本仓有过这类假绿）。
 */
import { describe, expect, it } from "vitest";
import { summarizeRoles } from "../../../src/kernel/timeseries";

describe("summarizeRoles — #141 普查覆盖率", () => {
  it("n 计入全部角色，rl 只留前 N：五列之和 ≤ 11 而 n = 42 的那个现场形状", () => {
    // 复刻现读的两个数：**五列之和 = 11、总量 = 42**。逐角色的分布是比例示例，
    // 现读只拿到那两个聚合值，没有逐角色明细，别把它读成实测快照。
    const counts = {
      harvester: 4,
      hauler: 5,
      upgrader: 2,
      builder: 0,
      worker: 0,
      remoteHauler: 6,
      remoteHarvester: 5,
      distributor: 4,
      carrier: 4,
      attacker: 4,
      reserver: 3,
      healer: 4,
      labTender: 1,
    };
    const { n, rl } = summarizeRoles(counts);
    expect(n).toBe(42);
    // 关键断言：**旧口径会给出 11**，所以 n ≠ 五列之和正是这条修复的意义。
    expect(rl["harvester"]).toBe(4);
    expect(rl["remoteHauler"]).toBe(6);
    expect(rl["labTender"]).toBeUndefined(); // 超出前 10，被裁掉但仍计入 n
    expect(Object.keys(rl).length).toBeLessThanOrEqual(10);
    // rl 之和必须 ≤ n，且差额恰好等于被裁掉的长尾。
    const kept = Object.values(rl).reduce((a, b) => a + b, 0);
    expect(kept).toBeLessThan(n);
  });

  it("rl 按数量降序（榜首就是最大角色，读侧不必自己排）", () => {
    const { rl } = summarizeRoles({ a: 1, b: 7, c: 3 });
    expect(Object.entries(rl)).toEqual([
      ["b", 7],
      ["c", 3],
      ["a", 1],
    ]);
  });

  it("topN 可收窄；空编制的 n 是 0 而不是 undefined", () => {
    expect(summarizeRoles({ a: 5, b: 4, c: 3 }, 2).rl).toEqual({ a: 5, b: 4 });
    expect(summarizeRoles({})).toEqual({ n: 0, rl: {} });
  });

  it("未知角色（memory.role 缺失时写者会填 'unknown'）照样进 n", () => {
    const { n, rl } = summarizeRoles({ unknown: 3, harvester: 1 });
    expect(n).toBe(4);
    expect(rl["unknown"]).toBe(3);
  });
});
