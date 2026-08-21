/**
 * 新生殖民地自举（Bootstrap）— 纯决策函数，不访问 Game/Memory。
 *
 * 背景（W38S59 事故实证）：扩张任务在 spawn 建成时记 success 离场，此后新生
 * RCL1 殖民地被宿敌 WORK 单位 attackController 打穿 TTD 并摧毁 spawn —— 任务
 * 已结束，本地 spawnQueue 无 spawn 永不可孵化，建造无 builder 可用，唯一活路
 * 是姊妹房代孵 bootstrap 组（worker 建造 + 敌情时 defender 护航）。
 *
 * 止损口径（G11 弃房取舍同源）：TTD 危急且敌情在场 → abandon 永久标记，
 * 不再投喂单位资敌；清空本地不可孵化队列（TTL churn 噪声源）由系统层执行。
 */
export interface BootstrapRoomInput {
  room: string;
  /** 控制器降级剩余 tick；undefined = 未知（无视野不可能 —— owned 房恒有视野）。 */
  ttd?: number;
  hostileCount: number;
  /** 系统层已选定的最近可用 sponsor（容量过滤后）；undefined = 无可用 sponsor。 */
  sponsor?: { room: string; capacityAvailable: number };
}

export interface BootstrapLedgerEntry {
  /** 冷却截止 tick：此 tick 前不重复派波。 */
  until: number;
  /** 已派波次。 */
  waves: number;
  /** 弃房标记（tick）—— 永久跳过，控制权自然移交。 */
  abandoned?: number;
}

export type BootstrapLedger = Record<string, BootstrapLedgerEntry | undefined>;

export interface BootstrapDecision {
  room: string;
  action: "dispatch" | "abandon" | "none";
  sponsor?: string;
  reason: string;
}

/** 派波冷却：覆盖「孵化 + 通勤 + 建造」的合理周期，防敌情下无限投喂。 */
export const BOOTSTRAP_COOLDOWN_TICKS = 2500;
/** 弃房 TTD 阈值：低于此值且有敌情 → 判定不可守。 */
export const ABANDON_TTD_THRESHOLD = 800;
/** sponsor 容量门槛：需能同时承载 worker(600) 与 defender(400) 两组 body。 */
export const BOOTSTRAP_MIN_SPONSOR_CAPACITY = 1000;

/** worker：3W3C3M = 600 —— 单程自足建满 RCL1 前置。 */
export const BOOTSTRAP_WORKER_BODY = [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE] as const;
/** defender：远程风筝 2RA2M = 400 —— 对无防御部件的采矿/降级单位占优。 */
export const BOOTSTRAP_DEFENDER_BODY = [RANGED_ATTACK, RANGED_ATTACK, MOVE, MOVE] as const;

export function decideBootstrapRooms(input: {
  tick: number;
  rooms: readonly BootstrapRoomInput[];
  ledger: BootstrapLedger;
}): { decisions: BootstrapDecision[]; ledgerUpdates: Record<string, BootstrapLedgerEntry> } {
  const decisions: BootstrapDecision[] = [];
  const ledgerUpdates: Record<string, BootstrapLedgerEntry> = {};
  for (const r of input.rooms) {
    const entry = input.ledger[r.room];
    if (entry?.abandoned !== undefined) {
      decisions.push({ room: r.room, action: "none", reason: "abandoned" });
      continue;
    }
    if ((entry?.until ?? 0) > input.tick) {
      decisions.push({ room: r.room, action: "none", reason: "cooldown" });
      continue;
    }
    // 弃房止损：TTD 危急 + 敌情在场 —— 投喂只会资敌（升级无门，TTD 不可恢复）。
    if (r.ttd !== undefined && r.ttd < ABANDON_TTD_THRESHOLD && r.hostileCount > 0) {
      ledgerUpdates[r.room] = { until: 0, waves: entry?.waves ?? 0, abandoned: input.tick };
      decisions.push({
        room: r.room,
        action: "abandon",
        reason: "ttd=" + r.ttd + "<" + ABANDON_TTD_THRESHOLD + " hostiles=" + r.hostileCount,
      });
      continue;
    }
    if (!r.sponsor || r.sponsor.capacityAvailable < BOOTSTRAP_MIN_SPONSOR_CAPACITY) {
      decisions.push({ room: r.room, action: "none", reason: "no-capacity-sponsor" });
      continue;
    }
    ledgerUpdates[r.room] = {
      until: input.tick + BOOTSTRAP_COOLDOWN_TICKS,
      waves: (entry?.waves ?? 0) + 1,
    };
    decisions.push({
      room: r.room,
      action: "dispatch",
      sponsor: r.sponsor.room,
      reason: "wave" + ((entry?.waves ?? 0) + 1),
    });
  }
  return { decisions, ledgerUpdates };
}
