# A6.4 — Counterfactual Audit

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 设计 C1-C12 反事实场景，验证每种场景下 Resolution、Calibration、Attribution 的正确分类

---

## 一、审计目标

本文档设计 12 个反事实场景（C1-C12），验证 A6.4 的 Resolution Engine、Confidence Calibration、Failure Attribution 在每种场景下能产出正确的分类结果。

**验证标准**: 每个场景必须明确预期 Resolution、预期 Calibration 处理、预期 Failure Attribution，并说明防退化检查点。

---

## 二、场景定义

### C1: Prediction 正确发生

**场景描述**: 预测 "未来 1000t Energy Reserve 将跌破 2000"。实际在第 800t 跌破 2000。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1800, value: 1950 }]`（窗口内）
- Context: 发布时和 Resolution 时 Regime 一致
- External Factors: 无

**预期 Resolution**: `CORRECT`
- `actualValue = 1950 ≤ predictedValue = 2000`
- `withinHorizon = true`
- `relativeError = |1950 - 2000| / |2000| = 0.025 < 0.2`
- `directionCorrect = true`（预测下降，实际下降）
- `regimeChanged = false`
- `hasExternalInterference = false`

**预期 Calibration**: 计入 numerator + denominator

**预期 Failure Attribution**: `null`（CORRECT 不需要归因）

**防退化检查**: ✅ 不是单点检查（使用了 Observation Window）

---

### C2: Prediction 没有发生

**场景描述**: 预测 "未来 1000t Energy Reserve 将跌破 2000"。实际在第 2000t Reserve 仍为 5000。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1000, value: 5000 }, { tick: 1500, value: 4800 }, { tick: 2000, value: 5000 }]`
- Context: 一致
- External Factors: 无

**预期 Resolution**: `FALSE_POSITIVE`
- `actualValue = 5000 > predictedValue = 2000`
- `withinHorizon = false`（事件未在窗口内发生）
- `directionCorrect = false`（预测下降到 2000，实际未下降到阈值）
- `regimeChanged = false`
- `hasExternalInterference = false`

**预期 Calibration**: 计入 denominator（FALSE_POSITIVE）

**预期 Failure Attribution**: `MODEL_ERROR`（模型预测了未发生的事件，无外部解释）

**防退化检查**: ✅ 不将 FALSE_POSITIVE 统计为 CORRECT

---

### C3: 当前状态与预测冲突

**场景描述**: 预测 "Energy Reserve STABLE"。但当前已经处于 Energy Shortage 状态。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 5000, confidence: 0.6, window: { startTick: 1000, endTick: 2000 } }`（预测值高 = STABLE）
- Observation: `[{ tick: 1000, value: 1500 }]`（当前已低于阈值）
- Context: 一致
- External Factors: 无

**预期 Resolution**: `INCORRECT`
- `actualValue = 1500 ≪ predictedValue = 5000`
- `relativeError = |1500 - 5000| / |5000| = 0.7 ≥ 0.5`
- `directionCorrect = false`（预测 STABLE，实际已 shortage）

**预期 Calibration**: 计入 denominator（INCORRECT）

**预期 Failure Attribution**: `MODEL_ERROR`（模型未检测到当前状态与预测的冲突）

**防退化检查**: ✅ 不将状态冲突统计为 REGIME_CHANGED

---

### C4: Horizon 内发生

**场景描述**: 预测 "未来 1000t Energy Reserve 将跌破 2000"。实际在第 1500t 跌破 2000。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.8, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1200, value: 2100 }, { tick: 1500, value: 1800 }, { tick: 1800, value: 1700 }]`
- Context: 一致
- External Factors: 无

**预期 Resolution**: `CORRECT`
- `actualValue = 1800 ≤ predictedValue = 2000`
- `withinHorizon = true`（第 1500t 在 [1000, 2000] 内）
- `relativeError = |1800 - 2000| / |2000| = 0.1 < 0.2`
- `directionCorrect = true`

**预期 Calibration**: 计入 numerator + denominator

**预期 Failure Attribution**: `null`

**防退化检查**: ✅ 事件在窗口内发生算 CORRECT，不算 EARLY

---

### C5: Horizon 外发生

**场景描述**: 预测 "未来 1000t Energy Reserve 将跌破 2000"。实际在第 2500t 才跌破 2000（超出窗口）。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1000, value: 3000 }, { tick: 1500, value: 2800 }, { tick: 2000, value: 2500 }]`（窗口内未跌破）
- Post-window: `[{ tick: 2500, value: 1900 }]`（窗口外才跌破）

**预期 Resolution**: `INCORRECT`
- `actualValue = 2500 > predictedValue = 2000`（窗口结束时未跌破）
- `withinHorizon = false`
- `relativeError = |2500 - 2000| / |2000| = 0.25`（在 0.2-0.5 之间）

**注意**: 此处 `relativeError = 0.25` 在 CORRECT(0.2) 和 INCORRECT(0.5) 之间。根据 Resolution Design §2.4 的判定规则，应判为 `PARTIAL`。

**修正预期 Resolution**: `PARTIAL`
- 预测方向正确（确实在下降）但幅度/时间不准

**预期 Calibration**: 计入 denominator（PARTIAL, 计半分）

**预期 Failure Attribution**: `HORIZON_MISMATCH`（窗口外发生 → 窗口选择不当）

**防退化检查**: ✅ 超出窗口的事件不被错误标为 CORRECT

---

### C6: Regime Change

**场景描述**: 预测发布时 posture=peace，Resolution 时 posture=war。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 }, context: { posture: "peace", watchdogTier: "healthy", ... } }`
- Observation: `[{ tick: 1500, value: 4000 }]`（war 期间能量消耗模式不同）
- Current Context: `{ posture: "war", watchdogTier: "guarded", ... }`
- External Factors: 无

**Regime 检查**:
- `checkRegimeCompatibility(prediction.context, currentContext)`
- `mismatchedDimensions = ["posture", "watchdog_tier"]`
- `mismatchedDimensions` 包含 "posture" → REGIME_CHANGED

**预期 Resolution**: `REGIME_CHANGED`
- `regimeChanged = true`
- `regimeMismatchedDimensions = ["posture", "watchdog_tier"]`

**预期 Calibration**: **不计入** denominator

**预期 Failure Attribution**: `null`（REGIME_CHANGED 不需要进一步归因）

**防退化检查**: ✅ Regime Change 不被统计为 Model Failure（退化 6 防护）

---

### C7: External Interference

**场景描述**: 预测 "未来 1000t Energy Reserve 将跌破 2000"。期间通过市场购买注入了大量能量，Reserve 未跌破。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1000, value: 3000 }, { tick: 1500, value: 2800 }, { tick: 2000, value: 3500 }]`
- Context: 一致
- External Factors: `[{ source: "market-purchase", description: "energy inflow", magnitude: 2000 }]`（A6.1 attribution.externalFactors 非空）
- A6.2 Evaluation: `finding.hasExternalFactor = true`

**预期 Resolution**: `EXTERNAL_INTERFERENCE`
- `hasExternalInterference = true`
- `externalFactorSources = ["market-purchase", "evaluation-finding"]`
- 预测方向（下降）与实际方向（上升）不一致
- External factor 存在 → EXTERNAL_INTERFERENCE

**预期 Calibration**: **不计入** denominator

**预期 Failure Attribution**: `null`（EXTERNAL_INTERFERENCE 不需要进一步归因）

**防退化检查**: ✅ External Interference 不被统计为 Model Failure（退化 7 防护）

---

### C8: 数据不足

**场景描述**: 预测窗口内只有 2 个 Observation 样本（< MIN_SAMPLES = 3）。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1000, value: 3000 }, { tick: 2000, value: 2500 }]`（只有 2 个样本）

**预期 Resolution**: `INSUFFICIENT_OBSERVATION`
- `observations.length = 2 < 3`

**预期 Calibration**: **不计入** denominator

**预期 Failure Attribution**: `null`（原因已明确：观测不足）

**防退化检查**: ✅ 不基于不足数据强行判定 CORRECT 或 INCORRECT

---

### C9: Observation Gap

**场景描述**: 窗口内有足够样本数，但存在 > 500 tick 的数据断档。

**输入**:
- Prediction: `{ target: "energy-shortage", value: 2000, confidence: 0.7, window: { startTick: 1000, endTick: 2000 } }`
- Observation: `[{ tick: 1000, value: 3000 }, { tick: 1100, value: 2900 }, { tick: 1800, value: 2000 }, { tick: 2000, value: 1800 }]`
- Gap: 第 1100t 到第 1800t 之间有 700t 断档

**预期 Resolution**: `INSUFFICIENT_OBSERVATION`
- `maxGap = 700 > 500`

**预期 Calibration**: **不计入** denominator

**预期 Failure Attribution**: `OBSERVATION_GAP`（如果在某种情况下 Resolution 先判为 INCORRECT 再做 Attribution）

**注意**: 此场景实际上在 Resolution 层就会被判为 INSUFFICIENT_OBSERVATION，所以 Failure Attribution 不会执行。但如果样本数恰好为 3 且 maxGap > 500，Resolution 层先判 INSUFFICIENT_OBSERVATION。

**防退化检查**: ✅ 不基于断档数据判定 CORRECT/INCORRECT

---

### C10: Confidence 高但实际失败（OVERCONFIDENT）

**场景描述**: 100 条 confidence ≈ 0.8 的 Prediction 中，只有 40 条 CORRECT。

**输入**: 这不是一个单条 Prediction 的场景，而是一个 Calibration 统计场景。

**输入数据**:
- 100 条 ResolutionResult，其中：
  - 40 条 CORRECT
  - 30 条 INCORRECT
  - 20 条 FALSE_POSITIVE
  - 10 条 PARTIAL
- 所有 Prediction 的 confidence 在 [0.7, 0.8] 范围（Bucket 7）

**预期 Calibration**:
- Bucket 7: `avgConfidence ≈ 0.75, observedSuccessRate = (40 + 0.5×10) / 100 = 0.45`
- `calibrationError = |0.75 - 0.45| = 0.3 > 0.15`
- `CalibrationVerdict = OVERCONFIDENT`

**预期 Failure Attribution**: 多数 INCORRECT 的 Prediction 应归因为 `MODEL_ERROR`

**防退化检查**: ✅ 不将 confidence 直接等同于 success rate（退化 2 防护）
✅ 使用 ECE 而非简单 success rate

---

### C11: Confidence 低但实际成功（UNDERCONFIDENT）

**场景描述**: 100 条 confidence ≈ 0.2 的 Prediction 中，60 条 CORRECT。

**输入数据**:
- 100 条 ResolutionResult，其中：
  - 60 条 CORRECT
  - 20 条 INCORRECT
  - 10 条 FALSE_POSITIVE
  - 10 条 PARTIAL
- 所有 Prediction 的 confidence 在 [0.1, 0.2] 范围（Bucket 1）

**预期 Calibration**:
- Bucket 1: `avgConfidence ≈ 0.15, observedSuccessRate = (60 + 0.5×10) / 100 = 0.65`
- `calibrationError = |0.15 - 0.65| = 0.5 > 0.15`
- `CalibrationVerdict = UNDERCONFIDENT`

**预期 Failure Attribution**: 不适用（统计层面，不是单条 Prediction）

**防退化检查**: ✅ 低 confidence 成功不被错误惩罚
✅ Calibration 判定的是校准质量，不是绝对准确率

---

### C12: 完全相同输入 → 完全相同输出（Deterministic Replay）

**场景描述**: 对同一组 Prediction + Observation + Context + ExternalFactors，运行 100 次 Resolution。

**输入**:
- 固定的 Prediction 对象
- 固定的 Observation 数组
- 固定的 Context 对象
- 固定的 ExternalFactors 数组

**验证步骤**:
1. 调用 `resolvePrediction()` 100 次
2. 检查每次返回的 `ResolutionResult.resolutionHash` 是否一致
3. 调用 `computeCalibrationProfile()` 100 次（对同一组 ResolutionResult）
4. 检查每次返回的 `ModelCalibrationProfile.profileHash` 是否一致
5. 调用 `attributeFailure()` 100 次
6. 检查每次返回的 `FailureAttributionResult.attributionHash` 是否一致

**预期结果**: 100 次 replay → 100% identical hash

**防退化检查**: ✅ 确定性保证——无 Math.random / Date.now / 浮点误差

---

## 三、场景覆盖矩阵

### 3.1 Resolution 覆盖

| Resolution 类型 | 覆盖场景 | 场景数 |
|-----------------|---------|--------|
| CORRECT | C1, C4 | 2 |
| INCORRECT | C3, C5(修正为PARTIAL) | 1 |
| PARTIAL | C5 | 1 |
| FALSE_POSITIVE | C2 | 1 |
| FALSE_NEGATIVE | —（需要"预测不会发生"型 Prediction，当前模型不产出） | 0 |
| REGIME_CHANGED | C6 | 1 |
| EXTERNAL_INTERFERENCE | C7 | 1 |
| INSUFFICIENT_OBSERVATION | C8, C9 | 2 |

**注意**: FALSE_NEGATIVE 在当前 2 个 Prediction Model（energy-shortage, spawn-starvation）中不会产出——因为这两个模型都是"预测事件会发生"型，不存在"预测事件不会发生"的 Prediction。FALSE_NEGATIVE 的 Resolution 类型保留在枚举中，供未来模型使用。

### 3.2 Calibration 层覆盖

| Calibration 场景 | 覆盖场景 |
|-----------------|---------|
| 计入 numerator | C1, C4 |
| 计入 denominator only | C2, C3 |
| 计入 denominator (partial) | C5 |
| 不计入 denominator (REGIME_CHANGED) | C6 |
| 不计入 denominator (EXTERNAL_INTERFERENCE) | C7 |
| 不计入 denominator (INSUFFICIENT_OBSERVATION) | C8, C9 |
| OVERCONFIDENT | C10 |
| UNDERCONFIDENT | C11 |
| Deterministic | C12 |

### 3.3 Failure Attribution 覆盖

| Attribution | 覆盖场景 |
|------------|---------|
| null (CORRECT) | C1, C4 |
| MODEL_ERROR | C2, C3, C10 |
| HORIZON_MISMATCH | C5 |
| null (REGIME_CHANGED) | C6 |
| null (EXTERNAL_INTERFERENCE) | C7 |
| null (INSUFFICIENT_OBSERVATION) | C8, C9 |
| OBSERVATION_GAP | C9 (if Resolution allows) |

---

## 四、退化模式验证汇总

| 退化模式 | 验证场景 | 验证结果 |
|---------|---------|---------|
| 退化 1：单点 Resolution | C1, C2 | ✅ 使用 Observation Window，不是 endTick 单点检查 |
| 退化 2：confidence = success rate | C10, C11 | ✅ 使用 Bucket + ECE，考虑 regime/horizon/external |
| 退化 3：万能 predictionScore | 所有 | ✅ 每个模型独立 Resolution Metric，不合并 |
| 退化 4：合并所有模型 | 所有 | ✅ 按 modelKey 分组统计 |
| 退化 5：直接喂 Strategy | 所有 | ✅ CAL-009 防护，只写 __calibrationCache |
| 退化 6：Regime = Model Failure | C6 | ✅ REGIME_CHANGED 不计入 denominator |
| 退化 7：External = Failure | C7 | ✅ EXTERNAL_INTERFERENCE 不计入 denominator |

---

## 五、边界情况补充

### 5.1 混合场景：Regime Change + 实际 CORRECT

**场景**: 预测 shortage，期间 posture 从 peace 变为 war，但 shortage 确实发生了。

**判定**:
- Regime Change 严重（posture 变化） → `REGIME_CHANGED`
- 即使事件发生了，也标记为 REGIME_CHANGED
- **不计入 denominator** — 因为模型在 peace context 下做出的预测在 war context 下验证是不公平的

**理由**: Calibration 的目的是度量模型在**相同 Regime** 下的可靠性。跨 Regime 的 CORRECT 不比跨 Regime 的 INCORRECT 更有信息量。

### 5.2 混合场景：External + 实际 CORRECT

**场景**: 预测 shortage，期间有外部能量注入，但 shortage 仍然发生了（外部注入不够大）。

**判定**:
- External factor 存在 **但** 预测方向与实际方向一致
- → `CORRECT`（外部因素未改变结果）
- **计入 denominator** — 因为结果与预测一致

**理由**: 如果外部因素未能改变结果，模型仍然是对的。

### 5.3 极端边界：confidence = 0 或 1

| confidence | 行为 | 说明 |
|-----------|------|------|
| 0 | 归入 Bucket 0 | A6.3 PRED-005 规定 confidence=0 不产出（INSUFFICIENT_DATA），不应出现 |
| 1 | 归入 Bucket 9 | 极端 confidence，需要充分样本验证 |
| 0.5 | 归入 Bucket 5 | 边界值，floor(0.5 * 10) = 5 |

### 5.4 边界：样本恰好等于阈值

| 条件 | 阈值 | 判定 |
|------|------|------|
| observations.length = 3 | MIN_SAMPLES = 3 | 充足（≥） |
| observations.length = 2 | MIN_SAMPLES = 3 | 不足（<） |
| maxGap = 500 | GAP_THRESHOLD = 500 | 充足（≤） |
| maxGap = 501 | GAP_THRESHOLD = 500 | 不足（>） |
| relativeError = 0.2 | CORRECT_THRESHOLD = 0.2 | CORRECT（<） → 实际上 0.2 不 < 0.2 |
| relativeError = 0.21 | CORRECT_THRESHOLD = 0.2 | 非 CORRECT（> 0.2）→ 检查 INCORRECT_THRESHOLD |

**修正**: CORRECT 阈值是 `< 0.2`（严格小于），所以 `relativeError = 0.2` 不算 CORRECT，进入 PARTIAL 或 INCORRECT 判定。INCORRECT 阈值是 `≥ 0.5`。所以 `0.2 ≤ relativeError < 0.5` → PARTIAL。

---

## 六、测试用例设计建议

Implementation 阶段需要为每个场景设计测试用例：

```typescript
describe("A6.4 Counterfactual Scenarios", () => {
  it("C1: prediction correct, event occurs within window", () => { ... });
  it("C2: prediction false positive, event never occurs", () => { ... });
  it("C3: current state conflicts with prediction", () => { ... });
  it("C4: event occurs within horizon", () => { ... });
  it("C5: event occurs outside horizon", () => { ... });
  it("C6: regime change during prediction window", () => { ... });
  it("C7: external interference changes outcome", () => { ... });
  it("C8: insufficient observation samples", () => { ... });
  it("C9: observation gap in window", () => { ... });
  it("C10: overconfident model (high confidence, low success)", () => { ... });
  it("C11: underconfident model (low confidence, high success)", () => { ... });
  it("C12: deterministic replay (100x identical hash)", () => { ... });
});
```

每个测试用例使用合成数据（不需要真实 Game/Memory 环境），验证 Domain 纯函数的输出符合预期。
