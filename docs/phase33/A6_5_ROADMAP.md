# A6.5 Roadmap — 实施路线图

> **研究阶段**: A6.5 Research  
> **禁止实现**: 本文档仅做路线图设计，不修改任何代码  
> **基线**: A6.5 Architecture + Acceptance + Safety Boundary

---

## 一、实施阶段

### Phase 1: Domain 基础类型 (S1)

**目标**: 定义 IntelligenceState 及所有子类型。

**文件**:
- `src/domain/intelligence/reliability/types.ts`
- `src/domain/intelligence/reliability/index.ts`（最小出口）

**内容**:
- IntelligenceState 接口
- PredictionCoverage
- ModelReliabilityAssessment
- CalibrationHealthSummary
- DataSufficiencySummary
- RegimeFitSummary
- UncertaintySummary + UncertaintySource
- PredictionConflict
- FreshnessSummary + FreshnessSource
- 常量定义（MAX_REGIME_PROFILES_PER_MODEL 等）

**验收**:
- `npm run typecheck` 全绿
- 类型与 A6.4 / A6.3 的类型兼容（只读 import）

**依赖**: 无（类型定义先行）

---

### Phase 2: State Hash + 确定性基础 (S2)

**目标**: 实现 IntelligenceState 的确定性 Hash。

**文件**:
- `src/domain/intelligence/reliability/state-hash.ts`

**内容**:
- `intelligenceStateHash()` 函数
- 复用 A6.3 `stableStringify` + `fnv1a32Hex`
- 所有遍历按 ID 排序

**验收**:
- 单元测试: 100× replay → 100% 一致
- `npm run typecheck` 全绿

**依赖**: S1

---

### Phase 3: Regime Fit (S3)

**目标**: 实现 Regime 适配度计算。

**文件**:
- `src/domain/intelligence/reliability/regime-fit.ts`

**内容**:
- `computeRegimeFit()` 纯函数
- Regime Profile 查找逻辑
- Profile Fallback 策略（Regime → 全局 → INSUFFICIENT_DATA）
- 样本充足性判断

**验收**:
- 单元测试覆盖: CF-1, CF-2, CF-3, CF-10
- `npm run typecheck` 全绿

**依赖**: S1, S2

---

### Phase 4: Temporal Drift (S4)

**目标**: 实现时效性退化检测。

**文件**:
- `src/domain/intelligence/reliability/temporal-drift.ts`

**内容**:
- `detectCalibrationDrift()` 纯函数
- Rolling Window 计算（最近 100 条 Resolution）
- Drift Detection（recentEce vs overallEce 对比）
- Profile Aging 检测（statisticsTick 距当前 tick）

**验收**:
- 单元测试覆盖: CF-4, CF-5, CF-6, CF-14
- `npm run typecheck` 全绿

**依赖**: S1, S2

---

### Phase 5: Conflict Detection (S5)

**目标**: 实现跨模型冲突检测。

**文件**:
- `src/domain/intelligence/reliability/conflict-detect.ts`

**内容**:
- `detectConflicts()` 纯函数
- 逻辑冲突规则注册（energy-vs-expansion 等）
- Temporal 不一致检测
- Regime 冲突检测（复用 A6.4 `checkRegimeCompatibility`）
- 冲突严重度计算

**验收**:
- 单元测试覆盖: CF-7, CF-8, CF-9, CF-10, CF-11
- REL-011 守卫: 不包含冲突解决代码
- `npm run typecheck` 全绿

**依赖**: S1, S2

---

### Phase 6: Data Sufficiency + Freshness + Uncertainty (S6)

**目标**: 实现数据充足性、新鲜度和不确定性聚合。

**文件**:
- `src/domain/intelligence/reliability/data-sufficiency.ts`
- `src/domain/intelligence/reliability/freshness.ts`
- `src/domain/intelligence/reliability/uncertainty.ts`

**内容**:
- `computeDataSufficiency()` — 跨模型聚合
- `computeFreshness()` — 各数据源新鲜度评估
- `aggregateUncertainty()` — 不确定性来源聚合

**验收**:
- 单元测试覆盖: CF-1, CF-6, CF-12, CF-13
- REL-012 守卫: 不产出 reliabilityScore
- `npm run typecheck` 全绿

**依赖**: S1, S3, S4, S5

---

### Phase 7: IntelligenceState 聚合 (S7)

**目标**: 实现 A6.5 的唯一入口函数。

**文件**:
- `src/domain/intelligence/reliability/compute-state.ts`（或集成到 index.ts）

**内容**:
- `computeIntelligenceState()` 纯函数
- 调用 S3-S6 的子函数
- 组装 IntelligenceState
- 计算 stateHash

**验收**:
- 单元测试覆盖: CF-1 ~ CF-15
- 确定性: 100× replay
- `npm run typecheck` 全绿

**依赖**: S1-S6

---

### Phase 8: Guards (S8)

**目标**: 实现 REL-001 ~ REL-012 守卫。

**文件**:
- `src/domain/intelligence/reliability/guards.ts`

**内容**:
- 12 个守卫验证函数
- 复用 A6.3 GuardResult 类型
- `validateIntelligenceState()` 全量验证函数

**验收**:
- 单元测试: 守卫违规检测
- `npm run typecheck` 全绿

**依赖**: S1, S7

---

### Phase 9: System 层 (S9)

**目标**: 实现 intelligence-state-system 薄壳。

**文件**:
- `src/systems/intelligence/intelligence-state-system.ts`
- `src/bootstrap.ts`（注册）

**内容**:
- 从 globalCache 读取 A6.1-A6.4 数据
- 调用 `computeIntelligenceState()`
- 运行 REL 守卫检查
- console.log 可观测性输出

**验收**:
- D1: Shadow-Only 验证通过
- E2E-T6: 安全不变式验证通过
- `npm run typecheck` 全绿
- `npm test` 全绿
- `npm run build` 全绿

**依赖**: S1-S8

---

### Phase 10: 集成测试 + 端到端验收 (S10)

**目标**: 全量集成测试和端到端验收。

**文件**:
- `test/intelligence/reliability.integration.test.ts`
- `test/intelligence/a6_5_e2e.test.ts`

**内容**:
- 端到端测试: A6.1→A6.2→A6.3→A6.4→A6.5
- 冷启动测试
- 确定性回放测试
- 安全不变式测试
- 守卫全量测试

**验收**:
- D1 ~ D6 全部通过
- E2E-T1 ~ E2E-T6 全部通过
- 测试覆盖率达标

**依赖**: S1-S9

---

## 二、阶段依赖图

```
S1 (Types)
  │
  ├── S2 (State Hash)
  │     │
  │     ├── S3 (Regime Fit) ──────────┐
  │     ├── S4 (Temporal Drift) ───────┤
  │     └── S5 (Conflict Detect) ─────┤
  │                                   │
  └── S6 (Data Suff + Fresh + Uncert) ┘
                                      │
                                      ▼
                              S7 (Aggregate State)
                                      │
                                      ▼
                              S8 (Guards)
                                      │
                                      ▼
                              S9 (System Layer)
                                      │
                                      ▼
                             S10 (Integration)
```

---

## 三、优先级和估算

### 3.1 优先级

| 阶段 | 优先级 | 理由 |
|------|--------|------|
| S1 | P0 | 类型定义是所有后续工作的基础 |
| S2 | P0 | 确定性是 A6.5 的核心约束 |
| S3 | P0 | Regime 分区是 A6.5 的核心价值 |
| S4 | P0 | Drift 检测是 A6.5 的核心价值 |
| S5 | P1 | 冲突检测可后延（当前只有 2 个模型） |
| S6 | P1 | 数据充足性聚合可后延 |
| S7 | P0 | 入口函数必须完成 |
| S8 | P0 | 守卫是安全约束 |
| S9 | P0 | System 层是可观测性入口 |
| S10 | P0 | 端到端验收 |

### 3.2 CPU 预算估算

| 阶段 | 实现后每 tick 成本 | 占 CPU 预算 |
|------|------------------|------------|
| S1-S8 | 0（Domain 层纯函数，不运行时不计 CPU） | 0% |
| S9 | < 1 ops/t（每 500t 运行一次） | < 0.1% |
| S10 | 0（测试） | 0% |

**总 CPU 成本**: < 1 ops/t — 远低于 CPU 预算上限。

### 3.3 Memory 预算估算

| 阶段 | 内存占用 |
|------|---------|
| S1-S8 | 0（不持久化） |
| S9 | ~2KB transient（IntelligenceState 生命周期 = 1 tick） |
| S10 | 0（测试） |

**总 Memory 成本**: ~2KB transient — 远低于 Memory 预算上限。

---

## 四、前置条件

### 4.1 必须满足

- [ ] A6.4 Calibration 完全实现并测试通过
- [ ] A6.3 Prediction 完全实现并测试通过
- [ ] A6.1-A6.4 的 Ring Buffer 可被只读访问
- [ ] `stableStringify` / `fnv1a32Hex` 可被复用
- [ ] `GuardResult` 类型可被复用
- [ ] `buildPredictionContextSignature` / `checkRegimeCompatibility` 可被复用

### 4.2 不需要满足

- ❌ A6.6 Recommendation（A6.5 不依赖 A6.6）
- ❌ 未实现的 Prediction Model（A6.5 自动发现已实现模型）
- ❌ 新的 Memory 结构
- ❌ 新的 globalCache 字段

---

## 五、风险和缓解

### 5.1 实施风险

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| Regime 分区导致样本碎片化 | HIGH | Fallback 策略 + MIN_SAMPLES 控制 |
| 架构膨胀为 "IntelligenceManager" | HIGH | REL 守卫 + Shadow-Only 约束 |
| Conflict Detection 退化为冲突解决 | MEDIUM | REL-011 守卫 |
| Drift 检测假阳性 | MEDIUM | Rolling Window 最小样本 30 |
| Profile Stale 误判 | LOW | stale 阈值 = CALIBRATION_PROFILE_INTERVAL × 3 |

### 5.2 回退方案

如果 A6.5 在实施过程中遇到不可解决的问题：

1. **A6.5 完全停止**: 帝国照常运行（安全不变式保证）
2. **部分降级**: 只实现 Regime Fit + Drift Detection，跳过 Conflict Detection
3. **最小实现**: 只产出 `dataSufficiency` + `predictionCoverage`，跳过 Reliability

**底线**: 即使 A6.5 只产出空 IntelligenceState，也不影响帝国运行。

---

## 六、里程碑

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| M1 | S1-S2 完成 | 类型定义 + Hash + typecheck 全绿 |
| M2 | S3-S5 完成 | Regime + Drift + Conflict + 单元测试 |
| M3 | S6-S8 完成 | DataSuff + Fresh + Uncert + Guards |
| M4 | S9 完成 | System 层 + bootstrap 注册 + typecheck + test + build 全绿 |
| M5 | S10 完成 | E2E 验收 + 安全不变式 + 全量测试 |

---

## 七、与 A6.6 的衔接

### 7.1 A6.5 为 A6.6 提供什么

A6.5 产出的 IntelligenceState 是 A6.6 Recommendation 的输入：

```
A6.5 IntelligenceState
  ├── predictionCoverage → "系统能预测什么？"
  ├── modelReliability → "预测有多可靠？"
  ├── calibrationHealth → "校准是否健康？"
  ├── dataSufficiency → "数据是否充足？"
  ├── regimeFit → "Regime 是否匹配？"
  ├── uncertainty → "有哪些不确定性？"
  ├── predictionConflicts → "有哪些冲突？"
  └── knowledgeFreshness → "数据是否新鲜？"
```

### 7.2 A6.6 不需要直接访问 A6.1-A6.4

A6.6 只消费 IntelligenceState，不直接读 A6.1-A6.4 的 Ring Buffer。

**好处**:
- A6.6 与 A6.1-A6.4 解耦
- A6.5 是唯一的聚合层
- A6.6 不需要理解 4 个子系统的内部结构

### 7.3 A6.6 的职责（未来）

| 职责 | A6.5 | A6.6 |
|------|------|------|
| 检测可靠性 | ✅ | — |
| 检测冲突 | ✅ | — |
| 聚合 IntelligenceState | ✅ | — |
| 基于 reliability 降权 | ❌ | ✅ |
| 解决冲突 | ❌ | ✅ |
| 产出策略建议 | ❌ | ✅ |
| 选择使用哪个模型 | ❌ | ✅ |
