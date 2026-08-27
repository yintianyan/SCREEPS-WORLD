/** Action-Candidate 架构核心类型：角色行为拆解为有序 ActionCandidate 列表， */
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
 * 泛型 T 保证 execute 收到与 resolve 同类型的 target，消除 execute 内 `as Type` 无检查转换；
 * RolePolicy 候选列表用 ActionCandidate<any>[] 保持异构。
 */
export interface ActionCandidate<T = unknown> {
  /** 调试标识（telemetry / 日志用）。 */
  readonly name: string;
  /** 解析目标。返回 undefined 表示此行为不触发。
   * EN-3：必填 — 可选时「无 resolve 的候选」永远返回 undefined、静默死亡（EN-1 唯一放行闸门）。 */
  readonly resolve: (ac: ActionContext) => T | undefined;
  /** 执行行为。target 为 resolve 返回值，类型由泛型 T 保证。 */
  execute(ac: ActionContext, target: T): void;
}

/**
 * RolePolicy — 一个角色的完整行为策略（声明式钩子集合），由 engine/role-runner 统一驱动。
 * 各钩子的语义边界见下方字段注释。
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
   * 返回 true=角色已自行处理（如 hauler 防御圈内安全充能），false=需要通用 flee 接管。
   * 职责分离（P0-2）：flee 期间的安全区行为由角色层决定，不在引擎层硬编码角色判断。
   */
  onFlee?(ac: ActionContext): boolean;
  /** idle 归位：无匹配候选（即将 idle）时是否主动离开关键格/道路到安全格待命。
   * 站桩角色（harvester/upgrader）不设——idle 守在矿位/controller 旁本就正确；
   * 移动角色（hauler/distributor/builder/worker）设 true，避免 idle 时堵塞交通。 */
  park?: boolean;
  /** 战斗角色标志：跳过威胁逃跑检测（shouldFlee/shouldFleeForeignRoom）。
   * 否则 defender 看到敌人会立刻逃回 home，攻击候选永远轮不到执行，角色形同虚设。 */
  combat?: boolean;
  /**
   * 侦察兵标志（recon push-through）：跳过过境房威胁逃跑检测（shouldFleeForeignRoom），
   * 即使钻进敌方房也继续向侦察目标推进，而非 abandon 任务逃回 home。recon scout 是一次性
   * 便宜单位（[MOVE]，50 能量），遇敌 flee 会永远到不了 remoteTarget → recon 永不完成 →
   * 占领链卡死（W38S57 紧贴 Aguia 的 W38S58 时实测）。配合 moveTowardRoom 的
   * avoidRooms（绕开已知 hostile 房）使用，scout 正常走安全路径、仅在路径被封时才 push through。
   */
  pushThrough?: boolean;
  /** Recovery 豁免自报（R3a）：透传到 CreepRole.recoveryEligible，recovery 时仍执行（P1 等效预算）。 */
  recoveryEligible?: boolean;
  /**
   * 无候选时是否切 idle 的额外条件（P2-M）。
   * 默认：本地角色（无 remoteTarget）或到达 remoteTarget 房时切 idle；通勤中保持原 mode
   * （避免 idle→ensureHome→home 振荡）。此钩子声明"前两个通用条件未命中时是否仍切 idle"的特例
   * （如 remoteHauler work 在 home 房切 idle，acquire 不切）。
   * 返回 true → 切 idle；返回 false/undefined → 走默认逻辑。
   */
  shouldIdleWhenNoCandidate?(ac: ActionContext): boolean;
  /**
   * 战备集结（R4）：威胁检测之后、ensureHome 导航之前调用；返回 true 表示接管本 tick，
   * 跳过导航与任务管线直接结束。必须在导航之前执行：否则集结中的角色会被 ensureHome
   * 直接导航进目标房（attacker 在 war build 阶段的「添油战术」正是此路径）。
   * 典型用例：attacker 在 warPlan.phase === "build" 时归建待命，满编（advance）才整波推进。
   */
  hold?(creep: Creep, ctx: TickContext): boolean;
}
