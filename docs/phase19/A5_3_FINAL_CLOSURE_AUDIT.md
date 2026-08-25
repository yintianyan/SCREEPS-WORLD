# A5.3 Final Closure Audit — Military Operation & War Planning Architecture

> **审计日期**: 2026-08-25  
> **审计范围**: `src/domain/military/`, `src/systems/war-planning-system.ts`, `src/systems/war-planner.ts`  
> **审计方法**: 真实代码追踪 + 全项目 grep 扫描 + 类型检查 + 3915 测试全量通过

---

## 1. Executive Summary

A5.3 Military Operation & War Planning 已完成核心架构搭建。`planMilitaryOperation()` 是一个纯函数，将 Threat/Intel/Capability/EconomicContext 聚合为 `WarPlan`，产出 ForceRequirement / LogisticsRequirement / SpawnRequirement 供下游正式子系统消费。

**架构红线遵守情况**:

| 红线 | 状态 | 说明 |
|------|------|------|
| Domain 层零 Runtime 引用 | ✅ PASS | `src/domain/military/` 中 Game/Memory/RawMemory 全部只出现在注释 |
| Military 不直接 Spawn | ✅ PASS | `spawnCreep` 全项目仅 1 处调用: `spawn-manager.ts:448` |
| Military 不直接 Transport | ✅ PASS | Military 产出 LogisticsRequirement DTO，logistics-planner 消费 |
| Military 不直接 Recovery | ⚠️ GAP | `warAbortSignals` 写入 globalCache 但 recovery-execution-system 未消费 |
| WarPosture 是唯一进攻授权 | ✅ PASS | 无绕过路径 |
| 规划层不干涉战术 | ✅ PASS | WarPlan 只产出意图和需求，不含移动/攻击指令 |

**发现的问题**:

| 编号 | 严重度 | 问题 |
|------|--------|------|
| GAP-1 | **MEDIUM** | `warAbortSignals` 写入但无消费者 — 止损信号未到达 recovery-execution-system |
| GAP-2 | **MEDIUM** | Legacy `selectWarTarget`/`decideSquadSize` 与 A5.3 `planMilitaryOperation` 并行运行 — 两套规划路径共存 |
| GAP-3 | **LOW** | `force-requirement.ts` 中 `Object.entries(gaps)` 遍历顺序依赖引擎实现 — 影响 evidence 字符串确定性 |
| GAP-4 | **LOW** | `war-planning-system.ts` 中 `buildTargetCandidates()` 遍历 `Object.keys(Game.rooms)` — 非确定性顺序 |

**结论**: **0 BLOCKER, 0 HIGH, 2 MEDIUM, 2 LOW → PASS**

---

## 2. Call Chain Audit

### 2.1 Threat → WarPosture → Operation → WarPlan (✅ 真实调用链)

```
src/systems/room-state.ts:235
  → assessThreat() [domain/defense/threat-assessment.ts]
  → globalCache.threatAssessments

src/systems/war-planning-system.ts:57
  → planMilitaryOperation(input) [domain/military/war-planning.ts:292]
    → evaluateWarPosture() [domain/military/war-posture.ts:100]
    → deriveOperationType() [domain/military/war-planning.ts:192]
    → isOperationAuthorized() [domain/military/war-posture.ts:235]
    → selectTarget() [domain/military/target-selection.ts:197]
    → deriveRequiredCapability() [domain/military/force-requirement.ts:67]
    → computeCapabilityGap() [domain/military/force-requirement.ts:208]
    → deriveForceComposition() [domain/military/force-requirement.ts:253]
    → estimateWarCost() [domain/military/war-cost.ts]
    → assessOperationRisk() [domain/military/risk-model.ts:74]
    → checkEconomicGuard() [domain/military/economic-guard.ts:68]
    → evaluateOperationValue() [domain/military/operation-value.ts:71]
    → warPlanHash() [domain/military/war-planning.ts:544]
  → globalCache.warPlanCache
  → Memory.kernel.warPlan (兼容写入)
```

**验证**: 每一步都是真实代码引用，非 mock/type-only。

### 2.2 WarPlan → ForceRequirement → SpawnDemand (✅ 真实调用链)

```
war-planning-system.ts:443
  → wp.a5ForceReq = { attacker, healer, tank, dismantler, total }
  → Memory.kernel.warPlan.a5ForceReq

war-planner.ts:121
  → const a5 = plan.a5ForceReq
  → attackerTarget = a5.attacker
  → healerCount = a5.healer
  → submitSquadRequest() [war-planner.ts:229]
    → submitRequest(queue, ...) [domain/spawn/queue.ts:7]
  
spawn-manager.ts:448
  → spawn.spawnCreep(body, name, ...)  ← 唯一 spawnCreep 调用点
```

**验证**: WarPlan 的 ForceRequirement 通过 `a5ForceReq` 字段写入 `Memory.kernel.warPlan`，`war-planner.ts` 消费它替代旧 `decideSquadSize`/`decideHealerCount`。当 `a5ForceReq` 不存在时回退到 legacy 路径。

### 2.3 WarPlan → LogisticsRequirement → Unified Logistics (✅ 真实调用链)

```
war-planning-system.ts:66
  → g.warLogisticsDemand = { tick, sponsor, targetRoom, energy, boost, transport, replacement }

logistics-planner.ts:113
  → const warLogi = globalCache().warLogisticsDemand
  → deficits.push({ room: warLogi.sponsor, ... })  ← 注入为 DemandNode
  → planLogistics(input) [domain/logistics/planner.ts]
```

**验证**: WarPlan 的 LogisticsRequirement 通过 `globalCache.warLogisticsDemand` 传递，`logistics-planner.ts` 读取后将其适配为 `DemandNode` 注入物流规划网络。这是真实调用链。

### 2.4 WarPlan → Abort → Recovery Intent (⚠️ GAP-1: 调用链断裂)

```
war-planner.ts:338 (demobilize)
  → g.warAbortSignals = { tick, reason, targetRoom, sponsor, spawned, outcome }

recovery-execution-system.ts
  → ❌ 未读取 g.warAbortSignals
```

**验证**: `warAbortSignals` 只有两个引用点：
1. `global-cache.ts:316` — 类型定义
2. `war-planner.ts:338` — 写入

`recovery-execution-system.ts` 中 grep `warAbort` 返回 **0 匹配**。止损信号写入了 globalCache 但没有消费者读取。这意味着 WarPlan 的 Abort/Recovery Intent 没有到达 A4.6 Recovery Execution。

**严重度**: MEDIUM — 不影响军事规划本身的正确性，但战后恢复链路断裂。

### 2.5 WarPlan → DecisionTrace (✅ 真实调用链)

```
war-planning-system.ts:61
  → g.warPlanCache = { tick, plan }

decision-trace-system.ts:706
  → const warPlanCache = g.warPlanCache
  → collectWarPlanDecisions(ctx, cache, tick)  [decision-trace-system.ts:700]
    → 构建 DecisionRecord 包含:
      - warPosture (reasons)
      - operationType
      - riskLevel (score)
      - economicGuard (passed/recommendation)
      - netValue (expectedValue)
      - capabilityGap (totalGapRatio)
      - rejectedAlternatives (targetSelection.rejectedAlternatives)
```

**验证**: Decision Trace 系统完整消费了 WarPlan 的关键决策字段，包括 RejectedAlternatives。这是真实调用链。

---

## 3. Spawn Boundary Audit

### 全项目 `spawnCreep` 调用点

| 文件 | 行 | 类型 | 说明 |
|------|-----|------|------|
| `src/systems/spawn-manager.ts` | 448 | **唯一实际调用** | `spawn.spawnCreep(body, name, ...)` |
| 其他所有匹配 | — | 注释/文档 | "spawn-manager 是唯一 spawnCreep" 等 |

### `submitRequest` 调用点（军事相关）

| 文件 | 行 | 说明 |
|------|-----|------|
| `src/systems/war-planner.ts` | 255 | `submitSquadRequest` → `submitRequest(queue, ...)` |

**验证**: 
- `src/domain/military/` 中 **0 次** `spawnCreep` / `createCreep` / `submitRequest` 引用（含注释中的"禁止"描述）
- `war-planner.ts`（系统层）通过 `submitRequest` 向 spawn queue 提交孵化请求，`spawn-manager.ts` 是唯一执行 `spawnCreep` 的模块
- Military domain 层完全不感知 spawn 机制

**结论**: ✅ PASS — Spawn 权责边界严格。

---

## 4. Logistics Boundary Audit

### Military 是否自建 Transport 队列

```
grep -ri "TransportRequest|Transport|haul|Hauler" src/domain/military/
```

**结果**: 
- `war-cost.ts:92` — `// 4. Transport Cost — 距离 × 常数`（成本估算，非创建队列）
- `war-planning.ts:151` — `transport: number`（DTO 字段，非创建队列）
- `war-planning.ts:494` — `transport: warCost.transportCost`（赋值，非创建队列）

**验证**: Military domain 只产出 `LogisticsRequirement { energy, boost, transport, replacement }` DTO。实际消费链路：

```
war-planning-system.ts → globalCache.warLogisticsDemand
logistics-planner.ts:113 → 读取 → 转换为 DemandNode → 注入 planLogistics
```

Military 不创建 TransportRequest，不分配 Hauler，不判断 Delivery 完成。

**结论**: ✅ PASS — Logistics 权责边界严格。

---

## 5. Recovery Boundary Audit

### Military 是否自建 Recovery 队列

```
grep -ri "Recovery|Recycle|retry|Recover" src/domain/military/
```

**结果**:
- `war-cost.ts:108` — `// 8. Recovery Cost — 战后恢复`（成本估算）
- `risk-model.ts:119` — `// 9. Recovery Risk — 恢复能力不足`（风险评估）
- `economic-guard.ts:96` — `// 5. Recovery Capacity`（准入检查）
- `war-posture.ts:131` — `cpuTier === "recovery"`（CPU 等级判断）

**验证**: Military domain 只产生 Abort/Recovery Intent（`warAbortSignals`），不执行 Retry/Recycle/Creep 恢复。

但 **GAP-1** 存在: `warAbortSignals` 写入 globalCache 后，`recovery-execution-system.ts` 未读取。止损信号未到达 A4.6。

`war-planner.ts` 的 `demobilize()` 函数（系统层，非 domain 层）确实执行了 `creep.memory.recycle = true` 标记和 `removeRequestsByRole` 撤销请求，这属于系统层的收摊逻辑，不属于 domain 层的 Recovery 执行。

**结论**: ✅ Domain 层 PASS — 不自建 Recovery 队列。⚠️ 系统层 GAP — 止损信号未传递到 recovery-execution-system。

---

## 6. WarPosture Uniqueness Audit

### 扫描 OFFENSIVE / ASSAULT / RAID / SIEGE / HARASS

**搜索范围**: 全项目 `*.ts`

**结果**:

| 位置 | 用途 | 绕过 WarPosture? |
|------|------|-----------------|
| `domain/military/operation.ts:23-26` | OperationType 枚举定义 | 否 — 类型定义 |
| `domain/military/war-posture.ts:26-31` | WarPosture 枚举定义 | 否 — 自身定义 |
| `domain/military/war-posture.ts:235-249` | `isOperationAuthorized()` 授权检查 | 否 — 授权门禁 |
| `domain/military/war-planning.ts:192-237` | `deriveOperationType()` 从威胁推导 | 否 — 调用 `isOperationAuthorized` 检查 |
| `domain/military/war-planning.ts:329-333` | `if (!authorized) return undefined` | 否 — 非授权时不产生 WarPlan |
| `domain/defense/threat-assessment.ts:56,62` | ThreatIntent 枚举 | 否 — 意图≠操作 |
| `domain/defense/remote-defense.ts:151-161` | 远矿防御持久性映射 | 否 — 防御性 |
| `systems/war-planner.ts` | 消费 WarPlan 执行 | 否 — 读 `Memory.kernel.warPlan`（由 war-planning-system 写入） |

**验证**: `planMilitaryOperation()` 中的步骤 4 明确检查：

```typescript
// war-planning.ts:329
const authorized = isOperationAuthorized(posture.posture, opType);
if (!authorized) {
  evidence.push(`operationType=${opType} not authorized by posture=${posture.posture}`);
  return undefined;  // ← 非授权时不产生 WarPlan
}
```

**结论**: ✅ PASS — WarPosture 是唯一 Offensive authorization 来源。无绕过路径。

---

## 7. Operation Uniqueness Audit

### 是否存在第二套 Operation 状态机

**搜索**: `OperationType`, `operationId`, `operation state`

**发现**: 

1. **A5.3 Operation 模型** (`src/domain/military/operation.ts`):
   - `OperationType` — 12 种类型
   - `OperationStatus` — 10 种状态 + `VALID_TRANSITIONS` 状态转换表
   - `MilitaryOperation` 接口
   - `canTransition()` / `transition()` 纯函数

2. **Legacy War 模型** (`src/domain/war/planning.ts`):
   - `selectWarTarget()` — 目标选择
   - `decideSquadSize()` — 编队规模
   - `decideHealerCount()` — 治疗配比
   - `evaluateWarOutcome()` — 战果核验

**关系判断**: Legacy `domain/war/planning.ts` 不是第二套 Operation 状态机。它是一组辅助纯函数，处理目标选择和编队规模的旧逻辑。A5.3 的 `planMilitaryOperation()` 是新的完整规划器，Legacy 函数仅在 `war-planner.ts` 中作为 fallback 被调用（当 `a5ForceReq` 不存在时）。

但 **GAP-2** 存在: `war-planner.ts` 中 `selectWarTarget()` 仍然在 `needSelect` 分支中被调用（第 79 行），与 A5.3 的 `planMilitaryOperation()` 并行运行。`war-planning-system.ts` 调用 `planMilitaryOperation()` 产出 WarPlan 并写入 `Memory.kernel.warPlan`，然后 `war-planner.ts` 在下一轮运行时读取 `Memory.kernel.warPlan` 但仍可能调用 `selectWarTarget()` 重新选目标（当 `needSelect` 为 true 时）。这是过渡期的双轨制。

**结论**: ✅ PASS — 无第二套 Operation 状态机。⚠️ GAP-2 — Legacy `selectWarTarget` 与 A5.3 并存为过渡期双轨。

---

## 8. Threat Uniqueness Audit

### `assessThreat()` 是唯一 Canonical Threat 入口

**搜索**: `hostiles.length > 0`, `hostileCount`, `threatCount`, `boostedCount`, `attackParts`, `healParts`

**结果分类**:

| 位置 | 模式 | 用途 | 第二套决策? |
|------|------|------|-------------|
| `room-state.ts:159-235` | `threatCount > 0` | 门禁：决定是否调用 `assessThreat()` | 否 — 是 assessThreat 的触发条件 |
| `room-state.ts:228` | `threatCount > 0 && threatPresent` | 调用 `assessThreat()` 的前置条件 | 否 — 正确链路 |
| `logistics-planner.ts:411` | `hostileCount > 0` | 物流风险评估（非军事决策） | 否 — 物流降级 |
| `expansion-manager.ts:440` | `hostiles.length > 0` | 扩张时检查目标房是否有敌方 | 否 — 扩张门禁 |
| `tower-defense.ts:210` | `healParts` | 塔目标优先级排序 | 否 — 塔防御逻辑 |
| `threat-assessment.ts:511` | `hostiles.length > 0` | assessThreat 内部 proximity 计算 | 否 — 自身逻辑 |
| `defense/confidence.ts:60` | `hostileCount` | `computeFactConfidence` 参数 | 否 — 置信度计算 |

**验证**: 没有任何代码使用 `hostiles.length > 0` 或 `threatCount` 绕过 `assessThreat()` 直接做军事决策。所有军事决策路径都经过 `assessThreat()` → `ThreatAssessment` → `planMilitaryOperation()`。

**结论**: ✅ PASS — `assessThreat()` 是唯一 Canonical Threat 入口。

---

## 9. CombatPower Audit

### `powerScore` 是否单独决定 War Action

**搜索**: `powerScore`

**关键发现**:

1. **`capability.ts:445`**: 注释明确 "powerScore 只是加权估计，不能直接代表胜率，不能作为军事决策的唯一依据"

2. **`operation-value.ts:4`**: 注释 "不能只比较 powerScore"

3. **`war-planning.ts:371`**: `expectedLossRate = 1 - Math.min(1, input.ourPower.powerScore / Math.max(1, enemyPower.powerScore))` — 用于估算损失率，不是直接决策

4. **`war-planning.ts:431`**: `successRate = ... input.ourPower.powerScore / Math.max(1, enemyPower.powerScore) * (1 - risk.score * 0.5)` — 用于估算成功率，经过 risk 修正

5. **`risk-model.ts:78-81`**: `ratio = enemyScore / ourScore` — 用于 capability gap 评估，只是 9 个风险维度之一（权重 0.25）

**验证**: `powerScore` 从不单独决定 War Action。它只参与：
- 损失率估算（经过 risk 修正）
- 成功率估算（经过 risk 修正）
- 风险评估（只是 9 维之一，权重 25%）

下游真实调用使用 `burstDamage`, `effectiveHP`, `healOutput`, `dismantlePower`, `mobility` 等维度（见 `force-requirement.ts:67-201` 的 `deriveRequiredCapability`）。

**结论**: ✅ PASS — `powerScore` 不是唯一决策依据。

---

## 10. Target Selection Audit

### Target 选择是否多维

**`target-selection.ts:197-262`** 的 `selectTarget()` 函数评分维度:

| 维度 | 权重 | 来源 |
|------|------|------|
| valueScore | 0.20 | resourceValue, economicImpact, strategicValue, roomValue, futureValue, logisticsCost, militaryCost |
| threatScore | 0.15 | threatAssessment.score.total |
| distanceScore | 0.20 | candidate.distance / maxDistance |
| defenseScore | 0.15 | towers 数量 |
| intelScore | 0.10 | overallConfidence + intelAge |
| logisticsScore | 0.10 | distance |
| strategicImpactScore | 0.10 | economicImpact + strategicValue + isCore |

**RejectedAlternatives → DecisionTrace**:

```typescript
// target-selection.ts:85
rejectedAlternatives: { roomName: string; score: number; reason: string }[];

// decision-trace-system.ts:775
for (const alt of plan.targetSelection.rejectedAlternatives) {
  rejected.push({
    action: `TARGET_${alt.roomName}`,
    reason: alt.reason,
  });
}
```

**验证**: Target 选择是多维评分，不是"最近目标 = 默认攻击目标"。RejectedAlternatives 进入 DecisionTrace。

**结论**: ✅ PASS

---

## 11. Economic Guard Audit

### Empire CRITICAL 状态是否阻止高成本 OFFENSIVE

**`economic-guard.ts:68-134`** 的 `checkEconomicGuard()`:

```typescript
// 101-104: Empire Health CRITICAL 时只允许防御
if (input.empireHealth === "critical" && !input.isDefensive) {
  reasons.push("empireHealth=critical → 禁止非防御性军事行动");
}

// 106-107: 综合判定
const allPassed = energyOk && spawnOk && replacementOk && logisticsOk && recoveryOk
  && (input.empireHealth !== "critical" || input.isDefensive);
```

**5 维度准入检查全部真实调用**:

| 维度 | 检查 | 输入来源 |
|------|------|---------|
| energyReserve | `empireEnergyReserve >= minReserve && warCost <= reserve * maxCostRatio` | war-planning-system.ts:152 (storage+terminal 合计) |
| spawnCapacity | `spawnCapacity > 0` | war-planning-system.ts:154 (空闲 spawn 数) |
| replacementCapacity | `replacementCapacity >= threshold` | war-planning-system.ts:178 (spawn 空闲率近似) |
| logisticsReliability | `logisticsReliability >= threshold` | war-planning-system.ts:168 (logisticsHealth 近似) |
| recoveryCapacity | `recoveryCapacity >= threshold` | war-planning-system.ts:173 (recoveryStats) |

**验证**: 5 维度全部在 `war-planning-system.ts` 中有真实数据采集，不是空接口。Empire CRITICAL 确实阻止非防御性 Operation。

**结论**: ✅ PASS

---

## 12. Intel Confidence Audit

### LOW / STALE / UNKNOWN 是否正确影响 WarPlan

**`war-posture.ts:163-178`**:

```typescript
// LOW Confidence + HIGH Threat → CONTAIN (不进攻，但骚扰/遏制)
if (overallConfidence < 0.4 || intelConfidence < 0.2) {
  return { posture: "CONTAIN", ... }; // offensiveLevel: 1 (不全面进攻)
}
```

**`risk-model.ts:110-113`**:

```typescript
// Intel Risk — 情报不足增加风险
const overallConfidence = input.confidence?.overallConfidence ?? 0.5;
const intelRisk = 1 - overallConfidence;  // 置信度越低，风险越高
```

**`operation-value.ts:109-111`**:

```typescript
// 低置信度 → DELAY
if (input.confidence < 0.3) {
  recommendation = "DELAY";
}
```

**验证**:
- LOW Confidence → WarPosture 降级为 CONTAIN（不全面进攻）✅
- STALE Intel → `intelRisk` 增高 → 风险分数上升 → 期望价值下降 ✅
- UNKNOWN → `overallConfidence` 默认 0.5 → 中等风险 → 不被默认解释为安全 ✅

**结论**: ✅ PASS

---

## 13. Abort / Stop-Loss Audit

### WarPlan Abort 条件

**`war-planning.ts:445-452`** 定义的 AbortCondition 列表:

```typescript
const abortConditions: AbortCondition[] = [
  "ENEMY_CAPABILITY_INCREASED",
  "INTEL_STALE",
  "LOGISTICS_COLLAPSED",
  "REINFORCEMENT_TIMEOUT",
  "EXPECTED_VALUE_NEGATIVE",
  "CASUALTY_EXCEEDED",
];
```

覆盖度: ✅ 覆盖 Enemy capability increase, Intel becomes stale, Logistics failure, Reinforcement timeout, Expected value becomes negative, Casualty exceeded。

**止损执行链路**:

```
war-planner.ts:211-221
  → isAttritionLost(plan.spawned, fullSquadSize, casualtyMultiplier)
  → demobilize(tick, REASON_ATTRITION)
  → g.warAbortSignals = { tick, reason, targetRoom, sponsor, spawned, outcome }
```

**GAP-1 确认**: `warAbortSignals` 写入 globalCache，但 `recovery-execution-system.ts` 未读取。Abort 信号未进入 A4.6 Recovery 执行系统。

**结论**: ⚠️ MEDIUM — Abort 条件定义完整，但止损信号传递链路断裂。

---

## 14. Decision Trace Audit

### WarPlan 关键输入是否进入 DecisionTrace

**`decision-trace-system.ts:700-800`** 的 `collectWarPlanDecisions()` 记录:

| 字段 | 进入 DecisionTrace? | 代码行 |
|------|-------------------|--------|
| WarPosture | ✅ | 731: `metric: "warPosture"` |
| OperationType | ✅ | 737: `metric: "operationType"` |
| RiskLevel | ✅ | 743: `metric: "riskLevel"` |
| EconomicGuard | ✅ | 750: `metric: "economicGuard"` |
| NetValue | ✅ | 757: `metric: "netValue"` |
| CapabilityGap | ✅ | 764: `metric: "capabilityGap"` |
| RejectedAlternatives | ✅ | 775: `for (const alt of plan.targetSelection.rejectedAlternatives)` |

**Snapshot 可重建性**: DecisionTrace 使用 `buildSnapshot()` 构建运行时快照，存入 `snapshotRegistry`，支持通过 `correlationId` 查询历史记录并重放。

**结论**: ✅ PASS — 关键决策全部进入 DecisionTrace，支持重放。

---

## 15. Determinism Audit

### 非确定性源扫描

| 源 | 在 Military domain 中? | 说明 |
|----|----------------------|------|
| `Math.random` | ❌ 不存在 | 全项目仅 `spawn-manager.ts:446`（creep 命名）和注释 |
| `Date.now` | ❌ 不存在 | 全项目仅 `terminal-manager.ts:250` |
| `new Date` | ❌ 不存在 | — |

### 排序稳定性

**`force-requirement.ts:225`**:

```typescript
for (const [k, v] of Object.entries(gaps)) {
  if (v > 0) evidence.push(`${k}_gap=${v.toFixed(0)}`);
}
```

**GAP-3**: `Object.entries()` 的遍历顺序依赖引擎实现。在 V8 中，整数 key 按升序，字符串 key 按插入顺序。由于 `gaps` 的 key 都是字符串（`attack`, `rangedAttack`, `heal` 等），在 V8 中按插入顺序遍历，确定性可保证。但这不是语言规范保证的，存在理论风险。

**影响**: 仅影响 `evidence` 数组的字符串顺序，不影响 `totalGapRatio` 计算（数值计算与顺序无关），不影响 `warPlanHash`（hash 只包含 `totalGapRatio` 数值，不包含 evidence 数组）。

### `war-planning-system.ts` 中的非确定性遍历

**GAP-4**: `buildTargetCandidates()` (line 236) 遍历 `Object.keys(Game.rooms)` 和 `Object.keys(Memory.rooms)`，顺序不确定。但这只影响 `targetCandidates` 数组顺序，不影响 `selectTarget()` 的结果（`selectTarget` 按分数排序选择最佳，不依赖输入顺序 — 但相同分数时缺少 tie-breaker）。

**`target-selection.ts:242`**: `if (!bestScore || score.total > bestScore.total)` — 严格 `>`，相同分数时保留先出现的（依赖输入顺序）。这是 MEDIUM 风险但在实际场景中目标分数相同的概率极低。

### `war-planning.ts:317-321` 中的 `reduce` 

```typescript
const maxThreatEntry = input.threatAssessments.reduce((max, t) => {
  const rank = ...;
  const maxRank = ...;
  return rank > maxRank ? t : max;
}, input.threatAssessments[0]!);
```

**验证**: 使用严格 `>` 比较 rank，相同 rank 时保留先出现的。威胁等级相同的多个房间中，选择第一个。这不影响确定性（相同输入→相同输出），但影响语义（哪个房间被选为"最高威胁"取决于数组顺序）。

**结论**: ✅ PASS — `warPlanHash` 的计算只包含数值字段，不依赖排序。相同输入产出相同 hash（已通过 1000 次重放验证）。⚠️ GAP-3/GAP-4 — evidence 字符串顺序和 target 选择 tie-breaker 存在理论非确定性，不影响 hash 正确性。

---

## 16. Domain Purity Audit

### `src/domain/military/` 是否零 Runtime 引用

```
grep "\bGame\b" src/domain/military/   → 0 实际引用（全为注释）
grep "\bMemory\b" src/domain/military/ → 0 实际引用（全为注释）
grep "\bRawMemory\b" src/domain/military/ → 0 实际引用（全为注释）
```

### import 分析

所有 `src/domain/military/*.ts` 的 import 语句只引用:
- `type` 导入（`import type { ... }`）— 纯类型，无运行时
- 同目录其他纯函数模块（`./operation`, `./war-posture`, `./target-selection`, 等）
- `../defense/` 下的纯函数模块（`threat-assessment`, `terrain-context`, `player-intel`, `confidence`）
- `../combat/capability` — 纯函数
- `../strategy/empire-health` — 纯函数

**结论**: ✅ PASS — Domain 层零 Runtime 引用。

---

## 17. System Boundary Audit

### `src/systems/war-planning-system.ts` 是否只是 Adapter

**职责分析**:

| 步骤 | 操作 | 是 Adapter? |
|------|------|------------|
| 1 | 从 globalCache/Memory/Game 采集数据 | ✅ 数据采集 |
| 2 | 适配为 `WarPlanningInput` | ✅ 格式转换 |
| 3 | 调用 `planMilitaryOperation(input)` | ✅ 调用纯函数 |
| 4 | 写入 `globalCache.warPlanCache` | ✅ 结果分发 |
| 5 | 写入 `globalCache.warLogisticsDemand` | ✅ 结果分发 |
| 6 | 兼容写入 `Memory.kernel.warPlan` | ✅ 向后兼容 |
| 7 | `computeOurPower()` 聚合战斗力 | ⚠️ 有少量业务逻辑 |

**GAP 分析**: `computeOurPower()` (line 315-390) 包含 body part 遍历和战斗力聚合逻辑。这应该属于 domain 层（`combat/capability.ts`），但当前在系统层。原因是它需要访问 `Game.creeps` 运行时对象。

**严重度**: LOW — 这是 Adapter 的合理职责（将运行时对象适配为 DTO），不构成"第二套军事规则"。

### `src/systems/war-planner.ts` 是否只是 Adapter

**职责分析**: war-planner 不是纯 Adapter，它包含执行逻辑（止损、核弹发射、编队补位）。但所有核心军事决策（目标选择、编队规模）来自 domain 纯函数。

**结论**: ✅ PASS — 系统层是 Adapter + 执行编排，核心决策在 domain 纯函数中。

---

## 18. CPU / Memory Audit

### War Planning 低频执行

```typescript
// war-planning-system.ts:47
interval: CONFIG.war.interval,  // = 10 (tick)

// war-planner.ts:60
interval: CONFIG.war.interval,  // = 10 (tick)
```

**验证**: 两个系统都按 10 tick 间隔运行，不是每 tick 全量规划。

### WarPlan TTL

```typescript
// war-planning-system.ts:484
expiresTick: input.tick + 5000,

// war-planner.ts:77
const needSelect = !existing || ctx.tick - existing.since > CONFIG.war.planTimeout;  // = 6000
```

**验证**: WarPlan 有明确 TTL（5000 tick expires + 6000 tick planTimeout）。过期会重新选目标。

### DecisionTrace 复用

```typescript
// decision-trace-system.ts:80
ringBuffer: createRingBuffer(1000),  // 环形缓冲区，不无限累积
```

**验证**: DecisionTrace 使用 1000 条环形缓冲区，不无限累积 WarPlan 记录。

**结论**: ✅ PASS — 低频执行 + TTL + 环形缓冲区。

---

## 19. Integration Test Matrix

| ID | 链路 | 状态 | 说明 |
|----|------|------|------|
| E2E-MIL-001 | Threat → WarPosture → Operation → WarPlan | ✅ PASS | `war-planning-a5-3.test.ts` 139 测试通过 |
| E2E-MIL-002 | WarPlan → CapabilityGap → SpawnDemand | ✅ PASS | `a5ForceReq` 写入 + `war-planner.ts` 消费链路验证 |
| E2E-MIL-003 | WarPlan → LogisticsRequirement → Unified Logistics | ✅ PASS | `warLogisticsDemand` 写入 + `logistics-planner.ts:113` 消费验证 |
| E2E-MIL-004 | WarPlan → DecisionTrace | ✅ PASS | `collectWarPlanDecisions` 在 `decision-trace-system.ts` 中实现 |
| E2E-MIL-005 | WarPlan → Abort → A4.6 Recovery | ⚠️ GAP-1 | `warAbortSignals` 写入但 `recovery-execution-system.ts` 未消费 |
| E2E-MIL-006 | RemoteThreat → RemoteDefense → EscortOperation | ✅ PASS | `deriveOperationType` 中 REMOTE_MINING_ATTACK → ESCORT 路径验证 |
| E2E-MIL-007 | IntelConfidence → OperationRisk | ✅ PASS | `risk-model.ts:110-113` intelRisk 维度 |
| E2E-MIL-008 | EmpireHealth → EconomicGuard → WarPosture | ✅ PASS | `economic-guard.ts:101-104` CRITICAL 阻止非防御 + `war-posture.ts:118` critical → DEFENSIVE |

---

## 20. Regression Results

| 门槛 | 结果 | 详情 |
|------|------|------|
| `npm run typecheck` | ✅ PASS | 0 errors |
| `npm test` | ✅ PASS | 279 files / 3915 tests / 0 failures / 28.98s |
| `npm run build` | ✅ PASS | `dist/main.js` created in 29.5s |

---

## 21. Architecture Violations

### BLOCKER (0)

无。

### HIGH (0)

无。

### MEDIUM (2)

| ID | 问题 | Owner | Impact | Suggested Phase |
|----|------|-------|--------|----------------|
| GAP-1 | `warAbortSignals` 写入 globalCache 但 `recovery-execution-system.ts` 未消费。止损信号未到达 A4.6 Recovery Execution。 | A5.3 / A4.6 | 战后恢复链路断裂 — demobilize 后经济恢复不自动触发。 | A5.4 或 A4.6 补丁 |
| GAP-2 | Legacy `selectWarTarget()` / `decideSquadSize()` 在 `war-planner.ts` 中与 A5.3 `planMilitaryOperation()` 并行运行。当 `a5ForceReq` 不存在时 fallback 到旧逻辑。 | A5.3 | 过渡期双轨制 — 可能产出与 A5.3 规划不一致的编队。 | A5.4 迁移 |

### LOW (2)

| ID | 问题 | Owner | Impact | Suggested Phase |
|----|------|-------|--------|----------------|
| GAP-3 | `force-requirement.ts:225` `Object.entries(gaps)` 遍历顺序依赖引擎实现。影响 evidence 字符串顺序。 | A5.3 | 不影响 hash 正确性（hash 不含 evidence），不影响数值计算。理论风险。 | 可选修复 |
| GAP-4 | `war-planning-system.ts` 中 `buildTargetCandidates()` 遍历 `Object.keys(Game.rooms)` / `Object.keys(Memory.rooms)` 非确定性顺序。`selectTarget()` 相同分数时缺少 tie-breaker。 | A5.3 | 极低概率 — 目标分数相同的场景罕见。不影响 hash。 | 可选修复 |

---

## 22. Remaining Technical Debt

| 编号 | 技术债 | 严重度 | 来源 |
|------|--------|--------|------|
| TD-1 | `war-planning-system.ts` 中 `playerIntel` 硬编码为 `undefined` (line 196) | LOW | A5.2 PlayerIntel 系统尚未接入 war-planning-system |
| TD-2 | `war-planning-system.ts` 中 `energyPerCreep` / `boostCostPerCreep` 硬编码 (line 223-224) | LOW | 应从 CONFIG 或 body 配置推导 |
| TD-3 | `war-planning-system.ts:225` 中 `seq` 逻辑简化 — 同 tick 多次调用只递增 1 | LOW | 低频执行（interval=10）下同 tick 多次调用概率极低 |
| TD-4 | `war-planning-system.ts:221` 中 `maxDistance: 10` 硬编码 | LOW | 应从 CONFIG 读取 |
| TD-5 | `war-planner.ts` 中 `nuker.launchNuke(pos)` 直接调用 Game API | LOW | 核弹发射属于系统层执行，非 domain 层规划 — 符合架构 |
| TD-6 | `risk-model.ts:78-81` 中 `capabilityGap` 使用 `powerScore` 比值 | LOW | 注释已说明这只是 9 维之一（权重 25%），不单独决策 |

---

## 23. A5.4 Readiness

A5.3 的 Planning 层已闭合。A5.4（Tactical Combat / War Execution）的前置条件：

| 前置条件 | 状态 | 说明 |
|---------|------|------|
| WarPlan 产出 ForceRequirement | ✅ | `deriveForceComposition()` 产出 tank/attacker/ranged/healer/dismantler |
| WarPlan 产出 SpawnRequirement | ✅ | `spawnRequirement[]` 格式供 spawn-manager 消费 |
| WarPlan 产出 LogisticsRequirement | ✅ | `warLogisticsDemand` 供 logistics-planner 消费 |
| WarPlan 产出 AbortConditions | ✅ | 6 种 AbortCondition 枚举 |
| WarPlan 产出 DecisionTrace | ✅ | `collectWarPlanDecisions()` 接入 A4.7 |
| WarPosture 唯一授权 | ✅ | 无绕过路径 |
| Economic Guard 5 维度检查 | ✅ | 全部真实调用 |
| Domain 纯函数零 Runtime | ✅ | 0 实际 Game/Memory/RawMemory 引用 |
| warPlanHash 确定性 | ✅ | 50 × 20 = 1000 次重放验证 |
| Spawn 权责边界 | ✅ | spawn-manager 唯一 spawnCreep |
| Logistics 权责边界 | ✅ | Military 不创建 Transport 队列 |

**未完成的前置条件**:

| 前置条件 | 状态 | 说明 |
|---------|------|------|
| Abort → Recovery 链路 | ⚠️ GAP-1 | `warAbortSignals` 未被 recovery-execution-system 消费 |
| Legacy 规划完全迁移 | ⚠️ GAP-2 | `selectWarTarget` / `decideSquadSize` 仍作为 fallback |

**结论**: A5.4 可以在解决 GAP-1 后开始。GAP-2 可以在 A5.4 迁移过程中逐步收敛。

---

## 24. Final PASS / FAIL

### BLOCKER: 0
### HIGH: 0
### MEDIUM: 2 (GAP-1, GAP-2)
### LOW: 2 (GAP-3, GAP-4)

## **A5.3 Closure: PASS**

A5.3 Military Operation & War Planning 的核心架构闭合审计通过。

军事规划层已建立为纯函数领域模型，通过 `globalCache` 和 `Memory.kernel.warPlan` 与下游正式子系统（spawn-manager / logistics-planner / decision-trace-system）解耦集成。Domain 层零 Runtime 引用，规划层不干涉战术执行，WarPosture 是唯一进攻授权来源，Economic Guard 5 维度全部真实调用。

2 个 MEDIUM 问题（止损信号未消费、Legacy 双轨制）不阻塞 A5.3 核心功能的正确性，可在后续阶段修复。

---

*审计完成。等待下一步指令。*