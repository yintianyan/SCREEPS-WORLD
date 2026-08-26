# A6.6 Lifecycle — Recommendation 生命周期

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码

---

## 一、生命周期状态

### 1.1 六态定义

```
    Created ──→ Valid ──→ Expired
                 │           ↑
                 ├──→ Superseded
                 │
                 ├──→ Rejected
                 │
                 └──→ Accepted
```

| 状态 | 语义 | 进入条件 | 退出条件 |
|------|------|---------|---------|
| Created | 建议已生成 | A6.6 产出 RecommendationCandidate | 验证通过 → Valid / 验证失败 → Rejected |
| Valid | 建议有效且可被消费 | 通过 Evidence 验证 + TTL 未过期 | TTL 到期 → Expired / 被 Superseded / 被 Accepted / 被 Rejected |
| Expired | 建议已过期 | TTL 到期 或 上游数据失效 | 终态（被 GC 回收） |
| Superseded | 被新版本替代 | 同 category + target 的新 Recommendation 产出 | 终态（被 GC 回收） |
| Rejected | 被拒绝 | Evidence 不足 / confidence 过低 / 冲突过严重 | 终态（被 GC 回收） |
| Accepted | 被上层采纳 | 未来 Decision Authority 标记 | 终态（保留更久用于反馈循环） |

### 1.2 Accepted ≠ Executed

**关键约束**: Accepted 只能表示"上层 Decision Authority 采纳了这个建议"。

A6.6 本身不能执行。Accepted 的 Recommendation 仍然只是建议——执行由现有 Decision Authority 按自己的流程完成。

---

## 二、TTL (Time To Live)

### 2.1 TTL 设计

每条 Recommendation 有 `validityWindow`：

```typescript
interface RecommendationValidity {
  readonly createdTick: number;
  readonly expiresTick: number;  // createdTick + TTL
  readonly ttl: number;  // ticks
}
```

### 2.2 TTL 分类

| Category | 默认 TTL | 理由 |
|----------|---------|------|
| Economic | 1000 | 经济趋势变化较慢 |
| Expansion | 2000 | 扩张决策周期长 |
| Defense | 500 | 威胁变化快 |
| Military | 1000 | 战争决策周期中 |
| Logistics | 500 | 物流变化快 |
| Spawn | 300 | Spawn 饥饿变化快 |
| Recovery | 500 | 恢复窗口紧急 |
| Posture | 2000 | Posture 变化慢 |

### 2.3 TTL 过期处理

```
if (currentTick > recommendation.expiresTick) {
  recommendation.status = "expired";
  // 过期 Recommendation 不得被消费为当前建议
}
```

---

## 三、ContextSignature 与 Regime 变化

### 3.1 ContextSignature

每条 Recommendation 记录生成时的 ContextSignature（复用 A6.5 的 Regime 签名）：

```typescript
// Recommendation 生成时记录
contextSignature: string;  // 如 "peace-healthy-2-3-low"
```

### 3.2 Regime 变化检测

如果当前 Regime 与 Recommendation 的 contextSignature 不同：

```
currentSignature = "war-recovery-1-1-high"
recommendation.contextSignature = "peace-healthy-2-3-low"
→ Regime mismatch → Recommendation 标记为 stale
→ stale Recommendation confidence × 0.5
→ 如果降级后 < 阈值 → 转 NO_RECOMMENDATION
```

### 3.3 Regime 变化导致失效

如果 Regime 变化涉及 posture 切换（如 peace → war）：

```
posture in contextSignature = "peace"
current posture = "war"
→ Recommendation 失效（不只是降级）
→ status → expired (reason: regime_changed)
```

---

## 四、Prediction Horizon 影响

### 4.1 Recommendation 不得超出 Evidence 的 Prediction Horizon

```
Prediction.window.endTick = tick + 2000
Recommendation.expiresTick ≤ Prediction.window.endTick
```

**理由**: Recommendation 基于 Prediction，Prediction 过期后 Recommendation 也应过期。

### 4.2 多 Prediction 的最小 Horizon

如果 Recommendation 依赖多个 Prediction：

```
recommendation.expiresTick = min(allPrediction.endTicks)
```

---

## 五、Evidence Freshness 影响

### 5.1 A6.5 FreshnessSummary

A6.5 的 `knowledgeFreshness` 提供数据新鲜度：

| Freshness | 影响 |
|-----------|------|
| FRESH (< 5000t) | 无影响 |
| RECENT (< 20000t) | confidence × 0.9 |
| STALE (< 50000t) | confidence × 0.7 |
| EXPIRED (> 50000t) | confidence × 0.3 |
| COLD_START (无数据) | → NO_RECOMMENDATION |

### 5.2 Freshness 检查

```
for each evidence in recommendation.evidence:
  freshness = computeFreshness(evidence.collectedAt, currentTick)
  if freshness == "EXPIRED":
    recommendation.confidence × 0.3
  if freshness == "COLD_START":
    → NO_RECOMMENDATION (reason: insufficient_evidence)
```

---

## 六、Supersede 规则

### 6.1 何时 Supersede

同 category + target 的新 Recommendation 产出时，旧 Recommendation 被 Superseded：

```
if (newRec.category == oldRec.category && newRec.target == oldRec.target) {
  oldRec.status = "superseded";
  oldRec.supersededBy = newRec.recommendationId;
  newRec.supersedes = oldRec.recommendationId;
}
```

### 6.2 Supersede 链

```
R-v1 → superseded by R-v2 → superseded by R-v3
```

- Supersede 链深度 ≤ 3（防止无限链）
- 超过 3 时最早的记录直接 Expired + GC
- Supersede 不保留历史数据，只保留 recommendationId 引用

---

## 七、GC (Garbage Collection)

### 7.1 GC 触发条件

| 条件 | 操作 |
|------|------|
| status = expired + age > 1000t | 删除 |
| status = superseded + age > 500t | 删除 |
| status = rejected + age > 500t | 删除 |
| status = accepted + age > 5000t | 删除（保留更久用于反馈） |
| Cache 超过 maxCapacity | 淘汰最旧 |

### 7.2 GC 频率

- 与 A6.6 System 同频率运行
- 每次 run 都检查 GC
- 不额外消耗 CPU（与 Recommendation 生成同步）

### 7.3 Bounded Cache

```
__recommendationCache:
  capacity = 50
  GC: maxAge = 5000t
  淘汰策略: FIFO + TTL
```

---

## 八、生命周期不变式

### 8.1 状态转换合法性

| 从 → 到 | 合法? | 条件 |
|---------|:-----:|------|
| Created → Valid | ✅ | Evidence 验证通过 |
| Created → Rejected | ✅ | Evidence 不足 / confidence 过低 |
| Valid → Expired | ✅ | TTL 到期 |
| Valid → Superseded | ✅ | 新版本产出 |
| Valid → Accepted | ✅ | 上层标记 |
| Valid → Rejected | ✅ | 条件变化导致不再有效 |
| Expired → (任何) | ❌ | 终态 |
| Superseded → (任何) | ❌ | 终态 |
| Rejected → (任何) | ❌ | 终态 |
| Accepted → Expired | ✅ | TTL 到期 |

### 8.2 不可变式

- RecommendationCandidate 一旦创建，其字段不可修改
- 状态变更只修改 `status` 字段和 `supersededBy` / `supersedes` 字段
- Evidence 不可修改

---

## 九、结论

**A6.6 的 Lifecycle 确保 Recommendation 有界、可过期、可追溯、可被替代。**

核心原则：
1. 每条 Recommendation 有 TTL
2. Regime 变化导致失效
3. Accepted ≠ Executed
4. Supersede 链深度 ≤ 3
5. Bounded cache + GC
6. 过期 Recommendation 不得被消费为当前建议
