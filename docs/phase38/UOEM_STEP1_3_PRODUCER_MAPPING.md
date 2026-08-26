# UOEM STEP 1.3 — Producer Mapping

**日期：** 2026-08-26  
**阶段：** Phase 38 — UOEM STEP 1.3  
**性质：** DESIGN / PROOF ONLY — 无代码修改

---

## 1. 调查范围

### 搜索的函数

- `recordExpansionOutcome` — 主 outcome producer
- `abortExpansion` — 终止清理函数（内部调用 recordExpansionOutcome）
- `recordEvent(EventKind.ExpansionOutcome, ...)` — 直接事件写入
- 所有 `expansion.startedAt =` 赋值点
- 所有 `expansion.state =` 状态转换
- 所有超时路径
- 所有强推路径
- `collectExpansionDecisions` — decisionId 分配

### 搜索的文件

- `src/systems/expansion-manager.ts`（1275 行，完整读取）
- `src/systems/decision-trace-system.ts`（collectExpansionDecisions，line 888-1003）
- `src/systems/intelligence/experience-collector-system.ts`（buildOutcomeCollectionInput）
- `src/kernel/global-cache.ts`（lastExpansionOutcome 定义）
- `src/domain/expansion/rhythm.ts`（appendOutcome / evaluateExpansionRhythm）
- `src/domain/intelligence/outcome.ts`（collectExpansionOutcome）
- `src/types/global.d.ts`（ExpansionExecutionState 类型）

---

## 2. 真实 Producer Matrix

### 2.1 recordExpansionOutcome 调用点（11 个）

| # | 行号 | 函数 | State | Phase | OutcomeCode | forcedAdvance | Terminal? | 进 rhythm ring? | 写 lastExpansionOutcome? |
|---|------|------|-------|-------|-------------|---------------|-----------|-----------------|-------------------------|
| P1 | 346 | advanceClaiming | claiming→claimed | CLAIM(0) | SUCCESS(0) | false | **NO** | YES |
| P2 | 394 | advanceBootstrapping | bootstrapping | PIONEER(1) | LOST(3) | false | YES | YES |
| P3 | 397 | advanceBootstrapping | bootstrapping | PIONEER(1) | STOLEN(1) | false | YES | YES |
| P4 | 447 | advanceBootstrapping | bootstrapping | PIONEER(1) | LOST(3) | false | YES | YES |
| P5 | 458 | advanceBootstrapping | bootstrapping | PIONEER(1) | TIMEOUT(2) | false (but forces state transition) | **Milestone** | YES |
| P6 | 483 | advanceEconomicStartup | economic_startup | PIONEER(1) | LOST(3) | false | YES | YES |
| P7 | 571 | advanceEconomicStartup | economic_startup | PIONEER(1) | SUCCESS(0) | **true** (timeout forced advance) | **Milestone** | YES |
| P8 | 661 | advanceIntegrating | integrating→completed | PIONEER(1) | SUCCESS(0) | false | YES | YES |
| P9 | 686 | advanceIntegrating | integrating→completed | PIONEER(1) | SUCCESS(0) | **true** (timeout forced advance) | YES | YES |
| P10 | 704 | abortExpansion | 终止 | CLAIM/PIONEER | varies | false | YES | YES |
| P11 | 895 | runBootstrapLane | bootstrap abandon | PIONEER(1) | ABANDONED(4) | false | YES | **NO** (direct recordEvent only) |

### 2.2 Producer 详细分析

#### P1: claim success（EXP-1 核心案例）

- **位置：** line 346
- **调用者：** `advanceClaiming`
- **状态：** claiming → claimed
- **Phase/Outcome：** `PHASE_CLAIM(0) / OUTCOME_SUCCESS(0)`
- **Terminal?** **NO** — Operation 继续进入 claimed → bootstrapping
- **进 rhythm ring?** **NO** — `toOutcomeKind(0, 0)` 返回 `undefined`，line 740 `if (!kind) return` 跳过 ring
- **写 lastExpansionOutcome?** **YES** — line 730-737 无条件写入
- **UOEM 映射：** `MilestoneEvent { kind: "milestone", milestoneKind: "CLAIMED", forcedAdvance: false }`
- **关键风险：** `lastExpansionOutcome` 被写入 SUCCESS，如果 experience-collector 在此时读取，会错误地把 P1 当作 terminal SUCCESS

#### P5: bootstrapping timeout with spawn exists（强推 milestone）

- **位置：** line 458
- **调用者：** `advanceBootstrapping`
- **状态：** bootstrapping（超时但 spawn 已建成）
- **Phase/Outcome：** `PHASE_PIONEER(1) / OUTCOME_TIMEOUT(2)`
- **Terminal?** **NO** — Operation 强推到 economic_startup（line 461-463）
- **进 rhythm ring?** **YES** — `toOutcomeKind(1, 2)` 返回 `"timeout"`
- **写 lastExpansionOutcome?** **YES**
- **UOEM 映射：** `MilestoneEvent { kind: "milestone", milestoneKind: "FORCED_ADVANCE", forcedAdvance: true }`
- **关键风险：** `lastExpansionOutcome` 写入 TIMEOUT + Operation 继续。collector 可能误读为 terminal timeout

#### P7: economic_startup timeout with CP3 passed（强推 milestone）

- **位置：** line 571
- **调用者：** `advanceEconomicStartup`
- **状态：** economic_startup（超时但 energy loop 活跃）
- **Phase/Outcome：** `PHASE_PIONEER(1) / OUTCOME_SUCCESS(0)`
- **Terminal?** **NO** — Operation 强推到 integrating（line 572-574）
- **进 rhythm ring?** **YES** — `toOutcomeKind(1, 0)` 返回 `"success"`
- **写 lastExpansionOutcome?** **YES**
- **UOEM 映射：** `MilestoneEvent { kind: "milestone", milestoneKind: "FORCED_ADVANCE", forcedAdvance: true }`
- **关键风险：** `lastExpansionOutcome` 写入 SUCCESS + Operation 继续。这是 EXP-1 的变体——非 terminal SUCCESS

#### P8: integrating → completed（真 terminal success）

- **位置：** line 661
- **调用者：** `advanceIntegrating`
- **状态：** integrating → completed
- **Phase/Outcome：** `PHASE_PIONEER(1) / OUTCOME_SUCCESS(0)`
- **Terminal?** **YES** — `Memory.kernel.expansion = undefined`（line 673）
- **进 rhythm ring?** **YES** — `toOutcomeKind(1, 0)` 返回 `"success"`
- **写 lastExpansionOutcome?** **YES**
- **UOEM 映射：** `OutcomeEvent { kind: "outcome", outcomeCode: SUCCESS, forcedAdvance: false }`

#### P9: integrating timeout with positive flow（强推 terminal）

- **位置：** line 686
- **调用者：** `advanceIntegrating`
- **状态：** integrating → completed（超时但 netFlow > 0 + integrated）
- **Phase/Outcome：** `PHASE_PIONEER(1) / OUTCOME_SUCCESS(0)`
- **Terminal?** **YES** — `Memory.kernel.expansion = undefined`（line 689）
- **进 rhythm ring?** **YES**
- **写 lastExpansionOutcome?** **YES**
- **UOEM 映射：** `OutcomeEvent { kind: "outcome", outcomeCode: SUCCESS, forcedAdvance: true }`
- **注意：** forcedAdvance=true 但 kind="outcome" → isTerminalEvent = true

#### P10: abortExpansion（统一终止函数）

- **位置：** line 704（被多处调用）
- **调用者：** `advancePreparing`(332), `advanceClaiming`(356/365/377), `advanceBootstrapping`(401/466), `advanceEconomicStartup`(486/577), `advanceIntegrating`(588/692)
- **Phase/Outcome：** varies — 由调用者传入 `outcome` 参数
- **Terminal?** **YES** — `Memory.kernel.expansion = undefined`（line 715）
- **进 rhythm ring?** depends on outcome — `toOutcomeKind` 对 PHASE_CLAIM + SUCCESS 返回 undefined（不进 ring）
- **写 lastExpansionOutcome?** **YES** — recordExpansionOutcome 在 abortExpansion 内部调用
- **UOEM 映射：** `OutcomeEvent { kind: "outcome", outcomeCode: varies, forcedAdvance: false }`

#### P11: bootstrap abandon（特殊情况）

- **位置：** line 895
- **调用者：** `runBootstrapLane`
- **Phase/Outcome：** `PHASE_PIONEER(1) / OUTCOME_ABORTED(4)` via direct `recordEvent`
- **Terminal?** **YES** — bootstrap room 被放弃
- **进 rhythm ring?** **NO** — 不经过 `recordExpansionOutcome`，直接调 `recordEvent`
- **写 lastExpansionOutcome?** **NO** — 不经过 `recordExpansionOutcome`
- **UOEM 映射：** `OutcomeEvent { kind: "outcome", outcomeCode: ABANDONED, forcedAdvance: false }`
- **关键发现：** 这是唯一一个不经过 `recordExpansionOutcome` 的 outcome 事件，不进 rhythm ring 也不写 lastExpansionOutcome

---

## 3. Milestone vs Terminal 分类

### Milestones（Operation 继续运行）

| Producer | 状态转换 | 原因 | UOEM Kind |
|----------|---------|------|-----------|
| P1 | claiming → claimed | claim success, Operation continues | MilestoneEvent("CLAIMED") |
| P5 | bootstrapping → economic_startup | timeout but spawn exists, forced advance | MilestoneEvent("FORCED_ADVANCE") |
| P7 | economic_startup → integrating | timeout but CP3 passed, forced advance | MilestoneEvent("FORCED_ADVANCE") |

### Terminal Outcomes（Operation 终止）

| Producer | 状态转换 | 原因 | UOEM Kind |
|----------|---------|------|-----------|
| P2 | bootstrapping → abort | lost vision | OutcomeEvent(LOST) |
| P3 | bootstrapping → abort | stolen by enemy | OutcomeEvent(STOLEN) |
| P4 | bootstrapping → abort | squad wiped | OutcomeEvent(LOST) |
| P6 | economic_startup → abort | lost room | OutcomeEvent(LOST) |
| P8 | integrating → completed | full success | OutcomeEvent(SUCCESS) |
| P9 | integrating → completed | timeout but positive, forced | OutcomeEvent(SUCCESS, forcedAdvance=true) |
| P10 | any → abort | various failures | OutcomeEvent(varies) |
| P11 | bootstrap → abandon | bootstrap abandon | OutcomeEvent(ABANDONED) |

**Milestone count: 3**  
**Terminal count: 8**  
**Total producers: 11**

---

## 4. startedAt Mutation Matrix (TMP-1)

### 所有赋值点

| # | 行号 | 上下文 | startedAt 赋值为 | 影响 duration 计算? |
|---|------|--------|-----------------|-------------------|
| M1 | 194 | tryConsumePlan | `ctx.tick` (initial) | 初始值 |
| M2 | 218 | advanceExecutionStateMachine (validating→preparing) | `ctx.tick` | 覆盖初始值 |
| M3 | 233 | advanceExecutionStateMachine (claimed→bootstrapping) | `ctx.tick` | 覆盖 |
| M4 | 325 | advancePreparing (→claiming) | `ctx.tick` | 覆盖 |
| M5 | 345 | advanceClaiming (→claimed) | `ctx.tick` | 覆盖 |
| M6 | 429 | advanceBootstrapping (→economic_startup, CP2) | `ctx.tick` | 覆盖 |
| M7 | 462 | advanceBootstrapping (timeout→economic_startup) | `ctx.tick` | 覆盖（强推） |
| M8 | 559 | advanceEconomicStartup (→integrating) | `ctx.tick` | 覆盖 |
| M9 | 573 | advanceEconomicStartup (timeout→integrating) | `ctx.tick` | 覆盖（强推） |

### 关键发现

**`startedAt` 在每次状态转换时被覆盖为 `ctx.tick`。**  
**`duration` 在 `recordExpansionOutcome` 中计算为 `tick - expansion.startedAt`（line 724, 734）。**  
**这意味着 duration 只反映最后一个状态的持续时间，不是整个 Operation 的持续时间。**

### UOEM 证明

```
UOEM OperationInterval.openedAt ≠ expansion.startedAt
openedAt = Operation 创建时铸造，永不修改
startedAt = 每次状态转换覆盖

UOEM computeDuration(interval) = interval.closedAt - interval.openedAt
不读取 expansion.startedAt

即使 expansion-manager 后续修改自己的 startedAt，
UOEM interval.openedAt 不受影响。
```

---

## 5. operationId 来源分析 (EXP-2)

### 当前 Runtime 中的 identity 来源

| 字段 | 来源 | 持久? | 稳定? | 全局 reset 后? |
|------|------|-------|-------|----------------|
| `expansion.planId` | tryConsumePlan 从 Plan 携带 | YES (Memory) | YES | 保留 |
| `expansion.target` | tryConsumePlan 从 Plan 携带 | YES (Memory) | YES | 保留 |
| `expansion.startedAt` | tryConsumePlan 写入 | YES (Memory) | **NO** (覆盖) | 保留但被覆盖 |
| `expansion.decisionId` | collectExpansionDecisions 写入 | YES (Memory) | YES (within lifecycle) | **可能重新生成** |
| `processedExpansionPlanIds` | decision-trace heap Set | **NO** (heap) | N/A | **丢失** |

### EXP-2 核心问题：global reset 后 operationId 会重复生成吗？

**真实代码路径：**

1. Global reset → heap 清空 → `processedExpansionPlanIds` Set 丢失
2. `Memory.kernel.expansion` 保留（Memory 持久化）
3. `decision-trace-system` 下一 tick 运行 → `collectExpansionDecisions` 
4. 检查 `processedExpansionPlanIds.has(dedupKey)` → **false**（Set 被清空）
5. 生成新的 `decisionId = makeDecisionId(tick, ++cache.seq)` → **新的 decisionId**
6. 写入 `expansion.decisionId` → **覆盖旧值**

**结论：** global reset 后，同一个 Operation 会获得新的 `decisionId`。旧 `lastExpansionOutcome.decisionId` 与新 `expansion.decisionId` 不匹配，experience-collector 的 fallback 逻辑（target + completedTick > decisionTick）会尝试匹配，但 `lastExpansionOutcome` 也是 heap-only，reset 后也丢失。

### UOEM operationId 设计

UOEM 的 `operationId = createOperationId(target, consumeTick)` 是**确定性纯函数**：
- 输入相同 → 输出相同
- 不依赖 heap state
- 不依赖 Set
- 不依赖 seq counter
- global reset 后，只要 `Memory.kernel.expansion` 保留了 `target` 和初始 `startedAt`（consume tick），可以重新推导出相同的 operationId

**但当前代码没有保存 consume tick！** `startedAt` 被反复覆盖，原始 consume tick 丢失。

### 结论

UOEM operationId 的设计（`op:{target}:{consumeTick}`）是正确的，但需要 STEP 2 在 Producer Migration 时引入 `openedAt` 字段到 `Memory.kernel.expansion`，在 `tryConsumePlan` 时铸造并永不修改。当前 Runtime 无法提供稳定的 operationId。

---

## 6. lastExpansionOutcome 分析 (single-slot latest-wins)

### 结构

```typescript
globalCache().lastExpansionOutcome = {
  target: string,
  outcomeCode: number,
  completedTick: number,
  duration: number,
  startedAt: number,  // 被反复覆盖的值
  decisionId?: string,
}
```

### 行为

| 属性 | 答案 |
|------|------|
| 谁写？ | `recordExpansionOutcome`（P1-P10），不包含 P11 |
| 谁读？ | `experience-collector-system.ts` buildOutcomeCollectionInput |
| 是否可能覆盖？ | **YES** — 每次 `recordExpansionOutcome` 调用都覆盖 |
| 是否跨 operation？ | **YES** — P1 写入后，P8 覆盖，属于同一 Operation 的不同阶段 |
| 是否跨 restart？ | **NO** — heap-only，global reset 丢失 |
| 是否会导致 event loss？ | **YES** — P1 (milestone) 被写入后，如果 P2 (terminal) 发生，P1 的数据被覆盖 |
| UOEM 是否替代它？ | **YES** — OutcomeChannel 只存 terminal events，MilestoneEvent 不进入 |

### 关键风险

**P1 (claim success milestone) 写入 lastExpansionOutcome 后，如果 experience-collector 在 P2 (terminal failure) 发生前读取，会错误地把 claim success 当作 terminal SUCCESS。**

这正是 EXP-1 的根因：`lastExpansionOutcome` 不区分 milestone 和 terminal。

---

## 7. forcedAdvance 语义分析

### forcedAdvance 出现的路径

| Producer | forcedAdvance 实际语义 | 当前代码如何表达 | UOEM 如何表达 |
|----------|----------------------|----------------|---------------|
| P5 | timeout but spawn exists → 强推到 economic_startup | `OUTCOME_TIMEOUT` via recordExpansionOutcome | MilestoneEvent, forcedAdvance=true |
| P7 | timeout but CP3 passed → 强推到 integrating | `OUTCOME_SUCCESS` via recordExpansionOutcome | MilestoneEvent, forcedAdvance=true |
| P9 | timeout but netFlow>0 → 强推到 completed | `OUTCOME_SUCCESS` via recordExpansionOutcome | OutcomeEvent, forcedAdvance=true |

### 关键证明

```
P5: forcedAdvance=true + MilestoneEvent → isTerminalEvent = false ✅
P7: forcedAdvance=true + MilestoneEvent → isTerminalEvent = false ✅
P9: forcedAdvance=true + OutcomeEvent → isTerminalEvent = true ✅
```

forcedAdvance 不改变 event.kind，不改变 terminality。

---

## 8. OutcomeChannel Migration Contract（未来实施约束）

### 禁止双写

```
Producer → lastExpansionOutcome    (旧路径)
Producer → OutcomeChannel.emit()   (新路径)

不允许同时双写，除非 architecture 明确允许且有幂等证明。
```

### 迁移路径

```
Phase A (Shadow): Producer 同时写 lastExpansionOutcome + OutcomeChannel
                   Consumer 只读 lastExpansionOutcome
                   验证两者一致性

Phase B (Switch): Producer 只写 OutcomeChannel
                   Consumer 改读 OutcomeChannel.drain()
                   lastExpansionOutcome 废弃

Phase C (Cleanup): 删除 lastExpansionOutcome
```

### Producer → UOEM 映射规则

```
recordExpansionOutcome 调用时：
  1. 判断当前 state 是否 terminal
     - 如果 state 紧跟 Memory.kernel.expansion = undefined → terminal
     - 如果 state 只是中间状态转换 → milestone
  2. 如果 milestone → MilestoneEvent (不进 OutcomeChannel)
  3. 如果 terminal → OutcomeEvent (进 OutcomeChannel.emit)
  4. 不再写 lastExpansionOutcome
```

### 终态判定规则（不依赖 outcomeCode）

| 条件 | kind |
|------|------|
| `Memory.kernel.expansion = undefined` after call | OutcomeEvent |
| `Memory.kernel.expansion` still exists, state changed | MilestoneEvent |

---

## 9. Summary

| 指标 | 值 |
|------|-----|
| Producer count | 11 |
| Milestone count | 3 (P1, P5, P7) |
| Terminal count | 8 (P2, P3, P4, P6, P8, P9, P10, P11) |
| Ambiguous count | 0 (all 11 can be unambiguously classified) |
| startedAt mutation points | 9 (M1-M9) |
| lastExpansionOutcome writers | 1 (recordExpansionOutcome) |
| lastExpansionOutcome readers | 1 (experience-collector) |
| Producers not through recordExpansionOutcome | 1 (P11 bootstrap abandon) |
