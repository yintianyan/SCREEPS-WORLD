# A6.5 Intelligence Model — 概念定义与边界

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做概念定义，不修改任何代码

---

## 一、A6.5 到底是什么？

### 定义

**A6.5 = Reliability Assessment & Intelligence State**

在 A6.1（Experience）、A6.2（Evaluation）、A6.3（Prediction）、A6.4（Calibration）之后，A6.5 回答：

> "系统知道自己的预测能力之后，如何形成可靠、可解释、具有时效性、具有 Regime 意识、能够处理不确定性和冲突的 Intelligence？"

A6.5 不是 "继续增加 Prediction Model"。A6.5 是在 Prediction 和 Calibration 之上，评估模型的**可靠性**和系统整体 Intelligence 的**健康状态**。

### 链条关系

```
A6.1 Experience     — "发生了什么？为什么？"
      ↓
A6.2 Evaluation     — "做得怎么样？比基线如何？"
      ↓
A6.3 Prediction      — "按照当前趋势，未来可能发生什么？"
      ↓
A6.4 Calibration    — "过去的 Prediction 到底准不准？"
      ↓
A6.5 Reliability    — "系统知道自己的预测能力之后，如何形成可靠的 Intelligence？"
      ↓
A6.6 Recommendation — "基于可靠 Intelligence，应该怎么做？"（未来）
```

---

## 二、核心概念定义

### 2.1 Intelligence

**定义**: 系统对自身状态、环境和趋势的可观测、可解释、可追溯的认知能力。

**不等于**: 一个 0-100 的分数。

**包含维度**:
- 预测覆盖：系统能预测哪些方面？
- 预测可靠性：这些预测有多准？
- 数据充足性：是否有足够数据支撑判断？
- 时效性：数据是否新鲜？
- 一致性：多个预测之间是否矛盾？

### 2.2 Prediction

**定义**: 按照当前趋势，未来可能发生什么。（A6.3 已定义）

**关键属性**:
- `value`: 预测值
- `confidence`: 预测置信度 [0,1]
- `window`: 预测时间窗口
- `target`: 预测目标
- `contextSignature`: 生成时的 Regime 签名
- `evidence`: 可追溯证据链

### 2.3 Calibration

**定义**: 过去的 Prediction 到底准不准？不同 confidence 桶是否可信？（A6.4 已定义）

**关键属性**:
- `avgConfidence`: 某桶内预测的平均置信度
- `observedSuccessRate`: 某桶内实际成功率
- `calibrationError`: |avgConfidence - observedSuccessRate|
- `ece`: 全模型预期校准误差
- `calibrationVerdict`: WELL_CALIBRATED / OVERCONFIDENT / UNDERCONFIDENT / INSUFFICIENT_DATA

### 2.4 Confidence（原始 vs 校准 vs 可信）

**三个不同概念**:

| 概念 | 定义 | 来源 | 用途 |
|------|------|------|------|
| RawConfidence | 模型产出的原始置信度 | A6.3 Prediction.confidence | 表达模型对自己预测的自评 |
| CalibratedConfidence | 经过 CalibrationProfile 校准后的置信度 | A6.4（隐含在 buckets 中） | 表达"在历史数据中，这个 confidence 桶的实际成功率" |
| Reliability | 模型在特定 Regime + 特定时间段的可信度 | A6.5（待定义） | 表达"这个模型现在、在这个条件下，是否值得信任" |

**关键区别**:
- RawConfidence 是模型的主观判断
- CalibratedConfidence 是历史的客观统计
- Reliability 是综合了 Regime、时效性、退化检测后的元判断

**禁止**: confidence = reliability = score。这三个概念必须保持独立。

### 2.5 Reliability

**定义**: 在特定 Regime、特定时间段内，模型预测的可信程度。

**不等于**: Calibration 的 observedSuccessRate。

**区别**:
- Calibration observedSuccessRate = 全历史统计
- Reliability = Regime 条件化 + 时效加权后的判断

**Reliability 的输入**:
1. CalibrationProfile（如果有该 Regime 的 Profile）
2. 样本充足性（该 Regime 下是否有足够样本）
3. 时效性（最近表现 vs 历史表现）
4. 退化检测（是否正在退化）

**Reliability 的输出**:
- 不是 [0,1] 的单一数字
- 而是 `ReliabilityAssessment`：一个包含多个维度的结构

### 2.6 Uncertainty

**定义**: 系统对自身预测能力的认知不确定度。

**不等于**: 1 - confidence。

**区别**:
- confidence 不确定性 = 模型对单个预测的不确定
- Uncertainty = 系统对整个 Intelligence 体系的不确定

**来源**:
1. 数据不足 → epistemic uncertainty
2. 模型冲突 → systematic uncertainty
3. Regime 变化 → distributional uncertainty
4. 时间退化 → temporal uncertainty

**表达**: 不是单一值，而是分类标签 + 原因描述。

### 2.7 Regime

**定义**: 影响预测模型有效性的宏观状态组合。（A6.3 已定义 PredictionContext）

**编码**: `posture-watchdogTier-roomRange-rclRange-threat`

**在 A6.5 中的用途**:
1. 按 Regime 分区 CalibrationProfile
2. 评估 Regime-specific reliability
3. 检测 Regime transition 对 reliability 的影响

### 2.8 Evidence

**定义**: 可追溯到事实的数据链。（A6.1-A6.4 均已定义）

**在 A6.5 中的用途**:
- Reliability Assessment 必须可追溯到 CalibrationProfile
- CalibrationProfile 必须可追溯到 ResolutionResult
- ResolutionResult 必须可追溯到 Prediction
- Prediction 必须可追溯到 Evidence

### 2.9 Freshness

**定义**: 数据从产出时刻到当前时刻的时间距离。

**分级**:
- FRESH: < 5000 tick — 直接使用
- RECENT: 5000-20000 tick — 使用但标注
- STALE: 20000-50000 tick — 降权
- EXPIRED: > 50000 tick — 不使用

**在 A6.5 中的用途**:
1. CalibrationProfile 的新鲜度评估
2. ResolutionResult 的时效加权
3. IntelligenceState 中 KnowledgeFreshness 维度

---

## 三、概念边界 — 禁止重叠

### 3.1 Prediction ≠ Intelligence

Prediction 是 "未来可能发生什么"。Intelligence 是 "系统对此有多确定"。

### 3.2 Calibration ≠ Intelligence

Calibration 是 "过去的预测准不准"。Intelligence 是 "系统知道自己的准确性后，形成怎样的认知状态"。

### 3.3 Reliability ≠ Confidence

Confidence 是模型的主观自评。Reliability 是元层面的客观评估。

### 3.4 IntelligenceState ≠ Score

IntelligenceState 是多维结构，不是单一分数。

### 3.5 A6.5 ≠ Strategy

A6.5 评估和暴露 Intelligence，不产出策略决策。

---

## 四、Intelligence State — 候选结构（研究对象）

> **重要声明**: 以下结构仅作为研究对象，不代表最终设计。最终是否需要 IntelligenceState 取决于 Gap Analysis 和 Architecture 审计的结论。

```typescript
// ═══════════════════════════════════════════════════
// 候选：IntelligenceState — 多维 Intelligence 健康状态
// ═══════════════════════════════════════════════════

// 注意：这是研究对象，不是最终设计。
// 禁止合并为单一 IntelligenceScore。

interface IntelligenceState {
  // ── 预测覆盖 ──
  /** 有多少种预测模型已实现。 */
  predictionCoverage: PredictionCoverage;
  
  // ── 模型可靠性 ──
  /** 各模型的可靠性评估（按 modelKey 索引）。 */
  modelReliability: ModelReliabilityAssessment[];
  
  // ── 校准健康度 ──
  /** 各模型的校准状态。 */
  calibrationHealth: CalibrationHealthSummary;
  
  // ── 数据充足性 ──
  /** 各模型/维度的样本充足性。 */
  dataSufficiency: DataSufficiencySummary;
  
  // ── Regime 适配 ──
  /** 当前 Regime 下各模型的适配度。 */
  regimeFit: RegimeFitSummary;
  
  // ── 不确定性 ──
  /** 系统级不确定性来源。 */
  uncertainty: UncertaintySummary;
  
  // ── 冲突状态 ──
  /** 活跃预测之间的冲突。 */
  predictionConflicts: PredictionConflict[];
  
  // ── 知识新鲜度 ──
  /** 各数据源的新鲜度。 */
  knowledgeFreshness: FreshnessSummary;
  
  // ── 元数据 ──
  /** 评估 tick。 */
  assessedAt: number;
  /** 评估确定性 hash。 */
  stateHash: string;
}
```

### 是否真的需要 IntelligenceState？

**判断标准**:

1. **如果 A6.6 Recommendation 需要一个统一的 Intelligence 输入** → YES
2. **如果 A6.6 可以直接读各子系统** → NO（但会导致 A6.6 与 A6.1-A6.4 耦合）
3. **如果可观测性需要一个聚合视图** → YES
4. **如果需要检测 "Intelligence 正在退化" 这种元级状态** → YES

**当前判断**: **需要 IntelligenceState**，但必须是最小增量。

理由: A6.6 Recommendation 如果直接读 4 个 Ring Buffer + 4 个 System 的输出，耦合度过高。A6.5 提供一个只读聚合视图，让 A6.6 只消费 `IntelligenceState`，是更干净的架构。

但: IntelligenceState 必须是**只读投影**，不是新数据源。它不维护自己的状态，每次运行时从既有数据重新计算。

---

## 五、概念关系图

```
Prediction (A6.3)
  │ confidence
  │ contextSignature
  │ evidence
  │
  ↓ Calibration (A6.4)
  │
CalibrationProfile
  │ buckets[].avgConfidence
  │ buckets[].observedSuccessRate
  │ ece / brierScore
  │ calibrationVerdict
  │
  ↓ Reliability Assessment (A6.5)
  │
ReliabilityAssessment
  │ regimeSpecificProfile?
  │ temporalTrend?
  │ dataSufficient?
  │ degradationDetected?
  │
  ↓ Intelligence State (A6.5)
  │
IntelligenceState
  │ predictionCoverage
  │ modelReliability[]
  │ calibrationHealth
  │ dataSufficiency
  │ regimeFit
  │ uncertainty
  │ predictionConflicts
  │ knowledgeFreshness
  │
  ↓ Recommendation (A6.6, future)
```

---

## 六、禁止清单

1. **禁止** confidence = reliability
2. **禁止** IntelligenceScore = 单一 0-100 数值
3. **禁止** A6.5 产出 Strategy decision
4. **禁止** A6.5 执行 Game API
5. **禁止** A6.5 修改 A6.1-A6.4 任何数据
6. **禁止** A6.5 新建数据采样通道
7. **禁止** A6.5 新建第二套 Metrics / Experience / Prediction / Calibration
8. **禁止** 因为数据不足而伪造置信度
9. **禁止** 合并不同 Regime 的 calibration 数据
10. **禁止** 合并不同模型的 reliability 评分
