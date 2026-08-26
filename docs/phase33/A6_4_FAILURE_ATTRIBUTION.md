# A6.4 — Failure Attribution Design

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 设计 Prediction 失败后的归因分类、A6.1 Attribution 复用策略、Regime/External 干扰区分

---

## 一、核心原则

### 1.1 为什么不能简单归因

当 Prediction 被判定为 INCORRECT 或 FALSE_POSITIVE 时，不能简单得出 "model is bad" 的结论。需要回答：

- **是模型本身的错误吗？**（MODEL_ERROR）
- **是输入数据不足吗？**（INSUFFICIENT_DATA）
- **是 Regime Change 导致的吗？**（已在 Resolution 层处理为 REGIME_CHANGED）
- **是外部干扰导致的吗？**（已在 Resolution 层处理为 EXTERNAL_INTERFERENCE）
- **是预测窗口选择不当吗？**（HORIZON_MISMATCH）

### 1.2 与 Resolution Outcome 的关系

Failure Attribution **不覆盖** Resolution 层的 `REGIME_CHANGED` 和 `EXTERNAL_INTERFERENCE`——这两个在 Resolution 层已经分离。

Failure Attribution 只对 `INCORRECT` / `PARTIAL` / `FALSE_POSITIVE` / `FALSE_NEGATIVE` 的 Prediction 做进一步归因。

```
Resolution 层                          Attribution 层
────────────                           ──────────────
CORRECT          → 不需要 Attribution
INCORRECT        → MODEL_ERROR / INSUFFICIENT_DATA / HORIZON_MISMATCH
PARTIAL          → MODEL_ERROR / INSUFFICIENT_DATA / HORIZON_MISMATCH
FALSE_POSITIVE   → MODEL_ERROR / INSUFFICIENT_DATA / HORIZON_MISMATCH
FALSE_NEGATIVE   → MODEL_ERROR / INSUFFICIENT_DATA / HORIZON_MISMATCH
REGIME_CHANGED   → 不需要进一步 Attribution（已在 Resolution 层解释）
EXTERNAL_INTERFERENCE → 不需要进一步 Attribution（已在 Resolution 层解释）
INSUFFICIENT_OBSERVATION → 不需要 Attribution（原因就是观测不足）
```

---

## 二、Failure Attribution 枚举

### 2.1 定义

根据 A6.1/A6.2/A6.3 实际代码审计，以下 6 种 Attribution 分类有意义：

```typescript
type FailureAttributionCategory =
  | "MODEL_ERROR"             // 模型逻辑/参数/假设有误
  | "INSUFFICIENT_DATA"       // 训练/输入数据不足
  | "LOW_R2"                  // 回归拟合度低（趋势不显著）
  | "HORIZON_MISMATCH"        // 预测窗口选择不当
  | "OBSERVATION_GAP"         // 观测窗口内数据断档
  | "OUTCOME_AMBIGUOUS";      // 结果无法明确判定
```

### 2.2 被排除的枚举项

| 被排除项 | 理由 |
|---------|------|
| REGIME_CHANGE | 已在 Resolution 层处理为 `REGIME_CHANGED`，不进入 Attribution 层 |
| EXTERNAL_INTERFERENCE | 已在 Resolution 层处理为 `EXTERNAL_INTERFERENCE`，不进入 Attribution 层 |
| DATA_CORRUPTION | 归入 `INSUFFICIENT_DATA`——数据损坏表现为数据不足 |
| MODEL_ERROR（泛化版） | 需要细化——见 §2.3 |

### 2.3 各枚举的精确语义

#### MODEL_ERROR

**含义**: 模型本身的逻辑、参数或假设有误。

**判定条件**:
- Resolution 为 INCORRECT / FALSE_POSITIVE / FALSE_NEGATIVE
- Regime 未变化（regimeChanged = false）
- 无外部干扰（hasExternalInterference = false）
- 数据充足（observation samples ≥ 3）
- R² 不是极端低（regressionR2 ≥ 0.1）

**来源**: `prediction.evidence.modelParams` 中的模型参数与实际结果的偏差。

**统计处理**: 计入 calibration denominator，标记为 model error。

#### INSUFFICIENT_DATA

**含义**: 预测发布时输入数据不足，模型在不充分数据上勉强产出。

**判定条件**:
- `prediction.evidence.sampleRange.count < MIN_SAMPLES_FOR_PREDICTION`（A6.3 定义为 3）
- 或 `prediction.evidence.sampleRange.count < LOW_CONFIDENCE_SAMPLE_THRESHOLD`（A6.3 定义为 10）且 confidence > 0.3（PRED-005 违规的边界情况）

**来源**: `prediction.evidence.sampleRange.count`。

**统计处理**: 不计入 calibration denominator（因为模型在数据不足时就不应该产出高 confidence）。

#### LOW_R2

**含义**: 回归拟合度低——TimeSeries 趋势不显著，模型基于噪声做预测。

**判定条件**:
- `prediction.evidence.modelParams` 包含 `r2` 值
- `r2 < 0.1`（趋势弱）
- Resolution 为 INCORRECT

**来源**: A6.3 `time-series.ts` 的 `linearRegression` 返回的 `r2` 值。

**统计处理**: 计入 calibration denominator，但标记为 low_r2（后续可用于过滤低 R² 预测）。

#### HORIZON_MISMATCH

**含义**: 预测的时间窗口选择不当。

**判定条件**:
- Resolution 为 FALSE_POSITIVE（事件未在窗口内发生）
- 但实际在窗口结束后 `resolutionGracePeriod` 内发生了
- 或 `withinHorizon = false` 但 `actualValue` 接近 `predictedValue`

**来源**: ResolutionResult 的 `withinHorizon` + `actualValue` vs `predictedValue` 对比。

**统计处理**: 计入 calibration denominator，标记为 horizon mismatch。

#### OBSERVATION_GAP

**含义**: 观测窗口内存在大量数据断档，导致 Resolution 本身不可靠。

**判定条件**:
- Observation samples 中存在 > 500 tick 的 gap
- Resolution 为 INCORRECT 或 PARTIAL

**来源**: Observation 采样分析。

**统计处理**: 不计入 calibration denominator（因为 Resolution 本身不可靠）。

#### OUTCOME_AMBIGUOUS

**含义**: 实际结果无法明确判定预测是否正确。

**判定条件**:
- `relativeError` 在阈值边界附近（如 0.19 ~ 0.21 之间）
- 无法明确归入 CORRECT 或 INCORRECT

**来源**: ResolutionResult 的 `relativeError` 值。

**统计处理**: 不计入 calibration denominator。

---

## 三、A6.1 Attribution 复用策略

### 3.1 可复用的 A6.1 字段

| A6.1 字段 | A6.4 用途 | 复用方式 |
|----------|----------|---------|
| `attribution.primaryCause` | 交叉验证 Failure Attribution | 只读——如果 A6.1 primaryCause = RESOURCE_AVAILABILITY 且 Prediction 是 energy-shortage，可能指向 INSUFFICIENT_DATA |
| `attribution.externalFactors` | 判断 EXTERNAL_INTERFERENCE | 只读——已在 Resolution 层复用 |
| `attribution.confidence` | 归因可信度 | 只读——低 confidence 的 Attribution 不影响 Calibration |
| `attribution.evidence` | 可追溯链 | 只读——用于诊断 |

### 3.2 A6.1 AttributionFactor 到 A6.4 FailureAttribution 的映射

| A6.1 AttributionFactor | A6.4 关联 | 说明 |
|------------------------|----------|------|
| DECISION_QUALITY | → MODEL_ERROR | 决策质量归因——模型可能基于错误决策 |
| EXECUTION_QUALITY | → 不直接映射 | 执行质量是运行时问题，不是预测模型问题 |
| RESOURCE_AVAILABILITY | → INSUFFICIENT_DATA | 资源不足→数据不足 |
| LOGISTICS_QUALITY | → 不直接映射 | 物流质量是运行时问题 |
| COMBAT_OUTCOME | → 不直接映射 | 战斗结果是运行时结果 |
| EXTERNAL_THREAT | → EXTERNAL_INTERFERENCE（已在 Resolution 层处理） | 外部威胁 |
| TIMING | → HORIZON_MISMATCH | 时机问题→窗口选择 |
| INFRASTRUCTURE | → 不直接映射 | 基础设施是运行时问题 |
| INTEL_QUALITY | → INSUFFICIENT_DATA | 情报质量→数据不足 |
| ECONOMIC_GUARD | → 不直接映射 | 经济保护是运行时机制 |
| UNKNOWN | → OUTCOME_AMBIGUOUS | 无法归因→结果模糊 |

**关键原则**: 映射不是 1:1 自动转换。A6.4 只用 A6.1 的 Attribution 作为**辅助信号**，最终 Failure Attribution 由 A6.4 自己的规则判定。

### 3.3 不建立第二套 Attribution

A6.4 的 `FailureAttributionCategory` 不是对 A6.1 `AttributionFactor` 的重复。它们的职责不同：

| 维度 | A6.1 AttributionFactor | A6.4 FailureAttributionCategory |
|------|----------------------|-------------------------------|
| 归因对象 | Experience（决策结果） | Prediction（预测结果） |
| 归因目的 | 为什么决策成功/失败 | 为什么预测正确/错误 |
| 数据来源 | Outcome + Context | ResolutionResult + Prediction evidence |
| 层级 | A6.1 | A6.4 |

---

## 四、Failure Attribution 判定流程

```
输入：
  - resolutionResult: ResolutionResult
  - prediction: Prediction（A6.3 只读）

判定流程：
  1. 如果 resolution 是 REGIME_CHANGED / EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION
     → 不需要 Failure Attribution（已在 Resolution 层解释）
     → 返回 null

  2. 如果 resolution 是 CORRECT
     → 不需要 Failure Attribution
     → 返回 null

  3. 对 INCORRECT / PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE：

     a. 检查 OBSERVATION_GAP
        → 如果 observation 存在 > 500t gap → "OBSERVATION_GAP"

     b. 检查 INSUFFICIENT_DATA
        → 如果 prediction.evidence.sampleRange.count < 3 → "INSUFFICIENT_DATA"

     c. 检查 LOW_R2
        → 如果 prediction.evidence.modelParams.r2 < 0.1 → "LOW_R2"

     d. 检查 HORIZON_MISMATCH
        → 如果 resolution.withinHorizon = false
           且 actualValue 接近 predictedValue (relativeError < 0.3)
        → "HORIZON_MISMATCH"

     e. 检查 OUTCOME_AMBIGUOUS
        → 如果 relativeError 在边界 (0.19 ~ 0.21) → "OUTCOME_AMBIGUOUS"

     f. 默认 → "MODEL_ERROR"
```

---

## 五、FailureAttributionResult 类型设计

```typescript
/**
 * Failure Attribution Result — 对一条失败 Prediction 的归因结果。
 *
 * 纯数据对象，无 Game/Memory 引用。
 * 确定性：相同 ResolutionResult + 相同 Prediction → 相同 FailureAttributionResult。
 */
interface FailureAttributionResult {
  /** 关联的 Prediction ID。 */
  readonly predictionId: string;
  /** 关联的 ResolutionResult hash（确定性引用）。 */
  readonly resolutionHash: string;
  /** 归因分类。 */
  readonly category: FailureAttributionCategory;
  /** 归因描述。 */
  readonly reason: string;
  /** A6.1 Attribution 引用（如果有匹配的 Experience）。 */
  readonly a61PrimaryCause: string | null;
  /** A6.1 externalFactors 引用。 */
  readonly a61ExternalFactors: readonly string[];
  /** A6.2 Evaluation finding 引用（如果有匹配的 EvaluationFinding）。 */
  readonly a62FindingDescription: string | null;
  /** 模型 R² 值（如果有）。 */
  readonly modelR2: number | null;
  /** 样本数。 */
  readonly sampleCount: number;
  /** 确定性 hash。 */
  readonly attributionHash: string;
}
```

### 5.1 Hash 计算

```typescript
function failureAttributionHash(result: FailureAttributionResult): string {
  const payload = stableStringify({
    predictionId: result.predictionId,
    category: result.category,
    resolutionHash: result.resolutionHash,
    modelR2: result.modelR2 !== null ? Number(result.modelR2.toFixed(3)) : null,
    sampleCount: result.sampleCount,
  });
  return fnv1a32Hex(payload);
}
```

---

## 六、Model-Level Failure Attribution Statistics

### 6.1 按模型聚合

Failure Attribution 按模型分组统计：

```typescript
interface ModelFailureStats {
  /** 模型标识。 */
  readonly modelKey: string;
  /** 总失败数（INCORRECT + PARTIAL + FALSE_POSITIVE + FALSE_NEGATIVE）。 */
  readonly totalFailures: number;
  /** 各归因分类的计数。 */
  readonly attributionCounts: {
    readonly MODEL_ERROR: number;
    readonly INSUFFICIENT_DATA: number;
    readonly LOW_R2: number;
    readonly HORIZON_MISMATCH: number;
    readonly OBSERVATION_GAP: number;
    readonly OUTCOME_AMBIGUOUS: number;
  };
  /** 主要失败原因（最多的分类）。 */
  readonly dominantFailureCategory: FailureAttributionCategory | null;
  /** 确定性 hash。 */
  readonly statsHash: string;
}
```

### 6.2 统计用途

| 统计 | 用途 | 消费方 |
|------|------|--------|
| MODEL_ERROR 占比 | 判断模型是否需要重写 | A6.5+（只读消费） |
| INSUFFICIENT_DATA 占比 | 判断是否需要更多数据源 | A6.5+（只读消费） |
| LOW_R2 占比 | 判断模型是否适用于当前场景 | A6.5+（只读消费） |
| HORIZON_MISMATCH 占比 | 判断窗口选择策略是否需要调整 | A6.5+（只读消费） |
| OBSERVATION_GAP 占比 | 判断观测 cadence 是否需要加密 | A6.5+（只读消费） |

**关键**: A6.4 只**产出**这些统计。A6.4 不**消费**它们做任何执行决策。

---

## 七、Partial Resolution 的归因特殊性

### 7.1 Partial 的含义

Partial Resolution 表示预测方向正确但幅度偏差大。这不是完全失败，也不是完全成功。

### 7.2 Partial 的归因

| Partial 子类型 | 判定 | 归因 |
|---------------|------|------|
| 预测值偏高 | actualValue < predictedValue, directionCorrect=true | MODEL_ERROR（幅度估计偏差） |
| 预测值偏低 | actualValue > predictedValue, directionCorrect=true | MODEL_ERROR（幅度估计偏差） |
| 方向正确但阈值未触发 | directionCorrect=true, thresholdTriggered=false | HORIZON_MISMATCH（趋势正确但时间不够） |

### 7.3 防退化

- Partial **不自动**归因为 MODEL_ERROR——需要检查是否有数据不足/R² 低等解释
- Partial 的归因优先级与 INCORRECT 相同（按 §四 的判定流程）
- Partial 的 Calibration 处理已在 Confidence Calibration 中定义（计半分）

---

## 八、与 Confidence Calibration 的关系

### 8.1 数据流

```
ResolutionResult
    ↓
    ├─→ Confidence Calibration（统计 CORRECT/INCORRECT/PARTIAL/FP/FN）
    │
    └─→ Failure Attribution（对 INCORRECT/PARTIAL/FP/FN 做归因）
         ↓
         ModelFailureStats
```

### 8.2 分工

| 职责 | Confidence Calibration | Failure Attribution |
|------|----------------------|---------------------|
| 回答什么 | confidence 是否可信？ | 预测为什么失败？ |
| 输入 | ResolutionResult | ResolutionResult + Prediction |
| 输出 | ModelCalibrationProfile | ModelFailureStats |
| 用于 | 后续阶段判断模型可信度 | 后续阶段判断模型改进方向 |
| 不做 | 不做归因 | 不做 calibration 度量 |

两者互补但独立。不合并为单一 score。
