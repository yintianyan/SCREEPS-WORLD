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
  auditLinkRoleGaps,
  expectedLinkRoleCounts,
  mergeLinkRoleGaps,
} from "../../../src/domain/layout/gaps";
import {
  buildRclBatches,
  expectedStructureCounts,
  type StructureBatch,
} from "../../../src/domain/layout/constraint-placer";
import type { RoomSnapshot } from "../../../src/kernel/contracts";
import { mockSnapshot, mockStructure, mockConstructionSite, mockSource, mockController } from "../../role-helpers";

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

// ─── link 角色感知（2026-08-02）──
//
// 病灶（W3N7 RCL5 实证）：2 个 source link 死资产骗过 `auditStructureGaps`
// （总数满足 CONTROLLER_STRUCTURES[link][5]=2 → link 缺口 0），但 controller
// link 缺失导致升级链断裂。角色感知让死资产暴露真实缺口。

describe("expectedLinkRoleCounts — MVC link 角色期望表", () => {
  it("RCL<5：全 0（link 未解锁）", () => {
    for (let rcl = 0; rcl < 5; rcl++) {
      const e = expectedLinkRoleCounts(rcl, 2);
      expect(e).toEqual({ source: 0, controller: 0, storage: 0, hub: 0 });
    }
  });

  it("RCL5 双 source：source=1, controller=1, storage=0, hub=0", () => {
    expect(expectedLinkRoleCounts(5, 2)).toEqual({ source: 1, controller: 1, storage: 0, hub: 0 });
  });

  it("RCL6 双 source：+storage=1", () => {
    expect(expectedLinkRoleCounts(6, 2)).toEqual({ source: 1, controller: 1, storage: 1, hub: 0 });
  });

  it("RCL8 双 source：source=2, hub=2", () => {
    expect(expectedLinkRoleCounts(8, 2)).toEqual({ source: 2, controller: 1, storage: 1, hub: 2 });
  });

  it("RCL8 单 source：source 期望受 min(2, sources) 约束 → 1", () => {
    expect(expectedLinkRoleCounts(8, 1)).toEqual({ source: 1, controller: 1, storage: 1, hub: 2 });
  });
});

describe("auditLinkRoleGaps — link 角色缺口审计", () => {
  /** 构造紧邻锚点的 link mock（Chebyshev≤2 → 角色命中）。 */
  function linkAt(x: number, y: number, id: string): any {
    const link = mockStructure("link", { id });
    link.pos = { x, y, roomName: "W7N4" };
    return link;
  }

  /** 双 source + controller + storage 的 snapshot，位置分散避免角色重叠。 */
  function snapshotWithAnchors(rcl: number, links: any[]): RoomSnapshot {
    const src1 = mockSource("src1");
    src1.pos = { x: 10, y: 10, roomName: "W7N4" };
    const src2 = mockSource("src2");
    src2.pos = { x: 40, y: 40, roomName: "W7N4" };
    const ctrl = mockController({ level: rcl });
    ctrl.pos = { x: 20, y: 20, roomName: "W7N4" };
    const storage = mockStructure("storage", { id: "stor1" });
    storage.pos = { x: 30, y: 30, roomName: "W7N4" };
    return mockSnapshot({
      rcl,
      controller: ctrl,
      sources: [src1, src2],
      storage: storage as any,
      links: links as any,
    });
  }

  it("空房 RCL5：source=1, controller=1 缺口（无任何 link）", () => {
    const snap = snapshotWithAnchors(5, []);
    const gaps = auditLinkRoleGaps(snap, []);
    expect(gaps).toEqual({ source: 1, controller: 1, storage: 0, hub: 0 });
  });

  it("W3N7 死资产场景：RCL5 有 2 source link，controller link 缺失 → controller 缺口 1", () => {
    // 2 个 source link 紧邻 src1/src2 → 角色均为 source（死资产，但总数满足）
    const link1 = linkAt(10, 11, "link_src1");
    const link2 = linkAt(40, 41, "link_src2");
    const snap = snapshotWithAnchors(5, [link1, link2]);
    const gaps = auditLinkRoleGaps(snap, []);
    // source 期望 1，已有 2 → max(0, 1-2)=0（不报负数）
    // controller 期望 1，已有 0 → 缺口 1（暴露真实需求）
    expect(gaps).toEqual({ source: 0, controller: 1, storage: 0, hub: 0 });
  });

  it("RCL5 完美配置：1 source + 1 controller → 全 0 缺口", () => {
    const srcLink = linkAt(10, 11, "link_src");
    const ctrlLink = linkAt(20, 21, "link_ctrl");
    const snap = snapshotWithAnchors(5, [srcLink, ctrlLink]);
    const gaps = auditLinkRoleGaps(snap, []);
    expect(gaps).toEqual({ source: 0, controller: 0, storage: 0, hub: 0 });
  });

  it("RCL6 缺 storage link → storage 缺口 1", () => {
    const srcLink = linkAt(10, 11, "link_src");
    const ctrlLink = linkAt(20, 21, "link_ctrl");
    const snap = snapshotWithAnchors(6, [srcLink, ctrlLink]);
    const gaps = auditLinkRoleGaps(snap, []);
    expect(gaps).toEqual({ source: 0, controller: 0, storage: 1, hub: 0 });
  });

  it("队列中 queued link 任务计入 have（按 pos 几何分类）", () => {
    const srcLink = linkAt(10, 11, "link_src");
    const snap = snapshotWithAnchors(5, [srcLink]);
    // 队列中有 controller link 任务（pos 紧邻 controller）
    const queue: BuildTask[] = [{
      key: "logistics.link.controller",
      pos: { x: 20, y: 21, roomName: "W7N4" },
      structureType: STRUCTURE_LINK,
      priority: 1,
      state: "queued",
      attempts: 0,
      retryAt: 0,
    }];
    const gaps = auditLinkRoleGaps(snap, queue);
    // controller 缺口已由 queued 任务闭合 → 0
    expect(gaps).toEqual({ source: 0, controller: 0, storage: 0, hub: 0 });
  });

  it("队列中 done/site 状态任务不计入（避免双计，与 auditStructureGaps 同口径）", () => {
    const srcLink = linkAt(10, 11, "link_src");
    const snap = snapshotWithAnchors(5, [srcLink]);
    const queue: BuildTask[] = [
      {
        key: "logistics.link.controller",
        pos: { x: 20, y: 21, roomName: "W7N4" },
        structureType: STRUCTURE_LINK,
        priority: 1,
        state: "done",
        attempts: 0,
        retryAt: 0,
      },
      {
        key: "logistics.link.controller.site",
        pos: { x: 20, y: 22, roomName: "W7N4" },
        structureType: STRUCTURE_LINK,
        priority: 1,
        state: "site",
        attempts: 0,
        retryAt: 0,
      },
    ];
    const gaps = auditLinkRoleGaps(snap, queue);
    // done/site 不计入 → controller 仍缺 1
    expect(gaps.controller).toBe(1);
  });

  it("远离所有锚点的 link 分类为 hub（RCL8 hub 期望 2）", () => {
    // (5,5) 远离 src(10,10)/ctrl(20,20)/stor(30,30) → hub
    const hubLink = linkAt(5, 5, "link_hub");
    const snap = snapshotWithAnchors(8, [hubLink]);
    const gaps = auditLinkRoleGaps(snap, []);
    // RCL8 期望 hub=2，已有 1 → 缺口 1
    expect(gaps.hub).toBe(1);
  });
});

describe("mergeLinkRoleGaps — 合并角色缺口到 StructureGaps", () => {
  it("角色缺口全 0：保持 STRUCTURE_LINK 总缺口不变", () => {
    const gaps: Record<string, number> = { [STRUCTURE_LINK]: 1 };
    mergeLinkRoleGaps(gaps, { source: 0, controller: 0, storage: 0, hub: 0 });
    expect(gaps).toEqual({ [STRUCTURE_LINK]: 1 });
  });

  it("角色缺口存在：删除 STRUCTURE_LINK 总缺口，加入 linkXxx key（避免双重计数）", () => {
    const gaps: Record<string, number> = { [STRUCTURE_LINK]: 1 };
    mergeLinkRoleGaps(gaps, { source: 0, controller: 1, storage: 0, hub: 0 });
    expect(gaps[STRUCTURE_LINK]).toBeUndefined();
    expect(gaps.linkController).toBe(1);
  });

  it("死资产场景：gaps 空字典 + controller 缺口 → 暴露 linkController", () => {
    const gaps: Record<string, number> = {};
    mergeLinkRoleGaps(gaps, { source: 0, controller: 1, storage: 0, hub: 0 });
    expect(gaps).toEqual({ linkController: 1 });
  });

  it("多角色缺口同时存在：全部收录", () => {
    const gaps: Record<string, number> = { [STRUCTURE_LINK]: 2 };
    mergeLinkRoleGaps(gaps, { source: 1, controller: 1, storage: 0, hub: 0 });
    expect(gaps[STRUCTURE_LINK]).toBeUndefined();
    expect(gaps.linkSource).toBe(1);
    expect(gaps.linkController).toBe(1);
  });

  it("不收录 0 值角色缺口（缺口字典只收 >0）", () => {
    const gaps: Record<string, number> = {};
    mergeLinkRoleGaps(gaps, { source: 0, controller: 1, storage: 0, hub: 0 });
    expect(gaps).not.toHaveProperty("linkSource");
    expect(gaps).not.toHaveProperty("linkStorage");
    expect(gaps).not.toHaveProperty("linkHub");
    expect(gaps.linkController).toBe(1);
  });
});
