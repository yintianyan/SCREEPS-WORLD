/**
 * Hauler 角色场景测试。
 *
 * 覆盖：capped withdraw、reservation 去重、controller container 优先补给、
 * fallback 链（storage → upgrade → idle）、无 WORK 部件不采集、flee。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { haulerRole } from "../src/creeps/roles/hauler";
import { harvesterRole } from "../src/creeps/roles/harvester";
import {
  mockContext,
  mockController,
  mockCreep,
  mockHostile,
  mockSnapshot,
  mockSource,
  mockStructure,
  resetGlobals,
} from "./role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("hauler — acquire 模式", () => {
  it("从最满 container 限量 withdraw（capped withdraw）", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const c2 = mockStructure("container", { id: "c2", energy: 200, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1, c2] });
    // hauler 空载，容量 100。
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // 应选最满的 c1，withdraw min(800, 100) = 100。
    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy", 100);
  });

  it("container 可用量 < carryFree 时取可用量", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 30, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // min(30, 100) = 30。
    expect(creep.withdraw).toHaveBeenCalledWith(c1, "energy", 30);
  });

  it("container 空时进入 idle（不尝试 harvest）", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 0, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("无 container 时不从 storage 取能（hauler 是收集者，storage 取能由 distributor 负责）", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 5000, capacity: 100000 });
    const snap = mockSnapshot({ containers: [], storage });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // hauler 永不从 storage 取能 — 这是 distributor 的职责。
    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.memory.mode).toBe("idle");
  });

  it("无任何能量来源时 idle", () => {
    const snap = mockSnapshot({ containers: [], storage: undefined });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("assignment sourceId 指定 container 时优先使用", () => {
    const c1 = mockStructure("container", { id: "c1", energy: 800, capacity: 2000 });
    const c2 = mockStructure("container", { id: "c2", energy: 200, capacity: 2000 });
    const snap = mockSnapshot({ containers: [c1, c2] });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 0,
      capacity: 100,
      mode: "acquire",
      assignment: { id: "t1", kind: "haul", sourceId: "c2", leaseUntil: 2000, revision: 1, assignedAt: 990 },
    });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // 应使用 assignment 指定的 c2 而非最满的 c1。
    expect(creep.withdraw).toHaveBeenCalledWith(c2, "energy", 100);
  });
});

describe("hauler — work 模式", () => {
  it("向 fillTarget 运送能量", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, "energy");
  });

  it("controller container 低于半满时优先补给", () => {
    const cc = mockStructure("container", { id: "cc1", energy: 100, capacity: 2000 }); // 远低于半满
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const snap = mockSnapshot({
      controllerContainer: cc,
      fillTargets: [spawn, cc],
    });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // controller container 低于半满 → 优先补给。
    expect(creep.transfer).toHaveBeenCalledWith(cc, "energy");
  });

  it("fillTargets 全满时回退到 storage", () => {
    const storage = mockStructure("storage", { id: "storage_1", energy: 0, capacity: 100000 });
    const snap = mockSnapshot({ fillTargets: [], storage });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.transfer).toHaveBeenCalledWith(storage, "energy");
  });

  it("controllerContainer 存在但已满时仍回退到 storage（不卡在 haulFillTarget）", () => {
    // 回归测试：haulFillTarget 的 predicate 曾包含 `|| controllerContainer !== undefined`，
    // 导致 controllerContainer 存在（即便已满、不在 fillTargets 中）时 predicate 返回 true，
    // execute 内 getHaulFillTarget 返回 undefined 后静默返回，
    // FSM 不再 fallthrough → fillStorage 永远不被执行 → storage 空置死锁。
    const cc = mockStructure("container", { id: "cc1", energy: 2000, capacity: 2000 }); // 满
    const storage = mockStructure("storage", { id: "storage_1", energy: 0, capacity: 100000 });
    const snap = mockSnapshot({
      controllerContainer: cc,
      fillTargets: [], // cc 已满，不在 fillTargets 中
      storage,
    });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // 必须穿透 haulFillTarget 到达 fillStorage。
    expect(creep.transfer).toHaveBeenCalledWith(storage, "energy");
  });

  it("无 storage 且所有 sink 满时原地待命（不升级控制器）", () => {
    const controller = mockController();
    const snap = mockSnapshot({ fillTargets: [], storage: undefined, controller });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // hauler 无 WORK 部件，不应调用 upgradeController（会 ERR_NO_BODYPART）。
    expect(creep.upgradeController).not.toHaveBeenCalled();
    // 所有 sink 满且无 storage — hauler 待命，不切换 mode（保持 work 等待 sink 释放容量）。
    expect(creep.memory.mode).not.toBe("acquire");
  });

  it("无任何目标时 idle", () => {
    const snap = mockSnapshot({ fillTargets: [], storage: undefined, controller: undefined });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("idle");
  });

  it("ERR_FULL 时触发 updateMode 切换", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 290, capacity: 300 });
    const snap = mockSnapshot({ fillTargets: [spawn] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    creep.transfer.mockReturnValue(-8); // ERR_FULL
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // ERR_FULL → updateMode → 仍有能量(80) → 保持 work。
    expect(creep.transfer).toHaveBeenCalled();
  });
});

describe("hauler — reservation 去重", () => {
  it("两个 hauler 不抢同一 fillTarget", () => {
    const spawn = mockStructure("spawn", { id: "sp1", energy: 100, capacity: 300 });
    const ext = mockStructure("extension", { id: "ext1", energy: 0, capacity: 50 });
    const snap = mockSnapshot({ fillTargets: [spawn, ext] });

    const hauler1 = mockCreep({ name: "hauler_1", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const hauler2 = mockCreep({ name: "hauler_2", role: "hauler", used: 80, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(hauler1, ctx);
    haulerRole.run(hauler2, ctx);

    // 第一个 hauler 预约了 spawn，第二个应拿到 ext（或回退）。
    const target1 = hauler1.transfer.mock.calls[0]?.[0];
    const target2 = hauler2.transfer.mock.calls[0]?.[0];
    // 两者不应同时是同一个对象（除非回退到共享）。
    if (target1 && target2) {
      expect(target1.id).not.toBe(target2.id);
    }
  });
});

describe("hauler — flee", () => {
  it("有敌人时进入 flee 且不执行经济动作", () => {
    const hostile = mockHostile();
    const snap = mockSnapshot({ hostileCreeps: [hostile] });
    const creep = mockCreep({ name: "hauler_1", role: "hauler", used: 50, capacity: 100, mode: "work" });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.withdraw).not.toHaveBeenCalled();
  });
});

/**
 * P0-2 修复：hauler 在 flee 状态下的"防御圈内安全充能"。
 *
 * 场景：战斗中 Tower 能量耗尽，hauler 全部 flee 到 spawn 旁。
 * 修复后：hauler 距 spawn ≤ safeRefuelRange(3) 且携带能量时，
 *         允许向防御圈内的需能量结构（threat 时 tower 优先）执行 transfer。
 *
 * 测试位置布局约束：
 *   - hostile 距 hauler ≤ fleeRange(10) → 触发 shouldFlee
 *   - hauler 距 spawn ≤ safeRefuelRange(3) → 在安全区内
 *   - hostile 距 spawn > safeRefuelRange(3) → 不在安全区
 *   - 目标(tower) 距 hostile > hauler 距 hostile → 目标不在敌人侧
 *
 * 设计要点：
 *   - G-SM-05 细化：移动阶段不动作，到达安全区后允许关键补给
 *   - 目标必须在防御圈内（距 spawn ≤ safeRange）
 *   - 目标不能在敌人侧（目标距敌人 < hauler 距敌人 → 不安全）
 *   - 优先级与 getHaulFillTarget 对齐：threat 时 tower 优先
 */
describe("hauler — flee 安全充能（P0-2）", () => {
  /**
   * 构造精确距离的 pos mock。
   * distances 是 "x,y" → 距离的映射，用于 getRangeTo(target) 的返回值。
   * target 的位置通过 target.pos.x/pos.y 推断。
   */
  function mockPosWithDistances(x: number, y: number, distances: Record<string, number>) {
    return {
      x,
      y,
      roomName: "W7N4",
      getRangeTo: vi.fn((target: { pos?: { x: number; y: number }; x?: number; y?: number }) => {
        const tx = target?.pos?.x ?? target?.x;
        const ty = target?.pos?.y ?? target?.y;
        const key = `${tx},${ty}`;
        return distances[key] ?? 1;
      }),
      getDirectionTo: vi.fn(() => 3),
      findClosestByRange: vi.fn((targets: any[]) => targets[0] ?? null),
      findPathTo: vi.fn(() => []),
    };
  }

  it("hauler 距 spawn ≤3 且携带能量时，threat 存在优先给 tower 充能", () => {
    // 布局：spawn(20,20) | hauler(21,21) | tower(22,22) | hostile(15,15)
    // hauler 距 spawn=1(安全区内), 距 tower=1, 距 hostile=8(≤fleeRange=10 触发 flee)
    // tower 距 spawn=2(安全区内), 距 hostile=10(>hauler 距 hostile=8, 不在敌人侧)
    // hostile 距 spawn=7(安全区外)
    const spawn = mockStructure("spawn", { id: "spawn_1", energy: 0, capacity: 300 });
    spawn.pos = mockPosWithDistances(20, 20, { "22,22": 2, "15,15": 7 });

    const tower = mockStructure("tower", { id: "tower_1", energy: 0, capacity: 1000 });
    tower.pos = mockPosWithDistances(22, 22, { "20,20": 2, "15,15": 10 });

    const hostile = mockHostile("hostile_1");
    hostile.pos = mockPosWithDistances(15, 15, { "20,20": 7, "22,22": 10 });

    const haulerPos = mockPosWithDistances(21, 21, { "20,20": 1, "22,22": 1, "15,15": 8 });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 50,
      capacity: 100,
      mode: "work",
      pos: haulerPos,
    });

    const snap = mockSnapshot({
      spawns: [spawn],
      towers: [tower],
      hostileCreeps: [hostile],
      threatCreeps: [hostile],
      fillTargets: [spawn, tower],
    });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    // 应进入 flee 模式但执行了 transfer（安全充能）
    expect(creep.memory.mode).toBe("flee");
    // threat 存在时 tower 优先，应给 tower transfer
    expect(creep.transfer).toHaveBeenCalledWith(tower, "energy");
  });

  it("hauler 距 spawn >3 时不执行安全充能（仍在移动到安全区）", () => {
    // 布局：spawn(20,20) | hauler(25,25) | hostile(28,28)
    // hauler 距 spawn=7(>3 不在安全区), 距 hostile=6(≤fleeRange 触发 flee)
    const spawn = mockStructure("spawn", { id: "spawn_1", energy: 0, capacity: 300 });
    spawn.pos = mockPosWithDistances(20, 20, { "25,25": 7, "28,28": 11 });

    const tower = mockStructure("tower", { id: "tower_1", energy: 0, capacity: 1000 });
    tower.pos = mockPosWithDistances(22, 22, { "20,20": 2 });

    const hostile = mockHostile("hostile_1");
    hostile.pos = mockPosWithDistances(28, 28, { "20,20": 11, "25,25": 6 });

    const haulerPos = mockPosWithDistances(25, 25, { "20,20": 7, "22,22": 5, "28,28": 6 });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 50,
      capacity: 100,
      mode: "work",
      pos: haulerPos,
    });

    const snap = mockSnapshot({
      spawns: [spawn],
      towers: [tower],
      hostileCreeps: [hostile],
      threatCreeps: [hostile],
      fillTargets: [spawn, tower],
    });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    // 距 spawn >3，不应执行充能
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("目标在敌人侧时不执行安全充能（避免向敌人移动）", () => {
    // 布局：spawn(20,20) | hauler(21,21) | hostile(22,22) | tower(25,25)
    // hauler 距 spawn=1(安全区), 距 hostile=1(触发 flee)
    // tower 距 spawn=5(>3 安全区外), 不应被选中
    const spawn = mockStructure("spawn", { id: "spawn_1", energy: 0, capacity: 300 });
    spawn.pos = mockPosWithDistances(20, 20, { "21,21": 1, "25,25": 7 });

    const tower = mockStructure("tower", { id: "tower_1", energy: 0, capacity: 1000 });
    tower.pos = mockPosWithDistances(25, 25, { "20,20": 7 });

    const hostile = mockHostile("hostile_1");
    hostile.pos = mockPosWithDistances(22, 22, { "20,20": 2, "21,21": 1, "25,25": 3 });

    const haulerPos = mockPosWithDistances(21, 21, { "20,20": 1, "22,22": 1, "25,25": 4 });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 50,
      capacity: 100,
      mode: "work",
      pos: haulerPos,
    });

    const snap = mockSnapshot({
      spawns: [spawn],
      towers: [tower],
      hostileCreeps: [hostile],
      threatCreeps: [hostile],
      fillTargets: [tower], // 只有 tower 在 fillTargets，spawn 已满
    });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    // tower 距 spawn=7 > safeRange=3，不在防御圈内，不应被选中
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("hauler 空载时不执行安全充能", () => {
    // 布局同测试 1，但 hauler 空载
    const spawn = mockStructure("spawn", { id: "spawn_1", energy: 0, capacity: 300 });
    spawn.pos = mockPosWithDistances(20, 20, { "22,22": 2, "15,15": 7 });

    const tower = mockStructure("tower", { id: "tower_1", energy: 0, capacity: 1000 });
    tower.pos = mockPosWithDistances(22, 22, { "20,20": 2, "15,15": 10 });

    const hostile = mockHostile("hostile_1");
    hostile.pos = mockPosWithDistances(15, 15, { "20,20": 7, "22,22": 10 });

    const haulerPos = mockPosWithDistances(21, 21, { "20,20": 1, "22,22": 1, "15,15": 8 });
    const creep = mockCreep({
      name: "hauler_1",
      role: "hauler",
      used: 0, // 空载
      capacity: 100,
      mode: "work",
      pos: haulerPos,
    });

    const snap = mockSnapshot({
      spawns: [spawn],
      towers: [tower],
      hostileCreeps: [hostile],
      threatCreeps: [hostile],
      fillTargets: [spawn, tower],
    });
    const ctx = mockContext(snap);

    haulerRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    // 空载，不应执行 transfer
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("非 hauler 角色不执行安全充能（harvester 仍只移动）", () => {
    // 布局同测试 1，但 creep 角色是 harvester
    const spawn = mockStructure("spawn", { id: "spawn_1", energy: 0, capacity: 300 });
    spawn.pos = mockPosWithDistances(20, 20, { "22,22": 2, "15,15": 7 });

    const tower = mockStructure("tower", { id: "tower_1", energy: 0, capacity: 1000 });
    tower.pos = mockPosWithDistances(22, 22, { "20,20": 2, "15,15": 10 });

    const hostile = mockHostile("hostile_1");
    hostile.pos = mockPosWithDistances(15, 15, { "20,20": 7, "22,22": 10 });

    const haulerPos = mockPosWithDistances(21, 21, { "20,20": 1, "22,22": 1, "15,15": 8 });
    const creep = mockCreep({
      name: "harvester_1",
      role: "harvester", // 非 hauler
      used: 50,
      capacity: 100,
      mode: "work",
      pos: haulerPos,
    });

    const snap = mockSnapshot({
      spawns: [spawn],
      towers: [tower],
      hostileCreeps: [hostile],
      threatCreeps: [hostile],
      fillTargets: [spawn, tower],
    });
    const ctx = mockContext(snap);

    // 用 harvester 角色运行
    harvesterRole.run(creep, ctx);

    expect(creep.memory.mode).toBe("flee");
    // 非 hauler 不执行安全充能
    expect(creep.transfer).not.toHaveBeenCalled();
  });
});
