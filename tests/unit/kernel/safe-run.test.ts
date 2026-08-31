/** safe-run 错误边界测试 — K-2 冷却三修的回归保护。 */
import { beforeEach, describe, expect, it } from "vitest";
import { safeRun } from "../../../src/kernel/safe-run";
import { EventKind } from "../../../src/kernel/event-log";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

function boom(): never {
  throw new Error("boom");
}

/** 连续触发 n 次错误（每次相隔 1 tick，避免同 tick 语义干扰）。 */
function failTimes(label: string, n: number): void {
  for (let i = 0; i < n; i++) {
    g().Game.time += 1;
    safeRun(label, boom);
  }
}

beforeEach(() => {
  resetGlobals();
  // safe-run 的冷却/计数表挂在 globalCache — 显式清理防跨用例污染。
  delete g().errorLog;
  delete g().errorCounts;
  delete g().pluginCooldowns;
  delete g().skipBuffer;
  delete g().eventBuffer;
  delete g().telemetry;
});

describe("safeRun — 冷却触发与可观测性（K-2a/K-2c）", () => {
  it("连续 3 次错误进入冷却，冷却期间不执行且记 skipReason", () => {
    failTimes("system/link-system", 3);
    expect(g().pluginCooldowns.get("system/link-system")).toBeGreaterThan(g().Game.time);

    // 冷却期间：action 不执行 + skipBuffer 记录。
    let ran = false;
    g().Game.time += 1;
    safeRun("system/link-system", () => { ran = true; });
    expect(ran).toBe(false);
    expect(g().skipBuffer["system/link-system/cooldown"]).toBe(1);
  });

  it("进入冷却时写 PluginCooldown 事件（枚举不再是死码）", () => {
    failTimes("system/lab-system", 3);
    const events = g().eventBuffer?.events ?? [];
    const cooldownEvents = events.filter((e: any) => e.k === EventKind.PluginCooldown);
    expect(cooldownEvents).toHaveLength(1);
    expect(cooldownEvents[0].r).toBe("system/lab-system");
    expect(cooldownEvents[0].d[0]).toBe(80); // 首轮：min(50 + 3×10, 200)
  });

  it("2 次错误不触发冷却", () => {
    failTimes("system/x", 2);
    expect(g().pluginCooldowns?.get("system/x")).toBeUndefined();
  });
});

describe("safeRun — 冷却时长真递增（K-2b）", () => {
  it("冷却期满后再失败：计数续增，第二轮冷却 90 tick", () => {
    failTimes("system/y", 3); // count=3 → 冷却 80
    // 快进到冷却期满。
    g().Game.time = g().pluginCooldowns.get("system/y") + 1;

    safeRun("system/y", boom); // count=4 → 冷却 min(50+40, 200)=90
    expect(g().pluginCooldowns.get("system/y")).toBe(g().Game.time + 90);
  });

  it("持续失败最终封顶 200 tick", () => {
    failTimes("system/z", 3);
    for (let round = 0; round < 20; round++) {
      g().Game.time = g().pluginCooldowns.get("system/z") + 1;
      safeRun("system/z", boom);
    }
    const remaining = g().pluginCooldowns.get("system/z") - g().Game.time;
    expect(remaining).toBe(200);
  });

  it("成功一次重置计数 — 自愈路径不回归", () => {
    failTimes("system/w", 2); // count=2，未冷却
    g().Game.time += 1;
    safeRun("system/w", () => { /* 成功 */ });
    // 计数已清零 — 再错 2 次仍不触发冷却。
    failTimes("system/w", 2);
    expect(g().pluginCooldowns?.get("system/w")).toBeUndefined();
  });
});

describe("safeRun — critical 永不冷却", () => {
  it("critical 连续错误不进冷却表且始终执行", () => {
    for (let i = 0; i < 5; i++) {
      g().Game.time += 1;
      safeRun("memory", boom, true);
    }
    expect(g().pluginCooldowns?.get("memory")).toBeUndefined();

    let ran = false;
    g().Game.time += 1;
    safeRun("memory", () => { ran = true; }, true);
    expect(ran).toBe(true);
  });
});
