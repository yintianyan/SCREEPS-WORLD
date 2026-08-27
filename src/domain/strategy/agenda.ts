/** 帝国议程 — 主动自治的短期目标层（R6a，docs/architecture/GOAL_POLICY_PLAN_MODEL.md）。 */

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
