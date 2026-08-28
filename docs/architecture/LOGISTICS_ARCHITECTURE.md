# LOGISTICS_ARCHITECTURE · 物流架构（冻结蓝图）

> 本文件是**物流域契约**：请求池裁决、九概念、断链 fallback 链、三指标与自愈
> 接口、请求 aging 与交通边界以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15 修订记录，不得静默修改。
> 依据：research/12（核心）、research/20 §10.2（两级寻路）、research/10 §10.2–10.3
> （phase 人口形态）、research/22（自愈闭环）、research/30（红队 A8）；架构侧
> [ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md) §7、
> [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.2/§1.6、
> [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.6/§3.9、
> [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1（Demand/Task）。

## 1. 裁决合同：Logistics ＝ 请求池系统

| 条款 | 内容 |
| --- | --- |
| 裁决 | Logistics 是**请求池系统（request pool system）**：供给侧登记＋需求侧请求＋租约匹配的**可解释近似解**（research/12 §10.1；ADR-006）。 |
| 是什么 | ① 供需池维护与租约分配的唯一 Owner；② link 网调度中枢（低频系统）；③ terminal 房内阈值均衡与动作执行载体。 |
| 不是什么 | **不是 Task 系统的从属**：搬运请求是 Demand 的一等来源，被认领后才成 Task（[EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1）；**不是独立供应链求解器**：hauling 属 NP-hard 一类，最优解不可求解（research/12 §1），每 tick 全量重匹配/匈牙利算法已否决（research/12 §11）。 |
| 近似解义务 | 性能短板（空载/绕路/延迟）必须全部落在可观测指标上（§4），调参有靶子；用 CPU 换最优性——方向与「移动是第一 CPU 大头」一致（research/12 §6/§9）。 |
| 档位 | 请求池与基础搬运 P0（生存链）；link P1；terminal 均衡 P2（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.6）。 |

## 2. 九概念合同

### 2.1 概念总表

| # | 概念 | 合同（必须） | 禁止 |
| --- | --- | --- | --- |
| 1 | Supply 供给 | 供给侧登记五源：source container（source buffer，2k 容量/5,000 tick 衰减）、storage、link、terminal、房内散落 container。供给登记＝「此处有多少可取」，由 Logistics 从水位快照派生。 | hauler 自行扫描找货源（research/12 §11 反模式）。 |
| 2 | Demand 搬运请求 | 需求侧请求五字段：资源类型/数量/位置/优先级/TTL（research/12 §10.1）。产生者＝消费者系统（spawn/extension 补弹、tower、工地、upgrader、lab/factory）。 | Demand 持久化入 Memory；角色层直接向 hauler 下命令。 |
| 3 | Reservation 预留 | 租约（lease）即容量预留：认领时锁定「请求×数量×执行者」，带 TTL+持有者心跳；同一请求并发上限＝1（超时回收后重挂）；源侧可取量按已发租约扣除，防超卖。 | 无限并发认领；无 TTL 租约（泄漏防线，research/12 §8）。 |
| 4 | Transport 搬运执行 | 认领即 Task：六态 offered→claimed→succeeded/failed/expired/cancelled（[EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md) §1）；超时或持有者死亡自动回收重挂。 | 第二套任务生命周期语义。 |
| 5 | Route 路由 | 房内＝路径缓存（heap build/refresh 双路径，结构版本变化立即失效）；跨房＝`Game.map.findRoute` 房间级路由缓存＋房内 PathFinder 两级（research/20 §10.2）；本地搜索强制 `maxRooms: 1`。顺路投递（piggyback delivery）＝已持有路径上的次级需求顺带满足，**不改变主路径**（TooAngel 先例，research/12 §10.1；匹配半径待 soak，research/12 §12）。 | 为顺路绕路；每 tick 全新寻路。 |
| 6 | Hauler 搬运工 | 能力口径＝**部件数**（CARRY×50 承载），census 双口径清点（research/11 §10.2）；无单可领必须 park（RolePolicy park 钩子），禁止空载漫游（research/12 §8）。 | 用 creep 数衡量运力。 |
| 7 | Link 网络 | 见 §2.2 机制合同。 | 角色层直接调 `transferEnergy`（research/12 §10.2）。 |
| 8 | Terminal | 见 §2.3 阈值与运费合同。 | 远距实物调拨替代市场。 |
| 9 | Storage 储备 | 水位阈值的主权在经济域（[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §3）；Logistics 只消费水位阈值做均衡动作。异常房例外策略：alert/evacuate 房停止抽离、优先注入（research/12 §10.4）。 | 均衡器抽干危险房（research/12 §8）。 |

### 2.2 Link 网络机制合同（RCL5+）

| 条款 | 内容 |
| --- | --- |
| 机制常量 | 容量 800/次；接收侧损耗 `ceil(amount×0.03)`；发送冷却＝LINK_COOLDOWN(1)×Chebyshev 距离，**仅发送 link 进入冷却**（引擎源码复核，research/12 §10.2）。 |
| 拓扑 | 每 source 一 link（发送）→ storage link（接收＋调度中枢）→ 可选 controller link（接收，供静态 upgrader）；remote 中继 link 可选。 |
| 运力核算 | 长距吞吐＝800/距离 tick——产能规划必须按冷却折算；source↔storage 距离尽量短是布局期约束（research/12 §10.2）。 |
| 管理实现 | 目标数 ≤3 用**固定路由＋水位阈值**：source link ≥发送阈值→storage link；storage link 低于水位→controller link 供弹。**平衡法否决**（link 角色固定的场景下平衡引入抖动，research/12 §11）。 |
| 调度权 | link-network 为低频系统（hivemind 同构）；P1 档，每 tick 检查、冷却内跳过（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.6）。 |

### 2.3 Terminal 阈值制与运费合同

| 条款 | 内容 |
| --- | --- |
| 阈值制 | 每房每资源维持 [min, max] 区间：超上限→挂卖或调拨邻房；低于下限→请求（research/12 §10.4）。能量作为运费单独记账。 |
| 运费公式 | `ceil(amount×(1−e^(−distance/30)))`；样本：d=5→15.4%、d=10→28.3%、d=30→63.2%、d=60→86.5%、d=100→96.4%。**结论：近距调拨近乎免费、远距接近全损——远距缺口走市场买卖，不走搬运**（research/12 §10.4）。 |
| 写权边界 | terminal 跨房 send 的决策权＝Empire（调拨令，[ECONOMY_ARCHITECTURE.md](ECONOMY_ARCHITECTURE.md) §1.2）；市场 deal＝TerminalManager 唯一写者（幂等键，生产入口 `src/systems/terminal-manager.ts`）；Logistics 是动作执行载体（Writer）与房内阈值均衡 Owner（Owner/Writer 分离，[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §1）。 |
| 市场数据 | getAllOrders 低频缓存（100+ tick 或事件驱动）；只处理已完成订单（核对 remainingAmount）（research/12 §10.4）。 |
| 档位 | P2、每 N tick（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.6）。 |

## 3. 断链 fallback 链合同

四级链，**只降不跳**：每级触发有独立判据，恢复必须滞回（防抖动）：

| 级 | 触发 | 动作 | 恢复条件 |
| --- | --- | --- | --- |
| L1 | link 断（source link 满度事件＝断链信号） | 矿工改投 container 缓冲＋hauler 临时接管 source→storage（research/12 §10.5） | link 恢复运转且水位回充，滞回切回 |
| L2 | hauler 池损失（空载率/请求年龄恶化） | 请求池自动收缩：只保 P0/P1 消费者（补弹/塔/关键链）（research/12 §10.5） | 运力恢复＋积压消化 |
| L3 | 本地直供降级（storage/link 双失效） | 消费者改由 container/落地能量直供，跳过 storage 中枢 | 结构修复＋水位验证 |
| L4 | L1–L3 全不可维持 | 房间 phase 降级评估：回退到 infrastructure 前形态（矿工兼搬运/hauler 全承担，research/10 §10.2–10.3 人口基线），phase 切换带滞回 | 走恢复 phase 重判（research/10 §10.6），不进发展序列 |

terminal 不可用：房间本地阈值自治，均衡系统标记重试（research/12 §10.5）。

> 调和说明：research/12 §10.5 的 fallback 止于三段（link→container/hauler、
> 请求池收缩、terminal 本地自治）；L4 是本合同把研究层隐含的最终回退**显式化**
> 锚到 phase 模型（research/10 §10.2）——两文档不冲突，本文为合同态。

## 4. 三指标与自愈接口

| 指标 | 定义 | 阈值语义 |
| --- | --- | --- |
| 空载率 idle ratio | hauler 无单 tick 占比 | 超阈→池化收缩＋park 纪律核查 |
| 延迟 latency | 请求年龄分布（挂池→完成的 tick 数，分位数口径） | 高优请求年龄超阈＝饥饿信号 |
| 断链数 broken links | source container/link 满度事件计数 | 持续超阈→fallback 链步进＋远矿车道收缩评估 |

| 条款 | 内容 |
| --- | --- |
| 遥测 | 三指标随遥测低频聚合进 segment（research/12 §9）；「断链数/空载率超阈→收缩远矿车道承诺」是物流域预算关闭条件的实例化（[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §4）。 |
| 自愈接口 | 三指标进 Monitor→Anomaly→Diagnosis（research/22 §10 闭环）；物流域恢复动作限于有界清单：重新挂池/租约回收/fallback 步进/池化收缩。**禁止**自愈直接改请求池结构或绕过 Owner 复活租约（research/22 不可越权清单）。 |
| 防误诊 | Verification 必须对照预期状态——空载率短峰（如孵化潮）≠故障；与 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §5 饥饿老化同族约束。 |

## 5. 请求 aging 与饥饿老化

| 条款 | 内容 |
| --- | --- |
| 认领评分 | score ＝ f(距离 × 优先级 × 满载可行性) ＋ aging（research/12 §10.1）；aging 随挂池 tick 增长。 |
| 饥饿老化 | 低优先级请求因高优先级持续占用而长期不被认领→年龄超阈**强制提级**（防「非关键消费者长期断供」，research/12 §8）；仅 P2/P3 请求适用，Recovery 档不生效（与 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §5 同构）。 |
| 过期 | TTL 到期→expired 出池＋回执请求方（**不静默丢单**，[GOAL_POLICY_PLAN_MODEL.md](GOAL_POLICY_PLAN_MODEL.md) §2 环节 7）。 |

## 6. 与 TrafficResolver 的边界

| 事项 | 物流侧 | 交通侧 |
| --- | --- | --- |
| 移动 | hauler 只登记移动意图（`registerIntent()`） | tick 末按房仲裁统一签发 move（TrafficResolver 唯一签发者，[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.9） |
| 非移动动作 | 装卸/transfer 由角色相位直发 | 不归交通仲裁（仲裁只覆盖移动） |
| 寻路 | 消费三档限频＋两级路由（§2.1 Route） | 仲裁只签发不求解 |

物流**禁止**自带移动签发；交通仲裁**禁止**理解物流语义（哪条请求更急）——
优先级在评分认领时已消解，仲裁只见意图（[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.2）。

## 7. 评审红线（负结果引用）

| # | 红线 | 否决依据 |
| --- | --- | --- |
| 1 | 每 tick 全量重匹配/全局最优求解（匈牙利算法等） | NP-hard＋CPU 不可预算（research/12 §11） |
| 2 | hauler 完全自治选目标 | 互抢目标＋重复扫描（research/12 §11） |
| 3 | 角色层直发 link `transferEnergy` / terminal 跨房 send | 多写者竞态（research/12 §11；本文件 §2.2/§2.3 写权边界） |
| 4 | 无 TTL/无心跳租约 | 租约泄漏死锁（research/12 §8） |
| 5 | 顺路投递改变主路径 | 破坏可预测性（research/12 §10.1） |
| 6 | 均衡器抽离 alert/evacuate 房 | 战时断粮（research/12 §8） |
| 7 | 远距实物调拨替代市场 | 指数运费远距近全损（research/12 §10.4） |
| 8 | 物流系统签发 move | 移动签发唯一归 TrafficResolver（[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3.9） |
