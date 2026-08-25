# A6.0 — Roadmap & Phased Plan

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、路线设计原则

### 1.1 依赖图驱动的排序

不预设 "A6.1 就是 Learning"。根据真实的依赖关系排序：

```
没有可靠的 Experience、Outcome、Attribution 和 Evaluation，
所谓 Learning 很容易变成 "根据自己产生的数据自我强化"。
```

### 1.2 已有基础

| 已有系统 | A6 可直接消费 |
|---------|-------------|
| DecisionTrace (A4.7) | DecisionRecord + Replay Engine |
| EmpireHealth (A4.5) | 8 维度健康度 + history |
| EventLog | 40+ 种事件 + segment 持久化 |
| Recovery (A4.6) | RecoveryAction lifecycle + stats |
| tuning-engine | Rule-based 参数调整 + 验证 + 回滚 + 冻结 |
| evaluateWarOutcome | 战争胜负评估 |
| IntelState (A5.2) | 玩家情报 + TTL + 置信度 |

---

## 二、分阶段路线

```
A5 Frozen
   │
   ▼
A6.0 Intelligence Architecture Research ← 当前阶段（本文档集）
   │
   ▼
A6.1 Experience + Outcome Attribution
   │  建立 Experience 记录 + Outcome 采集 + 归因模型
   │  消费已有 DecisionTrace + evaluateWarOutcome + EmpireHealth
   │
   ▼
A6.2 Long-Term Memory
   │  建立 Episodic + Semantic + Combat Memory
   │  segment 存储 + GC + 降采样
   │
   ▼
A6.3 Strategy Evaluation
   │  多维评估框架
   │  从 Experience + Memory 中提取 StrategyScore
   │
   ▼
A6.4 Prediction
   │  趋势外推 + 阈值投影
   │  7 个第一阶段预测目标
   │
   ▼
A6.5 Shadow Intelligence
   │  影子策略评估
   │  Decision Comparison (Level 1 Counterfactual)
   │
   ▼
A6.6 Adaptive Policy
   │  Recommendation Engine + Validation Gate
   │  通过 tuning 覆盖层影响参数
   │  Canary + Rollback
   │
   ├── A6.7 Player Intelligence（第二阶段）
   │     Player Profile + 行为建模 + 主动侦察
   │
   ├── A6.8 Combat Learning（第二阶段）
   │     编队效果统计 + 战术模式提取
   │
   └── A6.9 Counterfactual Simulation（后期/A7）
         Replay-based + Simulation-based What-if
```

### 2.1 为什么是这个顺序

| 阶段 | 前置依赖 | 为什么必须在前面 |
|------|---------|-----------------|
| A6.1 Experience | DecisionTrace (已有) | 没有 Experience 就没有学习数据 |
| A6.2 Memory | A6.1 | 没有长期记忆就没有模式提取 |
| A6.3 Evaluation | A6.1 + A6.2 | 没有 Experience + Memory 就无法评估策略 |
| A6.4 Prediction | A6.2 + A6.3 | 没有历史数据 + 评估就无法预测 |
| A6.5 Shadow | A6.3 + A6.4 | 没有 Evaluation + Prediction 就无法评估影子策略 |
| A6.6 Adaptive | A6.5 | 没有 Shadow 验证就不应该自适应调整参数 |
| A6.7 Player Intel | A6.1 + A6.2 | 需要 Experience + Memory 基础 |
| A6.8 Combat Learning | A6.1 + A6.2 | 需要 War Experience + Combat Memory |
| A6.9 Counterfactual | A6.2 + A6.5 | 需要 Memory + Shadow 基础 |

---

## 三、各阶段详细规格

### A6.1 — Experience + Outcome Attribution

| 维度 | 内容 |
|------|------|
| **目标** | 让帝国知道 "做过什么决策、结果如何、归因给谁" |
| **前置** | DecisionTrace ✅, evaluateWarOutcome ✅, EmpireHealth ✅ |
| **输入** | DecisionRecord (Ring Buffer) + EventLog + EmpireHealth delta |
| **输出** | ExperienceRecord → Episodic Memory (heap Ring Buffer) |
| **核心纯函数** | collectOutcome(), computeAttribution(), buildExperienceRecord() |
| **系统** | experience-collector (interval=100, P3, post) |
| **文件估算** | 3-5 文件 (domain/experience/ + system) |
| **Risk** | LOW — 只读消费，不执行 |
| **Value** | HIGH — A6 的数据基础 |
| **验收** | INT-001, INT-004 |

### A6.2 — Long-Term Memory

| 维度 | 内容 |
|------|------|
| **目标** | 让帝国长期记住 Experience |
| **前置** | A6.1 ✅ |
| **输入** | ExperienceRecord[] from heap Ring Buffer |
| **输出** | Episodic + Semantic + Combat Memory → RawMemory segment |
| **核心纯函数** | compressEpisodic(), aggregateSemantic(), gcMemory() |
| **系统** | memory-persistence (interval=100, P3, post) |
| **文件估算** | 4-6 文件 (domain/memory/ + kernel/segment extension) |
| **Risk** | LOW — 只写 segment，不执行 |
| **Value** | HIGH — 让帝国 "记住" |
| **验收** | INT-009 |

### A6.3 — Strategy Evaluation

| 维度 | 内容 |
|------|------|
| **目标** | 评估策略效果，产出 StrategyScore |
| **前置** | A6.1 ✅ + A6.2 ✅ |
| **输入** | Experience[] from Memory + EmpireHealth history |
| **输出** | StrategyScore (多维评估) |
| **核心纯函数** | evaluateStrategy(), computeDimensionScore(), compareBaseline() |
| **系统** | strategy-evaluator (interval=500-1000, P3, post) |
| **文件估算** | 3-5 文件 (domain/evaluation/ + system) |
| **Risk** | LOW — 只读分析 |
| **Value** | HIGH — 数据驱动的策略评估 |
| **验收** | INT-005 |

### A6.4 — Prediction

| 维度 | 内容 |
|------|------|
| **目标** | 预测未来风险 |
| **前置** | A6.2 ✅ + A6.3 ✅ |
| **输入** | Episodic Memory + EmpireHealth history + Pattern records |
| **输出** | Prediction + Confidence |
| **核心纯函数** | predictEnergyShortage(), predictCpuPressure(), predictRoomCollapse() |
| **系统** | prediction-engine (interval=500, P3, post) |
| **文件估算** | 3-5 文件 (domain/prediction/ + system) |
| **Risk** | LOW — 只读分析 |
| **Value** | HIGH — 从被动反应到主动预判 |
| **验收** | INT-006 |

### A6.5 — Shadow Intelligence

| 维度 | 内容 |
|------|------|
| **目标** | 影子策略评估，安全的策略探索 |
| **前置** | A6.3 ✅ + A6.4 ✅ |
| **输入** | StrategyScore + Prediction + 当前参数 |
| **输出** | ShadowEvaluation (expected gain / risk / cpu impact) |
| **核心纯函数** | evaluateShadow(), compareShadowVsLive() |
| **系统** | shadow-evaluator (interval=500, P3, post) |
| **文件估算** | 3-5 文件 (domain/shadow/ + system) |
| **Risk** | MEDIUM — 涉及参数调整（但通过 Validation Gate） |
| **Value** | HIGH — 安全的自适应 |
| **验收** | INT-007, INT-012 |

### A6.6 — Adaptive Policy

| 维度 | 内容 |
|------|------|
| **目标** | 通过 Validation Gate 安全地调整参数 |
| **前置** | A6.5 ✅ |
| **输入** | ShadowEvaluation + Recommendation |
| **输出** | Validated Recommendation → tuning 覆盖层 |
| **核心纯函数** | validateRecommendation(), canaryEvaluate(), rollbackPolicy() |
| **系统** | recommendation-engine (interval=500, P3, post) |
| **文件估算** | 4-6 文件 (domain/recommendation/ + system + tuning extension) |
| **Risk** | MEDIUM — 参数调整有风险（但通过 canary + rollback） |
| **Value** | HIGH — 最终的自适应能力 |
| **验收** | INT-007, INT-012 |

### A6.7 — Player Intelligence (第二阶段)

| 维度 | 内容 |
|------|------|
| **目标** | 玩家行为建模 + 主动侦察 |
| **前置** | A6.1 ✅ + A6.2 ✅ |
| **输入** | IntelState + Combat Memory + Scout 采集 |
| **输出** | PlayerProfile + 行为预测 |
| **文件估算** | 5-8 文件 |
| **Risk** | MEDIUM — 主动侦察有 PvP 风险 |
| **Value** | HIGH — 预测比反应更有价值 |

### A6.8 — Combat Learning (第二阶段)

| 维度 | 内容 |
|------|------|
| **目标** | 编队效果统计 + 战术模式提取 |
| **前置** | A6.1 ✅ + A6.2 ✅ |
| **输入** | War Experience + Combat Memory + Tactical decisions |
| **输出** | Combat Pattern → Recommendation |
| **文件估算** | 3-5 文件 |
| **Risk** | LOW — 只读统计 |
| **Value** | HIGH — 改善军事决策质量 |

### A6.9 — Counterfactual Simulation (后期/A7)

| 维度 | 内容 |
|------|------|
| **目标** | What-if 模拟 |
| **前置** | A6.2 ✅ + A6.5 ✅ + Simulation 引擎 |
| **输入** | 历史 State Snapshot + DecisionTrace |
| **输出** | Counterfactual Result |
| **文件估算** | 5-10 文件 |
| **Risk** | HIGH — 需要 Simulation 引擎 |
| **Value** | MEDIUM — 机会成本评估 |

---

## 四、工作量与时间估算

| 阶段 | 文件数 | 预估工时 | 依赖 |
|------|--------|---------|------|
| A6.0 (当前) | 12 文档 | — | — |
| A6.1 Experience | 3-5 | 中 | 无 |
| A6.2 Memory | 4-6 | 中 | A6.1 |
| A6.3 Evaluation | 3-5 | 中 | A6.1+A6.2 |
| A6.4 Prediction | 3-5 | 中 | A6.2+A6.3 |
| A6.5 Shadow | 3-5 | 中高 | A6.3+A6.4 |
| A6.6 Adaptive | 4-6 | 中高 | A6.5 |
| **第一阶段合计** | **20-32** | — | — |
| A6.7 Player Intel | 5-8 | 高 | A6.1+A6.2 |
| A6.8 Combat Learning | 3-5 | 中 | A6.1+A6.2 |
| **第二阶段合计** | **8-13** | — | — |
| A6.9 Counterfactual | 5-10 | 高 | A6.2+A6.5+Sim |

---

## 五、关键结论

1. **A6.1 不是 "Learning"，而是 "Experience + Outcome Attribution"**
2. **路线顺序由依赖图驱动**，不是由 "哪个看起来更智能" 驱动
3. **A6.1 → A6.2 → A6.3 → A6.4 → A6.5 → A6.6 是严格依赖链**
4. **Player Intelligence 和 Combat Learning 是第二阶段**，但可以与 A6.3-A6.6 并行
5. **Counterfactual Simulation 是后期/A7**，需要 Simulation 引擎
6. **第一阶段总工作量约 20-32 文件**，分 6 个子阶段
7. **每个子阶段都有明确的验收标准**（见 A6_0_ACCEPTANCE.md）
8. **A6.0 的结论是**：先让帝国具备 "知道自己做过什么、为什么做、结果如何、结果应该归因给谁"，再逐步建立评估、预测、影子、自适应能力
