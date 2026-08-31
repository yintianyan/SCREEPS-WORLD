/** War Planner 系统测试（R3 战时闭环 + R4 自治升级）。 */
import { beforeEach, describe, expect, it } from "vitest";
import { demobilize, warPlannerSystem } from "../../../src/systems/war-planner";
import { intelligenceSystem, __resetIntelStateForTests } from "../../../src/systems/intelligence";
import { globalCache } from "../../../src/kernel/global-cache";
import { mockContext, mockSnapshot, resetGlobals, syncSquadIndex } from "../../support/factories";
import { CONFIG } from "../../../src/config";

const TICK = 1000;

beforeEach(() => {
  resetGlobals();
});

function setPosture(posture: "develop" | "expand" | "fortify" | "war"): void {
  (globalThis as any).Memory.kernel.strategy = {
    posture,
    since: 900,
    expansionAllowed: posture === "expand",
    newRemoteOpsAllowed: posture === "develop" || posture === "expand",
  };
}

/** 经观察交接通道播种情报（与生产采集路径一致）：写 handoff → intelligence 采用。 */
function seedIntel(entries: Record<string, Record<string, unknown>>): void {
  __resetIntelStateForTests();
  const g = globalCache();
  g.intelHandoff = Object.entries(entries).map(([subject, p]) => ({
    subject,
    home: "W7N4",
    source: "observer" as const,
    payload: { kind: "normal", status: "normal", lastSeen: 900, ...p } as never,
  }));
  intelligenceSystem.run(mockContext(mockSnapshot()));
}

/** 建立 home 房：我方控制器 + 邻居情报（默认 W6N4 合格 / W6N5 SK 不合格）。 */
function setupHome(extraIntel: Record<string, any> = {}): void {
  (globalThis as any).Game.rooms = {
    W7N4: { controller: { my: true, owner: { username: "Me" } } },
  };
  (globalThis as any).Memory.rooms.W7N4 = { spawnQueue: [] };
  seedIntel({
    W6N4: { owner: "Enemy", towers: 0 },
    W6N5: { kind: "sk", owner: "Enemy", towers: 0 },
    ...extraIntel,
  });
}

/** 在役编队计数（live）— heal-tank：attacker + healer 都计入编制。
 * boosted：注入 body 带 boost 标记的成员数（自下而上派生口径与生产一致）。 */
function setLiveSquad(attackers: number, healers = 0, boosted = 0): void {
  const creeps: Record<string, any> = {};
  let boostedLeft = boosted;
  const bodyFor = (): { type: string; boost?: string }[] =>
    boostedLeft-- > 0
      ? [{ type: "attack", boost: "XUH2O" }, { type: "move" }]
      : [{ type: "attack" }, { type: "move" }];
  for (let i = 0; i < attackers; i++) {
    creeps[`a${i}`] = {
      memory: { role: "attacker", home: "W7N4", remoteTarget: "W6N4" },
      body: bodyFor(),
    };
  }
  for (let i = 0; i < healers; i++) {
    creeps[`h${i}`] = {
      memory: { role: "healer", home: "W7N4", remoteTarget: "W6N4" },
      body: bodyFor(),
    };
  }
  (globalThis as any).Game.creeps = creeps;
  syncSquadIndex();
}

/** 读取 WarOutcome 事件（kind=23）列表。 */
function warOutcomeEvents(): any[] {
  const events = (globalThis as any).eventBuffer?.events ?? [];
  return events.filter((e: any) => e.k === 23);
}

describe("R3 — 姿态消费与编队孵化", () => {
  it("war 姿态 + 合法目标 → 发布 warPlan（build 相位）并推 attacker + healer 首请求", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.targetRoom).toBe("W6N4");
    expect(plan.sponsor).toBe("W7N4");
    expect(plan.squadSize).toBe(3); // 无 tower 基数 3
    expect(plan.phase).toBe("build"); // 新计划从集结开始
    // heal-tank：同轮补 attacker(1) + healer(1) 两个请求。
    expect(plan.spawned).toBe(2);

    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue.length).toBe(2);
    const roles = queue.map((r: any) => r.role).sort();
    expect(roles).toEqual(["attacker", "healer"]);
    expect(queue[0].memory.remoteTarget).toBe("W6N4");
  });

  it("编队缺口逐步补齐到合计编制（key 稳定不重复，spawned 同步累计）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");

    const ctx = mockContext(mockSnapshot());
    warPlannerSystem.run(ctx);
    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    // 每轮每 role 至多 1 个新 key：首轮 attacker + healer。
    expect(queue.length).toBe(2);

    // 第 2 次运行：pending 各 1 → 再各补 1 个。
    warPlannerSystem.run(ctx);
    expect(queue.length).toBe(4);

    // 第 3 次运行：attacker 满编制 3（停止），healer 满编制 2（停止）→ 封顶 5。
    warPlannerSystem.run(ctx);
    expect(queue.length).toBe(5);

    // spawned 只随新 key 递增：与队列长度一致。
    expect((globalThis as any).Memory.kernel.warPlan.spawned).toBe(5);
  });

  it("在役满编（attacker+healer 合计 ≥ 编制）→ phase advance，不再补请求", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    // 编制 = squadSize 3 + healer 2 = 5（合计口径）。
    setLiveSquad(3, 2);

    warPlannerSystem.run(mockContext(mockSnapshot()));

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.phase).toBe("advance");
    expect(plan.spawned).toBe(0); // 满编 — 无新提交
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
  });

  it("只有 attacker 满（缺 healer）→ 仍 build 相位（缺奶不成编队）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    setLiveSquad(3, 0);

    warPlannerSystem.run(mockContext(mockSnapshot()));

    const plan = (globalThis as any).Memory.kernel.warPlan;
    expect(plan.phase).toBe("build");
    // 只补 healer 缺口。
    const queue = (globalThis as any).Memory.rooms.W7N4.spawnQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].role).toBe("healer");
  });

  it("无合格目标 → 不发布 warPlan", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    // 使唯一合格目标失效：owner 清空（无主房不是战争目标）。
    seedIntel({ W6N4: { towers: 0 } });

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
  });
});

describe("R4 — 收摊与战后核验", () => {
  function warPlanFixture(overrides: Record<string, any> = {}): void {
    (globalThis as any).Memory = {
      schemaVersion: 27,
      creeps: {},
      rooms: {
        W7N4: {
          spawnQueue: [
            {
              key: "attacker:W7N4:W6N4:0", role: "attacker", home: "W7N4", priority: 2,
              body: ["attack", "move"], memory: { role: "attacker", home: "W7N4", remoteTarget: "W6N4" },
              createdAt: 900, expiresAt: 1900, retries: 0,
            },
          ],
        },
      },
      kernel: {
        strategy: { posture: "war", since: 900, expansionAllowed: false, newRemoteOpsAllowed: false },
        warPlan: { targetRoom: "W6N4", sponsor: "W7N4", squadSize: 1, since: 900, towersSeen: 2, ...overrides },
      },
    };
    (globalThis as any).Game.creeps = {
      a1: { memory: { role: "attacker", home: "W7N4", remoteTarget: "W6N4" } },
      h1: { memory: { role: "healer", home: "W7N4", remoteTarget: "W6N4" } },
    };
    seedIntel({ W6N4: { owner: "Enemy", towers: 1 } });
    syncSquadIndex();
  }

  it("非 war 姿态 → 收摊：核验 failure → 黑名单 + 清计划 + 撤请求 + 回收编队（含 healer）", () => {
    warPlanFixture();
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);
    expect((globalThis as any).Game.creeps.a1.memory.recycle).toBe(true);
    // heal-tank：healer 与 attacker 同收（独存奶车无意义）。
    expect((globalThis as any).Game.creeps.h1.memory.recycle).toBe(true);
    // 塔网未清零（towersSeen=2，intel towers=1）且敌主仍在 → failure → 黑名单。
    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + CONFIG.war.warBlacklistTicks);
    // 黑匣子事件：outcome=failure(1)。
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(1);
  });

  it("核验 success（塔网清零）→ 不黑名单", () => {
    warPlanFixture();
    seedIntel({ W6N4: { owner: "Enemy", towers: 0 } });
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warBlacklist).toBeUndefined();
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(0);
  });

  it("核验 success（敌人弃房）→ 不黑名单", () => {
    warPlanFixture({ towersSeen: 0 }); // 无塔目标：弃房即胜利
    seedIntel({ W6N4: { towers: 1 } });
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warBlacklist).toBeUndefined();
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(0);
  });

  it("核验 success 但情报已超威胁短窗（非 fact）→ 降级 unknown（战后核验只信 fact 级复核）", () => {
    warPlanFixture();
    // towers 清零但观察已 300 tick（> 威胁短窗 200，< freshness 1500）——
    // 旧口径判 success，硬门槛口径降级 unknown（两段式重验）。
    seedIntel({ W6N4: { owner: "Enemy", towers: 0, lastSeen: TICK - 300 } });
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    // unknown → 半额冷却。
    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + Math.floor(CONFIG.war.warBlacklistTicks / 2));
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(2);
  });

  it("核验 unknown（情报过期）→ 黑名单（半额冷却 — P0-2 区分 “打不赢” 与 “没看到”）", () => {
    warPlanFixture();
    seedIntel({ W6N4: { owner: "Enemy", towers: 1, lastSeen: -600 } }); // 距今 1600 > freshness 1500
    setPosture("develop");

    warPlannerSystem.run(mockContext(mockSnapshot()));

    // P0-2：unknown 用半额冷却 — intel 过期不是目标的错。
    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + Math.floor(CONFIG.war.warBlacklistTicks / 2));
    expect(warOutcomeEvents()[0]?.d?.[0]).toBe(2);
  });

  it("demobilize 幂等：重复调用仅动作一次", () => {
    warPlanFixture();
    seedIntel({ W6N4: { owner: "Enemy", towers: 0 } }); // success：免黑名单，聚焦幂等断言

    demobilize(TICK, 0);
    demobilize(TICK, 0);

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Game.creeps.a1.memory.recycle).toBe(true);
    // 第二次调用无计划可收 — 事件只记一次。
    expect(warOutcomeEvents()).toHaveLength(1);
  });
});

describe("R4 — 战损止损与波次相位", () => {
  it("spawned 超合计编制 × casualtyMultiplier → 收摊（attrition）+ 黑名单 + 整军休战", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "advance", spawned: 14, // 14 > (3+2 healers) × 2.5 = 12.5
    };

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.kernel.warBlacklist.W6N4).toBe(TICK + CONFIG.war.warBlacklistTicks);
    // 整军休战：止损后不立即换目标重开。
    expect((globalThis as any).Memory.kernel.warStandDownUntil).toBe(TICK + CONFIG.war.standDownTicks);
    // 收摊原因 = attrition(1)。
    expect(warOutcomeEvents()[0]?.d?.[2]).toBe(1);
  });

  it("休战期内（warStandDownUntil 未到）→ 不创建新战争计划", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warStandDownUntil = TICK + 500;

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
    expect((globalThis as any).Memory.rooms.W7N4.spawnQueue).toHaveLength(0);

    // 休战到期 → 恢复评估。
    (globalThis as any).Memory.kernel.warStandDownUntil = TICK - 1;
    warPlannerSystem.run(mockContext(mockSnapshot()));
    expect((globalThis as any).Memory.kernel.warPlan?.targetRoom).toBe("W6N4");
  });

  it("姿态退出 war → 清除休战闸（下次 re-war 不被旧休战期卡住）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("develop");
    (globalThis as any).Memory.kernel.warStandDownUntil = TICK + 5000;

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warStandDownUntil).toBeUndefined();
  });

  it("advance 残编（live < squadSize × regroupRatio）→ 回落 build 重组", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "advance", spawned: 3,
    };
    setLiveSquad(1); // 1 < (3+2) × 0.5 → 回落 build

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("build");
  });

  it("build 未满编保持 build；满编才转 advance（迟滞不抖动）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "build", spawned: 3,
    };
    setLiveSquad(2); // 2 ≥ 1.5 但 < 5（合计编制）→ 未满编仍 build

    warPlannerSystem.run(mockContext(mockSnapshot()));
    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("build");
  });

  it("黑名单目标不被重选（选次优）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome({
      W5N5: { kind: "normal", owner: "Enemy", lastSeen: 900, towers: 0, pathCost: 600 },
    });
    setPosture("war");
    (globalThis as any).Memory.kernel.warBlacklist = { W6N4: TICK + CONFIG.war.warBlacklistTicks };

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan.targetRoom).toBe("W5N5");
  });

  it("计划存续期间目标进黑名单 → 立即收摊（防绕过滤选回）", () => {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since: 900,
      towersSeen: 0, phase: "advance", spawned: 3,
    };
    (globalThis as any).Memory.kernel.warBlacklist = { W6N4: TICK + CONFIG.war.warBlacklistTicks };

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan).toBeUndefined();
  });
});

describe("boost 战前强化 — advance 门禁接线", () => {
  /** 建立满编编队（3 攻 + 2 奶 = 合计编制 5）+ 已存在的 build 相位计划。 */
  function setupFullSquad(boosted: number, since = 900): void {
    (globalThis as any).Memory = { schemaVersion: 27, creeps: {}, rooms: {}, kernel: {} };
    setupHome();
    setPosture("war");
    (globalThis as any).Memory.kernel.warPlan = {
      targetRoom: "W6N4", sponsor: "W7N4", squadSize: 3, since,
      towersSeen: 0, phase: "build", spawned: 5,
    };
    setLiveSquad(3, 2, boosted);
  }

  it("sponsor 有 lab + 满编但未全员强化 → 保持 build（等 lab boost 链完成）", () => {
    setupFullSquad(3); // 5 人中 3 人已强化
    const snap = mockSnapshot({ rcl: 6, labs: [{ id: "L1" } as any] });

    warPlannerSystem.run(mockContext(snap));

    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("build");
  });

  it("sponsor 有 lab + 满编且全员强化 → advance（强化完整才出征）", () => {
    setupFullSquad(5);
    const snap = mockSnapshot({ rcl: 6, labs: [{ id: "L1" } as any] });

    warPlannerSystem.run(mockContext(snap));

    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("advance");
  });

  it("sponsor 有 lab + 宽限期过（since 距今 > boostGraceTicks）→ 豁免裸攻推进", () => {
    // 缺矿房反应链产不出 T3，永久等待等于不打 — 止损链兜底裸攻。
    setupFullSquad(0, TICK - CONFIG.war.boostGraceTicks - 1);
    const snap = mockSnapshot({ rcl: 6, labs: [{ id: "L1" } as any] });

    warPlannerSystem.run(mockContext(snap));

    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("advance");
  });

  it("sponsor 无 lab → 门禁豁免，满编即 advance（低 RCL 房不受 boost 卡阻）", () => {
    setupFullSquad(0); // 无人强化
    // 默认 mockSnapshot：rcl 3 + labs [] → canBoost=false。

    warPlannerSystem.run(mockContext(mockSnapshot()));

    expect((globalThis as any).Memory.kernel.warPlan.phase).toBe("advance");
  });
});
