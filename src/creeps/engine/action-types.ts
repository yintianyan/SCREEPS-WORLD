/**
 * Action-Candidate 架构核心类型。
 *
 * 设计原则：
 *   - 每个 role 的行为被拆解为有序的 ActionCandidate 列表。
 *   - predicate 只读判断"能不能做"，execute 执行"怎么做"。
 *   - RoleRunner 按序评估，第一个 predicate=true 的候选被执行。
 *   - 新增/调整行为 = 增删/排序候选，不修改其他候选。
 */
import type { Budget, RoomSnapshot, TickContext } from "../../kernel/contracts";

/** 传递给每个 ActionCandidate 的只读决策上下文。 */
export interface ActionContext {
  readonly creep: Creep;
  readonly snapshot: RoomSnapshot;
  readonly assignment: CreepAssignment | undefined;
  readonly budget: Budget;
  readonly ctx: TickContext;
}

/**
 * 单个行为候选 — role 行为的最小可组合单元。
 *
 * predicate: 纯判断，不产生副作用。返回 true 表示此行为可执行。
 * execute:   执行行为（移动 + 操作）。仅在 predicate 通过后调用。
 */
export interface ActionCandidate {
  /** 调试标识（telemetry / 日志用）。 */
  readonly name: string;
  /** 判断当前上下文是否满足此行为的触发条件。 */
  predicate(ac: ActionContext): boolean;
  /** 执行行为。 */
  execute(ac: ActionContext): void;
}

/**
 * RolePolicy — 一个角色的完整行为策略。
 *
 * acquire: 取能阶段的候选列表（按优先级排序）。
 * work:    消耗阶段的候选列表（按优先级排序）。
 * gate:    可选的前置门禁 — 返回 false 时角色整体跳过（进入 idle）。
 */
export interface RolePolicy {
  /** 门禁：在 mode 分支之前评估。返回 false → idle。 */
  gate?(ac: ActionContext): boolean;
  /** acquire 模式候选（取能）。 */
  acquire: readonly ActionCandidate[];
  /** work 模式候选（消耗能量）。 */
  work: readonly ActionCandidate[];
  /**
   * idle 归位：无匹配候选（即将 idle）时，是否主动离开关键格/道路到安全格待命。
   * 站桩角色（harvester/upgrader）不设此项——它们的 idle 是守在矿位/controller 旁，本就正确。
   * 移动角色（hauler/distributor/builder/worker）设 true，避免 idle 时堵塞交通。
   */
  park?: boolean;
}
