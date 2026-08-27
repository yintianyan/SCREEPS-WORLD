/** Execution State Machine */

import type { ExpansionPlan } from "./plan";

/** 执行状态。 */
export type ExecutionState =
  | "VALIDATING"         // 执行 Gate 验证中
  | "PREPARING"          // 预留资源 + 准备 Claimer
  | "CLAIMING"           // Claimer 出发 + claimController
  | "CLAIMED"            // Claim 成功，controller 已拥有
  | "BOOTSTRAPPING"      // Pioneer 到达 + 基础设施建设
  | "ECONOMIC_STARTUP"  // 能量环路建立（harvest + transport + spawn）
  | "INTEGRATING"        // 经济激活 → 帝国集成
  | "COMPLETED"         // 自主运行
  | "FAILED"            // 执行失败
  | "ABORTED"           // 主动终止
  | "REPLANNING";       // 需要重新规划

/** 状态转换结果。 */
export interface StateTransitionResult {
  /** 新状态。 */
  newState: ExecutionState;
  /** 是否发生了转换。 */
  transitioned: boolean;
  /** 转换原因。 */
  reason: string;
  /** 附带数据（如 checkpoint 结果）。 */
  metadata?: Record<string, unknown>;
}

/** 状态转换输入。 */
export interface StateTransitionInput {
  /** 当前状态。 */
  currentState: ExecutionState;
  /** 关联的 Plan。 */
  plan: ExpansionPlan;
  /** Gate 验证结果（VALIDATING 状态使用）。 */
  gatePassed?: boolean;
  /** 资源是否已预留。 */
  resourcesReserved?: boolean;
  /** Claimer 是否已创建。 */
  claimerCreated?: boolean;
  /** Controller 是否已 claim。 */
  controllerClaimed?: boolean;
  /** Pioneer 是否已到达。 */
  pioneerArrived?: boolean;
  /** Spawn 是否已建成。 */
  spawnBuilt?: boolean;
  /** 能量环路是否已建立。 */
  energyLoopActive?: boolean;
  /** 基础设施是否完成。 */
  basicInfraComplete?: boolean;
  /** 经济是否已激活。 */
  economicallyActivated?: boolean;
  /** 是否已集成到 Empire。 */
  empireIntegrated?: boolean;
  /** 失败原因。 */
  failureReason?: string;
  /** 当前 tick。 */
  tick: number;
}

/** 合法状态转换表。 */
const TRANSITION_TABLE: Record<ExecutionState, ExecutionState[]> = {
  VALIDATING: ["PREPARING", "FAILED"],
  PREPARING: ["CLAIMING", "FAILED", "ABORTED"],
  CLAIMING: ["CLAIMED", "FAILED", "ABORTED"],
  CLAIMED: ["BOOTSTRAPPING", "FAILED", "ABORTED"],
  BOOTSTRAPPING: ["ECONOMIC_STARTUP", "FAILED", "ABORTED", "REPLANNING"],
  ECONOMIC_STARTUP: ["INTEGRATING", "FAILED", "ABORTED", "REPLANNING"],
  INTEGRATING: ["COMPLETED", "FAILED", "ABORTED"],
  COMPLETED: [],
  FAILED: ["REPLANNING", "ABORTED"],
  ABORTED: [],
  REPLANNING: ["VALIDATING"],
};

/**
 * 状态机转换函数（纯函数）。

 * 根据当前状态和输入条件，决定是否转换到下一个状态。
 */
export function transitionExecutionState(input: StateTransitionInput): StateTransitionResult {
  const { currentState, tick } = input;

  switch (currentState) {
    // ── VALIDATING → PREPARING / FAILED ──
    case "VALIDATING": {
      if (input.gatePassed === true) {
        return { newState: "PREPARING", transitioned: true, reason: "execution gate passed" };
      }
      if (input.gatePassed === false) {
        return { newState: "FAILED", transitioned: true, reason: "execution gate failed" };
      }
      return { newState: "VALIDATING", transitioned: false, reason: "gate validation in progress" };
    }

    // ── PREPARING → CLAIMING / FAILED ──
    case "PREPARING": {
      if (input.resourcesReserved && input.claimerCreated) {
        return { newState: "CLAIMING", transitioned: true, reason: "resources reserved + claimer created" };
      }
      if (input.failureReason) {
        return { newState: "FAILED", transitioned: true, reason: input.failureReason };
      }
      return { newState: "PREPARING", transitioned: false, reason: "preparing resources" };
    }

    // ── CLAIMING → CLAIMED / FAILED ──
    case "CLAIMING": {
      if (input.controllerClaimed) {
        return { newState: "CLAIMED", transitioned: true, reason: "controller claimed" };
      }
      if (input.failureReason) {
        return { newState: "FAILED", transitioned: true, reason: input.failureReason };
      }
      return { newState: "CLAIMING", transitioned: false, reason: "claimer en route" };
    }

    // ── CLAIMED → BOOTSTRAPPING / FAILED ──
    case "CLAIMED": {
      // Checkpoint 1: Claimed
      return {
        newState: "BOOTSTRAPPING",
        transitioned: true,
        reason: "checkpoint[Claimed] passed → bootstrapping",
        metadata: { checkpoint: "Claimed", passedAt: tick },
      };
    }

    // ── BOOTSTRAPPING → ECONOMIC_STARTUP / FAILED ──
    case "BOOTSTRAPPING": {
      // Checkpoint 2: Spawn Active + Pioneer Arrived
      if (input.spawnBuilt && input.pioneerArrived) {
        return {
          newState: "ECONOMIC_STARTUP",
          transitioned: true,
          reason: "checkpoint[SpawnActive] passed → economic startup",
          metadata: { checkpoint: "SpawnActive", passedAt: tick },
        };
      }
      if (input.failureReason) {
        return { newState: "FAILED", transitioned: true, reason: input.failureReason };
      }
      return { newState: "BOOTSTRAPPING", transitioned: false, reason: "building spawn + pioneer en route" };
    }

    // ── ECONOMIC_STARTUP → INTEGRATING / FAILED ──
    case "ECONOMIC_STARTUP": {
      // Checkpoint 3: Energy Loop + Checkpoint 4: Basic Infra
      if (input.energyLoopActive && input.basicInfraComplete) {
        return {
          newState: "INTEGRATING",
          transitioned: true,
          reason: "checkpoint[EnergyLoop + BasicInfra] passed → integrating",
          metadata: { checkpoint: "EnergyLoop", passedAt: tick },
        };
      }
      if (input.failureReason) {
        return { newState: "FAILED", transitioned: true, reason: input.failureReason };
      }
      return { newState: "ECONOMIC_STARTUP", transitioned: false, reason: "establishing energy loop" };
    }

    // ── INTEGRATING → COMPLETED / FAILED ──
    case "INTEGRATING": {
      // Checkpoint 5: Economic Activation + Empire Integration
      if (input.economicallyActivated && input.empireIntegrated) {
        return {
          newState: "COMPLETED",
          transitioned: true,
          reason: "checkpoint[EconomicActivation + EmpireIntegration] passed → autonomous",
          metadata: { checkpoint: "EconomicActivation", passedAt: tick },
        };
      }
      if (input.failureReason) {
        return { newState: "FAILED", transitioned: true, reason: input.failureReason };
      }
      return { newState: "INTEGRATING", transitioned: false, reason: "economic activation + empire integration" };
    }

    // ── COMPLETED: 终态 ──
    case "COMPLETED": {
      return { newState: "COMPLETED", transitioned: false, reason: "already completed" };
    }

    // ── FAILED → REPLANNING / ABORTED ──
    case "FAILED": {
      if (input.failureReason === "abort") {
        return { newState: "ABORTED", transitioned: true, reason: "manual abort" };
      }
      return { newState: "REPLANNING", transitioned: true, reason: "failure → replan" };
    }

    // ── ABORTED: 终态 ──
    case "ABORTED": {
      return { newState: "ABORTED", transitioned: false, reason: "aborted (terminal)" };
    }

    // ── REPLANNING → VALIDATING ──
    case "REPLANNING": {
      return { newState: "VALIDATING", transitioned: true, reason: "replan complete → revalidate" };
    }

    default: {
      return { newState: currentState, transitioned: false, reason: "unknown state" };
    }
  }
}

/**
 * 检查状态转换是否合法。
 */
export function isValidTransition(from: ExecutionState, to: ExecutionState): boolean {
  const allowed = TRANSITION_TABLE[from];
  return allowed?.includes(to) ?? false;
}

/**
 * 获取状态的进度百分比（用于 Dashboard）。
 */
export function getExecutionProgress(state: ExecutionState): number {
  const PROGRESS: Record<ExecutionState, number> = {
    VALIDATING: 0,
    PREPARING: 10,
    CLAIMING: 20,
    CLAIMED: 30,
    BOOTSTRAPPING: 45,
    ECONOMIC_STARTUP: 65,
    INTEGRATING: 85,
    COMPLETED: 100,
    FAILED: 0,
    ABORTED: 0,
    REPLANNING: 0,
  };
  return PROGRESS[state] ?? 0;
}

/**
 * 获取状态的简短描述。
 */
export function describeExecutionState(state: ExecutionState): string {
  const DESCRIPTIONS: Record<ExecutionState, string> = {
    VALIDATING: "Validating execution gate (TOCTOU)",
    PREPARING: "Reserving resources + spawning claimer",
    CLAIMING: "Claimer en route to claim controller",
    CLAIMED: "Controller claimed, preparing pioneer dispatch",
    BOOTSTRAPPING: "Pioneer building spawn + infrastructure",
    ECONOMIC_STARTUP: "Establishing harvest → transport → spawn energy loop",
    INTEGRATING: "Economic activation + empire integration",
    COMPLETED: "Autonomous room — expansion complete",
    FAILED: "Execution failed",
    ABORTED: "Aborted (manual or catastrophic)",
    REPLANNING: "Replanning after failure",
  };
  return DESCRIPTIONS[state] ?? state;
}
