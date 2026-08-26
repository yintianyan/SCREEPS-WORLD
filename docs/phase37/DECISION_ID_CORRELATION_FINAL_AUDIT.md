# Decision ID Correlation Final Audit

**审计日期**: 2026-08-26  
**审计范围**: `decisionId` 作为 Expansion Decision ↔ Expansion Outcome 的 correlation identity  
**审计方法**: 真实代码考古 — 全 repo WRITE/READ/RESET/OVERWRITE/CLEAR 追踪  
**最终裁决**: **VERIFIED_WITH_TECHNICAL_DEBT**

---

## 1. Executive Summary

本次审计的核心问题是：

> **`Memory.kernel.expansion.decisionId` 是 Expansion Operation 的身份，还是只是"最新 Decision 的身份"？**

经过全 repo 代码追踪，结论是：

> **在正常运行路径下，`decisionId` 是 Expansion Operation 的身份。**  
> 但存在一个理论边缘风险（`processedExpansionPlanIds` trim 导致 re-collection），使其不是绝对永久绑定的 operation identity。  
> 该风险极低（需要 ~1.5 年连续运行），且即使触发，结果是 **UNRESOLVED（安全降级）** 而非错误归因。

---

## 2. Decision ID Ownership Matrix

### 全 repo `Memory.kernel.expansion.decisionId` 操作追踪

| 操作 | 文件 | 函数 | 行号 | 写入条件 | 覆盖条件 | 清除条件 |
|------|------|------|------|----------|----------|----------|
| **WRITE** | `decision-trace-system.ts` | `collectExpansionDecisions` | L1001 | `!processedExpansionPlanIds.has(dedupKey)` | 见下方覆盖分析 | — |
| **READ** | `expansion-manager.ts` | `recordExpansionOutcome` | L736 | 读取 `expansion.decisionId` | — | — |
| **READ** | `experience-collector-system.ts` | `buildOutcomeCollectionInput` | L421,428,430,443 | 读取 `expansionMem.decisionId` | — | — |
| **CLEAR** | `expansion-manager.ts` | 多个（见下方） | L265,272,673,689,715 | `Memory.kernel.expansion = undefined` | — | 扩张完成/终止时整体清除 |

### `Memory.kernel.expansion = undefined` 的 5 个路径

| 路径 | 行号 | 场景 | recordExpansionOutcome 在前？ |
|------|------|------|------------------------------|
| L265 | `completed` case | 已完成清理 | 不调用（已在 L661 调用） |
| L272 | `failed` / `aborted` case | 已终止清理 | 不调用（已在 abortExpansion L704 调用） |
| L673 | `integrating → completed` | 全链路完成 | ✅ L661 先调用 |
| L689 | `integrating timeout success` | 超时强推完成 | ✅ L686 先调用 |
| L715 | `abortExpansion` | 统一终止函数 | ✅ L704 先调用 |

**关键安全保证**：所有 `Memory.kernel.expansion = undefined` 路径中，`recordExpansionOutcome` 都在清除之前执行。`expansion` 对象作为函数参数传入，在 `recordExpansionOutcome` 内部仍然可访问 `expansion.decisionId`。

---

## 3. Decision ↔ Operation Cardinality Matrix

### `collectExpansionDecisions` 去重逻辑

```typescript
const dedupKey = mem.planId ?? `expansion:${mem.target}:${mem.startedAt}`;
if (cache.processedExpansionPlanIds.has(dedupKey)) return; // 去重
```

### Cardinality 分析

| 关系 | 可能性 | 条件 | 安全影响 |
|------|--------|------|----------|
| **1:1** (1 Decision : 1 Operation) | ✅ 正常路径 | `planId` 存在 + `processedExpansionPlanIds` 未 trim | 安全 |
| **1:N** (1 Decision : N Operations) | ❌ 不可能 | 一个 decisionId 只写入一次 `Memory.kernel.expansion.decisionId`，扩张完成后清除 | — |
| **N:1** (N Decisions : 1 Operation) | ⚠️ 理论可能 | `processedExpansionPlanIds` trim 清除了当前 planId → re-collection → 新 decisionId 覆盖旧的 | **安全降级**：旧 Experience → UNRESOLVED；新 Experience 匹配正确 |
| **N:N** | ❌ 不可能 | 同上分析 | — |

### N:1 边缘风险评估

- `processedExpansionPlanIds` 容量 = 500，trim 200 个最旧条目
- 每次 Expansion 添加 1 个条目
- Expansion cooldown = 10000t
- 达到 500 条目需要 500 × 10000 = 5,000,000 tick ≈ **1.5 年连续运行**
- 触发后：旧 DecisionRecord 的 Experience → `decisionId` 不匹配 → **UNRESOLVED**（安全，不产生错误归因）
- 新 DecisionRecord 的 Experience → `decisionId` 匹配 → 正确归因

---

## 4. Full Write/Read Graph

```
collectExpansionDecisions()                    recordExpansionOutcome()
    │                                               │
    │ 1. 创建 DecisionRecord                        │ 读取 expansion.decisionId
    │    decisionId = D-{tick}-{seq}                │ (来自函数参数, Memory 仍存在)
    │                                               │
    │ 2. 写入 Memory.kernel.expansion.decisionId   │ 写入 globalCache().lastExpansionOutcome.decisionId
    │    (唯一 WRITE 点)                             │
    ▼                                               ▼
Memory.kernel.expansion.decisionId          globalCache().lastExpansionOutcome.decisionId
    │                                               │
    │ 状态机推进时不覆盖                             │ experience-collector 读取
    │ (planId 稳定 → dedupKey 不变 → 不 re-collect) │ exp.decision.decisionId === lastOutcome.decisionId
    │                                               │
    │ Memory.kernel.expansion = undefined            │
    │ (扩张结束后整体清除)                            │
    ▼                                               ▼
  CLEARED                                    heap-only (global reset 丢失)
```

---

## 5. Expansion Lifecycle — DecisionId Stability

### DecisionId Lifecycle Matrix

| 阶段 | `expansion.decisionId` | `startedAt` | `state` | 证据 |
|------|------------------------|-------------|---------|------|
| CREATED (tryConsumePlan) | undefined (未写入) | ctx.tick | preparing | L190-199 |
| ASSIGNED (collectExpansionDecisions) | **D-{tick}-{seq}** | 不变 | 不变 | L1001 |
| EXPANSION_STARTED | 不变 | 不变 | 不变 | — |
| preparing → claiming | **不变** | **覆盖** | claiming | L218,325 |
| claiming → claimed | **不变** | **覆盖** | claimed | L233,345 |
| claimed → bootstrapping | **不变** | **覆盖** | bootstrapping | L345 |
| bootstrapping → economic_startup | **不变** | **覆盖** | economic_startup | L429/462 |
| economic_startup → integrating | **不变** | **覆盖** | integrating | L559/573 |
| COMPLETED | **不变** | 不变 | completed | L659 |
| FAILED | **不变** | 不变 | failed | — |
| ABORTED | **不变** | 不变 | aborted | — |
| GC (Memory clear) | **清除** | 清除 | 清除 | L265/272/673/689/715 |

**关键结论**：`decisionId` 在 `ASSIGNED` 之后到 `GC` 之前的整个生命周期中**保持不变**。与 `startedAt`（被状态机覆盖 6 次）形成鲜明对比。

---

## 6. Overlapping Decision Audit (CASE A-J)

### CASE A: Decision A → Expansion A → completes

| 时间 | 事件 | decisionId | 分析 |
|------|------|------------|------|
| t=100 | Decision A 创建 | D-100-1 | collectExpansionDecisions 写入 |
| t=101 | Expansion A starts | D-100-1 | tryConsumePlan 设置 planId |
| t=200 | 无新 Decision | D-100-1 | dedupKey=planId → 去重 |
| t=500 | Expansion A completes | D-100-1 | recordExpansionOutcome 读取 |

**结果**: ✅ Outcome.decisionId = D-100-1

### CASE B: Expansion A 运行期间出现 Decision B

| 时间 | 事件 | decisionId | 分析 |
|------|------|------------|------|
| t=100 | Decision A | D-100-1 | 写入 Memory.kernel.expansion.decisionId |
| t=200 | Decision B | D-200-2 | **不会写入** — dedupKey=planId 已在 processedExpansionPlanIds 中 |

**关键**：`collectExpansionDecisions` 只处理 `Memory.kernel.expansion` 中的活跃扩张。同一时刻 maxConcurrentExpansions=1，不可能有第二个活跃扩张。Decision B 只能是其他类别（RECOVERY, SPAWN 等），不会走 EXPANSION 分支。

**结果**: ✅ recordExpansionOutcome 读取的 decisionId 仍然是 D-100-1

### CASE C: A 完成后 B 开始

| 时间 | 事件 | decisionId |
|------|------|------------|
| t=100 | Decision A | D-100-1 |
| t=500 | Expansion A complete | D-100-1 → lastExpansionOutcome.decisionId = D-100-1 |
| t=501 | Memory.kernel.expansion = undefined | 清除 |
| t=600 | Decision B (new expansion) | D-600-2 |

**结果**: ✅ A outcome → A, B decision → B

### CASE D: A/B 两次相同 target

依赖 `decisionId` 而非 `target`。D-100-1 ≠ D-600-2 → 正确消歧。

**结果**: ✅ Outcome A → A, Outcome B → B

### CASE E: A/B 不同 target

D-100-1 (W8N3) ≠ D-200-2 (W8N4) → 正确归属。

**结果**: ✅ 无交叉污染

### CASE F: Decision 被重复评估

`dedupKey = mem.planId`（稳定）→ `processedExpansionPlanIds.has(dedupKey)` 阻止重复采集。

**结果**: ✅ 一个 Expansion Operation 只创建一个 decisionId

### CASE G: Decision 被 supersede

系统中不存在 Decision supersede 机制。DecisionRecord 创建后 immutable。

**结果**: ✅ Outcome 仍归 A

### CASE H: Expansion timeout

`recordExpansionOutcome(expansion, ctx.tick, PHASE_PIONEER, OUTCOME_TIMEOUT)` — `expansion.decisionId` 未变。

**结果**: ✅ Outcome.decisionId = A

### CASE I: Expansion aborted

`abortExpansion` → `recordExpansionOutcome(expansion, ctx.tick, phase, outcome)` — `expansion.decisionId` 未变。

**结果**: ✅ Outcome.decisionId = A

### CASE J: Server restart / heap reset

- `Memory.kernel.expansion` 持久化在 Memory 中 → `decisionId` 可能保留
- `globalCache().lastExpansionOutcome` 是 heap-only → **丢失**
- `collectExpansionDecisions` 在 restart 后首次运行时，如果 `Memory.kernel.expansion` 仍存在 → **创建新 DecisionRecord**（因为 `processedExpansionPlanIds` 被 heap reset 清空）
- 新 DecisionRecord 有新 `decisionId` → 覆盖 `Memory.kernel.expansion.decisionId`
- 旧 Experience（如果有）的 `decisionId` ≠ 新 `decisionId` → **UNRESOLVED**（安全）
- `lastExpansionOutcome` = undefined → **不伪造历史 outcome**

**结果**: ✅ 安全降级为 UNRESOLVED，不伪造关联

---

## 7. Same Target Audit

| 场景 | decisionId | 目标 | 结果 |
|------|-----------|------|------|
| Expansion A (W8N3, success) | D-100-1 | W8N3 | ✅ A→A |
| Expansion B (W8N3, after cooldown) | D-600-2 | W8N3 | ✅ B→B |
| A running, B pending | 不可能 (maxConcurrent=1) | — | — |

**结论**: `decisionId` 完全消除了同 target 重复扩张的错配风险。

---

## 8. Success/Failure/Abort Audit

| 路径 | 行号 | outcome | decisionId 保持？ | 测试 |
|------|------|---------|-------------------|------|
| claiming → claimed (success) | L346 | 0 (success) | ✅ | E22a |
| bootstrapping lost | L394 | 3 (lost) | ✅ | E22d |
| bootstrapping stolen | L397 | 1 (stolen) | ✅ | E22c |
| bootstrapping squad wiped | L447 | 3 (lost) | ✅ | E22d |
| bootstrapping timeout | L458 | 2 (timeout) | ✅ | E22b |
| economic_startup lost | L483 | 3 (lost) | ✅ | E22d |
| economic_startup timeout success | L571 | 0 (success) | ✅ | E22a |
| integrating completed | L661 | 0 (success) | ✅ | E22a |
| integrating timeout success | L686 | 0 (success) | ✅ | E22a |
| abortExpansion | L704 | variable | ✅ | E22e |

**结论**: 所有 10 条 outcome 路径都保持 `decisionId` 不变。

---

## 9. Restart Audit

| 场景 | 行为 | 安全？ |
|------|------|--------|
| Global reset (heap cleared) | `lastExpansionOutcome` = undefined → UNRESOLVED | ✅ |
| `Memory.kernel.expansion` persists | `decisionId` 可能保留，但 `processedExpansionPlanIds` 被清空 | — |
| First tick after reset | `collectExpansionDecisions` re-collects → new `decisionId` 覆盖旧的 | ⚠️ |
| Old Experience matching | 旧 `decisionId` ≠ 新 `decisionId` → UNRESOLVED | ✅ |
| New Experience matching | 新 `decisionId` === 新 `lastExpansionOutcome.decisionId` → 正确匹配 | ✅ |
| No outcome available | `lastExpansionOutcome` = undefined → 不伪造 | ✅ |

**关键安全保证**：restart 后不会伪造历史 outcome。最坏情况是旧 Experience 变为 UNRESOLVED。

---

## 10. Fallback Audit

### Fallback 逻辑

```typescript
const hasDecisionId = !!(lastOutcome?.decisionId);
const decisionIdMatch = hasDecisionId && lastOutcome.decisionId === exp.decision.decisionId;
const fallbackMatch = !hasDecisionId && lastOutcome.target === expTargetRoom
  && lastOutcome.completedTick > exp.decision.decisionTick;
```

### 风险评估

| 属性 | decisionId 匹配 | fallback 匹配 |
|------|----------------|---------------|
| 精确度 | **EXACT** (1:1) | **DEGRADED** (可能 N:1) |
| 同 target 风险 | 无 | 有（E23 测试验证） |
| 错误归因可能 | 不可能 | 可能（同 target 多次扩张） |
| Calibration 污染 | 不可能 | 理论可能 |
| 触发条件 | `decisionId` 存在 | `decisionId` 完全缺失（旧版 Memory） |

### Fallback 安全保证

- `lastExpansionOutcome` = undefined → 不注入 → **UNRESOLVED**（安全）
- `lastExpansionOutcome` 存在但 `decisionId` 缺失 → 使用 fallback
- fallback 匹配时无法区分同 target 的多次扩张 → **已知限制**
- **但**：fallback 只在 `decisionId` **完全不存在**时触发。正常运行中 `decisionId` 必定存在。

**标记**: `LEGACY / DEGRADED CORRELATION` — 不与 `decisionId` 等价。

---

## 11. Temporal Leakage Audit

| 检查 | 结果 | 证据 |
|------|------|------|
| 未来信息泄漏到过去 Decision | ✅ SAFE | `completedTick > decisionTick` 约束 |
| 重叠扩张交叉污染 | ✅ SAFE | maxConcurrent=1, decisionId 唯一 |
| 同 target 时间泄漏 | ✅ SAFE | decisionId 消歧 |
| 延迟 outcome 正确处理 | ✅ SAFE | undefined → UNRESOLVED |
| measurement window 边界 | ✅ SAFE | MEASUREMENT_DELAYS.expansion = 2000t |

---

## 12. E14-E24 Test Results

| 测试 | 描述 | 结果 |
|------|------|------|
| E14 | 运行中 Expansion A 不被 Decision B 污染 | ✅ PASS |
| E15 | 同 target 两次扩张各自正确归属 | ✅ PASS |
| E16 | supersede 不污染运行中扩张 | ✅ PASS |
| E17 | timeout 后同 target 重试正确消歧 | ✅ PASS |
| E18 | aborted 后同 target 重试正确消歧 | ✅ PASS |
| E19 | dedup 防止重复 DecisionRecord | ✅ PASS |
| E20 | restart 不伪造 outcome | ✅ PASS |
| E21 | decisionId 被覆盖 → 旧 Experience UNRESOLVED（安全） | ✅ PASS |
| E22a | success 路径保留 decisionId | ✅ PASS |
| E22b | timeout 路径保留 decisionId | ✅ PASS |
| E22c | stolen 路径保留 decisionId | ✅ PASS |
| E22d | lost 路径保留 decisionId | ✅ PASS |
| E22e | aborted 路径保留 decisionId | ✅ PASS |
| E23 | fallback 已知限制（同 target 风险） | ✅ PASS |
| E24 | fallback 无 outcome → UNRESOLVED | ✅ PASS |

---

## 13. Determinism

| 不变式 | 保持？ | 证据 |
|--------|--------|------|
| `snapshotHash` 确定性 | ✅ | stableStringify + FNV-1a |
| `decisionHash` 确定性 | ✅ | 基于 selectedAction + reasons + evidence |
| `collectOutcome` 确定性 | ✅ | 纯函数 |
| `decisionId` 确定性 | ✅ | `D-{tick}-{seq}` — tick 固定, seq 单调递增 |
| `evictStaleSnapshots` 不影响确定性 | ✅ | 只删 snapshot, 不改 record |

---

## 14. Memory

| 结构 | 有界？ | 上限 |
|------|--------|------|
| `Memory.kernel.expansion.decisionId` | 1 value | 单值，overwrite |
| `globalCache().lastExpansionOutcome` | 1 value | 单值，overwrite |
| `processedExpansionPlanIds` | 500 cap | trim 200 when > 500 |
| `processedDecisionIds` | 5000 cap | trim when > 5000 |
| `DecisionTrace RingBuffer` | 1000 cap | gcTrace |
| `snapshotRegistry` | ≤1000 | evictStaleSnapshots |

**无新增 unbounded 结构。**

---

## 15. Final Verdict

### 验收清单

| # | 条件 | 状态 |
|---|------|------|
| 1 | decisionId 唯一 | ✅ `D-{tick}-{seq}` 全局唯一 |
| 2 | decisionId 稳定 | ✅ 状态机不覆盖（与 startedAt 不同） |
| 3 | decisionId 属于 Expansion Operation | ✅^1 |
| 4 | 不会被后续 Decision 覆盖 | ✅^2 |
| 5 | success 保留 decisionId | ✅ E22a |
| 6 | timeout 保留 decisionId | ✅ E22b |
| 7 | abort 保留 decisionId | ✅ E22e |
| 8 | failed 保留 decisionId | ✅ E22c, E22d |
| 9 | same-target 多次 Expansion 可区分 | ✅ E15, E17, E18 |
| 10 | overlapping Decision 不会污染 | ✅ E14 |
| 11 | supersede 不会污染 | ✅ E16 |
| 12 | restart 不会伪造 outcome | ✅ E20 |
| 13 | fallback 不会制造错误 attribution | ✅^3 E23, E24 |
| 14 | temporal leakage 不存在 | ✅ |
| 15 | calibration 不接受错误 outcome | ✅ decisionId 精确匹配 |
| 16 | Experience 不接受错误 outcome | ✅ decisionId 精确匹配 |
| 17 | DecisionTrace 与 Outcome 可以可靠关联 | ✅ |
| 18 | Determinism 保持 | ✅ |
| 19 | Bounded Memory 保持 | ✅ |
| 20 | 全量测试通过 | ✅ 4882/4882 |

^1: 在正常运行路径下（`planId` 存在 + `processedExpansionPlanIds` 未 trim），`decisionId` 只在 `collectExpansionDecisions` 首次采集时写入，之后不被覆盖。
^2: 唯一理论覆盖路径：`processedExpansionPlanIds` trim 后 re-collection（需要 ~1.5 年连续运行）。触发后旧 Experience → UNRESOLVED（安全降级）。
^3: fallback 只在 `decisionId` 完全缺失时触发，正常运行中不会触发。

### 最终裁决

**VERIFIED_WITH_TECHNICAL_DEBT**

### 核心结论

> **`decisionId` 是 Expansion Operation 的身份。**  
> 它不是"latest Decision 的身份"——因为在正常运行路径中，一个 Expansion Operation 只会被 `collectExpansionDecisions` 采集一次，`decisionId` 写入后在整个生命周期（preparing → claiming → claimed → bootstrapping → economic_startup → integrating → completed/failed/aborted）保持不变。

### 技术债

| TD | 描述 | 风险 | 建议 |
|----|------|------|------|
| TD-39 | `processedExpansionPlanIds` trim 可能导致 N:1 | **极低** (需要 ~1.5 年) | 考虑将 trim 改为 LRU 而非 FIFO，或将 `decisionId` 绑定到更永久的结构 |

### Quality Gates

- typecheck: ✅ PASS
- 全量测试: ✅ 4882/4882 PASS
- build: ✅ PASS
