# A6.6 Recommendation Gap Analysis

> **阶段**: A6.6 Research / Architecture
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码
> **基线**: A6.0–A6.5 已 FROZEN_WITH_TECHNICAL_DEBT

---

## 一、当前 Intelligence 链条能做什么

### 1.1 A6.1–A6.5 已建立的能力

| 阶段 | 能力 | 产出 | 消费者 |
|------|------|------|--------|
| A6.1 | Experience + Outcome + Attribution | ExperienceRecord（Ring Buffer） | A6.2 |
| A6.2 | Strategy Evaluation + Baseline + Evidence | StrategyEvaluation + RecommendationCandidate(shadow) | A6.3 |
| A6.3 | Prediction | Prediction（Ring Buffer, active/fulfilled/expired） | A6.4 |
| A6.4 | Calibration | ResolutionResult + ModelCalibrationProfile | A6.5 |
| A6.5 | Reliability / IntelligenceState | IntelligenceState（transient, 不持久化） | **无消费者** |

### 1.2 关键 Gap

**A6.5 IntelligenceState 当前无消费者**。这是 by design（Shadow-Only），但也意味着：

- 系统知道自己预测有多准，但无法将这个认知转化为行动建议
- 系统知道哪些 Prediction 互相冲突，但冲突只被标记不被解决
- 系统知道哪些模型不可靠，但无法告诉执行层"谨慎对待"
- 系统有完整的 Evidence Chain，但无法将其转化为可操作的建议

### 1.3 A6.6 要填补的 Gap

A6.6 填补 **"Intelligence → Actionable Insight"** 之间的最后一层：

```
IntelligenceState + Prediction + Evaluation + Experience
    ↓
  A6.6 Recommendation Engine
    ↓
  RecommendationCandidate[] (bounded, shadow, expired)
    ↓
  Future Decision Authority (不属 A6.6)
```

**不填补的 Gap（明确排除）**：
- 不填补"决定应该做什么"——这是 Decision Authority 的职责
- 不填补"执行建议"——这是各执行系统的职责
- 不填补"策略裁决"——这是 Policy/posture 的职责

---

## 二、A6.2 已有的 RecommendationCandidate

### 2.1 当前定义

```typescript
interface RecommendationCandidate {
  readonly recommendationId: string;
  readonly dimension: EvaluationDimension;
  readonly description: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly shadowOnly: true;
  readonly autoApply: false;
}
```

### 2.2 当前局限

| 局限 | 说明 |
|------|------|
| 仅从 Evaluation 生成 | 不消费 Prediction / Calibration / Reliability |
| 无 Category 分类 | 无法区分 Economic / Military / Expansion 等建议 |
| 无 Evidence Chain | 只有 rationale 字符串，无可追溯证据 |
| 无 Lifecycle | 无 TTL / Superseded / Expired |
| 无 Conflict 检测 | 两个矛盾的建议同时产出时无处理 |
| 无 "不推荐" 路径 | 始终产出建议，无法表达 "证据不足，不推荐" |
| 无 Urgency | 所有建议同等优先级 |
| 无 ValidityWindow | 建议永不过期 |
| 无 ContextSignature | 不支持 Regime 变化后失效 |

### 2.3 A6.6 需要扩展的能力

A6.6 不是修改 A6.2 的 `RecommendationCandidate`（A6.2 已冻结），而是在其上建立更完整的 Recommendation 层：

- 消费 A6.1–A6.5 全部 Canonical Output
- 建立多维 Evidence Chain
- 支持 NO_RECOMMENDATION
- 支持生命周期管理
- 支持冲突表达
- 支持 Regime 感知

---

## 三、输入来源审计

### 3.1 A6.6 可消费的 Canonical Output

| 来源 | 类型 | 可用信息 | 数据形态 |
|------|------|---------|---------|
| A6.1 Experience | ExperienceRecord[] | 决策历史 + 结果 + 归因 | `__experienceCache` Ring Buffer |
| A6.2 Evaluation | StrategyEvaluation[] | 8 维评分 + Baseline + Finding | `__evaluationCache` Ring Buffer |
| A6.3 Prediction | Prediction[] | 活跃预测 + 置信度 + 窗口 | `__predictionCache` Ring Buffer |
| A6.4 Calibration | ResolutionResult[] + Profile[] | 校准状态 + 模型质量 | `__calibrationCache` Ring Buffer |
| A6.5 Reliability | IntelligenceState | 可靠性 + 冲突 + 新鲜度 | 瞬态（函数返回值） |

### 3.2 禁止重算

A6.6 不得重新计算以下内容：
- ❌ 重新计算 Prediction（A6.3 的职责）
- ❌ 重新计算 Evaluation（A6.2 的职责）
- ❌ 重新计算 Calibration（A6.4 的职责）
- ❌ 重新实现 Attribution（A6.1 的职责）
- ❌ 重新建立 Metrics（A6.2 的 Canonical Dimensions）
- ❌ 重新计算 Reliability（A6.5 的职责）

### 3.3 DATA GAP 处理

如果某信息不存在：
- 标记 `DATA_GAP` 原因
- 产出 NO_RECOMMENDATION（而非伪造数据）
- 在 Evidence 中记录 "source=X, status=MISSING"

---

## 四、A6.6 不应覆盖的领域

### 4.1 明确排除

| 排除项 | 理由 |
|--------|------|
| 策略裁决 | Policy 纯函数（posture.ts）唯一裁决者 |
| 孵化决策 | SpawnManager 唯一 spawnCreep 调用者 |
| 扩张立项 | Empire（AgendaItem + G1–G5 门控） |
| 战争授权 | war posture 唯一授权链 |
| 建造签发 | ConstructionManager / RemoteMiningManager |
| 市场下单 | MarketManager 唯一写者 |
| 跨房调拨 | 帝国（terminal 网络 + 门控） |
| 恢复执行 | recovery-execution-system |
| 物流规划 | logistics-planner |
| 预算分配 | Policy（budget.ts） |

### 4.2 A6.6 的唯一产出

A6.6 只能产出 `RecommendationCandidate[]`，且：
- `shadowOnly: true`（literal type）
- `autoApply: false`（literal type）
- 不被任何执行系统读取
- 不写入 Memory
- 不修改 globalCache 中的任何业务状态

---

## 五、Gap 优先级矩阵

| Gap | Value | Evidence Availability | Risk | 建议优先级 |
|-----|-------|----------------------|------|-----------|
| 多维 Evidence Chain | HIGH | HIGH（A6.1–A6.5 已有） | LOW | P0 |
| NO_RECOMMENDATION 路径 | HIGH | N/A（设计约束） | LOW | P0 |
| 生命周期管理 | HIGH | MEDIUM | LOW | P1 |
| 冲突表达 | HIGH | MEDIUM（A6.5 已有冲突检测） | MEDIUM | P1 |
| Regime 感知 | MEDIUM | HIGH（A6.5 已有 RegimeFit） | LOW | P1 |
| Cache 方案 | MEDIUM | N/A（设计决策） | MEDIUM | P2 |
| 确定性排序 | MEDIUM | N/A（设计约束） | LOW | P2 |

---

## 六、结论

### 6.1 A6.6 可以安全进入 Research 阶段

理由：
1. A6.1–A6.5 已冻结，Canonical Output 明确
2. 无 Decision Authority 冲突（A6.6 不拥有任何决策权）
3. 输入来源明确（只读消费 A6.1–A6.5）
4. 产出明确（RecommendationCandidate[]，shadow-only）

### 6.2 A6.6 的核心 Gap

**A6.6 的核心不是"如何生成更好的建议"——而是"如何安全地生成可解释、可审计、可反事实验证的建议，同时确保不会变成第二套 Decision Authority"。**

### 6.3 最大风险

| 风险 | 严重度 | 缓解方案 |
|------|--------|---------|
| 隐式 Execution Path | CRITICAL | Shadow-Only + autoApply=false + 无执行系统读取 |
| 万能 Recommendation Score | HIGH | 禁止 recommendationScore，使用 Lexicographic ranking |
| 低 confidence Prediction → 高 confidence Recommendation | HIGH | Recommendation confidence ≤ 最低 Evidence confidence |
| 无限 Recommendation 历史 | MEDIUM | Bounded cache + TTL + GC |
| 非确定性排序 | MEDIUM | 禁止 Math.random/Date.now，使用 stable tie-breaker |
