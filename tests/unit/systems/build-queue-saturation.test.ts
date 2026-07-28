/**
 * BuildTask 类型饱和清理测试 — 幽灵任务（漂移遗留）的唯一出口。
 *
 * 线上事故：布局代际漂移修复前的旧计数器 key 任务遗留在 buildQueue，
 * 坐标为空但同类结构已在别处建满 RCL 配额 —— 逐格 done 判定永不命中，
 * createConstructionSite 永远 ERR_RCL_NOT_ENOUGH（不 blocked 不进黑名单），
 * 18 个幽灵 extension 任务永久积压，且被承诺计数误计、RCL 升级时会在
 * 过时坐标真的建出结构。
 */
import { describe, expect, it } from "vitest";
import { cleanTasks, syncTaskStates } from "../../../src/domain/construction/queue";
import { mockSnapshot, mockStructure } from "../../role-helpers";

function task(overrides: Partial<BuildTask>): BuildTask {
  return {
    key: "constraint.extension.21",
    pos: { x: 10, y: 10, roomName: "W7N4" },
    structureType: "extension" as BuildableStructureConstant,
    priority: 2,
    state: "queued",
    attempts: 0,
    retryAt: 0,
    ...overrides,
  };
}

/** 生成 n 个 extension 结构（位置与任务坐标错开）。 */
function extensions(n: number): any[] {
  return Array.from({ length: n }, (_, i) =>
    mockStructure("extension", { id: `ext_${i}` }),
  ).map((e, i) => {
    e.pos = { x: 30 + (i % 10), y: 30 + Math.floor(i / 10) } as any;
    return e;
  });
}

describe("syncTaskStates — 类型饱和判定", () => {
  it("extension 已建满当前 RCL 配额：坐标为空的 queued 任务转 done 并被清除", () => {
    // RCL5 上限 30（tests/setup.ts 的 CONTROLLER_STRUCTURES），建满 30 个。
    const snap = mockSnapshot({ rcl: 5, extensions: extensions(30) as any });
    const queue = [task({}), task({ key: "constraint.extension.22", pos: { x: 11, y: 10, roomName: "W7N4" } })];

    syncTaskStates(queue, snap);
    expect(queue.every(t => t.state === "done")).toBe(true);

    cleanTasks(queue, 1000);
    expect(queue).toHaveLength(0);
  });

  it("配额未满：任务保持 queued（等待正常建造）", () => {
    const snap = mockSnapshot({ rcl: 5, extensions: extensions(29) as any });
    const queue = [task({})];

    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("queued");
  });

  it("结构被毁计数下降：饱和判定自动解除（不影响紧急重建）", () => {
    // storage 任务 + storage 不存在 → 不饱和，任务保留。
    const snap = mockSnapshot({ rcl: 5, storage: undefined });
    const queue = [task({
      key: "constraint.storage.01",
      structureType: "storage" as BuildableStructureConstant,
    })];

    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("queued");
  });

  it("rampart 叠盾任务不受饱和判定影响（上限巨大）", () => {
    const snap = mockSnapshot({ rcl: 5, extensions: extensions(30) as any });
    const queue = [task({
      key: "defense.core.rampart.25.22",
      structureType: "rampart" as BuildableStructureConstant,
      pos: { x: 25, y: 22, roomName: "W7N4" },
    })];

    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("queued");
  });

  it("本坐标已建成的任务仍走位置匹配转 done（原语义不回归）", () => {
    const ext = mockStructure("extension", { id: "e1" });
    ext.pos = { x: 10, y: 10 } as any;
    const snap = mockSnapshot({ rcl: 5, extensions: [ext] as any });
    const queue = [task({})]; // 任务坐标 (10,10) 与结构重合。

    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("done");
  });
});
