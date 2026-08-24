# A4.2 Architecture Audit — Advanced Resource Economy

> 日期：2026-08-24。阶段：A4.2 — Multi-Resource Empire Economy Foundation。
> 基线：A4.1 Remote Mining Execution 已完成（远矿经济闭环 + Empire Balance + Specialization Planner 系统接线）。
> 方法论：逐文件追踪真实调用链，不依赖文件名猜测。每个「已有能力」结论标注源码路径与关键函数。

---

## 0. 审计方法论

本审计**逐文件追踪真实调用链**，覆盖以下系统与模块：

### 0.1 A4.0 已实现模块（纯函数层 + 系统层）

- Empire Room Role（`src/domain/economy/empire-role.ts`）— ✅ 完整
- Role Evaluation（`src/domain/economy/role-evaluation.ts`）— ✅ 完整
- Role Stability（`src/domain/economy/role-stability.ts`）— ✅ 完整
- Role Transition（`src/domain/economy/role-transition.ts`）— ✅ 完整
- Supply Contract（`src/domain/economy/supply-contract.ts`）— ✅ 完整
- Contract Lifecycle（`src/domain/economy/contract-lifecycle.ts`）— ✅ 完整
- Contract-Node Bridge（`src/domain/economy/contract-node-bridge.ts`）— ✅ 完整
- Transport Cost（`src/domain/economy/transport-cost.ts`）— ✅ 完整
- Route Efficiency（`src/domain/economy/route-efficiency.ts`）— ✅ 完整
- Remote Source Model（`src/domain/remote/remote-source.ts`）— ✅ 完整
- Remote Resource Value（`src/domain/remote/remote-value.ts`）— ✅ 完整
- Remote Opportunity（`src/domain/remote/remote-opportunity.ts`）— ✅ 完整
- Opportunity Ranking（`src/domain/remote/opportunity-ranking.ts`）— ✅ 完整
- Empire Economic Balance（`src/domain/strategy/empire-balance.ts`）— ✅ 完整
- Specialization Planner System（`src/systems/specialization-planner.ts`）— ✅ 完整

### 0.2 A4.1 已实现模块

- RemoteMiningOperation（`src/domain/operation/remote-mining-op.ts`）— ✅ 完整
- Execution Gate（`src/domain/remote/execution-gate.ts`）— ✅ 完整
- Flow Accounting（`src/domain/remote/flow-accounting.ts`）— ✅ 完整
- Economic Accounting（`src/domain/remote/economic-accounting.ts`）— ✅ 完整
- ROI（`src/domain/remote/roi.ts`）— ✅ 完整
- Operation Budget（`src/domain/remote/operation-budget.ts`）— ✅ 完整
- Economic Health（`src/domain/remote/economic-health.ts`）— ✅ 完整
- Container Lifecycle（`src/domain/remote/container-lifecycle.ts`）— ✅ 完整

### 0.3 审计追踪的现有系统

- Empire Economy（`src/systems/empire-economy.ts`）— P1, interval=100
- Agenda Manager（`src/systems/agenda-manager.ts`）— P1, interval=100
- Terminal Manager（`src/systems/terminal-manager.ts`）— P2, interval=200
- Remote Mining Manager（`src/systems/remote-mining-manager.ts`）— P2, interval=10
- Spawn Manager（`src/systems/spawn-manager.ts`）— P0, interval=1
- Logistics（`src/systems/logistics.ts`）— P0, interval=1
- Assignment Service（`src/systems/assignment-service.ts`）— P0, interval=1
- Construction Manager（`src/systems/construction-manager.ts`）— P2, interval=1
- Bootstrap（`src/bootstrap.ts`）

### 0.4 审计追踪的矿物 / 工业链

- Mineral Miner 角色（`src/creeps/roles/mineral-miner.ts`）— P2
- harvestMineral action（`src/creeps/engine/actions/harvest.ts`）— 完整
- haulMineralsToStorage action（`src/creeps/engine/actions/industry.ts`）— 完整
- haulMineralTopUp action（`src/creeps/engine/actions/industry.ts`）— 完整
- Mineral Logistics（`src/domain/economy/mineral-logistics.ts`）— 完整
- Energy Logistics（`src/domain/economy/energy-logistics.ts`）— 完整
- Terminal Manager 矿物互济 + 市场交易（`src/systems/terminal-manager.ts`）— 完整
- Industry Inventory（`src/domain/industry/inventory.ts`）— 完整
- Terminal Policy（`src/domain/industry/terminal-policy.ts`）— 完整
- Market Orders（`src/domain/industry/market-orders.ts`）— 完整
- Procurement（`src/domain/industry/procurement.ts`）— 完整

### 0.5 审计追踪的资源表达

- ResourceType 类型定义（`src/domain/operation/agenda-item.ts` L36）
- SupplyNode（`src/domain/operation/supply-node.ts`）
- DemandNode（`src/domain/operation/demand-node.ts`）
- Reservation（`src/domain/operation/reservation.ts`）
- EnergyLedger / EnergyPools / AccountingWindow（`src/domain/economy/accounting.ts`）
- ResourceFlowSnapshot（`src/domain/remote/flow-accounting.ts`）
- EmpireResourceView（`src/domain/strategy/resource-view.ts`）
- EmpireBalance（`src/domain/strategy/empire-balance.ts`）
- EconomicHealthResult（`src/domain/strategy/economic-health.ts`）

---

## 1. 核心发现：ResourceType 硬编码为 "energy"

### 1.1 当前类型定义

源码：`src/domain/operation/agenda-item.ts` L36

```typescript
/** 资源类型（当前只支持 energy，后续可扩展）。 */
export type ResourceType = "energy";
```

**这是 A4.2 的第一个变更点。** `ResourceType` 必须从 `"energy"` 扩展为联合类型，支持矿物等资源。

### 1.2 ResourceType 在代码库中的使用

`ResourceType` 被以下结构引用：
- `OperationContext.resource: ResourceType`（agenda-item.ts L64）
- `SupplyNode.resource: ResourceType`（supply-node.ts L27）
- `DemandNode.resource: ResourceType`（demand-node.ts L39）
- `Reservation.resource: "energy"`（reservation.ts L37）— ⚠️ 硬编码，非 `ResourceType`
- `SupplyContract.resource: ResourceType`（supply-contract.ts L111）
- `RemoteMiningOperationContext.resource: "energy"`（remote-mining-op.ts）— ⚠️ 硬编码

### 1.3 关键发现

**类型已设计为可扩展但从未扩展。** A4.0 Architecture Audit §18.4 明确规划了路径：

```typescript
// 当前（A4.0）
export type ResourceType = "energy";

// 未来路径（A4.1+）
export type ResourceType = "energy" | MineralResourceType | CommodityResourceType;
```

但 A4.1 未执行此扩展。A4.2 必须执行。

### 1.4 结论

| 维度 | 状态 |
| --- | --- |
| ResourceType 已定义？ | ✅ 已定义但硬编码为 `"energy"` |
| 数据结构支持泛化？ | ✅ SupplyNode/DemandNode/Operation/Contract 均使用 `ResourceType` 类型 |
| Reservation 支持泛化？ | ❌ 硬编码 `resource: "energy"` |
| buildSupplyNode 支持泛化？ | ❌ 硬编码 `resource: "energy"`（L69） |
| buildDemandNode 支持泛化？ | ❌ 硬编码 `resource: "energy"`（L90） |

---

## 2. 当前 Energy 完整调用链

### 2.1 Energy 生产链

```
Source (Game.rooms[r].find(FIND_SOURCES))
    ↓
harvester 角色 (P1)
    ├── harvest(source) → creep.store
    ├── transfer(container/link) → container/link.store
    └── transfer(storage) → storage.store [fallback]
    ↓
Room Economy 系统 (P1, interval=50)
    ├── economy.ts: 采集 EnergyLedger + EnergyPools
    ├── queryEconomy(roomName) → EconomyQuery { netFlow, contractReserve, riskBuffer, ... }
    └── RoomMemory.rooms[r].economy = { t, nf, cr, rb, dr, ei, ef }
    ↓
empire-economy 系统 (P1, interval=100)
    ├── buildRoomEconomicProfile() → RoomEconomicProfile
    │   ⚠️ estimatedIncome 只算本地 source，不含远矿！
    ├── buildEmpireResourceView() → EmpireResourceView
    │   ⚠️ totalEnergy 只加 storageEnergy，不含矿物！
    ├── evaluateEconomicHealth() → EconomicHealthResult
    └── buildEmpirePlannerInput() → EmpirePlannerInput
```

### 2.2 Energy 调拨链（跨房）

```
agenda-manager (P1, interval=100)
    │
    ├── buildRoomEconomicProfile() → profiles[]
    ├── computeTransferableBulk() → transferable by room
    ├── makeRegistryEntry() → RoomRegistry (Map)
    ├── getSurplusRooms() / getDeficitRooms()
    │
    ├── buildSupplyNodes(surplusRooms, reservedByRoom, tick)
    │   → SupplyNode[] { room, resource: "energy", available, reserved, safety, transferable, ... }
    │   ⚠️ buildSupplyNode 硬编码 resource: "energy" (L69)
    │
    ├── buildDemandNodes(deficitRooms, inTransitByTarget, tick)
    │   → DemandNode[] { room, resource: "energy", requested, remaining, criticality, ... }
    │   ⚠️ buildDemandNode 硬编码 resource: "energy" (L90)
    │
    ├── allocateNetwork(supplyNodes, demandNodes, routes, activeOps, tick)
    │   → AllocationPlan[] { sourceRoom, targetRoom, amount, priority }
    │   ⚠️ 无 resourceType 字段 — 隐含 energy
    │
    ├── createOperation() → OperationContext (type="supply", resource="energy")
    ├── createReservation() → ReservationTable
    │   ⚠️ Reservation.resource 硬编码 "energy" (L37)
    └── submitCarrierSpawn() → spawn/queue.ts
```

### 2.3 Energy 消费链

```
消费者（P0 > P1 > P2 > P3）：
    P0: spawn (spawnCreep) + tower (attack/heal/repair) + harvester链
    P1: 常态孵化 + hauler 链 + 维修
    P2: 建造 + 升级
    P3: 商品/boost 库存

EnergyLedger 追踪 (accounting.ts):
    L1 计数器: harvested / pickedUp / spawned / upgraded / built / repaired / towerSpent
    L2 核算: AccountingWindow { income, consumption, drift, p0p1PerTick, incomePerTick }
    
    ⚠️ 只追踪 Energy！无 Mineral 计数器！
```

### 2.4 Energy 存储链

```
EnergyPools (accounting.ts):
    spawnExt: spawn + extension 能量
    containers: container 能量
    storage: storage 能量
    terminal: terminal 能量
    links: link 能量
    carry: creep 在途能量
    towers: tower 能量
    loose: dropped + tombstone + ruin
    other: factory + powerSpawn
    
    ⚠️ 只追踪 Energy！无 Mineral Pool！
    ⚠️ terminal.store 含矿物但 EnergyPools.terminal 只计 energy！
```

---

## 3. 当前 Mineral 已有实现

### 3.1 Mineral 采集链（已运行）

```
Mineral Deposit (Game.rooms[r].find(FIND_MINERALS))
    ↓
extractor (RCL6+ required)
    ↓
mineralMiner 角色 (P2)
    ├── harvest(mineral) → creep.store [需要 extractor + 矿物有储量]
    ├── dumpMineralsToNearbyContainer() → container.store [mineral type]
    └── buildNearbyContainerSite() [自建 mineral container]
    ↓
Container (mineral 旁，0-2000 capacity)
    ↓
hauler 角色 (P1) — 通过 industry actions:
    ├── haulMineralsToStorage() → transfer mineral to storage/terminal
    │   ⚠️ 优先送 terminal（贸易出口），满则落 storage
    └── haulMineralTopUp() → withdraw mineral from container, deposit to storage/terminal
```

### 3.2 Mineral 跨房调拨（已运行但独立于 Resource Network）

```
terminal-manager (P2, interval=200)
    │
    ├── tryEmpireMineralAid(ctx)
    │   ├── collectMineralInventory(snapshot) → Record<string, number> [所有非 energy 资源]
    │   ├── planMineralAid(rooms, opts) → MineralAidPlan { from, to, mineral, amount }
    │   │   ⚠️ 独立决策，不走 Resource Network / SupplyNode / DemandNode / AllocationPolicy
    │   └── terminal.send(mineral, amount, to) → 执行
    │
    ├── trySellHomeMineral(snapshot, terminal)
    │   ├── 检查 surplus = inTerminal + inStorage - sellReserve
    │   ├── Game.market.getAllOrders(BUY, homeMineral)
    │   ├── pickBestBuyOrder(orders, dynamicPrice)
    │   └── executeDeal(order, amount, terminal, roomName)
    │
    ├── trySellSurplusCompound() — boost 化合物卖出
    ├── trySellSurplusBattery() — battery 卖出
    ├── trySellCommodity() — factory 产出卖出
    ├── tryBuyPower() — power 买入
    └── tryBuyMineralDeficits() — 缺口矿物买入
```

### 3.3 Mineral Demand（已运行但独立于 DemandNode）

```
terminal-manager → procurement.ts
    ├── collectDemands(snapshot) → Demand[]
    │   ⚠️ 独立 Demand 系统，不复用 DemandNode！
    ├── adjustMaxPrice(demand, marketPrices)
    └── 买入决策

terminal-policy.ts:
    ├── getMineralDeficits(inventory) → { mineral, deficit }[]
    ├── pickBestBuyOrder(orders, maxPrice)
    └── pickBestSellOrder(orders, minPrice)
```

### 3.4 Mineral 在 Resource Network 中的表达

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Mineral SupplyNode | ❌ **不存在** | `buildSupplyNode` 只从 `RoomRegistryEntry` 派生 energy，不扫描 mineral |
| Mineral DemandNode | ❌ **不存在** | `buildDemandNode` 只从 `RoomRegistryEntry` 派生 energy deficit |
| Mineral AllocationPolicy | ❌ **不存在** | `allocateNetwork` 只处理 energy 节点 |
| Mineral Operation | ❌ **不存在** | 无 `type="mineral_supply"` Operation |
| Mineral Reservation | ❌ **不存在** | Reservation 硬编码 `resource: "energy"` |
| Mineral Supply Contract | ❌ **不存在** | Contract 硬编码 `resource: "energy"` |
| Mineral 跨房调拨 | ⚠️ **独立通道** | `terminal-manager` + `planMineralAid` 独立运行 |
| Mineral 市场交易 | ⚠️ **独立通道** | `terminal-manager` + `terminal-policy` 独立运行 |
| Mineral 库存追踪 | ⚠️ **独立通道** | `collectFullInventory` 独立函数 |

---

## 4. 已有 Resource Ledger / Accounting 审计

### 4.1 EnergyLedger（已有 — 可复用）

源码：`src/domain/economy/accounting.ts`

```typescript
export interface EnergyLedger {
  harvested: number;      // 从 source 实采
  pickedUp: number;       // 掉落/墓碑/废墟回收
  spawned: number;        // spawn 消费
  recycledRefund: number; // recycle 返还
  upgraded: number;       // 升级消费
  built: number;          // 建造消费
  repaired: number;       // 维修消费
  towerSpent: number;     // 塔消费
}
```

| 维度 | 状态 |
| --- | --- |
| 是 Resource Ledger 吗？ | ⚠️ 是 Energy Ledger，不是通用 Resource Ledger |
| 支持 Mineral 吗？ | ❌ 不支持 — 无 mineral harvested/consumed 字段 |
| 支持 Production Rate 吗？ | ✅ `incomePerTick` + `p0p1PerTick`（rolling window） |
| 支持 Reconciliation 吗？ | ✅ `drift` = Δtracked − flowBalance − Δother − looseDelta |
| 可泛化吗？ | ⚠️ 需扩展为 `ResourceLedger` 或按 resourceType 维护多个 ledger |

### 4.2 ResourceFlowSnapshot（已有 — 可复用）

源码：`src/domain/remote/flow-accounting.ts`

```typescript
export interface ResourceFlowSnapshot {
  operationId: string;
  produced: number;      // 产出量
  transported: number;   // 运输量
  delivered: number;     // 交付量
  lost: number;          // 损失量
  consumed: number;      // 消费量
  stored: number;        // container 存量
}
```

| 维度 | 状态 |
| --- | --- |
| 是 Resource Flow 吗？ | ✅ 是通用资源流追踪 |
| 支持 Mineral 吗？ | ⚠️ 结构支持但只用于 Remote Mining Energy |
| 有 Production Rate 吗？ | ✅ `productionRate()` / `deliveryRate()` |
| 有 Loss 追踪吗？ | ✅ `lost` + `lossRate()` |
| 有 Transport Efficiency 吗？ | ✅ `transportEfficiency()` |

### 4.3 EnergyPools（已有 — 可复用但需扩展）

源码：`src/domain/economy/accounting.ts`

```typescript
export interface EnergyPools {
  spawnExt: number;
  containers: number;
  storage: number;
  terminal: number;
  links: number;
  carry: number;
  towers: number;
  loose: number;
  other: number;
}
```

| 维度 | 状态 |
| --- | --- |
| 追踪 Energy 吗？ | ✅ 完整 |
| 追踪 Mineral 吗？ | ❌ 不追踪 |
| 有 Storage Capacity 评估吗？ | ⚠️ 有 storageEnergy 但无 per-resource capacity |

### 4.4 collectFullInventory（已有 — 可复用）

源码：`src/domain/industry/inventory.ts`

```typescript
export function collectFullInventory(snapshot: RoomSnapshot): Record<string, number>
```

| 维度 | 状态 |
| --- | --- |
| 收集 Mineral 吗？ | ✅ 收集 storage + terminal + labs + factory 的全部非 energy 资源 |
| 是 Resource Ledger 吗？ | ❌ 只是即时快照，无累计 / 无 rate / 无 reconciliation |

---

## 5. 已有 Terminal / Storage Accounting 审计

### 5.1 Terminal Manager（已有 — 独立于 Resource Network）

源码：`src/systems/terminal-manager.ts`

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Energy 跨房互济 | ✅ `planEnergyAid()` 纯函数 | 独立于 Resource Network |
| Mineral 跨房互济 | ✅ `planMineralAid()` 纯函数 | 独立于 Resource Network |
| Mineral 市场卖出 | ✅ `trySellHomeMineral()` | 独立 |
| Mineral 市场买入 | ✅ `tryBuyMineralDeficits()` | 独立 |
| Battery 卖出 | ✅ `trySellSurplusBattery()` | 独立 |
| Commodity 卖出 | ✅ `trySellCommodity()` | 独立 |
| Power 买入 | ✅ `tryBuyPower()` | 独立 |
| Compound 卖出 | ✅ `trySellSurplusCompound()` | 独立 |
| Terminal 能量运费管理 | ✅ `calcTransactionCost` 校验 | 完整 |
| Terminal 冷却管理 | ✅ `terminal.cooldown === 0` 检查 | 完整 |

### 5.2 Terminal 的资源处理方式

Terminal Manager **按资源类型分别处理**，不走统一 Resource Network：

```
Energy  → planEnergyAid() → terminal.send(RESOURCE_ENERGY, ...)
Mineral → planMineralAid() → terminal.send(mineral, ...)
Market  → Game.market.deal() → 直接交易
```

**这是 A4.2 的核心冲突点**：Terminal Manager 有完整的矿物互济逻辑，但完全独立于 Empire Resource Network。

---

## 6. Empire Economic Health 审计

### 6.1 当前 EconomicHealth（energy-only）

源码：`src/domain/strategy/economic-health.ts`

```typescript
export type EmpireEconomicHealth =
  | "critical" | "deficit" | "stable" | "growing" | "healthy";
```

判定逻辑**完全基于 Energy 指标**：
- `totalNetFlow`（energy netFlow 之和）
- `totalProduction`（energy estimatedIncome 之和）
- `minRiskBuffer`（energy riskBuffer 最差值）
- `hasStruggling`（energy colonyState 困难态）
- `empireSelfSufficiency`（energy 自给度）

### 6.2 EmpireBalance（A4.1 — 已有但 energy-only）

源码：`src/domain/strategy/empire-balance.ts`

```typescript
export interface EmpireBalance {
  totalProduction: number;   // e/tick — 只含 energy
  totalConsumption: number;  // e/tick — 只含 energy
  netProduction: number;     // e/tick
  totalReserve: number;      // energy only
  remoteProduction: number;  // energy only
  remoteDelivered: number;   // energy only
  ...
}
```

### 6.3 结论

| 维度 | 状态 |
| --- | --- |
| Empire Health 支持 Mineral 吗？ | ❌ 不支持 — 纯 Energy 指标 |
| Empire Balance 支持 Mineral 吗？ | ❌ 不支持 — 纯 Energy 指标 |
| Empire Resource View 支持 Mineral 吗？ | ❌ 不支持 — totalEnergy 只加 storageEnergy |
| 需要 Multi-Resource Health 吗？ | ✅ **核心交付物** — Energy HEALTHY + Mineral DEFICIT → Empire DEGRADED |

---

## 7. Reservation System 审计

### 7.1 当前 Reservation（energy-only）

源码：`src/domain/operation/reservation.ts`

```typescript
export interface Reservation {
  operationId: string;
  sourceRoom: string;
  targetRoom: string;
  amount: number;
  resource: "energy";  // ⚠️ 硬编码
}
```

### 7.2 结论

| 维度 | 状态 |
| --- | --- |
| Reservation 支持 Mineral 吗？ | ❌ `resource` 硬编码 `"energy"` |
| 需要泛化吗？ | ✅ 改为 `ResourceType` 类型 |
| 泛化复杂度？ | 🟢 低 — 只需改类型声明，逻辑与 resourceType 无关 |

---

## 8. Supply Contract 审计

### 8.1 当前 Contract（支持 ResourceType 类型但只实例化 energy）

源码：`src/domain/economy/supply-contract.ts`

```typescript
export interface SupplyContract {
  resource: ResourceType;  // 类型正确但 ResourceType = "energy"
  ...
}
```

### 8.2 Contract-Node Bridge（支持 ResourceType 但只注入 energy）

源码：`src/domain/economy/contract-node-bridge.ts`

Bridge 从 Contract 派生 SupplyNode/DemandNode，但 Contract 只创建 `resource: "energy"` 的实例。

### 8.3 结论

| 维度 | 状态 |
| --- | --- |
| Contract 模型支持泛化吗？ | ✅ `resource: ResourceType` 类型正确 |
| Contract 实际创建过 Mineral Contract 吗？ | ❌ 没有 |
| Contract-Node Bridge 支持 Mineral 吗？ | ⚠️ 类型支持但 `buildSupplyNode`/`buildDemandNode` 硬编码 energy |
| 需要新建第二套 Contract 吗？ | ❌ 禁止 — 复用现有模型，扩展 ResourceType |

---

## 9. 已有能力清单（Already Exists — 可复用）

| # | 能力 | 源码位置 | 状态 | 复用方式 |
| --- | --- | --- | --- | --- |
| 1 | **ResourceType 类型** | `agenda-item.ts` L36 | ⚠️ 硬编码 | 扩展为联合类型 |
| 2 | **SupplyNode** | `supply-node.ts` | ✅ 结构支持 | `resource` 字段已是 `ResourceType` 类型 |
| 3 | **DemandNode** | `demand-node.ts` | ✅ 结构支持 | `resource` 字段已是 `ResourceType` 类型 |
| 4 | **AllocationPolicy v2** | `allocation-policy.ts` | ✅ 7 因子可解释 | 不感知 resourceType — 天然通用 |
| 5 | **OperationContext** | `agenda-item.ts` | ✅ 9 态状态机 | `resource` 字段已是 `ResourceType` |
| 6 | **Reservation** | `reservation.ts` | ⚠️ 硬编码 | 改 `resource` 为 `ResourceType` |
| 7 | **NetworkSnapshot** | `network-snapshot.ts` | ✅ 结构通用 | 天然支持多资源类型 |
| 8 | **NetworkHealth** | `network-health.ts` | ✅ 四档健康度 | 天然通用 |
| 9 | **Supply Contract** | `supply-contract.ts` | ✅ 6 态生命周期 | `resource: ResourceType` 已正确 |
| 10 | **Contract Lifecycle** | `contract-lifecycle.ts` | ✅ 状态转换 + 故障检测 | 与 resourceType 无关 |
| 11 | **Contract-Node Bridge** | `contract-node-bridge.ts` | ✅ Contract → Node 注入 | 天然通用 |
| 12 | **Transport Cost Model** | `transport-cost.ts` | ✅ 4 维度成本 | 天然通用 |
| 13 | **Route Efficiency** | `route-efficiency.ts` | ✅ Delivered/Cost | 天然通用 |
| 14 | **EnergyLedger** | `accounting.ts` | ⚠️ Energy-only | 可作为 ResourceLedger 模板 |
| 15 | **EnergyPools** | `accounting.ts` | ⚠️ Energy-only | 可作为 ResourcePools 模板 |
| 16 | **AccountingWindow** | `accounting.ts` | ✅ 核算窗口 + drift | 可泛化为 ResourceAccountingWindow |
| 17 | **ResourceFlowSnapshot** | `flow-accounting.ts` | ✅ 通用资源流 | 天然支持 Mineral |
| 18 | **RemoteMiningOperation** | `remote-mining-op.ts` | ✅ 完整 | 可作为 Mineral Operation 模板 |
| 19 | **Flow Accounting** | `flow-accounting.ts` | ✅ Produced/Transported/Delivered/Lost | 天然通用 |
| 20 | **Economic Accounting** | `economic-accounting.ts` | ✅ Gross/Net/Cost | 天然通用 |
| 21 | **ROI** | `roi.ts` | ✅ Expected vs Actual | 天然通用 |
| 22 | **Operation Budget** | `operation-budget.ts` | ✅ 预算上限 + 消耗 | 天然通用 |
| 23 | **Container Lifecycle** | `container-lifecycle.ts` | ✅ 6 状态 | 天然通用 |
| 24 | **Empire Room Role** | `empire-role.ts` | ✅ 4 角色 | 天然通用 |
| 25 | **Role Evaluation** | `role-evaluation.ts` | ✅ 多维评分 | 天然通用 |
| 26 | **Role Stability** | `role-stability.ts` | ✅ Hysteresis | 天然通用 |
| 27 | **Role Transition** | `role-transition.ts` | ✅ 转换规则 | 天然通用 |
| 28 | **Empire Balance** | `empire-balance.ts` | ⚠️ Energy-only | 需扩展为 Multi-Resource |
| 29 | **Empire Economic Health** | `economic-health.ts` | ⚠️ Energy-only | 需扩展为 Multi-Resource |
| 30 | **Empire Resource View** | `resource-view.ts` | ⚠️ Energy-only | 需扩展为 Multi-Resource |
| 31 | **Empire Budget** | `budget.ts` | ⚠️ Energy-only | 需扩展为 Multi-Resource |
| 32 | **Empire Planner Input** | `planner-input.ts` | ⚠️ Energy-only | 需扩展为 Multi-Resource |
| 33 | **Specialization Planner** | `specialization-planner.ts` | ✅ 系统薄壳 | 需扩展消费 Multi-Resource |
| 34 | **Mineral Miner 角色** | `mineral-miner.ts` | ✅ 完整 | 采集 + 倒矿 + 自建 container |
| 35 | **harvestMineral action** | `harvest.ts` | ✅ 完整 | 采集 mineral |
| 36 | **haulMineralsToStorage** | `industry.ts` | ✅ 完整 | 矿物搬运到 storage/terminal |
| 37 | **haulMineralTopUp** | `industry.ts` | ✅ 完整 | 矿物补仓 |
| 38 | **Mineral Logistics** | `mineral-logistics.ts` | ✅ 纯函数 | 跨房矿物互济决策 |
| 39 | **Energy Logistics** | `energy-logistics.ts` | ✅ 纯函数 | 跨房能量互济决策 |
| 40 | **Terminal Manager** | `terminal-manager.ts` | ✅ 完整 | 市场交易 + 互济 |
| 41 | **Terminal Policy** | `terminal-policy.ts` | ✅ 完整 | 矿物缺口/卖出决策 |
| 42 | **Industry Inventory** | `inventory.ts` | ✅ 统一库存视图 | storage + terminal + labs + factory |
| 43 | **Market Orders** | `market-orders.ts` | ✅ 完整 | 订单管理 |
| 44 | **Procurement** | `procurement.ts` | ✅ 完整 | 矿物采购需求 |
| 45 | **Spawn Manager** | `spawn-manager.ts` | ✅ 完整 | 唯一 spawnCreep |
| 46 | **Logistics** | `logistics.ts` | ✅ Request Pool | 天然通用 |
| 47 | **Assignment Service** | `assignment-service.ts` | ✅ TaskPool | 天然通用 |
| 48 | **safeRun** | `safe-run.ts` | ✅ 错误隔离 | 天然通用 |
| 49 | **Event Log** | `event-log.ts` | ✅ 事件记录 | 天然通用 |
| 50 | **Global Cache** | `global-cache.ts` | ✅ heap 缓存 | 天然通用 |

---

## 10. 缺失能力清单（Missing — 需新建）

| # | 能力 | 说明 | 建议实现位置 |
| --- | --- | --- | --- |
| 1 | **Resource Definition** | 数据驱动的资源定义（category/stackable/tradable/storable/productionSources/consumptionSources） | `src/domain/economy/resource-definition.ts` (新) |
| 2 | **ResourceType 扩展** | 从 `"energy"` 扩展为 `"energy" \| MineralConstant \| ...` | 修改 `agenda-item.ts` |
| 3 | **EmpireResource 统一模型** | resourceType / available / reserved / incoming / outgoing / productionRate / consumptionRate / demand / surplus / deficit / capacity / health | `src/domain/economy/empire-resource.ts` (新) |
| 4 | **Resource Ledger** | 统一资源账本（按 resourceType 分别记账，可回答 Empire 当前有多少资源） | `src/domain/economy/resource-ledger.ts` (新) |
| 5 | **Resource State 分离** | STORED / RESERVED / IN_TRANSIT / ALLOCATED / CONSUMED 五态分离 | 扩展 ResourceLedger |
| 6 | **Production Rate（通用）** | Rolling Window 估算生产速率，避免单 tick 波动 | 扩展 ResourceLedger |
| 7 | **Consumption Rate（通用）** | 按消费者类型追踪消耗速率 | 扩展 ResourceLedger |
| 8 | **Resource Surplus 定义** | available - reserved - safetyReserve - expectedDemand > 0 | `src/domain/economy/resource-surplus.ts` (新) |
| 9 | **Resource Deficit 定义** | available + incoming < safetyReserve + expectedConsumption | `src/domain/economy/resource-deficit.ts` (新) |
| 10 | **Safety Reserve（per resource）** | 按资源类型设置不同安全储备 | `src/domain/economy/safety-reserve.ts` (新) |
| 11 | **Storage Pressure** | 按资源类型评估存储压力（95% 满则继续生产不经济） | `src/domain/economy/storage-pressure.ts` (新) |
| 12 | **Resource Overflow** | 存储满 → Overflow State → 生产调整/转移/恢复 | `src/domain/economy/resource-overflow.ts` (新) |
| 13 | **Resource Underflow** | 关键资源长期不足 → Deficit → 原因识别 | `src/domain/economy/resource-underflow.ts` (新) |
| 14 | **Resource Health** | HEALTHY / STABLE / DEGRADED / DEFICIT / CRITICAL + 可解释 | `src/domain/economy/resource-health.ts` (新) |
| 15 | **Resource Bottleneck** | 识别真正限制 Empire 的资源 | `src/domain/economy/bottleneck.ts` (新) |
| 16 | **Bottleneck Ranking** | 多资源按 Demand Pressure / Production Gap / Economic Impact / Recovery Cost 排序 | 扩展 bottleneck.ts |
| 17 | **Resource Flow Graph** | 统一记录 Production / Transfer / Storage / Consumption / Reservation / Loss | `src/domain/economy/resource-flow.ts` (新) |
| 18 | **Resource Loss 统计** | 生产损失 / 运输损失 / 过量损失 / 死亡损失 / 其他损失 | 扩展 ResourceFlow |
| 19 | **Accounting Invariant** | Initial + Production + Incoming - Outgoing - Consumption - Loss ≈ Final | `src/domain/economy/accounting-invariant.ts` (新) |
| 20 | **Resource Reconciliation** | 周期性检查 Ledger vs 实际（Storage / Terminal / Container / Creep Carry） | `src/domain/economy/reconciliation.ts` (新) |
| 21 | **Reconciliation Recovery** | Mismatch → RECONCILIATION_REQUIRED → 重新同步（不静默修正） | 扩展 reconciliation.ts |
| 22 | **Multi-Resource Empire Health** | Energy HEALTHY + Mineral DEFICIT → Empire DEGRADED | `src/domain/strategy/multi-resource-health.ts` (新) |
| 23 | **Resource Allocation Plan** | 统一分配：Energy Core Reserve / Mineral Production Reserve / Strategic Reserve | `src/domain/economy/resource-allocation.ts` (新) |
| 24 | **Multi-Resource Planner** | 读取 Multi-Resource State → 统一决策 Energy 调拨 + Mineral 调拨 + Market 买入/卖出 | `src/domain/strategy/multi-resource-planner.ts` (新) |
| 25 | **Planner Frequency Control** | Dirty Flag + Event-Driven + Periodic 三档触发机制，避免每 tick 重规划 | `src/domain/strategy/planner-frequency.ts` (新) |
| 26 | **Mineral SupplyNode 构建** | 从 `collectFullInventory` 派生 Mineral SupplyNode（scan storage/terminal/lab/factory） | 扩展 `supply-node.ts` 或新建 `mineral-supply-node.ts` |
| 27 | **Mineral DemandNode 构建** | 从 `getMineralDeficits` 派生 Mineral DemandNode | 扩展 `demand-node.ts` 或新建 `mineral-demand-node.ts` |
| 28 | **Mineral AllocationPolicy** | 矿物调拨分配策略（可复用现有 AllocationPolicy 但需参数化 resourceType） | 扩展 `allocation-policy.ts` |
| 29 | **Mineral Operation** | 矿物调拨 Operation（type="supply", resource=mineral_type） | 复用 `createOperation`，扩展 ResourceType |
| 30 | **Mineral Reservation** | 矿物预留（resource=mineral_type） | 修改 `reservation.ts` |
| 31 | **Mineral Supply Contract** | 矿物长期供应契约 | 复用 `SupplyContract`，扩展 ResourceType |
| 32 | **Terminal Manager 集成** | Terminal Manager 从独立通道接入 Resource Network（作为 Mineral 调拨的执行器之一） | 重构 `terminal-manager.ts` |

---

## 11. 冲突清单（Conflicting — 需协调解决）

| # | 冲突 | 现状 | A4.2 目标 | 解决策略 |
| --- | --- | --- | --- | --- |
| 1 | **Terminal Manager vs Resource Network — 矿物调拨双轨** | `terminal-manager.planMineralAid()` 独立决策矿物跨房互济，不走 SupplyNode/DemandNode/AllocationPolicy/Operation | Terminal Manager 成为 Resource Network 的执行器（不独立决策） | 分阶段：A4.2 先并行运行（不破坏现有功能），A4.3 切换为 Terminal Manager 读取 Network 的 AllocationPlan 执行 |
| 2 | **Terminal Manager vs Resource Network — 能量调拨双轨** | `terminal-manager.planEnergyAid()` 独立决策能量跨房互济，与 agenda-manager 的 Operation 并行 | 能量互济统一走 agenda-manager → Operation → carrier | 同上：A4.2 并行 → A4.3 切换 |
| 3 | **Terminal Manager vs Market — 交易决策分散** | `trySellHomeMineral` / `tryBuyMineralDeficits` / `trySellSurplusBattery` / `trySellCommodity` 各自独立决策 | 市场交易纳入 Resource Network 的统一 Surplus/Deficit 判定 | A4.2 保持现有交易逻辑，但让 Multi-Resource Planner 可读取交易结果作为「已处理 surplus/deficit」 |
| 4 | **Mineral Demand 双系统** | `terminal-policy.ts::getMineralDeficits()` 独立计算矿物缺口；`demand-node.ts::buildDemandNode` 只处理 energy | 统一为 Mineral DemandNode（复用 DemandNode 结构） | A4.2 新建 `buildMineralDemandNode` 从 `getMineralDeficits` 派生 |
| 5 | **Inventory 快照 vs Ledger 累计** | `collectFullInventory` 是即时快照无累计；`EnergyLedger` 是累计但只追踪 energy | 统一为 ResourceLedger（按 resourceType 分别累计 + 即时快照双口径） | A4.2 新建 ResourceLedger 作为统一口径 |
| 6 | **EmpireBalance vs EmpireResourceView 双视图** | `empire-balance.ts` 和 `resource-view.ts` 各自聚合帝国级经济状态，口径不完全一致 | 统一为 Multi-Resource EmpireResourceView | A4.2 扩展 EmpireResourceView 支持 multi-resource，EmpireBalance 从中派生 |

---

## 12. 必需变更清单（Required Changes — A4.2 必须执行）

### 12.1 类型层变更（Breaking Type Changes）

| # | 文件 | 变更 | 影响范围 | 复杂度 |
| --- | --- | --- | --- | --- |
| TC-1 | `src/domain/operation/agenda-item.ts` L36 | `ResourceType` 从 `"energy"` 扩展为 `"energy" \| MineralConstant` | 所有使用 `ResourceType` 的文件 | 🟢 低 — 类型扩展不破坏现有 `"energy"` |
| TC-2 | `src/domain/operation/reservation.ts` L37 | `resource` 字段从 `"energy"` 改为 `ResourceType` | `createReservation` 函数签名 + 调用方 | 🟢 低 |
| TC-3 | `src/domain/operation/supply-node.ts` L69 | `resource: "energy"` 改为从 `RoomRegistryEntry` 或参数传入的 `resourceType` | `buildSupplyNode` 函数签名 | 🟡 中 — 需新增 `resourceType` 参数 |
| TC-4 | `src/domain/operation/demand-node.ts` L90 | `resource: "energy"` 改为从参数传入的 `resourceType` | `buildDemandNode` 函数签名 | 🟡 中 |
| TC-5 | `src/domain/economy/supply-contract.ts` L534 | `deserializeContract` 硬编码 `resource: "energy"` | 反序列化路径 | 🟢 低 — 需从快照 `r` 字段解码 |
| TC-6 | `src/domain/economy/supply-contract.ts` L485 | `serializeContract` 硬编码 `r: c.resource === "energy" ? "E" : "E"` | 序列化路径 | 🟢 低 |

### 12.2 新建模块（New Modules）

| # | 模块 | 职责 | 优先级 |
| --- | --- | --- | --- |
| NM-1 | `src/domain/economy/resource-definition.ts` | 数据驱动的资源定义（category / stackable / tradable / storable） | P0 — 基础 |
| NM-2 | `src/domain/economy/resource-ledger.ts` | 统一资源账本（按 resourceType 分别记账 + Rolling Window 速率 + drift 恒等式） | P0 — 核心 |
| NM-3 | `src/domain/economy/resource-health.ts` | 单资源健康度（HEALTHY / STABLE / DEGRADED / DEFICIT / CRITICAL） | P1 |
| NM-4 | `src/domain/economy/bottleneck.ts` | 资源瓶颈识别 + 排序 | P1 |
| NM-5 | `src/domain/strategy/multi-resource-health.ts` | 多资源帝国健康度（Energy HEALTHY + Mineral DEFICIT → Empire DEGRADED） | P1 |
| NM-6 | `src/domain/economy/reconciliation.ts` | 周期性对账（Ledger vs 实际库存） | P2 |
| NM-7 | `src/domain/economy/resource-flow.ts` | 统一资源流图（Production / Transfer / Storage / Consumption / Loss） | P2 |

### 12.3 现有模块扩展（Existing Module Extensions）

| # | 文件 | 扩展内容 | 复杂度 |
| --- | --- | --- | --- |
| EM-1 | `src/domain/strategy/resource-view.ts` | `EmpireResourceView` 新增 `minerals: Record<MineralConstant, MineralResourceSummary>` 字段 | 🟡 中 |
| EM-2 | `src/domain/strategy/economic-health.ts` | `evaluateEconomicHealth` 新增 mineral 维度判定 | 🟡 中 |
| EM-3 | `src/domain/strategy/empire-balance.ts` | `EmpireBalance` 新增 mineral balance 字段 | 🟡 中 |
| EM-4 | `src/domain/economy/accounting.ts` | `EnergyLedger` → 提取 `ResourceLedger` 接口，`EnergyLedger` 成为 `ResourceLedger<"energy">` 的特例 | 🔴 高 — 重构现有结构 |
| EM-5 | `src/domain/economy/contract-node-bridge.ts` | `ProducerSnapshot` / `ConsumerSnapshot` 支持 mineral 字段 | 🟡 中 |
| EM-6 | `src/domain/industry/inventory.ts` | `collectFullInventory` 输出接入 ResourceLedger | 🟢 低 |
| EM-7 | `src/systems/empire-economy.ts` | 系统侧薄壳扩展：调用 Multi-Resource Planner | 🟡 中 |

### 12.4 Memory 迁移

| # | 变更 | 说明 |
| --- | --- | --- |
| MG-1 | `schemaVersion` 升版 | ResourceType 扩展 + Contract Memory 快照 `r` 字段语义扩展 |
| MG-2 | `ContractMemorySnapshot.r` 字段 | 从 `"E" \| "E"`（bug）扩展为 `"E" \| mineral_code` 映射 |
| MG-3 | 幂等迁移 | 旧 `"E"` 一律解码为 `"energy"`，新 mineral code 解码为对应 `MineralConstant` |
| MG-4 | `EmpireResourceView` Memory 快照 | 新增 mineral 字段需瘦快照化（短 key + 数字编码） |

---

## 13. 延迟项（Deferred — A4.3+ 处理）

| # | 能力 | 延迟原因 | 目标阶段 |
| --- | --- | --- | --- |
| DF-1 | Terminal Manager 完全接入 Resource Network | 现有 terminal-manager 逻辑完整且稳定，A4.2 先并行不破坏 | A4.3 |
| DF-2 | Factory 产出纳入 Resource Network | Factory 产出链复杂（反应链 + commodity），需独立审计 | A4.4 |
| DF-3 | Power 买入纳入 Resource Network | Power 是特殊资源（非 StoreResource），需独立模型 | A4.5 |
| DF-4 | Boost 化合物纳入 Resource Network | 化合物是中间态，依赖 lab 反应链完整建模 | A4.4 |
| DF-5 | Commodity 产出纳入 Resource Network | 依赖 Factory 产出链 | A4.4 |
| DF-6 | Resource Network 可视化 Dashboard | 需独立 UI 层，非 tick 执行路径 | A5.0 |
| DF-7 | LLM 辅助经济决策 | 受 LLM_BOUNDARY 约束，必须异步化 + 可降级 | A5.0+ |
| DF-8 | Market 交易统一接入 Resource Network | 现有 market-orders.ts + terminal-policy.ts 逻辑完整，需渐进式迁移 | A4.3 |

---

## 14. 依赖图与实施顺序

### 14.1 A4.2 实施依赖图

```
TC-1 (ResourceType 扩展)
  ├── TC-2 (Reservation 泛化)
  ├── TC-3 (SupplyNode 泛化)
  ├── TC-4 (DemandNode 泛化)
  ├── TC-5/TC-6 (Contract 序列化/反序列化修复)
  │
  ├── NM-1 (Resource Definition)
  │   └── NM-2 (Resource Ledger)
  │       ├── EM-4 (EnergyLedger → ResourceLedger 重构)
  │       ├── NM-7 (Resource Flow Graph)
  │       └── NM-6 (Reconciliation)
  │
  ├── NM-3 (Resource Health)
  │   └── NM-4 (Bottleneck)
  │       └── NM-5 (Multi-Resource Empire Health)
  │           ├── EM-1 (EmpireResourceView 扩展)
  │           ├── EM-2 (Economic Health 扩展)
  │           └── EM-3 (Empire Balance 扩展)
  │
  └── EM-5 (Contract-Node Bridge 扩展)
      └── EM-7 (empire-economy 系统接线)
          └── MG-1..MG-4 (Memory 迁移)
```

### 14.2 建议实施顺序

| 步骤 | 内容 | 前置依赖 | 产出 |
| --- | --- | --- | --- |
| 1 | TC-1: ResourceType 扩展 | 无 | 类型编译通过 |
| 2 | TC-2 ~ TC-6: 硬编码消除 | 步骤 1 | 全链路 resourceType 可参数化 |
| 3 | NM-1: Resource Definition | 步骤 1 | 资源元数据注册 |
| 4 | NM-2 + EM-4: Resource Ledger | 步骤 3 | 统一资源账本（含 Energy + Mineral） |
| 5 | NM-3: Resource Health | 步骤 4 | 单资源健康度判定 |
| 6 | NM-5 + EM-1/EM-2/EM-3: Multi-Resource Health | 步骤 5 | 多资源帝国健康度 |
| 7 | NM-4: Bottleneck | 步骤 5 | 瓶颈识别 + 排序 |
| 8 | NM-7: Resource Flow Graph | 步骤 4 | 统一资源流追踪 |
| 9 | NM-6: Reconciliation | 步骤 4 + 8 | 对账机制 |
| 10 | EM-5 + EM-7: 系统接线 | 步骤 1~9 | 全系统集成 |
| 11 | MG-1~MG-4: Memory 迁移 | 步骤 10 | 持久化兼容 |
| 12 | 测试 + 验证 | 步骤 11 | typecheck + test + build 全绿 |

---

## 15. CPU 与 Memory 预算评估

### 15.1 CPU 影响

| 变更 | 每 tick CPU 增量 | 频率 | 缓解策略 |
| --- | --- | --- | --- |
| ResourceLedger 维护 | ~0.01 CPU/room | 每 tick | 仅在动作层埋点累加，零额外扫描 |
| Multi-Resource Health 计算 | ~0.05 CPU | 100 tick | 纯函数聚合，复用现有 RoomSnapshot |
| Reconciliation | ~0.1 CPU/room | 500 tick | 分批校验，cursor 分 tick |
| Bottleneck Ranking | ~0.02 CPU | 100 tick | 只在 Multi-Resource Health 完成后触发 |

**总计估算：** +0.1~0.2 CPU/tick（interval=100 时摊薄到 ~0.001~0.002 CPU/tick）。在 Guarded bucket 下可接受。

### 15.2 Memory 影响

| 变更 | Memory 增量 | 说明 |
| --- | --- | --- |
| Contract `r` 字段扩展 | 0 bytes/contract | 已有字段，仅扩展值域 |
| ResourceLedger 快照 | ~10 bytes/resource/room | 短 key + 整数化（与 EconomyMemorySnapshot 同模式） |
| EmpireResourceView mineral 字段 | ~50 bytes/empire | 矿物种类有限（~20 种 base mineral） |

**总计估算：** < 500 bytes/empire。远低于 Memory 预算。

---

## 16. 测试策略

### 16.1 纯函数单元测试（Vitest）

| 测试范围 | 关键测试点 |
| --- | --- |
| ResourceType 扩展 | mineral 类型可赋值给 ResourceType；旧 `"energy"` 代码不 break |
| ResourceLedger | 多 resourceType 分别记账；drift 恒等式成立；Rolling Window 正确 |
| Resource Health | ENERGY HEALTHY + MINERAL DEFICIT → EMPIRE DEGRADED |
| Bottleneck | 排序正确；Demand Pressure / Production Gap 权重合理 |
| Reconciliation | Ledger vs 实际匹配；mismatch 检测；不静默修正 |
| Reservation 泛化 | mineral 类型 reservation 可创建/释放/心跳 |
| Contract 序列化 | mineral contract 可序列化/反序列化；旧 `"E"` 快照兼容 |

### 16.2 集成测试

| 测试场景 | 验证目标 |
| --- | --- |
| 矿物跨房调拨 | Mineral SupplyNode → DemandNode → Allocation → Operation → carrier 搬运 |
| 多资源健康度 | Energy 充裕但 Mineral 不足时 Empire 状态正确降级 |
| 矿物 + 能量并行调拨 | 同一 tick 内 Energy 和 Mineral Operation 并行执行无冲突 |
| 对账恢复 | Ledger drift 超容差 → RECONCILIATION_REQUIRED 事件触发 |

### 16.3 模拟稳定性测试

| 场景 | 持续时间 | 验证 |
| --- | --- | --- |
| 3 房帝国 + 2 远矿 + 1 矿物 | 10000 tick | 矿物不堆积、不枯竭；Empire Health 稳定 |
| 矿物 surplus → 市场卖出 | 5000 tick | surplus 持续减少；交易利润为正 |
| 矿物 deficit → 跨房互济 | 5000 tick | deficit 持续减少；互济不超过 donor reserve |

---

## 17. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| ResourceType 扩展引入类型 break | 低 | 中 | 联合类型扩展不破坏现有 `"energy"` 赋值 |
| Terminal Manager 双轨期产生重复调拨 | 中 | 中 | A4.2 并行期间 mineral 调拨由 terminal-manager 独占；Network 只做监控不执行 |
| ResourceLedger 重构破坏 Energy 核算 | 中 | 高 | EnergyLedger 作为 ResourceLedger 特例保留接口；渐进式迁移 |
| Memory 迁移不幂等 | 低 | 高 | 严格遵循迁移规范：先写新字段验证后删旧；大迁移按 cursor 分 tick |
| CPU 超预算 | 低 | 中 | 所有新计算走低频系统（interval ≥ 100）；Reconciliation 分批 |

---

## 18. 总结

### 18.1 A4.2 核心交付物

1. **ResourceType 扩展**：从 `"energy"` 到 `"energy" | MineralConstant`
2. **Resource Ledger**：统一资源账本，按 resourceType 分别记账，支持 Production Rate / Consumption Rate / drift 恒等式
3. **Multi-Resource Empire Health**：Energy HEALTHY + Mineral DEFICIT → Empire DEGRADED
4. **Resource Bottleneck**：识别真正限制 Empire 的资源
5. **Reconciliation**：周期性对账，mismatch 不静默修正

### 18.2 A4.2 不做的事

1. **不替换 Terminal Manager** — 并行运行，A4.3 切换
2. **不新建第二套 Resource Network** — 复用 SupplyNode / DemandNode / AllocationPolicy / Operation
3. **不新建第二套 Contract** — 复用 SupplyContract，扩展 ResourceType
4. **不改 Kernel** — 所有变更在 domain 层 + 系统薄壳
5. **不改 bootstrap.ts** — 无新角色 / 无新系统注册（A4.2 是 domain 层扩展）

### 18.3 与 A4.0 记忆约束的对齐

[[memory:17875714213295541337]] 要求：Remote Mining、Mineral、Terminal、Factory 都必须作为 Empire Resource Network 上的生产/消费节点。A4.2 的核心工作就是**将 Mineral 从独立通道接入 Resource Network**，使其成为 SupplyNode / DemandNode 的一等公民。Terminal Manager 作为执行器保留，但决策权移交 Resource Network。

### 18.4 迁移路径

```
A4.2 (本阶段)
  ├── ResourceType 扩展（类型层）
  ├── Resource Ledger（账本层）
  ├── Multi-Resource Health（评估层）
  ├── Bottleneck + Reconciliation（监控层）
  └── Terminal Manager 并行（不破坏现有功能）

A4.3 (下一阶段)
  ├── Terminal Manager 接入 Resource Network（切换决策权）
  ├── Market 交易接入 Resource Network
  └── Mineral Supply Contract 激活

A4.4+ (后续)
  ├── Factory 产出链接入
  ├── Boost 化合物接入
  └── Commodity 接入
```