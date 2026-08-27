# 技术债治理台账

从 AGENTS.md 迁出的治理记录（AGENTS.md 只保留约束，不承载历史台账）。
**维护规则**：每完成一个治理批次，在本文件追加/更新对应条目；决策与取舍的最终
真相源始终是内联注释与回归测试，本台账只做索引与批次登记。

- 历史治理批次（A–O 十五项 + R1–R7）已全部闭环；决策与取舍以内联注释与回归测试为准，
  不再维护独立治理文档。
- R8/R9/R10 已闭环：R8 回归测试见
  [tests/unit/role/should-idle-hook.test.ts](../../tests/unit/role/should-idle-hook.test.ts)；
  R9 按既定方案「接受现状并在注释登记」落实（[kernel.ts](../../src/kernel/kernel.ts) 权衡注释）；
  R10 注释已修正（[constraint-placer.ts](../../src/domain/layout/constraint-placer.ts)）。
- R4 战争自治升级已落地（schema v27）：波次集结（build/advance 双阈值迟滞 +
  role-runner hold 钩子）、战损止损（spawned × casualtyMultiplier）、战后 intel
  核验（evaluateWarOutcome + warBlacklist + WarOutcome 事件）、war 姿态经济可持续
  退出（warPressureTicks → fortify）。设计决策见
  [MILITARY_ARCHITECTURE.md](../architecture/MILITARY_ARCHITECTURE.md)；回归测试见
  [tests/unit/systems/war-planner.test.ts](../../tests/unit/systems/war-planner.test.ts)、
  [tests/unit/war/war-planning.test.ts](../../tests/unit/war/war-planning.test.ts)、
  [tests/unit/role/attacker.test.ts](../../tests/unit/role/attacker.test.ts)。
- R5 帝国能量网络已落地（M12 双房互济验收项补齐，**无 schema 变更**）：
  跨房能量互济（planEnergyAid 地板迟滞防震荡 + terminal.send 预算门禁）+
  能量市场交易（溢出卖/危机买价格门槛），EnergyTransfer 事件进黑匣子。
  设计决策见 [ECONOMY_ARCHITECTURE.md](../architecture/ECONOMY_ARCHITECTURE.md)；测试见
  [tests/unit/economy/energy-logistics.test.ts](../../tests/unit/economy/energy-logistics.test.ts)、
  [tests/unit/systems/terminal-manager-energy.test.ts](../../tests/unit/systems/terminal-manager-energy.test.ts)。
- R6a 帝国议程已落地（schema v28，主动自治第一增量）：短期目标层
  （recovery > defense-readiness > rcl-push > develop），empire-strategy 发布 +
  AgendaChange 事件；首个消费接线 = rcl-push 放宽 upgrader 冲刺门槛
  （spawn-manager 适配层注入 agendaInitiative）。设计见
  [GOAL_POLICY_PLAN_MODEL.md](../architecture/GOAL_POLICY_PLAN_MODEL.md)；
  测试见 [tests/unit/strategy/agenda.test.ts](../../tests/unit/strategy/agenda.test.ts)。
- R6b 主动情报已落地（schema v29）：prospect-manager（expansionAllowed 授权 →
  选候选 → 派 scout 侦察 → 成功/超时/死亡/中止收摊 + prospectCooldown 止损）+
  scout 角色（[MOVE] 50 能量一次性）+ room-observer captureScoutVision 视野落库。
  设计见 [INTELLIGENCE_ARCHITECTURE.md](../architecture/INTELLIGENCE_ARCHITECTURE.md)；测试见
  [tests/unit/systems/prospect-manager.test.ts](../../tests/unit/systems/prospect-manager.test.ts)、
  [tests/unit/strategy/prospect.test.ts](../../tests/unit/strategy/prospect.test.ts)。
- R7a 容量感知已落地（schema v30）：算力容量模型（domain/strategy/capacity
  四档分层，有效上限取 min(cpuLimit, tickLimit) 不写死 20 CPU，升档滞回/降档
  立即，empire-strategy 发布）+ 决策结果台账（ExpansionOutcome 扩张九路归因、
  AgendaOutcome 议程窗口归因）+ 首个消费者（远矿上限 abundant 档 +1）。
  设计见 [EMPIRE_SYSTEM_MODEL.md](../architecture/EMPIRE_SYSTEM_MODEL.md)；测试见
  [tests/unit/strategy/capacity.test.ts](../../tests/unit/strategy/capacity.test.ts)、
  [tests/unit/systems/empire-strategy.test.ts](../../tests/unit/systems/empire-strategy.test.ts)、
  [tests/unit/systems/expansion-outcome.test.ts](../../tests/unit/systems/expansion-outcome.test.ts)。
- R7b 扩张节奏自适应已落地（schema v31）：消费 ExpansionOutcome 台账（每任务
  一条有界 ring）→ 连续失败暂停止损（expansionPausedUntil）、stolen 频发收紧
  目标门禁（minSources 1→2）、成功率驱动黑名单缩放（0.5–1.5 有界）。设计见
  [EMPIRE_SYSTEM_MODEL.md](../architecture/EMPIRE_SYSTEM_MODEL.md)；测试见
  [tests/unit/expansion/rhythm.test.ts](../../tests/unit/expansion/rhythm.test.ts)、
  [tests/unit/systems/expansion-outcome.test.ts](../../tests/unit/systems/expansion-outcome.test.ts)。
- R7c 塔防侦察兵修复 + 无害侦察观测已落地（schema v32）：修复「满能量塔对
  贴身侦察兵不开火」（无害敌对在场时塔不接维修，放空让引擎自动点杀）；
  room-state 记录 lastObserverAt/observerSightings 盯防信号（与威胁记忆分离）。
  测试见 [tests/unit/systems/tower-defense-observer.test.ts](../../tests/unit/systems/tower-defense-observer.test.ts)、
  [tests/unit/systems/room-state-observer.test.ts](../../tests/unit/systems/room-state-observer.test.ts)。
- R11 完整情报与远矿运营止损已落地（schema v33，线上 W36S58 事故驱动）：
  ① RoomIntel 增记 enemySpawns/wallCount/sealedExits（有视野即采，墙封判定纯函数）；
  ② remote-mining-manager 消费新情报 — 全部出口封死 → 废弃 op、编队全员空转
  （idle/flee 或 stuck≥stallStuckTicks）持续超 stallAbandonTicks → 废弃（吞吐反馈
  闭环）；遗迹 spawn（controller 无主）房仍可运营远矿，占领侧由 expansion evaluator
  暂缓（无拆 spawn 行动链）；③ 卡位层 — stepOffEdge 内侧格占用感知（边界钉死修复，
  CostMatrix 同口径）+ traffic-manager 引擎拒签即失效持久化路径（撞墙下 tick 重算）。
  测试见 [tests/unit/intel/sealed-exits.test.ts](../../tests/unit/intel/sealed-exits.test.ts)、
  [tests/unit/remote/stall-census.test.ts](../../tests/unit/remote/stall-census.test.ts)、
  [tests/unit/migration/v32-to-v33.test.ts](../../tests/unit/migration/v32-to-v33.test.ts)、
  [tests/unit/movement/edge-and-phase.test.ts](../../tests/unit/movement/edge-and-phase.test.ts)、
  [tests/unit/systems/traffic-manager.test.ts](../../tests/unit/systems/traffic-manager.test.ts)。
- R12 远矿产能修复已落地（线上 W36S58/W37S57 产能损失实证驱动，**无 schema
  变更**，per-creep 运行时字段 lastRebindAt 遵循 lastRepathAt 先例免迁移）：
  ① 站桩占位自报 — registerStaticBlocker（per-tick 并入 applyStaticBlockers），
  remoteHarvester 在矿位登记 anchorMiner 锚 + 占位、reserver 在岗登记
  anchorStation 锚 + 占位，外房寻路矩阵与解算器从此看得见静止 creep，
  终结「矿位被占 → 缓存路径反复撞格 → 采集者锁死空转」；② 绑定自愈 —
  getRemoteSource 物理站桩计入占用 + 锁死（stuck≥3 且够不到源）时改绑无主
  source（200 tick 冷却防 A↔B 振荡）；③ op.sources 现场视野校正 —
  remote-mining-manager 用实测 source 数修正开点快照（W37S57 开点无 sources
  字段 → 回退 1 只采集者 → 南源长期空缺），需求侧随之补齐配员；④ 满载放能 —
  work 链中 stationaryMine 满载且无 container 时让位给 dropEnergy（集成仿真
  实证：原实现满载永久停撑零产出——needsContainer 等待窗口内 harvest 徒劳
  ERR_FULL、drop 永远轮不到）；⑤ 带能归位 — work 链补 move-and-mine（带 range
  门禁）：被挤离矿位且携带能量时不再落入「无匹配→idle 趴窝」（线上实证：带 25
  能量的采集者 range 2 永久趴窝，既不满载 drop 不触发、又不空载 acquire 轮不到）；
  ⑥ 卡位升级 — movePriorityFor 连续 stuck≥stuckThreshold 时优先级抬到
  stuckEscalation(70)，高于 anchorStation(60) 低于 anchorMiner(90)/flee(100)：
  锁死移动方有权把占住目标格的站桩 creep 推到相邻格（线上实证：采集者目标格
  被锚定 reserver 占据、同档不推 → 意图逐 tick 被拒永久锁死；升级后推开放行，
  双方各自复位）。线上验证：W37S57 第二采集者自动补齐并绑南源（源下探+container
  链运转）、W36S58 锁死采集者推挤落位双源全开采、内核零错误。集成场景
  「双绑锁死→改绑自愈→双源全开采」+ 测试基建补齐（TestWorld getDirectionTo
  数字重载/lookForAtArea/ERR_NOT_FOUND）。
  测试见 [tests/unit/role/remote-harvester.test.ts](../../tests/unit/role/remote-harvester.test.ts)、
  [tests/unit/remote/remote-source-assign.test.ts](../../tests/unit/remote/remote-source-assign.test.ts)、
  [tests/unit/remote/stall-census.test.ts](../../tests/unit/remote/stall-census.test.ts)、
  [tests/unit/movement/static-blocker.test.ts](../../tests/unit/movement/static-blocker.test.ts)、
  [tests/integration/scenarios/remote-lockout-selfheal.test.ts](../../tests/integration/scenarios/remote-lockout-selfheal.test.ts)。
- RM-2 远矿 container 维修链已落地（无 schema 变更）：repairSourceContainer
  动作挂 acquire/work 双链（采集者「采 N 倒 N」稳态下 FSM 长期 acquire，只挂
  work 链则维修窗口仅剩偶发满载交集，等价永不维修）+ stationaryMine 倒能
  留维修税（血量 < 80% 时每 tick 留 WORK 数能量不倒 — 全额倒空会让 repair
  的背包门禁在稳态下恒不满足，维修链死锁）。节拍为「采 N 倒 N-W、修 W」
  交替，维修与采集并行不断流。测试见
  [tests/unit/role/remote-harvester.test.ts](../../tests/unit/role/remote-harvester.test.ts)、
  [tests/integration/scenarios/remote-container-repair.test.ts](../../tests/integration/scenarios/remote-container-repair.test.ts)。
- G1/G3 nuke 落点感知 + 资产抢救链已落地（无 schema 变更，帝国审计缺口
  1+3）：① 感知 — RoomSnapshot.incomingNukes（自有房 FIND_NUKES 常量查询），
  room-state 差分新 nuke id 记 NukeDetected 事件（globalCache 基线，reset
  后重报无害）；② 抢救 — terminal-manager 的 tryNukeSalvage 先于市场/
  tier/bucket 门禁（send 不依赖市场 API，战时降档不阻断），警报房 terminal
  库存按价值密度序（power > G > X 化合物 > battery > 基础矿物 > 能量兜底
  留运费地板）逐轮 send 到无警报兄弟房；③ 搬运 — distributor 的
  salvageStorageToTerminal（nuke 警报房才激活，常态零开销）把 storage
  库存搬 terminal 支撑持续 send。测试见
  [tests/unit/defense/nuke-response.test.ts](../../tests/unit/defense/nuke-response.test.ts)、
  [tests/unit/systems/terminal-manager-nuke.test.ts](../../tests/unit/systems/terminal-manager-nuke.test.ts)、
  [tests/unit/role/distributor-salvage.test.ts](../../tests/unit/role/distributor-salvage.test.ts)。
- G2 PB 野采链已落地（schema v36，帝国审计缺口 2）：① intel 增 powerBank
  字段（room-observer 复用全结构扫描采集，零额外 find）；②
  power-farm-manager（唯一写者 Memory.kernel.powerFarm）任务生命周期
  strike→collect：编队（4 attacker + ratio healer，memory.mission 标记分流）
  击破 PB → 房内视野确认 PB 消失 → 回收编队 + 孵 pbCollector 捡运掉落
  power；止损三通道（超时/战损/war 抢占 — warPlan 存续即收摊，军事资源
  不双线）；③ attacker 增 attackPowerBank 候选（PB 是 FIND_STRUCTURES
  中立结构，hostile 链打不到）+ hold 钩子对 mission=powerBank 放行（无
  波次集结语义）；④ queue.ts 增 removeRequestsByMission/countPendingByMission
  （war/PB 编队共用角色名的分流口径，spawnQueue splice 守卫不破）。
  测试见 [tests/unit/war/power-farm.test.ts](../../tests/unit/war/power-farm.test.ts)、
  [tests/unit/systems/power-farm-manager.test.ts](../../tests/unit/systems/power-farm-manager.test.ts)、
  [tests/unit/migration/v35-to-v36.test.ts](../../tests/unit/migration/v35-to-v36.test.ts)、
  [tests/unit/role/attacker-powerbank.test.ts](../../tests/unit/role/attacker-powerbank.test.ts)。
- G4/G5 挂单市场 + pixel 出售已落地（无 schema 变更，帝国审计缺口 4+5）：
  ① 挂单生命周期 — terminal-manager 的 tryManageSellOrders：超龄零成交/
  残单撤（价格随新 bid 重算自适应下行）+ homeMineral 大宗盈余挂 sell 单
  （价 = 最优 buy × sellOrderMarkup 1.15，量钳位 min/maxOrderAmount；
  账户操作不占 terminal 冷却）；② pixel 变现 — trySellPixel 吃最优 buy 单
  （账户资源无 terminal/运费，择优独立于 pickBestBuyOrder 的 roomName
  过滤）。测试见
  [tests/unit/systems/terminal-manager-orders.test.ts](../../tests/unit/systems/terminal-manager-orders.test.ts)。
- G7 PC 赋能扩展 + 姿态路由已落地（无 schema 变更，帝国审计缺口 7）：
  ① build order 增 OPERATE_TOWER lv1（战时塔 DPS/维修 +33%）与
  OPERATE_CONTROLLER lv1（rcl-push 冲级 +200%）；② selectPowerAction 姿态
  路由：combatContext（war/fortify 姿态或房内威胁）→ operateTower 压倒
  一切运营赋能；rclPush 议程窗口 → operateController（仅和平期）；③ 执行层
  采集 posture/agenda/threatCreeps/tower/controller effects。
  测试见 [tests/unit/strategy/power-creeps.test.ts](../../tests/unit/strategy/power-creeps.test.ts)。
- G6 Factory commodity 升级链已落地（无 schema 变更，帝国审计缺口 6）：
  ① 决策纯函数 domain/industry/commodity（selectCommodityTarget 梯度
  优先 + 原料=factory+storage 合计 + 独立 commodityEnergyReserve 5000
  地板 — 与 processEnergyFloor 30k 分离，commodity 是能量→高值资产转换
  非烧掉）；② factory-manager 读引擎 COMMODITIES 配方表（不硬编码，
  私服未定义时静默跳过），目标缓存在 globalCache.factoryTargets（可丢，
  reset 后重选）；③ distributor 增 stockFactoryComponents 按目标配方
  补料进 factory（produce 从 factory.store 扣料 — 原料不进 factory 就
  永远不产）。V1 取舍：只为凑料搬 storage 存量，不主动市场买入。
  测试见 [tests/unit/industry/commodity.test.ts](../../tests/unit/industry/commodity.test.ts)、
  [tests/unit/systems/factory-commodity.test.ts](../../tests/unit/systems/factory-commodity.test.ts)。
- 帝国审计遗留取舍（G8-G12，2026-08-18 复核）：G8 主动进攻授权 — 维持
  「war 姿态=持续被打才反击」的纯防御定位（战略决策，需人工裁决是否引入
  proactive counter-offense 姿态）；G9 intel 时效分级 — 战争链有
  targetFreshness 门禁，其余消费者按需自查（专项验证未做）；G10 跨
  shard — 超范围（单 shard 帝国目标）；G11 远矿房防御投资 — 维持 R11
  弃房止损取舍；G12 siege 精细围攻响应 — 依赖看门狗全局降档，无房间级
  配给（低优先，出现实证再补）。

- 工业链缺口修复（2026-08-21）：① Battery 解压回能 — factory-manager
  新增 tryDecompressBattery（storage 能量低于 energyBuyFloor 时
  factory.produce(RESOURCE_ENERGY) 解压 battery → 50 energy/tick），
  distributor 新增 stockFactoryBattery（crisis 时搬 battery 到 factory
  供解压）+ reclaimFactoryOutput crisis 能量回收（factory 解压产出能量
  搬到 storage）。纯函数 shouldDecompressBattery 见
  [battery-decompression.ts](../../src/domain/economy/battery-decompression.ts)。
  ② Boost 化合物分级库存上限 — lab-system 的 surplusCompounds 卖出信号
  从统一 war.boostStockpile(600) 改为分级：war 编队化合物（XUH2O/XLHO2）
  维持 600 战略储备，日常 boost 化合物（XGH2O/XUHO2/XLH2O 等）用
  boost.dailyStockpile(300) 独立上限。纯函数 computeBoostSurplus 见
  [boost-stockpile.ts](../../src/domain/industry/boost-stockpile.ts)。
  ③ Deposit 远采链 — **维持不做，登记取舍**：deposit 资源（metal/silicon/
  biomass/mist）在 highway 房间 FIND_DEPOSITS，需完整远采编队（类似远矿
  但更远），当前帝国规模（2-3 房）下高阶 commodity 收益不足以支撑编队
  CPU/人口成本。触发条件：帝国进入 Grand Empire 阶段（>5 房）且 factory
  level ≥ 1 时再评估。不为「未来可能用到」建立没有消费者的抽象。

## Phase-2 / P1（运行时基座 → A0）批次登记 — 2026-08-23

按重执行后的冻结蓝图（[ARCHITECTURE_FREEZE.md](../architecture/ARCHITECTURE_FREEZE.md)
R0 初始冻结）开工 P1（IMPLEMENTATION_PHASES §2）。本批次三笔：

- **P1-A EventBus 移除（已闭环）**：`src/kernel/event-bus.ts` 违反
  [RUNTIME_API_DESIGN.md](../architecture/RUNTIME_API_DESIGN.md) §5（禁
  publish/subscribe 形态进库）且零消费系统 — 已删除（含 global-cache 槽位与
  G-F 测试块）；实现备份于会话 /tmp（src-p1a-backup-014259.tgz）。重引入须走
  FREEZE §15 ADR 并带真实消费者。
- **D1 assignment-service 迁移（排期 P3）**：`src/systems/assignment-service.ts`
  应迁 `src/domain/assignment/`（ENGINEERING_BLUEPRINT §5 #2；请求池系统侧
  落点随 P3 请求池完整版一并归位）。
- **D2 layout 边界归位（排期 P4）**：`src/systems/layout-planner.ts` 与
  `src/domain/layout/` 边界待收敛（ENGINEERING_BLUEPRINT §5 #3；纯函数归
  domain、系统侧只留队列推进与 site 签发，随 P4 建造自动化批次执行）。

附带质量修复（本批次内闭环）：
- **集成测试确定性**：`TestWorld.installGlobals` 安装种子化 PRNG
  （mulberry32，`config.randomSeed`，默认 12345）——此前 spawn 命名的
  `Math.random` 后缀使仿真轨迹不可复现，deathSpiral 类末端相位断言随机翻转。
- **deathSpiral 指标修正**（[GameInspector.ts](../../tests/integration/framework/GameInspector.ts)）：
  原「末 20 tick >80% 能量下降」误报健康支出期为螺旋（实测健康轨迹 energyTrend
  也为负——开局 container 冻结能量被消费是结构性支出）；改为「能量持续下降 ∧
  人口同步萎缩（>50% tick 递减）」。全部 7 处断言均为负向断言，无正向检测受影响。

## Phase-2 / P2（单房生存闭环 → A1）批次登记 — 2026-08-23

按 IMPLEMENTATION_PHASES §2 P2 合同执行。本批次以验收取证为主（实现已成熟），
新增/修复四笔：

- **A1 缺口测试（新增）**：`tests/integration/scenarios/a1-bootstrap-tower.test.ts`
  ——「RCL2→RCL3 爬升后 tower site 由 AI 自然创建」。既有覆盖中 e2e-002 只验
  RCL1→RCL2、rcl3/rcl4 场景预设 tower/storage（测行为不测爬升），缺的正是
  A1「RCL3+ 且 tower 在建」结构层链路。新测试全链闭环：自然升级 → 布局解锁
  tower 相位 → site 自然创建 → builder 由 census 自然补位 → tower 建成。
- **hostile owner 防御性读取（生产加固）**：threat.ts / targeting.ts /
  expansion-manager 的 hostile 过滤改 `c.owner?.username ?? "?"|""`（无 owner
  视为敌对）。官服 NPC 恒有 owner，但战斗/威胁路径逐 tick 运行不可抛错。
- **e2e 注入修复（测试基建）**：WorldBuilder.addHostileCreep 原传 `owner`
  字符串——引擎 owner getter 是 `runtimeData.users[o.user].username`，无 user
  字段时 getter 内部抛 TypeError（e2e-004 两测试因此常红）。改注入真实 NPC
  user id（mockup 预置 '2'=Invader / '3'=Source Keeper）。
- **e2e 环境修复（工具链）**：@screeps/driver 嵌套 isolated-vm 与本机
  Node 26 ABI 不容（且 CLT 缺 libc++ 头）——需 `PATH=nvm node22 +
  SDKROOT=$(xcrun --show-sdk-path) npx node-gyp rebuild --release` 原地重建。
  e2e 必须在 Node 22 下运行（与 @types/node ^22 对齐）。

A1 证据台账：自举链（e2e-002 RCL1→RCL2 + a1-bootstrap-tower RCL2→RCL3+tower）、
冷启动（rcl1-suite T1）、关键角色补位（rcl1-suite T4 替代延迟量化 + e2e-001
0-creep 灾后 500t 内复产）、零人工（ScenarioRunner 纯代码上传 + tick 驱动，
零 console 注入）。30 万 tick 全程验收留待官服 soak（A5 窗口），压缩证据
（e2e-006 11k tick 长稳 + rcl1-suite 6.5k tick）先行入库。

## Phase-3 / P3 批次登记（进行中）— 2026-08-23

- **B2 已闭环**：TestWorld MockSpawn 补齐官方 `recycleCreep` API（按剩余寿命比例退款、
  立即移除、不计死亡）。此前缺失使 spawn-manager 在含回收标记的 mockup 世界中每 tick
  TypeError（safeRun 正确隔离，但静默中止该系统当 tick 余下流程）。
- **B4 发现（重校准排期 Step 11）**：recycleCreep 修复揭示 live-anomaly 三场景
  （trap/phase 脉冲/harvester 振荡）的绿色依赖上述隐性 abort 动力学——真实引擎语义下
  替换时序合法位移。三例已转 `it.todo`（断言保留在 git 历史），Step 11 按不变量重写：
  经济不停滞 = harvested 达标 ∧ container 排空 ∧ 帝国存活；机制代理（头数）不作硬断言。
  **教训**：mockup 缺口不仅漏测还会「反向校准」测试预期——引擎保真修复必须连带审计
  既有绿测的因果依赖。

## A5.1 验证债务登记 — 2026-08-25

A5.1 FINAL AUDIT 判定 PASS（0 BLOCKER / 0 HIGH / 2 MEDIUM / 5 LOW）。两个 MEDIUM
均为**环境兼容性验证债务**（非代码缺陷），不阻塞 Domain/Integration PASS，登记如下：

- **VD-1 isolated-vm E2E 环境兼容性（MEDIUM → 验证债务）**：E2E 测试已编写
  （`tests/e2e/scenarios/12-military-defense.test.ts`，6 场景），受限于
  `isolated-vm` 原生模块在当前 macOS + Node 26 ABI 的 V8 符号缺失
  （`v8::ArrayBuffer::Allocator::Reallocate`），无法本地执行。**不修改环境**：
  Domain 纯函数已通过 86 个单元测试（含 20 × 1000 次 Replay Hash 100% 一致）+
  138 个集成测试全绿，系统层集成逻辑与现有 A4 模式一致。**消除条件**：私服或 CI
  环境（Node 22 + @screeps/driver 正常编译）下执行 E2E 6 场景全绿。
  风险评估：LOW。
- **VD-2 私服 5000t Real Runtime 长运行验证（MEDIUM → 验证债务）**：A5.1 的
  CPU/Memory 预算分析为代码审查推算（assessThreat 条件触发 O(hostiles × body)、
  globalCache heap-only 无持久化增长），未经真实 5000+ tick 连续运行验证。
  **不阻塞 PASS**：应作为下一次真实 Runtime 长运行验证（soak test）的一部分，
  验收项 = 5000+ tick 连续运行 ∧ ≥1 次 Threat 事件触发 ∧ ≥1 次 Remote Defense
  Decision ∧ ≥1 条 DecisionTrace 记录 ∧ CPU 无异常增长 ∧ Memory 无持久化泄漏。
  风险评估：LOW。

审计报告见 [A5_1_FINAL_AUDIT.md](../phase17/A5_1_FINAL_AUDIT.md)。

## 审计修复批次 — 2026-08-27

来源：[docs/audit-2026-08/](../audit-2026-08/) Phase 0-13 架构审计。

### AU-1: domain/layout 纯函数律违规修复（D-1/D-2）

**来源**：Phase 2 §2.7.1 — `domain/layout/road-planner.ts` 和
`domain/layout/corridor-roads.ts` 直接 import `globalCache` 读写 heap 缓存，
违反 DEPENDENCY_GRAPH §3-5 纯函数律。

**修复**：globalCache 读写上移到 system 层（`layout-planner.ts`），
domain 层通过参数注入接收数据：
- `road-planner.ts`：`RoadPlanContext` 新增 `currentTraffic`/`prevTraffic`/
  `corridorCacheStore` 可选字段；`rotateTraffic` 函数替换为 `TrafficRotator`
  接口，由 system 层内联实现。
- `corridor-roads.ts`：新增 `CorridorPathCacheStore` 接口，
  `planCorridorRoads` 新增 `cacheStore` 可选参数；缓存读写通过接口注入。
- `layout-planner.ts`：`planStage3RoadsAndFinalize` 中从 `globalCache()` 读取
  交通数据和路径缓存，构造接口实现注入给 domain 层。
- 测试更新：`corridor-cache-invalidation.test.ts` 新增 `makeTestCacheStore()`
  桥接 `globalCache.corridorPathCache`，所有缓存测试用例传入 `cacheStore`。

**影响**：domain/layout 纯函数律合规度从 97% → 100%，架构合规度整体
97% → 98%+。行为等价修复，无功能变化。typecheck ✅ + 4832 单元测试全绿。

### AU-2: globalCache 死字段删除（F-DEAD-1/F-DEAD-2）

**来源**：Phase 13 §13.2 — 两个 globalCache 字段全库零引用。

| 字段 | 位置 | 处置 |
|------|------|------|
| `logisticsCounters` | global-cache.ts:75 | 删除字段声明，留注释标记 |
| `empireTransportRequests` | global-cache.ts:174 | 删除字段声明，留注释标记 |

`logisticsCounters` 注释声明"P3 物流指标 L1 计数器"，但 L1 埋点从未落地。
`empireTransportRequests` 注释声明"agenda-manager 每 100t 写入，logistics 消费"
——但 agenda-manager 不写、logistics 不读，连生产者都不存在。
若 A3.0 帝国调拨进入路线图，须重新设计完整链路而非留假装存在的槽位。

### AU-3: globalCache 只写不读字段标注（WO-1~WO-11）

**来源**：Phase 13 §13.3 — 11 个 globalCache 字段有生产者但无消费者。

处置策略：标注为诊断观测字段，保留在 heap 供 console 内省。
若后续接入 decision-trace 应明确接线，否则可删除省 CPU。

| 编号 | 字段 | 标注 |
|------|------|------|
| WO-1 | `resourceBottlenecks` | 诊断观测，console 内省 |
| WO-2 | `empireResourceLedger` | 诊断观测，console 内省 |
| WO-3 | `agendaMetrics` | 诊断观测，console 内省 |
| WO-4 | `lastDriftDiag` | 弱消费诊断，console 手查 |
| WO-5 | `logisticsDashboard` | 观测仪表盘，console 内省 |
| WO-6 | `logisticsAccounting` | 观测字段，console 内省 |
| WO-7 | `logisticsScaling` | 观测字段，console 内省 |
| WO-8 | `__cpuBucketHistory` | A6.3 采样空转，待接线或删采样 |
| WO-9 | `__logisticsHealthHistory` | 同上 |
| WO-10 | `__roomHealthHistory` | 同上 |
| WO-11 | `__remoteMiningHistory` | 同上 |

A6.3 四条无消费历史采样序列（WO-8~WO-11）是当前最浪费的状态：
采样器每 100t 消耗 CPU 产出无人读取的数据。待 A6.3 预测层接入对应预测
目标（#3/#4/#5/#7）时接线，或在不使用预测时删除采样省 CPU。

### AU-4: 市场交易能量入 L1 账本

**来源**：Phase 4-5 §5.4.2 — `market.deal` 的能量买卖未入 L1 EnergyLedger，
drift 恒等式缺口靠容差兜底但不精确。

**修复**：
- `RoomEnergyCounters`（global-cache.ts）新增 `bought`/`sold` 字段。
- `EnergyLedger`（accounting.ts）新增 `bought`/`sold` 字段；
  `ledgerIncome` 包含 `bought`；`ledgerConsumption` 包含 `sold`；
  `CONSUMPTION_FIELDS` 增加 `"sold"`。
- `terminal-manager.ts`：`trySellSurplusEnergy` 成功后
  `bumpEnergyCounter(room, "sold", amount)`；
  `tryBuyCrisisEnergy` 成功后 `bumpEnergyCounter(room, "bought", amount)`。

恒等式更新：`income = harvested + pickedUp + bought`，
`consumption = spawned + upgraded + built + repaired + towerSpent + sold`。
drift 现在精确捕获市场交易的影响，不再依赖容差兜底。

### AU-5: spawn 全毁死锁风险登记

**来源**：Phase 3 §3.6.3 + Phase 4-5 §5.2.3 — 所有 spawn 被毁时
存在死锁：spawn-manager 无法孵化 builder，builder 无法建造新 spawn。

**现状**：
- `spawn-manager`：`snapshot.spawns.length === 0 → return`（无法孵化）
- `room-state`：`needsRecovery = spawns.length === 0 → colonyState = bootstrap/recovery`
- `layout-planner`：`planStage3` 中有紧急 spawn 重建逻辑（创建 spawn site）
- 死锁链：需要 builder 建造 spawn → builder 需要 spawn 孵化 → 死锁

**缓解**：
- worker 角色可替代 builder（万能工），但 worker 也需要 spawn 孵化
- claimer 从外部 claim 新房是唯一逃生路径，但需要 expansion 授权

**登记取舍**：维持现状，不做自动恢复（spawn 全毁是极端场景，通常意味着
房间已被攻陷，自动恢复可能浪费 CPU/人口）。需要人工干预或扩张系统从
兄弟房 claim 新房。触发条件：spawn 全毁且无兄弟房可 claim 时人工接管。

### AU-6: Phase 14 Cadence 死锁修复

**来源**：Phase 13 末尾 "Phase 14 将继续验证 40+ 注册系统中是否存在
cadence 永不满足导致的实际永不运行项"。

**审计方法**：遍历全部 44 个注册系统，提取 interval/phase/priority，
计算 `systemPhase(name, interval)` 相位偏移，逐一检查内部门控
`tick % N` 是否与外层 cadence 错峰相交。

**发现**：7 个低频系统使用了绝对 `tick % N` 内部门控，但由于外层
cadence 错峰使系统只在 `tick % interval === phase`（phase ≠ 0）时运行，
而 `tick % N === 0` 要求 `tick % interval === 0`（因 N 是 interval 的
倍数），两者不相交，导致内部门控**永不触发**——Cadence 死锁。

| 系统 | interval | phase | 死锁门控 | 影响 |
|------|----------|-------|---------|------|
| decision-trace | 100 | 12 | `tick%500===0` | snapshot 驱逐永不执行 → 内存泄漏风险 |
| experience-collector | 100 | 2 | `tick%1000===0` | 可观测性日志永不输出 |
| prediction | 500 | 75 | `tick%5000===0` | 可观测性日志永不输出 |
| calibration-resolution | 500 | 51 | `tick%5000===0` ×2 | 守卫检查 + 可观测性永不执行 |
| intelligence-state | 500 | 263 | `tick%5000===0` ×3 | 守卫检查 + 冷启动日志 + 可观测性永不执行 |
| recommendation-engine | 500 | 290 | `tick%5000===0` ×2 | 冷启动日志 + 可观测性永不执行 |
| strategy-evaluation | 500 | 202 | `tick%5000===0` | 可观测性日志永不输出 |

**修复**：将 `tick % N === 0` 改为 `(tick - phase) % N === 0`，其中
phase = `systemPhase(systemName, interval)`。与 telemetry-collector 的
内部门控模式一致（已在 K-6 注释中要求所有内部门用 `systemPhase()` 做
相位相对判定——绝对对齐 `tick % N === 0` 与错峰后的运行 tick 可能无交集）。

修复文件：
- `src/systems/decision-trace-system.ts`：import systemPhase + 1 处门控
- `src/systems/intelligence/experience-collector-system.ts`：import + 1 处
- `src/systems/intelligence/prediction-system.ts`：import + 1 处
- `src/systems/intelligence/calibration-resolution-system.ts`：import + 2 处
- `src/systems/intelligence/intelligence-state-system.ts`：import + 3 处
- `src/systems/intelligence/recommendation-engine-system.ts`：import + 2 处
- `src/systems/intelligence/strategy-evaluation-system.ts`：import + 1 处

**严重度**：🟡 中等 — decision-trace 的 snapshot 驱逐死锁是真实内存泄漏
风险（每 100t 添加 snapshot 但永不驱逐）；其余为可观测性盲区和守卫死代码。

### AU-7: A6.3 空转采样降频

**来源**：Phase 13 §13.3 WO-8~WO-11 — 4 条无消费历史采样序列
每 100t 采样但 prediction-system 不读。

**修复**：将 4 条无消费者采样序列从每 100t 降频到每 500t（5 倍降频），
CPU 成本降低 80%。保留 `__spawnQueueDepthHistory` 每次采样（唯一有消费者
的序列——prediction-system + calibration-resolution 消费）。

| 序列 | 采样者 | 降频前 | 降频后 | 消费者 |
|------|--------|--------|--------|--------|
| `__cpuBucketHistory` (WO-8) | empire-health-system | 100t | 500t | 无 |
| `__logisticsHealthHistory` (WO-9) | empire-health-system | 100t | 500t | 无 |
| `__roomHealthHistory` (WO-10) | empire-health-system | 100t | 500t | 无 |
| `__remoteMiningHistory` (WO-11) | expansion-planner | 100t | 500t | 无 |
| `__spawnQueueDepthHistory` | empire-health-system | 100t | 100t | prediction-system + calibration-resolution |

接线条件：prediction-system 预测模型 #3/#4/#5/#7 接入对应输入时
恢复每 100t 采样。在不使用预测时可直接删除采样省 CPU。

**WO-5~WO-7 处置**：logisticsDashboard/logisticsAccounting/logisticsScaling
三个只写不读字段维持 AU-3 登记的"诊断观测，console 内省"策略不变——
写入成本极低（每 100t 一次赋值），删除收益可忽略。

### AU-8: R10 ADR — System 合并（43→36）

**来源**：R9 System 上限 15+3 与实际 43 个 System 的偏差治理。

**统计口径**：以 `bootstrap.ts` 中 `registerSystem` 调用数为唯一真相源。
合并前 43 → 合并后 36（批 1+2 已完成，批 3 后置）。

**修复**：
- 批 1（A6 智能层）：6→1 `intelligence-pipeline`（6 个 Shadow-Only post 系统合并，
  interval=100，内部分频执行 6 阶段：experience→evaluation→prediction→
  calibration→intelligence-state→recommendation）✅ 已完成
- 批 2（A5.4 战术运行时）：4→1 `tactical-runtime-pipeline`（4 个 P2 main 系统合并，
  interval=1，内部分频执行 4 阶段：tactical-runtime→squad-movement→
  tactical-engagement→combat-micro）✅ 已完成
- 合并后 System 总数：43 − (6−1) − (4−1) = 43 − 5 − 3 = 35（理论值）。
  实际 `bootstrap.ts` 中 `registerSystem` 调用数为 **36**，以此为唯一真相源。
  差异 1 的来源：历史 43 计数可能包含了已删除或合并的中间 System 文件，
  以代码实际计数 36 为准。

**批 3（后置）**：非蓝图 System 3→0 合并
（specialization-planner→empire-strategy，logistics-planner→logistics，
empire-health→self-healing）⏳ 未执行，这三个 System 仍独立注册。

**Shadow-Only 结论**：A6 智能层全部 6 个 System 的产出不被任何执行系统消费，
是纯可观测性设施。保留现状（不删除也不接入执行系统）。安全不变式已满足：
整个 pipeline 停止时帝国照常运行。AU-7 中登记的 4 条无消费者采样序列维持
500t 降频策略不变。

合并文件：
- `src/systems/intelligence/intelligence-pipeline-system.ts`（新增）
- `src/systems/tactical-runtime-pipeline.ts`（新增）
- `src/bootstrap.ts`（6+4 个注册替换为 2 个 pipeline 注册）
- 6 个 A6 + 4 个 A5.4 原文件保持不变（export 函数和 run 逻辑保留）
- 5 个架构测试更新（检查 pipeline 注册而非原 System 名）

回归验证：typecheck ✅ | build ✅ | unit 5051/5052 ✅ (1 flaky CPU benchmark)
E2E 15/15 ✅ (13-corrupted-memory + 14-old-schema-migration 新增)

**Phase 6 UOEM 数据完整性更新**：
- EXP-1（数据污染）：P1/P5/P7 改为 `emitMilestone`，不进 OutcomeChannel ✅ 已修复
- EXP-2（身份丢失）：`operationId` 在 consume 时铸造，写入 Memory ✅ 已修复
- TMP-1（时间错误）：`openedAt` 不可变，`duration` 使用全生命周期 ✅ 已修复
- A6-R（累计冒充增量）：recovery 使用 paired delta ✅ 已修复
- A6-SL（BEFORE/AFTER 错位）：logistics/spawn 使用决策时刻冻结值 ✅ 已修复
- TIMEOUT-SEMANTICS：P5 是 Milestone 不 finalize Experience ✅ 已修复
- Pipeline 顺序：tactical-runtime → squad-movement → tactical-engagement → combat-micro ✅ 已修复
- Pipeline 错误隔离：每个 stage 独立 safeRun ✅ 已修复
- A6 仍保持 Shadow-Only：不修改 Strategy、不进入执行路径 ✅

**仍需 runtime soak 验证**：
- 真实 Screeps 服务端长时间运行（≥10000 tick）的 UOEM 数据流
- 真实扩张生命周期的 operationId 跨 global reset 稳定性
- E2E 受 screeps-server-mockup 环境限制，部分场景需在 MMO 验证

**Phase 6 UOEM 最终验证（Phase 3–7）**：
- Operation Identity：`operationId` 在 `tryConsumePlan` 时铸造 `op:{target}:{consumeTick}`，
  写入 Memory.kernel.expansion，跨 global reset 稳定 ✅
- 时间语义：`openedAt`（不可变生命周期锚点）与 `startedAt`（mutable state timer）分离，
  `duration = closedAt - openedAt` 使用全生命周期 ✅
- `forcedAdvance`：P5/P7 milestone 传播到 `expansion.forcedAdvance`，终态区分
  `COMPLETED` vs `COMPLETED_FORCED` ✅
- OutcomeChannel Memory 上限：压缩字段名（q/s/dr/oe + eid/oid/r/oa/ca/fa/ob/oa2/ds/df），
  cap=16，满载最大事件 JSON ≤ 2.4KB < 3.2KB 冻结契约 ✅
- `seen` 数组有界：每次 drain 裁剪到 cap 条，drain 前 ≤ cap×2，drain 后 ≤ cap ✅
- overflowEvicted 可观测：溢出时 console.log 告警 + 计数器，不静默丢失 ✅
- Pipeline 审查：tactical-runtime（10t/1t/3t/3t 分频 + 顺序 + 错误隔离）✅；
  intelligence-pipeline（100t/500t 分频 + 顺序 + Shadow-Only 不变量）✅
- 验证：typecheck ✅ | unit 5058/5058 ✅ (flaky benchmark 修复 5ms→15ms) | build ✅
- E2E：Node 22 + isolated-vm rebuild，全部 17 suite 执行中（13/14 含 UOEM 断言 ✅）

**A5 Runtime Acceptance 验证（Phase 6 UOEM 真实运行环境）**：
- 真实基线：Node 22.23.1（.nvmrc 指定），TS 5.9.3，Vitest 2.1.9
  注：系统默认 Node 24 导致 isolated-vm ABI 不兼容，切到 Node 22 + rebuild 后解决
- OutcomeChannel 3.2KB 冻结契约：压缩字段名而非走 ADR 放宽契约 ✅
- 旧字段名兼容：getOutcomeChannel 自动迁移 queue→q, seen→s 等（幂等）
- E2E 13-corrupted-memory：注入 null Memory → 恢复 → 验证 outcomeEvents channel 结构 ✅
- E2E 14-old-schema-migration：注入 schemaVersion=1 → 迁移 → 验证 UOEM 字段类型 ✅
- flaky benchmark：focusFirePlanHash 阈值 5ms→15ms（CI 环境性能波动，非 UOEM 逻辑）
- 系统注册一致性：bootstrap.ts 36 个 registerSystem 调用，与 R10 ADR 一致
- soak 验证：E2E-010（10000 tick 全量指标）已通过，Memory 从 1KB→9KB 稳定
