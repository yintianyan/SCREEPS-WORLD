# A3.1 Architecture Review — Empire Resource Network

> 日期：2026-08-24。阶段：A3.1 — Empire Resource Network。
> 基线：A3.0 Multi-Room Execution Foundation 已完成并提交。
> 方法：审查 A3.0 全部实现代码 + 架构文档，回答 15 个架构问题，
> 输出分类矩阵（Already Generic / Needs Generalization / Missing / Architecture Risks / Migration Plan）。
> **禁止直接修改代码**——本文为设计审查阶段产出。

---

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| A3.0 证明了什么 | Empire 可以可靠驱动**单个**跨房 Operation（A→B 能量调拨，含失败恢复） |
| A3.1 需要证明什么 | Empire 可以协调**多个** Room、**多个** Request、**多个** Operation 形成 Resource Network |
| 当前模型通用性 | **中等**——Operation/Reservation 生命周期是通用的；但 Allocation 和 Carrier 是 Energy + Point-to-Point 耦合的 |
| 最大架构风险 | **无 Supply Node / Demand Node 抽象**——所有 surplus/deficit 信息散落在 RoomRegistryEntry 中，无法表达多源满足、部分分配、优先级仲裁 |
| Double Allocation 风险 | **中**——Reservation 机制设计上防超卖，但同 tick 内 Operation 创建循环存在 TOCTOU（详见 Q10/Q11） |
| Operation Storm 风险 | **中**——幂等键 `supply:${from}:${to}:${resource}` 防同对重复，但**不防多对多同时创建大量 Operation** |
| Starvation 风险 | **高**——贪心分配总是优先最紧急的 deficit，低优先级 deficit 可能永远得不到资源 |
| Priority Inversion 风险 | **高**——无抢占机制，低优先级 Operation 先占资源后无法被高优先级 Operation 抢占 |
| 距离 Empire Resource Network | 缺少 Supply Node / Demand Node / Resource Graph / Many-to-Many Allocation Plan / Preemption / Network Health / Rebalance / Thrashing Prevention |
| 进入 A3.1 | **GO**（前置项：A3.0 链路跑通、失败恢复验证、typecheck+test+build 全绿） |

---

## 1. A3.0 实现审查范围

### 1.1 审查的代码文件

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/domain/operation/agenda-item.ts` | 156 | Operation 类型 + 状态枚举 + 创建/查询纯函数 |
| `src/domain/operation/lifecycle.ts` | 154 | 九态状态机 + 超时/重试/交付报告 |
| `src/domain/operation/allocation.ts` | 171 | 多对多贪心分配策略 |
| `src/domain/operation/reservation.ts` | 186 | 跨房资源预留（TTL + 心跳 + 清扫） |
| `src/domain/operation/verification.ts` | 119 | 送达验证（baseline + delta） |
| `src/domain/operation/transport-planner.ts` | 154 | 路由 + Carrier Body + ETA + TransportRequest 生成 |
| `src/domain/operation/dedup.ts` | 80 | 幂等键去重 + 终态清理 |
| `src/domain/operation/replan.ts` | 164 | 事件驱动重规划（6 类事件） |
| `src/domain/operation/metrics.ts` | 120 | 运行时指标快照 |
| `src/domain/economy/ownership.ts` | 91 | 可调拨量计算 |
| `src/domain/strategy/room-registry.ts` | 146 | 已知房间注册表 + surplus/deficit 分类 |
| `src/domain/economy/room-profile.ts` | 375 | Room Economic Profile + 门控函数 |
| `src/domain/strategy/imbalance.ts` | 198 | 跨房资源余缺检测 + 调拨候选 |
| `src/systems/agenda-manager.ts` | 569 | 系统侧薄壳——串联全部 domain 链路 |
| `src/creeps/roles/carrier.ts` | 112 | 跨房搬运角色 |
| `tests/unit/operation/carrier-full-chain.test.ts` | 328 | 完整链路集成测试 |

### 1.2 审查的文档

- `docs/phase4/A3_ARCHITECTURE_AUDIT.md` — A3.0 开工前架构审计
- `docs/phase4/RESOURCE_OWNERSHIP_MODEL.md` — 资源所有权模型
- `docs/phase4/RESOURCE_IMBALANCE_MODEL.md` — 跨房资源余缺检测
- `docs/architecture/ARCHITECTURE_FREEZE.md` — §15 修订记录（ADR R0-R9）

---

## 2. 15 个架构问题回答

### Q1: 当前 Supply Operation 哪些部分是 Energy-specific？

**以下部分硬编码为 energy：**

| 组件 | Energy-specific 位置 | 详情 |
| --- | --- | --- |
| `OperationType` | `type OperationType = "supply"` | 类型只有 supply，但 supply 语义隐含 energy |
| `ResourceType` | `type ResourceType = "energy"` | 资源类型只有 energy |
| `Reservation.resource` | `resource: "energy"` | 预留资源类型硬编码 |
| `TransportRequest.resource` | `resource: "energy"` | 请求资源类型硬编码 |
| `carrier.ts` | `RESOURCE_ENERGY` 硬编码 | acquire: `withdraw(storage, RESOURCE_ENERGY)`；work: `transfer(storage, RESOURCE_ENERGY)` |
| `ownership.ts` | `storageEnergy` / `computeTransferable` | 只计算 energy 的可调拨量 |
| `room-profile.ts` | `canExportEnergy()` / `needsEnergyAid()` | 门控只判断 energy |
| `agenda-manager.ts` | `baselineEnergy` 字段 | 验证只看 storage energy 增量 |
| `verification.ts` | `currentStorageEnergy` 参数 | 验证只比较 energy 增量 |
| `allocation.ts` | `estimateDeficitAmount` | 基于能量安全水位计算缺口 |

**判定**：Supply Operation 的**生命周期状态机**（planned→ready→running→verifying→completed）和 **Reservation 机制**（TTL + 心跳 + 清扫）是通用的——它们不依赖 energy 语义。但**门控、分配、验证、执行**四个环节全部 Energy-specific。

### Q2: 哪些部分已经真正通用？

| 组件 | 通用性 | 说明 |
| --- | --- | --- |
| Operation Lifecycle 状态机 | ✅ 通用 | 九态转换与资源类型无关 |
| Reservation TTL + 心跳 | ✅ 通用 | 预留机制不感知资源类型 |
| Operation Deduplication | ✅ 通用 | 幂等键含 resource 参数，理论上支持多资源 |
| Event-driven Replanning | ✅ 通用 | 6 类事件与资源类型无关 |
| Operation Metrics | ✅ 通用 | 指标聚合不感知资源类型 |
| ReplanEvent 类型 | ✅ 通用 | room-lost/room-critical/carrier-death 等事件通用 |

**结论**：A3.0 的**状态管理和失败恢复骨架**是通用的。Energy-specific 的是**感知、分配、执行、验证**四层。

### Q3: 哪些逻辑错误地绑定在 Room A → Room B？

| 绑定点 | 位置 | 问题 |
| --- | --- | --- |
| **Operation ID = `supply:${from}:${to}:${resource}`** | `agenda-item.ts:94` | 幂等键绑定**单向**的 from→to 对。同一对房的反向调拨是不同 Operation。但这**不是错误**——A→B 和 B→A 确实是不同操作。真正的问题是：**一个 Target 的需求不能被多个 Source 满足**，因为幂等键只允许一个活跃 Operation per (from, to, resource) 对。 |
| **Carrier 单一 home→remoteTarget** | `carrier.ts` + `agenda-manager.ts:204-211` | carrier 的 memory 绑定 `home=sourceRoom, remoteTarget=targetRoom`。一个 carrier 只服务一个 (source, target) 对。无法支持"carrier 从 A 取能，送 到 B 或 C 按需分配"的动态路由。 |
| **AllocationPlan = (sourceRoom, targetRoom, amount)** | `allocation.ts:22-31` | 分配计划是**一对一三元组**。虽然有 `allocateMultiRoom` 支持多对多，但每个 plan 仍然是单 source → 单 target。无法表达"A→C 3000 + B→C 2000"（多源满足同一 target）——实际上 `allocateMultiRoom` 的贪心循环**可以**做到这一点，因为 deficit 循环内会遍历多个 source 直到需求满足。但**每个 source→target 分配是独立的 Operation**，没有"多源满足同一 target"的一等公民概念。 |
| **Verification baseline = target storage energy** | `agenda-manager.ts:456-458` | baseline 只记录 target room 的 storage energy 增量。如果有多个 Operation 同时向同一 target 送能，baseline 会被**互相覆盖**——Operation 1 的 baseline 被 Operation 2 的送达量污染。 |
| `submitCarrierSpawn` 直接绑定 op.sourceRoom | `agenda-manager.ts:179-220` | carrier spawn 请求提交到 source room 的 spawn queue。这是正确的——carrier 从 source 取能。但**不支持"carrier 在途中改道"**——一旦提交，source 和 target 就固定了。 |

**判定**：Point-to-Point 耦合最严重的是 **baseline 验证**——多个 Operation 向同一 target 送能时，baseline 互相污染，验证逻辑会误判。其次是 **carrier 的固定路由**——不支持动态重路由。

### Q4: Request 是否支持多个来源？

**否**。当前 `TransportRequest` 的语义是"从某处取指定量资源送到 targetRoom"。但：

- `sourceId` 字段是 `undefined`（`transport-planner.ts:107`："由系统侧在提交时填充"），实际上从未被填充。
- `TransportRequest` 没有 `sourceRoom` 字段——只有 `targetRoom`。
- source 信息只存在于 `OperationContext.sourceRoom` 和 `AllocationPlan.sourceRoom` 中。
- 一个 Request 只对应一个 Operation，一个 Operation 只对应一个 (source, target) 对。

**不支持**"一个 Request 由多个 Source 共同满足"的语义。当前模型是 **1 Operation = 1 (source, target) pair = 1 carrier**。

### Q5: 一个 Target 是否可以同时有多个 Request？

**部分是**。从 `OperationContext` 角度：
- 幂等键 `supply:${from}:${to}:${resource}` 只阻止**同一 (from, to, resource) 对**的重复 Operation。
- **不同 source 到同一 target 是允许的**——`supply:A:C:energy` 和 `supply:B:C:energy` 是不同 Operation，可以同时存在。

但从 **Request Pool** 角度：
- `TransportRequest.key = empire-supply:${sourceRoom}:${targetRoom}`——同 (source, target) 的请求会合并。
- 不同 source 到同一 target 的请求是不同 key，不会合并。
- **但 Request Pool 不消费 empire scope 请求**——A3.0 的 agenda-manager 直接提交 carrier spawn 请求，绕过了 Request Pool。

**结论**：模型上支持多 source → 同一 target，但执行层（carrier spawn）没有协调机制——两个 carrier 可能同时到达 target storage 并竞争卸载容量。

### Q6: 一个 Source 是否可以同时供应多个 Target？

**是**，但有上限。`allocation.ts:34` 定义 `MAX_DEFICITS_PER_SOURCE = 2`——一个 source 最多同时服务 2 个 deficit。这是通过 `sourceLoad` 计数器实现的。

但存在风险：
- `allocateMultiRoom` 在分配时递减 `available`（source 可用量），正确防止了**量**的超分配。
- 但 `sourceLoad` 只在**单次分配调用**中有效——跨 tick 的新分配调用不知道上一 tick 已分配了多少 sourceLoad。
- 实际跨 tick 的 source 负载控制依赖 `computeTransferable`（扣除 activeReservations），而不是 sourceLoad 计数。

**结论**：模型支持，但 **sourceLoad 限制是 per-call 的，不是持久化的**。

### Q7: 多个 Source 是否可以共同满足一个 Target？

**部分是**。`allocateMultiRoom` 的贪心循环**可以**为同一 deficit 遍历多个 source：

```typescript
// allocation.ts:63-98
for (const deficit of deficitRooms) {
  let remaining = targetNeed;
  for (const source of surplusRooms) {
    // ... 分配 min(remaining, srcAvail) ...
    remaining -= allocate;
    if (remaining < MIN_TRANSFER_AMOUNT) break;
  }
}
```

但这会生成**多个独立 AllocationPlan**——每个 (source, deficit) 对一个 plan。每个 plan 对应一个独立 Operation。这些 Operation 之间**没有协调**——不共享验证 baseline、不共享交付追踪。

**结论**：可以做到多源满足，但**不是一等公民**——没有"多源满足组"的概念，验证和交付追踪是 per-Operation 独立的。

### Q8: Allocation 是否具备全局排序能力？

**是**，但是简单的。`allocateMultiRoom` 的排序策略：

1. deficit 按 `riskBuffer` 升序（最紧急的优先）
2. surplus 按 `transferable` 降序（最富余的优先）

这是**全局排序**——所有 deficit 和 surplus 都参与排序。但排序维度有限：

- ✅ 紧急度（riskBuffer）
- ✅ 富余度（transferable）
- ❌ 距离（route hops）——不考虑
- ❌ 截止时间（deadline）——不考虑
- ❌ 经济健康度——不考虑（只用 isStruggling 做二值门控）
- ❌ 已有负载——不考虑（sourceLoad 只在单次调用内有效）

**结论**：有全局排序，但**维度不足**，且**不可解释**（不输出"为什么 A→C 而不是 B→C"的理由）。

### Q9: Operation 是否会产生冲突？

**会**。以下冲突场景已识别：

| 冲突类型 | 场景 | 后果 |
| --- | --- | --- |
| **Baseline 污染** | Operation 1 (A→C) 和 Operation 2 (B→C) 同时运行。Op1 记录 baseline=10000。Op2 的 carrier 先到达 C 并卸能 2000。Op1 验证时发现 currentEnergy=12000, delta=2000，但其中 0 来自 Op1 的 carrier。 | Op1 误判为部分送达 |
| **Storage 容量竞争** | 两个 carrier 同时到达 target storage，storage 剩余容量只够一个 carrier 卸载 | 一个 carrier 等待，另一个完成后才有空间 |
| **Source 超卖** | 如果 Reservation TTL 过期但 Operation 未标记 blocked（agenda-manager 100 tick 才复核），期间新 Operation 可能基于过期的 transferable 创建 | Double Allocation |
| **Operation Storm** | 10 个 deficit × 10 个 surplus = 100 个 AllocationPlan → 100 个 Operation 同时创建 | CPU 飙升 + spawn queue 爆满 |

### Q10: Reservation 是否能够处理多个并发 Operation？

**是**，设计上支持。`ReservationTable = Map<operationId, Reservation>`，每个 Operation 有独立 Reservation。`sumReservationsByRoom` 正确汇总同一 source 的所有活跃预留。

但存在**时间窗口风险**：
- agenda-manager 每 100 tick 执行一次。
- Reservation 在 `createReservation` 时创建，`sumReservationsByRoom` 在同一 tick 的 `computeTransferableBulk` 中被消费。
- 但如果 Reservation TTL 在两次 agenda-manager 执行之间过期（`sweepExpired` 只在 agenda-manager 执行时调用），期间**没有人释放过期的 Reservation**。
- 更重要的是：**新 Operation 创建时检查 transferable，用的是当前 ReservationTable 的快照**。如果两个 Operation 在同一 tick 创建（同一个 agenda-manager run），第二个 Operation 看不到第一个刚创建的 Reservation——因为 `allocateMultiRoom` 在分配时递减 `available` Map，但 `createReservation` 在分配后循环创建。

检查 `agenda-manager.ts:382-418`：

```typescript
// Step 12: 为新计划创建 Operation
for (const plan of plans) {
  // 检查 source 仍有足够可调拨量
  const sourceEntry = registry.get(plan.sourceRoom);
  if (!sourceEntry || sourceEntry.transferable < plan.amount) {
    continue; // ← 这里检查的是 step 7 的 transferable，不含本 tick 新建的 Reservation
  }
  // ... createOperation + createReservation ...
}
```

**问题**：`sourceEntry.transferable` 是 Step 7 计算的，考虑了**已有的** Reservation，但**不考虑本循环中新创建的 Reservation**。如果同一 source 有两个 plan，第一个 plan 创建了 Reservation 3000，第二个 plan 检查 transferable 时看到的是**扣减前的值**——因为 `registry` 没有更新。

**判定**：**存在 Double Allocation 风险**——同一 tick 内，同一 source 的多个 plan 可能基于过时的 transferable 创建 Reservation。

### Q11: 当前系统是否可能发生 Resource Double Allocation？

**是**，有两处风险：

1. **同 tick 内的 TOCTOU**（Time-of-Check-to-Time-of-Use）：
   - `allocateMultiRoom` 在分配时递减 `available` Map（正确防超卖）。
   - 但 `agenda-manager.ts:382-418` 的 Operation 创建循环**不使用** `allocateMultiRoom` 的 `available` Map——它直接检查 `sourceEntry.transferable`，这个值在循环中不更新。
   - **修复方向**：在 Operation 创建循环中，每创建一个 Reservation 就更新 `sourceEntry.transferable`。

2. **跨 tick 的 TTL 窗口**：
   - Reservation TTL 默认 500 tick。agenda-manager 每 100 tick 执行。
   - 如果 Reservation 在 tick T+400 过期（TTL 到期），但 agenda-manager 在 T+500 才执行 `sweepExpired`——这 100 tick 内，过期的 Reservation 仍被 `sumReservationsByRoom` 计入。
   - 这不会导致 Double Allocation（过期 Reservation 仍占位），但会导致**资源被浪费**——transferable 被低估。

### Q12: 当前系统是否可能发生 Operation Storm？

**是**。当前防护只有幂等键去重——`supply:${from}:${to}:${resource}`。这意味着：

- 10 surplus × 10 deficit = 最多 100 个不同 (from, to) 对 = 100 个 Operation。
- 没有 Operation 总数上限。
- 没有"同一 source 最多 N 个活跃 Operation"的限制（`MAX_DEFICITS_PER_SOURCE=2` 只在单次 `allocateMultiRoom` 调用中有效，不持久化）。
- 没有"同一 target 最多 N 个活跃 Operation"的限制。

**后果**：
- 100 个 carrier spawn 请求同时涌入 spawn queue。
- CPU 飙升（每个 Operation 的路由计算 + 验证检查）。
- Memory 增长（100 个 OperationContext + 100 个 Reservation）。

### Q13: 当前系统是否可能发生 Starvation？

**是**。贪心分配总是优先 `riskBuffer` 最低的 deficit。如果：

- Room C：riskBuffer=50（极紧急），需要 5000
- Room D：riskBuffer=800（中等），需要 3000
- Source A：transferable=3000

则 `allocateMultiRoom` 会把 3000 全部分配给 C。D 永远得不到资源——除非 C 的需求被完全满足。

如果 C 持续 deficit（例如持续被攻击消耗），D 会**永久 starvation**。

当前**没有**：
- Starvation 检测（D 等待了多久？）
- Aging 机制（D 的优先级随等待时间提升？）
- 公平分配（保证 D 获得一定比例？）

### Q14: 当前系统是否可能发生 Priority Inversion？

**是**。场景：

1. Room D 的 Operation（priority=2, normal）先创建，Reservation 锁定了 Source A 的 3000 能量。
2. Room C 突然进入 critical（riskBuffer→0），需要紧急援助。
3. 新的 `supply:A:C:energy` Operation 创建——但 Source A 的 transferable 已被 D 的 Reservation 扣减。
4. 如果 A 的 transferable 在扣除 D 的 Reservation 后不足以支援 C → C 的 Operation 创建失败或 amount 被压低。

当前**没有**：
- Preemption 机制（取消 D 的 Operation 释放 Reservation 给 C）
- 优先级感知的 Reservation（Reservation 不记录 priority）
- Operation 冲突仲裁（多个 Operation 争夺同一 source 时没有仲裁）

### Q15: 当前系统距离 Empire Resource Network 还缺什么？

| 缺失能力 | 严重度 | 说明 |
| --- | --- | --- |
| **Supply Node / Demand Node 抽象** | 🔴 关键 | surplus/deficit 散落在 RoomRegistryEntry 中，没有一等公民的节点抽象 |
| **Resource Graph / Network Snapshot** | 🔴 关键 | 没有 Network 级别的快照——无法观察全局供需状态 |
| **Many-to-Many Allocation Plan** | 🔴 关键 | 当前 AllocationPlan 是 1:1 三元组，不支持"A→C 3000 + B→C 2000"作为一组计划 |
| **Multi-Source Fulfillment** | 🔴 关键 | 没有"一个 Target 的需求由多个 Source 共同满足"的一等概念 |
| **Partial Fulfillment（Request 级）** | 🟡 重要 | Operation 有 deliveredAmount，但 Request 没有"已满足量"和"剩余量"追踪 |
| **Priority Arbitration** | 🔴 关键 | 多个 Operation 争夺同一 Resource 时无仲裁 |
| **Preemption Policy** | 🔴 关键 | 无法取消/降级/缩减低优先级 Operation 来释放资源 |
| **Plan Stability / Anti-Thrashing** | 🔴 关键 | 无 Operation 滞回、最小承诺、重规划阈值 |
| **Network Health** | 🟡 重要 | 无全局健康度评估 |
| **Incremental Scheduler** | 🟡 重要 | agenda-manager 每 100 tick 全量重算，不是事件驱动增量 |
| **Rebalance Trigger** | 🟡 重要 | 有 ReplanEvent 但没有"Rebalance"语义——不会因新 Supply/Demand 出现而重新分配 |
| **Network-level Recovery** | 🟡 重要 | 有 carrier-death 等 Operation 级恢复，但没有"Source 丧失生产能力后重新寻找 Source"的网络级恢复 |
| **Room Fault Isolation** | 🟡 重要 | agenda-manager 无 try-catch 包裹单房处理——一个房异常可能中断整个循环 |
| **Observability Dashboard** | 🟡 重要 | 有 OperationMetrics 但无 Network Dashboard |
| **Generic Resource Type** | 🟢 次要 | ResourceType 只有 energy，但 A3.1 只做 energy，其他资源只建模型 |

---

## 3. 分类矩阵

### 3.1 Already Generic（可直接复用）

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| Operation Lifecycle 状态机 | `lifecycle.ts` | 九态转换与资源类型、房间对无关 |
| Reservation TTL + 心跳 + 清扫 | `reservation.ts` | 预留机制完全通用 |
| Operation Deduplication | `dedup.ts` | 幂等键含 resource 参数 |
| Event-driven Replanning | `replan.ts` | 6 类事件通用 |
| Operation Metrics | `metrics.ts` | 指标聚合不感知资源类型 |
| Resource Ownership 公式 | `ownership.ts` | `transferable = storage - reserve - safety - reservations` 通用 |
| Room Registry 数据结构 | `room-registry.ts` | Map 结构通用 |
| RoomEconomicProfile | `room-profile.ts` | 标准化只读视图 |
| safeRun 错误隔离 | `safe-run.ts` | 可包裹单房/单 Operation 处理 |
| CPU 看门狗分频 | `scheduler.ts` | 低频执行机制 |

### 3.2 Needs Generalization（需泛化改造）

| 组件 | 当前 | A3.1 目标 | 改造方向 |
| --- | --- | --- | --- |
| `OperationType` | 只有 `"supply"` | 保持 supply 但 model 上支持其他 type | 不改类型，但确保 supply 不绑定 energy-only 语义 |
| `ResourceType` | `"energy"` 硬编码 | 扩展为 `"energy" \| (future types)` | 类型扩展，但 A3.1 只执行 energy |
| `Reservation.resource` | `"energy"` 硬编码 | 泛化为 `ResourceType` | 改类型定义 |
| `TransportRequest.resource` | `"energy"` 硬编码 | 同上 | 改类型定义 |
| `AllocationPlan` | 1:1 三元组 (source, target, amount) | 需支持多源满足组 | 新增 `AllocationGroup` 概念或保持 1:1 但加 Target Fulfillment 追踪 |
| `allocateMultiRoom` 排序 | riskBuffer + transferable | 加入距离、deadline、经济健康度 | 扩展排序维度 |
| `allocateMultiRoom` sourceLoad | per-call 非持久化 | 持久化 source 负载计数 | 从 active Operations 统计 |
| `verifyTransfer` baseline | per-Operation baseline | 需防多 Operation baseline 污染 | 改为 per-Target 全局 baseline 或用 carrier 实际卸载量验证 |
| `carrier.ts` | 固定 home→remoteTarget | 保持（carrier 是 1:1 执行单元） | 不改 carrier，但用 Request Pool 协调多 carrier |
| `agenda-manager` Operation 创建 | 不更新 transferable | 每创建 Reservation 后递减 transferable | 修复 TOCTOU |
| `agenda-manager` 全量重算 | 每 100t 全量 | 事件驱动 + 增量 | 加 dirty mark + debounce |
| `OperationContext` 缺 fulfillment 追踪 | 只有 deliveredAmount | 加 `fulfilledAmount` / `remainingAmount` per Target | 扩展类型 |

### 3.3 Missing（必须新建）

| 组件 | 落点 | 说明 |
| --- | --- | --- |
| Supply Node | `src/domain/operation/supply-node.ts` | 房间级供给节点（Room + Resource + Available + Reserved + Safety + Transferable + Priority + Health + Capacity + Timestamp） |
| Demand Node | `src/domain/operation/demand-node.ts` | 房间级需求节点（Room + Resource + Requested + Priority + Deadline + Criticality + Fulfilled + Remaining） |
| Resource Network Snapshot | `src/domain/operation/network-snapshot.ts` | 全局供需快照（Supply Nodes + Demand Nodes + Reservations + Active Operations + Pending Requests + Allocation Plan + Timestamp） |
| Allocation Plan (v2) | `src/domain/operation/allocation.ts` | 升级为多对多分配计划，支持 Multi-Source Fulfillment + Partial Allocation |
| Allocation Policy (v2) | `src/domain/operation/allocation-policy.ts` | 可解释分配策略（7 因子：Criticality + Priority + Safety + Transferable + Distance + Health + Deadline） |
| Preemption Policy | `src/domain/operation/preemption.ts` | 抢占策略（Preemptable / NonPreemptable / Committed / Critical 分类） |
| Plan Stability Policy | `src/domain/operation/stability.ts` | 防抖策略（Operation Hysteresis + Minimum Commitment + Rebalance Threshold + Cooldown） |
| Network Health | `src/domain/operation/network-health.ts` | 网络健康度（HEALTHY / CONSTRAINED / DEGRADED / CRITICAL） |
| Network Rebalance | `src/domain/operation/rebalance.ts` | 事件驱动重平衡（dirty mark + debounce + 增量重算） |
| Network Dashboard | `src/systems/` 或 `src/domain/operation/network-dashboard.ts` | 可观测性仪表盘 |

### 3.4 Architecture Risks

| 风险 | 严重度 | 影响 | 缓解方向 |
| --- | --- | --- | --- |
| **Baseline 污染** | 🔴 高 | 多 Operation 向同一 target 送能时验证误判 | 改用 carrier 实际卸载量验证，或 per-target 全局 baseline + 独立 Operation 交付量追踪 |
| **TOCTOU Double Allocation** | 🔴 高 | 同 tick 内同 source 多 Operation 超卖 | Operation 创建循环中递减 transferable |
| **Operation Storm** | 🟡 中 | 大量 Operation 同时创建导致 CPU/spawn 爆满 | 全局 Operation 上限 + per-source/target 上限 |
| **Starvation** | 🟡 中 | 低优先级 deficit 永远得不到资源 | Aging 机制 + 公平份额 |
| **Priority Inversion** | 🟡 中 | 低优先级 Operation 先占资源阻塞高优先级 | Preemption Policy |
| **Thrashing** | 🟡 中 | 资源调度抖动（A→C→A→D→A→C...） | Operation Hysteresis + Minimum Commitment |
| **全量重算 CPU** | 🟡 中 | 每 100t 全量重算所有房间供需 | 事件驱动 + 增量 + dirty mark |
| **Reservation TTL 窗口** | 🟢 低 | 过期 Reservation 占位导致 transferable 低估 | 缩短 TTL 或在 tick 间隙也做 sweep |
| **Room Fault 传播** | 🟡 中 | 单房异常中断整个 agenda-manager 循环 | safeRun 包裹单房处理 |

### 3.5 Migration Plan

```text
Phase 1: Model Layer (不影响现有运行时)
  ├── 新建 Supply Node / Demand Node 纯函数
  ├── 新建 Resource Network Snapshot 纯函数
  ├── 新建 Allocation Policy v2（可解释分配策略）
  ├── 新建 Preemption Policy 纯函数
  ├── 新建 Plan Stability Policy 纯函数
  ├── 新建 Network Health 纯函数
  └── 扩展 ResourceType 为联合类型（不破坏 energy-only 执行）

Phase 2: Integration Layer (修改 agenda-manager)
  ├── 修复 TOCTOU: Operation 创建循环中递减 transferable
  ├── 修复 Baseline 污染: 改用 carrier 卸载量验证
  ├── 接入 Supply/Demand Node 构建（从 RoomRegistryEntry 派生）
  ├── 接入 Allocation Policy v2（替换 allocateMultiRoom）
  ├── 接入 Network Snapshot 构建
  ├── 接入 Preemption Policy
  ├── 接入 Plan Stability Policy
  └── 接入 Network Health

Phase 3: Scheduler Layer (事件驱动)
  ├── 实现 dirty mark + debounce
  ├── 实现 Incremental Rebalance（只重算受影响 scope）
  └── 实现 safeRun 单房隔离

Phase 4: Testing Layer
  ├── 20 个 Contract Tests (A3.1-001..020)
  ├── 4 Room Simulation
  ├── Scale Test (10/20/50 rooms)
  ├── 10k Tick Stability Test
  └── Observability Dashboard

Phase 5: Validation
  ├── Simulation Validation
  ├── Controlled Multi-Room Validation (如可用)
  ├── Real Owned-Room Validation (如可用)
  └── Final Report
```

---

## 4. 关键设计决策建议

### 4.1 Supply Node / Demand Node vs. RoomRegistryEntry

**建议**：新建独立的 Supply Node / Demand Node，**不替换** RoomRegistryEntry。

理由：
- RoomRegistryEntry 是**全量房间注册表**（包含既不 surplus 也不 deficit 的房间）。
- Supply/Demand Node 是**网络参与者的投影**——只在房间有 surplus 或 deficit 时创建。
- 两者生命周期不同：Registry 每 100t 全量更新；Supply/Demand Node 可以增量更新。

### 4.2 AllocationPlan v2: 保持 1:1 还是引入 AllocationGroup?

**建议**：保持 AllocationPlan 为 1:1（source, target, amount），但在 **Demand Node** 上追踪 `fulfilledAmount` 和 `remainingAmount`。

理由：
- 引入 AllocationGroup 增加了组合复杂度，但实际执行仍然是 1:1（一个 carrier 一次只从 A 到 B）。
- 在 Demand Node 级别做 fulfillment 追踪更自然——"C 总共需要 5000，已从 A 收到 3000，还差 2000"。
- 多源满足 = 多个 1:1 Operation 服务的同一 Demand Node。

### 4.3 Verification: 如何解决 Baseline 污染?

**建议**：放弃 storage energy baseline 验证，改用 **carrier 实际卸载量** 验证。

方案：
- carrier 在 target storage `transfer()` 成功后，返回实际 transfer 量。
- Operation 的 `deliveredAmount` 从 carrier 的 transfer 结果累加。
- 验证阶段不再比较 storage delta，而是检查 `deliveredAmount >= requestedAmount`。

理由：
- baseline 验证在多 Operation 并发时**无法正确工作**——无法区分 delta 来自哪个 Operation。
- carrier 的 `transfer()` 返回值是**确定的**——不依赖其他 Operation 的状态。
- 这与 AGENTS.md 的"行为证据"合同一致——carrier 的 transfer 是行为证据。

### 4.4 Preemption: 哪些 Operation 可以被 Preempt?

**建议**：四分类：

| 分类 | 定义 | 可抢占? |
| --- | --- | --- |
| Critical | priority=0 (survival) | ❌ 不可抢占 |
| Committed | carrier 已在途中（running 且 carrier 不在 source room） | ❌ 不可抢占（carrier 已取能，取消浪费） |
| Preemptable | priority≥2 且 carrier 尚未孵化或在 source room 等待取能 | ✅ 可抢占 |
| Non-Preemptable | priority=1 且 carrier 已孵化但尚未出发 | ⚠️ 条件可抢占（只在 Critical Request 出现时） |

### 4.5 Thrashing Prevention

**建议**：四防线：

| 防线 | 机制 | 说明 |
| --- | --- | --- |
| Operation Hysteresis | Operation 创建后至少 N tick 不被取消 | 防瞬态波动取消 |
| Minimum Commitment | carrier 孵化后至少完成一次运输 | 防半途取消浪费 spawn |
| Rebalance Threshold | 新 Supply/Demand 变化量 < 阈值时不触发 rebalance | 防小波动触发全量重算 |
| Rebalance Cooldown | 上次 rebalance 后 M tick 内不再次 rebalance | 防高频重算 |

---

## 5. 与冻结蓝图的一致性

| 冻结条款 | A3.1 是否遵守 |
| --- | --- |
| PLANNING_ARCHITECTURE §1: 无 Planner 组件 | ✅ 不新建 Planner |
| PLANNING_ARCHITECTURE §3: AgendaItem 生命周期 | ✅ 不修改状态机 |
| PLANNING_ARCHITECTURE §4: 防振荡三防线 | ✅ Plan Stability Policy 实现 |
| DECISION_AUTHORITY §1: Empire 不直接控制 Creep | ✅ 只产出 Operation + Request |
| ECONOMY §1.1: 能量属 Room | ✅ Supply Node 只读 Room 状态 |
| ECONOMY §6 红线 1: 全帝国能量公共池 | ✅ Resource View 是只读聚合 |
| LOGISTICS §7 红线 1: 每 tick 全量重匹配 | ✅ 事件驱动增量 |
| STATE_OWNERSHIP §1: 一个状态一个写者 | ✅ agenda-manager 唯一写者 |
| R4: 资源回购窗口 | ✅ Preemption 释放的资源优先给恢复中的 Operation |
| R8: AgendaItem 类型集=冻结枚举 | ✅ 不新增 OperationType，supply 已在 A3.0 定义 |
| R9: System 注册表上限 15+3 | ✅ 不新建 System，扩展 agenda-manager |

**无结构性冲突**。A3.1 在现有冻结蓝图框架内实施，不需要 ADR。

---

## 6. 裁决

**GO**。

A3.0 已证明 Empire 可以可靠驱动单个跨房 Operation。A3.1 的核心工作是将
Point-to-Point 调拨升级为 Many-to-Many Resource Network，同时保持
现有骨架（Operation Lifecycle / Reservation / Event-driven Replan /
Metrics）不变。

A3.1 的实施分为 5 个阶段：
1. **Model Layer** — 新建 Supply Node / Demand Node / Network Snapshot /
   Allocation Policy v2 / Preemption Policy / Plan Stability Policy /
   Network Health 等纯函数
2. **Integration Layer** — 修复 TOCTOU + Baseline 污染 + 接入新模型
3. **Scheduler Layer** — 事件驱动 + 增量 + 单房隔离
4. **Testing Layer** — 20 Contract Tests + 4 Room Simulation + Scale Test +
   10k Tick Stability
5. **Validation Layer** — Simulation / Controlled / Real Validation

**严格禁止**：
- Remote Mining / Claim / Reserve / Expansion Execution
- Military / Power / Terminal Automation / Market / Factory
- Empire 直接控制 Creep / 直接修改 Room Memory / 绕过 Request Pool
- 每 tick 全量 Empire Planning
- 伪造 Mineral / Power 的真实 Economy（只建 Generic Model）
- 直接编码（必须先完成 Architecture Review）

**Architecture Review 完成。等待确认后进入实现阶段。**