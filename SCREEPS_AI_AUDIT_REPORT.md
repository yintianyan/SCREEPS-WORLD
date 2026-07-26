# SCREEPS AI 工程审计报告

> 审计方法：Code Archaeology Protocol —— 不信注释，只信真实调用链。
> 全部结论基于静态代码追踪 + tick 运行时推演，每条 P0/P1 断言均经 grep 全仓交叉验证。
> 标注约定：[Facts] = 代码/文档直接证实；[Experience] = 实战经验判断；[Hypothesis] = 需运行验证的推测。

---

# 1. Executive Summary

## 总体评价

这不是一个「看起来有架构实际是意大利面」的项目。相反，这是我审计过的少数**tick 主干真实闭环**的 Screeps 代码库：`main.ts → kernel.run()` 的 10 步管线、四档 bucket 滞回降级、safeRun 错误边界、纯函数 domain 层 + 适配层分离、遥测走 RawMemory segment、甚至有一个**真实闭环的参数自调优系统**（segment 时序 → evaluator → Memory.kernel.tuning → getRoleBounds → spawn 消费，证据链完整）。工程纪律远超社区平均水平。

**但按 Scale Awareness Model 定位，这是一个 Colony 阶段（RCL4-6）的单房间 bot，穿着 Empire 阶段的架构外衣。**

## 成熟度评级（6 维自主 AI 标准）

| 维度 | 评级 | 一句话结论 |
|------|------|-----------|
| Intelligence | B+ | 状态驱动决策真实存在（phase→colonyState→demand），非被动补兵 |
| Strategy | C | 有经济战略，无扩张战略——`claimController` 全仓 0 命中 [Facts] |
| Economy | B+ | 能量闭环健壮，多重防死锁；但工业链物料断流（见 §4 P1-3） |
| Scalability | C+ | 20 CPU 预算设计扎实，但多处 O(rooms×creeps) 隐患与单 spawn 吞吐瓶颈 |
| Resilience | B | 全员死亡可恢复（推演验证）；但 global reset 有 segment 数据覆盖风险（P1-2） |
| Evolution | C | RCL6-8 的 terminal/factory/observer/powerSpawn/nuker **只有布局任务、零运营逻辑** [Facts] |

## 最大风险（Top 3）

1. **天花板锁死在 RCL6**：lab 反应链需要多矿种原料，但 terminal-policy 是从未接线的 no-op、无市场交易、无跨房调度 → 反应链必然饿死；factory/observer/powerSpawn/nuker 建得出来但永远不转。这个 bot 会建出一座漂亮的死城。
2. **PvP 防御纸糊**：塔无「伤害 vs 治疗」盈亏判定，可被 heal-tank 无限吸干能量；有塔时永不触发 safe mode；被攻击时 spawn 系统零响应（无本房 defender 角色）。任何一个懂行的对手一波 2A2H 就能拆家。
3. **remoteDefender 假闭环**：威胁采集函数是死代码，远矿防御者永不孵化 → NPC Invader 一来，远矿全线停摆只能逃跑，remote 收益周期性归零。

## 是否具备长期运行能力

**单房间、无 PvP 压力的环境下：能跑 50 万 tick 不崩**——Memory 有界、错误隔离、经济防死锁设计到位。
**作为「运营五年的帝国」：不能**——没有扩张、没有市场、没有真防御，规模的天花板是硬编码在缺失代码里的。

---

# 2. Architecture Review

## 真实架构地图（实际运行路径，非设计图）

```
Game loop
 └─ main.ts:loop → kernel.run()                          [Facts: main.ts L3]
     ├─ 1. createBudget()          bucket→tier 滞回      [scheduler.ts L99]
     ├─ 2. maintainMemory()        迁移 v0→v10 + 清死尸  [memory.ts L229]
     ├─ 2.5 requestSegments()      激活 segment 0/1/2/3  [segment-store.ts L98]
     ├─ 3. initTelemetry()
     ├─ 4-5. buildSnapshots()      每房唯一 room.find 点 [room-snapshot.ts]
     ├─ 6. runSystems()            15 系统按 P0→P3       [kernel.ts L171]
     │    P0: room-state → spawn-manager → tower-defense
     │    P1: assignment-service → link-system → lab-system
     │    P2: construction-manager → remote-mining-manager
     │    P3: layout/defense-planner → observer → pixel → telemetry → tuning
     ├─ 7. runCreeps()             角色 P0→P1→P2，TTL 升序 [kernel.ts L226]
     └─ 8-10. emitSummary → flushSkips → flushSegments
```

对照 6 层架构原则（Sense→State→Strategy→Planning→Execution→Feedback）：

| 层 | 对应模块 | 真实性 |
|----|---------|-------|
| Sense | room-snapshot + kernel.buildSnapshots 预聚合 | ✅ 真实，且是全库唯一 find 热点，设计正确 |
| State | room-state → Memory.rooms.{phase, colonyState, economyPressure} | ✅ 真实，双维度危机模型（drain+liquidity）有迟滞防抖 |
| Strategy | phase→ColonyState 映射 + demand 的状态驱动人口 | ⚠️ 半真实——经济战略存在，扩张/军事战略缺位 |
| Planning | spawnQueue / buildQueue / TaskPool / 布局蓝图 | ✅ 真实，版本化 + 幂等 key |
| Execution | role-runner 管线 + Action-Candidate 候选链 | ✅ 真实，「ERR_NOT_IN_RANGE 才移动」约束经全角色验证遵守 |
| Feedback | telemetry → tuning-engine → getRoleBounds → demand | ✅ **真闭环**（这在业余 bot 里极罕见）；但 boost/remoteDefender 是假闭环 |

## 优点（值得保留的资产）

- **组合根纪律**：bootstrap.ts 是唯一注册点，Kernel 不感知角色 [Facts]。
- **纯函数 domain 层**：demand/phase/queue/tuning 全部可 Vitest 独测，适配层负责 Game/Memory I/O。这是能长期演化的地基。
- **防死锁设计密度极高**：P0 恢复 worker 不看 pending、trySpawn 饥饿超时降级（W37S58 实测修复）、流动性陷阱检测（liquidityScore）、distributor 无 storage 自动转职 hauler、recovery 时 builder/construction-manager 的 budget 豁免。看得出被真实死锁毒打过并且每次都修在了根因上。
- **CPU 预算模型**：P0 永不被软上限拦截、tier 限制最大优先级、降级立即生效升级带滞回——与我的「bucket 分级调度」启发式完全一致。

## 缺陷（结构性）

1. **「布局完备、运营缺位」的系统性模式**：terminal/factory/observer/powerSpawn/nuker 在 compact-core-v2 模板里都有格子（L139-L166），但运营侧 grep 全仓 0 命中。这不是遗漏一个模块，是**整个 RCL7-8 运营层不存在**。建了 = 白花建造能量 + 白占 rampart 维护成本。
2. **决策与执行之间的断链模式**（3 处同构问题）：boost 有决策无就位、remoteDefender 有需求逻辑无威胁输入、expiresAt 有消费无生产。共同根因：**跨模块契约靠可选参数传递，缺了没人报错**。可选参数 + 默认值 = 断链的温床。
3. **状态语义重叠**：`colonyState=defense` 覆盖 bootstrap/recovery 语义（phase.ts L187），威胁清除瞬间可能直接坠入 recovery；kernel 的 P2 冻结门禁只看 recovery/bootstrap，defense 下发展角色照常跑——「被攻击时该收缩什么」没有一致答案。

## 风险

- 架构假设单房间：spawn-manager/remote-mining-manager 每房循环里仍有 `Object.values(Game.creeps)` 遍历（collectRemoteCreeps、recycleExcessRemoteCreeps 每房各扫一遍全 creep）——2 房间可忍，5 房间 O(N×M) 开始咬 CPU。
- Memory.rooms 失守房间条目永不清理（memory.ts L243-L254 只增不减）——多房间 + 失房场景下慢性膨胀。

---

# 3. Runtime Execution Analysis

## 真实 tick 流（以 RCL4 单房间、40 creep 为例）

1. **budget**：bucket 9000 → healthy，soft 17.5 / hard 19.2。
2. **buildSnapshots**：一次遍历全 creep 构建 sourceOccupancy/creepEnergy/pendingHarvesters/repairRooms 四张全局映射，再逐房 `buildRoomSnapshot`（约 8 次 room.find）。**这是每 tick 最大的固定成本**，设计上正确（所有下游复用）。
3. **room-state (P0)**：算 reserve/spendableRatio/frozenRatio → evaluateColonyPhase（迟滞）→ 写 colonyState/economyPressure。
4. **spawn-manager (P0)**：cleanQueue → evaluateDemand → submit → sort → trySpawn（每房每 tick 最多 1 次孵化）→ recyclePass。
5. **tower-defense (P0)**：有威胁全塔集火；无威胁且本房无 builder/worker 时塔修。
6. **assignment-service (P1)**：紧急抢占边沿触发 → buildRoomTasks 生成 fill/haul/build/upgrade 任务入 TaskPool（heap，单 tick 生命周期）。
7. **角色执行**：P0 worker → P1 harvester（先于 hauler，X-19）→ hauler/distributor/remote* → P2 upgrader/builder/reserver。每 creep 走 defineRole 管线：flee 检测 → ensureHome → updateMode → getAssignment → gate → 候选链首个 resolve 命中者执行。

## 执行断点清单（存在但永不生效 / 产生但无人消费）

| 断点 | 类型 | 证据 |
|------|------|------|
| `collectRemoteThreats` | 死代码（生产者无人调用） | grep 全仓仅定义处 1 命中 [Facts] |
| `evaluateRemoteDemand.remoteThreats` | 无来源的消费（恒 undefined） | remote-mining-manager.ts L86-L94 调用点未传参 [Facts] |
| `SpawnRequest.expiresAt` | 无来源的消费（TTL 分支永不触发） | 全仓唯一赋值是 submitRequest 的复制转录 [Facts] |
| boost 决策→执行 | 中间环缺失（无 creep 走向 lab） | lab-system.ts L258 调 boostCreep，但全仓无就位逻辑 [Facts] |
| `singleRoomTerminalPolicy` | 假模块（定义后零调用方） | grep 证实无 import 消费 [Facts] |
| hub link | 数据孤岛 | classifyLink 返回 "hub" 但 planLinkTransfers 不处理该角色 [Facts] |
| `RemoteOp.state="scout"` | 声明未用的状态 | 候选直接以 active 创建，scout 无赋值路径 [Facts] |
| intel.owner/mineralType | 半孤岛 | 唯一潜在消费者是不存在的扩张系统 |

## CPU / Memory / Scheduler 评估

- **CPU**：无失控循环。寻路五级缓存（跨 tick 持久 → 走廊共享 → 同 tick 共享 → 新算 → moveTo 回退），maxRooms=1，符合「寻路必缓存」。热点风险：remote-hauler 的 `findDroppedEnergy` 每 tick 全房 find 无缓存（约束违反，P2）。
- **Memory**：遥测全走 segment（1/2/3），Memory 本体只存队列/状态/短字段，**无 2MB 膨胀路径** [Facts]。skipReasons 有上限 + 500 tick 窗口清零。
- **Scheduler**：无饥饿——P0 永不被软上限拦，P2/P3 在 conserve/recovery 被 tier 正确关停；recovery 时 builder 与 construction-manager 有豁免通道防「灾后重建被 budget 冻死」的死锁，设计考虑周到。

---

# 4. Critical Bugs

> P0（系统无法运行）：**未发现**。tick 主干、经济闭环、灾后恢复推演全部通过。以下从 P1 起。

## P1-1 remoteDefender 永不孵化（功能完全失效）

- **位置**：`src/systems/remote-mining-manager.ts` L86-L94 / L267-L282；`src/domain/remote/demand.ts` L169-L184
- **真实原因**：`evaluateRemoteDemand` 的 defender 分支门禁在 `input.remoteThreats`，但调用方从不传该字段（可选参数缺省 undefined → hasThreats 恒 false）。生产者 `collectRemoteThreats` 已完整实现却零调用点。
- **影响**：`CONFIG.remote.enableDefender=true`、remote-defender.ts 角色、bootstrap 注册全部形同虚设。Invader 入侵远矿房 → 远矿 creep 只会 flee → 远矿收益周期性归零，且远矿 creep 的孵化能量被反复浪费。
- **复现条件**：任意远矿房出现 NPC Invader。
- **修复方向**：在 run() 中调用 `collectRemoteThreats(remoteOps)` 并传入 evaluateRemoteDemand；补一条「远矿有威胁 → defender 请求生成」的单测（有测试早就抓住了）。

## P1-2 Global reset 后空 segment 覆盖历史数据

- **位置**：`src/kernel/segment-store.ts` L114-L129 / L156-L186 / L227-L268
- **真实原因**：reset 后首 tick `setActiveSegments` 尚未生效，`RawMemory.segments[N]` 为 undefined；四个 read 函数此时静默创建**空**结构并缓存。若该 tick 命中采样（tick%10==0）或 layout 写入 markDirty，flushSegments 会用近空数据整体覆盖 segment。
- **影响**：CPU/经济时序丢失（自调优信号被清空，MIN_SAMPLES 不足 → tuning 停摆一个窗口期）；**layout 冷数据（overrides/blocked）被清最严重**——已 blocked 的位置记录丢失后规划器会重踩坑。
- **复现条件**：global reset（部署新代码 / 服务器迁移）+ 首 tick 恰逢采样 tick。概率 10%/次部署，长期运行必然命中。
- **修复方向**：read 函数在 `RawMemory.segments[N] === undefined` 且本 tick 是 reset 后首 tick 时返回「不可用」哨兵并跳过写入；或 flush 前校验「本次会话是否成功读到过原数据」。

## P1-3 工业链物料断流（lab 代码闭环、物料死路）

- **位置**：`src/systems/lab-system.ts`；`src/domain/industry/terminal-policy.ts` L31-L36
- **真实原因**：单房间只产 1 种矿物，XGH2O 等目标化合物需要多矿种基础原料；`singleRoomTerminalPolicy.planTransfers` 恒返回 `[]` 且**无任何调用方**；全仓无 `Game.market`、无 `terminal.send` [Facts]。
- **影响**：RCL6+ 后 lab-system 每 tick 空转：reactionTarget 被反复设置 → planReactionChain → getNextExecutableStep 永远拿不到可执行步骤。boost 因库存永远 < reserve+30 也永不触发。整个 industry 域（reactions/boost/terminal-policy 约 4 个文件）是纯 CPU 消耗。
- **复现条件**：任何房间到达 RCL6。
- **修复方向**：接入市场买入基础矿物（getMineralDeficits 已写好，只差市场执行侧），或在多房间前先把 lab-system 的 RCL 门禁提到「原料可得」条件，省下空转 CPU。

## P1-4 boost 决策→就位断链

- **位置**：`src/domain/industry/boost.ts` L39-L75；`src/systems/lab-system.ts` L242-L263
- **真实原因**：boostCreep 要求 creep 与 lab 相邻，但全仓不存在任何「让新生 creep 走向 boost lab」的动作——role-runner 管线、全部角色候选链、actions 目录均无 [Facts]。100 tick 新生窗口内 creep 巧合站到 lab 旁的概率趋近于零。
- **影响**：即使 P1-3 修好、化合物到位，boost 也永不生效。
- **修复方向**：在 role-runner 管线 flee 检测之后加「boost 报到」拦截段（有待处理 boost 请求且 TTL>1400 → 移动到指定 lab），或作为最高优先级 ActionCandidate 注入。

## P1-5 远矿替补请求膨胀

- **位置**：`src/domain/remote/demand.ts` L106-L116（及 hauler/reserver 同构分支）
- **真实原因**：替补请求的 spawnKey 用 `harvesterTotal`（存活+pending 之和）当 index——每过一个 managerInterval，pending 增加使 total 变化，`findReplacement` 仍命中同一濒死 creep，生成**新 key** 的重复请求。替换窗口（约 90+ tick）内可堆积近 10 条 P1 请求，全部最终孵化（配合 expiresAt 死代码，无 TTL 拦截），再靠 recycleExcessRemoteCreeps 事后回收。
- **影响**：每次远矿 creep 换代浪费数千孵化能量 + 挤占本房 P1 spawn 窗口。本地 demand 用 `creep.spawnIndex` 做稳定 key 无此问题——对照可证为疏漏而非设计。
- **复现条件**：任意远矿 creep 进入替换窗口。
- **修复方向**：替补 key 改用被替换 creep 的 spawnIndex 或 creep 名，与本地 demand 的门禁 4 对齐。

## P2 清单（核心功能受损 / 长期性能问题）

| # | 问题 | 位置 | 要点 |
|---|------|------|------|
| P2-1 | 塔可被 heal-tank 吸干 | tower-defense.ts L41-L53 | 无「塔总伤害(距离衰减后) vs 敌方总治疗」盈亏判定，有威胁就全塔每 tick 开火。远距 heal 编队 = 免费抽能泵 |
| P2-2 | 有塔时永不触发 safe mode | tower-defense.ts L23-L38 | safe mode 仅在无塔分支；塔被打空/被奶穿时无最后防线 |
| P2-3 | 被攻击时 spawn 零响应 | phase.ts L187 + demand.ts | defense 状态不提升任何孵化优先级，无本房 defender 角色可孵；防御期人口响应为空白 |
| P2-4 | expiresAt TTL 死代码 → stale 请求永久排队 | queue.ts L47-L59 | 需求消失后的请求只能靠孵化或 5 次 retries 离队；配合 P1-5 放大浪费 |
| P2-5 | 孵化中 creep 双重计数 | demand.ts L72-L89 + kernel.ts L121-L157 | spawning creep 同时存在于 Game.creeps 与 spawning 列表，被计 2 次 → 替换期间需求被短暂抑制、掩盖真实 bootstrap |
| P2-6 | blocked 任务无限重生 churn | queue.ts(construction) L93-L113 + layout-planner | blocked≥3 删除后，规划周期按同 key 重入队 → 再 blocked → 再删。永久位置冲突 = 无限循环 |
| P2-7 | remote-hauler 每 tick 全房 find 掉落资源 | remote-hauler.ts L103-L109 | 违反「角色禁全房 find」硬约束，container 空时每 tick 命中 |
| P2-8 | 无视野房 owner 盲区 | remote/targeting.ts L64-L82 | 从未看过的敌占房 owner 恒 undefined → 通过筛选成为远矿目标，creep 送死 |
| P2-9 | Memory.rooms 失守房间永不清理 | memory.ts L229-L254 | 多房间时代的慢性泄漏 |
| P2-10 | defense 状态不暂停远矿 | remote/demand.ts L77 | 注释称「非 normal 暂停」，实际只拦 recovery/bootstrap——设计意图 ≠ 实际行为 |
| P2-11 | remote-harvester 离岗满载原地 drop | remote-harvester.ts L147-L171 | 被推离矿位时能量丢在半路衰减，远离 hauler 拾取路线 |

## P3 精选（设计缺陷 / 注释漂移）

- 每房每 tick 最多 1 次孵化（trySpawn 成功即 return）——RCL7-8 多 spawn 并行能力被浪费。
- hauler 需求 0.4/0.8 填充率阈值无迟滞 → 目标数逐 tick 翻动（被队列幂等性部分吸收）。
- container 全量叠 rampart（defense-planner L317）——source container 也叠，RCL4+ rampart 维护成本失控；validationOptions.globalSiteCount 硬编码 0 绕过全局限额。
- 交通热度只存 heap，reset 清零 → 热度路建设周期被随机拉长。
- 注释漂移四处：ring 容量（注释 500/300 vs 实际 300/200）、remoteOps 清理阈值（注释 10000 vs 实际 30000）、road-policy「RCL2-3 早期成路」vs 实际 RCL4+ 门禁、layout-planner「RCL8 放 2 hub link」vs 无 hub link 工厂函数。
- migrateMemory 循环后无条件把 schemaVersion 抬到目标值——迁移链断档时版本跳跃而迁移未执行（当前链完整，属防御性缺陷）。
- tuned.ts 的 ROLE_PARAM_MAP 含远矿角色但 TUNING_BOUNDS 无对应条目——映射表误导。

---

# 5. Screeps Gameplay Analysis

## RCL 生命周期覆盖矩阵

| RCL | 布局 | 运营 | 判定 |
|-----|------|------|------|
| 1-3 | ext/tower/container 蓝图+走廊路 | worker→harvester/hauler 挖运分离、猛冲逻辑 | ✅ 完整，且 bootstrap 恢复路径经推演验证 |
| 4 | storage(P0)+ext | hauler→storage→distributor 链、紧急重建豁免 | ✅ 完整 |
| 5 | link×2+tower2 | link 瞬移链闭环（source→controller/storage） | ✅ 完整 |
| 6 | terminal+lab×3+extractor | lab 代码在但物料断流（P1-3）；terminal 零运营 | ⚠️ 半假 |
| 7 | factory+tower3+spawn2 | factory 零运营；多 spawn 吞吐未利用 | ❌ 假 |
| 8 | observer/powerSpawn/nuker/spawn3 | 三者零运营；upgrader 15/tick 限速已做（细节正确） | ❌ 假 |

**结论：实际天花板 = RCL6 经济体。RCL7-8 是布景。**

## 经济

能量流 source→harvester(站桩5W)→container→hauler→storage→distributor→spawn/ext/tower 真实闭环，link 链、controller container 站桩升级链、掉落能量三层拾取（worker/hauler/remote-hauler）均已接线。防断流设计（liquidityScore 流动性陷阱、fillStorage 优先修复 storage 空置死锁、hauler 先抽最满 container 根治溢出振荡）是老玩家水准 [Experience]。升级功率由 storage 水位 + 大 body WORK 数驱动（sprint/sustain 梯度），RCL 复利意识正确。

## Spawn

需求侧状态驱动（非角色请求）✅、幂等 key 合并 ✅、spawning 计入人口 ✅（但双计，P2-5）、P0 灾后 200 能量恢复路径 ✅（亲手推演：全员死亡+能量 300 → P0 worker 降级即孵，spawn 1 e/tick 自然再生兜底，无死锁）。等 capacity 满配 vs 立即小 body 的取舍用「饥饿超时降级」兜底——这是 W37S58 线上事故换来的正确设计。缺陷集中在远矿侧（P1-5）与多 spawn 吞吐（P3）。

## 物流

assignment 任务池（单 tick heap + lease 50 tick + 边沿触发抢占）与角色候选链回退双轨并存，assignment-service 被 budget 跳过时回退行为经代码验证确实正确（bootstrap.ts 注释声称属实）。移动栈五级缓存 + 四级脱困 + 停车预约，堵路场景有解。

## 军事

- 防御：威胁分类（部件+联盟白名单）✅、全塔集火奶妈优先 ✅；但无盈亏判定（P2-1）、有塔无 safe mode 兜底（P2-2）、无 defender 孵化响应（P2-3）。**按「战争即经济」模型：你的塔是对手的提款机。**
- 进攻：不存在（可接受——先有帝国再有战争机器）。

## 扩张

**不存在。** `claimController` 全仓 0 命中。room-observer 采集的 intel（owner/mineral/sources）没有终端消费者。GCL 增长后无任何变现路径——这是与「长期自治帝国」目标最大的战略缺口。

---

# 6. Hidden Architecture Problems

1. **假模块**（有代码无效果）：terminal-policy（no-op 且零调用）、factory/observer/powerSpawn/nuker 运营层、remoteDefender 全链、boost 全链。
2. **数据孤岛**（有生产无消费）：intel.owner/mineralType（扩张系统缺位）、hub link 角色、traffic 热度在 reset 后的半衰数据。
3. **调用断裂**（生产/消费两端都在、中间断）：collectRemoteThreats ⇢ remoteThreats、boost 决策 ⇢ boostCreep 执行、expiresAt 消费 ⇢ 无赋值来源。三处同构：**可选参数/可选字段掩盖了契约缺口**。
4. **状态不同步**：spawning creep 双计（Game.creeps 与 spawning 列表重叠）；`RemoteOp.scout` 状态在类型里声明、状态机里不可达；defense 与 bootstrap/recovery 的 colonyState 语义互斥覆盖。
5. **无效抽象苗头**：TaskPool 的 releaseCreep 在池过期后静默 no-op（当前无害，但契约上是「假成功」）；recycle 的 worker 保险逻辑与 demand 的 worker 门禁语义重复维护在两处。
6. **注释即谎言区**：本报告 §4 P3 列出的 4+ 处注释漂移——这个代码库注释密度极高，漂移率也随之升高。注释是负债，测试才是资产。

---

# 7. Runtime Simulation

## Tick 1（全新房间，1 spawn，300 能量，0 creep）

budget=healthy → 迁移建立 schemaVersion=10 → snapshot：无 creep，sourceOccupancy 全 0 → room-state：harvesterCount=0 < sourceCount → phase=bootstrap → colonyState=bootstrap → spawn-manager：livingHarvesters=0 → **P0 worker 请求**（300 能量 → [W,W,C,M] 降级体）→ 立即孵化 ✅。layout-planner：spawn 存在 → 锚点确立 + anchor 诊断日志 → 蓝图任务入队。construction-manager 被 bootstrap 的能量门禁拦住（正确——先孵兵后铺摊子）。P2 角色被 colony-state 门禁冻结（正确）。

## Tick 100（约 3-5 只 creep）

worker 采集回填 → harvesterCount≥1 → phase 脱离 bootstrap → P1 harvester/hauler 请求按 source 最少占用分配 → harvester 满编后 recyclePass 回收多余 worker（保留 1 只保险）。extension site 开始逐 tick 创建（全局 1/tick 限流）。**推演结论：RCL1→2 顺利，无死锁点。**

## Tick 1,000（RCL2-3，10-15 creep）

挖运分离成型（5W 站桩矿工 + hauler），tower 建成（RCL3 蓝图 P0），走廊路逐段铺设（每周期 1 条 ×12 格）。assignment 池每 tick 重建，lease 防抖动。CPU 估算 3-6/tick @ 40 creep 以下 [Hypothesis，需 telemetry 验证]。

## Tick 10,000（RCL4-5）

storage 上线 → distributor 孵化 → link 链建成。tuning-engine 开始有足够样本（MIN_SAMPLES）调整 hauler/upgrader 上限。远矿开启（RCL4 门禁）——**这里开始踩雷**：P1-5 替补膨胀周期性浪费能量；Invader 到访时 P1-1 让远矿裸奔。

## Tick 100,000+（RCL6 停滞点）

lab 建成 → lab-system 每 tick 空转（P1-3）→ reactionTarget 反复设置清除。terminal 建成 → 纯摆设。RCL7-8 建筑陆续建成 → 纯摆设 + rampart 维护开销。**系统进入「精致的停滞」：经济健康、升级到 RCL8、然后无事可做。** GCL 涨了没有第二个房间去用。每次代码部署有 10% 概率触发 P1-2 清掉遥测历史。

---

# 8. Improvement Roadmap

> 排序原则：Decision Priority Hierarchy——长期自主运行 > 稳定性 > 演化能力 > 效率。
> 每项标注预估工作量（S<半天 / M=1-2天 / L=3天+）。

## Phase 0：修断链（让已写的代码真正运行）—— 全部 S

1. 接通 `collectRemoteThreats` → `evaluateRemoteDemand`（P1-1），补单测。
2. segment read 加可用性守卫（P1-2）——一行哨兵判断，保护全部历史数据。
3. 远矿替补 key 改稳定索引（P1-5）。
4. 给 SpawnRequest 真正赋值 expiresAt（P2-4），或删掉死分支——二选一，不要留幽灵契约。
5. 修 spawning 双计（P2-5）：collectCreepSummaries 排除 spawning 中的名字。

## Phase 1：稳定经济与防御底线（Colony 阶段补课）—— M 为主

1. **防御三件套**（P2-1/2/3）：塔加盈亏判定（期望伤害 = Σ TOWER_POWER_ATTACK×距离衰减，敌方治疗 = Σ healParts×HEAL_POWER；入不敷出时停火蓄能）[Experience：常量以 docs.screeps.com/constants 为准]；有塔但「塔能量耗尽 + 核心被突破」时 safe mode 兜底；defense 状态下 demand 生成本房 defender 请求（新角色，P0 优先级）。
2. blocked 任务加永久黑名单（P2-6）：删除时把 key 写入 segment 的 blocked 记录，规划器跳过。
3. remote-hauler 掉落能量 find 加 per-tick 缓存（P2-7）；targeting 排除无视野未确认房（P2-8）。
4. lab-system 加「原料可得」门禁止血（P1-3 的低成本止损），省下每 tick 空转。

## Phase 2：完善房间发展（打通 RCL7-8）—— M/L

1. boost 就位链（P1-4）：role-runner 加 boost 报到拦截段。
2. 多 spawn 并行孵化：trySpawn 改为遍历所有空闲 spawn。
3. Terminal 运营 v1：市场买入基础矿物（getMineralDeficits 已就绪，只差 Game.market.deal 执行侧）——这是解锁整个工业链的钥匙。
4. Factory/PowerSpawn 最小运营：factory 产 battery/commodities 一档即可；observer 接给 intel 系统。

## Phase 3：自动扩张（帝国的第一步）—— L

1. 扩张评估器：消费已有 intel（终于有消费者了）+ candidate-score（锚点评分已实现）选 claim 目标。
2. claimer 角色 + 新房 bootstrap 编队（worker×N 远程投送——现有 remoteTarget 导航栈可复用）。
3. 多房资源互济：terminal-policy 从 no-op 换成真实调度（接口已预留）。
4. 规模化清障：spawn-manager/remote-manager 的 per-room Game.creeps 扫描改为 kernel 预聚合分桶；Memory.rooms 失守清理（P2-9）。

## Phase 4：PvP 能力 —— L，且在 Phase 1-3 之前不要碰

1. 情报层：observer 巡扫 + 敌方经济评估（storage 余量/净流入）——战争即经济，先会算账再打仗。
2. 主动防御：boost 防御 creep、rampart 驻防、按敌方投入动态定墙目标血量。
3. 进攻最小闭环：quad 编队 + 断供应链优先（打 terminal/暴露 controller，而非硬拆塔）。

---

## 终审意见

这个代码库的**内功**（错误边界、纯函数分层、防死锁、CPU 预算、真实的调优反馈环）配得上帝国级架构；它缺的不是重构，是**把三处断链焊上、把 RCL6+ 的布景变成器官、然后向第二个房间迈出第一步**。不要被 P1 清单吓到——它们全是「最后一厘米」问题，每一个的修复成本都远小于已有资产的价值。

按「运营五年的帝国」标准：先做 Phase 0（一天内可完成），再做 Phase 1 的防御三件套——**在你能打之前，先保证不会被白嫖。**扩张（Phase 3）才是这个 bot 真正的成人礼。

*审计完成于 Game.time 等效静态分析。运行时数据（CPU 实测分布、tuning 调整历史）建议用 tools/collect-telemetry.js 拉取 segment 1/3 交叉验证 §7 的 [Hypothesis] 项。*
