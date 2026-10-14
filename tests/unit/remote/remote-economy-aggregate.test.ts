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
  sumRemoteNamedRoleCpu,
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
    expect(agg.s).toContain("e/cpu(mgr-slice)=n/a");
    expect(agg.s).not.toContain("Infinity");
  });

  it("有 CPU 时比值＝净速率 ÷ CPU，摘要与字段同值", () => {
    const l = ledger({ delivered: 1000, spawnCost: 0, infraCost: 0, window: 100, cpu: 0.5 });
    const agg = aggregateRemoteEconomy([l], 0, 1100);
    // 净 1000 ÷ 100 拍 = 10 e/拍，CPU 0.5/拍 ⇒ 20 e/cpu
    expect(agg.nv).toBe(10);
    expect(agg.cu).toBe(0.5);
    expect(agg.s).toContain("e/cpu(mgr-slice)=20");
    // 标签必须自带尺名：分母只是"本房 demand 评估 ÷ 线数"这一片，不含远矿 creep 实耗。
    // 改回裸 `e/cpu` 时这两条断言会红（roadmap 补303③：同一个名字两种分母差 31.6×）。
    expect(agg.s).toContain("demand-eval-slice");
  });
});

describe("远矿道成本的分母：remote* 名字规则求和（#138 升档，roadmap 补324）", () => {
  /** 线上角色榜形状（同拍现读 @83,634,465：板总 6.64，remoteHarvester 1.78／remoteHauler 0.57／reserver 0.68）。 */
  const LIVE_BOARD: Record<string, number> = {
    harvester: 1.87,
    remoteHarvester: 1.78,
    reserver: 0.68,
    remoteHauler: 0.57,
    upgrader: 0.45,
    distributor: 0.43,
    labTender: 0.41,
    hauler: 0.2,
    carrier: 0.14,
    builder: 0.12,
    remoteDefender: 0,
  };

  it("只收 remote* 名角色，reserver 明确留在门外（边界不替人划）", () => {
    const { sum, included } = sumRemoteNamedRoleCpu(LIVE_BOARD);
    expect(Math.round(sum * 100) / 100).toBe(2.35);
    expect(included).toEqual(["remoteHarvester", "remoteHauler"]);
    // 前提检查：这张榜里 reserver 是**在场且非零**的，否则"被排除"这件事根本没被验证。
    expect(LIVE_BOARD.reserver).toBeGreaterThan(0);
    expect(included).not.toContain("reserver");
  });

  it("脏值不进分母（0／负／NaN 一律滤掉）", () => {
    const { sum, included } = sumRemoteNamedRoleCpu({
      remoteHarvester: 1,
      remoteHauler: 0,
      remoteDefender: Number.NaN,
      remoteMiner: -5,
    });
    expect(sum).toBe(1);
    expect(included).toEqual(["remoteHarvester"]);
  });

  it("两把尺并排上桌：lane-name-rule 的分母比 mgr-slice 大一个数量级以上", () => {
    const l = ledger({
      delivered: 6_847_124,
      spawnCost: 4_633_060,
      infraCost: 107_800,
      window: 586_065,
      cpu: 0.06, // 线上 dashboard 的 cu 就是这个量级
    });
    const agg = aggregateRemoteEconomy([l], 0, 1000 + 586_065, sumRemoteNamedRoleCpu(LIVE_BOARD));
    expect(agg.lc).toBe(2.35);
    expect(agg.s).toContain("cpu(remote-named-roles)=2.35/tick[remoteHarvester+remoteHauler]");
    expect(agg.cu).toBeGreaterThan(0);
    // 这条才是本轮买到的东西：误用**在串上可见**（119 那种数旁边就摆着真量级）。
    expect((agg.lc ?? 0) / agg.cu).toBeGreaterThan(10);
    const laneRatio = Math.round((agg.nv / (agg.lc as number)) * 100) / 100;
    expect(agg.s).toContain(`e/cpu(lane-name-rule)=${laneRatio}`);
  });

  it("调用方没给角色榜 ⇒ 那一段整个不发、lc 缺席（缺席≠0）", () => {
    const l = ledger({ delivered: 1000, spawnCost: 0, infraCost: 0, window: 100 });
    const agg = aggregateRemoteEconomy([l], 0, 1100);
    expect("lc" in agg).toBe(true);
    expect(agg.lc).toBeUndefined();
    expect(agg.s).not.toContain("lane-name-rule");
    expect(agg.s).toContain("healthy="); // 原有段落不许被追加改坏
  });

  it("给了但榜上无 remote* ⇒ lc=0 且比值写 n/a（与上面那格分得开）", () => {
    const l = ledger({ delivered: 1000, spawnCost: 0, infraCost: 0, window: 100 });
    const agg = aggregateRemoteEconomy([l], 0, 1100, sumRemoteNamedRoleCpu({ harvester: 1.87 }));
    expect(agg.lc).toBe(0);
    expect(agg.s).toContain("cpu(remote-named-roles)=0/tick[none]");
    expect(agg.s).toContain("e/cpu(lane-name-rule)=n/a");
  });
});
