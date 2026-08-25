# Canonical System Map — A5 Single Source of Truth Audit

> **审计日期**: 2026-08-25
> **审计方法**: 逐项追踪真实代码的 Producer / Consumer / Legacy / Fallback
> **判定标准**: 是否存在第二套实现参与运行时决策

---

## 一、逐项单一真相源审计

### 1. Threat Assessment

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `assessThreat()` [domain/defense/threat-assessment.ts] |
| **Canonical Consumer** | room-state.ts → RoomSnapshot.threatAssessment → war-planning, tactical-runtime |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 — 唯一入口 |
| **判定** | CANONICAL — 无第二套实现 |

**证据**: `grep -r "assessThreat" src/` 只在 room-state.ts 和 threat-assessment.ts 内部调用。tactical-engagement-runtime 的 `estimateThreatScore()` 是局部辅助评分（`cap.attack + cap.rangedAttack + cap.heal * 0.5`），不产出 ThreatLevel/ThreatIntent，不构成第二入口。

---

### 2. CombatCapability

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `evaluateCombatCapability()` [domain/combat/capability.ts] |
| **Canonical Consumer** | room-state.ts → EnemySnapshot.capability / RoomSnapshot → war-planning, tactical runtime |
| **Legacy Producer** | `buildCreepCapability()` × 3 系统 (tactical-runtime-system.ts, tactical-engagement-runtime.ts, combat-micro-runtime.ts) |
| **Legacy Consumer** | 各 runtime 系统内部构建 MicroSnapshot / FocusFireSnapshot |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ⚠️ 是 — 三份 `buildCreepCapability()` 是同型代码复制，逻辑一致但不调用 Canonical |
| **判定** | C — 保留但不得参与决策。当前是代码复制（DRY 违反），不构成第二套评估算法。**M2 技术债。** |

---

### 3. MilitaryPlan (WarPlan)

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `planMilitaryOperation()` [domain/military/war-planning.ts] → war-planning-system.ts |
| **Canonical Consumer** | war-planner.ts (读取 globalCache.warPlanCache), tactical-runtime-system.ts (读取 Memory.kernel.warPlan) |
| **Legacy Producer** | `selectWarTarget()` / `decideSquadSize()` / `decideHealerCount()` [war-planner.ts L77-80] |
| **Legacy Consumer** | war-planner.ts 自行构建 Memory.kernel.warPlan |
| **Fallback** | Legacy 在 Canonical 未产出时 fallback |
| **是否仍有第二套实现** | ⚠️ 是 — Legacy fallback 在运行时实际生效 |
| **判定** | B — LEGACY_COMPATIBILITY_ONLY。war-planning-system 是 Canonical 路径，fallback 不产生新决策权，但双轨制仍在运行时生效。**M1 技术债。** |

---

### 4. WarPosture

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `evaluateEmpirePosture()` [domain/strategy/posture.ts] → empire-strategy.ts |
| **Canonical Consumer** | Memory.kernel.strategy.posture → 所有系统读取 |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 |
| **判定** | CANONICAL — 唯一姿态裁决者，唯一写者 |

---

### 5. TacticalObjective

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `buildTacticalObjective()` [tactical-runtime-system.ts] |
| **Canonical Consumer** | `evaluateTacticalAction()` [state-machine.ts] |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 |
| **判定** | CANONICAL — 唯一产出者 |

**注意**: 当前只产出 `ENGAGE_ENEMY` 类型 Objective，不区分 `DISMANTLE` / `CONTROLLER_ATTACK`。这是功能广度不足（LOW），不是第二套实现。

---

### 6. Formation

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `selectFormation()` [state-machine.ts] (Tactical 层) + `selectFormationForTerrain()` [formation.ts] |
| **Canonical Consumer** | TacticalDecision.formation → squad-movement-runtime |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ⚠️ LOW — 两处同型逻辑不共享 |
| **判定** | C — 保留但不参与独立决策。`selectFormation()` 内联在 state-machine，`selectFormationForTerrain()` 独立导出但语义相同。**L1 技术债。** |

---

### 7. FocusFire

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `planFocusFire()` [domain/tactical/focus-fire.ts] → tactical-engagement-runtime.ts |
| **Canonical Consumer** | globalCache.attackIntents → attacker.ts `attackByFocusFire()` |
| **Legacy Producer** | 无（`selectEngagementTarget()` [state-machine.ts] 是 Tactical 层目标选择，不产出 AttackIntent） |
| **Legacy Consumer** | 无 |
| **Fallback** | attacker.ts `attackEnemies()` / `attackStructures()` (Legacy 目标选择) |
| **是否仍有第二套实现** | ✅ 否 — FocusFire 是唯一 AttackIntent 产出者 |
| **判定** | CANONICAL — Legacy fallback 在 Role 层独立选目标，但不产出 AttackIntent |

---

### 8. MicroMovement

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `arbitrateMicro()` [domain/tactical/combat-micro.ts] → combat-micro-runtime.ts |
| **Canonical Consumer** | globalCache.microDecisions (设计意图: Role 消费) |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 — `arbitrateMicro()` 是唯一仲裁入口 |
| **判定** | CANONICAL — 但 **microDecisions 未被 Role 消费** (M3 技术债) |

---

### 9. Recovery

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `recovery-execution-system.ts` 的 `consumeTacticalAbortSignals()` + `mapAbortSignalsToRecoveryActions()` |
| **Canonical Consumer** | spawn-manager (spawn 请求), agenda-manager (agenda), terminal-manager (terminal) |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 |
| **判定** | CANONICAL — Military 只产出 AbortSignal，Recovery 走 A4.6 lifecycle |

---

### 10. Spawn

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `spawn-manager.ts` — 唯一 `spawnCreep()` 调用者 |
| **Canonical Consumer** | Game API |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 |
| **判定** | CANONICAL — Military 通过 `submitRequest()` 向 spawn queue 提交 |

---

### 11. Logistics

| 维度 | 内容 |
|------|------|
| **Canonical Producer** | `logistics-planner.ts` (A4 系统) |
| **Canonical Consumer** | logistics.ts → hauler dispatch |
| **Legacy Producer** | 无 |
| **Legacy Consumer** | 无 |
| **Fallback** | 无 |
| **是否仍有第二套实现** | ✅ 否 — Military 不创建 Transport Plan |
| **判定** | CANONICAL — 但 `tacticalSupplyDemands` 信号未注入 logistics-planner。**M4 技术债。** |

---

## 二、判定汇总

| 系统 | 判定 | 技术债编号 |
|------|------|-----------|
| Threat | CANONICAL | — |
| CombatCapability | C (保留但不参与决策) | M2 |
| MilitaryPlan (WarPlan) | B (LEGACY_COMPATIBILITY_ONLY) | M1 |
| WarPosture | CANONICAL | — |
| TacticalObjective | CANONICAL | — |
| Formation | C (保留但不参与决策) | L1 |
| FocusFire | CANONICAL | — |
| MicroMovement | CANONICAL | M3 (未消费) |
| Recovery | CANONICAL | — |
| Spawn | CANONICAL | — |
| Logistics | CANONICAL | M4 (未接线) |

---

## 三、判定标准说明

| 判定 | 含义 | 行动 |
|------|------|------|
| **CANONICAL** | 唯一真相源，无第二套实现 | 无需行动 |
| **A. 真正删除** | 第二套实现应该被删除 | 标记为待删除技术债 |
| **B. LEGACY_COMPATIBILITY_ONLY** | Legacy 路径存在但不应产生新决策权 | 标记为 MEDIUM 技术债，择机移除 |
| **C. 保留但不得参与决策** | 代码复制/同型逻辑，不构成第二决策入口 | 标记为 LOW 技术债 |
| **D. 架构错误** | 存在并行决策系统，必须修复 | 无（本次审计未发现） |
