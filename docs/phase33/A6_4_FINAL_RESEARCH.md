# A6.4 — Final Research Report

> **阶段**: A6.4 Research — Final Report
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 回答全部 24 个最终问题，汇总所有研究结论

---

## 文档索引

| # | 文档 | 内容 |
|---|------|------|
| 1 | `A6_4_CALIBRATION_GAP_ANALYSIS.md` | A6.1/A6.2/A6.3 代码审计 + GAP 识别 |
| 2 | `A6_4_RESOLUTION_DESIGN.md` | Resolution canonical 定义 + Horizon 模型 |
| 3 | `A6_4_CONFIDENCE_CALIBRATION.md` | Confidence Bucket + Calibration Statistics |
| 4 | `A6_4_FAILURE_ATTRIBUTION.md` | Failure Attribution 分类 + A6.1 复用 |
| 5 | `A6_4_ARCHITECTURE.md` | 整体架构 + CPU/Memory/Determinism + Guards |
| 6 | `A6_4_COUNTERFACTUAL_AUDIT.md` | C1-C12 反事实场景设计 |
| 7 | `A6_4_CONTRACT.md` | 类型定义 + 函数签名 + Guard 定义 |
| 8 | `A6_4_ACCEPTANCE.md` | 完成标准 + Implementation 前置条件 |
| 9 | `A6_4_FINAL_RESEARCH.md` | 本文档 — 最终报告 |

---

## 24 个最终问题回答

### Q1: A6.3 Prediction 是否已经提供足够数据支持 Calibration？

**回答**: **基本足够，但有 10 个 GAP。**

A6.3 的 `Prediction` 类型已包含 Calibration 所需的核心字段：`id`, `generatedAt`, `target`, `window`, `value`, `confidence`, `method`, `evidence`, `modelVersion`, `status`, `contextSignature`, `context`。

缺失的字段（CAL-GAP-1/2/3）——`resolvedTick`, `resolutionOutcome`, `actualValue`——由 A6.4 在自己的 `ResolutionResult` 中维护，**不需要修改 A6.3 冻结契约**。

A6.3 `resolve.ts` 的 Resolution 逻辑过于简单（CAL-GAP-4/9/10），A6.4 构建独立的、更完整的 Resolution Engine 解决此问题。

详见: `A6_4_CALIBRATION_GAP_ANALYSIS.md` §四。

---

### Q2: Prediction Resolution 的 canonical 定义是什么？

**回答**: 

**Prediction Resolution** = 将一条已到期的 Prediction 与其在真实世界中发生的（或未发生的）结果进行对比，产出一条确定性的 Resolution 结果。

Resolution 不是重新预测。Resolution 不修改 Prediction。Resolution 不修改 Runtime。

A6.4 定义 8 种 Resolution 分类：`CORRECT`, `INCORRECT`, `PARTIAL`, `FALSE_POSITIVE`, `FALSE_NEGATIVE`, `REGIME_CHANGED`, `EXTERNAL_INTERFERENCE`, `INSUFFICIENT_OBSERVATION`。

与 A6.3 `resolve.ts` 的 3 类（fulfilled/expired/invalidated）不同——A6.4 的 Resolution 是更细粒度的校准分类。

详见: `A6_4_RESOLUTION_DESIGN.md` §一~二。

---

### Q3: Horizon 与 Resolution Window 如何定义？

**回答**:

- **Prediction Horizon** = `prediction.window`（从 startTick 到 endTick）
- **Resolution Window** = `[endTick, endTick + resolutionGracePeriod]`

它们不同，因为 Resolution 不能只在 endTick 时做单点检查——事件可能在 Horizon 内任何时间发生、发生后恢复、或在边界附近发生。

Resolution 策略：在 `[startTick, endTick]` 范围内采集 Observation Samples，在 `endTick + resolutionGracePeriod`（100 tick）时执行 Resolution。

详见: `A6_4_RESOLUTION_DESIGN.md` §三。

---

### Q4: 什么情况下 Prediction 算 CORRECT？

**回答**:

当满足以下**全部**条件时，Prediction 为 CORRECT：

1. Observation samples 充足（≥ 3，且 maxGap ≤ 500）
2. Regime 未发生严重变化（mismatchedDimensions < 3 且不含 posture）
3. 无外部干扰（hasExternalInterference = false）
4. `relativeError < 0.2`（预测值与实际值偏差 < 20%）
5. `directionCorrect = true`（预测方向与实际方向一致）

对于阈值型预测还需满足：`thresholdTriggered = true`（预测的阈值被触发）。

---

### Q5: 什么情况下算 INCORRECT？

**回答**:

当满足以下条件时：

1. Observation samples 充足
2. Regime 未变化
3. 无外部干扰
4. `relativeError ≥ 0.5` **或** `directionCorrect = false`
5. 不符合 CORRECT 或 PARTIAL 的条件

INCORRECT 的 Prediction 会进入 Failure Attribution 做进一步归因。

---

### Q6: 什么情况下算 REGIME_CHANGED？

**回答**:

当 Prediction 发布时的 Context 与 Resolution 时的 Context 发生重大变化时：

- `mismatchedDimensions.length ≥ 3` → REGIME_CHANGED
- `mismatchedDimensions` 包含 "posture" → REGIME_CHANGED（posture 变化是严重 Regime Change）

Regime Change 检测复用 A6.3 的 `checkRegimeCompatibility()` 函数。

REGIME_CHANGED **不计入** Calibration denominator——因为模型在 context=A 下做出的预测在 context=B 下验证不反映模型质量。

详见: `A6_4_RESOLUTION_DESIGN.md` §六。

---

### Q7: 什么情况下算 EXTERNAL_INTERFERENCE？

**回答**:

当满足以下条件时：

1. 外部因素存在（A6.1 `attribution.externalFactors` 非空 **或** A6.2 `finding.hasExternalFactor = true` **或** `globalCache.externalEnergyInflow > 0`）
2. **且** 预测方向与实际方向不一致（外部因素改变了结果）
3. Regime 未变化

如果外部因素存在但预测方向与实际方向一致（外部因素未改变结果），则正常分类为 CORRECT 或 INCORRECT。

EXTERNAL_INTERFERENCE **不计入** Calibration denominator——因为模型正确识别了内部趋势，只是外部因素改变了结果。

详见: `A6_4_RESOLUTION_DESIGN.md` §七。

---

### Q8: 如何处理 Partial Resolution？

**回答**:

当 `0.2 ≤ relativeError < 0.5` 且 `directionCorrect = true` 时，Resolution 为 PARTIAL。

PARTIAL 表示预测方向正确但幅度偏差大。

Calibration 处理：PARTIAL 计半分（`observedSuccessRate = (CORRECT + 0.5×PARTIAL) / denominator`）。

Partial Resolution 的 Failure Attribution 与 INCORRECT 相同的判定流程，但可能产出 `HORIZON_MISMATCH`（趋势正确但时间不够）。

详见: `A6_4_RESOLUTION_DESIGN.md` §三.3, `A6_4_FAILURE_ATTRIBUTION.md` §七。

---

### Q9: 如何判断 confidence 是否 calibration？

**回答**:

通过 **Confidence Bucket + ECE** 判断：

1. 将 Prediction 按 confidence 分入 10 个桶（[0,0.1), [0.1,0.2), ..., [0.9,1.0]）
2. 每桶计算 `observedSuccessRate` 和 `avgConfidence`
3. 计算 `calibrationError = |avgConfidence - observedSuccessRate|`
4. 计算 ECE = 加权平均校准误差
5. 判定：
   - ECE < 0.05 → WELL_CALIBRATED
   - avgConfidence > observedSuccessRate + 0.1 → OVERCONFIDENT
   - avgConfidence < observedSuccessRate - 0.1 → UNDERCONFIDENT
   - 样本不足 → INSUFFICIENT_DATA

**禁止**简单将 confidence 等同于 success rate。

详见: `A6_4_CONFIDENCE_CALIBRATION.md` §二~四。

---

### Q10: 样本不足怎么办？

**回答**:

**绝对不下结论。**

- 单个 Bucket 样本 < 30 → 该桶标记 `insufficient`
- 模型总 calibratable Resolution < 100 → 不产出 Profile
- 总 calibratable Resolution < 200 → CalibrationVerdict = INSUFFICIENT_DATA

样本不足时不产出 WELL_CALIBRATED / OVERCONFIDENT / UNDERCONFIDENT 判定。避免基于不充分数据做错误结论。

详见: `A6_4_CONFIDENCE_CALIBRATION.md` §五。

---

### Q11: 如何避免过度惩罚低置信度 Prediction？

**回答**:

Calibration 不使用"惩罚"概念。Calibration 度量的是**校准质量**（claimed confidence ≈ observed success rate），不是**绝对准确率**。

- 低 confidence（0.2）+ 低 success rate（0.2）= WELL_CALIBRATED
- 高 confidence（0.8）+ 低 success rate（0.4）= OVERCONFIDENT

低 confidence 的模型如果确实只有 20% 成功率，它就是 well-calibrated 的——不需要"惩罚"。

详见: `A6_4_CONFIDENCE_CALIBRATION.md` §六。

---

### Q12: 如何区分 model error 和 data problem？

**回答**:

通过 Failure Attribution 的判定流程：

1. **INSUFFICIENT_DATA**: `prediction.evidence.sampleRange.count < 3` → 数据问题
2. **LOW_R2**: `prediction.evidence.modelParams.r2 < 0.1` → 数据质量问题（趋势不显著）
3. **OBSERVATION_GAP**: Observation 中存在 > 500t 断档 → 观测问题
4. **HORIZON_MISMATCH**: `withinHorizon = false` 且 `actualValue` 接近 `predictedValue` → 窗口选择问题
5. **OUTCOME_AMBIGUOUS**: `relativeError` 在阈值边界（0.19~0.21）→ 结果模糊
6. **MODEL_ERROR**: 以上都不适用 → 模型本身的错误

详见: `A6_4_FAILURE_ATTRIBUTION.md` §二~四。

---

### Q13: 如何利用 A6.1 Attribution？

**回答**:

A6.4 只读复用 A6.1 的以下字段：

| A6.1 字段 | A6.4 用途 |
|----------|----------|
| `attribution.externalFactors` | 判断 EXTERNAL_INTERFERENCE |
| `attribution.primaryCause` | 交叉验证 Failure Attribution（辅助信号） |
| `attribution.confidence` | 归因可信度 |
| `attribution.evidence` | 可追溯链 |

A6.1 的 `AttributionFactor` 与 A6.4 的 `FailureAttributionCategory` 职责不同——前者归因 Experience（决策结果），后者归因 Prediction（预测结果）。不建立第二套 Attribution，只做映射辅助。

**A6.4 无需修改 A6.1 冻结契约。**

详见: `A6_4_CALIBRATION_GAP_ANALYSIS.md` §二, `A6_4_FAILURE_ATTRIBUTION.md` §三。

---

### Q14: 如何利用 A6.2 Evaluation？

**回答**:

A6.4 只读消费 A6.2 的以下字段：

| A6.2 字段 | A6.4 用途 |
|----------|----------|
| `findings[].hasExternalFactor` | 交叉验证 EXTERNAL_INTERFERENCE |
| `findings[].externalFactorDescription` | 外部因素详情 |
| `score.dimensions[dim].observed` | 交叉验证实际值 |
| `score.dimensions[dim].delta` | 偏差信号 |

A6.2 Evaluation **不直接作为** Prediction Outcome——它只是交叉验证信号。

**无循环依赖**：A6.4 只读消费，产出 Shadow-Only Statistics，不反馈给 A6.2。

详见: `A6_4_CALIBRATION_GAP_ANALYSIS.md` §三。

---

### Q15: 如何保证不产生第二套 Metrics？

**回答**:

A6.4 Calibration Statistics 的所有数值都来自 `ResolutionResult`（A6.4 自有），而 ResolutionResult 的所有输入都来自 A6.1/A6.2/A6.3。

A6.4 **不采集任何新的 Metrics**。A6.4 只做统计聚合：
- 统计 CORRECT/INCORRECT/PARTIAL 计数
- 计算 observedSuccessRate
- 计算 ECE / Brier Score
- 计算 falsePositiveRate / falseNegativeRate

这些统计量的**数据源**全部来自既有系统。CAL-008 Guard 验证不采集新 Metrics。

详见: `A6_4_ARCHITECTURE.md` §一.2, `A6_4_CONFIDENCE_CALIBRATION.md` §九。

---

### Q16: 如何保证 Shadow-Only？

**回答**:

通过多层保证：

1. **Domain 层**: 纯函数，不引用 Game/Memory/Runtime
2. **System 层**: 只写 `globalCache.__calibrationCache`，不修改其他 cache
3. **Guard CAL-001**: 验证只写 __calibrationCache
4. **Guard CAL-003**: 验证不调用 Game API
5. **Guard CAL-009**: 验证不修改 Strategy/Posture/Spawn
6. **依赖方向**: A6.4 只 import A6.1/A6.2/A6.3 的 types 和纯函数
7. **bootstrap.ts**: A6.4 注册为 P3 post 系统，不进入关键路径

**A6.4 完全停止时，帝国照常安全运行。**

详见: `A6_4_ARCHITECTURE.md` §一.2, §七。

---

### Q17: Memory 上限是多少？

**回答**:

**globalCache heap 总计 ≤ 200 KB**。

| 数据 | 容量 | 总计 |
|------|------|------|
| ResolutionResult Ring Buffer | 500 条 × ~200 B | ~100 KB |
| ModelCalibrationProfile | 10 模型 × ~2 KB | ~20 KB |
| ModelFailureStats | 10 模型 × ~500 B | ~5 KB |
| **总计** | | **~125 KB** |

不进 Memory（heap only）。可选的 RawMemory segment 快照（每 5000t 一次）只在 global reset 频繁时引入。

详见: `A6_4_ARCHITECTURE.md` §五。

---

### Q18: CPU 预算是多少？

**回答**:

**均摊 ~0.0006 CPU/tick**。

| 操作 | 预计 CPU | 频率 | 均摊 |
|------|---------|------|------|
| 读取 Prediction Ring Buffer | ~0.01 | 500t | 0.00002 |
| 采集 Observation | ~0.02 | 500t | 0.00004 |
| resolvePrediction() × 5 | ~0.25 | 500t | 0.0005 |
| computeCalibrationStatistics() | ~0.1 | 5000t | 0.00002 |
| GC | ~0.01 | 5000t | 0.000002 |
| **总计** | | | **~0.0006** |

寄生 strategy-evaluation-system 的 500t cadence（P3 post），不新建 tick 循环。

详见: `A6_4_ARCHITECTURE.md` §三.2~三.3。

---

### Q19: 如何保证 deterministic replay？

**回答**:

通过以下机制：

1. **Hash 复用**: A6.4 复用 A6.3 的 `stableStringify` + `fnv1a32Hex`
2. **禁止非确定性来源**: Math.random / Date.now / wall clock / 无序迭代 / 浮点误差
3. **浮点截断**: 所有数值 `toFixed(3)` 后参与 Hash
4. **确定性验证函数**: `verifyResolutionDeterminism` 100× replay
5. **100 次足够**: 所有函数都是纯函数，100 次结果一致即可排除非确定性

详见: `A6_4_ARCHITECTURE.md` §六。

---

### Q20: A6.4 是否应该立即实现，还是存在前置 GAP？

**回答**: **可以立即进入 Implementation，但需要同时解决一个 BLOCKER。**

| GAP | 阻塞？ | 解决方案 |
|-----|--------|---------|
| CAL-GAP-8: A6.3 未接入系统层 | ⚠️ **阻塞 Implementation** | Implementation 阶段先补建 prediction-system |
| CAL-GAP-1~7, 9, 10 | ❌ 不阻塞 | A6.4 在自己的 Domain 内解决 |

**Implementation 顺序**:
1. 补建 prediction-system（CAL-GAP-8）
2. 实现 A6.4 Domain 层
3. 实现 A6.4 System 层
4. 测试 + 质量门槛

详见: `A6_4_ACCEPTANCE.md` §二。

---

### Q21: 当前只有 2 个 Prediction Model，实现 Calibration 是否足够？

**回答**: **足够开始，但需要时间积累样本。**

当前已实现的 2 个模型：
- `energy-shortage`（linear regression）
- `spawn-starvation`（linear regression）

这 2 个模型足以验证 A6.4 Calibration 的完整流程：Resolution → Calibration → Attribution。

**但**：
- 每个模型每 500t 产出约 1 条 Prediction
- 达到 MIN_SAMPLES_FOR_VERDICT = 200 需要约 100000 tick（约 40 天）
- 在此之前 CalibrationVerdict = INSUFFICIENT_DATA

这是正常的——Calibration 需要长期数据积累。

详见: `A6_4_ACCEPTANCE.md` §一.1。

---

### Q22: 未来新增 Prediction Model 如何自动接入 Calibration？

**回答**:

A6.4 的设计支持自动接入：

1. **自动分组**: 新模型产出的 Prediction 存入 A6.3 Ring Buffer，A6.4 按 `target:method:vN` 自动分组
2. **Metric 注册**: 新模型在 `resolutionMetricRegistry` 中注册自己的 Resolution Metric 函数
3. **通用兜底**: 未注册的模型使用通用 metric（`relativeError < 0.2 → CORRECT`）

唯一需要手动操作的是在 `resolutionMetricRegistry` 中注册专用 Resolution Metric 函数。

详见: `A6_4_ARCHITECTURE.md` §九。

---

### Q23: A6.4 是否会修改 A6.3 冻结契约？

**回答**: **不会。**

| 操作 | 是否修改 A6.3 | 说明 |
|------|-------------|------|
| import A6.3 types | ❌ 只读 | 类型导入不影响契约 |
| import A6.3 纯函数 | ❌ 只读 | 函数调用不影响契约 |
| import A6.3 hashing | ❌ 只读 | 复用工具函数 |
| 构建 Resolution Engine | ❌ 独立 | A6.4 在自己的 Domain 内 |
| 构建 Calibration Statistics | ❌ 独立 | A6.4 新建 |

**A6.4 是纯新增层，不修改任何已冻结的 A6.1/A6.2/A6.3 代码。**

---

### Q24: A6.4 完成后下一阶段应该是什么？

**回答**: **A6.5 Recommendation Engine。**

A6.4 产出：
- `ModelCalibrationProfile`（模型校准质量）
- `ModelFailureStats`（模型失败原因分布）

这些产出是 A6.5 Recommendation Engine 的输入之一。A6.5 可以：
- 消费 Calibration 统计
- 产出改进建议（如 "energy-shortage 模型 OVERCONFIDENT，建议降低 confidence"）
- 但仍保持 Shadow-Only（建议不自动应用）

**A6.5 的前置条件**:
1. A6.4 Implementation 完成
2. A6.4 已运行 5000+ tick
3. 有非 INSUFFICIENT_DATA 的 CalibrationVerdict

**注意**: A6.5 仍然不能自动修改 Strategy/Model 参数——除非后续阶段明确授权。

---

## GAP 汇总

| GAP ID | 描述 | 严重度 | 阻塞 Implementation？ | 解决方案 |
|--------|------|--------|----------------------|---------|
| CAL-GAP-1 | Prediction 无 resolvedTick | HIGH | ❌ | A6.4 在 ResolutionResult 中记录 |
| CAL-GAP-2 | Prediction 无 resolutionOutcome | HIGH | ❌ | A6.4 定义 CalibrationResolution 类型 |
| CAL-GAP-3 | Prediction 无 actualValue | MEDIUM | ❌ | A6.4 在 ResolutionResult 中保存 |
| CAL-GAP-4 | resolve.ts 逻辑过于简单 | HIGH | ❌ | A6.4 构建独立 Resolution Engine |
| CAL-GAP-5 | 无 Calibration Statistics 容器 | MEDIUM | ❌ | A6.4 新建 CalibrationRingBuffer |
| CAL-GAP-6 | 无 Confidence Bucket 机制 | MEDIUM | ❌ | A6.4 新建 10 桶 |
| CAL-GAP-7 | 无 Failure Attribution 类型 | LOW | ❌ | A6.4 新建 FailureAttributionCategory |
| CAL-GAP-8 | A6.3 未接入系统层 | HIGH | ⚠️ **阻塞** | Implementation 先补建 prediction-system |
| CAL-GAP-9 | resolve.ts 不检查 Observation Window | HIGH | ❌ | A6.4 新建完整 Horizon Resolution |
| CAL-GAP-10 | resolve.ts 不区分 Regime Change | HIGH | ❌ | A6.4 新建 Regime-aware Resolution |

**BLOCKER 数量**: 1（CAL-GAP-8）

**结论**: **可以进入 A6.4 Implementation**。CAL-GAP-8 在 Implementation 阶段第一步解决（补建 prediction-system），不影响 A6.4 Contract Design。

---

## 关键设计决策汇总

| # | 决策 | 理由 |
|---|------|------|
| 1 | A6.4 不修改 A6.3 冻结契约 | 纯新增层 |
| 2 | Resolution 8 种分类 | 覆盖 Screeps 实际场景 |
| 3 | Prediction Horizon ≠ Resolution Window | 单点检查会丢失窗口趋势 |
| 4 | 10 个 Confidence Bucket | 标准 reliability diagram 粒度 |
| 5 | ECE 作为主校准度量 | 标准校准度量、直觉清晰 |
| 6 | Brier Score 为可选 | 仅适用二元预测 |
| 7 | REGIME_CHANGED 不计入 denominator | 模型不控制 Regime |
| 8 | EXTERNAL_INTERFERENCE 不计入 denominator | 模型不控制外部因素 |
| 9 | 不同模型独立统计 | 禁止万能 score |
| 10 | 样本不足不下结论 | 避免错误判定 |
| 11 | 复用 A6.3 hashing | 不新建 hash 实现 |
| 12 | 寄生 500t cadence | 不新建 tick 循环 |
| 13 | 10 个 CAL-XXX Guards | 多层防退化 |
| 14 | PARTIAL 计半分 | 保守折中 |
| 15 | Resolution Metric Registry | 支持未来模型自动接入 |

---

## 研究完成声明

本报告所有结论均来自对以下源码和文档的真实审计：

**审计源码**:
- `src/domain/intelligence/experience.ts`
- `src/domain/intelligence/outcome.ts`
- `src/domain/intelligence/attribution.ts`
- `src/domain/intelligence/strategy-evaluation.ts`
- `src/domain/intelligence/baseline.ts`
- `src/domain/intelligence/evaluation-evidence.ts`
- `src/domain/intelligence/prediction/types.ts`
- `src/domain/intelligence/prediction/context.ts`
- `src/domain/intelligence/prediction/ring-buffer.ts`
- `src/domain/intelligence/prediction/resolve.ts`
- `src/domain/intelligence/prediction/hashing.ts`
- `src/domain/intelligence/prediction/guards.ts`
- `src/domain/intelligence/prediction/evidence-builder.ts`
- `src/domain/intelligence/prediction/time-series.ts`
- `src/domain/intelligence/prediction/energy-shortage.ts`
- `src/domain/intelligence/prediction/spawn-starvation.ts`
- `src/systems/intelligence/strategy-evaluation-system.ts`
- `src/systems/intelligence/experience-collector-system.ts`
- `src/bootstrap.ts`

**审计文档**:
- `docs/phase30/A6_3_PREDICTION_CONTRACT.md`
- `docs/phase30/A6_3_PREDICTION_ARCHITECTURE.md`
- `docs/phase30/A6_3_PREDICTION_GAP_ANALYSIS.md`
- `docs/phase32/A6_3_2_FINAL_AUDIT.md`

**A6.4 Research 完成。未实现任何代码。所有产出为研究文档。**
