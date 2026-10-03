/** R265：违例身份留痕（mergeViolationTraces）——事件只带总数，瞬态违例事后无法归因。 */
import { describe, it, expect } from "vitest";
import {
  mergeViolationTraces,
  VIOLATION_TRACE_CAP,
  type ViolationTrace,
} from "../../../src/kernel/expectations";

const v = (id: string) => ({ id, detail: "d" });

describe("mergeViolationTraces 身份留痕", () => {
  it("首次出现即建条目，seenAt/lastAt 都是当拍", () => {
    const out = mergeViolationTraces(undefined, [v("E2:p3"), v("siteStaleNoWorker:W1N1:s1")], 1000);
    expect(out).toHaveLength(2);
    const e2 = out.find(t => t.id === "E2:p3")!;
    expect(e2.seenAt).toBe(1000);
    expect(e2.lastAt).toBe(1000);
    expect(e2.count).toBe(1);
  });

  it("同一 id 多次出现：count 递增、seenAt 不变、lastAt 前移", () => {
    let trace: ViolationTrace[] = mergeViolationTraces(undefined, [v("E2:p3")], 1000);
    trace = mergeViolationTraces(trace, [v("E2:p3")], 1100);
    trace = mergeViolationTraces(trace, [v("E2:p3")], 1200);
    expect(trace).toHaveLength(1);
    expect(trace[0]!.count).toBe(3);
    expect(trace[0]!.seenAt).toBe(1000);
    expect(trace[0]!.lastAt).toBe(1200);
  });

  it("违例消失后仍留痕（这正是本次要修的可观测性缺口）", () => {
    const first = mergeViolationTraces(undefined, [v("pathFailure:W1N1:c1")], 1000);
    const after = mergeViolationTraces(first, [], 2000);
    expect(after.map(t => t.id)).toContain("pathFailure:W1N1:c1");
    expect(after[0]!.count).toBe(1);
  });

  it("超容量按 lastAt 最旧淘汰，容量恒等于 cap", () => {
    let trace: ViolationTrace[] = [];
    for (let i = 0; i < VIOLATION_TRACE_CAP + 10; i++) {
      trace = mergeViolationTraces(trace, [v(`id-${i}`)], 1000 + i);
    }
    expect(trace).toHaveLength(VIOLATION_TRACE_CAP);
    const ids = new Set(trace.map(t => t.id));
    expect(ids.has("id-0")).toBe(false);
    expect(ids.has(`id-${VIOLATION_TRACE_CAP + 9}`)).toBe(true);
  });

  it("畸形旧条目不炸（缺 id / null 混入时丢弃）", () => {
    const dirty = [
      null,
      { seenAt: 1, lastAt: 2, count: 3 },
      { id: "ok", seenAt: 5, lastAt: 5, count: 1 },
    ];
    const out = mergeViolationTraces(dirty as unknown as ViolationTrace[], [v("new")], 100);
    expect(out.map(t => t.id).sort()).toEqual(["new", "ok"]);
  });
});
