# A6.4 — Resolution Design

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 设计 Prediction Resolution 的 canonical 定义、Horizon Resolution 模型、Outcome Classification 枚举

---

## 一、Resolution 的 Canonical 定义

### 1.1 核心概念

**Prediction Resolution** = 将一条已到期的 Prediction 与其在真实世界中发生的（或未发生的）结果进行对比，产出一条确定性的 Resolution 结果。

Resolution 不是重新预测。Resolution 不修改 Prediction。Resolution 不修改 Runtime。

### 1.2 Resolution 数据流

```
Prediction（A6.3 产出）
    ↓
Observation Window（A6.4 在 Prediction 窗口内采集）
    ↓
Resolution Engine（A6.4 纯函数）
    ↓
ResolutionResult（A6.4 Domain 类型）
    ↓
CalibrationRecord（A6.4 存入 Ring Buffer）
```

### 1.3 与 A6.3 resolve.ts 的关系

A6.3 `resolve.ts` 中的 `verifyPrediction` 函数是 **Lifecycle Resolution**——它只判断 Prediction 是否 fulfilled/expired/invalidated，用于更新 Ring Buffer 中的 status 字段。

A6.4 的 Resolution 是 **Calibration Resolution**——它在 Lifecycle Resolution 的基础上增加更细粒度的分类，用于校准 Confidence。

| 维度 | A6.3 `resolve.ts` | A6.4 Resolution |
|------|-------------------|-----------------|
| 目的 | 更新 Prediction status | 校准 Confidence |
| 分类粒度 | 3 类（fulfilled/expired/invalidated） | 8 类（见 §二） |
| Regime 检查 | ❌ | ✅ |
| External Interference | ❌ | ✅ |
| Partial Resolution | ❌ | ✅ |
| Observation Window | ❌ 单点对比 | ✅ 窗口内连续观察 |
| 修改 Prediction | ✅ 更新 status | ❌ 不修改 |

**关键原则**: A6.4 不修改 A6.3 的 Prediction 对象。A6.4 只读取 Prediction 和 Observation，产出独立的 ResolutionResult。

---

## 二、Resolution Outcome Classification

### 2.1 枚举定义

根据 A6.3 实际代码审计和 A6.0/A6.3 契约，以下 8 种 Resolution 类型有意义：

```typescript
type CalibrationResolution =
  | "CORRECT"
  | "INCORRECT"
  | "PARTIAL"
  | "FALSE_POSITIVE"
  | "FALSE_NEGATIVE"
  | "REGIME_CHANGED"
  | "EXTERNAL_INTERFERENCE"
  | "INSUFFICIENT_OBSERVATION";
```

### 2.2 枚举语义

| Resolution | 含义 | 数学/统计处理 |
|-----------|------|---------------|
| **CORRECT** | 预测值与实际值在容差范围内一致 | 计入 calibration numerator + denominator |
| **INCORRECT** | 预测值与实际值显著偏离，无外部因素 | 计入 calibration numerator + denominator |
| **PARTIAL** | 预测方向正确但幅度偏差超出容差 | 计入 calibration denominator，标记为 partial |
| **FALSE_POSITIVE** | 预测事件未发生，但预测说会发生 | 计入 calibration denominator |
| **FALSE_NEGATIVE** | 预测事件发生了，但预测说不会发生 | 计入 calibration denominator（仅对"不会发生"型预测） |
| **REGIME_CHANGED** | 预测发布后 Regime 发生重大变化 | **不计入** calibration denominator（§六） |
| **EXTERNAL_INTERFERENCE** | 预测合理但外部因素导致结果改变 | **不计入** calibration denominator（§七） |
| **INSUFFICIENT_OBSERVATION** | Observation 窗口内数据不足 | **不计入** calibration denominator |

### 2.3 被排除的枚举项

| 被排除项 | 理由 |
|---------|------|
| EARLY | 对 Screeps 预测无意义——预测窗口是"何时"而非"是否"，提前发生应算 CORRECT |
| LATE | 同上——超出窗口后发生应算 INCORRECT 或 FALSE_POSITIVE |
| UNRESOLVED | 归入 INSUFFICIENT_OBSERVATION |
| DATA_CORRUPTION | 归入 INSUFFICIENT_OBSERVATION |
| OUTCOME_AMBIGUOUS | 归入 INSUFFICIENT_OBSERVATION |
| HORIZON_MISMATCH | 归入 INCORRECT（预测窗口选择本身就是模型的一部分） |
| LOW_R2 | 这是模型质量问题，不是 Resolution 分类——通过 Calibration Statistics 的 model-level 分析发现 |
| MODEL_ERROR | 这是 Failure Attribution 分类，不是 Resolution 分类 |

### 2.4 Resolution 判定规则

```
输入：
  - prediction: Prediction（A6.3 冻结类型，只读）
  - observations: ObservationSample[]（窗口内采样）
  - currentContext: PredictionContext（Resolution 时的 Regime）
  - externalFactors: ExternalFactorSignal[]（来自 A6.1/A6.2）

判定流程：
  1. 检查 observation 是否充足 → INSUFFICIENT_OBSERVATION
  2. 检查 Regime 是否变化 → REGIME_CHANGED（如果严重）
  3. 检查 External Interference → EXTERNAL_INTERFERENCE（如果有）
  4. 计算 predicted vs actual 偏差
  5. 根据 Prediction 类型选择 Resolution Metric
  6. 判定 CORRECT / INCORRECT / PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE
```

---

## 三、Horizon Resolution 模型

### 3.1 Prediction Horizon ≠ Resolution Window

**关键设计决策**：

- **Prediction Horizon** = `prediction.window`（从 startTick 到 endTick）
- **Resolution Window** = `[endTick, endTick + resolutionGracePeriod]`

**为什么不同？**

Prediction 的 Horizon 是预测的时间范围。Resolution 不能只在 endTick 时做单点检查——因为：

1. 事件可能在 Horizon 内任何时间发生（EARLY 问题）
2. 事件可能在 Horizon 内发生后恢复
3. 事件可能在 Horizon 外刚好发生（边界效应）
4. 单点检查会丢失窗口内的趋势信息

**Resolution 策略**：

```
Prediction Window: [startTick ─────────── endTick]
                                            │
                              Resolution Grace Period (100 tick)
                                            │
                                            ▼
                                    Resolution Tick (endTick + 100)
```

- 在 `[startTick, endTick]` 范围内，按模型的 cadence 采集 Observation Samples
- 在 `endTick + resolutionGracePeriod` 时执行 Resolution
- Grace Period = 100 tick（允许数据延迟到达）

### 3.2 Observation Window 采样

Observation 不是每 tick 采集。A6.4 复用既有 cadence：

| Prediction Target | Observation 来源 | Cadence |
|-------------------|-----------------|---------|
| energy-shortage | globalCache.empireHealth + globalCache.__reserveHistory | 100t |
| spawn-starvation | globalCache.empireHealth.dimensions.spawn + spawn queue | 100t |

**Observation 采集方式**：

A6.4 不新建采样通道（遵守 CAL-007 No New Tick Sampler）。A6.4 Resolution Engine 在低频运行时，从 globalCache 读取当前值 + A6.3 TimeSeries 历史，构建 Observation 序列。

### 3.3 连续结果处理

对于值型预测（如"未来 1000t 储备将降到 2000"），Resolution 需要检查：

| 维度 | 计算 | 用途 |
|------|------|------|
| predicted value | `prediction.value` | 预测值 |
| actual value | 窗口内最低值 / 窗口结束值 | 实际值 |
| absolute error | `|actual - predicted|` | 绝对误差 |
| relative error | `|actual - predicted| / |predicted|` | 相对误差 |
| direction correctness | 预测下降 vs 实际下降 | 方向是否正确 |
| threshold correctness | 是否跌破阈值 | 阈值是否被触发 |

**禁止**: 将这些维度合并为单一 score。

### 3.4 不同模型的 Resolution Metric

| Model | Resolution Metric | CORRECT 阈值 | INCORRECT 阈值 |
|-------|------------------|-------------|----------------|
| energy-shortage | `relativeError < 0.2` → CORRECT | < 20% | ≥ 50% |
| energy-shortage | `directionCorrect && thresholdTriggered` → CORRECT | 方向正确 + 阈值触发 | 方向错误 |
| spawn-starvation | `relativeError < 0.3` → CORRECT | < 30% | ≥ 50% |
| spawn-starvation | `queueTrend match` → CORRECT | 预测增长实际增长 | 预测增长实际下降 |

**禁止**: 建立万能 Resolution Metric。每个模型定义自己的 Metric 函数。

---

## 四、ResolutionResult 类型设计

```typescript
/**
 * Resolution Result — A6.4 对一条 Prediction 的 Resolution 结果。
 *
 * 纯数据对象，不引用 Game/Memory/Prediction 可变状态。
 * 确定性：相同 Prediction + 相同 Observation → 相同 ResolutionResult。
 */
interface ResolutionResult {
  /** 关联的 Prediction ID。 */
  readonly predictionId: string;
  /** Resolution 分类。 */
  readonly resolution: CalibrationResolution;
  /** Resolution 执行 tick。 */
  readonly resolvedTick: number;
  /** 预测值（从 Prediction 复制，用于独立 hash）。 */
  readonly predictedValue: number;
  /** 实际值（Resolution 时的观测值）。 */
  readonly actualValue: number;
  /** 绝对误差。 */
  readonly absoluteError: number;
  /** 相对误差。 */
  readonly relativeError: number;
  /** 方向是否正确。 */
  readonly directionCorrect: boolean;
  /** 是否在 Horizon 内发生。 */
  readonly withinHorizon: boolean;
  /** Resolution 时的 Regime 签名。 */
  readonly resolutionContextSignature: string;
  /** Regime 是否发生变化。 */
  readonly regimeChanged: boolean;
  /** Regime 变化的维度列表。 */
  readonly regimeMismatchedDimensions: readonly string[];
  /** 是否有外部因素干扰。 */
  readonly hasExternalInterference: boolean;
  /** 外部因素来源列表（引用 A6.1 attribution.externalFactors 或 A6.2 findings）。 */
  readonly externalFactorSources: readonly string[];
  /** Resolution 描述。 */
  readonly reason: string;
  /** 确定性 hash。 */
  readonly resolutionHash: string;
}
```

### 4.1 确定性保证

ResolutionResult 的 hash 计算：

```
hash = fnv1a32Hex(stableStringify({
  predictionId,
  resolution,
  resolvedTick,
  predictedValue: predictedValue.toFixed(3),
  actualValue: actualValue.toFixed(3),
  relativeError: relativeError.toFixed(3),
  directionCorrect,
  withinHorizon,
  regimeChanged,
  hasExternalInterference,
}))
```

100 次 replay → 100% identical hash。

---

## 五、反事实场景 C1-C12 设计

### 5.1 场景定义

| ID | 场景 | 预期 Resolution | 验证要点 |
|----|------|-----------------|---------|
| C1 | 预测 shortage，实际 shortage 在窗口内发生 | CORRECT | actualValue ≤ threshold, withinHorizon=true |
| C2 | 预测 shortage，实际 shortage 没有发生 | FALSE_POSITIVE | actualValue > threshold, withinHorizon=false |
| C3 | 当前状态与预测冲突（当前已 shortage 但预测说 STABLE） | INCORRECT | directionCorrect=false |
| C4 | 预测在 Horizon 内发生 | CORRECT | withinHorizon=true |
| C5 | 预测在 Horizon 外发生 | INCORRECT | withinHorizon=false |
| C6 | 发布时 context=A，Resolution 时 context=B（posture 变化） | REGIME_CHANGED | regimeChanged=true, mismatchedDimensions includes "posture" |
| C7 | 预测 shortage，但外部能量注入导致 shortage 没发生 | EXTERNAL_INTERFERENCE | hasExternalInterference=true |
| C8 | 数据不足（Observation 样本 < 3） | INSUFFICIENT_OBSERVATION | observations.length < 3 |
| C9 | Observation gap（窗口内 500+ tick 无采样） | INSUFFICIENT_OBSERVATION | maxGap > 500 |
| C10 | confidence=0.8 但实际只有 40% 成功 | OVERCONFIDENT（Calibration 层面） | 需要 100 样本才能判定 |
| C11 | confidence=0.2 但实际成功 | UNDERCONFIDENT（Calibration 层面） | 需要 100 样本才能判定 |
| C12 | 完全相同输入 → 完全相同 ResolutionResult | — | 100×replay hash 一致 |

### 5.2 C1-C3 防退化验证

| 退化模式 | 对应场景 | 防退化措施 |
|---------|---------|----------|
| 退化 1：单点检查 | C1, C2 | A6.4 Resolution 检查整个 Observation Window |
| 退化 2：confidence = success rate | C10, C11 | A6.4 按分桶统计 + 考虑 regime/horizon/external |
| 退化 3：万能 score | 所有 | A6.4 每个模型独立统计 |
| 退化 4：合并所有模型 | 所有 | A6.4 按 model/target 分组 |
| 退化 5：直接喂 Strategy | 所有 | A6.4 CAL-009 No Strategy Mutation |
| 退化 6：Regime = Model Failure | C6 | A6.4 REGIME_CHANGED 不计入 denominator |
| 退化 7：External = Failure | C7 | A6.4 EXTERNAL_INTERFERENCE 不计入 denominator |

---

## 六、Regime Change 处理规则

### 6.1 Regime Change 检测

A6.4 复用 A6.3 的 `checkRegimeCompatibility` 函数比较 Prediction 发布时的 `context` 与 Resolution 时的 `currentContext`。

### 6.2 Regime Change → REGIME_CHANGED 的条件

| 条件 | 判定 |
|------|------|
| mismatchedDimensions.length ≥ 3 | REGIME_CHANGED |
| mismatchedDimensions 包含 "posture" | REGIME_CHANGED（posture 变化是严重 Regime Change） |
| mismatchedDimensions.length = 1-2 且不含 "posture" | 不标记 REGIME_CHANGED，但在 CalibrationRecord 中记录 regime drift |
| mismatchedDimensions.length = 0 | 正常 Resolution |

### 6.3 为什么 Regime Change 不计入 Calibration Denominator

**数学理由**：

如果 Prediction 在 context=A 下发布，但 Resolution 时 context=B，那么 Prediction 的模型（在 A 下训练/推导）在 B 下的表现不反映模型质量。将 REGIME_CHANGED 计入 INCORRECT 会：

1. 惩罚模型无法控制的外部变化
2. 导致 Confidence 校准偏向保守（因为 Regime Change 频繁时 INCORRECT 比例虚高）
3. 使 Calibration Statistics 失去对模型本身的诊断价值

**统计处理**：REGIME_CHANGED 的 Prediction 单独统计为 `regimeChangeRate`，不进入 `observedSuccessRate` 的分子或分母。

---

## 七、External Interference 处理规则

### 7.1 External Interference 检测

A6.4 复用 A6.1 `Attribution.externalFactors` 和 A6.2 `findings[].hasExternalFactor`。

| 信号来源 | 检测方式 |
|---------|---------|
| A6.1 Attribution.externalFactors 非空 | `experience.attribution.externalFactors.length > 0` |
| A6.2 EvaluationFinding.hasExternalFactor | `finding.hasExternalFactor === true` |
| globalCache.externalEnergyInflow > 0 | 从 globalCache 直接读取 |
| Prediction evidence 中 externalEnergyInflow > 0 | 从 `prediction.evidence.modelParams` 读取 |

### 7.2 External Interference → EXTERNAL_INTERFERENCE 的条件

| 条件 | 判定 |
|------|------|
| External factor 存在 **且** 预测方向与实际方向不一致 | EXTERNAL_INTERFERENCE |
| External factor 存在 **但** 预测方向与实际方向一致 | CORRECT（外部因素未改变结果） |
| External factor 不存在 | 正常 Resolution |

### 7.3 为什么 External Interference 不计入 Calibration Denominator

**数学理由**：

如果 Prediction 基于内部趋势外推预测 shortage，但市场购买注入能量导致 shortage 没发生，这不是模型错误——模型正确识别了内部趋势，只是外部因素改变了结果。将这种情况计入 INCORRECT 会：

1. 系统性地低估模型质量（外部因素频繁时）
2. 鼓励模型在发布时就考虑外部因素（但这违反了模型职责边界——模型应只基于内部趋势预测）

**统计处理**：EXTERNAL_INTERFERENCE 的 Prediction 单独统计为 `externalInterferenceRate`，不进入 `observedSuccessRate`。
