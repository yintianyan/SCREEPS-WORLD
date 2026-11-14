/** PB 野采决策纯函数测试（审计缺口 2）。 */
import { describe, expect, it } from "vitest";
import {
  isPowerFarmAttritionLost,
  isPowerFarmTimedOut,
  planPowerFarmSquad,
  reconcilePowerFarmRoster,
  selectPowerBankTarget,
  type PowerBankCandidate,
} from "../../../src/domain/war/power-farm";

function pb(opts: Partial<PowerBankCandidate> & { roomName: string }): PowerBankCandidate {
  return {
    home: "W7N4",
    lastSeen: 1000,
    powerBank: true,
    linearDistance: 3,
    occupied: false,
    ...opts,
  };
}

describe("selectPowerBankTarget — PB 野采目标选择", () => {
  const opts = { freshness: 2000, maxRange: 7 };

  it("新鲜 intel + 距离内 → 最近者优先", () => {
    const result = selectPowerBankTarget(
      [pb({ roomName: "A", linearDistance: 5 }), pb({ roomName: "B", linearDistance: 2 })],
      1500,
      opts,
    );
    expect(result?.roomName).toBe("B");
  });

  it("过期 intel（PB 可能已自灭）→ 排除", () => {
    const result = selectPowerBankTarget([pb({ roomName: "A", lastSeen: 100 })], 5000, opts);
    expect(result).toBeUndefined();
  });

  it("超最大距离 → 排除", () => {
    const result = selectPowerBankTarget([pb({ roomName: "A", linearDistance: 8 })], 1500, opts);
    expect(result).toBeUndefined();
  });

  it("占用房（远矿 op/扩张目标）→ 排除", () => {
    const result = selectPowerBankTarget([pb({ roomName: "A", occupied: true })], 1500, opts);
    expect(result).toBeUndefined();
  });

  it("intel 无 PB 标记 → 排除", () => {
    const result = selectPowerBankTarget([pb({ roomName: "A", powerBank: false })], 1500, opts);
    expect(result).toBeUndefined();
  });

  it("无候选 → undefined", () => {
    expect(selectPowerBankTarget([], 1500, opts)).toBeUndefined();
  });
});

describe("野采任务边界判定", () => {
  it("超时判定：恰好等于 timeout 不算超（宽限含等号）", () => {
    expect(isPowerFarmTimedOut(1000, 9000, 8000)).toBe(false);
    expect(isPowerFarmTimedOut(1000, 9001, 8000)).toBe(true);
  });

  it("止损判定：非寿终损失恰等于编队 × 倍数不算失败（含等号宽限）", () => {
    // 6 编制 × 2 = 12：12 不触发，13 触发。
    expect(isPowerFarmAttritionLost(12, 6, 2)).toBe(false);
    expect(isPowerFarmAttritionLost(13, 6, 2)).toBe(true);
  });
});

describe("reconcilePowerFarmRoster — 名册对账（区分战损与寿终）", () => {
  it("首次观测只播种：不产生战损，spawned = 当前人数", () => {
    const diff = reconcilePowerFarmRoster(undefined, { a: 1000, b: 900 }, 300);
    expect(diff.losses).toBe(0);
    expect(diff.spawned).toBe(2);
    expect(diff.roster).toEqual({ a: 1000, b: 900 });
  });

  it("中寿消失计战损；寿终消失不计；新名字计真实孵化", () => {
    const diff = reconcilePowerFarmRoster(
      { mid: 1000, old: 200, keep: 800 },
      { keep: 750, fresh: 1500 },
      300,
    );
    expect(diff.losses).toBe(1); // mid 非寿终消失
    expect(diff.spawned).toBe(1); // fresh 新出现
    expect(diff.roster).toEqual({ keep: 750, fresh: 1500 });
  });
});

describe("planPowerFarmSquad — 反弹伤害/火力/寿命/时间窗", () => {
  const limits = {
    maxAttackers: 6,
    maxHealers: 12,
    maxCollectors: 6,
    killWindowTicks: 750,
    travelTicksPerRoom: 60,
    spawnTicksPerPart: 3,
    safetyTicks: 300,
    minPowerLoot: 1000,
    defaultPower: 5000,
    creepLifetimeTicks: 1500,
    boostWaitTicks: 300,
  };

  /** RCL8 顶档：attacker [10T20A20M] / healer [4T8H12M] / collector [20C20M]。 */
  function input(overrides: Partial<Parameters<typeof planPowerFarmSquad>[0]> = {}) {
    return {
      hits: 2_000_000,
      power: 5000,
      distance: 3,
      availableTicks: 5000,
      spawnCount: 3,
      attacker: { parts: 50, cost: 2700, attackParts: 20 },
      healer: { parts: 24, cost: 2640, healParts: 8 },
      collector: { parts: 40, cost: 2000, carry: 1000 },
      limits,
      ...overrides,
    };
  }

  it("boost ×4（RCL8 顶档）→ 2 攻击手 + 8 治疗手，kill 417 装进单条寿命", () => {
    const plan = planPowerFarmSquad(input({ boost: { attackFactor: 4, healFactor: 4 } }));
    expect(plan.feasible).toBe(true);
    expect(plan.attackers).toBe(2);
    expect(plan.healers).toBe(8);
    // 2×20A×30×4 = 4800 dmg/tick → 2M ≈ 417 tick。
    expect(plan.dps).toBe(4800);
    expect(plan.killTicks).toBe(417);
    // boost 后反弹按实际伤害回打：2×1200=2400，治疗 8×96×4=3072 → 覆盖。
    expect(plan.healPerTick).toBeGreaterThanOrEqual(plan.reflectPerTick);
    // 在场时钟 = 通勤 180 + 击杀 417 + 余量 300 ≤ 寿命 1500。
    expect(plan.boost).toEqual({ attackFactor: 4, healFactor: 4 });
  });

  it("裸 body（无 boost）打不进寿命反推的击杀窗口 → firepower-insufficient，不派队", () => {
    // 顶档 20A 裸 dps 600：反推 5 攻击手 → 反弹 1500，12 healer 治疗上限 1152
    // 覆盖不上 → 编队必烧光。PB 野采以 boost 为前提的设计判定。
    const plan = planPowerFarmSquad(input());
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe("healing-insufficient");
  });

  it("治疗不足（HEAL 部件太少）→ healing-insufficient，不派队", () => {
    const plan = planPowerFarmSquad(
      input({
        boost: { attackFactor: 4, healFactor: 1 }, // 单边 boost 是禁用状态
        healer: { parts: 10, cost: 600, healParts: 2 },
      }),
    );
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe("healing-insufficient");
  });

  it("弱 body 无 boost 打不进窗口 → firepower-insufficient", () => {
    const plan = planPowerFarmSquad(input({ attacker: { parts: 10, cost: 550, attackParts: 4 } }));
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe("firepower-insufficient");
  });

  it("在场时钟（通勤+击杀+余量）超 creep 寿命 → lifetime-insufficient", () => {
    const plan = planPowerFarmSquad(
      input({ distance: 14, boost: { attackFactor: 4, healFactor: 4 } }),
    );
    expect(plan.feasible).toBe(false);
    // 14×60=840 + kill 417 + 300 = 1557 > 1500。
    expect(plan.reason).toBe("lifetime-insufficient");
  });

  it("boost 口径的等料驻留计入寿命：11 房正交路线（660t 行军）不可行", () => {
    // 660 + kill 417 + safety 300 + boostWait 300 = 1677 > 1500 — 私服实测教训：
    // 行军规避拉长路线后，hold 等料期会把编队烧到寿终，长路线任务必须拒开。
    const plan = planPowerFarmSquad(
      input({ distance: 11, boost: { attackFactor: 4, healFactor: 4 } }),
    );
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe("lifetime-insufficient");
  });

  it("PB 剩余时间不够孵化+通勤+击杀 → not-enough-time", () => {
    const plan = planPowerFarmSquad(
      input({ availableTicks: 1000, boost: { attackFactor: 4, healFactor: 4 } }),
    );
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe("not-enough-time");
  });

  it("低价值 PB（power < minPowerLoot）→ low-loot", () => {
    const plan = planPowerFarmSquad(input({ power: 500 }));
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe("low-loot");
  });

  it("collector 数量按 PB power / 单趟 carry 向上取整", () => {
    expect(planPowerFarmSquad(input({ power: 3000 })).collectors).toBe(3);
    expect(planPowerFarmSquad(input({ power: 6000 })).collectors).toBe(6);
  });

  it("power 超 collector 上限 → 任务照开但记 powerOverflow（crit PB 10000 口径）", () => {
    const plan = planPowerFarmSquad(input({ power: 12_000 }));
    expect(plan.collectors).toBe(6);
    expect(plan.powerOverflow).toBe(6000);
    // 上限提到 10（现行 CONFIG）时 crit PB 理论上限 10000 恰好一次抢完，无溢出。
    const plan10 = planPowerFarmSquad(
      input({
        power: 10_000,
        boost: { attackFactor: 4, healFactor: 4 },
        limits: { ...limits, maxCollectors: 10 },
      }),
    );
    expect(plan10.collectors).toBe(10);
    expect(plan10.powerOverflow).toBeUndefined();
  });
});
