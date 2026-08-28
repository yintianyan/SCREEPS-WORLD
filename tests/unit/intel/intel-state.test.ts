/** 完整版情报模型纯函数测试：三分置信度 / TTL 分档 / 硬门槛 / 观察采用 / 老化容量。 */
import { describe, expect, it } from "vitest";
import {
  adoptRoomIntel,
  ageRooms,
  capRooms,
  confidenceAt,
  isActionUsable,
  needsRescout,
  upsertPlayerObservation,
  upsertRoomEntry,
  fromPlayersRecord,
  toPlayersRecord,
  ROOM_DYNAMIC_TTL,
  ROOM_THREAT_TTL,
  EXPIRY_JITTER,
  type IntelEntry,
  type PlayerIntelEntry,
} from "../../../src/domain/intel";

function makeEntry(overrides?: Partial<IntelEntry>): IntelEntry {
  return {
    subject: "W5N7",
    observedAt: 10_000,
    source: "observer",
    observedBy: "W7N4",
    expiry: 10_000 + ROOM_DYNAMIC_TTL + EXPIRY_JITTER,
    payload: { kind: "normal", status: "normal", lastSeen: 10_000 },
    ...overrides,
  };
}

describe("confidenceAt — 来源信任 × 时效双维派生", () => {
  it("直接来源 + 新鲜窗内 → fact", () => {
    expect(confidenceAt(makeEntry(), 10_000 + 100)).toBe("fact");
  });

  it("直接来源 + 超动态 TTL 但未过期 → stale", () => {
    expect(confidenceAt(makeEntry(), 10_000 + ROOM_DYNAMIC_TTL + 1)).toBe("stale");
  });

  it("超 expiry → unknown", () => {
    expect(confidenceAt(makeEntry(), 10_000 + ROOM_DYNAMIC_TTL + 1_000)).toBe("unknown");
  });

  it("ally/derived 来源永远 inferred（不进 fact 通道）", () => {
    const ally = makeEntry({ source: "ally", observedAt: 10_000 });
    expect(confidenceAt(ally, 10_000)).toBe("inferred");
    const derived = makeEntry({ source: "derived", observedAt: 10_000 });
    expect(confidenceAt(derived, 10_000)).toBe("inferred");
  });

  it("威胁类字段（towers）走短窗 TTL——同年龄下动态字段 fact 而威胁字段已 stale", () => {
    const tick = 10_000 + ROOM_THREAT_TTL + 1;
    const withTowers = makeEntry({ payload: { kind: "normal", status: "normal", towers: 3, lastSeen: 10_000 } });
    expect(confidenceAt(withTowers, tick)).toBe("stale");
    const noTowers = makeEntry();
    expect(confidenceAt(noTowers, tick)).toBe("fact");
  });
});

describe("isActionUsable / needsRescout — 不可逆行动硬门槛", () => {
  it("fact 级且未超 maxAge → 可用", () => {
    expect(isActionUsable(makeEntry(), 10_000 + 100, 500)).toBe(true);
  });

  it("fact 级但超 maxAge → 拒绝（战争授权目标新鲜度）", () => {
    expect(isActionUsable(makeEntry(), 10_000 + 600, 500)).toBe(false);
  });

  it("inferred 一律拒绝——欺骗最多骗到侦察预算，骗不到战争授权", () => {
    expect(isActionUsable(makeEntry({ source: "ally" }), 10_000)).toBe(false);
  });

  it("stale 拒绝行动但触发两段式侦察", () => {
    const entry = makeEntry();
    const tick = 10_000 + ROOM_DYNAMIC_TTL + 1;
    expect(isActionUsable(entry, tick)).toBe(false);
    expect(needsRescout(entry, tick)).toBe(true);
  });

  it("无条目 = 未知 ≠ 安全：驱动侦察", () => {
    expect(needsRescout(undefined, 10_000)).toBe(true);
    expect(isActionUsable(undefined, 10_000)).toBe(false);
  });
});

describe("adoptRoomIntel — 观察交接采用", () => {
  it("lastSeen → observedAt；来源与归属房保留；expiry = lastSeen + TTL + jitter(subject)", () => {
    const entry = adoptRoomIntel({
      subject: "W5N7",
      home: "W7N4",
      source: "scout",
      payload: { kind: "normal", status: "normal", owner: "Enemy", towers: 2, lastSeen: 5_000 },
    });
    expect(entry.subject).toBe("W5N7");
    expect(entry.observedAt).toBe(5_000);
    expect(entry.source).toBe("scout");
    expect(entry.observedBy).toBe("W7N4");
    expect(entry.payload.owner).toBe("Enemy");
    const ttl = ROOM_THREAT_TTL; // towers → 威胁短窗
    expect(entry.expiry).toBeGreaterThanOrEqual(5_000 + ttl);
    expect(entry.expiry).toBeLessThanOrEqual(5_000 + ttl + EXPIRY_JITTER);
  });

  it("expiry jitter 按房名稳定——同房名同 expiry", () => {
    const obs = {
      subject: "W4N4",
      home: "W7N4",
      source: "observer" as const,
      payload: { kind: "normal" as const, status: "normal", lastSeen: 5_000 },
    };
    const a = adoptRoomIntel(obs);
    const b = adoptRoomIntel(obs);
    expect(a.expiry).toBe(b.expiry);
  });
});

describe("老化与容量治理", () => {
  it("ageRooms 清理超 expiry 条目，未超保留", () => {
    const map = new Map<string, IntelEntry>([
      ["old", makeEntry({ subject: "old", observedAt: 0, expiry: 1_000 })],
      ["live", makeEntry({ subject: "live", observedAt: 900, expiry: 2_000 })],
    ]);
    expect(ageRooms(map, 1_500)).toBe(1);
    expect(map.has("old")).toBe(false);
    expect(map.has("live")).toBe(true);
  });

  it("capRooms 超 TLS 上限按 observedAt 最旧环形覆盖", () => {
    const map = new Map<string, IntelEntry>();
    for (let i = 0; i < 5; i++) {
      map.set(`r${i}`, makeEntry({ subject: `r${i}`, observedAt: i * 100, expiry: 1_000_000 }));
    }
    expect(capRooms(map, 3)).toBe(2);
    expect(map.size).toBe(3);
    expect(map.has("r0")).toBe(false);
    expect(map.has("r4")).toBe(true);
  });

  it("upsertRoomEntry：更新的观测覆盖；同 observedAt 也覆盖（富化观测/同 tick 多源）", () => {
    const map = new Map<string, IntelEntry>();
    expect(upsertRoomEntry(map, makeEntry({ subject: "W5N7", observedAt: 100 }))).toBe(true);
    expect(upsertRoomEntry(map, makeEntry({ subject: "W5N7", observedAt: 50 }))).toBe(false);
    expect(map.get("W5N7")!.observedAt).toBe(100);
    expect(upsertRoomEntry(map, makeEntry({ subject: "W5N7", observedAt: 200 }))).toBe(true);
    expect(map.get("W5N7")!.observedAt).toBe(200);
    // 同 tick 富化（pathCost 补算不前移 lastSeen）：覆盖但 observedAt 不变。
    expect(upsertRoomEntry(map, makeEntry({
      subject: "W5N7",
      observedAt: 200,
      payload: { kind: "normal", status: "normal", lastSeen: 200, pathCost: 42 },
    }))).toBe(true);
    expect(map.get("W5N7")!.payload.pathCost).toBe(42);
  });
});

describe("玩家域威胁记忆", () => {
  it("upsertPlayerObservation：lastSeen/lastHostile 单调前移 + rooms 记录", () => {
    const players = new Map<string, PlayerIntelEntry>();
    upsertPlayerObservation(players, "Enemy", "W5N7", 100, false);
    upsertPlayerObservation(players, "Enemy", "W5N7", 50, true); // 旧 tick 不前移
    upsertPlayerObservation(players, "Enemy", "W5N7", 200, true);
    const e = players.get("Enemy")!;
    expect(e.lastSeenAt).toBe(200);
    expect(e.lastHostileAt).toBe(200);
    expect(e.rooms.W5N7).toBe(200);
  });

  it("segment 记录互转 roundtrip", () => {
    const players = new Map<string, PlayerIntelEntry>();
    upsertPlayerObservation(players, "Enemy", "W5N7", 100, true);
    const rec = toPlayersRecord(players);
    const back = fromPlayersRecord("Enemy", rec.Enemy!);
    expect(back).toEqual(players.get("Enemy"));
  });
});
