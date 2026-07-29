/**
 * 远矿超额回收测试 — 交接豁免语义。
 *
 * 事故背景（孵化→秒杀→再孵化循环）：findReplacement 提前孵化替补形成
 * 合法的交接重叠，但超额回收把重叠判成超编；孵化中的替补 ticksToLive
 * 为 undefined，按 ?? 0 排序被当「最老」标记回收 — 出场即消融；
 * collectRemoteCreeps 又排除 recycle 标记者，demand 视角编制归零立即
 * 再孵，无限空烧（reserver 因 CLAIM 寿命 600 替换最频繁，观感最明显）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { recycleExcessRemoteCreeps } from "../../../src/systems/remote-mining-manager";
import { resetGlobals } from "../../role-helpers";

function remoteCreep(
  name: string,
  role: string,
  opts: { ttl?: number; spawning?: boolean; recycle?: boolean; bodyLen?: number } = {},
): any {
  return {
    name,
    spawning: opts.spawning ?? false,
    ticksToLive: opts.ttl,
    body: Array(opts.bodyLen ?? 2).fill({ type: "move" }),
    memory: {
      role,
      home: "W7N4",
      remoteTarget: "W7N5",
      recycle: opts.recycle ?? false,
    },
  };
}

const OPS = { W7N5: { state: "active", lastSeen: 0 } } as any;

function runWith(...creeps: any[]): void {
  const map: Record<string, any> = {};
  for (const c of creeps) map[c.name] = c;
  (globalThis as any).Game.creeps = map;
  recycleExcessRemoteCreeps("W7N4", OPS);
}

beforeEach(() => {
  resetGlobals();
});

describe("recycleExcessRemoteCreeps — 交接豁免", () => {
  it("交接重叠：垂死者（替换窗口内）+ 健康替补并存，无人被标记", () => {
    // reserver body 2 部件 → 窗口 = 6 + 15 + 50 = 71；TTL 30 在窗口内。
    const dying = remoteCreep("res_old", "reserver", { ttl: 30 });
    const fresh = remoteCreep("res_new", "reserver", { ttl: 550 });

    runWith(dying, fresh);

    expect(dying.memory.recycle).toBe(false);
    expect(fresh.memory.recycle).toBe(false);
  });

  it("孵化中的替补不参与配额判定，绝不被标记（修复前被当最老误杀）", () => {
    const dying = remoteCreep("res_old", "reserver", { ttl: 30 });
    const spawning = remoteCreep("res_new", "reserver", { spawning: true, ttl: undefined });

    runWith(dying, spawning);

    expect(spawning.memory.recycle).toBe(false);
    expect(dying.memory.recycle).toBe(false);
  });

  it("真超额（双孵事故）：两只健康成员并存，回收 TTL 较小者", () => {
    const older = remoteCreep("res_a", "reserver", { ttl: 400 });
    const younger = remoteCreep("res_b", "reserver", { ttl: 550 });

    runWith(older, younger);

    expect(younger.memory.recycle).toBe(false);
    expect(older.memory.recycle).toBe(true);
  });

  it("hauler 配额与 demand 同口径：haulerNeed=2 时 2 只健康 hauler 均不被标记", () => {
    // 口径分裂回归（远矿 2.0 漏改）：demand 按 op.haulerNeed=2 孵化，
    // recycle 若按固定 haulersPerTarget=1 回收，编制内第 2 只被反复
    // 标记 → 排除出编制 → 缺编再孵 → 孵化→回收死循环。
    (OPS.W7N5 as { haulerNeed?: number }).haulerNeed = 2;
    const h1 = remoteCreep("rh_a", "remoteHauler", { ttl: 900 });
    const h2 = remoteCreep("rh_b", "remoteHauler", { ttl: 1200 });

    runWith(h1, h2);

    expect(h1.memory.recycle).toBe(false);
    expect(h2.memory.recycle).toBe(false);
    delete (OPS.W7N5 as { haulerNeed?: number }).haulerNeed;
  });

  it("hauler 超出 haulerNeed 的健康冗余仍回收（保留最年轻的 2 只）", () => {
    (OPS.W7N5 as { haulerNeed?: number }).haulerNeed = 2;
    const h1 = remoteCreep("rh_a", "remoteHauler", { ttl: 600 });
    const h2 = remoteCreep("rh_b", "remoteHauler", { ttl: 900 });
    const h3 = remoteCreep("rh_c", "remoteHauler", { ttl: 1200 });

    runWith(h1, h2, h3);

    expect(h3.memory.recycle).toBe(false);
    expect(h2.memory.recycle).toBe(false);
    expect(h1.memory.recycle).toBe(true);
    delete (OPS.W7N5 as { haulerNeed?: number }).haulerNeed;
  });

  it("harvester 按配额（harvestersPerTarget=1）同规则：健康超额回收、垂死豁免", () => {
    // remoteHarvester 9 部件 → 窗口 = 27 + 15 + 50 = 92。
    const dying = remoteCreep("rh_old", "remoteHarvester", { ttl: 80, bodyLen: 9 });
    const a = remoteCreep("rh_a", "remoteHarvester", { ttl: 1000, bodyLen: 9 });
    const b = remoteCreep("rh_b", "remoteHarvester", { ttl: 1400, bodyLen: 9 });

    runWith(dying, a, b);

    expect(dying.memory.recycle).toBe(false); // 垂死豁免。
    expect(b.memory.recycle).toBe(false); // 最年轻保留。
    expect(a.memory.recycle).toBe(true); // 健康超额回收。
  });

  it("已标记 recycle 的不重复参与判定", () => {
    const marked = remoteCreep("res_x", "reserver", { ttl: 500, recycle: true });
    const alive = remoteCreep("res_y", "reserver", { ttl: 400 });

    runWith(marked, alive);

    expect(alive.memory.recycle).toBe(false); // 唯一在编者，不超额。
  });
});
