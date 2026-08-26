# A6.6 Implementation Readiness Report

> Generated: 2026-08-26
> Method: Code-level audit of A6.1–A6.5, globalCache, bootstrap, Decision Authority

---

## 一、A6.1–A6.5 真实代码结构审计

### A6.1 Experience

| 项 | 状态 | 路径 |
|----|------|------|
| Domain types | ✅ FROZEN | `src/domain/intelligence/experience.ts` |
| Domain functions | ✅ FROZEN | `experience.ts` (createExperience, attachOutcome, attachAttribution, finalizeExperience, gcExperienceBuffer, etc.) |
| Outcome module | ✅ FROZEN | `src/domain/intelligence/outcome.ts` |
| Attribution module | ✅ FROZEN | `src/domain/intelligence/attribution.ts` |
| System shell | ✅ FROZEN | `src/systems/intelligence/experience-collector-system.ts` |
| globalCache field | ✅ | `__experienceCache: unknown` (heap, ExperienceCollectorCache) |
| bootstrap registration | ✅ | P3, interval=100, phase=post |

### A6.2 Strategy Evaluation

| 项 | 状态 | 路径 |
|----|------|------|
| Domain types | ✅ FROZEN | `src/domain/intelligence/strategy-evaluation.ts` |
| Domain functions | ✅ FROZEN | `evaluateStrategy()`, `evaluationHash()`, `verifyEvaluationDeterminism()` |
| `RecommendationCandidate` type | ✅ FROZEN | `strategy-evaluation.ts` §10 — `shadowOnly: true`, `autoApply: false` (literal types) |
| Baseline module | ✅ FROZEN | `src/domain/intelligence/baseline.ts` |
| Evaluation Evidence | ✅ FROZEN | `src/domain/intelligence/evaluation-evidence.ts` |
| System shell | ✅ FROZEN | `src/systems/intelligence/strategy-evaluation-system.ts` |
| globalCache field | ✅ | `__evaluationCache: unknown` (heap, StrategyEvaluationCache) |
| bootstrap registration | ✅ | P3, interval=500, phase=post |

### A6.3 Prediction

| 项 | 状态 | 路径 |
|----|------|------|
| Domain types | ✅ FROZEN | `src/domain/intelligence/prediction/types.ts` |
| Context & Regime | ✅ FROZEN | `src/domain/intelligence/prediction/context.ts` |
| Hashing utilities | ✅ FROZEN | `src/domain/intelligence/prediction/hashing.ts` — `stableStringify()`, `fnv1a32Hex()` |
| Ring Buffer | ✅ FROZEN | `src/domain/intelligence/prediction/ring-buffer.ts` |
| Prediction models | ✅ FROZEN | `energy-shortage.ts`, `spawn-starvation.ts` |
| System shell | ✅ FROZEN | `src/systems/intelligence/prediction-system.ts` |
| globalCache field | ✅ | `__predictionCache: unknown` (PredictionCache) |
| Additional TimeSeries fields | ✅ | `__cpuBucketHistory`, `__spawnQueueDepthHistory`, `__logisticsHealthHistory`, `__roomHealthHistory`, `__remoteMiningHistory` |
| bootstrap registration | ✅ | P3, interval=500, phase=post |

### A6.4 Calibration

| 项 | 状态 | 路径 |
|----|------|------|
| Domain types | ✅ FROZEN | `src/domain/intelligence/calibration/types.ts` |
| Domain functions | ✅ FROZEN | `resolvePrediction()`, `computeCalibrationStatistics()`, `updateProfile()`, etc. |
| Guards | ✅ FROZEN | `src/domain/intelligence/calibration/guards.ts` |
| System shell | ✅ FROZEN | `src/systems/intelligence/calibration-resolution-system.ts` |
| globalCache field | ✅ | `__calibrationCache: unknown` (CalibrationCache) |
| bootstrap registration | ✅ | P3, interval=500 (CALIBRATION_INTERVAL), phase=post |

### A6.5 Intelligence State / Reliability

| 项 | 状态 | 路径 |
|----|------|------|
| Domain types | ✅ FROZEN | `src/domain/intelligence/reliability/types.ts` |
| Domain functions | ✅ FROZEN | `src/domain/intelligence/reliability/compute-state.ts` — `computeIntelligenceState()` |
| Sub-modules | ✅ FROZEN | `regime-fit.ts`, `temporal-drift.ts`, `conflict-detect.ts`, `freshness.ts`, `uncertainty.ts` |
| Guards | ✅ FROZEN | `src/domain/intelligence/reliability/guards.ts` |
| System shell | ✅ FROZEN | `src/systems/intelligence/intelligence-state-system.ts` |
| globalCache field | ❌ | **A6.5 不写入 globalCache** — IntelligenceState is transient (REL-001) |
| bootstrap registration | ✅ | P3, interval=500 (INTELLIGENCE_STATE_INTERVAL), phase=post |

---

## 二、globalCache Intelligence 字段审计

### 2.1 A6.6 可消费的 globalCache 字段（只读）

| 字段 | 来源 | 类型 | A6.6 可读 |
|------|------|------|:--------:|
| `__experienceCache` | A6.1 | `{ ringBuffer, seq, processedDecisionIds }` | ✅ |
| `__evaluationCache` | A6.2 | `{ ringBuffer, lastEvaluationTick }` | ✅ |
| `__predictionCache` | A6.3 | `{ ringBuffer, lastRunTick }` | ✅ |
| `__calibrationCache` | A6.4 | `{ ringBuffer, lastRunTick }` | ✅ |
| `empireHealth` | A4.5 | `EmpireHealthResult` | ✅ |
| `recoveryStats` | A4.6 | `RecoveryStats` | ✅ |
| `logisticsHealth` | A4.3 | `LogisticsHealthResult` | ✅ |
| `expansionDashboard` | A3.2 | `ExpansionDashboard` | ✅ |
| `networkSnapshot` | A3.1 | `NetworkSnapshot` | ✅ |
| `warPlanCache` | A5.3 | `{ tick, plan }` | ✅ |
| `threatAssessments` | A5.1 | `Map<room, ThreatAssessment>` | ✅ |
| `__netFlowHistory` | A4.5 | `number[]` | ✅ |
| `__reserveHistory` | A4.5 | `number[]` | ✅ |
| `__populationHistory` | A4.5 | `number[]` | ✅ |
| `__spawnQueueDepthHistory` | A6.3 | `TimeSeries<number>` | ✅ |

### 2.2 A6.6 唯一允许写入的 globalCache 字段

| 字段 | 允许 | 条件 |
|------|:----:|------|
| `__recommendationCache` | ✅ | Bounded, TTL, GC, shadow-only |
| **其他任何字段** | ❌ | 禁止 |

### 2.3 globalCache 中尚无 `__recommendationCache` 字段

**需要在 `GlobalCache` 接口中新增 `__recommendationCache?: unknown` 字段。**
这不违反任何冻结契约——A6.0 §六 明确规划了 A6.6 的 cache 字段。

---

## 三、Decision Authority 审计

### 3.1 现有 Decision Authority（A6.6 不得覆盖）

| Authority | 模块 | 职责 |
|-----------|------|------|
| Posture/Strategy | `src/domain/strategy/posture.ts` | 唯一 posture 裁决 |
| Spawn | `src/systems/spawn-manager.ts` | 唯一 `spawnCreep` 调用者 |
| War | `src/systems/war-planner.ts` | 唯一进攻执行 |
| Construction | `src/systems/construction-manager.ts` + `remote-mining-manager.ts` | 唯一 site 创建 |
| Logistics | `src/systems/logistics-planner.ts` | 唯一 TransportPlan 产出 |
| Recovery | `src/systems/recovery-execution-system.ts` | 唯一 RecoveryAction 执行 |
| Expansion | `src/systems/expansion-manager.ts` | 唯一 Claim 执行 |
| Terminal/Market | `src/systems/terminal-manager.ts` | 唯一市场交易 |
| Tactical | `src/systems/tactical-*.ts` | 唯一战术决策 |

### 3.2 A6.6 的 Authority

| Authority | A6.6 | 说明 |
|-----------|:----:|------|
| 生成 Recommendation | ✅ | A6.6 唯一职责 |
| 排序 Recommendation | ✅ | Lexicographic ranking |
| 检测冲突 | ✅ | detect + expose |
| 标记 TTL/Expired/Superseded | ✅ | 生命周期管理 |
| 决定策略 | ❌ | 尊重 posture.ts |
| 执行 Recommendation | ❌ | 无执行路径 |
| 解决冲突 | ❌ | 只检测不解决 |

---

## 四、A6.2 已有 `RecommendationCandidate` 审计

### 4.1 当前定义

```typescript
// src/domain/intelligence/strategy-evaluation.ts §10
interface RecommendationCandidate {
  readonly recommendationId: string;
  readonly dimension: EvaluationDimension;
  readonly description: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly shadowOnly: true;
  readonly autoApply: false;
}
```

### 4.2 消费者

**当前无任何执行系统消费 `RecommendationCandidate`。** grep 确认仅在 A6 域内导出和引用。

### 4.3 A6.6 与 A6.2 RecommendationCandidate 的关系

A6.6 **不修改** A6.2 的 `RecommendationCandidate`（A6.2 已冻结）。A6.6 在 `src/domain/intelligence/recommendation/types.ts` 中定义**新的、更完整的** `RecommendationCandidate` 类型，扩展了 evidence chain、lifecycle、conflict 等维度。A6.2 的 `RecommendationCandidate` 可作为 A6.6 evidence 的一个来源（从 `__evaluationCache` 读取）。

---

## 五、可复用的确定性基础设施

| 工具 | 来源 | A6.6 复用方式 |
|------|------|-------------|
| `stableStringify()` | `prediction/hashing.ts` | 确定性 JSON 序列化 |
| `fnv1a32Hex()` | `prediction/hashing.ts` | 确定性 hash |
| `buildPredictionContextSignature()` | `prediction/context.ts` | Regime 签名 |
| `makePredictionContext()` | `prediction/context.ts` | 构建 PredictionContext |
| `checkRegimeCompatibility()` | `prediction/context.ts` | Regime 兼容性检查 |

A6.6 **不得**重新实现这些工具，只做只读 import。

---

## 六、测试基础设施审计

| 项 | 状态 |
|----|------|
| 测试框架 | Vitest 2.x |
| 测试目录 | `tests/unit/intelligence/` |
| 已有 A6 测试 | a6-1-*, a6-2-*, a6-3-2-*, a6_5_reliability |
| 测试 setup | `tests/setup.ts` — 提供全局 mock (Memory, RoomPosition, Screeps 常量) |
| typecheck | `tsc --noEmit` |
| build | `rollup -c` |

---

## 七、GAP 与 BLOCKER

### 7.1 GAP（可处理，不阻塞）

| GAP | 严重度 | 处理方案 |
|-----|--------|---------|
| `GlobalCache` 尚无 `__recommendationCache` 字段 | LOW | 新增字段声明（不修改现有字段） |
| A6.2 `RecommendationCandidate` 无 evidence chain | LOW | A6.6 定义新的扩展类型，不修改 A6.2 |
| A6.5 IntelligenceState 不持久化 | LOW | A6.6 在 system 层调用 `computeIntelligenceState()` 获取瞬态值 |
| `src/domain/intelligence/recommendation/` 目录不存在 | LOW | A6.6 新建该目录 |
| `src/systems/intelligence/recommendation-engine-system.ts` 不存在 | LOW | A6.6 新建该文件 |
| bootstrap 未注册 recommendation-engine | LOW | 在 `bootstrap.ts` 新增一行注册 |

### 7.2 BLOCKER

**无 BLOCKER。**

所有 A6.1–A6.5 冻结契约完好无损，确定性基础设施可复用，globalCache 和 bootstrap 的修改量极小（各一行）且不违反任何现有约束。

---

## 八、实施顺序

1. **Domain 类型定义** — `src/domain/intelligence/recommendation/types.ts`
2. **Evidence Builder** — `src/domain/intelligence/recommendation/evidence-builder.ts`
3. **Recommendation Generator** — `src/domain/intelligence/recommendation/generator.ts`
4. **Conflict Detector** — `src/domain/intelligence/recommendation/conflict-detector.ts`
5. **Lifecycle Manager** — `src/domain/intelligence/recommendation/lifecycle.ts`
6. **Ranking** — `src/domain/intelligence/recommendation/ranking.ts`
7. **Hashing** — `src/domain/intelligence/recommendation/hashing.ts` (re-export from prediction/hashing.ts)
8. **Guards** — `src/domain/intelligence/recommendation/guards.ts`
9. **Index** — `src/domain/intelligence/recommendation/index.ts`
10. **System Shell** — `src/systems/intelligence/recommendation-engine-system.ts`
11. **globalCache 扩展** — 在 `GlobalCache` 接口新增 `__recommendationCache?: unknown`
12. **bootstrap 注册** — 在 `bootstrap.ts` 新增 `.registerSystem(recommendationEngineSystem)`
13. **测试** — `tests/unit/intelligence/a6-6-*.test.ts`

---

## 九、实施条件裁决

| 条件 | 满足 |
|------|:----:|
| A6.1–A6.5 冻结契约完好 | ✅ |
| 确定性基础设施可复用 | ✅ |
| 无 BLOCKER | ✅ |
| 无 Decision Authority 冲突 | ✅ |
| globalCache 扩展不违反现有约束 | ✅ |
| bootstrap 修改量极小 | ✅ |
| 测试基础设施就绪 | ✅ |

## 裁决：**CAN_START_IMPLEMENTATION**

无 BLOCKER。所有前置条件已满足。可以开始 A6.6 Implementation。
