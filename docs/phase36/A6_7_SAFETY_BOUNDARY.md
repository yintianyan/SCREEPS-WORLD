# A6.7 Safety Boundary — 安全边界与 Shadow-Only 约束

> **Phase**: 36
> **Date**: 2026-08-26
> **Status**: RESEARCH / NO IMPLEMENTATION
> **基线**: A6.6 REC-001~014 守卫体系 + A6.0 Shadow-Only 冻结契约

---

## 一、A6.7 Shadow-Only 扩展

A6.7 继承 A6.6 的 Shadow-Only 原则，不扩展任何执行权限：

**Shadow-Only = 只读、只汇总、只格式化、不执行、不决定、不修改**

| 允许 | 禁止 |
|------|------|
| 只读消费 `__recommendationCache` | 写入任何 A6 cache |
| 只读消费 `IntelligenceState`（瞬态） | 修改 Memory |
| 只读消费 `__experienceCache` / `__evaluationCache` / `__predictionCache` / `__calibrationCache` | 修改 globalCache 任何字段 |
| 计算汇总统计 | 调用 Game API |
| 格式化 console.log 输出 | 修改 Strategy / Posture / Spawn |
| 运行 CON-XXX 守卫检查 | 提交任何执行请求 |
| | 创建新 Decision Authority |
| | 创建第二套 Metrics |
| | 创建第二套 Strategy |

---

## 二、CON-XXX 守卫体系（拟）

| Guard ID | 名称 | 检查内容 | 失败处理 |
|----------|------|---------|---------|
| CON-001 | Read-Only | 不写入任何 cache | console.log 告警 |
| CON-002 | Domain Purity | Domain 函数不引用 Game/Memory | 编译/测试时发现 |
| CON-003 | No Game API | 不调用 Game API | safeRun 隔离 |
| CON-004 | No Runtime Mutation | 不修改任何运行时状态 | console.log 告警 |
| CON-005 | Deterministic | 相同输入 → 相同输出 | 测试失败 |
| CON-006 | No Execution Leak | 无执行系统 import A6.7 输出 | 编译时检测 |
| CON-007 | No Strategy Mutation | 不修改 Strategy/Posture | console.log 告警 |
| CON-008 | No Decision Authority | 不裁决、不选择、不采纳 | console.log 告警 |
| CON-009 | No Score | 不产出 recommendationScore / overallScore | console.log 告警 |
| CON-010 | No Second Metrics | 不创建第二套 Metrics 系统 | console.log 告警 |
| CON-011 | No Auto Apply | 不自动执行任何 Recommendation | 编译时强制 |
| CON-012 | No New Sampler | 不创建新采样通道 | console.log 告警 |
| CON-013 | No Math.random/Date.now | 确定性约束 | 测试失败 |
| CON-014 | Bounded Output | console.log 输出有长度上限 | 截断 |

---

## 三、与 A6.6 REC 守卫的继承关系

| A6.6 REC | A6.7 CON | 继承方式 |
|-----------|---------|---------|
| REC-001 (Bounded Cache) | CON-001 (Read-Only) | 更严格：不写入任何 cache |
| REC-002 (Domain Purity) | CON-002 | 同样检查 |
| REC-003 (No Game API) | CON-003 | 同样检查 |
| REC-004 (No Runtime Mutation) | CON-004 | 同样检查 |
| REC-005 (Deterministic) | CON-005 | 同样检查 |
| REC-006 (No Execution Leak) | CON-006 | 同样检查 |
| REC-007 (No Strategy Mutation) | CON-007 | 同样检查 |
| REC-008 (No Decision Authority) | CON-008 | 同样检查 |
| REC-009 (No Score) | CON-009 | 同样检查 |
| REC-010 (Evidence Traceability) | N/A | A6.7 不产出 Recommendation，只汇总 |
| REC-011 (No Auto Apply) | CON-011 | 同样检查 |
| REC-012 (No Unbounded History) | CON-014 (Bounded Output) | 改为输出有界 |
| REC-013 (TTL Enforcement) | N/A | A6.7 不管理 TTL |
| REC-014 (No Random) | CON-013 | 同样检查 |

---

## 四、Consumption Boundary 设计

### 4.1 当前状态

A6.6 已导出 3 个查询函数：
- `getRecommendations(limit)` — 返回最近 N 条
- `getActiveRecommendationList()` — 返回 active Recommendations
- `printRecommendationDashboard()` — 返回 console 字符串

**当前无执行系统调用这些函数。** 仅控制台手动调用。

### 4.2 A6.7 边界

A6.7 不新增执行系统可调用的接口。A6.7 只新增：
1. **Domain 纯函数**（汇总统计）— 不被任何 System import 用于执行
2. **System 层薄壳**（低频 console.log 输出）— 只写 console，不写 cache

### 4.3 未来消费约束

如果未来某个 A5 执行系统需要只读参考 Recommendation：

1. 该执行系统必须在其 **自身 Authority 范围内** 决策
2. 调用 `getRecommendationSummary()` 获取只读摘要
3. 最终裁决权永远属于该执行系统的已有 Authority
4. **A6.7 不在这个链路中执行任何操作**

```
A6.6 __recommendationCache
    ↓ (只读查询)
A6.7 getRecommendationSummary()
    ↓ (只读返回)
A5 Execution System (e.g., posture.ts)
    ↓ (自身 Authority 裁决)
    ↓ 最终行为
```

**关键：A6.7 不在裁决链中，只是信息中转。**

---

## 五、退化防护

### 5.1 A6.7 最容易的退化路径

```
A6.7 Consumption Boundary
  → "Recommendation 建议扩张，应该执行"        ← 退化 1: 隐式执行
  → "Intelligence 显示模型 drift，应该降级"    ← 退化 2: 策略干预
  → "多条 Recommendation 冲突，应该选择最好的" ← 退化 3: 冲突裁决
  → "建议 score > 0.8，应该自动采纳"          ← 退化 4: 万能分数
  → "历史建议效果好，应该批量执行"             ← 退化 5: 批量执行
  → "Intelligence 说模型不可靠，应该停止使用"  ← 退化 6: 模型退役
```

### 5.2 退化防护守卫

| 退化路径 | 守卫 | 检查方式 |
|---------|------|---------|
| 退化 1: 隐式执行 | CON-006 + CON-011 | 无执行系统 import + 不自动执行 |
| 退化 2: 策略干预 | CON-007 | 禁止修改 Strategy/Posture |
| 退化 3: 冲突裁决 | CON-008 | 禁止 selectBest/resolveConflict |
| 退化 4: 万能分数 | CON-009 | 禁止 recommendationScore 字段 |
| 退化 5: 批量执行 | CON-006 + CON-008 | 无执行 + 无自主采纳 |
| 退化 6: 模型退役 | CON-008 | 禁止 retireModel/promoteModel |

---

## 六、与 A6.0 冻结契约的一致性

| A6.0 要求 | A6.7 遵守 | 验证 |
|-----------|:---------:|------|
| 不调用 Game API | ✅ | CON-003 |
| 不修改 Strategy | ✅ | CON-007 |
| 不修改 Posture | ✅ | CON-007 |
| 不修改 Spawn | ✅ | CON-004 |
| 不修改 Military | ✅ | CON-004 |
| 不修改 Logistics | ✅ | CON-004 |
| 不修改 Recovery | ✅ | CON-004 |
| 不修改 Economy | ✅ | CON-004 |
| 不发送执行命令 | ✅ | CON-003 + CON-006 |
| 输出只在 console.log | ✅ | CON-001 + CON-014 |

**A6.7 与 A6.0 冻结契约完全一致。**

---

## 七、A6 Shutdown Safety

如果 A6.7 系统完全不运行：

| 依赖方 | 影响 | 严重度 |
|--------|------|--------|
| `bootstrap.ts` | 系统不注册，`kernel.run()` 跳过 | 无 |
| console.log | Dashboard 不输出 | 无（仅日志缺失） |
| A5 执行系统 | 不受影响（不依赖 A6.7） | 无 |
| A6.1–A6.6 | 不受影响（A6.7 只读消费，不写入） | 无 |

**A6.7 完全停止时帝国安全运行。**

---

## 八、Determinism

| 约束 | 保证 |
|------|------|
| same input → same output | ✅ 纯函数 |
| same output → same hash | ✅ 可选验证 |
| 100× replay | ✅ |
| 1000× replay | ✅ |
| Math.random | ❌ 禁止 |
| Date.now | ❌ 禁止 |
| wall clock | ❌ 禁止 |
| unordered iteration | ❌ 禁止 |
| 依赖对象地址 | ❌ 禁止 |
| 依赖 Game runtime 状态隐式排序 | ❌ 禁止 |

---

## 九、CPU / Memory

| 项 | 值 |
|----|----|
| interval | 500t |
| priority | P3 |
| phase | post |
| CPU / run | < 0.05ms |
| CPU / 1000t | < 0.1ms |
| Memory | 0 新增 |
| RingBuffer | 不新增 |
| GC | 不新增 |

---

## 十、结论

**A6.7 是 Read-Only Observability Layer，不拥有 Decision Authority，不执行任何操作。**

核心原则：
1. 只读消费 A6.1–A6.6，不写入任何 cache
2. 只输出 console.log 可观测性
3. 14 个 CON 守卫确保安全
4. 退化防护 6 条路径全覆盖
5. 与 A6.0 冻结契约完全一致
6. 错误不影响运行时
7. A6.7 完全停止时帝国照常运行
