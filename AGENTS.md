# AGENTS.md

Screeps: World 的可扩展 TypeScript 框架，设计信条：**稳定内核 + 可插拔业务逻辑**，
生存闭环优先于发展速度。任何昂贵工作必须有 CPU 上限、缓存、失效条件和可降级路径。

## 自治契约（最终方向）

本项目演进目标是**完全自治**：零人工干预为常态。房间规模、扩张、远矿、PvP 响应都由
系统自身按运行时 CPU 预算裁决并自我调节——预算充足则扩张/扩建/备战，预算紧张则收缩/
降级/保命。没有任何手动 flag / console 指令是运营的前提；人工只保留发布与灾难接管两条边界。

### 文档策略：代码即文档，代码即解释

已实现的模块一律**不维护平行的设计文档**——设计已落地进代码与测试，内联注释就是解释。
不恢复已被移除的设计文档，也不新增「记录了已实现功能」的独立 doc。改动前请先阅读本文件，
再按下方「何时去读 plan.md 的哪一节」定位硬约束；新增代码务必让内联注释自足、不引用已删除
的 doc。唯一存留的设计读物：全局硬约束 [docs/plan.md](docs/plan.md)、角色约束
[docs/creep-behavior-constraints.md](docs/creep-behavior-constraints.md)、概览
[README.md](README.md)。

## 目录 / 职责导航

| 路径 | 职责 | 关键文件 |
| --- | --- | --- |
| [src/main.ts](src/main.ts) | 仅导出 loop 入口 | `main.ts` |
| [src/bootstrap.ts](src/bootstrap.ts) | **唯一插件组合根**，注册 System 与 CreepRole | `bootstrap.ts` |
| [src/config/](src/config/) | 静态策略参数、CPU 阈值、body 模板；[tuned.ts](src/config/tuned.ts) 是运行时调优覆盖层 | [index.ts](src/config/index.ts)、[bodies.ts](src/config/bodies.ts)、[tuned.ts](src/config/tuned.ts) |
| [src/kernel/](src/kernel/) | tick 调度、错误隔离、内存迁移与预算、遥测与 segment | [kernel.ts](src/kernel/kernel.ts)、[scheduler.ts](src/kernel/scheduler.ts)、[memory.ts](src/kernel/memory.ts)、[safe-run.ts](src/kernel/safe-run.ts)、[phase.ts](src/kernel/phase.ts)、[segment-store.ts](src/kernel/segment-store.ts)、[telemetry.ts](src/kernel/telemetry.ts) |
| [src/systems/](src/systems/) | 跨 creep / 跨房决策服务（P0–P3；注册顺序即同优先级执行顺序） | [room-state.ts](src/systems/room-state.ts)、[spawn-manager.ts](src/systems/spawn-manager.ts)、[assignment-service.ts](src/systems/assignment-service.ts)、[empire-strategy.ts](src/systems/empire-strategy.ts)、[construction-manager.ts](src/systems/construction-manager.ts)、[remote-mining-manager.ts](src/systems/remote-mining-manager.ts)、[tower-defense.ts](src/systems/tower-defense.ts)、[traffic-manager.ts](src/systems/traffic-manager.ts)、[tuning-engine.ts](src/systems/tuning-engine.ts)（完整清单见 [bootstrap.ts](src/bootstrap.ts)） |
| [src/creeps/engine/](src/creeps/engine/) | 共享执行引擎：RolePolicy 声明式动作管线 + 统一 FSM | [role-runner.ts](src/creeps/engine/role-runner.ts)、[lifecycle.ts](src/creeps/engine/lifecycle.ts)、[actions/](src/creeps/engine/actions/)、[support/](src/creeps/support/) |
| [src/creeps/roles/](src/creeps/roles/) | 角色策略（15 个）：只声明 gate/acquire/work/onFlee/hold/park/combat | [harvester.ts](src/creeps/roles/harvester.ts)、[hauler.ts](src/creeps/roles/hauler.ts)、[builder.ts](src/creeps/roles/builder.ts)、[remote-harvester.ts](src/creeps/roles/remote-harvester.ts)、[remote-hauler.ts](src/creeps/roles/remote-hauler.ts)（完整清单见 [bootstrap.ts](src/bootstrap.ts)） |
| [src/creeps/movement/](src/creeps/movement/) | 寻路、traffic 意图账本、停车、卡位自愈 | [pathfinding.ts](src/creeps/movement/pathfinding.ts)、[traffic.ts](src/creeps/movement/traffic.ts)、[traffic-resolver.ts](src/creeps/movement/traffic-resolver.ts)、[parking.ts](src/creeps/movement/parking.ts)、[stuck-recovery.ts](src/creeps/movement/stuck-recovery.ts) |
| [src/domain/](src/domain/) | 纯 TypeScript 逻辑（不含 Game/Memory 访问），可 Vitest 测试 | [spawn/](src/domain/spawn/)、[assignment/](src/domain/assignment/)、[layout/](src/domain/layout/)、[economy/](src/domain/economy/)、[remote/](src/domain/remote/)、[defense/](src/domain/defense/)、[strategy/](src/domain/strategy/)、[tuning/](src/domain/tuning/)、[industry/](src/domain/industry/)、[expansion/](src/domain/expansion/) |
| [src/types/global.d.ts](src/types/global.d.ts) | 全局类型声明 | `global.d.ts` |
| [tests/](tests/) | 单测 + [integration/](tests/integration/) 场景/边界测试 + [e2e/](tests/e2e/) 私服全链路 | `*.test.ts` |

## 命令指针（与 [package.json](package.json) scripts 一致）

| 目的 | 命令 |
| --- | --- |
| 类型检查 | `npm run typecheck` （`tsc --noEmit`） |
| 测试（全部） | `npm test` （`vitest run`） |
| 单元测试 | `npm run test:unit` （`vitest run --exclude 'tests/integration/**'`） |
| 集成测试 | `npm run test:integration` |
| 构建 | `npm run build` （`rollup -c`） |
| 监听构建 | `npm run watch` （`rollup -c -w`） |

**合并前质量门槛**：执行 `npm run typecheck`、`npm test`、`npm run build` 全绿
（见 plan.md §8「质量门槛」）。

## 技术债治理状态（2026-08-01 复核）

- 历史治理批次（A–O 十五项 + R1–R7）已全部闭环；决策与取舍以内联注释与回归测试为准，
  不再维护独立治理文档。
- R8/R9/R10 已闭环：R8 回归测试见
  [tests/unit/role/should-idle-hook.test.ts](tests/unit/role/should-idle-hook.test.ts)；
  R9 按既定方案「接受现状并在注释登记」落实（[kernel.ts](src/kernel/kernel.ts) 权衡注释）；
  R10 注释已修正（[constraint-placer.ts](src/domain/layout/constraint-placer.ts)）。
- R4 战争自治升级已落地（schema v27）：波次集结（build/advance 双阈值迟滞 +
  role-runner hold 钩子）、战损止损（spawned × casualtyMultiplier）、战后 intel
  核验（evaluateWarOutcome + warBlacklist + WarOutcome 事件）、war 姿态经济可持续
  退出（warPressureTicks → fortify）。设计决策见 plan.md §12.6；回归测试见
  [tests/unit/systems/war-planner.test.ts](tests/unit/systems/war-planner.test.ts)、
  [tests/unit/war/war-planning.test.ts](tests/unit/war/war-planning.test.ts)、
  [tests/unit/role/attacker.test.ts](tests/unit/role/attacker.test.ts)。
- R5 帝国能量网络已落地（M12 双房互济验收项补齐，**无 schema 变更**）：
  跨房能量互济（planEnergyAid 地板迟滞防震荡 + terminal.send 预算门禁）+
  能量市场交易（溢出卖/危机买价格门槛），EnergyTransfer 事件进黑匣子。
  设计决策见 plan.md §13.1；测试见
  [tests/unit/economy/energy-logistics.test.ts](tests/unit/economy/energy-logistics.test.ts)、
  [tests/unit/systems/terminal-manager-energy.test.ts](tests/unit/systems/terminal-manager-energy.test.ts)。
- R6a 帝国议程已落地（schema v28，主动自治第一增量）：短期目标层
  （recovery > defense-readiness > rcl-push > develop），empire-strategy 发布 +
  AgendaChange 事件；首个消费接线 = rcl-push 放宽 upgrader 冲刺门槛
  （spawn-manager 适配层注入 agendaInitiative）。设计见 plan.md §14；
  测试见 [tests/unit/strategy/agenda.test.ts](tests/unit/strategy/agenda.test.ts)。
- R6b 主动情报已落地（schema v29）：prospect-manager（expansionAllowed 授权 →
  选候选 → 派 scout 侦察 → 成功/超时/死亡/中止收摊 + prospectCooldown 止损）+
  scout 角色（[MOVE] 50 能量一次性）+ room-observer captureScoutVision 视野落库。
  设计见 plan.md §14；测试见
  [tests/unit/systems/prospect-manager.test.ts](tests/unit/systems/prospect-manager.test.ts)、
  [tests/unit/strategy/prospect.test.ts](tests/unit/strategy/prospect.test.ts)。
- R7a 容量感知已落地（schema v30）：算力容量模型（domain/strategy/capacity
  四档分层，有效上限取 min(cpuLimit, tickLimit) 不写死 20 CPU，升档滞回/降档
  立即，empire-strategy 发布）+ 决策结果台账（ExpansionOutcome 扩张九路归因、
  AgendaOutcome 议程窗口归因）+ 首个消费者（远矿上限 abundant 档 +1）。
  设计见 plan.md §14.4；测试见
  [tests/unit/strategy/capacity.test.ts](tests/unit/strategy/capacity.test.ts)、
  [tests/unit/systems/empire-strategy.test.ts](tests/unit/systems/empire-strategy.test.ts)、
  [tests/unit/systems/expansion-outcome.test.ts](tests/unit/systems/expansion-outcome.test.ts)。
- R7b 扩张节奏自适应已落地（schema v31）：消费 ExpansionOutcome 台账（每任务
  一条有界 ring）→ 连续失败暂停止损（expansionPausedUntil）、stolen 频发收紧
  目标门禁（minSources 1→2）、成功率驱动黑名单缩放（0.5–1.5 有界）。设计见
  plan.md §14.4；测试见
  [tests/unit/expansion/rhythm.test.ts](tests/unit/expansion/rhythm.test.ts)、
  [tests/unit/systems/expansion-outcome.test.ts](tests/unit/systems/expansion-outcome.test.ts)。
- R7c 塔防侦察兵修复 + 无害侦察观测已落地（schema v32）：修复「满能量塔对
  贴身侦察兵不开火」（无害敌对在场时塔不接维修，放空让引擎自动点杀）；
  room-state 记录 lastObserverAt/observerSightings 盯防信号（与威胁记忆分离）。
  测试见 [tests/unit/systems/tower-defense-observer.test.ts](tests/unit/systems/tower-defense-observer.test.ts)、
  [tests/unit/systems/room-state-observer.test.ts](tests/unit/systems/room-state-observer.test.ts)。
- R11 完整情报与远矿运营止损已落地（schema v33，线上 W36S58 事故驱动）：
  ① RoomIntel 增记 enemySpawns/wallCount/sealedExits（有视野即采，墙封判定纯函数）；
  ② remote-mining-manager 消费新情报 — 全部出口封死 → 废弃 op、编队全员空转
  （idle/flee 或 stuck≥stallStuckTicks）持续超 stallAbandonTicks → 废弃（吞吐反馈
  闭环）；遗迹 spawn（controller 无主）房仍可运营远矿，占领侧由 expansion evaluator
  暂缓（无拆 spawn 行动链）；③ 卡位层 — stepOffEdge 内侧格占用感知（边界钉死修复，
  CostMatrix 同口径）+ traffic-manager 引擎拒签即失效持久化路径（撞墙下 tick 重算）。
  测试见 [tests/unit/intel/sealed-exits.test.ts](tests/unit/intel/sealed-exits.test.ts)、
  [tests/unit/remote/stall-census.test.ts](tests/unit/remote/stall-census.test.ts)、
  [tests/unit/migration/v32-to-v33.test.ts](tests/unit/migration/v32-to-v33.test.ts)、
  [tests/unit/movement/edge-and-phase.test.ts](tests/unit/movement/edge-and-phase.test.ts)、
  [tests/unit/systems/traffic-manager.test.ts](tests/unit/systems/traffic-manager.test.ts)。
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
  实证：原实现满载永久停摆零产出——needsContainer 等待窗口内 harvest 徒劳
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
  测试见 [tests/unit/role/remote-harvester.test.ts](tests/unit/role/remote-harvester.test.ts)、
  [tests/unit/remote/remote-source-assign.test.ts](tests/unit/remote/remote-source-assign.test.ts)、
  [tests/unit/remote/stall-census.test.ts](tests/unit/remote/stall-census.test.ts)、
  [tests/unit/movement/static-blocker.test.ts](tests/unit/movement/static-blocker.test.ts)、
  [tests/integration/scenarios/remote-lockout-selfheal.test.ts](tests/integration/scenarios/remote-lockout-selfheal.test.ts)。
- RM-2 远矿 container 维修链已落地（无 schema 变更）：repairSourceContainer
  动作挂 acquire/work 双链（采集者「采 N 倒 N」稳态下 FSM 长期 acquire，只挂
  work 链则维修窗口仅剩偶发满载交集，等价永不维修）+ stationaryMine 倒能
  留维修税（血量 < 80% 时每 tick 留 WORK 数能量不倒 — 全额倒空会让 repair
  的背包门禁在稳态下恒不满足，维修链死锁）。节拍为「采 N 倒 N-W、修 W」
  交替，维修与采集并行不断流。测试见
  [tests/unit/role/remote-harvester.test.ts](tests/unit/role/remote-harvester.test.ts)、
  [tests/integration/scenarios/remote-container-repair.test.ts](tests/integration/scenarios/remote-container-repair.test.ts)。
- G1/G3 nuke 落点感知 + 资产抢救链已落地（无 schema 变更，帝国审计缺口
  1+3）：① 感知 — RoomSnapshot.incomingNukes（自有房 FIND_NUKES 常量查询），
  room-state 差分新 nuke id 记 NukeDetected 事件（globalCache 基线，reset
  后重报无害）；② 抢救 — terminal-manager 的 tryNukeSalvage 先于市场/
  tier/bucket 门禁（send 不依赖市场 API，战时降档不阻断），警报房 terminal
  库存按价值密度序（power > G > X 化合物 > battery > 基础矿物 > 能量兜底
  留运费地板）逐轮 send 到无警报兄弟房；③ 搬运 — distributor 的
  salvageStorageToTerminal（nuke 警报房才激活，常态零开销）把 storage
  库存搬 terminal 支撑持续 send。测试见
  [tests/unit/defense/nuke-response.test.ts](tests/unit/defense/nuke-response.test.ts)、
  [tests/unit/systems/terminal-manager-nuke.test.ts](tests/unit/systems/terminal-manager-nuke.test.ts)、
  [tests/unit/role/distributor-salvage.test.ts](tests/unit/role/distributor-salvage.test.ts)。
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
  测试见 [tests/unit/war/power-farm.test.ts](tests/unit/war/power-farm.test.ts)、
  [tests/unit/systems/power-farm-manager.test.ts](tests/unit/systems/power-farm-manager.test.ts)、
  [tests/unit/migration/v35-to-v36.test.ts](tests/unit/migration/v35-to-v36.test.ts)、
  [tests/unit/role/attacker-powerbank.test.ts](tests/unit/role/attacker-powerbank.test.ts)。
- G4/G5 挂单市场 + pixel 出售已落地（无 schema 变更，帝国审计缺口 4+5）：
  ① 挂单生命周期 — terminal-manager 的 tryManageSellOrders：超龄零成交/
  残单撤（价格随新 bid 重算自适应下行）+ homeMineral 大宗盈余挂 sell 单
  （价 = 最优 buy × sellOrderMarkup 1.15，量钳位 min/maxOrderAmount；
  账户操作不占 terminal 冷却）；② pixel 变现 — trySellPixel 吃最优 buy 单
  （账户资源无 terminal/运费，择优独立于 pickBestBuyOrder 的 roomName
  过滤）。测试见
  [tests/unit/systems/terminal-manager-orders.test.ts](tests/unit/systems/terminal-manager-orders.test.ts)。
- G7 PC 赋能扩展 + 姿态路由已落地（无 schema 变更，帝国审计缺口 7）：
  ① build order 增 OPERATE_TOWER lv1（战时塔 DPS/维修 +33%）与
  OPERATE_CONTROLLER lv1（rcl-push 冲级 +200%）；② selectPowerAction 姿态
  路由：combatContext（war/fortify 姿态或房内威胁）→ operateTower 压倒
  一切运营赋能；rclPush 议程窗口 → operateController（仅和平期）；③ 执行层
  采集 posture/agenda/threatCreeps/tower/controller effects。
  测试见 [tests/unit/strategy/power-creeps.test.ts](tests/unit/strategy/power-creeps.test.ts)。
- G6 Factory commodity 升级链已落地（无 schema 变更，帝国审计缺口 6）：
  ① 决策纯函数 domain/industry/commodity（selectCommodityTarget 梯度
  优先 + 原料=factory+storage 合计 + 独立 commodityEnergyReserve 5000
  地板 — 与 processEnergyFloor 30k 分离，commodity 是能量→高值资产转换
  非烧掉）；② factory-manager 读引擎 COMMODITIES 配方表（不硬编码，
  私服未定义时静默跳过），目标缓存在 globalCache.factoryTargets（可丢，
  reset 后重选）；③ distributor 增 stockFactoryComponents 按目标配方
  补料进 factory（produce 从 factory.store 扣料 — 原料不进 factory 就
  永远不产）。V1 取舍：只为凑料搬 storage 存量，不主动市场买入。
  测试见 [tests/unit/industry/commodity.test.ts](tests/unit/industry/commodity.test.ts)、
  [tests/unit/systems/factory-commodity.test.ts](tests/unit/systems/factory-commodity.test.ts)。
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
  [battery-decompression.ts](src/domain/economy/battery-decompression.ts)。
  ② Boost 化合物分级库存上限 — lab-system 的 surplusCompounds 卖出信号
  从统一 war.boostStockpile(600) 改为分级：war 编队化合物（XUH2O/XLHO2）
  维持 600 战略储备，日常 boost 化合物（XGH2O/XUHO2/XLH2O 等）用
  boost.dailyStockpile(300) 独立上限。纯函数 computeBoostSurplus 见
  [boost-stockpile.ts](src/domain/industry/boost-stockpile.ts)。
  ③ Deposit 远采链 — **维持不做，登记取舍**：deposit 资源（metal/silicon/
  biomass/mist）在 highway 房间 FIND_DEPOSITS，需完整远采编队（类似远矿
  但更远），当前帝国规模（2-3 房）下高阶 commodity 收益不足以支撑编队
  CPU/人口成本。触发条件：帝国进入 Grand Empire 阶段（>5 房）且 factory
  level ≥ 1 时再评估。不为「未来可能用到」建立没有消费者的抽象。

## 高风险区域与硬约束摘要

以下为不可妥协的硬约束。修改相关区域前，务必阅读 plan.md 对应小节。

### 内核与调度（`src/kernel/`）

- 内核只维护运行秩序，不感知具体角色或经济策略。→ plan.md **§2.1 分层原则**
- **已登记例外（R9）**：kernel 直接 import 业务侧 `pruneDeadCreepCache`
  （100 tick 低频的 global 缓存卫生钩子），权衡与演化条件已注释登记；
  出现 3+ 个维护钩子时再提取 registry 钩子机制。
- 四档 bucket 看门狗（Healthy/Guarded/Conserve/Recovery）：软/硬上限按
  `Game.cpu.limit` 比例化（官服 20 CPU 下与历史绝对值等价）；降级立即生效，
  恢复需滞回。→ plan.md **§3.2 看门狗与降级执行**
- 所有系统与 creep 走 `safeRun`，单点错误不得中断整 tick；非关键连续失败 3 次
  进入 50–200 tick 冷却（P0 永不冷却）；相同错误每 25 tick 限流。
  → plan.md **§3.3 错误边界**

### 内存与迁移（`src/kernel/memory.ts`）

- Memory 只存 ID、枚举、少量数字和短 key；禁止写入完整路径/历史/运行时索引。
  → plan.md **§7 性能优化 · §2.3 数据所有权**
- **迁移规范**：每次结构变更升版本；迁移必须幂等；先写新字段验证后删旧字段；
  所有步骤成功才更新 `schemaVersion`；大迁移按 cursor 分 tick。
  新增 Memory 字段须同时更新类型与迁移（当前 `schemaVersion = 33`，见 `CONFIG.memory`）。
  冷数据（布局 overrides/blocked）走 RawMemory segment。
  → plan.md **§3.4 版本化 Memory**

### 插件注册（`src/bootstrap.ts`）

- `bootstrap.ts` 是唯一组合根；新增角色/系统只改此文件与新模块，**不改 Kernel**。
- 名称全局唯一 kebab-case，重复注册启动即失败；模块顶层禁止访问 `Game`/`Memory`。
  → plan.md **§4 插件注册规范**

### Creep 行为（`src/creeps/`）

- 角色是声明式 `RolePolicy`（gate/acquire/work/onFlee/hold/park/combat），由
  engine/role-runner 统一驱动；共享 FSM 只在背包空/满、任务完成或威胁解除时
  切状态，防抖动。`hold` 钩子在 ensureHome 导航之前执行（attacker 波次集结）。
- 角色**禁止**全房 `find`、全局扫描、创建 Spawn 请求、调 `createConstructionSite`、
  每 tick 调 `PathFinder.search`；优先复用 RoomSnapshot 与 kernel 预构建索引，
  缓存 `targetId`。→ plan.md **§5.1 全角色硬约束**；细节见
  [docs/creep-behavior-constraints.md](docs/creep-behavior-constraints.md)
- 移动默认走 traffic-manager 后置系统：角色登记意图，tick 末按房仲裁统一签发
  `move`；寻路带三档限频（目标量化、repath 冷却、每房 search 上限），
  本地 `maxRooms: 1`。→ plan.md **§5.7.5 移动服务与路径预算**

### Spawn（`src/systems/spawn-manager.ts`）

- Spawn Manager 是**唯一**能调用 `spawnCreep` 的模块，角色不得自行孵化。
- 请求按稳定 key 幂等合并，`spawning` 与已提交请求须计入人口；P0 灾后恢复优先，
  可用能量达 200 立即生成 `[WORK,CARRY,MOVE]`；队列带黑名单冷却（SP-2）、
  请求撤销通道与 `recycle` 回收通道。→ plan.md **§5.4 Spawn 孵化**

### 建造（`src/systems/construction-manager.ts`、`src/systems/remote-mining-manager.ts`）

- site 创建仅两个写者：construction-manager（自有房）+ remote-mining-manager
  （远矿房，P0-A 收编）；角色层只写 `needContainer` 申请标记，禁止调
  `createConstructionSite`。
- 全局存量上限 `CONFIG.construction.maxGlobalSites`（7，含远矿 siteCount 账本）；
  每房最多 3 normal + 2 road + 1 critical；自有房 emergency site 优先于远矿 site。
  道路依据实测交通热度逐段添加，绝不预铺全房。→ plan.md **§5.5 建筑建造和维修**

### 布局（`src/domain/layout/`、`src/systems/layout-planner.ts`）

- 布局是版本化蓝图 + 低频局部适配 + 队列化执行；核心结构建成后冲突只标 `blocked`，
  不自动拆改。模板改动须递增 `templateId`/`layout.version` 并写迁移。
  → plan.md **§5.6 布局与建造的技术实施方案**

### 战争（`src/systems/war-planner.ts`、`src/domain/war/planning.ts`、`src/domain/strategy/posture.ts`）

- `war` 姿态是进攻的唯一授权来源（持续被打 + 打得起）；war-planner 是唯一进攻
  执行决策者，attacker 仅由它孵化。代码存在不等于战争开始。
- 止损链不可绕过：spawned 超 `squadSize × casualtyMultiplier` 收摊；失败/unknown
  目标进 `warBlacklist` 冷却；war 姿态下经济压力持续超标经 `warPressureTicks`
  退 fortify。波次集结：attacker 在 build 相位经 hold 钩子归建待命，满编才 advance。
- 战后核验只信新鲜 intel（evaluateWarOutcome 纯函数），结论记录 WarOutcome 事件。
  → plan.md **§12.4 帝国姿态层、§12.6 战争自治升级（R4）**

## 何时读 plan.md 的哪一节（速查）

| 触发场景 | 阅读小节 |
| --- | --- |
| 改角色行为 / 新增角色 | §5.1 角色硬约束、§5.7 Creep 技术实施 |
| 改 Memory 结构 / 加字段 | §3.4 版本化 Memory（迁移规范）、§2.3 数据所有权 |
| 改调度 / CPU 预算 | §3.2 看门狗降级、§7 性能优化 |
| 改 Spawn 逻辑 | §5.4 Spawn 孵化 |
| 改建造 / 布局 | §5.5 建造维修、§5.6 布局实施 |
| 改远矿 / 扩张 / 帝国姿态 | §12.1–12.4、[empire-strategy.ts](src/systems/empire-strategy.ts)、[posture.ts](src/domain/strategy/posture.ts) |
| 改议程 / 主动目标 | §14、[agenda.ts](src/domain/strategy/agenda.ts)、[empire-strategy.ts](src/systems/empire-strategy.ts) |
| 改情报 / 侦察 / 视野 | §14、[prospect-manager.ts](src/systems/prospect-manager.ts)、[prospect.ts](src/domain/strategy/prospect.ts)、[room-observer.ts](src/systems/room-observer.ts) |
| 改容量 / 台账 / 节奏演化 | §14.4、[capacity.ts](src/domain/strategy/capacity.ts)、[empire-strategy.ts](src/systems/empire-strategy.ts) |
| 改战争 / 进攻 / 止损 | §12.6、[war-planner.ts](src/systems/war-planner.ts)、[planning.ts](src/domain/war/planning.ts) |
| 改跨房物流 / terminal / 市场 | §13.1、[terminal-manager.ts](src/systems/terminal-manager.ts)、[energy-logistics.ts](src/domain/economy/energy-logistics.ts) |
| 改调参 / 遥测 / CPU 预算 | [tuning-engine.ts](src/systems/tuning-engine.ts)、[tuned.ts](src/config/tuned.ts)、§3.2、§7 |
| 评估技术债 / 已知取舍 | 各处内联注释与回归测试 |
| 注册新插件 | §4 插件注册规范 |
| 写测试 / 覆盖边界 | §8 测试策略、§9.1 边界场景清单 |
| 评估风险 / 降级策略 | §9 风险与应对措施 |
