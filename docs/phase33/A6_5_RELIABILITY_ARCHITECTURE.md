# A6.5 Reliability Architecture — 可靠性评估架构研究

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做架构研究，不修改任何代码

---

## 一、Model Reliability — 模型可靠性

### 1.1 当前 CalibrationProfile 表达了什么？

当前 `ModelCalibrationProfile`（`calibration/types.ts`）表达了：

| 字段 | 含义 |
|------|------|
| `modelKey` | 模型标识（target-method-version） |
| `totalResolutions` | 总解析数 |
| `calibratableCount` | 可校准数 |
| `regimeChangedCount` | Regime 变化数 |
| `externalInterferenceCount` | 外部干扰数 |
| `insufficientObservationCount` | 观测不足数 |
| `buckets[]` | 10 个置信度桶的统计 |
| `calibrationVerdict` | WELL_CALIBRATED / OVERCONFIDENT / UNDERCONFIDENT / INSUFFICIENT_DATA |
| `ece` | 预期校准误差 |
| `brierScore` | Brier 分数 |
| `falsePositiveRate` | 假阳性率 |
| `falseNegativeRate` | 假阴性率 |

### 1.2 CalibrationProfile 能回答什么？

| 问题 | 能否回答 | 证据 |
|------|---------|------|
| "confidence=0.8 的预测实际成功率是多少？" | ✅ | `buckets[8].observedSuccessRate` |
| "模型整体是否过度自信？" | ✅ | `calibrationVerdict === "OVERCONFIDENT"` |
| "模型的 ECE 是多少？" | ✅ | `ece` 字段 |
| "模型在 RCL1 下和在 RCL8 下是否同样可靠？" | ❌ | **不区分 Regime** — 所有 Regime 的数据混在一起 |
| "模型在和平时期和战争时期是否同样可靠？" | ❌ | **不区分 Regime** |
| "模型最近是否正在退化？" | ❌ | **无时间窗口** — 全历史统计 |
| "过去可靠的模型现在是否已经不可靠？" | ❌ | **无 temporal 对比** |
| "这个模型在这个 Regime 下有多少样本？" | ❌ | **无 Regime 分区** |

### 1.3 Gap 明确

**CalibrationProfile 不能回答 "这个模型什么时候可信"。**

它能回答 "这个模型在所有历史中准不准"，但不能回答 "在当前条件下是否可信"。

这是 A6.5 要解决的核心问题。

---

## 二、Regime-Specific Reliability — Regime 条件化可靠性

### 2.1 为什么需要 Regime 分区？

**反例**: EnergyShortage 模型在 RCL1-peace-threatLow 下可能非常准确（因为低 RCL 时能量储备本就低，短缺容易预测）。但在 RCL8-war-threatHigh 下可能极不准确（因为战争时能量消耗模式完全不同，历史趋势失效）。

如果两个 Regime 的数据混在一起，CalibrationProfile 的 `observedSuccessRate` 是两个截然不同情况的平均值——既不能代表 RCL1 的可靠性，也不能代表 RCL8 的可靠性。

### 2.2 Regime 分区方案

**推荐方案: 二级索引 Profile**

```
ModelCalibrationProfile (全局)
  └─ RegimeCalibrationProfile (按 contextSignature 分区)
       ├─ RCL1-peace-single-early-low → 少样本 → fallback 到全局
       ├─ RCL8-war-large-late-high → 有样本 → 独立统计
       └─ ... (其他 Regime)
```

**实现思路**:
1. 在 `CalibrationRingBuffer` 中增加 `regimeProfiles: Map<string, Map<string, ModelCalibrationProfile>>`（外层 modelKey，内层 contextSignature）
2. `computeCalibrationProfile()` 增加可选 `contextSignature` 参数
3. 过滤 resolutions 时同时匹配 modelKey 和 `resolutionContextSignature`

**约束**:
- Regime Profile 数量上限（防止碎片化）：每模型最多 5 个 Regime Profile
- 超过上限时，保留样本数最多的 5 个 Regime
- 全局 Profile 始终保留（作为 Fallback）

### 2.3 Profile Fallback 策略

```
1. 尝试获取 modelKey + currentContextSignature 的 Regime Profile
2. 如果存在且 calibratableCount >= MIN_SAMPLES_FOR_PROFILE(100) → 使用 Regime Profile
3. 如果存在但样本不足 → 使用 Regime Profile 但 confidence 降权
4. 如果不存在 → 回退到全局 Profile
5. 如果全局 Profile 也不足 → INSUFFICIENT_DATA
```

### 2.4 样本不足时禁止伪精确

**原则**: 数据不足时不伪造精度。

- 样本 < 30 → 不产出 bucket 级统计
- 样本 < 100 → 不产出 verdict
- 样本 < 200 → verdict = INSUFFICIENT_DATA

**对比当前实现**: 当前 `MIN_SAMPLES_FOR_PROFILE = 100`，`MIN_SAMPLES_FOR_VERDICT = 200`。Regime 分区后，每个 Regime 的样本更少，需要更谨慎的 fallback。

---

## 三、Temporal Reliability — 时效性可靠性

### 3.1 Calibration Drift 问题

**场景**:
- 过去 100000 tick: EnergyShortage accuracy = 90%
- 最近 10000 tick: accuracy = 55%

当前系统无法发现这个 drift，因为 CalibrationProfile 遍历全部历史数据。

### 3.2 方案对比

| 方案 | 描述 | 优点 | 缺点 | 推荐？ |
|------|------|------|------|--------|
| **A. Rolling Window** | 只统计最近 N 条 Resolution | 简单，直接反映最近表现 | 丢失长期基线，N 太短易抖动 | ✅ 推荐 |
| **B. Recent vs Historical 对比** | 同时计算最近窗口和全历史，对比差异 | 保留长期基线，能检测 drift | 计算量翻倍 | ✅ 推荐（与 A 组合） |
| **C. 指数衰减加权** | 按 tick 年龄衰减旧数据权重 | 平滑过渡 | 实现复杂，参数敏感 | ❌ 不推荐 |
| **D. 变点检测** | 统计方法检测 accuracy 突变 | 精确 | 过度复杂，样本少时不可靠 | ❌ 不推荐 |

**推荐方案: A + B 组合**

- **Rolling Window**: 最近 100 条 Resolution 的统计 → `recentProfile`
- **Historical Baseline**: 全部 Resolution 的统计 → `overallProfile`（已有）
- **Drift Detection**: 对比 recentProfile.ece vs overallProfile.ece
  - 如果 recentEce > overallEce * 1.5 → 标记 `DRIFT_DETECTED`
  - 如果 recentEce < overallEce * 0.5 → 标记 `IMPROVING`

**约束**:
- Rolling Window 必须复用现有 Ring Buffer，不新建存储
- 最近 100 条通过 `getRecentResolutions()` 获取（已实现）
- 最少 30 条才开始计算 recent profile

### 3.3 Profile Aging

**原则**: Profile 不是永久有效的。

- Profile 的 `statisticsTick` 记录了最后统计时间
- 如果 `currentTick - statisticsTick > CALIBRATION_PROFILE_INTERVAL * 3`（15000 tick）→ 标记为 `STALE`
- Stale Profile 的 reliability 降权

---

## 四、Calibration Reliability — 校准本身的可靠性

### 4.1 问题

CalibrationProfile 本身也有可靠性问题：
- 样本数太少 → calibration 统计不可靠
- Regime 变化频繁 → 大量 resolution 被标记为 REGIME_CHANGED → calibratableCount 偏低
- 外部干扰频繁 → 大量 resolution 被标记为 EXTERNAL_INTERFERENCE → 有效样本更少

### 4.2 评估指标

**CalibrationHealth**:

| 维度 | 计算 | 含义 |
|------|------|------|
| `sampleCoverage` | calibratableCount / totalResolutions | 有多少比例的 resolution 可用于校准 |
| `regimeStability` | 1 - (regimeChangedCount / totalResolutions) | Regime 变化的频率 |
| `externalInterferenceRate` | externalInterferenceCount / totalResolutions | 外部干扰的频率 |
| `observationQuality` | 1 - (insufficientObservationCount / totalResolutions) | 观测数据的质量 |
| `statisticalPower` | calibratableCount >= MIN_SAMPLES_FOR_VERDICT ? 1 : calibratableCount / MIN_SAMPLES_FOR_VERDICT | 是否有足够统计功效 |

**约束**: 这些指标全部从 `ModelCalibrationProfile` 的已有字段计算，不新建数据源。

---

## 五、Data Sufficiency — 数据充足性

### 5.1 当前状态

`evaluateSampleSufficiency()` 在 `baseline.ts` 中存在，但只在 Baseline 构建时使用。

### 5.2 A6.5 需要的聚合视图

**DataSufficiencySummary**:

| 维度 | 来源 | 含义 |
|------|------|------|
| `totalActivePredictions` | `allActivePredictions().length` | 当前有多少活跃预测 |
| `totalResolutions` | `CalibrationRingBuffer.resolutionCount` | 总解析数 |
| `modelCoverage` | `getRegisteredModelKeys().length` vs planned models | 已实现模型数 vs 规划模型数 |
| `minSamplesAcrossModels` | min of all profiles' calibratableCount | 最少样本的模型有多少 |
| `modelsWithSufficientData` | count where calibratableCount >= MIN_SAMPLES_FOR_PROFILE | 有多少模型样本充足 |

---

## 六、Uncertainty Aggregation — 不确定性聚合

### 6.1 不确定性来源

| 来源 | 类型 | 检测方式 |
|------|------|---------|
| 样本不足 | epistemic | `dataSufficiency.minSamplesAcrossModels < MIN` |
| 模型冲突 | systematic | `predictionConflicts.length > 0` |
| Regime 变化 | distributional | `regimeFit.currentRegimeMatched === false` |
| 时间退化 | temporal | `calibrationHealth.driftDetected === true` |
| 外部干扰 | environmental | `calibrationHealth.externalInterferenceRate > 0.3` |

### 6.2 表达方式

**禁止**: 一个 [0,1] 的 uncertainty score。

**允许**: `UncertaintySummary`:
```typescript
interface UncertaintySummary {
  sources: UncertaintySource[];
  dominantSource: string | null;  // 最主要的不确定性来源
  description: string;           // 人类可读描述
  confidenceInAssessment: number; // 对不确定性评估本身的置信度
}
```

---

## 七、复杂度估算

### 7.1 CPU

| 操作 | 频率 | 复杂度 | 每 tick 平均 |
|------|------|--------|------------|
| Regime Profile 计算 | 每 5000t | O(n × r) — n=500 resolutions, r≤5 regimes | 0.25 × 2500 = ~625 ops/t |
| Rolling Window 计算 | 每 5000t | O(100) — 最近 100 条 | ~0.02 ops/t |
| Drift Detection | 每 5000t | O(1) — 对比两个 ECE | ~0.0002 ops/t |
| Conflict Detection | 每 500t | O(p²) — p=active predictions ≤10 | ~0.2 ops/t |
| IntelligenceState 构建 | 每 500t | O(m) — m=模型数 ≤10 | ~0.02 ops/t |

**总估计**: < 1 ops/t — 可接受。

### 7.2 Memory

| 存储项 | 大小 | 有界？ |
|--------|------|--------|
| Regime Profiles | 10 模型 × 5 Regime × ~200 bytes = ~10KB | ✅ |
| Rolling Window | 不增加存储（复用 Ring Buffer） | ✅ |
| IntelligenceState | ~1KB（只读投影，不持久化） | ✅ |
| Conflict Records | 不持久化（每次运行时重新计算） | ✅ |

**总估计**: < 15KB — 可接受。

---

## 八、推荐方案总结

| 方向 | 推荐方案 | 不推荐方案 | 原因 |
|------|---------|-----------|------|
| Regime 分区 | 二级索引 + Fallback | 全局 Profile + 权重 | 权重法掩盖了 Regime 差异 |
| Temporal 追踪 | Rolling Window + Historical 对比 | 指数衰减 | 参数敏感，难调 |
| Drift Detection | ECE 对比阈值 | 变点检测 | 样本少时不可靠 |
| Conflict Detection | 逻辑一致性检查（Shadow） | 仲裁/选择 | A6.5 不裁决 |
| IntelligenceState | 只读投影聚合 | 持久化新状态 | 避免第二套数据 |
| Uncertainty | 多维分类标签 | 单一 0-1 值 | 禁止万能分数 |
