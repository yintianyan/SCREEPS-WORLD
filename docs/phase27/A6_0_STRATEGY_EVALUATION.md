# A6.0 — Strategy Evaluation Framework

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、当前系统能选择 Strategy，但不能评估 Strategy

### 1.1 现状

当前系统的 Strategy 选择是反应式的：

```
posture.ts: evaluateEmpirePosture()
  → 输入: RoomStrategyInput[], bucket, gcl, prev
  → 输出: posture (develop/expand/fortify/war)
  → 依据: 威胁窗口 + 经济健康 + CPU 预算
```

这个决策是**基于当前状态的反应**，不基于历史效果。

### 1.2 缺失

| 缺失 | 后果 |
|------|------|
| 不知道 "develop 姿态持续 5000 tick 后经济是否改善" | 无法判断 develop 是否有效 |
| 不知道 "扩张到 W1N1 是否比扩张到 W2N2 更好" | 无法优化扩张选址 |
| 不知道 "编队 A vs 编队 B 的胜率差异" | 无法优化编队选择 |
| 不知道 "防御布局 X 是否有效降低了损失" | 无法优化防御策略 |

---

## 二、Strategy Evaluation 框架

### 2.1 多维评价（禁止万能分数）

**绝对禁止**：`if score > X then strategy good`

这种过度简化会掩盖策略在某一维度的严重缺陷。一个经济得分 90 但防御得分 20 的策略不应被判定为 "好"。

### 2.2 评价维度

| 维度 | 定义 | 量化方法 | 数据来源 |
|------|------|---------|---------|
| **Economic Growth** | 经济增长率 | empireHealth.energyScore delta | empire-health-system |
| **Resource Efficiency** | 资源利用效率 | 产能/消耗比 | economy.ts flow-accounting |
| **CPU Efficiency** | CPU 消耗效率 | CPU/产出比 | CPU tier + telemetry |
| **Risk Level** | 风险水平 | 威胁指数 + 暴露面 | threat-assessment |
| **Survival** | 生存能力 | 帝国健康度 + 恢复能力 | empire-health + recoveryStats |
| **Expansion** | 扩张效果 | 新房存活率 + RCL 增速 | expansion-outcome events |
| **Military Outcome** | 军事结果 | 胜率 + 损失比 | evaluateWarOutcome |
| **Recovery Cost** | 恢复代价 | 恢复时间 + 资源消耗 | recovery-lifecycle |
| **Opportunity Cost** | 机会成本 | 未做某事的损失估计 | counterfactual（后期） |

### 2.3 StrategyScore 设计

```typescript
interface StrategyScore {
  /** 评估的 Strategy 类型 */
  strategyType: StrategyType;
  /** 评估时间窗口 */
  window: { from: number; to: number };  // tick range
  /** 样本数 */
  samples: number;

  // ── 多维评分（每维独立，不合并为总分）──
  dimensions: {
    economicGrowth: DimensionScore;
    resourceEfficiency: DimensionScore;
    cpuEfficiency: DimensionScore;
    riskLevel: DimensionScore;
    survival: DimensionScore;
    expansion: DimensionScore;
    militaryOutcome: DimensionScore;
    recoveryCost: DimensionScore;
    opportunityCost?: DimensionScore;  // 后期才评估
  };

  // ── 元数据 ──
  evaluatedAt: number;
  modelVersion: number;
  confidence: number;
}

interface DimensionScore {
  /** 分数 0-1 */
  score: number;
  /** 量化指标 */
  metric: string;
  /** 指标值 */
  value: number;
  /** 基准值（CONFIG 默认或历史均值） */
  baseline: number;
  /** 与基准的偏差 */
  delta: number;
  /** 样本数 */
  samples: number;
  /** 置信度 */
  confidence: number;
}

type StrategyType =
  | "empire-posture"     // 帝国姿态
  | "economic"           // 经济策略
  | "expansion"          // 扩张策略
  | "military"           // 军事策略
  | "defense"            // 防御策略
  | "logistics"          // 物流策略
  | "spawn"              // 孵化策略
  | "room"               // 房间策略
  | "market";            // 市场策略
```

### 2.4 评价频率

| 策略类型 | 评估频率 | 理由 |
|---------|---------|------|
| empire-posture | 每 1000 tick | posture 切换频率低，1000 tick 足够积累数据 |
| economic | 每 500 tick | 经济变化较快 |
| expansion | 每 2000 tick | 扩张是低频事件 |
| military | 每次 war 结束 | 事件驱动 |
| defense | 每 1000 tick | 防御效果需要时间体现 |
| logistics | 每 500 tick | 物流效果较快体现 |
| spawn | 每 500 tick | 孵化效果中等速度 |
| room | 每 1000 tick | 房间发展慢 |
| market | 每 1000 tick | 市场操作低频 |

---

## 三、各策略类型的评估方法

### 3.1 Economic Strategy Evaluation

```
输入: empireHealth.energyScore 时间序列 + economy flow-accounting
输出: EconomicStrategyScore

评估逻辑:
  1. 计算评估窗口内的经济增速（energyScore 线性回归斜率）
  2. 计算资源效率（产能/消耗比 = production/consumption）
  3. 计算 CPU 效率（CPU per energy produced）
  4. 对比 CONFIG 基准值
  5. 计算各维度 delta
```

### 3.2 Expansion Strategy Evaluation

```
输入: ExpansionOutcome events (EventKind.ExpansionOutcome)
输出: ExpansionStrategyScore

评估逻辑:
  1. 统计评估窗口内的扩张尝试数
  2. 统计成功率（success / total）
  3. 统计平均存活时间（colonyState 从 bootstrap 到 steady 的 tick 数）
  4. 统计平均 RCL 增速
  5. 对比历史均值
```

### 3.3 Military Strategy Evaluation

```
输入: WarOutcome events + DecisionTrace MILITARY records
输出: MilitaryStrategyScore

评估逻辑:
  1. 统计评估窗口内的战争次数
  2. 统计胜率（success / total）
  3. 统计平均损失比（ourLosses / enemyLosses）
  4. 统计平均战争持续时间
  5. 统计 CPU 消耗
  6. 按编队配置分组统计胜率
  7. 对比历史均值
```

### 3.4 Defense Strategy Evaluation

```
输入: threat-assessment 历史 + StructureDestroyed events + TowerVolley events
输出: DefenseStrategyScore

评估逻辑:
  1. 统计评估窗口内的入侵次数
  2. 统计防御成功率（入侵被击退 / 总入侵）
  3. 统计结构损失（StructureDestroyed events 计数）
  4. 统计塔效率（TowerVolley fired / kill）
  5. 统计威胁响应延迟（threat detected → defense activated）
  6. 对比历史均值
```

### 3.5 Logistics Strategy Evaluation

```
输入: logisticsHealth + starvation detection + transport plan stats
输出: LogisticsStrategyScore

评估逻辑:
  1. 统计评估窗口内的饥饿事件数（starvation detected）
  2. 统计运输成功率（delivered / requested）
  3. 统计平均运输延迟
  4. 统计运力利用率
  5. 对比历史均值
```

### 3.6 Spawn Strategy Evaluation

```
输入: spawn queue stats + creep death events + population history
输出: SpawnStrategyScore

评估逻辑:
  1. 统计评估窗口内的孵化成功率
  2. 统计孵化延迟（request → spawn）
  3. 统计 P0 恢复响应时间
  4. 统计人口稳定性（population variance）
  5. 统计 creep 非自然死亡率
  6. 对比历史均值
```

### 3.7 Empire Posture Evaluation

```
输入: posture 切换历史 + empireHealth 时间序列
输出: EmpirePostureScore

评估逻辑:
  1. 统计评估窗口内各姿态的持续时间占比
  2. 统计姿态切换频率（切换次数 / 时间）
  3. 评估姿态切换是否改善了健康度（切换后 N tick 的 healthScore delta）
  4. 评估是否过度反应（频繁切换 = thrashing，已有 detectThrashing）
  5. 评估是否反应不足（长期 degraded 无切换）
```

---

## 四、评价结果的使用

### 4.1 StrategyScore → Recommendation

Strategy Evaluation 不直接修改策略。它产出 StrategyScore，供 Recommendation Engine 消费：

```
StrategyScore
  ↓
Recommendation Engine
  ↓
"建议: 编队 B 在对抗 boosted healer 时胜率 80% vs 编队 A 40%。
       建议在 war-planning 中优先选择编队 B。"
  ↓
Validation Gate
  ↓
tuning 覆盖层 / posture 建议字段
```

### 4.2 评价结果不作为 Decision

**禁止**：
- `if strategyScore.dimensions.militaryOutcome.score > 0.7 then use strategy A`
- 直接从 StrategyScore 到 Decision

**允许**：
- StrategyScore 作为 Recommendation Engine 的输入之一
- Recommendation Engine 综合多个 StrategyScore + Pattern + Prediction 产出建议
- 建议经过 Validation Gate 后影响参数（不是直接影响决策）

---

## 五、基准值与对比

### 5.1 基准来源

| 基准类型 | 来源 | 用途 |
|---------|------|------|
| CONFIG 默认值 | `CONFIG` 常量 | 静态基准 |
| 历史均值 | Episodic Memory 中的历史数据 | 动态基准 |
| 社区经验 | 研究文档中的社区数据点 | sanity check |

### 5.2 对比方法

```typescript
function evaluateDimensionScore(
  values: number[],     // 评估窗口内的采样值
  baseline: number,     // 基准值
  metric: string,       // 指标名
): DimensionScore {
  const avg = emaAverage(values);
  const variance = computeVariance(values);
  const delta = avg - baseline;
  const score = clampScore((avg - baseline) / Math.max(1, Math.abs(baseline)));

  return {
    score: Number(score.toFixed(3)),
    metric,
    value: Number(avg.toFixed(3)),
    baseline,
    delta: Number(delta.toFixed(3)),
    samples: values.length,
    confidence: computeConfidence(values.length, variance),
  };
}
```

---

## 六、Strategy Evaluation 的安全约束

| 约束 | 理由 |
|------|------|
| 评估系统是只读的 | 不修改任何运行时状态 |
| 评估系统不产出 Decision | 只产出 StrategyScore |
| 评估系统走 safeRun | 连续失败 3 次进入冷却 |
| 评估系统在 Recovery 档全停 | CPU 优先给生存 |
| 评估系统不进 tick 关键路径 | interval ≥ 500 |
| 评估系统不写 Memory 主体 | 只写 segment + heap |
| 评估结果可被 Replay 验证 | 纯函数 + 确定性 hash |

---

## 七、关键结论

1. **禁止万能分数**，必须多维评价
2. **Strategy Evaluation 只产出 StrategyScore**，不直接修改策略
3. **消费已有系统的数据**，不建立第二套评估管道
4. **每种策略类型有固定的评估频率和维度**
5. **War Strategy Evaluation 最有价值**（数据完整、归因可靠）
6. **Empire Posture Evaluation 能检测 thrashing**（已有 detectThrashing 基础）
7. **基准值来自 CONFIG + 历史均值 + 社区经验**
8. **评估结果通过 Recommendation Engine 影响策略**，不直接影响
