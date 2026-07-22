import { describe, expect, it } from "vitest";
import { bodyCost, degradeBody, selectBody, RECOVERY_BODY, BODY_TEMPLATES } from "../src/config/bodies";

describe("Bodies — bodyCost", () => {
  it("calculates cost of [work, carry, move]", () => {
    expect(bodyCost(["work", "carry", "move"])).toBe(200);
  });

  it("calculates cost of [work, work, carry, move, move]", () => {
    // work=100, work=100, carry=50, move=50, move=50 = 350
    // 成本 350，移除一个 move -> [work, work, carry, move] = 300 -> 满足
    expect(bodyCost(["work", "work", "carry", "move", "move"])).toBe(350);
  });

  it("returns 0 for empty body", () => {
    expect(bodyCost([])).toBe(0);
  });
});

describe("Bodies — selectBody", () => {
  it("selects the best body that fits energy capacity", () => {
    expect(selectBody("harvester", 600)).toEqual(["work", "work", "work", "work", "work", "carry", "move"]);
    expect(selectBody("harvester", 400)).toEqual(["work", "work", "work", "carry", "move"]);
    expect(selectBody("harvester", 200)).toEqual(["work", "carry", "move"]);
  });

  it("falls back to recovery body when capacity is too low", () => {
    expect(selectBody("harvester", 100)).toEqual([...RECOVERY_BODY]);
  });

  it("falls back to recovery body for unknown role", () => {
    expect(selectBody("unknown-role", 1000)).toEqual([...RECOVERY_BODY]);
  });
});

describe("Bodies — degradeBody", () => {
  it("returns the same body when energy is sufficient", () => {
    const body = ["work", "carry", "move"] as BodyPartConstant[];
    expect(degradeBody(body, 200)).toEqual(body);
  });

  it("degrades [work, work, carry, move, move] to fit 300 energy", () => {
    const body = ["work", "work", "carry", "move", "move"] as BodyPartConstant[];
    // 成本 350 > 300，移除最贵的可移除部件 WORK(100) → [work, carry, move, move] = 250 ≤ 300
    const result = degradeBody(body, 300);
    expect(result).toEqual(["work", "carry", "move", "move"]);
  });

  it("returns same body when it already fits", () => {
    const body = ["work", "work", "carry", "move", "move"] as BodyPartConstant[];
    // 成本 350，能量 350 -> 无需降级即满足
    const result = degradeBody(body, 350);
    expect(result).toEqual(["work", "work", "carry", "move", "move"]);
  });

  it("returns undefined when energy is below minimum viable (200)", () => {
    expect(degradeBody(["work", "carry", "move"], 150)).toBeUndefined();
  });

  it("degrades [work, work, work, carry, move] to fit 200 energy (preserves required parts)", () => {
    // [work, work, work, carry, move] = 400，移除两个 WORK(100) → [work, carry, move] = 200
    // 旧算法从末尾 pop 会先移除 carry/move 导致 undefined（这正是修复的 bug）。
    const body = ["work", "work", "work", "carry", "move"] as BodyPartConstant[];
    expect(degradeBody(body, 200)).toEqual(["work", "carry", "move"]);
  });

  it("degrades hauler body with requiredParts=[carry,move] to fit 200", () => {
    const body = ["carry", "carry", "carry", "move", "move", "move"] as BodyPartConstant[];
    // 成本 300，使用 requiredParts=[carry,move] 降级
    // 移除 move -> [carry, carry, carry, move, move] = 250 > 200
    // 移除 move -> [carry, carry, carry, move] = 200，含 carry+move
    const result = degradeBody(body, 200, ["carry", "move"]);
    expect(result).toEqual(["carry", "carry", "carry", "move"]);
  });

  it("returns undefined for hauler body with default requiredParts (requires WORK)", () => {
    // 默认 requiredParts=[work,carry,move]，hauler 无 WORK -> undefined
    const body = ["carry", "carry", "carry", "move", "move", "move"] as BodyPartConstant[];
    const result = degradeBody(body, 200);
    expect(result).toBeUndefined();
  });
});

describe("Bodies — BODY_TEMPLATES", () => {
  it("has a 200-energy tier for all roles", () => {
    for (const [, templates] of Object.entries(BODY_TEMPLATES)) {
      const lastTemplate = templates[templates.length - 1];
      expect(lastTemplate?.minCapacity).toBe(200);
    }
  });

  it("has [work, carry, move] as the minimum for worker/harvester/upgrader/builder", () => {
    for (const role of ["worker", "harvester", "upgrader", "builder"]) {
      const templates = BODY_TEMPLATES[role];
      const lastTemplate = templates?.[templates.length - 1];
      expect(lastTemplate?.parts).toEqual(["work", "carry", "move"]);
    }
  });
});

describe("Bodies — A1 大 body 档位（随 RCL 容量放大）", () => {
  it("upgrader RCL6(2300) 选 15W 站桩 body，RCL8 恰好顶满 15/tick 上限", () => {
    const body = selectBody("upgrader", 2300, { rcl: 6 });
    expect(body.filter(p => p === "work")).toHaveLength(15);
    expect(bodyCost(body)).toBe(1650);
  });

  it("upgrader RCL4(1300) 选 8W body；RCL2(550) 选 4W 过渡档", () => {
    const rcl4 = selectBody("upgrader", 1300, { rcl: 4 });
    expect(rcl4.filter(p => p === "work")).toHaveLength(8);
    expect(bodyCost(rcl4)).toBe(950);

    const rcl2 = selectBody("upgrader", 550, { rcl: 2 });
    expect(rcl2.filter(p => p === "work")).toHaveLength(4);
    expect(bodyCost(rcl2)).toBe(500);
  });

  it("builder RCL4(1300) 选 8W4C6M；RCL3(800) 选 4W2C3M", () => {
    const rcl4 = selectBody("builder", 1300, { rcl: 4 });
    expect(rcl4.filter(p => p === "work")).toHaveLength(8);
    expect(bodyCost(rcl4)).toBe(1300);

    const rcl3 = selectBody("builder", 800, { rcl: 3 });
    expect(rcl3.filter(p => p === "work")).toHaveLength(4);
    expect(bodyCost(rcl3)).toBe(650);
  });

  it("hauler RCL4+ 道路变体按容量选档：1300→16C8M，800→8C4M，300→4C2M", () => {
    const top = selectBody("hauler", 1300, { rcl: 4 });
    expect(top.filter(p => p === "carry")).toHaveLength(16);
    expect(top.filter(p => p === "move")).toHaveLength(8);

    const mid = selectBody("hauler", 800, { rcl: 4 });
    expect(mid.filter(p => p === "carry")).toHaveLength(8);

    const low = selectBody("hauler", 300, { rcl: 4 });
    expect(low).toEqual(["carry", "carry", "carry", "carry", "move", "move"]);
  });

  it("hauler 低 RCL（无道路假设）新增 6C6M 顶档", () => {
    const body = selectBody("hauler", 600, { rcl: 2 });
    expect(body.filter(p => p === "carry")).toHaveLength(6);
    expect(body.filter(p => p === "move")).toHaveLength(6);
  });

  it("所有新档位成本 ≤ 其 minCapacity 对应的容量", () => {
    // selectBody 只在 capacity >= minCapacity 时选中，成本绝不超过容量。
    for (const capacity of [550, 800, 1300, 1800, 2300]) {
      for (const role of ["upgrader", "builder", "hauler"]) {
        const body = selectBody(role, capacity, { rcl: 8 });
        expect(bodyCost(body)).toBeLessThanOrEqual(capacity);
      }
    }
  });
});
