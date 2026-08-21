/**
 * 帝国态势评估 — 纯函数，不访问 Game/Memory。
 *
 * 定位（从反射到认知的第一步）：各系统只看自己的切片 —— 扩张不知道候选房邻接
 * 宿敌、战争不知道对方是矿主还是军阀、room-state 不知道新生殖民地正在被降级。
 * 本模块把散落事实聚合成**命名条件**（Named Conditions），供姿态/议程/未来
 * 消费方做带证据的决策，而不是逐系统重复拼凑局部判断。
 *
 * 设计约束：输入全量注入；输出有界（条件数封顶）；每个条件携带 severity(1-3)
 * 与 evidence 字符串 —— 可解释性是自治的可审计前提。
 */

/** 单个敌对行为者的聚合压力画像。 */
export interface AdversaryPressure {
  username: string;
  /** 目击其单位的自有/视野房间。 */
  rooms: string[];
  /** 最近目击 tick（聚合取最大）。 */
  lastSeen: number;
}

export interface SituationRoomInput {
  room: string;
  rcl: number;
  hasSpawn: boolean;
  /** 控制器降级剩余 tick；undefined 视为未知（不触发条件）。 */
  ttd?: number;
  /** 本房当前可见威胁单位（已剔除盟友）。 */
  threats: { owner: string }[];
  colonyState: string;
}

export interface SituationInput {
  tick: number;
  rooms: readonly SituationRoomInput[];
  warBlacklist: Readonly<Record<string, number>>;
  /** 未过期黑名单目标的邻居集合（调用方经 describeExits 预计算）。 */
  hostileAdj?: ReadonlySet<string>;
  /** 当前活跃扩张目标房（若在风险中需升级严重度而非新发条件）。 */
  activeExpansionTarget?: string;
}

export type SituationSeverity = 1 | 2 | 3;

export interface SituationCondition {
  /** 稳定 id（消费方据此做状态变迁检测）。 */
  id: string;
  severity: SituationSeverity;
  detail: string;
}

export interface EmpireSituation {
  tick: number;
  adversaries: AdversaryPressure[];
  conditions: SituationCondition[];
}

/** RCL≤2 且无 spawn 的自有房 —— 新生殖民地（自举车道的服务对象）。 */
function isNewborn(room: SituationRoomInput): boolean {
  return !room.hasSpawn && room.rcl >= 1;
}

export function buildEmpireSituation(input: SituationInput): EmpireSituation {
  const conditions: SituationCondition[] = [];
  const adversaries = new Map<string, AdversaryPressure>();

  for (const room of input.rooms) {
    // ── 敌对行为者聚合 ──
    for (const t of room.threats) {
      if (!t.owner) continue;
      const agg = adversaries.get(t.owner);
      if (agg) {
        if (!agg.rooms.includes(room.room)) agg.rooms.push(room.room);
        if (input.tick > agg.lastSeen) agg.lastSeen = input.tick;
      } else {
        adversaries.set(t.owner, { username: t.owner, rooms: [room.room], lastSeen: input.tick });
      }
    }

    // ── 条件：新生殖民地处于危险中（无 spawn + 敌情 或 控制器濒临降级）──
    if (isNewborn(room)) {
      const underThreat = room.threats.length > 0;
      const ttdCritical = room.ttd !== undefined && room.ttd < ABANDON_TTD_SITUATION;
      if (underThreat || ttdCritical) {
        conditions.push({
          id: `newbornColonyRisk:${room.room}`,
          severity: ttdCritical ? 3 : 2,
          detail:
            `RCL${room.rcl} 无spawn` +
            (underThreat ? ` 敌情x${room.threats.length}` : "") +
            (ttdCritical ? ` TTD=${room.ttd}` : ""),
        });
      }
    }

    // ── 条件：控制器正被降级打击（任意 RCL）──
    if (room.ttd !== undefined && room.ttd < CONTROLLER_PRESSURE_TTD && room.rcl >= 1) {
      conditions.push({
        id: `controllerUnderAttack:${room.room}`,
        severity: 3,
        detail: `RCL${room.rcl} TTD=${room.ttd}`,
      });
    }
  }

  // ── 条件：扩张目标邻接宿敌（事前规避 —— W38S59 教训的前置化）──
  if (input.activeExpansionTarget && input.hostileAdj?.has(input.activeExpansionTarget)) {
    conditions.push({
      id: `expansionAdjacentHostile:${input.activeExpansionTarget}`,
      severity: 2,
      detail: "活跃扩张目标邻接未过期 warBlacklist 宿敌",
    });
  }

  const adversariesSorted = [...adversaries.values()].sort(
    (a, b) => b.rooms.length - a.rooms.length || b.lastSeen - a.lastSeen,
  );

  return {
    tick: input.tick,
    adversaries: adversariesSorted,
    conditions: conditions.sort((a, b) => b.severity - a.severity),
  };
}

/** 新生殖民地危险 TTD 阈值（与 bootstrap 弃房阈值同源口径，独立常量防耦合漂移）。 */
export const ABANDON_TTD_SITUATION = 800;
/** 控制器受压判定：TTTD 低于此值视为正被降级打击（正常衰减以万计）。 */
export const CONTROLLER_PRESSURE_TTD = 2000;
