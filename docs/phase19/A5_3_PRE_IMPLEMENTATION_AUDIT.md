# A5.3 Pre-Implementation Audit — 军事真实调用链追踪

## 1. 审计目标

在编写任何 A5.3 代码之前，追踪当前军事系统的**真实调用链**，确认：
- 现有军事决策链路是什么
- 现有 WarPosture 是什么、如何授权进攻
- attacker.ts 是否自行决定进攻
- 是否存在多套 Operation / Posture / Target Selection 系统
- Spawn / Logistics / Recovery 的现有集成点
- A5.3 新模块应接入的位置

## 2. 当前军事调用链（真实代码追踪）

### 2.1 姿态评估链路

```
empire-strategy.ts (P1, interval=1)
  → 采集各房 RoomStrategyInput (colonyState, economyPressure, lastHostileAt, hasLiveThreat, rcl, storageEnergy)
  → evaluateEmpirePosture() [domain/strategy/posture.ts 纯函数]
  → Memory.kernel.strategy.posture = "develop" | "expand" | "fortify" | "war"
  → 同时写入 expansionAllowed, newRemoteOpsAllowed, warPressureTicks
```

**关键发现**：
- `EmpirePosture` 只有 4 档：`develop | expand | fortify | war`
- **没有** `DEFENSIVE | CONTAIN | LIMITED_OFFENSIVE | FULL_OFFENSIVE | CEASEFIRE` 这五档 WarPosture
- `war` 是唯一进攻授权姿态，但它是粗粒度的「是否开战」二进制
- A5.3 需要的 `WarPosture` 是**更细粒度的进攻级别**，不是替代 `EmpirePosture`，而是在 `war` 姿态下进一步细分

### 2.2 现有战争规划链路

```
war-planner.ts (P2, interval=CONFIG.war.interval)
  → 读取 Memory.kernel.strategy.posture
  → posture !== "war" → demobilize() (收摊)
  → posture === "war" → selectWarTarget(buildTargetInput())
    → buildTargetInput() 从 Game/Memory 采集候选房
    → selectWarTarget() [domain/war/planning.ts 纯函数]
      → 筛选: kind==="normal" + 有主非本人 + 情报新鲜 + 塔数<maxTowers + 未被占用 + 不在黑名单
      → 排序: 通勤距离最小
      → 输出: WarTarget { roomName, sponsor, towersSeen, distance }
  → Memory.kernel.warPlan = { targetRoom, sponsor, squadSize, since, towersSeen, phase, spawned }
  → 按 squadSize 向 sponsor 的 spawnQueue 提交 attacker + healer 请求
  → 波次集结: nextWavePhase(build/advance) 双阈值迟滞
  → 战损止损: isAttritionLost(spawned > squadSize × casualtyMultiplier) → demobilize
  → 核弹: shouldLaunchNuke() 威慑链
  → 收摊时: evaluateWarOutcome() 战后核验 → 黑名单
```

**关键发现**：
- `selectWarTarget()` 只按通勤距离排序，**不**考虑战略价值、地形、defense、intelConfidence
- 没有多候选评分、没有 RejectedAlternatives
- `WarPlanPhase` 只有 `build | advance`，没有完整 Operation Lifecycle
- `attacker.ts` **不**自行决定是否进攻 — 它被 war-planner 孵化，在 hold 钩子中读 `Memory.kernel.warPlan.phase` 来决定是否集结
- **没有** Capability Gap 分析、Force Requirement 推导、Economic Guard
- **没有** Intel Confidence 进入 War Planning
- **没有** DecisionTrace 集成（war-planner 不写 DecisionRecord）

### 2.3 远矿防御链路

```
remote-mining-manager.ts (P2, interval=10)
  → 采集 RemoteOperationState + EmpireContext + LogisticsContext + MilitaryContext
  → decideRemoteDefenseAction() [domain/defense/remote-defense.ts 纯函数]
    → evaluateRemoteExpectedValue() 计算净价值
    → 输出: CONTINUE / PAUSE / ESCORT / RETREAT / ABORT
    → ESCORT 时输出 escortDemand (不直接 spawn)
  → globalCache.remoteDefenseDecisions 写入决策
  → evaluateRemoteDemand 根据 threatUntil / remoteThreats 生成 remoteDefender 请求
```

**关键发现**：
- 远矿防御有**独立**的决策链（ThreatAssessment → RemoteDefenseDecision），**不**经过 WarPosture
- ESCORT 可以不经过 `war` 姿态执行 — 这是合理的（远矿护航不是进攻）
- 但 RETREAT 不会自动升级为 ATTACK — 正确
- A5.3 需要将 ESCORT 升级为 ESCORT Operation（统一到 Operation Model）

### 2.4 威胁评估链路（A5.1/A5.2 已实现）

```
room-state.ts (P0, interval=1)
  → 采集 HostileSnapshot + RoomContext + DefenseContext
  → assessThreat() [domain/defense/threat-assessment.ts 纯函数]
    → analyzeHostileBody() → evaluateCombatCapability() [domain/combat/capability.ts]
    → aggregateCombatCapability() → computeCombatPower()
    → inferThreatIntent() → 10 种意图推断
    → computeThreatScore() → 7 维评分
    → computeFactConfidence/computeCombatConfidence/...→ aggregateConfidence()
    → 输出: ThreatAssessment (level, score, confidence, multiConfidence, estimatedPower, enemyCombatPower, estimatedIntent, ...)
  → globalCache.threatAssessments 写入
```

**关键发现**：
- ThreatAssessment 已经包含完整的 7 维评分 + 多维度置信度
- CombatCapability / CombatPower 已有完整的 body 解析 + 聚合
- TerrainContext 已有地形特征分析
- PlayerIntel 已有情报记录 + 冲突检测 + 新鲜度衰减
- MultiDimensionalConfidence 已有 6 维置信度聚合
- 这些都是 A5.3 的**输入**，不需要重写

### 2.5 Spawn 链路

```
spawn-manager.ts (P0, interval=1)
  → evaluateDemand() [domain/spawn/demand.ts 纯函数]
    → 各角色需求评估 (harvester, hauler, defender, ...)
    → defender 由 threatCreeps 触发 (P1)
    → attacker/healer **不在** evaluateDemand 中 — war-planner 直接 submitRequest
  → submitRequest() [domain/spawn/queue.ts]
  → sortQueue() → trySpawn (唯一 spawnCreep 调用点)
```

**关键发现**：
- `attacker` / `healer` 的 spawn 请求由 `war-planner.ts` 直接提交到 sponsor 房的 `spawnQueue`
- 没有走 `evaluateDemand` 标准 demand 链路
- A5.3 的 `SpawnDemand` 应通过标准链路提交，但需求来源可以是 WarPlan
- **约束确认**: spawn-manager 是唯一 `spawnCreep` 调用者，A5.3 不得绕过

### 2.6 Logistics 链路

```
logistics-planner.ts (P1, interval=100)
  → planLogistics() [domain/logistics/planner.ts 纯函数]
    → 从 Supply Contracts + Deficits 派生 Transport Requests
    → 输出 TransportPlan
  → globalCache.logisticsPlan
```

**关键发现**：
- Logistics Planner 有完整的 Supply→Demand→Route→Plan 链路
- **没有**军事物流需求入口 — WarPlan 不能产生 Logistics Requirement
- A5.3 需要产出 `LogisticsRequirement`，但**不**自己执行运输

### 2.7 Recovery 链路

```
empire-health-system.ts (P1, interval=100)
  → evaluateEmpireHealth() → 失败传播 → prioritizeRecovery()
  → globalCache.recoveryActions

recovery-execution-system.ts (P1, interval=10)
  → 消费 recoveryActions → 翻译为 spawn/agenda/terminal/remote 指令
  → 追踪 Action Lifecycle (proposed→submitted→verifying→succeeded/failed)
```

**关键发现**：
- Recovery 有完整的 Action Lifecycle + Idempotency + Verification + Retry
- **没有**军事 Abort → Recovery Intent 的桥接
- A5.3 产出 RecoveryIntent，交给 A4.6 执行

### 2.8 DecisionTrace 链路

```
decision-trace-system.ts (P3, interval=100, post)
  → 采集各系统产出构建 DecisionRecord
  → collectEmpireHealthDecisions / collectLogisticsDecisions / collectRecoveryDecisions
    / collectSpawnDecisions / collectDefenseDecisions
  → pushRecord() 写入 Ring Buffer
```

**关键发现**：
- DecisionTrace 已有完整的基础设施
- 已采集 Defense 决策（ThreatAssessment + RemoteDefenseDecision）
- **没有**采集 War Plan 决策 — A5.3 需要新增 `collectWarPlanDecisions`

## 3. 现有架构违规检查

| 检查项 | 状态 | 说明 |
|---|---|---|
| Military 直接 Spawn | ⚠ 部分 | war-planner 直接 `submitRequest` 提交 attacker/healer，**不**经 evaluateDemand，但 submitRequest 本身是合法的 queue 写入 |
| Military 直接 Transport | ✅ 无 | war-planner 不调 logistics |
| Military 直接 Economy | ✅ 无 | war-planner 不调 economy |
| Military 直接 Recovery | ✅ 无 | war-planner 不调 recovery |
| attacker 自己决定 War | ✅ 无 | attacker 在 hold 钩子中读 warPlan，不自行决策 |
| 多套 Operation System | ❌ 存在 | 远矿有 RemoteDefenseDecision，战争有 WarPlan，两套独立决策 |
| 多套 WarPosture | ❌ 存在 | empire-strategy 有 posture，war-planner 内部有 phase(build/advance)，但都不是 WarPosture |
| 多套 Target Selection | ❌ 存在 | war/planning.ts 有 selectWarTarget（只按距离），remote-defense 有自己的决策 |
| CombatPower 唯一决策 | ✅ 无 | war-planner 不用 CombatPower 做决策 |
| ThreatLevel 唯一决策 | ✅ 无 | ThreatLevel 影响远矿决策和 defender spawn，但不直接控制 war |
| PlayerIntel 直接授权 Attack | ✅ 无 | PlayerIntel 只影响 ThreatAssessment 的 Confidence |
| bypass Economic Guard | ⚠ 存在 | war-planner 检查 `warMaxPressure`，但没有完整的 Economic Guard（energyReserve/spawnCapacity/replacementCapacity/logisticsCapacity/recoveryCapacity） |
| bypass Recovery | ✅ 无 | war 失败后 demobilize，但不交 Recovery Intent |

## 4. A5.3 接入点规划

### 4.1 新建文件

| 文件 | 职责 |
|---|---|
| `src/domain/military/operation.ts` | MilitaryOperation 类型 + Lifecycle + 状态转换纯函数 |
| `src/domain/military/war-posture.ts` | WarPosture 类型 + 评估纯函数（唯一进攻授权） |
| `src/domain/military/target-selection.ts` | 多目标评分 + 选择纯函数（替代 selectWarTarget） |
| `src/domain/military/force-requirement.ts` | 从 Operation 推导 RequiredCapability + CapabilityGap |
| `src/domain/military/war-cost.ts` | WarCost 估算纯函数 |
| `src/domain/military/economic-guard.ts` | 经济护栏纯函数 |
| `src/domain/military/risk-model.ts` | 风险评估纯函数 |
| `src/domain/military/operation-value.ts` | evaluateOperationValue() 纯函数 |
| `src/domain/military/war-planning.ts` | planMilitaryOperation() 核心规划纯函数 |
| `src/systems/war-planning-system.ts` | 系统层薄壳（低频调度） |

### 4.2 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/systems/war-planner.ts` | 改为消费 WarPlan（不再自己 selectWarTarget + submitRequest） |
| `src/systems/decision-trace-system.ts` | 新增 collectWarPlanDecisions |
| `src/bootstrap.ts` | 注册 war-planning-system |

### 4.3 不修改文件

| 文件 | 理由 |
|---|---|
| `src/domain/defense/threat-assessment.ts` | A5.3 消费其输出，不修改 |
| `src/domain/combat/capability.ts` | A5.3 消费其输出，不修改 |
| `src/domain/defense/remote-defense.ts` | A5.3 消费其输出，不修改 |
| `src/domain/defense/terrain-context.ts` | A5.3 消费其输出，不修改 |
| `src/domain/defense/player-intel.ts` | A5.3 消费其输出，不修改 |
| `src/domain/defense/confidence.ts` | A5.3 消费其输出，不修改 |
| `src/domain/strategy/posture.ts` | A5.3 消费 EmpirePosture，不修改 |
| `src/domain/strategy/empire-health.ts` | A5.3 消费 EmpireHealthResult，不修改 |
| `src/systems/spawn-manager.ts` | A5.3 通过 submitRequest 提交需求，不修改 spawn-manager |
| `src/domain/spawn/queue.ts` | A5.3 使用其 submitRequest API |
| `src/creeps/roles/attacker.ts` | A5.3 不实现 Tactical Combat（A5.4 范畴） |
| `src/creeps/roles/healer.ts` | 同上 |

## 5. 关键设计决策

### 5.1 WarPosture 与 EmpirePosture 的关系

- `EmpirePosture` (develop/expand/fortify/war) 是**战略层**姿态，控制全局
- `WarPosture` (DEFENSIVE/CONTAIN/LIMITED_OFFENSIVE/FULL_OFFENSIVE/CEASEFIRE) 是**军事层**姿态，只在 `war` 姿态下激活
- 当 `EmpirePosture !== "war"` 时，`WarPosture = CEASEFIRE`
- 当 `EmpirePosture === "war"` 时，`WarPosture` 由 WarPosture 评估函数决定

### 5.2 Operation 与 WarPlan 的关系

- `MilitaryOperation` 是**意图声明**（类型 + 目标 + 约束 + 生命周期）
- `WarPlan` 是 Operation 的**执行计划**（能力需求 + 能力差距 + 编队 + 物流 + spawn + 风险 + 价值）
- 一个 Operation 对应一个 WarPlan
- Operation 是「做什么」，WarPlan 是「怎么做」

### 5.3 与现有 war-planner 的迁移

- 现有 `war-planner.ts` 的 `selectWarTarget + decideSquadSize + isAttritionLost` 逻辑将被新的 WarPlanning 链路替代
- 现有 `attacker.ts` / `healer.ts` 角色不修改 — 它们仍读 `Memory.kernel.warPlan`（A5.3 兼容写入）
- 迁移路径：新 WarPlan 写入 Memory.kernel.warPlan（兼容格式），attacker/healer 无感知切换

## 6. 风险与约束

1. **不创建第二套 Operation System** — A5.3 的 Operation 是唯一的军事 Operation 模型
2. **不创建第二套 WarPosture** — A5.3 的 WarPosture 是唯一的进攻授权来源
3. **不创建第二套 Target Selection** — A5.3 的 TargetSelection 替代 selectWarTarget
4. **WarPlan 只产生 Plan** — 不执行 Game action
5. **所有执行走标准链路** — Spawn 走 submitRequest，Logistics 走 globalCache.logisticsPlan，Recovery 走 recoveryActions
6. **低频运行** — 10-100t，ACTIVE Operation 可更频繁重评估
7. **Memory TTL + GC** — WarPlan 不无限保存
8. **DecisionTrace 复用 A4.7** — 不建第二套 Trace

## 7. PASS / FAIL

**审计结论**: 可以开始 A5.3 实现。

现有架构不存在不可调和的冲突 — `war-planner.ts` 的现有逻辑可以被新的 WarPlanning 链路替代，attacker/healer 角色通过兼容的 Memory 格式无缝切换。远矿防御链路可以通过 ESCORT Operation 统一到 Operation Model。
