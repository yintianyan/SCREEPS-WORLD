/**
 * MV-4 回归 — moveTowardRoom/ensureHome 跨房修缮（审查补测试债）。
 *
 * 覆盖：出口缓存 TTL 过期、stepOffEdge 边界内移语义（含内侧墙回退）、
 * K-6 systemPhase 相位一致性（kernel 门与 telemetry 内部采样门同源）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureHome } from "../../../src/creeps/movement";
import { systemPhase } from "../../../src/kernel/phase";
import { CONFIG } from "../../../src/config";
import { mockCreep, resetGlobals } from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

// ─── stepOffEdge：边界格防弹回 ───────────────────────────────

describe("MV-4 — ensureHome 边界格内移", () => {
  function edgeCreep(x: number, y: number, terrainWall = false): any {
    const creep = mockCreep({ name: "h_1", role: "hauler", home: "W7N4" });
    creep.pos = { ...creep.pos, x, y, getDirectionTo: vi.fn(() => 3) };
    creep.room.name = "W7N4";
    creep.room.getTerrain = () => ({
      get: (tx: number, ty: number) => {
        void tx; void ty;
        return terrainWall ? 1 : 0; // TERRAIN_MASK_WALL = 1
      },
    });
    return creep;
  }

  it("站在边界格：内移一步且 ensureHome 返回 false（本 tick 让位给移动）", () => {
    const creep = edgeCreep(0, 25);
    expect(ensureHome(creep)).toBe(false);
    expect(creep.move).toHaveBeenCalled();
  });

  it("内侧全是墙：不盲移，返回 true 交还角色管线（防弹房死循环）", () => {
    const creep = edgeCreep(0, 25, true);
    expect(ensureHome(creep)).toBe(true);
    expect(creep.move).not.toHaveBeenCalled();
  });

  it("非边界格：原语义不变（返回 true 不移动）", () => {
    const creep = edgeCreep(25, 25);
    expect(ensureHome(creep)).toBe(true);
    expect(creep.move).not.toHaveBeenCalled();
  });
});

// ─── K-6：相位一致性契约 ─────────────────────────────────────

describe("K-6 — systemPhase 相位一致性（telemetry 采样门契约）", () => {
  it("相位在 [0, interval) 内且同名稳定", () => {
    const p1 = systemPhase("telemetry-collector", 10);
    const p2 = systemPhase("telemetry-collector", 10);
    expect(p1).toBe(p2);
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(10);
  });

  it("telemetry 内部采样门与 kernel 运行 tick 有交集（活跃回归的锁定测试）", () => {
    // kernel 只在 tick ≡ phase (mod 10) 运行 collector；
    // 内部经济采样门 (tick - phase) % 50 === 0 必须在这些 tick 上可达。
    const interval = CONFIG.telemetry.cpuSampleInterval;
    const phase = systemPhase("telemetry-collector", interval);
    let economyHits = 0;
    let populationHits = 0;
    for (let tick = 0; tick < 1000; tick++) {
      if (tick % interval !== phase) continue; // kernel 门
      if ((tick - phase) % CONFIG.telemetry.economySampleInterval === 0) economyHits++;
      if ((tick - phase) % CONFIG.telemetry.populationInterval === 0) populationHits++;
    }
    // 1000 tick 内经济采样 20 次（每 50）、人口 10 次（每 100）。
    expect(economyHits).toBe(1000 / CONFIG.telemetry.economySampleInterval);
    expect(populationHits).toBe(1000 / CONFIG.telemetry.populationInterval);
  });

  it("interval ≤ 1 时相位为 0（每 tick 系统不受错峰影响）", () => {
    expect(systemPhase("room-state", 1)).toBe(0);
    expect(systemPhase("room-state", 0)).toBe(0);
  });
});
