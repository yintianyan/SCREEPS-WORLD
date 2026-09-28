/**
 * 释放标记的下游消费者 — `RoomMemory.releaseAt` 必须真的让花钱的地方停下。
 *
 * 立案依据：territory-manager 只负责排空判定，而孵化与建造是两条独立的消费链。若
 * spawn-manager 继续为这间房评估需求，释放窗口内每 10 tick 就有新 creep 降生在一间
 * 注定要放弃的房里（能量 + 一只永不干活的编制）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { spawnManagerSystem } from "../../../src/systems/room/spawn-manager";
import { mockContext, mockSnapshot, resetGlobals } from "../../support/factories";

const HOME = "W7N4";

function makeRequest(role: string): SpawnRequest {
  return {
    key: `${role}:${HOME}:0`,
    role,
    home: HOME,
    priority: 1,
    survival: false,
    body: ["carry", "move"] as BodyPartConstant[],
    memory: { role, home: HOME, mode: "acquire" } as CreepMemory,
    createdAt: 900,
    expiresAt: 1900,
    retries: 0,
  };
}

beforeEach(() => {
  resetGlobals();
});

describe("spawn-manager — 释放中的房不补员", () => {
  it("releaseAt 存在时清空在途请求，且不再评估出新的编制需求", () => {
    const queue = [makeRequest("hauler"), makeRequest("distributor")];
    (globalThis as any).Memory.rooms[HOME] = {
      spawnQueue: queue,
      colonyState: "normal",
      releaseAt: 900,
    };

    spawnManagerSystem.run(mockContext(mockSnapshot({ threatCreeps: [] })));

    // 只清空本房队列 —— 判定发生在需求评估之前，所以队列不会先减一条再补回一条。
    expect((globalThis as any).Memory.rooms[HOME].spawnQueue).toEqual([]);
  });

  it("无 releaseAt 时照常保留请求（对照：门不是无条件清队列）", () => {
    const queue = [makeRequest("hauler")];
    (globalThis as any).Memory.rooms[HOME] = {
      spawnQueue: queue,
      colonyState: "normal",
    };

    spawnManagerSystem.run(mockContext(mockSnapshot({ threatCreeps: [] })));

    const roles = ((globalThis as any).Memory.rooms[HOME].spawnQueue as SpawnRequest[]).map(
      r => r.role,
    );
    expect(roles).toContain("hauler");
  });
});
