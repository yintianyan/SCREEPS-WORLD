# A6 Longitudinal Validation Design

> **阶段**: A6 Longitudinal Effectiveness Research
> **日期**: 2026-08-26
> **约束**: 纯研究，不写实现代码

---

## 一、目标

设计长期验证机制，确保 A6 Intelligence 在持续运行中真正提供有效信息，而非产生大量"看起来合理"的 Shadow 数据。

核心验证问题：

1. Prediction 是否真的准确？
2. Calibration 是否真的校准了 confidence？
3. Reliability HIGH 是否真的比 LOW 更可靠？
4. Recommendation 是否具有 predictive value？
5. Experience Attribution 是否真的提高了 Evaluation quality？
6. Evaluation 是否能够预测未来 Performance？

---

## 二、当前 A6 的验证能力审计

### 2.1 现有能力

| 模块 | 现有验证能力 | 缺口 |
|------|------------|------|
| A6.3 Prediction | in-sample R²（线性回归拟合度） | ❌ 没有 out-of-sample accuracy |
| A6.4 Calibration | in-sample ECE / Brier Score | ❌ 没有 train/test split |
| A6.5 Reliability | drift detection（recent vs overall ECE） | ❌ 没有前瞻性 accuracy 验证 |
| A6.6 Recommendation | TTL / supersede / conflict detection | ❌ 没有结果跟踪 |
| A6.1 Experience | Outcome classification（success/failure/unknown） | ❌ 没有 Attribution 准确性验证 |
| A6.2 Evaluation | Baseline comparison（historical average） | ❌ 没有 future performance correlation |

### 2.2 核心差距

A6 目前的验证全部是 **in-sample**：
- Prediction 的 R² 是用全部历史数据回归得到的拟合度
- Calibration 的 ECE 是用全部 Resolution 统计得到的校准误差
- Reliability 的 drift detection 是用同一批 Resolution 比较 recent vs overall

**没有机制能在数据生成时严格隔离"训练集"和"测试集"。**

---

## 三、Longitudinal Validation 设计

### 3.1 设计原则

1. **Raw Observation 可以验证 Intelligence；Intelligence 不能反过来证明自身正确**
2. **Prediction 生成时不能看到 Future Outcome**
3. **Calibration 只能使用 prediction horizon 结束后的数据**
4. **Evaluation 不得消费未来数据**
5. **Recommendation 不得消费未来数据**

### 3.2 Historical Window → Prediction → Future Holdout → Actual Outcome → Validation

```
Time ──────────────────────────────────────────────────────────────►

  [Historical Window]     [Prediction Horizon]     [Validation Window]
  ├──────────────────┤   ├──────────────────┤   ├──────────────────┤
  │                  │   │                  │   │                  │
  │ 训练数据          │   │ 预测窗口          │   │ 实际结果观测      │
  │ (netFlowHistory  │   │ (Prediction      │   │ (Observation     │
  │  reserveHistory) │   │  window)          │   │  Samples)        │
  │                  │   │                  │   │                  │
  │ T-1000 ~ T-100  │   │ T → T+horizon    │   │ T+horizon        │
  │                  │   │                  │   │ +grace period    │
  └──────────────────┘   └──────────────────┘   └──────────────────┘
                                                    │
                                                    ▼
                                              Validation
                                              (比较 predicted vs actual)
```

### 3.3 严格时间隔离规则

| 规则 | 描述 | 违反后果 |
|------|------|---------|
| Rule-1 | Prediction 生成时（tick T）只能使用 T 之前的数据 | 违反 = data leakage |
| Rule-2 | Calibration 解析时（tick T + horizon + grace）只能使用 [T, T+horizon] 窗口内的观测 | 违反 = temporal leakage |
| Rule-3 | Evaluation 评估时只能使用评估窗口内的 Experience | 违反 = lookahead bias |
| Rule-4 | Recommendation 生成时只能使用已产生的 A6 数据 | 违反 = future information consumption |
| Rule-5 | Validation 只能使用 prediction horizon 结束后的数据 | 违反 = 自证循环 |

### 3.4 当前代码的合规性分析

#### Rule-1 合规性: ✅ 合规

`predictEnergyShortage()` 接收 `netFlowHistory` 和 `reserveHistory` 作为输入。这些 TimeSeries 由 prediction-system.ts 从 `globalCache.__reserveHistory` 构建。`__reserveHistory` 在 prediction-system 运行时（tick T）只包含 T 之前的数据（因为 empire-health-system 在 T 之前运行并写入）。

**但存在风险**: `__reserveHistory` 是一个共享数组，如果 prediction-system 运行时机发生变化（如被提前执行），可能读到 T 时刻的数据。当前 bootstrap.ts 的注册顺序保证了正确的时间序列，但这是隐式约束。

#### Rule-2 合规性: ⚠️ 部分合规

`calibration-resolution-system.ts` 的 `buildObservations()` 从 `globalCache.__reserveHistory` 读取。这个数组在 Calibration 运行时（tick T + horizon + grace）可能已经被更新到了当前 tick。但 `buildObservations()` 通过 `prediction.window.startTick` 和 `prediction.window.endTick` 过滤观测——只取窗口内的数据。

**风险**: `__reserveHistory` 的 baseTick 计算使用了 `endTick - (len - 1) * 100`，如果数组长度在 Prediction 生成后增加了，baseTick 计算会偏移，导致错误的 tick 关联。

#### Rule-3 合规性: ✅ 合规

`strategy-evaluation-system.ts` 使用 `EvaluationWindow`（startTick → endTick）限制 Experience 采集范围。只采集 `lifecycle === "FINALIZED"` 且 `outcome.measurementTick ≤ endTick` 的 Experience。

#### Rule-4 合规性: ✅ 合规

`recommendation-engine-system.ts` 从各缓存读取已有数据，不消费未来数据。Recommendation 的 `createdAt` = currentTick，所有 Evidence 的 `collectedAt` ≤ currentTick。

#### Rule-5 合规性: ⚠️ 不合规

当前没有独立的 Validation 机制。Calibration 的 ECE 计算使用了全部 Resolution（没有 holdout），等于用训练集评估模型——这违反了 Rule-5。

---

## 四、Out-of-Sample Validation 设计

### 4.1 In-Sample vs Out-of-Sample 对比

```
In-Sample（当前）:
  全部 Resolution → ECE → Reliability → Recommendation
  
Out-of-Sample（设计）:
  训练集 (70% Resolution) → 计算校准参数
  测试集 (30% Resolution) → 验证校准参数
  → 如果 in-sample ECE ≈ out-of-sample ECE → 模型可靠
  → 如果 in-sample ECE << out-of-sample ECE → 模型过拟合
```

### 4.2 时间序列交叉验证（Time Series Cross-Validation）

由于 Screeps 数据是时间序列，不能随机 shuffle（会破坏时间顺序）。使用 **rolling origin** 方式：

```
Fold 1: 训练 [T0, T100] → 预测 [T101, T200] → 验证 [T201, T300]
Fold 2: 训练 [T0, T200] → 预测 [T201, T300] → 验证 [T301, T400]
Fold 3: 训练 [T0, T300] → 预测 [T301, T400] → 验证 [T401, T500]
...
```

每个 fold 产出独立的 ECE，最终取平均值 ± 标准差。

### 4.3 判定规则

| In-Sample ECE | Out-of-Sample ECE | 判定 |
|---------------|-------------------|------|
| < 0.05 | < 0.05 | WELL_CALIBRATED |
| < 0.05 | ≥ 0.10 | **OVERFIT / UNRELIABLE** |
| 0.05–0.15 | 0.05–0.15 | OVERCONFIDENT |
| ≥ 0.15 | ≥ 0.15 | UNDERCONFIDENT |
| < 0.05 | N/A (样本不足) | INSUFFICIENT_DATA |

**关键规则**: 如果 in-sample 很好但 out-of-sample 很差 → **必须判定为 MODEL OVERFIT / UNRELIABLE**，不得输出漂亮的统计数字。

---

## 五、Regime-Specific Validation

### 5.1 为什么需要 Regime-Specific 验证

同一个 Prediction Model 在不同 Regime 下可能有截然不同的表现：

| Regime 维度 | 可能差异 |
|------------|---------|
| RCL | RCL 1-3 时经济简单，趋势预测可能很准；RCL 7-8 时经济复杂，趋势预测可能很差 |
| Room Count | 单房时预测简单；多房时交互复杂 |
| Threat | LOW threat 时预测稳定；HIGH threat 时预测不稳定 |
| Posture | develop 时经济趋势可预测；war 时不可预测 |
| Resource Regime | stable 时预测可靠；inflation/deflation 时不可靠 |
| War Regime | 非战时预测可靠；战时预测不可靠 |

### 5.2 当前代码的 Regime 处理

A6.4 已有 `checkRegimeCompatibility()` 检查 Prediction 生成时的 context 与 Resolution 时的 context 是否匹配。如果不匹配 → REGIME_CHANGED → 不计入 calibratable。

A6.5 已有 `computeRegimeFit()` 和 `getRegimeSampleCount()` 按 contextSignature 过滤。

**但**: 全局 ECE 仍然混合了不同 Regime 的 Resolution（只要 context 匹配就行）。没有按 Regime 分组统计 accuracy。

### 5.3 设计: Regime-Grouped Accuracy

```
按 Regime 维度分组统计:
  RCL 1-3:  accuracy = 0.85, samples = 45
  RCL 4-6:  accuracy = 0.72, samples = 38
  RCL 7-8:  accuracy = 0.51, samples = 22

全局平均值: 0.71 ← 掩盖了 RCL 7-8 的差表现
```

**规则**: 必须输出 Regime-specific accuracy，不能用全局平均值掩盖。

---

## 六、Survivorship Bias 审计

### 6.1 风险描述

Survivorship bias: 只统计了"成功生成 Prediction 且被 Resolution"的数据，忽略了"因为数据不足没有生成 Prediction"或"因为 INSUFFICIENT_OBSERVATION 没有 Resolution"的情况。

### 6.2 当前代码分析

- `predictEnergyShortage()` 在样本 < 3 时返回 `INSUFFICIENT_DATA`——这些"没有预测"的情况不会被统计
- `resolvePrediction()` 在观测不足时返回 `INSUFFICIENT_OBSERVATION`——这些"没有解析"的情况不进入 ECE 计算
- `isCalibratable()` 排除了 REGIME_CHANGED / EXTERNAL_INTERFERENCE / INSUFFICIENT_OBSERVATION

**结果**: ECE 只统计了"有足够数据、Regime 没变、没有外部干扰"的"好情况"——这会高估模型的实际表现。

### 6.3 缓解设计

引入 **Coverage Metric**：
```
Coverage = calibratableCount / (calibratableCount + regimeChangedCount + 
  externalInterferenceCount + insufficientObservationCount + 
  insufficientDataCount_from_Prediction)
```

如果 Coverage < 0.5 → 说明模型只在不到一半的情况下能产出有效预测 → Reliability 应该降级。

---

## 七、模型生命周期

### 7.1 生命周期状态

```
ACTIVE → DEGRADED → UNRELIABLE → RETIRED

判定规则:
  ACTIVE:    out-of-sample ECE < 0.10, coverage > 0.6, samples ≥ 100
  DEGRADED:  out-of-sample ECE ∈ [0.10, 0.20], 或 coverage ∈ [0.3, 0.6]
  UNRELIABLE: out-of-sample ECE ≥ 0.20, 或 coverage < 0.3, 或 drift detected 且未恢复
  RETIRED:   连续 50000 tick 处于 UNRELIABLE
```

### 7.2 约束

这些状态**只能影响 Intelligence 对模型的评价**（如 Reliability Assessment 中标注 model lifecycle status）。**不能自动修改 Runtime Strategy**。

---

## 八、反事实测试场景

以下 20 个场景用于验证 A6 的有效性。每个场景描述一个特定条件，以及期望的系统行为。

### 场景列表

| # | 场景 | 描述 | 期望行为 |
|---|------|------|---------|
| 1 | In-sample 很好 / Out-of-sample 很差 | 模型在训练集上 ECE=0.02，但在 holdout 上 ECE=0.25 | 判定 OVERFIT / UNRELIABLE，不得输出 0.02 |
| 2 | In-sample 很差 / Out-of-sample 很好 | 训练集 ECE=0.20，但 holdout ECE=0.03 | 判定 UNDERCONFIDENT，不降级 |
| 3 | 高 confidence / 实际错误 | Prediction confidence=0.9，但实际 INCORRECT | 计入 FALSE_POSITIVE，拉高该桶的 calibrationError |
| 4 | 低 confidence / 实际正确 | Prediction confidence=0.1，但实际 CORRECT | 计入该桶，拉低 calibrationError |
| 5 | Regime change | 预测时 posture=develop，解析时 posture=war | 判定 REGIME_CHANGED，不计入 calibratable |
| 6 | Data leakage | Prediction 在生成时读到了未来数据 | 系统应检测到时间戳不匹配并标记 INVALID |
| 7 | Temporal leakage | Calibration 读到了 Prediction 窗口外的数据 | 时间窗口过滤应阻止，否则标记 INVALID |
| 8 | Future information accidentally consumed | Evaluation 使用了评估窗口后的 Experience | EvaluationWindow 应阻止，否则标记 INVALID |
| 9 | Self-evidence loop | A6 的输出被重新作为 A6 的 Evidence | Raw Observation vs Derived Intelligence 分层应阻止 |
| 10 | Sample starvation | 某模型只有 5 个 Resolution | 输出 INSUFFICIENT_SAMPLE，不输出 ECE |
| 11 | Rare event | 1000 tick 中只有 2 次 hostile arrival | 该目标 Prediction 输出 INSUFFICIENT_DATA |
| 12 | False positive explosion | 模型大量产出 FALSE_POSITIVE | FPR > 0.5 → 判定 UNRELIABLE |
| 13 | False negative explosion | 模型大量产出 FALSE_NEGATIVE | FNR > 0.5 → 判定 UNRELIABLE |
| 14 | Recommendation stale | TTL 过期前没有被 supersede | stale recommendation rate 统计 |
| 15 | Prediction expired | Prediction 窗口结束后没有被 Resolution | 标记 expired，不进入 Calibration |
| 16 | Calibration lag | Profile 更新延迟（CALIBRATION_PROFILE_INTERVAL=5000） | Profile 标记 STALE |
| 17 | Model drift | recent ECE 显著高于 overall ECE | detectCalibrationDrift 标记 DEGRADING |
| 18 | Model degradation | 连续 UNRELIABLE | 标记 RETIRED |
| 19 | A6 completely stopped | 所有 A6 系统停止运行 | 帝国照常安全运行（安全不变式） |
| 20 | A5 completely unaffected | A6 的任何行为不影响 A5 执行系统 | 无 A6 缓存被任何执行系统读取 |

### 场景验证矩阵

每个场景需要验证：
1. 系统是否正确识别了场景条件？
2. 系统是否产生了正确的输出？
3. 系统是否没有产生错误的副作用？
4. 系统是否保持了 Shadow-Only 约束？

---

## 九、总结

A6 当前具备**基础验证能力**（ECE, Brier Score, drift detection），但缺乏**长期有效性验证能力**：

1. ❌ 没有 Out-of-Sample 验证
2. ❌ 没有 Temporal Holdout 严格隔离
3. ❌ 没有 Longitudinal Tracking（Recommendation 结果跟踪）
4. ❌ 没有 Regime-Specific Accuracy 独立统计
5. ❌ 没有 Survivorship Bias 修正
6. ⚠️ 有 Confidence 自证强化链（低风险，需监控）

这些缺口不影响当前帝国的安全运行（A6 是 Shadow-Only），但如果未来要让 A6 的输出被消费，必须先建立这些验证机制。
