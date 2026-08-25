# A6.3.0 — Prediction Architecture Design

> **阶段**: A6.3.0 Research / Architecture Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 预测层的完整架构设计——模块划分、数据流、系统层职责、域层职责、实施计划

---

## 一、架构总览

### 1.1 定位

预测层是 A6 Intelligence 框架的第三层（Experience → Evaluation → **Prediction**），位于 Strategy Evaluation + Baseline 之上，Recommendation Engine（A6.6）之下。

```
A6.1 Experience Layer    — 收集决策→结果→归因记录
A6.2 Evaluation Layer     — 多维度策略评估 + Baseline 对比 + Evidence 追溯
A6.3 Prediction Layer    — 趋势预测 + 风险预警 + 失效追踪  ← 本文档
A6.6 Recommendation Layer — 预测→建议→验证门→参数调整  ← 未来
```

### 1.2 设计原则

| 原则 | 来源 | 在预测层的体现 |
|------|------|--------------|
| Shadow-Only | A6.0 Safety Boundary | 预测层只读 + 只写 `__predictionCache` |
| 确定性 | A6.0 Learning Approach | 纯函数 + 稳定哈希 + 排序遍历 |
| 寄生采集 | A5 System Boundaries | 不自建采样，复用既有 cadence |
| 规则+统计 | A6.0 Learning Approach | 趋势外推/阈值投影/统计推断，不用 ML |
| 有界资源 | A5 CPU Execution Model | P3 档、≥500t cadence、≤0.5 CPU/次 |
| Regime 感知 | A6.0 Prediction Architecture | 预测检查 regime 一致性，不一致则降权 |
| 可追溯 | A6.2 Evidence Model | 每条 Prediction 带 evidence 链 |

### 1.3 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                  Systems Layer (src/systems/)               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           prediction-system.ts                         │ │
│  │  职责：cadence 调度、globalCache 读取、Recovery 守卫、  │ │
│  │        Ring Buffer 维护、segment 持久化               │ │
│  │  CPU：P3、≥500t、≤0.5 CPU/次                         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓ 调用
┌─────────────────────────────────────────────────────────────┐
│                   Domain Layer (src/domain/)                │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │  prediction/   │  │  prediction/   │  │ prediction/  │ │
│  │  types.ts      │  │  models.ts     │  │ history.ts   │ │
│  │  类型定义      │  │  预测模型(纯函数)│  │  TimeSeries │ │
│  └────────────────┘  └────────────────┘  └──────────────┘ │
│  ┌────────────────┐  ┌────────────────┐                    │
│  │  prediction/   │  │  prediction/   │                    │
│  │  evidence.ts   │  │  resolve.ts    │                    │
│  │  证据链构建    │  │  应验/失效判定 │                    │
│  └────────────────┘  └────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
                            ↑ 读取
┌─────────────────────────────────────────────────────────────┐
│              globalCache (heap, volatile)                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  __predictionCache: { ring: PredictionRingBuffer,     │ │
│  │                        timeSeries: { ... } }          │ │
│  └────────────────────────────────────────────────────────┘ │
│  + empireHealth, logisticsHealth, expansionDashboard,     │ │
│  │    recoveryStats, autonomyStatus, __netFlowHistory,    │ │
│  │    __reserveHistory, __populationHistory, __healthHistory│ │
│  │    [NEW] __cpuBucketHistory, __spawnQueueDepthHistory,  │ │
│  │    [NEW] __logisticsHealthHistory, __roomHealthHistory, │ │
│  │    [NEW] __remoteMiningHistory                          │ │
│  + __evaluationCache, __experienceCache (A6.1/A6.2 输入)   │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、模块设计

### 2.1 Domain Layer — `src/domain/intelligence/prediction/`

#### 2.1.1 `types.ts` — 类型定义

**职责**：定义预测层的所有类型。

```typescript
// 预测目标（第一阶段 7 个）
type PredictionTarget = ...（见 Contract 文档）
// 预测方法
type PredictionMethod = ...
// 预测状态
type PredictionStatus = ...
// Prediction 核心类型
interface Prediction { ... }
// PredictionWindow
interface PredictionWindow { ... }
// Regime 快照
interface PredictionRegime { posture, watchdogTier, roomCount }
```

**依赖**：无外部依赖（纯类型）。

#### 2.1.2 `history.ts` — 时间序列容器

**职责**：通用时间序列容器，支持 push/recent/linearRegression。

```typescript
interface TimeSeriesPoint<T> { tick: number; value: T }
interface TimeSeries<T> {
  samples: TimeSeriesPoint<T>[];
  capacity: number;
  push(tick: number, value: T): void;
  recent(n: number): TimeSeriesPoint<T>[];
  linearRegression(): { slope, intercept, r2 } | null;
  mean(): number | null;
  trend(): "up" | "down" | "flat" | null;
}
```

**关键约束**：
- `linearRegression` 仅对 `T = number` 有效。
- 容量上限默认 100（100t 采样 × 100 = 10,000t 历史 ≈ 8.3h）。
- `push` 超容量时移除最旧（shift），O(n) 但 n ≤ 100 可接受。
- 确定性：遍历前 `samples.sort((a,b) => a.tick - b.tick)`。

#### 2.1.3 `models.ts` — 预测模型（纯函数）

**职责**：7 个预测目标的预测模型实现，全部是纯函数。

```typescript
// 趋势外推模型
function predictEnergyShortage(
  netFlowHistory: TimeSeries<number>,
  reserveHistory: TimeSeries<number>,
  currentReserve: number,
  deficitThreshold: number,
  regime: PredictionRegime,
): Prediction | null

function predictCpuPressure(
  bucketHistory: TimeSeries<number>,
  cpuHealth: number,
  watchdogThresholds: { guarded: number; conserve: number; recovery: number },
  regime: PredictionRegime,
): Prediction | null

// 阈值投影模型
function predictSpawnStarvation(
  queueDepthHistory: TimeSeries<number>,
  populationHistory: TimeSeries<number>,
  criticalThreshold: number,
  regime: PredictionRegime,
): Prediction | null

function predictRemoteMiningFailure(
  remoteMiningHistory: TimeSeries<{ netIncome: number; threatCount: number }>,
  roiThreshold: number,
  regime: PredictionRegime,
): Prediction | null

function predictExpansionReadiness(
  readinessHistory: TimeSeries<number>,
  gateThreshold: number,
  regime: PredictionRegime,
): Prediction | null

// 统计推断模型
function predictLogisticsBottleneck(
  logisticsHealthHistory: TimeSeries<{ score: number; deliveryRate: number; lossRate: number }>,
  bottleneckThreshold: number,
  regime: PredictionRegime,
): Prediction | null

// 多信号聚合模型
function predictRoomCollapse(
  roomHealthHistory: TimeSeries<{ score: number; level: string }>,
  threatAssessment: ThreatAssessment | null,
  recoveryStats: RecoveryStats | null,
  regime: PredictionRegime,
): Prediction | null
```

**关键约束**：
- 所有函数**纯**——不读 Game、不读 Memory、不读 globalCache。
- 输入不足（< 3 样本）返回 `null`（不产出）。
- confidence 计算公式：`f(r², sampleCount, regimeStability)`。
- evidence 字段填入数据源引用（如 `"netFlowHistory:1-30"`）。
- modelVersion 从常量定义。

#### 2.1.4 `evidence.ts` — 证据链构建

**职责**：为每条 Prediction 构建可追溯的证据链。

```typescript
function buildPredictionEvidence(
  target: PredictionTarget,
  dataSources: string[],
  modelParams: Record<string, unknown>,
): string[]
```

**关键约束**：
- evidence 是字符串数组，每项格式为 `"source:range"`（如 `"netFlowHistory:1-30"`）。
- 可追溯到 globalCache 中的具体数据字段和采样范围。
- 同构于 A6.2 `evaluation-evidence.ts` 的 EvidenceChain 模式。

#### 2.1.5 `resolve.ts` — 应验/失效判定

**职责**：检查已到期 Prediction 是否应验，更新 status。

```typescript
function resolvePrediction(
  prediction: Prediction,
  currentValue: number,
  actualThreshold: number,
): PredictionStatus  // "fulfilled" | "expired"
```

**关键约束**：
- 纯函数——给定 Prediction + 当前实际值，返回应验/失效状态。
- 应验判定：预测值与实际值的偏差 < 20% → fulfilled。
- 未应验：偏差 ≥ 20% → expired（非 invalidated——expired 是正常失效）。
- invalidated 仅在新数据推翻预测前提时使用（如 regime 完全改变）。

### 2.2 Systems Layer — `src/systems/intelligence/prediction-system.ts`

**职责**：系统层薄封装，同构于 `strategy-evaluation-system.ts`。

```typescript
// 伪代码
export function predictionSystem(): void {
  // 1. Recovery 守卫
  if (watchdogTier === "Recovery") return;

  // 2. Cadence 检查
  if (Game.time % PREDICTION_CADENCE !== 0) return;

  // 3. 读取 globalCache 数据
  const regime = buildRegime();
  const timeSeries = readTimeSeries();

  // 4. 调用 domain 纯函数
  const predictions: Prediction[] = [];
  for (const model of MODELS) {
    const p = model(timeSeries, regime);
    if (p) predictions.push(p);
  }

  // 5. 写入 Ring Buffer
  for (const p of predictions) {
    predictionRingBuffer.push(p);
  }

  // 6. Resolve 已到期预测
  resolveExpiredPredictions(predictionRingBuffer);

  // 7. 低频 segment 持久化（可选）
  if (Game.time % SEGMENT_PERSIST_INTERVAL === 0) {
    persistToSegment(predictionRingBuffer);
  }
}
```

**关键约束**：
- 整个系统走 `safeRun` 包裹。
- CPU 预算自检：执行后检查 `Game.cpu.getUsed()`，超 0.5 CPU 则下次分片。
- 不修改任何非 `__predictionCache` 的 globalCache 字段。
- 不自建采样——所有 TimeSeries 数据由 `empire-health-system` 等既有系统维护。

### 2.3 采样寄生 — `empire-health-system.ts` 修改

**职责**：在既有 100t cadence 中追加 5 个新采样字段。

```typescript
// 在 empire-health-system 的既有 cadence 中追加：
function sampleForPredictions(): void {
  // 1. CPU bucket 历史
  pushTimeSeries(__cpuBucketHistory, Game.time, Game.cpu.bucket);

  // 2. Spawn 队列深度（需 SpawnManager 暴露）
  pushTimeSeries(__spawnQueueDepthHistory, Game.time, getSpawnQueueDepth());

  // 3. 物流健康度历史
  if (globalCache.logisticsHealth) {
    pushTimeSeries(__logisticsHealthHistory, Game.time, {
      score: globalCache.logisticsHealth.score,
      deliveryRate: globalCache.logisticsHealth.deliveryRate,
      lossRate: globalCache.logisticsHealth.lossRate,
    });
  }

  // 4. Room-level health 历史
  for (const [roomName, state] of Object.entries(Memory.rooms)) {
    pushRoomHealth(__roomHealthHistory, roomName, Game.time, getRoomHealth(roomName));
  }

  // 5. 远矿历史（在 expansion-planner 中）
  // — 在 expansion-planner 的 cadence 中追加
}
```

**关键约束**：
- 追加在**既有 cadence** 中，不新建 tick 级采样。
- 每个采样点 O(1) 成本（push + shift）。
- global reset 后从空数组重建（可接受）。

---

## 三、数据流

### 3.1 完整数据流（一个预测周期）

```
empire-health-system (100t cadence)
  │ 采样：netFlow, reserve, bucket, spawnQueue, logisticsHealth, roomHealth
  ↓ 写入 globalCache.__xxxHistory (TimeSeries)

prediction-system (500t cadence)
  │
  ├─ 1. Recovery 守卫
  │    └─ watchdogTier === "Recovery" → return
  │
  ├─ 2. 读取数据
  │    ├─ regime = { posture, watchdogTier, roomCount }
  │    ├─ TimeSeries = { netFlow, reserve, bucket, spawnQueue, logisticsHealth, ... }
  │    └─ evaluationResult = __evaluationCache (A6.2 输出)
  │
  ├─ 3. 运行预测模型（纯函数）
  │    ├─ predictEnergyShortage(netFlow, reserve, deficitThreshold, regime) → Prediction | null
  │    ├─ predictSpawnStarvation(queueDepth, population, criticalThreshold, regime) → Prediction | null
  │    ├─ predictCpuPressure(bucket, cpuHealth, thresholds, regime) → Prediction | null
  │    ├─ predictLogisticsBottleneck(logisticsHealth, threshold, regime) → Prediction | null
  │    ├─ predictRoomCollapse(roomHealth, threat, recovery, regime) → Prediction | null
  │    ├─ predictRemoteMiningFailure(remoteMining, roi, regime) → Prediction | null
  │    └─ predictExpansionReadiness(readiness, gate, regime) → Prediction | null
  │
  ├─ 4. 写入 Ring Buffer
  │    └─ predictionRingBuffer.push(p) for each non-null Prediction
  │
  ├─ 5. Resolve 已到期预测
  │    └─ resolvePrediction(p, currentValue, threshold) → update status
  │
  └─ 6. 低频 segment 持久化（可选）
       └─ RawMemory.segments[prediction-segment] = JSON.stringify(ring.entries)
```

### 3.2 Prediction → Recommendation（A6.6 范围，仅设计接口）

```
predictionRingBuffer
  ↓ active predictions
Recommendation Engine（A6.6）
  ↓ 综合 Prediction + StrategyScore + Baseline
Recommendation { target, action, reason, confidence }
  ↓
Validation Gate（A6.6，7 项检查）
  ↓
tuning 参数调整（A6.6）
```

**A6.3 不实现上述链路**——只保证 Prediction 存入 Ring Buffer，供未来 A6.6 消费。

---

## 四、bootstrap.ts 注册

```typescript
// 在 bootstrap.ts 中注册预测系统
import { predictionSystem } from "./systems/intelligence/prediction-system";

// 注册为 P3 低频系统
kernel.register("prediction-system", predictionSystem, {
  priority: "P3",
  frequency: 500, // ≥500t cadence
});
```

**关键约束**：
- 注册在 bootstrap.ts，不改 Kernel。
- 名称 `prediction-system` 全局唯一 kebab-case。
- 模块顶层禁止访问 `Game`/`Memory`。

---

## 五、文件清单

### 5.1 新建文件

| 文件 | 层级 | 职责 |
|------|------|------|
| `src/domain/intelligence/prediction/types.ts` | Domain | 类型定义 |
| `src/domain/intelligence/prediction/history.ts` | Domain | TimeSeries 容器 |
| `src/domain/intelligence/prediction/models.ts` | Domain | 7 个预测模型纯函数 |
| `src/domain/intelligence/prediction/evidence.ts` | Domain | 证据链构建 |
| `src/domain/intelligence/prediction/resolve.ts` | Domain | 应验/失效判定 |
| `src/domain/intelligence/prediction/index.ts` | Domain | 统一导出 |
| `src/systems/intelligence/prediction-system.ts` | System | 系统层薄封装 |
| `tests/unit/intelligence/a6-3-prediction.test.ts` | Test | 单元测试 |

### 5.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/kernel/global-cache.ts` | 新增 `__predictionCache` + 5 个历史采样字段 |
| `src/systems/empire-health-system.ts` | 追加 4 个采样（bucket, spawnQueue, logistics, roomHealth） |
| `src/systems/expansion-planner.ts` | 追加 1 个采样（remoteMining） |
| `src/bootstrap.ts` | 注册 `prediction-system` |
| `src/domain/intelligence/index.ts` | 导出 prediction 模块 |

### 5.3 不修改的文件

| 文件 | 理由 |
|------|------|
| `src/kernel/` (kernel.ts, memory.ts) | 内核不感知预测层 |
| `src/domain/strategy/` | 策略域不感知预测层 |
| `src/domain/defense/` | 防御域不感知预测层 |
| `src/config/` | CONFIG 不增加预测参数（参数在 domain 常量中） |
| A5 架构文档 | 预测层不修改冻结蓝图 |

---

## 六、实施计划

### 6.1 分阶段实施

| 阶段 | 内容 | 依赖 |
|------|------|------|
| A6.3.1 | 基础设施：TimeSeries 容器 + PredictionRingBuffer + types.ts + globalCache 字段 | 无 |
| A6.3.2 | 采样寄生：在 empire-health-system + expansion-planner 中追加 5 个采样 | A6.3.1 |
| A6.3.3 | 预测模型：models.ts（7 个纯函数）+ evidence.ts + resolve.ts | A6.3.1 |
| A6.3.4 | 系统层：prediction-system.ts + bootstrap 注册 | A6.3.2 + A6.3.3 |
| A6.3.5 | 测试：单元测试 + 集成测试 | A6.3.4 |

### 6.2 实施顺序图

```
A6.3.1 (基础设施)
  ├── types.ts
  ├── history.ts (TimeSeries)
  └── global-cache.ts 修改
        ↓
A6.3.2 (采样寄生)
  ├── empire-health-system.ts 修改
  └── expansion-planner.ts 修改
        ↓
A6.3.3 (域模型)
  ├── models.ts (7 个纯函数)
  ├── evidence.ts
  └── resolve.ts
        ↓
A6.3.4 (系统层)
  ├── prediction-system.ts
  └── bootstrap.ts 修改
        ↓
A6.3.5 (测试)
  └── a6-3-prediction.test.ts
```

### 6.3 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 采样不足（数据积累慢） | 中 | 预测前 3000t confidence 低 | 可接受——A6.0 明确 prediction 是可观测设施 |
| global reset 丢失历史 | 低 | 所有 TimeSeries 清零 | 可接受——快速重建（~3000t = 2.5h） |
| 预测准确率低 | 高 | 预测无实际价值 | A6.3 只验证"能产出"，准确率需 soak 后评估 |
| 采样寄生干扰既有系统 | 低 | empire-health-system 性能下降 | O(1) push 成本可忽略 |
| Ring Buffer 内存占用 | 低 | heap 压力 | 100 条 × 500 bytes = 50KB，可接受 |

---

## 七、与 A6.0 蓝图的对齐

### 7.1 对齐矩阵

| A6.0 蓝图条款 | 本设计 | 对齐 |
|---------------|--------|------|
| 第一阶段 7 个预测目标 | ✅ 全部覆盖 | ✅ |
| Prediction 数据结构 | ✅ 完全采用 A6.0 定义 | ✅ |
| 趋势外推/阈值投影/统计推断 | ✅ 3 种方法均有纯函数实现 | ✅ |
| Shadow-Only 安全边界 | ✅ PRED-001 守卫 | ✅ |
| 确定性要求 | ✅ PRED-003 守卫 | ✅ |
| Horizon 强制 | ✅ PRED-004 守卫 | ✅ |
| Confidence 强制标注 | ✅ PRED-005 守卫 | ✅ |
| Evidence 可追溯 | ✅ PRED-006 守卫 | ✅ |
| Regime 感知 | ✅ PRED-007 守卫 | ✅ |
| 失效处理 | ✅ PRED-008 守卫 | ✅ |
| 不直接触发动作 | ✅ PRED-009 守卫 | ✅ |
| 不进入 tick 关键路径 | ✅ PRED-002 守卫 | ✅ |
| Recovery 档全停 | ✅ PRED-002 守卫 | ✅ |
| 第二阶段预测目标 | ❌ 不实现（需 Player Intelligence） | ✅ 符合 A6.0 Roadmap |
| Recommendation Engine | ❌ 不实现（A6.6 范围） | ✅ 符合 A6.0 Roadmap |

### 7.2 偏差声明

本设计在以下方面**细化**了 A6.0 蓝图（非偏差，是冻结前的设计补充）：

| 细化点 | A6.0 原文 | 本设计 |
|--------|----------|--------|
| 采样寄生 | A6.0 未明确采样方式 | 明确寄生在 empire-health-system 100t cadence |
| TimeSeries 容器 | A6.0 未设计容器类型 | 新增 `TimeSeries<T>` 通用容器 |
| PredictionRingBuffer | A6.0 未设计存储方式 | 新增 Ring Buffer（同构 Experience/Evaluation） |
| Regime 定义 | A6.0 提及但未定义 | 明确为 { posture, watchdogTier, roomCount } |
| resolve 逻辑 | A6.0 提及应验/失效 | 明确 20% 偏差阈值 |
| segment 持久化 | A6.0 提及"只写 segment" | 明确为可选低频持久化 |

---

## 八、关键结论

1. **A6.3 预测层可以在现有 A6.1/A6.2 基础上实施**——数据源充分，模型可由纯函数实现，基础设施差距小。
2. **设计完全对齐 A6.0 蓝图**——所有 13 项蓝图条款均有对应守卫，无偏差。
3. **实施分 5 个阶段**——基础设施 → 采样寄生 → 域模型 → 系统层 → 测试，依赖链清晰。
4. **主要工作量在 models.ts（7 个纯函数）**——每个函数 ~30-50 行，总计 ~250-350 行域代码。
5. **系统层极薄**——prediction-system.ts 是 cadence 调度 + 数据读取 + 结果写入的薄封装，~100 行。
6. **不修改冻结蓝图**——所有 A5 架构文档不受影响，只修改实现层代码。
7. **A6.6 Recommendation Engine 不阻塞 A6.3**——预测层只产出 Prediction 存入 Ring Buffer，A6.6 何时消费是独立决策。
