# A6.0 — Learning Safety Boundary

> **阶段**: A6.0 Research / Architecture
> **日期**: 2026-08-25
> **约束**: 纯研究，不实现代码

---

## 一、最高优先级：Learning 不能直接 mutate execution authority

### 1.1 核心原则

```
Learning 是: Observer / Evaluator / Recommender
Learning 不是: Executor
```

### 1.2 禁止路径（绝对红线）

```
绝对禁止:
  LearningSystem → Game API (spawnCreep / attack / move / transfer / build)
  LearningSystem → Spawn Manager
  LearningSystem → Logistics Planner
  LearningSystem → Tactical Runtime
  LearningSystem → Recovery Execution
  LearningSystem → 直接修改 Strategy (posture / warPlan / expansionPlan)
  LearningSystem → 直接修改 Memory 中 Runtime State
  LearningSystem → 直接修改 DecisionTrace
  LearningSystem → 直接修改 EventLog
```

### 1.3 允许路径

```
允许:
  Learning → Recommendation → Validation Gate → tuning 覆盖层
  Learning → 只读消费 DecisionTrace / EventLog / EmpireHealth
  Learning → 只写 RawMemory segment（冷数据）
  Learning → 通过 event-log 的 recordEvent 记录自身事件（只追加，不修改）
```

---

## 二、Learning 与 Execution 的权责边界

### 2.1 架构图

```
┌─────────────────────────────────────────────┐
│  Learning Layer (A6)                         │
│                                              │
│  Experience → Pattern → Prediction →         │
│  Strategy Evaluation → Recommendation        │
│                                              │
│  输出: Recommendation DTO                     │
│  权限: Observer / Evaluator / Recommender    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Validation Gate (Safety Boundary)            │
│                                               │
│  1. 白名单校验（只允许 tuning 覆盖层参数）     │
│  2. 值域校验（不超过 floor/ceiling）           │
│  3. 统计窗口约束（不短于评估窗口）              │
│  4. Canary 生效（先作用于可观测子集）          │
│  5. 自动回滚（观察窗口内指标恶化即回退）       │
│  6. 策略版本校验（modelVersion 兼容）         │
│  7. 恢复档禁止（Recovery/Conserve 档不生效）  │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Existing Execution Layer (A4/A5, 不动)        │
│                                               │
│  tuning 覆盖层 → CONFIG 参数读取               │
│  posture → Strategy 决策                      │
│  war-planning → WarPlan                       │
│  spawn-manager → spawnCreep                   │
│  logistics-planner → TransportPlan            │
│  tactical-runtime → TacticalDecision          │
│  recovery-execution → RecoveryAction          │
│                                               │
│  权限: Executor                                │
└──────────────────────────────────────────────┘
```

### 2.2 权责矩阵

| 能力 | Learning (A6) | Execution (A4/A5) |
|------|---------------|-------------------|
| 读 Game 对象 | ❌ | ✅ |
| 读 Memory | ❌（只读 segment） | ✅ |
| 写 Memory | ❌ | ✅（各自字段） |
| 写 segment | ✅（冷数据） | ✅（各自 segment） |
| 调用 Game API | ❌ | ✅ |
| 修改 Strategy | ❌ | ✅ |
| 修改参数 | ⚠️ 通过 tuning 覆盖层 | ✅（读取参数） |
| 产出 Decision | ❌ | ✅ |
| 产出 Recommendation | ✅ | ❌（不产出建议） |
| 产出 Experience | ✅ | ❌ |
| 产出 Pattern | ✅ | ❌ |
| 产出 Prediction | ✅ | ❌ |

---

## 三、Validation Gate 详细设计

### 3.1 白名单合同

只有以下参数允许被 Recommendation 影响：

```typescript
const RECOMMENDATION_WHITELIST = {
  // ── tuning 覆盖层参数（已有机制）──
  "hauler.maxCount": true,
  "hauler.minCount": true,
  "harvester.maxCount": true,
  "upgrader.maxCount": true,
  "builder.maxCount": true,

  // ── A6 新增可调参数（需在 TUNING_BOUNDS 中注册）──
  "war.squadSizeMultiplier": true,      // 编队规模系数
  "war.healerRatio": true,              // healer 比例
  "defense.towerPriorityWeight": true,  // 塔优先级权重
  "expansion.riskThreshold": true,      // 扩张风险阈值
  "economy.reserveThreshold": true,     // 储备阈值
} as const;
```

**非白名单参数的 Recommendation 自动拒绝**。

### 3.2 值域校验

```typescript
function validateValue(
  param: string,
  newValue: number,
  bounds: ParamBounds,
): boolean {
  if (newValue < bounds.floor || newValue > bounds.ceiling) {
    return false;  // 超出安全边界
  }
  return true;
}
```

### 3.3 统计窗口约束

```
调整周期 ≥ 统计窗口
```

防止噪声驱动调参。例：
- 评估窗口 500 tick → 参数调整间隔不短于 500 tick
- 评估窗口 1000 tick → 参数调整间隔不短于 1000 tick

### 3.4 Canary 生效

新建议不立即全局生效，先在小范围试用：

```
1. Recommendation 通过 Validation Gate
2. 在 1 个房间（或 1 个子集）试用 N tick
3. 观察 N tick 后指标是否改善
4. 改善 → 推广到全局
5. 恶化 → 回滚 + 标记 INVALIDATED
```

### 3.5 自动回滚

```typescript
interface RollbackPolicy {
  /** 观察窗口（tick 数） */
  observationWindow: number;     // 默认 1500 tick
  /** 改善阈值 */
  improvementThreshold: number;  // 默认 0.05 (5%)
  /** 恶化阈值 */
  deteriorationThreshold: number; // 默认 -0.05 (-5%)
  /** 回滚动作 */
  rollbackAction: "revert_to_pre_adjust" | "revert_to_config_default";
}
```

回滚触发条件（任一满足即回滚）：
1. 观察窗口内指标恶化超过阈值
2. 观察窗口内指标未改善（在容差范围内）
3. 触发护栏（如 spawnFillRatio 跌破 0.5）
4. 帝国进入 Recovery 档

### 3.6 策略版本校验

```typescript
interface Recommendation {
  modelVersion: number;  // 产出此建议的模型版本
  // ...
}

function validateModelVersion(
  recommendation: Recommendation,
  currentVersion: number,
): boolean {
  return recommendation.modelVersion === currentVersion;
}
```

版本不匹配 → 拒绝建议（防止旧模型建议影响新版本帝国）。

### 3.7 恢复档禁止

```
if (cpuTier == "recovery" || cpuTier == "conserve") {
  // A6 系统全部停止
  // 不产出 Recommendation
  // 不执行 Validation Gate
  // 不调整任何参数
}
```

---

## 四、Learning Determinism Contract

### 4.1 确定性要求

```
同一 Experience 输入 + 同一模型版本 + 同一参数集
→ 同一 Recommendation
→ 同一 Pattern Detection 结果
→ 同一 Strategy Evaluation 结果
→ 同一 Prediction
```

### 4.2 禁止的非确定性来源

| 非确定性来源 | 禁止位置 | 替代方案 |
|-------------|---------|---------|
| `Math.random()` | 所有 A6 纯函数 | 确定性 hash (FNV-1a) |
| `Date.now()` | 所有 A6 纯函数 | `Game.time` |
| 浮点误差 | 统计计算 | `toFixed(3)` 固定精度 |
| 无序迭代 | Pattern Detection | 排序后数组 |
| 跨 tick mutation | 纯函数输入 | 完整注入（不依赖全局可变状态） |
| `Map` 迭代顺序 | 统计聚合 | 排序后 `Array.from()` |
| `Object.keys()` 顺序 | 序列化 | `stableStringify()` |

### 4.3 Replay 验证

A6 的纯函数可以通过 DecisionTrace 的 Replay 机制验证：

```typescript
// 同一 Experience[] 输入 → 同一 Pattern[] 输出
function verifyPatternDeterminism(
  experiences: ExperienceRecord[],
  iterations: number = 1000,
): { deterministic: boolean; hashes: string[] } {
  const hashes: string[] = [];
  for (let i = 0; i < iterations; i++) {
    const patterns = detectPatterns(experiences);
    hashes.push(patternHash(patterns));
  }
  return {
    deterministic: hashes.every(h => h === hashes[0]),
    hashes,
  };
}
```

---

## 五、CPU Architecture

### 5.1 Learning 不应该进入 1 tick critical path

| 任务 | 频率 | CPU 预算 | 是否进 tick |
|------|------|---------|------------|
| Experience 记录 | 事件驱动 | < 0.1 CPU | ✅（近零成本） |
| Experience 写 segment | 每 100 tick | < 0.5 CPU | ✅（低频） |
| Pattern Detection | 每 500 tick | < 1 CPU | ✅（低频） |
| Strategy Evaluation | 每 1000 tick | < 2 CPU | ✅（低频） |
| Prediction | 每 500 tick | < 1 CPU | ✅（低频） |
| Recommendation | 每 500 tick | < 0.5 CPU | ✅（低频） |
| Validation Gate | 同 Recommendation | < 0.1 CPU | ✅（近零） |
| Counterfactual Simulation | 手动触发 | 不限 | ❌（不进 tick） |
| Pattern Deep Analysis | 手动触发 | 不限 | ❌（不进 tick） |

### 5.2 在线 vs 批处理 vs 增量

| 任务 | 模式 | 理由 |
|------|------|------|
| Experience 记录 | online（事件驱动） | 近零成本，事件发生时即时记录 |
| Experience 写 segment | batch（每 100 tick flush） | 段写入有异步语义，需批量 |
| Pattern Detection | incremental（增量更新） | 不全量重算，只处理新 Experience |
| Strategy Evaluation | batch（全量评估） | 需要完整窗口数据 |
| Prediction | incremental | 从上次预测结果增量更新 |
| Recommendation | batch | 综合多个输入一次性产出 |
| Player Modeling | batch | 低频，数据量小 |
| Counterfactual | offline / external | 不进 tick |

### 5.3 CPU 预算分配

```
A6 总 CPU 预算 ≤ 帝国 CPU 的 2-3%

分配:
  Experience Collection: 0.5%  (事件驱动 + 低频 flush)
  Pattern Detection:     0.5%  (每 500 tick)
  Strategy Evaluation:   0.5%  (每 1000 tick)
  Prediction:            0.3%  (每 500 tick)
  Recommendation:        0.2%  (每 500 tick)
  Validation Gate:       0.0%  (近零，内联在 Recommendation 中)
  ────────────────────────────
  Total:                 2.0%
```

Recovery 档下 A6 全部停止，CPU 优先给生存。

---

## 六、Memory Budget Model

### 6.1 每层预算（详见 A6_0_MEMORY_ARCHITECTURE.md）

| 层 | max entries | TTL | compression | GC | 存储层 |
|----|-------------|-----|-------------|-----|--------|
| Working Memory | 无限 | 1 tick | 无 | 自动 | heap |
| Episodic | 1000 | 10000t | 降采样 | 环形 | segment × 2 |
| Semantic | 333 | 永久 | 聚合 | 超容量合并 | segment × 1 |
| Strategic | 33 | 永久 | 只结论 | invalidated 清除 | 共用 semantic |
| Player | 50 | 月级 | 衰减权重 | TTL 清除 | 共用 intel-players |
| Combat | 200 | 10000t | 聚合 | 环形 | segment × 1 |

### 6.2 禁止无限历史

| 机制 | 用途 |
|------|------|
| Ring Buffer | 固定长度，新数据覆盖最旧 |
| TTL + GC | 超期数据自动清除 |
| 降采样 | 旧数据稀疏化 |
| 聚合统计 | 原始数据→统计量（EMA/分位数） |
| 容量上限 | 超容量时合并低置信度条目 |

---

## 七、Learning 系统的失败安全

### 7.1 safeRun 保护

A6 所有系统走 `safeRun`：
- 单点错误不中断整 tick
- 非关键连续失败 3 次进入冷却（50-200 tick）
- 相同错误每 25 tick 限频

### 7.2 降级路径

| 场景 | 降级动作 |
|------|---------|
| A6 系统出错 | safeRun 捕获，冷却期内跳过 |
| A6 数据不足 | confidence=0，不产出 Recommendation |
| A6 segment 不可读 | 回退到 heap only（不阻塞） |
| A6 Recommendation 被拒 | 记录拒绝原因，不影响帝国运行 |
| A6 参数回滚 | 回退到 pre-adjust 值或 CONFIG 默认 |
| 帝国进入 Recovery | A6 全停 |

### 7.3 安全不变式

```
A6 系统完全停止时，帝国必须照常安全运行。
A6 的任何故障不得影响 A4/A5 的执行。
A6 的任何参数修改都可以回滚到 CONFIG 默认值。
```

---

## 八、关键结论

1. **Learning 是 Observer / Evaluator / Recommender，不是 Executor**
2. **禁止 Learning 直接调用 Game API / 修改 Strategy / 修改 Memory Runtime State**
3. **Learning → Recommendation → Validation Gate → tuning 覆盖层** 是唯一允许的路径
4. **Validation Gate 有 7 道安全检查**（白名单/值域/窗口/canary/回滚/版本/恢复档）
5. **Learning Determinism Contract**：同输入+同模型+同参数→同输出
6. **禁止 6 种非确定性来源**（Math.random / Date.now / 浮点 / 无序迭代 / 跨 tick mutation / Map 迭代顺序）
7. **A6 CPU ≤ 2-3%**，Recovery 档全停
8. **A6 Memory 走 segment**，不进 Memory 主体，禁止无限历史
9. **A6 系统走 safeRun**，单点错误不中断整 tick
10. **A6 完全停止时帝国照常安全运行**
