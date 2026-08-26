# A6.4 — Acceptance Criteria

> **阶段**: A6.4 Research / Contract Design
> **日期**: 2026-08-26
> **约束**: 纯研究，不实现代码
> **范围**: A6.4 Research 完成标准、Implementation 前置条件、验收清单

---

## 一、Research 完成标准

### 1.1 必须满足的条件

| # | 条件 | 状态 | 证据 |
|---|------|------|------|
| 1 | 已完整审计 A6.1/A6.2/A6.3 实际代码 | ✅ | GAP_ANALYSIS.md §一 |
| 2 | 已确认 Prediction → Observation → Resolution 数据链是否完整 | ✅ | RESOLUTION_DESIGN.md §一 |
| 3 | 已定义 canonical Resolution Contract | ✅ | RESOLUTION_DESIGN.md §二 |
| 4 | 已定义 Horizon Contract | ✅ | RESOLUTION_DESIGN.md §三 |
| 5 | 已定义 Confidence Calibration Contract | ✅ | CONFIDENCE_CALIBRATION.md §二~六 |
| 6 | 已定义 Failure Attribution Contract | ✅ | FAILURE_ATTRIBUTION.md §二~四 |
| 7 | 已定义 Regime / External Interference 处理规则 | ✅ | RESOLUTION_DESIGN.md §六~七 |
| 8 | 已定义 Partial Resolution | ✅ | RESOLUTION_DESIGN.md §三.3 |
| 9 | 已定义样本不足规则 | ✅ | CONFIDENCE_CALIBRATION.md §五 |
| 10 | 已定义 Memory / CPU Budget | ✅ | ARCHITECTURE.md §五~三.3 |
| 11 | 已定义 Determinism Contract | ✅ | ARCHITECTURE.md §六 |
| 12 | 已定义 Architecture Guards | ✅ | ARCHITECTURE.md §七, CONTRACT.md §三 |
| 13 | 已完成 C1-C12 反事实设计 | ✅ | COUNTERFACTUAL_AUDIT.md §二 |
| 14 | 已确认当前 2 个模型是否足以开始实施 | ✅ | FINAL_RESEARCH.md §一 |
| 15 | 已明确未来模型接入机制 | ✅ | ARCHITECTURE.md §九 |
| 16 | 已明确 A6.4 是否修改 A6.3 | ✅ | FINAL_RESEARCH.md §二 |
| 17 | 已明确 A6.5 的前置条件 | ✅ | FINAL_RESEARCH.md §三 |
| 18 | 所有结论均来自真实代码/文档审计 | ✅ | 所有文档引用源码 |

### 1.2 研究文档清单

| 文档 | 路径 | 状态 |
|------|------|------|
| Gap Analysis | `docs/phase33/A6_4_CALIBRATION_GAP_ANALYSIS.md` | ✅ |
| Resolution Design | `docs/phase33/A6_4_RESOLUTION_DESIGN.md` | ✅ |
| Confidence Calibration | `docs/phase33/A6_4_CONFIDENCE_CALIBRATION.md` | ✅ |
| Failure Attribution | `docs/phase33/A6_4_FAILURE_ATTRIBUTION.md` | ✅ |
| Architecture | `docs/phase33/A6_4_ARCHITECTURE.md` | ✅ |
| Counterfactual Audit | `docs/phase33/A6_4_COUNTERFACTUAL_AUDIT.md` | ✅ |
| Contract | `docs/phase33/A6_4_CONTRACT.md` | ✅ |
| Acceptance | `docs/phase33/A6_4_ACCEPTANCE.md` | ✅ |
| Final Research | `docs/phase33/A6_4_FINAL_RESEARCH.md` | ✅ |

---

## 二、Implementation 前置条件

### 2.1 BLOCKER 分析

| GAP ID | 严重度 | 是否阻塞 Implementation | 解决方案 |
|--------|--------|------------------------|---------|
| CAL-GAP-8 | **HIGH** | ⚠️ **阻塞** | Implementation 阶段必须先补建 prediction-system 适配器 |
| CAL-GAP-1 ~ 7, 9, 10 | HIGH/MEDIUM/LOW | ❌ 不阻塞 | A6.4 在自己的 Domain 内解决 |

### 2.2 Implementation 前置步骤

```
Step 1: 补建 prediction-system（A6.3 系统层适配器）
  - 注册到 bootstrap.ts
  - 从 globalCache 采集数据
  - 调用 A6.3 Domain 纯函数
  - 将 Prediction 写入 __predictionCache Ring Buffer

Step 2: 验证 Prediction Ring Buffer 非空
  - 运行至少 5000 tick
  - 确认至少 10 条 Prediction 产出
  - 确认至少有 1 条 Prediction 已到期（window.endTick < currentTick）

Step 3: 实现 A6.4 Domain 层
  - types.ts
  - resolve.ts (Resolution Engine)
  - calibrate.ts (Calibration Statistics)
  - attribution.ts (Failure Attribution)
  - hashing.ts (复用 A6.3)
  - guards.ts (CAL-XXX)

Step 4: 实现 A6.4 System 层
  - calibration-resolution-system.ts
  - 注册到 bootstrap.ts

Step 5: 实现 A6.4 测试
  - C1-C12 场景测试
  - 确定性 replay 测试
  - Guard 合规测试

Step 6: 质量门槛
  - npm run typecheck ✅
  - npm test ✅
  - npm run build ✅
```

### 2.3 是否可以立即进入 Implementation？

**可以**，但需要同时完成 CAL-GAP-8 的修复（补建 prediction-system）。

A6.4 Implementation 的建议顺序：
1. 先补建 prediction-system（半天工作量）
2. 实现 A6.4 Domain 层（1-2 天）
3. 实现 A6.4 System 层（半天）
4. 测试 + 质量门槛（1 天）

---

## 三、Implementation 验收清单

### 3.1 Domain 层验收

| # | 验收项 | 验收方法 |
|---|--------|---------|
| D1 | `calibration/types.ts` 定义所有类型 | typecheck 通过 |
| D2 | `calibration/resolve.ts` 实现 `resolvePrediction` | 单元测试 |
| D3 | `calibration/calibrate.ts` 实现 `computeCalibrationProfile` | 单元测试 |
| D4 | `calibration/calibrate.ts` 实现 `computeCalibrationStatistics` | 单元测试 |
| D5 | `calibration/attribution.ts` 实现 `attributeFailure` | 单元测试 |
| D6 | `calibration/attribution.ts` 实现 `computeModelFailureStats` | 单元测试 |
| D7 | `calibration/hashing.ts` 复用 A6.3 hashing | import 检查 |
| D8 | `calibration/guards.ts` 实现 CAL-001 ~ CAL-010 | 单元测试 |
| D9 | Domain 层不引用 Game/Memory | grep 检查 |
| D10 | Domain 层不引用 kernel/systems | grep 检查 |

### 3.2 System 层验收

| # | 验收项 | 验收方法 |
|---|--------|---------|
| S1 | `calibration-resolution-system.ts` 实现 System 接口 | typecheck |
| S2 | 注册到 `bootstrap.ts` | 代码检查 |
| S3 | 优先级 P3, interval=500, phase=post | 代码检查 |
| S4 | 只写 `__calibrationCache` | grep 检查 |
| S5 | 不新建采样通道 | 代码检查 |
| S6 | 包含 GC 逻辑 | 代码检查 |
| S7 | 包含 Observability console.log | 代码检查 |

### 3.3 测试验收

| # | 验收项 | 验收方法 |
|---|--------|---------|
| T1 | C1: 正确预测，事件发生 | 测试通过 |
| T2 | C2: 误报，事件未发生 | 测试通过 |
| T3 | C3: 当前状态与预测冲突 | 测试通过 |
| T4 | C4: Horizon 内发生 | 测试通过 |
| T5 | C5: Horizon 外发生 | 测试通过 |
| T6 | C6: Regime Change | 测试通过 |
| T7 | C7: External Interference | 测试通过 |
| T8 | C8: 数据不足 | 测试通过 |
| T9 | C9: Observation Gap | 测试通过 |
| T10 | C10: OVERCONFIDENT | 测试通过 |
| T11 | C11: UNDERCONFIDENT | 测试通过 |
| T12 | C12: 100× deterministic replay | 测试通过 |

### 3.4 Guard 验收

| # | 验收项 | 验收方法 |
|---|--------|---------|
| G1 | CAL-001 Shadow-Only | 只写 __calibrationCache |
| G2 | CAL-002 Domain Purity | 无 Game/Memory import |
| G3 | CAL-003 No Game API | 无 Game. 调用 |
| G4 | CAL-004 No Runtime Mutation | 不修改其他 cache |
| G5 | CAL-005 Deterministic | 100× replay hash 一致 |
| G6 | CAL-006 Bounded Memory | Ring Buffer 不超 500 |
| G7 | CAL-007 No New Tick Sampler | 复用既有 cadence |
| G8 | CAL-008 No Second Metrics | 不采集新 Metrics |
| G9 | CAL-009 No Strategy Mutation | 不修改 Strategy |
| G10 | CAL-010 Evidence Traceability | 每条 Resolution 有 predictionId |

### 3.5 质量门槛

| 命令 | 状态要求 |
|------|---------|
| `npm run typecheck` | ✅ 全绿 |
| `npm test` | ✅ 全绿 |
| `npm run build` | ✅ 全绿 |

---

## 四、防退化最终验证

| 退化模式 | Implementation 中的验证方式 |
|---------|--------------------------|
| 退化 1：单点 Resolution | Resolution 测试中检查 Observation Window |
| 退化 2：confidence = success rate | Calibration 测试中使用 Bucket + ECE |
| 退化 3：万能 predictionScore | 类型检查中无 predictionScore |
| 退化 4：合并所有模型 | Profile 按 modelKey 分组 |
| 退化 5：直接喂 Strategy | grep 搜索无 Strategy/Posture 写操作 |
| 退化 6：Regime = Model Failure | C6 测试验证 REGIME_CHANGED 不计入 denominator |
| 退化 7：External = Failure | C7 测试验证 EXTERNAL_INTERFERENCE 不计入 denominator |

---

## 五、A6.4 完成后的下一步

### 5.1 A6.5 前置条件

| 条件 | 状态 | 说明 |
|------|------|------|
| A6.4 Calibration 产出 ModelCalibrationProfile | Implementation 后产出 | 需要 A6.4 完整运行 5000+ tick |
| A6.4 Calibration Verdict 有非 INSUFFICIENT_DATA 结果 | 需要足够样本 | 至少 200 条 calibratable Resolution |
| A6.3 Prediction 系统稳定运行 | 依赖 CAL-GAP-8 修复 | prediction-system 已注册 |

### 5.2 A6.5 可能方向

根据 A6.0 架构，A6.5+ 可能是：
- Recommendation Engine（消费 Calibration 统计，产出改进建议）
- Auto-Apply（需要额外授权——Shadow-Only 不再适用）
- Strategy Adaptation（需要额外授权——直接修改 Strategy）

**A6.4 的产出**（ModelCalibrationProfile + ModelFailureStats）是 A6.5 Recommendation Engine 的**输入之一**，但不是唯一输入。

### 5.3 边界声明

A6.4 产出的是 **Calibration Evidence / Statistics**。这些产出：
- ✅ 可被 A6.5+ 只读消费
- ✅ 可用于诊断模型质量
- ❌ 不可直接修改下一次 Prediction 的 confidence
- ❌ 不可直接修改模型参数
- ❌ 不可直接修改 Strategy
- ❌ 不可直接修改任何执行系统

只有当后续阶段明确授权时，Calibration Statistics 才能参与运行时决策。
