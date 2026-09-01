/** 测试设置：注入官方常量 + 最小全局 mock（unit / integration 共用）。 */

import { CONFIG } from "../src/config";
import { GAME_GLOBAL_CONSTANTS } from "./support/constants";

// Traffic Manager 在单元/集成测试中默认关闭 — 存量行为断言针对引擎直发出口
// （creep.moveTo / creep.move 调用）。traffic-on 行为由专属测试
// （tests/unit/movement/traffic-*.test.ts）显式开启覆盖；
// E2E 跑真实构建，走生产默认值（开启）。
// CONFIG 声明为 as const（深只读），测试环境通过断言写入运行时对象。
(CONFIG.movement as { trafficManager: boolean }).trafficManager = false;

/**
 * 官方常量注入（FREEZE R20②）— 值全部来自 support/constants 的
 * GAME_GLOBAL_CONSTANTS（@screeps/driver constants + 补充表）。
 * 禁止在本文件手写任何常量字面值表；integration 的 TestWorld.find() 与
 * 此处注入值同源（同一 SSOT），私有 FIND 编码已退役。
 */
Object.assign(globalThis as Record<string, unknown>, GAME_GLOBAL_CONSTANTS);

// 将非常量全局 mock 赋值到 globalThis 而不重新声明
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
    isEqualTo(x: number | { x?: number; y?: number; pos?: { x: number; y: number } }, y?: number): boolean {
      const tx = typeof x === "number" ? x : (x.x ?? x.pos?.x ?? 0);
      const ty = typeof x === "number" ? (y ?? 0) : (x.y ?? x.pos?.y ?? 0);
      return this.x === tx && this.y === ty;
    }
  },
});
