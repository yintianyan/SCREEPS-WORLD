/** WorldBuilder — 精细控制 Screeps 世界构建。 */
import { TerrainMatrix } from "screeps-server-mockup";

/**
 * 创建空地形矩阵（全平原）。
 * 用法：const terrain = emptyTerrain(); terrain.set(10, 10, 'wall');
 */
export function emptyTerrain(): TerrainMatrix {
  return new TerrainMatrix();
}

/**
 * 创建带预设墙壁的地形矩阵。
 * @param walls 墙壁坐标列表 [[x,y], ...]
 */
export function terrainWithWalls(walls: Array<[number, number]>): TerrainMatrix {
  const terrain = emptyTerrain();
  for (const [x, y] of walls) {
    terrain.set(x, y, "wall");
  }
  return terrain;
}

/**
 * 房间对象规格。type 对应 Screeps 真实对象类型。
 */
export interface ObjectSpec {
  type:
    | "controller"
    | "source"
    | "mineral"
    | "spawn"
    | "extension"
    | "container"
    | "storage"
    | "tower"
    | "road"
    | "rampart"
    | "wall"
    | "link"
    | "constructedWall"
    | "terminal";
  x: number;
  y: number;
  /** 对象属性，如 source 的 energy/energyCapacity，controller 的 level */
  props?: Record<string, unknown>;
}

/**
 * 房间初始化规格。
 */
export interface RoomSetup {
  name: string;
  /** 地形矩阵。不传则全平原。 */
  terrain?: TerrainMatrix;
  /** 房间对象列表。 */
  objects?: ObjectSpec[];
  /** 是否为已激活房间（有 owner）。默认 false。 */
  active?: boolean;
}

/**
 * 世界构建器。封装 server.world 的房间/对象创建 API。
 */
export class WorldBuilder {
  constructor(private readonly world: any) {}

  /**
   * 添加一个房间并设置地形和对象。
   */
  async addRoom(setup: RoomSetup): Promise<void> {
    await this.world.addRoom(setup.name);

    if (setup.terrain) {
      await this.world.setTerrain(setup.name, setup.terrain);
    }

    if (setup.objects) {
      for (const obj of setup.objects) {
        await this.world.addRoomObject(
          setup.name,
          obj.type,
          obj.x,
          obj.y,
          obj.props ?? {},
        );
      }
    }
  }

  /**
   * 批量添加房间。
   */
  async addRooms(setups: RoomSetup[]): Promise<void> {
    for (const setup of setups) {
      await this.addRoom(setup);
    }
  }

  /**
   * 设置房间间的连接关系（通过 exit）。
   * Screeps 自动根据房间名推断 exit，但需要确保房间已存在。
   */
  async linkRooms(roomNames: string[]): Promise<void> {
    // screeps-server-mockup 自动处理房间连接，这里只是确保房间都存在
    for (const name of roomNames) {
      // 房间应该已经通过 addRoom 创建
    }
  }

  /**
   * 注入敌方 creep 到指定房间（用于 tower 防御测试）。

   * [Facts] Screeps 中 hostile creep 的 owner 不是当前玩家。
   * screeps-server-mockup 的 addRoomObject 直接创建对象。

   * @param roomName 房间名
   * @param x x 坐标
   * @param y y 坐标
   * @param body 身体部件数组（如 [ATTACK, MOVE]）
   * @param name creep 名称
   * @param owner 所有者用户名（默认 "invader"）
   */
  async addHostileCreep(
    roomName: string,
    x: number,
    y: number,
    body: Array<{ type: string } | string>,
    name: string,
    owner = "invader",
  ): Promise<void> {
    // screeps-server-mockup 期望 body 为字符串数组（部件类型）
    const bodyParts = body.map((b) => (typeof b === "string" ? b : b.type));
    // 引擎的 creep.owner getter 是 runtimeData.users[o.user].username —— 注入必须带
    // 真实 user id（mockup world.reset 预置 NPC：'2'=Invader、'3'=Source Keeper），
    // 传 owner 字符串会被 DB 存下但 getter 解析 undefined 直接抛 TypeError。
    const userId = owner === "source-keeper" ? "3" : "2";
    await this.world.addRoomObject(roomName, "creep", x, y, {
      body: bodyParts.map((type) => ({ type, hits: 100 })),
      name,
      user: userId,
      hits: bodyParts.length * 100,
      hitsMax: bodyParts.length * 100,
      fatigue: 0,
      spawning: false,
      ticksToLive: 1500,
    });
  }
}

/**
 * 创建标准 source 对象规格。
 * [Facts] source 默认 energyCapacity=3000，regeneration=300 tick。
 */
export function source(x: number, y: number, overrides: Record<string, unknown> = {}): ObjectSpec {
  return {
    type: "source",
    x,
    y,
    props: {
      energy: 3000,
      energyCapacity: 3000,
      ticksToRegeneration: 300,
      ...overrides,
    },
  };
}

/**
 * 创建标准 controller 对象规格。
 * @param level RCL 等级（0=未占领，1+=已激活）
 */
export function controller(x: number, y: number, level = 0): ObjectSpec {
  return {
    type: "controller",
    x,
    y,
    props: { level },
  };
}

/**
 * 创建标准 mineral 对象规格。
 * [Facts] mineral 默认 mineralAmount=3000，density=3。
 */
export function mineral(
  x: number,
  y: number,
  mineralType: string = "H",
  overrides: Record<string, unknown> = {},
): ObjectSpec {
  return {
    type: "mineral",
    x,
    y,
    props: {
      mineralType,
      density: 3,
      mineralAmount: 3000,
      ...overrides,
    },
  };
}

/**
 * 创建 spawn 对象规格。
 * 用于灾后恢复场景：预设已有 spawn。
 */
export function spawn(x: number, y: number, name: string, energy = 300): ObjectSpec {
  return {
    type: "spawn",
    x,
    y,
    props: {
      name,
      energy,
      energyCapacity: 300,
      owner: "bot",
    },
  };
}
