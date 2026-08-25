# A5.0 — Threat Intelligence Model

> **阶段**：A5.0 · 纯架构研究。**不写生产代码**。
> **依据**：[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §2 ·
> [INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) §1/§5 ·
> 现有代码 `src/domain/defense/threat.ts`。
> **关键原则**：Threat ≠ Hostile Creep。`hostileCreeps.length > 0` ≠ `Threat = HIGH`。

---

## 1. 核心原则：Threat 不等于 Hostile Creep

### 1.1 禁止的简化

```typescript
// ❌ 禁止：见敌就 HIGH
if (hostileCreeps.length > 0) threatLevel = HIGH;
```

一个仅有 MOVE 的 scout 过境不应触发全帝国动员。威胁评估必须综合：
body 组成、boost 状态、编队量级、玩家画像、房间所有权、距离/补给线、
防御覆盖（tower/rampart/safemode）、经济能力。

### 1.2 现有代码基线

`src/domain/defense/threat.ts` 已实现基础威胁分类：
- `isThreat()`：区分威胁 creep 与无害过客（scout/reserver/中立）
  ——只有带 ATTACK/RANGED_ATTACK/HEAL/WORK/CLAIM 的才算威胁。
- `isSquadThreat()`：小队判定（≥2 武装 或 ≥1 武装 + 治疗）
- `classifyThreats()`：批量分类，过滤 allies

**缺口 G1**：现有分类只识别「是否有威胁部件」，不推断敌方意图
（SCOUTING / SIEGE / ECONOMIC_ATTACK 等）。

---

## 2. Threat Domain Model

### 2.1 概念层次

```text
ThreatSource (威胁来源)
  ├── NPC: Invader / Invader Core / Source Keeper
  └── Player: username + PlayerIntel

ThreatAssessment (威胁评估)
  ├── level: 0(无) / 1(骚扰) / 2(raid) / 3(siege) / 4(拆家/占领)
  ├── confidence: fact / stale / inferred / unknown
  ├── sources: ThreatSource[]
  ├── estimatedPower: CombatPower
  ├── estimatedIntent: ThreatIntent
  ├── timeToImpact: number (tick)
  └── recommendedPosture: DefensePosture

ThreatIntent (威胁意图)
  ├── UNKNOWN
  ├── SCOUTING
  ├── HARASSMENT
  ├── REMOTE_MINING_ATTACK
  ├── SIEGE
  ├── CONTROLLER_ATTACK
  ├── ECONOMIC_ATTACK
  ├── CLAIM
  ├── FULL_ASSAULT
  └── NUCLEAR
```

### 2.2 威胁四级分级链（冻结蓝图 DEFENSE_ARCHITECTURE §2）

```text
可见敌 creep → identify（body 解析：attack/ranged/heal/dismantle/claim 计数
  + tough/boost 检测 + 玩家 vs NPC）→ 量级估计（编队 heal 总量、有效 HP、
  补给距离）→ 分级 → 匹配 policy
```

| 等级 | 判据（例） | 响应要点 | 现有实现 |
| --- | --- | --- | --- |
| 0 无威胁 | 无可见敌 | normal：零成本巡检 | ✅ room-state |
| 1 骚扰 | invader / 单只低价值游猎 | 塔自动处理；远矿走撤退预案 | ✅ classifyThreats + tower-defense |
| 2 raid | 小队突入：编队含 attack/dismantle、heal 弱 | alert：塔集火 + defender 补位 + 配给启动 | ✅ isSquadThreat + colonyState=defense |
| 3 siege | 围城 / 吸塔：敌房外游走或 heal ≥ 塔净伤 | siege：能量会计接管 | ⚠️ 交战判定已有，siege 态未独立 |
| 4 拆家/占领 | dismantler 群或 claim 动作 | 保命序 + safemode 候选 | ⚠️ claim 检测未形式化 |

### 2.3 评估输入

`assessThreat()` 纯函数的输入：

```typescript
interface ThreatAssessmentInput {
  // 房间快照
  roomSnapshot: {
    roomName: string;
    hostileCreeps: readonly CreepSummary[];
    threatCreeps: readonly CreepSummary[];
    towers: readonly TowerSummary[];
    ramparts: number;
    spawns: number;
    controller: { level: number; safeMode?: number; safeModeAvailable: number };
    energyAvailable: number;
  };
  // 情报快照
  intelSnapshot: {
    playerIntel: Map<string, PlayerIntelSummary>;
    roomIntel: RoomIntelSummary | undefined;
  };
  // 防御快照
  defenseSnapshot: {
    colonyState: ColonyState;
    lastHostileAt: number | undefined;
    towerEnergyTotal: number;
    rampartCoverage: number;
  };
}
```

### 2.4 评估输出

```typescript
interface ThreatAssessment {
  level: 0 | 1 | 2 | 3 | 4;
  confidence: "fact" | "stale" | "inferred" | "unknown";
  sources: ThreatSource[];
  estimatedPower: {
    attack: number;
    rangedAttack: number;
    heal: number;
    effectiveHP: number;
    dismantle: number;
  };
  estimatedIntent: ThreatIntent;
  timeToImpact: number; // tick，基于距离和移动速度
  recommendedPosture: DefensePosture;
}
```

---

## 3. Threat Intent 推断框架

### 3.1 意图分类

| 意图 | 判据（综合信号） | 置信度要求 |
| --- | --- | --- |
| **UNKNOWN** | 信息不足（body 未解析 / owner 未知 / 距离过远） | 默认 |
| **SCOUTING** | 仅 MOVE 部件 / 1 只 / 不接近核心区 / 穿过房间 | fact |
| **HARASSMENT** | 1–2 只武装 / 攻击外围经济 creep / 不深入 | fact |
| **REMOTE_MINING_ATTACK** | 在远矿房出现 / 攻击 remote harvester | fact |
| **SIEGE** | 房外驻留 / heal ≥ 塔净伤 / 不突入 / 持续 N tick | fact + 行为模式 |
| **CONTROLLER_ATTACK** | claim 部件 / 接近 controller / upgrade 攻击 | fact |
| **ECONOMIC_ATTACK** | dismantle 部件 / 攻击 storage/terminal/source | fact |
| **CLAIM** | claim 动作 / reserver 预约中立房 | fact |
| **FULL_ASSAULT** | 大编队 / boost 检测 / 多方向进入 / tower drain | fact + PlayerIntel |
| **NUCLEAR** | Game.nukes 落点本房 / 附近 | fact（引擎事实） |

### 3.2 推断规则（纯函数，禁止读 Game/Memory）

```text
推断链（按优先级从高到低）:

1. Game.nukes 落点 → NUCLEAR (fact, 引擎事实)
2. claim 动作可见 → CLAIM (fact)
3. dismantle 部件 + 接近 storage/terminal → ECONOMIC_ATTACK (fact)
4. 编队 heal ≥ 塔净伤 + 房外驻留 > N tick → SIEGE (fact + 行为)
5. 大编队(≥4) + boost 检测 → FULL_ASSAULT (fact + PlayerIntel)
6. 远矿房出现武装 → REMOTE_MINING_ATTACK (fact)
7. 接近 controller + claim/attack 部件 → CONTROLLER_ATTACK (fact)
8. 1-2 武装 + 攻击外围 creep → HARASSMENT (fact)
9. 仅 MOVE / 穿过房间 → SCOUTING (fact)
10. 信息不足 → UNKNOWN
```

### 3.3 置信度衰减

- **fact**：本源直接观测且在新鲜度窗内（可见敌 creep body 解析）
- **stale**：曾观测、超窗未复核（PlayerIntel 历史记录）
- **inferred**：先验推导（行为模式假设、补给距离估算）
- **unknown**：无信息（情报盲区）

**硬门槛**（[INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) §5）：
- stale/inferred 不得作为 fact 参与任何硬门槛
- 进攻/占领/大额调拨只接受 fact 级
- unknown 按最保守分计（未知 ≠ 安全）

---

## 4. Threat Assessment 纯函数设计

### 4.1 assessThreat() 签名

```typescript
function assessThreat(input: ThreatAssessmentInput): ThreatAssessment;
```

### 4.2 评估算法

```text
1. 解析所有可见敌 creep body:
   - 统计 ATTACK / RANGED_ATTACK / HEAL / WORK / CLAIM / TOUGH / MOVE 部件数
   - 检测 boost (body.boost 存在则 T2/T3)
   - 区分 NPC (owner = "Invader" / "Source Keeper") vs Player

2. 量级估计:
   - attackPower = Σ(ATTACK × 30 × boostMultiplier)
   - rangedPower = Σ(RANGED_ATTACK × 10 × boostMultiplier)
   - healPower = Σ(HEAL × 12 × boostMultiplier)  // 远程 heal ×4
   - effectiveHP = Σ(hits + tough × toughReduction)
   - dismantlePower = Σ(WORK × 50 × boostMultiplier)  // dismantle 模式

3. 分级:
   - level 0: 无可见威胁 creep
   - level 1: 单只低价值 (invader / 无 boost 独狼)
   - level 2: 小队 (≥2 武装 或 1武装+heal)，heal < 塔净伤
   - level 3: heal ≥ 塔净伤 或 房外驻留 > siegeThreshold
   - level 4: dismantle 群 或 claim 动作

4. 意图推断 (§3.2 规则)

5. 置信度:
   - 可见 body 解析 → fact
   - PlayerIntel 历史 → stale/inferred
   - 无视野 → unknown

6. timeToImpact:
   - 基于敌方距离核心区 / 移动速度 (fatigue 估算)
   - 预测值标 inferred

7. recommendedPosture:
   - level 0 → NORMAL
   - level 1 → WATCH (塔自动处理)
   - level 2 → ALERT (defender 补位)
   - level 3 → FORTIFY/DEFEND (能量会计)
   - level 4 → EMERGENCY (保命序 + safemode)
```

### 4.3 boost 检测

引擎常量（research/03 §7）：

| 部件 | T1 | T2 | T3 |
| --- | --- | --- | --- |
| ATTACK | ×2 | ×3 | ×4 |
| RANGED_ATTACK | ×2 | ×3 | ×4 |
| HEAL | ×2 | ×3 | ×4 |
| TOUGH (减伤) | ×0.7 | ×0.5 | ×0.3 |
| DISMANTLE (WORK) | ×1.5 | ×1.8 | ×2 |

检测方式：`creep.body[i].boost` 存在且为 T 矿物 → 按倍率计算。

---

## 5. PlayerIntel 情报模型

### 5.1 长期玩家画像

```typescript
interface PlayerIntelSummary {
  username: string;
  threatIndex: number;        // 0-100，基于攻击历史/军力/距离
  attackHistory: AttackRecord[]; // 滚动窗口
  winRateEstimate: number;    // 0-1，基于历史交战
  blacklist: boolean;         // warBlacklist 冷却
  lastActiveRoom: string;     // 最后活动房
  nemesisDistance: number;    // 到我方核心房的线性距离
  behavioralPattern: {
    preferredAttackTime?: number;   // 活跃时段
    boostPreference?: string;       // 偏好 boost 类型
    retreatPattern?: string;        // 撤退习惯
    expansionDirection?: string;    // 扩张方向
  };
  diplomacyStatus: DiplomaticStatus;
}
```

### 5.2 消费合同

| 消费者 | 消费方式 |
| --- | --- |
| `assessThreat()` | threatIndex 影响分级上限；behavioralPattern 辅助意图推断 |
| `selectWarTarget()` | nemesisDistance 影响目标优先序；blacklist 排除冷却目标 |
| Policy (posture) | 持续威胁记忆影响 fortify/war 进入条件 |
| Defense | 攻击历史影响 safemode 决策表 |

### 5.3 存储合同

- **存储位置**：segment `intel-players`（[INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) §3）
- **TTL**：衰减权重而非删除（hivemind 先例）
- **写者**：Intelligence 系统唯一写者
- **大小**：~2KB/玩家，独立 1–2 段

---

## 6. RoomIntel 防御快照

### 6.1 房间情报字段

```typescript
interface RoomIntelSummary {
  roomName: string;
  owner?: string;           // controller owner
  rcl?: number;
  towers?: number;          // 塔数量
  towerPositions?: number[]; // 塔坐标 (packed)
  healEstimate?: number;    // 估计 heal 能力
  rampartCoverage?: number; // 0-1
  safeMode?: number;        // 剩余 tick
  safeModeAvailable?: number;
  lastSeen: number;         // observedAt tick
  sourceCount?: number;
  mineralType?: string;
}
```

### 6.2 消费合同

| 消费者 | 消费方式 |
| --- | --- |
| `assessThreat()` | rampartCoverage / safeMode 影响防御深度评估 |
| `selectWarTarget()` | towers / rcl / owner 影响目标可行性 |
| Defense | towerPositions 影响塔覆盖范围计算 |
| Expansion | owner / rcl 影响扩张尽调评分 |

---

## 7. Defense Escalation（威胁升级链）

```text
WATCH (level 1)
  ↓ 威胁升级 (raid 编队入房)
ALERT (level 2)
  ↓ 威胁升级 (heal ≥ 塔净伤 / 持续驻留)
FORTIFY/DEFEND (level 3)
  ↓ 威胁升级 (dismantle 群 / claim 动作)
EMERGENCY (level 4)
  ↓ 评估为不可守
EVACUATE (按房)
```

### 7.1 升级合同

| 转移 | 进入事实 | 退出条件（滞回） | 现有实现 |
| --- | --- | --- | --- |
| WATCH → ALERT | 威胁级 ≥2（raid 编队入房） | 威胁消失持续 N tick | ✅ colonyState=defense |
| ALERT → FORTIFY | 威胁级 3（heal ≥ 塔净伤） | 能量会计转正 + 无可见敌 | ⚠️ siege 态未独立 |
| FORTIFY → EMERGENCY | 威胁级 4（dismantle/claim） | 结构保住 + 威胁消除 | ⚠️ 未形式化 |
| EMERGENCY → EVACUATE | 评估为不可守 | 撤离完成或威胁消除 | ⚠️ 未形式化 |

### 7.2 防抖合同

- 房间防御状态带**滞回**：进入 1 tick 触发，退出需持续 N tick 无新威胁
  （`defenseExitHysteresis`，[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §1）。
- `lastHostileAt` 只在威胁**新增**时刷新（防旧威胁停留永久维持 defense）
  （`src/systems/room-state.ts` 实现）。
- 威胁过期失效：`threatCreeps > 0` 但 `lastHostileAt` 超 `threatStaleTicks`
  → stale threat，不再触发 defense。

---

## 8. Remote Operation Defense

### 8.1 远矿威胁响应决策

```text
远矿房 Threat Assessment
  ↓
  ├── level 0 → CONTINUE (正常运营)
  ├── level 1 → PAUSE (暂停 N tick 后恢复)
  │     └── 高频出现 → 骚扰损失计入远矿 ROI
  ├── level 2 → ESCORT (派 duo 轻队护航)
  │     └── 走防御预算，不升战争
  ├── level 3 → RETREAT (撤退远矿 creep)
  │     └── 车道自动暂停，威胁消除后恢复
  └── level 4 → ABORT (放弃远矿车道)
        └── 进入收缩评估，重建需重新走 ROI 门控
```

### 8.2 现有实现

- 远矿房 invader → 自动暂停 N tick（`src/systems/remote-mining-manager.ts`）
- 敌 reserver → 中立缓冲房 source 满容量被取消（`[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §7`）
- 敌 claimer → 自有房威胁级 4 响应

**缺口 G4**：CONTINUE/PAUSE/RETREAT/ESCORT/ABORT 决策未形式化为纯函数。

---

## 9. Convoy / Logistics Defense

### 9.1 护航合同

- 敌单只杀贫 creep（hauler/worker）→ 按经济损失计入 PlayerIntel 威胁记忆
  （[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §7）
- 持续骚扰 → duo 轻队定点护航，走**防御预算**，不升战争
- 护航范围：hauler 路径上的关键房间，不追出门

### 9.2 物流例外策略

- 战区房 terminal 不按和平均衡器抽空关键资源
- 危险房走 nuke 预案资产抢救（`planSalvageShipment`）
- Supply Contract 到战区房的运输需走安全路线（findRoute 避开战区）

---

## 10. Threat Expiration

### 10.1 过期规则

| 信息 | 过期条件 | 降级路径 |
| --- | --- | --- |
| 可见敌 creep | 离开视野 | 立即降级为 stale → N tick 后 unknown |
| RoomIntel | 超 TTL（5k–20k tick） | fact → stale → inferred → unknown |
| PlayerIntel | 衰减权重（非删除） | threatIndex 衰减但不归零 |
| War blacklist | TTL 到期 | 自动清除（`pruneWarBlacklist`） |
| Nuke 落点 | 落地或取消 | 台账清除（`pruneNukeLedger`） |

### 10.2 防过期风暴

- TTL 到期时间戳加 jitter（[INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md) §2.3）
- 老化低频批处理
- 过期不触发高成本行动（先侦察后行动）

---

## 11. False Positive 防护

### 11.1 误报场景

| 场景 | 误报风险 | 防护 |
| --- | --- | --- |
| Scout 过境 | 误触发全帝国防御 | `isThreat()` 过滤无威胁部件的 creep |
| 无害侦察目击 | 误升姿态 | observerSightings 与 lastHostileAt 刻意分开 |
| 旧威胁停留 | 永久维持 defense | threatStaleTicks 超时失效 |
| 边缘进出 | 高频抖动 colonyState | defenseExitHysteresis 退出迟滞 |
| 诱饵示弱 | 误判为可攻目标 | PlayerIntel 画像反查 + 诱饵嫌疑硬否决 |

### 11.2 防护合同

- 威胁分类只认**带威胁部件**的 creep（`THREAT_PARTS` 过滤）
- allies 列表过滤（`src/domain/defense/threat.ts`）
- 置信度三分禁止混用（fact/stale/inferred 不互通）
- 未知 ≠ 安全（无情报按最保守分计）

---

## 12. 与现有代码的对照

| 现有代码 | 覆盖的威胁模型概念 | 缺口 |
| --- | --- | --- |
| `isThreat()` | ThreatSource 区分（NPC vs Player + allies） | 无 intent 推断 |
| `classifyThreats()` | 威胁 creep 过滤 | 无 boost 检测 |
| `isSquadThreat()` | 编队量级判定（≥2 武装 / 1武装+heal） | 无 estimatedPower 计算 |
| `selectTowerTarget()` | 奶妈优先 / 最脆优先 / 近距优先 | 无 rampart 覆盖感知 |
| `assessEngagement()` | 交战盈亏判定（damage vs heal） | 无 timeToImpact 估算 |
| `resolveUnderSiege()` | 受袭姿态判定 | 无 intent 分级 |
| room-state threatStale | 威胁过期失效 | 无置信度衰减 |
| `planSalvageShipment()` | Nuke 响应资产抢救 | 完整 nuke 预案链 |

---

## 13. 结论

现有代码已实现威胁分类（body 部件过滤）和基础量级判定（小队威胁、交战盈亏）。
A5.0 威胁模型识别的核心缺口：

1. **G1 — Intent 推断**：需要 `assessThreat()` 纯函数综合 body / boost / 行为 /
   PlayerIntel 推断 SCOUTING / SIEGE / ECONOMIC_ATTACK 等意图
2. **G4 — 远矿防御决策**：CONTINUE/PAUSE/RETREAT/ESCORT/ABORT 需形式化为纯函数
3. **G5 — PlayerIntel 对接**：威胁分级置信度衰减需与 defense 分级完整对接

建议在 A5.1 优先实现 G1 和 G4。