/**
 * Action-Candidate 架构核心类型。
 *
 * 设计原则：
 *   - 每个 role 的行为被拆解为有序的 ActionCandidate 列表。
 *   - resolve 解析目标（返回 undefined 表示不触发），execute 接收该目标执行。
 *   - RoleRunner 按序评估，第一个 resolve 非 undefined 的候选被执行。
 *   - 新增/调整行为 = 增删/排序候选，不修改其他候选。
 *
 * resolve 模式（唯一模式）：
 *   resolve 返回目标对象（T | undefined），execute 接收类型安全的 T。
 *   消除了 predicate-execute 重复计算——目标只解析一次。
 *
 * 注意：resolve 允许写入 creep.memory（持久化缓存目标 ID），
 * 这是有意为之的务实设计——Screeps 的 memory 持久化是必须的。
 * 但 resolve 禁止执行游戏 API 副作用（harvest/transfer/build 等）。
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
 * 泛型参数 T 表示 resolve 返回的目标类型，execute 接收同类型的 target。
 * 工厂函数声明具体类型（如 ActionCandidate<StructureContainer>），
 * 消除 execute 内的 `as Type` 无检查转换。
 * RolePolicy 的候选列表使用 ActionCandidate<any>[] 保持异构性。
 *
 * resolve: 解析目标 + 可选 memory 缓存。返回 undefined 表示此行为不触发。
 *          允许写 creep.memory（持久化缓存），但禁止执行游戏 API 副作用。
 * execute: 执行行为（移动 + 操作）。target 类型安全，由泛型参数 T 保证。
 */
export interface ActionCandidate<T = unknown> {
  /** 调试标识（telemetry / 日志用）。 */
  readonly name: string;
  /** 解析目标。返回 undefined 表示此行为不触发。
   * EN-3：必填 — 可选时「无 resolve 的候选」永远返回 undefined、
   * 静默死亡（编译期零防护的契约陷阱）。resolve 是唯一放行闸门（EN-1）。 */
  readonly resolve: (ac: ActionContext) => T | undefined;
  /** 执行行为。target 为 resolve 返回值，类型由泛型 T 保证。 */
  execute(ac: ActionContext, target: T): void;
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
  /** acquire 模式候选（取能）。异构列表，使用 any 宽化。 */
  acquire: readonly ActionCandidate<any>[];
  /** work 模式候选（消耗能量）。异构列表，使用 any 宽化。 */
  work: readonly ActionCandidate<any>[];
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
  /**
   * 战斗角色标志：true 时 role-runner 跳过威胁逃跑检测（shouldFlee/shouldFleeForeignRoom）。
   * 战斗角色的职责就是接敌 — 若不豁免，defender 看到敌人会立刻逃回 home，
   * 攻击候选永远轮不到执行，角色形同虚设。
   */
  combat?: boolean;
  /**
   * Recovery 豁免自报（R3a）：与 kernel/contracts.ts CreepRole.recoveryEligible
   * 对应，由 defineRole 透传到注册角色。recovery 时仍执行（P1 等效预算）。
   */
  recoveryEligible?: boolean;
  /**
   * 无候选时是否切 idle 的额外条件（P2-M）。
   *
   * role-runner 默认 idle 逻辑：本地角色（无 remoteTarget）或到达 remoteTarget 房时切 idle；
   * 通勤中（有 remoteTarget 但不在目标房）保持原 mode，避免 idle→ensureHome→home 振荡。
   *
   * 此钩子让角色声明"前两个通用条件未命中时，是否仍切 idle"的特例。
   * 典型用例：remoteHauler work 模式在 home 房无候选时切 idle（ensureHome 保持在家），
   * 但 acquire 模式在 home 房不切 idle（ensureHome 导航去 remoteTarget）。
   *
   * 返回 true → 切 idle；返回 false/undefined → 走默认逻辑（不切 idle）。
   */
  shouldIdleWhenNoCandidate?(ac: ActionContext): boolean;
}
