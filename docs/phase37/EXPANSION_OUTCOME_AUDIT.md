# Expansion Outcome Audit — TD-37-3 深度调查

> Phase 37 · 审计文档 3/5
> 日期: 2026-08-26
> 审计范围: collectExpansionOutcome 及全 A6 链路

---

## TD-37-3 裁决: **FIXED** (was: SHOULD_FIX)

---

## 1. 为什么 expansionOutcome 当前永远 undefined？

### 1.1 根因追踪

`collectExpansionOutcome()` 定义在 `src/domain/intelligence/outcome.ts` L330-356：

```typescript
function collectExpansionOutcome(input: OutcomeCollectionInput): OutcomeRecord | undefined {
  if (input.expansionOutcome === undefined) {
    return undefined;  // ← 这里永远命中
  }
  // ... 后续逻辑永远不会执行
}
```

**为什么 `input.expansionOutcome` 永远是 undefined？**

追踪调用链：

```
experience-collector-system.ts
  → collectPendingOutcomes() L199-237
    → buildOutcomeCollectionInput(exp, ctx, tick) L328-420
      → case "expansion": (L413-416)
        // 从 expansionDashboard 获取扩张状态
        // 扩张结果需要从事件日志或 colony dashboard 获取
        break;  // ← 这里没有设置 input.expansionOutcome！
```

**根因**（已修复）：`buildOutcomeCollectionInput` 的 `case "expansion"` 分支曾有注释但无实际代码。现已从 `Memory.kernel.expansionRhythm.ring` 注入 `input.expansionOutcome`。

### 1.2 第二层根因：Expansion 决策不进入 DecisionTrace

即使 `buildOutcomeCollectionInput` 实现了 expansion outcome 采集，**expansion 决策本身也不进入 DecisionTrace Ring Buffer**：

追踪 `decision-trace-system.ts` 的 `run()` 方法 L73-112：

```typescript
collectEmpireHealthDecisions(ctx, cache, tick);
collectLogisticsDecisions(ctx, cache, tick);
collectRecoveryDecisions(ctx, cache, tick);
collectSpawnDecisions(ctx, cache, tick);
collectDefenseDecisions(ctx, cache, tick);
collectWarPlanDecisions(ctx, cache, tick);
// ← 没有 collectExpansionDecisions！
```

**结论**（已修复）：`collectExpansionDecisions()` 现已实现（L880-986），expansion 决策进入 DecisionTrace Ring Buffer，Experience Collector 自动消费。

---

## 2. 这是设计遗漏、接口缺失还是调用链缺失？

**三者兼有，但主要是调用链缺失**：

| 层次 | 状态 | 分析 |
|------|------|------|
| 接口定义 | ✅ 已存在 | `OutcomeCollectionInput.expansionOutcome?: number` (L96), `AttributionInput` 有 expansion 专属字段 (L116-125) |
| Domain 纯函数 | ✅ 已存在 | `collectExpansionOutcome()` L330-356 逻辑完整（只是输入永远为空），`collectExpansionAttribution()` L669-760 逻辑完整 |
| System 层采集 | ✅ 已修复 | `buildOutcomeCollectionInput` case "expansion" 从 rhythm ring 注入 |
| Decision Trace 采集 | ✅ 已修复 | `collectExpansionDecisions()` 已实现（L880-986） |
| 事件日志 | ✅ 已存在 | `EventKind.ExpansionOutcome = 28` + `recordExpansionOutcome()` 在 expansion-manager 中被调用 |

**设计意图**是完整的：接口已定义、纯函数已实现、事件日志已在记录。但**采集链路**从 event-log 到 A6 的桥梁断了。

---

## 3. A3 当前已有的运行状态是否足够构造真实 Expansion Outcome？

**是。** 证据：

### 3.1 已有的运行时数据源

| 数据源 | 位置 | 包含的 Outcome 信息 |
|--------|------|---------------------|
| `EventKind.ExpansionOutcome` | event-log | `[phase, outcome, duration]` — phase(0=claim/1=pioneer), outcome(0=success/1=stolen/2=timeout/3=lost/4=aborted), duration(tick) |
| `Memory.kernel.expansionRhythm` | Memory | `ring[]` — 最近 N 次扩张结果的 ring buffer |
| `Memory.kernel.expansionBlacklist` | Memory | 失败目标 + 冷却到期 tick |
| `Memory.kernel.lastExpansionCompletedTick` | Memory | 最后一次成功扩张 tick |
| `Memory.kernel.expansionPausedUntil` | Memory | 连败暂停到期 tick |
| `globalCache.executionDashboard` | globalCache | 当前扩张状态、进度、checkpoint |

### 3.2 已有的纯函数

| 函数 | 位置 | 用途 |
|------|------|------|
| `recordExpansionOutcome()` | expansion-manager L717 | 记录事件 + 更新 rhythm ring |
| `evaluateExpansionRhythm()` | domain/expansion/rhythm.ts | 从 ring 产出 pause/multiplier/minSources |
| `toOutcomeKind()` | expansion-manager L767 | phase+outcome → ExpansionOutcomeKind |

### 3.3 结论

A3 的运行状态**完全足够**构造真实 Expansion Outcome。event-log 中已经有 `[phase, outcome, duration]` 三元组，只需要一个 system 层薄壳把它注入到 `OutcomeCollectionInput.expansionOutcome` 即可。

---

## 4. 最小正确采集点在哪里？

### 4.1 采集点设计

**采集点 1：DecisionTrace 采集 expansion 决策**

在 `decision-trace-system.ts` 中新增 `collectExpansionDecisions()`：
- 采集 `Memory.kernel.expansion` 的状态转换作为 DecisionRecord
- 采集 `Memory.kernel.expansionPlans` 中 `WAITING_EXECUTION → EXECUTING` 的转换
- DecisionCategory: `"EXPANSION"`（需扩展 DecisionCategory 枚举）

**采集点 2：Experience Collector 注入 expansion outcome**

在 `experience-collector-system.ts` 的 `buildOutcomeCollectionInput` case "expansion" 中：
- 从 `EventKind.ExpansionOutcome` 事件日志中读取最近的扩张结果
- 或从 `Memory.kernel.expansionRhythm.ring` 读取最近的结果
- 注入 `input.expansionOutcome` = `phase * 10 + outcome` 编码
- 注入 `input.expansionDuration`

### 4.2 为什么不直接从 Memory 读取？

AGENTS.md 规定 Domain 纯函数禁止引用 Game/Memory。但 system 层薄壳**可以**读 Memory 和 globalCache，然后注入到 OutcomeCollectionInput。这符合分层架构。

### 4.3 最小正确采集点

```typescript
// experience-collector-system.ts buildOutcomeCollectionInput case "expansion":
case "expansion": {
  // 从 expansionRhythm ring 读取最近的扩张结果
  const ring = Memory.kernel?.expansionRhythm?.ring ?? [];
  if (ring.length > 0) {
    const lastCode = ring[ring.length - 1]; // 0=success, 1=stolen, 2=timeout, 3=lost, 4=aborted
    // 编码: phase * 10 + outcome（与 collectExpansionOutcome 的解码逻辑对齐）
    // phase=1 (pioneer) 因为 outcome 只在 pioneer 阶段记录 success
    input.expansionOutcome = 10 + lastCode;
    input.expansionDuration = undefined; // ring 中不存储 duration，需从 event-log 获取
  }
  break;
}
```

**但注意**：这只是一个最小采集点。完整的 Outcome 需要更多信息（见 §7）。

---

## 5. Outcome 应该记录什么？

### 5.1 当前 collectExpansionOutcome 的输出

```typescript
{
  decisionId,
  decisionTick,
  measurementTick,
  delay,
  classification: SUCCESS | FAILURE | EXPIRED | UNKNOWN,
  metric: "expansionOutcome",
  value: expansionOutcome, // 编码值
  source: "expansionManager",
  stateAfterHash,
  stateDelta: {}, // ← 空！
}
```

### 5.2 缺失的关键信息

| 信息 | 当前 | 应有 | 重要性 |
|------|------|------|--------|
| finalState | 缺失 | completed/failed/aborted | 高 — 决定 SUCCESS/FAILURE |
| failureReason | 缺失 | stolen/timeout/lost/aborted | 高 — Attribution 依赖 |
| economicActivation | 缺失 | activated/notActivated | 高 — 判断"真正成功" |
| energyLoop | 缺失 | active/inactive | 中 |
| bootstrapCompletion | 缺失 | spawnBuilt/!spawnBuilt | 中 |
| roomIntegration | 缺失 | integrated/notIntegrated | 中 |
| empireIntegration | 缺失 | integrated/notIntegrated | 中 |
| threatContext | 缺失 | none/low/high/critical | 中 — Attribution 依赖 |
| externalFactors | 缺失 | 威胁/资源/CPU | 中 |
| evidenceIds | 缺失 | 关联事件 ID | 低 |

---

## 6. Outcome 完成标准定义

### 6.1 什么情况下记录 SUCCESS？

必须同时满足：
1. `expansion.state` 达到 `completed`
2. CP5 (Economic Activation + Empire Integration) 通过
3. `canHandover(integrationResult, econResult.activated)` 返回 true
4. `netFlow > 0`
5. `empireIntegrated === true`

**不允许**：仅因为 spawn 建成就标记 SUCCESS。

### 6.2 什么情况下记录 FAILURE？

满足以下之一：
1. `OUTCOME_STOLEN` — 目标被他人抢占
2. `OUTCOME_LOST` — 失守/失明/squad wiped
3. `OUTCOME_TIMEOUT` + 未满足强推条件
4. `OUTCOME_ABORTED` — 无可行锚点

### 6.3 什么情况下记录 INCONCLUSIVE？

满足以下之一：
1. `OUTCOME_TIMEOUT` + CP3 通过但未完成 → 强推 integrating（边界成功）
2. `OUTCOME_TIMEOUT` + netFlow > 0 + integrated → 强推 completed（边界成功）
3. global reset 导致状态丢失

**当前代码**：`collectExpansionOutcome` 没有 INCONCLUSIVE 分类。`OutcomeClassification` 类型中有 `UNKNOWN`，可用于 INCONCLUSIVE。

### 6.4 timeout/recycle 应如何记录？

| 情况 | 当前 | 应有 |
|------|------|------|
| bootstrap timeout + spawn 存在 → 强推 | recordExpansionOutcome(OUTCOME_TIMEOUT) | 应记录 INCONCLUSIVE（不是纯失败） |
| bootstrap timeout + 无 spawn → abort | recordExpansionOutcome(OUTCOME_TIMEOUT) | 应记录 FAILURE |
| economic_startup timeout + CP3 通过 → 强推 | 不记录 outcome | 应记录 INCONCLUSIVE |
| integrating timeout + net positive → completed | recordExpansionOutcome(OUTCOME_SUCCESS) | 应记录 SUCCESS（确实完成了） |
| integrating timeout + 不满足 → abort | recordExpansionOutcome(OUTCOME_TIMEOUT) | 应记录 FAILURE |

**已修复**：`advanceEconomicStartup` 的 timeout 强推路径现已补充 `recordExpansionOutcome()` 调用。

### 6.5 threat/interference 应如何记录？

当前 `recordExpansionOutcome` 只记录 `[phase, outcome, duration]`，不包含威胁上下文。

**应有**：在 Outcome 的 `threatContext` 字段中记录威胁等级。这需要 expansion-manager 在 abort 时额外传递威胁信息。

### 6.6 外部干扰如何进入 Attribution？

当前 `collectExpansionAttribution` (attribution.ts L669-760) 逻辑：
- 如果 `classification === "FAILURE"` 且 `threatLevelAfter === "HIGH/CRITICAL"` → `EXTERNAL_THREAT`
- 否则根据 duration 判断 TIMING 或 EXECUTION_QUALITY

**已修复**：`buildAttributionInput` 的 case "expansion" 现已补全全部字段（`expansionTargetRoom`, `expansionFinalColonyState`, `expansionRclAchieved`, `threatLevelAfter`, `posture`）。

---

## 7. Expansion Outcome Contract

### 7.1 最小正确语义

```typescript
interface ExpansionOutcomeRecord {
  // ── 标识 ──
  operationId: string;       // expansion planId
  expansionId: string;      // 从 planId 派生
  
  // ── 时间 ──
  startTick: number;         // expansion.startedAt
  endTick: number;           // 完成/终止 tick
  duration: number;          // endTick - startTick
  
  // ── 终态 ──
  finalState: "completed" | "failed" | "aborted" | "inconclusive";
  outcomeKind: "success" | "stolen" | "timeout" | "lost" | "aborted";
  failureReason?: string;
  
  // ── 关键里程碑 ──
  economicActivation: {
    achieved: boolean;
    netFlow: number;
    consecutivePositiveTicks: number;
  };
  energyLoop: {
    active: boolean;
    harvesterCount: number;
    haulerCount: number;
  };
  bootstrapCompletion: {
    spawnBuilt: boolean;
    spawnCanSpawn: boolean;
  };
  roomIntegration: {
    integrated: boolean;
    missingSystems: string[];
  };
  empireIntegration: {
    integrated: boolean;
    hasSnapshot: boolean;
    spawnManaged: boolean;
    defenseCovered: boolean;
  };
  
  // ── 上下文 ──
  threatContext: {
    level: "GREEN" | "YELLOW" | "RED";
    hostilesInRoom: number;
    squadWiped: boolean;
  };
  externalFactors: string[];  // ["economic_pressure", "cpu_tier_drop", ...]
  
  // ── 证据 ──
  evidenceIds: number[];     // event-log 事件 ID 列表
}
```

### 7.2 核心原则

> **Outcome 是对过去已经发生事件的事实记录。**
> 
> **Prediction / Evaluation 不得反向影响 Outcome。**

Outcome 只记录发生了什么，不判断"为什么"。因果归因是 Attribution 的职责。

---

## 8. Temporal Correctness 分析

### 8.1 是否会造成 temporal leakage？

**当前不会**——因为 Outcome 根本没有被采集（永远 undefined）。

**如果修复采集点**：需要确保 Outcome 在扩张结束后采集，而不是在扩张进行中采集。当前 `MEASUREMENT_DELAYS.expansion` 应设置为足够长（如扩张 timeout 的最大值）。

### 8.2 是否会造成 survivorship bias？

**当前不会**——因为没有数据。

**如果修复采集点**：需要确保同时记录成功和失败的 Outcome。当前 `recordExpansionOutcome` 在成功和失败时都被调用，rhythm ring 中包含所有结果。只要采集点读取 ring 的最后一条（而非只读成功的），就不会有 survivorship bias。

### 8.3 是否会污染 A6.1-A6.6？

| A6 层 | 当前污染风险 | 修复后风险 | 防护措施 |
|-------|-------------|-----------|----------|
| A6.1 Experience | 无（无数据） | 低 | Outcome 采集基于事实事件，不基于推断 |
| A6.2 Evaluation | 无（无数据） | 低 | 评估只消费有 Outcome 的 Experience，跳过无 Outcome 的 |
| A6.3 Prediction | 无（无数据） | 低 | Prediction 基于 TimeSeries，不直接消费 Outcome |
| A6.4 Calibration | 无（无数据） | 低 | Calibration 基于 Prediction vs Observation，不直接消费 Outcome |
| A6.5 Reliability | 无（无数据） | 低 | Reliability 基于校准结果，不直接消费 Outcome |
| A6.6 Recommendation | 无（无数据） | 低 | Recommendation 基于以上所有层，Shadow-Only |

---

## 9. 修复建议

### 9.1 最小修复方案

**不修改 A6.1-A6.6 冻结契约**，只补齐采集链路：

1. **decision-trace-system.ts**：新增 `collectExpansionDecisions()`，采集 expansion 状态转换作为 DecisionRecord
2. **experience-collector-system.ts**：在 `buildOutcomeCollectionInput` case "expansion" 中从 rhythm ring 读取最近的扩张结果
3. **experience-collector-system.ts**：在 `buildAttributionInput` case "expansion" 中补齐 `threatLevelAfter`、`expansionFinalColonyState`、`expansionRclAchieved`

### 9.2 修复约束

- ❌ 不新增 Decision Authority
- ❌ 不新增 Prediction
- ❌ 不新增 Recommendation
- ❌ 不修改 Shadow-Only
- ❌ 不修改 Strategy
- ❌ 不改变 Execution 行为
- ✅ 只补齐真实 Expansion Outcome 事实采集

### 9.3 测试要求

- unit test: `collectExpansionOutcome` 输入有值时返回正确的 OutcomeRecord
- integration test: expansion → event → rhythm ring → outcome → attribution 全链路
- E2E: 模拟扩张完成/失败/超时，验证 Outcome 被正确采集
- temporal correctness: 验证 Outcome 不在扩张进行中提前采集
- failure/inconclusive: 验证 timeout 强推路径也产生 Outcome
- A6 data-integrity regression: 验证有 Outcome 的 Experience 能流经 A6 全链路
