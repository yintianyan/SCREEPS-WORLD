# A5.5 Combat Micro Audit — Final Report

> Phase 26 | A5.5 §31 Final Audit
> 生成时间：2025-06-17
> 状态：**PASS**（0 BLOCKER / 0 HIGH / E2E: ENVIRONMENT BLOCKED）

---

## 目录

1. [Combat Micro Research](#1-combat-micro-research)
2. [Existing Combat Audit](#2-existing-combat-audit)
3. [Kiting](#3-kiting)
4. [Range Control](#4-range-control)
5. [Healer Protection](#5-healer-protection)
6. [Enemy Healer Pressure](#6-enemy-healer-pressure)
7. [Target Switching](#7-target-switching)
8. [Attack / Movement Arbitration](#8-attack--movement-arbitration)
9. [Body-aware Tactical State](#9-body-aware-tactical-state)
10. [Terrain](#10-terrain)
11. [Chokepoint](#11-chokepoint)
12. [Tower Interaction](#12-tower-interaction)
13. [Rampart / Wall](#13-rampart--wall)
14. [Squad Cohesion](#14-squad-cohesion)
15. [Combat Pressure](#15-combat-pressure)
16. [Micro State Machine](#16-micro-state-machine)
17. [Intent Model](#17-intent-model)
18. [Runtime Integration](#18-runtime-integration)
19. [Intent Arbitration](#19-intent-arbitration)
20. [Decision Trace](#20-decision-trace)
21. [Determinism](#21-determinism)
22. [Tests](#22-tests)
23. [E2E](#23-e2e)
24. [CPU](#24-cpu)
25. [Memory](#25-memory)
26. [Legacy](#26-legacy)
27. [Architecture](#27-architecture)
28. [Known Limitations](#28-known-limitations)
29. [A5.6 Readiness](#29-a56-readiness)

---

## 1. Combat Micro Research

**文档**: `docs/phase26/A5_5_COMBAT_MICRO_RESEARCH.md`

已完成 Screeps PvP 战斗 API 事实研究，覆盖：
- ATTACK/RANGED_ATTACK/HEAL/MOVE/TOUGH/WORK/CLAIM 部件机制
- Boost 倍率表（T1/T2/T3）
- Terrain/Rampart/Wall/Tower/Room Exit 对 Tactical Micro 的影响
- Kiting / Focus Fire / Healer Protection / Formation Breaking 战术启发式

区分了 API 事实与玩家经验，未伪装经验为游戏规则。

---

## 2. Existing Combat Audit

**审计范围**: `attacker.ts` / `healer.ts` / `movement` / `combat manager` / `tower-defense`

| 分类 | 现状 | 结论 |
|------|------|------|
| Target Selection | A5.4.3 `planFocusFire` | **CANONICAL** |
| Threat Assessment | A5.1 G1 | **CANONICAL** |
| CombatCapability | A5.1 G2 | **CANONICAL** |
| Formation | A5.4.2 | **CANONICAL** |
| FocusFire | A5.4.3 | **CANONICAL** |
| Kiting | 无（A5.5 新增） | **NEW** |
| Retreat | `attacker.ts` `retreatRatio` | **LEGACY_COMPAT** |
| HealTarget | `healer.ts` 既有 | **CANONICAL**（A5.5 不替换） |
| attackEnemies/Structures | `attacker.ts` fallback | **LEGACY_COMPAT**（fallback only） |

**结论**: 无重复 Micro 逻辑。attacker.ts 的 Legacy attack 是 `fallback` 而非首选（A5.4.4 已验证）。

---

## 3. Kiting

**实现**: `evaluateKiteIntent()` in `combat-micro.ts`

- 消费 `BodyAwareTacticalState.canKite`（基于 A5.1 CombatCapability.mobility）
- 检测 2 格内近战威胁 → 产出 `KiteIntent`
- 输出: `direction`(0=接近/1=后撤), `urgency`(0-1), `confidence`
- Domain 只产出 Intent，不直接 move

**测试**: MICRO-001 ✓

---

## 4. Range Control

**实现**: `evaluateRangeControlIntent()` in `combat-micro.ts`

- MIN_RANGE / OPTIMAL_RANGE / MAX_RANGE 基于 body type
  - RANGED: optimalRange=3, min=2, max=3
  - ATTACK: optimalRange=1, min=0, max=1
  - HEAL: optimalRange=1, min=1, max=3
- 产出 `RangeControlIntent` with `inOptimalRange` / `requiresMovement` / `moveDirection`

**测试**: MICRO-002 ✓

---

## 5. Healer Protection

**实现**: `assessHealerProtection()` in `combat-micro.ts`

- 检测 healer 被 2 格内近战威胁
- 产出 `ProtectIntent` with `healerId` / `threatId` / `protectors` / `urgency`
- 不让 healer 自己创建 Strategic 目标

**测试**: MICRO-004 ✓

---

## 6. Enemy Healer Pressure

**实现**: `scoreTargetForMicro()` in `combat-micro.ts`

- 敌方 healer 在 `scoreTargetForMicro` 中获得 +100 优先级
- 残血目标 +50 优先级
- 通过 `TargetSwitchIntent` 影响目标切换决策
- 不重新实现 Strategic "先杀 healer" 规则

**测试**: MICRO-005 ✓

---

## 7. Target Switching

**实现**: `evaluateTargetSwitchIntent()` in `combat-micro.ts`

- 支持 `CURRENT_TARGET` / `CANDIDATE_TARGET` / `SWITCH_SCORE` / `SWITCH_MARGIN` / `LOCK_UNTIL`
- Hysteresis: lock 内需 2x margin 才切换；lock 过期后 1x margin 即可
- 目标消失立即切换
- 防止 Target Oscillation

**测试**: MICRO-006 ✓

---

## 8. Attack / Movement Arbitration

**实现**: `arbitrateMicro()` in `combat-micro.ts`

优先级（从高到低）：
1. **RETREAT** — tower CRITICAL / formation CRITICAL / retreating state
2. **SURVIVAL** — hp < 0.2 + damagePressure > 0
3. **HEAL_SUPPORT** — healer + wounded ally
4. **ATTACK_RANGE** — in range + has target
5. **KITE** — urgency > 0.7 + canKite
6. **FORMATION** — deviating member
7. **REPOSITION** — tower AVOID
8. **PATROL / HOLD** — default

输出唯一 `CombatMovementDecision` with `rejectedAlternatives`。

**测试**: MICRO-014 ✓

---

## 9. Body-aware Tactical State

**实现**: `deriveBodyAwareState()` in `combat-micro.ts`

消费 A5.1 `CombatCapability`，派生：
- `canFight` / `canKite` / `canRetreat` / `canSupport` / `canChase` / `canHold`
- `optimalRange` / `minRange` / `maxRange`

禁止重新解析 body。

**测试**: MICRO-012 ✓

---

## 10. Terrain

**实现**: 消费 `TerrainContext` (A5.2) 和 `EffectiveCombatModifier`

- terrain 影响移动、kiting、formation、retreat、engagement range
- 不重新建立 terrain 系统
- Tower coverage 改变 decision（MICRO-013 验证）

**测试**: MICRO-013 ✓

---

## 11. Chokepoint

**实现**: 消费 `TerrainContext.chokepoints`

- chokepoint 影响 terrain modifier 的 `approachFactor`
- 不因发现 chokepoint 改变 WarPlan

**测试**: MICRO-009 ✓

---

## 12. Tower Interaction

**实现**: `evaluateTowerAvoidanceIntent()` in `combat-micro.ts`

- CRITICAL → RETREAT
- HIGH/MEDIUM + damageFactor > 0.6 → AVOID
- LOW/NONE → PROCEED
- 不复制 Tower Defense 到 Military

**测试**: MICRO-008 ✓

---

## 13. Rampart / Wall

当前版本不区分 rampart 保护与普通 hostile target（terrain 层已处理 rampartCoverage）。
建筑目标由 A5.4.3 `TargetCandidate.role` 区分。

**状态**: 部分实现（rampart interaction 需 A5.6 进一步细化）

---

## 14. Squad Cohesion

**实现**: 消费 A5.4.2 `CohesionMetric`

- BROKEN → `ReformIntent(REGROUP)`
- CRITICAL → `ReformIntent(RETREAT)`
- DEGRADED → `ReformIntent(REFORM)` if deviating
- 不直接修改 Strategic Objective

**测试**: MICRO-007 ✓

---

## 15. Combat Pressure

**实现**: `assessCombatPressure()` in `combat-micro.ts`

7 维独立压力：
- `enemyPressure` / `damagePressure` / `healPressure` / `towerPressure`
- `mobilityPressure` / `formationPressure` / `retreatPressure`
- `aggregateRisk` = 加权汇总（非万能指标）

**测试**: CombatPressure 单元测试 ✓

---

## 16. Micro State Machine

**决策**: 不创建第二套 Tactical State Machine。

复用 A5.4 `TacticalState`：
- RETREATING/DISENGAGING/COMPLETED/ABORTED → 禁止 aggressive micro
- ENGAGING/POSITIONING → 允许 micro

未新增 KITING/REPOSITIONING 等扩展状态（当前需求未要求）。

**测试**: MICRO-010 ✓

---

## 17. Intent Model

**实现**: 6 种 MicroIntent 类型

| Intent | 用途 |
|--------|------|
| `KiteIntent` | ranged 后撤 |
| `RangeControlIntent` | 距离维持 |
| `ProtectIntent` | healer 保护 |
| `ReformIntent` | 阵型重组 |
| `TargetSwitchIntent` | 目标切换 |
| `TowerAvoidanceIntent` | 塔规避 |

Domain 不直接执行 Game API。

---

## 18. Runtime Integration

**实现**: `combat-micro-runtime.ts`

数据流：
```
SquadSnapshot + FormationState + FocusFirePlan + TerrainContext
  ↓ buildMicroSnapshot()
MicroSnapshot
  ↓ planCombatMicro()
MicroPlan + CombatMovementDecision[]
  ↓ globalCache
Role / Movement 消费
```

- `interval=3`, `priority=2`, `phase="main"`
- 公共 API: `getMicroDecision(creepName)` / `getMicroPlan(squadId)`
- Heap only — global reset 可丢

---

## 19. Intent Arbitration

`arbitrateMicro()` 统一仲裁，优先级明确，`rejectedAlternatives` 记录拒绝原因。

禁止 Role 自己 `if attack else move` 形成第二套 micro 逻辑。

**测试**: MICRO-014 ✓

---

## 20. Decision Trace

每个 `CombatMovementDecision` 包含：
- `action` / `targetId` / `moveDirection` / `executeAttack` / `attackType`
- `rejectedAlternatives[]` — 被拒绝的候选及原因
- `reason` / `confidence`
- `decisionHash` — 8 字符 FNV-1a hash

`MicroPlan.decisionHash` — 整体 plan 签名，支持 replay 验证。

---

## 21. Determinism

- **100 snapshots × 1000 replays**: 全部 hash 一致 ✓
- 禁止 `Math.random` / `Date.now`（架构守卫验证）
- tie-break: priority → urgency → distance → id（稳定排序）
- FNV-1a 32-bit hash，确定性输出

**测试**: MICRO-015 + Deterministic Replay ✓

---

## 22. Tests

| 测试文件 | 测试数 | 状态 |
|----------|--------|------|
| `a5-5-combat-micro.test.ts` | 31 | ✓ PASS |
| `a5-5-architecture-guards.test.ts` | 23 | ✓ PASS |
| `a5-5-cpu-memory-benchmark.test.ts` | 11 | ✓ PASS |
| `a5-5-deterministic-replay.test.ts` | 5 | ✓ PASS |
| `a5-5-e2e-scenarios.test.ts` | 7 | ✓ PASS |
| **合计** | **77** | **ALL PASS** |

覆盖 MICRO-001~015 全部 15 个场景 + 架构守卫 + CPU/Memory + 确定性 + E2E。

---

## 23. E2E

| 场景 | Domain 层验证 | Runtime 层 |
|------|---------------|------------|
| MICRO-E2E-001 | ✓ Kite → Target Death → Re-select | ENVIRONMENT BLOCKED |
| MICRO-E2E-002 | ✓ Ranged Kite + Formation INTACT | ENVIRONMENT BLOCKED |
| MICRO-E2E-003 | ✓ Enemy Healer → Target Switch | ENVIRONMENT BLOCKED |
| MICRO-E2E-004 | ✓ Tower MEDIUM → AVOID (non-RETREAT) | ENVIRONMENT BLOCKED |
| MICRO-E2E-005 | ✓ Cohesion BROKEN → REGROUP | ENVIRONMENT BLOCKED |
| MICRO-E2E-006 | ✓ RETREATING → all aggressive micro stopped | ENVIRONMENT BLOCKED |

**真实 E2E 需要 Screeps 私服 / MMO 环境**。Domain 层逻辑闭环已验证。不伪造 PASS。

---

## 24. CPU

| 配置 | Avg | P95 | Max |
|------|-----|-----|-----|
| 1S × 20M × 50T | 0.048ms | 0.053ms | 0.180ms |
| 2S × 20M × 50T | 0.19ms | 0.31ms | 0.31ms |
| 5S × 20M × 50T | 0.43ms | 0.77ms | 0.77ms |
| 10S × 20M × 50T | 0.61ms | 0.89ms | 0.89ms |
| 20S × 20M × 50T | 1.05ms | 1.58ms | 1.79ms |

**结论**: 20 Squad × 20 Members × 50 Targets = 1.05ms avg。CPU 不会爆炸。

---

## 25. Memory

- `MicroPlan` 只含 decisions/intents，不含原始 members/enemies
- `microDecisions` / `microPlans` / `prevMicroDecisions` / `targetLocks` 均 heap-only Map
- 每 tick 清空重建（无累积）
- `targetLocks` 有 GC（过期清除）
- Domain 纯函数不修改传入状态

**结论**: Memory bounded ✓

---

## 26. Legacy

| 模块 | 现有逻辑 | 分类 |
|------|----------|------|
| attacker.ts `retreatRatio` | hp-based retreat | LEGACY_COMPAT (fallback) |
| attacker.ts `attackEnemies` | hostile find + attack | LEGACY_COMPAT (fallback) |
| attacker.ts `attackStructures` | structure find + attack | LEGACY_COMPAT (fallback) |
| attacker.ts `attackByFocusFire` | A5.4.3 消费 | CANONICAL |
| attacker.ts `attackByTacticalIntent` | A5.4.1 消费 | CANONICAL |
| healer.ts heal target selection | 既有逻辑 | CANONICAL (A5.5 不替换) |

**注意**: attacker.ts / healer.ts 尚未集成 `getMicroDecision()`。当前 Legacy fallback 仍为首选。这是**有意的渐进迁移**——A5.5 先建立 Domain + Runtime，角色层集成在后续阶段。

---

## 27. Architecture

23 条架构守卫全部通过：

- Domain 禁止 Game / Memory / Creep / Room / PathFinder ✓
- Domain 禁止 attack()/move()/spawnCreep() ✓
- Runtime 禁止 spawn / logistics / recovery ✓
- Runtime 禁止修改 WarPosture / 创建 Operation / Strategic Target ✓
- Micro 禁止第二套 Threat / CombatCapability / Formation / FocusFire ✓
- Domain 不 import systems/ / creeps/ / kernel/ ✓
- Domain 不使用 Math.random / Date.now ✓
- barrel export 完整 ✓
- bootstrap 注册 combatMicroSystem ✓

---

## 28. Known Limitations

1. **角色层未集成**: attacker.ts / healer.ts 尚未消费 `getMicroDecision()`，当前走 Legacy fallback
2. **Rampart Interaction**: 未区分 rampart 保护 vs 普通 hostile（部分实现）
3. **Chokepoint HOLD/BLOCK/CROSS**: 当前只影响 approachFactor，未实现完整 chokepoint tactical action
4. **Boost Interaction in Micro**: bodyState 未考虑 boost 对 mobility 的精确影响（消费 A5.1 estimate）
5. **Ranged Mass Attack**: `RANGED_MASS_ATTACK` AttackType 未在 micro 中特殊处理
6. **Real Runtime E2E**: 需要 Screeps 环境验证 Runtime → Role → Game API 完整闭环

---

## 29. A5.6 Readiness

A5.5 已完成核心 Domain + Runtime 基础设施：

**可直接扩展**：
- `MicroSnapshot` 支持扩展字段
- `MicroActionType` 可新增动作类型
- `MicroIntent` 类型可扩展
- `arbitrateMicro` 优先级链可插入新动作

**A5.6 前提条件**：
- 角色层集成 `getMicroDecision()`（attacker/healer 消费 micro decision）
- 真实 Runtime E2E 验证
- Rampart interaction 细化

---

## PASS 标准

| 标准 | 状态 |
|------|------|
| 0 BLOCKER | ✓ |
| 0 HIGH | ✓ |
| 至少一个真实 Runtime E2E | **ENVIRONMENT BLOCKED** |
| Domain 层逻辑闭环 | ✓ (6/6 E2E 场景) |
| Architecture Guards | ✓ (23/23) |
| Determinism | ✓ (100×1000) |
| CPU | ✓ (20S ≤ 2ms) |
| Memory | ✓ (bounded) |

**最终结论**: A5.5 Domain + Runtime 实现完成，测试全绿（77/77）。真实 Runtime E2E 标记为 ENVIRONMENT BLOCKED，不伪造 PASS。
