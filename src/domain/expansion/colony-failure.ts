/**
 * Colony Failure Detection — A3.4：新 Colony 经济失败检测。
 *
 * 合同锚点：A3.4 Task Spec §19 Colony Failure Detection + §20 No Re-bootstrap。
 *
 * 检测 Colony 是否进入经济衰退，触发 Normal Room Recovery（不是重新 Bootstrap）。
 *
 * 失败类型：
 *   1. Energy Deficit — 净流持续为负
 *   2. Population Collapse — 人口急剧下降
 *   3. Spawn Starvation — spawn 长期无能量
 *   4. Construction Block — 关键建造长期停滞
 *   5. Logistics Failure — 物流中断
 *   6. Defense Failure — 防御失败（已失守不算 Colony 失败，是 Room Lost）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

/** 失败类型枚举。 */
export type FailureType =
  | "energy_deficit"
  | "population_collapse"
  | "spawn_starvation"
  | "construction_block"
  | "logistics_failure"
  | "defense_failure";

/** Colony Failure 输入。 */
export interface ColonyFailureInput {
  // ── Energy ──
  /** 能量净流。 */
  netEnergyFlow: number;
  /** 连续净流为负的 tick 数。 */
  consecutiveNegativeTicks: number;
  /** Storage 能量（无 storage 为 0）。 */
  storageEnergy: number;
  /** Storage 水位比例（0..1）。 */
  storageRatio: number;

  // ── Population ──
  /** 当前人口。 */
  currentPopulation: number;
  /** 目标人口。 */
  targetPopulation: number;
  /** 连续人口不足的 tick 数。 */
  understaffedTicks: number;

  // ── Spawn ──
  /** spawn 饥饿次数（最近窗口）。 */
  spawnStarvationCount: number;
  /** 是否有 spawn。 */
  hasSpawn: boolean;

  // ── Construction ──
  /** 阻塞的 critical construction site 数。 */
  blockedCriticalSites: number;
  /** 建造停滞的连续 tick 数。 */
  constructionStallTicks: number;

  // ── Logistics ──
  /** 是否有活跃 hauler/distributor。 */
  hasLogisticsCreep: boolean;
  /** 连续无物流 creep 的 tick 数。 */
  logisticsGapTicks: number;

  // ── General ──
  /** 当前 tick。 */
  tick: number;
  /** Colony 是否已 COMPLETED（Economic Activation 通过）。 */
  colonyCompleted: boolean;
}

/** Colony Failure 结果。 */
export interface ColonyFailureResult {
  /** 是否检测到失败。 */
  detected: boolean;
  /** 失败类型列表。 */
  failureTypes: FailureType[];
  /** 严重度（0..1）。 */
  severity: number;
  /** 推荐恢复动作。 */
  recommendedAction: string;
  /** 是否允许重新 Bootstrap（仅 Room Lost 时）。 */
  allowRebootstrap: boolean;
  /** 人类可读证据。 */
  evidence: string;
}

/** 连续负流阈值。 */
const ENERGY_DEFICIT_TICKS = 200;
/** 人口不足阈值。 */
const POPULATION_UNDERSTAFFED_TICKS = 500;
/** spawn 饥饿阈值。 */
const SPAWN_STARVATION_THRESHOLD = 10;
/** 建造停滞阈值。 */
const CONSTRUCTION_STALL_TICKS = 1000;
/** 物流中断阈值。 */
const LOGISTICS_GAP_TICKS = 300;

/**
 * 评估 Colony 失败状态（纯函数）。
 *
 * 检测多种失败模式，推荐 Normal Room Recovery 而非重新 Bootstrap。
 * 重新 Bootstrap 仅在 Room Lost（controller 丢失）时允许——
 * 这由 expansion-manager 的失守检查处理，不在本模块。
 */
export function evaluateColonyFailure(input: ColonyFailureInput): ColonyFailureResult {
  const failures: FailureType[] = [];
  let maxSeverity = 0;

  // ── 1. Energy Deficit ──
  if (input.consecutiveNegativeTicks >= ENERGY_DEFICIT_TICKS && input.storageRatio < 0.1) {
    failures.push("energy_deficit");
    maxSeverity = Math.max(maxSeverity, 0.8);
  } else if (input.netEnergyFlow < 0 && input.consecutiveNegativeTicks > 50) {
    failures.push("energy_deficit");
    maxSeverity = Math.max(maxSeverity, 0.4);
  }

  // ── 2. Population Collapse ──
  if (input.targetPopulation > 0) {
    const popRatio = input.currentPopulation / input.targetPopulation;
    if (popRatio < 0.3 && input.understaffedTicks >= POPULATION_UNDERSTAFFED_TICKS) {
      failures.push("population_collapse");
      maxSeverity = Math.max(maxSeverity, 0.7);
    } else if (popRatio < 0.5 && input.understaffedTicks > 100) {
      failures.push("population_collapse");
      maxSeverity = Math.max(maxSeverity, 0.3);
    }
  }

  // ── 3. Spawn Starvation ──
  if (input.hasSpawn && input.spawnStarvationCount >= SPAWN_STARVATION_THRESHOLD) {
    failures.push("spawn_starvation");
    maxSeverity = Math.max(maxSeverity, 0.6);
  }

  // ── 4. Construction Block ──
  if (input.blockedCriticalSites > 0 && input.constructionStallTicks >= CONSTRUCTION_STALL_TICKS) {
    failures.push("construction_block");
    maxSeverity = Math.max(maxSeverity, 0.4);
  }

  // ── 5. Logistics Failure ──
  if (!input.hasLogisticsCreep && input.logisticsGapTicks >= LOGISTICS_GAP_TICKS) {
    failures.push("logistics_failure");
    maxSeverity = Math.max(maxSeverity, 0.5);
  }

  // ── 推荐恢复动作 ──
  const detected = failures.length > 0;
  let recommendedAction = "none";
  if (detected) {
    if (failures.includes("energy_deficit")) {
      recommendedAction = "demand_adjustment + logistics_supply";
    } else if (failures.includes("population_collapse")) {
      recommendedAction = "spawn_adjustment + population_recovery";
    } else if (failures.includes("spawn_starvation")) {
      recommendedAction = "spawn_priority_boost + energy_redirect";
    } else if (failures.includes("construction_block")) {
      recommendedAction = "construction_site_cleanup + builder_redirect";
    } else if (failures.includes("logistics_failure")) {
      recommendedAction = "logistics_creep_replacement";
    } else if (failures.includes("defense_failure")) {
      recommendedAction = "defense_recovery";
    }
  }

  // ── Re-bootstrap 禁止 ──
  // A3.4 §20: Colony 出现 Energy Deficit 禁止重新 Bootstrap。
  // 只有 Room Lost（controller 丢失）才允许——这不在本模块检测范围。
  const allowRebootstrap = false;

  const evidence = [
    `ColonyFailure @${input.tick}`,
    `detected=${detected}`,
    `types=${failures.join(",") || "none"}`,
    `severity=${maxSeverity.toFixed(2)}`,
    `action=${recommendedAction}`,
    `rebootstrap=${allowRebootstrap}`,
  ].join(" | ");

  return {
    detected,
    failureTypes: failures,
    severity: maxSeverity,
    recommendedAction,
    allowRebootstrap,
    evidence,
  };
}

/**
 * Normal Room Recovery 建议（纯函数）。
 *
 * 根据 Colony Failure 类型推荐具体的恢复路径，
 * 所有路径都走 Normal Room Runtime（不重新 Bootstrap）。
 */
export function getRecoveryAction(failureType: FailureType): string {
  switch (failureType) {
    case "energy_deficit":
      return "demand_adjustment + logistics_supply";
    case "population_collapse":
      return "spawn_adjustment + population_recovery";
    case "spawn_starvation":
      return "spawn_priority_boost + energy_redirect";
    case "construction_block":
      return "construction_site_cleanup + builder_redirect";
    case "logistics_failure":
      return "logistics_creep_replacement";
    case "defense_failure":
      return "defense_recovery";
    default:
      return "none";
  }
}
