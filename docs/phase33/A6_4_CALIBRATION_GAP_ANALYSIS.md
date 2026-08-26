# A6.4 — Calibration Gap Analysis

> **阶段**: A6.4 Research / Audit
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 审计 A6.1/A6.2/A6.3 现有实现，识别 Prediction Calibration 所需的数据差距

---

## 一、审计范围与方法

### 1.1 审计目标

本报告回答一个问题：**从 A6.1（Experience/Outcome/Attribution）、A6.2（Strategy Evaluation/Baseline/Evidence）、A6.3（Prediction/TimeSeries/Resolution）的现有实现出发，构建 A6.4 Prediction Calibration & Resolution 还缺什么？**

### 1.2 审计输入清单

| 层级 | 代码/文档 | 状态 |
|------|----------|------|
| A6.1 域代码 | `src/domain/intelligence/experience.ts` | ✅ 已审计 |
| A6.1 域代码 | `src/domain/intelligence/outcome.ts` | ✅ 已审计 |
| A6.1 域代码 | `src/domain/intelligence/attribution.ts` | ✅ 已审计 |
| A6.1 系统代码 | `src/systems/intelligence/experience-collector-system.ts` | ✅ 已审计 |
| A6.2 域代码 | `src/domain/intelligence/strategy-evaluation.ts` | ✅ 已审计 |
| A6.2 域代码 | `src/domain/intelligence/baseline.ts` | ✅ 已审计 |
| A6.2 域代码 | `src/domain/intelligence/evaluation-evidence.ts` | ✅ 已审计 |
| A6.2 系统代码 | `src/systems/intelligence/strategy-evaluation-system.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/types.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/context.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/ring-buffer.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/resolve.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/hashing.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/guards.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/evidence-builder.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/time-series.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/energy-shortage.ts` | ✅ 已审计 |
| A6.3 域代码 | `src/domain/intelligence/prediction/spawn-starvation.ts` | ✅ 已审计 |
| A6.3 系统 | `bootstrap.ts` | ✅ 已审计（无 prediction-system 注册） |
| A6.3 文档 | `docs/phase30/A6_3_PREDICTION_CONTRACT.md` | ✅ 已审计 |
| A6.3 文档 | `docs/phase30/A6_3_PREDICTION_ARCHITECTURE.md` | ✅ 已审计 |
| A6.3 文档 | `docs/phase30/A6_3_PREDICTION_GAP_ANALYSIS.md` | ✅ 已审计 |
| A6.3 文档 | `docs/phase32/A6_3_2_FINAL_AUDIT.md` | ✅ 已审计 |

---

## 二、A6.1 数据复用审计

### 2.1 ExperienceRecord — Calibration 可复用字段

| 字段 | 类型 | Calibration 可用性 | 说明 |
|------|------|-------------------|------|
| `identity.experienceId` | string | ✅ 可追溯 | 可作为 Evidence ID 引用 |
| `identity.tick` | number | ✅ | 事件时间锚点 |
| `identity.type` | ExperienceType | ✅ | 类型分发依据 |
| `decision.decisionTick` | number | ✅ | 决策时间锚点 |
| `context.posture` | string | ✅ | Regime Change 检测 |
| `context.cpuTier` | string | ✅ | Regime Change 检测 |
| `context.empireHealthScore` | number | ✅ | 上下文快照 |
| `context.metrics` | Record<string, number> | ✅ | 上下文快照 |
| `outcome.classification` | OutcomeClassification | ✅ **核心** | 可复用为 Resolution 参考信号 |
| `outcome.metric` | string | ✅ | 判定预测与结果的对应关系 |
| `outcome.value` | number | ✅ **核心** | 可作为 actual value 对比预测值 |
| `outcome.measurementTick` | number | ✅ | 测量时间，用于 Horizon 检查 |
| `outcome.delay` | number | ✅ | 测量延迟 |
| `outcome.stateDelta` | StateDelta | ⚠️ 部分 | energyDelta 可用于 energy-shortage 校准 |
| `attribution.primaryCause` | AttributionFactor | ✅ **核心** | Failure Attribution 复用 |
| `attribution.externalFactors` | AttributionFactor[] | ✅ **核心** | External Interference 判定 |
| `attribution.confidence` | number | ✅ | 归因可信度 |
| `attribution.evidence` | AttributionEvidence[] | ✅ | 可追溯链 |
| `attribution.attributionHash` | string | ✅ | 确定性验证 |
| `lifecycle` | ExperienceLifecycle | ✅ | 过滤未完成记录 |

**结论**: A6.1 的 Experience/Outcome/Attribution 数据结构对 Calibration **基本足够**。

### 2.2 缺失字段

| 缺失字段 | 需求 | 严重度 | 是否需修改 A6.1 |
|---------|------|--------|----------------|
| Outcome 缺少 `predictedValueComparison` | Calibration 需要对比预测值与实际值 | ❌ 不需要修改 A6.1 | A6.4 在自己的 Calibration Record 中保存对比 |
| Outcome 缺少 `regimeAtMeasurement` | Resolution 时需知道测量时的 Regime | ❌ 不需要修改 A6.1 | A6.4 在 Resolution 时自己采集 |
| Attribution 缺少 `calibrationImpact` | 标注该归因是否影响 calibration denominator | ❌ 不需要修改 A6.1 | A6.4 在自己的逻辑中处理 |

**关键结论**: **A6.4 无需修改 A6.1 冻结契约**。所有缺失字段由 A6.4 在自己的 Domain 内部维护。

---

## 三、A6.2 数据复用审计

### 3.1 StrategyEvaluation — Calibration 可复用字段

| 字段 | 类型 | Calibration 可用性 | 说明 |
|------|------|-------------------|------|
| `score.dimensions[dim].observed` | number | ✅ | 可作为 Observation 信号 |
| `score.dimensions[dim].baseline` | number | ✅ | 期望值参考 |
| `score.dimensions[dim].delta` | number | ✅ | 偏差信号 |
| `score.dimensions[dim].confidence` | number | ✅ | 可作为 Calibration 交叉验证 |
| `score.verdict` | EvaluationVerdict | ✅ | 宏观趋势信号 |
| `findings[].hasExternalFactor` | boolean | ✅ **核心** | External Interference 判定 |
| `findings[].externalFactorDescription` | string | ✅ | 外部因素详情 |
| `baseline.dimensions[dim].source` | BaselineSource | ✅ | 基准来源可信度 |
| `baseline.dimensions[dim].confidence` | number | ✅ | 基准置信度 |

### 3.2 A6.2 是否可作为 Prediction Outcome?

**不直接作为 Outcome，但作为交叉验证信号。**

| 场景 | 可行性 | 说明 |
|------|--------|------|
| Evaluation verdict = DEGRADING → 可辅助验证 energy-shortage 预测 | ✅ | 但不是 1:1 映射 |
| Evaluation finding.hasExternalFactor → 标记 Prediction Resolution 为 EXTERNAL_INTERFERENCE | ✅ | 但需要时间窗口匹配 |
| Evaluation confidence → 交叉验证 Prediction confidence | ✅ | 但不同度量 |

### 3.3 循环依赖分析

```
A6.2 Evaluation → 消费 A6.1 Experience
A6.3 Prediction → 消费 globalCache 数据（包括 Evaluation 产出）
A6.4 Calibration → 消费 A6.3 Prediction + A6.1 Outcome + A6.2 Evaluation（只读）
    ↓
A6.4 产出 Calibration Statistics（只写 __calibrationCache）
    ↓
不反馈给 A6.2 / A6.3 / 任何执行系统
```

**结论**: **无循环依赖**。A6.4 是纯消费端，只产出 Shadow-Only Statistics。

### 3.4 依赖方向

```
A6.1 (Experience/Outcome/Attribution) ← A6.4 只读消费
A6.2 (StrategyEvaluation) ← A6.4 只读消费（交叉验证）
A6.3 (Prediction) ← A6.4 只读消费（核心输入）
```

---

## 四、A6.3 数据复用审计 — 核心差距

### 4.1 Prediction 类型现有字段

| 字段 | 类型 | Calibration 可用性 | 说明 |
|------|------|-------------------|------|
| `id` | string | ✅ **核心** | 唯一追溯键 |
| `generatedAt` | number | ✅ **核心** | 预测发布时间 |
| `target` | PredictionTarget | ✅ **核心** | 模型分组键 |
| `window.startTick` | number | ✅ **核心** | Horizon 计算 |
| `window.endTick` | number | ✅ **核心** | Horizon 计算 |
| `window.duration` | number | ✅ | Horizon 计算 |
| `value` | number | ✅ **核心** | 预测值，与实际值对比 |
| `confidence` | number | ✅ **核心** | 被校准对象 |
| `method` | PredictionMethod | ✅ | 模型分组键 |
| `evidence.sources` | string[] | ✅ | 可追溯链 |
| `evidence.modelParams` | Record | ✅ | 模型参数快照 |
| `evidence.sampleRange` | object | ✅ | 采样范围 |
| `evidence.regimeCompatibility` | object | ✅ **核心** | Regime Change 判定 |
| `modelVersion` | number | ✅ | 版本分组键 |
| `status` | PredictionStatus | ✅ | 生命周期过滤 |
| `contextSignature` | string | ✅ **核心** | Regime 匹配键 |
| `context` | PredictionContext | ✅ **核心** | 发布时 Regime 快照 |

### 4.2 CONTRACT GAP 识别

| GAP ID | 描述 | 严重度 | 影响 | 是否阻塞 A6.4 |
|--------|------|--------|------|---------------|
| **CAL-GAP-1** | Prediction 没有 `resolvedTick` 字段 | **HIGH** | Resolution 时无法记录解析时间，只能从 Ring Buffer 外部维护 | ❌ 不阻塞 — A6.4 在 CalibrationRecord 中记录 resolvedTick |
| **CAL-GAP-2** | Prediction 没有 `resolutionOutcome` 字段 | **HIGH** | A6.3 的 `resolve.ts` 只返回 `fulfilled/expired/invalidated`，缺少 `CORRECT/INCORRECT/REGIME_CHANGED/EXTERNAL_INTERFERENCE/PARTIAL/UNRESOLVED` | ❌ 不阻塞 — A6.4 定义自己的 ResolutionOutcome 类型 |
| **CAL-GAP-3** | Prediction 没有 `actualValue` 字段 | **MEDIUM** | Resolution 时无法在 Prediction 对象上记录实际值 | ❌ 不阻塞 — A6.4 在 CalibrationRecord 中保存 |
| **CAL-GAP-4** | `resolve.ts` 的 Resolution 逻辑过于简单 | **HIGH** | 当前 `verifyPrediction` 只比较 `deviation < 0.2` → fulfilled，不检查 observation window、Regime Change、External Interference | ❌ 不阻塞 — A6.4 构建独立的 Resolution Engine |
| **CAL-GAP-5** | 没有 Calibration Statistics 容器 | **MEDIUM** | 无 Ring Buffer/聚合结构存储校准统计 | ❌ 不阻塞 — A6.4 新建 |
| **CAL-GAP-6** | 没有 Confidence Bucket 机制 | **MEDIUM** | 无法按 confidence 分桶统计 observed success rate | ❌ 不阻塞 — A6.4 新建 |
| **CAL-GAP-7** | 没有 Failure Attribution 类型 | **LOW** | 缺少 MODEL_ERROR / REGIME_CHANGE / EXTERNAL_INTERFERENCE 等分类 | ❌ 不阻塞 — A6.4 新建 |
| **CAL-GAP-8** | A6.3 未接入系统层（bootstrap.ts 无注册） | **HIGH** | Prediction 模型从未在 tick 循环中运行过，Ring Buffer 为空 | ⚠️ **阻塞实施** — 详见 §五 |
| **CAL-GAP-9** | `resolve.ts` 不检查 Observation Window | **HIGH** | 当前只做单点对比（预测值 vs 实际值），不检查窗口内的趋势变化 | ❌ 不阻塞 — A6.4 新建完整的 Horizon Resolution |
| **CAL-GAP-10** | `resolve.ts` 不区分 Regime Change | **HIGH** | 当 prediction 发布时 context=A，resolution 时 context=B，当前逻辑会直接判定为 INCORRECT | ❌ 不阻塞 — A6.4 新建 Regime-aware Resolution |

### 4.3 CAL-GAP-8 详细分析（A6.3 未接入系统层）

**现状**:
- `bootstrap.ts` 中没有注册 prediction-system
- A6.3.2 Final Audit 确认「未接入系统层」「未持久化」「未参与决策」
- `globalCache.__predictionCache` 字段可能未定义
- PredictionRingBuffer 从未在 tick 循环中被写入

**影响**:
- A6.4 Calibration 需要 **已 Resolution 的 Prediction** 作为输入
- 如果 Ring Buffer 为空，Calibration 无样本可用
- 无法在真实运行环境中验证 Calibration 逻辑

**解决方案**:

| 选项 | 描述 | 阻塞 A6.4 实施？ |
|------|------|-----------------|
| A | A6.4 研究阶段不阻塞；Implementation 阶段先补建 prediction-system 适配器 | ❌ 不阻塞研究 |
| B | A6.4 作为 Domain 纯函数设计，测试使用合成数据 | ❌ 不阻塞研究 |
| C | 如果 A6.3.3 存在，先完成它再进入 A6.4 Implementation | ⚠️ 取决于 A6.3.3 是否存在 |

**结论**: A6.4 **研究阶段不阻塞**。Implementation 阶段的前置条件是 A6.3.3（系统层适配器）完成。A6.4 Contract Design 可以并行进行。

---

## 五、差距汇总与严重度

### 5.1 差距分类

| 类别 | 差距数 | 说明 |
|------|--------|------|
| Resolution 逻辑差距 | 4 | CAL-GAP-1/2/4/9/10 — A6.3 resolve.ts 过于简单 |
| 基础设施差距 | 3 | CAL-GAP-5/6/7 — 需新建 Calibration 容器 |
| 系统接入差距 | 1 | CAL-GAP-8 — A6.3 未接入 bootstrap |
| 数据字段差距 | 2 | CAL-GAP-3 — actualValue 缺失 |

### 5.2 关键结论

1. **A6.4 无需修改 A6.1/A6.2/A6.3 冻结契约** — 所有缺失字段由 A6.4 在自己的 Domain 内维护。
2. **A6.3 resolve.ts 的简单 Resolution 逻辑不阻塞 A6.4** — A6.4 构建独立的、更完整的 Resolution Engine，复用 A6.3 的 Ring Buffer 数据但不修改它。
3. **A6.3 未接入系统层是 A6.4 Implementation 的前置阻塞** — 但不阻塞 A6.4 Contract Design。
4. **A6.1 的 Outcome + Attribution 数据对 Failure Attribution 足够** — 可直接复用 `primaryCause` 和 `externalFactors`。
5. **A6.2 的 Evaluation 可作为交叉验证信号** — 但不直接作为 Prediction Outcome。
6. **当前只有 2 个 Prediction Model 实际实现**（energy-shortage + spawn-starvation）— A6.4 Calibration 只针对这两个模型，但设计须支持未来扩展。
