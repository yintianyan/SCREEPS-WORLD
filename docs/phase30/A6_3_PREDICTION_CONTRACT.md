# A6.3.0 — Prediction Layer Contract

> **阶段**: A6.3.0 Research / Contract
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 定义预测层的架构守卫（PRED-XXX）、数据契约、安全约束、确定性要求

---

## 一、架构守卫（PRED-XXX）

> 以下守卫是**硬约束**，任何实现必须遵守。违反即评审否决。

### PRED-001: Shadow-Only

预测层是**纯观察者**，不执行任何 Game 写 API，不修改任何运行时状态。

| 条款 | 内容 |
|------|------|
| 禁止 | 调用任何 Game 写接口（`spawnCreep`、`createConstructionSite`、`moveTo`、`transfer`…） |
| 禁止 | 修改 Memory 运行时状态（posture、colonyState、spawn queue…） |
| 禁止 | 修改 globalCache 中任何非 `__predictionCache` 字段 |
| 禁止 | 修改 CONFIG 或 tuning 参数 |
| 允许 | 只读消费 globalCache 数据 |
| 允许 | 写入 `__predictionCache`（自身 Ring Buffer + 时间序列） |
| 允许 | 写入 RawMemory segment（低频持久化，仅限预测结果归档） |

**依据**: A6.0 `A6_0_SAFETY_BOUNDARY.md` §1（Observer/Evaluator/Recommender 三角色分离）；A5 `SYSTEM_BOUNDARIES.md` 系统边界。

### PRED-002: 不进入 tick 关键路径

| 条款 | 内容 |
|------|------|
| 频率 | 预测系统 cadence ≥ 500 tick（或复用 evaluation cadence） |
| 档位 | 预测系统走 P3 档位 |
| Recovery | Recovery 档下预测系统**全停**（看门狗档位 < Guarded 时跳过） |
| CPU 预算 | 单次预测运行 ≤ 0.5 CPU（不含 segment 读写） |
| 分片 | 单次运行超预算时按 cursor 分片跨 tick 顺延 |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §5.1；A5 `CPU_EXECUTION_MODEL.md` §2 档位×频带矩阵。

### PRED-003: 确定性

| 条款 | 内容 |
|------|------|
| 禁止 | `Math.random()` |
| 禁止 | `Date.now()` |
| 禁止 | 无序迭代（`Object.keys` 未排序、`Map` 未排序） |
| 必须 | 使用 `Game.time` 作为时间戳 |
| 必须 | 遍历前排序（`Array.sort((a,b) => a.id.localeCompare(b.id))`） |
| 必须 | 浮点计算结果用 `toFixed(3)` 截断 |
| 保证 | 同输入 + 同模型版本 + 同参数 → 同输出 |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §5.2；A6.1/A6.2 `fnv1a32Hex` + `stableStringify` 模式。

### PRED-004: Horizon（时间窗口）强制

| 条款 | 内容 |
|------|------|
| 必须 | 每条 Prediction 必须带 `window: { startTick, endTick, duration }` |
| 禁止 | 无时间窗口的"永久预测" |
| 上限 | `duration ≤ 5000` tick（超过此限的预测置信度强制为 0） |
| 下限 | `duration ≥ 50` tick（低于此限无实际意义，直接跳过） |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §2.1。

### PRED-005: Confidence 强制标注

| 条款 | 内容 |
|------|------|
| 必须 | 每条 Prediction 必须带 `confidence: number [0,1]` |
| 零置信度 | 数据不足时 `confidence = 0`，**不产出 Prediction**（不输出垃圾预测） |
| 样本下限 | 样本数 < 10 时 `confidence ≤ 0.3` |
| 样本下限 | 样本数 < 3 时 `confidence = 0`（不产出） |
| 计算方式 | `confidence = f(regressionR², sampleCount, regimeStability)` |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §5.3。

### PRED-006: Evidence 可追溯

| 条款 | 内容 |
|------|------|
| 必须 | 每条 Prediction 必须带 `evidence: string[]`（Pattern ID / Experience ID / 数据源快照引用） |
| 禁止 | 无证据的"直觉预测" |
| 链路 | evidence → 数据源 → 采集 tick → 原始系统输出（完整可追溯链） |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §2.1；A6.2 `evaluation-evidence.ts` EvidenceChain 模式。

### PRED-007: Regime Awareness（体制感知）

| 条款 | 内容 |
|------|------|
| 定义 | Regime = 影响预测模型有效性的宏观状态（posture 变化、RCL 变化、远矿开关…） |
| 必须 | 预测模型检查当前 regime 是否与训练数据/历史样本的 regime 一致 |
| 不一致 | regime mismatch 时 `confidence *= 0.5`（降权，不拒绝） |
| 记录 | regime mismatch 事件写入 evidence |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §5.3；A6.2 `baseline.ts` `detectRegimeMismatch` 函数。

### PRED-008: 失效处理

| 场景 | 处理 |
|------|------|
| 预测窗口到期 | 标记 `status = "expired"`，记录是否应验 |
| 预测应验 | 标记 `status = "fulfilled"`，提高该方法/参数的置信度权重 |
| 预测未应验 | 标记 `status = "expired"`，降低该方法/参数的置信度权重 |
| 新数据推翻预测 | 标记 `status = "invalidated"`，重新生成 |
| 数据不足 | `confidence = 0`，不产出 Prediction |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §5.3。

### PRED-009: 不直接触发动作

| 条款 | 内容 |
|------|------|
| 禁止 | `if prediction.target == "energy-shortage" then reduce upgrader`（直接从预测到参数修改） |
| 允许 | Prediction 作为 Recommendation Engine 的输入 |
| 允许 | Recommendation Engine 综合 Prediction + StrategyScore + Baseline 产出建议 |
| 允许 | 建议经 Validation Gate 后影响参数（A6.6 范围） |

**依据**: A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` §6.2；A6.0 `A6_0_SAFETY_BOUNDARY.md` §2。

### PRED-010: 不自建采样通道

| 条款 | 内容 |
|------|------|
| 禁止 | 预测系统自行扫描 `Game.creeps` / `Game.rooms` / `Game.structures` |
| 禁止 | 预测系统自建每 tick 采样 |
| 允许 | 复用既有系统的 cadence 采样（empire-health 100t、logistics-planner 100t 等） |
| 允许 | 在既有 cadence 中**寄生**追加预测所需的采样字段 |

**依据**: A5 `SYSTEM_BOUNDARIES.md` 各系统 CPU Profile 行；A6.0 Shadow-Only 原则。

---

## 二、数据契约

### 2.1 Prediction 核心类型

```typescript
/** 预测目标枚举 */
type PredictionTarget =
  | "energy-shortage"
  | "spawn-starvation"
  | "logistics-bottleneck"
  | "room-collapse"
  | "remote-mining-failure"
  | "expansion-readiness"
  | "cpu-pressure";

/** 预测方法枚举 */
type PredictionMethod =
  | "trend-extrapolation"
  | "threshold-projection"
  | "statistical-inference";

/** 预测状态 */
type PredictionStatus = "active" | "fulfilled" | "expired" | "invalidated";

/** 预测时间窗口 */
interface PredictionWindow {
  startTick: number;
  endTick: number;
  duration: number;
}

/** 预测结果 */
interface Prediction {
  id: string;
  generatedAt: number;
  target: PredictionTarget;
  window: PredictionWindow;
  value: number;
  confidence: number;
  method: PredictionMethod;
  evidence: string[];
  modelVersion: number;
  status: PredictionStatus;
  /** Regime 快照（生成时的宏观状态） */
  regime: {
    posture: string;
    watchdogTier: string;
    roomCount: number;
  };
}
```

### 2.2 TimeSeries 容器类型

```typescript
/** 通用时间序列采样点 */
interface TimeSeriesPoint<T = number> {
  tick: number;
  value: T;
}

/** 通用时间序列容器 */
interface TimeSeries<T = number> {
  samples: TimeSeriesPoint<T>[];
  capacity: number;
  /** 压入新采样点，超出容量时移除最旧的 */
  push(tick: number, value: T): void;
  /** 获取最近的 N 个采样点（按 tick 升序） */
  recent(n: number): TimeSeriesPoint<T>[];
  /** 线性回归：返回 { slope, intercept, r2 } */
  linearRegression(): { slope: number; intercept: number; r2: number } | null;
}
```

### 2.3 PredictionRingBuffer

```typescript
/** 预测 Ring Buffer（同构于 ExperienceRingBuffer / EvaluationRingBuffer） */
interface PredictionRingBuffer {
  entries: Prediction[];
  seq: number;
  capacity: number;
  /** 压入新预测，超出容量时覆盖最旧的 */
  push(prediction: Prediction): void;
  /** 按 target 查询活跃预测 */
  activeByTarget(target: PredictionTarget): Prediction[];
  /** 标记预测应验/失效 */
  resolve(id: string, status: PredictionStatus): void;
}
```

---

## 三、安全边界声明

### 3.1 预测层的角色

```
A5 执行层（Game API 写者）
  ↑ 读取
A6.2 评估层（Strategy Evaluation + Baseline）
  ↑ 读取
A6.3 预测层（Prediction）
  ↓ 产出
A6.6 推荐层（Recommendation Engine）[未实现]
  ↓ 产出
A6.6 验证门（Validation Gate）[未实现]
  ↓ 影响
tuning 参数覆盖层
```

### 3.2 预测层不做什么

| 不做 | 理由 |
|------|------|
| 不执行 Game API | Shadow-Only（PRED-001） |
| 不修改运行时状态 | Shadow-Only（PRED-001） |
| 不直接修改参数 | 不直接触发动作（PRED-009） |
| 不自建采样通道 | 寄生原则（PRED-010） |
| 不进入 tick 关键路径 | CPU 预算保护（PRED-002） |
| 不在 Recovery 档运行 | 生存优先（PRED-002） |
| 不产出无证据预测 | 可追溯性（PRED-006） |
| 不产出无时间窗口预测 | Horizon 强制（PRED-004） |

### 3.3 预测层做什么

| 做什么 | 依据 |
|------|------|
| 读取 globalCache 数据 | PRED-001 允许 |
| 运行预测模型（纯函数） | PRED-003 确定性 |
| 产出 Prediction 对象 | PRED-004/005/006 约束 |
| 存入 PredictionRingBuffer | PRED-001 允许写入 `__predictionCache` |
| 低频持久化到 RawMemory segment | PRED-001 允许 |
| 追踪预测应验/失效 | PRED-008 |
| 检测 Regime mismatch | PRED-007 |

---

## 四、模型版本化与演化

### 4.1 版本化要求

| 条款 | 内容 |
|------|------|
| 必须 | 每个预测目标有独立的 `modelVersion` |
| 必须 | 模型参数变更时递增 `modelVersion` |
| 必须 | 旧版本预测在 Ring Buffer 中自然过期 |
| 禁止 | 不递增版本号就修改模型参数 |

### 4.2 演化路径

| 阶段 | 模型 | 版本 |
|------|------|------|
| A6.3 | 规则 + 统计（趋势外推、阈值投影、统计推断） | v1 |
| A6.4+ | 可选引入贝叶斯更新（需 Player Intelligence 数据） | v2+ |
| 禁止 | ML / RL / NN（A6.0 `A6_0_LEARNING_APPROACH.md` 裁决否决） | — |

---

## 五、与其他契约的一致性

| 契约 | 分工 | 一致性要求 |
|------|------|-----------|
| A6.0 `A6_0_PREDICTION_ARCHITECTURE.md` | 预测层设计蓝图 | 预测目标、数据结构、方法以该文档为准 |
| A6.0 `A6_0_SAFETY_BOUNDARY.md` | 安全边界 | Shadow-Only、Validation Gate 7 项检查以该文档为准 |
| A5 `CPU_EXECUTION_MODEL.md` | CPU 预算 | P3 档位、Recovery 全停、分片顺延 |
| A5 `FAILURE_RECOVERY_ARCHITECTURE.md` | 失败恢复 | 预测系统自身的失败走 safeRun 隔离 |
| A5 `KERNEL_ARCHITECTURE.md` | 内核调度 | 预测系统注册在 bootstrap.ts，走 kernel 调度 |
| A5 `ECONOMY_ARCHITECTURE.md` | 能量数据 | 净流/储备/风险缓冲三指标是预测输入 |
| A5 `LOGISTICS_ARCHITECTURE.md` | 物流数据 | 三指标（空载率/延迟/断链数）是预测输入 |
| A5 `DEFENSE_ARCHITECTURE.md` | 威胁数据 | 威胁分级/能量会计是预测输入 |
| A5 `INTELLIGENCE_ARCHITECTURE.md` | 情报数据 | Intel 新鲜度/置信度三分是预测输入 |
