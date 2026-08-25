# A5.4.4 Runtime Chain Audit — Tactical Combat Runtime Validation

> Phase 25 | A5.4.4 §17–18  
> Date: 2026-08-25  
> Status: ✅ CLOSED

## 1. Audit Scope

验证战术战斗运行时链条（Authorization → Target Selection → Focus Fire → AttackIntent → Role Execution）在真实 Screeps 环境中的可运行性、确定性和边界安全性。

## 2. Runtime Chain — End-to-End Flow

```
WarPlan (Memory.kernel.warPlan)
  ↓
tacticalEngagementSystem.run(ctx)          [interval=3, P2, main phase]
  ├─ §3 buildSquadPlanFromWarPlan()        — 从 querySquad 构建 SquadPlan 框架
  ├─ §4 collectMemberSnapshots()           — 从 Game.creeps 构建 FocusFireMemberSnapshot[]
  │    └─ buildCreepCapability(creep)       — 从 body 解析 CombatCapability
  ├─ §5 collectTargetCandidates()          — 从 Game.rooms 采集敌方 creep
  │    └─ buildTargetCandidate()           — 构建 TargetCandidate（含可达性/距离/战术价值）
  ├─ §6 getSquadMovementIntent()            — 消费 A5.4.2 CohesionMetric
  ├─ §7 deriveTacticalState()              — 从 SquadPlan.state + warPhase 推导
  ├─ §10 构建 FocusFireSnapshot            — 纯函数输入 DTO
  ├─ §11 planFocusFire(snapshot)           — ★ Domain 纯函数核心决策
  │    ├─ §1 授权/姿态检查                  — 非 war / RETREATING / DISENGAGING → 0 AttackIntent
  │    ├─ §2 凝聚力检查                     — BROKEN / CRITICAL → REGROUP
  │    ├─ §3 TargetScope 过滤               — 越界目标拒绝
  │    ├─ §4 deriveEngagementState()        — 状态机连续性（IDLE→ATTACKING→DYING→DEAD→LOST）
  │    ├─ §5 多维评分 + 排序                — TacticalValueBreakdown（禁止单一 powerScore）
  │    ├─ §6 Overkill 计算 + 分流           — 总伤害 > 1.5× effectiveHP → 分配次目标
  │    ├─ §7 Attack Assignment             — 每成员产出 AttackIntent（ATTACK/RANGED/DISMANTLE/NO_ATTACK）
  │    ├─ §8 HealCoverage 评估             — 治疗覆盖率 < 0.3 → retreatRecommended
  │    └─ §9 EnemyHealSupport 评估         — 敌方 healer 覆盖 → killDifficultyTicks
  └─ §12 写入 globalCache
       ├─ focusFirePlans.set(squadId, plan)
       ├─ prevFocusFirePlans.set(squadId, plan) — 状态机连续性
       └─ attackIntents.set(creepName, intent)   — 供角色层消费

attacker.ts (Role Layer)
  ├─ attackByFocusFire().resolve(ac)        — 读取 globalCache.attackIntents
  │    └─ intent.attackType === "NO_ATTACK" → 不消费候选（Movement 系统处理）
  ├─ attackByFocusFire().execute(ac, target)
  │    ├─ RANGED_ATTACK → creep.rangedAttack(target)  [dist ≤ 3]
  │    ├─ DISMANTLE     → creep.dismantle(target)      [对建筑]
  │    ├─ ATTACK        → creep.attack(target)          [dist ≤ 1]
  │    └─ NO_ATTACK     → moveToTarget (fallback)
  └─ 回退链: attackByFocusFire → attackByTacticalIntent → attackPowerBank → attackEnemies → attackStructures
```

## 3. Fixes Applied in A5.4.4

### 3.1 attacker.ts — `attackByFocusFire` Execute 逻辑修复

**缺陷**：原代码将 DISMANTLE 和 ATTACK 混在同一分支，且 melee 攻击未校验范围。

**修复**：
- `DISMANTLE` → 独立分支，调用 `creep.dismantle(target)` 而非 `creep.attack(target)`
- `ATTACK` → 添加 `getRangeTo(target.pos) <= 1` 校验，超出范围时 `moveToTarget`
- `NO_ATTACK` → 不执行攻击动作，仅当 `requiresMovement` 时移动

### 3.2 tactical-engagement-runtime.ts — Pos 编码不一致修复

**缺陷**：`collectMemberSnapshots` 中 `pos: creep.pos.y * 50 + creep.pos.x`，与 `buildTargetCandidate` / `chebyshevDist` 使用的 `x * 50 + y` 格式不一致，导致距离计算错误。

**修复**：改为 `pos: creep.pos.x * 50 + creep.pos.y`，添加注释说明编码格式。

### 3.3 focus-fire.ts — `planFocusFire` 状态过滤增强

**缺陷**：`tacticalState` 过滤仅包含 `RETREATING / DISENGAGING / ABORTED`，遗漏 `REGROUPING / COMPLETED`。

**修复**：添加 `REGROUPING / COMPLETED` 到过滤条件，确保这两个状态不产出 AttackIntent。

### 3.4 focus-fire.ts — `deriveEngagementState` 顺序修复

**缺陷**：`deriveEngagementState` 在 `validCandidates.length === 0` 检查之后调用，导致目标死亡/消失时状态被覆盖为 `IDLE` 而非 `TARGET_DEAD / TARGET_LOST`。

**修复**：将 `deriveEngagementState` 调用提前到 `validCandidates` 检查之前，并在 `validCandidates` 为空时根据状态机结果返回正确的 `EngagementState`。

### 3.5 architecture-guards.test.ts — 正则匹配修正

**缺陷**：
- `/RETREATING.*no attack intent/` 单行正则无法跨行匹配
- `/TOUGH|ATTACK|RANGED_ATTACK|HEAL|WORK/` 误匹配 `AttackType` 字面量中的 `ATTACK` 子串
- `/禁止单一 powerScore/` 被注释行过滤后无法匹配

**修复**：分别使用 `toContain` 检查关键词存在性；使用 `\b` 边界匹配排除类型名中的子串；在注释中检查设计原则文本。

## 4. Domain Purity Audit

| 检查项 | 结果 |
|--------|------|
| `domain/tactical/*.ts` 不引用 `Game` | ✅ PASS |
| `domain/tactical/*.ts` 不引用 `Memory` | ✅ PASS |
| `domain/tactical/*.ts` 不引用 `Creep` / `PathFinder` | ✅ PASS |
| `domain/tactical/*.ts` 不调用 `attack()` / `rangedAttack()` / `heal()` | ✅ PASS |
| `domain/tactical/*.ts` 不调用 `move()` / `registerMove` / `spawnCreep()` | ✅ PASS |
| `domain/tactical/*.ts` 不 import `systems/` / `creeps/` / `kernel/` | ✅ PASS |
| `domain/tactical/*.ts` 不使用 `Math.random` / `Date.now` | ✅ PASS |

## 5. System Boundary Audit

| 检查项 | 结果 |
|--------|------|
| `tactical-engagement-runtime.ts` 不调用 `spawnCreep` | ✅ PASS |
| `tactical-engagement-runtime.ts` 不引用 `logistics-planner` | ✅ PASS |
| `tactical-engagement-runtime.ts` 不引用 `recovery-execution` | ✅ PASS |
| `tactical-engagement-runtime.ts` 不修改 `Memory.kernel.strategy` / `.posture` | ✅ PASS |
| `tactical-engagement-runtime.ts` 不创建 `MilitaryOperation` | ✅ PASS |
| `tactical-engagement-runtime.ts` 不创建/修改 `warPlan` | ✅ PASS |
| `tactical-engagement-runtime.ts` 不直接调用 `attack()` / `heal()` / `rangedAttack()` | ✅ PASS |
| `tactical-engagement-runtime.ts` 调用 `planFocusFire`（纯函数） | ✅ PASS |

## 6. Role Boundary Audit

| 检查项 | 结果 |
|--------|------|
| `attacker.ts` acquire 链中 `attackByFocusFire` 在首位 | ✅ PASS |
| `attacker.ts` work 链中 `attackByFocusFire` 在首位 | ✅ PASS |
| `attacker.ts` 包含 `readAttackIntent` 消费函数 | ✅ PASS |
| `attacker.ts` Legacy `attackEnemies` 在 FocusFire 之后（fallback） | ✅ PASS |
| `attacker.ts` 不创建 `WarPlan` / 不修改 `WarPosture` | ✅ PASS |
| `healer.ts` 不创建 `WarPlan` / 不修改 `WarPosture` | ✅ PASS |

## 7. Canonical Consumption Audit

| 检查项 | 结果 |
|--------|------|
| `focus-fire.ts` 不重新实现 `assessThreat` / `ThreatAssessment` | ✅ PASS |
| `focus-fire.ts` 不重新实现 `evaluateCombatCapability` | ✅ PASS |
| `focus-fire.ts` 消费 `CombatCapability`（不重新解析 body parts） | ✅ PASS |
| `focus-fire.ts` 使用 `TacticalValueBreakdown`（多维评分，非单一 powerScore） | ✅ PASS |
| `tactical-engagement-runtime.ts` 的 `estimateThreatScore` 消费 `CombatCapability` | ✅ PASS |
| `tactical-engagement-runtime.ts` 的 `buildHostileCapability` 不调用 `evaluateCombatCapability` | ✅ PASS |

## 8. Determinism Audit

| 检查项 | 结果 |
|--------|------|
| `planFocusFire` 相同输入 → 相同输出 | ✅ PASS |
| `focusFirePlanHash` 使用 FNV-1a 32-bit（无 `Math.random`） | ✅ PASS |
| 50 组 × 1000 次 Replay → decisionHash 100% 一致 | ✅ PASS |
| `EngagementState` 转换表验证（合法/非法转换） | ✅ PASS |

## 9. Memory Boundedness Audit

| 检查项 | 结果 |
|--------|------|
| `tacticalEngagementSystem` 每 tick 重置 `focusFirePlans` / `attackIntents` | ✅ PASS |
| `prevFocusFirePlans` 仅保留 1 tick（heap only，global reset 可丢） | ✅ PASS |
| `__tacticalHostiles` per-tick per-room 缓存自动过期 | ✅ PASS |
| 无 Memory 持久化（heap only — 无序列化开销） | ✅ PASS |

## 10. Bootstrap Registration Audit

| 检查项 | 结果 |
|--------|------|
| `tacticalEngagementSystem` 已注册到 `bootstrap.ts` | ✅ PASS |
| `registerSystem(tacticalEngagementSystem)` 存在 | ✅ PASS |
| `tacticalRuntimeSystem` 已注册到 `bootstrap.ts` | ✅ PASS |
| `registerSystem(tacticalRuntimeSystem)` 存在 | ✅ PASS |
| `domain/tactical/index.ts` barrel export 完整（types/authorization/state-machine/formation/role-intent/squad-formation/focus-fire） | ✅ PASS |

## 11. Test Coverage Summary

| 测试文件 | 测试数 | 状态 |
|----------|--------|------|
| `a5-4-4-architecture-guards.test.ts` | 51 | ✅ ALL PASS |
| `a5-4-4-runtime-validation.test.ts` | 63 | ✅ ALL PASS |
| 全套测试 | 4264 | ✅ ALL PASS |

### Runtime Validation 场景覆盖

| ID | 场景 | 验证点 |
|----|------|--------|
| 001 | Target Death Race | 目标死亡 → 重新选择，不继续攻击死目标 |
| 002 | Target Escape | 目标离开范围 → requiresMovement + NO_ATTACK |
| 003 | Formation Conflict | Cohesion BROKEN → REGROUP（不攻击） |
| 004 | Retreat Safety | RETREATING → 0 AttackIntent |
| 005 | Authorization Denied | 非 war → 0 AttackIntent |
| 006 | Focus Fire Overkill | 多 attacker 不全部集中一个目标 |
| 007 | Enemy Healer Priority | 优先选择 healer 目标 |
| 008 | Boosted Enemy | boosted target 优先级提升 |
| 009 | Deterministic Replay | 50 组 × 1000 次 Hash 一致 |
| 010 | Mixed Melee + Ranged | 攻击类型正确分配 |
| 011 | Low HP Target | 残血目标 → TARGET_DYING |
| 012 | TargetScope LOCAL | 同房目标不拒绝 |
| 013 | TargetScope 越界 | 跨房目标拒绝 + STRATEGIC 禁止 |
| 014 | Authorization Expired | 过期 → EXPIRED，aborted → REVOKED |
| 015 | DISENGAGING/REGROUPING/COMPLETED | 全部 → 0 AttackIntent |
| 016 | 多 tick 状态连续性 | IDLE→ATTACKING→DYING→DEAD 链 + TARGET_LOST |
| 017 | Overkill 动态调整 | HP 下降 → 更多 attacker 分到次目标 |
| 018 | 全部超出射程 | 全部 requiresMovement + NO_ATTACK |
| 019 | HealCoverage | 无 healer + 受伤 → retreatRecommended |
| 020 | decisionHash | 非空、确定性、不同输入不同 Hash |
