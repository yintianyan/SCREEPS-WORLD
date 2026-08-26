# A6.6 CPU / Memory Contract — CPU 与内存契约

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码

---

## 一、Cadence / Priority / Phase

### 1.1 系统配置

| 参数 | 值 | 理由 |
|------|-----|------|
| Priority | P3 | 非关键路径，不影响生存/经济 |
| Phase | post | 在所有 A6.1–A6.5 完成后运行 |
| Interval | 500t | 与 calibration-resolution + intelligence-state 同频 |
| 位置 | 在 intelligence-state 之后 | 需要最新 IntelligenceState |

### 1.2 运行顺序

```
tick N (500t interval):
  P3: calibration-resolution-system.run()   ← A6.4
  P3: intelligence-state-system.run()       ← A6.5
  P3: recommendation-engine-system.run()    ← A6.6（本阶段）
```

### 1.3 降级合同

| CPU 档位 | A6.6 行为 |
|---------|----------|
| Healthy | 正常运行 |
| Guarded | 正常运行 |
| Conserve | 跳过（interval 延长到 1000t） |
| Recovery | 跳过 |

**Recovery 档位跳过**: 帝国生存优先于 Intelligence 建议。A6.6 是 P3 设施，Recovery 时完全冻结。

---

## 二、CPU 预算分析

### 2.1 单次运行 CPU 开销

| 步骤 | 操作 | 估计 CPU | 理由 |
|------|------|---------|------|
| 1. 读取 A6.1–A6.5 数据 | Ring Buffer 只读遍历 | ~0.05ms | Ring Buffer 已在内存，只遍历引用 |
| 2. 构建 Evidence | 遍历 Prediction/Evaluation/Conflict | ~0.10ms | ≤ 10 predictions + ≤ 50 evaluations |
| 3. 生成 Recommendation | 纯函数计算 | ~0.05ms | 规则匹配，无复杂计算 |
| 4. 冲突检测 | Recommendation 间比较 | ~0.02ms | ≤ 10 candidates → C(10,2)=45 对比 |
| 5. 生命周期管理 | TTL / Supersede / GC | ~0.01ms | ≤ 50 条 cache 检查 |
| 6. 排序 | 确定性 tie-breaker | ~0.01ms | ≤ 10 条排序 |
| 7. Hash 计算 | FNV-1a32 | ~0.01ms | ≤ 10 条 |
| **总计** | | **~0.25ms** | **远低于 1ms 预算** |

### 2.2 批量运行 CPU 开销

| 场景 | 预计 CPU | 约束 |
|------|---------|------|
| 单次运行（500t interval） | ~0.25ms | < 1ms |
| 100 次（50000t ≈ 5M tick） | ~25ms（累积） | 分散在 50000t |
| 最坏情况（10 candidates + 50 evidence + 10 conflicts） | ~0.5ms | < 1ms |

### 2.3 CPU 预算上限

```
A6.6 单次运行 CPU 上限 = 1ms
如果超过 1ms → 跳过当前 tick，下次重试
```

---

## 三、Memory 预算分析

### 3.1 `__recommendationCache`

| 字段 | 单条大小 | 50 条总大小 |
|------|---------|------------|
| recommendationId | ~20 bytes | 1KB |
| category | ~15 bytes | 0.75KB |
| target | ~20 bytes | 1KB |
| description | ~100 bytes | 5KB |
| rationale | ~200 bytes | 10KB |
| evidence[] | ~500 bytes（10 items × 50 bytes） | 25KB |
| expectedBenefit / Cost | ~20 bytes | 1KB |
| confidence | ~10 bytes | 0.5KB |
| urgency | ~10 bytes | 0.5KB |
| validityWindow | ~20 bytes | 1KB |
| contextSignature | ~30 bytes | 1.5KB |
| conflicts[] | ~50 bytes | 2.5KB |
| alternatives[] | ~50 bytes | 2.5KB |
| hash | ~10 bytes | 0.5KB |
| status | ~10 bytes | 0.5KB |
| **总计** | **~1.1KB/条** | **~55KB** |

### 3.2 Memory 上限

```
__recommendationCache:
  capacity = 50
  maxBytes = 64KB  // 硬上限
  GC: maxAge = 5000t
  淘汰策略: FIFO + TTL
```

### 3.3 不持久化

- `__recommendationCache` 只存在于 heap
- 不写入 Memory / RawMemory
- Global reset 可丢（下个周期重建）

### 3.4 与 A6.5 对比

| 维度 | A6.5 IntelligenceState | A6.6 RecommendationCache |
|------|----------------------|--------------------------|
| 持久化 | ❌ 不持久化 | ❌ 不持久化 |
| Cache | 无（只读投影） | Bounded cache (50 条) |
| 内存 | ~2KB（瞬态） | ~55KB（bounded） |
| 频率 | 每 500t | 每 500t |

---

## 四、Evidence 遍历 CPU 约束

### 4.1 遍历上限

| 操作 | 上限 | 理由 |
|------|------|------|
| 单次 Evidence 生成 | ≤ 100 items | 10 candidates × 10 evidence max |
| Prediction 遍历 | ≤ 10 条 | A6.3 Ring Buffer active predictions ≤ 10 |
| Evaluation 遍历 | ≤ 50 条 | A6.2 Ring Buffer capacity=50 |
| Experience 遍历 | ≤ 50 条 | A6.1 Ring Buffer capacity=50 |
| Calibration 遍历 | ≤ 50 条 | A6.4 Ring Buffer capacity=50 |
| Conflict 遍历 | ≤ 5 条 | A6.5 PredictionConflict ≤ 5 |

### 4.2 禁止全量遍历

- ❌ 不遍历整个 `__experienceCache`
- ❌ 不遍历整个 `__evaluationCache`
- ❌ 不遍历整个 `__predictionCache`
- ✅ 只遍历最近 N 条（N ≤ 50）
- ✅ 只遍历 active predictions

---

## 五、Bounded Memory 约束

### 5.1 所有数据结构有界

| 结构 | 容量 | GC |
|------|------|-----|
| `__recommendationCache` | 50 条 | maxAge=5000t |
| Evidence items per Recommendation | 10 | N/A |
| Recommendation candidates per run | 10 | N/A |
| Conflict markers per run | 10 | N/A |
| NoRecommendation records per run | 5 | N/A |

### 5.2 禁止无界增长

| 禁止 | 理由 |
|------|------|
| 无限 Recommendation 历史 | 内存爆炸 |
| 无限 Evidence 链 | CPU 爆炸 |
| 无限 Conflict 记录 | 内存爆炸 |
| 无限 Supersede 链 | 深度 ≤ 3 |

---

## 六、CPU / Memory 守卫

### 6.1 运行时守卫

| Guard ID | 检查内容 | 失败处理 |
|----------|---------|---------|
| REC-CPU-001 | 单次运行 < 1ms | 跳过 + console.log |
| REC-MEM-001 | Cache size ≤ 64KB | 淘汰最旧 |
| REC-MEM-002 | Cache count ≤ 50 | 淘汰最旧 |
| REC-MEM-003 | Evidence count ≤ 10 per rec | 截断 |
| REC-MEM-004 | No unbounded arrays | 编译时检测 |

### 6.2 测试基准

| 测试 | 阈值 | 说明 |
|------|------|------|
| 单次运行 CPU | < 1ms | 10 candidates + 50 evidence |
| 100 次运行 CPU | < 100ms | 累积 |
| Cache 序列化 | < 64KB | 50 条 |
| Hash 计算一致性 | 1000× replay | 确定性 |

---

## 七、结论

**A6.6 的 CPU 和 Memory 开销远低于预算。**

- 单次运行 ~0.25ms（预算 1ms）
- Cache 总大小 ~55KB（预算 64KB）
- 频率 500t（低频）
- Priority P3（最低优先级）
- Recovery 档位完全冻结

**CPU 和 Memory 可控。**
