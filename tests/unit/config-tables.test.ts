import { describe, expect, it } from "vitest";
import { CONFIG } from "../../src/config";
import { METRICS_CATALOG } from "../../src/config/metrics";
import { registry } from "../../src/bootstrap";
import { buildCadenceTable } from "../../src/kernel/cadence";

/** 【F1/G-A~E】CONFIG 四表与 cadence 治理表的契约测试（FREEZE §0 参数表结构冻结）。 */
describe("F1 config tables", () => {
  it("memory.ttl 表：每行含 maxAge 与合法 sweepPolicy", () => {
    for (const [family, entry] of Object.entries(CONFIG.memory.ttl)) {
      expect(entry.maxAge, family).toBeGreaterThan(0);
      expect(["ring", "hook", "planned"]).toContain(entry.sweepPolicy);
    }
  });

  it("memory.segments 配额表：id 唯一且 ≤10 active", () => {
    const segs = CONFIG.memory.segments as Record<string, { id: number } | number>;
    const ids: number[] = [];
    for (const [name, entry] of Object.entries(segs)) {
      if (name === "maxActive") {
        expect(entry as number).toBeLessThanOrEqual(10);
        continue;
      }
      const id = (entry as { id: number }).id;
      expect(Number.isInteger(id), name).toBe(true);
      ids.push(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cadence 表：覆盖全部注册系统，override 值 ≥1，且与 CONFIG 覆盖层一致", () => {
    const table = buildCadenceTable(registry);
    for (const system of registry.getSystems()) {
      const entry = table.get(system.name);
      expect(entry, system.name).toBeDefined();
      expect(entry!.interval, system.name).toBeGreaterThanOrEqual(1);
      const override = CONFIG.cpu.cadenceOverrides?.[system.name];
      if (override !== undefined) {
        expect(entry!.via, system.name).toBe("override");
        expect(entry!.interval, system.name).toBe(Math.max(1, override));
      }
    }
  });

  it("metrics 目录：四元组完整、无重复、action 非空", () => {
    const names = new Set<string>();
    for (const m of METRICS_CATALOG) {
      expect(m.name.length, "name").toBeGreaterThan(0);
      expect(m.source.length, m.name).toBeGreaterThan(0);
      expect(m.consumer.length, m.name).toBeGreaterThan(0);
      expect(m.action!.length ?? 0, m.name).toBeGreaterThan(0);
      expect(names.has(m.name), `duplicate ${m.name}`).toBe(false);
      names.add(m.name);
    }
  });
});

// 线上幼房 W38S56（83323951）：`energyCapacityAvailable=450`，而 spawnQueue 里躺着 cost 500 的
// upgrader（retries 已烧到 9）与 cost 800 的 hauler —— selectBody 原本只比模板声明的 minCapacity，
// 从不比这份 body 的真实成本，于是容量刚好卡在某个数值上的房会拿到**永远付不起**的请求，
// 在 spawn-manager:478 每次尝试烧 retries、烧穿即隔离 1000 拍。这条不变量必须长期钉住。
describe("selectBody 产物必须落在给定容量内", () => {
  it("全角色 × 关键容量档 × rcl 组合：bodyCost(产物) ≤ 给定容量", async () => {
    const { BODY_TEMPLATES, bodyCost, selectBody } = await import("../../src/config/bodies");
    const capacities = [300, 350, 400, 450, 500, 550, 800, 1050, 1300, 1800, 1950];
    const bad: string[] = [];
    for (const cap of capacities) {
      for (const role of Object.keys(BODY_TEMPLATES)) {
        for (const opts of [{}, { rcl: 2 }, { rcl: 4 }, { rcl: 8 }, { hasRoad: false }]) {
          const cost = bodyCost(selectBody(role, cap, opts));
          if (cost > cap) bad.push(`${role} cap=${cap} opts=${JSON.stringify(opts)} cost=${cost}`);
        }
      }
      // 远矿 hauler 的无路档是另一条分支，单独扫一遍
      for (const opts of [{ hasRoad: false }, { rcl: 8, hasRoad: false }]) {
        const cost = bodyCost(selectBody("remoteHauler", cap, opts));
        if (cost > cap)
          bad.push(`remoteHauler cap=${cap} opts=${JSON.stringify(opts)} cost=${cost}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
