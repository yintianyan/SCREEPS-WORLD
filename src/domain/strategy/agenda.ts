/**
 * 帝国议程 — 主动自治的短期目标层（R6a，plan.md §14）。
 *
 * 姿态（posture）回答「帝国处于什么状态」（受袭/健康/战争），议程回答
 * 「帝国现在主动在做什么」。此前所有行为由各系统本地阈值被动反应
 * （升级看 storage 水位、防御看威胁在场），本模块给出单一、可观测、
 * 可解释的帝国级短期目标，执行系统消费它以协调优先级。
 *
 * 优先级（首个命中即当前目标）：
 *   recovery         任一房 colonyState ∈ bootstrap/recovery/crisis — 生存优先。
 *   defense-readiness 任一房近期受袭（lastHostileAt < threatWindow）— 主动备战。
 *   rcl-push         无威胁且全房 RCL<8 且至少一房 storage ≥ rclPushStorage
 *                    且平均压力 ≤ rclPushMaxPressure — 主动冲级（RCL 是复利）。
 *   develop          兜底固本。
 *
 * 滞回：紧急目标（recovery/defense-readiness）进入立即生效（同 posture 哲学）；
 * 普通目标切换（rcl-push ↔ develop）需最短驻留 minDwell 防抖。
 * 纯函数 — 不访问 Game/Memory，计数经 prev 回传（调用方持久化 since）。
 */

export type AgendaInitiative = "recovery" | "defense-readiness" | "rcl-push" | "develop";

export interface AgendaRoomInput {
  colonyState: string;
  economyPressure: number;
  /** 最近一次房内出现威胁的 tick（无记录为 undefined）。 */
  lastHostileAt?: number;
  rcl: number;
  storageEnergy: number;
}

export interface AgendaOptions {
  /** 受袭记忆窗口：lastHostileAt 距今小于此值 → defense-readiness。 */
  threatWindow: number;
  /** rcl-push 的最低 storage 水位（至少一房达标）。 */
  rclPushStorage: number;
  /** rcl-push 允许的最高平均经济压力。 */
  rclPushMaxPressure: number;
  /** 普通目标切换的最短驻留（tick）。 */
  minDwell: number;
}

export const DEFAULT_AGENDA_OPTIONS: AgendaOptions = {
  threatWindow: 3000,
  rclPushStorage: 20000,
  rclPushMaxPressure: 0.3,
  minDwell: 200,
};

export interface AgendaInput {
  tick: number;
  rooms: readonly AgendaRoomInput[];
  /** 上一次评估结果（滞回基准）；首次为 undefined。 */
  prev?: { initiative: AgendaInitiative; since: number };
}

export interface AgendaResult {
  initiative: AgendaInitiative;
  since: number;
}

export function evaluateAgenda(
  input: AgendaInput,
  options: AgendaOptions = DEFAULT_AGENDA_OPTIONS,
): AgendaResult {
  const { tick, rooms, prev } = input;

  const anyCrisis = rooms.some(
    r => r.colonyState === "bootstrap" || r.colonyState === "recovery" || r.colonyState === "crisis",
  );
  const threatRecent = rooms.some(
    r => r.lastHostileAt !== undefined && tick - r.lastHostileAt < options.threatWindow,
  );
  const avgPressure = rooms.length > 0
    ? rooms.reduce((sum, r) => sum + r.economyPressure, 0) / rooms.length
    : 1;
  const canPushRcl =
    !threatRecent &&
    rooms.length > 0 &&
    rooms.every(r => r.rcl < 8) &&
    rooms.some(r => r.storageEnergy >= options.rclPushStorage) &&
    avgPressure <= options.rclPushMaxPressure;

  const target: AgendaInitiative = anyCrisis
    ? "recovery"
    : threatRecent
      ? "defense-readiness"
      : canPushRcl
        ? "rcl-push"
        : "develop";

  const prevInitiative = prev?.initiative ?? "develop";
  const since = prev?.since ?? tick;
  if (target === prevInitiative) {
    return { initiative: target, since };
  }
  // 首次评估（无历史）直接采纳目标；此后紧急目标立即生效，普通切换需驻留
  // （防 rcl-push ↔ develop 在阈值附近抖动）。
  if (prev === undefined) {
    return { initiative: target, since: tick };
  }
  const emergency = target === "recovery" || target === "defense-readiness";
  if (!emergency && tick - since < options.minDwell) {
    return { initiative: prevInitiative, since };
  }
  return { initiative: target, since: tick };
}
