/** boost 战前强化链测试（P0）。 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOST_REPORT_TTL,
  DEFAULT_BOOST_POLICY,
  decideWarReactionTarget,
  evaluateBoostRequests,
  isWithinBoostWindow,
} from "../../../src/domain/industry/boost";
import { labSystem } from "../../../src/systems/lab-system";
import { CONFIG } from "../../../src/config";
import { mockContext, mockSnapshot, registerObject, resetGlobals } from "../../role-helpers";

const g = globalThis as Record<string, any>;

beforeEach(() => {
  resetGlobals();
});

// ─── 受限 store mock（复现引擎语义：无参 getFreeCapacity 返回 null）────

function makeLabStore(contents: Record<string, number>): Record<string, any> {
  const store: Record<string, any> = { ...contents };
  Object.defineProperty(store, "getFreeCapacity", {
    enumerable: false,
    value: (resource?: string) =>
      resource === undefined ? null : 3000 - (contents[resource] ?? 0),
  });
  Object.defineProperty(store, "getUsedCapacity", {
    enumerable: false,
    value: (resource?: string) => (resource === undefined ? null : contents[resource] ?? 0),
  });
  return store;
}

function makeLab(id: string, x: number, y: number, contents: Record<string, number> = {}): any {
  const lab = { id, store: makeLabStore(contents), structureType: "lab", pos: { x, y, roomName: "W7N4" } };
  registerObject(id, lab);
  return lab;
}

// ─── 1. decideWarReactionTarget ─────────────────────────────

describe("decideWarReactionTarget — war 前馈预产", () => {
  it("非 war 姿态 → 不前馈（undefined）", () => {
    expect(decideWarReactionTarget(false, {}, 600)).toBeUndefined();
  });

  it("war + XUH2O 库存缺口 → 前馈产 XUH2O（attacker 优先 — 无 DPS 再多奶也无用）", () => {
    expect(decideWarReactionTarget(true, { XUH2O: 0, XLHO2: 800 }, 600)).toBe("XUH2O");
    expect(decideWarReactionTarget(true, { XLHO2: 800 }, 600)).toBe("XUH2O");
  });

  it("war + XUH2O 达标但 XLHO2 缺口 → 前馈产 XLHO2", () => {
    expect(decideWarReactionTarget(true, { XUH2O: 600, XLHO2: 100 }, 600)).toBe("XLHO2");
  });

  it("war + 全达标 → 不前馈（回退默认生产线）", () => {
    expect(decideWarReactionTarget(true, { XUH2O: 600, XLHO2: 600 }, 600)).toBeUndefined();
  });

  it("边界：库存恰好等于目标量 → 视为达标", () => {
    expect(decideWarReactionTarget(true, { XUH2O: 600 }, 600)).toBe("XLHO2");
  });
});

// ─── 2. isWithinBoostWindow ─────────────────────────────────

describe("isWithinBoostWindow — 战时报到窗口放宽", () => {
  it("通用窗口内（新生 creep）→ 可报到", () => {
    expect(isWithinBoostWindow("upgrader", BOOST_REPORT_TTL, false)).toBe(true);
  });

  it("窗口外 + 非战时 → 放行（防 lab 旁罚站的既有防呆）", () => {
    expect(isWithinBoostWindow("attacker", BOOST_REPORT_TTL - 1, false)).toBe(false);
  });

  it("窗口外 + war build 相位 + 编队角色 → 放宽可报到", () => {
    // war 前馈产化合物需数百 tick，固定 100 tick 窗口会让编队永远错过强化。
    expect(isWithinBoostWindow("attacker", 100, true)).toBe(true);
    expect(isWithinBoostWindow("healer", 100, true)).toBe(true);
  });

  it("窗口外 + war build 相位 + 非编队角色 → 不放宽", () => {
    expect(isWithinBoostWindow("upgrader", BOOST_REPORT_TTL - 1, true)).toBe(false);
  });
});

// ─── 3. evaluateBoostRequests 战时扩展 ─────────────────────

describe("evaluateBoostRequests — attacker/healer 请求生成", () => {
  const STOCKPILE = { XUH2O: 500, XLHO2: 500 };

  it("attacker 生成 XUH2O 请求（库存 ≥ reserve+30），healer 生成 XLHO2", () => {
    const requests = evaluateBoostRequests(
      [
        { name: "a1", role: "attacker", ticksToLive: 1500, boosted: false },
        { name: "h1", role: "healer", ticksToLive: 1500, boosted: false },
      ],
      6,
      STOCKPILE,
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ creepName: "a1", compound: "XUH2O" });
    expect(requests[1]).toMatchObject({ creepName: "h1", compound: "XLHO2" });
  });

  it("按实际 body 匹配部件数备料（attacker 4 ATTACK → bodyParts 4；healer 10 HEAL → 10）", () => {
    const requests = evaluateBoostRequests(
      [
        {
          name: "a1", role: "attacker", ticksToLive: 1500, boosted: false,
          body: [
            { type: "tough" }, { type: "attack" }, { type: "attack" },
            { type: "attack" }, { type: "attack" }, { type: "move" },
          ],
        },
        {
          name: "h1", role: "healer", ticksToLive: 1500, boosted: false,
          body: [
            ...Array.from({ length: 10 }, () => ({ type: "heal" as const })),
            ...Array.from({ length: 10 }, () => ({ type: "move" as const })),
          ],
        },
      ],
      6,
      STOCKPILE,
    );
    const attacker = requests.find(r => r.creepName === "a1")!;
    const healer = requests.find(r => r.creepName === "h1")!;
    expect(attacker.bodyParts).toBe(4);
    expect(healer.bodyParts).toBe(10);
  });

  it("已 boost 部件不计入备料（部分强化后重新请求只补缺口）", () => {
    const requests = evaluateBoostRequests(
      [
        {
          name: "a1", role: "attacker", ticksToLive: 1500, boosted: false,
          body: [
            { type: "attack", boost: "XUH2O" }, { type: "attack" },
          ],
        },
      ],
      6,
      STOCKPILE,
    );
    expect(requests[0]!.bodyParts).toBe(1);
  });

  it("body 缺省 → 回退 5 部件权宜值（既有行为兼容）", () => {
    const requests = evaluateBoostRequests(
      [{ name: "a1", role: "attacker", ticksToLive: 1500, boosted: false }],
      6,
      STOCKPILE,
    );
    expect(requests[0]!.bodyParts).toBe(5);
  });

  it("库存不足（< reserve+30）→ 不生成请求（前馈链路继续补产）", () => {
    const requests = evaluateBoostRequests(
      [{ name: "a1", role: "attacker", ticksToLive: 1500, boosted: false }],
      6,
      { XUH2O: DEFAULT_BOOST_POLICY.reserveAmount + 29 },
    );
    expect(requests).toHaveLength(0);
  });

  it("战时放宽：TTL 窗口外的编队成员在 build 相位仍生成请求", () => {
    const requests = evaluateBoostRequests(
      [{ name: "a1", role: "attacker", ticksToLive: 500, boosted: false }],
      6,
      STOCKPILE,
      DEFAULT_BOOST_POLICY,
      true, // warBuildPhase
    );
    expect(requests).toHaveLength(1);
  });

  it("战时不放宽非编队角色（upgrader 窗口外仍不请求）", () => {
    const requests = evaluateBoostRequests(
      [{ name: "u1", role: "upgrader", ticksToLive: 500, boosted: false }],
      6,
      { XGH2O: 500 },
      DEFAULT_BOOST_POLICY,
      true,
    );
    expect(requests).toHaveLength(0);
  });
});

// ─── 4. lab-system 前馈接线 ─────────────────────────────────

/** 驱动 labSystem.run：RCL6 + 3 lab + storage 库存 + 可选姿态/计划。
 * 默认补齐全基础矿 — 反应链无可执行步骤时 lab-system 会清除 reactionTarget，
 * 缺矿会误判为「前馈未生效」。 */
const ALL_BASE_MINERALS = { H: 500, O: 500, U: 500, L: 500, K: 500, Z: 500, X: 200 };

function runLabSystem(
  storageContents: Record<string, number>,
  posture?: string,
  warPlan?: Record<string, any>,
): void {
  g.Game.rooms = { W7N4: {} };
  g.Game.creeps = {};
  g.Memory.rooms = { W7N4: {} };
  g.Memory.kernel = {
    strategy: posture ? { posture, since: 900 } : undefined,
    warPlan,
  };
  const snap = mockSnapshot({
    rcl: 6,
    labs: [makeLab("L1", 25, 25), makeLab("L2", 26, 25), makeLab("L3", 25, 26)],
    storage: { id: "stor1", store: { energy: 5000, ...ALL_BASE_MINERALS, ...storageContents } } as any,
  });
  labSystem.run(mockContext(snap));
}

describe("lab-system — war 前馈接线", () => {
  it("war 姿态 + sponsor 房 + 化合物缺口 → reactionTarget 前馈为 XUH2O", () => {
    runLabSystem(
      {},
      "war",
      { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" },
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XUH2O");
  });

  it("非 war 姿态 → 默认 XGH2O 生产线不受影响", () => {
    runLabSystem({}, "develop");
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("war 姿态但本房非 sponsor → 不前馈（其他房继续默认生产）", () => {
    runLabSystem(
      {},
      "war",
      { targetRoom: "W6N4", sponsor: "W9N9", phase: "build" },
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("war 姿态 + 库存全达标 → 前馈让位默认生产", () => {
    runLabSystem(
      { XUH2O: 600, XLHO2: 600 },
      "war",
      { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" },
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("XUH2O 达标后前馈转向 XLHO2（多批生产自然推进到下一缺口）", () => {
    runLabSystem(
      { XUH2O: 600 },
      "war",
      { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" },
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XLHO2");
  });

  it("war 前馈激活时原料断供 → 短休眠（50 tick，等 market 补矿快速恢复）", () => {
    // 只留 X（无 U/H/O）→ 前馈目标设定但反应链无可执行步骤 → 休眠。
    g.Game.rooms = { W7N4: {} };
    g.Game.creeps = {};
    g.Memory.rooms = { W7N4: {} };
    g.Memory.kernel = {
      strategy: { posture: "war", since: 900 },
      warPlan: { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" },
    };
    const snap = mockSnapshot({
      rcl: 6,
      labs: [makeLab("L1", 25, 25), makeLab("L2", 26, 25), makeLab("L3", 25, 26)],
      storage: { id: "stor1", store: { energy: 5000, X: 200 } } as any,
    });
    labSystem.run(mockContext(snap));
    expect(g.Memory.rooms.W7N4.industry.idleUntil).toBe(1000 + 50);
  });

  it("非 war 原料断供 → 长休眠 500 tick（既有防 CPU 空转行为不变）", () => {
    g.Game.rooms = { W7N4: {} };
    g.Game.creeps = {};
    g.Memory.rooms = { W7N4: {} };
    g.Memory.kernel = {};
    const snap = mockSnapshot({
      rcl: 6,
      labs: [makeLab("L1", 25, 25), makeLab("L2", 26, 25), makeLab("L3", 25, 26)],
      storage: { id: "stor1", store: { energy: 5000 } } as any,
    });
    labSystem.run(mockContext(snap));
    expect(g.Memory.rooms.W7N4.industry.idleUntil).toBe(1000 + 500);
  });
});
