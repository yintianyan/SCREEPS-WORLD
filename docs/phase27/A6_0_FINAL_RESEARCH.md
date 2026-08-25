# A6.0 — Final Research Report: Empire Intelligence Architecture & Learning Foundation

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **前置**: A5 Full Architecture Freeze ✅
> **约束**: 纯研究，不实现代码
> **本文档**: 12 份研究文档的最终综合，作为 A6 实施阶段的决策入口

---

## 一、研究背景与目标

### 1.1 从 Reactive Autonomous 到 Empire Intelligence

A1–A5 建立了一个完整的**反应式自治系统**（Reactive Autonomous System）：

```
Observe → State → Strategy → Plan → Execute → Feedback → Recovery → Trace
```

这个闭环已经实现并经过审计冻结。但帝国做不到：

| 缺失能力 | 后果 |
|----------|------|
| **Remember** — 不从历史中提取知识 | 重复犯相同错误 |
| **Compare** — 不比较不同策略的效果 | 策略选择基于经验猜测 |
| **Evaluate** — 不评估决策质量 | 不知道为什么赢/输 |
| **Learn** — 不从经验中提取模式 | 参数永远从 CONFIG 默认开始 |
| **Predict** — 不预测未来风险 | 被动反应永远慢一步 |
| **Adapt** — 不根据表现自适应调整 | 策略参数静态固定 |

A6 的目标：**让帝国从自己的运行历史中学习，并逐渐变得更聪明。**

### 1.2 研究范围

本次研究覆盖 12 个主题：

| # | 文档 | 核心问题 |
|---|------|---------|
| 1 | `A6_0_INTELLIGENCE_ARCHITECTURE.md` | A6 的整体架构、概念分层、与 A5 的边界 |
| 2 | `A6_0_MEMORY_ARCHITECTURE.md` | 长期记忆如何设计、存储、GC |
| 3 | `A6_0_EXPERIENCE_MODEL.md` | Experience 记录结构、Outcome 采集、Attribution 归因 |
| 4 | `A6_0_STRATEGY_EVALUATION.md` | 如何评估策略效果、多维评分框架 |
| 5 | `A6_0_PREDICTION_ARCHITECTURE.md` | 预测什么、怎么预测、置信度如何标注 |
| 6 | `A6_0_PLAYER_INTELLIGENCE.md` | 玩家行为建模、Fact/Inference/Prediction 分离 |
| 7 | `A6_0_LEARNING_APPROACH.md` | Rule/Statistical/Bayesian/Bandit/RL/NN/LLM 对比选型 |
| 8 | `A6_0_SAFETY_BOUNDARY.md` | Learning 与 Execution 的权责边界、Validation Gate |
| 9 | `A6_0_COUNTERFACTUAL.md` | 反事实分析、Shadow Intelligence、What-if Simulation |
| 10 | `A6_0_ROADMAP.md` | 分阶段实施路线 |
| 11 | `A6_0_ACCEPTANCE.md` | 行为级验收标准 |
| 12 | **本文档** | 最终综合与决策建议 |

---

## 二、核心架构决策

### 2.1 A5 vs A6 的权责分界

```
A5 Autonomous Loop（运行时自动化）:
  World → Observe → State → Decide → Execute → Feedback → Recovery
  权限: 可执行 Game API（spawn/attack/move/transfer）
  确定性: 同输入 → 同输出（Replay）

A6 Intelligence Loop（帝国智能）:
  Experience → Evaluate → Pattern → Predict → Recommend → Validate → Adopt
  权限: ❌ 不可执行 Game API（只产出 Recommendation）
  确定性: 同输入+同模型+同参数 → 同建议
```

**核心红线**：A6 是 Observer / Evaluator / Recommender，不是 Executor。

A6 的 Recommendation 必须经过 **Validation Gate** 才能影响 A5 的 Strategy/Planner。
A6 永远不直接调用 Game API。

### 2.2 概念分层（10 个严格区分的概念）

```
FACT → OBSERVATION → EVENT → OUTCOME → EXPERIENCE
                                              ↓
                                    PATTERN (统计聚合)
                                              ↓
                                    HYPOTHESIS (因果推理)
                                              ↓
                                    PREDICTION (未来预判)
                                              ↓
                                    RECOMMENDATION (行动建议)
                                              ↓
                            Validation Gate (安全验证)
                                              ↓
                                    DECISION (A5 执行)
```

**禁止**：
- PATTERN 直接变成 DECISION（必须经过 RECOMMENDATION + Validation）
- PREDICTION 直接变成 DECISION（Prediction 只提供信息，不做决策）
- HYPOTHESIS 冒充 FACT（Hypothesis 是推理，不是观测）

### 2.3 分层架构

```
┌──────────────────────────────────────────────────────┐
│  Empire Intelligence Layer (A6)                       │
│                                                       │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │Prediction│ │Strategy  │ │Player    │ │Pattern  │  │
│  │Layer    │ │Evaluation│ │Intelligence│ │Detection│  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └────┬────┘  │
│       │           │            │            │        │
│  ┌────▼───────────▼────────────▼────────────▼────┐  │
│  │          Recommendation Engine                 │  │
│  │     (产出 Recommendation DTO, 不执行)           │  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼──────────────────────────┐  │
│  │        Validation Gate (Safety Boundary)       │  │
│  │  (白名单 / 值域 / 窗口 / canary / rollback)    │  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼──────────────────────────┐  │
│  │     Experience & Memory Layer                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │Episodic  │ │Semantic  │ │Strategic     │  │  │
│  │  │Memory    │ │Memory    │ │Memory        │  │  │
│  │  └──────────┘ └──────────┘ └──────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐                    │  │
│  │  │Player    │ │Combat    │                    │  │
│  │  │Memory    │ │Memory    │                    │  │
│  │  └──────────┘ └──────────┘                    │  │
│  └────────────────────┬──────────────────────────┘  │
└───────────────────────┼──────────────────────────────┘
                        │ (只读消费)
┌───────────────────────▼──────────────────────────────┐
│  Existing A4/A5 Systems (不动)                        │
│  Strategy → Planning → Military → Tactical → Recovery│
│  Spawn → Logistics → Economy → Construction → Layout │
│  DecisionTrace → EmpireHealth → EventLog → Replay    │
└──────────────────────────────────────────────────────┘
```

---

## 三、关键设计决策汇总

### 3.1 学习方法选型：Rule-based + Statistical

| 方法 | 第一阶段 | 理由 |
|------|---------|------|
| **Rule-based Adaptation** | ✅ 核心 | 完全确定、可解释、CPU 极低、已有 tuning-engine 成功先例 |
| **Statistical Learning** | ✅ 核心 | 确定、可解释、CPU 低、适合 EMA/分位数/相关性分析 |
| **Bayesian Inference** | ❌ 第二阶段 | 适合 Player Intelligence 的行为预测，但实现复杂度较高 |
| **Online Regression** | ❌ 暂不 | 数据量不足，浮点精度问题 |
| **Bandit** | ❌ 暂不 | 探索成本太高，但概念可借鉴用于 Shadow Evaluation |
| **RL / Neural Network** | ❌ 永久排除 | 数据量、CPU、确定性、可解释性全部不满足 |
| **LLM offline** | ⚠️ 可选补充 | 遵守 LLM_BOUNDARY 契约，作为 L2 体外参数顾问 |

**核心结论**：不使用 ML。Rule-based + Statistical 已能覆盖第一阶段全部需求。

### 3.2 Experience = Decision + Outcome + Attribution

DecisionTrace 记录 "为什么做决策"（事前）；Experience 记录 "做完后发生了什么" + "结果归因给谁"（事后）。

**Experience 采集流程**：
1. 决策发生时记录 `decisionId`（关联 DecisionTrace）
2. 经过 `measurementDelay` tick 后采集 Outcome
3. 通过归因模型确定主要影响因素
4. 构建 ExperienceRecord 写入 Episodic Memory

**第一阶段优先做的 Experience**：
- **War Experience**（最高价值，归因相对简单）
- **Expansion Experience**（中等价值，归因中等难度）
- ❌ 经济 Attribution 延迟到后期（延迟极大、多系统耦合）

### 3.3 长期记忆分层

| 记忆类型 | 存储层 | 容量 | TTL | 压缩策略 |
|---------|--------|------|-----|---------|
| Episodic Memory | RawMemory segment × 2 | 1000 条 | 10000 tick | 降采样 |
| Semantic Memory | RawMemory segment × 1 | 333 条 | 永久 | 聚合统计 |
| Strategic Memory | 共用 semantic | 33 条 | 永久 | 只结论 |
| Player Memory | 共用 intel-players | 50 玩家 | 月级 | 衰减权重 |
| Combat Memory | RawMemory segment × 1 | 200 条 | 10000 tick | 聚合统计 |

**Segment 激活预算**：A6 常态占用 ≤ 2 个激活段（与 Intel 共享 10 段/tick 上限）。
**100000 tick 后总量 ≤ 500KB**。

### 3.4 策略评估框架

多维评估，**不合并为万能分数**：

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

每个维度有 score + metric + value + baseline + delta + confidence。

### 3.5 预测架构

第一阶段 7 个预测目标（按价值排序）：

1. **Energy shortage** — 提前调整经济策略
2. **Spawn starvation** — 提前调整人口规划
3. **Logistics bottleneck** — 提前增援物流
4. **Room collapse** — 提前触发 Recovery
5. **CPU pressure** — 提前降级
6. **Hostile arrival** — 提前部署防御
7. **War outcome** — 战前评估胜率

预测方法：趋势外推（EMA + 斜率）+ 阈值投影。所有预测附带置信度。

### 3.6 安全边界：Validation Gate

7 道安全检查：

1. **白名单校验** — 只允许 tuning 覆盖层参数
2. **值域校验** — 不超过 floor/ceiling
3. **统计窗口约束** — 调整周期 ≥ 统计窗口
4. **Canary 生效** — 先在小范围试用 N tick
5. **自动回滚** — 观察窗口内指标恶化即回退
6. **策略版本校验** — modelVersion 兼容
7. **恢复档禁止** — Recovery/Conserve 档不生效

### 3.7 确定性合同

```
同一 Experience 输入 + 同一模型版本 + 同一参数集
  → 同一 Recommendation
  → 同一 Pattern Detection 结果
  → 同一 Strategy Evaluation 结果
  → 同一 Prediction
```

禁止 6 种非确定性来源：`Math.random()`、`Date.now()`、浮点误差、无序迭代、跨 tick mutation、`Map` 迭代顺序。

### 3.8 CPU 与 Memory 预算

| 维度 | 预算 |
|------|------|
| A6 总 CPU | ≤ 帝国 CPU 的 2-3% |
| 单次 Pattern Detection | < 1 CPU / 500 tick |
| 单次 Strategy Evaluation | < 2 CPU / 1000 tick |
| 单次 Prediction | < 1 CPU / 500 tick |
| 单次 Recommendation | < 0.5 CPU / 500 tick |
| Recovery 档 | A6 全停 |
| Memory 主体 | 不包含 A6 历史数据 |
| Segment 总量 | ≤ 500KB（100K tick 后） |

### 3.9 Counterfactual & Shadow Intelligence

| 级别 | 方法 | 可行性 | 阶段 |
|------|------|--------|------|
| Level 1 | Decision Comparison（决策对比） | ✅ 可行 | A6.5 |
| Level 2 | Offline Simulation（离线模拟） | ⚠️ 需基础设施 | A6.9 / A7 |
| Level 3 | Full Simulation Engine（完整模拟引擎） | ❌ 需大量工作 | A7+ |

**Shadow Intelligence = 安全的探索**：影子策略不直接执行，只产出 ShadowEvaluation DTO，与实际策略对比。

### 3.10 Player Intelligence

**Fact / Inference / Prediction 三层严格分离**：

| 层 | 内容 | 确定性 | 示例 |
|----|------|--------|------|
| Facts | 直接观测数据 | 确定 | "玩家 X 在 W1N1 有 3 个 tower" |
| Inferences | 基于事实的推断 | 标注为推断 | "玩家 X 可能是防守型（基于 3 次观察）" |
| Predictions | 对未来的预判 | 概率+置信度 | "玩家 X 在未来 2000 tick 内进攻概率 0.7" |

**第二阶段启动**，第一阶段只做被动观察积累。

---

## 四、分阶段实施路线

```
A5 Frozen
   │
   ▼
A6.0 Intelligence Architecture Research ← ✅ 已完成（本次）
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
   ├── A6.8 Combat Learning（第二阶段）
   └── A6.9 Counterfactual Simulation（后期/A7）
```

### 4.1 依赖图驱动的排序理由

| 阶段 | 为什么必须在前面 |
|------|-----------------|
| A6.1 Experience | 没有 Experience 就没有学习数据 |
| A6.2 Memory | 没有长期记忆就没有模式提取 |
| A6.3 Evaluation | 没有 Experience + Memory 就无法评估策略 |
| A6.4 Prediction | 没有历史数据 + 评估就无法预测 |
| A6.5 Shadow | 没有 Evaluation + Prediction 就无法评估影子策略 |
| A6.6 Adaptive | 没有 Shadow 验证就不应该自适应调整参数 |

**核心原则**：不预设 "A6.1 就是 Learning"。根据真实依赖关系排序。

### 4.2 工作量估算

| 阶段 | 文件数 | Risk | Value |
|------|--------|------|-------|
| A6.1 Experience | 3-5 | LOW | HIGH |
| A6.2 Memory | 4-6 | LOW | HIGH |
| A6.3 Evaluation | 3-5 | LOW | HIGH |
| A6.4 Prediction | 3-5 | LOW | HIGH |
| A6.5 Shadow | 3-5 | MEDIUM | HIGH |
| A6.6 Adaptive | 4-6 | MEDIUM | HIGH |
| **第一阶段合计** | **20-32** | — | — |
| A6.7 Player Intel | 5-8 | MEDIUM | HIGH |
| A6.8 Combat Learning | 3-5 | LOW | HIGH |
| A6.9 Counterfactual | 5-10 | HIGH | MEDIUM |

---

## 五、已有基础（不重复造轮子）

### 5.1 A6 直接消费的已有系统

| 已有系统 | A6 如何消费 | A6 是否修改 |
|---------|-----------|-----------|
| DecisionTrace (A4.7) | 只读 DecisionRecord + Replay | ❌ 不修改 |
| EmpireHealth (A4.5) | 只读 healthResult + history | ❌ 不修改 |
| EventLog | 只读 GameEvent | ❌ 不修改 |
| Recovery (A4.6) | 只读 RecoveryAction 历史 | ❌ 不修改 |
| Logistics (A4.3) | 只读 TransportPlan + Starvation | ❌ 不修改 |
| Spawn (A4.4) | 只读 spawn queue 历史 | ❌ 不修改 |
| WarPlanning (A5.3) | 只读 WarPlan + WarOutcome | ❌ 不修改 |
| Tactical (A5.4) | 只读 TacticalDecision | ❌ 不修改 |
| tuning-engine | A6 可向 tuning 覆盖层写入建议值 | ⚠️ 通过已有接口 |
| posture (A3) | posture 读取 Recommendation 字段 | ⚠️ 新增只读字段 |

### 5.2 不建立第二套系统

A6 **不**建立：
- 第二套 DecisionTrace（复用 A4.7）
- 第二套 Replay（复用 A4.7）
- 第二套 Recovery（复用 A4.6）
- 第二套 Spawn（复用 A4.4）
- 第二套 Logistics（复用 A4.3）
- 第二套 Threat（复用 A5.1）
- 第二套 CombatCapability（复用 A5.1）
- 第二套 Tactical Decision（复用 A5.4）

---

## 六、验收标准总览

18 条行为级验收标准，涵盖 A6 全阶段：

| 类别 | 数量 | 关键项 |
|------|------|--------|
| 数据完整性 | 4 | INT-001 Experience 记录、INT-004 Outcome 采集、INT-009 Memory 有界、INT-013 不重复实现 |
| 安全边界 | 5 | INT-007 不直接执行、INT-010 不进 critical path、INT-011 不破坏 A5、INT-014 走 safeRun、INT-015 停止时帝国安全 |
| 学习质量 | 4 | INT-005 策略评估、INT-006 生成 Recommendation、INT-008 Deterministic Replay、INT-018 置信度标注 |
| 自适应 | 2 | INT-012 可 Rollback、INT-017 Shadow 不执行 |
| 概念分离 | 2 | INT-002 Fact/Inference/Prediction 区分、INT-003 经济瓶颈识别 |
| 资源预算 | 1 | INT-016 CPU ≤ 3% |

**最关键的安全不变式**：A6 系统完全停止时，帝国必须照常安全运行。

---

## 七、A6 最容易犯的 5 个架构错误（及规避方案）

| # | 错误 | 后果 | 规避方案 |
|---|------|------|---------|
| 1 | **让 Learning 直接修改 Strategy** | 破坏确定性 Replay、安全边界、可回滚性 | Learning → Recommendation → Validation Gate → tuning 覆盖层 |
| 2 | **PATTERN 直接变成 DECISION** | 跳过验证，模式错误直接危害帝国 | 强制经过 RECOMMENDATION + Validation |
| 3 | **无限历史积累** | Memory 膨胀，segment 爆容量 | Ring Buffer + 降采样 + 聚合统计 + TTL GC |
| 4 | **自我强化错误策略** | Learning 从错误决策中 "确认" 错误为 "有效" | Shadow First + Counterfactual + External Baseline + Rollback |
| 5 | **Pattern Detection 的 O(N²) 复杂度** | CPU 超标 | 预排序 + 分桶 + 增量更新 |

---

## 八、风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Learning 破坏 A5 确定性 | 低 | 致命 | Validation Gate + 安全边界红线 |
| Memory 无限增长 | 中 | 高 | Ring Buffer + TTL + 降采样 + 聚合 |
| 自我强化错误策略 | 中 | 高 | Shadow First + Counterfactual + Rollback |
| CPU 超标 | 低 | 中 | 预算分配 + Recovery 档全停 |
| 归因错误 | 中 | 中 | 第一阶段只做 War Attribution（归因简单） |
| 数据不足导致 Pattern 不可靠 | 高 | 中 | confidence 标注 + 低置信度不影响策略 |
| A6 系统故障影响帝国 | 低 | 致命 | safeRun + 冷却 + A6 完全停止时帝国安全 |

---

## 九、与已有架构文档的兼容性验证

| 已有文档 | A6 的关系 | 兼容性 |
|---------|----------|--------|
| `INTELLIGENCE_ARCHITECTURE.md` | A6 扩展情报系统的 Prediction 和 Player Intelligence 层 | ✅ 兼容 |
| `LLM_BOUNDARY.md` | A6 遵守 LLM 边界契约，可通过 L2 接收外部建议 | ✅ 兼容 |
| `MEMORY_ARCHITECTURE.md` | A6 走 segment（冷数据），不进 Memory 主体 | ✅ 兼容 |
| `CPU_EXECUTION_MODEL.md` | A6 属于 Low Frequency 频带，Recovery 档全停 | ✅ 兼容 |
| `STATE_OWNERSHIP_MODEL.md` | A6 新增状态字段登记六列 | ✅ 兼容 |
| `DECISION_AUTHORITY_MODEL.md` | A6 不新增 Decision Authority | ✅ 兼容 |
| `FAILURE_RECOVERY_ARCHITECTURE.md` | A6 走 safeRun，连续失败进冷却 | ✅ 兼容 |
| `KERNEL_ARCHITECTURE.md` | A6 系统注册到 Kernel，不改 Kernel | ✅ 兼容 |
| `SYSTEM_BOUNDARIES.md` | A6 系统通过 bootstrap 注册，不改 Kernel | ✅ 兼容 |

**结论**：A6 的所有设计决策与已有架构文档完全兼容，不需要修改任何冻结契约。

---

## 十、最终决策建议

### 10.1 立即可执行的下一步

**A6.1 — Experience + Outcome Attribution**

| 维度 | 决策 |
|------|------|
| 目标 | 让帝国知道 "做过什么决策、结果如何、归因给谁" |
| 前置 | DecisionTrace ✅, evaluateWarOutcome ✅, EmpireHealth ✅ — 全部已有 |
| 学习方法 | Rule-based + Statistical |
| 第一个 Experience 类型 | War Experience（最高价值、归因最简单） |
| 系统注册 | experience-collector (interval=100, P3, post) |
| 预估文件 | 3-5 个 (domain/experience/ + system) |
| Risk | LOW — 只读消费，不执行 |
| 验收 | INT-001, INT-004, INT-008, INT-013, INT-014 |

### 10.2 不做的事

| 禁止项 | 理由 |
|--------|------|
| 不实现 ML / RL / Neural Network | 数据量不足、CPU 不够、不可解释、不可 deterministic |
| 不修改 A5 Military/Tactical 架构 | A5 已冻结 |
| 不建立第二套 DecisionTrace/Replay/Recovery/Spawn/Logistics | 复用已有 |
| 不让 Learning 直接调用 Game API | 安全边界红线 |
| 不让 Learning 直接修改 Strategy | 安全边界红线 |
| 不做经济 Attribution（第一阶段） | 延迟极大、多系统耦合、无对照组 |
| 不做 Player Intelligence（第一阶段） | 需主动侦察，有 PvP 暴露风险 |
| 不做 Counterfactual Simulation（第一阶段） | 需 Simulation 引擎 |

### 10.3 成功标准

当帝国能够做到以下全部时，A6 才算成功：

1. ✅ 记住每场战争的编队、敌方配置和结果
2. ✅ 从历史中统计出 "哪种编队对哪种敌人胜率更高"
3. ✅ 预测 "玩家 X 可能在未来 N tick 内进攻"
4. ✅ 推荐 "建议使用编队 B 而非编队 A，因为历史胜率 80% vs 40%"
5. ✅ 在安全边界内自动采用更优策略参数
6. ✅ 当策略参数导致恶化时自动回滚
7. ✅ 以上全部不破坏 A5 的确定性、可观测性、Recovery、DecisionTrace、Replay

---

## 十一、研究结论

A6.0 研究阶段的核心结论可以浓缩为一句话：

> **先让帝国具备 "知道自己做过什么、为什么做、结果如何、结果应该归因给谁" 的能力，再逐步建立评估、预测、影子、自适应能力。**

这不是 "添加一个 LearningSystem" 的问题，而是建立一个从数据采集到知识提取到安全建议的完整链路。这个链路的每一步都必须：
- **确定性**：可 Replay
- **安全**：不直接执行
- **有界**：CPU/Memory 不超标
- **可回滚**：错了能退
- **可解释**：知道为什么推荐这个

**路线已清晰，基础已就绪，风险已识别，安全边界已定义。A6.1 可以开始实施。**

---

## 附录：文档索引

| 文档 | 路径 |
|------|------|
| 智能架构总览 | `docs/phase27/A6_0_INTELLIGENCE_ARCHITECTURE.md` |
| 长期记忆架构 | `docs/phase27/A6_0_MEMORY_ARCHITECTURE.md` |
| Experience 模型 | `docs/phase27/A6_0_EXPERIENCE_MODEL.md` |
| 策略评估框架 | `docs/phase27/A6_0_STRATEGY_EVALUATION.md` |
| 预测架构 | `docs/phase27/A6_0_PREDICTION_ARCHITECTURE.md` |
| 玩家智能 | `docs/phase27/A6_0_PLAYER_INTELLIGENCE.md` |
| 学习方法对比 | `docs/phase27/A6_0_LEARNING_APPROACH.md` |
| 安全边界 | `docs/phase27/A6_0_SAFETY_BOUNDARY.md` |
| 反事实与影子智能 | `docs/phase27/A6_0_COUNTERFACTUAL.md` |
| 分阶段路线 | `docs/phase27/A6_0_ROADMAP.md` |
| 验收标准 | `docs/phase27/A6_0_ACCEPTANCE.md` |
| **最终研究报告** | **`docs/phase27/A6_0_FINAL_RESEARCH.md`** (本文档) |
