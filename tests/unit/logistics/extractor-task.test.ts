/** A5 — extractor 动态建造任务测试。 */
import { beforeEach, describe, expect, it } from "vitest";
import { createExtractorTask } from "../../../src/domain/layout/task-factory";
import { mockPos, mockSnapshot, resetGlobals } from "../../support/factories";

beforeEach(() => {
  resetGlobals();
});

function mineralAt(x: number, y: number): any {
  return { id: "mineral_1", mineralType: "H", pos: mockPos(x, y) };
}

describe("A5 — createExtractorTask", () => {
  it("RCL6 在矿位上生成 extractor 任务", () => {
    const snap = mockSnapshot({ rcl: 6, minerals: [mineralAt(10, 12)] });
    const task = createExtractorTask(snap);

    expect(task).toBeDefined();
    expect(task!.structureType).toBe("extractor");
    expect(task!.pos.x).toBe(10);
    expect(task!.pos.y).toBe(12);
    expect(task!.priority).toBe(3);
    expect(task!.key).toContain("mineral_1");
  });

  it("RCL5 不生成（未解锁）", () => {
    const snap = mockSnapshot({ rcl: 5, minerals: [mineralAt(10, 12)] });
    expect(createExtractorTask(snap)).toBeUndefined();
  });

  it("已有 extractor 不重复生成", () => {
    const extractor: any = { id: "ex1", structureType: "extractor", pos: mockPos(10, 12) };
    const snap = mockSnapshot({ rcl: 6, minerals: [mineralAt(10, 12)], extractor });
    expect(createExtractorTask(snap)).toBeUndefined();
  });

  it("已有 extractor site 不重复生成", () => {
    const site: any = { id: "site_ex", structureType: "extractor", pos: mockPos(10, 12), my: true };
    const snap = mockSnapshot({ rcl: 6, minerals: [mineralAt(10, 12)], constructionSites: [site] });
    expect(createExtractorTask(snap)).toBeUndefined();
  });

  it("无 mineral 不生成", () => {
    const snap = mockSnapshot({ rcl: 6, minerals: [] });
    expect(createExtractorTask(snap)).toBeUndefined();
  });
});
