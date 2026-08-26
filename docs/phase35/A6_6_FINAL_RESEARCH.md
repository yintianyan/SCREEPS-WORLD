# A6.6 Final Research — 最终研究报告

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码
> **基线**: A6.1-A6.5 已 FROZEN_WITH_TECHNICAL_DEBT + 全部 A6.6 研究文档

---

## 一、研究文档清单

| # | 文档 | 内容 |
|---|------|------|
| 1 | A6_6_RECOMMENDATION_GAP_ANALYSIS.md | Gap 分析、输入审计、最大风险 |
| 2 | A6_6_DECISION_AUTHORITY.md | 现有 Decision Authority 完整矩阵、权限矩阵、Consumption Boundary |
| 3 | A6_6_RECOMMENDATION_CATALOG.md | 8 类 Recommendation 评估、优先级排序 |
| 4 | A6_6_EVIDENCE_MODEL.md | Evidence Chain、EvidenceItem 类型、Confidence 传播规则 |
| 5 | A6_6_CONFLICT_MODEL.md | 冲突类型、RecommendationConflict、NO_RECOMMENDATION |
| 6 | A6_6_LIFECYCLE.md | 6 态生命周期、TTL、Supersede、GC |
| 7 | A6_6_SAFETY_BOUNDARY.md | Shadow-Only、14 个 REC 守卫、退化防护 |
| 8 | A6_6_CPU_MEMORY_CONTRACT.md | CPU/Memory 预算、Bounded Memory、降级合同 |
| 9 | A6_6_DETERMINISM_CONTRACT.md | 确定性原则、Lexicographic ranking、Hash 确定性 |
| 10 | A6_6_ACCEPTANCE_CRITERIA.md | 验收标准、测试覆盖、质量门槛 |
| 11 | A6_6_ARCHITECTURE.md | 架构设计、Domain/System 分层、类型定义、10 个反事实 |
| 12 | **A6_6_FINAL_RESEARCH.md**（本文） | 20 个问题回答 + 最终裁决 |

---

## 二、20 个最终问题回答

### Q1: A6.6 到底应该推荐什么？

**回答**: A6.6 应该基于 A6.1-A6.5 的 Canonical Intelligence Evidence，产出 8 类 Recommendation（Economic / Expansion / Defense / Military / Logistics / Spawn / Recovery / Posture）。每条 Recommendation 携带完整 Evidence Chain，可解释、可审计、可反事实验证。

### Q2: A6.6 不应该推荐什么？

**回答**: A6.6 不应该推荐"必须执行某个具体行动"。不应产出 Strategy / Policy / Posture / Directive / ExecutionPlan / SpawnPlan / MilitaryPlan / LogisticsPlan。不应裁决冲突。不应选择行动。不应自动执行。

### Q3: A6.6 与 Strategy 的边界是什么？

**回答**: Strategy = Policy 纯函数（posture.ts）唯一裁决 posture + budget。A6.6 只读消费 posture 状态作为 contextSignature，不修改 posture，不修改 budget，不修改 agenda。A6.6 可产出 Posture Recommendation（如"考虑收缩到 fortify"），但 Policy 是唯一裁决者。

### Q4: A6.6 与 Planner 的边界是什么？

**回答**: Planner（logistics-planner / expansion-planner / war-planning-system）是执行层规划器。A6.6 不规划执行序列，不提交 TransportRequest，不提交 AgendaItem，不产出 WarPlan。A6.6 产出的是建议（"考虑做 X"），不是计划（"执行步骤 1,2,3"）。

### Q5: A6.6 与 Prediction 的边界是什么？

**回答**: Prediction 回答"未来可能发生 X"。Recommendation 回答"如果目标是避免 X，可以考虑 Y"。A6.6 消费 A6.3 的 Prediction 作为 Evidence，不重新计算 Prediction。低 confidence Prediction 不能产生高 confidence Recommendation（recommendation.confidence ≤ 最低 evidence confidence）。

### Q6: A6.6 与 Reliability 的边界是什么？

**回答**: A6.5 回答"当前 Intelligence 是否可信？"。A6.6 使用 IntelligenceState 作为 Evidence / confidence factor。A6.6 不修改 Reliability，不重新计算 Reliability，不忽略 Reliability 低的模型（而是降级 Recommendation confidence）。Evidence Quality + Prediction Calibration + Regime Compatibility + Attribution Confidence 共同影响 Recommendation Confidence。

### Q7: Recommendation 是否可以被排序？

**回答**: 可以。但必须使用 Lexicographic ranking（5 级：urgency → confidence → category → target → recommendationId），不使用万能 Score。禁止 `if score > 0.8 then recommendAction()`。

### Q8: 如果可以，如何避免万能 Score？

**回答**: 禁止 `recommendationScore` / `overallRecommendationScore` / `intelligenceScore` / `strategyScore` 字段。使用 5 级 Lexicographic ranking 排序。Recommendation 是多维 Evidence，不是单一分数。REC-009 守卫强制检查。

### Q9: 多个 Recommendation 冲突怎么办？

**回答**: A6.6 检测冲突并标记在 Recommendation.conflicts[] 中，不裁决。冲突降级所有参与方 confidence。如果降级后低于阈值，转为 NO_RECOMMENDATION。A6.6 不按 confidence 选择"赢"的 Recommendation，不隐藏低 confidence 的 Recommendation。产出所有冲突的 Recommendation + 冲突标记，由上层 Decision Authority 裁决。

### Q10: Evidence 不足怎么办？

**回答**: 产出 NO_RECOMMENDATION（reason=INSUFFICIENT_EVIDENCE）。不伪造 Evidence。标记 DATA_GAP。含 DATA_GAP 证据的 Recommendation confidence 降级。这是系统的"诚实"——能说"我不建议"比强行输出低质量建议更重要。

### Q11: Prediction 不可靠怎么办？

**回答**: A6.4 Calibration 提供 calibrationVerdict 和 ece。如果模型 OVERCONFIDENT，calibratedConfidence = rawConfidence × calibrationMultiplier (< 1)。Recommendation 使用 calibratedConfidence。如果 calibration 不可用（冷启动），使用 raw confidence 但标注 "uncalibrated"。

### Q12: Calibration 差怎么办？

**回答**: A6.5 Reliability 评估包含 calibrationHealth。如果 calibrationHealth = DRIFT_DETECTED 或 STALE，Recommendation confidence × reliabilityFactor。如果 sampleSufficiency = INSUFFICIENT，confidence × 0.5。如果 regimeFit = false，confidence × 0.7。综合后如果 < 0.3，NO_RECOMMENDATION。

### Q13: Regime 改变怎么办？

**回答**: Recommendation 的 contextSignature 记录生成时 Regime。如果当前 Regime 不同：confidence 降级（× 0.5）。如果 Regime 变化涉及 posture 切换（如 peace → war），Recommendation 直接失效（status → expired, reason: regime_changed）。这确保过期的 Regime 建议不被消费为当前建议。

### Q14: External Interference 怎么办？

**回答**: A6.1 Attribution 标注 hasExternalFactor=true。A6.6 在 Evidence 中标注 "external interference detected"。Recommendation confidence 不归因于策略效果——只表达"当前证据支持考虑 X"，不表达"做 X 一定能改善 Y"。

### Q15: Recommendation 何时过期？

**回答**: TTL 到期（category-specific: 300-2000t）；Regime 变化（特别是 posture 切换）；上游 Prediction 过期（recommendation.expiresTick ≤ prediction.endTick）；Superseded（同 category+target 的新版本产出）。过期 Recommendation 不得被消费为当前建议。

### Q16: Recommendation 是否应该持久化？

**回答**: 不应该持久化到 Memory / RawMemory。推荐方案是 B — Bounded Recommendation Cache（heap only, capacity=50, TTL+GC, global reset 可丢）。理由：持久化会创建"第二套状态"，引入一致性维护成本；每次运行时重新计算比维护一致性更安全。

### Q17: Recommendation 是否需要历史记录？

**回答**: 需要有限的历史记录（bounded cache, 50 条, maxAge=5000t）。用于：调试（理解为什么建议 X）、审计（追溯建议链）、反馈循环（A6.1 可消费 Accepted Recommendation 作为 Experience）。但不需要无界历史。Supersede 链深度 ≤ 3。

### Q18: A6.6 是否应该写 Cache？

**回答**: 是，写入 `__recommendationCache`（bounded, shadow-only）。这是 A6.6 唯一允许的写入目标。与 A6.5 不同（A6.5 不写入任何 cache），A6.6 需要写入自身 bounded cache，因为 Recommendation 有生命周期（TTL, Supersede, GC），需要跨 tick 追踪状态。但不写入 Memory / globalCache 业务字段。

### Q19: A6.6 停止后 A6.1-A6.5 是否完全不受影响？

**回答**: 是。验证方法：关闭 recommendation-engine-system 运行 5000t。A6.1-A6.5 全部正常（它们不依赖 A6.6 的任何输出）。帝国安全运行（无执行系统读取 A6.6 输出）。A6.6 是纯 shadow 层，停止等于少了一个观察者，不影响任何运行路径。

### Q20: A6.6 是否可以安全进入 Implementation？

**回答**: **是。** 满足全部 10 个条件：
1. ✅ 没有 Decision Authority 冲突（A6.6 不拥有任何决策权）
2. ✅ 没有 Execution Path（无执行系统读取 A6.6 输出）
3. ✅ Evidence Model 完整（EvidenceItem + Evidence Chain + Confidence 传播）
4. ✅ Conflict Model 完整（3 种冲突层级 + NO_RECOMMENDATION）
5. ✅ Lifecycle 完整（6 态 + TTL + Supersede + GC）
6. ✅ Safety Boundary 完整（14 个 REC 守卫 + 退化防护）
7. ✅ CPU / Memory 可控（~0.25ms/run, ~55KB cache, P3, 500t interval）
8. ✅ Determinism 可证明（Lexicographic ranking + FNV-1a hash + 1000× replay）
9. ✅ Acceptance Criteria 可测试（6 类标准 + 61 个测试）
10. ✅ 不修改 A6.1-A6.5 冻结契约（只读 import）

---

## 三、最终裁决

# READY_FOR_IMPLEMENTATION

---

## 四、裁决依据

### 4.1 无 BLOCKER

| 条件 | 结果 |
|------|------|
| Decision Authority 冲突 | FALSE — A6.6 不拥有任何决策权 |
| Execution Path 存在 | FALSE — 无执行系统读取 A6.6 输出 |
| Evidence Model 不完整 | FALSE — 完整的 EvidenceItem + Chain + Confidence 传播 |
| Conflict Model 不完整 | FALSE — 3 种冲突层级 + NO_RECOMMENDATION |
| Lifecycle 不完整 | FALSE — 6 态 + TTL + Supersede + GC |
| Safety Boundary 不完整 | FALSE — 14 个 REC 守卫 + 退化防护 |
| CPU/Memory 不可控 | FALSE — ~0.25ms, ~55KB, P3, 500t |
| Determinism 不可证明 | FALSE — Lexicographic ranking + FNV-1a + replay |
| Acceptance Criteria 不可测试 | FALSE — 6 类标准 + 61 个测试 |
| 修改 A6.1-A6.5 冻结契约 | FALSE — 只读 import |

**All BLOCKER conditions are FALSE. A6.6 is safe to implement.**

### 4.2 实现路线图

| 批次 | 内容 | 依赖 |
|------|------|------|
| Phase 1 | Domain 层类型定义 + Evidence Builder + Generator（Economic + Expansion） | A6.1-A6.5 已冻结 |
| Phase 2 | Conflict Detector + Lifecycle Manager + Ranking + Hashing | Phase 1 |
| Phase 3 | System 层薄壳 + bootstrap 注册 + 14 个 REC 守卫 | Phase 2 |
| Phase 4 | 扩展到 Defense + Spawn + Recovery | Phase 3 |
| Phase 5 | 扩展到 Military + Logistics + Posture | Phase 4 |
| Phase 6 | 全量测试 + 确定性验证 + CPU/Memory 基准 | Phase 5 |

### 4.3 实现约束

- 不修改 A6.1-A6.5 的任何文件
- 不修改 bootstrap.ts 的现有注册（只新增）
- 不修改 globalCache 的现有字段（只新增 `__recommendationCache`）
- 不修改任何执行系统
- 不修改任何测试文件（只新增 A6.6 测试）

---

## 五、核心原则重申

**A6.6 不是来设计一个"聪明的自动决策器"。**

A6.6 是在设计：

> 一个能够基于历史经验、预测质量、可靠性和上下文，
> 提供可解释、可审计、可反事实验证的行动建议层。

它可以告诉上层：

> "我建议考虑 X，因为证据 A/B/C 支持它。"

但绝不能说：

> "我决定执行 X。"

**A6.6 的核心不是 Action。**

**而是：Evidence-backed Recommendation。**
