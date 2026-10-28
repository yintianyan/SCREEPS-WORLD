/** R647：低容量房（RCL1-2）不持有恢复预留 — 纯函数钳位。 */
import { describe, expect, it } from "vitest";
import {
  recoveryRoomDegradeAllowed,
  spawnReserveFor,
} from "../../../src/systems/room/spawn-manager";

describe("spawnReserveFor — 低容量房预留钳位（R647）", () => {
  it("RCL1-2（容量 300）⇒ 预留归零（否则 200/300 会孵不出任何非采集者）", () => {
    expect(spawnReserveFor(300, 200)).toBe(0);
  });

  it("容量 399 仍在钳位带内", () => {
    expect(spawnReserveFor(399, 200)).toBe(0);
  });

  it("容量 400 起保留原预留（RCL3+ 行为不变）", () => {
    expect(spawnReserveFor(400, 200)).toBe(200);
  });

  it("RCL4+（容量 550/1300）保留原预留", () => {
    expect(spawnReserveFor(550, 200)).toBe(200);
    expect(spawnReserveFor(1300, 200)).toBe(200);
  });

  it("无预留时不受影响", () => {
    expect(spawnReserveFor(300, 0)).toBe(0);
    expect(spawnReserveFor(1300, 0)).toBe(0);
  });
});

describe("recoveryRoomDegradeAllowed — 恢复态全优先级降级（R647）", () => {
  it("bootstrap / recovery ⇒ 允许（P2 hauler 也能出最小 body）", () => {
    expect(recoveryRoomDegradeAllowed("bootstrap")).toBe(true);
    expect(recoveryRoomDegradeAllowed("recovery")).toBe(true);
  });

  it("normal / defense ⇒ 不允许（保持原 P2 饥饿双条件）", () => {
    expect(recoveryRoomDegradeAllowed("normal")).toBe(false);
    expect(recoveryRoomDegradeAllowed("defense")).toBe(false);
  });
});
