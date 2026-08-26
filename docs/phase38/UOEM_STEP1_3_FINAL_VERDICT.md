# UOEM STEP 1.3 — Final Verdict

**日期：** 2026-08-26  
**阶段：** Phase 38 — UOEM STEP 1.3  
**性质：** DESIGN / PROOF ONLY — 无代码修改

---

## 1. 裁决

### UOEM_STEP1_3 = READY_FOR_IMPLEMENTATION

---

## 2. Producer Mapping 结果

| 指标 | 值 |
|------|-----|
| Producer count | 11 |
| Milestone count | 3 (P1, P5, P7) |
| Terminal count | 8 (P2, P3, P4, P6, P8, P9, P10, P11) |
| Ambiguous count | 0 |
| Producers not through recordExpansionOutcome | 1 (P11 bootstrap abandon) |

---

## 3. 六大核心问题状态

| 问题 | 状态 | 证明方式 |
|------|------|---------|
| **EXP-1** (Premature SUCCESS) | ✅ Structural fix | MilestoneEvent 不进 OutcomeChannel；P1 claim success 映射为 Milestone，不进入 terminal channel |
| **EXP-2** (Global reset operationId) | ✅ Design proven | operationId = createOperationId(target, consumeTick)，确定性纯函数，不依赖 heap；需要 STEP 2 引入 openedAt 字段 |
| **TMP-1** (Mutable startedAt) | ✅ Structural fix | 9 个 startedAt 覆盖点已全部追踪；UOEM openedAt immutable，computeDuration 不读 startedAt |
| **A6-R** (Lifetime aggregate) | ✅ UOEM clean | UOEM 不使用 lifetime aggregate；A6.1 现有 recoveryStats 设计保留不修改 |
| **A6-SL** (Before/after mismatch) | ✅ Design proven | UOEM operationId stable，before/after 通过 operationId 关联；当前 decisionId 不稳定但有 fallback 保护 |
| **TIMEOUT-SEMANTICS** | ✅ Structural fix | isTerminalEvent 检查 kind 不检查 outcomeCode；TIMEOUT milestone ≠ TIMEOUT outcome |

---

## 4. Invariants 验证

### I-PROD-01 ~ I-PROD-15

| ID | Invariant | 当前 Runtime | UOEM | 状态 |
|----|-----------|-------------|------|------|
| I-PROD-01 | Stable operationId | NO (decisionId unstable) | YES (deterministic) | ✅ Design |
| I-PROD-02 | DecisionId ≠ OperationId | VIOLATED (decisionId as op identity) | YES (branded types) | ✅ |
| I-PROD-03 | Milestone ∉ channel | N/A | YES (type system) | ✅ |
| I-PROD-04 | Only terminal ∈ channel | N/A | YES (parameter type) | ✅ |
| I-PROD-05 | Timeout ≠ terminality | VIOLATED (outcomeCode-based) | YES (kind-based) | ✅ |
| I-PROD-06 | forcedAdvance ≠ terminality | N/A | YES (metadata only) | ✅ |
| I-PROD-07 | Duration from immutable openedAt | VIOLATED (mutable startedAt) | YES (interval) | ✅ |
| I-PROD-08 | occurredAt ≠ recordedAt | N/A | YES (separate fields) | ✅ |
| I-PROD-09 | Max 1 terminal per operation | VIOLATED (P1+P8 both write) | YES (dedup) | ✅ |
| I-PROD-10 | Duplicate rejected | N/A | YES (DUPLICATE_REJECTED) | ✅ |
| I-PROD-11 | Before/after same operation | PARTIALLY (unstable decisionId) | YES (stable operationId) | ✅ Design |
| I-PROD-12 | No aggregate as current outcome | A6.1 uses aggregate | YES (per-operation) | ✅ (A6.1 preserved) |
| I-PROD-13 | Reset ≠ false identity | VIOLATED (new decisionId) | YES (deterministic) | ✅ |
| I-PROD-14 | No producer Decision Authority | N/A | YES (shadow-only) | ✅ |
| I-PROD-15 | UOEM shadow-only | N/A | YES (zero integration) | ✅ |

**15/15 invariants proven.**

---

## 5. Consumer Compatibility

| 分类 | 数量 |
|------|------|
| A. 不受影响 | 13 |
| B. 需要 Producer-side adaptation | 3 (experience-collector, rhythm ring, event-log) |
| C. 必须修改 Consumer | 0 |
| D. 架构冲突 | 0 |

---

## 6. 反事实场景 (CF-PROD-01 ~ CF-PROD-20)

| ID | 场景 | 当前 Runtime | UOEM | 状态 |
|----|------|-------------|------|------|
| CF-PROD-01 | claim success but operation continues | P1 writes lastExpansionOutcome SUCCESS | P1 → MilestoneEvent, not in channel | ✅ |
| CF-PROD-02 | bootstrapping timeout + spawn exists | P5 writes TIMEOUT to lastExpansionOutcome | P5 → MilestoneEvent(FORCED_ADVANCE) | ✅ |
| CF-PROD-03 | economic startup forced advance | P7 writes SUCCESS to lastExpansionOutcome | P7 → MilestoneEvent(FORCED_ADVANCE) | ✅ |
| CF-PROD-04 | timeout → success | P10(timeout) then P8(success) | P10 → OutcomeEvent(TIMED_OUT), P8 → OutcomeEvent(SUCCESS) | ✅ (P8 is new operation) |
| CF-PROD-05 | timeout → failure | P10(timeout) | OutcomeEvent(TIMED_OUT) | ✅ |
| CF-PROD-06 | success → failure | P8(success) then new op P10(failure) | Two OutcomeEvents, different operationId | ✅ |
| CF-PROD-07 | global reset during expansion | decisionId regenerated | operationId deterministic, stable | ✅ (needs openedAt) |
| CF-PROD-08 | same target repeated expansion | new expansion, new Memory.kernel.expansion | new operationId (different consumeTick) | ✅ |
| CF-PROD-09 | same operation repeated producer | P1 then P8 (same expansion) | P1 → Milestone, P8 → Outcome, same operationId | ✅ |
| CF-PROD-10 | two terminal producers same operation | P8 and P10 for same expansion | P8 ACCEPTED, P10 DUPLICATE_REJECTED | ✅ |
| CF-PROD-11 | before/after observation delayed | decisionId + completedTick | operationId + occurredAt + recordedAt | ✅ |
| CF-PROD-12 | lifetime aggregate changes | recoveryStats changes | UOEM doesn't use aggregate | ✅ |
| CF-PROD-13 | spawn before/after mismatch | spawnQueueLength from different ticks | UOEM not involved in spawn outcome | ✅ |
| CF-PROD-14 | logistics before/after mismatch | logisticsLevel from different ticks | UOEM not involved in logistics outcome | ✅ |
| CF-PROD-15 | duplicate terminal outcome | not handled (lastExpansionOutcome overwritten) | DUPLICATE_REJECTED | ✅ |
| CF-PROD-16 | milestone arrives after terminal | not handled (lastExpansionOutcome overwritten) | Milestone doesn't enter channel, no conflict | ✅ |
| CF-PROD-17 | terminal arrives after milestone | lastExpansionOutcome overwritten by terminal | OutcomeEvent enters channel, Milestone ignored | ✅ |
| CF-PROD-18 | restart between milestone and terminal | decisionId changes, lastExpansionOutcome lost | operationId stable, OutcomeChannel Memory-backed | ✅ (needs STEP 3) |
| CF-PROD-19 | recordedAt != occurredAt | only completedTick exists | separate fields, occurredAt <= recordedAt | ✅ |
| CF-PROD-20 | forcedAdvance=true but milestone | not tracked | MilestoneEvent, forcedAdvance=true, kind="milestone" → not terminal | ✅ |

**20/20 counterfactuals resolved.**

---

## 7. Memory Impact

| 字段 | 当前 | UOEM 后 | 变化 |
|------|------|---------|------|
| `Memory.kernel.expansion.startedAt` | mutable | 保留（expansion-manager 内部用） | 无变化 |
| `Memory.kernel.expansion.decisionId` | string | 保留（attribution 用） | 无变化 |
| `Memory.kernel.expansion.openedAt` | 不存在 | 新增（STEP 2） | +8 bytes |
| `globalCache().lastExpansionOutcome` | ~100 bytes | Phase A 保留, Phase C 删除 | 0 → -100 bytes |
| `globalCache().__outcomeChannel` | 不存在 | 新增（STEP 3） | +4.5KB worst-case |
| `Memory.kernel.expansionRhythm.ring` | 8 numbers | 保留 | 无变化 |

**净 Memory 影响：** +8 bytes (openedAt) + 4.5KB (OutcomeChannel) - 100 bytes (lastExpansionOutcome) ≈ +4.4KB

---

## 8. Shadow-Only Status

**当前状态：** UOEM 是完全孤立的 Domain Core，零 Producer/Consumer integration。

| 检查项 | 结果 |
|--------|------|
| UOEM 被 producer 调用？ | NO |
| UOEM 被 consumer 调用？ | NO |
| UOEM 被 A6.1-A6.6 调用？ | NO |
| UOEM 被 bootstrap 调用？ | NO |
| UOEM 被 rhythm ring 调用？ | NO |
| UOEM 调用 Game API？ | NO |
| UOEM 调用 Memory？ | NO |
| UOEM 调用 Date.now/Math.random？ | NO |

**Shadow-Only = TRUE** ✅

---

## 9. 实施路径

### STEP 2: Producer Migration（需要 openedAt 字段）

1. 在 `tryConsumePlan` 中铸造 `Memory.kernel.expansion.openedAt`（初始 ctx.tick，永不修改）
2. 在 `recordExpansionOutcome` 中增加 UOEM 分类逻辑：
   - 判断是否 terminal（检查 `Memory.kernel.expansion` 是否在调用后变为 undefined）
   - terminal → `OutcomeEvent` → `OutcomeChannel.emit()`
   - milestone → `MilestoneEvent`（不进 channel）
3. Phase A: 保持 lastExpansionOutcome 双写

### STEP 3: Consumer Migration

1. experience-collector 改读 OutcomeChannel
2. rhythm ring 改消费 OutcomeChannel terminal events
3. Phase B: 切换读取源
4. Phase C: 删除 lastExpansionOutcome

### STEP 4: Cleanup

1. 删除 lastExpansionOutcome
2. 删除 toOutcomeKind 中的 milestone 跳过逻辑
3. 删除 fallback 匹配逻辑

---

## 10. 未解决问题

| 问题 | 严重性 | 说明 |
|------|--------|------|
| openedAt 字段不存在 | Medium | STEP 2 需要引入，Memory schema migration |
| P11 bootstrap abandon 不经过 recordExpansionOutcome | Low | 需要在 STEP 2 中为 P11 增加 OutcomeChannel.emit 路径 |
| P5 timeout milestone 进入 rhythm ring | Low | 当前行为是 bug（P5 不是 terminal 但进了 ring），STEP 3 修复 |
| OutcomeChannel 持久化路径未定义 | Medium | STEP 3 需要定义 Memory 路径 |

---

## 11. 下一阶段风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| Memory schema migration | 引入 openedAt 需要 schemaVersion 升级 | 按 MEMORY_ARCHITECTURE 规范迁移 |
| Producer 双写一致性 | Phase A 期间 lastExpansionOutcome 和 OutcomeChannel 可能不一致 | Shadow 验证 + 一致性检查 |
| P11 遗漏 | bootstrap abandon 不经过主路径 | STEP 2 显式覆盖 |
| rhythm ring 行为变化 | P5 不再进 ring 可能影响 rhythm 评估 | 验证 rhythm 行为一致性 |

---

## 12. 最终裁决

### UOEM_STEP1_3 = READY_FOR_IMPLEMENTATION

| 维度 | 状态 |
|------|------|
| Producer count | 11 (all mapped) |
| Milestone count | 3 |
| Terminal count | 8 |
| Ambiguous count | 0 |
| EXP-1 status | ✅ Structural fix proven |
| EXP-2 status | ✅ Design proven (needs openedAt) |
| TMP-1 status | ✅ Structural fix proven |
| A6-R status | ✅ UOEM clean (A6.1 preserved) |
| A6-SL status | ✅ Design proven |
| TIMEOUT status | ✅ Structural fix proven |
| Consumer compatibility | 13 A + 3 B + 0 C + 0 D |
| Memory impact | +4.4KB net |
| Shadow-only status | TRUE |
| Invariants | 15/15 proven |
| Counterfactuals | 20/20 resolved |
| Code changes | 0 (design/proof only) |

**可以进入 STEP 2 (Producer Migration)。**
