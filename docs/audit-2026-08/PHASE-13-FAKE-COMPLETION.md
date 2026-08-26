# Phase 13: Fake-Completion Audit — globalCache 字段 / 系统输出消费链验证

> **审计基准**: 2026-08-26
> **方法**: 对 `global-cache.ts` 全部 ~95 个字段逐一 grep 全库引用，区分「生产者写」「消费者读」，
> 追踪跨系统数据链的真实闭环；未在 Runtime 中形成消费链的输出判定为假完成。

---

## 13.1 审计口径

globalCache 字段的裁决分四类：

| 类别 | 判据 |
|------|------|
| ✅ 活跃 | 有明确生产者写入 + 至少一个独立模块读取（观测/决策/执行任一） |
| 👁 弱消费 | 无代码消费者，但位于 heap 可经 console 内省（事后归因可读）— 仅对诊断字段可接受 |
| ⚠️ 只写不读 | 生产者写入后无任何代码路径读取 — 计算成本白付 |
| ❌ 死字段 | 全库零引用（类型在、代码不在）— 纯死代码 |

---

## 13.2 死字段（❌ 全库零引用）

### F-DEAD-1: `logisticsCounters`

`src/kernel/global-cache.ts:75`。注释声明"P3 物流指标 L1 计数器（空载率分母/分子等）"，
但全库无任何写入或读取。L1 埋点从未落地，物流空载率指标是**纸面功能**。

### F-DEAD-2: `empireTransportRequests`

`src/kernel/global-cache.ts:174`。注释声明"A3.0：agenda-manager 每 100t 写入，
logistics 消费"——但 agenda-manager 不写、logistics 不读。帝国级跨房调拨请求池
的整条链路（A3.0 核心承诺之一）**从未实现到代码**，只有 cache 槽位和文档描述。
这是本次审计发现的唯一「结构性假完成」：不是缺消费者，而是连生产者都不存在。

---

## 13.3 只写不读（⚠️ 生产链有、消费链断）

| # | 字段 | 生产者 | 断点说明 | 严重度 |
|---|------|--------|---------|--------|
| WO-1 | `resourceBottlenecks` (A4.2) | empire-economy.ts:345 | 唯一写者，无读者 | 🟡 |
| WO-2 | `empireResourceLedger` (A4.2) | empire-economy.ts:346 | 唯一写者，无读者 | 🟡 |
| WO-3 | `agendaMetrics` (A3.0) | agenda-manager.ts:727 | 唯一写者，无读者 | 🟡 |
| WO-4 | `lastDriftDiag` | economy.ts:184 | 唯一写者，无读者；heap 诊断 → 👁 弱消费可辩护 | 🟢 |
| WO-5 | `logisticsDashboard` (A4.3) | logistics-planner.ts:282 | getter getLogisticsDashboard():656 零调用方 | 🟡 |
| WO-6 | `logisticsAccounting` (A4.4) | logistics-planner.ts:288 | 唯一写者，summary+entries 均无读者 | 🟡 |
| WO-7 | `logisticsScaling` (A4.3) | logistics-planner.ts:285 | getter getScalingDecision():669 零调用方 | 🟡 |
| WO-8 | `__cpuBucketHistory` (A6.3 #7) | empire-health-system.ts:511 | 采样器在跑，prediction-system 不读此序列 | 🟡 |
| WO-9 | `__logisticsHealthHistory` (A6.3 #3) | empire-health-system.ts:535 | 同上 | 🟡 |
| WO-10 | `__roomHealthHistory` (A6.3 #4) | empire-health-system.ts:551 | 同上 | 🟡 |
| WO-11 | `__remoteMiningHistory` (A6.3 #5) | expansion-planner.ts:423 | 同上 | 🟡 |

**附带发现 — 死导出**: logistics-planner.ts 的五个 getter
(`getLogisticsPlan/getLogisticsDashboard/getLogisticsHealth/getScalingDecision/getIdleHaulers`)
中除文件自身外无任何 import 方。真实消费者全部走 `globalCache()` 直取。
这些 getter 是通道的残留物而非消费证据（getLogisticsPlan 的真实消费者在 terminal-manager.ts:100 直读字段）。

**A6.3 预测层断点细节**: 5 条历史采样序列中仅 `__spawnQueueDepthHistory` 被
prediction-system.ts:213 与 calibration-resolution-system.ts:230 真实消费。
CPU 压力预测(#7)/物流瓶颈预测(#3)/房间崩溃预测(#4)/远矿失败预测(#5)
四个预测目标处于"采样循环空转、模型无输入"状态——每个预测周期 empire-health-system
的寄生采样照常消耗 CPU，产出无人读取。

## 13.4 弱消费诊断（👁 可接受但有注意点）

- `lastDriftDiag`: drift 归因窗口分解写在 heap 上，只能 console 手查。
  若要保留应挂到 decision-trace 或 Memory 短期快照；否则等于没记。

## 13.5 已验证活跃的跨系统消费链（抽样完整闭环）

以下此前被点名或属 A3/A4/A5 家族的输出，经追踪确认有真实下游：

| 输出 | 消费者 | 性质 |
|------|--------|------|
| `empireHealth` (A4.5) | war-planning-system, recovery-execution-system, 6 个 intelligence 系统, domain/military×3 | 决策+观测，19 文件 |
| `threatAssessments` (A5.1) | tower-defense(执行), war-posture, expansion-planner 等 10 文件 | 执行级消费 ✅ |
| `recoveryActions` (A4.5) | recovery-execution-system | 执行级消费 ✅ |
| `warAbortSignals` (A5.3) | recovery-execution-system + abort-recovery 纯函数映射 | 执行级消费 ✅ |
| `logisticsPlan` (A4.3) | terminal-manager.ts:100 Plan 驱动发货, agenda-manager Decision Authority | 执行级消费 ✅ |
| `logisticsHealth` (A4.3) | war-planning reliability 门禁, empire-health 维度评分, decision-trace, experience-collector | 决策级消费 ✅ |
| `multiResourceHealth` (A4.2) | war-planning-system + decision-trace | 决策级消费 ✅ |
| `networkSnapshot` (A3.1) | specialization-planner.ts:268 Supply Contract 创建 | 执行级消费 ✅ |
| `lastExpansionOutcome` | experience-collector decisionId 关联匹配 | 观测闭环 ✅ |
| `factoryTargets` / `surplusCompounds` / `marketPrices` / `procurementDemands` | industry/terminal/lab 双向 | 供需链闭环 ✅ |
| `cpuByHome` | telemetry-collector → posture CPU 成本模型 | 决策级消费 ✅ |
| `squadIndex` (P0-1) | querySquad 四系统复用 | 性能索引 ✅ |

**结论修正**: Phase 2 曾推测 "recommendationEngine 写 __recommendationCache 无消费者"
是假完成 —— 经查这是 **契约内的 Shadow-Only 设计**（LLM_BOUNDARY + REC-001 守卫显式禁止执行系统消费），
不计为缺陷。真正的问题在上面 §13.2/§13.3 清单。

---

## 13.6 统计与评分

| 维度 | 数值 |
|------|------|
| 审计字段总数 | ~95 |
| 死字段 | 2 (~2%) |
| 只写不读 | 11 (~12%) |
| 弱消费（诊断类，可辩护） | 1 |
| 活跃 | 其余 ~81 (~85%) |

| 子系统 | 成熟度 | 说明 |
|--------|--------|------|
| 经济/spawn/防御主链消费网 (Phase 4-5 域) | M4 | 全部双向闭环 |
| A4/A3 帝国物流家族 | M3 | plan/health 活跃，dashboard/accounting/scaling 只写 |
| A6.3 预测层 | **M1.5** | 5 采集中 4 无消费者；仅 spawnQueueDepth 进模型 |
| A6 整体 (experience/evaluation/calibration/recommendation) | M2 | Shadow-Only 契约合规，内部 ring buffer 自洽，但对外零输出符合设计 |
| **综合** | **M3** | 主执行链健康；A6.3 预测层与 A4 部分仪表盘存在系统性只写不读 |

---

## 13.7 处置建议（按成本递增）

1. **删除**（零风险）: `logisticsCounters`、`empireTransportRequests` 字段及其注释承诺——
   或者反向操作：若 A3.0 帝国调拨仍是路线图目标，把它登记进 TECH_DEBT_LEDGER 而非留一个假装存在的槽位。
2. **删除采样器或接通模型**（二选一）: A6.3 四条无消费历史序列——预测层要么接上
   prediction-models 的对应输入（激活 #3/#4/#7 目标），要么删采样省 CPU。
   当前状态是最差的：花 CPU 产出没人读的数据。
3. **下线或接线 dashboard/accounting**: logisticsDashboard/logisticsAccounting/logisticsScaling
   与三个死 getter —— 若无运营查看计划，删掉省每 100t 的构建成本；
   若保留，接入 decision-trace 已有的 metrics 快照即可（logisticsCapacity/logisticsIdleHaulers 已在消费同一处模式）。
4. **登记弱消费补全**: resourceBottlenecks/empireResourceLedger/agendaMetrics/
   lastDriftDiag 应显式选择归宿（console 观测 = 注释标明用法；否则删除）。

> Phase 14 将继续验证 40+ 注册系统中是否存在 cadence 永不满足导致的实际永不运行项。

---

*审计继续*
