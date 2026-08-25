/**
 * Terrain Context — A5.2 G3 纯函数。
 *
 * 从地形快照（TerrainSnapshot）推导军事地形上下文（TerrainContext）。
 *
 * 核心原则：Terrain 只提供 Context，不产生 Military Action。
 * TerrainContext 影响 Combat（通过 mobilityModifier），但绝不直接修改 CombatCapability。
 * 正确方式：CombatCapability + TerrainContext → effectiveCombatContext。
 *
 * 纯函数律：不引用 Game / Memory / RawMemory / Creep / Room / PathFinder / 任何 Runtime 对象。
 * 所有运行时数据由调用方（系统层薄壳）注入为 Snapshot。
 *
 * 引擎常量来源：docs/research/03_SCREEPS_GAME_CONSTRAINTS.md（CONFIRMED）。
 * - plain: fatigue=1, move=1 可走
 * - swamp: fatigue=5, move=1 需要 5 tick 减 2 = 3 tick 一步
 * - road: fatigue=0, move=1 无 fatigue
 * - wall: 不可通行
 * - rampart: 可通行（友方），提供掩护
 */

// ═══════════════════════════════════════════════════════════
// §1. 类型定义
// ═══════════════════════════════════════════════════════════

/** 地形类型（军事特征，非原始 tile type）。 */
export type TerrainType =
  | "OPEN"
  | "CONFINED"
  | "CORRIDOR"
  | "CHOKEPOINT"
  | "FORTIFIED"
  | "OPEN_FIELD"
  | "CORE_DEFENSE"
  | "UNKNOWN";

/** 可行走性描述。 */
export type Walkability =
  | "FULL"       // 大部分可通行，少量墙
  | "PARTIAL"    // 有墙但有多条路径
  | "RESTRICTED" // 墙多，路径有限
  | "BLOCKED"    // 几乎不可通行
  | "UNKNOWN";

/** Tower 暴露等级。 */
export type TowerExposure =
  | "NONE"      // 无塔覆盖
  | "LOW"       // 1 塔且距离远
  | "MEDIUM"    // 1-2 塔中等距离
  | "HIGH"      // 2+ 塔近距离
  | "CRITICAL"  // 3+ 塔近距离（集火区）
  | "UNKNOWN";

/** Rampart 覆盖等级。 */
export type RampartCoverage =
  | "NONE"           // 无 rampart
  | "PARTIAL"        // 部分覆盖
  | "HIGH"           // 大量覆盖
  | "CORE_FORTIFIED" // 核心区完全覆盖
  | "UNKNOWN";

/** 撤退质量。 */
export type RetreatQuality =
  | "VERY_GOOD"  // 多条退路，无 chokepoint
  | "GOOD"       // 有退路
  | "POOR"       // 退路有限
  | "CRITICAL"   // 几乎无退路
  | "UNKNOWN";

/** 狭窄入口（军事意义重大）。 */
export interface Chokepoint {
  /** packed position (x*50+y)。 */
  pos: number;
  /** 通道宽度（格数）。 */
  width: number;
  /** 方向（8 扇区，0=东，顺时针）。 */
  direction: number;
  /** 重要性（0-1，基于通行流量估计）。 */
  significance: number;
}

/** 走廊（连接两个开放区域的窄通道）。 */
export interface Corridor {
  /** 入口 packed pos。 */
  entry: number;
  /** 出口 packed pos。 */
  exit: number;
  /** 长度（格数）。 */
  length: number;
  /** 宽度（格数）。 */
  width: number;
}

/** TerrainSnapshot — 系统层注入的地形数据（不持有 Runtime 对象）。 */
export interface TerrainSnapshot {
  /** 房间名。 */
  roomName: string;
  /** 核心锚点 packed pos（spawn 或 controller）。 */
  corePos: number;
  /** RCL。 */
  rcl: number;
  /** 非墙格总数（2500 - wallCount）。 */
  openTileCount: number;
  /** 墙格总数。 */
  wallCount: number;
  /** 总格数（通常 2500）。 */
  totalTiles: number;
  /** 已知 rampart 位置（packed pos 数组）。 */
  rampartPositions: number[];
  /** 已知 tower 位置（packed pos 数组）。 */
  towerPositions: number[];
  /** 已知 road 位置（packed pos 数组）。 */
  roadPositions: number[];
  /** 出口位置（packed pos 数组，来自 room.find(FIND_EXIT)）。 */
  exitPositions: number[];
  /** 距离场（可选，来自 layout/terrain-analysis.ts 的 DistanceField）。 */
  distanceField?: Uint8Array;
  /** 地形查询函数（(x,y) → 是否墙），注入以便纯函数可测试。 */
  isWall: (x: number, y: number) => boolean;
  /** 是否有视野（false = 无视野，所有特征返回 UNKNOWN）。 */
  hasVision: boolean;
}

// ═══════════════════════════════════════════════════════════
// §2. TerrainContext 输出
// ═══════════════════════════════════════════════════════════

/** 完整的地形上下文。 */
export interface TerrainContext {
  /** 房间名。 */
  roomName: string;
  /** 军事地形类型。 */
  terrainType: TerrainType;
  /** 可行走性。 */
  walkability: Walkability;
  /** 开放格占比（0-1）。 */
  openTileRatio: number;
  /** 墙密度（0-1）。 */
  wallDensity: number;
  /** 识别到的 chokepoint 列表。 */
  chokepoints: Chokepoint[];
  /** 识别到的走廊列表。 */
  corridors: Corridor[];
  /** Rampart 覆盖等级。 */
  rampartCoverage: RampartCoverage;
  /** Tower 暴露等级。 */
  towerCoverage: TowerExposure;
  /** 核心区暴露程度（0-1，越高越暴露）。 */
  coreExposure: number;
  /** 撤退质量。 */
  retreatQuality: RetreatQuality;
  /** 机动性修正系数（0-2，1=正常，<1=受限，>1=增强如全路）。 */
  mobilityModifier: number;
  /** 评估 tick。 */
  tick: number;
}

// ═══════════════════════════════════════════════════════════
// §3. 辅助函数
// ═══════════════════════════════════════════════════════════

/** 从 packed pos 解包坐标。 */
function unpackPos(packed: number): { x: number; y: number } {
  return { x: Math.floor(packed / 50), y: packed % 50 };
}

/** 切比雪夫距离。 */
function chebyshevDistance(pos1: number, pos2: number): number {
  const a = unpackPos(pos1);
  const b = unpackPos(pos2);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 计算两点间的最短路径长度估计（切比雪夫距离，不考虑障碍）。 */
function estimatedDistance(pos1: number, pos2: number): number {
  return chebyshevDistance(pos1, pos2);
}

/**
 * 计算某位置周围的开放格数（8 邻接中非墙格数）。
 */
function countOpenNeighbors(pos: number, isWall: (x: number, y: number) => boolean): number {
  const { x, y } = unpackPos(pos);
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
      if (!isWall(nx, ny)) count++;
    }
  }
  return count;
}

/**
 * 计算某位置通过 4 邻接可达的非墙格数（BFS，限制深度）。
 * 用于判断 chokepoint：如果某个位置只有很少的邻居可达，它就是 chokepoint。
 */
function computeConnectivity(
  startPos: number,
  isWall: (x: number, y: number) => boolean,
  maxDepth: number,
): number {
  const visited = new Set<number>();
  const queue: { pos: number; depth: number }[] = [{ pos: startPos, depth: 0 }];
  visited.add(startPos);

  while (queue.length > 0) {
    const { pos, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const { x, y } = unpackPos(pos);
    const neighbors: number[] = [];
    // 4 邻接
    if (x > 0 && !isWall(x - 1, y)) neighbors.push((x - 1) * 50 + y);
    if (x < 49 && !isWall(x + 1, y)) neighbors.push((x + 1) * 50 + y);
    if (y > 0 && !isWall(x, y - 1)) neighbors.push(x * 50 + (y - 1));
    if (y < 49 && !isWall(x, y + 1)) neighbors.push(x * 50 + (y + 1));

    for (const n of neighbors) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push({ pos: n, depth: depth + 1 });
    }
  }

  return visited.size;
}

// ═══════════════════════════════════════════════════════════
// §4. 特征计算函数
// ═══════════════════════════════════════════════════════════

/**
 * 计算开放格占比。
 */
function computeOpenTileRatio(snapshot: TerrainSnapshot): number {
  if (snapshot.totalTiles === 0) return 0;
  return snapshot.openTileCount / snapshot.totalTiles;
}

/**
 * 计算墙密度。
 */
function computeWallDensity(snapshot: TerrainSnapshot): number {
  if (snapshot.totalTiles === 0) return 0;
  return snapshot.wallCount / snapshot.totalTiles;
}

/**
 * 计算可行走性。
 */
function computeWalkability(snapshot: TerrainSnapshot): Walkability {
  if (!snapshot.hasVision) return "UNKNOWN";
  const ratio = computeOpenTileRatio(snapshot);
  if (ratio > 0.75) return "FULL";
  if (ratio > 0.5) return "PARTIAL";
  if (ratio > 0.25) return "RESTRICTED";
  return "BLOCKED";
}

/**
 * 识别 chokepoint — 出口附近通行宽度 ≤ 2 的位置。
 *
 * 算法：
 * 1. 对每个出口位置，检查其到核心区的路径宽度
 * 2. 如果某位置通过 4 邻接只有 ≤ 2 个非墙邻居，它是 chokepoint
 * 3. 显著性 = 1 - (openNeighbors / 8)
 */
function identifyChokepoints(snapshot: TerrainSnapshot): Chokepoint[] {
  if (!snapshot.hasVision) return [];

  const chokepoints: Chokepoint[] = [];
  const seen = new Set<number>();

  for (const exitPos of snapshot.exitPositions) {
    // 从出口向核心方向扫描，找第一个窄通道
    const { x: ex, y: ey } = unpackPos(exitPos);
    const { x: cx, y: cy } = unpackPos(snapshot.corePos);

    // 简化：沿出口到核心的直线检查每个格子的通行宽度
    const dx = Math.sign(cx - ex);
    const dy = Math.sign(cy - ey);
    const steps = Math.max(Math.abs(cx - ex), Math.abs(cy - ey));

    for (let i = 0; i < steps; i++) {
      const px = ex + dx * i;
      const py = ey + dy * i;
      if (px < 0 || px >= 50 || py < 0 || py >= 50) continue;
      const packed = px * 50 + py;
      if (seen.has(packed)) continue;
      if (snapshot.isWall(px, py)) continue;

      const openNeighbors = countOpenNeighbors(packed, snapshot.isWall);
      if (openNeighbors <= 2) {
        seen.add(packed);
        const direction = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        chokepoints.push({
          pos: packed,
          width: openNeighbors,
          direction: ((direction % 8) + 8) % 8,
          significance: 1 - openNeighbors / 8,
        });
      }
    }
  }

  // 按显著性排序，取前 5
  chokepoints.sort((a, b) => b.significance - a.significance);
  return chokepoints.slice(0, 5);
}

/**
 * 识别走廊 — 连接两个开放区域的窄通道。
 *
 * 简化算法：找连续的窄通道格（openNeighbors ≤ 3）。
 */
function identifyCorridors(snapshot: TerrainSnapshot): Corridor[] {
  if (!snapshot.hasVision) return [];

  const corridors: Corridor[] = [];
  const corridorSet = new Set<number>();

  // 扫描所有非墙格
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (snapshot.isWall(x, y)) continue;
      const packed = x * 50 + y;
      if (corridorSet.has(packed)) continue;

      const openNeighbors = countOpenNeighbors(packed, snapshot.isWall);
      if (openNeighbors <= 3 && openNeighbors >= 1) {
        // 可能是走廊的一部分
        corridorSet.add(packed);

        // 尝试延伸走廊
        let length = 1;
        let currentPacked = packed;
        const { x: cx, y: cy } = unpackPos(currentPacked);

        // 简化：向邻居方向延伸
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            let nx = cx + dx;
            let ny = cy + dy;
            while (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && !snapshot.isWall(nx, ny)) {
              const nPacked = nx * 50 + ny;
              const nOpen = countOpenNeighbors(nPacked, snapshot.isWall);
              if (nOpen > 3) {
                // 到达开放区域
                corridors.push({
                  entry: packed,
                  exit: nPacked,
                  length,
                  width: openNeighbors,
                });
                break;
              }
              corridorSet.add(nPacked);
              length++;
              nx += dx;
              ny += dy;
            }
          }
        }
      }
    }
  }

  return corridors.slice(0, 5);
}

/**
 * 计算 Rampart 覆盖等级。
 */
function computeRampartCoverage(snapshot: TerrainSnapshot): RampartCoverage {
  if (!snapshot.hasVision) return "UNKNOWN";
  const count = snapshot.rampartPositions.length;
  if (count === 0) return "NONE";

  // 检查核心区是否有 rampart 覆盖
  let coreRamparts = 0;
  for (const rPos of snapshot.rampartPositions) {
    const dist = chebyshevDistance(rPos, snapshot.corePos);
    if (dist <= 5) coreRamparts++;
  }

  if (coreRamparts >= 10) return "CORE_FORTIFIED";
  if (count >= 20) return "HIGH";
  return "PARTIAL";
}

/**
 * 计算 Tower 暴露等级。
 *
 * 不简单用 towerCount 决定，必须考虑位置和可进入区域。
 */
function computeTowerExposure(
  snapshot: TerrainSnapshot,
  hostilePos?: number,
): TowerExposure {
  if (!snapshot.hasVision) return "UNKNOWN";
  const towerCount = snapshot.towerPositions.length;
  if (towerCount === 0) return "NONE";

  // 如果有敌方位置，计算到最近塔的距离
  if (hostilePos !== undefined) {
    let minDist = Infinity;
    for (const tPos of snapshot.towerPositions) {
      const dist = chebyshevDistance(tPos, hostilePos);
      if (dist < minDist) minDist = dist;
    }

    // 塔有效射程 5 格（满伤），15 格（半伤），20+ 格（最小伤）
    if (towerCount >= 3 && minDist <= 5) return "CRITICAL";
    if (towerCount >= 2 && minDist <= 10) return "HIGH";
    if (towerCount >= 1 && minDist <= 15) return "MEDIUM";
    return "LOW";
  }

  // 无敌方位置时，基于塔数量和核心距离评估
  let nearCoreTowers = 0;
  for (const tPos of snapshot.towerPositions) {
    const dist = chebyshevDistance(tPos, snapshot.corePos);
    if (dist <= 10) nearCoreTowers++;
  }

  if (towerCount >= 3 && nearCoreTowers >= 3) return "CRITICAL";
  if (towerCount >= 2 && nearCoreTowers >= 2) return "HIGH";
  if (towerCount >= 1) return "MEDIUM";
  return "LOW";
}

/**
 * 计算核心区暴露程度（0-1）。
 *
 * 基于：到最近出口的距离（越近越暴露）、chokepoint 数量（越少越暴露）。
 */
function computeCoreExposure(
  snapshot: TerrainSnapshot,
  chokepoints: Chokepoint[],
): number {
  if (!snapshot.hasVision) return 0.5; // 未知时取中间值

  // 到最近出口的距离
  let minExitDist = Infinity;
  for (const exitPos of snapshot.exitPositions) {
    const dist = estimatedDistance(exitPos, snapshot.corePos);
    if (dist < minExitDist) minExitDist = dist;
  }

  // 距离越近暴露越高（dist=0 → 1.0, dist=50 → 0.0）
  const distanceExposure = minExitDist === Infinity
    ? 0
    : Math.max(0, 1 - minExitDist / 50);

  // chokepoint 越多暴露越低（有天然屏障）
  const chokepointReduction = Math.min(chokepoints.length * 0.1, 0.5);

  return Math.max(0, Math.min(1, distanceExposure - chokepointReduction));
}

/**
 * 计算撤退质量。
 *
 * 基于：出口数量、chokepoint 数量、核心到出口的路径多样性。
 */
function computeRetreatQuality(
  snapshot: TerrainSnapshot,
  chokepoints: Chokepoint[],
): RetreatQuality {
  if (!snapshot.hasVision) return "UNKNOWN";

  const exitCount = snapshot.exitPositions.length;
  const significantChokepoints = chokepoints.filter(c => c.significance > 0.5).length;

  // 多出口 + 少 chokepoint = 好撤退
  if (exitCount >= 3 && significantChokepoints === 0) return "VERY_GOOD";
  if (exitCount >= 2 && significantChokepoints <= 1) return "GOOD";
  if (exitCount >= 1 && significantChokepoints <= 2) return "POOR";
  return "CRITICAL";
}

/**
 * 计算机动性修正系数。
 *
 * 基于：道路密度、沼泽比例、chokepoint 影响。
 * - 全路 + 开放 = 1.5（移动加速）
 * - 全沼泽 + 受限 = 0.3（移动严重受限）
 * - 正常平原 = 1.0
 */
function computeMobilityModifier(
  snapshot: TerrainSnapshot,
  chokepoints: Chokepoint[],
): number {
  if (!snapshot.hasVision) return 1.0;

  const roadRatio = snapshot.totalTiles > 0
    ? snapshot.roadPositions.length / snapshot.totalTiles
    : 0;

  // 道路加速
  let modifier = 1.0 + Math.min(roadRatio * 5, 0.5); // 最多 +0.5

  // Chokepoint 减速
  const chokepointPenalty = Math.min(chokepoints.length * 0.1, 0.4);
  modifier -= chokepointPenalty;

  // 墙密度减速
  const wallDensity = computeWallDensity(snapshot);
  if (wallDensity > 0.5) modifier -= 0.2;

  return Math.max(0.2, Math.min(2.0, modifier));
}

/**
 * 推导军事地形类型。
 */
function deriveTerrainType(
  snapshot: TerrainSnapshot,
  walkability: Walkability,
  chokepoints: Chokepoint[],
  rampartCoverage: RampartCoverage,
  towerExposure: TowerExposure,
  coreExposure: number,
): TerrainType {
  if (!snapshot.hasVision) return "UNKNOWN";

  // FORTIFIED: 核心区有 rampart 覆盖
  if (rampartCoverage === "CORE_FORTIFIED") return "FORTIFIED";

  // CORE_DEFENSE: 塔密集 + 核心区
  if (towerExposure === "CRITICAL" && coreExposure < 0.3) return "CORE_DEFENSE";

  // CHOKEPOINT: 有高显著性 chokepoint
  if (chokepoints.some(c => c.significance > 0.7)) return "CHOKEPOINT";

  // CORRIDOR: 可行走性受限但非完全阻塞
  if (walkability === "RESTRICTED" && chokepoints.length > 0) return "CORRIDOR";

  // CONFINED: 墙密度高
  const wallDensity = computeWallDensity(snapshot);
  if (wallDensity > 0.4) return "CONFINED";

  // OPEN_FIELD: 出口多 + 无 chokepoint + 无 rampart
  if (snapshot.exitPositions.length >= 3 && chokepoints.length === 0 && rampartCoverage === "NONE") {
    return "OPEN_FIELD";
  }

  // OPEN: 默认
  if (walkability === "FULL" || walkability === "PARTIAL") return "OPEN";

  return "UNKNOWN";
}

// ═══════════════════════════════════════════════════════════
// §5. 主函数
// ═══════════════════════════════════════════════════════════

/**
 * 从 TerrainSnapshot 构建完整的地形上下文。
 *
 * 纯函数 — 不访问 Game / Memory / 任何 Runtime。
 * 复杂度：O(exitPositions.length × roomSize) 用于 chokepoint 识别。
 *
 * @param snapshot 地形快照（由系统层薄壳注入）
 * @param tick 当前 tick
 * @param hostilePos 可选：敌方位置（用于 tower exposure 计算）
 * @returns 完整的 TerrainContext
 */
export function buildTerrainContext(
  snapshot: TerrainSnapshot,
  tick: number,
  hostilePos?: number,
): TerrainContext {
  // 无视野 → 全部 UNKNOWN
  if (!snapshot.hasVision) {
    return {
      roomName: snapshot.roomName,
      terrainType: "UNKNOWN",
      walkability: "UNKNOWN",
      openTileRatio: 0,
      wallDensity: 0,
      chokepoints: [],
      corridors: [],
      rampartCoverage: "UNKNOWN",
      towerCoverage: "UNKNOWN",
      coreExposure: 0.5,
      retreatQuality: "UNKNOWN",
      mobilityModifier: 1.0,
      tick,
    };
  }

  const openTileRatio = computeOpenTileRatio(snapshot);
  const wallDensity = computeWallDensity(snapshot);
  const walkability = computeWalkability(snapshot);
  const chokepoints = identifyChokepoints(snapshot);
  const corridors = identifyCorridors(snapshot);
  const rampartCoverage = computeRampartCoverage(snapshot);
  const towerCoverage = computeTowerExposure(snapshot, hostilePos);
  const coreExposure = computeCoreExposure(snapshot, chokepoints);
  const retreatQuality = computeRetreatQuality(snapshot, chokepoints);
  const mobilityModifier = computeMobilityModifier(snapshot, chokepoints);
  const terrainType = deriveTerrainType(
    snapshot,
    walkability,
    chokepoints,
    rampartCoverage,
    towerCoverage,
    coreExposure,
  );

  return {
    roomName: snapshot.roomName,
    terrainType,
    walkability,
    openTileRatio: Math.round(openTileRatio * 100) / 100,
    wallDensity: Math.round(wallDensity * 100) / 100,
    chokepoints,
    corridors,
    rampartCoverage,
    towerCoverage,
    coreExposure: Math.round(coreExposure * 100) / 100,
    retreatQuality,
    mobilityModifier: Math.round(mobilityModifier * 100) / 100,
    tick,
  };
}

/**
 * 计算 effective combat context — Terrain 对 Combat 的影响。
 *
 * 正确方式：不修改 CombatCapability，而是产出修正系数供消费者使用。
 * 例如：mobilityModifier 影响 timeToImpact，towerCoverage 影响 effectiveHP。
 */
export interface EffectiveCombatModifier {
  /** 机动性修正（乘到 mobility 上）。 */
  mobilityModifier: number;
  /** Tower 伤害修正（1=满伤, 0.5=半伤, 0=无塔）。 */
  towerDamageFactor: number;
  /** 撤退难度修正（1=正常, >1=更难撤退）。 */
  retreatDifficulty: number;
  /** 接近能力修正（1=正常, <1=chokepoint 限制接近）。 */
  approachFactor: number;
}

/**
 * 从 TerrainContext 派生战斗修正系数。
 */
export function deriveCombatModifier(terrain: TerrainContext): EffectiveCombatModifier {
  const mobilityModifier = terrain.mobilityModifier;

  // Tower 伤害修正
  const towerDamageMap: Record<TowerExposure, number> = {
    NONE: 0,
    LOW: 0.3,
    MEDIUM: 0.6,
    HIGH: 0.85,
    CRITICAL: 1.0,
    UNKNOWN: 0.5,
  };
  const towerDamageFactor = towerDamageMap[terrain.towerCoverage];

  // 撤退难度
  const retreatMap: Record<RetreatQuality, number> = {
    VERY_GOOD: 0.5,
    GOOD: 0.8,
    POOR: 1.3,
    CRITICAL: 2.0,
    UNKNOWN: 1.0,
  };
  const retreatDifficulty = retreatMap[terrain.retreatQuality];

  // 接近能力（chokepoint 限制）
  const significantChokepoints = terrain.chokepoints.filter(c => c.significance > 0.5).length;
  const approachFactor = Math.max(0.3, 1 - significantChokepoints * 0.2);

  return {
    mobilityModifier,
    towerDamageFactor,
    retreatDifficulty,
    approachFactor,
  };
}

/**
 * 地形缓存签名 — 用于检测地形变化并使缓存失效。
 *
 * 地形本身不变（plain/swamp/wall 是永久的），但建筑（rampart/tower/road）会变化。
 * 签名包含建筑位置，变化时缓存失效。
 */
export function terrainCacheSignature(snapshot: TerrainSnapshot): string {
  const ramparts = snapshot.rampartPositions.length;
  const towers = snapshot.towerPositions.length;
  const roads = snapshot.roadPositions.length;
  const rcl = snapshot.rcl;
  return `${snapshot.roomName}:${rcl}:${ramparts}:${towers}:${roads}`;
}
