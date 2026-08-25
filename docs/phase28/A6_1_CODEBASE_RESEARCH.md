# A6.1 Codebase Research — Experience Data Flow Map

> **阶段**: A6.1 Experience & Outcome Attribution
> **日期**: 2026-08-25
> **前置**: A6.0 Research (12 docs in `docs/phase27/`)
> **约束**: 纯研究文档，不修改任何已有代码

---

## 一、Existing Decision Sources

### 1.1 DecisionTrace (A4.7)

**位置**: `src/systems/decision-trace-system.ts` + `src/domain/strategy/decision-trace.ts`

**已有能力**:
- `DecisionSnapshot` — 决策时刻的完整输入快照（经济/资源/物流/威胁/spawn/人口/健康/恢复/运营/规划器 10 大维度）
- `DecisionRecord` — 完整结构化记录（decisionId, tick, category, actor, scope, inputSnapshotHash, reasons[], evidence, selectedAction, rejectedAlternatives[], expectedOutcome, correlationId, severity, decisionHash, createdAt, lifecycle）
- Ring Buffer (1000 条, heap, `globalCache.__decisionTraceCache`)
- Snapshot Registry (Map<hash, snapshot>)
- 采集 6 类决策：EmpireHealth / Logistics / Recovery / Spawn / Defense / WarPlan
- `DecisionCategory` 枚举：ECONOMY / SPAWN / LOGISTICS / REMOTE / EXPANSION / RECOVERY / DEFENSE_PREP / RESOURCE_ALLOCATION / ROUTE_SELECTION / CONTRACT / MILITARY
- 查询 API：`getDecisionTraceRecords()`, `queryDecisionTrace()`, `getDecisionChain()`
- Dashboard：`printDecisionTraceDashboard()`
- GC：`gcTrace()` 按年龄清理
- Memory Budget：`measureMemoryBudget()`
- Integrity Check：`checkTraceIntegrity()`
- Replay：`snapshotHash()`, `decisionHash()`, `makeCorrelationId()`, `makeDecisionId()`

**A6.1 如何消费**:
- 只读消费 `DecisionRecord` from Ring Buffer
- 通过 `decisionId` 引用，不复制完整记录
- 提取 `decisionSummary`（category, actor, selectedAction, decisionHash）
- 复用 `correlationId` 偺跨系统追踪

**关键接口**:
```typescript
// 已有导出函数
export function getDecisionTraceRecords(limit?: number): DecisionRecord[]
export function queryDecisionTrace(query: TraceQuery): DecisionRecord[]
// Ring Buffer 内部结构
interface TraceRingBuffer { records: DecisionRecord[]; capacity; count; totalWritten; head; tail; }
```

### 1.2 Empire Strategy (A3)

**位置**: `src/systems/empire-strategy.ts` + `src/domain/strategy/posture.ts`

**已有能力**:
- `evaluateEmpirePosture()` — 帝国姿态裁决（develop/expand/fortify/war）
- 输出写入 `Memory.kernel.strategy.posture`
- 姿态切换原因可追溯

### 1.3 War Planning (A5.3)

**位置**: `src/systems/war-planning-system.ts` + `src/domain/military/war-planning.ts`

**已有能力**:
- `WarPlan` 结构：operation, posture, risk, economicGuard, expectedValue, capabilityGaps, targetSelection
- 写入 `globalCache.warPlanCache`
- 兼容写入 `Memory.kernel.warPlan`

### 1.4 Tactical Decisions (A5.4)

**位置**: `src/systems/tactical-runtime-system.ts` + `src/domain/tactical/`

**已有能力**:
- `TacticalDecision` — 战术决策（newState, formation, target, confidence, reason, evidence, rejectedAlternatives）
- `TacticalDecisionRecord` — 写入 event-log
- 状态机：MOVING / POSITIONING / ENGAGING / DISENGAGING / RETREATING / REGROUPING / ABORTED / COMPLETED

---

## 二、Existing Execution Sources

### 2.1 Spawn Manager (A4.4)

**位置**: `src/systems/spawn-manager.ts` + `src/domain/spawn/queue.ts`

**已有能力**:
- 唯一 `spawnCreep` 调用者
- `submitRequest()` / `hasRequest()` / `removeRequestsByRole()` / `countPending()`
- 队列写入 `Memory.rooms[roomName].spawnQueue`
- P0 紧急恢复优先

### 2.2 Logistics (A4.3)

**位置**: `src/systems/logistics-planner.ts` + `src/domain/logistics/`

**已有能力**:
- `TransportPlan` — 运输计划（requests, routes）
- `LogisticsHealth` — 物流健康度（level, deliveryRate, backlogCount, message）
- `LogisticsAccounting` — 运输会计（summary + entries）
- 写入 `globalCache.logisticsPlan`, `logisticsHealth`, `logisticsAccounting`

### 2.3 Recovery Execution (A4.6)

**位置**: `src/systems/recovery-execution-system.ts` + `src/domain/strategy/recovery-lifecycle.ts`

**已有能力**:
- `RecoveryActionTable` — Action 追踪表（Map<key, RecoveryActionRecord>）
- 九态生命周期：proposed → validated → submitted → executing → verifying → succeeded / failed / retryable / terminal / blocked
- `RecoveryStats` — 统计（succeededCount, failedCount, terminalCount, avgRecoveryTime）
- `RecoveryWorldSnapshot` — Before/After 状态对比
- 写入 `globalCache.recoveryActionTable`, `recoveryStats`, `recoveryBeforeStates`

### 2.4 Construction Manager

**位置**: `src/systems/construction-manager.ts` + `src/domain/construction/queue.ts`

**已有能力**:
- Build queue 管理
- `Memory.rooms[roomName].buildQueue`

### 2.5 Remote Mining Manager

**位置**: `src/systems/remote-mining-manager.ts`

**已有能力**:
- 远矿运营管理
- 写入 `Memory.rooms[home].remoteOps[target]`

---

## 三、Existing Outcome Sources

### 3.1 evaluateWarOutcome (A5.3)

**位置**: `src/domain/war/planning.ts`

**已有能力**:
```typescript
export function evaluateWarOutcome(
  towersSeen: number,
  intelTowers: number | undefined,
  intelOwner: string | undefined,
  intelLastSeen: number | undefined,
  tick: number,
  freshness: number,
): WarOutcome  // "success" | "failure" | "unknown"
```

**调用位置**: `src/systems/war-planner.ts` — `demobilize()` 函数中调用

**结果记录**: `recordEvent(EventKind.WarOutcome, targetRoom, [outcomeCode, spawned, reason])`

### 3.2 Empire Health (A4.5)

**位置**: `src/systems/empire-health-system.ts` + `src/domain/strategy/empire-health.ts`

**已有能力**:
- 8 维度健康度评估（energy, mineral, logistics, network, colony, threat, spawn, cpu）
- `EmpireHealthResult` — level (healthy/stable/degraded/critical/unknown), score, bottleneck, recovering, dimensions[]
- Hysteresis（滞回）防止频繁切换
- 历史数据（heap）：healthHistory, postureHistory, netFlowHistory, reserveHistory, populationHistory, failureCountHistory
- 写入 `globalCache.empireHealth`

### 3.3 Recovery Lifecycle Verification (A4.6)

**位置**: `src/domain/strategy/recovery-lifecycle.ts`

**已有能力**:
- `evaluateRecoveryResult()` — 验证 World State 是否改善
- Before/After 对比（`RecoveryWorldSnapshot`）
- `RecoveryVerificationResult` — 验证结果
- `computeRecoveryStats()` — 统计数据

### 3.4 EventLog

**位置**: `src/kernel/event-log.ts`

**已有能力**:
- `recordEvent(kind, roomName, data)` — 写入 heap buffer
- `drainEventBuffer()` — 获取并清空 buffer
- 40+ 种 `EventKind` 枚举
- `GameEvent` 结构：`{ t, k, r, d[] }` — 紧凑整数编码
- Segment 2 持久化（telemetry-collector 每 10 tick flush）
- Ring Buffer 环形覆盖

**关键 EventKind**（A6 消费）:
- `WarOutcome` (22) — 战争结果 `[outcomeCode, spawned, reason]`
- `ExpansionOutcome` (23) — 扩张结果 `[phase, outcome, duration]`
- `CreepDeath` (17) — `[roleCode, x, y, age, natural]`
- `TowerVolley` (18) — `[firedCount, targetX, targetY, targetHealParts, floor(targetHits/100)]`
- `StructureDestroyed` (13) — `[structureTypeCode, prevCount, currCount]`
- `EnemyInvasion` (7) / `EnemyCleared` (8)
- `PhaseTransition` (0) / `ColonyStateChange` (3)
- `TuningAdjust` (19) / `TuningRollback` (20) / `TuningFreeze` (21)

### 3.5 Expansion Outcome

**位置**: `src/systems/expansion-manager.ts` — `recordExpansionOutcome()`

**已有能力**:
- `recordEvent(EventKind.ExpansionOutcome, target, [phase, outcome, duration])`
- Expansion rhythm 评估（ring buffer, blacklistMultiplier, pauseTicks）

### 3.6 Tuning Engine

**位置**: `src/systems/tuning-engine.ts`

**已有能力**:
- 参数调整效果追踪（improved/worsened）
- `TuningAdjust` / `TuningRollback` / `TuningFreeze` 事件
- 覆盖层机制

---

## 四、Existing Lifecycle Events

### 4.1 Operation Lifecycle (A3.0)

**位置**: `src/domain/operation/lifecycle.ts` + `src/domain/operation/agenda-item.ts`

**九态状态机**:
```
planned → ready → running → verifying → completed
                  ↘ blocked → (retry) → ready
                  ↘ failed / cancelled / expired
```

**关键函数**: `markReady()`, `markRunning()`, `markVerifying()`, `markCompleted()`, `markBlocked()`, `markFailed()`, `markCancelled()`, `markExpired()`, `checkExpiry()`, `reportDelivery()`

**Operation 类型**: `supply | claim | colonize | remote_mining`

### 4.2 Remote Mining Operation Lifecycle (A4.1)

**位置**: `src/domain/operation/remote-mining-op.ts`

**检查点流程**:
```
DISCOVERED → VALIDATED → PREPARED → INFRASTRUCTURE_READY
  → MINING_ACTIVE → LOGISTICS_ACTIVE → ECONOMIC_ACTIVE
```

**经济追踪**: `actualProduction`, `actualDelivered`, `actualLost`, `economicHealth`

### 4.3 Recovery Action Lifecycle (A4.6)

**位置**: `src/domain/strategy/recovery-lifecycle.ts`

**十态状态机**:
```
proposed → validated → submitted → executing → verifying
  → succeeded / failed / retryable / terminal / blocked
```

**关键函数**: `createActionRecord()`, `markSubmitted()`, `markExecuting()`, `markVerifying()`, `markSucceeded()`, `markFailed()`, `markBlocked()`, `evaluateRecoveryResult()`, `computeRecoveryStats()`

### 4.4 War Lifecycle

**位置**: `src/systems/war-planner.ts` + `src/domain/war/planning.ts`

**波次集结 FSM**:
```
recruit → build (hold 钩子归建待命) → advance → engage → rotate
```

**止损链**:
- `isAttritionLost()` — 战损止损（spawned > squadSize × casualtyMultiplier）
- `warBlacklist` — 失败/unknown 目标冷却
- `warStandDownUntil` — 止损后整军休战

**战后核验**: `evaluateWarOutcome()` + `WarOutcome` 事件记录

---

## 五、Existing Attribution Candidates

### 5.1 Failure Propagation Graph (A4.5)

**位置**: `src/domain/strategy/failure-propagation.ts`

**已有能力**:
- `FailureGraph` — 失败传播图（nodes + edges）
- `FailureNode` — { id, domain, severity, description, detectedAt, room }
- `findRootCauses()` — 根因检测
- `analyzeImpact()` — 影响范围分析
- `buildFailureGraph()` — 从活跃失败列表构建图

### 5.2 Recovery Priority (A4.5)

**位置**: `src/domain/strategy/recovery-priority.ts`

**已有能力**:
- `RecoveryAction` — { id, type, domain, priority, urgent, roi, recommendation, targetFailureId }
- `prioritizeRecovery()` — 排序恢复优先级
- `CooldownTable` — 冷却表

### 5.3 Empire Health Dimensions (A4.5)

**位置**: `src/domain/strategy/empire-health.ts`

**已有能力**:
- 8 维度独立评分（每维有 level + score + evidence）
- `bottleneck` — 瓶颈维度标识
- 可用于归因的维度：energy, mineral, logistics, network, colony, threat, spawn, cpu

### 5.4 Autonomy Metrics (A4.5)

**位置**: `src/domain/strategy/autonomy-metrics.ts`

**已有能力**:
- `computeAutonomyScore()` — 自治能力评分
- `detectNoProgress()` — 停滞检测
- `detectThrashing()` — 抖动检测

---

## 六、Existing Memory/Storage Facilities

### 6.1 Memory (Versioned Truth)

**位置**: `src/kernel/memory.ts`

**已有能力**:
- 版本化 schema（`schemaVersion` + migration）
- `Memory.kernel` — 帝国级状态
- `Memory.rooms[roomName]` — 房间级状态
- `recordSkip()` — 跳过原因记录

### 6.2 GlobalCache (Heap)

**位置**: `src/kernel/global-cache.ts`

**已有能力**:
- `GlobalCache` interface — 50+ 字段
- `globalCache()` — 类型安全访问器
- 所有字段可选，global reset 后可惰性重建
- 包含 DecisionTrace / EmpireHealth / Recovery / Logistics / WarPlan 等所有运行时状态

### 6.3 RawMemory Segments

**已有使用**:
- Segment 2: EventLog（telemetry-collector flush）
- Intel segments: 玩家情报
- 潜在可用: A6 将使用新 segment 用于 Episodic/Semantic/Combat Memory

### 6.4 Ring Buffer

**位置**: `src/kernel/ring-buffer.ts`

**已有能力**:
- 通用 Ring Buffer 实现（`createRingBuffer()`, `ringPush()`, `ringToArray()`, `ringSize()`）
- 已被 DecisionTrace 和 EventLog 使用

---

## 七、Existing DecisionTrace Integration

### 7.1 采集链路

DecisionTrace System (interval=100, P3, post) 已采集 6 类决策：

| 采集函数 | 来源系统 | Category | 触发条件 |
|---------|---------|----------|---------|
| `collectEmpireHealthDecisions` | empire-health-system | RECOVERY | 有 recoveryActions 或 health degraded |
| `collectLogisticsDecisions` | logistics-planner | LOGISTICS | 有 requests 或 health ≠ healthy |
| `collectRecoveryDecisions` | recovery-execution-system | RECOVERY | 有 actionTable entries |
| `collectSpawnDecisions` | spawn-manager (via Memory) | SPAWN | 有 queue entries |
| `collectDefenseDecisions` | room-state / remote-mining-manager | DEFENSE_PREP / REMOTE | 威胁 ≥ MEDIUM 或远矿决策 ≠ CONTINUE |
| `collectWarPlanDecisions` | war-planning-system | MILITARY | posture=war 或有活跃 WarPlan |

### 7.2 查询接口

```typescript
// 从 Ring Buffer 获取最近的 DecisionRecord
export function getDecisionTraceRecords(limit?: number): DecisionRecord[]

// 按条件查询
export function queryDecisionTrace(query: TraceQuery): DecisionRecord[]

// 获取决策链
export function getDecisionChain(correlationId: string): DecisionChainEntry[]
```

### 7.3 A6.1 集成点

A6.1 Experience Collector 需要：
1. 读取 Ring Buffer 中的 DecisionRecord（通过 `getDecisionTraceRecords()` 或直接访问 `globalCache.__decisionTraceCache`）
2. 判断哪些 DecisionRecord 已到期（`measurementDelay` 已过）
3. 采集 Outcome（从 evaluateWarOutcome / empireHealth / recoveryStats 等消费）
4. 构建 ExperienceRecord（引用 decisionId，不复制完整 DecisionRecord）

---

## 八、Missing Observation Hooks

### 8.1 缺失的 Outcome 采集

| 缺失 | 严重度 | 修复方案 |
|------|--------|---------|
| 无 OutcomeRecord 结构 | HIGH | A6.1 新建（domain 纯函数） |
| 无 Experience Collector 系统 | HIGH | A6.1 新建（system 薄壳） |
| 无 Attribution 模型 | HIGH | A6.1 新建（domain 纯函数） |
| 无 Episodic Memory 持久化 | MEDIUM | A6.2 处理（A6.1 先用 heap Ring Buffer） |

### 8.2 可用的最小化 Hook

A6.1 不需要修改已有业务系统。已有系统的产出全部在 globalCache / Memory / EventLog 中可见。

**A6.1 只需读取**：
- `globalCache.__decisionTraceCache` → DecisionRecord[]
- `globalCache.empireHealth` → EmpireHealthResult
- `globalCache.recoveryStats` → RecoveryStats
- `globalCache.recoveryActionTable` → RecoveryActionTable
- `globalCache.warPlanCache` → WarPlan
- `globalCache.logisticsHealth` → LogisticsHealthResult
- `globalCache.warAbortSignals` → WarAbortSignal（战争止损信号）
- `EventLog segment` → GameEvent[]
- `Memory.kernel.warPlan` → WarPlan（兼容字段）
- `Memory.kernel.strategy` → posture

**不需要新增任何 hook** — 已有系统的所有产出已通过 globalCache / Memory / EventLog 可见。

---

## 九、Architecture Conflicts

### 9.1 无冲突

A6.1 作为 shadow-only observer，只读消费已有系统产出，不修改任何已有系统代码。

### 9.2 潜在风险

| 风险 | 缓解措施 |
|------|---------|
| DecisionTrace Ring Buffer 容量 1000 条，DecisionRecord 可能已被 GC | A6.1 在 `measurementDelay` 内采集，超期标记 `EXPIRED` |
| globalCache 在 global reset 后丢失 | A6.1 所有状态 heap-only，global reset 后从空重建可接受 |
| EventLog segment 异步语义 | A6.1 不直接读 segment，通过 `drainEventBuffer()` 消费（或由 system 层适配） |
| A6.1 系统故障影响帝国 | 走 safeRun + P3 + interval=100，Recovery 档全停 |

---

## 十、Recommended Implementation Boundary

### 10.1 Domain 层（纯函数，不引用 Game/Memory/RawMemory）

| 文件 | 职责 |
|------|------|
| `src/domain/intelligence/experience.ts` | ExperienceRecord 类型 + buildExperienceRecord() + lifecycle |
| `src/domain/intelligence/outcome.ts` | OutcomeRecord 类型 + collectOutcome() + measurement delay |
| `src/domain/intelligence/attribution.ts` | Attribution 模型 + Evidence-based 归因纯函数 |
| `src/domain/intelligence/index.ts` | 导出入口 |

### 10.2 System 层（薄壳，采集 Runtime State 调用 Domain）

| 文件 | 职责 |
|------|------|
| `src/systems/intelligence/experience-collector-system.ts` | 扫描 DecisionTrace Ring Buffer → 采集 Outcome → 构建 Experience |
| `src/systems/intelligence/outcome-evaluation-system.ts` | 低频评估 Outcome → Attribution → 写入 Episodic Buffer |

### 10.3 注册

在 `bootstrap.ts` 中注册 2 个新系统（P3, post, interval=100），不改 Kernel。

### 10.4 测试

| 文件 | 覆盖 |
|------|------|
| `tests/unit/intelligence/a6-1-experience.test.ts` | EXP-001~005 |
| `tests/unit/intelligence/a6-1-outcome.test.ts` | OUT-001~006 |
| `tests/unit/intelligence/a6-1-attribution.test.ts` | ATTR-001~014 |
| `tests/unit/intelligence/a6-1-architecture.test.ts` | Architecture Guards |
| `tests/integration/intelligence/a6-1-e2e.test.ts` | E2E chain |

### 10.5 存储策略（A6.1 阶段）

- **Hot Buffer**: `globalCache.__experienceBuffer` — heap Ring Buffer (100 条)
- **不写 Memory 主体** — 遵守 MEMORY_ARCHITECTURE §7 #2
- **不写 segment** — segment 持久化推迟到 A6.2
- **global reset 可丢** — A6.1 只做采集和评估，不做持久化

---

## 十一、Experience Data Flow Map

```
DecisionTrace System (interval=100, P3, post)
  ↓ 产出 DecisionRecord[]
  ↓ 写入 Ring Buffer (heap, globalCache.__decisionTraceCache)
  ↓
Experience Collector System (interval=100, P3, post)
  ↓ 读取 DecisionRecord[] from Ring Buffer
  ↓ 判断 measurementDelay 是否到期
  ↓ 到期 → 采集 OutcomeRecord
  │   ├── MILITARY → consume evaluateWarOutcome (from EventLog / warAbortSignals)
  │   ├── RECOVERY → consume recoveryStats / recoveryActionTable
  │   ├── LOGISTICS → consume logisticsHealth / logisticsAccounting
  │   ├── SPAWN → consume spawn queue stats + creep存活
  │   ├── DEFENSE_PREP → consume threatAssessments
  │   ├── REMOTE → consume remoteOps state
  │   └── ECONOMY → consume empireHealth delta
  ↓
  ↓ 构建 ExperienceRecord (decisionRef + outcome + attribution)
  ↓ 写入 Experience Ring Buffer (heap, globalCache.__experienceBuffer)
  ↓
Outcome Evaluation System (interval=100, P3, post)
  ↓ 读取未归因的 ExperienceRecord[]
  ↓ 调用 Attribution 纯函数（Evidence-based）
  ↓   ├── 收集 Evidence（从 DecisionEvidence + EventLog + Health delta）
  ↓   ├── 匹配 Attribution Rule
  ↓   ├── 计算 AttributionConfidence
  ↓   └── 生成 AttributionResult
  ↓ 更新 ExperienceRecord.attribution
  ↓ 标记为 FINALIZED
  ↓
  ↓ (A6.2 将消费 finalized ExperienceRecord → 写入 segment)
```

---

## 十二、关键结论

1. **DecisionTrace (A4.7) 是 A6.1 的唯一决策数据来源** — 不创建第二套
2. **evaluateWarOutcome / empireHealth / recoveryStats 是 A6.1 的唯一结果数据来源** — 不创建第二套
3. **EventLog 是 A6.1 的事件数据来源** — 只读消费
4. **不需要修改任何已有系统** — 只读消费 globalCache / Memory / EventLog
5. **不需要新增 observation hook** — 已有系统的产出已全部可见
6. **A6.1 存储全在 heap** — 不写 Memory 主体，不写 segment
7. **A6.1 系统走 safeRun + P3 + interval=100** — 不进 tick 热路径，Recovery 档全停
8. **Domain 层纯函数不引用 Game/Memory/RawMemory** — 完全可测试
9. **System 层只做采集和适配** — 不做决策，不执行 Game API
10. **A6.1 完全停止时帝国照常运行** — 所有系统是 shadow-only
