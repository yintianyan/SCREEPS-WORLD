/**
 * 扩张仪表的一条不变量：**摘要行与 failedGates 数组必须是同一次运行的同一份事实**。
 * 立案理由：读扩张为什么不 READY 时，`Blocked=` 是唯一一行给人看的东西；而 Memory 里的
 * failedGates 数组只有闸门名，不带实测值 —— 于是 "G4: net flow" 分不清「差一点」与
 * 「差一个数量级」，动作完全不同却读成同一个词（本会话就差点据此去优化错的那一道闸）。
 */
import { describe, expect, it } from "vitest";
import { buildExpansionDashboard } from "../../../src/domain/expansion/dashboard";
import type { ExpansionGate } from "../../../src/domain/strategy/readiness";

function dashboardWith(gates: ExpansionGate[]): ReturnType<typeof buildExpansionDashboard> {
  return buildExpansionDashboard({
    tick: 1000,
    pressure: { level: "HIGH", score: 0.7, dimensions: {} } as never,
    readiness: {
      readiness: "NOT_READY",
      evidence: "…",
      gates,
    } as never,
    budget: { availableExpansion: 100, totalEnergy: 200, coreInvaded: false } as never,
    candidates: [] as never,
    plans: [] as never,
  });
}

const failing = (name: string, value: string, condition: string): ExpansionGate =>
  ({ name, passed: false, value, condition }) as ExpansionGate;

describe("扩张仪表：闸门明细要自带实测值，且与摘要行同源", () => {
  it("failedGates 每条都带 v= 与判据，读一条就知道差多少", () => {
    const d = dashboardWith([
      failing("G4: net flow", "-27.9", ">=5"),
      failing("G6: CPU tier", "tight", "<=comfortable"),
    ]);
    expect(d.readiness.failedGates).toEqual([
      "G4: net flow(v=-27.9|>=5)",
      "G6: CPU tier(v=tight|<=comfortable)",
    ]);
  });

  it("摘要行的 Blocked 由同一份数组派生：条数与代号必须一致", () => {
    const d = dashboardWith([
      failing("G3: economic health", "stable", ">=growing"),
      failing("G4: net flow", "-27.9", ">=5"),
      failing("G7: expansion budget", "1200", ">=2000"),
    ]);
    const blocked = /Blocked=([^|]*)/.exec(d.summary)?.[1]?.trim() ?? "";
    expect(blocked.split("+")).toEqual(["G3", "G4", "G7"]);
    expect(d.readiness.failedGates).toHaveLength(3);
  });

  it("全通过时摘要行写 none（不留一个空值让人猜是没跑还是全过）", () => {
    const d = dashboardWith([{ name: "G1: no live threat", passed: true }] as ExpansionGate[]);
    expect(d.readiness.failedGates).toEqual([]);
    expect(d.summary).toContain("Blocked=none");
  });
});
