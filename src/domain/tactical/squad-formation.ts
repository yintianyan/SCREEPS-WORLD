/** Squad Formation & Tactical Movement */

import type {
  FormationType,
  TacticalState,
  SquadPlan,
  SquadMemberSnapshot,
} from "./types";
import type { TerrainContext } from "../defense/terrain-context";

// ═══════════════════════════════════════════════════════════
// §1. SquadSnapshot — 编队运行时快照
// ═══════════════════════════════════════════════════════════

/**
 * Squad 成员运行时快照 — 从 Game 对象提取的 DTO，不持有 Runtime 引用。

 * 与 A5.4.0 SquadMemberSnapshot 的区别：
 *   - SquadMemberSnapshot 是 SquadPlan 的静态成员列表（孵化时确定）。
 *   - SquadMemberRuntimeSnapshot 是每 tick 从 Game 对象采集的实时状态。
 *   - 前者用于计划，后者用于执行。
 */
export interface SquadMemberRuntimeSnapshot {
  /** Creep 名称（稳定标识，与 SquadMemberSnapshot.name 对齐）。 */
  readonly name: string;
  /** 角色（attacker / healer / ranged / tank / dismantler）。 */
  readonly role: string;
  /** 当前位置 packed pos (x*50+y)。 */
  readonly pos: number;
  /** 所在房间名。 */
  readonly room: string;
  /** 当前血量。 */
  readonly hits: number;
  /** 最大血量。 */
  readonly hitsMax: number;
  /** 疲劳值（0 = 可移动）。 */
  readonly fatigue: number;
  /** 剩余寿命。 */
  readonly ticksToLive?: number;
  /** 是否存活。 */
  readonly alive: boolean;
  /** 是否被 boost。 */
  readonly boosted: boolean;
  /** 战斗能力快照（可选，A5.4.0 已有）。 */
  readonly capability?: {
    attack: number;
    rangedAttack: number;
    heal: number;
    effectiveHP: number;
  };
  /** 当前战术状态（个体级，与 Squad 级 TacticalState 对齐）。 */
  readonly tacticalState?: TacticalState;
}

/**
 * SquadSnapshot — 一个编队在某一 tick 的完整运行时快照。

 * 这是 Squad Formation Domain 的唯一输入格式（纯函数输入）。
 * 系统层薄壳负责从 Game/Memory 构建此快照并注入。
 */
export interface SquadSnapshot {
  /** 编队唯一标识。 */
  readonly squadId: string;
  /** 所属 Operation ID。 */
  readonly operationId: string;
  /** 所属 TacticalObjective ID。 */
  readonly objectiveId: string;
  /** 成员运行时快照列表。 */
  readonly members: readonly SquadMemberRuntimeSnapshot[];
  /** 当前阵型类型。 */
  readonly formation: FormationType;
  /** 当前战术状态（Squad 级）。 */
  readonly state: TacticalState;
  /** 当前 tick。 */
  readonly tick: number;
  /** 目标房间名。 */
  readonly targetRoom: string;
  /** 目标位置 packed pos（可选 — Objective 相对移动模式用）。 */
  readonly targetPos?: number;
  /** 撤退房间名。 */
  readonly retreatRoom: string;
  /** 集结点 packed pos。 */
  readonly regroupPos: number;
  /** 集结房间名。 */
  readonly regroupRoom: string;
}

// ═══════════════════════════════════════════════════════════
// §2. FormationSlot — 每个 Member 的阵型槽位
// ═══════════════════════════════════════════════════════════

/**
 * FormationSlot — 一个成员在阵型中相对于 Anchor 的期望位置。

 * Domain 只计算 DesiredPosition，不执行移动。
 * Runtime 负责 DesiredPosition → PathFinder → registerMove。
 */
export interface FormationSlot {
  /** 成员名称。 */
  readonly creepName: string;
  /** 角色。 */
  readonly role: string;
  /** 期望位置 packed pos (x*50+y)，相对于 Anchor 偏移后投影。 */
  readonly desiredPosition: number;
  /** 期望所在房间。 */
  readonly desiredRoom: string;
  /** 槽位索引（确定性排序，用于 Hash）。 */
  readonly slotIndex: number;
  /** 优先级（healer 优先于 attacker）。 */
  readonly priority: number;
  /** 容忍范围（格数，超过此距离视为偏离阵型）。 */
  readonly tolerance: number;
}

// ═══════════════════════════════════════════════════════════
// §3. Anchor — 编队锚点
// ═══════════════════════════════════════════════════════════

/**
 * Anchor 定义 — 编队的参考中心点。

 * Canonical 选择：Centroid（存活成员的几何中心）。

 * 选择理由（基于 Screeps 语义分析）：
 *   - Leader Path（方案 A）：Leader 死亡则 Anchor 丢失，编队瞬间散架。
 *     且 Leader 的 PathFinder 结果是单点路径，其他成员无法有效投影。
 *   - Anchor Path（方案 B）：Anchor 是抽象点（Centroid），不依赖单个 Creep。
 *     但 Centroid 移动需要全员协调，不能直接 PathFinder 一个抽象点。
 *   - **实际选择：Centroid Anchor + Leader Path 混合方案**
 *     Anchor = Centroid（用于 Formation Slot 计算 + Cohesion 判断）
 *     Path = 从最接近 Centroid 的存活成员（Path Leader）计算主路径
 *     其他成员按 Formation Slot 跟随 Path Leader 的方向

 * 这样 Leader 死亡时 Centroid 自动重算，新 Leader 自动产生，编队不散架。
 */
export interface FormationAnchor {
  /** Anchor packed pos (x*50+y)。 */
  readonly pos: number;
  /** Anchor 所在房间。 */
  readonly room: string;
  /** Path Leader 名称（最接近 Centroid 的存活成员）。 */
  readonly pathLeader: string;
  /** 计算原因。 */
  readonly reason: string;
}

/**
 * 计算 Squad Anchor（Centroid + Path Leader）。

 * 算法：
 *   1. 过滤存活成员
 *   2. 计算几何中心（所有存活成员位置的平均值）
 *   3. 选择最接近中心的成员作为 Path Leader
 *   4. 确定性 tie-break：名称字典序

 * 纯函数 — 相同输入必产生相同输出。
 */
export function computeSquadAnchor(squad: SquadSnapshot): FormationAnchor {
  const alive = squad.members.filter(m => m.alive);
  if (alive.length === 0) {
    // 无存活成员 — 返回集结点作为 fallback
    return {
      pos: squad.regroupPos,
      room: squad.regroupRoom,
      pathLeader: "",
      reason: "no alive members → fallback to regroup pos",
    };
  }

  // 全部成员在同一房时直接计算 Centroid
  const sameRoom = alive.every(m => m.room === alive[0]!.room);
  if (sameRoom) {
    const room = alive[0]!.room;
    let sumX = 0;
    let sumY = 0;
    for (const m of alive) {
      sumX += Math.floor(m.pos / 50);
      sumY += m.pos % 50;
    }
    const cx = Math.floor(sumX / alive.length);
    const cy = Math.floor(sumY / alive.length);
    const centroid = cx * 50 + cy;

    // 选最接近 Centroid 的成员作为 Path Leader（确定性 tie-break: name）
    let bestName = alive[0]!.name;
    let bestDist = chebyshevDist(alive[0]!.pos, centroid);
    for (let i = 1; i < alive.length; i++) {
      const m = alive[i]!;
      const d = chebyshevDist(m.pos, centroid);
      if (d < bestDist || (d === bestDist && m.name < bestName)) {
        bestDist = d;
        bestName = m.name;
      }
    }

    return {
      pos: centroid,
      room,
      pathLeader: bestName,
      reason: `centroid of ${alive.length} alive members in ${room}`,
    };
  }

  // 成员跨房 — 取人数最多的房间作为 Anchor 房间
  const roomCounts = new Map<string, { count: number; sumX: number; sumY: number }>();
  for (const m of alive) {
    const entry = roomCounts.get(m.room) ?? { count: 0, sumX: 0, sumY: 0 };
    entry.count++;
    entry.sumX += Math.floor(m.pos / 50);
    entry.sumY += m.pos % 50;
    roomCounts.set(m.room, entry);
  }

  // 确定性排序：count 降序 → roomName 字典序
  const sortedRooms = [...roomCounts.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return a[0] < b[0] ? -1 : 1;
  });
  const [anchorRoom, roomData] = sortedRooms[0]!;
  const cx = Math.floor(roomData.sumX / roomData.count);
  const cy = Math.floor(roomData.sumY / roomData.count);

  // Path Leader = 该房间中最接近 Centroid 的成员
  const membersInRoom = alive.filter(m => m.room === anchorRoom);
  let bestName = membersInRoom[0]!.name;
  let bestDist = chebyshevDist(membersInRoom[0]!.pos, cx * 50 + cy);
  for (let i = 1; i < membersInRoom.length; i++) {
    const m = membersInRoom[i]!;
    const d = chebyshevDist(m.pos, cx * 50 + cy);
    if (d < bestDist || (d === bestDist && m.name < bestName)) {
      bestDist = d;
      bestName = m.name;
    }
  }

  return {
    pos: cx * 50 + cy,
    room: anchorRoom,
    pathLeader: bestName,
    reason: `cross-room centroid: ${roomData.count}/${alive.length} in ${anchorRoom}`,
  };
}

// ═══════════════════════════════════════════════════════════
// §4. Formation Slot 计算
// ═══════════════════════════════════════════════════════════

/**
 * 计算每个成员相对于 Anchor 的 Formation Slot。

 * 算法：
 *   1. 对存活成员按确定性排序（role priority → name）
 *   2. 按 FormationType 分配相对偏移
 *   3. 将偏移投影到 Anchor 位置得到 DesiredPosition

 * 阵型偏移语义（Screeps 格子坐标，y 向下为正）：
 *   LINE:    成员水平展开，前排在前（y-1），后排在后（y+1）
 *   WEDGE:   楔形，尖端在前，两翼后展
 *   COLUMN:  纵队，前后排列（y 方向递增）
 *   CLUSTER: 密集围绕中心（8 邻域）
 *   SCATTER: 间隔 2 格分散

 * @param anchor 编队锚点
 * @param formation 阵型类型
 * @param members 存活成员列表
 * @returns FormationSlot 列表（确定性排序）
 */
export function computeFormationSlots(
  anchor: FormationAnchor,
  formation: FormationType,
  members: readonly SquadMemberRuntimeSnapshot[],
): readonly FormationSlot[] {
  // 只分配给存活成员
  const alive = members.filter(m => m.alive);
  if (alive.length === 0) return [];

  // 确定性排序：healer 优先 → attacker → ranged → tank → dismantler → name
  const ROLE_PRIORITY: Record<string, number> = {
    healer: 0,
    attacker: 1,
    ranged: 2,
    tank: 3,
    dismantler: 4,
  };
  const sorted = [...alive].sort((a, b) => {
    const pa = ROLE_PRIORITY[a.role] ?? 99;
    const pb = ROLE_PRIORITY[b.role] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name < b.name ? -1 : 1;
  });

  const ax = Math.floor(anchor.pos / 50);
  const ay = anchor.pos % 50;

  // 按阵型类型生成偏移
  const offsets = getFormationOffsets(formation, sorted.length);

  // 计算每个成员的 DesiredPosition
  const slots: FormationSlot[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]!;
    const offset = offsets[i]!;
    const dx = offset[0];
    const dy = offset[1];

    // 投影到 Anchor 位置，限制在房间边界内
    let nx = ax + dx;
    let ny = ay + dy;
    nx = Math.max(0, Math.min(49, nx));
    ny = Math.max(0, Math.min(49, ny));

    const desiredPos = nx * 50 + ny;

    // 容忍范围根据角色和阵型决定
    const tolerance = computeSlotTolerance(m.role, formation);

    slots.push({
      creepName: m.name,
      role: m.role,
      desiredPosition: desiredPos,
      desiredRoom: anchor.room,
      slotIndex: i,
      priority: (ROLE_PRIORITY[m.role] ?? 99) * 100 + i,
      tolerance,
    });
  }

  return slots;
}

/**
 * 按阵型类型生成相对偏移数组。

 * 偏移坐标系：[dx, dy]，相对于 Anchor。
 * Screeps 坐标系：x 向右为正，y 向下为正。
 * 「前方」= y 减小方向（向上），「后方」= y 增大方向（向下）。

 * 语义分析（每种阵型适合什么环境）：

 * LINE（线形）：
 *   - 适合：开阔地形正面展开，最大化火力输出
 *   - 布局：前排 attacker/tank 在 y-1，后排 healer/ranged 在 y+1
 *   - 优势：均匀间距减少 AoE 脆性
 *   - 劣势：侧翼暴露

 * WEDGE（楔形）：
 *   - 适合：开阔地形突击，集中火力突破一点
 *   - 布局：尖端 1 人在 y-2，第二排 2 人在 y-1，第三排在 y
 *   - 优势：healer 可跟在楔形后方
 *   - 劣势：尖端承受最大伤害

 * COLUMN（纵队）：
 *   - 适合：狭窄通道行军，跨房移动
 *   - 布局：所有成员沿 y 轴排列，间距 1 格
 *   - 优势：窄轮廓通过 chokepoint
 *   - 劣势：只有前排能攻击

 * CLUSTER（密集）：
 *   - 适合：撤退/防守紧凑编队
 *   - 布局：围绕中心 8 邻域
 *   - 优势：最大化治疗覆盖
 *   - 劣势：AoE 脆性

 * SCATTER（散开）：
 *   - 适合：规避 AoE / 分散塔火力
 *   - 布局：间隔 2 格分散
 *   - 优势：减少 AoE 伤害
 *   - 劣势：治疗覆盖降低
 */
function getFormationOffsets(
  formation: FormationType,
  count: number,
): readonly (readonly [number, number])[] {
  switch (formation) {
    case "LINE":
      return lineOffsets(count);
    case "WEDGE":
      return wedgeOffsets(count);
    case "COLUMN":
      return columnOffsets(count);
    case "CLUSTER":
      return clusterOffsets(count);
    case "SCATTER":
      return scatterOffsets(count);
    default:
      return clusterOffsets(count);
  }
}

/** LINE 阵型偏移：前排展开 + 后排展开。 */
function lineOffsets(count: number): (readonly [number, number])[] {
  const result: (readonly [number, number])[] = [];
  const half = Math.floor(count / 2);
  for (let i = 0; i < count; i++) {
    // 偶数成员前排（y-1），奇数后排（y+1）
    const isFront = i % 2 === 0;
    const dy = isFront ? -1 : 1;
    // 水平展开：以 0 为中心，间距 1
    const idx = Math.floor(i / 2);
    const dx = idx - half + (count % 2 === 0 && idx >= half ? 1 : 0);
    result.push([dx, dy] as const);
  }
  return result;
}

/** WEDGE 阵型偏移：尖端在前，两翼后展。 */
function wedgeOffsets(count: number): (readonly [number, number])[] {
  const result: (readonly [number, number])[] = [];
  // 行号从 0 开始，每行宽度递增
  // 行 0: 1 人 (y=-2)
  // 行 1: 2 人 (y=-1)
  // 行 2: 2 人 (y=0)  — 但要对称
  // 行 3: 2 人 (y=1)
  // ...
  let placed = 0;
  let row = 0;
  while (placed < count) {
    const dy = -2 + row; // 从 y=-2 开始向后
    const width = row === 0 ? 1 : 2;
    const canPlace = Math.min(width, count - placed);
    for (let c = 0; c < canPlace; c++) {
      const dx = row === 0 ? 0 : (c === 0 ? -1 : 1);
      result.push([dx, dy] as const);
      placed++;
    }
    row++;
  }
  return result;
}

/** COLUMN 阵型偏移：纵队前后排列。 */
function columnOffsets(count: number): (readonly [number, number])[] {
  const result: (readonly [number, number])[] = [];
  for (let i = 0; i < count; i++) {
    // 前排在 y 减小方向，间距 1 格
    // 偶数在 x=0，奇数在 x=1（双列纵队如果人多）
    const dy = -i;
    const dx = i % 2;
    result.push([dx, dy] as const);
  }
  return result;
}

/** CLUSTER 阵型偏移：围绕中心 8 邻域。 */
function clusterOffsets(count: number): (readonly [number, number])[] {
  // 8 邻域偏移（顺时针从上方开始）
  const NEIGHBORS: readonly (readonly [number, number])[] = [
    [0, 0],   // 中心（第一个人）
    [0, -1],  // 上
    [1, -1],  // 右上
    [1, 0],   // 右
    [1, 1],   // 右下
    [0, 1],   // 下
    [-1, 1],  // 左下
    [-1, 0],  // 左
    [-1, -1], // 左上
  ];
  // 超过 9 人时向外扩展第二圈
  const result: (readonly [number, number])[] = [];
  for (let i = 0; i < count; i++) {
    if (i < NEIGHBORS.length) {
      result.push(NEIGHBORS[i]!);
    } else {
      // 第二圈：间距 2 格
      const angle = (i - NEIGHBORS.length) * 45;
      const rad = (angle * Math.PI) / 180;
      const dx = Math.round(2 * Math.cos(rad));
      const dy = Math.round(2 * Math.sin(rad));
      result.push([dx, dy] as const);
    }
  }
  return result;
}

/** SCATTER 阵型偏移：间隔 2 格分散。 */
function scatterOffsets(count: number): (readonly [number, number])[] {
  const result: (readonly [number, number])[] = [];
  // 螺旋分散，间距 2 格
  const positions: [number, number][] = [
    [0, 0],
    [2, 0], [-2, 0], [0, 2], [0, -2],
    [2, 2], [-2, -2], [2, -2], [-2, 2],
    [4, 0], [-4, 0], [0, 4], [0, -4],
    [4, 2], [-4, -2], [4, -2], [-4, 2],
    [2, 4], [-2, -4], [2, -4], [-2, 4],
  ];
  for (let i = 0; i < count; i++) {
    if (i < positions.length) {
      result.push(positions[i]!);
    } else {
      // 超出预定义位置 — 继续螺旋外扩
      const angle = (i - positions.length) * 51; // 黄金角避免对齐
      const rad = (angle * Math.PI) / 180;
      const r = 3 + Math.floor((i - positions.length) / 8);
      const dx = Math.round(r * Math.cos(rad));
      const dy = Math.round(r * Math.sin(rad));
      result.push([dx, dy] as const);
    }
  }
  return result;
}

/**
 * 计算槽位容忍范围（格数）。

 * healer 容忍更小（不能掉队），attacker 容忍中等，tank 容忍更大。
 * CLUSTER 容忍最小（密集编队），SCATTER 容忍最大（本就分散）。
 */
function computeSlotTolerance(role: string, formation: FormationType): number {
  const ROLE_TOLERANCE: Record<string, number> = {
    healer: 2,
    attacker: 3,
    ranged: 3,
    tank: 4,
    dismantler: 3,
  };
  const FORMATION_TOLERANCE: Record<FormationType, number> = {
    CLUSTER: 0,
    LINE: 1,
    WEDGE: 1,
    COLUMN: 1,
    SCATTER: 3,
  };
  return (ROLE_TOLERANCE[role] ?? 3) + (FORMATION_TOLERANCE[formation] ?? 1);
}

// ═══════════════════════════════════════════════════════════
// §5. Cohesion — 编队凝聚力指标
// ═══════════════════════════════════════════════════════════

/**
 * CohesionMetric — 编队凝聚力量化指标。

 * 不使用简单的「距离 > 3 就散队」判断。
 * 根据 Formation、Role、Anchor 距离综合评估。
 */
export interface CohesionMetric {
  /** 最大成员距离（到 Anchor 的最大切比雪夫距离）。 */
  readonly maxAnchorDistance: number;
  /** 平均成员距离（到 Anchor 的平均切比雪夫距离）。 */
  readonly avgAnchorDistance: number;
  /** 最大成员间距离（任意两成员间的最大切比雪夫距离）。 */
  readonly maxMemberDistance: number;
  /** Healer 到最近 Combat 成员的距离。 */
  readonly maxHealerDistance: number;
  /** 阵型偏离度（成员到 DesiredPosition 的平均距离）。 */
  readonly slotDeviation: number;
  /** 活跃成员数。 */
  readonly aliveCount: number;
  /** 总成员数。 */
  readonly totalCount: number;
  /** 凝聚力评级。 */
  readonly status: CohesionStatus;
  /** 评估原因。 */
  readonly reason: string;
}

/** 凝聚力评级。 */
export type CohesionStatus =
  | "INTACT"          // 阵型完整
  | "DEGRADED"        // 阵型降级（部分偏离但可恢复）
  | "BROKEN"          // 阵型破碎（需要 Regroup）
  | "CRITICAL";       // 严重破碎（几乎全散）

/**
 * 计算编队凝聚力。

 * 评估维度：
 *   1. 最大成员到 Anchor 距离
 *   2. 平均成员到 Anchor 距离
 *   3. 最大成员间距离
 *   4. Healer 到最近 Combat 成员距离（Screeps 最重要的特殊关系）
 *   5. 阵型偏离度（实际位置 vs DesiredPosition）
 *   6. 成员存活比例

 * 不同阵型有不同的容忍阈值：
 *   CLUSTER: maxDist > 3 → DEGRADED, > 5 → BROKEN
 *   COLUMN:  maxDist > 4 → DEGRADED, > 7 → BROKEN（行军队列天然拉长）
 *   LINE:    maxDist > 4 → DEGRADED, > 6 → BROKEN
 *   WEDGE:   maxDist > 4 → DEGRADED, > 6 → BROKEN
 *   SCATTER: maxDist > 6 → DEGRADED, > 10 → BROKEN（本就分散）
 */
export function computeCohesion(
  squad: SquadSnapshot,
  anchor: FormationAnchor,
  slots: readonly FormationSlot[],
): CohesionMetric {
  const alive = squad.members.filter(m => m.alive);
  const totalCount = squad.members.length;
  const aliveCount = alive.length;

  if (aliveCount === 0) {
    return {
      maxAnchorDistance: Infinity,
      avgAnchorDistance: Infinity,
      maxMemberDistance: Infinity,
      maxHealerDistance: Infinity,
      slotDeviation: Infinity,
      aliveCount: 0,
      totalCount,
      status: "CRITICAL",
      reason: "no alive members",
    };
  }

  // 1. 到 Anchor 的距离
  let maxAnchorDist = 0;
  let sumAnchorDist = 0;
  for (const m of alive) {
    // 跨房成员距离用房间名比较（不同房 = 远）
    const dist = m.room !== anchor.room
      ? 50 // 跨房距离用 50 作为占位（一个房间 50 格）
      : chebyshevDist(m.pos, anchor.pos);
    if (dist > maxAnchorDist) maxAnchorDist = dist;
    sumAnchorDist += dist;
  }
  const avgAnchorDist = sumAnchorDist / aliveCount;

  // 2. 最大成员间距离（只在同房间内计算）
  let maxMemberDist = 0;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;
      if (a.room !== b.room) {
        maxMemberDist = Math.max(maxMemberDist, 50); // 跨房
      } else {
        const d = chebyshevDist(a.pos, b.pos);
        if (d > maxMemberDist) maxMemberDist = d;
      }
    }
  }

  // 3. Healer 到最近 Combat 成员的距离
  let maxHealerDist = 0;
  const healers = alive.filter(m => m.role === "healer");
  const combatants = alive.filter(m => m.role !== "healer");
  if (healers.length > 0 && combatants.length > 0) {
    for (const h of healers) {
      let minDist = Infinity;
      for (const c of combatants) {
        if (h.room !== c.room) {
          minDist = Math.min(minDist, 50);
        } else {
          minDist = Math.min(minDist, chebyshevDist(h.pos, c.pos));
        }
      }
      if (minDist > maxHealerDist) maxHealerDist = minDist;
    }
  }

  // 4. 阵型偏离度
  let slotDevSum = 0;
  let slotDevCount = 0;
  for (const slot of slots) {
    const m = alive.find(a => a.name === slot.creepName);
    if (!m) continue;
    if (m.room !== slot.desiredRoom) {
      slotDevSum += 50; // 跨房偏离
    } else {
      slotDevSum += chebyshevDist(m.pos, slot.desiredPosition);
    }
    slotDevCount++;
  }
  const slotDeviation = slotDevCount > 0 ? slotDevSum / slotDevCount : 0;

  // 5. 评级（基于阵型容忍阈值）
  const thresholds = getCohesionThresholds(squad.formation);
  const aliveRatio = aliveCount / Math.max(1, totalCount);

  let status: CohesionStatus;
  let reason: string;

  if (aliveRatio < 0.3) {
    status = "CRITICAL";
    reason = `alive ratio ${aliveRatio.toFixed(2)} < 0.3`;
  } else if (maxAnchorDist > thresholds.broken || aliveRatio < thresholds.aliveBroken) {
    status = "BROKEN";
    reason = `maxAnchorDist=${maxAnchorDist} > ${thresholds.broken} or aliveRatio=${aliveRatio.toFixed(2)} < ${thresholds.aliveBroken}`;
  } else if (maxAnchorDist > thresholds.degraded || maxHealerDist > thresholds.healerBroken) {
    status = "DEGRADED";
    reason = `maxAnchorDist=${maxAnchorDist} > ${thresholds.degraded} or maxHealerDist=${maxHealerDist} > ${thresholds.healerBroken}`;
  } else if (slotDeviation > thresholds.degraded + 2) {
    status = "DEGRADED";
    reason = `slotDeviation=${slotDeviation.toFixed(1)} > ${thresholds.degraded + 2}`;
  } else {
    status = "INTACT";
    reason = `cohesion intact (maxDist=${maxAnchorDist}, avgDist=${avgAnchorDist.toFixed(1)}, healerDist=${maxHealerDist})`;
  }

  return {
    maxAnchorDistance: maxAnchorDist,
    avgAnchorDistance: avgAnchorDist,
    maxMemberDistance: maxMemberDist,
    maxHealerDistance: maxHealerDist,
    slotDeviation,
    aliveCount,
    totalCount,
    status,
    reason,
  };
}

/** 不同阵型的凝聚力阈值。 */
interface CohesionThresholds {
  readonly degraded: number;
  readonly broken: number;
  readonly healerBroken: number;
  readonly aliveBroken: number;
}

function getCohesionThresholds(formation: FormationType): CohesionThresholds {
  switch (formation) {
    case "CLUSTER":
      return { degraded: 3, broken: 5, healerBroken: 3, aliveBroken: 0.5 };
    case "COLUMN":
      return { degraded: 4, broken: 7, healerBroken: 4, aliveBroken: 0.5 };
    case "LINE":
      return { degraded: 4, broken: 6, healerBroken: 3, aliveBroken: 0.5 };
    case "WEDGE":
      return { degraded: 4, broken: 6, healerBroken: 3, aliveBroken: 0.5 };
    case "SCATTER":
      return { degraded: 6, broken: 10, healerBroken: 5, aliveBroken: 0.5 };
    default:
      return { degraded: 3, broken: 5, healerBroken: 3, aliveBroken: 0.5 };
  }
}

// ═══════════════════════════════════════════════════════════
// §6. SquadMovementIntent — 编队移动意图
// ═══════════════════════════════════════════════════════════

/**
 * 移动模式。
 * - ABSOLUTE: 目标是绝对坐标（如目标房间的某个位置）
 * - OBJECTIVE_RELATIVE: 目标相对于 Objective（如敌方塔位置），可随目标变化重新计算
 */
export type MovementMode = "ABSOLUTE" | "OBJECTIVE_RELATIVE";

/**
 * SquadMovementIntent — Domain 产出的编队移动意图。

 * Tactical 只决定 Intent，Movement 系统负责实际 Path。

 * 数据流：
 *   Tactical Domain
 *     ↓ SquadMovementIntent
 *   Movement Runtime
 *     ↓ PathFinder (Leader Path)
 *     ↓ registerMove (每个成员)
 *   Traffic Manager (tick 末仲裁)
 */
export interface SquadMovementIntent {
  /** 编队 ID。 */
  readonly squadId: string;
  /** 目标 ID。 */
  readonly objectiveId: string;
  /** 编队锚点。 */
  readonly anchor: FormationAnchor;
  /** 目标位置 packed pos。 */
  readonly destination: number;
  /** 目标房间。 */
  readonly destinationRoom: string;
  /** 阵型类型。 */
  readonly formation: FormationType;
  /** 移动模式。 */
  readonly mode: MovementMode;
  /** 优先级（0-100）。 */
  readonly priority: number;
  /** 容忍范围（到达此范围内视为到位）。 */
  readonly tolerance: number;
  /** 决策原因。 */
  readonly reason: string;
  /** 置信度（0-1）。 */
  readonly confidence: number;
  /** 产生 tick。 */
  readonly tick: number;
  /** Formation Slots（每个成员的期望位置）。 */
  readonly slots: readonly FormationSlot[];
  /** 凝聚力指标。 */
  readonly cohesion: CohesionMetric;
}

/**
 * 从 SquadSnapshot + TacticalState 产出 SquadMovementIntent。

 * 这是 Domain 层的核心产出 — Tactical 只决定 Intent，不执行 Path。

 * 决策逻辑：
 *   1. 根据 TacticalState 确定 destination 和 mode
 *   2. 计算 Anchor
 *   3. 根据 Formation 计算 Slots
 *   4. 计算 Cohesion
 *   5. 如果 Cohesion BROKEN → 产出 REGROUP Intent
 *   6. 否则产出 ADVANCE/RETREAT/HOLD Intent

 * 纯函数 — 相同输入必产生相同输出。
 */
export function produceSquadMovementIntent(
  squad: SquadSnapshot,
  tacticalState: TacticalState,
  terrain: TerrainContext,
): SquadMovementIntent {
  // 1. 计算 Anchor
  const anchor = computeSquadAnchor(squad);

  // 2. 确定 destination 和 mode（基于 TacticalState）
  const dest = determineDestination(squad, tacticalState);

  // 3. 计算 Formation Slots
  const slots = computeFormationSlots(anchor, squad.formation, squad.members);

  // 4. 计算 Cohesion
  const cohesion = computeCohesion(squad, anchor, slots);

  // 5. 如果 Cohesion BROKEN/CRITICAL → 产出 REGROUP Intent
  if (cohesion.status === "BROKEN" || cohesion.status === "CRITICAL") {
    return {
      squadId: squad.squadId,
      objectiveId: squad.objectiveId,
      anchor,
      destination: squad.regroupPos,
      destinationRoom: squad.regroupRoom,
      formation: "CLUSTER",
      mode: "ABSOLUTE",
      priority: 90,
      tolerance: 2,
      reason: `cohesion ${cohesion.status} → regroup: ${cohesion.reason}`,
      confidence: 0.8,
      tick: squad.tick,
      slots: computeFormationSlots(anchor, "CLUSTER", squad.members),
      cohesion,
    };
  }

  // 6. 正常 Intent — 基于 TacticalState
  return {
    squadId: squad.squadId,
    objectiveId: squad.objectiveId,
    anchor,
    destination: dest.pos,
    destinationRoom: dest.room,
    formation: squad.formation,
    mode: dest.mode,
    priority: dest.priority,
    tolerance: dest.tolerance,
    reason: `state=${tacticalState}, formation=${squad.formation}, cohesion=${cohesion.status}`,
    confidence: cohesion.status === "INTACT" ? 0.9 : 0.6,
    tick: squad.tick,
    slots,
    cohesion,
  };
}

// ═══════════════════════════════════════════════════════════
// §7. Destination 决策
// ═══════════════════════════════════════════════════════════

/** 目标决策结果。 */
interface DestinationDecision {
  readonly pos: number;
  readonly room: string;
  readonly mode: MovementMode;
  readonly priority: number;
  readonly tolerance: number;
}

/**
 * 根据 TacticalState 确定编队目标。

 * 状态 → 目标映射：
 *   FORMING     → 集结点（ABSOLUTE）
 *   MOVING      → 目标房间中心（OBJECTIVE_RELATIVE）
 *   POSITIONING → 目标位置附近（OBJECTIVE_RELATIVE）
 *   ENGAGING    → 当前位置附近（OBJECTIVE_RELATIVE — 不大范围移动）
 *   DISENGAGING → 远离敌人方向（ABSOLUTE — 朝撤退方向）
 *   RETREATING  → 撤退房间（ABSOLUTE）
 *   REGROUPING  → 集结点（ABSOLUTE）
 *   COMPLETED   → 当前位置（HOLD）
 *   ABORTED     → 撤退房间（ABSOLUTE）
 */
function determineDestination(
  squad: SquadSnapshot,
  state: TacticalState,
): DestinationDecision {
  switch (state) {
    case "FORMING":
      return {
        pos: squad.regroupPos,
        room: squad.regroupRoom,
        mode: "ABSOLUTE",
        priority: 50,
        tolerance: 2,
      };

    case "MOVING":
      // 向目标房间移动 — 目标房间中心 (25,25)
      return {
        pos: 25 * 50 + 25,
        room: squad.targetRoom,
        mode: "OBJECTIVE_RELATIVE",
        priority: 70,
        tolerance: 5,
      };

    case "POSITIONING":
      // 到达目标房，选择战术阵位 — 目标位置附近
      return {
        pos: squad.targetPos ?? 25 * 50 + 25,
        room: squad.targetRoom,
        mode: "OBJECTIVE_RELATIVE",
        priority: 60,
        tolerance: 3,
      };

    case "ENGAGING":
      // 接敌 — 不大范围移动，维持当前位置
      return {
        pos: squad.targetPos ?? 25 * 50 + 25,
        room: squad.targetRoom,
        mode: "OBJECTIVE_RELATIVE",
        priority: 80,
        tolerance: 1,
      };

    case "DISENGAGING":
      // 脱离接触 — 朝撤退方向移动
      return {
        pos: squad.regroupPos,
        room: squad.regroupRoom,
        mode: "ABSOLUTE",
        priority: 75,
        tolerance: 3,
      };

    case "RETREATING":
      // 撤退到安全房
      return {
        pos: 25 * 50 + 25,
        room: squad.retreatRoom,
        mode: "ABSOLUTE",
        priority: 85,
        tolerance: 5,
      };

    case "REGROUPING":
      // 重新集结
      return {
        pos: squad.regroupPos,
        room: squad.regroupRoom,
        mode: "ABSOLUTE",
        priority: 90,
        tolerance: 2,
      };

    case "COMPLETED":
      // 完成 — 原地
      return {
        pos: 25 * 50 + 25,
        room: squad.targetRoom,
        mode: "ABSOLUTE",
        priority: 0,
        tolerance: 50,
      };

    case "ABORTED":
      // 中止 — 撤退
      return {
        pos: 25 * 50 + 25,
        room: squad.retreatRoom,
        mode: "ABSOLUTE",
        priority: 95,
        tolerance: 5,
      };

    default:
      return {
        pos: squad.regroupPos,
        room: squad.regroupRoom,
        mode: "ABSOLUTE",
        priority: 50,
        tolerance: 3,
      };
  }
}

// ═══════════════════════════════════════════════════════════
// §8. Formation Break & Regroup
// ═══════════════════════════════════════════════════════════

/** Formation 退化级别。 */
export type FormationDegradation =
  | "INTACT"           // 阵型完整
  | "DEGRADED"         // 阵型降级
  | "REGROUP_REQUIRED" // 需要重新集结
  | "FORMATION_BROKEN"; // 阵型完全破碎

/**
 * 评估阵型退化级别。

 * 不直接进入 Recovery — 先判断退化级别，由上层决策是否 Regroup。
 */
export function assessFormationDegradation(
  cohesion: CohesionMetric,
  squad: SquadSnapshot,
): FormationDegradation {
  if (cohesion.aliveCount === 0) return "FORMATION_BROKEN";
  if (cohesion.status === "CRITICAL") return "FORMATION_BROKEN";
  if (cohesion.status === "BROKEN") return "REGROUP_REQUIRED";
  if (cohesion.status === "DEGRADED") {
    // 检查 healer 是否分离
    if (cohesion.maxHealerDistance > 5) return "REGROUP_REQUIRED";
    return "DEGRADED";
  }
  return "INTACT";
}

/**
 * 计算 Regroup 点。

 * Regroup 逻辑：
 *   - 如果有存活成员 → 取 Centroid 作为 Regroup 点
 *   - 如果全灭 → 使用预设集结点

 * Regroup 不能自行改变 WarPlan — 只产出集结意图。
 */
export function computeRegroupPoint(
  squad: SquadSnapshot,
  anchor: FormationAnchor,
): { pos: number; room: string; reason: string } {
  const alive = squad.members.filter(m => m.alive);
  if (alive.length === 0) {
    return {
      pos: squad.regroupPos,
      room: squad.regroupRoom,
      reason: "no alive members → preset regroup point",
    };
  }
  // 以当前 Centroid 为 Regroup 点（原地集结）
  return {
    pos: anchor.pos,
    room: anchor.room,
    reason: `regroup at current centroid (${alive.length} alive)`,
  };
}

// ═══════════════════════════════════════════════════════════
// §9. Healer Cohesion — 特殊关系保障
// ═══════════════════════════════════════════════════════════

/**
 * Healer Cohesion 检查 — 确保 Healer 不掉队。

 * Screeps 中 Healer 和 Combat 成员的距离关系是最重要的特殊 case：
 *   - 攻击 Creep 进入敌方 range 时 Healer 必须在治疗范围内（≤3 格 ranged heal）
 *   - Healer 不应落后多个 tile

 * 本阶段只解决「队形移动时 Healer 不掉队」，不实现完整 Heal target 选择算法。
 */
export interface HealerCohesionCheck {
  /** 是否所有 Healer 都在安全范围内。 */
  readonly ok: boolean;
  /** 最差的 Healer 距离。 */
  readonly worstDistance: number;
  /** 需要等待的 Healer 名称列表。 */
  readonly laggingHealers: readonly string[];
  /** 原因。 */
  readonly reason: string;
}

/**
 * 检查 Healer 是否掉队。

 * 判据：每个 Healer 到最近 Combat 成员的距离 ≤ HEALER_SAFE_DISTANCE。
 * 超过则标记为 lagging。
 */
const HEALER_SAFE_DISTANCE = 3; // ranged heal 范围

export function checkHealerCohesion(squad: SquadSnapshot): HealerCohesionCheck {
  const alive = squad.members.filter(m => m.alive);
  const healers = alive.filter(m => m.role === "healer");
  const combatants = alive.filter(m => m.role !== "healer");

  if (healers.length === 0) {
    return { ok: true, worstDistance: 0, laggingHealers: [], reason: "no healers" };
  }
  if (combatants.length === 0) {
    return { ok: true, worstDistance: 0, laggingHealers: [], reason: "no combatants" };
  }

  let worst = 0;
  const lagging: string[] = [];

  for (const h of healers) {
    let minDist = Infinity;
    for (const c of combatants) {
      if (h.room !== c.room) {
        minDist = Math.min(minDist, 50);
      } else {
        minDist = Math.min(minDist, chebyshevDist(h.pos, c.pos));
      }
    }
    if (minDist > worst) worst = minDist;
    if (minDist > HEALER_SAFE_DISTANCE) {
      lagging.push(h.name);
    }
  }

  // 确定性排序
  lagging.sort();

  return {
    ok: lagging.length === 0,
    worstDistance: worst,
    laggingHealers: lagging,
    reason: lagging.length === 0
      ? `all ${healers.length} healers within ${HEALER_SAFE_DISTANCE} tiles`
      : `${lagging.length}/${healers.length} healers lagging (worst=${worst})`,
  };
}

// ═══════════════════════════════════════════════════════════
// §10. Retreat Formation
// ═══════════════════════════════════════════════════════════

/**
 * 撤退阵型决策。

 * 撤退不等于每个 Creep moveTo 安全位置。
 * 必须保护 Healer 和低 HP 成员。

 * 撤退时：
 *   - Anchor = 最慢成员位置（低 HP / Healer）— 确保 Anchor 不跑太快
 *   - Formation = CLUSTER（紧凑保护）
 *   - 前排 = 高 HP Combat 成员（断后）
 *   - 后排 = Healer / 低 HP 成员（优先后撤）

 * 但本阶段不实现复杂 Combat Micro — 只解决阵型保持。
 */
export interface RetreatFormationDecision {
  /** 撤退阵型类型（固定 CLUSTER）。 */
  readonly formation: FormationType;
  /** 撤退 Anchor 位置。 */
  readonly anchorPos: number;
  /** 撤退 Anchor 房间。 */
  readonly anchorRoom: string;
  /** 撤退目标房间。 */
  readonly destinationRoom: string;
  /** 谁先撤（按优先级排序的成员名）。 */
  readonly retreatOrder: readonly string[];
  /** 原因。 */
  readonly reason: string;
}

/**
 * 计算撤退阵型。

 * 撤退优先级：
 *   1. Healer 最先撤（保护治疗能力）
 *   2. 低 HP 成员其次
 *   3. 高 HP Combat 成员最后（断后）
 */
export function computeRetreatFormation(squad: SquadSnapshot): RetreatFormationDecision {
  const alive = squad.members.filter(m => m.alive);

  // 撤退优先级排序：healer → 低 HP → 高 HP
  const retreatOrder = [...alive].sort((a, b) => {
    // Healer 优先
    if (a.role === "healer" && b.role !== "healer") return -1;
    if (a.role !== "healer" && b.role === "healer") return 1;
    // HP 比例低者优先
    const hpA = a.hitsMax > 0 ? a.hits / a.hitsMax : 0;
    const hpB = b.hitsMax > 0 ? b.hits / b.hitsMax : 0;
    if (hpA !== hpB) return hpA - hpB;
    // 确定性 tie-break
    return a.name < b.name ? -1 : 1;
  }).map(m => m.name);

  // Anchor = 最脆弱成员位置（确保撤退速度不超过最慢成员）
  const anchorMember = retreatOrder[0]
    ? alive.find(m => m.name === retreatOrder[0])
    : alive[0];

  if (!anchorMember) {
    return {
      formation: "CLUSTER",
      anchorPos: squad.regroupPos,
      anchorRoom: squad.regroupRoom,
      destinationRoom: squad.retreatRoom,
      retreatOrder: [],
      reason: "no alive members → fallback regroup",
    };
  }

  return {
    formation: "CLUSTER",
    anchorPos: anchorMember.pos,
    anchorRoom: anchorMember.room,
    destinationRoom: squad.retreatRoom,
    retreatOrder,
    reason: `retreat cluster, anchor=${anchorMember.name}(${anchorMember.role}), ${alive.length} alive`,
  };
}

// ═══════════════════════════════════════════════════════════
// §11. Stuck Detection — 编队级卡位
// ═══════════════════════════════════════════════════════════

/** Stuck 级别。 */
export type StuckLevel =
  | "NONE"            // 无卡位
  | "INDIVIDUAL"      // 个别成员卡位
  | "SQUAD_LIGHT"     // 编队轻微卡位（Anchor 未前进但部分成员在动）
  | "SQUAD_HEAVY"     // 编队严重卡位（Anchor 连续多 tick 未前进）
  | "SQUAD_BLOCKED";  // 编队完全阻塞（需要 Replan）

/** 编队卡位检测结果。 */
export interface SquadStuckDetection {
  readonly level: StuckLevel;
  readonly stuckMembers: readonly string[];
  readonly anchorStuckTicks: number;
  readonly reason: string;
}

/**
 * 检测编队级卡位。

 * 区分 Individual Stuck 和 Squad Stuck：
 *   - Individual Stuck：个别成员被挡，不导致整个 Squad 失败
 *   - Squad Stuck：Anchor 连续多 tick 未前进 → 触发 Recovery

 * @param squad 当前快照
 * @param anchor 当前 Anchor
 * @param prevAnchorPos 上 tick Anchor 位置（packed pos）
 * @param prevAnchorTicks 连续未前进 tick 数
 */
export function detectSquadStuck(
  squad: SquadSnapshot,
  anchor: FormationAnchor,
  prevAnchorPos: number | undefined,
  prevAnchorTicks: number,
): SquadStuckDetection {
  // 个别成员卡位检测
  const stuckMembers = squad.members
    .filter(m => m.alive && m.fatigue === 0)
    .filter(m => {
      // 简化：成员位置偏离 DesiredPosition 太远视为 stuck 候选
      // 真正的 individual stuck 检测在 movement 层已有（stuckTicks）
      // 这里只做编队级判断
      return false;
    })
    .map(m => m.name);

  // Anchor 是否前进
  const anchorMoved = prevAnchorPos !== undefined
    && anchor.pos !== prevAnchorPos;

  const anchorStuckTicks = anchorMoved ? 0 : prevAnchorTicks + 1;

  let level: StuckLevel;
  let reason: string;

  if (anchorStuckTicks === 0) {
    level = "NONE";
    reason = "anchor moved this tick";
  } else if (anchorStuckTicks <= 2) {
    level = "INDIVIDUAL";
    reason = `anchor not moving for ${anchorStuckTicks} tick(s) — individual stuck possible`;
  } else if (anchorStuckTicks <= 5) {
    level = "SQUAD_LIGHT";
    reason = `anchor stuck for ${anchorStuckTicks} ticks — squad movement degraded`;
  } else if (anchorStuckTicks <= 10) {
    level = "SQUAD_HEAVY";
    reason = `anchor stuck for ${anchorStuckTicks} ticks — replan needed`;
  } else {
    level = "SQUAD_BLOCKED";
    reason = `anchor stuck for ${anchorStuckTicks} ticks — squad blocked, recovery required`;
  }

  return {
    level,
    stuckMembers,
    anchorStuckTicks,
    reason,
  };
}

// ═══════════════════════════════════════════════════════════
// §12. Determinism — 确定性 Hash
// ═══════════════════════════════════════════════════════════

/**
 * 计算 SquadMovementIntent 的确定性 Hash。

 * 相同 Snapshot → 相同 Intent → 相同 Hash。
 * 用于验证确定性。
 */
export function squadMovementIntentHash(intent: SquadMovementIntent): string {
  const payload = JSON.stringify({
    squadId: intent.squadId,
    objId: intent.objectiveId,
    anchorPos: intent.anchor.pos,
    anchorRoom: intent.anchor.room,
    dest: intent.destination,
    destRoom: intent.destinationRoom,
    formation: intent.formation,
    mode: intent.mode,
    priority: intent.priority,
    tolerance: intent.tolerance,
    tick: intent.tick,
    slotCount: intent.slots.length,
    slotHash: intent.slots.map(s => `${s.creepName}:${s.slotIndex}:${s.desiredPosition}`).join(","),
    cohesionStatus: intent.cohesion.status,
    cohesionMaxDist: intent.cohesion.maxAnchorDistance,
    cohesionAlive: intent.cohesion.aliveCount,
  });
  return fnv1a32Hex(payload);
}

function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════
// §13. 辅助函数
// ═══════════════════════════════════════════════════════════

/** 切比雪夫距离（Screeps 使用的距离公式）。 */
function chebyshevDist(pos1: number, pos2: number): number {
  const x1 = Math.floor(pos1 / 50);
  const y1 = pos1 % 50;
  const x2 = Math.floor(pos2 / 50);
  const y2 = pos2 % 50;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

/**
 * 从 SquadPlan (A5.4.0) + 成员运行时数据构建 SquadSnapshot。

 * 这是系统层薄壳的辅助函数 — 将 A5.4.0 的 SquadPlan 与每 tick 采集的
 * 成员运行时数据合并为 SquadSnapshot。
 */
export function buildSquadSnapshot(
  plan: SquadPlan,
  runtimeMembers: readonly SquadMemberRuntimeSnapshot[],
  tick: number,
  targetRoom: string,
  targetPos?: number,
): SquadSnapshot {
  return {
    squadId: plan.squadId,
    operationId: plan.operationId,
    objectiveId: plan.objectiveId,
    members: runtimeMembers,
    formation: plan.formation,
    state: plan.state,
    tick,
    targetRoom,
    targetPos,
    retreatRoom: plan.retreatPolicy.retreatRoom,
    regroupPos: plan.regroupPolicy.regroupPos,
    regroupRoom: plan.regroupPolicy.regroupRoom,
  };
}