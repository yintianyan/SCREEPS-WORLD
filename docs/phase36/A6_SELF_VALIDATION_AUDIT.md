# A6 Self-Validation Audit

> **阶段**: A6 Longitudinal Effectiveness Research
> **日期**: 2026-08-26
> **约束**: 纯研究，不写实现代码
> **审计目标**: 检测 A6 是否存在自证循环

---

## 一、审计方法

### 1.1 自证循环定义

自证循环 = A6 的输出被重新作为 A6 自己的 Evidence，导致 confidence 自我强化。

### 1.2 审计路径

```
Experience (A6.1) → Evaluation (A6.2) → Prediction (A6.3) 
  → Calibration (A6.4) → Reliability (A6.5) → Recommendation (A6.6)
  → [是否反馈回任何前置阶段?]
```

### 1.3 分层原则

- **Raw Observation** 可以验证 Intelligence
- **Intelligence** 不能反过来证明自身正确

---

## 二、逐阶段审计

### 2.1 A6.1 Experience 的输入来源

**输入**:
- `DecisionRecord`（来自 A5 DecisionTrace）— ✅ Raw Observation
- `empireHealth`（来自 A5 empire-health-system）— ✅ Raw Observation
- `recoveryStats`（来自 A5 recovery-lifecycle）— ✅ Raw Observation
- `evaluateWarOutcome()`（来自 A5 war-planner）— ✅ Raw Observation

**输出**: `ExperienceRecord { outcome, attribution }`

**自证检查**: Experience 的输入全部来自 A5 的 Raw Observation，没有消费 A6 自己的衍生数据。

**结论**: ✅ 无自证循环

### 2.2 A6.2 Evaluation 的输入来源

**输入**:
- `ExperienceRecord[]`（来自 A6.1）— ⚠️ Derived Intelligence（但基于 Raw Observation）
- `MetricSnapshot`（来自 A5 empire-health / CPU / economy）— ✅ Raw Observation
- `BaselineComparison`（来自历史均值）— ✅ Historical Raw Observation

**输出**: `StrategyEvaluation { dimensions, findings, verdict }`

**自证检查**: Evaluation 消费 A6.1 的 Experience——但 Experience 是基于 Raw Observation 的（DecisionRecord + Outcome），不是基于 Prediction/Calibration/Reliability 的衍生数据。

**结论**: ✅ 无自证循环

### 2.3 A6.3 Prediction 的输入来源

**输入**:
- `TimeSeries<number>` `netFlowHistory` / `reserveHistory`（来自 globalCache，由 A5 empire-health-system 写入）— ✅ Raw Observation
- `currentReserve` / `shortageThreshold`（快照值）— ✅ Raw Observation
- `PredictionContext`（posture, watchdogTier, roomCount, maxRcl, threatLevel）— ✅ Runtime State
- `ExperienceRecord[]`（可选，用于 Evidence 追溯）— ⚠️ 只用于 `experienceSourceRef()`，不影响预测值

**自证检查**: Prediction 不消费 Evaluation、Calibration、Reliability 或 Recommendation 的输出。Prediction 的 evidence 中可以引用 Experience，但只是 ID 引用，不影响预测计算。

**关键发现**: `EnergyShortageInput` 有一个 `energyHealthScore` 字段——这个值来自 `empireHealth`，是 Raw Observation，不是 A6 的衍生数据。

**结论**: ✅ 无自证循环

### 2.4 A6.4 Calibration 的输入来源

**输入**:
- `Prediction`（来自 A6.3）— ⚠️ Derived Intelligence
- `ObservationSample[]`（从 `globalCache.__reserveHistory` / `__spawnQueueDepthHistory` 构建）— ✅ Raw Observation
- `PredictionContext`（当前）— ✅ Runtime State
- `ExternalFactorSignal[]`（从 A6.1 Attribution + A6.2 Evaluation 提取）— ⚠️ Derived Intelligence

**自证检查**:

Calibration 消费 Prediction（A6.3 的衍生数据）来验证其准确性——这是设计意图（Prediction → Calibration），不是自证循环。

但 `buildExternalFactors()` 从 A6.1 和 A6.2 提取 ExternalFactorSignal——这些信号用于判断 EXTERNAL_INTERFERENCE。如果 A6.1 的 Attribution 或 A6.2 的 Evaluation 判断错误（如将模型误差误标为"外部因素"），会导致 Calibration 排除本应计入的 Resolution，从而高估模型表现。

**具体路径**:
```
A6.1 Attribution → externalFactors = ["market crash"]
  → A6.4 buildExternalFactors() → ExternalFactorSignal { source: "a61-attribution" }
  → resolvePrediction() → 如果 directionCorrect=false 且 externalFactors.length > 0
  → 判定 EXTERNAL_INTERFERENCE → 不计入 calibratable
  → ECE 只统计"没有外部因素"的 Resolution → 高估模型表现
```

**风险评估**: 低风险。这不算严格的自证循环（A6.1 的 Attribution 不是 A6.4 的输出），但存在**外部因素过度归因**的风险——如果 Attribution 过度归因于外部因素，会减少 calibratable 样本，使 ECE 看起来更好。

**结论**: ⚠️ 无自证循环，但有外部因素过度归因风险

### 2.5 A6.5 Reliability 的输入来源

**输入**:
- `Prediction[]`（来自 A6.3）— ⚠️ Derived Intelligence
- `ResolutionResult[]`（来自 A6.4）— ⚠️ Derived Intelligence
- `ModelCalibrationProfile[]`（来自 A6.4）— ⚠️ Derived Intelligence
- `ModelFailureStats[]`（来自 A6.4）— ⚠️ Derived Intelligence
- `PredictionContext`（当前）— ✅ Runtime State

**自证检查**: Reliability 完全消费 A6.3 和 A6.4 的衍生数据——但这是设计意图（聚合下层结果）。Reliability 不产出任何被 A6.3 或 A6.4 消费的数据。

**结论**: ✅ 无自证循环

### 2.6 A6.6 Recommendation 的输入来源

**输入**:
- `ExperienceRecord[]`（来自 A6.1）→ OBSERVED Evidence
- `Attribution`（来自 A6.1）→ ATTRIBUTED Evidence
- `StrategyEvaluation`（来自 A6.2）→ INFERRED Evidence
- `Prediction[]`（来自 A6.3）→ PREDICTED Evidence
- `ResolutionResult[]` + `ModelCalibrationProfile[]`（来自 A6.4）→ CALIBRATED Evidence
- `IntelligenceState`（来自 A6.5）→ RELIABILITY_ASSESSED Evidence

**自证检查**: Recommendation 消费全部 A6.1–A6.5 的输出——这是设计意图（综合所有阶段产出建议）。

**但**: Recommendation 不产出任何被 A6.1–A6.5 消费的数据。Recommendation 的输出只写入 `__recommendationCache`，不被任何其他 A6 模块读取。

**结论**: ✅ 无自证循环

---

## 三、Confidence 传播链审计

### 3.1 Confidence 传播路径

```
Prediction.confidence (A6.3)
  ← sampleFactor × r2Factor × externalFactor × regimeMultiplier
  ← 全部基于 Raw Observation 的统计

ResolutionResult (A6.4)
  ← 不携带 confidence，只携带 resolution 分类

ModelCalibrationProfile.ece (A6.4)
  ← 基于 Resolution 的统计
  ← ECE = Σ(|B_i|/N) × |acc(B_i) - conf(B_i)|

IntelligenceState.modelReliability[].ece (A6.5)
  ← 直接复制 Profile.ece

Recommendation Evidence confidence (A6.6):
  buildCalibrationEvidence():
    profile.ece ≤ 0.05 → confidence = 0.9
    profile.ece ≤ 0.15 → confidence = 0.6
    profile.ece > 0.15 → confidence = 0.3

  buildReliabilityEvidence():
    verdict = WELL_CALIBRATED → confidence = 0.8
    verdict = OVERCONFIDENT → confidence = 0.4

  computeRecommendationConfidence():
    confidence = min(evidence confidence) × 降权因子
    confidence ≤ trace.minConfidence (硬约束)
```

### 3.2 自证强化风险分析

**场景**: 假设某个模型在短期内恰好所有 Prediction 都 CORRECT（因为 regime 稳定）:

```
1. Prediction 产出，confidence = 0.7（正常计算）
2. Calibration 解析 → 全部 CORRECT → ECE = 0.0（完美校准！）
3. Reliability → WELL_CALIBRATED → ece = 0.0
4. Recommendation Evidence:
   - buildCalibrationEvidence: ece=0.0 ≤ 0.05 → confidence = 0.9
   - buildReliabilityEvidence: WELL_CALIBRATED → confidence = 0.8
5. Recommendation confidence = min(0.7, 0.9, 0.8) × 降权 = 0.7 × 降权

→ Recommendation confidence 没有被强化！因为硬约束 confidence ≤ min(evidence confidence) = 0.7
```

**结论**: ✅ confidence 没有被自证强化——硬约束 `confidence ≤ min(evidence confidence)` 阻止了强化。

**但**: 如果未来 Recommendation 的消费方不仅看 confidence 还看 Calibration Evidence 的 ece 值，可能会被 ECE=0.0 误导——因为 ECE 是 in-sample 的，不保证泛化。

### 3.3 循环依赖分析

```
A6.1 (Experience) ← A6.4 只读消费（ExternalFactorSignal）
A6.2 (Evaluation) ← A6.4 只读消费（ExternalFactorSignal）
A6.3 (Prediction) ← A6.4 只读消费（Resolution 输入）
A6.4 (Calibration) → 不反馈给 A6.1 / A6.2 / A6.3 / 任何执行系统
A6.5 (Reliability) → 不反馈给 A6.1–A6.4
A6.6 (Recommendation) → 不反馈给 A6.1–A6.5
```

**结论**: ✅ 无循环依赖。数据流严格单向。

---

## 四、Raw Observation vs Derived Intelligence 分层

### 4.1 分层定义

| 层级 | 定义 | 示例 |
|------|------|------|
| L0: Raw Observation | 直接从 Game API 或 A5 系统采集的原始数据 | `empireHealth`, `reserveHistory`, `DecisionRecord`, `evaluateWarOutcome()` |
| L1: Derived Intelligence | 从 Raw Observation 计算得出的分析结果 | `ExperienceRecord`, `StrategyEvaluation`, `Prediction` |
| L2: Meta-Intelligence | 从 Derived Intelligence 计算得出的元分析 | `ResolutionResult`, `ModelCalibrationProfile`, `IntelligenceState` |
| L3: Synthesized Intelligence | 综合多层 Intelligence 产出的建议 | `RecommendationCandidate` |

### 4.2 验证规则

| 规则 | 描述 | 当前状态 |
|------|------|---------|
| Rule-A | L0 可以验证 L1/L2/L3 | ✅ Calibration 用 L0 Observation 验证 L1 Prediction |
| Rule-B | L1 不能验证 L1（同层不能互验） | ✅ Evaluation 不验证 Prediction |
| Rule-C | L2 不能验证 L1（上层不能验证下层） | ✅ Reliability 不验证 Prediction 的准确性 |
| Rule-D | L3 不能验证 L1/L2 | ✅ Recommendation 不验证任何 A6 模块 |

### 4.3 违规检查

**检查**: 是否存在 L1/L2/L3 的输出被反馈为 L0 Raw Observation？

```
搜索路径: 
  - ExperienceCollectorSystem 是否从 __calibrationCache 读取? → NO
  - ExperienceCollectorSystem 是否从 __predictionCache 读取? → NO
  - prediction-system 是否从 __calibrationCache 读取? → NO
  - prediction-system 是否从 __evaluationCache 读取? → NO (只从 __reserveHistory 等 L0 数据)
  - strategy-evaluation-system 是否从 __predictionCache 读取? → NO
  - strategy-evaluation-system 是否从 __calibrationCache 读取? → NO
```

**结论**: ✅ 无违规。L1/L2/L3 的输出没有被反馈为 L0。

---

## 五、Data Leakage 审计

### 5.1 同一数据同时作为 Evidence 和 Validation

**检查**: 是否存在同一批数据既用于 Prediction 的 Evidence 又用于 Calibration 的 Validation？

```
Prediction.evidence.sources → "reserveHistory:1-30" (引用了 __reserveHistory)
Calibration.buildObservations() → 从 __reserveHistory 读取

→ 是同一批数据！
```

**但这不是严格的数据泄漏**——因为:
1. Prediction 在 tick T 生成时读取了 `__reserveHistory[0..29]`（T 之前的数据）
2. Calibration 在 tick T+horizon+grace 读取了 `__reserveHistory` 中 [T, T+horizon] 范围内的数据
3. 两者读取的是**不同时间段**的数据——Prediction 用历史数据训练，Calibration 用窗口内数据验证

**结论**: ✅ 不是数据泄漏——时间段不同。但需要注意 `__reserveHistory` 的 tick 关联准确性（见 Temporal Holdout 文档）。

### 5.2 Evaluation 同时作为 Evidence 和 External Factor

**检查**: A6.2 Evaluation 的 `findings` 既被 A6.6 Recommendation 用作 INFERRED Evidence，又被 A6.4 Calibration 用作 ExternalFactorSignal。

```
A6.2 Evaluation.findings → 
  A6.6 buildEvaluationEvidence() → INFERRED Evidence → Recommendation
  A6.4 buildExternalFactors() → ExternalFactorSignal → Resolution 判定
```

**这算不算自证？**

- Recommendation 用 Evaluation 的 findings 作为"策略评估"证据
- Calibration 用 Evaluation 的 findings 作为"外部因素"信号来排除某些 Resolution

**分析**: 这是**两个不同的用途**——Recommendation 用 findings 来支撑建议，Calibration 用 findings 来判断是否排除。两者不影响同一个 confidence 计算链。

**但存在风险**: 如果 Evaluation 的 finding 判断错误（如将模型误差误标为外部因素），会导致 Calibration 排除本应计入的 Resolution → ECE 被高估 → Reliability 判定 WELL_CALIBRATED → Recommendation 的 Calibration Evidence confidence 被拉高。

**结论**: ⚠️ 不是严格的自证循环，但存在**间接的 confidence 膨胀风险**——Evaluations 的外部因素判断会影响 Calibration 的样本集，进而影响 ECE，进而影响 Recommendation 的 confidence。

---

## 六、审计结论

### 6.1 自证循环

| 检查项 | 结论 |
|--------|------|
| A6 输出反馈为 A6 输入 | ✅ 无 |
| Confidence 自我强化 | ✅ 被硬约束阻止 |
| 循环依赖 | ✅ 无 |

### 6.2 数据泄漏

| 检查项 | 结论 |
|--------|------|
| 同一数据作为 Evidence 和 Validation | ✅ 不是（时间段不同） |
| Temporal leakage | ⚠️ `__reserveHistory` tick 关联不精确 |
| In-sample bias | ⚠️ 全部 Resolution 用于计算 ECE |

### 6.3 间接风险

| 风险 | 严重性 | 描述 |
|------|--------|------|
| 外部因素过度归因 | 低 | Attribution/Evaluation 的外部因素判断会影响 Calibration 样本集 |
| In-sample ECE 误导 | 中 | ECE 基于 in-sample，可能被误读为真实校准质量 |
| Confidence 膨胀 | 低 | 被 `min(evidence confidence)` 硬约束限制，但如果 ECE 被误读，消费方可能被误导 |

### 6.4 总体结论

A6 **不存在严格的自证循环**。数据流严格单向，confidence 传播有硬约束。

但存在**间接的 confidence 膨胀风险**：in-sample ECE 可能让 Calibration Evidence 看起来比实际更好，从而影响 Recommendation 的 confidence——虽然硬约束阻止了数值膨胀，但消费方可能被误导。

**建议**: 不立即修复（不涉及 frozen contract 修改），但标记为已知风险。如果未来要让 Recommendation 被消费，必须先建立 out-of-sample 验证机制。
