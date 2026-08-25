# A4.4 Runtime Architecture Audit — Empire Logistics Validation & Convergence

> 日期：2026-08-25。阶段：A4.4 — Empire Logistics Validation & Convergence。
> 基线：A4.3 已完成 32 个 domain 层纯函数模块 + 1 个系统层薄壳 + 4 个旧系统适配器接入。
> 方法论：逐文件追踪真实运行时调用链，不依赖文件名或设计文档猜测。每个结论标注源码路径与行号。

---

## 0. 审计方法论

本审计追踪以下运行时路径：

1. **logistics-planner.ts**（P1, interval=100）→ 产出 TransportPlan 写入 globalCache
2. **logistics.ts**（P0, interval=1）→ 消费 Plan scope="room" + 独立产出 V1 TransportRequest
3. **agenda-manager.ts**（P1, interval=100）→ 消费 Plan scope="empire" + 独立 allocateNetwork
4. **remote-mining-manager.ts**（P2, interval=10）→ 消费 Plan scope="operation" + 独立 haulerNeed
5. **terminal-manager.ts**（P3, interval=200）→ 消费 Plan terminal 请求 + 独立 planEnergyAid/planMineralAid

---

## 1. Current Runtime Flow — 真实运行时调用链

### 1.1 系统执行顺序（bootstrap.ts 注册顺序）

```
bootstrap.ts 注册顺序（同优先级按注册顺序执行）：
  P0: roomStateSystem
  P1: economySystem
  P0: spawnManagerSystem
  P0: towerDefenseSystem
  P1: empireStrategySystem
  P1: empireEconomySystem
  P1: agendaManagerSystem           ← 步 A：产出 networkSnapshot
  P0: logisticsSystem               ← 步 B：每 tick 产出 transportPool
  P1: logisticsPlannerSystem        ← 步 C：每 100t 产出 logisticsPlan
  P1: assignmentServiceSystem       ← 步 D：合并 transportPool → assignment
  ...
  P2: remoteMiningManagerSystem     ← 步 E：每 10t 产出远矿 spawn 请求
  ...
  P3: terminalManagerSystem         ← 步 F：每 200t 执行 terminal.send / market.deal
```

### 1.2 每 100 tick 的物流决策流（logistics-planner 运行时）

```
logisticsPlannerSystem.run(ctx) [logistics-planner.ts:90]
  │
  ├── 1a. collectContracts() [L95]
  │   → Memory.kernel.supplyContracts → 返回 SupplyContract[]
  │   ⚠️ 当前 Memory.kernel.supplyContracts 永远为空（无人写入）
  │
  ├── 1b. 读取 globalCache().networkSnapshot [L98]
  │   → surpluses = networkSnapshot.supplyNodes（来自 agenda-manager 步 A）
  │   → deficits = networkSnapshot.demandNodes
  │
  ├── 1c. collectCapacityInputs() [L103]
  │   → 从 Game.creeps + RoomSnapshot 提取运力规划输入
  │
  ├── 1d. planEmpireCapacity() [L106]
  │   → 产出 EmpireCapacityResult
  │
  ├── 1e. refreshRouteCache() [L110]
  │   → 从 Game.map.getRoomLinearDistance 重建路由
  │
  ├── 1f. collectThreats() [L113]
  │   → 从 RoomSnapshot.threatCreeps 提取威胁等级
  │
  ├── 2. planLogistics(plannerInput) [L126]
  │   → 纯函数：从 contracts + deficits + surpluses 派生 TransportRequestV2[]
  │   → 输出 TransportPlan { requests, routes, assignments: [] }
  │   ⚠️ contracts 为空 → 只从 deficits 派生 Ad-hoc Request
  │   ⚠️ deficits/surpluses 来自 agenda-manager（energy-only）
  │
  ├── 3-9. 计算 Health / Bottleneck / Starvation / Idle / Scaling / Dashboard
  │
  └── 10. 写入 globalCache [L207-213]
      → g.logisticsPlan = { tick, plan }
      → g.logisticsDashboard
      → g.logisticsHealth
      → g.logisticsCapacity
      → g.logisticsScaling
      → g.logisticsIdleHaulers
```

### 1.3 每 tick 的房内物流执行流（logistics.ts 运行时）

```
logisticsSystem.run(ctx) [logistics.ts:69]
  │
  ├── 遍历 Game.creeps → 投影 hauler 租约 [L77-90]
  │
  ├── 遍历 ctx.snapshots() [L92]
  │   ├── 采集 SupplySource（container） [L98-105]
  │   ├── 采集 towerStarving [L108-110]
  │   ├── buildTransportRequests() [L112] → V1 TransportRequest[]
  │   ├── applyShrink() [L127]
  │   ├── reconcileRegistry() [L131]
  │   ├── 写入 g.transportPool.rooms[roomName] [L152]
  │   │
  │   └── A4.3 Plan 合并 [L154-170]
  │       → 读取 globalCache().logisticsPlan?.plan
  │       → 仅当 plan.plannedAt === ctx.tick（本 tick 产出的 Plan）
  │       → 筛选 scope="room" && destination.room === roomName
  │       → planRequestToTaskEntry() 适配为 AssignmentTaskEntry
  │       → 追加到 g.transportPool.rooms[roomName]
  │       ⚠️ 仅在 logistics-planner 运行的 tick（100t 间隔）才会合并
  │       ⚠️ 非 Plan tick → logistics.ts 完全走 V1 逻辑
```

### 1.4 每 100 tick 的跨房调拨执行流（agenda-manager.ts 运行时）

```
agendaManagerSystem.run(ctx) [agenda-manager.ts:258]
  │
  ├── 步 0-5: 加载/清理 Operations + Reservations
  ├── 步 6-8: 构建 RoomEconomicProfile + RoomRegistry
  │
  ├── 步 9: buildSupplyNodes() + buildDemandNodes() [L378-379]
  │   ⚠️ 硬编码 resource: "energy"（SupplyNode/DemandNode 未扩展多资源）
  │
  ├── 步 10: buildNetworkSnapshot() [L382]
  │   → 写入 globalCache().networkSnapshot（供 logistics-planner 消费）
  │
  ├── 步 11: decideRebalance()
  │
  ├── 步 12: allocateNetwork() [L426]
  │   → 独立 Allocation Policy v2（7 因子可解释分配）
  │   → 产出 ExplainableAllocationResult.plans[]
  │   ⚠️ 这是独立的跨房调拨决策器，不读 logisticsPlan
  │
  ├── 步 13: 从 allocResult 创建 Operation + Reservation [L441-488]
  │   → createOperation(type="supply", resource="energy")
  │   → 幂等去重 hasActiveOperation()
  │   → TOCTOU 防护
  │
  ├── 步 13.5: A4.3 Plan 驱动的 Operation 创建 [L491-541]
  │   → 读取 globalCache().logisticsPlan?.plan
  │   → 筛选 scope="empire" 的请求
  │   → 为每个请求创建 Operation（补充 allocation-policy 的 energy-only 局限）
  │   ⚠️ 与步 12 并行运行——两个决策源可能同时创建 Operation
  │   ⚠️ 幂等去重保护：hasActiveOperation() 防同一 (source, target, resource) 重复
  │
  ├── 步 14: 路由计算 + carrier spawn [L543-578]
  │   → submitCarrierSpawn() → spawn/queue.ts
  │
  ├── 步 15: 验证 running Operation [L580-640]
  │   → carrier 空载推断送达
  │   ⚠️ 仍然用 carrier 空载推断，未接入 Delivery Validation
  │
  └── 步 16-19: 清理 + 保存 + 可观测性
```

### 1.5 每 10 tick 的远矿搬运执行流（remote-mining-manager.ts 运行时）

```
remoteMiningManagerSystem.run(ctx) [remote-mining-manager.ts:25]
  │
  ├── 遍历 ctx.snapshots()
  │   ├── maintainExistingOps() [L57]
  │   ├── censusStalledOps() [L62]
  │   ├── reevaluateActiveOps() [L114] → 独立 haulerNeed 计算
  │   │   → scoreRemoteCandidate() → netScore + haulerNeed
  │   │   ⚠️ 独立的远矿运力决策，不读 logisticsPlan
  │   │
  │   ├── selectRemoteTargets() [L120] → 独立评选新目标
  │   ├── evaluateRemoteDemand() [L275] → 独立 spawn 请求
  │   │   → submitRequest(queue, req) → spawn/queue.ts
  │   │
  │   └── A4.3 Plan 消费 [L295-316]
  │       → 读取 globalCache().logisticsPlan?.plan
  │       → 筛选 scope="operation" 的请求
  │       → 如果 Plan 指示的 haulerNeed > 现有 → 覆写 haulerNeed
  │       ⚠️ 只增不减——Plan 可提高远矿编制但不降低
  │       ⚠️ 与 reevaluateActiveOps 并行——两个 haulerNeed 决策源
```

### 1.6 每 200 tick 的 Terminal 执行流（terminal-manager.ts 运行时）

```
terminalManagerSystem.run(ctx) [terminal-manager.ts:78]
  │
  ├── tryNukeSalvage() [L81] → terminal.send（独立决策，不读 Plan）
  │
  ├── refreshMarketPrices() [L93]
  │
  ├── tryEmpireEnergyAid() [L96] → planEnergyAid() → terminal.send
  │   ⚠️ 独立决策能量跨房互济，不读 logisticsPlan
  │
  ├── tryEmpireMineralAid() [L99] → planMineralAid() → terminal.send
  │   ⚠️ 独立决策矿物跨房互济，不读 logisticsPlan
  │
  ├── 遍历 ctx.snapshots() [L107]
  │   ├── tryManageSellOrders() [L113]
  │   │
  │   ├── A4.3 Plan 驱动候选 [L119-128]
  │   │   → collectPlanTerminalRooms(logisticsPlan)
  │   │   → 如果本房在 Plan 的 terminal 请求中
  │   │   → 注入 plan-driven-send 候选（priority=200，最高优先级）
  │   │   → tryPlanDrivenSend() 执行 terminal.send
  │   │
  │   ├── 自主市场候选（priority 45/40/35/30/25）[L131-159]
  │   │   → trySellSurplusEnergy / trySellHomeMineral / ...
  │   │
  │   ├── 买入候选（priority 动态）[L162-203]
  │   │
  │   └── executeBestCandidate(candidates) [L208]
  │       → 按 priority 降序逐个尝试执行
  │       → Plan 驱动 priority=200 > 自主市场 priority≤50
  │       ⚠️ Plan 驱动时自主市场被抑制（terminal 冷却被占用）
  │       ⚠️ Plan 不存在时完全走自主决策
  │
  └── trySellPixel() [L213]
```

---

## 2. Decision Authority 矩阵 — 谁负责决策

| 决策维度 | 应归 Unified Planner | 实际归谁 | 状态 |
| --- | --- | --- | --- |
| **产生 Demand** | ✅ 应由 Resource Network | agenda-manager (energy) + terminal-manager (mineral) + lab-system (procurement) | ⚠️ 分散 |
| **生成 TransportRequestV2** | ✅ 应由 Planner | logistics-planner 产出 V2 + logistics.ts 产出 V1 | 🔴 **Duplicate** |
| **创建 Assignment** | ✅ 应由 Planner | logistics-planner 产出空 assignments + assignment-service 独立分配 | 🔴 **Bypass** |
| **创建 Operation** | ✅ 应由 Planner → agenda-manager 适配 | agenda-manager 步 12 独立 + 步 13.5 Plan 驱动 | 🔴 **Duplicate** |
| **Spawn Hauler** | ✅ 应由 Planner 决策量 | spawn-manager (hauler) + agenda-manager (carrier) + remote-mining (remoteHauler) | 🔴 **Triple Decision** |
| **执行 Transfer** | ✅ 应由 Execution Layer | hauler/carrier/remoteHauler 各自直接 transfer/withdraw | ⚠️ 分散但合理 |
| **确认 Delivery** | ✅ 应由 Delivery Validation | agenda-manager 用 carrier 空载推断 | 🔴 **Bypass** |
| **更新 Ledger** | ✅ 应由 Transport Accounting | 无运行时 Accounting 追踪 | 🔴 **Missing** |
| **触发 Replan** | ✅ 应由 Feedback Loop | 无自动 Replan 机制 | 🔴 **Missing** |
| **Route 决策** | ✅ 应由 RouteCache | logistics-planner RouteCache + agenda-manager routeCache | 🔴 **Duplicate Cache** |

---

## 3. Bypass List — 绕过 Unified Logistics Network 的代码

### 3.1 BYPASS-001: logistics.ts V1 TransportRequest 独立产出

- **文件**：`src/systems/logistics.ts:112`
- **行为**：`buildTransportRequests()` 每 tick 独立产出 V1 TransportRequest，不读 Plan
- **分类**：**LEGACY**
- **影响**：V1 和 V2 可能同时为同一个 container 积压生成运输请求
- **缓解**：V1 只生成 scope="room" 请求，V2 scope="room" 追加到同一 transportPool——但 V1 先写、V2 后追加，两者不互斥
- **修复建议**：V1 应检查 Plan 是否已覆盖该 source，若覆盖则跳过

### 3.2 BYPASS-002: agenda-manager 独立 allocateNetwork

- **文件**：`src/systems/agenda-manager.ts:426`
- **行为**：步 12 独立调用 `allocateNetwork()`，不读 logisticsPlan
- **分类**：**LEGACY**
- **影响**：步 12 (allocateNetwork) 和步 13.5 (Plan 驱动) 可能同时为不同 (source, target) 创建 Operation
- **缓解**：`hasActiveOperation()` 幂等去重防同一 (source, target, resource) 重复
- **修复建议**：步 12 应在 Plan 存在时降级为 fallback

### 3.3 BYPASS-003: agenda-manager carrier 空载推断 Delivery

- **文件**：`src/systems/agenda-manager.ts:611`
- **行为**：`carrier.store.getUsedCapacity(RESOURCE_ENERGY) === 0` 推断送达完成
- **分类**：**LEGACY**
- **影响**：不验证 target storage 实际收到量；carrier 可能在路上掉能
- **修复建议**：接入 `delivery-validation.ts` 纯函数

### 3.4 BYPASS-004: remote-mining-manager 独立 haulerNeed

- **文件**：`src/systems/remote-mining-manager.ts:114, 275`
- **行为**：`reevaluateActiveOps()` + `evaluateRemoteDemand()` 独立计算远矿运力需求
- **分类**：**LEGACY**
- **影响**：与 Plan scope="operation" 的 haulerNeed 可能冲突
- **缓解**：Plan 只增不减（L307: `if (planHaulerNeed > targetOp.haulerNeed) targetOp.haulerNeed = planHaulerNeed`）
- **修复建议**：reevaluateActiveOps 应作为 Plan 的输入，而非独立决策

### 3.5 BYPASS-005: terminal-manager 独立 planEnergyAid / planMineralAid

- **文件**：`src/systems/terminal-manager.ts:96, 99`
- **行为**：`tryEmpireEnergyAid()` + `tryEmpireMineralAid()` 独立决策跨房互济
- **分类**：**LEGACY**
- **影响**：与 Plan scope="empire" 的 terminal 请求可能重复
- **缓解**：Plan 驱动候选 priority=200 > 自主市场 ≤50，Plan 先执行占用 terminal 冷却
- **风险**：Plan 不运行（非 100t tick）时，自主互济完全独立运行——这是 **DEGRADED MODE** 但未标记

### 3.6 BYPASS-006: terminal-manager tryNukeSalvage

- **文件**：`src/systems/terminal-manager.ts:81`
- **行为**：`tryNukeSalvage()` 独立执行 terminal.send 抢救资产
- **分类**：**INTENTIONAL**
- **理由**：核打击抢救是生存动作，必须先于一切市场/Plan 逻辑

### 3.7 BYPASS-007: hauler 角色 haulMineralTopUp / supplyLabs / withdrawTerminalEnergy

- **文件**：`src/creeps/roles/hauler.ts:185, 204, 172`
- **行为**：hauler acquire/work 链中有矿物搬运、lab 供料、terminal 取能等动作
- **分类**：**INTENTIONAL**
- **理由**：这些是房内微观执行动作，不是跨房运输决策——角色层执行细节

### 3.8 BYPASS-008: distributor 角色 storage→sink 分发

- **文件**：`src/creeps/roles/distributor.ts:65`
- **行为**：distributor 从 storage withdraw energy → 分发到 spawn/extension/tower
- **分类**：**INTENTIONAL**
- **理由**：distributor 是房内微观分发，不走跨房物流链

### 3.9 BYPASS-009: Supply Contract 系统层断裂

- **文件**：`src/systems/specialization-planner.ts`（无 supplyContract 调用）
- **行为**：`createSupplyContract()` 纯函数完整但**从未被系统层调用**
- **分类**：**BUG**（A4.3 设计 §7.3 要求 specialization-planner 驱动 Contract 但未实现）
- **影响**：`Memory.kernel.supplyContracts` 永远为空 → Planner 步 1 (contract→request) 永远不产出
- **修复建议**：specialization-planner 应在评估 Room Profile 后创建 Supply Contract

### 3.10 BYPASS-010: Transport Accounting 无运行时追踪

- **文件**：`src/systems/logistics-planner.ts:380-384`
- **行为**：`collectAccounting(plan)` 只从 Plan 的 requests 创建初始 Accounting（requested=amount, 其余=0），无跨 tick 累积
- **分类**：**BUG**
- **影响**：TransportAccounting 的 loaded/delivered/lost/remaining 永远为 0
- **修复建议**：需要跨 tick 追踪 Assignment 生命周期并更新 Accounting

### 3.11 BYPASS-011: Logistics Health 基于空数据

- **文件**：`src/systems/logistics-planner.ts:133`
- **行为**：`computeLogisticsHealth(accounting, plan.requests, avgLatency, tick)` 输入的 accounting 全为初始值
- **分类**：**BUG**
- **影响**：Health 的 deliveryRate/lossRate/backlogCount 基于 0 值计算——结果不可信

### 3.12 BYPASS-012: Plan 合并时序窗口极窄

- **文件**：`src/systems/logistics.ts:159`
- **行为**：`if (plan && plan.plannedAt === ctx.tick)` — 仅当 Plan 在本 tick 产出时合并
- **分类**：**BUG**
- **影响**：logistics-planner interval=100，只有每 100 tick 的那一 tick Plan 才被合并到 transportPool。其余 99 tick V2 完全不参与房内物流
- **修复建议**：应改为 `plan.plannedAt >= ctx.tick - 100`（与 agenda-manager 步 13.5 的 L495 同口径）

---

## 4. Duplicate Decision List — 重复决策清单

### 4.1 DUPLICATE-001: 跨房调拨双决策器

| 维度 | agenda-manager 步 12 | agenda-manager 步 13.5 (Plan) |
| --- | --- | --- |
| 决策器 | allocateNetwork() | planLogistics() |
| 资源类型 | energy only | 理论上多资源（但 deficits 是 energy-only） |
| Route | 自有 routeCache（无失效条件） | logistics-planner RouteCache |
| 去重 | hasActiveOperation() | hasActiveOperation()（共享） |
| 运行条件 | shouldDoRebalance && supplyNodes>0 && demandNodes>0 | logisticsPlan 存在 && plannedAt >= tick-100 |

**结论**：两个决策器并行运行。当 Plan 存在时，步 12 和步 13.5 同时尝试创建 Operation。幂等去重保护防止重复，但两个决策器的 Route 评估、Cost 计算、Priority 分配可能不一致。

### 4.2 DUPLICATE-002: 房内物流双 Request 源

| 维度 | logistics.ts V1 | logistics.ts V2 (Plan 合并) |
| --- | --- | --- |
| 决策器 | buildTransportRequests() | planLogistics() |
| 触发频率 | 每 tick | 每 100 tick（且仅 plannedAt === tick） |
| Request 模型 | V1 TransportRequest (5 字段) | V2 TransportRequestV2 → 适配为 AssignmentTaskEntry |
| 去重 | key 幂等（"collect:room:containerId"） | requestId（不同格式，不去重 V1） |

**结论**：在 Plan 运行的 tick，V1 和 V2 可能同时为同一个 container 生成运输任务。由于 key/requestId 格式不同，不互斥——hauler 可能看到重复任务。

### 4.3 DUPLICATE-003: 远矿 haulerNeed 双决策

| 维度 | reevaluateActiveOps() | Plan 消费 (L295-316) |
| --- | --- | --- |
| 决策器 | scoreRemoteCandidate() | planLogistics() |
| 计算方式 | pathCost + sources + haulerCapacity → netScore + haulerNeed | Plan amount / 1000 → planHaulerNeed |
| 运行顺序 | 先（L114） | 后（L295） |
| 覆写规则 | 写回 op.haulerNeed | 只增不减（if planHaulerNeed > existing） |

**结论**：Plan 可提高远矿编制但不降低。reevaluateActiveOps 的缩编决策可能被 Plan 覆写。

### 4.4 DUPLICATE-004: Terminal 互济双决策

| 维度 | tryEmpireEnergyAid/tryEmpireMineralAid | tryPlanDrivenSend |
| --- | --- | --- |
| 决策器 | planEnergyAid()/planMineralAid() | planLogistics() |
| 运行顺序 | 先（L96/L99） | 后（L119 候选注入） |
| 优先级 | 无（先执行先占冷却） | priority=200（最高） |
| 冲突保护 | terminal.cooldown > 0 → 跳过 | terminal.cooldown > 0 → 跳过 |

**结论**：tryEmpireEnergyAid 在 Plan 候选之前运行。如果互济已执行，terminal 冷却导致 Plan 驱动的 send 被跳过。**自主互济覆盖 Plan**——与"Plan > 自主"的设计意图相反。

### 4.5 DUPLICATE-005: Route Cache 双实例

| 维度 | agenda-manager routeCache | logistics-planner RouteCache |
| --- | --- | --- |
| 类型 | Map<string, {from, to, hops, reachable}> | RouteCache class（带 TTL/失效条件） |
| 持久化 | heap, 永久 | heap, TTL=5000 |
| 失效条件 | ❌ 无 | ✅ TTL + structureRevision + threat |
| 路由算法 | Game.map.findRoute | Game.map.getRoomLinearDistance（估算） |

**结论**：两个 Route Cache 独立运行，结果可能不一致。agenda-manager 的 cache 永不失效（除非 global reset）。

### 4.6 DUPLICATE-006: Spawn 决策三源

| 维度 | spawn-manager (hauler) | agenda-manager (carrier) | remote-mining (remoteHauler) |
| --- | --- | --- | --- |
| 决策器 | demand.ts evaluateDemand() | Operation 驱动 submitCarrierSpawn() | demand.ts evaluateRemoteDemand() |
| 角色 | hauler | carrier | remoteHauler |
| 信号源 | container 积压 | Operation existence | remoteOps + container 积压 |
| Plan 消费 | ❌ 不读 Plan | ✅ 步 13.5 Plan 驱动 Operation | ⚠️ Plan 只增不减 haulerNeed |

**结论**：三个 Spawn 决策源独立运行。Plan 只间接影响 carrier（通过 Operation）和 remoteHauler（通过 haulerNeed 覆写），不影响 hauler。

---

## 5. Terminal 特别审计

### 5.1 fallback 行为分析

```
Terminal Manager 每 200 tick 运行：

  1. tryNukeSalvage()          ← INTENTIONAL BYPASS（生存优先）
  2. tryEmpireEnergyAid()      ← LEGACY BYPASS（独立决策能量互济）
  3. tryEmpireMineralAid()     ← LEGACY BYPASS（独立决策矿物互济）
  4. Plan 驱动候选注入          ← A4.3 新增
  5. 自主市场候选               ← LEGACY（卖出/买入）
  6. executeBestCandidate()    ← 按 priority 降序执行

Plan 存在时：
  → plan-driven-send priority=200 > 自主 ≤50
  → Plan 先执行（如果 terminal 未被 step 2/3 占用冷却）

Plan 不存在时（99% 的 tick）：
  → 完全走自主决策
  → 无 DEGRADED MODE 标记
  → 无 Fallback Reason 记录
```

### 5.2 Decision Authority 冲突

| 场景 | 谁拥有 Authority | 问题 |
| --- | --- | --- |
| Plan 存在 + terminal 冷却可用 | Plan (priority=200) | ✅ 正确 |
| Plan 存在 + terminal 被 step 2/3 占用 | step 2/3 (先执行) | 🔴 自主互济覆盖 Plan |
| Plan 不存在 | 自主决策 | ⚠️ DEGRADED MODE 但未标记 |
| Plan 与自主互济目标相同 | 先执行者占冷却 | 🔴 可能重复（不同决策器选同一对） |

### 5.3 结论

- Terminal fallback **未标记为 DEGRADED MODE**
- 自主互济（step 2/3）在 Plan 候选之前运行，可覆盖 Plan
- Plan 不运行时（非 100t tick），terminal 完全自主——这是 **LEGACY 模式**但未记录

---

## 6. Remote Mining 特别审计

### 6.1 haulerNeed 决策链分析

```
haulerNeed 生命周期：
  1. selectRemoteTargets() → scoreRemoteCandidate() → haulerNeed（开点时）
  2. reevaluateActiveOps() → scoreRemoteCandidate() → haulerNeed（每 10t 重估）
  3. Plan 消费 → if planHaulerNeed > existing → haulerNeed = planHaulerNeed（每 10t）
  4. evaluateRemoteDemand() → 基于 haulerNeed 生成 spawn 请求
```

### 6.2 haulerNeed 是 Capacity 还是 Demand？

**结论**：haulerNeed 既是 **Capacity Planning**（运力估算）又是 **Demand Decision**（决定 spawn 多少 remoteHauler）。

- `scoreRemoteCandidate()` 公式：`haulerNeed = ceil(demand / perHauler), cap maxHaulers`
  - `demand` = source 产出率（通过 sources × 10 e/tick 估算）
  - `perHauler` = haulerCapacity / roundTripTicks
  - 这是**运力规划公式**（Capacity Planning）

- `evaluateRemoteDemand()` 使用 `haulerNeed` 决定 spawn 数量
  - 这是**执行决策**（Demand Decision）

### 6.3 与 Empire Logistics Planner 的重复

| 维度 | remote-mining-manager | logistics-planner |
| --- | --- | --- |
| 运力估算 | scoreRemoteCandidate() | planRoomCapacity() |
| 公式 | ceil(demand / perHauler) | ceil(productionRate × roundTripTicks / haulerCapacity) |
| 输入 | intel.pathCost + sources + haulerCapacity | RoomSnapshot.sources × 10 + 经验值 20 tick |
| 精度 | ✅ 更精确（用实际 pathCost） | ⚠️ 粗略估算（线性距离 × 50） |

**结论**：remote-mining-manager 的运力估算**更精确**。Plan 的 capacity-planning 是粗略估算，不应覆写远矿的精确计算。当前实现（Plan 只增不减）是安全的但非最优。

### 6.4 最终定位

**Remote Mining 应主要负责**：Operation Execution Context（远矿运营上下文）
**Logistics 应主要负责**：Transport Capacity Planning（帝国级运力规划）

当前状态：Remote Mining 同时拥有 Execution Context + 独立 Capacity Planning。Plan 只作为信号补充（可提高编制），未真正接管决策权。

---

## 7. Agenda Manager 审计

### 7.1 独立 Allocation Policy

```
agenda-manager 步 12: allocateNetwork()
  输入：
    - supplyNodes（energy-only，来自 buildSupplyNodes）
    - demandNodes（energy-only，来自 buildDemandNodes）
    - routes（来自自有 routeCache，无失效条件）
    - activeOpsBySource / activeOpsByTarget
  输出：
    - ExplainableAllocationResult.plans[]：{ sourceRoom, targetRoom, amount, priority, reason }
```

### 7.2 是否只支持 Energy？

**是的**。`buildSupplyNodes()` 和 `buildDemandNodes()` 都硬编码 `resource: "energy"`。

### 7.3 Plan 驱动的补充

步 13.5 从 Plan 筛选 `scope="empire"` 的请求创建 Operation。Plan 的 requests 理论上可包含矿物等非能量资源（如果 deficits 包含非 energy）。但当前 deficits 来自 agenda-manager 自身（energy-only），所以 Plan 也只能产出 energy 请求。

### 7.4 结论

agenda-manager 的 Allocation Policy 是**独立的能量调拨决策器**，Plan 只作为补充（步 13.5）。两者并行运行，幂等去重防重复。**旧 Allocation Policy 未降级为 Adapter**——它仍然是主要决策器。

---

## 8. Room Logistics (logistics.ts) 审计

### 8.1 V1 vs V2 是否同时规划？

**是的**。在 Plan 运行的 tick（每 100t）：

```
logistics.ts run():
  1. buildTransportRequests() → V1 TransportRequest[]（每源一请求）
  2. 写入 g.transportPool.rooms[roomName]
  3. 读取 Plan，筛选 scope="room" 的 V2 请求
  4. planRequestToTaskEntry() 适配为 AssignmentTaskEntry
  5. 追加到 g.transportPool.rooms[roomName]
```

V1 先写入，V2 追加。两者**不互斥**——同一个 container 积压可能在 V1 生成 `collect:room:containerId` 和 V2 生成 `tr:room:roomA:roomA:energy:seq` 两个任务。

### 8.2 V1 是否应降级为 Adapter？

**设计意图**（A4.3 Design §7.1 步 1）：logistics.ts 支持 TransportRequestV2，新增 adapter 将 V2 映射为现有 TransportRequest。

**实际实现**：V2 → AssignmentTaskEntry 适配器存在（`planRequestToTaskEntry`），但 V1 仍然独立产出。V1 **未降级为 Adapter**——它仍然是主要 Request 源。

### 8.3 Plan 合并时序窗口

```typescript
// logistics.ts:159
if (plan && plan.plannedAt === ctx.tick) {
  // 仅消费本 tick 产出的 Plan
```

**严重问题**：`plannedAt === ctx.tick` 意味着只有 logistics-planner 运行的那个 tick（每 100t 一次）V2 才被合并。其余 99 tick V2 完全不参与。

对比 agenda-manager 步 13.5：
```typescript
// agenda-manager.ts:495
if (logisticsPlan && logisticsPlan.plannedAt >= ctx.tick - 100) {
  // 消费最近 100 tick 内产出的 Plan
```

agenda-manager 接受 100t 内的 Plan，但 logistics.ts 只接受当 tick 的 Plan。**不一致**。

---

## 9. Convergence Score — 架构收敛评分

| 指标 | 目标 | 当前值 | 状态 |
| --- | --- | --- | --- |
| Independent Planner Count | 1 | 3 (logistics-planner + agenda-manager allocateNetwork + remote-mining reevaluate) | 🔴 |
| Independent Transport Request Count | 1 | 2 (V1 TransportRequest + V2 TransportRequestV2) | 🔴 |
| Independent Assignment Count | 1 | 2 (assignment-service TaskPool + Plan assignments=[]) | 🔴 |
| Independent Spawn Decision Count | 1 | 3 (spawn-manager + agenda-manager + remote-mining) | 🔴 |
| Independent Route Decision Count | 1 | 2 (agenda-manager routeCache + logistics-planner RouteCache) | 🔴 |
| Independent Resource Transfer Decision Count | 1 | 2 (terminal-manager自主 + Plan驱动) | 🔴 |
| Independent Accounting | 1 | 0 (无运行时 Accounting 追踪) | 🔴 |
| Supply Contract 接入 | ✅ | ❌ 从未被调用 | 🔴 |
| Delivery Validation 接入 | ✅ | ❌ 仍用空载推断 | 🔴 |
| Transport Accounting 运行时 | ✅ | ❌ 只有初始值 | 🔴 |

**Convergence Score: 0/10** — Unified Logistics Network 尚未真正接管 Empire 物流决策。

---

## 10. 核心发现总结

### 10.1 A4.3 的实际状态

A4.3 完成了以下工作：
1. ✅ 32 个 domain 层纯函数模块全部创建
2. ✅ logistics-planner.ts 系统层薄壳创建
3. ✅ bootstrap.ts 注册 logisticsPlannerSystem
4. ✅ globalCache 扩展 logisticsPlan / logisticsDashboard / logisticsHealth / logisticsCapacity / logisticsScaling / logisticsIdleHaulers 字段
5. ✅ logistics.ts 新增 V2 → AssignmentTaskEntry 适配器
6. ✅ agenda-manager 新增步 13.5 Plan 驱动 Operation 创建
7. ✅ remote-mining-manager 新增 Plan scope="operation" 消费
8. ✅ terminal-manager 新增 plan-driven-send 候选（priority=200）

### 10.2 A4.3 未完成的工作

1. 🔴 Supply Contract 系统层断裂——`createSupplyContract()` 从未被调用
2. 🔴 Transport Accounting 无运行时追踪——只有初始值
3. 🔴 Logistics Health 基于空数据——deliveryRate/lossRate 不可信
4. 🔴 Delivery Validation 未接入——仍用 carrier 空载推断
5. 🔴 Plan 合并时序窗口极窄——logistics.ts 仅当 tick 合并 V2
6. 🔴 Terminal 自主互济覆盖 Plan——tryEmpireEnergyAid 先于 Plan 候选执行
7. 🔴 V1 TransportRequest 未降级为 Adapter——仍然是主要 Request 源
8. 🔴 agenda-manager allocateNetwork 未降级为 Adapter——仍然是主要跨房决策器
9. 🔴 无 A4.3 相关单元测试或 E2E 测试
10. 🔴 Convergence Score: 0/10

### 10.3 修复优先级

| 优先级 | 修复项 | 影响范围 |
| --- | --- | --- |
| P0 | BYPASS-012: Plan 合并时序窗口修复 | logistics.ts:159 |
| P0 | BYPASS-009: Supply Contract 系统层接入 | specialization-planner.ts |
| P0 | BYPASS-010: Transport Accounting 运行时追踪 | logistics-planner.ts |
| P1 | DUPLICATE-004: Terminal 自主互济执行顺序 | terminal-manager.ts:96-99 |
| P1 | DUPLICATE-002: V1/V2 去重 | logistics.ts |
| P1 | BYPASS-003: Delivery Validation 接入 | agenda-manager.ts:611 |
| P2 | DUPLICATE-001: allocateNetwork 降级 | agenda-manager.ts:426 |
| P2 | DUPLICATE-005: Route Cache 统一 | agenda-manager + logistics-planner |
| P2 | DUPLICATE-006: Spawn 决策统一 | spawn-manager + agenda-manager + remote-mining |

---

## 11. Legacy Migration Status — 旧系统迁移状态

| 旧系统 | 设计目标 | 当前状态 | 迁移完成度 |
| --- | --- | --- | --- |
| logistics.ts → Room Execution Adapter | V1 降级为 Adapter，V2 主导 | V1 仍独立产出，V2 仅追加 | 10% |
| agenda-manager.ts → Empire Operation Adapter | allocateNetwork 降级，Plan 驱动 | allocateNetwork 仍是主决策器，Plan 补充 | 20% |
| remote-mining-manager.ts → Remote Operation Adapter | haulerNeed 由 Plan 决策 | reevaluateActiveOps 独立，Plan 只增 | 15% |
| terminal-manager.ts → Terminal Execution Adapter | 自主互济降级，Plan 驱动 | 自主互济先于 Plan 执行 | 25% |

**整体迁移完成度：~18%**

---

**Audit 完成。** 下一步：按修复优先级执行 Fix → 编写 E2E 测试 → Stress Test → Final Report。