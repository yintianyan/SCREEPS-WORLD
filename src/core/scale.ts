/**
 * 尺度原语（纯函数，零依赖）：跨层共用的翻转/平滑数学，不含任何业务语义。
 * 位点函数保留各自的签名与比较算子，只把「翻转与保持」的共性收敛到这里。
 */

/**
 * 闩锁翻转：双条件 + 双向最短保持。
 * - 活跃中：解除条件成立且已保持满 minActiveTicks 才退出，否则维持。
 * - 空闲中：进入条件成立且已保持满 minIdleTicks 才进入，否则维持。
 * - 两个条件都不成立（带内）时一律维持原态。
 * 比较算子（>= / > / < / <=）由位点按各自口径构造 trip/release，本函数不读数值；
 * heldTicks 由位点用 (tick − since) 计算，无驻留约束的位点传 0/0。
 */
export function flipLatch(
  prev: boolean,
  trip: boolean,
  release: boolean,
  heldTicks: number,
  minIdleTicks: number,
  minActiveTicks: number,
): boolean {
  if (prev) {
    if (release && (minActiveTicks <= 0 || heldTicks >= minActiveTicks)) return false;
    return true;
  }
  return trip && (minIdleTicks <= 0 || heldTicks >= minIdleTicks);
}

/**
 * 指数平滑：首窗（无历史或历史非法）直接取现值，否则 prev + α×(sample − prev)。
 * 多份逐字相同的位点实现（净流/生产速率/消费速率）由此收敛为一份。
 */
export function emaSample(prev: number | undefined, sample: number, alpha: number): number {
  if (prev === undefined || !Number.isFinite(prev)) return sample;
  return prev + alpha * (sample - prev);
}
