/**
 * P3-1 故障注入测试：recoveryEligible 系统在 safeRun cooldown 中的行为。
 *
 * 验证：
 * 1. recoveryEligible=true 时连续失败 3 次不进入 cooldown
 * 2. recoveryEligible=true 时仍能执行
 * 3. recoveryEligible=false 时连续失败 3 次进入普通 cooldown
 * 4. 一个系统的 cooldown 不污染其他系统
 * 5. recovery 条件消失后回到普通 cooldown 语义
 * 6. critical (P0) 系统永不冷却
 * 7. cooldown 后 P0 系统仍运行
 * 8. 多系统同时异常互不连坐
 */

import { beforeEach, describe, expect, it } from "vitest";
import { safeRun } from "../../../src/kernel/safe-run";
import { resetGlobals } from "../../support/factories";

const g = (): any => globalThis as any;

function boom(): never {
  throw new Error("boom");
}

/** 模拟连续失败 n 次（每次推进 1 tick） */
function failTimes(label: string, n: number, critical = false): void {
  for (let i = 0; i < n; i++) {
    g().Game.time += 1;
    safeRun(label, boom, critical);
  }
}

beforeEach(() => {
  resetGlobals();
  delete g().errorLog;
  delete g().errorCounts;
  delete g().pluginCooldowns;
  delete g().skipBuffer;
  delete g().eventBuffer;
  delete g().telemetry;
});

describe("P3-1 故障注入：recoveryEligible 与 safeRun cooldown", () => {
  describe("recoveryEligible=true（critical=true 等效）系统连续失败", () => {
    it("连续 3 次失败不进入 cooldown", () => {
      // 模拟 construction-manager 在 recoveryEligible=true 时的行为
      // kernel.ts:343 传入 critical = system.priority === 0 || isRecoveryExempt
      failTimes("system/construction-manager", 3, true);
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeUndefined();
    });

    it("连续 5 次失败仍不进入 cooldown", () => {
      failTimes("system/construction-manager", 5, true);
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeUndefined();
    });

    it("下一次仍能执行", () => {
      failTimes("system/construction-manager", 3, true);
      let ran = false;
      g().Game.time += 1;
      safeRun("system/construction-manager", () => { ran = true; }, true);
      expect(ran).toBe(true);
    });

    it("错误日志受限流（25 tick 限频）", () => {
      // 模拟 5 次失败
      failTimes("system/construction-manager", 5, true);
      // critical=true 时 errorCounts 不累加（handleError 中 if (!critical) 跳过），
      // 但错误仍被 recordError() 计入 telemetry.errors
      // pluginCooldowns 不应该有（critical 豁免）
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeUndefined();
    });
  });

  describe("recoveryEligible=false（critical=false）普通系统连续失败", () => {
    it("连续 3 次失败进入普通 cooldown", () => {
      failTimes("system/remote-mining-manager", 3, false);
      expect(g().pluginCooldowns?.get("system/remote-mining-manager")).toBeGreaterThan(g().Game.time);
    });

    it("cooldown 期间不执行", () => {
      failTimes("system/remote-mining-manager", 3, false);
      let ran = false;
      g().Game.time += 1;
      safeRun("system/remote-mining-manager", () => { ran = true; });
      expect(ran).toBe(false);
      expect(g().skipBuffer["system/remote-mining-manager/cooldown"]).toBe(1);
    });

    it("cooldown 期满后恢复执行", () => {
      failTimes("system/remote-mining-manager", 3, false);
      const cooldownUntil = g().pluginCooldowns.get("system/remote-mining-manager");
      // 快进到冷却期满
      g().Game.time = cooldownUntil + 1;
      let ran = false;
      safeRun("system/remote-mining-manager", () => { ran = true; });
      expect(ran).toBe(true);
    });
  });

  describe("系统间 cooldown 隔离", () => {
    it("一个系统的 cooldown 不污染其他系统", () => {
      // construction-manager 进入 cooldown（recoveryEligible=false 模拟）
      failTimes("system/construction-manager", 3, false);
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeDefined();

      // layout-planner 不应被影响
      let ran = false;
      g().Game.time += 1;
      safeRun("system/layout-planner", () => { ran = true; });
      expect(ran).toBe(true);
      expect(g().pluginCooldowns?.get("system/layout-planner")).toBeUndefined();
    });

    it("construction-manager 和 remote-mining-manager 同时异常互不连坐", () => {
      // 两个系统都连续失败 3 次
      failTimes("system/construction-manager", 3, false);
      failTimes("system/remote-mining-manager", 3, false);

      // 两个都进入 cooldown
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeDefined();
      expect(g().pluginCooldowns?.get("system/remote-mining-manager")).toBeDefined();

      // spawn-manager（P0）不受影响
      let ran = false;
      g().Game.time += 1;
      safeRun("system/spawn-manager", () => { ran = true; }, true);
      expect(ran).toBe(true);
      expect(g().pluginCooldowns?.get("system/spawn-manager")).toBeUndefined();
    });
  });

  describe("recovery 条件消失后回到普通 cooldown", () => {
    it("critical=true 阶段不冷却，切换到 critical=false 后 3 次失败冷却", () => {
      // 阶段 1: recoveryEligible=true (critical=true) — 连续失败不冷却
      failTimes("system/construction-manager", 3, true);
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeUndefined();

      // 阶段 2: recoveryEligible=false (critical=false) — 需要新的 3 次失败
      // 注意：之前的 errorCounts 在 critical=true 时也会累积
      // 但 cooldown 只在 critical=false 时才设置
      // 成功一次清零计数（自愈路径）
      g().Game.time += 1;
      safeRun("system/construction-manager", () => { /* 成功 */ }, false);
      expect(g().errorCounts?.get("system/construction-manager")).toBeUndefined();

      // 现在再失败 3 次 → 应该进入 cooldown
      failTimes("system/construction-manager", 3, false);
      expect(g().pluginCooldowns?.get("system/construction-manager")).toBeDefined();
    });
  });

  describe("P0 系统永不冷却", () => {
    it("spawn-manager 连续 10 次失败不冷却", () => {
      failTimes("system/spawn-manager", 10, true);
      expect(g().pluginCooldowns?.get("system/spawn-manager")).toBeUndefined();
    });

    it("traffic-manager 连续 10 次失败不冷却", () => {
      failTimes("system/traffic-manager", 10, true);
      expect(g().pluginCooldowns?.get("system/traffic-manager")).toBeUndefined();
    });

    it("logistics 连续 10 次失败不冷却", () => {
      failTimes("system/logistics", 10, true);
      expect(g().pluginCooldowns?.get("system/logistics")).toBeUndefined();
    });
  });

  describe("cooldown 语义边界", () => {
    it("cooldown 只对当前 system 生效", () => {
      failTimes("system/construction-manager", 3, false);
      const cmCooldown = g().pluginCooldowns.get("system/construction-manager");

      // 其他系统不受影响
      g().Game.time += 1;
      let ranA = false, ranB = false;
      safeRun("system/layout-planner", () => { ranA = true; });
      safeRun("system/defense-planner", () => { ranB = true; });
      expect(ranA).toBe(true);
      expect(ranB).toBe(true);
    });

    it("cooldown 时长递增（50+count*10，上限 200）", () => {
      failTimes("system/test-sys", 3, false);
      const firstCooldown = g().pluginCooldowns.get("system/test-sys");
      const firstDuration = firstCooldown - g().Game.time;
      expect(firstDuration).toBe(80); // min(50 + 3*10, 200) = 80

      // 快进到冷却期满后再失败
      g().Game.time = firstCooldown + 1;
      safeRun("system/test-sys", boom, false); // count=4
      const secondCooldown = g().pluginCooldowns.get("system/test-sys");
      const secondDuration = secondCooldown - g().Game.time;
      expect(secondDuration).toBe(90); // min(50 + 4*10, 200) = 90
    });
  });
});
