/**
 * 环向死锁（#38 的另一半）：A 踩 B 的格、B 踩 C 的格、C 踩 A 的格。
 * 线上实测形状：W37S58 里 (26,24)→(27,23)→(26,22)… 与 (25,23)→(26,24) 互相钉住，
 * 三只 creep（两只 remoteHauler + 一只 reserver）stuckTicks 涨到 380+、ttl 一路耗干 ——
 * 远矿收入因此停工，而旧版解算器对这种环**每轮零批准**（占用者有意图就一律"等下一轮"，
 * 而下一轮永远不会来：progressed=false 直接收摊）。
 */
import { describe, expect, it } from "vitest";
import { resolveTraffic, type MoveIntent } from "../../../src/creeps/movement/traffic-resolver";

const pack = (x: number, y: number): number => x * 50 + y;

/** 三只围成环，每只的落点都可以让开（给一个空邻格）。 */
function ring(cycleFree: boolean) {
  const a = pack(10, 10);
  const b = pack(11, 10);
  const c = pack(11, 11);
  const intents: MoveIntent[] = [
    { name: "A", from: a, to: b, priority: 70 },
    { name: "B", from: b, to: c, priority: 70 },
    { name: "C", from: c, to: a, priority: 70 },
  ];
  return {
    intents,
    anchors: new Map<string, number>(),
    occupancy: new Map([
      [a, "A"],
      [b, "B"],
      [c, "C"],
    ]),
    immovable: new Set<string>(),
    // 每只 blocker 的推挤落格：环外的空格（A 需要空格才不挡别人）
    shoveCandidates: (tile: number): number[] => {
      if (!cycleFree) return [];
      if (tile === b) return [pack(12, 10)];
      if (tile === c) return [pack(12, 11)];
      if (tile === a) return [pack(12, 9)];
      return [];
    },
  };
}

describe("traffic-resolver 环向死锁破环（#38）", () => {
  it("有合法落格时，环不再零批准 —— 至少一只本轮获批移动", () => {
    const out = resolveTraffic(ring(true));
    expect(
      out.moves.size,
      `环内三方都拿到 0 条批准 = 旧行为（每拍重演同一幕，stuckTicks 无上限增长）`,
    ).toBeGreaterThan(0);
    // 排第一的 A 必须本轮拿到批准（它挡在 B 前，B 被推开后 A 就能上）
    expect(out.moves.get("A")).toBe(pack(11, 10));
  });

  it("无合法落格时照旧不动（破环不是把 creep 塞进墙里）", () => {
    const out = resolveTraffic(ring(false));
    expect(out.moves.size).toBe(0);
    expect(out.shoveFails["no-landing"]).toBeGreaterThan(0);
  });

  it("同向跟车链不被误伤：占用者本轮已获批时，后来者等到下一轮而非把它推走", () => {
    const from = pack(20, 20);
    const mid = pack(21, 20);
    const dst = pack(22, 20);
    const out = resolveTraffic({
      intents: [
        { name: "lead", from: mid, to: dst, priority: 60 },
        { name: "rear", from, to: mid, priority: 60 },
      ],
      anchors: new Map(),
      occupancy: new Map([
        [mid, "lead"],
        [dst, "idle"],
      ]),
      immovable: new Set<string>(),
      // lead 的目标被静止者占住 ⇒ lead 本轮要先把 idle 推开；rear 只能等。
      shoveCandidates: () => [pack(22, 21)],
    });
    // lead 把静止者推开并获批；rear 靠**多轮传播**跟上（破环轮不该被误触发）
    expect(out.moves.get("lead")).toBe(dst);
    expect(out.moves.get("rear")).toBe(mid);
    expect(out.moves.get("idle")).toBe(pack(22, 21));
    expect(out.shoveFails["anchor"]).toBeUndefined();
  });
});
