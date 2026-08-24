# A2B_ARCHITECTURE_REVIEW — A2 后半开工前架构审查

> 日期：2026-08-24。基线：HEAD=3bf5982（P4 D2 归位已提交，工作树干净）。
> 方法：先读合同、后考古代码；本文登记「冻结蓝图 ↔ 现有实现 ↔ A2 后半要求」
> 的一致性结论与裁决。A2 后半目标：Empire Foundation——把 Room 从系统顶层
> 升级为 Empire 可管理的 Economic Unit，建立 Observation + Accounting +
> Evaluation + Planning Input 链路，**不进入 Multi-Room Execution**。

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| 合同充分性 | **充分**。冻结蓝图对 Empire/Economy/Room 边界、状态所有权、决策权已有完整定义 |
| 最大发现 | **Empire 战略层 + Economy 核算 + Room 状态归一化已成熟运行**——Empire Foundation 的三个基座已存在 |
| Room Economic Unit | **尚未定义**。Room 向 Empire 暴露的接口目前是分散的 Memory 字段直读，无 Room Economic Contract |
| Empire Resource View | **不存在**。Empire 只消费各房 posture 输入（colonyState/economyPressure），无跨房资源聚合视图 |
| Resource Ownership | **蓝图已冻结**（ECONOMY §1.1：能量属 Room、Empire 持调拨权）；代码层面无显式 Ownership Model 文档 |
| Expansion Readiness | **部分存在**。posture.expansionAllowed + capacity.tier + G1 门控三件已有，但无统一 Readiness 评估 |
| 需 ADR 事项 | 无结构性冲突需修订冻结契约——A2 后半在现有合同框架内实施 |
| 进入 A2 后半 | **GO**（前置项：P3 PASS、A2 前半达标、P4 D2 归位完成） |

## 1. 冻结蓝图审查：Empire Foundation 的合同定义

### 1.1 Empire 的权力与边界（EMPIRE_SYSTEM_MODEL §1 / DECISION_AUTHORITY §1）

冻结蓝图已明确 Empire 的七项垄断权与不拥有的东西：

| 项 | 合同定义 | 现有实现 |
| --- | --- | --- |
| 帝国方向（posture/预算） | Policy 纯函数唯一 | ✅ `empire-strategy.ts` → `evaluateEmpirePosture()` → `Memory.kernel.strategy` |
| 房间注册 / GCL | Empire 垄断 | ✅ `maintainMemory()` 维护自有房名单；GCL 从 `Game.gcl` 派生 |
| 跨房调拨 | Empire（terminal 网络 + 门控） | ⚠️ 蓝图已定义门控（ECONOMY §1.2），代码层有 `terminal-manager.ts` 但无 Empire 级调拨令 |
| 扩张/远矿立项 | 帝国垄断 | ✅ `expansionAllowed` 指令由 posture 下发 |
| 战争授权 | war posture 唯一授权链 | ✅ `war-planner.ts` + posture 滞回 |
| 市场下单 | MarketManager 唯一写者 | ✅ `terminal-manager.ts` 唯一 deal 调用者 |
| 全局优先级 | Policy 求值 | ✅ posture + agenda + capacity 三层 |

**不拥有的**：本地执行细节、creep 指挥权、能量所有权（只有调拨权）——代码层面遵守。

### 1.2 Room 的合同接口（EMPIRE_SYSTEM_MODEL §1 Room）

冻结蓝图定义 Room 向上有两个通道：

| 通道 | 合同定义 | 现有实现 |
| --- | --- | --- |
| Report（向上报告） | 净流/缺口/风险 | ⚠️ **部分实现**：colonyState + economyPressure + lastHostileAt 已被 empire-strategy 读取；但无统一 Report 接口 |
| Request（向上请求） | 援助/授权 | ⚠️ **间接实现**：spawn 队列 + buildQueue 被对应系统读取；无统一 Request 通道 |
| Directive-channel（向下下发） | AgendaItem/调拨令/预算 | ⚠️ posture/agenda/capacity 已下发到 Memory.kernel.*；但无统一下发接口 |

**关键发现**：Room 与 Empire 之间的接口目前是**分散的 Memory 字段直读**。
empire-strategy.ts 直接遍历 `ctx.snapshots()` 读 `roomMem.colonyState` 等——
这是蓝图允许的（DATA_FLOW §1：EmpireSituation 从 RoomState 派生），但缺少
一个显式的 **Room Economic Contract**（即 Room 向 Empire 暴露的标准化接口）。

### 1.3 状态所有权（STATE_OWNERSHIP §3.1–§3.2）

| 状态 | Owner | 现有实现 |
| --- | --- | --- |
| EmpireState（posture/预算/房间注册/GCL） | Empire 战略系统 | ✅ `Memory.kernel.strategy/agenda/capacity/situation` |
| EmpireSituation（威胁/净流/CPU健康/扩张机会） | Empire（聚合重建） | ✅ `buildEmpireSituation()` 纯函数 + `Memory.kernel.situation` |
| RoomState（phase/收支/人口/建造/防御/健康度） | World Model（room-state） | ✅ `room-state.ts` 每 tick 写入 `Memory.rooms[r].colonyState/economyPressure/phase.*` |
| EconomyState（净流/储备/预算） | Economy 系统 | ✅ `economy.ts` 每 50 tick 写入 `Memory.rooms[r].economy.*` |
| RoomSnapshot | World Model | ✅ 每 tick 重建，tick 末作废 |

### 1.4 Economy 核算合同（ECONOMY_ARCHITECTURE §2–§3）

| 合同项 | 现有实现 |
| --- | --- |
| 九概念（Income/Production/Consumption/Storage/Transfer/Budget/Reservation/Demand/Allocation） | ✅ P3 已实现 Income/Consumption/Storage/Reservation/Demand/Allocation；Transfer/Budget 待 P6+ |
| 三指标（净流/储备/风险缓冲） | ✅ `accounting.ts` 纯函数 + `economy.ts` 系统载体 + `Memory.rooms[r].economy` 瘦快照 |
| 消费优先序 P0>P1>P2>P3 | ✅ `colonyState` 门禁 + spawn 车道制 + 请求池收缩 |
| 能量属 Room、Empire 持调拨权 | ✅ 合同已冻结；代码遵守（Economy 不调拨、不下单） |
| 本土净流为正是一切对外援助/扩张的前置 | ⚠️ **蓝图文档已冻结**，代码层面 `expansionAllowed` 由 posture 裁决但未显式检查各房净流 |
| 资源四类（energy/mineral/credits/CPU） | ⚠️ 当前仅 energy 入账；mineral 互济已有（`mineral-logistics.ts`）；credits 管理在 `terminal-manager.ts`；CPU 在 `capacity.ts` |

## 2. 当前真实依赖图（代码考古）

### 2.1 已存在的 Empire Foundation 组件

```text
┌─────────────────────────────────────────────────────────────────┐
│ Empire 战略层（已存在，但缺 Room Economic Contract）             │
│                                                                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          │
│  │ posture.ts   │   │ agenda.ts    │   │ capacity.ts  │          │
│  │ (develop/    │   │ (recovery/   │   │ (abundant/   │          │
│  │  expand/     │   │  defense/    │   │  comfortable/ │          │
│  │  fortify/war)│   │  rcl-push/   │   │  tight/      │          │
│  │              │   │  develop)    │   │  constrained)│          │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘          │
│         │                  │                   │                  │
│         ▼                  ▼                   ▼                  │
│  ┌─────────────────────────────────────────────────────┐         │
│  │ Memory.kernel.strategy / agenda / capacity          │         │
│  │ + situation (adversaries + conditions)              │         │
│  └─────────────────────────────────────────────────────┘         │
│                                                                   │
│  ┌──────────────┐   ┌──────────────┐                            │
│  │ situation.ts  │   │ environment  │  ← 低频采样(100t)          │
│  │ (NamedCond +  │   │ (market/GCL) │                            │
│  │  Adversary)   │   │              │                            │
│  └──────────────┘   └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
         │ 读 RoomMemory.colonyState / economyPressure / lastHostileAt
         │ 读 Memory.rooms[r].economy (净流/储备/风险缓冲)
         │ 读 snapshot.storage / snapshot.rcl / snapshot.threatCreeps
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Room 层（已存在，但缺 Economic Profile）                          │
│                                                                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          │
│  │ room-state.ts │   │ economy.ts   │   │ logistics.ts │          │
│  │ (P0 每 tick)  │   │ (P1 50t错峰)  │   │ (P0 每 tick) │          │
│  │ → colonyState │   │ → 净流/储备/  │   │ → 请求池     │          │
│  │ → econPressure│   │   风险缓冲   │   │   供给/租约  │          │
│  │ → phase.*     │   │ → drift检测   │   │   TTL/老化  │          │
│  └──────────────┘   └──────────────┘   └──────────────┘          │
│                                                                   │
│  Memory.rooms[r]:                                                  │
│    colonyState / economyPressure / phase / economy /              │
│    storageNearFull / controllerDowngradeRisk / claimSecure /      │
│    lastHostileAt / spawnQueue / buildQueue                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键依赖边（代码验证）

| 依赖边 | 蓝图位置 | 代码验证 |
| --- | --- | --- |
| Empire → World Model | DEP_GRAPH §1 `EMP → WM` | ✅ `empire-strategy.ts` 读 `ctx.snapshots()` |
| Economy → World Model | DEP_GRAPH §1 `ECO → WM` | ✅ `economy.ts` 读 `ctx.snapshots()` |
| Logistics → assignment-service | DEP_GRAPH §1 `LOG → ASG` | ✅ `logistics.ts` import `request-pool.ts` |
| Expansion → Intelligence | DEP_GRAPH §1 `EXP → INTL` | ✅ `expansion-manager.ts` 读 intel |
| Expansion → Economy | DEP_GRAPH §1 `EXP → ECO` | ✅ 读 `Memory.rooms[r].economy` |
| Military → Empire(只读) | DEP_GRAPH §1 `MIL → EMP` | ✅ `war-planner.ts` 读 `Memory.kernel.strategy` |
| Military → Spawn(提交) | DEP_GRAPH §1 `MIL → SPAWN` | ✅ 经 Spawn 公共接口 |
| domain 层无 Game/Memory | DEP_GRAPH §3-5 | ✅ lint 红线已执行 |

### 2.3 不存在的组件（A2 后半需要新建）

| 组件 | 蓝图位置 | 现状 |
| --- | --- | --- |
| Room Economic Profile | 未显式定义（隐含在 EMPIRE_SYSTEM_MODEL Room 接口） | ❌ 不存在 |
| Empire Resource View | 未显式定义（隐含在 EmpireSituation） | ❌ 不存在 |
| Resource Ownership Model | ECONOMY §1.1 已冻结合同 | ❌ 无代码层文档 |
| Empire Economic Health | 未显式定义（隐含在 posture 求值输入） | ❌ 不存在 |
| Room Economic Classification | EMPIRE_SYSTEM_MODEL Room「能力门槛 phase」隐含 | ⚠️ colonyState 有 bootstrap/recovery/defense/normal/growth，但无 Core/Production/Candidate 分类 |
| Capacity Model | ECONOMY §2.1 隐含（产能×效率系数） | ⚠️ 有 estimatedIncome + efficiencyFactor，无完整 Capacity Profile |
| Request Scope Model | 未显式定义 | ❌ 当前请求池仅 Room scope |
| Resource Imbalance Detection | ECONOMY §1.2 调拨门控隐含 | ❌ 不存在 |
| Expansion Readiness | EXPANSION §2 G1–G5 门控 | ⚠️ 门控组件散布在 posture/expansion-manager，无统一 Readiness 评估 |
| Empire Budget | GOAL_POLICY_PLAN §4 五域预算 | ⚠️ posture 裁决有隐式预算，无显式 Empire Budget 分配 |
| Reserve Policy | ECONOMY §2.1-7 Reservation | ⚠️ 有 spawn 预留 + 风险缓冲驱动收缩，无显式分层 Reserve Policy |
| Safety Margin | ECONOMY §3 riskBuffer | ⚠️ riskBuffer 已有，但未与 Expansion Readiness 联动 |
| Empire Planner Input | 未显式定义 | ❌ 不存在 |

## 3. A2 后半实施边界裁决

### 3.1 合同约束分析

**冻结蓝图允许什么**：

1. **EmpireSituation 聚合**（STATE_OWNERSHIP §3.1）——heap 派生，每 N tick 全量 + 每 tick 增量。代码已有 `buildEmpireSituation()`，可扩展。
2. **Room Report 接口**（EMPIRE_SYSTEM_MODEL §1 Room）——Room 向上报告净流/缺口/风险。当前是分散直读 Memory，可以归一化为显式接口。
3. **Economy 三指标消费**（ECONOMY §3 G 门控接口）——三指标是扩张门控输入。已有 `queryEconomy()` 公开接口。
4. **posture × budget 求值**（GOAL_POLICY_PLAN §3–§4）——Policy 纯函数，态势分频求值。已有完整实现。

**冻结蓝图禁止什么**：

1. ❌ Empire 直接控制 Creep（DECISION_AUTHORITY §1）
2. ❌ Empire 直接修改 Room Memory（STATE_OWNERSHIP §1 红线——一个状态一个写者）
3. ❌ Empire 绕过 Request Pool（DATA_FLOW §2 决策流合同）
4. ❌ Empire 直接调用 Spawn（DECISION_AUTHORITY §1）
5. ❌ 全帝国能量公共池（ECONOMY §6 红线 1——Empire 持调拨权而非所有权）
6. ❌ Economy 执行调拨或市场下单（ECONOMY §6 红线 4）
7. ❌ domain 层访问 Game/Memory（DEPENDENCY_GRAPH §3-5）

### 3.2 实施范围裁决

A2 后半在现有合同框架内实施，**不修订冻结契约**。实施遵循以下原则：

| 原则 | 内容 |
| --- | --- |
| 只读聚合 | Empire Resource View 是 Read Model——只读消费 Room 状态快照与 Economy 指标，不写 Room Memory |
| 纯函数归 domain | Room Economic Profile / Empire Resource View / Expansion Readiness 等纯计算归 `src/domain/`，系统侧薄壳 |
| 系统侧不新增写者 | 新增系统（如 empire-economy.ts）只写 Empire 自己的状态（EmpireState 扩展），不写 Room 状态 |
| 低频执行 | Empire 级聚合按分频（N tick），不每 tick 全量重算 |
| Memory 瘦 | Empire 只存必要 Summary/Snapshot，不复制完整 RoomState |
| 不进 Multi-Room Execution | 只做 Observation + Accounting + Evaluation + Planning Input，不做跨房运输/claim/reserve |

### 3.3 落点映射（ENGINEERING_BLUEPRINT §2）

| 新增件 | 类型 | 落点 | 蓝图依据 |
| --- | --- | --- | --- |
| Room Economic Profile | 纯函数 | `src/domain/economy/room-profile.ts` | ECONOMY §2 + EMPIRE_SYSTEM_MODEL Room 接口 |
| Empire Resource View | 纯函数 | `src/domain/strategy/resource-view.ts` | EMPIRE_SYSTEM_MODEL Empire + ECONOMY §1 |
| Empire Economic Health | 纯函数 | `src/domain/strategy/economic-health.ts` | GOAL_POLICY_PLAN §4 + ECONOMY §3 |
| Expansion Readiness | 纯函数 | `src/domain/expansion/readiness.ts` | EXPANSION §2 G1–G5 |
| Resource Imbalance | 纯函数 | `src/domain/strategy/imbalance.ts` | ECONOMY §1.2 调拨门控 |
| Empire Budget | 纯函数 | `src/domain/strategy/budget.ts` | GOAL_POLICY_PLAN §4 五域预算 |
| Empire Planner Input | 纯函数 | `src/domain/strategy/planner-input.ts` | DATA_FLOW §2 决策流 |
| Empire Economy 系统 | System | `src/systems/empire-economy.ts` | SYSTEM_BOUNDARIES §1.4 Empire / §1.5 Economy |

**注意**：以上落点均在 ENGINEERING_BLUEPRINT §2 表已有模块范围内（1.4 Empire / 1.5 Economy），
不新增模块——**不需要 ADR**。新增件是现有模块的 domain 层扩展，遵循「domain 纯函数归 domain/」条款。

### 3.4 与冻结蓝图的一致性验证

| 冻结条款 | A2 后半是否遵守 |
| --- | --- |
| DEP_GRAPH §3-1：Execution 不得反向依赖 Strategy | ✅ 新增件在 domain/strategy 和 domain/economy，不 import systems |
| DEP_GRAPH §3-5：domain 层禁 Game/Memory | ✅ 全部纯函数，状态由参数注入 |
| STATE_OWNERSHIP §1：一个状态一个写者 | ✅ Empire 只写 EmpireState 扩展字段，Room 状态仍由 room-state/economy 写 |
| ECONOMY §6 红线 1：全帝国能量公共池 | ✅ Resource View 是只读聚合，不改所有权 |
| ECONOMY §6 红线 4：Economy 执行调拨 | ✅ 只检测 Imbalance，不执行调拨 |
| DECISION_AUTHORITY §1：Empire 不直接控制 Creep | ✅ 只产出 Planning Input |
| SYSTEM_BOUNDARIES §2.3-3：domain 禁 Game/Memory | ✅ 全部纯函数 |
| AGENTS.md：模块顶层禁止访问 Game/Memory | ✅ 系统侧薄壳在 systems/ |

## 4. A2 后半交付物清单与合同映射

### 4.1 交付物 × 合同锚点 × 现状

| # | 交付物 | 合同锚点 | 现状 | 实施 |
| --- | --- | --- | --- | --- |
| 1 | Room Economic Contract | EMPIRE_SYSTEM_MODEL §1 Room 接口 | ❌ 分散 Memory 直读 | 归一化为显式接口类型 |
| 2 | Resource Ownership Model | ECONOMY §1.1 所有权表 | ✅ 蓝图已冻结 | 落地为代码文档 |
| 3 | Empire Resource View | EMPIRE_SYSTEM_MODEL §1 Empire + STATE_OWNERSHIP §3.1 EmpireSituation | ❌ 不存在 | 纯函数聚合各房 Economy |
| 4 | Room Economic Profile | ECONOMY §2 九概念 + §3 三指标 | ⚠️ 数据有，Profile 无 | 纯函数组装标准化 Profile |
| 5 | Capacity Model | ECONOMY §2.1 产能×效率系数 | ⚠️ 有 estimatedIncome | 扩展为完整 Capacity Profile |
| 6 | Empire Economic Health | GOAL_POLICY_PLAN §4 五域预算 + ECONOMY §3 | ❌ 不存在 | 纯函数判定 Healthy/Stable/Deficit/Critical |
| 7 | Resource Deficit Detection | ECONOMY §1.2 调拨门控前置 | ❌ 不存在 | 纯函数检测各房 deficit |
| 8 | Resource Surplus Detection | ECONOMY §1.2 调拨门控前置 | ❌ 不存在 | 纯函数检测各房 surplus |
| 9 | Request Scope Model | DATA_FLOW §2 Demand 语义 | ❌ 仅 Room scope | 扩展 Request 类型加 scope 字段 |
| 10 | Empire Request Routing | DATA_FLOW §2 决策流 | ❌ 不存在 | 纯函数检测跨房需求 |
| 11 | Expansion Readiness | EXPANSION §2 G1–G5 | ⚠️ 组件散布 | 归一化为统一评估纯函数 |
| 12 | Reserve Protection | ECONOMY §2.1-7 Reservation | ⚠️ 有 spawn 预留 | 显式化分层 Reserve Policy |
| 13 | Safety Margin | ECONOMY §3 riskBuffer | ⚠️ 已有 riskBuffer | 联动 Expansion Readiness |
| 14 | Empire Planner Input | DATA_FLOW §2 决策流 | ❌ 不存在 | 纯函数汇总全部 Profile/View/Health |
| 15 | Multi-Room Simulation | TEST_ARCHITECTURE §2 Empire 多房 | ❌ 不存在 | TestWorld 扩展 |
| 16 | Contract Tests | TEST_ARCHITECTURE §2 | ❌ 不存在 | A2B-001..012 |
| 17 | 10k tick stability | IMPLEMENTATION_PHASES §5 出口=指标 | ❌ 未执行 | 模拟 soak |
| 18 | CPU validation | CPU_EXECUTION_MODEL §6 | ❌ 未执行 | 1/5/10/20/50 房模拟 |
| 19 | Memory validation | MEMORY_ARCHITECTURE §4 | ❌ 未执行 | 体积遥测 |
| 20 | Architecture Boundary validation | DEP_GRAPH §4 静态检查 | ✅ lint 红线已执行 | 扩展新增件的 lint 覆盖 |

### 4.2 严格禁止项验证

| 禁止项 | A2 后半是否遵守 |
| --- | --- |
| 直接实现 Remote Mining | ✅ 不做 |
| 直接实现 Claim | ✅ 不做 |
| 直接实现 Reserve | ✅ 不做 |
| 直接实现 Inter-room Transport | ✅ 不做 |
| 直接实现 Terminal | ✅ 不做（terminal-manager 已存在但不扩展） |
| 直接实现 Market | ✅ 不做 |
| 直接实现 Military | ✅ 不做 |
| 直接实现 Expansion Execution | ✅ 不做（只做 Evaluation） |
| 重写 Request Pool | ✅ 不做（只扩展 scope 字段） |
| 重写 Runtime | ✅ 不做 |
| 重新设计 Room Economy | ✅ 不做（只组装 Profile） |
| Empire 做成 God Manager | ✅ 不做（只做 Read Model + Planning Input） |

## 5. 现有代码资产清单（A2 后半可复用）

### 5.1 Economy 核算（已成熟）

| 资产 | 位置 | A2 后半复用方式 |
| --- | --- | --- |
| `queryEconomy(roomName)` | `src/systems/economy.ts` | Room Economic Profile 的数据源 |
| `EnergyLedger` / `EnergyPools` | `src/domain/economy/accounting.ts` | Profile 的收支分解 |
| `contractReserveOf()` | `src/domain/economy/accounting.ts` | Reserve Policy 的基数 |
| `riskBufferTicks()` | `src/domain/economy/accounting.ts` | Safety Margin 的输入 |
| `estimateIncome()` | `src/domain/economy/accounting.ts` | Capacity Model 的产能上界 |
| `EconomyMemorySnapshot` | `src/domain/economy/accounting.ts` | Empire Resource View 的数据源 |

### 5.2 Empire 战略层（已成熟）

| 资产 | 位置 | A2 后半复用方式 |
| --- | --- | --- |
| `evaluateEmpirePosture()` | `src/domain/strategy/posture.ts` | Expansion Readiness 的 posture 输入 |
| `evaluateAgenda()` | `src/domain/strategy/agenda.ts` | Empire Planner Input 的 agenda 字段 |
| `evaluateCapacity()` | `src/domain/strategy/capacity.ts` | Expansion Readiness 的 CPU 门控 |
| `buildEmpireSituation()` | `src/domain/strategy/situation.ts` | Empire Resource View 的态势输入 |
| `RoomStrategyInput` | `src/domain/strategy/posture.ts` | Room Economic Profile 的战略输入子集 |

### 5.3 Room 状态层（已成熟）

| 资产 | 位置 | A2 后半复用方式 |
| --- | --- | --- |
| `roomStateSystem` | `src/systems/room-state.ts` | colonyState / economyPressure / phase.* 数据源 |
| `evaluateColonyPhase()` | `src/domain/economy/phase.ts` | Room Economic Classification 的 phase 输入 |
| `phaseToColonyState()` | `src/domain/economy/phase.ts` | 分类映射基础 |
| `RoomSnapshot` | `src/kernel/contracts.ts` | 所有纯函数的快照输入 |

### 5.4 Request Pool（已成熟）

| 资产 | 位置 | A2 后半复用方式 |
| --- | --- | --- |
| `TransportRequest` | `src/domain/assignment/request-pool.ts` | Request Scope 扩展基础 |
| `buildTransportRequests()` | `src/domain/assignment/request-pool.ts` | 不修改，只扩展 scope |
| `reconcileRegistry()` | `src/domain/assignment/request-pool.ts` | 不修改 |

## 6. 数据流设计（A2 后半新增链路）

```text
┌─────────────────────────────────────────────────────────────────┐
│ Room 层（已有，不修改）                                           │
│  room-state.ts → colonyState/economyPressure/phase              │
│  economy.ts → 净流/储备/风险缓冲/drift                           │
│  logistics.ts → 请求池/供给/租约                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 只读消费
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ A2 后半新增：domain 纯函数层（不触 Game/Memory）                  │
│                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐               │
│  │ room-profile.ts      │  │ resource-view.ts     │               │
│  │ RoomEconomicProfile  │  │ EmpireResourceView   │               │
│  │ (available/reserved/ │  │ (各房 Energy/        │               │
│  │  production/consum-  │  │  Production/         │               │
│  │  ption/netFlow/      │  │  Consumption/Net/   │               │
│  │  storageCapacity/    │  │  Deficit/Surplus)    │               │
│  │  utilization/health) │  │                     │               │
│  └─────────┬───────────┘  └─────────┬───────────┘               │
│            │                        │                            │
│            ▼                        ▼                            │
│  ┌─────────────────────┐  ┌─────────────────────┐               │
│  │ economic-health.ts   │  │ imbalance.ts        │               │
│  │ EmpireEconomicHealth │  │ ResourceImbalance   │               │
│  │ (Healthy/Stable/    │  │ (surplus→deficit    │               │
│  │  Growing/Deficit/   │  │  TransferRequest)   │               │
│  │  Critical)          │  │                     │               │
│  └─────────┬───────────┘  └─────────┬───────────┘               │
│            │                        │                            │
│            ▼                        ▼                            │
│  ┌─────────────────────┐  ┌─────────────────────┐               │
│  │ readiness.ts        │  │ budget.ts           │               │
│  │ ExpansionReadiness  │  │ EmpireBudget        │               │
│  │ (NOT_READY/READY/   │  │ (Reserve/Production/│               │
│  │  STRONGLY_READY)    │  │  Expansion/Free)    │               │
│  └─────────┬───────────┘  └─────────┬───────────┘               │
│            │                        │                            │
│            └──────────┬─────────────┘                            │
│                       ▼                                          │
│            ┌─────────────────────┐                               │
│            │ planner-input.ts    │                               │
│            │ EmpirePlannerInput  │                               │
│            └─────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
                           │ 只读产出
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Empire 系统（新增薄壳：empire-economy.ts）                        │
│  每 N tick 调用 domain 纯函数 → 写 EmpireState 扩展字段           │
│  （Memory.kernel.empireEconomy: 瘦快照）                          │
│  不写 Room Memory，不控制 Creep，不绕过 Request Pool             │
└─────────────────────────────────────────────────────────────────┘
```

## 7. CPU 预算设计

| 层 | 频率 | 成本 | 说明 |
| --- | --- | --- | --- |
| Room Economic Profile 组装 | 每 N tick（50–100，与 economy 同频） | O(rooms) | 纯读 Memory + snapshot 字段组装 |
| Empire Resource View 聚合 | 每 N tick（100–500） | O(rooms) | 遍历各房 Profile 聚合 |
| Empire Economic Health | 每 N tick（与 View 同频） | O(1) | 基于 View 的聚合值判定 |
| Resource Imbalance Detection | 每 N tick（与 View 同频） | O(rooms) | 遍历 View 找 surplus/deficit |
| Expansion Readiness | 每 N tick（100+） | O(1) | 基于 View + posture + capacity 判定 |
| Empire Budget | 每 N tick（与 posture 同频） | O(rooms) | 基于 View 分配预算 |
| Empire Planner Input | 每 N tick（与 View 同频） | O(1) | 汇总全部产出 |

**关键约束**：不每 tick 重算整个 Empire（DATA_FLOW §1 红队 A1 修订）。
采用 Cached Snapshot + Periodic Reconciliation + Event-driven Refresh。

## 8. Memory 契约设计

| 字段 | Owner | 存储 | 频率 |
| --- | --- | --- | --- |
| `Memory.kernel.empireEconomy` | Empire Economy 系统 | Memory 瘦快照 | 每 N tick |
| `Memory.kernel.empireEconomy.totalEnergy` | 同上 | number | 同上 |
| `Memory.kernel.empireEconomy.totalProduction` | 同上 | number ×10 | 同上 |
| `Memory.kernel.empireEconomy.totalConsumption` | 同上 | number ×10 | 同上 |
| `Memory.kernel.empireEconomy.netFlow` | 同上 | number ×100 | 同上 |
| `Memory.kernel.empireEconomy.health` | 同上 | 枚举 | 同上 |
| `Memory.kernel.empireEconomy.deficitRooms` | 同上 | 短 key 数组 | 同上 |
| `Memory.kernel.empireEconomy.surplusRooms` | 同上 | 短 key 数组 | 同上 |
| `Memory.kernel.empireEconomy.expansionReadiness` | 同上 | 枚举 | 同上 |

**体积约束**：O(rooms) 上限 + 孤儿清理（与 MEMORY_ARCHITECTURE §4 一致）。
deficitRooms/surplusRooms 用短 roomName key 数组，总长度有界。

## 9. 架构边界验证清单

| 边界检查 | 验证方式 |
| --- | --- |
| Empire 不直接控制 Creep | 新增件不 import `src/creeps/` |
| Empire 不直接修改 Room Memory | 新增系统只写 `Memory.kernel.empireEconomy`，不写 `Memory.rooms[r].*` |
| Empire 不绕过 Request Pool | Imbalance 只产出 Transfer Request 候选，不经物流执行 |
| Empire 不直接调用 Spawn | 新增件不 import `src/systems/spawn-manager.ts` |
| domain 不访问 Game/Memory | lint 红线：`src/domain/` 禁 `Game`/`Memory`/`RawMemory` |
| 系统顶层不访问 Game/Memory | 新增 `empire-economy.ts` 在 `run()` 内访问，不在模块顶层 |
| 命名 kebab-case | `empire-economy.ts` / `room-profile.ts` 等 |
| 注册在 bootstrap.ts | 新增系统在 bootstrap.ts 注册，不改 Kernel |

## 10. 测试计划概要

| 测试 ID | 场景 | 类型 |
| --- | --- | --- |
| A2B-001 | 单房 Economic Profile 组装 | unit |
| A2B-002 | 多房 Resource View 聚合 | unit |
| A2B-003 | Resource 聚合一致性 | unit |
| A2B-004 | 房 deficit 检测 | unit |
| A2B-005 | 房 surplus 检测 | unit |
| A2B-006 | Empire Economic Health 判定 | unit |
| A2B-007 | Expansion Readiness 各场景 | unit |
| A2B-008 | Reserve 保护 | unit |
| A2B-009 | Request Scope 标记 | unit |
| A2B-010 | Empire Request Routing 检测 | unit |
| A2B-011 | Capacity 计算 | unit |
| A2B-012 | Economic Trend（非库存排名） | unit |
| A2B-S1 | Multi-Room Simulation (3 房) | integration |
| A2B-S2 | Expansion Readiness Scenario A–E | integration |
| A2B-S3 | 1k/5k/10k tick stability | soak |
| A2B-S4 | CPU 1/5/10/20/50 房趋势 | stress |

## 11. 风险评估

| 风险 | 严重度 | 缓解 |
| --- | --- | --- |
| Empire Resource View 每 tick 全量重算 | 高 | 分频聚合 + Cached Snapshot（DATA_FLOW §1 红队 A1） |
| Memory 膨胀（Empire 层存全 Room State） | 高 | 只存 Summary/Snapshot，O(rooms) 上限 + 孤儿清理 |
| Empire 做成 God Manager | 中 | 纯函数在 domain/，系统侧薄壳；Empire 只产出 Planning Input |
| Request Pool scope 扩展破坏幂等 | 中 | scope 是可选字段，不破坏现有 key 语义 |
| Empire Resource View 与实际 Room 状态不同步 | 中 | 分频快照未刷新则沿用上次（DATA_FLOW §1 红队 A1 模式） |
| 扩张误判（库存高但产能低） | 高 | Economic Trend 模型：不只看库存，看净流+产能+消费趋势 |

## 12. 最终文档清单

A2 后半完成后须生成的文档（docs/phase4/）：

| 文档 | 内容 |
| --- | --- |
| `RESOURCE_OWNERSHIP_MODEL.md` | Local/Remote/Reserved/Committed/Transferable/不可转移 资源分层模型 |
| `EMPIRE_RESOURCE_VIEW.md` | Empire 级资源聚合视图设计 |
| `ROOM_ECONOMIC_PROFILE.md` | Room Economic Contract 接口定义 |
| `EMPIRE_ECONOMIC_HEALTH.md` | Healthy/Stable/Growing/Deficit/Critical 判定模型 |
| `CAPACITY_MODEL.md` | Energy Production/Storage/Spawn/Logistics/Construction Capacity Profile |
| `REQUEST_SCOPE_MODEL.md` | Room/Empire/Operation Request Scope |
| `RESOURCE_IMBALANCE_MODEL.md` | Surplus→Deficit Detection + Transfer Request 候选 |
| `EXPANSION_READINESS.md` | NOT_READY/READY/STRONGLY_READY 评估模型 |
| `EMPIRE_BUDGET.md` | Reserve/Production/Infrastructure/Expansion/Free 分配 |
| `ECONOMIC_SAFETY_MARGIN.md` | 产能趋势 + 储备 + 人口 + 关键请求 + 恢复余量 联动 |
| `EMPIRE_PLANNER_INPUT.md` | 全部 Profile/View/Health/Readiness/Budget 汇总 |
| `A2B_TEST_PLAN.md` | A2B-001..012 + Scenario 测试 |
| `A2B_VALIDATION_REPORT.md` | 测试结果 + CPU/Memory 验证 |
| `A2B_FINAL_REPORT.md` | 验收裁决（PASS / NO-GO） |

已有文档 `A2B_ARCHITECTURE_REVIEW.md`（本文）不重复生成。

## 13. A2 后半验收标准对照

| 验收项 | 验证方式 | 对应交付物 |
| --- | --- | --- |
| Room Economic Contract | 类型定义 + 单测 | ROOM_ECONOMIC_PROFILE.md |
| Resource Ownership Model | 文档 + 合同对照 | RESOURCE_OWNERSHIP_MODEL.md |
| Empire Resource View | 纯函数 + 单测 | EMPIRE_RESOURCE_VIEW.md |
| Room Economic Profile | 纯函数 + 单测 | ROOM_ECONOMIC_PROFILE.md |
| Capacity Model | 纯函数 + 单测 | CAPACITY_MODEL.md |
| Empire Economic Health | 纯函数 + 单测 | EMPIRE_ECONOMIC_HEALTH.md |
| Resource Deficit Detection | 纯函数 + 单测 | RESOURCE_IMBALANCE_MODEL.md |
| Resource Surplus Detection | 纯函数 + 单测 | RESOURCE_IMBALANCE_MODEL.md |
| Request Scope | 类型扩展 + 单测 | REQUEST_SCOPE_MODEL.md |
| Empire Request Routing | 纯函数 + 单测 | REQUEST_SCOPE_MODEL.md |
| Expansion Readiness | 纯函数 + Scenario 测试 | EXPANSION_READINESS.md |
| Reserve Protection | 纯函数 + 单测 | EMPIRE_BUDGET.md |
| Safety Margin | 纯函数 + 单测 | ECONOMIC_SAFETY_MARGIN.md |
| Empire Planner Input | 纯函数 + 集成测试 | EMPIRE_PLANNER_INPUT.md |
| Multi-Room Simulation | TestWorld 扩展 + 集成测试 | A2B_TEST_PLAN.md |
| Contract Tests | A2B-001..012 全绿 | A2B_TEST_PLAN.md |
| 10k tick stability | soak 测试 | A2B_VALIDATION_REPORT.md |
| CPU validation | 1/5/10/20/50 房模拟 | A2B_VALIDATION_REPORT.md |
| Memory validation | 体积遥测 | A2B_VALIDATION_REPORT.md |
| Architecture Boundary validation | lint 红线 + 依赖图回归 | A2B_VALIDATION_REPORT.md |

## 14. 实施阶段顺序（建议）

A2 后半实施按以下顺序推进（每步前置依赖已满足才开工）：

| 步 | 内容 | 前置 |
| --- | --- | --- |
| 1 | Room Economic Contract（接口定义 + 纯函数） | 无 |
| 2 | Resource Ownership Model（文档落地） | 步 1 |
| 3 | Capacity Model（扩展 Profile） | 步 1 |
| 4 | Empire Resource View（聚合纯函数） | 步 1 |
| 5 | Empire Economic Health（判定纯函数） | 步 4 |
| 6 | Resource Imbalance Detection（surplus/deficit） | 步 4 |
| 7 | Request Scope Model（类型扩展） | 步 1 |
| 8 | Expansion Readiness（统一评估） | 步 5 + 步 6 + capacity.ts |
| 9 | Empire Budget（预算分配） | 步 5 + 步 8 |
| 10 | Safety Margin（联动模型） | 步 8 + 步 9 |
| 11 | Empire Planner Input（汇总） | 步 1–10 |
| 12 | Empire Economy 系统（系统侧薄壳） | 步 11 |
| 13 | Multi-Room Simulation + Contract Tests | 步 12 |
| 14 | Long-run + CPU + Memory validation | 步 13 |
| 15 | A2B_VALIDATION_REPORT + A2B_FINAL_REPORT | 步 14 |

## 15. 裁决

**GO**。

冻结蓝图对 Empire/Economy/Room 边界、状态所有权、决策权、数据流已有完整定义。
A2 后半在现有合同框架内实施，无需修订冻结契约。现有代码资产（Economy 核算、
Empire 战略层、Room 状态归一化、Request Pool）已为 Empire Foundation 提供
三个成熟基座。A2 后半的工作是：在 domain/ 层新增纯函数件组装标准化
Room Economic Profile → Empire Resource View → Empire Economic Health →
Resource Imbalance → Expansion Readiness → Empire Planner Input 链路，
在 systems/ 层新增一个低频薄壳系统驱动该链路。

**严格禁止**进入 Multi-Room Execution（Remote Mining / Claim / Reserve /
Inter-room Transport / Terminal Automation / Market / Military / Expansion
Execution）。A2 后半只做 Observation + Accounting + Evaluation + Planning Input。

这条链路建立完成后，下一阶段才正式进入 A3 / Multi-Room Empire Execution。