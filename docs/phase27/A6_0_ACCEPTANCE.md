# A6.0 — Acceptance Criteria

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、行为级验收标准

A6 不用 "新增多少文件"、"新增多少测试" 作为主要验收标准。必须建立**行为级验收**。

### INT-001: 完整 Experience 记录

```
AI 能够记录一次完整的:
  Observation → Decision → Action → Outcome

验证方法:
  1. 触发一次 war（或模拟）
  2. war 结束后检查 Episodic Memory
  3. 验证 ExperienceRecord 包含:
     - decisionId（关联 DecisionTrace）
     - decisionSummary（决策摘要）
     - outcome.status（success/failure/unknown）
     - outcome.metric + value（量化结果）
     - attribution.primaryFactor + confidence（归因）
  4. 验证 ExperienceRecord 可通过 decisionId 追溯到 DecisionRecord

通过条件: 存在完整的 ExperienceRecord
```

### INT-002: Fact / Inference / Prediction 区分

```
AI 能够区分 Fact、Inference、Prediction

验证方法:
  1. 检查 PlayerProfile 数据结构
  2. 验证 facts 层只包含直接观测数据
  3. 验证 inferences 层标注为推断
  4. 验证 predictions 层标注为预测 + 置信度
  5. 验证没有 inference 冒充 fact
  6. 验证没有 prediction 冒充 fact

通过条件: 三层严格分离，无冒充
```

### INT-003: 经济瓶颈识别

```
AI 能够识别 Economic Bottleneck

验证方法:
  1. 运行帝国 10000 tick
  2. 检查 Strategy Evaluation 输出
  3. 验证 StrategyScore.dimensions 中:
     - economicGrowth 有量化值
     - resourceEfficiency 有量化值
     - 各维度有 delta（与基准的偏差）
  4. 验证能识别瓶颈维度（score 最低的维度）

通过条件: 能产出多维 StrategyScore 并识别瓶颈
```

### INT-004: 决策结果识别

```
AI 能够识别 Decision Outcome

验证方法:
  1. 触发一次决策（war / expansion / recovery）
  2. 等待 measurementDelay 后
  3. 检查 OutcomeRecord
  4. 验证 outcome.status 有明确值
  5. 验证 outcome.value 有量化值
  6. 验证 outcome.source 指向已有系统

通过条件: 能从已有系统采集 Outcome
```

### INT-005: 策略效果评价

```
AI 能够评价 Strategy Effectiveness

验证方法:
  1. 运行帝国 20000 tick（足够积累数据）
  2. 检查 Strategy Evaluation 输出
  3. 验证 StrategyScore 包含:
     - 多维评分（不合并为总分）
     - 每维有 score + metric + value + baseline + delta
     - 置信度
  4. 验证没有 "if score > X then good" 的简化

通过条件: 多维评估，无万能分数
```

### INT-006: 生成 Recommendation

```
AI 能够生成 Recommendation

验证方法:
  1. 积累足够 Experience + Evaluation + Prediction
  2. 检查 Recommendation Engine 输出
  3. 验证 Recommendation 包含:
     - 建议内容（参数 + 值）
     - 理由（人类可读）
     - 支撑数据（Pattern IDs / Prediction IDs）
     - 置信度
     - modelVersion

通过条件: 能产出可解释的 Recommendation
```

### INT-007: Recommendation 不直接执行

```
Recommendation 不直接执行任何 Game API

验证方法:
  1. 检查 Recommendation Engine 代码
  2. grep "Game\." / "Memory\." / "spawnCreep" / "attack" / "move" / "transfer"
  3. 验证 Recommendation 只产出 DTO
  4. 验证 DTO 通过 Validation Gate
  5. 验证 Validation Gate 只写 tuning 覆盖层

通过条件: 0 个 Game API 调用，0 个直接 Memory 修改
```

### INT-008: Deterministic Replay

```
相同输入能够 Deterministic Replay

验证方法:
  1. 取一组 ExperienceRecord[]
  2. 用相同模型版本 + 相同参数
  3. 运行 Pattern Detection 1000 次
  4. 验证 1000 次的 hash 完全一致
  5. 用相同输入运行 Strategy Evaluation 1000 次
  6. 验证 hash 一致
  7. 用相同输入运行 Recommendation Engine 1000 次
  8. 验证 hash 一致

通过条件: 1000 次 Replay hash 完全一致
```

### INT-009: Memory 有界

```
Memory 在长期运行中有界

验证方法:
  1. 运行帝国 100000 tick
  2. 每 1000 tick 采样 A6 segment 总体积
  3. 验证总体积不超 500KB
  4. 验证没有无限增长的字段
  5. 验证 GC 正常工作（旧数据被清除/覆盖）
  6. 验证 Memory 主体不包含 A6 历史数据

通过条件: 100000 tick 后 segment ≤ 500KB，Memory 主体无膨胀
```

### INT-010: Learning 不进入 1 tick critical path

```
Learning 不进入 1 tick critical path

验证方法:
  1. 检查 A6 所有系统的 interval
  2. 验证最小 interval ≥ 100
  3. 检查 A6 系统的 priority
  4. 验证 priority ≥ P3
  5. 检查 Recovery 档下 A6 是否停止
  6. 验证 Conserve 档下 A6 降级或停止

通过条件: 所有 A6 系统 interval ≥ 100, priority ≥ P3, Recovery 全停
```

### INT-011: Learning 不破坏 A5

```
Learning 不破坏 A5 的任何架构约束

验证方法:
  1. 检查 A6 是否修改了 A5 的任何代码
  2. 验证 A5 的 Canonical System Map 不变
  3. 验证 A5 的 Decision Authority Matrix 不变
  4. 验证 A5 的技术债台账不变（除非新增 A6 相关条目）
  5. 运行 A5 的所有测试
  6. 验证全部通过

通过条件: A5 代码 0 修改，A5 测试全绿
```

### INT-012: Learning 可以 Rollback

```
Learning 可以 Rollback

验证方法:
  1. 产生一个 Recommendation
  2. 通过 Validation Gate + Canary 生效
  3. 模拟指标恶化
  4. 验证自动回滚到 pre-adjust 值
  5. 验证 Recommendation 标记为 INVALIDATED
  6. 验证后续评估不再使用该 Recommendation

通过条件: 自动回滚 + 标记失效
```

### INT-013: 不建立第二套系统

```
A6 不建立第二套 DecisionTrace / Replay / Recovery / Spawn / Logistics / Threat / CombatCapability / Tactical

验证方法:
  1. grep A6 代码中的 import
  2. 验证 A6 import 了已有的 decision-trace / recovery / spawn / logistics / threat / capability
  3. 验证 A6 没有重新实现这些系统
  4. 验证 A6 只读消费这些系统的输出

通过条件: 0 个重复实现
```

### INT-014: Learning 走 safeRun

```
A6 所有系统走 safeRun

验证方法:
  1. 检查 A6 所有系统的注册
  2. 验证都在 safeRun 或 Kernel 的 System 注册框架内
  3. 模拟 A6 系统抛错
  4. 验证错误不传播到其他系统
  5. 验证连续失败 3 次进入冷却

通过条件: 错误隔离 + 冷却机制生效
```

### INT-015: A6 完全停止时帝国安全运行

```
A6 完全停止时帝国照常安全运行

验证方法:
  1. 禁用所有 A6 系统（从 bootstrap 注释掉）
  2. 运行帝国 5000 tick
  3. 验证帝国正常运转（生存 + 经济 + 防御）
  4. 验证 A4/A5 系统不受影响
  5. 验证无报错/异常

通过条件: 5000 tick 无异常
```

### INT-016: CPU 预算不超标

```
A6 CPU 占比 ≤ 3%

验证方法:
  1. 运行帝国 10000 tick
  2. 从遥测统计 A6 系统的 CPU 消耗
  3. 计算占总 CPU 的比例
  4. 验证 ≤ 3%

通过条件: A6 CPU ≤ 3%
```

### INT-017: Shadow Intelligence 安全评估

```
Shadow Strategy 不直接执行

验证方法:
  1. 产生一个 Shadow Strategy
  2. 检查 Shadow 评估过程
  3. 验证 Shadow 没有调用任何 Game API
  4. 验证 Shadow 没有修改任何运行时状态
  5. 验证 Shadow 只产出 ShadowEvaluation DTO

通过条件: 0 个 Game API 调用，0 个状态修改
```

### INT-018: 置信度标注

```
所有 Pattern / Prediction / Recommendation 都有置信度

验证方法:
  1. 检查所有 PatternRecord
  2. 验证有 confidence 字段 (0-1)
  3. 检查所有 Prediction
  4. 验证有 confidence 字段
  5. 检查所有 Recommendation
  6. 验证有 confidence 字段
  7. 验证低置信度的输出不直接影响策略

通过条件: 100% 的输出有置信度标注
```

---

## 二、验收标准汇总

| ID | 验收项 | 阶段 | 通过条件 |
|----|--------|------|---------|
| INT-001 | 完整 Experience 记录 | A6.1 | 存在完整 ExperienceRecord |
| INT-002 | Fact/Inference/Prediction 区分 | A6.7 | 三层严格分离 |
| INT-003 | 经济瓶颈识别 | A6.3 | 多维 StrategyScore 识别瓶颈 |
| INT-004 | 决策结果识别 | A6.1 | 能从已有系统采集 Outcome |
| INT-005 | 策略效果评价 | A6.3 | 多维评估，无万能分数 |
| INT-006 | 生成 Recommendation | A6.6 | 可解释的 Recommendation DTO |
| INT-007 | Recommendation 不直接执行 | A6.6 | 0 个 Game API 调用 |
| INT-008 | Deterministic Replay | 全阶段 | 1000 次 Replay hash 一致 |
| INT-009 | Memory 有界 | A6.2 | 100K tick 后 ≤ 500KB |
| INT-010 | 不进入 tick critical path | 全阶段 | interval ≥ 100, P3+ |
| INT-011 | 不破坏 A5 | 全阶段 | A5 代码 0 修改 |
| INT-012 | 可以 Rollback | A6.6 | 自动回滚 + 标记失效 |
| INT-013 | 不建立第二套系统 | 全阶段 | 0 个重复实现 |
| INT-014 | 走 safeRun | 全阶段 | 错误隔离 + 冷却 |
| INT-015 | A6 停止时帝国安全 | 全阶段 | 5000 tick 无异常 |
| INT-016 | CPU ≤ 3% | 全阶段 | 遥测验证 |
| INT-017 | Shadow 不直接执行 | A6.5 | 0 个 Game API |
| INT-018 | 置信度标注 | 全阶段 | 100% 有 confidence |

---

## 三、各阶段对应验收

| 阶段 | 主要验收项 |
|------|-----------|
| A6.1 Experience | INT-001, INT-004, INT-008, INT-013, INT-014 |
| A6.2 Memory | INT-009, INT-010, INT-014 |
| A6.3 Evaluation | INT-003, INT-005, INT-008, INT-018 |
| A6.4 Prediction | INT-008, INT-018 |
| A6.5 Shadow | INT-007, INT-017 |
| A6.6 Adaptive | INT-006, INT-007, INT-012 |
| 全阶段 | INT-010, INT-011, INT-014, INT-015, INT-016 |
| A6.7 Player Intel | INT-002 |
