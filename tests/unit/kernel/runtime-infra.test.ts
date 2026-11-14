import { describe, expect, it, beforeEach } from "vitest";
import { log, setLogSink } from "../../../src/kernel/log";
import { resetGlobals } from "../../support/factories";

// EventBus 已按冻结合同移除（禁 publish/subscribe 形态、
// 零消费系统）——重引入须走 ADR。

describe("G-I Logger", () => {
  beforeEach(() => {
    resetGlobals();
    setLogSink(undefined);
  });

  it("级别门：默认 info 级别下 debug 不输出、info 输出", () => {
    const lines: string[] = [];
    setLogSink(line => lines.push(line));
    log.debug("m", "hidden-debug");
    log.info("m", "shown-info");
    setLogSink(undefined);
    expect(lines.some(l => l.includes("hidden-debug"))).toBe(false);
    expect(lines.some(l => l.includes("shown-info"))).toBe(true);
  });

  it("sink 注入捕获 error 并带模块前缀与 tick", () => {
    const lines: string[] = [];
    setLogSink(line => lines.push(line));
    log.error("spawn", "boom");
    setLogSink(undefined);
    expect(lines[0]).toContain("[ERROR][spawn]");
    expect(lines[0]).toContain("boom");
    expect(lines[0]).toMatch(/\[t\d+\]/);
  });
});
