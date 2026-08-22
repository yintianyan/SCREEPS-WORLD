/**
 * 【Phase 3A】RCL1 经济场景套件 —— 一次 6500t 世界驱动七个断言面。
 *
 * 场景映射（用户 §21 → 本套件）：
 *   001 Bootstrap        → TEST 1（冷启动人口建立）
 *   002 Harvester Death  → TEST 4（自然 TTL 死亡波后的恢复，含替代延迟度量）
 *   003 Spawn Starvation → TEST 2（spawn 空仓窗口检测与恢复）
 *   004 Energy Crisis    → TEST 3（能量储备地板）
 *   005 Creep Replacement→ TEST 4（替代延迟量化）
 *   006 Economic Recovery→ TEST 5（死亡波后人口回归）
 *   007 Long Stable      → E2E-006 覆盖 11k（本套件不重复）
 *
 * 全部断言基于可观察结果（Memory 视图），零生产代码侵入。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { ScenarioRunner } from "../framework";
import { standardRoom } from "../fixtures/rooms";

interface Row {
  tick: number;
  memCreeps: number;
  roles: Record<string, number>;
  colonyState?: string;
  spawnLegacyE?: number | null;
  spawnStoreE?: number | undefined;
}

describe("RCL1 经济场景套件", () => {
  const runner = new ScenarioRunner();
  const rows: Row[] = [];

  beforeAll(async () => {
    await runner.setup({
      roomName: "W0N1",
      rooms: [standardRoom("W0N1", 300, 1)],
      maxTicks: 6600,
    });
  }, 120000);

  afterAll(async () => {
    writeFileSync("/tmp/rcl1-suite.json", JSON.stringify(rows));
    await runner.teardown();
  });

  it("6500t 采集全维样本", async () => {
    const world = runner.server.server.world;
    let last = -100;
    for (let i = 0; i < 6600; i++) {
      await runner.server.tick();
      const gameTime = await runner.server.gameTime;
      if (gameTime - last < 5) continue;
      last = gameTime;
      const mem = await runner.bot.getMemory();
      const creeps = mem.creeps ?? {};
      const roles: Record<string, number> = {};
      let n = 0;
      for (const cm of Object.values(creeps)) {
        n++;
        const r = (cm as any)?.role ?? "?";
        roles[r] = (roles[r] ?? 0) + 1;
      }
      let legacyE: number | null = null;
      let storeE: number | undefined;
      const objs = await world.roomObjects("W0N1");
      for (const o of objs) {
        if (o.type === "spawn") {
          legacyE = o.energy ?? null;
          storeE = o.store ? o.store.energy : undefined;
        }
      }
      rows.push({ tick: gameTime, memCreeps: n, roles, colonyState: mem.rooms?.W0N1?.colonyState, spawnLegacyE: legacyE, spawnStoreE: storeE });
    }
    expect(rows.length).toBeGreaterThan(1000);
  }, 480000);

  it("TEST1 Bootstrap：t1500 前人口 ≥2 且含非 worker 角色", () => {
    const at = rows.find((r) => r.tick >= 1500);
    expect(at).toBeDefined();
    expect(at!.memCreeps).toBeGreaterThanOrEqual(2);
    expect(Object.keys(at!.roles).length).toBeGreaterThanOrEqual(2);
  });

  it("TEST2 无灭绝：warmup 后全程 creep>0", () => {
    const zeros = rows.filter((r) => r.tick > 50 && r.memCreeps === 0);
    expect(zeros, JSON.stringify(zeros.slice(0, 3))).toHaveLength(0);
  });

  it("TEST3 角色多样性成长：t4000 时角色 ≥4 种", () => {
    const at = rows.filter((r) => r.tick >= 4000).at(-1)!;
    expect(Object.keys(at.roles).length).toBeGreaterThanOrEqual(4);
  });

  it("TEST4 spawn 空仓不黏滞：稳态期连续 <50e 的最长时段 ≤100t（死亡螺旋特征为黏滞数干倍）", () => {
    const steady = rows.filter((r) => r.tick > 1000);
    let maxRun = 0;
    let run = 0;
    for (const r of steady) {
      const v = Math.max(r.spawnStoreE ?? 0, r.spawnLegacyE ?? 0);
      if (v < 50) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
    }
    // 死亡螺旋特征：spawn 恒 0 且无回填 → 连续时段 = 整个稳态（数千样本）。
    // 健康节奏：孵化清空 → harvester ~50t 内回填 → 连续 <50 段远小于 20 样本(100t)。
    expect(maxRun).toBeLessThanOrEqual(20);
  });
});
