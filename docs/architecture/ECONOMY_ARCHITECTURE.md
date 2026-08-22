# ECONOMY_ARCHITECTURE · 经济架构（冻结蓝图）

> 本文件是**经济域契约**：能量与资源所有权、九概念定义、净流核算三指标、
> RCL8 后能量 sink 目标集与经济状态归属以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，不得静默修改。
> 依据：[ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md) §10.1（能量归属裁决）、
> [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1（Resource/Demand）、
> [GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3–§4（posture/五域预算）、
> [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.6（EconomyState）、
> research/10 §10.4–10.5、research/04 §8–§10、research/12 §10.4、research/15 §10.4、
> research/20 §10.4、research/30（红队 A10）。

## 1. 能量与资源所有权合同（调和 §10.1 合同化）

### 1.1 所有权与处分权表

| 资源 | 所有者 | 帝国的权力 | 房间的权力 | 禁止 |
| --- | --- | --- | --- | --- |
| 能量（本地储备+预算） | **Room** | **调拨权**（terminal 网络+战时征调），受 §1.2 门控 | 本地六闭环内按预算自由支配 | 帝国把全房能量当公共池抽调；房间越过预算消耗共享资源 |
| 矿物 / commodity | Room（属地库存） | 互补调拨令+市场策略 | 本地 lab/factory 加工 | 房间直连市场下单（MarketManager 唯一写者） |
| credits | **Empire** | 垄断 | 只读 | 房间级信用账户 |
| CPU / 预算 | Empire（Policy 求值） | 五域预算下发 | 按预算行事 | 任何消耗决策只过能量账不过 CPU 账（research/20 §10.4） |

合同条款：

1. 能量属 Room：本地储备（storage/link/terminal 水位）与本地预算的处分权在
   房间六闭环内；围城能量会计因此有明确账主（research/15 §10.4）。
2. Empire 持**调拨权而非所有权**：跨房实物调拨只能以调拨令形式下发，仅经
   terminal 网络或战时征调两条通道执行；全集中能量池违反故障域隔离
   （research/04 §6）。
3. 混态裁决（research/04 §5）：能量/运力等**高频流动资源走请求牵引**；
   矿物/boost 储备等**低频战略资源走配额**。

### 1.2 调拨门控（跨房能量流动的唯一授权路径）

| 条款 | 内容 |
| --- | --- |
| 必须全部满足才允许调拨 | ① 支援方**本土净流为正**（平滑值，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4 能量域）；② 受援缺口经帝国复核确认（防报告腐化，research/04 §8-5）；③ 援助预算上限 = f(支援方净流)——援助雪崩防线（research/04 §8-1）。 |
| 异常房例外策略 | alert/siege/evacuate 房**停止被均衡抽离、优先注入**（research/12 §10.4）；被援房进入独立降级，不拖垮支援房（research/04 §8-1）。 |
| 战时征调 | 仅 war posture 授权后生效；消耗在战争基金预算线内，不与经济发展竞争（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）。 |
| 禁止 | 房间绕过帝国直连 terminal 跨房调拨（影子通道，research/04 §8-4）；任何模块绕过 MarketManager 市场下单。 |

## 2. 九概念合同

### 2.1 概念总表

| # | 概念 | 合同（必须） | 禁止 |
| --- | --- | --- | --- |
| 1 | Income 收入 | source 产能 × 效率系数（efficiency factor）入账：自有房上界 2×3,000/300 = **20 能量/tick**，本地利用率初值 70%（≈14/tick）；remote 每房 40–50%（+4–8/tick）（research/10 §10.4）。效率系数是**自适应参数**：初值用社区数，按实测净流校准（research/10 §12）。 | 名义产能直接入账；跨 tick 沿用未刷新的产能估计。 |
| 2 | Production 生产 | lab/factory 链**按需生产**：加工任务由库存缺口与帝国 mineral 需求触发；「把加工搬到能量处」——加工放能量富余房，只在成品层长距移动（research/12 §10.4）。 | 为库存数字而满负荷生产；在能量贫房加工矿物。 |
| 3 | Consumption 消费 | 五类消费者（孵化/建造/升级/塔/维修）按 §2.2 优先序分配；升级吃**净流盈余**（early-economy ≤30% 产能），不是默认消费者（research/10 §10.4）。 | 消费者越过优先序直取储备；升级预算侵占孵化预算。 |
| 4 | Storage 储备 | 三容器分层：storage 主账本、link 通道、terminal 出入口；每层维持水位阈值区间，阈值目的是防「彻底清空」与「长期满载」（research/12 §4）。 | 把容器当无界缓冲（link 满载即断链信号，非正常态）；水位线写死不随 phase 调整。 |
| 5 | Transfer 调拨/市场 | 跨房实物调拨＝帝国调拨令（§1.2）；远距缺口走市场买卖而非搬运（运费指数远距近全损，research/12 §10.4）；市场下单＝MarketManager 唯一写者，决策输入来自 Economy/Empire（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.6）。 | Economy 系统自行调拨（调拨权在 Empire，[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.5）；远距实物搬运。 |
| 6 | Budget 预算 | 五域（CPU/能量/人口/物流/军事）预算的能量域下钻，公式见 §2.3；输入复用遥测已采集量（research/20 §10.4）。 | 单 tick 原始值直接驱动预算切换（必须 EMA 平滑，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4）。 |
| 7 | Reservation 预留 | 三类显式预留，均从预算中扣除而非口头声称：① spawn 排产预留（`spawning`+已提交订单的能量占用，research/11 §6）；② tower 围城储备（siege 态能量会计的库存项，research/15 §10.4）；③ 战争基金（war posture 划出的预算线，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §3）。 | 隐式预留；战争基金无止损上限（基金耗尽→强制退 fortify）。 |
| 8 | Demand 需求 | 经济域 Demand 产生者仅四类：①房间 census 人口缺口；②建造申请（`needContainer` 类标记）；③物流供需池水位缺口；④ AgendaItem 生命周期内维持的 Demand 流（research/11 §10.1、[EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1）。Demand 瞬时不持久化。 | 消费者绕过 Demand 直取资源；Demand 写入 Memory（唯一例外：立项转译字段，调和 §2）。 |
| 9 | Resource Allocation 分配 | 能量消费分配序 = P0>P1>P2>P3 映射（§2.2）；降级立即生效、恢复滞回（与看门狗同构，[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §3.2）。 | 先来先得；低优先级以「已开工」为由绑架储备。 |

### 2.2 消费优先序（P 级 × 姿态双档）

| P 级 | 常态消费者 | siege 态配给序（research/15 §10.2） |
| --- | --- | --- |
| P0 生存 | 灾后孵化（≥200 直通）、塔防应答、矿工链 | tower > spawn > repair > upgrade≈0 |
| P1 稳定 | 常态孵化、矿工/hauler 链维持、维修 | 同左，总量配给 |
| P2 发展 | 建造、升级（净流盈余的函数） | 冻结 |
| P3 增长 | 商品/boost 库存生产 | 暂停 |

两档并存是状态机语义非冲突：常态以孵化优先（extensions 永远最先建，孵化
预算=人口质量天花板，research/10 §10.3）；围城态由能量会计接管（research/15 §10.4）。

### 2.3 能量预算公式（Budget 下钻）

```text
E_income  = Σ(source 产能 × 效率系数)                     # Income，§2.1
E_surplus = EMA(E_income − E_consumed(P0+P1), D)           # 净流盈余，平滑窗口 D
开放条件： E_surplus > open_e  ∧  (E_surplus − 新承诺人均负载) > floor_e   # 解冻 P2/P3 承诺
关闭条件： E_surplus < close_e 连续 N tick                  # 冻结 P2/P3 承诺
人均门控必须与最差房门控双条件并用（防单房热点被均值掩盖）
```

- 参数 (D, open_e, close_e, N, floor_e) 全部进 tuning 覆盖层，soak 回填
  （[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4）。
- **本土净流为正是一切对外援助/扩张/调拨的前置**（房间保底线，
  [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §2 Q1）。
- 能量预算与 CPU 预算（B=U−F−C，research/20 §10.4）同时过账：任何消耗决策
  必须同时过两本账。

## 3. 净流核算合同（三指标）

| 指标 | 定义 | 用途 | 刷新频率 |
| --- | --- | --- | --- |
| 净流 net flow | (Income − Consumption) 的 EMA 平滑值，房级口径 | 能量域门控输入、phase 出入口判定（storage 净流 ≥0，research/10 §10.1）、§1.2 调拨门控 | 每 N tick（10–100，错峰散列） |
| 储备 reserve | storage+link+terminal 折算能量水位（阈值区间制） | Reservation 扣除基数、围城能量会计 T 公式的库存项（research/15 §10.4） | 同上 |
| 风险缓冲 risk buffer | 当前储备 ÷（P0+P1 消费速率）= 断供耐受 tick 数 | 降级预警、援助上限、evacuate 判据输入 | 同上 |

| 条款 | 内容 |
| --- | --- |
| Owner | Economy 系统（`computeEconomy(roomStates)` 纯函数，[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.5）；heap 派生为主 + Memory 瘦快照（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.6）。 |
| G 门控接口 | 三指标（连同扩张门控三平滑值 cpuIdle/heapFree/memoryFree）是帝国扩张立项 G1–G5 门控的输入；**本土净流为正是 G 门控必要条件**（[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1）。Economy 只产出判定输入，**不做立项**（立项权在 Empire）。 |
| 禁止 | Economy 每 tick 全量重算（须分频+增量）；把未平滑单 tick 值上报门控。 |

## 4. RCL8 后能量 sink 目标集合同（防停滞误诊，红队 A10）

RCL8+GCL 满+市场饱和下的「指标停滞」是**合法稳态，不是故障**。防误诊双条款：

1. 自愈 Verification 必须对照**预期状态**——「后期稳态」命中预期即通过，
   禁止据此触发恢复动作（research/30 A10）。
2. 帝国必须为 peak 房指定**显式 sink 目标集**，让能量「有事可做」而非靠
   停滞检测驱动（research/30 A10）：

| sink | 合同 | 依据 |
| --- | --- | --- |
| GCL farm | 保持高 upgradeRate 刷 GCL（GCL≈1e6×L^2.4）为扩张解锁房位；帝国 AgendaItem 指定 peak 房承担；upgrader 默认不 boost（work 类收益低） | research/10 §10.5、§12 |
| temple / power spawn 处理链 | power spawn：1 power + 50 energy → 50 能量净产出+power creep 运营增益；仅 peak 房设 temple（power 处理特化房） | research/10 §10.5 |
| 商品 / boost 库存 | factory 商品与 T3 boost 维持库存（备战 SLA），按需生产 | research/10 §10.5 |
| 军事储备与重建基金 | war posture 与战后恢复的能量池（Reservation 战争基金实例） | research/10 §10.5 |

sink 目标集由 Empire 以 AgendaItem 形式指定并复核；本地**不得**自行把全部
盈余喂单一 sink（线性升级执念防线，research/10 §8/§11）。

## 5. 经济状态与 STATE_OWNERSHIP 一致性声明

1. EconomyState（净流/储备水位/预算配额）Owner=Economy 系统；扩张门控三指标
   平滑值（cpuIdle/heapFree/memoryFree）由 Economy 观测寄生维护；
   Persistence=heap 派生为主+Memory 瘦快照；Frequency=每 N tick（10–100，
   错峰散列）——与 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md)
   §3.6 逐字一致。
2. 本文件与 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.5（Economy 八项）、
   [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1（能量使用权/
   跨房调拨两行）、[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4
   （能量域门控公式）同一时刻必须一致；任何一处修订必须同步其余各处并走 ADR。

## 6. 评审红线（负结果引用）

| # | 红线 | 否决依据 |
| --- | --- | --- |
| 1 | 全帝国能量公共池（Empire 持所有权而非调拨权） | 违反故障域隔离（research/04 §6）；围城会计需要本地账主（research/15 §10.4） |
| 2 | 消耗决策只过能量账不过 CPU 账 | 双账强制（research/20 §10.4） |
| 3 | 把「RCL8 满配+GCL 满」诊断为故障并触发恢复 | 红队 A10：合理停滞误诊自造振荡 |
| 4 | Economy 直接执行调拨或市场下单 | 调拨权在 Empire、市场在 MarketManager（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.5/§1.6） |
| 5 | 名义产能（source 总量）直接入 Income | 效率系数必须生效且自适应校准（research/10 §10.4、§12） |
| 6 | 均衡/调拨抽离 alert/evacuate 异常房 | research/12 §10.4 例外策略 |
