# A5.4.3 — Tactical Engagement & Focus Fire 审计文档

## 1. 概述

### 1.1 阶段目标

解决「已完成 Formation + Movement 的 Squad 如何真正接敌、集火、击杀、重新选择目标」。
让 Squad 具备完整的 Tactical Engagement Loop：

```
接敌 → 选择攻击目标 → 集火 → 攻击 → 目标死亡 → 重新选择 → 继续作战
```

### 1.2 前置条件

- A5.3 + A5.3.1：Military Architecture 已完成并冻结
- A5.4.0：Tactical Combat Contract & Boundary Design 已完成
- A5.4.1：Tactical Runtime Integration 已完成
- A5.4.2：Squad Formation & Tactical Movement 已完成

### 1.3 质量门槛

- typecheck PASS
- test PASS（4150 tests, 291 test files）
- build PASS
- Architecture Guards PASS（22 tests, 13 条边界检查 + 额外守卫）

## 2. 架构设计

### 2.1 数据流

```
FocusFireSnapshot (纯函数输入)
    ↓
planFocusFire() (Domain 纯函数)
    ↓
FocusFirePlan + AttackIntent[]
    ↓
globalCache.attackIntents (creepName → AttackIntent 映射)
    ↓
attacker.ts → readAttackIntent() → attack() / rangedAttack()
```

### 2.2 分层契约

| 层 | 模块 | 职责 | 禁止 |
|---|---|---|---|
| Domain | `src/domain/tactical/focus-fire.ts` | 纯函数：目标评分、Overkill 分流、AttackIntent 生成、状态机 | 引用 Game/Memory/Creep/Room/PathFinder |
| System | `src/systems/tactical-engagement-runtime.ts` | 薄壳：采集运行时数据、构建 Snapshot、调用纯函数、写入缓存 | 做战术决策、调用 attack()/spawnCreep() |
| Role | `src/creeps/roles/attacker.ts` | 消费 AttackIntent 执行实际 API 调用 | 自行选择目标（消费 FocusFire 指令优先） |
| Test | `tests/unit/tactical/a5-4-3-*.test.ts` | 验证纯函数行为 + Architecture Guards | — |

### 2.3 设计边界（严格）

- **Strategic（WHY）**：WarPosture / WarPlan — 不碰
- **Operational（WHAT）**：TacticalObjective / TargetScope — 只消费
- **Tactical（HOW）**：本模块 — 局部交战目标分配 + 火力协同

### 2.4 消费 Canonical 上游

| 上游 | 消费内容 | 用途 |
|---|---|---|
| A5.1 G1 ThreatAssessment | `estimatedPower` / `enemyCombatPower` | 目标威胁评分 |
| A5.1 G2 CombatCapability | `evaluateCombatCapability` 输出 | 成员/敌方能力评估 |
| A5.4.0 TacticalSnapshot | `enemies` / `squad` / `objective` | 目标候选构建 |
| A5.4.2 SquadMovementIntent | `formation` / `cohesion` | 凝聚力检查 |

## 3. 实现清单

### 3.1 Domain 层纯函数（`src/domain/tactical/focus-fire.ts`）

| 函数 | 用途 | 测试 ID |
|---|---|---|
| `planFocusFire` | 核心入口：从 Snapshot 产出 FocusFirePlan + AttackIntent[] | COMBAT-001~014 |
| `scoreCandidate` | 多维战术价值评分（禁止单一 powerScore） | COMBAT-002 |
| `computeExpectedDamage` | 成员对目标的预期伤害/tick | COMBAT-008 |
| `buildAttackIntent` | 构建 AttackIntent DTO | COMBAT-009 |
| `computeOverkillRisk` | 过量击杀风险计算（0-1） | COMBAT-003 |
| `assessHealCoverage` | 编队治疗覆盖状态评估 | COMBAT-E2E-005 |
| `assessEnemyHealSupport` | 敌方对目标的 heal 支持评估 | COMBAT-007 |
| `deriveEngagementState` | 从 prevPlan + 当前 Snapshot 推导状态机 | COMBAT-004/005 |
| `computeConfidence` | 决策置信度计算（0-1） | — |
| `canTransitionEngagement` | 状态机转换合法性验证 | 状态机测试 |
| `focusFirePlanHash` | 确定性 FNV-1a Hash | COMBAT-014 |
| `buildTargetCandidate` | 从 EnemySnapshot + CombatCapability 构建 TargetCandidate | — |

### 3.2 核心数据结构

| 类型 | 用途 |
|---|---|
| `FocusFirePlan` | 一个 Squad 在某一 tick 的完整集火计划 |
| `TargetCandidate` | 一个敌方单位的战术候选快照 |
| `AttackIntent` | 单个 Creep 的攻击意图（Domain 产出，Role 执行） |
| `HealCoverage` | 编队治疗覆盖状态 |
| `EnemyHealSupport` | 敌方治疗能力评估 |
| `EngagementState` | Focus Fire 级别子状态机（12 个状态） |
| `FocusFireSnapshot` | planFocusFire() 的唯一输入 |
| `FocusFireMemberSnapshot` | 编队成员战斗能力快照 |
| `TacticalValueBreakdown` | 多维战术价值评分（9 个维度） |

### 3.3 EngagementState 状态机

```
IDLE
  ↓
TARGET_ACQUIRED
  ↓
ATTACKING
  ↓ (HP < 30%)
TARGET_DYING
  ↓ (HP = 0)
TARGET_DEAD
  ↓
REASSESSING
  ↓
TARGET_ACQUIRED (循环)

异常路径：
  TARGET_LOST → REASSESSING
  TARGET_OUT_OF_RANGE → REQUEST_MOVEMENT
  TARGET_ESCAPED → REASSESSING
  TARGET_BLOCKED → REASSESSING
  REGROUP → IDLE
```

### 3.4 系统层运行时（`src/systems/tactical-engagement-runtime.ts`）

| 属性 | 值 |
|---|---|
| 名称 | `tactical-engagement` |
| 优先级 | P2 |
| 频率 | interval=3（3 tick 重算一次） |
| 阶段 | main（角色执行之前） |
| 存储 | heap only（global reset 可丢） |

运行时链路：
1. 从 `globalCache` / `Game` / `Memory` 采集运行时状态
2. 构建 `FocusFireSnapshot`（纯函数输入格式）
3. 调用 `planFocusFire()` → `FocusFirePlan`
4. `AttackIntent[]` 写入 `globalCache.attackIntents`
5. `FocusFirePlan` 写入 `globalCache.focusFirePlans`
6. 上 tick Plan 保留用于状态机连续性

### 3.5 Role 层集成（`src/creeps/roles/attacker.ts`）

| 候选 | 优先级 | 说明 |
|---|---|---|
| `attackByFocusFire` | 1（最高） | A5.4.3 FocusFire AttackIntent 消费 |
| `attackByTacticalIntent` | 2 | A5.4.1 TacticalIntent 消费 |
| `attackPowerBank` | 3 | PB 野采打击 |
| `attackEnemies` | 4 | Legacy hostile find |
| `attackStructures` | 5 | Legacy 结构拆除 |

降级链：FocusFire → TacticalIntent → Legacy（向后兼容）。

## 4. 测试覆盖

### 4.1 单元测试（`tests/unit/tactical/a5-4-3-focus-fire.test.ts`）

| 测试 ID | 场景 | 验证内容 |
|---|---|---|
| COMBAT-001 | 单目标 → 正确选择 | primaryTargetId + attackIntents 正确 |
| COMBAT-002 | 多目标 → 最高 Tactical 价值 | healer(priority=100) > attacker(priority=70) |
| COMBAT-003 | Overkill → 分配攻击者 | secondaryTargetId + 分流 + overkillRisk |
| COMBAT-004 | 目标死亡 → 重新分配 | TARGET_DEAD → 新目标选择 |
| COMBAT-005 | 目标逃跑 → 重新评估 | OUT_OF_RANGE + requiresMovement |
| COMBAT-006 | 目标超出射程 | requiresMovement=true + NO_ATTACK |
| COMBAT-007 | 敌方 Healer | enemyHealSupport 评估 |
| COMBAT-008 | Boost → CombatCapability | boosted damage 正确计算 |
| COMBAT-009 | Melee vs Ranged | ATTACK / RANGED_ATTACK 类型正确 |
| COMBAT-010 | Formation 不能被绕过 | cohesion=BROKEN → REGROUP |
| COMBAT-011 | Retreat 状态 | RETREATING/DISENGAGING → 无 Intent |
| COMBAT-012 | 非 WAR 姿态 | develop/fortify → 无 Intent |
| COMBAT-013 | TargetScope 越界 | 拒绝非授权房间目标 |
| COMBAT-014 | 1000 次 Hash 一致 | 确定性 FNV-1a 验证 |

### 4.2 Architecture Guards（`tests/unit/tactical/a5-4-3-architecture.test.ts`）

| Guard # | 检查内容 | 通过 |
|---|---|---|
| 1 | focus-fire.ts 不引用 Game | PASS |
| 2 | focus-fire.ts 不引用 Memory | PASS |
| 3 | focus-fire.ts 不引用 Creep/Room/PathFinder | PASS |
| 4 | focus-fire.ts 不调用 attack/rangedAttack/heal | PASS |
| 5 | focus-fire.ts 不调用 move/registerMove/spawnCreep | PASS |
| 6 | tactical-engagement-runtime.ts 不调用 spawnCreep | PASS |
| 7 | tactical-engagement-runtime.ts 不引用 logistics | PASS |
| 8 | tactical-engagement-runtime.ts 不引用 recovery | PASS |
| 9 | tactical-engagement-runtime.ts 不修改 WarPosture | PASS |
| 10 | tactical-engagement-runtime.ts 不创建 Operation | PASS |
| 11 | focus-fire.ts 不创建 Strategic Target | PASS |
| 12 | focus-fire.ts 不重新实现 ThreatAssessment | PASS |
| 13 | focus-fire.ts 不重新实现 CombatCapability | PASS |
| 额外 | focus-fire.ts 不 import systems/creeps/kernel/ | PASS |
| 额外 | focus-fire.ts 不使用 Math.random/Date.now | PASS |
| 额外 | tacticalEngagementSystem 已注册到 bootstrap | PASS |
| 额外 | focus-fire 已从 barrel 导出 | PASS |
| 额外 | runtime 不直接调用 attack()/heal() | PASS |
| 额外 | runtime 调用 planFocusFire | PASS |
| 额外 | attacker.ts 包含 attackByFocusFire | PASS |
| 额外 | attacker.ts focus-fire 在 acquire/work 链首位 | PASS |

### 4.3 E2E 测试（`tests/integration/tactical/a5-4-3-e2e.test.ts`）

| 测试 ID | 场景 | 验证内容 |
|---|---|---|
| COMBAT-E2E-001 | 完整交战周期 | acquire → attack → kill → reassess → new target |
| COMBAT-E2E-002 | 多目标优先级链 | healer > attacker > low-hp unknown |
| COMBAT-E2E-003 | Overkill 分流 | 多 attacker 跨目标分配 + 连续 tick 一致性 |
| COMBAT-E2E-004 | 目标逃跑 | OUT_OF_RANGE → requiresMovement + 消失场景 |
| COMBAT-E2E-005 | 治疗覆盖评估 | retreatRecommended + full coverage |
| COMBAT-E2E-006 | 非 war 姿态降级 | develop/fortify → 零 Intent + 安全状态 |

## 5. 排序修复说明

### 5.1 问题

COMBAT-003 测试发现目标排序逻辑中 `effectiveHP` 维度的排序方向错误。

`TacticalValueBreakdown.effectiveHP` 使用 `10000 / effectiveHP` 公式（越脆分数越高），
但排序时使用升序排列，导致低 HP（高分数）的目标排到了后面。

### 5.2 修复

将 `effectiveHP` 和 `distance` 维度的排序从升序改为降序：
- `effectiveHP` 降序：越脆（分数越高）越优先
- `distance` 降序：越近（分数越高）越优先

修复后 `tacticalPriority` 降序 → `effectiveHP` 降序 → `distance` 降序 → `id` 字典序。

## 6. 文件清单

| 文件 | 类型 | 行数 | 说明 |
|---|---|---|---|
| `src/domain/tactical/focus-fire.ts` | Domain | 1106 | 核心纯函数 + DTO + 状态机 |
| `src/systems/tactical-engagement-runtime.ts` | System | 507 | 系统层薄壳 |
| `src/creeps/roles/attacker.ts` | Role | ~340 | AttackIntent 消费集成 |
| `src/domain/tactical/index.ts` | Barrel | — | 导出 focus-fire 模块 |
| `src/bootstrap.ts` | Bootstrap | — | 注册 tacticalEngagementSystem |
| `tests/unit/tactical/a5-4-3-focus-fire.test.ts` | Test | 648 | 14 个单元测试 + 状态机转换 |
| `tests/unit/tactical/a5-4-3-architecture.test.ts` | Test | 264 | 22 个架构守卫测试 |
| `tests/integration/tactical/a5-4-3-e2e.test.ts` | Test | 620 | 17 个端到端测试 |

## 7. 技术债与后续

| 项目 | 状态 | 说明 |
|---|---|---|
| RANGED_MASS_ATTACK | 未实现 | 多目标范围攻击需特殊条件判断，当前只处理单目标 |
| DISMANTLE 对建筑 | 简化 | 当前 buildAttackIntent 中对 dismantler 角色有类型但未完整测试 |
| Tough 减伤计算 | 简化 | `buildTargetCandidate` 中 toughReduction 使用简化公式 |
| 敌方角色推断 | 粗略 | 系统层 `collectTargetCandidates` 传入 role="" 由 buildTargetCandidate 推断 |
| WarPlan → SquadPlan | 简化 | `buildSquadPlanFromWarPlan` 是简化版构建，与 squad-movement-runtime 同型 |
