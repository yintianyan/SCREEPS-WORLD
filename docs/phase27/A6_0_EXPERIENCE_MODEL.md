# A6.0 — Experience Model & Outcome Attribution

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、Experience 是 A6 的核心

### 1.1 什么是 Experience

```
DecisionTrace 记录: "为什么做这个决策"（Why）
Experience 记录:    "做完后发生了什么"（What happened）+ "结果应该归因给谁"（Attribution）
```

Experience = Decision + Outcome + Attribution

### 1.2 与 DecisionTrace 的严格区分

| 维度 | DecisionTrace (A4.7) | Experience (A6) |
|------|---------------------|-----------------|
| 回答的问题 | 为什么做这个决策？ | 做完后发生了什么？ |
| 记录时机 | 决策时（事前/事中） | 决策结果已知后（事后） |
| 数据来源 | Snapshot + reasons + evidence | DecisionRecord + 世界状态变化 |
| 时间性 | 记录决策那一刻的状态 | 记录决策后 N tick 的结果 |
| 用途 | 审计、Replay | 学习、评估、模式提取 |
| 存储 | heap Ring Buffer (1000条) | segment (长期) |
| 关系 | Experience 引用 DecisionRecord.decisionId | Experience 不修改 DecisionRecord |

**关键原则**：
- DecisionTrace 是 "为什么做"
- Experience 是 "做完以后发生了什么"
- 二者必须严格区分，不混为一个记录
- Experience **引用** DecisionRecord（通过 decisionId），不**复制** DecisionRecord

---

## 二、Experience 数据结构

### 2.1 候选结构（研究性，不直接采用）

```typescript
interface Experience {
  id: string;
  tick: number;
  context: ExperienceContext;
  stateBefore: StateSummary;
  decision: DecisionSummary;
  action: ActionSummary;
  expectedOutcome: ExpectedOutcome;
  actualOutcome: ActualOutcome;
  delta: OutcomeDelta;
  reward: RewardValue;
  confidence: number;
  attribution: Attribution;
}
```

### 2.2 为什么不直接采用这个结构

问题：

1. **`stateBefore` 太大**：完整状态快照太大，不能存 segment。需要用 hash 代替。
2. **`expectedOutcome` 来源不明**：DecisionRecord 已有 `expectedOutcome` 字段（字符串），但不是量化值。
3. **`actualOutcome` 延迟未知**：决策后多少 tick 才能知道结果？war 可能 1000+ tick，经济可能 500+ tick。
4. **`reward` 难以定义**：一场 war 的 reward 是什么？胜负？经济消耗？CPU 消耗？
5. **`attribution` 最难**：收益应该归因给谁？

### 2.3 修正后的结构

```typescript
interface ExperienceRecord {
  // ── 标识 ──
  id: string;                    // 格式: E-{tick}-{seq}
  tick: number;                  // Experience 记录 tick（不是决策 tick）
  type: ExperienceType;          // 经验类型

  // ── 关联 ──
  decisionId: string;            // 关联的 DecisionRecord ID (A4.7)
  decisionTick: number;          // 决策发生 tick
  eventIds: number[];            // 关联的 EventLog 事件

  // ── 决策摘要（不存完整 DecisionRecord）──
  decisionSummary: {
    category: DecisionCategory;  // ECONOMY / MILITARY / ...
    actor: string;               // 决策者
    selectedAction: string;      // 选中动作
    decisionHash: string;        // 决策 hash（可 Replay）
  };

  // ── 结果 ──
  outcome: {
    status: "success" | "failure" | "unknown" | "partial";
    metric: string;              // 结果量化指标名
    value: number;               // 量化值
    measurementDelay: number;    // 决策到结果测量的 tick 数
  };

  // ── 归因 ──
  attribution: {
    primaryFactor: string;       // 主要归因因素
    secondaryFactors: string[];  // 次要因素
    confidence: number;          // 归因置信度 0-1
    method: AttributionMethod;   // 归因方法
  };

  // ── 状态快照 hash（不存完整状态）──
  stateBeforeHash: string;       // 决策前状态 hash
  stateAfterHash: string;        // 结果测量时状态 hash

  // ── 元数据 ──
  modelVersion: number;          // 产出此 Experience 的模型版本
  createdAt: number;             // 记录创建 tick
}

type ExperienceType =
  | "war"          // 战争经验
  | "expansion"    // 扩张经验
  | "economic"     // 经济决策经验
  | "defense"      // 防御经验
  | "logistics"    // 物流经验
  | "spawn";       // 孵化经验

type AttributionMethod =
  | "direct"       // 直接归因（单因单果）
  | "correlation"  // 相关性归因（统计相关）
  | "counterfactual" // 反事实归因（如果不做会怎样）
  | "expert";      // 专家规则归因（CONFIG 规则）
```

---

## 三、Decision → Outcome Attribution

### 3.1 已有基础

当前系统已有的 Decision → Outcome 链路：

| 已有系统 | 产出的 Outcome | 状态 |
|---------|---------------|------|
| `evaluateWarOutcome()` | war 胜负 (success/failure/unknown) | ✅ 已有 |
| `empire-health-system` | 健康度变化 (level + score) | ✅ 已有 |
| `recovery-lifecycle` | Recovery 成功/失败 | ✅ 已有 |
| `tuning-engine` | 参数调整效果 (improved/worsened) | ✅ 已有 |
| EventLog (EventKind) | 离散事件（CreepDeath, TowerVolley, ...） | ✅ 已有 |

**A6 不重新建立第二套 Outcome 评估，而是消费已有系统的产出。**

### 3.2 DecisionRecord + OutcomeRecord + ExperienceRecord

三者的关系：

```
DecisionRecord (A4.7, 事中)
  │
  │ N tick 后
  ▼
OutcomeRecord (A6, 事后)
  │  ── 对比 decisionTick 的状态和当前状态
  │  ── 消费 evaluateWarOutcome / empireHealth / recoveryStats
  │  ── 产出量化结果
  ▼
ExperienceRecord (A6, 事后)
  │  ── 合并 DecisionRecord 摘要 + OutcomeRecord
  │  ── 添加 Attribution
  │  ── 写入 Episodic Memory (segment)
  ▼
Pattern Detection (A6, 低频)
  │  ── 从多个 ExperienceRecord 提取统计规律
  ▼
KnowledgeEntry (Semantic Memory)
```

### 3.3 OutcomeRecord 设计

```typescript
interface OutcomeRecord {
  /** 关联的 DecisionRecord ID */
  decisionId: string;
  /** 决策发生 tick */
  decisionTick: number;
  /** 结果测量 tick */
  measurementTick: number;
  /** 测量延迟 */
  delay: number;  // measurementTick - decisionTick

  // ── 结果量化 ──
  status: "success" | "failure" | "unknown" | "partial";
  /** 结果指标（如 "warOutcome", "healthDelta", "energyDelta"） */
  metric: string;
  /** 量化值 */
  value: number;
  /** 结果数据来源 */
  source: "evaluateWarOutcome" | "empireHealth" | "recoveryStats" | "eventLog" | "stateDiff";

  // ── 状态变化 ──
  stateBeforeHash: string;
  stateAfterHash: string;
  /** 关键状态 delta */
  stateDelta: StateDelta;
}

interface StateDelta {
  /** 能量变化 */
  energyDelta?: number;
  /** 人口变化 */
  populationDelta?: number;
  /** 健康度变化 */
  healthDelta?: number;
  /** 威胁变化 */
  threatDelta?: number;
  /** CPU 变化 */
  cpuDelta?: number;
}
```

---

## 四、Attribution 问题

### 4.1 归因难题：Spawn 10 个 worker → 500 tick 后经济增长

```
Spawn 10 worker
→ 500 tick 后经济增长
```

这个收益到底应该归因给：

| 候选 | 为什么 | 归因难度 |
|------|--------|---------|
| Spawn？ | 是 Spawn 决定孵化 worker | 低 |
| Layout？ | 布局决定了 worker 的采集效率 | 高 |
| Logistics？ | hauler 把能量运到了正确位置 | 高 |
| Source？ | source 的产能上限 | 中 |
| Hauler？ | hauler 数量足够 | 高 |
| Room Strategy？ | 房间策略选择了经济优先 | 高 |

**问题**：多系统耦合，无法单独归因。

### 4.2 归因方法对比

| 方法 | 描述 | 适用场景 | Screeps 适合度 |
|------|------|---------|---------------|
| **Direct（直接归因）** | 单因单果，A → B | War 胜负 → WarPlan | ⭐⭐⭐⭐⭐ |
| **Correlation（相关性）** | 统计 A 和 B 同时出现 | 编队配置与胜率 | ⭐⭐⭐⭐ |
| **Counterfactual（反事实）** | "如果当时不做 A 会怎样" | 策略效果评估 | ⭐⭐⭐（需 Simulation） |
| **Expert（专家规则）** | CONFIG 规则定义归因 | 经济归因 | ⭐⭐⭐ |

### 4.3 第一阶段归因策略

**只做 Direct + Correlation 归因，不做 Counterfactual。**

| Experience 类型 | 归因方法 | 归因对象 | 置信度 |
|----------------|---------|---------|--------|
| War | Direct | WarPlan (编队 + 战术) | 高（0.8+） |
| Expansion | Direct | ExpansionPlan (选址 + 时机) | 中（0.6+） |
| Defense | Correlation | 威胁评估 + 塔布局 | 中（0.5+） |
| Economic | Expert | CONFIG 规则（spawn 数 → 产能） | 低（0.3+） |
| Logistics | Correlation | TransportPlan + hauler 数 | 中（0.5+） |
| Spawn | Direct | spawn queue 决策 | 高（0.7+） |

### 4.4 延迟 Reward 问题

**问题**：决策后多少 tick 才能测量结果？

| Experience 类型 | 典型延迟 | 最大延迟 | 测量方法 |
|----------------|---------|---------|---------|
| War | 500-2000 tick | 5000 tick | war demobilize 时 evaluateWarOutcome |
| Expansion | 1000-5000 tick | 10000 tick | colonyState 从 bootstrap → steady |
| Economic | 500-1000 tick | 2000 tick | empireHealth score delta |
| Defense | 100-500 tick | 1000 tick | threatLevel 回归 + 结构完好 |
| Logistics | 100-500 tick | 1000 tick | starvation 消除 + deficit 消除 |
| Spawn | 150-300 tick | 500 tick | creep 存活 + 产能贡献 |

**策略**：
- 每种 Experience 类型有固定的 `measurementDelay`
- 到期时从 DecisionTrace Ring Buffer 中找到对应 DecisionRecord
- 对比决策前后的状态变化
- 如果决策已过期（DecisionRecord 已被 GC），标记为 `unknown`

### 4.5 归因置信度计算

```typescript
function computeAttributionConfidence(
  samples: number,       // 同类 Experience 的样本数
  variance: number,      // 结果方差
  measurementDelay: number, // 测量延迟
): number {
  // 样本越多 → 置信度越高
  const sampleFactor = Math.min(1, samples / 10);
  // 方差越低 → 置信度越高
  const varianceFactor = 1 - Math.min(1, variance / 100);
  // 延迟越长 → 置信度越低（中间发生太多事）
  const delayFactor = Math.max(0.3, 1 - measurementDelay / 5000);

  return Number((sampleFactor * varianceFactor * delayFactor).toFixed(3));
}
```

---

## 五、Experience 采集流程

### 5.1 从 DecisionTrace 到 Experience

```
1. DecisionTrace System (interval=100) 产出 DecisionRecord
   → 写入 Ring Buffer (heap)

2. Experience Collector (interval=100, 事件驱动)
   → 扫描 Ring Buffer 中到期的 DecisionRecord
   → 对每个到期的 DecisionRecord，采集 OutcomeRecord
   → 合并为 ExperienceRecord
   → 写入 Episodic Memory (segment)

3. Pattern Detector (interval=500)
   → 从 Episodic Memory 读取 ExperienceRecord[]
   → 提取统计规律
   → 写入 Semantic Memory (segment)
```

### 5.2 到期判定

```typescript
function isDecisionReadyForOutcome(
  record: DecisionRecord,
  currentTick: number,
): boolean {
  const delay = getMeasurementDelay(record.category);
  return currentTick - record.tick >= delay;
}
```

### 5.3 Outcome 采集

```typescript
function collectOutcome(
  record: DecisionRecord,
  currentTick: number,
): OutcomeRecord | null {
  switch (record.category) {
    case "MILITARY":
      // 消费 evaluateWarOutcome（已有）
      return collectWarOutcome(record, currentTick);
    case "RECOVERY":
      // 消费 recoveryStats（已有）
      return collectRecoveryOutcome(record, currentTick);
    case "ECONOMY":
      // 消费 empireHealth delta（已有）
      return collectEconomicOutcome(record, currentTick);
    case "SPAWN":
      // 消费 creep 存活 + 产能（已有）
      return collectSpawnOutcome(record, currentTick);
    default:
      return null;
  }
}
```

---

## 六、Experience 类型详细设计

### 6.1 War Experience

```typescript
interface WarExperience extends ExperienceRecord {
  type: "war";

  // ── War 专用字段 ──
  warDetails: {
    targetRoom: string;
    opponent: string;
    ourComposition: { role: string; count: number; boosted: boolean }[];
    enemyComposition: { role: string; count: number; boosted: boolean }[];
    tacticalTransitions: string[];
    ourLosses: number;
    enemyLosses: number;
    cpuCost: number;
    duration: number;          // war 持续 tick 数
  };

  // ── 归因（Direct 方法）──
  attribution: {
    primaryFactor: "forceComposition" | "tacticalDecision" | "intel" | "economicGuard" | "external";
    confidence: number;        // 0.8+（war 归因相对可靠）
    method: "direct";
  };
}
```

**War 归因规则**：

| 结果 | 主要归因 | 置信度 |
|------|---------|--------|
| 胜 + 损失 < 30% | forceComposition 有效 | 0.9 |
| 胜 + 损失 > 50% | forceComposition 勉强 | 0.7 |
| 负 + 敌方 boosted | intel 不足（未预判 boost） | 0.8 |
| 负 + 经济不支 | economicGuard 失败 | 0.8 |
| unknown | intel 过期 | 0.5 |

### 6.2 Expansion Experience

```typescript
interface ExpansionExperience extends ExperienceRecord {
  type: "expansion";

  expansionDetails: {
    targetRoom: string;
    phase: "claim" | "pioneer";
    duration: number;
    finalColonyState: string;
    rclAchieved: number;
  };

  attribution: {
    primaryFactor: "location" | "timing" | "defense" | "economic" | "external";
    confidence: number;        // 0.6+（扩张归因中等可靠）
    method: "direct";
  };
}
```

### 6.3 Economic Experience

```typescript
interface EconomicExperience extends ExperienceRecord {
  type: "economic";

  economicDetails: {
    healthBefore: string;     // empire health level
    healthAfter: string;
    healthScoreDelta: number;
    energyDelta: number;
    populationDelta: number;
  };

  attribution: {
    primaryFactor: string;    // 低置信度（多系统耦合）
    confidence: number;       // 0.3-0.5（经济归因困难）
    method: "expert";         // CONFIG 规则归因
  };
}
```

---

## 七、关键结论

1. **Experience = Decision + Outcome + Attribution**，三者缺一不可
2. **DecisionTrace 和 Experience 严格区分**：前者 "为什么做"，后者 "做完后发生了什么"
3. **不建立第二套 DecisionTrace**，Experience 引用 DecisionRecord.decisionId
4. **不建立第二套 Outcome 评估**，消费已有系统（evaluateWarOutcome / empireHealth / recoveryStats）
5. **第一阶段只做 Direct + Correlation 归因**，不做 Counterfactual
6. **War Experience 最有价值且归因最可靠**，应作为第一优先
7. **Economic Attribution 最难**，第一阶段用 Expert 规则归因，低置信度
8. **延迟 Reward 是核心挑战**，每种 Experience 类型有固定 measurementDelay
9. **归因置信度基于样本数 + 方差 + 延迟**计算
