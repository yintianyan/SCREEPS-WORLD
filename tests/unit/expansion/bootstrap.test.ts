/** 新生殖民地自举决策回归测试（W38S59 事故驱动）。 */
import { describe, expect, it } from "vitest";
import {
  decideBootstrapRooms,
  ABANDON_TTD_THRESHOLD,
  BOOTSTRAP_COOLDOWN_TICKS,
  type BootstrapLedger,
} from "../../../src/domain/expansion/bootstrap";

const TICK = 50000;

function ledgerWith(e: BootstrapLedger[string]): BootstrapLedger {
  return { W38S59: e };
}

describe("bootstrap — 自举决策", () => {
  it("无 spawn 房 → dispatch 最近 sponsor，冷却与波次入账", () => {
    const { decisions, ledgerUpdates } = decideBootstrapRooms({
      tick: TICK,
      rooms: [{ room: "W38S59", ttd: 15000, hostileCount: 0, sponsor: { room: "W37S58", capacityAvailable: 5600 } }],
      ledger: {},
    });
    expect(decisions[0]).toMatchObject({ action: "dispatch", sponsor: "W37S58" });
    expect(ledgerUpdates.W38S59).toEqual({ until: TICK + BOOTSTRAP_COOLDOWN_TICKS, waves: 1 });
  });

  it("冷却期内 → none（不重复投喂）", () => {
    const { decisions } = decideBootstrapRooms({
      tick: TICK,
      rooms: [{ room: "W38S59", ttd: 15000, hostileCount: 0, sponsor: { room: "W37S58", capacityAvailable: 5600 } }],
      ledger: ledgerWith({ until: TICK + 100, waves: 1 }),
    });
    expect(decisions[0]).toMatchObject({ action: "none", reason: "cooldown" });
  });

  it("TTD 危急 + 敌情 → abandon 永久标记", () => {
    const { decisions, ledgerUpdates } = decideBootstrapRooms({
      tick: TICK,
      rooms: [{ room: "W38S59", ttd: ABANDON_TTD_THRESHOLD - 1, hostileCount: 1, sponsor: { room: "W37S58", capacityAvailable: 5600 } }],
      ledger: {},
    });
    expect(decisions[0]).toMatchObject({ action: "abandon" });
    expect(ledgerUpdates.W38S59?.abandoned).toBe(TICK);
    // 后续 tick 永久跳过
    const again = decideBootstrapRooms({
      tick: TICK + 5000,
      rooms: [{ room: "W38S59", ttd: 100, hostileCount: 1, sponsor: { room: "W37S58", capacityAvailable: 5600 } }],
      ledger: ledgerWith(ledgerUpdates.W38S59),
    });
    expect(again.decisions[0]).toMatchObject({ action: "none", reason: "abandoned" });
  });

  it("TTD 危急但无敌情 → 不弃房，照常 dispatch（和平降级可逆）", () => {
    const { decisions } = decideBootstrapRooms({
      tick: TICK,
      rooms: [{ room: "W38S59", ttd: ABANDON_TTD_THRESHOLD - 1, hostileCount: 0, sponsor: { room: "W37S58", capacityAvailable: 5600 } }],
      ledger: {},
    });
    expect(decisions[0]?.action).toBe("dispatch");
  });

  it("sponsor 容量不足 → no-capacity-sponsor", () => {
    const { decisions } = decideBootstrapRooms({
      tick: TICK,
      rooms: [{ room: "W38S59", ttd: 15000, hostileCount: 0, sponsor: { room: "W37S58", capacityAvailable: 800 } }],
      ledger: {},
    });
    expect(decisions[0]).toMatchObject({ action: "none", reason: "no-capacity-sponsor" });
  });

  it("无 sponsor → none 且不抛错", () => {
    const { decisions } = decideBootstrapRooms({
      tick: TICK,
      rooms: [{ room: "W38S59", ttd: 15000, hostileCount: 0 }],
      ledger: {},
    });
    expect(decisions[0]).toMatchObject({ action: "none", reason: "no-capacity-sponsor" });
  });
});
