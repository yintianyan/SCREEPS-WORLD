/** cadenceSafeGate —— 低频内部门的 cadence 无关性测试（2026-11-21 线上事故回归）。
 *
 * 事故：G6 cadence 覆盖层把 empire-strategy 降为每 5 拍（运行拍 ≡4 mod 5）后，
 * 内部绝对门 tick%100===0（≡0 mod 5）与 tick%100===16（≡1 mod 5）**永无交集**
 * —— 环境画像与专业化规划（供给合同清理/pb 清扫）静默停摆 58 万拍，直至
 * 2026-11-21 部署后读 Memory 才发现（env.tick 与僵尸合同 ca=83316316 双双冻结）。
 * 本文件钉住：门必须在任何 cadence 的运行拍序列内可命中。
 */
import { describe, expect, it } from "vitest";
import { cadenceSafeGate, systemPhase } from "../../../src/kernel/phase";

describe("cadenceSafeGate — 低频门与 cadence 覆盖层共存", () => {
  it("线上事故复现：cadence=5（运行拍 ≡4 mod 5）下，绝对门永无交集，距离门必命中", () => {
    // 复算事故数学：G6 覆盖后运行拍 = tick ≡ 4 (mod 5)。
    const cadence = 5;
    const runPhase = systemPhase("empire-strategy", cadence);
    expect(runPhase).toBe(4); // 钉住事故现场常数（哈希算法变才会红）

    // 旧绝对门在运行拍序列上的可命中数 = 0（这就是 58 万拍停摆的根源）
    const runTicks = [] as number[];
    for (let t = 83816500; t < 83816500 + 600000; t++) {
      if (t % cadence === runPhase) runTicks.push(t);
    }
    const absEnvHits = runTicks.filter(t => t % 100 === 0).length;
    const absSpecHits = runTicks.filter(t => t % 100 === 16).length;
    expect(absEnvHits).toBe(0);
    expect(absSpecHits).toBe(0);

    // 新距离门：同一运行拍序列上每 ≥100 拍必命中一次（600K 拍 ≈ 6000 次命中）
    let last: number | undefined;
    let fired = 0;
    for (const t of runTicks) {
      if (cadenceSafeGate(last, t, 100)) {
        last = t;
        fired++;
      }
    }
    expect(fired).toBeGreaterThanOrEqual(5900);
    expect(fired).toBeLessThanOrEqual(6100);
  });

  it("boot（钟缺失）立即放行；执行后间隔内不放行、达到 interval 放行", () => {
    expect(cadenceSafeGate(undefined, 1000, 100)).toBe(true);
    const last = 1000;
    expect(cadenceSafeGate(last, 1099, 100)).toBe(false);
    expect(cadenceSafeGate(last, 1100, 100)).toBe(true);
  });

  it("lab-manager 同族检查：其绝对门（%50===11）在 cadence=10（≡1 mod 10）下恰好可命中", () => {
    // 同族扫描结论（2026-11-21）：lab 的绝对门哈希巧合可命中 —— 若未来哈希算法
    // 或 cadence 变更，本例会红，提醒迁移到 cadenceSafeGate。
    const runPhase = systemPhase("lab-manager", 10);
    const gatePhase = systemPhase("lab-manager", 50);
    expect(gatePhase % 10).toBe(runPhase); // 交集存在 ⇒ 现状可运行
  });
});
