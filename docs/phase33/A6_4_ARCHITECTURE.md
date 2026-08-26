# A6.4 — Calibration Architecture

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: A6.4 整体架构、数据流、Domain/System 分层、CPU 预算、Memory 预算、Determinism Contract、Architecture Guards

---

## 一、架构总览

### 1.1 在 A6 体系中的位置

```
A6.1 Experience / Outcome / Attribution
    ↓ (只读消费)
A6.2 Strategy Evaluation / Baseline / Evidence
    ↓ (只读消费)
A6.3 Prediction Infrastructure / Prediction Models
    ↓ (只读消费)
A6.4 Prediction Calibration & Resolution
    ↓ (产出 Shadow-Only Statistics)
A6.5+ 后续 Intelligence (Recommendation / Auto-Apply / Strategy Adaptation)
```

### 1.2 A6.4 内部分层

```
┌─────────────────────────────────────────────────────────────┐
│  A6.4 System Layer (薄壳)                                    │
│  calibration-resolution-system.ts                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 职责：                                                   │ │
│  │ 1. 从 globalCache 读取待 Resolution 的 Prediction        │ │
│  │ 2. 采集 Observation（复用既有 cadence 数据）              │ │
│  │ 3. 调用 Domain 纯函数                                   │ │
│  │ 4. 保存结果到 globalCache                                │ │
│  │ 5. GC                                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  A6.4 Domain Layer (纯函数)                                  │
│  src/domain/intelligence/calibration/                       │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ resolve.ts  │ │ calibrate.ts  │ │ attribution.ts        │ │
│  │ Resolution  │ │ Calibration   │ │ Failure Attribution   │ │
│  │ Engine      │ │ Statistics    │ │                       │ │
│  └────────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ types.ts   │ │ hashing.ts   │ │ guards.ts             │ │
│  │ Type Defs  │ │ Det. Hashing │ │ CAL-XXX Guards        │ │
│  └────────────┘ └──────────────┘ └──────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  只读消费（不修改）                                           │
│  A6.3: Prediction / RingBuffer / Context / Hashing          │
│  A6.1: Experience / Outcome / Attribution                   │
│  A6.2: StrategyEvaluation / EvaluationFinding               │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 关键原则

1. **Shadow-Only**: A6.4 只写 `__calibrationCache`，不修改任何执行系统
2. **Domain Purity**: Domain 层纯函数，不引用 Game/Memory/Runtime
3. **No New Sampler**: A6.4 不新建采样通道，复用既有 globalCache 数据
4. **No Second Metrics**: A6.4 不采集任何新 Metrics，只做统计聚合
5. **Per-Model Independence**: 不同模型的 Calibration 独立统计，不合并

---

## 二、Domain 层设计

### 2.1 文件结构

```
src/domain/intelligence/calibration/
  ├── index.ts          # 统一导出
  ├── types.ts          # 所有类型定义
  ├── resolve.ts        # Resolution Engine（纯函数）
  ├── calibrate.ts      # Calibration Statistics 计算（纯函数）
  ├── attribution.ts    # Failure Attribution（纯函数）
  ├── hashing.ts        # 确定性 Hash（复用 A6.3 hashing）
  └── guards.ts         # CAL-XXX 守卫（纯函数）
```

### 2.2 Domain 层依赖图

```
calibration/types.ts       ← 无依赖
calibration/hashing.ts     ← 复用 A6.3 prediction/hashing.ts (stableStringify + fnv1a32Hex)
calibration/resolve.ts     ← 依赖 types.ts + A6.3 prediction/types.ts + A6.3 context.ts
calibration/calibrate.ts   ← 依赖 types.ts + resolve.ts
calibration/attribution.ts ← 依赖 types.ts + resolve.ts + A6.1 experience.ts (AttributionFactor)
calibration/guards.ts      ← 依赖 types.ts
calibration/index.ts       ← 统一导出
```

### 2.3 Domain 纯函数接口

```typescript
// resolve.ts
export function resolvePrediction(
  prediction: Prediction,
  observations: readonly ObservationSample[],
  currentContext: PredictionContext,
  externalFactors: readonly ExternalFactorSignal[],
): ResolutionResult;

// calibrate.ts
export function computeCalibrationProfile(
  resolutions: readonly ResolutionResult[],
  predictions: readonly Prediction[],
  modelKey: string,
): ModelCalibrationProfile;

export function computeCalibrationStatistics(
  resolutionRingBuffer: CalibrationRingBuffer,
): readonly ModelCalibrationProfile[];

// attribution.ts
export function attributeFailure(
  resolutionResult: ResolutionResult,
  prediction: Prediction,
  a61Attribution?: Attribution,
  a62Finding?: EvaluationFinding,
): FailureAttributionResult | null;

export function computeModelFailureStats(
  attributions: readonly FailureAttributionResult[],
  modelKey: string,
): ModelFailureStats;
```

---

## 三、System 层设计

### 3.1 calibration-resolution-system.ts

```typescript
export const calibrationResolutionSystem: System = {
  name: "calibration-resolution",
  priority: 3 as Priority,    // P3 — 低频 post
  interval: 500,              // 500t cadence（寄生 strategy-evaluation）
  phase: "post",

  run(ctx: TickContext): void {
    // 1. 初始化缓存
    // 2. 从 globalCache.__predictionCache 读取待 Resolution 的 Prediction
    // 3. 采集 Observation（从 globalCache 既有数据）
    // 4. 调用 Domain: resolvePrediction()
    // 5. 将 ResolutionResult 存入 __calibrationCache
    // 6. 每 5000t 调用 Domain: computeCalibrationStatistics()
    // 7. GC
  }
};
```

### 3.2 为什么寄生 500t cadence

| 系统 | Cadence | 数据 | 可寄生？ |
|------|---------|------|---------|
| experience-collector-system | 100t | Experience | ❌ 频率太高 |
| strategy-evaluation-system | 500t | StrategyEvaluation | ✅ **选择** |
| (未来) prediction-system | 500t(预期) | Prediction | ✅ 同频 |

**理由**:
1. A6.2 strategy-evaluation-system 已经在 500t cadence 上运行，A6.4 可以在同频 post 阶段执行
2. 500t 足够低频：每 500t 处理一批 Resolution，不影响 CPU
3. 500t 足够高频：在 Prediction 的 Horizon（通常 1000-5000t）内能采集足够 Observation
4. 不新建 tick 循环（遵守 CAL-007）

### 3.3 CPU 预算

| 操作 | 预计 CPU | 频率 | 每 tick 均摊 |
|------|---------|------|-------------|
| 读取 Prediction Ring Buffer | ~0.01 | 500t | 0.00002 |
| 采集 Observation | ~0.02 | 500t | 0.00004 |
| resolvePrediction() × N | ~0.05 × 5 | 500t | 0.0005 |
| computeCalibrationStatistics() | ~0.1 | 5000t | 0.00002 |
| GC | ~0.01 | 5000t | 0.000002 |
| **总计** | | | **~0.0006 CPU/tick** |

远低于 CPU 预算上限。即使 Recovery 档位（CPU 受限）也不会被降级跳过。

### 3.4 bootstrap.ts 注册

```typescript
// bootstrap.ts 中新增（Implementation 阶段）
import { calibrationResolutionSystem } from "./systems/intelligence/calibration-resolution-system";

// 在 systems 数组中添加
systems.push(calibrationResolutionSystem);
```

**注意**: Implementation 阶段需要同时补建 `prediction-system`（CAL-GAP-8），否则 Ring Buffer 为空，Calibration 无样本。

---

## 四、数据流详解

### 4.1 完整数据流

```
                    ┌─────────────────────────────────┐
                    │  A6.3 Prediction Ring Buffer     │
                    │  globalCache.__predictionCache    │
                    │  (status: "active")              │
                    └──────────┬──────────────────────┘
                               │ 读取 active predictions
                               ▼
                    ┌─────────────────────────────────┐
                    │  A6.4 System Layer               │
                    │  检查 window.endTick + grace     │
                    │  = currentTick?                  │
                    └──────────┬──────────────────────┘
                               │ 是 → 待 Resolution
                               ▼
                    ┌─────────────────────────────────┐
                    │  采集 Observation                │
                    │  从 globalCache 既有数据读取     │
                    │  (empireHealth, reserveHistory)  │
                    └──────────┬──────────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────────┐
                    │  A6.1 Attribution 查询           │
                    │  从 __experienceCache 匹配        │
                    │  (时间窗口匹配)                  │
                    └──────────┬──────────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────────┐
                    │  A6.2 Evaluation 查询            │
                    │  从 __evaluationCache 匹配       │
                    │  (时间窗口匹配)                  │
                    └──────────┬──────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  A6.4 Domain Layer                                           │
│                                                              │
│  resolvePrediction()  →  ResolutionResult                   │
│         │                                                    │
│         ├─→  calibrate.ts: computeCalibrationProfile()      │
│         │    →  ModelCalibrationProfile                      │
│         │                                                    │
│         └─→  attribution.ts: attributeFailure()             │
│              →  FailureAttributionResult                   │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
            ┌─────────────────────────────────┐
            │  globalCache.__calibrationCache   │
            │  (Ring Buffer + Profiles)        │
            │  Shadow-Only                      │
            └─────────────────────────────────┘
```

### 4.2 Observation 采集策略

A6.4 不新建采样通道。Observation 在 Resolution 时刻从 globalCache 一次性读取：

| Prediction Target | Observation 数据源 | 读取方式 |
|-------------------|-------------------|---------|
| energy-shortage | `globalCache.empireHealth` + `globalCache.__reserveHistory` | 直接读取当前值 + 历史序列 |
| spawn-starvation | `globalCache.empireHealth.dimensions.spawn` + spawn queue stats | 直接读取 |

**Observation Sample 结构**:

```typescript
interface ObservationSample {
  /** 采样 tick。 */
  readonly tick: number;
  /** 观测值。 */
  readonly value: number;
  /** 数据来源标识。 */
  readonly source: string;
}
```

Observation 在 `[prediction.window.startTick, prediction.window.endTick]` 范围内从既有 TimeSeries 提取。不主动采样。

---

## 五、Memory 预算

### 5.1 globalCache 存储

| 数据 | 存储位置 | 容量 | 单条大小 | 总计 |
|------|---------|------|---------|------|
| ResolutionResult | `__calibrationCache.resolutionRecords` | 500 | ~200 B | ~100 KB |
| ModelCalibrationProfile | `__calibrationCache.profiles` | 10 模型 | ~2 KB | ~20 KB |
| ModelFailureStats | `__calibrationCache.failureStats` | 10 模型 | ~500 B | ~5 KB |
| **总计** | | | | **~125 KB** |

### 5.2 Memory 持久化策略

| 数据 | 存 Memory？ | 理由 |
|------|-----------|------|
| ResolutionResult | ❌ heap only | 累积快，不需要跨 global reset 保留 |
| ModelCalibrationProfile | ⚠️ RawMemory segment（可选） | 低频快照（每 5000t），用于跨 reset 保留长期统计 |
| ModelFailureStats | ⚠️ RawMemory segment（可选） | 同上 |

**建议**: Implementation 阶段先做 heap-only。如果发现 global reset 导致 Calibration 统计频繁丢失，再引入 RawMemory segment 快照（≤ 5000t 一次写入）。

### 5.3 Memory 边界保证

```typescript
// 硬上限
const MAX_CALIBRATION_HEAP = 200_000; // 200 KB
const MAX_RESOLUTION_RECORDS = 500;
const MAX_PROFILES = 10;

// GC 策略
function gcCalibrationCache(buf: CalibrationRingBuffer, currentTick: number): void {
  // 1. 清除超龄 ResolutionResult
  for (let i = 0; i < buf.resolutionRecords.length; i++) {
    const r = buf.resolutionRecords[i];
    if (r && currentTick - r.resolvedTick > RESOLUTION_MAX_AGE) {
      buf.resolutionRecords[i] = undefined;
    }
  }
  // 2. Profile 持续更新，不需要 GC（新数据覆盖旧快照）
}
```

### 5.4 只存 ID + 数字 + 短 key

严格遵守 Memory Architecture（MEMORY_ARCHITECTURE.md）：

| 存储内容 | 类型 | 符合规范？ |
|---------|------|-----------|
| predictionId | string (短) | ✅ |
| resolution | enum string | ✅ |
| resolvedTick | number | ✅ |
| predictedValue | number | ✅ |
| actualValue | number | ✅ |
| relativeError | number | ✅ |
| modelKey | string (短) | ✅ |
| calibrationVerdict | enum string | ✅ |
| ece | number | ✅ |
| bucketStats | number[] | ✅ |

**不存储**: Game Object、Room Object、Creep Object、完整 Experience、完整 Prediction、完整 Runtime Snapshot。

---

## 六、Determinism Contract

### 6.1 确定性要求

| 数据 | 确定性要求 | 验证方法 |
|------|-----------|---------|
| ResolutionResult | 相同 Prediction + 相同 Observation → 相同 resolutionHash | 100× replay |
| ModelCalibrationProfile | 相同 ResolutionResult 集合 → 相同 profileHash | 100× replay |
| FailureAttributionResult | 相同 ResolutionResult + 相同 Prediction → 相同 attributionHash | 100× replay |

### 6.2 禁止的非确定性来源

| 来源 | 禁止场景 | 替代方案 |
|------|---------|---------|
| `Math.random()` | 任何地方 | 确定性规则 |
| `Date.now()` | 任何地方 | 使用 `ctx.tick` |
| Wall clock | 任何地方 | 使用 `ctx.tick` |
| 无序 Map/Set 迭代 | Profile 计算 | 先排序再迭代 |
| 浮点误差 | Hash 计算 | `toFixed(3)` 截断 |
| 运行时对象引用 | 序列化 | 只存 ID + 数字 |

### 6.3 Hash 算法复用

A6.4 复用 A6.3 的 `stableStringify` + `fnv1a32Hex`：

```typescript
// 从 A6.3 import
import { stableStringify, fnv1a32Hex } from "../prediction/hashing";
```

**不新建** hashing 实现。

### 6.4 确定性验证函数

```typescript
export function verifyResolutionDeterminism(
  prediction: Prediction,
  observations: readonly ObservationSample[],
  currentContext: PredictionContext,
  externalFactors: readonly ExternalFactorSignal[],
  iterations = 100,
): { deterministic: boolean; firstDivergenceAt?: number } {
  const firstResult = resolvePrediction(prediction, observations, currentContext, externalFactors);
  const firstHash = firstResult.resolutionHash;
  for (let i = 1; i < iterations; i++) {
    const r = resolvePrediction(prediction, observations, currentContext, externalFactors);
    if (r.resolutionHash !== firstHash) {
      return { deterministic: false, firstDivergenceAt: i };
    }
  }
  return { deterministic: true };
}
```

### 6.5 为什么 100 次 replay 足够

- A6.4 的所有函数都是**纯函数**（无副作用、无外部状态、无随机性）
- 第一次调用和第 N 次调用的唯一可能差异来自非确定性来源
- 如果 100 次结果完全一致，可以排除 Math.random / Date.now / 浮点误差
- A6.3 使用 1000 次验证，A6.4 作为下游消费方 100 次足够

---

## 七、Architecture Guards (CAL-XXX)

### 7.1 守卫清单

```typescript
// guards.ts

/** CAL-001: Shadow-Only — A6.4 只写 __calibrationCache */
export function guardCalShadowOnly(target: string): GuardResult;

/** CAL-002: Domain Purity — Domain 函数不引用 Game/Memory */
export function guardCalDomainPurity(fn: Function): GuardResult;

/** CAL-003: No Game API — 不调用 Game API */
export function guardCalNoGameApi(): GuardResult;

/** CAL-004: No Runtime Mutation — 不修改任何运行时状态 */
export function guardCalNoRuntimeMutation(cache: unknown): GuardResult;

/** CAL-005: Deterministic — 相同输入 → 相同输出 */
export function guardCalDeterminism(
  fn: () => string,
  iterations: number,
): GuardResult;

/** CAL-006: Bounded Memory — Resolution Ring Buffer 不超容量 */
export function guardCalBoundedMemory(buf: CalibrationRingBuffer): GuardResult;

/** CAL-007: No New Tick Sampler — 不新建采样通道 */
export function guardCalNoNewSampler(system: System): GuardResult;

/** CAL-008: No Second Metrics — 不采集新 Metrics */
export function guardCalNoSecondMetrics(): GuardResult;

/** CAL-009: No Strategy Mutation — 不修改 Strategy/Posture/Spawn */
export function guardCalNoStrategyMutation(): GuardResult;

/** CAL-010: Evidence Traceability — 每条 Resolution 可追溯到 Prediction */
export function guardCalEvidenceTraceability(result: ResolutionResult): GuardResult;
```

### 7.2 守卫检查时机

| 守卫 | 检查时机 | 失败处理 |
|------|---------|---------|
| CAL-001 | system run 末尾 | console.log 告警，不中断 |
| CAL-002 | 开发时静态检查 | 编译/测试时发现 |
| CAL-003 | system run 中 | safeRun 隔离 |
| CAL-004 | system run 末尾 | console.log 告警 |
| CAL-005 | 测试中 | 测试失败 |
| CAL-006 | GC 后 | console.log 告警 |
| CAL-007 | system 注册时 | 启动检查 |
| CAL-008 | system run 中 | console.log 告警 |
| CAL-009 | system run 末尾 | safeRun 隔离 + 告警 |
| CAL-010 | Resolution 产出时 | 丢弃无 traceability 的结果 |

---

## 八、防退化架构检查

### 8.1 七大退化模式检查表

| 退化模式 | 对应 Guard | 检查方式 | 状态 |
|---------|----------|---------|------|
| 退化 1：单点 Resolution | CAL-010 | Resolution 必须引用完整 Observation Window | ✅ 防护 |
| 退化 2：confidence = success rate | CAL-005 | Calibration 用 bucket + ECE，不是简单 success rate | ✅ 防护 |
| 退化 3：万能 predictionScore | CAL-008 | 禁止合并多维 Prediction 为单一 score | ✅ 防护 |
| 退化 4：合并所有模型 | CAL-008 | 按 modelKey 分组，禁止 globalCalibrationScore | ✅ 防护 |
| 退化 5：直接喂 Strategy | CAL-009 | A6.4 只写 __calibrationCache | ✅ 防护 |
| 退化 6：Regime = Model Failure | CAL-005 | REGIME_CHANGED 不计入 denominator | ✅ 防护 |
| 退化 7：External = Failure | CAL-005 | EXTERNAL_INTERFERENCE 不计入 denominator | ✅ 防护 |

### 8.2 依赖方向审计

```
A6.4 Domain imports:
  - A6.3 prediction/types.ts       ✅ 只读类型
  - A6.3 prediction/context.ts    ✅ 只读函数
  - A6.3 prediction/hashing.ts    ✅ 只读函数
  - A6.1 experience.ts            ✅ 只读类型
  - A6.2 strategy-evaluation.ts   ✅ 只读类型

A6.4 Domain does NOT import:
  - Game / Memory / RawMemory     ✅
  - kernel/*                      ✅
  - systems/*                     ✅
  - bootstrap.ts                  ✅
  - Any executor system           ✅
```

---

## 九、未来模型接入机制

### 9.1 自动接入

当 A6.3 新增 Prediction Model（如 cpu-pressure、logistics-bottleneck 等）时，A6.4 的 Calibration 自动接入：

1. 新模型产出的 Prediction 存入 A6.3 Ring Buffer（`target` 字段标识模型类型）
2. A6.4 System 层读取 Ring Buffer 时，按 `target` 自动分组
3. Domain 层 `resolvePrediction` 根据 `target` 选择对应的 Resolution Metric 函数
4. `computeCalibrationProfile` 按 `modelKey = target:method:vN` 自动分组统计

### 9.2 唯一需要手动注册的地方

Resolution Metric 函数需要按模型注册：

```typescript
// resolve.ts
const resolutionMetricRegistry: Map<string, ResolutionMetricFn> = new Map([
  ["energy-shortage:linear-regression:v1", energyShortageResolutionMetric],
  ["spawn-starvation:linear-regression:v1", spawnStarvationResolutionMetric],
]);

export function resolvePrediction(prediction: Prediction, ...): ResolutionResult {
  const metricFn = resolutionMetricRegistry.get(modelKey);
  if (!metricFn) {
    // 未知模型 → 使用通用 metric
    return resolveWithGenericMetric(prediction, ...);
  }
  return metricFn(prediction, ...);
}
```

新模型只需在 `resolutionMetricRegistry` 中注册自己的 Resolution Metric 函数。

### 9.3 通用 Metric 兜底

如果未注册专用 Metric，使用通用 metric：

```typescript
function resolveWithGenericMetric(prediction: Prediction, ...): ResolutionResult {
  // 通用：relativeError < 0.2 → CORRECT, >= 0.5 → INCORRECT, else PARTIAL
  const relativeError = Math.abs(actualValue - prediction.value) / Math.abs(prediction.value);
  if (relativeError < 0.2) return { resolution: "CORRECT", ... };
  if (relativeError >= 0.5) return { resolution: "INCORRECT", ... };
  return { resolution: "PARTIAL", ... };
}
```

这保证新模型即使没有专用 Metric 也能参与 Calibration（虽然精度可能不足）。
