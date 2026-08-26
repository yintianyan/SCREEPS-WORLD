# A6.5 Architecture — 架构设计

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做架构设计，不修改任何代码  
> **基线**: A6.1-A6.4 已冻结契约 + 真实代码审计 + A6.5 Gap Analysis / Reliability Architecture / Conflict Analysis / Safety Boundary / Counterfactuals

---

## 一、架构概览

### 1.1 A6.5 在 Intelligence 链条中的位置

```
A6.1 Experience      "发生了什么？为什么？"
A6.2 Evaluation      "做得怎么样？比基线如何？"
A6.3 Prediction       "按照当前趋势，未来可能发生什么？"
A6.4 Calibration      "过去的 Prediction 到底准不准？"
A6.5 Reliability      "系统知道自己的预测能力后，如何形成可靠的 Intelligence？"
A6.6 Recommendation  "基于可靠 Intelligence，应该怎么做？"（未来）
```

### 1.2 A6.5 的角色

**A6.5 = Reliability Assessment & Intelligence State**

不是增加 Prediction Model。不是万能 Score。

A6.5 是在 A6.1-A6.4 之上的**只读聚合层**：

```
┌──────────────────────────────────────────────────────┐
│                   A6.5 IntelligenceState              │
│  (只读投影 — 不持久化，每次运行时从既有数据重新计算)      │
├──────────┬──────────┬──────────┬────────────────────┤
│  Regime  │ Temporal │ Conflict │  Data Sufficiency  │
│ Fit      │ Drift    │ Detect   │  & Freshness       │
│          │          │          │                    │
│  从 A6.4 │ 从 A6.4  │ 从 A6.3  │  从 A6.1-A6.4     │
│  Profile │  Ring    │  Active  │  Ring Buffer       │
│  + A6.3  │  Buffer  │  Preds   │  Stats             │
│  Context │  Recent  │          │                    │
└──────────┴──────────┴──────────┴────────────────────┘
         ↑ 只读            ↑ 只读        ↑ 只读
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ A6.4 Calibration│ │ A6.3 Prediction │ │ A6.1-A6.2     │
│  Ring Buffer    │ │  Ring Buffer    │ │  Ring Buffers  │
│  + Profiles     │ │  + Active Preds │ │                │
└────────────────┘ └────────────────┘ └────────────────┘
```

---

## 二、分层结构

### 2.1 Domain 层（纯函数）

```
src/domain/intelligence/reliability/
  ├── types.ts           — IntelligenceState 及子类型定义
  ├── regime-fit.ts      — Regime 适配度计算（Regime Profile 查找 + Fallback）
  ├── temporal-drift.ts  — 时效性退化检测（Rolling Window + Historical 对比）
  ├── conflict-detect.ts — 跨模型冲突检测（逻辑规则 + Temporal + Regime）
  ├── data-sufficiency.ts— 数据充足性聚合
  ├── freshness.ts       — 知识新鲜度评估
  ├── uncertainty.ts     — 不确定性聚合
  ├── state-hash.ts      — IntelligenceState 确定性 Hash
  ├── guards.ts          — REL-001 ~ REL-012 守卫验证函数
  └── index.ts           — 统一出口
```

### 2.2 System 层（薄壳）

```
src/systems/intelligence/
  └── intelligence-state-system.ts  — 系统层薄壳（采集 + 编排 + 暴露）
```

### 2.3 与 A6.1-A6.4 的依赖方向

```
A6.5 Reliability Domain
  ↓ imports (只读)
A6.4 Calibration Domain (types, ring-buffer, calibration, metrics)
  ↓ imports (只读)
A6.3 Prediction Domain (types, context, ring-buffer, hashing)
  ↓ imports (只读)
A6.1 Experience Domain (types only)
A6.2 Strategy Evaluation Domain (types only)
```

**关键约束**: A6.5 不修改 A6.1-A6.4 的任何文件。只读 import。

---

## 三、Domain 类型定义（拟）

### 3.1 IntelligenceState

```typescript
/**
 * A6.5 IntelligenceState — 多维 Intelligence 健康状态。
 *
 * 只读投影 — 不持久化，不写入 globalCache。
 * 每次运行时从 A6.1-A6.4 既有数据重新计算。
 *
 * 禁止合并为单一 IntelligenceScore。
 */
interface IntelligenceState {
  // ── 预测覆盖 ──
  readonly predictionCoverage: PredictionCoverage;

  // ── 模型可靠性 ──
  readonly modelReliability: readonly ModelReliabilityAssessment[];

  // ── 校准健康度 ──
  readonly calibrationHealth: CalibrationHealthSummary;

  // ── 数据充足性 ──
  readonly dataSufficiency: DataSufficiencySummary;

  // ── Regime 适配 ──
  readonly regimeFit: RegimeFitSummary;

  // ── 不确定性 ──
  readonly uncertainty: UncertaintySummary;

  // ── 冲突状态 ──
  readonly predictionConflicts: readonly PredictionConflict[];

  // ── 知识新鲜度 ──
  readonly knowledgeFreshness: FreshnessSummary;

  // ── 元数据 ──
  readonly assessedAt: number;
  readonly stateHash: string;
}
```

### 3.2 PredictionCoverage

```typescript
interface PredictionCoverage {
  /** 已实现的 PredictionTarget 数量。 */
  readonly implementedModels: number;
  /** 规划的 PredictionTarget 总数（当前 7）。 */
  readonly plannedModels: number;
  /** 已实现的 target 列表。 */
  readonly coveredTargets: readonly string[];
  /** 未实现的 target 列表。 */
  readonly missingTargets: readonly string[];
  /** 当前活跃预测数。 */
  readonly activePredictions: number;
}
```

### 3.3 ModelReliabilityAssessment

```typescript
/**
 * 单个模型的可靠性评估。
 *
 * 禁止：reliabilityScore: number（REL-012）
 */
interface ModelReliabilityAssessment {
  readonly modelKey: string;
  readonly target: string;

  // ── Regime Profile ──
  /** 当前 Regime 的 Profile 是否存在。 */
  readonly regimeProfileAvailable: boolean;
  /** 使用的 Profile 来源。 */
  readonly profileSource: "REGIME" | "FALLBACK_GLOBAL" | "NONE";
  /** Regime Profile 的样本数。 */
  readonly regimeSampleCount: number;

  // ── 校准状态 ──
  readonly calibrationVerdict: CalibrationVerdict;
  readonly ece: number;
  readonly brierScore: number | null;

  // ── 时效性 ──
  readonly driftDetected: boolean;
  readonly driftDirection: "DEGRADING" | "IMPROVING" | "STABLE" | "UNKNOWN";
  readonly recentEce: number | null;
  readonly overallEce: number;

  // ── 样本充足性 ──
  readonly sampleSufficiency: "SUFFICIENT" | "INSUFFICIENT_FOR_REGIME" | "FALLBACK_GLOBAL" | "INSUFFICIENT_DATA";

  // ── 可追溯 ──
  readonly profileHash: string;
  readonly reliabilityHash: string;
}
```

### 3.4 CalibrationHealthSummary

```typescript
interface CalibrationHealthSummary {
  /** 整体状态。 */
  readonly status: "HEALTHY" | "DRIFT_DETECTED" | "STALE" | "INSUFFICIENT_DATA" | "COLD_START";
  /** 是否检测到 drift。 */
  readonly driftDetected: boolean;
  readonly driftDirection: "DEGRADING" | "IMPROVING" | "STABLE" | "UNKNOWN";
  /** Profile 是否过期。 */
  readonly profileStale: boolean;
  /** 各模型 ECE 摘要。 */
  readonly modelEceSummary: readonly { modelKey: string; ece: number; recentEce: number | null }[];
}
```

### 3.5 DataSufficiencySummary

```typescript
interface DataSufficiencySummary {
  /** 数据是否整体充足。 */
  readonly sufficient: boolean;
  /** 总 Resolution 数。 */
  readonly totalResolutions: number;
  /** 有充足数据的模型数。 */
  readonly modelsWithSufficientData: number;
  /** 最少样本的模型及其样本数。 */
  readonly minSamplesModel: { modelKey: string; count: number } | null;
  /** 不足维度列表。 */
  readonly insufficientDimensions: readonly string[];
}
```

### 3.6 RegimeFitSummary

```typescript
interface RegimeFitSummary {
  /** 当前 Regime 是否有匹配的 Profile。 */
  readonly currentRegimeMatched: boolean;
  /** 当前 ContextSignature。 */
  readonly currentSignature: string;
  /** 各模型的 Regime 适配情况。 */
  readonly modelRegimeFit: readonly {
    modelKey: string;
    regimeMatched: boolean;
    profileSource: "REGIME" | "FALLBACK_GLOBAL" | "NONE";
  }[];
}
```

### 3.7 UncertaintySummary

```typescript
interface UncertaintySource {
  readonly type: "epistemic" | "systematic" | "distributional" | "temporal" | "environmental";
  readonly description: string;
  readonly severity: number;  // 0-1
}

interface UncertaintySummary {
  readonly sources: readonly UncertaintySource[];
  readonly dominantSource: string | null;
  readonly description: string;
  /** 对不确定性评估本身的置信度。 */
  readonly confidenceInAssessment: number;
}
```

### 3.8 PredictionConflict

```typescript
interface PredictionConflict {
  readonly conflictId: string;
  readonly type: "logical" | "temporal" | "evidence" | "regime";
  readonly predictionIds: readonly string[];
  readonly description: string;
  readonly severity: number;  // 0-1
  readonly detectedAt: number;
  readonly conflictHash: string;
}
```

### 3.9 FreshnessSummary

```typescript
interface FreshnessSource {
  readonly source: string;
  readonly freshness: "FRESH" | "RECENT" | "STALE" | "EXPIRED" | "EMPTY";
  readonly ageInTicks: number;
}

interface FreshnessSummary {
  readonly sources: readonly FreshnessSource[];
  readonly overallFreshness: "FRESH" | "RECENT" | "STALE" | "EXPIRED" | "COLD_START";
}
```

---

## 四、Domain 函数签名（拟）

### 4.1 入口函数

```typescript
/**
 * 计算 IntelligenceState — A6.5 的唯一入口。
 *
 * 纯函数 — 不引用 Game/Memory。
 * 确定性 — 相同输入 → 相同 stateHash。
 * 只读 — 不修改任何输入数据。
 *
 * @param predictions - A6.3 的所有活跃预测
 * @param resolutions - A6.4 的所有 ResolutionResult
 * @param profiles - A6.4 的所有 ModelCalibrationProfile
 * @param failureStats - A6.4 的所有 ModelFailureStats
 * @param currentContext - 当前 PredictionContext
 * @param currentTick - 当前 tick
 * @returns IntelligenceState（只读投影）
 */
export function computeIntelligenceState(
  predictions: readonly Prediction[],
  resolutions: readonly ResolutionResult[],
  profiles: readonly ModelCalibrationProfile[],
  failureStats: readonly { modelKey: string; stats: ModelFailureStats }[],
  currentContext: PredictionContext,
  currentTick: number,
): IntelligenceState;
```

### 4.2 Regime Fit

```typescript
/**
 * 计算当前 Regime 下各模型的适配度。
 *
 * 纯函数 — 从 A6.4 Profile + A6.3 Context 计算。
 */
export function computeRegimeFit(
  profiles: readonly ModelCalibrationProfile[],
  resolutions: readonly ResolutionResult[],
  currentContext: PredictionContext,
): RegimeFitSummary;
```

### 4.3 Temporal Drift

```typescript
/**
 * 检测模型校准的时间退化。
 *
 * 纯函数 — 从 A6.4 Ring Buffer 的最近 N 条 Resolution 计算。
 *
 * @param resolutions - 全部 ResolutionResult
 * @param modelKey - 模型标识
 * @returns Drift 评估结果
 */
export function detectCalibrationDrift(
  resolutions: readonly ResolutionResult[],
  modelKey: string,
): {
  driftDetected: boolean;
  driftDirection: "DEGRADING" | "IMPROVING" | "STABLE" | "UNKNOWN";
  recentEce: number | null;
  overallEce: number;
};
```

### 4.4 Conflict Detection

```typescript
/**
 * 检测活跃预测之间的冲突。
 *
 * 纯函数 — Shadow-Only（REL-011: 不解决冲突）。
 *
 * @param activePredictions - 当前活跃预测列表
 * @param currentContext - 当前 PredictionContext
 * @returns 冲突列表（可能为空）
 */
export function detectConflicts(
  activePredictions: readonly Prediction[],
  currentContext: PredictionContext,
): PredictionConflict[];
```

### 4.5 State Hash

```typescript
/**
 * IntelligenceState 确定性 Hash。
 * 复用 A6.3 stableStringify + fnv1a32Hex。
 */
export function intelligenceStateHash(
  state: Omit<IntelligenceState, "stateHash">,
): string;
```

---

## 五、Guard 定义

### 5.1 REL-XXX 守卫

| Guard ID | 名称 | 检查内容 | 失败处理 |
|----------|------|---------|---------|
| REL-001 | Read-Only | A6.5 不写入任何 cache | console.log 告警 |
| REL-002 | Domain Purity | Domain 函数不引用 Game/Memory | 编译/测试时发现 |
| REL-003 | No Game API | 不调用 Game API | safeRun 隔离 |
| REL-004 | No Runtime Mutation | 不修改任何运行时状态 | console.log 告警 |
| REL-005 | Deterministic | 相同输入 → 相同输出 | 测试失败 |
| REL-006 | Bounded Memory | IntelligenceState 不持久化 | console.log 告警 |
| REL-007 | No New Sampler | 不新建采样通道 | 启动检查 |
| REL-008 | No Second Metrics | 不采集新 Metrics | console.log 告警 |
| REL-009 | No Strategy Mutation | 不修改 Strategy/Posture/Spawn | safeRun 隔离 |
| REL-010 | Evidence Traceability | IntelligenceState 可追溯到上游 | 丢弃无追溯结果 |
| REL-011 | No Conflict Resolution | 不裁决预测冲突 | console.log 告警 |
| REL-012 | No Reliability Score | 不产出单一 reliability 分数 | console.log 告警 |

详见 `A6_5_SAFETY_BOUNDARY.md` §二。

---

## 六、System 层契约

### 6.1 intelligence-state-system

```typescript
export const intelligenceStateSystem: System = {
  name: "intelligence-state",
  priority: 3 as Priority,
  interval: 500,
  phase: "post",
  run(ctx: TickContext): void;
};
```

### 6.2 System 层职责

| 职责 | 允许 | 禁止 |
|------|------|------|
| 从 globalCache 读取 A6.1-A6.4 数据 | ✅ | ❌ 直接调用 Game API |
| 调用 Domain 纯函数计算 IntelligenceState | ✅ | ❌ 在 System 层做计算 |
| 将 IntelligenceState 暴露（局部变量 / console.log） | ✅ | ❌ 写入 globalCache |
| 运行 REL-XXX 守卫检查 | ✅ | ❌ 跳过守卫 |
| GC — 不适用（A6.5 不维护存储） | — | — |

### 6.3 System 层 run() 流程

```
run(ctx):
  1. 读取 A6.3 __predictionCache → 所有 Prediction
  2. 读取 A6.4 __calibrationCache → ResolutionResult[] + Profiles + FailureStats
  3. 构建 PredictionContext（复用 A6.4 的 buildCurrentContext）
  4. 调用 computeIntelligenceState() → IntelligenceState
  5. 运行 REL 守卫检查 → 违规只 console.log
  6. console.log IntelligenceState 摘要（每 5000t）
  7. 不写入任何 cache
```

### 6.4 运行顺序

```
tick N:
  P0: kernel + creeps + spawn + construction
  P1: empire-health (100t)
  P2: experience-collector + strategy-evaluation
  P2: prediction-system
  P3: calibration-resolution-system (500t)
  P3: intelligence-state-system (500t)  ← 在 calibration 之后
```

### 6.5 bootstrap.ts 注册

```typescript
// 概念设计（非实现）
import { intelligenceStateSystem } from "./systems/intelligence/intelligence-state-system";
systems.push(intelligenceStateSystem);
```

---

## 七、数据流契约

### 7.1 输入契约

| 输入 | 来源 | 类型 | 读取方式 |
|------|------|------|---------|
| Prediction[] | A6.3 `__predictionCache.ringBuffer` | PredictionRingBuffer | 只读 |
| ResolutionResult[] | A6.4 `__calibrationCache.ringBuffer.resolutionRecords` | ResolutionResult[] | 只读 |
| ModelCalibrationProfile[] | A6.4 `__calibrationCache.ringBuffer.profiles` | Map<string, Profile> | 只读 |
| ModelFailureStats[] | A6.4 `__calibrationCache.ringBuffer.failureStats` | Map<string, Stats> | 只读 |
| PredictionContext | 临时构造（从 globalCache + Memory.kernel） | PredictionContext | 只读 |
| EmpireHealth | globalCache.empireHealth | EmpireHealthResult | 只读 |
| ExperienceRecord[] | A6.1 `__experienceCache.ringBuffer` | ExperienceRingBuffer | 只读 |
| StrategyEvaluation[] | A6.2 `__evaluationCache.ringBuffer` | EvaluationRingBuffer | 只读 |

### 7.2 输出契约

| 输出 | 目标 | 写入方式 |
|------|------|---------|
| IntelligenceState | 局部变量 / 函数返回值 | 不持久化 |
| console.log | 可观测性 | 不影响状态 |
| REL 守卫违规 | console.log | 不影响状态 |

### 7.3 不可修改清单

| 不可修改 | 属于 |
|---------|------|
| `__experienceCache` | A6.1 |
| `__evaluationCache` | A6.2 |
| `__predictionCache` | A6.3 |
| `__calibrationCache` | A6.4 |
| `Memory.kernel.strategy` | Strategy |
| `Memory.kernel.posture` | Posture |
| 任何 Spawn / ConstructionSite / Creep | 执行层 |

---

## 八、常量契约（拟）

```typescript
// ── Regime Profile ──
const MAX_REGIME_PROFILES_PER_MODEL = 5;    // 每模型最多 Regime Profile 数
const MIN_SAMPLES_FOR_REGIME_PROFILE = 100;  // Regime Profile 最小样本
const REGIME_PROFILE_FALLBACK_THRESHOLD = 30; // 低于此回退到全局

// ── Temporal Drift ──
const ROLLING_WINDOW_SIZE = 100;            // 最近 N 条 Resolution
const ROLLING_WINDOW_MIN_CALIBRATABLE = 30;  // Rolling Window 最小可校准样本
const DRIFT_DEGRADING_MULTIPLIER = 1.5;     // recentEce > overallEce × 此值 → DEGRADING
const DRIFT_IMPROVING_MULTIPLIER = 0.5;     // recentEce < overallEce × 此值 → IMPROVING

// ── Profile Aging ──
const PROFILE_STALE_TICKS = 15000;          // 超过此 tick 未更新 → STALE
// (= CALIBRATION_PROFILE_INTERVAL * 3)

// ── Freshness ──
const FRESHNESS_FRESH = 5000;               // tick
const FRESHNESS_RECENT = 20000;             // tick
const FRESHNESS_STALE = 50000;              // tick

// ── Conflict Detection ──
const TEMPORAL_CONFLICT_THRESHOLD = 0.3;    // value 差异 > 30% → temporal conflict

// ── CPU ──
const INTELLIGENCE_STATE_INTERVAL = 500;    // tick
const INTELLIGENCE_STATE_HEAP_MAX = 2048;   // bytes — IntelligenceState 最大内存
```

---

## 九、复杂度估算

### 9.1 CPU

| 操作 | 频率 | 复杂度 | 每 tick 平均 |
|------|------|--------|------------|
| Regime Profile 查找 | 每 500t | O(m × r) — m=模型数≤10, r=Regime≤5 | 0.1 ops/t |
| Rolling Window 计算 | 每 500t | O(n) — n=最近100条 | 0.2 ops/t |
| Drift Detection | 每 500t | O(1) — 对比两个 ECE | ~0.002 ops/t |
| Conflict Detection | 每 500t | O(p²) — p=active preds≤10 | 0.2 ops/t |
| IntelligenceState 构建 | 每 500t | O(m) — m=模型数≤10 | 0.02 ops/t |
| State Hash | 每 500t | O(s) — s=state size ~2KB | 0.004 ops/t |

**总估计**: < 1 ops/t — 可接受。

### 9.2 Memory

| 存储项 | 大小 | 有界？ |
|--------|------|--------|
| IntelligenceState | ~2KB（只读投影，不持久化） | ✅ |
| Conflict Records | 不持久化（每次重新计算） | ✅ |
| Regime Profiles | 不增加存储（只读引用 A6.4） | ✅ |
| Rolling Window | 不增加存储（复用 A6.4 Ring Buffer） | ✅ |

**总估计**: ~2KB transient — 可接受。

---

## 十、与 A6.4 的依赖关系

### 10.1 复用的 A6.4 工具

| A6.4 工具 | A6.5 复用方式 |
|----------|-------------|
| `ModelCalibrationProfile` 类型 | 只读 import |
| `ResolutionResult` 类型 | 只读 import |
| `ModelFailureStats` 类型 | 只读 import |
| `CalibrationVerdict` 类型 | 只读 import |
| `getAllResolutions()` | 只读调用 |
| `getRecentResolutions()` | 只读调用 |
| `getProfile()` | 只读调用 |
| `getFailureStats()` | 只读调用 |
| `computeCalibrationProfile()` | 只读调用（如需 Regime Profile） |
| `computeECE()` | 只读调用（如需 recent ECE） |

### 10.2 复用的 A6.3 工具

| A6.3 工具 | A6.5 复用方式 |
|----------|-------------|
| `Prediction` 类型 | 只读 import |
| `PredictionContext` 类型 | 只读 import |
| `PredictionRingBuffer` 类型 | 只读 import |
| `allActivePredictions()` | 只读调用 |
| `buildPredictionContextSignature()` | 只读调用 |
| `checkRegimeCompatibility()` | 只读调用 |
| `stableStringify` | 只读调用 |
| `fnv1a32Hex` | 只读调用 |
| `GuardResult` 类型 | 只读 import |

### 10.3 不修改 A6.1-A6.4

| A6.X 文件 | A6.5 操作 |
|----------|----------|
| A6.1 `experience/` | 只读 import 类型 |
| A6.2 `strategy-evaluation/` | 只读 import 类型 |
| A6.3 `prediction/` | 只读 import 类型 + 函数 |
| A6.4 `calibration/` | 只读 import 类型 + 函数 |

---

## 十一、冲突规则注册（拟）

### 11.1 逻辑矛盾对

```typescript
// 概念设计（非实现）

interface ConflictRule {
  ruleId: string;
  targetA: PredictionTarget;
  targetB: PredictionTarget;
  conditionA: (p: Prediction) => boolean;
  conditionB: (p: Prediction) => boolean;
  severity: number;
  description: string;
}

const CONFLICT_RULES: ConflictRule[] = [
  {
    ruleId: "energy-vs-expansion",
    targetA: "energy-shortage",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.8,
    description: "Energy shortage predicted but expansion readiness also high",
  },
  {
    ruleId: "collapse-vs-expansion",
    targetA: "room-collapse",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.9,
    description: "Room collapse predicted but expansion readiness also high",
  },
  {
    ruleId: "cpu-vs-expansion",
    targetA: "cpu-pressure",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5,
    conditionB: (p) => p.confidence > 0.5,
    severity: 0.7,
    description: "CPU pressure predicted but expansion readiness also high",
  },
];
```

### 11.2 冲突严重度计算

```
severity = rule.severity × predictionA.confidence × predictionB.confidence
```

### 11.3 约束

1. **Shadow-Only**: 只检测和标记，不解决冲突（REL-011）
2. **不自动选择**: 不按 confidence 选择"赢"的预测
3. **不隐藏冲突**: 冲突必须暴露在 IntelligenceState 中
4. **Bounded**: `PredictionConflict[]` 不持久化
5. **Deterministic**: 相同输入 → 相同 `conflictHash`
6. **规则可扩展**: 新模型实现时添加新规则

---

## 十二、新鲜度分级

### 12.1 Freshness 定义

| 分级 | 年龄（tick） | 含义 | 处理 |
|------|-------------|------|------|
| FRESH | < 5000 | 数据新鲜 | 直接使用 |
| RECENT | 5000-20000 | 数据较新 | 使用但标注 |
| STALE | 20000-50000 | 数据过期 | 降权 / 标注 |
| EXPIRED | > 50000 | 数据失效 | 不使用 |
| EMPTY | 无数据 | 冷启动 | 标注 COLD_START |

### 12.2 Freshness 来源

| 数据源 | 计算 |
|--------|------|
| CalibrationProfile | `currentTick - profile.statisticsTick` |
| ResolutionResult | `currentTick - result.resolvedTick` |
| Prediction | `currentTick - prediction.generatedAt` |
| ExperienceRecord | `currentTick - record.identity.decisionTick` |
| StrategyEvaluation | `currentTick - evaluation.evaluatedAt` |
| EmpireHealth | `currentTick - health.tick` |

---

## 十三、测试策略

### 13.1 单元测试

| 测试目标 | 覆盖场景 |
|---------|---------|
| `computeRegimeFit()` | CF-1, CF-2, CF-3, CF-10 |
| `detectCalibrationDrift()` | CF-4, CF-5, CF-6 |
| `detectConflicts()` | CF-7, CF-8, CF-9, CF-10, CF-11 |
| `computeIntelligenceState()` | CF-1 ~ CF-15 |
| `intelligenceStateHash()` | CF-15 |
| REL 守卫 | 守卫违规检测 |

### 13.2 集成测试

| 测试目标 | 验证 |
|---------|------|
| A6.5 → A6.4 读取 | 只读不修改 |
| A6.5 → A6.3 读取 | 只读不修改 |
| A6.5 → globalCache | 不写入 |
| A6.5 → Memory | 不引用 |
| 确定性回放 | 100× replay |
| 冷启动 | Ring Buffer 全空 |
| 端到端 | A6.1 → A6.2 → A6.3 → A6.4 → A6.5 |

### 13.3 守卫测试

| Guard | 测试方式 |
|-------|---------|
| REL-001 | 验证 run() 不写入 globalCache |
| REL-005 | 100× replay stateHash 一致 |
| REL-009 | 验证 run() 不修改 Strategy/Posture |
| REL-011 | 验证代码不包含冲突解决 |
| REL-012 | 验证 IntelligenceState 不含 reliabilityScore |

---

## 十四、Roadmap 前置条件

### 14.1 A6.5 实现前必须满足

- [ ] A6.4 Calibration 完全实现并测试通过
- [ ] A6.3 Prediction 完全实现并测试通过
- [ ] A6.1-A6.4 的 Ring Buffer 可被只读访问
- [ ] `stableStringify` / `fnv1a32Hex` 可被 A6.5 复用
- [ ] `buildPredictionContextSignature` / `checkRegimeCompatibility` 可被复用

### 14.2 A6.5 实现不依赖

- ❌ 未实现的 Prediction Model（logistics-bottleneck, room-collapse 等）
- ❌ A6.6 Recommendation
- ❌ 新的 Memory 结构
- ❌ 新的 globalCache 字段

### 14.3 A6.5 不阻塞

- A6.6 Recommendation 可以在 A6.5 完成后开始
- 新的 Prediction Model 可以独立增加（A6.5 自动发现）
