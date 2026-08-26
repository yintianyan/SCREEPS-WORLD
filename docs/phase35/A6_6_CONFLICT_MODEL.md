# A6.6 Conflict Model — 冲突模型

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码

---

## 一、冲突类型定义

### 1.1 三种冲突层级

| 层级 | 定义 | 来源 | A6.6 处理 |
|------|------|------|-----------|
| Evidence Conflict | 两个 Evidence Item 互相矛盾 | A6.5 PredictionConflict | 标记，不裁决 |
| Recommendation Conflict | 两个 Recommendation 互相矛盾 | A6.6 产出 | 标记，不裁决 |
| Recommendation Alternative | 两个 Recommendation 可互替 | A6.6 产出 | 标记，不选择 |

### 1.2 核心原则

**A6.6 不得偷偷选择。**

```
// 禁止
if (recA.confidence > recB.confidence) {
  return [recA];  // 隐藏 recB
}

// 正确
return [recA, recB, conflictMarker];
```

---

## 二、Evidence Conflict

### 2.1 来源

A6.5 的 `PredictionConflict` 已检测预测之间的矛盾：

```typescript
interface PredictionConflict {
  conflictId: string;
  type: "logical" | "temporal" | "evidence" | "regime";
  predictionIds: string[];
  description: string;
  severity: number;  // 0-1
  conflictHash: string;
}
```

### 2.2 典型场景

**场景: Energy Shortage + Expansion Readiness**

```
Prediction A: energy-shortage, confidence=0.8, value=5000
Prediction B: expansion-readiness, confidence=0.7, value=0.8

A6.5 检测: logical conflict — 能量不足时不应扩张
A6.5 产出: PredictionConflict { severity: 0.8 }
```

### 2.3 A6.6 如何消费

A6.6 消费 PredictionConflict，产出：

```
RecommendationCandidate {
  category: "EXPANSION",
  recommendationId: "R-expansion-hold",
  description: "Expansion readiness high but energy shortage predicted",
  conflicts: ["C-energy-vs-expansion"],  // 指向 PredictionConflict
  alternatives: ["R-economic-stabilize"],
  confidence: 0.3,  // 降级，因为有冲突
  ...
}
```

**关键**: confidence 因冲突降级，但不选择"经济优先"或"扩张优先"——由上层裁决。

---

## 三、Recommendation Conflict

### 3.1 定义

两个 Recommendation 互相矛盾：如果执行 A 则不应执行 B。

### 3.2 RecommendationConflict 类型

```typescript
interface RecommendationConflict {
  conflictId: string;
  type: "mutual_exclusion" | "resource_competition" | "temporal_clash";
  recommendationIds: string[];  // 参与冲突的 Recommendation ID
  description: string;
  severity: number;  // 0-1
  detectedAt: number;
  conflictHash: string;
}
```

### 3.3 冲突检测规则

| 规则 ID | 类型 | 条件 A | 条件 B | 严重度 |
|--------|------|--------|--------|--------|
| RC-001 | mutual_exclusion | EXPANSION rec | ECONOMIC rec (stabilize) | 0.8 |
| RC-002 | mutual_exclusion | MILITARY rec (attack) | RECOVERY rec (defensive) | 0.9 |
| RC-003 | resource_competition | SPAWN rec (increase) | ECONOMIC rec (reduce spending) | 0.6 |
| RC-004 | temporal_clash | EXPANSION rec (now) | DEFENSE rec (fortify now) | 0.7 |

### 3.4 冲突不解决

A6.6 检测冲突并标记在 Recommendation.conflicts[] 中，但：
- ❌ 不按 confidence 选择"赢"的 Recommendation
- ❌ 不隐藏低 confidence 的 Recommendation
- ❌ 不合并冲突的 Recommendation
- ✅ 产出所有冲突的 Recommendation + 冲突标记
- ✅ 冲突降低所有参与方 confidence

---

## 四、Recommendation Alternative

### 4.1 定义

两个 Recommendation 可互替：执行 A 或 B 都可达到类似目标。

### 4.2 Alternative 类型

```typescript
interface RecommendationAlternative {
  alternativeId: string;
  recommendationIds: string[];
  description: string;
  selectionCriteria: string;  // 描述选择标准（但不执行选择）
}
```

### 4.3 典型场景

```
Recommendation A: "增加 hauler 配额解决物流瓶颈"
Recommendation B: "优化搬运路径减少 hauler 需求"

Alternative: "A 和 B 都可解决物流问题"
SelectionCriteria: "A 见效快但消耗能量；B 见效慢但长期更优"
```

---

## 五、"不推荐" (NO_RECOMMENDATION)

### 5.1 必须支持

Recommendation Engine **不强制** RecommendSomething。

### 5.2 NO_RECOMMENDATION 原因

| 原因 | 说明 | confidence 条件 |
|------|------|-----------------|
| INSUFFICIENT_EVIDENCE | Evidence 数量不足（< 最少集合） | 任一 Evidence confidence = 0 |
| LOW_CONFIDENCE | 综合 confidence < 阈值 | < 0.3 |
| REGIME_MISMATCH | 当前 Regime 与 Evidence 采集时不同 | regimeFit = false |
| CONFLICTING_EVIDENCE | 两个强 Evidence 互相矛盾且无法降级 | severity > 0.8 |
| EXTERNAL_INTERFERENCE | 检测到外部因素干扰 | hasExternalFactor = true |
| NO_MATERIAL_BENEFIT | 预期收益不显著 | expectedBenefit < 0.1 |
| HIGH_RISK | 风险过高 | expectedCost / expectedBenefit > 10 |
| NOT_ACTIONABLE | 建议无法被上层转译为行动 | 无法找到 Decision Authority |

### 5.3 NO_RECOMMENDATION 输出

```typescript
interface NoRecommendation {
  category: RecommendationCategory;
  reason: NoRecommendationReason;
  evidence: EvidenceItem[];  // 解释为什么不推荐
  confidence: number;  // 通常 0
  assessedAt: number;
  hash: string;
}
```

### 5.4 NO_RECOMMENDATION 的重要性

**能说"我不建议"比强行输出建议更重要。**

这不是系统的"无能"——而是系统的"诚实"。强行输出低质量建议比不输出更危险。

---

## 六、冲突的 Lifecycle

### 6.1 冲突的生命周期

```
Conflict Detected
  → 标记在 Recommendation.conflicts[]
  → 参与 Recommendation confidence 降级
  → 如果降级后 < 阈值 → 转为 NO_RECOMMENDATION
  → 如果降级后仍 ≥ 阈值 → 保留 + 冲突标记
  → 上层 Decision Authority 裁决
```

### 6.2 冲突的消失

冲突在以下条件消失：
- 参与的 Recommendation 过期（TTL 到期）
- 参与的 Recommendation 被 Superseded
- 上游 Prediction 过期/失效
- Regime 变化导致冲突条件不再满足

---

## 七、结论

**A6.6 的 Conflict Model 确保冲突被显式表达，不被偷偷解决。**

核心原则：
1. 冲突被检测并标记，不裁决
2. 低 confidence Prediction 不能产生高 confidence Recommendation
3. 冲突降级所有参与方 confidence
4. NO_RECOMMENDATION 比强行建议更重要
5. 冲突随 Recommendation 生命周期消失
