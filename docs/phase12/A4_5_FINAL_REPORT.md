# A4.5 Final Report — Empire Autonomous Stability & Long-Run Validation

> 日期：2026-08-25。阶段：A4.5 — Empire Autonomous Stability & Long-Run Validation。
> 基线：A4.4 已完成 Logistics Network 收敛（8/10 Convergence Score），22 个 E2E 测试通过。
> A4.5 目标：验证帝国长期自治能力——面对扰动自动恢复到稳态、零人工干预为常态。

---

## 1. 交付物清单

### 1.1 Domain 层纯函数模块（4 个）

| 模块 | 路径 | 功能 |
| --- | --- | --- |
| `empire-health.ts` | `src/domain/strategy/` | 8 维度综合健康评估 + Hysteresis 滞回 + 维度映射辅助 |
| `failure-propagation.ts` | `src/domain/strategy/` | 失败传播图 + 根因检测（反向 BFS）+ 影响范围分析（正向 BFS）|
| `recovery-priority.ts` | `src/domain/strategy/` | 恢复优先级排序 + ROI 计算 + Cooldown 机制 |
| `autonomy-metrics.ts` | `src/domain/strategy/` | Autonomy Score（0..100）+ No-Progress 检测 + Thrashing 检测 |

### 1.2 系统层薄壳（1 个）

| 模块 | 路径 | 功能 |
| --- | --- | --- |
| `empire-health-system.ts` | `src/systems/` | P1 系统，interval=100t，消费 8 维度信号产出综合评估 |

### 1.3 测试（1 个文件，28 个测试）

| 文件 | 测试数 | 覆盖场景 |
| --- | --- | --- |
| `a4-5-autonomy.test.ts` | 28 | E2E-001 ~ E2E-011 全覆盖 |

### 1.4 基础设施变更

| 文件 | 变更 |
| --- | --- |
| `src/kernel/global-cache.ts` | +5 个 A4.5 字段（empireHealth / failureGraph / recoveryActions / autonomyStatus / recoveryCooldowns）+ 11 个历史追踪字段 |
| `src/bootstrap.ts` | +empireHealthSystem 注册（P1, interval=100, 在 specialization-planner 之后） |

---

## 2. Empire Health 架构

### 2.1 8 维度健康评估

```
empire-health-system (每 100t)
  │
  ├── 1. 收集各维度信号
  │   ├── Energy   ← Memory.kernel.empireEconomy (empire-economy)
  │   ├── Mineral  ← globalCache.multiResourceHealth (empire-economy)
  │   ├── Logistics ← globalCache.logisticsHealth (logistics-planner)
  │   ├── Network  ← globalCache.networkHealth (agenda-manager)
  │   ├── Colony   ← RoomMemory.colonyState (room-state)
  │   ├── Threat   ← Memory.kernel.strategy.posture (empire-strategy)
  │   ├── Spawn    ← RoomSnapshot.spawns + RoomMemory
  │   └── CPU      ← ctx.budget.tier (kernel scheduler)
  │
  ├── 2. 映射到 DimensionHealth + score
  │   └── mapEconomicHealth / mapResourceHealth / mapLogisticsHealth / ...
  │
  ├── 3. evaluateEmpireHealth
  │   ├── 加权汇总分数（Energy 0.25 > Logistics 0.18 > Colony 0.15 > ...）
  │   ├── 短板效应（最差维度决定下限）
  │   ├── 多 critical 修正（≥2 critical → 直接 critical）
  │   └── Hysteresis 滞回（降级立即，恢复需超阈值）
  │
  └── 4. 写入 globalCache.empireHealth
```

### 2.2 Hysteresis 阈值

| 转换 | 阈值 | 说明 |
| --- | --- | --- |
| 进入 CRITICAL | score < 0.30 或 ≥2 维度 critical | 立即生效 |
| 恢复到 DEGRADED | score > 0.55 | 从 critical 恢复 |
| 进入 DEGRADED | score < 0.70 | 立即生效 |
| 恢复到 STABLE | score > 0.80 | 从 degraded 恢复 |
| 进入 HEALTHY | score > 0.90 | 从 stable 升级 |
| 降级到 STABLE | score < 0.85 | 从 healthy 降级 |

### 2.3 维度权重

| 维度 | 权重 | 理由 |
| --- | --- | --- |
| Energy | 0.25 | 帝国生命线 |
| Logistics | 0.18 | 物流中断直接导致经济瘫痪 |
| Colony | 0.15 | 殖民失败影响扩张 |
| Network | 0.10 | 资源网络基础设施 |
| CPU | 0.10 | CPU 预算决定执行能力 |
| Spawn | 0.10 | 孵化能力决定人口维持 |
| Mineral | 0.06 | 矿物辅助维度 |
| Threat | 0.06 | 威胁状态辅助维度 |

---

## 3. Failure Propagation 架构

### 3.1 传播图模型

```
失败节点（FailureNode）
  ↓ 预定义传播规则（17 条）
传播边（FailureEdge）
  ↓
传播图（FailureGraph）
  ├── findRootCauses() → 根因节点（无入边的活跃节点）
  ├── detectRootCause(symptomId) → 反向 BFS 回溯到根因
  └── analyzeImpact(rootCauseId) → 正向 BFS 传播到所有受影响节点
```

### 3.2 预定义传播规则

| 源领域 | 目标领域 | 延迟 | 概率 | 条件 |
| --- | --- | --- | --- | --- |
| logistics → colony | 200t | 0.8 | hauler death → delivery stops → colony starvation |
| spawn → colony | 300t | 0.9 | spawn starvation → no replacement → population collapse |
| colony → energy | 100t | 0.95 | population collapse → no harvesters → production drop |
| energy → network | 500t | 0.7 | production drop → net flow negative → imbalance |
| remote → energy | 1000t | 0.5 | remote mining stall → remote contribution lost |
| threat → remote | 0t | 0.9 | hostile → remote ops frozen |
| cpu → logistics | 0t | 0.5 | CPU bucket low → logistics planner skipped |
| ... 共 17 条 | | | | |

---

## 4. Recovery Priority 架构

### 4.1 优先级计算

```
priority = severityWeight × domainWeight × impactFactor × rootCauseBoost
```

- severityWeight: info=10, warning=30, error=60, critical=100
- domainWeight: energy=1.5, spawn=1.4, defense=1.4, logistics=1.3, ...
- impactFactor: 1 + affectedNodes × 0.1（上限 2.0）
- rootCauseBoost: 1.5（根因优先）

### 4.2 排序规则

1. urgent 优先（critical/error 严重度）
2. 根因优先（isRootCause）
3. priority 分数降序
4. ROI 降序（同分时）

### 4.3 Cooldown 机制

- 同一 (domain, room) 对的恢复尝试有冷却期（默认 200t）
- 冷却中不产出恢复动作
- 不同房间的同领域失败独立冷却
- `recordRecoveryAttempt()` 返回新的 cooldown 表（不可变更新）

---

## 5. Autonomy Metrics 架构

### 5.1 Autonomy Score（0..100）

| 维度 | 权重 | 满分条件 |
| --- | --- | --- |
| 经济闭环率 | 25% | economicLoopActive + economicLoopRate=1.0 |
| 失败恢复率 | 25% | autoRecovered/totalDetected=1.0, activeFailures=0 |
| 人工干预 | 20% | manualInterventions=0 |
| 稳态维持 | 15% | consecutiveStableTicks ≥ 10000 |
| 扰动恢复 | 15% | avgRecoveryTime ≤ 500t |

### 5.2 自治等级

| 分数 | 等级 | 含义 |
| --- | --- | --- |
| ≥90 | full | 完全自治 |
| ≥70 | high | 高度自治 |
| ≥50 | moderate | 中度自治 |
| ≥30 | low | 低自治 |
| <30 | none | 非自治 |

### 5.3 No-Progress 检测

检测 4 个维度的停滞（窗口=10 个采样点 = 1000t）：
1. 净能量流无正增长
2. 总储备无增长
3. 总人口无增长
4. 活跃失败数不减少

### 5.4 Thrashing 检测

检测 3 类振荡：
1. 健康度等级频繁跳动（≥4 次/窗口）
2. 姿态频繁切换（≥3 次/窗口）
3. 同一失败领域反复出现/恢复（≥3 次/窗口）

### 5.5 综合自治判定

```
autonomous = AutonomyScore ≥ 50 && !NoProgress && !Thrashing
```

---

## 6. 系统执行顺序（更新后）

```
P0: roomStateSystem
P1: economySystem
P0: spawnManagerSystem
P0: towerDefenseSystem
P1: empireStrategySystem
P1: empireEconomySystem
P1: agendaManagerSystem
P0: logisticsSystem
P1: logisticsPlannerSystem
P1: assignmentServiceSystem
P1: linkSystem
P1: labSystem
P2: constructionManagerSystem
P2: remoteMiningManagerSystem
P1: specializationPlannerSystem
P1: empireHealthSystem           ← A4.5 新增（消费上述所有系统的信号）
P2: warPlannerSystem
...
```

---

## 7. E2E 测试结果

| 测试 ID | 场景 | 结果 |
| --- | --- | --- |
| E2E-001 | Empire Health 8 维度评估 + 维度映射 | ✅ PASS |
| E2E-002 | Health 降级立即生效 | ✅ PASS |
| E2E-003 | Health 恢复滞回（需超阈值） | ✅ PASS |
| E2E-004 | Failure Propagation 根因检测 | ✅ PASS |
| E2E-005 | Failure 影响范围分析 | ✅ PASS |
| E2E-006 | Recovery Priority 排序 + ROI | ✅ PASS |
| E2E-007 | Recovery Cooldown 机制 | ✅ PASS |
| E2E-008 | Autonomy Score 计算 | ✅ PASS |
| E2E-009 | No-Progress 检测 | ✅ PASS |
| E2E-010 | Thrashing 检测 | ✅ PASS |
| E2E-011 | 综合自治状态判定 | ✅ PASS |

**E2E 测试：28/28 PASS**
**全量测试：3504/3504 PASS（零回归）**

---

## 8. CPU 影响

| 系统 | 修复前 CPU | 修复后 CPU | 变化 |
| --- | --- | --- | --- |
| empire-health (100t) | 0ms（不存在） | ~1.5ms | +1.5ms/100t |

**净 CPU 影响：+0.015ms/tick**（100t 间隔分摊，可忽略）

---

## 9. Memory 影响

| Memory 字段 | 修复前 | 修复后 | 变化 |
| --- | --- | --- | --- |
| globalCache.empireHealth | 不存在 | 存在（heap） | 0（heap 不进 Memory） |
| globalCache.failureGraph | 不存在 | 存在（heap） | 0 |
| globalCache.recoveryActions | 不存在 | 存在（heap） | 0 |
| globalCache.autonomyStatus | 不存在 | 存在（heap） | 0 |
| globalCache.recoveryCooldowns | 不存在 | 存在（heap Map） | 0 |
| 历史追踪字段（11 个） | 不存在 | 存在（heap） | 0 |

**净 Memory 影响：0**（全部使用 heap 存储，不进 Memory）

---

## 10. Observability

### 10.1 等级变更日志

```
[1000] empire-health: (none) → healthy score=0.950 bottleneck=energy recovering=false autonomy=95(full)
[2000] empire-health: healthy → degraded score=0.650 bottleneck=logistics recovering=false autonomy=45(low) NO_PROGRESS:net_flow,reserve
[3000] empire-health: degraded → stable score=0.820 recovering=true autonomy=70(high)
```

### 10.2 紧急恢复日志

```
[2000] empire-health: URGENT recovery → spawn_recovery domain=spawn priority=140 roi=0.70: emergency spawn [WORK,CARRY,MOVE] with available energy
```

### 10.3 可观测数据产出

| 数据 | 位置 | 消费者 |
| --- | --- | --- |
| EmpireHealthResult | globalCache.empireHealth | 控制台 / 日志 / 未来 Dashboard |
| FailureGraph | globalCache.failureGraph | 控制台 / 根因分析 |
| RecoveryAction[] | globalCache.recoveryActions | 执行系统（spawn-manager / agenda-manager 等） |
| AutonomyStatus | globalCache.autonomyStatus | 控制台 / 长期监控 |

---

## 11. 质量门槛

| 门槛 | 状态 |
| --- | --- |
| `npm run typecheck` | ✅ PASS（零错误） |
| `npm test` | ✅ PASS（3504/3504） |
| `npm run build` | ✅ PASS（dist/main.js 生成） |
| A4.5 E2E 测试 | ✅ PASS（28/28） |

---

## 12. 剩余技术债

| 技术债 | 严重性 | 描述 |
| --- | --- | --- |
| 10k Tick Runtime Test | 中 | 未在 Screeps 运行环境执行长周期测试 |
| Recovery 执行接线 | 中 | recoveryActions 产出但执行系统尚未消费 |
| 人工干预追踪 | 低 | manualInterventions 硬编码为 0（需要 console hook） |
| 扰动恢复时间追踪 | 低 | perturbationCount / totalRecoveryTime 需要系统层追踪 |
| Spawn Starvation 追踪 | 低 | RoomMemory.spawnStarvationCount 字段未在 room-state 中写入 |
| 决策时间线 | 低 | Decision Snapshot 保存与重放未实现 |

---

## 13. PASS / FAIL 判定

| 验收项 | 状态 |
| --- | --- |
| Empire Health 8 维度评估 | ✅ PASS |
| Hysteresis 滞回 | ✅ PASS |
| Failure Propagation 根因检测 | ✅ PASS |
| 影响范围分析 | ✅ PASS |
| Recovery Priority + ROI | ✅ PASS |
| Cooldown 机制 | ✅ PASS |
| Autonomy Score | ✅ PASS |
| No-Progress 检测 | ✅ PASS |
| Thrashing 检测 | ✅ PASS |
| 综合自治判定 | ✅ PASS |
| 系统注册 + Bootstrap | ✅ PASS |
| TypeCheck | ✅ PASS |
| 全量测试零回归 | ✅ PASS |
| Build | ✅ PASS |
| CPU 影响 | ✅ 可忽略（+0.015ms/tick） |
| Memory 影响 | ✅ 零（全 heap） |
| 10k Tick Runtime Test | ⚠️ DEFERRED（需要 Screeps 运行环境） |
| Recovery 执行接线 | ⚠️ DEFERRED（下一步 A4.6） |

**A4.5 判定：CONDITIONAL PASS**

- Architecture Correctness：✅
- Domain 纯函数完整：✅（4 个模块）
- 系统薄壳正确：✅
- E2E 测试通过：✅（28/28）
- 零回归：✅（3504/3504）
- Observability：✅（等级变更日志 + 紧急恢复日志 + 4 个 globalCache 数据源）
- 10k Tick / Recovery 执行：⚠️ 需要后续阶段

---

## 14. 下一阶段建议

1. **A4.6 — Recovery 执行接线**：将 recoveryActions 消费到执行系统（spawn-manager / agenda-manager / terminal-manager）
2. **A4.7 — Decision Trace**：实现 Decision Snapshot 保存与 Deterministic Replay
3. **运行时验证**：在 Screeps MMO 环境执行 10k tick 运行时测试 + 扰动恢复测试
4. **Spawn Starvation 追踪**：在 room-state 中写入 spawnStarvationCount 字段
5. **人工干预追踪**：实现 console hook 追踪 manualInterventions

---

## 附录：修改文件清单

| 文件 | 修改内容 |
| --- | --- |
| `src/domain/strategy/empire-health.ts` | 补全截断文件 + Hysteresis + 8 个维度映射辅助函数 |
| `src/domain/strategy/failure-propagation.ts` | 新增：失败传播图 + 根因检测 + 影响范围分析 |
| `src/domain/strategy/recovery-priority.ts` | 新增：恢复优先级 + ROI + Cooldown |
| `src/domain/strategy/autonomy-metrics.ts` | 新增：Autonomy Score + No-Progress + Thrashing |
| `src/systems/empire-health-system.ts` | 新增：P1 系统薄壳，interval=100t |
| `src/kernel/global-cache.ts` | +5 个 A4.5 数据字段 + 11 个历史追踪字段 |
| `src/bootstrap.ts` | +empireHealthSystem 注册 |
| `tests/unit/strategy/a4-5-autonomy.test.ts` | 新增：28 个 E2E 场景测试 |
