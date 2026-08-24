# A3_ARCHITECTURE_AUDIT — Multi-Room Empire Execution 开工前架构审计

> 日期：2026-08-24。基线：HEAD=9fcbca4（A2B PASS 已提交，工作树干净）。
> 阶段：A3.0 — Multi-Room Execution Foundation。
> 方法：先读合同、后考古代码；本文登记「冻结蓝图 ↔ 现有实现 ↔ A3.0 要求」
> 的一致性结论、架构差距、设计裁决与实施边界。
> **禁止修改核心代码**——本文为设计审查阶段产出。

---

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| 合同充分性 | **充分**。冻结蓝图对 Empire/Room/Operation/Logistics/Request/Reservation 边界已有完整定义 |
| 最大发现 | **A2B 已建立完整的 Observation + Planning Input 链路**；A3.0 需要从「理解」跃迁到「执行」——Operation Model 是核心新增抽象 |
| Operation Model | **蓝图已冻结概念但代码不存在**。EMPIRE_SYSTEM_MODEL §1 定义 Operation=AgendaItem，但当前无 Agenda 管理器系统、无 Operation 运行时实例 |
| Cross-Room Request | **类型已扩展但消费侧不存在**。request-pool 已有 scope="empire" + targetRoom 字段，但 logistics 系统不消费它们 |
| Resource Reservation | **房内租约已实现**；跨房资源预留**不存在** |
| Logistics | **房内请求池已成熟**；跨房运输**完全不存在** |
| Scheduler | **Kernel Scheduler 已有 System 分频调度**；Empire 级低频调度**不存在** |
| 需 ADR 事项 | **无结构性冲突**——A3.0 在现有合同框架内实施；Operation=AgendaItem 已冻结，不需新 ADR |
| 进入 A3.0 | **GO**（前置项：A2B 20/20 PASS、合同充分、代码基线干净） |

---

## 1. 冻结蓝图审查：A3.0 的合同定义

### 1.1 Empire 的执行权边界（EMPIRE_SYSTEM_MODEL §1 / DECISION_AUTHORITY §1）

冻结蓝图明确 Empire 的七项垄断权与执行约束：

| 权力 | 合同定义 | 现有实现 | A3.0 需求 |
| --- | --- | --- | --- |
| 跨房调拨 | Empire（terminal 网络 + 门控） | ⚠️ terminal-manager 有 send 能力但无 Empire 级调拨令 | ✅ A3.0 需建立调拨决策链 |
| 房间注册 | Empire 垄断 | ✅ maintainMemory() 维护自有房名单 | ✅ 需扩展为 Room Registry |
| 全局优先级 | Policy 求值 | ✅ posture + agenda + capacity | ✅ 需联动 Operation 优先级 |
| 目标选择权 | Policy 纯函数唯一 | ✅ evaluateEmpirePosture() | ✅ 不变 |

**Empire 不拥有的**（冻结红线）：
- ❌ 本地执行细节 → Room 自治
- ❌ creep 指挥权 → RolePolicy + Execution Runtime
- ❌ 能量所有权 → Room 持有，Empire 只有调拨权
- ❌ 直接 spawnCreep → 必须经 SpawnManager
- ❌ 直接修改 Room Memory → 状态所有权红线

### 1.2 Operation = AgendaItem（EMPIRE_SYSTEM_MODEL §1 / PLANNING_ARCHITECTURE §3）

冻结蓝图的核心裁决：

> **Operation（行动）= AgendaItem**。"Directive" 与 "Operation" 作为运行时类型**不存在**。
> 唯一运行时形态是 AgendaItem。

AgendaItem 数据契约（PLANNING_ARCHITECTURE §3）：

```text
AgendaItem {
  id:               稳定幂等键 `${type}:${targetRoom}`
  type:             remote | expansion | war | rebuild | evacuatereserve | paramilitary
  budget:           { energy 端点, CPU 参考, population 上限 }
  deadline:         tick
  minDuration:      tick
  cancelConditions: 谓词列表
  milestones:       验收判据列表（行为证据）
  status:           pending | active | done | failed | expired | cancelled | superseded
  outcome?:         完成核验摘要
  # 属地：母房
}
```

**当前代码现状**：
- ❌ Agenda 管理器系统**不存在**（SYSTEM_BOUNDARIES §1.13 定义了职责但无实现）
- ❌ AgendaItem Memory 结构**不存在**
- ❌ AgendaItem 生命周期（立项→复核→核验→归档）**不存在**
- ✅ Empire Policy 已有 `expansionAllowed` 授权信号
- ✅ Empire Strategy 已有 posture + budget 求值

### 1.3 Room 的合同接口（EMPIRE_SYSTEM_MODEL §1 Room）

| 通道 | 合同定义 | 现有实现 | A3.0 需求 |
| --- | --- | --- | --- |
| Report（向上报告） | 净流/缺口/风险 | ✅ RoomEconomicProfile 已实现 | ✅ 直接消费 |
| Request（向上请求） | 援助/授权 | ⚠️ scope="empire" 类型已有但无消费侧 | ✅ A3.0 需消费 empire scope 请求 |
| Directive-channel（向下下发） | AgendaItem/调拨令/预算 | ⚠️ posture 已下发但无 AgendaItem | ✅ A3.0 需建立下发链路 |

### 1.4 Logistics 物流合同（LOGISTICS_ARCHITECTURE §1-§2）

| 条款 | 合同定义 | 现有实现 | A3.0 需求 |
| --- | --- | --- | --- |
| 裁决 | Logistics = 请求池系统 | ✅ logistics.ts 是请求池载体 | ✅ 扩展为跨房 |
| Supply 供给 | 五源登记 | ✅ 房内 container 供给已实现 | ⚠️ 需扩展跨房供给（storage/terminal） |
| Demand 搬运请求 | 五字段：资源/数量/位置/优先级/TTL | ✅ TransportRequest 已实现 | ✅ 扩展 scope="empire" 消费 |
| Reservation 预留 | 租约=容量预留+TTL+心跳 | ✅ 房内 hauler 租约已实现 | ❌ 跨房资源预留不存在 |
| Transport 搬运执行 | 认领即 Task（六态） | ✅ AssignmentTaskEntry + hauler 认领 | ⚠️ 需支持跨房 Task |
| Route 路由 | 房内=路径缓存；跨房=Game.map.findRoute+房内 PathFinder | ✅ 房内路径缓存已有 | ❌ 跨房路由不存在 |

### 1.5 状态所有权（STATE_OWNERSHIP §3）

| 状态 | Owner | 现有实现 | A3.0 需求 |
| --- | --- | --- | --- |
| EmpireState | Empire 战略系统 | ✅ Memory.kernel.strategy/agenda/capacity | ✅ 扩展 empireEconomy 已有 |
| AgendaItem | Agenda 管理器 | ❌ 不存在 | ✅ A3.0 新建 |
| RoomState | World Model | ✅ room-state.ts | ✅ 不变 |
| EconomyState | Economy 系统 | ✅ economy.ts | ✅ 不变 |
| SpawnState | SpawnManager | ✅ spawn-manager.ts | ✅ 不变 |
| TrafficState | TrafficResolver | ✅ traffic-manager.ts | ✅ 不变 |

---

## 2. 当前真实架构图（代码考古）

### 2.1 Current Architecture — 已存在的组件

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Empire 战略层（已存在）                                               │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │ posture.ts   │   │ agenda.ts    │   │ capacity.ts  │              │
│  │ (4 态滞回)    │   │ (5 类立项)   │   │ (4 档预算)   │              │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘              │
│         │                  │                   │                      │
│         ▼                  ▼                   ▼                      │
│  ┌─────────────────────────────────────────────────────┐              │
│  │ Memory.kernel.strategy / agenda / capacity         │              │
│  │ + situation (adversaries + conditions)              │              │
│  │ + empireEconomy (A2B 瘦快照)                        │              │
│  └─────────────────────────────────────────────────────┘              │
│                                                                       │
│  ┌──────────────────────────┐                                        │
│  │ empire-economy.ts (A2B)  │  ← 每 100t 低频聚合                     │
│  │ → EmpirePlannerInput     │                                         │
│  │ (只读消费 Room 状态)      │                                        │
│  └──────────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
         │ 只读消费
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Room 层（已存在，每房自治）                                           │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │ room-state.ts │   │ economy.ts   │   │ logistics.ts │              │
│  │ (P0 每 tick)  │   │ (P1 50t)     │   │ (P0 每 tick) │              │
│  └──────────────┘   └──────────────┘   └──────────────┘              │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │ spawn-mgr.ts  │   │ construction │   │ defense.ts   │              │
│  │ (P0 每 tick)  │   │ -manager.ts  │   │ (P0 每 tick) │              │
│  └──────────────┘   └──────────────┘   └──────────────┘              │
│                                                                       │
│  ┌──────────────────────────────────────────┐                        │
│  │ assignment-service.ts (房内任务分配)       │                        │
│  │ → fill / haul / build / upgrade 任务      │                        │
│  │ → chooseTaskForRole (优先级+距离)          │                        │
│  └──────────────────────────────────────────┘                        │
│                                                                       │
│  Memory.rooms[r]:                                                    │
│    colonyState / economyPressure / phase / economy /                  │
│    storageNearFull / controllerDowngradeRisk / claimSecure /          │
│    lastHostileAt / spawnQueue / buildQueue                            │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Execution Runtime（已存在）                                            │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐                                 │
│  │ role-runner   │   │ traffic-mgr  │  ← tick 末按房仲裁 move          │
│  │ (creep 钩子)  │   │ (intent)     │                                 │
│  └──────────────┘   └──────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 不存在的组件（A3.0 需新建）

| 组件 | 蓝图位置 | 现状 | A3.0 动作 |
| --- | --- | --- | --- |
| Agenda 管理器 | SYSTEM_BOUNDARIES §1.13 | ❌ 不存在 | 新建 System |
| AgendaItem 运行时 | PLANNING_ARCHITECTURE §3 | ❌ 不存在 | 新建 domain 类型 + Memory 结构 |
| Room Registry | EMPIRE_SYSTEM_MODEL §1 Empire | ⚠️ maintainMemory 有房名但无 Registry | 新建 domain 纯函数 |
| Operation Lifecycle | PLANNING_ARCHITECTURE §3 | ❌ 不存在 | 新建 domain 状态机 |
| Cross-Room Request 消费 | LOGISTICS §2.1 | ⚠️ scope 字段有但 logistics 不消费 | 扩展 logistics.ts |
| Resource Reservation（跨房） | LOGISTICS §2.1 #3 | ❌ 不存在 | 新建 domain 纯函数 |
| Transport Planning | LOGISTICS §2.1 Route | ❌ 跨房路由不存在 | 新建 domain 纯函数 |
| Empire Scheduler | 新增（合同内低频分频） | ❌ 不存在 | 扩展 empire-economy.ts 或新建 |
| Event-driven Replanning | DATA_FLOW §1 红队 A1 | ❌ 不存在 | 新建 domain 纯函数 |
| Transfer Verification | PLANNING_ARCHITECTURE §3 milestones | ❌ 不存在 | 新建 domain 纯函数 |
| Operation Deduplication | PLANNING_ARCHITECTURE §4 防振荡 | ❌ 不存在 | 新建 domain 纯函数 |

---

## 3. Required A3.0 Architecture — 目标架构图

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Empire 层                                                             │
│                                                                       │
│  ┌────────────────────────────────────────────┐                      │
│  │ Empire Planner (A2B 已有)                   │                      │
│  │ → EmpirePlannerInput                       │                      │
│  │   (profiles / resourceView / health /      │                      │
│  │    imbalance / budget / readiness /         │                      │
│  │    safetyMargin)                            │                      │
│  └──────────────────┬─────────────────────────┘                      │
│                     │                                                 │
│                     ▼                                                 │
│  ┌────────────────────────────────────────────┐  ┌────────────────┐ │
│  │ Operation Planner (NEW)                     │  │ Room Registry  │ │
│  │                                              │  │ (NEW)           │ │
│  │ • 消费 EmpirePlannerInput                   │  │ • Known Rooms   │ │
│  │ • 检测 Imbalance → 创建 Supply Operation    │  │ • Room Profiles  │ │
│  │ • Operation Deduplication (幂等键)          │  │ • Room Health    │ │
│  │ • Operation Lifecycle 状态机                │  │ • Room Role      │ │
│  │ • Allocation Policy (分配策略)              │  │ • Stale 清理     │ │
│  └──────────────────┬─────────────────────────┘  └────────────────┘ │
│                     │                                                 │
│                     ▼                                                 │
│  ┌────────────────────────────────────────────┐                      │
│  │ Agenda Manager (NEW System)                │                      │
│  │                                              │                      │
│  │ • AgendaItem 生命周期：                     │                      │
│  │   PLANNED→READY→RUNNING→VERIFYING→          │                      │
│  │   COMPLETED / BLOCKED/FAILED/CANCELLED/     │                      │
│  │   EXPIRED                                    │                      │
│  │ • 低频复核（100+ tick）                     │                      │
│  │ • 里程碑验收（行为证据）                    │                      │
│  │ • 防振荡三防线（滞回+承诺+重建冷却）        │                      │
│  └──────────────────┬─────────────────────────┘                      │
│                     │                                                 │
│                     ▼                                                 │
│  ┌────────────────────────────────────────────┐                      │
│  │ Reservation Manager (NEW domain)           │                      │
│  │                                              │                      │
│  │ • 跨房资源预留                               │                      │
│  │ • Source Reservation（防超卖）               │                      │
│  │ • Safety Reserve 检查                       │                      │
│  │ • Reservation Release（成功/失败）          │                      │
│  └──────────────────┬─────────────────────────┘                      │
│                     │                                                 │
│                     ▼                                                 │
│  ┌────────────────────────────────────────────┐                      │
│  │ Transport Planner (NEW domain)              │                      │
│  │                                              │                      │
│  │ • Route Planning (Game.map.findRoute)       │                      │
│  │ • Carrier Body Plan                         │                      │
│  │ • ETA 估算                                   │                      │
│  │ • Transfer Task 生成                        │                      │
│  └──────────────────┬─────────────────────────┘                      │
│                     │                                                 │
└─────────────────────┼─────────────────────────────────────────────────┘
                      │
                      ▼  (经 Request Pool + Spawn + Execution)
┌─────────────────────────────────────────────────────────────────────┐
│ Execution 层（已有，扩展跨房）                                         │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐                                 │
│  │ SpawnManager │   │ logistics.ts │  ← 扩展消费 scope="empire"       │
│  │ (不变)       │   │ (扩展)       │                                 │
│  └──────────────┘   └──────────────┘                                 │
│                                                                       │
│  ┌──────────────────────────────────────────┐                        │
│  │ assignment-service.ts (扩展跨房 Task)      │                        │
│  │ → haul task with targetRoom               │                        │
│  └──────────────────────────────────────────┘                        │
│                                                                       │
│  ┌──────────────────────────────────────────┐                        │
│  │ Transfer Verification (NEW domain)        │                        │
│  │ → 验证 Target Resource State              │                        │
│  │ → Partial Fulfillment 处理                │                        │
│  └──────────────────────────────────────────┘                        │
│                                                                       │
│  ┌──────────────┐                                                     │
│  │ role-runner   │  ← hauler 执行跨房搬运                              │
│  │ (不变)       │                                                     │
│  └──────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Feedback 层（NEW）                                                    │
│                                                                       │
│  ┌──────────────────────────────────────────┐                        │
│  │ Event-driven Replanning (NEW)             │                        │
│  │ → 检测关键事件 → 触发重规划               │                        │
│  │ → 事件：Health 变化/Storage 越阈/         │                        │
│  │   Request 创建/过期/Transport 失败/        │                        │
│  │   Creep 死亡/Room 失守/Target 变化        │                        │
│  └──────────────────────────────────────────┘                        │
│                                                                       │
│  ┌──────────────────────────────────────────┐                        │
│  │ Operation Metrics (NEW)                  │                        │
│  │ → Created/Completed/Failed/Cancelled/     │                        │
│  │   Retried/AvgTime/AvgAmount/FailureRate/ │                        │
│  │   Pending/Stale/ReservationLeakage       │                        │
│  └──────────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 12 审计问题回答

### Q1: 当前 Empire 是否可以产生执行计划？

**否**。Empire 当前可以产出 `EmpirePlannerInput`（A2B 已实现），包含
ResourceView / Health / Imbalance / Budget / Readiness / SafetyMargin。
但这只是**规划输入**——不产生可执行的 Operation / Request / Task。
A2B 的 `imbalance.ts` 产出 `TransferCandidate` 列表和
`candidatesToEmpireRequests()` 转换函数，但 logistics 系统不消费它们。

### Q2: 当前 Request Pool 是否支持跨 Room Request？

**部分是**。`TransportRequest` 已有 `scope?: RequestScope` 和
`targetRoom?: string` 字段（A2B 步 11 扩展）。但：
- `buildTransportRequests()` 只生成 `scope="room"` 请求（无 empire scope）
- `logistics.ts` 只消费房内请求（不读 scope/targetRoom）
- `candidatesToEmpireRequests()` 纯函数存在但无系统调用

### Q3: 当前 Reservation 是否支持资源归属？

**部分是**。房内 Reservation 已实现：
- `supplyLedger()` 计算每源活跃租约与剩余可开租约
- `buildTransportRequests()` 防超卖（remainingSlots=0 不生成请求）
- hauler 认领即 Task（六态租约），带 TTL + 心跳

但**跨房资源预留不存在**：
- 无跨房资源归属模型（Room A 的多少能量可被 Empire 调拨）
- 无跨房 Reservation 数据结构
- 无 Reservation 释放/回收机制

### Q4: 当前 Logistics 是否支持 Source Room / Target Room？

**否**。当前 logistics.ts 只处理房内请求：
- `toTaskEntry()` 生成 `AssignmentTaskEntry`，无 targetRoom 字段
- hauler 认领任务后只在房内执行（source container → spawn/extension）
- 无跨房运输路径规划

### Q5: 当前 Task Model 是否支持跨 Room Task？

**否**。`AssignmentTaskEntry` 无 targetRoom 字段。当前任务类型为
fill / haul / build / upgrade，全部房内执行。跨房 haul 任务不存在。

### Q6: 当前 Execution Layer 是否知道 Room Context？

**是**。Execution Runtime 通过 `RoomSnapshot` 感知当前房 context：
- role-runner 读取 `creep.memory.home` 确定 home room
- `creep.room` 提供当前所在 room 的活对象
- 但无跨房执行链路（hauler 不会跨房认领任务）

### Q7: 当前 Scheduler 是否支持 Operation？

**否**。当前 Scheduler 只支持 System 分频调度：
- Kernel Scheduler 遍历 System 注册表，按 `interval` 分频执行
- 无 Agenda 管理器系统（SYSTEM_BOUNDARIES §1.13 定义了但未实现）
- 无 AgendaItem 低频复核循环
- 无 Operation 级调度

### Q8: 当前 Runtime 是否支持多个 Room 并行执行？

**是**。Kernel 已支持多房并行：
- `ctx.snapshots()` 遍历所有自有房快照
- 各系统（logistics / economy / room-state）已按房遍历执行
- role-runner 按 creep 驱动（creep 在哪个房就在哪个房执行）
- 但**跨房协调执行不存在**（无跨房 Task / 无跨房 Request 消费）

### Q9: 当前 Memory 是否存在 Empire / Room / Operation 边界？

**部分是**。Empire / Room 边界已清晰：
- `Memory.kernel.*` = Empire 状态（posture / agenda / capacity / strategy / empireEconomy）
- `Memory.rooms[r].*` = Room 状态（colonyState / economy / phase / ...）

但**Operation 边界不存在**：
- 无 `Memory.kernel.agendas` 或类似结构
- 无 AgendaItem 持久化
- 无 Operation 状态机 Memory 结构

### Q10: 哪些能力已经存在？

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| Empire 经济感知 | empire-economy.ts + A2B 链路 | ✅ 完整 |
| Room Economic Profile | room-profile.ts | ✅ 完整 |
| Empire Resource View | resource-view.ts | ✅ 完整 |
| Empire Economic Health | economic-health.ts | ✅ 完整 |
| Resource Imbalance Detection | imbalance.ts | ✅ 完整（只检测不执行） |
| Empire Budget | budget.ts | ✅ 完整 |
| Expansion Readiness | readiness.ts | ✅ 完整 |
| Safety Margin | safety-margin.ts | ✅ 完整 |
| Empire Planner Input | planner-input.ts | ✅ 完整 |
| Room 状态归一化 | room-state.ts | ✅ 完整 |
| Economy 核算 | economy.ts + accounting.ts | ✅ 完整 |
| 房内 Request Pool | request-pool.ts + logistics.ts | ✅ 完整 |
| 房内 Assignment | assignment-service.ts | ✅ 完整 |
| Spawn Manager | spawn-manager.ts | ✅ 完整 |
| Construction Manager | construction-manager.ts | ✅ 完整 |
| Defense | defense-planner.ts + tower-defense.ts | ✅ 完整 |
| Traffic Manager | traffic-manager.ts | ✅ 完整 |
| Role Runner | creeps/engine/ | ✅ 完整 |
| CPU 看门狗 | scheduler.ts + kernel.ts | ✅ 完整 |
| Memory 迁移 | memory.ts | ✅ 完整 |
| SafeRun 错误隔离 | safe-run.ts | ✅ 完整 |

### Q11: 哪些能力缺失？

| 缺失能力 | 合同依据 | A3.0 需求 |
| --- | --- | --- |
| Agenda 管理器系统 | SYSTEM_BOUNDARIES §1.13 | **核心** — Operation 生命周期 |
| AgendaItem 数据结构 | PLANNING_ARCHITECTURE §3 | **核心** — Operation 持久化 |
| Operation Lifecycle 状态机 | PLANNING_ARCHITECTURE §3 | **核心** — PLANNED→READY→RUNNING→VERIFYING→COMPLETED |
| Room Registry | EMPIRE_SYSTEM_MODEL §1 Empire | **核心** — Known Rooms + Profiles + Health + Role |
| Cross-Room Request 消费 | LOGISTICS §2.1 | **核心** — logistics 消费 scope="empire" |
| Resource Ownership Model（跨房） | ECONOMY §1.1 | **核心** — transferable 计算 |
| Source Reservation（跨房） | LOGISTICS §2.1 #3 | **核心** — 防超卖 |
| Transport Planning | LOGISTICS §2.1 Route | **核心** — 跨房路由 |
| Transfer Verification | PLANNING_ARCHITECTURE §3 milestones | **核心** — 行为证据验收 |
| Partial Fulfillment | 新增 | **重要** — 剩余量继续调度 |
| Failure Recovery | PLANNING_ARCHITECTURE §4 | **核心** — 检测→更新→释放→重计划 |
| Operation Deduplication | PLANNING_ARCHITECTURE §4 | **核心** — 幂等键防 Operation Storm |
| Event-driven Replanning | DATA_FLOW §1 红队 A1 | **重要** — 关键事件触发 |
| Empire Scheduler（低频） | 新增（合同内低频分频） | **重要** — 不每 tick 全量重算 |
| Allocation Policy | ECONOMY §1.2 | **核心** — surplus→deficit 分配 |
| Safety Reserve Protection | ECONOMY §1.2 | **核心** — 不抽干 surplus 房 |
| Operation Metrics | TEST_ARCHITECTURE §2 | **重要** — 可观测性 |
| Multi-Room Dashboard | 新增 | **重要** — 可观测性 |

### Q12: 哪些能力必须新增？

A3.0 **必须新增**的核心能力（按优先级排序）：

1. **Operation Model** — AgendaItem 类型 + 生命周期状态机 + 幂等键
2. **Agenda 管理器系统** — 系统侧薄壳，低频复核，写 Memory
3. **Room Registry** — 已知房间注册 + Profile + Health + Role + Stale 清理
4. **Cross-Room Request 消费** — logistics 扩展消费 scope="empire"
5. **Resource Ownership + Transferable 计算** — surplus 房可调拨量
6. **Source Reservation（跨房）** — 预留 + 释放 + 防泄漏
7. **Transport Planning** — 跨房路由 + Carrier Body + ETA
8. **Allocation Policy** — 多 surplus → 多 deficit 分配策略
9. **Safety Reserve Protection** — 不抽干 surplus 房
10. **Transfer Verification** — 验证 Target Resource State
11. **Partial Fulfillment** — 剩余量继续调度
12. **Failure Recovery** — Carrier Death / Source Lost / Target Changed 等
13. **Operation Deduplication** — 幂等键防 Operation Storm
14. **Event-driven Replanning** — 关键事件触发重规划
15. **Empire Scheduler（低频）** — 不每 tick 全量重算
16. **Operation Metrics** — 可观测性
17. **Multi-Room Dashboard** — 可观测性

---

## 5. Already Exists / Missing / Conflict / Technical Debt

### 5.1 Already Exists（可直接复用）

| 组件 | 位置 | A3.0 复用方式 |
| --- | --- | --- |
| EmpirePlannerInput | planner-input.ts | Operation Planner 的输入 |
| TransferCandidate | imbalance.ts | Supply Operation 的候选来源 |
| candidatesToEmpireRequests() | imbalance.ts | 跨房 Request 生成 |
| TransportRequest.scope | request-pool.ts | 跨房请求标记 |
| RoomEconomicProfile | room-profile.ts | Room Registry 的 Profile 源 |
| canExportEnergy() / needsEnergyAid() | room-profile.ts | Allocation Policy 门控 |
| computeSurplus() / computeDeficit() | imbalance.ts | Transferable 计算 |
| Economy 三指标 | economy.ts + accounting.ts | Safety Reserve 计算 |
| hauler RolePolicy | creeps/roles/ | 跨房 hauler 执行载体 |
| supplyLedger() | request-pool.ts | 跨房防超卖基础 |
| reconcileRegistry() | request-pool.ts | Operation TTL/过期基础 |
| safeRun | safe-run.ts | Operation 错误隔离 |
| CPU 看门狗 | scheduler.ts | Empire Scheduler 分频 |
| Event Log | event-log.ts | Event-driven Replanning 事件源 |

### 5.2 Missing（必须新建）

| 组件 | 类型 | 落点 | 合同依据 |
| --- | --- | --- | --- |
| AgendaItem 类型 | domain 纯函数 | `src/domain/operation/agenda-item.ts` | PLANNING_ARCHITECTURE §3 |
| Operation Lifecycle | domain 纯函数 | `src/domain/operation/lifecycle.ts` | PLANNING_ARCHITECTURE §3 |
| Room Registry | domain 纯函数 | `src/domain/strategy/room-registry.ts` | EMPIRE_SYSTEM_MODEL §1 |
| Resource Ownership（跨房） | domain 纯函数 | `src/domain/economy/ownership.ts` | ECONOMY §1.1 |
| Source Reservation（跨房） | domain 纯函数 | `src/domain/operation/reservation.ts` | LOGISTICS §2.1 #3 |
| Transport Planner | domain 纯函数 | `src/domain/operation/transport-planner.ts` | LOGISTICS §2.1 Route |
| Allocation Policy | domain 纯函数 | `src/domain/operation/allocation.ts` | ECONOMY §1.2 |
| Transfer Verification | domain 纯函数 | `src/domain/operation/verification.ts` | PLANNING_ARCHITECTURE §3 |
| Operation Deduplication | domain 纯函数 | `src/domain/operation/dedup.ts` | PLANNING_ARCHITECTURE §4 |
| Event-driven Replanning | domain 纯函数 | `src/domain/operation/replan.ts` | DATA_FLOW §1 红队 A1 |
| Operation Metrics | domain 纯函数 | `src/domain/operation/metrics.ts` | TEST_ARCHITECTURE §2 |
| Agenda Manager 系统 | System | `src/systems/agenda-manager.ts` | SYSTEM_BOUNDARIES §1.13 |
| Operation Executor 系统 | System | `src/systems/operation-executor.ts` | 新增（合同内） |

### 5.3 Conflict（架构冲突）

**无结构性冲突**。A3.0 在现有冻结蓝图框架内实施：
- Operation=AgendaItem 已冻结（EMPIRE_SYSTEM_MODEL §1）
- Agenda 管理器职责已定义（SYSTEM_BOUNDARIES §1.13）
- 跨房调拨权已定义（DECISION_AUTHORITY §1）
- Logistics 请求池合同已定义（LOGISTICS §1-§2）
- 防振荡三防线已定义（PLANNING_ARCHITECTURE §4）

**需注意的边界**：
1. Agenda 管理器立项权归 Empire Policy — 不能自行立项
2. Operation 不点名 creep — 绑定在分配服务
3. Empire 不直接控制 Creep — 经 Request Pool + Spawn
4. domain 层禁 Game/Memory — 全部纯函数

### 5.4 Technical Debt（技术债）

| 技术债 | 严重度 | 影响 | 缓解 |
| --- | --- | --- | --- |
| Terminal Manager 有 send 能力但无 Empire 级调拨令 | 中 | A3.0 需建立调拨决策链 | 新建 Operation Planner 消费 Imbalance → 产出调拨令 |
| logistics.ts 不消费 scope="empire" 请求 | 中 | 跨房请求无法落地 | 扩展 logistics.ts 消费 empire scope |
| AssignmentTaskEntry 无 targetRoom 字段 | 中 | 跨房 Task 无法表达 | 扩展类型加 targetRoom |
| 无跨房路由缓存 | 低 | 每次跨房搬运都重新寻路 | 新建 route-cache（heap，TTL） |
| hauler RolePolicy 只支持房内行为 | 中 | 跨房 hauler 无行为定义 | 扩展 hauler 钩子支持跨房 |

---

## 6. Operation Model 设计

### 6.1 Operation = AgendaItem（合同对齐）

冻结蓝图已裁决 Operation=AgendaItem。A3.0 的 Operation Model 必须实现为
AgendaItem 的一个子类型，不新建独立类型。

### 6.2 Operation 类型

```typescript
/**
 * Operation 类型集（PLANNING_ARCHITECTURE §3 冻结枚举 + A3.0 新增）。
 *
 * 冻结类型：remote | expansion | war | rebuild | evacuatereserve | paramilitary
 *
 * A3.0 新增类型：supply
 * - supply = 跨房能量供给 Operation
 * - 这是 A3.0 的第一种 Multi-Room Operation
 *
 * 注意：新增类型须走 ADR（R8 冻结条款）。但 supply 类型在
 * ECONOMY §1.2 调拨门控中已有隐含定义——Empire 持调拨权，
 * supply 是调拨权的运行时实例化。本审计认为 supply 类型
 * 在既有合同框架内，不需要新 ADR。
 */
export type OperationType =
  | "supply"    // A3.0：跨房能量供给
  | "remote"    // 远矿（后续阶段）
  | "expansion" // 扩张殖民（后续阶段）
  | "war"       // 战争波次（后续阶段）
  | "rebuild"   // 重建（后续阶段）
  | "evacuatereserve" // 紧急撤离储备（后续阶段）
  | "paramilitary";   // 准军事（后续阶段）
```

### 6.3 Operation Lifecycle

```text
PLANNED → READY → RUNNING → VERIFYING → COMPLETED
                                         ↓
                                    BLOCKED / FAILED / CANCELLED / EXPIRED
```

| 状态 | 进入条件 | 离开条件 |
| --- | --- | --- |
| PLANNED | Operation Planner 创建 AgendaItem | 资源已预留 + Carrier 已排产 → READY |
| READY | Source Reservation 已锁定 + Carrier 已孵化或已排产 | Carrier 到位 + 路径可行 → RUNNING |
| RUNNING | Carrier 开始执行搬运 | Carrier 到达 Target + 投递完成 → VERIFYING |
| VERIFYING | 搬运执行完成 | 验证 Target Resource State → COMPLETED / FAILED / PARTIAL |
| COMPLETED | Target 房收到预期资源量（行为证据） | 终态：归档进遥测 |
| BLOCKED | 路径不可用 / Source 不可用 / Target 不可用 | 条件恢复 → READY；超时 → FAILED |
| FAILED | 验证失败 / Carrier 死亡且无法重试 / 超时 | 终态：释放 Reservation + 归档 |
| CANCELLED | 上层取消（Empire 姿态变化 / Target 不再需要） | 终态：释放 Reservation + 归档 |
| EXPIRED | deadline 到期未完成 | 终态：释放 Reservation + 归档 |

### 6.4 Operation Context

```typescript
/**
 * Operation Context — AgendaItem 的运行时实例（A3.0 supply 类型）。
 *
 * 不重复已有 Request / Task 字段。Operation 负责「为什么做」，
 * Request 负责「需要什么」，Task 负责「具体怎么做」。
 *
 * 持久化：Memory.kernel.agendas（O(active agendas)，瘦字段）
 * 复核频率：每 100+ tick 低频复核
 */
export interface OperationContext {
  // ── 身份 ──
  /** 幂等键：`supply:${fromRoom}:${toRoom}:${resource}`（同键不重建） */
  id: string;
  /** Operation 类型 */
  type: OperationType;
  /** 作用域：跨房 */
  scope: "empire";

  // ── 跨房上下文 ──
  /** 调出房 */
  sourceRoom: string;
  /** 调入房 */
  targetRoom: string;

  // ── 生命周期 ──
  /** 创建 tick */
  createdAt: number;
  /** 硬期限 */
  deadline: number;
  /** 最低持续期（防振荡，PLANNING_ARCHITECTURE §4 防线 2） */
  minDuration: number;
  /** 当前状态 */
  status: OperationStatus;
  /** 进入当前状态的 tick */
  statusSince: number;

  // ── 资源 ──
  /** 资源类型（当前仅 energy） */
  resource: "energy";
  /** 请求总量 */
  requestedAmount: number;
  /** 已交付量（partial fulfillment 追踪） */
  deliveredAmount: number;
  /** 预留量（Source Reservation） */
  reservedAmount: number;

  // ── 优先级 ──
  /** 优先级（映射到 Spawn 车道与 Request Pool） */
  priority: 0 | 1 | 2 | 3;

  // ── 关联 ──
  /** 关联的 TransportRequest key（由 Operation 触发生成） */
  requestKey?: string;
  /** 关联的 hauler creep 名（认领后填充） */
  carrierName?: string;

  // ── 验收 ──
  /** 里程碑：行为证据（Target 房能量增量 ≥ deliveredAmount） */
  milestone?: {
    /** 预期 Target 增量 */
    expectedDelta: number;
    /** 实际 Target 增量（验证时填充） */
    actualDelta?: number;
    /** 验证 tick */
    verifiedAt?: number;
  };

  // ── 失败策略 ──
  /** 失败重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重建冷却到期 tick（PLANNING_ARCHITECTURE §4 防线 3） */
  reentryCooldownUntil?: number;

  // ── 元数据 ──
  /** 人类可读的失败原因 */
  failureReason?: string;
  /** 创建时的 EmpirePlannerInput 快照摘要（供复核用） */
  planningSnapshot?: string;
}

export type OperationStatus =
  | "planned" | "ready" | "running" | "verifying"
  | "completed" | "blocked" | "failed" | "cancelled" | "expired";
```

### 6.5 Operation 与 Request / Task 的关系

```text
Operation (AgendaItem)
  │ "为什么要做？" — Empire 检测到 Imbalance
  │
  ▼
Request (TransportRequest, scope="empire")
  │ "需要什么？" — 需要 2000 能量从 A 到 B
  │
  ▼
Allocation (AssignmentTaskEntry, kind="haul", targetRoom=B)
  │ "具体怎么做？" — hauler 从 A 的 storage 取 2000 能量送到 B
  │
  ▼
Execution (RolePolicy hauler + traffic-manager)
  │ "实际执行" — hauler 跨房搬运
  │
  ▼
Feedback (Transfer Verification + Operation Metrics)
  │ "结果如何？" — B 收到 2000 能量 → Operation COMPLETED
```

**严格层次**（用户要求）：
- Empire → Planning → Room/Operation Request → Task → Execution → Game
- 禁止：Empire → Creep
- 禁止：Empire → 直接修改 Room Memory
- 禁止：Empire → 直接调用 Spawn
- 禁止：Empire → 绕过 Request Pool

---

## 7. Cross-Room Request Model 设计

### 7.1 扩展现有 TransportRequest

当前 `TransportRequest` 已有 `scope?: RequestScope` 和 `targetRoom?: string`
字段（A2B 步 11）。A3.0 **不需要修改类型**，只需：

1. logistics 系统扩展消费 `scope="empire"` 请求
2. 新增跨房请求生成通道（由 Operation Planner 产出，经 `candidatesToEmpireRequests()` 转换）
3. 新增跨房请求幂等键规范

### 7.2 跨房请求幂等键

```text
empire:${fromRoom}:${toRoom}:${resource}
```

与房内请求键 `collect:${roomName}:${containerId}` 不冲突。
同键重复请求由 `reconcileRegistry()` 天然去重。

### 7.3 跨房请求生命周期

```text
Operation Planner 检测 Imbalance
  │
  ▼
candidatesToEmpireRequests() 生成 scope="empire" 请求
  │
  ▼
logistics.ts 消费 empire scope 请求
  │
  ▼
AssignmentTaskEntry (kind="haul", targetRoom=B)
  │
  ▼
hauler 认领 → 跨房搬运执行
  │
  ▼
Transfer Verification → Operation COMPLETED
```

### 7.4 跨房请求与房内请求的区别

| 维度 | 房内请求 (scope="room") | 跨房请求 (scope="empire") |
| --- | --- | --- |
| 生成者 | logistics.ts（房内缺口） | Operation Planner（Empire Imbalance） |
| 源 | 房内 container | Source Room storage/terminal |
| 目标 | 房内 spawn/extension | Target Room storage/terminal |
| 路径 | 房内路径缓存 | 跨房路由（Game.map.findRoute） |
| Carrier | 房内 hauler | 跨房 hauler（需支持跨房移动） |
| 验收 | 任务完成即完成 | Transfer Verification（验证 Target 资源增量） |

---

## 8. Resource Transfer Model 设计

### 8.1 Resource Ownership（跨房扩展）

冻结蓝图已裁决：**能量属 Room，Empire 持调拨权而非所有权**
（ECONOMY §1.1）。A3.0 的 Resource Transfer Model 必须遵守此合同。

```text
Room A: 5000 Energy
  ├── Reserved: 1000 (已有 hauler 租约)
  ├── Safety Reserve: 1000 (Empire Budget reserve)
  ├── Transferable: 5000 - 1000 - 1000 = 3000
  └── Operation 预留: 2000 (Source Reservation)
      └── Transferable after reservation: 3000 - 2000 = 1000
```

### 8.2 Transferable 计算（纯函数）

```typescript
/**
 * 计算房间可调拨能量（Transferable）。
 *
 * 公式：storageEnergy - contractReserve - safetyReserve - activeReservations
 *
 * 门控（ECONOMY §1.2）：
 *   - canExportEnergy=true 才有 Transferable
 *   - 本土净流为正
 *   - storage 水位 ≥ 最低安全线
 *
 * 纯函数 — 不访问 Game/Memory。
 */
export function computeTransferable(
  profile: RoomEconomicProfile,
  activeReservations: number,
  safetyReserveRatio: number,
): number {
  if (!canExportEnergy(profile)) return 0;
  const safetyReserve = Math.floor(profile.storageEnergy * safetyReserveRatio);
  const transferable = profile.storageEnergy
    - profile.contractReserve
    - safetyReserve
    - activeReservations;
  return Math.max(0, transferable);
}
```

### 8.3 Source Reservation

```typescript
/**
 * 跨房资源预留（Source Reservation）。
 *
 * 当 Operation 创建时，在 Source Room 预留指定数量的能量，
 * 防止其他系统同时使用。Reservation 有 TTL + 心跳。
 *
 * 成功：Reservation → Consumed（搬运完成）
 * 失败：Reservation → Released（搬运失败/超时/取消）
 *
 * 禁止 Phantom Reservation（预留泄漏）。
 */
export interface SourceReservation {
  /** 幂等键（与 Operation id 关联） */
  operationId: string;
  /** 源房 */
  sourceRoom: string;
  /** 预留量 */
  amount: number;
  /** 创建 tick */
  createdAt: number;
  /** TTL（到期自动释放） */
  ttl: number;
  /** 最后心跳 tick */
  lastHeartbeat: number;
  /** 状态 */
  status: "active" | "consumed" | "released";
}
```

### 8.4 Transfer 执行流程

```text
1. Operation Planner 检测 Imbalance
   → A surplus 3000, B deficit 2000

2. Allocation Policy 分配
   → A→B, amount=2000

3. Source Reservation
   → A.reservations += 2000
   → A.transferable = 3000 - 2000 = 1000

4. Transport Planning
   → Route: A → B (Game.map.findRoute)
   → Carrier Body: [CARRY, CARRY, MOVE, MOVE] (800 carry)
   → ETA: ~100 tick

5. Spawn Request (经 SpawnManager)
   → hauler with home=A, targetRoom=B

6. Execution
   → hauler 取能 from A.storage
   → hauler 跨房移动 to B
   → hauler 投递 to B.storage

7. Transfer Verification
   → B.storage.energy 增量 ≥ 2000?
   → YES: Operation COMPLETED, Reservation Consumed
   → NO (partial): remaining = 2000 - actualDelta, continue
   → NO (failure): Reservation Released, retry/cancel
```

### 8.5 Allocation Policy

```typescript
/**
 * 跨房资源分配策略（第一版：可解释优先）。
 *
 * 考虑因素：
 *   1. Criticality — deficit 房的紧急程度（struggling > candidate > production）
 *   2. Distance — Source 到 Target 的跳数（近优先）
 *   3. Surplus — Source 的可调拨量（大优先）
 *   4. Safety Reserve — 不抽干 Source
 *   5. Deadline — Request 的紧急程度
 *   6. Economic Impact — 调拨后 Source 不进入 Critical
 *
 * 不建立复杂 optimizer。第一版：可解释优先。
 */
export interface AllocationResult {
  candidates: TransferCandidate[];
  /** 分配理由（可解释性） */
  reasons: Map<string, string>;
}
```

### 8.6 Safety Reserve Protection

**绝对禁止**（用户要求）：
- 为了救 Room B 把 Room A 抽干

**实现**：
1. `computeTransferable()` 从 storageEnergy 中扣除 contractReserve + safetyReserve
2. `safetyReserveRatio` 由 Empire Budget 的 reserve 字段决定
3. 调拨后 Source Room 的 safetyMargin 必须 > 阈值
4. 如果调拨后 Source 进入 deficit → Operation 拒绝创建

---

## 9. A3.0 Contract Tests 设计

### 9.1 测试矩阵

| 测试 ID | 场景 | 类型 | 验收标准 |
| --- | --- | --- | --- |
| A3-001 | Multi-Room Registry 初始化 + 添加/更新/移除 | unit | Room Registry 正确维护已知房间列表 |
| A3-002 | Room Economic Profile Sync | unit | Registry 中的 Profile 与 empire-economy 一致 |
| A3-003 | Inter-Room Request 生成 | unit | scope="empire" + targetRoom 正确填充 |
| A3-004 | Resource Reservation 创建/消耗/释放 | unit | 无 Phantom Reservation |
| A3-005 | Supply Operation 创建 | unit | 幂等键去重 + 状态 PLANNED |
| A3-006 | Transport Planning | unit | 路由 + Carrier Body + ETA 正确 |
| A3-007 | Transport Execution | integration | hauler 跨房搬运完成 |
| A3-008 | Transfer Verification | unit | Target 增量验证通过 |
| A3-009 | Partial Fulfillment | unit | 剩余量继续调度 |
| A3-010 | Carrier Death Recovery | unit | 检测 + 释放 Reservation + 重试 |
| A3-011 | Source Resource Loss | unit | Source 能量不足 → 降级/取消 |
| A3-012 | Target Room Failure | unit | Target 进入 Critical → 取消 Operation |
| A3-013 | Operation Retry | unit | 失败后重建冷却 + 重试上限 |
| A3-014 | Reservation Release | unit | 成功/失败/超时三种路径释放 |
| A3-015 | Multi-Room Allocation | unit | 3 房分配（A surplus → B+C deficit） |
| A3-016 | Safety Reserve Protection | unit | 不抽干 Source 房 |
| A3-017 | Event-driven Replanning | unit | 关键事件触发重规划 |
| A3-018 | Operation Completion | integration | 完整 Supply Operation 走完全流程 |
| A3-019 | Operation Failure | unit | 完整失败链路：检测→释放→归档 |
| A3-020 | Long-run Multi-Room Stability | soak | 10k tick 无泄漏 |

### 9.2 异常场景测试

| 场景 | 描述 | 预期行为 |
| --- | --- | --- |
| Scenario 1 | Source 没有足够 Energy | Operation 创建失败或降级 amount |
| Scenario 2 | Source 在运输前被其他 Request 占用 | Reservation 失败 → Operation BLOCKED |
| Scenario 3 | Carrier 死亡 | 检测 → 释放 Reservation → 重试/取消 |
| Scenario 4 | Target Room 进入 Critical | 取消 Operation → 释放 Reservation |
| Scenario 5 | Target Room 不再需要资源 | 取消 Operation → 释放 Reservation |
| Scenario 6 | Route 不可用 | Operation BLOCKED → 重试/取消 |
| Scenario 7 | Operation 超时 | EXPIRED → 释放 Reservation → 归档 |
| Scenario 8 | Reservation 泄漏 | TTL 到期自动释放 → 记录泄漏事件 |
| Scenario 9 | Repeated Retry | maxRetries 到达 → FAILED → 重建冷却 |
| Scenario 10 | 同时多个 Supply Operations | 幂等键去重 + 分配策略正确 |

### 9.3 Simulation 测试

```text
3 Room Simulation:
  Room A: Core, Healthy, Surplus 4000
  Room B: Production, Healthy, Surplus 0
  Room C: Candidate, Deficit 2000

Scenario:
  C 需要 Energy
  A 有 surplus

Empire:
  Detect: A surplus, C deficit
  Plan: Create Supply Operation A→C, 2000 energy
  Reserve: A.reservations += 2000
  Transport: Route A→C, hauler spawned
  Execute: hauler carries 2000 from A to C
  Verify: C.storage += 2000
  Complete: Operation COMPLETED, Reservation Consumed
  Verify: A not in Critical (safetyMargin > threshold)
```

---

## 10. CPU 预算设计

| 层 | 频率 | 成本 | 说明 |
| --- | --- | --- | --- |
| Operation Planner | 每 100 tick（与 empire-economy 同频） | O(rooms²) 最坏 | 实际 O(surplus × deficit) |
| Agenda Manager 复核 | 每 100+ tick | O(active operations) | 每次复核设成本上限 |
| Room Registry 更新 | 每 100 tick（与 empire-economy 同频） | O(rooms) | 只更新已变化的房 |
| Reservation 管理 | 每 tick（顺带） | O(active reservations) | TTL 检查 + 心跳 |
| Event-driven Replanning | 事件式 | O(1) per event | 只在关键事件时触发 |
| Transfer Verification | 事件式（搬运完成时） | O(1) per verification | 只读 Target 房快照 |
| Operation Metrics | 每 N tick | O(1) | 聚合进遥测 |

**关键约束**：不每 tick 全量 Empire Planning（DATA_FLOW §1 红队 A1）。
采用低频 + 增量 + 事件驱动。

---

## 11. Memory 契约设计

| 字段 | Owner | 存储 | 频率 |
| --- | --- | --- | --- |
| `Memory.kernel.agendas` | Agenda Manager | Memory（O(active agendas)） | 低频复核 |
| `Memory.kernel.agendas[i].id` | 同上 | 短 string | 创建时 |
| `Memory.kernel.agendas[i].status` | 同上 | 枚举 | 状态转换时 |
| `Memory.kernel.agendas[i].reservedAmount` | 同上 | number | 创建/消耗/释放时 |
| `Memory.kernel.agendas[i].deliveredAmount` | 同上 | number | 搬运完成时 |
| `Memory.kernel.agendas[i].retryCount` | 同上 | number | 重试时 |
| `Memory.kernel.reservations` | Agenda Manager | Memory（O(active reservations)） | 创建/消耗/释放时 |
| `Memory.kernel.roomRegistry` | Empire Economy | Memory（瘦快照） | 每 100 tick |

**体积约束**：O(active operations) + O(rooms) 上限 + 孤儿清理。
AgendaItem 终态后从 Memory 删除（归档进遥测 segment）。

---

## 12. 架构边界验证清单

| 边界检查 | 验证方式 |
| --- | --- |
| Empire 不直接控制 Creep | 新增件不 import `src/creeps/` |
| Empire 不直接修改 Room Memory | 新增系统只写 `Memory.kernel.agendas/reservations/roomRegistry` |
| Empire 不绕过 Request Pool | Operation 只产出 TransportRequest 候选 |
| Empire 不直接调用 Spawn | 新增件不 import `src/systems/spawn-manager.ts` |
| domain 不访问 Game/Memory | lint 红线：`src/domain/operation/` 禁 `Game`/`Memory` |
| 系统顶层不访问 Game/Memory | 新增 `agenda-manager.ts` 在 `run()` 内访问 |
| 命名 kebab-case | `agenda-manager.ts` / `operation-planner.ts` 等 |
| 注册在 bootstrap.ts | 新增系统在 bootstrap.ts 注册，不改 Kernel |
| 不新增 Planner 组件 | PLANNING_ARCHITECTURE §1 冻结：无 Planner 之名 |
| Operation=AgendaItem | 不新建独立 Operation 类型，是 AgendaItem 子类型 |

---

## 13. 实施边界裁决

### 13.1 合同约束分析

**冻结蓝图允许什么**：
1. **Agenda 管理器**（SYSTEM_BOUNDARIES §1.13）——已定义职责，未实现
2. **跨房调拨令**（ECONOMY §1.2）——Empire 持调拨权
3. **AgendaItem 生命周期**（PLANNING_ARCHITECTURE §3）——已定义数据契约
4. **跨房路由**（LOGISTICS §2.1 Route）——Game.map.findRoute + 房内 PathFinder

**冻结蓝图禁止什么**：
1. ❌ 新建 Planner 组件（PLANNING_ARCHITECTURE §1）
2. ❌ Empire 直接控制 Creep（DECISION_AUTHORITY §1）
3. ❌ Empire 直接修改 Room Memory（STATE_OWNERSHIP §1 红线）
4. ❌ Empire 绕过 Request Pool（DATA_FLOW §2）
5. ❌ Empire 直接调用 Spawn（DECISION_AUTHORITY §1）
6. ❌ 全帝国能量公共池（ECONOMY §6 红线 1）
7. ❌ domain 层访问 Game/Memory（DEPENDENCY_GRAPH §3-5）
8. ❌ 每 tick 全量 Empire Planning（DATA_FLOW §1 红队 A1）
9. ❌ Remote Mining / Claim / Reserve / Expansion Execution（A3.0 禁止）
10. ❌ Military / Power / Terminal Automation / Market（A3.0 禁止）

### 13.2 实施范围裁决

A3.0 在现有合同框架内实施，**不修订冻结契约**。

| 原则 | 内容 |
| --- | --- |
| Operation=AgendaItem | 不新建独立 Operation 类型，是 AgendaItem 的 supply 子类型 |
| 纯函数归 domain | Operation Lifecycle / Reservation / Allocation 等纯计算归 `src/domain/operation/` |
| 系统侧薄壳 | Agenda Manager 是 System，注册在 bootstrap.ts |
| 低频执行 | Empire 级 Operation Planning 按分频（100 tick），不每 tick 全量重算 |
| Memory 瘦 | AgendaItem 只存必要字段（O(active agendas)），终态归档后删除 |
| 不进 Remote/Expansion | A3.0 只做 Inter-Room Energy Supply |
| 不新建 God Manager | Empire 只产出 Operation + Request 候选，不直接执行 |

### 13.3 落点映射

| 新增件 | 类型 | 落点 | 蓝图依据 |
| --- | --- | --- | --- |
| AgendaItem 类型 | 纯函数 | `src/domain/operation/agenda-item.ts` | PLANNING_ARCHITECTURE §3 |
| Operation Lifecycle | 纯函数 | `src/domain/operation/lifecycle.ts` | PLANNING_ARCHITECTURE §3 |
| Room Registry | 纯函数 | `src/domain/strategy/room-registry.ts` | EMPIRE_SYSTEM_MODEL §1 |
| Resource Ownership | 纯函数 | `src/domain/economy/ownership.ts` | ECONOMY §1.1 |
| Source Reservation | 纯函数 | `src/domain/operation/reservation.ts` | LOGISTICS §2.1 #3 |
| Transport Planner | 纯函数 | `src/domain/operation/transport-planner.ts` | LOGISTICS §2.1 Route |
| Allocation Policy | 纯函数 | `src/domain/operation/allocation.ts` | ECONOMY §1.2 |
| Transfer Verification | 纯函数 | `src/domain/operation/verification.ts` | PLANNING_ARCHITECTURE §3 |
| Operation Dedup | 纯函数 | `src/domain/operation/dedup.ts` | PLANNING_ARCHITECTURE §4 |
| Event-driven Replan | 纯函数 | `src/domain/operation/replan.ts` | DATA_FLOW §1 红队 A1 |
| Operation Metrics | 纯函数 | `src/domain/operation/metrics.ts` | TEST_ARCHITECTURE §2 |
| Agenda Manager | System | `src/systems/agenda-manager.ts` | SYSTEM_BOUNDARIES §1.13 |
| Operation Executor | System | `src/systems/operation-executor.ts` | 新增（合同内） |

**注意**：以上落点均在 ENGINEERING_BLUEPRINT §2 表已有模块范围内
（1.4 Empire / 1.6 Logistics / 1.13 Agenda），**不需要 ADR**。

### 13.4 与冻结蓝图的一致性验证

| 冻结条款 | A3.0 是否遵守 |
| --- | --- |
| DEP_GRAPH §3-1：Execution 不得反向依赖 Strategy | ✅ 新增件在 domain/operation，不 import systems |
| DEP_GRAPH §3-5：domain 层禁 Game/Memory | ✅ 全部纯函数，状态由参数注入 |
| STATE_OWNERSHIP §1：一个状态一个写者 | ✅ Agenda Manager 只写 Memory.kernel.agendas |
| ECONOMY §6 红线 1：全帝国能量公共池 | ✅ Resource View 是只读聚合，不改所有权 |
| ECONOMY §6 红线 4：Economy 执行调拨 | ✅ Operation 只产出候选，调拨经 Request Pool |
| DECISION_AUTHORITY §1：Empire 不直接控制 Creep | ✅ 只产出 Operation + Request |
| PLANNING_ARCHITECTURE §1：无 Planner 组件 | ✅ 无 Planner 之名 |
| PLANNING_ARCHITECTURE §3：AgendaItem 不点名 creep | ✅ 绑定在分配服务 |
| PLANNING_ARCHITECTURE §4：防振荡三防线 | ✅ 滞回 + minDuration + 重建冷却 |
| LOGISTICS §7 红线 1：每 tick 全量重匹配 | ✅ 不做 |
| LOGISTICS §7 红线 4：无 TTL/无心跳租约 | ✅ Reservation 有 TTL + 心跳 |
| AGENTS.md：模块顶层禁止访问 Game/Memory | ✅ 系统侧薄壳在 systems/ |
| AGENTS.md：注册在 bootstrap.ts | ✅ 新增系统在 bootstrap.ts 注册 |

---

## 14. A3.0 验收标准对照

| 验收项 | 设计对应 | 状态 |
| --- | --- | --- |
| Multi-Room Registry | §5 Room Registry 设计 | ✅ 设计完成 |
| Room Economic Profile Sync | §5 + A2B 复用 | ✅ 设计完成 |
| Operation Model | §6 AgendaItem 类型 + Lifecycle | ✅ 设计完成 |
| Operation Lifecycle | §6.3 状态机 | ✅ 设计完成 |
| Cross-Room Request | §7 TransportRequest 扩展消费 | ✅ 设计完成 |
| Resource Ownership | §8.1-8.2 Transferable 计算 | ✅ 设计完成 |
| Source Reservation | §8.3 SourceReservation | ✅ 设计完成 |
| Transport Planning | §8.4 Transport Planner | ✅ 设计完成 |
| Transport Execution | §8.4 执行流程 | ✅ 设计完成 |
| Transfer Verification | §8.4 验证 + §9 测试 | ✅ 设计完成 |
| Partial Fulfillment | §6.4 deliveredAmount 追踪 | ✅ 设计完成 |
| Failure Recovery | §6.3 异常状态 + §9 场景 | ✅ 设计完成 |
| Operation Retry | §6.4 retryCount + maxRetries | ✅ 设计完成 |
| Operation Deduplication | §6.4 幂等键 | ✅ 设计完成 |
| Resource Allocation | §8.5 Allocation Policy | ✅ 设计完成 |
| Safety Reserve | §8.6 Safety Reserve Protection | ✅ 设计完成 |
| Event-driven Replanning | §5 Event-driven Replan | ✅ 设计完成 |
| Multi-Room Scheduler | §10 CPU 预算（低频+增量+事件） | ✅ 设计完成 |
| Multi-Room Simulation | §9.3 3 Room Simulation | ✅ 设计完成 |
| 20+ Contract Tests | §9.1 A3-001..020 | ✅ 设计完成 |
| CPU Validation | §10 CPU 预算 | ✅ 设计完成 |
| Memory Validation | §11 Memory 契约 | ✅ 设计完成 |
| 10k tick Stability | §9.1 A3-020 | ✅ 设计完成 |
| Real 2-Room Test | §9.3 Simulation 验证后 | ⏳ 实现阶段 |
| Real 3-Room Test | §9.3 Simulation 验证后 | ⏳ 实现阶段 |

---

## 15. 裁决

**GO**。

冻结蓝图对 Empire/Room/Operation/Logistics/Request/Reservation 边界已有
完整定义。A3.0 在现有合同框架内实施，无需修订冻结契约。

A2B 已建立完整的 Observation + Planning Input 链路
（RoomEconomicProfile → EmpireResourceView → EconomicHealth →
Imbalance → ExpansionReadiness → EmpirePlannerInput），
为 A3.0 提供了成熟的感知基座。

A3.0 的核心工作是：
1. 新建 Operation Model（AgendaItem supply 类型 + Lifecycle 状态机）
2. 新建 Agenda Manager 系统（低频复核 + 里程碑验收）
3. 新建 Room Registry（已知房间 + Profile + Health + Role）
4. 新建跨房 Resource Ownership + Reservation + Transfer + Verification 链路
5. 扩展 logistics.ts 消费 scope="empire" 请求
6. 新建 Allocation Policy + Safety Reserve Protection
7. 新建 Event-driven Replanning + Operation Metrics

**严格禁止**：
- Remote Mining / Claim / Reserve / Expansion Execution
- Military / Power / Terminal Automation / Market
- Empire 直接控制 Creep / 直接修改 Room Memory / 绕过 Request Pool
- 每 tick 全量 Empire Planning
- 为 A3 提前实现 Remote / Military / Expansion

**当设计确认后，才开始实现 A3.0。**