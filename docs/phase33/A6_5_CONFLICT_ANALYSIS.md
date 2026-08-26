# A6.5 Conflict Analysis — 预测冲突分析

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做冲突分析研究，不修改任何代码

---

## 一、问题定义

### 1.1 场景

系统同时存在多个活跃预测：

```
EnergyShortage:     HIGH confidence (0.8) — 能量即将短缺
SpawnStarvation:    HIGH confidence (0.8) — 孵化即将饥饿
LogisticsBottleneck: HIGH confidence (0.8) — 物流即将瓶颈  (未实现)
ExpansionReadiness:  HIGH confidence (0.8) — 可以扩张        (未实现)
```

这些预测是否互相矛盾？

### 1.2 矛盾的类型

**类型 1: 逻辑矛盾**

- "Energy Shortage = HIGH" + "Expansion Readiness = HIGH"
- 含义: "能量即将短缺" + "可以扩张" → 矛盾（能量不足时不应扩张）

**类型 2: 因果矛盾**

- "Energy Shortage = HIGH" + "Logistics Bottleneck = HIGH"
- 含义: 能量短缺可能由物流瓶颈导致 → 不是矛盾而是因果关系

**类型 3: 无矛盾但互补**

- "Energy Shortage = HIGH" + "Spawn Starvation = HIGH"
- 含义: 能量短缺可能导致孵化饥饿 → 不是矛盾，是级联

---

## 二、Conflict Types

### 2.1 Prediction Conflict

**定义**: 两个活跃预测的逻辑含义互相矛盾。

**检测原则**: 定义逻辑规则映射，检查预测目标组合是否包含已知矛盾对。

**矛盾对定义**:

| 预测 A | 预测 B | 关系 | 检测条件 |
|--------|--------|------|---------|
| energy-shortage (HIGH) | expansion-readiness (HIGH) | 互斥 | 能量不足时不应扩张 |
| room-collapse (HIGH) | expansion-readiness (HIGH) | 互斥 | 房间要崩时不应扩张 |
| remote-mining-failure (HIGH) | expansion-readiness (HIGH) | 互斥 | 远矿失败时不应扩张 |
| cpu-pressure (HIGH) | expansion-readiness (HIGH) | 互斥 | CPU 紧张时不应扩张 |
| logistics-bottleneck (HIGH) | spawn-starvation (LOW) | 因果 | 物流瓶颈可能导致孵化饥饿——不是矛盾 |

**重要约束**:
- 只标记冲突，不裁决谁对谁错
- 不自动选择最高 confidence 的预测
- 保留冲突状态供 A6.6 Recommendation 消费

### 2.2 Model Conflict

**定义**: 同一模型在不同时间点对同一窗口产出不一致的预测。

**检测**: 检查同一 `target` 的多个 active prediction 是否在 `value` 上有显著差异。

**约束**: 不覆盖旧预测（A6.3 lifecycle 管理已处理），只标记不一致。

### 2.3 Evidence Conflict

**定义**: 两个预测的证据来源互相矛盾。

**检测**: 检查两个预测的 `evidence.sources` 是否引用了矛盾的数据。

**约束**: 当前 Evidence 只包含 source 引用（非值对比），难以自动检测。标记为 deferred。

### 2.4 Regime Conflict

**定义**: 预测的 `contextSignature` 与当前实际 Regime 不匹配。

**检测**: 比较预测的 `contextSignature` 与当前 `PredictionContext`。

**约束**: A6.4 已部分实现（`checkRegimeCompatibility()`）。A6.5 只需聚合。

---

## 三、Conflict Detection 设计

### 3.1 纯函数设计

```typescript
// 概念设计（非实现）

interface PredictionConflict {
  conflictId: string;
  type: "logical" | "temporal" | "evidence" | "regime";
  predictionIds: string[];  // 参与冲突的预测 ID
  description: string;
  severity: number;        // 0-1
  detectedAt: number;       // tick
  conflictHash: string;     // 确定性 hash
}

// 入口函数
function detectConflicts(
  predictions: readonly Prediction[],
  currentContext: PredictionContext,
): PredictionConflict[]
```

### 3.2 逻辑规则注册

```typescript
// 概念设计

interface ConflictRule {
  ruleId: string;
  targetA: PredictionTarget;
  targetB: PredictionTarget;
  conditionA: (p: Prediction) => boolean;
  conditionB: (p: Prediction) => boolean;
  severity: number;
  description: string;
}

// 注册的规则
const CONFLICT_RULES: ConflictRule[] = [
  {
    ruleId: "energy-vs-expansion",
    targetA: "energy-shortage",
    targetB: "expansion-readiness",
    conditionA: (p) => p.confidence > 0.5 && p.value > THRESHOLD,
    conditionB: (p) => p.confidence > 0.5 && p.value > THRESHOLD,
    severity: 0.8,
    description: "Energy shortage predicted but expansion readiness also high",
  },
  // ... 其他规则
];
```

### 3.3 约束

1. **Shadow-Only**: 只检测和标记，不解决冲突
2. **不自动选择**: 不按 confidence 选择"赢"的预测
3. **不隐藏冲突**: 冲突必须暴露在 IntelligenceState 中
4. **Bounded**: `PredictionConflict[]` 不持久化，每次运行时重新计算
5. **Deterministic**: 相同输入 → 相同 `conflictHash`

---

## 四、解决原则

### 4.1 A6.5 不解决冲突

**原则**: A6.5 是 Observer/Evaluator，不是 Arbiter。

冲突的解决属于 A6.6 Recommendation 或 Strategy 层的职责。

### 4.2 冲突如何被消费

```
A6.5 Conflict Detection
  → PredictionConflict[] 写入 IntelligenceState
  → A6.6 Recommendation 读取 IntelligenceState.predictionConflicts
  → A6.6 决定如何处理（降权、推迟、忽略、人供审查）
```

### 4.3 冲突严重度计算

```
severity = max(rule.severity × predictionA.confidence × predictionB.confidence)
```

- 两个高 confidence 的互斥预测 → severity 接近 1
- 一个高一个低 → severity 中等
- 两个低 → severity 低

---

## 五、场景分析

### 场景 1: Energy Shortage + Expansion Readiness

```
EnergyShortage:     confidence=0.8, value=5000 (储备将降至 5000)
ExpansionReadiness:  confidence=0.7, value=0.8 (扩张就绪度 0.8)
```

**检测**: logical conflict — 能量不足时不应扩张  
**severity**: 0.8 × 0.8 × 0.7 = 0.448  
**处理**: 标记冲突，不自动取消扩张

### 场景 2: Energy Shortage + Spawn Starvation

```
EnergyShortage:   confidence=0.8, value=5000
SpawnStarvation:  confidence=0.7, value=8 (队列深度 8)
```

**检测**: 无逻辑矛盾 — 能量短缺可能导致孵化饥饿（因果链）  
**处理**: 不标记冲突，但可以标记为 causal chain

### 场景 3: 多个模型同时高 confidence

```
EnergyShortage:        confidence=0.9
SpawnStarvation:       confidence=0.85
LogisticsBottleneck:   confidence=0.8
RoomCollapse:           confidence=0.75
```

**检测**: 不是互斥对，但是"全面恶化"信号  
**处理**: 不标记为 conflict，但在 IntelligenceState.uncertainty 中标注 high uncertainty

### 场景 4: 同一目标多个预测不一致

```
EnergyShortage (tick 1000): confidence=0.8, value=5000
EnergyShortage (tick 1500): confidence=0.6, value=2000
```

**检测**: temporal inconsistency — 同一目标的预测值波动大  
**处理**: 标记为 temporal conflict，severity 基于值差异

---

## 六、禁止行为

1. **禁止** 自动选择最高 confidence 的预测来"解决"冲突
2. **禁止** 将冲突信息用于修改 Strategy / Posture / Spawn
3. **禁止** 隐藏冲突（不上报 = 更危险）
4. **禁止** 建立第二套 Prediction 仲裁系统
5. **禁止** 因为检测到冲突就降低某个预测的 confidence（confidence 由模型管理，不由冲突检测器管理）
