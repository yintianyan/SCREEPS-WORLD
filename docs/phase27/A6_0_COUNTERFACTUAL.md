# A6.0 — Counterfactual Analysis & Shadow Intelligence

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、Counterfactual Analysis（反事实分析）

### 1.1 什么是 Counterfactual

```
1000 tick 前:
  AI 选择: Expand Room A
  实际结果: Room A 成功殖民

反事实问题:
  如果当时选择: Expand Room B
  结果可能怎样？
```

**核心价值**：从 "我们做了什么" 升级到 "如果做不同选择会怎样"。

### 1.2 为什么 Counterfactual 重要

当前系统的局限：
- 只知道 "做了 X 后发生了 Y"
- 不知道 "如果做 Z 会发生什么"
- 无法评估 "未选择的方案" 的价值
- 无法检测 "是否错过了更优选择"

Counterfactual 的价值：
- 评估未选择方案的机会成本
- 检测策略选择是否有系统性偏差
- 为 Shadow Intelligence 提供评估基础
- 为未来类似决策提供参考

### 1.3 如何构建 Counterfactual

#### 已有基础

| 已有系统 | Counterfactual 用途 |
|---------|-------------------|
| DecisionTrace (A4.7) | 有 DecisionRecord + rejectedAlternatives |
| Replay Engine (A4.7) | 可以从 Snapshot 重新推导决策 |
| State Snapshot | 决策前后的状态 hash |
| EventLog | 事件序列可回放 |

#### 三要素

```
1. DecisionTrace: 决策时的完整输入和被拒方案
2. Replay: 从历史 Snapshot 重新推导决策
3. Simulation: 模拟 "如果做不同选择" 的后续发展
```

#### 当前缺失

| 缺失 | 严重度 | 修复方案 |
|------|--------|---------|
| 没有 Simulation 引擎 | HIGH | 需要构建轻量模拟器 |
| State Snapshot 不完整 | MEDIUM | 需要扩展 Snapshot 覆盖 |
| 没有历史 State 存储 | MEDIUM | 需要定期存储关键 State |
| Replay 只在测试环境 | LOW | 可复用已有 Replay |

### 1.4 Counterfactual 的三个层次

#### Level 1: Decision Comparison（决策对比，第一阶段可做）

```
对比: DecisionRecord.selectedAction vs DecisionRecord.rejectedAlternatives
不需要 Simulation。
只需要: 统计 "选择了 A 时结果如何" vs "选择了 B 时结果如何"
方法: 从 Episodic Memory 中按 selectedAction 分组统计
```

示例：
```
统计:
  选择 "编队 A [2atk, 1heal]" 的 5 场 war → 胜率 40%
  选择 "编队 B [3atk, 2heal]" 的 3 场 war → 胜率 67%

结论: 编队 B 可能优于编队 A
置信度: 中（样本少）
```

#### Level 2: Replay-based Counterfactual（基于 Replay，第二阶段）

```
从历史 DecisionTrace 中取一个 DecisionSnapshot
用不同的参数重新 Replay 决策
对比原决策和 Replay 决策的差异
```

示例：
```
原决策: posture=war (基于 threat=HIGH, economy=stable, bucket=5000)
Replay: 用相同 Snapshot 但调整 threshold → posture=fortify
对比: 如果当时选择 fortify 而非 war，后续发展会怎样？
```

#### Level 3: Simulation-based Counterfactual（基于模拟，后期/A7）

```
从历史 State Snapshot 重建世界状态
在模拟器中执行不同的决策序列
对比模拟结果与实际结果
```

这是最终形态，需要：
- 完整的 Simulation 引擎
- 完整的历史 State
- 大量 CPU（不进 tick，离线运行）

### 1.5 Counterfactual 的限制

**不能得到真实世界答案**：
- "如果当时扩张 Room B" 的真实结果永远不知道
- 只能通过统计/模拟估计

**依赖数据质量**：
- 如果 DecisionTrace 不完整，Counterfactual 不可靠
- 如果样本太少，统计对比无意义

**依赖 Simulation 质量**：
- 模拟器不可能完美复现 Screeps 世界
- 模拟结果只是近似

---

## 二、Shadow Intelligence（影子智能）

### 2.1 什么是 Shadow Intelligence

```
Live Strategy（当前策略）
  ↓ Run
  帝国实际运行

Shadow Strategy（影子策略）
  ↓ Evaluate (不执行)
  评估 "如果用这个策略会怎样"

对比: Live vs Shadow
  → Expected Gain
  → Risk
  → CPU
  → Resource
  → Survival

结果: Recommendation
  → 如果 Shadow 优于 Live → 建议切换
  → 如果 Shadow 不优于 Live → 保持 Live
```

### 2.2 为什么 Shadow Intelligence 重要

**问题**：Learning 的最大风险是 "自我强化错误策略"。

**Shadow Intelligence 的价值**：
- 新策略不直接生效，先在影子中评估
- 评估通过后才逐步采用
- 评估失败则放弃，不影响帝国运行
- 安全的 "探索" 机制

### 2.3 Shadow Intelligence 的架构

```
┌──────────────────────────────────────────┐
│  Live Strategy (A5, 实际运行)             │
│                                           │
│  posture=develop                          │
│  hauler.maxCount=4                        │
│  war.squadSize=3                          │
│                                           │
│  → 帝国实际执行                            │
│  → 实际产出 DecisionTrace + EventLog      │
└──────────────────┬───────────────────────┘
                   │
                   │ (并行评估，不执行)
                   ▼
┌──────────────────────────────────────────┐
│  Shadow Strategy (A6, 影子评估)            │
│                                           │
│  shadowPosture=expand                     │
│  shadowHauler.maxCount=5                  │
│  shadowWar.squadSize=4                    │
│                                           │
│  → 评估 "如果用这些参数会怎样"             │
│  → 对比 Live 的实际表现                    │
│  → 产出 ShadowEvaluation                  │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Shadow Evaluation Result                 │
│                                           │
│  expectedGain: +0.15 (经济增速预期+15%)   │
│  risk: 0.2 (风险增加 20%)                 │
│  cpuImpact: +0.3 CPU/tick                 │
│  survivalImpact: neutral                  │
│                                           │
│  → Recommendation: "建议逐步采用           │
│    shadowHauler.maxCount=5"               │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Validation Gate → Canary → Adoption      │
│                                           │
│  1. 通过 Validation Gate                  │
│  2. 在 1 个房间 canary 1500 tick          │
│  3. 指标改善 → 推广全局                    │
│  4. 指标恶化 → 回滚 + 标记 Shadow 失败    │
└──────────────────────────────────────────┘
```

### 2.4 Shadow Strategy 的评估方法

#### 方法 A: Counterfactual Evaluation（反事实评估）

```
如果当时用 Shadow 参数，结果会怎样？

1. 取 Live 的 DecisionSnapshot
2. 用 Shadow 参数重新 Replay 决策
3. 对比 Live 决策 vs Shadow 决策
4. 估算 Shadow 决策的结果
```

#### 方法 B: Historical Comparison（历史对比）

```
以前用过类似参数时结果如何？

1. 从 Episodic Memory 中查找 "参数接近 Shadow 参数" 的历史 Experience
2. 统计这些 Experience 的 Outcome
3. 对比当前 Live 参数的 Outcome
```

#### 方法 C: Simulation（模拟，后期）

```
在模拟器中运行 Shadow 策略 N tick
对比模拟结果与 Live 的实际结果
```

### 2.5 Shadow Intelligence 的安全约束

| 约束 | 理由 |
|------|------|
| Shadow 不执行任何 Game API | 安全边界 |
| Shadow 不修改任何运行时状态 | 安全边界 |
| Shadow 只在 A6 内部评估 | 不影响 A4/A5 |
| Shadow 评估走 safeRun | 错误不传播 |
| Shadow 评估不进 tick 关键路径 | interval ≥ 500 |
| Recovery 档下 Shadow 全停 | CPU 优先给生存 |
| Shadow → Recommendation → Validation Gate → Canary | 唯一允许的路径 |

---

## 三、Self-Improvement Loop

### 3.1 完整循环

```
Observe
  ↓
Decide (A5 执行)
  ↓
Execute (A5 执行)
  ↓
Measure (A6 Experience Collection)
  ↓
Evaluate (A6 Strategy Evaluation)
  ↓
Remember (A6 Memory Storage)
  ↓
Detect Pattern (A6 Pattern Detection)
  ↓
Generate Recommendation (A6 Recommendation Engine)
  ↓
Validate (A6 Validation Gate)
  ↓
Shadow Evaluate (A6 Shadow Intelligence)
  ↓
Canary (小范围试用)
  ↓
Adopt / Reject (基于 Canary 结果)
  ↓
Observe Again
```

### 3.2 Safety Gate

```
Recommendation
  ↓
Safety / Constraint Validation (Validation Gate)
  ↓
Shadow Evaluation (不执行，只评估)
  ↓
Canary (小范围执行，观察)
  ↓
Adoption (全局推广) 或 Rollback (回滚)
```

### 3.3 Policy Version

```
policy-v1 (CONFIG 默认)
  ↓ A6 建议 + 验证 + canary
policy-v2 (A6 调整后的参数)
  ↓ A6 建议 + 验证 + canary
policy-v3 (进一步调整)
  ↓ 回滚
policy-v2 (回退到上一版本)
```

**支持**：
- A/B 对比（policy-v1 vs policy-v2）
- Shadow 评估（shadow policy vs live policy）
- Rollback（回退到任意历史版本）
- Replay（从历史版本重新推导）

```typescript
interface PolicyVersion {
  version: number;
  params: Record<string, number>;  // 参数快照
  createdAt: number;
  status: "active" | "shadow" | "rolled_back" | "invalidated";
  canaryResults?: CanaryResult;
}

interface CanaryResult {
  roomId: string;
  startTick: number;
  endTick: number;
  metricsBefore: Record<string, number>;
  metricsAfter: Record<string, number>;
  improvement: number;
  verdict: "improved" | "neutral" | "deteriorated";
}
```

---

## 四、第一阶段 vs 后期

| 能力 | 第一阶段 | 第二阶段 | 后期/A7 |
|------|---------|---------|---------|
| Decision Comparison (Level 1) | ✅ | ✅ | ✅ |
| Replay-based Counterfactual (Level 2) | ❌ | ✅ | ✅ |
| Simulation-based Counterfactual (Level 3) | ❌ | ❌ | ✅ |
| Shadow Intelligence | ❌ 基础 | ✅ 核心 | ✅ |
| Self-Improvement Loop | ❌ | ✅ | ✅ |
| Policy Versioning | ❌ | ✅ | ✅ |
| A/B Testing | ❌ | ❌ | ✅ |

---

## 五、关键结论

1. **Counterfactual Analysis 是重要能力，但不应提前到第一阶段**
2. **第一阶段只做 Level 1（Decision Comparison）**——统计对比已选择方案的效果
3. **Level 2（Replay-based）需要完整的历史 Snapshot**，第二阶段引入
4. **Level 3（Simulation）需要 Simulation 引擎**，后期/A7 引入
5. **Shadow Intelligence 是 A6 的核心能力之一**，但不是第一阶段
6. **Shadow Intelligence 提供安全的 "探索" 机制**，不直接执行
7. **Self-Improvement Loop 需要 Safety Gate**：Validate → Shadow → Canary → Adopt/Reject
8. **Policy Versioning 支持 Rollback**，可回退到任意历史版本
9. **Shadow Intelligence 应该成为 A6 后期的核心**，但依赖 Experience Foundation 先完成
