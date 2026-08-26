# UOEM STEP 1 — Producer Mapping

> 日期：2026-08-26
> 阶段：STEP 1.0 代码调查（零代码变更）
> 目的：将 11 个 producer 调用点逐一映射到 UOEM Event 类型

---

## §1. 现有码表

### 1.1 Phase 码

| 常量 | 值 | 含义 |
|---|---|---|
| `PHASE_CLAIM` | 0 | claim 阶段 |
| `PHASE_PIONEER` | 1 | pioneer/bootstrap 阶段 |

### 1.2 Outcome 码

| 常量 | 值 | 含义 | rhythm kind | outcome.ts classification |
|---|---|---|---|---|
| `OUTCOME_SUCCESS` | 0 | 成功 | "success" | "SUCCESS" |
| `OUTCOME_STOLEN` | 1 | 被抢 | "stolen" | "FAILURE" |
| `OUTCOME_TIMEOUT` | 2 | 超时 | "timeout" | "EXPIRED" |
| `OUTCOME_LOST` | 3 | 丢失 | "lost" | "UNKNOWN" (code 3 → else 分支) |
| `OUTCOME_ABORTED` | 4 | 中止 | "aborted" | "UNKNOWN" (code 4 → else 分支) |

### 1.3 toOutcomeKind 映射

```typescript
// expansion-manager.ts:782-794
function toOutcomeKind(phase, outcome) {
  if (phase === 0) {           // CLAIM phase
    if (outcome === 0) return undefined;   // P1: claim success → 不进 ring
    if (outcome === 1) return "stolen";
    if (outcome === 2) return "timeout";
    if (outcome === 3) return "lost";
    return "aborted";
  }
  // PIONEER phase
  if (outcome === 0) return "success";     // P7/P8/P9
  if (outcome === 1) return "stolen";      // P3
  if (outcome === 2) return "timeout";      // P5
  return "lost";                            // P2/P4/P6
}
```

---

## §2. 逐项 Producer 映射

### P1: claim 成功

| 属性 | 值 |
|---|---|
| **行号** | :346 |
| **函数** | `advanceClaiming` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_CLAIM, OUTCOME_SUCCESS)` |
| **phase** | CLAIM(0) |
| **outcome** | SUCCESS(0) |
| **触发条件** | `targetRoom?.controller?.my` 为 true |
| **Operation 后续** | ✅ 继续 (state → claimed → bootstrapping) |
| **当前 toOutcomeKind** | `undefined` → 不进 ring |
| **当前 lastExpansionOutcome** | 覆盖为 { target, outcomeCode:0, completedTick, duration, startedAt, decisionId } |
| **UOEM 分类** | **Milestone** |
| **UOEM Event** | `MilestoneEvent { kind: "CLAIMED", operationId, occurredAt, recordedAt, state: "claimed", forcedAdvance: false }` |
| **进 OutcomeChannel？** | ❌ 不进 |
| **进 rhythm ring？** | ❌ 不进（当前也不进） |
| **写 lastExpansionOutcome？** | ❌ 不写（当前写——**EXP-1 根因**） |
| **forcedAdvance？** | false |

**理由：** claim 成功是中间里程碑。Operation 明确继续（→claimed→bootstrapping）。当前 toOutcomeKind 返回 undefined 所以不进 ring（正确），但写了 lastExpansionOutcome（错误——覆盖了之前可能的 terminal outcome）。

---

### P2: bootstrapping 失明 → LOST

| 属性 | 值 |
|---|---|
| **行号** | :394 |
| **函数** | `advanceBootstrapping` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_LOST)` |
| **phase** | PIONEER(1) |
| **outcome** | LOST(3) |
| **触发条件** | `!targetRoom` (失明) |
| **Operation 后续** | ❌ 终止 |
| **配对 abort** | →A1 (:401) abortExpansion(LOST) |
| **当前 toOutcomeKind** | "lost" → 进 ring |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { operationId, decisionId, outcomeCode: 3(LOST), occurredAt, recordedAt, interval, duration, forcedAdvance }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ (kind: "lost") |
| **配对处理** | A1 也 emit → channel 幂等拒绝（同 operationId + 同 outcomeCode） |

---

### P3: bootstrapping 被抢 → STOLEN

| 属性 | 值 |
|---|---|
| **行号** | :397 |
| **函数** | `advanceBootstrapping` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_STOLEN)` |
| **phase** | PIONEER(1) |
| **outcome** | STOLEN(1) |
| **触发条件** | `targetRoom?.controller?.owner && !my` |
| **Operation 后续** | ❌ 终止 |
| **配对 abort** | →A1 (:401) abortExpansion(LOST) |
| **当前 toOutcomeKind** | "stolen" → 进 ring |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: 1(STOLEN), ... }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ (kind: "stolen") |
| **配对处理** | A1 emit LOST → channel 幂等拒绝（first-wins: STOLEN 保留） |

**冲突分析：** P3 emit STOLEN，A1 emit LOST。UOEM channel first-wins 保留 STOLEN。这比当前 last-wins(LOST) 更精确——STOLEN 比 LOST 更准确描述被抢场景。

---

### P4: bootstrapping 编队被歼 → LOST

| 属性 | 值 |
|---|---|
| **行号** | :447 |
| **函数** | `advanceBootstrapping` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_LOST)` |
| **phase** | PIONEER(1) |
| **outcome** | LOST(3) |
| **触发条件** | `hostiles.length > 0 && !squadAlive` |
| **Operation 后续** | ❌ 终止 |
| **配对 abort** | →A1 (:450) abortExpansion(LOST) |
| **当前 toOutcomeKind** | "lost" → 进 ring |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: 3(LOST), ... }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ (kind: "lost") |
| **配对处理** | A1 emit LOST → 幂等拒绝（同 outcomeCode） |

---

### P5: bootstrapping 超时 + spawn 已建成 → 强推

| 属性 | 值 |
|---|---|
| **行号** | :458 |
| **函数** | `advanceBootstrapping` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_TIMEOUT)` |
| **phase** | PIONEER(1) |
| **outcome** | TIMEOUT(2) |
| **触发条件** | `tick - startedAt > pioneerTimeout && spawns.length > 0` |
| **Operation 后续** | ✅ 强推 (state → economic_startup) |
| **配对 abort** | ❌ 无 |
| **当前 toOutcomeKind** | "timeout" → **进 ring（错误！）** |
| **当前 lastExpansionOutcome** | 覆盖为 TIMEOUT（**EXP-1 根因**） |
| **UOEM 分类** | **Milestone** |
| **UOEM Event** | `MilestoneEvent { kind: "FORCED_ADVANCE", operationId, occurredAt, recordedAt, state: "economic_startup", forcedAdvance: true }` |
| **进 OutcomeChannel？** | ❌ 不进 |
| **进 rhythm ring？** | ❌ 不进（**行为变化：当前进 ring，UOEM 后不进**） |
| **写 lastExpansionOutcome？** | ❌ 不写 |
| **forcedAdvance？** | ✅ true（Memory.kernel.expansion.forcedAdvance = true） |

**TIMEOUT 语义分析：**
- P5 的 TIMEOUT 不是 terminal failure——Operation 继续运行
- 它是"阶段超时但条件允许强推"的 milestone
- forcedAdvance 标志为 true，但 outcome 不是 terminal
- **TIMEOUT-SEMANTICS 的核心消解点**

---

### P6: economic_startup 失守 → LOST

| 属性 | 值 |
|---|---|
| **行号** | :483 |
| **函数** | `advanceEconomicStartup` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHIONEER, OUTCOME_LOST)` |
| **phase** | PIONEER(1) |
| **outcome** | LOST(3) |
| **触发条件** | `!targetRoom?.controller?.my` |
| **Operation 后续** | ❌ 终止 |
| **配对 abort** | →A1 (:486) abortExpansion(LOST) |
| **当前 toOutcomeKind** | "lost" → 进 ring |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: 3(LOST), ... }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ (kind: "lost") |
| **配对处理** | A1 emit LOST → 幂等拒绝 |

---

### P7: economic_startup 超时 + CP3 通过 → 强推

| 属性 | 值 |
|---|---|
| **行号** | :571 |
| **函数** | `advanceEconomicStartup` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_SUCCESS)` |
| **phase** | PIONEER(1) |
| **outcome** | SUCCESS(0) |
| **触发条件** | `tick - startedAt > pioneerTimeout*2 && cp3.passed` |
| **Operation 后续** | ✅ 强推 (state → integrating) |
| **配对 abort** | ❌ 无 |
| **当前 toOutcomeKind** | "success" → **进 ring（错误！）** |
| **当前 lastExpansionOutcome** | 覆盖为 SUCCESS（**EXP-1 根因**） |
| **UOEM 分类** | **Milestone** |
| **UOEM Event** | `MilestoneEvent { kind: "FORCED_ADVANCE", operationId, occurredAt, recordedAt, state: "integrating", forcedAdvance: true }` |
| **进 OutcomeChannel？** | ❌ 不进 |
| **进 rhythm ring？** | ❌ 不进（**行为变化：当前进 ring，UOEM 后不进**） |
| **写 lastExpansionOutcome？** | ❌ 不写 |
| **forcedAdvance？** | ✅ true |

**TIMEOUT 语义分析：**
- P7 的 SUCCESS 不是 terminal success——Operation 继续运行（→integrating）
- 它是"阶段超时但经济环路已建立，强推"的 milestone
- forcedAdvance 标志为 true
- **当前 collector 可能读到 P7 的 SUCCESS 误当 terminal → Experience FINALIZED as SUCCESS → 后续 A11/A12 无法修正**

---

### P8: integrating CP5 通过 → COMPLETED

| 属性 | 值 |
|---|---|
| **行号** | :661 |
| **函数** | `advanceIntegrating` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_SUCCESS)` |
| **phase** | PIONEER(1) |
| **outcome** | SUCCESS(0) |
| **触发条件** | `CP5.passed && canHandover` |
| **Operation 后续** | ❌ 终止 (state → completed, Memory.kernel.expansion = undefined) |
| **配对 abort** | ❌ 无 |
| **当前 toOutcomeKind** | "success" → 进 ring |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: 0(SUCCESS), ..., forcedAdvance: (from Memory) }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ (kind: "success") |
| **额外操作** | 写 lastExpansionCompletedTick (:664) |

---

### P9: integrating 超时 + netFlow 正 → forced COMPLETED

| 属性 | 值 |
|---|---|
| **行号** | :686 |
| **函数** | `advanceIntegrating` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_SUCCESS)` |
| **phase** | PIONEER(1) |
| **outcome** | SUCCESS(0) |
| **触发条件** | `tick - startedAt > pioneerTimeout*3 && netFlow > 0 && integrated` |
| **Operation 后续** | ❌ 终止 (state → completed forced, Memory.kernel.expansion = undefined) |
| **配对 abort** | ❌ 无 |
| **当前 toOutcomeKind** | "success" → 进 ring |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: 0(SUCCESS), ..., forcedAdvance: true }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ (kind: "success") |
| **forcedAdvance？** | ✅ true（超时强推完成） |

---

### A1: abortExpansion 统一清理

| 属性 | 值 |
|---|---|
| **行号** | :704 |
| **函数** | `abortExpansion` |
| **代码** | `recordExpansionOutcome(expansion, ctx.tick, phase, outcome)` |
| **phase** | context-dependent (CLAIM if claiming/preparing, else PIONEER) |
| **outcome** | parameter (STOLEN/TIMEOUT/LOST/ABORTED) |
| **触发条件** | 由 P2/P3/P4/P6 + 直接 abort 路径触发 |
| **Operation 后续** | ❌ 终止 (Memory.kernel.expansion = undefined) |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: parameter, ... }` |
| **进 OutcomeChannel？** | ✅ |
| **进 rhythm ring？** | ✅ |
| **配对处理** | 如果配对 P 已 emit → 幂等拒绝（first-wins） |

**A1 触发路径完整列表：**

| 触发者 | 行号 | outcome | 是否有配对 record？ |
|---|---|---|---|
| claimed no anchor | :240 | ABORTED(4) | ❌ 无配对 |
| preparing timeout | :332 | TIMEOUT(2) | ❌ 无配对 |
| claiming stolen | :356 | STOLEN(1) | ❌ 无配对 |
| claiming timeout | :365 | TIMEOUT(2) | ❌ 无配对 |
| claiming lost+hostile | :377 | LOST(3) | ❌ 无配对 |
| P2→A1 | :401 | LOST(3) | ✅ P2 已 emit LOST |
| P3→A1 | :401 | LOST(3) | ✅ P3 已 emit STOLEN |
| P4→A1 | :450 | LOST(3) | ✅ P4 已 emit LOST |
| bootstrapping timeout+no spawn | :466 | TIMEOUT(2) | ❌ 无配对 |
| P6→A1 | :486 | LOST(3) | ✅ P6 已 emit LOST |
| economic_startup timeout+no cp3 | :577 | TIMEOUT(2) | ❌ 无配对 |
| integrating lost | :588 | LOST(3) | ❌ 无配对 |
| integrating timeout+no netFlow | :692 | TIMEOUT(2) | ❌ 无配对 |

---

### B1: bootstrap abandon

| 属性 | 值 |
|---|---|
| **行号** | :895 |
| **函数** | `runBootstrapLane` |
| **代码** | `recordEvent(EventKind.ExpansionOutcome, d.room, [1, 4, 0])` |
| **phase** | PIONEER(1) |
| **outcome** | ABORTED(4) |
| **触发条件** | `decideBootstrapRooms action === "abandon"` |
| **Operation 后续** | ❌ 终止 |
| **当前路径** | 直接 recordEvent，不调 recordExpansionOutcome |
| **当前 lastExpansionOutcome** | ❌ 不写 |
| **当前 rhythm ring** | ❌ 不进 |
| **UOEM 分类** | **Terminal** |
| **UOEM Event** | `OutcomeEvent { outcomeCode: 4(ABORTED), ... }` |
| **进 OutcomeChannel？** | ✅（需新增 emit） |
| **进 rhythm ring？** | ✅（需新增 appendOutcome） |

**注意：** B1 当前不走 recordExpansionOutcome，所以不写 lastExpansionOutcome 也不进 rhythm ring。这是一个被遗漏的 terminal outcome。UOEM 后应该通过 OutcomeChannel 统一处理。

**但 B1 的 operationId 是什么？**
- B1 不在 `Memory.kernel.expansion` 状态机内——它是 bootstrap lane（owned 无 spawn 的房）
- bootstrap lane 没有对应的 DecisionRecord / decisionId
- **B1 可能没有 operationId**——这需要特殊处理

**裁决：** B1 在 STEP 1 保持现状（直接 recordEvent）。不在 OutcomeChannel 中处理。原因：
1. B1 没有 operationId / decisionId
2. B1 不在 expansion 状态机内
3. B1 是 bootstrap 子系统的事件，不是 expansion Operation 的 outcome
4. 将 B1 塞入 OutcomeChannel 会混淆 Operation 边界

---

## §3. 映射汇总

| ID | 行号 | 当前 (phase, outcome) | UOEM Event | Terminal? | Channel? | Ring? | forcedAdvance? | 配对？ |
|---|---|---|---|---|---|---|---|---|
| P1 | :346 | (CLAIM, SUCCESS) | Milestone("CLAIMED") | ❌ | ❌ | ❌ | false | ❌ |
| P2 | :394 | (PIONEER, LOST) | Outcome(LOST) | ✅ | ✅ | ✅ | (from Memory) | →A1 |
| P3 | :397 | (PIONEER, STOLEN) | Outcome(STOLEN) | ✅ | ✅ | ✅ | (from Memory) | →A1 |
| P4 | :447 | (PIONEER, LOST) | Outcome(LOST) | ✅ | ✅ | ✅ | (from Memory) | →A1 |
| P5 | :458 | (PIONEER, TIMEOUT) | Milestone("FORCED_ADVANCE") | ❌ | ❌ | ❌ | **true** | ❌ |
| P6 | :483 | (PIONEER, LOST) | Outcome(LOST) | ✅ | ✅ | ✅ | (from Memory) | →A1 |
| P7 | :571 | (PIONEER, SUCCESS) | Milestone("FORCED_ADVANCE") | ❌ | ❌ | ❌ | **true** | ❌ |
| P8 | :661 | (PIONEER, SUCCESS) | Outcome(SUCCESS) | ✅ | ✅ | ✅ | (from Memory) | ❌ |
| P9 | :686 | (PIONEER, SUCCESS) | Outcome(SUCCESS) | ✅ | ✅ | ✅ | **true** | ❌ |
| A1 | :704 | (context, parameter) | Outcome(parameter) | ✅ | ✅ | ✅ | (from Memory) | — |
| B1 | :895 | (PIONEER, ABORTED) | recordEvent only | ✅ | ❌ | ❌ | false | ❌ |

**总计：**
- **Milestone: 3** (P1, P5, P7) — 不进 channel，不进 ring，不写 lastExpansionOutcome
- **Terminal: 7** (P2, P3, P4, P6, P8, P9, A1) — 进 channel，进 ring
- **Special: 1** (B1) — 保持 recordEvent only，不进 channel

---

## §4. forcedAdvance 完整生命周期

```
tryConsumePlan
  → Memory.kernel.expansion.forcedAdvance = false  ← 初始化

P5 (bootstrapping timeout+spawn)
  → forcedAdvance = true  ← 第一次强推
  → MilestoneEvent("FORCED_ADVANCE")

P7 (economic_startup timeout+cp3)
  → forcedAdvance remains true  ← 仍然 true（不重置）
  → MilestoneEvent("FORCED_ADVANCE")

P8 (CP5 passed, normal completion)
  → OutcomeEvent(SUCCESS, forcedAdvance: true)  ← 从 Memory 读取

P9 (integrating timeout+netFlow, forced completion)
  → OutcomeEvent(SUCCESS, forcedAdvance: true)  ← 从 Memory 读取

A1 (abort after P5/P7)
  → OutcomeEvent(parameter, forcedAdvance: true)  ← 从 Memory 读取

A1 (abort without P5/P7, e.g. P2/P3/P4/P6)
  → OutcomeEvent(parameter, forcedAdvance: false)  ← 从 Memory 读取
```

**关键：** forcedAdvance 是**累积标志**——一旦被 P5/P7 设为 true，后续所有 terminal outcome 都携带 `forcedAdvance: true`。它不会因为状态转换而重置。

---

## §5. rhythm ring 行为变化分析

### 5.1 改变前的 ring 内容（示例场景）

场景：bootstrapping timeout+spawn(P5) → economic_startup timeout+cp3(P7) → integrating CP5(P8)

```
P5: ring += "timeout"   → ring = [..., "timeout"]
P7: ring += "success"   → ring = [..., "timeout", "success"]  ← consecutiveFailures 重置为 0
P8: ring += "success"   → ring = [..., "timeout", "success", "success"]
```

### 5.2 改变后的 ring 内容

```
P5: 不进 ring            → ring 不变
P7: 不进 ring            → ring 不变
P8: ring += "success"   → ring = [..., "success"]
```

### 5.3 净影响

| 指标 | 改变前 | 改变后 | 评估 |
|---|---|---|---|
| consecutiveFailures | P7 重置为 0 | 不重置 | ✅ 更正确（P7 是 milestone 不是 terminal） |
| blacklistMultiplier | 被 P5/P7 稀释 | 不稀释 | ✅ 更正确 |
| minSources | 不受影响 | 不受影响 | ✅ 无变化 |

**结论：rhythm ring 行为变化是改善，不是回归。rhythm.ts 纯函数不需修改。**

---

## §6. Architecture-to-Code Gap 确认

**ARCHITECTURE_CONSISTENT**

所有 11 个 producer 调用点已完整映射。码表兼容。无冲突。无遗漏。

**READY_FOR_STEP_1_1**
