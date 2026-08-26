# UOEM STEP 1.3 — Consumer Compatibility

**日期：** 2026-08-26  
**阶段：** Phase 38 — UOEM STEP 1.3  
**性质：** DESIGN / PROOF ONLY — 无代码修改

---

## 1. Consumer 调查范围

### 搜索的消费者接口

- `lastExpansionOutcome` 读取
- `expansionRhythm` 读取
- `expansionPausedUntil` 读取
- `lastExpansionCompletedTick` 读取
- `globalCache().executionDashboard` 读取
- `EventKind.ExpansionOutcome` 读取
- `Memory.kernel.expansion` 读取（非 expansion-manager 本身）

---

## 2. Consumer Matrix

### 2.1 直接 Consumer（读取 expansion outcome 数据）

| # | Consumer | 位置 | 读取内容 | 分类 | 说明 |
|---|---------|------|---------|------|------|
| C1 | experience-collector-system | `experience-collector-system.ts:422` | `lastExpansionOutcome` | **B** | 需要 Producer-side adaptation：UOEM 替代 lastExpansionOutcome 后，collector 需改读 OutcomeChannel.drain() |
| C2 | rhythm ring (via recordExpansionOutcome) | `expansion-manager.ts:743-758` | `Memory.kernel.expansionRhythm.ring` | **B** | 当前 rhythm ring 在 recordExpansionOutcome 内部写入。UOEM 迁移后，rhythm ring 消费 OutcomeChannel 的 terminal events |
| C3 | expansion-manager (cooldown) | `expansion-manager.ts:106-111` | `lastExpansionCompletedTick` | **A** | 不受影响：completedTick 逻辑独立于 outcome 模型 |
| C4 | expansion-manager (paused) | `expansion-manager.ts:101` | `expansionPausedUntil` | **A** | 不受影响：pausedUntil 逻辑独立 |
| C5 | expansion-manager (blacklist) | `expansion-manager.ts:804-809` | `expansionBlacklist` | **A** | 不受影响：blacklist 逻辑独立 |
| C6 | empire-strategy | 搜索 `expansionAllowed` | `strategy.expansionAllowed` | **A** | 不受影响：strategy 只读 posture，不读 outcome |
| C7 | war-planning-system | `war-planning-system.ts:172-174` | `recoveryStats` | **A** | 不受影响：war-planner 不读 expansion outcome |
| C8 | strategy-evaluation-system | `strategy-evaluation-system.ts:183,230` | `recoveryStats` | **A** | 不受影响：不读 expansion outcome |
| C9 | decision-trace-system | `decision-trace-system.ts:996-1001` | writes `expansion.decisionId` | **B** | 需要 Producer-side adaptation：UOEM 迁移后，decisionId 仍由 decision-trace 写入，但 operationId 由 UOEM 管理 |
| C10 | recovery-execution-system | `recovery-execution-system.ts:196` | writes `recoveryStats` | **A** | 不受影响：不读 expansion outcome |
| C11 | event-log (segment 2) | `event-log.ts` | reads `EventKind.ExpansionOutcome` events | **B** | UOEM 迁移后，event-log 的 ExpansionOutcome 事件可能需要从 OutcomeChannel 产出 |
| C12 | colony-dashboard | `colony-dashboard.ts` | reads expansion state | **A** | 不受影响：dashboard 读当前 state，不读 outcome |
| C13 | colony-failure | `colony-failure.ts` | reads expansion state | **A** | 不受影响 |
| C14 | expansion-cooldown | `expansion-cooldown.ts` | reads `lastExpansionCompletedTick` | **A** | 不受影响 |
| C15 | autonomy | `autonomy.ts` | reads expansion state | **A** | 不受影响 |
| C16 | stability-score | `stability-score.ts` | reads expansion state | **A** | 不受影响 |
| C17 | roi-tracker | `roi-tracker.ts` | reads expansion state | **A** | 不受影响 |
| C18 | colony-stability-dashboard | `colony-dashboard.ts` | reads expansion state | **A** | 不受影响 |

### 分类统计

| 分类 | 数量 | 说明 |
|------|------|------|
| A. 不受影响 | 13 | 不读 expansion outcome 数据，只读 state/cooldown/blacklist |
| B. 需要 Producer-side semantic adaptation | 3 | experience-collector, rhythm ring, event-log |
| C. 必须修改 Consumer | 0 | 无需直接修改 consumer |
| D. 架构冲突 | 0 | 无架构冲突 |

---

## 3. B 类 Consumer 详细分析

### C1: experience-collector-system

**当前行为：**
```typescript
// line 422:
const lastOutcome = g.lastExpansionOutcome;
// line 429-430:
const decisionIdMatch = lastOutcome?.decisionId === exp.decision.decisionId;
// line 435:
if (lastOutcome && (decisionIdMatch || fallbackMatch)) {
  input.expansionOutcome = phaseCode * 10 + lastOutcome.outcomeCode;
}
```

**问题：** `lastExpansionOutcome` 是 single-slot latest-wins，可能被 milestone 覆盖（EXP-1）。

**UOEM 迁移方案：**
```
Phase A (Shadow):
  - recordExpansionOutcome 仍写 lastExpansionOutcome
  - 同时写 OutcomeChannel.emit() (terminal only)
  - experience-collector 仍读 lastExpansionOutcome
  - 验证两者一致性

Phase B (Switch):
  - recordExpansionOutcome 不再写 lastExpansionOutcome
  - experience-collector 改读 OutcomeChannel.drain()
  - lastExpansionOutcome 标记 deprecated

Phase C (Cleanup):
  - 删除 lastExpansionOutcome
```

**Consumer 修改点：** `buildOutcomeCollectionInput` case "expansion"（line 413-455）
- 从 `g.lastExpansionOutcome` 改为 `OutcomeChannel.drain()` + operationId 匹配
- 不再需要 fallback 逻辑（operationId 是稳定的）

### C2: rhythm ring

**当前行为：**
```typescript
// recordExpansionOutcome line 739-758:
const kind = toOutcomeKind(phase, outcome);
if (!kind) return;
const ring = appendOutcome(Memory.kernel.expansionRhythm.ring, kind, ringSize);
Memory.kernel.expansionRhythm = { ring: ring.map(kindToCode), ... };
```

**问题：** P1 (claim SUCCESS) 不进 ring（`toOutcomeKind` 返回 undefined），但 P5 (timeout milestone) 进 ring。rhythm ring 当前混合了 milestone 和 terminal。

**UOEM 迁移方案：**
- rhythm ring 只应消费 terminal OutcomeEvent
- MilestoneEvent 不进 rhythm ring
- P5 (timeout milestone) 不应进 rhythm ring——当前行为是 **bug**（P5 不是 terminal 但进了 ring）

**迁移后：**
```
OutcomeChannel.drain() → terminal events only → rhythm ring
```

### C11: event-log (segment 2)

**当前行为：**
```typescript
// recordExpansionOutcome line 721:
recordEvent(EventKind.ExpansionOutcome, expansion.target, [phase, outcome, duration]);
// bootstrap abandon line 895:
recordEvent(EventKind.ExpansionOutcome, d.room, [1, 4, 0]);
```

**问题：** event-log 的 ExpansionOutcome 事件混合了 milestone 和 terminal。

**UOEM 迁移方案：**
- MilestoneEvent → `recordEvent(EventKind.ExpansionMilestone, ...)` (新 kind)
- OutcomeEvent → `recordEvent(EventKind.ExpansionOutcome, ...)` (保持)
- 或者：UOEM OutcomeChannel 替代 event-log 的 expansion outcome 记录

---

## 4. Consumer 修改风险评估

| Consumer | 修改风险 | 说明 |
|---------|---------|------|
| experience-collector | **Medium** | 需要改读 OutcomeChannel，但 operationId 匹配比 decisionId 更可靠 |
| rhythm ring | **Low** | 只需从 OutcomeChannel 取 terminal events，逻辑简化 |
| event-log | **Low** | 可以保持现有 recordEvent，UOEM 在上层做分类 |

**结论：** 3 个 B 类 consumer 都可以通过 Producer-side adaptation 完成，不需要直接修改 Consumer 代码（Phase A 阶段）。Phase B 阶段需要修改 experience-collector 的读取逻辑。

---

## 5. 不受影响的 Consumer 证明

### C3-C5: expansion-manager 自身（cooldown, paused, blacklist）

这些读取 `lastExpansionCompletedTick`、`expansionPausedUntil`、`expansionBlacklist`，与 outcome 模型无关。UOEM 不修改这些字段。

### C6-C8: strategy/war/recovery systems

这些读取 `recoveryStats`、`strategy.expansionAllowed`，不读 expansion outcome 数据。

### C12-C18: colony evaluation systems

这些读取 `Memory.kernel.expansion` 的当前 state（`state`, `target`, `checkpointsPassed`），不读 outcome 数据。

**结论：** 13 个 A 类 consumer 完全不受 UOEM 迁移影响。 ✅
