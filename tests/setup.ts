/** 测试设置：为测试环境定义 Screeps 全局常量。 */

// 将 Screeps 常量赋值到 globalThis 而不重新声明
// （它们已在 @types/screeps 中声明但运行时未定义）。
Object.assign(globalThis as Record<string, unknown>, {
  // body 部件常量
  WORK: "work",
  CARRY: "carry",
  MOVE: "move",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  HEAL: "heal",
  CLAIM: "claim",
  TOUGH: "tough",

  // 结构常量
  STRUCTURE_SPAWN: "spawn",
  STRUCTURE_EXTENSION: "extension",
  STRUCTURE_ROAD: "road",
  STRUCTURE_CONTAINER: "container",
  STRUCTURE_TOWER: "tower",
  STRUCTURE_STORAGE: "storage",
  STRUCTURE_WALL: "constructedWall",
  STRUCTURE_RAMPART: "rampart",
  STRUCTURE_LINK: "link",

  // find 常量
  FIND_SOURCES: 1,
  FIND_SOURCES_ACTIVE: 2,
  FIND_MY_STRUCTURES: 6,
  FIND_STRUCTURES: 5,
  FIND_CONSTRUCTION_SITES: 7,
  FIND_MY_CONSTRUCTION_SITES: 11,
  FIND_HOSTILE_CREEPS: 4,
  FIND_MY_CREEPS: 3,
  FIND_MINERALS: 116,

  // 返回码
  OK: 0,
  ERR_NOT_OWNER: -1,
  ERR_BUSY: -4,
  ERR_NOT_ENOUGH_RESOURCES: -6,
  ERR_INVALID_TARGET: -7,
  ERR_FULL: -8,
  ERR_NOT_IN_RANGE: -9,
  ERR_NO_PATH: -2,
  ERR_INVALID_ARGS: -10,
  ERR_TIRED: -11,
  ERR_NO_BODYPART: -12,
  ERR_NOT_ENOUGH_ENERGY: -6,
  ERR_RCL_NOT_ENOUGH: -14,
  ERR_GCL_NOT_ENOUGH: -15,

  // 资源常量
  RESOURCE_ENERGY: "energy",

  // 地形常量
  TERRAIN_MASK_WALL: 1,

  // look 常量
  LOOK_STRUCTURES: "structure",

  CONTROLLER_STRUCTURES: {
    spawn: [0, 1, 1, 1, 1, 1, 1, 1, 1],
    extension: [0, 0, 5, 10, 20, 30, 40, 50, 60],
    road: [250, 250, 250, 250, 250, 250, 250, 250, 250],
    constructedWall: [0, 0, 2500, 5000, 7500, 10000, 12500, 15000, 17500],
    rampart: [0, 0, 2500, 5000, 7500, 10000, 12500, 15000, 17500],
    container: [0, 5, 5, 5, 5, 5, 5, 5, 5],
    tower: [0, 0, 0, 1, 1, 2, 2, 3, 3],
    storage: [0, 0, 0, 0, 1, 1, 1, 1, 1],
    link: [0, 0, 0, 0, 0, 2, 3, 4, 6],
  },
});
