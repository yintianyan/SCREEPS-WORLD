# A6.6 Safety Boundary — 安全边界与 Shadow-Only 约束

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码
> **基线**: A6.5 REL-001~012 守卫体系 + A6.0 冻结契约

---

## 一、Shadow-Only 定义

### 1.1 A6.6 的 Shadow-Only 扩展

A6.6 继承 A6.5 的 Shadow-Only 原则，并扩展为更严格的约束：

**Shadow-Only = 只观察、只消费、只建议、不执行、不决定、不修改**

| 允许 | 禁止 |
|------|------|
| 只读消费 A6.1–A6.5 数据 | 写入 A6.1–A6.5 任何 cache |
| 计算并产出 RecommendationCandidate | 修改 Memory |
| 写入 `__recommendationCache`（自身 bounded cache） | 修改 globalCache 业务字段 |
| console.log 可观测性输出 | 调用 Game API |
| 运行 REC-XXX 守卫检查 | 修改 Strategy / Posture / Spawn |
| | 提交任何执行请求 |
| | 修改 WarPlan / Agenda / Budget |

### 1.2 与 A6.5 REL-001 的对比

| 维度 | A6.5 REL-001 | A6.6 REC-001（拟） |
|------|-------------|-------------------|
| 写入目标 | **无** — 不写入任何 cache | `__recommendationCache`（唯一 bounded cache） |
| 数据来源 | A6.1–A6.4 Ring Buffer | A6.1–A6.5 全部 + IntelligenceState |
| 输出 | IntelligenceState（非持久化） | RecommendationCandidate[]（bounded cache） |
| 执行频率 | 每 500t | 每 500t（拟） |
| 修改上游 | ❌ | ❌ |
| 修改策略 | ❌ | ❌ |

**关键区别**: A6.5 不写入任何 cache（只读投影），A6.6 **写入自身 bounded cache**（`__recommendationCache`）。这是允许的，因为：
1. `__recommendationCache` 是 A6.6 自己的存储
2. 容量有界（≤ 50 条）
3. TTL + GC 自动淘汰
4. 无执行系统读取

---

## 二、REC-XXX 守卫体系

### 2.1 守卫列表

| Guard ID | 名称 | 检查内容 | 失败处理 |
|----------|------|---------|---------|
| REC-001 | Bounded Cache | `__recommendationCache` 有 capacity + GC | console.log 告警 |
| REC-002 | Domain Purity | Domain 函数不引用 Game/Memory | 编译/测试时发现 |
| REC-003 | No Game API | 不调用 Game API | safeRun 隔离 |
| REC-004 | No Runtime Mutation | 不修改任何运行时状态 | console.log 告警 |
| REC-005 | Deterministic | 相同输入 → 相同输出 | 测试失败 |
| REC-006 | No Execution Leak | 无执行系统 import A6.6 输出 | 编译时检测 |
| REC-007 | No Second Strategy | 不创建 Strategy/Policy/Posture/Directive | console.log 告警 |
| REC-008 | No Decision Authority | 不裁决冲突、不选择行动 | console.log 告警 |
| REC-009 | No Score | 不产出 recommendationScore | console.log 告警 |
| REC-010 | Evidence Traceability | 每条 Recommendation 有可追溯 Evidence | 丢弃无追溯结果 |
| REC-011 | No Auto Apply | `autoApply` 字段类型为 `false`（literal type） | 编译时强制 |
| REC-012 | No Unbounded History | Recommendation 历史有界 | console.log 告警 |
| REC-013 | TTL Enforcement | 每条 Recommendation 有 TTL | 丢弃无 TTL 结果 |
| REC-014 | No Math.random/Date.now | 确定性约束 | 测试失败 |

### 2.2 与 A6.5 REL 守卫的继承关系

| A6.5 REL | A6.6 REC | 继承方式 |
|-----------|---------|---------|
| REL-001 (Read-Only) | REC-001 (Bounded Cache) | 允许写入自身 cache |
| REL-002 (Domain Purity) | REC-002 | 同样检查 |
| REL-003 (No Game API) | REC-003 | 同样检查 |
| REL-004 (No Runtime Mutation) | REC-004 | 同样检查 |
| REL-005 (Deterministic) | REC-005 | 同样检查 |
| REL-009 (No Strategy Mutation) | REC-007 | 扩展为 No Second Strategy |
| REL-010 (Evidence Traceability) | REC-010 | 同样检查 |
| REL-011 (No Conflict Resolution) | REC-008 | 扩展为 No Decision Authority |
| REL-012 (No Reliability Score) | REC-009 | 改为 No Recommendation Score |

### 2.3 新增守卫

| 守卫 | 来源 | 新增理由 |
|------|------|---------|
| REC-006 (No Execution Leak) | 新增 | A6.6 产出 Recommendation 最容易被执行系统偷偷消费 |
| REC-011 (No Auto Apply) | 新增 | 从 A6.2 继承的 `autoApply: false` literal type |
| REC-012 (No Unbounded History) | 新增 | Recommendation 历史容易无限增长 |
| REC-013 (TTL Enforcement) | 新增 | 无 TTL 的 Recommendation 永不过期 |
| REC-014 (No Random) | 新增 | 确定性排序 |

---

## 三、RECOMMENDATION_CONSUMPTION_BOUNDARY

### 3.1 当前状态

**当前无任何执行系统读取 A6.6 的输出。**

### 3.2 隐式 Execution Path 检测

必须主动搜索以下路径：

| 搜索路径 | 当前状态 | 预期 |
|---------|---------|------|
| recommendation → strategy | 不存在 | 禁止 |
| recommendation → planner | 不存在 | 禁止 |
| recommendation → spawn | 不存在 | 禁止 |
| recommendation → military | 不存在 | 禁止 |
| recommendation → recovery | 不存在 | 禁止 |
| recommendation → logistics | 不存在 | 禁止 |
| recommendation → construction | 不存在 | 禁止 |
| recommendation → terminal | 不存在 | 禁止 |
| recommendation → economy | 不存在 | 禁止 |

### 3.3 未来接入设计

如果未来 A6.6 被接入执行系统：

```
A6.6 RecommendationCandidate[]
    ↓ (只读，通过查询 API)
Future Decision Authority Module（独立模块，不属 A6.6）
    ↓ 裁决：接受/拒绝/忽略
    ↓ 转译为执行系统合法输入
    ↓ 通过正式接口提交
    ↓
Existing Strategy / Planner / Spawn / Military / Logistics / Recovery
```

**A6.6 不在这个链路中执行任何操作。**

### 3.4 Consumption Boundary 守卫

```
// 概念设计（非实现）
function guardRecNoExecutionLeak(): GuardResult {
  // 搜索所有非 A6 模块是否 import 了 RecommendationCandidate
  const consumers = findImporters("RecommendationCandidate", "src/systems/");
  if (consumers.length > 0) {
    return {
      guardId: "REC-006",
      passed: false,
      message: `Execution systems importing A6.6 output: ${consumers.join(", ")}`,
    };
  }
  return { guardId: "REC-006", passed: true, message: "" };
}
```

---

## 四、退化防护

### 4.1 A6.6 最容易的退化路径

```
Recommendation Engine
  → "reliability 低，应该降权"           ← 退化 1: 权重裁决
  → "冲突检测发现矛盾，应该取消"          ← 退化 2: 冲突解决
  → "Intelligence 恶化，应该收缩"         ← 退化 3: 策略决策
  → "score > 0.8，应该执行"              ← 退化 4: 万能分数
  → "建议已产出，应该自动执行"            ← 退化 5: 隐式执行
  → "历史建议效果好，应该批量采纳"        ← 退化 6: 自主采纳
```

### 4.2 退化防护守卫

| 退化路径 | 守卫 | 检查方式 |
|---------|------|---------|
| 退化 1: 权重裁决 | REC-008 | 禁止 `applyWeight` / `downgrade` |
| 退化 2: 冲突解决 | REC-008 | 禁止 `resolveConflict` / `selectHighest` |
| 退化 3: 策略决策 | REC-007 | 禁止修改 Strategy/Posture |
| 退化 4: 万能分数 | REC-009 | 禁止 `recommendationScore` 字段 |
| 退化 5: 隐式执行 | REC-006 + REC-011 | 无执行系统 import + autoApply=false |
| 退化 6: 自主采纳 | REC-008 | 禁止 `acceptRecommendation` 自主调用 |

---

## 五、与 A6.0 冻结契约的一致性

### 5.1 A6.0 冻结契约要求

A6.0 要求 A6 整体 Shadow-Only：
- 不调用 Game API
- 不修改 Strategy
- 不修改 Posture
- 不修改 Spawn
- 不修改 Military
- 不修改 Logistics
- 不修改 Recovery
- 不修改 Economy
- 不发送执行命令

### 5.2 A6.6 遵守情况

| 要求 | A6.6 | 验证 |
|------|:----:|------|
| 不调用 Game API | ✅ | REC-003 |
| 不修改 Strategy | ✅ | REC-007 |
| 不修改 Posture | ✅ | REC-007 |
| 不修改 Spawn | ✅ | REC-004 |
| 不修改 Military | ✅ | REC-004 |
| 不修改 Logistics | ✅ | REC-004 |
| 不修改 Recovery | ✅ | REC-004 |
| 不修改 Economy | ✅ | REC-004 |
| 不发送执行命令 | ✅ | REC-003 + REC-006 |
| 输出只存在于 `__recommendationCache` | ✅ | REC-001 |

**A6.6 与 A6.0 冻结契约完全一致。**

---

## 六、System 层安全约束

### 6.1 System 层职责

| 职责 | 允许 | 禁止 |
|------|------|------|
| 从 globalCache / Ring Buffer 读取 A6.1–A6.5 数据 | ✅ | ❌ 直接调用 Game API |
| 调用 Domain 纯函数生成 Recommendation | ✅ | ❌ 在 System 层做计算 |
| 写入 `__recommendationCache` | ✅ | ❌ 写入其他 globalCache 字段 |
| 运行 REC-XXX 守卫检查 | ✅ | ❌ 跳过守卫 |
| console.log 可观测性 | ✅ | ❌ 修改 Memory |

### 6.2 bootstrap.ts 注册（拟）

```typescript
// 概念设计（非实现）
// bootstrap.ts
// 在 systems 注册区域添加
systems.push(recommendationEngineSystem);
// P3 post phase, interval=500t
```

### 6.3 运行顺序

```
tick N:
  P0: kernel + creeps + spawn + construction
  P1: empire-strategy + empire-economy + agenda + logistics
  P2: experience-collector + strategy-evaluation + prediction
  P3: calibration-resolution (500t)
  P3: intelligence-state (500t)
  P3: recommendation-engine (500t)  ← 在 intelligence-state 之后
```

**必须在 intelligence-state 之后**: A6.6 需要 A6.5 的 IntelligenceState 作为输入。

---

## 七、错误处理

### 7.1 A6.6 的错误不影响运行时

A6.6 的任何错误不得中断 tick 执行。System 层走 `safeRun` 隔离。

### 7.2 降级路径

| 错误场景 | 降级行为 |
|---------|---------|
| A6.5 IntelligenceState 不可用 | 使用 A6.3/A6.4 数据直接生成 |
| A6.3 PredictionCache 为空 | 标注 DATA_GAP，生成 NO_RECOMMENDATION |
| A6.4 CalibrationCache 为空 | 不修正 confidence（使用 raw confidence） |
| A6.1 ExperienceCache 为空 | 不使用历史经验，仅基于 Prediction |
| Evidence 构建失败 | 丢弃该 Recommendation |
| Recommendation 生成失败 | 不产出，console.log 告警 |
| 守卫违规 | console.log 告警，不产出 |

### 7.3 冷启动

Global reset 后：
- 所有 Ring Buffer 为空
- A6.6 不产出任何 Recommendation
- console.log: "Recommendation Engine: cold start, no data"
- 等待 A6.1–A6.5 积累数据

---

## 八、结论

**A6.6 是 Shadow-Only 层，不拥有 Decision Authority，不执行任何操作。**

核心原则：
1. 只读消费 A6.1–A6.5，只写自身 bounded cache
2. 无执行系统读取 A6.6 输出
3. 14 个 REC 守卫确保安全
4. 退化防护 6 条路径全覆盖
5. 与 A6.0 冻结契约完全一致
6. 错误不影响运行时
