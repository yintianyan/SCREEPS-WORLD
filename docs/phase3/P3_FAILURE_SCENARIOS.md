# P3_FAILURE_SCENARIOS — 故障场景套件（P3）

> 任务书 §39 十二场景映射到现有/新增测试。编号沿用现有体系
> （rcl1-suite T 系列 / integration scenarios / e2e 00–08 / S1–S11 注入矩阵）。

## 1. 映射表

| 任务书 | 场景 | 验证载体 | 状态 |
| --- | --- | --- | --- |
| P3-001 storage 建成（RCL4 结构接入经济） | tests/integration/scenarios/rcl4-automation.test.ts + e2e 03-storage-construction | ✅ 存量绿 |
| P3-002 storage 能量增长 | p3-baseline rcl4-storage 世界（储备 17k→31k 轨迹） | ✅ 本阶段新增 |
| P3-003 Storage→Spawn | distributor 泵链 + rcl4-automation hauler 物流链用例 | ✅ 存量绿 |
| P3-004 Storage→Upgrade | upgrade.sustainedStorage 功率水位 + rcl5-links 集成 | ✅ 存量绿 |
| P3-005 Storage→Construction | builder buildEnergySurplus 门禁 + rcl4 场景 | ✅ 存量绿 |
| P3-006 多请求并存 | request-pool 单测（多源生成/聚合）+ logistics 池集成 | ✅ 本阶段新增 |
| P3-007 资源不足 | supplyLedger 防超卖单测 + SP-1/recoveryEnergyReserve 用例族 | ✅ 扩充 |
| P3-008 Reservation 冲突 | supplyLedger remainingSlots=0 截断单测 + trySpawn energyBudget 并发扣减用例 | ✅ 扩充 |
| P3-009 Request 过期 | reconcileRegistry expired 回执单测 + RequestExpired 事件 | ✅ 本阶段新增 |
| P3-010 Creep 运输途中死亡 | creep-death/maintainMemory 族 + 租约失效自动重挂（validateAssignmentRules 单测） | ✅ 存量绿 |
| P3-011 Storage 被大量抽干 | drainRateLimit/upgrader 停取单测 + economy-dynamics 场景 | ✅ 存量绿 |
| P3-012 经济恢复 | live-anomaly 三场景（B4 不变量重写版）+ e2e 07-energy-crisis | ✅ 重写后绿 |

## 2. B4 重写记录

live-anomaly 三场景原断言依赖 mockup recycleCreep 缺口的隐性 abort 动力学（B4，
TECH_DEBT_LEDGER P3 批次）。已按不变量重写并全绿：

1. trap：hauler 头数代理 → harvested>2000 ∧ container 排空 ∧ 帝国存活。
2. phase 脉冲：端点 harvester 硬断言 → 末段采样恢复不变量（t>900 出现存活 harvester）。
3. harvester 振荡：端点计数 → 全窗口采样（峰值 ≤3 ∧ 归零占比 <20% ∧ harvest>5000）。

## 3. 注入矩阵对齐（S 系列）

S4/S5（低能量注入限定 tick 内恢复）＝e2e 07-energy-crisis 与 rcl1-suite 注入族；
P3 新增 AccountingDrift 事件为核算可信度防线（先修核算，禁带病发展——任务书 §16）。
