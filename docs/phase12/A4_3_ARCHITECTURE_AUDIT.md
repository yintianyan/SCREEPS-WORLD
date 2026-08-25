# A4.3 Architecture Audit — Empire Logistics Optimization

> 日期：2026-08-24。阶段：A4.3 — Empire Logistics Optimization。
> 基线：A4.2 Advanced / Multi-Resource Economy 已完成（ResourceType 扩展 + Resource Ledger + Multi-Resource Health + Bottleneck + Reconciliation）。
> 方法论：逐文件追踪真实调用链，不依赖文件名猜测。每个「已有能力」结论标注源码路径与关键函数。

---

## 0. 审计方法论

本审计**逐文件追踪真实调用链**，覆盖以下系统与模块：

### 0.1 前序阶段报告

- A4.0 Architecture Audit（`docs/phase9/A4_0_ARCHITECTURE_AUDIT.md`）
- A4.1 Architecture Audit（`docs/phase10/A4_1_ARCHITECTURE_AUDIT.md`）
- A4.2 Architecture Audit（`docs/phase11/A4_2_ARCHITECTURE_AUDIT.md`）

### 0.2 审计追踪的物流执行链

- Logistics 系统（`src/systems/logistics.ts`）— P0, interval=1
- Assignment Service（`src/systems/assignment-service.ts`）— P1, interval=1
- Request Pool 纯函数（`src/domain/assignment/request-pool.ts`）
- Task Pool（`src/domain/assignment/task-pool.ts`）
- Assignment Service 纯函数（`src/domain/assignment/service.ts`）
- Agenda Manager（`src/systems/agenda-manager.ts`）— P1, interval=100
- Allocation Policy v2（`src/domain/operation/allocation-policy.ts`）
- Supply Node（`src/domain/operation/supply-node.ts`）
- Demand Node（`src/domain/operation/demand-node.ts`）
- Network Snapshot（`src/domain/operation/network-snapshot.ts`）
- Network Health（`src/domain/operation/network-health.ts`）
- Rebalance（`src/domain/operation/rebalance.ts`）
- Reservation（`src/domain/operation/reservation.ts`）
- Operation Context / Agenda Item（`src/domain/operation/agenda-item.ts`）
- Operation Lifecycle（`src/domain/operation/lifecycle.ts`）
- Operation Verification（`src/domain/operation/verification.ts`）
- Operation Dedup（`src/domain/operation/dedup.ts`）
- Operation Metrics（`src/domain/operation/metrics.ts`）
- Replan（`src/domain/operation/replan.ts`）

### 0.3 审计追踪的运输角色

- Hauler（`src/creeps/roles/hauler.ts`）— P1 本房搬运
- Carrier（`src/creeps/roles/carrier.ts`）— P1 跨房调拨
- Remote Hauler（`src/creeps/roles/remote-hauler.ts`）— P1 远矿搬运
- Remote Harvester（`src/creeps/roles/remote-harvester.ts`）— P1 远矿采集
- Distributor（`src/creeps/roles/distributor.ts`）— P1 storage→sink 分发

### 0.4 审计追踪的 Supply Contract / Route 模型

- Supply Contract（`src/domain/economy/supply-contract.ts`）
- Contract Lifecycle（`src/domain/economy/contract-lifecycle.ts`）
- Contract-Node Bridge（`src/domain/economy/contract-node-bridge.ts`）
- Transport Cost（`src/domain/economy/transport-cost.ts`）
- Route Efficiency（`src/domain/economy/route-efficiency.ts`）

### 0.5 审计追踪的 Spawn / Population / Movement

- Spawn Manager（`src/systems/spawn-manager.ts`）— P0, interval=1
- Spawn Queue（`src/domain/spawn/queue.ts`）
- Spawn Demand（`src/domain/spawn/demand.ts`）
- Bodies（`src/config/bodies.ts`）
- Pathfinding（`src/creeps/movement/pathfinding.ts`）
- Stuck Recovery（`src/creeps/movement/stuck-recovery.ts`）
- Traffic Manager（`src/systems/traffic-manager.ts`）
- Movement Intent（`src/creeps/movement/intent.ts`）

### 0.6 审计追踪的 A4.0-A4.2 经济层

- Empire Economy（`src/systems/empire-economy.ts`）— P1, interval=100
- Empire Strategy（`src/systems/empire-strategy.ts`）
- Specialization Planner（`src/systems/specialization-planner.ts`）— P1, interval=100
- Empire Balance（`src/domain/strategy/empire-balance.ts`）
- Economic Health（`src/domain/strategy/economic-health.ts`）
- Resource View（`src/domain/strategy/resource-view.ts`）
- Room Profile（`src/domain/economy/room-profile.ts`）
- Accounting（`src/domain/economy/accounting.ts`）
- Remote Mining Manager（`src/systems/remote-mining-manager.ts`）
- Remote Flow Accounting（`src/domain/remote/flow-accounting.ts`）
- Remote Economic Accounting（`src/domain/remote/economic-accounting.ts`）
- Remote Mining Op（`src/domain/operation/remote-mining-op.ts`）
- Terminal Manager（`src/systems/terminal-manager.ts`）
- Bootstrap（`src/bootstrap.ts`）

---

## 1. 当前物流真实调用链全景

### 1.1 房内物流链（每 tick 执行）

```
logistics.ts (P0, interval=1)
  │
  ├── 遍历 ctx.snapshots()
  │   ├── 采集 SupplySource（含能非 controller container）
  │   ├── 采集塔饥渴信号（towerStarving）
  │   ├── 采集 creep 租约（hauler assignment 投影）
  │   │
  │   ├── buildTransportRequests() [request-pool.ts 纯函数]
  │   │   → TransportRequest[] { key, resource:"energy", amount, sourceId, pos, priority }
  │   │   ├── 防超卖：supplyLedger() 递减 activeLeases
  │   │   ├── 每源并发上限：maxConcurrentPerSource=1
  │   │   └── 塔饥渴提级：priority = boostedPriority
  │   │
  │   ├── applyShrink() — 经济风险缓冲低于地板时只保 P0/P1
  │   ├── reconcileRegistry() — TTL 过期回执 + 失联清理
  │   ├── promoteAged() — 饥饿老化提级（P2/P3 → P1/P0，一次性）
  │   └── 写入 globalCache().transportPool.rooms[roomName]
  │
  └── 不做：跨房调拨（carrier 独立链）、持久化 Memory、全量重匹配

assignment-service.ts (P1, interval=1)
  │
  ├── collectAllCreepRefs() — O(M) 一次遍历全部 Game.creeps
  ├── 遍历 ctx.snapshots()
  │   ├── buildRoomTasks() [service.ts 纯函数]
  │   │   → 生成 source/build/repair/fill 等 AssignmentTaskEntry
  │   ├── 合并 transportPool 任务 → tasks.push(transport)
  │   ├── tasks.sort((a,b) => a.priority - b.priority)
  │   └── pool.setRoomTasks(roomName, tasks)
  │
  ├── 紧急抢占：isEmergencyState → invalidateAssignments (priority >= 1)
  ├── Storage 优先：RCL4+ 无 storage → releaseNonStorageBuilderAssignments
  └── 输出 globalCache().assignment = { tick, pool }

hauler.ts (P1 角色)
  │
  ├── gate: haulerGate — acquire 途中有余量 + 顺路经 storage → 顺手卸能
  ├── onFlee: haulerOnFlee — 防御圈内安全充能
  │
  ├── acquire 链：
  │   0. withdrawStorageLink() — 排空 storage link（link 物流最后一公里）
  │   1. lootRemains(lootThreshold) — 大额遗留能量
  │   1.5 pickupDroppedEnergy(lootThreshold)
  │   2. withdrawTerminalEnergy() — 无市场时 terminal 死能量回流
  │   3. withdrawAssignmentContainer() — 任务驱动的 container
  │   4. withdrawRichestCapped() — 最满非 controller container
  │   5. haulMineralTopUp() — 矿物补仓
  │   6. lootRemains(1) + pickupDroppedEnergy() — 零头兜底
  │
  └── work 链：
      0. haulMineralsToStorage() — 倒已携带矿物
      1. fillStorage() — 优先填 storage
      2. haulFillTarget() — spawn/extension 紧急回退
      3. haulMineralTopUp() — 能量入库后矿物补仓
      4. supplyLabs() — 化合物供料
```

### 1.2 跨房调拨链（每 100 tick 执行）

```
agenda-manager.ts (P1, interval=100)
  │
  ├── 步 0: 加载 Operations + Reservations
  ├── 步 1: 处理 pending ReplanEvents
  ├── 步 2: 超时检查 checkExpiry()
  ├── 步 3: Reservation TTL 清扫 sweepExpired()
  ├── 步 4: verifying Operation 检查
  ├── 步 5: blocked Operation 重试 retryFromBlocked()
  │
  ├── 步 6: 构建 RoomEconomicProfile[]（全房快照）
  ├── 步 7: computeTransferableBulk() — 各房可调拨量
  ├── 步 8: 构建 RoomRegistry（makeRegistryEntry）
  ├── 步 9: buildSupplyNodes() + buildDemandNodes()
  │   ⚠️ 两者都硬编码 resource: "energy"
  │
  ├── 步 10: buildNetworkSnapshot()
  ├── 步 11: decideRebalance() — debounce(50t) + cooldown(200t)
  │
  ├── 步 12: allocateNetwork() — 7 因子可解释分配
  │   ├── scoreDemand: Criticality(40%) + Priority(20%) + Remaining(15%) + Deadline(10%) + Starvation(10%) + Health(5%)
  │   ├── scoreSupplyForDemand: Transferable(30%) + Distance(25%) + Health(20%) + Safety(15%) + Priority(10%)
  │   ├── TOCTOU 防护：本地 Map 递减
  │   ├── Operation Storm：MAX_GLOBAL=20, MAX_PER_SOURCE=3, MAX_PER_TARGET=3
  │   └── MIN_TRANSFER_AMOUNT=1000
  │
  ├── 步 13: 创建 Operation + Reservation（TOCTOU 递减）
  │   ├── createOperation(type="supply", resource="energy")
  │   ├── createReservation()
  │   └── 幂等去重 hasActiveOperation()
  │
  ├── 步 14: 路由计算 + carrier spawn
  │   ├── computeRoute() — Game.map.findRoute + heap cache
  │   ├── submitCarrierSpawn() — spawn/queue.ts
  │   │   → SpawnRequest { key:"carrier:${opId}", role:"carrier", body:selectBody("carrier") }
  │   └── markRunning()
  │
  ├── 步 15: 验证 running Operation
  │   ├── hasCarrierForOp() — 检查 carrier 存活
  │   ├── carrier 到达 target + 空载 → reportDelivery()
  │   ├── deliveredAmount >= requestedAmount → markCompleted
  │   └── 部分送达 → markVerifying
  │
  ├── 步 16: pruneTerminal() — 归档终态 Operation
  ├── 步 17: buildNetworkSnapshot + computeNetworkHealth
  └── 步 18: saveOperations + saveReservations → Memory.kernel.agendas/reservations

carrier.ts (P1 角色)
  │
  ├── gate: carrierGate — 满载→work, 空载→acquire
  ├── ensureHome: acquire→home(sourceRoom), work→remoteTarget
  │
  ├── acquire: withdrawSourceStorage()
  │   → 从 home 房 storage 取能
  │
  └── work: transferTargetStorage()
      → 在 target 房 storage 卸能
```

### 1.3 远矿搬运链（每 10 tick 评估 + 每 tick 执行）

```
remote-mining-manager.ts (P2, interval=10)
  │
  ├── maintainExistingOps() — 检测/止损/重估
  ├── selectRemoteTargets() — targeting.ts 纯函数
  │   └── scoreRemoteCandidate() → netScore = throughput - upkeep
  ├── evaluateRemoteDemand() — demand.ts 纯函数
  │   └── remoteHauler: haulerNeed (动态), P1
  └── submitRequest() → spawn/queue.ts

remote-hauler.ts (P1 角色)
  │
  ├── ensureHome: acquire→remoteTarget, work→home
  │
  ├── acquire: withdrawRemoteContainer() + pickupRemoteDropped()
  │   → 在远矿房 container/dropped 取能
  │
  └── work: fillStorage() + haulFillTarget()
      → 在 home 房 storage/sink 卸能
```

### 1.4 Terminal 互济链（每 200 tick 执行）

```
terminal-manager.ts (P3, interval=200)
  │
  ├── tryEmpireMineralAid() — planMineralAid() 纯函数
  │   ⚠️ 独立于 Resource Network / SupplyNode / DemandNode
  │   → terminal.send(mineral, amount, to)
  │
  ├── tryEnergyAid() — planEnergyAid() 纯函数
  │   ⚠️ 独立于 agenda-manager 的 Operation
  │   → terminal.send(RESOURCE_ENERGY, amount, to)
  │
  ├── trySellHomeMineral() / trySellSurplusBattery() / trySellCommodity()
  │   → Game.market.deal()
  │
  └── tryBuyMineralDeficits() / tryBuyPower()
      → Game.market.deal()
```

---

## 2. 核心发现：三套独立运输系统

### 2.1 三套运输系统并存

| # | 运输系统 | 执行者 | 驱动源 | 资源类型 | 跨房能力 |
| --- | --- | --- | --- | --- | --- |
| 1 | **房内物流** | hauler + distributor | logistics → request-pool → assignment-service | energy only | ❌ |
| 2 | **跨房调拨** | carrier | agenda-manager → allocation-policy → operation | energy only | ✅ (storage→storage) |
| 3 | **远矿搬运** | remoteHauler | remote-mining-manager → demand.ts | energy only | ✅ (container→storage) |
| 4 | **Terminal 互济** | terminal (API) | terminal-manager → planMineralAid/planEnergyAid | energy + minerals | ✅ (terminal→terminal) |

### 2.2 关键问题

| # | 问题 | 严重度 | 说明 |
| --- | --- | --- | --- |
| 1 | **无统一 Transport Request** | 🔴 高 | 房内用 `TransportRequest`(request-pool.ts)，跨房用 `OperationContext`(agenda-item.ts)，远矿用 `RemoteOp`(Memory)，Terminal 用 `MineralAidPlan` — 四套数据模型 |
| 2 | **无统一 Transport Assignment** | 🔴 高 | 房内走 assignment-service TaskPool，跨房走 carrier memory.assignment，远矿走 remoteHauler memory.remoteTarget — 三套分配机制 |
| 3 | **无 Route 一等对象** | 🟡 中 | agenda-manager 有 `routeCache` (heap Map)，pathfinding 有 `__interRoomCache`，但无正式 Route 数据模型 |
| 4 | **无 Transport Capacity Planning** | 🔴 高 | hauler 数量由 container 积压信号驱动（demand.ts），carrier 由 Operation 驱动，无 Empire 级运输能力估算 |
| 5 | **无 Demand Batching** | 🟡 中 | 每个 source container 生成一个 TransportRequest，跨房每个 DemandNode 生成一个 Operation — 无批量聚合 |
| 6 | **无 Delivery Validation** | 🟡 中 | carrier 验证靠「空载=卸完」推断，不验证 target storage 实际收到量 |
| 7 | **无 Transport Accounting** | 🟡 中 | Operation 追踪 requestedAmount/deliveredAmount，但不追踪 loaded/lost/remaining |
| 8 | **无 Hauler Death Cargo Recovery** | 🟡 中 | hauler 死亡后 cargo 凭空消失，不回补 Demand |
| 9 | **无 Logistics Bottleneck Detection** | 🔴 高 | 无法区分 Economic Deficit vs Logistics Deficit |
| 10 | **无 Transport Reliability Score** | 🟡 中 | 无历史成功率/失败率追踪 |
| 11 | **无 Route Failure → Rerouting** | 🟡 中 | routeCache 不可达后 markBlocked，但不尝试替代路线 |
| 12 | **无 Backpressure 机制** | 🟡 中 | Logistics capacity 不足时不向 Resource Planner 反馈 |
| 13 | **Terminal Manager 独立于 Network** | 🟡 中 | A4.2 已标记为 A4.3 切换目标 |
| 14 | **无 Partial Delivery → Remaining** | 🟡 中 | 部分送达后 markVerifying，但不自动生成剩余需求 |
| 15 | **无 Priority Aging** | 🟢 低 | request-pool 有 `promoteAged()` 但只作用于 P2/P3，跨房 Operation 无老化 |
| 16 | **无 Transport Reservation** | 🟡 中 | Reservation 只锁 source 可调拨量，不预留 hauler capacity |
| 17 | **ResourceType 硬编码 energy** | 🟡 中 | request-pool.ts `resource: "energy"` 硬编码；supply-node/demand-node 同 |
| 18 | **无 Fairness Scheduling** | 🟢 低 | 高频 Room 可永久抢占全部 carrier |
| 19 | **无 Logistics Health** | 🟡 中 | 有 NetworkHealth 但只看 supply/demand gap，不看 delivery rate / loss / starvation |
| 20 | **无 Logistics ROI** | 🟡 中 | route-efficiency.ts 有 Delivered/Cost 比率但无人调用 |

---

## 3. 房内物流审计

### 3.1 TransportRequest（request-pool.ts）

当前 `TransportRequest` 是**最小五字段模型**：

```typescript
interface TransportRequest {
  key: string;           // "collect:<room>:<containerId>"
  resource: "energy";    // ⚠️ 硬编码
  amount: number;
  sourceId?: string;
  pos?: { x: number; y: number };
  priority: 0 | 1 | 2 | 3;
  scope?: RequestScope;  // "room" | "empire" | "operation"
  targetRoom?: string;
}
```

**缺失字段**（A4.3 需要）：
- `requestId` — 当前用 `key` 代替，但 key 是 source 维度不是 request 维度
- `destination` — 只有 source，目标隐含为「最近的 sink」
- `deadline` — 无
- `minBatch` / `maxBatch` — 无，每源一请求
- `status` — 无生命周期（PENDING/ASSIGNED/IN_TRANSIT/DELIVERED...）
- `routePreference` — 无
- `createdAt` — 在 RegistryEntry 上有 firstSeen，但不在 request 上

### 3.2 Request Pool 生命周期

```
每 tick:
  buildTransportRequests() → 新 TransportRequest[]
  reconcileRegistry() → 登记新 key / 过期回执 / 清失联
  applyShrink() → 经济风险时只保 P0/P1
  promoteAged() → P2/P3 饥饿老化提级（一次性）
  → 写入 globalCache().transportPool

  ⚠️ 无 PENDING → ASSIGNED → IN_TRANSIT → DELIVERED 状态机
  ⚠️ 认领 = RegistryEntry.claimed = true（仅标记，无状态流转）
  ⚠️ 完成后 key 自然消失（源空/被消费）— 无显式 DELIVERED 状态
  ⚠️ 无 Partial Delivery — 要么全搬要么不搬
```

### 3.3 Hauler Demand 评估

`demand.ts::evaluateDemand()` 中的 hauler 编制：

```
信号源：
  1. container 积压（fillRatio > 0.8 → +2, > 0.4 → +1）
  2. storage link 积压（同上）
  3. 排除有 source link 的 container（link 化后容器满是背压不是缺人）

运力归一化：
  dynamicHaulerTarget = ceil(dynamicHaulerTarget × referenceCarryCapacity / carryPerHauler)

约束：
  minCount ≤ dynamicHaulerTarget ≤ maxCount
  economyPressure > 0.6 时线性衰减
  inCrisis && !liquidityDriven → 缩到 minCount

⚠️ 无 Transport Capacity Planning — 不估算「生产率 × 往返时间 / 单体运力」
⚠️ 无 Hauler Overprovisioning 检测 — 只看积压信号，不看闲置率
⚠️ 无跨房运力统一计算 — hauler 只看本房 container，carrier 由 Operation 驱动
```

### 3.4 结论

| 维度 | 状态 |
| --- | --- |
| TransportRequest 模型完整？ | ❌ 缺少 destination/status/deadline/batch 字段 |
| Request 生命周期完整？ | ❌ 无状态机，只有 firstSeen/claimed 标记 |
| Demand Batching？ | ❌ 每源一请求，无聚合 |
| Transport Capacity Planning？ | ❌ 只有积压信号驱动，无生产率×往返×运力估算 |
| Hauler Scaling？ | ⚠️ 有动态编制但基于积压信号，非 capacity planning |
| Hauler Overprovisioning？ | ❌ 无闲置率检测，无缩减机制 |
| Delivery Validation？ | ❌ 无显式验证，transfer() 成功即认为完成 |
| Partial Delivery？ | ❌ 不支持 |

---

## 4. 跨房调拨审计

### 4.1 Operation 生命周期（agenda-item.ts）

当前 `OperationContext` 九态状态机：

```
planned → ready → running → verifying → completed
                    ↓         ↓
                blocked    failed
                    ↓
                cancelled / expired
```

**已有能力**：
- ✅ 完整九态状态机
- ✅ 幂等去重 `hasActiveOperation()`
- ✅ TOCTOU 防护（本地 Map 递减）
- ✅ Operation Storm 防护（MAX_GLOBAL=20, MAX_PER_SOURCE=3, MAX_PER_TARGET=3）
- ✅ 超时检查 `checkExpiry()`
- ✅ Blocked 重试 `retryFromBlocked()`
- ✅ Delivery 报告 `reportDelivery()`
- ✅ 部分完成 `shouldPartialComplete()`
- ✅ 终态归档 `pruneTerminal()` + `TERMINAL_RETENTION`

**缺失能力**：
- ❌ 无 Transport Assignment — carrier 只是 `memory.assignment = { id: opId, kind: "carrier" }`
- ❌ 无 Route 对象 — `computeRoute()` 只返回 `{ hops, reachable }`
- ❌ 无 Route Cache 失效条件 — heap cache 永不失效（除非 global reset）
- ❌ 无 Dynamic Rerouting — route 不可达后直接 markBlocked
- ❌ 无 Transport Cost 计算 — `transport-cost.ts` 存在但从未被 agenda-manager 调用
- ❌ 无 Route Efficiency 评估 — `route-efficiency.ts` 存在但从未被调用
- ❌ 无 Transport Accounting — 只追踪 requestedAmount/deliveredAmount，不追踪 loaded/lost/remaining
- ❌ 无 Cargo Loss 追踪 — carrier 死亡后 cargo 凭空消失
- ❌ 无 Deadline — 只有 `DEFAULT_OPERATION_DEADLINE = 2000` 硬编码
- ❌ 无 Priority Aging — Operation priority 不随时间提升
- ❌ 无 Fairness — 高频 Room 可永久抢占全部 Operation 配额

### 4.2 Carrier 验证机制

```
验证逻辑（agenda-manager.ts 步 15）：
  1. hasCarrierForOp(op) — carrier 存活或 spawn queue 中有请求
  2. carrier.room.name === op.targetRoom — 到达目标房
  3. carrier.store.getUsedCapacity(RESOURCE_ENERGY) === 0 — 空载
  4. → 推断：carrierCapacity = carrier.store.getCapacity()
  5. → reportDelivery(op, carrierCapacity, tick)
  6. → deliveredAmount >= requestedAmount → completed

⚠️ 验证缺陷：
  - 不验证 target storage 实际收到量（用 carrier 容量推断）
  - 不验证 transfer() 是否成功（只看空载）
  - carrier 可能在路上掉能（被攻击/decay），空载不等于交付
  - 多 carrier 服务同一 Operation 时不区分各自交付量
```

### 4.3 Supply Contract 状态

Supply Contract 纯函数层**完整**但**系统层未接入**：

| 能力 | 纯函数 | 系统调用 | 状态 |
| --- | --- | --- | --- |
| Supply Contract Model | ✅ `supply-contract.ts` | ❌ 无人创建 Contract | 断裂 |
| Contract Lifecycle | ✅ `contract-lifecycle.ts` | ❌ 无人驱动状态转换 | 断裂 |
| Contract-Node Bridge | ✅ `contract-node-bridge.ts` | ❌ 无人调用 `bridgeContracts()` | 断裂 |
| Transport Cost | ✅ `transport-cost.ts` | ❌ 无人调用 `computeTransportCost()` | 断裂 |
| Route Efficiency | ✅ `route-efficiency.ts` | ❌ 无人调用 `evaluateRouteEfficiency()` | 断裂 |

**根因**：`specialization-planner.ts` 只消费 Remote Opportunity，不驱动 Supply Contract。`agenda-manager.ts` 不读取 Contract，直接从 RoomRegistry 构建 SupplyNode/DemandNode。

### 4.4 结论

| 维度 | 状态 |
| --- | --- |
| Transport Request 模型？ | ⚠️ 有 OperationContext 但缺 destination/deadline/batch/status 细粒度 |
| Transport Assignment？ | ❌ 只有 carrier memory.assignment，无正式 Assignment 对象 |
| Route Model？ | ❌ `computeRoute()` 只返回 hops/reachable，无 Route 一等对象 |
| Route Cost？ | ❌ `transport-cost.ts` 完整但从未被调用 |
| Route Cache？ | ⚠️ heap cache 存在但无失效条件 |
| Dynamic Rerouting？ | ❌ 不可达直接 markBlocked，不尝试替代路线 |
| Transport Capacity Planning？ | ❌ 无跨房运力估算 |
| Hauler Scaling？ | ❌ carrier 由 Operation 驱动，无动态扩缩编 |
| Delivery Validation？ | ❌ 用 carrier 空载推断，不验证实际收到量 |
| Transport Accounting？ | ⚠️ 有 requested/delivered 但无 loaded/lost/remaining |
| Cargo Loss？ | ❌ carrier 死亡后 cargo 凭空消失 |
| Backpressure？ | ❌ 无 |
| Supply Contract 集成？ | ❌ 纯函数完整但系统层完全断裂 |

---

## 5. 远矿搬运审计

### 5.1 远矿运输模型

远矿使用**独立运输链**：
- remoteHauler 直接从 remoteTarget container 取能 → home storage 卸能
- 不走 request-pool / assignment-service / Operation / AllocationPolicy
- 不走 SupplyNode / DemandNode

### 5.2 远矿运输成本模型

`targeting.ts` 已有经济评分：

```
scoreRemoteCandidate():
  throughput = min(demand, haulerNeed × perHauler)
  netScore = throughput - upkeep
  haulerNeed = ceil(demand / perHauler), cap maxHaulers
```

A4.1 已增加：
- ✅ Flow Accounting（`flow-accounting.ts`）— Produced/Transported/Delivered/Lost
- ✅ Economic Accounting（`economic-accounting.ts`）— Gross/Net/Cost
- ✅ ROI（`roi.ts`）— Expected vs Actual
- ✅ Operation Budget（`operation-budget.ts`）
- ✅ Container Lifecycle（`container-lifecycle.ts`）

### 5.3 远矿运输缺失

| 维度 | 状态 |
| --- | --- |
| Transport Request？ | ❌ 远矿不走 Request Pool，直接 spawn remoteHauler |
| Transport Assignment？ | ❌ remoteHauler 由 memory.remoteTarget 驱动，无正式 Assignment |
| Route Model？ | ❌ 无远矿 Route 对象（pathCost 是 intel 字段，不是动态计算） |
| Dynamic Rerouting？ | ❌ pathCost 固定，不随路况更新 |
| Hauler Scaling？ | ⚠️ 有 `remoteHaulerTarget()` 但基于理论 production，非实际 |
| Delivery Validation？ | ⚠️ 有 flow-accounting 但系统层未完整接入 |
| Backpressure？ | ⚠️ 有 `censusStalledOps()` 空转止损但非正式 backpressure |

---

## 6. Terminal 互济审计

### 6.1 当前状态

Terminal Manager **完全独立于 Resource Network**：
- `planEnergyAid()` 独立决策能量跨房互济
- `planMineralAid()` 独立决策矿物跨房互济
- 不走 SupplyNode / DemandNode / AllocationPolicy / Operation

A4.2 Audit §11 Conflict #1-2 已标记此为 A4.3 切换目标。

### 6.2 结论

| 维度 | 状态 |
| --- | --- |
| Terminal 接入 Resource Network？ | ❌ 完全独立 |
| Terminal 作为执行器？ | ❌ 自己决策自己执行 |
| 矿物调拨统一？ | ❌ Terminal 独立 + agenda-manager 不处理矿物 |

---

## 7. Route / Path 系统审计

### 7.1 路径缓存层级

movement 系统有三层路径缓存：

| 层级 | 位置 | 生命周期 | 失效条件 |
| --- | --- | --- | --- |
| 1. 跨 tick 持久化 | `globalCache().__creepPathCache` | heap, per-creep | 目标区块变化 + 结构 revision 变化 |
| 2. 同 tick 共享 | `globalCache().__pathShare` | heap, per-tick | tick 结束 |
| 3. 跨房间出口 | `globalCache().__interRoomCache` | heap, TTL=100 | 100 tick TTL |

agenda-manager 有自己的 route cache：

| 层级 | 位置 | 生命周期 | 失效条件 |
| --- | --- | --- | --- |
| 4. Room 路由 | `agenda-manager.routeCache` | heap, 永久 | ❌ 无失效条件 |

### 7.2 缺失

| 维度 | 状态 |
| --- | --- |
| Route 一等对象？ | ❌ 只有 `{ from, to, hops, reachable }` |
| Route Cost？ | ❌ `transport-cost.ts` 完整但从未被调用 |
| Route Efficiency？ | ❌ `route-efficiency.ts` 完整但从未被调用 |
| Route Ranking？ | ❌ 无多 Route 排序 |
| Route Cache Invalidation？ | ⚠️ movement 有 revision/TTL，agenda-manager 无 |
| Route Failure 检测？ | ❌ 不可达后直接 markBlocked |
| Dynamic Rerouting？ | ❌ 不尝试替代路线 |
| Route Reliability？ | ❌ 无历史成功率追踪 |
| Traffic Detection？ | ⚠️ movement 有 `recordTraffic()` 但不用于 Route 评估 |
| Route Suspension？ | ❌ 无 |
| Route Recovery？ | ❌ 无 |

---

## 8. Spawn / Population 审计

### 8.1 Hauler Spawn 链

```
spawn-manager.ts (P0, interval=1)
  │
  ├── cleanQueue() — 清理过期/重试上限请求
  ├── evaluateDemand() — demand.ts 纯函数
  │   ├── container 积压信号 → dynamicHaulerTarget
  │   ├── storage link 积压信号 → dynamicHaulerTarget
  │   ├── 运力归一化（referenceCarryCapacity / carryPerHauler）
  │   ├── min/max 约束
  │   ├── economyPressure 衰减
  │   └── inCrisis 收缩
  │
  ├── sortQueue() — priority 升序
  └── spawnCreep() — 唯一调用者

carrier spawn 链：
  agenda-manager → submitCarrierSpawn() → submitRequest(queue, request)
  → spawn-manager 消费 queue
```

### 8.2 Body Planning

`bodies.ts::selectBody("carrier", energyCapacity)` — 静态 body 配置表。

**缺失**：
- ❌ 无动态 body 优化（基于 Route 距离/风险/运力需求）
- ❌ 无 Transport Capacity 估算（不计算「需要多少 carry capacity 才能满足 production rate」）
- ❌ 无 Opportunity Cost 考量

### 8.3 Hauler Population 管理

| 维度 | 状态 |
| --- | --- |
| 动态编制？ | ✅ 基于 container/link 积压信号 |
| 运力归一化？ | ✅ 大 body 折减、小 body 扩编 |
| Overprovisioning 检测？ | ❌ 无闲置率追踪 |
| Overprovisioning 缩减？ | ❌ 只能通过死亡不补间接缩减 |
| Cross-Room 运力统一？ | ❌ hauler 只看本房，carrier 由 Operation 驱动 |
| Spawn Capacity 检查？ | ⚠️ 有 spawn 忙碌检查但无 Empire 级 spawn 预算 |

---

## 9. 已有能力清单（Already Exists — 可复用）

| # | 能力 | 源码位置 | 状态 | 复用方式 |
| --- | --- | --- | --- | --- |
| 1 | **Request Pool 系统** | `src/systems/logistics.ts` | ✅ 完整 | 扩展为统一 Transport Request 层 |
| 2 | **Assignment Service** | `src/systems/assignment-service.ts` | ✅ 完整 | 扩展支持跨房 assignment |
| 3 | **TransportRequest 模型** | `src/domain/assignment/request-pool.ts` | ⚠️ 最小化 | 扩展为完整 Transport Request |
| 4 | **supplyLedger 防超卖** | `request-pool.ts` | ✅ 完整 | 可复用 |
| 5 | **reconcileRegistry TTL** | `request-pool.ts` | ✅ 完整 | 可复用为 Request Expiration |
| 6 | **applyShrink 经济降级** | `request-pool.ts` | ✅ 完整 | 可复用为 Backpressure |
| 7 | **promoteAged 饥饿老化** | `request-pool.ts` | ✅ 完整 | 可复用为 Priority Aging |
| 8 | **Operation 九态状态机** | `agenda-item.ts` | ✅ 完整 | 可复用为 Transport Request 生命周期 |
| 9 | **Allocation Policy v2** | `allocation-policy.ts` | ✅ 7 因子 | 可复用为 Transport Plan 分配 |
| 10 | **SupplyNode / DemandNode** | `supply-node.ts`, `demand-node.ts` | ⚠️ energy-only | 扩展为多资源 Transport Demand 来源 |
| 11 | **Supply Contract** | `supply-contract.ts` | ✅ 完整 | 可复用为 Transport Contract 上层编排 |
| 12 | **Contract Lifecycle** | `contract-lifecycle.ts` | ✅ 完整 | 可复用 |
| 13 | **Contract-Node Bridge** | `contract-node-bridge.ts` | ✅ 完整 | 可复用为 Contract → Transport Request 注入 |
| 14 | **Transport Cost Model** | `transport-cost.ts` | ✅ 完整 | 可复用为 Route Cost 评估 |
| 15 | **Route Efficiency** | `route-efficiency.ts` | ✅ 完整 | 可复用为 Route Ranking |
| 16 | **Network Snapshot** | `network-snapshot.ts` | ✅ 完整 | 可复用为 Logistics Snapshot |
| 17 | **Network Health** | `network-health.ts` | ✅ 四档 | 可复用为 Logistics Health |
| 18 | **Rebalance** | `rebalance.ts` | ✅ 事件驱动 | 可复用为 Replan 触发 |
| 19 | **Reservation** | `reservation.ts` | ⚠️ energy-only | 扩展为 Transport Capacity Reservation |
| 20 | **Operation Lifecycle** | `lifecycle.ts` | ✅ 完整 | 可复用 |
| 21 | **Operation Verification** | `verification.ts` | ✅ 完整 | 扩展为 Delivery Validation |
| 22 | **Operation Dedup** | `dedup.ts` | ✅ 完整 | 可复用为 Request Deduplication |
| 23 | **Operation Metrics** | `metrics.ts` | ✅ 完整 | 可复用为 Logistics Metrics |
| 24 | **Replan Event** | `replan.ts` | ✅ 完整 | 可复用为 Dynamic Rerouting 触发 |
| 25 | **Spawn Queue** | `queue.ts` | ✅ 完整 | 可复用为 Hauler Spawn |
| 26 | **Spawn Demand** | `demand.ts` | ✅ 完整 | 扩展为 Transport Capacity Planning |
| 27 | **Bodies** | `bodies.ts` | ✅ 完整 | 扩展为动态 Body Planning |
| 28 | **Hauler 角色** | `hauler.ts` | ✅ 完整 | 扩展支持 Transport Assignment |
| 29 | **Carrier 角色** | `carrier.ts` | ✅ 完整 | 扩展支持 Transport Assignment |
| 30 | **Remote Hauler 角色** | `remote-hauler.ts` | ✅ 完整 | 扩展支持 Transport Assignment |
| 31 | **Distributor 角色** | `distributor.ts` | ✅ 完整 | 可复用 |
| 32 | **Pathfinding** | `pathfinding.ts` | ✅ 三层缓存 | 可复用为 Route Cache |
| 33 | **Stuck Recovery** | `stuck-recovery.ts` | ✅ 完整 | 可复用为 Hauler Stuck 检测 |
| 34 | **Traffic Manager** | `traffic-manager.ts` | ✅ 完整 | 可复用为 Traffic Detection |
| 35 | **Empire Economy** | `empire-economy.ts` | ✅ 完整 | 扩展接入 Logistics Health |
| 36 | **Empire Balance** | `empire-balance.ts` | ✅ 完整 | 扩展接入 Transport Cost |
| 37 | **Economic Health** | `economic-health.ts` | ⚠️ energy-only | A4.2 已扩展为 Multi-Resource |
| 38 | **Resource View** | `resource-view.ts` | ⚠️ energy-only | A4.2 已扩展为 Multi-Resource |
| 39 | **Specialization Planner** | `specialization-planner.ts` | ✅ 完整 | 扩展驱动 Supply Contract |
| 40 | **Remote Mining Manager** | `remote-mining-manager.ts` | ✅ 完整 | 运输链不改变 |
| 41 | **Flow Accounting** | `flow-accounting.ts` | ✅ 完整 | 可复用为 Transport Accounting |
| 42 | **Economic Accounting** | `economic-accounting.ts` | ✅ 完整 | 可复用为 Logistics ROI |
| 43 | **ROI** | `roi.ts` | ✅ 完整 | 可复用为 Route Suspension/Recovery |
| 44 | **Operation Budget** | `operation-budget.ts` | ✅ 完整 | 可复用为 Transport Budget |
| 45 | **Remote Mining Op** | `remote-mining-op.ts` | ✅ 完整 | 可复用为 Transport Operation 模板 |
| 46 | **Terminal Manager** | `terminal-manager.ts` | ✅ 完整 | 切换为 Resource Network 执行器 |
| 47 | **safeRun** | `safe-run.ts` | ✅ 完整 | 天然通用 |
| 48 | **Event Log** | `event-log.ts` | ✅ 完整 | 天然通用 |
| 49 | **Global Cache** | `global-cache.ts` | ✅ 完整 | 天然通用 |
| 50 | **Empire Room Role** | `empire-role.ts` | ✅ 完整 | 天然通用 |
| 51 | **CONFIG** | `config.ts` | ✅ 完整 | 扩展 logistics 参数 |

---

## 10. 缺失能力清单（Missing — 需新建）

| # | 能力 | 说明 | 建议实现位置 |
| --- | --- | --- | --- |
| 1 | **Transport Request 统一模型** | requestId/resourceType/amount/source/destination/priority/deadline/minBatch/maxBatch/routePreference/status | `src/domain/logistics/transport-request.ts` (新) |
| 2 | **Transport Assignment 模型** | requestId/creepId/source/destination/resource/amount/route/assignedTick/status | `src/domain/logistics/transport-assignment.ts` (新) |
| 3 | **Request Lifecycle 状态机** | PENDING→PLANNED→ASSIGNED→IN_TRANSIT→DELIVERED/PARTIAL/BLOCKED/FAILED/CANCELLED | `src/domain/logistics/request-lifecycle.ts` (新) |
| 4 | **Demand Aggregation** | 同房同资源多 Demand 聚合为批量请求 | `src/domain/logistics/demand-batching.ts` (新) |
| 5 | **Batch Sizing** | 基于 Source Available/Destination Demand/Hauler Capacity/Travel Cost/Priority/Deadline | `src/domain/logistics/batch-sizing.ts` (新) |
| 6 | **Transport Capacity Planning** | 估算 Empire 级所需运力 = Σ(production_rate × round_trip_time / carry_capacity) | `src/domain/logistics/capacity-planning.ts` (新) |
| 7 | **Hauler Scaling** | Demand > Capacity 时增加运力（检查 Spawn/Energy/Opportunity Cost） | `src/domain/logistics/hauler-scaling.ts` (新) |
| 8 | **Hauler Overprovisioning** | Capacity > Demand 长期 → 缩减 Hauler Population | 扩展 `hauler-scaling.ts` |
| 9 | **Route Model** | routeId/source/destination/distance/travelTime/cost/risk/traffic/status/lastEvaluated | `src/domain/logistics/route.ts` (新) |
| 10 | **Route Cache 管理** | 带失效条件的 Route Cache（道路变化/威胁变化/地形变化/Route Blocked） | `src/domain/logistics/route-cache.ts` (新) |
| 11 | **Dynamic Rerouting** | Route A 失效 → 尝试 Route B | `src/domain/logistics/rerouting.ts` (新) |
| 12 | **Transport Reliability Score** | Historical Success/Failure/Route Risk/Threat/Traffic/Creep Death/Path Failure | `src/domain/logistics/reliability.ts` (新) |
| 13 | **Adaptive Routing** | Route Score 根据历史 Success/Failure 动态调整（可解释，非黑盒 ML） | `src/domain/logistics/adaptive-routing.ts` (新) |
| 14 | **Traffic Detection** | 多 Hauler 共享 Route 检测 + Traffic Penalty（有上限） | `src/domain/logistics/traffic.ts` (新) |
| 15 | **Transport Reservation** | 预留 Hauler Capacity 给 Critical Request | `src/domain/logistics/reservation.ts` (新) |
| 16 | **Reservation Expiration** | TTL 防永久占用 | 扩展 `reservation.ts` |
| 17 | **Partial Delivery** | 交付 < 需求 → 自动生成 Remaining Demand | `src/domain/logistics/partial-delivery.ts` (新) |
| 18 | **Overdelivery Handling** | 交付 > 需求 → 重新分配 Excess Resource | `src/domain/logistics/overdelivery.ts` (新) |
| 19 | **Delivery Validation** | 验证 Destination Actual Resource + Ledger（不依赖 transfer() 返回值） | `src/domain/logistics/delivery-validation.ts` (新) |
| 20 | **Transport Accounting** | Requested/Assigned/Loaded/Delivered/Lost/Remaining/Cost per Request | `src/domain/logistics/transport-accounting.ts` (新) |
| 21 | **Cargo Loss 计算** | Hauler Death → Cargo Loss → Resource Accounting | `src/domain/logistics/cargo-loss.ts` (新) |
| 22 | **Hauler Death Recovery** | Death → Assignment Failure → Cargo Reconciliation → Demand Recalculation → New Assignment → Replacement Spawn | `src/domain/logistics/death-recovery.ts` (新) |
| 23 | **Hauler Stuck Detection** | 位置长期不变 → STUCK → Unstuck/Repath/Reassign/Recover | 复用 `stuck-recovery.ts` + 扩展 |
| 24 | **Hauler Idle Detection** | 长期无任务 → 重新评估 Population | `src/domain/logistics/idle-detection.ts` (新) |
| 25 | **Backpressure 机制** | Logistics Capacity 不足 → 向 Resource Planner 反馈 | `src/domain/logistics/backpressure.ts` (新) |
| 26 | **Logistics Bottleneck Detection** | 区分 Production/Logistics/Consumption Bottleneck | `src/domain/logistics/bottleneck.ts` (新) |
| 27 | **Bottleneck Chain** | Production→Logistics→Storage→Consumption 识别真正限制环节 | 扩展 `bottleneck.ts` |
| 28 | **Starvation Detection** | 长期缺资源 + Empire 总量足够 = Logistics Failure | `src/domain/logistics/starvation.ts` (新) |
| 29 | **Emergency Logistics** | 提高 Priority 但不绕过 Resource Network | `src/domain/logistics/emergency.ts` (新) |
| 30 | **Fairness Scheduling** | 防高频 Room 永久抢占全部 Logistics | `src/domain/logistics/fairness.ts` (新) |
| 31 | **Logistics ROI** | Resource Value - Transport Cost - Risk Cost = Net Logistics Value | `src/domain/logistics/roi.ts` (新) |
| 32 | **Route Suspension / Recovery** | 长期不经济 → SUSPENDED；条件恢复 → RESUME | `src/domain/logistics/route-suspension.ts` (新) |
| 33 | **Empire Logistics Health** | HEALTHY/STABLE/DEGRADED/CONGESTED/STARVED/CRITICAL | `src/domain/logistics/logistics-health.ts` (新) |
| 34 | **Logistics Dashboard** | Transport Requests/Assignments/Haulers/Capacity/Utilization/Routes/Cost/Reliability/Backlog/Delivery Rate/Loss/Starvation/Bottleneck/Health | `src/domain/logistics/dashboard.ts` (新) |
| 35 | **Empire Logistics Planner** | 输入：Deficit/Contract/Capacity/Route/Threat/Priority/Deadline → 输出：Transport Plan | `src/domain/logistics/planner.ts` (新) |
| 36 | **Transport Plan** | requests/assignments/routes/capacity/estimatedCost/estimatedTime/risk/expectedDelivery | `src/domain/logistics/transport-plan.ts` (新) |

---

## 11. 冲突清单（Conflicting — 需协调解决）

| # | 冲突 | 现状 | A4.3 目标 | 解决策略 |
| --- | --- | --- | --- | --- |
| 1 | **房内 TransportRequest vs 跨房 OperationContext** | 两套数据模型，无统一接口 | 统一为 Transport Request 模型 | 新建 `transport-request.ts` 作为统一接口，房内/跨房/远矿三种场景通过 scope 字段区分 |
| 2 | **三套 Hauler 角色分离** | hauler/carrier/remoteHauler 各自独立，无统一 Assignment | 统一 Transport Assignment | 新建 `transport-assignment.ts`，三种角色通过 assignment 字段驱动 |
| 3 | **Terminal Manager 独立 vs Resource Network** | terminal-manager 自己决策+执行 | Terminal 作为执行器，决策归 Network | A4.3 切换：Terminal 读取 Network 的 AllocationPlan 执行 |
| 4 | **Supply Contract 纯函数 vs 系统断裂** | Contract 完整但无人调用 | Contract 驱动 Transport Request 生成 | specialization-planner 或新 logistics-planner 调用 bridgeContracts() |
| 5 | **Transport Cost / Route Efficiency 存在但未用** | 纯函数完整但从未被调用 | Route 评估和排序的输入 | logistics-planner 调用 computeTransportCost() + evaluateRouteEfficiency() |
| 6 | **routeCache 无失效条件** | agenda-manager heap cache 永久 | 带失效条件的 Route Cache | 新建 Route 模型 + Cache 管理 |
| 7 | **Delivery 验证靠推断** | carrier 空载=卸完 | 验证实际收到量 | 新建 Delivery Validation 模块 |
| 8 | **无 Cargo Loss** | hauler 死亡 cargo 凭空消失 | Cargo Loss 计入 Resource Accounting | 新建 Cargo Loss 模块 |

---

## 12. 必需变更清单（Required Changes）

### 12.1 类型层变更

| # | 文件 | 变更 | 复杂度 |
| --- | --- | --- | --- |
| TC-1 | `request-pool.ts` | `TransportRequest.resource` 从 `"energy"` 改为 `ResourceType` | 🟢 低 |
| TC-2 | `request-pool.ts` | 扩展 TransportRequest 增加 destination/status/deadline/batch 字段 | 🟡 中 |

### 12.2 现有模块扩展

| # | 文件 | 扩展内容 | 复杂度 |
| --- | --- | --- | --- |
| EM-1 | `logistics.ts` | 支持跨房 Transport Request + Contract 驱动 | 🔴 高 |
| EM-2 | `assignment-service.ts` | 支持跨房 Transport Assignment | 🔴 高 |
| EM-3 | `agenda-manager.ts` | 调用 Supply Contract Bridge + Transport Cost + Route Efficiency | 🟡 中 |
| EM-4 | `specialization-planner.ts` | 驱动 Supply Contract 创建/激活/降级/暂停 | 🟡 中 |
| EM-5 | `terminal-manager.ts` | 从独立决策切换为读取 Network AllocationPlan 执行 | 🔴 高 |
| EM-6 | `empire-economy.ts` | 接入 Logistics Health | 🟡 中 |
| EM-7 | `demand.ts` | 扩展 hauler 编制为 Transport Capacity Planning | 🟡 中 |
| EM-8 | `hauler.ts` | 支持 Transport Assignment（destination/route） | 🟡 中 |
| EM-9 | `carrier.ts` | 支持 Transport Assignment + Delivery Validation | 🟡 中 |
| EM-10 | `remote-hauler.ts` | 支持 Transport Assignment | 🟡 中 |
| EM-11 | `bootstrap.ts` | 注册 logistics-planner System | 🟢 低 |
| EM-12 | `global.d.ts` | 增加 transportRequests / transportAssignments / routes Memory schema | 🟡 中 |
| EM-13 | `config.ts` | 增加 logistics 参数（batch sizing / capacity planning / reliability thresholds） | 🟢 低 |

### 12.3 新建模块

见 §10 完整清单（36 个新模块）。

### 12.4 Memory 迁移

| # | 变更 | 说明 |
| --- | --- | --- |
| MG-1 | `schemaVersion` 升版 | Transport Request + Assignment + Route 新增 |
| MG-2 | `Memory.kernel.transportRequests` | 新增（瘦快照，只存 ID + 数字 + 枚举） |
| MG-3 | `Memory.kernel.transportAssignments` | 新增 |
| MG-4 | `Memory.kernel.routes` | 新增 |
| MG-5 | 幂等迁移 | 旧 OperationContext 映射为 Transport Request |

---

## 13. 延迟项（Deferred）

| # | 能力 | 延迟原因 | 目标阶段 |
| --- | --- | --- | --- |
| DF-1 | Multi-Hop Logistics (A→B→C) | 当前架构不需要中继，A→B 直达足够 | A5.0+ |
| DF-2 | Factory 产出运输 | 依赖 Factory 产出链完整建模 | A4.4 |
| DF-3 | Power 买入运输 | Power 是特殊资源 | A4.5 |
| DF-4 | Boost 化合物运输 | 依赖 lab 反应链 | A4.4 |
| DF-5 | Commodity 产出运输 | 依赖 Factory | A4.4 |
| DF-6 | Military Supply Chain | 军事后勤 | A5+ |
| DF-7 | LLM 辅助物流决策 | LLM_BOUNDARY 约束 | A5.0+ |

---

## 14. 分类矩阵

### 14.1 Already Exists（可复用）— 51 项

见 §9 完整清单。

### 14.2 Missing（需新建）— 36 项

见 §10 完整清单。

### 14.3 Reusable（需适配但无需重写）

| 能力 | 当前状态 | A4.3 适配 |
| --- | --- | --- |
| `TransportRequest` (request-pool) | 5 字段最小模型 | 扩展为完整 Transport Request |
| `OperationContext` | 九态状态机 | Transport Request 生命周期可映射 |
| `AllocationPolicy` | 7 因子能量专用 | 参数化 resourceType |
| `SupplyNode` / `DemandNode` | energy-only | A4.2 已扩展 ResourceType |
| `Reservation` | energy-only | 扩展为 Transport Capacity Reservation |
| `routeCache` (agenda-manager) | 无失效条件 | 迁移到 Route Cache 管理 |
| `promoteAged` | P2/P3 only | 扩展到跨房 Operation |
| `applyShrink` | 经济降级 | 扩展为 Backpressure |
| `Supply Contract` | 纯函数完整 | 系统层接入 |
| `Transport Cost` | 纯函数完整 | 系统层调用 |
| `Route Efficiency` | 纯函数完整 | 系统层调用 |
| `Contract-Node Bridge` | 纯函数完整 | 系统层调用 |
| `Terminal Manager` | 独立决策 | 切换为执行器 |
| `demand.ts hauler 编制` | 积压信号驱动 | 扩展为 Capacity Planning |

### 14.4 Conflict（架构冲突）

见 §11 完整清单（8 项冲突）。

### 14.5 Technical Debt

| 债务 | 来源 | 影响 | A4.3 处理 |
| --- | --- | --- | --- |
| 三套运输系统并行 | A3.0/A3.1/远矿设计 | 无法统一规划/调度/监控 | 统一 Transport Request + Assignment |
| Supply Contract 系统层断裂 | A4.0 设计但未接线 | Contract 纯函数完整但无人调用 | logistics-planner 接入 |
| Transport Cost / Route Efficiency 未调用 | A4.0 纯函数 | Route 评估无法进行 | logistics-planner 调用 |
| Terminal Manager 独立于 Network | A4.2 标记为 A4.3 切换 | 矿物调拨双轨 | A4.3 切换 |
| Delivery 验证靠推断 | A3.1 设计 | 不验证实际收到量 | Delivery Validation 模块 |
| 无 Cargo Loss 追踪 | 从未实现 | 资源凭空消失 | Cargo Loss 模块 |
| routeCache 无失效 | agenda-manager | 永久缓存可能过时 | Route Cache 管理 |

---

## 15. A4.3 实施路线图

### 15.1 Phase 1 — Transport Domain Model

```
transport-request.ts      → 统一 Transport Request 模型（含 status 状态机）
transport-assignment.ts   → Transport Assignment 模型
request-lifecycle.ts     → PENDING→PLANNED→ASSIGNED→IN_TRANSIT→DELIVERED/PARTIAL/BLOCKED/FAILED/CANCELLED
demand-batching.ts       → 同房同资源 Demand 聚合
batch-sizing.ts          → 动态 Batch Size 计算
```

### 15.2 Phase 2 — Route Model

```
route.ts                 → Route 一等对象（routeId/source/destination/distance/travelTime/cost/risk/traffic/status）
route-cache.ts           → 带失效条件的 Route Cache
rerouting.ts             → Dynamic Rerouting
reliability.ts           → Transport Reliability Score
adaptive-routing.ts      → Adaptive Routing（可解释）
traffic.ts               → Traffic Detection + Penalty
route-suspension.ts      → Route Suspension / Recovery
```

### 15.3 Phase 3 — Transport Capacity

```
capacity-planning.ts     → Empire 级运力估算
hauler-scaling.ts        → 动态扩缩编
idle-detection.ts        → 闲置检测
```

### 15.4 Phase 4 — Delivery & Recovery

```
delivery-validation.ts   → 验证实际收到量
transport-accounting.ts → Requested/Assigned/Loaded/Delivered/Lost/Remaining/Cost
cargo-loss.ts            → Cargo Loss 计算
death-recovery.ts        → Hauler Death Recovery 全链
partial-delivery.ts      → Partial Delivery → Remaining Demand
overdelivery.ts          → Overdelivery Handling
```

### 15.5 Phase 5 — Planning & Optimization

```
planner.ts               → Empire Logistics Planner
transport-plan.ts        → Transport Plan
reservation.ts           → Transport Capacity Reservation + TTL
backpressure.ts          → Backpressure 机制
bottleneck.ts            → Bottleneck Detection + Chain
starvation.ts            → Starvation Detection
emergency.ts             → Emergency Logistics
fairness.ts              → Fairness Scheduling
roi.ts                   → Logistics ROI
```

### 15.6 Phase 6 — Health & Observability

```
logistics-health.ts      → HEALTHY/STABLE/DEGRADED/CONGESTED/STARVED/CRITICAL
dashboard.ts             → Empire Logistics Dashboard
```

### 15.7 Phase 7 — Integration

```
logistics.ts             → 接入统一 Transport Request
assignment-service.ts    → 接入跨房 Transport Assignment
agenda-manager.ts        → 调用 Contract Bridge + Transport Cost + Route Efficiency
specialization-planner.ts → 驱动 Supply Contract
terminal-manager.ts      → 切换为执行器
empire-economy.ts        → 接入 Logistics Health
bootstrap.ts             → 注册 logistics-planner
global.d.ts              → Memory schema 扩展
config.ts                → logistics 参数
```

### 15.8 Phase 8 — Testing

```
45+ Contract Tests       → A4.3-001 ~ A4.3-045
12 E2E Tests             → A4.3-E2E-001 ~ A4.3-E2E-012
6 Room Simulation        → Core A/B, Production, Support, Remote A/B
10/20/50 Room Stress     → 10k Tick Stability
CPU/Memory Validation    → Planner CPU / Route CPU / Assignment CPU / Reconciliation CPU
```

---

## 16. A4.3 目标架构

```
                    EMPIRE
                       │
              ┌────────┴────────┐
              ↓                 ↓
       Resource Economy     Logistics
              │                 │
              ↓                 ↓
        Supply/Demand      Transport Plan
         (Contract)        (Planner)
              │                 │
              └────────┬────────┘
                       ↓
                 Transport Request
                       ↓
                 Transport Assignment
                       ↓
                    Hauler/Carrier
                       ↓
                      Route
                       ↓
                    Delivery
                       ↓
               Delivery Validation
                       ↓
               Transport Accounting
                       ↓
               Resource Ledger
                       ↓
               Empire Economic Health
                       ↓
                    Replan
```

**关键原则**：
1. **统一 Transport Request** — 房内/跨房/远矿/Terminal 共用一套数据模型
2. **Planner 不执行** — Planner 只输出 Transport Plan，Execution 由现有系统完成
3. **复用不重建** — 不新建第二套 Logistics / Spawn / Resource Network
4. **Supply Contract 作为编排层** — Contract 驱动 Transport Request 生成
5. **Route 作为一等对象** — 有 ID/Cost/Reliability/Status 的持久化实体
6. **Delivery Validation 不可绕过** — 不依赖 transfer() 返回值

---

## 17. 严格禁止清单（合规检查）

> 以下每项均以 ✅ 标记表示**审计已确认当前不存在该违规**，A4.3 实施时必须维持。

| 禁止项 | 当前状态 | A4.3 维持方式 |
| --- | --- | --- |
| 第二套 Logistics System | ✅ 当前只有一套 Request Pool | 不新建——扩展现有 Request Pool |
| Logistics God Object | ✅ 无 | logistics-planner 只规划不执行 |
| Hauler 自己决定 Empire Priority | ✅ Priority 来源于 Demand | 保持——Priority 来源于 Resource Demand |
| Hauler 自己创建无限 Request | ✅ Request 由 logistics/agenda 生成 | 保持——Request 由 Planner 生成 |
| 每 Tick 全量 Route Recalculation | ✅ 有 cache | Route Cache + 失效条件 |
| 每 Tick 全 Empire 全量 Assignment | ✅ assignment-service 每 tick 但分房 | 保持——分房处理 |
| 无限 Transport History | ✅ 无 Transport History | 有限窗口 + 归档 |
| 无限 Route History | ✅ 无 Route History | 有限窗口 + 归档 |
| 资源凭空传输 | ✅ 有 Reservation 防超卖 | Delivery Validation 验证实际收到 |
| 忽略 Cargo Loss | ⚠️ 当前无追踪 | A4.3 新增 Cargo Loss 追踪 |
| 忽略 Transport Cost | ⚠️ 有纯函数但未调用 | A4.3 接入 |
| 忽略 Route Risk | ⚠️ 无风险追踪 | A4.3 新增 |
| 忽略 Spawn Capacity | ✅ spawn-manager 有容量检查 | 保持 |
| 用 transfer 成功代替 Delivery 验证 | ⚠️ carrier 用空载推断 | A4.3 新增 Delivery Validation |
| 为测试降低真实物流约束 | ✅ 无 | 保持 |
| 通过硬编码 Room Name 优化物流 | ✅ 无 | 保持 |

---

## 18. 结论

### 18.1 审计回答

| # | 问题 | 回答 |
| --- | --- | --- |
| 1 | 当前是否有 Transport Request？ | ⚠️ 有 `TransportRequest`(request-pool) 但最小化（5 字段，无 status/destination/deadline），跨房用 `OperationContext`，远矿用 `RemoteOp` — 三套模型 |
| 2 | 当前是否有 Transport Assignment？ | ❌ 只有 carrier `memory.assignment`，无正式 Assignment 对象 |
| 3 | 是否有 Request Lifecycle？ | ⚠️ 房内有 firstSeen/claimed 标记，跨房有九态状态机，但不统一 |
| 4 | 是否有 Deduplication？ | ✅ 房内有 key 幂等，跨房有 `hasActiveOperation()` |
| 5 | 是否有 Request Expiration？ | ✅ 房内有 TTL，跨房有 `checkExpiry()` |
| 6 | 是否有 Request Cancellation？ | ⚠️ 跨房有 `markCancelled`，房内无 |
| 7 | 是否有 Demand Batching？ | ❌ 每源一请求，无聚合 |
| 8 | 是否有 Batch Sizing？ | ❌ 无 |
| 9 | 是否有 Transport Capacity Planning？ | ❌ 只有积压信号驱动 |
| 10 | 是否有 Hauler Scaling？ | ⚠️ 有动态编制但非 capacity planning |
| 11 | 是否有 Hauler Reduction？ | ❌ 无闲置检测 |
| 12 | 是否有 Route Model？ | ❌ 只有 `{ hops, reachable }` |
| 13 | 是否有 Route Cost？ | ⚠️ `transport-cost.ts` 完整但从未被调用 |
| 14 | 是否有 Route Ranking？ | ❌ 无 |
| 15 | 是否有 Route Cache？ | ⚠️ 有但无失效条件 |
| 16 | 是否有 Route Invalidation？ | ❌ 无 |
| 17 | 是否有 Dynamic Rerouting？ | ❌ 不可达直接 markBlocked |
| 18 | 是否有 Transport Priority？ | ⚠️ 有 0-3 四档但来源于 DemandNode criticality |
| 19 | 是否有 Deadline？ | ⚠️ 跨房有 `DEFAULT_OPERATION_DEADLINE=2000`，房内无 |
| 20 | 是否有 Starvation Detection？ | ❌ 无 |
| 21 | 是否有 Logistics Bottleneck？ | ❌ 无 |
| 22 | 是否有 Reliability Score？ | ❌ 无 |
| 23 | 是否有 Traffic Detection？ | ⚠️ movement 有 `recordTraffic()` 但不用于 Route 评估 |
| 24 | 是否有 Transport Reservation？ | ⚠️ 有 source 预留，无 hauler capacity 预留 |
| 25 | 是否有 Partial Delivery？ | ⚠️ 有 `shouldPartialComplete` 但不生成 Remaining Demand |
| 26 | 是否有 Overdelivery Handling？ | ❌ 无 |
| 27 | 是否有 Delivery Validation？ | ❌ 用 carrier 空载推断 |
| 28 | 是否有 Transport Accounting？ | ⚠️ 有 requested/delivered 但无 loaded/lost/remaining |
| 29 | 是否有 Cargo Loss？ | ❌ 无 |
| 30 | 是否有 Hauler Death Recovery？ | ⚠️ 有 carrier 替换但无 Cargo Reconciliation |
| 31 | 是否有 Hauler Stuck Recovery？ | ✅ `stuck-recovery.ts` 完整 |
| 32 | 是否有 Hauler Idle Handling？ | ❌ 无闲置检测 |
| 33 | 是否有 Backpressure？ | ❌ 无 |
| 34 | 是否有 Emergency Logistics？ | ⚠️ 有紧急抢占但非 Emergency Transport |
| 35 | 是否有 Priority Aging？ | ⚠️ 房内有 `promoteAged`，跨房无 |
| 36 | 是否有 Fairness？ | ❌ 无 |
| 37 | 是否有 Logistics ROI？ | ❌ `route-efficiency.ts` 完整但未调用 |
| 38 | 是否有 Route Suspension？ | ❌ 无 |
| 39 | 是否有 Route Recovery？ | ❌ 无 |
| 40 | 是否有 Empire Logistics Health？ | ❌ 只有 NetworkHealth（supply/demand gap） |
| 41 | Supply Contract 是否接入？ | ❌ 纯函数完整但系统层完全断裂 |
| 42 | Terminal Manager 是否接入 Network？ | ❌ 完全独立 |

### 18.2 架构裁决

| 裁决 | 决定 |
| --- | --- |
| 是否新建第二套 Logistics？ | ❌ 不新建——扩展现有 Request Pool + assignment-service |
| 是否新建 Logistics God Object？ | ❌ 不新建——logistics-planner 只规划不执行 |
| 是否新建第二套 Spawn？ | ❌ 不新建——复用 spawn-manager + queue.ts |
| 是否新建第二套 Resource Network？ | ❌ 不新建——复用 SupplyNode/DemandNode/AllocationPolicy |
| 是否统一 Transport Request？ | ✅ 统一——新建 `transport-request.ts` 作为统一模型 |
| 是否新建 Route 模型？ | ✅ 新建——Route 作为一等数据对象 |
| 是否新建 Transport Capacity Planning？ | ✅ 新建——Empire 级运力估算 |
| 是否新建 Delivery Validation？ | ✅ 新建——不依赖 transfer() 返回值 |
| 是否新建 Cargo Loss 追踪？ | ✅ 新建——Hauler Death → Cargo Reconciliation |
| 是否新建 Logistics Planner？ | ✅ 新建——输入 Deficit/Contract/Capacity/Route → 输出 Transport Plan |
| 是否接入 Supply Contract？ | ✅ 接入——Contract 驱动 Transport Request |
| 是否接入 Transport Cost / Route Efficiency？ | ✅ 接入——Route 评估和排序的输入 |
| 是否切换 Terminal Manager？ | ✅ 切换——从独立决策变为执行器 |
| 是否新建 Logistics Health？ | ✅ 新建——HEALTHY/STABLE/DEGRADED/CONGESTED/STARVED/CRITICAL |
| 是否新建 Logistics Dashboard？ | ✅ 新建——全链路可观测性 |
| Planning Frequency？ | Event/Dirty Flag/Periodic 三档——禁止每 tick 全量重规划 |
| Multi-Hop Logistics？ | ❌ 延迟——当前架构不需要中继 |

### 18.3 实施优先级

1. **Transport Domain Model + Route Model**（核心基础）
2. **Transport Capacity Planning + Hauler Scaling**（运力闭环）
3. **Delivery Validation + Transport Accounting + Cargo Loss**（验证闭环）
4. **Supply Contract 接入 + Terminal Manager 切换**（集成闭环）
5. **Bottleneck Detection + Backpressure + Starvation**（诊断闭环）
6. **Empire Logistics Planner + Transport Plan**（规划闭环）
7. **Logistics Health + Dashboard**（可观测性）
8. **45+ Contract Tests + 12 E2E + 6 Room Simulation + 10k Tick Stability**（验证）

---

**Audit 完成。** 下一步：按优先级实施 A4.3。