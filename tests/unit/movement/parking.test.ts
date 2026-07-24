/**
 * 归位（Parking）地形多样化测试矩阵。
 *
 * 验证 parkIdleCreep 通用算法对任意房间地形成立——不预设位置、不引用其他房间数据，
 * 完全从 per-room 快照（结构/工地）+ 地形 + 实时 creep 位置推导停车位。
 *
 * 核心不变量：
 *   1. 关键格（source/spawn/controller/storage/工地 旁 range≤1）上的 idle creep 必须离开。
 *   2. road 上的 idle creep 必须离开（road 是交通主干道）。
 *   3. 已安全的 creep 不动（防每 tick 重复寻路 + 防振荡）。
 *   4. 不走进墙、不走进阻挡结构。
 *   5. 多 creep 不聚堆（预约缓存保证各占不同格）。
 *
 * 地形覆盖：开阔平原 / 单格走廊（墙夹）/ 墙劈房间 / 角落 source / 多 creep 聚堆。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ScenarioBuilder, type TestWorld } from "../../integration/framework";
import { buildRoomSnapshot } from "../../../src/systems/room-snapshot";
import { parkIdleCreep, isSafeSpot } from "../../../src/creeps/movement";
import type { RoomSnapshot } from "../../../src/kernel/contracts";

const CARRY_MOVE = [{ type: "carry" }, { type: "move" }];

/** 构建世界 + 快照，返回 (world, snapshot)。controller 放到远角避免污染测试区关键格。 */
function setup(builder: ScenarioBuilder): { world: TestWorld; snapshot: RoomSnapshot } {
  const world = builder.build();
  world.installGlobals();
  const snapshot = buildRoomSnapshot(world.room as unknown as Room);
  return { world, snapshot };
}

function creepAt(world: TestWorld, name: string) {
  return world.creeps.find(c => c.name === name)!;
}

/**
 * 模拟多 tick 归位收敛。role-runner 每个 idle tick 调用 parkIdleCreep 一次，
 * 深陷 3×3 关键区中心的 creep 需要多 tick 逐步走出（单步只能移动一格）。
 * 返回实际移动步数。
 */
function parkUntilSafe(
  world: TestWorld,
  snapshot: RoomSnapshot,
  name: string,
  maxTicks = 6,
): number {
  const c = creepAt(world, name);
  let steps = 0;
  for (let i = 0; i < maxTicks; i++) {
    if (isSafeSpot(c as never, snapshot)) break;
    const px = c.pos.x;
    const py = c.pos.y;
    parkIdleCreep(c as never, snapshot);
    if (c.pos.x !== px || c.pos.y !== py) steps++;
  }
  return steps;
}

describe("Parking — 地形多样化矩阵", () => {
  beforeEach(() => {
    // 每个用例独立 TestWorld + installGlobals（清理 park 缓存），无需额外重置。
  });

  it("开阔平原：source 旁关键格的 creep 移到非关键格", () => {
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").flat().spawn("Spawn1", 40, 40).source("s1", 25, 25),
    );
    // (25,25) 是 source 格 → 3×3 关键区中心。
    world.addCreep("c1", "hauler", 25, 25, CARRY_MOVE);
    const c = creepAt(world, "c1");
    expect(isSafeSpot(c as never, snapshot)).toBe(false);

    // 深陷关键区中心，需多 tick 逐步走出（role-runner 每 idle tick 调用一次 park）。
    parkUntilSafe(world, snapshot, "c1");

    // 离开 source 3×3 关键区，且仍在平地。
    const dist = Math.max(Math.abs(c.pos.x - 25), Math.abs(c.pos.y - 25));
    expect(dist).toBeGreaterThanOrEqual(2);
    expect(isSafeSpot(c as never, snapshot)).toBe(true);
  });

  it("开阔平原：已在安全格的 creep 不动", () => {
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").flat().spawn("Spawn1", 40, 40).source("s1", 25, 25),
    );
    // (30,30) 远离 source(25,25) 与 spawn(40,40)，非关键、非 road。
    world.addCreep("c1", "hauler", 30, 30, CARRY_MOVE);
    const c = creepAt(world, "c1");
    expect(isSafeSpot(c as never, snapshot)).toBe(true);

    parkIdleCreep(c as never, snapshot);

    expect(c.pos.x).toBe(30);
    expect(c.pos.y).toBe(30);
  });

  it("单格走廊：墙夹通道上的 creep 让出通道", () => {
    // 上下两排墙夹出 y=25 走廊，creep 停在走廊关键格上必须让到走廊外。
    const walls = [];
    for (let x = 20; x <= 30; x++) {
      walls.push({ x, y: 24 }, { x, y: 26 });
    }
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").walls(walls).spawn("Spawn1", 40, 40).source("s1", 25, 25),
    );
    // (26,25) 在走廊内且 source 旁（关键格）。走廊内 y 只能是 25。
    world.addCreep("c1", "hauler", 26, 25, CARRY_MOVE);
    const c = creepAt(world, "c1");

    parkIdleCreep(c as never, snapshot);

    // 离开 source 关键区；走廊被墙夹，唯一出路是向东走到 (27,25)/(28,25)（仍 y=25 但远离 source）。
    const dist = Math.max(Math.abs(c.pos.x - 25), Math.abs(c.pos.y - 25));
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  it("墙劈房间：creep 不会穿墙", () => {
    // x=27 一堵南北向墙把房间劈成东西两半，source 在西半 (25,25)。
    const walls = [];
    for (let y = 10; y <= 40; y++) walls.push({ x: 27, y });
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").walls(walls).spawn("Spawn1", 40, 40).source("s1", 25, 25),
    );
    // (26,25) 紧贴墙西侧、source 旁关键格。东侧 (27,25) 是墙。
    world.addCreep("c1", "hauler", 26, 25, CARRY_MOVE);
    const c = creepAt(world, "c1");

    parkUntilSafe(world, snapshot, "c1");

    // 不能穿墙到 x>=27。
    expect(c.pos.x).toBeLessThanOrEqual(26);
    // 离开了 source 关键区。
    const dist = Math.max(Math.abs(c.pos.x - 25), Math.abs(c.pos.y - 25));
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  it("角落 source：边界外视为墙，creep 留在房间内", () => {
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").flat().spawn("Spawn1", 40, 40).source("s1", 0, 0),
    );
    // (1,1) 在角落 source 的 3×3 关键区内，且西北两侧是房间边界外（墙）。
    world.addCreep("c1", "hauler", 1, 1, CARRY_MOVE);
    const c = creepAt(world, "c1");

    parkIdleCreep(c as never, snapshot);

    // 仍在房间内（不出界），且离开角落关键区。
    expect(c.pos.x).toBeGreaterThanOrEqual(0);
    expect(c.pos.x).toBeLessThanOrEqual(49);
    expect(c.pos.y).toBeGreaterThanOrEqual(0);
    expect(c.pos.y).toBeLessThanOrEqual(49);
    const dist = Math.max(Math.abs(c.pos.x - 0), Math.abs(c.pos.y - 0));
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  it("多 creep 聚堆：预约缓存保证各占不同格", () => {
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").flat().spawn("Spawn1", 40, 40).source("s1", 25, 25),
    );
    // 两只 creep 都在 source 旁关键格，相邻。
    world.addCreep("c1", "hauler", 25, 25, CARRY_MOVE);
    world.addCreep("c2", "hauler", 26, 25, CARRY_MOVE);
    const c1 = creepAt(world, "c1");
    const c2 = creepAt(world, "c2");

    parkUntilSafe(world, snapshot, "c1");
    parkUntilSafe(world, snapshot, "c2");

    // 两只都离开关键区，且互不重叠（hasCreepAt 守卫杜绝物理撞格）。
    expect(isSafeSpot(c1 as never, snapshot)).toBe(true);
    expect(isSafeSpot(c2 as never, snapshot)).toBe(true);
    expect(c1.pos.x === c2.pos.x && c1.pos.y === c2.pos.y).toBe(false);
  });

  it("spawn 旁关键格：孵化出口前的 creep 让开", () => {
    const { world, snapshot } = setup(
      new ScenarioBuilder("W1N1").flat().spawn("Spawn1", 25, 25).source("s1", 5, 5),
    );
    // (25,26) 在 spawn(25,25) 旁关键格（堵孵化出口）。
    world.addCreep("c1", "hauler", 25, 26, CARRY_MOVE);
    const c = creepAt(world, "c1");
    expect(isSafeSpot(c as never, snapshot)).toBe(false);

    parkIdleCreep(c as never, snapshot);

    // 离开 spawn 3×3 关键区。
    const dist = Math.max(Math.abs(c.pos.x - 25), Math.abs(c.pos.y - 25));
    expect(dist).toBeGreaterThanOrEqual(2);
  });
});
