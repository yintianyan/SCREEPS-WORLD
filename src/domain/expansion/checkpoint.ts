/**
 * Checkpoint System — A3.3 Phase 1：5 个检查点 + 失败恢复。
 *
 * 合同锚点：EXPANSION_ARCHITECTURE §3 执行闭环 +
 * A3.3 Task Spec Checkpoint 机制。
 *
 * 5 个 Checkpoint 对应全链路的关键里程碑：
 *   CP1: Claimed          — Controller 已 claim
 *   CP2: Spawn Active      — Spawn 已建成可孵化
 *   CP3: Energy Loop       — Harvest → Transport → Spawn 能量环路运转
 *   CP4: Basic Infra       — 基础设施完成（extensions, containers, roads）
 *   CP5: Economic Activation — 经济指标达标（净流为正）+ 帝国集成
 *
 * 每个 Checkpoint：
 *   - 有判定函数（纯函数）
 *   - 失败时可以回退到上一个 Checkpoint（而非从头开始）
 *   - 记录通过时间用于可观测性
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game/Memory/RawMemory。
 */

import type { ExecutionState } from "./execution-state";

/** Checkpoint ID。 */
export type CheckpointId =
  | "CP1_CLAIMED"
  | "CP2_SPAWN_ACTIVE"
  | "CP3_ENERGY_LOOP"
  | "CP4_BASIC_INFRA"
  | "CP5_ECONOMIC_ACTIVATION";

/** Checkpoint 状态。 */
export type CheckpointStatus = "PENDING" | "PASSED" | "FAILED";

/** 单个 Checkpoint 的完整记录。 */
export interface CheckpointRecord {
  /** Checkpoint ID。 */
  id: CheckpointId;
  /** 对应的 ExecutionState。 */
  requiredState: ExecutionState;
  /** 当前状态。 */
  status: CheckpointStatus;
  /** 通过 tick（如果已通过）。 */
  passedAtTick?: number;
  /** 失败原因。 */
  failReason?: string;
  /** 重试次数。 */
  retryCount: number;
  /** 最大重试次数。 */
  maxRetries: number;
  /** 人类可读描述。 */
  description: string;
}

/** Checkpoint 评估输入。 */
export interface CheckpointInput {
  /** Checkpoint ID。 */
  checkpointId: CheckpointId;
  /** Controller 是否已 claim。 */
  controllerClaimed: boolean;
  /** Spawn 是否已建成。 */
  spawnBuilt: boolean;
  /** Spawn 是否可孵化（有能量）。 */
  spawnCanSpawn: boolean;
  /** Harvester 是否在工作。 */
  harvesterActive: boolean;
  /** Transporter 是否在工作。 */
  transporterActive: boolean;
  /** Extensions 是否已建成。 */
  extensionsBuilt: boolean;
  /** Container 是否已建成。 */
  containerBuilt: boolean;
  /** 道路是否已铺设（关键路段）。 */
  roadsBuilt: boolean;
  /** 能量净流是否为正。 */
  netEnergyFlowPositive: boolean;
  /** 是否已集成到 Empire（出现在 owned rooms 列表中）。 */
  empireIntegrated: boolean;
  /** 当前 tick。 */
  tick: number;
  /** 已有重试次数。 */
  retryCount: number;
}

/** Checkpoint 评估结果。 */
export interface CheckpointResult {
  /** Checkpoint ID。 */
  id: CheckpointId;
  /** 是否通过。 */
  passed: boolean;
  /** 状态。 */
  status: CheckpointStatus;
  /** 证据链。 */
  evidence: string[];
  /** 失败原因（如果未通过）。 */
  failReason?: string;
  /** 是否应重试。 */
  shouldRetry: boolean;
  /** 回退到的 Checkpoint（如果失败）。 */
  fallbackTo?: CheckpointId;
}

/** Checkpoint 定义表。 */
const CHECKPOINT_DEFINITIONS: Record<CheckpointId, {
  description: string;
  requiredState: ExecutionState;
  maxRetries: number;
  fallbackTo?: CheckpointId;
}> = {
  CP1_CLAIMED: {
    description: "Controller claimed by our empire",
    requiredState: "CLAIMED",
    maxRetries: 1,
  },
  CP2_SPAWN_ACTIVE: {
    description: "Spawn built and capable of spawning creeps",
    requiredState: "BOOTSTRAPPING",
    maxRetries: 3,
    fallbackTo: "CP1_CLAIMED",
  },
  CP3_ENERGY_LOOP: {
    description: "Harvester → Transporter → Spawn energy loop active",
    requiredState: "ECONOMIC_STARTUP",
    maxRetries: 5,
    fallbackTo: "CP2_SPAWN_ACTIVE",
  },
  CP4_BASIC_INFRA: {
    description: "Basic infrastructure complete (extensions, container, roads)",
    requiredState: "ECONOMIC_STARTUP",
    maxRetries: 3,
    fallbackTo: "CP3_ENERGY_LOOP",
  },
  CP5_ECONOMIC_ACTIVATION: {
    description: "Net energy flow positive + integrated into empire",
    requiredState: "INTEGRATING",
    maxRetries: 3,
    fallbackTo: "CP4_BASIC_INFRA",
  },
};

/**
 * 评估单个 Checkpoint（纯函数）。
 */
export function evaluateCheckpoint(input: CheckpointInput): CheckpointResult {
  const def = CHECKPOINT_DEFINITIONS[input.checkpointId];
  const evidence: string[] = [];

  let passed = false;
  let failReason: string | undefined;

  switch (input.checkpointId) {
    case "CP1_CLAIMED": {
      passed = input.controllerClaimed;
      evidence.push(`controllerClaimed=${input.controllerClaimed}`);
      if (!passed) failReason = "controller not claimed";
      break;
    }

    case "CP2_SPAWN_ACTIVE": {
      passed = input.spawnBuilt && input.spawnCanSpawn;
      evidence.push(`spawnBuilt=${input.spawnBuilt} spawnCanSpawn=${input.spawnCanSpawn}`);
      if (!passed) {
        failReason = !input.spawnBuilt ? "spawn not built" : "spawn cannot spawn (no energy)";
      }
      break;
    }

    case "CP3_ENERGY_LOOP": {
      passed = input.harvesterActive && input.transporterActive && input.spawnCanSpawn;
      evidence.push(`harvesterActive=${input.harvesterActive} transporterActive=${input.transporterActive} spawnCanSpawn=${input.spawnCanSpawn}`);
      if (!passed) {
        const missing: string[] = [];
        if (!input.harvesterActive) missing.push("harvester");
        if (!input.transporterActive) missing.push("transporter");
        if (!input.spawnCanSpawn) missing.push("spawn energy");
        failReason = `energy loop incomplete: missing ${missing.join(", ")}`;
      }
      break;
    }

    case "CP4_BASIC_INFRA": {
      passed = input.extensionsBuilt && input.containerBuilt;
      evidence.push(`extensionsBuilt=${input.extensionsBuilt} containerBuilt=${input.containerBuilt} roadsBuilt=${input.roadsBuilt}`);
      if (!passed) {
        const missing: string[] = [];
        if (!input.extensionsBuilt) missing.push("extensions");
        if (!input.containerBuilt) missing.push("container");
        failReason = `basic infra incomplete: missing ${missing.join(", ")}`;
      }
      break;
    }

    case "CP5_ECONOMIC_ACTIVATION": {
      passed = input.netEnergyFlowPositive && input.empireIntegrated;
      evidence.push(`netEnergyFlowPositive=${input.netEnergyFlowPositive} empireIntegrated=${input.empireIntegrated}`);
      if (!passed) {
        const missing: string[] = [];
        if (!input.netEnergyFlowPositive) missing.push("net energy flow not positive");
        if (!input.empireIntegrated) missing.push("not integrated into empire");
        failReason = `economic activation incomplete: ${missing.join(", ")}`;
      }
      break;
    }

    default:
      failReason = `unknown checkpoint: ${input.checkpointId}`;
      evidence.push(`unknown checkpoint ${input.checkpointId}`);
  }

  const shouldRetry = !passed && input.retryCount < def.maxRetries;
  const status: CheckpointStatus = passed ? "PASSED" : (shouldRetry ? "PENDING" : "FAILED");

  return {
    id: input.checkpointId,
    passed,
    status,
    evidence,
    failReason,
    shouldRetry,
    fallbackTo: !passed && !shouldRetry ? def.fallbackTo : undefined,
  };
}

/**
 * 获取 Checkpoint 的默认记录（用于初始化）。
 */
export function createCheckpointRecord(id: CheckpointId): CheckpointRecord {
  const def = CHECKPOINT_DEFINITIONS[id];
  return {
    id,
    requiredState: def.requiredState,
    status: "PENDING",
    retryCount: 0,
    maxRetries: def.maxRetries,
    description: def.description,
  };
}

/**
 * 获取所有 5 个 Checkpoint 的默认记录。
 */
export function createAllCheckpointRecords(): CheckpointRecord[] {
  return [
    createCheckpointRecord("CP1_CLAIMED"),
    createCheckpointRecord("CP2_SPAWN_ACTIVE"),
    createCheckpointRecord("CP3_ENERGY_LOOP"),
    createCheckpointRecord("CP4_BASIC_INFRA"),
    createCheckpointRecord("CP5_ECONOMIC_ACTIVATION"),
  ];
}

/**
 * 获取 Checkpoint 的进度。
 */
export function getCheckpointProgress(passedCount: number): number {
  return (passedCount / 5) * 100;
}

/**
 * 获取下一个未通过的 Checkpoint。
 */
export function getNextPendingCheckpoint(records: CheckpointRecord[]): CheckpointRecord | undefined {
  return records.find(r => r.status === "PENDING" || r.status === "FAILED");
}

/**
 * 获取已通过的 Checkpoint 数量。
 */
export function getPassedCount(records: CheckpointRecord[]): number {
  return records.filter(r => r.status === "PASSED").length;
}
