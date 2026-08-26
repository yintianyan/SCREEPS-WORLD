# Phase 38 · TIMEOUT Semantics Audit — Expansion State Machine

> 性质：补充审计文档，由 Phase 37 代码审查第 3 项发现触发。
> 日期：2026-08-26
> 裁决：**ARCHITECTURE_BLOCKED** — 当前 State Machine / Outcome Contract 存在语义冲突，
> 必须在 UOEM Implementation 前解决。

---

## 0. 审计缘由

Phase 37 代码审查发现三处 timeout 强推路径的终态语义不一致：

| 函数 | 条件 | 记录的 Outcome | 操作是否终止？ |
|---|---|---|---|
| `advanceBootstrapping` :458 | timeout + spawn exists | **OUTCOME_TIMEOUT** | ❌ 否——强推到 `economic_startup` |
| `advanceEconomicStartup` :571 | timeout + cp3 passed | **OUTCOME_SUCCESS** | ❌ 否——强推到 `integrating` |
| `advanceIntegrating` :686 | timeout + netFlow>0 + integrated | **OUTCOME_SUCCESS** | ✅ 是——强推到 `completed`（终态） |

这意味着 `OUTCOME_TIMEOUT` 不一定代表 Terminal Failure，
甚至可能代表 **TIMEOUT AS MILESTONE / TIMEOUT AS TRANSITION**。
而现有 Outcome Code 体系将所有写入都视为同一通道的终态事件——
与本阶段正在建立的 Event / Milestone / Terminal Outcome 三层语义存在潜在冲突。

---

## 1. 完整 Producer 表（真实代码证据）

以下是对 `expansion-manager.ts` 中所有 `recordExpansionOutcome` 和 `abortExpansion` 调用点的全量追踪。

### 1.1 直接 `recordExpansionOutcome` 调用

| # | 行号 | 函数 | 当前状态 | 触发条件 | Phase | Outcome Code | Terminal? | 写后状态转换 | Operation 继续？ |
|---|---|---|---|---|---|---|---|---|---|
| P1 | :346 | `advanceClaiming` | claiming→claimed | controller.my | CLAIM(0) | SUCCESS(0) | ❌ MILESTONE | state=claimed | ✅ 继续 |
| P2 | :394 | `advanceBootstrapping` | bootstrapping | lost vision | PIONEER(1) | LOST(3) | ✅ Terminal* | →abortExpansion(:401) | ❌ 终止 |
| P3 | :397 | `advanceBootstrapping` | bootstrapping | stolen | PIONEER(1) | STOLEN(1) | ✅ Terminal* | →abortExpansion(:401) | ❌ 终止 |
| P4 | :447 | `advanceBootstrapping` | bootstrapping | squad wiped | PIONEER(1) | LOST(3) | ✅ Terminal* | →abortExpansion(:450) | ❌ 终止 |
| P5 | :458 | `advanceBootstrapping` | bootstrapping | timeout + spawn exists | PIONEER(1) | TIMEOUT(2) | ❌ **MILESTONE** | state→economic_startup | ✅ **继续** |
| P6 | :483 | `advanceEconomicStartup` | economic_startup | lost room | PIONEER(1) | LOST(3) | ✅ Terminal* | →abortExpansion(:486) | ❌ 终止 |
| P7 | :571 | `advanceEconomicStartup` | economic_startup | timeout + cp3 passed | PIONEER(1) | SUCCESS(0) | ❌ **MILESTONE** | state→integrating | ✅ **继续** |
| P8 | :661 | `advanceIntegrating` | integrating→completed | CP5 passed | PIONEER(1) | SUCCESS(0) | ✅ Terminal | state=completed, Memory cleared | ❌ 完成 |
| P9 | :686 | `advanceIntegrating` | integrating→completed | timeout + netFlow>0 + integrated | PIONEER(1) | SUCCESS(0) | ✅ Terminal(forced) | state=completed, Memory cleared | ❌ 完成 |

### 1.2 `abortExpansion` 调用（内部再调 `recordExpansionOutcome` :704）

| # | 行号 | 调用者 | 触发条件 | 传入 Outcome | Phase（abort 内决） | Terminal? | 写后 |
|---|---|---|---|---|---|---|---|
| A1 | :240 | `claimed` case | no viable anchor | ABORTED(4) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A2 | :332 | `advancePreparing` | timeout | TIMEOUT(2) | CLAIM(0) | ✅ Terminal | Memory cleared |
| A3 | :356 | `advanceClaiming` | stolen | STOLEN(1) | CLAIM(0) | ✅ Terminal | Memory cleared |
| A4 | :365 | `advanceClaiming` | timeout | TIMEOUT(2) | CLAIM(0) | ✅ Terminal | Memory cleared |
| A5 | :377 | `advanceClaiming` | claimer lost + hostile | LOST(3) | CLAIM(0) | ✅ Terminal | Memory cleared |
| A6 | :401 | `advanceBootstrapping` | (after P2/P3 direct write) | LOST(3) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A7 | :450 | `advanceBootstrapping` | (after P4 direct write) | LOST(3) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A8 | :466 | `advanceBootstrapping` | timeout + no spawn | TIMEOUT(2) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A9 | :486 | `advanceEconomicStartup` | (after P6 direct write) | LOST(3) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A10 | :577 | `advanceEconomicStartup` | timeout + no cp3 | TIMEOUT(2) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A11 | :588 | `advanceIntegrating` | lost room | LOST(3) | PIONEER(1) | ✅ Terminal | Memory cleared |
| A12 | :692 | `advanceIntegrating` | timeout + no netFlow | TIMEOUT(2) | PIONEER(1) | ✅ Terminal | Memory cleared |

### 1.3 其他直接 `recordEvent` 调用

| # | 行号 | 调用者 | 触发条件 | 传入 [phase, outcome, duration] | Terminal? |
|---|---|---|---|---|---|
| E1 | :895 | `runBootstrapPipeline` | abandon decision | [1, 4, 0] (PIONEER, ABORTED, 0) | ✅ Terminal |

### 1.4 配对双写路径（同一 tick 两次 `recordExpansionOutcome`）

| 路径 | 第 1 写 | 第 2 写 (abort) | 说明 |
|---|---|---|---|
| P2→A6 | :394 LOST | :401 LOST (via abort) | 同 tick 双写 LOST |
| P3→A6 | :397 STOLEN | :401 LOST (via abort) | ⚠️ STOLEN 被覆写为 LOST |
| P4→A7 | :447 LOST | :450 LOST (via abort) | 同 tick 双写 LOST |
| P5→A8 | :458 TIMEOUT | :466 TIMEOUT (via abort) | ⚠️ P5 是 milestone 但 A8 是 terminal |

**注**：P5→A8 路径在 spawn 不存在时：P5 先写 TIMEOUT（非 terminal），
然后立刻进入 abortExpansion 再写一次 TIMEOUT（terminal）——
同一 tick 内 lastExpansionOutcome 被覆盖两次，第二次是 terminal，collector 只看到第二次。
但 rhythm ring 会收到两次写入。

---

## 2. 八项检查

### Q1: OUTCOME_TIMEOUT 是否永远意味着 Operation Terminal？

**否。** P5 (:458) 是反例：

```
bootstrapping timeout + spawn exists
→ recordExpansionOutcome(PHASE_PIONEER, OUTCOME_TIMEOUT)  // 写入 lastExpansionOutcome
→ expansion.state = "economic_startup"                      // Operation 继续！
→ expansion.startedAt = ctx.tick                             // 重置计时器
→ return                                                    // 同 tick 结束
```

此路径中 `OUTCOME_TIMEOUT` 被写入 outcome 通道（lastExpansionOutcome + rhythm ring + eventLog），
但 Operation 明确继续运行。这是 **TIMEOUT AS TRANSITION**，不是 Terminal Failure。

### Q2: 如果 timeout 后 Operation 仍然继续运行，它应该是什么？

**Lifecycle Event (Milestone)**。

根据 UOEM 模型（§2.1 公理 A1），Outcome Event 只能由终态判定产生。
P5 的 timeout + spawn exists 是一个状态转换条件，不是终态判定——
Operation 从 bootstrapping 转入 economic_startup，并未终止。

在 UOEM 分类下，P5 应为 `MilestoneEvent("FORCED_ADVANCE", at: tick)`，
而非 `OutcomeEvent`。

但当前代码没有这一层——它直接复用 `recordExpansionOutcome`（唯一 outcome 通道）来表达 milestone。

### Q3: 是否存在 TIMEOUT → later SUCCESS？

**是。** 两条路径：

**路径 A（P5→P7→P8/P9）**：
```
T0    bootstrapping timeout + spawn exists
      → P5: record TIMEOUT  (milestone, operation continues)
T1    economic_startup timeout + cp3 passed
      → P7: record SUCCESS  (milestone, operation continues)
T2    integrating CP5 passed or timeout+netFlow>0+integrated
      → P8/P9: record SUCCESS  (terminal)
```
时间线：TIMEOUT → SUCCESS → SUCCESS

**路径 B（P5→P7→A12）**：
```
T0    bootstrapping timeout + spawn exists
      → P5: record TIMEOUT  (milestone)
T1    economic_startup timeout + no cp3
      → A10: record TIMEOUT  (terminal)
```
时间线：TIMEOUT → TIMEOUT（第一次 milestone，第二次 terminal）

### Q4: 是否存在 TIMEOUT → later FAILURE？

**是。** 路径 P5→A10：
```
T0    bootstrapping timeout + spawn exists
      → P5: record TIMEOUT  (milestone, operation continues to economic_startup)
T1    economic_startup timeout + no cp3
      → A10: record TIMEOUT  (terminal, Memory cleared)
```
此处第一次 TIMEOUT 不是 terminal，第二次才是。

### Q5: 是否存在 SUCCESS → later FAILURE？

**是。** 路径 P7→A11/A12：
```
T0    economic_startup timeout + cp3 passed
      → P7: record SUCCESS  (milestone, operation continues to integrating)
T1    integrating lost room
      → A11: record LOST  (terminal)
```
或：
```
T1    integrating timeout + no netFlow
      → A12: record TIMEOUT  (terminal)
```
时间线：SUCCESS → LOST/TIMEOUT

### Q6: 是否存在多个 SUCCESS？

**是。** 正常流主路径：
```
T0    claiming→claimed
      → P1: record SUCCESS  (milestone, CLAIM phase)
T1    economic_startup timeout + cp3 passed
      → P7: record SUCCESS  (milestone, PIONEER phase)
T2    integrating CP5 passed
      → P8: record SUCCESS  (terminal, PIONEER phase)
```
时间线：SUCCESS → SUCCESS → SUCCESS（三次写入，最后一次才是 terminal）

**且 P1 的 phase=CLAIM(0)，P7/P8/P9 的 phase=PIONEER(1)**——
`toOutcomeKind` 对 `phase=0 + SUCCESS` 返回 `undefined`（不进 rhythm ring），
对 `phase=1 + SUCCESS` 返回 `"success"`（进 rhythm ring）。
⇒ P1 不污染 rhythm ring，但 P7 会——P7 是 milestone 却被 rhythm 当作 success。

### Q7: 是否存在多个 TIMEOUT？

**是。** 路径 P5→A10（同 Q4）。
此外 P5→A8 路径中，同一 tick 内可能产生两次 TIMEOUT（P5 milestone + A8 terminal）。

### Q8: 是否存在 timeout 后重新进入正常状态？

**是。** 所有三条强推路径都从 timeout 恢复到正常状态转换：

| 路径 | timeout 函数 | 恢复到 | 恢复条件 |
|---|---|---|---|
| P5 | advanceBootstrapping | economic_startup | spawn exists |
| P7 | advanceEconomicStartup | integrating | cp3 passed |
| P9 | advanceIntegrating | completed | netFlow>0 + integrated |

---

## 3. 与 UOEM 模型的冲突分析

### 3.1 UOEM 公理 A1 (Terminality) 被违反

> "每个 Operation 至多一个 Outcome Event（终态唯一）。中间里程碑不是 Outcome Event。"

当前代码在一个 Operation 的生命周期内最多产生 **7 次** `recordExpansionOutcome` 调用：
P1 + P5 + P7 + P8 = 4 次 SUCCESS/TIMEOUT 写入 + 3 次 abort 写入。

### 3.2 UOEM 公理 A2 (Identity) 被间接违反

`lastExpansionOutcome` 单槽被 milestone 覆盖——
collector 可能在测量窗口到期时读到 milestone 的 SUCCESS/TIMEOUT 而非 terminal 的最终 Outcome。

### 3.3 UOEM §2.7 明确排除项 vs 实际代码

UOEM 文档 §2.7 列出了"永远不能当 Outcome"的情况：
1. 状态机中间转换 → Milestone
2. 超时触发的强推进 → Milestone + forcedAdvance 标志
3. checkpoint 通过 → Milestone

但 P1(:346)、P5(:458)、P7(:571) 三处代码**已经在用 `recordExpansionOutcome`** 写入这些 milestone——
它们不是"应该改为 Milestone"，而是**当前就在 outcome 通道里制造污染**。

### 3.4 UOEM 第四部分已识别但未解决的冲突

UOEM 文档第四部分第 1 条已标注：
> ":346/:571 两处 milestone 误用 OUTCOME_SUCCESS（EXP-1 核心）"

但**漏列了 P5 (:458)**——bootstrapping timeout + spawn exists 的 milestone 语义。
P5 记录的是 `OUTCOME_TIMEOUT` 而非 `OUTCOME_SUCCESS`，但问题本质相同：milestone 被写入 outcome 通道。

---

## 4. 四条 Invariant 验证

### I11 — Terminal Semantics

> `event.outcomeCode == terminal outcome` 不能仅由 `event.type == TIMEOUT` 推导。
> 必须由 Operation State Machine 的 terminal transition 决定。

**当前代码：不满足。**

`recordExpansionOutcome` 被用于 milestone（P1, P5, P7）和 terminal（P8, P9, A1-A12）两种语义。
调用者无法从 outcome code 推断这是 terminal 还是 milestone。
`lastExpansionOutcome` 单槽不区分事件性质——collector 看到 TIMEOUT 不知道这是 transition 还是 terminal failure。

### I12 — Continuation Safety

> 如果 operation continues after event，则 event MUST NOT resolve the operation。

**当前代码：不满足。**

P5 (:458) 后 Operation 继续运行，但 `lastExpansionOutcome` 已被写入 `{outcomeCode: TIMEOUT}`。
如果 collector 在 P5 后、terminal 前到达测量窗口，它会把这个 milestone TIMEOUT 当作 terminal outcome 来 FINALIZE Experience。

### I13 — Finality

> 只有 operation reaches terminal state 才能生成 TerminalOutcome。

**当前代码：不满足。**

P1 (:346)、P5 (:458)、P7 (:571) 三处在非 terminal 状态下生成了 Outcome Record。
terminal state 只在 `completed` 和 `abortExpansion` 路径中达成。

### I14 — Monotonic Resolution

> 一旦 TerminalOutcome 被确定，后续 lifecycle event 不得改变已经解析的 terminal outcome。

**当前代码：部分满足。**

`abortExpansion` 和 `completed` 路径会清除 `Memory.kernel.expansion`（:673, :715），
此后不再有 `recordExpansionOutcome` 调用。所以 terminal outcome 写入后不会被后续 lifecycle event 覆盖。

但：P8/P9 (`completed` 路径) 之后 Memory 被清除，如果同一 tick 有残余代码路径访问 `expansion` 对象（如 dashboard 写入 :277-288），可能读到已清除的状态——这不是 outcome 覆盖问题，是 use-after-free 问题，不在此审计范围。

**裁决：I14 满足，但 I11/I12/I13 均不满足。**

---

## 5. ARCHITECTURE_BLOCKED 声明

### 冲突位置

| 冲突 | 代码位置 | 当前语义 | 应有语义 |
|---|---|---|---|
| P1 :346 | advanceClaiming claim success | recordExpansionOutcome(SUCCESS) | MilestoneEvent("CLAIMED") |
| P5 :458 | advanceBootstrapping timeout+spawn | recordExpansionOutcome(TIMEOUT) | MilestoneEvent("FORCED_ADVANCE") |
| P7 :571 | advanceEconomicStartup timeout+cp3 | recordExpansionOutcome(SUCCESS) | MilestoneEvent("FORCED_ADVANCE") |
| P2→A6 :394+:401 | bootstrapping lost vision → abort | 双写 LOST+LOST | 仅 terminal LOST |
| P3→A6 :397+:401 | bootstrapping stolen → abort | 双写 STOLEN+LOST | 仅 terminal LOST（或 STOLEN） |
| P4→A7 :447+:450 | bootstrapping squad wiped → abort | 双写 LOST+LOST | 仅 terminal LOST |
| P5→A8 :458+:466 | bootstrapping timeout+no spawn | 双写 TIMEOUT+TIMEOUT | 仅 terminal TIMEOUT |

### 不能直接修复的原因

1. **`recordExpansionOutcome` 承担三重职责**：
   - 事件日志写入 (`recordEvent`)
   - `lastExpansionOutcome` 写入（供 A6 collector 消费）
   - `expansionRhythm` ring 更新（供扩张节奏控制消费）

   将 milestone 从 outcome 通道移出需要同时处理三者的消费者。
   rhythm ring 目前会把 P5 的 TIMEOUT 当作一次失败来累计——
   如果 P5 改为 Milestone，rhythm ring 的连续失败计数语义会改变（不再计入 bootstrapping timeout+强推）。

2. **配对双写路径** (P2→A6 等) 中，第一次写入是为了在 `abortExpansion` 之前记录更精确的 outcome code（STOLEN vs LOST），但 `abortExpansion` 会再次写入。在 UOEM 模型下，`enqueue` 的幂等性会拒绝第二次写入——但这意味着第一次写入（STOLEN）会保留，而 `abortExpansion` 的 LOST 被丢弃。这改变了 rhythm ring 的语义。

3. **P5→A8 同 tick 路径**：P5 (milestone TIMEOUT) 和 A8 (terminal TIMEOUT) 在同一 tick 内执行。
   如果 P5 改为 Milestone（不进 outcome 通道），则 A8 的 terminal TIMEOUT 是唯一的 outcome——正确。
   但如果 P5 不走 `abortExpansion`（spawn 存在时），则没有 terminal outcome——也正确（operation 继续）。
   只有 P5 后 spawn 不存在→A8 路径需要确保 A8 是唯一写入。

### 建议的 UOEM 实施路径修正

UOEM 文档 §2.5 的时序图已正确表达了 Milestone vs Outcome 分离：
- `T1 claim 成功 → Milestone(CLAIMED)` [不产生 Outcome]
- `T1' econ_startup 超时 & cp3 → Milestone(FORCED_ADVANCE)` [不产生 Outcome]

但文档第四部分"明确不修复"列表需要**增加 P5 (:458)** 并标注为 ARCHITECTURE_BLOCKED，
因为它不是单纯代码修复，而是需要 UOEM 的 kind 分离机制才能正确表达。

---

## 6. 对 UOEM 模型的补充要求

### 6.1 TIMEOUT 语义必须三态化

当前 `OUTCOME_TIMEOUT(2)` 是一个值承担三种语义：

| 语义 | 当前 code | 应映射到 |
|---|---|---|
| TIMEOUT as Terminal Failure | 2 (via abortExpansion) | OutcomeEvent(result: "TIMED_OUT") |
| TIMEOUT as Transition (P5) | 2 (via recordExpansionOutcome) | MilestoneEvent("FORCED_ADVANCE") |
| TIMEOUT as Forced Success (P9) | 0 (SUCCESS, via recordExpansionOutcome) | OutcomeEvent(result: "COMPLETED_FORCED", forcedAdvance: true) |

UOEM 的 `OperationResult` 已经定义了 `"COMPLETED_FORCED"` 和 `forcedAdvance: boolean` 字段——
这足以区分 P9 (forced success) 和 P8 (natural success)。
但 P5 的 transition timeout 需要**新的 MilestoneEvent** 而非 OutcomeEvent。

### 6.2 强推路径的 forcedAdvance 标志传播

P5 (:458) 强推后，Operation 进入 economic_startup。
如果后续在 integrating 阶段 P9 (:686) 强推完成，
P9 的 `forcedAdvance` 标志应该**包含 P5 的历史**——即经历过任何强推的 Operation，
其 terminal outcome 的 `forcedAdvance` 应为 true。

当前代码没有 `forcedAdvance` 字段——UOEM 模型需要定义其传播规则：
- `forcedAdvance = true` if Operation 历史上经历过任何 Milestone("FORCED_ADVANCE")

### 6.3 rhythm ring 消费者的影响

`expansionRhythm` ring 当前消费 `recordExpansionOutcome` 写入的 outcome kind。
如果 P5/P7 改为 Milestone，rhythm ring 不再收到这些写入——
`consecutiveFailures` 计数语义改变（bootstrapping timeout+强推不再计入失败）。

**裁决：这是正确的行为**。bootstrapping timeout+spawn exists 不是失败——
Operation 继续运行并可能最终成功。将它计入 consecutiveFailures 是当前代码的语义缺陷。

但 rhythm ring 的消费者（`evaluateExpansionRhythm`）可能依赖当前的（错误的）计数行为。
必须在 Implementation Phase 验证 rhythm ring 消费者的兼容性。

---

## 7. 反事实测试要求（T1-T5）

以下测试必须在 Phase 38 证明阶段通过，方可进入 Implementation。

### T1: bootstrapping timeout → economic_startup → final success

**场景**：
```
T0     Decision: EXPANSION_START_W1N1 (opId=op:W1N1:T0)
T0+5k  bootstrapping timeout + spawn exists
       → P5: Milestone(FORCED_ADVANCE)  [不进 outcome 通道]
       → state = economic_startup
T0+15k economic_startup CP3+CP4 passed
       → state = integrating
T0+25k integrating CP5 passed
       → P8: Outcome(result: COMPLETED)
```

**验证**：
- collector 读到的唯一 Outcome 是 `COMPLETED`，不是 `TIMEOUT`
- `forcedAdvance = true`（经历过 P5 强推）
- `duration = 25000`（T0 到 T0+25k 的完整区间）

### T2: bootstrapping timeout → economic_startup → final failure

**场景**：
```
T0     Decision: EXPANSION_START_W1N1 (opId=op:W1N1:T0)
T0+5k  bootstrapping timeout + spawn exists
       → P5: Milestone(FORCED_ADVANCE)
       → state = economic_startup
T0+15k economic_startup timeout + no cp3
       → A10: Outcome(result: TIMED_OUT)
```

**验证**：
- collector 读到的唯一 Outcome 是 `TIMED_OUT`
- `forcedAdvance = true`
- `duration = 15000`（T0 到 T0+15k）

### T3: bootstrapping timeout → collector runs immediately after timeout

**场景**：
```
T0       Decision: EXPANSION_START_W1N1 (opId=op:W1N1:T0)
T0+2000  measurement delay reached
T0+5000  bootstrapping timeout + spawn exists
         → P5: Milestone(FORCED_ADVANCE) [不进 outcome 通道]
T0+5001  collector runs — no Outcome in channel → pending (UNRESOLVED)
T0+25000 integrating CP5 passed
         → P8: Outcome(result: COMPLETED)
T0+25001 collector runs — Outcome found → attach SUCCESS
```

**验证**：
- T0+5001 时 collector 不能把 P5 的 timeout 当作 terminal outcome
- channel 中无 Outcome → pending 继续（诚实等待）
- T0+25001 时读到 `COMPLETED`

### T4: bootstrapping timeout → reset → operation continues → final success

**场景**：
```
T0      Decision: EXPANSION_START_W1N1 (opId=op:W1N1:T0) in Memory
T0+5k   bootstrapping timeout + spawn exists
        → P5: Milestone(FORCED_ADVANCE)
        → state = economic_startup (Memory persists)
T0+6k   global reset — heap cleared, Memory survives
T0+7k   restart — trace re-emits Decision referencing same opId
T0+25k  integrating CP5 passed
        → P8: Outcome(result: COMPLETED)
```

**验证**：
- reset 不改变最终 Outcome
- opId 在 Memory 中幸存 → 重启后 Outcome 仍能关联到 Experience
- forcedAdvance = true（P5 在 reset 前发生）

### T5: multiple timeout milestones → final success

**场景**：
```
T0      Decision: EXPANSION_START_W1N1
T0+5k   bootstrapping timeout + spawn exists
        → P5: Milestone(FORCED_ADVANCE)
T0+15k  economic_startup timeout + cp3 passed
        → P7: Milestone(FORCED_ADVANCE)
T0+25k  integrating timeout + netFlow>0 + integrated
        → P9: Outcome(result: COMPLETED_FORCED)
```

**验证**：
- 所有 timeout 都是 Milestone，不产生 Outcome
- 最终只有一个 `COMPLETED_FORCED`
- `forcedAdvance = true`
- 不存在多个 terminal outcomes

---

## 8. 最终裁决

### TIMEOUT-SEMANTICS 审计结论

**ARCHITECTURE_BLOCKED**

当前 Expansion State Machine 的 `recordExpansionOutcome` 函数在三种语义下被复用：

1. **Terminal Outcome**（P8, P9, A1-A12）——终态判定，Operation 终止
2. **Milestone as Transition**（P5, P7）——状态转换，Operation 继续
3. **Milestone as Achievement**（P1）——阶段达成，Operation 继续

这三种语义通过同一个函数、同一个 outcome code 体系、同一个 lastExpansionOutcome 单槽写入，
导致 collector 无法区分 milestone 和 terminal，rhythm ring 把 milestone 当作 terminal 来计数。

### UOEM 模型的消解路径

UOEM 模型已经定义了正确的消解机制：
- P1, P5, P7 改为 `MilestoneEvent`，不进入 outcome 通道
- P8, P9 改为 `OutcomeEvent`（唯一终态写入）
- A1-A12 保持 `OutcomeEvent`（通过 abortExpansion 路径）
- 配对双写路径（P2→A6 等）由 channel 幂等性自动消解

但 Implementation 前必须补充：
1. P5 (:458) 加入 UOEM 第四部分"明确不修复"列表
2. rhythm ring 消费者兼容性验证
3. forcedAdvance 标志传播规则定义
4. T1-T5 反事实测试通过

### Phase 38 最终裁决更新

Phase 38 的最终裁决现在必须同时证明以下六项全部能被 UOEM 正确表达：

| # | 问题 | 当前状态 | UOEM 消解 |
|---|---|---|---|
| EXP-1 | Premature SUCCESS / Milestone-as-Outcome | ✅ 已识别 | ✅ kind 分离 |
| EXP-2 | Reset Identity Rebuild | ✅ 已识别 | ✅ opId 铸造 |
| TMP-1 | Duration 谎报 | ✅ 已识别 | ✅ interval 端点 |
| A6-R | recoveryStats 累计污染 | ✅ 已识别 | ✅ paired delta |
| A6-SL | BEFORE/AFTER 错位 | ✅ 已识别 | ✅ paired observation |
| **TIMEOUT-SEMANTICS** | **TIMEOUT 不等于 Terminal** | **本文档新增** | **✅ Milestone vs Outcome 分离 + forcedAdvance 传播** |

**在 TIMEOUT-SEMANTICS 的 T1-T5 反事实测试通过之前，不得进入 Implementation。**
