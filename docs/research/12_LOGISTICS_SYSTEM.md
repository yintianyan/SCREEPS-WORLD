# 12 · 物流系统（Logistics System）

> 研究文档 · 结论等级：**设计裁决**（bot 收敛 + 官方公式核算 + 引擎源码复核）。
> 机制事实以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
> §5/§7 为基准；总裁决见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> ADR-006。核查日：2026-08-22（含一次对 03 号文档 link 冷却说法的修正，见
> §10.2 与最终报告）。

## 1. Problem

hauling（搬运）同时受来源、目标、容量、路径、拥堵、优先级、资源类型与
时间影响——Overmind 作者专门撰文论证其复杂度属 NP-hard 一类，最优解不可
求解。同时物流是 CPU 第一大头（移动是最大开销项，社区共识）。本文裁决：
近距离（link）与远距离（terminal/市场）物流的自动化设计、请求池与租约
机制、近似策略与观测指标、断链兜底。

## 2. Research Questions

1. link 网络的真实机制约束（容量/损耗/冷却）与最优拓扑？
2. terminal 帝国均衡的阈值与运费如何核算？
3. 「顺路投递」类近似策略的适用条件与代价？
4. 物流系统的健康度指标与断链 fallback 如何设计？

## 3. Existing Solutions（方法论参照）

ADR-006 已裁决总纲：供需两侧生成请求（haul/work/terminal request），执行
者按评分领取并持租约（lease，超时自动回收）；接受可解释的近似解；观测
空载率/延迟/断链数持续调参；link 自动化与 terminal 均衡作为低频系统独立
运行。empire-architecture 补充：运输者可以选择任务，但不能各自建立互相
冲突的全局目标；terminal 网络要支持 alert/evacuate 等例外状态，危险房间
不能被和平均衡器抽空。

## 4. Screeps Community Practice

- **link mining 标准模式**：source link → storage link →（可选）controller
  link。wiki.screepspl.us/StructureLink 给出三种管理实现：（a）link 优先级
  队列；（b)固定类型对类型路由；（c)目标水位平衡；并明确阈值设计的目的是
  防「彻底清空」与「长期满载」。—— 2026-08-22 复核 CONFIRMED。
- **布局服务物流**：每 source 一个 Franchise（spawn+link+container）+
  controller 处 HQ（jonwinsley，复核见 09 §4）：物流形态由布局决定。
- **市场铁律**：「把加工搬到能量处，而不是把能量搬到加工处」（wiki
  Intermediate-level_tips）；每房每资源阈值制 terminal 管理；getAllOrders
  昂贵、禁止每 tick 轮询（wiki Market FAQ——复核 CONFIRMED）。
- **市场细节**（wiki Market，2026-08-22 复核）：挂单费 5%（主动取消不退、
  到期退）；订单有效期 30 天；每 shard 300 单；每 tick 10 笔 deal；deal 后
  terminal 冷却 10 tick；多人抢同一订单距离近者优先；inactive ≠ 已完成
  （核对 remainingAmount）。

## 5. Existing Bot Analysis

| Bot | 物流组织 | 关键机制 |
| --- | --- | --- |
| The International | requests.ts：WorkRequest/HaulRequest/TerminalRequest | 请求制经济现役证据：creep 按请求分配，需求与执行分离 |
| TooAngel | 预计算固定路径 + 顺路投递 | carry 沿固定路径走，顺路喂塔/link/extension；布局锚链（upgrader→storage→filler）以路径为中心 |
| Overmind | hauler 网络 + 请求优先级 | 博客论证最优解不可行；实践即近似解 |
| KasamiBot | hauler 池化（RCL7 起）+ 房间间资源自动调拨 + labmanager 维持 T3 库存 + 市场先卖到目标信用额 | 后期物流=池化+库存管理+市场三件套 |
| hivemind | link-network、bay、trade-route | link 网与交易路由是独立低频模块 |
| Quorum | factotum（terminal 管家） | terminal 专人化=均衡逻辑与房间经济解耦 |
| bonzAI | TransportMission/RefillMission/TerminalNetworkMission | 物流全 Mission 化样例 |

收敛（≥5 家）：请求/任务制 + link 网自动化 + terminal 管家/均衡 + 市场
阈值卖买。

## 6. Advantages（推荐设计的优势）

1. **成本可预算**：每 tick O(请求+执行者) 的匹配成本，无全局求解；link
   替换 hauler 是最大单项 CPU 节约（静态矿工+link 后 source→storage 零
   移动 intent）。
2. **可解释可调参**：近似解的性能短板（空载、绕路）全部落在可观测指标
   上，调参有靶子。
3. **故障隔离**：租约超时自动回收，单个 hauler 死亡不产生悬挂状态。

## 7. Disadvantages（代价）

- 次优路径浪费运力：顺路投递/贪心匹配比全局最优多跑路——用「CPU 换
  最优性」，方向与社区经验一致（移动是第一 CPU 大头）。
- 三个子系统（请求池/link 网/terminal 网）各有状态与失效模式，观测面
  变大。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 空载漫游（无单可领往返跑） | 纯 CPU/能量浪费 | 空载率指标+池化收缩；无单时 park（09 号 RolePolicy park 钩子） |
| 低优先请求饥饿 | 非关键消费者长期断供 | 租约评分加 aging（饥饿老化） |
| 租约泄漏（持有者死亡未释放） | 虚假「有人在送」 | 租约 TTL + 持有者心跳核验 |
| link 链断（source link 满→矿工停产） | 产能损失 | 满度监控=断链信号；fallback 到 container 缓冲+hauler（§10.5） |
| terminal 被均衡器抽干危险房 | 战时断粮 | 均衡器必须感知房间 posture（alert/evacuate 停止抽离） |
| 市场误价（与自家订单对敲/低价甩卖） | 信用损失 | 挂单前 getHistory 核对；只处理已完成订单（remainingAmount） |
| getAllOrders 每 tick 轮询 | CPU 爆炸 | 低频缓存（wiki 明确警告，复核 CONFIRMED） |
| 运费误判（远距调拨把利润吃光） | 净值亏损 | 指数运费公式核算（§10.4） |

## 9. CPU Implications

- **link 是最大的结构性节约**：每次 800 能量传送替代 hauler 往返；代价
  是 3% 损耗与距离冷却（§10.2），高频短距传送（source→storage）最划算。
- **顺路投递减少重复寻路**：TooAngel 预计算路径复用=寻路成本摊销到 0
  （配合 spine 的两级寻路+限频，本系统尽量不新增寻路）。
- terminal/市场系统低频（分钟级 tick 采样 + 缓存订单），cpuIdle 预算内
  运行；请求池匹配每 tick 但规模小（单房活跃请求通常 <50）。
- 观测指标（空载率/请求年龄/断链数）随遥测低频聚合进 segment（ADR-010）。

## 10. Recommended Design

### 10.1 请求池 + 租约

- 生产侧（source container、link、storage 缺口）与消费侧（spawn/extension、
  tower、construction site、upgrader、lab/factory）生成请求：资源类型、
  数量、位置、优先级、TTL。
- hauler 按「距离 × 优先级 × 满载可行性」评分领取，持租约（带 TTL）；
  超时或持有者死亡自动回收重挂。评分加 aging 防低优先饥饿。
- 顺路投递作为匹配器的增强项：已持有路径上的次级需求可顺带满足（TooAngel
  先例），但**不改变主路径**——保持可预测性。

### 10.2 link 网络自动化（RCL5+）

**机制约束（引擎源码复核，2026-08-22，CONFIRMED）**：容量 800；接收侧
损耗 `ceil(amount × 0.03)`；发送侧冷却 `LINK_COOLDOWN(=1) × Chebyshev 距离`
（`Math.max(|dx|,|dy|)`）——即 30 格跨房传送要等 30 tick 冷却，**只有发送
link 进入冷却**。引擎证据：
`github.com/screeps/engine/blob/master/src/processor/intents/links/transfer.js`。
（修正：03 号文档 §10「link 冷却 1 tick」应读作「1 tick × 距离」，已列入
其 §13 勘误建议。）

设计推论：

- 拓扑：每 source 一 link（发送）、storage 一 link（接收+调度中枢）、
  controller 一 link（接收，供静态 upgrader）；remote 中继 link 可选。
- **距离敏感**：source↔storage 距离尽量短（布局期约束，进 13 号文档）；
  长距传送吞吐=800/距离 tick，规划产能时要按冷却折算。
- 管理实现选型：目标数少（≤3）用**固定路由 + 阈值**（wiki 方案 b+阈值：
  source link ≥ 发送阈值→storage link；storage link 低于水位→controller
  link 供弹）；不采用平衡法（本场景 link 角色固定，平衡反而引入抖动）。
- 调度者是 link-network 低频系统（hivemind 同构），角色层禁止直接调
  `transferEnergy`。

### 10.3 请求池之外的能量主干的相位

- infrastructure phase 前：hauler 全承担（container→spawn/tower/consumer）。
- RCL5 后：source→storage 主干切 link；hauler 转向「补弹（extension）、
  塔、工地、controller 区」的短距分发——数量随 phase 缩减（10 号文档
  §10.2 人口表）。

### 10.4 terminal 帝国均衡（阈值制 + 运费核算）

- 运费公式（03 §7）：`ceil(amount × (1 − e^(−distance/30)))`。核算样本
  （能量运能量，占比如下）：d=5→15.4%；d=10→28.3%；d=30→63.2%；d=60→
  86.5%；d=100→96.4%。**结论：近距调拨近乎免费、远距接近全损**——均衡
  系统只对邻近房做实物调拨，远距缺口走市场（买卖）而非搬运。
- 每房每资源维持阈值区间 [min, max]（KasamiBot/TooAngel 阈值制先例）：
  超上限→挂卖或调拨邻房；低于下限→请求。能量作为运费单独记账。
- 市场策略：先卖到目标信用额、再买缺矿（KasamiBot 顺序）；挂单费 5%
  与 30 天有效期纳入成本模型；**「加工搬到能量处」**：矿物的 lab/factory
  加工尽量放在能量富余房，只在成品层做长距移动。
- 均衡器感知 posture：alert/evacuate 房间停止抽离、优先注入（empire-
  architecture 例外状态要求）。
- 市场数据：getAllOrders 低频缓存（如每 100+ tick 或事件驱动）；只清理
  已完成订单。

### 10.5 观测与断链 fallback

- 一等指标：空载率（无单 tick 占比）、请求年龄分布（延迟）、断链数
  （source container/link 满度事件）、link 网利用率（传送量/冷却周期）。
- fallback 链：link 断→矿工改投 container（缓冲 2k 容量+5,000 tick 衰减
  提醒）+hauler 临时接管；hauler 池损失→请求池自动收缩范围（只保 P0/P1
  消费者）；terminal 不可用→房间本地阈值自治，均衡系统标记重试。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 全局最优求解（每 tick 全量重匹配/匈牙利算法） | NP-hard + CPU 不可预算（ADR-006；Overmind 论证） |
| hauler 完全自治选目标 | 互抢目标+重复扫描（社区记录反模式；请求池的意义所在） |
| 角色层直发 link 传输 | 多写者竞态（link 冷却只有一个发送窗口）；必须低频系统统一调度 |
| 平衡法 link 管理 | 本拓扑角色固定，平衡引入抖动；固定路由+阈值更可预测（§10.2） |
| 远距实物调拨替代市场 | 指数运费远距近全损（§10.4 核算） |
| 每 tick 轮询市场订单 | wiki 明确警告昂贵（复核 CONFIRMED） |

## 12. Open Questions

1. 顺路投递的匹配半径（离主路径几格内算顺路）取值待 soak；过大破坏
   可预测性。
2. controller link 供弹阈值与 upgradeRate 的联动参数（升级预算的另一面，
   10 号文档 §10.4）需联合校准。
3. 市场挂单的信用额目标值是帝国层参数还是逐资源参数？倾向逐资源
   （流动性差异大）。
4. link 冷却的 Chebyshev 口径在自建模拟器中已验证，待官方服务器行为
   复核（预期一致，LIKELY）。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://wiki.screepspl.us/StructureLink | 社区 wiki | 三种 link 管理实现；阈值防清空/满载；冷却∝距离 | CONFIRMED（2026-08-22 复核） |
| https://github.com/screeps/engine/blob/master/src/processor/intents/links/transfer.js + common/lib/constants.js | 引擎源码 | 冷却 = LINK_COOLDOWN(1)×Chebyshev 距离；接收侧扣 ceil(3%)；LINK_CAPACITY 800 | CONFIRMED |
| https://wiki.screepspl.us/Market | 社区 wiki | 5% 挂单费/30 天/300 单/10 deal/tick/terminal 10 tick 冷却/getAllOrders 昂贵/inactive≠完成 | CONFIRMED（2026-08-22 复核） |
| https://wiki.screepspl.us/Intermediate-level_tips | 社区 wiki | 「把加工搬到能量处」 | CONFIRMED |
| Bot 调研摘要 2026-08-22（TI requests/TooAngel 顺路/KasamiBot 阈值+信用额/hivemind link-network/Quorum factotum/bonzAI Missions） | 源码 | 请求制+link 自动化+terminal 管家收敛 | CONFIRMED |
| 03_SCREEPS_GAME_CONSTRAINTS.md §5/§7/§10 | 官方事实 | terminal 运费指数公式、冷却 10 tick、≥100/次、300k 容量；container 2k+衰减 | CONFIRMED |
| https://www.bencbartlett.com/blog/screeps-4-hauling-is-np-hard/ | 博客 | hauling 复杂度论证（最优解不可行） | CONFIRMED |
