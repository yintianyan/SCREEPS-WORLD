# 02 · 现有 Bot 深度分析（EXISTING BOT ANALYSIS）

> 研究文档 · 结论等级：**源码级调研综述**（2026-08-22；置信度逐条标注，KasamiBot
> 为文档级 CONFIRMED——源码压缩分发）。生态全景见
> [01_SCREEPS_AI_LANDSCAPE.md](01_SCREEPS_AI_LANDSCAPE.md)；机制事实见
> [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)；本套件全部
> ADR 的 bot 证据以本文为单一真相源；证据台账见 [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md) B 节。

## 1. Problem

「六大 bot 收敛了什么、分歧了什么、哪些复杂度是必要的、哪些是历史遗留」是本套件
一切架构裁决的经验基础。只看单个 bot 会把个人趣味当规律（Overmind 的星际争霸
主题、TooAngel 的猴子补丁）；只看聚合结论会丢失裁决性细节（TI 的 abandon 冷却、
TooAngel 的三指标门控）。本文对七个可验证源码级对象逐一按统一维度解剖，再横向
提炼谱系、收敛与分歧，最后对「复杂度必要性」做出裁决——直接回答：**Overmind 的
7 层抽象与 TooAngel 的平铺 90 文件，本质权衡各是什么，我们取哪边、取多少。**

## 2. Research Questions

- 每个 bot 的架构、决策、经济、房间发展、军事、CPU 策略、弱点各是什么？
- 架构谱系如何分类？各流派的存活证据与战绩如何？
- 哪些设计是 ≥3 家收敛（应当默认采纳）？哪些是分歧（需要裁决）？
- 各 bot 的复杂度哪些是问题必需，哪些是历史遗留/个人趣味？

## 3. Existing Solutions（分析框架：谱系分类学）

按「决策组织方式」与「代码组织方式」两个正交轴分类（本套件分析框架）：

| 谱系 | 决策组织 | 代表 | 存活证据 |
| --- | --- | --- | --- |
| Role-based | 每角色一个行为单元 | TI、KasamiBot | TI GCL 18.2 亿；KasamiBot 2018 终止 |
| Task/Request-based | 需求显式化成对象，执行者认领 | TI（requests）、TooAngel（部分） | 现役最强经济组织形态 |
| Manager-centric | 管理员统计推派 | KasamiBot、hivemind、TooAngel | hivemind 2026 活跃 |
| Kernel-Process | OS 式进程调度 | Quorum、hivemind（轻量） | Quorum 2021 停更 |
| Directive-Operation | 目标挂载点+行动包 | Overmind、bonzAI | 均非当前活跃 |
| Hybrid | 以上混合 | TI（Manager+Task）、hivemind（Process+Role+Manager） | 最常见的成熟形态 |

判定：纯种形态少，成熟 bot 几乎都是混种；谱系是「倾向」不是「阵营」。

## 4. Screeps Community Practice（社区对七大 bot 的认知）

- 社区公认经典代码库口径为六大（tiggabot/TI/TooAngel/Overmind/bonzAI/Quorum，
  Scribd 聚合索引，LIKELY）；本研究加入 hivemind（当前最活跃）与 KasamiBot
  （文档级可证），剔除不可证实名单（01 号 §3）。
- 社区评价散点：KasamiBot「唯一开箱即真正好攻击性的开源 bot」（Reddit 8pbrfv）；
  Overmind「界面友好但 definitely exploitable」（Reddit cm5o0w）；TooAngel
  「打一次失败就不再纠缠」（同帖）；TI 自评战斗代码 "rather dysfunctional" 但
  防御强（README）。**战绩与源码可读性、攻击性三者互不相关**。

## 5. Existing Bot Analysis（逐 bot 深度分析）

### 5.1 Overmind（github.com/bencbartlett/Overmind）

- **基本情况**：Ben Bartlett（Muon），TypeScript + rollup，MIT，617★/157 fork/
  605 commits，v0.5.2；wiki 最后编辑 2024-02，低频维护（2026-08-22 抽查复核，
  CONFIRMED）。
- **架构**：星际争霸主题分层 OO——Overmind（顶层包裹，每 tick 实例化）→ Colony
  （自有房+outposts 远矿打包）→ HiveCluster（结构+功能器官包 ×7：commandCenter/
  hatchery 孵化/evolutionChamber/praiseSite/sporeCrawler/upgradeSite）→ Directive
  （游戏 flag 包装，主副色编码，几乎无逻辑，条件挂载点）→ Overseer（巡查异常，
  按优先级队列运行 overlord、放置新 directive）→ Overlord（面向目标的 spawn+控
  creep 单元）→ Zerg（creep 包装）→ Task（可组合活动对象）。src/ 30 个子目录
  （algorithms/caching/contracts/intel/logistics/movement/priorities/profiler/
  reinforcementLearning/roomPlanner/tasks…）。
- **决策**：反应式 directive 循环；决策树派 Task；**请求-满足分离**——init 相位
  所有需求方只登记请求（spawn/运输），run 相位 provider 按优先级队列满足。
- **经济**：远矿=Colony outpost；bunker 式布局（wiki「Bunkers」）；lab/terminal
  细节未读到源码（evolutionChamber 大概率管 boost）。
- **军事**：directive 化——directives/offense 含 autoSiege/controllerAttack/
  pairDestroy/swarmDestroy；独立 intel 模块。
- **CPU 策略**：heap build/refresh 双路径（global.Overmind+到期时间戳）；三相位
  build→init→run；内置 profiler/Grafana/版本迁移。
- **弱点**：TS 工具链修改门槛高；可被利用（社区评）；核心以混淆形态发布
  （obfuscated 构建+校验和）损害可审计性；单人项目维护风险；明确拒绝「一 flag
  一进程」。
- **启示**：相位分离与请求-满足是被全套件继承的骨架（ADR-004/005）；主题化命名
  是可读性税；「抽象层数≠战绩」的第一证据。

### 5.2 TooAngel（github.com/TooAngel/screeps）

- **基本情况**：Tobias Wilken，JS ES5+Grunt，AGPL，644★/1189 commits；自称第一
  个全自动化开源 bot；PR 经 World Driven 自动审查合并部署（npm 包+Steam
  Workshop）；**十年无人值守，本套件唯一长跑孤例**（CONFIRMED）。
- **架构**：无分层——平铺 90 文件：brain_*（顶层控制器：main/memory/squadmanager/
  stats/trapped/nextroom/market）+ prototype_*（猴子补丁扩展 Room/Creep 等 ×30）
  + role_*（×30 角色）。
- **决策**：纯规则+状态机；**声誉外交**（Memory.players[name].reputation，负分
  触发 handleRetaliation，三级升级 simpleAttack ≤−1500 → squad −6000（siege+3heal）
  → attack42 −9000，攻击 10 次解锁更重档）；squad move→attack FSM 全员 waiting
  才转 attack；trapped 检测（GCL≥3+仅 1 房+5 万 tick 停滞→升级策略）。
- **经济**：universal 万能 creep 自举保底；远矿=sourcer+reserver+carry 走预计算
  固定路径顺路投递；link 朝 storage 推；mineral→terminal→超阈值自动卖；
  power/commodity 角色组齐全。
- **房间发展**：动态布局——道路严格沿实测 creep 路径（不在路径上的路会被拆）；
  墙按出口分层迭代；建造 beforeStorage（spawn→tower→storage→link→extension）/
  afterStorage 两级列表；限流全局 100 site、每房同时 1 site、一次 1 spawn。
- **军事**：纯反应式声誉外交+塔+defender+towerdrainer；atkeeper 系（SK
  farming）；声望榜经 RawMemory 公共 segment 发布。
- **CPU 策略**：预计算路径；路径缓存带时间戳；global.data heap 缓存；**指数平滑
  cpuIdle/heapFree/memoryFree（EMA：S=((D−1)·S+x)/D）门控扩张**（brain_nextroom
  的 haveEnoughSystemResources）；tick 末空闲 generatePixel。
- **弱点**：猴子补丁全局命名空间耦合；Memory 存整条 route/path（技术债）；
  「打一次失败就不再纠缠」（行为可摸透）；brain/prototype 职责交叠。
- **启示**：三指标门控是预算驱动自治的十年实证（ADR-003/008 直接引用）；trapped
  元机制是「自愈失效检测器」孤例（22 号 §10.6）；平铺能活但依赖作者个人纪律，
  不可复制其形式、必须复制其机制。

### 5.3 The International（The-International-Screeps-Bot/The-International-Open-Source）

- **基本情况**：MarvinTMB+社区，TS，MIT，2021-04 创建，123★/39 fork/418 文件；
  MarvinTMB 账号 GCL 18.2 亿/power 413 万（现役最强开源战绩，CONFIRMED）。
- **架构**：静态类双层——src/international/（collective.ts CollectiveManager
  跨房事务）+ src/room/（commune/spawning/terminal/construction/creeps/
  roleManagers{antifa,commune,international,remote}）。
- **决策/经济**：**request 驱动经济**——requests.ts 统一 WorkRequest/HaulRequest/
  TerminalRequest，Collective.creepsByHaulRequest 按请求分配，responder 认领+
  abandon 冷却+100–200 tick 复核+score 排序；fastFiller 补 extension；schedule/
  低频调度。
- **军事**：antifa 家族 quad.ts/duo.ts/dynamicSquad.ts+*Ops 微操；README 自评
  战斗代码 "rather dysfunctional" 但防御强。
- **CPU 策略**：request 驱动天然摊薄决策频率；Grafana 遥测托管 pandascreeps.com。
- **弱点**：主分支更新慢；自认意大利面；社区要求不得用于欺负新人。
- **启示**：请求经纪制（帝国=撮合者不是指挥官）是 04/08 号 Demand 模型的直接
  先例；migration.ts 与 featureFlags.spec.ts 是 18/28 号的工程先例；
  customPathFinder 自研打包寻路与 neuralNetwork 交通流道路证明「自建基础设施
  上限很高但非必需」。

### 5.4 Quorum（ScreepsQuorum/screeps-quorum）

- **基本情况**：tedivm 发起社区共建，JS，163★，2021-02 后停更，108 文件；Quorum
  账号 GCL 45.2 亿（生前长期排名极高，CONFIRMED）。
- **架构**：OS 内核式——src/qos/（kernel/scheduler/process/performance）调度
  src/programs/（city/empire/meta 三层进程）+ src/roles/ + src/extends/room/
  15 个扩展（economy/logistics/conflict/intel/territory/spawning…）。
- **决策/经济**：city 进程管 layout/mine/chemistry/fortify；empire 进程管
  expand/intel/market/observer 网巡检；角色 factotum（terminal 管家）/fracker/
  replenisher/spook（侦察）；lib/genome.js 化学反应规划。
- **军事**：以防御为主（conflict.js/defense/fortify），进攻有限。
- **CPU 策略**：QoS 分层调度 + sos_lib（vram 虚拟内存/segment 管理/profiler/
  stormtracker 监控 tick 率——把服务器性能波动当输入）。
- **弱点**：2021 后弃维护；JS 原型补丁阅读成本高。
- **启示**：**第一个自我管理项目**（GitConsensus 投票合并、CI 每日自动部署 MMO、
  ScreepsAutoSpawner 自动重生、全公开仪表盘）是自治治理的先例（28 号 CI 证据）；
  其进程内核是 ADR-002 的反例证据——语义对、载体重、维护崩。vram 证明 segment
  可承载热-冷混合负载，但抽象层过重（18 号 §11 部分采纳）。

### 5.5 bonzAI（bonzaiferroni/bonzAI）

- **基本情况**：TS，108★，最后推送 2017-11，账号 Bonzai 仍在（CONFIRMED）。
- **架构**：**Operation–Mission 两级**——src/ai/operations/（AutoOperation/
  MiningOperation/RaidOperation/KeeperOperation/ConquestOperation/FortOperation/
  QuadOperation…）+ src/ai/missions/ 约 40 个 Mission 类 + Guru 观察者类
  （RaidGuru/InvaderGuru/DefenseGuru）；顶层 Empire.ts/WorldMap.ts/
  BonzaiDiplomat.ts。
- **决策/经济**：全 Mission 化（Mining/LinkMining/Transport/Refill/Upgrade/
  Geology/Lair/TerminalNetwork）；SpawnGroup 统一孵化；MarketTrader/TradeNetwork。
- **军事**：RaidMission+RaidAgent/Brawler/Bodyguard；DemolishOperation；
  PowerMission（power bank）。
- **CPU 策略**：Mission 生命周期管理；集成 Traveler 寻路库。
- **弱点**：发布时房间选择仍靠手动；停更 9 年机制旧。
- **启示**：Operation=中期承诺单元是 07/08 号 Agenda 模型的命名先例；AutoOperation
  自动分析周边 source 与地形选最佳建家点位是全自动扩张的第一步；「愿景（AI 做所有
  决策）与覆盖率（选房仍手动）诚实分离」是自治分级陈述的社区标杆（ADR-012）。

### 5.6 KasamiBot（kasami/kasamibot + kasami.github.io/kasamibot）

- **基本情况**：Kasami，TS 压缩分发（仓库仅存文档），51★，2018-03 最后推送
  （文档级 CONFIRMED，源码不可考古）。
- **架构**：Manager 驱动（HarassManager/labmanager/spawn-manager）；文档极详尽。
- **决策/经济**：每房独立孵化队列（模块下订单+优先级，spawn 只管执行）；RCL7 起
  miner overfit、hauler 池化省 CPU；remote 上限 6 保留房+SK 房；labmanager 维持
  terminal 内 T3 boost 库存；市场先卖到目标信用额再买缺矿；房间间资源自动调拨；
  proximityscout 每 20000 tick 刷新情报按矿物/source 估值。
- **房间发展**：固定「蝴蝶形」7×7 核心+双翼模板，可适配不规则房间。
- **军事**：harasser 游猎杀贫；boosted wreckerteam（只在 boost 足够时攻 owned
  房）；borderwall+fortresswall 双层墙+safemode 触发+跨房支援；power bank 按站位
  动态配兵（bankrobber/bankhealer/bankranger）。
- **CPU 策略**：hauler 池化与 miner overfit 是显式 CPU 优化；远矿上限 6 房是
  预算驱动规模的雏形。
- **弱点**：压缩分发损害传承；单人项目终止；机制停留在 2018。
- **启示**：蝴蝶模板证明固定几何布局可适配不规则房间（ADR-007）；「只在 boost
  足够时进攻 owned 房」是战争经济核算先例（ADR-009）；per-room 孵化订单+全局
  优先级是 ADR-005 的中间形态（我们选集中唯一写者，弃按房队列——见 25 号 T-05）。

### 5.7 hivemind（Mirroar/hivemind）

- **基本情况**：TS，MIT，**2026-07 仍推送=当前最活跃开源大 bot**，219 文件、
  1796 commits；npm 包 screeps-bot-hivemind；仓库含 mock 目录（测试设施）
  （2026-08-22 抽查复核，CONFIRMED）。
- **架构**：process（33 文件）+ dispatcher（27）+ role（22）+ spawn-role（18）+
  room（17）+ empire（5）+ 少量 operation；根目录 manager.bay/source/military/
  squad、link-network、trade-route、room-intel、player-intel-manager、intershard、
  reclaim-manager。
- **决策/经济**：全闭环——侦察/挖矿/扩张/建造/boost/commodity/power 采集处理/
  power creep（OPERATOR）管理/动态市场交易；孵化由 spawn-role 声明+spawn-manager
  统一执行。
- **军事**：**刻意阉割**——不主动攻击玩家房间、不处理核弹防御（README 明言防
  NCP 泛滥）。
- **CPU 策略**：process/dispatcher 协作调度（轻量进程，非 OS 内核）；bay 结构化
  补给。
- **弱点**：限武使其不能作为进攻参照；生态位偏「和平生存」。
- **启示**：player-intel 持久威胁记忆（跨视野跨 reset）是 14 号情报系统的直接
  先例；settings.local/relations.local 定制层是「发布版与本地配置分离」的工程
  先例；mock 目录证明私服级测试可进主仓库（28 号）；「限武换生态位」是 ADR-009
  授权链的极端形态佐证。

## 6. Advantages（收敛：≥3 家共性清单）

以下设计被 ≥3 家独立实现且与存活/战绩正相关，本套件默认全部采纳（对应 ADR）：

| # | 收敛设计 | 实现者 | ADR |
| --- | --- | --- | --- |
| C1 | 房间/帝国两级分离 | 全部 7 家 | ADR-001 |
| C2 | 孵化与角色解耦的优先级队列 | Overmind hatchery、TI spawning/requests、Quorum spawns、hivemind spawn-role、bonzAI SpawnGroup、KasamiBot 订单（6 家） | ADR-005 |
| C3 | miner|hauler 分工+专职补弹+link 网指向 storage | TI、TooAngel、KasamiBot、hivemind、Overmind（5 家） | ADR-006/12 号 |
| C4 | 房间情报缓存+低频刷新+observer 巡检 | TooAngel、KasamiBot（proximityscout）、Quorum（observer 网）、hivemind（room-intel）（4 家） | 14 号 |
| C5 | terminal 调拨+自动市场（阈值制） | TI、TooAngel、KasamiBot、Quorum、hivemind（5 家） | 12 号 |
| C6 | quad/duo 小队+boost 前置 | TI（antifa）、KasamiBot（wreckerteam）、TooAngel（squad）（3 家进攻向） | ADR-009/16 号 |

另有两条「负收敛」（≥3 家明确不做或做了后悔）：不做每 tick 效用竞拍；不做完整
OS 进程内核（仅 Quorum 全做且停更）。

## 7. Disadvantages（分歧地带：社区没有共识的部分）

| 分歧 | 阵营 A | 阵营 B | 本套件裁决 |
| --- | --- | --- | --- |
| 语言/组织 | TS 静态类（Overmind/TI/bonzAI/hivemind/KasamiBot） | JS 原型补丁（TooAngel/Quorum） | 趋势明显在 TS；原型补丁是可读性/耦合双输（ADR-004 声明式策略） |
| 调度形态 | 显式进程内核（Quorum、hivemind 轻量） | 平铺主循环（TI/KasamiBot/TooAngel/bonzAI） | 战绩最好的进攻型 bot 多在平铺阵营；取语义弃载体（ADR-002；25 号 T-01） |
| 布局 | 固定几何模板（KasamiBot 蝴蝶、Overmind bunker） | 逐房算法生成（bonzAI AutoOperation、Quorum 距离变换；TI neuralNetwork 折中） | 算法阵营全部停更或实验化；模板+适配（ADR-007） |
| 经济组织 | 请求牵引式（TI requests、TooAngel 部分） | 配额式（KasamiBot、hivemind、Quorum） | 混态：高频流动资源请求制、低频战略资源配额（04 号 §5） |
| 军事哲学 | 攻击性（KasamiBot） | 限武（hivemind） | war 授权链+止损链（ADR-009）：有攻击能力但攻击是经济决策 |

## 8. Failure Modes（各 bot 的项目级失败与结构性弱点）

| Bot | 失败/弱点模式 | 性质 | 本套件对策 |
| --- | --- | --- | --- |
| Overmind | 7 层抽象+主题化命名抬高贡献门槛；混淆发布；exploitable | 复杂度税+可审计税 | 层级压缩为 4 层（26 号）；源码全开源可审计；授权链+黑名单防利用 |
| TooAngel | Memory 存整条路径（每 tick 税）；猴子补丁耦合；打一次失败就放弃 | 技术债+战略刚性 | 三级存储（ADR-010）；止损链含黑名单冷却而非永久放弃（ADR-009） |
| TI | 自认意大利面；战斗代码 dysfunctional | 工程债 | 唯一写者+模块边界静态审查（29 号 R-13） |
| Quorum | 进程内核维护成本压垮社区热情，2021 停更 | 架构税→项目死 | 轻量内核（ADR-002）；「内核不产生游戏价值」是首要教训 |
| bonzAI | 愿景（全自治）与实现（选房手动）断层；2017 停更机制旧 | 交付断层 | 验收制路线图（ADR-012）按门槛交付自治 |
| KasamiBot | 压缩分发→知识不可传承；单人终止 | 传承失败 | 本套件全部结论落可审计文档 |
| hivemind | 刻意限武→无进攻数据可供参考 | 生态位取舍 | 军事设计转向社区战例（15/16 号）而非 hivemind 源码 |

## 9. CPU Implications（CPU 策略对比）

| Bot | 核心手段 | 关键机制 | 可迁移度 |
| --- | --- | --- | --- |
| TooAngel | 预算门控 | 三指标指数平滑门控扩张；预计算路径+顺路投递；tick 末 generatePixel | 高（直接采纳，ADR-008/20 号） |
| Overmind | 相位+缓存 | build/refresh 双路径；init 登记请求避免重复扫描；profiler 内置 | 高（ADR-004/005；18 号缓存模式） |
| TI | 摊薄 | request 复核 100–200 tick；low-frequency schedule | 高（04 号分频先例） |
| Quorum | 调度+观测 | QoS 分级；stormtracker 监控服务器 tick 率 | 中（stormtracker 思想进 21 号） |
| KasamiBot | 结构优化 | hauler 池化、miner overfit、remote 上限 6 房 | 中（上限思想=预算驱动规模雏形） |
| hivemind | 轻量进程 | process/dispatcher 按需唤醒 | 中（cadence 语义已并入 19 号） |

**共性**：没有任何一家靠「更聪明的算法」赢 CPU——全部是摊薄频率×缓存复用×
富余度门控三件套（20 号 §5 收敛结论的直接来源）。

## 10. 对我们架构的启示（复杂度裁决：必要 vs 历史遗留）

### 10.1 必要复杂度（问题本质决定，不可省）

1. **两级决策**（帝国/房间）：7/7 收敛，跨房资源与军事必须有仲裁者。
2. **孵化解耦与请求-满足分离**：6 家收敛；没有它，重复孵化与互相抢目标不可避免。
3. **缓存与相位分离**：Memory 税与重复扫描是机制事实，不是设计选择。
4. **授权与止损**：无人值守下「什么不做」比「什么做」更贵（教训 1/5）。
5. **观测面**：无人盯着时的唯一故障发现通道（21 号）。

### 10.2 历史遗留 / 个人趣味（可省）

1. Overmind 的 7 层 OO+星际争霸主题：表达力收益在 30 房以下无法兑现，工具链
   门槛直接劝退贡献者——**抽象层数与战绩负相关的第一证据**。
2. TooAngel 的猴子补丁×30：ES5 时代的遗产，TS 时代无存在理由。
3. Quorum 的 OS 内核：抢占在单线程 tick 不存在，进程抽象是纯结构税。
4. KasamiBot 的按房 spawn 队列：单房自足视角的产物，多房时代被集中唯一写者取代。
5. bonzAI 的 40 Mission 类全事件化：Mission 粒度过细（对应本套件：Agenda 只装
   中期承诺，tick 内走确定性系统推导）。

### 10.3 裁决：Overmind 深度 vs TooAngel 平铺的本质权衡

- **Overmind 选择**：用抽象深度换「加功能的局部性」（新行为=挂新 Directive/
  Overlord，不动存量）——代价是理解成本、实例化成本、贡献门槛。
- **TooAngel 选择**：用平铺换「理解与修改的全局可达性」——代价是每处修改都要
  人脑维护全局一致性，十年靠单人纪律支撑，不可团队复制。
- **本套件取中且偏平**：4 层（Kernel/Systems/Room/Execution，26 号 §2）+
  唯一组合根——新系统=注册不改内核（Overmind 的局部性），但层级深度封顶、
  命名去主题化（TooAngel 的可读性）。裁决记录：ADR-002/004；张力分析见
  [25_ARCHITECTURAL_TRADEOFFS.md](25_ARCHITECTURAL_TRADEOFFS.md) T-01/T-04。

## 11. Alternatives Rejected（谱系路线否决）

| 路线 | 否决理由 |
| --- | --- |
| 完整复刻 Overmind 分层 OO | 抽象深度在 <30 房规模无收益；TS 工具链+主题命名是贡献税；作者本人低频维护即弃 |
| 复刻 TooAngel 平铺 | 平铺的存活依赖单人纪律；猴子补丁与 Memory 路径债不可继承；其机制（门控/trapped/pixel）已剥离采纳 |
| 复刻 Quorum OS 内核 | 维护成本压垮社区热情的实证；抢占/进程语义在单线程 tick 是税（ADR-002） |
| 复刻 TI 请求经纪全量 | 请求制正确但 TI 自认意大利面；我们取 requests 语义+ abandon 冷却，载体换唯一写者系统 |
| bonzAI 全 Mission 化 | 40 Mission 类粒度过细；Agenda 只承载中期承诺（07 号裁决） |
| KasamiBot 按房自治队列 | 多房协调弱；集中唯一写者信息更全（ADR-005）；其模板/军事核算思想已吸收 |

## 12. Open Questions

1. Overmind 的 evolutionChamber/lab 管理细节未读到源码——boost 生产链设计以
   引擎常量核算为准（03 号 §7），不受此缺口影响但先例证据弱一格（LIKELY）。
2. TI 的 neuralNetwork 交通流道路质量无长期数据——我们采「热度逐段铺路」的
   保守形态（ADR-007），是否升级为学习式待 P4 数据。
3. KasamiBot 源码不可考古，其文档声明无法源码复核——凡引 KasamiBot 处均标
   文档级 CONFIRMED，架构裁决不单独依赖它。
4. hivemind 限武形态在强敌环境（A4 后）是否够用——无先例数据，需实测。

## 13. Evidence / Sources

| URL / 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://github.com/bencbartlett/Overmind（+ wiki、bencbartlett.com 博客系列、2026-08-22 抽查复核） | 源码 | 分层 OO 八级结构、请求-满足、build/refresh、bunker、混淆发布、617★/157/605、v0.5.2 | CONFIRMED |
| https://github.com/TooAngel/screeps + http://tooangel.github.io/screeps/doc/Design.html | 源码/文档 | 平铺 90 文件、声誉三级、trapped、三指标 EMA、道路沿实测路径、Memory 路径债、十年无人值守 | CONFIRMED |
| https://github.com/The-International-Screeps-Bot/The-International-Open-Source | 源码 | Collective+room 双层、requests.ts 经纪制、fastFiller、customPathFinder、neuralNetwork 道路、GCL 18.2 亿、dysfunctional 自评 | CONFIRMED |
| https://github.com/ScreepsQuorum/screeps-quorum（+ Reddit 710p9n、gitconsensus.com、quorum.tedivm.com） | 源码/社区 | OS 内核 qos/programs、GitConsensus 自我管理、CI 自动部署、GCL 45.2 亿、2021 停更 | CONFIRMED |
| https://github.com/bonzaiferroni/bonzAI | 源码 | Operation–Mission 两级+40 Mission+Guru；AutoOperation 选址；2017-11 停更 | CONFIRMED |
| https://github.com/kasami/kasamibot + https://kasami.github.io/kasamibot/ | 文档 | 蝴蝶模板、按房队列、RCL7 overfit、remote≤6、T3 库存、harasser/wreckerteam、Reddit 8pbrfv 评价 | CONFIRMED（文档级） |
| https://github.com/Mirroar/hivemind（2026-08-22 抽查复核） | 源码 | process/dispatcher、spawn-role/spawn-manager、player-intel、intershard、刻意限武、2026-07 活跃、mock 目录 | CONFIRMED |
| Reddit cm5o0w / 8pbrfv | 社区 | Overmind exploitable 评；KasamiBot 攻击性评、TooAngel 不纠缠评 | CONFIRMED |
| Scribd 聚合索引 | 二手 | 六大经典名单（含 tiggabot） | LIKELY |
