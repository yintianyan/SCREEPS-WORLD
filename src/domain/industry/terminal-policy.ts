/**
 * Terminal 基础策略 — 预留多房间扩展接口。
 *
 * 当前阶段（单房间）：
 *   - 不主动发送资源
 *   - 接收来自其他房间的资源（被动）
 *   - 维持基础矿物库存平衡（缺什么买什么 — 未来接入市场）
 *
 * 未来扩展：
 *   - 多房间资源调度（W1N9/W7S8/W7N4 互补）
 *   - 市场交易（买入缺少的基础矿物）
 *   - 化合物供应链（A 房间产 H，B 房间产 O，互相发送）
 */
import type { TerminalPolicy, TerminalTransfer } from "./types";

/** 基础矿物库存目标（每种至少保留的量）。 */
const MINERAL_RESERVE_TARGET: Readonly<Record<string, number>> = {
  H: 500,
  O: 500,
  U: 500,
  L: 500,
  K: 500,
  Z: 500,
  X: 200,
};

/**
 * 单房间 Terminal 策略 — 当前为空操作（no-op）。
 * 未来多房间时替换为实际调度逻辑。
 */
export const singleRoomTerminalPolicy: TerminalPolicy = {
  planTransfers(_roomName: string, _available: Readonly<Record<string, number>>): readonly TerminalTransfer[] {
    // 单房间阶段：不主动发送
    return [];
  },
};

/**
 * 检查房间是否缺少某种基础矿物（用于未来市场采购决策）。
 *
 * @param available 当前库存
 * @returns 缺少的矿物列表及缺口量
 */
export function getMineralDeficits(
  available: Readonly<Record<string, number>>,
): Array<{ mineral: string; deficit: number }> {
  const deficits: Array<{ mineral: string; deficit: number }> = [];
  for (const [mineral, target] of Object.entries(MINERAL_RESERVE_TARGET)) {
    const have = available[mineral] ?? 0;
    if (have < target) {
      deficits.push({ mineral, deficit: target - have });
    }
  }
  return deficits;
}
