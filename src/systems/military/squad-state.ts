/**
 * Squad 级战术状态的归属模块（B6-㉔ / A9）— 唯一读写口。
 *
 * 修前的样子：`tactical-runtime-system` / `tactical-engagement-runtime` /
 * `squad-movement-runtime` 各有一份 `deriveTacticalStateFromPhase(plan.phase)`，
 * 每 tick 从 **warPlan 的波次相位**（build/advance）现推战术状态。两件事不是一回事：
 * phase 说"这一波在集结还是推进"，TacticalState 说"这支编队此刻在交战还是撤退"。
 * 于是 `evaluateTacticalAction` 的 `currentState` 只可能是 FORMING / MOVING，
 * 而转换表里 FORMING 只允许 →MOVING/ABORTED/COMPLETED —— 结果 STALE 情报的
 * REGROUPING 闸、敌方能力暴涨的 RETREATING 闸、healer 全灭与低血量的 DISENGAGING 闸
 * **四道安全闸在集结期恒判非法**，整条"看不见就停手 / 被打残就撤"的链一次也不触发
 * （注释里那句"存储 decision 的 newState 供下轮评估"也从没真的存过）。
 *
 * 现在的归属：状态存在 `Memory.kernel.tacticalSquadStates`，键里带 `warPlan.since` ——
 * 同一支编队在一轮行动内连续演进，换了一轮行动（含换目标）从头开始，
 * 不会把上一支编队撤退时的状态继承给新仗。
 */
import { CONFIG } from "../../config";
import { ALL_TACTICAL_STATES, canTransitionTactical } from "../../domain/tactical/state-machine";
import type { TacticalState } from "../../domain/tactical/types";

/** 一把状态钥匙所需的 warPlan 字段（不依赖整个 plan 对象）。 */
export interface SquadStateOwner {
  sponsor: string;
  targetRoom: string;
  since: number;
}

export function squadStateKey(owner: SquadStateOwner): string {
  return `squad-${owner.sponsor}-${owner.targetRoom}@${owner.since}`;
}

/** 读当前战术状态；无记录 = 本轮行动还没跑过决策 → 从集结开始。 */
export function readSquadState(key: string): TacticalState {
  const stored = Memory.kernel?.tacticalSquadStates?.[key];
  if (!stored) return "FORMING";
  // 代码回滚可能留下不认识的状态词：宁可从 FORMING 重来，也不把未知值喂给消费方。
  return (ALL_TACTICAL_STATES as readonly string[]).includes(stored.state)
    ? (stored.state as TacticalState)
    : "FORMING";
}

/**
 * 提交决策产出的新状态。只有两种写法被接受：
 * - 合法转换（转换表是唯一裁判）；
 * - 自持（to === from，即"这一轮维持现状" —— 表里没有自环，而维持不是转换）。
 * 非法转换一律不写：调用方的闸若判了非法，状态就留在原地，而不是被下游更激进的
 * 分支顺手改写成 ENGAGING（这正是 A9 的另一半）。
 */
export function commitSquadState(
  key: string,
  from: TacticalState,
  to: TacticalState,
  tick: number,
): boolean {
  if (!Memory.kernel) Memory.kernel = {};
  const table = (Memory.kernel.tacticalSquadStates ??= {});
  if (to === from) {
    const entry = table[key];
    if (entry) entry.updatedAt = tick;
    else table[key] = { state: to, since: tick, updatedAt: tick };
    return true;
  }
  if (!canTransitionTactical(from, to)) return false;
  table[key] = { state: to, since: tick, updatedAt: tick };
  return true;
}

/**
 * 淘汰不再被读取的行动条目。
 * 键里带 `since`，换目标/重新立项就会换新键，旧键再没人读 —— 按"多久没被更新"清，
 * 上限取 planTimeout（一轮行动的最长寿命），保证不会误删在打的仗。
 */
export function pruneSquadStates(tick: number): void {
  const table = Memory.kernel?.tacticalSquadStates;
  if (!table) return;
  const horizon = CONFIG.war.planTimeout;
  for (const key in table) {
    const entry = table[key];
    if (entry && tick - entry.updatedAt > horizon) delete table[key];
  }
}

/** 仅供测试与观测：当前记账条数（有界性检查）。 */
export function squadStateCount(): number {
  return Object.keys(Memory.kernel?.tacticalSquadStates ?? {}).length;
}
