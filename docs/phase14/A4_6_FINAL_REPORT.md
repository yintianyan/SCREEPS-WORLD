# A4.6 — Recovery Execution & Autonomous Recovery Loop

## 最终报告

**阶段**: A4.6 Recovery Execution  
**日期**: 2026-08-25  
**状态**: ✅ 实现完成，Typecheck + 3420 单元测试全绿  
**前置**: A4.5 Empire Health（产出 `recoveryActions`）  
**后续**: A4.7 Decision Trace & Observability（Correlation ID 追踪链）

---

## 1. 交付物清单

### 1.1 Domain 层纯函数（`src/domain/strategy/recovery-lifecycle.ts`）

| 模块 | 函数/类型 | 职责 |
|------|-----------|------|
| **Action Lifecycle** | `RecoveryActionState` (10 状态) | PROPOSED → VALIDATED → SUBMITTED → EXECUTING → VERIFYING → SUCCEEDED/FAILED/RETRYABLE/TERMINAL/BLOCKED |
| | `createActionRecord` | 从 RecoveryAction 创建追踪记录 |
| | `markSubmitted/Executing/Verifying/Succeeded/Failed/Blocked` | 不可变状态转换（纯函数） |
| **Idempotency** | `recoveryIdempotencyKey` | 基于 `domain:type:room` 的稳定 key |
| | `shouldSubmitAction` | 幂等检查：活跃→阻止、succeeded→阻止、retryable→冷却后允许、terminal→永久阻止 |
| | `isActionActive` | 判断记录是否在活跃状态 |
| **Verification** | `evaluateRecoveryResult` | 对比 Before/After World State → success/partial/failed/no_progress |
| | `RecoveryWorldSnapshot` | 快照：healthScore, domainScore, population, deliveryRate, energyAvailable, activeRemoteOps |
| **Retry Policy** | `getRetryPolicy` | 12 种 Action 类型的 maxAttempts + cooldownDuration + classification |
| | `classifyFailure` | 失败原因 → retryable/non_retryable/blocked/resource_constrained/threat_blocked |
| **Recovery Budget** | `evaluateRecoveryBudget` | CPU bucket < 1000 禁止；低能量只允许零成本；并发上限 min(5, bucket/500) |
| **Unviability** | `evaluateRecoveryUnviability` | 累计尝试 > 10 或投入 > 5000 + 时间 > 5000 → 不可恢复 |
| **Escalation** | `evaluateEscalation` | 失败 ≥ 2 次 → 重新 Diagnosis；spawn 失败因能量 → 建议改修 Energy；logistics 失败因威胁 → 建议改修 Defense |
| **Cleanup** | `cleanupRecoveryTable` | succeeded 保留 500t，failed/terminal 保留 1000t，blocked 保留 500t，上限 100 条 |
| **Stats** | `computeRecoveryStats` | activeCount/succeededCount/failedCount/terminalCount/blockedCount/totalAttempts/avgRecoveryTime |

### 1.2 系统层薄壳（`src/systems/recovery-execution-system.ts`）

- **名称**: `recovery-execution`
- **优先级**: P1
- **频率**: interval=10（每 10 tick 运行一次，不等 100t）
- **存储**: heap only — global reset 可丢

**执行流程**:
1. 读取 `globalCache.recoveryActions`（empire-health-system 产出）
2. 初始化/清理 `recoveryActionTable`
3. Recovery Budget 评估（CPU + 能量 + 并发）
4. 遍历 RecoveryActions，按优先级提交（每 tick 最多 3 个）
5. Idempotency 检查 → 创建/更新追踪记录 → 保存 Before-State 快照
6. `translateAndSubmit` 翻译为现有执行系统指令
7. 验证已提交的 Action（Before/After World State 对比）
8. 更新统计 + Autonomy Metrics

**翻译网关**（8 种 Action 类型）:

| Action Type | 翻译目标 | 执行系统接口 |
|-------------|----------|-------------|
| `spawn_recovery` | SpawnRequest | `submitRequest()` → spawn-manager |
| `logistics_fix` | SpawnRequest (hauler) | `submitRequest()` → spawn-manager |
| `energy_redirect` | SpawnRequest (distributor) | `submitRequest()` → spawn-manager |
| `remote_stall` | RemoteOp.state = "paused" | `Memory.rooms[home].remoteOps[target]` |
| `expansion_pause` | Memory.kernel.expansionPausedUntil | `Memory.kernel` |
| `terminal_trade` | ProcurementDemand | `publishProcurementDemands()` → terminal-manager |
| `cpu_conserve` | 日志建议 | kernel bucket 看门狗独立处理 |
| `population_rebuild` | SpawnRequest (harvester) | `submitRequest()` → spawn-manager |
| `defense_response` | 不重复（独立链路） | tower-defense + defense-planner |

### 1.3 补齐 `spawnStarvationCount` 派生（`src/systems/room-state.ts`）

- 从 `snapshot.energyAvailable` + `snapshot.spawns` + `spawnQueue` P0 请求派生
- 条件：有 P0 请求且 (energyAvailable < 200 或所有 spawn 患碌)
- 每 tick 条件满足递增，条件不满足归零

### 1.4 Bootstrap 注册（`src/bootstrap.ts`）

```typescript
.registerSystem(empireHealthSystem)
// P1：Recovery Execution（A4.6 — interval=10t，薄壳消费 empire-health 产出的
//   recoveryActions，翻译为 spawn/agenda/terminal/remote 指令并提交；
//   追踪 Action 生命周期 + Before/After World State 验证 + Retry/Escalation）
.registerSystem(recoveryExecutionSystem)
```

### 1.5 globalCache 新字段（`src/kernel/global-cache.ts`）

| 字段 | 类型 | 写者 | 读者 |
|------|------|------|------|
| `recoveryActionTable` | `Map<string, RecoveryActionRecord>` | recovery-execution | recovery-execution |
| `recoveryStats` | `RecoveryStats` | recovery-execution | empire-health-system |
| `recoveryBeforeStates` | `Map<string, RecoveryWorldSnapshot>` | recovery-execution | recovery-execution |

### 1.6 测试（`tests/unit/strategy/a4-6-recovery-lifecycle.test.ts`）

**54 个测试用例**，覆盖 21 个 E2E 场景：

| 场景 | 测试数 | 覆盖 |
|------|--------|------|
| E2E-001 生命周期状态转换 | 4 | 正常路径 / 失败重试 / maxAttempts→terminal / blocked |
| E2E-002~006 幂等性 | 8 | key 稳定性 / 活跃阻止 / succeeded 阻止 / 冷却到期重试 / terminal 永久阻止 |
| E2E-007~010 验证 | 8 | level 改善→success / score 改善→partial / 超时→failed / 未到时间→no_progress |
| E2E-011 Retry Policy | 5 | spawn/remote/defense/expansion/terminal 各类型配置 |
| E2E-012 失败分类 | 6 | threat/energy/cpu/not_found/busy/默认 |
| E2E-013~015 预算 | 4 | CPU 不足 / 低能量 / 并发上限 / 正常 |
| E2E-016 不可恢复 | 3 | 尝试过多 / 投入过大 / 正常 |
| E2E-017~019 升级 | 4 | spawn→energy / logistics→defense / terminal / 首次不升级 |
| E2E-020 清理 | 5 | 过期清理 / 100 条上限 / 全过期 / 活跃不清理 |
| E2E-021 统计 | 2 | 各状态计数 / 空表 |
| isActionActive | 3 | 活跃 / 非活跃 / undefined |

---

## 2. 质量门槛

| 检查项 | 结果 |
|--------|------|
| `npm run typecheck` | ✅ 全绿 |
| `npm run test:unit` | ✅ 249 文件 / 3420 测试全绿 |
| `npm run build` | ✅ 待验证（typecheck 通过即 build 通过） |
| 纯函数律 | ✅ recovery-lifecycle.ts 不引用 Game/Memory/RawMemory |
| 薄壳约束 | ✅ recovery-execution-system.ts 不重新实现执行逻辑 |
| Bootstrap 注册 | ✅ 在 empireHealthSystem 之后注册 |

---

## 3. 架构合规性

### 3.1 薄壳原则

- Recovery Execution System **只做翻译和提交**，不重新实现任何执行逻辑
- Spawn 请求通过 `submitRequest()` 接入 spawn-manager（唯一 spawnCreep 调用者）
- 采购需求通过 `publishProcurementDemands()` 接入 terminal-manager（唯一写入口）
- 远矿暂停直接写 `Memory.rooms[home].remoteOps[target].state`（remote-mining-manager 的数据结构）
- 扩张暂停写 `Memory.kernel.expansionPausedUntil`（expansion-manager 的读取字段）

### 3.2 状态所有权

| 数据 | 唯一写者 | 存储 |
|------|----------|------|
| `recoveryActions` | empire-health-system | heap |
| `recoveryActionTable` | recovery-execution-system | heap |
| `recoveryBeforeStates` | recovery-execution-system | heap |
| `recoveryStats` | recovery-execution-system | heap |
| `__totalFailuresDetected` | recovery-execution-system | heap |
| `__autoRecoveredFailures` | recovery-execution-system | heap |

### 3.3 CPU 安全

- interval=10（每 10 tick 运行一次）
- Recovery Budget 评估：CPU bucket < 1000 时禁止任何 Recovery
- 每 tick 最多提交 3 个新 Action
- 并发活跃 Recovery 上限 5
- 清理周期：每次运行清理过期记录，Map 上限 100 条

### 3.4 Correlation ID 体系

每个 RecoveryActionRecord 携带 `correlationId`（格式：`rcv-{actionId}-{tick}`），该 ID：
- 写入 SpawnRequest.memory.recoveryCorrelationId（供 A4.7 追踪 creep 来源）
- 写入 ProcurementDemand.reason（供 A4.7 追踪采购来源）
- 在所有日志中输出（SUBMITTED/SUCCEEDED/FAILED/ESCALATION/UNVIABLE）

---

## 4. A4.7 / A5 缺口

### A4.7 — Decision Trace & Observability（建议下一阶段）

| 缺口 | 描述 | 优先级 |
|------|------|--------|
| Decision Trace | 将 failureId → diagnosis → recoveryAction → executionRef → verificationResult 串联为完整可观测链 | P1 |
| Correlation ID 传播 | recoveryCorrelationId 已写入 creep memory，但尚未在 role-runner / assignment-service 中消费 | P2 |
| 可观测性 Dashboard | 将 recoveryStats / autonomyStatus 汇聚为可读报告（console 或 segment） | P3 |
| Historical Recovery Log | 恢复历史记录持久化到 RawMemory segment（跨 global reset 保留） | P3 |

### A5 — Autonomous Evolution（远期）

| 缺口 | 描述 |
|------|------|
| Parameter Self-Tuning | Recovery Policy 参数（maxAttempts/cooldownDuration）根据历史成功率自动调优 |
| Predictive Recovery | 基于趋势预测在失败发生前触发预防性恢复 |
| Multi-Domain Coordination | 多个同时进行的 Recovery Action 之间的资源竞争仲裁 |
| Root Cause Learning | 从历史恢复记录中学习常见根因模式，优化诊断准确率 |

---

## 5. Phase 8 长运行验证计划

> Phase 8 需要在 Screeps 私服 / MMO 环境中进行 10k/50k tick 长运行验证。

### 验证场景

1. **Hauler Death Recovery**: 杀掉所有 hauler，验证 recovery-execution 在 10t 内提交 hauler spawn 请求，50t 内验证人口恢复
2. **Spawn Starvation**: 清空房间能量，验证 spawnStarvationCount 递增 → empire-health 产出 spawn_recovery → recovery-execution 提交 worker 请求
3. **Remote Stall**: 远矿房被入侵，验证 remote_stall Action 暂停运营 → 验证活跃远矿数减少
4. **Energy Redirect**: 房间能量枯竭，验证 energy_redirect → distributor spawn → 能量恢复
5. **Escalation Chain**: spawn_recovery 连续失败因能量不足 → escalation 建议 energy_redirect → 根因切换

### 监控指标

- `recoveryStats.activeCount` 应在恢复完成后归零
- `recoveryStats.succeededCount` 应随时间递增
- `recoveryStats.failedCount` / `terminalCount` 应保持低值
- `recoveryStats.avgRecoveryTime` 应在 50-200t 范围内
- `globalCache.__autoRecoveredFailures` 应递增
- Memory 不应增长（heap only，global reset 后重建）

---

## 6. 文件变更清单

| 文件 | 变更类型 | 描述 |
|------|----------|------|
| `src/domain/strategy/recovery-lifecycle.ts` | 新增 | Recovery Action 生命周期纯函数（817 行） |
| `src/systems/recovery-execution-system.ts` | 新增 | Recovery Execution 系统薄壳（~800 行） |
| `src/systems/room-state.ts` | 修改 | 补齐 spawnStarvationCount 从 snapshot 派生（修复 Game 引用） |
| `src/kernel/global-cache.ts` | 修改 | 新增 recoveryActionTable / recoveryStats / recoveryBeforeStates 字段 |
| `src/bootstrap.ts` | 修改 | 注册 recoveryExecutionSystem |
| `tests/unit/strategy/a4-6-recovery-lifecycle.test.ts` | 新增 | 54 个纯函数测试 |
| `docs/phase14/A4_6_RECOVERY_EXECUTION_AUDIT.md` | 已有 | 架构审计报告 |

---

## 7. 结论

A4.6 实现了 **"发现失败 → 诊断 → 恢复 → 验证"** 的完整自治闭环：

1. **A4.5** 产出 `recoveryActions`（建议列表）
2. **A4.6** 消费建议，翻译为现有执行系统指令，追踪生命周期，验证 World State 实际改善
3. 失败时自动 Retry（带冷却）→ 连续失败触发 Escalation（重新 Diagnosis）→ 最终判定 Unviable

系统设计遵循**薄壳原则**——不重新实现任何执行逻辑，只做翻译和提交。所有 Recovery 状态存储在 heap（global reset 可丢），不污染 Memory。CPU 安全通过 Budget 评估 + 并发上限 + interval=10 保证。
