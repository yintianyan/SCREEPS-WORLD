import { CONFIG } from "../../config";

/**
 * 远矿 hauler 的孵化编制。满产需求按当前已就位（或已排队）采集者等比收缩；
 * 这是“少孵”的软上限，不用于回收健康现役 hauler——远矿通勤反馈长，已付出的
 * 运力应留到采集端恢复，避免低能量期把收缩放大成断供。
 */
export function remoteHaulerTarget(
  sources: number | undefined,
  haulerNeed: number | undefined,
  harvestersReady: number,
): number {
  const sourcesTotal = Math.max(1, sources ?? CONFIG.remote.harvestersPerTarget);
  const effectiveSources = Math.min(sourcesTotal, Math.max(1, harvestersReady));
  return Math.max(1, Math.ceil(
    (haulerNeed ?? CONFIG.remote.haulersPerTarget) * (effectiveSources / sourcesTotal),
  ));
}

/**
 * 远矿交接窗口中的通勤预算。pathCost 的 plain=1/swamp=5 与满 MOVE 通勤
 * tick 同量纲；额外 15 tick 覆盖出生、出口和 source/container 的末段偏差。
 */
export function remoteTravelBuffer(pathCost: number | undefined): number {
  if (pathCost === undefined || !Number.isFinite(pathCost)) return 50;
  return Math.max(35, Math.min(250, Math.ceil(pathCost) + 15));
}

/** 孵化时间 + 常规替补余量 + 到远矿岗位的通勤时间。 */
export function remoteReplacementThreshold(
  bodyLength: number | undefined,
  pathCost: number | undefined,
): number {
  return (bodyLength ?? 3) * 3 + CONFIG.spawn.replaceBuffer + remoteTravelBuffer(pathCost);
}
