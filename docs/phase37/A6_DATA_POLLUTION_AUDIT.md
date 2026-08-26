# A6 数据污染审计报告

> Phase 37 · 审计文档 3/4
> 日期: 2026-08-26
> 裁决: **NO POLLUTION — A6 SYSTEM PROTECTED BY DESIGN**

---

## 1. 审计目标

评估 Phantom Transporter Bug 是否对 A6 Intelligence System（Experience / Outcome /
Attribution / Calibration）产生了数据污染。

---

## 2. A6 数据流概览

```
DecisionRecord (A4.7)
  ↓ experience-collector-system (100t interval)
ExperienceRecord (OBSERVED)
  ↓ MEASUREMENT_DELAYS.expansion = 2000t
collectOutcome(type="expansion")
  ↓ 需要 input.expansionOutcome !== undefined
OutcomeRecord
  ↓ collectAttribution(type="expansion")
Attribution
  ↓ finalizeExperience()
ExperienceRecord (FINALIZED)
  ↓ extractHistoricalValues()
StrategyEvaluation baseline
  ↓ computeConfidenceBuckets()
CalibrationProfile
```

---

## 3. 逐层审计

### 3.1 Experience 层 — 无污染

**审计点**: Phantom Bug 是否导致错误的 ExperienceRecord 被创建？

**分析**:
- ExperienceRecord 由 `experience-collector-system.ts` 从 DecisionTrace Ring Buffer 采集
- 采集条件: DecisionRecord 存在且未处理过
- DecisionRecord 由 `decision-trace.ts` 在决策发生时创建
- Phantom Bug 影响的是扩张状态机的执行层（expansion-manager），不影响决策层
- 扩张决策本身（是否扩张、扩张到哪里）由 `expansion-planner.ts` 和 `decision.ts` 正常产出
- ExperienceRecord 的 `createExperience` 只记录决策上下文快照，不包含执行结果

**结论**: **无污染**。Experience 层只观测决策，不感知执行层的 bug。

### 3.2 Outcome 层 — 无污染（空采集保护）

**审计点**: Phantom Bug 是否导致错误的 OutcomeRecord 被采集？

**分析**:

`collectExpansionOutcome()` 函数（`outcome.ts` L330-356）:

```typescript
function collectExpansionOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.expansionOutcome === undefined) {
    return undefined;  // ← 关键保护
  }
  // ... 只有 expansionOutcome 有值时才创建 OutcomeRecord
}
```

`experience-collector-system.ts` 的 `buildOutcomeCollectionInput()` 函数
L413-416:

```typescript
case "expansion":
  // 从 expansionDashboard 获取扩张状态
  // 扩张结果需要从事件日志或 colony dashboard 获取
  break;  // ← 没有注入 expansionOutcome 字段
```

**关键发现**: `buildOutcomeCollectionInput` 的 `case "expansion"` 分支**从未注入**
`input.expansionOutcome` 字段。因此 `collectExpansionOutcome()` 永远返回 `undefined`。

**这意味着**:
1. 扩张类型的 ExperienceRecord 永远无法采集到 Outcome
2. 超过最大延迟（2000t × 4 = 8000t）后被标记为 `UNRESOLVED`
3. 没有错误的 OutcomeRecord 被创建
4. 没有错误的 `SUCCESS` / `FAILURE` 分类被产出

**结论**: **无污染**。Outcome 层有空采集保护——`expansionOutcome` 字段未注入，
所以 `collectExpansionOutcome` 返回 `undefined`，Experience 被标记为 `UNRESOLVED`
而非错误分类。

**注意**: 这是一个**已存在的空采集缺陷**（system 层未实现 expansion outcome 注入），
但它恰恰保护了 A6 不受 Phantom Bug 污染。这个空采集缺陷应作为单独的技术债登记。

### 3.3 Attribution 层 — 无污染（依赖 Outcome）

**审计点**: Phantom Bug 是否导致错误的 Attribution 被生成？

**分析**:

`collectExpansionAttribution()` 函数（`attribution.ts` L669-760）:

```typescript
function collectExpansionAttribution(input: AttributionInput): Attribution {
  const classification = input.outcome.classification;  // ← 依赖 Outcome
  // ... 根据 classification 生成归因
}
```

`collectPendingAttributions()` 函数（`experience-collector-system.ts` L247-266）:

```typescript
function collectPendingAttributions(ctx, cache, tick): void {
  const unattributed = getUnattributed(cache.ringBuffer);
  for (const exp of unattributed) {
    if (!exp.outcome) continue;  // ← 关键保护: 无 Outcome → 跳过
    // ...
  }
}
```

**关键发现**: Attribution 采集依赖 Outcome 存在。由于 Outcome 永远是 `undefined`
（3.2 的空采集保护），Attribution 永远不会被采集。

**这意味着**:
1. 没有错误的归因（如错误地归因于 `EXECUTION_QUALITY`）被生成
2. 没有 `attributionHash` 被错误计算
3. 没有 `confidence` 值被错误产出

**结论**: **无污染**。Attribution 层依赖 Outcome，Outcome 未采集则 Attribution 不执行。

### 3.4 Calibration 层 — 无污染（依赖完整链路）

**审计点**: Phantom Bug 是否影响 Calibration 的置信度统计？

**分析**:

Calibration 层（A6.4）依赖 ResolutionResult，ResolutionResult 依赖 Prediction 和
ObservationSample。扩张类型的 Prediction 和 Resolution 都独立于 expansion-manager
的执行层。

Calibration Engine 的输入链路:
```
Prediction (A6.3) → ObservationSample → ResolutionResult → CalibrationProfile
```

Phantom Bug 影响的是 expansion-manager 的状态机执行，不影响:
- Prediction 模型的预测值计算
- ObservationSample 的采集
- ResolutionResult 的判定
- CalibrationProfile 的统计

**结论**: **无污染**。Calibration 层与 expansion-manager 执行层无直接数据依赖。

### 3.5 Strategy Evaluation — 无污染

**审计点**: Phantom Bug 是否影响 baseline 计算？

**分析**:

`extractHistoricalValues()` 函数（`baseline.ts` L558-611）:

```typescript
for (const exp of experiences) {
  if (!exp.outcome) continue;  // ← 关键保护: 无 Outcome → 跳过
  // ...
  case "expansion":
    result.expansion.push(exp.outcome.value);  // ← 只有有 Outcome 时才提取
}
```

由于扩张类型的 Experience 永远没有 Outcome（3.2 的空采集保护），
`extractHistoricalValues` 中 `expansion` 维度的历史值数组**永远为空**。

**这意味着**:
1. baseline 的 `expansion` 维度没有数据点
2. 不会产生错误的 baseline 对比
3. StrategyEvaluation 的 `expansion` 维度会因数据不足而返回 `INCONCLUSIVE`

**结论**: **无污染**。Strategy Evaluation 的 expansion 维度因数据缺失而 INCONCLUSIVE，
不会产生错误的评估结论。

---

## 4. A6 保护机制总结

A6 Intelligence System 的设计天然保护了其不受执行层 bug 的污染：

| 保护层 | 机制 | 效果 |
|--------|------|------|
| Experience 层 | Shadow-Only（只观测决策，不感知执行） | 不受执行 bug 影响 |
| Outcome 层 | 空采集保护（`expansionOutcome === undefined` → 返回 undefined） | 不产生错误分类 |
| Attribution 层 | 依赖 Outcome（无 Outcome → 跳过） | 不产生错误归因 |
| Calibration 层 | 独立数据链路（Prediction → Resolution） | 不受执行层影响 |
| Strategy Evaluation | `if (!exp.outcome) continue` | 跳过无 Outcome 的记录 |

---

## 5. 已存在的技术债

### TD-37-3: Expansion Outcome 采集未实现

**描述**: `experience-collector-system.ts` 的 `buildOutcomeCollectionInput()` 函数中，
`case "expansion"` 分支（L413-416）是空的——`expansionOutcome` 字段从未被注入。

**影响**: 扩张类型的 ExperienceRecord 永远无法采集到 Outcome，导致:
- 扩张经验无法进入 Attribution 和 Calibration 流程
- Strategy Evaluation 的 expansion 维度永远 INCONCLUSIVE
- A6 系统无法从扩张历史中学习

**严重度**: Medium（功能缺失，但不产生错误数据）

**修复方向**: 从 `ExpansionOutcome` 事件日志或 `colony-dashboard` 采集扩张结果，
注入 `input.expansionOutcome` 字段。

**注意**: 本次审计中此缺陷反而保护了 A6 不受 Phantom Bug 污染。但修复此缺陷后，
需要确保扩张状态机本身的正确性（已由本次 Phantom Transporter 修复保证）。

---

## 6. 结论

**Phantom Transporter Bug 对 A6 Intelligence System 无数据污染。**

A6 的分层设计和空采集保护机制天然隔离了执行层 bug:
1. Experience 层只观测决策，不感知执行
2. Outcome 层因 `expansionOutcome` 未注入而返回 `undefined`
3. Attribution 层因无 Outcome 而跳过
4. Calibration 层有独立数据链路
5. Strategy Evaluation 跳过无 Outcome 的记录

**唯一已存在缺陷**: TD-37-3（Expansion Outcome 采集未实现）是功能缺失，
不是数据污染。此缺陷应独立修复。
