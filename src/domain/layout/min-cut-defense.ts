/**
 * Min-Cut 防御规划 — 用最少 rampart 封锁所有入侵路径。
 * 最小顶点割 via Edmonds-Karp 最大流：V = 非墙格（8 邻接，对角受切角规则约束），
 * S = 房间出口，T = 核心区域，割集 C = rampart 放置位置（defense-planner 按位置特征分流 wall/rampart）。
 * 实现：顶点拆 v_in→v_out（容量 1）+ 超级源汇；CPU 实测 ~0.5-2ms，仅 RCL4 首规划执行；
 * 结果缓存于 global `__minCutCache` + Memory.rooms[*].minCut（defense-planner 管理失效）。
 * 纯函数 — 不访问 Game/Memory，输入全参数注入。
 */

/**
 * Min-Cut 算法版本戳：语义变更时递增，defense-planner 拼入缓存 signature
 * 使旧缓存自然失效，避免部署后读到修复前结果。
 * v2：修复超级源汇与 (49,49) 拆点冲突；v3：4 邻接 → 8 邻接 + 切角规则，
 * 修盲点：旧图忽略对角线路径，割集可能漏封对角线入侵。
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
   * P2-1：不可放置割集顶点的位置（packed x*50+y）— 其拆点边容量 INF（不可切割），
   * 算法自然选其他位置，保证割集全部可建造。典型：出口紧邻区域、已有 site。
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

  // 普通格拆点 0..4999；超级源汇占 5000/5001，邻接表 +2 容量防越界写入被静默丢弃。
  const nodeCount = 50 * 50 * 2; // 普通格拆点节点数（不含超级源汇）
  const adj: Edge[][] = Array.from({ length: nodeCount + 2 }, () => []);

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

    // 拆点边 v_in→v_out：Source/Sink/blocked（P2-1）容量 INF 不可切割，普通格容量 1。
    const isSource = exitSet.has(packed);
    const isSink = coreSet.has(packed);
    const isBlocked = blockedPositions?.has(packed) ?? false;
    const vertexCap = (isSource || isSink || isBlocked) ? INF_CAP : 1;
    addEdge(vIn, vOut, vertexCap);

    // 邻接边 v_out→neighbor_in（容量 INF）。v3：8 邻接 — 对角线仅在两个正交
    // 角落格都非墙时才连通（Screeps 不允许穿两面正交墙的对角），模拟切角限制
    // 防割集漏封；切角规则不引入 4 邻接没有的连通性，只补对角捷径，
    // 防止割集在对角捷径处留 1 格可绕行缺口。

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
    const diagonals: ReadonlyArray<readonly [number, number]> = [
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];
    for (const [dx, dy] of diagonals) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
      if (getTerrain(nx, ny)) continue;
      if (getTerrain(x + dx, y)) continue;
      if (getTerrain(x, y + dy)) continue;
      addEdge(vOut, nodeId(nx, ny, false), INF_CAP);
    }
  }

  // 4. 超级源汇。关键：用 nodeCount/nodeCount+1（5000/5001），不能用 nodeCount-2/-1 —
  // nodeId(49,49,*) 占 4998/4999，旧实现超级源汇与之冲突：退化直连边 → maxFlow 爆炸、
  // 残余图 BFS 被污染 → 割集错误或恒 complete=false。
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

  // 5. Edmonds-Karp 最大流。预分配 typed arrays + head/tail 队列，避免每轮增广重新分配。
  // totalNodes 必须含超级源汇（nodeCount+2）— 越界写入会被 typed array 静默丢弃：
  // visited/parent 恒 0 → BFS 找不到 SUPER_SINK → maxFlow 恒 0 → 恒 complete=false。
  const totalNodes = nodeCount + 2;
  let maxFlow = 0;

  const parent = new Int32Array(totalNodes);
  const parentEdgeIdx = new Int32Array(totalNodes);
  const visited = new Uint8Array(totalNodes);
  const bfsQueue = new Int32Array(totalNodes);

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

  // 6. 提取割集：从 SUPER_SOURCE 沿残余容量 > 0 的边 BFS，可达 v_in 中
  // v_in→v_out 已满载（残余=0）的格即割集。
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
