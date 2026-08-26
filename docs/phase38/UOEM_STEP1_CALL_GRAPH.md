# UOEM STEP 1 — Real Call Graph Audit

> 日期：2026-08-26
> 阶段：STEP 1.0 代码调查（零代码变更）
> 目的：验证架构假设与真实代码一致性，为 STEP 1.1-1.6 实施提供精确映射

---

## §1. 代码文件清单

| 文件 | 角色 | 行数 |
|---|---|---|
| `src/systems/expansion-manager.ts` | 唯一 Producer + State Machine | 1275 |
| `src/systems/decision-trace-system.ts` | DecisionRecord 采集 + dedup | ~1320 |
| `src/systems/intelligence/experience-collector-system.ts` | 唯一 Consumer (outcome) | 638 |
| `src/kernel/global-cache.ts` | lastExpansionOutcome 定义 | 591 |
| `src/types/global.d.ts` | Memory 类型声明 | ~913 |
| `src/kernel/memory.ts` | Memory 迁移 | ~1076 |
| `src/domain/expansion/rhythm.ts` | rhythm ring 纯函数 | 115 |
| `src/domain/intelligence/outcome.ts` | collectExpansionOutcome 纯函数 | ~440 |
| `src/domain/intelligence/experience.ts` | ExperienceRecord / OutcomeRecord 类型 | ~500 |
| `src/systems/recovery-execution-system.ts` | expansionPausedUntil 消费者 | ~500 |
| `src/kernel/event-log.ts` | recordEvent 事件日志 | ~250 |

---

## §2. Producer Matrix — 完整调用图

### 2.1 recordExpansionOutcome 定义

**文件：** `expansion-manager.ts:720-780`

```
recordExpansionOutcome(expansion, tick, phase, outcome)
  ├── 1. recordEvent(EventKind.ExpansionOutcome, target, [phase, outcome, duration])
  │      → eventBuffer → telemetry-collector flush → RawMemory segment 2
  │
  ├── 2. globalCache().lastExpansionOutcome = {
  │        target, outcomeCode, completedTick: tick,
  │        duration: tick - expansion.startedAt,  ← TMP-1 污染点
  │        startedAt: expansion.startedAt,        ← 被覆写的值
  │        decisionId: expansion.decisionId
  │      }
  │
  ├── 3. kind = toOutcomeKind(phase, outcome)
  │      → P1 claim SUCCESS → undefined → 不进 ring (正确)
  │      → P5 timeout+spawn → "timeout" → 进 ring (错误！milestone)
  │      → P7 timeout+cp3 → "success" → 进 ring (错误！milestone)
  │
  └── 4. ring = appendOutcome(ring, kind, ringSize=8)
         → evaluateExpansionRhythm(ring, options)
         → Memory.kernel.expansionRhythm = { ring, blacklistMultiplier, minSources }
         → if pauseTicks > 0: Memory.kernel.expansionPausedUntil = tick + pauseTicks
```

### 2.2 abortExpansion 定义

**文件：** `expansion-manager.ts:701-716`

```
abortExpansion(ctx, expansion, outcome)
  ├── 1. phase = (state === "claiming" || state === "preparing") ? CLAIM : PIONEER
  ├── 2. recordExpansionOutcome(expansion, tick, phase, outcome)  ← 递归调用
  ├── 3. 释放预留资源（日志）
  ├── 4. reclaimExpeditionCreeps(target, sponsor)
  ├── 5. updatePlanStatus(planId, "CANCELLED")
  └── 6. Memory.kernel.expansion = undefined
```

### 2.3 全部 11 个 Producer 调用点

| ID | 行号 | 调用者函数 | phase | outcome | 触发条件 | Operation 后续？ | 配对 abort？ |
|---|---|---|---|---|---|---|---|
| **P1** | :346 | advanceClaiming | CLAIM(0) | SUCCESS(0) | `controller.my` 为 true | ✅ 继续 (→claimed) | ❌ |
| **P2** | :394 | advanceBootstrapping | PIONEER(1) | LOST(3) | `!targetRoom` (失明) | ❌ 终止 | →A1(:401) |
| **P3** | :397 | advanceBootstrapping | PIONEER(1) | STOLEN(1) | `controller.owner && !my` | ❌ 终止 | →A1(:401) |
| **P4** | :447 | advanceBootstrapping | PIONEER(1) | LOST(3) | `hostiles.length > 0 && !squadAlive` | ❌ 终止 | →A1(:450) |
| **P5** | :458 | advanceBootstrapping | PIONEER(1) | TIMEOUT(2) | `tick - startedAt > pioneerTimeout && spawns.length > 0` | ✅ 强推 (→economic_startup) | ❌ |
| **P6** | :483 | advanceEconomicStartup | PIONEER(1) | LOST(3) | `!controller.my` | ❌ 终止 | →A1(:486) |
| **P7** | :571 | advanceEconomicStartup | PIONEER(1) | SUCCESS(0) | `tick - startedAt > pioneerTimeout*2 && cp3.passed` | ✅ 强推 (→integrating) | ❌ |
| **P8** | :661 | advanceIntegrating | PIONEER(1) | SUCCESS(0) | `CP5.passed && canHandover` | ❌ 终止 (→completed) | ❌ |
| **P9** | :686 | advanceIntegrating | PIONEER(1) | SUCCESS(0) | `tick - startedAt > pioneerTimeout*3 && netFlow > 0 && integrated` | ❌ 终止 (→completed forced) | ❌ |
| **A1** | :704 | abortExpansion | context-dependent | parameter | 由 P2/P3/P4/P6/A8/A10/A11/A12 触发 | ❌ 终止 | — |
| **B1** | :895 | runBootstrapLane | PIONEER(1) | ABORTED(4) | `decideBootstrapRooms action === "abandon"` | ❌ 终止 | ❌ 直接 recordEvent |

**注意 B1：** `:895 recordEvent(EventKind.ExpansionOutcome, d.room, [1, 4, 0])`
- 不走 `recordExpansionOutcome` 函数
- 直接写 eventLog，不写 lastExpansionOutcome，不写 rhythm ring
- 这是 bootstrap lane 的特殊路径

### 2.4 配对双写路径

| 路径 | 第一次 record | 第二次 record (abort) | outcome 冲突？ | UOEM 处理 |
|---|---|---|---|---|
| P2→A1 | LOST (:394) | LOST (:401 via A1) | ❌ 相同 | 幂等（同 outcome） |
| P3→A1 | STOLEN (:397) | LOST (:401 via A1) | ⚠️ 不同 | first-wins (STOLEN) |
| P4→A1 | LOST (:447) | LOST (:450 via A1) | ❌ 相同 | 幂等 |
| P6→A1 | LOST (:483) | LOST (:486 via A1) | ❌ 相同 | 幂等 |

**额外路径（无配对 record，直接 abort）：**

| 路径 | 调用 | outcome | 行号 |
|---|---|---|---|
| preparing→A1 | abortExpansion(TIMEOUT) | TIMEOUT | :332 |
| claiming→A1 | abortExpansion(STOLEN) | STOLEN | :356 |
| claiming→A1 | abortExpansion(TIMEOUT) | TIMEOUT | :365 |
| claiming→A1 | abortExpansion(LOST) | LOST | :377 |
| claimed→A1 | abortExpansion(ABORTED) | ABORTED | :240 |
| bootstrapping→A1 | abortExpansion(TIMEOUT) | TIMEOUT | :466 |
| economic_startup→A1 | abortExpansion(TIMEOUT) | TIMEOUT | :577 |
| integrating→A1 | abortExpansion(LOST) | LOST | :588 |
| integrating→A1 | abortExpansion(TIMEOUT) | TIMEOUT | :692 |

这些路径只有 A1 内部的一次 `recordExpansionOutcome`。

---

## §3. Consumer Matrix — 完整消费图

| # | Consumer | 文件:行号 | 读取源 | 当前语义 | UOEM 后 | 需修改？ |
|---|---|---|---|---|---|---|
| C1 | appendOutcome | expansion-manager.ts:743 | recordExpansionOutcome 内部 | milestone + terminal 混入 ring | 只 terminal 进 ring | ✅ 修改 producer |
| C2 | evaluateExpansionRhythm | expansion-manager.ts:748 | ring 数组 | 顺序敏感 | 不变 | ❌ |
| C3 | expansionPausedUntil (read) | expansion-manager.ts:101 | Memory | pauseTicks 派生 | 不变 | ❌ |
| C4 | expansionBlacklist (read) | expansion-manager.ts:807 | Memory | blacklistMultiplier 派生 | 不变 | ❌ |
| C5 | **lastExpansionOutcome (write)** | expansion-manager.ts:730 | recordExpansionOutcome | latest-wins 覆盖 | 替换为 OutcomeChannel | ✅ |
| C6 | **lastExpansionOutcome (read)** | experience-collector-system.ts:422 | globalCache() | decisionId 匹配 | channel.drain() | ✅ |
| C7 | buildAttributionInput | experience-collector-system.ts:523 | exp.outcome (已 attach) | resolved outcome | 不变 | ❌ |
| C8 | collectExpansionOutcome (domain) | outcome.ts:330 | OutcomeCollectionInput | outcome code → classification | 不变 | ❌ (domain) |
| C9 | collectExpansionAttribution (domain) | attribution.ts:669 | AttributionInput | resolved outcome | 不变 | ❌ (domain) |
| C10 | recordEvent | event-log.ts:211 | recordExpansionOutcome:721 | 所有调用都记录 | 保留 | ❌ |
| C11 | telemetry-collector | telemetry-collector.ts | eventBuffer | event log | 不变 | ❌ |
| C12 | recovery-execution-system | recovery-execution-system.ts:462 | expansionPausedUntil | pause 消费 | 不变 | ❌ |
| C13 | A6.4 Calibration | calibration.ts | ResolutionResult[] | resolved outcome | 不变 | ❌ (domain) |
| C14 | A6.2 Prediction | prediction/ | Prediction+actualValue | resolved outcome | 不变 | ❌ (domain) |
| C15 | A6.5 Reliability | reliability/ | ResolutionResult[] | resolved outcome | 不变 | ❌ (domain) |
| C16 | A6.6 Recommendation | recommendation/ | Experience[]+Profiles | resolved outcome | 不变 | ❌ (domain) |
| C17 | minSources 门禁 | expansion-manager.ts | rhythm result.minSources | 派生 | 不变 | ❌ |
| C18 | lastExpansionCompletedTick (write) | expansion-manager.ts:664 | CP5 终态后直接写 | terminal only | 不变 | ❌ |

**需修改：C1 (producer 逻辑), C5 (write 替换), C6 (read 替换)。**
**不修改：15 个消费者，含全部 A6 domain 层。**

---

## §4. Identity Flow

### 4.1 当前 Identity 链路

```
Plan (expansionPlans[])
  └── planId (Memory 持久，但旧版可能缺失)
       ↓ tryConsumePlan (:141-202)
  Memory.kernel.expansion = {
    state: "preparing",
    target: plan.roomName,
    sponsor: plan.sponsorRoom,
    startedAt: ctx.tick,         ← 被后续 9 处覆写
    planId: plan.planId,
    ...
  }
       ↓ collectExpansionDecisions (decision-trace-system.ts:888-1003)
  dedupKey = planId ?? `expansion:${target}:${startedAt}`
  if (processedExpansionPlanIds.has(dedupKey)) return;  ← heap Set 去重
  decisionId = makeDecisionId(tick, ++cache.seq)         ← D-{tick}-{seq}
  Memory.kernel.expansion.decisionId = decisionId        ← 写回 Memory
       ↓ recordExpansionOutcome (:720-780)
  globalCache().lastExpansionOutcome = {
    ..., decisionId: expansion.decisionId
  }
       ↓ experience-collector (:413-455)
  match: lastOutcome.decisionId === exp.decision.decisionId
  fallback: lastOutcome.target === expTargetRoom && completedTick > decisionTick
```

### 4.2 Identity 问题

| 问题 | 根因 | 影响 |
|---|---|---|
| **EXP-2** | dedupKey 含 startedAt，reset 后 startedAt 被覆写 → dedupKey 变化 → 重建 decisionId | 同一 Operation 被当作新 Operation |
| **无 operationId** | 代码中不存在 | 无法跨 reset 稳定关联 |
| **heap dedup** | processedExpansionPlanIds 是 heap Set | reset 后丢失 → 可能重建 |

### 4.3 UOEM Identity 链路

```
Plan (expansionPlans[])
  └── planId
       ↓ tryConsumePlan
  operationId = `op:{target}:{consumeTick}`    ← 新增：consume 时铸造
  interval.openedAt = consumeTick               ← 新增：immutable
  Memory.kernel.expansion = {
    ..., operationId, interval: { openedAt }
  }
       ↓ collectExpansionDecisions
  dedupKey = operationId                         ← 改为 operationId
  decisionId = makeDecisionId(...)               ← 保留，但不再作为 operation identity
       ↓ terminal producer
  OutcomeChannel.emit(OutcomeEvent { operationId, decisionId, ... })
       ↓ experience-collector
  drain() → match by operationId                 ← 新匹配键
```

---

## §5. Terminal Flow

```
当前：
  P2/P3/P4/P6/P8/P9/A1/B1 → recordExpansionOutcome → lastExpansionOutcome + rhythm ring

UOEM 后：
  P2/P3/P4/P6/P8/P9/A1/B1 → OutcomeChannel.emit(OutcomeEvent)
    → Memory.kernel.outcomeEvents (cap=32, FIFO)
    → recordEvent (保留 eventLog)
    → appendOutcome(ring) + evaluate (只 terminal)
```

**terminal outcome codes（现有码表）：**

| code | 名称 | expansion-manager 常量 | outcome.ts classification | rhythm kind |
|---|---|---|---|---|
| 0 | SUCCESS | OUTCOME_SUCCESS | "SUCCESS" | "success" |
| 1 | STOLEN | OUTCOME_STOLEN | "FAILURE" | "stolen" |
| 2 | TIMEOUT | OUTCOME_TIMEOUT | "EXPIRED" | "timeout" |
| 3 | LOST | OUTCOME_LOST | "FAILURE" → (code 3 → UNKNOWN) | "lost" |
| 4 | ABORTED | OUTCOME_ABORTED | "ABORTED" → (code 4 → UNKNOWN) | "aborted" |

**注意 outcome.ts:337-342 的 classification 映射：**
```typescript
outcomeCode === 0 ? "SUCCESS"
: outcomeCode === 1 ? "FAILURE"     // STOLEN → FAILURE
: outcomeCode === 2 ? "EXPIRED"     // TIMEOUT → EXPIRED
: "UNKNOWN"                          // LOST(3), ABORTED(4) → UNKNOWN
```

**UOEM 不修改此映射——这是 A6.1 domain 层冻结契约。**

---

## §6. Milestone Flow

```
当前：
  P1/P5/P7 → recordExpansionOutcome → lastExpansionOutcome (覆盖!) + rhythm ring (混入!)

UOEM 后：
  P1/P5/P7 → emitMilestone(MilestoneEvent)
    → heap only (不进 Memory channel)
    → forcedAdvance 标志更新 (P5/P7: Memory.kernel.expansion.forcedAdvance = true)
    → recordEvent (保留 eventLog — 可观测性)
    → 不写 lastExpansionOutcome
    → 不进 rhythm ring
```

**Milestone 分类：**

| ID | 行号 | 当前 phase+outcome | Milestone kind | forcedAdvance？ | 理由 |
|---|---|---|---|---|---|
| P1 | :346 | CLAIM+SUCCESS | "CLAIMED" | ❌ | controller.my，Operation 继续 (→claimed→bootstrapping) |
| P5 | :458 | PIONEER+TIMEOUT | "FORCED_ADVANCE" | ✅ | timeout+spawn exists，强推 economic_startup |
| P7 | :571 | PIONEER+SUCCESS | "FORCED_ADVANCE" | ✅ | timeout+cp3 passed，强推 integrating |

---

## §7. Architecture-to-Code Gap Analysis

### 7.1 Gap 清单

| # | 架构概念 | 代码状态 | Gap 类型 | 实施步骤 |
|---|---|---|---|---|
| G1 | `operationId` | 不存在 | 新增 | STEP 1.3 |
| G2 | `interval.openedAt` | 不存在 | 新增 | STEP 1.3 |
| G3 | `interval.closedAt` | 不存在 | 新增 | STEP 1.5 (terminal) |
| G4 | `forcedAdvance` (Memory) | 不存在 | 新增 | STEP 1.3 |
| G5 | `MilestoneEvent` 类型 | 不存在 | 新增 | STEP 1.1 |
| G6 | `OutcomeEvent` 类型 | 不存在 | 新增 | STEP 1.1 |
| G7 | `OutcomeChannel` 实现 | 不存在 | 新增 | STEP 1.2 |
| G8 | `outcomeEvents` (Memory) | 不存在 | 新增 | STEP 1.2 |
| G9 | `emitMilestone()` | 不存在 | 新增 | STEP 1.4 |
| G10 | `OutcomeChannel.emit()` | 不存在 | 新增 | STEP 1.5 |
| G11 | `OutcomeChannel.drain()` | 不存在 | 新增 | STEP 1.6 (deferred) |
| G12 | `lastExpansionOutcome` 替换 | 存在（需替换） | 替换 | STEP 1.6 |

### 7.2 无冲突

**ARCHITECTURE_CONSISTENT**

所有 gap 都是"架构定义了新概念，代码尚未实现"——不是架构与代码的矛盾。

### 7.3 现有码表兼容性

UOEM `OutcomeEvent.outcomeCode` 必须与现有码表兼容：

| 现有码表 | 来源 | UOEM 采用？ |
|---|---|---|
| `OUTCOME_SUCCESS=0` | expansion-manager.ts:68 | ✅ |
| `OUTCOME_STOLEN=1` | expansion-manager.ts:69 | ✅ |
| `OUTCOME_TIMEOUT=2` | expansion-manager.ts:70 | ✅ |
| `OUTCOME_LOST=3` | expansion-manager.ts:71 | ✅ |
| `OUTCOME_ABORTED=4` | expansion-manager.ts:72 | ✅ |
| `ExpansionOutcomeKind` | rhythm.ts:21 | ✅ (ring kind 映射不变) |
| `OutcomeClassification` | experience.ts:50-56 | ✅ (domain 不变) |
| `expansionOutcome` 编码 | outcome.ts:96 `phase*10+outcome` | ✅ (collector 构造不变) |

**不创造新 outcome code。不修改现有码表。**

### 7.4 Memory Schema 版本

- 当前 `CONFIG.memory.schemaVersion = 39`
- UOEM 新增 `Memory.kernel.outcomeEvents` + `Memory.kernel.expansion.operationId` + `Memory.kernel.expansion.interval` + `Memory.kernel.expansion.forcedAdvance`
- 需要迁移 v39→v40：幂等 no-op（新字段全部可选，惰性初始化）

### 7.5 rhythm ring 兼容性

**当前 rhythm ring 消费 `ExpansionOutcomeKind` 序列。**

UOEM 后：
- P1 (CLAIM+SUCCESS) → `toOutcomeKind(0,0)` returns `undefined` → 不进 ring ← **不变**
- P5 (PIONEER+TIMEOUT) → `toOutcomeKind(1,2)` returns `"timeout"` → 进 ring ← **UOEM 改为不进 ring**
- P7 (PIONEER+SUCCESS) → `toOutcomeKind(1,0)` returns `"success"` → 进 ring ← **UOEM 改为不进 ring**

**行为变化：**
- 改变前：P5 和 P7 进 ring → consecutiveFailures 被 P7 重置
- 改变后：P5 和 P7 不进 ring → consecutiveFailures 不被重置 → **更正确**

**rhythm.ts 纯函数不需要修改。** 修改只在 producer 端（expansion-manager.ts 不再对 milestone 调用 appendOutcome）。

**无 RHYTHM_CONSUMER_CONTRACT_CONFLICT。**

---

## §8. 关键约束验证

| 约束 | 当前状态 | UOEM 后 |
|---|---|---|
| A6.1-A6.6 domain 不修改 | ✅ 纯函数，无 Game/Memory import | ✅ 不修改 |
| A5 Decision Authority 不变 | ✅ war-planner 独立 | ✅ 不修改 |
| 无新 Score/Authority | ✅ | ✅ |
| 无 ML/RL | ✅ | ✅ |
| 无 Date.now()/Math.random() | ✅ 用 tick+seq | ✅ |
| Memory bounded | lastExpansionOutcome 单槽 | channel cap=32, ~3.2KB |
| Deterministic | tick+seq ID | ✅ 保持 |

---

## §9. 裁决

**ARCHITECTURE_CONSISTENT**

**NO_CONFLICT**

**READY_FOR_STEP_1_1**
