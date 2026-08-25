# A6.3.0 — Prediction Layer Acceptance Criteria

> **阶段**: A6.3.0 Research / Acceptance Definition
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: 定义 A6.3 实施完成后的行为级验收标准（PRED-ACC-XXX）

---

## 一、验收原则

### 1.1 行为优先

验收标准基于**行为**而非代码量。以下原则参考 A6.0 `A6_0_ACCEPTANCE.md`：

1. **功能正确性**：预测在给定数据下产出正确的 Prediction 对象
2. **安全性**：预测层永远不修改游戏状态
3. **确定性**：同输入同输出，可回放
4. **资源约束**：CPU/Memory 在预算内
5. **可观测性**：预测结果可查询、可追溯

### 1.2 验收方法

- **单元测试**：纯函数级别，给定输入验证输出
- **集成测试**：系统层级别，给定 globalCache 快照验证 Prediction 产出
- **影子运行**：在 soak 环境中运行，验证不干扰帝国运行
- **确定性回放**：给定固定输入，两次运行输出一致

---

## 二、功能验收标准

### PRED-ACC-001: 预测产出

| 条款 | 验证方法 |
|------|---------|
| Given | globalCache 中有 ≥30 个采样点的净流历史 |
| When | 预测系统运行（cadence 到达） |
| Then | 产出一条 `Prediction { target: "energy-shortage", confidence > 0 }` |
| And | Prediction 有完整字段（id, generatedAt, target, window, value, confidence, method, evidence, modelVersion, status, regime） |

### PRED-ACC-002: 数据不足不产出

| 条款 | 验证方法 |
|------|---------|
| Given | globalCache 中净流历史 < 3 个采样点 |
| When | 预测系统运行 |
| Then | **不产出** Prediction（不输出 confidence = 0 的垃圾预测） |
| And | 不抛错，静默跳过 |

### PRED-ACC-003: 线性回归正确性

| 条款 | 验证方法 |
|------|---------|
| Given | 净流历史 = [100, 90, 80, 70, 60]（线性下降） |
| When | 执行趋势外推 |
| Then | slope ≈ -10/tick |
| And | r² ≈ 1.0 |
| And | ETA 到达 deficit 阈值 = (current - deficitThreshold) / |slope| |

### PRED-ACC-004: 阈值投影正确性

| 条款 | 验证方法 |
|------|---------|
| Given | spawn 队列深度历史 = [2, 4, 6, 8, 10]（线性增长） |
| When | 执行阈值投影 |
| Then | ETA 到达 critical 阈值（如 20）= (20 - 10) / (2/tick) = 5 个采样间隔 |

### PRED-ACC-005: 多目标覆盖

| 条款 | 验证方法 |
|------|---------|
| Given | 所有 7 个预测目标的数据源均有足够样本 |
| When | 预测系统运行一个完整 cadence |
| Then | 产出 ≥ 1 条 Prediction per target（7 个目标各至少 1 条） |

### PRED-ACC-006: Regime Mismatch 降权

| 条款 | 验证方法 |
|------|---------|
| Given | 历史样本在 peace posture 采集 |
| And | 当前 posture = war |
| When | 预测系统运行 |
| Then | confidence 乘以 0.5（regime mismatch 降权） |
| And | evidence 中记录 regime mismatch 事件 |

### PRED-ACC-007: 失效处理

| 条款 | 验证方法 |
|------|---------|
| Given | 一条 active Prediction 的 window.endTick < Game.time |
| When | 预测系统运行 |
| Then | 该 Prediction 标记为 `status = "expired"` |
| And | 检查预测值是否应验（实际值 vs 预测值对比） |
| And | 记录应验/未应验事件 |

---

## 三、安全验收标准

### PRED-ACC-010: Shadow-Only 不写入

| 条款 | 验证方法 |
|------|---------|
| Given | 预测系统运行一个完整 cadence |
| When | 检查 globalCache |
| Then | 只有 `__predictionCache` 被修改 |
| And | 所有其他 globalCache 字段未被预测系统修改 |
| And | Memory 运行时状态（posture, colonyState, spawn queue...）未被修改 |

### PRED-ACC-011: 不调用 Game API

| 条款 | 验证方法 |
|------|---------|
| Given | 预测系统代码 |
| When | 静态分析 import 列表 |
| Then | 域代码（domain/）**不 import** 任何 `Game` 引用 |
| And | 系统代码（systems/）只读 `Game.cpu.bucket`、`Game.time`（只读 API） |

### PRED-ACC-012: Recovery 档全停

| 条款 | 验证方法 |
|------|---------|
| Given | 看门狗档位 = Recovery |
| When | 预测系统 cadence 到达 |
| Then | 预测系统**跳过执行** |
| And | 不产出任何新 Prediction |
| And | 不修改 `__predictionCache` |

---

## 四、确定性验收标准

### PRED-ACC-020: 可回放

| 条款 | 验证方法 |
|------|---------|
| Given | 相同的 globalCache 快照（相同的 TimeSeries 数据、相同的 regime） |
| When | 两次运行预测系统 |
| Then | 产出的 Prediction 完全一致（id、value、confidence 全相同） |

### PRED-ACC-021: 无随机性

| 条款 | 验证方法 |
|------|---------|
| Given | 预测系统代码 |
| When | 静态分析 |
| Then | 不调用 `Math.random()`、`Date.now()` |
| And | 所有遍历前排序 |
| And | 浮点结果 `toFixed(3)` |

---

## 五、资源约束验收标准

### PRED-ACC-030: CPU 预算

| 条款 | 验证方法 |
|------|---------|
| Given | 预测系统单次运行 |
| When | 测量 CPU 消耗 |
| Then | 单次运行 ≤ 0.5 CPU（不含 segment 读写） |
| And | Cadence ≥ 500 tick |

### PRED-ACC-031: Memory 占用

| 条款 | 验证方法 |
|------|---------|
| Given | PredictionRingBuffer 满容量 |
| When | 测量 heap 占用 |
| Then | Ring Buffer ≤ 100 条 Prediction |
| And | 每条 Prediction 序列化 ≤ 500 bytes |
| And | 总 heap 占用 ≤ 50KB |

### PRED-ACC-032: 不新增每 tick 采样

| 条款 | 验证方法 |
|------|---------|
| Given | 预测系统代码 |
| When | 分析采样逻辑 |
| Then | 所有采样寄生在既有系统 cadence 中 |
| And | 预测系统不自建 per-tick 采样 |

---

## 六、可观测性验收标准

### PRED-ACC-040: Prediction 可查询

| 条款 | 验证方法 |
|------|---------|
| Given | `__predictionCache` 中有 active predictions |
| When | 调用 `PredictionRingBuffer.activeByTarget("energy-shortage")` |
| Then | 返回所有 active 状态的 energy-shortage 预测 |

### PRED-ACC-041: Evidence 可追溯

| 条款 | 验证方法 |
|------|---------|
| Given | 一条 Prediction 的 evidence = ["exp-12345", "baseline-energy-flow"] |
| When | 追溯 evidence |
| Then | "exp-12345" → ExperienceRingBuffer 中的 ExperienceRecord |
| And | "baseline-energy-flow" → baseline.ts 的 CONFIG_BASELINE_VALUES 条目 |
| And | 完整链路：Prediction → evidence → 数据源 → 采集 tick |

### PRED-ACC-042: 应验/失效追踪

| 条款 | 验证方法 |
|------|---------|
| Given | 多条已到期 Prediction |
| When | 预测系统运行 resolve 逻辑 |
| Then | 每条标为 "fulfilled" 或 "expired" |
| And | 记录应验率（fulfilled / (fulfilled + expired)） |
| And | 应验率影响后续预测的置信度权重 |

---

## 七、不应验收的内容

以下**不属于** A6.3 验收范围：

| 不验收 | 理由 |
|--------|------|
| Recommendation 产出 | A6.6 范围（Recommendation Engine） |
| Validation Gate | A6.6 范围 |
| 参数自动调整 | A6.6 范围 |
| Player Intelligence 预测 | A6.4+ 范围 |
| 战争升级预测 | A6.4+ 范围 |
| 敌方行为预测 | A6.4+ 范围 |
| 预测准确率达标 | A6.3 只验证"能产出"，不验证"准确"（准确率需 soak 数据积累后才能评估） |

---

## 八、验收清单汇总

| ID | 标准 | 类别 | 优先级 |
|----|------|------|--------|
| PRED-ACC-001 | 预测产出 | 功能 | P0 |
| PRED-ACC-002 | 数据不足不产出 | 功能 | P0 |
| PRED-ACC-003 | 线性回归正确性 | 功能 | P0 |
| PRED-ACC-004 | 阈值投影正确性 | 功能 | P0 |
| PRED-ACC-005 | 多目标覆盖 | 功能 | P1 |
| PRED-ACC-006 | Regime mismatch 降权 | 功能 | P1 |
| PRED-ACC-007 | 失效处理 | 功能 | P1 |
| PRED-ACC-010 | Shadow-Only 不写入 | 安全 | P0 |
| PRED-ACC-011 | 不调用 Game API | 安全 | P0 |
| PRED-ACC-012 | Recovery 档全停 | 安全 | P0 |
| PRED-ACC-020 | 可回放 | 确定性 | P0 |
| PRED-ACC-021 | 无随机性 | 确定性 | P0 |
| PRED-ACC-030 | CPU 预算 | 资源 | P0 |
| PRED-ACC-031 | Memory 占用 | 资源 | P1 |
| PRED-ACC-032 | 不新增每 tick 采样 | 资源 | P0 |
| PRED-ACC-040 | Prediction 可查询 | 可观测性 | P1 |
| PRED-ACC-041 | Evidence 可追溯 | 可观测性 | P1 |
| PRED-ACC-042 | 应验/失效追踪 | 可观测性 | P1 |
