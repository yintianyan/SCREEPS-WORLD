import { describe, expect, it } from "vitest";
import { dropInsufficientSources } from "../../../src/domain/expansion/candidate";

/**
 * R7b「扩张节奏自适应」里 `minSources` 这一路的消费方。
 * 旧唯一消费者 `domain/expansion/evaluator.ts` 在生产零调用者（只有它自己的测试在读）
 * ⇒ 「连续被抢之后只挑 ≥2 source 的目标」从未生效。这里把接上后的语义钉住。
 */
describe("dropInsufficientSources — 节奏自适应的最低 source 数", () => {
  const pool = [
    { roomName: "W1N1", sourceCount: 1 },
    { roomName: "W1N2", sourceCount: 2 },
    { roomName: "W1N3", sourceCount: 0 },
    { roomName: "W1N4", sourceCount: undefined },
  ];
  const names = (min: number) =>
    dropInsufficientSources(pool, min)
      .map(c => c.roomName)
      .join(",");

  it("minSources=1（今天的实际值）一个都不筛 ⇒ 接线不改变当前行为", () => {
    expect(names(1)).toBe("W1N1,W1N2,W1N3,W1N4");
  });

  it("minSources=2 才生效：单源与零源出局", () => {
    expect(names(2)).toBe("W1N2,W1N4");
  });

  it("未知 sourceCount 是「没看到」不是「不合格」，任何门槛下都保留", () => {
    expect(names(5)).toContain("W1N4");
  });

  it("空池不炸", () => {
    expect(dropInsufficientSources([], 2)).toEqual([]);
  });
});
