# A4.1 Architecture Audit — Remote Mining Execution

> 日期：2026-08-24。阶段：A4.1 — Remote Mining Execution。
> 基线：A4.0 Empire Economic Specialization 已部分实现（纯函数层完整，系统层未接入）。
> 方法论：逐文件追踪真实调用链，不依赖文件名猜测。每个「已有能力」结论标注源码路径与关键函数。

---

## 0. 审计方法论

本审计**逐文件追踪真实调用链**，覆盖以下系统与模块：

### 0.1 A4.0 已实现模块（纯函数层）

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

### 0.2 A4.0 未实现模块

- Local Resilience Policy（`src/domain/economy/local-resilience.ts`）— ❌ 不存在
- Specialization Dashboard（`src/domain/economy/specialization-dashboard.ts`）— ❌ 不存在
- Specialization Planner System（`src/systems/specialization-planner.ts`）— ❌ 不存在
- Empire Economic Balance（`src/domain/strategy/empire-balance.ts`）— ❌ 不存在

### 0.3 A4.0 系统层接线状态

**关键发现：A4.0 的纯函数层完整，但系统层（bootstrap 注册）未接入。**

`bootstrap.ts` 中**没有注册** specialization-planner System（因为文件不存在）。
这意味着：
- Remote Opportunity 的 `WAITING_EXECUTION` 状态**无人消费**——Opportunity 创建后没有系统侧薄壳来执行
- Supply Contract 的 `ACTIVE` 状态**无人驱动**——Contract 没有系统侧薄壳来注入 SupplyNode/DemandNode
- Contract-Node Bridge 的 `bridgeContracts()` **无人调用**——桥接纯函数没有系统入口
- Empire Room Role 的 `evaluateRole()` **无人调用**——角色评估结果不写入 RoomEconomicProfile

### 0.4 审计追踪的现有系统

- Remote Mining Manager（`src/systems/remote-mining-manager.ts`）— P2, interval=10
- Operation System / Agenda Item（`src/domain/operation/agenda-item.ts`）
- Spawn Queue（`src/domain/spawn/queue.ts`）
- Spawn Manager（`src/systems/spawn-manager.ts`）
- Logistics（`src/systems/logistics.ts`）— P0, interval=1
- Assignment Service（`src/systems/assignment-service.ts`）
- Construction Manager（`src/systems/construction-manager.ts`）— P2, interval=1
- Site Quota（`src/systems/site-quota.ts`）
- Intel System（`src/domain/intel.ts`）
- Threat System（`src/domain/defense/threat.ts`）
- Room Observer（`src/systems/room-observer.ts`）
- Empire Economy（`src/systems/empire-economy.ts`）— P1, interval=100
- Agenda Manager（`src/systems/agenda-manager.ts`）— P1, interval=100
- Bootstrap（`src/bootstrap.ts`）

### 0.5 审计追踪的 Creep 角色

- `remoteHarvester`（`src/creeps/roles/remote-harvester.ts`）— P1
- `remoteHauler`（`src/creeps/roles/remote-hauler.ts`）— P1
- `remoteDefender`（`src/creeps/roles/remote-defender.ts`）— P1
- `reserver`（`src/creeps/roles/reserver.ts`）— P2
- `coreClearer`（`src/creeps/roles/core-clearer.ts`）— P1
- `harvester`（`src/creeps/roles/harvester.ts`）— P1
- `hauler`（`src/creeps/roles/hauler.ts`）— P1
- `carrier`（`src/creeps/roles/carrier.ts`）— P1

---

## 1. 当前远矿执行链全景

### 1.1 现有远矿执行链（已完整运行）

```
room-observer (P3, interval=50, 采 intel)
  ↓
remote-mining-manager (P2, interval=10)
  │
  ├── maintainExistingOps()
  │   → 检测 self-claimed / hostile-reserved → abandoned
  │   → censusStalledOps() → 空转止损
  │   → reevaluateActiveOps() → 经济重估（netScore/haulerNeed 重算）
  │
  ├── selectRemoteTargets() [targeting.ts 纯函数]
  │   → scoreRemoteCandidate() → netScore = throughput - upkeep
  │   → 排序：netScore > hasRecentVision > roomName
  │
  ├── evaluateRemoteDemand() [demand.ts 纯函数]
  │   → remoteHarvester: 1/source, P1
  │   → remoteHauler: haulerNeed (动态), P1, 采集端联动收缩
  │   → reserver: 1/target, P2, 仅 normal
  │   → remoteDefender: 威胁时, P1
  │   → coreClearer: 次级核心时, P1
  │
  ├── submitRequest() [spawn/queue.ts]
  │   → 稳定 key 幂等合并 → RoomMemory.spawnQueue
  │
  ├── fulfillContainerRequests()
  │   → needContainer 标记消费 → room.createConstructionSite
  │   → tick 配额仲裁（让位 emergency）
  │   → 全局总量限流（maxGlobalSites）
  │
  ├── recycleExcessRemoteCreeps()
  │   → 超配额 creep 标记回收
  │
  └── 威胁/InvaderCore 双轨止损
      → threatUntil / blockedUntil / dangerUntil
      → recycleBlockedRoomCreeps()
```

### 1.2 现有远矿经济模型

```
targeting.ts 经济常量:
  SOURCE_INCOME = 10 e/tick (reserved), 5 (unreserved)
  HARVESTER_UPKEEP = 0.4 e/tick
  HAULER_UPKEEP = 0.4 e/tick
  RESERVER_UPKEEP = 2.2 e/tick
  DEFENDER_UPKEEP = 0.35 e/tick
  ROAD_UPKEEP_PER_PATHCOST = 0.002

scoreRemoteCandidate():
  throughput = min(demand, haulerNeed × perHauler)
  netScore = throughput - upkeep
  haulerNeed = ceil(demand / perHauler), cap maxHaulers
```

### 1.3 现有远矿运营状态

```
RemoteOp (Memory.rooms[home].remoteOps[target]):
  state: active | paused | abandoned
  sources: number
  haulerNeed: number
  createdAt / lastSeen
  threatUntil / dangerUntil / blockedUntil
  needCoreClear: boolean
  siteCount: number
  stallSince: number
  lowScoreSince: number
```

### 1.4 现有远矿 Creep 角色

| 角色 | 文件 | 优先级 | 职责 |
| --- | --- | --- | --- |
| `remoteHarvester` | `remote-harvester.ts` | P1 | 采集 source → container/drop，自建 container site，维修 container |
| `remoteHauler` | `remote-hauler.ts` | P1 | 从 remoteTarget container 取能 → home storage/sink |
| `remoteDefender` | `remote-defender.ts` | P1 | 威胁时应战 |
| `reserver` | `reserver.ts` | P2 | reserve controller |
| `coreClearer` | `core-clearer.ts` | P1 | 拆 level-0 InvaderCore |
| `carrier` | `carrier.ts` | P1 | 跨房调拨搬运（Agenda Manager 驱动） |

---

## 2. A4.0 Remote Opportunity → Execution 断裂分析

### 2.1 A4.0 设计的链路

```
RoomIntel → deriveRemoteSource() → assessRemoteValue() → createOpportunity()
  → WAITING_EXECUTION → specialization-planner 评估 → APPROVED/REJECTED
  → APPROVED 后由 remote-mining-manager.selectRemoteTargets() 执行
```

### 2.2 实际断裂点

| 断裂点 | 位置 | 严重度 | 说明 |
| --- | --- | --- | --- |
| **specialization-planner 不存在** | `src/systems/` | 🔴 阻断 | A4.0 规划的系统侧薄壳未创建，Opportunity 无人消费 |
| **Opportunity → remote-mining-manager 无桥接** | 无 | 🔴 阻断 | `remote-mining-manager` 不读取 Opportunity，仍走 `selectRemoteTargets` |
| **Supply Contract → SupplyNode 无注入** | 无 | 🟡 部分 | `contract-node-bridge.ts` 纯函数完整但无系统调用 |
| **EmpireRoomRole 无写入** | 无 | 🟡 部分 | `role-evaluation.ts` 纯函数完整但无系统调用 |
| **Remote Source 无持久化** | 无 | 🟡 部分 | `remote-source.ts` 序列化函数完整但无系统读写 Memory |

### 2.3 断裂的根因

A4.0 Architecture Audit §18 明确指出：

> Remote Opportunity 是规划产物，不直接执行。
> 由 specialization-planner 评估后决定是否开新远矿。
> 开新远矿仍走 remote-mining-manager 的 selectRemoteTargets。

**但 specialization-planner 从未创建。** A4.0 纯函数层完整，系统层缺失。
Remote Opportunity 链路在 `WAITING_EXECUTION` 状态后断裂。

---

## 3. A4.1 核心裁决：是否新建系统？

### 3.1 裁决矩阵

| 决策 | 决定 | 理由 |
| --- | --- | --- |
| 是否新建 Operation System？ | ❌ 不新建 | 复用现有 `OperationContext`（agenda-item.ts），扩展 `type="remote_mining"` |
| 是否新建 Spawn 系统？ | ❌ 不新建 | 复用现有 `spawn-manager` + `spawn/queue.ts` |
| 是否新建 Logistics？ | ❌ 不新建 | 复用现有 `logistics` + `assignment-service`，remoteHauler 已有独立搬运链 |
| 是否新建 Resource Network？ | ❌ 不新建 | 复用现有 `SupplyNode/DemandNode/AllocationPolicy` |
| 是否新建 RemoteMiningManager God Object？ | ❌ 不新建 | 现有 `remote-mining-manager` 已是执行器，不膨胀其职责 |
| 是否新建 RemoteMiningOperation？ | ✅ 新建 | 作为 Operation 的新子类型，生命周期复用现有九态状态机 |
| 是否新建 Specialization Planner？ | ✅ 新建 | A4.0 规划的系统侧薄壳，连接 Opportunity → Execution |
| 是否新建 Remote Economy Dashboard？ | ✅ 新建 | 全链路可观测性 |
| 是否新建 Empire Economic Balance？ | ✅ 新建 | 帝国级经济计算 |
| 是否新建 Local Resilience？ | ⚠️ 可延迟 | A4.1 可先不实现，专业化不等于完全依赖的保障 |

### 3.2 核心架构原则

**A4.1 的核心不是「写一个 Miner + Hauler」——这些已经存在并运行良好。**

A4.1 必须证明：Empire 能自主发现、评估、建立、运行、维护、降级和撤销一个远程采集经济单元。

已有能力（运行中）：
- ✅ 远矿发现：`room-observer` → `selectRemoteTargets()`
- ✅ 远矿评估：`scoreRemoteCandidate()` → netScore
- ✅ 远矿建立：`evaluateRemoteDemand()` → `submitRequest()` → `spawn-manager`
- ✅ 远矿运行：`remoteHarvester` + `remoteHauler` + `reserver` + `remoteDefender`
- ✅ 远矿维护：`reevaluateActiveOps()` + `censusStalledOps()` + `recycleExcessRemoteCreeps()`
- ✅ 远矿降级：`threatUntil` + `blockedUntil` + `dangerUntil` + colonyState 门禁
- ✅ 远矿撤销：`abandoned` 状态 + 超额收缩 + 空转止损
- ✅ Container 基建：`fulfillContainerRequests()` + `remoteHarvester` 自建/维修
- ✅ Creep 死亡恢复：`findReplacement()` + 替换窗口 + 幂等 key

**A4.1 真正需要补齐的是经济闭环：**

| 缺失 | 说明 | A4.1 需要 |
| --- | --- | --- |
| **RemoteMiningOperation** | 将 remoteOps 提升为正式 Operation | ✅ 核心 |
| **Execution Gate** | Opportunity → Operation 前的验证门禁 | ✅ 核心 |
| **Resource Flow Accounting** | Produced / Transported / Delivered / Lost | ✅ 核心 |
| **Economic Accounting** | Gross / Transport / Infra / Spawn / Risk / Net | ✅ 核心 |
| **ROI** | Expected vs Actual 比较 | ✅ 核心 |
| **Budget** | 每 Operation 的预算上限 | ✅ 核心 |
| **Operation Limit** | 并发远矿数量上限 | ⚠️ 已有 `maxOperations`，需扩展 |
| **Empire Integration** | 远矿产出进入 Empire Resource View | ✅ 核心 |
| **Specialization Planner** | A4.0 遗留，需创建系统侧薄壳 | ✅ 必须 |

---

## 4. RemoteMiningOperation 设计

### 4.1 不创建第二套 Operation Lifecycle

现有 `OperationContext`（agenda-item.ts）已支持九态：
`planned → ready → running → verifying → completed | blocked | failed | cancelled | expired`

A4.1 扩展 `OperationType` 联合类型：
```typescript
export type OperationType = "supply" | "claim" | "colonize" | "remote_mining";
```

**不新增状态机**——复用现有九态。RemoteMiningOperation 映射：

| Operation 状态 | Remote Mining 语义 |
| --- | --- |
| `planned` | Opportunity → Operation 创建后，等待 Execution Gate 验证 |
| `ready` | Gate 通过，等待资源/spawn 就绪 |
| `running` | Miner + Hauler 运营中 |
| `verifying` | Economic Activation 验证（连续窗口 Production > 0） |
| `completed` | 远矿永久不可用（source 耗尽/房间丢失） |
| `blocked` | Threat HIGH / InvaderCore 压制 / Route 不可行 |
| `failed` | 预算耗尽 / 长期无法恢复 |
| `cancelled` | 主动撤销（优先级不足/经济不划算） |
| `expired` | 超时未激活 |

### 4.2 RemoteMiningOperation 扩展字段

在 `OperationContext` 基础上扩展（不修改原接口，新增可选字段）：

```typescript
export interface RemoteMiningOperationContext extends OperationContext {
  type: "remote_mining";
  // ── 远矿特有字段 ──
  sourceId: string;           // RemoteSource 幂等键
  targetRoom: string;          // 远矿目标房
  homeRoom: string;            // 孵化房
  // ── 经济追踪 ──
  expectedYield: number;      // 预期产出 (e/tick)
  actualProduction: number;   // 实际产出累计
  actualDelivered: number;     // 实际交付累计
  actualLost: number;          // 损失累计
  // ── 预算 ──
  budget: RemoteOperationBudget;
  // ── 检查点 ──
  checkpoint: RemoteCheckpoint;
  // ── 经济健康度 ──
  economicHealth: RemoteEconomicHealth;
}
```

### 4.3 Execution Gate 检查项

```
1. Source 是否仍存在 → intel.sources > 0
2. Source 是否仍然可采 → intel.status === "normal"
3. Target Room 是否可进入 → !sealedExits || 部分封死
4. Route 是否有效 → pathCost < maxPathCost
5. Threat 是否允许 → dangerUntil 已过期
6. Expected Yield 是否仍然合理 → netValue >= investmentThreshold
7. Empire 是否仍需要资源 → empireDemand > 0
8. Transport Cost 是否仍可接受 → transportCost < maxTransportCost
9. Operation 是否重复 → hasActiveOperation(sourceId) === false
10. Budget 是否足够 → remainingBudget > minBudget
```

### 4.4 Remote Operation Checkpoint

```
DISCOVERED → intel 发现远矿候选
VALIDATED → Execution Gate 通过
PREPARED → spawn 请求提交
INFRASTRUCTURE_READY → container 建成或 drop-mining 可接受
MINING_ACTIVE → harvester 就位，production > 0
LOGISTICS_ACTIVE → hauler 就位，delivered > 0
ECONOMIC_ACTIVE → 连续窗口 netValue > threshold
```

### 4.5 Economic Activation 标准

**不能** Miner Spawn 就认为 Remote Mining Active。

必须连续窗口满足：
1. `Production > 0`（harvester 在采集）
2. `Transport > 0`（hauler 在搬运）
3. `Delivered > 0`（能量到达 home storage）
4. `NetEconomicValue > threshold`（净价值为正）

---

## 5. 已有能力清单（Already Exists — 可复用）

| # | 能力 | 源码位置 | 状态 | 复用方式 |
| --- | --- | --- | --- | --- |
| 1 | **远矿目标选择** | `src/domain/remote/targeting.ts` | ✅ 完整 | `selectRemoteTargets()` 继续作为候选发现 |
| 2 | **远矿经济评分** | `src/domain/remote/targeting.ts` | ✅ 完整 | `scoreRemoteCandidate()` 继续作为净收益评分 |
| 3 | **远矿需求评估** | `src/domain/remote/demand.ts` | ✅ 完整 | `evaluateRemoteDemand()` 继续生成 spawn 请求 |
| 4 | **远矿 staffing** | `src/domain/remote/staffing.ts` | ✅ 完整 | `remoteHaulerTarget()` + `remoteReplacementThreshold()` |
| 5 | **Remote Harvester 角色** | `src/creeps/roles/remote-harvester.ts` | ✅ 完整 | 采集 + container 自建/维修 + drop fallback |
| 6 | **Remote Hauler 角色** | `src/creeps/roles/remote-hauler.ts` | ✅ 完整 | container → home storage/sink 搬运 |
| 7 | **Remote Defender 角色** | `src/creeps/roles/remote-defender.ts` | ✅ 完整 | 威胁应战 |
| 8 | **Reserver 角色** | `src/creeps/roles/reserver.ts` | ✅ 完整 | controller reserve |
| 9 | **Core Clearer 角色** | `src/creeps/roles/core-clearer.ts` | ✅ 完整 | 拆 level-0 InvaderCore |
| 10 | **Remote Mining Manager** | `src/systems/remote-mining-manager.ts` | ✅ 完整 | P2 interval=10，全链运营 |
| 11 | **Intel System** | `src/domain/intel.ts` | ✅ 完整 | RoomIntel 含 sources/pathCost/owner/reservedBy |
| 12 | **Threat Detection** | `src/domain/defense/threat.ts` | ✅ 完整 | `classifyThreats()` body-aware |
| 13 | **Spawn Queue** | `src/domain/spawn/queue.ts` | ✅ 完整 | 幂等 key + TTL + cleanQueue |
| 14 | **Spawn Manager** | `src/systems/spawn-manager.ts` | ✅ 完整 | 唯一 spawnCreep 调用者 |
| 15 | **Logistics** | `src/systems/logistics.ts` | ✅ 完整 | Request Pool + transportPool |
| 16 | **Assignment Service** | `src/systems/assignment-service.ts` | ✅ 完整 | TaskPool 分配 |
| 17 | **Construction Manager** | `src/systems/construction-manager.ts` | ✅ 完整 | 自有房 site 创建 |
| 18 | **Site Quota** | `src/systems/site-quota.ts` | ✅ 完整 | normal + emergency 双槽位 + 全局总量 |
| 19 | **Container 自建** | `remote-harvester.ts` `buildSourceContainer()` | ✅ 完整 | needContainer 标记 → manager 消费 |
| 20 | **Container 维修** | `remote-harvester.ts` `repairSourceContainer()` | ✅ 完整 | acquire + work 双链维修 |
| 21 | **Threat 双轨止损** | `remote-mining-manager.ts` | ✅ 完整 | threatUntil 失明持久化 |
| 22 | **InvaderCore 双轨止损** | `remote-mining-manager.ts` | ✅ 完整 | blockedUntil + lesser/stronghold 分流 |
| 23 | **空转止损** | `remote-mining-manager.ts` `censusStalledOps()` | ✅ 完整 | 全员空转 → abandoned |
| 24 | **经济重估** | `remote-mining-manager.ts` `reevaluateActiveOps()` | ✅ 完整 | netScore 重算 + 低分宽限期 |
| 25 | **超额收缩** | `remote-mining-manager.ts` | ✅ 完整 | activeCount > maxOps → 按成本废弃 |
| 26 | **Creep 死亡恢复** | `demand.ts` `findReplacement()` | ✅ 完整 | 替换窗口 + 幂等 key + 健康守卫 |
| 27 | **回收过量 creep** | `remote-mining-manager.ts` `recycleExcessRemoteCreeps()` | ✅ 完整 | 交接豁免 + 健康配额 |
| 28 | **Operation System** | `src/domain/operation/agenda-item.ts` | ✅ 完整 | 九态状态机 + supply/claim/colonize |
| 29 | **Empire Economy** | `src/systems/empire-economy.ts` | ✅ 完整 | 10 步链 + Resource View |
| 31 | **Remote Source Model** | `src/domain/remote/remote-source.ts` | ✅ 完整 | 5 状态 + 序列化 + deriveFromIntel |
| 32 | **Remote Resource Value** | `src/domain/remote/remote-value.ts` | ✅ 完整 | 净价值评估 + 4 等级 |
| 33 | **Remote Opportunity** | `src/domain/remote/remote-opportunity.ts` | ✅ 完整 | 6 状态 + 过期检测 + 去重 |
| 34 | **Opportunity Ranking** | `src/domain/remote/opportunity-ranking.ts` | ✅ 完整 | 4 维度评分 + 可解释 |
| 35 | **Supply Contract** | `src/domain/economy/supply-contract.ts` | ✅ 完整 | 6 状态 + 序列化 + 交付追踪 |
| 36 | **Contract Lifecycle** | `src/domain/economy/contract-lifecycle.ts` | ✅ 完整 | 状态转换 + 故障检测 + 归档 |
| 37 | **Contract-Node Bridge** | `src/domain/economy/contract-node-bridge.ts` | ✅ 完整 | Contract → SupplyNode/DemandNode 注入 |
| 38 | **Transport Cost** | `src/domain/economy/transport-cost.ts` | ✅ 完整 | 4 维度成本模型 |
| 39 | **Route Efficiency** | `src/domain/economy/route-efficiency.ts` | ✅ 完整 | Delivered/Cost 比率 + 建议 |
| 40 | **Empire Room Role** | `src/domain/economy/empire-role.ts` | ✅ 完整 | 4 角色 + 特征 + 序列化 |
| 41 | **safeRun** | `src/kernel/safe-run.ts` | ✅ 完整 | 错误隔离 |
| 42 | **Event Log** | `src/kernel/event-log.ts` | ✅ 完整 | 事件记录 |
| 43 | **Global Cache** | `src/kernel/global-cache.ts` | ✅ 完整 | heap 缓存 |
| 44 | **Traffic Manager** | `src/systems/traffic-manager.ts` | ✅ 完整 | 移动意图仲裁 |

---

## 6. 缺失能力清单（Missing — 需新建）

| # | 能力 | 说明 | 建议实现位置 |
| --- | --- | --- | --- |
| 1 | **RemoteMiningOperation** | 将 remoteOps 提升为正式 Operation，复用九态状态机 | `src/domain/operation/remote-mining-op.ts` (新) |
| 2 | **Execution Gate** | Opportunity → Operation 前的 10 项验证 | `src/domain/remote/execution-gate.ts` (新) |
| 3 | **Resource Flow Accounting** | Produced/Transported/Delivered/Lost 追踪 | `src/domain/remote/flow-accounting.ts` (新) |
| 4 | **Remote Economic Accounting** | Gross/Transport/Infra/Spawn/Risk/Net | `src/domain/remote/economic-accounting.ts` (新) |
| 5 | **Remote ROI** | Expected vs Actual ROI 比较 | `src/domain/remote/roi.ts` (新) |
| 6 | **Remote Operation Budget** | 每 Operation 的预算上限 + 消耗追踪 | `src/domain/remote/operation-budget.ts` (新) |
| 7 | **Remote Economic Health** | HEALTHY/DEGRADED/UNPROFITABLE/SUSPENDED/FAILED | `src/domain/remote/economic-health.ts` (新) |
| 8 | **Specialization Planner System** | A4.0 遗留，Opportunity 消费 + Role 评估 + Contract 驱动 | `src/systems/specialization-planner.ts` (新) |
| 9 | **Empire Economic Balance** | A4.0 遗留，帝国级生产/消费/运输/储备计算 | `src/domain/strategy/empire-balance.ts` (新) |
| 10 | **Remote Economy Dashboard** | 全链路可观测性 | `src/domain/remote/remote-dashboard.ts` (新) |
| 11 | **Container Lifecycle** | MISSING/PLANNED/BUILDING/ACTIVE/DAMAGED/DESTROYED | `src/domain/remote/container-lifecycle.ts` (新) |
| 12 | **Hauler Sizing** | 基于 Production/Travel/Carry/RoadEfficiency 的动态编制 | 扩展 `staffing.ts` |

---

## 7. 需修改的现有文件（Required Changes）

| # | 变更 | 位置 | 说明 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | **OperationType 扩展** | `agenda-item.ts` | 增加 `"remote_mining"` 类型 + 创建函数 | P0 |
| 2 | **RemoteOp 结构升级** | `global.d.ts` | remoteOps 增加 operationId / checkpoint / economicHealth / budget 字段 | P0 |
| 3 | **remote-mining-manager 集成** | `remote-mining-manager.ts` | 在 selectRemoteTargets 前检查 Opportunity；在 maintainExistingOps 中更新 Operation 状态 | P0 |
| 4 | **Empire Economy 集成** | `empire-economy.ts` | 步 10 buildEmpirePlannerInput 增加远矿产出数据 | P1 |
| 5 | **bootstrap 注册** | `bootstrap.ts` | 注册 specialization-planner System | P1 |
| 6 | **global.d.ts 扩展** | `global.d.ts` | KernelMemory 增加 remoteOperations / remoteOpportunities 字段 | P0 |
| 7 | **CONFIG 扩展** | `config.ts` | 增加 remote budget / ROI threshold / economic activation 参数 | P1 |

---

## 8. 架构冲突与解决

### 8.1 remoteOps vs RemoteMiningOperation 双轨

| 冲突 | 严重度 | 解决方案 |
| --- | --- | --- |
| `Memory.rooms[home].remoteOps[target]` 是扁平结构，无 Operation 生命周期 | 🟡 中 | **渐进迁移**：A4.1 在 remoteOps 上增加 `operationId` 字段关联 RemoteMiningOperation，不破坏现有运营链。Operation 作为 remoteOps 的上层编排。 |

### 8.2 selectRemoteTargets vs Opportunity 并行

| 冲突 | 严重度 | 解决方案 |
| --- | --- | --- |
| `selectRemoteTargets` 直接从 intel 筛选，不读 Opportunity | 🟡 中 | **Opportunity 优先**：specialization-planner 先评估 Opportunity 列表，APPROVED 的直接在 remote-mining-manager 中创建 remoteOps。`selectRemoteTargets` 作为 fallback（无 Opportunity 时仍可直接评选）。 |

### 8.3 Resource Flow 追踪缺失

| 冲突 | 严重度 | 解决方案 |
| --- | --- | --- |
| 当前远矿只有 netScore 评分，无实际产出/交付/损失追踪 | 🟡 中 | **新增 flow-accounting 纯函数**：从 remoteHarvester 的 harvest 量 + remoteHauler 的 transfer 量采集。不修改角色代码——从 Game.creeps 遍历中提取。 |

---

## 9. 真实调用链：当前远矿资源流

### 9.1 当前资源流（已运行）

```
Remote Room (target)
    │
    ├── Source (3000/300tick = 10 e/tick reserved)
    │
    ├── remoteHarvester (P1)
    │   ├── harvest(source) → creep.store
    │   ├── transfer(container) → container.store  [首选]
    │   ├── drop(RESOURCE_ENERGY) → ground         [无 container fallback]
    │   ├── build(containerSite)                    [自建]
    │   └── repair(container)                       [维修]
    │
    ├── Container (0-2000 capacity)
    │
    └── remoteHauler (P1)
        ├── withdraw(container) → creep.store       [在 remoteTarget 房]
        ├── pickup(dropped) → creep.store           [fallback]
        └── transfer(storage) → home storage       [在 home 房]
            └── transfer(spawn/extension)            [fallback]
    
    ↓
    
Home Room (sponsor)
    │
    ├── Storage (能量入库)
    │
    └── Empire Economy (每 100t 采本)
        ├── buildRoomEconomicProfile() → estimatedIncome
        │   ⚠️ 远矿产出未计入 estimatedIncome！
        ├── buildEmpireResourceView() → surplusRooms
        │   ⚠️ 远矿产出未单独追踪！
        └── buildEmpirePlannerInput()
            ⚠️ 无远矿经济数据！
```

### 9.2 当前资源流的问题

| 问题 | 影响 | A4.1 修复 |
| --- | --- | --- |
| **远矿产出不进 Empire Resource View** | Empire 不知道远矿贡献了多少能量 | 在 empire-economy 步 4 聚合远矿产出 |
| **无 Delivered 统计** | 不知道远矿实际交付了多少 | 新增 flow-accounting 追踪 |
| **无 Net Value 计算** | 只看 netScore 评分，不看实际经济价值 | 新增 economic-accounting |
| **无 ROI 比较** | Expected vs Actual 无对比 | 新增 roi 模块 |
| **Container Fill Rate 不监控** | 过量生产时 container 满，不知道是物流不足 | 新增 Container Lifecycle 监控 |

---

## 10. A4.1 实施路线图

### 10.1 Phase 1 — RemoteMiningOperation Foundation

```
remote-mining-op.ts     → Operation 扩展 + 创建/状态转换 + 序列化
execution-gate.ts       → 10 项验证 + 结果枚举
container-lifecycle.ts  → 6 状态容器生命周期
```

### 10.2 Phase 2 — Economic Accounting

```
flow-accounting.ts      → Produced/Transported/Delivered/Lost 追踪
economic-accounting.ts  → Gross/Transport/Infra/Spawn/Risk/Net
roi.ts                  → Expected vs Actual ROI + 阈值判定
operation-budget.ts     → 预算上限 + 消耗追踪 + 超支检测
economic-health.ts      → 5 级健康度 + 可解释
```

### 10.3 Phase 3 — Specialization Planner System

```
specialization-planner.ts → A4.0 遗留系统侧薄壳
  ├── 评估 WAITING_EXECUTION Opportunities
  ├── Execution Gate 验证
  ├── APPROVED → 在 remote-mining-manager 中创建 remoteOps
  ├── REJECTED → 记录原因
  └── 定期重估 Active Operations 的经济健康度
empire-balance.ts        → A4.0 遗留帝国级经济计算
```

### 10.4 Phase 4 — Integration

```
remote-mining-manager.ts → 集成 Operation 生命周期
empire-economy.ts        → 步 4 聚合远矿产出
bootstrap.ts             → 注册 specialization-planner
global.d.ts              → Memory schema 扩展
config.ts                → 远矿经济参数
```

### 10.5 Phase 5 — Observability

```
remote-dashboard.ts → 全链路可观测性
  ├── Remote Source / Operation / Room
  ├── Miner / Hauler / Production / Transport
  ├── Delivered / Loss / Transport Cost
  ├── Net Value / ROI / Threat / Health / Budget
  └── 可解释性：为什么赚钱/为什么暂停
```

### 10.6 Phase 6 — Testing

```
A4.1-001 ~ A4.1-032  → 32+ Contract Tests
A4.1-E2E-001 ~ 010   → 10 E2E Tests
Multi-Remote Simulation → 3 Remote Sources (high/low/risk)
10k Tick Stability     → CPU/Memory/Leak 检查
```

---

## 11. Container Lifecycle 设计

### 11.1 六状态

```
MISSING → PLANNED → BUILDING → ACTIVE → DAMAGED → DESTROYED
                                    ↺           ↺
```

| 状态 | 语义 | 行为 |
| --- | --- | --- |
| MISSING | 无 container，harvester drop-mining | 需求 harvester 发 needContainer 标记 |
| PLANNED | manager 已收到申请，待配额 | 等待 tick 配额 + 全局总量 |
| BUILDING | site 已创建 | harvester 投入建造（buildSourceContainer） |
| ACTIVE | container 建成，正常使用 | harvester 倒能 + hauler 取能 |
| DAMAGED | hits < 80% hitsMax | harvester 维修（repairSourceContainer） |
| DESTROYED | container 被摧毁 | 回到 MISSING，重新走 PLANNED |

### 11.2 Container 与 Operation 联动

```
Operation.state = running
  │
  ├── Container = MISSING → harvester drop-mining，hauler pickup dropped
  ├── Container = PLANNED → 等待配额，harvester drop
  ├── Container = BUILDING → harvester build + drop
  ├── Container = ACTIVE → harvester transfer + hauler withdraw
  ├── Container = DAMAGED → harvester repair + transfer
  └── Container = DESTROYED → 回到 MISSING，hauler pickup 残余
```

---

## 12. Hauler Sizing 设计

### 12.1 动态编制公式

```
RequiredHaulers = ceil(
  ExpectedProduction × RoundTripTime / (CarryCapacity × RoadEfficiency)
)

其中：
  ExpectedProduction = sourceCount × 10 e/tick (reserved)
  RoundTripTime = 2 × pathCost / moveSpeed
  CarryCapacity = haulerBody.carry × 50
  RoadEfficiency = hasRoad ? 1.0 : 0.5
```

### 12.2 采集端联动收缩

**已有实现**（`staffing.ts` `remoteHaulerTarget()`）：
```typescript
effectiveSources = min(sources, max(1, harvestersReady))
haulerTarget = max(1, ceil(haulerNeed × (effectiveSources / sources)))
```

**A4.1 扩展**：基于实际 Production 而非理论 Production 收缩：
```
if actualProduction < expectedProduction × 0.5:
  haulerTarget = max(1, ceil(haulerNeed × (actualProduction / expectedProduction)))
```

### 12.3 Transport Capacity 验证

```
TransportCapacity = haulerCount × perHaulerThroughput
perHaulerThroughput = carryCapacity / roundTripTime

if TransportCapacity < ExpectedProduction:
  → Container Fill Rate 监控
  → if Container 持续满:
    → DEGRADED：增加 Transport Capacity 或降低 Mining Capacity
```

---

## 13. Remote Economic Health 设计

### 13.1 五级健康度

| 等级 | 条件 | 行为 |
| --- | --- | --- |
| HEALTHY | netValue > threshold && ROI > expectedROI | 正常运营 |
| DEGRADED | netValue > 0 但 < threshold，或 Transport < Production | 监控，考虑缩编或增加 hauler |
| UNPROFITABLE | netValue ≤ 0 持续 N 周期 | 暂停，等待条件改善 |
| SUSPENDED | 威胁/预算耗尽/主动暂停 | 停止孵化，回收 creep |
| FAILED | 永久不可恢复（房间丢失/source 耗尽） | 归档删除 |

### 13.2 健康度评估输入

```typescript
interface RemoteEconomicHealthInput {
  operation: RemoteMiningOperationContext;
  flow: ResourceFlowSnapshot;       // Produced/Transported/Delivered/Lost
  economicAccounting: EconomicAccountingResult; // Gross/Net/Cost
  roi: ROIResult;                    // Expected/Actual
  budget: BudgetStatus;             // Remaining/Consumed
  threat: ThreatLevel;              // LOW/MEDIUM/HIGH/CRITICAL
  containerState: ContainerLifecycleState;
}
```

---

## 14. Resource Destination 设计

### 14.1 当前行为

`remoteHauler` 硬编码将能量送回 `home` 房 storage/sink。

### 14.2 A4.1 目标

Remote Mining 必须知道资源送到哪里，但通过 Resource Network 决定。

```
Destination 候选：
  ├── Home Room (默认) → storage
  ├── Support Room (物流枢纽) → terminal
  ├── Production Room (产能中心) → storage
  └── Empire Resource Pool (通过 Supply Contract)
```

### 14.3 实现方式

**不修改 remoteHauler 角色代码**——hauler 已经走 `fillStorage()` + `haulFillTarget()`。

Destination 决定由 **Supply Contract** 上层编排：
- 如果 home 房有 `ACTIVE` Supply Contract 作为 producer → Contract 驱动 AllocationPolicy 分配
- remoteHauler 的产出进入 home storage 后，由 Resource Network 统一调拨
- 不需要 remoteHauler 知道最终目的地

---

## 15. Threat Integration 设计

### 15.1 威胁等级

| 等级 | 条件 | Operation 行为 |
| --- | --- | --- |
| LOW | 无已知威胁 | 正常运营 |
| MEDIUM | 有威胁历史但已过期 | 监控，defender 待命 |
| HIGH | 有活跃威胁 | DEGRADED：暂停经济孵化，defender 应战 |
| CRITICAL | InvaderCore stronghold 或持续威胁 | SUSPENDED：回收 creep，等恢复 |

### 15.2 现有实现

`remote-mining-manager.ts` 已有完整的 Threat Integration：

- `collectRemoteThreats()` → 检测 hostile creep（body-aware）
- `threatUntil` 双轨持久化 → 失明期间维持威胁态
- `dangerUntil` 冷却 → 威胁出现后冷却期不送兵
- `blockedUntil` → InvaderCore 压制冷却
- `hasThreats` → 暂停经济孵化，defender 先应战
- `recycleBlockedRoomCreeps()` → 回收被压制房 creep

**A4.1 只需将现有 threat 逻辑映射到 Operation 的 `blocked`/`suspended` 状态。**

---

## 16. Recovery 设计

### 16.1 Transient Failure → Retry

| 失败类型 | 现有恢复 | A4.1 扩展 |
| --- | --- | --- |
| Miner Death | `findReplacement()` 自动替补 | Operation 保持 running，budget 扣减 spawn cost |
| Hauler Death | `findReplacement()` 自动替补 | 同上 |
| Container Destroyed | `buildSourceContainer()` 重建 | Container → DESTROYED → MISSING → PLANNED |
| Road Destroyed | 无（远矿无道路系统） | N/A — A4.1 不实现远矿道路 |
| Route Failure | 无 | Operation → blocked，重算 route |

### 16.2 Structural Failure → Replan/Cancel

| 失败类型 | 现有恢复 | A4.1 扩展 |
| --- | --- | --- |
| Remote Room Lost | `maintainExistingOps` → abandoned | Operation → cancelled |
| Source Exhaustion | 无（source 不会消失） | Operation → completed |
| Self-claimed | `maintainExistingOps` → abandoned | Operation → completed |
| Hostile Reserved | `maintainExistingOps` → abandoned | Operation → cancelled + blacklist |

---

## 17. Idempotency 设计

### 17.1 现有幂等性

| 实体 | 幂等键 | 去重机制 |
| --- | --- | --- |
| RemoteOp | `target` (roomName) | 同一 target 只有一个 remoteOp |
| SpawnRequest | `spawnKey(role, home, index, target)` | `submitRequest` 按 key 合并 |
| 替补请求 | `replacementKey(role, home, target, dyingName)` | 绑定垂死 creep 名 |
| RemoteSource | `remote:${homeRoom}:${targetRoom}` | 幂等 ID |
| RemoteOpportunity | `source.id` (同 RemoteSource) | `hasActiveOpportunity()` |
| SupplyContract | `contract:${source}:${target}:${resource}` | `hasActiveContract()` |
| OperationContext | `supply:${from}:${to}:${resource}` | `makeOperationId()` |

### 17.2 A4.1 补充

| 实体 | 幂等键 | 说明 |
| --- | --- | --- |
| RemoteMiningOperation | `remote_mining:${homeRoom}:${targetRoom}` | 同一 sourceId 只允许一个 Active Operation |
| Container Site | source + room | `fulfillContainerRequests` 已有 sourcesWithSite 去重 |
| Road Site | N/A | A4.1 不实现远矿道路 |

---

## 18. Empire Integration 设计

### 18.1 资源流闭环

```
Remote Source
    ↓
Production (harvester harvest)
    ↓
Container (transfer)
    ↓
Transport (hauler withdraw → move → transfer)
    ↓
Delivered (home storage)
    ↓
Room Economy (buildRoomEconomicProfile → estimatedIncome)
    ↓
Empire Resource View (buildEmpireResourceView → surplusRooms)
    ↓
Empire Economic Health (evaluateEconomicHealth)
    ↓
Empire Planner Input (buildEmpirePlannerInput)
    ↓
Empire Planner Feedback (重新计算 Resource Balance / Production Capacity / Demand)
```

### 18.2 当前断裂

`buildRoomEconomicProfile()` 的 `estimatedIncome` 只计算本地 source 采集，不包含远矿产出。

### 18.3 修复方案

在 `empire-economy.ts` 步 1 中扩展：
```typescript
// 现有：estimatedIncome = localSourceCount × efficiency
// 扩展：estimatedIncome = localSourceIncome + remoteContribution

const remoteContribution = computeRemoteContribution(snapshot.roomName, tick);
// remoteContribution = Σ active remoteOps[target].actualDeliveredRate
```

---

## 19. Remote Operation Limit 设计

### 19.1 现有上限

```typescript
// targeting.ts
effectiveMaxOperations(hasStorage, spawnCount):
  digestCap = hasStorage ? maxOperations : maxOperationsNoStorage
  return min(digestCap, spawnCount)

// remote-mining-manager.ts
maxOpsWithCapacity = capacityTier === "abundant" ? maxOps + 1 : maxOps
```

### 19.2 A4.1 扩展

```
Active Remote Operations Limit = min(
  spawnCapacity,       // 孵化能力（spawn 数）
  transportCapacity,   // 运输能力（hauler 总运力）
  empireDemand,        // 帝国需求（energy deficit）
  budgetCapacity,      // 预算能力（可用能量预算）
  riskCapacity         // 风险容量（威胁等级加权）
)
```

---

## 20. Contract Test 覆盖矩阵

| # | 测试 ID | 测试内容 | 依赖模块 |
| --- | --- | --- | --- |
| 1 | A4.1-001 | Opportunity Execution Gate | execution-gate.ts |
| 2 | A4.1-002 | Stale Opportunity 过期 | remote-opportunity.ts |
| 3 | A4.1-003 | Remote Source Identity 幂等 | remote-source.ts |
| 4 | A4.1-004 | Operation Deduplication | remote-mining-op.ts |
| 5 | A4.1-005 | Miner Demand 生成 | demand.ts (现有) |
| 6 | A4.1-006 | Hauler Demand 生成 | demand.ts (现有) |
| 7 | A4.1-007 | Spawn Priority 排序 | spawn/queue.ts (现有) |
| 8 | A4.1-008 | Remote Infrastructure site 创建 | remote-mining-manager.ts (现有) |
| 9 | A4.1-009 | Container Lifecycle 六状态 | container-lifecycle.ts |
| 10 | A4.1-010 | Road Lifecycle | N/A (A4.1 不实现) |
| 11 | A4.1-011 | Harvest Production 追踪 | flow-accounting.ts |
| 12 | A4.1-012 | Transport Capacity 验证 | flow-accounting.ts |
| 13 | A4.1-013 | Overproduction 检测 | economic-health.ts |
| 14 | A4.1-014 | Underproduction 检测 | economic-health.ts |
| 15 | A4.1-015 | Resource Destination 路由 | supply-contract.ts (现有) |
| 16 | A4.1-016 | Resource Accounting 追踪 | flow-accounting.ts |
| 17 | A4.1-017 | Economic Accounting 计算 | economic-accounting.ts |
| 18 | A4.1-018 | ROI Expected vs Actual | roi.ts |
| 19 | A4.1-019 | Budget 上限 + 超支检测 | operation-budget.ts |
| 20 | A4.1-020 | Threat Integration 映射 | remote-mining-op.ts |
| 21 | A4.1-021 | Miner Death Recovery | demand.ts (现有) |
| 22 | A4.1-022 | Hauler Death Recovery | demand.ts (现有) |
| 23 | A4.1-023 | Container Recovery | container-lifecycle.ts |
| 24 | A4.1-024 | Road Recovery | N/A (A4.1 不实现) |
| 25 | A4.1-025 | Route Failure 重算 | execution-gate.ts |
| 26 | A4.1-026 | Room Loss → Cancel | remote-mining-op.ts |
| 27 | A4.1-027 | Source Exhaustion → Complete | remote-mining-op.ts |
| 28 | A4.1-028 | Operation Recovery | remote-mining-op.ts |
| 29 | A4.1-029 | Idempotency 全链路 | remote-mining-op.ts |
| 30 | A4.1-030 | Economic Activation 连续窗口 | remote-mining-op.ts |
| 31 | A4.1-031 | Empire Integration 产出聚合 | empire-balance.ts |
| 32 | A4.1-032 | Remote Operation Limit | remote-mining-op.ts |

---

## 21. E2E 测试矩阵

| # | 测试 ID | 场景 | 验证点 |
| --- | --- | --- | --- |
| 1 | A4.1-E2E-001 | Opportunity → Execution → Miner Spawn → Hauler Spawn → Harvest → Transport → Delivery → Empire | 全链路 |
| 2 | A4.1-E2E-002 | Miner Death → Demand → Replacement → Recovery | 死亡恢复 |
| 3 | A4.1-E2E-003 | Hauler Death → Replacement → Transport Recovery | 死亡恢复 |
| 4 | A4.1-E2E-004 | Container Destroyed → Rebuild → Recovery | 基建恢复 |
| 5 | A4.1-E2E-005 | Threat Escalation → Remote Suspend | 威胁集成 |
| 6 | A4.1-E2E-006 | Threat Recovery → Remote Resume | 威胁恢复 |
| 7 | A4.1-E2E-007 | Transport Bottleneck → Hauler Scaling → Production Recovery | 物流扩展 |
| 8 | A4.1-E2E-008 | Unprofitable Remote → Automatic Suspension | 经济降级 |
| 9 | A4.1-E2E-009 | Remote Room Lost → Operation Cancellation | 房间丢失 |
| 10 | A4.1-E2E-010 | Duplicate Opportunity → Single Operation | 去重 |

---

## 22. Multi-Remote Simulation

```
Core Room (home)
    │
    ├── Remote A: 高产量(2 source) / 低风险 / 近距离
    ├── Remote B: 中产量(1 source) / 高距离 / 低风险
    └── Remote C: 高产量(2 source) / 高风险 / 中距离

验证：
  ├── Empire Ranking: A > C > B（按 netValue 排序）
  ├── Empire 决定运行 A + B（C 风险过高）
  ├── 威胁出现 C → C SUSPENDED
  ├── 威胁消除 → C RECOVERING → ACTIVE
  ├── A 预算耗尽 → A DEGRADED
  └── B 经济不划算 → B SUSPENDED → CANCELLED
```

---

## 23. 10k Tick Stability 检查项

| 检查项 | 说明 | 通过标准 |
| --- | --- | --- |
| CPU | 每 tick CPU 消耗 | < CPU.limit × 0.8 |
| Bucket | bucket 余量 | > 5000 |
| Memory | Memory 使用量 | 无增长趋势 |
| Operation Leak | 终态 Operation 是否归档 | 终态后 1000t 清除 |
| Request Leak | stale spawn 请求是否清除 | TTL 过期清除 |
| Creep Leak | 超额 creep 是否回收 | recycle 标记生效 |
| Contract Leak | 终态 Contract 是否归档 | 终态后 retentionTicks 清除 |
| Reservation Leak | 释放的 Reservation 是否清除 | 完成后清除 |

---

## 24. Observability Dashboard 设计

### 24.1 Remote Economy Dashboard 字段

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| Remote Source | remote-source.ts | sourceId / targetRoom / homeRoom |
| Operation | remote-mining-op.ts | operationId / status / checkpoint |
| Room | intel.ts | roomName / kind / status |
| Miner | demand.ts | count / health / replacement |
| Hauler | demand.ts | count / health / replacement |
| Production | flow-accounting.ts | actualProduction (e/tick) |
| Transport | flow-accounting.ts | actualTransported (e/tick) |
| Delivered | flow-accounting.ts | actualDelivered (e/tick) |
| Loss | flow-accounting.ts | actualLost (e/tick) |
| Transport Cost | economic-accounting.ts | e/tick |
| Net Value | economic-accounting.ts | e/tick |
| ROI | roi.ts | expected / actual / delta |
| Threat | threat.ts | level / lastHostileAt |
| Health | economic-health.ts | HEALTHY/DEGRADED/UNPROFITABLE/SUSPENDED/FAILED |
| Status | remote-mining-op.ts | Operation status |
| Budget | operation-budget.ts | remaining / consumed / limit |

### 24.2 可回答的问题

- "这个 Remote Source 为什么现在赚钱？" → Health=HEALTHY, netValue>0, ROI>threshold
- "为什么 Empire 暂停了这个 Remote Operation？" → Health=SUSPENDED, reason=Threat HIGH / Budget 超支 / Unprofitable

---

## 25. 严格禁止清单（合规检查）

> 以下每项均以 ✅ 标记表示**已遵守**——禁止事项未被触碰。

| 禁止项 | A4.1 遵守方式 |
| --- | --- |
| 创建第二套 Operation System | ✅ 已遵守——复用 `OperationContext` 九态 |
| 创建第二套 Logistics System | ✅ 已遵守——remoteHauler 已有独立搬运链 |
| 创建第二套 Spawn System | ✅ 已遵守——复用 `spawn-manager` + `queue.ts` |
| 创建第二套 Resource Network | ✅ 已遵守——复用 `SupplyNode/DemandNode` |
| RemoteMiningManager God Object | ✅ 已遵守——remote-mining-manager 保持执行器角色 |
| Miner 直接控制 Hauler | ✅ 已遵守——Miner 只采集，Hauler 只搬运 |
| Miner 直接控制 Spawn | ✅ 已遵守——Spawn 走 demand → queue → spawn-manager |
| Remote Operation 直接调用 Spawn | ✅ 已遵守——走 demand → queue 链路 |
| Remote Operation 绕过 Request Pool | ✅ 已遵守——走 evaluateRemoteDemand → submitRequest |
| Remote Operation 绕过 Logistics | ✅ 已遵守——remoteHauler 走 fillStorage/haulFillTarget |
| 默认永久运行所有 Remote Source | ✅ 已遵守——有 Operation Limit + 经济健康度 |
| 默认无限增加 Hauler | ✅ 已遵守——有 Transport Capacity 验证 + 采集端联动收缩 |
| 忽略 Transport Cost | ✅ 已遵守——economic-accounting 计算运输成本 |
| 忽略 Threat | ✅ 已遵守——Threat Integration 映射到 Operation 状态 |
| 只统计 Harvest，不统计 Delivered | ✅ 已遵守——flow-accounting 追踪全链路 |
| 只统计 Gross Value，不统计 Net Value | ✅ 已遵守——economic-accounting 计算净价值 |
| 为了通过测试降低 Economic Activation 标准 | ✅ 已遵守——连续窗口 4 项全满足 |

---

## 26. 分类矩阵

### 26.1 Already Exists（可复用）— 44 项

见 §5 完整清单。

### 26.2 Missing（需新建）— 12 项

见 §6 完整清单。

### 26.3 Reusable（需适配但无需重写）

| 能力 | 当前状态 | A4.1 适配 |
| --- | --- | --- |
| `OperationContext` | supply/claim/colonize 三类型 | 扩展增加 `remote_mining` 类型 |
| `RemoteOp` (Memory) | 扁平结构，无 Operation 生命周期 | 增加 `operationId` / `checkpoint` / `economicHealth` / `budget` 字段 |
| `remote-mining-manager` | 直接管理 remoteOps | 集成 Operation 生命周期（状态映射） |
| `empire-economy` | 不含远矿产出 | 步 1 扩展远矿贡献 |
| `bootstrap.ts` | 无 specialization-planner | 注册新系统 |
| `global.d.ts` | 无远矿 Operation Memory | 增加 Memory schema |
| `CONFIG` | 无远矿经济参数 | 增加 budget/ROI/activation 参数 |
| `staffing.ts` | 基于理论 production 收缩 | 扩展为基于实际 production 收缩 |

### 26.4 Conflict（架构冲突）

| 冲突 | 严重度 | 解决方案 |
| --- | --- | --- |
| remoteOps 扁平结构 vs Operation 生命周期 | 🟡 中 | 渐进迁移：operationId 关联，不破坏现有链路 |
| selectRemoteTargets 直接评选 vs Opportunity 驱动 | 🟡 中 | Opportunity 优先，selectRemoteTargets 作为 fallback |
| A4.0 纯函数层完整但系统层缺失 | 🔴 高 | 新建 specialization-planner 系统侧薄壳 |
| 远矿产出不进 Empire Resource View | 🟡 中 | empire-economy 步 1 扩展远矿贡献 |

### 26.5 Deferred

| 延迟项 | 原因 | 延迟到 |
| --- | --- | --- |
| **Remote Road** | 远矿无道路系统，A4.1 不实现 | A4.2+ |
| **Mineral Remote Mining** | A4.1 只做 Energy | A4.2+ |
| **Market Integration** | A4.1 不涉及市场交易 | A4.2+ |
| **Local Resilience Policy** | 专业化不等于完全依赖的保障 | A4.2+ |
| **Military Execution** | A4.1 不实现军事 | A5+ |
| **Complex Route Optimization** | A4.1 用现有 pathCost | A4.2+ |

---

## 27. 结论

### 27.1 审计回答

| # | 问题 | 回答 |
| --- | --- | --- |
| 1 | 当前是否已有 Remote Miner？ | ✅ `remoteHarvester` 完整运行（采集 + container 自建/维修 + drop fallback） |
| 2 | 当前是否已有 Remote Hauler？ | ✅ `remoteHauler` 完整运行（container → home storage/sink） |
| 3 | 当前是否已有 Container？ | ✅ `fulfillContainerRequests()` + `buildSourceContainer()` + `repairSourceContainer()` |
| 4 | 当前是否已有 Road？ | ❌ 远矿无道路系统（A4.1 不实现，延迟到 A4.2+） |
| 5 | 当前是否已有 Remote Harvest？ | ✅ 完整的采集 + 站桩 + drop fallback 链路 |
| 6 | 当前是否已有 Remote Transport？ | ✅ remoteHauler container → home storage 搬运链路 |
| 7 | Remote Opportunity 能否转化为 Operation？ | ❌ **断裂**——A4.0 纯函数完整但 specialization-planner 系统未创建 |
| 8 | 远矿产出是否进入 Empire Economy？ | ❌ **断裂**——estimatedIncome 不含远矿贡献 |
| 9 | 是否有 Resource Flow Accounting？ | ❌ **缺失**——只有 netScore 评分，无实际产出/交付追踪 |
| 10 | 是否有 Economic Accounting？ | ❌ **缺失**——无 Gross/Net/Transport/Infra/Spawn/Risk 计算 |
| 11 | 是否有 ROI？ | ❌ **缺失**——无 Expected vs Actual 比较 |
| 12 | 是否有 Budget？ | ❌ **缺失**——无每 Operation 预算上限 |
| 13 | 是否有 Threat Integration？ | ✅ **完整**——双轨止损 + defender + 回收链路 |
| 14 | 是否有 Death Recovery？ | ✅ **完整**——findReplacement + 幂等 key + 健康守卫 |
| 15 | 是否有 Container Recovery？ | ✅ **完整**——DESTROYED → MISSING → PLANNED → BUILDING |
| 16 | 是否有 Idempotency？ | ✅ **完整**——RemoteOp / SpawnRequest / RemoteSource 均有幂等键 |

### 27.2 架构裁决

| 裁决 | 决定 |
| --- | --- |
| 是否新建 Operation System？ | ❌ 不新建——复用现有 `OperationContext` 九态状态机 |
| 是否新建 Logistics？ | ❌ 不新建——remoteHauler 已有独立搬运链 |
| 是否新建 Spawn 系统？ | ❌ 不新建——复用现有 `spawn-manager` + `queue.ts` |
| 是否新建 Resource Network？ | ❌ 不新建——复用现有 `SupplyNode/DemandNode/AllocationPolicy` |
| 是否新建 RemoteMiningManager God Object？ | ❌ 不新建——`remote-mining-manager` 保持执行器角色 |
| 是否新建 RemoteMiningOperation？ | ✅ 新建——作为 Operation 的新子类型 |
| 是否新建 Specialization Planner？ | ✅ 新建——A4.0 遗留的系统侧薄壳 |
| 是否新建 Economic Accounting？ | ✅ 新建——纯函数模块 |
| 是否新建 Flow Accounting？ | ✅ 新建——纯函数模块 |
| 是否新建 ROI 模块？ | ✅ 新建——纯函数模块 |
| 是否新建 Operation Budget？ | ✅ 新建——纯函数模块 |
| 是否新建 Container Lifecycle？ | ✅ 新建——纯函数模块 |
| 是否新建 Economic Health？ | ✅ 新建——纯函数模块 |
| 是否新建 Execution Gate？ | ✅ 新建——纯函数模块 |
| 是否新建 Remote Dashboard？ | ✅ 新建——纯函数模块 |
| 是否修改 remote-mining-manager？ | ✅ 修改——集成 Operation 生命周期状态映射 |
| 是否修改 empire-economy？ | ✅ 修改——步 1 扩展远矿贡献 |
| 是否修改 bootstrap？ | ✅ 修改——注册 specialization-planner |
| 是否修改 global.d.ts？ | ✅ 修改——增加远矿 Operation Memory schema |
| 是否修改 CONFIG？ | ✅ 修改——增加远矿经济参数 |

### 27.3 实施优先级

1. **RemoteMiningOperation + Execution Gate + Container Lifecycle**（核心基础）
2. **Resource Flow Accounting + Economic Accounting + ROI + Budget**（经济闭环）
3. **Economic Health + Hauler Sizing 扩展**（运行监控）
4. **Specialization Planner System + Empire Balance**（A4.0 遗留接线）
5. **Empire Economy Integration + bootstrap + global.d.ts + CONFIG**（集成）
6. **Remote Economy Dashboard**（可观测性）
7. **32+ Contract Tests + 10 E2E Tests + Multi-Remote Simulation + 10k Tick Stability**（验证）

---

**Audit 完成。** 下一步：按优先级实施 A4.1。