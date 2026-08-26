# A6 Temporal Holdout Design

> **阶段**: A6 Longitudinal Effectiveness Research
> **日期**: 2026-08-26
> **约束**: 纯研究，不写实现代码

---

## 一、目标

设计严格的时间隔离机制，确保：

1. **Prediction 生成时不能看到 Future Outcome**
2. **Calibration 只能使用 prediction horizon 结束后的数据**
3. **Evaluation 不得消费未来数据**
4. **Recommendation 不得消费未来数据**

---

## 二、当前时间隔离审计

### 2.1 Prediction 生成时的数据隔离

**代码路径**: `prediction-system.ts` → 从 `globalCache` 读取 TimeSeries → 调用 `predictEnergyShortage()`

**时间线**:
```
Tick T-1000: empire-health-system 写入 __reserveHistory[0]
Tick T-900:  empire-health-system 写入 __reserveHistory[1]
...
Tick T-100:  empire-health-system 写入 __reserveHistory[9]
Tick T:      prediction-system 读取 __reserveHistory[0..9]
             → 生成 Prediction { window: { startTick: T, endTick: T+1000 } }
```

**合规性**: ✅ Prediction 在 tick T 生成时，`__reserveHistory` 只包含 T 之前的数据。

**风险**: ⚠️ `__reserveHistory` 是共享数组，如果 prediction-system 的执行时机被提前（如 bootstrap.ts 注册顺序变化），可能读到 T 时刻的数据。当前注册顺序（empire-health → prediction）是隐式约束，没有显式的时间戳验证。

**建议**: 在 `predictEnergyShortage()` 的 `EnergyShortageInput` 中增加 `dataCutoffTick` 字段，由 system 层显式传入 `Game.time`，domain 层验证所有 TimeSeries 样本的 tick < dataCutoffTick。

### 2.2 Calibration 解析时的时间隔离

**代码路径**: `calibration-resolution-system.ts` → `buildObservations()` → 从 `globalCache.__reserveHistory` 读取

**时间线**:
```
Tick T:        Prediction 生成 { window: { startTick: T, endTick: T+1000 } }
Tick T+1000:   Prediction 窗口结束
Tick T+1100:   Calibration System 运行（grace period = 100）
               buildObservations() 从 __reserveHistory 读取
               过滤: tick >= startTick && tick <= endTick
```

**合规性**: ⚠️ 部分合规

**问题 1**: `buildObservations()` 读取的 `__reserveHistory` 在 tick T+1100 时已经包含了 T+1100 之前所有 tick 的数据。虽然通过 `prediction.window.startTick` 和 `prediction.window.endTick` 过滤了窗口外的数据，但如果 `__reserveHistory` 的 baseTick 计算有误，会导致错误的时间关联。

**问题 2**: `__reserveHistory` 是一个 `number[]`（纯值数组），没有携带 tick 信息。`buildObservations()` 使用 `baseTick = endTick - (len - 1) * 100` 反推 tick——如果数组长度在 Prediction 生成后增加了（新数据被 push），baseTick 会偏移，导致旧数据被关联到错误的 tick。

**具体示例**:
```
Tick T:   Prediction 生成。此时 __reserveHistory.length = 10
          baseTick = (T+1000) - 9*100 = T+100
          samples: [T+100, T+200, ..., T+1000]

Tick T+1100: Calibration 运行。此时 __reserveHistory.length = 21
          baseTick = (T+1100+1000) - 20*100 = T+100  ← 看似正确
          但实际数据: [T-1000, T-900, ..., T+1000]
          过滤 tick ∈ [T, T+1000] 只取后 10 个 ← 正确

          但如果 __reserveHistory 是 Ring Buffer 且覆盖了旧数据:
          [T+100, T+200, ..., T+1100] (21 个，覆盖了 T-1000 ~ T 的数据)
          baseTick = (T+1100+1000) - 20*100 = T+100
          samples: baseTick + i*100 = [T+100, T+200, ..., T+2100]
          过滤 tick ∈ [T, T+1000] 取 [T+100, ..., T+1000] ← 正确

          但如果采样间隔不是精确 100 tick:
          [T+50, T+150, ..., T+1050]
          baseTick 计算错误 → tick 关联错误 → temporal leakage!
```

**结论**: 当前 `__reserveHistory` 作为 `number[]` 存储，缺乏精确的 tick 关联——存在 temporal leakage 风险。

### 2.3 Evaluation 的时间隔离

**代码路径**: `strategy-evaluation-system.ts` → 使用 `EvaluationWindow` 限制 Experience 采集范围

**合规性**: ✅ 合规

Evaluation 使用 `EvaluationWindow { startTick, endTick }` 明确限制采集范围，只采集 `outcome.measurementTick ≤ endTick` 的 Experience。

### 2.4 Recommendation 的时间隔离

**代码路径**: `recommendation-engine-system.ts` → 从各缓存读取已有数据

**合规性**: ✅ 合规

Recommendation 在 tick T 生成时，所有 Evidence 的 `collectedAt` ≤ T。没有读取未来数据。

---

## 三、Temporal Holdout 设计

### 3.1 核心设计

```
┌──────────────────────────────────────────────────────────────────┐
│                     Prediction Lifecycle                         │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │
│  │  Training     │    │  Prediction  │    │  Holdout     │        │
│  │  Window       │    │  Window      │    │  Window      │        │
│  │              │    │  (Horizon)   │    │              │        │
│  │  T-1000 ~    │    │  T ~         │    │  T+horizon   │        │
│  │  T-100       │    │  T+horizon   │    │  +grace ~    │        │
│  │              │    │              │    │  T+horizon+   │        │
│  │              │    │              │    │  grace+buffer │        │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘        │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│    Training Data       Prediction            Validation           │
│    (历史数据)          (生成预测)            (实际结果)            │
│                                                                  │
│  约束:                                                            │
│  1. Training Window 只包含 T 之前的数据                           │
│  2. Prediction Window 是预测的目标时段                            │
│  3. Holdout Window 在 Prediction Window 结束后开始                │
│  4. Validation 只使用 Holdout Window 的数据                        │
│  5. Training 和 Holdout 不能有交集                                │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 严格时间隔离规则

#### Rule-1: Prediction 生成时的时间截断

```
Prediction 在 tick T 生成时:
  - 输入 TimeSeries 的所有样本 tick 必须 < T
  - 如果任何样本 tick ≥ T → 标记 INVALID_DATA_LEAKAGE
  - Prediction.window.startTick = T
  - Prediction.window.endTick = T + horizon (≤ 5000)
```

**当前代码状态**: ⚠️ 部分合规。TimeSeries 样本可能包含 T 时刻的数据（如果采样系统在 T 之前运行）。

#### Rule-2: Calibration 解析时的时间隔离

```
Calibration 在 tick T + horizon + grace 运行时:
  - ObservationSample 只取 [startTick, endTick] 范围内的数据
  - ObservationSample 的 tick 必须有精确的时间戳关联
  - 如果 ObservationSample 的 tick 超出 [startTick, endTick] → 标记 INVALID_TEMPORAL_LEAKAGE
```

**当前代码状态**: ⚠️ 部分合规。`__reserveHistory` 作为 `number[]` 缺乏精确 tick 关联。

#### Rule-3: Out-of-Sample 验证

```
对于每批 Resolution:
  - 将 Resolution 按时间排序
  - 前 70% 作为训练集 → 计算校准参数
  - 后 30% 作为测试集 → 用训练集的校准参数验证
  - 比较 in-sample ECE vs out-of-sample ECE
```

**当前代码状态**: ❌ 不合规。全部 Resolution 用于计算 ECE，没有 holdout。

### 3.3 实施约束

以上设计为**研究性设计**，不意味着需要立即实现。实施需要：

1. 修改 `__reserveHistory` 从 `number[]` 改为 `{ tick: number; value: number }[]`（但这是 A5 的数据结构变更，需要 frozen contract 修订）
2. 在 `predictEnergyShortage()` 增加时间截断验证
3. 在 `computeCalibrationStatistics()` 增加 train/test split 逻辑

**这些变更涉及 frozen contract 修改，必须走 ADR 流程。**

---

## 四、信息泄漏检测清单

| 检查项 | 描述 | 当前状态 |
|--------|------|---------|
| Tick 关联准确性 | ObservationSample 的 tick 是否准确对应实际采样时间 | ⚠️ `__reserveHistory` 的 baseTick 计算是推算的，不是记录的 |
| 窗口边界严格性 | Prediction 窗口边界是否被严格执行 | ✅ `startTick`/`endTick` 过滤严格执行 |
| Grace Period 充分性 | 100 tick grace period 是否足够等待数据到达 | ⚠️ 如果采样间隔 > 100 tick，grace period 不够 |
| Ring Buffer 覆盖风险 | Ring Buffer 覆盖旧数据是否导致历史数据丢失 | ⚠️ `__reserveHistory` 如果是 Ring Buffer，旧数据可能被覆盖 |
| 跨系统时间同步 | empire-health-system 和 prediction-system 是否在同一 tick 内运行 | ✅ bootstrap.ts 注册顺序保证 |

---

## 五、风险评估

| 风险 | 严重性 | 影响 | 缓解 |
|------|--------|------|------|
| `__reserveHistory` tick 关联错误 | 中等 | Calibration 的 actualValue 可能关联到错误的 tick，导致 ECE 不准确 | 改为 `{ tick, value }[]` 存储 |
| Grace period 不足 | 低 | 如果采样间隔 > 100 tick，Calibration 可能在数据到达前运行 | 增加 grace period 或动态等待 |
| In-sample bias | 中等 | ECE 低估真实校准误差 | 实施 train/test split |
| Ring Buffer 覆盖 | 低 | 如果 Resolution Ring Buffer 容量不足，旧 Resolution 被覆盖 | 当前 500 容量足够 |

---

## 六、结论

当前 A6 的 Temporal Holdout 机制**部分合规**：

- ✅ Prediction 生成时有基础的时间隔离（通过 bootstrap.ts 注册顺序）
- ✅ Calibration 有 grace period 和窗口过滤
- ⚠️ `__reserveHistory` 缺乏精确 tick 关联——存在 temporal leakage 风险
- ❌ 没有 Out-of-Sample 验证——全部数据用于统计和评估

**建议**: 不立即实施修复（涉及 frozen contract），但标记为已知技术债。如果未来要让 A6 输出被消费，必须先解决 temporal leakage 和 in-sample bias 问题。
