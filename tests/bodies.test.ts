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
    expect(selectBody("harvester", 400)).toEqual(["work", "work", "carry", "move", "move"]);
    expect(selectBody("harvester", 300)).toEqual(["work", "carry", "move", "move"]);
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
    const result = degradeBody(body, 300);
    expect(result).toEqual(["work", "work", "carry", "move"]);
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

  it("returns undefined when stripping leaves no carry/move", () => {
    // [work, work, work, carry, move] = 400，降到 3 部件 -> [work, work, work] 无 carry/move
    const body = ["work", "work", "work", "carry", "move"] as BodyPartConstant[];
    expect(degradeBody(body, 200)).toBeUndefined();
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
