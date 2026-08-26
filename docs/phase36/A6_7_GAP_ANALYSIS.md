# A6.7 Gap Analysis — Intelligence Consumption Boundary & Loop Closure Audit

> **Phase**: 36
> **Date**: 2026-08-26
> **Method**: 真实代码调用链追踪 + 全 repo grep + 冻结契约交叉验证
> **范围**: A6.1–A6.6 全链路 + A5 Military/Economy/Expansion/Recovery + Decision Authority Matrix + globalCache + bootstrap

---

## 1. Executive Summary

A6 Intelligence Pipeline（A6.1–A6.6）已形成一个完整的 **Observation → Evaluation → Prediction → Calibration → Reliability → Recommendation** 链条。该链条的全部输出目前是 **Shadow-Only Artifact**：写入 heap cache（`__recommendationCache`）、通过 `console.log` 输出可观测性、导出三个查询函数（`getRecommendations`、`getActiveRecommendationList`、`printRecommendationDashboard`）——但 **零执行系统消费**。

**核心发现**：

1. **Recommendation 是孤立 Shadow Artifact** — 全 repo `src/` 中零个执行系统 import 或读取 `__recommendationCache`。
2. **IntelligenceState 是瞬态只读投影** — A6.5 不写入任何 cache，仅在 A6.6 system 运行时被瞬态调用。
3. **Prediction → Calibration 已形成局部反馈闭环** — A6.3 产出 Prediction，A6.4 在 Prediction 过期后 Resolution 验证并更新 CalibrationProfile，Profile 反馈到下次 Prediction 的 confidence 修正。但这是**模型校准闭环**，不是**策略学习闭环**。
4. **完整 Learning Loop（Recommendation → Action → Outcome → Experience → … → Recommendation）不存在**。从 Recommendation 到 Action 的链接缺失。
5. **A6.7 不应该自动补齐这条链接** — 自动执行 Recommendation 会违反 A6.0 Shadow-Only 冻结契约，会创建第二套 Decision Authority。

**最终裁决**：A6.7 的最小正确实现是 **Recommendation Consumption Boundary & Observability Enhancement**——不创建新的 Decision Authority，不自动执行 Recommendation，而是建立安全的只读消费边界，让已有 Decision Authority（如 `posture.ts`、`recovery-execution-system`、`war-planner`）在自身权限内**可选择性地只读参考** Intelligence 输出，同时增强可观测性使其对操作者可审阅。

---

## 2. Existing A6 Capability — 真实代码审计

### 2.1 A6.1 Experience & Outcome Attribution

| 项 | 路径 | 状态 |
|----|------|------|
| Domain | `src/domain/intelligence/experience.ts` | ✅ FROZEN |
| Outcome | `src/domain/intelligence/outcome.ts` | ✅ FROZEN |
| Attribution | `src/domain/intelligence/attribution.ts` | ✅ FROZEN |
| System | `src/systems/intelligence/experience-collector-system.ts` | ✅ FROZEN |
| globalCache | `__experienceCache: unknown` (heap) | ✅ |
| bootstrap | P3, interval=100, phase=post | ✅ |

**产出**：`ExperienceRecord[]`（含 outcome、attribution）写入 `__experienceCache.ringBuffer`。

**消费者**：A6.2 strategy-evaluation-system（只读）、A6.6 recommendation-engine-system（只读）。无执行系统消费。

### 2.2 A6.2 Strategy Evaluation & Baseline

| 项 | 路径 | 状态 |
|----|------|------|
| Domain | `src/domain/intelligence/strategy-evaluation.ts` | ✅ FROZEN |
| Baseline | `src/domain/intelligence/baseline.ts` | ✅ FROZEN |
| Evaluation Evidence | `src/domain/intelligence/evaluation-evidence.ts` | ✅ FROZEN |
| System | `src/systems/intelligence/strategy-evaluation-system.ts` | ✅ FROZEN |
| globalCache | `__evaluationCache: unknown` (heap) | ✅ |
| bootstrap | P3, interval=500, phase=post | ✅ |

**产出**：`StrategyEvaluation`（8 维度评分 + baseline 对比 + `RecommendationCandidate`（A6.2 版本））写入 `__evaluationCache.ringBuffer`。

**消费者**：A6.6 recommendation-engine-system（只读）。A6.2 的 `RecommendationCandidate`（`shadowOnly: true`, `autoApply: false`）与 A6.6 的扩展版 `RecommendationCandidate` 独立存在。无执行系统消费。

### 2.3 A6.3 Prediction Layer

| 项 | 路径 | 状态 |
|----|------|------|
| Types | `src/domain/intelligence/prediction/types.ts` | ✅ FROZEN |
| Context | `src/domain/intelligence/prediction/context.ts` | ✅ FROZEN |
| Hashing | `src/domain/intelligence/prediction/hashing.ts` | ✅ FROZEN |
| Ring Buffer | `src/domain/intelligence/prediction/ring-buffer.ts` | ✅ FROZEN |
| Models | `energy-shortage.ts`, `spawn-starvation.ts` | ✅ FROZEN |
| System | `src/systems/intelligence/prediction-system.ts` | ✅ FROZEN |
| globalCache | `__predictionCache` + 5 个 TimeSeries 字段 | ✅ |
| bootstrap | P3, interval=500, phase=post | ✅ |

**产出**：`Prediction[]` 写入 `__predictionCache.ringBuffer`。TimeSeries 数据写入 `__cpuBucketHistory` 等。

**消费者**：A6.4 calibration-resolution-system（只读，Resolution 验证）、A6.5 intelligence-state-system（只读）、A6.6 recommendation-engine-system（只读）。无执行系统消费。

### 2.4 A6.4 Prediction Calibration & Resolution

| 项 | 路径 | 状态 |
|----|------|------|
| Types | `src/domain/intelligence/calibration/types.ts` | ✅ FROZEN |
| Functions | `resolvePrediction()`, `computeCalibrationStatistics()`, `updateProfile()` | ✅ FROZEN |
| Guards | `src/domain/intelligence/calibration/guards.ts` | ✅ FROZEN |
| System | `src/systems/intelligence/calibration-resolution-system.ts` | ✅ FROZEN |
| globalCache | `__calibrationCache: unknown` (heap) | ✅ |
| bootstrap | P3, interval=500, phase=post | ✅ |

**产出**：`ResolutionResult[]` + `ModelCalibrationProfile` Map 写入 `__calibrationCache.ringBuffer`。

**局部闭环**：A6.3 产出 Prediction → A6.4 在 Prediction 过期后 Resolution → 更新 CalibrationProfile → Profile 的 ECE/BrierScore 反映模型精度 → A6.5 读取 Profile 评估 Reliability → A6.6 读取 Profile 调整 Recommendation confidence。**这是模型校准闭环，不是策略学习闭环。**

**消费者**：A6.5 intelligence-state-system（只读）、A6.6 recommendation-engine-system（只读）。无执行系统消费。

### 2.5 A6.5 Reliability Assessment & Intelligence State

| 项 | 路径 | 状态 |
|----|------|------|
| Types | `src/domain/intelligence/reliability/types.ts` | ✅ FROZEN |
| Functions | `computeIntelligenceState()` | ✅ FROZEN |
| Sub-modules | `regime-fit.ts`, `temporal-drift.ts`, `conflict-detect.ts`, `freshness.ts`, `uncertainty.ts` | ✅ FROZEN |
| Guards | `src/domain/intelligence/reliability/guards.ts` | ✅ FROZEN |
| System | `src/systems/intelligence/intelligence-state-system.ts` | ✅ FROZEN |
| globalCache | **不写入任何 cache** — REL-001 | ✅ |
| bootstrap | P3, interval=500, phase=post | ✅ |

**产出**：`IntelligenceState`（瞬态，不持久化）。包含 predictionCoverage、modelReliability、calibrationHealth、dataSufficiency、regimeFit、uncertainty、predictionConflicts、knowledgeFreshness。

**消费者**：A6.6 recommendation-engine-system 运行时调用 `computeIntelligenceState()` 获取瞬态值。无执行系统消费。

### 2.6 A6.6 Evidence-backed Recommendation Engine

| 项 | 路径 | 状态 |
|----|------|------|
| Domain | `src/domain/intelligence/recommendation/` (8 files) | ✅ FROZEN |
| System | `src/systems/intelligence/recommendation-engine-system.ts` | ✅ FROZEN |
| globalCache | `__recommendationCache: unknown` (heap) | ✅ |
| bootstrap | P3, interval=500, phase=post | ✅ |
| Tests | 73 tests, all passing | ✅ |
| Safety Guards | REC-001 ~ REC-014, all passing | ✅ |

**产出**：`RecommendationCandidate[]`（含 evidence chain、lifecycle、conflict）写入 `__recommendationCache.ringBuffer`。导出查询函数 `getRecommendations()`、`getActiveRecommendationList()`、`printRecommendationDashboard()`。

**消费者**：**无。** 全 repo grep 确认零执行系统 import 或读取。

---

## 3. Real Call Graph — 真实调用链

### 3.1 Producer → Consumer 链

```
Decision Trace (A4.7)
  ↓ (DecisionRecord 到期)
Experience Collector (A6.1)
  ↓ (__experienceCache.ringBuffer)
  ├──→ Strategy Evaluation (A6.2)
  │     ↓ (__evaluationCache.ringBuffer)
  │     └──→ Recommendation Engine (A6.6)
  │
  ├──→ Recommendation Engine (A6.6)  [直接消费 Experience]
  │
  ↓ (TimeSeries 数据)
Prediction System (A6.3)
  ↓ (__predictionCache.ringBuffer)
  ├──→ Calibration Resolution (A6.4)
  │     ↓ (__calibrationCache.ringBuffer)
  │     │   [局部闭环: Prediction → Resolution → Profile → confidence 修正]
  │     │
  │     ├──→ Intelligence State (A6.5)
  │     │     ↓ (瞬态 IntelligenceState, 不持久化)
  │     │     └──→ Recommendation Engine (A6.6)
  │     │
  │     └──→ Recommendation Engine (A6.6) [直接消费 Calibration]
  │
  └──→ Intelligence State (A6.5)
        ↓ (瞬态)
        └──→ Recommendation Engine (A6.6)

Recommendation Engine (A6.6)
  ↓ (__recommendationCache.ringBuffer)
  ↓ (getRecommendations / getActiveRecommendationList / printRecommendationDashboard)
  ↓
  ╔══════════════════════════════════════════════════════╗
  ║  STOP — 无 Consumer                                    ║
  ╚══════════════════════════════════════════════════════╝
```

### 3.2 执行系统消费搜索

全 repo `src/` 目录搜索 `recommendation` / `Recommendation` / `__recommendationCache` / `getRecommendations` / `getActiveRecommendationList` / `printRecommendationDashboard`：

| 文件 | 引用性质 | 是否执行系统 |
|------|----------|:---:|
| `bootstrap.ts:51` | 系统注册 | 否（组合根） |
| `global-cache.ts:381` | 类型声明 | 否（类型） |
| `recommendation-engine-system.ts` | 自身 | 否（A6 系统） |
| `recovery-priority.ts:67` | `recommendation: string` — **同名异义**（恢复动作描述） | 否 |
| `war-planning.ts:427,552` | `recommendation` 字段 — **同名异义**（经济护栏结果） | 否 |
| `empire-health-system.ts:286` | `urgent.recommendation` — **同名异义** | 否 |
| `decision-trace-system.ts:156,775,782,803` | `recommendation` — **同名异义** | 否 |
| `recovery-lifecycle.ts:584` | `recommendation: string` — **同名异义** | 否 |
| `operation-value.ts:62` | `recommendation: "PROCEED"|"DOWNGRADE"|...` — **同名异义** | 否 |
| `abort-recovery.ts:86` | `recommendation: string` — **同名异义** | 否 |
| `economic-guard.ts:55` | `recommendation: string` — **同名异义** | 否 |

**结论**：**零个执行系统消费 A6.6 Recommendation 输出。** 所有 `recommendation` 字段匹配均为同名异义（恢复/军事/经济模块自己的 `recommendation` 字符串字段，与 A6.6 的 `RecommendationCandidate` 无关）。

---

## 4. Intelligence Consumer Audit — Producer → Consumer → Authority 三元关系表

### 4.1 A6 Intelligence 输出

| Producer | Output | Storage | Consumer（执行系统） | Authority |
|----------|--------|---------|---------------------|-----------|
| A6.1 Experience | `ExperienceRecord[]` | `__experienceCache` (heap) | **无** | A6.1 自身（只写自身 cache） |
| A6.2 Evaluation | `StrategyEvaluation` | `__evaluationCache` (heap) | **无** | A6.2 自身 |
| A6.3 Prediction | `Prediction[]` | `__predictionCache` (heap) | **无** | A6.3 自身 |
| A6.4 Calibration | `ResolutionResult[]` + `Profile` Map | `__calibrationCache` (heap) | **无** | A6.4 自身 |
| A6.5 IntelligenceState | `IntelligenceState` | **瞬态，不持久化** | **无** | A6.5 自身 |
| A6.6 Recommendation | `RecommendationCandidate[]` | `__recommendationCache` (heap) | **无** | A6.6 自身（零 Decision Authority） |

### 4.2 A5 执行系统 Decision Authority

| Authority | 模块 | 消费 Intelligence？ | 权限 |
|-----------|------|:---:|------|
| Posture/Strategy | `src/domain/strategy/posture.ts` | ❌ | 唯一 posture 裁决 |
| Spawn | `src/systems/spawn-manager.ts` | ❌ | 唯一 `spawnCreep` 调用者 |
| War | `src/systems/war-planner.ts` | ❌ | 唯一进攻执行 |
| Construction | `src/systems/construction-manager.ts` | ❌ | 唯一 site 创建 |
| Logistics | `src/systems/logistics-planner.ts` | ❌ | 唯一 TransportPlan 产出 |
| Recovery | `src/systems/recovery-execution-system.ts` | ❌ | 唯一 RecoveryAction 执行 |
| Expansion | `src/systems/expansion-manager.ts` | ❌ | 唯一 Claim 执行 |
| Terminal/Market | `src/systems/terminal-manager.ts` | ❌ | 唯一市场交易 |
| Tactical | `src/systems/tactical-*.ts` | ❌ | 唯一战术决策 |

**结论**：**零个 A5 执行系统消费任何 A6 Intelligence 输出。** A5 和 A6 之间完全隔离。

### 4.3 标记

| 输出 | 标记 |
|------|------|
| A6.1 Experience | OBSERVATION_ONLY |
| A6.2 Evaluation | OBSERVATION_ONLY |
| A6.3 Prediction | OBSERVATION_ONLY |
| A6.4 Calibration | OBSERVATION_ONLY |
| A6.5 IntelligenceState | OBSERVATION_ONLY (瞬态) |
| A6.6 Recommendation | OBSERVATION_ONLY (Shadow Artifact) |
| A5 Recovery `recommendation` 字段 | CANONICAL（同名异义，非 A6 输出） |
| A5 War `recommendation` 字段 | CANONICAL（同名异义，非 A6 输出） |

---

## 5. Decision Authority Audit

### 5.1 现有 Decision Authority（冻结）

依据 `docs/phase26/DECISION_AUTHORITY_MATRIX.md`，现有 Decision Authority 23 项，涵盖 WarPosture → Tactical → Role → Game API 全链路。**无任何 Decision Authority 消费 A6 Intelligence 输出。**

### 5.2 A6 的 Authority

| A6 层 | Authority | 范围 |
|--------|-----------|------|
| A6.1–A6.5 | 各自只写自身 cache / 不持久化 | 只产出，不裁决 |
| A6.6 | 生成 + 排序 + 冲突检测 + 生命周期 | **零 Decision Authority**（REC-008） |

### 5.3 A6.7 是否需要新的 Decision Authority？

**不需要。** A6.7 禁止创建：
- `RecommendationAuthority`
- `IntelligenceAuthority`
- `AIOverrideAuthority`
- `MetaStrategyAuthority`

A6 Intelligence 永远不能成为执行权威。如果 A6.7 需要"选择最终方案"，必须 **停止设计并报告 DECISION AUTHORITY CONFLICT**。

**当前判定：无 DECISION AUTHORITY CONFLICT。** A6.7 不创建新 Authority。

---

## 6. Closed-loop Analysis — 闭环审计

### 6.1 理论链

```
Decision → Outcome → Experience → Evaluation → Prediction → Calibration → Reliability → Recommendation
```

### 6.2 缺失段

```
Recommendation → [Action] → [Outcome] → …
```

**从 Recommendation 到 Action 的链接不存在。** 没有任何执行系统读取 Recommendation 并据此采取行动。

### 6.3 局部闭环

| 闭环 | 范围 | 性质 |
|------|------|------|
| Prediction → Calibration → Profile → confidence 修正 | A6.3–A6.4 | **模型校准闭环**（局部，非策略学习） |
| Experience → Evaluation → baseline 对比 | A6.1–A6.2 | **基线对比**（非闭环，单向） |
| Recommendation → Supersede/TTL/Expire | A6.6 | **生命周期管理**（非学习闭环） |

### 6.4 结论

**当前 A6 是 Observation / Evaluation / Recommendation Loop，不是完整 Learning Loop。**

完整 Learning Loop 需要补齐：`Recommendation → Action → Outcome → Experience → … → Recommendation`。

**但补齐这条链接意味着：**
1. Recommendation 必须被执行系统消费 → 违反 REC-006（No Execution Leak）
2. 执行系统必须根据 Recommendation 改变行为 → 创建新的 Decision Authority
3. 或创建中间仲裁层 → 违反 A6.0 冻结契约

**因此，补齐完整 Learning Loop 在当前架构下是不安全的。** 详见 §9。

---

## 7. Current Architecture Gaps

| Gap | 严重度 | 描述 |
|-----|--------|------|
| GAP-1 | LOW | Recommendation 无 Consumer — Shadow Artifact 完全孤立 |
| GAP-2 | LOW | IntelligenceState 无持久化 — global reset 后重建（设计如此，REL-001） |
| GAP-3 | LOW | A6.6 系统层直接访问 `globalThis.Game` 读取 room count / RCL（TD-A66-04） |
| GAP-4 | LOW | 4 个 NO_RECOMMENDATION 原因枚举已定义未使用（TD-A66-01） |
| GAP-5 | LOW | `MAX_ACTIVE_RECOMMENDATIONS` 常量已定义未使用（TD-A66-02） |
| GAP-6 | INFO | 无 Observation Dashboard 供操作者审阅 Recommendation |
| GAP-7 | INFO | 无 Recommendation 历史趋势追踪（supersede 链仅存储 ID，无趋势统计） |

**无 BLOCKER。** 所有 GAP 均为 LOW 或 INFO 级别。

---

## 8. Candidate A6.7 Directions

### 方向 A: Recommendation → Dashboard / Observation → Human Review

| 维度 | 评分 |
|------|------|
| Value | LOW-MEDIUM — 对操作者有价值，但不直接影响运行时 |
| Dependency | ZERO — 不依赖任何执行系统修改 |
| Risk | ZERO — 纯只读输出 |
| Cost | LOW — 1-2 个文件 |
| 安全性 | ✅ 完全安全 |

### 方向 B: Recommendation → Shadow Simulation → Outcome Comparison

| 维度 | 评分 |
|------|------|
| Value | MEDIUM — 能验证 Recommendation 质量，但需要 Simulation 框架 |
| Dependency | HIGH — 需要 Simulation 环境（Screeps 无原生 Simulation） |
| Risk | MEDIUM — Simulation 可能引入非确定性 |
| Cost | HIGH — 需要完整的 World State 快照 + Action 模拟 |
| 安全性 | ⚠️ 需要仔细设计以确保确定性 |

### 方向 C: Recommendation → Future Decision Authority Consumer

| 维度 | 评分 |
|------|------|
| Value | HIGH — 直接影响运行时 |
| Dependency | CRITICAL — 需要修改 A5 执行系统或创建新 Authority |
| Risk | CRITICAL — 违反 A6.0 Shadow-Only + 创建第二套 Decision Authority |
| Cost | HIGH — 修改多个冻结模块 |
| 安全性 | ❌ 不安全，违反冻结契约 |

### 方向 D: Recommendation Consumption Boundary — 只读参考接口

| 维度 | 评分 |
|------|------|
| Value | MEDIUM — 让已有 Decision Authority **可选择性地**只读参考 Intelligence |
| Dependency | LOW — 不修改任何冻结模块的行为，只新增只读查询接口 |
| Risk | LOW — 只读接口，Decision Authority 可忽略 |
| Cost | LOW — 新增 1-2 个文件 |
| 安全性 | ✅ 安全（Decision Authority 保留最终裁决权） |

### 方向 E: Freeze / Stop

| 维度 | 评分 |
|------|------|
| Value | ZERO — 不新增任何功能 |
| Dependency | ZERO |
| Risk | ZERO |
| Cost | ZERO |
| 安全性 | ✅ 最安全 |

---

## 9. Value × Dependency × Risk × Cost Matrix

| 方向 | Value | Dependency | Risk | Cost | 推荐 |
|------|-------|------------|------|------|:----:|
| A: Dashboard | LOW-MED | ZERO | ZERO | LOW | SHOULD |
| B: Shadow Sim | MED | HIGH | MED | HIGH | DO NOT |
| C: Auto Execute | HIGH | CRITICAL | CRITICAL | HIGH | **REJECT** |
| D: Read-Only Boundary | MED | LOW | LOW | LOW | **MUST** |
| E: Freeze | ZERO | ZERO | ZERO | ZERO | FALLBACK |

---

## 10. Recommended Direction

**推荐 A6.7 = 方向 D + 方向 A 的组合：Recommendation Consumption Boundary & Observability Enhancement**

核心设计：
1. **Consumption Boundary**：定义一个只读接口规范（不是新 Authority），让已有 Decision Authority **可以选择性地**只读参考 Recommendation，但 **最终裁决权永远属于已有 Authority**。
2. **Observability Enhancement**：增强 `printRecommendationDashboard()` 输出，增加历史趋势、supersede 链统计、conflict 统计、IntelligenceState 摘要。
3. **不修改任何冻结模块**：A5 执行系统不修改，A6.1–A6.6 不修改。
4. **不创建新 Authority**：Consumption Boundary 是接口规范，不是裁决层。

---

## 11. Rejected Directions

| 方向 | 拒绝理由 |
|------|----------|
| C: Auto Execute | 违反 A6.0 Shadow-Only + REC-006 No Execution Leak + 创建第二套 Decision Authority |
| B: Shadow Simulation | 需要完整 World State 快照 + Action 模拟框架，Screeps 无原生 Simulation，成本极高，收益不明确 |
| Auto Parameter Tuning | `tuning-engine-system` 已存在（P3, 500t），基于遥测数据调参。A6.7 不应创建第二套调参系统。 |
| Strategy Mutation | 违反 REC-007 No Strategy Mutation + A6.0 冻结契约 |
| Model Retirement / Promotion | 需要完整 Learning Loop + 足够数据量，当前 2 个 Prediction Model 不足以支撑自动 retirement/promotion |
| Historical Learning | 需要持久化 Experience 数据 + 跨 tick 索引，违反 Memory 有界约束 |
| Human Approval Channel | Screeps 无 UI 审批通道；console 指令属于人工接管，不属于 A6 范畴 |

---

## 12. Safety Boundary

| 约束 | A6.7 遵守 |
|------|:---------:|
| Shadow-Only | ✅ 不创建执行路径 |
| 不调用 Game API | ✅ Domain 层纯函数 |
| 不修改 Strategy | ✅ |
| 不修改 EmpirePosture | ✅ |
| 不修改 Spawn | ✅ |
| 不修改 Military | ✅ |
| 不修改 Logistics | ✅ |
| 不修改 Recovery | ✅ |
| 不创建第二套 Metrics | ✅ |
| 不创建第二套 Strategy | ✅ |
| 不创建第二套 Decision Authority | ✅ |
| 不创建新 tick 高频采样通道 | ✅ (P3, interval ≥ 500t) |
| 不使用 Math.random | ✅ |
| 不使用 Date.now | ✅ |
| 所有输出 Deterministic | ✅ |
| 所有 Memory 有界 | ✅ (heap only) |
| A6 停止后 A5 完全正常运行 | ✅ |

---

## 13. CPU / Memory Contract

| 项 | 值 |
|----|----|
| interval | 500t (寄生已有 recommendation-engine cadence) |
| priority | P3 |
| phase | post |
| CPU / run | < 0.1ms（只读查询 + 格式化输出） |
| CPU / 1000t | < 0.2ms |
| Memory | 0 新增（只读已有 cache） |
| RingBuffer capacity | 不新增 |
| GC policy | 不新增（复用 A6.6 GC） |

---

## 14. Determinism Contract

| 约束 | 保证 |
|------|------|
| same input → same output | ✅ 所有函数纯函数 |
| same output → same hash | ✅ 复用 A6.3 `stableStringify` + `fnv1a32Hex` |
| 100× replay | ✅ 可验证 |
| 1000× replay | ✅ 可验证 |
| Math.random | ❌ 禁止 |
| Date.now | ❌ 禁止 |
| wall clock | ❌ 禁止 |
| unordered iteration | ❌ 禁止（所有迭代按 sorted key） |
| 依赖对象地址 | ❌ 禁止 |
| 依赖 Game runtime 状态隐式排序 | ❌ 禁止 |

---

## 15. Counterfactual Scenarios — 15 个反事实场景

### CF-01: Recommendation 正确，但不能自动执行

| 维度 | 内容 |
|------|------|
| 输入 | A6.6 产出一条 critical urgency 的 spawn-starvation Recommendation，confidence=0.8 |
| Intelligence 输出 | `RecommendationCandidate { category: "spawn", urgency: "critical", confidence: 0.8, shadowOnly: true, autoApply: false }` |
| 允许进入执行层？ | **否** — `shadowOnly: true` + `autoApply: false` |
| Decision Authority | `spawn-manager.ts`（唯一 `spawnCreep` 调用者） |
| 最终行为 | spawn-manager 按自身逻辑决策，不参考 Recommendation |
| 安全性 | ✅ 安全 — Recommendation 被记录但未执行 |

### CF-02: Recommendation 错误，不能污染 Runtime

| 维度 | 内容 |
|------|------|
| 输入 | A6.6 产出一条错误 Recommendation（如建议扩张到一个已被敌人占领的房间） |
| Intelligence 输出 | `RecommendationCandidate { category: "expansion", ... }` |
| 允许进入执行层？ | **否** |
| Decision Authority | `expansion-manager.ts` |
| 最终行为 | expansion-manager 按自身逻辑决策，不受错误 Recommendation 影响 |
| 安全性 | ✅ 安全 — 错误被隔离在 Shadow 层 |

### CF-03: Prediction confidence 很低

| 维度 | 内容 |
|------|------|
| 输入 | A6.3 产出 Prediction，confidence=0.15 < MIN_CONFIDENCE_THRESHOLD(0.1) |
| Intelligence 输出 | A6.6 前置检查：confidence < threshold → `NO_RECOMMENDATION { reason: "LOW_CONFIDENCE" }` |
| 允许进入执行层？ | **否** — NO_RECOMMENDATION 不产出 |
| Decision Authority | 无（不产出建议） |
| 最终行为 | 无行为变化 |
| 安全性 | ✅ 安全 |

### CF-04: Calibration 显示模型不可靠

| 维度 | 内容 |
|------|------|
| 输入 | A6.4 Profile ECE > 0.3，A6.5 IntelligenceState `calibrationHealth.status = "DRIFT_DETECTED"` |
| Intelligence 输出 | A6.6 `evaluatePostureTrigger` 检测到 drift → 产出 posture Recommendation `urgency: "low"` |
| 允许进入执行层？ | **否** — 仅记录 |
| Decision Authority | `posture.ts`（唯一 posture 裁决） |
| 最终行为 | posture.ts 按自身逻辑决策 |
| 安全性 | ✅ 安全 — drift 信号被记录但不自动触发 posture 变化 |

### CF-05: IntelligenceState 与 Recommendation 冲突

| 维度 | 内容 |
|------|------|
| 输入 | IntelligenceState 显示 `dataSufficiency.sufficient = false`，但 A6.6 仍产出 Recommendation |
| Intelligence 输出 | `generateRecommendations` 前置检查 `dataSufficient` → 如果 false，confidence 降权 0.5×。若降权后 < threshold → NO_RECOMMENDATION |
| 允许进入执行层？ | **否** |
| Decision Authority | 无 |
| 最终行为 | NO_RECOMMENDATION 或低 confidence Recommendation（shadow） |
| 安全性 | ✅ 安全 — 数据不足时自动降级 |

### CF-06: 多个 Recommendation 相互冲突

| 维度 | 内容 |
|------|------|
| 输入 | A6.6 同时产出 `expansion` 和 `recovery` Recommendation（resource_competition 冲突） |
| Intelligence 输出 | `detectConflicts` 检测到冲突 → `RecommendationConflict { type: "resource_competition", severity: "medium" }` |
| 允许进入执行层？ | **否** — 冲突只检测不解决（REC-008） |
| Decision Authority | 无（不裁决冲突） |
| 最终行为 | 两条 Recommendation 都在 cache 中，冲突记录在 cache 中，均不被执行 |
| 安全性 | ✅ 安全 — 冲突被暴露但不被自动解决 |

### CF-07: Recommendation 过期

| 维度 | 内容 |
|------|------|
| 输入 | 一条 `defense` Recommendation TTL=500，当前 tick 超过 expiresTick |
| Intelligence 输出 | `expireOverdueRecommendations` 标记为 `lifecycle: "expired"` |
| 允许进入执行层？ | **否** — expired 不在 active 列表中 |
| Decision Authority | 无 |
| 最终行为 | 建议被标记过期，GC 后清除 |
| 安全性 | ✅ 安全 |

### CF-08: Regime 发生变化

| 维度 | 内容 |
|------|------|
| 输入 | posture 从 `develop` 变为 `war`，contextSignature 变化 |
| Intelligence 输出 | `expireByRegimeChange` 标记所有旧 Recommendation 为 `expired` |
| 允许进入执行层？ | **否** |
| Decision Authority | `posture.ts` |
| 最终行为 | 旧建议全部失效，下次 recommendation-engine 运行时基于新 Regime 重新生成 |
| 安全性 | ✅ 安全 |

### CF-09: Evidence 不完整

| 维度 | 内容 |
|------|------|
| 输入 | EvidenceTrace `complete: false`（缺少 CALIBRATED 阶段） |
| Intelligence 输出 | `NO_RECOMMENDATION { reason: "INSUFFICIENT_EVIDENCE", missingStages: ["CALIBRATED"] }` |
| 允许进入执行层？ | **否** |
| Decision Authority | 无 |
| 最终行为 | 不产出建议 |
| 安全性 | ✅ 安全 |

### CF-10: Experience 数据不足

| 维度 | 内容 |
|------|------|
| 输入 | `__experienceCache.ringBuffer` 为空（冷启动） |
| Intelligence 输出 | `buildExperienceEvidence` 返回空数组 → EvidenceTrace items < MIN_EVIDENCE_ITEMS → NO_RECOMMENDATION |
| 允许进入执行层？ | **否** |
| Decision Authority | 无 |
| 最终行为 | 不产出建议，console.log 报告冷启动 |
| 安全性 | ✅ 安全 |

### CF-11: A6 完全停止

| 维度 | 内容 |
|------|------|
| 输入 | 从 bootstrap 移除全部 A6 系统（A6.1–A6.6） |
| Intelligence 输出 | 无输出 |
| 允许进入执行层？ | N/A |
| Decision Authority | A5 全部 Decision Authority 正常运行 |
| 最终行为 | 帝国照常运行（A6 是 P3 低频，不影响 P0-P2） |
| 安全性 | ✅ 安全 — A6 Shutdown Safety 已验证 |

### CF-12: A6 Cache 损坏

| 维度 | 内容 |
|------|------|
| 输入 | `__recommendationCache` 被外部写入非法数据（如 `corrupted` 字符串） |
| Intelligence 输出 | A6.6 system `run()` 在初始化时检查 `if (!g.__recommendationCache)` → 如果已有但格式错误，后续操作可能 throw → `safeRun` 隔离 |
| 允许进入执行层？ | **否** |
| Decision Authority | 无 |
| 最终行为 | A6.6 系统报错冷却，不影响其他系统 |
| 安全性 | ✅ 安全 — safeRun 隔离 |

### CF-13: A5 Decision 与 A6 Recommendation 冲突

| 维度 | 内容 |
|------|------|
| 输入 | A6.6 建议扩张（`expansion`, urgency: low），但 A5 `posture.ts` 当前 posture = `fortify`（收缩防御） |
| Intelligence 输出 | `RecommendationCandidate { category: "expansion", urgency: "low", shadowOnly: true }` |
| 允许进入执行层？ | **否** — 即使 A6.7 建立了只读消费边界，posture.ts 的 Decision Authority 不被覆盖 |
| Decision Authority | `posture.ts`（posture=fortify 优先于 expansion 建议） |
| 最终行为 | 帝国按 fortify 逻辑运行，expansion 建议 shadow 记录 |
| 安全性 | ✅ 安全 — Decision Authority 永远属于 A5 |

### CF-14: Legacy/Fallback 路径存在

| 维度 | 内容 |
|------|------|
| 输入 | war-planner.ts 在 WarPlan 不可用时 fallback 到 legacy `selectWarTarget()` / `decideSquadSize()` |
| Intelligence 输出 | A6.6 不参与 war-planner 的 fallback 路径 |
| 允许进入执行层？ | **否** — A6.6 与 war-planner 完全隔离 |
| Decision Authority | war-planner.ts（含 legacy fallback） |
| 最终行为 | war-planner 按 fallback 逻辑决策 |
| 安全性 | ✅