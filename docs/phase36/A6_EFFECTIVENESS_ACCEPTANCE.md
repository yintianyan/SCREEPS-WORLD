# A6 Effectiveness Acceptance

> **阶段**: A6 Longitudinal Effectiveness Research
> **日期**: 2026-08-26
> **约束**: 纯研究，不写实现代码

---

## 一、验收标准

### 1.1 验收框架

本文件定义 A6 Intelligence 在长期运行中的有效性验收标准。每个标准都有明确的 PASS / FAIL / INSUFFICIENT_DATA 判定。

### 1.2 禁止项确认

| 禁止 | 状态 | 验证方式 |
|------|------|---------|
| Auto Apply | ✅ PASS | `autoApply: false` 是 TypeScript literal type |
| Strategy Mutation | ✅ PASS | 代码审查：无 `Memory.kernel.strategy` 写入路径 |
| Decision Authority | ✅ PASS | 无执行系统读取 A6 缓存 |
| ML / RL / Online Training | ✅ PASS | 全部为规则 + 统计纯函数 |
| Runtime Mutation | ✅ PASS | 全部 Shadow-Only |
| IntelligenceScore / OverallScore | ✅ PASS | 无万能分数，8 维度独立 |

---

## 二、Prediction 有效性验收

### 2.1 验收指标

| 指标 | 定义 | PASS 阈值 | FAIL 阈值 | 最小样本 |
|------|------|----------|----------|---------|
| Out-of-Sample Accuracy | holdout 上的 CORRECT / calibratable | ≥ 0.60 | < 0.40 | 100 resolved |
| In-Sample vs Out-of-Sample Gap | |in-sample ECE - out-of-sample ECE| | < 0.05 | ≥ 0.10 | 200 calibratable |
| Precision | TP / (TP + FP) | ≥ 0.50 | < 0.30 | 30 positive |
| Recall | TP / (TP + FN) | ≥ 0.40 | < 0.20 | 30 negative |
| Brier Score | (1/N) × Σ(f_i - o_i)² | ≤ 0.25 | > 0.40 | 100 resolved |
| Coverage | calibratable / total predictions | ≥ 0.50 | < 0.30 | 200 predictions |

### 2.2 当前状态

| 指标 | 当前状态 | 原因 |
|------|---------|------|
| Out-of-Sample Accuracy | ❌ NOT MEASURED | 没有 holdout 机制 |
| In-Sample vs Out-of-Sample Gap | ❌ NOT MEASURED | 没有 train/test split |
| Precision | ⚠️ PARTIALLY MEASURED | FPR 已计算，但未按 positive/negative 分类 |
| Recall | ⚠️ PARTIALLY MEASURED | FNR 已计算，但未按 positive/negative 分类 |
| Brier Score | ✅ MEASURED | `computeBrierScore()` 已实现 |
| Coverage | ⚠️ PARTIALLY MEASURED | calibratableCount / totalResolutions 可计算，但缺少 insufficientDataCount |

### 2.3 验收结论

**Prediction 有效性**: ❌ **NOT YET VERIFIABLE**

当前只有 in-sample Brier Score 和 ECE，没有 out-of-sample 验证。无法判定模型是否真正有效。

---

## 三、Calibration 有效性验收

### 3.1 验收指标

| 指标 | 定义 | PASS 阈值 | FAIL 阈值 | 最小样本 |
|------|------|----------|----------|---------|
| Calibration Error (ECE) | Σ(\|B_i\|/N) × \|acc(B_i) - conf(B_i)\| | ≤ 0.05 | > 0.15 | 200 calibratable |
| Calibration Error (Out-of-Sample) | holdout 上的 ECE | ≤ 0.10 | > 0.20 | 200 calibratable |
| Per-Bucket Calibration | 每桶 \|avgConfidence - observedSuccessRate\| | ≤ 0.10 | > 0.20 | 30 per bucket |
| Drift Detection | recent ECE / overall ECE | < 1.5 | > 2.0 | 100 recent + 100 overall |

### 3.2 当前状态

| 指标 | 当前状态 | 原因 |
|------|---------|------|
| ECE (In-Sample) | ✅ MEASURED | `computeECE()` 已实现 |
| ECE (Out-of-Sample) | ❌ NOT MEASURED | 没有 holdout 机制 |
| Per-Bucket Calibration | ✅ MEASURED | `computeConfidenceBuckets()` 已实现 |
| Drift Detection | ✅ MEASURED | `detectCalibrationDrift()` 已实现 |

### 3.3 验收结论

**Calibration 有效性**: ⚠️ **PARTIALLY VERIFIABLE**

In-sample ECE 和 per-bucket calibration 已实现，但没有 out-of-sample ECE。无法判定校准是否泛化。

---

## 四、Reliability 有效性验收

### 4.1 验收指标

| 指标 | 定义 | PASS 阈值 | FAIL 阈值 | 最小样本 |
|------|------|----------|----------|---------|
| Reliability Discrimination | HIGH reliability 模型的 accuracy vs LOW reliability 模型的 accuracy | HIGH ≥ LOW + 0.15 | HIGH < LOW | 30 per level |
| Regime-Specific Accuracy | 按 Regime 分组的 accuracy | 一致性 ≥ 0.60 | < 0.40 | 30 per regime |
| Drift Prediction | drift detection 预测的未来 accuracy 下降 | drift 后 accuracy 确实下降 | drift 后 accuracy 未下降 | 50 drift events |

### 4.2 当前状态

| 指标 | 当前状态 | 原因 |
|------|---------|------|
| Reliability Discrimination | ❌ NOT MEASURED | 没有"HIGH vs LOW"的 accuracy 对比 |
| Regime-Specific Accuracy | ⚠️ PARTIALLY MEASURED | `getRegimeSampleCount()` 可按 Regime 过滤，但没有独立输出 accuracy |
| Drift Prediction | ❌ NOT MEASURED | drift detection 已实现，但没有验证 drift 后 accuracy 是否真的下降 |

### 4.3 验收结论

**Reliability 有效性**: ❌ **NOT YET VERIFIABLE**

Reliability 有 assessment（drift detection, sample sufficiency），但没有验证这些 assessment 是否与实际表现一致。

---

## 五、Recommendation 有效性验收

### 5.1 验收指标

| 指标 | 定义 | PASS 阈值 | FAIL 阈值 | 最小样本 |
|------|------|----------|----------|---------|
| Future Outcome Correlation | 推荐产生后 N tick 内相关事件的发生率 vs 未推荐时 | > baseline + 0.10 | < baseline | 50 recommendations |
| Event Hit Rate | 被推荐的事件实际发生的比例 | ≥ 0.40 | < 0.20 | 50 recommendations |
| False Recommendation Rate | 推荐了但事件未发生的比例 | ≤ 0.40 | > 0.60 | 50 recommendations |
| Stale Recommendation Rate | TTL 过期前未被 supersede 的比例 | ≤ 0.50 | > 0.80 | 50 recommendations |

### 5.2 当前状态

| 指标 | 当前状态 | 原因 |
|------|---------|------|
| Future Outcome Correlation | ❌ NOT MEASURED | 没有跟踪推荐产生后的实际结果 |
| Event Hit Rate | ❌ NOT MEASURED | 没有跟踪推荐产生后的实际结果 |
| False Recommendation Rate | ❌ NOT MEASURED | 没有跟踪推荐产生后的实际结果 |
| Stale Recommendation Rate | ⚠️ PARTIALLY MEASURED | TTL 和 lifecycle 管理已实现，但没有统计 stale rate |

### 5.3 验收结论

**Recommendation 有效性**: ❌ **NOT YET VERIFIABLE**

Recommendation 有 lifecycle 管理（TTL, supersede, conflict），但没有结果跟踪——无法判定推荐是否有 predictive value。

---

## 六、Evaluation 有效性验收

### 6.1 验收指标

| 指标 | 定义 | PASS 阈值 | FAIL 阈值 | 最小样本 |
|------|------|----------|----------|---------|
| Future Performance Correlation | Evaluation score 与未来 N tick 的 empireHealth delta 的相关性 | r ≥ 0.30 | r < 0.10 | 30 evaluations |
| Regime Stability | 同一 Regime 下 Evaluation 结论的一致性 | 一致性 ≥ 0.60 | < 0.40 | 30 per regime |
| Dimension Independence | 8 个维度之间的相关性 | r < 0.70 (任意两维) | r ≥ 0.90 | 50 evaluations |

### 6.2 当前状态

| 指标 | 当前状态 | 原因 |
|------|---------|------|
| Future Performance Correlation | ❌ NOT MEASURED | 没有"Evaluation → 未来 empireHealth"的跟踪 |
| Regime Stability | ❌ NOT MEASURED | 没有按 Regime 分组统计 Evaluation 一致性 |
| Dimension Independence | ❌ NOT MEASURED | 没有计算维度间相关性 |

### 6.3 验收结论

**Evaluation 有效性**: ❌ **NOT YET VERIFIABLE**

Evaluation 有 8 维度评分和 baseline comparison，但没有验证评分是否能预测未来表现。

---

## 七、Experience Attribution 有效性验收

### 7.1 验收指标

| 指标 | 定义 | PASS 阈值 | FAIL 阈值 | 最小样本 |
|------|------|----------|----------|---------|
| Attribution Accuracy | primaryCause 与独立判断的一致性 | ≥ 0.60 | < 0.40 | 30 attributions |
| Attribution Confidence Calibration | confidence 高的 Attribution 是否更准确 | HIGH ≥ LOW + 0.10 | HIGH < LOW | 30 per level |

### 7.2 当前状态

| 指标 | 当前状态 | 原因 |
|------|---------|------|
| Attribution Accuracy | ❌ NOT MEASURED | 没有独立判断来验证 Attribution 的 primaryCause |
| Attribution Confidence Calibration | ❌ NOT MEASURED | 没有 confidence → accuracy 的校准 |

### 7.3 验收结论

**Experience Attribution 有效性**: ❌ **NOT YET VERIFIABLE**

Attribution 的 confidence 是规则赋值（如 war=0.8），不是从历史校准得出。无法判定 Attribution 是否准确。

---

## 八、总体验收矩阵

| 模块 | Shadow-Only | 执行隔离 | in-sample 验证 | out-of-sample 验证 | 总体 |
|------|------------|---------|---------------|-------------------|------|
| A6.1 Experience | ✅ | ✅ | ⚠️ | ❌ | PARTIALLY VERIFIABLE |
| A6.2 Evaluation | ✅ | ✅ | ⚠️ | ❌ | PARTIALLY VERIFIABLE |
| A6.3 Prediction | ✅ | ✅ | ⚠️ | ❌ | NOT YET VERIFIABLE |
| A6.4 Calibration | ✅ | ✅ | ✅ | ❌ | PARTIALLY VERIFIABLE |
| A6.5 Reliability | ✅ | ✅ | ⚠️ | ❌ | NOT YET VERIFIABLE |
| A6.6 Recommendation | ✅ | ✅ | ❌ | ❌ | NOT YET VERIFIABLE |

### 验收总结

- **Shadow-Only 和执行隔离**: ✅ 全部通过
- **In-sample 验证**: ⚠️ 部分实现（Calibration 有 ECE/Brier Score，其他模块缺失）
- **Out-of-sample 验证**: ❌ 全部缺失
- **长期有效性**: ❌ 无法判定

---

## 九、最小数据量要求

### 9.1 每个指标的最小样本量

| 指标类型 | 最小样本 | 判定（不达标时） |
|---------|---------|----------------|
| Per-model ECE | ≥ 200 calibratable | INSUFFICIENT_SAMPLE |
| Per-bucket calibration | ≥ 30 per bucket | INSUFFICIENT_SAMPLE |
| Per-regime accuracy | ≥ 30 per regime | INSUFFICIENT_SAMPLE |
| Brier Score | ≥ 100 resolved | INSUFFICIENT_SAMPLE |
| Recommendation hit rate | ≥ 50 recommendations | INSUFFICIENT_SAMPLE |
| Drift detection | ≥ 100 recent + 100 overall | INSUFFICIENT_SAMPLE |

### 9.2 样本不足时的输出规则

当样本不足时，**必须**输出 `INSUFFICIENT_SAMPLE`，**禁止**输出任何统计数字。

**当前代码状态**: 
- `MIN_SAMPLES_PER_BUCKET = 30` ✅ 已实现
- `MIN_SAMPLES_FOR_PROFILE = 100` ✅ 已实现
- `MIN_SAMPLES_FOR_VERDICT = 200` ✅ 已实现
- 但 `CalibrationVerdict = "INSUFFICIENT_DATA"` 只在总样本 < 200 时触发——per-bucket 和 per-regime 的 insufficient 没有独立标记

### 9.3 累积时间估算

假设每 500 tick 产出 1 条 Prediction，每 5000 tick 产出 1 个 Profile：

| 样本量 | 需要的 tick | 约等于 |
|--------|-----------|--------|
| 100 calibratable | 50,000 tick | ~28 小时 |
| 200 calibratable | 100,000 tick | ~56 小时 |
| 30 per bucket | 200,000+ tick | ~111 小时（需要 10 个桶都有 30 个） |
| 30 per regime | 500,000+ tick | ~277 小时（需要多个 regime 都有 30 个） |

**结论**: 需要至少 **2-3 周的连续运行**才能积累足够样本进行基本验证。Regime-specific 验证可能需要 **1-3 个月**。
