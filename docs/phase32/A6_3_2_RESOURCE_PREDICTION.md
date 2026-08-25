# A6.3.2 — Resource Prediction Models

> **阶段**: A6.3.2 Implementation
> **日期**: 2026-08-26
> **状态**: ✅ 已完成
> **前置**: A6.3.1 基础设施（TimeSeries、Context、Types、RingBuffer、Hashing、Guards）
> **范围**: Energy Shortage 预测模型 + Spawn Starvation 预测模型 + Evidence Builder + Lifecycle Resolution

---

## 一、实现清单

### 1.1 新增源文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/domain/intelligence/prediction/evidence-builder.ts` | 预测证据链构建（PRED-006） | 213 |
| `src/domain/intelligence/prediction/resolve.ts` | 预测应验/失效判定（PRED-008） | 240 |
| `src/domain/intelligence/prediction/energy-shortage.ts` | 能量短缺预测模型 | 691 |
| `src/domain/intelligence/prediction/spawn-starvation.ts` | 孵化饥饿预测模型 | 820 |

### 1.2 修改源文件

| 文件 | 变更 |
|------|------|
| `src/domain/intelligence/prediction/index.ts` | 导出 A6.3.2 全部新增 API |

### 1.3 新增测试文件

| 文件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| `tests/unit/intelligence/a6-3-2-energy-shortage.test.ts` | 22 | ENERGY-001~015 + AG-E-001~011 + PRED Guard |
| `tests/unit/intelligence/a6-3-2-spawn-starvation.test.ts` | 24 | SPAWN-001~015 + DIST-001~005 + AG-S-001~011 + PRED Guard |
| `tests/unit/intelligence/a6-3-2-prediction-replay.test.ts` | 22 | 20 scenarios × 1000 replay + 总体确定性 |
| `tests/unit/intelligence/a6-3-2-prediction-integration.test.ts` | 16 | 调用链 + 禁止路径 + CPU + Memory + RingBuffer + Batch |

**总测试数**: 84 项全绿。

---

## 二、模型架构

### 2.1 Energy Shortage Prediction

**目标**: 预测能量储备何时降至短缺阈值以下。

**方法**: `trend-extrapolation`

**算法流程**:

```
输入: netFlowHistory + reserveHistory + currentReserve + shortageThreshold
  │
  ├─ 1. 数据充分性检查（< 3 样本 → INSUFFICIENT_DATA）
  │
  ├─ 2. 对 netFlowHistory 做线性回归 → slope, intercept, r²
  │     对 reserveHistory 做线性回归 → slope, intercept, r²
  │
  ├─ 3. 推导趋势方向（up / down / flat）
  │
  ├─ 4. 估计 shortage tick
  │     reserve(t) = slope * t + intercept
  │     求解 reserve(t) = shortageThreshold → t
  │
  ├─ 5. 计算严重程度 (0-1)
  │     当前已短缺 → 0.5-1.0
  │     200 tick 内 → 0.5-0.8
  │     200-1000 tick → 0.2-0.5
  │     1000+ tick → 0.1
  │
  ├─ 6. 确定 5 种状态
  │     STABLE / IMPROVING / DEGRADING / SHORTAGE_IMMINENT / SHORTAGE_PREDICTED
  │
  ├─ 7. 计算 confidence
  │     sampleFactor × r2Factor × externalFactor
  │     样本 < 10 → ≤ 0.3
  │     样本 ≥ 10 → 0.3-1.0
  │     R² 越高越高
  │     外部注入降低 30%
  │
  ├─ 8. Regime compatibility 调整
  │     完全匹配 → ×1.0
  │     1-2 维度不匹配 → ×0.5
  │     ≥3 维度不匹配 → ×0.3
  │
  └─ 9. 构建 Prediction + Evidence
```

**关键常量**:

| 常量 | 值 | 说明 |
|------|----|------|
| `ENERGY_SHORTAGE_MODEL_VERSION` | 1 | 模型版本 |
| `DEFAULT_ENERGY_HORIZON` | 1000 | 默认预测窗口 |
| `SHORTAGE_IMMINENT_TICKS` | 200 | 紧迫阈值 |
| `ENERGY_MIN_SAMPLES` | 3 | 最小样本数 |
| `ENERGY_SUFFICIENT_SAMPLES` | 10 | 充分样本数 |
| `NET_FLOW_TREND_THRESHOLD` | 0.001 | 净流趋势阈值 |
| `RESERVE_TREND_THRESHOLD` | 0.01 | 储备趋势阈值 |

### 2.2 Spawn Starvation Prediction

**目标**: 预测孵化系统何时无法满足人口补充需求。

**方法**: `threshold-projection` + `trend-extrapolation`

**算法流程**:

```
输入: queueDepthHistory + populationHistory + currentEnergy + spawnCapacity
  │
  ├─ 1. 数据充分性检查（< 3 样本 → INSUFFICIENT_DATA）
  │
  ├─ 2. 对 queueDepthHistory 做线性回归 → 趋势
  │     对 populationHistory 做线性回归 → 趋势
  │
  ├─ 3. 计算三维因子
  │     energyAvailability = currentEnergy / minSpawnEnergy (0-1)
  │     capacityUtilization = currentPopulation / spawnCapacity (0-1+)
  │     demandPressure = max(queueDepth/10, p0Count/3) (0-1)
  │
  ├─ 4. 估计 starvation tick
  │     队列增长 → 外推何时达到 spawnCapacity × 2
  │     人口下降 → 外推何时归零
  │     当前已饥饿（能量不足 + 队列>0）→ currentTick
  │
  ├─ 5. 确定 5 种状态（必须区分）
  │     NO_DEMAND — 队列空、人口稳定
  │     ENERGY_LIMITED — 有需求但能量不足
  │     CAPACITY_LIMITED — 有能量但容量不足
  │     QUEUE_GROWING — 队列持续上升
  │     STARVATION_IMMINENT — 饥饿即将/已经发生
  │
  ├─ 6. 计算 confidence + Regime 调整
  │
  └─ 7. 构建 Prediction + Evidence
```

**关键常量**:

| 常量 | 值 | 说明 |
|------|----|------|
| `SPAWN_STARVATION_MODEL_VERSION` | 1 | 模型版本 |
| `DEFAULT_SPAWN_HORIZON` | 1000 | 默认预测窗口 |
| `STARVATION_IMMINENT_TICKS` | 300 | 紧迫阈值 |
| `SPAWN_MIN_SAMPLES` | 3 | 最小样本数 |
| `SPAWN_SUFFICIENT_SAMPLES` | 10 | 充分样本数 |
| `QUEUE_GROWING_SLOPE_THRESHOLD` | 0.01 | 队列增长判定阈值 |

---

## 三、Evidence Builder

### 3.1 数据源引用格式

| 类型 | 格式 | 示例 |
|------|------|------|
| TimeSeries | `{name}:{oldest}-{newest}({count})` | `netFlowHistory:100000-100900(10)` |
| Experience | `exp:{id}:{tick}` | `exp:exp-12345:100500` |
| Metric | `metric:{name}:{value}` | `metric:currentReserve:5000.000` |

### 3.2 确定性保证

- `sources` 数组按字典序排序
- `modelParams` 的 key 按字典序排序
- 数值用 `toFixed(6)` 截断
- `mismatchedDimensions` 排序

### 3.3 追溯与验证

- `tracePredictionEvidence()`: 返回来源分类计数 + 完整性分数
- `validatePredictionEvidence()`: 验证 sources/modelParams/sampleRange/regimeCompatibility 非空

---

## 四、Lifecycle Resolution

### 4.1 应验判定规则

| 条件 | 结果 | 说明 |
|------|------|------|
| 窗口到期 + 偏差 < 20% | `fulfilled` | 预测准确 |
| 窗口到期 + 偏差 20%-100% | `expired` | 预测方向对但数值不准 |
| 窗口到期 + 偏差 ≥ 100% | `invalidated` | 预测被推翻 |
| 窗口内 + 偏差 ≥ 100% | `invalidated` | 新数据推翻预测 |
| 窗口内 + 偏差 < 100% | 保持 `active` | 预测仍有效 |

### 4.2 批量解析

- `batchResolvePredictions()`: 按 id 排序后逐条验证，返回 fulfilled/expired/invalidated/active 计数和应验率。

---

## 五、PRED-XXX 合规矩阵

| 守卫 | 状态 | 实现方式 |
|------|------|----------|
| PRED-001 Shadow-Only | ✅ | 纯函数，不引用 Game/Memory/CPU |
| PRED-002 不进 tick | ✅ | 由系统层 P3 cadence 调用（未实现，A6.3.3 范围） |
| PRED-003 确定性 | ✅ | 1000×replay hash 一致；排序 + toFixed |
| PRED-004 Horizon | ✅ | duration 50-5000 tick，guardHorizon 验证 |
| PRED-005 Confidence | ✅ | <3 样本 → INSUFFICIENT_DATA；<10 → ≤0.3 |
| PRED-006 Evidence | ✅ | sources + modelParams + sampleRange + regime |
| PRED-007 Regime | ✅ | ContextSignature + 5 维度兼容性检查 |
| PRED-008 Lifecycle | ✅ | active → fulfilled/expired/invalidated |
| PRED-009 不出 Recommendation | ✅ | Prediction 无 recommendation/action/directive 属性 |
| PRED-010 不自建采样 | ✅ | 只消费输入 TimeSeries，不创建采样通道 |

---

## 六、测试覆盖

### 6.1 Energy Shortage 测试矩阵

| 测试 ID | 场景 | 验证点 |
|---------|------|--------|
| ENERGY-001 | 稳定趋势 | STABLE 状态 + confidence > 0 |
| ENERGY-002 | 上升趋势 | IMPROVING/STABLE |
| ENERGY-003 | 下降趋势 | DEGRADING/SHORTAGE_PREDICTED |
| ENERGY-004 | 小波动稳定 | STABLE |
| ENERGY-005 | 数据不足 | INSUFFICIENT_DATA |
| ENERGY-006 | 边界值 | SHORTAGE_PREDICTED + severity ≥ 0.5 |
| ENERGY-007 | 极端值(0) | SHORTAGE_PREDICTED + severity ≥ 0.5 |
| ENERGY-008 | Regime 兼容 | confidenceMultiplier = 1.0 |
| ENERGY-009 | Regime 不兼容 | confidenceMultiplier < 1.0 |
| ENERGY-010 | 外部注入 | confidence 降低 |
| ENERGY-011 | 1000 replay | hash 一致 |
| ENERGY-012 | Evidence 完整 | sources + modelParams + trace + validate |
| ENERGY-013 | Horizon | 50 ≤ duration ≤ 5000 |
| ENERGY-014 | Lifecycle | active → fulfilled/expired |
| ENERGY-015 | SHORTAGE_IMMINENT | 下降趋势 + severity > 0 |
| AG-E-001~011 | 架构守卫 | 无 Game API + 纯函数 + validatePrediction |

### 6.2 Spawn Starvation 测试矩阵

| 测试 ID | 场景 | 验证点 |
|---------|------|--------|
| SPAWN-001 | 无需求 | NO_DEMAND |
| SPAWN-002 | 人口增长 | NO_DEMAND/QUEUE_GROWING |
| SPAWN-003 | 队列增长+人口下降 | ENERGY_LIMITED/STARVATION_IMMINENT |
| SPAWN-004 | 稳定 | NO_DEMAND/QUEUE_GROWING |
| SPAWN-005 | 数据不足 | INSUFFICIENT_DATA |
| SPAWN-006 | 边界值(0) | NO_DEMAND |
| SPAWN-007 | 极端值(100,0) | STARVATION_IMMINENT/ENERGY_LIMITED |
| SPAWN-008 | Regime 兼容 | confidenceMultiplier = 1.0 |
| SPAWN-009 | Regime 不兼容 | confidenceMultiplier < 1.0 |
| SPAWN-010 | P0 请求 | demandPressure 增加 |
| SPAWN-011 | 1000 replay | hash 一致 |
| SPAWN-012 | Evidence 完整 | sources + trace + validate |
| SPAWN-013 | Horizon | 50 ≤ duration ≤ 5000 |
| SPAWN-014 | Lifecycle | active → fulfilled/expired |
| SPAWN-015 | STARVATION_IMMINENT | severity > 0 |
| DIST-001~005 | 区分测试 | NO_DEMAND / ENERGY_LIMITED / CAPACITY_LIMITED / QUEUE_GROWING / STARVATION_IMMINENT |
| AG-S-001~011 | 架构守卫 | 无 Game API + 纯函数 + validatePrediction |

### 6.3 Replay 测试

- **20 个场景** × **1000 次 replay** = **20,000 次预测**
- 每次验证: hash + confidence + horizon + status + value 全一致
- 总体确定性验证: `verifyPredictionDeterminism` 全绿

### 6.4 集成测试

| 类别 | 测试项 | 验证点 |
|------|--------|--------|
| 调用链 | TimeSeries → Input → Model → validate → RingBuffer → Query | 全链通 |
| 调用链 | 多模型共存 RingBuffer | energy + spawn 共存 |
| 调用链 | lifecycle: push → resolve → expire → gc | 全生命周期 |
| 禁止路径 | 不进入 Strategy/Spawn/Logistics/Military/Recovery | 无相关属性 |
| 禁止路径 | status 只允许 4 种 | active/fulfilled/expired/invalidated |
| CPU | 单次 < 5ms | ✅ |
| CPU | 100 次 < 50ms | ✅ |
| Memory | 无 Game Object retention | JSON 无 Game/RoomObject/Creep |
| Memory | 无 Path retention | JSON 无 path/PathFinder |
| Memory | 无 Runtime Snapshot | sources < 50, modelParams < 20 |
| Memory | RingBuffer 有界 | ≤ 50 条 |
| Guard | validateRingBuffer | 0 violations |
| Stats | predictionStats | 正确分布 |
| Batch | batchResolvePredictions | 正确应验率 |
| Shutdown | 纯函数无副作用 | 输入不变 |
| Shutdown | 可序列化 | JSON.stringify 不抛 |

---

## 七、质量门槛

| 检查项 | 结果 |
|--------|------|
| `npm run typecheck` | ✅ 通过 |
| `npm test` | ✅ 4593/4594 通过（1 pre-existing flake: A5.4.4 CPU benchmark） |
| `npm run build` | ✅ 通过 |

---

## 八、API 出口

```typescript
// Energy Shortage
export type { EnergyShortageStatus, EnergyShortageInput };
export {
  ENERGY_SHORTAGE_MODEL_VERSION,
  DEFAULT_ENERGY_HORIZON,
  SHORTAGE_IMMINENT_TICKS,
  ENERGY_MIN_SAMPLES,
  ENERGY_SUFFICIENT_SAMPLES,
  predictEnergyShortage,
  analyzeEnergyShortage,
};

// Spawn Starvation
export type { SpawnStarvationStatus, SpawnStarvationInput };
export {
  SPAWN_STARVATION_MODEL_VERSION,
  DEFAULT_SPAWN_HORIZON,
  STARVATION_IMMINENT_TICKS,
  SPAWN_MIN_SAMPLES,
  SPAWN_SUFFICIENT_SAMPLES,
  predictSpawnStarvation,
  analyzeSpawnStarvation,
};

// Evidence Builder
export type { EvidenceBuilderInput, EvidenceTraceResult };
export {
  timeSeriesSourceRef,
  experienceSourceRef,
  metricSourceRef,
  buildPredictionEvidence as buildPredictionEvidenceFromInput,
  tracePredictionEvidence,
  validatePredictionEvidence,
};

// Lifecycle Resolution
export type {
  PredictionResolution,
  PredictionVerificationInput,
  PredictionVerificationResult,
  BatchResolutionResult,
};
export {
  FULFILLMENT_DEVIATION_THRESHOLD,
  INVALIDATION_DEVIATION_THRESHOLD,
  verifyPrediction,
  resolvePredictionStatus,
  batchResolvePredictions,
};
```

---

## 九、后续衔接

| 后续 | 说明 |
|------|------|
| A6.3.3 | 系统层适配器：从 globalCache 采集数据 → 构建 Input → 调用模型 → 写入 RingBuffer |
| A6.4+ | 更多预测目标（logistics-bottleneck, room-collapse, hostile-arrival...） |
| A6.6 | Recommendation Engine 消费 Prediction 产出建议 |
