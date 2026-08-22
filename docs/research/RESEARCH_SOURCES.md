# RESEARCH_SOURCES · 调研来源台账

> 总任务书 §28 要求的证据台账。字段：URL / 作者·项目 / 类型 / 主题 / 关键发现 /
> 置信度（CONFIRMED / LIKELY / UNCERTAIN / SPECULATION）/ 对本架构的影响。
> 调研执行日：2026-08-22。来源分级：源码 > 官方文档 > 引擎常量 > 官方贡献文档 >
> 社区 wiki > 论坛/Reddit > 个人博客。**引擎常量与官方 API 冲突时以引擎常量为准**
> （裁决先例见 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md) §13）。

## A. 官方文档与引擎源码（事实层）

| URL | 类型 | 主题 | 关键发现 | 置信度 | 影响 |
| --- | --- | --- | --- | --- | --- |
| https://docs.screeps.com/api/constants.html | 官方常量 | 全部数值 | 引擎常量生成页 | CONFIRMED | 事实基准主源 |
| https://github.com/screeps/common/blob/master/lib/constants.js | 引擎源码 | 全部数值 | PIXEL_CPU_COST=10000；MARKET_MAX_ORDERS=300；TOWER_FALLOFF=0.75；downgrade 表；CONTROLLER_LEVELS；BOOSTS 表（harvest 3/5/7） | CONFIRMED | 文档散文冲突的最终裁决源 |
| https://docs.screeps.com/cpu-limit.html | 官方 | CPU | bucket 上限 10,000；tickLimit=limit+500 | CONFIRMED | 四档看门狗设计 |
| https://docs.screeps.com/global-objects.html | 官方 | Memory | Memory=惰性 JSON.parse；parse/stringify 计 CPU | CONFIRMED | 瘦 Memory 原则 |
| https://docs.screeps.com/api/#RawMemory | 官方 | segments | 100 段×100KB、每 tick 激活 10、异步 | CONFIRMED | 冷数据存储设计 |
| https://docs.screeps.com/contributed/caching-overview.html | 官方贡献 | 缓存 | global 定期重置不可持久；2048KB 上限口径；TTL/拍平/lzstring 建议 | CONFIRMED（上限 LIKELY） | heap 缓存语义 |
| https://docs.screeps.com/api/#PathFinder | 官方 | 寻路 | 1 op≈0.001 CPU；maxRooms 16；moveTo reusePath=5 | CONFIRMED | 两级寻路+限频 |
| https://docs.screeps.com/api/#Game.map | 官方 | 路由 | findRoute 两级寻路官方示例 | CONFIRMED | 移动子系统 |
| https://docs.screeps.com/defense.html · api/#StructureController · api/#StructureNuker · api/#StructurePowerSpawn · power.html · start-areas.html · resources.html · control.html · creeps.html · api/#Game.market · api/#StructureTerminal · api/#StructureFactory · api/#Creep | 官方 | 战斗/防御/GCL/市场/结构 | safemode 20k/50k 每shard一房；nuke 50k tick 取消 safemode；GCL_POW=2.4；运费指数公式 | CONFIRMED | 军事/扩张/市场设计 |
| https://docs.screeps.com/architecture.html + Steam 讨论 | 官方+社区 | tick 时长 | shard0 4.5-5.5s / shard1-2 3.5-4s / shard3 2.5-3s | LIKELY | 禁止固定换算 |
| https://github.com/screeps/engine/blob/master/src/processor/intents/links/transfer.js | 引擎源码 | link | 冷却=1×切比雪夫距离（发送侧）；3% 损耗接收侧 ceil | CONFIRMED | 12 号文档 link 网设计 |

## B. Bot 源码与文档（经验层·源码级）

| URL | 作者·项目 | 主题 | 关键发现 | 置信度 | 影响 |
| --- | --- | --- | --- | --- | --- |
| https://github.com/bencbartlett/Overmind（+ /wiki/Framework-overview、/src/main.ts raw） | Ben Bartlett（Muon） | 架构 | 分层 OO：Overmind→Colony→HiveCluster→Directive→Overseer→Overlord→Zerg→Task；build/refresh 双路径 heap 缓存；三相位 build→init→run；请求-满足分离；混淆发布；拒绝一flag一进程；617★ | CONFIRMED | 相位分离/缓存/请求队列/轻意图标记（ADR-002/004/005） |
| https://bencbartlett.com/blog/screeps-1-overlord-overload/ · …-4-hauling-is-np-hard/ · …-5-evolution/ · …-6-verifiably-refreshed/ | 同上 | 博客系列 | hauling 复杂度论证；缓存刷新验证 | CONFIRMED | 物流近似解（ADR-006） |
| https://github.com/bencbartlett/Overmind-RL | 同上 | RL | RL 只作体外训练环境 | CONFIRMED | ADR-011 |
| https://github.com/TooAngel/screeps（+ doc/Design.md、doc/BaseBuilding.md、src/main.js、diplomacy.js、prototype_room_basebuilder.js、brain_squadmanager.js raw） | Tobias Wilken | 架构 | 平铺 brain_*/prototype_*/role_*；指数平滑 cpuIdle/heapFree/memoryFree 门控扩张；tick 末 generatePixel；声誉外交三级升级；squad 全员 waiting 才 attack；trapped 检测；道路沿实测路径；Memory 存路径反例；十年无人值守 | CONFIRMED | 预算门控自治（ADR-003/008）；trapped 元机制（22 号） |
| http://tooangel.github.io/screeps/doc/Design.html | 同上 | 设计文档 | trapped/三指标/pixel 细节 | CONFIRMED | 同上 |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source | MarvinTMB + 社区 | 架构 | Collective 帝国层+房间层；requests.ts 请求驱动经济（Work/Haul/Terminal）；fastFiller；customPathFinder；neuralNetwork 交通流道路；simpleAllies 协议；migration.ts；GCL 18.2 亿 | CONFIRMED | 请求制经济（ADR-006）；遥测先例（21 号） |
| https://github.com/ScreepsQuorum/screeps-quorum（+ Reddit 710p9n 发布帖、gitconsensus.com） | tedivm 共建 | 架构 | OS 内核 qos（kernel/scheduler/process/performance）+programs（city/empire/meta）；GitConsensus 自我管理；CI 自动部署；quorum.tedivm.com 全公开；sos_lib（vram/profiler/stormtracker）；2021 停更；GCL 45 亿 | CONFIRMED | 轻量内核裁决的反例证据（ADR-002）；自我管理先例 |
| https://github.com/bonzaiferroni/bonzAI | bonzaiferroni | 架构 | Operation–Mission 两级 +40 Mission 类 + Guru 观察者；AutoOperation 自动选址；发布时选房仍手动 | CONFIRMED | Agenda/Operation 模型（ADR-003）；自治诚实分级（23 号） |
| https://github.com/kasami/kasamibot + https://kasami.github.io/kasamibot/ | Kasami | 架构 | Manager 驱动；蝴蝶形 7x7 模板；每房孵化队列订单+优先级；RCL7 miner overfit+hauler 池化；remote 上限 6 保留房；labmanager T3 库存；harasser+wreckerteam；borderwall+fortresswall；proximityscout 20k tick 估值；Reddit 评价「唯一开箱即真正好攻击性的开源 bot」 | CONFIRMED（文档级，源码压缩分发） | 布局模板（ADR-007）；远矿上限；军事组织 |
| https://github.com/Mirroar/hivemind | Mirroar | 架构 | process/dispatcher 协作调度；spawn-role/spawn-manager；bay 结构化补给；player-intel 持久威胁记忆；intershard；**2026-07 仍活跃（当前最活跃开源大 bot）**；刻意限武防 NCP | CONFIRMED | player-intel（14 号）；伦理限武讨论（16 号） |
| https://github.com/screepers/screeps-profiler | screepers 社区 | 工具 | 函数级 CPU profiler 社区标配 | CONFIRMED | 21 号观测 |
| https://github.com/glitchassassin/screeps-cache | glitchassassin | 工具 | 跨 reset 数据分层专项库 | CONFIRMED | 18 号存储分层佐证 |
| https://www.leagueofautomatednations.com/map/shard0/bots | LoAN | 生态 | bot 克隆体分布 | CONFIRMED | 01 号生态 |

## C. 社区 wiki / 论坛 / Reddit（经验层·社区）

| URL | 类型 | 主题 | 关键发现 | 置信度 | 影响 |
| --- | --- | --- | --- | --- | --- |
| https://wiki.screepspl.us/Maturity_Matrix/ | wiki | 成熟度 | 社区标准成熟阶梯（drop→container→remote→SK）；半自动普遍 | CONFIRMED | 10 号 phase；27 号路线 |
| https://wiki.screepspl.us/CPU/ | wiki | CPU | intent ≈0.2 CPU 且失败也收费；移动是 CPU 大头；reusePath 权衡 | CONFIRMED | 20 号；先自检再发 intent |
| https://wiki.screepspl.us/MemHack/ | wiki | Memory | 演进：任意存→ID/数字→打包→RawMemory._parsed；低频序列化有丢数据风险 | CONFIRMED | 18 号（否决 MemHack 极端形态） |
| https://wiki.screepspl.us/Caching/ | wiki | 缓存 | 三级准入共识 | LIKELY（抓取超时，双源替代） | 18 号 |
| https://wiki.screepspl.us/StructureLink/ | wiki | link | 三种管理实现（优先级/固定路由/水位） | CONFIRMED | 12 号 link 网 |
| https://wiki.screepspl.us/Market/ | wiki | 市场 | 5% 挂单税取消不退；10 deal/tick；getAllOrders 禁高频；跨 shard 套利运费陷阱 | CONFIRMED | 12 号市场 |
| https://wiki.screepspl.us/Great_Filters/ | wiki | 发展 | 卡尔达肖夫采集分级；冷启动失败高频死因；**不含按 RCL 建造顺序表**（复核澄清） | CONFIRMED | 10 号；27 号 |
| https://wiki.screepspl.us/Combat/ + /StructureController/ + /Source_Keeper/ + /Power/ + /Intermediate-level_tips/ + /Claiming_new_room/ | wiki | 战斗/防御/SK/Power/资源流 | safemode 约束；min-cut 终点；SK +10creeps+2-3CPU；「把加工搬到能量处」 | CONFIRMED | 15/16/17 号 |
| https://www.reddit.com/r/screeps/comments/55aapi/（2016 围城）· 662flg（2017 safemode 自动化）· 8mowvu（overnight collapse）· 5l1nvz（CPU 含义）· 8181nc（慢节奏/remote 效率）· 864qy3（2018 矿工体型 5W 惯例）· 6dz3xn（2017 时长/RCL8 约 3 周）· lzxzu1（2021 殖民 5000 能量）· cm5o0w（Overmind 可利用）· 8pbrfv（长期游玩/TooAngel 不纠缠）· 10wohds（2023 会话间全灭）· 6pg2q6（0.25-0.5 CPU/creep 实测）· 5uab0c（2017 ML 讨论）· bu59il（Grafana）· 710p9n（Quorum 发布） | Reddit | 实战经验 | 围城耗能破防；safemode 触发惯例；CPU 死亡循环案例；remote 效率 40-50%；矿工体型；殖民输血 | CONFIRMED | 全套（esp. 15/24/29 号） |
| https://screeps.com/forum/topic/2381（CPU 求助）· 1405（bucket 失灵）· 2185（强制 reset）· 2196（市场技巧）· 298（后期优化/GCL farm）· 327/1566（SK 策略）· 3099（pixel 调价 5000→10000）· 2163/51（IVM heap/GC）· 2000（KasamiBot 停发）· 2177（site 上限） | 论坛 | 实战 | 3-5 CPU/房数据点；reset 测试法；市场历史自记（getHistory 仅 14 天）；RCL8 15WORK 上限→GCL farm→temple 能量链 | CONFIRMED | 10/12/18/20 号 |
| https://blog.screeps.com/2015/10/Important-change-CPU-cost-of-API-methods/ | 官方博客 | CPU | 100 creep 仅移动 ≈20 CPU | CONFIRMED | 20 号 |

## D. 博客与工具链（经验层·个人）

| URL | 作者 | 主题 | 关键发现 | 置信度 | 影响 |
| --- | --- | --- | --- | --- | --- |
| https://jonwinsley.com/notes/screeps-room-planning · /screeps-streamlining-serialization · /screeps-data-driven-development | Jon Winsley | 规划/序列化/观测 | Franchise+HQ 布局；shard3 砍 remote 案例；序列化优化；Grafana 工作流 | CONFIRMED（个案） | 10/12/13/21 号 |
| https://www.pedanticorderliness.com/posts/screeps | （2022 博客） | 长期运营 | 一年级轨迹：boost 生产线→防御→跨 shard；过程树→进程+优先队列+事件流；min-cut | CONFIRMED（个案） | 01/15 号 |
| https://www.derek.net.au/logs/ | Derek | LLM | 唯一已知 LLM×Screeps 集成=体外大脑+Memory 通道；纯规划未实测 | CONFIRMED（自述状态） | 23 号 |
| https://kasami.github.io/kasamibot/ | Kasami | 文档 | 见 B 节 KasamiBot | CONFIRMED | 同上 |
| https://steamcommunity.com/app/464350/discussions/0/2154350647537090985/ | Steam | tick 时长 | 开发者口径 shard 时长 | LIKELY | 03 号 |

## E. 任务书点名但未能证实者（诚实记录）

| 名称 | 调研结果 | 置信度 |
| --- | --- | --- |
| Acorn | MMO 与 seasonal 官方 API 均无此账号；GitHub 无匹配仓库 | UNCERTAIN（公开互联网不存在） |
| SIV | MMO 存在账号 Siv（2018 注册）但无战绩/源码证据 | UNCERTAIN |
| Moose | MMO 存在账号 moose（2014，GCL=0） | UNCERTAIN |

**判断**：三者可能是私服/Discord 圈内名或名字有出入；公开社区公认的六大经典代码库为
tiggabot、The International、TooAngel、Overmind、bonzAI、Quorum（Scribd 聚合索引，
社区二手，LIKELY）。本研究以可证实源码为准。

## F. 关键冲突裁决记录（详见 03 号 §13）

1. downgrade 计时：docs 散文 vs 引擎常量 → **引擎**。
2. 市场运费：market.html 线性示例 vs calcTransactionCost 指数公式 → **指数公式**。
3. Boost「统一 2/3/4」→ **分 part 类别**（harvest 3/5/7 等）。
4. 订单上限 50 vs 300 → **300**。
5. Tower 最低 20% vs 25% → **25%**。
6. global reset「~30 分钟」→ **无官方依据，按随时重置设计**。
7. tick「固定 3 秒」→ **2.5-5.5s 按 shard**。
8. pixel 5000 vs 10000 → **10000**（PIXEL_CPU_COST）。
9. link 冷却「固定 1 tick」→ **1×切比雪夫距离**（引擎 intents 源码）。

## G. 撰写集群补充来源（W-A 大脑层 / W-C 安全域，2026-08-22）

| URL | 主题 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://raw.githubusercontent.com/TooAngel/screeps/master/src/main.js + src/brain_nextroom.js | 预算门控源码 | EMA 公式 `S=((D-1)·S+x)/D`；`haveEnoughSystemResources()` 人均占用>平滑余量即拒扩张（ADR-003/008 的数学形式） | CONFIRMED |
| https://bencbartlett.com/blog/screeps-1-overlord-overload/ | Overmind 架构博客 | Directive/Overseer/Overlord 职责与请求-满足分离的第一手说明 | CONFIRMED |
| The International src/international/requests.ts（raw） | 请求经济源码 | work/combat/haul 三池、responder 认领、abandon 冷却、100–200 tick 复核、score 排序 | CONFIRMED |
| https://github.com/bencbartlett/creep-tasks | Task 契约库 | `creep.task` 属性+parent 链的社区标准化 | CONFIRMED |
| WebSearch「screeps GOAP planner bot / tasks system」（负结果） | 规划谱系 | 无 GOAP/在线规划器 bot；任务系统主流=队列+角色管理器 | CONFIRMED（负结果） |
| https://gist.github.com/clarkok/25b3e6e2c7cde42f9678d05db498fbee + https://sy-harabi.github.io/Automating-base-planning-in-screeps/ + https://wiki.screepspl.us/Defensive_Structures/ | min-cut 布局 | 最大流最小割 rampart 实现与 shrink-wrap 实践 | CONFIRMED |
| https://github.com/tanjera/screeps | 攻方战术 | Tower Drain（tank+healer 房外轮换吸塔）——围城耗能攻方视角实证 | CONFIRMED |
| https://wiki.screepspl.us/Power/ + 引擎常量 | power bank | POWER_BANK_POWER_MAX=5000（wiki 500–10,000 冲突，以引擎为准，见 03 §13 #10） | CONFIRMED |
| https://screeps.com/forum/topic/513/ | controller | RCL8 前可无限注能 controller | CONFIRMED |
| https://docs.screeps.com/api/#StructureObserver（2026-08-22 复核） | observer | RCL8、每房 1 座、OBSERVER_RANGE=10、无 cooldown 常量 | CONFIRMED |
| github.com/bencbartlett/Overmind README（W-E 复核） | 混淆组件名 | README 指向 Assimilator_obfuscated.js（多人集体模块）；素材中的 Overmind_obfuscated.js 来自 main.ts 引用——两处可能并存，套件正文统一用「混淆形态发布核心组件」不点名文件 | CONFIRMED |
| github.com/Mirroar/hivemind 仓库树（W-E 复核） | 测试先例 | 仓库含 mock 目录（fake 实现层级测试的现实先例，28 号引用）；intershard 支持以源码树为准（README 未宣传） | CONFIRMED |
