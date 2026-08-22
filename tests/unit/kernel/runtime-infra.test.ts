import { describe, expect, it, beforeEach } from "vitest";
import { stateStore, fingerprintMatches } from "../../../src/kernel/state-store";
import {
  traceDecision,
  getDecisionTrace,
  traceByKey,
  resetDecisionTraceForTest,
} from "../../../src/kernel/decision-trace";
import { log, setLogSink } from "../../../src/kernel/log";
import { resetGlobals } from "../../role-helpers";

// 【P1-A】G-F EventBus 已按冻结合同移除（RUNTIME_API §5 禁 publish/subscribe 形态、
// 零消费系统）——原实现备份于会话 /tmp，重引入须走 ARCHITECTURE_FREEZE §15 ADR。

describe("G-G StateStore 族版本", () => {
  beforeEach(() => {
    resetGlobals();
  });

  it("未触碰族版本=0；bump 单调递增并持久在 Memory.kernel", () => {
    expect(stateStore.version("war")).toBe(0);
    expect(stateStore.bump("war")).toBe(1);
    expect(stateStore.version("war")).toBe(1);
    stateStore.bump("war");
    expect(stateStore.version("war")).toBe(2);
    const mem = Memory as unknown as { kernel?: { stateVersions?: Record<string, number> } };
    expect(mem.kernel?.stateVersions?.war).toBe(2);
  });

  it("fingerprintMatches：全族一致才通过", () => {
    stateStore.bump("intel");
    const v = stateStore.version("intel");
    expect(fingerprintMatches([{ family: "intel", version: v }], stateStore)).toBe(true);
    stateStore.bump("intel");
    expect(fingerprintMatches([{ family: "intel", version: v }], stateStore)).toBe(false);
  });
});

describe("G-H DecisionTrace", () => {
  beforeEach(() => {
    resetGlobals();
    resetDecisionTraceForTest();
  });

  it("按层写入/读取，时间序正确", () => {
    traceDecision("intent", "war:q1", "立项", { goalId: "g1" }, 100);
    traceDecision("task", "t9", "领取", { intentKey: "war:q1" }, 101);
    expect(getDecisionTrace("intent")[0]!.key).toBe("war:q1");
    expect(getDecisionTrace("task")[0]!.key).toBe("t9");
    expect(getDecisionTrace("policy")).toHaveLength(0);
  });

  it("容量溢出保留最新；summary 截断", () => {
    for (let i = 0; i < 200; i++) traceDecision("action", "a" + i, "s" + i, undefined, i);
    const all = getDecisionTrace("action", 128);
    expect(all.length).toBe(128);
    expect(all[all.length - 1]!.key).toBe("a199");
    traceDecision("action", "trunc", "x".repeat(300), undefined, 999);
    expect(getDecisionTrace("action")[0]!.summary.length).toBeLessThanOrEqual(120);
  });

  it("traceByKey 跨层串联", () => {
    traceDecision("goal", "g1", "扩张目标", undefined, 1);
    traceDecision("intent", "i1", "claim 计划", { goalId: "g1" }, 2);
    traceDecision("task", "t1", "孵化 claimer", { intentKey: "i1" }, 3);
    const linked = traceByKey("g1");
    expect(linked.map((e) => e.layer)).toContain("goal");
    expect(linked.map((e) => e.layer)).toContain("intent");
  });
});

describe("G-I Logger", () => {
  beforeEach(() => {
    resetGlobals();
    setLogSink(undefined);
  });

  it("级别门：默认 info 级别下 debug 不输出、info 输出", () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    log.debug("m", "hidden-debug");
    log.info("m", "shown-info");
    setLogSink(undefined);
    expect(lines.some((l) => l.includes("hidden-debug"))).toBe(false);
    expect(lines.some((l) => l.includes("shown-info"))).toBe(true);
  });

  it("sink 注入捕获 error 并带模块前缀与 tick", () => {
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    log.error("spawn", "boom");
    setLogSink(undefined);
    expect(lines[0]).toContain("[ERROR][spawn]");
    expect(lines[0]).toContain("boom");
    expect(lines[0]).toMatch(/\[t\d+\]/);
  });
});
