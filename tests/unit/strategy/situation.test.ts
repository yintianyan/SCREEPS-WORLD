/** 帝国态势评估回归测试 —— 散落事实 → 命名条件 + 对手画像。 */
import { describe, expect, it } from "vitest";
import { buildEmpireSituation } from "../../../src/domain/strategy/situation";

const TICK = 82414000;

function room(overrides: Record<string, unknown> = {}) {
  return {
    room: "W38S59",
    rcl: 1,
    hasSpawn: false,
    ttd: 15000 as number | undefined,
    threats: [] as { owner: string }[],
    colonyState: "normal",
    ...overrides,
  };
}

describe("situation — 对手画像聚合", () => {
  it("同对手跨房目击合并；按威胁面排序", () => {
    const s = buildEmpireSituation({
      tick: TICK,
      rooms: [
        room({ threats: [{ owner: "Aguia" }] }),
        room({ room: "W37S58", rcl: 7, hasSpawn: true, threats: [{ owner: "Aguia" }, { owner: "Other" }] }),
      ],
      warBlacklist: {},
    });
    expect(s.adversaries[0]?.username).toBe("Aguia");
    expect(s.adversaries[0]?.rooms).toHaveLength(2);
    expect(s.adversaries[1]?.username).toBe("Other");
  });
});

describe("situation — 新生殖民地风险条件", () => {
  it("无 spawn + 敌情 → newbornColonyRisk(sev2)", () => {
    const s = buildEmpireSituation({
      tick: TICK,
      rooms: [room({ threats: [{ owner: "Aguia" }] })],
      warBlacklist: {},
    });
    const c = s.conditions.find((c) => c.id === "newbornColonyRisk:W38S59");
    expect(c?.severity).toBe(2);
  });

  it("TTD 危急 → 升格 sev3 并携带证据", () => {
    const s = buildEmpireSituation({
      tick: TICK,
      rooms: [room({ ttd: 160 })],
      warBlacklist: {},
    });
    const c = s.conditions.find((c) => c.id === "newbornColonyRisk:W38S59");
    expect(c?.severity).toBe(3);
    expect(c?.detail).toContain("TTD=160");
  });

  it("健康新生房（有 spawn 或无敌无危）不发射条件", () => {
    const s1 = buildEmpireSituation({
      tick: TICK,
      rooms: [room({ hasSpawn: true })],
      warBlacklist: {},
    });
    const s2 = buildEmpireSituation({
      tick: TICK,
      rooms: [room()],
      warBlacklist: {},
    });
    expect(s1.conditions).toHaveLength(0);
    expect(s2.conditions).toHaveLength(0);
  });
});

describe("situation — 控制器受压与扩张邻接条件", () => {
  it("任意 RCL 的 TTD 骤降 → controllerUnderAttack(sev3)", () => {
    const s = buildEmpireSituation({
      tick: TICK,
      rooms: [room({ room: "W37S58", rcl: 7, hasSpawn: true, ttd: 1800 })],
      warBlacklist: {},
    });
    expect(s.conditions.some((c) => c.id === "controllerUnderAttack:W37S58" && c.severity === 3)).toBe(true);
  });

  it("活跃扩张目标邻接宿敌 → expansionAdjacentHostile 条件（事前规避）", () => {
    const s = buildEmpireSituation({
      tick: TICK,
      rooms: [],
      warBlacklist: { W38S58: TICK + 5000 },
      hostileAdj: new Set(["W38S59"]),
      activeExpansionTarget: "W38S59",
    });
    expect(s.conditions.some((c) => c.id === "expansionAdjacentHostile:W38S59")).toBe(true);
  });
});
