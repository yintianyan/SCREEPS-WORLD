# UOEM STEP 1.1 — Type Model Foundation

> 日期：2026-08-26
> 阶段：STEP 1.1 纯类型定义（零 Runtime 行为变更）
> 状态：**COMPLETE**

---

## §1. 新增文件

| 文件 | 内容 | 行数 |
|---|---|---|
| `src/domain/expansion/uoem-types.ts` | UOEM 类型模型 + 纯函数 | 252 |
| `tests/unit/phase38/uoem-step1-types.test.ts` | TYPE-01~12 + Invariants + Determinism + Counterfactual | 380 |

## §2. 修改文件

**无。** 零 Runtime 文件修改。

## §3. Operation Identity

```typescript
type OperationId = string & { readonly __brand: "OperationId" };
```

- 在 Operation consume（tryConsumePlan）时铸造：`makeOperationId(target, consumeTick)` → `op:{target}:{consumeTick}`
- 写入 Memory，global reset 后仍然存在
- Operation 生命周期内不可改变
- 不从 target 单独推导
- 不从 startedAt 推导
- 不用 decisionId 代替

## §4. Decision Identity

```typescript
type DecisionId = string & { readonly __brand: "DecisionId" };
```

- 由 collectExpansionDecisions 分配：`D-{tick}-{seq}`
- 用于 Decision → Outcome attribution
- **decisionId ≠ operationId**（branded type 编译期阻止互相赋值）

## §5. Operation Interval

```typescript
interface OperationInterval {
  readonly openedAt: number;      // immutable
  readonly closedAt?: number;     // terminal 时设置
}
```

- `openedAt` = Operation 创建 tick（consume Plan 时铸造，永不修改）
- `closedAt` = terminal tick（只设置一次）
- `closeInterval(interval, closedAt)` 纯函数返回新对象，幂等
- `computeDuration(interval)` = `closedAt - openedAt`，未 closed 返回 `undefined`

## §6. MilestoneEvent

```typescript
interface MilestoneEvent {
  readonly kind: "milestone";
  readonly eventId: EventId;
  readonly operationId: OperationId;
  readonly decisionId?: DecisionId;
  readonly milestoneKind: MilestoneKind;  // "CLAIMED" | "FORCED_ADVANCE" | ...
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly state: string;
  readonly forcedAdvance: boolean;
  readonly correlation: EventCorrelation;
}
```

- **没有 outcomeCode 字段** — Milestone 不表达 terminal outcome
- **不进入 OutcomeChannel** — `OutcomeChannelEntry.event: OutcomeEvent` 类型阻止
- **不触发 terminal Experience resolution**
- milestoneKind ≠ terminalOutcomeCode（如 `FORCED_ADVANCE` ≠ `TIMED_OUT`）

## §7. OutcomeEvent

```typescript
interface OutcomeEvent {
  readonly kind: "outcome";
  readonly eventId: EventId;
  readonly operationId: OperationId;
  readonly decisionId?: DecisionId;
  readonly outcomeCode: TerminalOutcomeCode;  // 复用现有码表 0-4
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly interval: OperationInterval;
  readonly duration: number;
  readonly forcedAdvance: boolean;   // metadata，不是 outcome
  readonly correlation: EventCorrelation;
}
```

- **每 Operation 至多一个**（由 OutcomeChannel 幂等保证）
- `outcomeCode` 复用现有码表：SUCCESS=0, STOLEN=1, TIMED_OUT=2, LOST=3, ABANDONED=4
- `forcedAdvance` 是 metadata：`forcedAdvance=true` + `outcomeCode=SUCCESS` 合法

## §8. TerminalOutcome Code

```typescript
const TERMINAL_OUTCOME = {
  SUCCESS: 0, STOLEN: 1, TIMED_OUT: 2, LOST: 3, ABANDONED: 4,
} as const;
```

- **复用 expansion-manager.ts:66-72 现有常量**
- **不创造新 outcome code**
- **不修改 outcome.ts:337-342 的 classification 映射**（A6.1 domain 冻结契约）
- EXISTING_CODE_CONTRACT 记录

## §9. forcedAdvance Metadata

```
forcedAdvance = true  + outcomeCode = SUCCESS     → 合法（强推后成功）
forcedAdvance = true  + outcomeCode = TIMED_OUT   → 合法（强推后仍超时）
forcedAdvance = true  + kind = "milestone"         → 合法（强推 milestone）
forcedAdvance = true  → 不自动推导 outcomeCode = TIMED_OUT
forcedAdvance = true  → 不改变 terminality
```

## §10. Event Union

```typescript
type UOEMEvent = MilestoneEvent | OutcomeEvent;
```

Discriminated union on `kind`:
- `kind === "milestone"` → 无 terminal outcome
- `kind === "outcome"` → 有 terminal outcome

## §11. Terminal Semantics

```typescript
function isTerminalEvent(event: UOEMEvent): event is OutcomeEvent {
  return event.kind === "outcome";
}
```

- Terminality 来自 `event.kind`，**不是** `outcomeCode`
- `isTerminalEvent(milestone)` = `false`（无论 milestoneKind）
- `isTerminalEvent(outcome)` = `true`（无论 outcomeCode）

## §12. Duration

```typescript
function computeDuration(interval: OperationInterval): number | undefined {
  if (interval.closedAt === undefined) return undefined;
  return interval.closedAt - interval.openedAt;
}
```

- 基于 immutable `openedAt`，不读取 `expansion.startedAt`
- 未 closed 返回 `undefined`，不猜测

## §13. Idempotency

```typescript
function isDuplicateOutcome(existing: OutcomeIdentity, incoming: OutcomeIdentity): boolean {
  return existing.operationId === incoming.operationId;
}
```

- 去重 key = `operationId`（不是 target / startedAt / decisionId）
- `decisionId` 是 attribution identity
- `operationId` 是 lifecycle identity

## §14. Domain Invariants

| Invariant | 证明方式 |
|---|---|
| I-UOEM-01: Every OutcomeEvent is terminal | `isTerminalEvent(OutcomeEvent)` === true（kind 保证） |
| I-UOEM-02: No MilestoneEvent is terminal | `isTerminalEvent(MilestoneEvent)` === false（kind 保证） |
| I-UOEM-03: MilestoneEvent cannot enter OutcomeChannel | `OutcomeChannelEntry.event: OutcomeEvent`（编译期拒绝） |
| I-UOEM-04: OperationId ≠ DecisionId | branded type（编译期拒绝互相赋值） |
| I-UOEM-05: openedAt immutable | `readonly openedAt`（编译期拒绝赋值） |
| I-UOEM-06: Duration from OperationInterval | `computeDuration` 纯函数，不读 startedAt |
| I-UOEM-07: forcedAdvance ≠ terminality | milestone + forcedAdvance=true → isTerminalEvent=false |
| I-UOEM-08: outcomeCode ≠ event kind | terminality 来自 kind，MilestoneEvent 无 outcomeCode 字段 |

## §15. Type-Level Protections

| 保护 | 机制 |
|---|---|
| Milestone 不能进 Channel | `OutcomeChannelEntry.event: OutcomeEvent` |
| OperationId ≠ DecisionId | branded type `__brand` |
| openedAt 不可变 | `readonly` |
| Milestone 无 outcomeCode | 接口定义中无此字段 |
| Terminality 来自 kind | `isTerminalEvent` 检查 `kind`，不检查 `outcomeCode` |

## §16. 与六项问题的对应关系

| 问题 | STEP 1.1 提供的结构性保护 |
|---|---|
| EXP-1 | MilestoneEvent ≠ OutcomeEvent；Channel 只接受 OutcomeEvent；isTerminalEvent 检查 kind |
| EXP-2 | OperationId branded type；makeOperationId 确定性铸造；与 DecisionId 类型不兼容 |
| TMP-1 | OperationInterval.openedAt readonly；computeDuration 基于 interval 不基于 startedAt |
| A6-R | OutcomeEvent 表达单次 terminal result（不是 aggregate）；与 A6 domain 层无关 |
| A6-SL | occurredAt ≠ recordedAt 字段分离；EventCorrelation 明确 target 只是 business attribute |
| TIMEOUT | MilestoneKind ≠ TerminalOutcomeCode；forcedAdvance ≠ terminality；isTerminalEvent 检查 kind |

## §17. 质量门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ PASS (326 files / 4994 tests) |
| `npm run build` | ✅ PASS (dist/main.js created) |

## §18. Behavioral Changes

**NONE**

- 无 Runtime Producer 修改
- 无 Runtime Consumer 修改
- 无 A6 domain 修改
- 无 bootstrap 修改
- 无 rhythm ring 修改
- 系统运行行为与 STEP 1.1 前完全一致

## §19. 验收清单

- [x] OperationId / DecisionId 类型明确分离（branded type）
- [x] OperationInterval 建立（readonly openedAt + closedAt）
- [x] openedAt immutable（readonly + closeInterval 纯函数）
- [x] MilestoneEvent 建立（kind="milestone"，无 outcomeCode）
- [x] OutcomeEvent 建立（kind="outcome"，有 outcomeCode）
- [x] Milestone / Outcome discriminated union 建立（UOEMEvent on kind）
- [x] Terminality 不由 outcomeCode 推导（isTerminalEvent 检查 kind）
- [x] forcedAdvance 与 terminality 解耦（forcedAdvance 是 boolean metadata）
- [x] duration 不再依赖 mutable startedAt（computeDuration 基于 interval）
- [x] OutcomeChannel 类型只能接受 OutcomeEvent（OutcomeChannelEntry.event: OutcomeEvent）
- [x] target 不是 identity（EventCorrelation.target 只是 business attribute）
- [x] decisionId 不是 operation identity（branded type 隔离）
- [x] A6.1-A6.6 零修改
- [x] Runtime Producer 零修改
- [x] Runtime Consumer 零修改
- [x] bootstrap 零修改
- [x] typecheck PASS
- [x] full test PASS
- [x] build PASS
- [x] Behavioral Changes = NONE

## §20. A6 Frozen Contract Verification

| A6 子系统 | 修改？ | 理由 |
|---|---|---|
| A6.1 Experience (domain) | ❌ | outcome.ts / experience.ts 未修改 |
| A6.2 Prediction | ❌ | prediction/ 未修改 |
| A6.3 Prediction ring | ❌ | 未修改 |
| A6.4 Calibration | ❌ | calibration/ 未修改 |
| A6.5 Reliability | ❌ | reliability/ 未修改 |
| A6.6 Recommendation | ❌ | recommendation/ 未修改 |

## §21. Remaining Technical Debt

| 项 | 状态 | 说明 |
|---|---|---|
| A6-SL PairedObservation | DEFERRED_TO_STEP_2 | OutcomeEvent 已有 occurredAt/recordedAt 分离，但 producer 层的 before/after 采集尚未实现 |
| OutcomeChannel runtime | STEP 1.2 | 类型已定义（OutcomeChannelEntry），runtime 实现待下一步 |
| Operation Identity 接入 | STEP 1.3 | makeOperationId 已定义，expansion-manager.ts 接入待下一步 |
| Producer 迁移 | STEP 1.5 | P1-P9/A1/B1 映射已完成，代码迁移待下一步 |

---

## 最终裁决

**STEP 1.1 COMPLETE**

TypeScript 类型系统现在理解：
- Operation ≠ Decision
- Milestone ≠ Outcome
- Timeout ≠ Terminality
- RecordedAt ≠ OccurredAt

等待下一步批准。
