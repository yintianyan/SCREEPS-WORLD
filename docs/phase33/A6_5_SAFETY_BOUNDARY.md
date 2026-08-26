# A6.5 Safety Boundary — 安全边界与隔离约束

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做安全边界研究，不修改任何代码  
> **基线**: A6.1-A6.4 已冻结契约 + 真实守卫代码审计

---

## 一、核心安全原则：Shadow-Only

### 1.1 定义

A6.5 继承 A6.1-A6.4 的 Shadow-Only 原则，并将其扩展为更严格的隔离约束：

**Shadow-Only = 只观察、只评估、只聚合、只暴露**

- **只观察**: 读取 A6.1-A6.4 既有数据源（Ring Buffer / globalCache）
- **只评估**: 对已有数据进行 Regime 分区、时效分析、冲突检测
- **只聚合**: 将分散在各子系统的数据聚合为 IntelligenceState
- **只暴露**: 将 IntelligenceState 暴露给可观测性层和未来的 A6.6

**禁止**: 决策、执行、修改、采样、创建

### 1.2 Shadow-Only 的形式化表达

```
A6.5 允许的操作:
  read(A6_1..A6_4_data) → compute → project(IntelligenceState)

A6.5 禁止的操作:
  write(A6_1..A6_4_data)       ← 不修改上游数据
  write(Memory.kernel.*)       ← 不修改策略
  write(Spawn/Construction)     ← 不修改执行
  create(RingBuffer/TimeSeries) ← 不新建数据源
  execute(Game API)             ← 不执行游戏操作
```

### 1.3 与 A6.4 CAL-001 的对比

| 维度 | A6.4 CAL-001 | A6.5 REL-001（拟） |
|------|-------------|-------------------|
| 写入目标 | `__calibrationCache` 唯一 | **无写入目标** — 只读投影 |
| 数据来源 | A6.3 Prediction + Observation | A6.1-A6.4 全部 Ring Buffer |
| 执行频率 | 每 500t | 每 500t（拟） |
| 输出 | ResolutionResult / Profile | IntelligenceState（非持久化） |
| 修改上游 | ❌ | ❌ |
| 修改策略 | ❌ | ❌ |

**关键区别**: A6.4 写入 `__calibrationCache`（它自己的 cache），A6.5 **不写入任何 cache**。IntelligenceState 是只读投影，每次运行时从既有数据重新计算，不持久化。

---

## 二、A6.5 Guard 定义（拟）

### 2.1 REL-XXX 守卫体系

A6.5 应建立自己的守卫体系，复用 A6.3/A6.4 的 GuardResult 类型：

| Guard ID | 名称 | 检查内容 | 失败处理 |
|----------|------|---------|---------|
| REL-001 | Read-Only | A6.5 不写入任何 cache | console.log 告警 |
| REL-002 | Domain Purity | Domain 函数不引用 Game/Memory | 编译/测试时发现 |
| REL-003 | No Game API | 不调用 Game API | safeRun 隔离 |
| REL-004 | No Runtime Mutation | 不修改任何运行时状态 | console.log 告警 |
| REL-005 | Deterministic | 相同输入 → 相同输出 | 测试失败 |
| REL-006 | Bounded Memory | IntelligenceState 不持久化 | console.log 告警 |
| REL-007 | No New Sampler | 不新建采样通道 | 启动检查 |
| REL-008 | No Second Metrics | 不采集新 Metrics | console.log 告警 |
| REL-009 | No Strategy Mutation | 不修改 Strategy/Posture/Spawn | safeRun 隔离 |
| REL-010 | Evidence Traceability | IntelligenceState 可追溯到上游数据 | 丢弃无追溯结果 |
| REL-011 | No Conflict Resolution | 不裁决预测冲突 | console.log 告警 |
| REL-012 | No Reliability Score | 不产出单一 reliability 分数 | console.log 告警 |

### 2.2 与 A6.4 CAL 守卫的对比

| 维度 | A6.4 CAL | A6.5 REL |
|------|---------|---------|
| 守卫数量 | 10 (CAL-001 ~ CAL-010) | 12 (REL-001 ~ REL-012) |
| 新增 | — | REL-011 (No Conflict Resolution) |
| 新增 | — | REL-012 (No Reliability Score) |
| 更严格 | CAL-001: 写入唯一 cache | REL-001: 不写入任何 cache |
| 复用 | A6.3 GuardResult 类型 | A6.3 GuardResult 类型 |
| 纯函数 | ✅ | ✅ |

### 2.3 REL-001 vs CAL-001 — 关键差异

CAL-001 允许 A6.4 写入 `__calibrationCache`（它是 A6.4 自己的存储）。

REL-001 **禁止 A6.5 写入任何 cache**。原因：

1. A6.5 的输出（IntelligenceState）是实时聚合视图，不需要持久化
2. 持久化 IntelligenceState 会导致"第二套状态"问题
3. IntelligenceState 的所有输入数据已经在 A6.1-A6.4 的 Ring Buffer 中持久化
4. 每次需要时重新计算比维护一致性更安全

### 2.4 REL-011: No Conflict Resolution

**新增原因**: A6.5 的冲突检测（A6_5_CONFLICT_ANALYSIS.md）容易演变为冲突解决。

**守卫检查**: 验证 A6.5 的 run 函数不包含选择、降权、过滤冲突预测的代码。

```typescript
// 概念设计（非实现）
function guardRelNoConflictResolution(system: System): GuardResult {
  const runSrc = system.run?.toString() ?? "";
  const forbidden = [
    "selectHighest",
    "applyWeight",
    "filterConflict",
    "resolveConflict",
    "dismissConflict",
  ];
  for (const pattern of forbidden) {
    if (runSrc.includes(pattern)) {
      return {
        guardId: "REL-011",
        passed: false,
        message: `No Conflict Resolution violation: run() contains ${pattern}`,
      };
    }
  }
  return { guardId: "REL-011", passed: true, message: "" };
}
```

### 2.5 REL-012: No Reliability Score

**新增原因**: Reliability 最容易退化为单一分数（如 "model reliability = 0.75"）。

**守卫检查**: 验证 A6.5 不产出 `number` 类型的 `reliabilityScore` 字段。

```typescript
// 概念设计（非实现）
function guardRelNoReliabilityScore(state: unknown): GuardResult {
  const src = JSON.stringify(state);
  if (src.includes("reliabilityScore")) {
    return {
      guardId: "REL-012",
      passed: false,
      message: "No Reliability Score violation: found 'reliabilityScore' field",
    };
  }
  return { guardId: "REL-012", passed: true, message: "" };
}
```

---

## 三、写入隔离矩阵

### 3.1 A6.5 对各系统的写入权限

| 目标 | A6.1 Experience | A6.2 Evaluation | A6.3 Prediction | A6.4 Calibration | Memory.kernel | Spawn/Construction |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **A6.5** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**全部禁止**。A6.5 是纯只读消费者。

### 3.2 A6.5 对各系统的读取权限

| 来源 | A6.1 Experience | A6.2 Evaluation | A6.3 Prediction | A6.4 Calibration | globalCache | EmpireHealth |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **A6.5** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**全部只读**。

### 3.3 对比 A6.4 的权限矩阵

| 来源 → 目标 | A6.1 | A6.2 | A6.3 | A6.4 |
|-------------|------|------|------|------|
| A6.1 → A6.2 | — | ✅读 | — | — |
| A6.2 → A6.3 | — | — | — | — |
| A6.3 → A6.4 | — | — | ✅读 | — |
| A6.4 → A6.5 | — | — | — | ✅读 |

A6.5 是链条末端，只消费不产出数据给上游。

---

## 四、IntelligenceState 的安全约束

### 4.1 不持久化原则

**原则**: IntelligenceState 不写入 globalCache，不写入 Memory，不写入 RawMemory。

**理由**:
1. IntelligenceState 是多个数据源的实时聚合投影
2. 持久化会创建"第二套状态"，引入一致性维护成本
3. 上游数据变化时，持久化的 IntelligenceState 会变为 stale
4. 每次运行时重新计算 < 1 ops/t（见 A6_5_RELIABILITY_ARCHITECTURE.md §七）

**实现方式**: IntelligenceState 作为函数返回值暴露，由调用方（可观测性 / A6.6）持有引用，生命周期 = 1 tick。

### 4.2 不缓存原则

**原则**: A6.5 不维护自己的缓存。每次调用都从既有 Ring Buffer 重新计算。

**例外**: 如果 `computeCalibrationProfile()` 调用成本过高（> 1 ops/t），可以缓存 Profile 的引用，但**不缓存 IntelligenceState 本身**。

**Profile 缓存条件**:
- 只读引用 A6.4 的 `CalibrationRingBuffer.profiles` Map
- 不复制 Profile 数据
- 不修改 Profile 数据
- 如果 Profile 被上游更新，引用自动看到新值

### 4.3 确定性原则

**原则**: 相同输入 → 相同 IntelligenceState。

**实现**:
1. 所有遍历按 predictionId / resolutionHash 排序
2. 浮点结果用 `toFixed(6)` 截断（复用 A6.3 `stableStringify`）
3. `stateHash` 使用 `stableStringify + fnv1a32Hex`
4. 禁止 `Math.random` / `Date.now` / `Game.time`
5. 验证: 100× replay 检查 stateHash 一致

### 4.4 有界原则

**原则**: IntelligenceState 的内存占用有硬上限。

| 组成部分 | 上限 | 理由 |
|---------|------|------|
| `modelReliability[]` | ≤ 10 条（模型数） | 每模型一条 |
| `predictionConflicts[]` | ≤ 5 条 | 互斥对 ≤ C(10,2)=45 但实际规则 ≤ 5 |
| `uncertainty.sources[]` | ≤ 5 条 | 5 种不确定性来源 |
| `knowledgeFreshness.sources[]` | ≤ 10 条 | 每数据源一条 |
| 总计 | ≤ 2KB | 只读投影，不持久化 |

---

## 五、退化防护 — 防止 A6.5 变质

### 5.1 退化路径分析

A6.5 最容易沿以下路径变质为"第二套 Strategy":

```
Reliability Assessment
  → "这个模型不可靠，应该降权"      ← 退化 1: 权重裁决
  → "冲突检测发现矛盾，应该取消扩张"  ← 退化 2: 冲突解决
  → "Intelligence 整体恶化，应该收缩"  ← 退化 3: 策略决策
  → "这个 Regime 下模型不准，应该用另一个" ← 退化 4: 模型选择
  → "reliability = 0.75，低于阈值"    ← 退化 5: 万能分数
```

### 5.2 退化防护守卫

| 退化路径 | 守卫 | 检查方式 |
|---------|------|---------|
| 退化 1: 权重裁决 | REL-011 | 禁止 `applyWeight` / `downgrade` |
| 退化 2: 冲突解决 | REL-011 | 禁止 `resolveConflict` / `selectHighest` |
| 退化 3: 策略决策 | REL-009 | 禁止修改 Strategy/Posture |
| 退化 4: 模型选择 | REL-008 | 禁止新建模型 / 切换模型 |
| 退化 5: 万能分数 | REL-012 | 禁止 `reliabilityScore` 字段 |

### 5.3 边界声明

**A6.5 的职责边界**:

| 职责 | A6.5 | A6.6（未来） |
|------|------|-------------|
| 检测模型可靠性 | ✅ | — |
| 检测预测冲突 | ✅ | — |
| 聚合 IntelligenceState | ✅ | — |
| 暴露 IntelligenceState | ✅ | — |
| 基于 reliability 降权 | ❌ | ✅ |
| 解决冲突 | ❌ | ✅ |
| 产出策略建议 | ❌ | ✅ |
| 选择使用哪个模型 | ❌ | ✅ |

---

## 六、System 层安全约束

### 6.1 System 层职责

A6.5 的 System 层（拟命名 `intelligence-state-system`）职责：

| 职责 | 允许 | 禁止 |
|------|------|------|
| 从 globalCache 读取 A6.1-A6.4 数据 | ✅ | ❌ 直接调用 Game API |
| 调用 Domain 纯函数计算 IntelligenceState | ✅ | ❌ 在 System 层做计算 |
| 将 IntelligenceState 返回 / 暴露 | ✅ | ❌ 写入 globalCache |
| console.log observability | ✅ | ❌ 修改 Memory |
| 运行 REL-XXX 守卫检查 | ✅ | ❌ 跳过守卫 |

### 6.2 System 层不写入

**关键约束**: A6.5 的 System 层是**第一个不写入任何 cache 的 System**。

对比：

| System | 写入目标 |
|--------|---------|
| experience-collector-system | `__experienceCache` |
| strategy-evaluation-system | `__evaluationCache` |
| prediction-system | `__predictionCache` |
| calibration-resolution-system | `__calibrationCache` |
| **intelligence-state-system（拟）** | **无** |

A6.5 的 System 层 `run()` 函数：
1. 读取 A6.1-A6.4 的 Ring Buffer 数据
2. 调用 Domain 纯函数计算 IntelligenceState
3. 将 IntelligenceState 存入**局部变量**或直接 `console.log`
4. 不写入 globalCache

### 6.3 bootstrap.ts 注册

```typescript
// 概念设计（非实现）
// bootstrap.ts
import { intelligenceStateSystem } from "./systems/intelligence/intelligence-state-system";

// 在 systems 注册区域添加
systems.push(intelligenceStateSystem);
```

**约束**: 
- 优先级 P3（post phase）
- interval: 500t（与 calibration-resolution-system 同频）
- 必须在 calibration-resolution-system 之后运行（依赖最新 calibration 数据）

### 6.4 运行顺序约束

```
tick N:
  P0: kernel + creeps + spawn + construction
  P1: empire-health (100t)
  P2: experience-collector + strategy-evaluation
  P2: prediction-system
  P3: calibration-resolution-system (500t)
  P3: intelligence-state-system (500t)  ← 在 calibration 之后
```

**为什么在 calibration 之后**: A6.5 需要 A6.4 的最新 CalibrationProfile 来计算 reliability。如果 A6.5 在 A6.4 之前运行，会使用上一轮的 stale Profile。

---

## 七、数据流安全

### 7.1 输入安全

A6.5 的输入全部来自 A6.1-A6.4 的已有数据源：

| 输入 | 来源 | 读取方式 | 修改？ |
|------|------|---------|--------|
| ExperienceRecord[] | `__experienceCache` | 只读 | ❌ |
| StrategyEvaluation[] | `__evaluationCache` | 只读 | ❌ |
| Prediction[] | `__predictionCache` | 只读 | ❌ |
| ResolutionResult[] | `__calibrationCache.resolutionRecords` | 只读 | ❌ |
| ModelCalibrationProfile[] | `__calibrationCache.profiles` | 只读 | ❌ |
| ModelFailureStats[] | `__calibrationCache.failureStats` | 只读 | ❌ |
| EmpireHealth | globalCache | 只读 | ❌ |
| PredictionContext | 临时构造（从 globalCache 读取） | 只读 | ❌ |

### 7.2 输出安全

A6.5 的输出是 IntelligenceState，但它**不写入任何存储**：

| 输出 | 目标 | 写入方式 |
|------|------|---------|
| IntelligenceState | 局部变量 / 函数返回值 | 不持久化 |
| console.log | 可观测性 | 不影响状态 |
| REL-XXX 守卫违规 | console.log | 不影响状态 |

### 7.3 不可修改清单

| 不可修改 | 属于 | A6.5 操作 |
|---------|------|----------|
| `__experienceCache` | A6.1 | 只读 |
| `__evaluationCache` | A6.2 | 只读 |
| `__predictionCache` | A6.3 | 只读 |
| `__calibrationCache` | A6.4 | 只读 |
| `Memory.kernel.strategy` | Strategy | 不引用 |
| `Memory.kernel.posture` | Posture | 不引用 |
| 任何 Spawn 请求 | Spawn | 不引用 |
| 任何 ConstructionSite | Construction | 不引用 |
| 任何 Creep 行为 | Creeps | 不引用 |

---

## 八、错误处理

### 8.1 A6.5 的错误不影响运行时

**原则**: A6.5 的任何错误不得中断 tick 执行。

**实现**: A6.5 的 System 层必须走 `safeRun` 隔离。

**与 A6.4 一致**: CAL 守卫违规时 `console.log` 告警但不中断执行。A6.5 的 REL 守卫同理。

### 8.2 降级路径

| 错误场景 | 降级行为 |
|---------|---------|
| A6.4 CalibrationCache 为空 | IntelligenceState 标注 `dataSufficiency.insufficient = true` |
| A6.3 PredictionCache 为空 | IntelligenceState 标注 `predictionCoverage.covered = 0` |
| A6.4 Profile 计算失败 | 使用 fallback INSUFFICIENT_DATA |
| Regime Profile 样本不足 | 回退到全局 Profile（见 A6_5_RELIABILITY_ARCHITECTURE.md §二.3） |
| Conflict Detection 失败 | `predictionConflicts = []`（空数组，不中断） |
| IntelligenceState 计算失败 | 不产出 IntelligenceState，console.log 告警 |

### 8.3 冷启动行为

Global reset 后，A6.1-A6.4 的 Ring Buffer 全部为空。A6.5 的行为：

| 条件 | IntelligenceState | console.log |
|------|-------------------|-------------|
| 所有 Ring Buffer 空 | 全部 INSUFFICIENT_DATA | "IntelligenceState: cold start, no data" |
| 部分 Ring Buffer 有数据 | 部分维度有值，其余 INSUFFICIENT_DATA | "IntelligenceState: partial data" |
| 全部 Ring Buffer 有数据 | 正常计算 | 无 |

**关键**: 冷启动时不伪造 IntelligenceState。如果数据不足，标注 INSUFFICIENT_DATA。

---

## 九、与 A6.4 安全约束的继承关系

### 9.1 继承的约束

A6.5 继承 A6.4 的以下安全约束：

| A6.4 约束 | A6.5 继承方式 |
|-----------|-------------|
| CAL-002 Domain Purity | REL-002: 同样检查 |
| CAL-003 No Game API | REL-003: 同样检查 |
| CAL-004 No Runtime Mutation | REL-004: 更严格（不修改上游数据） |
| CAL-005 Deterministic | REL-005: 同样检查 |
| CAL-007 No New Sampler | REL-007: 同样检查 |
| CAL-008 No Second Metrics | REL-008: 同样检查 |
| CAL-009 No Strategy Mutation | REL-009: 同样检查 |
| CAL-010 Evidence Traceability | REL-010: 扩展到 IntelligenceState |

### 9.2 更严格的约束

| 约束 | A6.4 | A6.5 | 更严格之处 |
|------|------|------|-----------|
| 写入 | CAL-001: 写入唯一 cache | REL-001: 不写入任何 cache | 从"限制写入目标"到"禁止写入" |
| 退化 | CAL-008: 不建万能 metric | REL-012: 不建万能 reliability score | 从"不建 metric"到"不建 score" |
| 冲突 | — | REL-011: 不解决冲突 | 新增约束 |

### 9.3 不继承的约束

| A6.4 约束 | A6.5 不适用 | 原因 |
|-----------|------------|------|
| CAL-006 Bounded Memory | A6.5 不维护 Ring Buffer | IntelligenceState 不持久化 |

A6.5 的内存约束由 §四.4 的 IntelligenceState 有界原则覆盖。

---

## 十、审计清单

### 10.1 实现前审计

在实现 A6.5 之前，必须验证：

- [ ] A6.1-A6.4 的所有 Ring Buffer 可被只读访问
- [ ] A6.4 的 `CalibrationRingBuffer.profiles` 可被只读访问
- [ ] A6.3 的 `PredictionRingBuffer` 可被只读访问
- [ ] `stableStringify` / `fnv1a32Hex` 可被 A6.5 复用
- [ ] `buildPredictionContextSignature` 可被 A6.5 复用
- [ ] `GuardResult` 类型可被 A6.5 复用

### 10.2 实现后审计

实现 A6.5 后，必须验证：

- [ ] REL-001: A6.5 的 System 层 run() 不包含任何写入 globalCache 的代码
- [ ] REL-005: IntelligenceState 的 stateHash 在 100× replay 中一致
- [ ] REL-009: A6.5 的 System 层 run() 不包含修改 Strategy/Posture 的代码
- [ ] REL-011: A6.5 的代码不包含冲突解决逻辑
- [ ] REL-012: IntelligenceState 不包含 `reliabilityScore` 字段
- [ ] A6.5 的 Domain 层不引用 `Game` / `Memory` / `RawMemory`
- [ ] A6.5 的 System 层走 `safeRun` 隔离
- [ ] A6.5 的 System 层优先级为 P3

### 10.3 持续审计

每次 A6.5 代码变更后：

- [ ] `npm run typecheck` 全绿
- [ ] `npm test` 全绿
- [ ] `npm run build` 全绿
- [ ] REL 守卫测试全绿
- [ ] 确定性回放测试全绿
