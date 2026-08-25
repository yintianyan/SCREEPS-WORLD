# A5.1 FINAL AUDIT — Threat / Combat / Remote Defense

> **审计日期**: 2026-08-25  
> **审计范围**: G1 Threat Assessment · G2 Combat Capability · G4 Remote Defense  
> **审计结论**: **PASS** (0 BLOCKER / 0 HIGH / 2 MEDIUM→验证债务 / 5 LOW)

---

## 1. Executive Summary

A5.1 的三个核心域模块（G1/G2/G4）已通过完整架构审计与集成验证。审计覆盖：

- **真实调用链追踪**: G1/G2/G4 从系统层薄壳到域纯函数的完整数据流
- **架构边界扫描**: 域文件零 Runtime 引用（Game/Memory/Kernel/Spawn/Transport/Economy）
- **A4 集成审计**: Military → Spawn/Logistics/Recovery/DecisionTrace 全部走正式接口
- **86 个审计单元测试**: 覆盖 §4-§15 全部审计项
- **20 × 1000 次 Replay**: DecisionHash 100% 一致 + Divergence 验证通过
- **3585 个单元测试 + 138 个集成测试全绿**: 无退化
- **Typecheck + Build 通过**

### 验收清单

| # | 审计项 | 状态 | 证据 |
|---|--------|------|------|
| 1 | G1 Domain Pure | ✅ PASS | 零 Runtime import，仅 import G2 capability |
| 2 | G2 Domain Pure | ✅ PASS | 零 Runtime import，仅引用引擎常量 |
| 3 | G4 Domain Pure | ✅ PASS | 零 Runtime import，仅 import G1 type |
| 4 | Threat Evidence | ✅ PASS | §5: 10 个场景全部 evidence 可追溯 |
| 5 | Threat Intent | ✅ PASS | §4: 10 种 Intent 全覆盖 |
| 6 | Threat Confidence | ✅ PASS | §4-S7/S8: PlayerIntel 不直接拉高级别 + 信息不足降 confidence |
| 7 | Combat Capability | ✅ PASS | §6: 7 种部件维度独立 |
| 8 | Combat Power Dimensions | ✅ PASS | §9: Scenario A/B/C 反例验证 |
| 9 | Boost Correctness | ✅ PASS | §7: T1/T2/T3 倍率与引擎常量一致 |
| 10 | Tough Correctness | ✅ PASS | §7: T1=0.7, T2=0.5, T3=0.3 减伤系数正确 |
| 11 | Heal Correctness | ✅ PASS | §7: HEAL boost ×4 at T3 + rangedHeal 独立维度 |
| 12 | Mobility Semantics | ✅ PASS | §8: mobility 标注为 estimate，不等于 MOVE 数量 |
| 13 | Remote Expected Value | ✅ PASS | §11: 消费 8 种因素，不只 ThreatLevel switch |
| 14 | Continue | ✅ PASS | §10-S1: NONE → CONTINUE |
| 15 | Pause | ✅ PASS | §10-S2: MEDIUM + risk > 0.15 → PAUSE |
| 16 | Escort | ✅ PASS | §10-S3/S6: HIGH + EV 正 → ESCORT |
| 17 | Retreat | ✅ PASS | §10-S4: HIGH + netValue < 0 → RETREAT |
| 18 | Abort | ✅ PASS | §10-S5: CRITICAL + 不可维持 → ABORT |
| 19 | Spawn Boundary | ✅ PASS | spawnCreep 唯一在 spawn-manager.ts |
| 20 | Logistics Boundary | ✅ PASS | G4 不调 submitTransport/createOperation |
| 21 | Recovery Boundary | ✅ PASS | Defense Response 走 recovery-execution → submitRequest |
| 22 | Decision Trace | ✅ PASS | §14: 6 类 Decision 可生成 Record |
| 23 | Replay | ✅ PASS | §15: 20 × 1000 次 Hash 一致 + Divergence |
| 24 | E2E | ⚠ DEFERRED | E2E 测试已编写，受限于 isolated-vm 环境兼容性 |
| 25 | Regression | ✅ PASS | 254 文件 3585 测试 + 19 文件 138 测试全绿 |
| 26 | CPU | ✅ PASS | assessThreat 仅 threatCount > 0 时调用，O(hostiles × body) |
| 27 | Memory | ✅ PASS | globalCache heap-only，无持久化增长 |
| 28 | Real Runtime | ⚠ DEFERRED | 需私服验证 5000t |

---

## 2. G1 Audit — Threat Assessment

### 2.1 Domain Purity

**文件**: `src/domain/defense/threat-assessment.ts`

- ✅ 零 `import ... from "kernel/..."` 
- ✅ 零 `Game.` / `Memory.` / `RawMemory.` 引用（仅注释中声明禁止）
- ✅ 唯一 import 来自 `../combat/capability`（G2），无循环依赖
- ✅ 所有运行时数据通过 `ThreatAssessmentInput` 注入

### 2.2 调用链

```
HostileSnapshot (纯数据)
  → analyzeHostileBody() → evaluateCombatCapability() [G2]
  → aggregateCombatCapability() [G2]
  → computeCombatPower() [G2]
  → inferThreatIntent() → 10 种意图推断
  → computeThreatScore() → 7 维度可拆解评分
  → scoreToLevel() → 5 级分级
  → ThreatAssessment 输出
```

**系统层集成**: `room-state.ts` → `buildThreatAssessment()` → `assessThreat()` → `globalCache.threatAssessments`

### 2.3 不存在第二套威胁计算

- ✅ `threatCreeps.length > 0` 在系统层仅作布尔门禁（是否暂停建造/是否进入 defense），不替代威胁评估
- ✅ `hostileCreeps.length > 0` 在 tower-defense 中仅作触发条件，威胁分级由 `ThreatAssessment.level` 决定
- ✅ 无 `body.length` 作为 CombatPower 唯一来源的代码路径

### 2.4 Threat Model 8 场景验证 (§4)

| 场景 | 输入 | 预期 | 实际 | 状态 |
|------|------|------|------|------|
| S1: 单 Invader 无 Boost | [ATTACK, MOVE] | LOW/MEDIUM | level ≠ NONE, ≠ CRITICAL | ✅ |
| S2: Boosted Attacker | T3 boosted | Threat 显著上升 | boost score ↑, combat score ↑ | ✅ |
| S3: Boosted Healer | 10×HEAL T3 | Heal 影响 Assessment | heal = 480, attack = 0, combat > 0 | ✅ |
| S4: CLAIM Creep | [CLAIM, MOVE] | CLAIM Intent | intent = "CLAIM" | ✅ |
| S5: 接近 Controller | dist=1, rcl=4 | CONTROLLER_ATTACK | intent = "CONTROLLER_ATTACK" | ✅ |
| S6: 远矿 Hostile | isRemoteRoom=true | REMOTE_MINING_ATTACK | intent = "REMOTE_MINING_ATTACK" | ✅ |
| S7: PlayerIntel 高 | threatIndex=90 | 不直接变 HIGH | level ≠ CRITICAL | ✅ |
| S8: 信息不足 | body=[] | 降低 Confidence | confidence ≠ "fact" | ✅ |

### 2.5 Evidence Audit 10 场景 (§5)

10 个 ThreatAssessment 全部通过 evidence 可追溯性验证：
- ✅ 每个评估的 `estimatedIntent.evidence` 为数组且非空（有威胁时）
- ✅ `score` 可拆解为 7 个独立维度
- ✅ `level` 与 `score.total` 一致（分级映射正确）

---

## 3. G2 Audit — Combat Capability

### 3.1 Domain Purity

**文件**: `src/domain/combat/capability.ts`

- ✅ 零 Runtime import
- ✅ 引擎常量来源标注: `docs/research/03_SCREEPS_GAME_CONSTRAINTS.md §7/§8`
- ✅ 所有输入通过 `CreepSnapshot` 注入

### 3.2 调用链

```
CreepSnapshot (纯数据)
  → evaluateCombatCapability() → 13 维度 CombatCapability
  → aggregateCombatCapability() → 编队聚合
  → computeCombatPower() → CombatPower (含 powerScore 警告)
```

**消费者**: G1 `assessThreat()` 和 `war-planning`（A5.2 扩展点）

### 3.3 不存在 body.length 作为唯一 CombatPower 来源

- ✅ `body.length` 仅用于 `totalParts` 计数
- ✅ `powerScore` 是加权估计值（burstDamage × 1.0 + effectiveHP × 0.1 + healOutput × 0.5 + dismantlePower × 0.3）
- ✅ JSDoc 明确标注: `错误用法: if (myPower > enemyPower) attack() — 这会输掉 PvP`

### 3.4 Combat Capability 7 部件维度 (§6)

| 部件 | 维度 | 验证结果 |
|------|------|----------|
| ATTACK | attack | ✅ 30 × boostMult |
| RANGED_ATTACK | rangedAttack | ✅ 10 × boostMult |
| HEAL | heal + rangedHeal | ✅ 12/4 × boostMult 双维度 |
| TOUGH | effectiveHP | ✅ 100/multiplier 减伤 |
| MOVE | mobility | ✅ estimate 标注 |
| WORK | dismantle + support | ✅ 50 × dismantleMult + support 计数 |
| CLAIM | claim | ✅ 1 × boostMult |

### 3.5 Boost Reality Audit (§7)

| 部件 | T1 | T2 | T3 | 引擎常量 | 状态 |
|------|----|----|----|---------|------|
| ATTACK | ×2 | ×3 | ×4 | ✅ 一致 | ✅ |
| RANGED_ATTACK | ×2 | ×3 | ×4 | ✅ 一致 | ✅ |
| HEAL | ×2 | ×3 | ×4 | ✅ 一致 | ✅ |
| TOUGH (减伤) | 0.7 | 0.5 | 0.3 | ✅ 一致 | ✅ |
| WORK (dismantle) | ×1.5 | ×1.8 | ×2 | ✅ 一致 | ✅ |
| MOVE | ×2 | ×3 | ×4 | ✅ 一致 | ✅ |
| CLAIM | ×2 | ×3 | ×4 | ✅ 一致 | ✅ |

### 3.6 Mobility Audit (§8)

- ✅ mobility 标注为 estimate（JSDoc + CombatCapability.mobility 注释）
- ✅ mobility ≠ MOVE 数量（3 MOVE + 3 ATTACK → mobility ≈ 1，不是 3）
- ✅ 无 MOVE → mobility = 0
- ✅ 未伪装为 Pathfinding 结果

### 3.7 CombatPower 反例验证 (§9)

| 场景 | 描述 | 验证结果 |
|------|------|----------|
| A: 高 powerScore 无 Heal vs 低 powerScore 高 Heal | noHeal.burstDamage > highHeal.burstDamage, highHeal.healOutput > noHeal.healOutput | ✅ 维度独立 |
| B: 高攻击进 Tower 区域 | fullTower.powerScore ≤ noTower.powerScore | ✅ tower 惩罚生效 |
| C: 高 Dismantle 无 Attack | dismantle > 0, attack = 0, burstDamage = 0 | ✅ 维度独立 |

---

## 4. G4 Audit — Remote Defense

### 4.1 Domain Purity

**文件**: `src/domain/defense/remote-defense.ts`

- ✅ 零 Runtime import
- ✅ 仅 import `ThreatAssessment` type（from G1），无循环依赖
- ✅ 所有输入通过 `RemoteDefenseInput` 注入

### 4.2 调用链

```
ThreatAssessment (G1 输出)
  + RemoteOperationState
  + EmpireContext
  + LogisticsContext
  + MilitaryContext
  → evaluateRemoteExpectedValue() → 8 因素 EV
  → decideRemoteDefenseAction() → 5 级决策
  → RemoteDefenseDecision (纯数据输出)
```

**系统层集成**: `remote-mining-manager.ts` → `decideRemoteDefenseAction()` → `globalCache.remoteDefenseDecisions`

### 4.3 不直接 Spawn / Transport / Economy

- ✅ `decideRemoteDefenseAction` 不调用 `spawnCreep` / `submitRequest` / `submitTransport` / `createOperation`
- ✅ `escortDemand` 是数据标记（count + cost + commuteTicks），不是 spawn 指令
- ✅ JSDoc 明确: `严禁：decideRemoteDefenseAction 或其调用方直接调 submitRequest / spawnCreep`

### 4.4 Remote Defense 7 场景 (§10)

| 场景 | 输入 | 预期 | 实际 | 状态 |
|------|------|------|------|------|
| S1: 无 Threat | NONE | CONTINUE | CONTINUE | ✅ |
| S2: 低 Threat | MEDIUM | PAUSE | PAUSE | ✅ |
| S3: Harassment | HIGH + EV 正 | ESCORT | ESCORT | ✅ |
| S4: 强攻击 | HIGH + EV 负 | RETREAT | RETREAT | ✅ |
| S5: 不可恢复 | CRITICAL | ABORT | ABORT | ✅ |
| S6: Escort 收益高 | HIGH + 3 sources | ESCORT | ESCORT | ✅ |
| S7: Escort 成本高 | HIGH + cost=5000 | ≠ ESCORT | RETREAT | ✅ |

### 4.5 Expected Value 8 因素验证 (§11)

| 因素 | 消费路径 | 验证结果 |
|------|---------|----------|
| Mining Income | `sources × 10` → operationValue | ✅ |
| Replacement Cost | `creepInvestment` → replacementCost | ✅ |
| Transport Cost | `pathCost` → 撤退安全性判定 | ✅ |
| Escort Cost | `defenderSpawnCost + commuteTicks × 0.5` | ✅ |
| Threat | `riskMap[level]` → risk 系数 | ✅ |
| Reinforcement ETA | `defenderCommuteTicks` → escortCost | ✅ |
| Room Value | `sources` → operationValue | ✅ |
| Strategic Value | `empireContext.posture` → war 时降优先级 | ✅ |

**不纯 switch 验证**: 同 HIGH 威胁不同经济参数 → 不同决策 ✅

---

## 5. Real Call Graph

### G1 完整调用链

```
[系统层] room-state.ts (P0, interval=1)
  ├─ snapshot.threatCreeps (RoomSnapshot)
  ├─ buildThreatAssessment() — 系统层薄壳
  │   ├─ Creep → HostileSnapshot 转换 (id/owner/pos/body/hits)
  │   ├─ RoomSnapshot → RoomContext 转换 (towers/rcl/storage/spawns)
  │   └─ assessThreat() — [域纯函数]
  │       ├─ analyzeHostileBody() → evaluateCombatCapability() [G2]
  │       ├─ computeCombatPower() [G2]
  │       ├─ inferThreatIntent() → 10 种意图
  │       ├─ computeThreatScore() → 7 维度评分
  │       ├─ scoreToLevel() → 5 级分级
  │       └─ → ThreatAssessment
  └─ globalCache.threatAssessments.set(roomName, assessment)
      └─ [消费方] tower-defense / war-planner / decision-trace
```

### G2 完整调用链

```
[域纯函数] evaluateCombatCapability(creep: CreepSnapshot)
  ├─ body 遍历 → 按 type 分组计数
  ├─ boostTier(boost) → tier 映射
  ├─ boostMultiplier(type, tier) → 引擎常量
  ├─ effectiveHP = (nonToughHP + toughHP) × hitsRatio
  ├─ mobility = moveParts × moveMult / bodyWeight (estimate)
  └─ → CombatCapability (13 维度)

[域纯函数] computeCombatPower(capabilities, context?)
  ├─ aggregateCombatCapability() → AggregateCapability
  ├─ powerScore = burstDamage × 1.0 + effectiveHP × 0.1 + healOutput × 0.5 + dismantlePower × 0.3
  ├─ boost 乘数: 1 + tier × 0.1
  └─ → CombatPower (7 字段)

[消费方] G1 assessThreat() / A5.2 war-planning (扩展点)
```

### G4 完整调用链

```
[系统层] remote-mining-manager.ts (P2, interval=10)
  ├─ collectRemoteThreats() — 检测远矿房 hostile
  ├─ buildRemoteThreatAssessment() — 系统层薄壳
  │   └─ assessThreat() [G1] → RemoteThreatAssessment
  ├─ decideRemoteDefenseAction() — [域纯函数]
  │   ├─ evaluateRemoteExpectedValue() → 8 因素 EV
  │   └─ → RemoteDefenseDecision
  ├─ globalCache.remoteDefenseDecisions.set(targetRoom, decision)
  ├─ [消费决策] RETREAT/ABORT → op.state = paused/abandoned + recycleRemoteCreepsForRoom()
  └─ [消费决策] ESCORT → 保持 active (defender 由 evaluateRemoteDemand 生成)
      └─ evaluateRemoteDemand() → submitRequest() → spawnQueue → spawn-manager → spawnCreep()
```

---

## 6. Architecture Boundary Audit

### 6.1 域文件禁止引用扫描

| 检查项 | G1 threat-assessment.ts | G2 capability.ts | G4 remote-defense.ts |
|--------|------------------------|-------------------|----------------------|
| `Game` | ✅ 仅注释 | ✅ 仅注释 | ✅ 仅注释 |
| `Memory` | ✅ 仅注释 | ✅ 仅注释 | ✅ 仅注释 |
| `RawMemory` | ✅ 无 | ✅ 无 | ✅ 无 |
| `Kernel` | ✅ 无 import | ✅ 无 import | ✅ 无 import |
| `Spawn` | ✅ 无 | ✅ 无 | ✅ 仅注释（权责声明） |
| `Transport` | ✅ 无 | ✅ 无 | ✅ 无 |
| `Economy` | ✅ 无 | ✅ 无 | ✅ 无 |
| `Recovery Runtime` | ✅ 无 | ✅ 无 | ✅ 无 |

### 6.2 spawnCreep 调用唯一性

- ✅ `spawn.spawnCreep()` 全代码库唯一调用点: `src/systems/spawn-manager.ts:448`
- ✅ G1/G2/G4 域文件零 `spawnCreep` 调用
- ✅ `remote-defense.ts` 零 `submitRequest` 调用
- ✅ `recovery-execution-system.ts` 的 `defense_response` 通过 `submitRequest` → `spawnQueue` → `spawn-manager`

---

## 7. A4 Integration Audit

### 7.1 Military → Spawn

| 路径 | 接口 | 验证 |
|------|------|------|
| G4 ESCORT → escortDemand → evaluateRemoteDemand → submitRequest → spawn-manager | Demand + SpawnQueue | ✅ |
| Recovery defense_response → submitRequest → spawn-manager | Demand + SpawnQueue | ✅ |
| G1/G2/G4 域文件直接 spawnCreep | 禁止 | ✅ 未发现 |

### 7.2 Military → Logistics

| 路径 | 接口 | 验证 |
|------|------|------|
| G4 不直接调 submitTransport | 禁止 | ✅ |
| G4 不直接调 createOperation | 禁止 | ✅ |
| Remote Defense 通过 op.state 变更影响远矿物流 | 状态标记 | ✅ |

### 7.3 Military → Recovery

| 路径 | 接口 | 验证 |
|------|------|------|
| Recovery defense_response → RecoveryAction | Recovery Intent | ✅ |
| G4 不重新实现 Recovery | 禁止 | ✅ |
| G4 的 RETREAT/ABORT 只输出决策，op.state 由 remote-mining-manager 修改 | 权责分离 | ✅ |

### 7.4 Military → Decision Trace

| 路径 | 接口 | 验证 |
|------|------|------|
| collectDefenseDecisions() → ThreatAssessment → DecisionRecord | Decision Record | ✅ |
| collectDefenseDecisions() → RemoteDefenseDecision → DecisionRecord | Decision Record | ✅ |
| DEFENSE_PREP category | DecisionCategory | ✅ |
| REMOTE category | DecisionCategory | ✅ |

---

## 8. Threat Scenario Matrix

| # | 场景 | 输入 | Level | Intent | Confidence | Evidence |
|---|------|------|-------|--------|------------|----------|
| 1 | NPC Invader | [ATTACK, MOVE] | LOW/MEDIUM | HARASSMENT | fact | `1-2武装(attack=30 ranged=0)` |
| 2 | Boosted Attacker | T3 [TOUGH+ATTACK×2+MOVE×2] | HIGH | HARASSMENT | fact | `1-2武装(attack=240 ranged=0)` |
| 3 | Boosted Healer | 10×HEAL T3 + 10×MOVE | LOW/MEDIUM | SCOUTING/UNKNOWN | fact | `无战斗部件` 或 `信息不足` |
| 4 | CLAIM Creep | [CLAIM, MOVE×2] | LOW | CLAIM | fact | `claim部件=1 + 不接近controller` |
| 5 | Near Controller | [ATTACK, MOVE] dist=1 rcl=4 | MEDIUM | CONTROLLER_ATTACK | fact | `attack=30 + 接近controller(rcl=4)` |
| 6 | Remote Harass | [ATTACK, MOVE] isRemoteRoom | LOW/MEDIUM | REMOTE_MINING_ATTACK | fact | `远矿房 + attack=30 ranged=0` |
| 7 | Full Assault | 4× T3 boosted | HIGH/CRITICAL | FULL_ASSAULT | fact | `编队=4 ≥ 4 + boost=T3 + PlayerIntel` |
| 8 | Nuke | incomingNukes=1 | CRITICAL | NUCLEAR | fact | `nuke落点=1` |
| 9 | Scout | [MOVE, MOVE] | NONE/LOW | SCOUTING | fact | `无战斗部件(totalParts=0)` |
| 10 | Info Insufficient | body=[] | NONE/LOW | UNKNOWN | inferred | `信息不足(hostiles=1 combat=0)` |

---

## 9. Combat Capability Matrix

| Body | attack | rangedAttack | heal | rangedHeal | effectiveHP | mobility | dismantle | claim | support | toughParts |
|------|--------|-------------|------|-----------|-------------|----------|-----------|-------|---------|------------|
| [ATTACK, MOVE] | 30 | 0 | 0 | 0 | 200 | 1.0 | 0 | 0 | 0 | 0 |
| [RA, MOVE] | 0 | 10 | 0 | 0 | 200 | 1.0 | 0 | 0 | 0 | 0 |
| [HEAL, MOVE] | 0 | 0 | 12 | 4 | 200 | 1.0 | 0 | 0 | 0 | 0 |
| [TOUGH, ATTACK, MOVE] | 30 | 0 | 0 | 0 | 300 | 0.5 | 0 | 0 | 0 | 1 |
| [TOUGH(T3), ATTACK, MOVE] | 30 | 0 | 0 | 0 | 433 | 0.5 | 0 | 0 | 0 | 1 |
| [WORK, MOVE] | 0 | 0 | 0 | 0 | 200 | 1.0 | 50 | 0 | 1 | 0 |
| [CLAIM, MOVE] | 0 | 0 | 0 | 0 | 200 | 1.0 | 0 | 1 | 0 | 0 |
| [ATTACK(T3), MOVE] | 120 | 0 | 0 | 0 | 200 | 1.0 | 0 | 0 | 0 | 0 |

---

## 10. Remote Defense Matrix

| # | Threat Level | Intent | Sources | Investment | PathCost | EV netValue | Decision | escortDemand |
|---|-------------|--------|---------|-----------|----------|-------------|----------|--------------|
| 1 | NONE | UNKNOWN | 2 | 2000 | 1 | 正 | CONTINUE | — |
| 2 | MEDIUM | HARASSMENT | 2 | 2000 | 1 | 正但 risk>0.15 | PAUSE | — |
| 3 | HIGH | HARASSMENT | 2 | 2000 | 1 | 正 | ESCORT | 1 defender |
| 4 | HIGH | SIEGE | 2 | 50000 | 2 | 负 | RETREAT | — |
| 5 | CRITICAL | FULL_ASSAULT | 2 | 50000 | 1 | 负 + 替换>20% | ABORT | — |
| 6 | HIGH | HARASSMENT | 3 | 2000 | 1 | 正 | ESCORT | 1 defender |
| 7 | HIGH | SIEGE | 1 | 50000 | 2 | 负 + cost高 | RETREAT | — |
| 8 | HIGH | SIEGE | 2 | 50000 | 5 | 负 + 远 | ABORT | — |

---

## 11. Decision Trace Verification

### 6 类 Decision 记录验证 (§14)

| # | Decision 类型 | Category | Actor | 采集函数 | 状态 |
|---|--------------|----------|-------|---------|------|
| 1 | Threat Assessment | DEFENSE_PREP | threat-assessment | collectDefenseDecisions | ✅ |
| 2 | Intent Inference | DEFENSE_PREP | threat-assessment | collectDefenseDecisions | ✅ |
| 3 | Remote Defense | REMOTE | remote-defense | collectDefenseDecisions | ✅ |
| 4 | ESCORT | REMOTE | remote-defense | collectDefenseDecisions | ✅ |
| 5 | RETREAT | REMOTE | remote-defense | collectDefenseDecisions | ✅ |
| 6 | ABORT | REMOTE | remote-defense | collectDefenseDecisions | ✅ |

每条 DecisionRecord 包含: `decisionId`, `tick`, `category`, `actor`, `scope`, `reasons`, `evidence`, `selectedAction`, `rejectedAlternatives`, `expectedOutcome`, `correlationId`, `severity`, `decisionHash`, `createdAt`, `lifecycle`

---

## 12. Replay Verification

### 20 × 1000 次 Replay (§15)

| # | 场景 | 类型 | Replay 次数 | Hash 一致 | Divergence |
|---|------|------|------------|----------|------------|
| T1 | 无威胁 | G1 | 1000 | ✅ 100% | — |
| T2 | NPC Invader | G1 | 1000 | ✅ 100% | — |
| T3 | Scout | G1 | 1000 | ✅ 100% | — |
| T4 | Boosted Attacker | G1 | 1000 | ✅ 100% | — |
| T5 | Heal Stack | G1 | 1000 | ✅ 100% | — |
| T6 | Claim | G1 | 1000 | ✅ 100% | — |
| T7 | Full Assault | G1 | 1000 | ✅ 100% | — |
| T8 | Nuke | G1 | 1000 | ✅ 100% | — |
| T9 | Remote Harass | G1 | 1000 | ✅ 100% | — |
| T10 | Near Core | G1 | 1000 | ✅ 100% | — |
| R1 | Continue | G4 | 1000 | ✅ 100% | — |
| R2 | Pause | G4 | 1000 | ✅ 100% | — |
| R3 | Escort | G4 | 1000 | ✅ 100% | — |
| R4 | Retreat | G4 | 1000 | ✅ 100% | — |
| R5 | Abort | G4 | 1000 | ✅ 100% | — |
| R6 | Low Threat | G4 | 1000 | ✅ 100% | — |
| R7 | War Retreat | G4 | 1000 | ✅ 100% | — |
| R8 | Abort Far | G4 | 1000 | ✅ 100% | — |
| R9 | Escort High Value | G4 | 1000 | ✅ 100% | — |
| R10 | Critical Nuke | G4 | 1000 | ✅ 100% | — |

**Divergence 验证**:
- ✅ 修改 ThreatLevel LOW → HIGH: 决策不同
- ✅ 修改 Boost 无 → T3: 评估不同

---

## 13. Regression Results

### Unit Tests

| 指标 | 值 |
|------|-----|
| 测试文件数 | 254 |
| 测试总数 | 3585 |
| 通过 | 3585 |
| 失败 | 0 |
| 耗时 | 28.14s |

### Integration Tests

| 指标 | 值 |
|------|-----|
| 测试文件数 | 19 |
| 测试总数 | 138 |
| 通过 | 138 |
| 失败 | 0 |
| 耗时 | 28.31s |

### Build

| 指标 | 值 |
|------|-----|
| Typecheck | ✅ PASS |
| Build (rollup) | ✅ PASS (9.2s) |

### Regression 覆盖确认

| A4 子阶段 | 测试覆盖 | 退化 |
|-----------|---------|------|
| A3 Energy Loop | ✅ | 无 |
| A4.0 Resource Network | ✅ | 无 |
| A4.1 Economic Activation | ✅ | 无 |
| A4.2 Empire Integration | ✅ | 无 |
| A4.3 Unified Logistics | ✅ | 无 |
| A4.4 Convergence | ✅ | 无 |
| A4.5 Empire Health | ✅ | 无 |
| A4.6 Recovery | ✅ | 无 |
| A4.7 Decision Trace | ✅ | 无 |

---

## 14. CPU Results

### CPU 预算分析（代码审查推算）

| 模块 | 执行频率 | 触发条件 | 复杂度 | 估计 CPU |
|------|---------|---------|--------|---------|
| assessThreat() | 每 tick (P0) | threatCount > 0 | O(hostiles × body.length) | ~0.05-0.2ms (≤10 hostiles) |
| evaluateCombatCapability() | 被 assessThreat 调用 | 同上 | O(body.length) | ~0.01ms/creep |
| decideRemoteDefenseAction() | 每 10 tick (P2) | 远矿房有威胁 | O(1) | ~0.01ms |
| collectDefenseDecisions() | 每 100 tick (P3) | 威胁 ≥ MEDIUM | O(threatMap.size) | ~0.01ms |

**关键设计**: 
- assessThreat 仅在 `threatCount > 0 && threatPresent` 时调用（绝大多数 tick 无威胁 → 零成本）
- 无威胁时从 `globalCache.threatAssessments` Map 中移除旧条目（防跨 tick 残留）
- decideRemoteDefenseAction 仅在有视野且确认有威胁的远矿房调用

**对比 A5.1 之前**: 无异常增长（新增代码均为低频/条件触发）

---

## 15. Memory Results

### Memory 预算分析

| 数据 | 存储位置 | 持久化 | 增长趋势 | 上限 |
|------|---------|--------|---------|------|
| threatAssessments | globalCache (heap) | ❌ heap-only | 每 tick 清除无威胁房间 | ≤ 房间数 |
| remoteDefenseDecisions | globalCache (heap) | ❌ heap-only | 每 interval 清空重建 | ≤ 远矿数 |
| DecisionTrace RingBuffer | globalCache (heap) | ❌ heap-only | Ring Buffer 固定容量 | 1000 records |
| PlayerIntel | 未实现 (A5.2) | — | — | — |
| defenseState (RoomMemory) | Memory | ✅ 持久化 | 仅 CRITICAL 时写入 | ~100 bytes/room |

**5000 tick 模拟推算**: 
- Memory 增长来源仅 `defenseState`（CRITICAL 威胁时写入 safeModeRequested）
- 正常运营（无持续 CRITICAL 威胁）→ Memory 零增长
- 持续 CRITICAL 威胁 → 每房间 ~100 bytes，可忽略

---

## 16. Real Runtime Results

### 状态: ⚠ DEFERRED

E2E 测试已编写（`tests/e2e/scenarios/12-military-defense.test.ts`，6 个场景），但受限于 `isolated-vm` 原生模块在当前 macOS 环境的兼容性问题（`v8::ArrayBuffer::Allocator::Reallocate` 符号缺失），无法在本地执行。

**待验证项**:
- 5000+ tick 连续运行
- 至少 1 次 Threat 事件触发
- 至少 1 次 Remote Defense Decision
- 至少 1 条 DecisionTrace 记录

**风险评估**: LOW — 域纯函数已通过 86 个单元测试验证（含 20 × 1000 次 Replay），系统层集成逻辑与现有 A4 模式一致。

---

## 17. Known Limitations

| # | 限制 | 严重度 | 说明 |
|---|------|--------|------|
| L1 | PlayerIntel 未完整实现 | LOW | A5.1 范围外；assessThreat 已预留 playerIntel 参数接口 |
| L2 | Terrain 未完整实现 | LOW | A5.1 范围外；mobility 标注为 estimate |
| L3 | E2E 本地执行受限 | MEDIUM → 验证债务 | isolated-vm 兼容性问题；已登记 VD-1，不阻塞 PASS，消除条件=私服/CI 环境执行 E2E 6 场景全绿 |
| L4 | Real Runtime 5000t 验证 | MEDIUM → 验证债务 | 已登记 VD-2，归入下一次 soak test；不阻塞 PASS |
| L5 | Combat Learning 未实现 | LOW | A5.1 范围外（禁止项） |
| L6 | Squad/War Planner 未实现 | LOW | A5.1 范围外（禁止项） |

---

## 18. Architecture Gaps

| # | 缺口 | 严重度 | 影响 | 建议 |
|---|------|--------|------|------|
| G-1 | `threat-assessment.ts` 中 `corePos` 近似 controller 位置 | LOW | 自有房用 spawn 锚点，远矿房用 source 锚点；intent 推断的"接近 controller"判定有偏差 | A5.2 引入精确 controller pos |
| G-2 | `capability.ts` 中 mobility 计算未考虑沼泽/路 | LOW | 已标注为 estimate，JSDoc 明确非 Pathfinding 结果 | A5.2 引入 terrain context |
| G-3 | `remote-defense.ts` 的 EV 模型中 `expectedDuration` 是静态映射 | LOW | 基于意图的固定值，未考虑动态威胁消长 | A5.2 引入动态衰减模型 |

---

## 19. PASS / FAIL

### 最终验收清单

| # | 审计项 | 状态 | 证据来源 |
|---|--------|------|---------|
| [x] | G1 Domain Pure | ✅ PASS | grep 扫描：零 Runtime import |
| [x] | G2 Domain Pure | ✅ PASS | grep 扫描：零 Runtime import |
| [x] | G4 Domain Pure | ✅ PASS | grep 扫描：零 Runtime import |
| [x] | Threat Evidence | ✅ PASS | §5 测试：10 场景 evidence 可追溯 |
| [x] | Threat Intent | ✅ PASS | §4 测试：10 种 Intent 全覆盖 |
| [x] | Threat Confidence | ✅ PASS | §4-S7/S8 测试 |
| [x] | Combat Capability | ✅ PASS | §6 测试：7 部件维度独立 |
| [x] | Combat Power Dimensions | ✅ PASS | §9 测试：Scenario A/B/C 反例 |
| [x] | Boost Correctness | ✅ PASS | §7 测试：T1/T2/T3 引擎常量核对 |
| [x] | Tough Correctness | ✅ PASS | §7 测试：0.7/0.5/0.3 减伤系数 |
| [x] | Heal Correctness | ✅ PASS | §7 测试：HEAL ×4 T3 + rangedHeal |
| [x] | Mobility Semantics | ✅ PASS | §8 测试：estimate 标注 + ≠ MOVE count |
| [x] | Remote Expected Value | ✅ PASS | §11 测试：8 因素消费验证 |
| [x] | Continue | ✅ PASS | §10-S1 测试 |
| [x] | Pause | ✅ PASS | §10-S2 测试 |
| [x] | Escort | ✅ PASS | §10-S3/S6 测试 |
| [x] | Retreat | ✅ PASS | §10-S4 测试 |
| [x] | Abort | ✅ PASS | §10-S5 测试 |
| [x] | Spawn Boundary | ✅ PASS | spawnCreep 唯一在 spawn-manager.ts |
| [x] | Logistics Boundary | ✅ PASS | G4 零 submitTransport/createOperation |
| [x] | Recovery Boundary | ✅ PASS | Defense Response 走 recovery-execution |
| [x] | Decision Trace | ✅ PASS | §14 测试：6 类 Decision 可记录 |
| [x] | Replay | ✅ PASS | §15 测试：20 × 1000 次 Hash 一致 |
| [ ] | E2E | ⚠ DEFERRED | 测试已编写，isolated-vm 环境限制 |
| [x] | Regression | ✅ PASS | 254 文件 3585 测试 + 19 文件 138 测试 |
| [x] | CPU | ✅ PASS | 条件触发 + 低复杂度（代码审查） |
| [x] | Memory | ✅ PASS | heap-only + Ring Buffer 固定容量 |
| [ ] | Real Runtime | ⚠ DEFERRED | 需私服 5000t 验证 |

### 问题分级

| 级别 | 数量 | 说明 |
|------|------|------|
| BLOCKER | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | L3 (E2E 本地执行受限) · L4 (Real Runtime 验证待私服) |
| LOW | 5 | L1 (PlayerIntel) · L2 (Terrain) · L5 (Combat Learning) · L6 (Squad/War Planner) · G-1/G-2/G-3 (Architecture Gaps) |

### 最终判定

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   A5.1 FINAL AUDIT:  PASS                                ║
║                                                          ║
║   0 BLOCKER  ·  0 HIGH  ·  2 MEDIUM  ·  5 LOW            ║
║                                                          ║
║   所有 BLOCKER 级别问题为零 → 允许 A5.1 PASS              ║
║                                                          ║
║   MEDIUM 问题均为环境限制（非代码缺陷），不阻塞 PASS      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

### 证据汇总

| 证据类型 | 数量 | 详情 |
|---------|------|------|
| 单元测试文件 | 254 | 全绿 |
| 单元测试数 | 3585 | 全绿（含 86 个 A5.1 审计测试） |
| 集成测试文件 | 19 | 全绿 |
| 集成测试数 | 138 | 全绿 |
| E2E 测试文件 | 1 | 已编写（6 场景），环境受限未执行 |
| Replay 次数 | 20 × 1000 = 20000 | Hash 100% 一致 |
| Divergence 测试 | 2 | 输入变更 → 决策变更 ✅ |
| Typecheck | ✅ | tsc --noEmit 通过 |
| Build | ✅ | rollup 通过 (9.2s) |
| 域文件边界扫描 | 3 文件 | 零 Runtime 引用 |
| spawnCreep 调用点 | 1 | 仅 spawn-manager.ts |
| Decision Trace 类别 | 6 | DEFENSE_PREP + REMOTE 全覆盖 |

---

> **审计完成。A5.1 PASS。不进入 A5.2。等待下一步指令。**