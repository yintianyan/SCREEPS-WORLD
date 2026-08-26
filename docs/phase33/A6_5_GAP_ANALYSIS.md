# A6.5 Gap Analysis — Intelligence Prediction Calibration → Adaptive Intelligence

> **研究阶段**: A6.5 Research / Gap Analysis  
> **审计日期**: 2026-08-26  
> **禁止实现**: 本文档仅做研究、审计和架构设计，不修改任何代码  
> **基线**: A6.1-A6.4 已冻结契约 + 真实代码审计

---

## 一、当前能力基线

### 1.1 A6.1 Experience, Outcome, Attribution

| 能力 | 状态 | 证据 |
|------|------|------|
| Experience Ring Buffer | ✅ 已实现 | `experience.ts` — 固定容量, FIFO 淘汰, GC |
| Outcome 采集 | ✅ 已实现 | `outcome.ts` — 消费 evaluateWarOutcome / empireHealth / recoveryStats / logisticsHealth / spawnQueueStats / expansionManager / threatAssessment |
| Evidence-based Attribution | ✅ 已实现 | `attribution.ts` — Direct / Correlation / Expert / Unknown 四种归因方法，每种携带 Evidence 列表 |
| 确定性 Hash | ✅ 已实现 | `attributionHash()` — stableStringify + FNV-1a 32-bit |
| 7 种 Experience 类型 | ✅ 已实现 | war / expansion / economic / defense / logistics / spawn / recovery |
| Measurement Delay | ✅ 已实现 | `MEASUREMENT_DELAYS` — 每种类型有独立延迟 |
| Determinism Verification | ✅ 已实现 | `verifyAttributionDeterminism()` — 1000× replay |

### 1.2 A6.2 Strategy Evaluation + Baseline + Evidence

| 能力 | 状态 | 证据 |
|------|------|------|
| 8 维度独立评估 | ✅ 已实现 | `CANONICAL_EVALUATION_DIMENSIONS` — economicGrowth / resourceEfficiency / cpuEfficiency / riskLevel / survival / expansion / militaryOutcome / recoveryCost |
| 禁止万能分数 | ✅ 强制 | `StrategyScore.confidence` = 各维度最低值，非总分；`informationalScore` 明确标注 "无决策权" |
| Baseline 三层来源 | ✅ 已实现 | CONFIG / HISTORICAL / COMMUNITY(unavailable) |
| Context Signature | ✅ 已实现 | `buildContextSignature()` — rclRange + roomRange + threat |
| Regime Mismatch Detection | ✅ 已实现 | `detectRegimeMismatch()` — 5 维度比较 |
| Sample Sufficiency | ✅ 已实现 | `evaluateSampleSufficiency()` — 不足时返回 INCONCLUSIVE |
| Evaluation Verdict | ✅ 已实现 | IMPROVING / STABLE / DEGRADING / INCONCLUSIVE / CONFLICTING_TREND |
| Evidence Chain | ✅ 已实现 | `traceEvidence()` — Finding → DimensionScore → Experience → Outcome → Attribution → Metric |
| Shadow Recommendation | ✅ 已实现 | `RecommendationCandidate` — shadowOnly=true, autoApply=false |

### 1.3 A6.3 Prediction

| 能力 | 状态 | 证据 |
|------|------|------|
| TimeSeries<T> 有界容器 | ✅ 已实现 | `time-series.ts` — FIFO 淘汰, linearRegression, meanValue, trendDirection, GC |
| PredictionContext + Regime | ✅ 已实现 | `context.ts` — posture / watchdogTier / roomCount / maxRcl / threatLevel → ContextSignature |
| Prediction 核心类型 | ✅ 已实现 | `types.ts` — Prediction / PredictionResult / INSUFFICIENT_DATA / NO_PREDICTION 哨兵 |
| Prediction Ring Buffer | ✅ 已实现 | `ring-buffer.ts` — 固定容量, active/fulfilled/expired/invalidated lifecycle |
| Architecture Guards | ✅ 已实现 | `guards.ts` — PRED-001~PRED-008 守卫 |
| Energy Shortage Model | ✅ 已实现 | `energy-shortage.ts` — trend-extrapolation |
| Spawn Starvation Model | ✅ 已实现 | `spawn-starvation.ts` — threshold-projection |
| CPU Pressure Model | ❌ 未实现 | 类型定义存在（PredictionTarget 包含 "cpu-pressure"），无实现 |
| Logistics Bottleneck Model | ❌ 未实现 | 同上 |
| Room Collapse Model | ❌ 未实现 | 同上 |
| Remote Mining Failure Model | ❌ 未实现 | 同上 |
| Expansion Readiness Model | ❌ 未实现 | 同上 |
| Prediction Evidence Builder | ✅ 已实现 | `evidence-builder.ts` — 可追溯证据链 |
| Prediction Resolution | ✅ 已实现 | `resolve.ts` — A6.3 lifecycle resolution (fulfilled/expired/invalidated) |

### 1.4 A6.4 Calibration

| 能力 | 状态 | 证据 |
|------|------|------|
| Resolution Engine | ✅ 已实现 | `resolve.ts` — 8 种 CalibrationResolution 分类 |
| Confidence Buckets | ✅ 已实现 | `calibration.ts` — 10 个桶, avgConfidence vs observedSuccessRate |
| ECE | ✅ 已实现 | `computeECE()` — Expected Calibration Error |
| Brier Score | ✅ 已实现 | `computeBrierScore()` |
| FPR / FNR | ✅ 已实现 | `computeFalsePositiveRate()` / `computeFalseNegativeRate()` |
| Calibration Verdict | ✅ 已实现 | WELL_CALIBRATED / OVERCONFIDENT / UNDERCONFIDENT / INSUFFICIENT_DATA |
| ModelCalibrationProfile | ✅ 已实现 | `types.ts` — modelKey / buckets / verdict / ece / brierScore / fpr / fnr |
| Resolution Metric Registry | ✅ 已实现 | `metrics.ts` — 按模型注册 metric 函数, 不建立万能 metric |
| Calibration Ring Buffer | ✅ 已实现 | `ring-buffer.ts` — 固定容量 500, GC |
| CAL-001~CAL-010 Guards | ✅ 已实现 | `guards.ts` — Shadow-Only / Domain Purity / Determinism / Bounded Memory / No Strategy Mutation / Evidence Traceability |
| Determinism Verification | ✅ 已实现 | `verifyResolutionDeterminism()` |
| External Interference Detection | ✅ 已实现 | ExternalFactorSignal — 从 A6.1 attribution + A6.2 evaluation 提取 |
| Regime Change Detection | ✅ 已实现 | REGIME_CHANGED — mismatchedDimensions >= 3 或 posture 变化 |

---

## 二、缺失能力 — Gap 清单

### Gap-1: CalibrationProfile 不区分 Regime

**现状**: `ModelCalibrationProfile` 按 `modelKey`（target-method-modelVersion）索引，不区分 Regime。

**影响**: EnergyShortage 模型在 RCL1-peace 和 RCL8-war 下使用同一个 CalibrationProfile，但这两个 Regime 下模型的可靠性可能天差地别。

**严重度**: HIGH — 直接影响 "confidence=0.8 是否真的意味着约 80% 的可靠性" 这个核心问题。

**证据**: `calibration.ts::computeCalibrationProfile()` — 过滤 resolutions 时只匹配 modelKey，不检查 contextSignature。

### Gap-2: 无 Temporal Reliability 追踪

**现状**: CalibrationProfile 是全历史聚合统计，没有 recent vs historical 对比。

**影响**: 过去 100000 tick EnergyShortage accuracy=90% 但最近 10000 tick accuracy=55%，系统无法发现 Calibration Drift。

**严重度**: HIGH — 模型可能已退化但系统仍认为其可靠。

**证据**: `calibration.ts::computeConfidenceBuckets()` — 遍历全部 resolutions，无时间窗口过滤。

### Gap-3: 无 Cross-Model Conflict Detection

**现状**: 多个 Prediction 可以同时产出高 confidence 矛盾预测，系统不检测冲突。

**影响**: EnergyShortage=HIGH + ExpansionReadiness=HIGH 同时出现时，系统不标记冲突。

**严重度**: MEDIUM — 当前只有 2 个模型实现，冲突概率低；但随着模型增加会变得严重。

**证据**: `prediction-system.ts` 中没有跨模型冲突检测逻辑。

### Gap-4: 无 Intelligence State 聚合

**现状**: 系统有 Prediction、Calibration、Evaluation 分散在各自 Ring Buffer 中，没有聚合视图。

**影响**: 无法回答 "系统整体 Intelligence 健康度如何？" "模型覆盖率是多少？" "数据充足性如何？"

**严重度**: MEDIUM — 不影响运行时安全，但影响可解释性和 A6.6 的 Recommendation 层。

### Gap-5: 无 Model Degradation Detection

**现状**: 没有 "模型最近是否正在退化" 的检测机制。

**影响**: 一个曾经可靠的模型可能已经不再适用于当前环境，但系统没有信号。

**严重度**: MEDIUM — 与 Gap-2 相关但独立：Gap-2 是 calibration drift，Gap-5 是 model degradation（准确率本身在下降）。

### Gap-6: 无 Data Sufficiency 聚合视图

**现状**: `evaluateSampleSufficiency()` 存在于 baseline.ts 中，但只在单维度使用。没有跨模型、跨维度的数据充足性聚合。

**影响**: 无法回答 "系统的 Intelligence 整体数据是否充足？"

**严重度**: LOW — 数据可以在使用点检查。

### Gap-7: 无 Evidence Aging 机制

**现状**: CalibrationProfile 不跟踪 evidence 的新鲜度。Resolution 结果一旦写入 Ring Buffer，没有老化机制（直到被 GC 覆盖）。

**影响**: 非常旧的 Resolution 结果与新的结果同等权重参与统计。

**严重度**: MEDIUM — 可能导致 calibration 统计被过时数据拖偏。

### Gap-8: 无 Knowledge Persistence

**现状**: 所有 Intelligence 数据（Experience / Evaluation / Prediction / Calibration）都存储在 heap（globalCache），global reset 后全部丢失。

**影响**: 每次 global reset 后，Calibration 从零开始，需要数万 tick 才能重建足够的样本。

**严重度**: LOW — Screeps global reset 不频繁，且设计原则允许 heap 数据丢失。

### Gap-9: 无 Adaptive Model Weighting

**现状**: 系统不对不同模型的预测结果加权。所有预测平等对待。

**影响**: 一个已知不可靠的模型与一个高度可靠的模型产出相同 confidence 的预测，系统不区分。

**严重度**: MEDIUM — 当前不影响运行（Shadow-Only），但 A6.6 Recommendation 需要这个能力。

### Gap-10: 无 Forecast Consistency Check

**现状**: 同一个模型在不同时间点对同一窗口的预测可能不一致，系统不检测。

**影响**: 预测波动大但不被感知。

**严重度**: LOW — 当前模型低频产出，波动风险小。

---

## 三、数据源审计

### 3.1 可消费的已有数据源

| 数据源 | 文件 | 类型 | Producer | Consumer | 更新 cadence | 生命周期 | bounded | deterministic | persistent | 可能 stale | 可能失效 | duplicate authority |
|--------|------|------|----------|----------|-------------|---------|---------|--------------|-----------|-----------|---------|-------------------|
| ExperienceRingBuffer | `experience.ts` | ExperienceRecord[] | experience-collector-system | strategy-evaluation-system, calibration-resolution-system | per decision | heap, GC maxAge | ✅ 固定容量 | ✅ hash 验证 | ❌ heap only | ✅ 超 maxAge | ✅ DecisionRecord GC 后 EXPIRED | ❌ 唯一 |
| EvaluationRingBuffer | `strategy-evaluation.ts` (via __evaluationCache) | StrategyEvaluation[] | strategy-evaluation-system | calibration-resolution-system (external factors) | per evaluation | heap | ✅ 固定容量 | ✅ hash 验证 | ❌ heap only | ✅ | ✅ | ❌ 唯一 |
| PredictionRingBuffer | `prediction/ring-buffer.ts` (via __predictionCache) | Prediction[] | prediction-system | calibration-resolution-system | per prediction | heap, GC | ✅ 固定容量 | ✅ hash 验证 | ❌ heap only | ✅ | ✅ expired 后被 GC | ❌ 唯一 |
| CalibrationRingBuffer | `calibration/ring-buffer.ts` (via __calibrationCache) | ResolutionResult[] + profiles | calibration-resolution-system | (无消费者 — shadow only) | 每 500t | heap, GC maxAge 100000 | ✅ 固定容量 500 | ✅ hash 验证 | ❌ heap only | ✅ | ✅ | ❌ 唯一 |
| empireHealth | `global-cache.ts` | EmpireHealthResult | empire-health-system (每 100t) | calibration (buildCurrentContext), prediction-system | 100t | heap | ✅ 8 维度 | ✅ 纯函数 | ❌ heap only | ✅ 100t 后 | ✌️ | ❌ 唯一 |
| autonomyStatus | `global-cache.ts` | AutonomyStatus | empire-health-system (每 100t) | (当前无 A6 消费者) | 100t | heap | ✅ | ✅ | ❌ heap only | ✅ | ✌️ | ❌ 唯一 |
| recoveryStats | `global-cache.ts` | RecoveryStats | recovery-execution-system | experience-collector (outcome 采集) | interval | heap | ✅ | ✅ | ❌ heap only | ✅ | ✌️ | ❌ 唯一 |
| PlayerIntelRecord | `player-intel.ts` | PlayerIntelRecord | defense-planner | (当前无 A6 消费者) | per observation | heap, GC maxRecords 20 | ✅ 20 条/玩家 | ✌️ | ❌ heap only | ✅ FRESHNESS_THRESHOLDS | ✅ EXPIRED | ❌ 唯一 |
| __reserveHistory | `global-cache.ts` | number[] | empire-health-system | calibration (observations) | 100t | heap | ✅ 固定长度 | ✌️ | ❌ heap only | ✅ | ✌️ | ❌ 唯一 |
| __spawnQueueDepthHistory | `global-cache.ts` | TimeSeries<number> | empire-health-system | calibration (observations) | 100t | heap | ✅ TimeSeries 容量 | ✌️ | ❌ heap only | ✅ | ✌️ | ❌ 唯一 |
| ContextSignature (Prediction) | `prediction/context.ts` | string | prediction-system | calibration (regime check) | per prediction | heap | ✅ 纯函数 | ✅ 确定性 | ❌ heap only | ✌️ | ✌️ | ❌ 唯一 |
| ContextSignature (Baseline) | `baseline.ts` | string | strategy-evaluation-system | baseline comparison | per evaluation | heap | ✅ 纯函数 | ✅ 确定性 | ❌ heap only | ✌️ | ✌️ | ⚠️ 与 Prediction ContextSignature 不同！ |

### 3.2 重复 Authority 检查

**发现**: 存在两套 ContextSignature：

1. **Baseline ContextSignature** (`baseline.ts::buildContextSignature()`): `rclRange-roomRange-threat`
2. **Prediction ContextSignature** (`prediction/context.ts::buildPredictionContextSignature()`): `posture-watchdogTier-roomRange-rclRange-threat`

两者编码维度不同！Baseline 不包含 posture 和 watchdogTier，Prediction 包含。

**风险**: A6.5 如果要做 Regime-specific reliability，需要明确用哪套签名，或统一。

**建议**: A6.5 应使用 Prediction ContextSignature（更丰富），但需要通过映射函数兼容 Baseline ContextSignature。

---

## 四、架构 Gap

### Gap-A: CalibrationProfile 不支持 Regime 分区

**现状**: `ModelCalibrationProfile` 按 `modelKey` 索引，一个模型只有一个 Profile。

**需要**: 按 `modelKey + contextSignature` 索引，一个模型在不同 Regime 下有不同 Profile。

**但**: 分区后样本更少 → 可能导致每个 Regime 下都 INSUFFICIENT_DATA。

**约束**: 必须有 Profile Fallback 机制 — 样本不足时回退到全局 Profile。

### Gap-B: 无 Rolling Calibration 窗口

**现状**: CalibrationProfile 遍历全部 ResolutionResult（最多 500 条），无时间窗口。

**需要**: 支持最近 N 条 / 最近 N tick 的滚动窗口统计。

**约束**: 不能增加 Ring Buffer 容量（CPU/Memory）；必须在现有 500 条内做窗口切片。

### Gap-C: 无 Cross-Model 一致性检查

**现状**: 每个模型独立产出 Prediction，无跨模型冲突检测。

**需要**: 一个轻量的 Conflict Detection 纯函数，检查多个 active prediction 之间的逻辑一致性。

**约束**: 必须是 Shadow-Only — 只标记冲突，不裁决谁对谁错。

### Gap-D: 无 Intelligence State 聚合

**现状**: 没有 "系统整体认知状态" 的聚合视图。

**需要**: 一个多维的 IntelligenceState（非万能分数），暴露给 A6.6 或可观测性。

**约束**: 必须是只读聚合，不新建数据源。

---

## 五、Dependency Gap

| 依赖项 | 当前状态 | A6.5 需要什么 | 影响 |
|--------|---------|-------------|------|
| PredictionContext | ✅ 存在 | 可直接消费 | 无 |
| CalibrationRingBuffer | ✅ 存在 | 可直接消费 | 无 |
| ModelCalibrationProfile | ✅ 存在 | 可能需要扩展（加 contextSignature） | 低风险 — 扩展非重建 |
| ContextSignature (Prediction) | ✅ 存在 | 可直接消费 | 无 |
| ContextSignature (Baseline) | ✅ 存在 | 需要映射兼容 | 低风险 |
| EmpireHealth | ✅ 存在 | 可直接消费（current regime） | 无 |
| PlayerIntelRecord | ✅ 存在 | 可读（player-specific reliability 候选） | 低风险 |
| AutonomyStatus | ✅ 存在 | 可读（degradation 信号） | 低风险 |
| RecoveryStats | ✅ 存在 | 可读 | 无 |
| experience Ring Buffer | ✅ 存在 | 可读 | 无 |
| evaluation Ring Buffer | ✅ 存在 | 可读 | 无 |

**结论**: A6.5 不需要新建任何数据源。所有输入都可以从已有系统消费。

---

## 六、Risk

### Top 5 Risks

1. **Regime 分区导致样本碎片化** — 按 Regime 分区后，每个 Regime 下样本可能 < MIN_SAMPLES_FOR_PROFILE(100)，导致大部分 Regime 返回 INSUFFICIENT_DATA。必须设计 Fallback 策略。

2. **架构膨胀** — A6.5 最容易长出一个 "IntelligenceManager"，开始做评分、策略判断、风险判断，最后重新造出第二套 Strategy。必须严格 Shadow-Only。

3. **Confidence = Reliability 混淆** — CalibrationProfile 的 `observedSuccessRate` 不等于 `reliability`。一个模型在 confidence=0.8 的桶里 observedSuccessRate=0.75，不意味着 "reliability=0.75"。必须区分 calibrated confidence 和 reliability。

4. **Calibration Drift 检测的假阳性** — Rolling window 太短会导致频繁的 drift 信号，太长又检测不到。需要仔细选择窗口大小。

5. **A6.4 已知问题传染** — `failureStats` Map 无硬上限、`modelKey.split("-")` 解析问题、`buildExternalFactors` 遍历 Ring Buffer。如果 A6.5 在这些之上构建，可能继承问题。

---

## 七、A6.4 已知遗留问题评估

| 问题 | 严重度 | A6.5 前必须修复？ | 理由 |
|------|--------|------------------|------|
| `failureStats` Map 无硬上限 | LOW | C. 后续优化 | modelKey 种类有限（当前 2 种），不会无界增长。A6.5 不直接消费 failureStats。 |
| `modelKey.split("-")` 解析问题 | LOW | C. 后续优化 | 影响 target/method 展示值，不影响 hash 计算（hash 基于 modelKey 字符串）。A6.5 不依赖解析后的值。 |
| `buildExternalFactors` 遍历 Ring Buffer | MEDIUM | C. 后续优化 | 在 ring buffer 容量 200 时每次解析遍历可能产生不必要 CPU。A6.5 如果做 conflict detection 也会遍历 Ring Buffer，需要设计时考虑缓存。 |

**结论**: 三个问题都不阻塞 A6.5 的研究和契约设计。在实现阶段如果需要可以一并修复。

---

## 八、Recommendation

### A6.5 应该是什么？

**A6.5 = Reliability Assessment & Intelligence State**

不是增加 Prediction Model。不是万能 Score。

A6.5 回答：
1. "模型的预测在过去有多可靠？"（Calibration 已回答）
2. "模型的预测在不同 Regime 下是否同样可靠？"（A6.5 需要回答）
3. "模型的预测最近是否在退化？"（A6.5 需要回答）
4. "多个模型同时产出矛盾预测时，系统是否意识到了？"（A6.5 需要回答）
5. "系统整体 Intelligence 数据是否充足、是否新鲜、是否一致？"（A6.5 需要回答）

### 核心原则

1. **Shadow-Only** — A6.5 只 OBSERVE / EVALUATE / ASSESS，不 DECIDE / EXECUTE
2. **不新建数据源** — 只消费 A6.1-A6.4 既有数据
3. **不建万能 Score** — 多维 Intelligence State，非单一分数
4. **不修改 A6.1-A6.4** — 只读消费
5. **Bounded Memory** — 复用 Ring Buffer，不新建无限增长结构
6. **Deterministic** — stableStringify + FNV-1a，100× replay 验证
7. **P3 Post Phase** — 低频执行，不进入 tick 关键路径
