/**
 * #102 — 执行闸 GATE_THREAT_UNCHANGED 接上真数据。
 *
 * 钉的是四件事，每件都对应一个我核过的失败模式：
 * 1. **它真的会拒绝**：目标房有威胁 creep / 有敌方塔 / sponsor 正被打 ⇒ 不消费、不建档，
 *    且计划**留在 WAITING_EXECUTION**（这条不是硬失败闸门 ⇒ 不该取消、不该吃重建冷却）。
 * 2. **它不是永真闸**（原缺陷正是永真）：控制组——干净的可见目标必须被消费。
 * 3. **它不是永假闸**：判据取 RED（shouldAbort）而不是"非 GREEN"。预约这类 YELLOW 由更硬的
 *    `GATE_TARGET_CLAIMABLE` 处理并**取消整条计划**，所以这里断言的是那一侧的行为，两层不打架。
 * 4. **威胁口径 = threatCreeps 而不是 hostileCreeps**：只有 move 的过境单位不该冻结扩张
 *    （同 room-snapshot 的注释理由：否则一个过路 scout 就能把经济钉死）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { tryConsumePlan } from "../../../src/systems/empire/expansion/plan-adapter";
import { mockRoomStateCtx, mockSnapshot, resetGlobals } from "../../support/factories";

const TICK = 8000;
const SPONSOR = "W7N4";
const TARGET = "W8N4";

const G = () => globalThis as any;

function creep(body: string[], owner = "Rival"): any {
  return { owner: { username: owner }, body: body.map(t => ({ type: t })), ticksToLive: 1000 };
}

function tower(): any {
  return { structureType: STRUCTURE_TOWER, hits: 1000, hitsMax: 8000 };
}

/** 目标房夹具：可见、controller 无人无预约 ⇒ 可 claim（除威胁那一层外全绿）。 */
function targetRoom(opts: { creeps?: any[]; structures?: any[]; reservation?: any } = {}): any {
  return {
    name: TARGET,
    controller: { my: false, owner: undefined, reservation: opts.reservation },
    find: (type: number) => {
      if (type === FIND_HOSTILE_CREEPS) return opts.creeps ?? [];
      if (type === FIND_HOSTILE_STRUCTURES) return opts.structures ?? [];
      return [];
    },
  };
}

function memoryPlan(st = "WAITING_EXECUTION"): any {
  return {
    pid: `${TARGET}#${TICK - 100}`,
    rn: TARGET,
    sr: SPONSOR,
    rs: "resource",
    pr: "P1",
    sc: 70,
    tc: 5000,
    pb: 1000,
    roi: 2,
    rk: 20,
    rl: "LOW",
    st,
    ca: TICK - 100,
    ua: TICK - 100,
    aa: TICK - 50,
    ex: "",
  };
}

function setup(world: { target?: any; sponsorThreats?: any[] } = {}): void {
  resetGlobals();
  G().Game.time = TICK;
  // GCL 余量与"是哪条计划"无关，但它在消费循环**之前**：`gclLevel <= ownedCount` 直接 return。
  // 不设 gcl ⇒ 默认 1、自有房 1 ⇒ 整条管道压根没跑到闸门，控制组会假绿/假红都说不清。
  G().Game.gcl = { level: 5 };
  G().Game.rooms = {
    [SPONSOR]: {
      name: SPONSOR,
      controller: { my: true, owner: { username: "Me" } },
      // 扩张预算按可见房储能 ×0.3 计 ⇒ 20000 → 6000 ≥ 成本 5000，预算门让路。
      storage: { store: { [RESOURCE_ENERGY]: 20000, getUsedCapacity: () => 20000 } },
      find: () => [],
    },
    ...(world.target ? { [TARGET]: world.target } : {}),
  };
  G().Memory.rooms = { [SPONSOR]: { spawnQueue: [], buildQueue: [] } };
  G().Memory.kernel = {
    strategy: { posture: "expand", expansionAllowed: true },
    expansionPlans: [memoryPlan()],
  };
}

function consume(world: { target?: any; sponsorThreats?: any[] } = {}): void {
  setup(world);
  tryConsumePlan(
    mockRoomStateCtx(
      [
        mockSnapshot({
          roomName: SPONSOR,
          rcl: 8,
          spawns: [{} as never],
          threatCreeps: world.sponsorThreats ?? [],
        }),
      ],
      TICK,
    ),
  );
}

beforeEach(() => {
  resetGlobals();
});

describe("#102 拒绝危险目标", () => {
  it("目标房有威胁 creep ⇒ 不建档、计划留在 WAITING_EXECUTION（不是取消）", () => {
    consume({ target: targetRoom({ creeps: [creep(["attack", "move"])] }) });

    expect(G().Memory.kernel.expansion).toBeUndefined();
    expect(G().Memory.kernel.expansionPlans[0].st).toBe("WAITING_EXECUTION");
  });

  it("目标房有敌方塔 ⇒ 同样拒绝（creep 可以不在场）", () => {
    consume({ target: targetRoom({ structures: [tower()] }) });

    expect(G().Memory.kernel.expansion).toBeUndefined();
    expect(G().Memory.kernel.expansionPlans[0].st).toBe("WAITING_EXECUTION");
  });

  it("sponsor 正被打 ⇒ 拒绝，即使目标房本身干净", () => {
    consume({
      target: targetRoom(),
      sponsorThreats: [creep(["attack"], "Me_rival")],
    });

    expect(G().Memory.kernel.expansion).toBeUndefined();
  });
});

describe("#102 控制组：它不是永真闸，也不是永假闸", () => {
  it("可见且无敌情的目标必须被消费（这条正是旧代码永真通过时唯一的'对'）", () => {
    consume({ target: targetRoom() });

    expect(G().Memory.kernel.expansion).toBeDefined();
    expect(G().Memory.kernel.expansion.target).toBe(TARGET);
  });

  it("只有 move 的过境单位不是威胁 ⇒ 仍消费（口径取 threatCreeps 而非 hostileCreeps）", () => {
    consume({ target: targetRoom({ creeps: [creep(["move", "carried"])] }) });

    expect(G().Memory.kernel.expansion).toBeDefined();
  });

  it("同盟表为空（`CONFIG.defense.allies=[]`）⇒ 陌生名字的战斗单位就算威胁", () => {
    // 我原先写的是"盟友单位不算威胁 ⇒ 仍消费"——那是我的假设，不是现场事实：
    // 本仓 allies 表当前为空数组，任何带攻击部件的他名字都进 threatCreeps。
    // 盟友豁免那条分支由 classifyThreats 自己的用例负责，本文件不重复测（避免测自己手拼的夹具）。
    consume({ target: targetRoom({ creeps: [creep(["attack", "heal"], "Allie")] }) });

    expect(G().Memory.kernel.expansion).toBeUndefined();
    expect(G().Memory.kernel.expansionPlans[0].st).toBe("WAITING_EXECUTION");
  });
});

describe("#102 与更硬闸门的分工（YELLOW 不在本层判）", () => {
  it("controller 被预约 ⇒ 由 GATE_TARGET_CLAIMABLE 取消整条计划，本闸不参与", () => {
    consume({
      target: targetRoom({ reservation: { username: "Rival", ticksToLive: 100 } }),
    });

    expect(G().Memory.kernel.expansion).toBeUndefined();
    // 取消而不是暂缓：这是"这地方现在根本不能 claim"，与"有敌情、等等再看"是两回事。
    expect(G().Memory.kernel.expansionPlans[0].st).toBe("CANCELLED");
  });
});
