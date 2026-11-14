/** boost 战前强化链测试（P0）。 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOST_REPORT_TTL,
  DEFAULT_BOOST_POLICY,
  decideWarReactionTarget,
  decideCombatReactionTarget,
  decidePbReactionTarget,
  evaluateBoostRequests,
  isPbBoostStockSufficient,
  isWithinBoostWindow,
  pbSquadBoostNeed,
  PB_SQUAD_COMPOUNDS,
} from "../../../src/domain/industry/boost";
import { labSystem } from "../../../src/systems/room/lab-system";
import { CONFIG } from "../../../src/config";
import { mockContext, mockSnapshot, registerObject, resetGlobals } from "../../support/factories";

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
    value: (resource?: string) => (resource === undefined ? null : (contents[resource] ?? 0)),
  });
  return store;
}

function makeLab(id: string, x: number, y: number, contents: Record<string, number> = {}): any {
  const lab = {
    id,
    store: makeLabStore(contents),
    structureType: "lab",
    pos: { x, y, roomName: "W7N4" },
  };
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
          name: "a1",
          role: "attacker",
          ticksToLive: 1500,
          boosted: false,
          body: [
            { type: "tough" },
            { type: "attack" },
            { type: "attack" },
            { type: "attack" },
            { type: "attack" },
            { type: "move" },
          ],
        },
        {
          name: "h1",
          role: "healer",
          ticksToLive: 1500,
          boosted: false,
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
          name: "a1",
          role: "attacker",
          ticksToLive: 1500,
          boosted: false,
          body: [{ type: "attack", boost: "XUH2O" }, { type: "attack" }],
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

  it("P0-C：T3 不足但 T1 GH 够（reserve+30）⇒ upgrader 降级请求 GH", () => {
    // 线上 W8N3：XGH2O=5 / GH2O=5 都不够，但 GH=295 ≥ reserve(100)+30 ⇒ 应发请求。
    const requests = evaluateBoostRequests(
      [{ name: "u1", role: "upgrader", ticksToLive: 1600, boosted: false }],
      6,
      { XGH2O: 5, GH2O: 5, GH: 295 },
      DEFAULT_BOOST_POLICY,
      false,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.compound).toBe("GH");
  });

  it("P0-C：全部化合物低于 reserve+30 ⇒ 不请求（保留反应原料）", () => {
    const requests = evaluateBoostRequests(
      [{ name: "u1", role: "upgrader", ticksToLive: 1600, boosted: false }],
      6,
      { XGH2O: 5, GH2O: 5, GH: 20 },
      DEFAULT_BOOST_POLICY,
      false,
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
  nukerStore?: Record<string, number>,
  seedIndustry?: Record<string, any>,
): void {
  g.Game.rooms = { W7N4: {} };
  g.Game.creeps = {};
  // seedIndustry：给「目标已被占住」这类用例预置 industry 段 —— runLabSystem 每次都
  // 重置 Memory，不预置就只能测到"首次选目标"，测不到抢占。
  g.Memory.rooms = { W7N4: seedIndustry ? { industry: { ...seedIndustry } } : {} };
  g.Memory.kernel = {
    strategy: posture ? { posture, since: 900 } : undefined,
    warPlan,
  };
  const snap = mockSnapshot({
    rcl: 6,
    labs: [makeLab("L1", 25, 25), makeLab("L2", 26, 25), makeLab("L3", 25, 26)],
    storage: {
      id: "stor1",
      store: { energy: 5000, ...ALL_BASE_MINERALS, ...storageContents },
    } as any,
    // 不传 nukerStore 时保持 undefined —— gShort 分支的准入条件之一就是
    // `snapshot.nuker !== undefined`，默认给个 mock 会让既有 war 前馈用例悄悄换分支。
    nuker: nukerStore ? ({ id: "nk1", store: nukerStore, cooldown: 0 } as any) : undefined,
  });
  labSystem.run(mockContext(snap));
}

describe("lab-system — war 前馈接线", () => {
  it("war 姿态 + sponsor 房 + 化合物缺口 → reactionTarget 前馈为 XUH2O", () => {
    runLabSystem({}, "war", { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" });
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XUH2O");
  });

  it("非 war 姿态 → 默认 XGH2O 生产线不受影响", () => {
    runLabSystem({}, "develop");
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("war 姿态但本房非 sponsor → 不前馈（其他房继续默认生产）", () => {
    runLabSystem({}, "war", { targetRoom: "W6N4", sponsor: "W9N9", phase: "build" });
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("war 姿态 + 库存全达标 → 前馈让位默认生产", () => {
    runLabSystem({ XUH2O: 600, XLHO2: 600 }, "war", {
      targetRoom: "W6N4",
      sponsor: "W7N4",
      phase: "build",
    });
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("XUH2O 达标后前馈转向 XLHO2（多批生产自然推进到下一缺口）", () => {
    runLabSystem({ XUH2O: 600 }, "war", { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" });
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

// ─── 6. PB 编队强化（原子对）与 combat 前馈 ─────────────────

describe("decidePbReactionTarget — 前馈目标按任务需求逐化合物对齐", () => {
  it("XUH2O 缺口 → 前馈 XUH2O（先炮后奶）", () => {
    expect(decidePbReactionTarget({ XLHO2: 3000 }, 1300, 2020)).toBe("XUH2O");
  });

  it("XUH2O 够、XLHO2 缺 → 前馈 XLHO2", () => {
    expect(decidePbReactionTarget({ XUH2O: 1300, XLHO2: 500 }, 1300, 2020)).toBe("XLHO2");
  });

  it("双达标 → undefined（回退默认生产线）", () => {
    expect(decidePbReactionTarget({ XUH2O: 1300, XLHO2: 2020 }, 1300, 2020)).toBeUndefined();
  });

  it("边界：库存恰等于需求 → 视为达标", () => {
    expect(decidePbReactionTarget({ XUH2O: 1300, XLHO2: 2019 }, 1300, 2020)).toBe("XLHO2");
    expect(decidePbReactionTarget({ XUH2O: 1300, XLHO2: 2020 }, 1300, 2020)).toBeUndefined();
  });

  it("闭环断裂回归：war 统一目标 600 < PB 需求 1300/2020 时，PB 目标必须覆盖需求", () => {
    // 私服实证：前馈补到 war stockpile(600) 就停，闸门要 1300/2020 → 永久停滞。
    expect(decidePbReactionTarget({ XUH2O: 600, XLHO2: 600 }, 1300, 2020)).toBe("XUH2O");
  });
});

describe("decideCombatReactionTarget — PB/war 共用 combat 前馈", () => {
  it("PB 任务激活 + 化合物缺口 → 与 war 同链前馈 XUH2O→XLHO2", () => {
    expect(decideCombatReactionTarget(true, { XLHO2: 800 }, 600)).toBe("XUH2O");
    expect(decideCombatReactionTarget(true, { XUH2O: 600, XLHO2: 100 }, 600)).toBe("XLHO2");
  });

  it("无激活任务 → 不前馈", () => {
    expect(decideCombatReactionTarget(false, {}, 600)).toBeUndefined();
  });

  it("全达标 → undefined（回退默认生产线）", () => {
    expect(decideCombatReactionTarget(true, { XUH2O: 600, XLHO2: 600 }, 600)).toBeUndefined();
  });
});

describe("PB_SQUAD_COMPOUNDS / pbSquadBoostNeed — 备料需求", () => {
  it("化合物对齐 DEFAULT_BOOST_POLICY 的 attacker/healer 线路", () => {
    expect(PB_SQUAD_COMPOUNDS.attack).toBe("XUH2O");
    expect(PB_SQUAD_COMPOUNDS.heal).toBe("XLHO2");
  });

  it("需求 = 规划人数 × 匹配部件数 × 30（引擎 boostCreep 消耗）", () => {
    // RCL8 顶档 boosted 编队：2 attacker×20A + 8 healer×8H。
    const need = pbSquadBoostNeed(2, 20, 8, 8);
    expect(need.attackUnits).toBe(1200);
    expect(need.healUnits).toBe(1920);
  });
});

describe("isPbBoostStockSufficient — 原子判定（单边禁止）", () => {
  const need = { attackUnits: 1200, healUnits: 1920 };
  const RESERVE = 100;

  it("两种化合物都够 reserve+需求 → true", () => {
    expect(isPbBoostStockSufficient(need, { XUH2O: 1300, XLHO2: 2020 }, RESERVE)).toBe(true);
  });

  it("只够 attack（XUH2O）→ false：单边 boost 会让反弹/治疗失配", () => {
    expect(isPbBoostStockSufficient(need, { XUH2O: 1300, XLHO2: 1900 }, RESERVE)).toBe(false);
  });

  it("只够 heal（XLHO2）→ false：killWindow 打不进，kill 超寿命", () => {
    expect(isPbBoostStockSufficient(need, { XUH2O: 1200, XLHO2: 2020 }, RESERVE)).toBe(false);
  });

  it("reserve 保留量不参与供给（库存 = reserve 时视为缺料）", () => {
    expect(isPbBoostStockSufficient(need, { XUH2O: 1300, XLHO2: 2020 }, 1920)).toBe(false);
  });
});

describe("lab-system — PB 野采前馈接线", () => {
  it("powerFarmMissions 含本房 sponsor + 化合物缺口 → 前馈 XUH2O（与 war 同链）", () => {
    g.Game.rooms = { W7N4: {} };
    g.Game.creeps = {};
    g.Memory.rooms = { W7N4: {} };
    g.Memory.kernel = {
      powerFarmMissions: [{ targetRoom: "W2N1", sponsor: "W7N4", since: 900, spawned: 0 }],
    };
    const snap = mockSnapshot({
      rcl: 6,
      labs: [makeLab("L1", 25, 25), makeLab("L2", 26, 25), makeLab("L3", 25, 26)],
      storage: { id: "stor1", store: { energy: 5000, ...ALL_BASE_MINERALS } } as any,
    });
    labSystem.run(mockContext(snap));
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XUH2O");
  });

  it("PB 任务 sponsor 为他房 → 本房不受影响（默认 XGH2O）", () => {
    g.Game.rooms = { W7N4: {} };
    g.Game.creeps = {};
    g.Memory.rooms = { W7N4: {} };
    g.Memory.kernel = {
      powerFarmMissions: [{ targetRoom: "W2N1", sponsor: "W9N9", since: 900, spawned: 0 }],
    };
    const snap = mockSnapshot({
      rcl: 6,
      labs: [makeLab("L1", 25, 25), makeLab("L2", 26, 25), makeLab("L3", 25, 26)],
      storage: { id: "stor1", store: { energy: 5000, ...ALL_BASE_MINERALS } } as any,
    });
    labSystem.run(mockContext(snap));
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });
});

// ─── 5. G 威慑优先于反应链（2026-10-18 人拍板）──────────────

/** 预置一份"目标已被经济链占住"的 industry 段 —— 抢占用例的前置状态。 */
const LATCHED_XGH2O = {
  reactionTarget: "XGH2O",
  reactionAmount: 300,
  reactionPlan: {
    target: "XGH2O",
    targetAmount: 300,
    steps: [{ input1: "X", input2: "GH2O", output: "XGH2O", amount: 290 }],
  },
};

describe("lab-system — G 备弹抢占经济反应目标", () => {
  it("目标已被 XGH2O 占住 + nuker 缺 G → 抢占为 G 并清掉旧计划", () => {
    // 现场账（官服 shard3 tick 83,725,855）：nuker.G = 0 对备弹目标 5,000，
    // 帝国 G 合计仅 4,500（W37S58 terminal 4,200 + storage 300）⇒ 连装满都不够；
    // 而 XGH2O 链的第一步正是 G+H→GH —— 经济链每消耗 1 单位 G，备弹就少 1 单位。
    // 旧码整块裹在 `if (!industryMem.reactionTarget)` 里 ⇒ 经济目标先占住就永远赢。
    runLabSystem(
      { G: 4500, ZK: 1000, UL: 1000 },
      "develop",
      undefined,
      { energy: 0, G: 0 },
      LATCHED_XGH2O,
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("G");
    expect(g.Memory.rooms.W7N4.industry.reactionAmount).toBe(CONFIG.nuker.ghodiumStockpile);
    // 旧计划必须被清掉：reactionPlan 按目标缓存，留着 XGH2O 的步骤表就会拿它去装料。
    expect(g.Memory.rooms.W7N4.industry.reactionPlan?.target).not.toBe("XGH2O");
  });

  it("nuker G 已装满 → 不抢占，经济目标原样保留", () => {
    runLabSystem(
      { G: 4500, ZK: 1000, UL: 1000 },
      "develop",
      undefined,
      { energy: 300000, G: CONFIG.nuker.ghodiumStockpile },
      LATCHED_XGH2O,
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("nuker + 库存合计达标 → 不抢占（口径是合计，不是只看 nuker）", () => {
    runLabSystem(
      { G: CONFIG.nuker.ghodiumStockpile, ZK: 1000, UL: 1000 },
      "develop",
      undefined,
      { energy: 0, G: 0 },
      LATCHED_XGH2O,
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("本房无 nuker → 不抢占（G 无消费方，抢了就是白扔半成品）", () => {
    runLabSystem({ G: 0, ZK: 1000, UL: 1000 }, "develop", undefined, undefined, LATCHED_XGH2O);
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("XGH2O");
  });

  it("war 姿态 → 不让 G 抢占（war 前馈 > 威慑备弹 > 经济 boost，沿用既有优先序）", () => {
    runLabSystem(
      { G: 4500, ZK: 1000, UL: 1000, XUH2O: 0 },
      "war",
      { targetRoom: "W6N4", sponsor: "W7N4", phase: "build" },
      { energy: 0, G: 0 },
      LATCHED_XGH2O,
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).not.toBe("G");
  });

  it("已经是 G 目标 → 不重复抢占（否则会每拍清计划、永远规划不出一步）", () => {
    const seeded = {
      reactionTarget: "G",
      reactionAmount: CONFIG.nuker.ghodiumStockpile,
      reactionPlan: {
        target: "G",
        targetAmount: CONFIG.nuker.ghodiumStockpile,
        steps: [{ input1: "ZK", input2: "UL", output: "G", amount: 500 }],
      },
    };
    runLabSystem(
      { G: 4500, ZK: 1000, UL: 1000 },
      "develop",
      undefined,
      { energy: 0, G: 0 },
      seeded,
    );
    expect(g.Memory.rooms.W7N4.industry.reactionTarget).toBe("G");
    // 计划必须原样留着 —— 被清掉就等于每拍重规划，反应永远推不进一步。
    expect(g.Memory.rooms.W7N4.industry.reactionPlan?.target).toBe("G");
  });
});
