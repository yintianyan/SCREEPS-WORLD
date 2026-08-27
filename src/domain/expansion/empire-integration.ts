/** Empire Integration */

/** Empire Integration 评估输入。 */
export interface EmpireIntegrationInput {
  /** 新房是否已出现在 owned rooms 列表中。 */
  inOwnedRoomsList: boolean;
  /** 新房是否有 RoomSnapshot。 */
  hasSnapshot: boolean;
  /** 新房是否被纳入 Empire Economy 统计。 */
  inEconomyStats: boolean;
  /** 新房 Spawn 是否被 Spawn Manager 统一调度。 */
  spawnManaged: boolean;
  /** 新房是否被 Defense 系统覆盖。 */
  defenseCovered: boolean;
  /** 新房是否有 Layout Planner 管理的版本化布局。 */
  hasVersionedLayout: boolean;
  /** 当前 tick。 */
  tick: number;
}

/** Empire Integration 评估结果。 */
export interface EmpireIntegrationResult {
  /** 是否已集成。 */
  integrated: boolean;
  /** 集成进度。 */
  progress: number;
  /** 各系统集成状态。 */
  systems: {
    snapshot: boolean;
    economy: boolean;
    spawn: boolean;
    defense: boolean;
    layout: boolean;
  };
  /** 未集成的系统列表。 */
  missingSystems: string[];
  /** 人类可读证据。 */
  evidence: string;
}

/**
 * 评估 Empire Integration 状态（纯函数）。

 * 集成条件：5 个系统全部覆盖。
 */
export function evaluateEmpireIntegration(input: EmpireIntegrationInput): EmpireIntegrationResult {
  const systems = {
    snapshot: input.hasSnapshot,
    economy: input.inEconomyStats,
    spawn: input.spawnManaged,
    defense: input.defenseCovered,
    layout: input.hasVersionedLayout,
  };

  const missingSystems: string[] = [];
  if (!systems.snapshot) missingSystems.push("RoomSnapshot");
  if (!systems.economy) missingSystems.push("EconomyStats");
  if (!systems.spawn) missingSystems.push("SpawnManager");
  if (!systems.defense) missingSystems.push("DefenseSystem");
  if (!systems.layout) missingSystems.push("LayoutPlanner");

  const integrated = missingSystems.length === 0 && input.inOwnedRoomsList;
  const passedCount = Object.values(systems).filter(Boolean).length;
  const progress = (passedCount / 5) * 100;

  const evidence = [
    `EmpireIntegration @${input.tick}`,
    `inOwnedRoomsList=${input.inOwnedRoomsList}`,
    `snapshot=${systems.snapshot} economy=${systems.economy} spawn=${systems.spawn} defense=${systems.defense} layout=${systems.layout}`,
    integrated ? "INTEGRATED" : `missing: ${missingSystems.join(", ")}`,
  ].join(" | ");

  return {
    integrated,
    progress: Math.round(progress),
    systems,
    missingSystems,
    evidence,
  };
}

/**
 * 判断是否可以移交（从 expansion-manager 到常规运营）。

 * 移交条件：integrated === true && economicActivated === true
 */
export function canHandover(
  integration: EmpireIntegrationResult,
  economicActivated: boolean,
): boolean {
  return integration.integrated && economicActivated;
}
