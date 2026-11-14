/** 行军威胁房 — intel 威胁识别 + 跨重启威胁记忆（纯函数，无 Game API 依赖）。 */
import type { RoomIntel } from "../intel";

/**
 * 从 intel 视图收集行军威胁房：已知塔、敌方 spawn、非盟主归属。
 * intel 的 room 域是 heap（global reset 即空），本集合只反映「本轮运行中观测到的」威胁；
 * 跨重启的威胁记忆由 kernel.threatRooms 承担（见 remember/remembered）。
 */
export function threatRoomsFromIntel(
  intelByRoom: ReadonlyMap<string, RoomIntel>,
  myUsername: string | undefined,
  allies: readonly string[],
): string[] {
  const threats: string[] = [];
  for (const [roomName, intel] of intelByRoom) {
    if ((intel.towers ?? 0) > 0 || (intel.enemySpawns ?? 0) > 0) {
      threats.push(roomName);
      continue;
    }
    if (intel.owner !== undefined && intel.owner !== myUsername && !allies.includes(intel.owner)) {
      threats.push(roomName);
    }
  }
  return threats;
}

/** 威胁记忆（Memory.kernel.threatRooms：房名 → 最近威胁观测 tick）。 */
export interface ThreatMemory {
  threatRooms?: Record<string, number>;
}

/**
 * 记录威胁观测（write-through：调用方把返回值写回 Memory.kernel.threatRooms）。
 * 已有条目只刷新 tick —— 威胁房不会因为「再观测一次」而洗白，洗白只靠 TTL 过期。
 */
export function rememberThreatRooms(
  memory: ThreatMemory,
  rooms: readonly string[],
  tick: number,
): Record<string, number> {
  const next = { ...(memory.threatRooms ?? {}) };
  for (const roomName of rooms) next[roomName] = tick;
  return next;
}

/** 读取仍未过期的威胁记忆（随 TTL 自然洗白 — 塔被拆/玩家迁走后不再永久规避）。 */
export function rememberedThreatRooms(
  memory: ThreatMemory,
  tick: number,
  ttlTicks: number,
): string[] {
  const out: string[] = [];
  for (const [roomName, seenAt] of Object.entries(memory.threatRooms ?? {})) {
    if (tick - seenAt <= ttlTicks) out.push(roomName);
  }
  return out;
}

/**
 * 行军路线评估（纯函数）：路线序列里任一中间房是已知威胁 → 拒行。
 * 起点与目标房豁免（目标房是 PB 房/侦察目标本身；起点是己方主房）。
 */
export function evaluateMarchRoute(
  routeRooms: readonly string[],
  threatSet: ReadonlySet<string>,
): { ok: boolean; threatRoom?: string } {
  for (let i = 1; i < routeRooms.length - 1; i++) {
    const roomName = routeRooms[i]!;
    if (threatSet.has(roomName)) return { ok: false, threatRoom: roomName };
  }
  return { ok: true };
}
