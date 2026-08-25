# A6.0 — Prediction Architecture

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、帝国应该预测什么

### 1.1 当前系统的局限

当前系统是**反应式**的：
- 威胁出现 → posture 切换到 fortify（反应）
- 经济恶化 → recovery action（反应）
- CPU 不足 → 降级（反应）

**不能**：
- 预测 "未来 2000 tick 内玩家 X 可能进攻" → 提前部署防御
- 预测 "能量储备按当前消耗速率 500 tick 后耗尽" → 提前调整经济
- 预测 "CPU 趋势在 1000 tick 后进入 Guarded" → 提前降频

### 1.2 候选预测目标

| # | 预测目标 | 价值 | 数据基础 | 难度 | 第一阶段 |
|---|---------|------|---------|------|---------|
| 1 | Energy shortage（能量短缺） | ⭐⭐⭐⭐⭐ | economy flow + reserve 历史 | 低 | ✅ |
| 2 | Spawn starvation（孵化饥饿） | ⭐⭐⭐⭐⭐ | spawn queue + population | 低 | ✅ |
| 3 | Logistics bottleneck（物流瓶颈） | ⭐⭐⭐⭐ | logisticsHealth + starvation | 中 | ✅ |
| 4 | Room collapse（房间崩溃） | ⭐⭐⭐⭐ | colonyState + health | 中 | ✅ |
| 5 | Hostile arrival（敌方到达） | ⭐⭐⭐⭐⭐ | PlayerIntel + 侦察 | 高 | ❌ 第二阶段 |
| 6 | Remote mining failure（远矿失败） | ⭐⭐⭐ | remote defense + ROI | 中 | ✅ |
| 7 | Expansion readiness（扩张准备） | ⭐⭐⭐ | expansion readiness eval | 低 | ✅ |
| 8 | Resource imbalance（资源失衡） | ⭐⭐⭐ | empire ledger | 中 | ❌ 第二阶段 |
| 9 | CPU pressure（CPU 压力） | ⭐⭐⭐⭐ | CPU tier + bucket trend | 低 | ✅ |
| 10 | War escalation（战争升级） | ⭐⭐⭐ | threat + posture | 高 | ❌ 第二阶段 |
| 11 | Enemy behavior（敌方行为） | ⭐⭐⭐ | Player Memory | 高 | ❌ 第二阶段 |
| 12 | Recovery probability（恢复概率） | ⭐⭐⭐ | recovery stats | 中 | ❌ 第二阶段 |

---

## 二、Prediction 数据结构

### 2.1 核心模型

```typescript
interface Prediction {
  /** 预测 ID */
  id: string;
  /** 生成 tick */
  generatedAt: number;
  /** 预测目标 */
  target: PredictionTarget;
  /** 预测时间窗口 */
  window: {
    startTick: number;       // 预测起始 tick
    endTick: number;         // 预测结束 tick
    duration: number;        // 持续 tick 数
  };
  /** 预测值 */
  value: number;             // 量化值
  /** 置信度 0-1 */
  confidence: number;
  /** 预测方法 */
  method: PredictionMethod;
  /** 支撑数据（Pattern IDs / Experience IDs） */
  evidence: string[];
  /** 模型版本 */
  modelVersion: number;
  /** 状态 */
  status: "active" | "fulfilled" | "expired" | "invalidated";
}

type PredictionTarget =
  | "energy-shortage"
  | "spawn-starvation"
  | "logistics-bottleneck"
  | "room-collapse"
  | "hostile-arrival"
  | "remote-mining-failure"
  | "expansion-readiness"
  | "resource-imbalance"
  | "cpu-pressure"
  | "war-escalation"
  | "enemy-behavior"
  | "recovery-probability";

type PredictionMethod =
  | "trend-extrapolation"    // 趋势外推
  | "pattern-matching"       // 模式匹配
  | "threshold-projection"   // 阈值投影
  | "statistical-inference"  // 统计推断
  | "bayesian-update";       // 贝叶斯更新
```

### 2.2 Prediction vs Decision

**严格区分**：

```
Prediction 只提供: Prediction + Confidence
Decision 由 A5 系统做: Strategy / Planner / RolePolicy

Prediction 不能:
  → 直接执行动作
  → 修改 Strategy
  → 调用 Game API

Prediction 可以:
  → 被 Recommendation Engine 消费
  → 产出 Recommendation
  → 经 Validation Gate 影响参数
```

---

## 三、第一阶段预测方法

### 3.1 Energy Shortage Prediction

```
方法: 趋势外推 (trend-extrapolation)

输入:
  - empireHealth.energyScore 时间序列 (heap, 100 个采样点)
  - empireEconomy.netFlow (当前净流)
  - empireEconomy.totalReserve (当前储备)

算法:
  1. 对 energyScore 时间序列做线性回归
  2. 计算斜率 slope (score/tick)
  3. 如果 slope < 0:
     - 预测到达 "deficit" 级别的 tick 数
     - eta = (currentScore - deficitThreshold) / |slope|
  4. 置信度 = f(回归 R², 样本数)

输出:
  Prediction {
    target: "energy-shortage"
    value: eta  // 预计 N tick 后进入 deficit
    confidence: R² × min(1, samples/30)
    method: "trend-extrapolation"
  }
```

### 3.2 Spawn Starvation Prediction

```
方法: 阈值投影 (threshold-projection)

输入:
  - spawn queue 长度时间序列
  - population history
  - 当前 P0 请求数

算法:
  1. 计算近期 spawn queue 增长率
  2. 如果 queue 增长率 > 0:
     - 预测 queue 溢出的 tick 数
  3. 计算 population 趋势
  4. 如果 population 下降:
     - 预测到达 critical 人口水平的 tick 数

输出:
  Prediction {
    target: "spawn-starvation"
    value: eta
    confidence: 基于趋势稳定性
    method: "threshold-projection"
  }
```

### 3.3 CPU Pressure Prediction

```
方法: 趋势外推 (trend-extrapolation)

输入:
  - CPU tier 历史 (empire-health-system 的 cpuHealth 维度)
  - Game.cpu.bucket 趋势
  - creep 数量趋势

算法:
  1. 对 bucket 做线性回归
  2. 如果 bucket 下降趋势:
     - 预测到达 Guarded/Conserve/Recovery 的 tick 数
  3. 计算 creep 数量增长对 CPU 的影响

输出:
  Prediction {
    target: "cpu-pressure"
    value: predictedTier
    confidence: R² × min(1, samples/20)
    method: "trend-extrapolation"
  }
```

### 3.4 Logistics Bottleneck Prediction

```
方法: 统计推断 (statistical-inference)

输入:
  - logisticsHealth 时间序列
  - starvation detection 历史
  - hauler population 趋势

算法:
  1. 统计 starvation 发生频率
  2. 如果频率上升:
     - 预测下一次 starvation 的 tick 范围
  3. 计算 hauler gap 趋势
  4. 如果 gap 扩大:
     - 预测 gap 达到 critical 的 tick 数

输出:
  Prediction {
    target: "logistics-bottleneck"
    value: eta
    confidence: 基于频率稳定性
    method: "statistical-inference"
  }
```

### 3.5 Room Collapse Prediction

```
方法: 多信号聚合 (threshold-projection + statistical-inference)

输入:
  - colonyState 历史
  - room health 维度
  - threat assessment
  - structure count 趋势

算法:
  1. 如果 colonyState == "recovery":
     - 计算恢复持续时间
     - 如果超过历史平均恢复时间 × 1.5:
       - 预测房间可能崩溃
  2. 如果 threat 持续 HIGH 且防御减弱:
     - 预测防御突破的 tick 数
  3. 如果关键结构（spawn/tower）被毁:
     - 预测 cascade failure

输出:
  Prediction {
    target: "room-collapse"
    value: collapseProbability
    confidence: 基于信号一致性
    method: "threshold-projection"
  }
```

---

## 四、第二阶段预测（需 Player Intelligence 先完成）

### 4.1 Hostile Arrival Prediction

```
方法: 模式匹配 + 贝叶斯更新

输入:
  - Player Memory: 玩家活跃时段、进攻历史
  - Intel: 玩家房间距离、军力
  - 当前态势: threat level

算法:
  1. 从 Player Memory 读取玩家活跃时段
  2. 计算距离 × 军力 × 活跃度 = 进攻概率
  3. 贝叶斯更新: 有新观察时更新先验
  4. 输出: 未来 N tick 内进攻概率 + 置信度

注意: 需要 Player Intelligence 先完成
```

---

## 五、Prediction Layer 的安全约束

### 5.1 Prediction 只读

| 约束 | 理由 |
|------|------|
| Prediction 不执行任何 Game API | 安全边界 |
| Prediction 不修改 Strategy | 只提供信息 |
| Prediction 不修改 Memory Runtime State | 只写 segment |
| Prediction 不进入 tick 关键路径 | interval ≥ 500 |
| Recovery 档下 Prediction 全停 | CPU 优先给生存 |

### 5.2 Prediction 确定性

```
同一 Experience 输入 + 同一 Pattern 输入 + 同一模型版本 + 同一参数
→ 同一 Prediction
```

**禁止**：
- `Math.random()` — 使用确定性 hash
- `Date.now()` — 使用 `Game.time`
- 浮点误差 — 使用 `toFixed(3)`
- 无序迭代 — 使用排序后数组

### 5.3 Prediction 失效处理

| 场景 | 处理 |
|------|------|
| 预测未应验 | 标记为 `expired`，降低该方法/参数的置信度 |
| 预测应验 | 标记为 `fulfilled`，提高置信度 |
| 新数据推翻预测 | 标记为 `invalidated`，重新生成 |
| 数据不足 | `confidence = 0`，不产出 Prediction |

---

## 六、Prediction 的使用

### 6.1 Prediction → Recommendation

```
Prediction (energy-shortage, eta=500t, confidence=0.8)
  ↓
Recommendation Engine
  ↓
"建议: 在 economy 中降低 upgrader.maxCount 以减少能量消耗。
 理由: 预测 500 tick后能量短缺(置信度0.8)"
  ↓
Validation Gate
  ↓
tuning 覆盖层 (upgrader.maxCount 参数调整)
```

### 6.2 Prediction 不直接触发动作

**禁止**：
- `if prediction.target == "energy-shortage" then reduce upgrader`
- 直接从 Prediction 到参数修改

**允许**：
- Prediction 作为 Recommendation Engine 的输入
- Recommendation Engine 综合 Prediction + StrategyScore + Pattern 产出建议
- 建议经 Validation Gate 后影响参数

---

## 七、关键结论

1. **第一阶段做 7 个预测目标**（能量/孵化/物流/房间/远矿/扩张/CPU）
2. **第二阶段做 5 个预测目标**（敌方/资源/战争/敌人/恢复）— 需 Player Intelligence
3. **Prediction 只提供 Prediction + Confidence**，不做决策
4. **使用轻量方法**（趋势外推/阈值投影/统计推断），不用 ML
5. **Prediction 确定性**：同输入+同模型+同参数→同输出
6. **Prediction 失效处理**：应验→提高置信，未应验→降低置信
7. **Prediction 通过 Recommendation Engine 影响策略**，不直接影响
8. **Recovery 档下 Prediction 全停**
