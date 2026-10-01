import { describe, expect, it } from "vitest";
import {
  BAND_ONSET_TOLERANCE_TICKS,
  classifyDowngrades,
  violatesOscillationGuard,
} from "../../support/war-ledger-guards";

/**
 * R-04 判据的非空转性证明。
 *
 * 存在理由：e2e 那条断言只有"跑到一个有降级的世界"才会被激励，而历史上六个世界里只有两个有降级
 * （命中率约 1/3，每次约 200 秒）—— 那不是验证，是掷骰子。这里用合成样本把三件事一次定死：
 * ①无带可解释的降级必须转红；②多次撤资必须转红；③单次且同刻有带必须放过（posture.ts 的规定动作）。
 */
describe("E2E-022 R-04 判据（纯函数）", () => {
  const band = { from: 6000, to: 6010 };

  it("①无带可解释的降级 ⇒ 违规（旧写法在这里与新写法同样红，非空转的关键一支）", () => {
    const verdict = classifyDowngrades([7569], [band]);
    expect(verdict.explained).toEqual([]);
    expect(verdict.unexplained).toEqual([7569]);
    expect(violatesOscillationGuard(verdict)).toMatch(/没有同刻危机带/);
  });

  it("②两次撤资 ⇒ 违规（振荡）", () => {
    const bands = [band, { from: 7000, to: 7005 }];
    const verdict = classifyDowngrades([6005, 7002], bands);
    expect(verdict.unexplained).toEqual([]);
    expect(verdict.explained).toEqual([6005, 7002]);
    expect(violatesOscillationGuard(verdict)).toMatch(/振荡/);
  });

  it("③单次且同刻有带 ⇒ 放过（这就是本会话那两个被误判成回归的世界）", () => {
    const verdict = classifyDowngrades([6085], [{ from: 6085, to: 6087 }]);
    expect(verdict.unexplained).toEqual([]);
    expect(violatesOscillationGuard(verdict)).toBeNull();
  });

  it("采样相位容差：带子尾端之后 BAND_ONSET_TOLERANCE_TICKS 内仍算被解释，再晚就不算", () => {
    const inside = band.to + BAND_ONSET_TOLERANCE_TICKS;
    expect(classifyDowngrades([inside], [band]).unexplained).toEqual([]);
    expect(classifyDowngrades([inside + 1], [band]).unexplained).toEqual([inside + 1]);
  });

  it("空世界（无降级）不违规 —— 但这条不能单独当证据，故上面四支都在", () => {
    expect(violatesOscillationGuard(classifyDowngrades([], []))).toBeNull();
  });
});
