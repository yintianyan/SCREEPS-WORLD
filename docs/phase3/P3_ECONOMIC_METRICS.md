# P3_ECONOMIC_METRICS — 经济指标目录（P3）

> 三指标定义＝ECONOMY §3（冻结）；本文只登记可计算化结果与问答映射（任务书 §37/§48）。

## 1. 指标目录

| 指标 | 来源 | 消费 |
| --- | --- | --- |
| 净流 net flow EMA | L1 收支差 → 50t 窗 EMA(α=.3) | 门控输入/调参/报告 |
| 储备 contractReserve | storage+terminal+link 水位 | Reservation 基数/收缩判据 |
| 风险缓冲 riskBuffer | reserve ÷ P0P1 速率 | spawn 风险预留/池收缩/援助上限输入 |
| 收支分解 | harvested/pickedUp/spawned/upgraded/built/repaired/towerSpent/refund | 对账恒等式与报表 |
| 效率系数 + estimatedIncome | 实测收入 EMA 校准 | G 门控入账（禁名义直入） |
| drift | Δtracked − flowBalance − Δother | 核算可信度（连续超限→AccountingDrift 事件） |
| 物流三项 | 空载计数/延迟环/断链钩子 | 池收缩与远矿预算关闭（后续域） |

## 2. 十二问应答映射（任务书 §48）

Q1/Q2 收支速率→L1 分解窗报；Q3 趋势→nf 符号与斜率；Q4 可用量→cr−committed；
Q5 预留量→spawn 队列成本+活跃租约（queryEconomy+池注册表）；Q6 清单→transportPool 槽；
Q7 最重要→priority 序首元素；Q8 未满足原因→expired/vanished/防超卖截断三分类；
Q9 分配→优先级+距离+供给账（先保 P0）；Q10 死亡恢复→租约失效自动重挂+心跳回收；
Q11 storage 抽干→drainRateLimit/upgrader 停取+distributor 兜底（既有）；
Q12 产能过剩→upgrade sprint/storageNearFull 加速消化（既有）。
数据面：queryEconomy() 公开查询口 + Memory.rooms[r].economy 瘦快照 + economy ring segment。