import { describe, expect, it } from "vitest";
import {
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
});

describe("SpawnQueue — spawnKey", () => {
  it("generates key without source", () => {
    expect(spawnKey("harvester", "W1N1", 0)).toBe("harvester:W1N1:0");
  });

  it("generates key with source", () => {
    expect(spawnKey("harvester", "W1N1", 0, "src123")).toBe("harvester:W1N1:src123:0");
  });
});
