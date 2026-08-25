# A6.2 — Pre-Implementation Audit

> **阶段**: A6.2 Strategy Evaluation & Baseline
> **日期**: 2026-08-25
> **前置**: A6.0 Intelligence Architecture ✅ | A6.1 Experience & Outcome Attribution ✅
> **约束**: 审计文档，不修改任何代码。本次审计是 A6.2 实施的前置条件。

---

## 一、审计目标

本文档对当前代码库进行真实代码审计，回答以下问题：

1. A6.1 的 Experience → Outcome → Attribution 调用链是否完整？
2. 当前系统存在哪些 Strategy Identity？
3. 当前系统存在哪些已有 Metrics 可作为 Evaluation Evidence？
4. A6.0 定义的 Baseline 模型在当前代码中的存在状态？
5. A6.0 定义的 8 维 Strategy Evaluation 框架在当前代码中的缺口？
6. A6.0 命名契约（StrategyScore / DimensionScore / StrategyType / verdict）在代码中的状态？
7. 是否存在第二套 Metrics / Strategy / DecisionTrace？
8. A6.1 是否保持了 Shadow-Only 边界？

---

## 二、A6.1 Experience → Outcome → Attribution 调用链审计

### 2.1 调用链全景

```
DecisionTrace System (interval=100, P3, post)
  ↓ 产出 DecisionRecord[] → globalCache.__decisionTraceCache.ringBuffer
  ↓
Experience Collector System (interval=100, P3, post)
  ↓ collectNewExperiences()
  │   ← 读取 globalCache.__decisionTraceCache.ringBuffer.records
  │   ← categoryToExperienceType(record.category) 映射类型
  │   ← buildDecisionRef() 构建引用（不复制完整 DecisionRecord）
  │   ← buildExperienceContext() 构建上下文摘要
  │   ← createExperience() 创建 ExperienceRecord (lifecycle=OBSERVED)
  │   ← pushExperience() 写入 Ring Buffer
  ↓
  ↓ collectPendingOutcomes()
  │   ← getPendingOutcomes(ringBuffer) 获取未采集 Outcome 的 Experience
  │   ← isDecisionReadyForOutcome() 检查测量延迟是否到期
  │   ← buildOutcomeCollectionInput() 从 globalCache 采集运行时状态
  │   ← collectOutcome() 调用 domain 纯函数采集 OutcomeRecord
  │   ← attachOutcome() 附加 Outcome (lifecycle=OPEN)
  ↓
  ↓ collectPendingAttributions()
  │   ← getUnattributed(ringBuffer) 获取未归因的 Experience
  │   ← buildAttributionInput() 从 globalCache 采集归因输入
  │   ← collectAttribution() 调用 domain 纯函数采集 Attribution
  │   ← attachAttribution() 附加 Attribution (lifecycle=ATTRIBUTED)
  │   ← finalizeExperience() 最终化 (lifecycle=FINALIZED)
  ↓
  ↓ gcExperienceBuffer() — GC 过老记录
  ↓
  ↓ experienceStats() — 可观测性输出
```

### 2.2 审计结论

| 检查项 | 状态 | 详情 |
|--------|------|------|
| Experience 如何产生 | ✅ | 从 DecisionTrace Ring Buffer 读取 DecisionRecord，经 `categoryToExperienceType` 映射为 ExperienceType |
| Experience 生命周期 | ✅ | OBSERVED → OPEN → ATTRIBUTED → FINALIZED / EXPIRED / UNRESOLVED |
| Experience 的 tick 范围 | ✅ | `MEASUREMENT_DELAYS` 定义各类型延迟：war=500, expansion=2000, economic=500, defense=200, logistics=200, spawn=150, recovery=100 |
| Experience 与 Strategy 的关联方式 | ✅ | 通过 `ExperienceContext.posture` 字段记录决策时姿态 |
| Experience 如何引用 Decision | ✅ | 通过 `DecisionRef.decisionId` 引用，不复制完整 DecisionRecord |
| Experience 如何引用 Outcome | ✅ | `ExperienceRecord.outcome: OutcomeRecord | undefined`，通过 `attachOutcome` 附加 |
| Attribution 如何保存 | ✅ | `ExperienceRecord.attribution: Attribution | undefined`，通过 `attachAttribution` 附加 |
| Attribution 是否 Evidence-based | ✅ | 每条 `Attribution` 包含 `evidence: AttributionEvidence[]`，每条 evidence 有 metric/actual/threshold/suggestsFactor/strength |
| Attribution 是否确定性 | ✅ | `attributionHash()` 使用 FNV-1a + stableStringify，禁止 Math.random / Date.now |
| Domain 层无 Runtime 引用 | ✅ | `experience.ts` / `outcome.ts` / `attribution.ts` 均为纯函数，不引用 Game/Memory/RawMemory |
| System 层 Shadow-Only | ✅ | `experience-collector-system.ts` 只读取 globalCache / Memory（只读），不执行任何 Game API |
| System 注册 | ✅ | 在 `bootstrap.ts` 中注册，P3, interval=100, post 阶段 |
| Ring Buffer 有界 | ✅ | `RING_BUFFER_CAPACITY = 500`，环形覆盖 |
| GC 机制 | ✅ | `gcExperienceBuffer()` 删除超 `EXPERIENCE_MAX_AGE = 10000` tick 的记录 |
| `processedDecisionIds` 有界 | ✅ | 超 5000 条时清理旧 2000 条 |

### 2.3 发现的潜在问题

| 问题 | 严重度 | 详情 |
|------|--------|------|
| `buildOutcomeCollectionInput` 中 `stateAfterHash` 为空串占位 | MEDIUM | OutcomeRecord.stateAfterHash 实际无值，影响确定性验证链完整性 |
| `buildOutcomeCollectionInput` 中部分类型数据采集不完整 | MEDIUM | expansion 类型未采集 expansionOutcome；defense 类型仅采集 hostilesInRoom |
| `buildAttributionInput` 中 war 类型的编队/损失数据缺失 | MEDIUM | `warOurComposition` / `warEnemyComposition` / `warOurLosses` / `warEnemyLosses` 未填充 |
| `processedDecisionIds` 清理策略粗放 | LOW | 直接删除最旧 2000 条，可能删除仍在 Ring Buffer 中的活跃记录 |

---

## 三、Strategy Identity 体系审计

### 3.1 当前代码中存在的策略实体

| 实体 | 位置 | 类型 | 是否 Strategy Identity |
|------|------|------|----------------------|
| **EmpirePosture** | `src/domain/strategy/posture.ts` | `"develop" \| "expand" \| "fortify" \| "war"` | ✅ 帝国级策略姿态 |
| **AgendaInitiative** | `src/domain/strategy/agenda.ts` | `"recovery" \| "defense-readiness" \| "rcl-push" \| "develop"` | ✅ 帝国级短期议程 |
| **CapacityTier** | `src/domain/strategy/capacity.ts` | `"healthy" \| "guarded" \| "conserve" \| "recovery"` | ✅ CPU 容量分档 |
| **WarPlan** | `src/domain/war/planning.ts` | operation FSM (recruit→build→advance→engage→rotate) | ✅ 军事策略 |
| **ColonyState** | `src/types/global.d.ts` | `"bootstrap" \| "normal" \| "defense" \| "recovery"` | ✅ 房间级策略状态 |
| **ExpansionReadiness** | `src/domain/strategy/readiness.ts` | `"NOT_READY" \| "READY" \| "STRONGLY_READY"` | ⚠️ 不是策略本身，是策略前置门控 |
| **TacticalDecision** | `src/domain/tactical/` | FSM (MOVING→POSITIONING→ENGAGING→...) | ⚠️ 战术执行决策，不是 Strategy Identity |
| **DecisionCategory** | `src/domain/strategy/decision-trace.ts` | 11 类枚举 | ⚠️ 决策类别，不是策略本身 |
| **ExperienceType** | `src/domain/intelligence/experience.ts` | 7 类枚举 | ⚠️ 经验类别，映射自 DecisionCategory |

### 3.2 A6.0 定义的 StrategyType 对照

A6.0 在 `A6_0_STRATEGY_EVALUATION.md` §2.3 定义了：

```typescript
type StrategyType =
  | "empire-posture"     // 帝国姿态
  | "economic"           // 经济策略
  | "expansion"          // 扩张策略
  | "military"           // 军事策略
  | "defense"            // 防御策略
  | "logistics"          // 物流策略
  | "spawn"              // 孵化策略
  | "room"               // 房间策略
  | "market";            // 市场策略
```

**审计结论**：

| A6.0 StrategyType | 当前代码对应实体 | 映射方式 |
|-------------------|-----------------|---------|
| `empire-posture` | `EmpirePosture` | 直接映射（4 值枚举） |
| `economic` | `ExperienceType: "economic"` + `EmpireHealth.energyScore` | 经 ExperienceType 间接映射 |
| `expansion` | `ExperienceType: "expansion"` + `ExpansionReadiness` | 经 ExperienceType 间接映射 |
| `military` | `ExperienceType: "war"` + `WarPlan` | 经 ExperienceType 间接映射 |
| `defense` | `ExperienceType: "defense"` | 经 ExperienceType 间接映射 |
| `logistics` | `ExperienceType: "logistics"` | 经 ExperienceType 间接映射 |
| `spawn` | `ExperienceType: "spawn"` | 经 ExperienceType 间接映射 |
| `room` | `ColonyState` | 无直接映射（需新增） |
| `market` | 无 | 代码中无市场策略实体 |

### 3.3 Strategy Identity 结论

1. **不自行创造新的 Strategy ID** ✅ — A6.0 已定义 StrategyType 枚举
2. 当前系统的 Strategy 体系以 `EmpirePosture` 为核心裁决（唯一帝国级策略状态机）
3. `ExperienceType`（7 类）是 A6.1 已有的经验分类，可作为 Strategy Evaluation 的分域维度
4. A6.0 的 `StrategyType`（9 类）比 `ExperienceType`（7 类）多出 `room` 和 `market`，少了 `recovery`
5. **推荐**：A6.2 Strategy Evaluation 的分域维度以 A6.0 `StrategyType` 为准，但评估数据来源从 `ExperienceType` 映射

---

## 四、Outcome 体系审计

### 4.1 当前已有的 Outcome 类型

| Experience 类型 | Outcome 采集函数 | 数据来源 | 状态 |
|----------------|-----------------|---------|------|
| war | `collectWarOutcome()` | `evaluateWarOutcome` via `warPlanCache.plan.operation.status` | ✅ 已实现 |
| recovery | `collectRecoveryOutcome()` | `recoveryStats` from globalCache | ✅ 已实现 |
| economic | `collectEconomicOutcome()` | `empireHealth` score delta | ✅ 已实现 |
| logistics | `collectLogisticsOutcome()` | `logisticsHealth` level delta | ✅ 已实现 |
| spawn | `collectSpawnOutcome()` | `spawnQueueLength` + `spawnP0Count` | ✅ 已实现 |
| expansion | `collectExpansionOutcome()` | `expansionOutcome` event | ⚠️ 系统层采集不完整 |
| defense | `collectDefenseOutcome()` | `threatLevel` delta + `structuresDestroyed` | ⚠️ 系统层采集不完整 |

### 4.2 OutcomeClassification

A6.1 已定义 6 类分类（禁止简单二元化）：

```
SUCCESS | PARTIAL_SUCCESS | FAILURE | ABORTED | EXPIRED | UNKNOWN
```

### 4.3 结论

- **不重复实现 Outcome** ✅ — A6.2 将直接消费 A6.1 已有的 `OutcomeRecord`
- A6.2 不需要新建 Outcome 采集函数，只需要从 Experience Ring Buffer 中读取已 FINALIZED 的 ExperienceRecord
- 部分类型的系统层数据采集不完整（expansion, defense），但这是 A6.1 的遗留问题，不属于 A6.2 范围

---

## 五、Existing Metrics 体系审计

### 5.1 Empire Health 8 维度（A4.5）

| 维度 | 量化方法 | 数据来源 | 可作 Evaluation Evidence |
|------|---------|---------|------------------------|
| Energy | `DimensionHealth` + score (0..1) | `empireEconomy` | ✅ Economic Growth |
| Mineral | `DimensionHealth` + score (0..1) | `multiResourceHealth` | ✅ Resource Efficiency |
| Logistics | `DimensionHealth` + score (0..1) | `logisticsHealth` | ✅ Logistics Health |
| Network | `DimensionHealth` + score (0..1) | `networkHealth` | ✅ (扩展维度) |
| Colony | `DimensionHealth` + score (0..1) | `colonyState` 聚合 | ✅ Expansion Success |
| Threat | `DimensionHealth` + score (0..1) | `posture` 映射 | ✅ Risk Level / Defense |
| Spawn | `DimensionHealth` + score (0..1) | spawn 状态 | ✅ Survival / Spawn |
| CPU | `DimensionHealth` + score (0..1) | `budget.tier` | ✅ CPU Efficiency |

**关键结构**：
```typescript
interface EmpireHealthResult {
  level: EmpireHealthLevel;    // "healthy" | "stable" | "degraded" | "critical"
  score: number;               // 加权汇总 0..1
  dimensions: HealthDimensionScore[]; // 8 维独立评分
  worstDimension: string;
  bottleneck: string;
  recovering: boolean;
  evidence: string;
  tick: number;
}
```

### 5.2 Autonomy Metrics（A4.5）

| 指标 | 函数 | 可作 Evaluation Evidence |
|------|------|------------------------|
| Autonomy Score (0..100) | `computeAutonomyScore()` | ✅ Stability |
| No-Progress 检测 | `detectNoProgress()` | ✅ Trend / Recovery |
| Thrashing 检测 | `detectThrashing()` | ✅ Stability |
| 综合自治状态 | `evaluateAutonomyStatus()` | ✅ Survival |

**关键维度**：
- 经济闭环率 (25%)
- 失败恢复率 (25%)
- 人工干预 (20%)
- 稳态维持 (15%)
- 扰动恢复 (15%)

### 5.3 Tuning Engine 指标

| 指标 | 来源 | 可作 Evaluation Evidence |
|------|------|------------------------|
| 参数调整效果 (improved/worsened) | `verifyPendingAdjustments()` | ✅ Efficiency |
| 回滚率 | `applyFreezePolicy()` | ✅ Stability |
| 信号趋势 (up/down/none) | `evaluateTuning()` | ✅ Trend |

### 5.4 其他已有 Metrics

| 指标 | 来源 | 位置 |
|------|------|------|
| 战争胜率 | `evaluateWarOutcome()` | `src/domain/war/planning.ts` |
| 物流健康度 | `logisticsHealth` | `globalCache.logisticsHealth` |
| 恢复统计 | `recoveryStats` | `globalCache.recoveryStats` |
| 帝国经济 | `empireEconomy` | `Memory.kernel.empireEconomy` |
| 事件日志 | `EventLog` (40+ EventKind) | `src/kernel/event-log.ts` |
| 失败传播图 | `FailureGraph` | `src/domain/strategy/failure-propagation.ts` |

### 5.5 结论

1. **禁止重新计算已有指标** ✅ — A6.2 将直接消费上述已有 Metrics
2. 当前系统已有足够丰富的 Metrics 可作为 Strategy Evaluation 的 Evidence 来源
3. 不需要建立第二套 Metrics 体系
4. A6.2 的 Evaluation Evidence 应从以下已有来源采集：
   - `globalCache.empireHealth` → 8 维度健康度
   - `globalCache.autonomyStatus` → 自治状态
   - `globalCache.__experienceCache` → A6.1 Experience Ring Buffer
   - `globalCache.recoveryStats` → 恢复统计
   - `globalCache.logisticsHealth` → 物流健康度
   - `globalCache.warPlanCache` → 战争计划状态
   - `Memory.kernel.strategy` → 姿态状态
   - `Memory.kernel.tuning` → 参数调整效果

---

## 六、A6.0 Baseline 模型审计

### 6.1 A6.0 定义的 Baseline

A6.0 在 `A6_0_STRATEGY_EVALUATION.md` §5.1 定义了 3 类基准来源：

| 基准类型 | 来源 | 用途 |
|---------|------|------|
| CONFIG 默认值 | `CONFIG` 常量 | 静态基准 |
| 历史均值 | Episodic Memory 中的历史数据 | 动态基准 |
| 社区经验 | 研究文档中的社区数据点 | sanity check |

### 6.2 当前代码中的 Baseline 状态

| Baseline 类型 | 代码中是否存在 | 详情 |
|---------------|----------------|------|
| CONFIG 静态基准 | ✅ 存在 | `CONFIG` 中有大量默认参数（如 `DEFAULT_POSTURE_OPTIONS`, `TUNING_BOUNDS`），tuning-engine 有 `buildConfigBaselines()` |
| 历史均值 | ⚠️ 部分 | `empire-health-system.ts` 有 `healthHistory` / `postureHistory`（heap），但无结构化历史基线 |
| Episodic Memory 基准 | ❌ 不存在 | A6.0 Roadmap 中 Episodic Memory 属于 A6.2 阶段，尚未实现 |
| 社区经验基准 | ❌ 不存在 | 研究文档中有数据点，但代码中未使用 |

### 6.3 Tuning Engine 中的 Baseline

tuning-engine 已有一个简单的 "调整前 vs 调整后" 比较（`PendingValidation.preAdjustSignals` + `isImprovedMultiSignal`），但这只是参数级 baseline，不是策略级 baseline。

### 6.4 A6.0 Roadmap 中的 Baseline 阶段

A6.0 Roadmap 将 Long-Term Memory 列为 **A6.2** 阶段：

> A6.2 — Long-Term Memory: 建立 Episodic + Semantic + Combat Memory, segment 存储 + GC + 降采样

但 A6.1 的实际实现中，Experience Ring Buffer 只在 heap 中（`globalCache.__experienceCache`），未持久化到 segment。这意味着 A6.2 最初设计的是先建长期记忆再做 Evaluation，但 Task Spec 重新定义了 A6.2 为 Strategy Evaluation。

### 6.5 Baseline 结论

1. **A6.0 定义的 Baseline 模型在当前代码中不存在策略级 Baseline**
2. 当前只有参数级 Baseline（tuning-engine 的 pre/post 比较）
3. A6.2 需要建立策略级 Baseline，可使用：
   - **Phase Baseline**：以当前 Experience Ring Buffer 中的历史 Experience 作为滚动基线
   - **CONFIG 静态基准**：以 CONFIG 中的默认参数为静态基准
   - **不使用 Episodic Memory**（属于 A6.0 Roadmap 中 A6.2 原定义，但当前 Task Spec 重新定义了 A6.2 为 Strategy Evaluation，Long-Term Memory 尚未建立）
4. **推荐 Baseline 策略**：使用 **Rolling Baseline**（基于 Experience Ring Buffer 中的历史数据计算滚动中位数/均值），辅以 CONFIG 静态基准作为 sanity check

---

## 七、A6.0 8 维 Strategy Evaluation 框架审计

### 7.1 A6.0 定义的 8+1 维度

A6.0 在 `A6_0_STRATEGY_EVALUATION.md` §2.2 和 `A6_0_FINAL_RESEARCH.md` §3.4 定义了两套维度：

**A6_0_STRATEGY_EVALUATION.md §2.2（9 维）**：

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

**A6_0_FINAL_RESEARCH.md §3.4（8 维）**：

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

### 7.2 两套维度的冲突

A6.0 两份文档在维度定义上存在差异：

| STRATEGY_EVALUATION.md 维度 | FINAL_RESEARCH.md 维度 | 差异 |
|---------------------------|----------------------|------|
| Economic Growth | EconomicGrowth | ✅ 一致 |
| Resource Efficiency | ResourceEfficiency | ✅ 一致 |
| CPU Efficiency | CpuEfficiency | ✅ 一致 |
| Risk Level | — | FINAL_RESEARCH 无此维度 |
| Survival | Survival | ✅ 一致 |
| Expansion | ExpansionSuccess | ✅ 一致 |
| Military Outcome | MilitaryEffectiveness | ✅ 一致 |
| Recovery Cost | — | FINAL_RESEARCH 无此维度 |
| Opportunity Cost | — | FINAL_RESEARCH 无此维度 |
| — | LogisticsHealth | STRATEGY_EVALUATION 无此维度 |
| — | TechProgress | STRATEGY_EVALUATION 无此维度 |

### 7.3 Task Spec 要求的 8 维

Task Spec §五要求 8 维：
> survival, economic, logistics, military, expansion, recovery, efficiency, stability

这与 A6.0 两份文档都不同。

### 7.4 当前代码中的维度体系

当前代码已有两套维度体系：
1. **EmpireHealth 8 维度**（A4.5）：energy, mineral, logistics, network, colony, threat, spawn, cpu
2. **AutonomyMetrics 5 维度**（A4.5）：economicLoop, failureRecovery, manualIntervention, stability, perturbationRecovery

### 7.5 冲突解决

**推荐方案**：以 A6.0 `A6_0_STRATEGY_EVALUATION.md` §2.2 的 9 维为权威定义（因为它是最详细的策略评估维度设计），但取前 8 维（排除 `Opportunity Cost`，因为标注为 "后期"），并将 `LogisticsHealth` 作为 `Resource Efficiency` 的子指标。

**最终 A6.2 评估维度**（8 维，以 A6.0 为准）：

| # | 维度名 | A6.0 来源 | 当前已有数据来源 |
|---|--------|----------|-----------------|
| 1 | Economic Growth | STRATEGY_EVALUATION §2.2 | `empireHealth.dimensions[energy]` + `empireHealth.score` delta |
| 2 | Resource Efficiency | STRATEGY_EVALUATION §2.2 | `empireHealth.dimensions[logistics]` + `logisticsHealth.deliveryRate` |
| 3 | CPU Efficiency | STRATEGY_EVALUATION §2.2 | `empireHealth.dimensions[cpu]` + `ctx.budget.tier` |
| 4 | Risk Level | STRATEGY_EVALUATION §2.2 | `empireHealth.dimensions[threat]` |
| 5 | Survival | STRATEGY_EVALUATION §2.2 | `empireHealth.score` + `autonomyStatus.score` + `recoveryStats` |
| 6 | Expansion | STRATEGY_EVALUATION §2.2 | `empireHealth.dimensions[colony]` + ExpansionOutcome events |
| 7 | Military Outcome | STRATEGY_EVALUATION §2.2 | `evaluateWarOutcome` + WarOutcome events |
| 8 | Recovery Cost | STRATEGY_EVALUATION §2.2 | `recoveryStats` + `recoveryActionTable` |

---

## 八、A6.0 命名契约审计

### 8.1 A6.0 定义的命名

```typescript
// A6_0_STRATEGY_EVALUATION.md §2.3
interface StrategyScore {
  strategyType: StrategyType;
  window: { from: number; to: number };
  samples: number;
  dimensions: {
    economicGrowth: DimensionScore;
    resourceEfficiency: DimensionScore;
    cpuEfficiency: DimensionScore;
    riskLevel: DimensionScore;
    survival: DimensionScore;
    expansion: DimensionScore;
    militaryOutcome: DimensionScore;
    recoveryCost: DimensionScore;
    opportunityCost?: DimensionScore;
  };
  evaluatedAt: number;
  modelVersion: number;
  confidence: number;
}

interface DimensionScore {
  score: number;
  metric: string;
  value: number;
  baseline: number;
  delta: number;
  samples: number;
  confidence: number;
}

type StrategyType =
  | "empire-posture" | "economic" | "expansion" | "military"
  | "defense" | "logistics" | "spawn" | "room" | "market";
```

### 8.2 当前代码中的状态

| 命名 | 代码中是否存在 | 位置 |
|------|----------------|------|
| `StrategyScore` | ❌ | 不存在 |
| `DimensionScore` | ❌ | 不存在（注意：`empire-health.ts` 有 `dimensionScore()` 函数，但不是 `DimensionScore` 接口） |
| `StrategyType` | ❌ | 不存在 |
| `verdict` | ❌ | 不存在 |
| `EvaluationResult` | ❌ | 不存在 |
| `EvaluationEvidence` | ❌ | 不存在 |

### 8.3 结论

- A6.0 定义的所有 Strategy Evaluation 类型在当前代码中均不存在
- A6.2 需要从零创建这些类型
- **必须完全使用 A6.0 原名称**，不得自行发明
- A6.0 未定义 `verdict` 枚举和 `EvaluationResult` 结构，但 Task Spec §十要求了这些，需要按照 Task Spec 设计（verdict = IMPROVING | STABLE | DEGRADING | INCONCLUSIVE）

---

## 九、Shadow-Only 边界审计

### 9.1 A6.1 的 Shadow-Only 验证

| 检查项 | 状态 | 详情 |
|--------|------|------|
| Domain 层无 Game 引用 | ✅ | `experience.ts` / `outcome.ts` / `attribution.ts` 无 `import ... from "game"` 或 `Game.` |
| Domain 层无 Memory 引用 | ✅ | 无 `Memory.` 引用 |
| Domain 层无 RawMemory 引用 | ✅ | 无 `RawMemory.` 引用 |
| Domain 层无 globalThis 引用 | ✅ | 无 `globalThis.` 引用 |
| Domain 层无 console 引用 | ✅ | 无 `console.` 引用 |
| Domain 层无 Kernel 引用 | ✅ | 无 kernel import |
| System 层不执行 Game API | ✅ | `experience-collector-system.ts` 无 `spawnCreep` / `attack` / `move` / `transfer` / `build` |
| System 层不修改 Strategy | ✅ | 不写入 `Memory.kernel.strategy` |
| System 层不修改 Spawn | ✅ | 不调用 `submitRequest()` |
| System 层不修改 Logistics | ✅ | 不调用 logistics 函数 |
| System 层不修改 Military | ✅ | 不调用 war-planner 函数 |
| System 层只读消费 | ✅ | 只从 `globalCache` / `Memory` 读取（不写入业务字段） |
| System 层走 safeRun | ✅ | 通过 Kernel System 注册框架（P3, interval=100, post） |
| Recovery 档全停 | ✅ | P3 系统在 Recovery 档由 Kernel bucket 看门狗自动跳过 |

### 9.2 A6.2 必须继续保持的边界

A6.2 必须遵守同样的 Shadow-Only 约束：

```
正确:
  Runtime State → Snapshot → Experience → Outcome → Attribution → Evaluation → EvaluationResult

错误:
  Evaluation → StrategyManager → ChangeStrategy
```

---

## 十、第二套系统检查

### 10.1 检查结果

| 系统 | 是否第二套 | 详情 |
|------|-----------|------|
| DecisionTrace | ❌ 不是 | A6.1 从 `globalCache.__decisionTraceCache` 读取，不新建 |
| evaluateWarOutcome | ❌ 不是 | A6.1 从 `warPlanCache` 间接消费 |
| EmpireHealth | ❌ 不是 | A6.1 从 `globalCache.empireHealth` 只读消费 |
| RecoveryStats | ❌ 不是 | A6.1 从 `globalCache.recoveryStats` 只读消费 |
| LogisticsHealth | ❌ 不是 | A6.1 从 `globalCache.logisticsHealth` 只读消费 |
| Spawn Queue | ❌ 不是 | A6.1 从 Experience context metrics 读取 |
| Metrics | ❌ 不是 | A6.2 将消费已有 EmpireHealth / AutonomyMetrics / RecoveryStats |
| Strategy | ❌ 不是 | A6.2 不创建第二套 Strategy，只评估已有 Strategy |

---

## 十一、A6.2 实施可行性评估

### 11.1 数据流可行性

```
Experience Ring Buffer (A6.1, heap)
  ↓ getRecentExperiences() 获取 FINALIZED ExperienceRecord[]
  ↓
Strategy Evaluation Domain (A6.2, 纯函数)
  ↓ evaluateStrategy(experiences, empireHealth, autonomyStatus, config, options)
  ↓ 产出 StrategyScore (8 维, 无万能分数)
  ↓
Baseline Comparison Domain (A6.2, 纯函数)
  ↓ compareWithBaseline(current, baseline, options)
  ↓ 产出 BaselineComparison (delta, relativeChange, confidence, evidence)
  ↓
Evaluation Evidence Domain (A6.2, 纯函数)
  ↓ buildEvaluationEvidence(experiences, outcomes, attributions, metrics)
  ↓ 产出 EvaluationEvidence (可追溯的 Experience IDs / Outcome IDs / Attribution IDs)
  ↓
Evaluation Result (A6.2, 纯函数)
  ↓ buildEvaluationResult(strategyIdentity, window, dimensions, baseline, evidence, ...)
  ↓ 产出 EvaluationResult (verdict, deterministicHash, limitations)
  ↓
Strategy Evaluation System (A6.2, 系统薄壳)
  ↓ 读取 globalCache → 调用 domain → 写入 globalCache (heap)
  ↓ P3, interval >= 500, post
```

### 11.2 实施风险

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| Experience Ring Buffer 可能数据不足 | MEDIUM | 样本不足时 verdict = INCONCLUSIVE, confidence = 0 |
| 部分类型系统层采集不完整（expansion, defense） | MEDIUM | A6.2 只评估有足够数据的维度，缺失维度标记 `limitations` |
| A6.0 两份文档维度定义冲突 | LOW | 以 `STRATEGY_EVALUATION.md` 为权威定义 |
| Long-Term Memory 未实现（A6.0 原定 A6.2） | LOW | 使用 heap Ring Buffer 作为滚动基线替代 |
| 无万能 Score 约束 | HIGH | 严格保持 8 维独立评分，aggregate indicator 仅作参考 |

### 11.3 不需要修改 A6.0 冻结契约

审计结论：A6.0 冻结的契约（`StrategyScore` / `DimensionScore` / `StrategyType` / 8 维框架）在当前代码中均不存在，需要从零创建。不存在文档与代码冲突。

**不需要生成 `A6_2_CONTRACT_GAP_REPORT.md`。**

---

## 十二、最终审计结论

### 12.1 审计回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | A6.1 调用链是否完整？ | ✅ 完整。DecisionTrace → Experience → Outcome → Attribution 全链路已实现 |
| 2 | 当前存在哪些 Strategy Identity？ | EmpirePosture (4 值) + AgendaInitiative (4 值) + ColonyState (4 值) + WarPlan FSM + CapacityTier (4 值) |
| 3 | 是否存在第二套 Metrics？ | ❌ 不存在。EmpireHealth 8 维度 + AutonomyMetrics 5 维度是唯一指标体系 |
| 4 | 是否存在万能 Score？ | ❌ 不存在。EmpireHealth 有加权汇总分数但 A6.2 不使用它作为唯一判断 |
| 5 | Baseline 如何定义？ | A6.0 定义了 3 类基准（CONFIG / 历史均值 / 社区经验），当前代码只有参数级 baseline，A6.2 需建立策略级 Rolling Baseline |
| 6 | A6.0 命名在代码中是否存在？ | ❌ 均不存在（StrategyScore / DimensionScore / StrategyType / verdict），需从零创建 |
| 7 | A6.1 是否保持 Shadow-Only？ | ✅ 是。Domain 纯函数无 Runtime 引用，System 只读消费 |
| 8 | 是否存在第二套 Strategy？ | ❌ 不存在 |
| 9 | 是否存在第二套 DecisionTrace？ | ❌ 不存在 |
| 10 | A6 停止后帝国是否安全？ | ✅ 是。A6.1 系统是 P3 post，完全停止不影响 A4/A5 |

### 12.2 A6.2 实施就绪度

| 维度 | 状态 | 说明 |
|------|------|------|
| 数据来源 | ✅ 就绪 | Experience Ring Buffer + EmpireHealth + AutonomyMetrics + RecoveryStats 全部可用 |
| 类型定义 | ✅ 就绪 | A6.0 已定义 StrategyScore / DimensionScore / StrategyType |
| Baseline 模型 | ⚠️ 需设计 | A6.0 定义了 3 类基准，但代码中无策略级 baseline，需设计 Rolling Baseline |
| 8 维框架 | ⚠️ 有冲突 | A6.0 两份文档维度定义有差异，以 STRATEGY_EVALUATION.md 为准 |
| 确定性机制 | ✅ 就绪 | A6.1 已建立 FNV-1a + stableStringify 确定性 hashing，可复用 |
| System 注册 | ✅ 就绪 | bootstrap.ts 注册机制成熟 |
| 测试基础 | ✅ 就绪 | A6.1 测试模式可复用 |

### 12.3 推荐实施计划

1. **Domain 层**（纯函数）：
   - `src/domain/intelligence/strategy-evaluation.ts` — 8 维评估 + StrategyScore 产出
   - `src/domain/intelligence/baseline.ts` — Rolling Baseline + BaselineComparison
   - `src/domain/intelligence/evaluation-evidence.ts` — Evidence 构建 + 可追溯性
   - 更新 `src/domain/intelligence/index.ts` 导出

2. **System 层**（薄壳）：
   - `src/systems/intelligence/strategy-evaluation-system.ts` — 低频评估系统 (P3, interval >= 500, post)
   - 在 `bootstrap.ts` 中注册

3. **Tests**：
   - `tests/unit/intelligence/a6-2-strategy-evaluation.test.ts` — 8 维评估
   - `tests/unit/intelligence/a6-2-baseline.test.ts` — Baseline 比较
   - `tests/unit/intelligence/a6-2-architecture.test.ts` — 架构守卫
   - `tests/integration/intelligence/a6-2-evaluation-e2e.test.ts` — E2E 集成

4. **Documentation**：
   - `docs/phase29/A6_2_STRATEGY_EVALUATION.md`
   - `docs/phase29/A6_2_FINAL_AUDIT.md`

---

## 十三、审计签核

| 检查项 | 结论 |
|--------|------|
| A6.1 调用链完整且 Shadow-Only | ✅ 通过 |
| 不存在第二套 Metrics / Strategy / DecisionTrace | ✅ 通过 |
| 不存在万能 Score | ✅ 通过 |
| A6.0 命名契约无代码冲突（需从零创建） | ✅ 通过 |
| 不需要 A6_2_CONTRACT_GAP_REPORT.md | ✅ 通过 |
| 数据来源已就绪 | ✅ 通过 |
| 确定性机制可复用 | ✅ 通过 |
| A6.2 可以开始实施 | ✅ **批准** |

---

> **审计完成**。A6.2 Strategy Evaluation & Baseline 可以进入实施阶段。
> 实施必须严格遵守本审计的推荐方案和 A6.0 冻结契约。