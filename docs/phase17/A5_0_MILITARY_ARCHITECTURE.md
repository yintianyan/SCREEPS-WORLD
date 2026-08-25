# A5.0 — Military Empire Architecture Specification

> **阶段**：A5.0 · 纯架构研究 / 领域建模 / 实施设计。**不写生产代码**。
> **前置**：A4.0–A4.7 全 PASS（Runtime Foundation → Decision Trace 全链闭环）。
> **依据**：冻结蓝图 [MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) ·
> [DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) ·
> [INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) ·
> [GOAL_POLICY_PLAN_MODEL.md](../architecture/GOAL_POLICY_PLAN_MODEL.md) ·
> 机制事实 [research/03 §8](../research/03_SCREEPS_GAME_CONSTRAINTS.md)。
> **社区参照**：Overmind（bunker/tower-coverage/squad）、TooAngel（自治防御）、
> bonzAI（Operation/Mission）、hivemind（PlayerIntel）、KasamiBot（模板防御）。

---

## 1. Screeps 中真正的军事问题是什么

Screeps 的军事本质**不是**「谁有更多攻击单位」。它是一个**受约束的资源消耗博弈**：

1. **围城是吞吐竞赛，不是击杀竞赛**。标准攻方战术是 Tower Drain——用 heal-tank
   编队站远处把塔能量奶回去，守方塔白耗能量。守住 = 防御方可持续能量供给 >
   攻方消耗能力（[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §3）。
2. **dismantle 不产能量**（research/03 §8）。拆家是纯消耗战——攻方用矿工拆墙不
   回本，防御方只要墙够厚就赢了交换比。
3. **nuke 的战略价值是取消 safemode**（research/03 §8），不是伤害本身。50,000 tick
   飞行窗口 = 对手有整个反应期，所以 nuke 只用于僵局打破。
4. **boost 是军备竞赛核心**。T3 boost 使 attack 4× / heal 4× / tough 减伤 ×0.3
   （research/03 §7），没 boost 的编队在有塔房是送能量。
5. **CPU 是隐性军事资源**。全房 `find`、每 tick `PathFinder.search`、散落 if/else
   的反射式防御会把 CPU 烧到看门狗降级——降级后防御应答也停了，等于不战而降。

**结论**：军事问题的本质是「在 CPU / 能量 / 人口预算约束下，最大化己方恢复能力
的同时最小化敌方恢复能力」。不是「造更多兵」，而是「在正确的时间把正确的编队
投送到正确的目标，且失败后经济不崩」。

---

## 2. Defense 与 Military 的边界

### 2.1 严格分离原则

| 维度 | Defense（防御） | Military / Offense（军事/进攻） |
| --- | --- | --- |
| **目标** | 保护 Empire（controller/spawn/能源/恢复能力） | 主动执行战争 Operation（摧毁/占领/压制敌方目标） |
| **触发** | 威胁可见即响应（被动反应） | war posture 唯一授权（主动决策） |
| **预算** | 房间能量配给（defense 车道 P0） | 战争基金预算线（war 基金分账） |
| **写者** | tower-defense（塔动作唯一签发者） | war-planner（进攻唯一执行决策者） |
| **禁止** | 防御系统**永不**自行反打出门 | 非 war 姿态不孵化 attacker |
| **代码存在** | 威胁可见即激活 | ≠ 战争开始（AGENTS.md 战争条款） |

### 2.2 边界合同

```text
Defense 系统                    Military 系统
     ↑                               ↑
     │ threatAssessment              │ warPlan
     │ (纯函数, 只读消费)             │ (war-planner 唯一写者)
     │                               │
     └───── posture (Policy) ────────┘
               唯一桥梁
```

- Defense 上行：持续 siege / 多房 alert → posture 升格为 fortify/war 的**候选信号**
  （防御系统不自行反打出门，[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §1）。
- Military 下行：war posture 授权后，war-planner 创建 War Operation，attacker 仅由
  它经 SpawnManager 孵化（[MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §1）。
- 两者共享：Intel（情报输入）、Spawn（孵化通道）、Logistics（补给）、Recovery（恢复）、
  Decision Trace（决策追踪）——但各自只通过正式接口消费，不直写对方状态。

---

## 3. 三层军事控制架构

```text
Strategic Layer (100–500 tick)
  │  "为什么打" — Policy 纯函数求值 posture
  │  输入: EmpireSituation (态势快照)
  │  输出: posture (peace/fortify/war/evacuate) + 五域预算
  │  决策: 战争授权 / 基金划拨 / 姿态切换 (带滞回 + minDuration)
  │
Operational Layer (20–100 tick)
  │  "怎么打" — war-planner / defense-planner
  │  输入: posture + IntelSnapshot + RoomSnapshots
  │  输出: WarOperation (目标/编队/预算/期限) / DefensePlan (塔/墙/safemode)
  │  决策: 目标选择 / 编队组建 / 集结 FSM / 止损链 / 防御升级
  │
Tactical Layer (1 tick)
  │  "这一 tick 做什么" — RolePolicy / tower-defense
  │  输入: RoomSnapshot (本 tick 快照)
  │  输出: creep action (move/attack/heal/retreat) + tower action
  │  决策: 集火目标 / 阵型位置 / 撤退判定 / 塔动作签发
  │  约束: 必须极轻量 (O(creeps), 无 PathFinder, 无全房 find)
```

### 3.1 频率合同

| 层 | 系统 | interval | 理由 |
| --- | --- | --- | --- |
| Strategic | empire-strategy | 100–500t | posture 是慢变量；态势分频聚合 + 滞回防抖 |
| Operational | war-planner | 10t | 战时波次管理需要较高频率；非 war 时仅一次收摊 |
| Operational | defense-planner | 100t | 防御规划低频；塔防实时由 tower-defense(P0) 承担 |
| Tactical | tower-defense | 1t (P0) | 防御是生存关键，永不降级 |
| Tactical | role-runner | 1t (P0) | creep 执行每 tick 驱动 |
| Tactical | traffic-manager | 1t (P0 post) | tick 末统一仲裁移动 |

### 3.2 降级合同

| CPU 档位 | Strategic | Operational | Tactical |
| --- | --- | --- | --- |
| Healthy | 正常 | 正常 | 正常 |
| Guarded | 正常 | 正常 | 正常 |
| Conserve | 降频 | 降频 | 轻量 |
| Recovery | 冻结新立项 | 冻结新 Operation | P0 防御 + 最小 defender 车道 |

**铁律**：P0 防御应答（tower-defense + safe mode）永不降级（[KERNEL_ARCHITECTURE.md](../architecture/KERNEL_ARCHITECTURE.md) §2.2）。

---

## 4. Empire 集成架构

Military 不是第二个 Empire Runtime，而是 Empire 闭环的一个执行域：

```text
                         EMPIRE
                            │
             ┌──────────────┼──────────────┐
             ↓              ↓              ↓
          ECONOMY       LOGISTICS       MILITARY
             │              │              │
             │              │        ┌─────┴─────┐
             │              │        ↓           ↓
             │              │     DEFENSE     OFFENSE
             │              │        │           │
             └──────────────┼────────┘           │
                            ↓                    ↓
                       EXECUTION ←───────────────┘
                            ↓
                          WORLD
                            ↓
                        FEEDBACK
                            ↓
                         TRACE
```

### 4.1 A4 体系集成点

| A4 子系统 | Military 消费方式 | 接口 |
| --- | --- | --- |
| **Spawn Director** | Military 只产生 Spawn Demand（attacker/healer/defender），不自行 spawnCreep | `submitRequest()` → SpawnManager 唯一写者 |
| **Unified Logistics** | Military 只产生 Supply Contract（boost 矿物/能量补给），不自行运输 | TransportRequestV2 → Logistics 系统 |
| **Empire Resource Network** | Military 消费 SupplyNode（boost 库存），不直写 ResourceNode | lab-system 管理 boost 生产/消耗 |
| **Recovery (A4.6)** | Squad loss → Failure → Recovery → Reinforcement → Rebuild Squad | recoveryActions 通道 |
| **Decision Trace (A4.7)** | 所有军事决策产出 DecisionSnapshot | decision-trace-system 采集 |
| **Empire Health (A4.5)** | Military 消费 empire-health 的威胁维度，也为其贡献军事健康信号 | empire-health-system 只读 |
| **Posture (Policy)** | Military 只读消费 posture，不改写 | `Memory.kernel.strategy.posture` |

### 4.2 Architecture Invariants（不可破坏）

| # | 不变量 | 强制方式 |
| --- | --- | --- |
| INV-1 | Military 禁止直接操作 Resource（不写 store/transfer/withdraw） | 只通过 Supply Contract → Logistics |
| INV-2 | Military 禁止直接创建 Transport | 只通过 TransportRequestV2 → Unified Logistics |
| INV-3 | Military 禁止直接创建 Spawn | 只通过 Spawn Demand → SpawnManager |
| INV-4 | Military 禁止直接修改 Economy | 只通过 posture → Policy → 预算分账 |
| INV-5 | Military 禁止直接改写 RoomState | 只读消费 RoomSnapshot |
| INV-6 | Defense 禁止反打出门 | 防御系统永不孵化 attacker / 不跨房追击 |
| INV-7 | war posture 是进攻唯一授权 | 代码存在 ≠ 战争开始 |
| INV-8 | 止损链不可绕过 | 伤亡闸/目标闸/经济闸三道硬编码 |

---

## 5. Military Domain Model 总览

### 5.1 概念层次

```text
Threat Intelligence
  ├── ThreatSource (NPC Invader / Player / Source Keeper)
  ├── ThreatAssessment (level / confidence / intent / timeToImpact)
  ├── PlayerIntel (long-term player profile)
  └── RoomIntel (room defense snapshot)

Defense Domain
  ├── DefensePosture (NORMAL → WATCH → ALERT → FORTIFY → DEFEND → EMERGENCY → EVACUATE)
  ├── TowerDefensePlan (target scoring / engagement / focus fire)
  ├── RampartDefensePlan (fortification roles / min-cut / maintenance)
  ├── SafeModeDecision (strategic resource budget)
  └── DefenderDeployment (position / formation / retreat)

Combat Domain
  ├── CombatCapability (attack/ranged/heal/toughness/mobility/dismantle/claim/support)
  ├── CombatPower (aggregated force estimate)
  ├── CombatTarget (scored target with strategic/economic/risk dimensions)
  ├── CombatOrder (MOVE/ATTACK/RANGED_ATTACK/HEAL/RETREAT/HOLD/BREACH/ESCORT/GUARD/SIEGE/SCOUT)
  └── EngagementDecision (engage/retreat/hold/reposition based on power comparison)

Operation Domain
  ├── MilitaryOperation (lifecycle: PLANNED→ASSEMBLING→DEPLOYING→ENGAGING→OBJECTIVE→EXTRACTING→COMPLETED/FAILED/ABORTED)
  ├── MilitaryObjective (DEFEND/ESCORT/SCOUT/HARASS/RAID/SIEGE/DISMANTLE/CLAIM/RESERVE/COUNTER_ATTACK)
  ├── Squad (leader/members/formation/objective/target/position/orders)
  ├── Casualty (loss tracking / replacement / cost accounting)
  └── RetreatDecision (P0 safety decision based on power/HP/heal/tower/rampart/escape)
```

### 5.2 纯函数接口契约

| 纯函数 | 输入 | 输出 | 所属层 |
| --- | --- | --- | --- |
| `assessThreat()` | RoomSnapshot + IntelSnapshot + DefenseSnapshot | ThreatAssessment | Defense / Operational |
| `evaluateCombatCapability()` | CreepSnapshot | CombatCapability | Combat / Tactical |
| `computeCombatPower()` | CombatCapability[] + FormationContext | CombatPower | Combat / Operational |
| `scoreCombatTarget()` | TargetSnapshot + CombatContext | TargetScore | Combat / Operational |
| `decideCombatAction()` | CombatContext + EngagementState | CombatAction | Combat / Tactical |
| `decideRetreat()` | FriendlyPower + EnemyPower + HP + Tower + Escape | RetreatDecision | Combat / Tactical (P0) |
| `selectTowerTarget()` | TowerThreat[] | targetId | Defense / Tactical |
| `assessEngagement()` | TowerSummary[] + HostileSquadSummary | EngagementDecision | Defense / Tactical |
| `evaluateWarOutcome()` | 战前账本 + 新鲜 intel | WarOutcome | Military / Operational |
| `selectWarTarget()` | WarTargetInput | WarTargetCandidate | Military / Operational |

> 所有纯函数**禁止**读 `Game` / `Memory` 全局态（同输入同输出，可快照回放单测）。
> 系统层收集摘要、调用纯函数、签发动作。

---

## 6. PVE 与 PVP 分离

### 6.1 严格分离原则

| 维度 | PVE (NPC) | PVP (Player) |
| --- | --- | --- |
| **对手** | Invader / Invader Core / Source Keeper | 玩家 |
| **行为模式** | 固定/可预测 | 不可预测 / 有策略 |
| **威胁模型** | 简单 body 解析 + 量级估计 | 需 PlayerIntel + boost 检测 + 补给链分析 |
| **情报需求** | 房间级实时即可 | 长期 PlayerIntel + 攻击历史 + 外交 |
| **响应级别** | 威胁级 1（骚扰）→ 塔自动清 | 威胁级 2–4 → 完整防御链 / war 授权 |
| **止损** | 不适用（NPC 无战略目标） | 完整止损链三闸 |
| **学习** | 不需要 | 记录 Prediction vs Actual |

### 6.2 PVE 响应合同

- **Invader**（NPC 游猎单位）：威胁级 1，塔自动清；远矿房走撤退预案
  （[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §7）。
- **Invader Core**（RCL0 中立房强占者）：core-clearer 角色回收，走远矿车道预算。
- **Source Keeper**：SK farming 是经济性 Operation（ROI 门控），复用军事编队但不
  走 war 授权（[MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §5）。

### 6.3 PVP 情报需求

- **PlayerIntel**（长期玩家画像）：威胁指数 / 攻击历史 / 胜率估计 / 黑名单 /
  最后活动房 / 宿敌距离 / 行为模式（[INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) §1）。
- **RoomIntel**（房间防御快照）：owner / RCL / 塔位 / heal 估计 / rampart 覆盖 /
  safe mode 状态。
- **CombatIntel**（交战情报）：编队组成 / boost 检测 / 补给距离 / 撤退路线。
- **Diplomacy 接口**（设计不实现）：UNKNOWN / NEUTRAL / FRIENDLY / HOSTILE / ALLY / NAP / WAR。

---

## 7. Diplomacy 接口设计（不实现）

```typescript
// 设计接口，不在 A5.x 早期实现
type DiplomaticStatus =
  | "unknown"    // 从未接触
  | "neutral"    // 中立（默认）
  | "friendly"   // 友好（不主动攻击，可共享情报）
  | "hostile"    // 敌对（威胁分级自动升级）
  | "ally"       // 盟友（防御互助，进攻协同）
  | "nap"        // 互不侵犯条约（NAP，限时）
  | "war";       // 战争状态（posture = war 的对等物）

interface DiplomacyEntry {
  username: string;
  status: DiplomaticStatus;
  establishedAt: number;     // 关系建立 tick
  expiresAt?: number;        // NAP 等有限期关系
  source: "manual" | "auto"; // 人工设定 vs 自动推断
  evidence?: string;         // 推断依据
}
```

**当前状态**：无盟约，`allies` 列表为空集但机制保留（AGENTS.md 战争条款）。
威胁分类的 `allies` 过滤已实现（`src/domain/defense/threat.ts`）。

---

## 8. Military Information Architecture

### 8.1 信息分层

| 信息域 | 存储位置 | TTL | 写者 | 消费者 |
| --- | --- | --- | --- | --- |
| **ThreatIntel** (实时威胁) | heap (globalCache) | 可见期结束 | room-snapshot → threat 分类 | tower-defense, defender |
| **RoomIntel** (房间情报) | segment (intel-rooms-*) | 5k–20k tick | Intelligence 系统唯一写者 | defense, war-planner, expansion |
| **PlayerIntel** (玩家画像) | segment (intel-players) | 衰减权重 | Intelligence 系统唯一写者 | war-planner, defense, posture |
| **CombatIntel** (交战记录) | segment (war ledger) | 滚动窗口 | war-planner | war-planner, recovery, tuning |
| **OperationIntel** (行动记录) | segment (war ledger) | 滚动窗口 | war-planner / defense-planner | recovery, decision-trace |

### 8.2 Military Memory 预算

| 字段 | 位置 | 大小预算 | 理由 |
| --- | --- | --- | --- |
| `warPlan` | Memory.kernel | ~100 bytes | 单活跃计划（目标/sponsor/phase/spawned） |
| `warBlacklist` | Memory.kernel | ~200 bytes | 房名→到期 tick，通常 <10 条 |
| `nukesInFlight` | Memory.kernel | ~100 bytes | 在途核弹台账 |
| `warStandDownUntil` | Memory.kernel | 8 bytes | 休战闸时间戳 |
| Defense state | RoomMemory | ~50 bytes/房 | colonyState + lastHostileAt + prevThreatCount |
| PlayerIntel | segment | ~2KB/玩家 | 月级长 TTL |
| War ledger | segment | ~10KB/波次 | 滚动窗口保留 |

**禁止**：保存整个 Game 状态、完整 creep body、历史路径、运行时索引。

---

## 9. CPU / Memory 控制

### 9.1 CPU 预算

| 子系统 | 预算 | 频率 | 降级路径 |
| --- | --- | --- | --- |
| tower-defense | P0, ~0.5–1 CPU/房/tick | 1t | 永不降级 |
| defender RolePolicy | P0, intent 税 0.2 CPU/creep | 1t | 永不降级 |
| threat 分类 (classifyThreats) | P0, O(hostiles) | 1t | 永不降级 |
| war-planner | P2, ~0.1–0.5 CPU/轮 | 10t | 非 war 仅一次收摊 |
| defense-planner | P3, ~0.1 CPU/轮 | 100t | Conserve 档降频 |
| assessThreat 纯函数 | 内联于 room-snapshot | 1t | 随 P0 走 |
| PlayerIntel 查询 | segment 异步 | 低频 | Recovery 档只留被动 |

### 9.2 Memory 控制

- Military Memory 总量 ≤ 500 bytes（常态），战争期 ≤ 2KB（warPlan + 黑名单 + 台账）。
- War ledger 走 segment（[STATE_OWNERSHIP_MODEL.md](../architecture/STATE_OWNERSHIP_MODEL.md) §3.7）。
- 不持久化：编队成员列表（heap querySquad 可重建）、威胁 creep 列表（快照瞬时）、
  战斗路径（事件流即可）。
- Confidence 衰减：所有情报带 TTL + observedAt，超期降级 fact→stale→inferred→unknown
  （[INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) §2）。

---

## 10. Combat Learning（设计不实现）

### 10.1 预测-实际校准框架

```text
战前: Prediction { expectedLoss, expectedGain, enemyPower, winProbability }
战后: Actual { actualLoss, actualGain, enemyResponse, outcome }
校准: Error = |Prediction - Actual| → 更新 PlayerIntel 行为画像 → 有界调参
```

- **记录**：每次 War Operation 记录 Prediction vs Actual（war ledger）。
- **更新**：PlayerIntel 行为画像（攻击模式/撤退习惯/boost 倾向）。
- **调参**：止损参数（casualtyMultiplier / warPressureTicks）在有界范围内调整
  （[MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §3 参数状态）。
- **禁止**：不实现 ML / 自适应学习；只做确定性统计 + 人工校准窗口。

---

## 11. Military Economy 合同

### 11.1 预算分账

```text
Empire Energy Surplus
  ├── Economy Budget (peace: 全开)
  │     ├── P0 生存链
  │     ├── P1 发展
  │     ├── P2 建造
  │     └── P3 增长
  ├── Defense Budget (fortify: 防御建设置顶)
  │     ├── tower 能量储备
  │     ├── rampart/wall 维护
  │     └── defender 孵化 (P0 车道)
  └── War Fund (war: 基金分账)
        ├── boost SLA 补产
        ├── attacker/healer 孵化
        ├── nuke 装填 (300k energy + 5k G)
        └── 物流补给 (Supply Contract)
```

### 11.2 每个 Military Operation 必须有 Budget

| 成本项 | 核算方式 | 来源 |
| --- | --- | --- |
| Spawn Cost | body 价格 × 编队人数 | research/03 §10 |
| Boost Cost | 30 矿 + 20 能量/part × boost 部件数 | research/03 §7 |
| Transport Cost | terminal 运费指数公式 / hauler 穿梭成本 | research/03 §7 |
| Energy Cost | 塔耗 / 维修 / spawn 充能 | DEFENSE §3 |
| Opportunity Cost | 军事占用期间经济产出损失 | ECONOMY |
| Replacement Cost | 死亡编队重置成本 | 止损链 |

### 11.3 战争基金门控

- **打得起** = 预期最大损失 ≤ 战争基金（从帝国能量盈余计提的专项储备）。
- 基金不足 → 只 fortify 不 war（哪怕被持续骚扰）。
- 基金耗尽 → 止损链强制退 fortify（经济底线不可被军事击穿）。

---

## 12. Military Logistics 合同

Military **不重建运输系统**，只产生 Supply Contract：

```text
Military 需要 1500 energy + 30 XUH2O (boost 矿物)
  ↓
Supply Contract (SupplyNode → DemandNode)
  ↓
TransportRequestV2 (Unified Logistics)
  ↓
hauler / terminal / link 执行运输
  ↓
Outcome 反馈 → Military 确认补给到位
```

- boost 生产：lab-system 管理反应链 + boost 消耗（[MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §2 Boost 行）。
- 能量补给：走标准 logistics 请求池。
- 跨房运输：terminal 网络走 Supply Contract → TransportPlan。

---

## 13. Military Recovery 合同

Military **不建第二套 Recovery 系统**，复用 A4.6：

```text
Squad loss (casualty > threshold)
  ↓
Failure signal → empire-health-system
  ↓
Recovery Action (recoveryActions channel)
  ↓
Recovery Execution System (A4.6)
  ↓
  ├── Spawn Reinforcement (SpawnManager P0/P1 车道)
  ├── Boost Replenishment (lab-system)
  ├── Logistics Re-supply (Unified Logistics)
  └── Squad Rebuild (war-planner build phase)
```

- Recovery 档军事集结**暂停**（编队停安全房待命而非解散）。
- war 期军事优先级上调但看门狗仍兜底。

---

## 14. Military Decision Trace 合同

Military **复用 A4.7**，所有重要决策必须支持：

| 决策类型 | DecisionSnapshot 内容 | CorrelationId |
| --- | --- | --- |
| posture 切换 → war | reason + evidence + budget snapshot | posture-{tick} |
| War Operation 立项 | target + squad + budget + deadline | war-{operationId} |
| 目标选择 | candidates + scoring + rejected alternatives | war-{operationId} |
| 止损触发 | casualty count + threshold + reason | war-{operationId} |
| safemode 决策 | trigger condition + shard quota + decision | defense-{room}-{tick} |
| tower 交战判定 | damage vs heal + engagement decision | defense-{room}-{tick} |
| 撤退决策 | power comparison + HP + escape route | combat-{squad}-{tick} |

- DecisionSnapshot 写入 Ring Buffer（decision-trace-system）。
- 支持 Deterministic Replay：相同输入 → 相同输出（纯函数保证）。

---

## 15. Military 对 Empire 各子系统的影响

| # | 影响维度 | 影响机制 |
| --- | --- | --- |
| 1 | **Expansion** | fortify/war 冻结扩张新开；战区房收缩远矿 |
| 2 | **Economy** | war 基金分账；defense 态能量配给序变更（tower > spawn > repair） |
| 3 | **Remote Operations** | 威胁 HIGH → CONTINUE/PAUSE/RETREAT/ESCORT/ABORT 决策 |
| 4 | **Empire Health** | 军事失败 → 失败传播 → recovery 优先级调整 |
| 5 | **Spawn** | war 期 P0/P1 车道军事优先级上调；非 war 仅维持 boost SLA |
| 6 | **Logistics** | Supply Contract 注入；战区房物流例外策略 |
| 7 | **Resource Network** | boost 库存消费节点；war 期 mineral 优先级上调 |
| 8 | **CPU Budget** | war 期军事 CPU 上调但看门狗兜底；Recovery 档集结暂停 |

---

## 16. 真实玩家边界场景研究

基于 Screeps 社区经验（Overmind/TooAngel/论坛/Reddit）和已冻结蓝图：

| 场景 | 描述 | 架构应对 |
| --- | --- | --- |
| **Fake Target（诱饵）** | 低价值目标示弱引诱反击 | PlayerIntel 画像反查；诱饵嫌疑硬否决（§不应攻击清单 #4） |
| **Boosted Tough Creep** | T3 tough ×0.3 减伤扛塔 | 交战盈亏判定（assessEngagement）；打不动停火蓄能 |
| **Heal Stack** | 多 healer 贴身奶编队 | 塔目标选择奶妈优先（selectTowerTarget）；集火协调 |
| **Tower Focus（吸塔）** | heal-tank 站远距把塔奶穿 | 塔停火条件：敌 heal ≥ 全塔净伤 → 蓄能退守 |
| **Rampart Dance** | 敌在 rampart 边缘反复进出 | 威胁过期失效 + 退出迟滞（defenseExitHysteresis） |
| **Flee Path（逃路）** | 敌引诱追击到伏击圈 | Defender 禁止追出门；hold position 合同 |
| **Choke Point** | 狭窄地形限制阵型 | min-cut 固化防线；defender 选择 choke 位 |
| **Swarm / Mass Attack** | 大量廉价单位淹没防御 | 威胁分级 3/4 → siege 能量会计；safe mode 决策表 |
| **Dismantle** | 拆家编队不吃伤害 | dismantle 不产能量 → 纯消耗战；wall/rampart 厚度门控 |
| **Claim** | 占领 controller | 威胁级 4 最高优先级响应；safe mode 优先 |
| **Safe Mode 时机** | 敌在关键时刻逼 safemode | safemode 决策表（战略资源预算）；nuke 预案独立轨道 |
| **Nuke** | 50k tick 飞行窗口 | observer 预警 → 资产抢救（planSalvageShipment）→ rampart 加固 |

---

## 17. 最终架构裁决

### 17.1 不创建的模块

本阶段**禁止创建**以下模块（除非研究最终明确需要）：

- ~~MilitaryManager~~ — 职责已分散到 war-planner / defense-planner / tower-defense
- ~~DefenseManager~~ — 职责已由 tower-defense + defense-planner + room-state 承担
- ~~CombatManager~~ — 战斗决策已由纯函数 + role-runner combat 钩子承担
- ~~SquadManager~~ — 编队管理已由 war-planner 集结 FSM 承担

### 17.2 现有代码的军事能力清单

| 能力 | 实现位置 | 状态 |
| --- | --- | --- |
| 威胁分类 | `src/domain/defense/threat.ts` | ✅ 已实现 |
| Tower 目标选择 | `src/domain/defense/tower-target.ts` | ✅ 已实现 |
| Tower 交战判定 | `src/domain/defense/tower-engagement.ts` | ✅ 已实现 |
| 防御工事分类 | `src/domain/defense/fortification.ts` | ✅ 已实现 |
| Nuke 响应 | `src/domain/defense/nuke-response.ts` | ✅ 已实现 |
| Tower 防御系统 | `src/systems/tower-defense.ts` | ✅ 已实现 |
| War Planner | `src/systems/war-planner.ts` | ✅ 已实现 |
| War Planning 纯函数 | `src/domain/war/planning.ts` | ✅ 已实现 |
| Power Farm Manager | `src/systems/power-farm-manager.ts` | ✅ 已实现 |
| Defender 角色 | `src/creeps/roles/defender.ts` | ✅ 已实现 |
| Attacker 角色 | `src/creeps/roles/attacker.ts` | ✅ 已实现 |
| Healer 角色 | `src/creeps/roles/healer.ts` | ✅ 已实现 |
| Remote Defender | `src/creeps/roles/remote-defender.ts` | ✅ 已实现 |
| Scout 角色 | `src/creeps/roles/scout.ts` | ✅ 已实现 |
| Defense Planner | `src/systems/defense-planner.ts` | ✅ 已实现 |

### 17.3 A5.0 识别的架构缺口

| # | 缺口 | 严重度 | 建议阶段 |
| --- | --- | --- | --- |
| G1 | 威胁评估缺乏 intent 推断（仅有 body 分类，无 SCOUTING/SIEGE 等意图分级） | MEDIUM | A5.1 |
| G2 | 无独立 CombatCapability 评估函数（attacker body 选择是静态的） | MEDIUM | A5.1 |
| G3 | Defender 位置选择缺乏地形/chokepoint 感知 | LOW | A5.2 |
| G4 | 远矿防御决策（CONTINUE/PAUSE/RETREAT/ESCORT/ABORT）未形式化 | MEDIUM | A5.1 |
| G5 | PlayerIntel 情报消费侧（威胁分级置信度衰减）未与 defense 分级完整对接 | LOW | A5.2 |
| G6 | Combat Learning 预测-实际校准框架未实现 | LOW | A5.3+ |
| G7 | Diplomacy 接口未实现（当前 allies 空集） | LOW | 不优先 |

---

## 18. 与冻结蓝图的关系

本规范是对以下冻结蓝图的**研究扩展**，不修改任何冻结契约：

| 冻结蓝图 | 本规范的关系 |
| --- | --- |
| [MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) | 进攻侧：完全继承 war 授权链 / 止损链 / 集结 FSM / 战后核验 |
| [DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) | 防御侧：完全继承五态状态机 / 威胁四级 / 能量会计 / tower 合同 |
| [INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) | 情报侧：完全继承六概念 / TTL 分档 / 新鲜度硬门槛 |
| [GOAL_POLICY_PLAN_MODEL.md](../architecture/GOAL_POLICY_PLAN_MODEL.md) | 姿态侧：完全继承 posture 四态 / 滞回 / 预算门控 |

如本规范与冻结蓝图冲突，以冻结蓝图为准。结构性修订必须走 ADR。

---

## 19. 最终回答（10 问）

### 1. Military 如何与 A4 Empire 集成？

Military 是 Empire 闭环的执行域，通过 posture（Policy 唯一桥梁）与 Economy /
Logistics 协同。Military 不建第二个 Runtime，只通过正式 Intent / Demand / Contract
影响其他子系统（§4）。

### 2. Military 如何复用 Unified Logistics？

Military 只产生 Supply Contract（SupplyNode → DemandNode），转化为
TransportRequestV2 提交到 Unified Logistics。不自行创建 hauler 或 terminal 动作（§12）。

### 3. Military 如何复用 Spawn Director？

Military 只产生 Spawn Demand（attacker/healer/defender），提交到 SpawnManager
队列。不自行调用 spawnCreep（§4.1）。

### 4. Military 如何复用 Recovery？

Squad loss → Failure signal → empire-health-system → recoveryActions →
Recovery Execution System → Spawn Reinforcement + Boost Replenishment +
Squad Rebuild。不建第二套 Recovery（§13）。

### 5. Military 如何复用 Decision Trace？

所有军事决策产出 DecisionSnapshot（reason + evidence + rejected alternatives +
correlationId），写入 decision-trace-system 的 Ring Buffer。支持 Deterministic
Replay（§14）。

### 6. Military 如何复用 Empire Resource Network？

Military 消费 SupplyNode（boost 库存），不直写 ResourceNode。boost 生产由
lab-system 管理，军事消耗走 Supply Contract → 请求池（§12）。

### 7. Military 如何影响 Expansion？

fortify/war 姿态冻结扩张新开；战区房收缩远矿。扩张门控消费 posture 作为
前置条件——非 peace 不开新 Agenda（§15）。

### 8. Military 如何影响 Economy？

war 基金分账：基金内军事消耗不与经济发展竞争；基金耗尽 → 止损链退 fortify。
defense 态能量配给序变更：tower > spawn 恢复 > repair > 其他（§11）。

### 9. Military 如何影响 Remote Operations？

远矿房威胁 HIGH → 系统决策 CONTINUE/PAUSE/RETREAT/ESCORT/ABORT。远矿车道
自动暂停 N tick 后恢复；高频骚扰损失计入远矿 ROI 核算（§15）。

### 10. Military 如何影响 Empire Health？

军事失败（squad 全灭 / 目标失败）→ 失败传播 → empire-health 威胁维度恶化 →
recovery 优先级调整。战后核验结果写入 war ledger 滚动窗口（§13/§14）。

---

## 20. 结论

A5.0 是纯架构研究阶段。本规范证明：现有冻结蓝图（MILITARY_ARCHITECTURE +
DEFENSE_ARCHITECTURE + INTELLIGENCE_ARCHITECTURE）已覆盖军事架构的核心契约，
现有代码已实现威胁分类、tower 防御、war planner、集结 FSM、止损链、战后核验
等关键能力。A5.0 识别了 7 个架构缺口，其中 3 个 MEDIUM 级缺口（G1 威胁意图
推断、G2 CombatCapability 评估、G4 远矿防御决策）建议在 A5.1 优先实现。