/**
 * 远矿经济聚合的一条不变量：**快照里的每个数字都能由账本手算复现**，且 CPU 为 0 时
 * 不许除出 Infinity（`e/cpu` 写 `n/a`）。
 *
 * 立案＝roadmap 补218／补219（commit 059b4131／6e34a087）：`netRate` 与 `cpuPerTick`
 * 此前只在 heap 与逐条日志里，读数人（包括我）要手工回代才能回答「这条线值多少 CPU」，
 * 而扩张闸的 CPU 缺口决策就卡在这个比值上。
 */
import { describe, expect, it } from "vitest";
import {
  aggregateRemoteEconomy,
  emptyOpLedger,
  opNetRate,
  recordOpCpu,
} from "../../../src/domain/remote/op-ledger";

function ledger(input: {
  delivered: number;
  spawnCost: number;
  infraCost: number;
  window: number;
  cpu?: number;
}): ReturnType<typeof emptyOpLedger> {
  const tick = 1000 + input.window;
  const l = emptyOpLedger(tick);
  l.windowStart = 1000;
  l.delivered = input.delivered;
  l.spawnCost = input.spawnCost;
  l.infraCost = input.infraCost;
  if (input.cpu !== undefined) recordOpCpu(l, input.cpu);
  return l;
}

describe("远矿经济聚合：数字可复现、除零不造脏值", () => {
  it("净营收速率＝(delivered − 未回收孵化投入 − 工事投入) ÷ 窗口，与单线判据同式", () => {
    // 线上实测形状（RC1，t=83,564,680）：W36S58 交付 6,847,124／孵化 4,633,060／工事 107,800／窗 586,065
    const l = ledger({
      delivered: 6_847_124,
      spawnCost: 4_633_060,
      infraCost: 107_800,
      window: 586_065,
    });
    const net = opNetRate(l, 1000 + 586_065);
    expect(Math.round(net * 1000) / 1000).toBe(3.594);
    const agg = aggregateRemoteEconomy([l], 0, 1000 + 586_065);
    expect(agg.nv).toBe(3.59);
    expect(agg.ao).toBe(1);
    expect(agg.ho).toBe(1);
    expect(agg.dg).toBe(0);
  });

  it("亏损线计入 dg 而不是消失；暂停线由计数带进来", () => {
    const winner = ledger({ delivered: 1000, spawnCost: 100, infraCost: 0, window: 100 });
    const loser = ledger({ delivered: 50, spawnCost: 900, infraCost: 200, window: 100 });
    const agg = aggregateRemoteEconomy([winner, loser], 3, 1100);
    expect(agg.ao).toBe(2);
    expect(agg.ho).toBe(1);
    expect(agg.dg).toBe(1);
    expect(agg.sp).toBe(3);
    expect(agg.nv).toBeLessThan(aggregateRemoteEconomy([winner], 0, 1100).nv);
  });

  it("CPU 为 0 时 e/cpu 写 n/a（不许除出 Infinity 进摘要）", () => {
    const agg = aggregateRemoteEconomy(
      [ledger({ delivered: 1000, spawnCost: 0, infraCost: 0, window: 100 })],
      0,
      1100,
    );
    expect(agg.cu).toBe(0);
    expect(agg.s).toContain("e/cpu=n/a");
    expect(agg.s).not.toContain("Infinity");
  });

  it("有 CPU 时比值＝净速率 ÷ CPU，摘要与字段同值", () => {
    const l = ledger({ delivered: 1000, spawnCost: 0, infraCost: 0, window: 100, cpu: 0.5 });
    const agg = aggregateRemoteEconomy([l], 0, 1100);
    // 净 1000 ÷ 100 拍 = 10 e/拍，CPU 0.5/拍 ⇒ 20 e/cpu
    expect(agg.nv).toBe(10);
    expect(agg.cu).toBe(0.5);
    expect(agg.s).toContain("e/cpu=20");
  });
});
