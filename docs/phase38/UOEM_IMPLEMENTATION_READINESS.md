# UOEM Implementation Readiness Check

> 日期：2026-08-26
> 阶段：IMPLEMENTATION READINESS CHECK（只读审计，零代码变更）
> 前置：Phase 38-B `ARCHITECTURE_READY_FOR_IMPLEMENTATION`

---

## 1. 当前真实代码状态

### 1.1 Operation Identity

**当前状态：无 operationId**

`Memory.kernel.expansion` 的类型定义（`global.d.ts:340-362`）：

```typescript
expansion?: {
  state: ExpansionExecutionState;
  target: string;
  sponsor: string;
  startedAt: number;        // ← 被状态机反复覆写（TMP-1）
  planId?: string;          // ← 旧版 Memory 可能缺失
  checkpointsPassed?: number;
  reservedEnergy?: number;
  consecutivePositiveTicks?: number;
  decisionId?: string;      // ← 由 collectExpansionDecisions 分配（heap Set 去重）
};
```

- `decisionId` 由 `collectExpansionDecisions`（decision-trace-system.ts:972）分配 `D-{tick}-{seq}`
- 去重依赖 `cache.processedExpansionPlanIds`（heap Set，:898），key = `planId ?? target+startedAt`
- **无 operationId 字段**——架构文档假设的 `op:{target}:{consumeTick}` 在代码中不存在

### 1.2 startedAt 覆写点

`expansion.startedAt` 在以下位置被覆写（共 9 处）：

| 位置 | 行号 | 代码 |
|---|---|---|
| tryConsumePlan | :194 | `startedAt: ctx.tick` |
| validating→preparing | :218 | `expansion.startedAt = ctx.tick` |
| preparing→claiming | :325 | `expansion.startedAt = ctx.tick` |
| claiming→claimed | :345 | `expansion.startedAt = ctx.tick` |
| claimed→bootstrapping | :233 | `expansion.startedAt = ctx.tick` |
| bootstrapping→economic_startup | :429 | `expansion.startedAt = ctx.tick` |
| bootstrapping timeout+spawn | :462 | `expansion.startedAt = ctx.tick` |
| economic_startup→integrating | :559 | `expansion.startedAt = ctx.tick` |
| economic_startup timeout+cp3 | :573 | `expansion.startedAt = ctx.tick` |

**确认 TMP-1：startedAt 不是 immutable lifecycle anchor。**

### 1.3 recordExpansionOutcome 调用点

`recordExpansionOutcome` 函数定义在 `:720`，内部做三件事：
1. `recordEvent(EventKind.ExpansionOutcome, ...)` — 写 eventLog
2. `globalCache().lastExpansionOutcome = {...}` — 覆盖单槽 heap
3. `appendOutcome(ring, kind, ringSize)` + `evaluateExpansionRhythm` — 写 rhythm ring + 派生 pause/blacklist

所有调用点：

| ID | 行号 | 调用者 | phase | outcome | 当前语义 | UOEM 分类 |
|---|---|---|---|---|---|---|
| P1 | :346 | advanceClaiming (claim success) | CLAIM(0) | SUCCESS(0) | Milestone — Operation 继续 | Milestone("CLAIMED") |
| P2 | :394 | advanceBootstrapping (lost vision) | PIONEER(1) | LOST(3) | Terminal — 后续 abortExpansion | Outcome(LOST) |
| P3 | :397 | advanceBootstrapping (stolen) | PIONEER(1) | STOLEN(1) | Terminal — 后续 abortExpansion | Outcome(STOLEN) |
| P4 | :447 | advanceBootstrapping (squad wiped) | PIONEER(1) | LOST(3) | Terminal — 后续 abortExpansion | Outcome(LOST) |
| P5 | :458 | advanceBootstrapping (timeout+spawn) | PIONEER(1) | TIMEOUT(2) | **Milestone** — 强推 economic_startup | Milestone("FORCED_ADVANCE") |
| P6 | :483 | advanceEconomicStartup (lost) | PIONEER(1) | LOST(3) | Terminal — 后续 abortExpansion | Outcome(LOST) |
| P7 | :571 | advanceEconomicStartup (timeout+cp3) | PIONEER(1) | SUCCESS(0) | **Milestone** — 强推 integrating | Milestone("FORCED_ADVANCE") |
| P8 | :661 | advanceIntegrating (CP5 passed) | PIONEER(1) | SUCCESS(0) | Terminal — completed | Outcome(COMPLETED) |
| P9 | :686 | advanceIntegrating (timeout+netFlow) | PIONEER(1) | SUCCESS(0) | Terminal — forced completed | Outcome(COMPLETED_FORCED) |
| A1-A6 | :704 | abortExpansion (统一清理) | phase | outcome | Terminal | Outcome(同参数) |

**配对双写路径（P→A）：**
- P2→A6: record(LOST) + abort(LOST) — 同 outcome，无冲突
- P3→A6: record(STOLEN) + abort(LOST) — 不同 outcome，first-wins(STOLEN)
- P4→A6: record(LOST) + abort(LOST) — 同 outcome，无冲突
- P5→无 abort: record(TIMEOUT) + state推进 — milestone（不进 channel）
- P6→A6: record(LOST) + abort(LOST) — 同 outcome
- P7→无 abort: record(SUCCESS) + state推进 — milestone（不进 channel）

**Bootstrap lane（:895）：** `recordEvent(EventKind.ExpansionOutcome, d.room, [1, 4, 0])` — 不走 recordExpansionOutcome，直接写 eventLog。Phase=PIONEER(1), outcome=ABORTED(4), duration=0。

### 1.4 lastExpansionOutcome 消费

`globalCache().lastExpansionOutcome`（global-cache.ts:341-356）：

```typescript
lastExpansionOutcome?: {
  target: string;
  outcomeCode: number;
  completedTick: number;
  duration: number;        // ← tick - expansion.startedAt（被覆写的 startedAt）
  startedAt: number;       // ← 最后一次状态转换的 tick
  decisionId?: string;     // ← 从 expansion.decisionId 读取
};
```

**消费者：** `experience-collector-system.ts:413-455`（buildOutcomeCollectionInput case "expansion"）

匹配策略：
1. decisionId 优先：`lastOutcome.decisionId === exp.decision.decisionId`
2. fallback：`lastOutcome.target === expTargetRoom && lastOutcome.completedTick > exp.decision.decisionTick`

### 1.5 rhythm ring

`Memory.kernel.expansionRhythm`（memory.ts:780-820）：
- `ring: number[]` — `kindToCode` 后的数字数组
- `blacklistMultiplier: number`
- `minSources: number`

**写入：** `recordExpansionOutcome:743-758` → `appendOutcome` + `evaluateExpansionRhythm`
**读取：** `expansion-manager.ts:101`（expansionPausedUntil）、`:807`（blacklistMultiplier）

---

## 2. Architecture 文档与代码一致性

### 2.1 一致项

| 架构文档假设 | 代码实际 | 一致？ |
|---|---|---|
| rhythm ring 存储 ExpansionOutcomeKind 序列 | `Memory.kernel.expansionRhythm.ring: number[]` + `appendOutcome` | ✅ |
| ring cap=8 | `CONFIG.expansion.rhythm.ringSize` → 检查 config | ✅ |
| lastExpansionOutcome 单槽 latest-wins | `globalCache().lastExpansionOutcome = {...}` 覆盖 | ✅ |
| P1 claim success → `toOutcomeKind(0,0)` returns undefined → 不进 ring | `:783-784` `if (phase===0 && outcome===0) return undefined` | ✅ |
| P5 timeout+spawn → milestone | `:458` record + `:461` state推进 | ✅ |
| P7 timeout+cp3 → milestone | `:571` record + `:572` state推进 | ✅ |
| decisionId 由 collectExpansionDecisions 分配 | `:972 makeDecisionId(tick, ++cache.seq)` | ✅ |
| decisionId 写入 Memory.kernel.expansion.decisionId | `:999-1002` | ✅ |
| startedAt 被 9 处覆写 | 9 处确认 | ✅ |
| A6.1-A6.6 domain 纯函数不依赖 Game/Memory | outcome.ts/attribution.ts/experience.ts 无 import Game/Memory | ✅ |

### 2.2 不一致项

| 架构文档假设 | 代码实际 | 冲突？ |
|---|---|---|
| operationId = `op:{target}:{consumeTick}` | **代码中不存在 operationId** | ❌ ARCHITECTURE_GAP |
| OutcomeChannel in Memory | **代码中不存在 OutcomeChannel** | ❌ ARCHITECTURE_GAP |
| interval.openedAt immutable | **代码中不存在 interval.openedAt** | ❌ ARCHITECTURE_GAP |
| forcedAdvance 持久化到 Memory | **代码中不存在 forcedAdvance 字段** | ❌ ARCHITECTURE_GAP |
| MilestoneEvent 类型 | **代码中不存在 MilestoneEvent** | ❌ ARCHITECTURE_GAP |
| OutcomeEvent 类型 | **代码中不存在 OutcomeEvent** | ❌ ARCHITECTURE_GAP |

**裁决：ARCHITECTURE_CONSISTENT**

所有不一致项都是 "架构文档定义了新概念，代码尚未实现" —— 这是 Implementation 阶段要创建的，不是冲突。架构文档没有声称这些已存在。

---

## 3. Producer Matrix

| ID | 行号 | 调用者函数 | phase | outcome | 当前语义 | UOEM Event | Terminal? | Operation 继续？ |
|---|---|---|---|---|---|---|---|---|
| P1 | :346 | advanceClaiming | CLAIM | SUCCESS | Milestone (state→claimed) | Milestone("CLAIMED") | ❌ | ✅ |
| P2 | :394 | advanceBootstrapping (lost vision) | PIONEER | LOST | Terminal (→abort) | Outcome(LOST) | ✅ | ❌ |
| P3 | :397 | advanceBootstrapping (stolen) | PIONEER | STOLEN | Terminal (→abort) | Outcome(STOLEN) | ✅ | ❌ |
| P4 | :447 | advanceBootstrapping (squad wiped) | PIONEER | LOST | Terminal (→abort) | Outcome(LOST) | ✅ | ❌ |
| P5 | :458 | advanceBootstrapping (timeout+spawn) | PIONEER | TIMEOUT | **Milestone** (state→economic_startup) | Milestone("FORCED_ADVANCE") | ❌ | ✅ |
| P6 | :483 | advanceEconomicStartup (lost) | PIONEER | LOST | Terminal (→abort) | Outcome(LOST) | ✅ | ❌ |
| P7 | :571 | advanceEconomicStartup (timeout+cp3) | PIONEER | SUCCESS | **Milestone** (state→integrating) | Milestone("FORCED_ADVANCE") | ❌ | ✅ |
| P8 | :661 | advanceIntegrating (CP5 passed) | PIONEER | SUCCESS | Terminal (completed) | Outcome(COMPLETED) | ✅ | ❌ |
| P9 | :686 | advanceIntegrating (timeout+netFlow) | PIONEER | SUCCESS | Terminal (forced completed) | Outcome(COMPLETED_FORCED) | ✅ | ❌ |
| A1 | :704 | abortExpansion | claim/pioneer | 参数传入 | Terminal | Outcome(同参数) | ✅ | ❌ |
| B1 | :895 | runBootstrapLane | PIONEER | ABORTED | Terminal (abandon) | Outcome(ABANDONED) | ✅ | ❌ |

**总计：11 个 producer 调用点。**
- **Milestone: 3** (P1, P5, P7) — 不进 OutcomeChannel
- **Terminal: 8** (P2, P3, P4, P6, P8, P9, A1, B1) — 进 OutcomeChannel

**配对双写：**
- P2→A1: LOST+LOST → 幂等（同 outcome）
- P3→A1: STOLEN+LOST → first-wins (STOLEN)
- P4→A1: LOST+LOST → 幂等
- P6→A1: LOST+LOST → 幂等

---

## 4. Consumer Matrix

| # | Consumer | 文件 | 当前读取 | UOEM 后读取 | 是否修改？ |
|---|---|---|---|---|---|
| C1 | rhythm ring (appendOutcome) | expansion-manager.ts:743 | recordExpansionOutcome → toOutcomeKind | 只在 terminal 路径调用 appendOutcome | ✅ 修改 producer 逻辑 |
| C2 | rhythm ring (evaluate) | expansion-manager.ts:748 | ring 数组 | 不变（ring 只收 terminal） | ❌ 不修改 |
| C3 | expansionPausedUntil | expansion-manager.ts:101 | rhythm result.pauseTicks | 不变 | ❌ 不修改 |
| C4 | expansionBlacklist | expansion-manager.ts:807 | rhythm result.blacklistMultiplier | 不变 | ❌ 不修改 |
| C5 | lastExpansionOutcome | global-cache.ts:341 | recordExpansionOutcome 覆盖 | OutcomeChannel.drain() | ✅ 修改为 channel |
| C6 | experience-collector (outcome) | experience-collector-system.ts:413 | lastExpansionOutcome | OutcomeChannel.drain() | ✅ 修改读取源 |
| C7 | experience-collector (attribution) | experience-collector-system.ts:523 | exp.outcome (已 attach) | 不变 | ❌ 不修改 |
| C8 | collectExpansionOutcome (domain) | outcome.ts:330 | OutcomeCollectionInput | 不变 | ❌ 不修改 (domain) |
| C9 | collectExpansionAttribution (domain) | attribution.ts:669 | AttributionInput | 不变 | ❌ 不修改 (domain) |
| C10 | eventLog (recordEvent) | event-log.ts:211 | recordExpansionOutcome:721 | 终态路径保留 recordEvent | ❌ 不修改 |
| C11 | telemetry-collector | telemetry-collector.ts | eventBuffer | 不变 | ❌ 不修改 |
| C12 | recovery-execution-system | recovery-execution-system.ts:462 | expansionPausedUntil | 不变 | ❌ 不修改 |
| C13 | A6.4 Calibration | calibration.ts | ResolutionResult[] | 不变 | ❌ 不修改 (domain) |
| C14 | A6.2 Prediction | prediction/ | Prediction+actualValue | 不变 | ❌ 不修改 (domain) |
| C15 | A6.5 Reliability | reliability/ | ResolutionResult[] | 不变 | ❌ 不修改 (domain) |
| C16 | A6.6 Recommendation | recommendation/ | Experience[]+CalibrationProfile[] | 不变 | ❌ 不修改 (domain) |
| C17 | minSources 门禁 | expansion-manager.ts | rhythm result.minSources | 不变 | ❌ 不修改 |
| C18 | lastExpansionCompletedTick | expansion-manager.ts:664 | 终态后直接写 | 不变（只在 terminal 写） | ❌ 不修改 |

**需修改消费者：3 个（C1, C5, C6）—— 全部在 system/adapter 层。**
**不修改消费者：15 个——含全部 A6 domain 层。**

---

## 5. Identity Flow

```
Plan (expansionPlans[])
  └── planId (Memory 持久)
       ↓ tryConsumePlan
  Operation (Memory.kernel.expansion)
  ├── 当前：无 operationId ← 需新增
  ├── 当前：decisionId (heap 分配，Memory 持久) ← 不稳定（reset 后 heap Set 丢失→重建）
  ├── 当前：planId (Memory 持久) ← 可能缺失
  ├── 当前：target + startedAt ← 非唯一
  └── 当前：state ← 随状态机变化

UOEM 后：
  Operation (Memory.kernel.expansion)
  ├── operationId = `op:{target}:{consumeTick}` ← 新增，consume 时铸造
  ├── interval.openedAt = consume tick ← 新增，immutable
  ├── forcedAdvance: boolean ← 新增
  ├── decisionId ← 保留（从 DecisionTrace 写入）
  ├── planId ← 保留
  ├── target ← 保留
  ├── startedAt ← 保留但不再用于 duration 计算
  └── state ← 保留
```

**Identity Authority：**
- 当前：heap `processedExpansionPlanIds` Set（reset 后丢失）+ `planId ?? target+startedAt`
- UOEM 后：`Memory.kernel.expansion.operationId`（reset 后幸存）

---

## 6. Outcome Flow

```
当前：
  recordExpansionOutcome()
    → recordEvent() → eventBuffer → telemetry → segment 2
    → globalCache().lastExpansionOutcome = {...} (单槽覆盖)
    → appendOutcome(ring) + evaluateExpansionRhythm() → pause/blacklist/minSources
    ↓
  experience-collector buildOutcomeCollectionInput case "expansion"
    → 读 globalCache().lastExpansionOutcome
    → 匹配 decisionId 或 fallback target+completedTick
    → collectOutcome(input) → OutcomeRecord
    → attachOutcome(exp, outcome)
    ↓
  collectAttribution(input) → Attribution
    → finalizeExperience(exp)

UOEM 后：
  terminal producer
    → OutcomeChannel.enqueue(OutcomeEvent) (Memory, cap=32, FIFO, 幂等)
    → recordEvent() (保留 eventLog)
    → appendOutcome(ring) + evaluateExpansionRhythm() (只 terminal)
    ↓
  milestone producer
    → MilestoneEvent (heap, 不进 channel)
    → forcedAdvance 标志持久化到 Memory
    ↓
  experience-collector collectPendingOutcomes
    → OutcomeChannel.drain() → 获取 terminal OutcomeEvent[]
    → 按 operationId 匹配 pending Experience
    → collectOutcome(input) → OutcomeRecord (不变)
    → attachOutcome(exp, outcome)
```

---

## 7. Milestone Flow

```
当前：
  P1/P5/P7 → recordExpansionOutcome(...)
    → recordEvent (eventLog — 所有调用都记录)
    → globalCache().lastExpansionOutcome = {...} (覆盖！← EXP-1)
    → appendOutcome(ring) + evaluate (混入 ring！← B1)

UOEM 后：
  P1/P5/P7 → emitMilestone(MilestoneEvent)
    → 不写 OutcomeChannel
    → 不写 lastExpansionOutcome
    → 不进 rhythm ring
    → forcedAdvance 标志更新 (P5/P7)
    → 可选：recordEvent (eventLog 保留)
```

---

## 8. Reset Flow

```
当前：
  global reset → heap cleared
  Memory survives: { expansion: { state, target, startedAt, planId, decisionId } }
  heap lost: processedExpansionPlanIds (Set), lastExpansionOutcome, __experienceCache

  reset 后：
  - decision-trace 重建 → collectExpansionDecisions → dedupKey = planId ?? target+startedAt
  - 如果 startedAt 被覆写（大概率）→ dedupKey 变化 → 重建 decisionId → EXP-2
  - lastExpansionOutcome 丢失 → collector 无法匹配 → UNRESOLVED

UOEM 后：
  global reset → heap cleared
  Memory survives: { expansion: { operationId, interval.openedAt, forcedAdvance, decisionId, ... } }
  Memory survives: { outcomeEvents: OutcomeChannel (cap=32) }

  reset 后：
  - operationId 在 Memory 中 → 不重建
  - OutcomeChannel 在 Memory 中 → terminal outcome 不丢
  - collector 重建 Experience → drain channel → attach outcome
  - forcedAdvance 在 Memory 中 → 恢复
```

---

## 9. BEFORE / AFTER Flow

```
当前：
  BEFORE = DecisionRecord.evidence (collectExpansionDecisions 采集)
    → extractMetricsFromEvidence 在 ExperienceContext 构建时冻结 ← 正确

  AFTER = buildOutcomeCollectionInput 采集当前 globalCache 状态
    → recovery: recoveryStats (终身累计 ← A6-R)
    → logistics: logisticsLevelBefore = "stable" 硬编码 ← A6-SL
    → spawn: 全部取自 BEFORE metrics ← A6-SL
    → expansion: lastExpansionOutcome (可能被 milestone 覆盖 ← EXP-1)

UOEM 后：
  BEFORE = 不变（DecisionRecord 采集时冻结）

  AFTER = producer 在终态时采集
    → recovery: delta (after - before) ← A6-R 修复
    → logistics: 终态时刻 logisticsHealth ← A6-SL 修复
    → spawn: 终态时刻 spawn metrics ← A6-SL 修复
    → expansion: OutcomeEvent 携带 terminal outcome ← EXP-1 修复
```

---

## 10. 六项问题逐项映射

### EXP-1: Premature SUCCESS

| 属性 | 当前 | UOEM 后 |
|---|---|---|
| 根因 | P1/P5/P7 调用 recordExpansionOutcome → 覆盖 lastExpansionOutcome | P1/P5/P7 改为 emitMilestone → 不写 channel |
| 影响 | collector 读到 milestone 误当 terminal → Experience FINALIZED 错误 | collector 只 drain terminal → pending 继续 |
| 修改文件 | expansion-manager.ts | expansion-manager.ts + experience-collector-system.ts |
| 测试 | T1-T4 | T1-T4 保留 + T6-T7 新增 |

### EXP-2: Reset Identity Loss

| 属性 | 当前 | UOEM 后 |
|---|---|---|
| 根因 | dedupKey = planId ?? target+startedAt，startedAt 被覆写 → reset 后重建 decisionId | operationId 在 consume 时铸造，Memory 持久 |
| 影响 | 同一 Operation 被重建为新 identity | operationId 不变 → 不重建 |
| 修改文件 | decision-trace-system.ts + expansion-manager.ts + global.d.ts | 新增 operationId 字段 + 修改 dedupKey |
| 测试 | T5 | T5-T7 |

### TMP-1: Mutable startedAt

| 属性 | 当前 | UOEM 后 |
|---|---|---|
| 根因 | startedAt 被 9 处覆写 | interval.openedAt 铸造后不变 |
| 影响 | duration = tick - startedAt 错误 | duration = closedAt - openedAt 正确 |
| 修改文件 | expansion-manager.ts + global.d.ts | 新增 interval.openedAt + 不再覆写 |
| 测试 | T8-T10 |

### A6-R: Lifetime Aggregate

| 属性 | 当前 | UOEM 后 |
|---|---|---|
| 根因 | recoveryStats 终身累计 → collectRecoveryOutcome 用累计值 | delta = after - before → 用增量 |
| 影响 | 单个决策继承历史平均 | Individual outcome 独立 |
| 修改文件 | experience-collector-system.ts (system 层) | buildOutcomeCollectionInput 使用 delta |
| 测试 | T11-T12 |

### A6-SL: BEFORE/AFTER Misclassification

| 属性 | 当前 | UOEM 后 |
|---|---|---|
| 根因 | logistics before 硬编码 "stable"，spawn before=after | producer 在终态采集 after |
| 影响 | logistics/spawn Experience 错误归类 | PairedObservation 强制双端点 |
| 修改文件 | experience-collector-system.ts (system 层) | buildOutcomeCollectionInput case logistics/spawn |
| 测试 | T13-T15 |

### TIMEOUT-SEMANTICS

| 属性 | 当前 | UOEM 后 |
|---|---|---|
| 根因 | P5/P7 timeout/forced-success 混入 outcome channel | MilestoneEvent vs OutcomeEvent 分离 |
| 影响 | milestone 被当 terminal | milestone 不进 channel |
| 修改文件 | expansion-manager.ts | P5/P7 改为 emitMilestone |
| 测试 | T16-T18 |

---

## 11. 预计修改文件

| 文件 | 修改内容 | 层级 |
|---|---|---|
| `src/types/global.d.ts` | 新增 `operationId`, `interval.openedAt`, `forcedAdvance` 到 ExpansionState；新增 `outcomeEvents` 到 KernelMemory | 类型 |
| `src/kernel/memory.ts` | 新增 outcomeEvents 迁移 + 畸形自愈 | 迁移 |
| `src/kernel/global-cache.ts` | 新增 OutcomeChannel 类型定义（或独立文件） | kernel |
| `src/systems/expansion-manager.ts` | tryConsumePlan 铸造 operationId + openedAt；P1/P5/P7 改为 milestone；P2-P4/P6/P8/P9/A1/B1 改为 enqueue OutcomeEvent | system |
| `src/systems/intelligence/experience-collector-system.ts` | buildOutcomeCollectionInput 从 channel.drain() 读取；recovery/logistics/spawn 使用 delta + after 采集 | system |
| `src/systems/decision-trace-system.ts` | collectExpansionDecisions dedupKey 改为 operationId | system |

**新增文件：**

| 文件 | 内容 | 层级 |
|---|---|---|
| `src/kernel/outcome-channel.ts` | OutcomeChannel 实现（enqueue/drain/peek/size + 幂等 + FIFO + cap=32） | kernel |
| `src/domain/expansion/uoem-types.ts` | MilestoneEvent / OutcomeEvent / ExpansionResult 类型定义 | domain |
| `tests/unit/phase38/uoem-implementation.test.ts` | T1-T30 全量测试 | test |

---

## 12. 明确"不修改"的文件

| 文件 | 理由 |
|---|---|
| `src/domain/intelligence/outcome.ts` | A6.1 domain 层纯函数 — 冻结 |
| `src/domain/intelligence/attribution.ts` | A6.1 domain 层纯函数 — 冻结 |
| `src/domain/intelligence/experience.ts` | A6.1 domain 层纯函数 — 冻结 |
| `src/domain/intelligence/prediction/*` | A6.2-A6.3 domain — 冻结 |
| `src/domain/intelligence/calibration/*` | A6.4 domain — 冻结 |
| `src/domain/intelligence/reliability/*` | A6.5 domain — 冻结 |
| `src/domain/intelligence/recommendation/*` | A6.6 domain — 冻结 |
| `src/domain/expansion/rhythm.ts` | rhythm ring 纯函数 — 不需修改 |
| `src/kernel/event-log.ts` | eventLog 不变 |
| `src/systems/recovery-execution-system.ts` | 只读 expansionPausedUntil — 不变 |
| `src/systems/telemetry-collector.ts` | 只读 eventBuffer — 不变 |

---

## 13. 风险

| # | 风险 | 严重性 | 缓解 |
|---|---|---|---|
| R1 | OutcomeChannel 存 Memory 增加 ~3KB | LOW | 32×100B，远低于 2MB 上限 |
| R2 | rhythm ring 不再收到 P5/P7 → consecutiveFailures 语义变化 | LOW | 更正确（中间强推不应重置计数），rhythm.ts 不修改 |
| R3 | 配对双写 P3→A1 幂等 first-wins(STOLEN) vs 之前 last-wins(LOST) | LOW | STOLEN 更精确，stolen count 增加（更正确） |
| R4 | collectExpansionDecisions dedupKey 改为 operationId | MEDIUM | 需要确保 consume 时 operationId 已铸造 |
| R5 | experience-collector 从 drain() 读取需匹配 operationId | MEDIUM | DecisionRecord 需携带 operationId（从 Memory.expansion 读取） |
| R6 | A6-SL 的 after 采集需要 producer 在终态时执行 | MEDIUM | producer 已在终态调用，添加 after 采集 |
| R7 | Memory schema 升级需迁移 | LOW | memory.ts 幂等迁移，先写新字段验证后删旧 |

---

## 14. Blocker

| # | Blocker | 状态 | 解决方案 |
|---|---|---|---|
| BLK-1 | operationId 不存在于代码中 | 确认 | STEP 2 新增 |
| BLK-2 | OutcomeChannel 不存在于代码中 | 确认 | STEP 3 新增 |
| BLK-3 | interval.openedAt 不存在于代码中 | 确认 | STEP 2 新增 |
| BLK-4 | forcedAdvance 不存在于 Memory | 确认 | STEP 2 新增 |
| BLK-5 | MilestoneEvent/OutcomeEvent 类型不存在 | 确认 | STEP 1 新增 |

**无 ARCHITECTURE_CONFLICT。** 所有 blocker 都是 "待实现的新概念"，不是架构与代码的矛盾。

---

## 15. Implementation Plan

| Step | 内容 | 文件 | 依赖 |
|---|---|---|---|
| STEP 1 | UOEM types / contracts | `src/domain/expansion/uoem-types.ts` + `src/types/global.d.ts` | 无 |
| STEP 2 | Operation Identity / immutable openedAt | `src/systems/expansion-manager.ts` (tryConsumePlan) + `src/types/global.d.ts` | STEP 1 |
| STEP 3 | OutcomeChannel 实现 | `src/kernel/outcome-channel.ts` + `src/kernel/memory.ts` + `src/kernel/global-cache.ts` | STEP 1 |
| STEP 4 | Milestone / Outcome 分离 | `src/systems/expansion-manager.ts` (recordExpansionOutcome 拆分) | STEP 1-3 |
| STEP 5 | 迁移 expansion-manager producers | `src/systems/expansion-manager.ts` (P1-P9/A1/B1) | STEP 4 |
| STEP 6 | 迁移 Experience Collector | `src/systems/intelligence/experience-collector-system.ts` | STEP 5 |
| STEP 7 | BEFORE/AFTER PairedObservation | `src/systems/intelligence/experience-collector-system.ts` (logistics/spawn/recovery) | STEP 6 |
| STEP 8 | A6-R individual outcome attribution | `src/systems/intelligence/experience-collector-system.ts` (recovery delta) | STEP 7 |
| STEP 9 | 清理 lastExpansionOutcome 依赖 | `src/kernel/global-cache.ts` + `src/systems/expansion-manager.ts` | STEP 6 |
| STEP 10 | 检查 rhythm ring compatibility | 验证（不修改 rhythm.ts） | STEP 5 |
| STEP 11 | 全量测试 | `tests/unit/phase38/uoem-implementation.test.ts` T1-T30 | STEP 1-10 |
| STEP 12 | Architecture Closure Audit | `docs/phase38/UOEM_IMPLEMENTATION_AUDIT.md` | STEP 11 |

---

## 16. 裁决

### ARCHITECTURE_CONSISTENT
### IMPLEMENTATION_READY

**依据：**
1. 架构文档与真实代码无冲突——所有不一致都是 "新概念待实现"
2. 18 个消费者已完整清点，只需修改 3 个（全在 system 层）
3. 11 个 producer 调用点已完整分类
4. A6.1-A6.6 domain 层全部不需要修改
5. 六类问题逐项有明确消解路径
6. 风险全部 LOW-MEDIUM，无不可解 Blocker
7. Memory bounded（channel ≤3.2KB）
8. Reset safety 可靠（operationId + channel 在 Memory）

**进入代码实施阶段。**
