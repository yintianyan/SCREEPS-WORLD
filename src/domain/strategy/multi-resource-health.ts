/**
 * Multi-Resource Empire Health — A4.2 多资源帝国健康度。
 *
 * 合同锚点：A4.2 Architecture Audit §10.22 NM-5 / §12.2 NM-5。
 *
 * 设计意图：
 *   将单资源健康度聚合为帝国级多资源健康度。
 *   核心规则：Energy HEALTHY + Mineral DEFICIT → Empire DEGRADED。
 *
 *   与现有 EmpireEconomicHealth（energy-only）的关系：
 *   - 现有 EmpireEconomicHealth 保持不变（向后兼容）
 *   - 新增 MultiResourceEmpireHealth 作为 A4.2 的上层视图
 *   - MultiResourceEmpireHealth 包含 energy 维度（映射自 EmpireEconomicHealth）
 *     和 mineral 维度（从 ResourceLedger 派生）
 *
 * 纯函数律（DEP_GRAPH §3-5）：不引用 Game / Memory / RawMemory。
 */

import type { ResourceType } from "../operation/agenda-item";
import type { ResourceLedger, ResourceLedgerEntry } from "../economy/resource-ledger";
import {
  evaluateResourceHealth,
  type ResourceHealthResult,
  type ResourceHealthStatus,
  type ResourceHealthOptions,
} from "../economy/resource-health";
import { isEnergy, isCriticalResource } from "../economy/resource-definition";

// ─── 矿物资源摘要 ───────────────────────────────────────────

/** 单矿物资源的帝国级摘要。 */
export interface MineralResourceSummary {
  /** 资源类型。 */
  resource: ResourceType;
  /** 帝国总储备量。 */
  totalReserve: number;
  /** 生产速率（单位/tick）。 */
  productionRate: number;
  /** 消费速率（单位/tick）。 */
  consumptionRate: number;
  /** 净速率。 */
  netRate: number;
  /** 健康度。 */
  health: ResourceHealthStatus;
  /** 缺口量。 */
  deficit: number;
}

// ─── 多资源帝国健康度 ───────────────────────────────────────

/**
 * 多资源帝国健康度结果。
 */
export interface MultiResourceEmpireHealth {
  /** 采样 tick。 */
  tick: number;
  /** 帝国整体健康度（取最差资源）。 */
  health: ResourceHealthStatus;
  /** 人类可读的证据链。 */
  evidence: string;
  /** Energy 维度健康度（映射自现有 EmpireEconomicHealth）。 */
  energyHealth: ResourceHealthStatus;
  /** 矿物维度健康度列表。 */
  mineralHealth: MineralResourceSummary[];
  /** 最差的矿物资源类型（null = 无矿物数据）。 */
  worstMineral: ResourceType | null;
  /** 最差矿物资源的健康度。 */
  worstMineralHealth: ResourceHealthStatus | null;
  /** 是否有矿物缺口。 */
  hasMineralDeficit: boolean;
  /** 瓶颈资源（限制帝国的资源，null = 无瓶颈）。 */
  bottleneck: ResourceType | null;
}

// ─── 评估函数 ──────────────────────────────────────────────

/**
 * 从帝国级 ResourceLedger 评估多资源帝国健康度。
 *
 * 纯函数 — 不访问 Game/Memory。
 *
 * @param tick 当前 tick
 * @param ledger 帝国级 ResourceLedger（聚合后）
 * @param energyHealth Energy 维度健康度（从现有 EmpireEconomicHealth 映射）
 * @param options 单资源健康度评估参数
 */
export function evaluateMultiResourceHealth(
  tick: number,
  ledger: ResourceLedger,
  energyHealth: ResourceHealthStatus,
  options: ResourceHealthOptions = undefined as never,
): MultiResourceEmpireHealth {
  // 收集矿物资源健康度
  const mineralHealth: MineralResourceSummary[] = [];

  for (const [resource, entry] of ledger) {
    // 只处理矿物（energy 由 energyHealth 参数传入）
    if (isEnergy(resource)) continue;

    const result = evaluateResourceHealth(entry, 0, options);
    mineralHealth.push({
      resource,
      totalReserve: result.reserve,
      productionRate: result.productionRate ?? 0,
      consumptionRate: result.consumptionRate ?? 0,
      netRate: result.netRate,
      health: result.health,
      deficit: result.deficit,
    });
  }

  // 找到最差的矿物资源
  let worstMineral: ResourceType | null = null;
  let worstMineralHealth: ResourceHealthStatus | null = null;
  let worstRank = Infinity;

  for (const m of mineralHealth) {
    const rank = healthRank(m.health);
    if (rank < worstRank) {
      worstRank = rank;
      worstMineral = m.resource;
      worstMineralHealth = m.health;
    }
  }

  // 帝国整体健康度 = min(energyHealth, worstMineralHealth)
  const energyRank = healthRank(energyHealth);
  const overallRank = Math.min(energyRank, worstRank);
  const health = rankToHealth(overallRank);

  // 是否有矿物缺口
  const hasMineralDeficit = mineralHealth.some(
    m => m.health === "deficit" || m.health === "critical",
  );

  // 瓶颈资源：最差的非 energy 资源（如果比 energy 差）
  let bottleneck: ResourceType | null = null;
  if (worstMineral !== null && worstRank < energyRank) {
    bottleneck = worstMineral;
  } else if (energyHealth === "critical" || energyHealth === "deficit") {
    bottleneck = "energy";
  }

  // 证据链
  const parts: string[] = [];
  parts.push(`energy=${energyHealth}`);
  if (worstMineral !== null) {
    parts.push(`worstMineral=${worstMineral}:${worstMineralHealth}`);
  }
  if (hasMineralDeficit) {
    parts.push("hasMineralDeficit");
  }
  const evidence = parts.join(", ");

  return {
    tick,
    health,
    evidence,
    energyHealth,
    mineralHealth,
    worstMineral,
    worstMineralHealth,
    hasMineralDeficit,
    bottleneck,
  };
}

// ─── 内部工具 ────────────────────────────────────────────

/**
 * 健康度 → 排序权重（值越小越差）。内部函数。
 */
function healthRank(h: ResourceHealthStatus): number {
  switch (h) {
    case "critical": return 0;
    case "deficit": return 1;
    case "degraded": return 2;
    case "stable": return 3;
    case "healthy": return 4;
  }
}

/**
 * 排序权重 → 健康度。内部函数。
 */
function rankToHealth(rank: number): ResourceHealthStatus {
  if (rank <= 0) return "critical";
  if (rank <= 1) return "deficit";
  if (rank <= 2) return "degraded";
  if (rank <= 3) return "stable";
  return "healthy";
}
