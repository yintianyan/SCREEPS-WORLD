# A4.7 — Decision Trace & Deterministic Replay 最终报告

> **阶段**: A4.7  
> **日期**: 2026-08-25  
> **状态**: ✅ 已完成  
> **前置**: A4.5 (Empire Health)、A4.6 (Recovery Execution)  
> **质量门槛**: typecheck ✅ · unit tests (26/26) ✅ · build ✅

---

## §1. 执行摘要

A4.7 为 Screeps: World 帝国建立了 **结构化决策追踪与确定性重放** 能力。系统现在能回答"为什么帝国在 Tick X 做了决策 Y？"——通过完整的 SENSE → STATE SNAPSHOT → OBSERVATION → DECISION → REASON → ACTION → EXECUTION → RESULT → FEEDBACK 追踪链。

### 核心交付

| 交付项 | 文件 | 说明 |
|--------|------|------|
| Domain 层纯函数 | `src/domain/strategy/decision-trace.ts` | 17 节完整类型+纯函数定义 |
| System 层薄壳 | `src/systems/decision-trace-system.ts` | 采集 4 个决策点 + GC + Dashboard |
| 单元测试 | `tests/unit/strategy/a4-7-decision-trace.test.ts` | 26 个测试全绿 |
| E2E 测试 | `tests/e2e/scenarios/11-decision-trace.test.ts` | 3 Phase / 5k tick 稳定性验证 |
| Bootstrap 注册 | `src/bootstrap.ts` | P3 post 阶段，interval=100t |

### 架构原则

1. **Domain/System 分离**: Domain 层是纯函数（不引用 Game/Memory/任何 Runtime），System 层是薄壳（只采集和适配，不做决策）
2. **最小化快照**: DecisionSnapshot 只保存决策所需输入，不 dump 整个 Memory/Game
3. **确定性 Hash**: stableStringify (key 排序) + FNV-1a 32-bit → 8 字符 hex
4. **Ring Buffer**: 1000 条容量，O(1) 写入，自动淘汰最旧记录
5. **Trace GC**: ACTIVE (≤1000t) → ARCHIVED (≤2000t) → EXPIRED (删除)
6. **Heap-only**: 不进 Memory/RawMemory，global reset 可丢（trace 是调试设施，非持久真相）

---

## §2. 数据结构

### DecisionSnapshot（决策输入快照）

```
DecisionSnapshot
├── tick, scope, category
├── economy (energyAvailable, storageEnergy, netFlow, economyPressure, colonyState)
├── resources (storageMinerals, terminalResources)
├── logistics (haulerCount, haulerCapacity, deliveryRate, backlogCount, idleHaulers)
├── threat (posture, hostilesInRoom, hasLiveThreat, safeModeTicks)
├── spawn (spawnCount, spawningCount, queueLength, queueP0Count)
├── population (totalCreeps, creepByRole, creepTtlMin)
├── health (empireHealthLevel, empireHealthScore, bottleneck, recovering)
├── recovery (activeRecoveryCount, recoveryActionTypes, succeeded, failed)
├── operations (activeRemoteOps, activeContracts, expansionTarget)
└── planner (strategyPosture, expansionAllowed, cpuTier, cpuBucket)
```

### DecisionRecord（完整决策记录）

```
DecisionRecord
├── decisionId (D-{tick}-{seq})
├── tick, category, actor, scope
├── inputSnapshotHash (关联 DecisionSnapshot)
├── reasons[] (结构化原因: metric, actual, threshold, severity, consequence)
├── evidence (量化证据: energy/spawn/population/logistics/recovery/threat/health)
├── selectedAction
├── rejectedAlternatives[] (被拒绝的备选 + 拒绝原因)
├── expectedOutcome, actualOutcome?
├── correlationId (rcv-{decisionId}-{tick})
├── severity (DEBUG/NORMAL/IMPORTANT/CRITICAL)
├── decisionHash (用于 Replay 比对)
└── lifecycle (ACTIVE/ARCHIVED/EXPIRED)
```

### Correlation ID 追踪链

```
failureId (F-xxx) → decisionId (D-xxx) → actionId (R-xxx)
→ spawnRequestId (S-xxx) → creepName (C-xxx)
→ transportRequestId (T-xxx) → deliveryId (V-xxx)
```

---

## §3. 确定性保证

### §3.1 确定性审计结果

| 审计项 | 结果 | 说明 |
|--------|------|------|
| Randomness Audit | ✅ 通过 | 无 Math.random / crypto / uuid |
| Time Dependency Audit | ✅ 通过 | 无 Date.now / performance.now / wall-clock |
| Floating Point Audit | ✅ 通过 | Hash 计算用 Math.imul (整数操作) + >>> (无符号右移) |
| Key Order Stability | ✅ 通过 | stableStringify 按 key 字典序排序 |

### §3.2 Hash 算法

**FNV-1a 32-bit** 选择理由:
- 简单: ~5 行代码
- 快: O(n)，无分配
- 分布均匀: 100 个不同输入产生 ≥90 个不同 Hash
- 确定性: 同输入永远同输出
- 无依赖: 不引用 crypto/uuid

### §3.3 Replay 验证

```
verifyDeterminism(snapshot, replayFn, iterations=1000)
→ { deterministic: true, hashes: string[1000], firstDivergenceAt: undefined }
```

同一 Snapshot 连续 Replay 1000 次，所有 Hash 完全一致。

---

## §4. 接入的决策点

| 决策点 | Actor | 触发条件 | 采集来源 |
|--------|-------|----------|----------|
| Empire Health | `empire-health` | 健康等级 ≠ healthy 或有 RecoveryAction | globalCache.empireHealth / recoveryActions |
| Logistics | `logistics-planner` | 有 TransportRequest 或健康度 ≠ healthy | globalCache.logisticsPlan / logisticsHealth |
| Recovery Execution | `recovery-execution` | actionTable 有 submitted/succeeded/failed 记录 | globalCache.recoveryActionTable |
| Spawn Manager | `spawn-manager` | spawnQueue 非空 | Memory.rooms[*].spawnQueue |

---

## §5. 查询能力（Dashboard API）

### 导出函数

| 函数 | 用途 |
|------|------|
| `getDecisionTraceRecords(limit)` | 获取最近 N 条决策记录 |
| `queryDecisionTrace(query)` | 按 tick/category/scope/actor/severity/correlationId 查询 |
| `getDecisionChain(correlationId)` | 按 Correlation ID 追踪完整决策链 |
| `getDecisionTraceMemoryBudget()` | 内存预算测量 |
| `getDecisionTraceIntegrity()` | Trace 完整性检查 |
| `printDecisionTraceDashboard()` | 控制台打印摘要 |

### 查询示例

```javascript
// Screeps 控制台调用
printDecisionTraceDashboard()
// 输出:
// ═══ Decision Trace Dashboard @12345 ═══
// Records: 42 (capacity=1000, totalWritten=58)
// Memory: 680B/record, 664KB for 1000
// Integrity: 42/42 (100%)
// Recent IMPORTANT/CRITICAL:
//   [12340] SPAWN_QUEUE_3_p0_1 (spawn-manager) — p0SpawnQueue=1(critical)
//   [12330] RECOVERY_SPAWN_HAULER (empire-health) — bottleneckDimension=spawn(warning)
```

---

## §6. Memory & CPU Budget

### Memory Budget

- **单条记录**: ~680 bytes (含 reasons/evidence/rejectedAlternatives 全字段)
- **Ring Buffer 1000 条**: ~680KB
- **存储**: heap only — 不进 Memory/RawMemory
- **安全**: 远低于 Screeps Memory 2MB 限制

### CPU Budget

- **执行频率**: interval=100t (低频)
- **优先级**: P3 post 阶段 (所有业务系统之后)
- **Snapshot 生成**: 近零成本 (遍历已有快照聚合)
- **Trace GC**: 同 interval，O(n) 遍历 Ring Buffer

---

## §7. 测试覆盖

### 单元测试 (26/26 ✅)

| 测试组 | 测试数 | 覆盖范围 |
|--------|--------|----------|
| Snapshot Hash | 6 | 确定性、区分性、格式、key 排序、分布 |
| Decision Hash & Replay | 4 | 1000 次 Replay、verifyDeterminism、MATCH/DIVERGENCE |
| Ring Buffer | 3 | push/count、getRecentRecords、超容量滚动 |
| Trace GC | 3 | ACTIVE→ARCHIVED、ARCHIVED→EXPIRED、混合统计 |
| Query | 4 | tick/category/minSeverity/correlationId |
| Memory Budget | 2 | 单条测量、1000 条范围 |
| Integrity Check | 1 | 孤立记录检测 |
| Decision Chain | 1 | 可读输出格式 |
| ID Format | 2 | CorrelationId、DecisionId |

### E2E 测试 (3 Phase / 5k tick)

| Phase | Tick 范围 | 验证内容 |
|-------|----------|----------|
| Phase 1 | 0 → 200 | Trace 初始化、无 JS 错误 |
| Phase 2 | 200 → 1500 | Record 产出、Memory 不膨胀 |
| Phase 3 | 1500 → 5000 | 连续运行无错误、Memory 安全、spawnQueue 不堆积 |

---

## §8. 与现有 G-H DecisionTrace 的关系

| 维度 | G-H (`src/kernel/decision-trace.ts`) | A4.7 (`src/domain/strategy/decision-trace.ts`) |
|------|--------------------------------------|-----------------------------------------------|
| 定位 | 6 层 ring（goal/policy/intent/demand/task/action） | 结构化 DecisionRecord + Replay |
| 存储 | `globalCache.decisionTrace` (TraceState) | `globalCache.__decisionTraceCache` (RingBuffer + Registry) |
| 数据 | TraceEntry (seq/tick/layer/key/summary/refs) | DecisionRecord (完整决策记录 + Hash + Evidence) |
| 查询 | `getDecisionTrace(layer)` / `traceByKey(key)` | `queryDecisionTrace(query)` / `getDecisionChain(corrId)` |
| Replay | 无 | `replayDecision()` + `compareReplay()` + `verifyDeterminism()` |

**结论**: 两者互补，不冲突。G-H 提供轻量分层 trace（一句话摘要），A4.7 提供重量级结构化决策追踪 + 确定性重放。未来可合并为统一接口。

---

## §9. A5 Gap Analysis

### 已完成 (A4.0 - A4.7)

| 阶段 | 能力 | 状态 |
|------|------|------|
| A4.1 | Flow Accounting（能量流核算） | ✅ |
| A4.2 | Multi-Resource Health（多资源健康度） | ✅ |
| A4.3 | Logistics Planning（物流规划） | ✅ |
| A4.4 | Logistics Convergence（物流收敛） | ✅ |
| A4.5 | Empire Health & Autonomy（帝国健康与自治） | ✅ |
| A4.6 | Recovery Execution（恢复执行） | ✅ |
| A4.7 | Decision Trace & Replay（决策追踪与重放） | ✅ |

### A5 候选方向 (Gap Analysis)

| Gap | 优先级 | 描述 |
|-----|--------|------|
| **Supply Contract 落地** | P0 | A4.0 核心设计原则中 Supply Contract 尚未实现 — 当前 Resource Network 只有 SupplyNode → DemandNode → AllocationPolicy → Operation → Logistics 骨架，缺上层编排协议 |
| **Remote Source Model 注入** | P0 | Remote Source Model 应产出 SupplyNode 注入网络，而非独立调拨逻辑 [[memory:17875714213295541337]] |
| **Replay 自动化** | P1 | 当前 Replay 是手动调用 `replayDecision()`，未来需要自动化：定期从 Ring Buffer 抽样 Replay，自动检测 Divergence |
| **Decision Trace → Event Log 桥接** | P1 | 将 IMPORTANT/CRITICAL 级别的 DecisionRecord 写入 EventLog segment 2，实现跨 global reset 的持久追踪 |
| **Goal/Intent 系统落地** | P2 | G-H 的 6 层 trace 结构已就绪，但 goal/policy/intent 层尚无写入者 |
| **Replay Console 命令** | P2 | 在 Screeps 控制台提供 `replayDecision(decisionId)` 命令，从 Ring Buffer 取 Snapshot + Record 自动 Replay |
| **浮点数精度跨引擎验证** | P3 | 当前 FNV-1a Hash 在 V8 引擎内确定，但跨引擎（如 Screeps 切换 Node.js 版本）需验证 |

---

## §10. 文件清单

| 文件 | 行数 | 类型 |
|------|------|------|
| `src/domain/strategy/decision-trace.ts` | 807 | Domain 层纯函数 |
| `src/systems/decision-trace-system.ts` | 720 | System 层薄壳 |
| `tests/unit/strategy/a4-7-decision-trace.test.ts` | 490 | 单元测试 |
| `tests/e2e/scenarios/11-decision-trace.test.ts` | 160 | E2E 测试 |
| `src/kernel/global-cache.ts` | +3 行修改 | 添加 `__decisionTraceCache` 字段 |
| `src/bootstrap.ts` | +4 行修改 | 注册 `decisionTraceSystem` |

---

## §11. 质量门槛

```
npm run typecheck  → ✅ 0 errors
npm test:unit      → ✅ 26/26 passed
npm run build      → ✅ dist/main.js created
```

---

## §12. 结论

A4.7 完成了帝国自治系统的 **可审计性** 最后一环。从 A4.1 的能量流核算到 A4.7 的决策追踪与重放，帝国现在具备完整的：

1. **感知**: Flow Accounting (A4.1) + Multi-Resource Health (A4.2)
2. **规划**: Logistics Planning (A4.3) + Convergence (A4.4)
3. **健康评估**: Empire Health & Autonomy (A4.5)
4. **恢复执行**: Recovery Execution (A4.6)
5. **可审计性**: Decision Trace & Replay (A4.7)

帝国能感知自身状态、规划资源流动、评估健康度、自动恢复失败、并记录每个决策的完整原因链以供事后追溯。
