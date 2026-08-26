# Phase 38-B · UOEM Consumer Compatibility & Architecture Proof — 综合审计

> 性质：架构审计，零生产代码变更。
> 日期：2026-08-26
> 状态：**ARCHITECTURE_BLOCKED**
> 前置：Phase 38 UOEM_ARCHITECTURE_PROOF.md + PHASE38_TIMEOUT_SEMANTICS_AUDIT.md

---

## §1. Outcome Consumer Inventory（全 Repo 消费者矩阵）

### 1.1 完整消费者表

| # | Consumer | 文件 | Input 来源 | 当前语义 | 假设 Outcome=Terminal? | 读取 Milestone? | 依赖 latest? | 依赖顺序? | 依赖 timestamp? |
|---|---|---|---|---|---|---|---|---|---|
| C1 | **rhythm ring (appendOutcome)** | expansion-manager.ts:744 | recordExpansionOutcome → toOutcomeKind | Terminal Outcome | ❌ **否** — P5/P7 milestone 也写入 | ✅ **是** — milestone 被当 outcome 写入 | ❌ 否（ring 追加） | ✅ 顺序敏感 | ❌ 否 |
| C2 | **rhythm ring (evaluateExpansionRhythm)** | expansion-manager.ts:748-758 + rhythm.ts:67-104 | ring 数组 | Terminal Outcome | ✅ **是** — 连续失败计数假设每条都是终态 | N/A（不直接读 milestone，但 milestone 已被 C1 混入 ring） | ❌ 否 | ✅ 顺序敏感 | ❌ 否 |
| C3 | **expansionPausedUntil** | expansion-manager.ts:777 | rhythm result.pauseTicks | N/A（派生） | N/A | N/A | N/A | N/A | N/A |
| C4 | **expansionBlacklist** | expansion-manager.ts:806-809 | rhythm result.blacklistMultiplier | N/A（派生） | N/A | N/A | N/A | N/A | N/A |
| C5 | **lastExpansionOutcome** | global-cache.ts:335 | recordExpansionOutcome | Terminal Outcome | ❌ **否** — 单槽被 milestone 覆盖 | ✅ **是** — milestone 覆盖 terminal | ✅ **是** — latest-wins | ❌ 否 | ✅ completedTick |
| C6 | **experience-collector (buildOutcomeCollectionInput)** | experience-collector-system.ts:413-443 | lastExpansionOutcome | Terminal Outcome | ✅ **是** — 假设读到的是终态 | ❌ 否（只读 lastExpansionOutcome） | ✅ **是** — latest-wins | ❌ 否 | ✅ decisionTick 比较 |
| C7 | **experience-collector (buildAttributionInput)** | experience-collector-system.ts:523-541 | exp.outcome (已 attach) | Resolved Outcome | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 否 |
| C8 | **collectExpansionOutcome (domain)** | outcome.ts:330-356 | OutcomeCollectionInput.expansionOutcome | Terminal Outcome | ✅ **是** — outcome code → classification | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 否 |
| C9 | **collectExpansionAttribution (domain)** | attribution.ts:669-760 | AttributionInput.expansion* | Resolved Outcome | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 否 |
| C10 | **eventLog (recordEvent)** | event-log.ts:211-224 | recordExpansionOutcome:721 | Event Log | ❌ 否（日志记录） | ✅ 是（所有写入都记录） | ❌ 否 | ❌ 否 | ✅ Game.time |
| C11 | **telemetry-collector** | telemetry-collector.ts | eventBuffer | Event Log | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 否 |
| C12 | **recovery-execution-system** | recovery-execution-system.ts:462 | expansionPausedUntil | N/A | N/A | N/A | ✅ 是 | N/A | ✅ tick |
| C13 | **A6.4 Calibration** | calibration/calibration.ts:68 | ResolutionResult[] | Resolved Outcome | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ✅ resolvedTick |
| C14 | **A6.2 Prediction resolve** | prediction/resolve.ts | Prediction + actualValue | Resolved Outcome | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ✅ tick |
| C15 | **A6.5 Reliability** | reliability/ | ResolutionResult[] | Resolved Outcome | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ✅ tick |
| C16 | **A6.6 Recommendation** | recommendation/ | Experience[] + CalibrationProfile[] | Resolved Outcome | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ✅ tick |
| C17 | **minSources 门禁** | expansion-manager.ts (evaluateExpansionRhythm) | rhythm result.minSources | N/A（派生） | N/A | N/A | N/A | N/A | N/A |
| C18 | **lastExpansionCompletedTick** | expansion-manager.ts:664 | recordExpansionOutcome 后直接写 | Terminal | ✅ 是（只在 CP5 终态写） | ❌ 否 | ✅ 是 | ❌ 否 | ✅ tick |

### 1.2 关键发现

**Latest-Wins 假设广泛存在：**

| 消费者 | 假设 | UOEM 冲突 |
|---|---|---|
| C5 lastExpansionOutcome | last = final | ❌ milestone 覆盖 terminal |
| C6 experience-collector | last = final | ❌ 读到 milestone 误当 terminal |
| C12 recovery-execution | last pause = current | ✅ 无冲突（pauseTicks 派生） |
| C18 lastExpansionCompletedTick | last completion = final | ✅ 无冲突（只在终态写） |

**rhythm ring 将 milestone 当作 terminal 计入：**
- C1 (appendOutcome) 接收所有 `recordExpansionOutcome` 调用产生的 `ExpansionOutcomeKind`
- P1 (:346 CLAIM phase SUCCESS) → `toOutcomeKind(0,0)` 返回 `undefined` → **不进 ring**（设计如此）
- P5 (:458 PIONEER phase TIMEOUT) → `toOutcomeKind(1,2)` 返回 `"timeout"` → **进 ring**
- P7 (:571 PIONEER phase SUCCESS) → `toOutcomeKind(1,0)` 返回 `"success"` → **进 ring**
- ⇒ rhythm ring 把 P5 的 transition-timeout 当作 terminal-failure，把 P7 的 forced-success 当作 terminal-success

---

## §2. Rhythm Ring 专项审计

### Q1: rhythm ring 存储的到底是什么？

**追踪路径：**

```
WRITE: recordExpansionOutcome(:720)
  → toOutcomeKind(phase, outcome) → ExpansionOutcomeKind | undefined
  → appendOutcome(ring, kind, ringSize) → ring 数组（旧→新）
  → 存储于 Memory.kernel.expansionRhythm.ring（number[] 编码）
  → codeToKind/kindToCode 转换

STORAGE: Memory.kernel.expansionRhythm = {
  ring: number[],              // kindToCode 后的数字数组
  blacklistMultiplier: number,
  minSources: number,
}

RETENTION: ring 有界，ringSize=8，旧条目溢出丢弃（appendOutcome: next.slice(-ringSize)）

READ: evaluateExpansionRhythm(outcomes, options)
  → recent = outcomes.slice(-ringSize)
  → consecutiveFailures: 从最新往回数非 success
  → stolenWindow: 最近 stolenWindow 条
  → relaxWindow: 最近 relaxWindow 条
  → 输出 RhythmResult

CONSUMERS:
  1. expansionPausedUntil (pauseTicks > 0 → 暂停扩张)
  2. blacklistMultiplier (0.5-1.5 → 黑名单冷却缩放)
  3. minSources (1-2 → 目标选择门禁)
```

**裁决：rhythm ring 存储的是「ExpansionOutcomeKind 序列」——设计意图是 Terminal Outcome，但实际收到的是 milestone + terminal 混合体。**

### Q2: rhythm ring 能否容纳 Milestone + Terminal 两种 Event？

**不能。** 当前 `ExpansionOutcomeKind` 是单态联合类型：
```typescript
type ExpansionOutcomeKind = "success" | "stolen" | "timeout" | "lost" | "aborted";
```

没有 `kind: "MILESTONE" | "OUTCOME"` 区分。所有写入都被平等对待。

### Q3: UOEM 引入 Milestone/Outcome 分离后 rhythm ring 如何处理？

**从消费者倒推分析：**

rhythm ring 的三个消费者都是**统计型消费者**——它们关心的是"最近 N 次扩张的成败率"。

关键语义问题：**P5 (bootstrapping timeout+spawn exists → 强推) 应该被 rhythm 当作什么？**

| 方案 | 语义 | 对 consecutiveFailures 影响 | 对 successRate 影响 |
|---|---|---|---|
| A: 不计入 ring | 强推不是终态结果 | 不增加失败计数 ✓ | 不稀释成功率 ✓ |
| B: 计入 ring 作为 timeout | 强推=失败 | 增加失败计数 ✗（可能触发暂停） | 降低成功率 ✗ |
| C: 计入 ring 作为 forced-success | 强推=成功 | 不增加失败计数 | 提高成功率 ✗（可能过于乐观） |

**裁决：方案 A（不计入 ring）正确。** 强推是 Operation 继续运行的 milestone，不是终态结果。rhythm ring 应该只接收 Terminal Outcome。

但 P7 (:571) 是一个特殊情况：它记录 `OUTCOME_SUCCESS` 但 Operation 继续运行。在 UOEM 下 P7 改为 Milestone 后，rhythm ring 不再收到它——这**改变了 rhythm ring 的行为**（之前 P7 的 "success" 会重置 consecutiveFailures，现在不会）。

**影响评估：**
- 改变前：bootstrapping timeout(P5) + economic_startup forced-success(P7) → ring = ["timeout", "success"]，consecutiveFailures = 0
- 改变后：P5 和 P7 都不进 ring → ring 不变，consecutiveFailures 不变
- **净效果：** 不会因为中间强推就重置失败计数——**更正确**，因为 Operation 还没到终态

**rhythm ring 消费者兼容性：**
- `consecutiveFailures`：语义改善（中间强推不应重置计数）
- `blacklistMultiplier`：语义改善（中间强推不影响成功率统计）
- `minSources`：无影响（只依赖 stolen count）

**结论：rhythm ring 在 UOEM 下可以安全运行——只需将 milestone 从 outcome 通道移出即可，rhythm ring 消费者不需要修改。**

---

## §3. Latest-Wins 假设审计

### 3.1 所有 last/latest 读取点

| 位点 | 字段 | 读取者 | 当前语义 | UOEM 后 |
|---|---|---|---|---|
| global-cache.ts:335 | `lastExpansionOutcome` | C5/C6 | latest = final | ❌ 需替换为 channel.drain() |
| expansion-manager.ts:101 | `expansionPausedUntil` | C12 | latest pause = current | ✅ 无变化（pauseTicks 是派生值） |
| expansion-manager.ts:664 | `lastExpansionCompletedTick` | cooldown 门禁 | latest completion = final | ✅ 无变化（只在终态写） |
| rhythm.ts:71 | `recent = outcomes.slice(-ringSize)` | C2 | last N outcomes | ✅ 无变化（ring 只收 terminal） |

### 3.2 lastExpansionOutcome 的 latest-wins 问题

**当前行为：** `recordExpansionOutcome` 每次调用都覆盖 `lastExpansionOutcome`。

**问题场景：**
```
T0+5k   P5: recordExpansionOutcome(TIMEOUT)  → lastExpansionOutcome = {TIMEOUT}
T0+5k+1 collector 运行 → 读到 TIMEOUT → 误当 terminal → Experience FINALIZED as EXPIRED
T0+25k  P8: recordExpansionOutcome(SUCCESS) → lastExpansionOutcome = {SUCCESS}
         但 Experience 已经 FINALIZED，无人再读
```

**UOEM 消解：**
- `lastExpansionOutcome` 替换为 `OutcomeChannel`（Memory 持久化 FIFO）
- milestone 不进 channel
- collector 只从 channel.drain() 读取 Terminal Outcome
- `lastExpansionOutcome` 可以保留为**便捷缓存**（指向 channel 中最新 terminal outcome），但 collector 不再直接读它

---

## §4. 顺序语义审计

### 4.1 Event Ordering 定义

| 字段 | 含义 | 来源 | 确定性 |
|---|---|---|---|
| `occurredAt` | 事件在状态机中发生的 tick | producer 调用时的 `ctx.tick` | ✅ 确定性 |
| `recordedAt` | 事件被写入 channel 的 tick | 同 `occurredAt`（同步写入） | ✅ |
| `eventId` | `E-{tick}-{seq}` | producer 的自增序号 | ✅ |
| `sequence` | channel 内的全局序号 | channel 的 enqueue 序号 | ✅ |

### 4.2 同 tick 多事件排序

**场景：** P5 (:458 milestone TIMEOUT) 和 A8 (:466 terminal TIMEOUT) 在同一 tick 执行。

**当前行为：** 两次 `recordExpansionOutcome` 调用，单槽被第二次覆盖。

**UOEM 行为：**
- P5 改为 Milestone → 不进 outcome channel → 无排序问题
- A8 是 terminal → 进 outcome channel → 唯一一条

**剩余场景：同一 tick 两个不同 Operation 的 terminal outcome**

```
Operation A (W1N1) terminal TIMEOUT @ tick 1000
Operation B (W2N2) terminal SUCCESS @ tick 1000
```

**排序规则：** `eventId = E-{tick}-{seq}`，seq 由 producer 自增。
- A 的 eventId = `E-1000-1`
- B 的 eventId = `E-1000-2`
- channel 中顺序 = enqueue 顺序 = producer 调用顺序

**确定性保证：** producer 调用顺序由状态机执行顺序决定（`advanceExecutionStateMachine` 单线程串行），因此同 tick 事件的顺序是确定的。

**但：** 同 tick 两个事件具有相同的 `occurredAt`——如果消费者依赖 `occurredAt` 排序，需要 `eventId` 作为 tiebreaker。

**裁决：** `eventId` 包含 seq，保证全局唯一且有序。`operationId` 保证不跨 Operation 混淆。不需要额外排序机制。

### 4.3 Replay 确定性

**要求：** 给定相同的 Operation 事件序列，不同运行产生相同的 Resolution。

**当前 domain 层纯函数（collectOutcome, collectAttribution, calibration）全部确定性**——不依赖 Math.random / Date.now / Map iteration order。

**UOEM channel 的 drain 操作：** `drain()` 返回 FIFO 顺序的数组——确定性。

**裁决：** Replay 确定性满足。

---

## §5. TIMEOUT→SUCCESS/FAILURE 兼容性审计

### 5.1 TIMEOUT→SUCCESS 路径 (P5→P7→P8)

**当前行为：**
```
P5: recordExpansionOutcome(TIMEOUT) → lastExpansionOutcome = {TIMEOUT}
P7: recordExpansionOutcome(SUCCESS) → lastExpansionOutcome = {SUCCESS} (覆盖 P5)
P8: recordExpansionOutcome(SUCCESS) → lastExpansionOutcome = {SUCCESS} (覆盖 P7)
```

collector 如果在 P8 后运行，读到 SUCCESS——**正确**（最终确实是 success）。
collector 如果在 P5 后、P7 前运行，读到 TIMEOUT——**错误**（误当 terminal）。

**UOEM 行为：**
```
P5: MilestoneEvent("FORCED_ADVANCE") → 不进 channel
P7: MilestoneEvent("FORCED_ADVANCE") → 不进 channel
P8: OutcomeEvent(result: COMPLETED, forcedAdvance: true) → channel 中唯一 terminal
```

collector 只读到 P8 的 COMPLETED——**正确且无中间错误**。

### 5.2 TIMEOUT→FAILURE 路径 (P5→A10)

**当前行为：**
```
P5: recordExpansionOutcome(TIMEOUT) → lastExpansionOutcome = {TIMEOUT}
A10: abortExpansion(TIMEOUT) → recordExpansionOutcome(TIMEOUT) → lastExpansionOutcome = {TIMEOUT} (覆盖 P5)
```

collector 在 A10 后读到 TIMEOUT——**碰巧正确**（最终确实是 timeout）。
但 collector 在 P5 后、A10 前读到 TIMEOUT——**语义错误**（P5 是 milestone 不是 terminal）。

**UOEM 行为：**
```
P5: MilestoneEvent → 不进 channel
A10: OutcomeEvent(result: TIMED_OUT, forcedAdvance: true) → channel 中唯一 terminal
```

**裁决：UOEM 正确消解。**

---

## §6. SUCCESS→FAILURE 审计 — milestone vs terminal

### 6.1 P7→A11/A12 路径

**P7 (:571)** 记录 `OUTCOME_SUCCESS` 但 Operation 继续运行（state→integrating）。
**A11 (:588)** 记录 `OUTCOME_LOST`（terminal，integrating 失守）。
**A12 (:692)** 记录 `OUTCOME_TIMEOUT`（terminal，integrating 超时无证据）。

**问题：P7 的 SUCCESS 是 milestone 还是 terminal？**

**答案：Milestone。** P7 后 Operation 明确继续运行（state→integrating，startedAt 重置）。

**SUCCESS→FAILURE 的性质：**
- P7 是 **SUCCESS MILESTONE**（不是 terminal）
- A11/A12 是 **FAILURE TERMINAL**
- ⇒ 这是 "success milestone → failure terminal"，不是 "success terminal → failure"

**UOEM 结论：不存在 "已 terminal 的 operation 还能失败"。** P7 的 SUCCESS 不是 terminal，所以后续 A11/A12 的 FAILURE 不违反 terminal 单调性。

**但如果 collector 在 P7 后误把 milestone SUCCESS 当 terminal → Experience 被 FINALIZED as SUCCESS → 后续 A11/A12 无法修正。** 这是当前代码的实际 bug（EXP-1 的核心）。

---

## §7. forcedAdvance 严格审计

### 7.1 forcedAdvance 的性质

| 属性 | 答案 | 理由 |
|---|---|---|
| 是 State Machine metadata 还是 Outcome？ | **State Machine metadata** | 强推是状态转换方式，不是终态结果 |
| 是否持久化？ | **应该持久化** | 跨 reset 需要保留（reset 后 Operation 继续） |
| 是否进入 Event？ | **进入 OutcomeEvent 字段** | 作为 `forcedAdvance: boolean` 附在 terminal outcome 上 |
| 是否可以被 collector 消费？ | **是** | collector 可以读 `ev.forcedAdvance` 作为归因证据 |
| 是否影响 terminal resolution？ | **否** | 不改变 result 分类，只是 metadata |
| 是否可能被误认为 failure？ | **否** | 它是 boolean 标志，不是 outcome code |
| 是否跨 reset？ | **应该跨 reset** | producer 从 Memory 恢复 forcedAdvance 标志 |
| 是否参与 identity？ | **否** | 不参与 operationId/decisionId |

### 7.2 forcedAdvance ≠ terminal outcome

**证明：** forcedAdvance 是 `boolean`，terminal outcome 是 `ExpansionResult`。它们是正交字段：
```typescript
interface OutcomeEvent {
  result: ExpansionResult;      // 终态结果
  forcedAdvance: boolean;        // 是否经历过强推（metadata）
}
```

一个 Operation 可以有 `forcedAdvance=true` 且 `result=COMPLETED`（强推后成功），
也可以有 `forcedAdvance=true` 且 `result=TIMED_OUT`（强推后仍超时）。

**裁决：forcedAdvance 概念成立，保留。**

---

## §8. Event Channel 幂等性审计

### 8.1 Dedup Key 分析

| 候选 Key | 分析 | 适用？ |
|---|---|---|
| `eventId` | 全局唯一（`E-{tick}-{seq}`），但每次调用都不同 | ❌ 无法去重 |
| `operationId + eventType` | 同一 Operation 的同一 kind 事件 | ⚠️ 需定义 eventType |
| `operationId` | 每 Operation 只允许一条 OUTCOME | ✅ **Terminal Outcome 去重** |
| `decisionId + eventType` | decision 可能被重建（EXP-2） | ❌ decisionId 不稳定 |

### 8.2 什么情况下两个相同 Event 是 duplicate？

**Terminal Outcome：** 同一 `operationId` 的第二条 `OutcomeEvent` 是 duplicate。
因为公理 A1：每 Operation 至多一个 Terminal Outcome。

**Milestone：** 同一 `operationId` 的多条 `MilestoneEvent` **不是** duplicate。
因为一个 Operation 可以有多个 milestone（CLAIMED, FORCED_ADVANCE, CP3_PASSED 等）。

### 8.3 什么情况下两个看起来相同的事件实际上是合法的两个事件？

**场景：TIMEOUT @ 1000 + TIMEOUT @ 2000**

如果都是 `MilestoneEvent("FORCED_ADVANCE")`：
- 同一 Operation 的两次强推是合法的（bootstrapping timeout + economic_startup timeout）
- 它们不是 duplicate
- **但 Milestone 不进 outcome channel**，所以不需要去重

如果都是 `OutcomeEvent(result: TIMED_OUT)`：
- 同一 Operation 两次 terminal outcome是非法的
- 第二条被 `DUPLICATE_REJECTED`

**裁决：dedup key = `operationId`（仅对 OutcomeEvent）。** MilestoneEvent 不需要去重（不进 channel）。

### 8.4 配对双写路径的处理

P2→A6 路径：`:394 recordExpansionOutcome(LOST)` + `:401 abortExpansion(LOST)` → 同 tick 两次写入。

**当前行为：** 两次都写入 lastExpansionOutcome + rhythm ring，第二次覆盖第一次。

**UOEM 行为：**
- P2 (:394) 在 UOEM 下是什么？它是 `advanceBootstrapping` 失明/被夺时记录的 outcome——此时 Operation 终止（→ abortExpansion）。所以 P2 是 **terminal outcome**。
- A6 (:401) `abortExpansion` 内部再调 `recordExpansionOutcome(LOST)` —— 也是 **terminal outcome**。
- 两次 enqueue 同一 `operationId` → 第二条被 `DUPLICATE_REJECTED`。
- **但第一次的 result=LOST 保留，第二次的 result 也是 LOST → 无冲突。**

P3→A6 路径更复杂：P3 记录 STOLEN，A6 记录 LOST——result 不同。

**问题：哪个 result 是正确的？**

从语义看，P3 (:397) 在 bootstrapping 被夺时记录 STOLEN 更准确。A6 (:401) 是 `abortExpansion` 的通用清理，它传入 LOST。

**UOEM 消解：** channel 的幂等性保留第一次写入（STOLEN），拒绝第二次（LOST）。这**更正确**——STOLEN 比 LOST 更精确。

但 rhythm ring 消费者之前会收到两次（STOLEN + LOST），现在只收到一次（STOLEN）。**这是行为改变。**

**影响评估：**
- `consecutiveFailures`：之前 LOST 也会增加失败计数，现在只有 STOLEN → 仍然增加失败计数 ✓
- `blacklistMultiplier`：之前可能被 LOST 稀释成功率，现在只有 STOLEN → 影响可忽略
- `minSources`：stolen count 可能变化——之前 P3 的 STOLEN 被覆盖为 LOST 不计入 stolen count，现在保留 STOLEN 计入 → **更正确**

**裁决：幂等性消解正确且更精确。rhythm ring 消费者兼容。**

---

## §9. Operation Identity 关系审计

### 9.1 身份关系图

```
Operation
  │
  ├── operationId   (op:{target}:{consumeTick}) — consume 时铸造，两界持久
  │
  ├── Decision
  │      └── decisionId  (D-{tick}-{seq}) — collectExpansionDecisions 分配
  │
  ├── Event[]
  │      └── eventId  (E-{tick}-{seq}) — producer 自增
  │
  └── Experience
         └── experienceId  (X-{tick}-{seq}) — collector 自增
```

### 9.2 关系验证

| 不变式 | 验证 |
|---|---|
| same operation → same operationId | ✅ consume 时一次性铸造，不可变 |
| same operation → multiple events | ✅ N 个 MilestoneEvent + 0 或 1 个 OutcomeEvent |
| at most one terminal outcome | ✅ channel 幂等保证 |
| one resolved experience | ✅ collector processedDecisionIds 防重 + channel drain 消费即出队 |
| decisionId ≠ operationId | ✅ decisionId 是 DecisionTrace 内部引用，operationId 是 Operation 身份 |

### 9.3 planId 的位置

`planId` 是 Plan 对象的标识，在 consume 时关联到 `Memory.kernel.expansion.planId`。

```
Plan
  └── planId
       ↓ consume
  Operation(operationId)
```

planId 不是 Operation 身份——它在旧版 Memory 可能缺失。UOEM 使用 `operationId` 替代 planId 作为 Operation 身份。

---

## §10. Reset Safety 审计

### Case R1: operation starts → milestone → reset → milestone → terminal

```
T0      open(opId) in Memory
T0+5k   Milestone(FORCED_ADVANCE) → MilestoneEvent in heap only (lost on reset)
T0+6k   global reset — heap cleared, Memory survives
        Memory: { expansion: { opId, state: economic_startup } }
        channel: [] (if in Memory) or lost (if in heap)
T0+7k   restart — trace re-emits Decision referencing same opId
        producer rebuilt from Memory.expansion, knows opId
T0+25k  terminal → OutcomeEvent enqueue
        collector.drain() → attach to rebuilt Experience
```

**要求：same operationId。**
- opId = `op:{target}:{consumeTick}` 在 Memory 中幸存 → ✅

**Milestone 丢失是否可接受？**
- Milestone 不进 outcome channel
- Milestone 的 `forcedAdvance` 标志：需要从 Memory 恢复
- **建议：** `Memory.kernel.expansion.forcedAdvance` 作为 boolean 字段持久化

### Case R2: terminal event recorded → reset → collector

```
T0+25k  terminal → OutcomeEvent enqueue → channel (in Memory)
T0+25k+1 global reset — heap cleared, Memory survives
        channel: [OutcomeEvent] (survived)
T0+26k  collector runs → drain() → attach to rebuilt Experience
```

**要求：不能重复生成 Experience。**
- `processedDecisionIds` 在 heap 中 → reset 后丢失
- 但 Experience 也在 heap 中 → 也丢失
- collector 重新从 DecisionTrace 采集 DecisionRecord → 重建 Experience
- channel 中的 OutcomeEvent 被 drain → attach 到新 Experience
- **不会重复消费**（drain 是 splice，消费即出队）

**裁决：✅ 安全。**

### Case R3: event queued → reset → event still recoverable

**如果 Event Queue 是 heap-only：**
- reset 后 channel 丢失
- collector 重建 Experience 后无法找到 Outcome → UNRESOLVED
- **这是可接受的降级**——A6 Shadow-Only 冻结期间不影响 Runtime

**如果 Event Queue 在 Memory 中（UOEM 建议）：**
- reset 后 channel 幸存
- collector 可以正常消费
- **代价：** 32 × ~100B ≈ 3KB Memory

**裁决：channel 应存 Memory。3KB 代价可接受。允许丢失的 heap-only 方案也可接受（降级到 UNRESOLVED）。推荐 Memory 持久化。**

---

## §11. Memory / Boundedness 审计

### 11.1 数据结构容量计算

| 结构 | 位置 | 容量 | 单条大小 | 上界 | GC 策略 |
|---|---|---|---|---|---|
| OutcomeChannel | Memory.kernel.outcomeEvents | 32 | ~100B | 3.2KB | FIFO 溢出最老 |
| dedup set (seen) | Memory 或 channel 内 | 32 | ~40B (opId) | 1.3KB | 随 channel flush 清理 |
| Milestone log | heap only | 可选 | ~80B | 0 (reset 丢失) | 不需要 GC |
| Experience ring | heap | 500 | ~500B | 250KB | TTL + capacity |
| DecisionTrace ring | heap | 1000 | ~300B | 300KB | TTL + capacity |
| processedDecisionIds | heap | 5000 | ~20B | 100KB | FIFO trim |
| processedExpansionPlanIds | heap | 500 | ~40B | 20KB | FIFO trim |

### 11.2 长期运行分析

**1000 Operations（~5M ticks ~1.5 年）：**
- OutcomeChannel：32 slots，FIFO → 稳态 ≤32 条
- dedup set：随 channel flush 清理 → 稳态 ≤32 条
- processedExpansionPlanIds：500 cap，FIFO trim → 稳态 ≤500 条
- **无无界结构。**

**100000 ticks 模拟：**
- OutcomeChannel：每 ~20k-60k tick 一次 enqueue → ~2-5 条 → 远低于 cap
- Experience ring：100t interval × 1000 ticks = 10 次采集 → ≤10 条

**裁决：全部 bounded。worst-case ≤400KB（含所有 heap 结构）。**

---

## §12. A6.1-A6.6 Compatibility 审计

### A6.1 Experience

| 字段 | 当前来源 | UOEM 后来源 | 兼容？ |
|---|---|---|---|
| decision | DecisionRef (decisionId, tick, category, actor, selectedAction) | 不变 | ✅ |
| before (context) | ExperienceContext (从 DecisionRecord 采集) | 不变 | ✅ |
| after (outcome) | collectOutcome(input) → OutcomeRecord | 从 channel.drain() 获取 OutcomeEvent → 构造 OutcomeRecord | ✅（输入构造方式变化，domain 纯函数不变） |
| duration | lastExpansionOutcome.duration 或 tick - startedAt | OutcomeEvent.interval.closedAt - openedAt | ✅（更准确） |
| evidence | extractMetricsFromEvidence + context metrics | 不变 | ✅ |

**裁决：A6.1 不需修改。** collector 的 `buildOutcomeCollectionInput` 需要改（从 channel 读取而非 lastExpansionOutcome），但这是 system 层薄壳的变化，不是 A6.1 domain 层的变化。

### A6.2 Prediction

**不应改变。** Prediction 消费的是 DecisionRecord + context metrics，不直接消费 outcome。Prediction 的 resolve 消费 ResolutionResult（来自 A6.4），不直接读 outcome channel。

### A6.3 Prediction (ring buffer)

**不应改变。** PredictionRingBuffer 存储 Prediction→Resolution 配对，不直接消费 outcome event。

### A6.4 Calibration

**只消费 resolved outcome。** `ResolutionResult` 来自 `calibrationSystem` 的 resolve 操作，它从 `ExperienceRecord` (FINALIZED) 中提取 `outcome.classification` + `outcome.value`。

UOEM 改变的是 Experience 如何获得 outcome（从 channel 而非 lastExpansionOutcome），但 Experience 一旦 FINALIZED 后的 outcome 字段不变。

**裁决：A6.4 不需修改。**

### A6.5 Reliability

**只读。** Reliability 计算 confidence 单调性、regime 匹配等，全部从 ResolutionResult 读取。

**裁决：A6.5 不需修改。**

### A6.6 Recommendation

**Shadow-Only。** Recommendation 生成建议但不执行。消费 Experience + CalibrationProfile。

**裁决：A6.6 不需修改。**

### A6 兼容性总结

| A6 子系统 | 需要修改？ | 理由 |
|---|---|---|
| A6.1 Experience (domain) | ❌ | 纯函数不变，输入构造方式由 system 层调整 |
| A6.1 Experience (system) | ✅ 薄壳 | buildOutcomeCollectionInput 需从 channel 读 |
| A6.2 Prediction | ❌ | 不直接消费 outcome |
| A6.3 Prediction ring | ❌ | 不直接消费 outcome |
| A6.4 Calibration | ❌ | 只消费 resolved Experience |
| A6.5 Reliability | ❌ | 只读 |
| A6.6 Recommendation | ❌ | Shadow-Only |

**system 层薄壳修改不违反 A6 冻结契约**——A6.1-A6.6 的 domain 层纯函数全部不变。

---

## §13. A6-R Compatibility (recoveryStats 累计污染)

### 当前问题

`collectRecoveryOutcome` 使用 `recoverySucceeded / (succeeded + failed)` 计算成功率——但 `recoveryStats` 是**终身累计**而非 Operation 级别 delta。

### UOEM 消解

UOEM 的 `PairedObservation` 要求 before/after 端点：
- **before** = 决策时刻的 recoveryStats 快照（succeeded_0, failed_0）
- **after** = 终态时刻的 recoveryStats 快照（succeeded_1, failed_1）
- **delta** = { succeededSinceOpen: succeeded_1 - succeeded_0, failedSinceOpen: failed_1 - failed_0 }

分类基于 delta 而非累计：
```
successRate = delta.succeededSinceOpen / max(1, delta.succeededSinceOpen + delta.failedSinceOpen)
```

**这不修改 A6.1 domain 层**——`OutcomeCollectionInput.recoverySucceeded/Failed` 仍然存在，但 system 层（experience-collector）在构建 input 时使用 delta 而非累计值。

**裁决：A6-R 可被 UOEM 消解，不需修改 A6 domain 层。**

---

## §14. A6-SL Compatibility (BEFORE/AFTER 错位)

### 当前问题

logistics 通道：`logisticsLevelBefore` 硬编码 "stable"。
spawn 通道：三个值全部取自决策时刻快照（BEFORE 喂 AFTER）。

### UOEM 消解

UOEM 的 `PairedObservation` 强制 before/after 双端点：
- **before** = 决策时刻冻结（现有 `extractMetricsFromEvidence` 已正确实现）
- **after** = 终态时刻冻结（需 producer 在终态时采集）

**修改范围：**
- system 层：experience-collector 需要在终态时刻采集 after 快照
- domain 层：`OutcomeCollectionInput` 已有 `Before/After` 字段对，不需修改
- **A6.1 domain 层纯函数不变**

**裁决：A6-SL 可被 UOEM 消解，不需修改 A6 domain 层。**

---

## §15. Expansion 完整状态机 UOEM 映射

### 状态转换图

```
validating → preparing → claiming → claimed → bootstrapping → economic_startup → integrating → completed
                    ↓          ↓          ↓              ↓                  ↓              ↓
                 abort      abort      abort         abort             abort          abort
                                                              ↓
                                                           (timeout+spawn)
                                                              ↓
                                                        economic_startup (强推)
```

### 每状态转换的 UOEM 语义

| 状态转换 | 触发条件 | 当前记录 | UOEM 分类 | Terminal? |
|---|---|---|---|---|
| validating→preparing | Gate passed | 无 | Milestone("VALIDATED") | ❌ |
| preparing→claiming | claimer alive/pending | 无 | Milestone("CLAIMER_DEPLOYED") | ❌ |
| preparing timeout | claimTimeout | TIMEOUT (abort) | Outcome(TIMED_OUT) | ✅ |
| claiming→claimed | controller.my | SUCCESS (P1) | Milestone("CLAIMED") | ❌ |
| claiming stolen | controller.owner | STOLEN (abort) | Outcome(STOLEN) | ✅ |
| claiming timeout | claimTimeout | TIMEOUT (abort) | Outcome(TIMED_OUT) | ✅ |
| claiming lost+hostile | claimer died | LOST (abort) | Outcome(LOST) | ✅ |
| claimed→bootstrapping | CP1 passed | 无 | Milestone("CP1_PASSED") | ❌ |
| claimed no anchor | no viable anchor | ABORTED (abort) | Outcome(ABANDONED) | ✅ |
| bootstrapping lost vision | !controller.my | LOST (P2) + LOST (abort) | Outcome(LOST) | ✅ |
| bootstrapping stolen | controller.owner | STOLEN (P3) + LOST (abort) | Outcome(STOLEN) | ✅ |
| bootstrapping squad wiped | hostiles+no squad | LOST (P4) + LOST (abort) | Outcome(LOST) | ✅ |
| bootstrapping timeout+spawn | timeout+spawn | TIMEOUT (P5) → 推进 | Milestone("FORCED_ADVANCE") | ❌ |
| bootstrapping timeout+no spawn | timeout+no spawn | TIMEOUT (abort) | Outcome(TIMED_OUT) | ✅ |
| economic_startup→integrating | CP3+CP4 passed | 无 | Milestone("CP3_CP4_PASSED") | ❌ |
| economic_startup lost | !controller.my | LOST (P6) + LOST (abort) | Outcome(LOST) | ✅ |
| economic_startup timeout+cp3 | timeout+cp3 | SUCCESS (P7) → 推进 | Milestone("FORCED_ADVANCE") | ❌ |
| economic_startup timeout+no cp3 | timeout+no cp3 | TIMEOUT (abort) | Outcome(TIMED_OUT) | ✅ |
| integrating→completed | CP5+handover | SUCCESS (P8) | Outcome(COMPLETED) | ✅ |
| integrating timeout+netFlow | timeout+netFlow>0 | SUCCESS (P9) | Outcome(COMPLETED_FORCED) | ✅ |
| integrating lost | !controller.my | LOST (abort) | Outcome(LOST) | ✅ |
| integrating timeout+no netFlow | timeout+no netFlow | TIMEOUT (abort) | Outcome(TIMED_OUT) | ✅ |

---

## §16. Event Lifecycle State Machine 研究

### 四种生命周期不混淆

| 生命周期 | 主体 | 状态 | 持久化 |
|---|---|---|---|
| Operation Lifecycle | ExpansionState (Memory.kernel.expansion) | validating→...→completed/aborted | Memory |
| Decision Lifecycle | DecisionRecord (DecisionTrace ring) | ACTIVE→ARCHIVED→EXPIRED | heap |
| Event Lifecycle | MilestoneEvent / OutcomeEvent | RECORDED→DRAINED or RECORDED→EVICTED | Memory(channel) / heap(milestone) |
| Experience Lifecycle | ExperienceRecord | OBSERVED→OPEN→ATTRIBUTED→FINALIZED→ARCHIVED/EXPIRED/UNRESOLVED | heap |

### Event Lifecycle 是否需要独立状态机？

**分析：**
- MilestoneEvent：创建即不变，消费即丢弃（如果需要日志，由 eventLog 处理）
- OutcomeEvent：创建即不变，消费即出队（drain）

Event 本身不需要复杂生命周期——它是不可变事实记录。它的"生命周期"由 channel 管理：
```
CREATED → ENQUEUED → DRAINED (消费) or EVICTED (溢出)
```

**裁决：不需要独立的 Event Lifecycle State Machine。** Event 的生命周期由 OutcomeChannel 的 FIFO 管理即可。

---

## §17. 形式化 Invariants I1-I18

| # | Invariant | 验证 | 当前满足？ | UOEM 后满足？ |
|---|---|---|---|---|
| I1 | Operation Identity Stability | opId 在 consume 时铸造，Memory 持久 | ❌ (decisionId 惰性分配) | ✅ |
| I2 | Decision Identity Stability | decisionId 由 collectExpansionDecisions 分配 | ✅ (epoch 内) | ✅ |
| I3 | Event Identity Uniqueness | eventId = E-{tick}-{seq} 全局唯一 | N/A | ✅ |
| I4 | Terminal Outcome ≤ 1 / Operation | channel 幂等（operationId 去重） | ❌ (多次 recordExpansionOutcome) | ✅ |
| I5 | Milestone ≠ Terminal | kind 分离（MilestoneEvent vs OutcomeEvent） | ❌ (共用 recordExpansionOutcome) | ✅ |
| I6 | Timeout Milestone ≠ Timeout Outcome | Milestone 不进 channel | ❌ (P5 进 ring) | ✅ |
| I7 | Operation Continuation prevents Resolution | milestone 不写 channel → collector pending | ❌ (P5 写 lastExpansionOutcome) | ✅ |
| I8 | Duration uses immutable operationStartedAt | interval.openedAt 铸造后不变 | ❌ (startedAt 被 9 处覆写) | ✅ |
| I9 | Before snapshot immutable | extractMetricsFromEvidence 在决策时刻冻结 | ✅ (机制正确) | ✅ |
| I10 | After snapshot terminal-derived | producer 在终态冻结 after | ❌ (collector 事后取当前值) | ✅ |
| I11 | Aggregate ≠ Operation Outcome | delta vs 累计 | ❌ (recoveryStats 累计) | ✅ |
| I12 | Reset does not create Operation | opId 在 Memory 中幸存 | ❌ (decisionId 重建) | ✅ |
| I13 | Duplicate Event is idempotent | channel DUPLICATE_REJECTED | N/A | ✅ |
| I14 | Conflicting Terminal Event is visible | overflowCount 计数 | N/A | ✅ |
| I15 | Same Event Stream → Same Resolution | domain 纯函数确定性 | ✅ | ✅ |
| I16 | Event Storage bounded | channel cap 32 | ❌ (lastExpansionOutcome 单槽但 milestone 混入) | ✅ |
| I17 | Collector cannot resolve milestone | channel 只含 OutcomeEvent | ❌ (milestone 进 lastExpansionOutcome) | ✅ |
| I18 | A6 receives only resolved semantic outcome | collector 只 drain terminal | ❌ | ✅ |

**当前：I2/I9/I15 满足（3/18）。UOEM 后：全部 18/18 满足。**

---

## §18. UOEM 两种实现形态比较

### Model A: Event Ring + Terminal Index

```
MilestoneEvent[] (heap, 可选)
+
OutcomeChannel {
  queue: OutcomeEvent[] (Memory, cap=32)
  seen: Set<OpId> (Memory)
}
```

### Model B: Event Ring + Materialized Operation Record + Terminal Outcome

```
MilestoneEvent[] (heap)
+
OutcomeEvent ring (Memory, cap=32)
+
OperationRecord[] (Memory, cap=32) — materialized view
```

### 比较矩阵

| 维度 | Model A | Model B |
|---|---|---|
| Correctness | ✅ channel 幂等保证 | ✅ 同上 |
| Identity | ✅ opId in event | ✅ opId in record + event |
| Reset | ✅ Memory 持久 | ✅ 同上 |
| Memory | 3.2KB (channel) + 1.3KB (seen) | 3.2KB + 1.3KB + 3.2KB (records) = 7.7KB |
| CPU | O(1) enqueue, O(N) drain | 同上 + O(N) record 维护 |
| Replay | ✅ FIFO deterministic | ✅ 同上 |
| Consumer compat | ✅ collector.drain() | ✅ 同上 + record 查询 |
| Implementation complexity | **低** — channel + drain | **高** — 额外 record 维护 |
| Audit trail | Event only | Event + Record (双写) |

**裁决：推荐 Model A。** 理由：
1. Model B 的 OperationRecord 是 Event 的物化视图——可以 drain 后重建，不需要持久化
2. Model B 增加了双写一致性问题
3. Model A 更简单，Memory 占用更小
4. Model A 的 audit trail 已经足够（milestoneHistory 字段 + eventLog）

---

## §19. 最终裁决

### BLOCKER 清单

以下问题必须在 Implementation 前解决：

| # | Blocker | 严重性 | UOEM 消解路径 |
|---|---|---|---|
| B1 | rhythm ring 将 milestone 当 terminal 计入 | **HIGH** | P5/P7 改为 Milestone → 不进 ring |
| B2 | lastExpansionOutcome latest-wins 覆盖 | **HIGH** | 替换为 OutcomeChannel (Memory) |
| B3 | collector 在 milestone 后提前 resolution | **HIGH** | channel 只含 terminal → pending 继续 |
| B4 | forcedAdvance 需持久化跨 reset | **MEDIUM** | Memory.kernel.expansion.forcedAdvance |
| B5 | 配对双写 rhythm ring 行为改变 | **LOW** | 幂等保留第一次更精确，消费者兼容 |
| B6 | rhythm ring consecutiveFailures 语义改变 | **LOW** | 更正确（中间强推不应重置计数） |

### READY 条件检查

| 条件 | 满足？ |
|---|---|
| rhythm ring compatibility proven | ✅ 消费者兼容（§2） |
| all consumers inventoried | ✅ 18 个消费者（§1） |
| no latest-wins semantic contradiction | ✅ channel 替换单槽（§3） |
| TIMEOUT semantics resolved | ✅ kind 分离（§5） |
| milestone/terminal separation proven | ✅（§6） |
| identity contract proven | ✅ opId 铸造（§9） |
| reset safety proven | ✅ R1/R2/R3（§10） |
| duplicate safety proven | ✅ operationId 去重（§8） |
| conflicting terminal behavior defined | ✅ DUPLICATE_REJECTED + overflowCount |
| temporal contract proven | ✅ eventId 排序（§4） |
| before/after contract proven | ✅ PairedObservation（§14） |
| aggregate isolation proven | ✅ delta vs 累计（§13） |
| bounded memory proven | ✅ ≤3.2KB channel（§11） |
| deterministic replay proven | ✅ 纯函数 + FIFO（§4） |
| A6.1-A6.6 remain unchanged | ✅ domain 层不变（§12） |
| no new Decision Authority | ✅ |
| no new Execution Path | ✅ |
| no Shadow-Only violation | ✅ |
| all five original bugs resolved | ✅ EXP-1/2/TMP-1/A6-R/A6-SL |
| TIMEOUT-SEMANTICS resolved | ✅ |
| forcedAdvance ≠ terminal outcome | ✅（§7） |

**裁决：ARCHITECTURE_READY_FOR_IMPLEMENTATION**

所有 20 项 READY 条件全部满足。UOEM 模型用四个正交保证（Terminality/Identity/Interval/PairedObservation）+ 一个权威通道（幂等、Memory 持久、容量可观测）+ Model A 实现形态，在类型与所有权层面使六类缺陷（EXP-1/EXP-2/TMP-1/A6-R/A6-SL/TIMEOUT-SEMANTICS）要么无法表达、要么自动转化为诚实的 DATA_GAP/UNRESOLVED。

**但保留以下实施前置约束：**
1. `forcedAdvance` 标志必须持久化到 `Memory.kernel.expansion`
2. `OutcomeChannel` 必须存 Memory（≤3.2KB）
3. rhythm ring 消费者**不需要修改**（milestone 不进 ring 后行为更正确）
4. A6.1-A6.6 domain 层纯函数**不需要修改**
5. system 层 experience-collector 的 `buildOutcomeCollectionInput` 需改为从 channel.drain() 读取