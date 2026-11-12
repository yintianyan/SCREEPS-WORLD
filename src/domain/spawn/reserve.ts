/**
 * 孵化现金池的常态预留（Phase 2）。
 *
 * 固定 1200 只在容量足够时成立；小容量房（W7N2 cashCap=2300）若保留 1200，
 * P2 请求会被预留本身全部挡死（R647 同型教训）。因此按容量 25% 钳制。
 */
export function energyReserveFor(
  energyCapacityAvailable: number,
  configuredReserve: number,
): number {
  // <2000 的房（RCL1-4 早期/小容量）不持有常态预留：那里 P2 请求本就贴着
  // 最小 body 成本，再扣 25% 会重演 R647 的「预留把 P2 全部挡死」。
  if (energyCapacityAvailable < 2000) return 0;
  return Math.min(Math.max(0, configuredReserve), Math.floor(energyCapacityAvailable * 0.25));
}
