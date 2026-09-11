/** reserver 摊销通勤修正 — 远房门票成本不再被低估。 */
import { describe, expect, it } from "vitest";
import {
  reserverUpkeepFor,
  scoreRemoteCandidate,
  selectRemoteTargets,
} from "../../../src/domain/remote/targeting";
import { CONFIG } from "../../../src/config";

describe("reserverUpkeepFor — 有效在岗时长 = 寿命 − pathCost", () => {
  it("零通勤时等于原常数 650/600", () => {
    expect(reserverUpkeepFor(0)).toBeCloseTo(650 / 600, 6);
  });

  it("随 pathCost 严格递增（距离越远门票越贵）", () => {
    const costs = [0, 50, 100, 200, 400].map(reserverUpkeepFor);
    // 严格递增 ⇔ 排序后与原序列相同且无重复值（避免下标访问的越界断言）。
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(costs.length);
  });

  it("关键点与手算一致（原实现一律用 1.08，低估远房）", () => {
    expect(reserverUpkeepFor(100)).toBeCloseTo(650 / 500, 6); // 1.30
    expect(reserverUpkeepFor(200)).toBeCloseTo(650 / 400, 6); // 1.625
    expect(reserverUpkeepFor(400)).toBeCloseTo(650 / 200, 6); // 3.25
  });

  it("pathCost ≥ 寿命（600）时摊销趋于无穷 → 由门槛自然剔除，不返回负数", () => {
    expect(reserverUpkeepFor(600)).toBe(650);
    expect(reserverUpkeepFor(900)).toBe(650); // 地板 1，绝不出现负摊销
    expect(reserverUpkeepFor(900)).toBeGreaterThan(0);
  });
});

describe("reserver 通勤修正对开点决策的影响", () => {
  const tick = 10_000;
  const staleThreshold = CONFIG.remote.staleThreshold;

  it("超远房（pathCost 500，reserver 到不了）被剔除", () => {
    const picked = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W2N1: {
          kind: "normal",
          status: "normal",
          lastSeen: tick,
          sources: 2,
          pathCost: 500,
        },
      } as never,
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(picked).toHaveLength(0);
  });

  it("近房不受影响，仍可入选", () => {
    const picked = selectRemoteTargets({
      homeRoom: "W1N1",
      intel: {
        W1N2: {
          kind: "normal",
          status: "normal",
          lastSeen: tick,
          sources: 2,
          pathCost: 20,
        },
      } as never,
      existingOps: undefined,
      tick,
      staleThreshold,
      haulerCapacity: 800,
    });
    expect(picked).toHaveLength(1);
    const [first] = picked;
    expect(first?.netScore ?? 0).toBeGreaterThan(CONFIG.remote.minNetScore);
  });

  it("同源同编制下，pathCost 越大 netScore 越低（含 reserver 通勤项）", () => {
    const base = {
      linearDistance: 1,
      sources: 1,
      haulerCapacity: 800,
      withDefender: false,
    };
    const near = scoreRemoteCandidate({ ...base, pathCost: 50 }).netScore;
    const far = scoreRemoteCandidate({ ...base, pathCost: 250 }).netScore;
    expect(far).toBeLessThan(near);
  });
});
