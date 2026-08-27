/** Failure Propagation */

// ─── 失败节点类型 ──────────────────────────────────────────

/** 失败领域。 */
export type FailureDomain =
  | "energy"
  | "logistics"
  | "spawn"
  | "colony"
  | "network"
  | "threat"
  | "cpu"
  | "remote"
  | "expansion"
  | "terminal"
  | "mineral"
  | "defense";

/** 失败严重度。 */
export type FailureSeverity = "info" | "warning" | "error" | "critical";

/** 单个失败节点。 */
export interface FailureNode {
  /** 唯一标识。 */
  id: string;
  /** 失败领域。 */
  domain: FailureDomain;
  /** 严重度。 */
  severity: FailureSeverity;
  /** 受影响的房间（可选，全局失败为 undefined）。 */
  room?: string;
  /** 人类可读描述。 */
  description: string;
  /** 检测到的 tick。 */
  detectedAt: number;
  /** 是否已被恢复。 */
  resolved?: boolean;
}

// ─── 传播边 ──────────────────────────────────────────────

/** 失败传播方向。 */
export interface FailureEdge {
  /** 源节点 ID（原因）。 */
  from: string;
  /** 目标节点 ID（后果）。 */
  to: string;
  /** 传播延迟（tick，0 = 立即）。 */
  delay: number;
  /** 传播概率（0..1，1 = 必然传播）。 */
  probability: number;
  /** 传播条件描述。 */
  condition: string;
}

// ─── 传播图 ──────────────────────────────────────────────

/** 失败传播图。 */
export interface FailureGraph {
  /** 所有节点。 */
  nodes: FailureNode[];
  /** 所有边。 */
  edges: FailureEdge[];
  /** 采样 tick。 */
  tick: number;
}

// ─── 预定义传播规则 ────────────────────────────────────────

/**
 * 预定义的失败传播规则（领域知识编码）。

 * 这些规则描述了帝国中系统间的因果依赖关系。
 * 每条规则定义：当 A 领域失败时，B 领域在何种条件下也会失败。
 */
const PROPAGATION_RULES: Array<{
  from: FailureDomain;
  to: FailureDomain;
  delay: number;
  probability: number;
  condition: string;
}> = [
  // Hauler 死亡 → 物流中断
  { from: "logistics", to: "colony", delay: 200, probability: 0.8, condition: "hauler death → delivery stops → colony starvation" },
  // 物流中断 → 殖民失败
  { from: "logistics", to: "colony", delay: 500, probability: 0.6, condition: "logistics failure → colony energy deficit" },
  // Spawn 饥饿 → 人口崩溃
  { from: "spawn", to: "colony", delay: 300, probability: 0.9, condition: "spawn starvation → no replacement creeps → population collapse" },
  // 人口崩溃 → 产能下降
  { from: "colony", to: "energy", delay: 100, probability: 0.95, condition: "population collapse → no harvesters → production drop" },
  // 产能下降 → 经济赤字
  { from: "energy", to: "network", delay: 500, probability: 0.7, condition: "production drop → net flow negative → imbalance" },
  // 远矿停滞 → 资源缺口
  { from: "remote", to: "energy", delay: 1000, probability: 0.5, condition: "remote mining stall → remote contribution lost" },
  // 远矿停滞 → 矿物缺口
  { from: "remote", to: "mineral", delay: 1000, probability: 0.4, condition: "remote mining stall → mineral supply lost" },
  // 路由阻断 → 远矿停滞
  { from: "network", to: "remote", delay: 300, probability: 0.6, condition: "route blocked → remote hauler can't deliver" },
  // 威胁 → 远矿停滞
  { from: "threat", to: "remote", delay: 0, probability: 0.9, condition: "hostile → remote ops frozen" },
  // 威胁 → 防御需求增加
  { from: "threat", to: "defense", delay: 0, probability: 1.0, condition: "hostile → defense activated" },
  // CPU 紧张 → 系统降级
  { from: "cpu", to: "logistics", delay: 0, probability: 0.5, condition: "CPU bucket low → logistics planner skipped" },
  { from: "cpu", to: "network", delay: 0, probability: 0.5, condition: "CPU bucket low → agenda manager skipped" },
  { from: "cpu", to: "terminal", delay: 0, probability: 0.7, condition: "CPU bucket low → terminal manager skipped" },
  // Terminal 故障 → 市场交易停止
  { from: "terminal", to: "mineral", delay: 500, probability: 0.3, condition: "terminal unavailable → mineral trading stops" },
  // 扩张失败 → 殖民失败
  { from: "expansion", to: "colony", delay: 0, probability: 0.8, condition: "expansion failed → new colony stalls" },
  // 矿物缺口 → 工厂停止
  { from: "mineral", to: "logistics", delay: 200, probability: 0.2, condition: "mineral deficit → lab/factory demand changes" },
];

// ─── 根因检测结果 ──────────────────────────────────────────

/** 根因检测结果。 */
export interface RootCauseResult {
  /** 症状节点 ID。 */
  symptomId: string;
  /** 根因节点 ID。 */
  rootCauseId: string;
  /** 传播路径（节点 ID 链）。 */
  path: string[];
  /** 路径长度。 */
  depth: number;
  /** 总传播延迟（tick）。 */
  totalDelay: number;
  /** 综合传播概率（路径上所有概率的乘积）。 */
  confidence: number;
  /** 人类可读的因果链。 */
  causalChain: string;
}

// ─── 影响范围分析结果 ──────────────────────────────────────

/** 影响范围分析结果。 */
export interface ImpactAnalysisResult {
  /** 根因节点 ID。 */
  rootCauseId: string;
  /** 所有受影响的节点 ID。 */
  affectedNodes: string[];
  /** 受影响的领域列表。 */
  affectedDomains: FailureDomain[];
  /** 受影响的房间列表。 */
  affectedRooms: string[];
  /** 最大传播深度。 */
  maxDepth: number;
  /** 人类可读的影响范围描述。 */
  impactSummary: string;
}

// ─── 核心函数 ──────────────────────────────────────────────

/**
 * 构建失败传播图（纯函数）。

 * 从当前活跃的失败节点列表 + 预定义传播规则构建有向图。

 * @param activeFailures 当前活跃的失败节点列表
 * @param tick 当前 tick
 * @returns 失败传播图
 */
export function buildFailureGraph(
  activeFailures: readonly FailureNode[],
  tick: number,
): FailureGraph {
  const nodes = [...activeFailures];
  const edges: FailureEdge[] = [];

  // 只为活跃（未解决）的节点构建边
  const activeNodes = nodes.filter(n => !n.resolved);

  for (const rule of PROPAGATION_RULES) {
    // 找到匹配源领域的活跃失败节点
    const sources = activeNodes.filter(n => n.domain === rule.from);
    // 找到匹配目标领域的活跃失败节点
    const targets = activeNodes.filter(n => n.domain === rule.to);

    for (const src of sources) {
      for (const tgt of targets) {
        // 避免自环
        if (src.id === tgt.id) continue;
        // 避免重复边
        if (edges.some(e => e.from === src.id && e.to === tgt.id)) continue;

        edges.push({
          from: src.id,
          to: tgt.id,
          delay: rule.delay,
          probability: rule.probability,
          condition: rule.condition,
        });
      }
    }
  }

  return { nodes, edges, tick };
}

/**
 * 根因检测：从症状节点回溯到根因（纯函数）。

 * 使用反向 BFS：从症状节点出发，沿着传播边的反方向搜索，
 * 找到没有入边的节点（即没有上游原因的节点 = 根因）。

 * 如果有多个根因，选择传播概率乘积最大（最可能）的路径。

 * @param graph 失败传播图
 * @param symptomId 症状节点 ID
 * @returns 根因检测结果
 */
export function detectRootCause(
  graph: FailureGraph,
  symptomId: string,
): RootCauseResult | null {
  const { nodes, edges } = graph;
  const symptomNode = nodes.find(n => n.id === symptomId);
  if (!symptomNode) return null;

  // 反向邻接表：to → [from, edge]
  const reverseAdj = new Map<string, Array<{ from: string; edge: FailureEdge }>>();
  for (const edge of edges) {
    const list = reverseAdj.get(edge.to) ?? [];
    list.push({ from: edge.from, edge });
    reverseAdj.set(edge.to, list);
  }

  // BFS 找所有根因路径
  // 路径 = 从症状到根因的节点链
  const allPaths: Array<{
    path: string[];
    totalDelay: number;
    confidence: number;
  }> = [];

  const queue: Array<{
    currentId: string;
    path: string[];
    totalDelay: number;
    confidence: number;
  }> = [{
    currentId: symptomId,
    path: [symptomId],
    totalDelay: 0,
    confidence: 1,
  }];

  const visited = new Set<string>([symptomId]);

  while (queue.length > 0) {
    const { currentId, path, totalDelay, confidence } = queue.shift()!;

    // 检查是否是根因（没有入边 = 没有上游原因）
    const upstream = reverseAdj.get(currentId);
    if (!upstream || upstream.length === 0) {
      // 这是一个根因
      allPaths.push({ path, totalDelay, confidence });
      continue;
    }

    // 继续向上游搜索
    for (const { from, edge } of upstream) {
      if (visited.has(from)) continue; // 避免环
      visited.add(from);
      queue.push({
        currentId: from,
        path: [from, ...path],
        totalDelay: totalDelay + edge.delay,
        confidence: confidence * edge.probability,
      });
    }
  }

  if (allPaths.length === 0) {
    // 没有上游 → 症状本身就是根因
    return {
      symptomId,
      rootCauseId: symptomId,
      path: [symptomId],
      depth: 0,
      totalDelay: 0,
      confidence: 1,
      causalChain: `${symptomNode.description} (root cause itself)`,
    };
  }

  // 选择置信度最高的路径
  allPaths.sort((a, b) => b.confidence - a.confidence);
  const best = allPaths[0]!;
  const rootNode = nodes.find(n => n.id === best.path[0]);

  // 构建因果链描述
  const chainParts: string[] = [];
  for (let i = 0; i < best.path.length; i++) {
    const node = nodes.find(n => n.id === best.path[i]);
    if (node) {
      chainParts.push(`${node.domain}:${node.severity}`);
    }
  }

  return {
    symptomId,
    rootCauseId: best.path[0]!,
    path: best.path,
    depth: best.path.length - 1,
    totalDelay: best.totalDelay,
    confidence: best.confidence,
    causalChain: chainParts.join(" → "),
  };
}

/**
 * 影响范围分析：从根因正向传播到所有受影响的节点（纯函数）。

 * 使用正向 BFS：从根因节点出发，沿着传播边搜索，
 * 找到所有可能被影响的节点。

 * @param graph 失败传播图
 * @param rootCauseId 根因节点 ID
 * @returns 影响范围分析结果
 */
export function analyzeImpact(
  graph: FailureGraph,
  rootCauseId: string,
): ImpactAnalysisResult | null {
  const { nodes, edges } = graph;
  const rootNode = nodes.find(n => n.id === rootCauseId);
  if (!rootNode) return null;

  // 正向邻接表：from → [to, edge]
  const forwardAdj = new Map<string, Array<{ to: string; edge: FailureEdge }>>();
  for (const edge of edges) {
    const list = forwardAdj.get(edge.from) ?? [];
    list.push({ to: edge.to, edge });
    forwardAdj.set(edge.from, list);
  }

  // BFS
  const affected = new Set<string>([rootCauseId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootCauseId, depth: 0 }];
  let maxDepth = 0;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const downstream = forwardAdj.get(id);
    if (!downstream) continue;

    for (const { to } of downstream) {
      if (affected.has(to)) continue;
      affected.add(to);
      maxDepth = Math.max(maxDepth, depth + 1);
      queue.push({ id: to, depth: depth + 1 });
    }
  }

  // 收集受影响的节点信息
  const affectedNodes = [...affected];
  const affectedNodeObjs = nodes.filter(n => affected.has(n.id));
  const affectedDomains = [...new Set(affectedNodeObjs.map(n => n.domain))];
  const affectedRooms = [...new Set(affectedNodeObjs.filter(n => n.room).map(n => n.room!))];

  const impactSummary = [
    `Impact from ${rootNode.domain}:${rootNode.severity}`,
    `affected=${affectedNodes.length} nodes`,
    `domains=${affectedDomains.join(",")}`,
    `rooms=${affectedRooms.length > 0 ? affectedRooms.join(",") : "global"}`,
    `maxDepth=${maxDepth}`,
  ].join(" | ");

  return {
    rootCauseId,
    affectedNodes,
    affectedDomains,
    affectedRooms,
    maxDepth,
    impactSummary,
  };
}

/**
 * 从失败节点列表中找到所有根因节点（没有上游原因的节点）。

 * @param graph 失败传播图
 * @returns 根因节点列表
 */
export function findRootCauses(graph: FailureGraph): FailureNode[] {
  const { nodes, edges } = graph;

  // 收集所有有入边的节点 ID
  const nodesWithIncoming = new Set<string>();
  for (const edge of edges) {
    nodesWithIncoming.add(edge.to);
  }

  // 根因 = 没有入边的活跃节点
  return nodes.filter(n => !n.resolved && !nodesWithIncoming.has(n.id));
}

/**
 * 从失败节点列表中找到所有叶子节点（症状 = 没有出边的节点）。

 * @param graph 失败传播图
 * @returns 症状节点列表
 */
export function findSymptoms(graph: FailureGraph): FailureNode[] {
  const { nodes, edges } = graph;

  // 收集所有有出边的节点 ID
  const nodesWithOutgoing = new Set<string>();
  for (const edge of edges) {
    nodesWithOutgoing.add(edge.from);
  }

  // 症状 = 没有出边的活跃节点
  return nodes.filter(n => !n.resolved && !nodesWithOutgoing.has(n.id));
}

/**
 * 计算失败图的整体严重度（纯函数）。

 * 综合考虑：
 *   - 节点数量
 *   - 节点严重度
 *   - 传播深度

 * @param graph 失败传播图
 * @returns 0..1 分数（1 = 最严重）
 */
export function computeFailureSeverity(graph: FailureGraph): number {
  const { nodes, edges } = graph;
  const activeNodes = nodes.filter(n => !n.resolved);
  if (activeNodes.length === 0) return 0;

  // 节点严重度权重
  const severityWeight: Record<FailureSeverity, number> = {
    info: 0.1,
    warning: 0.3,
    error: 0.6,
    critical: 1.0,
  };

  // 节点严重度平均
  const avgNodeSeverity = activeNodes.reduce((sum, n) => sum + severityWeight[n.severity], 0) / activeNodes.length;

  // 传播密度（边数 / 可能的最大边数）
  const maxPossibleEdges = activeNodes.length * (activeNodes.length - 1);
  const edgeDensity = maxPossibleEdges > 0 ? edges.length / maxPossibleEdges : 0;

  // 综合：70% 节点严重度 + 30% 传播密度
  return Math.min(1, avgNodeSeverity * 0.7 + edgeDensity * 0.3);
}
