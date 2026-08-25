# A6.2 — Contract Resolution: Canonical Evaluation Dimensions

> **阶段**: A6.2 Strategy Evaluation & Baseline
> **日期**: 2026-08-25
> **前置**: A6.0 冻结文档 + A6.2 Pre-Implementation Audit
> **约束**: 契约仲裁文档。本文件一旦签发，后续所有 A6.2+ 代码只能使用此处定义的 Canonical Dimensions。

---

## 一、冲突描述

### 1.1 冲突来源

A6.0 体系中存在两份定义 Strategy Evaluation 维度的文档：

| 文档 | 路径 | 维度数量 |
|------|------|---------|
| **文档 A** | `docs/phase27/A6_0_STRATEGY_EVALUATION.md` §2.2 | 9 维（含 Opportunity Cost 标注"后期"） |
| **文档 B** | `docs/phase27/A6_0_FINAL_RESEARCH.md` §3.4 | 8 维 |

### 1.2 文档 A 原始定义（STRATEGY_EVALUATION.md §2.2）

```
| 维度 | 定义 | 量化方法 | 数据来源 |
|------|------|---------|---------|
| Economic Growth | 经济增长率 | empireHealth.energyScore delta | empire-health-system |
| Resource Efficiency | 资源利用效率 | 产能/消耗比 | economy.ts flow-accounting |
| CPU Efficiency | CPU 消耗效率 | CPU/产出比 | CPU tier + telemetry |
| Risk Level | 风险水平 | 威胁指数 + 暴露面 | threat-assessment |
| Survival | 生存能力 | 帝国健康度 + 恢复能力 | empire-health + recoveryStats |
| Expansion | 扩张效果 | 新房存活率 + RCL 增速 | expansion-outcome events |
| Military Outcome | 军事结果 | 胜率 + 损失比 | evaluateWarOutcome |
| Recovery Cost | 恢复代价 | 恢复时间 + 资源消耗 | recovery-lifecycle |
| Opportunity Cost | 机会成本 | 未做某事的损失估计 | counterfactual（后期） |
```

文档 A 同时在 §2.3 定义了 `StrategyScore.dimensions` 接口，其中 `opportunityCost` 标注为 `optional` + "后期才评估"。

### 1.3 文档 B 原始定义（FINAL_RESEARCH.md §3.4）

```
| 维度 | 度量 | 数据来源 |
|------|------|---------|
| Survival | spawnFillRatio, controllerProgress | EmpireHealth |
| EconomicGrowth | energyIncomeRate, rclProgress | EmpireHealth |
| ResourceEfficiency | energyPerCreep, logisticsEfficiency | logistics + spawn |
| MilitaryEffectiveness | warWinRate, defenseSuccessRate | evaluateWarOutcome |
| ExpansionSuccess | expansionSuccessRate, timeToRCL | expansion-manager |
| CpuEfficiency | cpuPerRoom, bucketStability | CPU 遥测 |
| LogisticsHealth | starvationRate, deliveryOnTime | logistics |
| TechProgress | rclDistribution, labCount | EmpireHealth |
```

---

## 二、差异分析

### 2.1 维度对照

| # | 文档 A (STRATEGY_EVALUATION) | 文档 B (FINAL_RESEARCH) | 状态 |
|---|---------------------------|------------------------|------|
| 1 | Economic Growth | EconomicGrowth | ✅ 一致（名称+语义） |
| 2 | Resource Efficiency | ResourceEfficiency | ✅ 一致 |
| 3 | CPU Efficiency | CpuEfficiency | ✅ 一致 |
| 4 | Risk Level | — | 仅 A 有 |
| 5 | Survival | Survival | ✅ 一致 |
| 6 | Expansion | ExpansionSuccess | ✅ 一致 |
| 7 | Military Outcome | MilitaryEffectiveness | ✅ 一致 |
| 8 | Recovery Cost | — | 仅 A 有 |
| 9 | Opportunity Cost | — | 仅 A 有，且标注"后期" |
| — | — | LogisticsHealth | 仅 B 有 |
| — | — | TechProgress | 仅 B 有 |

### 2.2 差异分类

| 差异类型 | 维度 | 详情 |
|---------|------|------|
| **共同维度**（6 个） | Economic Growth, Resource Efficiency, CPU Efficiency, Survival, Expansion, Military Outcome | 两份文档名称/语义一致 |
| **仅 A 有**（3 个） | Risk Level, Recovery Cost, Opportunity Cost | A 是更详细的设计文档 |
| **仅 B 有**（2 个） | LogisticsHealth, TechProgress | B 是最终研究综合 |

---

## 三、权威判定

### 3.1 两份文档在 A6.0 体系中的定位

| 文档 | 定位 | 特征 |
|------|------|------|
| **文档 A** (`STRATEGY_EVALUATION.md`) | **专项设计文档** — 专门定义 Strategy Evaluation 的完整框架 | 包含完整的 `StrategyScore` / `DimensionScore` / `StrategyType` TypeScript 接口定义，包含每策略类型的评估方法（§3.1–3.7），包含评估频率表（§2.4），包含安全约束（§6）。 |
| **文档 B** (`FINAL_RESEARCH.md`) | **最终综合报告** — 12 份研究文档的综合摘要 | §3.4 是对策略评估框架的高度浓缩（1 个表格），明确标注"多维评估，不合并为万能分数"，但未包含接口定义。 |

### 3.2 权威判定

**文档 A（`A6_0_STRATEGY_EVALUATION.md`）在 Strategy Evaluation 维度定义上具有更高权威。**

理由：

1. **文档 A 是 Strategy Evaluation 的专项设计文档**，包含完整的接口定义、评估方法、评估频率、安全约束。文档 B 只是一份综合报告中的浓缩摘要。
2. **文档 A 的接口定义是 TypeScript 代码级契约**，而文档 B 只是概念性表格。当代码实现时，必须以接口定义为准。
3. **A6.0 Roadmap 明确将 A6.3 Strategy Evaluation 的验收标准映射到文档 A**：
   > A6.3 — Strategy Evaluation: 多维评估框架, 从 Experience + Memory 中提取 StrategyScore, 验收: INT-005
4. **文档 A 中 `StrategyScore.dimensions` 接口明确定义了 8 个必选维度 + 1 个可选维度**（opportunityCost 标注 `?`），这是代码级契约。
5. **文档 B 的 LogisticsHealth 和 TechProgress 可以归入文档 A 的已有维度**：
   - LogisticsHealth → 归入 Resource Efficiency（文档 A 已包含 "产能/消耗比" 来自 "economy.ts flow-accounting"，与 logistics 数据来源一致）
   - TechProgress → 归入 Economic Growth（RCL progress 是经济增速的子指标）或 Expansion（RCL 增速）

### 3.3 被排除的维度

| 被排除维度 | 来源 | 排除理由 |
|-----------|------|---------|
| **Opportunity Cost** | 文档 A §2.2 #9 | 文档 A 自身标注 "counterfactual（后期）" 且接口中标注 `optional`。A6.0 Roadmap 将 Counterfactual 放在 A6.9/A7。A6.2 不实现。 |
| **LogisticsHealth** | 文档 B §3.4 | 文档 A 的 Resource Efficiency 已覆盖（"产能/消耗比" 来自 "economy.ts flow-accounting"），且文档 A 的 `StrategyScore.dimensions` 接口中无此独立维度。将其归入 Resource Efficiency 的子指标。 |
| **TechProgress** | 文档 B §3.4 | 文档 A 的 Economic Growth 已覆盖（"empireHealth.energyScore delta" 包含 RCL progress 信号），且文档 A 接口中无此独立维度。将其归入 Economic Growth 的子指标。 |

---

## 四、CANONICAL_EVALUATION_DIMENSIONS

### 4.1 最终采用

**以文档 A（`A6_0_STRATEGY_EVALUATION.md` §2.2 + §2.3）为权威来源，取 8 个必选维度，排除 1 个可选维度（Opportunity Cost）。**

```typescript
/**
 * A6.2 Canonical Evaluation Dimensions — 策略评估的 8 个独立维度。
 *
 * 权威来源：A6_0_STRATEGY_EVALUATION.md §2.2 + §2.3
 * 仲裁文档：A6_2_CONTRACT_RESOLUTION.md
 *
 * 绝对禁止：
 *   - 不同模块使用不同维度集合
 *   - 将多维合并为单一万能分数
 *   - 使用此列表之外的维度名称
 *
 * Opportunity Cost (文档 A §2.2 #9) 被排除：
 *   文档 A 自身标注 "counterfactual（后期）" + 接口标注 optional。
 *   A6.0 Roadmap 将 Counterfactual 放在 A6.9/A7。
 *   A6.2 不实现。
 *
 * LogisticsHealth / TechProgress (文档 B §3.4) 被合并：
 *   LogisticsHealth → 归入 Resource Efficiency 子指标
 *   TechProgress → 归入 Economic Growth 子指标
 */
export const CANONICAL_EVALUATION_DIMENSIONS = [
  "economicGrowth",
  "resourceEfficiency",
  "cpuEfficiency",
  "riskLevel",
  "survival",
  "expansion",
  "militaryOutcome",
  "recoveryCost",
] as const;

export type EvaluationDimension =
  (typeof CANONICAL_EVALUATION_DIMENSIONS)[number];
```

### 4.2 维度详细定义

| # | 维度名 (canonical) | 定义 | 量化方法 | 数据来源 | A6.0 出处 |
|---|-------------------|------|---------|---------|----------|
| 1 | `economicGrowth` | 经济增长率 | empireHealth.energyScore delta | empire-health-system | A §2.2 #1 |
| 2 | `resourceEfficiency` | 资源利用效率 | 产能/消耗比 + logistics deliveryRate | economy.ts flow-accounting + logistics | A §2.2 #2（含 B 的 LogisticsHealth 子指标） |
| 3 | `cpuEfficiency` | CPU 消耗效率 | CPU/产出比 + bucket stability | CPU tier + telemetry | A §2.2 #3 |
| 4 | `riskLevel` | 风险水平 | 威胁指数 + 暴露面 | threat-assessment | A §2.2 #4 |
| 5 | `survival` | 生存能力 | 帝国健康度 + 恢复能力 | empire-health + recoveryStats | A §2.2 #5 |
| 6 | `expansion` | 扩张效果 | 新房存活率 + RCL 增速 | expansion-outcome events | A §2.2 #6（含 B 的 TechProgress 子指标） |
| 7 | `militaryOutcome` | 军事结果 | 胜率 + 损失比 | evaluateWarOutcome | A §2.2 #7 |
| 8 | `recoveryCost` | 恢复代价 | 恢复时间 + 资源消耗 | recovery-lifecycle | A §2.2 #8 |

### 4.3 被排除维度

| 被排除维度 | 排除理由 | 何时引入 |
|-----------|---------|---------|
| `opportunityCost` | 文档 A 标注"后期" + 接口标注 `optional`；A6.0 Roadmap 将 Counterfactual 放在 A6.9/A7 | A6.9 或 A7 |
| `logisticsHealth` | 已合并入 `resourceEfficiency` 子指标 | 不单独引入 |
| `techProgress` | 已合并入 `economicGrowth` 子指标 | 不单独引入 |

---

## 五、对后续阶段的影响

### 5.1 对 A6.3+ 的影响

| 阶段 | 影响 |
|------|------|
| A6.3 (Prediction) | 预测目标可基于 8 维中的子集，不影响维度定义 |
| A6.4 (Shadow Intelligence) | Shadow Evaluation 必须使用相同 8 维 |
| A6.5 (Adaptive Policy) | Recommendation 必须引用 8 维中的维度名 |
| A6.6+ | 不得新增维度除非走 ADR 修订 |

### 5.2 对 A6 Acceptance Criteria 的影响

| 验收项 | 影响 |
|--------|------|
| INT-003 (经济瓶颈识别) | ✅ `economicGrowth` + `resourceEfficiency` 覆盖 |
| INT-005 (策略效果评价) | ✅ 8 维覆盖，无万能分数 |
| INT-008 (Deterministic Replay) | ✅ 维度名固定，hash 确定 |
| INT-018 (置信度标注) | ✅ 每维度独立 confidence |

### 5.3 不影响 A6.0 冻结契约

本次仲裁不修改任何 A6.0 文档。它只是明确了在两份文档冲突时以哪份为准。后续代码实现以本文件的 `CANONICAL_EVALUATION_DIMENSIONS` 为唯一维度来源。

---

## 六、签核

| 检查项 | 结论 |
|--------|------|
| 两份文档原始定义已完整引用 | ✅ |
| 差异已逐项分析 | ✅ |
| 权威判定有明确理由 | ✅ |
| 最终 8 维已定义 | ✅ |
| 被排除维度有明确理由 | ✅ |
| 对 A6.3+ 影响已评估 | ✅ |
| 对 Acceptance Criteria 影响已评估 | ✅ |
| 不修改 A6.0 冻结文档 | ✅ |

---

> **仲裁完成**。`CANONICAL_EVALUATION_DIMENSIONS` 已签发。
> 后续所有 A6.2+ 代码只能使用此定义。
