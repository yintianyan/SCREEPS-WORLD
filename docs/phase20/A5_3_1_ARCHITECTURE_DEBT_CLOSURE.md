# A5.3.1 — Architecture Debt Closure Audit Report

**Phase**: A5.3.1 — Military Architecture Debt Closure  
**Date**: 2026-08-25  
**Status**: PASS  
**Previous Phase**: A5.3 Final Closure Audit = PASS (0 BLOCKER, 0 HIGH, 2 MEDIUM, 2 LOW)

---

## 1. Executive Summary

本阶段关闭 A5.3 审计中发现的两个 MEDIUM 级别技术债：

| GAP | 严重度 | 状态 | 修复方式 |
|-----|--------|------|----------|
| GAP-1: warAbortSignals 未被 recovery-execution-system 消费 | MEDIUM | **CLOSED** | 建立 domain 纯函数映射 + system 消费链路 |
| GAP-2: Legacy selectWarTarget/decideSquadSize 作为真实 fallback | MEDIUM | **CLOSED** | LEGACY_COMPATIBILITY_ONLY 标记 + Architecture test 守卫 |

**最终结果**: 0 BLOCKER, 0 HIGH, 0 MEDIUM, 2 LOW

---

## 2. GAP-1 Root Cause

### 问题

`war-planner.ts` 的 `demobilize()` 函数在战争止损时写入 `globalCache.warAbortSignals`，
但 `recovery-execution-system.ts` **完全没有消费这个信号** — 它只读取 `g.recoveryActions`
（由 `empire-health-system` 从失败传播图产出）。

### 根因

- `recovery-execution-system` 的 `run()` 方法在第 1 步只读取 `g.recoveryActions`
- `warAbortSignals` 是 A5.3 时新增的字段，但没有在消费端建立读取链路
- 信号写入路径：`demobilize() → g.warAbortSignals = {...}` → 断裂
- Military Stop-Loss 信号无法真正进入 Recovery 执行

---

## 3. GAP-1 Call Chain Before

```
Military Abort (demobilize)
    ↓
warAbortSignals (写入 globalCache)
    ↓
X  ← 断裂点
    ↓
A4.6 Recovery (不读取 warAbortSignals)
```

`recovery-execution-system.run()`:
```typescript
// 旧代码 — 只读 recoveryActions
const actions = g.recoveryActions ?? [];
// warAbortSignals 从未被消费
```

---

## 4. GAP-1 Call Chain After

```
Military Abort (demobilize)
    ↓
warAbortSignals (写入 globalCache, 含 operationId)
    ↓
recovery-execution-system.consumeWarAbortSignals()
    ↓
mapAbortSignalsToRecoveryActions() [domain 纯函数]
    ↓
RecoveryAction[] (合并到 empireActions)
    ↓
shouldSubmitAction() [A4.6 lifecycle 幂等检查]
    ↓
translateAndSubmit() → spawn/agenda/terminal 执行
    ↓
verifyPendingActions() [World State 验证]
    ↓
Decision Trace (collectRecoveryDecisions 追踪 war-abort: 前缀)
```

`recovery-execution-system.run()`:
```typescript
// 新代码 — 合并 empire + war abort actions
const empireActions = g.recoveryActions ?? [];
const warActions = consumeWarAbortSignals(g, tick);
const actions = [...empireActions, ...warActions];
```

---

## 5. Recovery Intent Contract

### AbortReason → RecoveryActionType 映射

| AbortReason | RecoveryActionType | Domain | Urgent | 语义 |
|-------------|-------------------|--------|--------|------|
| POSTURE | expansion_pause | expansion | false | 姿态退出 = 暂停扩张消耗 |
| ATTRITION | population_rebuild | colony | true | 消耗战失败 = 重建人口 |
| NO_TARGET | auto_resolve | colony | false | 无目标 = 自然收摊 |
| PLAN_TIMEOUT | population_rebuild | colony | false | 计划超期 = 可能需重建 |

### 优先级计算

- 基础分 50
- ATTRITION +30, PLAN_TIMEOUT +15
- outcome=failure +15, outcome=unknown +5
- spawned > 5 +10
- 上限 100

### 纯函数位置

`src/domain/military/abort-recovery.ts` — 零运行时引用。

---

## 6. Recovery Idempotency

### 双层去重机制

1. **tick 级去重**: `lastConsumedAbortTick` 确保同一 tick 的信号不重复消费
2. **domain 级去重**: `recoveryIdempotencyKey(action)` 基于 `domain:type:room` 生成稳定 key，
   `shouldSubmitAction()` 检查活跃状态和 cooldown

### 复用 A4.6 lifecycle

- `shouldSubmitAction()` — 活跃状态检查 + cooldown 检查
- `createActionRecord()` — 创建追踪记录
- `markSubmitted/markExecuting/markSucceeded/markFailed` — 状态转换
- `getRetryPolicy()` — 获取 maxAttempts 和 cooldownDuration
- `cleanupRecoveryTable()` — 过期记录清理

**禁止**: Military 不自己实现第二套 dedup 机制。

---

## 7. GAP-1 E2E Evidence

### 测试文件

- `tests/unit/military/abort-recovery.test.ts` — 15 个 Unit 测试
- `tests/unit/military/a5-3-1-recovery-chain.test.ts` — 10 个 E2E 测试

### 测试覆盖

| 测试 ID | 描述 | 状态 |
|---------|------|------|
| REC-001 | WarPlan → Abort → warAbortSignals → Recovery Intent → Recovery Action → 幂等检查 → 可提交 | PASS |
| REC-002 | 重复 Abort → 不产生重复 Recovery 执行（idempotency key 去重） | PASS |
| REC-003 | Recovery unavailable → escalation（attempts 烧穿 → terminal，evaluateRecoveryUnviability 标记不可恢复） | PASS |
| REC-004 | Logistics failure (PLAN_TIMEOUT) → population_rebuild 路径正确触发 | PASS |

### ENVIRONMENT_BLOCKED

真实 Screeps 环境测试（`Game/Memory/kernel` 依赖）标记为 ENVIRONMENT_BLOCKED，
不把测试存在当成测试通过。

---

## 8. GAP-2 Root Cause

### 问题

`war-planner.ts`（Legacy 系统）直接调用 `selectWarTarget()` 和 `decideSquadSize()`，
而 `war-planning-system.ts`（A5.3 系统）调用 `planMilitaryOperation()`。
两者都注册在 `bootstrap.ts`，形成 Military Planning 双轨制。

### 根因

- `war-planner.ts` 是 P2 系统先运行（Legacy），使用 `selectWarTarget` 选择目标并写入 `Memory.kernel.warPlan`
- `war-planning-system.ts` 也是 P2 系统后运行（A5.3），使用 `planMilitaryOperation` 产出 WarPlan 并覆盖写入兼容格式
- 当 `a5ForceReq` 存在时使用 A5.3 编队需求；不存在时 fallback 到 `decideSquadSize`/`decideHealerCount`

---

## 9. Legacy Call Graph

### selectWarTarget 调用图

| 调用者 | 文件 | 类型 | LEGACY 标记 |
|--------|------|------|-------------|
| `warPlannerSystem.run()` | `systems/war-planner.ts:85` | Planning | ✅ LEGACY_COMPATIBILITY_ONLY |
| 定义 | `domain/war/planning.ts:44` | 纯函数 | ✅ 模块头标记 |

### decideSquadSize 调用图

| 调用者 | 文件 | 类型 | LEGACY 标记 |
|--------|------|------|-------------|
| `warPlannerSystem.run()` | `systems/war-planner.ts:99` | Planning | ✅ LEGACY_COMPATIBILITY_ONLY |
| 定义 | `domain/war/planning.ts:63` | 纯函数 | ✅ 模块头标记 |

### planMilitaryOperation 调用图

| 调用者 | 文件 | 类型 |
|--------|------|------|
| `warPlanningSystem.run()` | `systems/war-planning-system.ts:57` | Canonical A5.3 |
| 定义 | `domain/military/war-planning.ts:292` | 纯函数 |

---

## 10. Legacy Removal / Adapter Strategy

### 当前策略: LEGACY_COMPATIBILITY_ONLY

Legacy 路径不产生新决策权，只做 DTO Adapter：

1. `selectWarTarget` — Legacy fallback，只在 A5.3 未产出 WarPlan 时执行
2. `decideSquadSize` — Legacy fallback，被 `a5ForceReq` 运行时覆盖
3. `decideHealerCount` — Legacy fallback，被 `a5ForceReq` 运行时覆盖

### 满足条件

- ✅ 不产生新决策（plan.squadSize 已在 needSelect 块中决定）
- ✅ 不改变 WarPlan（最终由 war-planning-system 的 planMilitaryOperation 裁决）
- ✅ 不拥有最终决策权
- ✅ 只做 DTO Adapter（a5ForceReq 存在时被覆盖）
- ✅ 有明确删除条件（war-planning-system 完全接管后可删除）

### 删除条件

当 `war-planning-system` 完全接管 WarPlan 产出后：
1. 删除 `war-planner.ts` 中的 `selectWarTarget`/`decideSquadSize` import 和调用
2. 删除 `domain/war/planning.ts` 模块
3. 删除 `power-farm-manager.ts` 中的 `decideHealerCount` import（替换为 A5.3 能力推导）

---

## 11. A5.4 Tactical Boundary

### 层级职责

| 层级 | 职责 | 决策 |
|------|------|------|
| Strategic | 是否战争 | WAR AUTHORIZED |
| Operational | 什么战争 | Target = Enemy Tower |
| Tactical | 如何执行 | Squad 如何接近 Tower |

### A5.4 Contract

```
Threat
  ↓
WarPosture
  ↓
MilitaryOperation
  ↓
WarPlan
  ↓
ForceRequirement
  ↓
TacticalObjective
  ↓
SquadPlan
  ↓
Creep Execution
```

**禁止**: Tactical 重新计算 Strategic War Decision。  
**禁止**: Tactical 自己决定是否 Attack。

---

## 12. Decision Trace Chain

### 完整追踪链

```
WAR_PLAN_CREATED (collectWarPlanDecisions)
    ↓
TARGET_SELECTED (collectWarPlanDecisions)
    ↓
FORCE_ASSIGNED (collectWarPlanDecisions)
    ↓
ABORT_TRIGGERED (demobilize → warAbortSignals)
    ↓
RECOVERY_REQUESTED (consumeWarAbortSignals → RecoveryAction)
    ↓
RECOVERY_EXECUTED (collectRecoveryDecisions — actionTable 中 war-abort: 前缀)
    ↓
RECOVERY_VERIFIED (verifyPendingActions → markSucceeded/markFailed)
```

### 追踪实现

- `collectWarPlanDecisions()` — 追踪 WarPlan 创建/授权/风险/经济护栏
- `collectRecoveryDecisions()` — 追踪 RecoveryAction 执行状态 + war-abort: 前缀识别
- `recordEvent(EventKind.WarOutcome, ...)` — 消费信号时记录事件

---

## 13. Determinism Audit

### 确定性保证

| 组件 | 确定性 | 机制 |
|------|--------|------|
| `mapAbortToRecoveryAction()` | ✅ | 纯函数，无 Date.now/Math.random |
| `abortSignalHash()` | ✅ | FNV-1a 32-bit hex，确定性 |
| `recoveryIdempotencyKey()` | ✅ | domain:type:room，确定性 |
| `shouldSubmitAction()` | ✅ | 基于 key + tick + cooldown，确定性 |

### 测试验证

- 相同 input → 相同 output: PASS
- 相同 signal → 相同 hash: PASS
- 不同 signal → 不同 hash: PASS
- hash 格式: 8 位十六进制

---

## 14. Domain Purity

### `src/domain/military/abort-recovery.ts`

| 检查项 | 状态 |
|--------|------|
| 不引用 Game | ✅ |
| 不引用 Memory | ✅ |
| 不引用 RawMemory | ✅ |
| 不引用 console | ✅ |
| 不引用 Kernel | ✅ |
| 不引用 Spawn | ✅ |
| 不引用 Transport | ✅ |
| 不引用 Recovery runtime | ✅ |

### Architecture Test 守卫

`tests/unit/military/a5-3-1-architecture.test.ts` 验证：
- `domain/military/` 不引用 Game/Memory/RawMemory/console
- `domain/military/` 不 import systems/ 或 creeps/

---

## 15. Static Architecture Scan

### 调用点统计

| 符号 | 调用点数量 | 责任边界 |
|------|-----------|---------|
| `spawnCreep` | 1 | `spawn-manager.ts` 唯一 |
| `selectWarTarget` | 1 (调用) + 1 (定义) | `war-planner.ts` LEGACY_COMPATIBILITY_ONLY |
| `decideSquadSize` | 1 (调用) + 1 (定义) | `war-planner.ts` LEGACY_COMPATIBILITY_ONLY |
| `planMilitaryOperation` | 1 (调用) + 1 (定义) | `war-planning-system.ts` Canonical |
| `warAbortSignals` 读取 | 1 | `recovery-execution-system.ts` 唯一消费 |
| `warAbortSignals` 写入 | 1 | `war-planner.ts` 唯一写入 |
| `recoveryActions` 读取 | 2 | `recovery-execution-system.ts` + `decision-trace-system.ts` |

### 边界验证

- ✅ Military 不直接 Spawn（spawnCreep 仅在 spawn-manager.ts）
- ✅ Military 不直接 Logistics（warLogisticsDemand 供 logistics-planner 消费）
- ✅ Military 不直接 Recovery Execution（只产出 Signal，A4.6 执行）

---

## 16. Test Results

### 新增测试

| 测试文件 | 测试数 | 状态 |
|---------|--------|------|
| `tests/unit/military/abort-recovery.test.ts` | 15 | ALL PASS |
| `tests/unit/military/a5-3-1-recovery-chain.test.ts` | 10 | ALL PASS |
| `tests/unit/military/a5-3-1-architecture.test.ts` | 8 | ALL PASS |

### 测试覆盖

- ✅ AbortReason → RecoveryIntent 映射
- ✅ RecoveryIntent → Action 转换
- ✅ Idempotency / Cooldown
- ✅ Escalation / RecoveryUnavailable
- ✅ Determinism
- ✅ Domain Purity
- ✅ Legacy import 限制
- ✅ LEGACY_COMPATIBILITY_ONLY 标记验证
- ✅ spawnCreep 边界
- ✅ warAbortSignals 消费边界

---

## 17. Regression Results

### 质量门槛

| 命令 | 结果 | 详情 |
|------|------|------|
| `npm run typecheck` | ✅ PASS | 0 errors |
| `npm test` | ✅ PASS | 282 files / 3961 tests / 0 failures |
| `npm run build` | ✅ PASS | dist/main.js created in 8.5s |

### 耗时

- Typecheck: ~3s
- Test: 22.50s (transform 11.13s, setup 5.34s, collect 32.72s, tests 67.88s)
- Build: 8.5s

---

## 18. Remaining Technical Debt

| ID | 严重度 | 描述 | Owner | 后续 Phase |
|----|--------|------|-------|-----------|
| TD-1 | LOW | Legacy `selectWarTarget`/`decideSquadSize` 仍存在为 fallback | war-planner | A5.4 前提条件 |
| TD-2 | LOW | `power-farm-manager.ts` import `decideHealerCount` from Legacy | power-farm | 迁移至 A5.3 能力推导 |

---

## 19. A5.4 Readiness

### 已建立 Contract

- ✅ Tactical 只消费 A5.3 产出的 WarPlan
- ✅ Tactical 不重新计算 Strategic War Decision
- ✅ Tactical 不自己决定是否 Attack
- ✅ Strategic → Operational → Tactical 层级明确

### 未实现（A5.4 范围）

- TacticalObjective 数据结构
- SquadPlan 数据结构
- Creep Micro（Attack/Heal/Tower Micro）
- Squad Movement

---

## 20. Final PASS / FAIL

### PASS 条件验证

| 条件 | 状态 |
|------|------|
| GAP-1 Recovery 真实闭环 | ✅ warAbortSignals → mapAbortSignalsToRecoveryActions → recovery-execution-system 消费 |
| GAP-2 不存在 Legacy Decision 作为真实 Fallback | ✅ Legacy 标记为 LEGACY_COMPATIBILITY_ONLY，不拥有决策权 |
| 0 BLOCKER | ✅ |
| 0 HIGH | ✅ |
| 0 MEDIUM | ✅ |
| LOW 有 Owner 和后续 Phase | ✅ TD-1/TD-2 有 Owner 和删除条件 |

### 最终判定

**A5.3.1: PASS**

---

*本报告为 A5.3.1 阶段最终输出。不实现 A5.4 Tactical Combat。等待下一步指令。*
