/**
 * Formation Model — A5.4.0 纯函数。
 *
 * 阵型语义定义和选择条件。
 * 本阶段只定义语义和转换条件，不实现复杂 movement 算法。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / 任何 Runtime。
 */

import type {
  FormationType,
  TacticalSnapshot,
  TacticalState,
} from "./types";
import type { TerrainContext } from "../defense/terrain-context";

// ═══════════════════════════════════════════════════════════
// §1. 阵型语义
// ═══════════════════════════════════════════════════════════

/** 阵型语义描述。 */
export interface FormationSemantics {
  /** 阵型类型。 */
  readonly type: FormationType;
  /** 适用场景。 */
  readonly useCase: string;
  /** 优势。 */
  readonly strengths: readonly string[];
  /** 劣势。 */
  readonly weaknesses: readonly string[];
  /** 推荐地形。 */
  readonly preferredTerrain: readonly string[];
}

/** 全部阵型的语义定义。 */
export const FORMATION_SEMANTICS: Record<FormationType, FormationSemantics> = {
  LINE: {
    type: "LINE",
    useCase: "正面展开，最大化火力输出",
    strengths: ["maximizes frontal firepower", "even spacing reduces AoE vulnerability"],
    weaknesses: ["flank exposure", "requires open terrain"],
    preferredTerrain: ["OPEN", "OPEN_FIELD", "FORTIFIED"],
  },
  WEDGE: {
    type: "WEDGE",
    useCase: "突击阵型，集中火力突破一点",
    strengths: ["concentrated breakthrough", "healer can trail behind wedge tip"],
    weaknesses: ["tip takes maximum damage", "narrow front"],
    preferredTerrain: ["OPEN", "OPEN_FIELD"],
  },
  COLUMN: {
    type: "COLUMN",
    useCase: "狭窄通道行军，保持纵队",
    strengths: ["narrow profile fits chokepoints", "fast through corridors"],
    weaknesses: ["only front can attack", "vulnerable to flank ambush"],
    preferredTerrain: ["CHOKEPOINT", "CORRIDOR", "CONFINED"],
  },
  CLUSTER: {
    type: "CLUSTER",
    useCase: "紧凑编队，撤退/防守",
    strengths: ["maximized heal coverage", "compact for retreat"],
    weaknesses: ["AoE vulnerable", "reduced frontal firepower"],
    preferredTerrain: ["UNKNOWN", "FORTIFIED", "CORE_DEFENSE"],
  },
  SCATTER: {
    type: "SCATTER",
    useCase: "分散规避 AoE / 吸引火力分散",
    strengths: ["reduces AoE damage", "spreads tower fire"],
    weaknesses: ["reduced heal coverage", "harder to coordinate"],
    preferredTerrain: ["OPEN", "OPEN_FIELD"],
  },
};

// ═══════════════════════════════════════════════════════════
// §2. 阵型选择
// ═══════════════════════════════════════════════════════════

/**
 * 根据地形和战术状态选择阵型。
 *
 * 选择规则（基于实际代码分析，非凑枚举）：
 *   OPEN_TERRAIN + ENGAGING → WEDGE（突击突破）
 *   CHOKEPOINT + MOVING → COLUMN（纵队通过）
 *   RETREAT → CLUSTER（紧凑撤退）
 *   FORTIFIED + HOLD → LINE（正面展开）
 *   UNKNOWN → CLUSTER（保守密集）
 */
export function selectFormationForTerrain(
  terrain: TerrainContext,
  state: TacticalState,
): FormationType {
  // 撤退/重新集结/脱离 → 始终 CLUSTER
  if (state === "RETREATING" || state === "REGROUPING" || state === "DISENGAGING") {
    return "CLUSTER";
  }

  // 行军 → COLUMN（适合跨房和狭窄通道）
  if (state === "MOVING") {
    return "COLUMN";
  }

  // 接敌/阵位 → 根据地形选择
  if (state === "ENGAGING" || state === "POSITIONING") {
    return selectCombatFormation(terrain);
  }

  // 默认
  return "CLUSTER";
}

function selectCombatFormation(terrain: TerrainContext): FormationType {
  switch (terrain.terrainType) {
    case "OPEN":
    case "OPEN_FIELD":
      // 开阔地形：WEDGE 突击（集中火力突破）
      return "WEDGE";

    case "CHOKEPOINT":
    case "CORRIDOR":
    case "CONFINED":
      // 狭窄通道：COLUMN 纵队
      return "COLUMN";

    case "FORTIFIED":
    case "CORE_DEFENSE":
      // 工事区：LINE 正面展开
      return "LINE";

    default:
      // UNKNOWN：保守 CLUSTER
      return "CLUSTER";
  }
}

// ═══════════════════════════════════════════════════════════
// §3. 阵型转换条件
// ═══════════════════════════════════════════════════════════

/** 阵型转换建议。 */
export interface FormationTransition {
  readonly from: FormationType;
  readonly to: FormationType;
  readonly reason: string;
  readonly condition: string;
}

/**
 * 评估是否需要阵型转换。
 *
 * 转换条件基于实际地形变化：
 *   OPEN → CHOKEPOINT: WEDGE → COLUMN
 *   CHOKEPOINT → OPEN: COLUMN → WEDGE
 *   ENGAGING → RETREATING: * → CLUSTER
 */
export function evaluateFormationTransition(
  currentFormation: FormationType,
  terrain: TerrainContext,
  currentState: TacticalState,
): FormationTransition | null {
  const recommended = selectFormationForTerrain(terrain, currentState);

  if (recommended === currentFormation) return null;

  return {
    from: currentFormation,
    to: recommended,
    reason: `terrain=${terrain.terrainType} state=${currentState}`,
    condition: `formation ${currentFormation} → ${recommended} for ${terrain.terrainType}`,
  };
}
