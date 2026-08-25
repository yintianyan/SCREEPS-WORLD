# A5.4.0 — Tactical Combat Contract & Boundary Design

**Phase**: A5.4.0 — Tactical Combat Contract & Boundary Design  
**Date**: 2026-08-25  
**Status**: DESIGN COMPLETE — Domain Layer Implemented & Tested  
**Previous Phase**: A5.3.1 Architecture Debt Closure = PASS  
**Blueprint**: [MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) · [DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) · [PLANNING_ARCHITECTURE.md](../architecture/PLANNING_ARCHITECTURE.md)

---

## 1. Executive Summary

本阶段定义**战术层（Tactical Layer）**的完整契约与边界——三层军事控制层级
（Strategic / Operational / Tactical）的最底层，负责决定 **HOW**（如何打），
不决定 **WHY**（为什么打）和 **WHAT**（打什么）。

### 三层军事控制层级

| 层级 | 职责 | 载体 | 频率 | 产出 |
| --- | --- | --- | --- | --- |
| **Strategic** (WHY) | 是否开战、战争基金分配 | Policy 纯函数 → EmpirePosture (war/fortify) | 10³–10⁵ tick | posture + 预算 |
| **Operational** (WHAT) | 打哪个目标、派多少兵 | MilitaryOperation / WarPlan / ForceRequirement | 10²–10⁴ tick | Operation + Force Plan |
| **Tactical** (HOW) | 阵型、接敌、集火、撤退 | SquadPlan / TacticalDecision / TacticalState | 1–10² tick | Decision + Intent |

### 本阶段交付物

| 文件 | 内容 |
| --- | --- |
| `src/domain/tactical/types.ts` | 全部战术类型定义（11 节，~530 行） |
| `src/domain/tactical/authorization.ts` | 授权验证 + Target Scope 验证纯函数 |
| `src/domain/tactical/state-machine.ts` | 战术状态机 + 决策评估纯函数 |
| `src/domain/tactical/formation.ts` | 阵型语义 + 地形选择 + 转换评估 |
| `src/domain/tactical/index.ts` | Barrel 导出 |
| `tests/unit/tactical/a5-4-0-tactical-domain.test.ts` | TAC-001 ~ TAC-014 场景测试 |
| `tests/unit/tactical/a5-4-0-architecture.test.ts` | 8 类架构守卫测试 |

---

## 2. Domain Purity 契约

### 2.1 纯函数律

战术域所有文件遵守与 A5.0–A5.3 相同的纯函数律：

| 禁止 | 理由 |
| --- | --- |
| `Game` / `Memory` / `RawMemory` | 不持有运行时状态 |
| `Creep` / `Room` / `Spawn` / `Structure` | 不引用引擎运行时对象 |
| `systems/` / `creeps/` / `kernel/` import | 不跨层依赖执行层 |
| `spawnCreep` / `submitRequest` / `recycle` | 不执行写操作 |
| `Math.random` / `Date.now` | 确定性：相同输入 → 相同输出 |
| `PathFinder.search` / 全房 `find` | 不做寻路或扫描 |

所有运行时数据由调用方（系统层薄壳）注入为 `TacticalSnapshot` / DTO。

### 2.2 架构守卫

8 类架构测试持续执行（`a5-4-0-architecture.test.ts`）：

1. **Domain Purity** — 不引用 Game / Memory / RawMemory / console
2. **No Runtime Types** — 不 `new Creep()` / `new Room()` 等
3. **No Execution Layer** — 不 import `systems/` / `creeps/`
4. **No Kernel** — 不 import `kernel/`
5. **No Forbidden Functions** — 不调用 spawnCreep / submitRequest / recycle / activateSafeMode
6. **Determinism** — 不使用 Math.random / Date.now
7. **Authorization Required** — validateAuthorization 必须验证 warPosture
8. **Type Completeness** — types.ts 必须包含全部核心类型

---

## 3. TacticalObjective — Operational Objective 的战术投影

### 3.1 类型定义

```typescript
interface TacticalObjective {
  objectiveId: string;
  operationId: string;
  objectiveType: TacticalObjectiveType;
  targetId: string;
  targetType: TacticalTargetType;
  targetScope: TargetScope;
  authorization: TacticalAuthorization;
  priority: number;
  constraints: TacticalConstraints;
  deadline: number;
  abortConditions: readonly AbortCondition[];
  evidence: string[];
  tick: number;
}
```

### 3.2 TacticalObjectiveType

10 种战术目标类型——覆盖 Screeps 战斗的全部战术场景：

| 类型 | 语义 | 典型场景 |
| --- | --- | --- |
| `ENGAGE_ENEMY` | 接敌 | 正面交战 |
| `DESTROY_STRUCTURE` | 摧毁建筑 | 推塔 / 拆 spawn |
| `DEFEND_POSITION` | 防守阵位 | 保护远矿 / 殖民地 |
| `ESCORT` | 护航 | 远矿 hauler 护送 |
| `HARASS` | 骚扰 | 经济骚扰 |
| `DISMANTLE` | 拆除 | 拆 rampart / wall |
| `BREACH` | 突破 | 突破防线 |
| `HOLD_GROUND` | 据守 | 占据关键位置 |
| `REINFORCE` | 增援 | 友军支援 |
| `WITHDRAW` | 撤出 | 主动脱离 |

### 3.3 TargetScope — 越权边界

Tactical 层严格受限的目标选择权限：

| Scope | 允许 | 禁止 |
| --- | --- | --- |
| `LOCAL` | 在当前视野内排序目标（先打 Tower A 还是 Tower B） | 切换到其他房间的目标 |
| `OPERATIONAL` | 执行 Operational 层指定的目标 | 自行选择非指定目标 |
| `STRATEGIC` | — | Tactical **禁止**自行切换战略目标 |

**核心边界**：Tactical 看到另一个 Enemy 不得自行切换战略目标——这由
`validateTargetScope()` 纯函数强制执行，目标房间必须与 Operational target 一致。

---

## 4. TacticalAuthorization — 授权验证

### 4.1 验证维度

```
validateAuthorization(auth, currentTick, isOffensive) → AuthorizationCheckResult
```

7 个检查维度，按优先级：

| # | 检查 | 失败结果 | 理由 |
| --- | --- | --- | --- |
| 1 | operationAborted | REVOKED | Operation abort → 授权自动撤销 |
| 2 | expiry > currentTick | EXPIRED | 授权过期 |
| 3 | state === AUTHORIZED | DENIED/PENDING | 非授权状态 |
| 4 | isOffensive → warPosture === "war" | DENIED | 进攻需 war 姿态 |
| 5 | !isOffensive → warPosture ∈ {war, fortify} | DENIED | 防御允许 war/fortify |

### 4.2 授权构建

```
buildAuthorization(operation, warPosture, operationAborted, expiryTick) → TacticalAuthorization
```

从 Operational 层信息（`MilitaryOperation` + `warPosture`）派生 Tactical 授权。
`isOffensiveOperation()` 判断 OperationType 是否为进攻性（ASSAULT/RAID/SIEGE/HARASS/CONTROLLER_ATTACK/REMOTE_DENIAL）。

### 4.3 与冻结蓝图的关系

> MILITARY_ARCHITECTURE.md §1: "war 姿态是进攻的唯一授权来源"

TacticalAuthorization 是这条冻结契约在战术层的**投影执行器**——它不授权战争
（那是 Strategic 层的职责），但它**验证**战争授权是否有效，并在授权失效时
立即中止战术行动。

---

## 5. TacticalState — 战术状态机

### 5.1 状态定义

9 个战术状态，覆盖 Squad 的完整战术生命周期：

```
FORMING → MOVING → POSITIONING → ENGAGING → DISENGAGING → RETREATING
                                    ↑                      ↓
                              REGROUPING ←─────────────────┘
                                    ↓
                              COMPLETED / ABORTED
```

| 状态 | 语义 | 设计理由 |
| --- | --- | --- |
| `FORMING` | 集结编队中 | Squad 成员从各 spawn 汇合 |
| `MOVING` | 跨房行军中 | 跨房间移动 |
| `POSITIONING` | 到达目标房，选择战术阵位 | **新增**：MOVING→ENGAGING 的中间态，评估地形选择 chokepoint / tower range edge |
| `ENGAGING` | 接敌交战中 | 正面战斗 |
| `DISENGAGING` | 脱离接触中 | **新增**：ENGAGING→RETREATING 的中间态，断开接战（拉开距离/阻断追击） |
| `RETREATING` | 撤退行军中 | 撤退到安全房 |
| `REGROUPING` | 重新集结 | 被打散后重组 |
| `COMPLETED` | 目标完成 | 终态 |
| `ABORTED` | 目标中止 | 终态 |

### 5.2 与 OperationStatus 的区分

| 维度 | OperationStatus (Operational) | TacticalState (Tactical) |
| --- | --- | --- |
| 层级 | 宏观生命周期 | 微观执行状态 |
| 状态 | PLANNED → ACTIVE → COMPLETED | FORMING → MOVING → ENGAGING → ... |
| 切换频率 | 低频（10²–10⁴ tick） | 高频（1–10² tick） |
| 关系 | 一个 ACTIVE Operation 下的 Squad | 可在 FORMING / ENGAGING / RETREATING 间反复切换 |

### 5.3 合法转换表

```typescript
const VALID_TACTICAL_TRANSITIONS: Record<TacticalState, readonly TacticalState[]> = {
  FORMING:     ["MOVING", "ABORTED", "COMPLETED"],
  MOVING:      ["POSITIONING", "ENGAGING", "RETREATING", "REGROUPING", "ABORTED"],
  POSITIONING: ["ENGAGING", "RETREATING", "REGROUPING", "ABORTED"],
  ENGAGING:    ["DISENGAGING", "RETREATING", "REGROUPING", "COMPLETED", "ABORTED"],
  DISENGAGING: ["RETREATING", "REGROUPING", "ENGAGING", "ABORTED"],
  RETREATING:  ["REGROUPING", "ABORTED", "COMPLETED"],
  REGROUPING:  ["MOVING", "POSITIONING", "ENGAGING", "ABORTED"],
  COMPLETED:   [],
  ABORTED:     [],
};
```

关键约束：
- `FORMING → ENGAGING` 非法（必须经过 `MOVING`）
- `COMPLETED` / `ABORTED` 是终态，不可转出
- `canTransitionTactical(from, to)` 纯函数验证

---

## 6. evaluateTacticalAction — 核心决策纯函数

### 6.1 决策链

```
evaluateTacticalAction(snapshot: TacticalSnapshot) → TacticalDecision
```

9 步优先级链，每步可短路返回：

| 优先级 | 检查 | 触发条件 | 输出 |
| --- | --- | --- | --- |
| 1 | 授权检查 | auth invalid | ABORTED + HOLD |
| 2 | 止损检查 | abort condition hit | ABORTED + RETREAT |
| 3 | 情报新鲜度 | intel STALE/EXPIRED | REGROUPING |
| 4 | 敌方能力激增 | enemy surge detected | RETREATING |
| 5 | 编队完整性 | squad broken | REGROUPING |
| 6 | 治疗者检查 | healer lost + healerRequired | DISENGAGING |
| 7 | 血量检查 | avgHpRatio < retreatThreshold | DISENGAGING → RETREATING |
| 8 | 正常状态机 | switch(currentState) | 状态对应决策 |
| 9 | 默认 | unknown state | HOLD |

### 6.2 止损条件 (checkAbortConditions)

消费 Operational 层的 `AbortCondition`，产出 `TacticalAbortSignal`：

| AbortReason | 触发条件 |
| --- | --- |
| `CASUALTY_EXCEEDED` | aliveRatio < regroupPolicy.memberRatioThreshold |
| `INTEL_STALE` | overallConfidence < minIntelConfidence |
| `AUTHORIZATION_REVOKED` | operationAborted === true |
| `LOGISTICS_FAILURE` | overallConfidence < 0.1 |

### 6.3 敌方能力激增检测 (checkEnemyCapabilitySurge)

三维度检测，任一触发即 retreat：

| 维度 | 条件 | 语义 |
| --- | --- | --- |
| 攻击力 | enemyAttack > (ourHeal + ourHP×0.1) × 1.5 | 敌方输出压倒我方治疗+HP |
| 治疗力 | enemyHeal > ourBurst × 1.5 | 敌方治疗压倒我方攻击（打不动） |
| 总HP | enemyHP > ourBurst × 10 | 消耗战不利 |

### 6.4 目标选择 (selectEngagementTarget)

确定性排序，优先级：

1. **focusTargetId**（EngagementPolicy 指定的集火目标）
2. **目标类型决定候选池**：
   - `DESTROY_STRUCTURE` / `DISMANTLE` → 按 `valueTier` 降序 → 受伤量降序 → ID 字典序
   - 默认（ENGAGE_ENEMY）→ 治疗者优先 → effectiveHP 升序（最脆优先） → ID 字典序

**确定性保证**：所有排序的最终 tie-break 是 ID 字典序，相同输入必产生相同输出。

---

## 7. TacticalDecision — 纯函数输出

### 7.1 结构

```typescript
interface TacticalDecision {
  newState: TacticalState;
  movementIntent: MovementIntent;
  combatIntent: CombatIntent;
  targetId?: string;
  formation: FormationType;
  reason: string;
  evidence: string[];
  rejectedAlternatives: readonly RejectedTacticalAlternative[];
  decisionHash: string;
}
```

### 7.2 MovementIntent

| Intent | 语义 |
| --- | --- |
| `ADVANCE` | 前进向目标 |
| `HOLD` | 原地据守 |
| `FLANK` | 侧翼包抄 |
| `RETREAT` | 撤退 |
| `REGROUP` | 重新集结 |
| `POSITION` | 移动到战术阵位 |

> Domain 层只决定 Intent，不执行 Path。实际移动由角色层 traffic-manager 后置系统签发。

### 7.3 CombatIntent

| Intent | 语义 | 触发条件 |
| --- | --- | --- |
| `ATTACK` | 近身攻击 | attacker 角色 + 敌方 creep |
| `RANGED_ATTACK` | 远程攻击 | ranged 角色 + 敌方 creep |
| `HEAL` | 治疗 | healer 角色 |
| `RANGED_HEAL` | 远程治疗 | healer 角色 + 距离 > 1 |
| `DISMANTLE` | 拆除 | dismantler 角色 + 建筑 |
| `NONE` | 无战斗动作 | 移动中 |

---

## 8. Formation 模型

### 8.1 阵型类型

| 类型 | 适用场景 | 优势 | 劣势 | 推荐地形 |
| --- | --- | --- | --- | --- |
| `LINE` | 正面展开，最大化火力 | 火力均匀，AoE 抗性 | 侧翼暴露 | OPEN, FORTIFIED |
| `WEDGE` | 突击突破 | 集中突破，healer 跟进 | 尖端承压 | OPEN |
| `COLUMN` | 狭窄通道行军 | 适配 chokepoint | 只前排攻击 | CHOKEPOINT |
| `CLUSTER` | 撤退/防守紧凑 | 治疗覆盖最大化 | AoE 脆弱 | UNKNOWN |
| `SCATTER` | 分散规避 | 减少 AoE 伤害 | 治疗覆盖差 | OPEN |

### 8.2 阵型选择规则

```
selectFormationForTerrain(terrain, state) → FormationType
```

| 状态 | 选择规则 |
| --- | --- |
| RETREATING / REGROUPING / DISENGAGING | 始终 CLUSTER |
| MOVING | 始终 COLUMN |
| ENGAGING / POSITIONING | 按地形：OPEN→WEDGE, CHOKEPOINT→COLUMN, FORTIFIED→LINE, UNKNOWN→CLUSTER |
| 其他 | CLUSTER（保守默认） |

### 8.3 阵型转换评估

```
evaluateFormationTransition(currentFormation, terrain, state) → FormationTransition | null
```

地形变化时自动建议阵型转换（如 OPEN→CHOKEPOINT 时 WEDGE→COLUMN）。

---

## 9. TacticalAbortSignal — 止损边界

### 9.1 信号结构

```typescript
interface TacticalAbortSignal {
  signalId: string;
  operationId: string;
  objectiveId: string;
  squadId: string;
  reason: TacticalAbortReason;
  tick: number;
  detail: string;
  evidence: string[];
}
```

### 9.2 AbortReason 类型

| Reason | 语义 | 上报目标 |
| --- | --- | --- |
| `SQUAD_BROKEN` | 编队被打散 | Operational → 评估是否 regroup 或 abort |
| `HEALER_LOST` | 治疗者损失 | Operational → 评估是否增援 healer |
| `ENEMY_CAPABILITY_SURGE` | 敌方能力激增 | Operational → 评估是否升级 force |
| `INTEL_STALE` | 情报过期 | Operational → 评估是否暂停等待 intel |
| `LOGISTICS_FAILURE` | 后勤失败 | Operational → 评估是否 abort |
| `CASUALTY_EXCEEDED` | 伤亡超限 | Operational → 触发止损链 |
| `OBJECTIVE_UNACHIEVABLE` | 目标不可达 | Operational → 评估取消 |
| `AUTHORIZATION_REVOKED` | 授权撤销 | Operational → 立即停止 |

### 9.3 与 A5.3 止损链的关系

> MILITARY_ARCHITECTURE.md §3: "止损链不可绕过"

TacticalAbortSignal 是 Operational 层 `AbortCondition` 的**战术层发现机制**——
Operational 定义何时止损，Tactical 发现止损条件被触发并上报。
信号交给 Operational / A4.6 Recovery 处理，Tactical 层不自行执行 recovery。

---

## 10. 系统边界契约

### 10.1 Role / Spawn 边界

```
ForceShortage → ReinforcementDemand → SpawnManager（唯一孵化者）
```

| 边界 | 规则 |
| --- | --- |
| Tactical → Spawn | 只产出 `ReinforcementDemand`（声明需求），不直接 spawn |
| SpawnManager | 唯一 `spawnCreep` 调用者（AGENTS.md 硬约束） |
| 优先级 | `ForceShortage.urgency` 映射到 Spawn 车道（P0 灾后 > P1 生存 > P2 发展 > P3 增长） |

### 10.2 Logistics 边界

```
SupplyDemand → Unified Logistics Network
```

| 边界 | 规则 |
| --- | --- |
| Tactical → Logistics | 只产出 `SupplyDemand`（声明补给需求），不直接调拨 |
| 资源类型 | `resource: string` 支持 energy / mineral / compound |
| 优先级 | 0（最高）–3（最低），与 Logistics 网络优先级对齐 |

### 10.3 Recovery 边界

```
TacticalAbortSignal → Operational AbortCondition → A4.6 Recovery Execution
```

| 边界 | 规则 |
| --- | --- |
| Tactical → Recovery | 只产出 `TacticalAbortSignal`，不直接执行 recovery action |
| A4.6 Recovery | 消费 abort signal，映射到 `RecoveryAction`，提交执行 |
| 幂等 | signalId 格式 `tac-abort:${squadId}:${tick}` 确保唯一 |

### 10.4 Movement 边界

| 边界 | 规则 |
| --- | --- |
| Tactical → Movement | 只产出 `MovementIntent`，不执行 `move()` |
| Traffic Manager | tick 末按房仲裁统一签发 `move`（AGENTS.md 硬约束） |
| PathFinder | 角色层限频调用（三档），`maxRooms: 1` |

---

## 11. CombatCapability / Terrain / Intel-Confidence 整合

### 11.1 输入整合

`TacticalSnapshot` 整合三个 A5.0–A5.2 子系统的输出作为纯函数输入：

| 子系统 | 输入类型 | 用途 |
| --- | --- | --- |
| A5.1 CombatCapability | `CombatCapability` / `AggregateCapability` | 我方+敌方能力评估 |
| A5.2 TerrainContext | `TerrainContext` / `EffectiveCombatModifier` | 阵型选择 + 撤退质量 |
| A5.2 Confidence | `MultiDimensionalConfidence` | 情报新鲜度 + 止损判断 |
| A5.2 PlayerIntel | `PlayerIntelRecord` | 玩家威胁记忆 |

### 11.2 CombatPower 复用

TacticalSnapshot 直接复用 A5.1 的 `CombatPower` 结构（`burstDamage` / `effectiveHP` / `healOutput` / `dismantlePower`）作为编队级估计值，但**不**使用 `powerScore` 作为唯一决策依据（A5.1 已明确警告）。

---

## 12. DecisionTrace 事件契约

### 12.1 事件类型

```typescript
type TacticalDecisionEvent =
  | "TACTICAL_OBJECTIVE_ACCEPTED"
  | "TACTICAL_STATE_CHANGED"
  | "FORMATION_SELECTED"
  | "ENGAGEMENT_DECIDED"
  | "TARGET_SWITCHED"
  | "RETREAT_DECIDED"
  | "REGROUP_DECIDED"
  | "TACTICAL_ABORTED";
```

### 12.2 事件记录

```typescript
interface TacticalDecisionRecord {
  event: TacticalDecisionEvent;
  operationId: string;
  objectiveId: string;
  squadId?: string;
  tick: number;
  reason: string;
  evidence: string[];
  confidence: number;
  rejectedAlternatives: readonly RejectedTacticalAlternative[];
  decisionHash: string;
}
```

### 12.3 与 A4.7 DecisionTrace 集成

复用 A4.7 的 `DecisionEvidence` / `RejectedAlternative` 语义结构。
系统层薄壳负责将 `TacticalDecisionRecord` 写入 event-log。
Domain 层只产出记录，不直接写日志。

---

## 13. Determinism 契约

### 13.1 确定性保证

| 维度 | 保证方式 |
| --- | --- |
| 相同 Snapshot → 相同 Decision | 纯函数，无副作用 |
| 排序确定性 | 所有排序最终 tie-break = ID 字典序 |
| 决策 Hash | `tacticalDecisionHash()` FNV-1a-32 校验 |
| 无随机性 | 禁止 `Math.random` / `Date.now`（架构守卫测试） |

### 13.2 DecisionHash

```typescript
function tacticalDecisionHash(decision, snapshot): string
```

Hash payload 包含：newState / movementIntent / combatIntent / targetId / formation /
squadId / objectiveId / tick / enemyCount / structureCount / avgHp / confidence。

相同 Snapshot + 相同 Decision → 相同 Hash（TAC-014 验证）。

---

## 14. 测试覆盖

### 14.1 场景测试 (TAC-001 ~ TAC-014)

| ID | 场景 | 验证 |
| --- | --- | --- |
| TAC-001 | Valid WarPlan → Objective Accepted | 授权有效时正常执行 |
| TAC-002 | Expired WarPlan → Rejected | 授权过期时 abort |
| TAC-003 | Aborted Operation → Tactical Abort | Operation abort 时授权撤销 |
| TAC-004 | Target outside Scope → Rejected | 跨房目标被拒绝 |
| TAC-005 | LOW Confidence → Conservative | 低置信度触发 abort |
| TAC-006 | STALE Intel → Regroup | 过期情报触发 regroup |
| TAC-007 | High Enemy Capability → Retreat | 敌方能力激增触发 retreat |
| TAC-008 | Healer Lost → Disengage | 治疗者损失触发 disengage |
| TAC-009 | Formation Broken → Regroup | 编队打散触发 regroup |
| TAC-010 | Insufficient Squad → Shortage | 编队不足检出 shortage |
| TAC-011 | Logistics Failure → Degradation | 后勤失败触发 abort |
| TAC-012 | Terrain Chokepoint → Formation | 地形驱动阵型选择 |
| TAC-013 | Equal Scores → Deterministic Tie | 确定性 tie-break（ID 字典序） |
| TAC-014 | Same Snapshot → Same Hash | 决策 Hash 确定性 |

### 14.2 架构守卫测试 (8 类)

1. Domain Purity — 不引用 Runtime
2. No Runtime Types — 不 new 引擎类型
3. No Execution Layer — 不 import systems/creeps
4. No Kernel — 不 import kernel/
5. No Forbidden Functions — 不调用写函数
6. Determinism — 不使用随机性
7. Authorization Required — warPosture 验证存在
8. Type Completeness — 核心类型齐全

---

## 15. 与冻结蓝图的合规映射

| 冻结契约 | 本阶段实现 |
| --- | --- |
| MILITARY_ARCHITECTURE §1: war 唯一授权 | `validateAuthorization()` 验证 warPosture |
| MILITARY_ARCHITECTURE §3: 止损链不可绕过 | `TacticalAbortSignal` + `checkAbortConditions()` |
| PLANNING_ARCHITECTURE §2: tactical 层禁序列规划 | 纯函数查表级决策，无 GOAP/HTN/MPC |
| PLANNING_ARCHITECTURE §2: 寻路局部化限频 | Domain 层只产 Intent，不执行 Path |
| DECISION_AUTHORITY_MODEL §1: attacker 孵化仅经 war-planner | Tactical 不 spawn，只产 ReinforcementDemand |
| SYSTEM_BOUNDARIES: 角色禁止全房 find | Tactical 只消费 Snapshot，不扫描 |
| DATA_FLOW: 快照是唯一入口 | `TacticalSnapshot` 是纯函数唯一输入 |
| AGENTS.md: Spawn Manager 唯一 spawnCreep | Tactical 产出 Demand，不调 spawnCreep |
| AGENTS.md: 移动走 traffic-manager | Tactical 产 MovementIntent，不调 move() |

---

## 16. 未来实施路径

本阶段是**契约与设计阶段**，不实现系统层执行代码。后续阶段需要：

| 后续 | 内容 | 依赖 |
| --- | --- | --- |
| System Shell | `TacticalExecutionSystem`（系统层薄壳） | 本阶段 Domain |
| Role Adapter | attacker/healer 角色消费 TacticalDecision | Role Engine |
| Spawn Integration | ReinforcementDemand → SpawnManager | Spawn Manager |
| Logistics Integration | SupplyDemand → Unified Logistics | Logistics Network |
| Recovery Integration | TacticalAbortSignal → A4.6 Recovery | Recovery Execution |
| Decision Trace | TacticalDecisionRecord → event-log | A4.7 DecisionTrace |

每个后续阶段必须遵守本阶段定义的契约边界，不得反向修改 Domain 层纯函数。

---

## 17. 审计结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | ✅ PASS |
| `npm test` (tactical tests) | ✅ 14 scenarios + 8 architecture guards PASS |
| Domain Purity | ✅ 0 violations |
| Determinism | ✅ 0 violations |
| Architecture Guard | ✅ 8/8 PASS |
