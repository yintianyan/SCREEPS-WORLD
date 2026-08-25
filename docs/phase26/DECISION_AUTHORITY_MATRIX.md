# Decision Authority Matrix — A5 Full Audit

> **审计日期**: 2026-08-25
> **审计方法**: 真实代码调用链追踪，逐项验证 Producer / Consumer / 是否唯一
> **范围**: Strategic → Operational → Tactical → Micro → Role → Game API 全链路

---

## 一、完整决策权矩阵

| # | Decision | Owner (Producer) | Input | Output | Consumer | Frequency | 是否唯一 |
|---|----------|-----------------|-------|--------|----------|-----------|----------|
| 1 | WarPosture (develop/expand/fortify/war) | `evaluateEmpirePosture()` [posture.ts] | RoomStrategyInput[], bucket, gcl, prev | PostureResult | empire-strategy.ts → Memory.kernel.strategy | 每 tick (interval=1) | ✅ 唯一 |
| 2 | War Authorization (进攻授权) | `evaluateWarPosture()` [war-posture.ts] | empirePosture, threatAssessments, empireHealth, playerIntel | WarPostureResult (posture + reasons) | `planMilitaryOperation()` 消费 | 每 war-planning 运行时 | ✅ 唯一 |
| 3 | Threat Level (NONE/LOW/MEDIUM/HIGH/CRITICAL) | `assessThreat()` [threat-assessment.ts] | RoomSnapshot (creeps, structures, controller) | ThreatAssessment | room-state.ts → RoomSnapshot | 每 tick (room-state interval) | ✅ 唯一 |
| 4 | Threat Intent (SIEGE/HARASSMENT/ASSAULT...) | `estimateThreatIntent()` [threat-assessment.ts] | enemyBodyAnalysis, roomContext | ThreatIntent | ThreatAssessment 内嵌 | 随 Threat 评估 | ✅ 唯一 |
| 5 | Combat Capability (attack/heal/dismantle/effectiveHP) | `evaluateCombatCapability()` [capability.ts] | Creep body, boosts, hits | CombatPower / CombatCapability | room-state (RoomSnapshot), war-planning, tactical runtime | 每次采集 | ✅ 唯一 Domain 纯函数 |
| 6 | War Target (打哪个房) | `selectTarget()` [target-selection.ts] (Canonical) | TargetCandidate[], opType, maxDistance, blacklist | TargetSelectionResult | `planMilitaryOperation()` | 每次 war-planning 运行 | ⚠️ 双轨 — Legacy: `selectWarTarget()` [war-planner.ts] 在 Canonical 未产出时 fallback |
| 7 | Squad Size (编队规模) | `deriveForceComposition()` [force-requirement.ts] (Canonical) | opType, requiredCapabilities | ForceComposition | `planMilitaryOperation()` | 每次 war-planning 运行 | ⚠️ 双轨 — Legacy: `decideSquadSize()` [war-planner.ts] fallback |
| 8 | Operation Plan (WarPlan) | `planMilitaryOperation()` [war-planning.ts] (Canonical) | WarPlanningInput (threat, intel, posture, health, resources) | WarPlan | war-planning-system.ts → globalCache.warPlanCache + Memory.kernel.warPlan | interval=10 | ⚠️ 双轨 — Legacy: war-planner.ts 自行构建 WarPlan fallback |
| 9 | Tactical Objective (ENGAGE_ENEMY/DESTROY_STRUCTURE) | `buildTacticalObjective()` [tactical-runtime-system.ts] | WarPlan.operation, authorization | TacticalObjective | `evaluateTacticalAction()` 消费 | interval=10 | ✅ 唯一 |
| 10 | Tactical State (FORMING/MOVING/ENGAGING/RETREATING...) | `evaluateTacticalAction()` [state-machine.ts] | TacticalSnapshot | TacticalDecision (newState + intent + formation) | tactical-runtime-system → globalCache.tacticalRoleIntents | interval=10 | ✅ 唯一 |
| 11 | Formation Type (WEDGE/COLUMN/LINE/CLUSTER) | `selectFormation()` [state-machine.ts] (Tactical 层) | TacticalSnapshot, nextState | FormationType | TacticalDecision 内嵌 | interval=10 | ⚠️ LOW — `selectFormationForTerrain()` [formation.ts] 同型逻辑独立存在 |
| 12 | Focus Fire Target (集火目标) | `planFocusFire()` [focus-fire.ts] | FocusFireSnapshot (candidates, members, prevPlan) | FocusFirePlan + AttackIntent[] | tactical-engagement-runtime → globalCache.attackIntents | interval=3 | ✅ 唯一 |
| 13 | Squad Movement (编队移动) | `produceSquadMovementIntent()` [squad-formation.ts] | SquadSnapshot, TacticalDecision | SquadMovementIntent + PathFinder call | squad-movement-runtime → registerMove | interval=1 | ✅ 唯一 PathFinder 写者 |
| 14 | Micro Movement (RETREAT/KITE/ATTACK_RANGE/FORMATION...) | `arbitrateMicro()` [combat-micro.ts] | MicroSnapshot (members, enemies, terrain, pressure) | CombatMovementDecision[] | combat-micro-runtime → globalCache.microDecisions | interval=3 | ✅ 唯一仲裁入口 |
| 15 | Attack Execution (attack/rangedAttack/dismantle) | attacker.ts `attackByFocusFire()` / `attackByTacticalIntent()` | AttackIntent / TacticalIntent from globalCache | `creep.attack()` / `creep.rangedAttack()` / `creep.dismantle()` | Game API (per creep) | 每 tick | ⚠️ 双轨 — Legacy: `attackEnemies()` / `attackStructures()` 在上游无 Intent 时 fallback |
| 16 | Heal Execution (heal/rangedHeal) | healer.ts `healByTacticalIntent()` | TacticalIntent from globalCache | `creep.heal()` / `creep.rangedHeal()` | Game API (per creep) | 每 tick | ⚠️ 双轨 — Legacy: `healAllies()` fallback |
| 17 | Dismantle (拆除建筑) | attacker.ts `attackStructures()` (Legacy) / FocusFire AttackIntent (DISMANTLE type) | structureValueTier / AttackIntent | `creep.dismantle()` / `creep.attack()` | Game API | 每 tick | ⚠️ 双轨 — Canonical 路径存在但 Tactical Objective 当前只产出 ENGAGE_ENEMY |
| 18 | Retreat (撤退) | `evaluateTacticalAction()` → state=RETREATING / `arbitrateMicro()` → action=RETREAT | TacticalSnapshot / MicroSnapshot | TacticalDecision / CombatMovementDecision | Role: `attackerHold()` / `markRetreat()` → recycle | interval=10/3 + 每 tick | ✅ 唯一决策；Role 执行 markRetreat 是自身血量检查 |
| 19 | Abort (止损) | `checkAbortConditions()` [state-machine.ts] | TacticalSnapshot (casualty, intel, auth) | TacticalAbortSignal | tactical-runtime → globalCache.tacticalAbortSignals → recovery-execution-system | interval=10 | ✅ 唯一 |
| 20 | Reinforcement Demand (增援需求) | `submitReinforcementDemand()` [tactical-runtime-system.ts] | squad shortage, casualty | ReinforcementDemand | globalCache.tacticalReinforcementDemands → war-planner (间接) | interval=10 | ✅ 唯一 — 不自行 spawn |
| 21 | Supply Demand (战争后勤需求) | `detectSupplyDemand()` [tactical-runtime-system.ts] | squad energy/boost needs | SupplyDemand | globalCache.tacticalSupplyDemands → **无消费者** | interval=10 | ⚠️ 产出存在，消费未接线 |
| 22 | Spawn Demand (孵化请求) | war-planner.ts `submitSquadRequest()` | WarPlan.spawnRequirement, a5ForceReq | spawn queue request | spawn-manager.ts → `spawnCreep()` | interval=10 | ✅ 唯一 — spawn-manager 是唯一 spawnCreep 调用者 |
| 23 | Logistics Request (物流请求) | logistics-planner.ts (A4 系统) | DemandNode[] (从 economy/remote) | TransportPlan | logistics.ts → hauler dispatch | interval=varies | ✅ A4 唯一 — Military 的 SupplyDemand 未注入 |

---

## 二、DUPLICATED AUTHORITY 标记

以下决策项存在双轨制，必须明确标注：

### DA-1: WarPlan 产出 (Q6 + Q7 的 Decision)

| 维度 | Canonical | Legacy | 判定 |
|------|-----------|--------|------|
| Producer | `planMilitaryOperation()` [war-planning.ts] | `selectWarTarget()` / `decideSquadSize()` / `decideHealerCount()` [war-planner.ts L77-80] | **DUPLICATED AUTHORITY** |
| 触发条件 | war-planning-system 产出 WarPlan | war-planning-system 未产出 (a5ForceReq 不存在) | Legacy fallback 在运行时实际生效 |
| Consumer | war-planner.ts 读取 globalCache.warPlanCache | war-planner.ts 自行构建 Memory.kernel.warPlan | 同一消费者，不同路径 |
| 判定 | LEGACY_COMPATIBILITY_ONLY — 不产生新决策权，但 fallback 仍在运行时参与决策 | | |

### DA-2: Role 目标选择 (Q15 的 Decision)

| 维度 | Canonical (A5) | Legacy (Pre-A5) | 判定 |
|------|---------------|-----------------|------|
| Producer | `planFocusFire()` → AttackIntent / `evaluateTacticalAction()` → TacticalIntent | `findClosestByRange(hostiles)` / `structureValueTier()` 评分排序 | **DUPLICATED AUTHORITY** |
| 触发条件 | war 全链路激活 (warPlan → tactical-runtime → engagement → focus-fire) | 上游 Intent 不存在 (interval 间隙、squad 未就绪、非 war 态) | Legacy 在多数场景仍实际生效 |
| Consumer | attacker.ts `attackByFocusFire()` / `attackByTacticalIntent()` | attacker.ts `attackEnemies()` / `attackStructures()` | 同一 Role，候选优先级链 |
| 判定 | MEDIUM GAP — Role fallback 做了 Tactical 级目标选择，但是有意的向后兼容 | | |

### DA-3: CombatCapability 解析 (Q14)

| 维度 | Canonical | 复制实现 | 判定 |
|------|-----------|---------|------|
| Producer | `evaluateCombatCapability()` [capability.ts] | `buildCreepCapability()` × 3 (tactical-runtime, tactical-engagement, combat-micro) | **DUPLICATED CODE** (非 Duplicated Authority) |
| 差异 | 纯函数，被 room-state 消费 | 系统层薄壳内联，逻辑同型 | 逻辑一致，代码不共享 |
| 判定 | MEDIUM — 违反 DRY，不构成第二套评估算法 | | |

---

## 三、授权边界验证

### 3.1 Tactical → Operational / Strategic (Q8)

| 检查项 | 代码位置 | 结果 |
|--------|---------|------|
| Tactical 是否修改 WarPlan? | tactical-runtime-system.ts 只读取 Memory.kernel.warPlan | ✅ 不修改 |
| Tactical 是否修改 WarPosture? | 不 import posture.ts 的写路径 | ✅ 不修改 |
| Tactical 是否修改 Operation? | 只消费 operation.operationId / authorization | ✅ 不修改 |
| TargetScope 是否强制校验? | `validateAuthorization()` [authorization.ts] 硬性校验目标房间 | ✅ 强制 |
| Tactical Objective 是否越界? | objective.authorization.targetRoom 约束 | ✅ 约束生效 |

### 3.2 Role → Tactical (Q7)

| 检查项 | 代码位置 | 结果 |
|--------|---------|------|
| Role 是否自己选择攻击目标? | attacker.ts `attackEnemies()` → `findClosestByRange` | ⚠️ Legacy fallback 中是 |
| Role 是否自己评估威胁? | 否 — 消费 RoomSnapshot.threatCreeps | ✅ 不重新评估 |
| Role 是否自己选择阵型? | 否 — 阵型由 state-machine 产出 | ✅ 不选择 |
| Role 是否自己决定 focus fire? | `attackByFocusFire()` 消费 AttackIntent | ✅ Canonical 路径不自行决定 |
| Role 是否自己决定 retreat? | `markRetreat()` 基于自身血量 | ✅ 血量撤退是 Role 本地决策（安全设计），非战术越权 |

### 3.3 Military → A4 Systems (Q9-Q12)

| A4 系统 | Military 接入方式 | 是否绕过 | 判定 |
|---------|------------------|---------|------|
| Spawn | war-planner → `submitRequest()` → spawn-manager | ✅ 不绕过 | 唯一 spawnCreep 调用者 |
| Recovery | tactical-runtime → `tacticalAbortSignals` → recovery-execution-system | ✅ 不绕过 | 走 A4.6 lifecycle |
| Logistics | tactical-runtime → `tacticalSupplyDemands` → **无消费者** | ⚠️ 信号产出但未接线 | Military 不自行创建 Transport Plan |
| Empire Health | empire-health-system 独立评估 threat 维度 | ✅ 不绕过 | Military 不写 empireHealth |
| Decision Trace | tactical-runtime → `recordEvent()` → event-log | ✅ 不绕过 | 被追踪 |
