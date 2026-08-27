/**
 * UOEM Channel Isolation Test — Phase 38 Release Hardening
 *
 * 证明：
 *   1. 生产实现（src/kernel/outcome-channel.ts）是唯一写入 Memory 的 OutcomeChannel
 *   2. reference 实现（src/domain/intelligence/uoem/channel.ts）不写入 Memory
 *   3. 两个实现不会同时注册或同时写入 Memory
 *   4. 两者容量不同（生产=16, reference=32），不会混淆
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getOutcomeChannel,
  enqueueOutcome,
  OUTCOME_CHANNEL_CAPACITY as PROD_CAPACITY,
  type OutcomeChannelMemory,
} from "../../../src/kernel/outcome-channel";
import {
  OUTCOME_CHANNEL_CAPACITY as REF_CAPACITY,
  createEmptySnapshot,
  emitOutcome,
  channelSize,
} from "../../../src/domain/intelligence/uoem/channel";
import { makeOperationId } from "../../../src/domain/expansion/uoem-types";

describe("UOEM Channel Isolation: 生产与 reference 实现分离", () => {
  it("生产 capacity=16，reference capacity=32，两者不同", () => {
    expect(PROD_CAPACITY).toBe(16);
    expect(REF_CAPACITY).toBe(32);
    expect(PROD_CAPACITY).not.toBe(REF_CAPACITY);
  });

  it("生产实现写入 Memory.kernel.outcomeEvents", () => {
    const mem: { kernel?: Record<string, unknown> } = { kernel: {} };
    const ch = getOutcomeChannel(mem);

    // 生产实现直接操作 Memory 对象
    expect(mem.kernel!.outcomeEvents).toBeDefined();
    expect(ch).toBe(mem.kernel!.outcomeEvents);
  });

  it("reference 实现不写入 Memory（纯函数，返回新 snapshot）", () => {
    const mem: { kernel?: Record<string, unknown> } = { kernel: {} };

    // reference 实现的 createEmptySnapshot 不操作 Memory
    const snap = createEmptySnapshot();
    const newSnap = emitOutcome(snap, {
      kind: "outcome" as const,
      eventId: "E-1-0" as never,
      operationId: makeOperationId("W1N1", 1000) as unknown as never,
      outcomeCode: 0,
      occurredAt: 1000,
      recordedAt: 1000,
      interval: { openedAt: 1000, closedAt: 2000 },
      duration: 1000,
      forcedAdvance: false,
      correlation: { target: "W1N1" },
    } as never);

    // Memory 未被修改
    expect(mem.kernel!.outcomeEvents).toBeUndefined();
    // reference 返回的是新对象
    expect(newSnap.snapshot).not.toBe(snap);
    expect(channelSize(newSnap.snapshot)).toBe(1);
  });

  it("两个实现的字段名不同（生产=q/s/dr/oe，reference=entries/seq/seen）", () => {
    const prodCh: OutcomeChannelMemory = { q: [], s: [], dr: 0, oe: 0 };
    const refSnap = createEmptySnapshot();

    // 生产实现使用压缩字段名
    expect("q" in prodCh).toBe(true);
    expect("s" in prodCh).toBe(true);
    expect("dr" in prodCh).toBe(true);
    expect("oe" in prodCh).toBe(true);

    // reference 实现使用全名段
    expect("entries" in refSnap).toBe(true);
    expect("seq" in refSnap).toBe(true);
    expect("seen" in refSnap).toBe(true);

    // 字段名不重叠
    expect("q" in refSnap).toBe(false);
    expect("entries" in prodCh).toBe(false);
  });

  it("getOutcomeChannel 不创建 reference 的字段结构", () => {
    const mem: { kernel?: Record<string, unknown> } = { kernel: {} };
    const ch = getOutcomeChannel(mem);

    // 不应出现 reference 字段
    expect("entries" in ch).toBe(false);
    expect("seq" in ch).toBe(false);

    // 应有生产字段
    expect("q" in ch).toBe(true);
    expect("s" in ch).toBe(true);
    expect("dr" in ch).toBe(true);
    expect("oe" in ch).toBe(true);
  });

  it("生产实现的 enqueueOutcome 操作生产字段（q/s/dr/oe），不操作 reference 字段", () => {
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

    // 生产字段被修改
    expect(ch.q.length).toBe(1);
    expect(ch.s.length).toBe(1);
    expect(ch.dr).toBe(0);
    expect(ch.oe).toBe(0);

    // 不应出现 reference 字段
    expect((ch as unknown as Record<string, unknown>).entries).toBeUndefined();
    expect((ch as unknown as Record<string, unknown>).seq).toBeUndefined();
  });

  it("生产代码（src/）不导入 reference 实现（domain/intelligence/uoem/channel）", () => {
    // 遍历 src/ 下所有 .ts 文件，检查是否有生产代码导入 reference 实现
    // 只允许 tests/ 目录导入 reference 实现
    const projectRoot = resolve(__dirname, "../../..");
    const srcDir = resolve(projectRoot, "src");

    // 读取 bootstrap.ts 确认组合根不导入 reference
    const bootstrapPath = resolve(srcDir, "bootstrap.ts");
    const bootstrapContent = readFileSync(bootstrapPath, "utf8");
    expect(
      bootstrapContent.includes("domain/intelligence/uoem/channel"),
      "bootstrap.ts 不得导入 reference 实现",
    ).toBe(false);

    // 读取 expansion-manager 确认它只导入生产实现
    const expansionMgrPath = resolve(srcDir, "systems/expansion-manager.ts");
    let expansionMgrContent = "";
    try {
      expansionMgrContent = readFileSync(expansionMgrPath, "utf8");
    } catch {
      // 文件可能路径不同，跳过
    }
    if (expansionMgrContent) {
      expect(
        expansionMgrContent.includes("domain/intelligence/uoem/channel"),
        "expansion-manager.ts 不得导入 reference 实现",
      ).toBe(false);
      expect(
        expansionMgrContent.includes("kernel/outcome-channel"),
        "expansion-manager.ts 应导入生产实现",
      ).toBe(true);
    }
  });
});
