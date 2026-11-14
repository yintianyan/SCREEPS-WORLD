/** 行军威胁房（intel 识别 + 跨重启记忆 + 路线评估）单测。 */
import { describe, expect, it } from "vitest";
import {
  evaluateMarchRoute,
  rememberedThreatRooms,
  rememberThreatRooms,
  threatRoomsFromIntel,
  type ThreatMemory,
} from "../../../src/domain/war/march-threats";
import type { RoomIntel } from "../../../src/domain/intel";

function intel(overrides: Partial<RoomIntel> = {}): RoomIntel {
  return { kind: "normal", status: "normal", lastSeen: 1000, ...overrides } as RoomIntel;
}

describe("threatRoomsFromIntel — 威胁识别", () => {
  it("塔/敌方 spawn/非盟主归属 → 威胁；己方与盟友 → 豁免", () => {
    const view = new Map<string, RoomIntel>([
      ["W1N1", intel({ towers: 2 })],
      ["W1N2", intel({ enemySpawns: 1 })],
      ["W1N3", intel({ owner: "Enemy" })],
      ["W1N4", intel({ owner: "me" })],
      ["W1N5", intel({ owner: "ally" })],
      ["W1N6", intel({})],
    ]);
    const threats = threatRoomsFromIntel(view, "me", ["ally"]);
    expect(threats.sort()).toEqual(["W1N1", "W1N2", "W1N3"]);
  });

  it("owner 未知（无视野 stub）→ 不判威胁（盲区由记忆与中途复核兜底）", () => {
    const view = new Map<string, RoomIntel>([["W2N1", intel({ owner: undefined })]]);
    expect(threatRoomsFromIntel(view, "me", [])).toEqual([]);
  });
});

describe("威胁记忆 — 跨重启 write-through 与 TTL 洗白", () => {
  it("记录后可读；重复观测只刷新 tick 不洗白", () => {
    const mem: ThreatMemory = {};
    mem.threatRooms = rememberThreatRooms(mem, ["W4N8"], 100);
    mem.threatRooms = rememberThreatRooms(mem, ["W4N8"], 5000);
    expect(rememberedThreatRooms(mem, 5100, 50000)).toEqual(["W4N8"]);
    expect(mem.threatRooms?.W4N8).toBe(5000);
  });

  it("TTL 过期自然洗白（塔被拆/玩家迁走）", () => {
    const mem: ThreatMemory = { threatRooms: { W4N8: 100 } };
    expect(rememberedThreatRooms(mem, 100 + 50001, 50000)).toEqual([]);
    expect(rememberedThreatRooms(mem, 100 + 50000, 50000)).toEqual(["W4N8"]);
  });
});

describe("evaluateMarchRoute — 路线评估", () => {
  it("路线中间房含威胁 → 拒行并报房名", () => {
    const verdict = evaluateMarchRoute(["W8N3", "W8N4", "W4N8", "W4N10"], new Set(["W4N8"]));
    expect(verdict).toEqual({ ok: false, threatRoom: "W4N8" });
  });

  it("起点与目标房豁免（PB 房/主房不算中间威胁）", () => {
    const verdict = evaluateMarchRoute(["W8N3", "W7N3", "W7N0"], new Set(["W8N3", "W7N0"]));
    expect(verdict).toEqual({ ok: true });
  });

  it("无威胁路线 → 放行", () => {
    expect(evaluateMarchRoute(["A", "B", "C"], new Set())).toEqual({ ok: true });
  });
});
