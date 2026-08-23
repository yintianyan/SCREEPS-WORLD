# REQUEST_POOL_DESIGN — 物流请求池设计（P3）

> 合同锚点：LOGISTICS_ARCHITECTURE §1–§5；SYSTEM_BOUNDARIES §1.6（Public API：
> submitRequest/claimLease）；STATE_OWNERSHIP §1.4（Demand 瞬时不持久化）；
> EMPIRE_SYSTEM_MODEL §1（Demand/Task 六态）。裁决依据：P3_A2_CONTRACT_REVIEW C3/C5。

## 1. 落点与边界（C5 执行）

| 件 | 落点 | 性质 |
| --- | --- | --- |
| 请求池纯逻辑 | src/domain/assignment/request-pool.ts | 纯函数（禁 Game/Memory），Vitest 主力 |
| 池系统载体 | src/systems/logistics.ts（新，模块 1.6 P0 档） | 每 tick 重导出请求池 + 租约登记 + 指标 + 过期回执 |
| 工作任务分配 | systems/assignment-service（fill/build/upgrade 部分不动） | D1 归位：haul 段自 buildRoomTasks 迁出至本池 |

DataFlow：Logistics 生成搬运请求（Demand 一等来源）→ 写入 assignment 缓存槽 → hauler
acquire 相位经既有 chooseTaskForRole 认领（claim 即 Task）→ 执行层 work 链投递。
**不引入第五种概念、不建持久请求表**——每 tick 重导出即天然 dedup（确定性 key 幂等）。

## 2. TransportRequest 模型（五字段合同化）

```ts
interface TransportRequest {
  key: string;            // 确定性身份："collect:<room>:<containerId>" —— dedup 由重建幂等保证
  resource: ResourceConstant;
  amount: number;         // 源侧可取量（已扣在途租约——防超卖）
  pos: {x,y};             // 距离感知择近用
  priority: 0|1|2|3;      // P0 塔/紧急收集；P1 常态收集
}
```
跨 tick 连续性由两件承载：①key 注册表（heap）记 firstSeen（age/TTL/延迟分母）；②执行者
creep.memory.assignment 租约（leaseUntil+revision 校验，既有机制）。心跳=持有者存活；
超时回收=validateAssignmentRules 失效自动重挂（既有）；并发上限=每请求 maxWorkers 1（既有）。

## 3. 需求产生者与聚合（P3 单房集合）

| 请求 | 优先级 | 生成判据 | 聚合语义 |
| --- | --- | --- | --- |
| container 收集 | P1（塔饥渴时提级 P0） | 含能非 controller container 且有可用供给 | 每 container 一请求（拆分单点聚合，P2-5 先例） |
| 塔补给并入物流 | P0 提级信号 | 任一塔低于阈值区间下沿 | **不新增执行器**：塔缺口把该房全部收集请求提级——需求侧聚合驱动供给侧加速，hauler work 链本就塔置顶投递 |

link/terminal/lab 供需池水位缺口归各自系统（RCL5+/工业域），经同一 submitRequest 口接入
（接口预留，不在单房期实现）。

## 4. 供给登记五源与防超卖

供给侧登记＝「此处有多少可取」：source container / storage / link / terminal / 散落 container
（LOGISTICS §2.1-1）。P3 生效子集＝container（storage→sink 归 distributor 直配，不入池）。
防超卖公式：available(supply) = store − Σ(活跃租约量)，活跃租约=creepRefs 中 kind=haul 且
sourceId 匹配且租约有效。纯函数 supplyLedger 可测。

## 5. TTL / 过期 / 回执 / 饥饿老化（§5 合同）

- TTL：age = tick − firstSeen(key)；age ≥ ttlTicks（CONFIG.logistics.requestTtl）→ 出池 +
  recordEvent(RequestExpired)（**不静默丢单**）+ 清注册表项。条件消失（源空）自然消失亦回执
 （fulfilled-or-vanished 区别由 latency 样本有无判定）。
- 饥饿老化：age > promoteAfter 且 priority ≥ 2 → 提一级（仅 P2/P3 适用；Recovery 档不生效）。
  P3 池内多为 P0/P1——机制存在、当前少触发，属合同完整性要求。
- 延迟样本：key 首次被认领时 latency = tick − firstSeen 入 heap ring（分位数口径留遥测批）。

## 6. 三指标（LOGISTICS §4）

| 指标 | 采集点 | 落点 |
| --- | --- | --- |
| 空载率 idleRatio | hauler 无单可领的 acquire tick（角色层 bump） | L1 计数 → economy ring 低频聚合 |
| 延迟 latency | 池认领时刻 − firstSeen | heap ring（segment 扩展随观测批次） |
| 断链数 brokenLinks | source container/link 满度事件计数 | RCL5 前恒 0，事件钩子预埋 |

## 7. 与 Economy 的闭环（任务书 §26）

EconomyState（三指标）→ 本池消费点：①风险缓冲 < 下限时池收缩——**已实现**
（applyShrink，rb/10 < CONFIG.logistics.shrinkRiskBufferTicks → 只保 P0/P1）；
②contractReserve 水位区间制决定收集紧迫度提级（塔饥渴提级已实现；水位区间随
Step 7 收尾）。闭环其余段由 Accounting（已实现）与消费门禁接续。spawn 侧对称
消费点：风险缓冲低于 CONFIG.spawn.lowRiskBufferTicks → 非 P0 孵化预算扣
recoveryEnergyReserve（Reservation①，spawn-manager）。

## 8. 不做清单（本阶段）

- storage→sink 配送请求（distributor 直配维持；池化配送随 A2 后半评估）。
- link/terminal/mineral 供需入池。跨房请求。全局最优匹配（红线 1）。
- 请求持久化 Memory（红线）。匈牙利/全量重匹配（红线 1）。