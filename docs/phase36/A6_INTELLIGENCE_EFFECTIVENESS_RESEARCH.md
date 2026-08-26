# A6 Intelligence Effectiveness Research

> **阶段**: A6 Longitudinal Effectiveness Research
> **日期**: 2026-08-26
> **约束**: 纯研究，不写实现代码，不修改任何 frozen contract
> **审计范围**: A6.1–A6.6 全链路代码

---

## 一、研究核心问题

**"如何证明 A6 Intelligence 在长期运行中真正提供了有效信息，而不是只产生大量看起来合理的 Shadow 数据？"**

A6 已完成 A6.1–A6.6 全链路实现（Experience → Evaluation → Prediction → Calibration → Reliability → Recommendation）。所有模块均为 Shadow-Only，不进入执行路径。但 Shadow-Only 本身不等于有效——一个永远不被消费的系统可能只是"看起来在工作"。

本研究的目标是：从代码层面验证 A6 的每个子系统是否具备**长期有效性验证能力**，并识别架构级缺陷。

---

## 二、A6.1–A6.6 深度审计结果

### 2.1 A6.1 Experience → Future Outcome

**代码审计路径**:
- `src/domain/intelligence/experience.ts` → `createExperience()`, `attachOutcome()`, `attachAttribution()`, `finalizeExperience()`
- `src/systems/intelligence/experience-collector-system.ts` → 从 `DecisionTrace` Ring Buffer 读取 → 采集 Outcome → 采集 Attribution → 写入 Experience Ring Buffer

**数据流**:
```
DecisionRecord (A5, 事中)
  → N tick 后 (MEASUREMENT_DELAYS: war=500, economic=500, defense=300, spawn=200, expansion=1000, logistics=500)
  → collectOutcome() 消费 evaluateWarOutcome / empireHealth / recoveryStats
  → collectAttribution() 产出 primaryCause / confidence / externalFactors
  → ExperienceRecord (lifecycle: OBSERVED → OPEN → ATTRIBUTED → FINALIZED)
```

**有效性评估**:
- ✅ Outcome 采集消费的是**已有系统的真实产出**（`evaluateWarOutcome`, `empireHealth`, `recoveryStats`），不是 A6 自己的衍生数据
- ✅ Attribution 的 `primaryCause` 由规则函数计算，不是自证循环
- ⚠️ **缺失**: Experience 没有长期跟踪机制——Outcome 采集后 Experience 进入 FINALIZED 状态，但没有后续"Experience → Future Performance"的验证
- ⚠️ **缺失**: Attribution 的 `confidence` 是规则赋值（如 war=0.8, economic=0.7），不是从历史校准得出

### 2.2 A6.2 Evaluation → Future Performance

**代码审计路径**:
- `src/domain/intelligence/strategy-evaluation.ts` → `evaluateStrategy()`
- `src/systems/intelligence/strategy-evaluation-system.ts`

**数据流**:
```
ExperienceRecord[] (A6.1)
  + MetricSnapshot (empireHealth / CPU / economy)
  + BaselineComparison
  → 8 维度 StrategyScore (economicGrowth, resourceEfficiency, cpuEfficiency, riskLevel, survival, expansion, militaryOutcome, recoveryCost)
  → StrategyEvaluation { dimensions, findings, verdict, evidenceIds }
```

**有效性评估**:
- ✅ 8 维度评分独立计算，不合并为万能分数
- ✅ Evaluation 消费 Experience（A6.1）的 Outcome + Attribution，不是消费 Prediction（A6.3）的输出
- ⚠️ **缺失**: Evaluation 没有"未来性能验证"机制——它评估的是过去窗口的策略效果，但没有将评估结果与**未来**性能对比
- ⚠️ **风险**: Evaluation 的 `findings` 中 `hasExternalFactor` 被 A6.4 Calibration 消费为 ExternalFactorSignal——如果 Evaluation 的判断不准确，会影响 Calibration 的 REGIME_CHANGED / EXTERNAL_INTERFERENCE 分类

### 2.3 A6.3 Prediction → Future Outcome

**代码审计路径**:
- `src/domain/intelligence/prediction/energy-shortage.ts` → `predictEnergyShortage()`
- `src/domain/intelligence/prediction/spawn-starvation.ts` → `predictSpawnStarvation()`
- `src/systems/intelligence/prediction-system.ts`

**数据流**:
```
TimeSeries<number> (netFlowHistory, reserveHistory — 来自 globalCache)
  + currentReserve, shortageThreshold (快照值)
  + PredictionContext (posture, watchdogTier, roomCount, maxRcl, threatLevel)
  → linearRegression() → slope, intercept, r2
  → estimateShortageTick() → 外推何时到达 shortage
  → computeSeverity() → 0-1 严重度
  → computeEnergyConfidence() → 样本数 × R² × 外部因子
  → applyRegimeMultiplier() → 调整 confidence
  → Prediction { id, target, window, value, confidence, evidence, status }
```

**有效性评估**:
- ✅ 预测方法为 trend-extrapolation（线性回归），完全确定性
- ✅ 数据不足时返回 `INSUFFICIENT_DATA`（PRED-005），不伪造预测
- ✅ 每条 Prediction 携带 Evidence（sources, modelParams, sampleRange, regimeCompatibility）
- ✅ 预测窗口有明确 horizon（PRED-004），上限 5000 tick
- ⚠️ **关键风险**: `computeDirectionCorrect()` 使用相对误差 < 50% 作为方向正确的代理——这不是真正的方向预测，而是误差代理。这意味着"方向正确"的含义可能被误解
- ⚠️ **缺失**: 没有样本外验证（Out-of-Sample Validation）——线性回归的 R² 是 in-sample 拟合度，不保证泛化能力

### 2.4 A6.4 Calibration → Actual Predictive Accuracy

**代码审计路径**:
- `src/domain/intelligence/calibration/resolve.ts` → `resolvePrediction()`
- `src/domain/intelligence/calibration/calibration.ts` → `computeConfidenceBuckets()`, `computeECE()`, `computeBrierScore()`
- `src/systems/intelligence/calibration-resolution-system.ts`

**数据流**:
```
Prediction (A6.3, 已到期)
  + ObservationSample[] (从 globalCache.__reserveHistory / __spawnQueueDepthHistory 构建)
  + PredictionContext (当前)
  + ExternalFactorSignal[] (从 A6.1 Attribution + A6.2 Evaluation 提取)
  → resolvePrediction()
    → checkObservationSufficiency() → 样本数 < 3 或间隔 > 500 → INSUFFICIENT_OBSERVATION
    → checkRegimeCompatibility() → mismatchedDimensions ≥ 3 或含 posture → REGIME_CHANGED
    → computeActualValue() → 取窗口内最后一个观测值
    → computeRelativeError() → |actual - predicted| / |predicted|
    → determineResolution() → CORRECT / INCORRECT / PARTIAL / FALSE_POSITIVE / FALSE_NEGATIVE
  → ResolutionResult
  → computeCalibrationStatistics() → ConfidenceBucketStats[10] → ECE → BrierScore → ModelCalibrationProfile
```

**有效性评估**:
- ✅ Resolution Engine 有明确的时间隔离：`resolvedTick = prediction.window.endTick + RESOLUTION_GRACE_PERIOD`（100 tick grace period）
- ✅ ECE 计算标准：10 个置信度桶，每桶 ≥ 30 样本才算 sufficient
- ✅ Brier Score 计算标准：(f_i - o_i)² 的均值
- ✅ `isCalibratable()` 排除 REGIME_CHANGED / EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION
- ⚠️ **关键风险**: `buildObservations()` 从 `globalCache.__reserveHistory` 读取数据——这个数组是**全局共享**的，可能包含 Prediction 生成时刻之后的数据。如果 `__reserveHistory` 在 Prediction 生成后被更新，且 Calibration 读取了同一数组，则存在 **temporal leakage**
- ⚠️ **缺失**: 没有 train/test split——Calibration 用全部 Resolution 计算 ECE，ECE 又被用于评估模型可靠性。同一个数据集既用于统计又用于评估，没有 holdout

### 2.5 A6.5 Reliability → Actual Predictive Accuracy

**代码审计路径**:
- `src/domain/intelligence/reliability/compute-state.ts` → `computeIntelligenceState()`
- `src/systems/intelligence/intelligence-state-system.ts`

**数据流**:
```
Prediction[] (A6.3)
  + ResolutionResult[] (A6.4)
  + ModelCalibrationProfile[] (A6.4)
  + ModelFailureStats[] (A6.4)
  + PredictionContext (当前)
  → computeModelReliability() → per-model assessment
  → computeRegimeFit() → regime-specific fit
  → computeCalibrationHealth() → drift/stale detection
  → computeDataSufficiency() → sample count verification
  → computeFreshness() → knowledge age
  → detectConflicts() → prediction conflict detection
  → aggregateUncertainty()
  → IntelligenceState (transient, 不持久化)
```

**有效性评估**:
- ✅ IntelligenceState 是只读投影（REL-001），不写 globalCache
- ✅ 不产出单一 Reliability Score（REL-012）
- ✅ 有 Regime-specific 评估：`getRegimeSampleCount()` 按当前 contextSignature 过滤
- ✅ 有 drift detection：`detectCalibrationDrift()` 对比 recent ECE vs overall ECE
- ⚠️ **关键风险**: Reliability 的评估基础是 Calibration 的 ECE/Brier Score——如果 Calibration 存在 temporal leakage，Reliability 也会继承这个问题
- ⚠️ **缺失**: Reliability 没有"Reliability → Future Accuracy"的验证——HIGH reliability 是否真的比 LOW reliability 更准？

### 2.6 A6.6 Recommendation → Future Event/Outcome

**代码审计路径**:
- `src/domain/intelligence/recommendation/evidence-builder.ts` → `buildExperienceEvidence()`, `buildPredictionEvidence()`, `buildCalibrationEvidence()`, `buildReliabilityEvidence()`
- `src/domain/intelligence/recommendation/generator.ts` → `generateRecommendations()`
- `src/systems/intelligence/recommendation-engine-system.ts`

**数据流**:
```
A6.1 ExperienceRecord[] → buildExperienceEvidence() → OBSERVED stage items
A6.1 Attribution → buildAttributionEvidence() → ATTRIBUTED stage items
A6.2 StrategyEvaluation → buildEvaluationEvidence() → INFERRED stage items
A6.3 Prediction[] → buildPredictionEvidence() → PREDICTED stage items
A6.4 ResolutionResult[] + Profile[] → buildCalibrationEvidence() → CALIBRATED stage items
A6.5 IntelligenceState → buildReliabilityEvidence() → RELIABILITY_ASSESSED stage items
  → assembleEvidenceTrace() → EvidenceTrace { items, complete, minConfidence }
  → generateRecommendations()
    → 前置检查: 证据数 ≥ 2, 证据链完整, minConfidence ≥ 0.1, regimeCompatible
    → evaluateEconomicTrigger() / evaluateSpawnTrigger() / ... (8 triggers)
    → computeRecommendationConfidence() → ≤ min(evidence confidence)
    → buildRecommendation() → RecommendationCandidate { shadowOnly: true, autoApply: false }
```

**有效性评估**:
- ✅ `autoApply: false` 是 literal type（TypeScript 编译器强制）
- ✅ `shadowOnly: true` 是 literal type
- ✅ confidence propagation: `confidence ≤ min(evidence confidence)` 硬约束
- ✅ 有 TTL 生命周期管理（`validity.expiresTick`）
- ⚠️ **关键风险**: Recommendation 的 Evidence 包含 A6.4 Calibration 和 A6.5 Reliability 的输出——这意味着 Recommendation 的 confidence 可能被**自证强化**：
  - Prediction 产出 confidence
  - Calibration 用 Prediction 的 outcome 验证 confidence
  - Calibration 的 ECE 被用作 Recommendation 的 Evidence confidence
  - 如果 Calibration 的 ECE 很低（看起来校准很好），Recommendation 的 confidence 会被拉高
  - 但 ECE 可能是 in-sample 的——没有样本外验证
- ⚠️ **缺失**: Recommendation 没有"未来结果验证"——推荐产生后，没有跟踪推荐是否导致了好的结果

---

## 三、关键发现汇总

### 3.1 发现 #1: Temporal Leakage 风险（中等严重）

**位置**: `calibration-resolution-system.ts` → `buildObservations()`

**问题**: `buildObservations()` 从 `globalCache.__reserveHistory` 读取数据。这个数组是**持续更新的**（由 A5 的 empire-health-system 等 cadence 写入）。当 Calibration System 在 tick T 运行时，`__reserveHistory` 可能包含 tick T 的最新数据——但 Prediction 是在 tick T - horizon 生成的。

**影响**: Calibration 读取的 Observation 可能包含了 Prediction 生成后才产生的数据。虽然时间窗口过滤（`startTick` 到 `endTick`）限制了部分泄漏，但如果 `__reserveHistory` 数组的 baseTick 计算有误，可能导致时间错位。

**缓解**: `RESOLUTION_GRACE_PERIOD = 100` 提供了 100 tick 的缓冲，确保 Prediction 窗口结束后再解析。但如果 `__reserveHistory` 的 baseTick 计算不精确，grace period 不能完全消除风险。

### 3.2 发现 #2: In-Sample Calibration（中等严重）

**位置**: `calibration.ts` → `computeCalibrationStatistics()`

**问题**: Calibration 使用全部 Resolution 计算 ECE/Brier Score。这些 Profile 又被 A6.5 Reliability 消费来评估模型可靠性。同一批数据既用于统计又用于评估——没有 train/test split。

**影响**: ECE 可能低估真实校准误差（in-sample 通常比 out-of-sample 好）。如果 ECE 看起来很好，Reliability 会判定 WELL_CALIBRATED，Recommendation 的 Evidence confidence 会被拉高——但实际泛化能力可能更差。

### 3.3 发现 #3: Confidence 自证强化链（低严重，但需监控）

**位置**: `evidence-builder.ts` → `buildCalibrationEvidence()` + `buildReliabilityEvidence()`

**问题**: 
```
Prediction.confidence → Calibration 验证 → ECE → 
  buildCalibrationEvidence().confidence (ECE ≤ 0.05 → 0.9) →
  Recommendation.confidence (≤ min evidence confidence)
```

如果 ECE 很低，Calibration Evidence 的 confidence 很高（0.9），Recommendation 的 confidence 会被拉高。但 ECE 是 in-sample 的，可能不反映真实校准质量。

**影响**: 短期内不会造成问题（因为 Recommendation 是 Shadow-Only），但如果未来 Recommendation 被消费，confidence 膨胀可能导致错误决策权重。

### 3.4 发现 #4: 缺失 Longitudinal Validation 机制（核心缺口）

**问题**: A6 没有任何机制来回答：
1. Prediction 是否真的准确？（只有 in-sample ECE，没有 out-of-sample）
2. Calibration 是否真的校准了 confidence？（没有 holdout 验证）
3. Reliability HIGH 是否真的比 LOW 更可靠？（没有前瞻性验证）
4. Recommendation 是否有 predictive value？（没有结果跟踪）

### 3.5 发现 #5: Regime Contamination（低严重）

**问题**: Calibration 的 `computeCalibrationStatistics()` 在全局统计时混合了不同 Regime 的 Resolution。虽然 `isCalibratable()` 排除了 REGIME_CHANGED，但非 REGIME_CHANGED 的 Resolution 仍可能来自不同的 Regime 上下文。

**影响**: 全局 ECE 可能掩盖 Regime-specific 的校准问题。例如：RCL 1-3 的预测可能很准，RCL 7-8 的预测可能很差，但全局 ECE 取平均值后看起来"还行"。

---

## 四、Intelligence Effectiveness Metrics 设计

### 4.1 禁止项

**禁止** `IntelligenceScore` / `OverallScore` / `AIQualityScore` — 任何将多维度合并为单一分数的做法。

### 4.2 独立指标

#### Prediction Metrics
| 指标 | 定义 | 最小样本 | 状态判定 |
|------|------|---------|---------|
| Precision | TP / (TP + FP) | ≥ 30 positive cases | VALID / INSUFFICIENT_SAMPLE |
| Recall | TP / (TP + FN) | ≥ 30 negative cases | VALID / INSUFFICIENT_SAMPLE |
| False Positive Rate | FP / (FP + TN) | ≥ 30 negative cases | VALID / INSUFFICIENT_SAMPLE |
| False Negative Rate | FN / (FN + TP) | ≥ 30 positive cases | VALID / INSUFFICIENT_SAMPLE |
| Brier Score | (1/N) × Σ(f_i - o_i)² | ≥ 100 resolved | VALID / INSUFFICIENT_SAMPLE |
| Calibration Error (ECE) | Σ(\|B_i\|/N) × \|acc(B_i) - conf(B_i)\| | ≥ 200 calibratable | VALID / INSUFFICIENT_SAMPLE |

#### Reliability Metrics
| 指标 | 定义 | 最小样本 |
|------|------|---------|
| Reliability Calibration | HIGH reliability 模型的实际 accuracy vs LOW reliability 模型的实际 accuracy | ≥ 30 per bucket |
| Accuracy by Confidence Bucket | 每个置信度桶的 observed success rate | ≥ 30 per bucket |
| Regime-Specific Accuracy | 按 Regime 分组的 accuracy | ≥ 30 per regime |

#### Recommendation Metrics
| 指标 | 定义 | 最小样本 |
|------|------|---------|
| Future Outcome Correlation | Recommendation 产生后 N tick 内相关事件的发生率 | ≥ 50 recommendations |
| Event Hit Rate | 被推荐的事件实际发生的比例 | ≥ 50 recommendations |
| False Recommendation Rate | 推荐了但事件未发生的比例 | ≥ 50 recommendations |
| Stale Recommendation Rate | TTL 过期前未被 supersede 的比例 | ≥ 50 recommendations |

#### Evaluation Metrics
| 指标 | 定义 | 最小样本 |
|------|------|---------|
| Future Performance Correlation | Evaluation score 与未来 N tick 的 empireHealth delta 的相关性 | ≥ 30 evaluations |
| Regime Stability | 同一 Regime 下 Evaluation 结论的一致性 | ≥ 30 per regime |

### 4.3 样本不足处理

当样本不足时，指标必须输出 `INSUFFICIENT_SAMPLE`，**不得**输出漂亮的统计数字。

---

## 五、架构边界确认

### 5.1 禁止项（确认保持）

| 禁止 | 状态 |
|------|------|
| Auto Apply | ✅ `autoApply: false` literal type |
| Strategy Mutation | ✅ 无代码路径修改 `Memory.kernel.strategy` |
| Decision Authority | ✅ 无 A6 模块被执行系统消费 |
| ML / RL / Online Training | ✅ 全部为规则 + 统计纯函数 |
| Runtime Mutation | ✅ 全部 Shadow-Only |

### 5.2 A6 角色确认

| 角色 | 模块 | 状态 |
|------|------|------|
| Observer | A6.1 Experience | ✅ 观测决策结果 |
| Evaluator | A6.2 Evaluation | ✅ 评估策略效果 |
| Predictor | A6.3 Prediction | ✅ 预测未来事件 |
| Calibrator | A6.4 Calibration | ✅ 校准置信度 |
| Reliability Assessor | A6.5 Reliability | ✅ 评估模型可靠性 |
| Recommendation Producer | A6.6 Recommendation | ✅ 生成建议 |

A6 **不是** Executor / Decision Authority / Strategy Controller。✅ 确认。

---

## 六、结论

A6 的架构设计在**结构性隔离**方面是健全的——Shadow-Only、无执行路径、无 Strategy Mutation。但在**长期有效性验证**方面存在核心缺口：

1. **没有 Out-of-Sample 验证机制** — 所有统计都是 in-sample
2. **没有 Temporal Holdout 机制** — 没有严格的时间隔离来防止信息泄漏
3. **没有 Longitudinal Tracking** — 没有跟踪 Recommendation 产生后的实际结果
4. **存在 Confidence 自证强化链** — 虽然目前影响有限（Shadow-Only），但需监控

这些缺口不影响当前帝国的安全运行（A6 完全停止帝国也照常运行），但如果未来要让 A6 的输出被消费，必须先解决这些验证问题。

详细的 Temporal Holdout 设计见 [A6_TEMPORAL_HOLDOUT.md](./A6_TEMPORAL_HOLDOUT.md)。
详细的 Longitudinal Validation 设计见 [A6_LONGITUDINAL_VALIDATION.md](./A6_LONGITUDINAL_VALIDATION.md)。
详细的自证循环审计见 [A6_SELF_VALIDATION_AUDIT.md](./A6_SELF_VALIDATION_AUDIT.md)。
