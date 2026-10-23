/** 和平期墙体维护批次：受袭逐拍、和平期每 10 拍一次（按房名错峰）。 */
import { describe, expect, it } from "vitest";
import {
  WALL_MAINTENANCE_INTERVAL,
  wallMaintenanceDue,
} from "../../../src/systems/military/tower-defense";

describe("wallMaintenanceDue", () => {
  it("受袭时逐拍执行（批次被绕过）", () => {
    for (let t = 1000; t < 1010; t++) {
      expect(wallMaintenanceDue("W7N4", t, true)).toBe(true);
    }
  });

  it("和平期 20 拍内恰好 2 拍到期，且间隔 = WALL_MAINTENANCE_INTERVAL", () => {
    const due: number[] = [];
    for (let t = 1000; t < 1020; t++) {
      if (wallMaintenanceDue("W7N4", t, false)) due.push(t);
    }
    expect(due).toHaveLength(2);
    expect(due[1]! - due[0]!).toBe(WALL_MAINTENANCE_INTERVAL);
  });

  it("按房名错峰：不同房在同一拍不同时到期（至少有一对不同相）", () => {
    const a = wallMaintenanceDue("W7N4", 1000, false);
    const b = wallMaintenanceDue("W7N5", 1000, false);
    const c = wallMaintenanceDue("W8N4", 1000, false);
    expect([a, b, c].some(v => !v)).toBe(true);
  });
});
