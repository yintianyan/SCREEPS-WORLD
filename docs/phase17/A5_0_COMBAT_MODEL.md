# A5.0 — Combat Model

> **阶段**：A5.0 · 纯架构研究。**不写生产代码**。
> **依据**：[MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §2/§4 ·
> [DEFENSE_ARCHITECTURE.md](../architecture/DEFENSE_ARCHITECTURE.md) §4 ·
> research/03 §8（战斗数值）。
> **关键原则**：Combat Power ≠ `body.length`。不简单数部件，要综合 boost / terrain /
> formation / support / distance 计算真实战斗力。

---

## 1. Screeps Combat Mechanics 事实基准

### 1.1 Body Part 伤害/治疗数值（research/03 §8，引擎常量）

| 部件 | 伤害/效果 | 价格 | 备注 |
| --- | --- | --- | --- |
| ATTACK | 30/tick (近身) | 80 | 需贴身 |
| RANGED_ATTACK | 10/tick (3 格内) | 150 | 远程，可集火 |
| HEAL | 12/tick (近身) / 4/tick (远程) | 250 | 远程 heal 仅 1/3 |
| TOUGH | 100 hits 额外血量 | 10 | 前排先损 |
| MOVE | 移动能力 | 50 | 空 Carry 不计 fatigue |
| WORK | dismantle 50/tick | 100 | 不产能量 |
| CLAIM | reserve/claim | 600 | 寿命 600 tick |

### 1.2 Tower 数值（research/03 §8）

| 属性 | 数值 |
| --- | --- |
| 攻击 | 600/tick（≤5 格满效） |
| 治疗 | 400/tick |
| 修理 | 800/tick |
| 耗能 | 10/次 |
| 衰减 | 5→20 格线性衰减至 25%（TOWER_FALLOFF=0.75） |

### 1.3 Boost 倍率（research/03 §7）

| 部件类型 | T1 | T2 | T3 |
| --- | --- | --- | --- |
| ATTACK / RANGED_ATTACK / HEAL | ×2 | ×3 | ×4 |
| TOUGH (减伤) | ×0.7 | ×0.5 | ×0.3 |
| DISMANTLE (WORK) | ×1.5 | ×1.8 | ×2 |
| MOVE | ×2 | ×3 | ×4 |

### 1.4 其他关键事实

- 寿命：1,500 tick
- 孵化：3 tick/part（50 part = 150 tick）
- Fatigue = 体重 × 地形（路 1/平原 2/沼泽 10），每 MOVE 每 tick 减 2
- Wall 上限 300M；rampart 按 RCL（30 万→3 亿），衰减 300 hits/100 tick
- Nuke：中心 10M / ≥2 格 5M 伤害；落地取消 safemode
- Safemode：20,000 tick / 冷却 50,000 tick / 每 shard 同时一房

---

## 2. Combat Capability Model

### 2.1 CombatCapability 接口

```typescript
interface CombatCapability {
  // 原始部件统计
  parts: {
    attack: number;
    rangedAttack: number;
    heal: number;
    tough: number;
    move: number;
    work: number;     // dismantle capability
    claim: number;
    carry: number;
  };
  // boost 状态
  boost: {
    attack?: BoostTier;    // T1/T2/T3
    rangedAttack?: BoostTier;
    heal?: BoostTier;
    tough?: BoostTier;
    move?: BoostTier;
    work?: BoostTier;
  };
  // 派生能力
  attack: number;         // 有效攻击力 (含 boost)
  rangedAttack: number;   // 有效远程攻击力 (含 boost)
  heal: number;           // 有效治疗量 (含 boost)
  toughness: number;      // 有效血量 (含 tough + boost)
  mobility: number;       // 移动能力 (move/bodyweight, 含 boost)
  dismantle: number;      // 拆迁能力 (work × dismantle 倍率)
  claim: number;          // claim 部件数
  support: number;        // 支援能力 (heal 远程能力)
  // 经济属性
  cost: number;           // body 总价
  spawnTime: number;      // 孵化时间 (3 × part 数)
}
```

### 2.2 evaluateCombatCapability() 纯函数

```typescript
function evaluateCombatCapability(creep: CreepSnapshot): CombatCapability;
```

**计算公式**（基于引擎常量）：

```text
attack = attackParts × 30 × boostMultiplier(attack)
  // boostMultiplier: T1=2, T2=3, T3=4, 无=1

rangedAttack = rangedParts × 10 × boostMultiplier(rangedAttack)

heal = healParts × 12 × boostMultiplier(heal)
  // 远程 heal = heal × (1/3)

toughness = hits + toughParts × 100 × toughReduction(tough)
  // toughReduction: T1=0.7, T2=0.5, T3=0.3 (减伤比例)
  // 即 T3 tough 每部件有效血量 = 100 / 0.3 ≈ 333

mobility = moveParts × 2 × boostMultiplier(move) / totalBodyWeight
  // 空 Carry 不计体重

dismantle = workParts × 50 × boostMultiplier(work)
  // T1=1.5, T2=1.8, T3=2

cost = Σ(partPrice)
  // move/carry=50, work=100, attack=80, ranged=150, heal=250, claim=600, tough=10

spawnTime = totalParts × 3
```

---

## 3. Combat Power Model

### 3.1 CombatPower 接口

```typescript
interface CombatPower {
  // 进攻力
  burstDamage: number;     // 单 tick 最大伤害 (attack + rangedAttack)
  sustainedDamage: number;  // 持续伤害 (考虑 fatigue/位置)
  // 防御力
  effectiveHP: number;     // 有效血量 (toughness + heal 自愈)
  // 支援力
  healOutput: number;      // 治疗输出 (近身 + 远程)
  // 机动性
  mobility: number;        // 移动能力
  // 拆迁力
  dismantleRate: number;   // 拆墙速度
  // 综合
  powerScore: number;      // 综合战斗力评分
}
```

### 3.2 computeCombatPower() 纯函数

```typescript
function computeCombatPower(
  capabilities: CombatCapability[],
  context: FormationContext,
): CombatPower;
```

**计算公式**：

```text
burstDamage = Σ(cap.attack + cap.rangedAttack)
  // 集火时全编队同 tick 伤害

sustainedDamage = burstDamage × mobilityFactor
  // mobilityFactor: 高机动=1.0, 低机动=0.5 (追不上打不了)

effectiveHP = Σ(cap.toughness) + Σ(cap.heal × healBufferTicks)
  // healBufferTicks=5: 折算 5 tick 自愈量进有效血量

healOutput = Σ(cap.heal)
  // 近身 heal 优先, 远程 heal ×(1/3)

powerScore = burstDamage × 0.3 + effectiveHP × 0.2 + healOutput × 0.3
  + mobility × 10 + dismantleRate × 0.2
  // 权重 SPECULATION, 待实战校准
```

### 3.3 Formation Context

```typescript
interface FormationContext {
  formation: "solo" | "duo" | "quad" | "swarm";
  // 阵型影响: quad 贴身 heal 效率最高, swarm 分散火力
  terrain: "plain" | "swamp" | "road" | "rampart";
  // 地形影响: rampart 内防御加成, swamp 降机动
  towerCoverage: number;    // 0-1, 敌塔覆盖程度
  // 塔覆盖影响: 高覆盖 = 我方 effectiveHP 衰减
  friendlyTowerSupport: number;  // 0-1, 我方塔支援
}
```

---

## 4. Combat Target Selection

### 4.1 scoreCombatTarget() 纯函数

```typescript
interface TargetSnapshot {
  roomName: string;
  owner?: string;
  rcl?: number;
  towers?: number;
  towerPositions?: number[];
  healEstimate?: number;
  rampartCoverage?: number;
  safeMode?: number;
  safeModeAvailable?: number;
  energyValue?: number;     // 可掠夺能量
  strategicValue?: number;  // 战略价值评分
  distance?: number;        // 线性距离
  lastSeen?: number;        // 观察新鲜度
}

interface CombatContext {
  ourPower: CombatPower;
  warFund: number;
  boostInventory: Map<string, number>;
  posture: string;
}

interface TargetScore {
  totalScore: number;
  strategicValue: number;   // 战略价值
  feasibility: number;      // 可行性 (RCL/距离/塔/防御)
  economicValue: number;    // 经济价值 (可掠夺/可破坏)
  risk: number;             // 风险 (预期损失)
  expectedGain: number;     // 预期收益
  expectedLoss: number;     // 预期损失
  netValue: number;         // 净值 = expectedGain - expectedLoss
  recommendation: "attack" | "hold" | "skip";
}
```

### 4.2 评分算法

```text
strategicValue:
  - 宿敌核心产能房: 100
  - 宿敌扩张前哨: 60
  - 报复性低价值目标: 20 (原则上不打)
  - 无战略价值: 0

feasibility:
  - RCL 匹配 (我方 RCL ≥ 目标 RCL - 2): +30
  - 距离匹配 (≤5 房): +30; >10 房: -50
  - 塔数门控 (我方编队 > 塔数 × threshold): +20
  - boost 库存充足: +20

economicValue:
  - 可掠夺能量 / 1000
  - 可破坏结构价值
  - 矿物资源价值

risk:
  - 目标 heal 估计 / 我方 burstDamage: 高 heal = 高风险
  - rampartCoverage × 50: 高覆盖 = 难破防
  - safeModeAvailable: 有 safemode = 不可破
  - 补给线距离: 远 = 高风险

expectedLoss = risk × replacementCost
expectedGain = economicValue × winProbability
netValue = expectedGain - expectedLoss

recommendation:
  - netValue > 0 ∧ feasibility > threshold → attack
  - netValue ≈ 0 → hold (侦察/等待)
  - netValue < 0 → skip
```

---

## 5. Combat Decision

### 5.1 decideCombatAction() 纯函数

```typescript
type CombatAction =
  | "ATTACK"       // 攻击当前目标
  | "RETREAT"      // 撤退
  | "HOLD"         // 坚守当前位置
  | "REPOSITION"   // 重新定位
  | "HEAL"         // 治疗友军
  | "ESCORT"       // 护航
  | "SCOUT"        // 侦察
  | "SIEGE"        // 围城
  | "BREACH"       // 破墙
  | "GUARD";       // 守卫

interface EngagementState {
  friendlyHP: number;
  friendlyHPMax: number;
  enemyHP: number;
  enemyHPMax: number;
  friendlyPower: CombatPower;
  enemyPower: CombatPower;
  towerSupport: number;    // 我方塔支援
  enemyTowerCount: number;
  escapeAvailable: boolean;
  objective: MilitaryObjective;
  ticksInCombat: number;
}

function decideCombatAction(
  context: CombatContext,
  state: EngagementState,
): { action: CombatAction; reason: string };
```

### 5.2 决策规则

```text
1. P0 撤退判定 (decideRetreat, 独立优先):
   - friendlyHP / friendlyHPMax < retreatThreshold (0.3?)
   - enemyPower.burstDamage > friendlyPower.healOutput + friendlyHP
   - 无塔支援 + 敌方优势 + escapeAvailable → RETREAT
   - 否则不退

2. 目标在射程内:
   - enemyHP 低且我方优势 → ATTACK
   - enemyHP 高且我方劣势 → REPOSITION (拉开距离)

3. 目标不在射程:
   - objective = SIEGE → SIEGE (围城)
   - objective = DEFEND → HOLD (坚守)
   - objective = ESCORT → ESCORT
   - objective = SCOUT → SCOUT

4. 友军受伤:
   - healOutput > 0 ∧ friendlyHP < 50% → HEAL

5. 墙/rampart 阻挡:
   - dismantleRate > 0 ∧ objective = BREACH → BREACH
```

---

## 6. Retreat Decision (P0)

### 6.1 decideRetreat() 纯函数

```typescript
interface RetreatInput {
  friendlyPower: CombatPower;
  enemyPower: CombatPower;
  friendlyHP: number;
  friendlyHPMax: number;
  towerSupport: number;
  rampartProtection: boolean;
  reinforcementETA: number;   // 援军到达 tick
  safeModeActive: boolean;
  escapeRoute: boolean;       // 有撤退路线
  objective: MilitaryObjective;
  expectedLoss: number;
}

interface RetreatDecision {
  retreat: boolean;
  reason: string;
  retreatTarget?: string;     // 撤退目标房
}
```

### 6.2 撤退规则

```text
必须撤退 (retreat = true):
  1. friendlyHP / friendlyHPMax < 0.3 ∧ enemyPower.burstDamage > friendlyPower.healOutput
     → 即将团灭，无法维持
  2. enemyPower.burstDamage > friendlyPower.effectiveHP + towerSupport
     → 敌方一击秒杀，无生存可能
  3. reinforcementETA > remainingSurvivalTime
     → 援军来不及，继续打等于送死
  4. objective = ESCORT ∧ 被保护对象已撤离
     → 护航任务完成

不撤退 (retreat = false):
  1. safeModeActive → safemode 期间敌方攻击无效
  2. rampartProtection ∧ enemyPower.burstDamage < rampartHP
     → rampart 挡得住
  3. towerSupport > enemyPower.healOutput
     → 塔火力压制
  4. objective = DEFEND ∧ 核心区未突破
     → 防守任务在身，不能退

条件撤退:
  - escapeRoute = false → 即使该退也退不了，转 HOLD (死守)
  - objective = SIEGE ∧ 长期消耗不利 → RETREAT (战略性撤退)
```

### 6.3 撤退路线

- 撤退方向 = 离敌方最远的出口 / 朝 sponsor 方向
- 撤退路径走 findRoute 两级寻路（避开敌占房）
- 撤退到安全房后进入 build 相位重组

---

## 7. Squad / Formation Model

### 7.1 编队形态

| 形态 | 组成 | 用途 | 来源 |
| --- | --- | --- | --- |
| **solo** | 1 只 | 侦察/巡逻/反独狼 | 常规 |
| **duo** | attack + heal | 巡逻/反骚扰轻队/护航 | [MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md) §2 |
| **quad** | 2 tough/attack + 2 heal (贴身) | 主力攻坚 | Overmind 先例 |
| **swarm** | 多只廉价单位 | 对无塔目标 | 廉价版 |

### 7.2 Squad 接口

```typescript
interface Squad {
  id: string;
  leader: string;           // leader creep name
  members: string[];        // all member names
  formation: "solo" | "duo" | "quad" | "swarm";
  objective: MilitaryObjective;
  target?: string;          // target room/object
  position?: { x: number; y: number; roomName: string };
  orders: CombatOrder[];    // 当前命令队列
  phase: "recruit" | "build" | "advance" | "engage" | "rotate";
}
```

### 7.3 阵型位置

```text
Quad (贴身阵型, 2×2):

  [T/ATTACK]  [T/ATTACK]     ← 前排 (tough + attack, 扛塔+输出)
  [HEAL]      [HEAL]          ← 后排 (heal, 贴身奶前排)

  中心点 = 编队几何中心
  决策 = 中心点移动 + 集火目标选择
  微操 = 伤员轮换 (前排伤的退到后排, 后排满血顶上)
```

### 7.4 集结 FSM（冻结蓝图 MILITARY_ARCHITECTURE §4）

```text
recruit (孵化+boost) → build (hold 钩子归建待命) → advance (满编才推进)
  → engage (队形微操: 中心点+集火) → rotate (伤员轮换/撤退回 build)
```

**满编才 advance**：全员到齐才转 advance——单兵不被派去送死（TooAngel 先例）。

---

## 8. Combat Orders

| 命令 | 语义 | 执行者 |
| --- | --- | --- |
| MOVE | 移动到指定位置 | role-runner (traffic-manager 签发) |
| ATTACK | 近身攻击目标 | attacker (combat 钩子) |
| RANGED_ATTACK | 远程攻击目标 | attacker (combat 钩子) |
| HEAL | 治疗友军 | healer (combat 钩子) |
| RETREAT | 撤退到安全房 | 全编队 (flee 钩子) |
| HOLD | 坚守当前位置 | defender/attacker (hold 钩子) |
| BREACH | 拆墙突破 | attacker (work 钩子) |
| ESCORT | 护航目标 | duo 轻队 |
| GUARD | 守卫位置 | defender |
| SIEGE | 围城（房外驻留消耗） | attacker+healer |
| SCOUT | 侦察（不入战斗） | scout |

---

## 9. Expected Loss Model

### 9.1 交换比计算

```text
Expected Gain:
  - 可掠夺能量 = terminal/storage 估计量 × 掠夺成功率
  - 可破坏结构价值 = structureCount × avgValue
  - 战略收益 = 目标战略价值评分 × 1000

Expected Loss:
  - 编队成本 = Σ(body cost) for all squad members
  - Boost 成本 = Σ(30 矿 + 20 energy) × boost parts
  - 补给成本 = transport cost during operation
  - 机会成本 = militaryCPU × tickValue + economyStallTime × productionRate
  - 替换成本 = 编队全灭时的重置成本

Exchange Ratio = Expected Gain / Expected Loss
  - > 1.5: 值得攻击
  - 1.0–1.5: 边际，需战略考量
  - < 1.0: 不值得（纯消耗）
```

### 9.2 示例

```text
Attack: 目标房有 5000 energy (storage) + 3 tower
  Expected Gain: 5000 energy + 战略价值 3000 = 8000
  Expected Loss:
    - Squad: 4 attacker (4×230=920) + 2 healer (2×300=600) = 1520 energy
    - Boost: 20 parts × (30 XUH2O + 20 energy) = 600 XUH2O + 400 energy
    - Transport: ~200 energy
    - Opportunity: ~500 energy (stall time)
    - Total: ~2620 energy + 600 XUH2O
  Exchange Ratio: 8000 / 2620 ≈ 3.05 → 值得攻击

  但如果目标有 safemode:
  Expected Gain: 0 (safemode 期间无法破坏)
  Expected Loss: 2620
  Exchange Ratio: 0 → 不值得
```

---

## 10. 现有代码对照

| 现有代码 | 覆盖的 Combat 概念 | 缺口 |
| --- | --- | --- |
| `src/domain/war/planning.ts` | selectWarTarget / evaluateWarOutcome / isAttritionLost | 无 CombatCapability 评估 |
| `src/domain/defense/tower-engagement.ts` | assessEngagement (damage vs heal) | 仅塔侧，无编队对编队 |
| `src/domain/defense/tower-target.ts` | selectTowerTarget (奶妈优先) | 仅塔目标选择 |
| `src/creeps/roles/attacker.ts` | ATTACK / BREACH / RETREAT | 无阵型协调 |
| `src/creeps/roles/healer.ts` | HEAL | 无编队 heal 分配 |
| `src/creeps/roles/defender.ts` | HOLD / GUARD | 无地形感知 |
| `src/domain/defense/threat.ts` | isSquadThreat | 无 CombatPower 计算 |

---

## 11. 结论

现有代码已实现塔侧战斗决策（目标选择 + 交战盈亏判定）和 war-planner 编队管理。
A5.0 Combat Model 识别的核心缺口：

1. **G2 — CombatCapability 评估**：需要 `evaluateCombatCapability()` 纯函数从
   creep body 解析出结构化战斗能力（attack/heal/toughness/mobility/dismantle）
2. **CombatPower 聚合**：需要 `computeCombatPower()` 综合编队能力 + 阵型 + 地形
3. **decideRetreat P0**：需要形式化撤退判定纯函数（friendlyPower vs enemyPower + HP + escape）

建议在 A5.1 优先实现 G2（CombatCapability 评估），为后续编队协调和撤退判定奠定基础。