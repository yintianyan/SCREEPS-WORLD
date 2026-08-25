# A6.3.0 — Prediction Layer Gap Analysis

> **阶段**: A6.3.0 Research / Audit
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 审计 A6.1/A6.2 现有能力 vs A6.0 预测架构所需的数据基础，识别差距

---

## 一、审计范围与方法

### 1.1 审计目标

本报告回答一个问题：**从 A6.1（Experience）和 A6.2（Strategy Evaluation + Baseline）的现有实现出发，构建 A6.0 设计的预测层还缺什么？**

### 1.2 审计方法

- **自顶向下**：从 A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` 定义的 12 个候选预测目标出发
- **自底向上**：逐个映射到 A6.1/A6.2 域代码 + A5 架构/代码中的实际数据源
- **差距识别**：标记每个预测目标的数据可用性、模型可用性、基础设施可用性

### 1.3 审计输入清单

| 层级 | 文档/代码 | 状态 |
|------|----------|------|
| A6.0 研究 | `A6_0_PREDICTION_ARCHITECTURE.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_SAFETY_BOUNDARY.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_COUNTERFACTUAL.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_LEARNING_APPROACH.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_FINAL_RESEARCH.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_MEMORY_ARCHITECTURE.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_ROADMAP.md` | ✅ 已读 |
| A6.0 研究 | `A6_0_ACCEPTANCE.md` | ✅ 已读 |
| A6.1 域代码 | `src/domain/intelligence/experience.ts` | ✅ 已读 |
| A6.1 域代码 | `src/domain/intelligence/outcome.ts` | ✅ 已读 |
| A6.1 域代码 | `src/domain/intelligence/attribution.ts` | ✅ 已读 |
| A6.1 系统代码 | `src/systems/intelligence/experience-collector-system.ts` | ✅ 已读 |
| A6.2 域代码 | `src/domain/intelligence/baseline.ts` | ✅ 已读 |
| A6.2 域代码 | `src/domain/intelligence/strategy-evaluation.ts` | ✅ 已读 |
| A6.2 域代码 | `src/domain/intelligence/evaluation-evidence.ts` | ✅ 已读 |
| A6.2 系统代码 | `src/systems/intelligence/strategy-evaluation-system.ts` | ✅ 已读 |
| A6.2 审计 | `docs/phase29/A6_2_FINAL_AUDIT.md` | ✅ 已读 |
| A6.2 审计 | `docs/phase29/A6_2_PRE_IMPLEMENTATION_AUDIT.md` | ✅ 已读 |
| A5 域代码 | `src/domain/strategy/empire-health.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/strategy/autonomy-metrics.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/strategy/recovery-lifecycle.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/logistics/logistics-health.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/defense/threat-assessment.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/economy/room-profile.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/economy/resource-ledger.ts` | ✅ 已读 |
| A5 域代码 | `src/domain/expansion/dashboard.ts` | ✅ 已读 |
| A5 系统代码 | `src/systems/empire-health-system.ts` | ✅ 已读 |
| A5 系统代码 | `src/systems/decision-trace-system.ts` | ✅ 已读 |
| A5 系统代码 | `src/systems/expansion-planner.ts` | ✅ 已读 |
| A5 基础设施 | `src/kernel/global-cache.ts` | ✅ 已读 |
| A5 架构 | `MILITARY_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `DEFENSE_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `SPAWN_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `CONSTRUCTION_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `EXPANSION_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `CPU_EXECUTION_MODEL.md` | ✅ 已读 |
| A5 架构 | `FAILURE_RECOVERY_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `LOGISTICS_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `ECONOMY_ARCHITECTURE.md` | ✅ 已读 |
| A5 架构 | `GOAL_POLICY_PLAN_MODEL.md` | ✅ 已读 |
| A5 架构 | `INTELLIGENCE_ARCHITECTURE.md` | ✅ 已读 |

---

## 二、A6.0 预测目标 vs 现有数据基础

### 2.1 第一阶段预测目标（7 个）

#### GAP-1: Energy Shortage Prediction（能量短缺预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `empireHealth.dimensions.energy`（globalCache.empireHealth，每 100t 刷新）；`empireResourceLedger`（globalCache）；`__netFlowHistory`（heap 数组）；`__reserveHistory`（heap 数组） | ✅ **数据充足**。Energy 维度健康度、净流历史、储备历史均已在 A4.5 empire-health-system 中采集。 |
| **时间序列** | `__netFlowHistory` 和 `__reserveHistory` 是简单数组（push + 截断），无结构化时间戳。 | **GAP-1a（低）**：时间序列无 tick 标注，无法做精确回归。需要为每个采样点附带 tick。但当前数组长度有限（~50-100 点），100t 采样间隔，可推断 tick = baseTime + index × 100。 |
| **模型** | A6.0 设计了线性回归 + R² 置信度。 | **GAP-1b（低）**：线性回归是纯函数，可直接在 domain 层实现。无依赖缺失。 |
| **阈值** | `empireHealth.dimensions.energy` 有 level（healthy/warning/critical）但无连续阈值。 | **GAP-1c（低）**：需定义 "deficit threshold" 作为预测目标值。可从 baseline.ts 的 `CONFIG_BASELINE_VALUES` 派生。 |

**结论**：**可实施**。数据基础充分，仅需补充时间序列结构化（附带 tick）和 deficit 阈值定义。

#### GAP-2: Spawn Starvation Prediction（孵化饥饿预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `empireHealth.dimensions.spawn`（globalCache）；spawn 队列深度在 `SpawnManager` 内部但未在 globalCache 暴露。 | **GAP-2a（中）**：spawn 队列深度历史未在 globalCache 暴露。需在 `empire-health-system` 或新建 `spawn-metrics-system` 中采集队列深度时间序列。 |
| **时间序列** | 无 spawn 队列深度历史采集。 | **GAP-2b（中）**：需新建 spawn 队列深度历史采样（heap 数组，低频）。 |
| **模型** | A6.0 设计了阈值投影（增长率 → ETA）。 | ✅ 模型简单，可直接实现。 |
| **人口趋势** | `__populationHistory`（heap 数组，empire-health-system 维护）。 | ✅ 人口历史已有。 |

**结论**：**可实施，需补充 spawn 队列深度历史采样**。

#### GAP-3: Logistics Bottleneck Prediction（物流瓶颈预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `globalCache.logisticsHealth`（LogisticsHealthResult，每 100t 刷新）；`globalCache.logisticsAccounting`（summary + entries）；`globalCache.logisticsCounters`（idleTicks/claims）。 | ✅ **数据充足**。物流健康度、会计明细、计数器均有。 |
| **时间序列** | `logisticsHealth` 只存当前快照，无历史序列。 | **GAP-3a（中）**：需新建 `__logisticsHealthHistory` 数组（heap，empire-health-system 或 logistics-planner 维护）。 |
| **模型** | A6.0 设计了统计推断（starvation 频率 → ETA）。 | ✅ 模型可实现。 |
| **hauler 趋势** | `logisticsScaling.decisions` 有扩缩编决策但无历史序列。 | **GAP-3b（低）**：可从 `logisticsCapacity` 快照序列推断 hauler 趋势，或在 heap 维护简单计数历史。 |

**结论**：**可实施，需补充物流健康度历史序列**。

#### GAP-4: Room Collapse Prediction（房间崩溃预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `empireHealth.dimensions.colonies`（globalCache）；`globalCache.threatAssessments`（每 tick 更新）；RoomState 有 colonyState 字段。 | ✅ **数据基本充足**。 |
| **时间序列** | `__healthHistory`（empireHealth level + score，heap 数组）但**不按房分维度**。 | **GAP-4a（中）**：需为关键房间（或所有自有房）维护 room-level health 时间序列。当前 `__healthHistory` 是帝国级聚合，无法做单房崩溃预测。 |
| **恢复时间** | `recoveryStats`（RecoveryStats，含 avgRecoveryTime）。 | ✅ 恢复统计已有。 |
| **结构计数** | 无结构计数趋势采集。 | **GAP-4b（低）**：可从 RoomSnapshot 派生结构计数，低频采集。 |

**结论**：**可实施，需补充 room-level health 历史序列**。

#### GAP-5: Remote Mining Failure Prediction（远矿失败预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `globalCache.expansionDashboard`（含远矿指标）；`remoteDefenseDecisions`（Map，每 interval 更新）。 | ✅ **数据基本充足**。 |
| **时间序列** | 无远矿收益/威胁频率历史。 | **GAP-5a（中）**：需新建远矿车道历史（净收益 vs tick、威胁频率），可从 `expansionDashboard` 快照序列派生。 |
| **模型** | A6.0 未详细设计远矿预测模型。 | **GAP-5b（低）**：可复用 threshold-projection（收益趋势 → 失败 ETA）。 |
| **ROI 数据** | 远矿 ROI 在 `expansionDashboard.remoteOps` 中有当前值，无历史。 | 同 GAP-5a。 |

**结论**：**可实施，需补充远矿车道历史序列**。

#### GAP-6: Expansion Readiness Prediction（扩张准备预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `globalCache.expansionDashboard`（含 readiness 评分、候选池）；G1-G5 门控结果在 `expansion-planner.ts` 内部计算。 | ✅ **数据基本充足**。 |
| **时间序列** | 无扩张准备度历史。 | **GAP-6a（低）**：需新建扩张准备度历史（heap 数组），但预测价值较低——扩张是低频决策，历史数据积累慢。 |
| **模型** | A6.0 设计了阈值投影。 | ✅ 模型简单。 |

**结论**：**可实施，但优先级低**——扩张是低频事件，预测价值有限。

#### GAP-7: CPU Pressure Prediction（CPU 压力预测）

| 维度 | 现状 | 差距 |
|------|------|------|
| **数据源** | `empireHealth.dimensions.cpu`（globalCache）；`Game.cpu.bucket`（引擎直接读取）；`globalCache.cpuByHome`（每房 CPU 消耗 Map）；`globalCache.systemBudgetEma`（系统 CPU EMA Map）。 | ✅ **数据充足**。CPU 健康度、bucket、系统 EMA 均有。 |
| **时间序列** | `__healthHistory` 含 score 但不特定于 CPU 维度。 | **GAP-7a（低）**：需新建 CPU bucket 历史采样（heap 数组）。bucket 是每 tick 可读的，采样成本低。 |
| **模型** | A6.0 设计了线性回归 + R²。 | ✅ 模型可实现。 |
| **看门狗阈值** | 看门狗四档（Healthy/Guarded/Conserve/Recovery）在 kernel 中定义。 | ✅ 阈值已有。 |

**结论**：**可实施**。需补充 bucket 历史采样。

### 2.2 第二阶段预测目标（5 个）— 标记差距但不实施

| # | 预测目标 | 阻塞差距 | 依赖 |
|---|---------|---------|------|
| 8 | Resource Imbalance | `empireResourceLedger` 有当前快照但无历史趋势序列；`resourceBottlenecks` 有当前列表但无时间序列。 | 需 A6.2 级别的历史采集基础设施。 |
| 9 | Hostile Arrival | Player Intelligence 未实现（A6.0 `A6_0_PLAYER_INTELLIGENCE.md` 明确为第二阶段）。 | 需 PlayerProfile + PlayerIntel 历史数据。 |
| 10 | War Escalation | `warPlanCache` 有当前计划但无战争历史序列；`warAbortSignals` 有止损信号但无历史趋势。 | 需战争遥测历史采集。 |
| 11 | Enemy Behavior | 同 #9，需 Player Intelligence。 | 同 #9。 |
| 12 | Recovery Probability | `recoveryStats` 有统计（succeededCount/failedCount/avgRecoveryTime）但无按类型分的时间序列。 | 需恢复事件历史序列。 |

---

## 三、基础设施差距

### 3.1 时间序列存储

| 需求 | 现状 | 差距 |
|------|------|------|
| **通用时间序列容器** | 各系统各自维护 heap 数组（`__netFlowHistory`、`__reserveHistory`、`__healthHistory` 等），格式不统一。 | **GAP-INF-1（中）**：需要统一的时间序列容器类型（`TimeSeries<T>`），附带 tick 标注、容量上限、滑动窗口截断。 |
| **跨 global reset 持久化** | 所有历史数组均在 heap，global reset 后丢失。 | **GAP-INF-2（低）**：对于预测而言，reset 后从零重建是可接受的（A6.0 明确 prediction 是可观测设施，非持久真相）。但需在 reset 后的首个采样周期内快速重建。 |
| **采样频率** | 各系统采样频率不一（100t / interval），无统一调度。 | **GAP-INF-3（低）**：预测系统应复用既有采样节奏，不自建采样通道（遵守 Shadow-Only + 寄生原则）。 |

### 3.2 确定性保证

| 需求 | 现状 | 差距 |
|------|------|------|
| **稳定哈希** | `fnv1a32Hex` 和 `stableStringify` 已在 A6.1/A6.2 使用。 | ✅ 可复用。 |
| **纯函数** | A6.1/A6.2 域代码全部是纯函数。 | ✅ 预测域代码应遵循同一模式。 |
| **排序保证** | Ring Buffer 遍历已有排序保证。 | ✅ 可复用。 |

### 3.3 Ring Buffer 基础设施

| 需求 | 现状 | 差距 |
|------|------|------|
| **Experience Ring Buffer** | `ExperienceRingBuffer` 已在 A6.1 实现。 | ✅ 可作为预测历史数据的参考模式。 |
| **Evaluation Ring Buffer** | `EvaluationRingBuffer` 已在 A6.2 实现。 | ✅ 可作为预测结果存储的参考模式。 |
| **Prediction Ring Buffer** | 不存在。 | **GAP-INF-4（低）**：需新建 `PredictionRingBuffer`，结构同构于现有 Ring Buffer。 |

### 3.4 globalCache 接入

| 需求 | 现状 | 差距 |
|------|------|------|
| **预测结果存储** | `__evaluationCache` 已在 globalCache 定义（unknown 类型）。 | **GAP-INF-5（低）**：需新增 `__predictionCache?: unknown` 字段到 GlobalCache 接口，同构于 `__evaluationCache`。 |
| **预测历史采样** | 无统一字段。 | **GAP-INF-6（低）**：各预测目标的历史序列可挂在 globalCache 的 heap 字段上，同构于 `__healthHistory` 等。 |

---

## 四、架构对齐差距

### 4.1 与 A6.0 Safety Boundary 的对齐

| 约束 | 现状 | 差距 |
|------|------|------|
| **Shadow-Only** | A6.1/A6.2 已严格遵守，预测层应继承。 | ✅ 无差距。 |
| **Validation Gate** | A6.0 设计了 7 项检查，但 A6.2 尚未实现 Validation Gate（属 A6.6 范围）。 | **GAP-ARCH-1（预期）**：预测层产出 Recommendation 时需经 Validation Gate，但该 Gate 在 A6.6 实现。A6.3 阶段预测只产出 Prediction 对象，不产出 Recommendation。 |
| **不执行 Game API** | A6.1/A6.2 域代码无 Game 引用。 | ✅ 预测域代码应遵循。 |
| **不进入 tick 关键路径** | A6.1/A6.2 系统代码走低频 cadence。 | ✅ 预测系统应走低频 cadence（≥500t 或复用 evaluation cadence）。 |

### 4.2 与 A5 架构的对齐

| 约束 | 现状 | 差距 |
|------|------|------|
| **posture 不因预测改变** | posture 由 Policy 纯函数求值，预测不参与。 | ✅ 无差距。 |
| **看门狗不受预测影响** | 看门狗降级立即生效，不等预测。 | ✅ 无差距。 |
| **Recovery 档预测全停** | A6.0 明确要求。 | **GAP-ARCH-2（低）**：需在预测系统层加 Recovery 档守卫（读看门狗档位，Recovery 时跳过）。 |
| **不复用 P0 通道** | A6.1/A6.2 系统在 P2/P3 档运行。 | ✅ 预测系统应走 P3 档。 |

### 4.3 与 A6.2 Strategy Evaluation 的衔接

| 衔接点 | 现状 | 差距 |
|--------|------|------|
| **Evaluation → Prediction 输入** | `StrategyEvaluationResult`（含 8 维度 StrategyScore）已在 globalCache。 | ✅ Evaluation 结果可作为预测的输入之一。 |
| **Baseline → Prediction 阈值** | `BaselineComparison` 已有 deviation 和 verdict。 | ✅ Baseline 可作为预测阈值的来源。 |
| **Evidence → Prediction Evidence** | `EvaluationEvidence` 和 `EvidenceChain` 已有 traceability。 | ✅ 预测的 evidence 字段可引用 Evaluation Evidence ID。 |

---

## 五、差距汇总与优先级

### 5.1 差距分类

| 类别 | 差距数 | 说明 |
|------|--------|------|
| **数据采集差距** | 7 | 需新建时间序列采样（heap 数组，寄生既有 cadence） |
| **基础设施差距** | 6 | 需新建通用容器 / Ring Buffer / globalCache 字段 |
| **架构对齐差距** | 2 | Recovery 守卫 + Validation Gate 延迟到 A6.6 |
| **模型差距** | 0 | 所有第一阶段预测模型均可由规则 + 统计实现 |

### 5.2 优先级排序

| 优先级 | 差距 ID | 描述 | 实施阶段 |
|--------|---------|------|---------|
| P0 | GAP-INF-1 | 统一时间序列容器 `TimeSeries<T>` | A6.3.1 |
| P0 | GAP-INF-4 | PredictionRingBuffer | A6.3.1 |
| P0 | GAP-INF-5 | globalCache `__predictionCache` 字段 | A6.3.1 |
| P1 | GAP-1a | 能量时间序列附带 tick | A6.3.1（在 TimeSeries 容器中解决） |
| P1 | GAP-7a | CPU bucket 历史采样 | A6.3.1 |
| P1 | GAP-3a | 物流健康度历史序列 | A6.3.1 |
| P1 | GAP-4a | Room-level health 历史序列 | A6.3.1 |
| P2 | GAP-2a/b | Spawn 队列深度历史 | A6.3.2 |
| P2 | GAP-5a | 远矿车道历史 | A6.3.2 |
| P2 | GAP-6a | 扩张准备度历史 | A6.3.2（低优先级） |
| P3 | GAP-ARCH-2 | Recovery 档守卫 | A6.3.1 |
| P3 | GAP-ARCH-1 | Validation Gate 延迟 | A6.6（不阻塞 A6.3） |

### 5.3 关键结论

1. **A6.3 可以开始实施**——A6.1/A6.2 提供的数据基础足以支撑 7 个第一阶段预测目标中的大部分。
2. **主要差距是时间序列采集**——现有系统只存当前快照，不存历史序列。需要新建通用 `TimeSeries<T>` 容器和各目标的历史采样。
3. **模型差距为零**——所有第一阶段预测模型（趋势外推、阈值投影、统计推断）均可由规则 + 统计纯函数实现，无外部依赖。
4. **基础设施差距小**——PredictionRingBuffer 和 globalCache 字段可直接复用 A6.1/A6.2 的 Ring Buffer 模式。
5. **架构对齐差距可控**——Recovery 档守卫是简单条件判断；Validation Gate 延迟到 A6.6 不阻塞 A6.3。
6. **第二阶段预测目标被 Player Intelligence 阻塞**——Hostile Arrival、Enemy Behavior 等需要 PlayerProfile 数据，属 A6.4+ 范围。
