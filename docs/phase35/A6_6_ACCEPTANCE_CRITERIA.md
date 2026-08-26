# A6.6 Acceptance Criteria — 验收标准

> **阶段**: A6.6 Research
> **日期**: 2026-08-26
> **约束**: 纯研究文档，不修改任何代码

---

## 一、安全验收标准

### 1.1 Shadow-Only 验证

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-SAFE-001 | A6.6 Domain 层不引用 Game/Memory | 代码搜索 `Game.` / `Memory.` in domain | 0 处 |
| AC-SAFE-002 | A6.6 System 层不调用 Game API 写函数 | 代码搜索 spawnCreep / createConstructionSite / terminal.send / market.deal | 0 处 |
| AC-SAFE-003 | A6.6 不修改 Memory | 代码搜索 Memory.kernel 写入 | 0 处 |
| AC-SAFE-004 | A6.6 不修改 globalCache 业务字段 | 代码搜索 globalCache 写入（除 __recommendationCache） | 0 处 |
| AC-SAFE-005 | 无执行系统 import A6.6 输出 | 代码搜索 RecommendationCandidate import in src/systems/ (非 A6) | 0 处 |
| AC-SAFE-006 | autoApply 字段为 literal false | TypeScript 类型检查 | 编译通过 |
| AC-SAFE-007 | shadowOnly 字段为 literal true | TypeScript 类型检查 | 编译通过 |
| AC-SAFE-008 | A6.6 停止后 A6.1-A6.5 不受影响 | 关闭 A6.6 System 运行 5000t | A6.1-A6.5 全部正常 |

### 1.2 Decision Authority 验证

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-DA-001 | A6.6 不修改 posture | 代码搜索 posture 写入 in A6.6 | 0 处 |
| AC-DA-002 | A6.6 不提交 SpawnRequest | 代码搜索 submitRequest in A6.6 | 0 处 |
| AC-DA-003 | A6.6 不创建 ConstructionSite | 代码搜索 createConstructionSite in A6.6 | 0 处 |
| AC-DA-004 | A6.6 不提交 RecoveryAction | 代码搜索 recoveryActions 写入 in A6.6 | 0 处 |
| AC-DA-005 | A6.6 不修改 WarPlan | 代码搜索 warPlan 写入 in A6.6 | 0 处 |
| AC-DA-006 | A6.6 不修改 Agenda | 代码搜索 agenda 写入 in A6.6 | 0 处 |

---

## 二、Evidence 验证标准

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-EV-001 | 每条 Recommendation 至少 1 条 Evidence | 遍历所有 Recommendation | evidence.length >= 1 |
| AC-EV-002 | Evidence 有可追溯 source | 检查 trace.upstreamHash | 非空 |
| AC-EV-003 | DATA_GAP 不伪造证据 | 检查 type=DATA_GAP 时 confidence=0 | 100% |
| AC-EV-004 | Recommendation confidence <= 最低 Evidence confidence | 数学验证 | 100% |
| AC-EV-005 | 低 confidence Prediction 不产生高 confidence Recommendation | 数学验证 | 100% |

---

## 三、Conflict 验证标准

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-CF-001 | 冲突被标记不裁决 | 代码搜索 selectHighest / resolveConflict | 0 处 |
| AC-CF-002 | NO_RECOMMENDATION 可产出 | 构造低 evidence 场景 | 产出 NO_RECOMMENDATION |
| AC-CF-003 | 冲突降级所有参与方 confidence | 数学验证 | 100% |
| AC-CF-004 | 不隐藏冲突 Recommendation | 验证冲突双方都输出 | 100% |

---

## 四、Lifecycle 验证标准

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-LC-001 | 每条 Recommendation 有 TTL | 检查 validityWindow | 100% |
| AC-LC-002 | TTL 到期后 status=expired | 模拟时间推进 | 100% |
| AC-LC-003 | Supersede 链深度 <= 3 | 遍历 supersedes 链 | 100% |
| AC-LC-004 | 过期 Recommendation 不被消费 | 查询 API 过滤 | 100% |
| AC-LC-005 | Regime 变化导致失效 | 模拟 Regime 切换 | 100% |
| AC-LC-006 | Cache size <= 50 | 运行后检查 | 100% |

---

## 五、CPU/Memory 验证标准

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-CPU-001 | 单次运行 < 1ms | CPU 基准测试 | < 1ms |
| AC-CPU-002 | 100 次运行 < 100ms | 累积 CPU 测试 | < 100ms |
| AC-MEM-001 | Cache <= 64KB | 序列化测量 | < 64KB |
| AC-MEM-002 | Cache count <= 50 | 运行后检查 | <= 50 |
| AC-MEM-003 | Evidence count <= 10 per rec | 遍历检查 | <= 10 |
| AC-MEM-004 | 无 unbounded arrays | 代码搜索 | 0 处 |

---

## 六、Determinism 验证标准

| 标准 ID | 标准 | 验证方法 | 通过条件 |
|---------|------|---------|---------|
| AC-DET-001 | 禁止 Math.random | 代码搜索 | 0 处 |
| AC-DET-002 | 禁止 Date.now | 代码搜索 | 0 处 |
| AC-DET-003 | 1000x replay hash 一致 | 确定性测试 | 100% |
| AC-DET-004 | 排序使用 Lexicographic ranking | 代码审查 | 5 级排序 |
| AC-DET-005 | 浮点 toFixed(6) 截断 | 代码搜索 | 100% |
| AC-DET-006 | 所有遍历排序后执行 | 代码审查 | 100% |

---

## 七、质量门槛

### 7.1 合并前必须全绿

```
npm run typecheck  ✅
npm test            ✅
npm run build       ✅
```

### 7.2 测试覆盖

| 测试类别 | 最低测试数 | 覆盖维度 |
|---------|-----------|---------|
| 安全测试 | 10 | Shadow-Only + Decision Authority |
| Evidence 测试 | 10 | 追溯 + confidence 传播 |
| Conflict 测试 | 8 | 检测 + 降级 + NO_RECOMMENDATION |
| Lifecycle 测试 | 10 | TTL + Supersede + GC |
| CPU 测试 | 4 | 单次 + 批量 + 最坏 + 边界 |
| Memory 测试 | 4 | Cache + Evidence + 无界检测 |
| 确定性测试 | 5 | Hash + 排序 + replay |
| Counterfactual | 10 | R1-R10 反事实场景 |
| **合计** | **61** | |

---

## 八、结论

**A6.6 的验收标准可测试、可验证、可自动化。**

所有标准分为 6 类：
1. 安全（Shadow-Only + Decision Authority）
2. Evidence（追溯 + confidence 传播）
3. Conflict（检测 + 降级 + NO_RECOMMENDATION）
4. Lifecycle（TTL + Supersede + GC）
5. CPU/Memory（预算 + 有界）
6. Determinism（确定性 + replay）

**Acceptance Criteria 可测试。**
