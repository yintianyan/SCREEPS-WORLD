# RESOURCE_RESERVATION_MODEL — 资源预留模型（P3）

> 合同锚点：ECONOMY §2.1-7（三类显式预留）、§2.3；FREEZE R1（预留类写入必须在⑥分配相位
> 同相完成）；任务书 §27–28（Reservation 与 Phantom 防线）。

## 1. 三类预留的实现状态

| # | 预留 | 实现 | 触发 | 释放 |
| --- | --- | --- | --- | --- |
| ① spawn 排产预留 | trySpawn energyBudget 扣减（SP-1 扩展） | SP-1 collectorCount≤1（原有）；+风险缓冲<400tick（新增）；+采集者进入替换窗口 TTL<600（新增前馈） | 孵化成交即自然结算；回收通道冲销（recycledRefund 计账） |
| ② tower 围城储备 | defense-domain siegeMemory 已有挂点 | P3 只读不动（围城会计归防御域 Phase 8 深化） | — |
| ③ 战争基金 | war posture 预算线 | 不在单房 P3 范围（P9） | — |

## 1.5 请求池租约预留（LOGISTICS §2.1-3）

supplyLedger：available(supply) − Σ活跃租约 → 剩余并发槽位为 0 的源不再生成请求
（防超卖）。释放路径：持有者死亡（summary 消失）/租约失效（validateAssignmentRules）/投递完成。
TTL 到期未认领 → 过期出池 + 回执——**Phantom Reservation 防线**：无 TTL 无心跳即泄漏死锁
（红线 4），本模型三重保险=TTL + 心跳（存活投影）+ 失效校验。

## 2. 半 tick 一致性（R1）

预留类写入发生在⑥分配相位的同一 tick 内（trySpawn 能量预算逐次扣减 / transportPool
tick 键槽位），无跨相位推迟写回——符合 FREEZE R1。