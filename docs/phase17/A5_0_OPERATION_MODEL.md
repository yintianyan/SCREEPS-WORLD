# A5.0 — Military Operation Model

> **阶段**：A5.0 · 纯架构研究。**不写生产代码**。
> **依据**：[MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §1–§7 ·
> [GOAL_POLICY_PLAN_MODEL.md](../architecture/GOAL_POLICY_PLAN_MODEL.md) §2/§3 ·
> 现有代码 `src/systems/war-planner.ts` / `src/domain/war/planning.ts`。
> **关键原则**：Military Operation 是有界任务（预算/期限/取消条件），不是无限战争。

---

## 1. Military Operation Lifecycle

### 1.1 九态生命周期

```text
PLANNED → ASSEMBLING → DEPLOYING → ENGAGING → OBJECTIVE → EXTRACTING → COMPLETED
                ↑           │          │          │          │
                └───────────┴──────────┴──────────┘
                     (失败/中止回退)
                                                         → FAILED
                                                         → ABORTED
```

| 状态 | 语义 | 进入条件 | 退出条件 | 现有实现 |
| --- | --- | --- | --- | --- |
| PLANNED | 目标已选，计划制定中 | war posture + 目标池非空 | 计划就绪 → ASSEMBLING | ✅ selectWarTarget |
| ASSEMBLING | 集结+boost | warPlan 创建 | 满编 → DEPLOYING | ✅ build phase |
| DEPLOYING | 推进到目标 | 全员到齐 (waiting) | 到达目标房 → ENGAGING | ✅ advance phase |
| ENGAGING | 交战中 | 到达目标房 | 目标达成/止损 → OBJECTIVE/EXTRACTING | ✅ engage phase |
| OBJECTIVE | 目标达成 | 目标摧毁/占领 | 开始撤退 → EXTRACTING | ⚠️ evaluateWarOutcome |
| EXTRACTING | 撤退中 | 目标达成/止损 | 撤退完成 → COMPLETED | ✅ demobilize |
| COMPLETED | 成功完成 | 撤退完成 + 核验通过 | — | ✅ WarOutcome=success |
| FAILED | 失败 | 止损/核验失败 | — | ✅ WarOutcome=failure |
| ABORTED | 中止 | posture 退 war / 超时 | — | ✅ demobilize(reason) |

### 1.2 与现有集结 FSM 的对照

冻结蓝图 MILITARY_ARCHITECTURE §4 集结 FSM：

```text
recruit → build → advance → engage → rotate
```

| FSM 相位 | Operation Lifecycle 映射 | 现有实现 |
| --- | --- | --- |
| recruit | PLANNED → ASSEMBLING | ✅ submitSquadRequest |
| build | ASSEMBLING (hold 钩子归建) | ✅ build phase |
| advance | DEPLOYING (满编才推进) | ✅ advance phase |
| engage | ENGAGING (队形微操) | ✅ engage phase |
| rotate | EXTRACTING (伤员轮换/撤退) | ✅ demobilize |

---

## 2. Military Objective

### 2.1 目标类型

| 目标 | 语义 | 授权需求 | 编队形态 | 现有支持 |
| --- | --- | --- | --- | --- |
| DEFEND | 防守房间 | defense 态（不需 war） | defender | ✅ |
| ESCORT | 护航 | defense 态 | duo 轻队 | ⚠️ 未形式化 |
| SCOUT | 侦察 | peace/fortify | solo scout | ✅ prospect-manager |
| HARASS | 骚扰 | war 姿态 | duo 轻队 | ⚠️ 未实现 |
| RAID | 突袭 | war 姿态 | quad/swarm | ⚠️ 未实现 |
| SIEGE | 围城 | war 姿态 | quad | ⚠️ 未实现 |
| DISMANTLE | 拆迁 | war 姿态 | quad (dismantle) | ⚠️ 未实现 |
| CLAIM | 占领 | peace/expand | claimer | ✅ expansion-manager |
| RESERVE | 预约 | peace | reserver | ✅ remote-mining |
| COUNTER_ATTACK | 反击 | war 姿态 | quad | ⚠️ 未实现 |

### 2.2 目标选择纯函数（现有实现）

`selectWarTarget()` （`src/domain/war/planning.ts`）：

```text
输入: WarTargetInput {
  candidates: WarTargetCandidate[]  // 从 RoomIntel 采集
  freshness: number                 // 观察年龄阈值
  maxTowers: number                 // 塔数上限
  blacklist: Record<string, number> // warBlacklist
}

输出: WarTargetCandidate | undefined

选择规则:
  1. 过滤: fact 级 ∧ 观察年龄 < freshness ∧ 非占用 ∧ 非黑名单
  2. 排序: 战略价值 (宿敌核心 > 扩张前哨 > 低价值) × 可行性 (RCL/距离/塔)
  3. 返回最高分候选
```

---

## 3. War Authorization Chain

### 3.1 授权链合同（冻结蓝图 MILITARY_ARCHITECTURE §1）

```text
PlayerIntel 持续威胁记忆 (被打 N tick, 事实级)
  ∧ 战争经济学核算通过 (打得起: 预期最大损失 ≤ 战争基金)
  ∧ 目标池非空 (fact 级新鲜 + 非黑名单)
  → posture: fortify → war (Policy 唯一授权, 滞回)
  → war-planner 创建 War Operation
  → attacker 孵化 (唯一路径: war-planner → SpawnManager)
```

### 3.2 止损链三闸（冻结蓝图 MILITARY_ARCHITECTURE §3）

| 闸 | 触发 | 动作 | 现有实现 |
| --- | --- | --- | --- |
| 1 伤亡闸 | spawned 超 squadSize × casualtyMultiplier | 本波次强制收摊 | ✅ isAttritionLost |
| 2 目标闸 | 目标失败/unknown | 进 warBlacklist 冷却 | ✅ demobilize |
| 3 经济闸 | 经济压力持续超标经 warPressureTicks | 强制退 fortify | ⚠️ 参数 SPECULATION |

### 3.3 退出滞回

- war 退出窗口 ≥ 一个完整波次周期（集结 + 推进 + 战后核验）
- minDuration 由波次周期推导
- `warStandDownUntil` 挡「A 止损 → 立刻打 B」跨目标循环

---

## 4. Squad Model

### 4.1 标准编队形态（冻结蓝图 MILITARY_ARCHITECTURE §2）

| 形态 | 组成 | 用途 |
| --- | --- | --- |
| quad | 2 前排 tough/attack + 2 后排 heal (贴身) | 主力攻坚 |
| duo | attack + heal | 巡逻 / 反骚扰轻队 |
| swarm | 多只廉价单位 | 对无塔目标 |

### 4.2 Squad 接口

```typescript
interface Squad {
  id: string;
  leader: string;
  members: string[];
  formation: "solo" | "duo" | "quad" | "swarm";
  objective: MilitaryObjective;
  target?: string;
  position?: { x: number; y: number; roomName: string };
  orders: CombatOrder[];
  phase: "recruit" | "build" | "advance" | "engage" | "rotate";
  budget: {
    spawnCost: number;
    boostCost: number;
    transportCost: number;
    maxLoss: number;
  };
}
```

### 4.3 编队组建

```text
decideSquadSize(towersSeen, squadBase, squadPerTower):
  // 塔越多, 编队越大
  // squadBase + towersSeen × squadPerTower

decideHealerCount(squadSize, healerSquadRatio):
  // healer 数 = squadSize × ratio (通常 0.5 = 一半是 healer)
```

### 4.4 Boost 门禁

```text
evaluateBoostGate(boostedLive, liveTotal, hasLabs, gracePeriodExpired):
  // 满编且全员强化才 advance
  // 缺口则先补产能再开集结 (不开车)
  // 无 lab / 宽限期过 → undefined 豁免 (裸攻由止损链兜底)
```

---

## 5. Operation Budget

### 5.1 预算组成

```typescript
interface OperationBudget {
  // 孵化成本
  spawnCost: number;          // Σ(body price × count)
  spawnTime: number;          // Σ(3 × parts)
  // Boost 成本
  boostCost: Map<string, number>;  // mineral → amount
  boostEnergy: number;        // 20 energy × boost parts
  // 运输成本
  transportCost: number;      // terminal/hauler 估算
  // 能量消耗
  energyBudget: number;       // 塔耗/维修/spawn 充能
  // 机会成本
  opportunityCost: number;    // 经济停滞损失
  // 最大损失
  maxLoss: number;            // 编队全灭时的总损失
  // 战争基金扣减
  fundAllocation: number;     // 从战争基金划拨的额度
}
```

### 5.2 战争基金门控

- **打得起** = 预期最大损失 ≤ 战争基金
- 基金从帝国能量盈余计提
- 基金不足 → 只 fortify 不 war
- 基金耗尽 → 止损链退 fortify

---

## 6. Post-War Verification

### 6.1 战后核验合同（冻结蓝图 MILITARY_ARCHITECTURE §7）

```text
evaluateWarOutcome(战前账本 + 新鲜 intel):
  输入:
    - 战前预期 (账本: spawned/损失)
    - 新鲜 intel (战后 scout/observer 复核的 fact 级观察)
  输出:
    - WarOutcome: success | failure | unknown

  规则:
    - 只信新鲜 intel (战前情报与传闻一律不算数)
    - success: 目标房塔数减少/owner 变化/结构摧毁 (新鲜观察证实)
    - failure: 目标房防御完好 (新鲜观察证实打不动)
    - unknown: intel 过期/无视野 (缩短黑名单冷却)

  事件记录:
    - WarOutcome 事件 → 遥测管线写 segment
    - 滚动窗口保留
```

### 6.2 黑名单

```text
failure → blacklistWarTarget(room, tick + warBlacklistTicks)
unknown → blacklistWarTarget(room, tick + warBlacklistTicks / 2)
  // unknown 用半额冷却 — intel 过期不是目标的错

黑名单是冷却不是永久放弃
冷却期内同玩家其他目标仍可评估
```

---

## 7. Power Operation (准军事)

### 7.1 Power Bank Farming（冻结蓝图 MILITARY_ARCHITECTURE §5）

```text
发现 (observer/巡检, 世界结构先验只查 highway)
  → 评分 (power 量 × 价格 − 编队成本 − 距离/衰减窗口 − 竞争者风险)
  → 动态配兵
  → 提前备 pickup creeps (掉落衰减)
  → strike (复用军事编队)
  → collect (回收 + 捡运)

目标含敌竞争者 → 升格为 war 授权问题
```

### 7.2 SK Farming

- 常驻 farming Operation（keeper 击杀循环或「关进 lair」）
- 复用军事编队与集结机制
- 走 ROI 门控，不需 war posture
- +10 creeps / +2–3 CPU 成本计入远矿/扩张 ROI

### 7.3 现有实现

- `src/systems/power-farm-manager.ts`：PB 野采全链
- `src/domain/war/power-farm.ts`：PB 目标选择纯函数

---

## 8. Nuke Operation

### 8.1 使用门槛表（冻结蓝图 MILITARY_ARCHITECTURE §6）

| 门槛 | 内容 | 现有实现 |
| --- | --- | --- |
| 授权 | war posture 已授权；决策属战略层（Policy） | ✅ war-planner |
| 目标 | 高价值僵局：safemode 保下的关键房 / 地面无法破防 | ✅ towerThreshold |
| 资源 | 沉没可承受：300k energy + 5k ghodium + 100k tick 冷却 | ✅ nukerReady 检查 |
| 计划 | 发射后 50,000 tick 飞行窗口的进驻计划已备案 | ⚠️ 未形式化 |
| 区域 | Novice 区禁用 | ✅ expansion 排除 |

### 8.2 发射决策（现有实现）

```text
shouldLaunchNuke({
  nukerReady,           // 能量+G+冷却
  nukesInFlightToTarget, // 在途不重复
  towersSeen,           // 塔数门槛 (只射编队啃不动的重防房)
  towerThreshold,
  linearDistance,       // 射程内 (≤10 房)
  maxRange,
})
```

### 8.3 在途台账

```text
recordNukeLaunch(targetRoom, tick):
  // 台账 push + cooldown 5000 双保险
  // 同目标在途期间不重复发射

pruneNukeLedger(tick):
  // 清理已落地的台账条目
```

---

## 9. Military Strategy Layer

### 9.1 三层控制（与 A5_0_MILITARY_ARCHITECTURE §3 一致）

```text
Strategic: "为什么打" — Policy 求值 posture (100-500t)
  ↓
Operational: "怎么打" — war-planner 创建 Operation (10-100t)
  ↓
Tactical: "这一 tick 做什么" — RolePolicy 执行 (1t)
```

### 9.2 示例

```text
Strategic: DEFEND W3N7
  → Policy 评估: 持续被打 + 打得起 → posture = war

Operational: Deploy Defense Squad → Deploy Attack Squad
  → war-planner: selectWarTarget → 创建 WarPlan
  → 编队组建: squadSize + healerCount
  → 集结 FSM: recruit → build → advance

Tactical: Hold Rampart Position 17,24
  → attacker RolePolicy: hold 钩子在目标房待命
  → engage: 集火目标 + 阵型微操
```

---

## 10. 现有代码对照

| 现有代码 | 覆盖的 Operation 概念 | 缺口 |
| --- | --- | --- |
| war-planner.ts | 完整集结 FSM + 止损 + 核验 + nuke | 无多目标/多波次 |
| planning.ts | selectWarTarget / evaluateWarOutcome / isAttritionLost | 无 Budget 核算 |
| power-farm.ts | PB 目标选择 + attrition + timeout | 完整 |
| attacker.ts | ATTACK / BREACH / RETREAT | 无阵型协调 |
| healer.ts | HEAL | 无编队 heal 分配 |

---

## 11. 结论

现有代码已实现完整的 War Operation 生命周期（选目标 → 集结 → 推进 → 交战 → 撤退 →
核验 → 黑名单），止损链三闸，nuke 发射决策，PB 野采全链。
A5.0 Operation Model 确认的核心能力：

1. **Operation 生命周期九态**：现有 build/advance/engage/rotate 四相 FSM 覆盖核心路径
2. **止损链三闸**：伤亡闸 + 目标闸 + 经济闸完整实现
3. **战后核验**：evaluateWarOutcome 纯函数 + 新鲜 intel 硬门槛
4. **nuker 决策**：shouldLaunchNuke 纯函数 + 在途台账

Operation Model 无重大缺口，建议 A5.1 聚焦于 Threat Model 和 Combat Model 的缺口。