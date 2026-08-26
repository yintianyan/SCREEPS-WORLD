# UOEM STEP 1.3 — Semantic Proof

**日期：** 2026-08-26  
**阶段：** Phase 38 — UOEM STEP 1.3  
**性质：** DESIGN / PROOF ONLY — 无代码修改

---

## 1. EXP-1: Premature SUCCESS

### 问题描述

claim success (`P1`) 产出 `OUTCOME_SUCCESS`，但 Operation 继续运行。如果 consumer 读取 `lastExpansionOutcome` 时看到 SUCCESS，会错误地把 P1 当作 terminal SUCCESS。

### 真实代码证明

**P1 调用链：**
```
advanceClaiming (line 343-348):
  targetRoom.controller.my → true
  expansion.state = "claimed"
  expansion.startedAt = ctx.tick         ← 状态转换覆盖
  recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_SUCCESS)
```

**recordExpansionOutcome 内部：**
```
line 730: globalCache().lastExpansionOutcome = {
  target, outcomeCode: 0 (SUCCESS), completedTick, duration, startedAt, decisionId
}
→ 无条件写入 lastExpansionOutcome，即使 Operation 继续运行

line 739: const kind = toOutcomeKind(PHASE_CLAIM, OUTCOME_SUCCESS)
line 784: if (phase === 0 && outcome === 0) return undefined
line 740: if (!kind) return
→ kind = undefined → 不进 rhythm ring ✅
但 lastExpansionOutcome 已被写入 ❌
```

**experience-collector 读取：**
```
line 422: const lastOutcome = g.lastExpansionOutcome
line 429: const decisionIdMatch = lastOutcome.decisionId === exp.decision.decisionId
line 435: if (lastOutcome && (decisionIdMatch || fallbackMatch))
line 440: input.expansionOutcome = phaseCode * 10 + lastOutcome.outcomeCode
→ 如果在 P1 之后、P8 之前读取，会注入 expansionOutcome = 10 (SUCCESS)
→ collectExpansionOutcome 会分类为 "SUCCESS"
→ 但这不是 terminal outcome！
```

### UOEM 修复证明

**UOEM 映射：**
- P1 → `MilestoneEvent { kind: "milestone", milestoneKind: "CLAIMED" }`
- P1 **不进入** OutcomeChannel（类型系统阻止）
- P1 **不覆盖** terminal outcome

**如果 collector 读取 OutcomeChannel：**
- OutcomeChannel 只包含 terminal OutcomeEvent
- P1 产出 MilestoneEvent → `extractOutcomeIfTerminal(milestone) = undefined`
- Channel 中不会有 P1 的 SUCCESS
- Collector 不会误读 P1 为 terminal SUCCESS

**结论：EXP-1 在 UOEM 中结构性消除。** ✅

---

## 2. EXP-2: Global Reset operationId

### 问题描述

global reset 后 heap 清空，`processedExpansionPlanIds` Set 丢失，但 `Memory.kernel.expansion` 保留。`collectExpansionDecisions` 会为同一 Operation 生成新的 `decisionId`。

### 真实代码证明

**reset 前状态：**
```
Memory.kernel.expansion = { target: "W1N1", startedAt: 5000, decisionId: "D-5000-1", ... }
globalCache().__decisionTraceCache.processedExpansionPlanIds = Set { "expansion:W1N1:5000" }
```

**global reset 后：**
```
Memory.kernel.expansion = { target: "W1N1", startedAt: 8000 (被覆盖), decisionId: "D-5000-1", ... }
  ↑ Memory 保留，startedAt 已被状态转换覆盖
globalCache().__decisionTraceCache = undefined
  ↑ heap 清空
```

**decision-trace 下一 tick：**
```
line 80-87: if (!g.__decisionTraceCache) → 重新初始化
  processedExpansionPlanIds = new Set()  ← 空 Set

line 888: collectExpansionDecisions(ctx, cache, tick)
line 893: mem = Memory.kernel.expansion → 存在
line 897: dedupKey = mem.planId ?? `expansion:${mem.target}:${mem.startedAt}`
  → dedupKey = "expansion:W1N1:8000" (用被覆盖的 startedAt)
line 898: cache.processedExpansionPlanIds.has(dedupKey) → false (新 Set)
line 972: decisionId = makeDecisionId(tick, ++cache.seq) → "D-15000-1" (新 ID)
line 1001: expMem.decisionId = decisionId → 覆盖旧值
```

**结果：** 同一 Operation 获得新的 `decisionId`。旧 `lastExpansionOutcome.decisionId` 与新 `expansion.decisionId` 不匹配。但 `lastExpansionOutcome` 也是 heap-only，reset 后也丢失——所以不会发生错误匹配。

### UOEM 修复证明

**UOEM operationId 设计：**
```
operationId = createOperationId(target, consumeTick)
格式: op:{target}:{consumeTick}
```

- **确定性：** 相同输入 → 相同输出
- **不依赖 heap：** 不引用 Set/Map/seq counter
- **不依赖 startedAt：** consumeTick 是 Operation 创建时的 tick，不被状态转换覆盖

**但当前 Runtime 没有保存 consumeTick！** `startedAt` 被反复覆盖，原始 consume tick 丢失。

**STEP 2 需要做的：**
1. 在 `tryConsumePlan` 中引入 `Memory.kernel.expansion.openedAt`（初始 `ctx.tick`，永不修改）
2. `operationId = createOperationId(target, openedAt)`
3. reset 后，从 Memory 恢复的 `openedAt` 可以重新推导出相同的 `operationId`

**结论：** UOEM operationId 设计正确，但需要 STEP 2 引入 `openedAt` 字段。当前 Runtime 无法提供稳定 operationId。 ✅ (design proven, implementation deferred)

---

## 3. TMP-1: startedAt Mutation

### 问题描述

`expansion.startedAt` 在每次状态转换时被覆盖。`recordExpansionOutcome` 使用 `tick - expansion.startedAt` 计算 duration，只反映最后一个状态的持续时间，不是整个 Operation 的持续时间。

### startedAt Mutation Matrix

| # | 行号 | 上下文 | startedAt = | 影响 |
|---|------|--------|-------------|------|
| M1 | 194 | tryConsumePlan | ctx.tick | 初始值 |
| M2 | 218 | validating→preparing | ctx.tick | 覆盖 |
| M3 | 233 | claimed→bootstrapping | ctx.tick | 覆盖 |
| M4 | 325 | preparing→claiming | ctx.tick | 覆盖 |
| M5 | 345 | claiming→claimed | ctx.tick | 覆盖 |
| M6 | 429 | bootstrapping→economic_startup (CP2) | ctx.tick | 覆盖 |
| M7 | 462 | bootstrapping timeout→economic_startup | ctx.tick | 覆盖（强推） |
| M8 | 559 | economic_startup→integrating | ctx.tick | 覆盖 |
| M9 | 573 | economic_startup timeout→integrating | ctx.tick | 覆盖（强推） |

### duration 计算的当前行为

```typescript
// recordExpansionOutcome line 724, 734:
duration: tick - expansion.startedAt  // 只反映最后一段状态
```

例如：
- Operation 在 tick 1000 开始（M1: startedAt=1000）
- tick 5000 时 claiming→claimed（M5: startedAt=5000）
- tick 8000 时 integrating→completed（P8: duration = 8000-5000 = 3000）
- 实际 Operation 持续了 7000 tick，但 duration 只报告 3000

### UOEM 修复证明

```
UOEM OperationInterval:
  openedAt: Operation 创建 tick（immutable, 永不覆盖）
  closedAt: terminal tick（只设置一次）

UOEM computeDuration(interval) = closedAt - openedAt
  → 反映完整 Operation 持续时间

不读取 expansion.startedAt
即使 expansion-manager 修改 startedAt 9 次，
UOEM interval.openedAt 不受影响。
```

**结论：TMP-1 在 UOEM 中结构性消除。** ✅

---

## 4. A6-R: Lifetime Aggregate vs Current Operation Outcome

### 问题描述

`recoveryStats` 包含 lifetime aggregate（succeededCount, failedCount），可能被误用作 current operation outcome。

### 真实代码分析

**recoveryStats 结构：**
```typescript
RecoveryStats = {
  succeededCount: number,  // lifetime aggregate
  failedCount: number,    // lifetime aggregate
  terminalCount: number, // lifetime aggregate
  avgRecoveryTime: number // lifetime aggregate
}
```

**使用点：**

1. `experience-collector-system.ts` line 371-374:
   ```typescript
   input.recoverySucceeded = recoveryStats.succeededCount;
   input.recoveryFailed = recoveryStats.failedCount;
   ```
   → 注入 lifetime aggregate 到 OutcomeCollectionInput

2. `outcome.ts` `collectRecoveryOutcome`:
   ```typescript
   // line 211-213:
   metric: "recoverySuccessRate",
   source: "recoveryStats",
   // 使用 succeededCount / (succeeded + failed) 作为成功率
   ```
   → 这是 **lifetime** 成功率，不是 **per-operation** 成功率

### UOEM 证明

```
UOEM OutcomeEvent:
  outcomeCode: TerminalOutcomeCode (SUCCESS/STOLEN/TIMED_OUT/LOST/ABANDONED)
  interval: OperationInterval (openedAt, closedAt)
  duration: closedAt - openedAt

UOEM 不使用 lifetime aggregate。
UOEM 的 outcomeCode 是 per-operation 的终态码。
UOEM 的 duration 是 per-operation 的持续时间。

before/after 模型:
  before = openedAt 时的 World State
  after = closedAt 时的 World State
  delta = after - before
  delta 不跨 operation（因为 openedAt/closedAt 属于同一 operationId）
```

**但 recoveryStats 当前确实被用作 per-experience outcome 评估。** 这是 A6.1 domain 的现有设计，UOEM 不修改 A6.1-A6.6。

**结论：** UOEM 不使用 lifetime aggregate，但 A6.1 的 `collectRecoveryOutcome` 当前使用 lifetime aggregate 作为 recovery outcome metric。这属于 A6.1 domain 的设计选择，不是 UOEM 能修复的问题。UOEM 不引入新的 aggregate misuse。 ✅ (UOEM clean, A6.1 existing design preserved)

---

## 5. A6-SL: Before/After Observation Pair

### 问题描述

before/after observation 需要属于同一个 operation。如果 before 来自 operation A，after 来自 operation B，delta 就是错误的。

### 真实代码分析

**当前 before/after 来源：**

| Domain | Before | After | Identity |
|--------|--------|-------|----------|
| Economy | `healthLevelBefore` (DecisionRecord evidence) | `healthLevelAfter` (current snapshot) | `decisionId` |
| Logistics | `logisticsLevelBefore` (DecisionRecord evidence) | `logisticsLevelAfter` (current) | `decisionId` |
| Spawn | `spawnQueueLength` (before from DecisionRecord) | `spawnQueueLength` (after from current) | `decisionId` |
| Recovery | `recoverySucceeded/Failed` (lifetime aggregate) | same | `decisionId` |
| Defense | `threatLevelBefore` (DecisionRecord) | `threatLevelAfter` (current) | `decisionId` |
| Expansion | `lastExpansionOutcome` (single-slot) | n/a | `decisionId` |

### 关键发现

**所有 before/after 都通过 `decisionId` 关联。** `decisionId` 由 `collectExpansionDecisions` 在 Operation 开始时分配，`recordExpansionOutcome` 读取并写入 `lastExpansionOutcome.decisionId`，experience-collector 用 `exp.decision.decisionId === lastOutcome.decisionId` 匹配。

**但 EXP-2 证明了 decisionId 在 global reset 后会重新生成！** 如果：
1. Operation A 在 tick 1000 开始，decisionId = "D-1000-1"
2. Global reset
3. `collectExpansionDecisions` 为同一 Operation 生成新 decisionId = "D-2000-1"
4. `lastExpansionOutcome`（heap）也丢失了

所以 reset 后，旧 ExperienceRecord 的 `decisionId = "D-1000-1"` 不会被匹配到新的 `lastExpansionOutcome.decisionId = "D-2000-1"`。但 `lastExpansionOutcome` 也丢失了，所以不会发生跨 operation 匹配。

### UOEM 修复证明

```
UOEM OutcomeEvent:
  operationId: stable, deterministic, not affected by reset
  decisionId: attribution identity (optional)

before/after 属于同一个 operationId
delta = after - before
  before observation: openedAt 时的 World State
  after observation: closedAt 时的 World State
  两者通过 operationId 关联

operationId 不依赖 heap state → reset 后保持稳定
```

**结论：** UOEM 通过 stable operationId 保证 before/after 属于同一 operation。 ✅ (design proven, requires STEP 2 openedAt field)

---

## 6. TIMEOUT-SEMANTICS

### 问题描述

TIMEOUT 不等于 terminality。timeout 可以是 milestone（P5）或 terminal（P10 with OUTCOME_TIMEOUT）。

### 真实代码分析

| Producer | outcomeCode | State after | Terminal? | Reason |
|----------|-------------|-------------|-----------|--------|
| P5 | TIMEOUT(2) | economic_startup (continues) | NO | spawn exists, forced advance |
| P7 | SUCCESS(0) | integrating (continues) | NO | CP3 passed, forced advance |
| P10 (via abortExpansion, timeout) | TIMEOUT(2) | undefined (aborted) | YES | no spawn, abort |

### UOEM Terminal 分类

| Producer | UOEM kind | isTerminalEvent | Reason |
|----------|-----------|-----------------|--------|
| P5 | milestone | false | kind="milestone" |
| P7 | milestone | false | kind="milestone" |
| P10 (timeout) | outcome | true | kind="outcome" |

### 关键证明

```
TIMEOUT + MilestoneEvent → isTerminalEvent = false ✅
TIMEOUT + OutcomeEvent → isTerminalEvent = true ✅

terminality 由 kind 决定，不由 outcomeCode 决定。
forcedAdvance=true 不改变 kind。
```

**结论：TIMEOUT-SEMANTICS 在 UOEM 中结构性消除。** ✅

---

## 7. Decision ≠ Operation

### 问题

一个 Operation 可以产生多个 Decision？一个 Decision 可以对应多个 Operation？

### 真实代码分析

**Decision 来源：** `collectExpansionDecisions`（decision-trace-system.ts line 888）
- 去重 key: `planId ?? expansion:${target}:${startedAt}`
- 每个 expansion 生命周期内只生成一个 DecisionRecord
- `processedExpansionPlanIds` 防重（heap Set，reset 后丢失）

**Operation 来源：** `tryConsumePlan`（expansion-manager.ts line 141）
- 从 `expansionPlans[]` 消费 WAITING_EXECUTION Plan
- 创建 `Memory.kernel.expansion`

**关系：**
- 1 Operation → 1 Decision（collectExpansionDecisions 去重）
- 1 Decision → 1 Operation（只有 expansion category 才有此关系）
- Decision 不是 Operation 的 identity——Decision 是 attribution identity

### 语义冲突检查

**`decisionId` 在当前代码中是否被当作 Operation identity？**

检查 `lastExpansionOutcome`：
```typescript
globalCache().lastExpansionOutcome = {
  target,           // business attribute
  outcomeCode,      // terminal outcome
  completedTick,    // terminal tick
  duration,         // tick - startedAt (last segment only)
  startedAt,        // mutable, overwritten
  decisionId,       // ← used as "唯一稳定关联键"
}
```

**结论：** `decisionId` 在注释中被明确称为"唯一稳定关联键"，实际上承担了 Operation identity 的角色。但 `decisionId` 的格式是 `D-{tick}-{seq}`，这是 Decision identity，不是 Operation identity。UOEM 正确地将两者分离：`OperationId` 和 `DecisionId` 是不同的 branded types。 ✅

---

## 8. Architecture Invariants Proof

### I-PROD-01: Every operation has stable operationId

**当前 Runtime：** NO — `decisionId` 在 reset 后重新生成，`startedAt` 被覆盖  
**UOEM：** YES — `operationId = createOperationId(target, consumeTick)`，确定性，不依赖 heap  
**状态：** Design proven, requires STEP 2 `openedAt` field

### I-PROD-02: DecisionId cannot substitute for OperationId

**当前 Runtime：** VIOLATED — `decisionId` 被当作"唯一稳定关联键"  
**UOEM：** ENFORCED — branded types 不可互换  
**状态：** UOEM structural protection ✅

### I-PROD-03: Milestone never enters OutcomeChannel

**当前 Runtime：** N/A — no OutcomeChannel exists  
**UOEM：** ENFORCED — type system + extractOutcomeIfTerminal  
**状态：** ✅

### I-PROD-04: Only terminal OutcomeEvent enters OutcomeChannel

**当前 Runtime：** N/A  
**UOEM：** ENFORCED — emitOutcome parameter type is OutcomeEvent  
**状态：** ✅

### I-PROD-05: Timeout does not imply terminality

**当前 Runtime：** VIOLATED — P5 (timeout milestone) writes to lastExpansionOutcome with TIMEOUT, consumer may misread as terminal  
**UOEM：** ENFORCED — isTerminalEvent checks kind, not outcomeCode  
**状态：** ✅

### I-PROD-06: forcedAdvance does not imply terminality

**当前 Runtime：** N/A — forcedAdvance not tracked as metadata  
**UOEM：** ENFORCED — forcedAdvance is boolean metadata, doesn't change kind  
**状态：** ✅

### I-PROD-07: Operation duration uses immutable openedAt

**当前 Runtime：** VIOLATED — duration uses mutable startedAt  
**UOEM：** ENFORCED — computeDuration uses interval.openedAt  
**状态：** ✅

### I-PROD-08: occurredAt and recordedAt remain independent

**当前 Runtime：** N/A — only completedTick exists  
**UOEM：** ENFORCED — separate fields with validation  
**状态：** ✅

### I-PROD-09: One operation has at most one terminal outcome

**当前 Runtime：** VIOLATED — P1 (milestone SUCCESS) and P8 (terminal SUCCESS) both write to lastExpansionOutcome  
**UOEM：** ENFORCED — operationId dedup in OutcomeChannel  
**状态：** ✅

### I-PROD-10: Duplicate terminal outcome is rejected

**当前 Runtime：** N/A  
**UOEM：** ENFORCED — DUPLICATE_REJECTED  
**状态：** ✅

### I-PROD-11: Before/After belong to the same operation

**当前 Runtime：** PARTIALLY — decisionId used, but unstable after reset  
**UOEM：** ENFORCED — operationId is stable  
**状态：** Design proven ✅

### I-PROD-12: Lifetime aggregate cannot masquerade as current outcome

**当前 Runtime：** A6.1 uses recoveryStats lifetime aggregate — existing design, not UOEM scope  
**UOEM：** ENFORCED — OutcomeEvent uses per-operation outcomeCode  
**状态：** ✅ (UOEM clean, A6.1 preserved)

### I-PROD-13: Reset cannot create false operation identity

**当前 Runtime：** VIOLATED — reset causes new decisionId for same operation  
**UOEM：** ENFORCED — operationId is deterministic, not reset-dependent  
**状态：** ✅

### I-PROD-14: No producer can directly create Decision Authority

**当前 Runtime：** N/A  
**UOEM：** ENFORCED — UOEM is shadow-only, no Decision Authority  
**状态：** ✅

### I-PROD-15: UOEM remains Shadow-Only

**当前 Runtime：** N/A  
**UOEM：** ENFORCED — zero producer/consumer integration  
**状态：** ✅

---

## 9. Summary

| 问题 | 当前 Runtime | UOEM 修复 | 状态 |
|------|-------------|-----------|------|
| EXP-1 | lastExpansionOutcome 不区分 milestone/terminal | MilestoneEvent 不进 OutcomeChannel | ✅ Structural fix |
| EXP-2 | decisionId reset 后重新生成 | operationId 确定性，不依赖 heap | ✅ Design proven (needs openedAt) |
| TMP-1 | startedAt 被覆盖 9 次 | openedAt immutable | ✅ Structural fix |
| A6-R | recoveryStats lifetime aggregate | UOEM 不使用 aggregate | ✅ (A6.1 preserved) |
| A6-SL | before/after 通过 unstable decisionId | operationId stable | ✅ Design proven |
| TIMEOUT-SEMANTICS | outcomeCode 决定 terminality | kind 决定 terminality | ✅ Structural fix |
