# REQUEST_LIFECYCLE — 请求生命周期（P3）

> 任务书 §21 ↔ 冻结语义调和见 P3_A2_CONTRACT_REVIEW §4 C3。权威实现：
> src/domain/assignment/request-pool.ts + src/systems/logistics.ts。

## 1. 生命周期映射（Demand 瞬时 / Task 六态合同）

| 任务书阶段 | 本架构实现 | 载体 |
| --- | --- | --- |
| Created | 每 tick 重导出（确定性 key 幂等＝dedup，§23 达标方式） | logistics.buildTransportRequests |
| Validated | 供给账校验：available>0 ∧ remainingSlots>0 | request-pool.supplyLedger |
| Queued / Prioritized | 池内 priority 排序（塔饥渴提级 P0；饥饿老化提级） | TaskPool 排序 + promoteAged |
| Allocated / Dispatched | hauler acquire 相位 chooseTaskForRole 认领 → creep.memory.assignment 租约 | 既有认领链（claim 即 Task=claimed）|
| Partially Fulfilled / Fulfilled | 投递完成（work 链 transfer）；延迟样本入环 | logistics latencyRing |
| Expired | TTL 到期未认领 → 出池 + RequestExpired 回执（不静默丢单） | reconcileRegistry |
| Cancelled | 生产者条件消失（源空）→ vanished 离池 | reconcileRegistry.vanishedKeys |
| Failed | 执行层 ERR 分支 / 租约失效重挂 | validateAssignmentRules（既有） |

## 2. 不变量

- 池瞬时不持久化（Memory 零写入）；跨 tick 连续性只靠 key 注册表（heap）与执行者租约。
- 同一请求并发上限 1；源侧可承诺量按活跃租约扣减（防超卖）。
- 过期必须有回执事件；fulfilled 与 vanished 区分由认领标记判定。