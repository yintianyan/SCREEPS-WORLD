# A6.0 — Empire Intelligence Architecture

> **阶段**: A6.0 Research / Architecture（不实现代码）
> **日期**: 2026-08-25
> **前置**: A5 Full Architecture Freeze ✅
> **约束**: 纯研究文档，不修改 A5，不实现 Learning

---

## 一、A6 到底解决什么问题

### 1.1 A5 的能力边界

A1–A5 建立了一个**反应式自治系统**（Reactive Autonomous System）。其完整闭环：

```
Observe → State → Strategy → Plan → Execute → Feedback → Recovery → Trace
```

这个闭环已经实现：

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| Observe（感知） | `room-snapshot.ts` → RoomSnapshot | ✅ 每 tick |
| State（状态） | `Memory.kernel` + `globalCache` | ✅ 版本化 |
| Strategy（策略） | `posture.ts: evaluateEmpirePosture()` | ✅ 唯一裁决 |
| Plan（规划） | `war-planning.ts` / `logistics/planner.ts` / `expansion-manager.ts` | ✅ |
| Execute（执行） | RolePolicy + traffic-manager | ✅ |
| Feedback（反馈） | `empire-health-system.ts` → 8 维度健康度 | ✅ |
| Recovery（恢复） | `recovery-execution-system.ts` → A4.6 lifecycle | ✅ |
| Trace（追踪） | `decision-trace-system.ts` → Ring Buffer + Replay | ✅ |

### 1.2 A5 做不到什么

A5 系统能**感知 → 决策 → 执行 → 反馈**，但它做不到：

| 缺失能力 | 说明 | 后果 |
|----------|------|------|
| **Remember** | 不从历史中提取知识。DecisionTrace 有 Ring Buffer（1000 条），但只用于事后审计，不反馈到未来决策 | 重复犯相同错误 |
| **Compare** | 不比较不同策略的效果。没有 "编队 A vs 编队 B" 的统计 | 策略选择基于经验猜测 |
| **Evaluate** | 不评估决策质量。`evaluateWarOutcome()` 只判定胜负，不分析原因 | 不知道为什么赢/输 |
| **Learn** | 不从经验中提取模式。tuning-engine 只调整人口参数，不调整策略参数 | 参数永远从 CONFIG 默认开始 |
| **Predict** | 不预测未来风险。只响应已发生事件 | 被动反应永远慢一步 |
| **Adapt** | 不根据表现自适应调整。posture 切换是反应式的，不是学习式的 | 策略参数静态固定 |

### 1.3 A5 Autonomous Loop vs A6 Intelligence Loop

**严格边界定义**：

```
A5 Autonomous Loop（运行时自动化）:
  World → Observe → State → Decide → Execute → Feedback → Recovery
  ─────────────────────────────────────────────────────────────
  特征: 确定性、每 tick/低频执行、safeRun 保护、可 Replay
  约束: 同输入 → 同输出（Deterministic）
  速度: 毫秒级响应
  权限: 可执行 Game API（spawn/attack/move/transfer）

A6 Intelligence Loop（帝国智能）:
  Experience → Evaluate → Pattern → Predict → Recommend → Validate → Adopt
  ─────────────────────────────────────────────────────────────
  特征: 低频分析、统计推理、可解释建议、可回滚
  约束: 同输入+同模型+同参数 → 同建议（Deterministic）
  速度: 百/千 tick 级分析
  权限: ❌ 不可执行 Game API（只产出 Recommendation）
```

**核心分界线**：

> A5 拥有**执行权**（Execution Authority）；A6 只有**建议权**（Recommendation Authority）。
> A6 的 Recommendation 必须经过 Validation Gate 才能影响 A5 的 Strategy/Planner。
> A6 永远不直接调用 Game API。

### 1.4 Runtime Automation vs Empire Intelligence

| 维度 | Runtime Automation (A1-A5) | Empire Intelligence (A6) |
|------|---------------------------|--------------------------|
| 目标 | 让帝国存活运转 | 让帝国变得更聪明 |
| 执行频率 | 每 tick / 每 N tick | 每 100–1000+ tick |
| 数据来源 | Game 对象 / RoomSnapshot | DecisionTrace / EventLog / EmpireHealth 历史 |
| 输出 | Game API 调用 | Recommendation DTO |
| 确定性要求 | 同输入同输出（Replay） | 同输入+同模型+同参数同建议 |
| 失败影响 | 直接影响帝国生存 | 只影响建议质量（不伤害帝国） |
| CPU 预算 | 主要预算消费者 | ≤ 帝国 CPU 的 2-3% |
| Memory 预算 | Memory 主体 + heap | RawMemory segment（冷数据） |

---

## 二、Empire Intelligence 核心模型

### 2.1 完整数据流

```
World
  ↓
Observation（已有: RoomSnapshot / EventLog / IntelEntry）
  ↓
State（已有: Memory.kernel / globalCache）
  ↓
Decision（已有: DecisionTrace / DecisionRecord）
  ↓
Execution（已有: RolePolicy / Systems）
  ↓
Outcome（❌ 缺失: 需建立 OutcomeRecord）
  ↓
Evaluation（❌ 缺失: 需建立 StrategyEvaluation）
  ↓
Experience（❌ 缺失: 需建立 ExperienceRecord）
  ↓
Memory（❌ 缺失: 需建立 Long-Term Memory）
  ↓
Pattern（❌ 缺失: 需建立 Pattern Detection）
  ↓
Prediction（❌ 缺失: 需建立 Prediction Layer）
  ↓
Policy Recommendation（❌ 缺失: 需建立 Recommendation）
  ↓
Strategy（已有: posture / war-planning / expansion / economy）
```

### 2.2 概念分层（严格区分，不可混用）

以下 10 个概念**必须严格区分**，不能混成一个 Memory：

| 概念 | 定义 | 来源 | 确定性 | 示例 |
|------|------|------|--------|------|
| **FACT** | 直接观测到的客观事实 | Game 对象 / RoomSnapshot | 确定（观测时刻） | "房间 W1N1 有 3 个 tower" |
| **OBSERVATION** | 一次观测行为及其结果 | room-snapshot / intel | 确定但有时效性 | "tick 12345 观测到 W1N1 有 3 tower" |
| **EVENT** | 状态转换的离散记录 | event-log (EventKind) | 确定（已发生） | "tick 12346 TowerVolley fired=3" |
| **OUTCOME** | 决策执行后的世界状态变化 | 对比 Decision 前后 State | 确定（已发生） | "war 对 W1N1 执行后，controller 降级" |
| **EXPERIENCE** | Decision + Outcome + Attribution 的完整记录 | A6 系统构建 | 确定（已发生） | "编队 [2 attacker, 1 healer] vs [1 boosted defender] → 胜，归因: focus fire 有效" |
| **PATTERN** | 从多个 Experience 中提取的统计规律 | Pattern Detection | 概率性 | "对玩家 X，编队含 healer 胜率 80%" |
| **HYPOTHESIS** | 对 Pattern 的因果解释 | 推理 | 不确定 | "玩家 X 的 healer 技能差，集火 healer 有效" |
| **PREDICTION** | 对未来事件的预判 | Prediction Layer | 概率性 + 置信度 | "未来 2000 tick 内玩家 X 可能进攻 W1N1 (置信度 0.7)" |
| **RECOMMENDATION** | 基于以上所有得出的行动建议 | Recommendation Engine | 可解释 + 可回溯 | "建议: 在 W1N1 增加 1 个 tower (理由: 预测威胁 0.7)" |
| **DECISION** | 实际执行的行动选择 | A5 系统（Strategy/Planner） | 确定（已执行） | "posture=fortify, 在 W1N1 建造 tower" |

### 2.3 概念流转规则

```
FACT → OBSERVATION → EVENT → OUTCOME → EXPERIENCE
                                              ↓
                                    PATTERN (统计聚合)
                                              ↓
                                    HYPOTHESIS (因果推理)
                                              ↓
                                    PREDICTION (未来预判)
                                              ↓
                                    RECOMMENDATION (行动建议)
                                              ↓
                            Validation Gate (安全验证)
                                              ↓
                                    DECISION (A5 执行)
```

**禁止**：
- PATTERN 直接变成 DECISION（必须经过 RECOMMENDATION + Validation）
- PREDICTION 直接变成 DECISION（Prediction 只提供信息，不做决策）
- HYPOTHESIS 冒充 FACT（Hypothesis 是推理，不是观测）

---

## 三、A6 分层架构（候选）

```
┌──────────────────────────────────────────────────────┐
│  Empire Intelligence Layer (A6)                       │
│                                                       │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │Prediction│ │Strategy  │ │Player    │ │Pattern  │  │
│  │Layer    │ │Evaluation│ │Intelligence│ │Detection│  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └────┬────┘  │
│       │           │            │            │        │
│  ┌────▼───────────▼────────────▼────────────▼────┐  │
│  │          Recommendation Engine                 │  │
│  │     (产出 Recommendation DTO, 不执行)           │  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼──────────────────────────┐  │
│  │        Validation Gate (Safety Boundary)       │  │
│  │  (白名单 / 值域 / 窗口 / canary / rollback)    │  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼──────────────────────────┐  │
│  │     Experience & Memory Layer                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │Episodic  │ │Semantic  │ │Strategic     │  │  │
│  │  │Memory    │ │Memory    │ │Memory        │  │  │
│  │  └──────────┘ └──────────┘ └──────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐                    │  │
│  │  │Player    │ │Combat    │                    │  │
│  │  │Memory    │ │Memory    │                    │  │
│  │  └──────────┘ └──────────┘                    │  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                              │
└───────────────────────┼──────────────────────────────┘
                        │ (只读消费)
┌───────────────────────▼──────────────────────────────┐
│  Existing A4/A5 Systems (不动)                        │
│                                                       │
│  Strategy → Planning → Military → Tactical → Recovery│
│  Spawn → Logistics → Economy → Construction → Layout │
│  DecisionTrace → EmpireHealth → EventLog → Replay    │
└──────────────────────────────────────────────────────┘
```

### 3.1 各层职责

| 层 | 职责 | 输入 | 输出 | 频率 |
|----|------|------|------|------|
| **Experience & Memory** | 记录 Experience，管理长期记忆 | DecisionTrace + EventLog + EmpireHealth | ExperienceRecord / Memory entries | 事件驱动 + 低频 |
| **Pattern Detection** | 从 Experience 中提取统计规律 | ExperienceRecord[] | PatternRecord | 每 500–1000 tick |
| **Strategy Evaluation** | 评估策略效果 | Experience + Outcome | StrategyScore | 每 500–1000 tick |
| **Player Intelligence** | 玩家行为建模 | PlayerIntel + Combat Memory | PlayerProfile | 每 1000+ tick |
| **Prediction Layer** | 预测未来风险 | Pattern + 当前 State | Prediction + Confidence | 每 500–1000 tick |
| **Recommendation Engine** | 生成可解释建议 | Pattern + Prediction + Evaluation | Recommendation DTO | 每 500–1000 tick |
| **Validation Gate** | 安全验证建议 | Recommendation | Validated Recommendation | 同上 |

### 3.2 与已有系统的关系

| 已有系统 | A6 如何消费 | A6 是否修改 |
|---------|-----------|-----------|
| DecisionTrace (A4.7) | 只读 DecisionRecord + Replay | ❌ 不修改 |
| EmpireHealth (A4.5) | 只读 healthResult + history | ❌ 不修改 |
| EventLog | 只读 GameEvent | ❌ 不修改 |
| Recovery (A4.6) | 只读 RecoveryAction 历史 | ❌ 不修改 |
| Logistics (A4.3) | 只读 TransportPlan + Starvation | ❌ 不修改 |
| Spawn (A4.4) | 只读 spawn queue 历史 | ❌ 不修改 |
| WarPlanning (A5.3) | 只读 WarPlan + WarOutcome | ❌ 不修改 |
| Tactical (A5.4) | 只读 TacticalDecision | ❌ 不修改 |
| tuning-engine | A6 的 Adaptive Policy 层可向 tuning 覆盖层写入建议值 | ⚠️ 通过已有 tuning 覆盖层接口 |
| posture (A3) | A6 的 Recommendation 可被 posture 消费 | ⚠️ posture 读取 Recommendation 字段（新增只读字段） |

---

## 四、A6 的核心设计原则

### 4.1 Learning 是 Observer / Evaluator / Recommender，不是 Executor

```
禁止路径（绝对红线）:
  Learning → spawnCreep()
  Learning → creep.attack()
  Learning → creep.move()
  Learning → terminal.send()
  Learning → recovery execution
  Learning → tactical decision
  Learning → 直接修改 Strategy
  Learning → 直接修改 Memory 中 Runtime State

允许路径:
  Learning → Recommendation → Validation Gate → tuning 覆盖层 / posture 建议字段
  Learning → 只读消费 DecisionTrace / EventLog / EmpireHealth
  Learning → 只写 RawMemory segment（冷数据）
```

### 4.2 确定性合同

A6 的所有纯函数必须满足：

```
同一 Experience 输入 + 同一模型版本 + 同一参数集
→ 同一 Recommendation
```

**禁止的非确定性来源**：
- `Math.random()` — 使用确定性 hash 做 tie-break
- `Date.now()` — 使用 `Game.time` 代替
- 浮点误差 — 使用整数运算或固定精度
- 无序迭代 — 使用排序后的数组/Map
- 跨 tick mutation — 每次评估从输入完整推导

### 4.3 CPU 预算

A6 系统的 CPU 预算约束：

| 级别 | 系统 | 频率 | 单次 CPU 预算 | 总预算占比 |
|------|------|------|-------------|-----------|
| 在线分析 | Experience 记录 | 事件驱动 | < 0.1 CPU | — |
| 批处理 | Pattern Detection | 每 500 tick | < 1 CPU | ≤ 0.5% |
| 批处理 | Strategy Evaluation | 每 1000 tick | < 2 CPU | ≤ 0.5% |
| 批处理 | Prediction | 每 500 tick | < 1 CPU | ≤ 0.5% |
| 批处理 | Recommendation | 每 500 tick | < 0.5 CPU | ≤ 0.3% |
| 离线/外部 | Counterfactual Simulation | 手动触发 | 不限 | 0% (不进入 tick) |

**总预算**：A6 整体 ≤ 帝国 CPU 的 2-3%。Recovery 档下 A6 全部停止。

### 4.4 Memory 预算

A6 的存储分层：

| 数据类型 | 存储层 | 容量上限 | TTL | 压缩策略 |
|---------|--------|---------|-----|---------|
| Experience Buffer | heap (Ring Buffer) | 100 条 | tick 后清 | 不压缩 |
| Episodic Memory | RawMemory segment | 2 segments (200KB) | 10000 tick 滚动 | 降采样 |
| Semantic Memory | RawMemory segment | 1 segment (100KB) | 永久（更新不删） | 聚合统计 |
| Strategic Memory | RawMemory segment | 1 segment (100KB) | 永久 | 聚合统计 |
| Player Memory | RawMemory segment | 1 segment (100KB) | 月级 TTL | 衰减权重 |
| Combat Memory | RawMemory segment | 1 segment (100KB) | 10000 tick | 滚动窗口 |
| Pattern Record | heap + segment | 50 条 heap | 5000 tick | EMA 聚合 |
| Recommendation | heap | 当前活跃集 | 下次评估覆盖 | 不持久化 |

**Segment 激活预算**：A6 常态占用 ≤ 2 个激活段（与 Intel 共享 10 段/tick 上限）。

---

## 五、25 个最终问题的回答

### Q1: A6 是否真的需要 "Learning" 这个名字？

**部分需要。** "Learning" 暗示一个从数据中提取知识并改善未来行为的过程。A6 的前半部分（Experience + Evaluation + Pattern）确实是 Learning。但后半部分（Prediction + Recommendation + Validation）更接近 "Intelligence" 或 "Advisory"。

建议保留 "Empire Intelligence" 作为整体名称，"Learning" 仅指 Pattern Detection 和 Strategy Evaluation 这两个子过程。

### Q2: A6 的第一能力究竟应该是什么？

**Experience Recording + Outcome Attribution。**

在帝国能够 "学习" 之前，它必须先知道 "发生过什么" 和 "为什么发生"。当前 DecisionTrace 记录了 "为什么做"（Decision reasons），但没有记录 "做完后发生了什么"（Outcome）和 "结果应该归因给谁"（Attribution）。

没有可靠的 Experience 和 Attribution，所谓 Learning 就是 "根据自己产生的数据自我强化"。

### Q3: 第一阶段是否应该使用 ML？

**不应该。**

理由：
1. Screeps 的数据量太小（每场 war 产出的样本 < 10），不足以训练 ML 模型
2. ML 不可解释，违反 A6 的 "可解释建议" 原则
3. ML 不可 deterministic replay，违反确定性合同
4. ML 需要 CPU 密集训练，与 Screeps 的 CPU 约束不兼容
5. 已有 tuning-engine 的 "规则 + 统计 + 验证 + 回滚" 方法已证明有效

第一阶段应使用：**Rule-based adaptation + Statistical aggregation + Bayesian inference（轻量）**。

### Q4: 最有价值的 Memory 是什么？

**Combat Memory（编队配置 × 敌方配置 → 胜率统计）。**

因为：
- 直接影响战争决策质量
- 数据来源已存在（evaluateWarOutcome + DecisionTrace）
- 归因相对简单（一场 war 的胜负可以归因到编队配置）
- 不需要复杂的 Attribution 模型

### Q5: 最有价值的 Experience 是什么？

**War Experience（WarPlan + TacticalDecision + Outcome + Attribution）。**

因为：
- 战争是 Screeps 中代价最高的事件
- 每场 war 的 DecisionTrace 已完整记录
- WarOutcome 已有评估（success/failure/unknown）
- 从 War Experience 中可以直接提取编队配置效果

### Q6: 最难解决的 Attribution 是什么？

**经济 Attribution（Spawn 10 个 worker → 500 tick 后经济增长）。**

因为：
- 延迟极大（500+ tick）
- 多系统耦合（Spawn + Layout + Logistics + Source + Hauler + RoomStrategy）
- 没有对照组（不能同时跑两个帝国做 A/B 测试）
- 经济变化受外部因素影响（市场、远矿、战争消耗）

建议：第一阶段**不解决经济 Attribution**，只做 War Attribution（胜负归因相对简单）。

### Q7: 哪些 Prediction 最有价值？

按价值排序：

1. **Hostile arrival prediction**（敌方到达时间预测）— 从被动防御到主动部署
2. **Energy shortage prediction**（能量短缺预测）— 提前调整经济策略
3. **Spawn starvation prediction**（孵化饥饿预测）— 提前调整人口规划
4. **Room collapse prediction**（房间崩溃预测）— 提前触发 Recovery
5. **CPU pressure prediction**（CPU 压力预测）— 提前降级

### Q8: Player Intelligence 是否应该现在开始？

**不应该作为第一阶段。**

理由：
- Player Intelligence 需要主动侦察（scout 系统），有 PvP 暴露风险
- 需要大量历史数据才能建模玩家行为
- 当前的 PlayerIntel 只有被动记录（A5.2），不足以支撑行为建模
- 应先建立 Experience Foundation，再在其上构建 Player Intelligence

### Q9: Combat Learning 是否应该现在开始？

**应该，但只做统计层面。**

Combat Learning 的第一阶段：
- 编队配置 × 敌方配置 → 胜率统计（从 WarOutcome + DecisionTrace 提取）
- Tactical state 转换频率（是否频繁 REGROUPING → 编队不稳）
- FocusFire 目标选择效果（集火 healer 的 kill time vs 其他选择）

**不做**：
- 敌方行为预测（需要 Player Intelligence 先完成）
- 战术参数自动调优（需要 Adaptive Policy 先完成）

### Q10: Counterfactual Simulation 是否应该提前？

**不应该。**

Counterfactual 需要：
- 完整的 Replay 基础设施（已有 ✅）
- 完整的 State Snapshot（部分有 ✅）
- Simulation 引擎（❌ 不存在）
- 足够的历史数据（❌ 还没开始收集）

建议放在 A6 后期或 A7。

### Q11: Shadow Intelligence 是否应该成为 A6 核心？

**应该，但不是第一阶段。**

Shadow Intelligence（影子策略并行评估）是 A6 的终极目标之一，但它需要：
- Experience Foundation（先有数据）
- Strategy Evaluation（先有评估能力）
- 完整的 Simulation 环境（先有模拟能力）

建议作为 A6 后期的核心能力。

### Q12: A6 最容易犯的架构错误是什么？

**让 Learning 直接修改 Strategy。**

这是最诱人也最危险的错误。一旦 Learning 直接修改 Strategy 参数，就破坏了：
- Deterministic Replay（无法重放 Learning 修改后的决策）
- 安全边界（Learning 错误直接影响帝国运行）
- 可回滚性（Learning 修改了什么、何时修改的、如何回滚）

**必须坚持**：Learning → Recommendation → Validation Gate → tuning 覆盖层 / posture 建议字段。

### Q13: A6 最大 CPU 风险是什么？

**Pattern Detection 的 O(N²) 复杂度。**

如果对 N 条 Experience 两两比较找 Pattern，复杂度是 O(N²)。100 条 Experience = 10000 次比较。每次比较如果涉及多维度匹配，CPU 可能超 5。

**缓解**：使用预排序 + 分桶 + 增量更新，避免全量两两比较。

### Q14: A6 最大 Memory 风险是什么？

**无限历史积累。**

Screeps 帝国运行数百万 tick。如果每 tick 产生 1 条 Experience，100 万 tick = 100 万条。即使每条 100 字节，也是 100MB — 远超 segment 容量。

**缓解**：
- Ring Buffer（heap，100 条）
- 降采样写入 segment（每 N tick 取 1 条）
- 聚合统计替代原始记录（只存 EMA/分位数，不存原始数据）
- TTL + GC（超期数据清除）

### Q15: A6 最大数据质量风险是什么？

**自我强化错误策略（Self-reinforcing bad policy）。**

如果 Learning 从自己的决策结果中学习，而决策本身是错误的，那么 Learning 会 "确认" 错误决策为 "有效"。

例：posture 过度反应（频繁 war → fortify 切换）→ Learning 认为 war 策略 "无效"（因为每次 war 都很快退回 fortify）→ 推荐 "不 war" → 帝国面对真正威胁时不 war → 灾难。

**缓解**：
- Shadow Evaluation（影子评估，不直接影响策略）
- Counterfactual Analysis（如果当时做另一个决定会怎样）
- 外部基准（社区经验 / 静态 CONFIG 作为 sanity check）
- Human review gate（重大策略变更需人工确认）

### Q16: A6 如何保证 deterministic？

**Learning Determinism Contract**：

1. 所有 Pattern Detection / Strategy Evaluation / Prediction / Recommendation 使用纯函数
2. 输入完整注入（不依赖 Game / Memory / 全局可变状态）
3. tie-break 使用确定性 hash（FNV-1a，已有实现）
4. 浮点运算固定精度（toFixed(3)）
5. 迭代使用排序后数组（不依赖 Map/Object 迭代顺序）
6. 模型版本化（modelVersion 字段，同版本同参数同输出）

### Q17: A6 如何避免 self-reinforcing bad policy？

四道防线：

1. **Shadow First**：新建议先在影子中评估，不直接影响策略
2. **Counterfactual Check**：对比 "如果当时不做这个决策" 的历史
3. **External Baseline**：社区经验 / 静态 CONFIG 作为 sanity check
4. **Rollback Mechanism**：建议生效后如果指标恶化，自动回滚

### Q18: A6 如何 rollback？

三步回滚：

1. **Parameter Rollback**：tuning 覆盖层的参数回滚到 pre-recommendation 值（已有机制：tuning-engine 的 PendingValidation + rollback）
2. **Recommendation Invalidation**：将 Recommendation 标记为 INVALIDATED，后续评估不再使用
3. **Pattern Quarantine**：产生错误建议的 Pattern 标记为 QUARANTINED，进入冷却期（5000 tick）

### Q19: A6 什么时候允许 Recommendation 影响真实 Strategy？

**当且仅当以下条件全部满足**：

1. Recommendation 通过 Validation Gate（白名单 / 值域 / 窗口）
2. Shadow Evaluation 证明建议优于当前策略（期望增益 > 阈值）
3. Canary 期通过（小范围试用 N tick 后指标未恶化）
4. 模型版本与当前帝国版本兼容
5. 不在 Recovery / Conserve 档

### Q20: A6 完成后，什么能力才算真正的 "Empire Intelligence"？

当帝国能够：

1. ✅ 记住每场战争的编队、敌方配置和结果
2. ✅ 从历史中统计出 "哪种编队对哪种敌人胜率更高"
3. ✅ 预测 "玩家 X 可能在未来 N tick 内进攻"
4. ✅ 推荐 "建议使用编队 B 而非编队 A，因为历史胜率 80% vs 40%"
5. ✅ 在安全边界内自动采用更优策略参数
6. ✅ 当策略参数导致恶化时自动回滚
7. ✅ 以上全部不破坏 A5 的确定性、可观测性、Recovery、DecisionTrace、Replay

---

## 六、与已有架构文档的关系

| 已有文档 | A6 的关系 |
|---------|----------|
| `INTELLIGENCE_ARCHITECTURE.md` | A6 扩展情报系统的 Prediction 和 Player Intelligence 层。Intel 的六概念合同（Observation/Intel/Knowledge/Threat/Prediction/History）是 A6 的输入基础 |
| `LLM_BOUNDARY.md` | A6 的 Learning Approach 必须遵守 LLM 边界契约。A6 的 Adaptive Policy 层可以通过 L2（体外参数顾问）接收外部建议，但必须过护栏 |
| `MEMORY_ARCHITECTURE.md` | A6 的 Long-Term Memory 必须遵守三级存储合同。Experience 走 segment（冷数据），不进 Memory 主体 |
| `CPU_EXECUTION_MODEL.md` | A6 系统属于 Low Frequency 频带（200–1000+ tick），Recovery 档全停 |
| `STATE_OWNERSHIP_MODEL.md` | A6 新增的状态字段必须登记六列（Owner/Reader/Writer/Lifecycle/Persistence/Frequency） |
| `DECISION_AUTHORITY_MODEL.md` | A6 不新增 Decision Authority。Recommendation 不是 Decision，只影响参数 |
| `FAILURE_RECOVERY_ARCHITECTURE.md` | A6 系统走 safeRun，非关键连续失败 3 次进入冷却 |

---

## 七、A6 不做什么

| 禁止项 | 理由 |
|--------|------|
| 不实现 ML / RL / Neural Network | 数据量不足、CPU 不够、不可解释、不可 deterministic |
| 不实现 Diplomacy | 依赖他人，非自治系统的核心 |
| 不修改 A5 Military/Tactical 架构 | A5 已冻结 |
| 不建立第二套 DecisionTrace | 复用 A4.7 |
| 不建立第二套 Replay | 复用 A4.7 |
| 不建立第二套 Recovery | 复用 A4.6 |
| 不建立第二套 Spawn | 复用 A4.4 |
| 不建立第二套 Logistics | 复用 A4.3 |
| 不建立第二套 Threat | 复用 A5.1 |
| 不建立第二套 CombatCapability | 复用 A5.1 |
| 不建立第二套 Tactical Decision | 复用 A5.4 |
| 不让 Learning 直接调用 Game API | 安全边界红线 |
| 不让 Learning 直接修改 Strategy | 安全边界红线 |
| 不让 Learning 直接修改 Memory Runtime State | 安全边界红线 |
