/**
 * `measuredRun` 的相位桶归因 —— 钉住两件事：
 *  1) `phase/*` 标签落进 `cpuCumulative.phases`（整拍跨度账），而**裸标签**（如 `memory`）
 *     会被 `recordCpu` 的四个前缀分支全部漏掉 ⇒ 这就是 tick 开头那段此前"账外 0.9/拍"的成因；
 *  2) telemetry 门是在 `finally` 里判的 ⇒ 一个块内才跑 `initTelemetry` 的跨度仍然整段入账
 *     （`phase/pre` 因此有效，不是只记到 init 之后那一小截）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { measuredRun } from "../../../src/kernel/safe-run";
import { globalCache } from "../../../src/kernel/global-cache";
import { initTelemetry } from "../../../src/kernel/telemetry";
import { resetGlobals } from "../../support/factories";

function setTime(t: number): void {
  (globalThis as unknown as { Game: { time: number } }).Game.time = t;
}

/** 让 getUsed 每调用一次前进 step，模拟块内真实耗用。 */
function rampCpu(step: number): void {
  let used = 0;
  const cpu = (globalThis as unknown as { Game: { cpu: { getUsed: () => number } } }).Game.cpu;
  cpu.getUsed = () => {
    const before = used;
    used += step;
    return before;
  };
}

beforeEach(() => {
  resetGlobals();
  setTime(1000);
});

describe("measuredRun — 相位桶归因", () => {
  it("phase/* 落进 cpuCumulative.phases，并按跨度累计", () => {
    initTelemetry(1000);
    rampCpu(0.5);
    const cost = measuredRun("phase/pre", () => {
      // 块内两次耗用 ⇒ 跨度差 = 1.0
      globalThis.Game.cpu.getUsed();
      globalThis.Game.cpu.getUsed();
    });
    const cum = (
      globalCache() as unknown as { cpuCumulative?: { phases?: Record<string, number> } }
    ).cpuCumulative;
    expect(cost).toBeGreaterThan(0);
    expect(cum?.phases?.pre).toBeCloseTo(cost, 5);
  });

  it("裸标签（无 system//creep//room//phase/ 前缀）不进任何桶 —— 账外那笔的机制", () => {
    initTelemetry(1000);
    rampCpu(0.5);
    measuredRun("memory", () => {
      globalThis.Game.cpu.getUsed();
    });
    const cum = (
      globalCache() as unknown as {
        cpuCumulative?: {
          phases?: Record<string, number>;
          systems?: Record<string, number>;
          roles?: Record<string, number>;
        };
      }
    ).cpuCumulative;
    expect(cum?.phases?.memory).toBeUndefined();
    expect(cum?.systems?.memory).toBeUndefined();
    expect(cum?.roles?.memory).toBeUndefined();
  });

  it("块内才 initTelemetry 也整段入账（门在 finally 判，不是在入口判）", () => {
    // 起手把这份累计账清掉，才看得出"这一枚 measuredRun 自己建了桶"
    delete (globalCache() as unknown as { cpuCumulative?: unknown }).cpuCumulative;
    rampCpu(0.5);
    const cost = measuredRun("phase/pre", () => {
      initTelemetry(1000);
      globalThis.Game.cpu.getUsed();
      globalThis.Game.cpu.getUsed();
    });
    expect(cost).toBeGreaterThan(0);
    const after = (
      globalCache() as unknown as { cpuCumulative?: { phases?: Record<string, number> } }
    ).cpuCumulative;
    expect(after?.phases?.pre).toBeCloseTo(cost, 5);
  });
});
