# 04 · 帝国架构：帝国层作为根控制器

> 研究文档 · 结论等级：**设计裁决**（[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> ADR-001 的深度论证）。机制事实见
> [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)；调度载体见
> [19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md)；总纲见
> [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md)。

## 1. Problem

当帝国从 1 房长到 GCL 允许的数十房，出现一类单房时代不存在的问题：跨房能量调拨谁批？
两个房同时申请殖民同一候选房听谁的？战争资源从哪些房抽？远矿车道的 host 房失守谁
接管？市场订单谁挂？**这些问题的答案决定「帝国层」（Empire）是否存在、以何种强度
存在。** 弱了→房间各自为政、共享资源死锁、扩张无授权链；强了→单点决策错误放大到
全帝国、CPU 与信息带宽爆炸、本地闭环被远端决策延迟拖垮。

本文裁决：帝国层的职责清单与非职责、empire↔room 接口契约、帝国级失败模式与防线、
GCL 规模演进压力曲线。

## 2. Research Questions

- 帝国层的最小职责集是什么？哪些事务必须上移，哪些必须留在房间？
- empire 与 room 之间的接口契约：报告什么、请求什么、下发什么？
- 帝国级失败模式（单房故障拖垮帝国、资源分配死锁、影子通道）如何防？
- GCL 从 1 到 10+ 的规模演进对帝国层形态的压力曲线是什么？

## 3. Existing Solutions（问题域的一般解法）

- **分层递阶控制**（hierarchical control，控制论标准形态）：上层慢、全局、只发
  集合信号（预算/目标）；下层快、局部、持有详细状态。上层不直接操作执行器——
  跨层直连是架构违例。
- **机器人三层层架构**（3T：deliberative / sequencer / reactive）：「做什么」（慢）
  与「怎么做」（快）分离，中间用技能层缓冲。对应本架构的战略层 / 议程层 / 确定性
  系统与执行层。
- **RTS AI 多基地管理**：成熟做法是「基地自治生产 + 全局资源池仲裁 + 战略层定攻防
  节奏」；把每个基地当协商 Agent 的做法在商业 RTS AI 中无先例（见
  [05_AGENT_ARCHITECTURE.md](05_AGENT_ARCHITECTURE.md) §11）。
- **供应链类比**：配送中心（empire）不管店内货架（room），只管仓间调拨与开店/
  关店决策（Agenda）；门店向上报告销量与缺货（Demand）。
- skill 参考（screeps-grandmaster-perspective/references/empire-architecture.md）：
  empire 负责跨房资源平衡、remote/扩张候选、市场策略、军事资源分配与全局优先级；
  **不逐 creep 指挥，下发的是有预算和期限的 mission**；colony 不能绕过帝国预算
  消耗共享资源。

## 4. Screeps Community Practice

六大 bot 的帝国形态是一条「强度光谱」（源码级核查，2026-08-22）：

| Bot | 帝国载体 | 强度 | 关键证据 |
| --- | --- | --- | --- |
| The International | `CollectiveManager` 等静态类 + `Memory.workRequests/combatRequests/haulRequests`（按房间名键控） | **强中心（请求经纪）** | 本次核查 `src/international/requests.ts`：请求带 `responder`（认领房）与 `abandon`（放弃冷却计数），100–200 tick 随机间隔复核，按 score 排序分配 |
| Quorum | city / empire / meta 三层进程 | 强中心（进程式） | 2021 停更；语义对、载体重（[19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md) §5） |
| Overmind | Overseer（巡查 Directive）+ Colony（owned 房 + outpost 打包） | 中（联邦式 Colony） | Colony 是「主城-卫星」单元，远矿归殖民地集群而非帝国直辖 |
| hivemind | room managers + empire 级 process | 中 | player-intel 在 empire 层持久化威胁记忆 |
| KasamiBot | AI 层 Manager + proximityscout | 中 | 侦察情报（每 2 万 tick 刷新）在全局层给房间估值 |
| TooAngel | `brain_*` 全局函数 + `Memory.myRooms` | **弱全局** | 帝国职责压缩为扩张决策（`brain_nextroom.js`）+ 外交 + squad 管理；跨房支援靠「缺 storage 则邻房派 carry」简单规则 |

**收敛点（≥6 家）**：无一例外存在「房间之上」的一层——哪怕只是共享函数 + 全局
Memory 索引；扩张、战争、跨房资源在所有调研对象中都被上移。

## 5. Existing Bot Analysis

- **TI 的请求经纪（本次源码核查，CONFIRMED）**：帝国不命令房间，而是维护请求池；
  commune（自有房）按 score 认领请求（写 `responder`），放弃进入 `abandon` 冷却。
  帝国 = 市场撮合者 + 评分者，不是指挥官。这是「请求牵引式经济」的最强现役证据。
- **Overmind 的 Colony**：把 owned 房与其 outpost 打包为一个单元——介于两级模型与
  全自治之间的第三种切分（按地理/功能分组而非全局/本地分组）。启示：分组键可以是
  「主城-卫星」而非只有「帝国-房间」。
- **TooAngel 弱全局**：帝国层薄到只有扩张/外交/squad 三个决策点，却维持十年无人
  值守——证明帝国层的**最小职责集确实很小**；但其跨房协调靠硬编码简单规则，规模
  上限依赖房间自给能力（社区共识：其多房协调是最薄弱环节）。
- **Quorum**：把 empire 做成 OS 进程。分层的语义正确，进程的载体错误（ADR-002 裁决）。

**裁决性对比**：请求/牵引式（TI/bonzAI）vs 管理员配额式（KasamiBot/hivemind/
Quorum）是社区主要分歧点。TI 的请求制把「谁需要、多急、谁认领」全部显式化，
与本文的 Demand 模型（见 [08_DEMAND_TASK_DIRECTIVE_MODEL.md](08_DEMAND_TASK_DIRECTIVE_MODEL.md)）
同构；配额制实现更简单但信息单向、易过配。裁决：**能量/运力等高频流动资源走
请求牵引；矿物/boost 储备等低频战略资源走配额**（混态，见 §10.2）。

## 6. Advantages（两级 + 请求经纪）

1. **故障域隔离**：单房异常被房间层消化（[22_SELF_HEALING.md](22_SELF_HEALING.md)
   §10.2 故障域分级），帝国只接收摘要——单房故障不会通过共享代码路径传染全帝国。
2. **CPU 可扩展**：帝国层固定开销 O(1)，跨房仲裁 O(rooms) 且低频分频
   （TI 100–200 tick 先例），与 26 号 §7 的预算模型一致。
3. **可测试**：帝国决策是「态势快照 → posture/budget/配额」的纯函数，可脱离
   服务器单测（ADR-003）。
4. **信息带宽受控**：房→帝国只传 RoomState 摘要与 Demand 声明，不复制 Game 对象，
   Memory 体积上界 = O(rooms) 小节。

## 7. Disadvantages（诚实代价）

- 接口契约需要持续维护：什么属于帝国 vs 房间是永恒的边界争论（ADR-001 Trade-offs）。
- 房间报告质量决定帝国决策质量——报告腐化时帝国层失明（见 §8）。
- 帝国层 bug 全局放大：一个 posture 判定错误同时作用于所有房间。
- 弱帝国形态（TooAngel 式）在大规模下协调不足；强帝国形态开发成本高——光谱两端
  都有代价，本文裁决取「小而硬的帝国 + 请求经纪」。

## 8. Failure Modes（帝国级，重点）

| # | 失败模式 | 机理 | 后果 | 防线 |
| --- | --- | --- | --- | --- |
| 1 | **援助雪崩（单房拖垮帝国）** | 一房被围城→帝国抽邻居能量/人口支援→邻居也贫血→连锁 | 多房连环崩 | 援助预算上限 = f(支援方本土净流)；「本土净流为正」门控（ADR-008）；被援房进入独立降级而非帝国降级 |
| 2 | **资源分配死锁** | A 等 B 的能量、B 等 A 的矿物（循环等待）；或多房同时申请扩张互等能量 | 全局停滞，无超时则永久 | 帝国仲裁按全局优先级序而非先到先得；调拨带期限；死锁检测=高优 Demand 长期未满足报警（喂自愈元层） |
| 3 | **帝国层单点** | 战略层/仲裁器 bug → 全帝国同错决策 | 系统性错误 | 战略层纯函数可单测；posture 切换写遥测；Recovery 档跳过非生存逻辑限制错误作用面 |
| 4 | **影子通道** | 房间绕过仲裁直连 terminal 调拨 / 私自市场交易 | 配额失效、死锁复发 | terminal 与市场订单写者唯一（26 号 §6 唯一写者表）；房间无 terminal 直写权 |
| 5 | **报告腐化** | 房间谎报/漏报需求与产能（bug 或状态过期） | 帝国决策失真 | 帝国侧低频抽查对账（RoomState vs 实测）；Demand 满足率/账实差是遥测一等指标 |
| 6 | **规模爆炸** | 房间数 × 每房请求量 → 帝国层 CPU 超支 | bucket 下滑 | 请求分频（100–200 tick）；请求按房分组批量复核；超过 GCL 10 后加深分频（§10.3） |
| 7 | **帝国信息过时** | posture 基于过期 intel / 过期摘要 | 错误战略 | intel 带 TTL/置信度（26 号 §5）；态势快照每 tick 重派生、摘要每 N tick 刷新并标采样时间 |
| 8 | **殖民地孤儿** | 扩张后母房失守/通道被断，殖民地无自持能力 | 新房烂尾 | 殖民自举车道：殖民 creep 落地后自续命（ADR-008）；Agenda 带「失败→降级为 remote 或放弃」路径 |

## 9. CPU Implications

- 帝国层每 tick 固定项：态势快照聚合 + posture 查询 = O(1)，目标 <0.5 CPU/tick
  （26 号 §7 固定开销项）。
- 低频项：扩张评估（N=100+）、请求复核（N=100–200，TI 先例）、市场（N=10–100）、
  terminal 均衡（N=10–50）——全部走 [19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md)
  §10.4 cadence 分频，不占每 tick 预算。
- Memory：每房固定小节（phase/净流摘要/健康度枚举）+ 活跃 Agenda 列表 + 请求池
  （运行时，不持久）——体积 O(rooms)+O(active agendas)，冷数据（intel/遥测）走
  segment（ADR-010）。
- 房→帝国报告是**派生摘要**，不序列化 Game 对象（03 号 §4 Memory 模型推论）。

## 10. Recommended Design

### 10.1 职责清单（全部，且仅此七项）

1. **房间注册表**：own / remote / colonizing / abandoned 状态机；GCL 槽位是硬预算
   （03 号 §9：GCL 永不丢失，claim 数受 GCL 限制）。
2. **跨房供需仲裁**：terminal 调拨（运费按指数公式核算）、矿物互补、市场订单——
   唯一写者。
3. **扩张与收缩决策**：投资式评分 + 资源门控（ADR-008），扩张/放弃都是 Agenda 项。
4. **军事资源统筹**：war 姿态授权（ADR-009）、squad 支援房指定、warBlacklist。
5. **全局优先级**：P0–P3 牺牲序的帝国侧执行（Recovery 档先砍远矿、再停军事集结）。
6. **posture × budget**：唯一受限 Agent 的宿主（ADR-003；判据见
   [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md) §10.1）。
7. **帝国级遥测与停滞检测**：22 号 §10.6 元机制（trapped 式「修复失败检测」）。

**非职责**（做了即架构违例）：本地经济微观（source 排班/本地建造顺序/本地物流
路由）；逐 creep 或逐任务指挥；高频感知（帝国只读摘要，不做全房扫描）；绕过房间
直接创建 site / 调 spawn（写者所有权不因「帝国」身份豁免）。

### 10.2 empire ↔ room 接口契约

| 方向 | 内容 | 频率 | 语义 |
| --- | --- | --- | --- |
| 房→帝国（报告） | RoomState 摘要（phase、能量净流、人口、建造进度、防御状态、健康度） | 每 N tick | 只读派生，带采样时间 |
| 房→帝国（需求） | Demand 声明（缺口类型/量/优先级/期限）——见 08 号 | 每 tick 派生、低频上卷 | 瞬时信号，不是命令 |
| 房→帝国（请求） | 跨房资源请求、扩张申请、军事支援请求、代孵请求（多 spawn 房分流） | 事件 + 低频 | 帝国有权拒绝并给出原因 |
| 帝国→房（下发） | posture + 各域 budget（每 tick 可查）；Agenda 项（带预算/期限/取消条件）；terminal 出库配额；Recovery 降级指令 | posture 滞回切换 / Agenda 低频 | **下发的是预算与承诺，不是动作序列** |

房间对下发的 Agenda 有**执行反馈权**（blocked / 进度 / 完成）无**否决权**——不可行
就上报，由帝国取消或修改。紧急模式可抢占（防御应答越过 P2/P3），但必须记录原因与
恢复条件（skill 参考；19 号 §10.5 紧急车道）。

### 10.3 GCL 规模演进压力曲线

| 阶段 | 房间数 | 帝国层形态 | 触发信号 |
| --- | --- | --- | --- |
| 起步 | 1–2 | 战略层 + spawn 仲裁即可，跨房通道空转存在 | — |
| 早期 | 3–5 | 房间注册表 + 远矿车道（Agenda）成型 | 第一条远矿车道开设 |
| 中期 | 6–10 | terminal 均衡 + 市场 + 请求经纪全开；GCL 槽位成为硬预算 | terminal（RCL6）落地 + 第二殖民 |
| 后期 | 11+ | 请求分频加深、按主城-卫星分组复核 | 帝国层固定开销逼近预算 |
| 极限 | ~30 | CPU 线性项主导（26 号 §7：房间 ≤1.5 CPU/房）；Overmind Colony 式分组键候选 | bucket 长期 Guarded 以下 |

架构演化由压力信号触发而非房间数崇拜（skill 参考 grandmaster-theory.md §9）：
分组调度仅在「帝国层分频后仍超预算」时引入。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 全自治房间（Model A） | 跨房资源无仲裁者→死锁；扩张/战争无授权链（ADR-001 Options A） |
| 全集中帝国逐 creep 指挥（Model B） | CPU 与信息带宽不可承受；本地闭环被远端延迟拖垮（ADR-001 Options B；详见 [05_AGENT_ARCHITECTURE.md](05_AGENT_ARCHITECTURE.md) §5） |
| 无帝国层（纯本地 + 市场隐性协调） | 市场信号不能作为军事授权；无 posture 则降级秩序不存在；TooAngel 至少保留了扩张/外交/squad 三个全局决策点 |
| Quorum 式 empire 进程 | 分层语义正确、进程载体过重（ADR-002；[19_SCHEDULER_KERNEL.md](19_SCHEDULER_KERNEL.md) §11） |
| 帝国层直管任务分配 | 越权：目标-执行者绑定仲裁属于系统层的分配服务（26 号 §6）；帝国只给预算与优先级 |
| 纯请求制 / 纯配额制 | 单一会话形态：高频资源请求制信息全但仲裁成本高；低频战略资源配额制简单但易过配——混态裁决见 §5 |

## 12. Open Questions

1. **多 shard 帝国**：InterShardMemory（每 shard 100KB）引入方式推迟到 A5 后
   （26 号 §10）；跨 shard 是否需要「帝国联邦」形态未决。
2. **分组键**：请求分组复核按地理 sector 还是功能主城-卫星（Overmind Colony 式）
   ——需要 GCL 10+ 实测数据。
3. **混态边界**：哪些资源最终落在请求制、哪些落在配额制，需 P6（跨房调拨）运行
   数据回填（27 号 Phase 6）。
4. 死锁检测的报警阈值：高优 Demand 未满足多久立案（与 22 号 §12.2 升级阈值 M
   联动）。

## 13. Evidence / Sources

| URL / 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source（`src/international/requests.ts`，2026-08-22 拉取核查） | 源码 | 请求经纪制：work/combat/haul 三池、responder 认领、abandon 冷却、100–200 tick 随机复核、按 score 分配 | CONFIRMED |
| https://raw.githubusercontent.com/TooAngel/screeps/master/src/brain_nextroom.js | 源码 | 弱帝国形态：扩张决策集中在全局 brain_nextroom，`haveEnoughSystemResources()` 三指标门控 | CONFIRMED |
| https://github.com/ScreepsQuorum/screeps-quorum | 源码 | 强帝国进程形态（city/empire/meta），2021 停更 | CONFIRMED |
| https://bencbartlett.com/blog/screeps-1-overlord-overload/ | 作者博客 | Colony = owned+outpost 组合单元；Overseer 巡查 Directive | CONFIRMED |
| https://github.com/Mirroar/hivemind · https://github.com/bonzaiferroni/bonzAI | 源码 | room managers+empire process / Operation 自治中间形态 | CONFIRMED |
| screeps-grandmaster-perspective/references/empire-architecture.md | 领域经验 | empire 职责表与「不逐 creep 指挥」原则（本文 §10 骨架来源） | LIKELY |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-001/002/008 | 本套件 | 两级决策、轻量内核、投资式扩张 | — |
| [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md) §2/§6/§7 | 本套件 | 分层总图、模块唯一权力表、CPU 规模模型 | — |
