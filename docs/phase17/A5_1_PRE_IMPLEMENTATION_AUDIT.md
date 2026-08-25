# A5.1 — Pre-Implementation Audit

> **阶段**：A5.1 · 实施前代码审计。**不写生产代码**。
> **目标**：确认现有代码的真实调用链，识别集成点与风险，为 G1/G2/G4 纯函数实现做准备。

---

## 1. 审计范围

| # | 文件 | 审计目标 |
|---|------|----------|
| 1 | `src/systems/room-state.ts` | 威胁检测链 → colonyState 判定 |
| 2 | `src/systems/tower-defense.ts` | 塔目标选择 + 交战判定 + safe mode |
| 3 | `src/creeps/roles/attacker.ts` | 攻击者决策链 + hold 钩子 |
| 4 | `src/domain/war/planning.ts` | 战争纯函数：选目标 / 编队 / 止损 |
| 5 | `src/systems/war-planner.ts` | war-planner 系统执行链 |
| 6 | `src/systems/remote-mining-manager.ts` | 远矿威胁响应 + 暂停/恢复 |
| 7 | `src/domain/defense/threat.ts` | 威胁分类纯函数 |
| 8 | `src/domain/defense/tower-target.ts` | 塔目标评分纯函数 |
| 9 | `src/domain/defense/tower-engagement.ts` | 交战盈亏判定纯函数 |
| 10 | `src/systems/decision-trace-system.ts` | A4.7 决策追踪集成口 |
| 11 | `src/systems/empire-health-system.ts` | A4.5 帝国健康度集成口 |
| 12 | `src/systems/recovery-execution-system.ts` | A4.6 恢复执行集成口 |

---

## 2. 真实调用链追踪

### 2.1 威胁检测 → ColonyState 链（room-state.ts）

```text
buildRoomSnapshot (kernel)
  → room.find(FIND_HOSTILE_CREEPS) → hostileCreeps[]
  → classifyThreats(hostileCreeps, allies) → threatCreeps[]
  → isSquadThreatCreeps(threatCreeps) → squadThreat boolean
  → 写入 RoomSnapshot

roomStateSystem.run (每 tick, P0)
  → 读取 snapshot.threatCreeps.length → threatCount
  → 比较 prevThreatCount → threatIncreased?
  → threatIncreased → 刷新 lastHostileAt
  → threatStaleTicks 过期判定 → threatStale
  → defenseExitHysteresis 退出迟滞
  → phaseToColonyState(phase, hasHostiles) → colonyState
  → 写入 RoomMemory.colonyState
```

**关键发现**：
- **威胁判定仅基于 `threatCount`（数量）**——不区分威胁类型、不评估战力、不推断意图。
- `lastHostileAt` 只在 count 增加时刷新（P1-3 防旧威胁停留永久维持 defense）。
- `threatStaleTicks=100` + `defenseExitHysteresis=50` 构成滞回。
- **集成点**：在 `threatCount` 计算之后、`colonyState` 判定之前，可插入 `assessThreat()` 调用，将 ThreatAssessment 写入 globalCache 供下游消费。

### 2.2 塔防链（tower-defense.ts）

```text
towerDefenseSystem.run (每 tick, P0)
  → snapshot.threatCreeps.length > 0?
    → selectFocusTarget(firstTower, threatCreeps)
      → selectTowerTarget(summaries) [纯函数: 奶妈优先/最脆优先/近距优先]
    → assessEngagement(towerSummaries, {totalHealParts, breachingCore}) [纯函数]
    → decision.engage → 全塔集火 target
    → !fired && breachingCore → tryActivateSafeMode
    → fleetLossFuseTripped → tryActivateSafeMode
  → hostileCreeps.length > 0 (无威胁部件) → continue (让引擎自动点杀)
  → 无敌人 → 维修逻辑
```

**关键发现**：
- **`totalHealParts` 是纯 HEAL 部件计数，不考虑 boost**——T3 boosted healer 的实际治疗量是 4×12=48/part，而非 12/part。当前判定低估 boosted 编队的治疗能力。
- **`selectTowerTarget` 不感知 intent**——SIEGE（吸塔）编队应触发停火蓄能策略，当前无法区分。
- **集成点**：`selectFocusTarget` 和 `assessEngagement` 可消费 ThreatAssessment（intent + estimatedPower），增强目标选择和交战判定。

### 2.3 攻击者链（attacker.ts）

```text
attackerRole (RolePolicy)
  hold: attackerHold (R4 波次集结)
    → plan.phase === "build" → parkIdleCreep / fleeToHome
  acquire/work:
    → attackPowerBank (mission="powerBank")
    → attackEnemies → getHostilesCached → findClosestByRange → attack
    → attackStructures → getHostileStructuresCached → 按价值分档拆
  markRetreat: hits < hitsMax × retreatRatio → recycle
```

**关键发现**：
- **`markRetreat` 基于 HP 比例**——不考虑敌方火力、不考虑己方治疗能力、不考虑撤退路线安全性。
- **目标选择是 `findClosestByRange`**——不考虑敌方战力、不优先击杀高价值目标（如 healer）。
- **集成点**：`markRetreat` 可消费 `evaluateCombatCapability()` 做更精确的撤退判定；`attackEnemies` 可消费 `scoreCombatTarget()` 做目标优选。

### 2.4 战争规划链（war/planning.ts + war-planner.ts）

```text
warPlannerSystem.run (interval 10, P2)
  → posture !== "war" → demobilize (收摊)
  → war:
    → selectWarTarget(buildTargetInput) [纯函数: 候选筛选 + 距离排序]
    → decideSquadSize(towersSeen, base, perTower)
    → decideHealerCount(squadSize, ratio)
    → submitSquadRequest (attacker + healer)
    → nextWavePhase (build/advance 迟滞)
    → evaluateBoostGate
    → shouldLaunchNuke (核弹威慑)
    → isAttritionLost (止损)
```

**关键发现**：
- **编队规模 `decideSquadSize` 是 `base + perTower × towersSeen`**——不考虑目标房实际防御力（rampart 覆盖、defender 数量），不考虑己方 boost 状态。
- **`evaluateBoostGate` 只判 `boostedCount ≥ liveCount`**——不评估 boost 后的实际战力对比。
- **集成点**：`decideSquadSize` 可消费 `computeCombatPower()` 做编队可行性评估；止损判定可消费实际战力对比而非纯数量。

### 2.5 远矿威胁响应链（remote-mining-manager.ts）

```text
remoteMiningManagerSystem.run (interval 10, P2)
  → collectRemoteThreats(remoteOps)
    → 对每个 active op: Game.rooms[roomName]?.find(FIND_HOSTILE_CREEPS)
    → classifyThreats(hostiles, allies).length > 0 → threats[roomName] = true
  → threatUntil 持久化（失明保持）
  → dangerUntil 冷却
  → evaluateRemoteDemand → 生成 remoteDefender 请求
  → collectRemoteBlockers → InvaderCore 分类
  → recycleBlockedRoomCreeps → 回收
```

**关键发现**：
- **远矿威胁判定是 boolean（有/无）**——不区分威胁级别（invader 独狼 vs 玩家 raid 编队），不评估威胁战力，不计算远矿经济价值与风险的权衡。
- **`threatBlindHold=300` 是固定值**——不根据威胁级别调整保持时间。
- **`dangerCooldown=2000` 是固定值**——不根据威胁级别调整冷却时间。
- **集成点**：`collectRemoteThreats` 可调用 `decideRemoteDefenseAction()` 替代简单的 boolean 判定，实现 CONTINUE/PAUSE/ESCORT/RETREAT/ABORT 五级决策。

### 2.6 A4 集成口

| A4 子系统 | 集成方式 | 当前状态 |
|---|---|---|
| **Decision Trace (A4.7)** | `decision-trace-system.ts` 采集 DecisionRecord，category 包含 DEFENSE_PREP | ✅ 框架就绪，需新增 THREAT 决策类型 |
| **Empire Health (A4.5)** | `empire-health-system.ts` 的 `deriveThreatHealth` 从 posture 推导 | ✅ 框架就绪，可消费 ThreatAssessment 增强精度 |
| **Recovery (A4.6)** | `recovery-execution-system.ts` 的 `translateAndSubmit` 已有 remote_stall 通道 | ✅ 框架就绪，RETREAT 可走此通道 |
| **Spawn** | `submitRequest` → spawn-manager 唯一写者 | ✅ 就绪，ESCORT 可输出 escortDemand |
| **Logistics** | `TransportRequestV2` → Unified Logistics | ✅ 就绪，不改 |

---

## 3. Screeps 引擎常量验证

### 3.1 战斗数值（docs/research/03 §8，CONFIRMED）

| 常量 | 值 | 来源 |
|---|---|---|
| ATTACK_POWER | 30/part | 引擎常量 |
| RANGED_ATTACK_POWER | 10/part | 引擎常量 |
| HEAL_POWER (近身) | 12/part | 引擎常量 |
| RANGED_HEAL_POWER | 4/part (heal ×1 at range 1-3) | 引擎常量 |
| DISMANTLE_POWER | 50/part | 引擎常量 |
| REPAIR_POWER | 100/part | 引擎常量 |
| HARVEST_POWER | 2/part | 引擎常量 |
| CREEP_HITS_PER_PART | 100 | 引擎常量 |
| CREEP_LIFE_TIME | 1500 tick | 引擎常量 |
| CLAIM_LIFE_TIME | 600 tick | 引擎常量 |
| TOWER_POWER_ATTACK | 600 | 引擎常量 |
| TOWER_POWER_HEAL | 400 | 引擎常量 |
| TOWER_POWER_REPAIR | 800 | 引擎常量 |
| TOWER_OPTIMAL_RANGE | 5 | 引擎常量 |
| TOWER_FALLOFF_RANGE | 20 | 引擎常量 |
| TOWER_FALLOFF | 0.75 (最低 25%) | 引擎常量 |
| TOWER_ENERGY_COST | 10/action | 引擎常量 |

### 3.2 Boost 倍率验证（docs/research/03 §7，CONFIRMED）

**关键修正**：A5.0 文档中部分 boost 倍率有误，以下为引擎常量校准值：

| 部件 | T1 | T2 | T3 | 来源 |
|---|---|---|---|---|
| ATTACK | ×2 | ×3 | ×4 | 引擎常量 |
| RANGED_ATTACK | ×2 | ×3 | ×4 | 引擎常量 |
| HEAL | ×2 | ×3 | ×4 | 引擎常量 |
| TOUGH (减伤) | ×0.7 | ×0.5 | ×0.3 | 引擎常量 |
| WORK (dismantle) | ×1.5 | ×1.8 | ×2 | 引擎常量 |
| WORK (harvest) | ×3 | ×5 | ×7 | 引擎常量 |
| WORK (build/repair/upgrade) | ×1.5 | ×1.8 | ×2 | 引擎常量 |
| CARRY | ×2 | ×3 | ×4 | 引擎常量 |
| MOVE | ×2 | ×3 | ×4 | 引擎常量 |
| CLAIM | ×2 | ×3 | ×4 | 引擎常量（不延长寿命） |

**Boost 消耗**：30 矿物 + 20 能量 / part（每个被 boost 的部件）。

### 3.3 Tough 伤害顺序

引擎伤害计算（CONFIRMED from engine source）：
- **TOUGH 部件先承受伤害**（不按 body 顺序，TOUGH 是特殊优先级）。
- Tough 减伤公式：`actualDamage = incomingDamage × toughMultiplier`。
  - 无 boost: ×1.0（不减伤）
  - T1: ×0.7（减 30%）
  - T2: ×0.5（减 50%）
  - T3: ×0.3（减 70%）
- **effectiveHP = Σ(part_hits) / tough_multiplier（对 tough 部件）+ Σ(part_hits)（对非 tough 部件）**。
  简化：T3 tough 的 100 hits 实际需要 100/0.3 ≈ 333 伤害才能摧毁。

### 3.4 Heal 远程治疗

- 近身 heal（range ≤ 1）：`HEAL_POWER × boostMultiplier = 12 × boost`。
- 远程 heal（range 2-3）：`RANGED_HEAL_POWER × boostMultiplier = 4 × boost`。
- 远程 heal 是近身的 1/3（`RANGED_HEAL_POWER / HEAL_POWER = 4/12 = 1/3`）。

---

## 4. 现有代码能力清单

| 能力 | 位置 | 状态 | 缺口 |
|---|---|---|---|
| 威胁部件过滤 | `threat.ts: isThreat()` | ✅ | 无 intent 推断 |
| 小队威胁判定 | `threat.ts: isSquadThreat()` | ✅ | 无战力评估 |
| 塔目标选择 | `tower-target.ts: selectTowerTarget()` | ✅ | 无 boost/intent 感知 |
| 交战盈亏判定 | `tower-engagement.ts: assessEngagement()` | ✅ | 不计 boost 倍率 |
| 塔伤害公式 | `tower-engagement.ts: towerDamageAt()` | ✅ | — |
| 威胁计数 → colonyState | `room-state.ts` | ✅ | 纯数量，无质量评估 |
| 远矿威胁检测 | `remote-mining-manager.ts: collectRemoteThreats()` | ✅ | boolean，无级别 |
| 远矿 InvaderCore 分类 | `remote-mining-manager.ts: classifyInvaderCores()` | ✅ | — |
| 战争目标选择 | `war/planning.ts: selectWarTarget()` | ✅ | 无战力对比 |
| 编队规模 | `war/planning.ts: decideSquadSize()` | ✅ | 无可行性评估 |
| 波次相位 | `war/planning.ts: nextWavePhase()` | ✅ | — |
| 止损判定 | `war/planning.ts: isAttritionLost()` | ✅ | 纯数量 |
| 核弹决策 | `war/planning.ts: shouldLaunchNuke()` | ✅ | — |
| 战后核验 | `war/planning.ts: evaluateWarOutcome()` | ✅ | — |
| 撤退判定 | `attacker.ts: markRetreat()` | ✅ | 纯 HP 比例 |
| Decision Trace | `decision-trace-system.ts` | ✅ | 无 THREAT 类别 |

---

## 5. 架构不变量验证（A5.0 INV-1 ~ INV-8）

| INV | 验证结果 |
|---|---|
| INV-1 Military 禁止直接操作 Resource | ✅ 现有代码遵守 |
| INV-2 Military 禁止直接创建 Transport | ✅ 现有代码遵守 |
| INV-3 Military 禁止直接创建 Spawn | ✅ 通过 submitRequest → spawn-manager |
| INV-4 Military 禁止直接修改 Economy | ✅ 通过 posture → Policy |
| INV-5 Military 禁止直接改写 RoomState | ✅ 只读消费 RoomSnapshot |
| INV-6 Defense 禁止反打出门 | ✅ tower-defense 不跨房 |
| INV-7 war posture 唯一进攻授权 | ✅ war-planner 只在 posture=war 时激活 |
| INV-8 止损链不可绕过 | ✅ isAttritionLost 硬编码 |

**A5.1 新增代码必须遵守全部 INV**。

---

## 6. 集成方案

### 6.1 G2 → G1 依赖（共享 body 解析）

G2 (`capability.ts`) 是 G1 (`threat-assessment.ts`) 的基础：
- G1 需要评估敌方战力 → 调用 G2 的 `evaluateCombatCapability()`
- **禁止出现两套 body 解析算法**
- 实现顺序：**先 G2，后 G1**

### 6.2 G1 → room-state.ts 集成

```text
roomStateSystem.run:
  threatCount = snapshot.threatCreeps.length
  ↓ [新增] 调用 assessThreat() → ThreatAssessment
  ↓ [新增] 写入 globalCache.threatAssessments[roomName]
  ↓ [保持] colonyState 判定（可选择性消费 recommendedPosture）
```

- **不破坏现有 RoomState 接口**
- ThreatAssessment 存 globalCache（heap，TTL = 1 tick），不进 Memory
- `threatCount` 仍是 ColonyState 的快速通道；ThreatAssessment 是增量信息

### 6.3 G1 → tower-defense.ts 集成

```text
towerDefenseSystem.run:
  ↓ [新增] 读取 globalCache.threatAssessments[roomName]
  ↓ [增强] selectFocusTarget 消费 estimatedIntent 优化目标选择
  ↓ [增强] assessEngagement 消费 estimatedPower.heal 替代 totalHealParts
```

### 6.4 G4 → remote-mining-manager.ts 集成

```text
remoteMiningManagerSystem.run:
  collectRemoteThreats → [替代] decideRemoteDefenseAction()
  ↓ CONTINUE → 正常运营
  ↓ PAUSE → op.state = "paused" (保留 op)
  ↓ ESCORT → 输出 escortDemand (走 spawn 通道)
  ↓ RETREAT → 标记 creep recycle + op.threatUntil
  ↓ ABORT → op.state = "abandoned"
```

### 6.5 Decision Trace 集成

```text
[新增] collectThreatDecisions():
  从 globalCache.threatAssessments 构建 DecisionRecord
  category = "DEFENSE_PREP"
  evidence = { level, score, intent, confidence, sources }
```

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| assessThreat 每 tick 全量 body 分析导致 CPU 热点 | MEDIUM | P0 降级 | 纯函数 O(hostiles)；body 解析结果缓存在 globalCache（1 tick TTL） |
| G1/G2 集成破坏现有 defense 行为 | LOW | 防御失效 | 增量集成——不替换现有逻辑，只增强信号 |
| G4 决策误判导致远矿误放弃 | MEDIUM | 远矿损失 | 纯函数可回放 + 测试覆盖 + ABORT 需多重条件 |
| Boost 倍率计算错误 | LOW | 战力评估失准 | 已用引擎常量校准（§3.2） |

---

## 8. 结论

现有代码的威胁检测链是**数量驱动的**（threatCount、totalHealParts、findClosestByRange），缺乏结构化的战力评估和意图推断。A5.1 的三个纯函数将填补这一缺口：

1. **G2 (`capability.ts`)** 是基础——从 body 解析出结构化战力数据
2. **G1 (`threat-assessment.ts`)** 消费 G2——综合战力 + intent + 置信度 → ThreatAssessment
3. **G4 (`remote-defense.ts`)** 消费 G1——远矿经济价值 vs 威胁风险 → 五级决策

集成方式：增量注入 globalCache，不替换现有快速通道，不破坏 INV-1~INV-8。
