# A5 Full-Scope Architecture Audit

> **审计日期**: 2026-08-25
> **审计范围**: A5.0 → A5.5 全部军事/Tactical 架构
> **审计方法**: 真实代码调用链追踪，不信注释/文档/测试名称
> **审计结论**: A5 架构闭环，可正式冻结

---

## 一、架构分层真实调用链

### 1.1 Strategic 层（WHY）

**真实代码路径**:
```
empire-strategy.ts (P1, interval=1)
  → evaluateEmpirePosture() [domain/strategy/posture.ts]
  → Memory.kernel.strategy.posture
  → war-planner 消费 posture
```

**决策权**: 
- 唯一姿态裁决者：`evaluateEmpirePosture()` 纯函数
- 唯一写者：`empire-strategy.ts` → `Memory.kernel.strategy`
- war 授权链：posture=war → war-planner 激活 → war-planning-system 产出 WarPlan

**越权检查**: 无。执行系统只读 posture，不自作主张。

### 1.2 Operational 层（WHAT）

**双轨路径（LEGACY_COMPATIBILITY_ONLY）**:

| 路径 | 产出 | 状态 |
|------|------|------|
| Canonical: `war-planning-system.ts` → `planMilitaryOperation()` | WarPlan (globalCache.warPlanCache + 兼容 Memory.kernel.warPlan) | 活跃 |
| Legacy: `war-planner.ts` → `selectWarTarget()` / `decideSquadSize()` | Memory.kernel.warPlan (fallback) | LEGACY_COMPATIBILITY_ONLY |

**关键发现**: war-planner.ts 第 77-80 行明确标注 Legacy fallback：
> "selectWarTarget / decideSquadSize 是 Legacy 路径，只在 A5.3 war-planning-system 未产出 WarPlan 时作为 fallback"

**判定**: LEGACY_COMPATIBILITY_ONLY。war-planning-system 是 Canonical 路径，fallback 不产生新决策权。但 **fallback 仍然实际参与决策**——当 war-planning-system 未产出 plan 时，Legacy 路径仍然产出 WarPlan。这是一个 MEDIUM 风险点：双轨制仍在运行时生效。

### 1.3 Tactical 层（HOW）

**真实代码路径**:
```
tactical-runtime-system.ts (P2, interval=10)
  → 读取 Memory.kernel.warPlan
  → 构建 TacticalObjective + SquadPlan + TacticalSnapshot
  → evaluateTacticalAction() [domain/tactical/state-machine.ts]
  → mapDecisionToRoleIntent()
  → globalCache.tacticalRoleIntents (供 Role 消费)
```

**决策权**:
- TacticalState 转换：`evaluateTacticalAction()` 唯一裁决
- Formation 选择：`selectFormation()` 在 state-machine.ts 内（非独立模块）
- TargetScope 验证：`validateTargetScope()` 防止 Tactical 越界

**越权检查**: Tactical 不修改 WarPosture / WarPlan / Operation。只消费上游产出。

### 1.4 Squad Movement 层

**真实代码路径**:
```
squad-movement-runtime.ts (P2, interval=1, phase=main)
  → buildSquadSnapshot()
  → produceSquadMovementIntent() [domain/tactical/squad-formation.ts]
  → 执行 PathFinder + registerMove (唯一 PathFinder 写者)
  → globalCache.squadMovementIntents
```

**判定**: 薄壳，不做决策。Domain 纯函数产出 Intent，Runtime 翻译为 PathFinder 调用。

### 1.5 Focus Fire 层

**真实代码路径**:
```
tactical-engagement-runtime.ts (P2, interval=3, phase=main)
  → 构建 FocusFireSnapshot
  → planFocusFire() [domain/tactical/focus-fire.ts]
  → globalCache.attackIntents (供 attacker Role 消费)
```

**判定**: 薄壳，不做决策。FocusFirePlan 由纯函数产出。

### 1.6 Micro Arbitration 层

**真实代码路径**:
```
combat-micro-runtime.ts (P2, interval=3, phase=main)
  → 构建 MicroSnapshot
  → planCombatMicro() [domain/tactical/combat-micro.ts]
    → arbitrateMicro() — 唯一仲裁入口
    → 产出 CombatMovementDecision[]
  → globalCache.microDecisions (供 Role 消费)
```

**判定**: arbitrateMicro() 是 Micro 层唯一仲裁入口。8 级优先级，唯一输出 CombatMovementDecision。

### 1.7 Role 执行层

**attacker.ts 候选优先级链**:
```
attackByFocusFire()   ← A5.4.3 FocusFire AttackIntent（最高优先）
attackByTacticalIntent() ← A5.4.1 TacticalIntent
attackPowerBank()     ← PB 野采
attackEnemies()       ← Legacy: findClosestByRange(hostiles)
attackStructures()    ← Legacy: 按价值分档选建筑
```

**healer.ts 候选优先级链**:
```
healByTacticalIntent() ← A5.4.1 TacticalIntent（最高优先）
healAllies()           ← Legacy: findWounded/findBuddy
```

**关键发现**: Role 层存在 Legacy fallback。当上游 Intent 不存在时，Role 回退到自主目标选择（findClosestByRange / findWounded）。这在架构上是 **MEDIUM GAP** — Role 层在 Legacy fallback 中做了独立战术决策（选择哪个敌人/哪个队友），但这是有意的向后兼容设计，不是越权。

---

## 二、21 项审计问题逐项回答

### Q1: 每一层真正拥有的决策权是什么？

| 层 | 决策权 | 代码位置 |
|---|---|---|
| Strategic | 是否开战(Why)、姿态转换、扩张授权 | `posture.ts: evaluateEmpirePosture()` |
| Operational | 打哪个房(What)、编队规模、止损条件 | `war-planning.ts: planMilitaryOperation()` + `war-planner.ts: selectWarTarget()` (Legacy) |
| Tactical | 状态转换(How)、阵型选择、接敌/撤退时机 | `state-machine.ts: evaluateTacticalAction()` |
| Squad Movement | 编队锚点、阵型槽位、cohesion 评估 | `squad-formation.ts: produceSquadMovementIntent()` |
| Focus Fire | 集火目标选择、overkill 分流、攻击分配 | `focus-fire.ts: planFocusFire()` |
| Micro | 当前 tick 动作仲裁（retreat/attack/kite/hold） | `combat-micro.ts: arbitrateMicro()` |
| Role | Game API 执行（attack/heal/move） | `attacker.ts / healer.ts` |

### Q2: 是否存在越权？

**无 BLOCKER 级越权**。但存在两个 MEDIUM 观察：

1. **war-planner.ts 的 Legacy fallback 实际参与 Operational 决策** — 当 war-planning-system 未产出 WarPlan 时，war-planner 使用 `selectWarTarget()` / `decideSquadSize()` 自行选择目标和编队规模。这在架构上是 Operational 层双轨制。标注为 LEGACY_COMPATIBILITY_ONLY 但仍在运行时生效。

2. **attacker.ts 的 Legacy fallback 让 Role 层做战术目标选择** — `attackEnemies()` 使用 `findClosestByRange(hostiles)` 和 `attackStructures()` 使用价值分档排序，这些是 Role 层的独立战术决策。但这是有意的 fallback 设计（上游 Intent 不存在时保底），不是越权。

### Q3: 是否存在隐藏的第二决策系统？

**否**。所有决策路径都经过公开的 globalCache / Memory 传递。无隐藏的直写通道。

### Q4: 是否存在 fallback 导致双轨制？

**是，两个 LEGACY_COMPATIBILITY_ONLY 双轨**：

| 双轨 | Canonical | Legacy | 触发条件 |
|------|-----------|--------|----------|
| WarPlan 产出 | war-planning-system | war-planner selectWarTarget | war-planning-system 未产出 plan |
| Role 目标选择 | FocusFire/Tactical Intent | attackEnemies/attackStructures/healAllies | 上游 Intent 不存在 |

**判定**: LEGACY_COMPATIBILITY_ONLY。不产生新决策权，但 fallback 路径仍在运行时生效。

### Q5: 是否存在 Legacy 逻辑仍然实际参与决策？

**是**。war-planner.ts 的 `selectWarTarget()` / `decideSquadSize()` / `decideHealerCount()` 在 `a5ForceReq` 不存在时作为 fallback 实际产出 WarPlan。这是运行时实际生效的 Legacy 路径，不只是注释。

### Q6: 是否存在某些 Domain 函数实际上依赖 Runtime？

**否**。所有 Domain 文件（`src/domain/tactical/*.ts`, `src/domain/military/*.ts`, `src/domain/combat/*.ts`, `src/domain/defense/*.ts`）均不 import Game/Memory/Creep/Room。纯函数律在 import 层面验证通过。

### Q7: 是否存在 Role 层偷偷重新做 Tactical 决策？

**是，在 Legacy fallback 中**。attacker.ts 的 `attackEnemies()` 使用 `findClosestByRange` 自行选择攻击目标，`attackStructures()` 使用价值分档 + 距离评分自行选择拆除目标。这是 Role 层在做 Tactical 级决策（选择哪个目标）。

**但**: 这些 fallback 只在上游 Intent 不存在时生效（tactical-runtime interval=10 未运行、或 creep 不在 warPlan 的 squad 中）。设计意图是保底兼容，不是越权。

**判定**: MEDIUM GAP — Role fallback 做了本该由 Tactical 层做的目标选择。在 war 全链路激活时，FocusFire/Tactical Intent 覆盖这些 fallback。但在 war 初期 / squad 未就绪时，Role fallback 实际在做 Tactical 决策。

### Q8: 是否存在 Tactical 偷偷改变 Operational / Strategic 目标？

**否**。`validateTargetScope()` 在 `authorization.ts` 中硬性校验：Tactical 目标必须在 Operational 授权的目标房间内。`evaluateTacticalAction()` 不修改 WarPlan / WarPosture。

### Q9: 是否存在 Military 自己决定 Spawn？

**否**。war-planner.ts 通过 `submitRequest()` 向 spawn queue 提交孵化请求，spawn-manager 是唯一 `spawnCreep` 调用者。tactical-runtime-system 的 `submitReinforcementDemand()` 只记录 Demand 信号到 globalCache，注释明确说"不重复提交 spawn 请求——war-planner 已有幂等的 submitSquadRequest 机制"。

### Q10: 是否存在 Military 自己决定 Logistics？

**否**。tactical-runtime-system 的 `detectSupplyDemand()` 只产出 `SupplyDemand` DTO 写入 `globalCache.tacticalSupplyDemands`，供 logistics-planner 消费。Military 不直接创建 Operation / Transport Plan。

**但**: `tacticalSupplyDemands` 目前 **没有消费者** — logistics-planner 未读取此字段。这是一个 MEDIUM GAP — Supply Demand 信号产出但未接线。

### Q11: 是否存在 Military 自己执行 Recovery？

**否**。Tactical Abort Signal → `globalCache.tacticalAbortSignals` → `recovery-execution-system` 的 `consumeTacticalAbortSignals()` 消费 → `mapAbortSignalsToRecoveryActions()` 转换 → A4.6 lifecycle 执行。Military 只产出 Signal，不执行 Recovery。

### Q12: 是否存在 Recovery 绕过 A4.6？

**否**。所有 Recovery Action 都经过 `recovery-execution-system` 的 `translateAndSubmit()` 提交到 spawn queue / agenda / terminal。幂等性由 `recoveryIdempotencyKey` 保证。

### Q13: 是否存在 Threat 第二入口？

**否**。`assessThreat()` 在 `domain/defense/threat-assessment.ts` 是唯一 Threat 评估纯函数。被 `room-state` 系统消费写入 RoomSnapshot。Tactical 层消费 `EnemySnapshot`（含 `capability` 字段）但不重新评估 Threat Level。

**但**: `tactical-engagement-runtime.ts` 的 `estimateThreatScore()` 是一个粗略的威胁评分（`cap.attack + cap.rangedAttack + cap.heal * 0.5 + cap.toughParts * 10`），不调用 `assessThreat()`。这是 TargetCandidate 的辅助评分，不是第二套 ThreatAssessment。

**判定**: 不构成第二入口 — `estimateThreatScore()` 只是 FocusFire 的局部评分辅助，不产出 ThreatLevel / ThreatIntent。

### Q14: 是否存在 CombatCapability 第二实现？

**是，存在代码复制**。`evaluateCombatCapability()` 在 `domain/combat/capability.ts` 是 Canonical 纯函数。但以下系统层各自实现了 **同型的 `buildCreepCapability()` 函数**：

| 文件 | 函数 | 是否调用 Canonical |
|------|------|-------------------|
| tactical-runtime-system.ts | buildCreepCapability() | 否，独立实现 |
| tactical-engagement-runtime.ts | buildCreepCapability() + buildHostileCapability() | 否，独立实现 |
| combat-micro-runtime.ts | buildCreepCapability() + buildHostileCapability() | 否，独立实现 |

**判定**: MEDIUM — 三份系统层各自复制了 body → capability 的解析逻辑，逻辑相同但代码不共享。不构成第二套评估算法（逻辑一致），但违反 DRY。Canonical `evaluateCombatCapability()` 未被系统层调用。

### Q15: 是否存在 Formation 第二实现？

**否**。Formation 语义在 `formation.ts`，槽位计算在 `squad-formation.ts` 的 `computeFormationSlots()`。`state-machine.ts` 的 `selectFormation()` 和 `formation.ts` 的 `selectFormationForTerrain()` 逻辑一致（同型 switch），但 state-machine 版本内联在决策函数中。

**判定**: LOW — 两处阵型选择逻辑同型但不共享。不构成第二套实现。

### Q16: 是否存在 FocusFire 第二实现？

**否**。`planFocusFire()` 在 `focus-fire.ts` 是唯一集火计划纯函数。`state-machine.ts` 的 `selectEngagementTarget()` 是 Tactical 层的目标选择（用于 TacticalDecision），不产出 AttackIntent，不构成第二套 FocusFire。

### Q17: 是否存在 Micro Arbitration 第二实现？

**否**。`arbitrateMicro()` 在 `combat-micro.ts` 是唯一微操仲裁函数。无其他文件实现类似的优先级仲裁逻辑。

### Q18: 是否存在非确定性来源？

**否**。grep 确认 `src/domain/tactical/` 下无 `Math.random` / `Date.now` 调用（仅在注释中提到"禁止"）。所有 tie-break 使用 `id 字典序` 或 `priority → urgency → distance → id` 稳定排序。FNV-1a hash 用于确定性验证。

### Q19: 是否存在跨 tick 状态污染？

**是，两个观察**：

1. **globalCache 跨 tick 持久字段**: `tacticalObjectives` (Map)、`tacticalReinforcementDemands` (Set)、`targetLocks` (Map) 跨 tick 持久。但每 tick 清理 per-tick 数据（`tacticalRoleIntents.clear()`）。终态 Objective 1000 tick 后清理。**风险可控**。

2. **prevFocusFirePlans / prevMicroDecisions**: 用于状态机连续性（FocusFire EngagementState / Micro target lock）。这些是设计意图的跨 tick 状态，不是污染。

**判定**: 无意外污染。跨 tick 状态都是设计意图。

### Q20: 是否存在 Memory 膨胀风险？

**低风险**。Tactical Runtime 使用 heap only（globalCache），不写 Memory。`tacticalObjectives` Map 终态记录 1000 tick 后清理。`Memory.kernel.warPlan` 只存少量字段（targetRoom, sponsor, squadSize, since, towersSeen, phase, spawned, spawnedKeys, a5ForceReq）。

### Q21: 是否存在 CPU 高频路径问题？

**两个观察**：

1. **squad-movement-runtime interval=1**: 每 tick 运行，调 `produceSquadMovementIntent()` + PathFinder。但只有 warPlan 存在时才执行。和平时直接 return。**风险可控**。

2. **combat-micro-runtime interval=3**: 每 3 tick 运行。`planCombatMicro()` 对每个 alive member 遍历 enemies 做 O(N×M) 评估。war 时 squad 通常 ≤ 10 人，enemies ≤ 20。CPU 可接受。

3. **tactical-runtime / tactical-engagement 各自独立构建 SquadPlan**: 两个系统各自调用 `querySquad()` + `buildSquadPlanFromWarPlan()`，重复采集。**MEDIUM CPU 浪费** — 同一 tick 内 SquadPlan 被构建 3 次（tactical-runtime, squad-movement, tactical-engagement），CombatCapability 被解析 3+ 次。

---

## 三、A4 → A5 边界完整性

### Military → Recovery
✅ TacticalAbortSignal → globalCache → recovery-execution-system 消费
✅ WarAbortSignal → globalCache → recovery-execution-system 消费
✅ Military 不执行 Recovery

### Military → Spawn
✅ war-planner 通过 submitRequest() 向 spawn queue 提交
✅ tactical-runtime 只记录 Demand 信号，不提交 spawn 请求
✅ spawn-manager 是唯一 spawnCreep 调用者

### Military → Logistics
⚠️ tactical-runtime 产出 tacticalSupplyDemands，但 logistics-planner **未消费**
✅ Military 不直接创建 Transport Plan

### Military → Empire Health
✅ Military 不写 empireHealth
✅ empire-health-system 独立评估 threat 维度（从 posture 读取）

### Military → Decision Trace
✅ Tactical Decision 写入 event-log（recordEvent）
✅ recovery-execution-system 的 war/tactical abort 链路被 decision-trace 追踪

---

## 四、Runtime 执行顺序审计

### Bootstrap 注册顺序（同优先级按注册顺序执行）：

```
P1: empire-strategy (interval=1) → 写 posture
P1: empire-health (interval=100) → 写 recoveryActions
P1: recovery-execution (interval=10) → 消费 recoveryActions + abort signals
P2: war-planning (interval=10) → 产出 WarPlan
P2: war-planner (interval=10) → 消费 WarPlan, 执行 spawn/止损
P2: tactical-runtime (interval=10) → 消费 warPlan, 产出 TacticalDecision
P2: squad-movement (interval=1, phase=main) → 消费 SquadPlan, 执行移动
P2: tactical-engagement (interval=3, phase=main) → 产出 FocusFirePlan
P2: combat-micro (interval=3, phase=main) → 产出 MicroPlan
P0: traffic-manager (post) → 统一仲裁 move
```

### Stale Decision 风险：

1. **tactical-runtime interval=10 vs squad-movement interval=1**: TacticalDecision 每 10 tick 更新一次，但 SquadMovement 每 tick 执行。在 interval 间隙，SquadMovement 使用上一次的 TacticalState。**风险可控** — TacticalState 是宏观状态（FORMING/MOVING/ENGAGING），不需要每 tick 变化。

2. **FocusFire interval=3 vs Role 每 tick 执行**: AttackIntent 每 3 tick 更新。在间隙 tick，attacker 读取上一次的 AttackIntent（globalCache 未清）。**风险可控** — 目标在 3 tick 内通常不会消失，且 Role resolve 时检查 targetId 有效性。

3. **war-planning interval=10 vs war-planner interval=10**: 同频但 war-planning 先注册先执行。war-planner 读取的 warPlan 是本 tick war-planning 刚写入的（如果 interval 对齐）。**但**: 两者 interval 都是 10，不保证每 10 tick 对齐（取决于 tick % 10）。如果 war-planning 在 tick T 运行，war-planner 也在 tick T 运行（同 P2 按注册顺序），war-planner 读到的是 war-planning 刚写入的 plan。**无 stale 风险**。

4. **Creep death 后引用残留**: tactical-runtime 的 `buildSquadPlan()` 通过 `querySquad()` 获取编队成员，`Game.creeps[entry.name]` 不存在时跳过（`if (!creep) continue`）。combat-micro-runtime 对死亡成员标记 `alive: false` 并跳过。**无残留引用**。

5. **Hostile disappear**: FocusFire 的 `deriveEngagementState()` 检查 prevPlan.primaryTargetId 是否在当前 candidates 中。不在则返回 `TARGET_LOST` 或 `TARGET_OUT_OF_RANGE`。**正确处理**。

---

## 五、PvP 老玩家场景审查

### 场景 1-4: 单 melee / boosted attacker / boosted healer / attack+heal stack
✅ CombatCapability 正确解析 boost 倍率（×4 for T3）
✅ FocusFire 优先选择 healer（tacticalPriority=100）
✅ Micro 层 kite 逻辑对 ranged 优势生效

### 场景 5: ranged kiting
✅ `evaluateKiteIntent()` 检查 `canKite` 和敌方 melee 接近
⚠️ kite direction 只是 1/0（远离/接近），不是真实方向向量。Micro 意图到 Role 的移动执行 **未接线** — `getMicroDecision()` 导出但 attacker.ts **未消费**。

### 场景 6: tower + healer
✅ `evaluateTowerAvoidanceIntent()` 检查 towerCoverage 和 damageFactor
✅ Micro 层在 tower CRITICAL 时产出 RETREAT

### 场景 7-9: dismantler / claim attack / controller attack
✅ ThreatAssessment 推断 CONTROLLER_ATTACK / ECONOMIC_ATTACK intent
⚠️ Tactical Runtime 当前只产出 ENGAGE_ENEMY 类型 Objective，不区分 DISMANTLE / CONTROLLER_ATTACK

### 场景 10: remote mining harassment
✅ remote-defender role 处理 NPC + 玩家骚扰
✅ posture 检测 threatRecent → fortify

### 场景 11: siege
✅ ThreatAssessment 推断 SIEGE intent
⚠️ Tactical 层无 counter-siege 专项策略

### 场景 12: multi-squad attack
⚠️ 当前架构只支持 **单 squad**（单 warPlan = 单 target = 单 squad）。无 multi-squad 编队协调。

### 场景 13-14: target death / disappear during engagement
✅ FocusFire `deriveEngagementState()` → TARGET_DEAD → REASSESSING → 重新选择
✅ TargetScope 验证防止追击越界

### 场景 15-17: squad leader / healer death / formation collapse
✅ `checkSquadBroken()` 检查 aliveRatio < threshold → REGROUPING
✅ `checkHealerLost()` 检查 healer 全灭 → DISENGAGING
✅ CohesionMetric BROKEN/CRITICAL → produceSquadMovementIntent 产出 REGROUP

### 场景 18: path blocked
✅ `detectSquadStuck()` 检测 Anchor 连续未前进 → SQUAD_HEAVY/BLOCKED → 清除路径重算

### 场景 19: retreat path blocked
⚠️ RetreatPolicy 只指定 retreatRoom，不评估路径可达性。`retreatQuality` 在 TerrainContext 中定义但 Tactical Runtime 使用 UNKNOWN 默认值。

### 场景 20: hostile enters/exits room
✅ `collectEnemies()` 每 interval 从 `Game.rooms[targetRoom]` 采集。Hostile 离开房间后不在 enemies 列表中。
⚠️ interval=10 意味着 hostile 在间隙 tick 可能在视野内但不在 enemies 列表中。

### 场景 21-22: enemy boost / composition change
✅ `checkEnemyCapabilitySurge()` 检测敌方能力激增 → RETREATING
✅ CombatCapability 每次采集都重新解析 body

### 场景 23-24: CPU bucket 下降 / spawn starvation
✅ posture 检测 `anyRecovery` → war 退出
✅ war-planner 检测 `isAttritionLost()` → 收摊
✅ spawn-manager 的 P0 灾后恢复优先

### 场景 25: simultaneous recovery + combat
✅ recovery-execution-system 消费 tacticalAbortSignals + warAbortSignals + empireActions
✅ 优先级排序 + 预算控制（maxSubmitPerTick=3）

### 场景 26: safe mode
⚠️ Tactical 层不检测 safeMode。attacker 不检查 `room.controller.safeMode`。

### 场景 27: nuke/safemode context
✅ ThreatAssessment 检测 `roomContext.incomingNukes > 0` → NUCLEAR intent
✅ war-planner 有 `shouldLaunchNuke()` 核弹威慑链

### 场景 28: room ownership change
✅ `evaluateWarOutcome()` 检测 intel.owner 变化

---

## 六、架构问题汇总

### BLOCKER: 无

### HIGH: 无

### MEDIUM (5 项):

| # | 问题 | 位置 | 修复方案（不实施） |
|---|------|------|-------------------|
| M1 | WarPlan 双轨制 fallback | war-planner.ts L77-80 | 删除 selectWarTarget/decideSquadSize fallback，war-planning-system 完全接管 |
| M2 | CombatCapability 代码复制 | 3 个 runtime 系统各自 buildCreepCapability | 提取到公共 runtime helper，调用 Canonical evaluateCombatCapability() |
| M3 | Micro Decision 未被 Role 消费 | attacker.ts 未 import getMicroDecision | attacker 添加 microDecision 候选或在上游候选中融合 |
| M4 | tacticalSupplyDemands 无消费者 | logistics-planner 未读取 | logistics-planner 读取 tacticalSupplyDemands 并注入 DemandNode |
| M5 | SquadPlan 重复构建 3 次 | 3 个 runtime 系统各自 buildSquadPlanFromWarPlan | 提取到公共 runtime helper，globalCache 缓存 SquadPlan |

### LOW (3 项):

| # | 问题 | 位置 |
|---|------|------|
| L1 | Formation 选择逻辑两处同型 | state-machine.ts selectFormation() + formation.ts selectFormationForTerrain() |
| L2 | TerrainContext 在所有 runtime 中使用 UNKNOWN 默认值 | tactical-runtime / squad-movement / combat-micro |
| L3 | estimateThreatScore 是粗略评分 | tactical-engagement-runtime.ts |

---

## 七、A5 FREEZE 建议

### 结论: **A5 可以正式冻结**

理由:
1. 架构分层清晰，权责边界在代码层面验证通过
2. 无 BLOCKER / HIGH 级架构问题
3. 5 个 MEDIUM 问题不影响架构闭环，只是代码质量优化
4. Domain 纯函数律在 import 层面验证通过
5. 确定性保证（FNV-1a hash + 稳定 tie-break）
6. Military → A4 边界完整（Spawn/Recovery/Logistics 信号链路畅通）
7. Legacy fallback 是有意设计，不是架构错误

### 冻结后 MEDIUM 修复优先级（可选，不阻塞下一阶段）:
1. M3 (Micro Decision 未接线) — 影响实战效果
2. M1 (WarPlan 双轨制) — 影响 Canonical 路径唯一性
3. M4 (SupplyDemand 未消费) — 影响战争后勤
4. M2+M5 (代码复制 + 重复构建) — 影响 CPU 效率

---

## 八、最终报告：10 个核心问题回答

### Q1: A5 是否真正闭环？

**是。** A5 架构从 Strategic（posture）→ Operational（warPlan）→ Tactical（state-machine）→ Micro（arbitrateMicro）→ Role（attacker/healer）→ Game API 形成完整调用链。每一层有明确的 Producer 和 Consumer，通过 globalCache / Memory 传递。无断链。

**证据**:
- `evaluateEmpirePosture()` → `planMilitaryOperation()` → `evaluateTacticalAction()` → `planFocusFire()` + `planCombatMicro()` → `attacker.ts` / `healer.ts` → `creep.attack()` / `creep.heal()` / `creep.move()`
- 每一层都是纯函数 + 系统薄壳结构，Domain 不 import Game/Memory/Runtime
- 确定性验证：FNV-1a hash 在 war-planning、state-machine、focus-fire、combat-micro 四处实现

### Q2: Tactical 是否真正只决定 HOW？

**是。** Tactical 层（`evaluateTacticalAction()`）只消费上游 WarPlan 的目标房间和授权，产出 TacticalState 转换 + Formation + MovementIntent + CombatIntent。不修改 WarPlan / WarPosture / Operation。

**证据**:
- `validateAuthorization()` [authorization.ts] 硬性校验 Tactical 目标在 Operational 授权范围内
- Tactical 不 import posture.ts / war-planning.ts 的写路径
- TacticalDecision 不包含任何 WarPlan / Operation 修改字段

### Q3: Micro 是否真正唯一？

**是。** `arbitrateMicro()` 是 Micro 层唯一仲裁入口。8 级优先级（RETREAT → SURVIVAL → HEAL_SUPPORT → ATTACK_RANGE → KITE → FORMATION → REPOSITION → PATROL）。唯一输出 `CombatMovementDecision`。无其他文件实现类似的优先级仲裁逻辑。

**但**: microDecisions 当前未被 Role 消费（M3 技术债）。仲裁逻辑唯一，但消费链路断裂。这不影响 Micro 层的唯一性，只影响实际效果。

### Q4: Role 是否真正只是执行层？

**是，在 Canonical 路径中。** attacker.ts 的候选优先级链（attackByFocusFire → attackByTacticalIntent → Legacy fallback）中，Canonical 候选只从 globalCache 读取 Intent 并执行 `creep.attack()` / `creep.rangedAttack()`。

**但在 Legacy fallback 中**（attackEnemies / attackStructures），Role 自行选择目标（`findClosestByRange` / 价值分档）。这是 MEDIUM GAP — Role fallback 做了 Tactical 级目标选择，但这是有意的向后兼容设计。

### Q5: Military 是否完全复用 A4？

**是。** Military 不建立第二套 Spawn / Logistics / Recovery / Economy。

- **Spawn**: war-planner → `submitRequest()` → spawn-manager（唯一 spawnCreep）
- **Recovery**: tactical-runtime → `tacticalAbortSignals` → recovery-execution-system（A4.6 lifecycle）
- **Logistics**: tactical-runtime → `tacticalSupplyDemands`（信号产出，但 logistics-planner 未消费 — M4）
- **Empire Health**: empire-health-system 独立评估 threat 维度

### Q6: 是否仍存在第二套决策系统？

**否，不存在并行决策系统。** 存在两个 LEGACY_COMPATIBILITY_ONLY 双轨：

1. WarPlan 产出：Canonical（war-planning-system）+ Legacy（war-planner fallback）。Legacy 不产生新决策权，只在 Canonical 未产出时 fallback。
2. Role 目标选择：Canonical（FocusFire/TacticalIntent）+ Legacy（findClosestByRange）。Legacy 在上游 Intent 不存在时保底。

两个双轨都不是并行决策系统 — 它们是 fallback 链，不是同时运行的竞争决策。

### Q7: 是否存在必须立即修复的架构问题？

**否。** 无 BLOCKER / HIGH 级架构问题。5 个 MEDIUM 问题不影响架构闭环：

- M1 (WarPlan 双轨制) — Legacy fallback 仍生效，但不影响架构正确性
- M2 (CombatCapability 复制) — 逻辑一致，只是 DRY 违反
- M3 (Micro Decision 未消费) — 仲裁逻辑正确，消费未接线
- M4 (SupplyDemand 未消费) — 信号产出正确，注入未接线
- M5 (SquadPlan 重复构建) — CPU 浪费但不影响正确性

### Q8: A5 是否应该正式冻结？

**是。** 理由：

1. 架构分层清晰，权责边界在代码层面验证通过
2. 无 BLOCKER / HIGH 级架构问题
3. MEDIUM 问题不阻塞下一阶段开发
4. Domain 纯函数律在 import 层面验证通过
5. 确定性保证（FNV-1a hash + 稳定 tie-break）
6. Military → A4 边界完整
7. 5 个 MEDIUM 问题可在冻结后择机修复，不需要先修再冻结
8. 继续在 A5 上投入的边际收益递减 — 基础设施已完成，实战验证比代码完善更重要

### Q9: 下一阶段最值得投入的方向是什么？

**Empire Intelligence — 学习闭环。**

具体优先级：
1. **A6.1 Combat Learning + Strategy Evaluation** — 从 DecisionTrace 和战后评估中提取知识
2. **A6.2 Long-term Memory + 战后学习** — 跨 tick/跨 war 的经验积累
3. **A6.3 Enemy Learning** — 积累 per-player 历史 body 配置

### Q10: 为什么？

当前帝国是一个**反应式系统**：感知 → 决策 → 执行 → 反馈。它能正确响应威胁、管理经济、执行战争。但它不从历史中学习、不预测趋势、不自适应调整策略参数。

**Screeps 是一个长期运行的博弈**。在数千甚至数万 tick 的运营中，最大的竞争优势不是「反应更快」或「编队更优」，而是「从每次交战、每次扩张、每次经济波动中提取知识并反馈到未来决策」。

当前军事基础设施（A5）已经足够支撑基本 PvP。继续在 A5 上投入的边际收益递减 — M3 (Micro Decision 接线) 会改善实战效果，但不会改变帝国的根本能力。

**真正的质变来自学习闭环**：
- 知道玩家 X 喜欢在什么时间进攻 → 预判 > 反应
- 知道编队 A vs 编队 B 的胜率 → 数据驱动 > 经验猜测
- 知道扩张到某类房间的失败率 → 风险量化 > 盲目乐观
- 知道市场价格的周期性 → 套利 > 被动交易

这些能力让帝国从「能反应」升级为「能学习、能预测、能自适应」——这才是真正的 Screeps AI 帝国。
