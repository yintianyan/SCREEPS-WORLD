/** 侦察目标选择纯函数测试（R6b 主动情报）。 */
import { describe, expect, it } from "vitest";
import { selectProspectTarget, type ProspectCandidate } from "../../../src/domain/strategy/prospect";

const OPTS = { intelFreshness: 50 };
const TICK = 1000;

function candidate(overrides: Partial<ProspectCandidate> = {}): ProspectCandidate {
  return {
    roomName: "W6N4",
    home: "W7N4",
    kind: "normal",
    status: "normal",
    myUsername: "Me",
    sources: undefined, // 默认无视野 → 需要侦察
    lastSeen: 500,
    occupied: false,
    ...overrides,
  };
}

describe("selectProspectTarget", () => {
  it("无视野候选被选中，sponsor = intel 归属房", () => {
    const t = selectProspectTarget([candidate()], TICK, OPTS);
    expect(t).toEqual({ roomName: "W6N4", sponsor: "W7N4" });
  });

  it("视野已新鲜（sources 已知且未过期）→ 跳过，不浪费侦察", () => {
    const t = selectProspectTarget(
      [candidate({ sources: 2, lastSeen: TICK - 10 })],
      TICK,
      OPTS,
    );
    expect(t).toBeUndefined();
  });

  it("sources 已知但已过期 → 仍需侦察", () => {
    const t = selectProspectTarget(
      [candidate({ sources: 2, lastSeen: TICK - 200 })],
      TICK,
      OPTS,
    );
    expect(t?.roomName).toBe("W6N4");
  });

  it("多候选选 pathCost 最近者", () => {
    const t = selectProspectTarget(
      [
        candidate({ roomName: "W8N4", pathCost: 800 }),
        candidate({ roomName: "W6N4", pathCost: 400 }),
      ],
      TICK,
      OPTS,
    );
    expect(t?.roomName).toBe("W6N4");
  });

  it("过滤：SK/中心房、有主房、他人预定房、被占用房", () => {
    expect(
      selectProspectTarget([candidate({ kind: "sk" })], TICK, OPTS),
    ).toBeUndefined();
    expect(
      selectProspectTarget([candidate({ owner: "Enemy" })], TICK, OPTS),
    ).toBeUndefined();
    expect(
      selectProspectTarget([candidate({ reservedBy: "Other" })], TICK, OPTS),
    ).toBeUndefined();
    expect(
      selectProspectTarget([candidate({ occupied: true })], TICK, OPTS),
    ).toBeUndefined();
  });

  it("己方预定（reservedBy = myUsername）不排除", () => {
    const t = selectProspectTarget(
      [candidate({ reservedBy: "Me" })],
      TICK,
      OPTS,
    );
    expect(t?.roomName).toBe("W6N4");
  });

  describe("视野外扩（known=false 前沿发现）", () => {
    function frontier(roomName: string, overrides: Partial<ProspectCandidate> = {}): ProspectCandidate {
      return candidate({
        roomName,
        known: false,
        kind: "unknown",
        status: "unknown",
        lastSeen: 0,
        ...overrides,
      });
    }

    it("已知房有主（被跳过）时，前沿发现候选兜底选中", () => {
      const t = selectProspectTarget(
        [candidate({ owner: "Enemy" }), frontier("W7N3")],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W7N3");
    });

    it("已知房全部新鲜时，前沿发现候选兜底（避免视野锁死饿死扩张）", () => {
      const t = selectProspectTarget(
        [candidate({ sources: 2, lastSeen: TICK - 10 }), frontier("W7N3")],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W7N3");
    });

    it("多个前沿发现候选按距离选最近", () => {
      const t = selectProspectTarget(
        [frontier("W9N4"), frontier("W7N3")],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W7N3");
    });

    it("已知房与前沿候选同距时，已知房优先（保持重探语义）", () => {
      const t = selectProspectTarget(
        [candidate(), frontier("W7N3")],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W6N4");
    });

    it("hostile 相邻惩罚：紧贴敌方房的较近前沿候选让位于干净候选", () => {
      // W8N4（dist 1，贴 hostile）被罚 → eff 11；W7N3（dist 1，干净）→ eff 1。
      const t = selectProspectTarget(
        [frontier("W8N4", { hostileAdjacent: true }), frontier("W7N3", { hostileAdjacent: false })],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W7N3");
    });

    it("hostile 相邻惩罚：全 hostile 包围时仍选最近（罚分均匀 → 距离决胜）", () => {
      const t = selectProspectTarget(
        [frontier("W8N4", { hostileAdjacent: true }), frontier("W9N4", { hostileAdjacent: true })],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W8N4");
    });

    it("hostile 相邻惩罚高于距离差：干净远房优先于贴 hostile 近房", () => {
      // W9N4（dist 2，干净）→ eff 2；W8N4（dist 1，贴 hostile）→ eff 11。
      const t = selectProspectTarget(
        [frontier("W9N4", { hostileAdjacent: false }), frontier("W8N4", { hostileAdjacent: true })],
        TICK,
        OPTS,
      );
      expect(t?.roomName).toBe("W9N4");
    });
  });
});
