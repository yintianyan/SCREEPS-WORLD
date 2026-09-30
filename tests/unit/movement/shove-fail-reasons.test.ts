/**
 * #38 读数契约：推挤被拒必须带原因码。
 * 线上实证（tmp/observe/pw3.log 12/12 拍）：一只 stuck 顶格优先级（pri=70）的跨房 creep
 * 被「无意图、站在 road 上的静止 creep」挡死 250+ 拍直到老死，而现场只读得到结果
 * （没签发），读不到「为什么没推走」⇒ 三种原因（不可动 / 锚定 / 无落格）在观测上是同一个形状，
 * 修法无从裁决。本测试钉住分诊本身与「一次被挡只计一次」的口径。
 */
import { describe, expect, it } from "vitest";
import {
  resolveTraffic,
  type ResolveInput,
  type ShoveFailReason,
} from "../../../src/creeps/movement/traffic-resolver";

const pack = (x: number, y: number): number => x * 50 + y;
const FROM = pack(10, 10);
const TO = pack(11, 10);

/** m 想从 (10,10) 踩进 (11,10)，那一格站着静止的 still；其余按用例覆盖。 */
function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    intents: [{ name: "m", from: FROM, to: TO, priority: 70 }],
    anchors: new Map(),
    occupancy: new Map([[TO, "still"]]),
    immovable: new Set<string>(),
    shoveCandidates: () => [],
    ...over,
  };
}

function failsOf(over: Partial<ResolveInput> = {}): Partial<Record<ShoveFailReason, number>> {
  return resolveTraffic(input(over)).shoveFails;
}

describe("traffic-resolver 推挤失败原因码（#38）", () => {
  it("8 邻域无合法落格 ⇒ no-landing，且移动方不发指令", () => {
    const out = resolveTraffic(input());
    expect(out.moves.has("m")).toBe(false);
    expect(failsOf()["no-landing"]).toBe(1);
    expect(failsOf().anchor).toBeUndefined();
    expect(failsOf().immovable).toBeUndefined();
  });

  it("占用者锚定优先级不低于移动方 ⇒ anchor（按设计不被推，但必须被看见）", () => {
    const out = failsOf({
      anchors: new Map([["still", 70]]),
      shoveCandidates: () => [pack(11, 11)],
    });
    expect(out.anchor).toBe(1);
    expect(out["no-landing"]).toBeUndefined();
  });

  it("占用者在不可动名单（疲劳己方 / 敌方）⇒ immovable", () => {
    const out = failsOf({ immovable: new Set(["still"]), shoveCandidates: () => [pack(11, 11)] });
    expect(out.immovable).toBe(1);
  });

  it("链式推挤的深层失败不重复计数：一次被挡只算一次顶层 no-landing", () => {
    const deep = pack(11, 11);
    const out = failsOf({
      occupancy: new Map([
        [TO, "still"],
        [deep, "deep"],
      ]),
      // 唯一落点 deep 上也站着一只静止者，而它自己的邻格全无可走 ⇒ 深度 2 失败（不计数）。
      shoveCandidates: (tile: number) => (tile === TO ? [deep] : []),
    });
    expect(out["no-landing"]).toBe(1);
    expect(out.immovable).toBeUndefined();
  });

  it("有落格时正常推挤成功 ⇒ 不留任何失败计数（读数不是新闸）", () => {
    const out = resolveTraffic(
      input({ occupancy: new Map([[TO, "still"]]), shoveCandidates: () => [pack(12, 10)] }),
    );
    expect(out.moves.get("still")).toBe(pack(12, 10));
    expect(out.moves.get("m")).toBe(TO);
    expect(Object.keys(out.shoveFails).length).toBe(0);
  });
});
