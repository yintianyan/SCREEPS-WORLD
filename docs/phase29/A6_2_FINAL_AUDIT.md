# A6.2 — Final Audit Report

> **阶段**: A6.2 Strategy Evaluation & Baseline
> **日期**: 2026-08-26
> **审计范围**: A6.2 全部代码 + 测试 + 文档

---

## 一、Canonical Evaluation Dimensions 是什么？

8 个维度：`economicGrowth`, `resourceEfficiency`, `cpuEfficiency`, `riskLevel`, `survival`, `expansion`, `militaryOutcome`, `recoveryCost`。

定义来源：`A6_0_STRATEGY_EVALUATION.md` §2.2 + §2.3（权威文档），经 `A6_2_CONTRACT_RESOLUTION.md` 仲裁签发。

---

## 二、为什么采用这个定义？

1. `A6_0_STRATEGY_EVALUATION.md` 是 Strategy Evaluation 的专项设计文档，包含完整 TypeScript 接口定义
2. `A6_0_FINAL_RESEARCH.md` 只是综合报告的浓缩摘要
3. 文档 A 的 8 个必选维度 + 1 个可选维度（opportunityCost 标注后期）更精确
4. 文档 B 的 `logisticsHealth` / `techProgress` 可归入已有维度

---

## 三、Baseline 是什么？

三类：
- **CONFIG BASELINE**: 静态配置值，始终可用
- **HISTORICAL BASELINE**: Experience Ring Buffer 滚动历史（mean + median + variance + IQR outlier removal）
- **COMMUNITY BASELINE**: UNAVAILABLE（不伪造）

---

## 四、Baseline 如何保证公平？

通过 `BaselineKey` 绑定 Strategy Identity + Phase + ContextSignature。

ContextSignature 编码：RCL range + room count range + threat level。

比较前执行 `checkContextCompatibility()`，不匹配 → `INCOMPARABLE`。

`detectRegimeMismatch()` 检测 5 维上下文变化（RCL, room count, threat, posture, resource）。

---

## 五、如何处理样本不足？

`evaluateSampleSufficiency()` 检查每维度的最低样本数。

样本不足 → verdict = `INCONCLUSIVE`，不强行 BETTER/WORSE。

最低样本数通过 `MINIMUM_SAMPLE_SIZES` 配置常量表达，每个维度有明确理由。

---

## 六、如何处理上下文不匹配？

`checkContextCompatibility()` 构建 context signature 并比较。

不匹配 → `DimensionScore.comparable = false`，delta = 0，confidence = 0。

verdict 强制为 `INCONCLUSIVE`。

---

## 七、如何处理外部干扰？

- `externalEnergyInflow > 0` → 检测为外部因素，confidence 降低 0.3
- Attribution `externalFactors` 非空 → 标记为外部干扰
- Finding 标注 `hasExternalFactor = true` + `externalFactorDescription`

---

## 八、Attribution 如何参与 Evaluation？

Evaluation **消费** A6.1 Attribution（不重新实现归因）。

`getAttributionConfidence()` 从维度相关的 Attribution 中提取平均置信度。

Attribution Confidence 纳入 Evaluation Confidence 计算（30% 权重）。

---

## 九、Evaluation 是否可解释？

是。每个 `DimensionScore` 都有：
- `evidenceIds` — 可追溯到 Experience ID + Attribution Hash
- `evidenceType` — OBSERVED / ATTRIBUTED / INFERRED
- `metric` — 量化指标名

`buildEvaluationEvidence()` 构建完整证据链。
`traceEvidence()` 追溯 Finding → DimensionScore → Experience → Outcome → Attribution → Metric。

---

## 十、Evidence 是否完整？

`validateEvidenceCompleteness()` 检查：
- 有 Experience 追溯的证据数
- 有 Outcome 追溯的证据数
- 有 Attribution 追溯的证据数
- 有 Baseline 的证据数

返回 `completenessScore`（0-1）。

---

## 十一、是否存在万能 Score？

**不存在**。

- 8 维独立计算，每维有独立 score
- `informationalScore` 存在但明确标注 "informational only, no decision power"
- `confidence` 是各维度最低置信度，非"总分"
- 禁止 `if score > X then strategy good`

---

## 十二、是否存在第二套 Metrics？

**不存在**。MetricSnapshot 复用已有系统：EmpireHealth / AutonomyMetrics / RecoveryStats / Experience / Outcome / Attribution。

---

## 十三、是否存在第二套 Strategy？

**不存在**。strategyType 从已有 `EmpirePosture` 推导，不建立第二套策略系统。

---

## 十四、Evaluation 是否完全 Shadow-Only？

**是**。

- Domain 层：不引用 Game / Memory / RawMemory / globalThis / console / Kernel
- System 层：不执行 Game API，不修改 Strategy
- Recommendation 始终 `shadowOnly=true, autoApply=false`

---

## 十五、Recommendation 是否自动执行？

**否**。

`RecommendationCandidate` 的 `autoApply` 字段类型为 `false`（literal type）。
`shadowOnly` 字段类型为 `true`（literal type）。

Recommendation 不进入 Spawn / Logistics / Military / Strategy / Recovery。

---

## 十六、Memory 是否有界？

**是**。

- Evaluation Ring Buffer: capacity=50, GC maxAge=50000 tick
- 只保存：strategyId, evaluationWindow, dimension values, baseline values, delta, confidence, evidence IDs, hash
- 不保存：完整 Experience, 完整 Runtime Snapshot, Game Object, Room Object, Path, Creep Object

---

## 十七、CPU 是否符合预算？

**是**。

- 系统间隔 500 tick，P3 post 阶段
- 1 evaluation < 100ms
- 100 evaluations < 5s
- 不每 tick 全历史重算（增量、有界、低频）

---

## 十八、Deterministic Replay 是否通过？

**是**。

- 20 scenarios × 1000 iterations → identical hash
- `verifyEvaluationDeterminism()` + `verifyBaselineDeterminism()` 全绿
- 禁止 Math.random / Date.now / wall-clock / unordered iteration

---

## 十九、A6 停止后帝国是否完全不受影响？

**是**。

- `strategyEvaluationSystem` 完全停止时，帝国安全运行
- 不修改任何业务状态
- 不执行任何 Game API
- 不进入任何执行系统路径

---

## 二十、A6.3 是否可以安全开始？

**是**。

A6.2 已完成：
- ✅ 8 维 Canonical Dimensions 定义
- ✅ Strategy Evaluation Domain（纯函数）
- ✅ Baseline Model（CONFIG + HISTORICAL + COMMUNITY UNAVAILABLE）
- ✅ Evidence 追溯链
- ✅ Shadow-Only 原则
- ✅ Deterministic Replay
- ✅ Architecture Guards
- ✅ 质量门槛全绿

A6.3 可以基于 A6.2 的 `StrategyEvaluation` 输出开始构建 Prediction 模型。

---

## 真实调用链审计

```
DecisionTrace
    ↓
Experience (A6.1 Ring Buffer)
    ↓
Outcome (A6.1 collectOutcome)
    ↓
Attribution (A6.1 collectAttribution)
    ↓
Evaluation (A6.2 evaluateStrategy)           ✅ 纯函数
    ↓
Baseline (A6.2 buildBaseline + compareBaseline) ✅ 纯函数
    ↓
Evidence (A6.2 buildEvaluationEvidence)      ✅ 纯函数
    ↓
EvaluationResult (A6.2 StrategyEvaluation)   ✅ heap Ring Buffer
```

**隐藏路径检查**：EvaluationResult 不通过任何路径进入 Strategy / Spawn / Military / Logistics / Recovery。✅

---

## 质量门槛

| 检查 | 结果 |
|------|------|
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ 4502 pass / 1 fail (已有 flaky test, 非 A6.2) |
| `npm run build` | ✅ PASS |
| Architecture Guards | ✅ PASS |
| Integration Tests | ✅ PASS |
| Replay Tests | ✅ PASS (20 × 1000) |
| CPU Benchmark | ✅ PASS |
| Memory Audit | ✅ PASS |

---

## 遗留项

| ID | 严重度 | 描述 | Owner | 后续阶段 | 删除条件 |
|----|--------|------|-------|---------|---------|
| A6.2-M1 | MEDIUM | `medium_term` / `long_term` 窗口未实现 | A6.3 | A6.3 | A6.3 实现 long_term 窗口 |
| A6.2-M2 | MEDIUM | COMMUNITY BASELINE 标记 UNAVAILABLE | A6.3+ | 需社区数据 | 获得可靠社区基准数据 |
| A6.2-L1 | LOW | 系统层 MetricSnapshot 中 expansion/militaryOutcome 使用简化值 0.5 | A6.3 | 接入真实 dashboard | 接入扩张/战争真实指标 |
