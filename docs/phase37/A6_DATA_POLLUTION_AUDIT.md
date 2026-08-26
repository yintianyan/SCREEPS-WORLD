# A6 数据污染审计报告（TD-37-3 修复后）

> Phase 37 · 审计文档 3/6
> 日期: 2026-08-26
> 裁决: **NO POLLUTION — A6 SYSTEM PROTECTED BY DESIGN**
> 状态: TD-37-3 已修复，污染审计重新确认

---

## 1. 审计目标

评估 Phantom Transporter Bug 及 TD-37-3 修复是否对 A6 Intelligence System（Experience /
Outcome / Attribution / Calibration）产生了数据污染。

**二次审计原因**：TD-37-3 修复后，expansion 数据链路打通，需要确认新打通的数据流不会引入污染。

---

## 2. A6 数据流概览（修复后）

```
DecisionRecord (A4.7) — 7/7 types including EXPANSION
  ↓ experience-collector-system (100t interval)
ExperienceRecord (OBSERVED)
  ↓ MEASUREMENT_DELAYS.expansion = 2000t
collectOutcome(type="expansion") — input.expansionOutcome now injected from rhythm ring
  ↓
OutcomeRecord
  ↓ collectAttribution(type="expansion") — all fields now populated
Attribution
  ↓ finalizeExperience()
ExperienceRecord (FINALIZED)
  ↓ extractHistoricalValues()
StrategyEvaluation baseline
  ↓ computeConfidenceBuckets()
CalibrationProfile
```

---

## 3. 逐层审计（修复后）

### 3.1 Experience 层 — 无污染

**审计点**: TD-37-3 修复（新增 collectExpansionDecisions）是否导致错误的 ExperienceRecord 被创建？

**分析**:
- `collectExpansionDecisions()` 只在 Plan consume 时创建一条 DecisionRecord（使用 `processedExpansionPlanIds` 防重）
- ExperienceRecord 由 `experience-collector-system.ts` 从 DecisionTrace Ring Buffer 采集
- 采集条件: DecisionRecord 存在且未处理过
- `categoryToExperienceType("EXPANSION")` → `"expansion"` 映射已存在
- ExperienceRecord 的 `createExperience` 只记录决策上下文快照，不包含执行结果
- 修复后新增的 expansion DecisionRecord 语义正确：一次 Plan consume = 一次 Decision Event

**结论**: **无污染**。Experience 层正确采集 expansion 决策，防重机制确保不重复。

### 3.2 Outcome 层 — 无污染（事实采集保护）

**审计点**: TD-37-3 修复（注入 expansionOutcome）是否导致错误的 OutcomeRecord 被采集？

**分析**:

`collectExpansionOutcome()` 函数（`outcome.ts` L330-356）:
```typescript
function collectExpansionOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.expansionOutcome === undefined) {
    return undefined;  // ← 保护仍在
  }
  // ... 只有 expansionOutcome 有值时才创建 OutcomeRecord
}
```

`buildOutcomeCollectionInput()` 的 `case "expansion"` 修复后（L413-443）:
```typescript
case "expansion":
  const rhythm = Memory?.kernel?.expansionRhythm;
  if (rhythm && rhythm.ring.length > 0) {
    const lastCode = rhythm.ring[rhythm.ring.length - 1];
    input.expansionOutcome = phaseCode * 10 + lastCode;  // ← 从已发生的事实读取
  }
  // ...
  break;
```

**关键保护**：
1. `expansionOutcome` 只从 `Memory.kernel.expansionRhythm.ring` 的最后一条编码读取——这是**已发生的 Runtime Fact**
2. rhythm ring 为空时（无扩张完成/终止），`expansionOutcome` 仍为 `undefined` → `collectExpansionOutcome` 返回 `undefined`
3. 不从 Prediction/Evaluation/Recommendation 反推 Outcome（禁止反向数据流）
4. 编码映射 `phaseCode * 10 + outcomeCode` 与 domain 纯函数解码逻辑对齐

**结论**: **无污染**。Outcome 层的事实采集保护机制完好——只从已发生的 rhythm ring 读取，不从推断反推。

### 3.3 Attribution 层 — 无污染（字段补全后）

**审计点**: TD-37-3 修复（补全 AttributionInput 字段）是否导致错误的 Attribution 被生成？

**分析**:

`buildAttributionInput()` 的 `case "expansion"` 修复后（L511-530）:
```typescript
case "expansion":
  input.expansionDuration = exp.context.metrics.expansionDuration ?? exp.outcome.delay;
  input.expansionTargetRoom = exp.decision.selectedAction.replace("EXPANSION_START_", "");
  input.expansionFinalColonyState = exp.outcome.classification === "SUCCESS"
    ? "normal" : exp.outcome.classification === "EXPIRED" ? "timeout" : "unknown";
  input.expansionRclAchieved = exp.context.metrics.expansionRclAchieved;
  if (exp.context.metrics.threatLevelAfter !== undefined) {
    input.threatLevelAfter = String(exp.context.metrics.threatLevelAfter);
  }
  Object.assign(input, { posture: exp.context.posture });
  break;
```

**关键保护**：
1. Attribution 采集仍然依赖 Outcome 存在（`if (!exp.outcome) continue`）
2. `expansionFinalColonyState` 从 `outcome.classification` 推导——使用已有的 Outcome 结果，不凭空创造
3. `expansionTargetRoom` 从 `decisionRef.selectedAction` 解析——使用已有的决策记录
4. `posture` 从 `context.posture` 获取——使用已有的上下文快照
5. 没有 `threatLevelAfter` 数据时不注入（`undefined` 保护）

**结论**: **无污染**。Attribution 层的所有输入都从已有的事实（Outcome + Context + DecisionRef）推导，不引入新的数据源。

### 3.4 Calibration 层 — 无污染（独立链路不变）

**审计点**: TD-37-3 修复是否影响 Calibration 的置信度统计？

**分析**:
Calibration 层（A6.4）依赖 ResolutionResult，ResolutionResult 依赖 Prediction 和 ObservationSample。
TD-37-3 修复未修改 Prediction、Calibration 的任何代码。
Calibration 的数据链路独立于 expansion-manager 的执行层。

**结论**: **无污染**。Calibration 层与 TD-37-3 修复无交集。

### 3.5 Strategy Evaluation — 无污染（现在有数据但数据正确）

**审计点**: TD-37-3 修复后 expansion 维度有了数据，是否影响 baseline 计算正确性？

**分析**:

`extractHistoricalValues()` 函数（`baseline.ts` L558-611）:
```typescript
for (const exp of experiences) {
  if (!exp.outcome) continue;  // ← 保护仍在
  // ...
  case "expansion":
    result.expansion.push(exp.outcome.value);  // ← 只有有 Outcome 时才提取
}
```

**修复前**：expansion 维度永远为空数组（因为没有 Outcome）→ INCONCLUSIVE
**修复后**：expansion 维度有真实数据（从 rhythm ring 推导的正确 Outcome）→ 可产生有意义的评估

**关键区别**：修复前是"数据缺失导致 INCONCLUSIVE"，修复后是"有数据导致可评估"。这不是污染——是数据从无到有的正确转变。

**结论**: **无污染**。Strategy Evaluation 的 expansion 维度现在有正确的数据可评估，不会产生错误结论。

---

## 4. A6 保护机制总结（修复后仍然完好）

| 保护层 | 机制 | 修复后效果 |
|--------|------|------------|
| Experience 层 | Shadow-Only + processedExpansionPlanIds 防重 | 正确采集 expansion 决策，不重复 |
| Outcome 层 | 事实采集保护（rhythm ring 为空 → undefined → return undefined） | 只从已发生的事实读取 |
| Attribution 层 | 依赖 Outcome + 字段从已有事实推导 | 不引入新的数据源 |
| Calibration 层 | 独立数据链路（Prediction → Resolution） | 不受 TD-37-3 修复影响 |
| Strategy Evaluation | `if (!exp.outcome) continue` | 只消费有 Outcome 的记录 |

---

## 5. TD-37-3 修复后的技术债状态

### TD-37-3: Expansion Outcome 采集已实现

**状态变更**: **SHOULD_FIX → FIXED**

**修复内容**:
1. `decision-trace-system.ts`：新增 `collectExpansionDecisions()` 函数
2. `experience-collector-system.ts`：`buildOutcomeCollectionInput` case "expansion" 实现真实采集
3. `experience-collector-system.ts`：`buildAttributionInput` case "expansion" 补全全部字段
4. `expansion-manager.ts`：`advanceEconomicStartup` timeout 强推路径补充 `recordExpansionOutcome()` 调用

**验证**:
- 38 个新增测试全部通过（DT-EXP, OUT-EXP, A6-EXP, SAFETY-EXP, CF-EXP）
- 4831/4831 全量测试通过
- typecheck + build 全绿
- 不修改 A6.1-A6.6 domain 纯函数
- 不修改 Shadow-Only 原则

---

## 6. 结论

**Phantom Transporter Bug 对 A6 Intelligence System 无数据污染。TD-37-3 修复后仍无数据污染。**

A6 的分层设计和事实采集保护机制在修复后仍然完好：
1. Experience 层正确采集 expansion 决策（防重机制保证不重复）
2. Outcome 层从已发生的 rhythm ring 事实读取（空保护仍在）
3. Attribution 层所有字段从已有事实推导（不引入新数据源）
4. Calibration 层有独立数据链路
5. Strategy Evaluation 只消费有 Outcome 的记录

**数据从"缺失"变为"完整"，从"无数据"变为"有正确数据"。这不是污染——是补齐。**
