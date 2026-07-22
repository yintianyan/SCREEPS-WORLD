/**
 * v5 → v6 迁移测试（compact-core-v1 → v2 模板切换）。
 *
 * 覆盖：
 *   - v1 布局升级到 v2（templateId/version/revision/nextPlanTick）
 *   - 未开工的 core.* 任务（queued/blocked）被清理；site/done 保留
 *   - 非 core 任务不受影响
 *   - 幂等：重复执行不再递增 revision
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maintainMemory } from "../src/kernel/memory";
import { resetGlobals } from "./role-helpers";

beforeEach(() => {
  resetGlobals();
});

function setupV5Memory(): void {
  (globalThis as any).Memory = {
    schemaVersion: 5,
    creeps: {},
    kernel: {},
    rooms: {
      W7N4: {
        layout: {
          version: 1,
          templateId: "compact-core-v1",
          state: "accepted",
          revision: 3,
          nextPlanTick: 5000,
        },
        buildQueue: [
          { key: "core.ext.21", pos: { x: 1, y: 1, roomName: "W7N4" }, structureType: "extension", priority: 2, state: "queued", attempts: 0, retryAt: 0 },
          { key: "core.ext.22", pos: { x: 2, y: 2, roomName: "W7N4" }, structureType: "extension", priority: 2, state: "blocked", attempts: 3, retryAt: 0 },
          { key: "core.tower.01", pos: { x: 3, y: 3, roomName: "W7N4" }, structureType: "tower", priority: 0, state: "site", attempts: 0, retryAt: 0 },
          { key: "core.ext.01", pos: { x: 4, y: 4, roomName: "W7N4" }, structureType: "extension", priority: 1, state: "done", attempts: 0, retryAt: 0 },
          { key: "logistics.container.source.abc", pos: { x: 5, y: 5, roomName: "W7N4" }, structureType: "container", priority: 1, state: "queued", attempts: 0, retryAt: 0 },
        ],
        spawnQueue: [],
      },
    },
  };
}

describe("migration v5 → v6（模板 v1 → v2）", () => {
  it("v1 布局升级到 v2 并触发重规划", () => {
    setupV5Memory();
    maintainMemory();

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.templateId).toBe("compact-core-v2");
    expect(layout.version).toBe(2);
    expect(layout.revision).toBe(4); // 3 + 1
    expect(layout.nextPlanTick).toBe(0);
    expect((globalThis as any).Memory.schemaVersion).toBe(6);
  });

  it("未开工的 core.* 任务被清理，site/done 与非 core 任务保留", () => {
    setupV5Memory();
    maintainMemory();

    const queue = (globalThis as any).Memory.rooms.W7N4.buildQueue as any[];
    const keys = queue.map(t => `${t.key}:${t.state}`);
    expect(keys).not.toContain("core.ext.21:queued");
    expect(keys).not.toContain("core.ext.22:blocked");
    expect(keys).toContain("core.tower.01:site");
    expect(keys).toContain("core.ext.01:done");
    expect(keys).toContain("logistics.container.source.abc:queued");
  });

  it("幂等：重复执行不再修改 revision", () => {
    setupV5Memory();
    maintainMemory();
    maintainMemory();
    maintainMemory();

    const layout = (globalThis as any).Memory.rooms.W7N4.layout;
    expect(layout.revision).toBe(4); // 只递增一次
    expect(layout.templateId).toBe("compact-core-v2");
  });

  it("无 layout 的房间不受影响", () => {
    (globalThis as any).Memory = {
      schemaVersion: 5,
      creeps: {},
      kernel: {},
      rooms: { W9N9: { spawnQueue: [], buildQueue: [] } },
    };
    expect(() => maintainMemory()).not.toThrow();
    expect((globalThis as any).Memory.schemaVersion).toBe(6);
  });
});
