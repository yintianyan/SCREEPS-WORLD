/**
 * 目标清单布局闭环 — 单一真相源派生 + 缺口审计器测试（2026-08-01）。
 *
 * 病灶背景（W7N3 实证）：
 *   旧手写 RCL_BATCHES 缺 observer/powerSpawn → 线上三房全缺；
 *   placeStructures 的 shortfall 只打 console 日志 → 放不下时静默空转。
 *
 * 覆盖：
 *   1. expectedStructureCounts 与 CONTROLLER_STRUCTURES 全量等价
 *      （observer/powerSpawn 不再是手写表遗漏）
 *   2. buildRclBatches 增量派生与累计期望一致、旧表类型数量不回退
 *   3. auditStructureGaps：已建 / site / queued / blocked 同口径抵扣，
 *      done/site 状态任务不双计，缺口字典只收 >0 类型
 */
import { describe, expect, it } from "vitest";
import {
  auditStructureGaps,
} from "../../../src/domain/layout/gaps";
import {
  buildRclBatches,
  expectedStructureCounts,
  type StructureBatch,
} from "../../../src/domain/layout/constraint-placer";
import { mockSnapshot, mockStructure, mockConstructionSite } from "../../role-helpers";

/** constraint-placer 负责放置的类型（与模块内 CONSTRAint_PLACED_TYPES 对齐）。 */
const CONSTRAINT_TYPES: BuildableStructureConstant[] = [
  STRUCTURE_SPAWN,
  STRUCTURE_EXTENSION,
  STRUCTURE_TOWER,
  STRUCTURE_STORAGE,
  STRUCTURE_LAB,
  STRUCTURE_TERMINAL,
  STRUCTURE_FACTORY,
  STRUCTURE_OBSERVER,
  STRUCTURE_POWER_SPAWN,
  STRUCTURE_NUKER,
];

describe("constraint-placer — 单一真相源派生（CONTROLLER_STRUCTURES）", () => {
  it("expectedStructureCounts 与游戏常量全量等价（RCL2-8，全类型）", () => {
    for (let rcl = 2; rcl <= 8; rcl++) {
      const counts = expectedStructureCounts(rcl);
      for (const type of CONSTRAINT_TYPES) {
        const expected = CONTROLLER_STRUCTURES[type]?.[rcl] ?? 0;
        expect(counts[type], `${type}@RCL${rcl}`).toBe(expected);
      }
    }
  });

  it("RCL8 包含 observer/powerSpawn/nuker（旧手写表漏掉的类型）", () => {
    const counts = expectedStructureCounts(8);
    expect(counts[STRUCTURE_OBSERVER]).toBe(1);
    expect(counts[STRUCTURE_POWER_SPAWN]).toBe(1);
    expect(counts[STRUCTURE_NUKER]).toBe(1);
  });

  it("buildRclBatches 增量合计 == 累计期望（每 RCL 全类型）", () => {
    for (let rcl = 2; rcl <= 8; rcl++) {
      const batches = buildRclBatches(rcl);
      const totals: Record<string, number> = {};
      for (const b of batches) {
        totals[b.type] = (totals[b.type] ?? 0) + b.count;
      }
      const expected = expectedStructureCounts(rcl);
      for (const type of CONSTRAINT_TYPES) {
        // 锚点 spawn 豁免：批次从第 2 个 spawn 开始派生（锚点由玩家/扩张放置）。
        const batchExpected = type === STRUCTURE_SPAWN
          ? Math.max(0, (expected[type] ?? 0) - 1)
          : expected[type] ?? 0;
        expect(totals[type] ?? 0, `${type}@RCL${rcl}`).toBe(batchExpected);
      }
    }
  });

  it("增量批次逐级正确（extension/tower/spawn/lab 分布与旧表一致）", () => {
    // RCL2..8 的 extension 增量 = 5,5,10,10,10,10,10（旧手写表数量不回退）
    const extByRcl = new Map<number, number>();
    const towerByRcl = new Map<number, number>();
    const spawnByRcl = new Map<number, number>();
    const labByRcl = new Map<number, number>();
    let prevExt = 0;
    let prevTower = 0;
    let prevSpawn = 0;
    let prevLab = 0;
    for (let rcl = 2; rcl <= 8; rcl++) {
      const batches = buildRclBatches(rcl);
      const sum = (type: string): number =>
        batches.filter((b: StructureBatch) => b.type === type)
          .reduce((acc, b) => acc + b.count, 0);
      extByRcl.set(rcl, sum(STRUCTURE_EXTENSION) - prevExt);
      towerByRcl.set(rcl, sum(STRUCTURE_TOWER) - prevTower);
      spawnByRcl.set(rcl, sum(STRUCTURE_SPAWN) - prevSpawn);
      labByRcl.set(rcl, sum(STRUCTURE_LAB) - prevLab);
      prevExt = sum(STRUCTURE_EXTENSION);
      prevTower = sum(STRUCTURE_TOWER);
      prevSpawn = sum(STRUCTURE_SPAWN);
      prevLab = sum(STRUCTURE_LAB);
    }
    expect([...extByRcl.values()]).toEqual([5, 5, 10, 10, 10, 10, 10]);
    // RCL8 解锁 +3（官方上限 6）→ 批次 rcl3=1、rcl5=1、rcl7=1、rcl8=3。
    expect([...towerByRcl.values()]).toEqual([0, 1, 0, 1, 0, 1, 3]);
    // 锚点 spawn 豁免：RCL7 解锁第 2 个、RCL8 解锁第 3 个 → 批次在 rcl7/rcl8 各 1。
    expect([...spawnByRcl.values()]).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect([...labByRcl.values()]).toEqual([0, 0, 0, 0, 3, 3, 4]);
  });
});

describe("auditStructureGaps — 缺口审计器", () => {
  it("空房间 RCL3：缺口 = 全量期望（spawn/ext/tower）", () => {
    const snap = mockSnapshot({ rcl: 3, spawns: [], extensions: [], towers: [] });
    const gaps = auditStructureGaps(snap, []);
    expect(gaps[STRUCTURE_SPAWN]).toBe(1);
    expect(gaps[STRUCTURE_EXTENSION]).toBe(CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION]![3]);
    expect(gaps[STRUCTURE_TOWER]).toBe(1);
  });

  it("已建 + site + queued/blocked 同口径抵扣（与 computeCommittedCounts 一致）", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    spawn.pos = { x: 25, y: 25, roomName: "W7N4" } as any;
    const ext1 = mockStructure("extension", { id: "e1" });
    ext1.pos = { x: 26, y: 25, roomName: "W7N4" } as any;
    const site = mockConstructionSite("extension");
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      extensions: [ext1 as any],
      myConstructionSites: [site as any],
    });
    const queue: BuildTask[] = [
      {
        key: "constraint.extension.27.25",
        pos: { x: 27, y: 25, roomName: "W7N4" },
        structureType: STRUCTURE_EXTENSION,
        priority: 2,
        state: "queued",
        attempts: 0,
        retryAt: 0,
      },
      {
        key: "constraint.extension.28.25",
        pos: { x: 28, y: 25, roomName: "W7N4" },
        structureType: STRUCTURE_EXTENSION,
        priority: 2,
        state: "blocked",
        attempts: 1,
        retryAt: 2000,
      },
    ];
    const gaps = auditStructureGaps(snap, queue);
    // 期望 10 - 已建 1 - site 1 - queued 1 - blocked 1 = 6
    expect(gaps[STRUCTURE_EXTENSION]).toBe(6);
    expect(gaps[STRUCTURE_SPAWN]).toBeUndefined(); // 已建
    expect(gaps[STRUCTURE_TOWER]).toBe(1);
  });

  it("site/done 状态任务不双计（实体 site / 已建结构已覆盖）", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    spawn.pos = { x: 25, y: 25, roomName: "W7N4" } as any;
    const ext1 = mockStructure("extension", { id: "e1" });
    ext1.pos = { x: 26, y: 25, roomName: "W7N4" } as any;
    const site = mockConstructionSite("extension");
    const snap = mockSnapshot({
      rcl: 3,
      spawns: [spawn as any],
      extensions: [ext1 as any],
      myConstructionSites: [site as any],
    });
    // done 任务对应已建结构（ext1），site 任务对应实体 site — 都不应再抵扣
    const queue: BuildTask[] = [
      {
        key: "constraint.extension.26.25",
        pos: { x: 26, y: 25, roomName: "W7N4" },
        structureType: STRUCTURE_EXTENSION,
        priority: 2,
        state: "done",
        attempts: 0,
        retryAt: 0,
      },
      {
        key: "constraint.extension.27.25",
        pos: { x: 27, y: 25, roomName: "W7N4" },
        structureType: STRUCTURE_EXTENSION,
        priority: 2,
        state: "site",
        attempts: 0,
        retryAt: 0,
      },
    ];
    const gaps = auditStructureGaps(snap, queue);
    expect(gaps[STRUCTURE_EXTENSION]).toBe(8); // 10 - 已建 1 - site 1
  });

  it("RCL8：observer/powerSpawn/nuker 已建则无缺口，未建则有缺口", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    spawn.pos = { x: 25, y: 25, roomName: "W7N4" } as any;
    const observer = mockStructure("observer", { id: "obs" });
    const nuker = mockStructure("nuker", { id: "nuk" });
    const snap = mockSnapshot({
      rcl: 8,
      spawns: [spawn as any],
      observer: observer as any,
      nuker: nuker as any,
      // powerSpawn 故意缺
    });
    const gaps = auditStructureGaps(snap, []);
    expect(gaps[STRUCTURE_OBSERVER]).toBeUndefined();
    expect(gaps[STRUCTURE_POWER_SPAWN]).toBe(1);
    expect(gaps[STRUCTURE_NUKER]).toBeUndefined();
  });

  it("期望为 0 的类型（如 RCL3 的 observer）不进入缺口字典", () => {
    const spawn = mockStructure("spawn", { id: "sp" });
    const snap = mockSnapshot({ rcl: 3, spawns: [spawn as any] });
    const gaps = auditStructureGaps(snap, []);
    expect(gaps[STRUCTURE_OBSERVER]).toBeUndefined();
    expect(Object.keys(gaps)).not.toContain(STRUCTURE_OBSERVER);
  });

  it("缺口字典只收 >0 类型（不出现 0 值）", () => {
    const snap = mockSnapshot({ rcl: 8 });
    const gaps = auditStructureGaps(snap, []);
    const allPositive = Object.values(gaps).every(v => v > 0);
    expect(allPositive).toBe(true);
    const expected = expectedStructureCounts(8);
    expect(Object.keys(gaps).length).toBe(
      Object.keys(expected).filter(t => (expected[t] ?? 0) > 0).length,
    );
  });
});
