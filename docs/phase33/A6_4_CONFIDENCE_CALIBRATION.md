# A6.4 — Confidence Calibration Design

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 设计 Confidence Calibration 机制、Confidence Bucket、Calibration Statistics 类型、样本不足处理

---

## 一、核心问题

### 1.1 问题陈述

A6.3 Prediction 产出 `confidence: number`（范围 [0, 1]）。这个 confidence 号称表示预测的可信度——例如 confidence=0.8 意味着 "80% 的把握"。

**但这个声称是否成立？**

如果长期观察发现 confidence=0.8 的 100 条 Prediction 中，只有 40 条 CORRECT，那么 confidence=0.8 就是**不可信的**——模型是 OVERCONFIDENT 的。

A6.4 的任务就是**用真实 Resolution 数据验证 confidence 是否 self-calibrated**，并产出 Calibration Statistics 作为后续阶段（A6.5+ Recommendation Engine）的输入。

### 1.2 Calibration 不是重新预测

| 行为 | 允许？ | 说明 |
|------|--------|------|
| 统计 observed success rate per confidence bucket | ✅ | 核心 Calibration 行为 |
| 计算 calibration error（observed vs predicted） | ✅ | 度量校准偏差 |
| 标记模型为 OVERCONFIDENT / UNDERCONFIDENT | ✅ | Calibration 结论 |
| 自动修改下一次 Prediction 的 confidence | ❌ | 未授权——A6.4 只产出 Statistics |
| 自动修改模型参数 | ❌ | 违反 Shadow-Only |
| 喂给 Strategy / Spawn / Military | ❌ | 违反 CAL-009 |
| 建立万能 globalCalibrationScore | ❌ | 禁止——不同模型独立统计 |

---

## 二、Confidence Bucket 设计

### 2.1 为什么需要 Bucket

单条 Prediction 无法判断 confidence 是否可信——必须按 group 统计。

将 confidence 范围 [0, 1] 分成固定桶，统计每个桶内的 observed success rate。

### 2.2 Bucket 定义

```
Bucket 0: [0.0, 0.1)    — 极低置信
Bucket 1: [0.1, 0.2)    — 低置信
Bucket 2: [0.2, 0.3)    — 低置信
Bucket 3: [0.3, 0.4)    — 中低置信
Bucket 4: [0.4, 0.5)    — 中置信
Bucket 5: [0.5, 0.6)    — 中置信
Bucket 6: [0.6, 0.7)    — 中高置信
Bucket 7: [0.7, 0.8)    — 高置信
Bucket 8: [0.8, 0.9)    — 高置信
Bucket 9: [0.9, 1.0]    — 极高置信
```

10 个桶，每桶宽度 0.1。confidence=0.8 归入 Bucket 8。

### 2.3 Bucket 选择函数

```typescript
function confidenceBucket(confidence: number): number {
  if (confidence < 0 || confidence > 1) throw new Error("confidence out of range");
  return Math.min(9, Math.floor(confidence * 10));
}
```

### 2.4 为什么不用更细的桶

- Screeps 单模型的 Prediction 产出量有限（低频 500t 运行，每天约 200 条）
- 10 个桶 × 每桶最少 30 样本 → 300 条 Resolution 才够基本判断
- 更细的桶会导致每桶样本严重不足（INSUFFICIENT_DATA）
- 10 个桶在统计学上是 reliability diagram 的标准粒度

---

## 三、Calibration Statistics 类型设计

### 3.1 ConfidenceBucketStats

```typescript
/**
 * 单个 Confidence Bucket 的统计。
 *
 * 纯数据对象，无 Game/Memory 引用。
 */
interface ConfidenceBucketStats {
  /** Bucket 序号 (0-9)。 */
  readonly bucketIndex: number;
  /** Bucket 置信度范围下限。 */
  readonly confidenceLow: number;
  /** Bucket 置信度范围上限。 */
  readonly confidenceHigh: number;
  /** 平均 claimed confidence（该桶所有 Prediction 的 confidence 均值）。 */
  readonly avgConfidence: number;
  /** 观测到的成功率（CORRECT + PARTIAL*0.5）/ denominator。 */
  readonly observedSuccessRate: number;
  /** 该桶内 Resolution 总数（denominator = CORRECT + INCORRECT + PARTIAL + FALSE_POSITIVE + FALSE_NEGATIVE）。 */
  readonly sampleCount: number;
  /** 该桶内各 Resolution 类型的计数。 */
  readonly resolutionCounts: {
    readonly CORRECT: number;
    readonly INCORRECT: number;
    readonly PARTIAL: number;
    readonly FALSE_POSITIVE: number;
    readonly FALSE_NEGATIVE: number;
  };
  /** Calibration error = |avgConfidence - observedSuccessRate|。 */
  readonly calibrationError: number;
  /** 样本是否充足（sampleCount >= MIN_SAMPLES_PER_BUCKET）。 */
  readonly sufficient: boolean;
}
```

### 3.2 ModelCalibrationProfile

```typescript
/**
 * 单个 Prediction Model 的 Calibration Profile。
 *
 * 按 (target + method + modelVersion) 分组统计。
 * 禁止跨模型合并。
 */
interface ModelCalibrationProfile {
  /** 模型标识 = `${target}:${method}:v${modelVersion}` */
  readonly modelKey: string;
  /** Prediction Target。 */
  readonly target: string;
  /** Prediction Method。 */
  readonly method: string;
  /** 模型版本。 */
  readonly modelVersion: number;
  /** 统计时间戳。 */
  readonly statisticsTick: number;
  /** 总 Resolution 数。 */
  readonly totalResolutions: number;
  /** 进入 calibration denominator 的数量。 */
  readonly calibratableCount: number;
  /** REGIME_CHANGED 数量（不计入 denominator）。 */
  readonly regimeChangedCount: number;
  /** EXTERNAL_INTERFERENCE 数量（不计入 denominator）。 */
  readonly externalInterferenceCount: number;
  /** INSUFFICIENT_OBSERVATION 数量（不计入 denominator）。 */
  readonly insufficientObservationCount: number;
  /** 按 Confidence Bucket 分组的统计。 */
  readonly buckets: readonly ConfidenceBucketStats[];
  /** 整体 calibration 判定。 */
  readonly calibrationVerdict: CalibrationVerdict;
  /** Expected Calibration Error (ECE)。 */
  readonly ece: number;
  /** Brier Score（仅对二元预测适用）。 */
  readonly brierScore: number | null;
  /** 误报率 (FALSE_POSITIVE / (FALSE_POSITIVE + CORRECT))。 */
  readonly falsePositiveRate: number;
  /** 漏报率 (FALSE_NEGATIVE / (FALSE_NEGATIVE + CORRECT))。 */
  readonly falseNegativeRate: number;
  /** 确定性 hash。 */
  readonly profileHash: string;
}
```

### 3.3 CalibrationVerdict

```typescript
/**
 * 校准判定结果。
 *
 * 只有在样本充足时才产出非 INSUFFICIENT_DATA 判定。
 */
type CalibrationVerdict =
  | "WELL_CALIBRATED"    // |ECE| < 0.1 且样本充足
  | "OVERCONFIDENT"      // avgConfidence > observedSuccessRate + 0.1
  | "UNDERCONFIDENT"     // avgConfidence < observedSuccessRate - 0.1
  | "INSUFFICIENT_DATA"; // 样本不足
```

### 3.4 统计量定义

| 统计量 | 公式 | 适用性 | 说明 |
|--------|------|--------|------|
| **observedSuccessRate** | `(CORRECT + 0.5×PARTIAL) / denominator` | 所有模型 | PARTIAL 计半分 |
| **calibrationError** | `|avgConfidence - observedSuccessRate|` | 所有模型 | 桶级度量 |
| **ECE** | `Σ (bucket_size / total) × |bucket_calibrationError|` | 所有模型 | 加权平均校准误差 |
| **Brier Score** | `(1/N) × Σ (predicted_prob - actual_outcome)²` | 仅二元预测 | 预测概率均方误差 |
| **falsePositiveRate** | `FALSE_POSITIVE / (FALSE_POSITIVE + CORRECT)` | 二元预测 | 误报率 |
| **falseNegativeRate** | `FALSE_NEGATIVE / (FALSE_NEGATIVE + CORRECT)` | 二元预测 | 漏报率 |

### 3.5 Brier Score 适用性判定

| 模型 | 预测类型 | Brier Score 适用？ | 理由 |
|------|---------|-------------------|------|
| energy-shortage | 值型（预测值 vs 阈值） | ⚠️ 转换后可用 | 需先二元化：跌破阈值=1，未跌破=0 |
| spawn-starvation | 值型（预测队列长度趋势） | ⚠️ 转换后可用 | 同上 |

**结论**: Brier Score 可以计算，但需要先将值型预测二元化。A6.4 中 Brier Score 为**可选指标**，在 `ModelCalibrationProfile.brierScore` 中标记为 `number | null`——不适用的模型为 null。

---

## 四、ECE (Expected Calibration Error)

### 4.1 定义

```
ECE = Σ_{b=0}^{9} (n_b / N) × |acc(b) - conf(b)|
```

其中：
- `n_b` = bucket b 中的样本数
- `N` = 总样本数（仅 calibratable denominator）
- `acc(b)` = bucket b 的 observedSuccessRate
- `conf(b)` = bucket b 的 avgConfidence

### 4.2 为什么选 ECE

| 候选 | 优点 | 缺点 | 是否采用 |
|------|------|------|---------|
| ECE | 标准校准度量、直觉清晰、分组可比 | 大数据集才有统计意义 | ✅ 采用 |
| Brier Score | 同时度量校准和区分度 | 仅适用二元预测 | ⚠️ 可选 |
| Log Loss | 对极端概率敏感 | 需要概率输出，对非二元不友好 | ❌ 不采用 |
| Reliability Diagram | 可视化好 | 无法压缩为数值 | ❌ 不采用（但 Bucket 数据支持后续可视化） |

### 4.3 ECE 判定阈值

| ECE 范围 | 判定 | 说明 |
|----------|------|------|
| < 0.05 | WELL_CALIBRATED | 校准良好 |
| 0.05 – 0.15 | 轻度偏差 | 可标记但不下结论 |
| > 0.15 | OVERCONFIDENT 或 UNDERCONFIDENT | 需要检查方向 |
| 样本不足 | INSUFFICIENT_DATA | 不产出判定 |

**方向判定**:
- `avgConfidence > observedSuccessRate + 0.1` → OVERCONFIDENT
- `avgConfidence < observedSuccessRate - 0.1` → UNDERCONFIDENT

---

## 五、样本不足处理

### 5.1 最小样本数

| 粒度 | 最小样本数 | 说明 |
|------|-----------|------|
| 单个 Bucket | 30 | 每桶至少 30 条 calibratable Resolution |
| 单个 Model | 100 | 模型总共至少 100 条 calibratable Resolution |
| Calibration Verdict | 200 | 产出 WELL_CALIBRATED/OVERCONFIDENT/UNDERCONFIDENT 至少 200 条 |

### 5.2 样本不足时的行为

```typescript
function computeCalibrationVerdict(
  profile: ModelCalibrationProfile,
): CalibrationVerdict {
  if (profile.calibratableCount < MIN_SAMPLES_FOR_VERDICT) {
    return "INSUFFICIENT_DATA";
  }
  // 检查每个桶是否充足
  const insufficientBuckets = profile.buckets.filter(b => !b.sufficient);
  if (insufficientBuckets.length > 5) {
    // 超过一半的桶样本不足
    return "INSUFFICIENT_DATA";
  }
  // 有足够数据才判定
  if (profile.ece < 0.05) return "WELL_CALIBRATED";
  // 检查方向
  const overallConf = weightedAvg(profile.buckets.map(b => b.avgConfidence));
  const overallObs = weightedAvg(profile.buckets.map(b => b.observedSuccessRate));
  if (overallConf > overallObs + 0.1) return "OVERCONFIDENT";
  if (overallConf < overallObs - 0.1) return "UNDERCONFIDENT";
  return "WELL_CALIBRATED";
}
```

### 5.3 为什么样本不足时绝对不下结论

**数学理由**：

- 10 条 Prediction 中 4 条 CORRECT → success rate = 40%
- 95% 置信区间约为 [12%, 74%]（Wilson interval）
- 这个区间太宽，无法判断 confidence=0.8 是否合理
- 只有在样本 ≥ 30 时，置信区间才足够窄

**防退化**:

- 样本不足时产出 `INSUFFICIENT_DATA`，不产出任何校准判定
- 避免模型因初期数据少被错误标记为 OVERCONFIDENT/UNDERCONFIDENT
- 避免后续阶段（A6.5+）基于不充分数据做决策

---

## 六、防止过度惩罚低置信度 Prediction

### 6.1 问题

低 confidence（如 0.2）的 Prediction 如果失败了，不应该比高 confidence（如 0.9）的 Prediction 失败被更严重地惩罚——因为模型已经声称 "只有 20% 的把握"。

### 6.2 解决方案

Calibration 不使用 "惩罚" 概念。Calibration 只度量 **claimed confidence 与 observed success rate 的偏差**。

| 场景 | claimed | observed | 判定 | 说明 |
|------|---------|----------|------|------|
| 高 confidence、低 success | 0.8 | 0.4 | OVERCONFIDENT | 模型高估了自己 |
| 低 confidence、高 success | 0.2 | 0.6 | UNDERCONFIDENT | 模型低估了自己 |
| 高 confidence、高 success | 0.8 | 0.8 | WELL_CALIBRATED | 理想状态 |
| 低 confidence、低 success | 0.2 | 0.2 | WELL_CALIBRATED | 理想状态 |

**关键**: Calibration 评判的是**校准质量**（claimed ≈ observed），不是**绝对准确率**。低 confidence 的模型如果确实只有 20% 成功率，它就是 well-calibrated 的。

### 6.3 不过度惩罚 PARTIAL

PARTIAL Resolution 的处理：

```typescript
function computeObservedSuccessRate(counts: ResolutionCounts): number {
  const denominator = counts.CORRECT + counts.INCORRECT + counts.PARTIAL
    + counts.FALSE_POSITIVE + counts.FALSE_NEGATIVE;
  if (denominator === 0) return 0;
  // PARTIAL 计半分
  return (counts.CORRECT + 0.5 * counts.PARTIAL) / denominator;
}
```

PARTIAL 不是完全正确也不是完全错误。计 0.5 是一个保守但合理的折中。

---

## 七、Calibration Statistics 数据流

```
ResolutionResult[]（来自 Resolution Engine）
    ↓
按 (target + method + modelVersion) 分组
    ↓
对每组：
  1. 过滤掉 REGIME_CHANGED / EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION
  2. 按 confidence bucket 分桶
  3. 每桶计算 observedSuccessRate + calibrationError
  4. 计算 ECE / Brier Score / FPR / FNR
  5. 判定 CalibrationVerdict
    ↓
ModelCalibrationProfile[]
    ↓
存入 __calibrationCache (Ring Buffer)
```

---

## 八、Calibration Ring Buffer 设计

### 8.1 数据结构

```typescript
interface CalibrationRingBuffer {
  /** Resolution 结果 Ring Buffer。 */
  readonly resolutionRecords: (ResolutionResult | undefined)[];
  /** 容量。 */
  readonly resolutionCapacity: number;
  /** 已写入数。 */
  resolutionCount: number;
  /** 写入游标。 */
  resolutionCursor: number;
  /** Model Calibration Profile 快照。 */
  readonly profiles: Map<string, ModelCalibrationProfile>;
  /** 上次 profile 更新 tick。 */
  lastProfileTick: number;
}
```

### 8.2 容量设计

| 数据 | 容量 | 理由 |
|------|------|------|
| ResolutionResult Ring Buffer | 500 | 2 个模型 × 500t cadence → 每 500t 约 2 条 Prediction → 500 条覆盖 ~125000 tick ≈ 50 天 |
| ModelCalibrationProfile | 最多 10 个模型 | Map 存储，每个模型 1 条 Profile |

### 8.3 Memory 估算

| 数据 | 单条大小 | 容量 | 总计 |
|------|---------|------|------|
| ResolutionResult | ~200 bytes | 500 | ~100 KB |
| ModelCalibrationProfile | ~2 KB | 10 | ~20 KB |
| **总计** | | | **~120 KB** |

完全在 globalCache heap 中，不进 Memory。

### 8.4 GC 策略

```typescript
function gcCalibrationBuffer(buf: CalibrationRingBuffer, maxAge: number, currentTick: number): number {
  let cleaned = 0;
  for (let i = 0; i < buf.resolutionRecords.length; i++) {
    const r = buf.resolutionRecords[i];
    if (!r) continue;
    // ResolutionResult 不存 tick，需要通过 resolvedTick 判断
    if (currentTick - r.resolvedTick > maxAge) {
      buf.resolutionRecords[i] = undefined;
      cleaned++;
    }
  }
  return cleaned;
}
```

`maxAge = 100000` tick（约 40 天）。超龄的 Resolution 被清除，但 Profile 是持续更新的快照，不需要单独 GC。

---

## 九、与 A6.1/A6.2/A6.3 的数据关系

### 9.1 数据来源映射

| Calibration 输入 | 来源 | 关系 |
|-----------------|------|------|
| Prediction | A6.3 PredictionRingBuffer | 只读消费 |
| Outcome actualValue | A6.1 OutcomeRecord.value | 只读消费（通过 time-window 匹配） |
| Attribution externalFactors | A6.1 Attribution.externalFactors | 只读消费 |
| Evaluation hasExternalFactor | A6.2 EvaluationFinding.hasExternalFactor | 只读消费（交叉验证） |
| ContextSignature | A6.3 Prediction.contextSignature | 只读消费 |
| RegimeCompatibility | A6.3 checkRegimeCompatibility() | 只读复用 |
| Hash 函数 | A6.3 fnv1a32Hex / stableStringify | 只读复用 |

### 9.2 不建立第二套 Metrics

A6.4 Calibration Statistics 的所有数值都来自 ResolutionResult（A6.4 自有），而 ResolutionResult 的所有输入都来自 A6.1/A6.2/A6.3。

**A6.4 不采集任何新的 Metrics。** A6.4 只做统计聚合。

---

## 十、确定性保证

### 10.1 Profile Hash 计算

```typescript
function calibrationProfileHash(profile: ModelCalibrationProfile): string {
  const payload = stableStringify({
    modelKey: profile.modelKey,
    buckets: profile.buckets.map(b => ({
      bucketIndex: b.bucketIndex,
      avgConfidence: Number(b.avgConfidence.toFixed(3)),
      observedSuccessRate: Number(b.observedSuccessRate.toFixed(3)),
      sampleCount: b.sampleCount,
    })),
    ece: Number(profile.ece.toFixed(3)),
    totalResolutions: profile.totalResolutions,
  });
  return fnv1a32Hex(payload);
}
```

### 10.2 确定性验证

- 同一组 ResolutionResult → 相同 ModelCalibrationProfile → 相同 profileHash
- 100× replay → 100% identical hash
- 禁止 Math.random / Date.now / 无序迭代
- Bucket 内 Resolution 的处理顺序不影响结果（因为是计数统计）

---

## 十一、关键常量汇总

```typescript
/** Confidence Bucket 数量。 */
const CONFIDENCE_BUCKET_COUNT = 10;

/** 每桶最小样本数。 */
const MIN_SAMPLES_PER_BUCKET = 30;

/** 模型总 Resolution 最小样本数（产出 Profile）。 */
const MIN_SAMPLES_FOR_PROFILE = 100;

/** 产出 Calibration Verdict 的最小样本数。 */
const MIN_SAMPLES_FOR_VERDICT = 200;

/** ECE WELL_CALIBRATED 阈值。 */
const ECE_WELL_CALIBRATED_THRESHOLD = 0.05;

/** Calibration 偏差阈值（判定 OVER/UNDER）。 */
const CALIBRATION_BIAS_THRESHOLD = 0.1;

/** Resolution Ring Buffer 容量。 */
const RESOLUTION_RING_BUFFER_CAPACITY = 500;

/** Resolution 最大存活 tick。 */
const RESOLUTION_MAX_AGE = 100000;

/** Calibration System 运行间隔（tick）。 */
const CALIBRATION_INTERVAL = 500;
```
