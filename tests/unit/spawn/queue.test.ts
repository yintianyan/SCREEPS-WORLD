import { describe, expect, it } from "vitest";
import {
  cancelRequestsByHome,
  cleanQueue,
  countPending,
  hasRequest,
  removeRequest,
  sortQueue,
  spawnKey,
  submitRequest,
} from "../../../src/domain/spawn/queue";

function makeRequest(key: string, priority: 0 | 1 | 2 | 3 | 4 = 1, createdAt = 0): SpawnRequest {
  return {
    key,
    role: "harvester",
    home: "W1N1",
    priority,
    body: ["work", "carry", "move"] as BodyPartConstant[],
    memory: { role: "harvester", home: "W1N1", mode: "acquire" },
    createdAt,
    retries: 0,
  };
}

describe("SpawnQueue — submitRequest", () => {
  it("adds a new request to the queue", () => {
    const queue: SpawnRequest[] = [];
    submitRequest(queue, makeRequest("harvester:W1N1:0"));
    expect(queue).toHaveLength(1);
    expect(queue[0]?.key).toBe("harvester:W1N1:0");
  });

  it("merges duplicate requests by key (no duplication)", () => {
    const queue: SpawnRequest[] = [];
    submitRequest(queue, makeRequest("harvester:W1N1:0"));
    submitRequest(queue, makeRequest("harvester:W1N1:0"));
    expect(queue).toHaveLength(1);
  });

  it("updates fields on merge but preserves createdAt and retries", () => {
    const queue: SpawnRequest[] = [];
    const original = makeRequest("harvester:W1N1:0", 1, 100);
    original.retries = 3;
    submitRequest(queue, original);

    const updated = makeRequest("harvester:W1N1:0", 0, 200);
    submitRequest(queue, updated);

    expect(queue).toHaveLength(1);
    expect(queue[0]?.priority).toBe(0);
    expect(queue[0]?.createdAt).toBe(100); // 保留
    expect(queue[0]?.retries).toBe(3); // 保留
  });
});

describe("SpawnQueue — removeRequest", () => {
  it("removes a request by key", () => {
    const queue: SpawnRequest[] = [makeRequest("a"), makeRequest("b")];
    removeRequest(queue, "a");
    expect(queue).toHaveLength(1);
    expect(queue[0]?.key).toBe("b");
  });

  it("does nothing when key is not found", () => {
    const queue: SpawnRequest[] = [makeRequest("a")];
    removeRequest(queue, "nonexistent");
    expect(queue).toHaveLength(1);
  });
});

describe("SpawnQueue — sortQueue", () => {
  it("sorts by priority ascending (P0 first)", () => {
    const queue: SpawnRequest[] = [
      makeRequest("c", 2, 200),
      makeRequest("a", 0, 100),
      makeRequest("b", 1, 150),
    ];
    const sorted = sortQueue(queue);
    expect(sorted[0]?.key).toBe("a");
    expect(sorted[1]?.key).toBe("b");
    expect(sorted[2]?.key).toBe("c");
  });

  it("breaks ties by createdAt ascending", () => {
    const queue: SpawnRequest[] = [
      makeRequest("late", 1, 200),
      makeRequest("early", 1, 100),
    ];
    const sorted = sortQueue(queue);
    expect(sorted[0]?.key).toBe("early");
    expect(sorted[1]?.key).toBe("late");
  });

  // X-17：替换请求优先于普通请求（补测试债 — 该规则此前零覆盖）。
  it("X-17：同优先级下 replaceBy 请求排在普通请求之前", () => {
    const normal = makeRequest("normal", 1, 100);
    const replacement = makeRequest("replacement", 1, 200);
    replacement.replaceBy = 500;
    const sorted = sortQueue([normal, replacement]);
    // replacement 虽 createdAt 更晚，仍排前 — 关键替补不得被普通请求侵占窗口。
    expect(sorted[0]?.key).toBe("replacement");
    expect(sorted[1]?.key).toBe("normal");
  });

  it("X-17：优先级仍高于 replaceBy（P0 普通请求先于 P1 替补）", () => {
    const p0 = makeRequest("p0", 0, 200);
    const p1Replacement = makeRequest("p1r", 1, 100);
    p1Replacement.replaceBy = 500;
    const sorted = sortQueue([p1Replacement, p0]);
    expect(sorted[0]?.key).toBe("p0");
  });
});

describe("SpawnQueue — hasRequest", () => {
  it("returns true when key exists", () => {
    const queue = [makeRequest("harvester:W1N1:0")];
    expect(hasRequest(queue, "harvester:W1N1:0")).toBe(true);
  });

  it("returns false when key does not exist", () => {
    const queue = [makeRequest("harvester:W1N1:0")];
    expect(hasRequest(queue, "harvester:W1N1:1")).toBe(false);
  });
});

describe("SpawnQueue — cleanQueue", () => {
  it("removes requests with retries >= maxRetries", () => {
    const queue: SpawnRequest[] = [makeRequest("a"), makeRequest("b")];
    queue[0]!.retries = 5;
    cleanQueue(queue, 100, 5);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.key).toBe("b");
  });

  // ：达重试上限的 key 返回给调用方入黑名单 — 打破删除-重建翻炒。
  it("SP-2：返回被隔离的 key 列表（TTL 过期不入列）", () => {
    const queue: SpawnRequest[] = [makeRequest("failed"), makeRequest("expired"), makeRequest("ok")];
    queue[0]!.retries = 5;
    queue[1]!.expiresAt = 50;
    const purged = cleanQueue(queue, 100, 5);
    expect(purged).toEqual(["failed"]);
    expect(queue.map(r => r.key)).toEqual(["ok"]);
  });

  it("removes expired requests", () => {
    const queue: SpawnRequest[] = [makeRequest("a"), makeRequest("b")];
    queue[0]!.expiresAt = 50;
    cleanQueue(queue, 100, 5);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.key).toBe("b");
  });

  it("keeps valid requests", () => {
    const queue: SpawnRequest[] = [makeRequest("a")];
    cleanQueue(queue, 100, 5);
    expect(queue).toHaveLength(1);
  });
});

// P2-K：onPurge 回调覆盖两种 churn 路径 — 让调用方把删除事件转译为遥测指标。
// 纯函数契约：不传回调时行为完全等价于改动前（向后兼容）。
describe("SpawnQueue — cleanQueue onPurge 回调 (P2-K)", () => {
  it("retries 烧穿时回调以 reason='retries' 触发", () => {
    const queue: SpawnRequest[] = [makeRequest("failed")];
    queue[0]!.retries = 5;
    const events: Array<{ key: string; reason: "retries" | "expired" }> = [];
    cleanQueue(queue, 100, 5, (key, reason) => events.push({ key, reason }));
    expect(events).toEqual([{ key: "failed", reason: "retries" }]);
  });

  it("TTL 过期时回调以 reason='expired' 触发", () => {
    const queue: SpawnRequest[] = [makeRequest("expired")];
    queue[0]!.expiresAt = 50;
    const events: Array<{ key: string; reason: "retries" | "expired" }> = [];
    cleanQueue(queue, 100, 5, (key, reason) => events.push({ key, reason }));
    expect(events).toEqual([{ key: "expired", reason: "expired" }]);
  });

  it("混合场景按删除顺序触发回调（retries 与 expired 共存）", () => {
    // 倒序遍历：从尾部向头部 splice。构造 [expired, failed, ok] 让顺序可断言。
    const queue: SpawnRequest[] = [
      makeRequest("expired"),
      makeRequest("failed"),
      makeRequest("ok"),
    ];
    queue[0]!.expiresAt = 50;
    queue[1]!.retries = 5;
    const events: Array<{ key: string; reason: "retries" | "expired" }> = [];
    cleanQueue(queue, 100, 5, (key, reason) => events.push({ key, reason }));
    // 倒序遍历：先处理 queue[2]=ok（保留），再 queue[1]=failed（retries），再 queue[0]=expired。
    expect(events).toEqual([
      { key: "failed", reason: "retries" },
      { key: "expired", reason: "expired" },
    ]);
    expect(queue.map(r => r.key)).toEqual(["ok"]);
  });

  it("不传回调时行为完全等价于改动前（向后兼容）", () => {
    const queue: SpawnRequest[] = [makeRequest("failed"), makeRequest("expired"), makeRequest("ok")];
    queue[0]!.retries = 5;
    queue[1]!.expiresAt = 50;
    const purged = cleanQueue(queue, 100, 5);
    // purgedKeys 仍只含 retries 路径 — 黑名单契约不变。
    expect(purged).toEqual(["failed"]);
    expect(queue.map(r => r.key)).toEqual(["ok"]);
  });

  it("purgedKeys 仍只含 retries 路径（黑名单契约不变）", () => {
    const queue: SpawnRequest[] = [makeRequest("failed"), makeRequest("expired")];
    queue[0]!.retries = 5;
    queue[1]!.expiresAt = 50;
    const purged = cleanQueue(queue, 100, 5, () => {});
    // TTL 过期不入 purgedKeys — 过期是正常生命周期，不该入黑名单。
    expect(purged).toEqual(["failed"]);
  });

  it("key.split(':')[0] 提取角色维度 — kebab-case 角色名安全", () => {
    // spawnKey 格式 `role:home:source?:index` — role 是 kebab-case（如 remote-hauler），
    // 不含 ':'，split(':')[0] 安全。此处验证调用方 split 提取逻辑。
    const queue: SpawnRequest[] = [
      { ...makeRequest("remote-hauler:W1N1:src1:0"), role: "remote-hauler" },
    ];
    queue[0]!.retries = 5;
    const roles: string[] = [];
    cleanQueue(queue, 100, 5, (key) => roles.push(key.split(":")[0] ?? ""));
    expect(roles).toEqual(["remote-hauler"]);
  });
});

describe("SpawnQueue — cancelRequestsByHome", () => {
  // P1-H：扩张 abort 时清掉 sponsor 队列中寄宿的拓荒请求，原本由
  // expansion-manager 直接 splice，现收敛为纯函数。语义必须严格匹配
  // 「按 home 整体清空」——同 home 不同角色（worker/builder/claimer）一并清掉。

  it("移除所有匹配 home 的请求（跨角色）", () => {
    const queue: SpawnRequest[] = [
      makeRequest("worker:W9N9:0"), // home=W1N1 默认
      { ...makeRequest("worker:W9N9:0"), home: "W9N9" },
      { ...makeRequest("builder:W9N9:0"), home: "W9N9", role: "builder" },
      { ...makeRequest("claimer:W9N9"), home: "W9N9", role: "claimer" },
    ];
    const removed = cancelRequestsByHome(queue, "W9N9");
    expect(removed).toBe(3);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.home).toBe("W1N1");
  });

  it("返回 0 且不动队列当 home 不匹配", () => {
    const queue: SpawnRequest[] = [makeRequest("a"), makeRequest("b")];
    expect(cancelRequestsByHome(queue, "W9N9")).toBe(0);
    expect(queue).toHaveLength(2);
  });

  it("空队列返回 0", () => {
    expect(cancelRequestsByHome([], "W1N1")).toBe(0);
  });

  it("幂等：连续调用第二次返回 0", () => {
    const queue: SpawnRequest[] = [
      { ...makeRequest("a"), home: "W9N9" },
      { ...makeRequest("b"), home: "W9N9" },
    ];
    expect(cancelRequestsByHome(queue, "W9N9")).toBe(2);
    expect(cancelRequestsByHome(queue, "W9N9")).toBe(0);
    expect(queue).toHaveLength(0);
  });
});

describe("SpawnQueue — countPending", () => {
  it("counts requests for a given role", () => {
    const queue: SpawnRequest[] = [
      makeRequest("a"),
      makeRequest("b"),
      { ...makeRequest("c"), role: "hauler" },
    ];
    expect(countPending(queue, "harvester")).toBe(2);
    expect(countPending(queue, "hauler")).toBe(1);
    expect(countPending(queue, "upgrader")).toBe(0);
  });

  it("home 过滤排除代孵请求（sponsor 队列中 home 指向他房的拓荒请求）", () => {
    const queue: SpawnRequest[] = [
      makeRequest("a"), // 本房请求
      { ...makeRequest("b"), home: "W9N9" }, // 代孵：home 指向扩张目标房
    ];
    // 不带 home：全队列计数（向后兼容）。
    expect(countPending(queue, "harvester")).toBe(2);
    // 带 home：只计本房请求，代孵请求不污染本房人口预算。
    expect(countPending(queue, "harvester", "W1N1")).toBe(1);
    expect(countPending(queue, "harvester", "W9N9")).toBe(1);
  });
});

describe("SpawnQueue — spawnKey", () => {
  it("generates key without source", () => {
    expect(spawnKey("harvester", "W1N1", 0)).toBe("harvester:W1N1:0");
  });

  it("generates key with source", () => {
    expect(spawnKey("harvester", "W1N1", 0, "src123")).toBe("harvester:W1N1:src123:0");
  });
});
