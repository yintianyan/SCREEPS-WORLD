# A6.7 Final Research — Intelligence Pipeline 闭环审计与方向裁决

> **Phase**: 36
> **Date**: 2026-08-26
> **Status**: COMPLETE
> **Method**: 真实代码调用链追踪 + 全 repo grep + 冻结契约交叉验证 + 反事实分析

---

## 一、研究范围

本报告对 A6.7 进行完整的 Research / Gap Analysis / Architecture Audit，确定：
1. A6.7 到底应该解决什么问题
2. 是否会破坏 A5 + A6.0–A6.6 已冻结的架构边界
3. A6.7 的最小正确实现是什么

研究基于真实代码、真实调用链、真实数据结构，不依赖文件名、注释或设计文档的假设。

---

## 二、20 个关键问题

### Q1: A6.6 Recommendation 当前有没有真实 Consumer？

**没有。** 全 repo `src/` grep 确认：零个执行系统 import 或读取 `__recommendationCache`。A6.6 导出的 `getRecommendations()` / `getActiveRecommendationList()` / `printRecommendationDashboard()` 仅控制台手动调用，不进入 tick 执行路径。

### Q2: 如果没有，为什么？

A6.6 设计为 Shadow-Only（REC-001~014）。其 `shadowOnly: true` 和 `autoApply: false` 是 literal type，编译时强制。A6.0 冻结契约要求 A6 整体不进入执行链。这是设计意图，不是遗漏。

### Q3: A6.7 是否应该建立 Consumer？

**不应该建立执行 Consumer。** 但应该建立 **只读 Observability Consumer**（Dashboard / 汇总统计），让操作者能审阅 Intelligence 输出。执行消费违反冻结契约。

### Q4: 如果建立，Consumer 是否拥有 Decision Authority？

**否。** 任何只读 Consumer 都不拥有 Decision Authority。最终裁决权永远属于 A5 已有 Authority。

### Q5: 谁拥有最终决策权？

A5 已有 Decision Authority（23 项，详见 `DECISION_AUTHORITY_MATRIX.md`）：
- `posture.ts` — 唯一 posture 裁决
- `spawn-manager.ts` — 唯一 `spawnCreep` 调用者
- `war-planner.ts` — 唯一进攻执行
- `recovery-execution-system.ts` — 唯一 RecoveryAction 执行
- 等等

A6 Intelligence 永远不能成为执行权威。

### Q6: A6.7 是否会形成第二套 Strategy？

**否。** A6.7 不创建 Strategy / Policy / Posture / Directive。CON-007 禁止。

### Q7: 是否会形成第二套 Metrics？

**否。** A6.7 不创建新 Metrics 系统。A6.7 只汇总已有 A6.1–A6.6 输出。CON-010 禁止。

### Q8: 是否会形成第二套 Decision Authority？

**否。** A6.7 零 Decision Authority。CON-008 禁止。不创建 `RecommendationAuthority` / `IntelligenceAuthority` / `AIOverrideAuthority` / `MetaStrategyAuthority`。

### Q9: A6 是否已经形成完整 Learning Loop？

**没有。** 当前 A6 是 Observation / Evaluation / Recommendation Loop，不是完整 Learning Loop。

完整 Learning Loop 需要：`Recommendation → Action → Outcome → Experience → … → Recommendation`。

从 Recommendation 到 Action 的链接缺失。

### Q10: 如果没有，缺失的是哪一段？

**缺失段：Recommendation → Action。**

没有执行系统读取 Recommendation 并据此采取行动。这是 A6.0 Shadow-Only 冻结契约的直接结果——设计上故意缺失。

### Q11: 是否值得补？

**不值得在当前架构下补。** 原因：
1. 补齐需要 Recommendation 被执行系统消费 → 违反 REC-006
2. 执行系统需要根据 Recommendation 改变行为 → 创建新 Decision Authority
3. 或创建中间仲裁层 → 违反 A6.0 冻结契约
4. Screeps 的 CPU/Memory 约束使得 RL/online training 不现实
5. 数据量不足（2 个 Prediction Model，冷启动期长）

### Q12: Recommendation 是否应该允许自动执行？

**绝对不应该。** 自动执行违反：
- A6.0 Shadow-Only 冻结契约
- REC-006 No Execution Leak
- REC-008 No Decision Authority
- REC-011 No Auto Apply
- Decision Authority Matrix（会创建新 Authority）

### Q13: 如果不允许，下一阶段真正有价值的消费方式是什么？

**只读 Observability + 操作者审阅。**

1. Dashboard 增强 — 让操作者能看到 Recommendation + IntelligenceState + Conflict 汇总
2. 只读查询接口 — 让已有 Authority **可选择性地**只读参考（但最终裁决权不变）
3. 历史趋势 — supersede 链统计，帮助操作者理解 Intelligence 质量

### Q14: Prediction Calibration 是否应该参与 Recommendation 生命周期？

**已经参与。** A6.6 `generateRecommendations()` 已读取 A6.4 CalibrationProfile：
- `dataSufficient` 来自 A6.5 `IntelligenceState.dataSufficiency`
- `regimeCompatible` 来自 A6.5 `IntelligenceState.regimeFit`
- confidence 计算考虑 evidence 完整性、数据充足性、Regime 兼容性

这是局部闭环（模型校准影响 Recommendation confidence），不是策略学习闭环。

### Q15: Reliability 是否应该阻止低可信 Recommendation？

**已经阻止。** A6.6 `generateRecommendations()` 前置检查：
- `trace.minConfidence < MIN_CONFIDENCE_THRESHOLD(0.1)` → NO_RECOMMENDATION
- `confidence < MIN_CONFIDENCE_THRESHOLD` → NO_RECOMMENDATION

这是 A6.6 已实现的能力，不需要 A6.7 补充。

### Q16: 是否需要 Shadow Simulation？

**不需要。** 原因：
1. Screeps 无原生 Simulation 框架
2. 需要完整 World State 快照 + Action 模拟 → 成本极高
3. Simulation 可能引入非确定性
4. 收益不明确（当前 2 个 Prediction Model）
5. 可以用 A6.4 Calibration 已有的 Resolution 机制替代（真实 Outcome 验证 > 模拟 Outcome）

### Q17: 是否需要 Human Review Boundary？

**不需要单独建立。** Screeps 的操作者接口是 `console.log` + `console` 命令。A6.7 增强的 Dashboard 输出就是 Human Review Boundary。操作者可以：
- 查看 Dashboard（console.log 每 5000t）
- 调用 `printFullDashboard()` 获取实时摘要
- 通过 `console` 命令执行人工接管（灾难恢复）

不需要额外的 UI 审批通道。

### Q18: A6.7 是否需要修改 A5？

**不需要。** A5 执行系统全部 FROZEN。A6.7 不修改任何 A5 模块。

### Q19: A6.7 是否需要修改 A6.1–A6.6 冻结契约？

**不需要。** A6.1–A6.6 全部 FROZEN。A6.7 只新增只读消费层，不修改任何冻结模块。

### Q20: 最终 A6.7 的最小正确实现是什么？

**Recommendation Consumption Boundary & Observability Enhancement：**

1. Domain 层纯函数（汇总统计 + Dashboard 格式化）
2. System 层薄壳（低频 console.log 输出）
3. 不创建新 cache 字段
4. 不修改任何冻结模块
5. 不创建新 Decision Authority
6. 不自动执行任何 Recommendation
7. 14 个 CON 守卫确保安全
8. ~15-20 个单元测试
9. bootstrap 新增 1 行注册

**预计代码量：~350 行 + ~20 测试**

---

## 三、Counterfactual Scenarios（15 个）

### CF-01: Recommendation 正确，但不能自动执行

- 输入：A6.6 产出 critical urgency 的 spawn-starvation Recommendation
- Intelligence 输出：`RecommendationCandidate { shadowOnly: true, autoApply: false }`
- 允许进入执行层：**否**
- Decision Authority：`spawn-manager.ts`
- 最终行为：spawn-manager 按自身逻辑决策
- 安全性：✅ 安全

### CF-02: Recommendation 错误，不能污染 Runtime

- 输入：A6.6 产出错误 Recommendation
- Intelligence 输出：`RecommendationCandidate`
- 允许进入执行层：**否**
- Decision Authority：对应 A5 Authority
- 最终行为：不受影响
- 安全性：✅ 错误被隔离

### CF-03: Prediction confidence 很低

- 输入：confidence < threshold
- Intelligence 输出：`NO_RECOMMENDATION { reason: "LOW_CONFIDENCE" }`
- 允许进入执行层：**否**
- Decision Authority：无
- 安全性：✅ 自动降级

### CF-04: Calibration 显示模型不可靠

- 输入：ECE > 0.3, drift detected
- Intelligence 输出：posture Recommendation urgency=low
- 允许进入执行层：**否**
- Decision Authority：`posture.ts`
- 安全性：✅ drift 被记录

### CF-05: IntelligenceState 与 Recommendation 冲突

- 输入：dataSufficiency.sufficient=false 但有 Recommendation
- Intelligence 输出：confidence 降权 0.5× → 可能 NO_RECOMMENDATION
- 允许进入执行层：**否**
- 安全性：✅ 自动降级

### CF-06: 多个 Recommendation 相互冲突

- 输入：expansion + recovery 冲突
- Intelligence 输出：`RecommendationConflict { type: "resource_competition" }`
- 允许进入执行层：**否**（只检测不解决）
- Decision Authority：无
- 安全性：✅ 冲突暴露但不自动解决

### CF-07: Recommendation 过期

- 输入：TTL 到期
- Intelligence 输出：`lifecycle: "expired"`
- 允许进入执行层：**否**
- 安全性：✅ 自动过期

### CF-08: Regime 发生变化

- 输入：posture 从 develop 变为 war
- Intelligence 输出：旧 Recommendation 全部 expired
- 允许进入执行层：**否**
- Decision Authority：`posture.ts`
- 安全性：✅ Regime 变化触发失效

### CF-09: Evidence 不完整

- 输入：缺少 CALIBRATED 阶段
- Intelligence 输出：`NO_RECOMMENDATION { reason: "INSUFFICIENT_EVIDENCE" }`
- 安全性：✅ 不产出

### CF-10: Experience 数据不足

- 输入：冷启动，`__experienceCache` 为空
- Intelligence 输出：`NO_RECOMMENDATION`
- 安全性：✅ 冷启动安全

### CF-11: A6 完全停止

- 输入：全部 A6 系统移除
- Intelligence 输出：无
- Decision Authority：A5 全部正常运行
- 安全性：✅ A6 Shutdown Safety

### CF-12: A6 Cache 损坏

- 输入：`__recommendationCache` 被写入非法数据
- Intelligence 输出：A6.6 可能 throw → safeRun 隔离
- 安全性：✅ safeRun 隔离

### CF-13: A5 Decision 与 A6 Recommendation 冲突

- 输入：A6.6 建议扩张，A5 posture=fortify
- 允许进入执行层：**否**
- Decision Authority：`posture.ts`（fortify 优先）
- 安全性：✅ A5 Authority 不被覆盖

### CF-14: Legacy/Fallback 路径存在

- 输入：war-planner fallback 到 legacy
- Intelligence 输出：A6.6 不参与 fallback
- 安全性：✅ A6.6 与 war-planner 完全隔离

### CF-15: 未来增加新的 Prediction Model

- 输入：新增第 3 个 Prediction Model
- Intelligence 输出：A6.5 `predictionCoverage.implementedModels` 增加；A6.6 evidence-builder 自动消费新 Prediction
- 允许进入执行层：**否**
- 安全性：✅ 新 Model 自动被 A6 Pipeline 消费，不影响 A5

---

## 四、Implementation Phases（拟）

| Phase | 内容 | 预计行数 | 测试数 |
|-------|------|----------|--------|
| Phase 1 | Domain 类型 + Summary 纯函数 | ~150 | ~10 |
| Phase 2 | Dashboard 格式化纯函数 | ~100 | ~5 |
| Phase 3 | System 薄壳 + bootstrap 注册 | ~80 | ~3 |
| Phase 4 | 守卫函数 + 确定性验证 | ~50 | ~5 |
| 总计 | | ~380 | ~23 |

---

## 五、Technical Debt

| 编号 | 描述 | 严重度 | 处理 |
|------|------|--------|------|
| TD-A67-01 | A6.6 TD-A66-04 未解决（system 层直接访问 globalThis.Game） | LOW | A6.7 不修复（属于 A6.6 技术债） |
| TD-A67-02 | 4 个 NO_RECOMMENDATION 枚举未使用 | LOW | A6.7 不修复（属于 A6.6 技术债） |
| TD-A67-03 | A5 `tacticalSupplyDemands` 无消费者（A5 Gap） | LOW | A6.7 不修复（属于 A5 技术债） |

---

## 六、Final Verdict

### A6.7 最终定位

**Recommendation Consumption Boundary & Observability Enhancement**

### 是否值得实施

**值得实施，但价值有限。** A6.7 是 A6 Intelligence Pipeline 的"最后一公里"可观测性增强，不是新 Intelligence 能力。它不补齐 Learning Loop，不创建新 Authority，不自动执行 Recommendation。

### 核心架构决策

1. A6.7 = 只读 Observability Layer
2. 不创建新 Decision Authority
3. 不修改任何冻结契约
4. 不自动执行 Recommendation
5. 价值在于让操作者能审阅 Intelligence 输出

### 是否存在 BLOCKER

**无 BLOCKER。** 所有前置条件已满足。

### 是否需要修改冻结契约

**不需要。** A6.1–A6.6 和 A5 全部 FROZEN，A6.7 不修改任何冻结模块。

### 推荐实施顺序

1. Domain 纯函数（Summary + Dashboard 格式化）
2. System 薄壳 + bootstrap 注册
3. 守卫 + 测试

### 生成的文档清单

| 文档 | 路径 |
|------|------|
| A6_7_GAP_ANALYSIS.md | `docs/phase36/A6_7_GAP_ANALYSIS.md` |
| A6_7_ARCHITECTURE.md | `docs/phase36/A6_7_ARCHITECTURE.md` |
| A6_7_SAFETY_BOUNDARY.md | `docs/phase36/A6_7_SAFETY_BOUNDARY.md` |
| A6_7_ACCEPTANCE.md | `docs/phase36/A6_7_ACCEPTANCE.md` |
| A6_7_FINAL_RESEARCH.md | `docs/phase36/A6_7_FINAL_RESEARCH.md`（本文件） |

---

## 七、研究结论

A6 Intelligence Pipeline（A6.0–A6.6）已形成一个功能完整但完全孤立的 Shadow Observation/Evaluation/Recommendation 系统。它**不参与运行时决策**，**不影响帝国行为**，**不被任何执行系统消费**。

这是**设计意图**，不是缺陷。A6.0 冻结契约明确要求 A6 整体 Shadow-Only。

A6.7 的正确做法是**承认这个设计意图**，不强行补齐 Learning Loop（这会违反冻结契约），而是建立安全的只读消费边界和增强可观测性，让操作者能审阅 Intelligence 输出。

**如果未来需要补齐 Learning Loop，必须先走 ADR 修订 A6.0 冻结契约，而不是在 A6.7 中偷偷创建执行路径。**

---

## 八、FREEZE 建议

如果研究认为 A6.7 当前没有足够价值（Observability Enhancement 价值有限），建议：

**FREEZE A6.7 — 不实施新功能，仅保留 A6.6 已有的 `printRecommendationDashboard()` 控制台函数。**

理由：
1. A6.6 已有基础 Dashboard 输出（每 5000t console.log）
2. A6.7 的 Observability Enhancement 是"nice to have"而非"must have"
3. CPU/Memory 虽然极小，但仍非零
4. 当前 A6 Pipeline 的 2 个 Prediction Model 产出有限，Dashboard 内容可能稀疏

**但如果操作者明确需要更丰富的 Intelligence 审阅能力，则 A6.7 可实施。**

### 最终建议

**CONDITIONAL GO** — 如果操作者确认需要增强 Intelligence 可观测性，则实施 A6.7（~380 行 + ~23 测试）。否则 **FREEZE**。
