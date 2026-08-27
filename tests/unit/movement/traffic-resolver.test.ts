/** 交通解算器纯函数测试 — 同格仲裁 / 跟车 / 对向换位 / 推挤链 / 锚定与疲劳豁免。 */
import { describe, expect, it } from "vitest";
import { resolveTraffic, type MoveIntent, type ResolveInput } from "../../../src/creeps/movement/traffic-resolver";

function input(partial: Partial<ResolveInput>): ResolveInput {
  return {
    intents: [],
    anchors: new Map(),
    occupancy: new Map(),
    immovable: new Set(),
    shoveCandidates: () => [],
    ...partial,
  };
}

function intent(name: string, from: number, to: number, priority: number): MoveIntent {
  return { name, from, to, priority };
}

describe("resolveTraffic — 同格仲裁", () => {
  it("多意图争同一格：最高优先级胜，败者原地", () => {
    const { moves } = resolveTraffic(input({
      intents: [
        intent("low", 100, 200, 40),
        intent("high", 300, 200, 60),
      ],
      occupancy: new Map([[100, "low"], [300, "high"]]),
    }));

    expect(moves.get("high")).toBe(200);
    expect(moves.has("low")).toBe(false);
  });

  it("同优先级平局：登记序在前者胜", () => {
    const { moves } = resolveTraffic(input({
      intents: [
        intent("first", 100, 200, 40),
        intent("second", 300, 200, 40),
      ],
      occupancy: new Map([[100, "first"], [300, "second"]]),
    }));

    expect(moves.get("first")).toBe(200);
    expect(moves.has("second")).toBe(false);
  });

  it("原地意图（from === to）被丢弃", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("a", 100, 100, 60)],
      occupancy: new Map([[100, "a"]]),
    }));
    expect(moves.size).toBe(0);
  });
});

describe("resolveTraffic — 跟车与对向换位", () => {
  it("跟车链：A 等 B 的格、B 走空格 — 多轮传播后全部放行", () => {
    // C→B→A 车队：A 去空格 400，B 去 A 的格，C 去 B 的格。
    const { moves } = resolveTraffic(input({
      intents: [
        intent("c", 100, 200, 40),
        intent("b", 200, 300, 40),
        intent("a", 300, 400, 40),
      ],
      occupancy: new Map([[100, "c"], [200, "b"], [300, "a"]]),
    }));

    expect(moves.get("a")).toBe(400);
    expect(moves.get("b")).toBe(300);
    expect(moves.get("c")).toBe(200);
  });

  it("对向换位：A→B 格且 B→A 格，双双放行", () => {
    const { moves } = resolveTraffic(input({
      intents: [
        intent("a", 100, 200, 60),
        intent("b", 200, 100, 40),
      ],
      occupancy: new Map([[100, "a"], [200, "b"]]),
    }));

    expect(moves.get("a")).toBe(200);
    expect(moves.get("b")).toBe(100);
  });

  it("头对头僵持（目标同格、互不占位）只放行一个", () => {
    // a 与 b 都想进空格 200 — 仲裁放行一个，不产生同格双占。
    const { moves } = resolveTraffic(input({
      intents: [
        intent("a", 100, 200, 60),
        intent("b", 300, 200, 60),
      ],
      occupancy: new Map([[100, "a"], [300, "b"]]),
    }));

    expect(moves.get("a")).toBe(200);
    expect(moves.has("b")).toBe(false);
  });
});

describe("resolveTraffic — 推挤链", () => {
  it("推挤静止者：移动方优先级更高时静止者被推到空邻格", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("mover", 100, 200, 60)],
      occupancy: new Map([[100, "mover"], [200, "idler"]]),
      shoveCandidates: (tile) => (tile === 200 ? [250, 251] : []),
    }));

    expect(moves.get("mover")).toBe(200);
    expect(moves.get("idler")).toBe(250); // 落到首个空格。
  });

  it("落格排序被尊重：首选格被占（静止者）时链式推挤（深度 2）", () => {
    // mover → 200(idler1)；idler1 邻格只有 250(idler2)；idler2 邻格 260 空。
    const { moves } = resolveTraffic(input({
      intents: [intent("mover", 100, 200, 60)],
      occupancy: new Map([[100, "mover"], [200, "idler1"], [250, "idler2"]]),
      shoveCandidates: (tile) =>
        tile === 200 ? [250] : tile === 250 ? [260] : [],
    }));

    expect(moves.get("mover")).toBe(200);
    expect(moves.get("idler1")).toBe(250);
    expect(moves.get("idler2")).toBe(260);
  });

  it("链深超限（3 层）放弃本意图", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("mover", 100, 200, 60)],
      occupancy: new Map([
        [100, "mover"], [200, "i1"], [250, "i2"], [260, "i3"],
      ]),
      shoveCandidates: (tile) =>
        tile === 200 ? [250] : tile === 250 ? [260] : tile === 260 ? [270] : [],
    }));

    expect(moves.size).toBe(0);
  });

  it("锚定豁免：锚优先级 ≥ 移动方时不可推挤（站桩矿工不被经济 creep 推开）", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("hauler", 100, 200, 60)],
      anchors: new Map([["miner", 90]]),
      occupancy: new Map([[100, "hauler"], [200, "miner"]]),
      shoveCandidates: () => [250],
    }));

    expect(moves.size).toBe(0);
  });

  it("卡位升级：同档站桩者（anchorStation 60）被升级移动方（stuckEscalation 70）推开", () => {
    // 线上实证 W36S58：采集者目标格被锚定 reserver 占据，同档（60≥60）不推 →
    // 意图逐 tick 被拒、采集者永久锁死。升级后 70>60 → 推挤放行。
    const { moves } = resolveTraffic(input({
      intents: [intent("harvester", 100, 200, 70)],
      anchors: new Map([["reserver", 60]]),
      occupancy: new Map([[100, "harvester"], [200, "reserver"]]),
      shoveCandidates: (tile) => (tile === 200 ? [250] : []),
    }));

    expect(moves.get("harvester")).toBe(200);
    expect(moves.get("reserver")).toBe(250);
  });

  it("升级移动方仍不可推开站桩矿工（anchorMiner 90 > stuckEscalation 70）", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("harvester", 100, 200, 70)],
      anchors: new Map([["miner", 90]]),
      occupancy: new Map([[100, "harvester"], [200, "miner"]]),
      shoveCandidates: () => [250],
    }));

    expect(moves.size).toBe(0);
  });

  it("flee 高于矿工锚：逃命 creep 可推开站桩矿工", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("flee", 100, 200, 100)],
      anchors: new Map([["miner", 90]]),
      occupancy: new Map([[100, "flee"], [200, "miner"]]),
      shoveCandidates: (tile) => (tile === 200 ? [250] : []),
    }));

    expect(moves.get("flee")).toBe(200);
    expect(moves.get("miner")).toBe(250);
  });

  it("疲劳硬墙：immovable creep 不可被推挤", () => {
    const { moves } = resolveTraffic(input({
      intents: [intent("mover", 100, 200, 100)],
      occupancy: new Map([[100, "mover"], [200, "tired"]]),
      immovable: new Set(["tired"]),
      shoveCandidates: () => [250],
    }));

    expect(moves.size).toBe(0);
  });

  it("推挤落格不选仲裁胜者的目标格（防同格双占）", () => {
    // winner 去 250；mover 推 idler，idler 的候选是 [250, 260] — 250 已是
    // winner 目标，必须落到 260。
    const { moves } = resolveTraffic(input({
      intents: [
        intent("winner", 300, 250, 100),
        intent("mover", 100, 200, 60),
      ],
      occupancy: new Map([[300, "winner"], [100, "mover"], [200, "idler"]]),
      shoveCandidates: (tile) => (tile === 200 ? [250, 260] : []),
    }));

    expect(moves.get("winner")).toBe(250);
    expect(moves.get("idler")).toBe(260);
    expect(moves.get("mover")).toBe(200);
  });
});

describe("resolveTraffic — 边界", () => {
  it("空输入零输出", () => {
    const { moves } = resolveTraffic(input({}));
    expect(moves.size).toBe(0);
  });

  it("同名 creep 重复意图：只取最高优一条", () => {
    const { moves } = resolveTraffic(input({
      intents: [
        intent("a", 100, 200, 40),
        intent("a", 100, 300, 60),
      ],
      occupancy: new Map([[100, "a"]]),
    }));

    expect(moves.get("a")).toBe(300);
    expect(moves.size).toBe(1);
  });
});
