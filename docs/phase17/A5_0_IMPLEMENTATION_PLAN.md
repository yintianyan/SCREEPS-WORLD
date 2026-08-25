# A5.0 — Military Implementation Plan

> **阶段**：A5.0 · 纯架构研究。**不写生产代码**。
> **依据**：A5_0_MILITARY_ARCHITECTURE.md 识别的 7 个架构缺口。
> **原则**：先闭环再扩展；先纯函数再系统层；先 PVE 再 PVP。

---

## 1. 实施阶段总览

```text
A5.0 (当前) — 架构研究 / 领域建模 / 实施设计
  ↓
A5.1 — 威胁评估 + 战斗能力 + 远矿防御 (核心缺口)
  ↓
A5.2 — 防御深化 + 编队协调 + E2E 测试
  ↓
A5.3 — Combat Learning + Diplomacy 接口 + Stress Test
```

---

## 2. A5.1 — 核心缺口实现

### 2.1 目标

实现 A5.0 识别的 3 个 MEDIUM 级缺口：

| 缺口 | 描述 | 实现方式 |
| --- | --- | --- |
| G1 | 威胁评估缺乏 intent 推断 | 扩展 `assessThreat()` 纯函数 |
| G2 | 无 CombatCapability 评估 | 新建 `evaluateCombatCapability()` 纯函数 |
| G4 | 远矿防御决策未形式化 | 新建 `decideRemoteDefenseAction()` 纯函数 |

### 2.2 G1 — 威胁评估扩展

#### 2.2.1 新建纯函数

文件：`src/domain/defense/threat-assessment.ts`

```typescript
// 纯函数：综合评估威胁
function assessThreat(input: ThreatAssessmentInput): ThreatAssessment;

// 纯函数：推断威胁意图
function inferThreatIntent(
  hostiles: CreepSummary[],
  context: RoomContext,
  playerIntel: PlayerIntelSummary | undefined,
): ThreatIntent;
```

#### 2.2.2 扩展点

- 从 RoomSnapshot 提取更丰富的 CreepSummary（含 boost 检测）
- 综合考虑 tower / rampart / safeMode 防御覆盖
- 结合 PlayerIntel 行为画像推断意图
- 输出 ThreatAssessment（level / confidence / intent / timeToImpact / recommendedPosture）

#### 2.2.3 测试

- `tests/unit/defense/threat-assessment.test.ts`
- 覆盖 A5-S01–S05 场景（invader / boosted attacker / heal stack / remote harassment）

#### 2.2.4 集成

- `src/systems/room-state.ts` 消费 ThreatAssessment 替代当前简单的 threatCount 判定
- `src/systems/tower-defense.ts` 消费 intent 优化塔目标选择（如 SIEGE → 停火蓄能）

### 2.3 G2 — CombatCapability 评估

#### 2.3.1 新建纯函数

文件：`src/domain/combat/capability.ts`

```typescript
// 纯函数：从 creep body 解析战斗能力
function evaluateCombatCapability(creep: CreepSnapshot): CombatCapability;

// 纯函数：编队聚合战斗力
function computeCombatPower(
  capabilities: CombatCapability[],
  context: FormationContext,
): CombatPower;
```

#### 2.3.2 实现要点

- body 部件统计（ATTACK / RANGED / HEAL / TOUGH / MOVE / WORK / CLAIM）
- boost 倍率计算（T1=2, T2=3, T3=4；tough 减伤 ×0.7/0.5/0.3）
- 派生能力：attack / rangedAttack / heal / toughness / mobility / dismantle
- 编队聚合：burstDamage / effectiveHP / healOutput / powerScore

#### 2.3.3 测试

- `tests/unit/combat/capability.test.ts`
- 覆盖各种 body 组合 + boost 状态 + 编队形态

#### 2.3.4 集成

- `src/creeps/roles/attacker.ts` 消费 CombatCapability 做目标选择
- `src/domain/war/planning.ts` 消费 computeCombatPower 做编队可行性评估
- `src/domain/defense/tower-engagement.ts` 可选消费敌方 CombatPower 增强判定

### 2.4 G4 — 远矿防御决策

#### 2.4.1 新建纯函数

文件：`src/domain/defense/remote-defense.ts`

```typescript
type RemoteDefenseAction = "CONTINUE" | "PAUSE" | "RETREAT" | "ESCORT" | "ABORT";

// 纯函数：远矿房威胁响应决策
function decideRemoteDefenseAction(
  threat: ThreatAssessment,
  remoteOp: RemoteOpState,
  context: RemoteDefenseContext,
): { action: RemoteDefenseAction; reason: string };
```

#### 2.4.2 决策规则

```text
level 0 → CONTINUE
level 1 → PAUSE (N tick 后恢复)
level 2 → ESCORT (派 duo 轻队, 防御预算)
level 3 → RETREAT (撤退远矿 creep, 车道暂停)
level 4 → ABORT (放弃车道, 重新 ROI 评估)
```

#### 2.4.3 测试

- `tests/unit/defense/remote-defense.test.ts`
- 覆盖 A5-S05 场景（remote mining harassment）

#### 2.4.4 集成

- `src/systems/remote-mining-manager.ts` 消费 decideRemoteDefenseAction
  替代当前简单的 invader 暂停逻辑

### 2.5 A5.1 交付物

| 交付物 | 类型 | 位置 |
| --- | --- | --- |
| `assessThreat()` + `inferThreatIntent()` | 纯函数 | `src/domain/defense/threat-assessment.ts` |
| `evaluateCombatCapability()` + `computeCombatPower()` | 纯函数 | `src/domain/combat/capability.ts` |
| `decideRemoteDefenseAction()` | 纯函数 | `src/domain/defense/remote-defense.ts` |
| 纯函数测试 | Unit Test | `tests/unit/defense/` + `tests/unit/combat/` |
| E2E 场景 A5-S01–S07 | E2E Test | `tests/e2e/scenarios/12-15` |
| 集成更新 | 系统层 | room-state / tower-defense / remote-mining-manager |

### 2.6 A5.1 验收标准

- `npm run typecheck` 全绿
- `npm run test:unit` 全绿（含新增纯函数测试）
- `npm run test:integration` 全绿（含新增 E2E）
- `npm run build` 全绿
- 现有行为不退化（回归测试通过）

---

## 3. A5.2 — 防御深化 + 编队协调

### 3.1 目标

| 缺口 | 描述 | 实现方式 |
| --- | --- | --- |
| G3 | Defender 位置选择缺地形感知 | 扩展 defender RolePolicy |
| G5 | PlayerIntel 置信度对接 | 扩展 assessThreat 消费 PlayerIntel |
| — | siege/recovery/stabilizing 三态独立 | 扩展 colonyState |
| — | Tower 目标评分扩展 | 扩展 TowerThreat 结构 |
| — | decideRetreat P0 形式化 | 新建纯函数 |
| — | decideCombatAction | 新建纯函数 |

### 3.2 交付物

| 交付物 | 类型 | 位置 |
| --- | --- | --- |
| `decideRetreat()` | 纯函数 | `src/domain/combat/retreat.ts` |
| `decideCombatAction()` | 纯函数 | `src/domain/combat/decision.ts` |
| `scoreCombatTarget()` | 纯函数 | `src/domain/combat/target.ts` |
| Defender 位置选择扩展 | RolePolicy | `src/creeps/roles/defender.ts` |
| Tower 目标评分扩展 | 纯函数扩展 | `src/domain/defense/tower-target.ts` |
| E2E 场景 A5-S08–S20 | E2E Test | `tests/e2e/scenarios/16-20` |

### 3.3 验收标准

- 同 A5.1
- 20 个必须场景 E2E 全覆盖

---

## 4. A5.3 — Combat Learning + Diplomacy

### 4.1 目标

| 缺口 | 描述 | 实现方式 |
| --- | --- | --- |
| G6 | Combat Learning 校准框架 | war ledger 扩展 + 预测-实际对比 |
| G7 | Diplomacy 接口 | 类型定义 + allies 机制 |
| — | Stress Test | 多房受袭 / 低 CPU / 大规模编队 |

### 4.2 交付物

| 交付物 | 类型 | 位置 |
| --- | --- | --- |
| War ledger 扩展 | 数据结构 | segment schema |
| Prediction vs Actual 对比 | 纯函数 | `src/domain/war/learning.ts` |
| Diplomacy 类型 | 类型定义 | `src/types/diplomacy.ts` |
| Stress Test | 手动/私服 | — |

---

## 5. 实施风险

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| assessThreat 扩展引入 CPU 热点 | MEDIUM | P0 防御降级 | 纯函数保持 O(hostiles)；系统层预构建摘要 |
| CombatCapability 在每 tick 评估所有 creep | MEDIUM | CPU 超限 | 仅在威胁可见时评估；缓存结果 |
| 远矿防御决策误判 | LOW | 远矿损失 | 纯函数可回放 + 场景测试覆盖 |
| siege 三态独立化影响现有 colonyState | MEDIUM | 行为退化 | 回归测试 + 渐进迁移 |
| Defender 位置选择改动影响现有防御 | MEDIUM | 防御失效 | E2E 测试覆盖 + 回退路径 |

---

## 6. 不做的事情

| 不做 | 理由 |
| --- | --- |
| MilitaryManager / DefenseManager / CombatManager / SquadManager | 职责已分散到现有系统 |
| 第二套 Recovery 系统 | 复用 A4.6 |
| 第二套 Spawn 系统 | 复用 SpawnManager |
| 第二套 Logistics 系统 | 复用 Unified Logistics |
| ML / 自适应学习 | 仅确定性统计 + 人工校准 |
| 外交系统实现 | 当前 allies 空集，只设计接口 |
| 跨 shard 军事 | 当前无跨 shard 目标 |

---

## 7. 时间线估算

| 阶段 | 估算 | 交付物 |
| --- | --- | --- |
| A5.0 | 已完成 | 7 份架构文档 |
| A5.1 | 2–3 天 | 3 个纯函数 + 测试 + 集成 |
| A5.2 | 3–5 天 | 3 个纯函数 + defender 扩展 + E2E |
| A5.3 | 2–3 天 | Learning 框架 + Diplomacy 接口 + Stress |

---

## 8. 结论

A5.0 实施计划明确了下一阶段 A5.1 的优先实现目标：

1. **G1 — assessThreat() 扩展**：威胁意图推断（SCOUTING/SIEGE/ECONOMIC_ATTACK 等）
2. **G2 — evaluateCombatCapability()**：从 creep body 解析结构化战斗能力
3. **G4 — decideRemoteDefenseAction()**：远矿防御决策形式化

这三个缺口是 MEDIUM 级别，影响威胁评估精度、编队可行性评估和远矿安全。
必须先实现它们，因为后续的编队协调、撤退判定和 Combat Learning 都依赖于
结构化的威胁评估和战斗能力数据。