/** Action 级 CPU profiling 测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordActionCpu, getActionCpuSnapshot } from "../../../src/kernel/safe-run";
import { globalCache } from "../../../src/kernel/global-cache";
import { defineRole } from "../../../src/creeps/engine/role-runner";
import { CONFIG } from "../../../src/config";
import type { ActionCandidate, RolePolicy } from "../../../src/creeps/engine/action-types";
import type { Priority } from "../../../src/kernel/contracts";
import {
  mockContext,
  mockCreep,
  mockSnapshot,
  resetGlobals,
} from "../../role-helpers";

beforeEach(() => {
  resetGlobals();
  vi.clearAllMocks();
});

describe("recordActionCpu — 基础记录", () => {
  it("首次记录创建 entry", () => {
    recordActionCpu("hauler/withdraw/execute", 0.5);
    const data = getActionCpuSnapshot();
    expect(data).toBeDefined();
    expect(data!.get("hauler/withdraw/execute")).toEqual({
      count: 1,
      totalCpu: 0.5,
      maxCpu: 0.5,
    });
  });

  it("多次记录累加 count 和 totalCpu，更新 maxCpu", () => {
    recordActionCpu("hauler/withdraw/execute", 0.3);
    recordActionCpu("hauler/withdraw/execute", 0.5);
    recordActionCpu("hauler/withdraw/execute", 0.1);
    const data = getActionCpuSnapshot();
    const entry = data!.get("hauler/withdraw/execute");
    expect(entry).toEqual({
      count: 3,
      totalCpu: 0.9, // 0.3 + 0.5 + 0.1
      maxCpu: 0.5,
    });
  });

  it("不同 key 独立记录", () => {
    recordActionCpu("hauler/withdraw/resolve", 0.1);
    recordActionCpu("hauler/withdraw/execute", 0.3);
    recordActionCpu("hauler/pickup/resolve", 0.2);
    const data = getActionCpuSnapshot();
    expect(data!.size).toBe(3);
    expect(data!.get("hauler/withdraw/resolve")!.count).toBe(1);
    expect(data!.get("hauler/withdraw/execute")!.count).toBe(1);
    expect(data!.get("hauler/pickup/resolve")!.count).toBe(1);
  });
});

describe("recordActionCpu — tick 重置", () => {
  it("新 tick 重置 Map", () => {
    // tick 1000（resetGlobals 默认）
    recordActionCpu("hauler/withdraw/execute", 0.5);
    expect(getActionCpuSnapshot()!.size).toBe(1);

    // 模拟 tick 推进
    (globalThis as any).Game.time = 1001;
    // 旧 tick 数据仍存在但 getActionCpuSnapshot 返回 undefined（tick 不匹配）
    expect(getActionCpuSnapshot()).toBeUndefined();

    // 新 tick 写入创建新 Map
    recordActionCpu("hauler/pickup/resolve", 0.2);
    const data = getActionCpuSnapshot();
    expect(data).toBeDefined();
    expect(data!.size).toBe(1); // 只含新 tick 的数据
    expect(data!.get("hauler/pickup/resolve")!.count).toBe(1);
  });
});

describe("actionProfiling 开关 — 集成验证", () => {
  // CONFIG 是 as const 只读对象，测试中通过 writable 引用修改开关。
  const debug = CONFIG.debug as { actionProfiling: boolean };

  it("开关关闭时 role-runner 不产生 profiling 数据", () => {
    debug.actionProfiling = false;

    const snap = mockSnapshot();
    const creep = mockCreep({ name: "h1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    const action: ActionCandidate = {
      name: "test:withdraw",
      resolve: vi.fn(() => undefined),
      execute: vi.fn(),
    };

    const policy: RolePolicy = {
      acquire: [action],
      work: [],
    };
    const role = defineRole("hauler", 2 as Priority, policy);
    role.run(creep, mockContext(snap));

    // resolve 被调用（评估候选）
    expect(action.resolve).toHaveBeenCalled();
    // 无 profiling 数据
    expect(getActionCpuSnapshot()).toBeUndefined();
  });

  it("开关开启时 role-runner 记录 resolve/execute CPU", () => {
    debug.actionProfiling = true;

    // 模拟 Game.cpu.getUsed 返回递增值，使 delta > 0
    let cpuCounter = 0;
    (globalThis as any).Game.cpu.getUsed = vi.fn(() => {
      cpuCounter += 0.1;
      return cpuCounter;
    });

    const snap = mockSnapshot();
    const creep = mockCreep({ name: "h1", role: "hauler", used: 0, capacity: 100, mode: "acquire" });

    const action: ActionCandidate = {
      name: "test:withdraw",
      resolve: vi.fn(() => ({ id: "target_1" } as any)),
      execute: vi.fn(),
    };

    const policy: RolePolicy = {
      acquire: [action],
      work: [],
    };
    const role = defineRole("hauler", 2 as Priority, policy);
    role.run(creep, mockContext(snap));

    // resolve 和 execute 都被调用
    expect(action.resolve).toHaveBeenCalled();
    expect(action.execute).toHaveBeenCalled();

    // profiling 数据被记录
    const data = getActionCpuSnapshot();
    expect(data).toBeDefined();
    expect(data!.has("hauler/test:withdraw/resolve")).toBe(true);
    expect(data!.has("hauler/test:withdraw/execute")).toBe(true);

    const resolveEntry = data!.get("hauler/test:withdraw/resolve")!;
    expect(resolveEntry.count).toBe(1);
    expect(resolveEntry.totalCpu).toBeGreaterThan(0);

    const executeEntry = data!.get("hauler/test:withdraw/execute")!;
    expect(executeEntry.count).toBe(1);
    expect(executeEntry.totalCpu).toBeGreaterThan(0);

    // 恢复
    debug.actionProfiling = false;
  });

  it("开关开启时 onFlee 也被 profiling", () => {
    debug.actionProfiling = true;

    let cpuCounter = 0;
    (globalThis as any).Game.cpu.getUsed = vi.fn(() => {
      cpuCounter += 0.1;
      return cpuCounter;
    });

    const hostile = {
      id: "h1",
      pos: { x: 10, y: 10, roomName: "W7N4", getRangeTo: vi.fn(() => 5), getDirectionTo: vi.fn(() => 3) },
      owner: { username: "enemy" },
      body: [{ type: "attack", hits: 100 }],
    } as any;

    const snap = mockSnapshot({
      hostileCreeps: [hostile],
      threatCreeps: [hostile],
      spawns: [{ id: "sp1", pos: { x: 20, y: 20, roomName: "W7N4", getRangeTo: vi.fn(() => 1) }, store: { getUsedCapacity: () => 0, getFreeCapacity: () => 300 }, structureType: "spawn" } as any],
      fillTargets: [],
    });

    const creep = mockCreep({
      name: "h1",
      role: "hauler",
      used: 50,
      capacity: 100,
      mode: "work",
      pos: { x: 21, y: 21, roomName: "W7N4", getRangeTo: vi.fn(() => 5), getDirectionTo: vi.fn(() => 3), findClosestByRange: vi.fn(() => null), findPathTo: vi.fn(() => []) },
    });

    const fleeFn = vi.fn(() => false);
    const policy: RolePolicy = {
      acquire: [],
      work: [],
      onFlee: fleeFn,
    };
    const role = defineRole("hauler", 2 as Priority, policy);
    role.run(creep, mockContext(snap));

    expect(fleeFn).toHaveBeenCalled();
    const data = getActionCpuSnapshot();
    expect(data).toBeDefined();
    expect(data!.has("hauler/onFlee")).toBe(true);

    // 恢复
    debug.actionProfiling = false;
  });
});
