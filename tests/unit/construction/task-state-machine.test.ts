/** Phase R2 验收加固 — BuildTask 状态机完备性单元测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tryCreateSite } from "../../../src/systems/construction-manager";
import { syncTaskStates, cleanTasks, assessEmergencyRebuild } from "../../../src/domain/construction/queue";
import { makeTryAddTask } from "../../../src/domain/layout/planner";
import { resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
  (globalThis as any).RawMemory = { segments: {} };
});

function makeSnapshot(rcl = 2): any {
  return {
    roomName: "W7N4",
    rcl,
    sources: [{ id: "s1", pos: { x: 20, y: 20 } }],
    controller: { pos: { x: 30, y: 30 } },
    spawns: [],
    extensions: [],
    towers: [],
    containers: [],
    roads: [],
    walls: [],
    ramparts: [],
    labs: [],
    links: [],
    storage: undefined,
    constructionSites: [],
    myConstructionSites: [],
    threatCreeps: [],
  };
}

function makeTask(key: string, structureType = "extension"): BuildTask {
  return {
    key,
    pos: { x: 25, y: 26, roomName: "W7N4" },
    structureType: structureType as BuildTask["structureType"],
    priority: 1,
    state: "queued",
    attempts: 0,
    retryAt: 0,
    queuedAt: 1000,
  };
}

function mockRoom(result: number) {
  return { createConstructionSite: vi.fn(() => result) };
}

const emergency = assessEmergencyRebuild(makeSnapshot());

describe("tryCreateSite — 返回值 → 状态机", () => {
  it("OK → state=site，attempts 归零", () => {
    const g = globalThis as any;
    const queue = [makeTask("t-ok")];
    g.Game.rooms = { W7N4: mockRoom(0) };
    const created = tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(created).toBe(true);
    expect(queue[0]!.state).toBe("site");
    expect(queue[0]!.attempts).toBe(0);
  });

  it("ERR_FULL(-8) → 保持 queued、retryAt=+10、本轮不再尝试后续任务", () => {
    const g = globalThis as any;
    const queue = [makeTask("t-full"), makeTask("t-second")];
    g.Game.rooms = { W7N4: mockRoom(-8) };
    const created = tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(created).toBe(false);
    expect(queue[0]!.state).toBe("queued");
    expect(queue[0]!.retryAt).toBe(g.Game.time + 10);
    expect(queue[1]!.retryAt).toBe(0); // 未被尝试
  });

  it("ERR_RCL_NOT_ENOUGH(-14) → 瞬态：queued + retryAt=+50，不 blocked", () => {
    const g = globalThis as any;
    const queue = [makeTask("t-rcl")];
    g.Game.rooms = { W7N4: mockRoom(-14) };
    tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(queue[0]!.state).toBe("queued");
    expect(queue[0]!.retryAt).toBe(g.Game.time + 50);
    expect(queue[0]!.attempts).toBe(0);
  });

  it("ERR_INVALID_TARGET(-7) → blocked + attempts=1 + retryAt=+100", () => {
    const g = globalThis as any;
    const queue = [makeTask("t-inv")];
    g.Game.rooms = { W7N4: mockRoom(-7) };
    tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(queue[0]!.state).toBe("blocked");
    expect(queue[0]!.attempts).toBe(1);
    expect(queue[0]!.retryAt).toBe(g.Game.time + 100);
  });

  it("未知错误(-1) → queued + 指数退避（封顶 200，不永久重试）", () => {
    const g = globalThis as any;
    const queue = [makeTask("t-unk")];
    g.Game.rooms = { W7N4: mockRoom(-1) };
    tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(queue[0]!.state).toBe("queued");
    expect(queue[0]!.attempts).toBe(1);
    expect(queue[0]!.retryAt).toBe(g.Game.time + 20);
    // 第二次失败（attempts=2）→ 40t。
    queue[0]!.retryAt = 0;
    tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(queue[0]!.retryAt).toBe(g.Game.time + 40);
    // attempts 高位 → 封顶 200t。
    queue[0]!.attempts = 9;
    queue[0]!.retryAt = 0;
    tryCreateSite(queue, makeSnapshot(), emergency, "W7N4");
    expect(queue[0]!.retryAt).toBe(g.Game.time + 200);
  });
});

describe("syncTaskStates — site 消失 / 建成 转移", () => {
  it("state=site 但下一 tick snapshot 无此 site 且未建成 → 回退 queued（site 被毁/未出现）", () => {
    const queue = [makeTask("t-lost")];
    queue[0]!.state = "site";
    syncTaskStates(queue, makeSnapshot());
    expect(queue[0]!.state).toBe("queued");
  });

  it("site 消失但位置已建成目标结构 → done（由 cleanTasks 清除）", () => {
    const queue = [makeTask("t-built")];
    queue[0]!.state = "site";
    const snap = makeSnapshot();
    snap.extensions.push({ pos: { x: 25, y: 26 }, structureType: "extension" });
    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("done");
    cleanTasks(queue, 2000);
    expect(queue).toHaveLength(0);
  });

  it("queued + 匹配 site 存在 → site；queued + 结构建成 → done", () => {
    const queue = [makeTask("t-a"), makeTask("t-b", "container")];
    queue[1]!.pos = { x: 21, y: 20, roomName: "W7N4" };
    const snap = makeSnapshot();
    snap.myConstructionSites.push({
      pos: { x: 25, y: 26 },
      structureType: "extension",
    });
    snap.containers.push({ pos: { x: 21, y: 20 }, structureType: "container" });
    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("site");
    expect(queue[1]!.state).toBe("done");
  });

  it("类型不匹配的 site 不误收（storage site 不匹配 extension 任务）", () => {
    const queue = [makeTask("t-mismatch")];
    const snap = makeSnapshot();
    (snap as any).constructionSites.push({
      pos: { x: 25, y: 26 },
      structureType: "storage",
    });
    syncTaskStates(queue, snap);
    expect(queue[0]!.state).toBe("queued");
  });
});

describe("cleanTasks — done 清除与超龄边界", () => {
  it("done 任务被删除且不进黑名单；site 任务保留", () => {
    const done = makeTask("t-done");
    done.state = "done";
    const site = makeTask("t-site");
    site.state = "site";
    const queue = [done, site];
    const result = cleanTasks(queue, 1000, { maxQueuedAge: 3000 });
    expect(queue.map((t) => t.key)).toEqual(["t-site"]);
    expect(result.blacklistedKeys).toEqual([]);
    expect(result.staleKeys).toEqual([]);
  });

  it("queuedAt 缺省（旧数据）按当前 tick 计龄——不清除", () => {
    const old = makeTask("t-old");
    delete (old as any).queuedAt;
    const queue = [old];
    const result = cleanTasks(queue, 100000, { maxQueuedAge: 3000 });
    expect(queue).toHaveLength(1);
    expect(result.staleKeys).toEqual([]);
  });
});

describe("重规划去重与 lane RCL 守卫", () => {
  it("同 key 重规划被拒绝（key 已在队列）", () => {
    const queue = [makeTask("core.ext.01")];
    const tryAdd = makeTryAddTask(
      new Set(["core.ext.01"]),
      new Set(["25,26"]),
      {},
      queue,
    );
    expect(
      tryAdd({
        key: "core.ext.01",
        pos: { x: 24, y: 26, roomName: "W7N4" },
        structureType: "extension",
        priority: 1,
        phase: "rcl2",
        validation: "ok",
      }),
    ).toBe(false);
    expect(queue).toHaveLength(1);
  });

  it("lane 模式 RCL 守卫：extension 在 RCL1 未解锁 → 不签发、任务保持 queued", () => {
    const g = globalThis as any;
    const createSpy = vi.fn(() => 0);
    g.Game.rooms = { W7N4: { createConstructionSite: createSpy } };
    const queue = [makeTask("t-rcl1")];
    const created = tryCreateSite(queue, makeSnapshot(1), emergency, "W7N4", "lane");
    expect(created).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
    expect(queue[0]!.state).toBe("queued");
  });

  it("lane 模式 RCL 守卫：RCL2 解锁 → 正常签发", () => {
    const g = globalThis as any;
    const createSpy = vi.fn(() => 0);
    g.Game.rooms = { W7N4: { createConstructionSite: createSpy } };
    const queue = [makeTask("t-rcl2")];
    const created = tryCreateSite(queue, makeSnapshot(2), emergency, "W7N4", "lane");
    expect(created).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(queue[0]!.state).toBe("site");
  });
});
