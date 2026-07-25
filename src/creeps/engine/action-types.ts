/**
 * Action-Candidate 架构核心类型。
 *
 * 设计原则：
 *   - 每个 role 的行为被拆解为有序的 ActionCandidate 列表。
 *   - resolve 只读判断"能不能做"并返回目标，execute 执行"怎么做"。
 *   - RoleRunner 按序评估，第一个 resolve 非 undefined 的候选被执行。
 *   - 新增/调整行为 = 增删/排序候选，不修改其他候选。
 *
 * resolve 模式（推荐）：
 *   resolve 返回目标对象（或 undefined 表示不触发），execute 接收该目标。
 *   消除 predicate-execute 重复计算——目标只解析一次。
 *
 * predicate 模式（兼容）：
 *   仅返回 boolean，execute 不接收 target。适用于无昂贵目标计算的简单 action。
 *   至少定义 resolve 或 predicate 之一。
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
 * resolve: 纯判断 + 目标解析，不产生副作用。返回非 undefined 表示此行为可执行。
 *          存在时优先使用，跳过 predicate。消除 predicate-execute 重复计算。
 * predicate: 纯判断，不产生副作用。返回 true 表示此行为可执行。
 *            仅在 resolve 不存在时使用。
 * execute: 执行行为（移动 + 操作）。使用 resolve 模式时 target 为 resolve 返回值。
 */
export interface ActionCandidate {
  /** 调试标识（telemetry / 日志用）。 */
  readonly name: string;
  /** 解析目标。返回 undefined 表示此行为不触发。存在时优先于 predicate 使用。 */
  readonly resolve?: (ac: ActionContext) => unknown;
  /** 判断当前上下文是否满足此行为的触发条件。resolve 不存在时使用。 */
  readonly predicate?: (ac: ActionContext) => boolean;
  /** 执行行为。使用 resolve 模式时 target 为 resolve 返回值。 */
  execute(ac: ActionContext, target?: unknown): void;
}

/**
 * RolePolicy — 一个角色的完整行为策略。
 *
 * acquire: 取能阶段的候选列表（按优先级排序）。
 * work:    消耗阶段的候选列表（按优先级排序）。
 * gate:    可选的前置门禁 — 返回 false 时角色整体跳过（进入 idle）。
 * onFlee:  可选的 flee 钩子 — 威胁检测后、通用 flee 之前调用。
 *          返回 true 表示角色已自行处理（如防御圈内安全充能），跳过通用 flee 移动。
 *          返回 false 表示需要通用 flee 移动逻辑接管。
 * park:    无匹配候选（即将 idle）时，是否主动离开关键格/道路到安全格待命。
 *          站桩角色（harvester/upgrader）不设此项——它们的 idle 是守在矿位/controller 旁，本就正确。
 *          移动角色（hauler/distributor/builder/worker）设 true，避免 idle 时堵塞交通。
 */
export interface RolePolicy {
  /** 门禁：在 mode 分支之前评估。返回 false → idle。 */
  gate?(ac: ActionContext): boolean;
  /** acquire 模式候选（取能）。 */
  acquire: readonly ActionCandidate[];
  /** work 模式候选（消耗能量）。 */
  work: readonly ActionCandidate[];
  /**
   * flee 钩子：威胁检测后、通用 flee 移动之前调用。
   * 返回 true 表示角色已自行处理（如 hauler 在防御圈内安全充能），跳过通用 flee。
   * 返回 false 表示需要通用 flee 移动逻辑接管。
   *
   * 职责分离原则：此钩子让角色自行决定 flee 期间的"安全区行为"，
   * 而不是在引擎层（lifecycle.ts）硬编码角色判断。
   */
  onFlee?(ac: ActionContext): boolean;
  /**
   * idle 归位：无匹配候选（即将 idle）时，是否主动离开关键格/道路到安全格待命。
   * 站桩角色（harvester/upgrader）不设此项——它们的 idle 是守在矿位/controller 旁，本就正确。
   * 移动角色（hauler/distributor/builder/worker）设 true，避免 idle 时堵塞交通。
   */
  park?: boolean;
}
