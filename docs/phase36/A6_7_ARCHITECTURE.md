# A6.7 Architecture — Recommendation Consumption Boundary & Observability Enhancement

> **Phase**: 36
> **Date**: 2026-08-26
> **Status**: RESEARCH / NO IMPLEMENTATION
> **Depends on**: A6.1–A6.6 (FROZEN) · A5 Decision Authority Matrix (FROZEN)
> **Modifies**: NONE (no frozen contracts modified)

---

## 一、定位

A6.7 = **Recommendation Consumption Boundary & Observability Enhancement**

不是：
- ❌ Auto Apply Recommendation
- ❌ Strategy Mutation
- ❌ Reinforcement Learning
- ❌ ML / Neural Network
- ❌ Shadow Simulation
- ❌ 新 Decision Authority
- ❌ 自动调参系统

是：
- ✅ 只读消费接口规范
- ✅ Observability Dashboard 增强
- ✅ Intelligence 输出安全暴露层
- ✅ 操作者可审阅的 Recommendation 视图

---

## 二、架构边界

```
┌─────────────────────────────────────────────────────┐
│                   A6 Intelligence Pipeline           │
│                                                       │
│  A6.1 Experience → A6.2 Evaluation → A6.3 Prediction │
│       → A6.4 Calibration → A6.5 IntelligenceState     │
│       → A6.6 Recommendation                            │
│              │                                        │
│              ↓                                        │
│  ┌─────────────────────────────────┐                 │
│  │  A6.7 Consumption Boundary       │                 │
│  │  (只读接口规范 + Observability)    │                 │
│  │                                   │                 │
│  │  - getRecommendationSummary()      │                 │
│  │  - getIntelligenceStateSummary()   │                 │
│  │  - printFullDashboard()            │                 │
│  │  - getRecommendationHistory()      │                 │
│  │                                   │                 │
│  │  禁止：                            │                 │
│  │  - executeRecommendation()         │                 │
│  │  - applyRecommendation()           │                 │
│  │  - selectBestRecommendation()      │                 │
│  │  - overrideDecision()             │                 │
│  └──────────────┬──────────────────┘                 │
│                 │                                     │
│     ╔═══════════╧═══════════╗                        │
│     ║  STOP — 只读输出        ║                        │
│     ╚═══════════════════════╝                        │
└─────────────────────────────────────────────────────┘
                    │
                    │ 只读参考（可选，非强制）
                    ↓
┌─────────────────────────────────────────────────────┐
│              A5 Decision Authority                    │
│                                                       │
│  posture.ts ← 唯一 posture 裁决                      │
│  spawn-manager.ts ← 唯一 spawnCreep                   │
│  war-planner.ts ← 唯一进攻执行                       │
│  recovery-execution-system ← 唯一 RecoveryAction      │
│  logistics-planner.ts ← 唯一 TransportPlan            │
│  expansion-manager.ts ← 唯一 Claim                   │
│  construction-manager.ts ← 唯一 site 创建             │
│  terminal-manager.ts ← 唯一市场交易                   │
└─────────────────────────────────────────────────────┘
```

---

## 三、A6.7 产出

### 3.1 Domain 层（纯函数，不引用 Game/Memory）

| 函数 | 输入 | 输出 | 职责 |
|------|------|------|------|
| `getRecommendationSummary(buf, tick)` | `RecommendationRingBuffer`, `number` | `RecommendationSummary` | 汇总 active/expired/superseded 统计 + top-N 建议 |
| `getIntelligenceStateSummary(state)` | `IntelligenceState` | `IntelligenceStateSummary` | 汇总 reliability/calibration/freshness/drift |
| `getRecommendationHistory(buf, limit)` | `RecommendationRingBuffer`, `number` | `RecommendationHistoryEntry[]` | supersede 链 + lifecycle 统计 |
| `getConflictSummary(buf)` | `RecommendationRingBuffer` | `ConflictSummary` | 冲突类型/严重度分布 |
| `formatDashboardOutput(summary, stateSummary, conflictSummary)` | 三个 Summary | `string` | 格式化 console 输出 |

### 3.2 System 层（薄壳）

| 函数 | 职责 |
|------|------|
| `printFullDashboard()` | 替代/增强 A6.6 的 `printRecommendationDashboard()`，增加 IntelligenceState 摘要 + 历史 + 冲突 |
| `getIntelligenceOverview()` | 返回 Intelligence 全链路摘要（供控制台调用） |

### 3.3 禁止函数

| 函数名 | 禁止理由 |
|--------|----------|
| `executeRecommendation()` | 违反 REC-006 |
| `applyRecommendation()` | 违反 REC-006 + REC-011 |
| `selectBestRecommendation()` | 违反 REC-008 |
| `overrideDecision()` | 违反 A6.0 冻结契约 |
| `mutateStrategy()` | 违反 REC-007 |
| `autoTuneParameter()` | 违反"不创建第二套 Metrics" |
| `acceptRecommendation()` | 违反 REC-008（自主采纳） |

---

## 四、与冻结契约的关系

| 冻结契约 | A6.7 影响 |
|----------|:---------:|
| A6.0 Shadow-Only | ✅ 不违反（只读接口，不执行） |
| A6.1 Experience | ✅ 不修改（只读 `__experienceCache`） |
| A6.2 Evaluation | ✅ 不修改（只读 `__evaluationCache`） |
| A6.3 Prediction | ✅ 不修改（只读 `__predictionCache`） |
| A6.4 Calibration | ✅ 不修改（只读 `__calibrationCache`） |
| A6.5 IntelligenceState | ✅ 不修改（只读瞬态 `IntelligenceState`） |
| A6.6 Recommendation | ✅ 不修改（只读 `__recommendationCache`） |
| A5 Decision Authority Matrix | ✅ 不修改（不创建新 Authority） |

---

## 五、Decision Authority

| 权限 | A6.7 | A5 执行系统 |
|------|:----:|:-----------:|
| 生成 Recommendation | ❌ | ❌ |
| 排序 Recommendation | ❌ | ❌ |
| 检测冲突 | ❌ | ❌ |
| 生命周期管理 | ❌ | ❌ |
| 汇总统计 | ✅ | ❌ |
| 格式化输出 | ✅ | ❌ |
| 最终裁决 | ❌ | ✅（各 Authority 独立裁决） |
| 执行 Action | ❌ | ✅ |

**A6.7 零 Decision Authority。**

---

## 六、运行时调度

| 项 | 值 |
|----|----|
| interval | 500t（寄生 recommendation-engine cadence） |
| priority | P3 |
| phase | post |
| CPU / run | < 0.05ms |
| Memory | 0 新增（只读已有 cache） |

A6.7 的 Dashboard 输出在 `tick % 5000 === 0` 时执行（低频可观测性）。

---

## 七、实现范围

### MUST HAVE

1. `getRecommendationSummary()` — 汇总统计纯函数
2. `getConflictSummary()` — 冲突汇总纯函数
3. `formatDashboardOutput()` — 格式化输出纯函数
4. 增强 system 层可观测性输出

### SHOULD HAVE

5. `getIntelligenceStateSummary()` — IntelligenceState 摘要（需要 A6.5 system 运行时瞬态获取）
6. `getRecommendationHistory()` — supersede 链历史

### NICE TO HAVE

7. 在 `printFullDashboard()` 中集成 IntelligenceState 摘要

### DO NOT IMPLEMENT

- ❌ Shadow Simulation
- ❌ Auto Apply / Auto Execute
- ❌ Strategy Mutation
- ❌ Parameter Auto-Tuning
- ❌ Model Retirement / Promotion
- ❌ Historical Learning（持久化 Experience）
- ❌ Human Approval Channel
- ❌ New Decision Authority

---

## 八、文件清单（拟）

| 文件 | 职责 | 行数估计 |
|------|------|----------|
| `src/domain/intelligence/consumption/summary.ts` | Summary 纯函数 | ~150 |
| `src/domain/intelligence/consumption/dashboard.ts` | Dashboard 格式化纯函数 | ~100 |
| `src/domain/intelligence/consumption/index.ts` | 统一出口 | ~20 |
| `src/systems/intelligence/consumption-observability-system.ts` | System 薄壳 | ~80 |

**修改文件**：

| 文件 | 改动 |
|------|------|
| `src/bootstrap.ts` | 新增 `.registerSystem(consumptionObservabilitySystem)` |
| `src/kernel/global-cache.ts` | **不修改**（不新增 cache 字段） |

---

## 九、测试策略

| 测试类别 | 测试数估计 | 覆盖 |
|----------|-----------|------|
| Summary 函数 | 8-10 | 空输入、确定性、统计正确性 |
| Dashboard 格式化 | 3-5 | 空输出、完整输出、确定性 |
| 确定性 replay | 2-3 | 1000× 一致 |
| Shadow 安全 | 2-3 | 无执行字段、无 Game API |
| 总计 | ~15-20 | |

---

## 十、验收条件

1. `npm run typecheck` 全绿
2. `npm test` 全绿（新增测试 + 已有 4753 测试不回归）
3. `npm run build` 全绿
4. A6.7 系统完全停止时帝国照常运行
5. 无执行系统 import A6.7 输出（grep 验证）
6. 1000× replay 确定性通过
7. 无 Math.random / Date.now / new Date()
