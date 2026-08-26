# A6.4 — Calibration Contract

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: A6.4 的正式契约——类型定义、函数签名、Guard 定义、数据流契约

---

## 一、Domain 类型定义

### 1.1 CalibrationResolution

```typescript
/**
 * A6.4 Calibration Resolution — 对 Prediction 的解析结果分类。
 *
 * 与 A6.3 PredictionStatus（active/fulfilled/expired/invalidated）不同：
 * CalibrationResolution 是更细粒度的校准分类。
 */
type CalibrationResolution =
  | "CORRECT"
  | "INCORRECT"
  | "PARTIAL"
  | "FALSE_POSITIVE"
  | "FALSE_NEGATIVE"
  | "REGIME_CHANGED"
  | "EXTERNAL_INTERFERENCE"
  | "INSUFFICIENT_OBSERVATION";
```

### 1.2 ObservationSample

```typescript
/**
 * 窗口内的一次观测采样。
 * 不包含 Game/Memory 引用。
 */
interface ObservationSample {
  readonly tick: number;
  readonly value: number;
  readonly source: string;
}
```

### 1.3 ExternalFactorSignal

```typescript
/**
 * 外部干扰信号 — 从 A6.1 Attribution 和 A6.2 Evaluation 提取。
 */
interface ExternalFactorSignal {
  /** 来源标识（"a61-attribution" | "a62-evaluation" | "globalCache"）。 */
  readonly source: string;
  /** 描述。 */
  readonly description: string;
  /** 强度（0-1）。 */
  readonly magnitude: number;
}
```

### 1.4 ResolutionResult

```typescript
/**
 * Resolution Result — 对一条 Prediction 的 Resolution 结果。
 *
 * 纯数据对象，不引用 Game/Memory/Prediction 可变状态。
 * 确定性：相同 Prediction + 相同 Observation → 相同 ResolutionResult。
 */
interface ResolutionResult {
  readonly predictionId: string;
  readonly resolution: CalibrationResolution;
  readonly resolvedTick: number;
  readonly predictedValue: number;
  readonly actualValue: number;
  readonly absoluteError: number;
  readonly relativeError: number;
  readonly directionCorrect: boolean;
  readonly withinHorizon: boolean;
  readonly resolutionContextSignature: string;
  readonly regimeChanged: boolean;
  readonly regimeMismatchedDimensions: readonly string[];
  readonly hasExternalInterference: boolean;
  readonly externalFactorSources: readonly string[];
  readonly reason: string;
  readonly resolutionHash: string;
}
```

### 1.5 ConfidenceBucketStats

```typescript
interface ConfidenceBucketStats {
  readonly bucketIndex: number;          // 0-9
  readonly confidenceLow: number;
  readonly confidenceHigh: number;
  readonly avgConfidence: number;
  readonly observedSuccessRate: number;
  readonly sampleCount: number;
  readonly resolutionCounts: {
    readonly CORRECT: number;
    readonly INCORRECT: number;
    readonly PARTIAL: number;
    readonly FALSE_POSITIVE: number;
    readonly FALSE_NEGATIVE: number;
  };
  readonly calibrationError: number;
  readonly sufficient: boolean;
}
```

### 1.6 CalibrationVerdict

```typescript
type CalibrationVerdict =
  | "WELL_CALIBRATED"
  | "OVERCONFIDENT"
  | "UNDERCONFIDENT"
  | "INSUFFICIENT_DATA";
```

### 1.7 ModelCalibrationProfile

```typescript
interface ModelCalibrationProfile {
  readonly modelKey: string;
  readonly target: string;
  readonly method: string;
  readonly modelVersion: number;
  readonly statisticsTick: number;
  readonly totalResolutions: number;
  readonly calibratableCount: number;
  readonly regimeChangedCount: number;
  readonly externalInterferenceCount: number;
  readonly insufficientObservationCount: number;
  readonly buckets: readonly ConfidenceBucketStats[];
  readonly calibrationVerdict: CalibrationVerdict;
  readonly ece: number;
  readonly brierScore: number | null;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
  readonly profileHash: string;
}
```

### 1.8 FailureAttributionCategory

```typescript
type FailureAttributionCategory =
  | "MODEL_ERROR"
  | "INSUFFICIENT_DATA"
  | "LOW_R2"
  | "HORIZON_MISMATCH"
  | "OBSERVATION_GAP"
  | "OUTCOME_AMBIGUOUS";
```

### 1.9 FailureAttributionResult

```typescript
interface FailureAttributionResult {
  readonly predictionId: string;
  readonly resolutionHash: string;
  readonly category: FailureAttributionCategory;
  readonly reason: string;
  readonly a61PrimaryCause: string | null;
  readonly a61ExternalFactors: readonly string[];
  readonly a62FindingDescription: string | null;
  readonly modelR2: number | null;
  readonly sampleCount: number;
  readonly attributionHash: string;
}
```

### 1.10 ModelFailureStats

```typescript
interface ModelFailureStats {
  readonly modelKey: string;
  readonly totalFailures: number;
  readonly attributionCounts: {
    readonly MODEL_ERROR: number;
    readonly INSUFFICIENT_DATA: number;
    readonly LOW_R2: number;
    readonly HORIZON_MISMATCH: number;
    readonly OBSERVATION_GAP: number;
    readonly OUTCOME_AMBIGUOUS: number;
  };
  readonly dominantFailureCategory: FailureAttributionCategory | null;
  readonly statsHash: string;
}
```

### 1.11 CalibrationRingBuffer

```typescript
interface CalibrationRingBuffer {
  readonly resolutionRecords: (ResolutionResult | undefined)[];
  readonly resolutionCapacity: number;
  resolutionCount: number;
  resolutionCursor: number;
  readonly profiles: Map<string, ModelCalibrationProfile>;
  readonly failureStats: Map<string, ModelFailureStats>;
  lastProfileTick: number;
}
```

---

## 二、Domain 函数签名

### 2.1 Resolution Engine

```typescript
/**
 * 解析一条 Prediction — 对比预测与实际观测，产出 ResolutionResult。
 *
 * 纯函数 — 不引用 Game/Memory。
 * 确定性 — 相同输入 → 相同 resolutionHash。
 */
export function resolvePrediction(
  prediction: Prediction,
  observations: readonly ObservationSample[],
  currentContext: PredictionContext,
  externalFactors: readonly ExternalFactorSignal[],
): ResolutionResult;
```

### 2.2 Resolution Metric Registry

```typescript
/**
 * Resolution Metric 函数类型 — 按模型注册。
 */
type ResolutionMetricFn = (
  prediction: Prediction,
  observations: readonly ObservationSample[],
) => {
  actualValue: number;
  relativeError: number;
  directionCorrect: boolean;
  withinHorizon: boolean;
};

/**
 * 注册 Resolution Metric（按 modelKey）。
 */
export function registerResolutionMetric(
  modelKey: string,
  fn: ResolutionMetricFn,
): void;
```

### 2.3 Calibration Statistics

```typescript
/**
 * 计算单个模型的 Calibration Profile。
 *
 * 纯函数 — 不引用 Game/Memory。
 */
export function computeCalibrationProfile(
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  modelKey: string,
): ModelCalibrationProfile;

/**
 * 计算所有模型的 Calibration Statistics。
 */
export function computeCalibrationStatistics(
  resolutionRingBuffer: CalibrationRingBuffer,
): readonly ModelCalibrationProfile[];
```

### 2.4 Failure Attribution

```typescript
/**
 * 对一条失败的 Prediction 进行归因。
 *
 * 返回 null 如果 Resolution 是 CORRECT / REGIME_CHANGED /
 * EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION。
 *
 * 纯函数 — 不引用 Game/Memory。
 */
export function attributeFailure(
  resolutionResult: ResolutionResult,
  prediction: Prediction,
  a61Attribution?: Attribution,
  a62Finding?: EvaluationFinding,
): FailureAttributionResult | null;

/**
 * 聚合模型级失败统计。
 */
export function computeModelFailureStats(
  attributions: readonly FailureAttributionResult[],
  modelKey: string,
): ModelFailureStats;
```

### 2.5 Hash 函数

```typescript
/**
 * ResolutionResult 确定性 Hash。
 * 复用 A6.3 stableStringify + fnv1a32Hex。
 */
export function resolutionResultHash(result: Omit<ResolutionResult, "resolutionHash">): string;

/**
 * ModelCalibrationProfile 确定性 Hash。
 */
export function calibrationProfileHash(profile: Omit<ModelCalibrationProfile, "profileHash">): string;

/**
 * FailureAttributionResult 确定性 Hash。
 */
export function failureAttributionHash(result: Omit<FailureAttributionResult, "attributionHash">): string;
```

---

## 三、Guard 定义

### 3.1 CAL-XXX 守卫

| Guard ID | 名称 | 检查内容 | 失败处理 |
|----------|------|---------|---------|
| CAL-001 | Shadow-Only | A6.4 只写 `__calibrationCache` | console.log 告警 |
| CAL-002 | Domain Purity | Domain 函数不引用 Game/Memory | 编译/测试时发现 |
| CAL-003 | No Game API | 不调用 Game API | safeRun 隔离 |
| CAL-004 | No Runtime Mutation | 不修改任何运行时状态 | console.log 告警 |
| CAL-005 | Deterministic | 相同输入 → 相同输出 | 测试失败 |
| CAL-006 | Bounded Memory | Ring Buffer 不超容量 | console.log 告警 |
| CAL-007 | No New Tick Sampler | 不新建采样通道 | 启动检查 |
| CAL-008 | No Second Metrics | 不采集新 Metrics | console.log 告警 |
| CAL-009 | No Strategy Mutation | 不修改 Strategy/Posture/Spawn | safeRun 隔离 |
| CAL-010 | Evidence Traceability | 每条 Resolution 可追溯到 Prediction | 丢弃无追溯结果 |

### 3.2 Guard 函数签名

```typescript
import type { GuardResult } from "../prediction/guards";

export function guardCalShadowOnly(writeTarget: string): GuardResult;
export function guardCalDomainPurity(fn: Function): GuardResult;
export function guardCalNoGameApi(): GuardResult;
export function guardCalNoRuntimeMutation(cache: unknown): GuardResult;
export function guardCalDeterminism(fn: () => string, iterations: number): GuardResult;
export function guardCalBoundedMemory(buf: CalibrationRingBuffer): GuardResult;
export function guardCalNoNewSampler(system: System): GuardResult;
export function guardCalNoSecondMetrics(): GuardResult;
export function guardCalNoStrategyMutation(): GuardResult;
export function guardCalEvidenceTraceability(result: ResolutionResult): GuardResult;
```

---

## 四、System 层契约

### 4.1 calibration-resolution-system

```typescript
export const calibrationResolutionSystem: System = {
  name: "calibration-resolution",
  priority: 3 as Priority,
  interval: 500,
  phase: "post",
  run(ctx: TickContext): void;
};
```

### 4.2 System 职责边界

| 职责 | 允许 | 禁止 |
|------|------|------|
| 从 globalCache 读取数据 | ✅ | ❌ 直接调用 Game API |
| 调用 Domain 纯函数 | ✅ | ❌ 在 System 层做计算 |
| 写入 __calibrationCache | ✅ | ❌ 写入其他 cache |
| console.log observability | ✅ | ❌ 修改 Memory |
| GC 清理超龄数据 | ✅ | ❌ 清理其他系统的数据 |

### 4.3 bootstrap.ts 注册

```typescript
// bootstrap.ts
import { calibrationResolutionSystem } from "./systems/intelligence/calibration-resolution-system";

// 在 systems 注册区域添加
systems.push(calibrationResolutionSystem);
```

---

## 五、数据流契约

### 5.1 输入契约

| 输入 | 来源 | 类型 | 读取方式 |
|------|------|------|---------|
| Prediction | A6.3 `globalCache.__predictionCache` | PredictionRingBuffer | 只读 |
| Observation | globalCache 既有数据 | 临时构造 | 只读 |
| A6.1 Attribution | `globalCache.__experienceCache` | ExperienceRingBuffer | 只读（时间窗口匹配） |
| A6.2 Evaluation | `globalCache.__evaluationCache` | EvaluationRingBuffer | 只读（时间窗口匹配） |
| Current Context | globalCache + Memory.kernel.strategy | 临时构造 | 只读 |

### 5.2 输出契约

| 输出 | 目标 | 类型 | 写入方式 |
|------|------|------|---------|
| ResolutionResult | `globalCache.__calibrationCache.resolutionRecords` | Ring Buffer | 只写 |
| ModelCalibrationProfile | `globalCache.__calibrationCache.profiles` | Map | 覆盖更新 |
| ModelFailureStats | `globalCache.__calibrationCache.failureStats` | Map | 覆盖更新 |

### 5.3 不修改清单

| 不可修改 | 属于 |
|---------|------|
| `globalCache.__predictionCache` | A6.3 |
| `globalCache.__experienceCache` | A6.1 |
| `globalCache.__evaluationCache` | A6.2 |
| `Memory.kernel.strategy` | Strategy |
| `Memory.kernel.posture` | Posture |
| 任何 Spawn 请求 | Spawn |
| 任何 ConstructionSite | Construction |
| 任何 Creep 行为 | Creeps |

---

## 六、常量契约

```typescript
// ── Resolution ──
const RESOLUTION_GRACE_PERIOD = 100;         // tick
const MIN_OBSERVATION_SAMPLES = 3;
const MAX_OBSERVATION_GAP = 500;              // tick
const CORRECT_RELATIVE_ERROR_THRESHOLD = 0.2;
const INCORRECT_RELATIVE_ERROR_THRESHOLD = 0.5;

// ── Calibration ──
const CONFIDENCE_BUCKET_COUNT = 10;
const MIN_SAMPLES_PER_BUCKET = 30;
const MIN_SAMPLES_FOR_PROFILE = 100;
const MIN_SAMPLES_FOR_VERDICT = 200;
const ECE_WELL_CALIBRATED_THRESHOLD = 0.05;
const CALIBRATION_BIAS_THRESHOLD = 0.1;

// ── Memory ──
const RESOLUTION_RING_BUFFER_CAPACITY = 500;
const RESOLUTION_MAX_AGE = 100000;            // tick
const MAX_PROFILES = 10;
const MAX_CALIBRATION_HEAP = 200_000;         // bytes

// ── CPU ──
const CALIBRATION_INTERVAL = 500;             // tick
const CALIBRATION_PROFILE_INTERVAL = 5000;    // tick
```

---

## 七、与 A6.3 冻结契约的关系

### 7.1 不修改 A6.3

| A6.3 文件 | A6.4 操作 |
|----------|----------|
| `prediction/types.ts` | 只读 import |
| `prediction/ring-buffer.ts` | 只读 import |
| `prediction/context.ts` | 只读 import |
| `prediction/hashing.ts` | 只读 import |
| `prediction/resolve.ts` | 不 import（A6.4 构建独立 Resolution Engine） |
| `prediction/guards.ts` | 只读 import GuardResult 类型 |

### 7.2 A6.3 resolve.ts 与 A6.4 resolve.ts 的关系

| 维度 | A6.3 `prediction/resolve.ts` | A6.4 `calibration/resolve.ts` |
|------|-----------------------------|------------------------------|
| 目的 | 更新 Prediction status | 校准 Confidence |
| 分类 | fulfilled/expired/invalidated | CORRECT/INCORRECT/PARTIAL/... |
| 修改 Prediction | ✅ 更新 status | ❌ 不修改 |
| Regime 检查 | ❌ | ✅ |
| External Interference | ❌ | ✅ |
| Observation Window | ❌ 单点 | ✅ 窗口 |

**A6.4 不修改 A6.3 的 `resolve.ts`。** A6.4 构建独立的 Resolution Engine。

### 7.3 复用的 A6.3 工具

| A6.3 工具 | A6.4 复用方式 |
|----------|-------------|
| `stableStringify` | 直接 import |
| `fnv1a32Hex` | 直接 import |
| `buildPredictionContextSignature` | 直接 import |
| `checkRegimeCompatibility` | 直接 import |
| `PredictionContext` 类型 | 直接 import |
| `Prediction` 类型 | 直接 import |
| `PredictionRingBuffer` 类型 | 直接 import |
| `GuardResult` 类型 | 直接 import |

---

## 八、依赖方向声明

```
A6.4 Calibration Domain
  ↓ imports (只读)
A6.3 Prediction Domain (types, context, hashing)
  ↓ imports (只读)
A6.1 Experience Domain (types only — AttributionFactor, Attribution)
  ↓ imports (只读)
A6.2 Strategy Evaluation Domain (types only — EvaluationFinding)
```

**禁止的依赖方向**:
- A6.4 → Game/Memory/Runtime ❌
- A6.4 → kernel/* ❌
- A6.4 → systems/* ❌
- A6.4 → bootstrap.ts ❌
- A6.4 → 任何执行系统 ❌
- A6.3 → A6.4 ❌（A6.3 不依赖 A6.4）
- A6.1 → A6.4 ❌
- A6.2 → A6.4 ❌
