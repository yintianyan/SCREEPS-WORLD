/** 测试设置：为测试环境定义 Screeps 全局常量。 */

import { CONFIG } from "../src/config";

// Traffic Manager 在单元/集成测试中默认关闭 — 存量行为断言针对引擎直发出口
// （creep.moveTo / creep.move 调用）。traffic-on 行为由专属测试
// （tests/unit/movement/traffic-*.test.ts）显式开启覆盖；
// E2E 跑真实构建，走生产默认值（开启）。
// CONFIG 声明为 as const（深只读），测试环境通过断言写入运行时对象。
(CONFIG.movement as { trafficManager: boolean }).trafficManager = false;

// 将 Screeps 常量赋值到 globalThis 而不重新声明
// （它们已在 @types/screeps 中声明但运行时未定义）。
Object.assign(globalThis as Record<string, unknown>, {
  // Memory 全局 mock（防止 "Memory is not defined" 错误）
  Memory: { rooms: {}, creep: {}, flags: {} },

  // RoomPosition 构造器 mock（单元测试用；源码 new RoomPosition 需要它）。
  RoomPosition: class {
    x: number;
    y: number;
    roomName: string;
    constructor(x: number, y: number, roomName: string) {
      this.x = x;
      this.y = y;
      this.roomName = roomName;
    }
    getRangeTo(t: { x?: number; y?: number; pos?: { x: number; y: number } }): number {
      const tx = t.x ?? t.pos?.x ?? 0;
      const ty = t.y ?? t.pos?.y ?? 0;
      return Math.max(Math.abs(this.x - tx), Math.abs(this.y - ty));
    }
  },

  // body 部件常量
  WORK: "work",
  CARRY: "carry",
  MOVE: "move",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  HEAL: "heal",
  CLAIM: "claim",
  TOUGH: "tough",

  // 部件容量常量
  CARRY_CAPACITY: 50,

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
  STRUCTURE_LAB: "lab",
  STRUCTURE_TERMINAL: "terminal",
  STRUCTURE_EXTRACTOR: "extractor",
  STRUCTURE_FACTORY: "factory",
  STRUCTURE_OBSERVER: "observer",
  STRUCTURE_POWER_SPAWN: "powerSpawn",
  STRUCTURE_NUKER: "nuker",
  STRUCTURE_INVADER_CORE: "invaderCore",

  // find 常量
  FIND_EXIT: 10,
  FIND_SOURCES: 1,
  FIND_SOURCES_ACTIVE: 2,
  FIND_MY_STRUCTURES: 6,
  FIND_STRUCTURES: 5,
  FIND_CONSTRUCTION_SITES: 7,
  FIND_MY_CONSTRUCTION_SITES: 11,
  FIND_MY_SPAWNS: 112,
  FIND_HOSTILE_CREEPS: 4,
  FIND_HOSTILE_STRUCTURES: 109,
  FIND_MY_CREEPS: 3,
  FIND_CREEPS: 101,
  FIND_MINERALS: 116,
  FIND_DROPPED_RESOURCES: 106,
  FIND_TOMBSTONES: 118,
  FIND_RUINS: 123,

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
  RESOURCE_POWER: "power",
  RESOURCE_BATTERY: "battery",

  // 方向常量
  TOP: 1,
  TOP_RIGHT: 2,
  RIGHT: 3,
  BOTTOM_RIGHT: 4,
  BOTTOM: 5,
  BOTTOM_LEFT: 6,
  LEFT: 7,
  TOP_LEFT: 8,

  // 地形常量
  TERRAIN_MASK_WALL: 1,

  // look 常量
  LOOK_STRUCTURES: "structure",
  LOOK_CONSTRUCTION_SITES: "constructionSite",
  LOOK_CREEPS: "creep",

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
    lab: [0, 0, 0, 0, 0, 0, 3, 6, 10],
    terminal: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    extractor: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    factory: [0, 0, 0, 0, 0, 0, 0, 1, 1],
  },
});
