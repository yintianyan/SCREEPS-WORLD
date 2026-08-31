/** MV-4 回归 — moveTowardRoom/ensureHome 跨房修缮（审查补测试债）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureHome } from "../../../src/creeps/movement";
import { systemPhase } from "../../../src/kernel/phase";
import { CONFIG } from "../../../src/config";
import { mockCreep, resetGlobals } from "../../support/factories";

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

// ─── v33 — stepOffEdge 占用感知（边界格钉死修复）───────────────────

describe("v33 — stepOffEdge 内侧格占用感知", () => {
  /** 由坐标差计算方向常量。 */
  function dirBetween(fx: number, fy: number, tx: number, ty: number): number {
    const dx = Math.sign(tx - fx);
    const dy = Math.sign(ty - fy);
    const table: Record<string, number> = {
      "0,-1": 1, "1,-1": 2, "1,0": 3, "1,1": 4,
      "0,1": 5, "-1,1": 6, "-1,0": 7, "-1,-1": 8,
    };
    return table[dx + "," + dy] ?? 3;
  }

  /**
   * 边界 creep mock：lookForAt 按查询类型返回占用（creep / 结构）。
   * 结构 mock 只含 structureType + my 字段（stepOffEdge 只读这两个）。
   */
  function edgeCreepWithLook(
    x: number,
    y: number,
    look: (type: string, tx: number, ty: number) => any[],
  ): any {
    const creep = mockCreep({ name: "h_1", role: "hauler", home: "W7N4" });
    creep.pos = {
      ...creep.pos, x, y,
      getDirectionTo: vi.fn((tx: number, ty: number) => dirBetween(x, y, tx, ty)),
    };
    creep.room.name = "W7N4";
    creep.room.getTerrain = () => ({ get: () => 0 });
    creep.room.lookForAt = vi.fn(
      (type: string, tx: number, ty: number) => look(type, tx, ty),
    );
    return creep;
  }

  it("内侧首选格被 creep 占用：跳过并选下一个空闲内侧格（线上 W36S58 钉死场景）", () => {
    // 西边界 (0,28)：内侧候选顺序 (1,28)→(1,29)→(1,27)。
    // (1,28) 与 (1,27) 被停靠 hauler 占住 → 应落到 (1,29)。
    const creep = edgeCreepWithLook(0, 28, (type, tx, ty) => {
      if (type === "creep") {
        if ((tx === 1 && ty === 28) || (tx === 1 && ty === 27)) return [{ name: "blocker" }];
        return [];
      }
      return [];
    });
    expect(ensureHome(creep)).toBe(false);
    expect(creep.move).toHaveBeenCalledWith(4); // BOTTOM_RIGHT → (1,29)
  });

  it("内侧首选格被阻挡结构（wall）占用：跳过并选空闲格", () => {
    const creep = edgeCreepWithLook(0, 28, (type, tx, ty) => {
      if (type === "structure") {
        if (tx === 1 && ty === 28) return [{ structureType: "constructedWall", my: false }];
        return [];
      }
      return [];
    });
    expect(ensureHome(creep)).toBe(false);
    expect(creep.move).toHaveBeenCalledWith(4); // 跳过 wall 落 (1,29)
  });

  it("敌方 rampart 阻挡；我方 rampart 与 container 可通行（与 CostMatrix 同口径）", () => {
    const enemyRampart = edgeCreepWithLook(0, 28, (type, tx, ty) => {
      if (type === "structure" && tx === 1 && ty === 28) {
        return [{ structureType: "rampart", my: false }];
      }
      return [];
    });
    expect(ensureHome(enemyRampart)).toBe(false);
    expect(enemyRampart.move).toHaveBeenCalledWith(4);

    const myRampart = edgeCreepWithLook(0, 28, (type, tx, ty) => {
      if (type === "structure" && tx === 1 && ty === 28) {
        return [{ structureType: "rampart", my: true }];
      }
      return [];
    });
    expect(ensureHome(myRampart)).toBe(false);
    expect(myRampart.move).toHaveBeenCalledWith(3); // RIGHT → (1,28) 可通行

    const containerTile = edgeCreepWithLook(0, 28, (type, tx, ty) => {
      if (type === "structure" && tx === 1 && ty === 28) {
        return [{ structureType: "container", my: true }];
      }
      return [];
    });
    expect(ensureHome(containerTile)).toBe(false);
    expect(containerTile.move).toHaveBeenCalledWith(3);
  });

  it("全部内侧格被占用/阻挡：不盲移，返回 true 交还角色管线寻路绕行", () => {
    // 三个内侧候选全被 creep 占满 → stepOffEdge 放弃，管线用 PathFinder 绕行。
    const creep = edgeCreepWithLook(0, 28, (type, tx, ty) => {
      if (type === "creep" && tx === 1) return [{ name: "blocker" }];
      return [];
    });
    expect(ensureHome(creep)).toBe(true);
    expect(creep.move).not.toHaveBeenCalled();
  });

  it("mock 无 lookForAt：降级旧行为（能力守卫，内侧地形开放则直接内移）", () => {
    // 本 describe 内重建无 lookForAt 的边界 creep（首组 describe 的 edgeCreep 不在作用域）。
    const creep = mockCreep({ name: "h_1", role: "hauler", home: "W7N4" });
    creep.pos = { ...creep.pos, x: 0, y: 25, getDirectionTo: vi.fn(() => 3) };
    creep.room.name = "W7N4";
    creep.room.getTerrain = () => ({ get: () => 0 });
    expect(ensureHome(creep)).toBe(false);
    expect(creep.move).toHaveBeenCalled();
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
