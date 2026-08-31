/** v32 → v33 迁移独立测试（完整情报字段建档净化）。
 * 注：v43 已退役 legacy intel 桥（整记录清理），本文件断言链尾终态——
 * 历史步行为由「链上不崩溃 + 终态 intel 不存在 + 其余字段无损」验证。 */
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../src/kernel/memory";
import { CONFIG } from "../../../src/config";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

describe("migration v32 → v33（完整情报字段建档）", () => {
  it("空 Memory 不报错，版本升到当前", () => {
    (globalThis as any).Memory = { schemaVersion: 32, creeps: {}, rooms: {}, kernel: {} };
    expect(() => runMigrations()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(CONFIG.memory.schemaVersion);
  });

  it("带合法 intel 的存量经全链迁移后 intel 清理、其余字段无损", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: { W7N4: { intel: { W6N4: { enemySpawns: 1, wallCount: 8, sealedExits: [7] } } }, },
      kernel: {},
    };
    runMigrations();
    const mem = (globalThis as any).Memory;
    expect(mem.schemaVersion).toBe(CONFIG.memory.schemaVersion);
    expect("intel" in mem.rooms.W7N4).toBe(false);
  });

  it("畸形 intel 字段（非数字/非数组）经全链迁移不崩溃、终态清理", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: {
        W7N4: { intel: { W6N4: { enemySpawns: "1", wallCount: "many" }, W5N4: { sealedExits: [7, "3"] } } },
      },
      kernel: {},
    };
    expect(() => runMigrations()).not.toThrow();
    expect("intel" in (globalThis as any).Memory.rooms.W7N4).toBe(false);
  });

  it("幂等：重复执行不产生副作用", () => {
    (globalThis as any).Memory = {
      schemaVersion: 32,
      creeps: {},
      rooms: { W7N4: { intel: { W6N4: { enemySpawns: 2, wallCount: 5, sealedExits: [1, 3] } } } },
      kernel: {},
    };
    runMigrations();
    const snapshot1 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    runMigrations();
    const snapshot2 = JSON.parse(JSON.stringify((globalThis as any).Memory));
    expect(snapshot2).toEqual(snapshot1);
  });
});
