import { describe, expect, it } from "vitest";
import { hasCriticalStructureGap } from "../../../src/domain/construction/queue";

describe("hasCriticalStructureGap — 关键基建缺失检测", () => {
  it("returns true when buildQueue has P0 queued storage", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "queued", structureType: STRUCTURE_STORAGE },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(true);
  });

  it("returns true when buildQueue has P0 queued tower", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "queued", structureType: STRUCTURE_TOWER },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(true);
  });

  it("returns true when buildQueue has P0 queued spawn", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "queued", structureType: STRUCTURE_SPAWN },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(true);
  });

  it("returns false when critical structure is P0 but state is site (already placed)", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "site", structureType: STRUCTURE_STORAGE },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns false when critical structure is queued but not P0", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 2, state: "queued", structureType: STRUCTURE_STORAGE },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns false when only non-critical structures are P0 queued", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "queued", structureType: STRUCTURE_EXTENSION },
          { priority: 1, state: "queued", structureType: STRUCTURE_ROAD },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns false when buildQueue is empty", () => {
    const rooms = { W1N1: { buildQueue: [] } };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns false when buildQueue is undefined", () => {
    const rooms = { W1N1: {} };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns false for empty rooms object", () => {
    expect(hasCriticalStructureGap({})).toBe(false);
  });

  it("returns false when room is undefined", () => {
    const rooms = { W1N1: undefined };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns true when any room in multi-room setup has critical gap", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 1, state: "queued", structureType: STRUCTURE_EXTENSION },
        ],
      },
      W2N1: {
        buildQueue: [
          { priority: 0, state: "queued", structureType: STRUCTURE_TOWER },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(true);
  });

  it("returns false when critical structure is in blocked state", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "blocked", structureType: STRUCTURE_STORAGE },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });

  it("returns false when critical structure is in done state", () => {
    const rooms = {
      W1N1: {
        buildQueue: [
          { priority: 0, state: "done", structureType: STRUCTURE_STORAGE },
        ],
      },
    };
    expect(hasCriticalStructureGap(rooms)).toBe(false);
  });
});
