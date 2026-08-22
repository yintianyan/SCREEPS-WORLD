# 14 · 情报系统（Intelligence System）

> 研究文档 · 结论等级：**设计裁决**（bot 证据收敛 + 官方机制核查）。
> 机制事实以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §4/§9 为基准；
> 存储分层依据 [18_MEMORY_ARCHITECTURE.md](18_MEMORY_ARCHITECTURE.md)；总纲见
> [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md)（知识闭环）。核查日：2026-08-22。

## 1. Problem

Screeps 是「闭眼世界」：任何时刻只有可见房间（creep/自有结构视野）返回真实
对象，其余世界全部不可见。敌人在哪、房间归属、宿敌谁在逼近——这些战略决策
的输入全部依赖**主动采集的、带时效的知识**。情报系统的设计错误有两种死法：

- **无知死**：从不侦察，扩张撞进宿敌怀抱（[17_EXPANSION_SYSTEM.md](17_EXPANSION_SYSTEM.md)
  评分缺输入）、被打时才发现威胁（[15_DEFENSE_SYSTEM.md](15_DEFENSE_SYSTEM.md)
  检测延迟）。
- **知识税死**：为「知道」支付过高 CPU——全图 scout 网络每 N tick 全量刷新，
  或把 intel 写进主 Memory 让每 tick 序列化税膨胀（ADR-010 反例）。

本文裁决：intel 的数据模型（存什么）、时效模型（TTL）与置信度模型、采集通道
（scout/observer/被动）、存储 schema（segment 分片），以及核心预算原则
**Information value per CPU**（每份情报必须有消费者，低价值情报不得占用高
优先级 CPU）。

## 2. Research Questions

1. intel 应该存什么？房间/玩家/地形/资源/市场五个维度各自的信息密度与刷新成本？
2. TTL 与置信度如何设计，才能让「过期情报触发高成本行动」在结构上不可能？
3. 采集通道如何分工：被动观测、scout 巡逻、observer 巡检网各自的成本与覆盖？
4. 玩家级威胁记忆（player-intel）如何支撑战略（宿敌距离、战争黑名单）？
5. segment 存储的分片 schema 与激活预算（每 tick 10 段）如何分配？

## 3. Existing Solutions（方法论参照）

pvp-and-intelligence 参考给出情报契约基线：每条情报至少带 `subject`、`room`、
`observedAt`、`source`、`confidence`、`expiry`、`evidence`；并把情报分为五类
分别维护——**Threat facts**（敌 body/结构/tower/controller 与最后可见时间）、
**Intent hypotheses**（入侵/侦察/压制/扩张/诱饵假设及支持与反证）、
**Economic estimate**（敌方能源流、补给距离、可持续时间及不确定区间）、
**Response policy**（normal/alert/siege/recovery 配额）、**After-action feedback**
（预期 vs 实际损失）。铁律：**过期情报不能直接触发高成本或不可逆行动**；未知
玩家、过期 observer 结果、不可见房间都要降置信度。这与 26 号总纲「知识闭环
（intel TTL/置信度）」一致。

## 4. Screeps Community Practice

- **地形是静态全量数据**：`Game.map.getRoomTerrain()` 无需房间可见即可查询
  （世界数据静态）；整图地形可离线 dump。——官方 API，地形情报**不需要**持续
  刷新（CONFIRMED）。
- **世界结构可推导**（03 §9）：highway = 坐标 mod 10==0、sector 中心房有 SK
  lair、power bank 刷在 highway——情报系统可用坐标先验（inferred）省掉对
  「房间的几何属性」的采集。
- **Novice/Respawn 区可探测**：系统签名常量（SIGN_NOVICE_AREA 等，03 §9），
  scout 一眼即可标记区域属性。
- **observer 巡检**：RCL8 结构、每房 1 座、射程 10 房、`observeRoom` 引擎无
  cooldown 常量（每 tick 可用，2026-08-22 复核官方 API 常量）——社区成熟 bot
  普遍用它建静态巡检网，零 creep 维护成本。
- **低频刷新先例**：KasamiBot proximityscout 每 20,000 tick 刷新周边情报并按
  矿物/source 估值——情报是慢变量，社区用极低频率采集成活多年（见 §5）。
- **市场情报**：`Game.market.getAllOrders` 低频缓存是社区共识（12 号文档市场
  节同源），属市场系统域，本系统只消费不采集。

## 5. Existing Bot Analysis

| Bot | 情报机制 | 可迁移点 | 备注 |
| --- | --- | --- | --- |
| Overmind | 独立 intel directive（模块化） | 情报与行为系统解耦 | 军事 directive（autoSiege 等）直接消费 intel |
| TooAngel | 攻击次数持久记忆（player.level 解锁更重攻击档）；trapped 检测 | 玩家交互历史的低成本持久化 | 十年无人值守 |
| The International | simpleAllies 盟友通信协议 | 盟友情报共享的标准协议 | 引入与否见 §12 |
| Quorum | observer 网络巡检 + spook 侦察角色 | 观察网+专职侦察双通道 | 防御为主 bot |
| KasamiBot | proximityscout 每 20000 tick 刷新，按矿物/source 估值 | 低频巡检+估值一体化 | 估值直接喂扩张决策 |
| hivemind | player-intel-manager 持久化威胁记忆 | 玩家级长期记忆（跨战争周期） | 其「刻意限武」哲学不影响该模块价值 |
| bonzAI | Guru 观察者类（RaidGuru/InvaderGuru/DefenseGuru） | 情报消费者按领域分面 | Guru=per-domain 聚合器 |

**收敛点（≥5 家）**：房间情报缓存 + 低频刷新 + observer 巡检是标配；玩家级
威胁记忆至少 3 家（TooAngel/hivemind/KasamiBot 估值记忆）。**分歧**：盟友
协议（仅 TI）与主动侦察密度（Quorum 双通道 vs KasamiBot 极低频）。

## 6. Advantages（推荐设计的优势）

1. **TTL + 三分置信度把「知识」与「猜测」显式分开**：战略层/战争授权在结构上
   拿不到「过期事实被当新鲜事实」的输入（ADR-009 战后核验只信新鲜 intel 的
   数据前提）。
2. **三级存储天然适配**：intel 是冷数据（segment）、活跃子集是缓存（heap）、
   Memory 零情报字段——完全符合 ADR-010，不付序列化税。
3. **observer 巡检网边际成本近零**：RCL8 房 10 格射程覆盖 ~21×21 房窗口的
   大部，覆盖核心疆域无需常驻 creep。
4. **玩家威胁记忆支撑跨周期战略**：宿敌距离进扩张评分（ADR-008 因子）、
   warBlacklist 进止损链（ADR-009）都有数据源。

## 7. Disadvantages（代价）

- segment 100KB×100 段、每 tick 仅激活 10 段：intel 分片必须设计加载预算，
  冷片读取代价是「提前一 tick 请求」的延迟——消费方需要容忍异步。
- 置信度模型用错比没有更糟：把 inferred 当 fact 会系统性过度自信。
- observer 依赖 RCL8：帝国前期（无 peak 房）只能靠 scout，覆盖能力有阶段性
  真空。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 陈旧情报触发进攻 | 打空目标/踩进换防后的堡垒 | 进攻授权只接受 fact 级 + 观察年龄 < 阈值（ADR-009；16 号文档硬门槛） |
| 盲区当安全区（从未侦察的房） | 扩张评分把未知记 0 分风险 | 未知 ≠ 安全：无情报的候选按最保守分计，驱动侦察任务生成 |
| player-intel 诽谤（误记宿敌） | 错误敌对/错误黑名单 | 记忆写 source 与 evidence 字段；黑名单带 TTL 冷却而非永久 |
| TTL 同时到期（过期风暴） | 下一 tick 生成一批侦察任务冲击预算 | 到期时间戳加抖动（jitter）；侦察任务按价值排序进低优先级车道 |
| segment 写放大（每 tick 全量重写） | CPU 与段容量双超 | 脏标记增量写 + 低频聚合落盘（18 号文档 §10.5 同源） |
| observer 目标非法/不可达 | 抛错进熔断 | 目标房名合法性校验 + observeRoom 返回码检查（0.2 CPU/intent 纪律） |
| scout 被杀导致路线空洞 | 覆盖缺口无人补 | 巡检任务带完成确认，超期未回报即重派（任务租约同构 12 号文档） |

## 9. CPU Implications

**Information value per CPU 原则**：每类 intel 字段必须有列名的消费者
（防御分级、扩张评分、战争授权、远矿 ROI……）；没有消费者的字段不采集，有
低价值消费者的字段不进高优先级车道。具体预算形态：

- 被动采集零边际成本：自有房/远矿房 RoomSnapshot 已算数据顺手沉淀（复用
  [09_ROOM_ARCHITECTURE.md](09_ROOM_ARCHITECTURE.md) 感知，不重复 find）。
- scout 数量是 posture 的函数：peace 期 1–2 只低频环路；fortify/war 期加密
  到目标导向侦察（威胁驱动，非全图广播）。
- observer 调度逻辑低频化：巡检队列静态（邻接房 > highway > 扇区轮换），
  每 tick 只做一次 observeRoom 调用与轻记账。
- 聚合与落盘分频：heap 内活跃 intel 每 tick 可读；segment 脏数据低频批量写。
- 情报系统整体预算目标 ≤ 帝国 CPU 的 2–3%（SPECULATION 初值，soak 校准）；
  Recovery 档下只保留被动采集，scout 车道暂停（P3 类负载）。

## 10. Recommended Design

### 10.1 四域数据模型（intel 存什么）

| 域 | 内容 | 新鲜度要求 | 主要消费者 |
| --- | --- | --- | --- |
| RoomIntel | 归属/RO（RCL）/威胁快照/防御结构估值/资源（source 数、矿物种类密度）/最后可见时间 | 秒级需求仅在威胁字段 | 防御分级、扩张评分、远矿 ROI、战争目标选择 |
| PlayerIntel | 威胁指数、攻击历史、胜率估计、黑名单、最后活动房、与我房距离 | 慢变量（衰减不删除） | posture 输入、扩张评分（宿敌距离）、止损链 |
| TerrainIntel | 地形矩阵、出口、可推导的世界结构（SK/highway/扇区中心） | 静态（∞） | 布局适配（13 号文档）、路线规划、防守难度评分 |
| MarketIntel | 订单簿快照/价格历史 | 短 TTL | 市场系统（12 号文档）所有，本系统只读 |

### 10.2 IntelEntry 契约与 TTL

对齐 26 号文档 §5 的 `IntelEntry`（segment 冷存），字段：
`subject`（room/player id）、`observedAt`、`source`（passive/scout/observer/
ally/derived）、`confidence`、`expiry`、`payload`（按域 schema）。

TTL 分档（初值，SPECULATION，soak 校准）：

| 字段类 | TTL | 依据 |
| --- | --- | --- |
| 敌编队/威胁事实 | 可见期结束即降级 | 行情瞬变 |
| 房间归属/RO/RCL | ~5,000–20,000 tick | KasamiBot 20k 先例；归属是慢变量 |
| 资源/估值字段 | ~20,000 tick | 同上（与估值刷新同频） |
| 玩家威胁记忆 | 衰减权重而非删除 | hivemind 先例；黑名单 TTL 由止损链定 |
| 地形/世界结构 | 无限 | 官方静态事实 |

### 10.3 三分置信度与使用规则

- **fact**：本源直接观测（当前可见，或有 observer/scout 时间戳在新鲜度窗内）。
- **stale**：曾在 TTL 内观测、超窗未复核。
- **inferred**：由先验推导（世界结构坐标推导、行为模式假设、盟友转述）。

使用规则（结构化，不靠自觉）：**进攻/占领/大额调拨只接受 fact**；stale 只能
触发「先侦察后行动」的两段式任务；inferred 只能触发侦察任务与保守评分（未知
风险按最保守计），永不直接驱动动作。这与 skill 参考的「过期情报不能直接触发
高成本或不可逆行动」铁律同构，并落成类型系统约束。

### 10.4 采集通道三层

1. **被动**：所有可见房间的快照数据顺手沉淀（零边际成本，永远在线，包括
   Recovery 档）。
2. **observer 巡检网**：每个 RCL8 房负责其 10 格射程窗内的静态优先队列
   （自家邻接 > 潜在扩张候选 > highway/SK > 宿敌疆域边缘）。帝国层汇总去重
   生成统一巡检表，防止多 observer 重复看同一房。
3. **scout 车道**：低频环路（和平期覆盖候选区与疆域边缘）+ 目标导向任务
   （战前核实、战后核验、扩张尽调——16/17 号文档的两段式触发器）。scout
   身体极简（1M+1CLAIM 可选占位变体），损失按耗材计。

### 10.5 PlayerIntel：持久威胁记忆

- 条目：威胁指数（攻击历史加权 + 时间衰减）、可观测军力上限（见过的最大
  编队 body 与 boost）、行为画像（TooAngel 式交互计数：被攻击次数/我方攻击
  次数）、黑名单（战争失败目标，TTL 冷却，ADR-009）。
- 派生指标：宿敌距离 = 威胁玩家活动房到各候选房的距离（喂 17 号文档评分的
  负权因子）。
- 存储：segment 单独分片（量小、读频低），heap 内只挂活跃宿敌子集。

### 10.6 segment 分片 schema

- 分片策略：`intel-rooms-{hash}`（房间条目按房名哈希分片）、
  `intel-players`（单片，量小）、`intel-static`（地形索引与世界结构推导结果，
  写一次基本不动）。
- 每片头部带 `epoch`（最后落盘 tick）与脏标记；读侧「本 tick 请求、下 tick
  可读」的异步性由情报系统的 heap 活跃层遮蔽：消费者永远读 heap，未命中才
  发起 segment 加载并返回 stale 占位。
- 激活预算：情报系统常态占用 ≤2 个激活段（活跃窗 + 按需加载），不与遥测
  （[21_OBSERVABILITY.md](21_OBSERVABILITY.md)）争 10 段上限。

### 10.7 与兄弟系统的边界

- 市场订单：市场系统所有（12 号文档 §10.4），情报只读缓存。
- 战后核验：evaluateWarOutcome（16 号文档）是情报系统的消费者——它要求
  「新鲜 intel」即 fact 级 + 观察年龄阈值，由本系统的置信度 API 直接表达。
- 盟友协议（simpleAllies 类）：暂不引入（§12）；若引入，盟友转述一律标
  inferred。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 全图常驻 scout 网络每 N tick 全量刷新 | CPU 爆炸；KasamiBot 20k tick 低频先例反证必要性 |
| intel 写主 Memory | 每 tick 序列化税（ADR-010 反例；TooAngel 存路径教训同源） |
| 置信度只二元（新鲜/过期） | 无法表达世界结构先验与行为假设，逼消费方自行猜测 |
| LLM/外部服务做情报分析 | 违反 ADR-011（禁入 tick 路径；运行时亦无出站网络） |
| 情报系统直接触发军事行动 | 破坏 ADR-009 授权链；情报只供事实，开战权在战略层 |

## 12. Open Questions

1. 各 TTL 档与侦察密度的具体数值需 soak 数据回填（初值见 §10.2）。
2. 盟友通信协议（simpleAllies 先例）是否引入：收益（共享视野/联防）vs 风险
   （外部输入污染置信度模型）——推迟到 A4 后裁决。
3. observer 巡检表的全局调度算法（多 RCL8 房去重优先级）需要规模数据。
4. 跨 shard 情报（InterShardMemory 100KB）推迟到 A5 后与 P12 联合裁决。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://docs.screeps.com/api/（StructureObserver/observeRoom + constants） | 官方 | observer RCL8、每房 1 座、OBSERVER_RANGE=10、无 cooldown 常量 | CONFIRMED（2026-08-22 复核） |
| Bot 调研摘要 2026-08-22（Overmind intel 模块/TooAngel 攻击记忆/Quorum observer+spook/KasamiBot proximityscout 20k/hivemind player-intel-manager/TI simpleAllies/bonzAI Guru） | 源码 | 低频刷新+observer 巡检+玩家记忆收敛 | CONFIRMED |
| skill 参考 pvp-and-intelligence.md（情报契约五分类、置信度铁律） | 方法论 | IntelEntry 字段与使用规则 | 设计输入 |
| 03_SCREEPS_GAME_CONSTRAINTS.md §4/§9 | 官方事实 | segment 100×100KB/每 tick 10 段；世界结构/签名常量 | CONFIRMED |
| 18_MEMORY_ARCHITECTURE.md §10.5 / 21_OBSERVABILITY.md | 本套件 | 冷数据 TTL 与 segment 预算分配 | 设计输入 |
