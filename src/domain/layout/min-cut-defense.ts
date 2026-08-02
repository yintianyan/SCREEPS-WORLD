/**
 * Min-Cut 防御规划 — 用最少 rampart 封锁所有入侵路径。
 *
 * 算法：最小顶点割（Minimum Vertex Cut）via 最大流（Edmonds-Karp）。
 *
 * 问题建模：
 *   - 图 G = (V, E)：V = 所有非墙格，E = 8 邻接非墙格之间的边
 *     （正交 4 方向 + 对角线 4 方向；对角线边受切角规则约束——
 *       两个正交角落格都非墙时才连通，模拟 Screeps 切角限制）
 *   - Source 集合 S = 房间出口格（敌人入口）
 *   - Sink 集合 T = 核心区域格（要保护的结构）
 *   - 求：最小的顶点集合 C，使得移除 C 后 S 和 T 不连通
 *   - C 中的格就是防御建筑放置位置（defense-planner 按位置特征分流 wall/rampart）
 *
 * 实现：顶点割 → 边割转换 + Edmonds-Karp 最大流
 *   - 每个顶点 v 拆为 v_in → v_out（容量 1 = 可被切割）
 *   - 相邻顶点 u_out → v_in（容量 INF = 不可切割的边）
 *   - Source 顶点容量 INF（不可切割出口格）
 *   - Sink 顶点容量 INF（不可切割核心格）
 *   - 最大流值 = 最小割大小 = 最少 rampart 数
 *   - 从残余图中提取割集：BFS 从 source 出发，
 *     经过容量 > 0 的边能到达的 v_in 中，
 *     v_in → v_out 边已满载（残余 = 0）的 v 就是割集
 *
 * CPU 成本：
 *   - 图规模：~2000 非墙格 × 2（拆点）= ~4000 节点，~16000 边
 *   - Edmonds-Karp：O(V × E²) 最坏，但实际流值小（通常 < 20）
 *   - 实测：~0.5-2ms（可接受，只在 RCL4 首次规划时执行一次）
 *   - 缓存：结果存入 global heap（`__minCutCache`）+ Memory.rooms[*].minCut，
 *     地形/核心结构不变则不重算（defense-planner.ts 管理）
 *
 * 纯函数 — 不访问 Game/Memory，所有输入通过参数注入。
 */

/**
 * Min-Cut 算法版本戳。
 *
 * 算法语义变更时递增（如修复 SUPER_SOURCE/SINK 冲突、调整割集提取逻辑）。
 * defense-planner 把它拼入缓存 signature，使旧缓存自然失效——
 * 避免部署后仍读取修复前的错误结果。
 *
 * v2: 修复 SUPER_SOURCE/SINK 与 (49,49) 拆点 (in=4998, out=4999) 冲突。
 * v3: 邻接从正交 4 方向扩展为 8 方向 + 切角规则——对角线边仅在两个
 *     正交角落格都非墙时才添加，模拟 Screeps 切角移动限制。
 *     修复盲点：旧 4 邻接图忽略对角线路径，割集可能漏封对角线入侵。
 */
export const MINCUT_ALGO_VERSION = "v3";

/** Min-Cut 计算结果。 */
export interface MinCutResult {
  /** rampart 应放置的位置列表。 */
  readonly rampartPositions: { x: number; y: number }[];
  /** 最小割大小（= rampart 数量）。 */
  readonly cutSize: number;
  /** 是否成功（false = 无法完全封锁或割集过大，需 fallback）。 */
  readonly complete: boolean;
}

/** 图节点 ID 编码：每个格 (x,y) 拆为 in/out 两个节点。 */
function nodeId(x: number, y: number, isOut: boolean): number {
  // 格索引 = x*50+y (0..2499)，in = idx*2, out = idx*2+1
  const idx = x * 50 + y;
  return idx * 2 + (isOut ? 1 : 0);
}

/** 邻接表边。 */
interface Edge {
  to: number;
  cap: number; // 残余容量
  rev: number; // 反向边在 adj[to] 中的索引
}

/** INF 容量（不可切割）。 */
const INF_CAP = 10000;

/**
 * 计算房间的最小割防御线。
 *
 * @param getTerrain 地形查询 (x,y) → 是否墙
 * @param corePositions 核心区域格（要保护的结构位置）
 * @param exitPositions 房间出口格（敌人入口）
 * @param maxRamparts 最大允许 rampart 数（超过则放弃，返回 complete=false）
 */
export function computeMinCutDefense(
  getTerrain: (x: number, y: number) => boolean,
  corePositions: readonly { x: number; y: number }[],
  exitPositions: readonly { x: number; y: number }[],
  maxRamparts = 30,
  /**
   * P2-1：不可放置割集顶点的位置集合（packed = x*50+y）。
   * 这些位置的拆点边容量设为 INF（不可切割），算法自然选其他位置作为割集，
   * 保证生成的割集全部可建造。典型用途：出口格紧邻区域、已有 construction site。
   */
  blockedPositions?: ReadonlySet<number>,
): MinCutResult {
  if (corePositions.length === 0 || exitPositions.length === 0) {
    return { rampartPositions: [], cutSize: 0, complete: false };
  }

  // 1. 标记 source/sink 格
  const coreSet = new Set<number>();
  for (const p of corePositions) coreSet.add(p.x * 50 + p.y);
  const exitSet = new Set<number>();
  for (const p of exitPositions) exitSet.add(p.x * 50 + p.y);

  // 2. 收集所有非墙格（节点）
  const openTiles: { x: number; y: number }[] = [];
  const tileIndex = new Map<number, number>(); // packed → index in openTiles
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (getTerrain(x, y)) continue;
      const packed = x * 50 + y;
      tileIndex.set(packed, openTiles.length);
      openTiles.push({ x, y });
    }
  }

  // nodeCount = 普通格拆点后的节点数（0..4999）。
  // SUPER_SOURCE/SINK 占用 5000/5001，邻接表必须 +2 容量，否则越界写入被
  // typed array 静默丢弃（虽然 adj 是普通数组可自动扩容，但保持显式一致）。
  const nodeCount = 50 * 50 * 2; // 普通格拆点后节点数（不含超级源汇）
  const adj: Edge[][] = Array.from({ length: nodeCount + 2 }, () => []);

  // 添加边的辅助函数
  function addEdge(from: number, to: number, cap: number): void {
    adj[from]!.push({ to, cap, rev: adj[to]!.length });
    adj[to]!.push({ to: from, cap: 0, rev: adj[from]!.length - 1 });
  }

  // 3. 建图：拆点 + 邻接边
  for (const tile of openTiles) {
    const { x, y } = tile;
    const packed = x * 50 + y;
    const vIn = nodeId(x, y, false);
    const vOut = nodeId(x, y, true);

    // 拆点边：v_in → v_out
    // Source/Sink 格容量 INF（不可切割），普通格容量 1
    // P2-1：blockedPositions 中的位置也设为 INF（不可切割），算法选其他位置作为割集。
    const isSource = exitSet.has(packed);
    const isSink = coreSet.has(packed);
    const isBlocked = blockedPositions?.has(packed) ?? false;
    const vertexCap = (isSource || isSink || isBlocked) ? INF_CAP : 1;
    addEdge(vIn, vOut, vertexCap);

    // 邻接边：v_out → neighbor_in
    // v3：8 邻接 — 正交 4 方向（无切角限制）+ 对角线 4 方向（切角规则约束）。
    //
    // 切角规则：对角线 (x,y)→(x+dx,y+dy) 仅在两个正交角落格
    // (x+dx, y) 和 (x, y+dy) 都非墙时才连通。
    // Screeps 不允许穿越两面正交墙形成的对角线，模拟此规则避免割集漏封。
    //   - 两角都非墙 → 对角线可通行（4 邻接也找得到路径，此处只增加捷径边）
    //   - 任一角为墙 → 对角线被封锁（4 邻接本就无此路径，行为一致）
    //   - 两角都墙   → 对角线被封锁（同上）
    // 因此切角规则不会引入 4 邻接没有的连通性，只补全对角捷径——
    // 防止 4 邻接割集在对角捷径处留下可绕行的 1 格缺口。

    // 正交 4 邻接（无切角限制）
    const orthogonal: ReadonlyArray<readonly [number, number]> = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
    ];
    for (const [nx, ny] of orthogonal) {
      if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
      if (getTerrain(nx, ny)) continue;
      addEdge(vOut, nodeId(nx, ny, false), INF_CAP);
    }

    // 对角线 4 邻接（切角规则：两个正交角落格都非墙才连通）
    // [dx, dy] — 对角方向；角落格为 (x+dx, y) 和 (x, y+dy)
    const diagonals: ReadonlyArray<readonly [number, number]> = [
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (const [dx, dy] of diagonals) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
      if (getTerrain(nx, ny)) continue;
      // 切角检查：两个正交角落格都必须非墙
      if (getTerrain(x + dx, y)) continue;
      if (getTerrain(x, y + dy)) continue;
      addEdge(vOut, nodeId(nx, ny, false), INF_CAP);
    }
  }

  // 4. 添加超级 source 和超级 sink
  //
  // 关键：必须使用 nodeCount / nodeCount+1，**不能**使用 nodeCount-2 / nodeCount-1。
  // 因为 nodeId(49, 49, false) = (49*50+49)*2 + 0 = 4998，
  //         nodeId(49, 49, true)  = (49*50+49)*2 + 1 = 4999。
  // 旧实现 SUPER_SOURCE=4998、SUPER_SINK=4999 与 (49,49) 拆点冲突：
  //   - (49,49) 非墙时其拆点边 v_in→v_out 变成 SUPER_SOURCE→SUPER_SINK 的退化直连边
  //   - (49,49) 为出口格时再叠加 SUPER_SOURCE→vOut(=SUPER_SINK) 的 INF 直连边 → maxFlow 爆炸
  //   - 残余图 BFS 被污染 → 割集错误或恒 complete=false
  const SUPER_SOURCE = nodeCount;     // 5000，不与任何格冲突
  const SUPER_SINK = nodeCount + 1;   // 5001

  for (const p of exitPositions) {
    if (getTerrain(p.x, p.y)) continue;
    const vOut = nodeId(p.x, p.y, true);
    addEdge(SUPER_SOURCE, vOut, INF_CAP);
  }
  for (const p of corePositions) {
    if (getTerrain(p.x, p.y)) continue;
    const vIn = nodeId(p.x, p.y, false);
    addEdge(vIn, SUPER_SINK, INF_CAP);
  }

  // 5. Edmonds-Karp 最大流（BFS 增广）
  // 优化：预分配 typed arrays + head pointer queue，避免每次增广重新分配。
  //
  // totalNodes 必须等于 nodeCount + 2（含超级源汇）。若仍用 nodeCount，
  // SUPER_SOURCE=5000 / SUPER_SINK=5001 的越界写入会被 typed array 静默丢弃：
  //   - visited[5000] / visited[5001] 永远是 0
  //   - parent[5000] / parentEdgeIdx[5000] 也是 0（不是 -1）
  //   - bfsQueue[tail++] = SUPER_SOURCE 写入成功但读取时返回 0
  // 后果：BFS 永远找不到 SUPER_SINK → maxFlow 恒 0 → 全部 min-cut 恒 complete=false。
  const totalNodes = nodeCount + 2;
  let maxFlow = 0;

  // 预分配 BFS 工作区（在所有增广间复用，避免反复 GC 压力）。
  const parent = new Int32Array(totalNodes);
  const parentEdgeIdx = new Int32Array(totalNodes);
  const visited = new Uint8Array(totalNodes);
  const bfsQueue = new Int32Array(totalNodes); // 预分配队列容量

  function augment(): boolean {
    // 重置工作区（typed array fill 比 regular array 快）。
    visited.fill(0);
    parent.fill(-1);
    parentEdgeIdx.fill(-1);

    // 使用 head/tail 指针替代 shift()（shift 是 O(N)）。
    let head = 0;
    let tail = 0;
    bfsQueue[tail++] = SUPER_SOURCE;
    visited[SUPER_SOURCE] = 1;

    while (head < tail) {
      const u = bfsQueue[head++]!;
      if (u === SUPER_SINK) break;
      const edges = adj[u]!;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        if (e.cap <= 0 || visited[e.to]) continue;
        visited[e.to] = 1;
        parent[e.to] = u;
        parentEdgeIdx[e.to] = i;
        bfsQueue[tail++] = e.to;
      }
    }

    if (!visited[SUPER_SINK]) return false;

    // 回溯增广（瓶颈 = 1，因为普通顶点容量为 1）
    let v = SUPER_SINK;
    while (v !== SUPER_SOURCE) {
      const u = parent[v]!;
      const ei = parentEdgeIdx[v]!;
      const e = adj[u]![ei]!;
      e.cap -= 1;
      adj[e.to]![e.rev]!.cap += 1;
      v = u;
    }
    maxFlow++;
    return true;
  }

  // 执行增广直到无路径或超过 maxRamparts
  while (maxFlow <= maxRamparts) {
    if (!augment()) break;
  }

  // 6. 提取最小割集
  // 从 SUPER_SOURCE 出发，沿残余容量 > 0 的边 BFS，
  // 找到所有可达的 v_in 节点中，v_in→v_out 边已满载（残余=0）的格。
  if (maxFlow > maxRamparts) {
    return { rampartPositions: [], cutSize: maxFlow, complete: false };
  }

  // 复用预分配的 bfsQueue 和 visited（重置为 reachable）。
  const reachable = visited;
  reachable.fill(0);
  let rHead = 0;
  let rTail = 0;
  bfsQueue[rTail++] = SUPER_SOURCE;
  reachable[SUPER_SOURCE] = 1;
  while (rHead < rTail) {
    const u = bfsQueue[rHead++]!;
    for (const e of adj[u]!) {
      if (e.cap > 0 && !reachable[e.to]) {
        reachable[e.to] = 1;
        bfsQueue[rTail++] = e.to;
      }
    }
  }

  // 割集：v_in 可达但 v_out 不可达的普通格（非 source/sink）
  const rampartPositions: { x: number; y: number }[] = [];
  for (const tile of openTiles) {
    const packed = tile.x * 50 + tile.y;
    if (coreSet.has(packed) || exitSet.has(packed)) continue;
    const vIn = nodeId(tile.x, tile.y, false);
    const vOut = nodeId(tile.x, tile.y, true);
    if (reachable[vIn] && !reachable[vOut]) {
      rampartPositions.push({ x: tile.x, y: tile.y });
    }
  }

  return {
    rampartPositions,
    cutSize: rampartPositions.length,
    complete: rampartPositions.length <= maxRamparts && rampartPositions.length > 0,
  };
}
