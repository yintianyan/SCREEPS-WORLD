# A4.3 Design — Empire Logistics Optimization

> 日期：2026-08-24。阶段：A4.3 — Empire Logistics Optimization。
> 前序：[A4.3 Architecture Audit](A4_3_ARCHITECTURE_AUDIT.md)。
> 方法论：设计基于审计结论，不脱离现有代码架构。每个设计决策标注其审计锚点。

---

## 0. 设计约束（来自审计与 AGENTS.md）

### 0.1 硬约束

1. **不新建第二套 Logistics System** — 扩展现有 Request Pool + assignment-service（审计 §18.2）
2. **不新建 Logistics God Object** — logistics-planner 只规划不执行（审计 §18.2）
3. **不新建第二套 Spawn** — 复用 spawn-manager + queue.ts（审计 §18.2）
4. **不新建第二套 Resource Network** — 复用 SupplyNode/DemandNode/AllocationPolicy（审计 §18.2）
5. **Planner 不执行** — Planner 只输出 Transport Plan，Execution 由现有系统完成（审计 §16）
6. **Supply Contract 作为编排层** — Contract 驱动 Transport Request 生成（审计 §16）
7. **Route 作为一等对象** — 有 ID/Cost/Reliability/Status 的持久化实体（审计 §16）
8. **Delivery Validation 不可绕过** — 不依赖 transfer() 返回值（审计 §16）
9. **纯函数律** — domain 层不引用 Game/Memory/RawMemory（DEP_GRAPH §3-5）
10. **Memory 只存 ID、枚举、少量数字和短 key** — 禁止写入完整路径/历史/运行时索引（MEMORY_ARCHITECTURE）
11. **Planning Frequency 三档** — Event/Dirty Flag/Periodic，禁止每 tick 全量重规划（审计 §18.2）

### 0.2 设计原则

| 原则 | 说明 |
| --- | --- |
| **统一不替换** | 新建统一 Transport Request 模型，但房内/跨房/远矿三种场景通过 `scope` 字段区分，不替换现有 Request Pool |
| **复用不重建** | 51 项已有能力直接复用（审计 §9），36 项缺失能力新建（审计 §10） |
| **渐进式集成** | 纯函数先行 → 系统薄壳接入 → 系统切换，每步可验证 |
| **可观测优先** | 每个模块都有指标输出，Dashboard 消费 |
| **CPU 预算优先** | 所有高频操作有 cache + interval + 降级路径 |

### 0.3 目录结构设计

```
src/domain/logistics/               ← 新建 domain 层（纯函数）
  ├── transport-request.ts           ← 统一 Transport Request 模型
  ├── transport-assignment.ts       ← Transport Assignment 模型
  ├── request-lifecycle.ts          ← Request 生命周期状态机
  ├── demand-batching.ts            ← Demand 聚合
  ├── batch-sizing.ts               ← 动态 Batch Size 计算
  ├── route.ts                       ← Route 一等对象
  ├── route-cache.ts                ← 带失效条件的 Route Cache
  ├── rerouting.ts                  ← Dynamic Rerouting
  ├── reliability.ts                ← Transport Reliability Score
  ├── adaptive-routing.ts            ← Adaptive Routing
  ├── traffic.ts                     ← Traffic Detection + Penalty
  ├── route-suspension.ts            ← Route Suspension / Recovery
  ├── capacity-planning.ts           ← Empire 级运力估算
  ├── hauler-scaling.ts              ← 动态扩缩编
  ├── idle-detection.ts              ← 闲置检测
  ├── delivery-validation.ts         ← 验证实际收到量
  ├── transport-accounting.ts        ← 运输会计
  ├── cargo-loss.ts                  ← Cargo Loss 计算
  ├── death-recovery.ts              ← Hauler Death Recovery
  ├── partial-delivery.ts            ← Partial Delivery → Remaining
  ├── overdelivery.ts                ← Overdelivery Handling
  ├── reservation.ts                 ← Transport Capacity Reservation + TTL
  ├── backpressure.ts                ← Backpressure 机制
  ├── bottleneck.ts                  ← Bottleneck Detection + Chain
  ├── starvation.ts                  ← Starvation Detection
  ├── emergency.ts                   ← Emergency Logistics
  ├── fairness.ts                    ← Fairness Scheduling
  ├── roi.ts                          ← Logistics ROI
  ├── logistics-health.ts            ← Logistics Health
  ├── dashboard.ts                    ← Empire Logistics Dashboard
  ├── planner.ts                     ← Empire Logistics Planner
  └── transport-plan.ts              ← Transport Plan

src/systems/logistics-planner.ts    ← 新建系统层（薄壳，P1, interval=100）
```

---

## 1. Transport Domain Model（Phase 1）

### 1.1 Transport Request 统一模型

**审计锚点**：§2.1 #1「无统一 Transport Request」、§3.1「TransportRequest 最小五字段模型」、§10 #1

**设计决策**：新建 `TransportRequestV2` 作为统一模型，不修改现有 `TransportRequest`（向后兼容）。

```typescript
// src/domain/logistics/transport-request.ts

import type { ResourceType } from "../operation/agenda-item";
import type { RequestScope } from "../assignment/request-pool";

/** Transport Request 状态机十态。 */
export type TransportStatus =
  | "pending"      // 已创建，等待分配
  | "planned"      // 已纳入 Transport Plan，等待 Assignment
  | "assigned"     // 已分配给 hauler/carrier
  | "in_transit"   // 运输中
  | "delivering"   // 到达目的地，正在卸货
  | "delivered"    // 全部送达
  | "partial"      // 部分送达
  | "blocked"      // 路径/资源阻塞
  | "failed"       // 不可恢复失败
  | "cancelled";   // 外部取消

/** Transport Request 统一模型。 */
export interface TransportRequestV2 {
  /** 全局唯一 ID："tr:<scope>:<sourceRoom>:<targetRoom>:<resource>:<seq>"。 */
  requestId: string;
  /** 资源类型。 */
  resource: ResourceType;
  /** 请求总量。 */
  amount: number;
  /** 源信息。 */
  source: TransportEndpoint;
  /** 目标信息。 */
  destination: TransportEndpoint;
  /** 优先级（0=最高 survival / 1=high / 2=normal / 3=low）。 */
  priority: 0 | 1 | 2 | 3;
  /** 请求归属域。 */
  scope: RequestScope;
  /** 截止 tick（超时 → expired/failed）。 */
  deadline: number;
  /** 最小批量（低于此值不分配 hauler）。 */
  minBatch: number;
  /** 最大批量（单次运输上限）。 */
  maxBatch: number;
  /** 当前状态。 */
  status: TransportStatus;
  /** 创建 tick。 */
  createdAt: number;
  /** 最近状态变更 tick。 */
  updatedAt: number;
  /** 来源标识：contract ID / operation ID / logistics-auto。 */
  origin: string;
  /** 可选：路由偏好。 */
  routePreference?: RoutePreference;
}

/** 运输端点（源或目标）。 */
export interface TransportEndpoint {
  /** 房间名。 */
  room: string;
  /** 结构 ID（storage/container/terminal）。 */
  structureId?: string;
  /** 坐标。 */
  pos?: { x: number; y: number };
  /** 端点类型。 */
  type: "storage" | "container" | "terminal" | "spawn" | "extension" | "tower" | "lab" | "factory";
}

/** 路由偏好。 */
export interface RoutePreference {
  /** 是否允许经过 hostile 房间。 */
  allowHostile: boolean;
  /** 最大跳数。 */
  maxHops: number;
  /** 优先路线（已知安全路线 ID 列表）。 */
  preferredRouteIds?: string[];
}
```

**设计理由**：
- 不修改现有 `TransportRequest`（request-pool.ts）——避免破坏 logistics.ts / assignment-service.ts 的现有调用链
- 新模型作为上层统一接口，通过适配器映射到现有执行层
- `scope` 字段复用现有 `RequestScope` 类型（room/empire/operation）
- `origin` 字段追溯来源（Contract ID / Operation ID / logistics 自动生成）

### 1.2 Transport Assignment 模型

**审计锚点**：§2.1 #2「无统一 Transport Assignment」、§10 #2

```typescript
// src/domain/logistics/transport-assignment.ts

import type { ResourceType } from "../operation/agenda-item";
import type { TransportStatus } from "./transport-request";

/** Transport Assignment 状态。 */
export type AssignmentStatus =
  | "assigned"     // 已分配，creep 尚未行动
  | "loading"      // 正在装载
  | "in_transit"   // 运输中
  | "unloading"    // 正在卸货
  | "completed"    // 完成
  | "failed"       // 失败
  | "recycled";    // creep 被回收

/** Transport Assignment。 */
export interface TransportAssignment {
  /** 全局唯一 ID。 */
  assignmentId: string;
  /** 关联的 Transport Request ID。 */
  requestId: string;
  /** 执行 creep 名称。 */
  creepName: string;
  /** 执行角色。 */
  role: "hauler" | "carrier" | "remoteHauler" | "distributor";
  /** 资源类型。 */
  resource: ResourceType;
  /** 分配搬运量。 */
  assignedAmount: number;
  /** 已装载量。 */
  loadedAmount: number;
  /** 已交付量。 */
  deliveredAmount: number;
  /** 损失量（creep 死亡/掉落）。 */
  lostAmount: number;
  /** 路由 ID。 */
  routeId?: string;
  /** 分配 tick。 */
  assignedAt: number;
  /** 最近更新 tick。 */
  updatedAt: number;
  /** 状态。 */
  status: AssignmentStatus;
}
```

**设计理由**：
- Assignment 与 Request 分离——一个 Request 可被多个 Assignment 满足（Multi-Source Fulfillment）
- 追踪 `loadedAmount` / `deliveredAmount` / `lostAmount` 三段（审计 §10 #20 Transport Accounting）
- `routeId` 关联 Route 一等对象（Phase 2）

### 1.3 Request Lifecycle 状态机

**审计锚点**：§3.2「无 PENDING → ASSIGNED → IN_TRANSIT → DELIVERED 状态机」、§10 #3

```typescript
// src/domain/logistics/request-lifecycle.ts

/** 合法状态转换图。 */
const VALID_TRANSITIONS: ReadonlyMap<TransportStatus, ReadonlySet<TransportStatus>> = new Map([
  ["pending",     new Set(["planned", "cancelled"] as const)],
  ["planned",     new Set(["assigned", "cancelled"] as const)],
  ["assigned",    new Set(["in_transit", "blocked", "failed", "cancelled"] as const)],
  ["in_transit",  new Set(["delivering", "blocked", "failed", "cancelled"] as const)],
  ["delivering",  new Set(["delivered", "partial", "failed"] as const)],
  ["delivered",   new Set() as ReadonlySet<TransportStatus>],
  ["partial",     new Set(["planned", "cancelled"] as const)],  // 剩余部分重新规划
  ["blocked",     new Set(["planned", "failed", "cancelled"] as const)],
  ["failed",      new Set() as ReadonlySet<TransportStatus>],
  ["cancelled",   new Set() as ReadonlySet<TransportStatus>],
]);

/** 状态转换纯函数（不可变）。 */
export function transition(
  req: TransportRequestV2,
  to: TransportStatus,
  tick: number,
  reason?: string,
): { req: TransportRequestV2; ok: boolean; reason?: string } {
  const allowed = VALID_TRANSITIONS.get(req.status);
  if (!allowed || !allowed.has(to)) {
    return { req, ok: false, reason: `illegal: ${req.status} → ${to}` };
  }
  return {
    req: { ...req, status: to, updatedAt: tick },
    ok: true,
  };
}
```

**设计理由**：
- 与 Operation 九态状态机（lifecycle.ts）模式一致——纯函数 + 不可变
- `partial` 状态可回到 `planned`——支持 Partial Delivery → Remaining Demand（审计 §10 #17）
- `blocked` 可回到 `planned`——支持重试

### 1.4 Demand Batching

**审计锚点**：§2.1 #5「无 Demand Batching」、§3.1「每源一请求」、§10 #4

```typescript
// src/domain/logistics/demand-batching.ts

/** 批量聚合输入。 */
export interface BatchInput {
  room: string;
  resource: ResourceType;
  demands: readonly { source: TransportEndpoint; amount: number; priority: 0|1|2|3 }[];
}

/**
 * 同房同资源多 Demand 聚合为批量请求。
 * 合并规则：
 *   - 同 destination type 的 demand 合并
 *   - priority 取最高（最小数字）
 *   - amount 求和
 *   - 生成 batchId
 */
export function batchDemands(input: BatchInput): TransportRequestV2[];
```

### 1.5 Batch Sizing

**审计锚点**：§10 #5

```typescript
// src/domain/logistics/batch-sizing.ts

/** Batch Sizing 输入。 */
export interface BatchSizingInput {
  sourceAvailable: number;
  destinationDemand: number;
  haulerCapacity: number;
  travelCost: number;        // 来自 transport-cost.ts
  priority: 0 | 1 | 2 | 3;
  deadline: number;
  currentTick: number;
}

/**
 * 动态 Batch Size 计算。
 * 算法：
 *   - 理论批量 = min(sourceAvailable, destinationDemand)
 *   - 经济批量 = ceil(理论批量 / haulerCapacity) × haulerCapacity（满载优化）
 *   - 紧急批量 = deadline 紧迫时取 minBatch（快速响应）
 *   - 最终批量 = clamp(minBatch, 经济批量, maxBatch)
 */
export function computeBatchSize(input: BatchSizingInput): {
  batchSize: number;
  trips: number;
  reason: string;
};
```

---

## 2. Route Model（Phase 2）

### 2.1 Route 一等对象

**审计锚点**：§2.1 #3「无 Route 一等对象」、§7.2「缺失」、§10 #9

```typescript
// src/domain/logistics/route.ts

/** Route 状态。 */
export type RouteStatus =
  | "active"       // 可用
  | "congested"    // 拥堵
  | "degraded"     // 性能下降
  | "blocked"      // 不可达
  | "suspended"    // 长期不经济，暂停
  | "failed";      // 永久失效

/** Route 一等对象。 */
export interface Route {
  /** 路由 ID："route:<from>:<to>"。 */
  routeId: string;
  /** 源房。 */
  from: string;
  /** 目标房。 */
  to: string;
  /** 路由跳数。 */
  hops: number;
  /** 预估单程 tick 数。 */
  travelTime: number;
  /** 运输成本（来自 transport-cost.ts）。 */
  cost: number;
  /** 风险评分 (0..1, 0=安全)。 */
  risk: number;
  /** 拥堵评分 (0..1, 0=畅通)。 */
  traffic: number;
  /** 可靠性评分 (0..1, 1=最可靠)。 */
  reliability: number;
  /** 状态。 */
  status: RouteStatus;
  /** 最近评估 tick。 */
  lastEvaluated: number;
  /** 历史成功率 (0..1)。 */
  successRate: number;
  /** 历史总运输次数。 */
  totalTrips: number;
  /** 历史失败次数。 */
  failedTrips: number;
  /** 中间房间列表。 */
  via: string[];
}
```

### 2.2 Route Cache 管理

**审计锚点**：§7.1「routeCache 无失效条件」、§10 #10

```typescript
// src/domain/logistics/route-cache.ts

/** Route Cache 失效条件。 */
export interface RouteInvalidationRule {
  /** 道路结构变化（revision 变化）。 */
  structureRevisionChanged: boolean;
  /** 威胁变化（新 hostile 房间）。 */
  threatChanged: boolean;
  /** Route 被标记 blocked。 */
  routeBlocked: boolean;
  /** TTL 到期。 */
  ttlExpired: boolean;
}

/** Route Cache — 带失效条件的路由缓存。 */
export class RouteCache {
  private cache = new Map<string, Route>();
  private lastStructureRevision = new Map<string, number>();
  private lastThreatLevel = new Map<string, number>();

  /** 查询路由。 */
  get(from: string, to: string): Route | undefined;
  /** 更新路由。 */
  set(route: Route): void;
  /** 检查是否需要重新评估。 */
  needsReeval(from: string, to: string, currentRevision: number, currentThreat: number, ttl: number, tick: number): boolean;
  /** 批量清理过期项。 */
  sweep(tick: number, maxAge: number): string[];
}
```

**设计理由**：
- 复用 movement 系统的 `structureRevision` 概念（pathfinding.ts 已有）
- TTL 防永久缓存
- `threatChanged` 接入 intel 系统

### 2.3 Dynamic Rerouting

**审计锚点**：§2.1 #11「无 Route Failure → Rerouting」、§10 #11

```typescript
// src/domain/logistics/rerouting.ts

/**
 * Route A 失效时尝试替代路线。
 * 算法：
 *   1. 查询 routeCache 中所有 from→to 的替代路线
 *   2. 按 reliability × (1 - cost) 排序
 *   3. 选择最优替代路线
 *   4. 无替代 → 返回 undefined（触发 Request blocked）
 */
export function findAlternateRoute(
  cache: RouteCache,
  blocked: Route,
  tick: number,
): Route | undefined;
```

### 2.4 Reliability Score

**审计锚点**：§2.1 #10「无 Transport Reliability Score」、§10 #12

```typescript
// src/domain/logistics/reliability.ts

/** Reliability 输入。 */
export interface ReliabilityInput {
  /** 历史成功率 (0..1)。 */
  successRate: number;
  /** 历史失败次数。 */
  failureCount: number;
  /** 路由风险评分 (0..1)。 */
  routeRisk: number;
  /** 威胁等级 (0..1)。 */
  threatLevel: number;
  /** 拥堵评分 (0..1)。 */
  trafficLevel: number;
  /** Creep 死亡率 (0..1)。 */
  creepDeathRate: number;
  /** 路径失败率 (0..1)。 */
  pathFailureRate: number;
}

/**
 * Transport Reliability Score 计算。
 * 加权平均：successRate(40%) + routeSafety(20%) + threatSafety(15%) + trafficFlow(10%) + creepSurvival(10%) + pathStability(5%)
 * 返回 0..1，1=最可靠。
 */
export function computeReliability(input: ReliabilityInput): number;
```

### 2.5 Adaptive Routing

**审计锚点**：§10 #13

```typescript
// src/domain/logistics/adaptive-routing.ts

/**
 * 根据历史 Success/Failure 动态调整 Route 评分。
 * 可解释（非黑盒 ML）：
 *   - 最近 N 次 trip 成功率 → confidence multiplier
 *   - 连续失败 > 3 → penalty
 *   - 连续成功 > 5 → bonus
 */
export function adaptRouteScore(
  route: Route,
  recentTrips: readonly { success: boolean; tick: number }[],
  tick: number,
): { adjustedReliability: number; reason: string };
```

### 2.6 Traffic Detection

**审计锚点**：§2.1 #14「无 Traffic Detection」、§10 #14

```typescript
// src/domain/logistics/traffic.ts

/**
 * 多 Hauler 共享 Route 检测 + Traffic Penalty。
 * 复用 movement 系统的 recordTraffic() 数据。
 */
export function computeTrafficPenalty(
  routeId: string,
  activeHaulerCount: number,
  routeCapacity: number,
): { penalty: number; congested: boolean };
```

### 2.7 Route Suspension / Recovery

**审计锚点**：§10 #32

```typescript
// src/domain/logistics/route-suspension.ts

/**
 * 长期不经济 → SUSPENDED；条件恢复 → RESUME。
 * 暂停条件：连续 N 次评估 ratio < maintainThreshold
 * 恢复条件：连续 M 次评估 ratio ≥ maintainThreshold 或外部触发
 */
export function evaluateRouteSuspension(
  route: Route,
  efficiencyHistory: readonly number[],
  thresholds: { suspendAfter: number; resumeAfter: number; maintainThreshold: number },
): { action: "suspend" | "resume" | "maintain"; reason: string };
```

---

## 3. Transport Capacity Planning（Phase 3）

### 3.1 Capacity Planning

**审计锚点**：§2.1 #4「无 Transport Capacity Planning」、§3.3「无生产率×往返×运力估算」、§10 #6

```typescript
// src/domain/logistics/capacity-planning.ts

/** 房间级运力需求输入。 */
export interface RoomCapacityInput {
  room: string;
  /** 生产速率（e/tick）。来自 source / remote source。 */
  productionRate: number;
  /** 消费速率（e/tick）。来自 sink（spawn/extension/tower/lab）。 */
  consumptionRate: number;
  /** 本地搬运平均往返 tick 数。 */
  localRoundTripTicks: number;
  /** 跨房搬运平均往返 tick 数（如有）。 */
  crossRoomRoundTripTicks: number;
  /** 单个 hauler carry capacity。 */
  haulerCapacity: number;
  /** 当前 hauler 数量。 */
  currentHaulerCount: number;
  /** 当前 carrier 数量。 */
  currentCarrierCount: number;
}

/** 房间级运力需求输出。 */
export interface RoomCapacityResult {
  room: string;
  /** 所需本地 hauler 数。 */
  requiredHaulers: number;
  /** 所需跨房 carrier 数。 */
  requiredCarriers: number;
  /** 当前运力缺口（正=缺，负=溢）。 */
  haulerGap: number;
  /** 当前运力缺口（正=缺，负=溢）。 */
  carrierGap: number;
  /** 理论运力 (e/tick)。 */
  theoreticalCapacity: number;
  /** 实际运力 (e/tick)。 */
  actualCapacity: number;
  /** 利用率 (0..1)。 */
  utilization: number;
}

/**
 * Empire 级运力估算。
 * 公式：requiredHaulers = ceil(productionRate × roundTripTicks / haulerCapacity)
 * 
 * 与 demand.ts 的区别：
 *   - demand.ts 基于 container 积压信号（被动响应）
 *   - capacity-planning 基于生产率×往返×运力（主动规划）
 */
export function planRoomCapacity(input: RoomCapacityInput): RoomCapacityResult;

/** Empire 级运力汇总。 */
export function planEmpireCapacity(rooms: readonly RoomCapacityInput[]): {
  rooms: RoomCapacityResult[];
  totalRequiredHaulers: number;
  totalRequiredCarriers: number;
  totalHaulerGap: number;
  totalCarrierGap: number;
  empireUtilization: number;
};
```

**设计理由**：
- 公式 `requiredHaulers = ceil(productionRate × roundTripTicks / haulerCapacity)` 是经典运力公式
- `productionRate` 来自 A4.1 的 flow-accounting.ts `productionRate()`
- `roundTripTicks` 来自 transport-cost.ts 的 `estimatedTicks`
- 不替换 demand.ts，而是作为 demand.ts 的**前置输入**——demand.ts 的 container 积压信号仍作为验证/校准

### 3.2 Hauler Scaling

**审计锚点**：§3.3「无 Hauler Overprovisioning 检测」、§10 #7 #8

```typescript
// src/domain/logistics/hauler-scaling.ts

/** Scaling 决策。 */
export type ScalingDecision =
  | { action: "expand"; count: number; reason: string }
  | { action: "shrink"; count: number; reason: string }
  | { action: "maintain"; reason: string };

/**
 * 动态扩缩编决策。
 * 扩编条件：haulergap > 0 且 spawn 有余力
 * 缩编条件：utilization < 0.5 持续 N tick
 */
export function decideHaulerScaling(
  capacity: RoomCapacityResult,
  spawnAvailable: boolean,
  economyPressure: number,
  idleTicks: number,
): ScalingDecision;
```

### 3.3 Idle Detection

**审计锚点**：§10 #24

```typescript
// src/domain/logistics/idle-detection.ts

/** Hauler 闲置检测。 */
export function detectIdleHaulers(
  haulers: readonly { name: string; lastActionTick: number; ticksToLive: number }[],
  currentTick: number,
  idleThreshold: number,
): string[];  // 返回闲置 creep 名称列表
```

---

## 4. Delivery & Recovery（Phase 4）

### 4.1 Delivery Validation

**审计锚点**：§2.1 #6「无 Delivery Validation」、§4.2「carrier 空载推断」、§10 #19

```typescript
// src/domain/logistics/delivery-validation.ts

/** Delivery 验证结果。 */
export interface DeliveryValidationResult {
  verified: boolean;
  actualReceived: number;
  expectedAmount: number;
  shortfall: number;
  overdelivery: number;
  message: string;
}

/**
 * 验证 Destination 实际收到量。
 * 
 * 与 verification.ts 的区别：
 *   - verification.ts 用 storage 增量（间接推断）
 *   - delivery-validation 用 Resource Ledger 直接验证（A4.2 已有）
 * 
 * 验证逻辑：
 *   1. 从 Resource Ledger 读取 destination.resource 的增量
 *   2. 减去其他来源的增量（非本 Assignment 的）
 *   3. 差值 = 本 Assignment 实际交付量
 *   4. 差值 ≥ expectedAmount → verified
 *   5. 差值 < expectedAmount → partial
 */
export function validateDelivery(
  assignment: TransportAssignment,
  destinationBefore: number,
  destinationAfter: number,
  otherContributions: number,
): DeliveryValidationResult;
```

**设计理由**：
- 复用 A4.2 的 Resource Ledger（resource-ledger.ts）作为数据源
- 不依赖 `transfer()` 返回值——审计 §16 关键原则 #6
- 不依赖 carrier 空载推断——审计 §4.2 验证缺陷

### 4.2 Transport Accounting

**审计锚点**：§2.1 #7「无 Transport Accounting」、§10 #20

```typescript
// src/domain/logistics/transport-accounting.ts

/** Transport Accounting — 单 Request 级会计。 */
export interface TransportAccounting {
  requestId: string;
  requested: number;
  assigned: number;
  loaded: number;
  delivered: number;
  lost: number;
  remaining: number;
  cost: number;
  roi: number;  // delivered / cost
}

/** 累加分配量。 */
export function recordAssigned(acc: TransportAccounting, amount: number): TransportAccounting;
/** 累加装载量。 */
export function recordLoaded(acc: TransportAccounting, amount: number): TransportAccounting;
/** 累加交付量。 */
export function recordDelivered(acc: TransportAccounting, amount: number): TransportAccounting;
/** 累加损失量。 */
export function recordLost(acc: TransportAccounting, amount: number): TransportAccounting;
/** 计算剩余量。 */
export function computeRemaining(acc: TransportAccounting): number;
```

**设计理由**：
- 与 flow-accounting.ts（A4.1）模式一致——纯函数 + 不可变
- `cost` 来自 transport-cost.ts
- `roi` = delivered / cost（审计 §10 #31）

### 4.3 Cargo Loss

**审计锚点**：§2.1 #8「无 Hauler Death Cargo Recovery」、§10 #21

```typescript
// src/domain/logistics/cargo-loss.ts

/** Cargo Loss 事件。 */
export interface CargoLossEvent {
  creepName: string;
  assignmentId?: string;
  resourceType: ResourceType;
  cargoAmount: number;
  deathRoom: string;
  deathPos: { x: number; y: number };
  tick: number;
  /** 是否可回收（掉落为 tombstone）。 */
  recoverable: boolean;
}

/**
 * Cargo Loss 计算。
 * Creep 死亡时调用，将 cargo 计入 Resource Accounting。
 */
export function recordCargoLoss(
  acc: TransportAccounting,
  loss: CargoLossEvent,
): TransportAccounting;
```

### 4.4 Death Recovery

**审计锚点**：§10 #22

```typescript
// src/domain/logistics/death-recovery.ts

/** Death Recovery 全链。 */
export interface DeathRecoveryPlan {
  /** 步骤 1: 标记 Assignment 失败。 */
  failAssignmentId: string;
  /** 步骤 2: Cargo Reconciliation（cargo loss 计入 accounting）。 */
  cargoLoss: CargoLossEvent;
  /** 步骤 3: Demand Recalculation（remaining 重新计算）。 */
  remainingDemand: number;
  /** 步骤 4: New Assignment（如有替代 hauler）。 */
  replacementNeeded: boolean;
  /** 步骤 5: Replacement Spawn Request（如需新 hauler）。 */
  spawnRequestNeeded: boolean;
}

/**
 * Hauler Death Recovery 全链。
 * Death → Assignment Failure → Cargo Reconciliation → Demand Recalculation → New Assignment → Replacement Spawn
 */
export function planDeathRecovery(
  deadCreep: { name: string; role: string; assignment?: TransportAssignment },
  tick: number,
): DeathRecoveryPlan;
```

### 4.5 Partial Delivery

**审计锚点**：§2.1 #14「无 Partial Delivery → Remaining」、§10 #17

```typescript
// src/domain/logistics/partial-delivery.ts

/**
 * 交付 < 需求 → 自动生成 Remaining Demand。
 * 返回新的 TransportRequestV2（amount = remaining）。
 */
export function createRemainingRequest(
  original: TransportRequestV2,
  deliveredAmount: number,
  tick: number,
): TransportRequestV2;
```

### 4.6 Overdelivery Handling

**审计锚点**：§10 #18

```typescript
// src/domain/logistics/overdelivery.ts

/**
 * 交付 > 需求 → 重新分配 Excess Resource。
 * 不撤销已交付资源，但记录 excess 供后续 Demand 抵扣。
 */
export function handleOverdelivery(
  request: TransportRequestV2,
  deliveredAmount: number,
  tick: number,
): { excess: number; adjusted: TransportRequestV2 };
```

---

## 5. Planning & Optimization（Phase 5）

### 5.1 Empire Logistics Planner

**审计锚点**：§10 #35

```typescript
// src/domain/logistics/planner.ts

/** Planner 输入。 */
export interface PlannerInput {
  /** 活跃 Supply Contracts。 */
  contracts: readonly SupplyContract[];
  /** 当前 Deficit（来自 Network Snapshot）。 */
  deficits: readonly DemandNode[];
  /** 当前 Surplus（来自 Network Snapshot）。 */
  surpluses: readonly SupplyNode[];
  /** 运力规划。 */
  capacity: EmpireCapacityResult;
  /** 可用路由。 */
  routes: RouteCache;
  /** 威胁评估。 */
  threats: ReadonlyMap<string, number>;
  /** 当前 tick。 */
  tick: number;
}

/** Planner 输出。 */
export interface TransportPlan {
  /** 本周期 Transport Requests。 */
  requests: TransportRequestV2[];
  /** 推荐 Assignments（由系统侧执行）。 */
  assignments: TransportAssignment[];
  /** 推荐 Routes。 */
  routes: Route[];
  /** 预估总成本。 */
  estimatedCost: number;
  /** 预估总运输时间。 */
  estimatedTime: number;
  /** 风险评估。 */
  risk: number;
  /** 预期交付量。 */
  expectedDelivery: number;
  /** 规划 tick。 */
  plannedAt: number;
  /** 规划原因。 */
  reason: string;
}

/**
 * Empire Logistics Planner。
 * 
 * Planner 只规划不执行：
 *   1. 从 Contract 派生 Transport Request（通过 contract-node-bridge）
 *   2. 从 Deficit 派生 Ad-hoc Transport Request
 *   3. 对每个 Request 评估 Route + Cost + Reliability
 *   4. 输出 Transport Plan
 *   5. 系统侧薄壳（logistics-planner.ts）消费 Plan 并执行
 * 
 * 规划频率：Event/Dirty Flag/Periodic 三档
 *   - Event: ReplanEvent 触发（carrier-death, room-lost 等）
 *   - Dirty Flag: Network Snapshot 变化 > 阈值
 *   - Periodic: 每 100 tick（与 agenda-manager 同频）
 */
export function planLogistics(input: PlannerInput): TransportPlan;
```

### 5.2 Transport Capacity Reservation + TTL

**审计锚点**：§2.1 #16「无 Transport Reservation」、§10 #15 #16

```typescript
// src/domain/logistics/reservation.ts

/**
 * Transport Capacity Reservation。
 * 与 operation/reservation.ts 的区别：
 *   - operation/reservation.ts 预留 source 资源量
 *   - logistics/reservation.ts 预留 hauler carry capacity
 */
export interface CapacityReservation {
  reservationId: string;
  requestId: string;
  creepName?: string;
  reservedCapacity: number;
  createdAt: number;
  expiresAt: number;
  lastHeartbeat: number;
}
```

### 5.3 Backpressure

**审计锚点**：§2.1 #12「无 Backpressure」、§10 #25

```typescript
// src/domain/logistics/backpressure.ts

/** Backpressure 信号。 */
export interface BackpressureSignal {
  room: string;
  /** 运力缺口（正=不足）。 */
  capacityGap: number;
  /** 积压量。 */
  backlog: number;
  /** 建议动作。 */
  action: "reduce-production" | "increase-haulers" | "reduce-demand" | "none";
  reason: string;
}

/**
 * Backpressure 机制。
 * Logistics Capacity 不足时向 Resource Planner 反馈。
 * 反馈通道：
 *   1. reduce-production: 远矿 harvester 限采
 *   2. increase-haulers: spawn 额外 hauler
 *   3. reduce-demand: 降低非关键消费（builder/upgrader）
 */
export function evaluateBackpressure(
  capacity: RoomCapacityResult,
  backlog: number,
  tick: number,
): BackpressureSignal;
```

### 5.4 Bottleneck Detection

**审计锚点**：§2.1 #9「无 Logistics Bottleneck Detection」、§10 #26 #27

```typescript
// src/domain/logistics/bottleneck.ts

/** Bottleneck 类型。 */
export type BottleneckType =
  | "production"    // 生产不足
  | "logistics"     // 运力不足
  | "storage"       // 存储不足
  | "consumption"   // 消费不足
  | "spawn";        // spawn 容量不足

/** Bottleneck 检测结果。 */
export interface BottleneckResult {
  room: string;
  type: BottleneckType;
  severity: number;  // 0..1
  /** 瓶颈链：Production → Logistics → Storage → Consumption。 */
  chain: BottleneckChainLink[];
  /** 限制环节。 */
  limitingStep: BottleneckType;
  reason: string;
}

export interface BottleneckChainLink {
  step: BottleneckType;
  rate: number;     // e/tick
  capacity: number; // e/tick
  utilization: number;  // 0..1
}

/**
 * Bottleneck Detection + Chain 分析。
 * 区分 Economic Deficit vs Logistics Deficit。
 */
export function detectBottleneck(
  production: number,
  logistics: number,
  storage: number,
  consumption: number,
  room: string,
): BottleneckResult;
```

### 5.5 Starvation Detection

**审计锚点**：§10 #28

```typescript
// src/domain/logistics/starvation.ts

/**
 * Starvation Detection。
 * 长期缺资源 + Empire 总量足够 = Logistics Failure。
 */
export function detectStarvation(
  room: string,
  deficitDuration: number,
  empireTotalSupply: number,
  empireTotalDemand: number,
  threshold: number,
): { starving: boolean; reason: string };
```

### 5.6 Emergency Logistics

**审计锚点**：§10 #29

```typescript
// src/domain/logistics/emergency.ts

/**
 * Emergency Logistics。
 * 提高 Priority 但不绕过 Resource Network。
 */
export function escalateToEmergency(
  request: TransportRequestV2,
  tick: number,
): TransportRequestV2;
```

### 5.7 Fairness Scheduling

**审计锚点**：§10 #30

```typescript
// src/domain/logistics/fairness.ts

/**
 * Fairness Scheduling。
 * 防高频 Room 永久抢占全部 Logistics。
 * 算法：Weighted Round Robin + Priority Boost
 */
export function applyFairness(
  requests: readonly TransportRequestV2[],
  roomWeights: ReadonlyMap<string, number>,
  recentAllocation: ReadonlyMap<string, number>,
): TransportRequestV2[];
```

### 5.8 Logistics ROI

**审计锚点**：§10 #31

```typescript
// src/domain/logistics/roi.ts

/**
 * Logistics ROI。
 * Resource Value - Transport Cost - Risk Cost = Net Logistics Value
 */
export function computeLogisticsROI(
  deliveredAmount: number,
  resourceValue: number,
  transportCost: number,
  riskCost: number,
): { roi: number; netValue: number; grade: string };
```

---

## 6. Health & Observability（Phase 6）

### 6.1 Logistics Health

**审计锚点**：§2.1 #19「无 Logistics Health」、§10 #33

```typescript
// src/domain/logistics/logistics-health.ts

export type LogisticsHealthLevel =
  | "healthy"     // 运力充足，交付率高
  | "stable"      // 运力匹配，偶有积压
  | "degraded"    // 运力不足，部分积压
  | "congested"   // 路由拥堵，交付延迟
  | "starved"     // 长期缺资源，物流失败
  | "critical";   // 网络崩溃，大量失败

export interface LogisticsHealthResult {
  level: LogisticsHealthLevel;
  score: number;  // 0..1
  deliveryRate: number;  // 0..1
  lossRate: number;      // 0..1
  avgLatency: number;    // ticks
  backlogCount: number;
  bottleneckRoom?: string;
  message: string;
}

/**
 * 与 network-health.ts 的区别：
 *   - network-health 看 supply/demand gap（资源层）
 *   - logistics-health 看 delivery rate / loss / latency（执行层）
 */
export function computeLogisticsHealth(
  accounting: readonly TransportAccounting[],
  activeRequests: readonly TransportRequestV2[],
  avgLatency: number,
  tick: number,
): LogisticsHealthResult;
```

### 6.2 Dashboard

**审计锚点**：§10 #34

```typescript
// src/domain/logistics/dashboard.ts

export interface LogisticsDashboard {
  tick: number;
  // Transport Requests
  totalRequests: number;
  requestsByStatus: Record<string, number>;
  // Transport Assignments
  totalAssignments: number;
  assignmentsByStatus: Record<string, number>;
  // Haulers
  totalHaulers: number;
  totalCarriers: number;
  totalCapacity: number;
  utilizedCapacity: number;
  utilization: number;
  // Routes
  totalRoutes: number;
  routesByStatus: Record<string, number>;
  avgReliability: number;
  // Cost
  totalCost: number;
  totalDelivered: number;
  avgROI: number;
  // Backlog
  backlogRequests: number;
  backlogAmount: number;
  // Delivery
  deliveryRate: number;
  lossRate: number;
  avgLatency: number;
  // Starvation
  starvingRooms: string[];
  // Bottleneck
  bottlenecks: BottleneckResult[];
  // Health
  health: LogisticsHealthResult;
}

export function buildDashboard(
  requests: readonly TransportRequestV2[],
  assignments: readonly TransportAssignment[],
  routes: readonly Route[],
  accounting: readonly TransportAccounting[],
  haulers: readonly { capacity: number; idle: boolean }[],
  bottlenecks: readonly BottleneckResult[],
  health: LogisticsHealthResult,
  tick: number,
): LogisticsDashboard;
```

---

## 7. Integration（Phase 7）

### 7.1 集成策略

**核心原则**：渐进式集成，每步可验证。

| 步骤 | 集成项 | 方式 | 风险 |
| --- | --- | --- | --- |
| 1 | logistics.ts 支持 TransportRequestV2 | 新增 adapter，将 V2 映射为现有 TransportRequest | 🟢 低 |
| 2 | assignment-service.ts 支持跨房 Assignment | 扩展 task type | 🟡 中 |
| 3 | agenda-manager.ts 调用 Contract Bridge | 新增步骤 9.5 | 🟡 中 |
| 4 | agenda-manager.ts 调用 Transport Cost | 在步 14 调用 | 🟢 低 |
| 5 | agenda-manager.ts 调用 Route Efficiency | 在步 15 调用 | 🟢 低 |
| 6 | specialization-planner.ts 驱动 Supply Contract | 新增 contract 创建逻辑 | 🟡 中 |
| 7 | terminal-manager.ts 切换为执行器 | 读取 Network AllocationPlan | 🔴 高 |
| 8 | hauler.ts 支持 Transport Assignment | 新增 memory.assignment 读取 | 🟡 中 |
| 9 | carrier.ts 支持 Transport Assignment + Delivery Validation | 扩展 work 链 | 🟡 中 |
| 10 | remote-hauler.ts 支持 Transport Assignment | 扩展 memory.assignment | 🟡 中 |
| 11 | demand.ts 接入 Capacity Planning | 作为 evaluateDemand 前置输入 | 🟡 中 |
| 12 | empire-economy.ts 接入 Logistics Health | 新增 health 指标 | 🟢 低 |
| 13 | bootstrap.ts 注册 logistics-planner | 新增 System 注册 | 🟢 低 |
| 14 | global.d.ts 扩展 Memory schema | 新增 transportRequests / assignments / routes | 🟡 中 |
| 15 | config.ts 新增 logistics 参数 | 新增 CONFIG.logisticsV2 | 🟢 低 |

### 7.2 Terminal Manager 切换设计

**审计锚点**：§6.1「Terminal Manager 完全独立于 Resource Network」、§11 #3

**当前**：terminal-manager.ts 独立决策 + 独立执行（`terminal.send()`）

**目标**：Terminal 作为 Resource Network 的执行器

```
切换前：
  terminal-manager → planMineralAid() → terminal.send()
  terminal-manager → planEnergyAid() → terminal.send()

切换后：
  Network Snapshot → AllocationPolicy → AllocationPlan(mineral)
  → terminal-manager.executePlan(plan) → terminal.send()
```

**切换步骤**：
1. `terminal-manager.ts` 新增 `executeAllocationPlan(plan: AllocationPlan)` 方法
2. `planMineralAid()` / `planEnergyAid()` 降级为 fallback（当 Network 无 AllocationPlan 时使用）
3. `agenda-manager.ts` 步 12.5 新增 mineral AllocationPolicy 调用
4. `agenda-manager.ts` 步 14.5 新增 terminal 执行调用

### 7.3 Supply Contract 接入设计

**审计锚点**：§4.3「Supply Contract 纯函数完整但系统层断裂」、§11 #4

**当前**：`specialization-planner.ts` 只消费 Remote Opportunity，不驱动 Supply Contract

**目标**：specialization-planner 或 logistics-planner 调用 `bridgeContracts()`

```
接入链：
  specialization-planner → createSupplyContract() → Memory.kernel.supplyContracts
  logistics-planner → loadContracts() → bridgeContracts() → ContractSupplyNode/ContractDemandNode
  → mergeSupplyNodes() / mergeDemandNodes() → AllocationPolicy → AllocationPlan
  → TransportPlan → TransportRequestV2 → Assignment → Hauler/Carrier
```

### 7.4 Memory 迁移设计

**审计锚点**：§12.4 Memory 迁移

```typescript
// global.d.ts 扩展
interface KernelMemory {
  // ... 现有字段 ...

  // A4.3 新增
  /** Transport Requests 瘦快照（只存活跃项）。 */
  transportRequests?: TransportRequestSnapshot[];
  /** Transport Assignments 瘦快照。 */
  transportAssignments?: TransportAssignmentSnapshot[];
  /** Routes 瘦快照。 */
  routes?: RouteSnapshot[];
}
```

**迁移规则**：
- `schemaVersion` 从 39 升至 40
- 迁移幂等：先写新字段验证后删旧字段
- 旧 OperationContext 保持不变——TransportRequestV2 是新增层，不替换 Operation
- TransportRequestV2 的活跃项存入 Memory，终态后归档删除（与 OperationContext 同模式）

### 7.5 CONFIG 扩展

```typescript
// config.ts 扩展
export const CONFIG = {
  // ... 现有 ...

  logisticsV2: {
    /** Transport Request TTL（tick）。 */
    requestTtlTicks: 500,
    /** Assignment 超时（tick）。 */
    assignmentTimeoutTicks: 1000,
    /** Route Cache TTL（tick）。 */
    routeCacheTtl: 500,
    /** Reliability 历史窗口（trip 数）。 */
    reliabilityWindow: 20,
    /** Capacity Planning 间隔（tick）。 */
    capacityPlanningInterval: 100,
    /** Idle 检测阈值（tick）。 */
    idleThreshold: 50,
    /** Starvation 检测阈值（tick）。 */
    starvationThreshold: 1000,
    /** Backpressure 积压阈值。 */
    backpressureBacklogThreshold: 2000,
    /** Fairness 权重衰减。 */
    fairnessDecay: 0.9,
    /** Max Transport Requests（防无限增长）。 */
    maxActiveRequests: 50,
    /** Max Transport Assignments。 */
    maxActiveAssignments: 30,
    /** Batch Sizing 参数。 */
    batchSizing: {
      minBatch: 100,
      maxBatch: 5000,
      emergencyBatch: 50,
    },
    /** Route Suspension 参数。 */
    routeSuspension: {
      suspendAfter: 5,
      resumeAfter: 3,
      maintainThreshold: 2.0,
    },
  },
};
```

---

## 8. 系统层薄壳设计

### 8.1 logistics-planner.ts

```typescript
// src/systems/logistics-planner.ts
// P1, interval=100

export const logisticsPlannerSystem: System = {
  name: "logistics-planner",
  priority: 1,
  interval: 100,
  run(ctx: TickContext): void {
    // 1. 加载 Contracts from Memory
    // 2. 加载 Network Snapshot (from agenda-manager)
    // 3. 加载 Capacity Planning
    // 4. 调用 planLogistics() 纯函数
    // 5. 输出 TransportPlan 到 globalCache().transportPlan
    // 6. 归档终态 Requests/Assignments
  },
};
```

### 8.2 数据流设计

```
每 100 tick:
  logistics-planner (P1, interval=100)
    │
    ├── 读取 Memory.kernel.supplyContracts
    ├── 读取 Memory.kernel.agendas (Operations)
    ├── 读取 Memory.kernel.reservations
    ├── 读取 globalCache().networkSnapshot (from agenda-manager)
    ├── 读取 globalCache().empireCapacity (from capacity-planning)
    │
    ├── planLogistics() [纯函数]
    │   ├── bridgeContracts() → ContractSupplyNode/ContractDemandNode
    │   ├── mergeSupplyNodes() / mergeDemandNodes()
    │   ├── allocateNetwork() → AllocationPlan[]
    │   ├── computeTransportCost() → TransportCostBreakdown
    │   ├── evaluateRouteEfficiency() → RouteEfficiency
    │   ├── planRoomCapacity() → RoomCapacityResult[]
    │   └── 输出 TransportPlan
    │
    └── 写入 globalCache().transportPlan

每 tick:
  logistics (P0, interval=1)
    │
    ├── 读取 globalCache().transportPlan
    ├── 将 V2 Request 映射为现有 TransportRequest (adapter)
    ├── buildTransportRequests() [现有]
    └── 写入 globalCache().transportPool

  assignment-service (P1, interval=1)
    │
    ├── 读取 globalCache().transportPool
    ├── 合并 V2 Assignments
    └── 写入 globalCache().assignment

  hauler/carrier/remoteHauler (P1 角色)
    │
    └── 读取 assignment → 执行
```

---

## 9. Contract Test 设计

### 9.1 Phase 1 — Transport Domain Model 测试

| ID | 测试项 | 覆盖 |
| --- | --- | --- |
| A4.3-001 | TransportRequestV2 创建 + 字段完整性 | requestId/resource/amount/source/destination/priority/scope/deadline/minBatch/maxBatch/status |
| A4.3-002 | TransportAssignment 创建 + 字段完整性 | assignmentId/requestId/creepName/role/assignedAmount/loadedAmount/deliveredAmount/lostAmount |
| A4.3-003 | Request Lifecycle 合法转换 | pending→planned→assigned→in_transit→delivering→delivered |
| A4.3-004 | Request Lifecycle 非法转换拒绝 | pending→delivered (非法) |
| A4.3-005 | Request Lifecycle partial → planned | 部分送达后重新规划 |
| A4.3-006 | Demand Batching 同房聚合 | 同 destination type 的 demand 合并 |
| A4.3-007 | Batch Sizing 满载优化 | ceil(理论批量 / haulerCapacity) × haulerCapacity |
| A4.3-008 | Batch Sizing 紧急模式 | deadline 紧迫时取 minBatch |

### 9.2 Phase 2 — Route Model 测试

| ID | 测试项 |
| --- | --- |
| A4.3-009 | Route 创建 + 字段完整性 |
| A4.3-010 | Route Cache 查询 + 更新 |
| A4.3-011 | Route Cache TTL 失效 |
| A4.3-012 | Route Cache 结构变化失效 |
| A4.3-013 | Dynamic Rerouting 找到替代路线 |
| A4.3-014 | Dynamic Rerouting 无替代返回 undefined |
| A4.3-015 | Reliability Score 计算 |
| A4.3-016 | Adaptive Routing 连续失败 penalty |
| A4.3-017 | Adaptive Routing 连续成功 bonus |
| A4.3-018 | Traffic Penalty 计算 |
| A4.3-019 | Route Suspension 触发 |
| A4.3-020 | Route Recovery 恢复 |

### 9.3 Phase 3 — Capacity Planning 测试

| ID | 测试项 |
| --- | --- |
| A4.3-021 | Room Capacity Planning 公式验证 |
| A4.3-022 | Empire Capacity 汇总 |
| A4.3-023 | Hauler Scaling expand 决策 |
| A4.3-024 | Hauler Scaling shrink 决策 |
| A4.3-025 | Hauler Scaling maintain 决策 |
| A4.3-026 | Idle Detection 检测闲置 hauler |

### 9.4 Phase 4 — Delivery & Recovery 测试

| ID | 测试项 |
| --- | --- |
| A4.3-027 | Delivery Validation 全量送达验证 |
| A4.3-028 | Delivery Validation 部分送达验证 |
| A4.3-029 | Delivery Validation 超量送达验证 |
| A4.3-030 | Transport Accounting 累加链 |
| A4.3-031 | Transport Accounting remaining 计算 |
| A4.3-032 | Cargo Loss 记录 |
| A4.3-033 | Death Recovery 全链 |
| A4.3-034 | Partial Delivery → Remaining Request |
| A4.3-035 | Overdelivery Handling |

### 9.5 Phase 5 — Planning & Optimization 测试

| ID | 测试项 |
| --- | --- |
| A4.3-036 | Planner 从 Contract 派生 Request |
| A4.3-037 | Planner 从 Deficit 派生 Ad-hoc Request |
| A4.3-038 | Planner Route + Cost + Reliability 评估 |
| A4.3-039 | Capacity Reservation + TTL |
| A4.3-040 | Backpressure evaluateBackpressure |
| A4.3-041 | Bottleneck Detection + Chain |
| A4.3-042 | Starvation Detection |
| A4.3-043 | Emergency Logistics |
| A4.3-044 | Fairness Scheduling |
| A4.3-045 | Logistics ROI |

### 9.6 Phase 6 — Health & Observability 测试

| ID | 测试项 |
| --- | --- |
| A4.3-046 | Logistics Health 计算 |
| A4.3-047 | Dashboard 构建 |

### 9.7 E2E 测试

| ID | 场景 |
| --- | --- |
| A4.3-E2E-001 | 单房能量搬运闭环（source→container→hauler→storage） |
| A4.3-E2E-002 | 跨房能量调拨闭环（storage→carrier→storage） |
| A4.3-E2E-003 | 远矿能量搬运闭环（container→remoteHauler→storage） |
| A4.3-E2E-004 | Carrier 死亡 → Cargo Loss → Death Recovery → Replacement |
| A4.3-E2E-005 | Route Blocked → Dynamic Rerouting |
| A4.3-E2E-006 | Partial Delivery → Remaining Request → 完成 |
| A4.3-E2E-007 | Capacity Planning → Hauler Scaling expand |
| A4.3-E2E-008 | Capacity Planning → Hauler Scaling shrink |
| A4.3-E2E-009 | Backpressure → Reduce Production |
| A4.3-E2E-010 | Bottleneck Detection → Logistics Deficit 识别 |
| A4.3-E2E-011 | Supply Contract 驱动 Transport Request |
| A4.3-E2E-012 | Terminal Manager 切换为执行器 |

---

## 10. 实施顺序与优先级

### 10.1 实施优先级（来自审计 §18.3）

```
Phase 1: Transport Domain Model + Route Model        ← 核心基础
Phase 2: Transport Capacity Planning + Hauler Scaling ← 运力闭环
Phase 3: Delivery Validation + Transport Accounting   ← 验证闭环
Phase 4: Supply Contract 接入 + Terminal 切换         ← 集成闭环
Phase 5: Bottleneck + Backpressure + Starvation       ← 诊断闭环
Phase 6: Empire Logistics Planner + Transport Plan    ← 规划闭环
Phase 7: Logistics Health + Dashboard                 ← 可观测性
Phase 8: Testing                                      ← 验证
```

### 10.2 依赖关系图

```
Phase 1 (Domain Model)
  ├── Phase 2 (Route Model) — 依赖 TransportRequestV2.routePreference
  ├── Phase 3 (Capacity) — 依赖 TransportRequestV2 + Route
  └── Phase 4 (Delivery) — 依赖 TransportAssignment

Phase 2 + 3 + 4 → Phase 5 (Planning) — 依赖所有前序
Phase 5 → Phase 6 (Health) — 依赖 Transport Accounting
Phase 6 → Phase 7 (Integration) — 依赖所有纯函数完成
Phase 7 → Phase 8 (Testing) — 依赖集成完成
```

---

## 11. 合规检查清单

> 以下每项在实施完成后必须验证。

| # | 检查项 | 验证方式 |
| --- | --- | --- |
| 1 | 不新建第二套 Logistics System | 确认 logistics.ts 仍只有一个 |
| 2 | 不新建 Logistics God Object | 确认 planner.ts 只规划不执行 |
| 3 | 不新建第二套 Spawn | 确认 spawn-manager 仍唯一 spawnCreep 调用者 |
| 4 | Planner 不执行 | 确认 planner.ts 无 Game/Spawn 调用 |
| 5 | 纯函数律 | 确认 domain/logistics/*.ts 无 Game/Memory import |
| 6 | Memory 只存瘦快照 | 确认 TransportRequestSnapshot 只含 ID+数字+枚举 |
| 7 | Planning 三档频率 | 确认 logistics-planner interval=100 + Event 触发 |
| 8 | Delivery Validation 不依赖 transfer() | 确认用 Resource Ledger 验证 |
| 9 | Route Cache 有失效条件 | 确认 TTL + structureRevision + threat |
| 10 | Cargo Loss 追踪 | 确认 creep 死亡时 cargo 计入 accounting |
| 11 | Supply Contract 接入 | 确认 bridgeContracts() 被调用 |
| 12 | Transport Cost 被调用 | 确认 computeTransportCost() 被 planner 调用 |
| 13 | Route Efficiency 被调用 | 确认 evaluateRouteEfficiency() 被 planner 调用 |
| 14 | Terminal Manager 切换 | 确认 terminal-manager 读取 AllocationPlan |
| 15 | typecheck + test + build 全绿 | `npm run typecheck && npm test && npm run build` |

---

## 12. 设计裁决记录

| # | 裁决 | 决定 | 理由 |
| --- | --- | --- | --- |
| 1 | 修改现有 TransportRequest 还是新建 V2？ | 新建 V2 | 向后兼容，不破坏 logistics.ts / assignment-service.ts 现有调用链 |
| 2 | TransportRequestV2 持久化在哪？ | Memory.kernel.transportRequests | 与 OperationContext 同模式（瘦快照 + 终态归档） |
| 3 | Route 持久化在哪？ | Memory.kernel.routes | 同上 |
| 4 | Planner 频率？ | 100 tick + Event 触发 | 与 agenda-manager 同频，禁止每 tick |
| 5 | Capacity Planning 替换还是补充 demand.ts？ | 补充 | demand.ts 的 container 积压信号作为验证/校准，Capacity Planning 作为前置输入 |
| 6 | Terminal Manager 切换策略？ | 渐进式：先加 executeAllocationPlan，后降级 planMineralAid 为 fallback | 风险控制 |
| 7 | 远矿搬运是否统一到 TransportRequestV2？ | Phase 7 集成阶段统一 | 远矿有独立的 flow-accounting，不急于统一 |
| 8 | 是否实现 Multi-Hop Logistics？ | 延迟到 A5.0+ | 当前架构不需要中继 |
| 9 | Route 是否复用 movement 的 path cache？ | 不复用，新建 Route Cache | movement cache 是 per-creep path，Route Cache 是 per-room-pair route |
| 10 | Delivery Validation 数据源？ | Resource Ledger（A4.2） | 不依赖 transfer() 返回值，不依赖 carrier 空载推断 |

---

**Design 完成。** 下一步：按 Phase 1 顺序实施 Transport Domain Model。
