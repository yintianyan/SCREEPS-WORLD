/**
 * 远矿线级 CPU 归属必须能跨 boot 存活 —— 立案过程见 roadmap 补219。
 *
 * 起因：`opNetRate`（净能量/拍）与 `cpuPerTick`（CPU/拍）要放在同一张账上比较，才谈得上
 * "这条远矿线值多少 CPU"（扩张闸的 CPU 缺口决策 #50 就卡在这个比值上）。但持久化快照
 * 只有四个金额字段，`fromOpLedgerSnapshot` 把 CPU 硬置 0 ⇒ 每次部署把线级 CPU 清零，
 * 机器自己永远产不出这个比值，只能靠角色普查近似。
 */
import { describe, expect, it } from "vitest";
import {
  emptyOpLedger,
  fromOpLedgerSnapshot,
  opNetDelivered,
  opNetRate,
  recordOpCpu,
  toOpLedgerSnapshot,
} from "../../../src/domain/remote/op-ledger";

const TICK = 100_000;

function ledgerWithCpu(cpu: number): ReturnType<typeof emptyOpLedger> {
  const l = emptyOpLedger(TICK);
  l.windowStart = TICK - 1000;
  l.delivered = 50_000;
  l.spawnCost = 20_000;
  l.infraCost = 5_000;
  // 走真实入口喂 CPU，而不是直接改字段：首样本直置、其后 EMA。
  recordOpCpu(l, cpu);
  return l;
}

describe("远矿账本：线级 CPU 跨 boot 存活", () => {
  it("快照往返保住 cpuPerTick（三位小数）", () => {
    const l = ledgerWithCpu(0.42);
    const snap = toOpLedgerSnapshot(l);
    expect(snap.c).toBe(0.42);
    expect(fromOpLedgerSnapshot(snap, TICK + 1).cpuPerTick).toBe(0.42);
  });

  it("恢复后能量与 CPU 同框 ⇒ 比值可由机器自己算出", () => {
    const restored = fromOpLedgerSnapshot(toOpLedgerSnapshot(ledgerWithCpu(0.25)), TICK + 1);
    const rate = opNetRate(restored, TICK + 1);
    expect(opNetDelivered(restored)).toBe(25_000);
    expect(rate).toBeGreaterThan(0);
    // 修复前 cpuPerTick 恒 0 ⇒ 这个除法式子按构造不可算。
    expect(restored.cpuPerTick).toBeGreaterThan(0);
    expect(rate / restored.cpuPerTick).toBeGreaterThan(0);
  });

  it("旧档无 c 字段时回退 0（不迁移、不报错）", () => {
    const legacy = { d: 10, s: 1, r: 0, i: 0, w: TICK - 5 } as never;
    expect(fromOpLedgerSnapshot(legacy, TICK).cpuPerTick).toBe(0);
  });

  it("畸形 CPU（NaN／负值）不落进快照也不被恢复成脏值", () => {
    const l = ledgerWithCpu(0.3);
    recordOpCpu(l, Number.NaN);
    recordOpCpu(l, -5);
    expect(toOpLedgerSnapshot(l).c).toBe(0.3);
    const dirty = { d: 1, s: 0, r: 0, i: 0, w: TICK, c: Number.NaN } as never;
    expect(fromOpLedgerSnapshot(dirty, TICK).cpuPerTick).toBe(0);
  });
});
