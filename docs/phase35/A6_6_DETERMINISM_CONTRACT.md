# A6.6 Determinism Contract — 确定性契约

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码

---

## 一、确定性原则

### 1.1 核心原则

**相同输入 → 相同输出。**

A6.6 必须是确定性的：
- 相同的 A6.1–A6.5 数据 → 相同的 RecommendationCandidate[]
- 相同的 RecommendationCandidate → 相同的 recommendationHash
- 1000 次 replay → hash 完全一致

### 1.2 禁止的非确定性来源

| 来源 | 禁止方式 |
|------|---------|
| `Math.random()` | 禁止使用 |
| `Date.now()` | 禁止使用 |
| `new Date()` | 禁止使用 |
| `Game.time` (在 Domain 层) | 禁止使用（由 System 层注入 `tick`） |
| `performance.now()` | 禁止使用 |
| `Map` 遍历顺序 | 不作为最终排序依据 |
| `Set` 遍历顺序 | 不作为最终排序依据 |
| `Object.keys()` 遍历顺序 | 不作为最终排序依据 |
| `for...in` 遍历顺序 | 不作为最终排序依据 |

---

## 二、排序设计

### 2.1 Recommendation 排序规则

**禁止万能 Score，使用 Lexicographic ranking。**

排序 key（按优先级从高到低）：

| 优先级 | 字段 | 类型 | 方向 | 说明 |
|--------|------|------|------|------|
| 1 | urgency | enum | DESC | CRITICAL > HIGH > MEDIUM > LOW |
| 2 | confidence | number | DESC | 高 confidence 优先 |
| 3 | category | string | ASC | 字典序（稳定 tie-breaker） |
| 4 | target | string | ASC | 字典序（稳定 tie-breaker） |
| 5 | recommendationId | string | ASC | 最终 tie-breaker（唯一） |

### 2.2 Urgency 枚举

```typescript
type RecommendationUrgency = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
```

排序映射：
```
CRITICAL → 4
HIGH → 3
MEDIUM → 2
LOW → 1
```

### 2.3 排序实现（概念）

```typescript
// 概念设计（非实现）
function sortRecommendations(recs: RecommendationCandidate[]): RecommendationCandidate[] {
  return [...recs].sort((a, b) => {
    // 1. Urgency (DESC)
    const ua = URGENCY_RANK[a.urgency];
    const ub = URGENCY_RANK[b.urgency];
    if (ua !== ub) return ub - ua;
    // 2. Confidence (DESC)
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.0001) return confDiff > 0 ? 1 : -1;
    // 3. Category (ASC)
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    // 4. Target (ASC)
    if (a.target !== b.target) return a.target < b.target ? -1 : 1;
    // 5. recommendationId (ASC, 最终 tie-breaker)
    return a.recommendationId < b.recommendationId ? -1 : 1;
  });
}
```

### 2.4 禁止 Map/Set 非显式排序

Map 和 Set 的遍历顺序是插入顺序，不是确定性顺序。

**规则**：
- 如果使用 Map/Set 收集数据，最终输出前必须排序
- 排序必须使用上述 5 级 lexicographic 规则
- 禁止依赖 Map/Set 的插入顺序作为最终顺序

---

## 三、Hash 确定性

### 3.1 Recommendation Hash

```typescript
function computeRecommendationHash(rec: RecommendationCandidate): string {
  return fnv1a32Hex(stableStringify({
    category: rec.category,
    target: rec.target,
    evidence: rec.evidence.map(e => e.evidenceHash).sort(),
    expectedBenefit: rec.expectedBenefit?.toFixed(6) ?? "N/A",
    expectedCost: rec.expectedCost?.toFixed(6) ?? "N/A",
    confidence: rec.confidence.toFixed(6),
    urgency: rec.urgency,
    contextSignature: rec.contextSignature,
    shadowOnly: true,   // literal
    autoApply: false,    // literal
  }));
}
```

### 3.2 stableStringify 约束

复用 A6.3 的 `stableStringify` + `fnv1a32Hex`：
- key 排序
- 浮点 `toFixed(6)` 截断
- 无 undefined / null（用 "N/A" 替代）
- 数组按 `sort()` 排序

### 3.3 Evidence Hash

```typescript
function computeEvidenceHash(evidence: EvidenceItem): string {
  return fnv1a32Hex(stableStringify({
    evidenceId: evidence.evidenceId,
    source: evidence.source,
    sourceId: evidence.sourceId,
    type: evidence.type,
    value: evidence.value,
    confidence: evidence.confidence.toFixed(6),
    collectedAt: evidence.collectedAt,
  }));
}
```

### 3.4 确定性验证

| 测试 | 方法 | 阈值 |
|------|------|------|
| 单 Recommendation hash | 1000× replay | 100% 一致 |
| Evidence hash | 1000× replay | 100% 一致 |
| Recommendation 列表排序 | 1000× replay | 100% 一致 |
| Recommendation ID 生成 | 确定性公式 | `R-{tick}-{seq}` |

---

## 四、Recommendation ID 生成

### 4.1 确定性 ID

```typescript
function makeRecommendationId(tick: number, seq: number): string {
  return `R-${tick}-${seq}`;
}
```

- `tick`：System 层注入的 `ctx.tick`（来自 `Game.time`，但 Domain 层不直接访问）
- `seq`：单次运行内的递增序号（从 0 开始）
- 禁止 `Math.random()` / `Date.now()`

### 4.2 Evidence ID 生成

```typescript
function makeEvidenceId(tick: number, seq: number): string {
  return `E-${tick}-${seq}`;
}
```

### 4.3 Conflict ID 生成

```typescript
function makeConflictId(tick: number, seq: number): string {
  return `C-${tick}-${seq}`;
}
```

---

## 五、浮点处理

### 5.1 浮点截断规则

| 字段 | 截断精度 | 方法 |
|------|---------|------|
| confidence | 6 位小数 | `toFixed(6)` |
| expectedBenefit | 6 位小数 | `toFixed(6)` |
| expectedCost | 6 位小数 | `toFixed(6)` |
| severity | 6 位小数 | `toFixed(6)` |

### 5.2 比较规则

```
// 禁止
if (a.confidence > b.confidence) { ... }

// 正确
if (a.confidence - b.confidence > 0.0001) { ... }  // 有意义的差异
```

### 5.3 Hash 中禁止浮点误差

```
// 禁止
hash = fnv1a32Hex(JSON.stringify(rec));  // 浮点序列化不确定

// 正确
hash = fnv1a32Hex(stableStringify({
  ...rec,
  confidence: rec.confidence.toFixed(6),  // 截断后确定
}));
```

---

## 六、遍历确定性

### 6.1 所有遍历必须排序

| 遍历对象 | 排序 key |
|---------|---------|
| Prediction[] | predictionId (ASC) |
| Evaluation[] | evaluationHash (ASC) |
| Experience[] | experienceId (ASC) |
| ResolutionResult[] | resolutionHash (ASC) |
| PredictionConflict[] | conflictId (ASC) |
| EvidenceItem[] | evidenceId (ASC) |
| RecommendationCandidate[] | urgency → confidence → category → target → id |

### 6.2 禁止无序遍历

```typescript
// 禁止 — Map 遍历顺序不确定
for (const [key, value] of someMap) { ... }

// 正确 — 排序后遍历
const sortedKeys = [...someMap.keys()].sort();
for (const key of sortedKeys) {
  const value = someMap.get(key);
  ...
}
```

---

## 七、ContextSignature 确定性

### 7.1 复用 A6.5 的 ContextSignature

```typescript
// A6.6 使用 A6.5 的 buildPredictionContextSignature
const contextSignature = buildPredictionContextSignature(currentContext);
```

### 7.2 确定性保证

- ContextSignature 由 A6.3/A6.5 保证确定性
- A6.6 不修改 ContextSignature 计算逻辑
- 1000× replay → 相同 ContextSignature

---

## 八、结论

**A6.6 的确定性可证明。**

核心原则：
1. 禁止 Math.random / Date.now / wall clock
2. 排序使用 5 级 Lexicographic ranking
3. 所有遍历排序后执行
4. 浮点 toFixed(6) 截断
5. Hash 使用 stableStringify + FNV-1a32
6. Recommendation ID 确定性生成
7. 1000× replay → 100% hash 一致

**Determinism 可证明。**
