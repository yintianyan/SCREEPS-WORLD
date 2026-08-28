/** UOEM 生产 outcome channel — Phase 38 Release Hardening */
import { describe, it, expect } from "vitest";
import {
  getOutcomeChannel,
  enqueueOutcome,
  OUTCOME_CHANNEL_CAPACITY,
  type OutcomeChannelMemory,
} from "../../../src/kernel/outcome-channel";
import { makeOperationId } from "../../../src/domain/expansion/uoem-types";

describe("UOEM 生产 outcome channel", () => {
  it("生产 capacity=16", () => {
    expect(OUTCOME_CHANNEL_CAPACITY).toBe(16);
  });

  it("生产实现写入 Memory.kernel.outcomeEvents", () => {
    const mem: { kernel?: Record<string, unknown> } = { kernel: {} };
    const ch = getOutcomeChannel(mem);

    expect(mem.kernel!.outcomeEvents).toBeDefined();
    expect(ch).toBe(mem.kernel!.outcomeEvents);
  });

  it("生产实现使用压缩字段名 q/s/dr/oe（Memory 体积纪律），无全名字段", () => {
    const prodCh: OutcomeChannelMemory = { q: [], s: [], dr: 0, oe: 0 };

    expect("q" in prodCh).toBe(true);
    expect("s" in prodCh).toBe(true);
    expect("dr" in prodCh).toBe(true);
    expect("oe" in prodCh).toBe(true);
    expect("entries" in prodCh).toBe(false);
    expect("seq" in prodCh).toBe(false);
  });

  it("getOutcomeChannel 不创建全名字段结构", () => {
    const mem: { kernel?: Record<string, unknown> } = { kernel: {} };
    const ch = getOutcomeChannel(mem);

    expect("entries" in ch).toBe(false);
    expect("seq" in ch).toBe(false);
    expect("q" in ch).toBe(true);
    expect("s" in ch).toBe(true);
    expect("dr" in ch).toBe(true);
    expect("oe" in ch).toBe(true);
  });

  it("enqueueOutcome 操作生产字段（q/s/dr/oe）", () => {
    const mem: { kernel?: Record<string, unknown> } = { kernel: {} };
    const ch = getOutcomeChannel(mem);

    const opId = makeOperationId("W1N1", 1000);
    enqueueOutcome(ch, {
      kind: "OUTCOME",
      domain: "expansion",
      result: "COMPLETED",
      operationId: opId,
      eventId: "E-1000-1",
      interval: { openedAt: 1000, closedAt: 2000 },
      forcedAdvance: false,
    });

    expect(ch.q.length).toBe(1);
    expect(ch.s.length).toBe(1);
    expect(ch.dr).toBe(0);
    expect(ch.oe).toBe(0);

    expect((ch as unknown as Record<string, unknown>).entries).toBeUndefined();
    expect((ch as unknown as Record<string, unknown>).seq).toBeUndefined();
  });
});
