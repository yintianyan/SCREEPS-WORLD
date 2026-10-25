/**
 * 建造管理器的节奏判据（纯函数，零 Game/Memory 引用）。
 *
 * R603：常态建造按间隔降频，紧急重建不受限。把判据抽出来是因为
 * construction-manager 的调用点依赖大量 Game/Memory 与 segment store，
 * 单元测试只能覆盖到这层纯决策；紧急豁免的语义（R583 的回归）必须可钉住。
 */
export function shouldRunConstruction(
  emergency: boolean,
  tick: number,
  lastRun: number | undefined,
  interval: number,
): boolean {
  if (emergency) return true;
  if (lastRun === undefined) return true;
  const iv = Number.isFinite(interval) ? Math.max(1, interval) : 1;
  return tick - lastRun >= iv;
}
