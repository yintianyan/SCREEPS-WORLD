# A6.0 — Player Intelligence

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、Player Intelligence 应该记录什么

### 1.1 现有基础

当前系统已有的玩家情报（A5.2 IntelState）：

| 已有 | 位置 | 内容 |
|------|------|------|
| PlayerIntelRecord | `Memory.kernel.intel.players` | 威胁指数、攻击历史、黑名单、最后活动房 |
| ThreatAssessment | `domain/defense/threat-assessment.ts` | 当前威胁级别 + 意图推断 |
| CombatCapability | `domain/combat/capability.ts` | 每次交战时实时解析的敌方 body |

### 1.2 缺失

| 缺失 | 后果 |
|------|------|
| 不积累 per-player 历史 body 配置 | 不知道 "玩家 X 喜欢用 boosted attacker" |
| 不建模玩家行为模式 | 不知道 "玩家 X 喜欢在什么时间进攻" |
| 不记录战术偏好 | 不知道 "玩家 X 喜欢用 siege 还是 harassment" |
| 不估计经济能力 | 不知道 "玩家 X 有多少 RCL8 房间" |
| 不预测未来行为 | 无法预判威胁 |

### 1.3 Player Intelligence 应该记录什么

```
Player
 ├── identity（身份: username）
 ├── rooms（已知房间列表 + RCL）
 ├── observed composition（观测到的 body 配置历史）
 ├── military posture（军事姿态: 进攻型/防御型/中立）
 ├── expansion behavior（扩张行为: 频率/方向/成功率）
 ├── economic behavior（经济行为: 产能估计/市场行为）
 ├── historical encounters（历史交战记录）
 ├── confidence（数据置信度）
 └── behavior patterns（行为模式）
```

---

## 二、Fact / Inference / Prediction 严格区分

### 2.1 三层信息模型

```
FACT（直接观测）
  ↓ 推理
INFERENCE（推断）
  ↓ 预判
PREDICTION（预测）
```

**绝对禁止混淆**：

| 层级 | 定义 | 示例 | 可信度 |
|------|------|------|--------|
| **FACT** | 本源直接观测且在新鲜度窗内 | "玩家 X 拥有 3 个 RCL8 房间" | 高（观测时刻确定） |
| **INFERENCE** | 从 FACT 推导的结论 | "玩家 X 可能具备较强经济能力" | 中（推理可能有误） |
| **PREDICTION** | 对未来的预判 | "未来 2000 tick 内玩家 X 可能扩张" | 低（未来不确定） |

### 2.2 Fact / Inference / Prediction 示例

```
FACT:
  tick 12345 观测到玩家 X 的 attacker body = [TOUGH×5, ATTACK×15, MOVE×10, HEAL×5]
  tick 12346 观测到玩家 X 拥有 W1N1, W2N1, W3N1 三个房间（均 RCL8）
  tick 12347 观测到玩家 X 在 W1N1 建造了 nuker

INFERENCE:
  玩家 X 可能具备较强经济能力（3 个 RCL8 房间）
  玩家 X 可能具备核威慑能力（建造了 nuker）
  玩家 X 的 attacker 配置偏向 boosted melee（body 分析）

PREDICTION:
  未来 2000 tick 内玩家 X 可能进行扩张（基于扩张历史频率）
  如果与玩家 X 开战，可能面对 boosted melee attacker（基于 body 历史）
  玩家 X 可能在未来使用核弹（基于 nuker 存在）
```

### 2.3 信息流转规则

```
FACT → 存储（IntelState, 已有）
FACT → INFERENCE（A6 推理引擎）
INFERENCE → PREDICTION（A6 Prediction Layer）
PREDICTION → RECOMMENDATION（A6 Recommendation Engine）
RECOMMENDATION → Validation Gate → Strategy 参数
```

**禁止**：
- INFERENCE 冒充 FACT
- PREDICTION 冒充 FACT
- INFERENCE 直接驱动动作（只触发侦察任务或保守评分）
- PREDICTION 直接执行动作

---

## 三、PlayerProfile 数据结构

```typescript
interface PlayerProfile {
  // ── 身份 ──
  username: string;

  // ── FACT 层（来自直接观测）──
  facts: {
    /** 已知房间列表（来自 IntelState，只读） */
    knownRooms: string[];
    /** 最后观测到的 RCL（按房间） */
    roomRCLs: Record<string, number>;
    /** 观测到的 body 配置历史（限长 10） */
    bodyHistory: BodySnapshot[];
    /** 攻击历史记录 */
    attackHistory: AttackRecord[];
    /** 最后遭遇 tick */
    lastEncountered: number;
    /** 最后活动房间 */
    lastActiveRoom: string;
  };

  // ── INFERENCE 层（从 FACT 推导）──
  inferences: {
    /** 估计经济能力 */
    economicLevel: "weak" | "moderate" | "strong" | "unknown";
    /** 军事姿态 */
    militaryPosture: "aggressive" | "defensive" | "neutral" | "unknown";
    /** 偏好战术 */
    preferredTactics: string[];  // ["SIEGE", "HARASSMENT", ...]
    /** boost 使用倾向 */
    boostUsage: "none" | "occasional" | "frequent" | "unknown";
    /** 威胁等级（综合评估） */
    threatLevel: "low" | "medium" | "high" | "critical";
  };

  // ── PREDICTION 层（对未来预判）──
  predictions: {
    /** 未来进攻概率 */
    attackProbability: number;     // 0-1
    /** 预计进攻时间窗口 */
    attackWindow?: { start: number; end: number };  // tick range
    /** 预计进攻方向 */
    attackDirection?: string;      // 房间名或方向
    /** 扩张概率 */
    expansionProbability: number;  // 0-1
  };

  // ── 置信度 ──
  confidence: {
    factsConfidence: number;       // 基于新鲜度
    inferenceConfidence: number;   // 基于样本数
    predictionConfidence: number;  // 基于历史准确率
  };

  // ── 元数据 ──
  lastUpdated: number;
  modelVersion: number;
}

interface BodySnapshot {
  tick: number;
  /** body 摘要（角色 + 数量，不存完整 body） */
  composition: { part: string; count: number; boosted: boolean }[];
  /** 观测到的战术行为 */
  observedBehavior: string;
  /** 观测来源 */
  source: "combat" | "scout" | "observer" | "passive";
}

interface AttackRecord {
  tick: number;
  targetRoom: string;
  /** 我方损失 */
  ourLosses: number;
  /** 敌方损失 */
  enemyLosses: number;
  /** 结果 */
  outcome: "repelled" | "breached" | "unknown";
  /** 持续 tick 数 */
  duration: number;
}
```

---

## 四、Player Intelligence 的数据来源

### 4.1 被动观测（已有，零成本）

| 来源 | 数据 | 频率 |
|------|------|------|
| RoomSnapshot | 敌方 creep body | 每_tick（有视野时） |
| IntelEntry | 玩家房间信息 | 事件式 |
| EventLog | 攻击事件 | 事件式 |
| WarOutcome | 战争结果 | 事件式 |
| ThreatAssessment | 威胁评估 | 每 tick |

### 4.2 主动侦察（第二阶段）

| 来源 | 数据 | 风险 |
|------|------|------|
| Scout role | 玩家房间 RCL/防御/军力 | scout 被发现 → 暴露意图 |
| Observer | 远距离房间观测 | 需要 RCL8 |

**第一阶段只使用被动观测**。主动侦察在第二阶段引入（需要 scout 系统扩展）。

---

## 五、Combat Learning

### 5.1 A5 已负责什么

A5 已经负责：
- Threat 评估（`assessThreat()`）
- CombatCapability 解析（`evaluateCombatCapability()`）
- Formation 选择（`selectFormation()`）
- FocusFire 目标选择（`planFocusFire()`）
- Micro 仲裁（`arbitrateMicro()`）

**A6 不重新实现这些。**

### 5.2 Combat Learning 应该学习什么

#### 敌方学习：

| 学习目标 | 数据来源 | 用途 |
|---------|---------|------|
| 敌方 composition 偏好 | CombatCapability 解析历史 | 预判下次遇到的 body |
| 敌方 movement 模式 | TacticalSnapshot 历史 | 预判敌方移动路线 |
| 敌方 target selection | FocusFire 记录 | 预判敌方集火目标 |
| 敌方 retreat behavior | TacticalState 转换历史 | 预判敌方撤退时机 |
| 敌方 boost usage | body 解析 | 预判敌方 boost 等级 |
| 敌方 healer behavior | Micro 记录 | 预判 healer 跟随模式 |

#### 我方学习：

| 学习目标 | 数据来源 | 用途 |
|---------|---------|------|
| Formation effectiveness | War Experience | 优化编队选择 |
| Focus-fire effectiveness | FocusFire 记录 + kill time | 优化集火策略 |
| Retreat timing | TacticalState 转换 | 优化撤退时机 |
| Combat loss | CreepDeath events | 量化战损 |
| CPU cost | CPU telemetry | 优化 CPU 分配 |
| Healing efficiency | healer 行为记录 | 优化 healer 配置 |

### 5.3 Learning 应该改变什么

**只能改变**：
- Parameter Recommendation（参数建议）
  - "建议 hauler.maxCount 从 4 调到 5，因为物流瓶颈预测"
  - "建议 war 编队中 healer 比例从 1:2 调到 1:3，因为历史显示 healer 不足导致败北"
- Strategy Recommendation（策略建议）
  - "建议对玩家 X 使用防守反击策略，因为历史显示其进攻后防御薄弱"

**不能改变**：
- Tactical Decision（直接修改 `evaluateTacticalAction()` 的输出）
- FocusFire Target（直接修改 `planFocusFire()` 的输出）
- Micro Decision（直接修改 `arbitrateMicro()` 的输出）
- Spawn Request（直接提交 spawn 请求）
- Recovery Action（直接执行恢复）

### 5.4 Combat Learning 的数据流

```
War 发生
  ↓
A5 系统执行（Tactical / FocusFire / Micro / Role）
  ↓
A5 产出 DecisionTrace + EventLog + WarOutcome
  ↓
A6 Experience Collector（事后）
  → 采集 War Experience（编队 + 敌方配置 + 结果）
  ↓
A6 Pattern Detector（低频）
  → 从多个 War Experience 中提取统计规律
  → "编队 [2atk, 1heal] vs [boosted defender] 胜率 40%"
  → "编队 [3atk, 2heal] vs [boosted defender] 胜率 80%"
  ↓
A6 Recommendation Engine
  → "建议对 boosted defender 使用 [3atk, 2heal] 编队"
  ↓
Validation Gate
  → 通过 → 写入 war-planning 建议参数
  → 拒绝 → 记录拒绝原因
```

---

## 六、Player Intelligence 的安全约束

| 约束 | 理由 |
|------|------|
| 不直接触发军事/防御动作 | 开战权在 Strategic 层 |
| 不直接修改 Threat Assessment | 只提供信息给 Defense 消费 |
| 不冒充 FACT | 推断必须标 inferred |
| Player Memory 有 TTL | 防止过期信息误导 |
| 黑名单带冷却而非永久 | 防止 player-intel 诽谤 |
| 主动侦察有 PvP 暴露风险 | scout 被发现 → 被反侦察 |

---

## 七、关键结论

1. **Player Intelligence 不应该现在开始**（第一阶段），需要先建立 Experience Foundation
2. **第一阶段只做被动 Player Memory**（从已有 IntelState 扩展 body history）
3. **主动侦察在第二阶段**（需要 scout 系统扩展）
4. **Combat Learning 应该现在开始统计层面**（从 WarOutcome + DecisionTrace 提取）
5. **Combat Learning 不直接修改 Tactical Decision**，只产出 Parameter/Strategy Recommendation
6. **Fact / Inference / Prediction 严格区分**，不可混淆
7. **Learning 不改变 A5 的执行逻辑**，只改变 A5 的输入参数（通过 Validation Gate）
