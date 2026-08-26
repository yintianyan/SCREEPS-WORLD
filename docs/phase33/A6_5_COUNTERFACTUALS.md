# A6.5 Counterfactuals — 反事实场景审计

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做反事实场景设计，不修改任何代码  
> **基线**: A6.4 C1-C12 反事实场景 + A6.5 新增能力

---

## 一、审计目标

本文档设计 A6.5 特有的反事实场景（CF-1 ~ CF-15），验证以下能力在每种场景下能产出正确的 IntelligenceState：

1. **Regime-Specific Reliability** — 按 Regime 分区的模型可靠性评估
2. **Temporal Drift Detection** — 模型退化的时间检测
3. **Conflict Detection** — 跨模型预测冲突检测
4. **Data Sufficiency Aggregation** — 数据充足性聚合
5. **IntelligenceState Construction** — 只读投影聚合
6. **Profile Fallback** — 样本不足时的回退策略

**与 A6.4 C1-C12 的关系**: A6.4 的场景验证 Resolution/Calibration/Attribution 的正确分类。A6.5 的场景验证在 A6.4 结果之上的 Reliability/Conflict/IntelligenceState 聚合的正确性。

---

## 二、场景定义

### CF-1: Regime Profile 存在且样本充足

**场景描述**: EnergyShortage 模型在当前 Regime (peace-healthy-2-3-low) 下有 150 条 Resolution，其中 120 条 calibratable。

**输入**:
- A6.4 CalibrationRingBuffer 中有 150 条 ResolutionResult，`resolutionContextSignature = "peace-healthy-2-3-low"`
- `calibratableCount = 120 >= MIN_SAMPLES_FOR_PROFILE(100)`
- `ModelCalibrationProfile` 全局版本存在

**预期 A6.5 行为**:
- `regimeFit.currentRegimeMatched = true`
- `modelReliability[0].regimeProfile` 存在
- `modelReliability[0].reliabilityVerdict` 基于 Regime Profile（非全局 Profile）
- `modelReliability[0].sampleSufficiency = "SUFFICIENT"`
- `dataSufficiency.modelsWithSufficientData` 计数 +1

**防退化检查**: ✅ 使用 Regime Profile 而非全局 Profile
✅ 不伪造 reliability score（产出多维 Assessment）

---

### CF-2: Regime Profile 不存在 — 回退到全局

**场景描述**: 当前 Regime (war-recovery-1-1-high) 下没有 Regime Profile，但全局 Profile 存在且有 300 条 Resolution。

**输入**:
- CalibrationRingBuffer 中有 ResolutionResult，但没有 `resolutionContextSignature = "war-recovery-1-1-high"` 的
- 全局 `ModelCalibrationProfile` 存在，`totalResolutions = 300`

**预期 A6.5 行为**:
- `regimeFit.currentRegimeMatched = false`
- `modelReliability[0].regimeProfile = null`（不存在）
- `modelReliability[0].fallbackProfile = "GLOBAL"`（标记使用全局 Profile）
- `modelReliability[0].reliabilityVerdict` 基于全局 Profile
- `modelReliability[0].sampleSufficiency = "FALLBACK_GLOBAL"`
- `uncertainty.sources` 包含 `{ type: "distributional", description: "Regime profile not available, using global fallback" }`

**防退化检查**: ✅ 样本不足时不伪造 Regime Profile
✅ 明确标注使用了 fallback

---

### CF-3: Regime Profile 存在但样本不足

**场景描述**: 当前 Regime 下有 Regime Profile，但只有 50 条 calibratable Resolution（< MIN_SAMPLES_FOR_PROFILE=100）。

**输入**:
- CalibrationRingBuffer 中有 60 条 ResolutionResult，其中 50 条 calibratable
- Regime Profile 存在但 `calibratableCount = 50 < 100`

**预期 A6.5 行为**:
- `modelReliability[0].regimeProfile` 存在
- `modelReliability[0].sampleSufficiency = "INSUFFICIENT_FOR_REGIME"`
- `modelReliability[0].reliabilityVerdict` 基于 Regime Profile 但标注 `confidence降权`
- `uncertainty.sources` 包含 `{ type: "epistemic", description: "Regime profile has insufficient samples (50 < 100)" }`

**防退化检查**: ✅ 样本不足时不伪造精确
✅ 不直接回退到全局（Regime Profile 有数据但不足）

---

### CF-4: Calibration Drift 检测

**场景描述**: EnergyShortage 模型的全历史 ECE = 0.05（WELL_CALIBRATED），但最近 100 条 Resolution 的 ECE = 0.12（显著恶化）。

**输入**:
- `overallProfile.ece = 0.05`
- `recentProfile.ece = 0.12`（最近 100 条）
- `0.12 > 0.05 * 1.5 = 0.075` → drift threshold 触发

**预期 A6.5 行为**:
- `calibrationHealth.driftDetected = true`
- `calibrationHealth.driftDirection = "DEGRADING"`
- `calibrationHealth.recentEce = 0.12`
- `calibrationHealth.overallEce = 0.05`
- `uncertainty.sources` 包含 `{ type: "temporal", description: "Calibration drift detected: ECE degraded from 0.05 to 0.12" }`
- `knowledgeFreshness` 标注 Profile 的 `statisticsTick` 距离当前 tick

**防退化检查**: ✅ 检测到 drift 不等于自动降低 confidence
✅ Drift 是信号，不是裁决

---

### CF-5: Calibration Improving 检测

**场景描述**: 模型全历史 ECE = 0.15，但最近 100 条 ECE = 0.04（显著改善）。

**输入**:
- `overallProfile.ece = 0.15`
- `recentProfile.ece = 0.04`
- `0.04 < 0.15 * 0.5 = 0.075` → improving threshold 触发

**预期 A6.5 行为**:
- `calibrationHealth.driftDetected = true`
- `calibrationHealth.driftDirection = "IMPROVING"`
- `uncertainty.sources` 不包含 temporal uncertainty（improving 不是恶化）

**防退化检查**: ✅ Improving 不增加 uncertainty
✅ 但仍标注 driftDetected = true（状态在变化）

---

### CF-6: Rolling Window 样本不足

**场景描述**: 全局有 500 条 Resolution，但最近 100 条中只有 20 条 calibratable（< 30）。

**输入**:
- `getRecentResolutions(100)` 返回 100 条
- 其中只有 20 条 `isCalibratable()`
- `20 < 30`（Rolling Window 最小样本数）

**预期 A6.5 行为**:
- `calibrationHealth.driftDetected = false`（样本不足，不检测 drift）
- `calibrationHealth.driftDirection = "UNKNOWN"`
- `uncertainty.sources` 包含 `{ type: "epistemic", description: "Rolling window has insufficient calibratable samples (20 < 30)" }`

**防退化检查**: ✅ 样本不足时不强行计算 drift
✅ 不基于不足数据产生 drift 信号

---

### CF-7: 逻辑冲突 — Energy Shortage + Expansion Readiness

**场景描述**: 系统同时有 2 条活跃预测：
- EnergyShortage: confidence=0.8, value=5000（储备将降至 5000）
- ExpansionReadiness: confidence=0.7, value=0.8（扩张就绪度 0.8）

**输入**:
- `allActivePredictions()` 返回 2 条 Prediction
- 两条都在 active 状态

**预期 A6.5 行为**:
- `detectConflicts()` 返回 1 条 `PredictionConflict`
- `conflict.type = "logical"`
- `conflict.severity = 0.8 * 0.8 * 0.7 = 0.448`
- `conflict.description = "Energy shortage predicted but expansion readiness also high"`
- `predictionConflicts` 包含此冲突
- `uncertainty.sources` 包含 `{ type: "systematic", description: "Logical conflict between energy-shortage and expansion-readiness" }`

**防退化检查**: ✅ 只标记冲突，不取消扩张
✅ 不自动选择最高 confidence 的预测
✅ 不降低任一预测的 confidence

---

### CF-8: 因果链 — Energy Shortage + Spawn Starvation

**场景描述**: 系统同时有 2 条活跃预测：
- EnergyShortage: confidence=0.8
- SpawnStarvation: confidence=0.7

**输入**:
- 2 条活跃 Prediction

**预期 A6.5 行为**:
- `detectConflicts()` 返回空数组（无冲突）
- `predictionConflicts = []`
- 但可以在 `uncertainty` 中标注 causal chain（如果实现）

**防退化检查**: ✅ 因果链不标记为冲突
✅ 不惩罚因果相关的预测

---

### CF-9: Temporal Inconsistency — 同一目标预测波动

**场景描述**: 同一 EnergyShortage 模型在 tick 1000 和 tick 1500 各产出一条 active Prediction：
- tick 1000: confidence=0.8, value=5000
- tick 1500: confidence=0.6, value=2000

**输入**:
- `allActivePredictions()` 返回 2 条同 target 的 Prediction
- value 差异: |5000 - 2000| / |5000| = 0.6 > 0.3

**预期 A6.5 行为**:
- `detectConflicts()` 返回 1 条 `PredictionConflict`
- `conflict.type = "temporal"`
- `conflict.severity` 基于 value 差异
- `predictionConflicts` 包含此冲突

**防退化检查**: ✅ 标记 temporal inconsistency
✅ 不自动选择最新预测

---

### CF-10: Regime Conflict — 预测上下文与当前不匹配

**场景描述**: 一条活跃 Prediction 的 `contextSignature = "peace-healthy-2-3-low"`，但当前 Regime 已变为 `"war-guarded-2-3-high"`。

**输入**:
- 1 条活跃 Prediction
- `checkRegimeCompatibility(prediction.context, currentContext)` 返回 `compatible = false`

**预期 A6.5 行为**:
- `detectConflicts()` 返回 1 条 `PredictionConflict`
- `conflict.type = "regime"`
- `regimeFit.currentRegimeMatched = false`
- `uncertainty.sources` 包含 `{ type: "distributional", description: "Active prediction regime mismatch" }`

**防退化检查**: ✅ 利用 A6.4 已有的 `checkRegimeCompatibility`
✅ 不自行重新实现 Regime 检查

---

### CF-11: 全面恶化信号 — 多模型同时高 confidence

**场景描述**: 4 条活跃预测全部高 confidence：
- EnergyShortage: 0.9
- SpawnStarvation: 0.85
- LogisticsBottleneck: 0.8（未实现模型）
- RoomCollapse: 0.75（未实现模型）

**输入**:
- 假设 4 条活跃 Prediction（未来模型实现后）
- 无互斥对

**预期 A6.5 行为**:
- `detectConflicts()` 返回空数组（无逻辑矛盾）
- `predictionConflicts = []`
- `uncertainty.sources` 包含 `{ type: "environmental", description: "Multiple models predicting deterioration simultaneously" }`
- `uncertainty.dominantSource = "environmental"`

**防退化检查**: ✅ 不将"全面恶化"误标为冲突
✅ 但在 uncertainty 中标注

---

### CF-12: 冷启动 — 所有 Ring Buffer 为空

**场景描述**: Global reset 后，A6.1-A6.4 的所有 Ring Buffer 全部为空。

**输入**:
- `__experienceCache` 为空
- `__evaluationCache` 为空
- `__predictionCache` 为空
- `__calibrationCache` 为空

**预期 A6.5 行为**:
- `predictionCoverage.covered = 0`
- `modelReliability = []`（空数组）
- `calibrationHealth = { status: "COLD_START" }`
- `dataSufficiency = { insufficient: true }`
- `uncertainty.dominantSource = "epistemic"`
- `uncertainty.sources = [{ type: "epistemic", description: "Cold start: all ring buffers empty" }]`
- `predictionConflicts = []`
- `knowledgeFreshness = { status: "COLD_START" }`

**防退化检查**: ✅ 冷启动不伪造 IntelligenceState
✅ 所有维度标注 INSUFFICIENT_DATA / COLD_START

---

### CF-13: 部分 Ring Buffer 有数据

**场景描述**: Global reset 后 50000 tick，A6.3 和 A6.4 有数据，但 A6.1 和 A6.2 的 Ring Buffer 仍较稀疏。

**输入**:
- `__experienceCache`: 5 条记录
- `__evaluationCache`: 3 条记录
- `__predictionCache`: 20 条记录
- `__calibrationCache`: 15 条 ResolutionResult

**预期 A6.5 行为**:
- `predictionCoverage.covered = 2`（energy-shortage + spawn-starvation）
- `modelReliability` 有 2 条（每模型一条）
- `dataSufficiency.modelsWithSufficientData = 0`（15 < MIN_SAMPLES_FOR_PROFILE=100）
- `calibrationHealth = { status: "INSUFFICIENT_DATA" }`
- `uncertainty.sources` 包含 epistemic uncertainty

**防退化检查**: ✅ 不因部分数据可用就伪造充分性
✅ 明确标注哪些维度数据不足

---

### CF-14: Profile Aging — 统计时间过旧

**场景描述**: `ModelCalibrationProfile.statisticsTick = 100000`，当前 tick = 160000（距离 60000 tick > CALIBRATION_PROFILE_INTERVAL * 3 = 15000 tick）。

**输入**:
- Profile 的 `statisticsTick` 距离当前 tick 超过 stale 阈值

**预期 A6.5 行为**:
- `calibrationHealth.profileStale = true`
- `knowledgeFreshness.sources` 包含 `{ source: "calibrationProfile", freshness: "STALE" }`
- `uncertainty.sources` 包含 `{ type: "temporal", description: "Calibration profile is stale (60000 tick old)" }`

**防退化检查**: ✅ 不使用 stale Profile 做精确判断
✅ 标注 stale 状态

---

### CF-15: 确定性回放 — IntelligenceState 一致性

**场景描述**: 对同一组输入数据，运行 100 次 IntelligenceState 计算。

**输入**:
- 固定的 A6.1-A6.4 Ring Buffer 数据
- 固定的 PredictionContext
- 固定的 EmpireHealth

**验证步骤**:
1. 调用 `computeIntelligenceState()` 100 次
2. 检查每次返回的 `stateHash` 是否一致
3. 检查每次返回的 `predictionConflicts` 是否一致（数量 + conflictHash）
4. 检查每次返回的 `modelReliability` 是否一致（数量 + reliabilityHash）

**预期结果**: 100 次 replay → 100% identical stateHash

**防退化检查**: ✅ 确定性保证——无 Math.random / Date.now / 浮点误差
✅ 所有遍历按 ID 排序

---

## 三、场景覆盖矩阵

### 3.1 Regime 分区覆盖

| Regime 场景 | 覆盖场景 | 场景数 |
|------------|---------|--------|
| Regime Profile 存在且充足 | CF-1 | 1 |
| Regime Profile 不存在 | CF-2 | 1 |
| Regime Profile 存在但不足 | CF-3 | 1 |
| Regime Conflict | CF-10 | 1 |

### 3.2 Temporal 覆盖

| Temporal 场景 | 覆盖场景 | 场景数 |
|--------------|---------|--------|
| Drift 检测 | CF-4 | 1 |
| Improving 检测 | CF-5 | 1 |
| Rolling Window 不足 | CF-6 | 1 |
| Profile Aging | CF-14 | 1 |

### 3.3 Conflict 覆盖

| Conflict 场景 | 覆盖场景 | 场景数 |
|--------------|---------|--------|
| 逻辑冲突 | CF-7 | 1 |
| 因果链（非冲突） | CF-8 | 1 |
| Temporal inconsistency | CF-9 | 1 |
| Regime 冲突 | CF-10 | 1 |
| 全面恶化（非冲突） | CF-11 | 1 |

### 3.4 IntelligenceState 覆盖

| IntelligenceState 场景 | 覆盖场景 | 场景数 |
|----------------------|---------|--------|
| 冷启动 | CF-12 | 1 |
| 部分数据 | CF-13 | 1 |
| 确定性回放 | CF-15 | 1 |

### 3.5 Data Sufficiency 覆盖

| Data Sufficiency 场景 | 覆盖场景 | 场景数 |
|----------------------|---------|--------|
| 充足 | CF-1 | 1 |
| 不足 → 全局 fallback | CF-2 | 1 |
| 不足 → Regime 降权 | CF-3 | 1 |
| 不足 → 不检测 drift | CF-6 | 1 |
| 不足 → 冷启动 | CF-12 | 1 |
| 部分不足 | CF-13 | 1 |

---

## 四、与 A6.4 C1-C12 的衔接

### 4.1 A6.4 场景在 A6.5 中的表现

| A6.4 场景 | A6.4 Resolution | A6.5 IntelligenceState 影响 |
|-----------|-----------------|---------------------------|
| C1: CORRECT | CORRECT | modelReliability bucket 统计 +1 success |
| C2: FALSE_POSITIVE | FALSE_POSITIVE | modelReliability bucket 统计 +1 failure |
| C3: INCORRECT | INCORRECT | modelReliability bucket 统计 +1 failure |
| C4: CORRECT (horizon 内) | CORRECT | 同 C1 |
| C5: PARTIAL | PARTIAL | modelReliability bucket 统计 +0.5 success |
| C6: REGIME_CHANGED | REGIME_CHANGED | calibratableCount 不变（不计入），regimeFit 标注 |
| C7: EXTERNAL_INTERFERENCE | EXTERNAL_INTERFERENCE | calibratableCount 不变，uncertainty 标注 |
| C8: INSUFFICIENT_OBSERVATION | INSUFFICIENT_OBSERVATION | calibratableCount 不变 |
| C9: Observation Gap | INSUFFICIENT_OBSERVATION | 同 C8 |
| C10: OVERCONFIDENT | 统计场景 | modelReliability.verdict = "OVERCONFIDENT" |
| C11: UNDERCONFIDENT | 统计场景 | modelReliability.verdict = "UNDERCONFIDENT" |
| C12: Deterministic | 确定性 | IntelligenceState.stateHash 一致 |

### 4.2 A6.5 不重新验证 A6.4 的 Resolution 分类

**原则**: A6.5 信任 A6.4 的 Resolution 结果。A6.5 不重新判定 CORRECT/INCORRECT/PARTIAL/...。

**如果 A6.4 的 Resolution 是错误的**: A6.5 会继承错误，但 A6.5 的 drift detection 可以在统计层面发现"A6.4 的 Resolution 分类可能有问题"（例如 recent ECE 远高于 overall ECE）。

---

## 五、防退化检查清单

| 退化路径 | 覆盖场景 | 检查点 |
|---------|---------|--------|
| 退化 1: 权重裁决 | CF-7 | ✅ 不降权任一预测 |
| 退化 2: 冲突解决 | CF-7, CF-9 | ✅ 不选择"赢"的预测 |
| 退化 3: 策略决策 | CF-7 | ✅ 不取消扩张 |
| 退化 4: 模型选择 | CF-4 | ✅ drift 不切换模型 |
| 退化 5: 万能分数 | CF-1 | ✅ 产出多维 Assessment 非 score |
| 退化 6: 伪造 Regime Profile | CF-3 | ✅ 样本不足不伪造 |
| 退化 7: 忽略冷启动 | CF-12 | ✅ 标注 COLD_START |
| 退化 8: 持久化 IntelligenceState | CF-15 | ✅ 不写入 globalCache |
| 退化 9: Stale Profile 误用 | CF-14 | ✅ 标注 STALE |
| 退化 10: 伪造冲突检测 | CF-8, CF-11 | ✅ 因果链和全面恶化不标记为冲突 |

---

## 六、边界条件

### 6.1 极端值

| 场景 | 输入 | 预期行为 |
|------|------|---------|
| 所有 confidence = 0 | 10 条 Prediction, confidence=0 | predictions 有效但 conflict severity = 0 |
| 所有 confidence = 1 | 10 条 Prediction, confidence=1 | conflict severity = rule.severity |
| Ring Buffer 满 | 500 条 ResolutionResult | 正常计算，不超出容量 |
| Ring Buffer 1 条 | 1 条 ResolutionResult | INSUFFICIENT_DATA |

### 6.2 并发场景

| 场景 | 预期行为 |
|------|---------|
| 同 tick 内多条 Prediction 产出 | 按预测 ID 排序处理 |
| 同 tick 内多条 Resolution 完成 | 按解析 ID 排序处理 |
| Profile 更新与 IntelligenceState 计算同时 | IntelligenceState 使用更新前的 Profile（同 tick 快照） |

### 6.3 空值处理

| 输入为空 | 预期行为 |
|---------|---------|
| `allActivePredictions()` 返回空 | `predictionCoverage.covered = 0`, `predictionConflicts = []` |
| `getAllResolutions()` 返回空 | `calibrationHealth = { status: "INSUFFICIENT_DATA" }` |
| `getProfile()` 返回 undefined | `modelReliability` 不包含该模型 |
| `getFailureStats()` 返回 undefined | 不影响 reliability 评估 |
| EmpireHealth 为 null | `regimeFit = { status: "NO_CONTEXT" }` |
