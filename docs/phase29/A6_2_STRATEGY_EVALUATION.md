# A6.2 — Strategy Evaluation Design

> **阶段**: A6.2 Strategy Evaluation & Baseline
> **日期**: 2026-08-26
> **权威来源**: A6_2_CONTRACT_RESOLUTION.md → CANONICAL_EVALUATION_DIMENSIONS
> **状态**: 已实现

---

## 一、设计目标

帝国现在可以回答：

- "这个策略过去表现如何？"
- "相比什么 baseline？"
- "改善了多少？恶化了多少？"
- "证据是什么？"
- "这个结论有多可信？"

但不能回答："所以现在立刻切换策略。"

策略切换属于未来的 Recommendation → Validation Gate → Shadow Experiment → Canary → Rollback → Controlled Adoption，当前阶段绝不实现自动策略切换。

---

## 二、Canonical Evaluation Dimensions

| # | 维度 | 定义 | 量化方法 | 数据来源 |
|---|------|------|---------|---------|
| 1 | economicGrowth | 经济增长率 | empireHealth.energyScore delta | empire-health-system |
| 2 | resourceEfficiency | 资源利用效率 | 产能/消耗比 + logistics deliveryRate | economy + logistics |
| 3 | cpuEfficiency | CPU 消耗效率 | CPU/产出比 + bucket stability | CPU tier + telemetry |
| 4 | riskLevel | 风险水平 | 威胁指数 + 暴露面 | threat-assessment |
| 5 | survival | 生存能力 | 帝国健康度 + 恢复能力 | empire-health + recoveryStats |
| 6 | expansion | 扩张效果 | 新房存活率 + RCL 增速 | expansion-outcome events |
| 7 | militaryOutcome | 军事结果 | 胜率 + 损失比 | evaluateWarOutcome |
| 8 | recoveryCost | 恢复代价 | 恢复时间 + 资源消耗 | recovery-lifecycle |

**被排除的维度**：
- `opportunityCost` — 文档 A 标注"后期" + 接口标注 optional，A6.9/A7 实现
- `logisticsHealth` — 已合并入 `resourceEfficiency` 子指标
- `techProgress` — 已合并入 `economicGrowth` 子指标

---

## 三、数据流

```
DecisionTrace
    ↓
Experience (A6.1)
    ↓
Outcome (A6.1)
    ↓
Attribution (A6.1)
    ↓
Evaluation (A6.2)          ← 本阶段
    ↓
Baseline Comparison (A6.2) ← 本阶段
    ↓
Evidence (A6.2)            ← 本阶段
    ↓
EvaluationResult (A6.2)    ← 本阶段
```

EvaluationResult **不进入**任何执行系统。

---

## 四、核心类型

### 4.1 StrategyScore

```typescript
interface StrategyScore {
  strategyType: string;
  window: EvaluationWindow;
  samples: number;
  dimensions: Readonly<Record<EvaluationDimension, DimensionScore>>;
  evaluatedAt: number;
  modelVersion: number;
  confidence: number;        // 各维度最低置信度，非"总分"
  verdict: EvaluationVerdict;
  evaluationHash: string;     // 确定性验证
  informationalScore: number; // informational only，无决策权
}
```

### 4.2 DimensionScore

每维度独立计算：observed, baseline, delta, trend, confidence, evidence。
禁止使用 single universal score。

### 4.3 EvaluationVerdict

```
IMPROVING / STABLE / DEGRADING / INCONCLUSIVE / CONFLICTING_TREND
```

禁止 EXECUTE / APPLY / SWITCH / SPAWN / ATTACK。

---

## 五、证据类型分层

| 类型 | 含义 |
|------|------|
| OBSERVED | 直接观察到的结果 |
| ATTRIBUTED | 已经经过 A6.1 归因 |
| INFERRED | Evaluation 根据证据推导出的判断 |

**禁止把 INFERRED 伪装成 FACT。**

每个 Evaluation Finding 都带 `evidenceType` + `confidence`。

---

## 六、外部因素处理

- 策略表现好但 `externalEnergyInflow > 0` → 不能全归功于策略
- 军事胜利但敌人自然消失 → attribution uncertainty
- Evaluation 复用 A6.1 Attribution，不重新实现归因

---

## 七、样本不足处理

样本不足时返回 INCONCLUSIVE，不强行 BETTER/WORSE。

| 维度 | 最低样本数 | 理由 |
|------|-----------|------|
| economicGrowth | 5 | 多系统耦合，需更多样本 |
| resourceEfficiency | 5 | 物流波动大 |
| cpuEfficiency | 10 | CPU 受 tick 负载影响 |
| riskLevel | 3 | 威胁变化快 |
| survival | 3 | 变化慢 |
| expansion | 2 | 事件低频 |
| militaryOutcome | 3 | 事件低频但重要 |
| recoveryCost | 3 | 事件中频 |

---

## 八、Shadow-Only 原则

- Evaluation 只做分析，不执行任何 Game API
- Recommendation 始终 `shadowOnly=true, autoApply=false`
- Evaluation Result 不得进入 Spawn / Logistics / Military / Strategy / Recovery

---

## 九、实现清单

| 文件 | 职责 | 状态 |
|------|------|------|
| `src/domain/intelligence/strategy-evaluation.ts` | 8 维评估纯函数 + StrategyScore + EvaluationResult + verdict | ✅ |
| `src/domain/intelligence/baseline.ts` | Baseline Model + BaselineKey + compareBaseline + detectRegimeMismatch | ✅ |
| `src/domain/intelligence/evaluation-evidence.ts` | Evidence 构建 + 追溯 + 完整性验证 | ✅ |
| `src/domain/intelligence/index.ts` | 统一导出 | ✅ |
| `src/systems/intelligence/strategy-evaluation-system.ts` | 系统薄壳 P3 post 低频 500t | ✅ |
| `src/bootstrap.ts` | 注册新系统 | ✅ |
| `tests/unit/intelligence/a6-2-strategy-evaluation.test.ts` | 58 个测试（15 EVAL + AG + Replay + CPU + Memory） | ✅ |

---

## 十、质量门槛

| 检查 | 结果 |
|------|------|
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ 4502 pass / 1 fail (已有 flaky test, 非 A6.2) |
| `npm run build` | ✅ PASS |
| Architecture Guards | ✅ Domain zero Game/Memory/Kernel/console |
| Deterministic Replay | ✅ 20 scenarios × 1000 iterations |
| CPU Benchmark | ✅ 1 evaluation < 100ms, 100 evaluations < 5s |
| Memory Audit | ✅ No Experience/Snapshot/GameObjects in result |
