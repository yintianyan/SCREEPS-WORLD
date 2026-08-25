# A5.0 — Defense Model

> **阶段**：A5.0 · 纯架构研究。**不写生产代码**。
> **依据**：[DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md)（冻结蓝图） ·
> 现有代码 `src/systems/tower-defense.ts` / `src/domain/defense/`。
> **关键原则**：Defense ≠ Attack。防御系统保护 Empire，不自行发动战争。

---

## 1. Defense Posture Model

### 1.1 房间级五态状态机（冻结蓝图 DEFENSE_ARCHITECTURE §1）

```text
normal → alert → siege → recovery → stabilizing
  ↑                                           │
  └───────────────────────────────────────────┘
```

| 状态 | 进入事实 | 退出条件 | 能量配给 | 现有实现 |
| --- | --- | --- | --- | --- |
| normal | 无可见敌 | — | 正常预算 | ✅ colonyState=normal |
| alert | 威胁级 ≥2 | 威胁消失持续 N tick | tower > spawn > repair | ✅ colonyState=defense |
| siege | 威胁级 3 | 能量会计转正 + 无可见敌 | tower > spawn恢复 > repair | ⚠️ 未独立态 |
| recovery | 围城解除 | 六闭环健康 | 恢复优先分配 | ⚠️ 未独立态 |
| stabilizing | recovery 达健康 | 滞回 + 战后核验 | 接近正常 | ⚠️ 未独立态 |

### 1.2 与 Empire Posture 的关系

- Defense 状态是**房间级属地执行**
- Empire posture（peace/fortify/war/evacuate）是**帝国级姿态**
- **一房 alert 不得惊动全帝国**（DEFENSE_ARCHITECTURE §1）
- 上行：持续 siege / 多房 alert → fortify 或 war 的候选信号
- 下行：posture 决定防御预算基准

### 1.3 防抖合同

- 进入 1 tick 触发（防御不延迟）
- 退出需持续 N tick（`defenseExitHysteresis`）
- `lastHostileAt` 只在威胁**新增**时刷新
- 威胁过期失效：`threatStaleTicks` 超时

---

## 2. Tower Defense Model

### 2.1 Tower Target Scoring（现有实现）

`selectTowerTarget()` 纯函数（`src/domain/defense/tower-target.ts`）：

```text
排序优先级:
  ① 奶妈优先 (healParts > 0 排在无 HEAL 之前)
  ② 有效血量最低优先 (最脆先杀)
  ③ 距塔近者优先 (塔伤随距离衰减, 近处收益最大)

effectiveHp = hits + healParts × HEAL_POWER × HEAL_BUFFER_TICKS
  // HEAL_POWER=12, HEAL_BUFFER_TICKS=5
```

### 2.2 Tower Engagement Decision（现有实现）

`assessEngagement()` 纯函数（`src/domain/defense/tower-engagement.ts`）：

```text
开火条件:
  engage = breachingCore || expectedDamage > expectedHeal

  expectedDamage = Σ(towerDamageAt(rangeToTarget)) for each tower with energy ≥ 10
  expectedHeal = totalHealParts × HEAL_POWER

  towerDamageAt(range):
    range ≤ 5: 600 (满效)
    range 5→20: 线性衰减至 150 (25%)
    range ≥ 20: 150

停火条件:
  敌编队有效 heal ≥ 全塔净伤 → 停火蓄能退守
  (heal-tank 骗塔战术, DEFENSE_ARCHITECTURE §4)
```

### 2.3 Tower Contract（冻结蓝图 DEFENSE_ARCHITECTURE §4）

| # | 条款 | 现有实现 |
| --- | --- | --- |
| 1 | 目标价值排序：dismantler/attack > healer > 高DPS > 残血收割 | ✅ selectTowerTarget |
| 2 | 发前三查：目标存在 + 有效射程 + 塔能量够 | ✅ tower-defense |
| 3 | 集火协调：同房多塔同 tick 打同一优先目标 | ✅ tower-defense |
| 4 | 停火条件：敌 heal ≥ 全塔净伤 → 停火蓄能 | ✅ assessEngagement |
| 5 | 塔修理仅在非战斗期 | ✅ tower-defense |

### 2.4 Tower Target Scoring 扩展设计

现有评分考虑：healParts / hits / rangeToTower。
**缺口**：未考虑 rampart 保护 / tough boost / attack parts / work parts。

扩展评分维度（A5.1 候选）：

```text
扩展 TowerThreat:
  - attackParts: number    → 即时威胁 (打塔/打建筑)
  - workParts: number      → dismantle 威胁
  - claimParts: number     → claim 威胁 (最高优先)
  - toughBoost: boolean    → tough boost 减伤 (打不动)
  - rampartProtected: boolean → 在 rampart 内 (塔打不到)

扩展优先级:
  ① claim 动作 (占房最高优先)
  ② dismantle 关键结构 (即时威胁)
  ③ 奶妈 (healParts > 0)
  ④ 高 DPS (attackParts + rangedParts 最高)
  ⑤ 残血收割 (hits 最低)
  ⑥ 近距优先 (rangeToTower 最低)

  跳过: tough boost + rampart 保护 (打不动不浪费能量)
```

---

## 3. Rampart Defense Model

### 3.1 Rampart 价值（冻结蓝图 DEFENSE_ARCHITECTURE §6）

- rampart 使覆盖下的建筑对塔/攻击免疫（只有 dismantle 可拆 rampart 本身）
- 厚度目标分级：normal 低档 / alert 上调 / siege 最高档
- 衰减 300 hits/100 tick（需持续维护）
- min-cut 线固化进模板（防线形态由离线计算决定，线上只维护）

### 3.2 Fortification Role 分类（现有实现）

`classifyFortification()` 纯函数（`src/domain/defense/fortification.ts`）：

| 角色 | 维护目标 | 来源 |
| --- | --- | --- |
| perimeter | 周界全额 | min-cut 割集 + wall |
| core | 核心折扣 | spawn/extension/storage/tower/link 位置 |
| utility | 仅地板 | container 位置 |

### 3.3 Rampart 覆盖位置

```text
必须覆盖:
  ├── Tower (防御火力源)
  ├── Spawn (人口生产)
  ├── Storage (能量储备)
  ├── Terminal (资源网络节点)
  ├── Controller (核心, 失去=失房)
  ├── Labs (boost 生产)
  └── Sources (产能)

可选覆盖:
  ├── Extension (能量充能点)
  ├── Road (交通, rampart 上道路仍可通行)
  └── Container (低值, 只保地板)

出口:
  └── Rampart 封锁出口 = min-cut 割集 (防线骨架)
```

### 3.4 nuke 预案（现有实现）

`planSalvageShipment()` + `pickSalvageRecipient()`（`src/domain/defense/nuke-response.ts`）：

```text
observer/scout 发现 Game.nukes 落点本房
  ↓
50,000 tick 窗口内:
  1. 加固落点半径内 rampart 至 1M+
  2. 转移 terminal 资产到无警报兄弟房 (planSalvageShipment)
  3. 评估撤离成本

safemode 与 nuke 预案 = 两条独立轨道
  (nuke 落地即取消 safemode, DEFENSE_ARCHITECTURE §6)
```

---

## 4. SafeMode Decision Model

### 4.1 决策表（冻结蓝图 DEFENSE_ARCHITECTURE §5）

| 条件 | 动作 | 现有实现 |
| --- | --- | --- |
| 无塔 + 核心被突破 | 开 safemode | ✅ tryActivateSafeMode |
| 有塔但全打不出 + 核心被突破 | 开 safemode | ✅ fleetLossFuse + !fired + breachingCore |
| 舰队伤亡熔断 (≥3 只) | 开 safemode | ✅ fleetLossFuseTripped |
| 骚扰级 (invader/单只) | 禁开 | ✅ threatCreeps 过滤 |
| nuke 落点本房 | 禁开 (转 nuke 预案) | ⚠️ 未对接 |
| 本 shard 名额已占 | 禁开 | ✅ safeModeAvailable 检查 |
| 冷却未过 | 禁开 | ✅ safeModeCooldown 检查 |

### 4.2 多房抉择

多房同时候选时按**可保住房评分**抉择：
- 房间资产价值（spawn/storage/controller 等级）
- × 防御可持续时间 T（能量会计）
- × 失守可恢复性

未获名额的候选房走保命模式。

---

## 5. Defender Deployment Model

### 5.1 位置选择原则

```text
禁止: 简单追 Closest Hostile
必须考虑:
  ├── Terrain (平原/沼泽/路 = fatigue 差异)
  ├── Rampart (站在 rampart 上 = 免疫远程攻击)
  ├── Tower Coverage (站在塔满效区 = 塔火支援)
  ├── Range (与敌保持最优交战距离)
  ├── Exit (不堵出口, 留撤退路线)
  ├── Choke Point (狭窄地形限制敌方阵型)
  └── Squad Formation (编队阵型位置)
```

### 5.2 Defender 部署决策

```text
1. 威胁在核心区:
   → Defender 站位 = spawn/controller 旁 rampart 上 (塔满效区内)

2. 威胁在房边缘:
   → Defender 不追出 (hold position)
   → 塔自动处理

3. 多方向入侵:
   → 按威胁量级分配 (最大威胁方向优先)
   → 不平均分兵

4. 撤退:
   → HP < 30% ∧ 无 heal 支持 → 撤退到 spawn 旁
   → 威胁消除 → 回防位
```

### 5.3 现有实现

`src/creeps/roles/defender.ts`：
- gate: 威胁在场才激活
- acquire: 从 threatCreeps 选目标
- work: attack 目标
- onFlee: HP 低时撤退
- hold: 在 home 房待命

**缺口 G3**：位置选择缺乏地形/chokepoint 感知，简单追最近敌人。

---

## 6. Energy Accounting Model (Siege)

### 6.1 围城胜负判定式（冻结蓝图 DEFENSE_ARCHITECTURE §3）

```text
防御可持续时间 T = (tower 可用能量 + storage 水位 × 转化率 + 补给速率 × t) / 塔耗速率

塔耗速率 ≈ 动作塔数 × 10 能量/tick (满频)

敌方成本 ≈ tank 血量损耗 + heal 消耗 (其补给受距离惩罚)

守得住 ⟺ T > 敌方可持续威胁时间 ∧ 补给链不被切断
```

### 6.2 配给序

| 状态 | 能量配给优先序 |
| --- | --- |
| normal | 正常预算 |
| alert | tower > spawn > repair |
| siege | tower > spawn恢复 > repair > 其他 (upgrade≈0) |
| recovery | 恢复优先分配 |
| stabilizing | 接近正常 |

### 6.3 守不住时的保命模式

```text
T 低于阈值:
  → 能量转移 (terminal 撤资)
  → 保 spawn/controller
  → safemode 时机进入决策表
  → 评估撤离
```

---

## 7. Room Defense Plan

### 7.1 防御计划组成

```text
RoomDefensePlan:
  ├── Tower Plan (目标选择 + 交战判定 + 集火协调)
  ├── Rampart Plan (维护目标 + 厚度分级 + min-cut)
  ├── SafeMode Plan (触发条件 + 时机决策)
  ├── Defender Plan (部署位置 + 撤退条件 + 替补)
  └── Energy Plan (配给序 + 围城会计 + 保命模式)
```

### 7.2 防御计划生成

- **defense-planner** (P3, 100t)：低频生成/更新防御计划
- **tower-defense** (P0, 1t)：实时执行塔动作
- **room-state** (P0, 1t)：实时更新 colonyState

### 7.3 紧急路径

紧急模式不是随意绕过架构，而是预先设计的有限状态机：
`Normal → Alert → Siege/Recovery → Stabilizing → Normal`

可提高防御和最低生存链路的优先级，但仍须使用已定义的 State、预算、幂等 action 和退出条件。

---

## 8. Remote Defense Model

### 8.1 远矿防御决策（缺口 G4）

```text
远矿房 Threat Assessment
  ↓
  ├── level 0 → CONTINUE
  ├── level 1 → PAUSE (N tick 后恢复)
  ├── level 2 → ESCORT (duo 轻队护航, 防御预算)
  ├── level 3 → RETREAT (撤退远矿 creep, 车道暂停)
  └── level 4 → ABORT (放弃车道, 重新 ROI 评估)
```

### 8.2 现有实现

- 远矿房 invader → 自动暂停（`src/systems/remote-mining-manager.ts`）
- remote-defender 角色 → 杀 NPC reserver/Invader
- core-clearer 角色 → 拆 Invader Core

### 8.3 敌 reserver / claimer 响应

- 敌 reserver → source 满容量（3,000）被取消，远矿收益减半
- 敌 claimer → 自有房威胁级 4 响应（占房语义，优先级最高）

---

## 9. Empire Defense Model

### 9.1 多房同时受袭

- 按**生存风险、资源和恢复成本**分配，不默认平均分兵
- 优先保：controller > spawn > 能源 > 撤退通道
- 多房 safemode 抉择：按可保住房评分

### 9.2 帝国级防御信号

- 持续 siege / 多房 alert → posture 升格候选信号
- PlayerIntel 持续威胁记忆 → fortify/war 进入条件
- 防御系统**永不**自行反打出门

---

## 10. 现有代码对照

| 现有代码 | 覆盖的 Defense 概念 | 缺口 |
| --- | --- | --- |
| tower-defense.ts | 塔动作签发 + safemode + 维修 | siege 态未独立 |
| tower-target.ts | 塔目标选择（奶妈/脆/近） | 无 rampart/boost 感知 |
| tower-engagement.ts | 交战盈亏判定 | 完整 |
| fortification.ts | 工事角色分类 | 完整 |
| nuke-response.ts | nuke 资产抢救 | 完整 |
| threat.ts | 威胁分类 + 小队判定 | 无 intent |
| room-state.ts | colonyState + 威胁记忆 | 完整 |
| defense-planner.ts | 防御规划 | 需扩展 |
| defender.ts | 防御者角色 | 位置选择缺地形 |

---

## 11. 结论

现有代码已实现 Tower 防御全链（目标选择 → 交战判定 → 集火协调 → 停火蓄能 → safemode → 维修），
nuke 响应链（落点感知 → 资产抢救），威胁分类（body 过滤 + 小队判定）。
A5.0 Defense Model 识别的核心缺口：

1. **G3 — Defender 位置选择**：需要地形/chokepoint/tower-coverage 感知
2. **siege/recovery/stabilizing 三态**：colonyState 未区分（当前 defense 是单一态）
3. **Tower 目标评分扩展**：需考虑 rampart 保护 / tough boost / claim 部件

建议 A5.2 实现 G3 和 siege 三态独立化。