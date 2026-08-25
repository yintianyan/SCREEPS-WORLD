# A4.6 Recovery Execution Architecture Audit

> 日期：2026-08-25。阶段：A4.6 — Recovery Execution & Autonomous Recovery Loop。
> 基线：A4.5 已完成 Empire Health / Failure Propagation / Recovery Priority / Autonomy Metrics，
> 28 个 E2E 测试通过，但 Recovery Action 尚未被执行层消费。

---

## 1. recoveryActions 当前在哪里产生？

**产生位置**：`src/systems/empire-health-system.ts` L151-157

```
empire-health-system.run(ctx)  [P1, interval=100]
  ├── collectActiveFailures()          →  从 8 维度健康信号推导 FailureNode[]
  ├── buildFailureGraph()              →  构建传播图
  ├── findRootCauses()                 →  反向 BFS 找根因
  ├── analyzeImpact()                  →  正向 BFS 算影响范围
  ├── prioritizeRecovery()             →  排序产出 RecoveryAction[]
  └── g.recoveryActions = recoveryActions  →  写入 globalCache
```

**频率**：每 100 tick 一次。写入 `globalCache.recoveryActions`（heap 存储）。

**数据结构**（来自 `recovery-priority.ts` L43-68）：

```typescript
interface RecoveryAction {
  id: string;                    // "recovery:{failureId}"
  type: RecoveryActionType;      // spawn_recovery | logistics_fix | energy_redirect | ...
  targetFailureId: string;       // 关联的 FailureNode.id
  domain: FailureDomain;         // energy | logistics | spawn | colony | ...
  priority: number;              // 0..100
  estimatedCost: number;         // CPU/能量成本估算
  estimatedBenefit: number;      // 恢复概率 × 影响范围
  roi: number;                   // benefit / cost
  urgent: boolean;               // critical/error → 立即执行
  estimatedRecoveryTime: number; // tick
  description: string;
  recommendation: string;        // 人类可读建议
}
```

**RecoveryActionType 枚举**（12 种）：

| 类型 | 触发领域 | 建议 |
|---|---|---|
| `spawn_recovery` | spawn | emergency spawn [WORK,CARRY,MOVE] |
| `logistics_fix` | logistics | spawn replacement hauler + verify route |
| `energy_redirect` | energy / network | redirect energy from surplus rooms |
| `defense_response` | threat / defense | activate defense: tower + defender |
| `population_rebuild` | colony | rebuild population via spawn priority |
| `route_fix` | network | (未独立映射，network → energy_redirect) |
| `remote_stall` | remote | pause remote mining ops |
| `expansion_pause` | expansion | pause expansion until stability |
| `terminal_trade` | terminal / mineral | execute terminal trade |
| `cpu_conserve` | cpu | activate CPU conservation mode |
| `manual_intervention` | — | (未自动产出) |
| `auto_resolve` | — | (未自动产出) |

---

## 2. 谁拥有 Recovery Decision Authority？

**当前状态**：`empire-health-system` 独占决策权。它：
- 收集失败信号
- 构建传播图
- 计算根因
- 排序恢复优先级
- 写入 `globalCache.recoveryActions`

**没有第二个决策者**。但关键问题是：**没有任何消费者**。

---

## 3. 谁应该消费 recoveryActions？

### 3.1 现有执行系统能力清单

| 执行系统 | 优先级 | 频率 | 能力 | 消费 recoveryActions？ |
|---|---|---|---|---|
| `spawn-manager` | P0 | 每 tick | 唯一 `spawnCreep` 调用者 | ❌ 否 |
| `logistics-planner` | P1 | 100t | 产出 TransportPlan | ❌ 否 |
| `logistics` | P0 | 每 tick | 维护 transportPool | ❌ 否 |
| `agenda-manager` | P1 | 100t | 跨房调拨 Operation 生命周期 | ❌ 否 |
| `remote-mining-manager` | P2 | 10t | 远矿运营管理 | ❌ 否 |
| `terminal-manager` | P3 | 200t | 市场交易 + 互济 | ❌ 否 |
| `expansion-manager` | P3 | interval | 扩张执行状态机 | ❌ 否 |
| `construction-manager` | P2 | interval | 建造执行 | ❌ 否 |
| `empire-strategy` | P1 | interval | 姿态裁决 | ❌ 否 |
| `room-state` | P0 | 每 tick | ColonyState 推导 | ❌ 否 |
| `defense-planner` / `tower-defense` | P0/P3 | 每 tick/interval | 防御 | ❌ 否 |

**结论：所有执行系统都不读取 `globalCache.recoveryActions`。**

### 3.2 应该由谁消费？

Recovery Action 不应该由现有执行系统各自独立消费——那会导致：
1. 多个系统同时响应同一个 Recovery Action → 重复执行
2. 没有统一的 Idempotency 检查 → 同一动作重复提交
3. 没有统一的 Verification → 无法判断恢复是否成功

**方案：创建 `recovery-execution-system.ts` 作为唯一消费入口（薄壳）。**

它的职责：
1. 读取 `globalCache.recoveryActions`
2. 对每个 Action 做 Idempotency 检查（稳定 key 去重）
3. 将 Action 翻译为现有执行系统的输入格式
4. 提交到现有执行系统（spawn queue / logistics plan / agenda operation / remote ops）
5. 追踪 Action 生命周期（PROPOSED → SUBMITTED → VERIFYING → SUCCEEDED/FAILED）
6. 验证 World State 实际改善

**禁止**：在 `recovery-execution-system.ts` 中重新实现 spawn/logistics/operation 逻辑。

---

## 4. 现有 Execution Layer 中哪些能力可以直接复用？

### 4.1 Spawn 执行链路（完全可复用）

```
RecoveryAction (type=spawn_recovery)
  ↓ translate
SpawnRequest { key, role, home, priority, body, memory, createdAt, expiresAt }
  ↓ submitRequest()
RoomMemory.spawnQueue
  ↓ spawn-manager.run()
spawnManagerSystem → trySpawn() → spawn.spawnCreep()
  ↓
Creep 存活 → role-runner 驱动
```

**关键接口**：
- `submitRequest(queue, request)` — 幂等合并（按 key 去重）
- `spawnKey(role, home, index, sourceId?)` — 稳定 key 生成
- `hasRequest(queue, key)` — 检查是否已有请求
- `removeRequestsByRole(queue, role, home)` — 撤销请求

**Idempotency 已内置**：`submitRequest` 按 `key` 合并，同 key 不重复创建。

### 4.2 Logistics 执行链路（部分可复用）

```
RecoveryAction (type=logistics_fix / route_fix)
  ↓ translate
TransportPlan.requests (scope="operation" 或 "empire")
  ↓ logistics-planner 消费
globalCache.logisticsPlan
  ↓ agenda-manager 消费 Plan-driven Operation
OperationContext → carrier spawn → delivery → verification
```

**关键接口**：
- `globalCache.logisticsPlan` — Plan 写入位置
- `agenda-manager` 步 13.5 — 消费 `scope="empire"` 的 Plan 请求
- `remote-mining-manager` — 消费 `scope="operation"` 的 Plan 请求

**限制**：当前 Plan 只在 100t 间隔由 logistics-planner 生成。Recovery Action 需要更即时
的执行——不能等下一个 100t 周期。因此 Recovery System 需要能直接提交到 spawn queue
（对于 spawn 类恢复）或直接注入 Operation（对于 logistics 类恢复）。

### 4.3 Operation 执行链路（可复用）

```
RecoveryAction (type=energy_redirect / remote_stall)
  ↓ translate
OperationContext { sourceRoom, targetRoom, resource, amount, priority, deadline }
  ↓ createOperation() → markReady()
Memory.kernel.agendas
  ↓ agenda-manager.run()
submitCarrierSpawn() → carrier spawn → delivery → verification
```

**关键接口**：
- `createOperation()` — 创建 Operation
- `markReady/markRunning/markVerifying/markCompleted/markFailed` — 状态机
- `hasActiveOperation()` — 幂等去重
- `reportDelivery()` — 送达量报告
- `checkExpiry()` — 超时检查

### 4.4 Remote Mining 执行链路（可复用）

```
RecoveryAction (type=remote_stall)
  ↓ translate
RemoteOp.state = "paused" | "abandoned"
  ↓ remote-mining-manager 维护
recycleBlockedRoomCreeps() → creep recycle
```

**关键接口**：
- `Memory.rooms[home].remoteOps[target]` — 远矿运营状态
- `op.state = "paused" | "abandoned" | "active"` — 状态控制
- `recycleBlockedRoomCreeps()` — 回收远矿 creep

### 4.5 Expansion 执行链路（可复用）

```
RecoveryAction (type=expansion_pause)
  ↓ translate
Memory.kernel.expansionPausedUntil = tick + cooldown
  ↓ expansion-manager 检查
expansion-manager: if (expansionPausedUntil > tick) return;
```

**关键接口**：
- `Memory.kernel.expansionPausedUntil` — 暂停扩张直到指定 tick

### 4.6 Terminal 执行链路（可复用）

```
RecoveryAction (type=terminal_trade)
  ↓ translate
ProcurementDemand { resource, amount, priority, deadline, reason }
  ↓ publishProcurementDemands()
globalCache.procurementDemands
  ↓ terminal-manager 消费
terminalManagerSystem → Game.market.deal() / terminal.send()
```

**关键接口**：
- `publishProcurementDemands(room, demands, tick)` — 发布采购需求
- `terminal-manager` 自动消费需求表

---

## 5. Recovery Action Capability Matrix

| Recovery Action | Decision | Executor | 执行入口 | Idempotency | Status |
|---|---|---|---|---|---|
| **SPAWN_MINER** | Domain (recovery-priority) | spawn-manager | `submitRequest(queue, {role:"harvester",...})` | key=`harvester:${room}:${sourceId}:${index}` | ❌ 未接线 |
| **SPAWN_HAULER** | Domain | spawn-manager | `submitRequest(queue, {role:"hauler",...})` | key=`hauler:${room}:${index}` | ❌ 未接线 |
| **SPAWN_DISTRIBUTOR** | Domain | spawn-manager | `submitRequest(queue, {role:"distributor",...})` | key=`distributor:${room}:${index}` | ❌ 未接线 |
| **SPAWN_RECOVERY** | Domain | spawn-manager | `submitRequest(queue, {role:"worker",priority:0,...})` | key=`worker:${room}:${index}` | ❌ 未接线 |
| **REPLAN_LOGISTICS** | Domain | logistics-planner | 触发 Plan 重算（需信号注入） | Plan 自然去重 | ❌ 未接线 |
| **REPLACE_HAULER** | Domain | spawn-manager | `submitRequest(queue, {role:"hauler",...})` | 同 SPAWN_HAULER | ❌ 未接线 |
| **RECALCULATE_ROUTE** | Domain | logistics-planner | `routeCache.invalidate(from, to)` | TTL 自然失效 | ❌ 未接线 |
| **PAUSE_REMOTE** | Domain | remote-mining-manager | `op.state = "paused"` | 状态检查 | ❌ 未接线 |
| **RESUME_REMOTE** | Domain | remote-mining-manager | `op.state = "active"` | 状态检查 | ❌ 未接线 |
| **ENERGY_REDIRECT** | Domain | agenda-manager | `createOperation() → markReady()` | `hasActiveOperation()` | ❌ 未接线 |
| **PAUSE_EXPANSION** | Domain | expansion-manager | `Memory.kernel.expansionPausedUntil = tick + N` | 时间戳检查 | ❌ 未接线 |
| **TERMINAL_TRADE** | Domain | terminal-manager | `publishProcurementDemands()` | 资源 key 去重 | ❌ 未接线 |
| **CPU_CONSERVE** | Domain | kernel scheduler | `ctx.budget` tier 降级 | — | ❌ 未接线 |
| **DEFENSE_RESPONSE** | Domain | tower-defense / defense-planner | 已有独立威胁响应链 | — | ⚠️ 已有独立链路 |
| **POPULATION_REBUILD** | Domain | spawn-manager | `submitRequest` 多角色 | 多 key | ❌ 未接线 |
| **COLONY_RECOVERY** | Domain | expansion-manager (bootstrap) | `runBootstrapLane()` | — | ⚠️ 已有 bootstrap lane |

---

## 6. 是否存在第二套 Recovery Manager？

**否。** 当前只有 `empire-health-system` 产出 `recoveryActions`，没有任何其他系统执行
恢复动作。但存在以下**独立响应机制**（不是第二套 Recovery Manager，但可能重叠）：

| 独立响应机制 | 触发条件 | 执行内容 | 与 Recovery System 关系 |
|---|---|---|---|
| spawn-manager P0 恢复 | collectorCount ≤ 1 | 降级 body + 优先孵化 worker | **互补**：spawn-manager 自身有灾后恢复能力，Recovery System 应在其之上增加信号 |
| spawn-manager churn 熔断 | 200t 内同 role churn > 20 | 冻结 100t | **互补**：Recovery System 需感知冻结状态 |
| room-state crisis 通道 | reserve/spendableRatio/srcRatio | colonyState → recovery/bootstrap | **互补**：Recovery System 消费 colonyState 作为输入 |
| expansion bootstrap lane | owned 无 spawn | 姊妹房代孵 worker | **互补**：Recovery System 的 COLONY_RECOVERY 可复用此通道 |
| tower-defense | 威胁 creep 在场 | tower 攻击 + defender 孵化 | **独立**：防御有独立链路，Recovery System 不应重复 |
| remote-mining threatUntil | 远矿房有威胁 | 暂停孵化 + creep flee | **互补**：Recovery System 的 PAUSE_REMOTE 可复用 |

**结论：不需要创建第二套 Recovery Manager。** 需要创建一个 `recovery-execution-system.ts`
薄壳，将 RecoveryAction 翻译并提交到现有执行系统。

---

## 7. 断点分析：Recovery Action → Execution

### 7.1 断点 1：无消费者

```
empire-health-system
  ↓ writes
globalCache.recoveryActions: RecoveryAction[]
  ↓ ??? (无人读取)
```

**修复方案**：创建 `recovery-execution-system.ts`（P1, interval=10），每 10 tick 读取
`globalCache.recoveryActions`，翻译并提交到执行系统。

### 7.2 断点 2：无生命周期管理

当前 `RecoveryAction` 没有状态字段——它只是一个建议，没有 PROPOSED/SUBMITTED/
VERIFYING/SUCCEEDED/FAILED 生命周期。

**修复方案**：在 Domain 层新增 `recovery-lifecycle.ts`，定义 RecoveryAction 的
完整生命周期状态机。

### 7.3 断点 3：无 Idempotency 检查

`recoveryActions` 每 100t 重新生成，同一个失败可能在多个周期产生相似的 Action。
没有去重机制 → 同一个 spawn 请求可能被重复提交。

**修复方案**：
- Spawn 类：复用 `submitRequest` 的 key 幂等机制
- Operation 类：复用 `hasActiveOperation` 去重
- Remote 类：检查 `op.state` 避免重复操作
- 追踪 `activeRecoveryIds` Set（heap），已提交的 Action 不重复提交

### 7.4 断点 4：无 Verification

Recovery Action 提交后没有验证 World State 是否实际改善。

**修复方案**：在 Domain 层新增 `evaluateRecoveryResult(beforeState, action, afterState)`
纯函数，判断 SUCCESS / PARTIAL / FAILED / NO_PROGRESS。

### 7.5 断点 5：无 Retry 限制和 Cooldown

A4.5 已有 `recoveryCooldowns`（`CooldownTable`），但当前只有冷却检查——没有
maxAttempts 限制、没有 Retry Policy 分类（RETRYABLE / NON_RETRYABLE / BLOCKED）。

**修复方案**：扩展 `recovery-priority.ts` 或新增 `recovery-lifecycle.ts`，增加
Retry Policy + maxAttempts + Escalation 逻辑。

### 7.6 断点 6：无 Escalation

Recovery 失败后，系统会继续产生同样的 Action（因为 Failure 仍然存在）。没有
重新 Diagnosis 的机制。

**修复方案**：Recovery 失败 → 标记 Failure 为 `escalated` → 下次 `empire-health-system`
运行时重新 `detectRootCause`，可能发现新的根因 → 产出不同的 Action。

---

## 8. Spawn Starvation 追踪缺失

A4.5 的 `empire-health-system.ts` L369 读取 `RoomMemory.spawnStarvationCount`：

```typescript
const roomMem = Memory.rooms[snap.roomName] as RoomMemory & { spawnStarvationCount?: number };
if (roomMem?.spawnStarvationCount) {
  starvationCount += roomMem.spawnStarvationCount;
}
```

但 `room-state.ts` 从不写入此字段——`spawnStarvationCount` 永远为 `undefined`。

**修复方案**：在 `room-state.ts` 中从真实状态派生 `spawnStarvationCount`：
- 检测条件：`spawnQueue` 有 P0 请求但 `energyAvailable < bodyCost(RECOVERY_BODY)`
- 持续 tick 计数：每 tick 条件满足则递增，条件不满足则归零
- 写入 `RoomMemory.spawnStarvationCount`

---

## 9. 系统执行顺序（A4.6 更新后预期）

```
P0: roomStateSystem              ← 新增 spawnStarvationCount 派生
P1: economySystem
P0: spawnManagerSystem
P0: towerDefenseSystem
P1: empireStrategySystem
P1: empireEconomySystem
P1: agendaManagerSystem
P0: logisticsSystem
P1: logisticsPlannerSystem
P1: assignmentServiceSystem
P1: linkSystem
P1: labSystem
P2: constructionManagerSystem
P2: remoteMiningManagerSystem
P1: specializationPlannerSystem
P1: empireHealthSystem           ← A4.5 产出 recoveryActions
P1: recoveryExecutionSystem      ← A4.6 新增消费 recoveryActions（interval=10）
P2: warPlannerSystem
...
```

---

## 10. 审计结论

| 审计项 | 结论 |
|---|---|
| recoveryActions 产生位置 | ✅ 已明确（empire-health-system → globalCache） |
| recoveryActions 数据结构 | ✅ 已明确（RecoveryAction 接口） |
| Recovery Decision Authority | ✅ 已明确（empire-health-system 独占） |
| 谁应该消费 recoveryActions | ✅ 已明确（新建 recovery-execution-system.ts 薄壳） |
| 现有执行能力可复用 | ✅ 已确认（spawn queue / operation lifecycle / remote ops / terminal demands） |
| 已有执行能力的 Action | ⚠️ defense_response / colony_recovery 有独立链路 |
| 缺少执行能力的 Action | ❌ spawn / logistics / energy_redirect / remote / expansion / terminal 均未接线 |
| 是否存在第二套 Recovery Manager | ✅ 已确认不存在 |
| Recovery Action Lifecycle | ❌ 缺失（需新增 Domain 纯函数） |
| Idempotency | ❌ 缺失（需复用现有 key 机制 + 新增 activeRecoveryIds 追踪） |
| Verification | ❌ 缺失（需新增 evaluateRecoveryResult 纯函数） |
| Retry Policy | ❌ 缺失（需新增 maxAttempts + 分类） |
| Escalation | ❌ 缺失（需新增失败 → 重新 Diagnosis 链路） |
| Spawn Starvation | ❌ 缺失（需在 room-state 中派生） |

---

## 11. A4.6 实施路线

### Phase 2: Recovery Action Capability Matrix（本审计已完成）

### Phase 3: Recovery Domain 层纯函数
- `src/domain/strategy/recovery-lifecycle.ts`
  - RecoveryActionState 状态机（PROPOSED → VALIDATED → SUBMITTED → EXECUTING → VERIFYING → SUCCEEDED / FAILED）
  - Idempotency key 生成（基于 domain + room + actionType + targetId）
  - `evaluateRecoveryResult(beforeState, action, afterState)` → SUCCESS / PARTIAL / FAILED / NO_PROGRESS
  - Retry Policy（maxAttempts + RETRYABLE / NON_RETRYABLE / BLOCKED / RESOURCE_CONSTRAINED / THREAT_BLOCKED）
  - Escalation 逻辑（失败 → 标记 escalated → 触发重新 Diagnosis）

### Phase 4: recovery-execution-system.ts 薄壳
- P1, interval=10（高频消费，不等 100t）
- 读取 `globalCache.recoveryActions`
- Idempotency 检查（activeRecoveryIds Set）
- translate → submit 到现有执行系统
- 追踪生命周期（SUBMITTED → VERIFYING → SUCCEEDED/FAILED）
- 记录 cooldown + attempt

### Phase 5: 补齐 spawnStarvationCount
- 在 `room-state.ts` 中从真实状态派生

### Phase 6: Correlation ID
- RecoveryAction 增加 correlationId 字段
- 关联 failureId / recoveryId / actionId / spawnRequestId / operationId

### Phase 7-8: E2E 测试 + 长运行验证

### Phase 9: 最终报告
