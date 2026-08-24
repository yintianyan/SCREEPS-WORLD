# A3.3 Architecture Audit — Expansion Execution

> 日期：2026-08-24。阶段：A3.3 — Expansion Execution。
> 基线：A3.2 Expansion Intelligence 已完成（49 测试全绿），A3.1 Empire Resource Network 已完成，A3.0 Multi-Room Execution 已完成。

---

## 0. 审计方法论

本审计**逐文件追踪真实调用链**，不依赖文件名猜测。每个「已有能力」结论均标注
源码路径与关键函数；每个「缺失」结论均说明验证过哪些文件。

---

## 1. A3.2 输出链追踪：ExpansionPlan → WAITING_EXECUTION

### 1.1 数据流

```
expansion-planner.ts (System, interval=100)
  ↓ queryEmpirePlannerInput()
  ↓ evaluateExpansionPressure()       → pressure.ts
  ↓ discoverCandidates()              → discovery.ts
  ↓ scoreCandidates()                 → scoring.ts
  ↓ rankCandidates()                  → ranking.ts
  ↓ estimateExpansionCost()           → cost-model.ts
  ↓ evaluatePayback()                 → payback.ts
  ↓ evaluateRisk()                    → risk.ts
  ↓ computeTieredBudget()             → budget.ts
  ↓ createPlan()                      → plan.ts         → status="EVALUATED"
  ↓ deduplicatePlans()                → plan-lifecycle.ts
  ↓ prunePlans()                      → plan-lifecycle.ts
  ↓ Memory.kernel.expansionPlans      → serializePlan() → ExpansionPlanMemory[]
```

### 1.2 Plan 状态流转

```
DISCOVERED → EVALUATED → READY → APPROVED → WAITING_EXECUTION → (A3.3 接管)
                                                           ↘ CANCELLED / BLACKLISTED
```

**关键发现**：`expansion-planner.ts` 当前创建 Plan 时状态直接设为 `"EVALUATED"`，
但**未实现 READY → APPROVED → WAITING_EXECUTION 的状态推进**。
`applyHysteresis()` 和 `needsReevaluation()` 函数已实现，但 `expansion-planner.ts`
的 `run()` 中未调用它们——Plan 不会自动从 `EVALUATED` 推进到 `WAITING_EXECUTION`。

**判定**：A3.3 必须先修复 A3.2 的 Plan 生命周期推进，确保 `WAITING_EXECUTION`
状态的 Plan 真实存在于 `Memory.kernel.expansionPlans` 中，A3.3 才能消费。

### 1.3 Memory 持久化结构

```typescript
// global.d.ts — ExpansionPlanMemory (16 字段瘦结构)
interface ExpansionPlanMemory {
  pid: string;   // planId
  rn: string;    // roomName
  sr: string;    // sponsorRoom
  rs: string;    // reason
  pr: string;    // priority
  sc: number;    // candidateScore
  tc: number;    // totalCost
  pb: number;    // paybackTicks
  roi: number;   // ROI
  rk: number;    // riskScore
  rl: string;    // riskLevel
  st: string;    // status
  ca: number;    // createdAt
  ua: number;    // updatedAt
  aa?: number;   // approvedAt
  cr?: string;   // cancelReason
  ex: string;    // explanation
}
```

---

## 2. 现有 Expansion Execution 链追踪

### 2.1 expansion-manager.ts（存量执行系统）

**已存在的完整 Claim → Pioneer → Bootstrap 链**：

```
expansion-manager.ts (System, P3, interval=CONFIG.expansion.interval)
  │
  ├── runBootstrapLane()           — owned 无 spawn 房的跨房重建
  │   ├── decideBootstrapRooms()   → bootstrap.ts（纯函数）
  │   ├── submitRequest()           → spawn/queue.ts
  │   └── BOOTSTRAP_WORKER_BODY / BOOTSTRAP_DEFENDER_BODY
  │
  ├── tryStartExpansion()          — idle → claiming
  │   ├── selectExpansionTarget()  → evaluator.ts（旧版 V1 候选评选）
  │   ├── submitClaimer()          → spawn/queue.ts
  │   └── Memory.kernel.expansion = { state: "claiming", target, sponsor, startedAt }
  │
  ├── advanceClaiming()            — claiming → pioneering
  │   ├── 验证 controller.my
  │   ├── seedLayoutAnchor()       → layout/anchor-selection + compact-core-v2
  │   ├── submitPioneers()         → spawn/queue.ts (worker + builder)
  │   ├── 超时/被抢占 → blacklist + reclaimExpeditionCreeps()
  │   └── claimer 阵亡重派
  │
  └── advancePioneering()          — pioneering → idle (完成)
      ├── 验证 spawn 建成
      ├── 威胁止损
      ├── 超时止损
      └── reclaimExpeditionCreeps() — 失败回收
```

**状态机**：
```
idle → claiming → pioneering → idle
         ↓           ↓
         失败/超时    失败/超时
         ↓           ↓
         idle + blacklist
```

### 2.2 关键发现：双轨并行问题

| 维度 | A3.2 Intelligence (expansion-planner.ts) | 存量 Execution (expansion-manager.ts) |
|------|------------------------------------------|---------------------------------------|
| 候选评估 | V2 候选模型 (14+ 字段, 七因子评分) | V1 候选模型 (4 字段, sources×1000+freshness) |
| 决策来源 | Pressure → Readiness → Plan | 直接 selectExpansionTarget() |
| 状态存储 | Memory.kernel.expansionPlans[] | Memory.kernel.expansion (单条) |
| 触发条件 | expansionAllowed + Pressure + Readiness | expansionAllowed + CPU tier + rhythm |
| Claim 执行 | ❌ 不执行 | ✅ 直接执行 |
| Pioneer 派遣 | ❌ 不派遣 | ✅ 直接派遣 |
| Bootstrap | ❌ 不执行 | ✅ runBootstrapLane() |

**冲突判定**：两个系统都在 P3 优先级运行，都读 `expansionAllowed`。
如果 A3.3 不统一这条链，会出现：
1. expansion-planner 产出 WAITING_EXECUTION Plan，但无人消费
2. expansion-manager 继续用 V1 evaluator 直接 claim，绕过 Plan
3. 两个系统可能同时尝试 claim 不同目标

**裁决**：A3.3 必须将 expansion-manager 的 `tryStartExpansion()` 改造为
**消费 WAITING_EXECUTION Plan**，而不是自行评选目标。V1 evaluator 退役。

---

## 3. 分类矩阵

### 3.1 Already Exists（可复用）

| 能力 | 源码位置 | 状态 | 复用方式 |
|------|----------|------|----------|
| **Claim 角色与行为** | `src/creeps/roles/claimer.ts` | ✅ 完整 | 直接复用，claimer 走到 controller 旁执行 claimController |
| **Pioneer Worker 角色** | `src/creeps/roles/worker.ts` | ✅ 完整 | 直接复用，已有 acquire(work) + work(build/repair/fill/upgrade) 全链 |
| **Pioneer Builder 角色** | `src/creeps/roles/builder.ts` | ✅ 完整 | 直接复用，已有 build + repair + fill 全链 |
| **Spawn 请求提交** | `src/domain/spawn/queue.ts` submitRequest() | ✅ 完整 | 直接复用，幂等 key + body + memory |
| **Spawn 管理器** | `src/systems/spawn-manager.ts` | ✅ 完整 | 唯一 spawnCreep 调用者，不需修改 |
| **Layout 锚点选择** | `src/domain/layout/anchor-selection.ts` selectAnchors() | ✅ 完整 | 直接复用 |
| **Layout 规划** | `src/systems/layout-planner.ts` | ✅ 完整 | 直接复用，4-stage 规划分片 + gap-force |
| **Construction 管理** | `src/systems/construction-manager.ts` | ✅ 完整 | 直接复用，emergency 重建路径已实现 |
| **Blueprint 模板** | `src/domain/layout/templates/compact-core-v2.ts` | ✅ 完整 | 直接复用 |
| **Bootstrap 决策** | `src/domain/expansion/bootstrap.ts` decideBootstrapRooms() | ✅ 完整 | 可复用，已有冷却/弃房/波次逻辑 |
| **Reserver 角色** | `src/creeps/roles/reserver.ts` | ✅ 完整 | 直接复用（远矿 controller 续期） |
| **Defender 角色** | `src/creeps/roles/defender.ts` | ✅ 完整 | 直接复用（威胁响应） |
| **Scout 角色** | `src/creeps/roles/scout.ts` | ✅ 完整 | 直接复用（情报侦察） |
| **Creep 回收** | expansion-manager.ts reclaimExpeditionCreeps() | ✅ 完整 | 可复用，已有 home 改回 sponsor + recycle 标记 |
| **节奏学习** | `src/domain/expansion/rhythm.ts` | ✅ 完整 | 可复用，失败 ring + 自适应黑名单缩放 |
| **Room Registry** | `src/domain/strategy/room-registry.ts` | ✅ 完整 | 可复用，新房 claim 后自动加入 registry |
| **Room Economic Profile** | `src/domain/economy/room-profile.ts` | ✅ 完整 | 可复用，新房经济激活后自动进入 Empire Resource View |
| **Empire Resource Network** | `src/systems/agenda-manager.ts` + operation/* | ✅ 完整 | 可复用，新房作为 Demand Node 自动进入网络 |
| **Tiered Budget** | `src/domain/expansion/budget.ts` | ✅ 完整 | 可复用，Core Protection 约束已实现 |
| **Squad Index** | `src/kernel/global-cache.ts` querySquad() | ✅ 完整 | 可复用，编队查询已实现 |
| **Traffic Manager** | `src/systems/traffic-manager.ts` | ✅ 完整 | 直接复用，移动意图仲裁 |
| **safeRun** | `src/kernel/safe-run.ts` | ✅ 完整 | 直接复用，错误隔离 |
| **Event Log** | `src/kernel/event-log.ts` recordEvent() | ✅ 完整 | 直接复用，ExpansionOutcome 事件 |

### 3.2 Missing（需新建）

| 能力 | 说明 | 建议实现位置 |
|------|------|-------------|
| **OperationType 扩展** | 当前只有 `"supply"`，需扩展 `"claim"` 和 `"colonize"` | `src/domain/operation/agenda-item.ts` |
| **Expansion Execution Gate** | WAITING_EXECUTION → 执行前 11 项验证 | `src/domain/expansion/execution-gate.ts` (新) |
| **Execution State Machine** | VALIDATING → PREPARING → CLAIMING → CLAIMED → BOOTSTRAPPING → ... | `src/domain/expansion/execution-state.ts` (新) |
| **Plan → Operation 映射** | planId 关联到 Operation，追踪来源 | 扩展 OperationContext |
| **Checkpoint 机制** | 阶段性完成标记 + 从 checkpoint 恢复 | `src/domain/expansion/checkpoint.ts` (新) |
| **Expansion Reservation** | 扩张预算预留（区分 supply reservation） | 扩展 reservation.ts 或新建 |
| **Threat Escalation** | Bootstrap 过程中威胁升级响应 | `src/domain/expansion/threat-escalation.ts` (新) |
| **Military Escort 依赖** | 条件性请求 military 护航 | 扩展 expansion-manager |
| **Economic Activation 判据** | 不以 spawn 建成为完成，而以经济指标为判据 | `src/domain/expansion/activation.ts` (新) |
| **Expansion Execution Dashboard** | 可观测性：Plan/Operation/Phase/Pioneer/Claim/Bootstrap/Energy/Threat/Reservation/Failures/Retries/ETA/Checkpoint | `src/domain/expansion/execution-dashboard.ts` (新) |

### 3.3 Reusable（需适配但无需重写）

| 能力 | 当前状态 | A3.3 适配 |
|------|----------|-----------|
| `expansion-manager.ts` | 直接 selectExpansionTarget → claim | 改为消费 WAITING_EXECUTION Plan → claim |
| `evaluator.ts` (V1) | 4 字段候选模型 | 退役，由 A3.2 V2 候选替代 |
| `seedLayoutAnchor()` | expansion-manager 内部函数 | 提取为可复用函数 |
| `submitPioneers()` | expansion-manager 内部函数 | 提取为可复用函数，动态 body |
| `submitClaimer()` | expansion-manager 内部函数 | 提取为可复用函数 |
| `advanceClaiming()` | expansion-manager 内部函数 | 改造为 Execution State Machine 的 CLAIMING 相位 |
| `advancePioneering()` | expansion-manager 内部函数 | 改造为 Execution State Machine 的 BOOTSTRAPPING 相位 |
| `runBootstrapLane()` | 独立于 expansion 状态机 | 保留（灾后重建与殖民是同一台机器） |

### 3.4 Conflict（架构冲突）

| 冲突 | 严重度 | 解决方案 |
|------|--------|----------|
| **双轨并行**：expansion-planner 产出 Plan 但无人消费；expansion-manager 自行评选目标 | 🔴 高 | A3.3 统一为：expansion-planner 产出 Plan → expansion-manager 消费 Plan 执行 |
| **V1 vs V2 候选模型**：evaluator.ts (V1) 与 candidate.ts (V2) 并存 | 🟡 中 | V1 退役，expansion-manager 改为从 Memory.kernel.expansionPlans 读取 Plan |
| **Memory 双写**：expansion-planner 写 expansionPlans[]，expansion-manager 写 expansion{} | 🔴 高 | 统一为 expansionPlans[] 为唯一真相源；expansion{} 退役或改为 Plan 执行状态镜像 |
| **Plan 生命周期未推进**：expansion-planner 创建 EVALUATED 状态 Plan 但不推进到 WAITING_EXECUTION | 🔴 高 | A3.3 修复：expansion-planner 中调用 applyHysteresis + readiness 判断推进到 WAITING_EXECUTION |

### 3.5 Technical Debt

| 债务 | 来源 | 影响 |
|------|------|------|
| expansion-planner.ts 中 `existingPlans: ExpansionPlan[] = []` | 简化实现 | Plan 不从 Memory 反序列化，每次都是空列表 → 去重失效 |
| expansion-planner.ts 中 `reason: "resource"` 硬编码 | 简化实现 | 未从 Pressure 的 7 维评估推导真实动机 |
| expansion-planner.ts 中 `hasAdversaryPressure: false` 硬编码 | 简化实现 | 未从 situation 派生真实威胁 |
| Bootstrap body 固定 BOOTSTRAP_WORKER_BODY | 硬编码 | 未根据距离/能量/阶段动态选择 body |
| Pioneer 完成判据 = spawn 建成 | 过简化 | 未验证 Energy Loop / Economic Activation |

### 3.6 Required Changes

| 变更 | 位置 | 说明 |
|------|------|------|
| 1. 修复 Plan 生命周期推进 | `expansion-planner.ts` | 调用 applyHysteresis + readiness → 推进到 WAITING_EXECUTION |
| 2. 从 Memory 反序列化 Plan | `expansion-planner.ts` | 读取 Memory.kernel.expansionPlans 恢复 Plan 列表 |
| 3. OperationType 扩展 | `agenda-item.ts` | 增加 `"claim"` 和 `"colonize"` 类型 |
| 4. expansion-manager 改造 | `expansion-manager.ts` | tryStartExpansion → consumePlan (从 Plan 读取目标而非自行评选) |
| 5. Execution State Machine | 新建 | 替换当前 claiming/pioneering 二态为完整状态链 |
| 6. Execution Gate | 新建 | 11 项 TOCTOU 验证 |
| 7. Checkpoint 机制 | 新建 | Claimed / Spawn Active / Energy Loop / Basic Infra / Economic Activation |
| 8. Economic Activation 判据 | 新建 | 替换 "spawn 建成 = 完成" 为经济指标判据 |
| 9. Expansion Reservation | 扩展 | 真正的预算预留（当前只有 supply reservation） |
| 10. Execution Dashboard | 新建 | 全链路可观测性 |
| 11. Threat Escalation | 新建 | Bootstrap 过程中威胁升级响应 |

### 3.7 Deferred

| 延迟项 | 原因 |
|--------|------|
| Real Screeps Validation | Simulation 全部通过后才允许 |
| 1k/5k/10k Tick Stability | 需要真实环境 |
| Multi-target Expansion | 当前至多一个活跃扩张行动（蓝图 §1.2 并发条款） |

---

## 4. 现有调用链：expansion-manager.ts 完整追踪

### 4.1 Claim 执行真实调用链

```
expansion-manager.run(ctx)
  ↓
tryStartExpansion(ctx)
  ├── selectExpansionTarget({ ownedRoomNames, gclLevel, intelBySponsor, ... })
  │   └── 遍历 sponsor 的邻居 intel，评选最优候选
  ├── Memory.kernel.expansion = { state: "claiming", target, sponsor, startedAt }
  └── submitClaimer(sponsor, target, tick)
      ├── Memory.rooms[sponsor].spawnQueue
      ├── hasRequest(queue, key) — 幂等检查
      └── submitRequest(queue, {
              key: `claimer:${sponsor}:${target}`,
              role: "claimer",
              home: sponsor,
              priority: 2,
              body: selectBody("claimer", capacity),
              memory: { role: "claimer", home: sponsor, mode: "acquire", remoteTarget: target }
          })
```

### 4.2 Claim 验证链

```
advanceClaiming(ctx, expansion, spawningAllowed)
  ├── Game.rooms[target]?.controller?.my → claim 成功
  │   ├── seedLayoutAnchor(room)
  │   │   ├── computeDistanceField(getTerrain)
  │   │   ├── selectAnchors({ field, sources, controller, exits, mineral })
  │   │   └── Memory.rooms[room.name].layout = { version: 2, templateId, anchor, ... }
  │   ├── recordExpansionOutcome(expansion, tick, PHASE_CLAIM, OUTCOME_SUCCESS)
  │   ├── expansion.state = "pioneering"
  │   └── submitPioneers(ctx, expansion)
  │
  ├── controller.owner && !controller.my → 被抢占
  │   └── blacklistTarget + reclaimExpeditionCreeps + 清除 expansion
  │
  ├── tick - startedAt > claimTimeout → 超时
  │   └── blacklistTarget + reclaimExpeditionCreeps + 清除 expansion
  │
  └── claimer 阵亡且无 pending → 重派（或止损）
      ├── querySquad({ role: "claimer", remoteTarget: target }).length === 0
      ├── dangerUntil 检查 → 止损
      └── submitClaimer() — 重派
```

### 4.3 Pioneer/Bootstrap 执行链

```
advancePioneering(ctx, expansion, spawningAllowed)
  ├── !controller.my → 失守/失明
  │   └── blacklistTarget + reclaimExpeditionCreeps + 清除 expansion
  │
  ├── FIND_MY_SPAWNS.length > 0 → 完成！
  │   ├── recordExpansionOutcome(expansion, tick, PHASE_PIONEER, OUTCOME_SUCCESS)
  │   └── Memory.kernel.expansion = undefined
  │
  ├── 威胁止损 → hostiles.length > 0 && squadAlive === 0
  │   └── blacklistTarget + reclaimExpeditionCreeps + 清除 expansion
  │
  ├── 超时 → tick - startedAt > pioneerTimeout
  │   └── 停止编队补充（残余拓荒者继续干活至寿终）
  │
  └── 补充编队 → submitPioneers(ctx, expansion)
      ├── 统计存活: living[role] = count by home === target
      ├── squad = [{ role: "worker", count: CONFIG.expansion.pioneerWorkers },
      │             { role: "builder", count: CONFIG.expansion.pioneerBuilders }]
      └── for each role: submitRequest(queue, {
              key: `expansion:${role}:${target}:${i}`,
              role, home: target,
              priority: 2,
              body: selectBody(role, capacity, { rcl: sponsorRcl }),
              memory: { role, home: target, mode: "acquire", spawnIndex: i }
          })
```

### 4.4 Bootstrap Lane（灾后重建与殖民共用）

```
runBootstrapLane(ctx)
  ├── 遍历 ctx.snapshots()
  │   ├── 有 spawn → 清除 bootstrap 台账；可能加入 sponsorPool
  │   └── 无 spawn + controller.my → 加入 rooms[]
  ├── 最近 sponsor 匹配（roomLinearDistance）
  ├── decideBootstrapRooms({ tick, rooms, ledger }) → decisions
  └── for each decision:
      ├── "abandon" → 清空 spawnQueue + 记录事件
      ├── "dispatch" → submitRequest(worker) + submitRequest(defender if hostile)
      └── "none" → skip
```

---

## 5. Operation / Request / Spawn / Task / Execution 真实调用链

### 5.1 Operation Lifecycle (A3.0/A3.1)

```
agenda-manager.ts (System, P1, interval=100)
  ├── loadOperations()                    → Memory.kernel.agendas
  ├── loadReservations()                  → Memory.kernel.reservations
  ├── processReplanEvent()                → replan.ts
  ├── checkExpiry()                        → lifecycle.ts
  ├── sweepExpired(reservations)           → reservation.ts
  ├── retryFromBlocked() / markFailed()    → lifecycle.ts
  ├── buildRoomEconomicProfile()           → room-profile.ts
  ├── computeTransferableBulk()            → ownership.ts
  ├── buildSupplyNodes() / buildDemandNodes() → supply-node.ts / demand-node.ts
  ├── buildNetworkSnapshot()               → network-snapshot.ts
  ├── decideRebalance()                    → rebalance.ts
  ├── allocateNetwork()                    → allocation-policy.ts
  │   └── 输出 AllocationPlan[]
  ├── createOperation() + markReady()      → agenda-item.ts + lifecycle.ts
  ├── createReservation()                  → reservation.ts
  ├── submitCarrierSpawn()                 → spawn/queue.ts
  ├── markRunning()                        → lifecycle.ts
  ├── 验证 carrier 到达 + 空载 → markCompleted / markVerifying
  ├── pruneTerminal()                      → dedup.ts
  └── saveOperations() / saveReservations()
```

**OperationContext 结构**（当前）:
```typescript
interface OperationContext {
  id: string;              // "supply:${from}:${to}:${resource}"
  type: "supply";          // ← 需扩展为 "supply" | "claim" | "colonize"
  status: OperationStatus; // planned→ready→running→verifying→completed
  sourceRoom: string;
  targetRoom: string;
  requestedAmount: number;
  deliveredAmount: number;
  reservedAmount: number;
  priority: OperationPriority;
  resource: "energy";
  deadline: number;
  createdAt: number;
  updatedAt: number;
  retries: number;
  maxRetries: number;
  cooldownUntil?: number;
  lastError?: string;
  baselineEnergy?: number;
  carrierName?: string;    // ← claim/colonize 不需要 carrier
}
```

### 5.2 Spawn 请求链

```
需求方（expansion-manager / agenda-manager / demand.ts / ...）
  ↓ submitRequest(queue, request)
  ↓ Memory.rooms[sponsor].spawnQueue  ← 唯一真相源
  ↓
spawn-manager.ts (System, P0)
  ├── cleanQueue()                        → queue.ts (TTL + retries 清理)
  ├── 按优先级排序 queue
  ├── 孵化可行性检查（energyAvailable >= bodyCost）
  ├── spawnCreep()                        ← 唯一 spawnCreep 调用点
  └── 清除已孵化请求
```

### 5.3 Task / Assignment 链

```
logistics.ts (System, P1)
  ├── 采集 TransportRequest 候选（各房 demand）
  └── globalCache().transportPool = { tick, rooms }

assignment-service.ts (System, P1)
  ├── 合并 transportPool + buildQueue assignments
  ├── TaskPool 分配
  └── globalCache().assignment = { tick, pool }

role-runner.ts (Creep 执行引擎)
  ├── getSnapshot(creep)
  ├── recycle 检查
  ├── 威胁检测 / flee
  ├── ensureHome（跨房导航）
  ├── updateMode（acquire ↔ work）
  ├── getAssignment
  ├── gate 检查
  ├── 评估 ActionCandidate 链
  └── 无匹配 → idle (park)
```

---

## 6. Expansion Execution State Machine（A3.3 设计）

### 6.1 完整状态链

```
WAITING_EXECUTION
    ↓ (Execution Gate: 11 项 TOCTOU 验证)
    ↓
VALIDATING
    ↓ (验证 Plan/Candidate/Target/Empire/Budget/Core/Ownership/Operation/Intel/Threat)
    ↓ Gate Failure → BLOCKED / CANCELLED / REPLAN
    ↓
PREPARING
    ↓ (提交 claimer spawn 请求 + 路由验证)
    ↓
CLAIMING
    ↓ (claimer 到达 + claimController 执行)
    ↓ Claim Failure → FAILED (blacklist + reclaim)
    ↓
CLAIMED
    ↓ (验证 controller.my === true + 选锚点 + 写 layout)
    ↓ Checkpoint 1: Claimed
    ↓
BOOTSTRAPPING
    ├── 提交 pioneer spawn 请求 (worker + builder)
    ├── pioneer 到达 → 开始建造
    ├── 威胁检查 → Threat Escalation
    ↓
    ↓ Checkpoint 2: Spawn Active (spawn 建成)
    ↓
ECONOMIC_STARTUP
    ├── harvest → transport → build/upgrade → 继续采
    ├── 形成最小 Energy Loop
    ↓ Checkpoint 3: Energy Loop
    ↓
    ↓ Checkpoint 4: Basic Infrastructure
    ↓
INTEGRATING
    ├── 加入 Room Registry
    ├── 进入 Empire Resource View
    ├── Resource Network 开始考虑新 Room 的 Supply/Demand
    ↓ Checkpoint 5: Economic Activation
    ↓
COMPLETED
```

### 6.2 异常状态

```
BLOCKED     → 条件变化暂时阻塞，等待条件恢复后重试
FAILED      → 不可恢复失败（黑名单 + 回收 + 释放预留）
CANCELLED   → 外部取消（条件不再满足）
RECOVERY    → 从最近 Checkpoint 恢复
```

### 6.3 Checkpoint 定义

| Checkpoint | 判据 | 失败恢复 |
|-----------|------|----------|
| CP1: Claimed | `controller.my === true` | 从 CLAIMING 重试（重派 claimer） |
| CP2: Spawn Active | `FIND_MY_SPAWNS.length > 0` | 从 BOOTSTRAPPING 重试（重派 pioneer） |
| CP3: Energy Loop | harvester 存活 + hauler/transport 有效 + energy 净流 ≥ 0 | 从 ECONOMIC_STARTUP 重试 |
| CP4: Basic Infra | extensions + container + road 基础建成 | 从 ECONOMIC_STARTUP 继续 |
| CP5: Economic Activation | RoomEconomicProfile = ACTIVE/AUTONOMOUS + energy production > consumption | 从 INTEGRATING 重试 |

---

## 7. Plan → Operation → Request → Task → Execution 调用链（A3.3 设计）

```
A3.2 Intelligence                          A3.3 Execution
┌────────────────┐                        ┌─────────────────────────────┐
│ expansion-     │                        │ expansion-manager            │
│ planner.ts     │                        │  (改造为消费 Plan)            │
│                │                        │                             │
│  Pressure      │                        │  consumePlan()              │
│  Discovery     │                        │    ↓                        │
│  Scoring       │                        │  Execution Gate (11 项)     │
│  Cost/Risk     │                        │    ↓                        │
│  Budget        │                        │  createClaimOperation()     │
│  Plan          │                        │    ↓                        │
│  Lifecycle     │                        │  submitClaimer()            │──→ spawn/queue.ts
│                │                        │    ↓                        │
│  WAITING_      │─── Memory.kernel. ──→ │  advanceClaiming()          │
│  EXECUTION     │    expansionPlans[]   │    ↓                        │
└────────────────┘                        │  CLAIMED → seedLayout()     │
                                          │    ↓                        │
                                          │  createColonizeOperation()  │
                                          │    ↓                        │
                                          │  submitPioneers()           │──→ spawn/queue.ts
                                          │    ↓                        │
                                          │  advanceBootstrap()         │
                                          │    ├── layout-planner       │
                                          │    ├── construction-manager │
                                          │    ├── role-runner (worker/builder/harvester)
                                          │    ↓                        │
                                          │  verifyEconomicActivation() │
                                          │    ↓                        │
                                          │  integrateToEmpire()        │
                                          │    ├── Room Registry        │
                                          │    ├── Empire Resource View │
                                          │    └── Resource Network     │
                                          │    ↓                        │
                                          │  Plan.status = COMPLETED    │
                                          └─────────────────────────────┘
```

---

## 8. 架构冲突解决方案

### 8.1 双轨统一

**现状**：expansion-planner (A3.2) 和 expansion-manager (A3.0) 并行运行，
各自独立评选目标。

**方案**：
1. `expansion-planner.ts`：修复 Plan 生命周期推进（EVALUATED → READY → APPROVED → WAITING_EXECUTION）
2. `expansion-manager.ts`：`tryStartExpansion()` 改为 `consumeWaitingPlan()`
   - 从 `Memory.kernel.expansionPlans` 读取 `status === "WAITING_EXECUTION"` 的 Plan
   - 用 Plan 中的 `roomName` / `sponsorRoom` / `cost` 等信息驱动执行
   - 不再调用 `selectExpansionTarget()` (V1 evaluator 退役)
3. `expansion-manager.ts` 的 `advanceClaiming()` 和 `advancePioneering()` 改造为
   Execution State Machine 的相位推进
4. `Memory.kernel.expansion` (单条) 改为 Plan 执行状态镜像（或直接从 Plan 推导）

### 8.2 OperationType 扩展方案

```typescript
// 扩展前
export type OperationType = "supply";

// 扩展后
export type OperationType = "supply" | "claim" | "colonize";
```

**不破坏现有 Operation**：
- `"supply"` 类型保持不变（sourceRoom/targetRoom/amount/carrier 语义）
- `"claim"` 类型新增字段：`planId`, `targetController`, `claimerName`
- `"colonize"` 类型新增字段：`planId`, `targetRoom`, `bootstrapPhase`, `checkpoint`

**OperationContext 扩展**:
```typescript
interface OperationContext {
  // ... 现有字段保持不变 ...
  type: OperationType; // 扩展为 "supply" | "claim" | "colonize"

  // ── A3.3 扩展字段（claim/colonize 专用）──
  /** 关联的 ExpansionPlan ID。 */
  planId?: string;
  /** Claimer creep 名称（claim 类型专用）。 */
  claimerName?: string;
  /** Bootstrap 当前阶段（colonize 类型专用）。 */
  bootstrapPhase?: BootstrapPhase;
  /** 最近完成的 Checkpoint。 */
  lastCheckpoint?: CheckpointId;
  /** Pioneer 编队存活快照（colonize 类型专用）。 */
  pioneerStatus?: { workers: number; builders: number; harvesters: number };
}
```

### 8.3 Plan → Operation 映射

```
ExpansionPlan (WAITING_EXECUTION)
    ↓
    ├── createClaimOperation(plan)
    │   └── OperationContext { type: "claim", planId: plan.planId, targetRoom: plan.roomName, ... }
    │
    ↓ claim 成功后
    │
    └── createColonizeOperation(plan)
        └── OperationContext { type: "colonize", planId: plan.planId, targetRoom: plan.roomName, ... }
```

同一 planId 至多一个 Active claim Operation + 一个 Active colonize Operation（去重）。

---

## 9. 执行风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 改造 expansion-manager 破坏现有运行中扩张 | 🔴 高 | 兼容路径：无 Plan 时回退到 V1（过渡期），有 Plan 时走新链 |
| Plan 生命周期修复引入新 bug | 🟡 中 | 先修 Plan 推进逻辑，typecheck + test 全绿后再改 expansion-manager |
| Execution State Machine 过于复杂 | 🟡 中 | 最小化状态数，每状态只做一件事 |
| Bootstrap 能量环不闭合 | 🔴 高 | Energy Loop 验证作为 CP3 硬门禁 |
| 威胁升级响应滞后 | 🟡 中 | 每 tick 检查威胁，LOW→HIGH 立即暂停 |
| 预算预留泄漏 | 🔴 高 | 所有异常路径（failed/cancelled/expired）都释放 reservation |
| global reset 丢失 Execution 状态 | 🟢 低 | 关键状态持久化到 Memory（瘦结构），heap 缓存可丢 |

---

## 10. R9 System 上限检查

当前注册的系统（从 bootstrap.ts 统计）：

| 优先级 | 系统 |
|--------|------|
| P0 | room-state, spawn-manager, tower-defense, traffic-manager |
| P1 | economy, empire-strategy, empire-economy, agenda-manager, logistics, assignment-service, link-system, lab-system |
| P2 | construction-manager, remote-mining-manager, war-planner |
| P3 | layout-planner, defense-planner, room-observer, pixel-system, terminal-manager, factory-manager, power-creep-manager, expansion-manager, expansion-planner, power-farm-manager, prospect-manager, telemetry-collector, tuning-engine |

**当前总数**：约 24 系统 + 19 角色。
A3.3 **不新增 System**——改造现有 `expansion-manager`，不突破 R9 上限。

---

## 11. 结论

### 进入 A3.3 的前置条件

| 条件 | 状态 |
|------|------|
| A3.2 Plan 产出到 WAITING_EXECUTION | ⚠️ 需修复 Plan 生命周期推进 |
| OperationType 可扩展 | ✅ agenda-item.ts 可安全扩展 |
| Claimer 角色已实现 | ✅ 可直接复用 |
| Pioneer 角色（worker/builder）已实现 | ✅ 可直接复用 |
| Spawn 请求链完整 | ✅ submitRequest → spawn-manager |
| Layout/Construction 链完整 | ✅ seedLayoutAnchor → layout-planner → construction-manager |
| Bootstrap 决策已实现 | ✅ decideBootstrapRooms 可复用 |
| Empire Integration 链完整 | ✅ Room Registry → Resource View → Resource Network |
| Military Escort 可条件触发 | ✅ war-planner 已有 attacker/healer |

### 实施优先级

1. **修复 A3.2 Plan 生命周期推进**（前置必须）
2. **OperationType 扩展**（claim + colonize）
3. **Execution Gate**（11 项 TOCTOU 验证）
4. **Execution State Machine**（VALIDATING → PREPARING → CLAIMING → CLAIMED → BOOTSTRAPPING → ECONOMIC_STARTUP → INTEGRATING → COMPLETED）
5. **expansion-manager 改造**（consumePlan 替代 tryStartExpansion）
6. **Checkpoint 机制**（5 个 checkpoint + 恢复路径）
7. **Economic Activation 判据**（替换 spawn 建成 = 完成的过简化判据）
8. **Expansion Reservation**（预算预留 + 生命周期管理 + 异常释放）
9. **Threat Escalation**（LOW→HIGH 暂停/降级/撤退）
10. **Military Escort**（条件性请求，不默认派遣）
11. **Execution Dashboard**（全链路可观测性）
12. **Contract Tests**（25+ 测试）
13. **E2E Tests**（成功 + 12 失败场景）

### 架构裁决

| 裁决 | 决定 |
|------|------|
| 是否新建 System | ❌ 不新建，改造 expansion-manager |
| 是否新建 Creep Framework | ❌ 不新建，复用 role-runner + RolePolicy |
| 是否新建 Spawn 系统 | ❌ 不新建，复用 submitRequest → spawn-manager |
| 是否新建 Layout 系统 | ❌ 不新建，复用 layout-planner + construction-manager |
| 是否新建 Logistics 系统 | ❌ 不新建，复用 logistics + assignment-service |
| V1 evaluator 是否保留 | ⚠️ 过渡期保留（无 Plan 时回退），最终退役 |
| Plan → Operation 映射 | ✅ OperationContext 新增 planId 字段 |
| Claim/Colonize 分离 | ✅ 两个独立 OperationType |
| 完成判据 | ✅ Economic Activation（非 spawn 建成） |
| 并发上限 | ✅ 至多一个 Active Claim + 一个 Active Colonize（蓝图 §1.2） |

---

**Audit 完成。** 下一步：按优先级实施 A3.3。