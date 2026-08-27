/** E2E 场景夹具 — 基于 Screeps 真实常量构建标准房间。 */
import { WorldBuilder, type RoomSetup, source, controller, mineral, spawn, emptyTerrain } from "../framework/WorldBuilder";

/**
 * 标准单房间：spawn + 2 source + 1 controller + 1 mineral。
 * 地形全平原，spawn 在中心 (25,25)。

 * @param roomName 房间名
 * @param spawnEnergy spawn 初始能量（默认 300，灾后恢复用）
 * @param rcl controller 初始等级（默认 1）
 */
export function standardRoom(
  roomName: string,
  spawnEnergy = 300,
  rcl = 1,
): RoomSetup {
  return {
    name: roomName,
    terrain: emptyTerrain(),
    objects: [
      controller(10, 10, rcl),
      source(10, 40),
      source(40, 10),
      mineral(40, 40),
      spawn(25, 25, "Spawn1", spawnEnergy),
    ],
  };
}

/**
 * 灾后恢复房间：只有 spawn（300 能量），controller level 1，无 creep。
 * 用于测试 P0 灾后恢复逻辑。
 */
export function disasterRoom(roomName: string): RoomSetup {
  return standardRoom(roomName, 300, 1);
}

/**
 * RCL4 房间：已有 storage 建造需求，验证 storage 优先级。
 * controller level 4，spawn 满，5 个 extension。
 */
export function rcl4Room(roomName: string): RoomSetup {
  const room = standardRoom(roomName, 300, 4);
  // extension 位置（5 个，RCL2 解锁）
  room.objects!.push(
    { type: "extension", x: 22, y: 22, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 28, y: 22, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 22, y: 28, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 28, y: 28, props: { energy: 50, energyCapacity: 50 } },
    { type: "extension", x: 25, y: 20, props: { energy: 50, energyCapacity: 50 } },
  );
  return room;
}

/**
 * RCL3 房间：有 tower，验证防御逻辑。
 * controller level 3，1 个 tower（空能量）。
 */
export function rcl3RoomWithTower(roomName: string): RoomSetup {
  const room = standardRoom(roomName, 300, 3);
  room.objects!.push(
    { type: "tower", x: 20, y: 20, props: { energy: 0, energyCapacity: 1000 } },
  );
  return room;
}

/**
 * 双房间布局：用于 remote mining 场景。
 * 主房 W0N1（有 spawn），remote 房 W0N0（只有 source，无 spawn）。
 */
export function remoteMiningRooms(): RoomSetup[] {
  return [
    standardRoom("W0N1", 300, 3),
    {
      name: "W0N0",
      terrain: emptyTerrain(),
      objects: [
        controller(10, 10, 0), // 未占领
        source(10, 40),
        source(40, 10),
        mineral(40, 40),
      ],
    },
  ];
}
