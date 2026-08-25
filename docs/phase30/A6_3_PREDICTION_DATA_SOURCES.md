# A6.3.0 — Prediction Data Source Map

> **阶段**: A6.3.0 Research / Data Source Mapping
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 逐个映射 7 个第一阶段预测目标到具体数据源（globalCache 字段 + A5 系统输出）

---

## 一、数据源总览

### 1.1 globalCache 中可直接消费的数据

| globalCache 字段 | 类型 | 刷新频率 | 生产者 | 消费者（预测） |
|-----------------|------|---------|--------|---------------|
| `empireHealth` | `EmpireHealthResult` | 100t | `empire-health-system` | #1 #2 #3 #4 #7 |
| `logisticsHealth` | `LogisticsHealthResult` | 100t | `logistics-planner` | #3 |
| `logisticsAccounting` | summary + entries | 100t | `logistics-planner` | #3 |
| `logisticsCapacity` | `EmpireCapacityResult` | 100t | `logistics-planner` | #3 |
| `logisticsScaling` | decisions | 100t | `logistics-planner` | #3 |
| `expansionDashboard` | `ExpansionDashboard` | interval | `expansion-planner` | #5 #6 |
| `recoveryStats` | `RecoveryStats` | interval | `recovery-execution-system` | #4 |
| `autonomyStatus` | `AutonomyStatus` | 100t | `empire-health-system` | #4 |
| `threatAssessments` | `Map<string, ThreatAssessment>` | per-tick | `room-state` | #4 |
| `cpuByHome` | `Map<string, number>` | per-tick | `kernel.runCreeps` | #7 |
| `systemBudgetEma` | `Map<string, number>` | per-tick | `kernel.runSystems` | #7 |
| `empireResourceLedger` | `ResourceLedger` | 100t | `empire-economy` | #1 |
| `warPlanCache` | `WarPlan \| undefined` | interval | `war-planning-system` | #4 |
| `warAbortSignals` | signal object | event | `war-planner` | #4 |
| `marketPrices` | price snapshot | 100t+ | `terminal-manager` | #1 |
| `__healthHistory` | `Array<{tick, level, score}>` | 100t | `empire-health-system` | #4 #7 |
| `__postureHistory` | `Array<{tick, posture}>` | on-change | `empire-health-system` | #4 (regime) |
| `__netFlowHistory` | `number[]` | 100t | `empire-health-system` | #1 |
| `__reserveHistory` | `number[]` | 100t | `empire-health-system` | #1 |
| `__populationHistory` | `number[]` | 100t | `empire-health-system` | #2 |
| `__failureCountHistory` | `number[]` | 100t | `empire-health-system` | #4 |
| `__consecutiveStableTicks` | `number` | per-tick | `empire-health-system` | #4 |
| `__evaluationCache` | Ring Buffer | interval | `strategy-evaluation-system` | 所有 (regime) |
| `__experienceCache` | Ring Buffer | interval | `experience-collector-system` | 所有 (evidence) |

### 1.2 需新建的采样（寄生既有 cadence）

| 新字段 | 类型 | cadence | 寄生系统 | 预测目标 |
|--------|------|---------|---------|---------|
| `__cpuBucketHistory` | `TimeSeriesPoint<number>[]` | 100t | `empire-health-system` | #7 |
| `__spawnQueueDepthHistory` | `TimeSeriesPoint<number>[]` | 100t | `empire-health-system` | #2 |
| `__logisticsHealthHistory` | `TimeSeriesPoint<{score, deliveryRate, lossRate}>[]` | 100t | `empire-health-system` | #3 |
| `__roomHealthHistory` | `Map<string, TimeSeriesPoint<{score, level}>[]>` | 100t | `empire-health-system` | #4 |
| `__remoteMiningHistory` | `TimeSeriesPoint<{netIncome, threatCount}>[]` | 100t | `expansion-planner` | #5 |

---

## 二、逐目标数据源映射

### 2.1 Energy Shortage Prediction

```
预测目标: 能量短缺
方法: trend-extrapolation
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| 净流时间序列 | `__netFlowHistory` | heap 数组 | 100t | ✅ 已有（无 tick 标注 → GAP-1a） |
| 储备时间序列 | `__reserveHistory` | heap 数组 | 100t | ✅ 已有（无 tick 标注） |
| 能量健康度 | `empireHealth.dimensions.energy` | `EmpireHealthResult` | 100t | ✅ 已有 |
| 帝国资源台账 | `empireResourceLedger` | `ResourceLedger` | 100t | ✅ 已有 |
| 市场价格 | `marketPrices` | price snapshot | 100t+ | ✅ 已有 |
| Baseline | `baseline.ts` CONFIG_BASELINE_VALUES | domain 纯函数 | — | ✅ 已有 |
| 看门狗档位 | kernel `watchdogTier` | kernel 状态 | per-tick | ✅ 可读 |

**所需历史**：净流 + 储备的时间序列（≥30 个采样点 = 3000t 历史可做回归）。
**现状**：`__netFlowHistory` 和 `__reserveHistory` 已有，但无 tick 标注。迁移到 `TimeSeries<T>` 容器后自动解决。

### 2.2 Spawn Starvation Prediction

```
预测目标: 孵化饥饿
方法: threshold-projection
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| 人口历史 | `__populationHistory` | heap 数组 | 100t | ✅ 已有 |
| 孵化健康度 | `empireHealth.dimensions.spawn` | `EmpireHealthResult` | 100t | ✅ 已有 |
| 孵化队列深度 | **未暴露** | — | — | ❌ GAP-2a |
| P0 请求数 | **未暴露** | — | — | ❌ GAP-2b |
| 恢复统计 | `recoveryStats` | `RecoveryStats` | interval | ✅ 已有 |

**所需新建**：`__spawnQueueDepthHistory: TimeSeriesPoint<number>[]`，寄生在 `empire-health-system` 的 100t cadence 中。SpawnManager 需暴露当前队列深度到 globalCache。

### 2.3 Logistics Bottleneck Prediction

```
预测目标: 物流瓶颈
方法: statistical-inference
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| 物流健康度 | `logisticsHealth` | `LogisticsHealthResult` | 100t | ✅ 已有 |
| 物流会计 | `logisticsAccounting` | summary + entries | 100t | ✅ 已有 |
| 物流容量 | `logisticsCapacity` | `EmpireCapacityResult` | 100t | ✅ 已有 |
| 物流扩缩编 | `logisticsScaling` | decisions | 100t | ✅ 已有 |
| 物流计数器 | `logisticsCounters` | idleTicks/claims | per-tick | ✅ 已有 |
| 物流历史 | **未采集** | — | — | ❌ GAP-3a |

**所需新建**：`__logisticsHealthHistory: TimeSeriesPoint<{score, deliveryRate, lossRate}>[]`，寄生在 `empire-health-system` 的 100t cadence 中。

### 2.4 Room Collapse Prediction

```
预测目标: 房间崩溃
方法: threshold-projection + statistical-inference（多信号聚合）
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| 帝国健康度历史 | `__healthHistory` | heap 数组 | 100t | ✅ 已有（帝国级） |
| 殖民地健康度 | `empireHealth.dimensions.colonies` | `EmpireHealthResult` | 100t | ✅ 已有（帝国级聚合） |
| 威胁评估 | `threatAssessments` | `Map<string, ThreatAssessment>` | per-tick | ✅ 已有（按房） |
| 恢复统计 | `recoveryStats` | `RecoveryStats` | interval | ✅ 已有 |
| 自治状态 | `autonomyStatus` | `AutonomyStatus` | 100t | ✅ 已有 |
| 失败计数历史 | `__failureCountHistory` | heap 数组 | 100t | ✅ 已有 |
| 稳态 tick 数 | `__consecutiveStableTicks` | heap number | per-tick | ✅ 已有 |
| Room-level health | **未采集** | — | — | ❌ GAP-4a |

**所需新建**：`__roomHealthHistory: Map<string, TimeSeriesPoint<{score, level}>[]>`，寄生在 `empire-health-system` 的 100t cadence 中。从 `empireHealth.dimensions` 拆出 per-room 数据。

### 2.5 Remote Mining Failure Prediction

```
预测目标: 远矿失败
方法: threshold-projection
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| 扩张面板 | `expansionDashboard` | `ExpansionDashboard` | interval | ✅ 已有 |
| 远矿防御决策 | `remoteDefenseDecisions` | `Map<string, RemoteDefenseDecision>` | interval | ✅ 已有 |
| 远矿收益历史 | **未采集** | — | — | ❌ GAP-5a |

**所需新建**：`__remoteMiningHistory: TimeSeriesPoint<{netIncome, threatCount}>[]`，寄生在 `expansion-planner` 的 interval cadence 中。从 `expansionDashboard.remoteOps` 派生净收益。

### 2.6 Expansion Readiness Prediction

```
预测目标: 扩张准备度
方法: threshold-projection
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| 扩张面板 | `expansionDashboard` | `ExpansionDashboard` | interval | ✅ 已有 |
| 扩张历史 | **未采集** | — | — | ❌ GAP-6a（低优先级） |

**所需新建**：`__expansionReadinessHistory: TimeSeriesPoint<number>[]`，低优先级，可在 A6.3.2 补充。

### 2.7 CPU Pressure Prediction

```
预测目标: CPU 压力
方法: trend-extrapolation
```

| 输入 | 数据源 | globalCache 路径 | 采样频率 | 现状 |
|------|--------|-----------------|---------|------|
| CPU 健康度 | `empireHealth.dimensions.cpu` | `EmpireHealthResult` | 100t | ✅ 已有 |
| Bucket | `Game.cpu.bucket` | 引擎直接 | per-tick | ✅ 可读 |
| Per-room CPU | `cpuByHome` | `Map<string, number>` | per-tick | ✅ 已有 |
| 系统 EMA | `systemBudgetEma` | `Map<string, number>` | per-tick | ✅ 已有 |
| Bucket 历史 | **未采集** | — | — | ❌ GAP-7a |

**所需新建**：`__cpuBucketHistory: TimeSeriesPoint<number>[]`，寄生在 `empire-health-system` 的 100t cadence 中。读取 `Game.cpu.bucket` 即可。

---

## 三、数据源依赖图

```
empire-health-system (100t)
  ├─ empireHealth                    → #1 #2 #3 #4 #7 (当前快照)
  ├─ autonomyStatus                  → #4 (自治状态)
  ├─ __netFlowHistory                → #1 (净流历史)
  ├─ __reserveHistory                → #1 (储备历史)
  ├─ __populationHistory             → #2 (人口历史)
  ├─ __healthHistory                 → #4 #7 (健康度历史)
  ├─ __failureCountHistory           → #4 (失败历史)
  ├─ __consecutiveStableTicks        → #4 (稳态计数)
  ├─ __postureHistory                → #4 (姿态历史 → regime)
  ├─ [NEW] __cpuBucketHistory        → #7 (bucket 历史)
  ├─ [NEW] __spawnQueueDepthHistory  → #2 (队列深度历史)
  ├─ [NEW] __logisticsHealthHistory  → #3 (物流健康历史)
  └─ [NEW] __roomHealthHistory       → #4 (房间健康历史)

logistics-planner (100t)
  ├─ logisticsHealth                 → #3 (当前物流健康)
  ├─ logisticsAccounting             → #3 (会计明细)
  └─ logisticsCapacity               → #3 (容量)

expansion-planner (interval)
  ├─ expansionDashboard              → #5 #6 (扩张面板)
  └─ [NEW] __remoteMiningHistory     → #5 (远矿历史)

recovery-execution-system (interval)
  └─ recoveryStats                  → #4 (恢复统计)

kernel (per-tick)
  ├─ cpuByHome                       → #7 (per-room CPU)
  └─ systemBudgetEma                 → #7 (系统 EMA)

strategy-evaluation-system (interval)
  └─ __evaluationCache              → 所有 (regime 输入)

experience-collector-system (interval)
  └─ __experienceCache              → 所有 (evidence 输入)
```

---

## 四、数据质量评估

### 4.1 采样频率充分性

| 预测目标 | 所需最小样本数 | 采样间隔 | 积累时间 | 充分性 |
|---------|--------------|---------|---------|--------|
| #1 Energy | 30 | 100t | 3,000t | ✅ ~1.25 天即可 |
| #2 Spawn | 30 | 100t | 3,000t | ✅ |
| #3 Logistics | 30 | 100t | 3,000t | ✅ |
| #4 Room | 30 | 100t | 3,000t | ✅ |
| #5 Remote | 20 | interval(~200t) | 4,000t | ✅ |
| #6 Expansion | 10 | interval(~200t) | 2,000t | ✅ 低精度 |
| #7 CPU | 20 | 100t | 2,000t | ✅ |

### 4.2 数据缺失容忍

| 场景 | 处理 |
|------|------|
| global reset | 所有 heap 历史丢失 → 从零重建，confidence = 0 直到样本积累 |
| 某系统异常 | safeRun 隔离 → 该数据源该 tick 缺失 → 用最近有效值补 |
| 某采样点缺失 | TimeSeries 容器允许不连续采样 → 回归时自动跳过缺失点 |

---

## 五、关键结论

1. **5 个新建采样字段**全部可寄生在 `empire-health-system` 或 `expansion-planner` 的既有 cadence 中，零额外调度。
2. **所有数据源已在 globalCache 中暴露**（或可通过寄生方式暴露），无需新建独立数据采集系统。
3. **采样间隔 100t 充分**——Screeps tick ~3s，100t = ~5min，3000t = ~2.5h。预测层在 2.5h 内即可积累足够样本。
4. **global reset 容忍**——所有历史在 heap，reset 后从零重建是可接受的（A6.0 明确 prediction 是可观测设施）。
5. **数据源依赖集中在 empire-health-system**——5 个新建采样中 4 个寄生在该系统，需修改该系统但不改其 cadence。
