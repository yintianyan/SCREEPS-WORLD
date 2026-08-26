# A6.5 Final Research — 研究总结

> **研究阶段**: A6.5 Research  
> **日期**: 2026-08-26  
> **禁止实现**: 本文档是研究总结，不修改任何代码  
> **基线**: A6.1-A6.4 已冻结契约 + 真实代码审计 + A6.5 全部研究文档

---

## 一、研究结论

### 1.1 A6.5 是什么？

**A6.5 = Reliability Assessment & Intelligence State**

在 A6.1（Experience）、A6.2（Evaluation）、A6.3（Prediction）、A6.4（Calibration）之后，A6.5 回答：

> "系统知道自己的预测能力之后，如何形成可靠、可解释、具有时效性、具有 Regime 意识、能够处理不确定性和冲突的 Intelligence？"

A6.5 不是增加 Prediction Model。A6.5 是在 Prediction 和 Calibration 之上，评估模型的**可靠性**和系统整体 Intelligence 的**健康状态**。

### 1.2 A6.5 回答的 5 个核心问题

| 问题 | 回答来源 | 当前能力 | A6.5 新增 |
|------|---------|---------|----------|
| "模型的预测在过去有多可靠？" | A6.4 CalibrationProfile | ✅ 已回答 | — |
| "模型在不同 Regime 下是否同样可靠？" | A6.5 Regime Fit | ❌ 无法回答 | ✅ Regime 分区 + Fallback |
| "模型最近是否在退化？" | A6.5 Temporal Drift | ❌ 无法回答 | ✅ Rolling Window + ECE 对比 |
| "多个模型同时产出矛盾预测时，系统是否意识到？" | A6.5 Conflict Detection | ❌ 无法回答 | ✅ 逻辑冲突 + Temporal + Regime |
| "系统整体 Intelligence 是否充足、新鲜、一致？" | A6.5 IntelligenceState | ❌ 无法回答 | ✅ 多维聚合投影 |

### 1.3 核心原则

1. **Shadow-Only** — 只观察、只评估、只聚合、只暴露；禁止决策、执行、修改
2. **不新建数据源** — 只消费 A6.1-A6.4 既有数据
3. **不建万能 Score** — 多维 IntelligenceState，非单一分数
4. **不修改 A6.1-A6.4** — 只读消费
5. **Bounded Memory** — 复用 Ring Buffer，IntelligenceState 不持久化
6. **Deterministic** — stableStringify + FNV-1a，100× replay 验证
7. **P3 Post Phase** — 低频执行（每 500t），不进入 tick 关键路径

---

## 二、研究文档清单

### 2.1 已完成的研究文档

| 文档 | 内容 | 关键结论 |
|------|------|---------|
| `A6_5_GAP_ANALYSIS.md` | Gap 分析 | 识别 10 个 Gap + 4 个架构 Gap + 3 个依赖 Gap |
| `A6_5_INTELLIGENCE_MODEL.md` | 概念定义 | 定义 Intelligence / Reliability / Uncertainty / Freshness 等核心概念 |
| `A6_5_RELIABILITY_ARCHITECTURE.md` | 可靠性架构 | Regime 分区（二级索引）+ Temporal Drift（Rolling Window + Historical 对比）+ Data Sufficiency 聚合 + Uncertainty 聚合 |
| `A6_5_CONFLICT_ANALYSIS.md` | 冲突分析 | 4 种冲突类型（逻辑/Temporal/Evidence/Regime）+ 逻辑矛盾对规则 + Shadow-Only 检测 |
| `A6_5_SAFETY_BOUNDARY.md` | 安全边界 | REL-001 ~ REL-012 守卫 + 写入隔离矩阵 + 退化防护 + System 层约束 |
| `A6_5_COUNTERFACTUALS.md` | 反事实场景 | CF-1 ~ CF-15 场景覆盖 Regime/Temporal/Conflict/IntelligenceState 全路径 |
| `A6_5_ARCHITECTURE.md` | 架构设计 | Domain 层结构 + 函数签名 + Guard 定义 + 数据流 + 常量 + 复杂度估算 |
| `A6_5_ACCEPTANCE.md` | 验收标准 | D1-D6 六大维度 + 守卫测试 + E2E 验收 + 质量门槛 |
| `A6_5_ROADMAP.md` | 路线图 | S1-S10 十个阶段 + 依赖图 + 里程碑 + 风险缓解 |

---

## 三、核心发现

### 3.1 A6.4 CalibrationProfile 的关键缺陷

**发现**: `ModelCalibrationProfile` 按 `modelKey` 索引，不区分 Regime。它能回答 "模型在所有历史中准不准"，但不能回答 "在当前条件下是否可信"。

**影响**: confidence=0.8 的预测在 RCL1-peace 和 RCL8-war 下使用同一个 Profile，但这两个 Regime 下模型的可靠性可能天差地别。

**解决**: A6.5 引入 Regime-specific Profile（二级索引 + Fallback 策略）。

### 3.2 两套 ContextSignature 不一致

**发现**: A6.2 Baseline 和 A6.3 Prediction 使用了两套不完全一致的 ContextSignature 编码逻辑。

- Baseline: `rclRange-roomRange-threat`（3 维度）
- Prediction: `posture-watchdogTier-roomRange-rclRange-threat`（5 维度）

**建议**: A6.5 统一使用 Prediction ContextSignature（更丰富），通过映射函数兼容 Baseline。

### 3.3 IntelligenceState 不需要持久化

**发现**: IntelligenceState 的所有输入数据已经在 A6.1-A6.4 的 Ring Buffer 中持久化。每次需要时重新计算 < 1 ops/t，比维护一致性更安全。

**结论**: IntelligenceState 是**只读投影**，不写入 globalCache，不写入 Memory。生命周期 = 1 tick。

### 3.4 A6.5 是第一个不写入任何 cache 的 System

**发现**: A6.1-A6.4 的 System 层都写入各自的 cache。A6.5 的 System 层是**第一个不写入任何 cache 的 System**。

**意义**: 这意味着 A6.5 的安全约束比 A6.4 更严格 — 从"限制写入目标"（CAL-001）到"禁止写入"（REL-001）。

### 3.5 冲突检测的 Shadow-Only 原则

**发现**: 冲突检测最容易演变为冲突解决。检测到 "Energy Shortage + Expansion Readiness" 冲突后，最自然的下一步是 "取消扩张"。

**约束**: A6.5 必须严格只检测和标记冲突，不解决冲突。REL-011 守卫禁止代码包含 `selectHighest` / `resolveConflict` / `applyWeight` 等冲突解决逻辑。

---

## 四、Gap 清单总结

### 4.1 识别的 Gap

| Gap | 严重度 | A6.5 解决方式 |
|-----|--------|-------------|
| Gap-1: CalibrationProfile 不区分 Regime | HIGH | Regime-specific Profile（二级索引 + Fallback） |
| Gap-2: 无 Temporal Reliability 追踪 | HIGH | Rolling Window + Historical 对比 |
| Gap-3: 无 Cross-Model Conflict Detection | MEDIUM | 逻辑冲突规则 + Shadow-Only 检测 |
| Gap-4: 无 Intelligence State 聚合 | MEDIUM | IntelligenceState 只读投影 |
| Gap-5: 无 Model Degradation Detection | MEDIUM | Drift Detection（ECE 对比） |
| Gap-6: 无 Data Sufficiency 聚合 | LOW | DataSufficiencySummary 聚合 |
| Gap-7: 无 Evidence Aging 机制 | MEDIUM | FreshnessSummary + Profile Stale 检测 |
| Gap-8: 无 Knowledge Persistence | LOW | 不解决（设计原则允许 heap 丢失） |
| Gap-9: 无 Adaptive Model Weighting | MEDIUM | 不解决（A6.6 职责） |
| Gap-10: 无 Forecast Consistency Check | LOW | Temporal Conflict Detection |

### 4.2 架构 Gap

| Arch Gap | 解决方式 |
|----------|---------|
| Gap-A: CalibrationProfile 不支持 Regime 分区 | 二级索引 + Fallback |
| Gap-B: 无 Rolling Calibration 窗口 | 复用 Ring Buffer + getRecentResolutions() |
| Gap-C: 无 Cross-Model 一致性检查 | 纯函数 detectConflicts() |
| Gap-D: 无 Intelligence State 聚合 | 只读投影 computeIntelligenceState() |

---

## 五、安全约束总结

### 5.1 REL-001 ~ REL-012 守卫

| Guard | 名称 | 关键约束 |
|-------|------|---------|
| REL-001 | Read-Only | 不写入任何 cache（比 CAL-001 更严格） |
| REL-002 | Domain Purity | 不引用 Game/Memory |
| REL-003 | No Game API | 不调用 Game API |
| REL-004 | No Runtime Mutation | 不修改运行时状态 |
| REL-005 | Deterministic | 相同输入 → 相同输出 |
| REL-006 | Bounded Memory | IntelligenceState 不持久化 |
| REL-007 | No New Sampler | 不新建采样通道 |
| REL-008 | No Second Metrics | 不采集新 Metrics |
| REL-009 | No Strategy Mutation | 不修改 Strategy/Posture/Spawn |
| REL-010 | Evidence Traceability | 可追溯到上游 |
| REL-011 | No Conflict Resolution | 不裁决冲突（新增） |
| REL-012 | No Reliability Score | 不产出万能分数（新增） |

### 5.2 退化防护

| 退化路径 | 防护守卫 |
|---------|---------|
| 权重裁决 | REL-011 |
| 冲突解决 | REL-011 |
| 策略决策 | REL-009 |
| 模型选择 | REL-008 |
| 万能分数 | REL-012 |

---

## 六、IntelligenceState 结构总结

```
IntelligenceState (只读投影，不持久化)
├── predictionCoverage        — 预测覆盖（2/7 模型已实现）
├── modelReliability[]        — 各模型可靠性评估
│   ├── regimeProfileAvailable
│   ├── profileSource         — REGIME / FALLBACK_GLOBAL / NONE
│   ├── calibrationVerdict
│   ├── ece / brierScore
│   ├── driftDetected / driftDirection
│   └── sampleSufficiency
├── calibrationHealth        — 校准健康度
│   ├── status               — HEALTHY / DRIFT_DETECTED / STALE / ...
│   ├── driftDirection
│   └── profileStale
├── dataSufficiency           — 数据充足性
│   ├── sufficient
│   ├── totalResolutions
│   └── modelsWithSufficientData
├── regimeFit                 — Regime 适配
│   ├── currentRegimeMatched
│   └── modelRegimeFit[]
├── uncertainty               — 不确定性
│   ├── sources[]             — epistemic/systematic/distributional/temporal/environmental
│   ├── dominantSource
│   └── confidenceInAssessment
├── predictionConflicts[]      — 预测冲突
│   ├── type                  — logical / temporal / evidence / regime
│   ├── severity
│   └── conflictHash
├── knowledgeFreshness        — 知识新鲜度
│   ├── sources[]
│   └── overallFreshness      — FRESH / RECENT / STALE / EXPIRED / COLD_START
├── assessedAt                — 评估 tick
└── stateHash                 — 确定性 hash
```

---

## 七、反事实场景覆盖总结

| 场景 | 类型 | 关键验证 |
|------|------|---------|
| CF-1 | Regime Profile 存在且充足 | 使用 Regime Profile |
| CF-2 | Regime Profile 不存在 | Fallback 到全局 |
| CF-3 | Regime Profile 样本不足 | 降权但不回退 |
| CF-4 | Calibration Drift | DEGRADING |
| CF-5 | Calibration Improving | IMPROVING |
| CF-6 | Rolling Window 不足 | 不检测 drift |
| CF-7 | 逻辑冲突 | 标记但不解决 |
| CF-8 | 因果链（非冲突） | 不标记 |
| CF-9 | Temporal 不一致 | 标记 |
| CF-10 | Regime 冲突 | 标记 |
| CF-11 | 全面恶化 | uncertainty 标注 |
| CF-12 | 冷启动 | COLD_START |
| CF-13 | 部分数据 | INSUFFICIENT |
| CF-14 | Profile Aging | STALE |
| CF-15 | 确定性回放 | 100× 一致 |

---

## 八、实施路线图总结

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| S1 | Domain 类型定义 | P0 |
| S2 | State Hash + 确定性 | P0 |
| S3 | Regime Fit | P0 |
| S4 | Temporal Drift | P0 |
| S5 | Conflict Detection | P1 |
| S6 | Data Sufficiency + Freshness + Uncertainty | P1 |
| S7 | IntelligenceState 聚合 | P0 |
| S8 | Guards (REL-001 ~ REL-012) | P0 |
| S9 | System 层 | P0 |
| S10 | 集成测试 + E2E | P0 |

**CPU 估算**: < 1 ops/t  
**Memory 估算**: ~2KB transient  
**安全不变式**: A6.5 完全停止时帝国照常运行

---

## 九、A6.4 已知遗留问题评估

| 问题 | 严重度 | 阻塞 A6.5？ | 理由 |
|------|--------|------------|------|
| `failureStats` Map 无硬上限 | LOW | ❌ | modelKey 种类有限，不会无界增长 |
| `modelKey.split("-")` 解析问题 | LOW | ❌ | A6.5 不依赖解析后的值 |
| `buildExternalFactors` 遍历 Ring Buffer | MEDIUM | ❌ | A6.5 设计时考虑缓存 |

**结论**: 三个问题都不阻塞 A6.5 的研究和契约设计。

---

## 十、与 A6.6 的衔接

### 10.1 A6.5 为 A6.6 提供什么

A6.5 产出的 IntelligenceState 是 A6.6 Recommendation 的输入。A6.6 只消费 IntelligenceState，不直接读 A6.1-A6.4 的 Ring Buffer。

### 10.2 边界

| 职责 | A6.5 | A6.6 |
|------|------|------|
| 检测可靠性 | ✅ | — |
| 检测冲突 | ✅ | — |
| 聚合 IntelligenceState | ✅ | — |
| 基于 reliability 降权 | ❌ | ✅ |
| 解决冲突 | ❌ | ✅ |
| 产出策略建议 | ❌ | ✅ |

---

## 十一、研究声明

### 11.1 本研究遵守的约束

1. ✅ 纯研究，不修改任何代码
2. ✅ 不修改 A6.1-A6.4 的冻结契约
3. ✅ 基于真实代码审计（非猜测）
4. ✅ 基于真实调用链分析
5. ✅ 基于真实 globalCache 结构
6. ✅ 基于真实测试和已有文档

### 11.2 本研究的局限

1. 当前只有 2 个 Prediction Model 实现（energy-shortage, spawn-starvation），冲突检测的实际效果需等更多模型实现后验证
2. Regime Profile 的 Fallback 策略参数（MIN_SAMPLES_FOR_REGIME_PROFILE 等）需要运行时调优
3. Drift Detection 的阈值（1.5× / 0.5×）需要运行时验证
4. Conflict Detection 的规则集需要随新模型增加而扩展

### 11.3 下一步

1. **如果用户批准**: 进入 A6.5 实现阶段（按 Roadmap S1-S10 执行）
2. **如果用户有修改意见**: 修订研究文档后重新审查
3. **如果用户想先实现 A6.4 遗留问题**: 先修复 A6.4 已知问题再开始 A6.5

---

## 十二、文档索引

| 文档 | 路径 |
|------|------|
| Gap 分析 | `docs/phase33/A6_5_GAP_ANALYSIS.md` |
| 概念模型 | `docs/phase33/A6_5_INTELLIGENCE_MODEL.md` |
| 可靠性架构 | `docs/phase33/A6_5_RELIABILITY_ARCHITECTURE.md` |
| 冲突分析 | `docs/phase33/A6_5_CONFLICT_ANALYSIS.md` |
| 安全边界 | `docs/phase33/A6_5_SAFETY_BOUNDARY.md` |
| 反事实场景 | `docs/phase33/A6_5_COUNTERFACTUALS.md` |
| 架构设计 | `docs/phase33/A6_5_ARCHITECTURE.md` |
| 验收标准 | `docs/phase33/A6_5_ACCEPTANCE.md` |
| 路线图 | `docs/phase33/A6_5_ROADMAP.md` |
| 研究总结 | `docs/phase33/A6_5_FINAL_RESEARCH.md` |
