# A6.4 Prediction Calibration & Resolution — 最终审计报告

> **审计日期**: 2026-08-26  
> **审计范围**: A6.4 全部代码 + 测试 + 调用链  
> **审计结论**: ✅ 通过 — 质量门槛全绿，架构合规，调用链完整

---

## 一、审计摘要

| 维度 | 结论 | 备注 |
|------|------|------|
| typecheck | ✅ 通过 | `npm run typecheck` 全绿 |
| 单元测试 | ✅ 通过 | 29 个测试（C1-C12 + Ring Buffer + Engine + Guards + Determinism） |
| 全量测试 | ✅ 通过 | 312 文件 4650 测试全通过 |
| build | ✅ 通过 | `npm run build` 成功 |
| Shadow-Only (CAL-001) | ✅ 合规 | 唯一写者 `__calibrationCache` |
| Domain Purity (CAL-002) | ✅ 合规 | Domain 函数不引用 Game/Memory |
| 确定性 (CAL-005) | ✅ 合规 | 100× replay 测试通过，hash 一致 |
| 有界内存 (CAL-006) | ✅ 合规 | Ring Buffer 固定容量 500，profiles ≤10 |
| 调用链完整性 | ✅ 修复 | 修复了预测 status 过滤导致无法解析的 bug |

---

## 二、代码清单

### Domain 层（纯函数，不引用 Game/Memory）

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/domain/intelligence/calibration/types.ts` | 类型定义 + 常量 + 工具函数 | ~420 |
| `src/domain/intelligence/calibration/resolve.ts` | Resolution Engine — 解析预测 | ~530 |
| `src/domain/intelligence/calibration/calibration.ts` | 置信度校准引擎（ECE/Brier/Buckets） | ~550 |
| `src/domain/intelligence/calibration/metrics.ts` | Resolution Metric Registry | ~280 |
| `src/domain/intelligence/calibration/ring-buffer.ts` | 有界环形缓冲 + GC | ~345 |
| `src/domain/intelligence/calibration/guards.ts` | CAL-001~CAL-010 架构守卫 | ~385 |
| `src/domain/intelligence/calibration/index.ts` | 统一出口 | ~135 |

### System 层（薄壳）

| 文件 | 职责 |
|------|------|
| `src/systems/intelligence/calibration-resolution-system.ts` | 数据采集 + 调用 Domain + 写缓存 + GC |

### 测试

| 文件 | 覆盖 |
|------|------|
| `tests/unit/calibration/calibration.test.ts` | C1-C12 + Ring Buffer + Engine + Guards + Determinism（29 tests） |

---

## 三、PHASE 9: 反事实场景测试（C1-C12）

### 测试结果

| 场景 | 描述 | 预期 | 结果 |
|------|------|------|------|
| C1 | 预测匹配实际 → CORRECT | `CORRECT` | ✅ |
| C2 | 预测未发生 → not CORRECT | 非CORRECT | ✅ |
| C3 | 方向错误 → INCORRECT/FALSE_POSITIVE | INCORRECT | ✅ |
| C4 | 事件在 Horizon 内 | withinHorizon=true | ✅ |
| C5 | 事件在 Horizon 外 | withinHorizon=false | ✅ |
| C6 | Regime 变化 → REGIME_CHANGED | REGIME_CHANGED | ✅ |
| C7 | 外部干扰 → EXTERNAL_INTERFERENCE | EXTERNAL_INTERFERENCE | ✅ |
| C8 | 数据不足 → INSUFFICIENT_OBSERVATION | INSUFFICIENT_OBSERVATION | ✅ |
| C9 | 间隔过大 → INSUFFICIENT_OBSERVATION | INSUFFICIENT_OBSERVATION | ✅ |
| C10 | 过度自信模型 | bucket[8] 全部失败 | ✅ |
| C11 | 低自信模型 | CORRECT | ✅ |
| C12 | 确定性回放 100× | deterministic=true | ✅ |

### 修复的测试问题

1. **C1/C11 PARTIAL→CORRECT**: 观测值偏差过大导致相对误差落在 0.2-0.5 区间（PARTIAL）。调整为观测值更接近预测值。
2. **C10 bucket 索引错误**: `confidence=0.8` → `floor(0.8×10)=8`，应为 bucket[8] 而非 bucket[7]。修正测试期望。
3. **GC 测试缺少 import**: `RESOLUTION_MAX_AGE` 未从 index 导入。补充导入。
4. **confidence buckets 测试**: 同样的 bucket 索引问题。修正期望从 bucket[7] → bucket[8]。

---

## 四、PHASE 10: CPU / Memory / Determinism 审计

### 4.1 CPU 审计

| 组件 | 执行频率 | 复杂度 | 评估 |
|------|----------|--------|------|
| `calibrationResolutionSystem.run` | 每 500t | O(n×m) | n≤500 predictions, m≤100 → ~50K ops/500t ≈ 100 ops/t ✅ |
| `resolvePrediction` | 每次 run ≤ n | O(obs.length) | obs 通常 ≤30 ✅ |
| `computeConfidenceBuckets` | 每次 run + profile | O(n log n) | n≤500 → ~4500 比较 ✅ |
| `computeCalibrationStatistics` | 每 5000t | O(n×m) | 低频，可接受 ✅ |
| `gcCalibrationBuffer` | 每 500t | O(capacity) | 固定 500 次 ✅ |
| `validateCalibrationBuffer` | 每 5000t | O(n) | 低频 ✅ |

**结论**: CPU 消耗在可接受范围内。P3 post 阶段 500t 间隔，不进入 tick 关键路径。

### 4.2 Memory 审计

| 存储项 | 有界性 | 评估 |
|--------|--------|------|
| `resolutionRecords` | 固定容量 500，环形覆盖 | ✅ |
| `resolvedPredictionIds` | Set, 上限 capacity×3=1500 | ✅ CAL-006 守卫检查 |
| `profiles` Map | 上限 10 (MAX_PROFILES) | ✅ CAL-006 守卫检查 |
| `failureStats` Map | 无硬上限 | ⚠️ 低风险 — modelKey 种类有限（目前 2 种），不会无界增长 |
| 存储 heap only | global reset 可丢 | ✅ 符合 Shadow-Only |

### 4.3 Determinism 审计

| 检查项 | 结果 |
|--------|------|
| `stableStringify` 按 key 排序 | ✅ |
| `fnv1a32Hex` 纯位运算 | ✅ |
| `resolvePrediction` 无 Math.random/Date.now | ✅ |
| 所有浮点 `toFixed(3)` 截断 | ✅ |
| `computeConfidenceBuckets` 按 predictionId 排序 | ✅ |
| `computeCalibrationStatistics` modelKey 字母序 | ✅ |
| C12 确定性回放 100× | ✅ 全通过 |

---

## 五、PHASE 11: 完整调用链审计

### 5.1 调用链

```
predictionSystem (P3, 500t, post)
  → A6.3 domain: predictEnergyShortage / predictSpawnStarvation
  → pushPrediction → globalCache.__predictionCache.ringBuffer
  → expireOverduePredictions (endTick < currentTick → expired)
  → gcPredictionBuffer

calibrationResolutionSystem (P3, 500t, post)
  → collectAllPredictions(__predictionCache.ringBuffer) [不限 status]
  → getPendingResolutionIds (endTick + grace ≤ tick, 未解析)
  → for each pending prediction:
    → buildObservations (从 __reserveHistory / __spawnQueueDepthHistory)
    → buildCurrentContext (empireHealth + Memory.kernel.strategy.posture)
    → buildExternalFactors (prediction.evidence + __experienceCache + __evaluationCache)
    → resolvePrediction (A6.4 domain 纯函数)
    → pushResolution(CalibrationRingBuffer)
  → 每 5000t: computeCalibrationStatistics → updateProfile
  → 每 500t: gcCalibrationBuffer
  → 每 5000t: validateCalibrationBuffer + calibrationBufferStats
```

### 5.2 发现并修复的 Bug

**Bug: `allActivePredictions` 过滤导致预测无法解析**

- **问题**: 原系统层使用 `allActivePredictions()` 只返回 `status === "active"` 的预测。但 A6.3 的 `predictionSystem` 会在每次运行时调用 `expireOverduePredictions()`，将 `endTick < currentTick` 的预测标记为 `expired`。而 calibration 需要等到 `endTick + RESOLUTION_GRACE_PERIOD(100)` 才解析。这导致所有预测在 grace period 内被标记为 expired，calibration 永远找不到它们。
- **修复**: 将 `allActivePredictions` 替换为 `collectAllPredictions`（内部函数，不限 status），确保 calibration 能访问到 expired 预测。
- **影响**: 修复前 calibration 系统永远无法解析任何预测；修复后正常工作。

### 5.3 其他调用链检查

| 检查项 | 结果 |
|--------|------|
| `resolvePrediction` 从 A6.4 导入（非 A6.3 同名函数） | ✅ |
| 只写 `__calibrationCache` (CAL-001) | ✅ |
| 不修改 Prediction 对象 (CAL-004) | ✅ |
| 不调用 spawnCreep/createConstructionSite (CAL-009) | ✅ |
| 不新建采样通道 (CAL-007) | ✅ |
| bootstrap.ts 正确注册 | ✅ P3 post 阶段，500t 间隔 |
| `__calibrationCache` 在 global-cache.ts 声明 | ✅ |

---

## 六、架构守卫合规性

| 守卫 | 描述 | 状态 |
|------|------|------|
| CAL-001 | Shadow-Only: 只写 `__calibrationCache` | ✅ |
| CAL-002 | Domain Purity: 不引用 Game/Memory | ✅ |
| CAL-003 | No Game API: Domain 层不调 Game API | ✅ |
| CAL-004 | No Runtime Mutation: 不修改运行时状态 | ✅ |
| CAL-005 | Deterministic: 相同输入→相同输出 | ✅ |
| CAL-006 | Bounded Memory: Ring Buffer 有界 | ✅ |
| CAL-007 | No New Sampler: 不新建采样通道 | ✅ |
| CAL-008 | No Second Metrics: 不建第二套指标 | ✅ |
| CAL-009 | No Strategy Mutation: 不修改 Strategy | ✅ |
| CAL-010 | Evidence Traceability: 可追溯 | ✅ |

---

## 七、已知限制与建议

1. **`failureStats` Map 无硬上限** — 低风险。modelKey 由 `target-method-modelVersion` 组成，模型种类有限（当前 2 种），不会无界增长。建议在 CAL-006 守卫中增加 `failureStats.size` 检查。

2. **`computeCalibrationProfile` 的 `modelKey.split("-")`** — 当 target 或 method 包含 `-` 时，`split` 产生多于 3 段，但只取前 3 段作为 `target`/`method`/`modelVersion`。这不影响 hash 计算（hash 基于 modelKey 字符串本身），但展示值可能不准确。建议使用 `makeModelKey` 的逆运算或保留原始值。

3. **`buildExternalFactors` 遍历 Experience/Evaluation Ring Buffer** — 当前实现遍历全部 records，不做时间窗口过滤。在 ring buffer 容量较大时（200 条），每次解析都遍历可能产生不必要的 CPU。建议在解析阶段缓存 external factors（同 tick 内复用）。

---

## 八、质量门槛

```
npm run typecheck  ✅
npm test            ✅ (312 files, 4650 tests)
npm run build       ✅
```

---

## 九、结论

A6.4 Prediction Calibration & Resolution 模块已完成实施，通过全部审计维度：

- **C1-C12 反事实场景**全部覆盖并通过
- **CPU/Memory/Determinism** 审计通过，低频 P3 post 阶段不进入关键路径
- **调用链审计**发现并修复了关键 bug（预测 status 过滤导致无法解析）
- **CAL-001~CAL-010** 架构守卫全部合规
- **质量门槛**全绿

模块可以投入运行。
