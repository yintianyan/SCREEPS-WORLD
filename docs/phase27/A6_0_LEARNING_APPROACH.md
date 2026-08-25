# A6.0 — Learning Approach Comparison

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、不要默认 AI = Machine Learning

在决定 A6 使用什么学习方法之前，必须逐一评估所有候选方法在 Screeps 环境中的适用性。

Screeps 的特殊约束：

| 约束 | 影响 |
|------|------|
| CPU 严格限制（20-500 CPU/tick） | 训练/推理不能进入 tick |
| Memory 容量有限（2MB） | 模型参数不能存 Memory |
| 数据量极小（每场 war < 10 样本） | 不足以训练 ML 模型 |
| 需要确定性 Replay | 随机性方法不可用 |
| 需要可解释性 | 黑盒模型不可接受 |
| 长期运行（百万 tick） | 在线学习需持续稳定 |

---

## 二、八种方法逐一评价

### A. Rule-based Adaptation（规则自适应）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐⭐⭐⭐⭐ 极低（if-else） |
| **Memory** | ⭐⭐⭐⭐⭐ 极低（参数值） |
| **Determinism** | ⭐⭐⭐⭐⭐ 完全确定 |
| **Data requirements** | ⭐⭐⭐⭐⭐ 无（规则预定义） |
| **Implementation complexity** | ⭐⭐⭐⭐⭐ 简单 |
| **Explainability** | ⭐⭐⭐⭐⭐ 完全可解释 |
| **Debuggability** | ⭐⭐⭐⭐⭐ 容易调试 |
| **Screeps suitability** | ⭐⭐⭐⭐⭐ |

**描述**：使用预定义的规则和阈值进行参数调整。当前 tuning-engine 已采用此方法。

**优点**：
- 完全确定性
- 可解释
- CPU/Memory 极低
- 已有成功实现（tuning-engine）

**缺点**：
- 规则需要人工设计
- 不能发现未知模式
- 适应能力受限于规则覆盖范围

**结论**：**第一阶段核心方法**。tuning-engine 已证明有效。

---

### B. Statistical Learning（统计学习）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐⭐⭐⭐ 低（EMA/均值/方差） |
| **Memory** | ⭐⭐⭐⭐ 低（统计量） |
| **Determinism** | ⭐⭐⭐⭐⭐ 确定（确定性统计） |
| **Data requirements** | ⭐⭐⭐⭐ 中等（需 10+ 样本） |
| **Implementation complexity** | ⭐⭐⭐⭐ 中等 |
| **Explainability** | ⭐⭐⭐⭐ 可解释（统计量） |
| **Debuggability** | ⭐⭐⭐⭐ 可调试 |
| **Screeps suitability** | ⭐⭐⭐⭐⭐ |

**描述**：从历史数据中计算统计量（均值、方差、EMA、分位数），用统计推断做决策。

**方法**：
- EMA（指数移动平均）— 衰减权重的趋势跟踪
- Rolling Statistics — 滑动窗口统计
- Histogram — 分布统计
- Correlation — 相关性分析（编队配置 vs 胜率）

**优点**：
- 确定性（固定精度运算）
- 可解释（统计量直观）
- CPU/Memory 低
- 数据量要求适中

**缺点**：
- 只能发现统计相关，不能发现因果
- 需要足够样本（10+ 才有意义）
- 对异常值敏感

**结论**：**第一阶段核心方法**。用于 Pattern Detection 和 Strategy Evaluation。

---

### C. Bayesian Inference（贝叶斯推断）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐⭐⭐⭐ 低（先验 + 似然更新） |
| **Memory** | ⭐⭐⭐⭐ 低（先验/后验分布） |
| **Determinism** | ⭐⭐⭐⭐⭐ 确定（固定精度） |
| **Data requirements** | ⭐⭐⭐ 可从少量数据开始 |
| **Implementation complexity** | ⭐⭐⭐ 中等偏高 |
| **Explainability** | ⭐⭐⭐⭐ 可解释（概率更新） |
| **Debuggability** | ⭐⭐⭐ 可调试 |
| **Screeps suitability** | ⭐⭐⭐⭐ |

**描述**：使用贝叶斯定理从先验概率 + 新观察更新后验概率。

**方法**：
- 先验：基于 CONFIG 或历史数据的初始概率
- 似然：新观察对概率的影响
- 后验：更新后的概率

**示例**：
- 先验：玩家 X 进攻概率 = 0.3（基于历史）
- 新观察：玩家 X 在附近建造了 nuker
- 后验：进攻概率更新为 0.6

**优点**：
- 可从少量数据开始（先验提供基线）
- 可解释（概率更新过程清晰）
- 确定性（固定精度运算）
- 适合增量更新

**缺点**：
- 先验选择影响结果
- 需要定义似然函数
- 实现复杂度高于统计方法

**结论**：**第二阶段方法**。用于 Player Intelligence 的行为预测。

---

### D. Online Regression（在线回归）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐⭐⭐ 中等（矩阵运算） |
| **Memory** | ⭐⭐⭐ 中等（回归系数） |
| **Determinism** | ⭐⭐⭐⭐ 较确定（浮点精度需控制） |
| **Data requirements** | ⭐⭐⭐ 需 20+ 样本 |
| **Implementation complexity** | ⭐⭐⭐ 中等 |
| **Explainability** | ⭐⭐⭐ 中等（系数可解释） |
| **Debuggability** | ⭐⭐⭐ 可调试 |
| **Screeps suitability** | ⭐⭐⭐ |

**描述**：在线线性回归，逐步更新回归系数。

**方法**：
- 在线梯度下降 / 递归最小二乘
- 输入：多维度特征（如 hauler 数 + container 填充率 + CPU tier）
- 输出：预测值（如预期产能）

**优点**：
- 可以建模多变量关系
- 在线更新，不需要批量训练

**缺点**：
- 浮点精度问题（需要固定精度）
- 特征工程需要人工设计
- 数据量要求较高

**结论**：**暂不使用**。Screeps 的数据量不足以支撑可靠的回归。

---

### E. Bandit（多臂老虎机）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐⭐⭐⭐ 低（UCB/Thompson 采样） |
| **Memory** | ⭐⭐⭐⭐ 低（每臂统计） |
| **Determinism** | ⭐⭐⭐ 需确定性 PRNG |
| **Data requirements** | ⭐⭐⭐ 需多次尝试 |
| **Implementation complexity** | ⭐⭐⭐ 中等 |
| **Explainability** | ⭐⭐⭐ 中等（每臂收益可比较） |
| **Debuggability** | ⭐⭐⭐ 可调试 |
| **Screeps suitability** | ⭐⭐⭐ |

**描述**：在多个策略间做探索-利用权衡（explore-exploit tradeoff）。

**方法**：
- UCB（Upper Confidence Bound）
- Thompson Sampling（贝叶斯版）
- 每个策略（"臂"）维护收益统计
- 按收益 + 不确定性选择策略

**示例**：
- 臂 1：编队 A
- 臂 2：编队 B
- 臂 3：编队 C
- 每次战争后更新对应臂的收益
- 下次选择 UCB 最高的臂

**优点**：
- 自动探索新策略
- 自动利用已知好策略
- CPU/Memory 低

**缺点**：
- 需要多次尝试（Screeps war 频率低）
- 确定性 PRNG 需要设计
- "探索" 可能导致故意使用差策略（在 Screeps 中代价太高）

**结论**：**暂不使用**。Screeps 的战争频率太低，探索成本太高。但概念可借鉴用于 Shadow Evaluation（影子评估 = 安全探索）。

---

### F. Reinforcement Learning（强化学习）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐ 训练极贵，推理中等 |
| **Memory** | ⭐ 模型参数大 |
| **Determinism** | ⭐ 需要随机探索 |
| **Data requirements** | ⭐ 需大量 episode |
| **Implementation complexity** | ⭐ 极复杂 |
| **Explainability** | ⭐ 黑盒 |
| **Debuggability** | ⭐ 极难 |
| **Screeps suitability** | ⭐ |

**描述**：通过 trial-and-error 学习最优策略。

**结论**：**不使用**。理由：
1. 数据量远远不足（Screeps 的 war 频率远低于 RL 需要的 episode 频率）
2. CPU 不允许训练
3. 不可 deterministic（需要随机探索）
4. 不可解释
5. 不可调试

---

### G. Neural Network（神经网络）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐ 训练极贵 |
| **Memory** | ⭐ 模型参数大 |
| **Determinism** | ⭐⭐ 推理确定但训练不确定 |
| **Data requirements** | ⭐ 需大量标注数据 |
| **Implementation complexity** | ⭐ 极复杂 |
| **Explainability** | ⭐ 黑盒 |
| **Debuggability** | ⭐ 极难 |
| **Screeps suitability** | ⭐ |

**结论**：**不使用**。理由同 RL，且更严重。

---

### H. LLM-assisted Offline Analysis（LLM 辅助离线分析）

| 维度 | 评价 |
|------|------|
| **CPU** | ⭐⭐⭐⭐⭐ 零（体外运行） |
| **Memory** | ⭐⭐⭐⭐⭐ 零（体外运行） |
| **Determinism** | ⭐⭐⭐ 输出不确定但经护栏后确定 |
| **Data requirements** | ⭐⭐⭐⭐⭐ 无（LLM 自带知识） |
| **Implementation complexity** | ⭐⭐⭐ 中等（需护栏） |
| **Explainability** | ⭐⭐⭐⭐ 可解释（自然语言） |
| **Debuggability** | ⭐⭐⭐ 可调试 |
| **Screeps suitability** | ⭐⭐⭐⭐ |

**描述**：LLM 在体外分析遥测数据/代码，产出参数建议或设计建议。

**已有契约**：[LLM_BOUNDARY.md](../architecture/LLM_BOUNDARY.md) 定义了三层体外结构：
- L1 开发期研究员（当前已实践）
- L2 运营期参数顾问（可选演进）
- L3 灾难接管辅助

**优点**：
- 不消耗 tick CPU
- 可以分析复杂数据
- 可以产出人类可读的建议
- 已有护栏契约

**缺点**：
- 不能进入 tick 路径
- 输出不确定（需要护栏过滤）
- 需要体外基础设施
- 依赖外部服务（不可用时需降级）

**结论**：**作为可选的体外补充**。A6 的学习主要在体内完成，LLM 可作为 L2 参数顾问辅助。

---

## 三、综合对比矩阵

| 方法 | CPU | Memory | Determinism | Data | Complexity | Explainability | Debug | Suitability | 第一阶段 |
|------|-----|--------|-------------|------|------------|----------------|-------|-------------|---------|
| **Rule-based** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 核心 |
| **Statistical** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 核心 |
| **Bayesian** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ❌ 第二阶段 |
| **Online Reg.** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ❌ 暂不 |
| **Bandit** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ❌ 暂不 |
| **RL** | ⭐ | ⭐ | ⭐ | ⭐ | ⭐ | ⭐ | ⭐ | ⭐ | ❌ 不用 |
| **Neural Net** | ⭐ | ⭐ | ⭐⭐ | ⭐ | ⭐ | ⭐ | ⭐ | ⭐ | ❌ 不用 |
| **LLM offline** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⚠️ 可选补充 |

---

## 四、第一阶段学习方案

### 4.1 核心方法：Rule-based + Statistical

```
Experience Collection
  → Statistical Aggregation (EMA, Rolling Stats, Correlation)
  → Pattern Detection (Rule-based thresholds)
  → Strategy Evaluation (Statistical comparison vs baseline)
  → Recommendation (Rule-based: if pattern X then recommend Y)
  → Validation Gate (Rule-based: whitelist + bounds + canary + rollback)
```

### 4.2 为什么不用 ML

1. **数据量不足**：Screeps 的 war/扩张/经济决策事件频率极低（每天可能只有几场 war），远不足以训练 ML 模型
2. **CPU 不允许**：ML 训练需要大量计算，不可能在 tick 内完成
3. **不可解释**：ML 模型是黑盒，违反 A6 的 "可解释建议" 原则
4. **不可 deterministic**：ML 训练涉及随机初始化和随机采样，违反确定性合同
5. **不可 Replay**：ML 模型的输出不可重现，违反 Replay 合同
6. **已有替代**：Rule-based + Statistical 已能覆盖第一阶段需求
7. **社区无先例**：截至 2026-08，无已知长期存活的高水平 Screeps bot 使用 ML

### 4.3 Bayesian 的角色

第一阶段不使用 Bayesian，但预留接口：
- Player Intelligence 的行为预测可用 Bayesian Update
- Prediction Layer 的置信度计算可借鉴 Bayesian 思想
- 第二阶段引入

### 4.4 LLM 的角色

LLM 作为可选的体外补充（L2 参数顾问），不作为 A6 核心方法：
- 体外分析遥测数据，产出参数建议
- 建议经过护栏（白名单/值域/窗口/canary/回滚）后写入 tuning 覆盖层
- 外部服务不可用时帝国照常运行

---

## 五、关键结论

1. **第一阶段使用 Rule-based + Statistical**，不使用 ML
2. **第一阶段不使用 ML 的理由充分**：数据量、CPU、确定性、可解释性、社区先例
3. **Bayesian 作为第二阶段方法**，用于 Player Intelligence
4. **Bandit 概念可借鉴用于 Shadow Evaluation**（安全探索），但不直接使用
5. **RL / Neural Network 永久排除**（在 Screeps 环境中不可行）
6. **LLM 作为可选体外补充**，遵守 LLM_BOUNDARY 契约
7. **已有 tuning-engine 是 Rule-based + Statistical 的成功先例**，证明了方法的有效性
