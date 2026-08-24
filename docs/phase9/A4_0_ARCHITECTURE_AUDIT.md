# A4.0 Architecture Audit — Empire Economic Specialization & Remote Economy Foundation

> 日期：2026-08-24。阶段：A4.0 — Empire Economic Specialization Foundation。
> 基线：A3.4 Autonomous Colony Stabilization 已完成（255 files, 3097 tests passed）。
> 方法论：逐文件追踪真实调用链，不依赖文件名猜测。每个「已有能力」结论标注源码路径与关键函数。

---

## 0. 审计方法论

本审计**逐文件追踪真实调用链**，覆盖以下系统与模块：

- A3.4 Implementation Report（`docs/phase8/A3_4_IMPLEMENTATION_REPORT.md`）
- A3.1 Resource Network（`docs/phase5/A3_1_FINAL_REPORT.md`）
- A3.2 Expansion Intelligence（`docs/phase6/A3_2_FINAL_REPORT.md`）
- A3.3 Architecture Audit（`docs/phase7/A3_3_ARCHITECTURE_AUDIT.md`）
- Room Economic Profile（`src/domain/economy/room-profile.ts`）
- Room Registry（`src/domain/strategy/room-registry.ts`）
- Empire Resource View（`src/domain/strategy/resource-view.ts`）
- Empire Economic Health（`src/domain/strategy/economic-health.ts`）
- Empire Budget（`src/domain/strategy/budget.ts`）
- Expansion Readiness（`src/domain/strategy/readiness.ts`）
- Safety Margin（`src/domain/strategy/safety-margin.ts`）
- Empire Planner Input（`src/domain/strategy/planner-input.ts`）
- Capacity Profile（`src/domain/economy/capacity-profile.ts`）
- Resource Imbalance（`src/domain/strategy/imbalance.ts`）
- Supply/Demand Nodes（`src/domain/operation/supply-node.ts`, `demand-node.ts`）
- Allocation Policy v2（`src/domain/operation/allocation-policy.ts`）
- Network Snapshot/Health/Rebalance/Stability（`src/domain/operation/`）
- Agenda Item（`src/domain/operation/agenda-item.ts`）
- Intel System（`src/domain/intel.ts`）
- Remote Mining Manager（`src/systems/remote-mining-manager.ts`）
- Remote Targeting（`src/domain/remote/targeting.ts`）
- Expansion System（`src/domain/expansion/*`, `src/systems/expansion-manager.ts`, `expansion-planner.ts`）
- Empire Economy System（`src/systems/empire-economy.ts`）
- Empire Strategy System（`src/systems/empire-strategy.ts`）
- Agenda Manager（`src/systems/agenda-manager.ts`）
- Colony Phase（`src/domain/economy/phase.ts`）
- 冻结蓝图：ECONOMY、EXPANSION、LOGISTICS、EMPIRE_SYSTEM_MODEL

---

## 1. 当前 Room 是否已经有 Role？

### 1.1 现有分类体系

**已有：`RoomEconomicClass`** — 4 分类静态映射。

源码：`src/domain/economy/room-profile.ts` L58

```typescript
export type RoomEconomicClass = "core" | "production" | "candidate" | "struggling";
```

分类函数 `classifyRoomEconomic(rcl, hasStorage, colonyState)`（L209-228）：

| 分类 | 条件 | Empire 角色定位 |
| --- | --- | --- |
| `core` | RCL≥6 + storage + colonyState=normal | 帝国基座，可承担调拨源/代孵/sponsor |
| `production` | RCL4-5 + storage + colonyState=normal | 自立但无余力对外输出 |
| `candidate` | RCL<4 或无 storage | 需关注/扶植，无对外输出能力 |
| `struggling` | colonyState ∈ bootstrap/recovery/defense | 净消耗者，需支援或至少不被抽离 |

### 1.2 判定

**Room 有经济分类，但没有 Empire Economic Role。**

- `RoomEconomicClass` 是**能力门槛分类**（基于 RCL/storage/colonyState 的静态阶段标记），回答「这个房间发展到了什么阶段」。
- A4.0 需要的 `EmpireRoomRole`（CORE/PRODUCTION/SUPPORT/REMOTE）是**经济职能分工**，回答「这个房间在帝国经济中最适合做什么」。
- 两者维度不同：一个 RCL6 的 `core` 房间可能被分配为 PRODUCTION（高产能）或 SUPPORT（物流枢纽）或 CORE（帝国基座），取决于其特征 профиль。
- **分类函数不考虑**：Distance、Logistics Cost、Threat Level、Resource Availability、Comparative Advantage。

### 1.3 结论

| 维度 | 状态 |
| --- | --- |
| Room 有 Role？ | ⚠️ 有经济分类（`RoomEconomicClass`），无 Empire Economic Role |
| Role 影响经济决策？ | ⚠️ 仅 `canExportEnergy` / `needsEnergyAid` 两个谓词使用，不影响 Production/Allocation/Logistics 策略 |
| 需要新增？ | ✅ 需要 `EmpireRoomRole` 枚举（CORE/PRODUCTION/SUPPORT/REMOTE）+ Role Evaluation 纯函数 |

---

## 2. Room Role 是否真正影响经济决策？

### 2.1 当前 Role 影响范围追踪

`RoomEconomicClass` 的消费链：

```
classifyRoomEconomic()
  ↓ 写入 RoomEconomicProfile.economicClass
  ↓
  EmpireResourceView 聚合（resource-view.ts L159-164）
  → coreRooms / productionRooms / candidateRooms / strugglingRooms 统计
  → 用于 EconomicHealth 判定（coreRooms ≥ 1 → growing, ≥ 2 → healthy）
  → 用于 ExpansionReadiness 门控（G5: coreRooms ≥ 1）
  ↓
  canExportEnergy(profile)（L351-357）
  → 非 struggling + hasStorage + netFlow>0 + storageRatio≥0.3
  → 用于 SupplyNode 构建（supply-node.ts L59）
  → 用于 EmpireResourceView.surplusRooms（resource-view.ts L169）
  ↓
  needsEnergyAid(profile)（L369-374）
  → struggling OR (netFlow<0 + riskBuffer<400) OR (storageRatio<0.1 + income<5)
  → 用于 DemandNode 构建（demand-node.ts L80）
  → 用于 EmpireResourceView.deficitRooms
```

### 2.2 Role 不影响的关键决策

| 决策 | 当前依据 | Role 应影响但未影响 |
| --- | --- | --- |
| **Production 策略** | 无 Room-level production strategy | PRODUCTION 房应优先升级采集/hauler 编制 |
| **Resource Allocation** | `allocateNetwork()` 7 因子不含 Role | PRODUCTION 房应优先获得 hauler 配额 |
| **Logistics Route** | `RouteDistance.hops` 仅考虑跳数 | SUPPORT 房应作为物流中继节点 |
| **Spawn 优先级** | Spawn Queue 按 priority 排序，不含 Role | PRODUCTION 房的 harvester 替换应优先 |
| **Expansion Target** | 候选评分 7 因子不含 Empire Role | PRODUCTION 房周边应优先扩张（形成产业集群） |
| **Budget Allocation** | Empire Budget 按比例分配，不区分 Role | PRODUCTION 房应获得更多 production 预算 |

### 2.3 结论

| 维度 | 状态 |
| --- | --- |
| Role 影响经济决策？ | ❌ 当前 `RoomEconomicClass` 仅影响 canExport/needsAid 谓词 + 健康度统计 |
| 需要扩展？ | ✅ Role 必须影响 Planning / Production / Allocation / Logistics / Expansion |

---

## 3. 当前 Empire 是否知道每个 Room 的生产能力？

### 3.1 已有产能数据

**`RoomEconomicProfile`**（room-profile.ts）：
- `estimatedIncome`：估计收入（产能 × 效率系数，能量/tick）
- `efficiency`：效率系数（0..1）
- `sourceCount`：source 数量

**`RoomCapacityProfile`**（capacity-profile.ts）：
- `nominalCapacity`：名义产能（sourceCount × 10）
- `effectiveCapacity`：有效产能（= estimatedIncome）
- `utilization`：产能利用率（0..1）
- `bottleneck`：瓶颈类型（production/storage/spawn/logistics/construction/none）
- `logisticsThroughput`：近似物流吞吐
- `constructionThroughput`：近似建造吞吐

### 3.2 缺失数据

| 缺失 | 说明 | A4.0 需要 |
| --- | --- | --- |
| **Net Energy Production** | 当前有 estimatedIncome 但无净生产（扣除本地消费后的可输出量） | ✅ PRODUCTION 房的核心指标 |
| **Production Trend** | 无产能趋势（增长/下降/稳定） | ⚠️ 有用但可延迟 |
| **Remote Production Contribution** | 远矿产能未计入 Room 产能剖面 | ✅ REMOTE 房的核心指标 |
| **Infrastructure Efficiency** | 无基础设施效率评分（道路/链接/终端利用率） | ⚠️ 有用但可延迟 |

### 3.3 结论

| 维度 | 状态 |
| --- | --- |
| 知道 Room 生产能力？ | ⚠️ 有 `estimatedIncome` + `nominalCapacity` + `bottleneck`，但缺 Net Production 和 Remote Contribution |
| 可复用？ | ✅ `RoomCapacityProfile` 结构可扩展，`buildRoomCapacityProfile` 可增加新字段 |
| 需要新增？ | ✅ Net Energy Production（estimatedIncome - localConsumption）+ Remote Production 采集 |

---

## 4. 当前 Empire 是否知道每个 Room 的资源需求？

### 4.1 已有需求数据

**`RoomEconomicProfile`**：
- `netFlow`：净流 EMA（正=盈余，负=缺口）
- `riskBuffer`：断供耐受 tick 数
- `selfSufficiency`：自给度（0..1）
- `isStruggling`：困难态标记

**`DemandNode`**（demand-node.ts）：
- `requested`：请求总量
- `remaining`：剩余需求量
- `criticality`：紧急度分级（critical/high/normal/low）
- `firstSeen`：首次发现 tick（starvation aging）

**`EmpireResourceView`**：
- `surplusRooms` / `deficitRooms`：余缺房列表
- `hasImbalance`：是否存在余缺不均

### 4.2 缺失数据

| 缺失 | 说明 | A4.0 需要 |
| --- | --- | --- |
| **长期需求模式** | 当前 Demand 是瞬时的（每 100t 重建），不追踪长期需求趋势 | ✅ Supply Contract 需要长期需求模式 |
| **Demand by Role** | 不区分 CORE 房需求 vs PRODUCTION 房需求 | ✅ Role-specific 需求剖面 |
| **Projected Demand** | 无预测需求（如即将升级 RCL 需要大量能量） | ⚠️ 有用但可延迟 |

### 4.3 结论

| 维度 | 状态 |
| --- | --- |
| 知道 Room 资源需求？ | ⚠️ 有瞬时 Demand + netFlow + riskBuffer，但缺长期需求模式和 Role-specific 需求 |
| 可复用？ | ✅ DemandNode 结构可扩展 |
| 需要新增？ | ✅ 长期需求模式追踪 + Role-specific 需求剖面 |

---

## 5. Resource Network 是否支持长期供应关系？

### 5.1 当前网络模型

**A3.1 Resource Network** 是**点对点临时调拨模型**：

```
agenda-manager.ts (每 100 tick)
  ↓ buildRoomEconomicProfile()
  ↓ buildSupplyNodes() + buildDemandNodes()
  ↓ allocateNetwork() → AllocationPlan[]
  ↓ createOperation() → OperationContext (type="supply")
  ↓ createReservation() → ReservationTable
  ↓ submitCarrierSpawn()
  ↓ Operation 生命周期：planned→ready→running→verifying→completed
```

**Operation 生命周期**（agenda-item.ts）：
- 每次调拨创建一个 OperationContext
- Operation 完成后归档删除（终态 = completed/failed/cancelled/expired）
- **不维护长期供应关系** — 下一个 100 tick 周期重新评估

**Network Rebalance**（rebalance.ts）：
- 事件驱动 + debounce(50t) + cooldown(200t)
- 触发事件包括：new-demand, new-supply, operation-failure, reservation-released, room-health-changed
- **但 rebalance 也是临时的** — 只重新分配当前供需，不建立长期 Contract

### 5.2 缺失能力

| 缺失 | 说明 | A4.0 需要 |
| --- | --- | --- |
| **Supply Contract** | Room A 长期供应 Room B 的正式协议 | ✅ 核心交付物 |
| **Contract Lifecycle** | PROPOSED→ACTIVE→DEGRADED→SUSPENDED→COMPLETED→CANCELLED | ✅ 核心交付物 |
| **Target Rate** | 约定供应速率（能量/tick） | ✅ Contract 字段 |
| **Minimum Reserve** | Producer 最低保留量 | ✅ Contract 字段 |
| **Producer Failure Detection** | Producer 进入 CRITICAL 时自动 DEGRADE/SUSPEND | ✅ 核心交付物 |
| **Consumer Failure Detection** | Consumer 不再需要时自动 COMPLETED | ✅ 核心交付物 |

### 5.3 结论

| 维度 | 状态 |
| --- | --- |
| 支持长期供应关系？ | ❌ 当前只有临时 Operation（单次调拨），无 Supply Contract |
| 网络可复用？ | ✅ SupplyNode/DemandNode/AllocationPolicy 可作为 Contract 的底层执行层 |
| 需要新增？ | ✅ Supply Contract 模型 + Lifecycle + Producer/Consumer Failure Detection |

---

## 6. 是否支持 Remote Resource Source？

### 6.1 当前 Remote 系统

**`remote-mining-manager.ts`**（P2, interval=10）：

已有的完整远矿链：
```
room-observer (每 50t 采 intel)
  → selectRemoteTargets()（targeting.ts 纯函数）
  → evaluateRemoteDemand()（demand.ts 纯函数）
  → spawnQueue → spawn-manager
  → remoteHarvester/remoteHauler/reserver/remoteDefender/coreClearer
```

**RemoteOp 结构**（存 Memory.rooms[home].remoteOps[target]）：
- state: active/abandoned
- sources: source 数
- haulerNeed: hauler 需求量
- createdAt / lastSeen
- threatUntil / needCoreClear / dangerUntil
- siteCount / stallSince

**远矿经济模型**（targeting.ts L51-63）：
- SOURCE_INCOME = 10 e/tick（reserve 后）
- SOURCE_INCOME_UNRESERVED = 5 e/tick
- HARVESTER_UPKEEP = 0.4 e/tick
- HAULER_UPKEEP = 0.4 e/tick
- RESERVER_UPKEEP = 2.2 e/tick
- DEFENDER_UPKEEP = 0.35 e/tick
- ROAD_UPKEEP_PER_PATHCOST = 0.002

### 6.2 缺失：Remote Source Model

当前远矿系统是**以 Room 为中心**的运营管理，没有独立的 Remote Source 抽象。

| 缺失 | 说明 | A4.0 需要 |
| --- | --- | --- |
| **Remote Source 实体** | sourceId/roomName/position/resourceType/capacity/distance/travelCost/risk/reservation/expectedYield/status | ✅ 核心交付物 |
| **Remote Source Status** | AVAILABLE/ASSIGNED/DEGRADED/BLOCKED/INACTIVE | ✅ 核心交付物 |
| **Remote Resource Value** | Expected Yield - Transport Cost - Risk - Infrastructure Cost = Net Value | ✅ 核心交付物 |
| **Remote Opportunity** | 从 Intel → Remote Source → Economic Evaluation → Opportunity → WAITING_EXECUTION | ✅ 核心交付物 |
| **Opportunity Ranking** | 多候选排序 + 可解释 | ✅ 核心交付物 |

### 6.3 结论

| 维度 | 状态 |
| --- | --- |
| 支持 Remote Resource Source？ | ⚠️ 有远矿运营系统（remote-mining-manager + targeting.ts），但无独立 Remote Source Model |
| 可复用？ | ✅ `scoreRemoteCandidate()` 已有净收益评分（netScore = 收益 - 摊销），`RoomIntel` 已有 pathCost/sources/owner 等字段 |
| 需要新增？ | ✅ Remote Source Model + Economic Evaluation + Opportunity Ranking（planner 层，不执行） |

---

## 7. 当前 Logistics 是否支持长期 Route？

### 7.1 当前 Logistics 模型

**Logistics = Request Pool System**（LOGISTICS_ARCHITECTURE §1）：

```
logistics.ts (P1, 每 tick)
  → 采集 TransportRequest 候选（各房 demand）
  → globalCache().transportPool

assignment-service.ts (P1, 每 tick)
  → 合并 transportPool + buildQueue assignments
  → TaskPool 分配
  → globalCache().assignment
```

**跨房调拨**（A3.0/A3.1）：
- Agenda Manager 每 100t 创建 `OperationContext(type="supply")`
- Carrier spawn → carrier 执行搬运 → verifying → completed
- **单次 Operation 模式**：每次创建一个 carrier 完成一次搬运，不维护长期 Route

### 7.2 缺失能力

| 缺失 | 说明 | A4.0 需要 |
| --- | --- | --- |
| **长期 Route** | Room A → Room B 的持续供应路线 | ✅ Supply Contract 的执行层 |
| **Route Efficiency** | Delivered vs Cost 比率 | ✅ 核心交付物 |
| **Transport Cost Model** | Distance + Carrier Body Cost + Energy Cost + Time Cost | ✅ 核心交付物 |
| **Route Degradation** | Route 效率下降时自动降级 | ⚠️ 可延迟到 A4.1 |

### 7.3 结论

| 维度 | 状态 |
| --- | --- |
| 支持长期 Route？ | ❌ 当前只有单次 Operation 搬运，无长期 Route 维护 |
| Logistics 可复用？ | ✅ Request Pool + assignment-service + carrier 角色可复用为 Contract 执行层 |
| 需要新增？ | ✅ Transport Cost Model + Route Efficiency 计算 + Supply Contract 驱动的长期 Route |

---

## 8. 当前 Room Economy 是否能区分 Core/Support/Production Economy？

### 8.1 当前区分能力

**`RoomEconomicClass`**（4 分类）：
- `core`：RCL≥6 + storage + normal → 帝国基座
- `production`：RCL4-5 + storage + normal → 自立但无余力
- `candidate`：RCL<4 或无 storage → 需扶植
- `struggling`：colonyState ∈ bootstrap/recovery/defense → 净消耗者

**`EmpireResourceView`** 聚合：
- coreRooms / productionRooms / candidateRooms / strugglingRooms 统计

### 8.2 无法区分的维度

| 无法区分 | 原因 | A4.0 需要 |
| --- | --- | --- |
| **Core Economy vs Support Economy** | `core` 分类只看 RCL/storage，不看物流枢纽位置或调拨角色 | ✅ SUPPORT Role |
| **Production Economy vs Core Economy** | `production` 分类只看 RCL 4-5，不看产能效率或比较优势 | ✅ PRODUCTION Role |
| **Remote Economy** | 当前无 REMOTE 分类，远矿房不进 Room Registry | ✅ REMOTE Role |
| **Strategic Economy** | 无战略位置评估 | ⚠️ 可延迟（MILITARY Role 未来扩展） |

### 8.3 结论

| 维度 | 状态 |
| --- | --- |
| 能区分 Core/Support/Production？ | ❌ 当前 `RoomEconomicClass` 只按发展阶段分类，不按经济职能分工 |
| 需要新增？ | ✅ `EmpireRoomRole` 枚举（CORE/PRODUCTION/SUPPORT/REMOTE）+ Role Evaluation |

---

## 9. 当前 Empire Planner 是否支持 Specialization？

### 9.1 当前 Planner 链

**`empire-economy.ts`**（P1, interval=100）执行的 10 步链：

```
RoomSnapshot + RoomMemory + EconomyQuery
  → buildRoomEconomicProfile (步 1)
  → buildRoomCapacityProfile (步 3)
  → buildEmpireResourceView (步 4)
  → evaluateEconomicHealth (步 5)
  → detectImbalance (步 6)
  → allocateEmpireBudget (步 7)
  → evaluateExpansionReadiness (步 8)
  → evaluateSafetyMargin (步 9)
  → buildEmpirePlannerInput (步 10)
  → Memory.kernel.empireEconomy (瘦快照)
  → cachedPlannerInput (heap 缓存供其他系统消费)
```

**`expansion-planner.ts`**（P1, interval=100）消费 Planner Input：

```
queryEmpirePlannerInput()
  → evaluateExpansionPressure()
  → discoverCandidates()
  → scoreCandidates()
  → rankCandidates()
  → estimateExpansionCost()
  → evaluatePayback()
  → evaluateRisk()
  → computeTieredBudget()
  → createPlan() → EVALUATED
  → applyHysteresis() → READY → APPROVED → WAITING_EXECUTION
  → Memory.kernel.expansionPlans
```

### 9.2 缺失能力

| 缺失 | 说明 | A4.0 需要 |
| --- | --- | --- |
| **Room Role Evaluation** | 从 Room Characteristics 推导 EmpireRoomRole | ✅ 核心交付物 |
| **Specialization Score** | CORE/PRODUCTION/SUPPORT/REMOTE 各维度评分 | ✅ 核心交付物 |
| **Role Stability / Hysteresis** | 防 Role 振荡的迟滞机制 | ✅ 核心交付物 |
| **Role Transition** | Role 变更的条件 + 滞回 | ✅ 核心交付物 |
| **Supply Contract Planning** | 基于 Role 建立长期供应关系 | ✅ 核心交付物 |
| **Empire Economic Balance** | 总生产/消费/运输/储备的帝国级计算 | ✅ 核心交付物 |
| **Comparative Advantage** | 基于比较优势的 Role 分配 | ✅ 核心交付物 |
| **Local Resilience** | 专业化不等于完全依赖，保留 Emergency Production | ✅ 核心交付物 |

### 9.3 结论

| 维度 | 状态 |
| --- | --- |
| 支持 Specialization？ | ❌ 当前 Planner 只做余缺检测 + 预算分配 + 扩张就绪度，无 Role 评估和专业化规划 |
| 需要新增？ | ✅ Specialization Planner 模块（Room Role Evaluation + Supply Contract Planning + Empire Economic Balance） |

---

## 10. 哪些能力已经存在？

### 10.1 Already Exists（可复用）

| # | 能力 | 源码位置 | 状态 | 复用方式 |
| --- | --- | --- | --- | --- |
| 1 | **Room Economic Profile** | `src/domain/economy/room-profile.ts` | ✅ 完整 | 扩展 `RoomEconomicProfile` 增加 empireRole 字段 |
| 2 | **Room Capacity Profile** | `src/domain/economy/capacity-profile.ts` | ✅ 完整 | 扩展增加 netProduction / remoteContribution 字段 |
| 3 | **Empire Resource View** | `src/domain/strategy/resource-view.ts` | ✅ 完整 | 扩展增加 roleBreakdown / contractCount 字段 |
| 4 | **Empire Economic Health** | `src/domain/strategy/economic-health.ts` | ✅ 完整 | 可复用，Role 不影响健康度判定逻辑 |
| 5 | **Empire Budget** | `src/domain/strategy/budget.ts` | ✅ 完整 | 扩展增加 roleBasedAllocation 字段 |
| 6 | **Expansion Readiness** | `src/domain/strategy/readiness.ts` | ✅ 完整 | 可复用，G0-G15 门控链完整 |
| 7 | **Safety Margin** | `src/domain/strategy/safety-margin.ts` | ✅ 完整 | 可复用，五维安全分数 |
| 8 | **Empire Planner Input** | `src/domain/strategy/planner-input.ts` | ✅ 完整 | 扩展增加 roleAssignments / supplyContracts 字段 |
| 9 | **Room Registry** | `src/domain/strategy/room-registry.ts` | ✅ 完整 | 扩展 RoomRegistryEntry 增加 empireRole 字段 |
| 10 | **Supply Node** | `src/domain/operation/supply-node.ts` | ✅ 完整 | 可复用作为 Contract 执行层 |
| 11 | **Demand Node** | `src/domain/operation/demand-node.ts` | ✅ 完整 | 可复用作为 Contract 执行层 |
| 12 | **Allocation Policy v2** | `src/domain/operation/allocation-policy.ts` | ✅ 完整 | 7 因子可解释分配，可扩展 Role 因子 |
| 13 | **Network Snapshot** | `src/domain/operation/network-snapshot.ts` | ✅ 完整 | 可复用 |
| 14 | **Network Health** | `src/domain/operation/network-health.ts` | ✅ 完整 | 可复用 |
| 15 | **Network Rebalance** | `src/domain/operation/rebalance.ts` | ✅ 完整 | 事件驱动 + debounce + cooldown |
| 16 | **Plan Stability** | `src/domain/operation/stability.ts` | ✅ 完整 | 防抖四防线（Hysteresis + Commitment + Threshold + Cooldown） |
| 17 | **Operation Context** | `src/domain/operation/agenda-item.ts` | ✅ 完整 | supply/claim/colonize 三类型 |
| 18 | **Reservation System** | `src/domain/operation/reservation.ts` | ✅ 完整 | 可复用为 Contract 预留层 |
| 19 | **Intel System** | `src/domain/intel.ts` | ✅ 完整 | RoomIntel 含 sources/mineral/owner/towers/pathCost 等 |
| 20 | **Remote Targeting** | `src/domain/remote/targeting.ts` | ✅ 完整 | netScore 评分 + haulerNeed 计算 |
| 21 | **Remote Mining Manager** | `src/systems/remote-mining-manager.ts` | ✅ 完整 | 远矿运营全链（评估→孵化→维护→止损） |
| 22 | **Colony Phase** | `src/domain/economy/phase.ts` | ✅ 完整 | 五相位 + 双维度危机模型 + 迟滞 |
| 23 | **Empire Economy System** | `src/systems/empire-economy.ts` | ✅ 完整 | 10 步链 + heap 缓存 + Memory 瘦快照 |
| 24 | **Expansion Planner** | `src/systems/expansion-planner.ts` | ✅ 完整 | Intelligence 链 + Plan 生命周期 |
| 25 | **Agenda Manager** | `src/systems/agenda-manager.ts` | ✅ 完整 | Resource Network 系统侧薄壳 |
| 26 | **Empire Strategy** | `src/systems/empire-strategy.ts` | ✅ 完整 | Posture + Agenda + Capacity 裁决 |
| 27 | **Spawn Manager** | `src/systems/spawn-manager.ts` | ✅ 完整 | 唯一 spawnCreep 调用者 |
| 28 | **Logistics** | `src/systems/logistics.ts` | ✅ 完整 | Request Pool 系统 |
| 29 | **Assignment Service** | `src/systems/assignment-service.ts` | ✅ 完整 | TaskPool 分配 |
| 30 | **Traffic Manager** | `src/systems/traffic-manager.ts` | ✅ 完整 | 移动意图仲裁 |
| 31 | **safeRun** | `src/kernel/safe-run.ts` | ✅ 完整 | 错误隔离 |
| 32 | **Event Log** | `src/kernel/event-log.ts` | ✅ 完整 | 事件记录 |
| 33 | **Global Cache** | `src/kernel/global-cache.ts` | ✅ 完整 | heap 缓存（networkSnapshot/networkHealth/expansionDashboard） |
| 34 | **Expansion Candidate V2** | `src/domain/expansion/candidate.ts` | ✅ 完整 | 14+ 字段 + lifecycle status |
| 35 | **Expansion Scoring** | `src/domain/expansion/scoring.ts` | ✅ 完整 | 七因子评分 |
| 36 | **Expansion Cost Model** | `src/domain/expansion/cost-model.ts` | ✅ 完整 | Bootstrap/Travel/Spawn/Infra 成本 |
| 37 | **Expansion Payback** | `src/domain/expansion/payback.ts` | ✅ 完整 | Cost vs Benefit + ROI |
| 38 | **Expansion Risk** | `src/domain/expansion/risk.ts` | ✅ 完整 | 五维风险评估 |
| 39 | **Expansion Tiered Budget** | `src/domain/expansion/budget.ts` | ✅ 完整 | Emergency→Core→Operational→Available |
| 40 | **Expansion Plan Lifecycle** | `src/domain/expansion/plan-lifecycle.ts` | ✅ 完整 | 去重 + 清理 + 防抖 + 重评 |
| 41 | **Colony Stability Score** | `src/domain/expansion/stability-score.ts` | ✅ 完整 | 5 维度可解释评分 |
| 42 | **Colony Failure Detection** | `src/domain/expansion/colony-failure.ts` | ✅ 完整 | 6 种失败类型检测 |
| 43 | **Expansion Cooldown** | `src/domain/expansion/expansion-cooldown.ts` | ✅ 完整 | 冷却窗口 + Rate Limit |
| 44 | **ROI Tracker** | `src/domain/expansion/roi-tracker.ts` | ✅ 完整 | Before/After 对比 |

---

## 11. 哪些需要新增？

### 11.1 Missing（需新建）

| # | 能力 | 说明 | 建议实现位置 |
| --- | --- | --- | --- |
| 1 | **EmpireRoomRole 枚举** | CORE / PRODUCTION / SUPPORT / REMOTE | `src/domain/economy/empire-role.ts` (新) |
| 2 | **Role Evaluation** | 从 Room Characteristics 推导 Role Scores | `src/domain/economy/role-evaluation.ts` (新) |
| 3 | **Role Stability / Hysteresis** | 防 Role 振荡的迟滞机制 | `src/domain/economy/role-stability.ts` (新) |
| 4 | **Role Transition** | Role 变更条件 + 滞回 + 最低驻留 | `src/domain/economy/role-transition.ts` (新) |
| 5 | **Supply Contract Model** | source/target/resource/targetRate/minimumReserve/priority/status | `src/domain/economy/supply-contract.ts` (新) |
| 6 | **Contract Lifecycle** | PROPOSED→ACTIVE→DEGRADED→SUSPENDED→COMPLETED→CANCELLED | `src/domain/economy/contract-lifecycle.ts` (新) |
| 7 | **Producer Failure Detection** | Producer 进入 CRITICAL 时 DEGRADE/SUSPEND | `src/domain/economy/contract-failure.ts` (新) |
| 8 | **Consumer Failure Detection** | Consumer 不再需要时 COMPLETED | `src/domain/economy/contract-failure.ts` (新) |
| 9 | **Transport Cost Model** | Distance + Carrier Body Cost + Energy Cost + Time Cost | `src/domain/economy/transport-cost.ts` (新) |
| 10 | **Route Efficiency** | Delivered vs Cost 比率 | `src/domain/economy/route-efficiency.ts` (新) |
| 11 | **Remote Source Model** | sourceId/roomName/position/resourceType/capacity/distance/travelCost/risk/reservation/expectedYield/status | `src/domain/remote/remote-source.ts` (新) |
| 12 | **Remote Resource Value** | Net Value = ExpectedYield - TransportCost - Risk - InfraCost | `src/domain/remote/remote-value.ts` (新) |
| 13 | **Remote Opportunity** | Intel → Remote Source → Evaluation → Opportunity → WAITING_EXECUTION | `src/domain/remote/remote-opportunity.ts` (新) |
| 14 | **Opportunity Ranking** | 多候选排序 + 可解释 | `src/domain/remote/opportunity-ranking.ts` (新) |
| 15 | **Empire Economic Balance** | Total Production/Consumption/Transport/Reserve → Net Empire Value | `src/domain/strategy/empire-balance.ts` (新) |
| 16 | **Local Resilience Policy** | 专业化不等于完全依赖，保留 Emergency Production | `src/domain/economy/local-resilience.ts` (新) |
| 17 | **Specialization Dashboard** | Room Roles / Production / Contracts / Flow / Net Value 可观测性 | `src/domain/economy/specialization-dashboard.ts` (新) |
| 18 | **Specialization Planner System** | 系统侧薄壳：Role Evaluation + Contract Planning + Balance | `src/systems/specialization-planner.ts` (新) |

### 11.2 Required Changes（需修改）

| # | 变更 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | **RoomEconomicProfile 扩展** | `room-profile.ts` | 增加 `empireRole?: EmpireRoomRole` 字段 |
| 2 | **RoomRegistryEntry 扩展** | `room-registry.ts` | 增加 `empireRole` 字段 |
| 3 | **EmpirePlannerInput 扩展** | `planner-input.ts` | 增加 `roleAssignments` / `supplyContracts` / `empireBalance` 字段 |
| 4 | **EmpireResourceView 扩展** | `resource-view.ts` | 增加 `roleBreakdown: Record<EmpireRoomRole, number>` 字段 |
| 5 | **Allocation Policy 扩展** | `allocation-policy.ts` | scoreSupplyForDemand 增加 Role 匹配度因子 |
| 6 | **global-cache 扩展** | `global-cache.ts` | 增加 `specializationDashboard` heap 字段 |
| 7 | **bootstrap 注册** | `bootstrap.ts` | 注册 specialization-planner System |
| 8 | **global.d.ts 扩展** | `global.d.ts` | KernelMemory 增加 `supplyContracts` / `remoteOpportunities` 字段 |

---

## 12. 哪些应该延迟？

### 12.1 Deferred

| 延迟项 | 原因 | 延迟到 |
| --- | --- | --- |
| **Mineral Economy** | A4.0 只做 Energy Production Specialization | A4.1+ |
| **Factory Production** | 同上 | A4.1+ |
| **Power Processing** | 同上 | A4.1+ |
| **Market Integration** | A4.0 不涉及市场交易 | A4.2+ |
| **Terminal Trading** | 同上 | A4.2+ |
| **Military Execution** | A4.0 不涉及军事 | A5+ |
| **Complex Remote Mining Execution** | A4.0 只建立 Planner + Opportunity，不执行 | A4.1 |
| **第二套 Logistics** | 禁止——复用现有 Request Pool + assignment-service | N/A |
| **第二套 Resource Network** | 禁止——复用现有 SupplyNode/DemandNode/AllocationPolicy | N/A |
| **MILITARY Role** | 未来扩展，A4.0 只支持 CORE/PRODUCTION/SUPPORT/REMOTE | A5+ |
| **MINERAL Role** | 同上 | A4.1+ |

---

## 13. 真实调用链：当前 Empire Economic Flow

### 13.1 Empire Economy 执行链（每 100 tick）

```
empire-economy.ts (System, P1, interval=100)
  │
  ├── 步1: buildRoomEconomicProfile(snapshot, roomMem, economyQuery, tick)
  │   → RoomEconomicProfile { economicClass, netFlow, estimatedIncome, ... }
  │
  ├── 步3: buildRoomCapacityProfile(profile, haulerCount, ...)
  │   → RoomCapacityProfile { nominalCapacity, effectiveCapacity, bottleneck, ... }
  │
  ├── 步4: buildEmpireResourceView(profiles, tick)
  │   → EmpireResourceView { totalEnergy, totalProduction, totalNetFlow, surplusRooms, deficitRooms, ... }
  │
  ├── 步5: evaluateEconomicHealth(view)
  │   → EconomicHealthResult { health: critical|deficit|stable|growing|healthy, evidence, ... }
  │
  ├── 步6: detectImbalance(profiles, view, tick)
  │   → ResourceImbalanceResult { candidates: TransferCandidate[], ... }
  │
  ├── 步7: allocateEmpireBudget(view, health, tick)
  │   → EmpireBudget { reserve, survival, production, infrastructure, expansion, free }
  │
  ├── 步8: evaluateExpansionReadiness(view, health, budget, cpuTier, postureAllowed)
  │   → ExpansionReadinessResult { readiness: NOT_READY|READY|STRONGLY_READY, gates: G0-G11 }
  │
  ├── 步9: evaluateSafetyMargin(view, health)
  │   → SafetyMarginResult { score: 0..1, productionSafety, reserveSafety, ... }
  │
  ├── 步10: buildEmpirePlannerInput(tick, profiles, capacityProfiles, view, health, imbalance, budget, readiness, safetyMargin)
  │   → EmpirePlannerInput { ...全部子结果 }
  │
  ├── cachedPlannerInput = { tick, input: plannerInput }    ← heap 缓存
  └── Memory.kernel.empireEconomy = { t, te, tp, nf, ... }   ← Memory 瘦快照
```

### 13.2 Resource Network 执行链（每 100 tick）

```
agenda-manager.ts (System, P1, interval=100)
  │
  ├── buildRoomEconomicProfile() → profiles[]
  ├── computeTransferableBulk() → transferable by room
  ├── makeRegistryEntry() → RoomRegistry (Map)
  ├── getSurplusRooms() / getDeficitRooms()
  │
  ├── buildSupplyNodes(surplusRooms, reservedByRoom, tick)
  │   → SupplyNode[] { room, available, reserved, safety, transferable, priority, health }
  │
  ├── buildDemandNodes(deficitRooms, inTransitByTarget, tick)
  │   → DemandNode[] { room, requested, remaining, criticality, firstSeen }
  │
  ├── buildNetworkSnapshot(tick, supplyNodes, demandNodes, ops, reservations, plans)
  │   → NetworkSnapshot { totalSupply, totalDemand, gap, ... }
  │
  ├── decideRebalance(rebalanceState, tick)
  │   → RebalanceDecision { shouldRebalance, pendingEvents }
  │
  ├── allocateNetwork(supplyNodes, demandNodes, routes, activeOps, tick)
  │   → ExplainableAllocationResult { plans: AllocationPlan[], reasons, totalAllocated }
  │   ├── TOCTOU 防护：本地 Map 递减
  │   ├── Operation Storm 防护：MAX_GLOBAL=20, MAX_PER_SOURCE=3, MAX_PER_TARGET=3
  │   └── 7 因子：Criticality(40%) + Priority(20%) + Remaining(15%) + Deadline(10%) + Starvation(10%) + Health(5%)
  │
  ├── createOperation() → OperationContext (type="supply")
  ├── createReservation() → ReservationTable
  ├── submitCarrierSpawn() → spawn/queue.ts
  │
  ├── 生命周期管理：
  │   markReady → markRunning → markVerifying → markCompleted/markFailed
  │   checkExpiry / retryFromBlocked / sweepExpired
  │
  ├── computeNetworkHealth(snapshot, operations, tick)
  │   → NetworkHealthResult { level: healthy|constrained|degraded|critical, score }
  │
  └── saveOperations() / saveReservations() → Memory.kernel.agendas / reservations
```

### 13.3 Expansion Intelligence 链（每 100 tick）

```
expansion-planner.ts (System, P1, interval=100)
  │
  ├── queryEmpirePlannerInput()  ← 消费 empire-economy 产出
  │
  ├── evaluateExpansionPressure()
  │   → ExpansionPressureResult { level: LOW|MEDIUM|HIGH, evidence }
  │
  ├── discoverCandidates(intelBySponsor, existingCandidates, tick)
  │   → DiscoveryResult { candidates: ExpansionCandidateV2[], newCount, updatedCount }
  │
  ├── scoreCandidates(evaluable, {}, tick)
  │   → scored candidates (七因子：sourceValue + mineralValue + distanceScore + neighborSafety - rivalProximity + defensibility + layoutFitness)
  │
  ├── rankCandidates(allCandidates, tick)
  │   → RankedCandidate[]
  │
  ├── estimateExpansionCost(topCandidate)
  │   → ExpansionCostEstimate { bootstrap, travel, spawn, infra, totalCost }
  │
  ├── evaluatePayback(candidate, cost)
  │   → PaybackResult { paybackTicks, roi, worthwhile }
  │
  ├── evaluateRisk(candidate, cost, reserve, intelAge, maxAge)
  │   → RiskResult { score, level: LOW|MEDIUM|HIGH, evidence }
  │
  ├── computeTieredBudget(budget)
  │   → TieredExpansionBudget { emergency, core, operational, available, coreInvaded }
  │
  ├── evaluateExpansionReadinessExtended(topCandidate, cost, risk, tieredBudget)
  │   → G12(候选评分) + G13(预算≥成本) + G14(风险可接受) + G15(Core Reserve 安全)
  │
  ├── createPlan() → ExpansionPlan (status=EVALUATED)
  ├── applyHysteresis() →推进 EVALUATED → READY
  ├── explainDecision() → APPROVE → APPROVED → WAITING_EXECUTION
  │
  └── Memory.kernel.expansionPlans + expansionCandidates + expansionDashboard
```

### 13.4 Remote Mining 链（每 10 tick）

```
remote-mining-manager.ts (System, P2, interval=10)
  │
  ├── 全帝国跨房去重：globalActiveTargets = Set(active remoteOps targets)
  ├── 我方殖民地集合：ownedRooms = Set(controller.my rooms)
  │
  ├── 逐房处理：
  │   ├── maintainExistingOps(remoteOps, intel, tick, username)
  │   │   → selfClaimed / hostileReserved 检测 → abandoned
  │   │   → censusStalledOps() → 空转止损
  │   │
  │   ├── reevaluateActiveOps() → 用当前 pathCost + body 运力重算 netScore/haulerNeed
  │   │
  │   ├── selectRemoteTargets() (如果 activeCount < maxOps)
  │   │   → RemoteCandidate[] { roomName, sources, netScore, haulerNeed }
  │   │   └── 评分公式：netScore = sourceIncome - harvesterUpkeep - haulerUpkeep - reserverUpkeep - defenderUpkeep - roadUpkeep
  │   │
  │   └── evaluateRemoteDemand()
  │       → spawn 请求：remoteHarvester / remoteHauler / reserver / remoteDefender / coreClearer
  │
  └── Memory.rooms[home].remoteOps = { [target]: RemoteOp }
```

### 13.5 当前资源流全景

```
                    ┌─────────────────────────────────────────┐
                    │          EMPIRE ECONOMIC FLOW             │
                    └─────────────────────────────────────────┘

  Room A (surplus)                    Room B (deficit)
  ┌──────────┐                       ┌──────────┐
  │ Sources  │                       │ Sources  │
  │  ↓       │                       │  ↓       │
  │ Harvest  │                       │ Harvest  │
  │  ↓       │                       │  ↓       │
  │ Storage  │─── Operation ───────→ │ Storage  │
  │ (surplus)│   (carrier)           │ (deficit)│
  └──────────┘                       └──────────┘
       ↑                                  ↑
       │ canExportEnergy=true             │ needsEnergyAid=true
       │                                  │
  ┌────┴──────┐                      ┌────┴──────┐
  │SupplyNode │── AllocationPolicy →│DemandNode │
  │           │   (7-factor score)  │           │
  └───────────┘                      └───────────┘

  Remote Mining:
  ┌──────────┐    remoteHarvester    ┌──────────┐
  │ Remote   │ ←─────────────────── │ Home Room│
  │ Source   │    remoteHauler       │ (sponsor)│
  │ (source) │ ──────────────────→  │ Storage  │
  └──────────┘    energy flow       └──────────┘

  问题：所有流都是临时 Operation，无长期供应关系
  A4.0 需要：Supply Contract 建立长期 Route
```

---

## 14. 分类矩阵

### 14.1 Already Exists（可复用）— 44 项

见 §10.1 完整清单。

### 14.2 Missing（需新建）— 18 项

见 §11.1 完整清单。

### 14.3 Reusable（需适配但无需重写）

| 能力 | 当前状态 | A4.0 适配 |
| --- | --- | --- |
| `RoomEconomicProfile` | 4 分类（core/production/candidate/struggling） | 扩展增加 `empireRole` 字段 |
| `RoomRegistryEntry` | 无 Role 字段 | 扩展增加 `empireRole` 字段 |
| `EmpirePlannerInput` | 无 Role/Contract/Balance 字段 | 扩展增加 3 个可选字段 |
| `EmpireResourceView` | 4 分类统计 | 扩展增加 `roleBreakdown` 字段 |
| `AllocationPolicy` | 7 因子不含 Role | scoreSupplyForDemand 增加 Role 匹配度因子 |
| `global-cache` | 无 specialization 缓存 | 增加 `specializationDashboard` heap 字段 |
| `bootstrap.ts` | 无 specialization-planner | 注册新 System（P1, interval=100） |
| `global.d.ts` | 无 Contract/Opportunity Memory | 增加 KernelMemory 字段 |

### 14.4 Conflict（架构冲突）

| 冲突 | 严重度 | 解决方案 |
| --- | --- | --- |
| **RoomEconomicClass vs EmpireRoomRole 语义重叠** | 🟡 中 | `RoomEconomicClass` 保留为发展阶段标记，`EmpireRoomRole` 作为新增的经济职能分工。两者正交，互不替代。 |
| **临时 Operation vs 长期 Supply Contract** | 🟡 中 | Supply Contract 作为 Operation 的上层编排：Contract 定义长期关系，Operation 仍是单次执行单元。Contract 驱动 Operation 的创建和优先级。 |
| **Remote Mining Manager 直接管理 vs Operation 驱动** | 🟡 中 | A4.0 不改变现有 remote-mining-manager 执行链。新增 Remote Opportunity Planner 作为评估层，产出 WAITING_EXECUTION 状态的 Opportunity。未来 A4.1 将执行层迁移到 Operation。 |

### 14.5 Technical Debt

| 债务 | 来源 | 影响 | A4.0 处理 |
| --- | --- | --- | --- |
| `RoomEconomicClass` 仅 4 分类、无职能维度 | A2 后半设计 | 无法支撑专业化决策 | 新增 `EmpireRoomRole` 正交维度 |
| Resource Network 只有临时 Operation | A3.1 设计 | 无法维护长期供应关系 | 新增 Supply Contract 层 |
| 无 Transport Cost Model | 从未实现 | 无法评估 Route 效率 | 新建纯函数模块 |
| 无 Remote Source 抽象 | remote-mining-manager 直接管理 | 无法评估 Remote Opportunity | 新建 Remote Source Model |
| expansion-planner `reason: "resource"` 硬编码 | A3.2 技术债 | 未从 Pressure 推导真实动机 | A4.0 不修复（不在范围） |
| expansion-planner `hasAdversaryPressure: false` 硬编码 | A3.2 技术债 | 同上 | 同上 |

### 14.6 Required Changes

| # | 变更 | 位置 | 说明 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | 新建 EmpireRoomRole 枚举 | `src/domain/economy/empire-role.ts` | CORE/PRODUCTION/SUPPORT/REMOTE | P0 |
| 2 | 新建 Role Evaluation | `src/domain/economy/role-evaluation.ts` | 从 Room Characteristics 推导 Role Scores | P0 |
| 3 | 新建 Role Stability | `src/domain/economy/role-stability.ts` | Hysteresis + minDuration + 重评 | P0 |
| 4 | 新建 Supply Contract Model | `src/domain/economy/supply-contract.ts` | source/target/rate/reserve/priority/status | P0 |
| 5 | 新建 Contract Lifecycle | `src/domain/economy/contract-lifecycle.ts` | 6 状态 + Producer/Consumer Failure | P0 |
| 6 | 新建 Transport Cost Model | `src/domain/economy/transport-cost.ts` | Distance + Body + Energy + Time | P1 |
| 7 | 新建 Route Efficiency | `src/domain/economy/route-efficiency.ts` | Delivered / Cost | P1 |
| 8 | 新建 Remote Source Model | `src/domain/remote/remote-source.ts` | 12+ 字段 + 5 状态 | P1 |
| 9 | 新建 Remote Resource Value | `src/domain/remote/remote-value.ts` | Net Value 计算 | P1 |
| 10 | 新建 Remote Opportunity | `src/domain/remote/remote-opportunity.ts` | Intel → Source → Eval → Opportunity | P1 |
| 11 | 新建 Opportunity Ranking | `src/domain/remote/opportunity-ranking.ts` | 多候选排序 + 可解释 | P1 |
| 12 | 新建 Empire Economic Balance | `src/domain/strategy/empire-balance.ts` | 总生产/消费/运输/储备 | P1 |
| 13 | 新建 Local Resilience Policy | `src/domain/economy/local-resilience.ts` | Emergency Production 保留 | P1 |
| 14 | 新建 Specialization Dashboard | `src/domain/economy/specialization-dashboard.ts` | 全链路可观测性 | P2 |
| 15 | 新建 Specialization Planner System | `src/systems/specialization-planner.ts` | P1 系统薄壳 | P2 |
| 16 | 扩展现有 Profile/Registry/View/Input | 多文件 | 增加 Role/Contract/Balance 字段 | P0 |
| 17 | 扩展 Allocation Policy | `allocation-policy.ts` | 增加 Role 匹配度因子 | P1 |
| 18 | 扩展 bootstrap + global.d.ts | `bootstrap.ts`, `global.d.ts` | 注册新系统 + Memory 字段 | P2 |

### 14.7 Deferred

见 §12.1 完整清单。

---

## 15. A4.0 实施路线图

### 15.1 Phase 1 — Empire Room Role Foundation

```
empire-role.ts          → EmpireRoomRole 枚举 + Role Characteristics
role-evaluation.ts      → CORE/PRODUCTION/SUPPORT/REMOTE Score 计算
role-stability.ts       → Hysteresis + minDuration + 重评
role-transition.ts      → Role 变更条件 + 滞回
```

### 15.2 Phase 2 — Supply Contract Foundation

```
supply-contract.ts      → Contract Model (source/target/rate/reserve/priority/status)
contract-lifecycle.ts   → 6 状态状态机 + Producer/Consumer Failure Detection
transport-cost.ts       → Distance + Body + Energy + Time Cost
route-efficiency.ts     → Delivered / Cost 比率
```

### 15.3 Phase 3 — Remote Economy Foundation

```
remote-source.ts        → Remote Source Model (12+ 字段 + 5 状态)
remote-value.ts         → Net Value = Yield - Transport - Risk - Infra
remote-opportunity.ts   → Intel → Source → Eval → Opportunity → WAITING_EXECUTION
opportunity-ranking.ts  → 多候选排序 + 可解释
```

### 15.4 Phase 4 — Empire Economic Balance

```
empire-balance.ts       → Total Production/Consumption/Transport/Reserve → Net Value
local-resilience.ts     → Emergency Production 保留策略
```

### 15.5 Phase 5 — Integration & Observability

```
specialization-dashboard.ts  → 全链路可观测性
specialization-planner.ts    → P1 系统薄壳
bootstrap.ts                 → 注册新系统
global.d.ts                  → Memory schema 扩展
```

### 15.6 Phase 6 — Testing

```
A4.0-001 ~ A4.0-020     → 20+ Contract Tests
5 Room Simulation        → CORE/PRODUCTION/SUPPORT/REMOTE/CORE 场景
10k Tick Stability       → Role Oscillation / Contract Leak / CPU / Memory
```

---

## 16. A4.0 目标架构

```
                 EMPIRE
                    │
        ┌───────────┼───────────┐
        ↓           ↓           ↓
      CORE       PRODUCTION   SUPPORT
        │           │           │
        │           ↓           │
        │      Resource Flow    │
        │     (Supply Contract) │
        │           │           │
        └───────────┼───────────┘
                    ↓
                 REMOTE
                    │
                    ↓
           Remote Opportunity
              (WAITING_EXECUTION)
                    │
                    ↓
              Resource Network
           (Supply/Demand Nodes)
                    │
                    ↓
              Empire Economy

新层级：
  Room State → Economic Profile → Role Evaluation → Specialization
  → Supply Contract → Empire Economic Plan

复用层：
  Resource Network (SupplyNode/DemandNode/AllocationPolicy)
  + Logistics (Request Pool + assignment-service)
  + Spawn Manager
  + Operation Lifecycle
```

---

## 17. 结论

### 17.1 审计回答

| # | 问题 | 回答 |
| --- | --- | --- |
| 1 | 当前 Room 是否已经有 Role？ | ⚠️ 有 `RoomEconomicClass`（发展阶段分类），无 `EmpireRoomRole`（经济职能分工） |
| 2 | Room Role 是否真正影响经济决策？ | ❌ 仅影响 canExport/needsAid 谓词 + 健康度统计，不影响 Production/Allocation/Logistics 策略 |
| 3 | 当前 Empire 是否知道每个 Room 的生产能力？ | ⚠️ 有 estimatedIncome + nominalCapacity + bottleneck，但缺 Net Production 和 Remote Contribution |
| 4 | 当前 Empire 是否知道每个 Room 的资源需求？ | ⚠️ 有瞬时 Demand + netFlow + riskBuffer，但缺长期需求模式和 Role-specific 需求 |
| 5 | Resource Network 是否支持长期供应关系？ | ❌ 只有临时 Operation（单次调拨），无 Supply Contract |
| 6 | 是否支持 Remote Resource Source？ | ⚠️ 有远矿运营系统，但无独立 Remote Source Model / Opportunity 评估 |
| 7 | 当前 Logistics 是否支持长期 Route？ | ❌ 只有单次 Operation 搬运，无长期 Route 维护 |
| 8 | 当前 Room Economy 是否能区分 Core/Support/Production？ | ❌ `RoomEconomicClass` 只按发展阶段分类，不按经济职能分工 |
| 9 | 当前 Empire Planner 是否支持 Specialization？ | ❌ 只做余缺检测 + 预算分配 + 扩张就绪度，无 Role 评估和专业化规划 |
| 10 | 哪些能力已经存在？ | ✅ 44 项可复用能力（见 §10.1） |
| 11 | 哪些需要新增？ | ✅ 18 个新模块（见 §11.1） |
| 12 | 哪些应该延迟？ | ✅ 11 项延迟（见 §12.1） |

### 17.2 架构裁决

| 裁决 | 决定 |
| --- | --- |
| 是否新建 Resource Network？ | ❌ 不新建——复用现有 SupplyNode/DemandNode/AllocationPolicy，Supply Contract 作为上层编排 |
| 是否新建 Logistics？ | ❌ 不新建——复用现有 Request Pool + assignment-service + carrier |
| 是否新建 Spawn 系统？ | ❌ 不新建——复用现有 spawn-manager |
| `RoomEconomicClass` 是否保留？ | ✅ 保留为发展阶段标记，`EmpireRoomRole` 作为新增正交维度 |
| Remote Mining 是否改变执行链？ | ❌ A4.0 不改变 remote-mining-manager，只新增 Opportunity Planner 评估层 |
| 是否新建 System？ | ✅ 新建 `specialization-planner`（P1, interval=100） |
| Contract 驱动方式？ | Contract → Operation → Carrier（Contract 编排 Operation，Operation 仍是执行单元） |
| Role 评估频率？ | 每 100 tick（与 empire-economy 同频），不每 tick 重算 |
| Role 滞回机制？ | Hysteresis + minDuration（与 Colony Phase / Expansion Plan 同模式） |

### 17.3 实施优先级

1. **EmpireRoomRole + Role Evaluation + Role Stability**（核心基础）
2. **Supply Contract Model + Lifecycle + Failure Detection**（核心交付物）
3. **Transport Cost + Route Efficiency**（Contract 支撑）
4. **Remote Source Model + Resource Value + Opportunity + Ranking**（Remote 基础）
5. **Empire Economic Balance + Local Resilience**（帝国级计算）
6. **Specialization Dashboard + Planner System + Integration**（集成与可观测性）
7. **20+ Contract Tests + 5 Room Simulation + 10k Tick Stability**（验证）

---

**Audit 完成。** 下一步：按优先级实施 A4.0。

---

## 18. 架构设计修订：统一经济节点模型（Phase 2 方向校正）

> 日期：2026-08-24。修订原因：Phase 1 实施后重新审视架构，确认 A4.0 的核心价值
> 不是"做远矿功能"或"做 Supply Contract 功能"，而是**让所有经济活动统一为
> Empire Resource Network 上的生产/消费节点**。

### 18.1 核心原则

A4.0 的真正目标是建立**统一经济节点模型**：

```
                    Empire Resource Network
                           │
         ┌─────────────────┼─────────────────┐
         ↓                 ↓                 ↓
    Energy Nodes      Mineral Nodes     Remote Nodes
    (现有 SupplyNode/   (未来 Factory/    (Remote Source →
     DemandNode)        Lab 产出/消费)    SupplyNode 注入)
         │                 │                 │
         ↓                 ↓                 ↓
    AllocationPolicy (统一分配策略)
         │
         ↓
    Operation (统一执行单元)
         │
         ↓
    Logistics (统一物流层 — Request Pool + assignment-service)
```

**关键洞察**：Remote Mining、Mineral、Terminal、Factory 甚至 Military Supply
都应该是这个网络上的不同生产/消费节点类型，而不是各自独立的子系统。

### 18.2 Supply Contract 的正确定位

Supply Contract **不是一个新的独立系统**——它是现有链条的上层编排协议：

```
当前链路（临时调拨）：
  SupplyNode → DemandNode → AllocationPolicy → Operation → Logistics
  （每 100 tick 重建，无记忆）

A4.0 链路（Contract 编排）：
  Supply Contract（长期关系定义）
    ↓ 驱动
  SupplyNode + DemandNode（Contract 持续注入节点）
    ↓ 统一分配
  AllocationPolicy（含 Role 匹配度因子）
    ↓ 统一执行
  Operation（Contract 驱动的 supply Operation）
    ↓ 统一物流
  Logistics（不改变 — Request Pool + assignment-service）
```

Supply Contract 做的事：
1. **定义长期供应关系**：source 房 → target 房，targetRate，minimumReserve
2. **驱动节点注入**：每周期将 Contract 的 source/target 注入为 SupplyNode/DemandNode
3. **监控健康度**：Producer 失败时 DEGRADE，Consumer 不再需要时 COMPLETED
4. **不替代 AllocationPolicy**：Contract 定义"谁应该供应谁"，AllocationPolicy 仍然决定"本周期供应多少"

### 18.3 Remote Source 的正确定位

Remote Source Model **不是独立的远矿经济系统**——它是将远矿产出
**注入 Empire Resource Network** 的适配器：

```
当前远矿链路（独立子系统）：
  remote-mining-manager → spawn remoteHarvester/remoteHauler → Memory.rooms[r].remoteOps
  （远矿产出直接进 storage，不经过 Resource Network）

A4.0 远矿链路（网络节点化）：
  Remote Source Model（远矿资源实体抽象）
    ↓ 评估
  Remote Resource Value（净价值 = 产出 - 运输 - 风险）
    ↓ 排名
  Remote Opportunity（WAITING_EXECUTION）
    ↓ 执行层不改变（remote-mining-manager 继续运营）
    ↓ 产出侧
  Remote Source → SupplyNode 注入（远矿产出作为网络供给节点）
```

Remote Source 做的事：
1. **抽象远矿资源实体**：sourceId/roomName/capacity/distance/risk/expectedYield
2. **评估净价值**：不重复 remote-mining-manager 的运营逻辑，只做经济评估
3. **产出 SupplyNode**：远矿产出通过 Remote Source 转换为 SupplyNode 注入网络
4. **不替代 remote-mining-manager**：运营执行层不变，Remote Source 是评估+注入层

### 18.4 ResourceType 扩展路径

当前 `ResourceType = "energy"` 是正确的起点，但必须设计为可扩展：

```typescript
// 当前（A4.0）
export type ResourceType = "energy";

// 未来路径（A4.1+）
export type ResourceType = "energy" | MineralResourceType | CommodityResourceType;
```

SupplyNode/DemandNode/AllocationPolicy/Operation 的字段已经是 `ResourceType` 类型，
扩展时只需扩展类型联合——不需要修改数据结构。

### 18.5 修订后的 Phase 2 实施方向

Phase 2 — Supply Contract Foundation 的设计原则：

1. **Supply Contract 是编排层，不是执行层**
   - Contract 定义长期供应关系（source/target/rate/reserve/priority/status）
   - Contract 驱动 SupplyNode/DemandNode 的注入（每周期由 Contract 生成节点）
   - Contract 不替代 AllocationPolicy 的分配决策
   - Contract 不替代 Operation 的执行逻辑
   - Contract 不替代 Logistics 的搬运机制

2. **Contract Lifecycle 是状态机，不是新的 Operation 类型**
   - PROPOSED → ACTIVE → DEGRADED → SUSPENDED → COMPLETED → CANCELLED
   - ACTIVE 状态下每周期注入 SupplyNode/DemandNode
   - DEGRADED 状态下降低 targetRate
   - SUSPENDED 状态下停止注入节点
   - 不新增 OperationType——Contract 驱动的仍是 `type="supply"` Operation

3. **Transport Cost Model 服务于 Contract 决策，不替代 Logistics**
   - 评估 Route 效率：Delivered vs Cost
   - 供 Contract 决策"这条长期路线值不值得维持"
   - 不替代 Logistics 的 Request Pool 分配

4. **Contract Failure Detection 复用现有事件系统**
   - Producer 进入 CRITICAL → 复用 `room-critical` ReplanEvent
   - Consumer 不再需要 → 复用 `target-satisfied` ReplanEvent
   - 不新建独立的事件检测系统

### 18.6 修订后的 Phase 3 实施方向

Phase 3 — Remote Economy Foundation 的设计原则：

1. **Remote Source 是评估层，不是执行层**
   - 从 RoomIntel + remoteOps 数据派生 Remote Source Model
   - 评估净价值（ExpectedYield - TransportCost - Risk）
   - 排名 Opportunity（WAITING_EXECUTION）
   - 不改变 remote-mining-manager 的执行链

2. **Remote Source 产出 SupplyNode，不自己调拨**
   - 远矿产出通过 Remote Source → SupplyNode 转换注入网络
   - AllocationPolicy 统一决定远矿能量如何分配
   - 不在 Remote Source 模块内做任何调拨决策

3. **Remote Opportunity 是规划产物，不直接执行**
   - Opportunity 状态 = WAITING_EXECUTION
   - 由 specialization-planner 评估后决定是否开新远矿
   - 开新远矿仍走 remote-mining-manager 的 selectRemoteTargets
