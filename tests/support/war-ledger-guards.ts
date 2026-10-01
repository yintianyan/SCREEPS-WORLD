/**
 * E2E-022（war 账本）R-04 判据的纯函数部分。
 *
 * 为什么抽出来：war↔fortify 的降级时刻与危机带的对应关系，是这条防振荡断言的全部语义。
 * 留在 e2e 里就只能靠"跑到一个有降级的世界"来验它（一次约 200 秒，且历史 6 个世界里只有 2 个有降级，
 * 命中率约 1/3 —— 等于拿掷骰子当验证）；抽成纯函数后可以用合成样本一次定死。
 *
 * 机制依据（不要退回旧口径）：`posture.ts` 里「上一态 war + 危机带 + 无真实在房威胁 ⇒ 立即降 fortify」
 * 是**规定动作**（recovery/bootstrap 是比威胁记忆更强的经济信号）。所以"降级数为 0"不是安全属性，
 * 而是禁止规定动作；真正该罚的是**无法被危机带解释的降级**与**撤资-再战-再撤资的振荡**。
 */

/** 判据只用到这两列，结构上与场景里的 BandRun 兼容。 */
export interface BandSpan {
  from: number;
  to: number;
}

/**
 * 危机带是**每 250 拍采样**出来的区间，而降级发生在具体某一拍 ⇒ 采样相位可以让带子"看起来晚到"。
 * 这个 +3 就是那段容差（早于它会把采样相位的正常滞后误判成故障）。
 */
export const BAND_ONSET_TOLERANCE_TICKS = 3;

export interface DowngradeVerdict {
  /** 能被某段危机带解释的降级时刻（撤资路径）。 */
  explained: number[];
  /** 找不到对应危机带的降级时刻 —— R-04 要抓的就是这些。 */
  unexplained: number[];
}

export function classifyDowngrades(ticks: number[], bands: BandSpan[]): DowngradeVerdict {
  const explained: number[] = [];
  const unexplained: number[] = [];
  for (const tick of ticks) {
    const hit = bands.some(
      band => tick >= band.from && tick <= band.to + BAND_ONSET_TOLERANCE_TICKS,
    );
    (hit ? explained : unexplained).push(tick);
  }
  return { explained, unexplained };
}

/**
 * 一条世界线是否通过 R-04。判据三件里的前两件在这里（第三件"war 窗内危机带 tick==0"
 * 属于世界读数本身，留在场景里断言）。
 *
 * 允许上限取 1：一次被带解释的撤资是规定动作；两次意味着 war↔fortify 来回摆，即振荡。
 */
export function violatesOscillationGuard(
  verdict: DowngradeVerdict,
  maxWithdrawals = 1,
): string | null {
  if (verdict.unexplained.length > 0) {
    return `${verdict.unexplained.length} 次降级没有同刻危机带可解释（不是撤资路径）：${verdict.unexplained.join(",")}`;
  }
  if (verdict.explained.length > maxWithdrawals) {
    return `被危机带解释的降级 ${verdict.explained.length} 次 > ${maxWithdrawals} —— 撤资-再战-再撤资属振荡：${verdict.explained.join(",")}`;
  }
  return null;
}
