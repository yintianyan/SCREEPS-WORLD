# Evolution Roadmap — Screeps 自主 AI 进化路线图（L1）

配套 L0：`Long-Term Mission--Screeps Autonomous AI Evolution.md`（最终目标、工程原则、自主权限）。
本文件是 L1：未来数周至数月的优先事项、能力缺口、依赖关系与验收标准。

**维护规则**：每轮 L2 迭代结束前更新 §3（优先级队列）、§4（当前迭代）、§6（变更记录）。
状态等级严格区分，不可互相顶替：`已设计` < `已实现` < `已集成` < `已测试` < `已验证`（线上有出处）< `已稳定`。
无法给出处的一律写 `待验证`，不得写成事实。

---

## 1. 现状快照（shard3 官服，2026-10-02 05:0xZ 复核）

| 维度 | 事实 | 证据等级 |
| --- | --- | --- |
| 领土 | 核心房 W37S58（RCL8）+ 幼房 W38S56（自主扩张所得）+ 远矿若干；W37S55 已放弃；**10-05 11:4xZ：第三次扩张房 W38S58 于 tick 83,444,422 失守**（RCL1 `ticksToDowngrade` 归零 ⇒ 同拍 `controller.level=0`、`my=false`），帝国回到 2 房，observe 现读 `失守待清=[W38S58]`、`W38S58=CANCELLED`、`allowed=true`、`Blocked=G4+G6`（详见 §4.0 补40） | 已验证（同轮采样器逐拍见证） |
| 每拍 CPU | 差分实测 ≈15.1/t（舒适线 ≤12.00）。10-01 21:00 复核：`tier=tight`、`since=83363555` 两次采样（隔 15 分钟）稳定；20:40 那次读到的 `constrained` 是**部署税**（boot 后不采信输入 ⇒ 档位归零），已自解。**10-02 04:5xZ**：`tier=tight@83364706`（换码没挪动 `since` ⇒ 这批的税落在输入不可信窗而非档位翻转）；300t 环 `avg=14.8 / max=18.5`。**累计账 `12.67/t` 是 boot 均值，不可当速率**（要差分）。**10-02 07:2xZ 复核**：换码后 `tier` 落 `constrained`（= 部署税，boot 后不采信输入）， 之后读回 **`tight`、`since=83372945`** ⇒ 档位自解，与 10-01 那次同形；**判 tier 只看 `tier`+`since`**，每次部署自带 ~400 拍税；**10-05 13:0xZ**：两次读数差分反推两房真实水平 **≈15.9/t（±0.2）**，而判档输入 `cpuRate.total` 的分母是**进程寿命**（`Game.time − processBootTick`）⇒ 它是**自 boot 的累积均值、旧样本永不退出**，所以既不代表近期也不代表长期，结构变化（少一间房）反映不进去 ⇒ 见 §3.5 #136（G6 由此在本进程存活期内按构造解不开） | 已验证（档位）/ 待差分（速率） |
| 扩张 | **10-05 22:1xZ R190 现读 `failedGates=G4+G6`——G0 是十轮来第一次摘掉**：`posture=fortify@83,453,360`、`expansionAllowed=true`、`newRemoteOpsAllowed=true`，侦察随即恢复（环内 5 发 `ProspectOutcome`）。**G0 自己走开的机制不是 threatWindow 到期**，而是 `posture.ts:161-163` 的「任一自有房 recovery/bootstrap ⇒ 战争立即撤资降级」⇒ **war 停摆有「经济危机」上界、没有 threatWindow 上界**（§3.5 #137 按此结案；本轮触发者＝幼房 `hc 2→1` 的 ≈7 拍 bootstrap 抖动）。剩下两道都是量出来的闸：`G4 netFlow v=4.5`（阈值 ≥5，幼房 `nf_d −35.8` 拉到线下；第四轮翻动 ⇒ 别拿它当扩张条件）＋`G6 CPU tier=constrained`（`cpuRate.total=16.14/t` vs 需 ≤12.0，进程累积均值 ⇒ 本进程存活期内按构造解不开，见 #136）⇒ **不动任何阈值，出路属人（A/B/C/D）**。**R191 补：G0 的正确说法是「间歇」不是「已摘」**——有活敌 17 拍与幼房 bootstrap 27 拍都会把它摁红（`expandHealth` 含 `allNormal` 与 `sponsorReady.!hasLiveThreat`，`posture.ts:150-157`），而 war 最早 ≈83,456,360 复发（★预报见 §3.5 #137）；本轮 `failedGates` 只剩 `G6` ⇒ **G4 又翻绿＝第五个样本** | 已验证（同轮 `strategy`＋`failedGates` 直读＋分支排除＋代码条件） |
| 经济账本 | 净流口径四处语义已修（pickedUp / 无 storage 不 drop / exported+tradeFee 只进消费侧 / carrier 卸能成对入账）；**#48 判效到手**：同 boot 段两次配平 `3600/3600` → `4800/4800`（核心 `exported` == 幼房 `imported`，差分各 +1200）——记为**金额配平**，不是"同拍成对" | 已验证（#43/#48 判效到手） |
| 自主防御 | 幼房有塔后进犯 10 拍清除、0 战损；无塔时 ≥1000 拍停摆；**10-05 12:1xZ 第二个定量样本**：W38S56 遭入侵（`hostileAt=83,444,623`），塔连开 5 拍把目标从 ~1,400 hits 打到 ~200 并清除（`TowerVolley` 载荷列序按 `tower-defense.ts:130-136` ＝ `firedCount, x, y, healParts, floor(hits/100)`），环内 `EnemyInvasion=1 / TowerVolley=19 / EnemyCleared=1`，姿态随即翻 `fortify`；⚠️而同一拍 `situation.adversaries={}`、`conditions=[]` ⇒ **真打了一仗而"按人敌意"那一列仍为空**（既有缺口的战事对照，比静态证据强）；本窗另有两条 `CreepDeath` 的 `natural=0`（W37S58，age 44／496）⇒ **战损还是回收不可回溯**（分类只在死亡当拍判，`event-log.ts:300-303`）；**10-05 19:1xZ 攒到第三个样本、且首次打到核心房**：`W37S58.hostileAt=83,450,361`，塔 6 发齐射后 `EnemyCleared` ⇒ **三房轮流入侵、三次都靠塔清场，编队层始终为 0（见 §3.5 #138）** | 已验证（三次，全部由塔独立完成；编队增援层从未上线） |
| 战争 | 授权链与诱饵拒绝由引擎级 e2e 覆盖；**10-05 线上首次出现真实战争账**：`WarPlanCreated×4 / WarOutcome×2`、防御型计划 `{targetRoom, squadSize:9~10, spawned:0, phase:"advance", operationType:"DEFEND"}`，最后一次由 recovery 发止损信号撤除（`recovery-execution-system.ts:1327-1331` 的 `-1` 特殊编码）；⚠️但**warPlan 车道的「计划→编队」两次样本都是 0 兵** ⇒ 新案 §3.5 **#138**。**★R192 现场收窄：军事角色第一次在场，而来源是 PB 野采车道**——`powerFarmMissions=[{targetRoom:W40S54, sponsor:W38S56, since:83,455,226, spawned:6, phase:"strike"}]`，在世 `attacker×4／healer×2／remoteDefender×1`（六只逐只按 name 锚定、全带 `mission:"powerBank"`）；而 `power-farm-manager.ts:34-40` 在 `posture==="war"` 或存在 `warPlan` 时把任务以 code 3（war-preempt）全部收摊 ⇒ **war 存续那 5,737 拍里这条车道按构造不能出兵**，war 于 83,453,360 结束后 ≈1,870 拍就开出第一个任务。⇒ 五次进犯 5/5 只由塔解决、0 次编队交战 | 部分线上验证（PB 编成与交战＝已上线；warPlan 编成＝从未上线，成因已判＝#138） |
| 贸易 | terminal 自发交易在跑，运费入账可见（boot 段 tradeFee=794）；买料产商品单价倒挂 ≈60 倍 ⇒ 需求发布被 ROI 闸正确按住 | 已验证 |
| 工业 | factory 等级回退已上线；商品需求 ROI 闸已上线；lab 经济线未稳定产出 | 部分已验证 |
| 自我诊断 | 期望自检 E1–E9 + 定长事件环 + dashboard/peek 工具链；**恢复烧穿第一次留下可查痕迹**（10-02 04:5xZ `Memory.kernel.escalations` 首条真实条目 `W38S56/colony/population_rebuild, attempts=2, terminal=true`，环内同段 `RecoveryEscalation=2`）⇒ #59 的"等一次真实烧穿"结束；`manual_intervention` 仍是死枚举（无生产者） | 已集成；E5 本轮修复（见 §4）；升级侧响应惰性仍未判效。**10-02 08:0xZ 三点更新**： ①#54 的五档拒因**今天被真正用来定罪**（差分 +1/拍 ⇒ 逐拍锁定被挡请求，最终指到 body 成本 1650 > 容量 1300）； 第 6 档 `degradeGateClosed`（#64）已实施待上线，上线后"没被允许降级"与"付不起"才可分读； ②幼房升级道解冻后 `economy.bk` 与 `controllerProgressChangedAt` 同步走（+8.0/拍），**"发展静默失败"这一类第一次有可差分的仪器链**； ③**验证侧缺口**：e2e 长 soak 不可复现（#62 孪生 FAIL，第二随机源 = creep 名后缀进 hash 与队列键） ⇒ 在孪生 PASS 之前，soak 场景的红**不得当因果证据**（这限制了 E2E-016 一类判定的升级） |

## 2. 模块参与矩阵（39 个已注册 System 的参与状态）

- **确认在场且生效**（线上读数能证明其在决策路径上）：room-state、spawn-manager、demand、assignment-service、
  logistics、construction-manager、traffic-manager、remote-mining-manager、expansion-planner/manager、
  factory-manager、terminal-manager、tower-defense、telemetry-collector、tuning-engine/intake、link-system(幼房无 link，待验证)。
- **参与状态已盘点**（子代理起草、我复验三条关键项，全文 `tmp/observe/module-participation-audit.md`）：
  power-creep / power-farm / pixel / prospect / territory / war-planner / war-planning / squad-movement /
  tactical-* / defense-planner / recovery-execution / empire-strategy / empire-economy / empire-health /
  economy / agenda-manager / intelligence / link-system。要点（按类，不按房）：
  - **SILENT-WORKER 3 条**（真干活、零发布）：`link-system`（每拍 `transferEnergy`，无计数、不经 intent 包装）、
    `tactical-engagement`、`combat-micro`。核心房 RCL8 有 link ⇒ link 那条**今天就在静默工作**。
    ⚠️我已把自己对这个标签的推论撤掉（#58 结案）：房间能量账**只在生产/消费端点入账**，
    房内 hauler 搬运同样不入账（`helpers.ts:54` / `op-ledger.ts:37` 佐证），所以"link 不入账 ⇒ 账本失真"不成立，
    它是同一条设计边界。残留只有一条：`logisticsHealth` 的投递率量不到 link 吞吐，而**没有决策路径读那个缺口**
    ⇒ 属可选观测，不排产。
  - **INERT-BY-PRECONDITION**（和平期/配置所限，进门即 return）：power 两条、pixel（`CONFIG.pixel.enabled=false`，已复验）、
    prospect（`expansionAllowed!==true`）、territory（无 `roomRelease` 指令）、war 两条 + 军事 pipeline stage、recovery-execution。
    ⇒ 这些"没参与"是前置条件与配置，**不是缺陷，别立案**（L0 §1.4 反向）。
  - **VISIBLE-WHEN-ACTIVE**：intelligence、empire-strategy、empire-economy、economy、agenda-manager（和平期痕迹=空表）、defense-planner。
- **`empire-health` 的可见性是弱的**（关键项，我复验过）：它的主结果 `global.empireHealth / failureGraph / recoveryActions /
  autonomyStatus` 全在**未镜像的 heap**（`telemetry-collector.ts` 里 grep 这四个键零命中）⇒ 换码即失，
  线上只能靠 `global.<key>` 现场 peek。这条直接约束 #57 的判效方式（见 §3 P0-2 的"响应签名"一项）。
- **已知仪器盲区**：`CreepDeath.natural` 单维（战损/回收同读数）；`upgraded` 在 RCL8 恒 0（保级能量不入账）；
  E8 pathFailure 假阳性（并行会话在改）；跨房供给的 `imported/exported` 只在真实输送发生时才有数。


## 3. 优先级队列（数周 → 数月）

### 3.0 重排（10-06 03:5xZ，R358–R372 之后；本节覆盖下面 P0/P1 的**排序**，不覆写它们的历史正文）
今天这一批读数把两件事从"推测的卡点"变成了"点名的卡点"，也掀掉了几条我自己反复引用的前提。排序按"哪个先决定帝国还在不在"来：

1. **【新·生存级，排在所有发展项之前】丢房无检测路径（#116 / R371-R372）**：W38S58 的 claim 已消失
   （`controller.my=false / level=0 / owner=false`，两发探针同向），而我方 `Spawn7`＋`storage` 满血留在场内、
   `Memory.rooms.W38S58` 仍按自有房维护（`colonyState=recovery` ≈27,351 拍、孵化队列 3 条）。
   机制两条都有出处：收支循环按 `economy.ts:62-63` 的 `controller.my===true` 过滤 ⇒ **丢房瞬间该房对自己的账本隐形**；
   领土侧 `releaseAt` 只由主动释放写（`territory-manager.ts:112-114`）⇒ **没有"意外丢房"这条分支**。
   且 `ticksToDecay` 现读 undefined ⇒ 这两枚建筑不会自己消失。
   ⚠️**R373 就地撤一句**：我原文写"长期占 `gcl.usedSpaces`（我方 spawn 7 枚 vs `gcl.level=5`）"——**那句不成立**：
   7 是我探针里 `Object.keys(Game.spawns).length`（**spawn 普查数**），我把它命名成 `gclUsed` 后就当"GCL 名额被占"来引，
   而 `Game.gcl.usedSpaces` 是**在建工地数**、本会话**从未读过** ⇒ 变量的名字替我做了我没做的测量（同族错：名与量不符）。
   要判"它是否还挤建造名额"，下一发现读 `Game.gcl.usedSpaces` 与 `Game.gcl.level` 再说。
   **处置属人**（reclaim / 清算 / 补一条丢房检测），我不代做也不拆。
2. **【已点名，等拍板】扩张的唯一失败门是 G6（#50 / R370）**：`expansionDashboard.failedGates` 现读只有
   `["G6: CPU tier(v=constrained|tier ≤ comfortable)"]`；传导是 G6 ⇒ `isReady=false` ⇒ `readySince` 从不累计（4 张 Plan 停 `EVALUATED`）
   ⇒ 无 `WAITING_EXECUTION` ⇒ 无第四房。现读 `cpuAvg10=19.5/20`、`constrained` 已 ≈33,900 拍 ⇒ 进 comfortable 需 −7.5/t，
   而系统侧整榜砍光 ≈−2.9/t。**⚠️R373 撤掉我原文与第 1 条的那句因果**（"丢掉的房还在收结构性 CPU 税，而这项税正是扩张的闸"）：
   现读该房 **0 creep**、`cpuByHome` **不记它**、`economy.ts:62-63` 的收支循环**跳过它**
   ⇒ 它能加的每拍成本只剩"8 处**无条件**遍历 `Memory.rooms` 的循环多一个条目"
   （清单：`war-planning-system`、`war-planner`、`remote-mining-manager`、`prospect-manager`、`power-farm-manager`、
   `expansion/bootstrap-lane`、`telemetry-collector`、`telemetry/metrics/SpawnMetrics`）——**量级未测，且几乎不可能填上 −7.5/t 的缺口**
   ⇒ 所以第 1 条与第 2 条**不构成因果**，只是两件事都该修；把它们排在一起的理由是"生存级优先于发展级"，不是"修了丢房就能扩张"。
3. **【解锁件，仍然卡在授权】把 11 笔未推 src 上线**：八条边沿签名的预部署对照已全部取完（R358/R346 两套），
   其中 `stats.observe`（`994bf542`）是 **战争线唯一能由帝国自己买到的直接视野**的判读前提——
   现读情报池 7～11 个房**全为无主**（`mine=0`、`unowned=7`），三趟 war 期 pass 全 `candidates=0/plans=0`（#114）。
4. **【仪器档，低】老化批取模门间歇整批丢沿（#115 / R364-R367）**：`intelCoverage.tick` 现读序列 +200/+400 后回到 +100
   ⇒ 间歇性、非系统性；影响是两列读数新鲜度与段 5 玩家情报晚落盘（部署清 heap ⇒ 真实丢失窗口），不改决策。

**3.0 增补（04:26Z，接 R377-R381；下面三条都是读数，不是推测）**

5. **【新】工业柱的真实卡点在"买不到的商品"，不在代码也不在钱**：RCL8 与 powerSpawn 都在场（`W37S58`，`my:true`、`energy 1300`、`power 0`），
   `processPower` 调度链也在（`power-processing.ts`＋`factory-manager.ts`＋`CONFIG.powerSpawnPowerTarget:100`＝市场买入目标）；
   但 `store[RESOURCE_POWER]=0`，而本服此刻**功率零卖单**（`getAllOrders` 两种形状各跑通一次、均返回 0 条）且 `credits=20,342,247`
   ⇒ **"买功率"这条路当前不可行，与钱无关**；唯一剩余路径是 Power Bank（战斗）——**属人授权项，我不代做也不为造证据而开战**。
   ⚠ 引用要重读：行情是这一拍的快照。
6. **【新】"第三环没写"只有一处成立**：`operateStruct`（操作工厂）在 `src/` 里**零调用者**；`processPower` 不是。
   ⇒ 若主人决定走 Power 路线，**还需要一枚代码环**（哪个工厂、何时操作、冷却怎么排＝工业策略，属人），
   即"上 Power"单独不足以通工业线。这条必须写进 #130 的决策依据，别让它在两票之间被混掉。
7. **【已闭合的资产账，可直接引用】**：实际控制 **2** 房（W37S58 RCL8／W38S56 RCL5，`gcl.level=5`），
   **74/345＝21.4%** 的我方建筑躺在 3 个非自有房（W37S55 一套工业复合物 69 枚／W38S58 2 枚／W38S59 3 枚 extension、0 spawn），
   `Memory.rooms` 却记 3 个家 ⇒ **W38S58 是幻影房**（recovery＋孵化队列仍在跑）；
   且自有房的工业**同样零产出**（`factory process=null`、10 lab 里 1 枚有内容）⇒ **搁浅的那半是冗余，不是缺的产能**。
   两条仪器形状坑一并记住：`Game.gcl.usedSpaces` 本服不存在；`Game.constructionSites` 才是对的名（现读 **21** 个工地）。

**排序不变的理由**：5、6 是"要不要花政治资本去打 Power Bank／补工业第三环"的前置事实；7 是"清算遗留资产"的分母。
三者都不依赖部署，也都**不由我代做决定**。

**今天被否证、不许再当前提引用的四条**（都还能在下面 P0/P1 的旧正文里读到，故在此立此存照）：
①"退出 war 要吃 ≥5,000 拍扩张尾税"（R368：`expansionPreserve` 短路，794 拍即 `expansionAllowed=true`）；
②"扩张唯一阻塞是 `posture!==war`"（同上，task #7 已结案）；
③"war 里出不了兵是计划→兵那一环坏了"（R359-R366：`kernel.warPlan` 从未生成，那一环**未开始验证**）；
④"人口普查覆盖 5 个角色可以当人均分母"（#141：五列 11 vs 实数 42，虚高 ~4 倍）。
**方法论一条**：本会话我三次凭记忆造名（引擎 API 名 / 调用形状 / **Memory 键名**），第三次最危险因为"我记得那行代码"——
所以上面每条都标了位点或读数，凡未标的都写明"未证"。

**P0 — 让"发展"这件事不再静默失败**（依赖：无）
1. ~~幼房升级道被相位抖动掐断~~ → `f28bbf5` **已线上判效**（18:24Z mark=C3：`colonyState=recovery` 的同一拍
   `spawnQueue` 里出现 `upgrader:2`，`economyPressure=0`、`spawnBlacklist={}`、controller.progress 在动 29,334/405,000）。
   ⚠️这条读数的边界要说清：它证明「相位不再没收需求」，**不证明补发延迟够短** —— 延迟要死亡事件前后的队列差分，
   取证器已就位（`tmp/tools/official/replenish-watch.sh`），立案对象改成 #54 而不是 #55。
2. ~~**检出→响应闭环**（设计已定形，待一次前置核实后即可实施）~~ → **已实施、已上线；检测半段有线上正证，响应半段仍欠一次真实事件**：
   `c93f467`(#56) + `0776a0d`(#57) 随批次1 上线，`3c0bbff`(#59) 随批次2 上线（线上 sha `53e76dda2ac4` == 本地被测 dist）。
   已验到的：锚点 `controllerProgressChangedAt` 上线前两次实测 null → 上线后有值，且在 progress 变化那一拍**同拍前移**
   （FT2@83361496）⇒ "信号存在且跨部署可信"这一半不再是纸面。**未验到的**：`SUBMITTED development_resume` 这条线上签名
   （要等一次真停摆，见项 3）；以及验收上限只到 `partial`（`development` 不是健康维度，domainLevel 恒 stable —— 登记债）。
   ⇒ 下面整段留作**判读知识**（两条生产者按 `targetFailureId` 形状分、heap 里的 recoveryActions 不可当持久证据、
   `slice(0,10)` 不能喂机器、响应不得以放宽闸的形式出现），**不要再当待办排产**。
   现状核查（读码，非推测）—— 期望自检 E1–E9 的违例**没有任何消费者**，唯一的例外是 E2 的 `p3Starved`
   会去续期前馈旁路窗口；而**响应 machinery 早就存在**：`empire-health`(P1/interval 100) 采 `collectActiveFailures`
   → `buildFailureGraph` → `prioritizeRecovery` → `recovery-execution`(P1/interval 10) 执行并按
   `recovery-lifecycle.evaluateRecoveryResult` 验收。`domain:"colony"` 的推荐动作就是 `population_rebuild`
   （maxAttempts 2 / cooldown 500，`recovery-execution-system.ts:244` 有实现分支）。
   ⇒ 缺口不是"没有响应器"，而是**停摆这个事实没有进失败图**：失败图里唯一的发展信号是
   采样瞬间的 `colonyState === "recovery"`（empire-health-system.ts:414-427），一个每 100 拍看的瞬时抽样
   对一个每 50~400 拍横跳的房是概率性的，对"人口齐备但角色被抑制/建造位为空"的房则根本不响。
   **动作**：把 E5 的停滞锚点（`Memory.rooms.*.controllerProgressChangedAt`，本轮 c93f467 已跨部署可信）
   作为一条失败节点接入 `collectActiveFailures`，复用 `E5_STALE_TICKS` 与既有 domain 映射，不加新阈值。
   **两条硬约束**：①不要从 `Memory.kernel.expectations.violations` 取输入 —— 那个数组是 `slice(0, 10)`
   （kernel.ts:587）的人类读数，被截断就不是判据；②响应必须是"加出口"（补员/重排孵化优先级），
   **不得**以放宽闸或降阈值的形式出现（L0 §1.5 + 本仓库红线）。
   验收：一条真实停摆在一次 `empire-health` 采样后 ≤100 拍内产生一个可观察动作（spawn 请求或事件），
   且该动作有防抖（同房同域在 cooldown 内不重复），控制组（进度在动的房）不产生动作。
   **前置核实已解除**（本轮做掉）：`tests/integration/scenarios/recovery-action-pipeline.test.ts` 用真实 kernel 跑通
   `recovery 带 → 房级 colony 节点 → population_rebuild 动作 → 带 recoveryCorrelationId 的孵化请求 → actionTable 记录`，
   并配了一条**同夹具不注入**的匹配对照组（房级节点不出现 ⇒ 上一条不能无条件通过）。
   ⚠️两条判读知识：①失败图里 `colony` 有**两个生产者** —— colony *维度*（人口/健康度，id `failure:colony:<tick>`，不带房名）
   与 `colonyState=recovery` 的**房级**节点（id `failure:colony:<room>:<tick>`），判效必须按 `targetFailureId` 形状区分，
   否则会把人口故障误认成发展停摆；②`empire-health` 的 `recoveryActions` 只在 heap（telemetry 不镜像，已复验）
   ⇒ 线上判效要认的持久签名是 recovery-execution 的 `SUBMITTED <type>` log 行（或这次顺带补一条镜像）。

   另记一条待查形状（未定罪）：`failure:colony:<room>:<tick>` 的 id **含 tick**，
   一个在 recovery 带里停 400 拍的房会产出 400 个不同节点；动作侧有 `cooldownKey(domain, room)` 去重，
   但图侧的 `detectRootCause/analyzeImpact` 是否被这种重复带偏需要按数判。

3. **E5 上线后的第一次真停摆取证** → **候选已经上门**（21:12Z 实测）：幼房 stall 从 842 涨到 853 拍且仍在涨
   （`Spawn6` IDLE、无 hauler ⇒ 见 §4.0 的自锁回路）。~~跨过 `E5_STALE_TICKS=10,000` 约在 tick 83373000~~
   ⇒ **ETA 更正（10-02 05:0xZ）**：锚点在 83368649 被一次脉冲式爬级**重置**过（04:5xZ 实测 `controllerProgressSeen=38167`
   自那次起冻 2,473 拍）⇒ 阈值线现在是 **≈83378649**，不是 83373000。**继续禁止拿单窗报 ETA**（这条锚点会被自己的脉冲挪动）。
   ⇒ 判据两条：①`期望自检` 出现 `rclStale:W38S56`（或失败图出现 `failure:development:W38S56:*`）；
   ②`SUBMITTED development_resume` 是否随之出现。**若出现但 body 仍按容量出、p2 仍不放行降级 ⇒ 响应是惰性的**，
   那要补的是第二处出口（recovery 提交路径不看液体能量），不是把阈值调小。
   ⚠️①②的前置已被今天 04:5xZ 那次定性改动搅动一次：`budget` 拒因的主体是**需求侧 body 越过物理容量**（§4.0.1），
   不是"队首付不起液体能量"⇒ 若上线后升级道通了，锚点会自己前移，这条取证候选随之推后（不是失败，是被拆了引信）。
   **另收一条（05:0xZ 实测）**：`Memory.kernel.escalations` 第一次拿到真实条目
   `{room:W38S56, domain:colony, actionType:population_rebuild, attempts:2, terminal:true, at:83369862}`
   ⇒ #59 那条"线上签名要等一次真实烧穿"的等待**已结束**；环内同段 `RecoveryEscalation=2`。
4. ~~**恢复失败要留下可查的痕迹**（#59，下一批候选）~~ → **已实施并上线**（`3c0bbff`，随批次2 于 20:30Z 换码，
   线上 sha `53e76dda2ac4` 与本地被测 dist 逐字相同）。⚠️线上签名仍要等一次**真实**烧穿（不可制造）
   ⇒ `Memory.kernel.escalations` 为空不是失效；证据等级：集成测试 + 上线 + 无回归。
   原诊断（`recovery-execution-system.ts` 的 escalation 只变一行 `log.info`、既无事件也无 Memory 落点，
   而它踩着的 `g.recoveryActionTable` 在 heap ⇒ 一次部署就把"某项恢复失败了"整个抹掉）已被这次修复消掉前两条。
   **残留一条仍未解**：`manual_intervention` 这个动作类型全仓**无生产者**（死枚举）⇒ 烧穿之后"该有人接手"这件事
   仍然只是清单上的一个形状，没有真的接手机制。属可立案的观察项，不排产（要先决定接手意味着什么）。

**P1 — CPU 天花板（唯一挡住扩张的结构性成本）**
- **先说清这件事的真实形状（10-01 加）**：幼房 RCL5 的下界不是任何一道闸，是**能量收入**。
  实测幼房 `reserveDelta ≈ +5.4/t`、controller `+2.65/t` ⇒ 毛收入量级只有 **≈10/t**（2 颗 source，无远矿线）。
  本服 RCL4 需 `progressTotal=405,000` ⇒
  - 把**全部**收入灌进升级的理想上界 ≈ 4.05 万拍 ≈ **1.4 天**（3 s/拍）；
  - 当前编制（1 只 upgrader，被 #60 那条棘轮冻住）≈ 14.2 万拍 ≈ **4.9 天**；
  - 恢复 9~10/拍（编制的应有值）≈ 4~4.5 万拍 ≈ 1.5 天。
  ⇒ **#60 的价值上限就是"提前约 3.5 天"**，再多也没有 —— 想更快只有提高收入，而唯一的收入放大器是远矿，
  远矿又吃 CPU（≈19.9/t 能量 vs 每 op 的拍成本），**而 G6 已经 tight**。
  这两条约束互相拉扯：**"发展太快"与"CPU 不够"是同一枚硬币**，所以 A 方案（关远矿）不只是延扩张，
  也会压低幼房爬级速度 —— 摆给用户的数必须成对给，不能只给省下的那半边。
- 现状：`capacity.tier=tight`（since 会随换码刷新，只看 tier+since），舒适线 ≤12.00/t。
- 出路只有两条，且都不是免费：① 排产决策（`CONFIG.remote.maxOperations`，代价 ≈19.9/t 能量收入 + 120 段已建路 + 把 G4 压到 <1.5 倍余量）——**属人决策，不自动执行**；
  ② 逐角色的动作签发精简（先按 `telemetry.intents` 直方图定标，再动代码；已证伪"减无效签发"这条路）。
- **G6 是扩张链的上游，不只是"其中一道闸"（10-01 实测读码）**：`prospect-manager` 开新侦察任务的门禁是
  `expansionAllowed === true` **且** `budget.tier ∈ {healthy, guarded}` **且** bucket 达标（prospect-manager.ts:38-42）。
  ⚠️**自我更正**：我上一段写过"情报会在 1 万拍后过期 ⇒ 扩张要等重采"，机制说错了。
  18:03Z 现场是 `Memory.rooms.W37S58.intel = {}`（**根本没有存储情报可过期**），`isIntelStale` 对从未观测的房返回 false，
  而 `expansionCandidates=10`、`expansionPlans=4`、`expansionBlacklist=0`、暂停早在 83341372 已到期，`Memory.kernel.prospect` 不存在（无侦察在飞）。
  ⇒ **计划库存不是瓶颈**；执行时真正要的是那一刻对目标房有**视野**（`isTargetClaimable` 走实时可见性），
  视野靠侦察、侦察与扩张同受 tight 限制 ⇒ 结论不变（CPU 在上游），但因果链是"视野"，不是"情报过期"。
  ⇒ 只要 tier 卡在 tight：**侦察与扩张被同一把闸一起冻住**；posture 回落后如果 CPU 仍 tight，
  情报会在 ~1 万拍后过期而**无法自动重采**（重采本身也要 healthy|guarded）。
  ⇒ 解闸顺序上 **CPU 是上游**：先解 G6，posture 那条会自己到期；反过来只解 posture 得不到可执行的扩张计划。
  一次侦察任务全程上限 1200 拍（`maxMissionTicks`）⇒ 即便一切就绪，"从冻结到能 claim"还要攒一次侦察的往返。
- 验收：`tier` 与 `since` 同时翻到 comfortable 且驻留 ≥300 拍（不看 `cpuAvg10` 的 10 拍阶梯）；
  附带验收：解闸后 `Memory.kernel.prospect` 应重新出现任务（侦察恢复的证据）。

**P2 — 多房资源网络真正跑起来**
- 跨房供给合同（#35 反序列化已修）：验收 = 幼房缺能时收到一次外部补给 **且** `exported/imported` 两侧成对入账（#48 判据）。
- terminal 再平衡与商品链：验收 = 一次 T2 配方产出落地 + 库存达到 `stockTarget`。
- 依赖：幼房 storage **结构在场**（实测 t=83360165 时 RCL4 已达标但 storage 仍是 site 10,933/30,000
  ⇒ 供给合同与 #48 判效都还没到前提，别把它当"已可验证"）。

**P3 — 工业与高级机制覆盖**
- lab 经济线：`storage.XGH2O ≥ 130` 后 boost 首消费者才会上岗（当前 0，属正确态）。
- power creep / pixel / territory / intelligence 的参与签名（并入 R-A 审计）。
- 依赖：R-A 审计结果；不为了"模块都存在"而开发。

**P4 — 军事与竞争（长期受外部条件阻塞）**
- 线上战损/防御数据需要真实敌情；不制造敌情、不发动演练性战争。
- 可做：把 e2e 引擎级战争场景扩到"资源消耗预算内可重复跑"，并给 `WarPlanCreated`（三写者三编码）与 `WarOutcome`（-1 哨兵）定一个统一编码口径（#58，复盘前置条件）。

## 3.5 待人工排产（请示汇总，2026-10-02 15:2xZ 收口）

> 这一节专门放**我不自批**的决定。每条都给出现场实测数、可选项与代价，以及"若无人定，默认行为是什么"。
> 默认行为一律是**维持现状**（不降闸、不砍营收、不动安全语义、不拆已建资产）。

- **#61 孵化预留条件 3 的语义**（`spawn-manager.ts:391`）：现在是"预测性扣款"，与在用需求不同口径。
  实测指纹：`reserveOnly` 与 `degradeGateClosed` 在四个不同小时里**严格 1:1** 同增（第 5 类证据）。
  ⚠️**10-04 R160 补20 否证了"严格 1:1"这个措辞**：W38S58 同一路径两读（16:14 → 16:48）得 `reserveOnly 49→303`（**+254**）而 `degradeGateClosed 31→1,136`（**+1,105**）⇒ **同向但绝不等值（≈1:4.4）**。⇒ 引用本条时改说"两者同向增长、比值不稳定"，**别再用 1:1 做交叉校验**（我过去就是靠那个等值把两把闸当成同一个计数器读法的）。**本条的结论方向不受影响**（预留条件 3 仍在拦孵化），但"等值指纹"这个证据形式作废。
  代价：builder 的 1150 body 撞的是 `capacity−200` 那道预留，不是"能量不够"。
  选项：①把预留改成"按在队列需求扣" ⇒ **动安全语义，须明示授权**；②只加观测（已做：第 6 档 `degradeGateClosed`）。
  未定则默认②——预留不动，只是能被看见。
- **#73 扩张闸 G2「无困难房」的输入**：幼房一次瞬时 `recovery` 就被判成经济困难 ⇒ 扩张闸长期吃一个抖动信号。
  选项：给闸补一个它本该有的判别量（不是新增阈值、不是放宽阈值）。属动闸输入 ⇒ 请示；未定则不改。
- **#50 G6 CPU 档位缺口**：`comfortable` 要求 ≤12.00/t，实测差分 **15.10/t**、300 拍环 avg 16.5 / max 20.0（=硬上限），
  `tier=tight` 已数小时未动 ⇒ 是负载真不够低，不是仪器按构造不可达那一版结论。
  唯一码级稳定杠杆是 `CONFIG.remote.maxOperations`（其超额收缩**会真退役现役 op**、按 pathCost 远的先砍，且**不会自撤销**）：
  关远矿省 ~2.27/t，代价是 19.9/t 能量 + 120 段已建路 + 把 G4 余量压到 <1.5×。
  **降门槛去凑绿是自败**，故只摆数。未定则维持现状（扩张继续被 G6 挡住）。
  口径提醒：`stats.cpuPerTickByRoom` 的分母**含非自有房**（候选房 W38S57/W38S58 各 0.04~0.06、远矿房 0.25~0.40），
  别把它们当"帝国房成本"读。
  ★**R136（10-04 05:2xZ）算术更新**（上面原文数字保留作出处，本条只加新读数）：`kernel.capacity={tier:**constrained**, since:83416306}` 是刚翻的一档，
  且**不是部署税**——`check-code` 两发都读回 `modules:{main:<786,453B sha=d2f0b0cd00ad>}` ⇒ 无人推码 ⇒ 真实负载。
  累计账四轮连涨 `15.77 → 15.88 → 15.93 → **16.02/t**`（窗口 9,087t）⇒ **对 12.00 门槛缺口 4.02/t**；
  A 路线杠杆 remoteHarvester 1.89 + remoteHauler 0.79 ≈ **2.68/t** ⇒ **关远矿单独已经不够（缺口超杠杆 ≈1.3/t）**，
  这是本会话里缺口第一次追上并越过杠杆。⚠️并按对端 R294 的更正：**代价栏"19.9/t 能量"是历史满编数，不再当现状引用**——
  W36S58 那条线此刻在停摆边缘（房内带 WORK 的我方 creep 一度为 0、停滞工地 `noProg` 每拍续涨）。
  未定则维持现状（扩张继续被 G6 挡住，且 G6 比本节上一版描述差一档）。
  ★**R137（10-04 06:1xZ）可决态一行（数字都有出处：`kernel.stats.cpuRate` windowTicks=10,087、unsampledTicks=0）**：
  **当前速率 17.43/t**（差分 `(16.16×10,087 − 16.02×9,087)/1,000`；窗均只有 16.16 ⇒ **拿窗均摆数会低估 ≈1.3/t**）⇒
  **缺口 5.43/t（按当前）或 4.16/t（按窗均）**；**A 路线杠杆 2.67~3.00/t**（`byRole` remoteHarvester 1.89 + remoteHauler 0.78，reserver 0.32 算不算由口径定）⇒
  **仍缺 ≈2.4~2.8/t（当前口径）/ ≈1.2~1.5/t（窗均口径）**。已排除的两列：**编制**（人口 48→43，creep 项 ≈**−0.095/t**，符号都不对）、
  **系统侧**（traffic-manager +0.03、snapshots +0.00，没有任何单列动过 ≥0.5/t ⇒ 5% 规矩仍挡着）。
  ⚠️**两把尺彼此不同意，请人先定义"A 路线删的是什么"**：角色口径给 **2.67~3.00/t**，而 `cpuPerTickByRoom` 里五个非自有远房合计只有 **1.09/t**
  ⇒ 差 ≈1.6~1.9/t 取决于关掉远矿是"删 op / 删角色 / 删车道"哪一种，**这个边界不由我选**。
  `tier` 第二发已到手：`constrained@83416306` 持续 **1,029 拍 > 300 拍驻留** ⇒ 真实状态（非抖动、非部署税）。未定则维持现状。
  ★**R156 给本节补一个具体受害者（CPU 缺口第一次直接打掉"扩张收尾"，不是"开新局"）**：`expansion-manager` 注册为 **`priority: 3` / `interval: 100`**（`expansion-manager.ts:31-33` + `config/index.ts:935`），而调度器对 P3 有两道硬拒：`spent() >= softLimit` 与 **`priority >= 3 && cpuAvg10 >= softLimit ⇒ 拒`**（`scheduler.ts:145/168/185-191`）。现算门槛：`limit=20`、预算档 `Memory.kernel.tier="healthy"` ⇒ `softRatio 0.875 / hardRatio 0.96`、`cpuReserve 0.8` ⇒ **`softLimit = 17.5`、`hardLimit = 19.2`**。实测 `cpuAvg10` 在 **16.4（11:36）↔ 20.8（11:14）**、300 拍环 **17.3~18.9** ⇒ **多数拍 ≥ 17.5 ⇒ P3 被拒**。现场后果：`globalThis.systemLastRun["expansion-manager"]` 停在 **`83423257`**，到 `83423642` 已 **385 拍未跑 = 3.85 个 due 窗口**，而同期 ~25 个系统都跑在当前拍（**不是全局停摆，是这一档被单独饿**）。⇒ 而 `submitPioneers`（给新房补 builder 的唯一入口）**只能在该 pass 里执行** ⇒ 现场是：**第三次扩张只差 577 点建造能量、场上 builder=0、补投通道被 CPU 闸门锁住**。
  ⚠️**同轮 R156 第二发把"锁住"这句降下来（原文留在原位）**：`systemLastRun["expansion-manager"]` 由 `83423257` **前进到 `83423657`**，且紧随其后 `W37S58` 队列里出现 **1 条 `home=W38S58` 的先锋请求**、`kernel.bootstrapDiag@83423657 = {owned:3,noVision:0,hasSpawn:2,notMine:0,pushed:1,sponsor:2,decisions:1}`（`hasSpawn=2` = 两口房有自己的 spawn，第三口正是要补的那间）⇒ **按我预写的分支①撤案：不是"饿死/锁住"，是"被降速"——两次 pass 实测相隔 400 拍 = nominal `interval=100` 的 4 倍**。⇒ **站住的量化只有一条**：P3 在 `cpuAvg10 ≥ softLimit(17.5)` 时被拒 ⇒ **先锋死亡后的补投节奏被 CPU 压力拉到 ≈400 拍一次**（这一轮 builder=0 的窗口因此变长约 400 拍）；**"因 P3 饿死而烂尾"这个措辞作废**，#50 的取舍里请把这条当成"CPU 缺口对扩张收尾速度的实测影响"，而不是"扩张被完全挡住"。
  ⇒ **请把这条与"关不关远矿"放在一起看**：它和"扩张被 G6 挡住不开新局"（那是设计）不是同一件事——**这是已经投进去的第三个 claim 可能因 P3 饿死而烂尾**。⚠️边界：**"饿到跑不完"目前仍是推断**，我还没采到 `systemLastRun` 前进两次的样本（一次前进即可给出真实周期）；判据与两个分支已预写在 §4.0（R156），另见 `#117`（送能进不来）与 `#116`（编队无采集）——**三件事，不要并成一条**。
  ★★**R158 补10（14:0xZ，读码 + 两发仪器）：把"P3 被拒"的判据补全 —— 现在绑住 `expansion-manager` 的是「上窗峰值触顶」那条（`scheduler.ts:189`），不是我一直引用的 avg/softLimit 那条（`:191`）**：现读 `Memory.kernel.stats.cpuAvg10 = 15.6 < softLimit 17.5`（avg 那条**通得过**），而 `cpuMax10 = 26.3 ≥ hardLimit 19.2` ⇒ `:189` 对 **P2+ 一律拒** ⇒ `systemLastRun["expansion-manager"]` 自 `83424357` 起 **≥445 拍没前进**（实测 tick `83424535`）。⇒ **R156 那句"P3 在 `cpuAvg10 ≥ softLimit` 时被拒"要改成两条都点名**：软上限（avg）与**触顶峰值**（`cpuMax10 ≥ hardLimit`），后者更常绑住；`p3Escape` 旁路只救 post 段 P3（遥测），救不到 `expansion-manager`。**后果直接落在本轮 objective 上**：物理事件（spawn 建成 @`83424338~480`）已经发生，但 **②③ 的可见读数要等下一次 pass** ⇒ CPU 压力现在不只拖慢扩张动作，**还拖慢"扩张完成"这件事被系统自己承认的时间**（G6 档位同时 `tight → constrained@83424406`，300 拍环 avg 16.5→19.5）。**顺带一条不许因果化的读数**：新房每房 CPU `0.078 → 0.388`（+0.31/拍，倍数大但绝对量小），同期 `W37S58 4.387 → 2.764` 在降 ⇒ 每房合计反而**下降** ⇒ 这次 `constrained` 翻转**不能归给新 spawn**（残差落在非房级相位：kernel/post/snapshots）。
- **#76 卖能量该按什么估价**：本服实测 `calcTransactionCost(1000)` ＝ 同房 0 / 邻房 33 / 远房 856 / 极远 865
  ⇒ 运费占货量 0%~87% 随对手房变化，而 `minEnergySellPrice = 0.02` 完全不含距离项。
  按"卖完把烧掉的能量按 `maxEnergyBuyPrice=0.05` 买回"口径，远手卖的净正门槛是 **P>0.043**（现闸门放到 0.02）；
  按"这些能量本就堆在 `energySellFloor=100000` 之上无处可去"口径，机会成本≈0，0.02 仍是白捡。
  **两个口径的差就是人的决定**。我已把分桶读数上线（`tradeFeeEnergySell/Buy`，纯观测），未定则不改价格。
- **#75 核心房 2 只超配 controller 角色 link**（10,000 能量已沉没，实测能量 140/0/0）：
  拆掉=毁资产，挪建=再花能量，且 `upgrade.ts:69` 有 `energy>0` 门禁 ⇒ **它不饿到 upgrader**，没有紧迫损失。
  未定则保持原样；观测侧已实施（#82：`auditLinkRoleSurplus` → `layoutMetrics.linkRoleSurplus`，只进仪表不进缺口）。
- **#81 幼房：防御外壳 vs 发展速度**（10-02 记在 §6 里、当时忘了登进这张表 ⇒ 人是按这张表读请示的，现补）：
  现场结构 `44 ramparts / 0 walls`。一阶实测：一个完整窗 `{harvested:980, towerSpent:500, towerSpendWalls:500}`
  ⇒ 塔支出 100% 在墙/盾、同窗 `upgraded` 键缺席，而收入贴两源物理上限 19.6/t ⇒ **一半收入用来维持外壳**。
  二阶（读码）：`reserveDelta` 是存量差分，塔从 storage 出的每一笔都把它推负，而 #79 的上行护栏就拿这个数否证 ↑
  ⇒ **防线外壳会间接把升级编制钉住**（定罪待 #83 的成因码）。
  选项：①维护档加经济条件（储备在掉时把 rampart 目标降到衰减地板）⇒ 回收 ~10/t、升级 ~4/t→~10/t、
  RCL5 ETA ~33h→~13h，代价是防线回归；②给幼房开一条远矿 ⇒ 两者都不让，代价是 CPU（G6 已红）；③维持现状。
  **未定则默认③，我不自批。**
- **#77（后半，本轮测到数）扩张队列的 4 条 `WAITING_EXECUTION` 计划已经躺了 47 万~84 万拍（≈22~42 天）**：
  实测 `t=83386177`：`W37S56 age=841,493 / W36S58 597,993 / W37S57 597,793 / W38S58 474,193`，全部 WAITING_EXECUTION，
  都不是自有房（⇒ 不是"给自己发 claim"那种事故）。后果是**量**出来的：`MAX_ACTIVE_PLANS = 5`，
  四条常驻 ⇒ **只剩 1 格给新目标**；闸一开，planner 只能再 admit 一条。
  ⚠️**这条的代价被我一开始的措辞夸大了，现按实测收正**：heap 的 `systemCpuPerTick`（t=83386239）读到
  `expansion-planner 0.02/拍`、`expansion-manager 0` ⇒ 这 4 条陈旧计划**几乎不花 CPU**，所以它**不是浪费点**；
  真实后果只有两条：队列 5 格里只剩 1 格可用、以及"目标情报过期了还当意图存着"。
  ⇒ 请示的实质是**要不要让陈旧目标自动让位**，不是"要不要止血"（止血那层含义我不该写进去）。
  ⚠️**再收一次（21:0xZ 实测后）**：这 4 条**不是烂在队列里**。`Game.gcl.level=5/自有 2/余量 3` 否掉了"GCL 早退"这条猜测；
  读 `plan-adapter.ts:60-100` 又否掉了我自己写的方案 B——**消费前复评早就实现了**：四个硬失败 gate 会 `CANCELLED` 并进
  rebuildCooldown，而 `expansionAllowed`（G0）与 budget 是**软失败**只 return false。今天正是 G0 关着 ⇒ 逐轮复评、逐轮软失败、
  原地等待 = 设计行为。⇒ **本条真正的请示面只剩一个**：队列年龄 34 天说的是"我们 34 天没被允许扩张"，
  要动的是 §3.5 里 G0/G6 那两条（人的决定），不是给计划加 TTL。TTL 只在"你希望过期意图自动让位"时才需要。
  残留不确定与一发可钉死它的观测（计划落 `lastGateEvidence`）写在 `tmp/observe/pending-77-plan-queue.md` §1.5。
  这三件事互相纠缠，选哪件属人：①给非终态计划加 TTL（=决定"一次扩张意图值多少钱、多久作废"，我不自批）；
  ②让 planner 每轮拿当前 Intel 复评陈旧计划（不作废、只更新事实——若目标已被他人占，就该掉线而不是继续排队）；
  ③维持现状（把队列当"意图仓储"，接受新目标被陈旧计划挤掉）。
  ⚠️我只把数摆出来：本轮**没有**新增 TTL、没有改 `MAX_ACTIVE_PLANS`、没有任何阈值变动。
  已修的只有 #86（自有房占候选池那一格，性质相同但语义无争议——自有房永远不是待占领目标）。

- **#88 G4「净流 ≥ 5/t」在饱和库存上不可长期满足**（10-03 R138 立案，属判据语义/排产，**我没动任何阈值**）：
  G4 读的是第四台仪器（每房快 EMA 再过 `α=0.02×interval=100` 的慢 EMA，τ≈5,000 拍 ≈42 分钟；存 `kernel.gateNetFlow`）。
  现读 Σ门=3.97 而 Σ底层流量=**−0.20/t** ⇒ 这台仪器只会向下衰减，**G4 不会自己变绿**。
  算术在 R138：本服 storage 不随 RCL 分级（实测 1,000,000），核心房已 882,314（88%）⇒ 余量 117,686，
  按 ≥5/t 持续积累 **3.3 小时就满仓**；而核心房 RCL8 的 controller 消费被 15/拍钉死，唯一大出口就是再开一房——
  正是这把闸挡着的事。**所以这不是"钱不够"**（帝国存量 943K、`Budget=347,990/940,512`），
  是"要求继续积累"这一条在近满仓上物理性不成立。三个可选面：①G4 改判据语义（存量+流量合取）；
  ②开消费出口（扩张本身，或工业线 #16/#51）；③接受该门槛只在未满仓时有意义。
  ⚠️别把它与 G6 混成一笔：G6 是 CPU 侧（杠杆只有 `CONFIG.remote.maxOperations`），两者不同因。
  ★**R136（10-04 05:2xZ）：本条最要紧的那句"G4 不会自己变绿"被现场否证**（原文保留作出处）。
  83415384 读到 `G4: net flow(v=4.5|netFlow ≥ 5)` = **红**，83416284 同一把尺读 **v=5.5 = 不红**，
  `gateNetFlow` 三房和 `4.683 → 5.051`、核心房项 `1.690 → 3.248` ⇒ **红只活了 ≈870 拍，且靠自己回到门槛之上**。
  控制组同拍读：幼房账面净 **−1,096**（INCOME 900 vs CONSUMPTION 1,996）而其 storage 在涨（+5.7/t）
  ⇒ 同一处"账面 vs 物理反号"在两房**方向相反**地出现 ⇒ 属仪器口径（与对端 R298/R299"50 拍窗无分辨力"同调），**不是**"盈余被花掉"。
  ⇒ **排产含义改为**：G4 现在是**贴门槛抖动**（Σ 距 5.0 只剩 **0.051**，物理面核心房两跨为 `−10.1/t` 与 `+11.9/t`、合并均值 ≈−1.8/t），
  会反复自红/自绿 ⇒ ①/③ 两个面仍值得讨论，但**不能再拿"不会自己变绿"当紧迫性论据**；引用一律写成"第 N 窗读数 v=x"，不写"绿了/红了"。
  （另注：上文"按 ≥5/t 持续积累 3.3 小时就满仓"是**已作废常数的派生量**，回收记录见 §读数口径那一条"撤常数必须回收派生量"。）
  **★10-04 R142 追加（累计账到手，本条的"账面 vs 物理反号"第一次有了列名，且 R141 的前瞻动作被我撤回）**：
  `Memory.kernel.stats.energyLedger`（heap `global.energyLedger` 的镜像，`global-cache.ts:803-838` 按 key **累计**、起点 `tick=83407220`=本会话唯一那次部署，跨度 ≈14,300 拍）现读三房：
  核心房 INCOME 40.3/拍（`harvested` 19.0 + `imported` 21.3）对 CONSUMPTION 46.0/拍（**`spawned` 30.6 + `towerSpent` 7.14（=修墙 7.12）+ 市场与跨房流出 7.7**）⇒ 账面净 **−5.79/拍**；
  幼房账面净 **+3.64/拍**；新房净 −0.40/拍；帝国合计 **−2.55/拍**。物理面同期不同区间：核心房近 3,250 拍 **−17.2/拍（平滑单调、无台阶）**、幼房近 1,050 拍 **−8.7/拍**（此前是 **+15.8/拍 在攒** ⇒ **幼房也转负了**，20 个环样本支撑）。
  ⇒ 三条含义：①**"帝国在吃库存"从推断升为量化的事实**，且**两房同时**——本条上文"幼房 storage 在涨"那半个控制组**今天到期**，不再支持"只是仪器口径"；
  ②核心房**编制换血（30.6/拍）比自家采集（19.0/拍）高 61%**，缺口靠远矿流入 21.3/拍 垫 ⇒ G4/#88 谈"净流"时真正的对手项是**补员成本**，不是升级或建造（该房 `upgraded=0`、`built=0`）；
  ③**R141 提的"前瞻动作=新写按 key 累计计数器"作废**（仪器已在，`telemetry-collector.ts:386-389` 就是镜像点），**它因此不该再占请示位**；剩余只差**同一区间两点差分**（快照 A=本轮 10:3xZ），零改码。
  ⚠️口径边界：本账的远矿流入是**毛值**（未扣远矿角色自身 bodies），**(458,842−45,600)/14,300 ≈28.9/拍**，**不要拿它替换 #50 里"关远矿代价 19.9/拍"**——两个数不同口径，A 路线代价要重算得先拆远矿 bodies。
  **★★10-04 R142 结案（同区间恒等式闭合，本条的"仪器口径"解释被排除）**：`Memory.rooms.<r>.economy.ws` 读码确认是**视界累计 `[Σdrift, ΣflowBalance, Σticks]`**（`accounting.ts:386-396`，`WS_HORIZON_TICKS=2000`，换码后续算不归零）。核心房现读 `ws=[-254,-31854,1750]` ⇒ **账面净 −18.2/拍、累计残差 −0.145/拍（占流量 0.8%）**，而 `econ-ring` 独立测同一房 −17.2/拍 ⇒ **两台仪器两个区间相差 6%，账实相符**。控制组：幼房 `ws=[173,-7192,1450]`（残差 2.4%，且**账面净流已转负 −4.96/拍**）；新房 `ws=[941,-593,1700]`（**|Σdrift|>|Σflow| ⇒ 按代码自带规则算"单向漏记"，但绝对量仅 941 能量、无实质后果）。
  ⇒ **三条对本条上文的更正/升级**：①核心房流失**落在设计内的消费列里**（补员 30.6/拍 > 采集 19.0/拍，缺口靠远矿流入 21.3/拍 垫），**不是漏账、也不是"结构性看不见"**；②R141 留给本条的那句"凡引 /拍净流 必须标'来自 50 拍窗、单窗残差 ±1,700'"**降级为**"单窗 `dr` 不可信（本轮 `dr=-2,354` vs 视界 `-254` 为证），**正确引用是 `ws` 视界累计**"；③**G4 深红升为"真赤字"**——它吃的净流在视界上账实相符，而赤字的对手项是**编制换血成本**（该房 `upgraded=0`、`built=0`），于是 A 路线（关远矿）的实质问题变成**"关掉 21.3/拍 的远矿流入后，核心房 30.6/拍 的换血没有垫背的"** ⇒ **仍属人决策，我只摆数**（不改阈值、不砍营收线）。
  **★10-04 R143 对上面 ③ 的降级（同一把尺差分翻了号）**：`energyLedger` 快照 B 与快照 A 差分（`Δtick≈646`，按实测拍长 2.77s 反推、误差 ±10%）给核心房 **INCOME 39.7/拍 vs CONSUME 37.1/拍 ⇒ 净 +2.5/拍**（其中 `spawned 31.5/拍`，与寿命均速 30.6 对得上 ⇒ 仪器稳），而 1,750 拍视界给的是 **−18.2/拍** ⇒ **撤的是"稳态赤字"这一半，留的是"列名归因"（补员是第一大项）与"单窗 `bk` 不能排除脉冲项"**。符号在小时尺度会翻 ⇒ 赤字是 **episode 形态**，而 G4 吃的 τ≈5,000 拍慢 EMA 正好把这形态抹成一个贴门槛的均值 ⇒ **#88 的"贴门槛抖动"结论不变，"真赤字"要改成"间歇性真赤字"**。
  同轮另加一条口径：**引"物理面净流"必须写明是 `se` 还是 `rs`** —— 本小时核心房 `se −8.1/拍` 与 `rs +7.5/拍` **反号**，差额 ≈15/拍 是 storage→容器的**房内搬运**（按 #58 不入账，是账本边界不是失真）。

- **#116 升级为决策级（10-04 R143，本轮零改码）**：它的代价第三次改写，这次不是"施工双峰/占空比不稳"，而是**直接站在扩张链的检查点上**。代码原文：`CP3_ENERGY_LOOP = harvesterActive && transporterActive && spawnCanSpawn`（`checkpoint.ts:169-180`），而 `harvesterActive`/`transporterActive` 是**按 `memory.role` 字符串**筛的（`state-machine.ts:401-406`：hauler 或 distributor 才算物流活跃，**carrier 不算**）。现场（R143E3@83422128 现读）：W38S58 在场 5 只 = `carrier×1(背包 1,200) + worker×2 + builder×2` ⇒ **两个合取项现在都不满足**。
  **后果与时间预算**：spawn 建成后 CP2 若过，`startedAt` 会**重置**（`state-machine.ts:303-305`）⇒ 我一直盯的"死线 83429857"不是这房的终点；`economic_startup` 超时 = `pioneerTimeout*2 = 40,000 拍 ≈30.7 小时`，届时 **CP3 过 ⇒ FORCED_ADVANCE，不过 ⇒ `abortExpansion(TIMED_OUT)`**（按既往判效会释放这块 claim）。⇒ **这房的命运取决于"新房自己的 spawn 能否交付 harvester + hauler/distributor"**，而 R140 已证该房 harvester 请求长期"创建即过期"（当时无 spawn 可服务）。
  **不自办的两条**：①往拓荒编队加采集/搬运角色（安全/排产语义）；②改 `colonyCreeps`/检查点角色字面串（会连带 squad-wiped 判据与 pending 去重）。**修法方向与代价已在 §3.5 上方与 lock R140/R143 摆明，等拍板。**
  **★★10-04 R143 补3：读到底之后，#116 从"缺角色"升为"按构造闭合的死循环"，并附一条可被证伪的预报**（⚠️**此段的"死循环"定性已被下面的补4 撤回**；补3 里"只有 harvester 会往 container 倒能、worker 兜底是升级"那半仍有效）
  链路（全部代码原文，`lock R143-补3` 有逐行号）：`worker` 的 work 链尾是 `fillTarget()` → **`upgradeController()`**（`worker.ts:70-72`），**只有 `harvester` 的链尾才会 `fillEmptiestContainer()`**（`harvester.ts:45-49`）；而 `fillBase` = spawn+extension+tower+**仅 controller container**（`room-snapshot.ts:117-120`、`contracts.ts:160-163`）⇒ **源旁 container 永不是 fill 目标**。现场几何（R143D3@83422457）：controller `(15,13)`、两 container `(31,14)=2 能`/`(26,19)=0 能`、`FIND_MY_STRUCTURES=2` ⇒ **该房 `fillTargets` 为空**（`targeting.ts:134-136`）⇒ **worker 采到的 104/窗 能量 100% 走升级**（累计 `upgraded:40`、同窗 `built:2` 对上了）⇒ builder 只能从 container 取能（`builder.ts:69`）而 container 恒空 ⇒ **两只 builder 恒 0 能**。
  ⇒ ⚠️【**本段"死循环"结论已被同轮 R143-补4 撤回，原文留在原位防丢上下文**】：`没有 spawn ⇒ 孵不出 harvester ⇒ 没人填 container ⇒ builder 取不到能 ⇒ spawn 工地不会完成 ⇒ 没有 spawn`。车道 `submitPioneers` 只组 `worker×2+builder×2`（`state-machine.ts:745-748`）**结构上送不出"会往 container 倒能量的角色"、也不送能量** ⇒ **它自己解不开这个环**。
  ★★**R143 补4（11:4xZ）：上面的死循环判定是假的，错在我只读了取能链的一半**。`builder.ts:62-81` 的 `acquire` 链是 `pickupDroppedEnergy → withdrawStorageCapped → withdrawClosestNonSourceContainer → withdrawClosestContainer →` **`harvestSource()`（注释原文"兜底：所有 container 无能量时直接采集"）** ⇒ **builder 不依赖 harvester 角色就能自己取到能**，第三环断掉。⇒ **#116 的正确定性**：不是结构死锁，而是**"builder 离开工位去源上自采 ⇒ 建造吞吐被压到能力的约 0.2%"**——这条代码注释自己量过：幼房同款病实测**工地 0.077/拍**，而同房三只 `2W1C2M` builder 的能力是 **40/拍**。我这几发看到的 0.02/0.07/0.22/拍 正落在这条病的形态里。
  ★**仍然站住的那半（竞争关系，不是死锁）**：`fillBase` 只含 spawn/extension/tower/**controller container**（`room-snapshot.ts:117-120`）⇒ 该房没有 controller container ⇒ `fillTargets` 为空 ⇒ **worker 链尾落到 `upgradeController()`**（`worker.ts:70-72`）。本窗实读 `bk={harvested:84, upgraded:147, built:32}` ⇒ **升级吃掉的是建造的 4.6 倍，且和工地抢同一份 source 再生**。⇒ 交给人的方向里，**"worker 兜底与 P0 工地抢收入"是可用证据；"编队缺 harvester 导致建不完"不是**。
  **预报改判（按我预写的判据，不挪带）**：`13,068@83422510` ⇒ 剩余 1,932、到 `83429857` 剩 7,347 拍 ⇒ 需 **0.263/拍**；实测长跨 **0.22/拍**、最后一窗 **0.64/拍**、再前两发 0.02/0.07。我 3 分钟前预写的撤案条件是"差分**持续** ≥0.26/拍"，现在只有单个 50 拍窗过线 ⇒ **原"预报 TIMED_OUT"降级为"临界/掷硬币"，不撤也不加固**。下一个自然观测点＝`kernel.bootstrap.until=83424757`（**wave7，≈2,250 拍后**）：车道每波补劳力，builder 数量上去会把同一条绕远路径的总吞吐线性推高。
  ★★★**R158 补13（14:0xZ）：#116 的现场状态被现实改掉 —— 该房已经自己孵出第一只 harvester**：`peek --keys creeps` 现读 **`harvester-W38S58-1-83424570-y7`**（名字里的房段是**孵化房**：sponsor 代孵的先锋在那里是 `W37S58`，所以这条 = **新房自己的 `Spawn7` 孵出来的**），同拍房内编制 `builder×3 + worker×2 + harvester×1`。⇒ 本条的定性从"编队里没有会往 container 倒能量的角色"改成 **"角色已经有了，接下来看它倒不倒得进"**（`harvester.ts:45-49` 的 `fillEmptiestContainer()` 是源旁 container 唯一的进能路径）。**下一发判据**：若两 container 开始有能量 ⇒ 新房内循环开始自持，"builder 离工位去自采"那条代价应同步缓解（工地速率应从 0.07~0.22/拍回到 builder 能力量级 40/拍的一小部分）；若 container 恒 0，则 #116 的代价定性照旧成立，只是换了成因。
  ★**方法论（今天第三次同形状，这条最该留住）**：R141"仪器不存在"=只 grep 写入侧；R142"通道坏了"=没读工具的包装代码；**R143"按构造死循环"=只读了 `builder.ts` 取能链的前半（grep 命中 `:69` 就收手，没看到同一数组里的 2.5 与 3 两步）**。⇒ **规则：宣布"某角色拿不到 X／某状态按构造出不去"之前，必须读完那条链/那个数组的全部元素**——链式 fallback 的**兜底项恰恰就是我会漏掉的那一项**。
  **预报（现在写死，不许事后改口径）**：工地还需 1,972、阈值 0.26/拍、到 `83429857` 剩 ≈7,400 拍 ≈5.4 小时，本轮实测 0.02~0.07/拍 ⇒ **预报 W38S58 在 83429857 那一拍 `abortExpansion(TIMED_OUT)`、第三次 claim 被放弃**。**反证形状**（任一成立即我错，当场撤）：①`progress` 差分持续 ≥0.26/拍；②`FIND_MY_SPAWNS≥1` 提前出现；③源旁 container 出现持续 >200 存量（说明确有角色在倒能）。
  **四条方向都属人，一条都不自办**：①车道编队加 `harvester`（改动最小，等于承认拓荒编队缺采集是设计缺陷）；②worker 链尾 fallback 由"升级"改"倒最空 container"（**影响所有 bootstrap 房**，把 controller 进度换工地进度，方向更激进）；③让车道真送能量（代价 = sponsor 库存）；④接受 TIMED_OUT 放弃这块 claim。⇒ 补一句量化：**这条环今天吃掉的不是"时间"，是第三次扩张本身。**

- **#117 新房 storage 在本服返回 `null` 容量，而 carrier 的卸能守卫是 `<= 0` ⇒ 已到房的 2,400 能量永远卸不下来（10-04 R145 立案；修法属设计决策，我零改码）**
  **现场**（`lock R145`，mark R145T3/T5，tick 83422694→83422721，全只读）：帝国全部 4 只 carrier 的台账里，**两只是 `home=W37S58 → remoteTarget=W38S58`、人已在 W38S58、背包 1200/1200 满载、mode=`idle`**，而该房 P0 spawn 工地只差 **1,930** 进度。同拍同表达式读三房 storage 做控制组：`W37S58=[used 794,905, free 202,675, cap 1,000,000]`、`W38S56=[119,355, free 880,270, cap 1,000,000]`、**`W38S58=[23, free null, cap null, my true, level null]`** ⇒ **只有新房那个 storage 的容量读数不是数字**（另两房一切正常：W38S56 的满载 carrier mode=`work` 且其 storage 30 分钟里 +3,461）。
  **代码条件（原文）**：`carrier.ts:36-45` 卸能最后一关是 `if (storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return undefined;` ⇒ **JS 里 `null <= 0` 为 true** ⇒ resolve 恒空 ⇒ **一次 `transfer` 都不会发生**；`execute` 里还有 `Math.min(carryUsed, free)`，`free=null` ⇒ 得 0 ⇒ **就算绕过守卫，卸出的量也是无效的 0**。⇒ 与"`Game.rooms.W38S58.storage` 从 83422337 到 83422721（≈380 拍）冻结在 23"完全一致。
  **顺带解释了一个我三轮当成怪形状的现象**：`carrierGate`（`:73-85`）见满载就置 `mode="work"`，work 链无候选 ⇒ `role-runner.ts:198-206`（"已在 `remoteTarget`"那一支）把 mode 置回 `idle` ⇒ 下一拍又 work…… ⇒ **"满载 + idle"就是这个每拍往返**，不是 creep 坏了、也不是它们在过境。
  **为什么不自办**：修法要先回答 `getCapacity()=null` 的语义（"未知"还是"无限/不适用"），以及按什么口径决定卸多少（**`level` 同样返回 null ⇒ 没有可靠的 RCL→容量回退依据**）。两条出路都属设计决策：**①** 给 store 读数加显式 null 语义（null ⇒ 视为"未知但可卸"，按 `carryUsed` 全额尝试、靠 `ERR_FULL` 回退）；**②** 新房建成 spawn 前不依赖 storage 交付，改走 container 目标。**取舍等人；我不改码、不动任何阈值。**
  **对既有各条的排序影响**：①**#116 那四条"要不要给拓荒编队加采集角色"的取舍，排在本条之后**——本条不修，加了角色也填不进这房；②§4.0 的"临界/掷硬币"要加限定：**carrier 一旦能卸能，1,930 的缺口被一次性超额满足**；③与 R141 那条"本服至少一种工业结构 `.store` 为 undefined"同族 ⇒ **本服对部分结构返回 null/undefined 读数**，凡按 `<= 0` 判"满/空"的代码都要按这条复检一遍（不是我该顺手改的范围）。
  **范围已按调用点核完（R146，防把整类读数一起判死）**：`src/` 里 `get(Free|Used|)Capacity` 共 **294 处**，其中与 0 直接比较 **83 处**，但**绝大多数作用在 `creep.store`（不会返回 null ⇒ 无害）**；作用在**结构 store** 上的只有 6 处 —— **`carrier.ts:44` 正在发作（本条）**；`fill.ts:160`（往 storage 填能）、`industry.ts:424`（工业回储）、`harvest.ts:170`（link→storage，null 时 `> 0` 为假 ⇒ 被当成"已满"跳过）、`pb-collector.ts:53` 同形但**该房暂无对应角色/结构 ⇒ 潜伏**（核心房 storage 实测 `[free 202,675, cap 1,000,000]` 正常，不受 link 那条影响）；`carrier.ts:17`（取能侧用 `getUsedCapacity`，实测返回数字 23）**不受影响**——null 只出现在 free/capacity 两个读数上。
  ★**一条已核过的负向结论（别扩大影响面）**：决策位 `storageNearFull` 的计算（`room-state.ts:306-314`）**先过 `storageCapacity > 0`** ⇒ null 时短路成 **false**，**不会把"读数缺失"误报成"仓将满"**，其三个消费者（`spawn-manager.ts:157`、`factory-manager.ts:58`、`industry.ts:459`）不被污染 ⇒ **受影响面只有"动作守卫"这一类**。
  ★**R157 把代价从"停滞"改写成"持续追加投入"（两处新读数，全只读）**：①**冻结时长可量化** —— `Game.rooms.W38S58.storage` 从 `83422226` 到 `83423725` 恒为 **23**（**≈1,500 拍**），期间至少两只满载 1,200 的 carrier 在该房里 ⇒ **"送得慢"这个说法可以排除了**。②**帝国还在为这条线路加造运力** —— sponsor 队列里除先锋请求外还有 **`carrier:supply:W37S58:W38S58:energy`（priority 0、body **36 件**、createdAt 83423672）** ⇒ 正在再造一只 36 部件的 carrier 去服务一条卸能端被 null 守卫锁死的线路。⇒ 给人的准确表述：**"这不是单次交付失败，而是供给机制按'线路存在'继续下单"**；⚠️我只到"正在为该房生产 carrier"这一层，**"造完之后必然闲置"是外推，我没写进结论**。
  · **同轮反向自查（不下无据的缺陷判定）**：先锋请求 `expansion:builder:W38S58:1` 在队列里挂着，但 `spawnBlacklist={}`、`spawnStarvationCount=0`、`retries=0`、六口 spawn 有 3 口空闲、`ea 8,388 ≥` 该 body 成本 ⇒ **判"被拒"不成立，现在是"排队中"**；已预写下发判据（≤100 拍内应开始孵化/出队；若 `retries>0` 或该 key 进黑名单才升缺陷）。
  ★**R148 复现 + 一条带时刻的可证伪预报（12:1xZ）**：#117 的发作面**自己复现了**——逐只读 `R148T2@83423036` 见 **`carrier / mode=idle / 背包 1,200 / ttl 244`，人就在 W38S58**（我 R147 写给下一轮的复查项提前撞上）；同拍 `builder×2` 是 **`work` 模式各背 200** 正往工地走。**预报**：这只满载 carrier 将在 **≈83423,280** 到期死亡 ⇒ 若我的判读成立，**死后 ≤300 拍内应同时看到 ①`FIND_DROPPED_RESOURCES` 出现合计 ≈1,200 的能量堆（builder acquire 链第 0 步正是 `pickupDroppedEnergy()`）与 ②`progress` 跳升数百点**。**反向情形同样重要**：若掉落出现而工地不动，或工地在无掉落时自己跳，则本条要降级为**"#117 卡的是 storage 入账，而工地靠死亡掉落能量在走"**——两种定性的修复优先级完全不同，我按实读判、不偏向自己上一轮的结论。⇒ 这条预报真正的价值在于：若成立，**第三次扩张的施工资金链建立在"以 creep 生命为代价的非设计路径"上**，那是可以直接进 §3.5 的定性。
  ⚠️**同时更正本条上面那句"所需的 0.263/拍 没有来源"**：R146 已按预写判据撤掉"必然 TIMED_OUT"（最长跨 0.275/拍 对所需 0.253/拍，余量 8.7%）⇒ **有来源，但来源是"背包 + 掉落"的一次性释放，不是持续供给**；另记一条**读数不自洽**（同一房内 10 拍之差 `mc` 从 2 变 4，我没能解释）**不当证据用、不据此改结论**。前置自检两条：`check-code` 仍 `649eb94b9784` ⇒ 自 83422285 那次部署后**线上未再换码**（本窗 A/B 前提有效）；`git fetch` 后 `origin/dev...HEAD = 0 14` ⇒ **无人 push**。
  ★**R149 预报检验结果：行为级确认 + 我的机制判读被部分否证（按实读，不偏袒自己）**。三拍连读（`R149T1@83423074`／`R149T2@83423085`）：①工地 **13,238 → 13,638 = +400/38 拍**，而这 400 **正好等于上拍两只 builder 手里各 200 的投放**（投放后两只都回到 `acquire/0 能`）⇒ **不是新供给**；②**`remoteTarget=W38S58` 的那只 carrier 现在人在 `W37S58`（home）、仍满载 1,200、仍 `idle`** ⇒ 它在目标房待了一整轮**一克没卸就走了**——**这是 #117 的行为级证据**（此前只有"守卫条件 + 读数为 null"的静态证据）：**不是卸得慢，是根本进不到 `execute`**；③房内另出现一堆掉落 `472@(49,16)`，11 拍里从 483 衰减到 472 ⇒ **正在衰减、暂时没人捡**；它**来源我没定住**（carrier 总数确实从 R145 的 4 只降到 2 只 ⇒ 有 creep 死了，但我没把"哪一只死在哪"钉到证据上，`deathByCause` 只在 heap）⇒ **只登记、不定因**。
  ⇒ **对照我预写的两个分支**：预写是"carrier 死 → ≈1,200 掉落 → builder 捡 → 工地跳"；实到的是"工地跳的量＝builder 手里原有存货，而那只 carrier 没死、带着满载离开"⇒ **"施工靠死亡掉落"从"已证"降为"未定因"**，而**"carrier 无法交付"由行为坐实**。剩余需求随之下降：`1,362 / 6,772 拍 = 需 0.201/拍`（比上发 0.253 低两成，因为这一跳）。
  ★**下一发看什么（预写死，别自由解释）**：①`drop` 是否被收走（变小/归零＝掉落确在供给工地；一路衰减到消失＝**该房能捡掉落的 creep 不在场或不够**，那是另一条独立线索）；②`progress` 是否再跳（两次跳变 168 与 400 都是"存货投放"形态）；③`waves` 是否 6→7、`until` 是否重写——**R147 已读到门禁 `submitPioneers` 需 `hostiles.length===0 && spawningAllowed`，本轮 `hostile=0` ⇒ 若 83424757 之后仍 `waves=6`，就说明拦它的是 `spawningAllowed` 那一侧（预算档位）**，这会把问题从"敌情"转到"G6/CPU"。
  ★★**R158 补2（13:2xZ）：这条缺陷第一次配上"价格"，同时把守卫顺序读完 ⇒ 取数式必须加一列**。①**同一只个体两次复采**（`83423837 / 83423991 / 83424085`，按 `name` 逐字锚 `carrier-W37S58-0-83423173-x0`）：**站在自己的 `remoteTarget=W38S58`、1,200/1,200 满载、`mode=work`（下一拍被 `shouldIdleWhenNoCandidate` 打成 idle ⇒ 就是"work↔idle 每拍往返"）**，同拍该房 `storage.store.getUsedCapacity=23`（正常）而 `getFreeCapacity=null` ⇒ `carrier.ts:44` 的 `<= 0` 守卫恒真、**进不到 `execute`**（R149 的行为级证据这次有了代码行号）。**价格：1,200 = 当时工地剩余 395~539 点的 2.2~3.0 倍，且这只 ttl 只剩 695 拍 ⇒ 它会带着 1,200 死掉。**②**守卫顺序（决定发作面边界）**：work 链 ①`:39` 无 remoteTarget → ②**`:41` `room.name !== remoteTarget`（站错房根本不试）** → ③`:43` 无 storage → ④`:44` 的 `getFreeCapacity <= 0`（null 时恒真）⇒ **"满载停在某房"有两种成因**（导航 vs 本服读数缺陷），**所以复采必须带 `room.name === remoteTarget` 这一列**；我 R158 补1 一度把两者混成一只（把另一只过境个体 `73-wz` 的 `remoteTarget=W38S56` 安到了它头上）并据此"撤销 #117 归属"，**该撤销已当场撤回**，事实与 R149 一致。③**CP5 侧同一批数据第一次可数**：`estimateExternalInflow`（`state-machine.ts:848-853`）= `querySquad(role=carrier, remoteTarget=target).filter(home===sponsor).length × 50` ⇒ 现读 **2 只**（`48-xg` 在 home 装货、`73-x0` 已站进新房）⇒ **名义 100/拍外部流入 ⇒ `selfSustaining` 恒假 ⇒ CP5 的自然完成路径按构造不可满足**；这条与 #117 是**同一个体的两面**：线不断则 CP5 永远点不亮，而线通了也卸不进去。④引擎常量按现场落一格：**每 CARRY 部件 = 50 能量**（`carry=24 ⇒ 1,200`）。

  ★**R158 补8 追加一条作用域更正（改我此前"受影响面只有动作守卫这一类"的说法）**：`room-snapshot.ts:114-120` 的 `fillTargets = fillBase.filter(s => s.store.getFreeCapacity(ENERGY) > 0)` 用的是**同一个 getter、方向相反** ⇒ null 时该结构被整个**移出 fill 目标**。⇒ 若新房那只新 spawn 也返回 null，则"建成后有人往里放能量"这条 **CP2 通路按构造不成立**。⇒ **修法的作用域因此是 getter 层（所有结构 store 的容量读数），不是 `carrier.ts` 一处**；这属设计决策，我不自办。判别位现写在这里：命中"建成后 `ea` 长期为 0"时，第一发读数是 `Game.rooms.W38S58.spawn.store.getFreeCapacity(energy)` 是不是 null，而不是"worker 有没有在干活"。
  ⚠️**R158 补9 把上面这条"作用域＝getter 层（所有结构 store）"降级**：`83424480` 实读 **`Spawn7.store.getFreeCapacity("energy") = 240`（数字）**、`ea` 已从 0 涨到 **60** ⇒ **同一间新房里 storage 返回 null、刚建成的 spawn 返回正常数字** ⇒ null 是**逐结构**现象，不是按 getter 或按房统一发作。**修法作用域要按结构类逐个核**（carrier 那条守卫与本房的 storage 是实测两例；fill 侧的筛子对新房 spawn 不构成阻塞）。上面那条判别位仍然有效（先读 null 再谈"人不干活"），但**它的结论这次是"不是 null"**。

  ★★**R160 现场增量（10-04 15:3xZ）：审计那条"0 送达循环"拿到第二条支路，而且绑住的不是 `checkExpiry`**：`kernel.agendas@83425870` 两条 op 已变 `retries:1 / updatedAt:83425772 / lastError:"reservation expired"`，而 `status` 仍是 `running` ⇒ 走的是**预留 TTL(500 拍) → `markBlocked` → `retryFromBlocked`(ready) → 步 14 running**（`agenda-manager.ts:249-275`），`audit/units/TR.md:121-124` 主文写的"卡在 running 直到 `checkExpiry`(deadline 2,000 拍)"在这条房上**不会是先到者**：`3 次重试 × 500 = 1,500 拍 < 1,932 拍（距 deadline）` ⇒ **`maxRetries=3` 先到 → `markFailed` → 终态保留 1,000 拍 → 同 id 重建、retries 归零**。⇒ 可证伪预报（下一发 `peek kernel.agendas` 即可判）：`createdAt=83425272` 这两条的 `retries` 应在 ≈`83426272` 前后到 3，随后条目转 `failed` 或消失并由同 id 新条目接管；**若读到 `status:"expired"`（真走到 deadline）⇒ 我这条支路判错、审计主文对**。账本含义不变：`deliveredAmount` 全程 0 ⇒ `inTransitByTarget` 每轮按 `requested` 全额扣该房 demand（3,400 与 1,800）。
  ★★**R160 补14：上面这条"支路预报"被现场否证，撤回（按我自己预写的判据认账）**：`kernel.reservations = {}`（16:25:14Z 现读整张表空）而两条 op 仍 `running`、`updatedAt=83425772` 未动 ⇒ **83425772 那次是预留被 sweep 的唯一一次**，且 `createReservation` 只在 **op 创建点**调用（`agenda-manager.ts:462-469`／`:516-520`），blocked→ready→running 的回路上**不会重新登记预留** ⇒ **第二次扫不到触发源**，下一次状态变化必然来自 `checkExpiry` 的 `tick > deadline`。⇒ **审计主文（TR.md"卡在 running 直到 checkExpiry(2,000 拍) → expired → 同 id 重建"）是对的**；正确的周期是 **2,000 拍一轮**（`TERMINAL_RETENTION=1,000`(`:71`) 让 `expired` 留在表里到 ≈`83428204`，同 id 新 op 在下一趟 `interval:100` 就重建、`retries` 归 0、新预留新 deadline）。⇒ 判据改写：**≈`83427204` 读 `kernel.agendas` 应见 `status:"expired"`**；见到 `failed` 则本节仍要再改。账本含义不变（每轮 `deliveredAmount` 从 0 起、demand 被按 `requested` 全额扣）。
  ★★★**R160 补23：本条（含上面两支）里"0 送达循环"这个说法说重了，正确口径是"每代 op 归零一次"，并且现在有控制组了**：新一代 op（`createdAt 83427272`、`retries 0`、`deadline 83429204`）**把 `carrierName` 绑到了活 creep**（`carrier-W37S58-0-83425773-ze/-zf`），于是 W37S58→**W38S56** 那条当场出现 `status:"verifying"` + **`deliveredAmount:1200`** ⇒ 交付检测（`agenda-manager.ts:610-620` 要 `Game.creeps[op.carrierName]` 存在、在 target 房、空载）**在绑定命中活 creep 的那一代是能正常入账的**。⇒ 审计"`carrierName` 永不清除"仍对（83425272 那一代确实绑着 `xf/xg` 两个死人名字 ⇒ 整代 0 送达），但**损失单位是"每一代 op"，不是"永远"**；本节上面那句"0 送达循环成立"要按此降格读。
  · **控制组（干净的定罪）**：同代、同样活绑定的两条线，`imported` 累计 **W38S56 = 71,985**（15:3x 的 47,605 → +24,380）而 **W38S58 = 0**（自 boot 83422285），其 op 的 `deliveredAmount` 也为 0 ⇒ **两房之间唯一机制差别就是目标房那间 `getCapacity()=null` 的遗留 storage**（`carrier.ts:44` 的 `null <= 0` 为真 ⇒ 拒卸）⇒ #117/#122 由"现场形状 + 常量解释"升为**有对照组**的定罪（正向同 sponsor／同代次／同活绑定，反向换房即恢复）。
  · **保留期更正**：旧代的 `expired` 行**没有**留在数组里（`pruneTerminal`/`saveOperations` 在同 id 已有活跃 op 时不留终态行）⇒ 我 16:1x 写的"以 `expired` 形态保留 `TERMINAL_RETENTION=1,000` 拍"**只在没有新活跃 op 时才成立**；判"是否重建过"要看 `createdAt` 是否换代，而不是去找 `expired` 行。
- **#120 破产兜底把"存在 storage"当成"有银行"⇒ 一间 capacity=null 的遗留 storage 把幼房永久钉在 crisis（10-04 R159 补1 立案；修法属设计决策，我只摆数）**
  现场（全部有出处，见锁 `R159 补1` 与 §4.0 同轮块）：W38S58 `rcl=2`，`structs=["controller","storage","spawn"]`，该 storage `my=true / used=0 / getFreeCapacity=null / getCapacity=null`，且 `buildQueue` 里**没有** storage 条目、`ticksToBuild=undefined` ⇒ **不是我们造的，是接管该房时引擎侧留下的**。
  机制链：`room-state.ts:139-144` 把 `storageRatio = used/cap = 0/null = 0`（**不是 `undefined`**）喂给 `phase.ts:467 hasBank` ⇒ `:528 bankrupt` 生效 ⇒ `phase="crisis"`（现读 `drainScore/liquidityScore/srcStallTicks/bootstrapTicks` **全 0**、`bandTicks 1710→1762` 在涨 ⇒ 排除其余五支，逐支核过原文）⇒ `phaseToColonyState`(`:558-563`) 给 `colonyState="recovery"` ⇒ `room-profile.ts:292-293 isStruggling` ⇒ `needsEnergyAid` 第①条恒真 ⇒ **每 100 拍给一间"物理上收不下能量"的房重产一条援助 op**（`carrier.ts:44` 的 `null <= 0` 为真 ⇒ carrier 永不卸能；这条与 #117 同源，本轮把 #117 的根因收窄成"`STORAGE_CAPACITY[level]` 在 RCL2 无值"）。
  代价（可测的部分）：①该房出不了 `recovery` 的**唯一出口是绝对水位线 `sustainedStorage(10,000) × bankruptExitMargin(1.5) = 15,000`**（`reserve` 现读 1,718；按单窗 +3/t 只能给区间 ≈3,000~13,000 拍，速率出处仅一发 52 拍窗 ⇒ 不许当承诺）；②**扩张 CP5 的 `selfSustaining = externalEnergyInflow===0 && netPositive`（`economic-activation.ts:87-89`）在这条线到手前不可达**，因为 `externalEnergyInflow`（`state-machine.ts:848-853`，carrier 数 × 50）由①那条不自退的援助线供给；③`empire-health`／G3／G4 的消费方持续吃一个"恢复态"标签（今天 dashboard 五道红里的 G3/G4 与此同源，未逐项归因）。
  注意**收入不是解药**：该房 `netFlowMean_d=+7.7`、`reserveDelta=+4` 都已为正，仍在带里 —— 谁若提"给它多灌能量"，要指出灌进去的落点正是那间存不了东西的 storage。
  选项（都不自办）：①`hasBank` 改判"capacity 可读且 >0"（最小语义修正，把"有对象"与"有银行"分开）；②`room-state.ts:139-144` 在 `cap` 为 null/NaN 时传 `undefined`（把修正放在输入侧，一处影响所有消费方）；③对遗留结构特判该房（最脏，不推荐）。**未定则默认维持现状**：幼房继续被记 `recovery`、援助线继续每 100 拍重产、CP5 继续不可达。
  ★登记一条判读边界（**本轮同轮内被自己收紧过一次**）：①"援助落不进 null-capacity storage"这一条是**按构造**的（`carrier.ts:44` 的 `null <= 0` 为真，与水位无关）；②"reserve 攒到 15,000 就能出带"这句**已被同轮下一发读数作废**——该房结构侧承载上限只到 ≈**4,300**（两 container 各 2,000＋bay 300，`ext=0`），而抬高上限的三条路全依赖 RCL/结构增长，`crisis/recovery` 标签本身又在压建造通道 ⇒ **在现等级下退出线按构造到不了**，这才是这条自锁的真实形状。我先后写过"colonyState 自己会翻"（15:0x）与"有界、3,000~13,000 拍攒得到"（15:2x），两支都留在原文里不删，防下轮只看到收敛版而不知道证据是怎么走的。**教训：任何以绝对水位为出口条件的闸，判可达性之前必须先算那间房装得下多少。**

  ★★**R160 更正（10-04 15:3xZ，当轮内把上面这条打折）**：`phase.drainScore` 从三连读数的 **0** 变成 **57.06**（`reserve 2,354→2,214` 第一次下跌），⇒ `crisisScore=57 ≥ drainExitScore(30)` ⇒ **`:519` 的分数支此刻也在独立地开 crisis**。所以本节上面那句"出带只欠 reserve≥15,000 这一条绝对水位线"**不再完整**：出带现在要同时满足 `reserve ≥ 15,000` **且** `drainScore ≤ recoveryClearScore(5)`。⇒ **复证判据按此升级**（下一轮照此读，别再用单指标定罪）：**"一段窗口内 reserve 顶到承载天花板 且 该窗口内 drainScore 的最大值 ≤5 时，phase 是否仍 crisis"**。⚠️**同轮内（R160 补1）我自己把这条又修了一次**：`drainScore` 是**脉冲＋快衰**量——`57.06@83425855` 与 **`0@≈83425,9xx`（reserve 反而涨到 2,647）** 相隔百余拍，因为正 `reserveDelta` 那拍的回落系数是 `(|Δ|/3)×recoveryBias(2.67)` ⇒ **随机读一发既能抓到 57 也能抓到 0，两个瞬时值同拍对齐这个要求是按构造几乎测不到的**；正确做法是用守望序列取 **max**，别取最后一发。仪器：`tmp/observe/r160-agendas.log`（pid 45277，120s×22，每拍同时打 `phase/reserve/drainScore` 与两条 op 的 `status/retries`）。同轮另一条把方向钉死的读数：该窗 `bk={harvested:92, pickedUp:50, spawned:300, built:50}` ⇒ **支出里 300 是孵化、只有 50 是建造** ⇒ 我原本想写的"建造在给 crisis 记分"本轮**不成立**（这一窗不成立；判定要跟着 `bk` 的列分配走，不能跟着分支顺序走）。控制面同时收窄：两 container 的 `getFreeCapacity` 实读 514/1,414 是**正常数字** ⇒ null 只发生在 storage 上，#117 作用域第三次收窄。
  ★★**R160 补2（10-04 15:4xZ）：这条的严重度上升，而且"偶发"两字要划掉**：常量现读 `CONTROLLER_STRUCTURES[STRUCTURE_STORAGE] = {1:0,2:0,3:0,4:1,…}`、`STORAGE_CAPACITY = 1000000`（平值标量 ⇒ 我 15:2x 写的"`STORAGE_CAPACITY[level]` 无值"撤回，见 §3.5 #117 同轮更正段）、`ruins=0`、`storage.my=true` 且无参 `getCapacity()` 也为 null。⇒ 机制是**"结构在场但 RCL 未到 ⇒ store 被引擎禁用"**，而"接管一间前主留下的房 ⇒ RCL1-3 期间 storage 对象存在却不可用"是**这类房的常规阶段**，不是异常数据。⇒ **结论改写为：每个带遗留 storage 的接管房，在爬到 RCL4 之前都会被 `bankrupt` 支按绝对水位线钉住**（本例退出线 15,000 vs 天花板 ≈5,300，**R160 补3 按构项重算**：4,000(两 container 各 2,000) + 300(bay) + `creepEnergy`（按 home 归集，该房 8 只 ⇒ ≈1,000~1,500；现读 `reserve=3,047` 已比结构侧存量多出 ≈827，就是这一项）。旧值 4,300 漏算 `creepEnergy`，作废）。**★R160 补5 把天花板改写成两档（并删掉我上一版"远小于"这个形容词）**：`R160C5@83426121` 现读 `CONTROLLER_STRUCTURES[STRUCTURE_CONTAINER] = {0:5,…,8:5}`（**每一级都允许 5 只 container**）、`CONTAINER_CAPACITY = 2000`（平值标量，与 `STORAGE_CAPACITY=1e6` 同族 ⇒ 再次支持"null 来自 RCL 门槛而非容量表"）。⇒ ①**现建成档** = 2×2,000+300+creep ≈ **5,300**；②**法定满建档** = 5×2,000+bay+creep ≈ **10,300~12,000**。两档都低于带内退出线 15,000，但满建档只差 25%~30% ⇒ **"差得远"这句撤回**，正确的定性换成更硬的一条：**够到 15,000 所需的那一级容量恰好锁在 RCL4 的 storage 里**（`CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][4]=1`），而跨房 carrier 的货按 `home` 记账、不会算进本房 `reserve` ⇒ 该路也不通。⇒ 复证报告必须写清命中的是**哪一档**（守望 `reserve≥4,000` 只到第一档）。。⇒ 另外补一条对本节的修正：**CP4 本身不被 RCL 门住**——`CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION]` 在本服是 `{2:5,3:10,…}`，RCL2 的 extension 限额恰为 5 ⇒ `state-machine.ts:457` 那句注释 "RCL2 = 5 extensions" 在本服成立 ⇒ 扩张链上"被 storage 门住"的只有 **CP5 的 `selfSustaining`**（要 carrier 线停）与**援助能否落进 storage**（要 RCL4），CP4 是纯建造进度问题。
  ★**R160 补12 给本条补上最后一环（措辞只能到"疑似"）**：解 `bankrupt` 要 RCL4（补9 逐级表），爬 RCL4 要 upgrader，而该房 **既没有 upgrader 在编、需求又疑似没落地**——`R160D5@83426445` 现读 `spawnQueue` 全长 2 条且全是 hauler（`hauler:W38S58:0/1`），角色普查也无在孵 upgrader（`FIND_MY_CREEPS` 含孵化个体），而 `demand.ts:919/940` 两支都给出 `upgraderTarget ≥ 1`（`economyPressure=0`、`minCount=1`）。⇒ **判据（零新码，连读 3 次隔 ≥100 拍）**：三次都"队列无 upgrader 且 target 应为 1"⇒ 坐实需求丢失（#116 家族）；任一次出现 upgrader 条目 ⇒ 只是 TTL 错峰、本条作废。⇒ 本条的时间尺度因此不是"等 reserve 攒够"，而是"解闸所依赖的那级结构，眼下连投需求的通道都疑似断着"。共同前提见 **#122**。
  ★★**R160 补13：天花板改成"量出来的"，并把本条的复证拆成两半（防下轮用结构证据顶替事件证据）**：`R160D6@83426548` 实测 `bayCap=300`、`contCap=[2000,2000]`、`storeCap="null"`、`term=none`、`links=0`、`contUsed=[2000,1528]` ⇒ **现结构承载天花板 = 4,300（实测，与推算逐字相等）**，退出线 15,000 是它的 **3.49 倍**；法定满建档 10,550 = 0.70 倍。⇒ 本条的复证由两半组成：**①"顶到"（L2 事件）**——第 2 只 container 正以 ≈1.3/拍 填充（1,232→1,528/2,000），`reserve` 16:19→16:22 从 3,720 涨到 3,856 ⇒ 预计 ≈16:30Z 顶格，守望 `tmp/observe/r160-l2.sh`(pid 50342，180s×16) 判据写死 `reserve ≥ 4,250 且 phase=crisis 且 表内 drainScore max ≤5`；**②"退出线高于天花板"（已成立）**——由实测 4,300 vs 15,000 与逐级表给出。⇒ **若 ① 没命中（例如在 4,000~4,250 就回落），本条按字面仍判"事件级复证未到手"**，不许拿 ② 顶替。旧表 `r160-ceiling.sh` 已停（阈值 4,000 与实测容量不匹配，且第 19 拍出现 NET-FAIL ⇒ peek 侧疑似限流过一次，新表降频到 180 s）。
  ★★**R160 补18：本条的复证到手（推算 → 观测）**：`83426870` 同拍两把仪器——`phase={phase:"crisis", reserve:**4,363**, drainScore:0, liquidityScore:0, srcStallTicks:0, bootstrapTicks:0, bandTicks:2,918, rcl:2}` 与 `R160D9` 物理侧 **`contUsed=[2000,2000]`（两只 container 满到 capacity）**、`ea=17`、`storeCap="null"`、`ext=0`。⇒ 该拍 `:517/:519/:521/:524/:526` 五支全不可用 ⇒ **只有 `:528 bankrupt` 能产出 `"crisis"`** ⇒ "退出线 15,000 高于天花板"由"等不到水位"升为"**已经顶到物理上限还不放行**"。⇒ 天花板引用值改写成 **≈4,300~4,400**（4,363 = 结构侧 4,300 + `creepEnergy` 63）。⚠️诚实两条并列：我定的"窗口内 `drainScore max ≤5`"这一形式**没满足**（16:25:21 那拍是 14.33 的分数脉冲），到手依据是**同拍分支排除法**；分数通道确实在同一小时内挡过一次（14.33 ⇒ `:521` 给 `recovery`），这条保留不删。
  ★★**R160 补15：判据定稿（覆盖补11/补13 的写法——同一件事收敛到第三次，都留痕不删）**：守望第 2 拍现读 `{phase:"recovery", reserve:3,727, drainScore:14.33}` ⇒ `crisisScore=14.33` 过 `:521`（>5）而不及 `:519`（30）⇒ **phase 在带内降级，不是出带**，而且此刻挡它的可能是分数而不是水位。⇒ 三条同时成立才算复证到手：**①"仍在带内"用 `bandTicks` 单调递增判**（出带才归零，`:490`+`:537`；`phaseToColonyState` 把 crisis 与 recovery 都映射成 `colonyState="recovery"`(`:558-563`) ⇒ **字面 `phase=="crisis"` 不是好锚**，援助线与 CP5 的 `externalEnergyInflow` 在这一段完全不受降级影响）；**②"是 bankrupt 单独在挡"用窗口内 `drainScore ≤ 5` 判**（否则 `:521` 的分数通道也在挡，不能归给水道）；**③"顶到天花板"用 `reserve ≥ 4,250`（实测容量 4,300）判**。⇒ 守望表的 `POSITIVE-HIT` 只编码了窄版，**判读以表的序列为准、不以 HIT 行为准**。
  ★★**R160 补22（本条多了一条"它还在别处咬人"的证据）**：`bankrupt` 钉 crisis 时 **`drainScore` 可以是 0 ⇒ `economyPressure=0`**，而 `spawn-manager.ts` 第 4 层降级门（唯一能用于 `priority 2` 的那层）要求 **`pressure > 0.5`** ⇒ **幼房的 P2 降级被自家 pressure=0 关掉**（实测 `degradeGateClosed +888/18 分钟`），bay 又因 `ext=0` 卡在 300 ⇒ **builder/hauler 换不上、extension 工地 250 拍零进展 ⇒ CP4 由"慢"改判"停"**。⇒ 于是这条自锁不止"挡住扩张闸门"，它**同时掐断了让自己出带的那条建造路**（详见 #124 的补22 段与两环未证清单）。
  ★**本条的"天花板"在 R160 补9 已升级成逐级表（在下面的 #121 块里，同一次读数出的两半）**：RCL2 法定满建 **10,550**／RCL3 **10,800**／**RCL4 才解锁 `STORAGE_CAPACITY=1,000,000`** ⇒ 退出线 15,000 在 **整段 pre-RCL4 窗口**按构造够不到（可证伪边界：现读 `phase.reserve ≥ 15,000` 且 `rcl < 4` ⇒ 作废）。
  ★方法论（第三次同轮自纠之后又加一条）：**分数型判据不能只读一次**——我在 15:2x 用三次读数（全 0）确立了"只欠水位"的说法，第四次就把机制改成了"水位＋分数双发动机"。凡是"当前哪个分支在开闸"这种结论，落笔时要标**读数次数与时间跨度**，并在下一轮无成本复采一次（`peek rooms.<r>.phase` 一发就够）。

  ★★★**R160 补20（10-04 16:4xZ）〔这一块按插入顺序落在 #120 末尾，但**内容属下面的 #121**——"builder 断供"是比 site 名额更靠前的那根杆；读 #121 时请连同本块一起读〕：CP4 的建造速率现场归零过一次，原因不是"缺需求"——这根杆比上面两根更靠前**：`R160E1@83426952` 现读 **`bld=0`**（该房 builder 全死，工地停在 `[ext 286, ext 1,806, ext 0]`）；`R160E2@83426966` 现读队列 **3 条含 `builder:W38S58:1`（age 115、retries 0）**、`hatching=["null"]`（**spawn 空闲**）、**`ea=113`**，而 `R160D9` 同窗口两只 container 是 **4,000/4,000 满的** ⇒ **"房里有钱而孵化口没钱"**。`spawnRejects` 差分（16:14→16:48）：`budget 996→1,848`（+852）、`degradeGateClosed 31→1,136`（+1,105）、`reserveOnly 49→303`（+254），`survivalBlock`/`noDegrade` 不动；`spawnBlacklist` 不存在 ⇒ **需求投了、没被隔离**。⚠️**但当前这一拍的绑定原因按字面要分开写**：`ea=113 < 300`（最便宜 body `3C3M` 恰 300）而 `noDegrade` 没动 ⇒ 与代码注释"**等能量不是失败**"（`spawn-manager.ts:463-467`）一致 ⇒ **不能拿"+852 budget"说这一拍被 CPU 门拒**，那是历史累计。
  · **判据（零新码，下一发判）**：`ea` 在一两个 hauler 往返内回到 ≥300 且 spawn 开始孵 `builder:W38S58:1` ⇒ 只是瞬时能量不足，属 **#116 家族一档**，本条撤；**若 `ea` 长期 <300 而 container 恒满、spawn 恒 `spawning=null`** ⇒ 搬运链没把能量送进 bay（`fillTargets` 本应含 spawn/extension）⇒ **新缺陷单独立案**，它同时解释 CP4 停滞与"#120 越拖越出不来"。
  · **对 #121 ETA 的影响（必须写）**：补16 的 `13,300~20,800 拍` **只在 builder 在场时成立** ⇒ 当前速率 0，恢复条件＝上面那条判据命中；**不许把"速率区间"继续引用成"还有多久到手"**。
  · **★★★★R165（20:3xZ）本条的"天花板"不再依赖我的算术——`reserve` 恒等式现场闭合到个位**：`R165E1@83430482` 逐项现读 **引擎自己报的容量**＝`energyAvailable 300`（＝`energyCapacityAvailable 300`，0 extension）＋ 2 只 container 各 **`getUsedCapacity/getCapacity = 2000/2000`**（⇒ **`CONTAINER_CAPACITY=2000` 与"2 只满载"由引擎口供确认，不再是我引的常数**）＋ storage `used=0` ＋ terminal 无 ＋ links 0 ＋ **9 只 creep 携带合计 280**（三只 upgrader 全 0）⇒ **300+4,000+0+280 = 4,580**，而 `Memory.rooms.W38S58.phase.reserve = 4,580` —— **逐位相等**，`room-state.ts:43-51` 的构项式（`energyAvailable+Σcontainers+storage+terminal+creepEnergy`）当场验通；**R167 第二次样本复现（关键在携带项会变）：`ea 300 + container 4,000 + 携带 97 = 4,397 == phase.reserve 4,397`，而两发之间携带由 280 降到 97、`reserve` 同步跟到 4,397 ⇒ 这是被证实的关系，不是拿一个数凑对**。⇒ 于是 objective 第三支的措辞升级：不是"reserve 接近天花板"，而是**"此刻它等于 结构承载 + 全部在途携带，一点不剩"**；而出带线 15,000 与该式的**最大可能值**（5 只 container 10,000 + 满池 300 + 5 extension ≤500 ＋ 携带：本拍实测 280，按编制上界**宽松**取 ≤2,400）＝**≤13,200 < 15,000** 差约 1.4 倍以上，**container 数在 RCL0-8 恒 5** ⇒ 这道差距不随等级在这个量级上缩小，只有 RCL4 的 storage(1e6) 能一步跨过。（携带那一栏故意取宽上界而不用今天的 280——**薄样本不该替结论承重**；即便取到 2,400 结论仍成立，且这一栏随编制的变化是我留的误差项里最不确定的一项。）⇒ 复证判据里那条坏锚（字面 `phase=="crisis"`）继续弃用，改挂在这个恒等式与 `bandTicks` 递增上。
- **#121 扩张 CP4 的两根加速杆（都是排产/阈值决策，我只摆数、不自办）（10-04 R160 补6 立案）**
  · **防重犯注记（R165 补5）：`claimSecure` 不是第三根杆。** 我一度据 `queue.ts:335 if (inputs.claimSecure) return "claim-secure"` ＋ 现读 `rooms.W38S58.claimSecure=true`（控制组 W37S58=false）推出"即使修好需求侧，2 张 queued extension 也变不成 site ⇒ CP4 卡在 3/5"。读到调用点即否证：`construction-manager.ts:127-139` 在**严格门禁被拒时落到 R2 关键发展通道**（`normalGateReason !== "ok"` 分支仍走 `tryCreateSite`，明确放行 extension / controller container，注释自陈目的就是"修复 RCL2 停摆闭环"，且照常受配额约束、消耗 normal 槽位）。**现场第二重反证：3 张 extension 工地与 `logistics.container.controller` 任务本身就产生于 `claimSecure=true` 期间** ⇒ 通道在正常工作。⇒ 本条的两根杆不变（site 并发＝每房配额 3；建得动与否＝#122/#126 的 demand 乘 0），**别把 `claimSecure` 立案成第三道闸**；通用教训＝**被拒 ≠ 中止，读到调用点的分支结构之前不要断言门禁挡住某事**。另记 `constructionSkips` 是 heap 且每 `skipReportInterval` 拍打日志后清零（`:274-276`）⇒ **窗口量不是累计量**，"某原因码=0"不能当"从未发生"。
  ★★**R160 补9（这一块横跨两案：前三条给 #120 的"天花板"定级，后两条是 #121 的代价清单——放这里是因为它们是同一次读数出来的）**：
  · **常量联立解出本服真实容量表**（`R160D1@83426296`，一发读全部可见房 `[level, energyCapacityAvailable, extension数]`：`W37S58 [8,12900,60]`／`W38S56 [5,1800,30]`／`W38S58 [2,300,0]`）⇒ **每只 extension = 50**、**spawn 底座 RCL≤5 = 300、RCL8 = 9,600**（与公共服标准表不同 ⇒ 再次证明"阈值/常量也算读数"）。
  · **退出线 15,000 vs 法定满建**：RCL2 = `5×2,000(container) + (300+5×50)(bay)` = **10,550**；RCL3 = **10,800**；**RCL4 才把 `STORAGE_CAPACITY = 1,000,000` 解锁**（RCL1-3 该结构允许数为 0）⇒ **#120 升级为"整段 pre-RCL4 窗口按构造够不到 15,000"**（缺口 4,200~4,450 只能靠 creep 背包填，而背包实测最高 ≈3,100）。**可证伪边界**：若现读 `phase.reserve ≥ 15,000` 而 `rcl < 4` ⇒ 本节作废。
  · **出带所依赖的 RCL4 现在没人爬**：W38S58 角色普查 `harvester3/hauler2/distributor1/carrier2/builder1` ⇒ **0 只 upgrader**；`controller.progress 12,952 / 45,000`（RCL2→3 还差 32,048）；`claimSecure=false`（保级闸已排除）。⇒ 于是形状是：**解 #120 要 RCL4 ⇒ 要爬级 ⇒ 该房没有在编的 upgrader** —— 这条不是新阈值问题，是**编制/排产问题**，与下面 #121 的两根杆同批给人。
  · **spawn 侧账本（⚠️还不能定罪，两种互斥解释都活着）**：`spawnQueue = []` 而 `spawnRejects = {budget:996, survivalBlock:723, noDegrade:1012, reserveOnly:18, floor:0, degradeGateClosed:0}`（自 boot 83422285 累计）。语义按调用点核：`spawn-manager.ts:468` 的 `survivalBlock` 记**被跳过的条数**（有 P0 生存请求时非 P0 一条都不试），`:539` 的 `noDegrade` 记**"等能量、不降级"支**。⇒ 判据（零新码，连读 2~3 次隔 ≥100 拍）：**计数在涨 ⇒ 需求投了但被拒；计数不动且队列恒空 ⇒ 需求侧根本没投**。别拿 `spawnStarvationCount=0` 顶这一判（不同通道）。

  现状（全有出处，见锁 `R160 补5/补6`）：W38S58 的 CP4（`extensions.length >= 5`）被**串行建造**卡住——`CONFIG.construction.maxNormalSitesPerRoom = 3`(`src/config/index.ts:290`) 小于 CP4 需要的 5 张 extension 工地，road 桶另有 `maxRoadSitesPerRoom = 2`(`:293`)；现场在册 site 恰为 `extension×3 + road×2`＝**两桶全满**，队列里还有 2 张 extension 处于 `state:queued / attempts:0` 等名额。heap 计数器 `globalThis.constructionSkips.rooms.W38S58 = {per-room-site-cap:extension:190, :container:95, :road:1520}`（`R160C8@83426194`；⚠️**该表每 `skipReportInterval` 拍输出后清零且不上 Memory ⇒ 换码即失，要引用必须现读**）。
  实测代价与量级：builder 只有 1 只（角色普查 harvester3/hauler2/distributor1/carrier2/builder1），`bk.built = 50/50 拍 = 1.0/拍`，而其 2-WORK body 的理论上限 ≈2/拍 ⇒ **约五成利用率**（通勤/取能损耗，#116 家族）。总欠 13,508 进度 ⇒ **13,500~17,800 拍**（拍长两法并列：observe 自报 2.65 s/拍、`bandTicks` 派生 4.25~4.64 s/拍 ⇒ 换算只写 10~23 小时区间）。
  选项（不自办）：①**提高每房普通 site 名额**（让 5 张 extension 并行建造）——这是**改排产门槛**，且会同时抬高全局 site 数与 traffic 成本；②**给该房加 builder**（编制侧，受 spawn 预留与 `crisis` 下的档位影响）——不减总工作量，只提高并行度；③**什么都不动**，让串行建造自然走完（≈10~23 小时）。默认＝③维持现状。
  ★**与 #120 的关系要讲清，别混成一条**：本轮读数**否证**了"crisis 顺带把 CP4 门住"这一支（该房吃到的建造拒绝全是配额类，没有 `lane:*`／能量线／`tick-quota`）⇒ CP4 的门槛是名额与人力，#120 的自锁门住的是 **CP5 的 `selfSustaining`**（要 carrier 线停）与**援助能否落进 storage**（要 RCL4）。两条独立，别一起"顺手解闸"。

- **#122 一间"对象存在但 capacity=null、余额 0"的遗留 storage，把满仓代码里 6+ 处"这房有库房"的判断同时判反（10-04 R160 补12 立案；属语义修正，不是降阈值，但我仍不自办）**
  **同一根因的两枚现场翻转（都有出处）**：①**相位**：`room-state.ts:139-144` ⇒ `storageRatio = 0/null = 0`（不是 `undefined`）⇒ `phase.ts:467 hasBank` 真 ⇒ `:528 bankrupt` 把幼房钉在 crisis（详见 #120）。②**排产**：`demand.ts:886 hasStorage = snapshot.storage !== undefined` 对同一间房也为真 ⇒ upgrader 分支链跳过 `:940 !hasStorage`（"RCL1-3 早期猛冲"那支），落到 `:919 !stationUpgradeOnline` 支 ⇒ `upgraderTarget = pressure <= 0.7 ? minCount : 0`；现读 `economyPressure=0`、`upgrader:{minCount:1,maxCount:3}`(`config/index.ts:645`)、`controllerDowngradeRisk=false`、`storageNearFull=false`、`ttd=8,258` ⇒ **两支都给 target ≥ 1**。
  **规模（把根因当筛子扫全库）**：`snapshot.storage` 在 `src/` **146 处**；`hasStorage = …storage !== undefined`（或等价存在性判法）至少 6 处 —— `upgrader.ts:130`、`room-state.ts:449`、`tuning-engine.ts:647`、`room-profile.ts:254`、`remote-mining-manager.ts:128/346`、`logistics-planner.ts:278`、`recovery-execution-system.ts:453`、`demand.ts:479/487`。⇒ 判据把"结构对象在场"当成"库房能力存在"，而本服引擎常量给的是另一回事：`CONTROLLER_STRUCTURES[STRUCTURE_STORAGE] = {1:0,2:0,3:0,4:1,…}`、`STORAGE_CAPACITY = 1,000,000`（平值）⇒ **RCL<4 时该对象在场但 store 被禁用（`getCapacity()=null`）**。
  **相邻但不同的既有审计结论**（避免重复立案）：`audit/ALL-FINDINGS.tsv:2865` `W20 F5`（`maxOps=min(hasStorage?2:1, spawnCount)`——本例 spawnCount=1 ⇒ 无可视差异，如实登记）；`:1545` `U26 F11`（`distScaleUpSince` 回写落在 hasStorage 块内）。**"存在性当能力"这条审计里没人写过。**
  **修法方向（摆给人，三个候选）**：①在 `captureWorldSnapshot` 一处收口：`storage` 只有在 `getCapacity(energy) > 0` 时才写进 snapshot（**最小改动、全库生效**，但会改变 146 个消费方的输入语义 ⇒ 属设计决策）；②给快照加一个正交键 `storageUsable`，逐个消费方迁移（稳但慢，且新旧键并存期易漏读）；③只在相位与排产两处特判（面最小、留下同类隐患）。**默认＝什么都不动**：该房继续被记 crisis、继续被 aid 线喂一间收不下能量的库房。
  ★★**R164 补2（20:2xZ）本条的两个后果现在都有实验数值，不再只是推理**（四臂只换 `colonyState`/`controllerDowngradeRisk`，其余按现读，本地跑真函数、夹具即删未 stage）：`recovery+risk=true` ⇒ `hauler + upgrader×3、**builder 0**`（与现场队列逐字同形）；**`recovery+risk=false` ⇒ 只剩 `hauler`——0 upgrader、0 builder**；`normal+risk=true` ⇒ `hauler + upgrader×3 + **builder 1**`；`normal+risk=false` ⇒ `hauler + upgrader 1 + builder 1`。对照 R162 那次 `无 storage + normal ⇒ builder 4 条`，得到本条的**两个可量后果**：**(i) crisis 期把 builder 编制 ×0**（`demand.ts:1098`×`:277`，反向实验确认与 risk 无关：`risk=false` 那格照样归零）；**(ii) normal 期把 builder 从 4 削到 1**（`demand.ts:1059-1066` 的 B-5 水位表：storage 能量 0 < `distributorTiers.low=2000` ⇒ `min(target, minCount)`）。⇒ **给修法①加一条不依赖降级与否的理由**：即便人决定不动 phase/demand 的语义，只把快照收口，就能让这房在 normal 态拿回 3 个 builder 名额（4→1 那半边立刻失效）。⇒ 另外 `recovery+risk=false` 那格把话说到底：**recovery 且无降级风险时 demand 连一条发展编制都不投** ⇒ 这房在 recovery 内没有任何自建出口，"**等它自己好起来**"不是保守选项，是第四条死路。
  ★★**与 #120/#121 的关系**：#120 讲"这间房为什么出不了解带态"，#121 讲"CP4 的并行度被名额卡着"，**本条讲"这两个判断的共同前提错了"**——修掉它，#120 的 `hasBank` 一支自然失效（遗留房不再被当"有银行"），所以它的优先级高于前两条，但**改动面最大**，故只摆数。
  ★★★**R160 补33（18:1xZ）本条第三枚后果，也是当前影响最大的一枚——它正冻着扩张 CP4；由被撤销的 #126 并入**：同一间遗留 storage 点亮 `demand.ts:1098`（builder 的 storage 前置闸，**没有** upgrader 那条 `!hasDowngradeRisk` 豁免），配 `:277` `demandFactor = inCrisis ? 0.0 : elasticity`（`inCrisis = colonyState === "recovery"`）⇒ **builder 目标被整体乘 0**。**四臂复现**（本地临时夹具直接调 `evaluateDemand`，其余输入全按现场，跑完即删未 stage）：`recovery+storage(0k)` 与 `recovery+storage(5k)` ⇒ **0 条 builder**（A 臂输出与现场队列**逐字相同**：`upgrader:W38S58:0/1/2`）；`normal+storage(0k)` 与 `normal+storage(5k)` ⇒ 各 1 条；`无 storage` ⇒ 4 条 ⇒ **绑住 builder 的是 crisis×0，不是 `:1059` 的 B-5 水位**（水位只把 4→1，存量 0k/5k 无差别）。这同时补上 #122 原本只判反 upgrader 却没解释的一处现象——**为什么现场仍有 3 条 upgrader**：本房 `controllerDowngradeRisk=true` ⇒ `:968` 那把 elasticity 闸被豁免跳过 ⇒ **只有 builder 吃到乘 0**（"3 upgrader、0 builder"的完整形状由此闭合）。**量**：剩余建造 =(3000−286)+(3000−1806)+3000+2×3000=**12,908**；CP4 的 `containers.length>0` 那半**已满足**（2 只 container 各 2,000 满）⇒ 只差 extension。承载天花板的第二台独立仪器：2×2,000+300=**恰好 4,300**，与结构普查同值 ⇒ #120 那支不需重算（`ext` 仍 0，`energyCapacityAvailable=300` 独立同证）。**给本条三个修法加一条排序依据**：①（`captureWorldSnapshot` 收口成 `getCapacity>0` 才写进 snapshot）**会一次松开两件事**——#120 的 crisis 钉与本条的 builder ×0；若只做 ②/③ 的两处特判（相位＋upgrader），**builder 车道仍然整条关着**，CP4 照旧不落地。可证伪边界：判效器日志 `Q=` 若在 `room.storage` 在场且 `colonyState="recovery"` 时出现 `builder:W38S58:*` ⇒ 本机制作废。
  **★R168 补22（23:4xZ）那把否证器已经开火，但开火的方式要精确记账（否则本条会被读成"机制已被推翻"）**：`r164-queue.log` 第 14 发出现 `builder:W38S58:0`，且当时 `room.storage` 在场（`st=1`）、`colonyState="recovery"` 已持续 662 拍（`colonyStateSince=83,431,754`）⇒ 按字面命中。**被推翻的是"永不出带线／施工速率恒 0"这个绝对读法，不是 ×0 本身**：在世的那只 builder（`builder-W38S58-0-83432416-15r`，`flows.built` 已 0→100→300）确实由队列孵化，而生产者收窄后剩 demand.ts 内两处，其中**替补线 `:1167` 整条不乘 `demandFactor`**（门禁只有 `:1150` 有工地／`:1159` maxCount／`:1163` 盈余，而 `minCount=1` 让它自我续接）⇒ 与 ×0 完全相容；另一条（`:1105` 需求线）才需要"那一拍快照缺 storage"。⇒ **本条交给人那一栏的口径从此改为**：三档修法决定的是"**几头 builder／到 CP4 几小时**"（单头现算 12,700 施工量 ÷ 0.43~0.60 拍 ＝ 2.1 万~3.0 万拍 ≈ **15~31 小时**），**不是"这房能不能自己走完 CP4"**——第一头已在世，若替补线成立它会自己续上。裁决表 `tmp/observe/r168e-builder-lane.log`（pid 953）按"两只 builder 是否同世"分这两条道，现任到期点 ≈83,433,927。
  **⚠️R168 补26（01:3xZ）把上面这句口径再收回去一半：替补线确实接管了第二头（`replaceBy` 已证），但它在 1,000 拍 TTL 内**过期未孵**（P1 的保级 upgrader 与 P1 hauler 赢走了槽），房内 builder 已 998 拍为零、施工 446 拍零进展 ⇒ 所以"人拍的是头数与小时数"**只对了一半**：在 crisis×RCL1 的组合下它仍然是"**能不能走**"，因为车道每换代一次就要重新赌一把孵化竞速，而赌注正是那批被 `kernel.ts:988-1003` 冻住、却按 `demand.ts:1103` 拿 P1 的保级 creep。完整链与拍号见 §4.0 补26 ①–⑤。**
  **★R169 补28 排序更新（同一条，给人看的顺序换了）**：重启锁已用直接见证判成立（`upgrader:.../p1/rb0` 的 `createdAt=83,435,396` 落在无 builder 的窗内 ⇒ 需求道跑过却没投 builder），且降级又砍第二刀——**RCL1 上 CP4 的"计划供给"为 0**（`extension` 期望值 `CONTROLLER_STRUCTURES[extension][1]=0`、3 张工地计入 `have` ⇒ 缺口 −3 ⇒ 审计器不报、被超龄清扫掉的 2 条任务不会回来；现场已见规划器跑过一趟而 `layoutGaps` ABSENT）。⇒ 本条的串行闸现在是 **(a) 回 RCL2（要一次成功升级，被 #127 冻＋`upgradeEnergyFloor=300`＝满池按住）→ (b) 审计器重新报 extension 缺口（回 (a) 后自动）→ (c) builder 赢下孵化竞速（补26）→ (d) 12,708 施工量**；**#121 的 site 名额不在这条链顶端了**，请按 (a)→(d) 排。
  · **★★★R160 补36（18:2xZ）把这条钉成闭合链，并给 #120 的"够不到"换成数值版**：**`colonyState` 的唯一写者**是 `room-state.ts:253-257`，值来自 `phaseToColonyState`（`phase.ts:558-563`：`crisis|recovery ⇒ "recovery"`，无 hostiles 时**完全由 phase 派生**）⇒ 不存在"能量恢复了 builder 车道自己会开"的独立出口。闭合链：遗留 storage ⇒ `hasBank` 真 ⇒ `:528 bankrupt` 钉 crisis ⇒ `colonyState=recovery` ⇒ `demand.ts:1098`×`:277` 的 `0.0` ⇒ builder 目标 0 ⇒ 不建造 ⇒ 承载不抬 ⇒ crisis 不退。**#120 出带线的数值版**（原措辞"退出线高于天花板"升级为"满建也够不到"）：`reserve` 构项＝`energyAvailable+Σcontainers+storage+terminal+creepEnergy`（`room-state.ts:43-51`），满建 RCL2 上界 = container **5×2,000=10,000**（本服实测 `CONTAINER_CAPACITY=2000`；`CONTROLLER_STRUCTURES[CONTAINER]` 在 RCL0-8 **恒 5** ⇒ 这项不随等级涨）+ spawn 池 300 + 5 extension（容量未在本服标定，量级 ≤500）+ creep 携带（现测超出 4,525−4,300=225；上界按在场 6 只×≤300）⇒ **≈10.6k~12.6k < 15,000** ⇒ **只有 RCL4 解锁 storage(1e6) 才跨过去，而 RCL3→4 需要 builder ⇒ 自指死锁**。时长证据：`colonyStateSince=83423876`（已在 recovery 停 ≈4,600 拍）、`bandTicks` 同轮内 **4037→4639**（同一条带连续未断）、`reserve=4525`、`reserveDelta=+6`（50 拍窗 ⇒ ≈0.12/拍，已顶在承载附近）、`drainScore=liquidityScore=0`。**机器侧第二条出口（重要，因为它改变"要不要等"的答案但不满足 objective 的字面形状）**：`state-machine.ts:482-498` 在 `tick−startedAt > pioneerTimeout×2`（`config/index.ts:944`=20,000 ⇒ **40,000 拍**）且 `cp3.passed` 时 `emitMilestone(FORCED_ADVANCE)` ⇒ `state="integrating"`、`startedAt` 重置、`uoem-events.ts:44-45` 置 `forcedAdvance=true`；cp3 未过则 `abortExpansion("TIMED_OUT")`。代入 `startedAt=83425257` ⇒ **预计 t≈83,465,258**；拍长用我自己的探针时间戳免费标定（`291 拍/1,139 s`=3.91、`119 拍/459 s`=3.86 ⇒ **≈3.9 s/拍**）⇒ **≈39.8 小时**（日先区间 2.3~4.5 s/拍则 23.5~45.9 h）。⚠️**这条路 `checkpointsPassed` 停在 3 ⇒ 扩张的"自然建成"仍没发生**，但 `integrating` 的两键照样可观测（`advanceIntegrating:543-544`）。
  · **同轮读码副产品（登记，不立案，且**不**拿来解释本房那间 storage 的来历）**：`construction-manager.ts:347-356` 的 RCL 校验 `CONTROLLER_STRUCTURES[t.structureType]?.[snapshot.rcl] ?? 0 > 0` **只挂在 `mode==="lane"` 那一支**，常规取任务走 `:356 return true` ⇒ **我们这一侧不查 RCL**，而 `:350-352` 的注释把这道防线明确外包给引擎的 `ERR_RCL_NOT_ENOUGH`（`domain/construction/queue.ts:72` 同调）。本房的经验事实（对象在场但 `getCapacity()=null` ⇒ store 被引擎按 RCL 禁用）**反而支持"引擎侧确有墙"这一读法**，所以我不用它去解释来历（来历已由 #120/#122 定为接管/遗留）。留下的只是一个未验证假设：**若某个路径/某台服不返回 `ERR_RCL_NOT_ENOUGH`，我们的常规通道会在 pre-RCL4 房照建高级结构**；要不要补一道自家校验属设计决策，不在巡检自办范围。
  · **★★★R168（21:1xZ）影响清单到手并被逐条核过 —— 本条第一次变成"可拍的决策"，但修法有两个形状、代价不同**：后台只读代理产出 `audit/STORAGE-USABLE-IMPACT.md`（126 行，含 60 行分类表＋§11 我的核验段）。按"代理摘要默认不可信"的规矩我只开文件核了承重那几条。**✅ 核实为真**：`phase.ts:463/469`（`hasBank` 是 `bankrupt` 的必要项；分支链 `:517-534` 里 `bankrupt` 排第 5，今天 1-4 全假 ⇒ 撤 `hasBank` 落到 `:533 growth` ⇒ `colonyState=normal`）；`demand.ts:1059`（B-5 水位权限表）与 `:1098`（×`demandFactor`）**两处各以 `snapshot.storage` 为门** ⇒ 快照级修法把两处一起松开；`recovery-execution-system.ts:453` 直读 `Game.rooms[room].storage` ⇒ 确实修不动它。**⚠️ 两处说过头**：①"builder 0→4"**不是构造值** —— 它吃 `:1042 economyCap=harvester+worker+1` 与 `:1036 colonyState!=="bootstrap"`；现读 `R168E4@83,431,113` 该房 `harvester=4/hauler=2/upgrader=3/distributor=1` ⇒ economyCap=5、**今日**确实是 4，但若改后相位落进 `bootstrap`（`:526`）整个 builder 分支被 `:1036` 跳过、目标仍是 0 ⇒ 收益条件要连编制一起写进决议。②"单点快照修法足够"只覆盖那两个症状，**漏了三处占用位**：`validation.ts:263/401/441` ＋ `queue.ts:45-47` 同样读 `snapshot.storage`，用途是**格子占用**而非仓库可用性 ⇒ 摘掉对象会让那格在放置器眼里变空地，而 `validation.ts:261-262` 的注释记录的正是我们踩过的失败模式（选中已占格 ⇒ `ERR_INVALID_TARGET` ⇒ 反复失败进黑名单）。**⇒ 形状结论（不替人拍板）**：修法有 (i)**从快照摘对象**（一处改、全库生效，但占用信息一起丢、把我们送回 `validation.ts:261` 那个已修过的坑）与 (ii)**保留对象、只把"有银行/能存东西"换成"能用"**（改在 `room-state.ts:142 storageRatio`/`phase.ts:463` 侧或加 `storageUsable` 正交位；两处改、不碰占用位）两个版本，代理 §10 的"minimum set"属 (i)，其代价此前无人登记。附带一条**候选**受害者（未定案，只一发读数）：该房已有 `distributor=1`，而其落点按 `room-snapshot.ts:114-120`/`fill.ts:160` 的 `getFreeCapacity>0` 筛子会被整条排除（`R168E2@83,431,010`：`free=null`）⇒ "孵出来只能空转"待第二发复证，别当结论引用。
  · **★★★★R168 补10 三档修法齐了，而最小那档是"一行"——效果与边界都由跑出来的数说话**。先一条算术事实：`room-state.ts:142-144` 写的是 `getUsedCapacity / getCapacity`，而本服那间遗留 storage 的 `getCapacity("energy")` 返回 **null** ⇒ **这个字段今天是 `NaN`（余额 0 时）或 `Infinity`（R145 那次余额 23），从来不是一个 0..1 水位**。用本地临时夹具直接调真函数 `evaluateColonyPhase`（`tests/unit/economy/r168-hasbank-probe.test.ts`，6 例全绿后**即删、未 stage**，`dist` sha 未变），其余输入逐条按现读（`reserve 4,155 / spendable 300 / harvester 2 / source 2 / rcl 2 / srcRatio 0.5 / prev=crisis, bandTicks 7,795`），**只转 `storageRatio` 这一个旋钮**：`NaN ⇒ crisis`、`Infinity ⇒ crisis`、**`undefined ⇒ growth` 且 `phaseToColonyState=normal`**、控制组 `0.15`（真仓库低水位）`⇒ crisis`、反向实验 `undefined→growth` 再转回 `NaN→crisis` ⇒ 责任就在这一个输入项。顺手纠正我自己写反的一条断言：`reserve=15,001` 时相位**确实出带**（growth）⇒ **带内退出线是可越过的**，只是本房结构承载上界（满建 RCL2 ≈13,200，含宽松携带项）低于它 ⇒ #120 那句"够不到"是**数值结论**、不是构造结论，且这半边现在有执行证明。
  · **为什么 (ii-a) 真是一行**：`hasBank` 全仓只 2 处命中且都在 `evaluateColonyPhase` 内部（`:463` 定义、`:469` 使用）；`PhaseInput.storageRatio` 的消费者也只有 `:387` 与 `:463`；而 `:387` 那个满仓豁免在 NaN 与 undefined 下**结果相同**（`NaN > 0.8` 假、`(undefined ?? 0) > 0.8` 假）⇒ 无论改在 `phase.ts:463` 还是改在 `room-state.ts:142` 的产出处，**都不碰别的决策位**。帝国级/战略级那些 `storageRatio` 属于**另一个结构**：`room-registry.ts:73` 取 `profile.storageRatio`，而 `room-profile.ts:273` 写的是 `storageCapacity > 0 ? energy/capacity : 0` ⇒ 已被 null 挡掉、不吃这条边（`colony-failure.ts:22` 那个同名键属于零调用者的 `evaluateColonyFailure`）。
  · **(ii-a) 的边界要说清，否则就是误导**：只解 `hasBank` ⇒ 退出 crisis ＋ `colonyState=normal`，于是 (a) `demand.ts:1098` 的乘数从 `0.0` 变回弹性值（非 0）、(b) `kernel.ts:988-1003` 的 upgrader 冻结解除（**#127 那半自动失效**）；**但 `demand.ts:1059` 的 B-5 水位权限表读的是 `snapshot.storage`、不是 storageRatio** ⇒ 仍会把 builder 目标封到 `minCount`（`config/index.ts:646` `builder {minCount: 1, maxCount: 4}`，而那间 storage 余额 0 < `low` 2,000）⇒ **预期 builder = 1 头：CP4 会开始动，但慢**（⚠️**R168 补13 补一个数**：200 拍轨迹对照实验跑出——`undefined` 臂从 `drainScore=76` 起要**约 142 拍**才真正出带（`bandTicks` 归 0），而 `NaN` 臂 200 拍后 `ds` 已衰减到 0 却仍被 `bankrupt` 接回 crisis ⇒ 一行确实解除钉住，但**需求侧放开有 ≈9 分钟（@3.8 s/拍）延迟**，判效窗别按"下一拍即变"设；同时这也更正我这里"今天 1-4 分支全假"的旧口径——现场是 `crisis↔recovery` 振荡，只是撑不住带）。要拿回 3~4 头就得让 `:1059`/`:1098` 也认"能用"——那才是代理 §10 "minimum set" 的效果，代价是占用位三处（`validation.ts:263/401/441` ＋ `queue.ts:45-47`，见上一条 ② 与 §4.0 补8）。⇒ **三档齐了**：**(i) 快照摘对象**＝builder 3→4、但破占用位、需配套；**(ii-a) 只改 `hasBank` 一行**＝builder 1 头＋解冻 upgrader＋退出 crisis，最小、可逆、不碰任何别的决策位；**(ii-b) 加 `storageUsable` 正交位并在 demand 两处采用**＝拿到 (i) 的效果而不破占用位，两处改。三档都不自办；这张表就是本轮把"拍不动"变成"可拍"的全部交付物。
  · **★★★★★R168 补14 三档的编制目标改由真函数给出，而跑出一个会改变推荐方向的新后果**（临时夹具调 `evaluateDemand`，输入逐条按现场：3 张 extension site、19 条 queued、`energyCapacityAvailable=300`、harvester=4、两只 container 各 2,000 满载（＝经济环 `cte=4000` 的现场值）、幽灵 storage 在场且余额 0；`containers` 全满这一条是关键输入。5 例全绿、即删未 stage、`dist` sha 未变）：

    | 臂（`pressure`/`price` 为经济环现读值） | builder | upgrader | hauler |
    |---|---|---|---|
    | 今天：`recovery` ＋ 幽灵 storage（p=0.66 / p=0.10 / price=0.9 三种都给同一结果） | **0** | 3 | **2** |
    | **(ii-a)** 一行解 hasBank ⇒ `normal`，storage 仍在其位 | **1** | 3 | **5～6** ⚠️ |
    | **(i) / (ii-b)** demand 也不认这间 storage | **3**（p=0.66）／**4**（p≤0.35） | 3 | **2** |

    ①** faithfulness 自证**：今天这一臂跑出 `builder 0 / upgrader 3 / hauler 2`，与我直读现场编制（`R168E4`：upgrader 3、hauler 2、builder 0）**逐位相同** ⇒ 这套夹具不是纸面推演。②**代理的"0→4"被否**：今天压力下是 **3**，只有 `economyPressure ≤ 0.35` 才到 4（TD-016 迟滞 `:1073-1088`），且 harvester 掉到 2 时 `economyCap` 把目标压回 3 ⇒ "4"是上界不是常态。③**(ii-a) 不是"更小版本"，而是方向不对**：builder 只到 1（B-5 权限表仍封着），**hauler 却从 2 跳到 5～6**。机制已核到行——`demand.ts:487 const canDeliver = snapshot.storage !== undefined || snapshot.fillTargets.length > 0` 是一条**纯存在性测试**，被它打开之后 `:535-541` 对每只 `fillRatio>0.8` 的 container **各加 2 头**（现场两只都满 ⇒ +4）。⇒ 这是同一间幽灵 storage 的**第六个后果**，而且落在**编制**层：房间会因为"有一间仓"而排 5～6 头 hauler 去倒一间引擎禁用的仓。④**由此推荐方向变了**：(ii-a) 只修相位读数，物流这侧的存在性测试原样留着 ⇒ 花编制不换来建造；**要"最小且方向对"，是 (ii-b)（`storageUsable` 正交位在 demand 的 `:1059`/`:1098`/`:487` 三处采用）**，它在跑出来的数里就是 builder 3～4 而 hauler 保持 2。⑤口径边界（不许外推）：本臂 `fillTargets=[]`，现场池未满时该列非空 ⇒ `canDeliver` 今天也可能已为真，**绝对头数会变**，但"存在性测试打开编制闸门"这一机制与 (ii-a) vs (i)/(ii-b) 的分档差异不受它影响；`upgrader=3` 各臂相同，因为它是保级 override（`demand.ts:920-923`）拉起来的，与这三档无关——也正是 #127 说的"花钱买不许干活的编制"，在 (ii-a) 下这一条自动解除（colonyState=normal）。
  · **★R168 补12 同一间 storage 的第五个后果（纯成本型），以及代理一处措辞的更正**：现场 `R168E6@83,431,802` 读到该房 **`terminal=false / lab=false / factory=false / storage.store.getUsedCapacity("energy")=0`**，而 `distributor.ts` 的 acquire 链里**每一个取料候选的源头都是 storage 或 terminal**（`:99` 注释自陈"唯一取能源：storage"），角色本身没有采集/拾取动作 ⇒ **这房养着一只按构造取不到负载的 distributor**；观测同向（`R168E5@83,431,786`：`mode=idle`、携带 0、位 (30,30)）。⇒ 前四个后果（crisis 钉住／builder 需求乘 0／CP5 `selfSustaining` 假／upgrader 被冻）之外，这条是**只做花费不做产出**的那一类，拍 (ii-a)/(ii-b) 时可以一起算进收益。⚠️ 同时更正代理 §6/§10 的一处过头说法（已写进 `audit/STORAGE-USABLE-IMPACT.md` §11.2）：`recovery-execution-system.ts:453` 的 `hasStorage` 只是**准入闸门**，紧接 `:463-465` 是"有活口就 return"、`:470-472` 对已在队列的键幂等 ⇒ 正确说法是"**快照级修法修不动这一处的准入条件（它读引擎对象），所以每缺一只就补一只**"，不是"持续对抗需求侧"。

- **#123 扩张 CP5 的"净流为正"在 CP4 要求的建造期里按构造为假——消耗估算按工地数记（每址 5/t、封顶 30/t），而 2-source 新房的产出上限只有 20/t（10-04 R160 补17 立案；属模型语义决策，我只摆数）**
  估算式原文 `state-machine.ts:812-835`：`production = min(sources.length × 10, harvesterWORK × 5)`；`consumption = (spawn 在孵 ? 3 : 0) + min(sites × 5, 30)`。⇒ 消耗按**工地数**记代理，不按真实施工速率；产出被 source 数硬顶。
  现算（`R160D8@83426714`，把现场量代进上式）：`src=2, harv=2, workParts=3, sites=5, hatching=false` ⇒ `prod=min(20,15)=15`、`cons=min(25,30)=25` ⇒ **`net=−10`** ⇒ `netPositive` 假 ⇒ `advancePositiveStreak` 归零 ⇒ `consecutivePositiveTicks` 无法开始累计。转正条件（纯算术）：`min(sites×5,30) < min(20, workParts×5)` ⇒ 现值下要 **sites ≤ 2**；WORK 部件补到 ≥6 则 sites ≤ 3 可行。
  为什么与 CP4 结构性互斥：CP4 要求**建成 5 只 extension**（期间必须有 extension 工地在场；现读 `ext=0`、串行建造中），CP5 要求净流为正——同一间房同一时段，"正在建"就让净流为负。⇒ 自然完成路径的顺序被钉死：CP4 落成 → 工地降到 ≤2 → 净流转正 → 还要 `externalEnergyInflow === 0`（✅**R168 补1 已复核：这一半成立，"按构造不可达"不降级，但两处措辞改掉**——`economic-activation.ts:80-89` 的旧实现把"幼房背包存量 ×25/t"当外部流（量纲错、≈175/t）且**已删**，现在 `externalInflowPerTick = carrier 线数 × 50`；现读 `R168E1@83,430,964` 在场 **2 只 carrier 的 `home` 全是 W37S58**（一只 `→W38S56`、一只 `→W38S58`，各 TTL 416），配 `kernel.expansion.sponsor="W37S58"`、`target="W38S58"` ⇒ `state-machine.ts:851-852` 的三重筛（role ∧ `remoteTarget===target` ∧ `home===sponsor`）**只命中 1 只** ⇒ 外部流 =50 ≠0 ⇒ `selfSustaining` **仍假**。纠正：①此前写的"2 条线"是在场 carrier 总数，与本房相关的该记 **1 条**；②该项的有效期＝那只 carrier 的存活期（TTL 416 ⇒ ≈27 分钟 @3.8 s/拍），换代后必须重读，**不是常量**。本轮新增一条不对称：`carrier.ts:44` 的 `getFreeCapacity <= 0` 在这间 `null` 读数的遗留 storage 上恒真 ⇒ 这条线**从未交付过一克**（自读 `W38S58.imported=0`，同读法控制组非空 `W38S56.imported=82,785` ⇒ 不是读法坏），而 `imported` 的唯一作者就是同一 if 块里的 `:57` ⇒ **撤掉这条线能量代价为 0，却能把 `selfSustaining` 的输入翻成 0**（属人决定，且它与 #122 互不替代：#122 管 CP4 的 builder 需求乘 0，本条只管 CP5 第三判据）。另注：`netFlow = production − consumption`（`:102`）**不含**外部流 ⇒ 本条"CP4 建造期 `netPositive` 为假"那一半不受此影响）＋（援助线停，见 #120/#122）→ 再两趟正 pass 才凑够 `SELF_SUSTAINING_TICKS=500`（首趟 elapsed=0）。剩下的出口只有 `integrating` 的 60,000 拍超时强推（`COMPLETED_FORCED`）。
  给下一轮的判读规则（**判别位**）：N+1 趟读到 `consecutivePositiveTicks=0` 有两重原因（elapsed=0 与 net<0），**那一拍无法区分**；**N+2 趟才是判别位**——读到 ≈400~900 ⇒ 该拍 net>0（工地 ≤2 或 WORK≥6）；读到 0 ⇒ net≤0（按现算 sites=5/workParts=3 ⇒ **预期如此**）。读到非 0 时必须重跑 `R160D8` 那发公式核对现值，不许直接引用本节的 15/25。
  选项（都不自办）：①按真实施工进度差分记消耗（现成源：`bk.built`）；②给幼房按 RCL/工地规模缩放 sites 权重；③什么都不动 ⇒ CP5 自然路径只能等"建完之后"，否则由超时强推收成 `COMPLETED_FORCED`。**默认＝③。**

- **#124 幼房 builder 断供的拦截者在 spawn 侧拒绝，不是能量也不是需求（10-04 R160 补21 立案；本轮不定罪，判据已写死）**
  现场三件同时成立（`R160E4@83427245` 与同窗 `peek`）：**①`ea=300` 且 `ec=300`（bay 满）**、**②`hatching=[null]`（spawn 空闲）**、**③`builder:W38S58:1` 请求已挂 ~394 拍、`bld=0`、三张 extension 工地进度 250 拍纹丝不动 `[286,1806,0]`**。⇒ 16:4x 预写的两支里，**"能量没进 bay"排除**（bay 满）、**"只是瞬时能量不足"也不成立**（满 bay + 空闲 spawn + 请求活着）。
  拒绝计数差分（16:48:13 → 17:06:5x，同一路径）：`budget 1,848→2,380`（**+532**）、`degradeGateClosed 1,136→2,024`（**+888**）、`reserveOnly 303→659`（**+356**），而 `survivalBlock 723`／`noDegrade 1,012`／`floor 0` **三个不动**；`spawnBlacklist` 不存在（不是隔离）。⇒ 拦截者属 **`budget`（CPU 预算门，#50/G6 那一族）** 或 **`reserveOnly`/`degradeGateClosed`（预留条件 3 那一族，#61）**，二者本轮**分不开**。
  **判别位（零新码，两发合起来才能定罪）**：①`peek rooms.W38S58.spawnQueue` 看 `builder:W38S58:1` 是否在 `expiresAt ≈ 83427851` 到期出队而**从未孵化** ⇒ "请求活着却不被孵"坐实为拒绝；②同拍读当轮 CPU 档位（`tier`+`since`，只有 G6 用得到）与 `ea/ec` 现值：若档位仍是 `constrained` 而 bay 满、spawn 空闲 ⇒ **CPU 预算门**；若档位不拦而 `reserveOnly` 独涨 ⇒ **预留条件 3 把幼房唯一孵化槽锁死**。⚠️定罪前别引我记忆里的旧比值——"reserveOnly 与 degradeGateClosed 严格 1:1"已在补20 被否证（本窗 +356 : +888）。
  ★★**R160 补22：拦截者已经定位到具体那一层，而且它把本条与 #120 第一次接成一条闭环**（"两个候选分不开"这个措辞作废）：
  · **降级门读的是分数不是相位**：`spawn-manager.ts:486-499` 六层里能用于 `priority 2` 的只有第 4 层「**P2 饥饿超时 + `economyPressure > 0.5`**」（第 3 层 `starvedP1` 只覆盖 P1，:510；第 5 层地板在 `colonyState∈{bootstrap,recovery}` 被**豁免** ⇒ **`floor:0` 是预期不是异常**，:546 原文）。现场 builder 请求 `age 394 拍`、`spawnTime=body.length×3` ⇒ 10× 阈值 ≈130~200 拍**已满足**；而 **`economyPressure=0`（16:06 现读）⇒ `pressure>0.5` 不满足 ⇒ `allowDegrade` 关 ⇒ 记 `degradeGateClosed`**，与实测 `+888` 同向同量级。
  · **另一半是 bay 上限**：`energyBudget = energyAvailable`（:420，现读 300；逐条扣减 :621）、`effectiveBudget = survival 或采集角色 ? energyBudget : energyBudget − reserve`（:485）、`cost > effectiveBudget` 时按同一判定的差集分档（`cost > energyBudget ⇒ budget`；只在扣预留后才越线 ⇒ `reserveOnly`，:500-506）。⇒ 该房 **`ec=300`（0 extension ⇒ >300 的 body 按构造付不起）**，而 hauler body 实测 `3C3M` **恰=300** ⇒ **只要 `reserve>0` 就被预留吃掉 ⇒ 记 `reserveOnly`**（与 `+356` 同向）。
  · **闭环长这样**：null-capacity 遗留 storage ⇒ `hasBank` 真 ⇒ `:528 bankrupt` 钉 `crisis`；钉住时 **`drainScore` 可为 0 ⇒ `economyPressure=0`**；pressure=0 ⇒ **P2 降级门关闭**；bay 上限 300 且预留 >0 ⇒ 原 body 也付不起 ⇒ builder/hauler 换不上 ⇒ extension 无人建 ⇒ `ext` 不涨 ⇒ bay 上限不涨、`reserve` 顶在 4,3xx ⇒ crisis 不退出。**⇒ 修 #122 或 #120 会同时松开这条链；只调 spawn 侧降级门（把 `pressure>0.5` 改成也接受"bay 满而 idle"）则属新增出口，两条都属人。**
  ★★★★**R160 补24（17:2xZ）：本条闭合到算术级——两环里的一环已证，另一环改写为"占空比问题"**：常数是 `recoveryEnergyReserve=200`(`config/index.ts:205`)、`replacementHorizonTicks=600`(`:213`)、`lowRiskBufferTicks=400`(`:209`)；**豁免只看角色**（`spawn-manager.ts:484` `isCollectorRole = harvester||worker` ⇒ **hauler/builder 不豁免**，:485 扣预留）。请求成本 body 现读：builder `1W1C2M`=**250**、hauler `3C3M`=**300**，而该房 `ec=300` ⇒ **bay 满时非 P0 可用预算只有 300−200=100 ⇒ builder/hauler 都付不起**；P2 饥饿降级要 `pressure>0.5` 而现读 0 ⇒ 降级门关；`floor` 那层在 recovery 被豁免（本来就不该挡，⇒ 我上一版把 `floor:0` 当线索是误读）。⇒ **与观测逐项吻合**：`ea=300/300`、`hatching=[null]`、三条请求挂 500+ 拍、`reserveOnly`/`degradeGateClosed` 在涨。
  · **哪条 reserve 条件在生效（差集判完）**：条件②要 `economy.cr>0` ⇒ **排除**（该房 `cr=0`——正因为那间 null-capacity 幽灵 storage，**#120/#122 的第三次显形**）；条件① 要 `collectorCount≤1` ⇒ 采集者 2~3 ⇒ **假**；⇒ 生效的是**条件③** `replacementReserve`（任一 harvester/worker `ticksToLive<600`；寿命 ≈1,500 ⇒ 单只 40% 时间在窗内）。
  · **`reserveOnly` 本身就是"预留>0"的证明**：它的记账条件是"同一次判定里 `cost ≤ energyBudget` 但 `cost > energyBudget − reserve`"（`:500-506` 原文）⇒ `+356` 直接证那些拍 reserve 生效；`budget` `+532` 则是 `ea` 掉到成本以下的拍 ⇒ 两档并长与"`ea` 在 113~300 浮动"一致，**不需要再为"有没有预留"发探针**。
  · **★补27 又补一条"注释承诺 vs 接线"的缺口（这正是 builder 换不上的最后一块）**：`demand.ts:1021` 原文写着"Builder——**recovery 时是生存角色必须允许 spawn**"，但全仓给请求打 `survival` 的只有一处：`demand.ts:1258` **`survival: priority === 0`** ⇒ builder 走 P2 ⇒ **恒 false**（与现读队列 `builder:W38S58:1` 的 `survival:false` 逐字吻合）。`survival: true` 的两个生产者都在 `recovery-execution-system.ts`（`:349` 提交的是 **role worker**、`:940` 防御响应）⇒ **没有任何路径把 builder 标成 survival**；而 `spawn-manager.ts:484` 的预留豁免只给 `survival || harvester||worker` ⇒ **builder 两头都不靠**（不是 P0、不是采集角色）⇒ 在 `ec=300 / reserve=200` 房里可用预算 100 < body 250 ⇒ 永远孵不出；实际存在的豁免恰好绕开了 builder。
  · **给人看的三条路（按代价排，②在未证前不许当方案）**：①把"recovery 期 builder 视为生存角色"**真正接线**（等于兑现 `demand.ts:1021` 的注释）——**这放宽预留语义 ⇒ 属安全/预留类，必须人批**；②先靠已有豁免让 worker 顶上建造（worker 在豁免名单里）——**但 worker 的 work 链是否含 build 未证**（我此前读到链尾是 `fillTarget→upgradeController`）⇒ 先查再谈；③等 bay 自然涨 ⇒ 而涨 bay 要 builder ⇒ **这就是锁死点本身**。
  · **另记一条测量缺口（关系到本条天花板会不会被推翻）**：`reserve` 继续上漂 `4,426@17:32 → 4,518@17:34`，**已超过结构侧 4,300** 而增量来源尚未拆清（`creepEnergy` 按 home 归集，但跨房 carrier 的 home 是 sponsor ⇒ 谁在替这房"背着能量"没查）。⇒ **本节的"天花板"结论带一条自我否决线：若 `reserve` 在 `ext` 仍为 0 时越过 ≈5,000，就得回来把天花板重算并撤"结构锁死"那句**（下一发顺带查 `globalCreepEnergy` 的归集口径）。
  · **★补29：那条"归集口径"已用代码关掉，顶格值的最终口径定稿**：`kernel.ts:298` 的 `globalCreepEnergy` 是**每拍函数内局部 Map**、`:337` 按 **`memory.home`** 累加、`:451` 以参数传给 snapshot ⇒ **它从不挂在全局上**，所以我 17:3x 那次 `globalThis.globalCreepEnergy` 读回 `[]` 是"名字不在全局"而不是"能量为空"（差点把读法失败当否证，已按【聚合全是 0 先怀疑读法】纠回；另注：`room-snapshot.ts` 在 `src/systems/` 根目录，不在 `room/` 子目录）。⇒ **口径确定为 per-home**：那 254 是 home=W38S58 的 6 只 creep 的背包合计，与"在场背包合计 254"这一拍数值相同纯属巧合；同时 `:337` 也直接证实了"跨房 carrier（home=sponsor）的货不算进本房 `reserve`"（这条推论此前我只靠注释）。
  · **顶格值统一写法**：**4,300 结构（`ea 300 + 2×2,000 container`，null 容量的 storage 不计）＋ home 编制背包（现 254，满编量级 ≤1,000）⇒ 实测 4,554、理论上界 ≈5,300**，对退出线 15,000 差 **2.8~3.3 倍**；自我否决线（`ext=0` 且 `reserve ≥ 5,000` ⇒ 回来重算）保留，且现在有了理论上界作参照。**`reserve` 是否几乎恒为 200**（是否总有采集者在 600 窗内）⇒ 判法＝同拍取该房 harvester 的 `ticksToLive` 现值算 `min(TTL)<600` 的占比。**接近 1 ⇒ CP4 在 bay 涨起来之前是结构性锁死，只有采集链换血窗口漏出几次孵化机会；明显 <1 ⇒ 会看到 hauler/builder 偶尔孵成，"锁死"这句作废、改判"低占空比"。**
  · **仅剩的开放问题（不再是"未证环"，改写为占空比）**：**`reserve` 是否几乎恒为 200**（即是否总有一只在编 harvester 处于 600 窗口内）⇒ 判法＝同拍取该房 harvester 的 `ticksToLive` 现值算 `min(TTL)<600` 的占比。**接近 1 ⇒ CP4 在 bay 涨起来之前是结构性锁死，只有采集链换血窗口漏出几次孵化机会；明显 <1 ⇒ 应能看到 hauler/builder 偶尔孵成，"锁死"这句作废、改判"低占空比"。**
  · **★补25（17:2xZ）这条从推断升为直接观测**：`R160E6@83427541` 现读该房采集者 `col=[["0a",559],["0k",823]]` ⇒ **`collectorCount=2`（条件① 现场为假）**、**`min(TTL)=559 < 600` ⇒ 条件③ 现场为真** ⇒ 此刻非 P0 可用预算 = 100 ⇒ builder(250)/hauler(300) 不可孵，而 harvester 因角色豁免照走 —— **普查里"采集者在换、hauler/builder 挂 500+ 拍"由此得到机制级解释**。两点界限：**"占空比≈1"只有一条 TTL 快照 + "500 拍 0 次孵化"的间接一致 ⇒ 不写"恒为真"**（要钉死需一段 `min(TTL)`/`spawning` 时间序列）；且**这把锁只解释"第一个 builder 为什么来不了"**——任一 extension 一落成预算就从 100 抬到 300+，之后回到 #121 的名额/人力那两根杆。
  · 下面那段"仍未证两环"是本条立案时（补21/补22）的原始版本，保留作沿革，按上面两条读。
  · **仍未证两环（定罪前必读）**：①spawn 侧那个 `reserve` 的**真身数值**（`economy.cr` 是合同储备，不是它 ⇒ 先 grep `effectiveBudget`/`queryEconomy` 定字段，别猜）；②builder 请求的 **body 部件数**（决定 10× 阈值与 `cost` 是否 >300）——本轮为取它发的 console **超时 33 s**（今日第 2 次同形状），未重发、未捞旧键。
  ★★★★★**R160 补30（17:4xZ）：本条从"一层"扩成"三层互相供能的环"，并撤销我此前给的 CP4 时间区间**
  · **第 1 层 保级抢道**：`demand.ts:920-923` `hasDowngradeRisk || crisisNeedsGuard ⇒ upgraderTarget = maxCount(3)`。现场：`ttd=6,624`（RCL2 折带 enter=6,666/exit=10,000，刚跨过进入线）、`claimSecure=true`、`controllerDowngradeRisk=true`（16:1x 两把都还是 false），队列由 `builder:W38S58:1` 换成 **`upgrader:W38S58:0/1/2`**（P1、`survival:false`、body `1W1C2M`=250、`createdAt 83427756`）。⚠️**builder 请求"消失"的原因未证**（`frozenRoles`←`roomCtx.churnFreezeUntil` 被冻结 vs `dynamicBuilderTarget`/`economyCap=harvesters+workers+1` 被算式压住）⇒ 别写成结论。
  · **第 2 层 保级拉闸建造**：heap `constructionSkips.rooms.W38S58` 本窗 = `{claim-secure:98, per-room-site-cap:extension:176, :container:88, lane:energy-floor:10, stale-evict:12}`（**这张表每 `skipReportInterval` 拍清零 ⇒ 与 16:1x 那发的 190/95/1520 不是同一窗，禁止比大小**）⇒ `claimSecure` 真会把非必要工地直接拒签，**extension 不只是缺名额，还被这道闸拦**。
  · **第 3 层 孵化算术（补24/25 已证）**：`reserve=200` + `ec=300` ⇒ 非 P0 只剩 100；**upgrader 是 P1 且不豁免** ⇒ 250 body 一样孵不出；第 2 层降级虽允许 P1 在 recovery 出小 body，但"可动"的最小可用 body ≥ `WORK+MOVE`=150 > 100，真出 100 的是无 MOVE 的残废体 ⇒ 正是 `spawn-manager.ts:528-535` 注释警告过的死亡螺旋同构。
  · **供能关系（为什么它不会自己松）**：`ttd` 只能靠升级回涨 ⇒ 升级要 upgrader ⇒ upgrader 孵不出 ⇒ `claimSecure` 恒真 ⇒ extension 恒被拒 ⇒ bay 恒 300 ⇒ reserve 200 恒吃掉 2/3 预算。**三层互锁，没有一层会被内部打断。**
  · **ETA 撤销**：CP4 的时间尺度已不由建造斜率决定（**0.64/拍那个数在本窗失效**，因为 builder 不在道上），改由"哪一层先被外部打断"决定 ⇒ **补16/补24 给的 13,300~20,800 拍区间自本条起不再引用**（原文保留作沿革），P1 的名额释放判据也暂时不适用（没有 builder 在孵，工地不会落成）。
  · **顺带补第三半一个样本**：`R160E8` 那一拍仍 `phase="crisis"` + `reserve 4,544` + `drainScore/liquidityScore/srcStallTicks/bootstrapTicks` 全 0 ⇒ **第 8 个"同拍只剩 `:528 bankrupt`"的分支排除样本**。
  **对扩张的意义（这才是要给人看的那一句）**：**扩张 CP4 现在不是"慢"，是"停"**——而停的位置在孵化口，能量充足、需求已投。⇒ 它把 #50（G6/CPU）与 #61（预留条件 3）从"影响新提案"升级为"**正在冻结一次已开工的扩张**"。两条修法都属阈值/预留语义 ⇒ **不自办，摆数给人**。
  · **★补31/补32（10-04 18:0xZ）本条的"需求已投"从推断升为跑真函数证到的事实，同时把离开通道收窄成一支未定项**：①本地临时夹具把纯函数 `evaluateDemand` 按现读输入跑了一遍（`npx vitest run` 单文件，跑完即删、从未 stage、零线上副作用）：空队列 ⇒ 输出 **3 只 upgrader + 4 只 builder**（`builder:W38S58:0..3`，全 P1，因 `demand.ts:1103` `inCrisis?1:2`）；把这份输出当队列再跑 ⇒ **0 条新请求**（`hasRequest` 全吞）。⇒ **domain 层不是挡点**，"需求已投"不再靠推断。②三条撤销通道现读排除两条：`churnFreezeUntil` **不存在**（熔断非因）；全仓 `removeRequestsByRole` 6 处调用点**无一针对 builder**；`spawnBlacklist` **不存在**（不是 `{}` ⇒ `cleanQueue` 的 purge 从未在本房发生过，而 builder 不在隔离豁免表 `spawn-manager.ts:763-771`）。③**我本轮一度写"builder 请求自 boot 起从未被创建过"，已被自己 16:4x 的读数否证**（`R160E2@83426966` 队列含 `builder:W38S58:1`，age 115、retries 0）⇒ 撤该支，留下未定项：**那一支是从哪条通道离开的**——(i) purge 必留 `spawnBlacklist`（现否）／(ii) 孵化成功摘走但随后 ≈1,100 拍没再投（与①冲突）。**判据不再靠考古**：判效器 `tmp/observe/r160-cp4.log` 每 180 s 打一次队列键列（跨度 ≈4,500 拍），出现 `builder:W38S58:*` ⇒ (ii) 且需求在恢复；`spawnBlacklist` 出现 ⇒ (i) 迟到；两者都不出现 ⇒ 挡点在 `spawn-manager.ts:196` 之前。④顺带核掉一条我自己的误读："队列 `expiresAt` 恒=`createdAt+1000` ⇒ spawn 趟没跑"是**错的**——`demand.ts:1001/1106` 对已在队列的 key 根本不重新创建，而 `queue.ts:8-19` 的续期只在重新 push 时发生 ⇒ 存续条目**按构造永不续期**，只能等 TTL 到期。**用时间戳字段判"某趟有没有跑"之前，先读那个字段的全部写者与写入条件。**
 ⑤新累计读数（`kernel.stats.energyLedger.rooms.W38S58`，起点 83422285、跨度 ≈5,800 拍）：`harvested 19,840 / pickedUp 2,920 / spawned 2,850 / upgraded 2,500 / built 4,064 / repaired 720 / imported 0 / exported 0 / towerSpent 0` ⇒ `spawned 2,850`≈11 只 @250 ⇒ "孵化口没钱"**不等于**"从没孵过"；`imported=0` 是 #117 账本侧第三次同号复证。（`recycledRefund=0` 只当弱线索：该键写者未核，按"累计计数器定罪前先查有没有写者"的规矩不用它否证任何一支。）

- **#125 `demandFactor` 在 crisis 时被置 0 而不是置 1——问句，不是缺陷立案（10-04 R160 补31 登记）**
  `demand.ts:277` `const demandFactor = inCrisis ? 0.0 : demandElasticity(energyPrice)`，紧邻的 `:278` 兄弟行 `logisticsFactor = inCrisis ? 1.0 : ...` 用的是**中性 1.0**，而 `:276` 注释写"crisis 时不应用弹性调节 — crisis 路径已有独立收缩逻辑"。**注释说的"不调节"与实现的"乘 0"是两件事**：乘 0 是最激进收缩，不是"不调节"。两个消费点：`:968` upgrader（另有 `!hasDowngradeRisk && !crisisNeedsGuard` 双豁免）、`:1098` builder（**无任何豁免**）。两处都以 **storage 存在**为前提 ⇒ 本 boot 的 W38S58（RCL2、无 storage 结构）**走不到这条路**，所以它不是本轮任何读数的原因；但**任何有 storage 的房一进 `recovery` 就会把 upgrader/builder 目标整体乘 0**。
  **要人拍的只有一句**：`0.0` 是意图（"recovery=停发展角色"，`:112-113` 的注释支持这一读法）还是 `1.0` 的笔误？两种读法差一整条编制线。**我不自办也不预判**：现读 `Memory.rooms.<r>.colonyState="recovery"` 且该房有 storage 时 `spawnQueue` 长期无 builder/upgrader，才是这个分支被真实执行的签名（本 boot 未采到）。
  · 口径副产品（同一次读数出的）：`observe.mjs:459` 那列 `queue=A/B` 是 **`spawnQueueLength / buildQueueLength`** ⇒ W38S58 的 `queue=3/24` 里 24 是**建造队列条目数**，不是"孵化需求缺口 21 条"；引用这个斜杠分数必须带这句。
  · **★R160 补33（18:1xZ）本条从"问句/潜伏"升为"本房正在生效的那根杆"，且四臂复现到手**：机制与四臂现居 **#122 的 ★★★补33 块**（我一度为它另立 #126，那是**重复立案**、已撤销——同一间 storage 在 #120/#122 里早已登记）——W38S58（RCL2）里有一间自有 `StructureStorage` ⇒ `snapshot.storage !== undefined` ⇒ `:1098` 这把闸在本房**是活的**，配上 `colonyState="recovery"` 的 `demandFactor=0.0` ⇒ builder 目标乘 0。四臂（本地跑真函数）：`recovery+storage(0k)` 与 `recovery+storage(5k)` 都=**0 条 builder**，`normal+storage(0k)` 与 `normal+storage(5k)` 都=**1 条**，`无 storage`=**4 条** ⇒ **绑住的是 crisis×0，不是 B-5 水位**（水位只把 4→1）。A 臂输出与现场队列**逐字相同**（`upgrader:W38S58:0/1/2`）。

- **#126 撤销（我自己重复立案的一条，记错过程留在这是给人看的那半）：本条唯一净新增已并入 #122 的 ★★★补33 块；"来历"那半根本不是未定项（10-04 R160 补35）**
  · **错在哪**：立案前没按既有规矩先查"同一现象的第二种说法"。`#120`（行 301）早就写着现读 `W38S58 rcl=2`、`structs=["controller","storage","spawn"]`、该 storage `my=true / used=0 / getFreeCapacity=null / getCapacity=null`；`#122` 的标题本身就是"**遗留** storage"，行 335 还给了引擎侧解释（`CONTROLLER_STRUCTURES[STRUCTURE_STORAGE]={1:0,2:0,3:0,4:1}` ⇒ **RCL<4 时对象在场但 store 被禁用**）。我却把它当新发现立成 #126，并把"来历"写成未定项 ⇒ 白占一个请示位。**规则追加：立"新根因"前先 grep 那间结构自己的字段值/对象 id（本次是 `6a70a32e1ed497d10ef0a472`、`getCapacity=null`）而不只 grep 概念词（"storage"、"遗留"），因为概念词命中取决于我恰好用了哪个措辞。**
  · **本条净新增（现居 #122 ★★★块）**：`demand.ts:1098`（builder 的 storage 前置闸，无 upgrader 那条 `!hasDowngradeRisk` 豁免）× `:277` crisis 的 `demandFactor=0.0` ⇒ builder 目标乘 0；四臂复现（recovery/normal × storage 0k/5k × 有无 storage）证明**绑住的是 crisis×0 而非 B-5 水位**；顺带闭合"3 条 upgrader、0 条 builder"的形状；并给 #122 的三个修法加了一条排序依据（①一次松开两件事，②/③ 只修两处则 builder 仍关）。
  · **不在本条也不在 #122 的**：`#125` 那条"0.0 是意图还是笔误"仍是**未决问句**（属人）——本条只证明它**在本房正在生效**，不证明它是笔误。
  · **一句处置算术（值得留在请示面上，别被"合并"弄丢）**：#122 给的三个修法里 (C)"什么都不动、等 RCL4 自然抹平"**在本房走不通**——RCL4 要 45k/135k/405k 三段，而通往 RCL3 所需的那 5 张 extension 恰好被本条（builder ×0）按住 ⇒ 这是自指死锁，不是"再等等"。(A) 移除该结构属破坏性线上动作且是已建成资产 ⇒ 需批复；(B) 把两条链从"存在"改成"能力"就是 #122 的修法①/②/③，其中只有"在 `captureWorldSnapshot` 收口"那一支会**同时**松开 crisis 钉与 builder 车道。

- **#127 spawn 层为"保级"孵出的 upgrader，被 creep 层的 colony-state 门禁整条冻掉 ⇒ 房里养着三只永不升级的保级 creep，而降级在按日程走（10-04 R161 补1 立案；改语义属人，我不自办）**
  **★★★R168 补25（01:0xZ）本条预报已命中**：`lastRclChangeAt=83,434,421` 与 R162 复测斜率（−1.000/拍）算出的数**零误差**，`level 2→1`，落在预写的窗 [83,434,100, 83,434,500] 内。完整取证与归因在 §4.0 补25 ①–⑥，给人最该看的三条：①`progress` 在降级那一拍 ＋180 是**引擎重基**（`upgraded` 自 boot 恒 0 为独立仪器），不是解冻，故预写的"progress 离开 12,952"否证位不得当否证用；②**RCL1 使 extension 合法数＝0**（现场 `CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION]={"1":0,"2":5,...}`）⇒ 那 5 张工地要先回到 RCL2 才建得动，而回 RCL2 **只差一次成功的升级动作**（`progress` 13,132 对门槛 200）——本条的冻结正好把它挡住，这是它第一次配上"差一个 WORK 拍"量级的代价；③**窗内实付**：又孵 2 只不能干的 upgrader（`mode=acquire`、携带 0、本窗被拒 958 次／479 拍＝每只每拍），同时 hauler 编制 4→0、builder 位空 ≥550 拍（`builder:W38S58:0/rb83433924` 排在 P1 的 upgrader 后面没孵出来）。
  **两层各自的原文（都核到行号）**：spawn 侧 `demand.ts:920-923` ⇒ `hasDowngradeRisk || crisisNeedsGuard` 时 **`upgraderTarget = maxCount`**（本房 `maxCount=3`、`controllerDowngradeRisk=true`）⇒ 花 3×250=**750 能量**孵"保级"编制；creep 侧 `kernel.ts:988-1003` ⇒ `roomState∈{recovery,bootstrap}` 且 **`role.priority > 1`** 且非 `recoveryEligible` 且非 combat ⇒ `recordSkip("creep/<role>/colony-state")` **跳过 run()**，而 **`src/creeps/roles/upgrader.ts:267 defineRole("upgrader", 2 as Priority, policy)`** ⇒ upgrader 恰好 P2 且无豁免 ⇒ **被冻**。
  **现场三台仪器同向**：①`kernel.skipReasons` 现读 **`creep/upgrader/colony-state = 396`**（本房角色级最大项，`skipHotspot` 已从 `creep/spawning` 换成它）；②`R161E1@83428633` roster 里 **3 只 upgrader 在场（TTL 1242/1257/1285，携带能量全 0）**、`spawnQueue=[]`、`人口 6→9` ⇒ 不是没孵，是孵完了不干活；③`controller.progress = 12,952` 与 R160 补9（≈15:4xZ）**逐字相同** ⇒ 约 10,000 拍里 0 升级工作。
  **日程（带前提的预报，前提正是本条要验的命题）**：`ttd` 6,624（R160E9@83427843）→ 5,788（@83428633）＝ **−1.058/拍** ⇒ 若维持零升级工作，**t≈83,434,100（≈5,470 拍后；按本轮标定 3.9 s/拍 ≈5.9 小时）RCL2→RCL1**。⚠️否证签名干净：`progress` 离开 12,952 或 `ttd` 止跌 ⇒ 冻结合不上，届时改读 `config/index.ts:403-405`（"upgrader 允许工作前的最低 extension 能量（RCL1-3）"，在本条冻结的**下游**、本轮无法单独验）⇒ **别把它说成"解开冻结就能保级"**。
  **与 #120/#122/#124 的关系（这是同一间房的第四把闸，不是新病灶）**：`colonyState=recovery` 由 `phaseToColonyState`（`phase.ts:558-563`）纯派生，而 recovery 是被遗留 storage 的 `hasBank` 钉住的（#120/#122）⇒ 所以**同一间 storage 现在同时按住三件事**：builder 需求乘 0（#122 ★★★块）、出带线够不到（#120）、以及**保级 creep 不许工作**（本条）。⇒ 给 #122 的修法①/②再加一条理由：只在相位处特判"存在≠能力"会一次松开三件事；只修 builder 需求那一处则本条照旧。
  **给人拍的三条（我不自办）**：(A) 让 upgrader 在 `controllerDowngradeRisk=true` 时 `recoveryEligible`（＝两层同意，语义改动最小，但它把"recovery 期不许发展"这条既有设计破了；**R163 补4：这其实是一行**，钩子已存在、`builder/mineralMiner/claimer/reserver` 都已在自报，只是 upgrader 没报）；(B) demand 侧别再为保级孵不会干活的编制（省 750 能量/一代，等于承认"这房放弃自救"）；(C) 什么都不动 ⇒ 按上面日程降级，然后看扩张状态机怎么收（`abortExpansion` 路径是否被降级触发，本轮未读）。
  ★★★**R163 补5（20:1xZ）前提集补上一整类出口 ⇒ 选项从三条变四条；而这四条现在互相不重叠了**：现场 `R163E5@83430123` 现读该房 **`controller.safeModeAvailable = 1`**（`safeMode=0`、`safeModeCooldown=0`、`hostile=0`）⇒ **这房还压着一张能挡住这次降级的保险**，但 `tryActivateSafeMode` 的四个调用点全在入侵语境（`tower-defense.ts:71/76/185/197`，注释 `:372-376` 把触发场景列为"无塔且核心被突破／有塔且核心被拆或塔全空被突入／舰队伤亡熔断"），`recovery-execution-system.ts:873` 那条也只把需求写进 `roomMem.defenseState.safeModeRequested` 且前置是 `CRITICAL + NUCLEAR/FULL_ASSAULT/SIEGE` ⇒ **没有任何"降级语境"的代码路径能花掉这张充**（和平期它注定不动）。**(D)＝手动花掉这张 safe mode 挡下这次降级**：代价要讲清——它是**消耗性资产**，且**只掩盖症状不拆环**（`progress` 仍会冻在 12,952、builder 仍为 0、crisis 仍出不去）；按安全内核"不烧已建成资产去凑条件"的同一条纪律，我不自办。
  · **一条方法论欠账（写在这里是因为它是我的漏项而不是现场的意外）**：我给降级预报列前提时枚举了"冻结／能量地板／供能路"，**漏了被测量（controller 衰减）本身的其他出口**——safe mode 是被对端那笔 `#119`（`1ac133d7`，动 safe mode 出口账本）撞进视线的。⇒ 立"量 X 会在 T 到界"的预报之前，先把**所有会写/消耗 X 的位置**（含引擎自带保险、冷却、一次性资产、人工出口）逐条列进条件集；否则命中会被读成"预报准"、落空会被读成"机制错了"，两者都错。同轮的另一笔账：`stash@{0}` 是 lint-staged 因对端抢先提交而生成的 **pre-hook 备份**，我用只读的 `git apply --check --reverse` 验过它内容已在当前树（⇒ 冗余、无遗留工作），**没有 drop、没有 pop**。
  **免费复证已在表上**：判效器 pid 58241 还剩 ≈35 发（覆盖到 ≈83434,3xx）**正好跨过预报点** ⇒ 下一轮读 `tmp/observe/r160-cp4.log` + `rooms.W38S58.controller`?（不在 Memory，走 `observe`/console 一发）即可裁决，不需要制造条件。
  · **★★R162 补1（19:1xZ）本条从"一致性"升为"速率级"，并且处置菜单的 (A) 被我自己的读数打折**：
    **速率**——`kernel.skipReasons["creep/upgrader/colony-state"]` **396（@83428633）→ 777（@83429,2xx）** ＝ **Δ+381 / 595 拍 = 0.64 冻结/拍**。在场 3 只 upgrader、kernel 的 idle cadence 在 healthy 档 **5 拍一评** ⇒ 理论值 **3/5 = 0.60/拍** ⇒ **观测与"每次被评估都冻"吻合到 7% 以内**（不是偶尔冻）。三只按 name 逐字锚定为同体（`upgrader-W38S58-{0,1,2}-83428364/83428382/83428410-*`，名字嵌出生拍，与上轮 TTL 反推一致），携带能量全 0、`mode=acquire`。零工作的两台独立仪器：`controller.progress=12,952` 与 `energyLedger.upgraded=2,500` 双双**逐字不变**。
    **★★★R168 补21（23:3xZ）撤掉上面那条速率推导，并把它换成强得多的形状——`skipReasons` 是 500 拍滑动窗，不是累计量**：现场证据是同一 boot 内（`energyLedger.tick` 恒 83,431,816、`kernel.bootTick` 恒 82,414,952）该键先读 **852** 后读 **417**——**会掉就说明有清除者**。写者核到 `kernel/memory.ts:252-254`：`Game.time % 500 === 0` 时把整张表搬到 `prevSkipReasons` 并清空 ⇒ ①上面那句"Δ+381／595 拍＝0.64 冻结/拍"**推导不成立**（拿窗口计数除以"距 boot 的拍数"），R162 补1 ③ 复述它的地方一并作废，我不引任何"距 boot"的速率；②正确仪器是**整窗快照**：`prevSkipReasons["creep/upgrader/colony-state"] = 1,500`（一个完整 500 拍窗）＝**恰好 3.0 次/拍**，而在场正是 3 只 upgrader ⇒ **"每只、每拍都被评估、每拍都被冻"**——比我原先说的"每次被评估都冻（cadence 5）"更强且口径干净（顺带否证了"kernel healthy 档 5 拍一评"这个我用作理论值的假设：若是 5 拍一评，上限只有 0.6/拍，1,500/500 不可能出现）。⇒ 同窗另两把闸的读数也要按同一口径重读（`creep/spawning` 1,105、`hauler/idle-cadence` 1,499、`defender`／`labTender` 各 400、`system/*/budget` 若干 100）。**一般规则（已进长期记忆）：凡从 `skipReasons` 出速率，分子取 `prevSkipReasons`、分母固定 500，并先证那一拍不在窗口边界上。**
    **(A) 不够**——upgrader 的供给面现读为空：房内 2 只 container **全是 source 旁**（31,14 贴矿 32,15／26,19 贴矿 26,18）、**controller container 无**、**link 0** ⇒ `upgrader.ts:126-128` 的"有非源 container/link 能量即放行"为假 ⇒ 落到直采分支，被 `config/index.ts:404` `upgradeEnergyFloor=300` 挡，而本房 `energyCapacityAvailable=300` ⇒ **地板＝满池**（595 拍窗内 `ea` 在 147↔300 摆动 ⇒ 只有池顶够）。⇒ 措辞固定为：**给 upgrader 加 `recoveryEligible` 只是把它们送到第二把闸前面，不保证保级成功**；真要走通还得有 controller container / link 那条供能路——而那需要 builder ⇒ **绕回 #122/#126 那间遗留 storage**。
    **但那条供能路已经在自己的队列里**（`R162E4@83429318`）：`buildQueue` 里唯一的 container 任务是 **`key="logistics.container.controller"`、pos (14,12)、state=`queued`** ⇒ 布局**确实排了 controller container**，只是和另外 2 张 extension 一样等 builder；全队列 24 条清完＝`extension:site 3 / road:site 2 / road:queued 16 / extension:queued 2 / container:queued 1`（⚠️这个计数**不能靠 peek**——`rooms.W38S58.buildQueue` 那行 700 字符截断，我第一发只看见 4 条 site，又踩在"raw slice 计数只是下界"上）。⇒ **(A) 的完整判语**：今天光加 `recoveryEligible` 不够，但**只要那张 controller container 落成，`upgrader.ts:126-128` 的"有非源 container 能量即放行"就翻真、第二把闸自动失效** ⇒ 所以"三件事同一根因"的说法要收紧成"**同一根因、同一个解**"：把"存在"改成"能力"那一处收口会同时放开 builder 车道与这条供能路；只动 creep 层的角色豁免，则必须排在 container 落地之后才有意义。⇒ **给裁决窗加一条免费可查项**：除 `progress/ttd/level` 外，现读 `logistics.container.controller` 的 `state` 是否从 `queued` 变 `site`——变＝有 builder 在场（当场否证 R160 补33 的机制），不变＝与机制一致。
    **★★R163 补1（19:5xZ）本条拿到一张最干净的定罪差分表，并且"保级编制"被证实在蒸发而非暂时的**：间隔 ≈650 拍的两次 `energyLedger` 读数差分＝`harvested 24,680→29,552（+4,872 ≈ +7.5/拍）`、`pickedUp +300`、`spawned +400`，而 **`upgraded 2,500→2,500（+0）`、`built 4,064→4,064（+0）`** ⇒ **房子正常采能、正常孵 creep，却把 0 能量转成升级、0 转成施工**（两条发展通道同时零产出，机制各自已核）。同刻现读在场 upgrader＝**只剩 1 只且 `ticksToLive=17`**（R162 那三只里两只已按寿命 ≈1,489 自然死掉，出生拍嵌在 name 里可逐字核对），而 `Q=` 已重新出现 `upgrader:W38S58:2` ⇒ **形状是"每代花 250 孵一只、冻到死、再孵下一只"的稳态循环**：`spawned` 持续涨、`upgraded` 恒 0 ⇒ 这不是"暂时没能量"，是**花钱买零产出**，措辞按此固定。预报点第三次独立确认：`ttd` 5,788@83428633 → 5,193@83429228 → 4,520@83429901，**两段斜率都恰好 −1.000/拍** ⇒ 0 点 = **83,434,421**，落在已声明窗口内。预挂的三项否证检查全部回来"一致"（builder 命中数 0／`logistics.container.controller` 仍 `queued`／`cp=3` 未变）⇒ 机制仍未被否证（一致性≠证明）。裁决窗用的免费仪器换成 **Memory 侧**：`controllerProgressChangedAt`/`controllerProgressSeen`（`c93f467` 落的锚点）⇒ **progress 一动那个时间戳就动**，所以守望不需要 console、不与并行会话抢 `__evalResult`。
    **★★★R163 补2（20:0xZ）第四台仪器把本条的覆盖面划清了——它只管后半段**：免费的 Memory 锚点 `controllerProgressSeen=12,952`（与 `Game` 侧逐字相同）与 **`controllerProgressChangedAt=83,424,421`**，写者 `room-state.ts:98-101` 是**逐拍**比较刷新 ⇒ 粒度 1 拍，可当"最后一次升级工作的时刻"用。于是零升级这段其实分两阶段：**阶段 1（83,424,421 → ≈83,428,400，≈4,000 拍）房里根本没有 upgrader 在场**（R160 普查 0 只、请求挂着孵不出）⇒ 原因是"没有编制"，与冻结无关；**阶段 2（≈83,428,400 起）编制在场被冻**（速率级证据 0.64 冻结/拍）。⇒ **本条解释阶段 2，不解释阶段 1，不许被读成"这房 5,500 拍不升级都是它造成的"**；反过来这也是"出路 (A) 单独不够"的独立佐证（就算解冻，阶段 1 那道孵化/换代那道与供能面那道都还在）。另有一处**如实挂着不解释**：`colonyStateSince=83,423,876` 比最后一次进度变化早 **545 拍**，而冻结按代码应从翻拍起生效 ⇒ 那 545 拍的工作不是 upgrader 干的，最可能是 `priority<=1` 的 P0/P1 角色里带 WORK 的兜底动作（我没读那条链 ⇒ **不补故事**，登记为"未解释的 545 拍"）。
    **★★★R163 补4（20:0xZ）那 545 拍缩到唯一候选，本条的矛盾同时拿到最锋利的表述——两层的豁免是反的**：`defineRole` 四处现读 `worker=0 / hauler=1 / upgrader=2 / builder=2`；`recoveryEligible: true` 只有四个角色自报（`mineral-miner.ts:14`、`claimer.ts:37`、`reserver.ts:87`、**`builder.ts:60`**，经 `role-runner.ts:27` 透传）。⇒ **builder 在 creep 层已豁免、却在 demand 层被乘 0（`demand.ts:1098`）；upgrader 在 demand 层被保级拉到 maxCount（`:920-923`）、却在 creep 层因 P2 无豁免被冻** ⇒ 合起来＝"**把钱花在不许做事的编制上，同时从不问能做事的编制要活**"，而每一层单看都说得通。545 拍那条：能调 `upgradeController` 的只有 `upgrader`（此时已被冻）、`worker`（**P0 永不冻**，`worker.ts:72` 的 work 链含升级）与 `hauler`——而 hauler 那处 grep 命中是**注释**（`hauler.ts:211-212` 明写无 WORK 部件、升级会 `ERR_NO_BODYPART`）⇒ 排除 hauler，**唯一候选＝当时房里有 worker**（P0 恢复分支 `demand.ts:313-349` 会孵 `worker:0`）；亡者不留 `Memory.creeps` ⇒ 按"**候选缩至一支、不可再证**"结案。⇒ **(A) 的真实形状是一行**（钩子已存在）：`upgrader.ts` 的 policy 里加 `recoveryEligible: true`；但**不保证保级**——后面还吃着 `upgradeEnergyFloor=300`＝满池那道与供能面那道（`logistics.container.controller` 仍 `queued`）。⇒ **问句要重新表述**：**"保级"算 recovery 的生存目标，还是算发展目标？** 算生存 ⇒ 豁免该给 upgrader，并把 `upgradeEnergyFloor` 的语义一起理清（否则给了豁免也吃不到能量）；算发展 ⇒ `demand.ts:920-923` 就不该在 recovery 期为不会干活的编制花那 750。**两种自洽选法都存在；现状是两者混着选——那正是零产出的来源。** 另记一条**今天已存在的替代能力**（不立案、不自办）：worker 是 P0、work 链含升级、P0 分支明文"绝对不冻结"⇒"让 worker 顺带保级"这条路不受本条影响，但它动作面更宽（建造/修理/填充优先），要不要用属排产选择。（对端最近 12 笔 src 提交属 #100/#111/#113 的观测与 intel 面，**未碰这几处闸** ⇒ 机制继续成立；按记忆那几笔尚未推送 ⇒ 也不在跑的二进制里。）本条的三条出路里只有 (B)/(C) 的算术不受影响。
    **裁决窗两版**（不静默改口）：R161 写死的是 **t≈83,434,100**（按 −1.058/拍）；本轮同斜率复测 **−1.000/拍**（`ttd` 5,788→5,193 用 595 拍，恰好 1:1）⇒ 新算 **83,434,421**，差 321 拍（≈21 分钟）。⇒ **裁决窗取 [83,434,100, 83,434,500]**；原始那一版仍是预报本体，窗内 `ttd` 未到 0 只记"未到期"，既不算命中也不算否证。
  · **同轮扩张 gate 现读**（`kernel.expansionDashboard@83429184`）：**`Blocked=G0+G2+G3+G4+G6`（五道）**，其中 **G2 红的直接原因是 `struggling=1`** ⇒ 幼房的 crisis 现在连"新扩张提案"也在挡（这是 #120/#122 的外溢面，从"本房发展"扩到"帝国新增"）。同屏 `Pressure=HIGH(0.62)` 与房级 `economyPressure=0` 是**两台同名仪器**，引用时分开（既有口径，别当矛盾）。

- **#128 扩张 checkpoint 的重试/回退阶梯在调用点是惰性的：`retryCount` 五处全传字面量 0 ⇒ `maxRetries` 与 `fallbackTo` 永不生效（10-04 R164 补5 登记；低优先，属设计清理，不自办）**
  `checkpoint.ts:216-217` 用 `shouldRetry = !passed && input.retryCount < def.maxRetries` 决定 `status = passed ? PASSED : shouldRetry ? PENDING : FAILED`，并在 `:226` 用同一条件产出 `fallbackTo`；而调用侧 **`state-machine.ts:304 / 429 / 462 / 583` 与 `checkpoint.ts:239` 五处一律传字面量 `retryCount: 0`** ⇒ `0 < maxRetries` 恒真 ⇒ **任何 checkpoint 在未通过时只会是 `PENDING`，永远不会 `FAILED`，`fallbackTo`（CP4→CP3、CP5→CP4）这条回退线从不触发**，`CHECKPOINT_DEFINITIONS` 里的 `maxRetries` 三/五是**装饰性常量**。
  **对本次目标的意义（这是它被记在这里的唯一理由）**：不存在"CP4 长期不过关 → 判 FAILED → 系统按 `fallbackTo` 重排扩张"这条自动出路 ⇒ **等待是无限期的**；一次扩张的终态只能来自两支——超时支（`state-machine.ts:482-499`：`tick − startedAt > pioneerTimeout×2` 时 `cp3.passed` ⇒ `FORCED_ADVANCE`（`checkpointsPassed` 仍留 3），否则 `abortExpansion("TIMED_OUT")`）与所有权丢失支（`:508-514` `LOST`；**RCL 降级不改 `controller.my` ⇒ 降级本身不会让扩张被中止或重排**）。
  **严重度如实降级**：今天它与"什么都不做"的结果相同（沉默等待），所以**不是当前任何读数的原因**；只有当有人指望"失败图里那些 checkpoint 失败态/回退"来表达系统行为时，它才会咬人（同族先例：`manual_intervention` 是无生产者的死枚举）。**两种清理都属设计**：把 `retryCount` 真接到 checkpoint 记录上让它有意义，或删掉这两组常量以免误导——**不自办**。

- **#132 「非 P0 孵化预留 200」与「WORK 类角色最小合规 body＝200」在低容量房里构成一条自指锁：`energyCapacityAvailable < 400` 时 builder/upgrader 按构造孵不出来（10-05 R170 补29 立案；三处都属"改安全预留/改 body 地板"，协议禁止我自办，只摆数）**
  · **⚠️R172 补32 严重度降温（读本条先看这一行）**：标题里"按构造孵不出"**说过头了**，正确作用域是"**在预留生效的那些拍里**孵不出（预算 300−200=100 < WORK 类地板 200）"。现场否证：`R172P1@83,437,467` 看到两只 upgrader（出生 83,436,742／83,436,942）与一只 hauler（83,437,442）先后成功孵化、`spawned` +900 ⇒ **预留是时开时关的，off-window 里一切正常**。⇒ 本条的真实形状是**周期性阻断＋排序不利**（builder 恒 P2、TTL 1,000 拍，单 spawn 前总是 P1 先走——同段里两只 P1 hauler 孵出而 builder 一整代轮不到），而不是"绝对锁"。三条候选出口不变，但**最可动的杆是排序/TTL，不是预留数值**；请按这个新形状判。
  · **★R175 补35 ③ 补一条不对称（把"改哪个"问得更准）**：阻断是**按角色**的，不是按"池子大小"的。`ROLE_REQUIRED_PARTS` 有 `hauler:["carry","move"]` ⇒ 最小合规 body＝100＝恰好等于"池 300 − 预留 200"；而 `upgrader`/`builder` **没有条目** ⇒ 落进默认 `["work","carry","move"]`＝200 > 100（`bodies.ts:1732`；四臂夹具：预算 100 时 hauler 出得来、work 类一律 undefined）。P2 的降级逃生口另需 `economyPressure > 0.5`（`spawn-manager.ts:513`），而现读 **0.4**（几轮来首次离开 0）⇒ **预报：pressure 越过 0.5 后 haul 线会自愈、builder/upgrader 仍孵不出**；否证位＝届时 hauler 仍持续 `spawn/churn/hauler/expired` 而不孵化。**⚠️但本 bullet 最后那句推荐被我自己跑夹具否证了，以此为准（R175 补36）**：出口③（给 upgrader/builder 补 `ROLE_REQUIRED_PARTS`）**单独不够**——四臂夹具实测真实地板是 **150**（`work+move`，再往下砍会被 `bodies.ts:1754-1758` 的 MOVE 配比守卫挡住），而默认三件套是 200 ⇒ 补条目只把地板 200→150，**够不到预算 100**。⇒ **真正可达的两根杆是"池子抬到 ≥350（＝回到 RCL2 落 extension）"或"预留降到 ≤150"**；出口③只能作为"让 body 更小更省"的第二步，**不能被写成不动安全额度就能解闸的那一条**。
  · **算术（全部带出处）**：`spawn-manager.ts:484-485` ⇒ `effectiveBudget = energyBudget − reserve`，**豁免只给 `survival` 与 harvester/worker**；预留值＝`config/index.ts:205 recoveryEnergyReserve: 200`（三条触发位 `:426/:437/:442`；W38S58 现读 `collectorCount=3` 不走 :426，走 `cr>0 且 rb/10<lowRiskBufferTicks(400)` 或 `replacementReserve` 之一）。而 `degradeBody`（`config/bodies.ts:1729-1732`）**默认 `requiredParts=["work","carry","move"]`**，且 `ROLE_REQUIRED_PARTS`（`domain/spawn/demand.ts:10-19`）**没有 upgrader / builder 条目** ⇒ 默认三件套生效 ⇒ **WORK 类最小合规 body＝200**（work+carry+move，且 MOVE 配比守卫 `:1754-1758` 不放过再砍）。⇒ `ec=300`（RCL1、0 张 extension）⇒ `budget ≤ 100 < 200` ⇒ **孵化该角色在这房里永远不可能**，与排队顺序、能量水位、phase 都无关。
  · **现场见证（差分，不是累计读数）**：`R170P6@83,435,902` → `R170P7@83,435,951`（49 拍）——`Spawn7` 全程 **IDLE**、`ea=300=ec`（满池）、队列只有 `upgrader:W38S58:2`（P1、body 250）；`spawnRejects.reserveOnly +49`、`noDegrade +49`（**恰每拍各一次**）、`budget +0`、`degradeGateClosed +0`、`floor +0`。⇒ 挡它的不是"缺能量"而是**预留切掉的那 200**（`reserveOnly` 的定义就是"只在扣预留后才越线"），而逃生口（降级）在 100 预算下产不出合法 body。
  · **本地执行证明（临时夹具，即写即跑即删、未 stage、未碰 dist）**：`degradeBody(["work","carry","move","move"], 100)` ⇒ **undefined**；控制组预算 **200** ⇒ 恰好 `[work,carry,move]`（**两臂结果不同 ⇒ 这条证明有分辨力**）；hauler 用其 `requiredParts=["carry","move"]` ⇒ 预算 100 也能出（**这就是"采集/搬运线活着、WORK 线全灭"的原因**）；预算 50/100/150 三档全 undefined ⇒ 地板确为 200。
  · **它同时解释了排在前面的两件事**（所以我此前两轮的机制说法要打折）：(1) 补26 说的"P1 保级 creep 抢走槽位 ⇒ P2 builder 轮到才过期"——**outcome 对、机制错**：builder 即便排第一也孵不出（P2 允许降级需要 `economyPressure>0.5`，本房恒 0；走 P1 路径则撞 200 地板）；(2) 补28 的"重启锁"——需求道不再投是一半，**另一半是"投了也孵不出"**，所以"窗内永远看不到 builder"这个观测有两根因，别只记一根。
  · **摆数（三个出口都属人，我不挑一个执行）**：差 **100 能量**就能开——①预留 ≤100（或按 `ec` 比例化，例如 `min(200, ec×0.3)`）；②给 builder/upgrader 与 harvester/worker 同样的预留豁免（`isCollectorRole` 扩到"能改变能量现状的角色"，同一行代码上）；③给 `ROLE_REQUIRED_PARTS` 补 upgrader/builder 条目（work+move ⇒ 地板 150；只 work ⇒ 100），使降级能产出可用的小 body。**代价各不同**：①会削弱"P2 支出抽干替换能力"的原防护（B1 归因在 `P3_BASELINE.md §6`）；②方向上是"把发展角色当恢复角色"，语义要先定；③只让 body 变小、可能孵出移动力不足的 creep 在通勤上吃亏。**注意三条都不该由我为解闸去试**——按协议这正是"为了解闸降阈值=自败"那一类。
  · **可复采的免费判据**：本房只要 `ea` 冲到 300 而 `spawnRejects.reserveOnly` 与 `noDegrade` 仍同拍 +1/拍 ⇒ 锁仍在；若某天 `degradeGateClosed`/`noDegrade` 停止增长而 `Spawn7` 变 BUSY ⇒ 有出口被打开（届时回来撤本条严重度）。
  · **★R170 补29 续：这一轮就把"到底是哪条触发位"定住了，因此修法可以比上面列的更窄**。`R170P8@83,436,112` 现读 `economy={cr:0, rb:0}` ⇒ **条件 2 为假**（它要 `cr>0 且 rb/10<400`）；`collectorCount=3` ⇒ **条件 1 为假**；而房内三只 harvester 的 `ticksToLive`＝**221 / 469 / 1482** ⇒ 两只已进入替换窗 ⇒ **现在咬住这房的是条件 3 `replacementReserve`（`spawn-manager.ts:441-443`）**。⇒ 最窄的候选不是"把预留调小"，而是**"预留正在保护的替换能力，恰恰要求被它挡在外面孵不出来的那两个角色（upgrader 升级、builder 建 container/extension）才能长期解决"**——它保的是 harvester 换代（而 harvester 本来就豁免），代价是把恢复路径上的 WORK 类角色全钉死。
  · **由此得到一条重要的软化（别把本条读成绝对锁）**：条件 3 是**时开时关**的（换代完成、三只 harvester 都不在窗口内时预留归 0 ⇒ `budget=300` ⇒ 200 的 builder body **可以孵出**）。⇒ 本条的正确说法是"**在预留条件成立的这些拍里孵不出**"，而不是"永远孵不出"；可观测出口＝某次 `Spawn7` 在 `ea=300` 时变 BUSY 且孵的是 builder/upgrader ⇒ 说明当时踩进了 off-window。⚠️同时这也意味着 **补28 的"重启锁"有一条我没证到的漏口**：如果需求道恰好在 off-window 投出并被孵化，现场就会看到"断代后又出现 builder"——那时两半都要重记。**⚠️R171 补30 ② 已把这个漏口量出来并收窄：613 拍差分窗里预留生效率 ≥96.2%（`noDegrade +590`，P1 请求连续存在），off-window ≤23 拍，且其中没有一次 WORK 类孵化；同一窗里反倒孵成了豁免角色 harvester（账本 `spawned +300`）。⇒ 对 builder/upgrader 而言这是"准恒锁"，别把 off-window 当成"等一等就会自己过去"的间歇现象；判据不变（`Spawn7` 在 `ea=300` 转 BUSY 且孵 builder/upgrader 才算越窗）。**
  · **★R177 补38：上面那条"免费判据"当场兑现，而且被挡的角色换成了泵（本条的作用域要再改一格）**。`distributor-W38S58-0-83442333-1ee` 本体＝`1C1M`（降级产物）⇒ 那一拍 `eav−200≥100` ⇒ **`eav` 必＝300＝本房天花板**（`bodies.ts:1634-1643 PART_COST`＝carry/move 各 50）。⇒ 准确说法不再是"WORK 类最小 body 撞预留"，而是：**在 `cap=300` 的低容量房里，绝对值预留 200 让"全房最便宜的合法 creep（泵 100）"也只有一拍能孵（池满那一拍），而 hauler（250）在任何 `eav < 250+reserve` 的拍都出不来**。现场代价已付：hauler 2→0、distributor 1→0，两条替补请求各被计 **2/拍** 的 `degradeGateClosed` 直到 TTL 到期未孵（`retries` 全程 0＝上游 `cost>effectiveBudget` 先 `continue`，所以既不烧重试也到不了 `:563` 的容量检查）。⇒ **补37 把本条降成"今天没有在发生"要撤回一半**：那一刻队列是空的所以确实没挡，本窗有 3 条正在被挡。⇒ 咬合力的正确措辞是**按车道、不是全序**：builder 道当前＝"没人投"（#122），运输道当前＝"投了但预留 / `:513` 的 `economyPressure>0.5` 那道门不放"（本条）。
  · **本条现在可以按名字精确算 off-window（不必等仪器）**：creep 名第 4 段就是出生拍，`replacementHorizonTicks=600` ⇒ 某只 harvester 让预留生效的区间＝**出生+900 → 出生+1500**（恒 1500 寿命）。R177 算出的是 `[83,442,751, 83,442,944] ≈193 拍`，与补30② 的"≤23 拍"不矛盾（不同代际、不同时刻；那条是在 83,435,9xx 那批 harvester 上量的）。
  · **⚠️R178 补39 更正上一条的端点算法（错一格、方向没错）**：`ticksToLive` 从**孵化完成**那拍起算，而名字里那个拍是 `spawnCreep` 成功的拍 ⇒ **要加 `spawnTime = body.length×3`**；同一形状也解释了昨天 `replaceBy − createdAt = 33`＝`6×3+replaceBuffer 15`。⇒ 正确端点＝**[名字拍 + body.length×3 + 900, 名字拍 + body.length×3 + 1,500]**。用修好的算术重放 R178 窗：两只 200-cost upgrader（83,442,829／83,442,941）都落在 off-window 内 ✓；三只 100-cost（83,442,333 泵、83,442,609／709 hauler）落在预留开着时段、只能靠 `eav=300` 那一拍的 100 余额 ✓。**别把"落在带外"当成否证本条——先按上面补的那一格重算**。
  · **同名仪器提醒（防下一轮合并读数）**：`economy.cr=0` 与 `phase.reserve=4,401` **不是同一个量**（前者是经济快照侧的 `round(reserve)`、后者是 room-state 的总储备）；本条只用了前者判"条件 2 真假"，不要顺手写成"这房储备是 0"。

- **#133 E7 `siteStale*` 的分桶口径与它自己的注释相互矛盾，且 E6 在 recovery 期被设计静音——结果"幼房没有 builder 导致工地 6,542 拍零推进"这类停摆在 bot 自己的期望面上要么被错标、要么不被标，且两条都没有消费者（10-05 R173 补33 立案；属检测质量改动，需动 src ⇒ 属人排产，我不自办）**
  · **现场**：`期望自检 @83438355` 列出 4 条 W38S58 的 `siteStaleWorkerIdle`，`noProg=6,542`、`workers=3`，其中两张 extension 工地 `286/3000`、`0/3000`（第三张在 `slice(0,10)` 之后，被截断看不到 ⇒ 列表是人读的，不当机器判据）。而 `R172P4` 实测**全帝国 builder＝0**。
  · **矛盾在哪**：`kernel.ts:697` 的注释写 `workerCreepsInRoom` 是"该房内我方 **builder** 的实时数量"；而实现（`kernel.ts:714-723`）数的是**该房内任何带 ≥1 个 WORK 部件的我方 creep**，并明确写"**⚠️不按 role 筛**：远矿路是通勤 hauler 建的，只数 builder 会把远矿停滞误判成'没派人'"。⇒ 实现是有意为之、注释是旧的；本房那 `workers=3` 是 2 只 harvester＋upgrader，**一只 builder 都不是**。
  · **为什么这条会误导人**：`expectations.ts:493-494` 把两个桶定义成"互斥且各自可行动"——`siteStaleNoWorker`＝没派编制（编制/派遣侧修）／`siteStaleWorkerIdle`＝人到了不推进（能量/射程/取活侧修）。本房的真相是**没有 builder 这一角色**（×0 起步锁＋P2 排序不利＋#132 预留期阻断），却落进第二个桶 ⇒ 顺着读数去查"能量/射程/取活"会白查三轮。
  · **第二处**：E6 `buildQueueStale` 在 `colonyState ∈ {recovery, bootstrap}` 时**故意不报**（`expectations.ts:468-478`，注释称"误报保护：recovery 下的排队是预期行为"）⇒ 这房在 recovery 里连续 ≈3.5 小时，正是它被静音的时段。
  · **第三处（最重要）**：`expectations.ts:485-486` 自陈"**违例清单在 `src/` 内没有任何按 id 的消费者**（只有 `kernel.ts` 写 Memory＋发一条计数事件），所以这里改判据不会改 bot 的动作" ⇒ 即便分桶正确，也**不会触发动作**。
  · **★R177 补38：分桶错拿到了现场执行证明（不再只是读码推断）**。`期望自检 @≈83,442,105` 报 `siteStaleWorkerIdle:W38S58` 三张 extension 工地 `workers=6 noProg=8,200~10,298`；同拍逐只带本体的花名册（`R177P7@83,442,386`，名字第 4 段＝出生拍）＝harvester×3（2W1C1M／1W1C1M／2W1C1M）＋upgrader×3（1W1C1M×2、1W1C2M）＋distributor×1（**0 WORK**）⇒ **"带 WORK 的在场 6 只"是真的，"会建的 0 只"也是真的**。分桶说"有人在场却不推进"，真相是"在场的人没有一个会建"。⇒ 选项①（拆 `builderCount`/`workPartCount`）现在有了可复采的判据：拆完之后这三条必须从 `siteStaleWorkerIdle` **翻成** `siteStaleNoWorker`（或新增的 `…NoBuilder`），而 `workers` 那一列要留在 `detail` 里，别把两件事合成一件。⚠️同一发还带出一条口径注意：`creep/<role>/idle-cadence` 这类 skipReasons 键是**帝国级**的（本轮 W38S58 有 0 只 hauler 却读到 `prevSkipReasons["creep/hauler/idle-cadence"]=322`，因为前一整个 500 拍窗里那两只 hauler 还活着）⇒ 按房读任何 skip 键之前先确认它带不带房名。
  · **要人拍的到底是什么（一个选择题，不是"降阈值"）**：①把 `workers` 拆成两个字段（`builderCount` 与 `workPartCount`），保留远矿那条既定语义不误伤；②或给 E7 换第三个桶 `siteStaleNoBuilder`；③或接受"检测只作诊断"，把这条停摆交给**已有的** failure-graph（`development` 域的 `development_resume` **在代码里带 builder 臂**（`recovery-execution-system.ts:782` 以 `buildQueue>0` 为条件），**但线上从未观察到它真投出过 builder**）——那就要查"为什么 `development` 这条没为 W38S58 触发"（**R174 补34 已查完：它从未为 W38S58 触发，而且在 RCL1 上来不及触发**——`controllerProgressChangedAt` 这个锚点被 83,434,421 那次引擎重基挪过，`E5_STALE_TICKS=10,000` 恰好等于 RCL1 的全部降级容忍 ⇒ 出口首次可用 ≈83,444,421，与失控点 ≤1 拍。⇒ **选项③单独不成立**，它必须与选项①/②（分桶修对、或让 builder 这一类进入某个更早触发的通道）配对才有效。）
  · **受害者与代价（不是空谈）**：CP4 的三张 extension 工地 6,542 拍零推进；以及我本人 R168→R172 五轮手工考古，其中 E7 早就在面上报过同一件事——**如果它当时标对桶，至少三轮可以省掉**。

- **#134 饥饿降级地板 `300` 与它在 recovery 的整条豁免互相矛盾，而且地板在低容量房里按构造不可满足 ⇒ 幼房的运输/泵只能以 1C1M 残废 body 出、还要活满 1,500 拍（10-02 那批"#54 三问③"留下的问题，本轮第一次拿到执行答案）**
  · **两把闸各在哪**：`config/index.ts:214-217 starvationDegradeFloor: 300`，注释原文＝"无地板会在能量低谷铸出残废 body（如 **1C1M distributor**），其存活整个生命周期 → 吞吐塌方 → 自强化回路"；而 `spawn-manager.ts:544-548` 写的是 `survivalPath = req.survival || roomState ∈ {bootstrap, recovery}` ⇒ **地板对整条 recovery 豁免**。W38S58 现读 `colonyState="recovery"`（R178P1；`Since=83,431,754` 是 R177P2 读的）⇒ 豁免正在生效。
  · **现场（名字级、逐只带本体）**：`hauler-W38S58-0-83442609-1ej`＝**1C1M**、`hauler-W38S58-1-83442709-1em`＝**1C1M**、`distributor-W38S58-0-83442333-…`＝**1C1M**；`PART_COST`（`bodies.ts:1634-1643`）carry/move 各 50 ⇒ 每只 cost **100**、每趟运力只有 **50**。同窗那两只 upgrader 是 200-cost 正常档（1W1C1M）⇒ **不是全局退化，是运输角色被单独压到了最小档**。账本对上：`economy.bk.spawned=200` 恰＝两只 hauler 之和。
  · **地板本身不可满足**：`energyCapacityAvailable=300`（RCL1、extension 合法数 0）减预留 `recoveryEnergyReserve=200` ⇒ `effectiveBudget` 最大 **100** ⇒ **任何 ≥300 的降级产物在本房永远出不来**。⇒ 即使取消豁免，结果也不是"出好 body"而是"**什么都出不来**"。两把闸里必有一把是错的——**这条属于"改安全预留/阈值"那一类，不自办**。
  · **代价的量级（别读成"零运输"）**：豁免让房子保住名义运输，代价是长期只有名义运输。三只 1C1M 的死期＝**83,443,833／83,444,109／83,444,209**（名字拍+1,500）⇒ 从下一轮起可以免费看完这批残废 body 的整个生命周期：`eav` 是否始终两位数、工地是否仍是 2,792、`spawn/churn/*/expired` 是否继续涨。
  · **要人拍的（选择题，我不挑一个执行）**：①让地板随房容量走（`min(300, cap − reserve)` 或按 `cap` 比例）；②把豁免**收窄到采集/生存角色**（现在它把 hauler/distributor 也放进来，正是注释点名的那一型）；③把预留从绝对值 200 改成 `min(200, cap×k)` ⇒ 让地板与预留落在同一把尺子上。
  · **lineage 与边界**：这一问在 10-02 的 §4.0-pre（`#54` 的"三问③"：`pressure>0.5` 与 `starvationDegradeFloor=300` 在低液体能量下是否**永远关不上**）就登记过；`#54` 本体后来被推翻并结案，但**问题③从未被回答**。本轮给的是执行答案：`pressure` 整窗 ≤0.179 ⇒ "关不上"为真，而现场靠 recovery 豁免从**另一条**出口走了出来（代价见上）。

- **#135 失守之后有三处陈旧态没人摘（W38S58 于 83,444,422 归零失守当轮现读）——其中一处直接把我的判据链地基拆了**
  · **①房内存条目仍在**：`Memory.rooms` 键列仍含 `W38S58`（`R179P3c` 现读 `mr` 与 observe 的 `领土` 行两通道一致），且里面的 **3 条 `spawnQueue` 请求 TTL 还在逐拍倒数**（采样器两发：`83,444,504` 读到 `hauler:W38S58:0/…/589r`、`83,444,552` 读到 `…/541r` ⇒ 差 48 拍对 48 秒，**1/拍 精确倒数**）⇒ 一个我再也拿不到的房，队列还在被时间推进。**危害有界**（不孵人、不耗 CPU），但它是 #86 那一族"只在 Intel 刷新时重建的表"的又一实例：**失守不是 Intel 刷新事件**，所以没人摘。
  · **②扩张计划表同一房两行**：observe 的 `扩张Plan` 同时出现 `W38S58=CANCELLED` 与 `W38S58=EVALUATED`（后者 `ready=0t`）⇒ 取消路径**追加**而不是**替换**条目；下一轮如果有人按 `Plans=5 active` 读数，会把已失守的房算进活动计划。
  · **③扩张状态对象被整枚抹掉（这条最贵）**：`Memory.kernel.expansion === undefined`（证据形状：探针在 `e.state` 处断成 `TypeError: Cannot read properties of undefined (reading 'state')`，而同一次读数里 `Memory.kernel` 其余 expansion* 键都在）⇒ `checkpointsPassed`、`startedAt`、CP1–CP3 的全部历史**没有落点**。observe 那行的 `state=? target=?` 就是它的表面。⇒ 后果不是难看，是**第三次扩张的端到端证据链在失守那一刻断了**（我从 10-04 起逐轮写的 CP 判据全部失去对象），而 #120/#122/#127/#132/#133/#134 六条债的"现场"也一起没了。
  · **要人拍的只有 ③ 那一种设计选择**：状态对象该"终态保留"（写入 `outcomeEvents`/`lostRooms` 后仍留 CP 历史）还是"清空即走"。我倾向**保留终态**（扩张是长期学习信号的唯一来源），但这属**改语义**不属改阈值 ⇒ 不自办。①② 我可以直接修（走既有清理链），但在批复前不动 `src/`。
  · **⚠️R182 改判：从"待清"升为"没人清"（三发逐字同值，不是等待问题而是设计缺口）**。`Memory.rooms.W38S58` 在失守后 **447 拍（R180P1@83,444,869）／1,362 拍（R181P1@83,445,784）／2,271 拍（R182P1b@83,446,693）** 三发都读到 **`25 个键 / 3 条 spawnQueue 请求 / colonyState=recovery`**，同窗 `失守待清=[W38S58]` 与 `expansionPlans` 的 W38S58 双行也一直挂着。⇒ 清理链**覆盖编制（`Memory.creeps`）与远矿（`remoteOps` 已 0 条）但不覆盖房内条目与扩张侧账本**；"再等一轮会自己好"已被三次否证 ⇒ 本条的正确定位是**设计选择题**（终态保留 vs 清空即走），不是待观察事件。
  · **已证的一好一坏**：好的一面——`失守待清` 通道存在且当轮就生效（`allowed` 翻 true、`Blocked` 从四道减到两道、`Memory.creeps` 的家记录被清）⇒ 失控不是黑洞；坏的一面——上面三处残留 ⇒ 清理链覆盖"编制"但没覆盖"扩张侧账本"。
  · **lineage**：#86（扩张队列/候选池的陈旧条目，已上线判效 PASS）与 #77（判为非缺陷）是同一族的先例；本条的**新增**是"失守这一事件不在任何重建触发器上"，以及 ③ 这种"状态对象整个消失"的形态。

  · **★R180 就地补（清理链跑到哪一层，失守后 447~469 拍现读）**：**跑到的**＝`Memory.kernel.lostRooms={"W38S58":83444422}`（**系统自己把失守拍写进了 Memory ⇒ 与我的同轮采样器独立同值，F4 从此有两发出处**）、`Memory.rooms.W38S58.remoteOps` 已 **0 条**、`Memory.creeps` 里该房的家记录已清。**没跑到的**＝`Memory.rooms.W38S58` 仍有 **25 个键**且里面 **3 条陈旧请求还在**（`upgrader:W38S58`／`hauler:W38S58:0`／`hauler:W38S58:1`）、`expansionPlans` 仍 6 行含 W38S58、`失守待清` 那一列本身还挂着它 ⇒ ①② 未自解（本条不是"等等就好"）。⚠️**读法纠正（我第一轮在这里读出过空串）**：plan 对象的字段是缩写表 `pid,rn,sr,rs,pr,sc,tc,pb,roi,rk,rl,st,ca,ua,aa,rd,ex` ⇒ 状态列是 **`st`**，不是 `state`/`status`；按后者读会得到"6 行里没有 W38S58"的假阴性。

  · **R196 交叉引用（规模以并行轨的账为准，并且他们那条还带着一句要紧的限定）**：他们 R374–R376 把"失守房没人清"量化成资产账——实际控制 2 房却有 **74/345＝21.4% 的我方建筑躺在 3 个不属于自己的房**（W37S55 69 枚且**不在 Memory**／W38S58 2 枚且**在 Memory＝幻影房**／W38S59 3 枚 extension，正是 `expansion-manager.ts:47-50` 注释点名的"事故"现场），逐类闭合（178+93+69+2+3=345；extension 60+30+50+3=143；spawn 3+1+2+1+0=7）。⚠️他们同时记到**自有工业同样零产出 ⇒ 搁浅的那 74 枚是"冗余"而不是"被浪费的产能"** ⇒ 清算的价值主要在**账本与 CPU 固定项**（房数/结构数驱动那 ≈6.7/t），不在收回产出。⇒ 本案原表述"W38S58 在 Memory 侧十七发逐字未变"仍成立，但**只是这笔账的一角**：清算的设计选择（要不要写清算器、由谁摘）请按 **3 房 74 枚**的量级拍，不要按 1 房 2 枚拍。
- **#136 G6 现在卡在"账本滞后"而不是"资源不足"：CPU 判档读的是一个 ≈13,092 拍的滚动均值，结构性减载要 ≈10~12 小时才反映；而按现值算，"关远矿线"那条属人选项也不够解 G6**
  · **⚠️R181 就地更正本条的两处核心说法（我上一轮把机制说错了，先撤在这里，下一轮别照旧版读）**：
    · **`windowTicks` 不是窗长，是进程寿命**——写入点 `telemetry-collector.ts:467` 是 `computeCpuRate(cum, Game.time − g.processBootTick)`：分母＝`Game.time − 进程 boot`、分子＝自 boot 的**累加量** ⇒ **旧样本永不退出，不存在"窗口滚完"那一刻**（露馅处：两读之间 `windowTicks` 13,092→13,892 恰好等于拍数增量）。⇒ 本条原文"结构性减载要等 ≈10~12 小时窗口滚完才反映"**作废**，正确说法是"等不到，除非部署一次重置 boot"。
    · **⚠️R182 再更正本条：我写"按现漂移要 ≈9 万拍到 tight"这个方向也错了——漂移已经反号**。第三发 `R182P1b@83,446,693` 读到 `total=16.34 / windowTicks=14,792 / sampledTicks=14,792`（⇒ **没有重启**，`sampledTicks===windowTicks` 仍成立），与前两发做同样的差分：`r₂=(16.34×14,792 − 16.33×13,892)/900 ≈ **16.48/t**`（舍入误差 ±0.16 ⇒ 与 r₁ 的 0.65 差**不是舍入**）。⇒ 两发差分互相否证了"当前水平 ≈15.9"这个**单值**说法：正确说法是**边际负载在 15.8~16.5 之间漂**，而**方向朝上**（total 16.33→16.34 在升，边际 16.48 > 均值 16.34）。⇒ 本条结论**加强而不是削弱**：`tight` 线(<16.0) 不但要等很久，**现在连方向都不朝它去**；"≈9 万拍到 tight"作为预报**作废**（它建立在"会单调下漂"的假设上）。⇒ 留一个可复采的最小判据：**只要 `total` 在升，就不要再提"等窗口稀释"**，也**不要**把 G6 的解法写成时间问题——它是结构问题（要 ≤12.0/t）。
    · **R182 附带现场：两把尺的分裂已经在花 CPU，但按量级不值得为它统一口径**（别把本条读成"要先修口径不一致"）。门的两侧各有读者：`prospect-manager.ts:39-40` 要 `strategy.expansionAllowed===true` **且 `ctx.budget.tier ∈ {healthy,guarded}`**（调度器那把尺，现读 `healthy`），而 G6 走 `readiness.ts:209-212` 读 `capacity.tier`（现读 `constrained`）⇒ 现场后果可见：环里 `ProspectOutcome` 由 2 涨到 **5**、候选池 `11→12(Q=3,R=7,U=2)` ⇒ **系统一边以"CPU 不够"拒绝扩张，一边以"CPU 健康"花钱找下一间房**。⚠️但侦察的支出在 `cpuRate.byRole` 前十里根本排不进（第十名 dismantler 只有 0.05）⇒ **<0.05/t ≈ 全负载 0.3%** ⇒ 结案：**不值得为逻辑一致性去动侦察的闸**；要动只动 G6 的输入（本条上面那些出口）。
    · **R184 给上一段加限定（拒活是尖峰不是稳态）**：同一支 `*/budget` 仪器在 R183 读到四 system 各 43→100、`reserver=170`，而 **900 拍后复读＝全零** ⇒ 上一段"`canStart` 正在按拍拒活"成立，但**不能用一个窗给 CPU 定性**（要判紧不紧至少需要连续多窗计数，且 `avg10` 那支出偏高）。同时 R183 的"两把尺分裂＝一边花钱侦察一边拒扩张"**可见性有条件**：`prospect-manager.ts:39-40` 的第一道门是 `strategy.expansionAllowed===true`，所以 **war 期间侦察与扩张一起停**（`ProspectOutcome 5→1`），分裂只在"posture 允许、前馈档仍 constrained"那段（＝fortify 期）才看得见。⇒ 本条对决策的净结论不变：**G6 要 `≤12.0/t` 而实测稳在 15.8~16.5**，出口是结构性的（三选一），不是换一把更乐观的尺。
    · **⚠️R183 把本条"资源真实值 vs 档位"那段打折**：**别用 `bucket`/`tickLimit` 论证"CPU 够"**。现场 `skipReasons` 全量读到 `*/budget` 大面积拒活（`reserver=170／upgrader=88／builder=88／scout=44`，四个 system 各 **43**：`construction-manager／tactical-runtime-pipeline／layout-planner／room-observer`；230 拍后复读 **100/100/100/100**）⇒ `bucket=10,000 满格／tickLimit=500` 只说明**可借用**，而 `canStart` 正在按拍否决**扩张本来就需要的那些 system**。且 `avg10 17.2→12.7`（这支出偏高，见 telemetry 注释）与拒活上升同时发生 ⇒ 是**上限收紧**不是负载下降。⇒ 本条"要人拍的"里那句"引擎侧证据是余量充足"要换成"引擎侧证据只是可借用额度与调度器档位 healthy，而每拍预算已在拒活"。
    · **真实水平已经能反推出来**（前提两次读数都满足 `sampledTicks===windowTicks` ⇒ 分子唯一变化就是新增拍）：`r=(16.33×13,892 − 16.36×13,092)/800 ≈ **15.9/t**`（总量只存 2 位小数 ⇒ ±0.2）。⇒ **渐近线 15.9 > comfortable 线 12.0 ⇒ G6 在本进程存活期内按构造解不开**；连 `tight`(<16.0) 也要把累积均值稀释下去，按现漂移速率（−0.03/806 拍）≈ **9 万拍 ≈ 3~4 天**。本条"要人拍的"三出口仍然成立，但**"等"不再是其中任何一个**——部署重置虽然让均值立刻≈15.9，那也只是 `constrained→tight`，**G6 依旧不解**（这条要写进给决策者的话里，免得有人以为推一次码就把闸打开了）。
    · **闸读的口径与引擎的真实余量相反，且 `bucket` 是死输入**：`bucket` 在 `CapacityInput`（`capacity.ts:10`）里**声明了但函数体一次都没读** ⇒ 即时余量对档位毫无影响；现场同一拍 `Memory.kernel.tier="healthy"`（调度器口径，`since=83,272,831` ⇒ **17.3 万拍没变过**）与 `Memory.kernel.capacity.tier="constrained"`（规模前馈口径）**同时为真**，而 G6 读后者（`readiness.ts:209-212`）。⇒ 措辞要准：不是"资源够了闸错"，而是**两个口径回答两个问题**——按经验值加一间成熟幼房 ≈+2/t（W38S56 现读每房 2.07/t）⇒ 15.9→17.9 ⇒ 仍在 `limit=20` 之下、bucket 满格 ⇒ **引擎说养得起，前馈口径说不够**；真正该人拍的是"扩张的 CPU 判据要用哪把尺"。
  · **判据逐行读过了（`domain/strategy/capacity.ts:101-113` ＋ `config/index.ts:1268-1274`）**：`limit = min(cpuLimit, tickLimit) = min(20,500) = 20`、`usage = cpuRate.total = **16.36**`、`headroom = 1 − 16.36/20 = **18.2%**`，分档 abundant≥65%／comfortable≥40%／tight≥20%／constrained<20% ⇒ **差 0.36/t（limit 的 1.8%）就整档卡在 constrained**；现场 `Memory.kernel.capacity={"tier":"constrained","since":83,425,106,"upgradeTicks":0}` ⇒ 已 **19,872 拍没动**。
  · **我原本怀疑的两种"仪器坏掉"都被当场否证**（这点很重要，否则会把修法指向错处）：`pickCpuUsagePerTick`（`:51-56`）的可信通道**没有被否决**——现读 `windowTicks=13,092 ≥ 100` 且 `unsampledTicks=0` ⇒ 判档用的就是差分速率，**不是**那个偏高的 `avg10=18.7`／`max10=21.3`；也不是"连续 300 拍滞回被噪声反复清零"（输入是慢均值，不逐拍抖）。⇒ 剩下的唯一解释就是**窗口长度**：万拍级均值 ⇒ 少一间房这种结构性变化要 ≈13,092 拍（按拍长 2.66~3.4 s ⇒ **9.7~12.4 小时**）才进得了表。
  · **引擎侧的反差证据**：同拍 `Game.cpu = limit 20 / tickLimit **500** / bucket **10,000（满格）**` ⇒ 可突发到 500、且预算长期用不完，而档位模型只按 `min(limit,tickLimit)=20` 的利用率判生死。⇒ **"CPU 够不够"与"档位健不健康"是两个问题**，本条只主张前者被后者掩住了。
  · **给属人决策 A（关远矿线）补真实差口——这次差得比当年估的多**：G6 翻绿需 `tier ≤ comfortable` ⇒ `usage ≤ 12.0/t` ⇒ 从 16.36 要省 **≈4.36/t**；远矿三项 `remoteHarvester 1.44 + remoteHauler 0.75 + reserver 0.43 ≈ 2.62/t` ⇒ **关掉也不够，仍差 ≈1.7/t**（其余大头 `traffic-manager 3.4`、`snapshots 1.61` 此前已判结构性、不立案；`byPhase.creeps 7.26` 是编制本身）。⚠️三条边界一起写：①该 total 覆盖的是**含 W38S58 的窗口**，两房格局的真实均值本轮还没被量到；②表里 `unexplained 1.48 / unphased 1.03 / tail 0.48` ⇒ 分解有余量；③"要省 4.36/t"是按现值算的，不是按新均值算的。
  · **可复采预报（不造条件、不新建表）**：接下来几轮读 `cpuRate.total` 与 `windowTicks`——若 total 随窗口滚过而落到 **<16.0 ⇒ tier 应先翻 tight**；落到 **≤12.0 ⇒ 翻 comfortable ⇒ G6 解**。预报时刻＝失守（83,444,422）后窗口滚完 ≈13k 拍 ≈ **10~12 小时后（≈当日 22:0xZ~24:0xZ）**。⚠️如果 total 早就掉到 16.0 以下而 tier 仍不动 ⇒ 那才是滞回/复位那一支活着，回来改本条。
  · **要人拍的**：①把判档输入从"万拍均值"换成**更短窗或双窗口**（属改阈值语义，不自办）；②或者接受"结构性事件有 ≈半天滞后"并把它写进扩张节奏的期望里。**我不动 `src/`、不动任何 ratio。**

- **#137 "低邻居压力"基线把 `warPatience` 按退出语义改成 3000，而它唯一的用法是进入语义 ⇒ 越安全的区越容易升级到 war，而 war 硬性关闭扩张：现场一次 5 拍的入侵换来 ≈5,000 拍（≈3.5~4.5 小时）扩张停摆**
  · **⚠️R185 加重：恐吓从"一次 ≈5,000 拍的税"变成"可续期的锁"——这条改变本条的量级定性，也改变要人拍的理由**。退出条件是 `threatRecent=false`，而 `threatRecent` 的定义是"**任一自有房** `tick − lastHostileAt < 生效 threatWindow`"（`posture.ts:117-119`，低压力区生效值 **5,000**，不是 CONFIG 的 3,000）⇒ **只要每 <5,000 拍被骚扰一次，war/fortify 就能无限续期，扩张可以无限期停摆**。实测第一次续期：第一次进犯 `83,444,623`、第二次 `83,448,781`（间隔 **4,158 拍 < 5,000**）⇒ 我 R184 预写的退出点 83,449,623 被覆盖为 **83,453,781**（第二次 hostileAt + 5,000；dwell 条件早已满足）。⇒ 所以"一次 5 拍入侵换 5,000 拍停摆"要改写成"**每 4,158 拍一次入侵 = 永久停摆**"，并且**敌意来源至今不可见**（`situation.adversaries={}` 全程，第二次进犯环里 `EnemyInvasion/TowerVolley19/EnemyCleared` 齐全）。⇒ 排产时请把它当"扩张主线的常态风险"而不是"偶发税"看；三个出口不变（见下"要人拍的"）。
  · **现场（同轮跨过期点取证）**：`lastHostileAt(W38S56)=83,444,623` ⇒ 该拍起 `fortify`；到 **83,447,623**（dwell 恰 3,000）姿态**升级为 `war`** 且 `expansionAllowed` 当场 **false**（`R183P1@83,447,618` 还是 `fortify|since 83,444,623|elapsed 2,995|true`，`R183P2@83,447,687` 已是 `war|since 83,447,623|64|false`）⇒ G0 复红。**不是回落 develop，也不是"过期仍 fortify"**——我预写的两支都不对，真值是第三支。
  · **机制（读码闭合，`posture-baseline.ts:44-47` × `posture.ts:110-215`）**：`env.neighborPressure="low"` ⇒ 覆盖 `threatWindow=5000`（威胁记忆**拉长**）＋ `warPatience=3000`（战争耐心**缩短**），注释的理由是"空旷安全区……不值得长期战争"＝**退出**语义。但 `warPatience` 在代码里只出现在一处判断：`posture.ts:185` `prevPosture==="fortify" && dwellElapsed >= warPatience` ⇒ **进入 war 的耐心**；真正的退出参数是另一个字段 `warExitPatienceTicks=1000`（`:175`）。⇒ 两个覆盖同向叠加：威胁被记得更久、升级更快 ⇒ **安全区比交战区更容易进 war**（`high` 区是 `threatWindow=1500/warPatience=7000`，完全相反）。
  · **算术自证（也是我的读法教训）**：若按 CONFIG 默认 `threatWindow=3000 / warPatience=5000`，这次升级**不可能发生**——进入分支要求 `dwellElapsed≥5000` 而 threatRecent 要求 `elapsed<3000`，两条件互斥。我一开始正是拿默认值算的，差点把成因记成"读不到"。⇒ 结论：**参数在被环境基线覆盖后，"配置默认值"不再是可以推理的常数**（同族教训：阈值/常量也算读数，必须现读生效值）。
  · **代价的量级（不是"有点浪费"而是"关掉的就是主线"）**：`finalize` 注释写明"war 姿态仍硬性关闭扩张（战争是主动冲突，不应同时殖民）"⇒ 本轮起 ≈5,000 拍扩张停摆；预计 **≈83,449,62x 之后**（threatRecent 于 83,449,623 过期，再过 `minDwell=1000`）才回 `develop`。而 `situation.adversaries={}`、`conditions=[]`、`neighborPressure="low"` ⇒ **没有任何"仍在被打"的证据支撑这次升级**。
  · **要人拍的（三条都动安全/姿态参数，我一条都不自办）**：①把"进入耐心"与"退出耐心"拆成两个字段（`warEnterPatience`／`warExitPatience`），低压力区只缩短后者；②或把 `low` 基线里的 `warPatience` 恢复为 ≥ `threatWindow`（按算术，这样"安全区升级 war"就不可能由过期威胁触发）；③或让 `war` 不硬性关扩张（改成"有活威胁才关"，与 `liveThreat` 对齐）。⚠️另外 `bounds.ts:146` 把 `posture.warPatience` 暴露给调优器 ⇒ **一次调参就会永久生效**（override 无到期字段，见既有 #89 那条单向棘轮）⇒ 这条债与 L1 自进化耦合，排产时请一起看。
  · **可复采判据（免费，不造条件）**：预计 R184（≈16:1xZ，t≈83,448,7xx）仍在 `war`；**≈83,449,62x 之后**应回 `develop` 且 `expansionAllowed` 复 true ⇒ 若那时还 `war`，说明退出侧另有闸（回来读本条②的 `warExitPatienceTicks` 与 `liveThreat` 分支）；同时把 `fg` 的**完整集合**现读一次（本轮我只读到前 60 字符）。
  · **lineage／同族**：用户级记忆里已有一条"『X 通过路径 Y 影响 Z』要先读完 X 的全部调用点并核方向（我把 warPatience 的升级/退出两侧读反过）"——**这次不是我读反，是参数本身被两处相反语义共用**，教训升级为代码级事实。

  · **✅R190 结案案发到手，而我预写的退出点被现场否证（早 2,001 拍）**：war 于 **83,453,360** 结束（`strategy={posture:"fortify",since:83,453,360,expansionAllowed:true,warPressureTicks:0}`），总账 **5,737 拍**硬性关着扩张，而代价来源是三次合计 ≈15 拍的实战。⇒ **机制不是「threatWindow 到期」**（那要等到 83,455,361），而是 `posture.ts:161-163` 的**经济危机早退** `prevPosture==="war" && anyRecovery && !liveThreat`：幼房 `hc 2→1`（`econ-ring@83,453,355` 现读 `ea=500/1800`、`d=−1310`、`p=0`）引起 ≈7 拍 `bootstrap`（环内 `ColonyStateChange W38S56 [2,0]@83,453,365`；回 normal 的真值取 `Memory.rooms.W38S56.colonyStateSince=83,453,367`，而该事件打印在 83,453,375 ⇒ **遥测比 Memory 慢 ≈8 拍**）⇒ 当场把 war 撤资降级。**压力撤资支（B）由两条独立证据排除**：`empire-strategy` 是 `interval:1`（计数器每拍 +1）而退出前 **255 拍**（`R189P1@83,453,105`）现读 `warPressureTicks=0` ⇒ 不可能累到 1000；且 `p=` 列整段恒 0（阈要 `avgPressure>0.4`）。**develop 支（C）与现读 `fortify` 不符 ⇒ 排除**。⇒ 精度残留：bootstrap 起点只夹在 (83,453,355, 83,453,365]，与判定拍 360 的先后分不开 ⇒ 结论写成「唯一存活解释」，**不写成「钉死到拍」**。
  · **由此改写本案的形状（给拍 D 案的人）**：(a) 我补48/补49 写的「进犯节奏快于 5,000 拍 ⇒ 停摆无期」**上界不成立** ⇒ 正确说法是「**没有 threatWindow 上界，但有经济危机上界**」（幼房任何一次采集链抖动都会提前解闸，本轮 7 拍就解了）；(b) **同一个 `anyRecovery` 也挡住进入 war**（`posture.ts:183-188` 要求 `!anyRecovery`）⇒ 危机态既是刹车也是解锁，改参数前必须两列一起读；(c) D 案的反向实验现在才可写：改前「幼房一次 bootstrap ⇒ war 当场降级」必然复现、改后不应复现，**控制组＝`liveThreat=true` 时两版都不降**。⇒ 新立 **#140**（姿态转换不落分支盘 ⇒ 这类判别每次都要现场考古）。
  · **🔁R191 第四次进犯到场，但它落在 fortify 期 ⇒ 没升进 war、也没建计划（⇒ #138 复验没跟着到场）**：`EnemyInvasion W38S56@83,454,205`＋`TowerVolley` 17 发（198~214）＋`EnemyCleared@83,454,215`＝实战 **17 拍**、**第三次也是纯塔处理**；`kernel.warPlan` peek 现读＝**键不存在**、环内 `WarOutcome=0 条`。⇒ 本案的"可续期"比 R187 的说法**多一道闸门**：升 war 要 `fortify` 的 **dwell ≥ warPatience(3,000)**（`posture.ts:183-188`，还要 `threatRecent && avgPressure ≤ 0.4 && !anyRecovery`），而 fortify 的 `since=83,453,360` ⇒ **升 war 的最早那一拍＝83,456,360**；`threatRecent` 由 `lastHostileAt=83,454,198 ＋ threatWindow(5,000)` 撑到 83,459,198 ⇒ 两者重叠。
  · **★可否证预报（写在进犯之后、读在下一轮，R192 大概率正站在门前几十拍）**：**war 将于 ≈83,456,360 复发**（`posture→war`＋`expansionAllowed=false`＋G0 复红），条件三件到那一刻仍成立（threatRecent／`avgPressure≤0.4`／无 recovery-bootstrap）。两支都有意义：**(甲) 复发且随后出现 DEFEND 计划** ⇒ #138 的复验链第一次在"无新进犯、纯靠威胁记忆"的条件下到场（只读 `warPlan.spawned` 与 `WarOutcome` 第三列，预期 **0 与 4**）；**(乙) 那一刻因幼房正在 bootstrap/defense 而没复发** ⇒ "经济危机既解 war 也推后 war 复发"拿到第二个样本 ⇒ 同一根杆（幼房采集链抖动）在 R191 已实测两次摁红 G0：有活敌 **17 拍**＋bootstrap **27 拍**（`expandHealth` 含 `allNormal` 与 `sponsorReady.!hasLiveThreat`，`posture.ts:150-157`）。⚠️判"未到"前先把拍算准（本轮末 t≈83,455,05x、拍长实测 ≈3.8 s）。
  · **停摆的代价第一次有了落点（不是洁癖）**：头号候选 **`W37S56` 的计划从 `WAITING_EXECUTION`（R189）变成 `CANCELLED`（R190/R191 连续两轮）** ⇒ 这 ≈5,700 拍的 G0 停摆不只是"没往前"，而是**把已经在排的执行计划摘掉了一次**；同窗 observe 的 `ready=` 列从 139,581t 涨到 141,411t（Δ≈1,900 拍涨 1,830 ⇒ **≈1/拍在涨、不是倒数**）——但该列是**工具侧字符串、语义我不掌握** ⇒ 只记形状不下结论（同族旧账 #86/#77）。侦察侧确实恢复了：`ProspectOutcome` 9 发＋`Candidates 12（Q 2→5、U 3→0）`。
  · **R192 预报进度（点未到、前置全读到）**：★点 **83,456,360** 本轮未至（末 t≈83,455,909、差 ≈450 拍、拍长 2.85 s ⇒ R193 必在点之后），但**三个前置本轮逐条现读**：fortify `since=83,453,360` 未变、两房 `pressure=0`（≤0.4 ✓）、两房 `colonyState=normal`（幼房 bootstrap 已于 83,454,935 结束 ✓）；`threatRecent` 被**第五次进犯**（`EnemyInvasion W37S58@83,455,375`、塔 5 发、`EnemyCleared@83,455,385`＝实战 14 拍）续期到 **83,460,371**。⇒ 判据不变，且**加了一条更便宜的签名**：复发那一拍之后 `power-farm-manager` 会把在世 PB 任务以 code 3 清空 ⇒ **`kernel.powerFarmMissions` 由现读长度 1（spawned=6）应变 0**，与 `posture` 互为独立交叉验证。`lastHostileAt` 五连＝83,444,623 → 83,448,781 → 83,450,361 → 83,454,198 → 83,455,371（间隔 4,158／1,580／3,837／1,173）。
  · **本案的完整价格（给人拍 D 案时用，不是洁癖）**：war 期间不只 G0 硬性关扩张，`power-farm-manager.ts:34-40` 还会把**已在世的 PB 野采任务全部以 code 3（war-preempt）收摊并拒绝开工**——而 PB  empirically 是唯一真出过兵、正在交战的那条军事车道（R192 现读 `spawned=6 / phase="strike"`）。⇒ 可核等价说法：**"进入 war"＝同时关掉扩张与唯一有效的出兵通道**，而它靠 `!anyRecovery` 这类经济信号在 ≈5,700 拍后自己解开（#137 已结案那支）。
  · **✅★预报兑现（10-06 R193）＝本案的"复发"这一半也结案**：`posture="war"、since=**83,456,360**`＝fortify `since 83,453,360 ＋ warPatience 3,000`，与 补52③ 预写同一拍（本会话第一次"先写后读"命中；并行 R3xx 轨的 R358 独立读到同一件事 ⇒ 两把独立读数交叉确证）。**双罚第一手证据**：复发后 **66 拍** `powerFarmMissions` 由长度 1（spawned=6）被清成 **0**，环内 `83,456,426 PowerFarmOutcome d=[3,6]`＝reason 3 war-preempt（code 表原文在 `event-log.ts:115-117`：`0=done／1=attrition／2=timeout／3=war-preempt`，开任务记 4）⇒ **进入 war 同时关掉扩张与唯一真出兵的车道**，这条现在该写进 D 案的价格表。⚠️本案仍**未结案的部分**：退出侧只有 R190 那一支（经济危机早退）的实样；若这次仍靠同一支解闸＝第二个样本，若靠 `warExitPatienceTicks` 支解闸＝**第一次实测**（那一支至今零现场样本）。
  · **✅R195 退出侧第二样本到手＝甲支（经济危机早退）2/2，同时留下一条可否证推断**：本场 war 活了 **1,691 拍**（83,456,360→83,458,051）就被核心房一次 ≈100 拍的 `recovery`（触发者是**孵化潮抽干 `ea` 12,900→707**）撤资降级，落 `fortify`＋`expansionAllowed=true`。三支处置：丙（threatWindow 到期→develop）要求 `!threatRecent`，在 83,458,051 按构造不可能（要到 83,460,371）；乙（`warPressureTicks≥1,000`）被"386 拍前读到 0"算术排除；甲与降级**同拍**（危机起点按实测遥测滞后 4 拍反推＝83,458,051，加 `empire-strategy.ts:47` 的 P0→P1 同拍顺序）⇒ **比 R190 那发干净，没有 ±5 拍模糊**。⇒ **推断（待验，不是结论）：乙支与丙支至今各 0 样本，可能都是死路径**——war 期间帝国总会做大额能量承诺，甲支就总会抢在前面；翻案条件＝某场 war 活到 threatWindow 过期，或 `warPressureTicks` 真爬到 ≥1,000。⇒ 给 D 案的措辞改成：**"退出"名义上有三条，实测只有一条在跑**，改参数前先决定那两条要不要留。
- **#138 战争计划两次都要 9~10 人编队、`spawned` 都是 0、队列里也没有军事角色请求 ⇒ "计划→编队"这一步在线上从未走通；同时 `#137` 的"可续期锁"拿到第二个样本（停摆事实上无期）**
  · **两个样本（名字级、同拍配对）**：①`R185P4@83,449,469` → `warPlan={targetRoom:W38S56, since:83,448,784, squadSize:**10**, spawned:**0**}`，活到 1,517 拍后被撤（`83,450,301/302 WarOutcome d=[2,0,4] / [-1,0,1]`，列序按 `recovery-execution-system.ts:1327-1331`＝`[-1(Recovery triggered), signal.spawned, actions.length]` ⇒ **撤的时候 spawned 仍是 0**）；②`R187P2@83,451,266` → `warPlan={targetRoom:W37S58, sponsor:W37S58, phase:"advance", spawned:**0**, squadSize:**9**, operationType:"DEFEND", warPosture:"DEFENSIVE", since:83,450,364, age:902 拍}`，同拍核心房 `spawnQueue`＝**EMPTY**、军事角色普查＝**{}**。⇒ 两发相隔一个计划周期、形状一致 ⇒ **不是"某次没排上"，而是这一步整体不通**。
  · **成因未判（两条候选，我不猜）**：**(i) 提交方没跑**——兵由 `war-planner.ts:189/200 → submitSquadRequest` 投，而 `system/war-planner/budget` 确实出现在 R183 的 CPU 预算拒活名单里；**(ii) 跑了但条件不满足**——`phase:"advance"`／`a5ForceReq`／`frozenRoles` 之类的前置没放行（现场队列里连军事键都没有 ⇒ 更像 (ii) 或"计划与排产之间缺一根线"）。⇒ **判别式已备好，最省事的一种**：读 `globalThis.systemLastRun["war-planner"]` 与 `Game.time` 的差（⚠️它是 `Record<string,number>` 不是 Map，必须用括号取值，`kernel.ts:510`）——差得远＝(i) 没跑/被挡；差≈0 而军事键仍不进队列＝(ii)。
  · **✅R188 成因判到底（(i) 被当场否证，(ii) 成立且是"判据用错主体"）**：判别式第一支先死——`globalThis.systemLastRun` 现读 `war-planner 距 8 拍／war-planning 距 5 拍／tactical-runtime-pipeline 距 0 拍／defense-planner 距 0 拍` ⇒ **规划器活着、没被 CPU 闸饿死**。第二支成立且能闭合到代码：①`war-planner.ts:135` 的 `evidenceFresh = intelActionUsable(plan.targetRoom, tick, CONFIG.war.targetFreshness)`，而 `:186-205` **两个 `submitSquadRequest` 都包在 `if (evidenceFresh && …)` 里**（注释原文"断供期间停补员……'承诺不越过证据'的即时那一半"）；②`intelligence.ts:132` 的 `intelActionUsable` 读 heap `roomEntries`（`:34`），该 Map **唯一写者**是 `adoptHandoff()`（`:54-60`）吃 `globalCache().intelHandoff`，而 handoff 由 **room-observer** 写、其目标只有 `exits`＝**邻居房**（`room-observer.ts:138-158`）⇒ **自有房没有任何入图路径**；③现场两个 DEFEND 计划的 `targetRoom` 都是自有房（`W38S56`／`W37S58`）⇒ `evidenceFresh` **按构造恒假** ⇒ 一员不投（`spawned=0`），并在 `planIntelBlackoutTicks=1500`（`config/index.ts:716`）后以 `REASON_INTEL_STALE=4`（`war-planner.ts:42`）撤销 —— **两发的 `WarOutcome` 第三列都是 4、第二列都是 0**（列序 `:458-462`＝`[OUTCOME_CODES[outcome], plan.spawned, reason]`），寿命都是 **1,517 拍**。⇒ **同时更正 R186 的说法**：不是"被 recovery 止损撤掉"，recovery 只是信号消费者（`[-1,0,1]` 那条），**起因是"情报断供"，而此处"断供"是恒真**——因为查的是要防御的那间自住房的情报。缺陷类别＝**拿"只对可侦察邻房成立的证据通道"去评"自家房"**。
  · **修法候选（三条都动军事授权语义＝领域平衡 ⇒ 请示，不自办）**：①`operationType==="DEFEND"` 的计划**不走** `evidenceFresh` 门（自住房每拍都在视野里，防御不需要侦察证据）；②让 `evidenceFresh` 对自有房返回 true（等价但更含糊）；③把自有房纳入 intel 图（代价大、语义脏，最不推荐）。**改码时的反向实验**：造一个 `targetRoom=自住房` 的计划 ⇒ 改前断言 `submitSquadRequest` 从未被调用（`spawned` 恒 0、队列无 attacker/healer 键），改后断言被调用且 `countPending(queue,"attacker",home)` 从 0 变 1；**控制组**＝非 DEFEND 的一支必须保持原行为（不变绿即说明门被改宽了不该宽的地方）。
  · **为什么这条要紧（不是洁癖）**：现在挡在长期目标"战争模块参与"前面的不是策略好坏，而是**兵力从未上过场**——三次进犯全部只由塔处理（`TowerVolley` 5/6/19 发，三次 `EnemyCleared`），而 `#137` 让扩张在整个战争期内硬性关着。**帝国正在为一条从未生效的军事通道支付扩张成本**。⚠️同时这**不是**"该把 war 关掉止损"的论据：撤军/止损链（`warAbortSignals` → recovery 消费）工作正常，坏的是编队那一环。
  · **要人拍的**：判明 (i)/(ii) 之后才谈修法（补投、放行节拍、或明确"防御型计划本就不该养编队"并把它写进文档）。⇒ 若判成"要跑更多节拍"则与 **G6/CPU 预算**直接冲突（本号与 #136 是同一根杆）⇒ **不许靠降阈值解决**，摆数请示。
  · **#137 的第二个续期样本（写在这里因为它是同一场战争账）**：`lastHostileAt` 序列 **83,444,623 → 83,448,781（间隔 4,158）→ 83,450,361（间隔 1,580）**，两次都 < 生效 `threatWindow` 5,000 ⇒ 退出点被顺延两次（83,449,623 → 83,453,781 → **83,455,361**），`posture.since=83,447,623` 起扩张已连续关着 **3,633 拍**（截至 `R187P1@83,451,256`）。⇒ 正确说法从"一次 ≈5,000 拍的税"改成"**只要进犯节奏快于 5,000 拍，停摆就无期**"，而进犯节奏看起来就是这个量级（1,580~4,158 拍）。
  · **lineage**：与 `#137`（war 升级税／可续期锁）、`#136`（G6 判档输入）、`#122/#126`（幼房 builder ×0）同族——都是"某一层没把需求送到下一层"。与 `#62` 的红线配套：**单样本不定严重度**，本条是攒到两个样本才立号。
  · **R191 更正"复验到场"的条件（我补50⑥ 写得太松）**：第四次进犯（`W38S56@83,454,198~215`）**没有**产生 DEFEND 计划（`kernel.warPlan` 键不存在、环内 `WarOutcome=0 条`）⇒ 不是链坏了，而是 **`war-planner.ts:62` 在 `posture!=="war"` 时直接 `demobilize(REASON_POSTURE); return`，非 war 期根本不选目标**。⇒ 本案的复验前置＝**"war 期内的 DEFEND 计划"**，需要 war 先复发（最早 ≈83,456,360，见 #137 的 ★预报两支），不是"任意一次进犯"。⚠️这同时把②那条链的"从未上线"范围收窄了一半：**编队层在 war 期外连"该不该投"都没被问过**。
  · **★R192 本案拿到对照组 ⇒ 从"读码链"升级为"带对照的读码链"**：同一对角色（attacker/healer）、同一套 spawn 机器，走 **PB 野采车道**（`power-farm-manager.ts:196-240 submitFarmRequest`，`priority:2`，闸＝`attackerLive + pendingAttackers < CONFIG.powerFarm.squadSize`，**完全不查 `intelActionUsable`**）⇒ **真孵出、真在交战**：`powerFarmMissions={targetRoom:W40S54,sponsor:W38S56,since:83,455,226,spawned:6,phase:"strike"}`＋在世六只逐只按 name 锚定（`attacker-W38S56-0..3@83,455,227/296/329/377`、`healer-W38S56-0..1@83,455,751/814`，全带 `mission:"powerBank"`）；而走 warPlan 车道（`submitSquadRequest` 包在 `if (evidenceFresh && …)`，`evidenceFresh` 用只收邻居房的侦察图去评**自住房**）⇒ 两次 `spawned=0`。⇒ 结论收窄到最硬的一句：**编队能力没坏、spawn 侧没坏、角色定义没坏，坏的只是那道用错主体的证据门**。⚠️同时本案严重度上调一档：问题不是"军事线整体没跑"，而是"**唯一真能出兵的车道被 war 自己关掉（`power-farm-manager.ts:34-40` 的 code 3 war-preempt），而 war 自己的车道出不了兵**"。
- **#139 `RecoveryEscalation` 事件与日志的第三列取的是「0 号条目」的 `repeats`，不是被升级那条的（10-05 R189 由一次天然实验定罪）**
  · **一发就够（R189③）**：`83,453,052 RecoveryEscalation r=global d=[3,1,17]` ⇒ 前两列对得上 `global/mineral/terminal_trade` 那条记录（现读 `attempts=3、terminal=true、lastAt=83,453,052`＝与事件同拍 ⇒ 事件确实是它），但**该记录自己的 `repeats=27`**；那个 `17` 属于 `Memory.kernel.escalations[0]`＝`W38S58/colony/population_rebuild`＝**别的房、别的事件**的计数。
  · **机制（读码闭合，不靠推断）**：`upsertEscalation`（`recovery-lifecycle.ts:921-956`）对**已存在**条目是「原地更新、不移位」（`:930-942`），只有**首次**出现才 `unshift` 到 0 号位（`:945-955`）⇒ `list[0]` 的真实语义是「最近一次**首次**出现的升级」；而调用侧 `recovery-execution-system.ts:1105-1109` 与紧邻日志行 `:1113-1116` 都写 `esc.list[0]?.repeats` ⇒ **凡升级的不是 0 号条目，事件与日志的 repeats 列就是别人的数**（该列只在条目第一次出现那一次恰好为真）。
  · **影响面按量级压住（不夸大）**：`escalations` 在 `src/` 只有写侧（`:1095` 读 prev、`:1103` 落盘），`EventKind.RecoveryEscalation` 在 `src/` **零消费者** ⇒ 坏的是**取证台账**，不在任何决策路径上。修法＝一行（事件与日志改用被升级记录自身的 `repeats`）⇒ 属 `src/` 微修，但「一次部署＝清堆＋≈400 拍 G6 税」 ⇒ **随下一批 src 走、不单独推**。**反向实验（改码时必须配）**：造两条升级、让第二条不落在 0 号位 ⇒ 改前事件第三列必须等于**第一条**的 repeats、改后必须等于**第二条**的；控制组＝只有单条升级时两版输出逐字相同。
  · **自查（这条没污染我过去的结论）**：历史上我引这条事件都是拿 `Memory.kernel.escalations` 反查记录（锁 L5439／L6459 两发），**从未把第三列当成该记录自身的 repeats 引用** ⇒ 无需撤回旧读数；但**今后** `RecoveryEscalation` 只有前两列可信。

  · **🔧R192 状态更新：并行会话已把它修在 dev（未上线）**——commit `884cf525`「fix(recovery): #139 升级事件的第三列不再读 `escalations[0]`——repeats 由 `upsertEscalation` 随结果返回，调用方改读 `esc.repeats`」。修法落在**函数侧**（两个分支各自返回自己那条的 `repeats`），他们写的理由正好是本案的病根："清单身份判据是 `(room, domain, actionType)`，让调用方自己找回刚更新那条＝**重述一遍判据**"；带回归用例（`tests/unit/strategy/recovery-escalation-list.test.ts`＋27 行：建 A→建 B 抢队首→连升 A 三次 ⇒ `result.repeats=4` 而 `list[0].repeats=1`）＋反向实验（把来源改回 `list[0]` ⇒ **恰好 1 例转红 `expected 1 to be 4`**）。⇒ 我那句"零消费者／只坏取证不坏决策"被他们原样沿用（`38b49ba1` 撤的是他们自己 #110 的"escalations 零读者"，那个读者就是这处 emit 路径）。⚠️**未 push、未部署**：`git log origin/dev..HEAD`＝200 笔（含 src 8 笔），线上现读 `GET /api/user/code`＝`sha 649eb94b9784 / 787,752 B`。
  · **★零部署判效探针（预写给"下一批上线"那一轮，比看 sha 硬）**：`Memory.kernel.escalations` 现读队首＝`W38S58/population_rebuild repeats=17`、非队首＝`global/terminal_trade repeats=27`（心跳 2,000 拍已满足，只等该动作再失败一次即 emit）⇒ **下一条 `RecoveryEscalation r=global` 的第三列＝28+ 才算生效；仍打印 17 ＝二进制还是旧的**（同一枚硬币的两面：17 正是 R189 定罪时那发 `d=[3,1,17]` 的错值来源）。
- **#140 姿态转换不记「走了哪条分支」，导致每次 war 进/出都要现场考古（10-05 R190 实测：2 发 console＋1 发环＋5 处读码，仍留 ±5 拍精度）**
  · **事实**：`finalize`（`posture.ts:233-251`）只写 `posture/since/warPressureTicks/expansionAllowed/newRemoteOpsAllowed`，**没有「本次由哪个 return 触发」的列**；而 `war→fortify` 有三个语义完全不同的出口（经济危机早退／压力撤资／威胁消退→develop），#137 的结案恰好只能靠这三支判别来写。
  · **代价与修法**：本轮为排除后两支用了 console 2 发＋`econ-ring` 1 发＋读码 5 处，最后仍只能说「起点夹在 (355,365]」。⇒ 转换那一拍落一列 `postureExitReason`（枚举）＋当拍 `avgPressure/anyRecovery/liveThreat` 三个布尔 ⇒ **一发 peek 结案**。属**诊断列新增、不动策略参数**，与 #139 同批走、**不自办**。形状声明：新列作**可选键**加进 `KernelMemory.strategy`（`global.d.ts:573-587`）⇒ 不需要迁移；将来若改名/换形状才要过 `src/kernel/migrations/mid.ts` 那一族。
  · **同轮自纠（口径连带，写在这里因为它改了既有判定）**：`Memory.kernel.skipReasons` 在 `Game.time % 500 === 0` 那拍被整搬进 `prevSkipReasons` 并清零（`memory.ts:252-255`）⇒ **窗首取样的「零」是结构性的低**。据此把 R189 补50⑤ 那句「`*/budget` 间歇性定案」**整条作废**，判据换成「读 `prevSkipReasons`（完整 500 拍窗）」。R190P3（`t=83,454,139`、`mod=139`）现读完整窗＝**有**六条 budget（`reserver=4／distributor=2／remoteHauler=2／upgrader=1／labTender=1／scout=1`，量级零星），当前窗＝0 条 ⇒ 「零／非零」的历史序列**整体不可比**，需按完整窗重采 ≥3 发才谈定性（#136「单窗不能定性」的加强版：同一字段还要同窗长）。

## 3.6 判等效外部事件（不是我的修没生效）

- **#48 / #35 跨房交付成对入账**：本窗证据——两房 `exported` 皆空、在场 9 只跨房 creep **全是远矿角色**
  （home=W37S58、现场 W36S58/W37S57），幼房 `bk` 是自给形状 `{harvested:1000, upgraded:800, towerSpent:500}`
  ⇒ **没有一次"自有房→自有房"交付**，判据继续挂起。不写 PASS 也不写 FAIL。
- **#47 早期房价格自锁豁免**：等一次 `px<0.2` 的死亡补员现场签名。
- **#57 发展停摆响应**：等一次真停摆（`controllerProgressChangedAt` 已落 Memory 锚，取证器就位）。
- **#68 调优闭环效果豁免**：等 tick 83381266 那一拍（两个错峰轮询器覆盖到 17:02Z）。
- **#74 / #76**：判效器已备好，**但都排在批次 8 部署之后** —— 部署前的一切读数都是旧码。
- **#82 观测通道**：判据是**键签名**而非数值——批次 11 部署后第一个规划窗，owned 房的 `layoutMetrics` 条目必须带上
  `linkRoleSurplus`（化石条目按构造不可能带）；W38S58 那条化石应继续缺键（该房无规划器在跑）。两形相对即接通证据。

## 4. 当前迭代（最近三轮）

### 4.0（10-04 18:38Z 改写，R161；**上一条（R160 补32 立的 objective：读判效器日志见证 CP4＋三支择一判"builder 从哪条通道离开"）本轮三支全判完**——第一支 CP4 沿未到（10 发恒 `state=economic_startup / checkpointsPassed=3 / consecutivePositiveTicks=0 / forcedAdvance=false / startedAt=83425257`）；第三支落进"我算的 4 条始终不落"⇒ 挡点在 demand 侧（`demand.ts:1098`×`:277`，R160 补33/补36 已闭链），**#124 的未定项就此结案**；第二支（`integrating` 第一趟两键）按构造仍无从取。**判效器顺手抓到两件新事实**：①三条 upgrader 请求**真被孵化**（`人口 6→9`、`spawnQueue=[]`、TTL 1242~1285 ⇒ R160 补25 的"预留 200 把非 P0 预算压到 100"是**占空比不是恒锁**，孵化通道活着，锁在需求侧）；②孵出来的 upgrader 被 `kernel.ts:988-1003` 的 colony-state 门禁整条冻掉（`defineRole("upgrader", 2)` 无 `recoveryEligible`，`skipReasons.creep/upgrader/colony-state=396`，`controller.progress=12,952` 与 15:4xZ 那次逐字相同）⇒ 新立 §3.5 **#127**，内含一条带日程的降级预报）下一轮主目标：**裁决 #127 的降级预报——在 t≈83,434,100（±，按实测 −1.058/拍的 `ttd` 斜率）前后现读 W38S58 的 `controller.progress / ticksToDowngrade / level`：若 `progress` 仍 =12,952 且 `ttd` 跌到 0、`level` 由 2 变 1 ⇒ 预报命中、#127 定罪；若 `progress` 离开 12,952 或 `ttd` 止跌 ⇒ 冻结合不上，改读 `config/index.ts:403-405` 那把"upgrader 允许工作前的最低 extension 能量（RCL1-3）"闸（它在冻结的下游、本轮无法单独验）并撤本条严重度；同轮现读 `kernel.expansion` 与 `expansionDashboard.failedGates`，照实记降级有没有把扩张打进 `abandoned/failed` 或改动 `checkpointsPassed`，不替它补故事；并保留 CP4 那两支的否证位——`tmp/observe/r160-cp4.log` 的 `Q=` 若出现 `builder:W38S58:*` ⇒ R160 补33 的机制当场作废、回来重读。**⚠️10-04 23:3xZ R168 补20 就地更正这一支（它已经兑现过一次，而它作废的不是"×0"本身）：`r164-queue.log` 第 14 发抓到 `builder:W38S58:0` 且该只 builder 现已在世施工，但同拍现读 `colonyStateSince=83,431,754` ⇒ 请求那一拍 ×0 是活的 ⇒ 只剩两条自洽解释（替补线 `:1167` 整条不乘 `demandFactor`／demand 线 `:1105` 需那一拍快照缺 `storage`），裁决表已挂上：`tmp/observe/r168e-builder-lane.log`（pid 953，26×240 s ⇒ 视界 ≈t 83,434,6xx），指纹＝"两只 builder 同世"判替补线、"老的死透后才出现 `:0`"判 demand 线。⇒ **引 #122/#126 时不许再写"builder 永不出带线／施工速率＝0"，要写成"×0 只需按住第一头；现已有一头在世，人拍的是头数与到 CP4 的小时数"**。CP4 现状也收窄了：按判据自身 filter（`state-machine.ts:441-446`）containers＝2 且 hits 200,000/200,000 仍在回升 ⇒ 第二合取项已满足，只剩 extensions 0/5（≈12,700 施工量＋2 张 queued 需建成工地＝#121 名额），按本轮新采速率 0.43~0.60/拍、拍长 3.85 s ⇒ **≈15~31 小时** ⇒ 下面那句"窗内看不到 CP4"仍成立。**★★★★10-05 01:0xZ R168 补25 覆盖上面那句"下一轮主目标"（#127 的降级预报已在 83,434,421 命中到拍，见 §3.5 #127 与 §4.0 补25）——下一轮主目标：验"只差一次升级"这条新预报，以及它带出来的新死线。** 现读 W38S58 的 `controller.level` 是否已由 1 弹回 2（弹回则 `lastRclChangeAt` 再前移、`progressTotal` 从 200 变成上级值域、那 5 张工地重新合法），并三件成对取证判"是谁弹回的"：只有两种自洽成因——`priority<=1` 的 P0 worker 走无门禁的 `upgradeController`（看 roster 是否出现 `worker>0`，其触发条件是 `demand.ts:309-311` 的 `harvester+worker===0`），或 colonyState 真离开 recovery 放开了 upgrader（看 `colonyState` 与 `skipReasons["creep/upgrader/colony-state"]` 的整窗增速是否归零）；两者都不出现而 level 动了 ⇒ 这套读法当场作废。**新死线（本轮白捡，必须挂表）**：RCL1 的 `ticksToDowngrade` 在 83,434,443 现读 9,979 ⇒ 按 −1.0/拍的下一次归零点 ≈**83,444,42x（≈10.6 小时后）**；其间若没有任何一次成功升级，本服会怎么走（RCL1→0 ⇒ 失控？还是止步于 1？）我**没有验过**、不许替它补故事——但无论哪种，`R168P25/P26` 已证的"RCL1 上 extension 合法数＝0"都把 CP4 挡在"先回 RCL2"之后，所以这条死线决定的是**这房还在不在**，排序比 CP4 更靠前。**施工侧同时留两支否证位**：extension 工地 progress 之和（现读 2,792@83,434,479）与 `built` 若在 builder 位仍空时继续涨 ⇒ 我"没人建"的判读错；若 builder 回来了而工地不动 ⇒ 补25 ②那条 RCL 挡点当场拿到执行证明（这是本窗没能验的那一半）。**CP4 那两支（`cp 3→4`＋`integrating` 第一趟两键）继续由 `tmp/observe/r168d-verdict.log`（pid 97790）覆盖，不许因为换了主目标就撤表。**

> ★**R161 补1 留给下一轮的三条硬口径（本轮当场踩过/核到）**：①**`observe.mjs` 的拍长列会出现"不可测（25 秒内未推进）"** ⇒ 拍长别依赖它；用我自己的探针时间戳做同斜率复标（本轮 3.91 与 3.86 s/拍，加上 R160 的 3.86 已三连同值 ⇒ 可引用，但当轮仍要重测）。②**"队列空"有三种完全不同的成因**（需求为 0／请求被孵化摘走／TTL 过期被 purge），而它们对 `spawnBlacklist` 的签名不同：upgrader 在豁免表（`spawn-manager.ts:763-771`）⇒ 过期**不留痕**；builder 不在豁免表 ⇒ 过期**必留痕** ⇒ 所以看到 `Q=` 变空必须先判是哪一种，本轮我用 `人口 6→9` + `TTL 1242~1285` 定成"孵化摘走"，**不是**靠"队列空"本身。③**跨层矛盾的指纹**：上层为某个目的买下的编制，下层按另一套规则不许它做事（本轮＝`demand.ts:920-923` 因 `hasDowngradeRisk` 把 upgrader 拉到 maxCount 并花 750 能量孵出来 × `kernel.ts:1092-1108` 因 `priority>1` 在 recovery 冻结）⇒ 看到"编制在场、而它本该治的那个指标继续恶化"，第一动作是读两层的准入规则，别急着说"没能量/没孵化"。

> ★**R162 补1 对本节 objective 的两处校准（读 §4.0 时连同本块一起读，别按原句单独裁决）**：①**裁决窗取 [83,434,100, 83,434,500]**——原句写死的 83,434,100 出自 −1.058/拍的斜率，R162 复测为 **−1.000/拍**（`ttd` 5,788→5,193 / 595 拍，恰好 1:1）⇒ 新算 83,434,421，差 321 拍（≈21 分钟 @3.9 s/拍）；两版都记，**窗内 `ttd` 未到 0 只记"未到期"**，不算命中也不算否证（原始那版按规矩仍是预报本体）。②**"解冻就能保级"这句不要写进结论**——现读 upgrader 的供给面为空（2 只 container 全在 source 旁、无 controller container、无 link）⇒ `upgrader.ts:126-128` 的放行条件为假 ⇒ 直采分支还要吃 `config/index.ts:404` `upgradeEnergyFloor=300`，而本房 `cap=300` ⇒ **地板＝满池**（`ea` 实测 147↔300 摆动）。⇒ 裁决若命中，归因写"冻结＋无供能路"两件事；若 `progress` 自己动了，先判是哪一把闸松了再谈机制。③本轮（R162）**未到拍子**（t≈83,429,2xx，距窗 ≈5,200 拍），只做完了"否证位未触发（`progress` 12,952 与 `energyLedger.upgraded` 2,500 双逐字不变）＋机制升到速率级（`creep/upgrader/colony-state` 396→777＝0.64/拍，与 3 只×cadence 5 的 0.60/拍吻合）"；判效器还剩 ≈22 发、覆盖到 ≈83435,2xx ⇒ **整个裁决窗已被表上的仪器盖住，无需新装置**。

> ★**R163 补1/补2 的交接（下一轮先读这两份日志再动手）**：`tmp/observe/r163-verdict.log`（**pid 69377，45 发 × 900 s ≈ 11.25 小时 ⇒ 覆盖到 t≈83,440,3xx，跨过整个窗口**；每发记 `kernel.expansion`／`phase(reserve,bandTicks)`／`ledger(upgraded,built,spawned)`／`controllerProgressChangedAt`／`controllerProgressSeen`，命中沿或 `upgraded|built` 一动就打 `VERDICT` 行）＋旧的紧否证位 `tmp/observe/r160-cp4.log`（pid 58241，剩 ≈6 发到 ≈83432,3xx，`Q=` 键列）。**读前先 `pgrep -f` 各一次**证它们还在；末行若是 `shift=exhausted` 只记"未到期"。本轮已把 #127 的覆盖面划成两阶段（阶段 1 无编制≈4,000 拍／阶段 2 有编制被冻），**裁决时按阶段读**：`controllerProgressChangedAt` 若离开 83,424,421 ⇒ 有升级工作（哪条路干的要现读，不许直接归功于解冻）；若 `built` 离开 4,064 或 `logistics.container.controller` 变 `site` ⇒ 有 builder 在场 ⇒ R160 补33 当场作废。

> ★★★**R164 补1（20:1xZ）判效器换表——旧表会在沿发生的那一发上失明**：`r163-verdict-watch.sh` 把 `kernel.expansion` 整对象截到 300 字符，而 **`lastEconomicEvalTick` 是 CP4 之后才新增、按 `state-machine.ts:544` 写在对象尾部** ⇒ 沿一旦发生正好被切掉。现改用 **`tmp/observe/r164-verdict.log`（pid 73248，600 s × 72 发 = 12 小时 ⇒ 覆盖到 t≈83,441,0xx）**，六键各取专列：`state / checkpointsPassed / startedAt / forcedAdvance / lastEconomicEvalTick / consecutivePositiveTicks`，另带 `phase(reserve,bandTicks)`、`ledger(upgraded,built)`、`controllerProgressChangedAt`。**第二支的基线已取**（首发：`lastEconomicEvalTick = 不存在`、`consecutivePositiveTicks = 0`）⇒ 沿上"从不存在变成数字"才是 `:543-544` 真跑过的签名；同发 `CPT` 读得到数 ⇒ 通道是通的，所以"不存在"是**有效基线不是坏读法**。旧表日志留档 `r163-verdict.log.partial`。**时刻分辨率预先写明**：`interval=100`、**当前实测未被拖慢**（R166 现读 `systemLastRun["expansion-manager"]` 距当拍 78 拍 ⇒ 今日一趟 ≈100 拍；历史上让位闸咬住 P3 时曾拖到 ≈400~500，两种都出现过，**别当常量引用**）⇒ **CP4 的时刻只能报到"哪一趟"，误差 ±一趟**，不许把 `startedAt` 当瞬时精确值。**③那一支的措辞也校准了**：跨轮实测 `reserve` 在 **[4,153 … 4,580]** 摆动（含 creep 携带），结构承载上限 4,300 ⇒ 准确说法是"**上界被承载锁死、十个样本从未越过 4,580，距出带线 15,000 差 3.3 倍以上**"，不再写"每次都顶到天花板"。

> ★★**R164 补4 预登记的"降级自然实验"（照读即可，别临场重新想）**：CP4 是**纯结构判据**（`state-machine.ts:449-457`：`extensions.length>=5`、`containers.length>0`，`roadsBuilt` 写死 true，**不含 RCL 项**），且 `checkpointsPassed = Math.max(现有, 4)`（`:466`）⇒ **降级既抹不掉已过 checkpoint、也帮不到 CP4**。工地不会被我们拆：`construction-manager.ts:216-218` 把 `expansion.target` 放进了 `cleanOrphanConstructionSites` 的保留集 ⇒ 唯一变量是**引擎在掉级时是否回收超额结构**。⇒ 降级那一拍（可 peek、可定日：`room-state.ts:90-92` 写 `lastRclLevel`/`lastRclChangeAt`）同刻现读 `Game.rooms.W38S58.storage` 是否仍在场与 extension 工地数是否从 3 掉到 0，两分支预先写死：**若 RCL1（法定 extension=0、storage=0）之后 storage 对象仍活着 ⇒ 本服不在降级时回收超额结构 ⇒ "这间幽灵 storage 是更高 RCL era 建的、随降级活下来"这条来历假设第一次拿到正面支持**；**若它随降级消失 ⇒ 回收确实发生 ⇒ 它的在场只能来自接管/遗留（#120/#122 原措辞），(a) 假设出局**。两种结果都有信息量——这是把已排定的事件变成对照，不是等出事。

> ★**R164 补6（20:30Z）仪器完整性已核，裁决读数可以直接信**：`check-code` 现读**线上 `sha=649eb94b9784 / 787,752B` == 本地 `dist/main.js`**（无参与 `?shard=shard3` 两处一致）⇒ **自 boot `83422285` 以来零部署** ⇒ heap 累计量与所有差分连续（`skipReasons` 396→777、`upgraded`/`built` 两次逐字不变、`controllerProgressChangedAt=83,424,421`），**账本基线不用重设**（只在部署后才需要）。且 `git log --name-only` 扫 `demand.ts/phase.ts/upgrader.ts/room-snapshot.ts/kernel.ts/room-state.ts` ⇒ **对端没碰任何一道闸**（没人给 upgrader 加 `recoveryEligible`、没改 `snapshot.storage` 采集、没动 `:1098`/`:528`）⇒ 机制描述对正在跑的二进制逐字适用；本地那 3 笔未推 src 不在跑的二进制里（sha 相等即证）。⇒ **下一轮裁决前只需再跑一次 `check-code`：sha 变了就先重取基线再读，别把部署当成机制翻转。**
>
> ★**R164 补7（20:33Z）在表仪器名册——旧的那支已下班，别再引它**：`r160-cp4-watch`（pid 58241）跑满 45 发后自行收尾，末行是预先设计的 `WATCH_DONE shift=exhausted (未越阈，非结论)` ⇒ **它的 `Q=` builder 否证位就此断供**。我补挂 **`tmp/observe/r164-queue.log`（pid 77019，600 s × 72 = 12 h）** 专盯 `spawnQueue` 键列＋`spawnBlacklist`：命中 `builder:W38S58:*` 就打 `FALSIFIER`（⇒ `demand.ts:1098` 的乘 0 机制作废），黑名单出现就打 `NOTE purge 支复活`。⇒ 跨窗的两支活表是 **`r164-verdict.log`（pid 73248：`state/cp/startedAt/forcedAdvance/lastEconomicEvalTick/CPT` + `reserve/bandTicks` + `upgraded/built` + `controllerProgressChangedAt`）** 与 **`r164-queue.log`（pid 77019）**；`r160-cp4.log` 降级为**历史 45 发**（`builder` 命中 0）。首发：`Q=` 空、`spawnBlacklist` 不存在 ⇒ 与机制一致。这正是我自己记过的老规矩的现场重演——**判效器有自己的下班时刻，交接里引仪器必须带 pid 与视界末拍，并每轮重跑 `pgrep`**。
>
> ★**R165 补2（20:39Z）第二支的期望值改由函数体给出，附一条单位陷阱**：`economic-activation.ts:65-72` `advancePositiveStreak(prev, elapsedTicks, positive){ if(!positive) return 0; return prev + Math.max(0, elapsedTicks); }` 配 `state-machine.ts:543-544`（第一趟 `lastEconomicEvalTick` 未定义 ⇒ `elapsed=0`）⇒ **第一趟 `consecutivePositiveTicks` 必为 0，netFlow 正/负两分支都给 0** ⇒ objective 那句"按原文必为 0"不再依赖注释文句。⚠️**单位陷阱：它累加拍数不是趟数** ⇒ 第二趟若 `netFlow>0`，`CPT` 会从 0 **跳到 ≈ 一趟间隔而不是 1**（⚠️R166 更正：原写"实测 400~500"取自 10-04 R158 在 CPU 让位闸咬住 P3 时的测量；本轮现读 `systemLastRun["expansion-manager"]` 距当拍仅 **78 拍**、`CONFIG.expansion.interval=100` ⇒ **今日节拍 ≈100 拍一趟**）。⇒ 读数口径改成不依赖估计的一条：**`CPT` 的增量＝相邻两趟 `lastEconomicEvalTick` 之差**（今日 ≈100；让位闸若再咬住会拉到 400~500 量级，两种都算正常），判据只看 **`CPT>0` ⇔ 该趟 `netFlow>0`；`CPT=0` ⇔ `netFlow≤0` 被清零**，且 CP4 的时刻分辨率＝一趟（今日 ≈100 拍）。**绝不把 450 读成"450 趟"**（判地位仍在 N+2 趟）。两件顺带事：(a) `:80-86` 注释自陈"把背包存量 ×25/t 当外部流"这一量纲错**已删** ⇒ 引用 #123 的"CP5 恒假"前须按新口径复核（下一轮顺手做，本轮不动结论）；(b) §3.5 现存 **`#116` 三条同号、`#88` 两条**（非我所立、不属本目标）⇒ 只登记不改写他人编号，请人拍一次号。
>
> ★**R168 补1（21:1xZ）#123 挂着的那半复核掉了：`selfSustaining` 仍然为假，但计数与机制要改写，而且它多出一个"零代价可撤"的形状**：现读 `R168E1@83,430,964` 在场 carrier **共 2 只、`home` 全为 W37S58**（一只 `→W38S56`、一只 `→W38S58`，各 TTL 416），`peek kernel.expansion` 读到 `sponsor="W37S58"`、`target="W38S58"` ⇒ 按 `state-machine.ts:851-852` 的三重筛（role=carrier ∧ `remoteTarget===target` ∧ `home===sponsor`）**命中 1 只** ⇒ `externalInflowPerTick(1)=1×50` ⇒ `externalEnergyInflow≠0` ⇒ `economic-activation.ts:104` 的 `selfSustaining` **假**。⇒ ①**#123 那句"CP5 自然 COMPLETED 按构造不可达"不降级、仍成立**；②我此前写的"2 条 carrier 线"是**在场 carrier 总数**，其中送 W38S56 的那只与本房的 `selfSustaining` 无关 ⇒ 正确计数是 **1 条线**，以后按 1 引用；③机制不是已删的"背包存量 ×25/t"而是"线数 ×50" ⇒ 它的有效期＝那只 carrier 的存活期（TTL 416 ⇒ ≈27 分钟 @3.8 s/拍），换代后必须重读，**别当常量引用**。
> 本轮真正多出来的是这条**不对称**：**同一处缺陷从两侧把 CP5 关住**。`carrier.ts:44` 的 `getFreeCapacity("energy") <= 0` 在这间读数为 `null` 的遗留 storage 上恒真（`R168E2@83,431,010` 复证 `free=null / used=0`）⇒ 这条线**物理上一克都没进过本房**；而账本里唯一能写 `W38S58.imported` 的作者就是同一个 if 块里的 `carrier.ts:57` ⇒ 我自读的 `W38S58.imported=0`（同一次读法里控制组非空：`W38S56.imported=82,785`、`W37S58.exported=27,600`，与对端 R343 逐字对上 ⇒ 不是读法坏）**就等于**"从未成功卸进"，不是漏账。⇒ 合起来：**撤掉这条 supply 线对本房能量的代价是 0（它从未交付过），却把 CP5 第三判据的输入从 50 翻成 0**。这与 #122 是两件独立决定（#122 解的是 builder 需求乘 0 ⇒ 管 CP4；本条只管 CP5 的 `selfSustaining`，且它不动 CP4），我不自办、也不为造证据去停任何 op。
> 附一条读数口径（本轮我自己踩的）：账本的正路是 **`kernel.stats.energyLedger.rooms.<房>`**；我先试的 `rooms.<房>.energyLedger` 与 `energyLedger.rooms.<房>` 两发都报"不存在"，而**控制组用同样形状也"不存在"** ⇒ 那是我的读法失败、不是"没有账"，按既有规矩只登记为"我读不到"。
>
> ★**R168 补2 预登记"CP4 到手的形状"——沿真出现时逐步核对，别临场重新推**：①**最早的一格是 `r164-queue.log` 命中 `builder:W38S58:*`，其次是 `built` 离开 4,064**（不是 site 数；⚠️**R168 补8 更正**：`built` 不是 builder 专属签名，container 旁路也能建 ⇒ 见到沿先与 `Q=` 里的 builder 命中交叉核，别单靠它定罪）⇒ `demand.ts:1098` 的乘 0 一旦解除，第一只 builder 先被队列表抓到；若 `Q=` 出现 builder 而 `built` 长期不动 ⇒ 缺口在孵化/供能侧，不在需求侧。②extension **site 3→5** 由 #121 的每房名额（`maxNormalSitesPerRoom:3`，config:290）放开；`claimSecure=true` **不挡**（R165 补5：`construction-manager.ts:127-139` 被严格门禁拒绝时仍走 R2 关键发展通道，明文放行 extension / controller container）。③第 5 张建成那一拍 `checkpoint.ts:184` 合取为真 ⇒ `state-machine.ts:466` `checkpointsPassed=Math.max(现有,4)`（**只升不降 ⇒ 掉级抹不掉已过 CP**）＋`:474-479` `state=integrating`、`startedAt` 重置为当拍。④下一趟（今日 ≈100 拍）`advanceIntegrating` 在 `:543-544` 写 `lastEconomicEvalTick` ⇒ **"从 `不存在` 变成数字"就是那两行真跑过的签名**（基线已在表：五发恒 `?（不存在）`、`CPT=0`），第一趟 `CPT` 必为 0（R165 补2），**N+2 趟才是判别位**。⑤两种"看着像但不是 CP4"的形状预先写死：`state=integrating` 而 `checkpointsPassed` **仍是 3** ⇒ 那是 `:482-497` 的 40,000 拍超时强推（`FORCED_ADVANCE` 只改 `state`/`startedAt`，**不碰 `checkpointsPassed`**），按 `startedAt=83,425,257` 该点 ≈**83,465,257**；`state=abandoned/failed` ⇒ 那是 `abortExpansion`（失守 `:508-515 LOST`／cp3 未过时 `:499 TIMED_OUT`）。⚠️**这条对目标第二支有实际收益**：超时强推同样会让 `advanceIntegrating` 跑起来 ⇒ **`lastEconomicEvalTick`/`CPT` 两键在 83,465,257 那一趟也能被读到**，不需要等 CP4；届时按⑤把"cp 仍 3"如实记成强推而非 CP4，两支分别记账，不许合并成"CP4 到手"。
> ★**R168 补3 通道警告（下一轮按 HEAD 找 audit 文件会一无所获）**：`audit/` 整个目录**从未进过版本控制**（`git log --all -- audit/` 命中 0、`git ls-files audit` = 0），而对端**未提交**的 `.gitignore:55` 新加了一行 `/audit` ⇒ 现在这 7 个文件（`FINDINGS.md`／`ALL-FINDINGS.tsv`／`units/TR.md`／`STORAGE-USABLE-IMPACT.md`…）**既不在 diff 里、也不在 `git status` 里**，被删掉不会有任何警告。⇒ 三条口径：①**凡 roadmap 里引 `audit/...` 的行号，都是本地一次性产物**，跨机/跨检出不可复现，别把它当持久工件核；②本轮代理产出的 `audit/STORAGE-USABLE-IMPACT.md`（含我加的 §11 核验段）**其持久副本就是 §3.5 #122 那条 R168 摘要** ⇒ 要看结论读路线图，不要去找那个文件、更不要因为它"不在 HEAD"就判它被删了；③要不要把 `audit/` 纳入 tracked 属人的决定（那要动 `.gitignore`，我按规矩永不 stage 它），我只登记风险不自办。
> ★★**R168 补5 在表仪器换表＋一条我自己造出来的假沿（读日志前必看，否则会把"取数失败"当成扩张死了）**：`r164-verdict.log`（pid 73248）在 iter=7 **误触发并自关**——那一次 `peek` 撞上 connect-timeout，脚本用 `2>&1` 把 node 的 stderr 并进了字段值，于是 `[TypeError: fetch **failed**]` 命中了我判据里的 `*failed*` 分支 ⇒ 末行写成 `VERDICT edge=state:node:internal/...`。**真实状态同刻手工现读**：`cp=3 / state=economic_startup / startedAt=83425257 / forcedAdvance=false / LET 不存在 / CPT=0 / controllerProgressSeen=12952 / upgraded=2500 / built=4064 / phase=crisis(reserve 4,528, bandTicks 7,414)`（更正说明也已追加在那份日志末尾，留档不重排）。⇒ **新表 `tmp/observe/r168-verdict.log`（pid 88697，24 发 × 600 s ⇒ 视界 ≈t 83,435,1xx，跨过裁决窗右端 83,434,500 约 600 拍余量）**，两处修好：判据只在字段形状确为 `<path> = <value>` 时才参与、取数失败记 `READFAIL` 继续跑；node 固定 nvm 24（旧表没 export PATH，漂到了 v26）。新表还多加一列 **`controllerProgressSeen`（基线 12,952）** ⇒ 从此 #127 的预报否证位**零 console 可判**（这是 E5 那批把 progress 锚进 Memory 的红利）。队列表 `r164-queue.log`（pid 77019）不受影响（判据词 `builder:W38S58:*` 不会被 stack trace 命中）。**通则（已进长期记忆）**：判"字段变坏"的分支必须先排掉**工具自己的失败形状**——把 stderr 并进 stdout 的取数脚本，会让 `fetch failed`/`TimeoutError` 这类文本撞上按子串匹配的判据；一条失败能同时做到"伪造沿"与"关掉仪器"，而日志看起来像成功收尾。
>
> ★**R168 补6 把"这两条链上到底谁能干活"核到底 ⇒ 两支否证位各缩成唯一形状**：①**建造只有 builder** —— `buildAssignmentSite`/`buildNearestSite` 在 `src/creeps/roles/` 的消费者**只有 `builder.ts:93/:96`**（我先按 `buildSite|buildStructure|constructSite` 搜 ⇒ 三种写法全零命中，那是我的造名失败、不是证据，改从 builder 的 import 表取真名）。⇒ 补2 链路第①格**本房可用、机制上不唯一（旁路见补8）**：**`built` 离开 4,064 ⇔ 有 builder 在场 ⇔ `demand.ts:1098` 与 `:1036` 那两道门松了**；worker 建不了（`worker.ts:62-73` 的 work 链只有 fillAssignmentTarget/repairCritical/fillTarget/upgradeController）。②**升级只有两条车道，而"第二把闸"是角色本地的** —— `upgradeController()`（`upgrade.ts:30-40`）**没有任何能量门禁**，只看 `ctrl.my`；300 地板住在 `upgrader.ts:126-137` 那层包装里（`:220` 包的正是这个无门禁动作），而带门禁的 `upgradeControllerGated()`（`:96-107`）在 `src/` **零消费者**（只有 barrel 导出与 3 条单测）⇒ **别把它读成"全局地板"**。⇒ 形状：**recovery 里唯一还能升级的角色是 worker**（P0 ⇒ `kernel.ts:1092-1108` 永不冻，且用的就是无门禁版 ⇒ 连 300 地板都不吃、也不要求 controller container 有能），而 worker 只在 `harvester+worker===0` 时才被请求（`demand.ts:309-311`）；现读编制 `harvester=4` ⇒ 今天不存在。③于是**裁决窗 `[83,434,100, 83,434,500]` 里 `progress` 若离开 12,952，只有两种成因，且两种都免费可判**：**(a) roster 出现 `worker>0`** ＝ harvester 被清空后的 P0 恢复线，属物理面自发、与 #122 无关 ⇒ **不许记成"解冻生效"**；**(b) `Q=` 出现 `builder:W38S58:*`，或 `built` 同拍也动** ＝ colonyState 离开 recovery（那间 storage 的前提被改）。若两者都不出现而 progress 动了 ⇒ 我这套机制读法当场作废、回来重读两层准入规则。④顺手给 #127 出路 (A) 补一条"能力已存在"的形状：不必新造机器——**P0 worker 那条车道本来就是无门禁的升级能力**，只是被 `harvester+worker===0` 这个触发器关着；要不要用它属排产选择（它动作面比 upgrader 宽：采集/修理/填充在前），仍属人。
> ★**R168 补7 objective 第二支的期望值从"读码"升成"跑过"**（临时夹具 `npx vitest run tests/unit/expansion/r168-firstpass-probe.test.ts`，5 例全绿后**即删、未 stage**，且 `dist/main.js` sha 未变 ⇒ 没碰部署）：`advancePositiveStreak(0,0,true)=0` **且** `(0,0,false)=0` ⇒ 第一趟 `consecutivePositiveTicks=0` 是**无条件的**，与那拍净流符号无关；`(0,100,true)=100`、`(100,100,true)=200` ⇒ 累加的确实是**拍数**（所以第二趟读到 ≈100 是正常值，不是"仪器可疑"）；`(200,100,false)=0` ⇒ 一次非正即清零。另 `externalInflowPerTick(1)=50` 配一份 `netFlow>0` 的输入 ⇒ `criteria.netPositive.passed=true` 而 `selfSustaining=false`；线数换成 0 ⇒ `selfSustaining=true` —— **这就是补1 那句"撤线把 CP5 第三判据翻成 0"的执行级证明**，不再只是算式。取数踩坑照记：`evaluateEconomicActivation` 的返回里**没有顶层 `netPositive`**（它在 `criteria.netPositive.passed`），我第一版按想象的字段名断言 ⇒ 2 例红；改读真实形状后 5/5 绿（"字段名要现读"又灵一次；红的是我的探针，不是被测系统）。
> ★★**R168 补8 当场自纠：我今天写的"建造只有 builder"是过头的**（三处已就地改成条件式，这里记机制与边界）。按**调用形状** `.build(` 全仓扫 ⇒ 施工意图有**三条**写者：①`builder.ts:93/:96` 经 `actions/build.ts:38/:81`（任何结构类型）；②`actions/dump.ts:76-93` 的 `buildNearbyContainerSite()`，被 **`harvester.ts:40`（work 链 3.5 档）与 `mineral-miner.ts:29`** 使用，条件＝`structureType === CONTAINER` 且 `getRangeTo(site) <= 3`；③远矿角色 `remote-hauler.ts:113`、`remote-harvester.ts:390`（建远矿 op 工地，`remote-harvester` 还自己 `createConstructionSite`）。而 `built` 由 `systems/room/economy.ts:88` 按 `flows.built` **聚合**写、不按角色分桶 ⇒ **`built` 动＝"有人在施工"，不等于"builder 在场"**。**为什么本房今天仍可拿它当 builder 代理**：唯一的 container 工地是 `logistics.container.controller`、位置 **(14,12)**，而 harvester 守源（container **(31,14)/(26,19)**），Chebyshev ≥15 ≫ 3 ⇒ 旁路几何上不可达；mineral-miner 与远矿角色在本房 roster 为 0（`R168E4`：harvester4/hauler2/upgrader3/distributor1）。⇒ **口径改成条件式**：真沿出现时先与 `r164-queue.log` 的 `builder:W38S58:*` 交叉核（那才是 builder 专属签名），`built` 只作"施工发生"的第二证；若将来 container 工地搬进 harvester 3 格内、或该房出现 mineral-miner/远矿施工，这条代理当场失效。**通式（已进长期记忆）**：判"某账本字段是某角色的专属签名"，光读一个角色的链不够——按调用形状扫全仓，再问该字段的写者按不按角色分桶。
>
> ★★**R168 补11 给 #127 的那两把否证位装上"重播种 vs 真工作"的分辨器**（不换表，理由在下面）：机制核到底——`global-cache.ts:1014-1015` 的 `globalCache()` 就是 `globalThis` ⇒ 账本住 **heap**；`telemetry-collector.ts:387-393` 把它镜像进 `Memory.kernel.stats.energyLedger` 时**连 `tick` 一起搬**（注释自陈"boot 起累计"）⇒ **`kernel.stats.energyLedger.tick` 是一把免费的"heap 复位"见证器**（⚠️按补15 的现场：它跳只说明累计基线作废，**不等于代码变了**——判"跑的是哪一版"要用 `check-code` 的 sha），现读 **83,422,285**，与 R158 起的 boot 记录逐字相同 ⇒ 当时确实零部署（这条读数在 22:0xZ 之后已被补15 的重播种事件取代，新 boot tick＝83,431,816）。（这条比 `check-code` 更便宜、且不占那个会 429 的桶）。⇒ 读数规则固定为：**`upgraded`/`built` 变大＝真工作**（同一 boot 内单调不减，注释与实现都这样）；**变小或键消失＝boot 换了（heap 重播种，⚠️不等于换码，见补15），不是升级/建造工作的证据**，此时先读 `energyLedger.tick` 确认、再用 `check-code` 的 sha 判代码是否真的变了，然后重设全部累计基线（既有规矩）。旁证一把：`Memory.rooms.<房>.phase.bandTicks` 在 Memory、跨部署存活，仍应 +1.000/拍。
> ⚠️**我自己那两行 FALSIFIER 文案是带缺陷的**：`r168b-verdict-watch.sh` 对 `upgraded != 2500`／`built != 4064` **不分方向**就打印"有升级工作了/施工发生"，所以上面那条规则不是可选项而是必读项——**日志里 FALSIFIER 行必须先看数值是升是降**。**为什么不为此第三次换表**：分辨所需的信息已经全在打印出来的数字里（FALSIFIER 行本身带值），再加一列 `tick` 只省一次手工 peek；换表的成本是把一张刚验过的仪器重新下线、并在下一拍重新对齐基线（`r164`→`r168`→`r168b` 已经换过两次，每次都有一次"基线对不对"的复检要重做）。⇒ 决定：不动表，把判别式写进本节与任务 #23，沿上花一发 peek 取 `energyLedger.tick` 即可。
>
> ★**R168 补9 目标第二支的"可观测性"三段核完，并据此换掉一张会静默漏沿的表**：①**写者** `state-machine.ts:543-544`；②**容器是 Memory 活引用而不是拷贝**——`expansion-manager.ts:52 const expansion = Memory.kernel.expansion;` 把该对象直接传进 `advanceIntegrating`（`state-machine.ts:97`），所以 `expansion.lastEconomicEvalTick = ctx.tick` 落的就在 `Memory.kernel.expansion` 上（与同一对象上我已在读的 `startedAt/forcedAdvance/checkpointsPassed` 完全同一机制）；③**持久化受保护**——`integrating` 在 `expansion-manager.ts:17-28` 的 `EXECUTION_STATES` 里，否则 `:40-46` 会把这条记录当旧版残留清掉 ⇒ **那一拍起 `advanceIntegrating` 再也不跑、两键按构造永不可读**（这正是"判据对自己要测的东西失明"那一族，现在排掉了）；④读通道＝peek 逐键专列。⇒ objective 第二支确实**可读**，不是按构造失明。
> 换表的两条真缺陷都是"静默漏沿"型（读码发现、离线桩证明）：**旧表状态判据写了 `abandoned`，而合法终态名是 `failed` / `aborted`**（`expansion-manager.ts:26-27`）⇒ 真出事不触发；**`abortExpansion` 末尾把 `Memory.kernel.expansion` 置 `undefined`** ⇒ 离场的签名是**键消失**而不是任何状态字符串 ⇒ 新表加 `edge=record-absent`。反向实验（桩 `tmp/observe/selftest/bin/node`，用法 `CASE=baseline|stderr|cp4|failed|absent INTERVAL=0 MAX=1 bash tmp/observe/selftest/watch-under-test.sh`；该副本与在跑那份**只差第 9 行 PATH**，diff 已证）五例：`baseline` 控制组**不出沿**；`stderr` 记 `READFAIL` 且**不出假沿**（补5 那一类就此不可能）；`cp4` ⇒ `edge=cp4+`；`state="failed"` ⇒ `edge=state:"failed"`；键不存在 ⇒ `edge=record-absent`。⇒ 新表 pid **90893**（`r168b-verdict.log`，MAX=30 ⇒ 视界 ≈t 83,438,9xx，跨过裁决窗右端约 4,400 拍余量）首发已采到与旧表一致的基线；旧 pid 88697 已 kill 并在其日志末尾留 NOTE。**桩的复用注意点（本轮自己踩的）**：桩必须排在被测脚本自己那句 `export PATH` **之前**才生效——我第一次把桩目录放前面，被脚本第 9 行的 nvm 路径盖掉，跑出来全是线上真值（靠日志里 `reserve` 与现场对得上才发现这是"假实验"而不是"表坏了"）。
>
> ★★**R168 补13 CP4 的两个输入项第一次被"同通道直读"，而 (ii-a) 的出带延迟也被跑出来了（≈142 拍）**。①**通道**：经济环（`timeseries.ts:220-267` 的 `sampleEconomy`，段 3，`node tmp/tools/official/econ-ring.mjs W38S58 <条数>`）每 50 拍一格，键义＝`rs`=reserve／`d`=reserveDelta／**`ds`=drainScore**／`p`=economyPressure×100／`ea=可用/容量`／`se`=storageEnergy／**`cte`=containerEnergy**／`cce`=controllerContainerEnergy／`hc`/`sc`。②**CP4 第一合取项的直读**：连续 6 格 `ea=x/300` ⇒ **`energyCapacityAvailable` 恒 300 ＝ 已建成 extension 数 0**（本服 1 张 extension 抬 50 容量），这是我此前只能靠 `built` 不动去推断的那个量，现在有了独立通道（且与 `R162E2` 的直读一致）。③**③的天花板复证换了仪器**：`cte=4000` 六格逐字不变（两只源 container 满载 2×2,000）、`se=0`、`cce=0`、`rs` 4,002~4,236 ⇒ "储备顶在结构承载上而相位不出带"由段通道而非 console 探针成立；`cce=0` 同时把 #127 那条"controller container 供能路"的前提直接证假。④**新出现的摆动被我核到机制**：环里相位在 `crisis ↔ recovery` 之间翻，`ds` 走 76→59→7.7→0——这不是"另一个病灶"，正是 `phase.ts:447 crisisScore=max(drain,liquidity)` 的积分器衰减（`:423` 每拍约 −0.5）与 `:519/:521` 的 30/5 两条阈 interacting，而每次 `ds≤5` 之后房间并没有出带，说明**接住它的是 `:528 bankrupt`**。⚠️ 这也更正我这里的一处旧口径：R160 补36/补10 那句"今天 1-4 分支全假"是按**某一拍的 Memory 镜像**（`phase.drainScore=0`）说的，现场其实是振荡的——分支 2/3 会阶段性为真，只是**它们撑不住带**，这一点由下面的对照实验证明。⑤**对照实验**（临时夹具真调 `evaluateColonyPhase`，200 拍轨迹，`prev.ds=76.3/bt=7795/phase=crisis`，其余按现读；即删未 stage，`dist` sha 未变）：只转 `storageRatio` 一个旋钮 ⇒ **`NaN`（今天的代码）相位集合 = {crisis, recovery}，第 200 拍仍是 crisis 且此时 `ds=0`**（drain 通道已清空、照样被 `bankrupt` 接回去）；**`undefined`（那行守卫）相位集合 = {crisis, recovery, growth}，首次 growth 在第 142 拍**（`ds` 从 76 衰减到 5 才过 `recoveryClearScore` 与 `minBandTicks` 的双阈，出带当拍 `bandTicks` 归 0）。⇒ **对 #122 (ii-a) 的正确表述改成："一行确实解除钉住，但需求侧真正放开要等 ≈142 拍（按 3.8 s/拍 ≈9 分钟）"**，判效窗别按"下一拍就变"来设。⑥**我这次实验的第一版是错的，被自己的断言抓住**：`trajectory()` 收了 `storageRatio` 形参却没往 `base()` 里传 ⇒ 两臂其实都跑了"修复后"的分支，`NaN 不应出带` 那条断言当场变红才暴露；修正传参后才得到上面这组对照。**通式：反向实验要包含"两臂必须给出不同结果"这一条断言，否则形参漏传会伪装成"两边都修好了"。**
>
> ★★★**R168 补15 观察窗内发生了一次 heap 重播种——机制结论不受影响，但所有累计基线作废，判效表也因此换成按方向判**：`kernel.stats.energyLedger.tick` 从 **83,422,285 跳到 83,431,816**（约 22:0xZ），而 ①`check-code` 现读线上仍是 **sha=649eb94b9784 / 787,752B**，②`git fetch` 后 `HEAD..origin/dev=0`（`origin/dev..HEAD=148`，即今天没有任何推送）⇒ **不是换码**。剩下两种可能（同字节重部署 / 沙箱进程重启）无法从现有读数区分，我不猜。后果与处置：
> ①**机制层不受影响**：跑着的二进制逐字相同 ⇒ 本轮所有 `file:line` 机制描述（`phase.ts:463/469`、`demand.ts:1036/1059/1098`、`kernel.ts:988-1003`、`carrier.ts:44`、`upgrader.ts:126-137`）继续逐字适用——这正是"sha 相等"这台免费仪器的用途。
> ②**累计基线全部重取**：`W38S58` 现在 `harvested=276 / pickedUp=150 / upgraded=0 / built=0 / repaired=0`（旧值 2500/4064/720 就此作废）；**不变的是 Memory 侧锚**：`controllerProgressSeen=12952`、`controllerProgressChangedAt=83,424,421`、`cp=3/economic_startup/LET 不存在/CPT=0`。⇒ 从此"`built>0`"就是"有施工"的干净信号（不必再和 4,064 比），**这次重播种把仪器的灵敏度提高了**；代价是 `upgraded/built` 的"逐字不变"复证链要从零重新累计。
> ③**`Memory.phase` 的连续性也断了**：`bandTicks` 从 7,9xx 变 **309**，反解复位点 ≈83,431,8xx 与账本 tick 一致 ⇒ 说明重启那一拍 `room-state.ts:120 roomMem.phase?.phase ?? "growth"` 的兜底分支被走过（不是相位自然出带，自然出带的话经济环会留下一段 growth 采样，而环里 40 格只有 crisis↔recovery）。⇒ 别再引"该房已连续在带内 N 拍"这种说法，除非它锚在 83,431,816 之后。
> ④**经济环把振荡看清了**：连续 40 格 `p=0` 为主，只在 `ea` 掉到 2/300 的孵化脉冲上冲到 60～80，`ds` 同步 52～76 ⇒ 补14 那句"builder 3（p=0.66）"是**脉冲时刻的值**，常态受 `:1042 economyCap` 约束（`hc=2`⇒3、`hc=4`⇒4）。
> ⑤**换表（这不是 churn，是必要修复）**：旧表的 FALSIFIER 拿累计量和硬编码 2500/4064 比不等，重播种后**每发都打印两条假信号**（日志里那两行 `upgraded=0`/`built=0` 已经写进去了）⇒ 新表 `tmp/observe/r168c-verdict.log`（pid **96231**，24 发 × 600 s ⇒ 视界 ≈t 83,436,7xx）改成**按方向判**：boot tick 变 ⇒ `RESET-DETECTED` 重锚、不打印工作；变大 ⇒ FALSIFIER；不变 ⇒ 静默。上线前用离线桩跑了六例（baseline 控制组静默／变大⇒出沿／tick 跳⇒RESET 且不报工作／stderr⇒READFAIL 且不造假沿／cp4／`state=failed`／键消失⇒沿），测试副本只差第 9 行 PATH（diff 已证）；我自己那两版脚本在这里被桩抓出两个真错（嵌套 `case` 语法、以及一次 env 传参写错），**换新仪器前先让桩跑绿**这条由此第二次证明有用。旧表 pid 90893 已 kill、其日志末尾留了 NOTE。
> ⑥**顺带把 CP4 第二个合取项的稳定性查了**（此前只是默认成立）：现场两只 container `hits=195,000/250,000 与 200,000/250,000`（78%/80%），16 拍内无变化；`CONTAINER_DECAY=5000 / CONTAINER_DECAY_TIME=100`；维修责任在 `harvester.ts:43 repairNearbyContainer` 与 `builder.ts:99 repairContainerDecay`（阈值 0.8，见 `remote-harvester.ts:17`），而 builder=0 ⇒ **只有 harvester 那一路活着**（它们就守在源 container 旁）。⇒ 判读：`containers.length>0` 目前稳定，但**不是无条件保证**——若按 50 hits/拍的下界算，单只 container 约 3,900 拍（≈4 小时）可归零。下一轮的免费检查：再读这两只的 hits，**低于 ~150,000 ⇒ 衰减正在发生且无人修**，那时 CP4 的第二合取项要重新确认（别到 `cp=4` 那一拍才发现读的是"容器还剩一只"的假满足）。
>
> ★★★★**R197 补58（10-06 05:1xZ）★复发点未到但三个前置全部现读为真（判点 83,461,051，还差 643 拍 ⇒ R198 是判据轮）；本轮最有分量的新数是 CPU 边际跳到 ≈17.46/t（G6 缺口从 4.1 扩到 5.5/t），并留下一条口径：贴顶≠大面积拒活。**
> ①**预报进度**：`posture=fortify、since=83,458,051`（dwell 2,357 拍）⇒ **判点 83,461,051 未到**（这句写在读数之前，所以"仍 fortify"不算否证）。三前置现读全真：`threatRecent`（`lastHostileAt=83,459,330`＋5,000 撑到 **83,464,330**）、两房 `colonyState=normal`（83,459,380／83,454,935）、`warPressureTicks=0`＋`fg` 只有 `G6`。⇒ **R198（预计 t≈83,461,7xx~9xx）必在点上**：命中＝warPatience 公式第二次逐拍命中；未命中则当场记下挡在哪一条件。
> ②**参数底已被并行轨钉死（这条让 ① 的算术不再依赖"档位值假设"）**：他们 R385→R386 查到 `strategyOverrides` 里 `posture.minDwell=1400`／`posture.warPatience=10000` **都被读时过期过滤器滤掉**（TTL=5,000×3=15,000 拍，两条距 467,000／40,400 拍），并核线上产物 `sha=649eb94b9784` 确有 `isStrategyOverrideLive/resolveStrategyOverrides` ⇒ **生效值＝low 档 warPatience 3,000／minDwell 1,000**。⇒ 我 R191/R196 两次用 3,000 推点是**成立**的（第一次已逐拍命中）。
> ③**CPU：边际跳升**（这是 G6/#136 的新账）——`cpuRate.total=16.15／wt=28,592`（没重启，boot≈83,431,82x），与 R196 的 Δ900 拍**边际 ≈17.46/t**（R195 15.66 → R196 16.1 → R197 17.46，三连升）；同轮 10 拍窗 `avg=20.9／max=23.4`、300 拍环 `avg=20.8`、`bucketMin=9,990`（开始零散借 bucket）。⇒ **G6 需要的 ≤12.0 与实际缺口的距离从 ≈4.1/t 扩到 ≈5.5/t**；⚠️边际只对那段窗成立、不是"当前值"，且累计口径按构造滞后（进程累积均值）。
> ④**一条新口径：贴顶 ≠ 大面积拒活**——同轮 `*/budget` **第八个完整窗＝零条**（`prevSkipReasons` 只 6 键），而 10 拍窗已经 `avg=20.9`。⇒ 两把尺各说各的：**用量看 `cpuRate`，车道否决看 `*/budget`**；不许再拿"budget 零条"去论证"CPU 不紧"，也不许拿"贴顶"去论证"系统在拒活"。
> ⑤**builder 连续两发归零**：人口 38，榜 `remoteHauler 6／distributor 5／hauler 5／remoteHarvester 5／harvester 4／carrier 4／reserver 3／scout 3／upgrader 2／labTender 1`，**builder=0（R196 也是 0）**、军事角色 0；幼房队列只有 `upgrader/p2/0`。⚠️但"没人施工是不是问题"要的是**自有工地数**，而 observe 的 `site=` 是 remote-ops 聚合（prompt line 49①）⇒ 正路判别式留给 R198：`Game.rooms.<r>.find(FIND_MY_CONSTRUCTION_SITES).length`。另 `scout 1→3` 与判点临近同现（探矿在加不是退）。
> ⑥**R198 读什么**：a) **★复发点兑现与否**（`posture/since`＋`ea`＋`fg`；命中即记"公式第二次逐拍命中"）；b) 复发后**立刻**读 `powerFarmMissions`（又被 code 3 收摊＝双罚第三次复现；若 war 期反而开工＝`power-farm-manager.ts:34-40` 的读取路径要重验）；c) **丙支判点 83,464,330**（≈复发后 3,279 拍 ⇒ 大概率在 R199/R200，若兑现＝翻我 R195"乙/丙死路径"的案）；d) 自有工地数（⑤）＋`*/budget` 第九窗；e) `*/budget` 与 `cpuRate` 两把尺继续并记（④的口径要第二发）；f) #135 第十九发。⚠️纪律：只读不动，不为解闸降阈值、不为考验丙支推动能量承诺或制造危机。

> ★★★★★**R196 补57（10-06 04:1xZ）第六次进犯到场（6/6 纯塔）把 `threatRecent` 续到 83,464,330，于是得到一条新预报＋一个真分岔：war 最早 ≈83,461,051 复发；若它活到 83,464,330 就是丙支首样（翻我 R195"乙/丙可能是死路径"的案），若在到期前被危机解掉就是甲支第三样本。PB 车道解锁 ≈1,476 拍仍未复工。**
> ①**现场**：`EnemyInvasion W37S58@83,459,335`＋塔 6 发（330~335）＋`EnemyCleared@83,459,345`＝实战 **15 拍**，同窗 `ColonyStateChange [2,3]→[3,2]`（defense 50 拍）⇒ **六次进犯 6/6 只由塔解决、0 次编队交战**。`lastHostileAt` 六连＝83,444,623／48,781／50,361／54,198／55,371／**59,330**。
> ②**★★新预报＋分岔**：`strategy={posture:"fortify",since:83,458,051,warPressureTicks:0}` ⇒ 升 war 要 fortify dwell ≥ warPatience(3,000) ⇒ **预报 war 于 ≈83,461,051 复发**（本轮末 83,459,527 ⇒ 差 1,524 拍 ≈70 分钟，**R197 正该落在点上**；进入条件三件齐：`threatRecent` 撑到 83,464,330／两房 `p=0`／两房 normal）。**分岔**：复发后 (甲) 任一房再进 recovery/bootstrap ⇒ 经济支第三样本；(丙) war 干净活到 **83,464,330**（threatWindow 过期那一拍）⇒ **丙支首样＝落 `develop`，我 R195 的"死路径"推断当场翻案**。参考节奏：甲支前两次间隔 4,691 拍（83,453,360→83,458,051），丙支要求 war 连续活 3,279 拍 ⇒ **两支都有机会，不是送分题**。
> ③**PB 未复工（车道解锁 ≈1,476 拍）**：环内 1,359 拍 0 条 `PowerFarmOutcome`、`powerFarmMissions=[]`。⚠️**未定罪，只收窄卡点**：候选必须来自 intel 池里 `payload.powerBank===true` 且 `observedBy∈自有房` 的条目（`power-farm-manager.ts:149-158`），再过 `intelFreshness`／`maxRange`／占用排除（远矿运营房与 `kernel.expansion.target` 都算占用，`:129-141`）；本窗 `ProspectOutcome W40S54 d=[0,1]@83,459,426` 是**扩张探矿**（产无主候选），不是 PB 要的 powerBank 情报；CPU 车道几乎可排除（`system/power-farm-manager/budget=2`）。⇒ **判别式**：数 intel 池内"powerBank 为真且由自有房观察到"的条目数与新鲜度——**0 ⇒ 卡在情报采集（与 #100／Observer 同根）；>0 且新鲜 ⇒ 卡在 maxRange／占用排除**。
> ④`*/budget` **第七个完整窗＝零星**（`prevSkipReasons` 8 键，budget 只有 `scout=1`）⇒ 七发＝六条 1~4／三条 1~3／无／全谱 4~401／21 条大面积／零星 1 条，继续**只按同窗分母＋角色在场数读、不做窗序列定性**（第六窗那次大面积与当窗 6 只军事角色同现，已是一次自洽配对）。
> ⑤**roster 里两个 0（值得 R197 顺手看）**：人口 37，角色榜 `remoteHauler 7／remoteHarvester 7／hauler 5／carrier 4／harvester 4／reserver 4／distributor 3／upgrader 1／labTender 1／scout 1`——**builder 与军事角色都是 0**（R195 还有 builder 2／upgrader 2），而幼房 `queue=2/0` ⇒ 施工车道现在没人，这与 G4／"做深两房"直接相关（本轮不动、不猜成因）。累计 CPU `16.13／wt 27,692` ⇒ 没重启，Δ900 拍**边际 ≈16.1/t**；300 拍环 `avg 18.8／max 21.3`、`skippedPerTick 5.4`、`bucketMin 9,999`；`fg=G6`（G0／G4 都绿）、`Candidates=14(Q=5,R=9,U=0)`、核心房 `storage 858,755`。
> ⑥**账本对齐（不重复取证）**：并行轨 R374–R376 把"失守房没人清"从我的单房观察升级成资产账——实际控制 2 房却有 **74/345＝21.4% 我方建筑躺在 3 个不属于自己的房**（W37S55 69 枚且不在 Memory／W38S58 2 枚且在 Memory＝幻影房／W38S59 3 枚 extension），逐类闭合。⇒ 我的 #135"第十七发未变"只覆盖**W38S58 的 Memory 侧**，规模以他们的账为准；已在 §3.5 #135 挂交叉引用。
> ⑦**下一轮（R197）读什么**：a) **★★复发点 83,461,051 是否兑现**（现读 `posture/since`；命中＝warPatience 公式第二次逐拍命中，未命中就当场记下挡在哪一条件）；b) 复发后立刻看 `powerFarmMissions`（若 war 期 PB 又被 code 3 收摊＝双罚第三次复现；若 war 期 PB 反而开工＝那条 war-preempt 的读取路径要重验）；c) **丙支分岔判点 83,464,330**（若 war 在那一刻解闸并落 `develop` ⇒ 翻案，我 R195 的推断降级为"甲支更常见"而非"乙/丙死路径"）；d) `*/budget` 第八窗＋当窗角色在场数；e) builder=0 是否恢复（幼房 `queue` 在建什么）；f) #135 第十八发＋intel 池 powerBank 条目数（③的判别式）。⚠️纪律不变：只读不动，不为解闸降阈值、不为拿样本制造危机或进犯。

> ★★★★★**R195 补56（10-06 03:1xZ）★★预报判决：war 于 83,458,051 提前结束、落 `fortify`＝我先验写死的「甲支·经济危机早退」，而不是我判断最可能的「丙支→develop」。两场 war 的退出 2/2 都由经济支完成，乙支/丙支至今 0 样本 ⇒ 记下一条可否证推断：那两支可能是死路径。**
> ①**事实**：`strategy={posture:"fortify",since:83,458,051,expansionAllowed:true,warPressureTicks:0}` ⇒ 本场 war 只活 **1,691 拍**（83,456,360→83,458,051；上一场 5,737 拍），比预写退出点 83,460,371 **早 2,320 拍**；`fg` 只剩 `G6`（G0 第三次自行摘掉）、`agenda` 回 `develop`。
> ②**三支处置（丙不可能／乙被算术排除／甲同拍对上）**：丙（威胁消退→develop）要求 `!threatRecent`，而 `threatRecent` 要到 83,460,371 才假 ⇒ **此刻按构造不可能**；乙（压力撤资）要 `avgPressure>0.4` 连累 1,000 拍，而 R194 在 **386 拍前**现读 `warPressureTicks=0`、且 `econ-ring` 的核心房 `p` 只在 83,458,055~105 两拍是 100、其余 0 ⇒ **算术排除**（⚠️`p` 单位已核到写者：`timeseries.ts:291 p=Math.round(economyPressure*100)` ⇒ p=100＝pressure 1.0）；甲（`war && anyRecovery && !liveThreat` 早退）现场逐拍对上：`ColonyStateChange W37S58 [2,1]@83,458,055`＝normal→recovery（rank 1＝recovery），本轮遥测滞后**实测 4 拍**（同对里 `[1,2]` 事件打 83,458,155、`colonyStateSince=83,458,151`）⇒ 真实起点＝**83,458,051＝降级那一拍**，加上 `empire-strategy.ts:47` 的"room-state P0 已在本 tick 更新过这些字段"给出同拍先后 ⇒ **比 R190 那次干净：危机与降级同拍，无 ±5 拍模糊**。
> ③**危机自身有账（"单房稳定"的新读数）**：核心房 `ea` 约 100 拍内 12,900→**707**、同窗 `se` 反升到 854,807、人口 33→39（W37S58 20→25）⇒ **一波集中孵化抽干 spawn 可支配能量**（≈12,900 能量换 5~6 只新 creep）⇒ `pressure=1.0`、phase `crisis`、colonyState `recovery` ≈100 拍，随后 `ea` 回满、`hc` 2→3。⇒ 一句话：**帝国自己的招募潮解掉了自己的战争状态。**
> ④**这条把 #137 的退出侧改写，并留下一条可否证推断**：两场 war 退出 **2/2 走甲支**（R190 幼房缺采集者／R195 核心房孵化潮），**乙支 0 样本、丙支 0 样本** ⇒ 推断：**只要 war 期间帝国仍会做大额能量承诺，甲支就系统性抢在 threatWindow 到期之前 ⇒ 乙/丙两支可能是死路径**（翻案条件：某场 war 真活到 threatWindow 过期，或 `warPressureTicks` 爬到 ≥1,000 ⇒ 当场记为"两支之一有活样本"）。⚠️**预报纪律**：这次落空的是"哪一支先发生"的**概率判断**，判据本身没落空（三支及其含义都预先写死、且现场按预写的一支兑现）⇒ 两件事必须分开记，否则会把"预报"降级成"事后解释"。
> ⑤**`*/budget` 第六个完整窗＝大面积**（窗 [83,458,000→83,458,500)，28 键、budget 21 条）：`upgrader=201／builder=202／reserver=303／scout=101`＋四个 system 各 100＋九个各 10。按"同窗分母＋角色在场数"（在世 upgrader 2、builder 2、reserver 5、scout 1）折成比例＝**upgrader≈20%／builder≈20%／reserver≈12%／scout≈20%**，与 R193 的 attacker/healer≈20% 同量级。⚠️**system 那几列不能与角色列横比**：`recordSkip(\`system/${name}/budget\`)` 按"调度尝试"计（分母是 500/interval，例：`war-planner` interval=10 ⇒ 50 次尝试里拒 10 次＝20%，不是 10/500）⇒ 本轮不下"谁被饿最狠"的结论，要判得逐系统取 interval。
> ⑥其余：`warPlan=NULL`（本场 war 全程 1,691 拍无计划 ⇒ #138 条件二仍未满足；与并行轨"candidates=0/plans=0"同形、不互引）、`powerFarmMissions=[]`、42 只人口里**军事角色 0 只**、PB 已被停 ≈2,180 拍；`cpuRate.total=16.13／wt=26,792` ⇒ 没重启，与 R194 的 Δ1,000 拍**边际 ≈15.66/t**；300 拍环 `avg=16.8／max=26.1`、`skippedPerTick 10.7`；`Candidates=12(Q=3,R=7,U=2)` 与 R194 逐字同；#135 第十六发未变。⚠️**拍长连续两轮测不到**（observe 那 25 秒 tick 未推进）⇒ 改用"两轮拍差/墙钟差"倒算：**≈1,000 拍/60 分钟 ≈ 3.6 s/拍**（R193 是 2.85 ⇒ 拍长在漂，时刻推算一律报区间不报点）。
> ⑦**下一轮（R196）读什么**：a) **PB 是否复工**——车道已解锁（`posture≠war` 且无 `warPlan`），若看到 `PowerFarmOutcome r=… d=[4,0]`＝开任务（code 表 `event-log.ts:115-117`），就是"war 一停 PB 就复工"的第三次复现（R192→R193 收摊→本轮解锁）；b) **两房 colonyState/`ea`**：孵化潮若再来一次＝甲支第三个样本，同时留意 `pressure` 连累（它若真爬到 1,000 就是乙支首样，直接翻案 ④）；c) `*/budget` 第七个完整窗（角色列按分母折算；system 列先取 interval 再比）；d) **G6 的边际**（`cpuRate.total` 15.66→? 与 `capacity.tier`）；e) #135 第十七发。⚠️纪律不变：只读不动，不为解闸降阈值、不为拿判据制造进犯或孵化潮。

> ★★★★★**R194 补55（10-06 02:1xZ）war 仍在持续（1,319 拍），退出侧三支路径第一次同框可读；据代码写下一条带拍号的可否证预报：war 将于 ≈83,460,371 结束并落到 `develop`（威胁消退支——史上第一次实测）。顺带把我 R183 那次更正补全：那句"过期后吃 minDwell 才回落 develop"在退出侧其实是对的。**
> ①**现读**：`posture=war、since=83,456,360` ⇒ 截至 83,457,679 已 **1,319 拍**；`expansionAllowed=false`、`fg=G0＋G6`（G4 不红）；`warPressureTicks=0` 且两房 `pressure=0`；`lastHostileAt` 未变（W37S58=83,455,371／W38S56=83,454,198）、环内无第六次进犯。
> ②**★★可否证预报（带拍号、三支先验）**：`threatRecent` 由 `lastHostileAt 83,455,371 ＋ threatWindow 5,000` 撑到 **83,460,371**，那一刻 `dwellElapsed=4,011 ≥ minDwell 1,000` ⇒ `posture.ts:196-201` 会落 **`develop`**（不是 fortify），并当场看 `expandHealth` 决定 `expansionAllowed`。三种落法都预先声明：**(甲) 经济支先到**（任一房进 recovery/bootstrap ⇒ 落 `fortify`）＝#137 结论的第二个样本；**(乙) 压力支先累到 1,000**（要 `avgPressure>0.4` 连满 1,000 拍，本轮读数为 0 且两房 pressure=0 ⇒ 可能但不易）＝该支**史上第一次实测**；**(丙) 第六次进犯把点顺延**（新点＝新进犯拍＋5,000）＝"可续期锁"第三个样本。⚠️**判点在 ≈2.1 小时之后 ⇒ R195 未到不算否证**（本轮拍长不可测：observe 那 25 秒内 tick 未推进，推算沿用 2.85 s/拍的近似）。
> ③**这条顺手补全我 R183 的更正**：当年被我用"错了"整句划掉的旧文"窗口过期后吃 `minDwell=1000` 才回落 develop"，**在退出侧是对的**——错的只是我把它套到"威胁窗仍内的 fortify 会不会升级"那一问（那一问的答案是"会升级，且 `threatWindow/warPatience` 被 `neighborPressure=low` 基线改反了方向"）。⇒ 教训写死进纪律：**更正一条旧文时必须注明它管哪一侧**，否则下一轮会拿一条"已被否证"的句子去判它本来就没管的那件事。
> ④**#138 条件二未满足（不是否证）**：`kernel.warPlan` 现读＝键不存在，war 复发后 **1,319 拍仍无任何计划**；与并行轨 R366/R367 的独立读数同形（三趟 war 期 pass `candidates=0/plans=0`；情报池 7 房**全部无主** ⇒ "不是筛得严，是没对象可筛"）。⇒ 两轨各读各的、结论一致但**不互引为判据**；采样条件仍是 `posture==="war"` **且** `warPlan` 非空。⚠️同时本轮角色普查 33 只里 `attacker:0／healer:0／remoteDefender:0` ⇒ **war 期内编队不会重建**（`power-farm-manager.ts:34-40` 的 war-preempt 是构造性的），PB 任务已被压制 ≈1,253 拍。
> ⑤**`*/budget` 第五个完整窗＝无，但这一发反过来验了我上一轮立的算法**：`prevSkipReasons`（窗 `[83,457,000→83,457,500)`）7 键、budget 零条；而 R193 那窗是 `attacker=401／healer=203／reserver=318` 的全谱。两窗形状相反**却由同一个变量解释**——**角色在场数**（R193 窗内有 4 attacker＋2 healer＝2,000／1,000 角色拍；本窗 0 只军事角色）。⇒ "按同窗分母＋角色数读，不按形状猜"第一次自我复核**通过**；五发完整窗序列＝有(六条 1~4)／有(三条 1~3)／无／有(全谱)／无 ⇒ 仍**不用窗序列定性**。
> ⑥**累计与两房**：`cpuRate.total=16.15／wt=25,792` ⇒ 没重启（boot≈83,431,873），与 R193（16.18/24,892）的 Δ900 拍**边际 ≈15.26/t**；300 拍环 `avg=18.8／max=22.5`、`skippedPerTick 4.1`（R193 是 10.8）；核心房 `storage 839,046`、`ea 12,900/12,900`；幼房 `storage 144,632`、`ea 1800/1800`、`nf_d −8.2`、`hc 2/2`；`Candidates=12(Q=3,R=7,U=2)`。#135 第十五发未变。
> ⑦**下一轮（R195）读什么**：a) **★★预报是否到场**（现读 `posture/since`：仍是 war ⇒ 记下 dwell 与三支的当前读数；落 `develop` ⇒ 丙/甲/乙定支并结案；落 `fortify` ⇒ 经济支第二样本）；⚠️**R195 大概率仍未到点（差 ≈1,300 拍）⇒ 判"未到"前先算拍、别记成否证**；b) `warPressureTicks` 是否开始爬（它一爬就是乙支在跑）；c) `kernel.warPlan` 若因新进犯出现 ⇒ #138 复验到场（读 `spawned` 与撤销时的 `WarOutcome` 第三列，预期 0 与 4）；d) `*/budget` 第六个完整窗＋当窗角色在场数（按⑤的算法）；e) #135 第十六发。⚠️纪律不变：只读不动，不为解闸降阈值、不为拿判据制造进犯。

> ★★★★★**R193 补54（10-06 01:1xZ）★预报兑现：war 于 83,456,360 复发、与预写逐拍相同，且是两个会话各自独立读到的同一拍；甲支的另一半也到手——复发后 66 拍，PB 车道被 war 自己收摊（`d=[3,6]`）。附带拿到帝国第一份 PB 交战账（收益 0、战损 0、六只回收）与一条军事车道的 CPU 档位。**
> ①**预报结案（本会话第一次"先写进文件、再读回来"）**：`R193P1@83,456,762` 现读 `posture="war"、since=83,456,360、expansionAllowed=false、warPressureTicks=0`——＝fortify `since 83,453,360 ＋ warPatience 3,000`，与 补52③ 预写**同一拍**。⚠️**交叉确证**：并行 R3xx 轨的 R358 独立判到同一件事（他们原文引用了我 补52 的那句预报）⇒ 两把独立读数，不共用结论、不重复立案。
> ②**#137 的"双罚"拿到第一手证据**：`powerFarmMissions` 由 R192 的长度 1（spawned=6）变 **0**，环内 `83,456,426 PowerFarmOutcome r=W40S54 d=[3,6]`。⇒ code 表读自 `event-log.ts:115-117` 原文：`0=done／1=attrition／2=timeout／3=war-preempt`，**开任务记 4**（所以 R192 那发 `[4,0]` 是"任务开启"，我当时的怀疑到此结案）。⇒ 一句话给人拍 D 案用：**进入 war＝同时关掉扩张（G0）与唯一真出兵的车道**。
> ③**第一份 PB 交战账（#39 答卷）**：开任务 83,455,226（W40S54、sponsor 幼房）→ 六只编队 83,455,227~814 孵化 → **phase 全程 `strike`、从未进 `collect`**（没有 `pbCollector` 在世）⇒ **收益 0**；war-preempt 后 `concludeMission → recycleSquad`（`power-farm-manager.ts:255-263`）标 `memory.recycle=true` ⇒ 六只在 83,456,684~696 于 **W38S56 同一格 (25,12)** 死亡，逐只按 `age` 反推出生拍与名单逐字对上（1 只寿终 `age 1457`、5 只早逝）⇒ **战损 0、是回收**（分类代码 `event-log.ts:296-305` 明写"早逝不等于战死"，带 recycle 标记落 `recycled` 不落 `combat`；累计现读 `{natural:1428, combat:32, recycled:107}`）。⚠️边界：这是**代码路径＋现场形状**的归因，**不是差分确证**（死亡已进本 boot 的累计值，事后差分摘不出来）；要差分得等 PB 下次出兵当场跟。
> ④**军事车道的 CPU 档位（分母先定住，避免"兵被饿死 80%"那种冲动）**：完整窗 `[83,456,000→83,456,500)` 内在世 attacker≈4／healer≈2 ⇒ 角色拍上限 2,000／1,000；实测 `creep/attacker/budget=401`（≈20%）、`creep/healer/budget=203`（≈20%）；同窗 `system/war-planner/budget=4`、`defense-planner=10`、`power-creep-manager=10`，以及四个扩张/侦察必需 system 各被拒 **100** 次（`layout-planner／tactical-runtime-pipeline／construction-manager／room-observer`）＋`reserver=318`、`upgrader=120`（⚠️peek 把这张表截断在 984B ⇒ 全部数字是**下界**）。⇒ 与 R183 的 170/88/88/43 同形：**`bucket=10,000 满格` 依旧不能当"CPU 够"的论据**。
> ⑤**`*/budget` 完整窗四发＝形状天差地别**：有(六条 1~4)／有(三条 1~3)／无／**有(全谱 4~401)** ⇒ 放弃"用窗序列定性"这条，改成**同窗分母＋角色数**的算法（④ 那种）；这正是 #136「单窗不能定性」第六次兑现，也是我自己 R190 那条作废更正的延续。
> ⑥**与并行轨的口径分工（两轨一张文件，必须写清，否则下轮读成互相否证）**：他们（R359/R360/R365）判的是**打击侧候选为 0**（`DIRECT_SOURCES={passive,scout,observer}`＋`ROOM_THREAT_TTL=200`＋池子 8~11 房），并说"spawned 仍未开始验证"；我的 R185/R187 两发 `spawned=0` 带 `operationType:"DEFEND"`、`targetRoom＝自有房`，**且都落在 war 期内**（war 起 83,447,623）⇒ 两条并存：**offensive 侧＝没有可打目标；DEFEND 侧＝有目标却因证据门 0 兵**。本轮新增硬事实：**war 复发后 402 拍 `kernel.warPlan` 仍是 NULL** ⇒ 立项要新鲜威胁信号（历次进犯后都是 +3 拍），不是"war 一开就立项"。⇒ **复验 #138 的采样条件写死：`posture==="war"` 且 `kernel.warPlan` 非空**（本轮两条件只满足第一个）。
> ⑦**R194 读什么**：a) **war 这一轮的持续时长**：`posture.since` 仍 83,456,360？现读 `fg`＋`expansionAllowed`，并对照"退出要走经济危机支（`anyRecovery && !liveThreat`）"——**若幼房再抖一次 bootstrap，war 会像上次那样被提前撤资**（那将是我 #137 结论的第三个样本、也是 D 案最想要的证据）；b) `kernel.warPlan` 若因新进犯出现 ⇒ 立刻读 `spawned` 与（撤销时）`WarOutcome` 第三列＝**#138 复验到场**；c) **G6 的边际**：`cpuRate.total`（16.18／wt 24,892）与 300 拍环（`avg=18.8`、`skippedPerTick 10.8` 已从 5.2 翻倍）——军事在场＋侦察恢复正在把负载往上推，这条要给拍 A/C 案的人；d) #135 第十五发＋`*/budget` 第五个完整窗（按④的算法读，不按形状猜）。

> ★★★★★**R192 补53（10-06 00:1xZ）头号新事实：军事角色第一次在场，而它是"war 结束"解锁出来的——PB 野采车道 `spawned=6 / phase="strike"` 正在打 W40S54。这同时给 #138 补上对照组、给 #137 的税账加一项（war 连 PB 一起关），并让我上一轮那句"军事角色从未在场"必须收窄。**
> ①**现场**：`powerFarmMissions=[{targetRoom:W40S54,sponsor:W38S56,since:83,455,226,spawned:6,phase:"strike"}]`；角色普查 43 只＝`attacker:4／healer:2／remoteDefender:1`，六只逐只按 name 锚定、全带 `mission:"powerBank"`、sponsor＝**幼房**（`attacker-W38S56-0..3@83,455,227/296/329/377`＋`healer-W38S56-0..1@83,455,751/814`），另 `remoteDefender-W37S58-0@83,455,002`。⇒ §1「战争」行已按此改写（"编成与交战从未上线"→"warPlan 车道从未上线；PB 车道已上线并在交战"）。
> ②**机制（代码链，不是巧合）**：`power-farm-manager.ts:34-40` 开头 `const atWar = posture==="war" 或存在 warPlan` ⇒ atWar 时把全部 PB 任务以 **code 3（war-preempt）** 收摊并 return ⇒ **war 的 5,737 拍里这条车道按构造出不了兵**；war 于 83,453,360 结束 ⇒ 83,455,226 开出第一个任务 ⇒ 第一只 attacker 83,455,227 出生（`PowerFarmOutcome W40S54 d=[4,0]@83,455,226`）。⇒ **#137 的税账要多记一项**：war 不只关 G0，还关掉唯一真能出兵/挣 power 的军事车道＝**双罚**。
> ③**#138 的对照组到手（本案最有价值的增量）**：同角色对、同 spawn 机器，PB 车道（`submitFarmRequest`，闸是人数差、**不查 `intelActionUsable`**）出兵 6 只并交战；warPlan 车道（`submitSquadRequest` 包在 `if (evidenceFresh && …)`，门用只收邻居房的侦察图评自住房）两次 `spawned=0` ⇒ **编队能力/spawn 侧/角色定义都没坏，坏的就是那道用错主体的门**。⇒ 修法候选（§3.5 三条）现在带对照组可验，仍属人。
> ④**★预报进度**：点 **83,456,360** 未到（末 t≈83,455,909、差 ≈450 拍、拍长 2.85 s ⇒ **R193 必在点后**），三前置逐条现读到：fortify `since` 未变、两房 `pressure=0`、两房 `colonyState=normal`；`threatRecent` 由**第五次进犯**（`W37S58@83,455,371~385`，14 拍，塔 5 发解决，`ColonyStateChange [2,3]→[3,2]`＝defense 50 拍）续期到 **83,460,371**。⇒ 判据加一条更便宜的签名：**复发那拍之后 `powerFarmMissions` 应由长度 1 变 0**（code 3 收摊），与 `posture` 独立交叉验证。
> ⑤**#139 已被并行会话修在 dev（未上线）**：`884cf525` 把 `repeats` 从函数侧随结果返回、调用方改读 `esc.repeats`，带回归用例＋反向实验（恰好 1 例转红 `expected 1 to be 4`）；`git log origin/dev..HEAD`＝**200 笔未推（src 8 笔）**，线上现读 `sha=649eb94b9784/787,752 B` ⇒ **未部署**。★零部署判效探针已预写：下一条 `RecoveryEscalation r=global` 第三列＝**28+** 才算生效，仍打印 **17**＝旧二进制。
> ⑥**CPU/健康**：累计 `16.13/t、wt=23,992`（没重启，boot≈83,431,9xx），但 300 拍环 `avg=18.9/max=21.3`（R185 同仪器 14.8/18.5）⇒ **负载在涨**，涨项含 `remote-mining-manager=4.8/t` 与新增军事角色；`fg` 只剩 `G6`（G4 第六次翻动＝绿）；`capacity.tier=constrained@83,425,106` vs 调度 `tier=healthy`（两把尺继续相反）；核心房 `storage 828,513`、幼房 `148,143`（危机后回血 ＋8,385）；`*/budget` 完整窗第三发＝**无** ⇒ 三发不同形（有六条／有三条／无）⇒ **仍不定性**。#135 第十三发未变；E7 的 W36S58 榜 `workers` 6→5→4→**2**（#133 第 N 发）。⚠️本轮开头先做了一件必须做的事：**HEAD 不再是我的 commit**（并行会话叠了 9 笔）⇒ 我先用 `merge-base --is-ancestor`／reflog／`grep -c` 三步确认"我的历史与产物都在"，再开始取证（没有急着补写、没有 rebase、没有碰他们的东西）。
> ⑦**下一轮（R193）读什么**：a) **★预报兑现**：`strategy.posture/since`＋`expansionAllowed`＋`fg`，并交叉读 `kernel.powerFarmMissions`（甲：war 复发 ⇒ 任务清空＋G0 复红，若同时出现 DEFEND 计划就顺手复验 #138 的 0/4；乙：没复发 ⇒ 记下是哪一条前置挡住，那本身就是"经济危机上界"第二个样本）；b) PB 这一仗的**结果账**：`PowerFarmOutcome` 的 code（4 是什么、有无战损 `spawned` 与在世数差、`CreepDeath role=attacker` 是否出现）⇒ 第一次有真实交战数据可记；c) `*/budget` 完整窗第四发（四发后再定性）；d) #135 第十四发＋幼房 `hc/colonyStateSince`。⚠️#139 只等上线那一批发效探针；goal 仍 blocked。

> ★★★★★**R191 补52（10-05 23:1xZ）第四次进犯落在 fortify 期 ⇒ 没升 war、没建 DEFEND 计划（#138 的复验前置因此被更正）；同时写下一条可否证预报：war 最早于 ≈83,456,360 复发。G0 的真相从"已摘"改成"间歇"，G4 又翻回绿（只剩 G6）。**
> ①**现场**：`EnemyInvasion W38S56@83,454,205`、`TowerVolley` 17 发（83,454,198~214，敌 hits 24→2）、`EnemyCleared@83,454,215` ⇒ 实战 **17 拍**、连续第四次**纯塔解决**。`kernel.warPlan`＝**键不存在**、环内 `WarOutcome=0 条` ⇒ **#138 复验没到场**，原因不是链坏而是 `war-planner.ts:62`：`posture!=="war"` 时直接 `demobilize(REASON_POSTURE); return` ⇒ **非 war 期连"该不该投编队"都没被问过**（这条把 #138 的"从未上线"范围收窄一半，也把它的前置写严了）。
> ②**为什么没升进 war＝本案多了一道闸门**：升 war 要 `fortify` 的 **dwell ≥ warPatience(3,000)** ＋`threatRecent`＋`avgPressure ≤ 0.4`＋`!anyRecovery`（`posture.ts:183-188`）。fortify `since=83,453,360` ⇒ **最早那一拍＝83,456,360**；`lastHostileAt=83,454,198 ＋ threatWindow(5,000)` ⇒ 威胁记忆撑到 **83,459,198** ⇒ 两区间重叠。
> ③**★可否证预报（本轮写死、下一轮读）**：**war 于 ≈83,456,360 复发**（`posture=war`＋`expansionAllowed=false`＋G0 复红）。两支都有意义：**(甲)** 复发并出现 DEFEND 计划 ⇒ #138 链第一次在"无新进犯、纯威胁记忆"下到场（只读 `warPlan.spawned` 与 `WarOutcome` 第三列，预期 **0 与 4**）；**(乙)** 那一刻因任一房在 recovery/bootstrap（或 `avgPressure>0.4`）而没复发 ⇒ "经济危机既解 war、也推后 war 复发"拿到第二个样本。⚠️本轮末 t≈83,455,05x、拍长 ≈3.8 s ⇒ **R192 可能站在门前几十拍**，判"未到"先算拍，别把"还没到点"读成否证。
> ④**G0 的正确说法从"已摘"改成"间歇"（同轮两次实测摁红）**：`expandHealth`（`posture.ts:150-157`）含 `allNormal` 与 `sponsorReady` 里的 `!hasLiveThreat` ⇒ 有活敌 **17 拍**（环内 `ColonyStateChange W38S56 [2,3]→[3,2]`＝normal→defense→normal 50 拍）＋幼房 **bootstrap 27 拍**（`[2,0]@83,454,915`；`console P1@83,454,928` 抓到 `colonyState="bootstrap", since=83,454,908`；peek 读到回 normal 的 `since=83,454,935`；触发者 `CreepDeath W38S56 role=harvester@83,454,889`）⇒ 这两段 `expansionAllowed` 必为 false。恢复后 peek 现读 `expansionAllowed=true`、`failedGates=["G6: CPU tier(v=constrained…)"]` ⇒ **G4 又翻绿＝"别拿 G4 当扩张条件"第五个样本**。
> ⑤**停摆代价第一次落到具体对象**：头号候选 `W37S56` 的计划 **`WAITING_EXECUTION`（R189）→ `CANCELLED`（R190、R191）** ⇒ ≈5,700 拍的 G0 不只是"没往前"，而是**摘掉了一次已在排的执行**。⚠️同窗 observe 的 `ready=` 列 139,581t→141,411t（Δ1,900 拍涨 1,830 ≈1/拍在涨、不是倒数）＝**工具侧字符串、语义我不掌握 ⇒ 只记形状**。侦察侧确实恢复：`ProspectOutcome` 9 发＋`Candidates 12（Q 2→5、U 3→0）` ⇒ #37 的 a 项答案＝"评估/侦察真走了一步"，但不等于能立项（G6 仍绑）。
> ⑥**`*/budget` 完整窗第二发＝有（三条 1~3）**：`prevSkipReasons`＝9 键含 `reserver/budget=3、labTender/budget=1、scout/budget=1` ⇒ 完整窗序列 **有(六条 1~4)／有(三条 1~3)** ＝**每 500 拍 ≤6 次拒活 ≈0.012/拍**，与 G6 缺口 4.1/t 差三个数量级 ⇒ 这是 #136"拒活救不了 G6"的按完整窗量化。⚠️**本轮我自己的一处错**：这一条我先在锁里写成"零"，是拿榜顶印象代替整张表 ⇒ 已就地更正（读数进锁前逐键过原文）。
> ⑦**下一轮（R192）读什么**：a) **★预报兑现与否**（`posture/since`＋`expansionAllowed`＋`fg`；甲/乙两支都算信息，判前先算拍）；b) 若 war 复发 ⇒ 同轮读 `warPlan`（有没有 DEFEND 计划、`spawned`）＝#138 第一次非进犯条件下的复验；c) `prevSkipReasons` 第三发完整窗（≥3 发定性）；d) 幼房 `colonyStateSince`/`hc`（它现在是 G0 间歇与 war 复发闸门的双重主角）＋#135 第十三发。⚠️#139/#140 仍只等改码批次批复；goal 仍 blocked。

> ★★★★★**R190 补51（10-05 22:1xZ）#137 结案案发到手，但退出机制被现场改写：war 不是威胁窗到期结束的，是幼房一次 ≈7 拍的 bootstrap 抖动把它撤资降级的 ⇒ 停摆有「经济危机」上界、没有 threatWindow 上界。G0 十轮来第一次摘掉（`fg=G4+G6`）；新案 #140＋我自己一条旧判定作废。**
> ①**war 于 83,453,360 结束**（`R190P1` 原样回显 `{posture:"fortify",since:83453360,expansionAllowed:true,newRemoteOpsAllowed:true,warPressureTicks:0,gclLevel:5,bucket:9998}`）⇒ 总账 **5,737 拍**硬性关扩张，而代价来源是三次合计 ≈15 拍的实战；比我预写的退出点 83,455,361 **早 2,001 拍**。侦察当场恢复（环内 `ProspectOutcome` 5 发，`AgendaChange` 也在 360 同拍 ⇒ 与姿态翻转一致）。⚠️**我本轮差点自纠过头**：一度以为 360 是 `AgendaChange` 的拍、把 since 改成 365，回头看原始 payload 里 `"since":83453360` 是我自己读到的字段值 ⇒ 撤回那次"更正"（教训进锁）。
> ②**分支判别（三支只剩一支）**：C「威胁消退→develop」与现读 `fortify` 不符；B「压力撤资」要 `avgPressure>0.4` 连累 1,000 拍，而 `empire-strategy` 是 `interval:1`（计数器每拍 +1）、退出前 **255 拍**（`R189P1@83,453,105`）现读 `warPressureTicks=0`，且 `econ-ring` 的 `p=` 整段恒 0；⇒ **A「`war && anyRecovery && !liveThreat` 经济危机早退」**（`posture.ts:161-163`，位于 threatRecent 分流**之前**）。现场链＝幼房 `hc=1/2`＋`ea=500/1800`＋`d=−1310`@83,453,355（采样已见缺采集者）→ `bootstrap`（遥测 `[2,0]` 打印于 365，按实测滞后 ≈8 拍反推起点 ≈357）→ 姿态 360 降级 → 回 normal `colonyStateSince=83,453,367`（该 `[0,2]` 事件打印在 375，故滞后 8 拍是直接量到的）。⇒ **判定拍 360 落在 bootstrap 区间 [≈357, 367] 内，A 支无滞后矛盾**；丢的只是「起点到拍」这一格分辨率＝#140 要省的东西。
> ③**新案 #140**＝姿态转换不落「走了哪条分支」的盘（`finalize` 无该列）⇒ 这类判别每次要 2 发 console＋1 发环＋5 处读码。修法＝可选诊断列＋三个当拍布尔，与 #139 同批、不自办。**同轮自纠**：`skipReasons` 每 500 拍整搬进 `prevSkipReasons` 并清零（`memory.ts:252-255`）⇒ 窗首的「零」是结构性的低 ⇒ **补50⑤ 那句「budget 间歇性定案」整条作废**，判据改读完整窗（R190P3：完整窗有六条零星 budget、当前窗 0 条）。
> ④**G4 同窗翻回红**（`G4: net flow(v=4.5|netFlow ≥ 5)`，差 10%）⇒「别拿 G4 当稳定扩张条件」**第四个样本**、第一次给出翻动量级；因由就在同一段：幼房 `se 134,726→126,502`（≈−16/t 持续约 500 拍）后回升、`nf_d=−35.8`、`storage 129,858`（vs R189 −9,368）；核心房 `storage 825,118`（＋5,033）、`nf_d=+66.8`、人口 24/12。`cpu=16.14/t、wt=22,192` ⇒ 没重启，与 R189 的 Δ900 拍**边际 ≈15.43/t**＝带内新低，距 G6 的 ≤12.0 仍差 4.1/t。两把同名档位继续相反（`capacity.tier=constrained` vs `kernel.tier=healthy`）。
> ⑤**读码收益一条（把 #135 的怀疑闭掉一半）**：`kernel.ts:443-446` 快照构建写死 `if (!room.controller?.my) continue` ⇒ **失守房进不了姿态输入**（否则 `anyRecovery` 恒真、war 按构造活不过一拍）。#135 第十一发未变（`失守待清=[W38S58]`＋`rcl=1/state=recovery/3 请求/ops=0-0`）；`warPlan=NULL`、`warStandDownUntil=unset`、`warBlacklist=[]`；E7 仍 W36S58 十条（`workers` 6→**5**、`noProg` 最高 22,161）＝#133 第 N 发。
> ⑥**下一轮（R191）读什么**：a) **war 结束后扩张链有没有真往前走一步**——现读 `kernel.expansion`（state/目标）＋计划表里 `W39S56/W39S55/W36S58` 的 `ready` 是否开始变（R190 读 `ready=0t`）＋`Candidates`（12：Q=2/R=7/U=3）；⚠️**别把 `allowed=true` 读成「会扩张」**：G6/G4 仍红，执行门禁只认 `expansionAllowed` ⇒ 这一发放的是**侦察/评估恢复度**，不是立项。b) `prevSkipReasons` 完整窗第二发（要 ≥3 发才定性）。c) 幼房 `hc` 是否回 2、`colonyStateSince` 是否再动 ⇒ 若再抖且 `posture` 仍 fortify，就是「经济危机上界」的**第二个样本**（这次不用考古）。d) #135 第十二发。⚠️#138 复验仍需第四次进犯、#139/#140 只等改码批次；goal 仍 blocked（不并第二个）。

> ★★★★★**R189 补50（10-05 21:1xZ）#138 的复验只能等第四次进犯自然到场（本窗 `warPlan=null` 已 1,247 拍、而立项由威胁信号触发）；新案 #139＝升级事件的 `repeats` 列打印的是 0 号条目的计数——一次天然实验就够定罪。**
> ①**#137 判据未到手**：`strategy={posture:"war",since:83,447,623,expansionAllowed:false,warPressureTicks:0}` ⇒ war 已 **5,505 拍**；两房 `hostileAt` 均未变（`W37S58=83,450,361`／`W38S56=83,448,781`）、环内 1,875 拍 **0 条** `EnemyInvasion/EnemyCleared` ⇒ 退出点仍 **83,455,361**（还差 2,233 拍；本轮实测拍长 ≈2.7 s ⇒ ≈1.6~2.1 小时）。⇒ 续期样本维持**两个**，不升级。
> ②**`warPlan=null` 已 1,247 拍（计划 #2 于 83,451,881 撤销后未再立项）**，三条读法分清：(a) 立项由威胁信号触发——前两次进犯后**都在 +3 拍**内出现计划（`83,448,781→since 83,448,784`、`83,450,361→83,450,364`），本窗无进犯 ⇒ "没计划"是正常态、**不立案**；(b) 唯一会长期拦住立项的是休战闸 `warStandDownUntil`（`war-planner.ts:71/:282`，`standDownTicks=2000`），而它**只在 `REASON_ATTRITION` 止损时设**，这两次撤销都不是 attrition ⇒ 闸没设，与 (a) 不冲突；(c) 对 #138 的后果＝**复验链只能等第四次进犯**，我不制造条件。⇒ 顺带给 #137 一个更准的说法：**现在关着扩张的是姿态本身，不是任何一条计划**。
> ③**新案 #139（本轮唯一机制级发现）**：`83,453,052 RecoveryEscalation r=global d=[3,1,17]`——前两列对（`global/mineral/terminal_trade` 现读 `attempts=3/terminal=true/lastAt` 与事件同拍），**第三列错**：该记录自身 `repeats=27`，`17` 是 `escalations[0]`（＝`W38S58/population_rebuild`）的计数。成因：`upsertEscalation` 对已存在条目**原地更新不移位**（`recovery-lifecycle.ts:930-942`）、只有首次才 `unshift`（`:945-955`），而 `recovery-execution-system.ts:1105-1109`＋日志 `:1113-1116` 都读 `esc.list[0]?.repeats`。⇒ **除 0 号条目外这一列都是别人的数**；`src/` 里该事件零消费者 ⇒ 只坏取证不坏决策，修法一行、随下一批 src 走。
> ④**给 #135 划边界（撤掉一种可能的过度解读）**：失守房那条升级 `lastAt=83,442,032`＝**比失守点 83,444,422 还早 2,390 拍**、已 11,096 拍没再动 ⇒ 正确说法不是"恢复系统还在为失守房做事"，而是"**清单永不摘、也没人摘**"；幼房那条 `population_rebuild` 距今 83,266 拍＝历史，不是新事。#135 第十发：`失守待清=[W38S58]`＋`rcl=1/state=recovery/3 条请求/ops=0-0/risk=true` **逐字未变**。
> ⑤常规：`*/budget` **第五窗＝零**（`skipReasons` 全量 7 键、无 `/budget/`）⇒ 七窗序列 有／零／零／未读／有／≈零／零 ⇒ "间歇性"维持；`fg` 全量＝`G0＋G6`（**G4 连续第三轮绿**）；`cpu=16.17/t、windowTicks=21,292` ⇒ 没重启（boot≈83,431,83x），与 R185（16.22/17,592）的 Δ窗 3,700 拍**边际 ≈15.93/t**（只算那段窗；比 G6 的 ≤12.0 高 3.9/t，落在 14.7~16.5 带内）；核心房 `storage 820,085`（−4,506 vs R188）、`ea 12,850/12,900`、`nf_d=+125.5`；幼房 `storage 139,226`（−204）、`ea 1800/1800`、`nf_d=−2`、`queue=3/0`；人口 34（20/14）；E7 给 #133 再送一发：`siteStaleWorkerIdle:W36S58` `workers=6` 而 `noProg` 最高 **21,254 拍**（那 6 只是按 work-part 数出来的远矿采集者，不是 builder）。
> ⑥**下一轮（R190）读什么**：a) **退出点 83,455,361 已过与否**（R189 末 t=83,453,128／墙钟 21:15Z ⇒ 过一小时按 2.7 s/拍 ≈+1,330 拍 ⇒ R190 约 83,454,4xx ⇒ **仍在 war 属正常**，判据要再下一轮）；b) 若离开 war：现读 `fg` 是否只剩 `G6`＋`expansionAllowed` 复真＝**#137 的结案发**（若又被新进犯顺延⇒"无期"升到第三样本，而那一发进犯同时是 #138 复验链的免费到场）；c) `*/budget` 第六窗；d) #135 第十一发（有变化才记）。⚠️#139 只等一次改码批次、不必再取证；goal 仍 blocked（工具层实证：blocked 态仍占位 ⇒ `CreateGoal` 报 "cannot create a new goal because this thread already has a goal"，**换主线属人**）。

> ★★★★★**R188 补49（10-05 20:1xZ）#138 一枪到底：军事编队从未上线的成因是"拿侦察证据门去评自住房"——`evidenceFresh` 对 DEFEND 计划按构造恒假，所以既不补员、又在 1,517 拍必以 INTEL_STALE 撤销。顺带更正 R186：recovery 只是信号的消费者，不是撤军的起因。**
> ①**先死的是我的候选 (i)**：`globalThis.systemLastRun` 现读 `war-planner 距 8 拍／war-planning 距 5 拍／tactical-runtime-pipeline 与 defense-planner 与 tower-defense 距 0 拍` ⇒ 规划器活着、没被 CPU 闸饿死 ⇒ 上一轮写的"可能没跑/被挡"当场作废。（⚠️读法：`systemLastRun` 是 `Record`，用 `[]` 不能用 `.get()`——prompt 里那条老规矩今天正好用上。）
> ②**闭合的链条（每一环都有代码行或现场列序）**：`war-planner.ts:135` 的 `evidenceFresh = intelActionUsable(plan.targetRoom, …)` ⇒ 两个 `submitSquadRequest` 全在 `if (evidenceFresh && …)` 里（`:186-205`）⇒ 而 `intelActionUsable` 读的 heap `roomEntries` **只有一个写者**：`adoptHandoff()` 吃 `globalCache().intelHandoff`，其生产者 `room-observer.ts:138-158` 的目标**只有邻居房** ⇒ **自有房永远不进 intel 图**；现场两个 DEFEND 计划的 `targetRoom` 恰恰是自有房（`W38S56`、`W37S58`）⇒ 门恒假 ⇒ `spawned` 恒 0 ⇒ 到 `planIntelBlackoutTicks=1500` 以 `REASON_INTEL_STALE=4` 撤销 ⇒ **两发 WarOutcome 第三列都是 4、第二列都是 0，寿命都是 1,517 拍**。⇒ 缺陷类别一句话：**拿"只对可侦察邻房成立的证据通道"去评"要防御的自家房"**（同族：#132 的绝对值预留评低容量房、#133 的 work-part 计数冒充 builder）。
> ③**修法是领域平衡决策 ⇒ 请示不自办**：首选"DEFEND 不走 `evidenceFresh` 门"（自住房每拍都在视野里）；备选"对该类型直接返回 true"；最不推荐"把自住房塞进 intel 图"。反向实验已写在 §3.5 #138（改前断言 `submitSquadRequest` 零调用、改后断言 `pending` 0→1，控制组＝非 DEFEND 保持原行为）。
> ④**#137 现状**：war 已持续 **4,546 拍**（`posture.since=83,447,623`），本窗**没有第四次进犯**（`W37S58/W38S56` 的 `lastHostileAt` 未变、环内无 `EnemyInvasion`）⇒ 退出点仍是 **83,455,361**（≈3,200 拍之后）；"进犯快于 5,000 拍 ⇒ 停摆无期"维持**两个**实测样本，不升级为三个。
> ⑤其他：`*/budget` 第四窗只剩 `reserver/budget=1` ⇒ 六窗序列"有／零／零／未读／有／≈零" ⇒ **间歇性定案**（我 #136 那句"单窗不能定性"第六次被证实）；`Blocked=G0+G6`（G4 连续第二轮绿）；W38S56 队列出现 `builder:W38S56:0/p2/**23p**` ⇒ 宽容量房 builder 正常投正常出，是 #122/#132"低容量专属"的第五次对照；#135 第八发未变。
> ⑥**下一轮（R189）读什么**：a) `posture` 是否已于 **83,455,361** 之后离开 war（若又被新进犯顺延 ⇒ "无期"升到第三样本）；b) 若再现 DEFEND 计划 ⇒ 只需读 `warPlan.spawned` 与 `WarOutcome` 第三列即可复验②这条链（预期仍是 0 与 4）；c) `*/budget` 第五窗；d) 两房健康（核心房 storage 已回到 824,591、幼房 139,430 微降）。⚠️#138 已判到根因 ⇒ **下一步的瓶颈是拍不拍修法，不是继续取证**。
>
> ★★★★★**R187 补48（10-05 19:1xZ）第三次进犯打到核心房，退出点第二次顺延 ⇒ #137 的"可续期锁"拿到第二个样本；同时新案 #138：战争计划两次要 9~10 人编队、`spawned` 两次都是 0。**
> ①**#137 续期第二次**：`W37S58.lastHostileAt=83,450,361`（第三次进犯，环内 `EnemyInvasion/TowerVolley:6/EnemyCleared`）⇒ `threatRecent` 取"任一自有房"最新值 ⇒ 退出点 83,453,781 → **83,455,361**。`lastHostileAt` 序列 **83,444,623 → 83,448,781（+4,158）→ 83,450,361（+1,580）**，两次都 < 生效 `threatWindow=5,000` ⇒ **停摆事实上无期**，而 `posture.since=83,447,623` 起扩张已连续关 **3,633 拍**。⇒ 措辞定案：不是"一次 ≈5,000 拍的税"，是"**进犯节奏快于 5,000 拍 ⇒ 无限期**"，而实测进犯节奏（1,580~4,158 拍）就在这个量级里。
> ②**#138 立号（攒够两个样本才立）**：新计划 `{targetRoom:W37S58, phase:"advance", squadSize:9, **spawned:0**, operationType:"DEFEND", since:83,450,364, age:902 拍}`，核心房 `spawnQueue`＝EMPTY、军事角色普查＝{} ⇒ 与 R185 那发（`squadSize:10, spawned:0`，1,517 拍后被 recovery 撤、撤时仍 0）**同形**。⇒ **"计划→编队"这一步在线上从未走通**，而它现在正在替帝国支付扩张成本（war 期间 G0 硬性关扩张）。成因两候选**都不猜**，判别式写死在 #138：读 `globalThis.systemLastRun["war-planner"]`（Record，不能 `.get()`）与 `Game.time` 之差。
> ③**G4 第二次双向抖**：`fg` 现读 **`G0+G6`**（R186 是 `G0+G4+G6`）⇒ 轨迹 红×4→绿×2→红×1→绿×1，同拍 W38S56 净流与 storage 都在涨 ⇒ **"别把 G4 当扩张条件"从推测升级为两次实测**。
> ④**`*/budget` 第三窗非零**（`reserver=257、upgrader=90、construction-manager/tactical-runtime-pipeline/layout-planner 各 75`）⇒ 五窗序列＝有／零／零／未读／有 ⇒ 定性为**间歇性反复出现**；⚠️observe 那行只印前 10 项，全量以 console 为准。`cpuRate.total` 16.30→16.22→**16.17**、`windowTicks` 增量＝拍数增量（没重启）⇒ 均值在缓慢下降，但照此到 `comfortable ≤12.0` 需 ≈10 万拍以上 ⇒ **G6 仍是结构问题**（#136 结论不变）。
> ⑤**账本活**：§1 的「自主防御」「战争」两行按三次进犯＋四份 warPlan/WarOutcome 证据重写 ⇒ 前者从"两次"升到"**三次，全部由塔独立完成、编队增援层从未上线**"，后者从"线上无敌情可采／未线上验证"改为"**部分线上验证（止损与撤军已见；编成与交战从未上线）**"。⚠️顺带记：`Memory.rooms.W38S58`（失守房第七发仍 25 键/3 请求，6,834 拍）里留着 `lastHostileAt=83,431,534`——它不在自有房快照里所以不参与 `threatRecent`（本轮未测影响，只记形状）。
> ⑥**下一轮（R188）读什么**：a) `systemLastRun["war-planner"]` 与 `Game.time` 之差 ⇒ 定 #138 的 (i)/(ii)；b) `posture` 是否已于 **83,455,361** 之后离开 war（若又被顺延第三次 ⇒ 把"无期"从措辞升级成实测三样本，并考虑 #137 是否要改判为"扩张主线的常态前提"而非"待排产缺陷"）；c) `*/budget` 第四窗；d) #135 第八发（有变化才记）。
>
> ★★★★★**R186 补47（10-05 18:1xZ）上一轮"战争模块有计划无兵力"被本轮解释了一半、推翻一半：计划不是卡住，是被 recovery 止损撤掉——撤的时候确实一个兵都没孵。**
> ①**证据链（列序全部核到代码行）**：`Memory.kernel.warPlan` 由 R185 的 `{targetRoom:W38S56, since:83,448,784, squadSize:10, spawned:0}` 变成 **`{}`（无键）**；环里 `83,450,301 WarOutcome r=W38S56 d=[2,0,4]`＋`83,450,302 d=[-1,0,1]`，而 `recovery-execution-system.ts:1327-1331` 写的列序就是 **`[-1(=Recovery triggered 特殊编码), signal.spawned, actions.length]`** ⇒ 第二发直译：**"恢复触发的中止，中止时 `spawned=0`"**。⇒ 真实形状是"计划活了 **1,517 拍**、期间 0 兵、最后被撤"——**止损链正常工作**（幼房失守＋recovery ⇒ 撤军，`war-planner.ts:449-457` 发信号、recovery 消费）。
> ②**留下一个未判的问题（不立案）**："10 人编制为什么 0"三条候选都没排除（兵排在采集之后／要求的角色是 `attacker/healer` 而队列里只有 `remoteDefender/p1/18p`／被 `frozenRoles` 挡）。⇒ **单样本不定严重度、不立 §3.5 编号**（同 #62 那条红线：一次场景的红不许当因果）；下一个 warPlan 出现时读三列即可判：`warPlan.spawned` ＋ 队列里有没有 attacker/healer 键 ＋ `frozenRoles`。
> ③**G4 回红 ⇒ `Blocked=G0+G4+G6`**：G4 的轨迹是 红(R180-184) → **绿(R184、R185 两轮)** → 红(R186)，而同拍 W38S56 `netFlowMean_d=42`、storage 仍在涨 ⇒ **G4 是在阈值附近抖，不是"变好/变坏"**。⇒ 口径：**别把 G4 当"能不能扩"的稳定条件**（prompt line 40 那句"会自己翻回"第一次被我双向实测）；G4 自己的判据全文我还没读，不解释它为什么回红。
> ④**#137 无第三次进犯 ⇒ 退出点不变＝83,453,781**（环窗 83,448,757→83,450,324 内只有 1 条 `EnemyInvasion`；`lastHostileAt` 仍是 83,448,781、`neighborPressure=low`）⇒ 还差 ≈3,440 拍，按瞬时 2.65 与窗均 4.35 s/拍 ⇒ **≈1.5~4.1 小时 ⇒ 19:4xZ~22:2xZ**（跨度大是因为拍长这两个值差 64%，别当单值 ETA）。
> ⑤白捡一发设计内对照：`83,449,755 ControllerDowngradeRisk r=W37S58 d=[9994]` ⇒ 核心房 ttd 掉到 9,994 触发风险事件，正是 **#52 已结案的 RCL8 锯齿带 [10000,>15000]** ⇒ 不是新缺陷，只是那把带第一次以事件形式进环（列序＝`[ttd]`）。
> ⑥**下一轮（R187）读什么**：a) `posture` 是否已于 83,453,781 之后回 `develop`、`expansionAllowed` 复 true、`Blocked` 是否只剩 `G4+G6`（这是 #137 的结案发；若之前又来进犯 ⇒ 退出点再顺延，并把"可续期"写成"无界"）；b) 若出现新的 `warPlan` ⇒ 按②那三列判"为什么 0 兵"；c) `*/budget` 第三窗（判它到底是间歇还是常态）；d) `失守待清`/25 键第七发未变 ⇒ 有变化才记。
>
> ★★★★★**R185 补46（10-05 17:1xZ）第二次进犯把 war 的退出点顶掉了：恐吓不是"一次 5,000 拍的税"，而是"可续期的锁"。同时捡到一条新的空缺——战争模块"有计划、无兵力"。**
> ①**#137 加重**（已在该条就地写全）：退出条件是 `threatRecent=false`，而它看的是"**任一自有房** `tick − lastHostileAt < 生效 threatWindow=5,000`" ⇒ **每 <5,000 拍被骚扰一次 = 扩张无限期停摆**。实测第一次续期：`hostileAt 83,444,623 → 83,448,781`（间隔 4,158 拍），退出点从 83,449,623 推到 **83,453,781**（≈20:3x~21:2xZ）。⇒ 预写判据被新事件覆盖时，记"被覆盖"，不记"命中/落空"。
> ②**war 姿态上来了，兵没上来**：`Memory.kernel.warPlan={targetRoom:"W38S56", since:83,448,784, **squadSize:10, spawned:0**}`（计划起来 285 拍仍 0），全量角色普查 30 只里 **0 只 attacker/defender/healer/dismantler**，而核心房队列里有 `remoteDefender/p1/18p` 在排、`reserver/p2` 在排 ⇒ 长期目标里"战争模块参与"这一格，现在的真实状态是**有事件、有计划、有需求，无兵力**。成因三条候选未判（`warPlan.status` 字段名我没读对／排在远程采集之后／`spawned` 语义不是"已孵数"）⇒ **R186 先 `Object.keys(Memory.kernel.warPlan)` 现读字段再定罪**，本轮不下结论。
> ③**`*/budget` 连续两窗为零** ⇒ R183 那批拒活确认为间歇尖峰（CPU 判据只剩 `cpuRate.total`，现 **16.22/t**；五发边际 15.84／16.48／15.87／16.12／**14.73** ⇒ 我把上一轮"稳在 15.8~16.5"改成 **14.7~16.5 且在降**，离 `comfortable ≤12.0` 仍差 ≈2.7/t；`windowTicks 17,592`＝拍数增量 ⇒ 没重启）。
> ④**#135 要精确化**：第六发仍 `25 键/3 请求`（失守后 **5,047 拍**），**但环侧已经清了**——observe 里 W38S58 那行 `econ` 从"停在 83,444,405 的旧行"变成 **`null`** ⇒ 正确说法是"**清理链覆盖到观测环、没覆盖到 `Memory.rooms` 条目**"，不是"什么都没清"。
> ⑤**两次假阴性都来自猜名字，都当场纠**（记进读数纪律）：`Memory.kernel.warPlans/warPlanning` 不存在 ⇒ 真键是单数 **`warPlan`**（`war-planning-system.ts:511`）；角色普查先用了小写 `/defender/` ⇒ 漏 `remoteDefender`（大小写敏感）⇒ "**场上无军事编制**"这类负向结论必须由**全量 role 列表**支撑，不能由正则子集。
> ⑥**下一轮（R186）读什么**：a) `warPlan` 的字段名与 `status` 语义先现读，再判"10 人编制为什么 0"；b) 若第二次退出点 **83,453,781** 之前又来第三次进犯 ⇒ #137 的"续期锁"就是第二次实测，直接把上界写成"无界"；c) `Blocked` 是否仍 `G0+G6`（G4 已连绿两轮，若回红说明它不稳 ⇒ 别拿它当扩张条件）；d) `cpuRate.total` 是否继续降（现在方向是降的，但 12.0 之前不构成"能扩"）。
>
> ★★★★★**R184 补45（10-05 16:1xZ）G4 自己翻绿了、`*/budget` 自己归零了——两件事都说明：单窗读数在这个帝国里只能当"发生过"，不能当"是多少"。**
> ①**`posture` 仍 `war`（dwell 910），退出点算到拍**：需要同时满足 `threatRecent=false`（`lastHostileAt 83,444,623 + 生效 threatWindow 5,000 ⇒ 83,449,623`）与 `dwell ≥ minDwell=1,000 ⇒ 83,448,623` ⇒ **绑定值是 83,449,623**，距本轮 ≈1,090 拍（拍长实测 2.64 s ⇒ ≈48 分钟）⇒ **R185 应看到回 `develop`**（#137 的预写判据，任务 #36）。
> ②**`fg` 完整集合现读＝`G0+G6` ⇒ G4 翻绿**（R180 起连四轮 `G4+G6`；读法改成 `failedGates.map(g=>g.split(":")[0])`，不再截 60 字符——上一轮那发我自己承认"只读到前 60 字符"）。同拍 W38S56 storage `112,492→128,337`（≈+19.8/t）与 W37S58 反向（≈−9.6/t）⇒ **只记"同时发生"，因果未判**（G4 的输入是净流/自给那族慢量，时间常数对不上就是巧合）。⚠️observe 那行 `netFlowMean_d=-130.3`（核心房）**是工具侧派生列不是原始量**：Memory 同拍 `economy.nf=+607／cr=812,061／rb=507,538／phase=steady` ⇒ **核心房没在流失**，不立案（这条我记忆里已有对应教训，本轮是第二次用到它）。
> ③**`*/budget` 本窗全零** ⇒ 上一轮那批拒活（四 system 各 43→100、`reserver=170`）是**间歇尖峰**而非稳态 ⇒ 给 #136 加边界而不是撤（详见该条 R184 新增段）：**单窗不能定性 CPU 紧不紧**；目前唯一站得住的还是 `cpuRate.total=16.30/t`、该段边际 **16.12/t**（四次边际 15.84／16.48／15.87／16.12 ⇒ 稳在 15.8~16.5，`comfortable ≤12` 仍远），`windowTicks` 增量＝拍数增量 ⇒ **没重启**。
> ④**#135 第五发同值**：失守后 **4,111 拍**，`Memory.rooms.W38S58` 仍 `25 键 / 3 请求 / recovery` ⇒ "没人清"五发坐实（四→五之间 900 拍零变化）。这条的设计问句已写在 §3.5 #135，不再重复记录，下一轮起只在有变化时才记。
> ⑤**我自己一条预报被现场否证**：补44⑦(c) 写"war 拉起军队 ⇒ 预算竞争应更明显"——现场相反：`ProspectOutcome 5→1` 且 `*/budget→0`，因为 **war 关掉 `expansionAllowed` 的同时把侦察一起冻了**（`prospect-manager.ts:39` 第一道门就是它）。⇒ R183 那条"两把尺分裂＝一边花钱找房一边拒扩张"**适用条件要收窄**：只在 `expansionAllowed=true` 而前馈档仍 `constrained` 的那段窗口成立（本案是 fortify 期间），war 期间两者一起停 ⇒ 分裂不可见。机制没错，**可见性有条件**。
> ⑥**下一轮（R185）读什么**：a) `posture` 是否已于 **83,449,623** 之后回 `develop`＋`expansionAllowed` 复 true（`fg` 应随之回到 `G6` 单道）；b) G4 回绿之后**会不会再回红**（它是慢量，若幼房输血停止 ⇒ 可能反复 ⇒ 那正说明"拿 G4 当扩张条件"不稳）；c) `*/budget` 是否再次出现尖峰（要判"CPU 紧不紧"至少需要**多窗**计数，别再单窗定性）；d) #135 第六发（只在有变化时记）。
>
> ★★★★★**R183 补44（10-05 15:1xZ）威胁窗过期那一拍不是回落 develop，而是升级成 war 并把扩张关掉——成因是"安全区"基线把 `warPatience` 按退出语义改了值（新案 #137）。同时我自己昨天说的"CPU 其实够"被现场打折：`canStart` 正在按拍拒掉建房必需的 system。**
> ①**升级现场**：`R183P1@83,447,618` 读到 `fortify|since 83,444,623|elapsed 2,995|expansionAllowed=true`；同轮等过 230 拍后 `R183P2@83,447,687` 读到 **`war|since 83,447,623|64|expansionAllowed=false`**（`agenda.initiative=develop` ⇒ 姿态与议程分开走）。⇒ 补43⑥(a) 预写的两支（"回 develop"／"过期仍 fortify"）**双双落空，真值是第三支：升级**。G0 当场复红（`fg` 首条 `G0: posture expansionAllowed(v=false|…)`）。
> ②**为什么（一句话）**：`neighborPressure="low"` 的环境基线把 `threatWindow` 拉到 **5,000**、`warPatience` 缩到 **3,000**（`posture-baseline.ts:44-47`，注释理由是"不值得长期战争"＝退出语义），可 `warPatience` 全代码只有一处用法——`posture.ts:185` 的**进入**判定 ⇒ **越安全的区越容易进 war，而 war 硬性关扩张**。代价：一次 5 拍的入侵 ⇒ 扩张停摆 ≈5,000 拍（≈3.5~4.5 小时），且 `adversaries={}`／`conditions=[]`／`neighborPressure=low` 没有任何"仍在被打"的证据支撑它。⇒ 已立 §3.5 **#137**（三个出口全属人；另注意 `bounds.ts:146` 把这个参数暴露给调优器 ⇒ 与 L1 单向棘轮耦合）。
> ③**算术教训（这条最省时间）**：按 CONFIG 默认值 `threatWindow=3000／warPatience=5000`，这次升级**在算术上不可能**（进入要求 dwell≥5000、threatRecent 要求 elapsed<3000，两条件互斥）。我一开始就是用默认值推的，差一点把成因记成"读不到"。⇒ **参数会被环境基线覆盖 ⇒ "配置默认值"不是可推理的常数**；推姿态必须先读**生效值**（本轮生效值来自 `selectEnvBaseline` 的 `low` 分支）。
> ④**我昨天那句话要打折**（#136 里已就地补）：补42②写过"引擎说养得起、前馈说不够"。本轮 `skipReasons` 全量读到 `*/budget` 大面积拒活——`reserver=170／upgrader=88／builder=88／scout=44`，四个 system 各 **43**（`construction-manager／tactical-runtime-pipeline／layout-planner／room-observer`），230 拍后复读到 **100/100/100/100**。⇒ **`bucket=10,000 满格／tickLimit=500` 只证明"可借用"，不证明"够用"**；且 `avg10 17.2→12.7` 与拒活上升**同时发生** ⇒ 是上限收紧，不是负载下降。⇒ 口径纠正：**别用 bucket/tickLimit 论证 CPU 够**。
> ⑤**observe 的 skip 行也是截断榜**（同一族坑第二次，这次是我自己的工具）：observe 印 `reserver=67/upgrader=34/builder=34/system=16`，console 全量是 **170/88/88/43** ⇒ **计数一律 console 现读**。另外我在 P2 用 `slice(0,6)` 截键名，把名字全刷成 `creep=/system=` ⇒ 只剩数值可用：**表达式要截值、不要截键名**。
> ⑥**其余**：#135 第四发仍 `25键/3请求/recovery`（失守后 **3,196 拍**）⇒ "没人清"四发坐实；`cpuRate.total=16.31／windowTicks=15,792／sampledTicks=15,792／unsampledTicks=0` ⇒ 没重启，该段边际 **15.87/t**（三发边际 15.84／16.48／15.87 ⇒ 水平在 15.8~16.5 漂，`comfortable` ≤12 依旧远）；`Blocked` 升级前 `G4+G6`，升级后应为 `G0+G4+G6`（**完整集合留给 R184 现读**，本轮只读到 `fg` 前 60 字符）。
> ⑦**下一轮（R184）读什么**：a) `posture` 是否已在 ≈**83,449,62x** 之后回 `develop`＋`expansionAllowed` 复 true（若仍 `war` ⇒ 退出侧另有闸，回来读 `warExitPatienceTicks`／`liveThreat` 分支）；b) `fg` **完整集合**现读（第六轮，判 G0 是否真随 war 复红）；c) `*/budget` 拒活是否随 war 撤除而回落——war 会拉起军队 ⇒ 预算竞争应更明显，这是"每拍预算紧不紧"的免费对照；d) #135 第五发。⚠️本轮**动了①层**（`PATROL-PROMPT.md` 三处被现场证伪的句子），方向声明写在 lock。
>
> ★★★★★**R182 补43（10-05 14:1xZ）两件事定下来了：失守房不是"还没清"而是"没人清"（#135 改判），而我自己昨天给 G6 画的那条时间线被第三发否证——边际负载在往上走。**
> ①**#135 改判**：`Memory.rooms.W38S58` 三发逐字同值＝**25 键 / 3 条请求 / colonyState=recovery**（失守后 447／1,362／2,271 拍），`失守待清` 与 `expansionPlans` 的 W38S58 双行也一直挂着 ⇒ "再等一轮会自己好"被三次否证 ⇒ 这是**设计选择题**（终态保留 vs 清空即走），不是待观察事件。清理链覆盖编制与远矿、**不覆盖房内条目与扩张侧账本**。
> ②**G6 那条时间线作废**（撤的是数字，不是结论）：`total 16.33→16.34`、`windowTicks 13,892→14,792`、`sampledTicks===windowTicks` ⇒ 没重启；同样形状的差分给出**边际负载 ≈16.48/t**（舍入 ±0.16 ⇒ 与上一发的 15.84 之差不是噪声）。⇒ 我昨天写"按现漂移 −0.03/806 拍 ⇒ ≈9 万拍能到 tight"里隐含的**单调下漂假设错了**：方向朝上。⇒ 结论加强：**G6 不是时间问题，是结构问题**（要 `total ≤ 12.0/t`，而现值在 15.8~16.5 之间往上漂）；"等窗口稀释""部署一次看看"两条都不再是出路。
> ③**两把 CPU 尺的分裂第一次有了可见后果**——但按量级结案：`prospect-manager.ts:39-40` 用调度器尺（现 `healthy`）而 G6 用前馈尺（现 `constrained`）⇒ 环里 `ProspectOutcome 2→5`、候选池 `11→12` ⇒ 系统一边拒扩张一边花钱找新房。⚠️侦察支出在 `byRole` 前十里排不进（<0.05/t ≈ 0.3%）⇒ **不为一致性动侦察的闸**；要动只动 G6 的输入（#136 的三个出口，全属人）。
> ④**#132/#134 又拿到一个正面对照**：W38S56（`cap=1,800`）在飞请求＝`upgrader:W38S56:1 / P2 / 无 replaceBy / 无 correlationId / **18 件 body**` ⇒ 需求道在宽容量房出满配 upgrader 毫无障碍，而同样的请求在 300-cap 房里只能被压成 2~4 件。⇒ "低容量专属"第四次被证实（判别式第三次使用）。
> ⑤**我本轮自己撞的两次工具错**（都记下来防再犯）：①**又写了超长表达式**（≈940 字节 ⇒ `expression size is too large`；上限我昨天刚量成 (807, 928]，今天仍先撞一次才想起来）⇒ 规矩改成**写探针时先数字节数**，不是撞了再改；②上一条①里我把三发的时刻写成乱码（`R180@1,362→1,362？`）⇒ 已在锁里追加更正行（append-only 不改史）。
> ⑥**下一轮（R183）读什么**：a) `posture` 是否已在 ≈**83,447,62x** 离开 `fortify`（本轮 83,446,693 时窗未到期、dwell 已越 `minDwell=1000` ⇒ 若过期仍 fortify，就不是"有界自解"，要重开一条闸的判据问）；b) `Blocked` 第五轮（`G4+G6`）＋ G4 自己会不会翻绿；c) `cpuRate.total` 继续只当**进程重启探测器**（若 `sampledTicks < windowTicks` 或 total 跳变 ⇒ 有漏采/重启）；d) 若 #135 的三发同值被第四发打破 ⇒ 说明清理链有节拍，回来把它降回"待清"。
>
> ★★★★★**R181 补42（10-05 13:0xZ）上一轮那句"G6 卡在账本滞后"机制说错了：那不是窗口滚不完，是进程累积均值 ⇒ 真实两房负载 ≈15.9/t，G6 在本进程存活期内按构造解不开。**
> ①**更正的根据**：写入点 `telemetry-collector.ts:467` 是 `computeCpuRate(cum, Game.time − g.processBootTick)` ⇒ 分母＝**进程寿命**、分子＝自 boot 的**累加量**，旧样本永不退出（露馅处：两读之间 `windowTicks` 13,092→13,892 恰等于拍数增量）。因两读都满足 `sampledTicks===windowTicks`，分子唯一变化就是新增拍 ⇒ **差分直接反推当前真实水平**：`r=(16.33×13,892 − 16.36×13,092)/800 ≈ 15.9/t`（总量只存 2 位小数 ⇒ ±0.2）。⇒ 渐近线 15.9 **高于 comfortable 线 12.0** ⇒ G6 解不开；连 `tight`(<16.0) 按现漂移（−0.03/806 拍）也要 ≈**9 万拍（3~4 天）**稀释。已就地写进 §3.5 #136 与本条上方的补41 更正行。
> ⚠️**R182 就地更正本条①的数字**："真实两房水平 ≈15.9/t（±0.2）"要读成**那一段 800 拍窗口的边际均值 r₁≈15.84**，不是当前水平——第三发同样算法给出 **r₂≈16.48/t**（舍入 ±0.16 ⇒ 两发之差不是噪声）。⇒ "≈15.9"与"要 ≈9 万拍到 tight"都作废；**本条②③与"渐近线高于 comfortable 线"这个结论不变、且被加强**（方向还在往上）。详见 #136 的 R182 更正段与补43②。
> ②**帝国里有两把 CPU 档位，答案相反**：`Memory.kernel.tier="healthy"`（调度器口径，`since=83,272,831` ⇒ **17.3 万拍没变过**）与 `Memory.kernel.capacity.tier="constrained"`（规模前馈口径，`since=83,425,106`）同时为真，而 **G6 读后者**（`readiness.ts:209-212`）。且 **`bucket` 在 `CapacityInput`（`capacity.ts:10`）里声明却一次都没被函数体读** ⇒ 即时余量（现读 `bucket=10,000 满格 / tickLimit=500`）对档位毫无影响。⇒ 措辞要克制：**不是"资源够而闸错了"**，而是两把尺回答两个问题——按经验值再加一间**成熟**幼房 ≈+2/t（W38S56 现读每房 2.07/t）⇒ 15.9→≈17.9 ⇒ 仍在 `limit=20` 之下、bucket 满 ⇒ 引擎说养得起、前馈口径说不够。**真正该人拍的是"扩张的 CPU 判据用哪把尺"**（三个出口都动语义/阈值 ⇒ 我不自办）。
> ③**补41⑦(b) 第二发**：`失守待清=[W38S58]` 与 `Memory.rooms.W38S58` 的 **25 键/3 条陈旧请求**，在失守后 **1,362 拍**仍**逐字未变** ⇒ 两发同值；若第三发仍不动，就该把 #135 从"待清"改判"**没人清**"（那是设计问题，不是等待问题）。白捡第三处独立记录：W38S58 的经济环 `lastTick` 停在 **83,444,405** ⇒ 与 `lostRooms={"W38S58":83444422}`、我的采样器三方向互证失守时刻（⚠️环停拍与 lostRooms 拍差 17 拍 —— 环是 **flush 节奏**不是事件时刻，别混用）。
> ④**补41⑦(d) 判完，并且我差点又一次误读**：`Memory.kernel.strategy={posture:"fortify", since:83,444,623, expansionAllowed:true, warPressureTicks:0, bucket:10000}` ⇒ **dwell 已 1,249 拍 > `minDwell=1000`**，绑住 `fortify` 的是威胁窗口（`hostileAt=83,444,623` + `threatWindow=3000` ⇒ ≈83,447,62x 自解 ⇒ ≈14:3x~15:0xZ）；`expansionAllowed` 已 true ⇒ G0 绿（与 `Blocked=G4+G6` 一致）。我一开始怀疑"`postureChangedAt` 每拍重写会把 dwell 毁掉 ⇒ 可能永远出不去"——**读了代码就否证了自己**：dwell 用的是 `strategy.since`（只在变化时写 ✓），而 `postureChangedAt` 确实每拍重写（`empire-strategy.ts:237-239`）且**零消费者** ⇒ 死字段、不在决策路径 ⇒ 按既有口径结案，不排产（同族先例：`manual_intervention` 死枚举）。
> ⑤常规：`Blocked` **第三轮同值 `G4+G6`**（G4 没自己翻绿）；W38S56 健康（`nf_d 8.3`、`ea 1,161/1,800`、`ops 2/3`、`site 2`）；E7 的 `siteStaleWorkerIdle` 现在全是 W36S58 远矿路（幼房那五条已随房消失）；`skip(500t)` 里 **`creep/upgrader/colony-state` 已不见**（#127 那条冻结签名的退场）；环 `CreepDeath 39 / 1,247 拍 ≈0.031/拍` 与"38 只编制 × 1,500 拍恒寿命"的期望值吻合 ⇒ **自然减员，不是战损**（这条给上一轮那两条 `natural=0` 当了背景对照）。
> ⑥**下一轮读什么（都挂在会自己到场的事上）**：a) `cpuRate.total`——预报：**不会在数小时内降到 16.0**；若某轮看到 total 突然大幅偏离 15.9，那**不是负载降了**，而是**进程重启过**（boot 重置 ⇒ 均值重新播种）⇒ 顺手就成了"部署税"那条的复证；b) `失守待清`＋25 键/3 请求的**第三发**；c) `posture` 是否在 ≈83,447,62x 离开 `fortify`（有界自解，别动它）；d) `G4` 是否翻绿——若 boot 重置把档位带到 tight，G4 就成了唯一闸，那时才值得单独判它。
>
> ★★★★★**R180 补41（10-05 12:1xZ）失守后的第一次全帝国体检：补40⑦ 的四件全部到场并判完，而最值钱的发现在别处——G6 卡在"账本滞后"，不是"CPU 不够"（新案 #136）。**
> ①**G6 的真面目**：判档用的是 `cpuRate.total=16.36/t` 对 `limit=20` ⇒ headroom 18.2%，而 constrained 的线是 <20% ⇒ **差 0.36/t 就整档锁死**；同拍引擎侧是 `bucket=10,000 满格 / tickLimit=500`。⇒ 我原本两条"仪器坏了"的怀疑（可信通道被 `unsampledTicks` 否决、滞回被噪声清零）**都被自己读到的数否证**（`windowTicks=13,092`、`unsampledTicks=0` ⇒ 用的就是差分速率）⇒ 真相是**判据窗长 ≈13k 拍 ≈ 10~12 小时**，少一间房这种结构性减载要等窗口滚过才反映。数值后果摆在这里：**G6 翻绿要 `usage ≤ 12.0/t`，即省 ≈4.36/t；远矿三项只有 ≈2.62/t ⇒ 属人选项 A（关远矿线）不够，仍差 ≈1.7/t**。预报与边界写在 #136。
> ⚠️**R181 就地更正本条①与⑦(a)（机制我说错了，撤在原地）**：①里"判据窗长 ≈13k 拍 ⇒ 结构性减载要 ≈10~12 小时才反映"、以及⑦(a)"翻档时刻 ≈22:0xZ~24:0xZ"都**作废**——`windowTicks` 是**进程寿命**不是窗长（写入点 `telemetry-collector.ts:467`：`computeCpuRate(cum, Game.time − processBootTick)`，分子自 boot 累加 ⇒ 旧样本永不退出）。由两读差分反推的真实两房水平 **≈15.9/t**，高于 comfortable 线 12.0 ⇒ **G6 在本进程存活期内按构造解不开**（连 tight 也要 ≈9 万拍稀释；部署重置 boot 也只是 constrained→tight，**闸依旧不解**）。详见 §3.5 #136 的 R181 更正段。本条其余各支（清理链跑到一半、`st` 字段名的读法纠正、W38S56 不重演刀锋、战事第二样本）**不受影响**。
> ②**补40⑦(a) 判完**：清理链**跑到一半**——`lostRooms={"W38S58":83444422}`（系统自写、与我采样器独立同值）、该房 `remoteOps` 已 0 条、`Memory.creeps` 家记录已清；但 `Memory.rooms.W38S58` 仍有 25 键＋**3 条陈旧请求**（失守后 447 拍）、`expansionPlans` 仍 6 行、`失守待清` 那列还挂着 ⇒ 已就地补进 **#135**（不是"等等就好"）。⚠️顺带记我一次读法错：plan 的状态列是缩写 **`st`**，按 `state/status` 读会得**假阴性"没有 W38S58"**（我第一发就是这样读出空串）。
> ③**补40⑦(c) 的否证性检验判成**：W38S56 `ec=1,800 / phase=growth / normal / pressure=0 / level=5 / ttd=79,999`，编制普查**没有任何最小档 body**（hauler 是 24 件、haulerMin=24）⇒ **#132/#134 那把刀锋不出现** ⇒ 这条债的作用域现在是**双边的**：一间重演（W38S58，已随房终结）、一间不重演（W38S56，因为 `cap` 大 ⇒ 绝对值预留 200 只占 11%）。⇒ "低容量房专属"这句话从此有据，不再是推断。
> ④**补40⑦(b) 顺带捡到一次真战事**：W38S56 被入侵，塔连开 5 拍把目标 `hits` 从 ~1,400 打到 ~200 并清除（`TowerVolley` 载荷列序 `[firedCount,x,y,healParts,floor(hits/100)]`）⇒ 这是 §1"自主防御"的**第二个定量样本**；而 `situation.adversaries={}`、`conditions=[]` ⇒ **打了一仗、按人敌意那一列仍是空**（既有缺口的战事对照）。同窗两条 `CreepDeath natural=0`（W37S58，age 44／496）⇒ 战损还是回收**不可回溯**（分类只在死亡当拍判）。已写进 §1 行。
> ⑤**未读成事的两件（诚实登记）**：`spawnRejects` 在 W38S56 是 lifetime 六键、**没有 boot 基线** ⇒ 本轮只当形状读、没换算速率；`每房 CPU {W37S58:3.507, W38S56:2.072}` 与 `合计=6` 是**单拍样本**，不能拿去和 `cpuRate.total`（万拍均值）比 ⇒ 我没做这个比较。
> ⑥**下一轮（R181）读什么**：a) `cpuRate.total` 是否开始下移（**这是 #136 唯一需要复采的列**，预报时刻 ≈22:0xZ~24:0xZ 窗口才滚完，所以 R181 大概只看到"开始降"而不是"翻档"）；b) `失守待清=[W38S58]` 与那 25 个键/3 条请求是否终于被摘（若几轮都不动 ⇒ #135 从"待清"升为"没人清"，要重开一次设计问）；c) 两房格局下 `Blocked` 是否仍是 `G4+G6`（G4 会不会随幼房净流脉冲自己翻绿）；d) 入侵后续（`EnemyCleared` 之后有没有第二次进犯、`posture` 何时离开 `fortify`——`minDwell=1000` 那条有界自解）。⚠️我此前挂在 W38S58 上的一切判据仍按"对象已消失"作废，不许回锅。
>
> ★★★★★**R179 补40（10-05 11:1xZ–12:0xZ）第三次扩张房 W38S58 在 83,444,422 归零失守——本服"RCL1 的 `ttd` 到 0 会怎么走"这件我从没验过的事，本轮被同轮采样器逐拍见证到了，而且 F1–F4 四条预报里三条命中。**
> ①**归零形状（命中的那一发）**：`83,444,412` 仍 `level=1|my=true|ttd=10|progress=13,132` ⇒ `83,444,458` 已 **`0|false|undefined|undefined`** ⇒ **RCL1 的 `ticksToDowngrade` 到 0 ⇒ 等级落 0 ⇒ 同一拍失控**，没有保级带、没有 SafeMode、没有"止步于 1"。归零点＝**83,444,422**，与我从 R176 起连读十次的 ttd 计数**逐拍吻合**（R177 结案时是 2,282）。⚠️补25 那句"会怎么走我没有验过、不许替它补故事"到此结清：**答案就是立刻失守**。
> ②**系统自己的出口是够的**（这是本轮最该记下的一件好事）：失守后 observe 现读 `领土 失守待清=[W38S58]`、`扩张Plan W38S58=CANCELLED`、`扩张 allowed=true`、`Blocked` 从**四道**（G0+G2+G3+G6）翻成**两道**（G4+G6）、姿态由 `develop` 变 `expand`、`Memory.creeps` 里 W38S58 的家记录被清（人口 home 只剩两房）。⇒ **G0/G2/G3 三道闸此前是被这间幼房按住的**（房没了三道同时绿）——这是 #122/#132 那族"幼房拖住扩张"的量级反证，比我任何一次推理都硬。
> ③**任务 #34 结案（车道归属）**：`83,444,095` 抓到在飞请求 `hauler:W38S58:0 / priority=2 / replaceBy=有 / correlationId=无 / body=6 件` ⇒ **替补线**（`demand.ts:1169` 的 P2 + `:1193` 的 replaceBy 唯一写者）。更妙的是 `83,444,321` 同一队列里两条同角色请求 **6 件(＝300) 与 4 件(＝200) 并存**，同房、同道、只差创建拍 ⇒ **补39③ 的"创建拍按 `energyAvailable` 定价、孵化在后来拍付款"从推论升成免费对照实验**。
> ④**第三个生产者现形**：`83,444,412` 队列新出现 `upgrader:W38S58:2 / priority=1 / replaceBy=无 / 3 件` ⇒ 需求道，且它抬 P1 的条件在代码里写死了：`demand.ts:998 hasDowngradeRisk ? 1 : 2` ⇒ **保级风险确实触发了自救出口**（P1+recovery ⇒ `spawn-manager.ts:517` 允许降级速出），只是到场比失守晚 ≈10 拍、且 `eav` 已不再供给。**别读成"没有出口"，要读成"出口在最后 10 拍才拿到优先级"。**
> ⑤**1C1M 一家子的整个生命周期读完了**：泵替补成功（旧泵按预报死在 ≈83,443,833，新泵 ≈83,443,84x 出生接上，间隔 ≈10 拍）；两只 1C1M hauler 死在 83,444,114／83,444,214 ⇒ **此后房内 0 只 hauler、0 只 builder、`eav` 归 0**，而 0 只活 hauler 意味着替补线不可能再投 ⇒ 最后 ≈240 拍无人运输。⇒ **#122 的 ×0 覆盖面到此有了 hauler 这一半的证据**（此前只证到 builder）。
> ⑥**新案 §3.5 #135**：失守后三处陈旧态（`Memory.rooms` 仍含 W38S58 且里面 3 条 `spawnQueue` 请求的 TTL 还在倒数；`expansionPlans` 同房并存 `CANCELLED` 与 `EVALUATED`；**`Memory.kernel.expansion` 被整枚抹掉** ⇒ CP3/CP4 的历史与 `checkpointsPassed` 无处可查，证据是 P3b 那一发在 `e.state` 处断成的 `TypeError`）。同条还写清**作用域变更**：#120/#122/#127/#132/#133/#134 的现场对象房已消失，机制本身通用（任何 `cap` 低＋预留绝对值高的房都会重演），判据一律改挂 W38S56 或下一间新房，**不许再挂 W38S58**。
> ⑦**下一轮（R180）读什么**：a) `失守待清=[W38S58]` 是否被摘干净（`LostRoomPurge`/远矿 op/contracts 的清理链）；b) 两房格局下 `Blocked=G4+G6` 的 G4 与候选（`Candidates=11(Q=2,R=6,U=3)`、`Top=W37S56 WAITING_EXECUTION ready≈131,111t`）——**注意第三次扩张的教训直接把下一个瓶颈推到"幼房 RCL 起不来"这件事本身**；c) W38S56（RCL5、`state=normal`、`queue=0/0`）是否有 #132/#134 同型（它 `ec=1,800` 所以预留 200 不构成刀锋，预期**没有**——这本身就是对本族机制的一次否证性检验）；d) 我此前挂在 W38S58 上的所有判据一律按"对象已消失"作废，不要去找它们。
> ⑧**goal 状态要说清（属人）**：本轮之前的 objective 是"见证 CP4 到手"。失守 ⇒ `extensions.length≥5 && containers.length>0` 与 `integrating` 那两键**按构造永不到场**（target 与状态对象都没了）。goal 仍留 `blocked`，我不动它的状态、也不标 complete；**要请人拍的是：撤掉这条 objective，换成"两房格局下的下一条主线"**。
> ⑨口径附带：拍长本轮实测两个值——observe 自报 **2.66 s/拍**（10 拍样本）与按 945 拍粗算 **≈3.4 s/拍**，且 11:5xZ 后一度 **25 秒不推进**（observe 打"不可测"）⇒ 一切 ETA 写区间；同轮采样器第一版表达式 **928 字节被引擎拒**、**807 字节通过** ⇒ 上限在 (807, 928]，挂循环前先单发试跑。
>
> ★★★★★**R178 补39（10-05 10:1xZ）运输道自己回来了——但回来的是三只 1C1M 残废 body；这给 #132 补上了第二个出口，也把两把互相矛盾的闸立成新案 #134。**
> ①**补38⑦(a) 命中**：`skipReasons["spawn/churn/hauler/expired"]=2`（`prevSkipReasons` 同键也＝2）⇒ 两条 hauler 替补请求（83,442,517／83,442,608）确凿**到期未孵**；P9 那发读空是"事件还没到"，预写的这句兑现了。
> ②**但 hauler 回来了，所以补38⑤ 的推论撤一半**：`hauler-W38S58-0-83442609-1ej` 与 `hauler-W38S58-1-83442709-1em` 在世，**本体都＝1C1M（cost 100）**；泵 `distributor-...-83442333`（1C1M）也在世；队列 `q=""`（P1）＋observe `queue=0/17`。⇒ "**没有**人投 hauler"是错的：有人投了、也孵出来了。仍成立的两半：①替补线当时不可能投（0 只活 hauler ⇒ `needsReplacement` 无对象）⇒ 请求只可能来自**需求道**（`demand.ts:1105`）或 **recovery 道**（`recovery-execution-system.ts:786`，P1）；②到期计数器是真的。⇒ **车道归属未定**，判别式现成：`recoveryCorrelationId` 有＝recovery 道／`replaceBy` 有＝替补线／两者都无＝需求道（本轮队列已空，抓不到在途请求 ⇒ 只能等下一发）。
> ③**#132 的作用域再补一格（这一格才是它的完整形状）**：`createRequest`（`demand.ts:1225-1239`）在 `colonyState==="recovery"` 时按**创建那一拍的 `energyAvailable`** 定 body，而孵化在**后来的拍**付款（`spawn-manager.ts:420/485`）⇒ **定价拍与付款拍错配**，body 大小就决定了它从哪个出口出来：100-cost 的（1C1M）能在"预留开着、`eav` 满到 300 只剩 100"那一拍出来（本窗 3 例：83,442,333／609／709）；200-cost 的只能在**预留关着**的那一小段出来（本窗 2 例：83,442,829／941 两只 upgrader）。⇒ **"孵不出"不是恒态，而是"只能以最小 body 出来"的循环**，节拍器就是 TTL 1,000 拍的到期-重投。
> ④**新案 §3.5 #134（两把闸互相矛盾，且现场正在付账）**：`starvationDegradeFloor=300`（`config/index.ts:217`，注释原文就点名"无地板会铸出残废 body（如 **1C1M distributor**）…其存活整个生命周期 ⇒ 吞吐塌方 ⇒ 自强化回路"）对 `spawn-manager.ts:544-548` 的 `survivalPath` **在 bootstrap/recovery 整条豁免** ⇒ 本房正在铸的三只全是 1C1M、各活 1,500 拍；而即便不豁免，`300 > eav−reserve` 的最大可能值 100 ⇒ **地板在 `cap=300` 的房里按构造不可满足**。出口属人（改地板／让预留按容量比例化／收窄豁免面），本轮不动、只摆数。
> ⑤**#33 用正规读法拿到了（同拍配对，不跨发比）**：`R178P3@83,443,078` 一发之内 `economyPressure=0.179166 | drainScore=14.333 | liquidityScore=0 | phase="recovery" | phase.reserve=4,157` ⇒ 公式忠实（`14.333/40×0.5`，`midpoint=40/range=60`＝`config/index.ts:579-583`），压力来自 **drain 维度**；⚠️三发之间 pressure 在 **0 ↔ 0.179 跳**（P2@83,443,018 的分数＝0/0）⇒ 它是逐拍量、不是慢积分 ⇒ **`pressure>0.5` 那道 P2 门整窗没开**。顺带又撞到 #132 的"同名仪器提醒"：`phase.reserve=4,157`（＝#120 那条天花板量，对 ≈4,300）与 `economy.cr=0` **不是同一个量**；`bk.spawned=200` 恰＝两只 1C1M hauler 的成本和。
> ⑥**我自己的 off-window 算术错在哪一格，定住了**（已就地更正 #132 那条）：我把名字里的拍当出生拍，而 `ticksToLive` 从**孵化完成**起算（`spawnTime=body.length×3`）再叠 `replaceBuffer=15` ⇒ 昨天那三个 `replaceBy − createdAt = 33`＝`6×3+15` 就是这么来的。修正后本窗两次 200-cost 孵化都落在预测带内。
> ⑦**下一轮要读的（都不必造条件）**：a) 队列里若再出现 `hauler:W38S58:*`，同拍读 `priority`/`recoveryCorrelationId`/`replaceBy` 三列 ⇒ 定车道；b) 两只 1C1M hauler 的死期＝**83,444,109／83,444,209**（名字拍+1,500）⇒ 它们死前 `eav`／`ea` 是否回升（1C1M 每趟运力只有 50）、死后是否又走一遍"到期-重投"；c) 死线 83,444,422 比 b) 只晚 ~200 拍 ⇒ **R179（≈11:1xZ）大概率仍读 `level=1`，那不是否证**，判归零形状要到 R180。
>
> ★★★★★**R177 补38（10-05 09:3xZ）运输道塌了一次、靠自己回来了，而它回来的那一拍正是 #132 预写的"差 100 能量"；hauler 那一半则按构造错过了自己的窗口。**
> ①**塌的现场**：`R177P1@83,442,140` 队列三条**全是替补线**（三条都带 `replaceBy`、priority 全 2、无 `recoveryCorrelationId`）＝`hauler:W38S58:0`（createdAt 83,441,517／replaceBy 83,441,550）、`hauler:W38S58:1`（83,441,608／83,441,641）、`distributor:W38S58:0`（83,442,086／83,442,113）；三个 `replaceBy` 对得上补37① 名单里那三只的出生拍 **+≈1,51x**（83,440,033／83,440,124／83,440,602）⇒ **恒 1500 拍寿命**与**替补线在死者还活着时就投请求**两条同时成立。编制 8→6：hauler 2→0、distributor 1→0。
> ②**卡住的形状被计数比值钉死**（`spawnRejects` 同形状两发 `P5@83,442,265`→`P6@83,442,369`＝104 拍）：`degradeGateClosed +198`＝**1.90/拍 ≈ 两条 hauler 每拍一次**、`noDegrade +67`＝0.64/拍（泵在 P5→P6 之间离队，P3→P5 那 62 拍是 1.00/拍）、`budget+reserveOnly`＝2.55/拍（对得上"3 条→2 条"）、`floor=0`（`:544-548` 的 recovery 豁免，本来就不该涨）。
> ③**价格表定住了**：`bodies.ts:1634-1643 PART_COST={move:50,work:100,carry:50}` ⇒ hauler `3C2M`=**250**、distributor `2C2M`=**200**、最小合法泵 `1C1M`=**100**；而 `recoveryEnergyReserve=200`（`config/index.ts:205`）对上现读 `energyCapacityAvailable=300`（`R177P4`）⇒ **预留吃满池子的 2/3，剩下的刚好只够最小泵，且必须池满才够**。
> ④**执行证明**：`distributor-W38S58-0-83442333-1ee` 本体＝**1C1M**（降级产物）⇒ 那一拍 `pumpOutage`（`:514`）开着、`degradeBody` 成功 ⇒ `eav−200≥100` ⇒ **`eav` 当时＝300＝本房天花板**。⇒ #132 的"差 100 能量就能开"**当场兑现**，且开法只有一种：池子满到天花板那一拍。⚠️这同时**否掉了我准备预报的"等 off-window"那条更宽的路**——本次是在预留**开着**时出来的（两只 harvester `ttl=112/365` 均 <`replacementHorizonTicks=600` ⇒ 条件 3 为真）。
> ⑤**hauler 那一半**：`retries` 全程 0 ⇒ 从没走到 `:563` 的"body 超容量"（`cost>effectiveBudget` 在上游就 `continue`）；`expiresAt`＝**83,442,517／83,442,608**＝本轮结案前就到期未孵。按名字算出的 off-window＝**[83,442,751, 83,442,944] ≈193 拍**，**晚于两条的到期** ⇒ 问题从"孵不孵得出"移回"**还有没有人投 hauler**"：替补线要求有活着的同角色 creep，房内 `hc=0` ⇒ 只剩需求道（＝#122 那一侧）。`economyPressure` 现读 0（三次：P3/P4/P6），写者 `room-state.ts:288` 取 `max(drainScore, liquidityScore)`——**要判它为何是 0 得先读那两个 phase 分数，本轮没读，不许写成"信号失灵"**。
> ⚠️**R178 补39 就地更正本条⑤（撤的是"后果"那一半，不是计数器）**：`spawn/churn/hauler/expired=2` 已兑现（到期未孵是真的），但"⇒ 问题移回还有没有人投 hauler"**不成立**——两只 hauler 在 83,442,609／83,442,709 被**投出来并孵出来了**（本体 1C1M）。⇒ 本条的正确说法是"**到期-重投循环**：请求以创建拍的液体能量定价、在后来的拍付款，付不起就到期换新，换新后以小 body 立刻孵出"，而**不是**"没人投"。真正待答的变成**车道归属**与 **1C1M 的运力代价**（见下面补39 ②④⑦）。
> ⑥**#133 拿到现场执行证明**：期望自检报 `siteStaleWorkerIdle:W38S58:×3 张 extension 工地 workers=6 noProg=8,200~10,298`，而名字级花名册（`R177P7@83,442,386`，逐只带本体）＝harvester×3（2W/1W/2W）＋upgrader×3（各 1W）＋distributor×1（**0 WORK**）⇒ **带 WORK 的确实 6 只、builder 0 只**。分桶说"有人在场不推进"，真相是"在场的人没有一个会建"。工地进度和 286+2,506+0＝**2,792** 与补25/补37 同值＝第 N 次零施工。
> ⑦**下一轮要读的三件（都不必我造条件）**：a) `Memory.kernel.skipReasons`/`prevSkipReasons` 里 `spawn/churn/hauler/expired` 是否开始计数（`R177P9@83,442,418` 现读为**空**＝事件还没到，别读成仪器坏了）；b) 队列是否重新出现 `hauler:W38S58:*`（出现＝需求道活着，不出现＝#122 的 ×0 覆盖 hauler 而不只 builder）；c) 死线 83,444,422 的归零形状——剩 2,017 拍、拍长 3.5~4.5 s ⇒ **落在 ≈11:3xZ~12:0xZ，R178/R179 读到 `level` 仍=1 不是否证**。⚠️补37⑥ 第③件（`development` 节点）本轮先判了"能不能读"：`Memory.kernel` 无失败图键、`escalations` 只在该链**升级**时落条目（现读 3 条＝`colony/population_rebuild×2, mineral/terminal×1`）⇒ **读它要走 heap 或 `SUBMITTED development_resume` 日志行，别再翻 Memory 键**。
> ⑧免费复证：container `hits`＝200,000/200,000（补1⑥ 基线 195,000/200,000）⇒ 已修回满，那条"≈4 小时归零"本窗不成立；⚠️`hitsTotal` 本服读回 **undefined**。CP4 四列无沿；`failedGates`＝**G0+G2+G3+G6**（四道，与 R176 同）。
>
> ★★★★**R176 补37（08:1xZ）本轮把 #132 与 #122 的**当前咬合力**排了个序：此刻挡住房子的不是孵化路径，而是"没人投 builder"。**
> ①**现场（`R176P1@83,441,162`／`R176P2@83,441,170`）**：`spawnQueue` **空**（q=0）；编制 8 只**全部出生在 ≈1,150 拍之内**——`upgrader 83,440,024 / hauler 83,440,033 / hauler 83,440,124 / harvester 83,440,233 / distributor 83,440,602 / harvester 83,440,987 / upgrader 83,441,047 / upgrader 83,441,128`；账本 `spawned` 4,680→**8,530**（+3,850／4,588 拍）；**`skipReasons` 本 500 拍窗内 `spawn/churn/*` 一条都没有**（ch=NONE-in-window）⇒ **近期没有任何请求到期未孵**。⇒ 结论：**"work 类孵不出"这件事今天没有在发生**（work 类的 upgrader 连着孵出 3 只、非豁免的 hauler 孵出 2 只）；builder 之所以缺席，是因为**根本没有请求被投出来**（#122 的 ×0／补28 的重启锁），而不是 #132 的预算地板。
> ②**#132 的作用域据此再降一格（就地标注）**：它的算术与夹具仍然成立（预算 100 < work 类地板 150/200，hauler 恰好 100），但它是**"预留生效期内"的周期性阻断**，而现场显示 off-window 出现得足够频繁、能把整条队列清空。**当前对 CP4 的实际咬合力排序＝ #122（不投）> #132（投了也可能等一阵）> #127（孵出来又不干活）**。这条排序很重要，因为它是"先修哪个才让工地重新动"的答案：**先让 builder 被投出来**。
> ③**补35 ③ 的预报转为"已被更强的路径抢先实现"**：`economyPressure` 由 0.4 回到 **0**（没越 0.5 ⇒ 那条预报既未验证也未否证，记"未到期"）；但 hauler 已经靠 off-window 孵出两只 ⇒ 我原先设想的"pressure>0.5 才救回 haul 线"不是唯一路径，**它的实际价值下降**，不撤但降级为备用判据。
> ④**#127 又添一次实付**：这轮孵出的 3 只 upgrader 全属被 `kernel.ts:988-1003` 冻掉的编制 ⇒ 它们接下来会以 ≈3/拍贡献 `skipReasons["creep/upgrader/colony-state"]`。**注意这条与 ① 是同一枚硬币的两面：孵化通道活着，干活通道是关的**——所以"房在花钱孵不能干活的人"这件事，从今天起不能再被解释成"孵不出来"。
> ⑤**常规现读**：`failedGates`＝**G0+G2+G3+G6**（四道，与上轮同）；CP4 四列无沿（`economic_startup/cp=3/LET=undefined/CPT=0`）；`colonyState="recovery"`；`ttd=3,252@83,441,170` ⇒ RCL1 归零 **83,444,422**（第六次同值，≈3.5 h 后）；E7 的 `2,506/3000` 那张 `noProg=7,237` ⇒ 上次施工 **83,433,911**（第四次同值＝前任 builder 死期 83,433,927）。
> ⑥**覆盖交接**：`r164-queue`（pid 77019，600 s×72）将在 ≈08:3x 自然下班，而这次死线在 ≈11:4x ⇒ **由每小时轮次现读接管**（我不新建表）。要读的三件：`controller.level/ttd` 的归零形状、`builder:W38S58:*` 是否终于被投出来、以及 `development` 节点是否在 83,444,421 之后出现（补34 ①② 的唯一自然复证机会）。
>
> ★★★★**R175 补36（07:2xZ）我在 #132 里给出的"最便宜的杠杆是出口③"是错的——跑了一遍纯函数才发现。真实地板＝150，不是 100。**
> ①**做法**（我记过的"现场转不动就跑本地夹具"那条）：临时 vitest 文件直接调 `degradeBody`，四臂，即写即跑即删、未 stage、未碰 dist。第一版我按自己的推断断言"`requiredParts=[work]` ⇒ 预算 100 出 `work`"——**该臂失败（expected undefined to be defined）**，其余三臂过；于是改成"量"而不是"猜"，重跑 4/4 通过。
> ②**测到的地板（预算＝池 300 − 预留 200 ＝ 100）**：
>
> | 角色 / `requiredParts` | 预算 100 | 预算 150 | 预算 200 |
> |---|---|---|---|
> | hauler（`["carry","move"]`，现读 6 件 body） | **出**，cost 100 | — | — |
> | work 类，默认 `["work","carry","move"]` | 无 | 无 | **出**，cost 200 |
> | work 类，假设补成 `["work"]` | **无** | **出**，恰为 `work+move`＝150 | — |
>
> ⇒ 第三列那一格就是我错的地方：`bodies.ts:1754-1758` 的 **MOVE 配比守卫**（`move ≥ ceil(nonMove/2)`）在只剩 `work`＋两件 move 的形状下**不允许再砍 move**，所以即便补了 `requiredParts` 条目，work 类的真实最小合法 body 是 `work+move`＝**150**，而不是我以为的 `work`＝100。**150 > 100 ⇒ 出口③单独解不开这房**（它只把地板 200→150，把每次孵化的能量代价砍半，属于第二步优化）。
> ③**因此 #132 的排序要重排（两处已就地更正）**：真正能把预算抬到 ≥150 的只有两根杆——**池子**（回 RCL2 落 extension，`ec` 300→350…实际要 ≥450 才让"池−预留 ≥150"稳稳成立，取决于预留是否随规模变）或**预留本身**（`recoveryEnergyReserve` 200→≤150，属"改安全预留"那类，协议要我摆数请示、不许自办）。出口③仍值得做，但**不能写成"不动安全额度就能解闸"**——那是我上一条的错误卖点。**⚠️R176 补37 ② 再降一格（本条的当前咬合力排在 #122 之后）**：`R176P1/P2@83,441,16x` 现场是队列清空、work 类 upgrader 连孵 3 只、非豁免 hauler 孵 2 只、`spawned` +3,850／4,588 拍、本 500 拍窗内 `spawn/churn/*` 为零 ⇒ **"孵不出"此刻没有在实际发生**；builder 缺席的直接原因是**没有请求被投出来**（＝#122 的 ×0／重启锁），不是本条的预算地板。⇒ 判"先修哪个才让工地重新动"时按 **#122 > #132 > #127** 排。补35 ③ 里"不对称由默认 requiredParts 造成"这半句只对"200 vs 100"这一步成立，也一并标注。
> ④**顺带立一条方法论（已进长期记忆）**：**在向人推荐"哪个杠杆最便宜"之前，先把那个杠杆的判据跑成夹具**——这次涉及的是纯函数（`degradeBody` 无 Game 依赖），成本是"一次写文件＋一次 vitest 单文件"，收益是拦下一条会被拿去排产的错误建议。**失败的那一臂比通过的三臂值钱。**
>
> ★★★★**R175 补35（07:1xZ）三件：改一处我自己上一轮说过头的措辞、捡到一把能直接数"请求到期未孵"的仪器、以及给 #132 补上一条可证伪的**角色不对称**推论。**
> ①**更正（就地已标在补34 ③）**：我上一轮写"W38S58 的 `population_rebuild` 已烧穿（terminal）"。语义读回来是：`terminal` **只终结单条链**，`recovery-lifecycle.ts:102-108` 的规则②明写"表中有但状态为 succeeded/failed/terminal ⇒ **可以重新创建（新周期）**"。实测见证：同一条 escalation 的 `repeats` 从 15 涨到 **16**、`lastAt=83,440,232` 距我读数（`R175P1@83,440,257`）**只有 25 拍** ⇒ **恢复机一直在为这房重开链条，不是放弃了**。补34 那一句里"缺的不是出口，是出口作用域里没有 builder 这一类"仍然成立（`population_rebuild` 的动作臂只投 harvester）。⇒ 教训（进长期记忆）：**看到 `terminal:true` 就说"烧穿/放弃"是把"链级状态"读成了"房级状态"；判放弃要么找到房级熔断键，要么拿到 `repeats` 不再涨的第二个样本。**
> ②**新仪器（正好补上我前几轮只能靠差分推断的那格）**：`skip(500t)` 里出现 **`spawn/churn/hauler/expired=1`** ⇒ "请求到期未孵"是**按角色分别计数**的，键形如 `spawn/churn/<role>/expired`。⇒ 重启锁这个问题从此有可直接引用的读数：`spawn/churn/builder/expired` 若出现即"builder 请求再次到期未孵"的现场证据。⚠️口径：这张表仍是 **500 拍滑窗**（`memory.ts:252-254`，我 R168 补21 已为此撤过一次速率推导）⇒ **"键不在"只说明本窗内没发生**，83,434,900 那次 builder 到期早已出窗，所以此刻读不到它属正常，别拿它当反证。
> ③**给 #132 的角色不对称（可证伪，已写进 #132）**：`economyPressure` 现读 **0.4**（几轮以来首次离开 0），而 P2 请求的降级逃生口要 `waitTicks ≥ body.length×3×10` **且** `economyPressure > 0.5`（`spawn-manager.ts:513`）。两侧的角色地板不同：`ROLE_REQUIRED_PARTS.hauler=["carry","move"]` ⇒ 最小合规 body＝100＝**恰好等于**"池 300 − 预留 200"；而 upgrader/builder 没有条目 ⇒ 走默认 `["work","carry","move"]`＝200 > 100（`bodies.ts:1732`＋夹具四臂已证）。又因 recovery/bootstrap 豁免 `starvationDegradeFloor`（`:544-545`），**没有别的闸挡它**。⇒ **预报：pressure 一旦越过 0.5，haul 线会自愈（孵出 2 件小 body），builder/upgrader 仍孵不出**；否证位＝若 pressure>0.5 且 hauler 请求仍持续 `spawn/churn/hauler/expired` 而不孵化 ⇒ 我把这条链读错了，回来重读 `:513` 与地板推导。〔**⚠️本句后半"不对称是默认 requiredParts 造成的，不是预留数值造成的"只对一个方向成立——R175 补36 跑夹具量出：补 `requiredParts` 只把地板从 200 降到 150（MOVE 配比守卫不允许再砍），仍高于预算 100 ⇒ 单靠它解不开闸，见补36 与 #132 同处的更正**。〕
> ④**本轮常规现读**：`failedGates`＝**G0+G2+G3+G6**（四道，与上轮同集合）；CP4 四列无沿（`economic_startup/cp=3/LET=undefined/CPT=0`）；`lvl=1`、`ttd=4,165@83,440,257` ⇒ 归零 **83,444,422**（第五次同值，≈1.9 h 后）；E7 的 `2,506/3000` 那张 `noProg=6,327` ⇒ 上次施工 ≈83,433,911（＝前任 builder 死期，第三发同值复证）；`ea=131/ec=300`、`roomTotal_rs=4,191`、`pressure=0.4`、`phase_ph` 由 2 变 **3**（colonyState 仍 recovery ⇒ ×0 不变）。
>
> ★★★★★**R174 补34（06:1xZ）任务 #31 结案，并且答案比我预想的更硬：**这房唯一现成的自救出口被它自己要救的那次降级重新上了膛，因此出口与失控几乎同拍。****
> ①**`development` 从未为 W38S58 触发（三条独立见证）**：heap `failureGraph` 7 个节点里唯一的房级节点是 `colony:W38S58`，**没有 development 节点**（`R174P2@83,439,334`）；队列里 `upgrader:W38S58:1`（`createdAt=83,438,450`）与 `:2` 的 `memory` 都是 `{role,home,mode:"acquire",spawnIndex}`——**没有 `recoveryCorrelationId`**（`peek@83,439,4xx`）⇒ 那两个 index-1 形状是需求道的循环产物，不是恢复道（恢复道必打 `recovery-execution-system.ts:806` 那个键）；算术门也一致：`controllerProgressChangedAt=83,434,421` ＋ `E5_STALE_TICKS=10,000`（`expectations.ts:85`，`empire-health-system.ts:436-451` 的触发体）⇒ **首次可触发 ≈83,444,421**。
> ②**最关键的一条：那个锚点是被降级自己挪的。** 补25/补30 已证 `progress` 在降级那一拍由引擎重基 ＋180（12,952→13,132、`upgraded` 随后也记成 180）⇒ `room-state.ts` 的"progress 变了就前移锚点"照实执行 ⇒ **停摆计时被这次降级清零重启**。而 RCL1 的降级容忍恰好也是 10,000 拍（现读 `ttd=5,077@83,439,345` ⇒ 归零 **83,444,422**）⇒ **自救出口的可用时刻与失控时刻相差 ≤1 拍**（同一个起点 83,434,421、同样长的 10,000）。⇒ 这不是阈值之争：在 RCL1 这一级，"停摆阈值＝该级降级容忍全长"是结构性重合。
> ③**"这房不是没人管"这一点要如实补上**：`Memory.kernel.escalations[0]`＝`W38S58 / colony / population_rebuild / attempts=2 / terminal=true / last=83,438,512` ⇒ 恢复机在这房是**活过并已烧穿**的〔**⚠️这句措辞过头，R175 补35 已改正**：`terminal` 只终结**单条链**，`recovery-lifecycle.ts:106` 明写"状态为 succeeded/failed/terminal ⇒ 可以重新创建（新周期）"；实测 `repeats` 15→**16**、`lastAt=83,440,232` 距我读数仅 **25 拍** ⇒ 它一直在重开。准确说法见补35 ①〕；而 `population_rebuild` 孵的是 harvester（本文件 10-01 段第②条写明不复用它正是因为这个）⇒ 与现场"只有采集角色孵得出来"完全一致。**所以缺的不是'有没有出口'，是'出口的作用域里没有被 builder 这一类'。**
> ④**给 #133 选项③的直接回答（我已就地标注）**：把这类停摆"交回既有 development 失败图"在 RCL1 上**来不及**——要么它先于降级触发（需要锚点不被引擎重基挪动，属仪器语义、不是降阈值），要么就得承认这一级无解。若将来它真触发：builder 臂**满足条件**（`:782` 只要 `buildQueue>0`，现读 17），且它用 **P1＋index 1＋带 `recoveryCorrelationId`**（`:786/:799/:806`）⇒ 判别签名是队列里出现 `builder:W38S58:1 … rid<非none>`；但按 #132 它仍会在预留生效期落进 `noDegrade`（预算 100 < WORK 地板 200）⇒ 届时要读的是"该条目出现后 `spawnRejects.noDegrade` 是否仍每拍 +1"。
> ⑤**其余现读（本轮）**：`failedGates` **G0+G2,G3,G6（四道）**——上一轮的五道里 G4 又翻回绿了（**这就是每轮必现读的那条**，两轮分别抓到一次翻红一次翻绿）；CP4 四列无沿 `economic_startup / cp=3 / LET=undefined / CPT=0`；`lvl=1`；编制 5；E7 免费给出逐工地进度年龄：被 builder 建过的那张 `2,506/3000` 已 **`noProg=5,373`**（其余三张 7,471），而 5,373 拍前正是 **83,433,95x**＝前任 builder 的死期 83,433,927（**独立复证我 R168 补18 的施工时间线到 ±30 拍**）；`Memory.kernel.escalations` 另两条：`W38S56/colony/population_rebuild t=true last=83,369,862`、`global/mineral/terminal_trade att3 t=true last=83,439,032`。
> ⑥**通道纪律（本轮踩到并处理正确）**：`R174P4` 那发 console **连接超时**（`UND_ERR_CONNECT_TIMEOUT`）⇒ 按口径"超时≠没跑、不追 `__evalResult`、不连发第二发"，改走 peek 拿到同一批字段（`recoveryCorrelationId` 的正证来自 Memory 侧，不是靠重试）。
>
> ★★★★**R173 补33（05:1xZ）本轮的"新事实"不是又发现一把锁，而是：**这桩停摆早在 bot 自己的期望面上挂着，只是被错标桶＋被设计静音＋无人消费**。新立 §3.5 **#133**（属检测质量，要动 src ⇒ 属人）。**
> ①**E7 已经报了 6,542 拍**：`期望自检@83438355` 列 W38S58 四条 `siteStaleWorkerIdle`（含 extension `286/3000`、`0/3000`，`noProg=6,542 workers=3`）。但我 `R172P4` 实测**全帝国 builder=0** ⇒ 那 3 个 "workers" 是 2 只 harvester＋upgrader。实现 `kernel.ts:714-723` 数的是"房内任何带 WORK 部件的我方 creep"并写明"**不按 role 筛**（远矿路是通勤 hauler 建的）"，而同文件 `:697` 的注释却说它是"我方 **builder** 的实时数量"——**注释与实现相互矛盾，实现是有意为之、注释是旧的**；顺着注释读会以为这房 workers 该是 0。桶的语义（`expectations.ts:493-494`）把 `WorkerIdle` 定义成"人到了不推进 ⇒ 查能量/射程/取活"，而本房真因是**没有 builder 这个角色**（×0 起步锁＋P2 排序＋#132 预留期）⇒ **照读数去查会白查三轮**，我这五轮的手工考古正是它的替代成本。
> ②**两处让这类停摆不会自动浮起来**：E6 `buildQueueStale` 在 `colonyState∈{recovery,bootstrap}` **故意不报**（`expectations.ts:468-478`，注释称误报保护）——而这房已在 recovery 里 ≈3.5 小时；且 `:485-486` 自陈"违例清单在 `src/` 内**没有任何按 id 的消费者**"⇒ 分桶修对了也不触发动作。#133 里把三个候选出口列成选择题（拆 `builderCount`/`workPartCount`、加 `siteStaleNoBuilder` 第三桶、或把这类停摆交回既有 `development` 失败图——**第三项要先问"为什么 `development_resume` 没为 W38S58 触发"，本轮未查**）。
> ③**口径第三次生效（也是上一轮那处错误的正面回执）**：`failedGates` **现读＝G0+G2+G3+G4+G6（五道）**——上一轮的四道不成立，**G4 已翻回红**（netFlow 那条慢 EMA 随幼房脉冲摆动，正是本文件"别把任何一天的集合写死"的那条）。上一轮我把继承值写成"现读"被抓过一次，这轮先读再说。
> ④**其余现读（无沿）**：CP4 四列 `state=economic_startup / cp=3 / LET=undefined / CPT=0`；`lvl=1`、`ttd=6,014@83,438,408` ⇒ RCL1 归零 ≈**83,444,42x**（与补25/补30/补32 三次复算同值）；W38S58 编制 6、`ea=300=ec`、`roomTotal_rs=4,406`（对结构上限 4,300＝第 7 次复证 #120 天花板，`ext` 仍 0 ⇒ 不需重算）；`netFlowMean_d` 由 −6.5 转正 ＋5.8；`r164` 表第 50-52 发队列仍只有 `upgrader:W38S58:2` ⇒ **builder 键自 83,434,900 起从未再现（≈3,500 拍）**。
>
> ★★★★★**R172 补32（04:1xZ）我把上一轮的"准恒锁"说过头了——现场直接否证；同时任务 #30 有解（而且解得很干净）。这一条是给 #132 降温用的，读 #132 必读本条。**
> ①**否证读数（`R172P1@83,437,467`）**：编制里出现 **`upgrader-*-83436742-19r`（t783）＋ `upgrader-*-83436942-19y`（t983）＋ `hauler-*-83437442-1ai`（t1480，25 拍前刚孵）**，账本 `spawned` 从 4,680 涨到 **5,580（+900）**，而队列里 `upgrader:W38S58:2` 现在是**新实例** `createdAt=83,436,943 / body=work-carry-move`（3 件、200 能量）。⇒ **非豁免角色（upgrader/hauler）在这 900 拍里孵出了三只** ⇒ 补30 ② 那句"准恒锁／别指望 off-window（≤3.8% 占空比）"**作为一般陈述被推翻**：我那个 613 拍窗只是恰好没赶上 off-window——**小样本判占空比**正是我自己记过的第 4 类错的现场版。
> ②**#132 的正确边界（降温但不撤案）**：预留＋`ROLE_REQUIRED_PARTS` 缺 upgrader/builder 这两件事仍是**真的机制**，夹具也仍成立——但它的作用域是**"预留生效的那些拍里，非豁免角色一律孵不出（预算 100 < WORK 类地板 200）"**，不是"这房孵不出 builder/upgrader"。⇒ 本轮起 #132 的标题里"按构造孵不出"要读成"在预留生效期内孵不出"；三条出口的排序不变（豁免名单／`ROLE_REQUIRED_PARTS` 条目／预留比例化），但**严重度从"锁"降为"周期性阻断＋排序不利"**。
> ③**补26 的"竞速"那半回来了——两头都对，是我在中间把它整个撤错了**：把时间线摆平就不矛盾了。builder 请求活过 `83,433,9xx→83,434,900`（到期未孵），而**同一段里 `hauler-*-83434663`、`hauler-*-83434763` 两只先后孵出**（都是 P1）＋`upgrader-*-83434922` 在 builder 到期前 5 拍开孵 ⇒ 单 spawn＋P1 在前＝builder 一整代轮不到（补26 观察对）；同时预留生效期内的拍，P2/P1 非豁免角色谁都孵不出（补29 算术也对）；**错的是我把后者升成唯一原因**（过头的撤回同罪——这条我也记过）。⇒ 给 #132/#122 的最终表述：**"builder 的 TTL(1,000 拍) 比这房一次孵化周期长不了多少，而它恒为 P2 ⇒ 结构性弱势"才是可动的杆**（改 body 地板/预留只解决"轮到时孵不孵得出"，不解决"排不排得到"）。
> ④**任务 #30 结案（提前离场＝孵化，不是被 purge）**：`upgrader:W38S58:2` 的 `createdAt` 从 83,436,397 变到 83,436,743、再到 83,436,943，每次都**紧跟着一只同角色 creep 的出生拍**（19r 出生 83,436,742、19y 出生 83,436,942，各差 1 拍）⇒ 机制是 `spawn-manager` 在 `spawnCreep` 那拍把请求出队、需求侧下一趟按同 key 重投；而 `cleanQueue`（`queue.ts:161-170`）只在 `retries≥maxRetries` 或 `tick>expiresAt` 时才摘——两次都不是（`retries` 恒 0、离 expiresAt 还 654 拍）。⇒ **一般规则（已进长期记忆）：队列里"同 key 条目换了 createdAt"＝一次成功孵化的签名，不是需求翻转也不是 purge**；用它当"需求稳定性"证据前要先看 creep 出生拍是否同拍跟随。
> ⑤**同轮其余现读**：`failedGates` 现读四道（集合与上轮同）；`lvl=1`、`bs` 仍 2,792、`builder:W38S58:0` 仍无重投 ⇒ 施工仍零；`harvester` 三只轮换（t127/t586/t1183）＝豁免路径正常。
>
> ★★**R171 补31（03:4xZ）一件已确认、一件如实挂着。**
> ①**确认：豁免路径是这房唯一能孵人的路，而且它在正常干活**。`R171P9@83,436,842` 现读队列 3 条：`upgrader:W38S58:2/p1`、**`harvester:W38S58:0/p1`**、`hauler:W38S58:1/p2(rb83436180)`；而 `R171P4` 抓到 83,436,542 有一只 harvester 开孵（账本 `spawned +300` 同拍）⇒ **同池同期：采集角色孵了、WORK 类与非豁免 hauler 没孵**（补30 ① 的对照再复现一次）。`builder:W38S58:0` 现读 **GONE 且从未被重新提交** ⇒ 补28 的"重启锁"在需求侧那一半继续成立（房内 builder 已 **≈1,900 拍为零**）。
> ②**挂着不结案：`upgrader:W38S58:2` 这条请求的"实例号"在 653 拍里换了两次，其中一次是**提前离场**。** 实测序列（每发都带 mark、逐字段读）：`createdAt=83,435,396`（`expiresAt=83,436,396`，自然到期）→ `createdAt=83,436,397`（`expiresAt=83,437,397`；`R171P1@83,436,534` 仍在队）→ **`createdAt=83,436,743`（`expiresAt=83,437,743`；`R171P9@83,436,842`）** ⇒ 第二个实例在自己的 TTL 还剩 **≈654 拍**时就离开了队列，而 `submitRequest`（`domain/spawn/queue.ts:6-22`）对已存在 key 是**原地刷新 `expiresAt`、保留 `createdAt`**（注释自称"TTL 续期"）⇒ `createdAt` 变了就说明它是**被摘掉后重新 push 的新条目**，不是刷新。
  · **能排除的**：不是孵化（那期间孵的是 harvester）、不是自然 TTL、`spawnBlacklist` 不存在／`churnFreezeUntil` 不存在／`spawnStarvationCount=0` 三条隔离-熔断-饿死通道当时都干净、`degradeGateClosed`/`noDegrade` 在那段仍持续增长 ⇒ 它**没走到 `spawnCreep`**，所以也不是"引擎返回码烧 retries"那一支（新实例 `retries=0`）。
  · **不能排除、留给下一发的**：需求侧自己撤的（`cancelRequestsByHome`／角色上下限变化导致 surplus 摘除）还是 `cleanQueue` 的某支——**这两条我都没读完消费方**，所以本轮不下结论；候选判据：若同一 key 的 `createdAt` 每 ≈350~700 拍就换一次而 `retries` 恒 0，那"请求存在"这件事本身就不能当"需求稳定"的证据（对 #127/#132 的读数口径有直接影响）。
  · **为什么不补故事**：这条只影响"请求实例的生命周期"，不影响本轮三条主结论（豁免对照／准恒锁 ≥96.2%／`upgraded` 非独立仪器）——它们各有独立读数。
>
> ★★★**R171 补30（03:2xZ）三件：①任务 #29 的判别跑了完整一轮且**没有越窗**——反而给出一条同拍对照；②把上一条我自己打开的"时开时关漏口"用差分**量出来并收窄**（≤3.8%）；③撤一条我自己写过的"两台独立仪器"——`upgraded` 与 `progress` 是同一个量。**
> ①**同拍对照（本轮最干净的一发）**：`R171P2@83,436,549` 抓到 `Spawn7/**BUSY**`，`R171P4@83,436,564` 编制里多出一只 **`harvester-W38S58-*-83436542-19k`（ttl 1489 ⇒ 开孵拍 83,436,542）**，账本 `spawned` 同步 **+300**（`R171P5`：spawned 4,380→4,680）⇒ 孵的是**采集角色**，而同一时段队列里的 `upgrader:W38S58:2/p1` 与 `hauler:W38S58:1/p2` 仍在被拒（`noDegrade`/`degradeGateClosed` 同窗继续增长）。⇒ **#132 的锁不是靠"没孵"证明的，是靠"同一房同一池同一拍，豁免角色孵了、非豁免角色没孵"证明的**；任务 #29 要的"off-window 越窗"未发生（且开孵那一拍预留仍在生效——那一拍 `noDegrade` 在涨）。
> ②**上一条我给自己留的漏口，量出来了**：差分窗 `R170P7@83,435,951 → R171P4@83,436,564`＝**613 拍**；`noDegrade 8,961→9,551＝+590`，而 P1 upgrader 请求在这段里**连续存在**（旧的 `expiresAt=83,436,396`，新的 `createdAt=83,436,397`，只差 1 拍）⇒ **预留生效率 ≥96.2%、off-window ≤23 拍（≤3.8%）**。⇒ 上一轮那句"条件 3 时开时关 ⇒ 只是'预留成立期间孵不出'"**方向对、比例被我高估了乐观**：现场这 613 拍里 off-window 从没产生过一次 WORK 类孵化 ⇒ 对 builder/upgrader 而言这是**准恒锁**（不是绝对锁，但指望它自愈等于指望 3.8% 的占空比恰好覆盖一次 1,000 拍 TTL 的排队窗口——而 builder 上一代恰好就是这么死的）。#132 里那条已就地收窄。
> ③**撤一条我自己的"双仪器"说法（补25 ①）**：本轮现读账本 `upgraded=180`（此前读为 0），而 180 恰是降级那一拍 `progress` 的增量（12,952→13,132）。写者核实为 `accounting.ts:531 upgraded: Math.max(0, cur.progress − prev.progress)`＋`economy.ts:50` 自陈"harvested/upgraded/built 的唯一可靠口径是房间状态差分" ⇒ **`upgraded` 就是 `progress` 的差分，不是第二台仪器**。⇒ 补25 里"用 `upgraded` 恒 0 独立证明 +180 不是升级工作"这句**证据不成立**（同一量引了两次），且我当时那次读是在事件**之前**取的，本来也判不了事后。**结论本身不换**（+180 仍是引擎重基），但支撑它的地基换成三条真的：`skipReasons` 每只每拍被拒（本窗 958/479＝2.0/拍）、upgrader 携带全 0（`R168P27`）、以及本轮这条更硬的——**降级之后 WORK 类角色根本孵不出来**（豁免只给 harvester/worker）。⇒ 教训（进长期记忆）：**给"某计数是结果差分"这件事写判据前，先读它的写者表达式；名字像投入量的计数器常常就是产出量之差，拿它当独立仪器＝同一量引两次。**
> ④**编制与队列现状（只记账）**：W38S58 home 编制 **8→4**（`harvester t17 / upgrader t226 / distributor t506 / harvester t1060`，本轮末新增那只 harvester 共 5）；**hauler 线为 0** 且它的替补请求是 P2（`rb83436180`）⇒ 按同一机制也会 TTL 而亡（`expiresAt=83,437,147`）；`ea` 在孵化后只剩 14~22。`lvl=1`、`ttd=7,873@83,436,549` ⇒ 归零 ≈**83,444,422**（与补25 预写同值）；`bs` 恒 **2,792**；`bq` 仍无 `extension:queued`；`failedGates` 现读 **G0+G2+G3+G6**（四道，与上轮同集合）。
> ⑤**仪器缺口要如实说**：CP4 判效表 `r168d`（pid 97790）已按 24 发**跑完下班**并打印 `VERDICT shift=exhausted`（未越阈＝未到期，不是结论）；`r168e` 更早已下班 ⇒ **现在只有 `r164-queue`（pid 77019，600 s×72 ⇒ 覆盖到 ≈08:3x）还活着**，它盯的是 `Q=`（重启锁那一支），**CP4 的 `cp/state/LET/CPT` 四列在本轮之后没有表在盯**。我不新建自动化（禁 self-scheduling），所以把这一条作为**下一轮的取数缺口**写在锁里：`kernel.expansion` 四列需要在 08:3x 之前由轮次现读补上。
>
> ★★★★★**R170 补29（02:4xZ）本轮把"builder 为什么孵不出来"这件事从"竞速"改判成一条算术，并因此撤掉补26 的机制说法。新立 §3.5 #132（属人，我只摆数不自办）。**
> ①**现场（差分，不是累计）**：`Spawn7` 全程 **IDLE**、`ea=300=ec` 满池、队列只有 `upgrader:W38S58:2`（P1、body `work,carry,move,move`＝250、`createdAt=83,435,396`）。两发间隔 49 拍（`R170P6@83,435,902`→`R170P7@83,435,951`）：`spawnRejects.reserveOnly +49`、`noDegrade +49`（**恰每拍各一次**），而 `budget +0`、`degradeGateClosed +0`、`floor +0`、`survivalBlock +0`。⇒ 挡住它的**不是缺能量，而是被预留切掉的那 200**（`reserveOnly` 的定义就是"只在扣预留后才越线"），且降级逃生口在 100 预算下产不出合法 body。旁证：`spawn-manager` 每拍都在跑（`systemLastRun["spawn-manager"]=83,435,866`＝当拍）⇒ **不是错峰跳过**；`__churnCounter["W38S58"]=[]`、无 `spawnBlacklist`、`spawnStarvationCount=0` ⇒ 也不是熔断／隔离／饿死计数。
> ②**算术（每一环带出处）**：`spawn-manager.ts:484-485` 只对 `survival` 与 **harvester/worker** 免扣预留 ⇒ 本房 `budget = 300 − 200 = 100`；`degradeBody` 的默认 `requiredParts` 是 **`["work","carry","move"]`**（`bodies.ts:1732`），而 `ROLE_REQUIRED_PARTS`（`demand.ts:10-19`）**没有 upgrader／builder 条目** ⇒ WORK 类最小合规 body＝**200** > 100 ⇒ 返回 undefined ⇒ `noDegrade`。**一般式：`ec < 400` 且预留条件成立的房，builder/upgrader 按构造孵不出**——本房 `ec=300`（RCL1＋0 张 extension）是这式的下限实例。本地夹具跑过四臂（预算 100⇒undefined／**200⇒恰好 `[work,carry,move]`**，两臂结果不同才算证明／hauler 有 requiredParts 条目⇒100 也能出／50·100·150 全 undefined），即写即跑即删、未 stage、未碰 dist。
> ③**撤什么（同一条我为何两次改口）**：补26 写的"P1 保级 creep 抢走孵化槽 ⇒ P2 builder 轮到不了才过期"——**结果对、机制错**。正解：builder 就算排第一也孵不出（P2 要 `economyPressure>0.5` 才被允许降级，本房恒 0；换 P1 路径则撞 200 地板）。同一轮的 `degradeGateClosed` 累计 8,829 与此相容但**只是旁证**（boot 起累计、无时间序列 ⇒ 不能拿来"证明当时是它"）。⇒ 教训（进长期记忆）：**"两个请求在竞争同一资源"这种叙事必须先用"胜者真的能孵、败者孵一次会怎样"证伪过才能立案；我当时看到 P1/P2 优先级差异就直接写成竞速，没读降级链的地板。**
> ④**补27/补28 的"重启锁"要加一条同向根因**：数值门现已满足（builder 请求 83,434,900 过期 ⇒ `R170P1@83,435,833` 已 **933 拍 ≥800**，窗内仍零 builder），但"窗内看不到 builder"现在有**两根因**：需求侧不投（×0，补28 已证）＋ **投了也孵不出（本条）**。⇒ 引这句时两半都要说，别只留一根。
> ⑤**同轮其余现读**：`failedGates` 现读四道 `G0+G2+G3+G6`（与上轮同集合，G4 仍绿）；`lvl=1`、`progress=13,132` 不动、`ttd=8,589` ⇒ RCL1 归零 ≈83,444,42x（与预写同值）；extension 工地 `bs` 恒 **2,792**（零施工已 ≈1,350 拍）；`buildQueue` 仍 `extension:site/road:site/road:queued`（**无 extension:queued** ⇒ 补28 ②的计划供给归零仍在）；`colonyState=recovery`、`phase.bandTicks=4,078`（仍在带内）、`reserve=4,401` 对结构上限 4,300（**第六次复证**）、房内编制 8。
>
> ★★★**R169 补28（02:0xZ）两件：补27 的"重启锁"改用**直接见证**判成立（不是靠我预写那把 ≥800 拍门），并且降级还砍了第二刀——它把 CP4 的**计划供给**也一起注销了。**
> ①**重启锁成立（口径写准）**：现任 builder 的请求 `expiresAt=83,434,900` 到期未孵（补26）；此后 `R169P3@83,435,651` 现读队列＝`upgrader:W38S58:2/p1/rb0`，而这条的 **`createdAt=83,435,396`** ⇒ **需求道在"无 builder"的窗内确实跑过一趟，并产出了 upgrader、零条 builder**；同拍三件排除项全干净（`spawnBlacklist` 不存在／`spawnStarvationCount=0`／`churnFreezeUntil` 不存在）、`myConstructionSites=5`、`colonyState="recovery"`。⇒ **如实记**：预写的数值门是"≥800 拍"，当轮只走了 **751 拍，门没满足**；但那把门存在的唯一理由是"证明至少一趟 demand pass 跑过"，`createdAt` 直接把这件事证成了 ⇒ 以更强仪器替掉代理指标，不算挪带。**结论：`demand.ts:1098`×`:277` 那条 ×0 闭链不必重读——"起步锁"（第一头）与"重启锁"（断代后不再投）现在两半都是现场事实。**
> ②**降级的第二刀＝CP4 的计划供给被注销（本轮新发现的机制，四步全带出处）**：`buildQueue` 全长 **24→19**，构成现读 `extension:site 3 / road:site 2 / road:queued 14` ⇒ 上轮记的 **`extension:queued 2` 与 `container:queued 1` 已不在**。删除因由＝R2 队列治理的**超龄清扫**（`config/index.ts:346 maxQueuedTaskAge=3000`；`queue.ts:160-168` 对 `priority>0` 且 `tick−queuedAt>3000` 的 queued 任务 `splice`、只记 `staleKeys` 观测）——那两条 extension 任务带 `queuedAt=83,422,111`，在 83,435,400 已 **13,289 拍**超龄 ⇒ 被扫属设计内。**但重新入队在 RCL1 不可能**：`gaps.ts:55` 的期望值来自 `expectedStructureCounts(snapshot.rcl)`（`constraint-placer.ts:109-116`＝`CONTROLLER_STRUCTURES[type][rcl] ?? 0`），而补25 已现场读到 extension 在 RCL1 的合法数＝**0**；且 `gaps.ts:70` 把**在建工地也计入 `have`** ⇒ 缺口＝0−3＝**−3** ⇒ `gaps.ts:76-79` 只在 `gap>0` 时写键 ⇒ **RCL1 上审计器"看不见"extension 缺口**。现场正证：`layout.nextPlanTick` 从 83,435,459 前进到 83,435,569（**规划器真跑了一趟**）而 `layout.layoutGaps` 仍 **ABSENT**、队列里仍无任何 `extension:queued`（`R169P2/P3`）、`revision` 恒 10。同类核对一条：container 不在 `CONSTRAINT_PLACED_TYPES`（`constraint-placer.ts:92-103` 只列 spawn/extension/tower/storage/lab/terminal/factory/observer/powerSpawn/nuker）⇒ 那条 `logistics.container.controller` 任务的失踪属物流排产侧，**不与本审计混账**。
> ③**CP4 的链条因此从"差 builder"变成四道串行闸，每道都有归属**：(a) **先回 RCL2**——需一次成功升级，被 #127 的冻结（每只每拍，本窗 `skipReasons` 958→1,008）与 `upgradeEnergyFloor=300`＝满池两把闸按住；(b) 回 RCL2 之后审计器才会把缺的 2 张 extension 重新报成缺口（②，自动）；(c) 然后 builder 要**赢下孵化竞速**（补26：P2 对 P1 的保级 upgrader，实测一整代 1,000 拍 TTL 输光）；(d) 最后才是 12,708 施工量（15~31 小时单头）。⇒ **#121 那个"site 并发名额"不再是列表顶端那把闸**，给人看的排序要按 (a)→(d) 重排。
> ④**同轮其余现读（只记账，不解释成好事）**：`failedGates` 现读 **G0+G2+G3+G6**（四道，**G4 转绿**；按口径每轮现读、不写死）；事件环 83,435,275 的 `PhaseTransition W38S58 [3,2]` **不是出带**——`phase.bandTicks` 单调 1,117→3,617（同一条带没断）且 `phase` 现读仍 `crisis`，而 `crisis`/`recovery` 经 `phaseToColonyState` 都映射成 `recovery` ⇒ **×0 不受这次翻动影响**；#120 天花板**第五次复证**：`phase.reserve=4,433` 对结构上限 4,300（`ea` 200＋2×2,000 container，超出部分＝home 在本房的在途携带）、`lvl=1`、`ext=0` ⇒ 不需重算天花板；RCL1 时钟 `ttd=8,771@83,435,651` ⇒ 归零 ≈83,444,42x，与补25 预写的死线同值；施工 `bs` 恒 **2,792** 已 **1,172 拍**。
> ⑤**复采列（下一轮免费可查）**：`bq` 里只要重新出现 `extension:queued` ⇒ 意味着 `lvl` 已回 2（②的逆否），这一列比 `controller.level` **更早**暴露"回 RCL2"；`q` 里出现任何 `builder:W38S58:*` ⇒ ①的重启锁当场作废、回来重读 ×0。两列都在 `r164-queue.log`（pid 77019，600 s×72 发 ⇒ 覆盖到 ≈08:3x）与我的探针形状里。
>
> ⑥**补一句：那条 controller container 任务的失踪不是物流侧漏投，而是同一类等级门。** `domain/layout/task-factory.ts:230-235` 的 `createControllerContainerTask` 第一行就是 **`if (snapshot.rcl < 2) return undefined`**（后面 `:239` 查邻格已有 container、`:242-247` 查 `CONTROLLER_STRUCTURES[container][rcl]` 上限——本房 `containers=2`、上限 5、controller 邻域 0 只 ⇒ 那三道都过，卡在 `:235`）。⇒ **RCL1 上"给 upgrader 站桩供能"这张图根本没有生产者**，与 ② 的 extension 侧同构（一处是等级表、一处是显式 `rcl<2`），所以 #127 的"第二把闸"（`upgrader.ts:126-128` 要非源 container 有能量）**在 RCL1 上是按构造打不开的**，不是等 builder。可证伪：若 `logistics.container.controller` 在 `level` 仍为 1 时重新出现 ⇒ 本条判错、回来重读。
>
> ★**R168 补27（01:5xZ）把补26 那条否证扩成一段可复证的"重启窗"，并如实记下它现在**还不判分辨**的那一半**。
> ①**现场（三发等距样本，同一表达式、各自带 mark）**：`R168P30@83,434,925` 队列空而 `b=""`；`R168P31@83,435,129` 队列空、builder 0、`lvl=1`、工地之和 `bs=2,792`；`R168P32@83,435,287` 队列仍空、builder 0、`bs` 仍 **2,792**、`colonyState="recovery"`。⇒ 自 `83,434,479` 起 **施工零进展已 808 拍**（`bs` 三次逐字相同，且 `built` 在 r168d 表上也不再涨）。
> ②**为什么这三发还不能定罪"重启锁"**：投需求的那一趟本身是**几百拍一次**（同房内两条请求的 `createdAt` 相隔 775 拍：`upgrader:2@83,433,889` 与 `hauler:1@83,434,664`；`scheduler.ts:189/191` 那两把让位闸实测把 pass 拖到 400~800 拍）⇒ **362 拍的"队列空"短于一个 pass 周期**，与"跑了但 ×0 把目标归零"和"根本没轮到跑"三种世界都相容。⇒ 判分辨的条件预先写死（下一轮免费复采，不必新装置）：**若再过 ≥800 拍，`Q=` 里仍不出现任何 `builder:W38S58:*`，而 `myConstructionSites>0`（现读 5 张）、`colonyState` 仍 `"recovery"`、且 `spawnBlacklist`/`spawnStarvationCount`/`churnFreezeUntil` 三件仍无异常** ⇒ **重启锁成立**（＝需求侧一旦断代就不会再投第一头，#122 回到"能不能走"级别）；**反之只要出现一次 `builder:*`** ⇒ 需求道在 recovery 下会自己重新出带 ⇒ **`demand.ts:1098`×`:277` 这条被 R160 补33/补36 当作闭链的机制当场要重读**。
> ③**顺带把"施工停滞"的两半分开记（别混成一条）**：(A) 没 builder ⇒ 任何工地都无人建；(B) 即便 builder 回来，`lvl=1` 上 extension 合法数＝0（补25 ②）⇒ 三张 extension 工地建不动，但**两张 road 工地在 RCL1 仍合法**，所以 (B) 的证据只能来自 extension 的 `bs`，不能来自"工地整体不动"。⇒ **本窗内 (B) 仍未获执行证明**（现场转不动的那一半我不补故事）。
>
> ★★★★**R168 补26（01:3xZ）撤掉我 25 分钟前写的两句"能自己走"——现场把它们否证了：替补请求会**过期未孵**，车道是"竞速受限"的，而且这一代已经断了**。
> ①**证据链（同一支请求从提交到死亡，全程按 key＋`expiresAt` 盯）**：`builder:W38S58:0` 于 `R168P19@83,433,944` 带 `rb83433924` 在队（替补线），`R168P27@83,434,479`／`P28@83,434,684`／`P29@83,434,847` 三次仍在队（`expiresAt=83,434,900`），到 `R168P30@83,434,925` **队列已空而 `b=""`** ⇒ 请求**过期未孵**，房内 builder 数自 83,433,927（前任死透）起 **998 拍为零**。同拍 extension 工地 progress 之和从 83,434,479 起到 83,434,925 **恒 2,792**（446 拍零施工）。
> ②**赢下这段时间的是谁**（`R168P30` 编制，按名字里的出生拍排）：`hauler#1-83434663`、`hauler#1-83434763`、`harvester#0-83434363`、`harvester#0-83434822`、**`upgrader#2-83433738`＋`upgrader#2-83433888`＋`upgrader#2-83434922`（第三只在 83,434,922 抢在请求过期前最后一拍开孵）** ⇒ 一个 TTL 窗（1,000 拍）内房间孵了 **3 只被 colony-state 门禁禁止干活的 upgrader**、2 只 hauler、2 只 harvester，**唯独没有 builder**。成因是纯排序：`demand.ts:1169` 给替补线 builder/hauler 恒 **P2**（只有 harvester/worker 是 P1），而 `:1103` 把 crisis 下的 upgrader 抬成 **P1** ⇒ **"不能干活"的保级编排在物理上排在"能干活"的施工编排前面**；再叠加 `ea` 在 170~221 之间摆动（两种 body 都要 200）⇒ P2 轮到不了就过期。
> ③**由此两句旧话要收回**：(a) 补23 的"CP4 不需要人拍就能自己走到"——**否证**（这一代没走到，且断了之后按 ×0 的解释没有通道重新投第一头）；(b) 补24 的"只要替补线成立车道就自我续接"——**降级成"只有当替补请求赢下孵化竞速才续接"**，而本房它在 1,000 拍 TTL 内输给了自己那批保级 creep。⇒ **#122/#126 的人拍口径回到"能不能走"这一级**，并且现在多了一条同向的：RCL1 上 extension 合法数＝0（补25 ②），所以就算 builder 回来也建不动，**两件事必须同时松**（回 RCL2 需要一次升级；有施工需要 builder 抢到槽）。
> ④**这构成一个闭合自锁（本轮最重要的结构性结论，每一步都带现场拍号）**：`ea` 被 0 张 extension 钉在 300 ⇒ 每只 body 都要 200 ⇒ 每个 P1 upgrader 花掉 200 却**一拍都不升级**（本窗 `skipReasons` 会随第三只回到 ≈3.0/拍）⇒ 抢走的是 builder 的槽 ⇒ 工地不动 ⇒ extension 不落 ⇒ `ea` 继续 300。而回 RCL2 唯一不依赖施工的路是"任一 creep 成功升级一拍"（`progress` 13,132 对门槛 200），这条路正被 `kernel.ts:988-1003` 的冻结与 `upgradeEnergyFloor=300`＝满池两把闸按住。**这一环链里没有任何一步需要人来"批准"才成立——但也没有一步能由 bot 自己打破**（不自办降阈值／不动编制，属人）。
> ⑤**objective 那一支再钉一次**：`level` 至今 **1**（未弹回）⇒ 补25 那条"一次升级即回 RCL2"的预报**未被兑现**（这 1,000 拍里没有任何升级工作：`upgraded` 恒 0、`bs` 恒 2,792、`lastRclChangeAt` 仍是 83,434,421）⇒ 它现在是"有反例窗口"的未决项。**新死线照旧**：RCL1 的 `ttd` 归零 ≈83,444,42x（≈10.6 h 后），本服届时怎么走未验、不补故事。
>
> ★★★**R168 补25（00:5x–01:0xZ）#127 的降级预报**命中到拍子**：`lastRclChangeAt=83,434,421`（＝R162 复测斜率算出的那个数，**零误差**），`level 2→1`；预写的否证位也确实触发了，但触发方式不救 #127**。
> ①**归因按 R162 自己写的规矩做，不blindly 翻案**：`progress` 从 12,952 变到 **13,132（＋180）**，变的时刻正是降级那一拍（`controllerProgressChangedAt=83,434,421`），而 `energyLedger.rooms.W38S58.upgraded` 自 boot 起 **恒 0** ⇒ **是引擎在降级时重基 progress，不是有 creep 升级了**（两台独立仪器；`progressTotal` 现读 200 也说明 12,952 这个量早已与本级值域脱钩）。⇒ "progress 离开 12,952" 这条否证位**不能**当冻结被否证的证据用，本条按预写判据记**命中**。原始那版 83,434,100（−1.058/拍）早 321 拍，两版都留在账上（规矩要求：命中只记重锚版，原始版标沿革）。
> ②**降级给 CP4 新添了一道挡点，而且它的形状是"差一个 WORK 拍"**：`CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION]` 本服现场读＝`{"0":0,"1":0,"2":5,"3":10,...}` ⇒ **RCL1 合法 extension 数＝0**，而那 5 张工地（3 extension＋2 road）仍在场（`find=5`）⇒ 按引擎的 `ERR_RCL_NOT_ENOUGH` 语义，**回到 RCL2 之前这些工地建不动**（⚠️此推论本窗内**未获现场执行证明**：现任 builder 位是空的，停摆的直接因是"没人建"而非"引擎拒建"，两者要下一发分开记）。而回 RCL2 只需一次成功的 `upgradeController`——`progress=13,132` 已是 RCL1 门槛 200 的 **65 倍**，等级只在 creep 的升级动作内部检查 ⇒ **可检验预报：任一 creep 成功升级一拍 ⇒ 当场跳回 RCL2**。⇒ 补23 那句"CP4 不需要人拍"现在要加上这一条：**先决条件从"有 builder"变成"先恢复 RCL2"，而恢复 RCL2 被 #127 的冻结正好挡住**。
> ③**#127 第一次配上"受害者账"（这轮最该给人看的一段）**：窗内房间又孵了 2 只 upgrader（`upgrader-W38S58-2-83433738-171`、`-83433888-177`，两者 `mode=acquire`、携带能量 0），同一时间 **hauler 编制 4→0**（`hauler:W38S58:4/5` 带着 83,433,4xx 的 `replaceBy` 至今没孵）、**builder 位空缺 ≥550 拍**（`builder:W38S58:0/rb83433924` 排队未孵）。为什么是 upgrader 赢：它是 **P1**（`demand.ts:1103` inCrisis 把 builder/upgrader 抬成生存角色，但替补线 `:1169` 只给 harvester/worker P1 ⇒ builder 恒 P2）、body 只要 200 能量（hauler 250）、而 `ea` 现读 170 ⇒ **能量优先给了被禁止干活的那两只，物流与施工同时停摆**。这就是 R161 那句"房里养着永不升级的保级 creep"的**实付版本**。
> ④**冻结速率用新口径复核（整窗快照）**：本窗 `skipReasons["creep/upgrader/colony-state"]=958` 对窗长 479 拍＝**2.0/拍**，而编制恰 2 只 ⇒ **每只每拍**；上一窗 1,500/500＝3.0 对 3 只 ⇒ 仪器与编制成比例自洽（同时第三次否证"5 拍一评"那个理论值）。
> ⑤**预写的自然实验裁决：本服不在降级时回收超额结构**。storage 在 RCL1（合法数 0）依然 `my=true` 在场（`st=1`），且 `phase="crisis"`、`colonyState="recovery"` 同拍现读 ⇒ **#120 的 crisis 钉不随降级松开**；这条第一次拿到正面支持，也意味着"掉一级"并不会把那间幽灵库房洗掉（撤不掉 hasBank，就撤不掉 bankrupt）。
> ⑥**降级没有改动扩张**：`kernel.expansion` 仍 `state=economic_startup`、`checkpointsPassed=3`、`startedAt=83,425,257`、`forcedAdvance=false`、`consecutivePositiveTicks=0`；`failedGates` 仍 `G0+G2+G3+G4+G6`；CP4 两合取项按判据自身 filter＝extensions **0/5**、containers **2** ⇒ objective 那支"照实记降级有没有把扩张打进 abandoned/failed 或改动 cp"的答案是**没有**。⇒ 本 objective 的 ①② 两支维持未到手（CP4 还差 5 张 extension 落成，量级 15~31 小时，且现在前置多了②那道 RCL2）。
>
> ★**R168 补24（00:2xZ）#26 落定：第二只 builder 是替补线孵的，证据是 `replaceBy` 这个字段本身——而它同时把"第一只从哪来"重新挂回未决**。`R168P19@83,433,944` 现读队列＝`upgrader:W38S58:2/rb0｜hauler:4/rb83433472｜hauler:5/rb83433525｜`**`builder:W38S58:0/rb83433924`**，而 `Memory.creeps` 里 builder 已空（老的刚死）。定罪链：①**`replaceBy` 在"本房角色"这一侧只有一个写者**（`demand.ts:1193`，替补线；`queue.ts:19` 只在重复提交时透传，`domain/remote/demand.ts:538` 属远矿线）⇒ 带 `rb` 的条目必出自替补线；②算术自洽到 ±3 拍：老的那只出生 83,432,416、`R168P15@83,433,141` 读到 ttl 786 ⇒ **死期 83,433,927**，而 `replaceBy=83,433,924` 恰在其**前 3 拍**＝`needsReplacement`（`demand.ts:138` 阈值 `bodyLength×3+replaceBuffer(15)+travel`）与 `:1193` 同一表达式的无缝交接设计 ⇒ **"将死者尚在世时就投了替补"这个重叠指纹成立**，不是"死后有人重开需求"。
> ③**但这条只判到第二头，判不到第一头**：第一只（出生 83,432,416）之前房里没有 builder ⇒ 它不可能来自替补线（替补线要有将死者在场），而我当时没抓到它的 `rb` 列（表那几发只印 key 列表）⇒ **第一头的生产者仍是未决项**，两条候选照旧（`:1105` 需求线需那一拍快照缺 `storage`；或有一只我未曾观测到的更早代际）。⇒ 措辞收口：**"×0 只需按住第一头"这句现在有了现场实例（第二头由替补线自行续上，×0 全程有效），但"第一头当时是怎么进来的"不许写成已知**。这条也是本 objective 之外白捡的：它同时把 #126（已撤销）当初那句"builder 需求乘 0 ⇒ 施工速率恒 0"的**运行时部分**彻底关死。
> ④**同拍顺带三件**：`progress` 仍 `12,952`、`ttd=477`（⇒ 归零点 ≈83,434,421，与 R162 那版斜率算出的窗中心**逐字对上**，窗 [83,434,100, 83,434,500] 约 30 分钟后开）；`upgrader:W38S58:2` 带着 `rb0` 在队列里＝**需求线此刻正在投 upgrader**（P1、无 replaceBy ⇒ 走 `:1105` 那支，与 #127"需求买保级编制、creep 层不许干活"同形）；两张 hauler 替补带 `rb` ⇒ 替补线在本房是**多角色同时活着**的常态，不是 builder 特例。
>
> ★**R168 补23（23:4xZ）把"CP4 要不要人拍"这个问题判到底：不要——补20/补22 那条链走完，剩下的四格配置读数把唯一剩下的风险也消掉了**。
> ①**名额只串行、不搁浅**：`config/index.ts:290/293/303` 现读 `maxNormalSitesPerRoom=3`（extension 属 normal）、`maxRoadSitesPerRoom=2`、`maxCriticalSitesPerRoom=1`，而本房现读工地＝**3 张 extension site＋2 张 road site**（`R168P12/P13@83,432,897~924`）⇒ 正好顶在 normal 名额上，所以那 2 张 queued extension **必须等一张先落成**才能变 site——这是串行，不是死锁：每落成一张 `normalSites` 就降到 2，名额自己让位。
> ②**"建 site"这一侧在 crisis 下也不挡**：`construction-manager.ts:127-139`（R165 补5 已核过一次）在严格发展门禁被拒时落到 **R2 关键发展通道**，明确放行 extension 与 controller container ⇒ 所以危机相位不影响"site 能不能被创建"，只影响"builder 会不会被投进队列"（＝补20 那条 ×0 的作用域）。
> ③⇒ **builder 车道在整个 CP4 窗口里不会遇到"0 工地"的悬崖**：替补线门禁 `demand.ts:1150` 要 `myConstructionSites.length>0`，而①②合起来保证 5 张工地之外还有 2 张 queued 在路上 ⇒ 只要有一张没建完，site 数就不归零。**结论：CP4 不再需要任何人的决定就会自己走到**（时间尺度＝补20 的 15~31 小时单头带）。
> ④**因此 #122/#126 那一栏的"属人"部分要重划**（这条只改 CP4 的归因，不改 #120/#127 的）：人拍 #122 现在买到的是**头数与小时数**（3~4 头 ⇒ ≈5.6~7.5 小时）以及 **#120 的 crisis 钉与 #127 的保级 creep 被冻**这两件——后两件与 CP4 无关，仍然是"存在≠能力"那一处收口才同时松开。**不许**再把它写成"不拍就永远到不了 CP4"。下一发的免费复核：`econ-ring` 的 `ea=x/300` 分母若变（300⇒350＝第一张 extension 落成）⇒ 补20 的天花板 4,300 要按新 `ext` 数重算（objective 那句条件式由此在**窗后**才可能触发）。
>
> ★**R168 补20（10-04 23:2xZ）把 #26 的候选生产者收到只剩 demand.ts 内两处，并用 `home` 归属规则把 objective 第三支复证做到"组成可推导"的程度**。
> ①**生产者收窄（四发直读＋四处读码，零推断）**：判效表 `r164-queue.log` 第 14 发抓到 `Q=hauler:W38S58:1,builder:W38S58:0`、随后 15-17 发队列空（＝被孵化摘走），孵化出的那只按 name 锚为 `builder-W38S58-0-83432416-15r`，`R168P11a@83,432,889` 现读 **`colonyState="recovery"、colonyStateSince=83,431,754`** ⇒ 请求那一拍房间**已经在 recovery 里 662 拍**，`inCrisis=true`、`demand.ts:277` 的 ×0 是活的。逐条排除：**发展恢复线**出局（`recovery-execution-system.ts:786` 写死 `spawnKey(role, room, 1)` 且 `:806` 打 `recoveryCorrelationId`，而这只 creep 是 `spawnIndex:0`、memory 里无该键）；**扩张两条线**出局（`state-machine.ts:754` 的 key 形状是 `expansion:builder:<target>:<i>` 且写进 **sponsor** 队列、`bootstrap-lane.ts:131` 是 `bootstrap.<房>.<波>.worker` ⇒ 都不可能长成 `builder:W38S58:0`，也都不落在自家队列里）；**`demand.ts:1105` 那一支**要成立必须 `:1098` 的 `snapshot.storage !== undefined` 为假（同一拍 `Game.rooms.W38S58.storage` 在场，但快照是逐拍建的，某拍缺字段我无法事后取证）⇒ 剩下的唯一自洽解释是 **`:1132-1195` 的替补线**：它按 `:1167 creep.spawnIndex ?? 0` 生成同形 key，且**整条不乘 `demandFactor`、不看 `colonyState`**（门禁只有 `:1150` 有工地／`:1159` maxCount／`:1163` 盈余），而 `:1163` 在 `minCount=1` 下"1 只在世＋0 待发 ⇒ 0>=1 假"⇒ **一旦有第一头，这一头死后就永久自我续接**。
> ②**这一支的免费裁决（预先写死，别到时再想）**：替补线要求**将死者在场**，所以指纹是"重叠"——现任 builder 出生 83,432,416、本服寿命 ≈1,500 拍 ⇒ 到期点 ≈**83,433,916**，正落在 #127 裁决窗里。⇒ 窗内一发编制直读即可判：**同时出现两只 builder（或队列里 `builder:W38S58:0` 而老的仍在世）＝替补线坐实**；**老的死透之后才出现 `:0`＝demand 线坐实**（那就意味着 ×0 在生产侧并不绑定，#122 的"builder 需求乘 0"要当场降级成只解释"第一头"）。附带第二指纹：队列里那条的 **priority**——demand 线在 crisis 下是 P1（`:1103`），替补线恒 P2（`:1169`）。⇒ 两种结果都不改 objective 前两支的判据，只改 #122 交给人那一栏的措辞：**人拍的是"几头／几小时"，不是"能不能走"**（补19 已经把这个方向写对，这次是把它的第一发现场实例钉上）。
> ③**objective 第三支做到组成可推导**（第三次复证，`R168P9/P10/P11a@83,432,784~889`）：`phase.reserve=4,558` 而**纯结构承载＝300(ea，ext=0 故 cap=300)＋2×2,000(container)＋0(storage)＝4,300**，差额 ≈258；差额身份不再靠猜——`reserve` 的 creep 项由 `kernel.ts:333-338` 按 **`memory.home`** 归属，而房内那两只各背 1,200、永远卸不进去的 carrier 的 `home=W37S58` ⇒ **它们记在 W37S58 的 reserve 上，不记在本房**（同拍 home=W38S58 的 13 只合计携带 ≈381，与 258 同量级、差值属跨拍抖动）。⇒ 本房的"储备顶到天花板"这句话现在是干净的：**4,300 的结构上限＋不足 400 的在途，对 15,000 的退出线差 3.3 倍**，而且**没有一分来自那笔被 null 读数锁死的 2,400**（那笔的钱主是 sponsor 房，不是殖民地 ⇒ #117/#120 两案各记各的，不许并成一笔）。`ext` 仍为 0 ⇒ objective 那句"若 ext 数变了要重算天花板"这一支**不触发**，天花板维持 4,300。
> ④**CP4 现在只剩一个合取项（按判据自己的 filter 读，不是按我的口径）**：`state-machine.ts:441-446` ⇒ `extensionsBuilt` 用 `FIND_MY_STRUCTURES` 数 extension＝**0/5**，`containerBuilt` 用 `FIND_STRUCTURES` 数 container＝**2 ⇒ 已满足**（`R168P13@83,432,924`）。⇒ 距 cp=4 的全部依赖＝**12,708 施工量＋那 2 张还在 queued 的 extension 被建成工地（名额属 #121）**，其余合取项与 `roadsBuilt`（硬编码 true）无关。
> ⑤**两条探针坑（都是本轮当场踩、当场用第二种形状救回的，进长期记忆）**：(a) **`Game.rooms.<r>.constructionSites` 在本服返回 0 键**，而同一拍 `find(FIND_CONSTRUCTION_SITES)` 给出 **5 张工地** ⇒ 我据此先打印过一次"工地没了"的假零；今后判工地一律 `find`，`constructionSites` 属性不作证据（代码侧无此风险：`room-snapshot.ts:60-61` 用的就是 `find`）。(b) **`FIND_MY_STRUCTURES` 按引擎定义不含 container/road/wall** ⇒ `myc=0` **不是**"这两只 container 不是我们的"的证据（#120/#122 那条"遗留结构来历"的论证绝不能引它，引了就是一条假正面）。
>
> ★★**R168 补19 把"builder 车道现在活着"量化：CP4 还差 12,758 能量施工、实测单头吞吐 ≈0.6/拍 ⇒ 约 2.1 万拍（≈22 小时）；并且这不再需要人拍才算能走**。
> ①**剩余建造量（直读，不是估的）**：`R168P8@83,432,725` 该房工地＝`extension 286/3000`、`extension 1956/3000`、`extension 0/3000`（＋两张 road 0/1500，CP4 不需要）⇒ 现有三张工地还差 **6,758**，另有 **2 张 extension 还在 queued**（各 3,000）＝**CP4 尚需 12,758 能量施工**（与 R160 当年那个 12,908 同量级，差值是这中间真建掉的部分）。
> ②**实测吞吐**：同一张工地 `1,856`(t 83,432,547) → `1,906`(597) → `1,956`(715) ⇒ **100 能量 / 168 拍 ≈ 0.60/拍**（首末两次斜率分别 1.0 与 0.42 ⇒ 取整体均值，别用单段斜率外推——这是我自己记过的第 4 类错的现场版）。⇒ 单头做完 CP4 ≈ **21,300 拍 ≈ 22 小时**（3.8 s/拍）；若按 (i)/(ii-b) 的 3～4 头 ⇒ ≈5.6～7.5 小时。⇒ **#122 那张三档表现在有了"到 CP4 还要多久"这一列**，这才是可拍的形状。
> ③**裁决窗内不会看到 CP4**：窗中心 t≈83,434,421 距此 ≈1,700 拍，按 0.6/拍只能再建掉 ≈1,020 能量 ⇒ 连手上这张 1,956/3,000 都完不成 ⇒ **`extensions.length` 在窗内仍是 0、`cap` 仍是 300** ⇒ ③那句"若 ext 数变了要重算天花板"在窗内不会触发（窗后再看）。
> ④★**结构性发现（这条最该记）：×0 是"起步锁"，不是"运行锁"**。替补链 `demand.ts:1132-1180` 完全不看 `demandFactor`/`colonyState`，其门禁 3（`:1163`：`living-1+pending >= minCount` 才不补）在 `builder.minCount=1` 下＝"只剩这只且它濒死 ⇒ 必发替补"；而门禁 1（`:1150`）要求"有工地或有道路维修需求"——现读 3 张 extension 工地在场 ⇒ 满足。⇒ **一旦有第一只 builder，车道就自我维持**（当前那只 ttl 1,212 ⇒ 约 1,200 拍内会触发替补）；反过来，×0 只挡住"从零到一"。⇒ 这解释了为什么 `colonyState=recovery` 与"施工确实在发生"能同时为真，也是 #126/#122/#127 里"乘 0 ⇒ 速率恒 0"这句措辞的**边界条件**：它只对"当前没有 builder"的状态成立。
> ⑤下一轮的免费复核（不新建自动化）：`econ-ring` 的 `ea=x/300` 分母（300⇒350 就是第一张 extension 落成，50 拍分辨率）、`r168d` 的 `built` 只当正向证据（涨＝真施工；不动 ≠ 没施工，见补18②）、`Q=` 里 builder 的 **key 索引**——⚠️**（10-04 23:3xZ 补20 就地更正：这一列判不出道，我原来的写法是错的）**`":0"＝需求道` 不成立，因为替补线 `demand.ts:1167` 按 `creep.spawnIndex ?? 0` 生成**同一个 `:0`**；`:1` 只能排除恢复道（`recovery-execution-system.ts:786` 写死 index 1），排除不了替补线 ⇒ 真正的裁决量已换成"两只 builder 是否同世（＝替补线）／老的死透后才出现 `:0`（＝需求道）"，见 §4.0 补20 ①②与表 `r168e-builder-lane.log`。
>
> ★★★★**R168 补18（现场转折）W38S58 里现在有一只 builder 正在造 extension ⇒ 我此前"builder 需求被乘 0 ⇒ 施工速率＝0 ⇒ CP4 只能等人拍 #122"这句话作为绝对陈述被否证了**。证据（全部现读，逐条带 mark）：`R168P2@83,432,481` 编制＝`builder 1 / upgrader 3 / hauler 4 / harvester 3 / distributor 1 / defender 1`；`R168-Builder@83,432,481` 那只 builder `mode=work`、**assignment 指向 extension 工地 `6ac2610c…`**、位置 (25,32)、携带 50/50、ttl 1391；`R168P5@83,432,547` 该工地＝`extension@26,28 progress 1,856/3,000`；`R168P6@83,432,597` 同一工地 **1,906/3,000**（＋50/50 拍）且 builder 已转为 `acquire@(10,30):0`（去取能）、ttl 1330 ⇒ **施工确凿、且在推进**（≈0.8 能量/拍）。同时 `rooms.W38S58.colonyState="recovery"`、`phase=crisis`、`R168P1@83,432,450` 幽灵 storage **仍在场**（`sto=true, cap=null`）、`host=0`。
> ①**它是怎么进来的——四条候选全部否掉或没证实，只有"快照缺 storage"那条还活着**：(a) defense 迟滞否——`room-state.ts:247-251` 的退出迟滞是 `config:632 defenseExitHysteresis=50` 拍，而 `lastHostileAt=83,431,534`，请求出现在 ≈83,432,2xx 之后 ⇒ 早过期 600 拍；(b) `submitPioneers` 否——只有 `:83`（claimed）与 `:361`（`advanceBootstrapping`）两处调用，本房是 `economic_startup`；(c) 发展停摆的恢复动作否——`recovery-execution-system.ts:782` 虽写"有 buildQueue 就加 builder"，但它用的 key 是 `spawnKey(role, room, 1)`＝`builder:W38S58:1`，而我看到的是 **`:0`**；(d) 替补路（`demand.ts:1132-1180`，key 用垂死 creep 的 `spawnIndex`）需要"已有一只濒死 builder"，现场没有前例证据。**剩下的活口**：`demand.ts:1098` 的乘 0 只在 `snapshot.storage !== undefined` 时生效 ⇒ 任何一趟"快照里没拿到 storage"（例如 `kernel.ts:445-459` 那条 `safeRunBuild` 失败 ⇒ 房对快照消费者不可见，或快照部分重建）都会让 builder 目标**直接按弹性/权限表算**而通过 ⇒ 一次就够（B-5 会把目标封到 minCount=1，与现场恰好一只 builder 相符）。⇒ 这条列为**未定案但可复核**：沿上再看到 `builder:W38S58:0/1` 出现时，同拍读 `kernel.stats.roomSnapshot`/该房快照是否在位，就能钉死是哪条。
> ②**这台仪器（`built`）在这一段里不可信，已核到实现**：`flows.built = diffSiteProgress(...)` 只在 `economy.ts:84 gap === 1` 时才 bump（`:90-91` 注释自陈 economy 被跳过时"累计 L1 计数器会偏低"），而现场工地 61 拍涨了 50、`built` 仍是 0（同拍 `harvested` 在涨 ⇒ 不是整块没跑）。另有一处**方向相反**的偏差：`accounting.ts:542-546` 对"消失的工地"记 `total - prevProg` ⇒ 完工那一笔是**补计**的。⇒ 从此判读规则改掉：**`built` 不动 ≠ 没施工**（它只能当正向证据：涨了＝真施工）；CP4 的可靠见证改成两条——**经济环的 `ea=x/300` 分母**（每建成一张 extension，`energyCapacityAvailable` 抬 50：300→350→…→550，50 拍一格）与状态机自己的 `checkpointsPassed`/`state`（在表 `r168c/d` 列）。同理，重播种前那个 `built=4,064` 只能当**下界**读，别拿它除速率算 ETA。
> ③**对目标与 #122/#127 的连带更正**：(I) 第一支现在**有可能自然到场**——本工地还差 1,094（按 0.8/拍 ≈1,400 拍 ≈1.5 小时），且 CP4 需要 5 张、现场 3 张工地＋2 条 queued ⇒ 时间尺度是"今晚到明天"量级而非"永不到来"；判效窗因此从"只盯降级"扩成"同时盯 cp≥4/integrating"。(II) #122 的说法要改口径：它不再是"唯一的锁"，而是**"你能拿到几头 builder"**——现存的漏洞给 1 头（且其账本还看不见），(i)/(ii-b) 给 3～4 头且 `built` 在快照正常时能记上。(III) #127 的降级预报归因表**加第三条成因**：`progress` 离开 12,952 也可能是**这只 builder/后续 builder 的升级工作**（colonyState 一旦不再是 recovery，upgrader 就解冻）；原两条（worker 线、colonyState 松）不变，三条都要读数，不许默认成"修好了"。(IV) 顺带把 #115 的线上签名钉了一半：这只 builder **拿到了 extension 工地的 assignment 并真的在筑**（`assignment.targetId` 直指 (26,28) 工地）⇒ 任务 #12 可据此改判。
>
> ★**R168 补16 把"CP4 得先被评估到"这一层前置补全**（此前 补2 的五步链路漏了它）：①**唯一的前置出口**——`advanceEconomicStartup` 的 `:386-396` 若 `!Game.rooms[target]?.controller?.my` 就 `abortExpansion("LOST")` 并 return ⇒ **CP4 连评估都不发生**，且它不是"停住"而是**整条扩张终结**。这条已被在表仪器覆盖：终结会把 `Memory.kernel.expansion` 置空 ⇒ 正是新表的 `edge=record-absent`（`r168c-verdict-watch.sh`，pid 96231）。⇒ 完整前置集合＝**视野＋归属**；其余（CP3、site 名额、发展门禁、builder 需求）只影响"能不能建成"，不影响"评估跑不跑"。②**视野有免费见证器**：经济环每 50 拍一格，写入点 `telemetry-collector.ts:228-241` 的输入是 `snapshot` ⇒ **能采到 W38S58 的新样本 ⇔ 那一拍 `Game.rooms.W38S58` 存在**；现读最新格 `t=83,432,255`（重播种之后仍在推进，`cte=4000 / cce=0` 未变）⇒ 前置此刻成立。⇒ 下一轮若要问"CP4 为什么没被评估"，**先看环的 `t` 还在不在推进**（零 console、不占 429 桶），别先怀疑判据。③**两个合取项的筛子不一样宽**：extension 走 `:441 FIND_MY_STRUCTURES`（必须我方结构），container 走 `:444 FIND_STRUCTURES`（该房任何可见 container 都算）⇒ 补15⑥ 那条"container 衰减会毁掉 CP4"要加限定：**若房里还剩一只非我方 container，第二合取项照样为真**；反之 `containers.length>0` 为真也**不等于**"我们那两只源 container 还在"——物流侧的证据是环里的 `cte=4000`，两者不可互当对方的证据。④**CP4 是纯结构判据这件事再自证一次**：`:416-430` 那发 CP3 评估把 `extensionsBuilt/containerBuilt/roadsBuilt` 全写死 `false` 传入（CP3 的合取不看它们），而 `retryCount` 与其余四处调用点一样是字面量 0 ⇒ #128 的惰性阶梯在这条分支同样成立，"再等等"不会自己变绿。
>
> ★★**R168 补17 objective 那句"CP4 ⇒ cp 3→4 且 state 进 integrating"不是同一拍保证的——我因此改掉了判效表的下班条件**（这条若没先想到，沿上会误报一次"状态机坏了"）。
> ①**代码事实**：`state-machine.ts:466` 只写 `checkpointsPassed=Math.max(现有,4)`，而 `:474-479` 的迁移条件是 **`cp3.passed && cp4.passed` 同拍成立**。CP3（`checkpoint.ts:169`）＝`harvesterActive && transporterActive && spawnCanSpawn`，其中 `spawnCanSpawn = canSpawnEvidence(ea, 正在孵化) = ea >= MIN_VIABLE_BODY_ENERGY || hatchInProgress`，而 **`MIN_VIABLE_BODY_ENERGY = 300`**（`:126`）＝本房 `cap` 的同一个值。经济环现读 `ea` 常年在 2/67/117/167/252 之间（只有池顶才是 300）⇒ **完全可能"第 5 张 extension 落成的那一趟 CP3 恰好为假"**，于是 `cp=4` 先出现、`state` 仍 `economic_startup`，迁移推迟到后面某一趟（今日节拍 ≈100 拍）。⇒ 沿上读到 **`cp=4` 而 `state` 没动**＝**预期内形状**，不是仪器坏、不是矛盾、也不是"CP4 没到手"；此时**别去找 `lastEconomicEvalTick`**（它只在 `advanceIntegrating` 里写），等下一发即可。
> ②**这个中间态没有副作用**：`checkpointsPassed` 在 `src/` 里除状态机与 dashboard 显示（`execution-dashboard.ts:99 checkpoints=${n}/5`）之外**没有门控消费者** ⇒ cp=4 单独出现不会解开任何东西，也不会让 #128 的惰性阶梯提前收成终态。
> ③**换表（这是判据失明，不是 churn）**：旧表（含 r168b/c）在 `cp>=4` 那一发就 `exit 0` —— 恰好在上述形状下**把目标第二支的覆盖关掉**。新表 `tmp/observe/r168d-verdict.log`（pid **97790**，24×600 s ⇒ 视界 ≈t 83,439,7xx）：`cp>=4` 记 `VERDICT-1` 但**继续跑**，只有 `state=integrating` 才记 `VERDICT-2` 并下班（`completed/failed/aborted` 与"键消失"仍各自报沿）。两臂离线验证**结果不同**（这是我刚写进长期记忆的那条规矩的现场应用）：`cp4only` 臂 ⇒ 三发连采不退出；`cp4+integrating` 臂 ⇒ 同一发连出 `VERDICT-1`＋`VERDICT-2` 后退出；测试副本与在跑那份只差 PATH 一行（diff 已证）。旧 pid 96231 已 kill 并在日志末尾留 NOTE。
> ④**同族提醒**：`canSpawnEvidence` 的 `hatchInProgress` 旁路我在 CP2 上记过一次（"水位型预报先问阈值会不会被消费掉"）；这次是它在 CP3 上的第二次发作——**同一个"瞬时水位判据"被三个 checkpoint 复用，任何一个都可能因那一拍池子没满而单拍为假**。⇒ 凡是"某一拍的结构事实 ⇒ 状态迁移"的预报，都要先问迁移条件里混了几个瞬时读项。
>
> 本轮状态（**未到拍子**）：t≈83,431,7xx，裁决窗 `[83,434,100, 83,434,500]` 还剩 ≈3,000 拍（@3.8 s/拍 ≈3.2 小时）；**在表两支＝`tmp/observe/r168d-verdict.log`（pid **97790**，24 发 × 600 s ⇒ 视界 ≈t 83,439,7xx）＋`tmp/observe/r164-queue.log`（pid 77019，剩 ≈65 发 ⇒ ≈t 83,441,4xx）**——`r168c-verdict.log`（pid 96231，在 `cp>=4` 就下班＝第二支会失去覆盖，见补17）、`r168b-verdict.log`（pid 90893，重播种后其"与硬编码基线比不等"的文案失效）、`r168-verdict.log`（pid 88697）、`r164-verdict.log`（pid 73248）三张都已下班且各自末尾留了 NOTE，**别再引它们的末行**。累计量已在 t≈83,431,816 重锚（现 `upgraded=0 / built=0`），判定改按方向；跨重启仍活的 Memory 锚：`cp=3 / economic_startup / LET 不存在 / CPT=0 / controllerProgressSeen=12,952 / controllerProgressChangedAt=83,424,421`（③那句"ext 数变了要重算天花板"因此**不需触发**——`built` 不动＝无新建造成交，天花板仍 ≈4,300 结构承载＋在途携带）。连续性两发免费自证：**`bandTicks` 6,309→7,414 恰好 +1.000/拍**，且 `shasum -a 256 dist/main.js` 前缀 `649eb94b9784…` == `check-code` 现读的线上 sha ⇒ 中间零部署（对端 `1f9cd035` 的 src 改动尚未推上线）。


### 4.0-pre（10-04 18:0xZ 改写，R160 补32；**上一条（R159 立的 objective：见证 CP4＋`integrating` 第一趟两键＋给 #120 补复证）本轮只拿到第三支**——#120 复证到手（8 发同拍分支排除：`reserve≈4,574~4,580` 顶在结构性承载天花板 ≈4,300 之上（算法见 #120 的补9／补22 逐级表）之上、退出线 15,000 高 2.8~3.3 倍，且 `ext=0` 故不需重算），**CP4 与 `integrating` 那两支未到手**：`kernel.expansion`@t≈83428100 现读 `state=economic_startup、checkpointsPassed=3、consecutivePositiveTicks=0、forcedAdvance=false、reservedEnergy=5000、startedAt=83425257`，卡点已判到"builder 车道"这一层（§3.5 #124 补31/补32：domain 层跑真函数证到会投 4 条 builder，而现场队列三发样本只有 3 条 upgrader），原文保留在下面的 4.0-pre 作状态出处）下一轮主目标：**读回判效器日志 `tmp/observe/r160-cp4.log`（`r160-cp4-watch.sh`，45 发 × 180 s，覆盖 t≈83428,1xx → 83432,6xx；读前先 `pgrep -f r160-cp4-watch` 证它还在，末行若是 `shift=exhausted` 只能记"未越阈"）见证 CP4 到手（`extensions.length ≥ 5 && containers.length > 0` ⇒ `checkpointsPassed 3→4`、`state` 进 `integrating`、`startedAt` 重置为当拍、`forcedAdvance=false`）的时刻与形状，并在进入 `integrating` 的第一趟 pass 上读 `lastEconomicEvalTick` 这个新键是否出现、`consecutivePositiveTicks` 首值（按原文第一趟必为 0，因为 `elapsed = ctx.tick − (lastEconomicEvalTick ?? ctx.tick)`）；若日志里没有 CP4 沿，就用同一份日志的 `Q=` 队列键列把 #124 那句"那一支 builder 从哪条通道离开"判进三支之一：出现 `builder:W38S58:*` ⇒ 被成功孵化摘走且需求在恢复／`spawnBlacklist` 出现 ⇒ purge 迟到（补32 ②(i) 复活）／两者都不出现而我算的 4 条始终不落 ⇒ 挡点在 `spawn-manager.ts:196` 之前，下一发读 heap 的 `globalThis.__churnCounter["W38S58"]` 与 `telemetry.skips` 的 `spawn/churn/builder/*`（**先证那两键有写者**）**

> ★**R160 补31/补32 留给下一轮的三条硬口径（都在本轮当场踩过）**：①**存续队列条目按构造永不续期**（`demand.ts:1001/1106` 对已在队列的 key 不再创建，`queue.ts:8-19` 的续期只在重新 push 时发生）⇒ 别拿 `expiresAt===createdAt+1000` 判"那趟没跑"，我这样错过一次；②`observe.mjs:459` 的 `queue=A/B` = `spawnQueueLength / buildQueueLength` ⇒ W38S58 的 `queue=3/24` 里 24 是建造队列条目数，不是需求缺口；③**`peek` 能区分"缺键"与"空对象"**（对 `kernel.tuning.rooms.W38S58.roleBounds` 印 `{}`，对 `rooms.W38S58.spawnBlacklist` 印 `不存在`）⇒ `spawnBlacklist` 缺键是"purge 从未在本房发生"的有效签名，可以放心用来否证 purge 支。
>
> ★★★**R160 补33（18:1xZ）改了上面那条 objective 的第三支内容，读 §4.0 时连同本块一起读**：builder 车道的拦截者**已经找到并在纯函数里复现**——**W38S58（RCL2）里有一间自有 `StructureStorage`**（`my=true/hits 10,000/能量 0/getCapacity=null/createdAt=undefined`），它同时点亮 `phase.ts:463 hasBank`（⇒ #120 的 crisis 钉）与 `demand.ts:1098`（⇒ crisis 的 `demandFactor=0.0` 把 builder 目标乘 0）。四臂复现：`recovery+storage` ⇒ **0 条 builder（输出与现场队列逐字相同）**、`normal+storage` ⇒ 1 条、`无 storage` ⇒ 4 条 ⇒ **绑住的是 crisis×0，不是 B-5 水位**。⇒ 上面 objective 里"三支择一"现在只剩两支活着，而第三支（"挡点在 `spawn-manager.ts:196` 之前"）**已被本条填具体内容 = §3.5 #122 的 ★★★补33 块**（我原立的 #126 是重复立案，已于补35 撤销并入 #122——同一间 storage 在 #120/#122 里早有登记）；`spawnBlacklist` 缺键那一支（purge）则被现读否证。所以下一轮真正要做的两件事：**(1) 读判效器日志找 CP4 沿**（若 `room.storage` 仍在场且 `colonyState="recovery"`，按 #126 它按构造不会来——`Q=` 里出现 `builder:W38S58:*` 才是本条的否证签名）；**(2) 原写"给 #126 补'来历'那一发"——已取消（补34/补35）**：那发仪器是**瞎的**（`gaps.ts:78` 只记 `gap>0` ⇒ 缺口审计按构造表达不了"超额"，`recordLayoutGaps` 又只在有键时落盘），而"来历"根本不是未定项——#120/#122 早已登记这是**接管/遗留**的 storage（`CONTROLLER_STRUCTURES[STORAGE]={1:0,2:0,3:0,4:1}` ⇒ RCL<4 时对象在场但 store 被禁用，`getCapacity=null` 就是这么来的）。⇒ 下一轮只需做 (1)，外加**若** (1) 里 `Q=` 出现 `builder:W38S58:*` 才回来重读机制。⇒ **对人而言结论换成更准的一句：CP4 的自然建成被一间不该存在的 storage 按住**（满建 RCL2 的 `reserve` 上界 ≈10.6k~12.6k < 出带线 15,000，而 container 额度在 RCL0-8 恒 5 ⇒ 只有 RCL4 解锁 storage 才跨得过去，而 RCL3→4 又需要 builder ⇒ 自指死锁）；解法要么动结构、要么把 `hasBank`/`demand.ts:1098` 从"存在"改成"能力"——**两者都属人，我不自办**。★**下一轮另有一件免费的事**：机器侧第二条出口已定位并算好时刻——`state-machine.ts:482-498` 在 `tick−startedAt > pioneerTimeout×2`（40,000 拍）且 `cp3.passed` 时走 `FORCED_ADVANCE` ⇒ **预计 t≈83,465,258（≈39.8 小时后，按当轮实测 3.9 s/拍；按日先区间 2.3~4.5 s/拍则 23.5~45.9 h）**，届时 `state="integrating"`、`startedAt` 重置、`forcedAdvance=true`，而 **`checkpointsPassed` 停在 3** ⇒ 到拍子上的读法是"objective 第二支的两键照样取（`lastEconomicEvalTick` 出现在 N+1、`consecutivePositiveTicks` 首值 0），但这条**不算 CP4 自然到手**"；判效器 pid 58241 只活 ≈2h15m ⇒ 重挂一支长视界的（间隔 600 s、上限覆盖 ≥40,000 拍），每发保留 `Q=` 列当否证位。

### 4.0-pre（10-04 15:3xZ 改写，R159；**上一条（R158 14:5xZ 立的 objective：见证 CP3 到手＋预先判清 CP5 双条件）当轮已收**：CP3 落在 pass `83425757`（`checkpointsPassed 2→3`、`state` 仍 `economic_startup`、`forcedAdvance=false`，由守望的"未变→变"沿读出），CP5 三段判据已按 `economic-activation.ts:91-134` 原文读全并判为"在 RCL/结构抬高三条路之前到不了"（⇒ 新立 §3.5 #120），原文保留在下面的 4.0-pre 作状态出处）下一轮主目标：**见证 CP4 到手（`extensions.length ≥ 5 && containers.length > 0` ⇒ `checkpointsPassed 3→4` 且 `state` 进 `integrating`）的时刻与形状，并在进入 `integrating` 的第一趟 pass 上读 `lastEconomicEvalTick` 这个新键是否出现、`consecutivePositiveTicks` 的第一个取值是多少（按原文它第一趟必为 0，因为 `elapsed = ctx.tick − (lastEconomicEvalTick ?? ctx.tick)`）；同轮给 #120 的自锁补一发复证：`reserve` 顶到该房现结构承载天花板（R159 实算 ≈4,000~4,300；**R160 补3 修正为 ≈5,300**——`reserve` 构项含 `creepEnergy`，见 §3.5 #120）而 `phase` 仍 `"crisis"` ⇒ 坐实"退出线高于天花板"，若 `ext` 数变了则要重算天花板**

> ★★**R160（10-04 15:3xZ，objective 未到手，但把上一轮的机制说法当场打折了＋审计拿到第二条支路）**
> · **CP4 判"到不了"**：`R160C1@83425875` = `ext=0`、三张 extension 工地进度 `286/1,206/0`（各需 3,000）、另两张工地**尚未创建** ⇒ 剩余 13,508 进度；斜率两把仪器：当窗 `bk.built 50/50 拍=1.0/拍`、跨窗 `built 2,796→3,414 / ≈815 拍 = 0.76/拍` ⇒ **13,500~17,800 拍 ≈ 10~13 小时（当窗拍长 2.65 s/拍）**，**R158 补27 的"3.4~5.2 小时"作废**（它用的是 3.2/拍的窗；同窗长差 4 倍的教训第二次）。
> · **★补4 CP4 的两个合取项逐个对上原文与现场（把"到不了"改写成"欠什么"）**：`state-machine.ts:441-446` ⇒ `extensions = FIND_MY_STRUCTURES.filter(STRUCTURE_EXTENSION)`（**工地不计**）、`containers = FIND_STRUCTURES.filter(STRUCTURE_CONTAINER)`（现场 2 只 ⇒ **`containerBuilt` 已为真**）。⇒ **CP4 只剩一个欠项：落成 5 只 extension**（5×3,000=15,000 进度，已投 1,492，且**还需新建 2 张工地**，限额允许）。⇒ 报价一律用"拍"：`13,508 ÷ 0.76~1.0/拍 ≈ 13,500~17,800 拍`；**拍长这次给两把仪器**：`observe.mjs` 自报 2.65 s/拍（内部 10 拍差分），**Memory 派生法**用守望的 `bandTicks Δ22 / 墙钟 Δ102 s = 4.64 s/拍`（`room-state interval:1` ⇒ 每拍一次；若内核让位跳过拍，它只会低估拍数、即高估拍长，方向已知）⇒ **换算写成 10~23 小时的区间**。★新方法登记：**用每拍计数器（`bandTicks`）当拍长仪**，比观测器自报更独立。
> · **★补5 CP4 的门槛是"读出来的"而不是推的：每房 site 名额**。heap 直读 `globalThis.constructionSkips.rooms.W38S58`（写者 `construction-manager.ts:290-300`；`:274-275` 注明它**每 `skipReportInterval` 拍输出后清零、不上 Memory ⇒ 只能现读、换码即失**）＝ `{per-room-site-cap:extension:190, :container:95, :road:1520}`（`R160C8@83426194`）。⇒ **该房吃到的拒绝全是配额类**，没有 `lane:*`／能量线／`tick-quota` ⇒ "crisis 把开发通道按住、顺带把 CP4 也门住"这一支**否证**。配额原文 `:425-440`：road 桶 `maxRoadSitesPerRoom=2`、其余（含 extension）走 `maxNormalSitesPerRoom=3`(`config/index.ts:290`) ⇒ 现场在册 site 恰为 `extension×3 + road×2`＝**两桶全满**，队列里那 2 张 extension（`state:queued, attempts:0`，`attempts` 经 `Object.keys(q[0])` 确认为真字段）只能等名额逐个释放。⇒ **CP4 是串行建造**（"缺 2 张工地"是名额设计的必然，不是排产缺陷）；总欠 13,508 进度不变；**能加速的两根杆＝每房普通 site 名额 与 builder 只 1 只（角色普查 harvester3/hauler2/distributor1/carrier2/builder1，实测 1.0/拍 ≈ 五成利用率）**，两根都属排产/阈值决策 ⇒ **摆数不自办**。
> · **★复证判据再校准（同一拍里 reserve 增速已塌）**：守望 `reserve 3,301@15:54 → 3,360@15:55:45 → 3,387@15:57:28`（+59 ⇒ +27/103 s，斜率缩到 1/2）⇒ 平台值可能只到 **≈3,600~4,000**（现建档上限 4,300 = 2×2,000 container + bay 300，creepEnergy 抖动）。⇒ **判据改成"斜率归零"而不是硬阈 4,000**：`reserve` 连续 ≥4 拍不涨（±50）且窗口内 `drainScore max ≤5` 且 `phase` 仍 `"crisis"` ⇒ 记为"现建成档的自锁复证"。守望（pid 46054）到 24 拍自然下班（≈16:28Z），**序列本身就是证据**，不必依赖 POSITIVE-HIT。
> · **★补7 预写"CP4→integrating"的两趟签名（到手时不许临场解释）**：**时刻自带**——`state-machine.ts:474-479` 换态时做 `state="integrating"; startedAt=ctx.tick` ⇒ **读 `expansion.startedAt` 的新值就是那一拍**（`checkpointsPassed` 用 `Math.max(…,4)`，不携时间戳）。第 N 趟：`cp 3→4`＋`state→integrating`＋`startedAt` 跳变＋`forcedAdvance` 仍 false（true 就是 `:482-500` 超时强推；超时点在 `83425257+pioneerTimeout×2=83445257`）；**该趟 `lastEconomicEvalTick` 应仍缺键**（`switch:85-142` 按当前 state 分派，这趟还在走 `advanceEconomicStartup`）。第 N+1 趟（首趟真跑 `advanceIntegrating`）：**`lastEconomicEvalTick` 首次出现且等于该趟 tick**（`:543-544`），**`consecutivePositiveTicks` 应为 0**（`:543` 的 `elapsed = ctx.tick − (lastEconomicEvalTick ?? ctx.tick)` 首趟取 `?? ctx.tick` ⇒ elapsed=0），第 N+2 趟才第一次出现 ≈400~900 的跳增。**若 N+1 读到 >0 ⇒ 我对分派顺序的理解错，当场认账。**
> · **★补10 这台仪器已端到端验证过才进判据链**（用户记忆那条"新写的读数工具没跑通就别进判据"）：heap 直读 `globalThis.executionDashboard`（`R160D2@83426370`）= `{tick:**83426257**, executionState:"economic_startup", checkpointsPassed:3, consecutivePositiveTicks:0, progress:0, summary:"[83426257] expansion: W38S58 state=economic_startup cp=3/5"}`。⇒ ①**pass 节拍第 5 个实测值 500**（序列 500/400/500/**500**，`83425757 → 83426257`），下一趟预计 ≈`83426,7xx`；②**读 CP4 时刻的正解**＝`dashboard.tick`（最近评估拍）与 `kernel.expansion.startedAt` **同拍**才算"CP4 就在 T 那拍到手"——单独引 `dashboard.tick` 会把"评估过"读成"通过了"；③⚠️**`progress` 字段在 economic_startup 期间恒 0**（`getExecutionProgress(state)` 的这一档没给我期望的量纲）⇒ **不要拿它做判据**，只用 `checkpointsPassed` 与 `executionState`。
> · **★补8 "装满 vs 没钱"分辨掉了：是装满**（用 **segment 通道** `econ-ring.mjs`，与 peek 不同限额桶、不受 429 影响）：W38S58 每 50 拍一格 `rs 3,261→3,361→3,461→3,533`（**+2/拍稳定爬**）、**`ea=300/300` 全程满**、`se=0`（null-capacity storage 恒空）、`hc` 3→2（换血中但收入未塌）。⇒ 结构侧上限 `2×2,000+300 = 4,300`，距上限 ≈767 ÷ 2/拍 ⇒ **≈380 拍（当窗 4.6 s/拍 ≈29 分钟）到平台** ⇒ **#120 的经验复证重新可达**（守望 `reserve≥4000` 会在 ≈16:2x~3xZ 触发；若它先下班，补一发 `econ-ring.mjs` 即可接续）。⚠️**口径**：`econ-ring.rs` 是"房内被跟踪池"，`phase.reserve` 还含 `creepEnergy/terminal/storage`（`room-state.ts:43-51`）⇒ **判"顶到天花板"以 `phase.reserve` 为准、`rs` 只作对照**，别把 4,300 配错对象。
> · **仪器失败形状（已按规矩处理）**：读 heap `systemLastRun` 那发 console **读回超时 32 s**（`m=R160C9`）⇒ 未重试、未去捞 `__evalResult`，改用上条 `startedAt` 自带时刻的方案 ⇒ **本轮不再引 `systemLastRun`**。
> · **★补11 把"顶到天花板"拆成三层，防止下一轮把"没到 4,300"误读成"判据被否证"**：池子拆解（`R160D4@83426396`）= `cont=[2000,1232]`（**第一只 container 已满**）、`ea=300/300`、`creep=189`、**`loose=262`（地上有能量）**；恒等式 `300+3,232+189 ≈ 3,721` 对得上同窗 `reserve 3,627~3,715`（守望第 13/14 拍 3,715/3,631 ⇒ **平台 ≈3,650~3,700**）。⇒ **L1 局部层已发生**（某只 container `used==capacity` 且 `loose>0` ⇒ "没处可放"，与 #58 那条搬运损耗口径不同族）；**L2 现建档（≈4,300，两只 container＋bay 全满）未发生**；**L3 法定满建档（≈10,550）要 5 只 container，属排产结果**。⇒ 固定报告口径：**只有 L2/L3 才能用来"坐实退出线高于天花板"，L1 不行**；目前事件级复证**未到手**，结构性论证靠补9 那张**常量级**逐级表（10,550 / 10,800 / storage 1e6 要到 RCL4）。⚠️造名失败第 2 次同轮兑现：`FIND_DROPPED_ENERGY` 不存在（真名 `FIND_DROPPED_RESOURCES`），一发 ReferenceError 又废掉一个观测点 ⇒ **引 `FIND_*` 前先查 `src/types` 的确切名字**。
> · **★补16 CP4 的串行建造第一次有逐工地差分，并留下两个可证伪的中间事件（不必等 5 只全建成）**：同路径两读 `R160C1@83425875` → `R160D7@83426653`（Δ778 拍）：`57bc` **1,206→1,706（+500 ⇒ 0.64/拍）**、`5fda` **286→286 不动**、`7cb6` 0、两张 road 0；builder 只有 `-z8` 一只（`assignment.kind=build`，背包 50）⇒ **单 builder 只喂一个工地，"串行"从规则推断升级为现场事实**。
>   · **P1（链条是否在动的判据）**：`57bc` 完成后（剩 1,294 ÷ 0.64 ≈ **2,020 拍** ⇒ ≈`83428,7xx`）**必须**在 ≤1,000 拍内看到 extension 工地数 2→3（`normalSites` 3→2 释放名额，队列里 `state:queued` 那两张转 `site`）。**若没有** ⇒ 现读 `globalThis.constructionSkips.rooms.W38S58` 看是否冒出 `lane:*`／`no-eligible-task`／`tick-quota`（16:1x 那发只有 `per-room-site-cap:*`）⇒ 那就是 **#121 的"名额释放没生效"新分支**，单独立案。
>   · **P2（ETA 按新差分重算）**：剩余 `13,294` 进度 ÷ **0.64~1.0/拍** = **13,300~20,800 拍** ⇒ 按拍长两法（2.5~4.3 s/拍）= **10~25 小时**。比补4 的 13,500~17,800 更宽，因为 0.64/拍 才第一次把"builder 分给 road/其他工地的时间"算进去。⚠️**不许把 25 小时读成"CP4 到不了"的定罪**——链条是否动由 P1 判，不由速率判。
>   · **同拍复核**：`ext=0` ⇒ **天花板未移动**，补13 的实测 4,300 继续有效（objective 里"ext 变了要重算"这个触发条件目前不满足）。而 `r160-l2` 第 3 拍（16:28:23）`{phase:"crisis", reserve:3,948, drainScore:0}` ⇒ **补15 三条件里已有两条成立**（带内＋分数清），只差 `reserve ≥ 4,250`；第 2 只 container 1,528/2,000 以 ≈1.3/拍 在填 ⇒ 预计 ≈16:45~17:00Z 顶格（守望到 ≈16:53 下班，可能差几分钟——**若表先下班，下一轮补一发同路径 peek 即可接续**）。
> · **★★★★★补18（16:4xZ）objective 第三半到手：`reserve` 顶到天花板而 crisis 不放行的事件抓到了**——守望第 6 拍 `POSITIVE-HIT(L2)`，同拍两把仪器：Memory 侧 `{phase:"crisis", reserve:**4,363**, drainScore:0, liquidityScore:0, srcStallTicks:0, bootstrapTicks:0, bandTicks:2,918, rcl:2}`，物理侧 `R160D9@83426870` **`contUsed=[2000,2000]`（两只 container 满到 capacity）**、`ea=17`、`storeCap="null"`、`ext=0`。⇒ 该拍五支（`:517/:519/:521/:524/:526`）全不可用 ⇒ **只剩 `:528 bankrupt` 能产出 crisis** ⇒ #120 从推算升为**观测**。⇒ **顶格值引用一律改写成 ≈4,300~4,400**（实测 4,363 比结构侧 4,300 多出的 63 来自 `creepEnergy` 的 home 归集；`ext=0` ⇒ 未触发"重算天花板"条件），退出线 15,000 = 顶格的 **3.44 倍**。
>   · **判定形式如实交代两条**：①我自己定的"窗口内 `drainScore max ≤5`"**未满足**（同窗口 16:25:21 读到 14.33 的分数脉冲）；②但该条件要排除的混淆已由**同拍分支排除法**排除 ⇒ 本半判到手，依据写成"同拍分支排除"，14.33 那次"分数通道确实挡过"不删。
>   · **出口只剩三条，全属人**：修 #122（遗留 storage 不再被当"有银行"）／爬 RCL4（被 #123 与需求丢失那条链拖着）／降 `sustainedStorage`·`bankruptExitMargin` 这类水位阈值（**不自办**）。
> · **★补23（17:1xZ）三件事同拍：补14 的周期预报被证实、我给 #117 加的"0 送达循环"降格为"每代一次"、#117/#122 拿到干净控制组**——新代 op `{createdAt:83427272, retries:0, deadline:83429204, carrierName:…-ze/-zf}` ⇒ 旧代在 deadline 后 **68 拍**被同 id 重建（且**旧 `expired` 行不留**⇒ 判"重建过"要看 `createdAt` 换代，别去找 expired）；新一代把 `carrierName` 绑到**活** creep ⇒ W38S56 那条立刻 `verifying` + **`deliveredAmount:1200`** ⇒ **审计那条"`carrierName` 永不清除"仍对，但损失单位是"每一代"不是"永远"**（本条上面我写的"0 送达循环成立"按此降格）。
>   · **控制组**：同代、同样活绑定 ⇒ `imported` 累计 **W38S56 = 71,985**（15:3x 的 47,605 → +24,380）对 **W38S58 = 0**（自 boot 83422285），其 op `deliveredAmount` 亦 0 ⇒ **唯一机制差别就是目标房那间 `getCapacity()=null` 的遗留 storage**（`carrier.ts:44` 的 `null<=0` 为真）⇒ #117/#122 升为**有对照组**的定罪。
>   · **regime 已变（引用边界，别拿旧样本描述当下）**：W38S58 现读 `{phase:"crisis", reserve:4,016(首次回落), reserveDelta:−1, drainScore:**41.11**, liquidityTrapTicks:**16**}` ⇒ 分数通道重新在挡（`:519`），流动性陷阱在攒驻留（bay 45/300 以下 + container 全满 ⇒ `frozenRatio=1.0`，到 50 拍才计分）⇒ **第三半那七发同拍分支排除样本仍是它们那一拍的有效证据，但 17:14 之后不许再写"此刻只有 bankrupt 在挡"**；要再判须重新凑"分数清 + 顶格"的同拍样本。
> · **上一轮结论被第四次读数改掉**：`phase.drainScore 0(三连读) → **57.06**`、`reserve 2,354→2,214`（首跌）⇒ `crisisScore=57 ≥ drainExitScore 30` ⇒ `:519` 分数支也在独立开 crisis ⇒ **#120 的复证判据升级为双指标**："reserve 顶到承载天花板 **且** `drainScore ≤ 5` 时 phase 是否仍 crisis"，且**同一瞬间对齐两个瞬时值不算数**（补1：`drainScore 57.06@83425855 → 0@≈83425,9xx` 相隔百余拍、`reserve` 反而 2,214→2,647，因正 `reserveDelta` 那拍回落系数是 `(|Δ|/3)×2.67` ⇒ 它是脉冲＋快衰量）⇒ **正确做法：用守望序列对 `drainScore` 取窗口 max**。方法论：分支型结论必须标读数次数/跨度，下轮无成本复采一次。
> · **审计"0 送达循环"的第二条支路（不矛盾、更具体）**：两条 op `retries:1 / lastError:"reservation expired"` 而 `status=running` ⇒ 绑住的是**预留 TTL 500 拍 → blocked → ready → running**，不是 `checkExpiry(2,000 拍)`；`3×500=1,500 < 1,932` ⇒ **`maxRetries=3` 先到 → failed → 同 id 重建**。可证伪：`createdAt=83425272` 的两条应在 ≈`83426272` 前后 retries=3 并转 failed；读到 `expired` 则我这条错。
> · **一次被读数挡下的错判**：我原要写"建造在给 crisis 记分"，同窗 `bk` 显示支出里 `spawned=300`、`built=50` ⇒ **该窗不成立**（判定要跟着 `bk` 的列分配走）。`pl` 末位 `-100` 是 `looseDelta`（`accounting.ts:399-408` 原文），不是负池——先读原文才没登记成异常。
> · **★补2（15:4xZ）判掉一个"按构造不可达"的候选（objective 的关键前置）**：`R160C3@83425998` 现读 `CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION] = {0:0,1:0,**2:5**,3:10,4:20,…}` ⇒ **RCL2 的 extension 限额 = 5** ⇒ `state-machine.ts:457` 的 `extensions.length >= 5` 与注释 "RCL2 = 5 extensions" 在本服成立 ⇒ **CP4 不需要 RCL3，唯一约束是建造进度**（≈13,500 拍量级）。同发读到 `STORAGE_CAPACITY = 1000000` 是**平值标量** ⇒ 我 15:2x 写进 §3.5 的 #117 根因（"按等级索引的容量表在 RCL2 无值"）**撤回**；`R160C4@83426004` 给正确机制：`CONTROLLER_STRUCTURES[STRUCTURE_STORAGE]={1:0,2:0,3:0,4:1,…}`、`ruins=0`、`my=true`、无参 `getCapacity()` 亦 null ⇒ **"结构在场但 RCL 未到 ⇒ store 被禁用"**。⇒ #120 因此从"偶发数据异常"升级为**接管房的常规阶段**（每个带遗留 storage 的接管房在爬到 RCL4 前都会被 `bankrupt` 钉住），而扩张链上真被 storage 门住的只有 CP5 的 `selfSustaining` 与"援助能否落进 storage"。
> · **两条新的 console 失败形状**（均零副作用，但要记账）：①`expression size is too large`（≈1,100 字符／8 键拼一发被服务端直接拒，`ok=undefined`、`__evalResult` 未写）⇒ 胖表达式拆开发，阈值在 ~1 KB；②`ReferenceError: EXTENSION_CAPACITY is not defined`（本服无此全局 ⇒ 又犯"任何标识符都算造名"，一发 ReferenceError 让整条表达式作废）⇒ 不确定的常量一律包 `typeof X==="undefined"?"ABSENT":String(X)` 或不引。
> · **控制面**：两 container 的 `getFreeCapacity` 实读 514/1,414 正常 ⇒ null 只在 storage（#117 作用域第三次收窄）。`G6档位` 本轮现读 **`constrained@83425106`**（调度 tier 仍 healthy、bucket 10,000）；dashboard 现读 `Blocked=G0+G2+G3+G4+G6`。

### 4.0-pre（10-04 14:5xZ 改写，R158；**上一条（R143 立的 objective）当轮已收：①②③ 三读数全中 ＝ 第三次扩张的「承认链」第一次被直接验证**，原文保留在下面的 4.0-pre 作状态出处）下一轮主目标：**见证 W38S58 从 `economic_startup` 往 `integrating` 走的第一段：CP3 到手的时刻与形状（`checkpointsPassed` 2→3），并把「进入 `integrating` 后的第一道判据 = CP5 双条件」在 carrier 线仍在时究竟可达不可达预先判清（含 supply 线的退役条件与 #117 的账本侧后果）**

> ★★★★★**R158 结案：三读数全部到手（每条都有命令＋时刻＋读数），闭环承认链第一次被直接验证**
> · **① 自有 spawn 建成 ＝ YES**：`83424480` 起 `Game.spawns` 含 **`Spawn7`** 且 `room.name === W38S58`；四把仪器同向（工地表空、`buildQueue` 里 spawn 条目消失、自孵 creep、`bootstrapDiag.hasSpawn 2→3`）。
> · **② `kernel.bootstrap` 条目被删 ＝ YES**：pass `83424857` 之后 `kernel.bootstrap = {}`，**且无 `abandoned` 字段 ⇒ 排除弃房支**；`pushed:0 / decisions:0` ⇒ **代孵通道对该房关闭**（R143 预言「一清就没有替补」，已兑现）。
> · **③ `kernel.expansion.state` 离开 `bootstrapping` ＝ YES**：**`83425257`** 那趟 pass ⇒ 现读 `state="economic_startup"`、**`startedAt` 重置为 `83425257`**、`checkpointsPassed 1→2`、**`forcedAdvance=false`** ⇒ 走的是 `state-machine.ts:307-310` 的**正常 CP2 路径**，**不是** `:348` 的超时强推（超时点在 `83429857`，尚未到）。
> · **一条诚实的未证半边**：**「CP2 的两个合取项里，`83425257` 那一拍究竟哪一个为真」我没采到**（守望脚本不取 `ea`/`spawning`，我的事后单发读数拿的不是那一拍）。⇒ 只能判「CP2 整体为真」，**不许回头写成「`ea≥300` 先到」或「撞上在孵先到」**；补24/25 曾把 F 支（`ea→300`）列为最可能，这一支**未被证实也未被否证**。下一发若想在 pass 同拍取到 `ea/spawning`，得给守望脚本加这两列（heap 读数，要 console ⇒ 与对端抢 `__evalResult`，谨慎）。
> · **pass 节拍的第三个实测值（同一会话内 400~500 拍摆动）**：`83424357 → 83424857`（500）、`83424857 → 83425257`（**400**）⇒ 与补10/19 的结论一致：**`scheduler.ts:189` 的峰值闸把 P3 的 pass 拖到 nominal `interval=100` 的 4~5 倍**，而**这不是扩张链故障**（承认最终都到了，只是慢）。
> · **objective 的第二半（预先写下下一态第一道判据）**：已逐字读码并写在上面各「补」里 —— CP3 三个合取项（`:401-438`＋`checkpoint.ts:168-181`，全建于 `colonyCreeps :377-381` 的 `memory.home` 筛）、CP4 要 5 只 extension（`:449-478`，现读 `site ×3`）、**且 `cp→3` 必在 ③ 之后的下一趟 pass**（`advanceExpansion:88-94` 的 switch 按当前 state 分派）。现场侧已就位：自孵 `harvester×2 + hauler×1` ⇒ **CP3 三项里两项已在场**。

> ★★★**R159 预判（15:0xZ，读码＋一次 peek）：objective 第二半有答案了 —— 援助线的退役条件是 `colonyState`，不是收入；我上一轮的"CP5 按构造不可满足"说过头了，此处更正**
> · **链（逐行核过）**：`agenda-manager.ts:333` `entry.needsAid = needsEnergyAid(profile)` → `:339 getDeficitRooms(registry)`（只收 `needsAid` 的房）→ `:353 buildDemandNodes(deficitRooms, inTransitByTarget, tick)` → supply/demand 匹配产生 Operation → Operation 驱动 carrier 编制（`memory.role=carrier`、`remoteTarget=目标房`、`home=sponsor`）→ `state-machine.ts:848-853 estimateExternalInflow` 数这些 creep × 50 ⇒ `externalEnergyInflow` ⇒ `economic-activation.ts` 的 `selfSustaining = externalEnergyInflow === 0 && netPositive`。
> · **`needsEnergyAid` 只有三条（`room-profile.ts:359-364`）**：①`isStruggling` 直接为真；②`!netFlowPositive && riskBuffer < 400`；③`storageRatio < 0.1 && estimatedIncome < 5`。而 **`isStruggling = colonyState ∈ {bootstrap, recovery, defense}`（`:292-293`）**。⇒ 现读 **`rooms.W38S58.colonyState = "recovery"`** ⇒ **第①条已经单独把援助钉住，与收入/储量无关**。
> · **★★更正我自己**：上一轮（R158 补6/补19 与 §3.5 #117 那条"三重叠加"）我写的是 **"只要 sponsor 还派 carrier，`selfSustaining` 恒假 ⇒ CP5 的自然完成路径**按构造不可满足**"**。**"按构造"是错的** —— 正确说法是：**援助期由 `colonyState` 决定，而 `colonyState` 会随该房经济压力自己翻**（现场 `economyPressure=0.5`、`economy.nf=+57` 已为正、`ea=300/300` 满 bay、自孵 `harvester×3 + hauler` ⇒ 该房正走在脱离 `recovery` 的方向上）。⇒ **CP5 是"有界可满足的闸"，不是死锁**；这恰好是我自己记忆里"第 7 类：把有界可满足的闸说成按构造不可满足"的**再犯**，已在用户记忆对应条目下加一条。
> · **但 #117 有一个新的、更精确的后果（假设级，判据已备好）**：`inTransitByTarget`（`:341-350`）按 **`requestedAmount − deliveredAmount`** 统计"在途"，而 #117 使 `deliveredAmount` **永远不涨**（carrier 到房却卸不进 storage）⇒ **在途量会长期吃掉该房的 demand 读数** ⇒ 可能出现的形状是"**既不再多要、也永远收不到**"。判别位：同一房连续两次读 `Operations` 里 selfaid 型 op 的 `requestedAmount/deliveredAmount/status` 与 `expiresAt` —— **若 delivered 恒 0 而 op 长期 running/到期重开 ⇒ 坐实**；若 op 有明确到期且退役后不再重建 ⇒ 我这条假设作废、援助线自然停。⇒ **下一轮的"两个阈值"里，op 的到期/完成条件是必查项**（`releaseReservation` 出现在 `agenda-manager.ts:281/677`，说明存在终态出口）。
> · **CP3 的形状预告（照此判，不许口头挪）**：`advanceEconomicStartup:401-438` 三项现读 = `harvesterActive`（在场 3 只 harvester、home=W38S58）**真**、`transporterActive`（hauler 在场）**真**、`spawnCanSpawn = ea≥300 || 正在孵` ⇒ 现读 **`ea=300/300` 真**。⇒ **下一趟 pass（预计 tick ≈`83425,7xx`，pass 节拍实测 400~500）应看到 `cp 2→3`**；**同趟不会同时进 `integrating`**（CP4 要 5 只 extension，现读 `extension site×3 + queued×1`、落成 0）。若 `cp` 未动：先查 `colonyState=recovery` 期间该房 spawn 是否在孵（`hatchInProgress` 与 `ea` 同时为假的窗口）而不是先怀疑状态机坏了。

> ★★★★★**R159 补1（15:2xZ，读码＋7 发 peek＋3 发 console）：objective 第二半的答案换了机制——把 W38S58 钉在 `recovery` 的不是收入，是 `phase.ts:528-529` 的 `bankrupt` 兜底支 × 一间 capacity=null 的遗留 storage。我 15:0x 那条更正只对了方向、错了机制，此处再更正一次；并新立 #120**
> · **排除法（不是猜，逐支核过原文）**：现读 `phase={phase:"crisis",reserve:1560→1718,reserveDelta:+4,drainScore:0,liquidityScore:0,liquidityTrapTicks:0,bandTicks:1710→1762,srcStallTicks:0,bootstrapTicks:0,rcl:2}`。`crisisScore=max(0,0)=0` 过不了 `:517/:519/:521` 任何一条（150/30/5）；`dwellSatisfied`（`:491`，`minBandTicks=100`）真；`forceCrisis` 早返支（`:392`+`:497-509`）要 `srcStallTicks≥50` ⇒ 现读 0 排除；`understaffedSustained` 要 `bootstrapTicks≥20` ⇒ 0 排除；`rcl<8` ⇒ `steady` 排除。**只剩 `:528 bankrupt`**——它是唯一能同时给出 `crisis`＋分数全 0＋`bandTicks` 继续 +1 的分支。隔 52 拍二读（`bandTicks 1710→1762`）证明 room-state 每拍在跑、写侧 `room-state.ts:151-172` 落的正是本次 `phaseResult` ⇒ 不是陈旧读数。
> · **`bankrupt` 三个合取项逐个现读**（`:466-471`）：①`hasBank = input.storageRatio !== undefined`（`room-state.ts:139-144`：`snapshot.storage ? used/cap : undefined`）②带内 `bankruptFloor = sustainedStorage(10000, `config/index.ts:436`) × bankruptExitMargin(1.5) = **15,000**`③`reserve < 15,000`。console 三发（mark R159B1/B2/B3，全部带回、无超时）：`{rcl:2, hasStorage:true, structs:["controller","storage","spawn"]}`、`{my:true, used:"0", **free:"null", cap:"null"**}`、`{buildQueue 里 storage 条目=0（types 只有 extension/road/container）, ticksToBuild:undefined}` ⇒ **该房的 storage 不是我们造的**（接管时引擎侧留下），且它的 capacity 读不出来。**关键：`used/cap = 0/null = 0` 而不是 `undefined` ⇒ `hasBank` 为真 ⇒ "有银行"这个前提被一个存不了东西的对象满足了。**
> · **同一条 null 把 #117 的机制收窄**：`carrier.ts:44` 是 `getFreeCapacity(energy) <= 0 → return undefined`，而 JS 里 **`null <= 0` 为真** ⇒ carrier 对这间 storage **永不卸能**；`room-snapshot.ts:114-120` 的 `fillTargets` 同形（`null > 0` 为假 ⇒ 被剔出 fill 目标）。⇒ #117 根因候选从"本服某种结构 store 异常"具体化为 **"`STORAGE_CAPACITY[level]` 在 RCL2 无值 ⇒ capacity 返回 null"**，且只在"遗留下级 storage"这种形状上出现——控制组：W38S56 的 storage `used=148,848` 正常入账（`imported=47,605`）。
> · ★★**R160 补2 把上面那句根因撤回（常量现读否证它）**：`R160C3@83425998` ⇒ `STORAGE_CAPACITY = 1000000`（**本服是平值标量，不按等级索引** ⇒ 不存在"无值"）；`R160C4@83426004` ⇒ `CONTROLLER_STRUCTURES[STRUCTURE_STORAGE] = {1:0,2:0,3:0,4:1,…}`、`ruins=0`、`storage.my=true` 有正常 id、**无参 `getCapacity()` 也是 null**。⇒ 正确机制：**"结构在场但等级未到"**——RCL1-3 允许的 storage 数量是 0，而这间房 RCL2 却有一间遗留 storage，其 store 被引擎禁用 ⇒ capacity/freeCapacity 返回 null。这条改写**提高了 #120 的普遍性**（见该条 R160 补2 段）：凡接管房在爬到 RCL4 之前都会经过这段"storage 对象存在但不可用"的窗口，`hasBank` 因此恒真。
> · **objective 第二半的终版答案（链到行号）**：CP5=`allCriteriaPassed && consecutivePositiveTicks≥500`（`economic-activation.ts:123`），`selfSustaining = externalEnergyInflow===0 && netPositive`（`:87-89`），`externalEnergyInflow = carrier 数 × 50`（`state-machine.ts:848-853`）。carrier 由援助线供给：`agenda-manager.ts:333 needsAid`→`:339 getDeficitRooms`→`:353 buildDemandNodes`→op→carrier；`needsEnergyAid`①`isStruggling`（`room-profile.ts:359-364`）＝`colonyState∈{bootstrap,recovery,defense}`（`:292-293`）＝`phaseToColonyState(phase,…)`（`phase.ts:558-563`）。⇒ **退役条件是一条绝对水位线（reserve 攒到 15,000），不是"收入转正"**——`netFlowMean_d=+7.7`、`reserveDelta=+4` 都已为正，房仍在带里。
> · **不许回头加固"按构造不可满足"**（我用户记忆里第 7 类那条的约束仍生效）：`reserve≥15,000` ⇒ `bankrupt` 假 ⇒ `growth` ⇒ `normal` ⇒ 不再产新 op ⇒ 在场 carrier 在一个寿命（实测 ≈1,500 拍）内归零 ⇒ `externalEnergyInflow=0` ⇒ CP5 第一条件可达。有界性给数是**带出处的区间**：现 `reserve 1,718`，速率只有一发 52 拍窗（+3/t）⇒ **≈3,000~13,000 拍（≈3.5~15 小时，拍长按当窗 4.2 s/拍）**，按【外推前先标样本出处】不许写成承诺。反过来说：**在这条水位线到手之前，帝国每 100 拍都会给一间"物理上收不下能量"的房重产一条援助 op。**
> · **一条自我校正的旁枝（免得下轮误算）**：`kernel.agendas` 的两条 op 里只有 `supply:W37S58:W38S58:energy`（requested 3,400）属援助线。另一条 `…:W38S56:energy`（1,800）**不是**——W38S56 现读 `colonyState="normal"`、`phase="growth"`、`netFlowMean_d=+57.9`、storage 水位 0.149 ⇒ `needsEnergyAid` 三条全假 ⇒ 进不了 `getDeficitRooms`，只能来自步 13.5 的 **Plan 驱动支**（`:478-511`，`req.scope==="empire"`，`deadline=min(req.deadline, tick+2000)`）。
> · **"幻影在途"不立新案——`audit/` 里早有第二种说法且已核实**：`audit/units/W24.index.tsv:20` F5「`carrierName` 已置时永不补派，op 卡 running 直到 deadline」＋ `audit/units/TR.md:118-127`（`:565 if (!inQueue && !op.carrierName)`、"`carrierName` 只在 `:576` 写、**全仓无任何清除点**"、"停在 running 直到 `checkExpiry`(2000t) → expired → **同 id 重建** ⇒ **0 送达循环成立**"、`replan.ts:38` 的 `case "carrier-death"` **零 importers**、`deliverySnapBefore` **只读不写** ⇒ A4.4 恒走 fallback）。**现场增量**：本轮第一次在生产里抓到它的形状——两条 `running` op 的 `carrierName` 分别是 `carrier-W37S58-0-83423680-xf` / `…-83423748-xg`，而 `Memory.creeps` 里**这两个名字都不存在**（该代寿命 ≈1,500 ⇒ 约 `83425180/83425248` 已亡），在场活口是同源的 `-83425273-z4`（remoteTarget=W38S56）与 `-z5`（W38S58），两条 op `deliveredAmount` 均 0。
> · **新立 #120（只摆数、不动码、不动阈值）**：`phase.ts:528` 的破产兜底用 `snapshot.storage` 的**存在性**当"有银行"，撞上本服第三态（对象在、capacity=null、余额 0）⇒ 幼房被 15,000 的绝对线钉在 crisis ⇒ 援助线不自退＋CP5 在攒够前不可达＋`empire-health`/G3/G4 消费方吃一个"永久恢复态"标签。该支注释（`:470-471`）原文就是"没有 storage 就不判破产，否则早期房被永久钉进危机带"——**设计者躲的是同一件事，但没预料到"有对象却存不了东西"**。修法三个候选摆给人：`hasBank` 改判"capacity 可读且 >0"／`storageRatio` 为 null·NaN 时视为 undefined／该房按遗留结构特判。
> · **CP3 仍未到手（不是预报被否证）**：守望 `r159-cp3.sh` 第 1~11 拍全 `same cp=2`、`diag.tick=83425257`，结案时点 `83425691`＝距上趟 pass 434 拍，仍在我预写的 400~500 拍带内 ⇒ **判"还没到"**。守望跑到 40 拍（≈16:19Z），下一轮直接读 `tmp/observe/r159-cp3.log`。
> · **边界**：只动②层，**零 src/push/build/npm**（`dist/main.js` 未碰；`check-code` 现读 **live sha == 本地 `649eb94b9784`**，并新登记一条工具口径：`check-code.mjs:25-26` 打的"bytes"实为 **utf8 字符串长度**，`stat` 现读 789,579 bytes vs 它报 787,752 chars ⇒ 差值就是中文注释的多字节，**判码只看 sha，别拿这两个数相比**）。探针 `check-code×1+observe×1+peek×7+console×3`。

> ★★★★★**R159 补2（同轮 15:2xZ，读数把上一发结论又收紧了）：`bankrupt` 的退出线 15,000 高于该房现结构的物理承载天花板 ⇒ "≈3,000~13,000 拍自然攒到"那句作废（作废的是我 40 分钟前自己刚写的那半句），正确说法是"在现等级/现结构下按构造到不了"**
> · **构成先读全再加总**（`room-state.ts:43-51` 注释原文「总储备 = energyAvailable + containers + storage + terminal + 在途 creep 携带能量」）：`reserve = 300(bay) + 1,798(两 container 实读 1,340+458) + 0(storage:used=0 且 cap=null) + 0(无 terminal) + creepEnergy`（`room-snapshot.ts:227` 按 home 归集；该房 `FIND_MY_CREEPS` 背包合计 1,370）。
> · **天花板**：两 container 的 `getCapacity` = **2000/2000（正常值）** ⇒ **null 只出现在 storage 这一种结构上，#117 的作用域第二次收窄**；结构侧上限 ≈ 300+4,000 = **4,300**，而 `ext=0`（extension 一只未落成，5 个工地在册）⇒ **15,000 在现等级下不是"等多久"的问题，是"装不下"的问题**。
> · **因此这条闸的真实性质**：`bankrupt` 出带要求抬高承载天花板，而抬高的三条路（extension 落成／container 增建／storage 拿到真实容量=RCL4 或修 #117）全都依赖 RCL 与结构增长，**`crisis/recovery` 标签本身又在压建造与升级通道**（`empire-health-system.ts:341` 把 recovery/bootstrap 归受限档）⇒ 这是一条**由一间我们从未建造的 storage 启动的自锁**，比 15:0x 版（"colonyState 自己会翻"）和 15:2x 版（"有界、水位能攒到"）都硬。
> · **方法论记账（第三次同轮自纠，写清楚错在哪一步）**：我读完分支就宣布"可满足"，缺的是**"退出线 vs 承载能力"这第二账**——任何以绝对水位为出口条件的闸，判可达性必须先算该房能装多少。已把这条写进 §3.5 #120 的判读边界。
> · **下一发的判据（零新代码，写死防口头挪带）**：`reserve ≥ 4,000` 而 `phase` 仍 `"crisis"` ⇒ 天花板先于退出线到达，**自锁直接复证**；读数必须同时带 `ext` 现值（extension 落成会移动天花板，届时"到不了"要重算）。仪器：守望 `r159-cp3.sh` 那次 peek 就同时给 `phase/bandTicks`，或一发 `peek rooms.W38S58.phase`。
> · **CP3 带失效（记"下沿偏窄"，不记"预报被否证"）**：守望第 15 拍 `15:25:49Z` 仍 `same cp=2`，当前拍 `83425762` ⇒ 距 `startedAt=83425257` 已 ≈505 拍，越出我预写 400~500 的**上沿**；但那条带是两个实测节拍值(400/500)的插值、不是置信带 ⇒ 正确记账方式是"带太窄"，下一发若落 `≈83425,8xx~9xx` 就是第 4 个节拍实测值。

### 4.0-pre（10-04 11:2xZ 改写，R143；**R158 当轮已收：①②③ 三读数全中＝扩张承认链第一次被直接验证**（objective 逐字未变，判据亦已从代码原文读出并预写），**终态事件已于 R158 全部到手**）下一轮主目标：**见证第三次扩张的终态：W38S58 自有 spawn 是否建成、`kernel.bootstrap` 条目是否被删、`kernel.expansion.state` 是否离开 `bootstrapping`，并把"进入下一态后第一道判据"在读完代码之后预先写下**

> **本轮（R143）已读到什么（同拍 83422080，mark=R143E2；实测拍长 2.77s）**：`FIND_MY_SPAWNS=0`、`kernel.bootstrap` 仍含 `["W38S58"]`、`state="bootstrapping"`（`checkpointsPassed=1`）⇒ **三读数全为否，但性质是"没到点"，不是"链断了"**：工地实读 **spawn 13,016/15,000（86.8%）**，剩余 1,984；按已观测速率带（1.27~2.05/拍）落点 **83423,048~83423,642**。车道条目 `until:83422257, waves:5` 与上轮逐字相同 ⇒ 第 5 波冷却还没到期（本轮 T 早它 177 拍）。
> **E2 那条带为什么作废（诚实记账，不挪带）**：我把带写在 `T≈83423,8xx`，那按 **~2,100 拍/小时** 估；实测 2.77s/拍 ⇒ **≈1,300 拍/小时** ⇒ 真实 T 比我条件的时间早 ≈1,700 拍 ⇒ 带本轮无从判。用**允许的一次重算**：1.38/拍 推到 83422,080 期望 11,744，实读 13,016 ⇒ **+10.8%**；本段实测 **2.05/拍**，最长跨度也从 1.38 抬到 **1.53/拍** ⇒ 形态结论改为"**施工速率随在场 builder 数走（过供已证），不是稳态速率**"，报落点只报区间。
> ★★**E3 已在事件之前做完：判据从代码原文读出，并给下一轮留下一个"按构造可分离"的分叉**
> · **车道撤销**（`bootstrap-lane.ts:44-49`）只看 `FIND_MY_SPAWNS.length > 0` 就 `delete kernel.bootstrap[room]`，**不看能不能孵化**；该文件 `:66` 自己警告：车道一清，**途中减员不再有替补**。
> · **CP2**（`state-machine.ts:283-296`＋`checkpoint.ts:126,137-151`）= `spawnBuilt && (energyAvailable ≥ 300 || hatchInProgress)`（`MIN_VIABLE_BODY_ENERGY=300`）。当前 `ea=0, ec=0`，建成后 RCL2 bay 上限恰为 **300** ⇒ **必须喂满整条 300 才过 CP2**。⇒ **预写分叉**：建成那一拍若 `ea<300` 且没在孵 ⇒ **②先走、③不动**，"三件套全中"这一判据按构造不会同时成立。
> · **下一态第一道判据 = CP3**（`:385-430`）= `harvesterActive && transporterActive && spawnCanSpawn`，且 `transporterActive` 按代码是 **`hauler || distributor`**（注释原文：不存在 "transporter" 角色）。**按 `memory.role` 字符串筛**，而新房在场 5 只是 `carrier×1+worker×2+builder×2`（R143E3 现读）⇒ **两个合取项现在都不满足**。CP4 要 `extensions≥5 && container>0`，**CP3∧CP4 才进 `integrating`**。
> · **超时语义**（`:481-497`）：CP2 过时会 `startedAt=ctx.tick` ⇒ **`pioneerTimeout` 从检查点重算，83429857 不是这房的最终死线**；`economic_startup` 超时 = `pioneerTimeout*2 = 40,000 拍 ≈30.7 小时`，届时 **CP3 过 ⇒ FORCED_ADVANCE，不过 ⇒ `abortExpansion(TIMED_OUT)`**（按既往判效会释放 claim）。
> · ⇒ **#116 代价第三次改写（量级最大）**：不只是占空比不稳——**`role==="harvester"` 是 CP3 的字面合取项**。链路唯一缺口是那张 spawn（R140 已证"harvester 请求持续创建又过期，但该房无 spawn 可交付"）⇒ **建成后该房的 own-spawn 能否交付 harvester + hauler/distributor，就是下一轮的主判据**（我不动码：编队/角色属人）。
> **新添两条读数纪律（写在这里而不是 PATROL-PROMPT.md——那文件仍 UNTRACKED，改它无法 diff/回滚，且本轮不动 ①层）**：
> · **`console-eval` 的表达式必须是"单条表达式"**：工具把输入塞进 `return ((EXPR) ?? null)`，`var`/`;` 语句序列会整条编译失败，而 POST 早已返回 `ok=1` ⇒ 表现成"提交成功却永不落 `__evalResult`"（本轮 2×2 对照坐实，并据此**撤回 R142 的"新失败形状=通道可疑"**）。
> · **`economy.ws` 的比值判据只在 `Σticks ≥ 1,500` 时使用**：视界到 2,000 拍滚动重开（`WS_HORIZON_TICKS`），本轮核心房已重开到 `Σticks=350` 且比值读起来像"单向漏记"——**短视界里跨窗相位错配来不及抵消，不许据此翻案**。
> **E5 对本条 §3.5 的降级**：`energyLedger` 快照 B 差分（`Δtick≈646`）给核心房 **净 +2.5/拍**（INCOME 39.7 vs CONSUME 37.1，`spawned 31.5/拍` 与寿命均速 30.6 对得上）⇒ **R142 写的"G4 深红=真赤字"里"稳态"那一半撤掉**，符号在小时尺度会翻、赤字是 episode 形态；站住的是**列名归因**（补员是第一大项）＋"单窗 `bk` 不能排除脉冲项"。另：同区间 `se −8.1/拍` 与 `rs +7.5/拍` **反号**（差额≈15/拍 是房内搬运，#58 口径不入账）⇒ **引"物理面净流"必须写明是 `se` 还是 `rs`**。
> ★★**同轮追加取证（11:2xZ，把"会不会到终态"变成一条可直接判的算术）**：工地 **13,026@83422226** 对 13,016@83422080 ⇒ **+10/138 拍 = 0.07/拍** ⇒ **我上面给的区间 83423,048~83423,642 同轮自撤**；速率序列 0.07/1.27/1.38/1.53/2.05/3.34 ⇒ **形态定论：这段工地只有"来能就跳、没能就冻"两态，平均速率外推一律不是 ETA**（第四次同族，之后只报两点差分）。
> **停摆是补能、不是缺人（四条现读）**：该房**全房 sink 合计 25 能量**（`storage 23` + 两 container `2/0`）而工地还需 **1,974**；该 50 拍窗 `bk={upgraded:50}` ⇒ **无 `built`、无 `harvested`**，仅有的 50 花在升级控制器；在场 6 只 = `carrier×2(1 只 idle 0 能 / 1 只 work 模式背包 1,200 待了 ≥130 拍却没落进任何 sink) + worker×2(acquire 16 / work 50) + builder×2(acquire 且 0 能，两只都有 assignment)` ⇒ **有人有活，没料**。
> **对我上面 CP3 那一半的更正**：`spawnQueue` 现读 6 条 = **`harvester, worker, harvester, hauler, hauler, distributor`**（q0：body `["work","carry","move"]`、`survival:true`、TTL 1,000 拍、`retries:0`）⇒ **"该房产不出 CP3 需要的角色"为假**，**缺的只是那张 spawn**（没有 spawn ⇒ 请求只能到期；`spawnStarvationCount=12,499`）。⇒ CP3 的风险等级下调，**真正的风险是 CP2 之前就先超时**。
> **下一轮的硬判据（预先写死，不许挪）**：终点仍是 `startedAt(83409857)+20,000=83429857`（`advanceBootstrapping` 超时 ⇒ `abortExpansion(TIMED_OUT)`），距 83422257 剩 **7,600 拍 ≈5.9 小时**（拍长实测 2.77s）⇒ 需在 `83429857` 前拿到 **平均 ≥0.26/拍 的"落到该房 sink 并被 builder 花掉"的能量**。**测法**：下一轮把 `progress` 与 **13,026@83422226** 相减 ÷ 实际拍数，**阈值 0.26 判成败**；顺带读 `waves` 是否从 5 变 6（wave6 到期点恰为 83422257；车道 `submitPioneers` 只送劳力不送能量 ⇒ 补能不能指望它）。建成后立刻按 CP2 查 `energyAvailable≥300`（无 extension 时 bay 上限恰 300）与 `hatchInProgress`，并预期 **②（车道条目被删）可先行于 ③（state 前进）**。
> ★★**同轮再追加（11:3xZ）：线上换码了 —— 本会话所有"非部署税"前提到此为止**
> · **证据**：`check-code` 两发均 `modules:{main:<**787,752B sha=649eb94b9784>}`，而 R141/R142 认过的旧值是 `d2f0b0cd00ad`@786,453B；heap 重置时刻由仪器自证 —— `kernel.stats.energyLedger.tick` **83407220 → 83422285**，第二发独立复证是 `observe` 的**建路账本几乎整列清零**＋`heapUsedMb=0`。`git fetch` 后 `origin/dev=e12cfaf`、`origin/dev...HEAD = 0 2`，且 `merge-base --is-ancestor c58ff9d origin/dev` 为真 ⇒ **`c58ff9d`(#115) 与对端 `0d8e1db/b20a67b/27a8511/37e7aa2` 这批已在线上**（**不是我推的**，我全程未 push；我的两笔 R142 docs 是对端推共享分支带上去的）。
> · **对既往读数的影响（写死，防下轮误用）**：**`energyLedger` 的基线现在是 83422285** ⇒ R142 的"快照 A/B 两点差分"方案作废（A 段那 14,300 拍的结论仍是有效证据，但**不能再续差分**）；**A/B 窗作废**（R136-R142 全在旧二进制下取数，"本地 dist == 线上"这条免费仪器不再成立）；约 **400 拍 G6 税**从 83422285 起算 ⇒ 这段 `tier`/CPU 均值不采信（≈83422685 之后再取）。**不受影响**：`economy.ws`（注释明写换码后继续累计）、`kernel.expansion/bootstrap/spawnQueue`、工地 `progress`。姿态又摆回 `fortify` 属换码噪声，不动。
> · **停摆的新证（不是矿穷，是没送到）**：两 source `2,888 / 2,948`（**5,836 可采在场**）而房内 sink 合计 **27**；同窗 `bk={harvested:104, built:2}` ⇒ **采到的能量只有 2 进了工地**；`progress 13,028@83422327` 对 13,026@83422226 = **0.02/拍**（阈值 0.26 仍在恶化中，窗口只用了 ≈1/7，**不判死**）。`wave6` 已到（`{until:83424757, waves:6}`、在场 6→7）⇒ **车道只补人不补能**。
> · **一条排产级线索（机制相容，未归因）**：`ROLE_TASK_KINDS`（`service.ts:75-83`）里 `builder:["build"]`、`worker/harvester:["fill"]`、`upgrader:["upgrade"]`，注释明写"builder 的填充/维修/升级由 `builder.ts` fallback 链自行处理" ⇒ 本窗那 40 点 `upgraded` **可能是 builder 拿不到 build 任务时走 fallback 花掉的**，即最稀缺的 2~50 能量被升级吃掉而非给 P0 工地。**下一发要先读 `builder.ts` fallback 判据原文再定**；不自办（改 fallback 优先级属策略语义）。
> ⚠️**上面这条假设已被同轮"补3"读码否证**：`builder.ts:111-112` 原文是"builder **不** fallback 到升级 — 升级是 upgrader 的职责，等待新 construction site 出现而非消耗能量去升级"。真机制是 **`worker` 链尾的 `upgradeController()`**（`worker.ts:70-72`）配上"该房 `fillTargets` 恒空"（`room-snapshot.ts:117-120` 只把 spawn/extension/tower/**controller container** 列为 fill 目标，而现场没有 controller container）⇒ **请以本节末尾"★下一轮（R144）判据"与 §3.5 #116 的"★★R143 补3"为准，不要按这条已撤的假设去改 builder 的 fallback。**
> · **#115 的生效判据第一次可测**：功能签名=同档内存在 spawn/tower 工地时，**持有能量的 builder 先给它**。⚠️该房 builder 现在恒 0 能 ⇒ **必须等到一次"builder 带能"的拍才判得了**，别把"看不到签名"读成"没生效"。
> ★**下一轮（R144）判据（原写"死循环"已被同轮补4 撤回，这里按更正后的定性重写）**：状态=**临界/掷硬币**。同拍取五量：`progress`（对 **13,068@83422510** 差分，**所需 0.263/拍**，判"持续过线"要**两个以上核算窗且长跨也过线**，单窗过线不算）、`FIND_MY_SPAWNS`、`kernel.bootstrap` 条目与 `waves/until`、`kernel.expansion.state`、以及 `bk` 里 **`upgraded` 与 `built` 的比例**（本轮 147:32 ⇒ 若这个比值明显收窄，就是"worker 兜底与工地抢收入"这条竞争被解开的直接证据）。**下一个自然观测点＝`bootstrap.until=83424757`（wave7，≈2,250 拍后）**：车道每波补劳力 ⇒ builder 数量上去会把同一条"绕源自采"路径的总吞吐线性推高，这是最可能把 0.22 推过 0.26 的机制。若真走到 `abortExpansion(TIMED_OUT)`，要顺带读 abort 之后的清理签名（`kernel.expansion` 是否清空／`Memory.rooms.W38S58` 是否回收／claim 是否释放），**别把"条目没了"当"闭环验证过了"**。
> ★**两条分支的判据都已从代码读完并写死（R144 补），下一发只要撞见任一签名就能直接判，不必再读码**
> · **成功分支**：`FIND_MY_SPAWNS>0` →（`ea ≥ 300` 或 `spawning!==null`）→ CP2 → `state="economic_startup"` **且 `startedAt` 被重置**（死线随之后移 20,000 拍）→ 下一道判据 CP3（`role==="harvester"` 与 `hauler|distributor` 要在场）。
> · **失败分支**（`abortExpansion`@`state-machine.ts:645-668` 原文）：①**`Memory.kernel.expansion` 被置 `undefined`**（不是改成某个 state 字符串）；②`enqueueTerminalOutcome(...,"TIMED_OUT")`（幂等只写一次）；③**`blacklistTarget(target,tick)`** ⇒ **该房被拉黑，短期不能再 claim**（所以"让它 abort"不是零成本，它顺手关掉同一房的快速重试）；④`reclaimExpeditionCreeps(target,sponsor)` ⇒ 在场远征 creep 被回收；⑤`updatePlanStatus(planId,"CANCELLED")`；⑥预留能量不主动释放（靠 tick 过期）。
> · **一条开放观察（我照实写"没找到写者"，不当结论用）**：`abortExpansion` **不清 `kernel.bootstrap`**，而 `bootstrap-lane.ts` 只遍历 `ctx.snapshots()`（自有房）⇒ **房被放弃后该条目由谁删除未知**；若 abort 后 `kernel.bootstrap["W38S58"]` 仍在，那是一条**独立于扩张成败的有界泄漏观察**，要另立判据。
> ★**R144 现读（11:5xZ，竞争关系最干净的一窗）**：`bk={harvested:52, upgraded:114}`——**`built` 键不存在 ⇒ 该 50 拍窗工地得到 0**；`progress 13,070@83422618` 对 `13,068@83422510` = **0.019/拍**；同拍在场 `worker(work,50)/worker(acquire,0)/worker(acquire,138)/builder(acquire,0)×2`。⇒ 收入 52 而升级花 114（2.2 倍，取存量），建造 0。**并已在 predicate 级确认这是该房当前几何下的必然**：`fillBase` 只含 spawn/extension/tower/**controller container**，该房三者皆无（controller 在 `(15,13)`，两 container 在 `(31,14)/(26,19)`）⇒ `fillTargets` 恒空 ⇒ **worker 采到的一切都进控制器**（`worker.ts:70-72`＋`targeting.ts:134-136`）。同时**排除**两条我可能误判成缺陷的形状：`withdrawClosestContainer()` 的 resolve 要求 container 有能量（不会卡住 `harvestSource()` 兜底）、`withdrawStorageCapped()` 有 `<=0 ⇒ undefined` ⇒ **builder 的链没被堵死，0 能是量少+在路上，不是取不到**。
> ★**R146 结算：按我预写的判据撤回报 TIMED_OUT（余量 8.7%，不是"稳了"）**。最长跨 `13,016@83422080 → 13,238@83422887` = **+222/807 拍 = 0.275/拍**；所需 = 剩余 1,762 ÷ 到 `83429857` 的 6,970 拍 = **0.253/拍** ⇒ 过线，撤案条件（"≥2 窗且长跨过 0.26"）字面满足（两窗 `built=32`、`built≈168`）。**同段还出现过 0.019/0.07/1.81 三种短跨** ⇒ 这条工地仍是**两态跳变**，任何平均速率都不是预测；168 那一跳的来源是 **creep 背包与两堆 45 掉落**，不是新增的大池 ⇒ **状态写"仍在跑，但没有任何机制在持续供给"**（#117 未修）。
> ★**abort 分支的代价已量到可决策精度**（读码 + 现读 `kernel.expansionRhythm={"ring":[0,0,0],"blacklistMultiplier":0.5,"minSources":1}`，`codeToKind`: **0=success** ⇒ 环上三次成功记录）：`blacklistCooldown=20,000`（`config/index.ts:946`）× 乘子；走 `timeout` 后成功比仍 3/4 ≥ `2/3` ⇒ **乘子保持 0.5 ⇒ 该房被拉黑 ≈10,000 拍 ≈7.7 小时**；`consecutiveFailures=1 < pauseFailures=3` ⇒ **不触发全局暂停扩张**（`pauseTicks=20,000` 要三连败才落）。**冷却确实会过期**：`pruneBlacklist`（`uoem-events.ts:263`）在 `plan-adapter.ts:29` 每 pass 先跑，所以消费处只查"键在不在"是安全的 ⇒ **我一度怀疑"冷却其实永久"，读到底后否证了自己**（今天第四次"把链读完"，这次拦下的是一个假缺陷）。**给选项④定价时别漏**：`reclaimExpeditionCreeps` 只回收 creep，**已投进工地的 13,238 点建造能量与该房 11 段墙/2 container 随 claim 释放一并作废**。
> ★**下一发（R147）取数清单（不新增读码，只撞签名；基线已更新）**：`progress`（**对 `13,238@83422887` 差分**；所需速率按"剩余 `15,000−p` ÷ (83429857 − 当前 tick)"现算，别沿用 0.253）、`FIND_MY_SPAWNS`、`kernel.bootstrap`（`waves/until`，**wave7 在 83424757**）、`kernel.expansion`（**整个消失＝已 abort，按上面失败分支签名逐条对**）、`bk` 的 `built` 与 `upgraded:built` 比值、以及 **carrier 台账**（`role==="carrier" && remoteTarget==="W38S58"` 的所在房/背包/mode —— 这是 #117 的发作面，若"满载+idle 在目标房"再次出现就是同一故障复现）。**outcome 码表（读环时用）：0=success／1=stolen／2=timeout／3=lost／4=aborted**（`uoem-events.ts:217-223`）。
> ★★**R150 拿到第一段"无噪声累计账"并意外完成一次仪器互校（预报写在取样之前）**：`energyLedger.tick = 83422285`（就是 R143 抓到的那次部署）⇒ 新房逐列从那一拍**从零累计**，到 `83423128` 正好 **843 拍**：`harvested 1,358`=**1.61/拍**、**`upgraded 1,150`=1.36/拍**、**`built 610`=0.72/拍**、`spawned 0`、`imported 0`。
> · **互校**：工地 `13,026@83422226 → 13,638@83423128` = 实际 **612**，账本 `built` = **610** ⇒ **两把独立仪器相差 0.3%** ⇒ `built` 这一列可信（不是"名字叫 built 所以是建造"的臆断）。
> · **累计量支持了 R143 的竞争判读**：**升级吃掉建造的 1.9 倍**，且该房**支出 2.08/拍 > 收入 1.61/拍**，缺口靠 `pickedUp 550`（地上掉落）与存量垫。观察点①也落地：`drop 472 → 229`（43 拍少 243）⇒ **掉落确在被收走、正在供给工地**。
> · **预报（先写死）**：若 0.72/拍 维持，工地将于 **`≈83425,0xx`（区间 83424,2xx~83425,8xx）** 到 15,000，比 `83429857` 早 ≈4,800 拍；**所需只剩 0.202/拍，而累计给的是它的 3.6 倍** ⇒ "临界/掷硬币"按实读**向"能建成"倾斜**。**但同一笔账也标出风险来源**：0.72/拍 里含掉落回收，而掉落＝creep 死亡的产物；在场 4 只的 `ttl = 219/242/656/1441` ⇒ **两只 builder ≈250 拍内又要死一轮，而 wave7 要等 83424757 ⇒ 中间有空窗**。
> · **建成那一拍要撞的正是预写的分离现象**：`spawns>0` ⇒ 车道**当拍删条目**（只看 spawns，不看能否孵化）；`state` 要等 `ea ≥ 300`（RCL2 无 extension 时 bay 上限恰 300）或 `spawning!==null` ⇒ **预期出现"②条目已删、③仍 bootstrapping"的中间态** ⇒ 届时照实报"②③分离"，**不许写成闭环已验证**。若反见 `state` 前进而 `ea<300`，只可能是 R147 的超时强推（那要 83429857 才触发）⇒ 先回读 `evaluateCheckpoint` 再报。
> ★★**R151：上一发两处预写命中（本会话第一次"先写进文件再撞上"），并换一条更硬的预报**。(a) 我写的"预期下一跳 +200" ⇒ 实到 **`13,638 → 13,838 = +200@83423169`**；(b) 观察点① ⇒ `drop 472 → 229 → **[]**`（**掉落确被收走并转成建造**）；(c) "两只 builder ≈250 拍内再死一轮" ⇒ 现读 `ttl 178/201` ⇒ **≈83423,350 内先后到期**。累计账同基线：`13,026@83422226 → 13,838@83423169` = **+812/943 拍 = 0.86/拍**，剩余 **1,162**、到死线 6,688 拍 ⇒ **所需仅 0.174/拍（实测的 1/5）**。
> **新预报（写死）**：`progress` 将在 **≈83423,350 两只 builder 死亡后进入平台期**，直到 **wave7（`until=83424757`）先锋到场**才再跳——依据是**核过的角色约束**：`ROLE_TASK_KINDS` 只有 `builder:["build"]`，而 `worker.ts` 的 work 链是 `repairCritical → fillTarget → upgradeController`（**grep 全文零 `build`**）⇒ 房内没有第二个能建造的工种。**反向即我错**：若无人时段进度仍上升 ⇒ 要么有我没数到的建造者，要么 worker 实际能建，届时回读 `buildAssignmentSite` 的角色约束再报。**建成时刻相应修正为 ≈`83425,5xx~83426,5xx`**（把 ≈1,400 拍平台 + 通勤计进去），仍比 `83429857` 早 **3,300~4,300 拍** ⇒ "向能建成倾斜"不变。
> 另记：`spawnQueue` 已增至 **`harvester×3 + hauler×2 + distributor`**（需求侧继续加码、交付端仍 0 spawn）；`pickedUp` 在账本里**不计收入**（`accounting.ts:121`：那度电在 `harvested` 时已算过）⇒ "掉落转建造"不会留收入痕迹，只体现为 `built` —— 这正是 R150 互校能对上的原因。
> ★★★**R152：R151 的"平台期"预报命中（初判），#117 三连确认；终态更可能以"②③分离"出现而不是 abort**。(a) **命中**：`83423337` 两只 builder 剩 `ttl 10/33`（我写的死亡点 `≈83423,347/370`），到 `83423376` **房内 builder=0**，而这 39 拍工地只走 **`14,391 → 14,423 = +32`——正好等于上拍那只 builder 背上的 32** ⇒ "把存货倒完就停"与预报一致；**确认平台期还要下一发显示 `progress` 不再变**（只隔 39 拍，样本不足以下定论）。(b) **需求侧已很松**：剩 **577**、到 `83429857` 还有 6,481 拍 ⇒ **只需 0.089/拍**（自 boot 累计 1.24/拍）⇒ 只要 wave7（`until=83424757`，差 ≈1,380 拍）把先锋送到并喂得上，**建成概率高**。(c) **#117 三连**：`83423221 / 83423300 / 83423376` 三次读数里该房 sinks 始终是 **container 0/0 + storage 23**，而 `work` 模式、背 1,200 的 carrier 就在房里 ⇒ **"满载、卸不进任何池"不是偶发**。(d) **边界**：`83423337` 有两只 1,200 的 carrier、下一拍只剩一只，**个体去向我又没数出来**（与"1,200 蒸发"那条歧义同类）⇒ **只报"三次读数里没有任何一克落进池子"，不报"能量被销毁"**；`+32` **不算平台期反例**（它是死亡前的存货投放，正是预报里的机制）。
> **R153 取数（预写死）**：`progress` 若仍 `≈14,423`（或仅按 worker 零星投放微增）⇒ **平台期成立**；随后看 `83424757` 之后 `waves` 是否 6→7、场内是否重现 builder、工地是否随之跳——这一发同时检验我写的另一支：**拦车道的可能是 `spawningAllowed`（预算档）而不是敌情**（本轮 `hostile=0`、`waves` 仍 6）。
> ★★★**R153：平台期经第二发确认（`14,423@83423376 → 14,423@83423437`，+0/61 拍、房内 builder=0）；阶梯最后两级判据读完代码，并发现一处要人知道的结构性张力**
> · **`integrating → completed` 的 CP5** = `netEnergyFlowPositive && empireIntegrated`，其中经济激活三段**全**满足（`economic-activation.ts:91-124`）：①`energyLoop = hasHarvester && hasTransporter(hauler|distributor) && spawnActive`；②`netPositive = production − consumption > 0`；③**`selfSustaining = externalEnergyInflow === 0 && netPositive`**；另需 **`consecutivePositiveTicks ≥ SELF_SUSTAINING_TICKS = 500`**（按拍累计，因本系统 `interval=100`）。
> · **`integrating` 超时 = `pioneerTimeout×3 = 60,000 拍 ≈46 小时`**：那一刻若 `netFlow>0 && integrated` ⇒ 强推 `completed` 并记 **`COMPLETED_FORCED`**（P9），否则 `abort(TIMED_OUT)`。正常完成记 **`COMPLETED`**（P8）。**两者都会 `Memory.kernel.expansion = undefined` 并落 `lastExpansionCompletedTick`（冷却门禁消费）** ⇒ 所以"`kernel.expansion` 消失"有**三种成因**（COMPLETED / COMPLETED_FORCED / TIMED_OUT abort），**必须与 `expansionBlacklist`、`expansionRhythm.ring`（0=success/2=timeout）合读才能定性，别只看一个键**。
> · **★结构性张力（现行设计有意为之，不是我发现的新 bug）**：`externalInflowPerTick = carrierLineCount × 50`（`:75-89`）⇒ **只要 sponsor 还在向该房派 carrier，`selfSustaining` 恒假 ⇒ CP5 的自然路径（→`COMPLETED`）按构造不可满足**。本轮现读 `carrierLines = 1`（就是那只满载、按 #117 根本卸不进来的 carrier）。注释交代：以前还把"先锋背包 ×25/t"算进外部流，那一项量纲错、让 CP5 在"有施工队的整个期间"走不到，**已被删除**；现在只认真·持续外部流 ⇒ **"要宣告自主，必须先停止外部输血"是刻意的验收语义**。**但这房今天没有 carrier 就活不下去（自采 1.6~2.6/拍、还靠拾掉落），而那条 carrier 因 #117 又送不进任何东西** ⇒ 三重叠加：**①建成要人；②宣告自主前要断输血；③输血目前等于白跑。** ⇒ **#117 排最前的理由就在这里：它不修，第②③条永远解不开。** 我不动 `selfSustaining` 语义（那是改验收标准，属人），也**不会用"先掐断 carrier 线"去凑一次 `COMPLETED`**（那是自败）。
> · **R154 预写**：`83424757` 之前 `progress` 应仍 ≈`14,423`；那一拍之后看 `waves` 6→7、builder 是否重现、工地是否恢复增长（同时判"拦车道的是 `spawningAllowed` 还是敌情"）；建成那一拍按两条签名分别对（正常 CP2 vs "②删③不动"）。
> ★★★**R154：我 R153 把"补人"归错了机制，现在纠正；并发现一个更硬的问题（平台期可能不会自动结束）**
> · **纠正**：`submitPioneers`（`state-machine.ts:732-766`）**不是波次驱动**——它按**数量**补：对 `worker×pioneerWorkers`、`builder×pioneerBuilders`，取 `living = colonyCreeps(target)` 在场数 + `pending = 该房该角色的队列请求数`，**只要 `living+pending < count` 就每 pass 重投**（`key = expansion:<role>:<target>:<i>`，投进 **sponsor 的 spawnQueue**）。`kernel.bootstrap` 的 `waves/until` 属于**另一条机制**（`bootstrap-lane.ts` 的代孵车道，房一有自己的 spawn 就撤销）⇒ **"下一波在 83424757"不是补人的条件**，我把两条机制混成一条了（正是 R139 我证过的"按物理在场计数 ⇒ 反复补"那条链的镜像错误）。
> · **新事实（`R154T1@83423480`）**：`progress` 仍 `14,423`（**三连发不变**：3376/3437/3480）、该房在场 `worker+worker`、**builder=0**，而 **sponsor `W37S58.spawnQueue` 中 `expansion:*:W38S58:*` 请求数 = 0** ⇒ `living.builder=0 < 2` 本应立即重投，却既无在场也无 pending。三个解释都还活着：**H1** 周期性"投了被饿死"（`priority:2, survival:false` ⇒ 在 sponsor 自身需求后排队到过期，与 R140 看到的"请求持续创建又过期"同形；单次采样可能正好落在过期相位，pass 间隔 100 拍）；**H2** pass 门禁关着（`hostiles.length===0 && spawningAllowed`，`:358-361`；`spawningAllowed` 吃**预算档** `tier∈{healthy,guarded} + bucket≥5000`，`expansion-manager.ts:81-83` —— ⚠️**别与 G6 的容量档 tier 混**，本仓两套同名轴）；**H3** 我对 `pending` 的匹配形状读错（需同拍给 `queue.length` 对照）。
> · **为什么值得记**：若 H1/H2 成立，**平台期不会在 `83424757` 自动结束**，而工地只差 **577**、死线剩 6,377 拍 ⇒ 这第三次扩张最可能的死法会变成**"只差 577 点能量、却没人去建"**。这与 #117（送能进不来）、#116（编队无采集）是**三件不同的事，不要并成一条风险**。
> · **R155 判据（一次读数分开三个假设）**：同拍取 ①`progress`；②在场 builder 数；③sponsor 队列 `expansion:` 请求数**与 `queue.length` 一起给**；④当拍 `hostiles` + **预算档 tier** + `bucket`；⑤**隔 ≥1 个 pass（≥100 拍）再读一次 ③**——"有→无→有"循环 ⇒ **H1**；恒 0 且门条件为假 ⇒ **H2**；恒 0 且门条件为真 ⇒ **H3／我对 pass 节拍的理解错**，回去读 expansion-manager 调用间隔。
> ★★★**R155：那个分支被走到并且结案了 —— 平台期的近因是"投请求的系统没跑"，不是"没人投"**。逐项排除（全只读）：`W37S58` **整条 spawnQueue 长度 = 0**（⇒ H3 排除，不是我的匹配错）；`spawnBlacklist={}`、`spawnStarvationCount=0`、六口 spawn 只有 Spawn5 在孵 remoteHauler、**没有任何在途/孵化中的先锋**（⇒ H1"投了被饿死/退单"排除）；门条件现读全真（`Memory.kernel.tier="healthy"`、`bucket=10000`、敌对 0），且 `expansion-manager.ts:78-93` 原文写着 **"进行中的扩张行动不因姿态回落而中断"**（`expansionAllowed` 只裁决"是否开新局"）⇒ H2 排除。⇒ **heap 直读 `globalThis.systemLastRun`：`expansion-manager = 83423257`，而当前拍 83423588 ⇒ 已 331 拍未跑 = `interval=100` 的 ≥3 个 due 窗口**（`tuning-engine` 同样停在 83423266）⇒ **`submitPioneers` 自 83423257 起没被调用过，所以 builder 死了没人补投。**
> · **不立刻立案**（"计数器落后"要配受害者才算缺陷；本会话实测 `skippedPerTick≈12`，低频系统错峰是常态）。**R156 判据（已定死）**：读 `systemLastRun["expansion-manager"]` ＋ `W37S58` 队列里 `home=W38S58` 的请求数：①若该值前进到 ≥`83423600` 且请求出现 ⇒ **正常错峰，我这条怀疑当场撤**，平台期会自解；②若**相隔 ≥300 拍的两次读数都不前进**（≥6 个 due 窗口）且 `progress` 仍不动 ⇒ 升为缺陷另立案（症状＝收尾阶段唯一能补 builder 的 pass 被饿死；**改 interval/优先级都动执行调度，属人，不自办**）。
> · **仪器收获**：**"某系统这一拍到底跑没跑"有零部署的 heap 直读口 `globalThis.systemLastRun`**（同族还有 `constructionSkips`、`skipBuffer`、`systemBudgetEma`）⇒ **判"机制没生效"之前先用它把"没跑"与"跑了没效果"分开**（这是"写者→采用方→持久化"三段审计之前的第 0 步）。
> ★★**R147 修正（把"两条判据"改成三条出口；我前面写的"超时⇒abort"只在没建成时成立）**：读 `state-machine.ts:340-362` 原文——超时时先 `emitMilestone(FORCED_ADVANCE)`，**若 `spawns.length > 0` 就直接把 `state` 强推成 `economic_startup` 并重置 `startedAt`（不看 `ea≥300`，CP2 根本不是必要条件）**，只有 `spawns==0` 才 `abort(TIMED_OUT)`。⇒ 三条出口：**A** 正常 CP2（`spawnBuilt && (ea≥300 || 正在孵化)`）；**B** `83429857` 到且 spawn 在场 ⇒ **FORCED**，签名是 `Memory.kernel.expansion.forcedAdvance`（现读为 `false`、键存在）翻真 + `state="economic_startup"`，而 **`checkpointsPassed` 可能仍是 1**（注释原文：P5 是 Milestone、**不进 OutcomeChannel** ⇒ 不计失败、不改 blacklist 乘子）⇒ **"检查点数"与"状态"允许不一致，别拿它当闭环证据**；**C** `83429857` 到且 `spawns==0` ⇒ `abort(TIMED_OUT)`：`kernel.expansion` 消失 + `expansionBlacklist["W38S58"] = tick + 20,000 × 乘子(现算 0.5 ⇒ ≈10,000 拍)`。
> ★**另两条此前漏写的分支**：**LOST/STOLEN**（`:262-280`，条件 `!targetRoom?.controller?.my`）—— 本轮核过**不是近期风险**（我在该房有自有结构：11 段墙 + 2 container + storage ⇒ 自有结构给视野，`Game.rooms.W38S58` 不会因"没 creep"消失；claim 衰减是"天"级）；**车道会被敌情掐停**（`:358-361`：`submitPioneers` 前提是 `hostiles.length === 0 && spawningAllowed`）⇒ **wave7 是否真发，要先看目标房有无敌对**（本轮 `R147T1` 实测 `hostile=0`、在场 4 只、工地 `13,238` 自 83422887 起 61 拍零推进）。
> **禁令**：不改码、不动阈值/常量、不 push（`c58ff9d` 等批复）、不新建自动化、市场只读；幼房 `→bootstrap` 本轮已**自愈回 normal**、姿态 `fortify→develop` 属 threatWindow 有界自解，都只登记。
> ★★★**R158（13:1xZ）：objective 的第二半已按代码原文完成；同时撤掉我自己两处口径，并把"②③是同一把闸"这条结构事实钉死**。三读数仍全为否（`83423871/83423891`，mark R158T3/T5，全只读）：`Object.keys(Game.spawns)=6` 且无该房的、工地 `spawn:14423/15000` 自 83423376 起 **495 拍零推进**、`kernel.expansion={state:"bootstrapping",checkpointsPassed:1,forcedAdvance:false,startedAt:83409857,reservedEnergy:5000,operationId:"op:W38S58:83409457"}`、`kernel.bootstrap={"W38S58":{until:83424757,waves:6}}`、`bootstrapDiag.hasSpawn=2@83423857`。
> · **R157 预写判据正面结案 + 一条从前只能猜的实测**：那条 `expansion:builder:W38S58:*` 在 <200 拍内**孵出并到场**（⇒ 队列侧无缺陷）；到场两只 builder 的 **`memory.home` 就是 `W38S58`**（第三只 83423883 刚孵出仍在 sponsor 房）⇒ **`colonyCreeps()` 的 home 筛不排斥通勤先锋**。平台期近因改为"在场两只一只 `acquire` 一只 **`idle`**、都 0 能"，不是"没有 builder"。
> · **★②与③不是两把闸，是同一次 pass 的两行**：`expansion-manager.ts:51` 先 `runBootstrapLane(ctx)`、随后才 `advanceBootstrapping` ⇒ "车道条目被删"与"state 前进"**必然同一次 pass 出现**。**我 R150 那句"②可先行于③（车道节拍不同）"作废**；合法的"②③分离"只可能来自 **CP2 的能量合取项**（`ea<300` 且没在孵）。附带：**站点完成→Memory 可见有一个 pass 的固有迟滞**，实测 pass 节拍 `83423257→83423657→83423857`（**200~400 拍**）⇒ 守望脚本的采样间隔要 ≥ 一个 pass 才不重复计数。
> · **下一态第一道判据 = CP3，逐字读完（`checkpoint.ts:168-181` + `state-machine.ts:401-430`）**：`harvesterActive && transporterActive && spawnCanSpawn`，三项全部建立在 `colonyCreeps(target)` = `room.find(FIND_MY_CREEPS).filter(c => (c.memory.home ?? roomName) === roomName)` 上；`transporterActive` = `role==="hauler" || "distributor"`（无 "transporter" 角色）；`spawnCanSpawn` = `canSpawnEvidence(ea, hatchInProgress)` = **`ea ≥ 300 || 正在孵`**，与 CP2 **同一个 helper**（注释理由：`interval=100` 的采样会错过赶工期里 300 的空档）。**需求侧已就位**：`Memory.rooms.W38S58.spawnQueue` 现读 6 条 = `harvester×2 + hauler×2 + distributor + builder`（全 `home=W38S58`、`retries=0`）。⇒ **预写**：该房自己的 spawn 孵出 ≥1 harvester 且 ≥1 hauler/distributor 在场、同拍 bay 满 300 或正在孵 ⇒ **CP3 在一次 pass 内过，`checkpointsPassed` 跳到 3**；若只见 `checkpointsPassed` 不动而 spawn 在场，先读 `energyAvailable`（**300 是 RCL2 无 extension 时的 bay 上限，恰等于门槛**）再谈别的。
> · **进 `integrating` 的真门槛是 CP4，不是 CP3**（`:441-478`）：`extensionsBuilt` 传的是 `extensions.length ≥ 5`（RCL2 上限恰 5）、`containerBuilt` = `containers > 0`（现场 2 只 ⇒ 已满足），且 **CP3∧CP4 才换态**。现读 `buildQueue` 已列 **≥4 条 `state:"queued"` 的 extension（queuedAt 83422111）却没有一条 site**；该房每房 CPU **0.078/拍**、skip 榜 `system/construction-manager/budget=197` ⇒ **建成 spawn 之后还要一整轮建设期（≈15,000 能量）才谈得上 integrating**。⇒ 汇报口径：**"进入 economic_startup" ≠ "快完成了"**。超时语义照旧（`:482-500`）：`economic_startup` 给 `pioneerTimeout×2 = 40,000 拍`，届时 `cp3.passed` ⇒ FORCED→`integrating`（P7 是 Milestone、不进 OutcomeChannel），否则 `abort(TIMED_OUT)`。
> · **两处我自己口径的撤回（写在这里防下轮误用）**：① `observe.mjs` 每房的 `site=`/`road=` 是 **remote ops 的 siteCount 聚合**（`observe.mjs:204-216` 只累 `op?.siteCount`），**不是该房自有工地数** ⇒ W38S58 的 `site=0` 与"spawn 工地在"不矛盾，别当"工地没了"的证据；② `globalThis.systemLastRun` 是 **`Record<string, number>`**（`kernel.ts:510 (gRun.systemLastRun ??= {})[system.name] = ctx.tick`），**不是 Map** ⇒ 我用 `.get?.()` 读出的 `"undefined"` 是**探针形状错**（同族第 N 次），括号形状复采即得 83423857；同拍 `energyLedger.tick=83422285` 未动 ⇒ **没有新部署**，这两件不许并成"换码"。
> · **#117 的取数式要改（现象留、外推撤）**：本轮房内唯一那只满载（1,200、`mode=work`）carrier 的 **`remoteTarget="W38S56"`**（不是 W38S58）⇒ R147 我写的"筛 `remoteTarget==="W38S58"`"**筛错了对象**。"卸不进任何池"（storage 恒 23、container 0/0）仍是实测，但**"这条线是给新房送能的"我没有证据**，从属事实里摘掉。
> · **守望**：`tmp/observe/r158-terminal.sh`（pid 28110，60×180s，**纯 peek、零 console** ⇒ 不与对端抢 `Memory.__evalResult`；挂循环前已手工验过抽取形状）。命中=`state` 出现 `economic_startup/integrating/completed` **或** `kernel.expansion` 整块消失（abort 签名）；基线行 `"tick":83423857 "hasSpawn":2 spawnQ-state="site" bootW38S58=1 state=bootstrapping cp=1 fa=false`。⚠️**覆盖到 ≈tick 83428,0xx，没盖住 `83429857` 那条超时**。
> · **下一发取数式（idle builder 本轮不立案，先把"它为什么 idle"读出来）**：同拍取 ①在场两只 builder 的 `Memory.creeps.<name>.assignment`；②`globalThis.systemLastRun["construction-manager"]`（**括号形状**）；③`buildQueue` 首条 spawn 的 `state`；④`progress` 对 **14423@83423891** 差分。判读：`assignment` 空 **且** `state` 仍 `"site"` ⇒ 因在 construction-manager 的 assign 侧（被预算筛掉）＝**CPU 线（#50 的取舍）**，不是编制线（#116）。
> ★★**R158 补1（13:2xZ，`83423974/83423991`，mark R158T6/T7，只读）：495 拍的平台期自己破了，破在 builder 背上能量到货的那一拍；#117 第一次同时拿到"缺陷"和"价格"**
> · **工地**：`14,423@83423891 → 14,429@83423974`（+6/83 拍）→ **`14,461@83423991`（+32/17 拍 = 1.88/拍）**。同拍两只 builder `mode=work`、背上 48/32、`assignment` 键都在；`systemLastRun["construction-manager"]=83423974`（当拍在跑）、`expansion-manager=83423957`（pass 节拍已回到 100 拍）。⇒ 我上面"一只 idle、都 0 能"那条近因**只活了 83 拍**，正解是**供能节拍**：工地按"背包到货"脉冲前进（与 R143/R146 的"来能就跳、没能就冻"两态一致），**1.88/拍 不是可持续速率**（该房自采累计只有 1.6~2.6/拍）。剩余 **539** ⇒ 若收入全落到工地，完成点 ≈**83424,3xx~83424,7xx**，可能**早于** wave7 的 83424757；守望脚本覆盖这段。
> · **★#117 成对读数（同一只个体两次复采）**：`carrier-W37S58-0-83423173-x0` 在 `83423837` 与 `83423991` 两次读数里**都在 W38S58、都满载 1,200/1,200、`mode=work`**；body 现读 **36 部件 / work=0 / carry=24** ⇒ 它**自己采不了、只能送**；同拍该房 `storage.store.getUsedCapacity("energy")=23` 正常返回数字，而 **`getFreeCapacity("energy")` 返回 `null`** ⇒ `carrier.ts:44` 的 `getFreeCapacity(...) <= 0` 守卫恒真（`null <= 0 === true`）⇒ **永不卸能**。**价格 = 1,200 能量 = 剩余 539 点需求的 2.2 倍**，压在离工地几格的一只 0-WORK creep 背上 **≥154 拍**。⚠️**R158 补2 当场撤销我同轮早前挂在句尾的那条"筛错对象"**：`83424085` 同拍复采给出 `carrier-W37S58-0-83423173-x0` 的 `home=W37S58 / remoteTarget=`**`W38S58`**` / 人站在 W38S58 / 1,200 满 / mode=work / ttl=695` ⇒ **#117 的归属恢复、且比原写法更强**（它就是"站在自己 remoteTarget 房里卸不进"的那一只）。我 R158 补1 里读到的 `remoteTarget=W38S56` 属于**另一只个体**（`73-wz`，0 能、正在过境 W38S58）⇒ 我把"这一拍打印到的第一行"当成同一只在归因（探针错形状同族再+1）。**规则：跨次复采按 `name` 逐字锚，不按"位置+角色"猜。**
> · **carrier 的守卫顺序读完了 ⇒ 决定 #117 的发作面边界**：`carrier.ts` work 链 `transferTargetStorage().resolve` 依序 ①`:39` 无 `remoteTarget` ⇒ undefined；②**`:41` `room.name !== remoteTarget` ⇒ undefined（站错房根本不试）**；③`:43` 无 storage ⇒ undefined；④`:44` `getFreeCapacity(ENERGY) <= 0` ⇒ **null 时恒真（#117）**。⇒ "满载 carrier 停在某房"有**两种完全不同的成因**：站错房＝导航问题，站对房却卸不进＝本服读数缺陷。**取数式因此必须带 `room.name === remoteTarget` 这一列**，否则会把导航问题记成账本缺陷（我 R158 补1 就是反例）。
> · **CP5 的"外部输血"第一次可数**：`estimateExternalInflow`（`state-machine.ts:848-853`）= `querySquad({role:"carrier", remoteTarget:target}).filter(home===sponsor).length × CARRIER_FLOW_PER_LINE(=50 @economic-activation.ts:75)`。现读 **2 只**（`48-xg` 在 W37S58 装货、`73-x0` 站在新房）⇒ **100/拍 名义外部流入** ⇒ `selfSustaining` 恒假 ⇒ **CP5 的自然完成路径按构造不可满足**（R153 那条结构性张力这次是**数出来的人数**，不是推断）。注释原文还交代了为什么先锋背包不计（按人数 ×25/t 会造出 ~175/拍 假输血、把 CP5 钉死）。
> · **引擎常量落一格（现场读，不靠记忆）**：`carry=24 部件 ⇒ 容量 1,200` ⇒ **本服每只 CARRY 部件 = 50 能量**（不是 20）。回头校正我用过的"背包 ≤50"类措辞与一切运力折算；R143 的"两只 1,200 的 carrier"与该常量对得上。
> · **建成那一拍的期望（事件尚未发生，先写死）**：现读 `ea=0/ec=0`。①spawn 一落地就进 `fillBase` ⇒ 该房 `fillTargets` **从恒空变非空** ⇒ 在场那只 `worker`（home=W38S58）的 work 链 `repairCritical→fillTarget→upgradeController` 会把能量**从升级改道到喂 bay** ⇒ 预期 `bk.upgraded` 停增、bay 往 300 爬；②bay 到 300 之前 **CP2 不过** ⇒"②条目已删、③仍 bootstrapping"的分离**由这条填充滞后解释**（不是节拍差，我上面已撤）；③车道一删代孵即停 ⇒ 该房 6 条队列只能由**自己的 spawn** 交付，而 bay 上限恰 300、而 q0 的 body `["work","carry","move"]` 只花 200 ⇒ **CP2 的 300 门槛比它当下要孵的 body 更紧**；④CP3 只要求 `harvester` 与 `hauler|distributor` **各 1 只在场**⇒ 建成后 1~3 个 pass 内大概率过，**真门槛仍是 CP4 的 5 只 extension**（现读 5 条 `extension/queued` 无 site）。**反向即我错**：建成后 200 拍内 `ea` 仍 0 ⇒ 说明没有任何 creep 往 spawn 里放能量（fill/assignment 侧新问题），别拿"再等等"顶过去。
> ★★**R158 补4（13:3xZ，`83424224`，mark R158T12/T14 + 三次纯 peek）：升级与建造的竞争第一次有长跨实数；"这房到底收到过跨房能量没有"由账本侧独立否证；#115 的签名条件出现但判据仍不算到手**
> · **`Memory.kernel.stats.energyLedger.rooms.W38S58`**（基线 = boot 于 83422285，跨度 1,939 拍，**零 console**）：`harvested 3,268`=**1.69/拍**、`pickedUp 969`（不计收入）、**`upgraded 2,318`=1.20/拍**、**`built 1,579`=0.81/拍**、`imported 0`、`spawned 0`。⇒ 三件事：①**控制器在跟工地抢同一条收入线，而且赢**（升级拿走的是工地的 **1.47 倍**；R144 那个 50 拍窗的 `114:0` 现在有了一千九百拍跨版本）；②**`imported=0` 而同拍现场站着 2 只 `remoteTarget=W38S58` 的满载 carrier** ⇒ #117 从"物理面 storage 恒 23"升级到**账本侧也是零入账**（两台独立仪器同向 ⇒ 不是相位差）；③工地只差 **391** 点，按 `built` 的 0.81/拍要 **≈480 拍**，而收入 1.69/拍里有 1.20/拍被升级吃掉 ⇒ **建成与否的决定变量是"工地能不能赢过控制器"**，而这条竞争**只有在 spawn 落地后才会自动解开**（`fillBase` 把 worker 从升级改道到喂 bay）。
> · **零 console 的取数口（本轮实测可用，比再敲一发 console 便宜且不与对端抢 `__evalResult`）**：`Memory.creeps.<name>.assignment` = `{kind,targetId,revision,assignedAt,leaseUntil}`；`kernel.stats.energyLedger.rooms.<房>` = 自 boot 累计。⚠️本轮 `R158T13` 那发 console **读回超时 33s**，而工具在超时分支 `process.exit(2)` **早于它自己的 cleanup POST** ⇒ 载荷本该留在 `Memory.__evalResult`，但一次 peek 读它是"**不存在**"（对端的 eval 周期会把自己的结果连同删除一起跑掉）⇒ **规则：超时后不要指望捞回，直接改走 Memory/peek 侧。**
> · **#115 的签名条件第一次真出现（但不许写 PASS）**：`6ac17f2c…` 既是该房唯一工地（spawn site）的 object id，又**同时是两只先锋 builder 的 `assignment.targetId`**，且其中一只正背 200 能量 ⇒ "带能量的 builder 钉在关键工地上"成立。**缺的那一半**：竞争任务类（rampart 维修）**住 heap 的任务池、Memory 里没有**（`Memory.rooms.W38S58` 键表只有 `spawnQueue/buildQueue/layout/economy/phase/...`）⇒ 拿不出"同一 tier 里同时存在 build 与 repair、而它选了 build"⇒ 任务 #12 继续 pending（判据＝一次 console 读 heap 任务池，且要配控制组）。
> · **平台期近因再挪一格，而且 `lastPos` 是可解的**：`Memory.creeps.*.lastPos` 存的是 **`x*50+y`** ⇒ `1035⇒(20,35)`、`1178⇒(23,29)`，而工地在 `(28,28)` ⇒ 两只 builder 都在 5~10 格外的采矿位；`stuckTicks=0` 且 `lastRepathAt` 在前进（83424187→83424202）⇒ **在走，不是卡**；该房 **0 条路、4 条 `road/queued`** ⇒ 最后 391 点的节拍被"采矿点→工地"的**步行**支配（这与"施工速率=背包到货脉冲"是同一件事的两面：到货频率 ≈ 1/(采满时间+往返时间)）。

> ★★**R158 补5（13:4xZ，读码为主；现场 `site 14,609/15,000@83424224`）：②这一条读数有两种成因，代码给了判别位**
> · **车道条目消失 ≠ 只有"建成"一种**。`bootstrap-lane.ts` 改 `kernel.bootstrap[room]` 的分支有两条：**`:44-49` 该房有自有 spawn ⇒ `delete`（条目真的没了）**；`:109-121` `abandon` ⇒ **条目不删**，而是写回 `{until:0, waves, abandoned:<tick>}`，并 `cancelRequestsByHome` **按 home 撤单**、记 `ExpansionOutcome [1,4,0]`。⇒ **判别位＝条目里有没有 `abandoned` 字段**：条目没了 ⇒ 自有 spawn 建成；条目还在但带 `abandoned` ⇒ 弃房止损，且那 6 条 `home=W38S58` 的请求会被一起撤掉。**我挂的守望只数"W38S58 在不在"，分不清这两者 ⇒ 命中后必须整块 peek 一次 `kernel.bootstrap`。**
> · **abandon 分支现在按构造不可达**（`bootstrap.ts:69-77`）：要 `ttd < ABANDON_TTD_THRESHOLD(=800) && hostileCount > 0`，本轮 `hostile=0` ⇒ "条目没了"目前只可能是建成。派波侧常数一并落定：`BOOTSTRAP_COOLDOWN_TICKS=2500`（与现读 `until 83424757 = wave6 派波点 83422257 + 2500` 逐字对上）、`sponsor.capacityAvailable ≥ BOOTSTRAP_MIN_SPONSOR_CAPACITY(=1000)` 否则 `no-capacity-sponsor`。
> · **wave7 带来的不是 builder**：车道派的是 `BOOTSTRAP_WORKER_BODY = 3W3C3M(600)` 与 `BOOTSTRAP_DEFENDER_BODY = 2RA2M(400)`（`:36-49`），而 `submitPioneers` 补的是 `worker×pioneerWorkers + builder×pioneerBuilders` ⇒ **83424757 之后若 `waves` 6→7，补的是 worker/defender，不是施工队**；别把"波次到了"读成"工地有人了"。
> · **时序预期（照旧不许挪）**：长跨账本给 `built 0.81/拍` vs `upgraded 1.20/拍` ⇒ 最后 **391** 点按 0.81/拍 ≈480 拍 ⇒ 建成点 ≈**83424,700** 前后（与 wave7 同量级，两件事会在同一窗里撞车）；届时若条目仍在且无 `abandoned`，用 `bootstrapDiag.hasSpawn`（2→3）分开"已建成但没到 pass"与"仍未建成"。

> ★**R158 补6（13:4xZ，读码；现场基线 `14,809/15,000@83424323`）：CP5 的"500 拍连续为正"不是按 pass 计数（这条代码已修），但它"一次不过就清零"**
> · `state-machine.ts:541-549` 把量纲说死了：`elapsedSinceEval = ctx.tick − expansion.lastEconomicEvalTick` 交给 `advancePositiveStreak(prev, elapsed, netFlow>0)` ⇒ **按真实拍数累加**，注释原文写明"按次数 +1 会把 `SELF_SUSTAINING_TICKS=500` 变成 5 万拍不间断"。⇒ **别再把它当"低频系统按构造攒不满"立案**（症状已修；我自己 R153 那句"按拍累计"当时只是猜测，现在有了代码依据）。
> · 但 `advancePositiveStreak`（`economic-activation.ts`）**非正即清零**（`if (!netFlowPositive) return 0`），而 pass 间隔实测 **100~400 拍** ⇒ 攒满 500 拍 ≈ **连续 2~5 次 pass 全部读到正**。本会话已实测该房净流按孵化/交付脉冲翻号（R143 E5：同区间 `se` 与 `rs` 反号；一次孵化 300~400 能量）⇒ **CP5 对采样相位高度敏感，一次不过就从头再来**。
> · 与 R153 的结构性张力叠读：`selfSustaining` 要 `externalEnergyInflow === 0`（R158T9 现读 **2 只** `remoteTarget=W38S58` 的 carrier ⇒ 恒假），**且**要有连续 500 拍为正。⇒ `integrating` 的自然出口 `COMPLETED` 现在是"两道都要满足、第一道按构造不满足"⇒ **实际只剩 60,000 拍那一次 `COMPLETED_FORCED`**。**我不动验收语义（属人），也不会掐 carrier 线去凑一次"完成"。**

> ★★**R158 补8（13:5xZ，**事件仍未发生**，把"③什么时候前进"写成一条可证伪的算式）**
> · **输入全部现读或已核到行号**：该房自 boot 的累计收入 `harvested 3,268 / 1,939 拍 = 1.69/拍`；`worker.ts:62-72` 的 work 链是 `repairCritical → fillTarget → upgradeController`，而 `targeting.ts:134-136` 在 `fillTargets.length===0` 时直接 `return undefined` ⇒ **spawn 落地前 worker 的能量只能进控制器**（这正是 R158 补4 量到的 `upgraded 1.20/拍 > built 0.81/拍`）；`room-snapshot.ts:117-120` 的 `fillBase` 含 spawn ⇒ **建成那一拍 `fillTargets` 由恒空变非空，且 fillTarget 排在 upgradeController 之前** ⇒ 能量改道是即时的，不必等新编制。
> · **预报（写死，不许事后挪）**：bay 上限 = 300（RCL2 无 extension），现读 `ea=0`。若在场两只 worker（`BOOTSTRAP_WORKER_BODY=3W3C3M`，单只 carry 上限 150）把原本进控制器的 1.20/拍整段改道喂 bay，则 **`ea` 应在建成后 ≈180 拍内首次到 300**（300 ÷ 1.69 ≈ 178），于是 **③ 最迟在建成后 180+100 拍的那个 pass 前进**（+100 = pass 间隔）。建成后同场应看到：`bk.upgraded` 增速明显掉、bay 单调爬。
> · **★同一条本服缺陷的镜像面（读到 `room-snapshot.ts:114-120` 才发现，先写死）**：`fillTargets = fillBase.filter(s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0)` ⇒ **`null` 时 `> 0` 为假 ⇒ 该结构被整个移出 fillTargets**。#117 在 carrier 侧是"`<= 0` 恒真 ⇒ 卸不进"，这里方向相反但同一个 getter：**若新房那只新 spawn 的 `getFreeCapacity` 也返回 null，则 `fillTargets` 在建成之后仍然是空** ⇒ worker 继续把能量灌进控制器、bay 永远填不到 300 ⇒ **CP2 按构造过不了**。⇒ 上面分支 A 从此有了具体机制，**命中 A 时第一发读数就是 `Game.rooms.W38S58.spawn.store.getFreeCapacity(energy)` 是不是 null**（别把它读成"worker 不干活"）。控制组现成：`W37S58`/`W38S56` 的 storage 同表达式返回数字（R145 实测 `[free 202,675]`/`[free 880,270]`）⇒ null 是**逐结构**现象，不是全局。
> · **三个反向分支预先写好，撞到哪个报哪个**：**A** 建成后 ≥300 拍 `ea` 仍 0 ⇒ "没人往 spawn 里放能量"，是 fill/assignment 侧新问题（不许用"再等等"顶）；**B** `ea` 到了 300 但 `state` 到下个 pass 仍 `bootstrapping` ⇒ 我 CP2 的合取项读漏了，回去重读 `evaluateCheckpoint` 的 CP2 分支再报；**C** `state` 前进但 `kernel.bootstrap` 条目**还在** ⇒ `FIND_MY_SPAWNS` 与车道遍历口径不一致（`ctx.snapshots()` 何时纳入新房），另立一条。
> · **对"完成"要诚实**：即便 ②③ 到手，这条链离 `completed` 还差 **CP4（5 只 extension ≈15,000 能量）+ CP5（`selfSustaining` 按构造恒假，且 500 拍连续为正、一次不过清零）** ⇒ 本 objective 只要求"离开 bootstrapping ＋ 写下下一态第一道判据"，**不许把三读数到手写成"自主扩张闭环已验证"**。

> ★★★**R158 补9（13:5xZ）★终态第一读数到手：`Spawn7` 已在 W38S58 建成**（objective 三读数里的 ①＝YES），并且我撞见了预写的"①已成立、②③未跟进"中间态
> · **实读（`83424480`，mark R159T1）**：`site=NOSITE`（该房工地已空）＋ **`Game.spawns` 里出现 `Spawn7`，其 `room.name === "W38S58"`**（`Game.spawns` 只收录自有 spawn ⇒ 这条本身就是 ① 的判据，不靠 `progress=15,000` 反推）；`ea=60 / ec=300`（**bay 上限恰 300，与 R143 从代码算出的"RCL2 无 extension ⇒ 300"逐字对上**）；而 `state` 仍 `bootstrapping`、`cp=1`、`kernel.bootstrap` 条目**还在**、`diag.hasSpawn=2` 且 `diag.tick=83424357`、`systemLastRun["expansion-manager"]=83424357`。
> · **⇒ 现场形态正是预写的"①先成立、②③要等一次 pass"**：建成发生在 `83424338~83424480` 之间，而 `expansion-manager` 上一次 pass 是 `83424357`（到读数时已过 **123 拍、≥1 个 interval 窗口**）⇒ **②③ 的读数天然滞后物理事件一个 pass**（补5 写过这条迟滞，本轮第一次实测到）。
> · **★预写的分支 A 当场被否证（并且改写了我自己对 #117 作用域的推断）**：`Spawn7.store.getFreeCapacity("energy")` 返回 **`240`（数字，不是 null）**，且 `ea` 已从 0 涨到 **60** ⇒ 新房自己的 spawn **不受本服 null 读数影响** ⇒ "建成后 `fillTargets` 仍为空 ⇒ bay 永远填不满 ⇒ CP2 按构造过不了"这条**不成立**。⇒ 我补8 把 #117 作用域推到"getter 层（所有结构 store）"**说过头了**：null 是**逐结构**现象（同一房内 storage 返回 null、新 spawn 返回数字）⇒ **修法作用域要按结构类逐个核，不能一句"getter 层"概括**。
> · **下一发（②③到手）的判据（照旧不许挪）**：下一次 pass 之后应见 `diag.hasSpawn 2→3` **且** `kernel.bootstrap` 里 W38S58 条目**消失**（车道只看 `FIND_MY_SPAWNS>0`，不看能否孵化）；**但 `state` 大概率仍 `bootstrapping`** —— CP2 还要 `ea≥300`（现 60）或正在孵（该房要孵的 3 部件 body 花 200，bay 得先攒到 200）。按收入 1.69/拍且 worker 已从"灌控制器"改道"喂 bay"：**预报 `ea` 在 ≈`83424480 + 142` 拍（=240/1.69）首次到 300，③ 在其后第一个 pass 前进**。反例照旧：**A′** `ea` 长期不涨 ⇒ 喂 bay 的能量被别的 sink 抢走（读 `bk.upgraded` 是否仍在涨）；**B′** `ea` 过了 300 但 `state` 不动 ⇒ 我的 CP2 合取项读漏。
> · **仍不写成"闭环验证"**：①＝YES、②③ 待 pass；离 `completed` 还差 CP4（5 extension ≈15,000 能量）+ CP5（`selfSustaining` 恒假 + 500 拍连续为正）。

> ★★**R158 补11（14:0xZ，`83424574`，mark R159T2）：我预写的 `ea→300` 预报"错得有意义"——bay 没有攒到 300，因为**新房自己的 spawn 已经在孵化**，而这正是 CP2 的另一半**
> · **实读**：`ea` 从 `60@83424480` 掉到 **`4@83424574`**，而 `Game.spawns.Spawn7.spawning !== null`（**正在孵**）⇒ 能量不是没进来，是**进来就被一次孵化抽走**。同拍 `home=W38S58` 编制 = `builder×3（其一背 21、work）+ worker（50、work）+`**`harvester（0、acquire）`** ⇒ **该房历史上第一只自有 harvester 已经存在**（#116 那条"roster b4+w3 无 harvester"的现场状态已被现实改掉），且 `ext = controller,storage,spawn`。
> · **★方法论自纠（这条比读数值钱）**：我把预报写成"`ea` 在建成后 ≈142 拍到 300"，但 **CP2 的判据是 `ea≥300 || hatchInProgress`** —— 一次孵化会把 bay 抽干，所以"`ea` 爬到 300"这个可观测 quantity **在系统正常工作时也未必出现**。**正确的预写量应是"第一次孵化尝试出现的时刻"**（以及它落在建成后 ≤200 拍内）。⇒ 以后写 bay/储备类预报：**先问"这个阈值会不会在到达前被消费掉"，会的话就预报消费事件本身，不预报水位**。这条错误与本会话第 7 类（把常数当派生量）同族，但方向不同：那次是外推速率，这次是**选错了可观测 quantity**。
> · **因此下一发（②③）的判据要换形**（原预报作废、按此重写，不许口头挪）：`expansion-manager` 下一次 pass 时，只要 `Spawn7.spawning !== null` **或** `ea ≥ 300`，**CP2 就过** ⇒ 预期 **②（条目删除）与③（`state→economic_startup`、`startedAt` 重置为 pass tick、`cp` 至少 2）同拍到手**，同时 `diag.hasSpawn 2→3`。当前 pass 已 **≥617 拍没跑**（`systemLastRun=83424357` @实测 tick `83424574`，成因见 §3.5 #50 的 R158 补10：`cpuMax10 26.3 ≥ hardLimit 19.2` 触 `scheduler.ts:189` 对 P2+ 一律拒）。**反例两支**：**B′** pass 跑了、`spawning` 非空但 `state` 仍 `bootstrapping` ⇒ 我 CP2 还读漏了合取项（回去重读 `advanceBootstrapping:283-296` 的 `spawnBuilt` 取值口径）；**C′** `state` 前进而条目还在 ⇒ 车道 `ctx.snapshots()` 未纳入新房（独立一条，另立案）。
> · **顺带一条与 #117 的关系**：bay 能被填到 ≥孵化成本，说明**"喂得进 spawn"与"carrier 送不进 storage"是两件事**（前者走 `fillTargets`、后者走 storage 守卫，且 spawn 的 `getFreeCapacity` 实测返回数字）⇒ 新房的能量通路并非全断，**卡的是跨房那一段**，#117 的排产理由照旧成立但别再扩成"这房什么都进不去"。

> ★**R158 补12（14:0xZ）：`83424757` 那个波次冷却点到 = 一次免费判别（不必制造条件）**
> · **为什么免费**：`bootstrap-lane.ts:44-49` 在**同一趟遍历里**"看见自有 spawn ⇒ `delete` 条目 ⇒ `continue`"，所以只要 pass 跑过一次且车道看得见这房，**wave7 就不可能被派发**（它根本走不到 dispatch 分支）。⇒ 到 `83424757` 之后现场只会有三种形状，各自对应唯一结论：**S1** `waves` 仍 6 **且**条目已删 **且** `hasSpawn=3` ⇒ ② 正常到手，与"①先发生、②等 pass"完全一致；**S2** `waves` 变 7 ⇒ **车道在"该房已有自有 spawn"时仍派波** ⇒ 它的 `FIND_MY_SPAWNS` 判定或 `ctx.snapshots()` 覆盖有问题（就是补11 写的 **C′** 分支，独立立案，且此时 `kernel.bootstrap` 必然还在）；**S3** `waves` 仍 6 且条目仍在 ⇒ **pass 至今没跑**（与 `systemLastRun=83424357` 一致，纯 CPU 侧，见 #50 补10 的 `scheduler.ts:189`），**这不是扩张链失败，只是还没被承认** —— 不许把它读成②为否。
> · **口径**：判 S1/S2/S3 时以 `diag.tick` 为准（它等于最近一次车道真正遍历过的拍），不要用墙钟/上一发读数。

> ★★**R158 补13（14:0xZ）：① 已有四把仪器同向（不再只靠一发 console），②③ 仍为否、形状是 S3**
> · **①＝YES 的复证链**：直读 `Game.spawns` 含 `Spawn7` 且其 `room.name === "W38S58"`；该房 `FIND_CONSTRUCTION_SITES` 为空（`site=NOSITE`）；**Memory 侧** `Memory.rooms.W38S58.buildQueue` 里**已无 spawn 条目**（此前是 `constraint.spawn.01` + `state:"site"`，守望脚本从 14:00:54Z 起把它打印成 `GONE`）⇒ **不依赖任何 heap 读数也能复证 ①**；功能证明 = `harvester-W38S58-1-83424570-y7`（名字里的房段是**孵化房** ⇒ 由新房自己的 spawn 孵出）。
> · **②③ 仍为否**：`kernel.expansion={state:"bootstrapping",checkpointsPassed:1,forcedAdvance:false,startedAt:83409857}`、`kernel.bootstrap={"W38S58":{until:83424757,waves:6}}`、`diag.hasSpawn=2`、`systemLastRun["expansion-manager"]=83424357`（实测 tick 已 ≈`8342470x` ⇒ **≥1,000 拍没跑过 pass**）⇒ 按补12 这是 **S3 形状："事件已发生、系统还没承认"**，**不许读成"②为否/链断"**；成因单条挂在 #50 的补10（`cpuMax10 26.3 ≥ hardLimit 19.2` 触 `scheduler.ts:189`，P2+ 一律拒）。
> · **对 objective 的口径（写死）**：本 objective 的第一半要求的是**三读数到手**，而 ②③ 是 Memory 侧读数 ⇒ 它们的到手时刻由 **CPU 调度**决定，不由扩张链决定。**我不为让它早点出现而动任何调度/阈值**（那是属人的、且属"为解闸降阈值=自败"），只把 S1/S2/S3 三种形状与各自唯一结论留在这里，等自然发生。

> ★★**R158 补14（14:1xZ，纯 peek）：把"下一态第一道判据"从定性写成可打分的算术**
> · **CP3 三个合取项的当前状态（现读，不是推断）**：`harvesterActive` = **已满足**（`harvester-W38S58-1-83424570-y7` 在场，home=W38S58）；`transporterActive` = **未满足**（在场编制里 `hauler/distributor` 数量为 **0**）；`spawnCanSpawn` = 满足（`Spawn7.spawning !== null`）。⇒ **③ 到手之后 CP3 不会同拍过**，要等第一只 hauler/distributor 出生。
> · **需求侧形状（`Memory.rooms.W38S58.spawnQueue` 整块读）**：`harvester` 请求 body = `["work","carry","move"]`（**成本 200**、`priority 0`、**`survival:true`**、`memory.sourceId` 钉到具体源、`createdAt 83424465` ⇒ **建成后仍在自动重投**）；`hauler` 请求 body = **`["carry","carry","move","move"]`**（成本 200、`priority 1`、**`survival:false`**、`expiresAt 83424773` ⇒ 就在眼前）。⇒ **运力上界按现场常量算：2 只 CARRY = 100 能量/趟**（本服每部件 50），harvester 的 1 只 CARRY = **50/趟** —— 这正是工地"跳 200 停 100 拍"形态的量级来源，**不是玄学**。
> · **预报（写死，之后按命中/落空记账，不许口头挪）**：③ 之后新房自己每孵一只要 200 能量、bay 上限 300、该房收入 1.69/拍 ⇒ **一个孵化周期 ≈ 200/1.69 ≈ 119 拍 + 孵化本身 ~10 拍**。队列里 hauler/distributor 是 `priority 1`、harvester 是 `priority 0`，所以 **harvester 需求被满足之前 hauler 不会优先**；按现有编制（1 harvester 在场、roster 还要 1~2 只）**预报：`hauler-W38S58-*` 或 `distributor-W38S58-*` 首次出现在 ③ 之后 ≈2~4 个孵化周期（≈240~480 拍）**，CP3 在其后第一个 pass 过（`cp→3`）。测法零 console：`peek.mjs --keys creeps` 里 grep 名字房段 `-W38S58-`。
> · **两支反例（都算数）**：**D** 若 ③+600 拍仍无 hauler/distributor 出生、而队列里 hauler/distributor 条目持续存在或反复重投 ⇒ **该房自有 spawn-manager 不服务 `survival:false` 的非零优先请求**（新缺陷，命名"priority-1 survival:false 在自有 spawn 上排不进"，属人裁决前我不动码）；**E** 若 hauler 条目过期后**不再重投**（队列只剩 harvester/builder）⇒ 需求生产者只保 `survival:true` 那一类，CP3 的 transporter 项**按构造等不来**，那是比 D 更硬的一条结构性发现。
> · **口径**：CP3 过了也不进 `integrating` —— 还要 **CP4 的 5 只 extension**（现读 `ext` 只有 `controller,storage,spawn`，extension **0** 只，buildQueue 里 4~5 条 `extension/queued` 无 site）≈15,000 能量。⇒ 汇报链要说清"**①建成 → ③进 economic_startup → CP3 能量环 → CP4 才有 integrating**"，中间每一跳都不自动。

> ★★**R158 补15（14:1xZ，纯读码，S3 已持续 ≈1,250 拍）：把我自己预写的签名逐个回代码验了一遍——一条验实、两条要降级**
> · **验实的一支**：**B 分支（超时强推）的签名确实有写者** —— `uoem-events.ts:44-45`：`if (milestone === "FORCED_ADVANCE" && !expansion.forcedAdvance) expansion.forcedAdvance = true;`，而 `advanceBootstrapping:344` 在超时那拍正是 `emitMilestone(expansion,"FORCED_ADVANCE",tick)` ⇒ **若 pass 落在 `83429857` 之后，`Memory.kernel.expansion.forcedAdvance` 会真的翻成 `true`**（WIRED 已证；尚未 EXERCISED —— 现读仍 `false`）。
> · **降级一：`reservedEnergy=5000` 不是"5,000 能量被扣住"**。`state-machine.ts:152-165` 调 `tryReserve({energyNeeded:5000, availableExpansionBudget:getAvailableBudget(ctx)})`（`plan-adapter.ts:254`），释放点在 `:603-606`（completed 路径）与 `:654-657`（abort）——**它是"扩张预算"上的记账，不是把 5,000 物理能量锁进某个池子**。⇒ **"承认滞后"到目前为止没有可量的能量损失**，代价形态是 **CP 评估的节拍被拖成 pass 节拍**（本该 100 拍一次，实测 ≥1,250 拍一次），以及 `economic_startup`/CP3/CP4 的判定与超时计时器**全都还没开始走**（`startedAt` 仍 83409857）。**别把 S3 说成"在漏能量"。**
> · **降级二：`executionDashboard` 不在 Memory**：`state-machine.ts:129-141` 把它写进 **`globalCache()`（heap）** ⇒ `peek` 永远读不到，只能 console，且**换码即清**。⇒ 要 dashboard 里的 `progress`/`reservedEnergy` 就走 console，别拿 peek 的空结果当"dashboard 没了"。
> · **对 ②③ 的影响**：两者在同一趟 pass 里顺序完成（车道 `delete` → `advanceBootstrapping` 评 CP2），所以 **②③ 到手那一拍只有两种形状**：`boot=0` 且 state 前进（CP2 过：`ea≥300` 或那拍正在孵）；`boot=0` 且 state 仍 `bootstrapping`（CP2 没过：`ea<300` 且没在孵）——**没有第三种**。若 pass 拖过 `83429857`，才会多出 `forcedAdvance=true` 那支（写者已验）。

> ★★**R158 补17（14:1xZ，纯 peek）：我补14 那条预报的**锚点写错了**——孵化由 spawn-manager 每拍驱动，与 pass/③ 无关；按现场重锚并给出新算术**
> · **新事实（`14:18:0xZ` 一发 peek）**：`--keys creeps` 现读 **两只**由新房自己孵出的 creep —— `harvester-W38S58-1-83424570-y7` 与 `harvester-W38S58-1-83424720-yd`（两次请求 `createdAt` 相差 **150 拍** ⇒ **实测孵化周期 ≈150 拍**，与补14 用 `200/1.69≈119 + 孵化 ~10` 估的量级相符但**偏慢 ~20%**）；同拍 `spawnQueue` 的角色构成已变成 **`hauler×4 + distributor×2`、`harvester` 与 `builder` 条目消失** ⇒ **该房自己的 spawn 已经满足完采集需求、整条队列现在排的就是物流角色**。
> · **预报重锚（原写法作废，按此判）**：原文把首只物流 creep 锚在「③ 之后 240~480 拍」是**错的**——③ 只是 Memory 侧的承认，**孵化不依赖它**。正确锚点是「**spawn 建成（≈`83424,4xx`）之后**」：**首只 `hauler-W38S58-*` 或 `distributor-W38S58-*` 预计出现在 ≈`83424,9xx~83425,4xx`**（第 3~6 次孵化 ⇒ 2~4 个 150 拍周期）。**命中即预报有效；若建成 +900 拍（≈`83425,3xx`）仍只有 harvester ⇒ 走补14 的 D 支（自有 spawn 不服务 `survival:false` 的 priority-1 请求）并当场定罪**。
> · **对 ②③ 的连带修正（重要）**：既然物流可能在 ③ 之前就位，**②③ 到手那一拍 CP3 的三个合取项可能已经全真** ⇒ 同一趟 pass 里 `checkpointsPassed` 可从 **1 直接跳 3**（⚠️**补20 更正：不会同拍** —— `advanceExpansion:88-94` 的 `switch` 按**当前** state 分派、改 state 那趟 `break` 出去，所以 `cp` 只能 1→2（③ 那趟）→3（下一趟））。⇒ **不要把 `cp` 一次跳两格读成"计数坏了"**；补15 写的"只有两种形状"仍成立（形状指条目/state，不指 cp 的增量）。

> ★★**R158 补18（14:2xZ，读码原文）：CP2 的 `ea≥300` 那一支在这间房里**几乎按构造满足不了** —— 于是 ③ 最可能不是"正常 CP2 过"，而是 `83429857` 那一次**超时强推**
> · **原文（`state-machine.ts:283-310`）**：`spawns.length > 0` ⇒ `canSpawn = canSpawnEvidence(targetRoom.energyAvailable, spawns.some(s => s.spawning !== null))` ⇒ `cp2.passed` 时 `checkpointsPassed = max(…,2)`、`state = "economic_startup"`、`startedAt = ctx.tick`。合取项就这两个，**没有别的**（我先前写的判据至此逐字对齐）。
> · **结构性张力（三条现读数拼出来的）**：bay 上限 **恰 300**（`ec=300` 实测，RCL2 无 extension）而 CP2 的门槛**也恰是 300**；该房现在要孵的 body 成本是 **200**（harvester `[work,carry,move]`、hauler `[carry,carry,move,move]`），队列里还有 **6 条**（`hauler×4+distributor×2`）⇒ **`ea` 爬到 200 就被一次孵化抽走，永远先不到 300**。⇒ **`ea≥300` 只有在"需求 momentarily 为空"时才可能出现**；而 `hatchInProgress` 那支的命中率 ≈ 孵化时长/孵化周期 ≈ **`18~24 拍 / ≈150 拍 ≈ 0.12~0.16 每次 pass`**（孵化时长按本服 6 拍/部件算：3 部件 18、4 部件 24；周期 150 是实测两次请求 `createdAt` 之差）。
> · **预报（写死，不许口头挪）**：pass 目前被 CPU 压到 **≥1,300 拍一次**（补 10/15），若 ③ 只能靠"撞上在孵"这一支，**期望要 ≈6~8 次 pass ≈ 8,000~10,000 拍**才撞上 —— 而 `bootstrapping` 超时点在 **`83429857`（距 `83424357` ≈5,500 拍）**。⇒ **最可能的 ③ 形状是：某次 pass 撞上超时点之后，走 `:340-353` 的 `FORCED_ADVANCE`（`spawns.length > 0` ⇒ 强推 `economic_startup`、`startedAt` 重置、`forcedAdvance` 翻 true）而不是 CP2 正常通过**。⇒ 判读时**别把 `forcedAdvance=true` 当成异常**：它是"没有 spawn 才 abort、有 spawn 就硬推"的既有设计（R147 已写），且 P5 是 Milestone、不进 OutcomeChannel ⇒ **不计失败、不改 blacklist 乘子**。
> · **反例三支（撞到哪支报哪支）**：**F** 某次 pass 之前 `ea` 自己到了 300（即需求被满足、队列空）⇒ CP2 正常过、`forcedAdvance` 保持 false ⇒ 我这条"按构造难满足"就说过头了，按实读改回；**G** `83429857` 已过而 `state` 仍 `bootstrapping` **且 `forcedAdvance=false`** ⇒ 超时分支根本没执行（pass 没跑或 `startedAt` 语义与我读的 different）⇒ 那是要单独查的一条；**H** `boot=0` 且 `state` 前进**但 `startedAt` 没重置** ⇒ 与我刚读的 `:310`/`:348` 两处赋值矛盾，回去核 `expansion` 是不是被别处改写。
> · **可加一台免费仪器（零部署）**：下一发只需同拍取 `ea`、`ec`、`Spawn7.spawning?.remainingTime`、队列条数 —— 前三项直接判 `ea≥300` 这支此刻可达不可达，第四项把"孵化时长"从我的 6 拍/部件**推算**变成**实测**（现在它是推算，别当读数引用）。

> ★★★**R158 补19（14:2xZ）★★ ② 到手：`kernel.bootstrap = {}`、`diag.hasSpawn=3`、pass 落在 `83424857` —— 而 `state` 仍 `bootstrapping`，正是补15 预言的两种形状里的第二种（CP2 的能量合取项未满足）**
> · **同拍实读（`83424868`，mark R159T3 + 一发 peek）**：`kernel.bootstrap = {}` ⇒ **条目已被删、且无 `abandoned` 字段 ⇒ 不是弃房**；`bootstrapDiag = {tick:83424857, owned:3, noVision:0, hasSpawn:3, notMine:0, pushed:0, sponsor:2, decisions:0}` ⇒ **`pushed:0 / decisions:0` = 代孵通道对这间房已关闭**（R143 写的「车道一清，途中减员不再有替补」当场兑现）；`kernel.expansion = {state:bootstrapping, cp:1, startedAt:83409857, forcedAdvance:false}`；`ea=148 / ec=300`、`Spawn7.spawning = null`、队列 **3 条**。⇒ **那次 pass 上 CP2 失败的原因逐字可见：`ea=148 < 300` 且那拍没有正在孵化** ⇒ 与 `:287-290` 的 `canSpawnEvidence` 完全一致。
> · **★★我自己一个被当场抓到的错（第 5 类同族，显式更正）**：从 14:0x 起我一路写「pass 已 ≥1,000 / 1,270 / 1,320 拍没跑」，那是**用 2.7 s/拍外推当前 tick** 算出来的。按两发锚点实标定：`t=83424574@14:02:01Z → t=83424868@14:21:53Z` ⇒ **Δ294 拍 / 1,192 s = 4.05 s/拍**（比今天早上实测的 2.63~2.7 慢约一半）⇒ **真实 pass 间隔只是 `83424357 → 83424857` = 500 拍**。⇒ **前面所有「≥1,000 拍」的措辞作废，改 500 拍**；规则照旧但这次又被印证一遍：**拍长必须当窗用两发 tick 差实测，不能拿上一窗的秒/拍外推**——它把「承认有多慢」夸大了两倍。
> · **因此补18 的预报按新数字重算（不口头挪带）**：pass 间隔实测 **500 拍**，撞上「正在孵」的每-pass 概率仍 ≈`18~24/150 ≈ 0.12~0.16` ⇒ 期望 **6~8 次 pass = 3,000~4,000 拍**；距超时点 `83429857` 还有 **4,989 拍** ⇒ **③ 更可能走「正常 CP2（撞上在孵）」而不是超时强推**（补18 说「最可能是 FORCED」，那是建立在 1,300 拍间隔的错数字上，现按实读改成**两支都可能、CP2 略占优**）。另一支更早解锁：队列只剩 3 条 ⇒ **若需求 momentarily 清空，`ea` 能真爬到 300 ⇒ CP2 直接过、`forcedAdvance` 保持 false**（就是补18 的 **F** 反例，现在概率不低）。
> · **objective 记账**：三读数 **①=YES（`Spawn7`，四把仪器同向）／②=YES（条目已删、无 `abandoned`）／③=NO（仍 `bootstrapping`）** ⇒ **不 complete**。下一发判据不变：`state → economic_startup` 那拍同拍核 `startedAt` 是否重置为 pass tick（`:310`）与 `cp → 2`；若 `forcedAdvance=true` 则走的是 `:348` 的强推路径。

> ★★★**R158 补20（14:2xZ，纯 peek）：补17 重锚后的预报**命中** —— 首只物流 creep 由新房自己的 spawn 孵出，且落在预测带内**
> · **读数**：`--keys creeps` 现读 **`hauler-W38S58-0-83424926-yo`**（房段 `W38S58` ⇒ **Spawn7 自孵**；请求 `createdAt 83424926`）；连同两只 harvester（`...83424570-y7`、`...83424720-yd`）⇒ **第 3 次孵化就是 hauler**，实测孵化节拍 `83424570 → 83424720 → 83424926` = **150 / 206 拍**。
> · **预报判分**：补17 写的是「spawn 建成后 2~4 个孵化周期 ⇒ ≈`83424,9xx~83425,4xx`」⇒ **命中**（`83424926` 落在带内）。**两支反例 D/E 都没触发**（自有 spawn 服务了 `survival:false` 的 priority-1 请求；队列也确实把 harvester/builder 消化完、留下物流）。**注意这条预报的第一版（补14）锚点是错的**（"③ 之后 240~480 拍"）——按那个锚点它此刻应当还没兑现 ⇒ **价值在于"先写死再撞"这件事被救回来一次，而不是数字本身运气好**。
> · **连带的新判据（写死，供 ③ 之后用）**：`hauler` 一在场，CP3 的三个合取项**可能已全部为真**（`harvesterActive`＝2 只、`transporterActive`＝1 只、`spawnCanSpawn`＝正在孵）。⇒ 预期 **③ 到手后的下一趟 pass 就把 `checkpointsPassed` 从 1 抬到 3**（`advanceEconomicStartup:416-438`）。**形状上要注意**：`switch` 按当前 state 分派、改 state 那趟不会同趟评 CP3 ⇒ **③ 与 `cp→3` 必然隔一次 pass**（补18/19 说的"同拍跳两格"这条我写错了，此处更正：**不会同拍**）。**反向即我错**：若某趟 pass 同时让 `state→economic_startup` 且 `cp` 变 3，那是 `evaluateCheckpoint` 被两处调用、我的分派理解错，回去重读 `advanceExpansion:85-100`。

> ★★**R158 补21（14:2xZ，零 console 两发）：补8/补11 那条"worker 从升级改道喂 bay"的机制预报——**方向命中、去向命中一半**，因为链里 `repairCritical()` 排在 `fillTarget()` 前面**
> · **同基线差分**（`energyLedger` 自 boot `83422285`；对比点 `83424224` → `83424971`，**Δ = 747 拍**）：`harvested 3,268 → 4,846` ⇒ **2.11/拍**（比补4 的 1.69 高 25%，与"第二只自孵 harvester 到场"相容）；**`upgraded 2,318 → 2,500` ⇒ 0.24/拍（从 1.20 掉 80%）**；`built 1,579 → 1,972` ⇒ **Δ393 ≈ 工地的最后 391 点**（建成后该列应归零）；**`spawned 0 → 400`**（= harvester 200 + hauler 200，与 body 成本逐字对上）；**`repaired 0 → 720`**（新出现的一列）。
> · **判词**：我写的"**`bk.upgraded` 停增**"**兑现**（−80%），但我接着写的"**bay 往 300 爬**"**没按预期发生**：同拍 `ea` 只有 **51**（`ec=300`），因为 `worker.ts` 的 work 链是 `repairCritical → fillTarget → upgradeController` —— **该房的墙/地基维修（此房此前实读过 11 段墙＋2 container，本轮未重新计数）排在喂 spawn 之前**，改道的能量**大半进了 `repaired`（720）而不是 bay**。⇒ **机制方向对、去向被我读窄了**：我读完链的顺序却按"fill 是主要出口"来推数量，没先把 `repairCritical` 的需求量估进去。
> · **对 ③ 的重算预报（写死）**：净进 bay ≈ `2.11 − 0.24(upgrade) − 0.96(repair) ≈ 0.9/拍`。队列现读 **1 条** ⇒ 两支都可能：**若队列持续 ≥1 条**，`ea` 一到 **200** 就被一次孵化抽走 ⇒ **到不了 300** ⇒ ③ 只能靠"撞上正在孵"的相位（每-pass ≈0.12~0.16，pass 间隔 500 拍 ⇒ 期望数千拍，可能撞上 `83429857` 的超时强推）；**若队列清空**（现读只剩 1 条、需求接近满足），`ea` 以 ≈0.9/拍爬 ⇒ **`(300−51)/0.9 ≈ 277 拍`内到 300 ⇒ ③ 走 CP2 的 ea 支、`forcedAdvance` 保持 false**。**反向即我错**：①若 `ea` 长期 ≤60 不爬 ⇒ 说明维修需求比我估的大（读 `repaired` 的斜率即可分辨）；②若 `ea` 跳过 200 直上 300 而期间有孵化 ⇒ 我对"孵化在 200 起跑"的门槛理解错（去读 spawn-manager 的 body 成本闸门）。
> · **可复用的新仪器口径**：`energyLedger` 的 `repaired` 列**平时恒 0、开工时才有值**（本会话第一次见非零）⇒ 之前我按"0 修墙"推断过"该房没在修"，那是**同一列两种含义**的陷阱（没需求 vs 没入账）；引用它之前要先看该房有没有维修对象。

> ★★**R158 补22（14:3xZ，零 console）：② 之后新房已经开始自建 extension —— 现场 `buildQueue` 现读 `extension: state="site" ×3 + state="queued" ×1`**
> · **意义**：①**construction-manager 会把 queued 提升成 site**（补8 我写"5 条 extension/queued 却没有 site"这一状态**已被现场更新**）；②**CP4 的时钟现在才开始走**：5 只 extension × 3,000 进度 = **15,000 点**，按补21 的分配（收入 2.11/拍，其中 repair ≈0.96、upgrade ≈0.24、孵化 ≈0.54）**净给建造的大约 0.9/拍** ⇒ **CP4 ≈ 16,700 拍 ≈ 十几小时级**（**不是分钟级**；且这是"其他需求不涨"的下界）。⇒ 给 §3.5 的话：**第三次扩张离 `completed` 还有一整天的建设期**，别把 ③ 到手当"快完成了"。
> · **对 ③ 的预报要往回收一格（重要）**：extension site 一出现，**builder 就多了一个会持续抽能量的 sink** ⇒ 补21 的 F 支（"队列清空 ⇒ `ea` 爬到 300 ⇒ CP2 直接过"）**概率下降**；③ 更可能来自"**撞上正在孵**"（每-pass ≈0.12~0.16）或 `83429857` 的**超时强推**（那条不看 `ea`，只看 `spawns.length>0`）。⇒ **判据不变、权重换了**，我不挪阈值也不动调度去帮忙。
> · **免费复证（下一发即可判）**：同拍取 `Memory.rooms.W38S58.buildQueue` 的 `extension/state` 计数（site 是否 3→4→5）＋ `energyLedger` 的 `built` 斜率（应从 ≈0.006/拍 回到 ≈0.9/拍量级）。**若 site 数长期停在 3 且 `built` 斜率不涨** ⇒ 该房建不动 extension（能量被 repair/孵化吃掉）⇒ CP4 变成一条**要人决策**的瓶颈（而不是"再等等"）。

> ★★★**R158 补23（14:3xZ，零 console + 一发 observe 定拍长）：三个预报同时被现场改写，并抓到一条账本级发现**
> · **先把拍长钉死（上一发的教训立刻用上）**：`83424971@14:29:1x → 83425055@14:35:07` ⇒ **Δ = 84 拍 / 353 s = 4.20 s/拍**（与补19 标定的 4.05 同量级）。⇒ 下面所有"/拍"都用这 84 拍做分母，**不再用估的秒/拍**。
> · **`energyLedger` 差分（同基线 boot 83422285）**：`harvested 4,846→5,150` ⇒ **3.62/拍**；`pickedUp 988→1,370` ⇒ **4.55/拍**；**`upgraded 2,500→2,500` ⇒ Δ0（升级停了）**；**`repaired 720→720` ⇒ Δ0（补22 我说 repair 会长期吃 0.96/拍——它是脉冲，已经清零）**；`built 1,972→2,384` ⇒ **4.90/拍**；`spawned 400→700` ⇒ **3.57/拍**。
> · **★账本级发现（本会话第一条正向的）**：**支出 8.47/拍（built+spawned）> 记账收入 3.62/拍，缺的 ≈4.85/拍 恰好与 `pickedUp` 的 4.55/拍 对齐** ⇒ **这间房现在主要靠"回收已经计过账的掉落能量"在施工**，而不是靠当拍采集。⇒ 补22 的 CP4 估算因此**被替换**：按 `built 4.90/拍`，剩余 extension 工作 `15,000 − 412 ≈ 14,600` ⇒ **≈2,980 拍 ≈ 3.4 小时**（不是十几小时）。⚠️**掉落的来源我还分不开**（harvester 满仓 `drop()` vs 某只满载 carrier 死在房里把 1,200 卸成地上）——**具体判据**：盯一次 `pickedUp` 单窗跳 ≈1,200 且同窗事件环出现该房的 `CreepDeath`/carrier ⇒ 抓到就把"#117 把本该入库的交付变成概率性掉落"升为已证；抓不到就保持假设级。
> · **③ 的路径权重第二次翻转（这次有硬依据）**：`upgraded` 与 `repaired` **同拍归零** ⇒ bay 之外的大 sink 都没了，队列现读 `0/24`（observe 的 `W38S58 queue=0/24`：spawnQueue 空、buildQueue 24 项含 site）⇒ **`ea` 爬到 300 的阻力大幅下降 ⇒ 补21/补22 的 F 支（CP2 走 `ea≥300`）重新成为最可能**。**判据仍不挪**：只要某趟 pass 撞上 `ea≥300` 或正在孵，③ 就到。
> · **一处要更正自己的引用**：observe 给 `W38S58 site=0`——补8 已核实该列是 **remote ops 的 siteCount 聚合**，**不代表这房没有 3 个 extension 工地**（`buildQueue` 里 `state:"site" ×3` 才是这条链的读数）。差点又拿它当"工地没了"，第二次拦住同一把枪。

> ★**R158 补24（14:4xZ，段通道 + peek，零 console）：给补23 的"掉落施工"划回它自己的窗口，并记两条新读数**
> · **补23 的那条结论要缩范围（单窗差分不能当常态——本项目记忆里已写过 N 次，这次是我自己又犯）**：下一窗（`83425055@14:35:07 → ≈83425140@14:41:03`，Δ≈85 拍）实读 `harvested 5,150→5,542`＝**4.6/拍**、`built 2,384→2,616`＝**2.7/拍**、`spawned 700→800`、**`pickedUp/upgraded/repaired` 全部 Δ0** ⇒ **这一窗支出 < 收入、不需要掉落垫背**。⇒ 正确措辞是：**"在 `83424971~83425055` 那一个 84 拍窗里，支出比记账收入多出的部分与同窗 `pickedUp` 增量对齐"**，而**不是**"这间房主要靠掉落施工"。回收通道**存在**（`pickedUp` 累计 1,370）但不是常态供给。
> · **#117 未变**：`imported = 0`、`exported = 0`（同上一窗，跨房入账列**一个字节都没动过**）⇒ 新房建成后这 1,000+ 拍里**没有任何一次跨房交付落进该房账本**；该房现在完全靠自己采。
> · **★一台仪器的默认分支值得记一笔（不是本次主目标，登记不立案）**：环里 W38S58 共 4 条 `CreepDeath`（payload 解码＝`[roleCode,x,y,age,natural]`，`roleCode 5 = worker`）：**`83423784 (31,14) age1526 natural=1`、`83424569 (26,25) age1511 natural=1`、`83424926 (29,29) age1051 natural=0`、`83424964 (29,29) age106 natural=0`** —— 后两条**非自然、同一格 (29,29)（就在 spawn `(28,28)` 旁边）、间隔 38 拍、其中一只只活了 106 拍**。但该房 `lastHostileAt` **键不存在**（本 boot 从未目击敌对）且 `energyLedger.recycledRefund = 0`（写者在 `spawn-manager.ts:336`，确实有写者 ⇒ 0 是有意义的）。⇒ 三支候选都没被排除：**recycle 未计费**、**分类器默认分支**（`event-log.ts:301-303` 是 `natural→ else recycle→ else combat`，**"未分类"会落进 combat**）、以及真有未记账的杀伤。**可复证判据**：下一发同窗取 `deathByCause`（现读 `{natural:547, combat:15, recycled:8}`，自 boot 83422285 累计）＋ 该房 `CreepDeath` 增量 —— 若 combat 涨而 hostile 仍无目击 ⇒ 默认分支在把非战斗死亡记成战损（那是 M11 战损熔断/`fleetLossFuse` 的输入污染，属可立案）。**本轮不动码、不立案。**
> · **③ 仍未到**：`state=bootstrapping/cp=1/startedAt=83409857/forcedAdvance=false`，pass 仍 `83424857`（守望 28 行确认）；下一趟 pass 按实测 500 拍间隔预计落 ≈`83425,3xx`（**拍长 4.2 s/拍，本轮已实测**）。

> ★★**R158 补25（14:4xZ）：objective 审计表（把 补1~补24 收成一张可复核的清单，含我自己被判错的三条）**
> · **三读数**：**① 自有 spawn 建成 ＝ YES**（四把仪器：`Game.spawns` 含 `Spawn7` 且 `room.name=W38S58`；该房工地表空；`buildQueue` 已无 spawn 条目（守望打 `GONE`）；功能证明＝自孵 `harvester-W38S58-*`×2 + `hauler-W38S58-*`×1）。**② 车道条目被删 ＝ YES**（`83424857` 那趟 pass：`kernel.bootstrap={}` 且**无 `abandoned`** ⇒ 排除弃房支；`hasSpawn 2→3`；`pushed:0/decisions:0`）。**③ 离开 `bootstrapping` ＝ NO**（现读 `state=bootstrapping/cp=1/startedAt=83409857/forcedAdvance=false`；CP2 失败原因逐字可见：那趟 pass `ea=148<300` 且 `spawning=null`）。⇒ **本 objective 未完成，剩 ③ 一跳，且它只由 CPU 调度决定。**
> · **③ 的下一发读法（照此执行，不要自由发挥）**：①`peek kernel.expansion kernel.bootstrap kernel.bootstrapDiag`；②同拍一次 console 取 `Game.rooms.W38S58.energyAvailable / FIND_MY_SPAWNS[0].spawning / systemLastRun["expansion-manager"]`（Record 用括号取，**不是 Map**）；③判：`state==economic_startup` ⇒ **③到手**，同拍核 `startedAt` 是否等于该 pass tick（`:310` 正常 CP2）或 `forcedAdvance==true`（`:348` 超时强推）；`boot==0 且 state 仍 bootstrapping` ⇒ CP2 能量项未满足，**不是链断**；**下一趟 pass 起** `cp` 才会到 3（`advanceEconomicStartup:416-438`，switch 按当前 state 分派 ⇒ 必隔一趟）。**禁止**为让它早点出现而动调度/优先级/阈值（属人，且属"为解闸降阈值=自败"）。
> · **判据原文定位（都已读过、逐条写在上面各补里）**：CP2 `state-machine.ts:283-310`＋`checkpoint.ts:137-139,159-166`｜CP3 `:401-438`＋`checkpoint.ts:168-181`（三项全建于 `colonyCreeps` `:377-381`，按 `memory.home` 筛）｜CP4 `:449-478`（**5 只 extension**）｜bootstrapping 超时 `:340-357`｜economic_startup 超时 `:482-500`｜`abortExpansion :645-668`｜车道 delete `bootstrap-lane.ts:44-49` / abandon `:109-121`｜CP5 `economic-activation.ts:91-134`＋`advancePositiveStreak`（非正即清零）｜外部流入 `state-machine.ts:848-853`（`× CARRIER_FLOW_PER_LINE=50`）。
> · **我自己被判错的三条（留在这里，别让下轮复用旧版）**：**a)** 补14 把首只物流 creep 锚在"③ 之后"——孵化根本不等 ③（补17 重锚后命中，分数只记重锚版）；**b)** 补17/18 说"同一趟 pass 里 `cp` 可能 1→3"——switch 按当前 state 分派，**必隔一趟**（补24 前已在补20 更正）；**c)** 补23 说"这房主要靠掉落施工"——下一窗 `pickedUp` Δ0、收入 4.6 > 支出 3.2，**结论只适用于那一个 84 拍窗**（单窗当常态，本项目记忆写过的老坑，我又踩了一次）。另有一条测量纪律被现场救回：**"某事件已 N 拍没发生"必须当窗实测拍长**——我用 2.7 s/拍外推，把 500 拍的 pass 间隔写成"≥1,000 拍"，连带把预报方向推偏（补19 更正）。

> ★**R158 补27（14:4xZ，纯 peek）：CP4 的速率用两个窗复算 ⇒ 补23 的"3.4 小时"是单窗乐观值，改成 **3.4~5.2 小时区间**；extension site 数仍 3（不是 4）**
> · **读数**（`14:41:03 → 14:47:20`，Δ≈377 s ⇒ 按当窗 4.2 s/拍 ≈ **90 拍**）：`harvested 5,542→5,942`（**4.4/拍**）、`built 2,616→2,796`（**2.0/拍**）、`spawned 800→1,000`（2.2/拍）、`upgraded/repaired/pickedUp` **Δ0**、`imported` 仍 0。`buildQueue` 现读 **`extension state="site" ×3`**（与 14:31 同数）＋1 条 container queued。
> · **多窗复算**：自 spawn 建成（取 `built=1,972@83424971` 为"工地完成后"的起点）到 `2,796@≈83425,24x` ⇒ **Δ824 / ≈257 拍 = 3.2/拍**（比补23 用的单窗 4.90/拍 低 35%）。⇒ **CP4 剩余 `15,000 − 824 ≈ 14,176` ÷ 3.2 ≈ 4,430 拍 ≈ 5.2 小时**；补23 的 3.4 小时只在该速率维持时成立 ⇒ **改为区间 3.4~5.2 小时**（同一房间同一个坑：**单窗速率不能当常态**，这次是我自己隔 6 分钟复算出来的）。
> · **site 数停在 3 不是坏信号**：3 张工地各需 3,000 进度、现累计只投了 824 ⇒ **工地本来就还没完工**，所以没有第 4 张被创建（`queued` 的下一张要等前一张落成）。⇒ 判"CP4 卡住"的**正确**信号是 **`built` 斜率归零**，不是"site 数不涨"（我差点把后者当缺陷记一笔，写下防下轮误读）。

### 4.0-pre（10-04 10:4xZ 由 R142 为 R143 立的预期；**R143 当轮已收：三读数全否、带因拍长估错失效、CP2/CP3 判据已从代码原文读出**，保留作状态出处）下一轮主目标：**见证第三次扩张的终态：W38S58 自有 spawn 是否建成、`kernel.bootstrap` 条目是否被删、`kernel.expansion.state` 是否离开 `bootstrapping`，并把"进入下一态后第一道判据"在读完代码之后预先写下**

> **为什么换目标**：上一条（核心房库存流失归因）**R142 当轮判完**——`ws` 视界累计给出"账面 −18.2/拍 vs 物理 −17.2/拍、残差 0.8%"⇒ 落在设计内消费（补员 30.6/拍 > 采集 19.0/拍），结案文与三条更正进 §3.5 #88。**照字面再读同一条就是空转**。
> **本轮（10:3xZ）已把状态基线取好**：`kernel.expansion={state:"bootstrapping",startedAt:83409857,sponsor:"W37S58",checkpointsPassed:1}`、`kernel.bootstrap={"W38S58":{until:83422257,waves:5}}` ⇒ **三件套里 2 项为否**；**spawn 工地进度没读到**（console 那发 POST `ok=1` 却不落 `__evalResult`，见下条预案）。R140 长跨速率 **1.38/拍**、基线 `9,139@83420192`、完成点 ≈**83424,439**、死线 **83429857**。
> ★**期望值先写（取数前钉死，不许事后挪带）**：设本轮读到 tick = T。
> · **E1（主判据，三读数同拍取）**：①`FIND_MY_SPAWNS ≥ 1`？②`kernel.bootstrap` 里 W38S58 条目是否消失？③`state` 是否 ≠ `bootstrapping`？**三者全中才算闭环第一次被直接验证**；**进度到 15,000 而 ②③ 未到 ⇒ 是撤销/推进链的问题**（车道判据或 `advanceBootstrapping` 的 CP2 压着别的条件），**不得**写成闭环成立。
> · **E2（带的第三次检验）**：按 R140 的 1.38/拍，`T≈83423,8xx` 时进度期望 **≈14,180**，带宽**只按已观测过的速率区间 1.27~1.42/拍 取 ⇒ 13,770~14,590**；落在带内/带外都写，**只允许一次重算**（用本轮实测速率）。若已 ≥15,000 或 spawn 在场 ⇒ 带作废，改判 E1/E3。
> · **E3（下一态判据要先读再写）**：若 state 前进（预期 `economic_startup`），**先把 `advanceEconomicStartup` 的 cp2 条件读成原文**、写下它的期望与检验时刻，**再**报告"标志变了"。别把标志翻动当经济活了（这条我上一轮预写过，仍未被执行过）。
> · **E4（通道先证伪再取证）**：先发**一发极小带 mark 表达式**（例：`JSON.stringify({m:"R143P",t:Game.time})`）判 console 是否活着；两次都不落 ⇒ 记通道债，工地进度改走 `peek`（`Memory` 里若有 site 进度键）或 `observe` 的 `site=` 列，**绝不连发第三发抢 `__evalResult`**。
> · **E5（顺带、不扩目标）**：`ws` 三房的**视界是否重开**（`WS_HORIZON_TICKS=2000`，滚动重开会清零 ⇒ 读数要带 Σticks 才可比）＋核心房是否继续 −18/拍；幼房 `ColonyStateChange→bootstrap` 是否自愈（G2 五连红的来源）。
> **禁令**：不改码、不动阈值/常量（`pioneerTimeout`/`colonyCreeps`/#116 修法全属人）、不 push（`c58ff9d` 等批复）、不新建自动化、不引 50 拍单窗做速率结论。

### 4.0-pre（10-04 10:3xZ 改写，R142；**当轮已收：objective 判完并结案，见 §3.5 #88 的"★★R142 结案"条**；R141 的"结构性看不见"判定本轮被现读否证，保留作状态出处）下一轮主目标：**把核心房"每拍约 −15 能量"的库存流失归因做完：先用读码把核算窗长钉死，再按 INCOME/CONSUMPTION 字段清单逐列对上，判它落在设计内的消费里、还是落在 `bk` 结构性看不见的地方**

> **本轮已推进到哪（状态，不是新目标）**：窗长在 R141 钉死（`CONFIG.economy.accounting.windowTicks=50`）；"按 key 的累计账"**不需要新建**——`global.energyLedger` 自 boot 起累计、并由 `telemetry-collector.ts:386-389` 镜像进 `Memory.kernel.stats.energyLedger`（起点 `tick=83407220`）。快照 A（10-04 10:3xZ，tick ≈83421,5xx±300）三房逐列已录进 `AGENT.lock` R142 §二：核心房账面净 **−5.79/拍**、幼房 **+3.64/拍**、新房 −0.40/拍、帝国 **−2.55/拍**。
> **还缺的那一发**：账面与物理**取自不同区间**（累计均速 vs 最近 1,050~3,250 拍），⇒ **"设计内消费"解释了多少、"看不见"剩多少，按字面仍未判**。
> ★**期望值先写（取数前钉死，快照 B）**：跨度取 `Δtick = t_B − t_A`（约 1 小时 ⇒ ≈2,100 拍，**以实际读到的 tick 算，不按墙钟估**）。
> · **E1（主判据，两尺同区间对表）**：B 的每列差分 ÷ `Δtick` 得账面净流 `N_ledger`；同区间物理面 `N_phys` 用 `econ-ring` 末样本 `rs`（或 `se`）差分。**判据**：`|N_phys − N_ledger| ≤ 0.3×|N_phys|` ⇒ **归因闭合，"账本看不见"这一支正式死**（结论形态＝核心房流失主要是设计内消费，第一名补员换血）；若 `N_ledger` 仍 ≈−6/拍而 `N_phys` ≈−17/拍 ⇒ **残差 ≈11/拍 是结构性的**，此时才轮到候选出口清单（落地能量衰减 / container→storage 房内搬运按 #58 不入账 / link 传输 / 市场 escrow 相位），**且要先证"这些通道有写者"再引**（#106 那条教训）。两个结果都要写清"这是差分层判据，不是机制归因"。
> · **E2（脉冲假说的直接检验，防再犯 R141 的单窗误排）**：`spawned` 差分应 ≈ **30/拍 × `Δtick`**（`Δtick≈2,100` ⇒ **≈6.3 万**）⇒ 若真如此，则**任何单窗 `bk` 抽到 0 的概率被我高估过**，把这条写进 §读数口径："**脉冲型消费（spawned/市场流出）不许用单个 50 拍窗排除**"。人均 body 用 `CreepDeath` 差分自校（A 段 ≈1,314/只，合理区间 800~2,500）。
> · **E3（控制组同法）**：幼房同区间差分。A 段它账面 +3.64/拍而物理 −8.7/拍 ⇒ **若 B 的账面差分为负且与物理同号**，说明幼房刚转负（补员+升级 21.2/拍 vs 采集 18.7/拍），**则"帝国两房同时吃库存"成立**；若仍背离 ⇒ 两尺在不同房上有系统性口径差，归对端 #114，我不另立案。
> · **E4（顺带收、不扩目标）**：扩张终态三读数（`FIND_MY_SPAWNS≥1`／`kernel.bootstrap` 里 W38S58 条目是否删／`state` 是否离开 `bootstrapping`）＋ spawn 工地进度一发，**与快照 B 同一轮取**（R140 完成点 ≈83424,439、死线 83429857）。若 `state` 前进，**先读 `advanceEconomicStartup` 的判据再写期望**。
> · **通道故障预案**：本轮 `console-eval`（mark `R142J1`）POST `ok=1` 却**没落 `__evalResult`**，而同形状 peek 读到邻居键非空 ⇒ 先证伪再决定：B 轮**先发一发极小带 mark 表达式**判 console 是否活着；两次都不落 ⇒ 记通道债、工地进度改走 `ring-dump`/`observe` 能给的字段，**不连发第三发抢 `__evalResult`**。
> **禁令**：不改码（累计账已在，无需新观测补丁）、不动阈值/常量、不 push（`c58ff9d` 仍等批复）、不新建自动化；G2 五连红与幼房 `ColonyStateChange→bootstrap` 只登记不另立案；判不出来就写"未判 + 缺哪一发"。

### 4.0-pre（10-04 10:1xZ 改写，R141；**当轮判据已给但核心结论被 R142 现读否证**——窗长与"单窗噪声同量级"两条仍有效，保留作状态出处）下一轮主目标：**把核心房"每拍约 −15 能量"的库存流失归因做完：先用读码把核算窗长钉死，再按 INCOME/CONSUMPTION 字段清单逐列对上，判它落在设计内的消费里、还是落在 `bk` 结构性看不见的地方**

> **为什么选这条**：G4 已连续 6 次采样深红（`Σ门=−3.793`），而我三轮都在引用核心房"物理面 −15～−21/拍"却**从未归因**——因为 `economy.bk` 是"每个核算窗的增量"而**我没有窗长**。窗长一条就把"能不能拿 §3.5 里那些"/拍"当事实"整个定下来；再拖就是第四次挂账。
> **顺带清两件（不扩目标，只登记）**：①**线上 sha 已连续 4 轮未认**（上次 `d2f0b0cd00ad`@R136）⇒ 本轮第一件事 `check-code`；②新房 spawn 工地完成点 R140 外推 ≈83424,439（用长跨 1.38/拍）⇒ 本轮只顺手读一发进度，**不开新案**。
> ★**期望值先写（取数前钉死）**：
> · **E0（窗长）**：读 `src/domain/economy/accounting.ts` / `economy` 系统里 flush 的间隔常量，把 `bk` 的窗长读成一个**数字**（候选：50 / 100 拍；对端 R298 的 8 窗采样用的是 50 拍量级）。窗长一旦读死，`bk` 每列 ÷ 窗长 = 每拍流量，"−15/拍"才有可对照的对象。**若窗长读不出来 ⇒ 本轮直接写"不可判"，不许用假定的 50 或 100 拍换算。**
> · **E1（设计内的三条出口）**：核心房是 RCL8，已知的"会花掉但可能不入账/入账口径不同"的三处：①**保级升级**（`upgraded` 在 RCL8 按构造≈0，因为 progress 到顶 ⇒ **最大的消费项可能整个看不见**）；②**塔修墙**（记 `towerSpent`，不记 `repaired`——#53）；③**补员开销**（`spawned`，本会话核心房 natural 死亡 394 的量级）。⇒ 预期：`bk` 能解释的部分 = `towerSpent + spawned + repaired + exported + tradeFee + sold`，而**若它显著小于窗长换算出的 −15/拍，缺口就该由 ①（结构性不可见）吃掉** ⇒ 结论形态：**"不是漏账，是 `bk` 在 RCL8 房对保级消费按构造失明"**，并要把"不许用 `bk` 给 RCL8 房做收支闭合"写进 §读数口径。
> · **E2（控制组）**：同一窗读 W38S56（RCL5，物理在**涨** +4~11/拍）与 W38S58（recovery，`roomTotal_rs` 225）的 `bk`。若幼房 `INCOME−CONSUMPTION ≈ 它的物理差分`而核心房差很多 ⇒ 支持 E1 的"RCL8 特有盲点"；若两房都对不上 ⇒ 是 `bk` 全局口径问题（那就归对端 #114，我不另立第二件）。
> · **E3（反证自己）**：如果算出来核心房其实是"净收入为负"（采集被满仓 episode 压掉、`harvested` 掉到与 `towerSpent` 同量级），那 **−15/拍 根本不是漏账而是真在净支出** ⇒ 这条要单独写明，因为它会把 #88 的语义从"仪器无分辨力"改成"帝国在吃库存"。两种结论都对系统含义完全不同，**不许含糊过去**。
> **禁令**：不改码、不动任何阈值/常量、不 push；对端域（#114 的 drift 分布、#111 的工地停滞）只对口径不另立案；判不出来就写"未判 + 缺哪一发"。

### 4.0-pre（10-04 09:1xZ 改写，R140；**当轮已收：终态三读数全为否、带落在下方、G0 卡点答出**，保留作状态出处）下一轮主目标：**见证第三次扩张的终态：W38S58 的自有 spawn 是否建成、`kernel.bootstrap` 条目是否被删、`kernel.expansion.state` 是否离开 `bootstrapping`，并核对完成点是否落在预写的 83421,480~83424,770 带内**

> **为什么换目标**：上一条 `### 4.0（R139）` 已经把"外推 vs 现场"跑完并当场证伪了 R138 的 1.27/拍（近段实测 3.34/拍）⇒ 该目标已收。本轮去收**它留下的那一半**：终态三读数当时全部未到，而按两算的完成点，本轮正该撞上。
> **这是本会话第一次可能拿到"自主扩张闭环"的直接验证**（claim → 代孵 → 施工 → **自有 spawn 建成** → 车道撤销 → state 前进）。判据一律按 `bootstrap-lane.ts:46-48` 与 `state-machine.ts` 的实际写法读，不拿"看起来快了"当闭环。
> **基线（R139 现读，非记忆）**：spawn 工地 `6ac17f2c…5a` = **7,990@83419383（F2）**；`kernel.expansion={state:"bootstrapping", startedAt:83409857, sponsor:"W37S58", checkpointsPassed:1}`；死线 **83429857**；房内 builder 4 只（过供已证：`state-machine.ts:377-381` 按物理在场计数）；源旁 container `[24,0]`。
> ★**期望值先写（取数前钉死）**：
> · **E1（主判据，三读数同时取）**：①`FIND_MY_SPAWNS ≥ 1`？②`Memory.kernel.bootstrap` 里 W38S58 条目是否消失？③`kernel.expansion.state` 是否 ≠ `bootstrapping`？
>   - **三者全中 ⇒ 闭环第一次被直接验证**，且要顺带记一条新事实：`state` 前进后进入哪一态（`economic_startup`？）与该态的**下一道判据**是什么（本轮读 `advanceEconomicStartup` 的 `cp2` 条件并写出它的期望，别再犯"把标志当已生效"的错）。
>   - **进度到 15,000 但 ②③ 未到 ⇒ 是撤销/推进链的问题**（例如车道判据不是 `FIND_MY_SPAWNS`，或 `advanceBootstrapping` 的 CP2 还压着别的条件），**不得**写成闭环成立。
>   - **进度未到最后一次读数 ⇒ 只报"未到 + 实测速率"**，并把它当成对 3.34/拍 那一段的下一次检验（若速率掉回 <0.66/拍，死线 83429857 重新变成风险）。
> · **E2（带的第二次检验，防我事后挪带）**：按 R139 两算，本轮 tick 若 ≈83420,5xx 则期望进度 **11,900~13,200**（3.34/拍 分支）或 **10,550** 附近（1.27/拍 分支）。读数落在其内/其外都要写出来，**并只允许一次重算**（用本轮实测速率），不许把带改成刚好包住读数。
> · **E3（欠了两轮的读码，顺手清）**：①`telemetry-collector.ts:595-613` 的 `EnemyInvasion` payload 为什么 `threatCreeps=2` 却 `ranged=21`（字段顺序 or 聚合 bug）；②`posture.expansionAllowed` 现在到底被哪一项挡（G0 连续 5 轮红在此）。**只读码，不改码。**
> · **E4（必看但不开新案）**：`tier`+`since`（`constrained@83416306` 已第五次）、CPU 累计账差分、`gateNetFlow` 与核心房物理差分（**要窗口长度再算，不许裸算 `bk`**）、`deathByCause.combat`（11 起算，+≥3 才谈持续）。
> **禁令**：不降阈值、不改 `colonyCreeps`/`pioneer*`（#116/过供修法属人）、不 push（未批复）、不动对端域（#111/#114/#100/#108）、不新建自动化或预约任务；拿不到判据就写"未判"。

### 4.0-pre（10-04 08:1xZ 改写，R139；**当轮已收：外推被证伪、过供机制证实**，保留作状态出处）下一轮主目标：**验 R138 写下的外推：新房 spawn 工地的实测速率是否落在"1.27/拍 ⇒ 完成点 ≈83425,900"这条预测带上，第三次扩张能否仍赶在死线 83429857 前建成**

> **为什么换目标**：上一条 `### 4.0（R138）` 的人均速率判定已当轮收完（结论：速率双峰、成败系占空比、余量 ≈55%）⇒ 照字面再读就是空转。**本轮只动 ②选目标层**（新增本节；旧条原样保留），**①③未动**。
> ★**这一轮的本质是一次"预先写好的期望值 vs 现场"的对照**（R136 起执行的纪律，也是对 #116 唯一能算清代价的方式）：R138 我在取数前把外推写进了文件 ⇒ 现在读数只能落在有限的几种情形里，没有事后解释空间。
> **基线（R138 现读，非记忆）**：spawn 工地 `6ac17f2c32019b86d4b0775a` 进度 **5,686@83418557**；`kernel.expansion={state:"bootstrapping", startedAt:83409857, sponsor:"W37S58", checkpointsPassed:1}`；**死线 = startedAt + pioneerTimeout(20,000) = 83429857**；编队 = worker×2 + builder×2（**无采集角色**，#116）；上一发实测瞬时 3.9/拍（1 只喂能 builder）、实测空窗 ≈200 拍 0 推进。
> **期望值先写（取数前钉死）**：
> · **E1（主判据）**：若 R138 的"长段合计 1.27/拍"成立，则本应读到进度 ≈ `5,686 + 1.27×(T − 83418557)`；在 T≈83419,500（约 40 分钟后）的期望值 ≈ **6,880**，允许带 **±15%（≈6,700~8,000）**。
>   - 读 **< 6,700** ⇒ 合计速率低于 1.27/拍 ⇒ **占空比比 R138 估的更差**，按当前所需 0.82/拍重算余量；若已 < 5,686+0.82×ΔT ⇒ **本轮直接判"死线前建不完"**（这是 #116 的代价第一次被量化，也是该推动"编队加采集角色"的唯一论据形式）。
>   - 读 **> 8,000** ⇒ 1.27/拍 是低估（喂能段占比比我看到的高），完成点前移，余量变大。
>   - 读在带内 ⇒ E1 成立，R138 的外推记为**一次被验证的预测**（此路唯一一次预测命中要写清）。
> · **E2（终态三读数，与 E1 同批发）**：`FIND_MY_SPAWNS ≥ 1` / `kernel.bootstrap` 里 W38S58 条目被删 / `kernel.expansion.state` 离开 `bootstrapping`。**预期本轮三者都还没到**（最快完成点也在 T+2,300 拍之后）⇒ 若其中之一提前出现，说明我把 15,000 当成了错的总目标值（**该质疑自己的读法而不是庆祝**）。
> · **E3（占空比的第二发）**：本轮至少取**两发**进度（间隔 ≥150 拍）⇒ 差分给"当段速率"，与 R138 的 3.9（喂能）/0（空窗）双峰对照；若两发之间出现 0 推进且房内 builder ≥2 ⇒ 直接坐实"限制在取能不在编制数"，#116 升级。
> · **E4（顺带必看，不改口径）**：`tier`（判 tier 只看 `tier`+`since`）、`gateNetFlow` 与核心房物理差分（R138 抓到 −20.9/拍 未归因，本轮若继续大跌就要取 `bk` 的**窗口长度**再算，**不许**再凭 `bk` 裸值造"/拍"）、`deathByCause.combat`（11 起算，再 +≥3 才谈持续战损）。
> **禁令**：不降阈值、不动 `pioneer*` 配置（#116 修法属人，且一次部署=清堆+≈400 拍税）、不 push（未批复）、不动对端域（#111/#114/#100/#108）、不新建自动化或预约任务；若读数不足以判 E1，就写"未判"，不硬收。

### 4.0-pre（10-04 07:1xZ 改写，R138；**当轮已收：速率双峰 + 死线余量 55%**，保留作状态出处）下一轮主目标：**拆 W38S58 spawn 工地的人均施工速率：用多次进度读数 × 当时绑定的 builder 数，判"第三次扩张能否无人干预自己走完 15,000"**

> **为什么换目标**：上一条 `### 4.0（R137）`（G6 增量落在哪一列 + 把 #50 摆成可决态）已在 R137 当轮收完并落进 §3.5 #50 ⇒ 照字面再读就是空转。**本轮只动 ②选目标层**（新增本节，旧条原样保留），**没动 ①（PATROL-PROMPT.md）与 ③（src）**。
> **为什么这条值一轮**：它是长期目标主轴上**第一次可能被完整验证的闭环**（claim → 代孵 → 施工 → 自有 spawn → 自孵 → `bootstrapping` 解除）。此前我只能给"冻结 3,695 拍"这类缺陷读数，还**没证明过帝国能自己把一张新 claim 建成能孵自己的房**。
> ★**期望值先写（取数前钉死，不许事后挑）**：
> · **基线（都是现读，非记忆）**：spawn 工地 `6ac17f2c32019b86d4b0775a` 进度 **64@83414022 → 1,850@83415491**（合计 ≈1.22/拍，其中第二只 builder 是 83415257 才绑上去）；源旁 container **3,029/5,000@83415491**，其自身速率 ≈0.92/拍；wave4 已过（R137：home 人口 4→6、`spawnQueue` 首次出现 hauler 请求）。
> · **P1（L2 预言，本轮的主判据）**：按 0.92/拍 外推，container 应在 **≈83417630** 完工 ⇒ **源旁取能地板解除**（`builderStorageLimit` 不再被 23<2,000 卡死、builder 不必自采长途回跑）⇒ **spawn 施工速率应当跳到 >1.22/拍**。读数若 **>2.5/拍** ⇒ P1 成立且 L2 是此前的真瓶颈；若**仍在 1.0~1.5/拍** ⇒ P1 否证，说明限制在别处（载重 200 的往返节拍、或 builder 人数没真加上）；若 container **没完工** ⇒ 本轮不判 P1，只记进度。
> · **P2（人均拆分）**：把每段速率除以"该段内绑到 `…5a` 的 builder 数"。若两只与一只的**人均接近**（差 <1.5 倍）⇒ 施工可线性外推，剩余 13,150 按人均速率给 ETA（单位一律写"拍"，墙钟只给区间并按实测拍长换算）；若人均**差 >2 倍** ⇒ 存在我没看到的机制（body 变化/取能路径变化），不许给 ETA。
> · **P3（闭环终点判据，本轮预期"未到"）**：`FIND_MY_SPAWNS` 出现 ≥1 时 `bootstrap-lane.ts:46-48` 会 `delete kernel.bootstrap[room]`、`state` 才可能离开 `bootstrapping`。按 P1/P2 的数外推，**本轮预期 spawn 仍未建成**（进度量级 2,000~6,000 / 15,000）⇒ 正确输出是"**闭环未合**"，**不得**写成"扩张链已验证"；也不得因为"没建成"就说它建不成（要给 ETA 区间与前提）。
> · **禁止**：不重跑 #115 的判决（已定稿：L1 排序缺列 + L2 交付地板）；不碰 `roadHeat`/回收/射程（对端 #111）；不降阈值；不 push（未批复）；不新建自动化/预约任务。
> **探针计划（省着用）**：1 发 console（工地进度 + 每只 creep 的 `assignment.targetId/assignedAt` + `FIND_MY_SPAWNS` 计数 + `deathByCause`，表达式 ≤500 字符、自带唯一 mark、整块打印不接 `tail`）；1 发 peek（`kernel.bootstrap`/`capacity`/`gateNetFlow`/`failedGates`）。

### 4.0-pre（10-04 06:1xZ 改写，R137；**当轮已收并落进 §3.5 #50**，保留作状态出处）下一轮主目标：**拆 G6 缺口四连涨的去向：`15.77 → 16.02/t` 的增量落在哪一列（房数 / 编制 / 远矿角色 / 系统侧），并把"关远矿也不够"摆成可决态**

> **为什么换目标**：上一条 `### 4.0（R136）` 的两半（G4 是真花了还是仪器无分辨力 + 结论进 §3.5）已在 R136 当轮收完并落进 §3.5 的 #50/#88 ⇒ 照字面再读就是空转。**本轮只动 ②选目标层**（新增本节；旧条原样保留），**没动 ①（PATROL-PROMPT.md）、没动 ③（src）**。
> **基线（R136 实测，取数前就钉死，别事后挑）**：`cpuRate.total=16.02/t`（窗口 9,087t）、四轮序列 `15.77 → 15.88 → 15.93 → 16.02`、门槛 12.00 ⇒ 缺口 **4.02**；`byRole` remoteHarvester 1.89 / harvester 1.81 / remoteHauler 0.79 / hauler 0.55；`bySystem` traffic-manager 3.46 / snapshots 1.73 / spawn-manager 0.54 / remote-mining-manager 0.32；每房 `{W38S58:0.423, W37S58:2.895, W38S56:3.186}`；人口 48（26/18/4）；`tier=constrained@83416306`；线上 `d2f0b0cd00ad`。
> ★**期望值先写（R136 起执行的纪律）**：
> · **E1「编制能解释涨幅」——先算死再去看**：按线上重测定标式 `cpu ≈ 6.7 固定 + 0.193×签发 + 0.019×creeps`，48→54 只（+6）只值 **≈0.11/t**，而四轮实测涨了 **0.25/t** ⇒ **编制这一列按构造解释不了涨幅**。若读数显示"人口涨 = 唯一原因"，那是我没算式就下的结论，本轮判**我错**。
> · **E2「远矿角色在涨」**：`remoteHarvester + remoteHauler` 现和 = **2.68**。若本窗 ≥ 2.9 ⇒ A 路线杠杆变大，"关远矿也不够"这句要重算；若 ≤ 2.7 ⇒ 那句继续成立且缺口继续扩大。**这是本轮对 §3.5 #50 唯一能改的数字。**
> · **E3「系统侧结构性」**：traffic-manager 3.46 与 snapshots 1.73 之和 = **5.19/t（占总 32%）**——两者都已被定性为结构性成本，"低于总负载 5% 的可省项不立案"这条规矩仍然挡着它们 ⇒ 即使它们涨，**也不构成新出路**，只构成"缺口在自然变大"的证据。
> · **E4「tier 第二发」**：`constrained` 是 R136 刚翻的（since=83416306，距我读数仅 ≈90 拍）。按我自己的规矩（严重度要第二发读数）**本窗只看 `tier` + `since`**：若仍是 `constrained@83416306` ⇒ 真实状态、可进 §3.5；若已回 `tight` 或 since 变了 ⇒ 撤掉我 R136 写进 #50 的那句"constrained 非部署税"，改成"抖动"。
> · **可决态的产出格式**：最后必须给出一行"缺口 X/t、杠杆 Y/t、差额 Z/t、第二条腿候选=（有/没有 + 出处）"，让人一眼能拍；**不摆"要不要降门槛"**（那是自败项，不列）。
> **禁令**：不降任何阈值、不砍营收线、不动 `maxOperations`（A 路线属人，我只摆数）；不动 `roadHeat`/回收/施工射程与 room-observer 观测补丁（对端 #111/#100/#108 域）；不 push（未批复）；不新建自动化或预约任务；本轮若拿不到第二发读数，就写"未判"，不写成结论。

### 4.0-pre（10-04 05:1xZ 改写，R136；**两半当轮已收并落进 §3.5 #50/#88**，保留作状态出处）下一轮主目标：**按房差分 G4 的输入：核心房 Σ 从 4.210 掉到 1.690 是"盈余真被花掉"还是"仪器无分辨力"，结论交给 §3.5 的 #88/#50**

> **为什么换目标（动了 ②选目标层，本轮只有这一层）**：上一条 `### 4.0（R135）` 的两半在 R135 当轮就收完了（wave3 已发、spawn 拿到两个工位、速率 0.14→1.22/拍），照字面再读一次就是空转。本轮把目标挪到**当天真正新出现的状态**：**G4 转红**（R135 首次读到 `failedGates` 五条含 `G4: net flow(v=4.5|netFlow ≥ 5)`）。
>
> ★**先写期望值再取读数**（这是对端 R309 的方法结论，本轮开始执行；"边读边解释"我一天里错过三次）：
> · **H1「盈余真被花掉」** ⇒ 核心房一个 flush 窗（50 拍）内应满足 `CONSUMPTION − INCOME ≈ 10.1 × 50 ≈ 505 能量`，且 **storage 差分与 (INCOME−CONSUMPTION) 同号同量级**。字段清单按对端 R309 已自校 7/7 窗的口径引用：INCOME=`harvested/bought/imported/recycled`，CONSUMPTION=`spawned/upgraded/built/repaired/towerSpent/sold/exported/tradeFee`，`pickedUp` **不在** income。
> · **H2「仪器无分辨力」** ⇒ 对端 R298/R299 已给八窗 `mean=+440、95%CI=[−549,+1,429]` ⇒ **任何单窗 drift 落在 ±1,430 内都不许定罪**；翻判只需下一窗 `>+826`。若我读到的窗差在 CI 内，正确输出是"未判"，不是"确认 H1"。
> · **H3「Σ 只是慢半拍」** ⇒ G4 吃的是 τ≈5,000 拍的慢 EMA（`gateNetFlow`），所以**物理量若已回升，Σ 仍会继续跌几百拍**。判据：同拍读 `storage_se` 的**方向**与 Σ 的方向是否背离 ≥2 轮；背离只支持 H3，不支持"账本坏了"。
> · **控制组（必带）**：W38S56 与 W38S58 两项 `gateNetFlow` 与各自的物理差分。**若只有核心房在掉、另两房在涨**，则"帝国级核算整体坏"的概率显著下降，问题收敛到核心房的消费侧或远矿供给。
> · **数字预期（G4）**：本轮再读时，核心房继续掉 ⇒ `v` 大概落在 **3.5–4.5**（仍红）；核心房企稳 ⇒ **4.8–5.6**（可能在门槛上下翻）。**这两种都不是我可以自己解的闸** ⇒ 只摆数，不动 `netFlowGateAlpha`/门槛/`minEnergySellPrice`。
>
> **本轮明确不做**：不降任何阈值解闸；不动 `roadHeat`/回收/施工射程（对端 #111）；不动 room-observer 观测补丁（对端 R306–R308 已把它列为 #100/#108 唯一解锁动作，**归他们**）；不 push（未批复，且未推含 src 四笔 `27a8a51`/`b20a67b`/`c58ff9d`/`0d8e1db`）；不新建自动化或预约任务。
> **别踩的两个坑**：①对端的 `e7-prefix-watch.sh` 已在 round=40 自写 `WATCH-OFF-DUTY`，**日志没有新行 ≠ 现象没发生**；②`/api/user/code` 会 429 且 `peek` 偶发 `UND_ERR_CONNECT_TIMEOUT` ⇒ 看到 Node 栈不是"键不存在"。

### 4.0-pre（10-04 04:0xZ 改写，R135；**两半当轮已收**，保留作状态出处）下一轮主目标：**收 #115 自然实验的第二发：wave3 之后 spawn 工地是否拿到第二个工位、进度是否离开 0.14/拍，据此决定 `c58ff9d` 要不要催推**

> ⚠️**为什么重写 §4.0（而不是照旧文跑）**：上一条 `### 4.0-pre（10-02 21:3xZ）` 已经过期两天——它要收的 #83/#85 两条预约 verdict 早被后续轮次结案或否证（#85 已上线判效、#83 随批带走；四路 watch 脚本此刻没在跑）。按新加的【目标层协议】照字面读它，本轮就会去追一批已经不存在的读数。⇒ 本轮只动**②选目标层**（本节 + 无 src 改动），旧条目**原样保留在下方**作状态出处。
>
> **前置读数（R134 已到手，别重取）**：spawn 工地 `6ac17f2c32019b86d4b0775a` 在 **83413556 首次拿到一只 14W4C12M 的 builder**、466 拍推进 64（≈0.14/拍）；解锁的因是源旁 container 的 `maxWorkers=2` 被占满 ⇒ **不是排序自己变对**。#115 定稿措辞＝"冻结 3,695 拍 + 之后 0.14/拍爬行"，`c58ff9d` 去掉的是"等人数超过工位"这一段。
> **本轮分支（照预写走，不临场发明）**：
> - `kernel.bootstrap.W38S58.waves` **=3** 且 spawn 工位 **=2**（两只 builder 绑 `…5a`）⇒ 自然对照成立：多来的人确实会分给 spawn ⇒ `c58ff9d` 的收益定为"**省掉 3,695 拍这段等待**"，催不催推交人按部署代价（清堆 + ≈400 拍 G6 税 + 连带对端未推 src）判。
> - waves=3 但 spawn 仍只有 1 个工位、或进度速率仍在 0.1~0.2/拍 ⇒ **主限制已换到 L2（交付能量）**：`storage=23 < builderStorageLimit.low=2000` 按设计给 0 withdraw、房内无已建成 container、源旁 container 还差 ≈1,971。⇒ 此时**不许**把"推 `c58ff9d`"写成收益，先立项 L2（那是另一层，属人）。
> - spawn 进度回到 0 ⇒ "停摆"恢复原判并升级（R133 撤掉的那一支要重新挂上）。
> **两条由锁的修正条目驱动的自查（优先级高于本目标，见 `AGENT.lock` R294–R299）**：
> ①**我 R134 的"combat 没再涨 ⇒ 一批性事件"已被对端读数否证**（他们读到 `deathByCause` natural 234 / **combat 8** / recycled 4 ⇒ 本段 +5）⇒ 本轮必须自己取一发 combat 再判，**并撤回我那句"一批性"**（V1 的门槛是对端定的：再 +≥3 才算持续战损）。
> ②**§3.5 里 #50 的代价栏从此不许再引用"19.9/拍远矿收入"当现状**——对端已证 W36S58 那条线此刻在停摆边缘（`workers` 一度 0、`noProg` 每拍续涨），19.9 是历史满编数。
> **禁令继续**：不降任何阈值解闸、不动 `roadHeat`/回收阈值（对端 #111/#114 域）、不代批复 push。

### 4.0-pre（10-02 21:3xZ 改写，**已过期**：#83/#85 两条预约 verdict 早结案/否证，保留作状态出处）下一轮 L2 主目标：**收两条预约 verdict，按预写分支走**

> 四路观察在跑（`verify-85-83.sh` / `upguard-verify.sh` / `tuning-events-watch.sh` / `fortification-trend.sh`）。
> 第一件事 = 读 `tmp/observe/verify-85-83.log` 最后两行 verdict，然后**照分支走，不临场发明**：
> - **c1 PASS**（`TuningRollback` 的 `d[3]=2 < pre+1=3`）⇒ #83 结案，#79/#68 的撤销归因钉死为 D.3；下一件转 #47 那族
>   （px<0.2 的死亡补员签名），或把本地 docs 随下一个行为批带走。
> - **c1 FAIL**（`d` 只有 3 元素）⇒ 先 grep `dist/main.js` 里 `roleCountAtVerify` 的出现次数（应为 ×3），
>   再查 `tuning-engine.ts:309` 有没有被别的写点覆盖；**不许去改判据**。
> - **c2 PASS**（`dc=2` 期间不再出现新 `pt`）⇒ #85 结案；**c2 FAIL**（`dc=2` 仍有新 `pt`）⇒
>   查 `aggregateSignals` 是否真把 `Memory.kernel.demandClamps[room]` 读进 signals（一发 peek 就够），
>   **仍不放宽提案条件**；**c2 UNASSESSABLE**（那一刻 `dc≠2`）⇒ 合法放行，既不算失败也不算通过。
> - **PENDING 不是结论**（这一态是本轮特意加进判效器的，判效器自己的下班时刻也按 due tick 算）。
> 本轮（R126-R128）另把**生存轴**清了两项：rampart 低地板是维修队列的队尾且 17 拍内在上抬（非缺口）；
> 布局模板从不产出 wall（`grep -rn STRUCTURE_WALL src/domain/layout/` 零命中）⇒ "RCL8 0 walls" 是模板取舍，
> 与 §3.5 的 #81 同族属人。**#87 不立案。**
>
> （下面保留 20:4xZ 那一版作状态出处。）

### 4.0-pre（10-02 20:4xZ 版，已被上面取代）：**读那两条预约读数（#83 + #85 同一发数据），别急着再改码**
>
> **先更正一处会被 git log 带进你脑子的错**：提交 `f851b00` 的消息里写着"RCL8 的 WORK 限速也是结构钳位"——
> 那句已在 R114 撤回（那一支只在 `allowUpgrader` 为真时跑得到，而 RCL8 无风险时它本就是假 ⇒ 不可观测的死码，已删）。
> #85 本体已上线（批次 13，线上 `8262da1e2c35`）；本地压着 4 笔**行为中性**提交（1 笔补测+死码删除、3 笔 docs），
> 随下一次有行为变化的批次一起走，**不要为它们单独换码**。
> 下一轮第一件事 = check-code 认线上 sha；然后按 tick 读两发：
> **83387266** 该见 `TuningRollback` 且 `d[3]=roleCountAtVerify=2`（<pre+1=3 ⇒ 归因走 D.3 那条）；
> **≈83388766** 在 `demandClamps.W38S56` 仍为 2 的前提下**不该再出现新的 `pt`**（出现=闸没拦住，查 signals）。
> #85 的原目标条目保留在下面，判效到手后据此排下一件。

### 4.0-pre（10-02 19:4xZ 版）原定的主目标：**#85 —— 给调优器的 ↑ 加「事前绑定判据」**（已实施上线）

> **R107 覆盖 R106 的排序**：补员道那条已被读码答完，且答案是"没有缺陷"
> （`demand.ts:910-915` 冲刺档写死 `min(maxCount, 2)` ⇒ 非满仓态那个 3 根本不参与计算）。
> 剩下的真缺陷是**提案条件与验证条件绑的不是同一个量**
> （提案看 `upgraderCount >= current`，验证看 `roleCount >= preAdjustValue+1`）⇒ 不可绑定的 ↑ 每 ~4,500 拍被撤一次。
> 出路 (A)/(B)、控制组与判据都写在 #85 任务与 §6 R107 里。**#83 降为同批搭车项。**

### 4.0-pre（10-02 19:3xZ 版，已被上面取代）原写的主目标：**#83 —— 把 verify 那一拍的 `roleCount` 随回滚事件落盘**

> 为什么是这条（三个理由都能核对）：
> ①它是**纯观测**，不动阈值、不动安全语义、不动任何判据本体（对齐 §5 边界，不需要请示）；
> ②它一次性解锁三条我目前只能记"不可判"的账 —— **#79 的上行护栏有没有真的被现场否证过一次**、
> **#68 的单向棘轮**、以及 **#81 的二阶链条**（防线外壳经 reserve 压制升级编制）。
> 判别量已经由读码确定：`evaluator.ts:661` 在 #79 前是 `return true` ⇒ "编制到位却被回滚"旧码按构造不可能，
> 所以 **roleCount 落盘 = 归因本身**，成因字符串反而不必要；
> ③改动面已知且极小：`tuning-engine.ts:309` 是唯一 `TuningRollback` 写点，
> `verifyPendingAdjustments` 的 rollbacks 对象带出一个已有的瞬时值即可。
>
> **红线（写成用例钉住）**：新字段只准做诊断，**不得反过来参与决策** ⇒ 用例要断言"加字段前后 rollbacks 数组逐条相同"。
> **本轮不做**：不动 upgrader/builder 的门槛，不借机给 #79 再打补丁（那条纪律在 a570e7c 里写过）。
>
> **R106 修正（19:4xZ，写在这里免得下一轮照旧文排产）**：
> ①那条"顺带一件事"**已经做完**——`upguard-verify.sh` 升到 v2，EXPR 528B 单发验过，同时带
> `ub`(上限)/`au`(在场)/`la`/`pp`/`pt` 五列；v1 那列 `upgrader` 其实是**上限**、在场数从未被采过（我 R105 误读过）。
> ②v2 第一读幼房 `ub:2/au:2`（编制到位），而 83379766→83384266 那段是"上限 3、在场 2"
> ⇒ **真正扣产能的是补员道（第三只为何不落地），#79 护栏的前提在这房里从未成立** ⇒
> #83 不再排第一，只作**同批搭车项**（它让下一次 ↑ 的归因永久可查，改动面比补员道取证还小）。
> ③下一轮顺序：先按下面旧版那张"四选一"钉死补员道（v2 已在逐 5 分钟采 `ub`/`au`，不用另挂探针），
> #83 随批带走。若 ③ 的结论是"请求根本没发"，修复点在 `demand.ts` 的编制阶梯，**与 #79/#83 无关，别捆在一起判**。

### 4.0-pre（10-02 15:4xZ 版，已被上面取代；保留作状态出处）：幼房补员道——上限 3 却长期在场 2

> 换掉旧的 #62 主目标（#62 已结案并拿到教科书级 PASS）。选这条的理由是**它同时卡着三件事**：
> ①#68 的效果豁免判据里，唯一可归因的 PASS 组合需要 `alive ≥ preAdjust+1 = 3`——补不上第三只，
> 那条闭环修正就永远只能记"不可归因"；②幼房是 RCL5（≈20 小时）这条发展轴的唯一产能；
> ③并行会话在锁里也把它列为第三件，取证口径要先对齐再动手（同文件别双改）。

- **已知事实（全部当场读到，非推算）**：`roleBounds.upgrader={maxCount:3}`（URU14/16/17 三行一致）、
  `lastAdjusted["upgrader.maxCount"]=83379766`、`frozenParams...rollbackCount` 未增，
  而同一探针的 alive 列**从 83379859 到 83381130 恒为 2**（≈1,270 拍）。
  同期幼房 storage 70,705 → 66,665（−4,040）、controller.progress +12.6/拍。
- **下一步不是改码，是先把"为什么第三只没生出来"四选一钉死**（一次只读探针 + 一次带 boot 基线的差分即可）：
  ①需求侧**根本没发**第三只的请求（`spawnQueue` 里没有 `upgrader` 条目 ⇒ 查 `demand.ts` 的编制/TTL 合并）；
  ②请求发了但**被拒**（查 `spawnRejects` 六档差分，务必带 boot 基线：这些是累计键）；
  ③请求进了但**孵化槽被占**（`freeSpawns`/`energyBudget`/`reserve` 三条预留中哪一条绑住——⚠️预留是安全语义，只摆数不擅动）；
  ④creep **活着但没算进编制**（`memory.home`/`role` 口径或 `countRolesByHome` 的归属判定——这条属读数假象，不是产能问题）。
  判别式已在 §"判据失明"与 #54/#64 里备好：`degradeGateClosed ⊆ budget ∪ reserveOnly` 那条不变式今天五次严格 1:1，可直接拿来分②/③。
- **边界**：这一轮先取证 + 加出口，**不动 `CONFIG.spawn` 的预留语义**（#61 在等人定），
  也不动 `demand.ts` 的压力阶梯与阈值（#47 那把弹性闸的豁免已上线，判效继续等 `px<0.2` 的死亡补员签名）。

- **状态更新（免得下一轮把做完的事再排一次）**：下面这条 #64 已实施完毕（`785b671`，本地未推，随下一批；
  三条新用例 + 两条反向实验 + tsc/unit/integration 全绿，全量 e2e 在 `tmp/observe/e2e-batch5.log` 正在跑）。
  **下一轮的主目标换成 #62**：照抄 `tmp/observe/pending-62-patch.md`（名字形状不动、后缀换成 `Memory.kernel.creepSeq`，
  先实测"连续整数进 `h*31+charCodeAt` 会不会退化"并把门槛写成数值，再配两条反向实验），
  结案判据 = 孪生四态里的 **PASS**（`bash tmp/tools/official/e2e-seed-twin.sh tests/e2e/scenarios/17-multi-room-soak.test.ts 7 11`）。
  ⚠️在 PASS 到手之前，**任何 soak 场景的红都不许当因果证据**（这条今天已经用过一次：E2E-016 那类"真停摆"要靠可复现才升得了级）。
- **一条今天新立、约束所有后续修复的纪律（来自 #65 结案）**：**body/形状类改动对在途请求无效，要等 `expiresAt` 出队才见效**
  ⇒ 判效窗必须 ≥ 一个 `CONFIG.spawn.requestTtl`（本仓 = 1000 拍），且**部署生效时刻要按功能签名定**
  （`capacity.tier/since` 或"新形状首现那一拍"；`Memory.kernel.bootTick` 是历史值，不能用它给部署定日）。
  批次4 的解冻正好在换码后一个 TTL 落地 —— 不是我原先说的"缺陷未修好"。
- **一句话（#64，已做完）**：`countSpawnReject` 现在有五档（`survivalBlock/budget/reserveOnly/noDegrade/floor`），但**降级许可从未打开**
  这一型无处可计 —— 它今天只能靠"`reserveOnly` 在涨 + `noDegrade` 不涨 + `floor=0`"三件事**间接推断**，
  而这正是我这一整天反复用到的读法（幼房 builder 1150 撞 `cap−预留 1100` 那一条就落在这一型里）。
  **落点已读到**：`SpawnRejectReason` 在 `systems/room/spawn-manager.ts:347`（五档联合类型），
  `:481` 按 `cost > energyBudget` 二选一记 `budget`/`reserveOnly`，`:514` 的 `noDegrade` 只在**已进入降级分支**时才记
  ⇒ 缺的是"降级分支的前置条件（`pressure > 0.5` 那类许可）从未成立、分支根本没进"这一档。
- **为什么排第一（在批次4 判效之后）**：①纯观测，**不动任何阈值与安全语义**（对齐 §5 边界，不需要请示）；
  ②它把下一批的决策输入补齐 —— #61（预留语义）与 #73（G2 判定输入）都在等一个能区分
  "付不起"与"没被允许付"的读数；③改动面已知：`systems/room/spawn-manager.ts` 的降级判定处加一档计数 +
  `types/global.d.ts` 的 `spawnRejects` 形状补一个键，**与 #54 那批同构**（可直接照抄它的测试写法）。
- **可检验判据（必须带控制组）**：幼房 W38S56 出现 `degradeGateClosed` 增长（预期与 `reserveOnly` 同相位），
  核心房 W37S58 同窗**不应**出现（它 ea 常年满、降级从未需要）；旧五档一字不变 ⇒ #54 的基线不能被打断。
- **两条不该由我自己批的事（写清楚免得下一轮误当成我的权限）**：#61 预留语义（预留=安全语义）、
  #73 选项②（给扩张闸补判别量 = 动闸的输入）。这两条只摆数、只请示。
- **本批遗留的收口动作**（不属于下一轮主目标，但下一轮第一件事就是补它）：`bash tmp/tools/official/twin-after-push.sh`
  的三跑孪生若给出 FAIL（同 seed 两遍不一致），#62 不许记 completed，且**所有 soak 场景的红都继续不得当因果证据**。

### 4.0 下一轮 L2 主目标（21:15Z 按实测改写）：**幼房"请求排着不落地"的自锁回路**（#54）

- **一句话（已换）**：不再是"预留挡住了孵化"（那只是 18:28 那一型），而是 —— **body 按容量出、p2 降级阈值差 0.08 不放行、
  没 hauler 就更没有液体能量** 三者互相咬合：`hauler:p2 24件 age944` + `ea=300/1300` + `pressure=0.4167`（p2 降级要 >0.5）。
- **为什么仍排第一**：它是幼房所有消费出口的上游（builder 不落地⇒建造不动；upgrader 不落地⇒爬级实测掉到
  **+0.73/拍**，早先是 +2.65/拍，差 3.6 倍 ⇒ G0/#34 的 ETA 直接被它支配）；且场上已退化到 **hauler 0 / upgrader 0**，
  只剩 2 harvester + 2 builder —— 这是**存活**问题，不只是速率问题。
- **三问（按新证据重排）**：① `demand`/`estimatePlannedBody` 为何用 `energyCapacityAvailable` 而不是当前液体能量出 body；
  ② hauler 的 **p1→p2** 是谁给的（18:28 是 p1，21:10 四条全成 p2）—— 优先级分类学；
  ③ p2 饥饿降级阈值 `0.5` 与 `starvationDegradeFloor=300` 在低液体能量下是否**永远关不上**（0.4167 已差 0.08）。
  预留（`spawn-manager.ts:391` 条件 3）降为**次要项 #61**：它解释 18:28 那一型，不解释这一型。
- **可否证判据**：若 `IDLE + 队列非空` 持续、且 `队首 bodyCost > ea` 同时 `pressure ≤ 0.5` ⇒ ①③成立为自锁；
  若 hauler 一孵出回路立刻散 ⇒ 确认是自锁而非供能耗尽；反向对照：核心房 W37S58 同窗不应出现该形状。
- **一条可跟踪预测（写在这里等被打脸）**：stall 已到 853 拍，跨过 E5 的 10,000 阈值约在 tick 83373000（≈7.5 小时后）。
  若那时出现 `SUBMITTED development_resume` 却仍按容量出 body、p2 仍不放行降级 ⇒ **#57 的响应在这一型里是惰性的**，
  "加出口"必须补第二处（recovery 的提交路径不看液体能量）。
  ⚠️**这条预测的 ETA 与前提都变了**（10-02 05:0xZ）：锚点在 83368649 被一次脉冲爬级重置 ⇒ 阈值线 ≈**83378649**；
  而"仍按容量出 body"这一支已被 §4.0.1 定因成"**按档位常量出 body，越过容量**"并修掉 ⇒ 本条改由 §4.0.1 的判据接管。
- **取证器**：`tmp/tools/official/replenish-watch.sh`（`role:live/queue/oldestReqAge`）+ P4/P5 那条一次读全的表达式
  （spawn 状态、队列件数与年龄、按角色存活数、pressure/cr/rb）。

### 4.0.1 本轮（10-02 R87）：升级道被**需求侧档位常量越过物理容量**锁死（已修，判效待收）

- **现场（04:5xZ，tick 83371122，mark=R87M1，一次 console 读全）**：幼房 `cap=1300 / ea=1300`（口袋是**满的**）、
  队列三条 `upgrader 18件/cost **1650**` + `builder 15件/cost 1150`×2、`retries=0`、`economy.bk` **无 `spawned`** ⇒ 零孵化；
  `controllerProgressSeen=38167 / ChangedAt=83368649` ⇒ progress 冻结 **2,473 拍**。
- **定因（读码，非推测）**：`domain/spawn/demand.ts:891` 把"维持档想要的 body 尺寸"（`isSustainedPhase ? 1650 : 950`）
  当作 `energyCapacityAvailable` 传给 `selectBody` —— 全仓仅此一处不走 `energyCapacity`（其余 20+ 个调用点都走）。
  RCL4 幼房 storage 已过 `sustainedStorage=10000`（实测 18152）但 cap 只有 1300 ⇒ 出成本 **1650 > 1300** 的 body：
  **任何能量都付不起**，`budget` 拒因每拍烧一次（1022 拍 +441）。模板注释自己写着 1650 那档「RCL5(1800) 起可孵」、
  8W@950 那档「RCL4(1300) 主力档」⇒ 设计表达的是**档位**，实现当成了**容量**。
- **修改**：`Math.min(档位常量, energyCapacity)`。**只降不升**：storage 水位门槛（sustained/sprint）、`economyPressure`
  分段、`recoveryEnergyReserve=200`、`starvationDegradeFloor=300` **一个没动**（对齐的是 `bodies.ts:1659-1666`
  那条既有原则："可负担性必须按这份 body 的真实成本判"）。封顶后 upgrader 落 8W@950 ⇒ **950 ≤ cap−200=1100**，
  连预留武装期间也孵得出来 ⇒ 升级道不等 `size-vs-reserve` 的裁决。
- **测试**：`tests/unit/spawn/demand.test.ts` 新增 1 例（RCL4/cap1300 + storage 20k ⇒ `bodyCost ≤ 1300` 且 WORK=8）。
  **反向实验**：摘掉 `min` ⇒ 恰好这一例红、另 75 例绿（控制组覆盖 40W/15W/RCL8 各档，全部不受封顶影响）。
  门禁：typecheck 0 / unit 371 文件 5121 例 / integration 30 文件 239 例 / e2e 全量（本文件提交时以 `tmp/observe/r87-e2e.txt` 为准）。
- **判据（上线后）**：①幼房队列里 `upgrader:*` 的 `bodyCost ≤ cap`，且 `economy.bk` 出现 `spawned`；
  ②`controllerProgressChangedAt` 前移（它是 #34/G0 的唯一硬限速）；③`spawnRejects.budget` 增速塌回 ≈0
  （基线：83370018→83371122 的 +441），`reserveOnly` 仍会涨 —— 那是 builder 的 1150 撞 `cap−200` 的那一支，属待请示项。
- **仍未解、且本轮明确不自行做的两件**：① `size-vs-reserve` 提案 (i)（非 P0 body 尺寸上限收到 `cap − reserve`）
  —— 预留是安全语义，**须请示**；② 第 6 档 `degradeGateClosed`（现在只能靠 `reserveOnly↑ + noDegrade→0 + floor=0` 间接推断
  "降级被 `pressure>0.5` 闸关掉"）—— 与 (i) 是否并批同样等裁决。
- **本轮另一条预留侧定性（更正上一轮）**：`reserveOnly` 那 +1784 的武装者是**条件 3**（采集者 TTL 264 <
  `replacementHorizonTicks=600` 的替换窗前馈），不是 R86 写的"条件 2 抖动"——同拍 `cr=18152 / rb/10=8726 ≫ 400 /
  collectorCount=2` ⇒ 条件 1、2 均为假。口径带走：**"某个输入翻正"只说明它开始有资格，不等于它在开火**。

### 4.1 最近一轮（#60）：调优把幼房的升级产能单向棘轮到地板

- **现象**：幼房 W38S56 只有 1 只 upgrader、爬级实测 +2.65/拍，而 G0 要 RCL5（本服 RCL4 需 **405,000** 进度，
  我先前引的 55,000 错 7.4 倍，已按现场 `controller.progressTotal` 更正）。
- **根因**（不是 demand）：`tuning.rooms.W38S56.roleBounds.upgrader.maxCount = 1`。调优 ↓ 分支写的是
  `avgStorageEnergy < storageLow && rcl >= 4` —— 用「RCL4 已解锁」当「storage 存在」的代理；而 storage 还在施工的房
  `avgStorageEnergy` 恒 0 ⇒ 条件永久成立，每 cooldown 压一档；↑ 分支要 storage 盈余 ⇒ 无结构时永不可满足 ⇒ **单向棘轮**。
  TU-1 的注释道理本来是对的（"未解锁 ≠ 枯竭"），错在代理量。
- **修改**：`TuningSignals` 加 `hasStorage`（engine 从快照填），↓ 分支改读它。阈值/step/floor/↑ 一个没动。
- **测试**：新增 TU-1b 用例。**反向实验先抓到我自己写了条空断言**（prevTrend 传 "down" ⇒ 趋势当轮被消费复位，
  新旧两版都绿）；改成首次观测后：旧码恰好这一例红、另 6 例绿，新码全绿。
- **残留（诚实）**：这次修的是"别再往下压"，**不会把已有的 `maxCount=1` 抬回** —— ↑ 要 storage 盈余而它还在施工。
  要立刻恢复只能改写那条 Memory 覆盖 ⇒ 属状态改写，**已上报、不自行执行**。
- **一条预测被保住**：按 405,000 这条实测线，"环内 3,957 拍没有升级事件"是**预期的**；
  旧的 55,000 口径早就该在 83355220 前升一次级而环里根本没有 ⇒ 旧数被否两次。

### 4.2 上一轮（#57）：停摆信号接入既有失败图，并给它一条不反向的响应


- **信号源**：`empire-health.collectActiveFailures` 新增房级节点 `failure:development:<room>:<tick>`，
  触发量 = `tick − Memory.rooms.*.controllerProgressChangedAt > E5_STALE_TICKS`（复用阈值，未新增），RCL8 跳过（与 E5 同保护）。
- **响应**：新 `FailureDomain "development"` + 新 `RecoveryActionType "development_resume"` →
  `submitDevelopmentResume` 请求 **upgrader**（只有 `buildQueue` 非空时才加 builder），走既有 `spawnKey`/`hasRequest` 去重。
  为什么不复用 `colony → population_rebuild`：那条实做孵的是 **harvester**，而停摆房的病灶是"消费出口没了、能量在顶满溢出"。
- **顺带修掉一个真缺陷**：`captureWorldSnapshot` 仍在用 `targetFailureId.split(":")[1]` 取房名 —— 那正是本文件头部注释明令禁止的
  按位置解析，拿到的其实是**维度名** ⇒ 验收用的房级 before/after 指标（room / energyAvailable / activeRemoteOps）恒缺，
  恢复验收实际上只剩"全局人口有没有涨"一个可用信号。改成 `action.room`，并给快照加 `controllerProgress`
  作为 `development_resume` 的唯一验收量。
- **测试**（`recovery-action-pipeline.test.ts`，3 例真实 kernel）：房级 colony 链、控制组（不注入则房级节点必须不出现）、
  停摆链（断言响应是 upgrader 且**不是** harvester，另加防刷断言：240 拍内 correlationId ≤ 2，
  因 `maxAttempts=2 / cooldown=1000` 必须把每 100 拍重报的节点 bound 住）。
  反向实验：把停摆节点短路掉 ⇒ 恰好停摆那一例转红、另两例全绿。
- **门禁**：typecheck 0 / unit 368 文件 5101 例 / integration 30 文件 238 例 / build 0；e2e 全量在跑（本改动会在长场景里多出孵化请求，必须过）。

### 4.3 更早（#56）：E5 停滞计时的部署致盲

**目标**：修复"帝国看不见自己的停摆"——E5 `rclStale` 的部署致盲。

**问题证据**：幼房 `controller.progress` 冻结数小时（#54/#55 的消费侧饥饿链）。定罪靠的是代码而非读数：
停摆窗口内每个进程存活都 < 10000 拍（今天笔间隔量级 1~2 小时 = 1200~2400 拍），而计时器随部署归零
⇒ 那条窗口里 E5 **按构造不可能**报。辅证（较弱）：几处 `期望自检` 快照的前 10 项只有 pathFailure，
而 E5 在 E8 之前 push，若报过应在列。
**根因**（读码定因，非推测）：停滞时长存在 heap（`globalCache().rclProgressTracker`），每次换码归零；唯一跨部署基准
`lastRclChangeAt` 只在回退支，而采集器每拍都显式给出 stall ⇒ 回退支恒不可达。叠加 1500 拍 boot 宽限与 10000 拍阈值，
迭代期（今天 8+ 笔换码，间隔远小于 10000 拍）**结构上无法触发** —— 而会掐断升级道的改动本身就是一次部署。
**修改**：`c93f467` — room-state 维护 `controllerProgressSeen/ChangedAt`（progress 一变即刷新），采集器改按锚点算 stall，
删除 heap 追踪器。**阈值、RCL8 保护、boot 宽限、绝对龄回退支一个都没动。**
**验证**：typecheck 0 / unit 368 文件 5101 例 / integration 29 文件 235 例（含新增 3 例）/ build 均绿；
反向实验：把 stall 钉回 0（=旧行为）时"陈旧锚点应报"转红、两条控制组（新鲜锚点不误报、进度在动不误报）仍绿。
**部署**：已随批次1 推送 —— `origin/dev=f28bbf5 → 57557db`（18:17Z，快进、无 force，pre-push 五门禁通过）。
判效签名不是 sha 比对（push 时 pre-push 钩子把 dist 重建成 HEAD，含 #59，"本地 sha==线上 sha"这条锚被我自己覆盖了）
⇒ 改用**功能签名**：18:20Z/18:24Z 两次实测 `controllerProgressChangedAt=null`（旧码无写者），上线后应变有值；
跑 `tmp/tools/official/verify-batch1-landing.sh aac54fd34a5b 600`（要求线上 sha 从基线变走且连续两次一致）。

**待收判效（下一轮第一件事）**：
- ~~#55~~ **已收并已撤销指控**（见 §3 P0-1：18:24Z mark=C3 在 recovery 相同拍看到 `upgrader:2` 请求）。
- **#54 改由差分承担**：`replenish-watch.sh`（每轮记 `role:live/queue/oldestReqAge`）跑满一个死亡-补员窗口后再立案；
  单次快照在这类问题上结构性无力 —— 判据住在"从 0 到 1 的那段时间"，采样点落在两端就看不见它。
- #48：判据已第三次更正（无 storage 前置）⇒ 恒 0 的含义是"没发生跨房卸能"，等一次真实补给事件。

## 5. 自主执行边界（照抄 L0 §1.5，落到本项目口径）

可自主：代码分析/修改/测试/本地构建、官服**只读**观测与诊断、按批次推送部署。
必须请示或不执行：降闸门槛让扩张变绿、砍营收线或拆已建资产去凑 CPU 指标、任何市场下单/撤单、
重置 Memory、删除资产、主动开战、发射核弹、改变外交关系、绕过权限或伪造凭证。
凭证只经 `tmp/tools/.env`（未跟踪、不入日志/报告/版本库）。

## 6. 变更记录（追加式）

- 2026-10-01 L1 建档；本轮 L2 = E5 停滞计时跨部署化（`c93f467`），P0-2「检出→响应」立案为下一批主目标。
- 2026-10-01 #57 实施（`0776a0d`）：停摆信号接入**既有**失败图 + `development_resume` 定向响应；顺带修 `captureWorldSnapshot` 按位置解析房名。
- 2026-10-01 #60 实施（`2383551`）：调优 ↓ 分支改读 `hasStorage`，拆掉"已解锁未建成"这条单向棘轮；P0-3 的"第一次真停摆取证"改由上线后的锚点差分承担。
- 2026-10-01 #59 实施（`3c0bbff`，批次2）：恢复烧穿重试预算 ⇒ 事件 + `Memory.kernel.escalations` 有界清单（P0-4 的"检出→响应"里"响应不上报"那一半）。
- 2026-10-01 撤销我自己给 #58 加的后果推论（link 不入账 = 账本边界，非失真）。
- **推送状态（18:17Z 更新）**：`origin/dev=57557db` —— 批次1（#56 `c93f467` + #57 `0776a0d` + #60 `2383551`）已快进推送，
  证据=全量 e2e `33 passed (33) / E2E_EXIT=0`，且被测 dist 内 `RecoveryEscalation=0` ⇒ 该次绿**恰好且仅**覆盖这批的可执行内容。
  批次2（`3c0bbff` #59）**证据正在攒**：rebuild 后 dist 779,899B、`RecoveryEscalation=1`，全量 e2e 后台跑
  （`tmp/observe/e2e-batch2.log`）；绿后按 sha 推。⚠️批次2 在跑期间不得再 push —— pre-push 钩子会重建 dist，
  而 e2e 读的就是那个二进制（这次就是它把批次1 的 sha 锚覆盖掉的）。
  判效：`tmp/tools/official/verify-batch1-landing.sh aac54fd34a5b 600`（功能签名 = 锚点 null→有值；null 的基线已实测两次）。

- 2026-10-01 **批次1 判效到手**（18:29/18:43）：线上 sha `aac54fd34a5b → f58e3a13dede`。同一探针
  `controllerProgressChangedAt` 上线前两次实测 null（B0@83361142、C2@83361192）→ 上线后 83361266；
  FT2@83361496 再证明**跟随**（progress 29,334→29,340 那一拍锚同拍前移）⇒ #56/#57 的仪器两个方向都验到，
  不是一次性初始化。`lastAdjusted` 三读不变（83352766）⇒ #60 不再被压（下界证据，不等于"能升档"）。
- 2026-10-01 **批次2 已推**（`origin/dev 57557db → 4b017a5`，快进、无 force）：`3c0bbff`(#59) + 一批 docs + `4b017a5`(test-only)。
  全量 e2e `33 passed (33) / 70 tests / E2E_EXIT=0 / 红 0`；推前与推后 `dist/main.js` sha 同为 `53e76dda2ac4`
  ⇒ pre-push 钩子重建出**同一字节**，证明上线内容与被测内容一致（这条就是批次1 丢掉的那把锚，这次补上了）。
- 2026-10-01 **E2E-022 的 R-04 按机制改判据**（`4b017a5`）：旧"降级数必须为 0"罚的是 posture.ts 规定的撤资动作。
  新三件：①每个降级都必须能被危机带解释；②降级数 ≤1（撤资→再战→再撤资仍算振荡，照罚）；③war 窗内危机带 tick 为 0
  + 经济红线一条没动。**非空转性有实测出处**：改后那次全量的世界真的有降级（`downgrades=6085`，危机带正在 t6085/3t/Δ=−405）
  ⇒ 新判据放过它，而旧判据会让整批红。⚠️仍欠一次变异实验（≤1 改 ≤0 必须转红；历史样本命中率约 1/3）。
- 2026-10-01 **#62 立案（未修）**：长 soak 的**一拍级分叉** —— 同一 dist sha 的场景 22 跑出 firstWar 5002/5003、
  warSpan 1082/3999/4000、finalSpawned 8/10/17/20 共六个不同世界。生产侧随机源确认是**活路径**：
  `evaluator.ts:178` → `exploreParameter`（稳态 3 周期后随机选参数 + 随机选方向改 roleBounds，每参数冷却 5000 拍）。
  测试层替换 `Math.random`（`E2E_RANDOM_SEED`）**没能**复现世界 ⇒ 两种解释都还活着（bot 在够不到的 realm / 分叉不由 RNG 驱动）。
  这条同时给 #60 的结论加了边界：探索绕开趋势逻辑 ⇒ "没再降"≠"此后不会降"；`explorationState` 住 heap ⇒ 换码即清零。
- 2026-10-01 **#54 结案对象更正 + #61 请示中**：幼房"请求排着不落地"根因在孵化预留（`spawn-manager.ts:391` 条件 3），
  跨阈值配对实测（ea 296 ⇒ 非 P0 预算 96 < 最便宜 body 150 ⇒ spawn 空转、progress 冻结 158 拍；
  ea 451 ⇒ 预算 251 那一拍立刻开孵 upgrader，progress 随之解冻）；而它要保护的采集者本就被 `:430` 豁免、
  预留生效期间队列里也没有采集类请求 ⇒ 保护冗余。**属安全预留的语义改动（不动 200 这个数），按红线未动、待批。**

- 2026-10-02 04:0xZ **P2/#48 判效到手 = PASS**（跨房供给合同第一次被真实事件拍到）：同 boot 段（基线 01:55:56Z 换码）
  `energyLedger.rooms.W37S58.exported == rooms.W38S56.imported`，两次配平 `3600/3600` → `4800/4800`（差分各 +1200），
  幼房 `exported=0`。证据等级说明：**这是累计金额配平**，"同一拍两侧各记一次"要连读两发 `bk` 增量才算，尚未拍到。
  前提能达成的原因是幼房 storage 建成（09-30 RCL4 后 storage 落地 ⇒ `carrier.ts:42-43` 那条"目标房必须有 storage"第一次可满足）。

- 2026-10-02 05:0xZ **R87 实施：upgrader body 档位常量被物理容量封顶**（`domain/spawn/demand.ts:891`）：
  维持/低水位档把 `1650 / 950` 当 **容量** 传给 `selectBody`，越过 RCL4 幼房的 `energyCapacityAvailable=1300`
  ⇒ 队列里躺着 cost 1650 的请求，**任何能量都付不起**（`spawnRejects.budget` 1022 拍 +441、progress 冻 2,473 拍、
  `bk` 无 `spawned`）。改成 `Math.min(档位, energyCapacity)`：只降不升，storage 水位门槛 / pressure 分段 /
  `recoveryEnergyReserve=200` / `starvationDegradeFloor=300` 一个没动；封顶后落 8W@950（模板注释的「RCL4 主力档」）
  ⇒ 950 ≤ cap−200，**连预留武装期也孵得出来**。门禁 tsc 0 / unit 371 文件 5121 例 / integration 30 文件 239 例 /
  反向实验＝摘掉 `min` 恰好新增那一例红、另 75 例绿。判据见 §4.0.1。**仍待批**：`size-vs-reserve` 提案 (i)
  （非 P0 body 尺寸上限收到 `cap−reserve`）与第 6 档 `degradeGateClosed` —— 都碰安全预留语义/计数口径，不自行做。

- 2026-10-02 05:0xZ **一处自我更正（预留武装者）**：`reserveOnly` 一小时 +1784 的成因是**条件 3**（采集者 TTL 264 <
  `replacementHorizonTicks=600` 的替换窗前馈），不是上一轮写的"条件 2 在 riskBuffer 估计值附近抖动"——同拍
  `cr=18152 / rb/10=8726 ≫ 400 / collectorCount=2` ⇒ 条件 1、2 均为假。另记：`kernel.escalations` 首条真实条目到手
  （`W38S56/colony/population_rebuild, attempts=2, terminal=true @83369862`）⇒ #59 等的"真实烧穿"结束。
- 2026-10-02 **批次4 认领并执行中**（`origin/dev=3638dd2` 之上三笔：`e1b12b3` #62 探索随机源接缝、
  `7003568` upgrader 档位常量被物理容量封顶、`979987e` E2E-036 种子通道）。
  build 后的 `dist/main.js` sha=`cf13f86aa356`，且构建时 `src/tests` 工作区干净 ⇒ 被测二进制与 HEAD 一一对应；
  跑测前后各记一次 sha，防止中途被重建（`tmp/observe/e2e-batch4-sha.txt`）。
  ⚠️套件文件数 33 → **34**（新增 E2E-036）⇒ 旧脚本里写死的 "33 passed (33)" 判据已过时，绿要人读摘要行。
- 2026-10-02 **#62 交付到"通道 + 消费"两段都有测**：单测层 12 例（含反向实验：撤掉注入 ⇒ 恰好 1 例红）；
  e2e 层 E2E-036 双向对照（没给种子 ⇒ Memory 里不许出现该字段；给了 ⇒ 必须穿过 isolate 落到
  `Memory.kernel.testRandomSeed`，反向实验撤掉调用 ⇒ 恰好"给了"那例转红）。
  仍未做的收口：**同 seed 两跑短场景比对世界读数** —— 这才是"可复现"的正证，批次4 上线后第一件事。
- 2026-10-02 **#73 立案**（详见任务列表）：扩张闸 G2 的判定输入是 `classifyRoomEconomic` 的
  `colonyState ∈ {bootstrap,recovery,defense} ⇒ struggling`，于是"在建自己的幼房瞬进 recovery"就把帝国
  判成"有困难房"⇒ G2/G3 随相位在几分钟内来回（04:5xZ 四道 ↔ 05:1xZ 两道，同一台机器）。
  与 (A) 一起看：`healthy` 需 `coreRooms≥2` 而 `core` 需 **RCL≥6** ⇒ 幼房到 RCL5 也到不了 healthy，
  **#34 的口径要从"须 RCL5"改成"须 RCL6 才有 healthy；RCL5 只解 G0 那一条"**。
  我不动闸的输入，只摆数请示（选项②=给闸补一个它本该有的判别量，不新增阈值）。
- 2026-10-02 06:00Z **批次4 已认领、闸门挂上**（`tmp/tools/official/batch4-gate-and-push.sh`，PID 已核）。
  推送前基线（当场取，非事后补算）：线上 `badba4de1110`、被测 dist `cf13f86aa356`、HEAD `2d68956`（五笔，
  `origin/dev..HEAD` 的 11 个文件逐个对过，无第三方文件混入）。三道闸：34/34+`E2E_EXIT=0`+零红 ⇒ dist 未变 ⇒ 快进（不 force、不 `--no-verify`）。
  **两处判据更正（都会把判效读反，趁上线前改）**：
  ① `verify-batch4.sh` 的 V1 列序注释写的是 17 列（含 `seen/harvester/cap/spawn`），EXPR 实际只返回 13 列
  ⇒ 按错表头读会把第 10 项 `economyPressure` 当成容量，判据①当场读反；已改实名 13 列。
  ② 判据①曾写"budget 与 reserveOnly 增速一起塌零"——**reserveOnly 那半支撤掉**：05:37→05:53 差分 +239/+239
  （每拍各挡 1 条）里 reserveOnly 那位是 builder `cost 1150 > cap−预留 1100`，封顶改动只动 upgrader 的档位常量，物理上碰不到它
  ⇒ 它继续涨不是回归。**这条改错的代价不是判错，是会把我推向"去动预留闸"** —— 预留是安全语义（§4.0.1 那条"属待请示项"本来就写着，是我自己后来把它忘了）。
  **判据现状**：①`spawnRejects.budget` 增速→0 ②场上 ≥1 只 upgrader 且 `stall` 归 0（锚点重新跟随）③`roleBounds.upgrader.maxCount` 1→2 且 `lastAdjusted` 离开 83352766。
  **E5/#57 的线上判据就此定性**：批次4 解冻升级道 ⇒ 锚点重置 ⇒ `rclStale` 大概率不再自然触发（05:40Z 实测 stall=3,205、`no-rclStale` 符合阈值 10,000 未到）。
  那是**预期内**，不是失败；#57 的线上证据等级停在"检测半段有正证（锚点在场且跟随）+ 响应链由集成测试覆盖"，收口要等下一次真实停摆，**别为了看它响而留着缺陷**。
- 2026-10-02 06:2xZ **批次4 已上线（字节级确认）**：全量 e2e `Test Files 34 passed (34) / E2E_EXIT=0 / 零红行`
  ⇒ 闸门②dist 未变 ⇒ 快进推送 `3638dd2..7a739d2`（七笔）⇒ 线上 sha 现读 **`cf13f86aa356` == 本地 dist == 被测二进制**。
  判效器 V1/V2 差分探针在跑（基线 06:00:26Z：tick 83372165 / stall 3,516 / budget 1,692 / reserveOnly 3,111 / `no-rclStale`）。
- 2026-10-02 **#62 的孪生跑给出 FAIL，并且这一次是好消息 —— 它抓到第二个分叉源，而且抓到了它的消费者链路**：
  同 seed=7 两遍 `17-multi-room-soak`（同一二进制 cf13f86aa356）在 tick 2001 就给出不一样的人口
  （`byHome W0N1=5` vs `4`，到 5001 是 `2/2` vs `4/3`，`queues=83` 两边一致 ⇒ **需求侧确定，孵化/存活侧分叉**）。
  根因不是"种子没接上"，是**我只接了一处随机源**：`systems/room/spawn-manager.ts:544` 的 creep 命名里挂着
  `${Math.random().toString(36).slice(2,6)}`，而**这个名字是决策输入** —— `creeps/support/targeting.ts:107` 与 `:569`、
  `creeps/roles/remote-harvester.ts:119` 与 `:219` 都按 `creep.name` 逐字符求 hash（`h = h*31 + charCodeAt`）来错开目标选择。
  ⇒ 名字里的随机后缀不是装饰：它每孵一只 creep 就抽一次真 `Math.random`，直接进目标分配。
  **所以 `#62` 不许记 completed，`evaluator` 那条接缝是必要而不充分的**（它管住了调优探索，管不住命名）。
  下一轮的收口动作（一次改动 + 一次孪生即可定案，规格已就绪）：把命名随机源换成**确定性且逐只唯一**的序号
  （`Memory.kernel.creepSeq` 单调，角色+房+序号组成键）—— 两点必须同时保住：①名字在帝国范围内唯一（引擎约束），
  ②hash 仍逐只不同（这是防"全体 creep 同时盯同一个目标"的错开机制，换成常量就是把防抖器拆了）。
  定案判据：改完后同 seed 两遍 `byHome/queues` 逐字一致 **且** 异 seed 仍分叉；若同 seed 仍不一致 ⇒ 还剩第三个源（届时优先查引擎侧）。
  ⚠️诚实边界：本轮**没有**证明命名 hash 就是 2001 拍那一只是唯一分叉原因（也可能是引擎侧墙钟 CPU 计量），
  证明的是"存在第二个未接线的随机源，且它在决策路径上"。前者要靠上面那次反向实验。
- 2026-10-02 06:4xZ **批次4 判效 = 三条判据全部未达成，而且原因不是"还没到"**（V1 06:31:14 tick 83372646 / V2 06:41:27 tick 83372804，同一段 158 拍）：
  ① `spawnRejects.budget` 2052→2210 = **+158 ⇒ 精确 1/拍**，与上线前的增速一模一样（`reserveOnly` 反倒冻结在 3111）；
  ② 场上 upgrader 仍 **0** 只、`controller.progress` 仍 38,167（stall 3,997→4,155）；③ `roleBounds.upgrader.maxCount` 仍 1、`lastAdjusted` 仍 83352766。
  **定罪读数（一发队列全文，mark=QP3，tick 83372876）**：队列里只有 1 条请求 ——
  `key:"upgrader:W38S56:0"`、`body:[work×15, carry, move×2]`（= 成本 1650）、`priority:2`、`retries:0`、
  `createdAt:83372481` ⇒ **换码之后 ~140 拍由 demand 侧新建的**，不是上线前遗留的旧条目（`expiresAt=createdAt+1000`，
  `spawnBlacklist` 空 ⇒ 也没被隔离）。同刻实测 `ea=1300 / energyCapacityAvailable=1300 / rcl=4 / spawning=null`。
  ⇒ `Math.min(档位常量, energyCapacity)` 封顶在**这条生产路径上没有落地**：要么 `createRequest` 的 body 不是取自这个入参，
  要么还有第二个生产者用同一个 key 写 15W。**这一条是本批唯一未闭合的推理，我不给它写"已定因"**。
- ⚠️**为什么单测绿而线上不动（这次的教训形状）**：`tests/unit/spawn/demand.test.ts` 那条新用例喂的是最小夹具
  （RCL4/cap1300 + storage 20k）并断言 `evaluateDemand` 产出的 bodyCost ≤ 1300 —— 它验的是**我改的那个函数**，
  不是**线上那条队列条目的产地**。全量 e2e 34/34 也没有一条断言覆盖"幼房真形状下升级道能落地"。
  ⇒ 下一轮第一件事：读 `createRequest` 的 body 选择（`demand.ts:1187-1220` 一带）把 15W 的产地指出来，
  然后把判据写成**末端断言**（队列里的 body / 场上 upgrader 数），而不是函数返回值断言。
  在此之前 `#47/#54/#70` 相关的"孵化侧钥匙造不出来"这一族**不得记结案**。
- 本批其余内容正常落地，无一回归：线上 sha `cf13f86aa356` == 本地 dist == 被测二进制（字节级），
  `#62` 接缝与 E2E-036 随批上线；幼房 storage 37,951→41,191 仍在涨（盈余照旧无处可去 —— 正是这批要修的那条道）；
  `tier` 从 `tight` 变 `constrained` 按既有口径当**部署税**读（判 tier 只看 `tier`+`since`，boot 后 ~400 拍不采信输入）。
- 2026-10-02 06:4xZ **上一条"封顶没落地"的推理被我自己测出来否掉了一半**（这是定罪读到的行为，不是猜的）：
  用一个临时单测跑**当前这份 dist 的同一份源码**测了选择器本身 —— `selectBody("upgrader", 1300, {rcl:4})` 返回
  **11 件 / cost 950**；1650 与 1800 两档才返回 18 件 / 1650；档位表实测成本
  `[[4200,4150],[2700,2650],[1650,1650],[950,950],[500,500],…]`（`minCapacity` 与真实 cost 在前四档一致）。
  ⇒ `Math.min(档位常量, energyCapacity)` 在 cap=1300 下**确实**产出付得起的 body，`createRequest` 也把入参透传给了它（:1187→:1215）。
  那 18 件那条队列条目只可能是**用 ≥1650 的容量铸造的**，或出自**第二个不走 `bodyEnergyCap` 的同 key 生产者**。
  两支都还没排除，本轮**不给结案**：
    H1 房的容量在 `createdAt=83372481` 时 ≥1650、到 83372857 已是 1300（extension 损失会让容量回落）
      ⇒ 这条请求生下来就付不起，会在 TTL `83373481` 出队，之后按新档位重铸 950 —— 封顶要在那之后才看得见；
    H2 另有生产者用同一 key 写 18 件（不走封顶）。
  **可否证预测（下一轮一发探针即可定案）**：过 `83373481`（≈06:5xZ 起）再看那条队列 ——
    H1 成立 ⇒ 条目变 11 件/950，且 `spawnRejects.budget` 增速在几拍内塌零、场上出现 upgrader；
    H2 成立 ⇒ 18 件被反复重铸、`budget` 继续按 1/拍涨。⇒ 顺手把 `spawnRejects` 的**增速**也记成按房的读数，别再靠单次快照。
  ⚠️我自己撤回一发读数：`r.findObjects("extension")` 返回 0 —— 该 API 要 `FIND_*` 常量不是字符串，
    那是**探针写法无效**，不是"这房没有 extension"。判 extension 数走 `Game.structures` 遍历（我重试那发 34s 读回超时 = 失败形状，未定罪）。
- 2026-10-02 07:2xZ **H1/H3 都被实测否掉，H2 仍开着 —— 但差 13 拍没拿到定案那一读**（全部带 mark，QPA/QPB）：
  · **H3 死**：`systems/room-snapshot.ts:222` 就是 `energyCapacityAvailable: room.energyCapacityAvailable`（读活值，不是缓存/串房）。
  · **H1 死**：幼房实测 **20 个 extension、总 hits 20,000、房内外 hostile 0**，`energyCapacityAvailable=1300`
    ⇒ 本服容量 = 300 + 20×50 = **1300**，而 RCL4 的 extension 上限就是 20 ⇒ **这房在 RCL4 物理到不了 1650**。
    那条 18 件（cost 1650）不可能是"容量曾经够、后来回落"的产物。
  · **仍然观察到的事实**：同一条 `upgrader:W38S56:0`（createdAt 83372481、expiresAt 83373481）**未被续期**（83372876 时 expiresAt−now=605）
    ⇒ `budget` 那 1/拍的增速是它一根贡献的；到 83373468 它仍在队里（差 13 拍到 TTL，本窗没读到出队后的重铸）。
  · **新的一条正证（把 #61 从推断升成两次实测）**：83373384 队里新铸了一条 `builder:15件`（cost 1150），
    **同一时刻** `reserveOnly` 从冻结的 3111 开始重新上涨（3111→3196，+85）⇒ "1150 > cap−预留 1100" 这支现在有了
    带时间戳的两次独立读数，而 demand→队列→成本判定这条管道**是活的**（builder 侧走 `energyCapacity`，不走档位常量）。
  ⇒ **下一轮第一件事（一发探针定案，别改码）**：读 `>83373481` 之后的那条 upgrader 条目 body 件数 ——
    11 件 ⇒ 封顶生效、1650 那条是 boot 期的异常产物（再查 boot 窗的 snapshot/`roomCtx`）；
    18 件 + 新 createdAt ⇒ **确有第二个不走 `bodyEnergyCap` 的同 key 生产者**（候选：`:979` 之外还有 upgrader 出队口）；
    条目消失且场上出现 upgrader ⇒ 直接修好，判效②转 PASS。
  ⚠️诚实边界：本批三条判据**仍未达成**（budget 1/拍、upgrader 0、maxCount 1），我**不**把它写成"已定因"，也**不**在没读到重铸前改码。
- 2026-10-02 07:2x–07:3xZ **批次4 判效：①②转 PASS（线上真凭据），③仍未到**（四发 mark 探针 QPC/QPD/QPE，同一房 W38S56）：
  · **②PASS 的完整链条（逐拍对上）**：旧那条 18 件条目在 `expiresAt=83373481` 出队 ⇒
    **83373482 demand 重铸并当场孵出** `upgrader-W38S56-0-83373482-dai3`，**body=11 件**（= 8W1C2M / cost 950，正是封顶后的档位）；
    到 83373575 `controller.progress` **38,167 → 38,567（+400）**，且 `controllerProgressChangedAt=83373575==Game.time`
    ⇒ **锚点重新跟随**（#56 的语义、#34/G0 的唯一硬限速都在这一读里复位），stall 从 4,262 拍**归零**。
  · **①PASS**：`spawnRejects.budget` 自 83373490 起 **2755 → 2755，85 拍零增长**（此前是精确 1/拍）；
    同窗 `reserveOnly` +37（0.43/拍）= 那条 `builder:15件/1150` 撞 `cap−预留 1100` —— **不是判据，属 #61**（口径按上一条更正执行）。
  · **③未到**：`roleBounds.upgrader.maxCount` 仍 1、`lastAdjusted` 仍 83352766。↑ 分支三条前置（storage>surplus、pressure 健康、current<ceiling）
    按 07:2xZ 读数都成立 ⇒ 下一轮看它是否在一个 tuning 周期内动；不动才是问题。
  · **速率账（诚实的 ETA）**：11 件 body = 8 WORK ⇒ ~+8/拍，maxCount=1 时 RCL4 的 405,000 进度**单只吃不下**（≈14 小时窗）
    ⇒ 升级道现在"活着但被编制上限勒着"，③是唯一能把速率翻倍的杠杆。
  ⚠️**留一条我没闭合的尾巴**：那条 18 件条目（createdAt 83372481，换码后 ~140 拍）**产地仍未指认**——
    封顶路径在本服实测产不出 1650（选择器单测 + 这次重铸都是 11 件），H1/H3 又都被实测否掉，
    所以"还有第二个同 key 生产者"是唯一活着的假设，但**本轮没有正证**。
    定案读法（不用改码）：下次 boot 后第一读 `spawnQueue`，若 boot 窗内出现 18 件 upgrader 条目就抓 `key`+`createdAt`+`memory`，
    再按 key 反查生产者（demand 的 9 个 `createRequest` 出口里只有 :979 走 `bodyEnergyCap`）。
- 2026-10-02 07:4xZ **批次4 终判：①②PASS（连续两窗）、③FAIL 且"等一个周期"这条退路被同一读否掉**（mark=QPF，tick 83373744）：
  · **②坐实成趋势而非一次性**：progress 38,567(83373575) → **39,919**(83373744) = **+1,352/169 拍 = 精确 8.0/拍**（= 8 WORK，与 11 件 body 一致），
    `controllerProgressChangedAt=83373744==Game.time` ⇒ 锚点**持续跟随**（不是"变了一次没跟上"）。
  · **①再确认**：`spawnRejects.budget` 从 83373490 的 2755 到 83373744 仍是 **2755 ⇒ 254 拍零增长**（解冻前是精确 1/拍）。
  · **③不成立，且原因不是"周期还没到"**：`lastAdjusted` 里 `builder.maxCount=83371766`、`hauler.minCount=83368766` ——
    **调优引擎在跑、而且刚在 2,000 拍网格上动过别的键**；只有 `upgrader.maxCount` 冻在 **83352766（≈21,000 拍前）**。
    ⇒ 我 07:2xZ 写的"↑ 分支三条前置按读数都成立"**证据不足**（那是我按需求侧读数推的，没重读分支自己的门槛）；
    下一轮要按 #60 那条的老办法做：**读 ↑ 分支的实际门槛代码**，把每个门槛对着当场读数逐个判，再决定是"门槛不满足（设计如此）"
    还是"门槛永远满足不了（缺陷）"。**在这之前不动任何阈值。**
  · **速率账更新**：+8/拍下，本服 RCL4 的 405,000 进度要 ≈**14 小时**（单只 8W）；③若落地（maxCount 1→2）就是 ≈7 小时。
    ⇒ 幼房到 RCL5（解 G0）的时间现在**由 ③ 支配**，③是本批之后最该跟进的一条。
- 2026-10-02 07:4xZ **#66 读代码后改判为"门槛不满足=设计如此"，不是结构缺陷**（`evaluator.ts:352-405`，逐门槛对当场读数）：
  ↑ 分支四条全要成立：非冷却（`lastAdjusted=83352766`、距 83373744 约 21,000 拍 ⇒ 早过了）、
  `avgStorageEnergy > surplus`（storage 41k+ ⇒ 成立）、`avgPressure < HEALTHY`（0 ⇒ 成立）、
  **`s.upgraderCount >= current`**（current=1 ⇒ **要有 ≥1 只 upgrader 在场**）与 `current < ceiling`。
  ⇒ 第四条件在整个停摆窗里都是**假**（stall 期间 upgrader 0 只，直到 83373482 才孵出第一只）——
  所以 `maxCount` 冻在 83352766 是"编制的证据之一就是编制本身"的正常表现，不是棘轮复发。
  **我 07:2xZ 那句"三条前置都成立"错在这条**（我数了三条、没数第四条件）。
  带走一条口径：**↑ 分支的门槛里含"当前编制已满"，所以任何把该角色清零的停摆都会同时冻结它的编制增长 ——
  判"调优不涨"之前先确认那个角色在场**（#60 那次是反向的同族问题：无 storage 结构时 ↑ 永不可满足）。
  **可检验预测（下一读即可定案）**：`evalInterval=500`、调整冷却按 `lastAdjusted` 的 2,000 拍网格看是 2,000
  ⇒ 自 83373482 起四条件同时成立，**tick ≈83374766 前后**应看到 `roleBounds.upgrader.maxCount` 1→2 且
  `lastAdjusted.upgrader.maxCount` 离开 83352766（若 `confirmAndBuild` 要两次同向观测，则 83376766 前）。
  到期不动 ⇒ 才是 #66 真案（届时按当场 signals 逐门槛复算，别按我这句推）。
- 2026-10-02 07:4xZ **#64 实施（本地，随下一批推——不为一个观测档单独换码）**：第 6 档 `degradeGateClosed` 落在
  `spawn-manager.ts:528` 那个此前**只 `continue` 不记任何东西**的出口（allowDegrade 五条件全假的那一支）。
  三处改动：联合类型加档（含"正交标签、不参与加总"的口径注释）、初始化补第六键 **且补旧对象缺键的零**、出口计数。
  **allowDegrade 的条件、`pressure>0.5`、`starvationDegradeFloor` 一个没动**（§5 边界：只加出口，不加闸也不松闸）。
  两条**反向实验**（自改自测也要反着打）：
    ① 撤掉"旧对象补零"那一行 ⇒ **恰好 1 例转红**（旧五键形状那条），其余 28 例绿 ⇒ 那条 NaN 陷阱由测试**真的**覆盖；
      （这条坑的来历：`mem.spawnRejects ??= {…}` 对已存在对象不生效，线上各房的 spawnRejects 是 #54 建的五键形状，
       直接 `+= 1` 得 NaN → JSON 落 null → 计数器上线即永久哑火；单测每次新建 Memory 六键齐，**抓不到**。）
    ② 撤掉出口计数本身 ⇒ **恰好 2 例转红**（两条断言 `degradeGateClosed=1` 的），
      而"许可打开时必须仍为 0"那条对照**不红**、#54 的 7 例与 `try-spawn` 19 例全绿 ⇒ 新键不是每拍常数，旧档口径没被打断。
  `tsc --noEmit` 干净；全量 unit + integration 在跑（`tmp/observe/b64-unit.log` / `b64-integ.log`）。
  **上线判据（按差分，带控制组）**：幼房 W38S56 这档应随"builder 1150 撞 cap−预留"同相位增长；
  核心房 W37S58 同窗不应出现；旧四档（survivalBlock/budget/reserveOnly/noDegrade/floor）增速与上线前一致才算"只加出口"。
- 2026-10-02 07:5xZ **#64 那条"旧对象补零"的守卫，在生产上拿到了直接证据**（mark=QPG，tick 83373907）：
  线上 `Memory.rooms.W38S56.spawnRejects` 的键**就是五根**（`survivalBlock,budget,reserveOnly,noDegrade,floor`），
  读 `degradeGateClosed` 得 **null**（undefined）⇒ "加第六键时 `??=` 不会补它"不是假想防御，是**必然发生**的形状。
  下一批上线后这一档若为 NaN/null，先查的就是这行守卫有没有跑（别怀疑计数器有没有被调用）。
  同读顺带把批次4 的②再续一拍：progress 39,919→**41,223**（+1,304/163 拍 = 又是精确 8.0/拍）、
  `controllerProgressChangedAt==Game.time`（第三次同拍跟随）、`budget` **仍 2755**（连续 417 拍零增长）、
  `colonyState=normal / pressure=0`。⇒ 解冻是**持续状态**而不是脉冲。
- 2026-10-02 07:5xZ **#65 由"排除法 + 实测"结案，且撤掉的是我自己的一条时间推断**（不是第二个生产者）：
  实测三件：幼房 **20 个 extension / 0 个 extension 工地 / RCL4 自 `lastRclChangeAt=83349339`（≈24,700 拍）从未变级**，
  事件环（跨度 83372086→83373985，**覆盖那条条目的 createdAt 83372481**）里 **没有 StructureDestroyed**
  ⇒ 容量在整段时间里就是 `300 + 20×50 = 1300`，**不曾是 1650**；而 `selectBody("upgrader", ≤1300)` 在任何版本里都出不了 18 件
  （新二进制在 83373482 重铸出的就是 11 件 —— 实测）。
  ⇒ **结论：那条 18 件不是新二进制铸的，它早于换码生效**。我先前说的"换码后 ~140 拍新铸"**是拿 CI 检出时刻(06:31:14)当换码时刻推的**，
  而闸门要求"连续两次读到同一个 ≠ 基线" ⇒ 真实生效时刻可能早到 06:28~06:31 之间，正好罩住 83372481。这条推断作废。
  ⚠️顺带记一条仪器事实：`Memory.kernel.bootTick=82414952` 是**历史值不是本次 boot**（差 96 万拍）⇒ **不能用它给部署定日**；
    可用的功能签名是 `capacity.tier/since`（本次 83372945 起 `tight`）或"新形状第一次出现的那一拍"。
  **带走的通用规则（比这一案更值钱）**：**body/形状类修复对已在途的请求无效，要等 `expiresAt` 出队才见效**
  （本例解冻在换码后 1,000 拍，正是一个 TTL）⇒ 判效窗口必须 ≥ 一个 `requestTtl`，
  而"部署时刻"必须按**功能签名**定，不按 CI/检出时间定（这是本仓第 N 次栽在同一条上）。
  另记一条 #73 的新现场证据：W38S56 `ColonyStateChange [2,3]@83373845 → [3,2]@83373895`（50 拍的 recovery 抖动，
  升级道刚解冻就发生）⇒ 幼房相位仍在瞬跳，而它同时是 G2 的 struggling 输入。
- 2026-10-02 08:0xZ **#62 的收口规格落盘**（`tmp/observe/pending-62-patch.md`，机器空出来照抄），并把"名字只是装饰"这条彻底钉死：
  随机后缀有**两类**决策路径消费者，不止 hash 一类 ——
  ①`creeps/support/targeting.ts:107/:569` 按 `creep.name` 逐字符求 hash 来错开目标选择；
  ②**`domain/remote/demand.ts:264` `replacementKey("remoteHarvester", homeRoom, targetRoom, replacement)`，
  其中 `replacement` 就是濒死 creep 的名字**（:259 注释自陈"替补 key 绑定濒死 creep 名"）
  ⇒ 队列键与 `submitRequest` 的幂等合并也跟着随机后缀走。
  （`demand.ts:1151 buildHarvesterOccupancy(..., creep.name)` 只按名字**相等**排除自己，不消费随机性 ⇒ 不在改动面内。）
  方案要点：**名字形状一字不改，只把后缀来源从 `Math.random` 换成帝国级单调序号 `Memory.kernel.creepSeq`**，
  并同时保住"帝国内唯一（引擎约束）"与"hash 逐只不同（防抖机制）"两个前提 ——
  ⚠️**连续整数进 `h*31+charCodeAt` 是否退化必须实测**，规格里把它写成一条带数值门槛的用例（先取随机基线再定门槛），
  并把"后缀换回随机 ⇒ 恰好确定性那例红 / 换成常量 ⇒ 唯一性与 distinctness 两例红"两条反向实验配齐。
  结案判据仍是孪生四态里的 **PASS**；若 PASS 拿不到而命名已确定 ⇒ 剩第三源（引擎侧按墙钟的 CPU/bucket 计量），另立案别再改随机源。
- 2026-10-02 08:0xZ **自伤一条并当场修回（记下来，因为它是"结构检查救过我第二次"）**：我给 §1 表格两行加内容时**在单元格里换了行**
  —— markdown 表格单元不允许跨行，两行 3 列的行当场被切成 2 行与 6 行（渲染成垃圾、后续按行读表的判据全部失效）。
  这次不是靠肉眼看出来，是靠一条 `awk` 数每行 `|` 的个数（其余行都是 4，坏行是 2/2/4/3）。
  ⇒ **规矩补一条：改完 §1/§2 这类表格式段落，立刻数一遍列分隔符**（改正文段落则查 `^## /^### ` 的标题序，两次踩坑各对应一种检查）。
  diff 已核对：只有那两行被重接（8 行 → 2 行），没误并到别的行。
- 2026-10-02 08:1xZ **#62 的"序号后缀会不会拆掉去偏置"先做了一发初测**（纯算术，不占测试 CPU；数据与口径在 `tmp/observe/pending-62-patch.md` 附表）：
  实测消费方式是 `Math.abs(nameHash) % sourceCount` 当遍历起点（targeting.ts:105-110，只在占用平局时去偏置），**K 就是本房 source 数（现场 ≤5）**。
  N=32 单次：K=2/3 序号比随机**更均匀**（max 16/21、11/16），K=4 持平，K=5 近似持平（10 vs 9），只有 K=8 出现一个空桶（现场取不到）。
  另有一条解释性发现：**名字本身已含 `spawnIndex` 与 `Game.time` ⇒ hash 离散度本来就不依赖后缀** —— 这才是"换成确定性序号安全"的真理由。
  ⚠️这发数字**不许当门槛**：它每个名字同时变了 index/tick，不是"只差后缀"的最坏情形。加固要求写在规格里
  （只变后缀 × 200 次试验取上界、K 覆盖到 8、base36 进位处单独取样）。
- 2026-10-02 11:0xZ **批次5 判效到手 + #66 预测命中 + 一条新的结构性发现（#68）**（全部带 mark，BG1/OSC1，ring-dump/econ-ring 通道）：
  · **换码字节级确认**：`cf13f86aa356 → 33a244c94f17` == 跑测 dist（闸门③在 push 前当场取的基线，不是我抄的）。
  · **#64 四条判据全过**：幼房 `degradeGateClosed` V1/V2 时还是 `nokey`（**那两窗一次拒绝都没发生 ⇒ 仪器没开火，不是坏**），
    到 11:02Z 已是 **575**；而**同窗 `reserveOnly` 恰好也 +575、`budget` 一根没动**
    ⇒ 这正是我上线前预先声明的正交关系 `degradeGateClosed ⊆ budget∪reserveOnly`，**575≡575 是一次内部一致性正证**
    （幼房被预留挡住的每一条请求，同时也"没被允许降级"）；控制组核心房 `Object.keys(spawnRejects).length=0`
    （它从未发生过一次拒绝 ⇒ 新键自然不出现，符合预期）。旧四档口径未被打断。
  · **#66 的预测命中**：`upgrader.maxCount` 1→2 于 tick **83374266**（我算的是 ≈83374766，差 500 拍 = 一个 eval 周期），
    当场两只 upgrader 在场、升速 +16/拍。⇒ "编制冻结是停摆的后果"这条改判成立，**#66 结案**。
  · **但 1,500 拍后它被降回 1**（`lastAdjusted.upgrader.maxCount=83375766`），而**同窗 `p=0`、storage 一直在涨**
    ⇒ 不是 ↓ 规则开火，而是**闭环验证把它撤销了**。读代码定位到判据本身有问题：`evaluator.ts:654-662`
    对 `upgrader.*` 的"改善"定义是 **`avgStorageEnergy` 必须下降**（烧库存才算成功），
    而**同文件 builder 分支（:665-678）有一条按效果豁免的出口**：`roleCount >= preAdjustValue+1`（人口到位即生效）。
    **upgrader 没有这条出口** ⇒ 在"收入 > 消耗、storage 长期上行"的幼房里，多养一只 upgrader **永远不可能让 storage 转跌**
    ⇒ ↑ 必然被撤销 ⇒ 发展速率被钉在"维持库存持平所需的最小值"，与盈余多少无关。
    （`builder.maxCount` 也在 83376766 被动过 —— 同一条闭环的另一个受害者，而它的编制又被预留挡住，见 #61。）
  · **为什么本轮不改码**：那条撤销的 `TuningRollback` 事件已经掉出事件环（环只有 ~1,000 拍深，事件量大），
    我只有"时间戳 + 代码判据"两支证据，**还差一次当场抓到的 `ROLLBACK <param> (reason)` 配对**。
    ⇒ 挂了 `tuning-rollback-watch.sh`（150 秒一发，盯 `TuningAdjust/TuningRollback/TuningFreeze`），
    下一次 ↑→撤销 循环被拍到就立案 #68 并修判据（**给 upgrader 补 builder 那条"按效果豁免"的出口，不动任何阈值/护栏**）。
    可检验预测：**只要 storage 仍在上行，每一次 upgrader ↑ 都会被撤销**；反之若哪次 ↑ 留住了，说明它当时真把库存烧下去了。
- 2026-10-02 11:0xZ **#68 的第三支证据当场到手（不必等下一次循环）**：轮询器第 1 轮就读到
  `Memory.kernel.tuning.rooms.W38S56.frozenParams["upgrader.maxCount"] = {frozenAt:0, frozenUntil:0, reason:"", rollbackCount: 1}`
  ⇒ **这一项被闭环回滚过 1 次**（`hauler.maxCount` 同样 rollbackCount=1；两者都未冻结 ⇒ 冻结门槛 ≥2 次）。
  加上"代码判据只认库存下跌"与"↑@83374266 / 回滚@83375766 而全程 `p=0`、se 一路上行"，三支齐 ⇒ **#68 成立**。
  **代价量化**：progress 75,279/405,000，1 只 ≈+8/拍 ⇒ 约 **43 小时**解 G0；被允许 2 只 ⇒ 约 21.5 小时。
  ⇒ **这一条把幼房到 RCL5 的时间翻倍，而且盈余越多越会被撤销**（不是"暂时没资源"）。
  修法（下一步）：给 `upgrader.*` 补 builder `:665-669` 那条同构的**效果豁免**（编制到位且升速上升 = 改善）；
  不动阈值、不动容差、不动 ↓ 方向的 D.4 护栏。政策邻近 ⇒ 改前把数摆清。
  ⚠️自记一条探针形状错：轮询脚本里 WORK 加总用 `p=="work"`，线上 `creep.body` 是**对象数组**（要 `p.type`）⇒ 该列恒 0，
  另两列（只数、progress）可用；**不去改正在运行的脚本**（编辑运行中的 bash 脚本比重复读数更危险）。
- 2026-10-02 11:1xZ **#68 修复落地（本地，待随批推）**：`evaluator.ts:654` 给 `upgrader.*` 的 ↑ 方向补上 builder 那条同构的
  **效果豁免**（`roleCount >= preAdjustValue + 1` ⇒ 人口到位即算改善）。只加成功出口，D.3 人口合同 / D.4 下调护栏 / 全部阈值与容差未动。
  三条用例（现场形状 (a) + 编制未到位仍走 blocked 的对照 (b) + hauler ↑ 未改善仍回滚的无连带 (c)）；
  **反向实验**：撤掉豁免 ⇒ 恰好 (a) 红、(b)(c) 绿。unit 374 文件 5139 例 / integration 30 文件 239 例 / tsc 全绿。
  ⚠️取证时也顺手抓出自己的两个口径错：①先前读 `pendingValidations||pending` 得到 `{}` 是**键名猜错**
    （真键 `pendingValidation`）—— 那条"验证环没在跑"的读数是废的，重读后看到 `builder.maxCount` 正挂着一条
    `adjustDirection:"down", preAdjustValue:2, adjustTick:83376766` 的待验证记录 ⇒ **builder 是被 ↓ 的**，与 upgrader 的回滚是两条路；
  ②`... | tail -3; echo $?` 取的是 **tail 的退出码不是 tsc 的**（本仓老陷阱），改写成 `>log; TSC=$?` 才看见两笔真实 TS 错。
  遗留（下一轮可选的更优解）：`TuningSignals` 里**没有 controller 升速信号**，所以这次只能沿用 builder 的"人口到位"证据标准；
  若要把判据升级到"升速确实上升"，得先给 economy ring 加一个 progress-rate 字段（新仪器 ⇒ 新口径 ⇒ 另案）。
- 2026-10-02 11:1xZ **#62 的离散度问题定稿（纯算术，不占 e2e 的 CPU），并撤回我自己上一条数字结论**：
  按规格里三条加固要求重测（200 轮 × N=32、**只差后缀**、其余字段两边完全一致、K 覆盖 2/3/4/5/6/8、跨 base36 进位单独一组）：
  **连续序号在每个 K 上都等于或优于随机**（max 桶 18/12/9/7/8/5 对随机的 p95 21/16/14/12/11/10），
  且**从不留空桶**（随机在 K=6/8 留 0.03/0.12 个）。⇒ 我 08:1xZ 写的"只有 K=8 差一档"是**伪影**（那次把 `spawnIndex`/`tick` 一起变了），作废。
  机理：连续序号 ⇒ hash 近似等差 ⇒ `mod K` 天然轮转，比随机更均匀。
  ⇒ 数值门槛就此定死（实现时直接引用，不必再测）：序号 max ≤ 本表随机 p95 且空桶=0，**200 轮取 p95，单次快照不作数**。
  剩下的唯一未知数收窄为 `Memory.kernel.creepSeq` 的**重置语义**（Memory 被清 ⇒ 序号从头开始 ⇒ 与活 creep 撞名 ⇒ 兜底"撞名再取一号"是必需项而非装饰）。
- 2026-10-02 11:4xZ **幼房发展通道的纵向往证（E5 轮询器 K17–K20，20 分钟一发，非我主动探针）**：
  `stall` 列从 15 → **0/0/0**（连续一小时以上"进度在动"），`budget` 恒 2755、`degradeGateClosed` 恒 575、
  **`reserveOnly` 也从 11:02 起停止增长（恒 3854 ⇒ 约 40 分钟没有一条请求被预留挡住）**；
  progress 差分 2,312/317 → 2,512/314 → **4,040/312 ≈ +12.9/拍**（先前是 8.0）；
  storage 63,990 → 65,908 → 68,848 → **65,908（首次转跌 ≈ −9.4/拍）**
  ⇒ 消费侧确实吃进去了盈余，这**正是 #68 想要的效果的"应有形状"**（而 #68 还没上线 ⇒ 说明这是编制自然补齐的结果，
  不是我的改动造成的假象 —— 判效时要记住这条基线，别把它记到批次6 头上）。
  另记：**`no-rclStale` 全程成立** ⇒ E5 的 10,000 拍阈值再也不会自然触发（解冻后锚点持续跟随）
  ⇒ **#57 的线上判据按构造不会再上门**，它的证据等级就停在"检测半段有正证 + 响应链由集成测试覆盖"，别再等它。
  RCL5 ETA 更新：(405,000 − 81,183) / 12.9 ≈ 25,000 拍 ≈ **26 小时**（比 +8/拍的 43 小时好，但仍由编制上限支配）。
- 2026-10-02 13:0xZ **#62 修复已上线（批次7 于 13:01:12 推出，`推送成功` 那行带真退出码），孪生三跑逐字一致**：
  `17-multi-room-soak` 在 seed 7/7/11 三遍全部给出
  `warm tick=2001 byHome={"W0N1":4,"W0N2":4} queues=83` / `inject tick=5001 byHome={"W0N1":3,"W0N2":3} recovered=true` / 同 schema 行
  —— **正是修复前分叉那一列**（当时 run1 W0N1=5、run2 W0N1=4；5001 是 2/2 vs 4/3）。⇒ 命名随机源确实是分叉源，已消除。
  **但我的结案判据有一条是错的，得当场更正**：四态里的 PASS 要求"异 seed 必须分叉"，而这个场景里
  **没有任何东西消费 seed**（调优探索有 `EXPLORATION_STABLE_THRESHOLD=3` 个周期 + `COOLDOWN=5000` 拍，5,000 拍的短 soak 里根本不会开火）
  ⇒ 三跑全同是**正确结果**，却被我的判据读成 INSENSITIVE。可复现性的要求从来是"同 seed 同世界 且 无未接线的随机源"，
  **不是**"任意 seed 都要产生不同世界"。⇒ 判据改写：同 seed 一致 + （要么异 seed 分叉、要么证明该场景不消费随机源）。
  ⇒ 已把孪生换到**会消费随机源的场景** `16-soak-sv43`（9,000 拍，探索有窗口开火）重跑 7/7/11：
  若同 seed 一致而异 seed 分叉 ⇒ #62 才按新判据结案。**四态那条 INSENSITIVE 不删** —— 它这次正确地拦住了我一次弱证据结案。
- 2026-10-02 13:0xZ **#68 的线上读回：↑ 这次留住了（`maxCount` 跨验证期限仍为 2、`rollbackCount` 未增），但归因不干净，我不给它写 PASS**：
  R7 tick 83378782（验证期限 ≈83378766 之后）：`{"maxCount":2}`、`rollbackCount` 列变 **0**（该 frozenParams 条目被重建 ⇒ 旧计数不可再读）、
  两只在场、progress 97,767、storage **68,314→65,114→64,714 正在下跌**。
  ⚠️问题在最后一项：**storage 现在真的在跌**，于是**旧判据（库存必须下跌）也同时被满足了**
  ⇒ "这次留住"可能不是因为我的效果豁免，而是因为盈余终于被吃掉。⇒ 本轮不判 #68 成败；
  要判就得抓一个 **↑ 发生在 storage 上行期间** 的实例（同 seed 的孪生跑之外，这条只能等线上下一个周期）。
  带走一条口径：**证伪一个"判据按构造不可满足"的命题，需要一个该判据仍不满足的现场实例**——
  条件变好之后"改动没白改"的读数是含糊的，既支持我的修复也支持"本来就不会回滚"。
- 2026-10-02 13:2xZ **#62 结案（判据修正后）**：`16-soak-sv43`（20,000 拍）同 seed 两遍在**归一后逐字一致**，
  而且归一只去掉了两类**非玩法**字段：`cpuSys/cpu10/cpuMax` 的实测浮点（isolate 按墙钟计量 CPU）与
  `violIds` 里的引擎对象 id。其余全部相同 —— `creeps/rcl/tier/cs/queueEnd/Med/Peak/net/tuned`
  与整张经济账（`harvested 167514 / spawned 52350 / upgraded 65124 / built 48833 …`）**逐字对齐**。
  异 seed(11) 也一致 ⇒ **不是渠道坏了，而是这个场景里没有 seed 消费者**：
  `evaluateTuning` 只在**一个周期没有产出任何调整时**才走 `exploreParameter`，而该 soak 每 5,000 拍都在调参
  （`tuned=4766/9766/14766/19766`）⇒ 探索分支根本不跑 ⇒ `tuningRandom` 不被调用。
  ⇒ **本案的缺陷定义是"同二进制 + 同 seed 跑出不同世界"，它已消除**；"异 seed 必须分叉"是我加错的附加要求
  （它检验的是"场景是否消费随机源"，与可复现性是两件事）。孪生器已改成**先归一再比**，
  INSENSITIVE 态保留但不再当作不通过 —— 它今天已经正确地拦住我一次弱证据结案，这条纪律不删。
  **带走的通用口径**：断言"可复现"之前先分类读数字段 —— 玩法状态 / 测量产物 / 引擎分配 id 三类，
  只有第一类能进 diff；否则工具永远判 FAIL，人会误以为改动没生效。
- 2026-10-02 13:2xZ **自纠两处（用线上读数当场证伪我自己的说法）**：
  · 我上一条写"#62 已上线"是**错的**：线上 sha 仍是 `006fafa75dfa`（#68 那版），`0191c735e6a9` 推送 28 分钟未生效；
    直接证据 —— 幼房两只 upgrader 的名字后缀是 `og58`/`5do8`（4 字符随机），不是 `1`/`2`（base36 序号）。
    正确表述：**已提交、已推送、CI 侧未换码**。孪生 PASS **不依赖线上**（跑的是本地含 #62 的 dist，钩子重建后 sha 未变）。
  · #68 的存活**仍不能归因**：`maxCount=2` 跨过 1,500 拍验证窗已活 1,907 拍、`rollbackCount` 未增，
    但窗内 `se` 70,958 → 68,314 → 65,114 **确实在跌** ⇒ 旧判据同时被满足 ⇒ 记"未判定"。
    **判别搜索条件写死**：找一个"`lastAdjusted.upgrader.maxCount` 更新那拍起 +1,500 拍内 `avgStorageEnergy` 不上跌"的实例；
    那种实例若存活 = 豁免的正证，若回滚 = 我的机制解释被否证。观察点：`verify-batch6` 每 600 拍一行（含 lastAdjusted 与 storage 序列）。
  · 顺带：`degradeGateClosed` 到 **1,079**（与 `reserveOnly` 同步、`budget` 仍 2756）⇒ #64 仪器持续产出；
    progress 102,471（+8.0/拍），RCL5 剩余 ≈37,800 拍 ≈40 小时（编制稳定在 2 只则减半）。
- 2026-10-02 13:3xZ **CI 抓到我一笔真缺陷（不是 CI 抖动），并顺手把 #62 的部署解锁**：`4eace78`(#62) 的 CI 跑**红在**
  `recovery-action-pipeline.test.ts` 的 #59 用例上（`expected 'global' to be 'W1N1'`），本地"整目录跑"当时是绿的。
  追下去是**三层**，都不该放过：
  ① 断言写成位置敏感（`escalations[0].room`）⇒ 清单本来就不承诺顺序，同一次跑里可有房级与全局两类条目；已改成按幂等键取
  （`room==="W1N1"` 的条目必须存在 + 每个 `(room,domain,actionType)` 键恰好一条 —— 后者才是"同一案例只更新一条"的原意，且与顺序无关）。
  ② 改完仍红：dump 出清单里**只剩** `{room:"global",domain:"mineral",actionType:"terminal_trade"}` —— 房级那条根本没产生。
  ③ 真因在**夹具**：停摆只在 `t===1` 注入一次 ⇒ 它是**可自愈**的。命名变确定后 target hash 变了 ⇒ 该房自己恢复升级 ⇒
  `development_resume` 成功而非烧穿 ⇒ 被测的留痕路径不触发。**用例前提会自己消失**，却表现为"CI 随机红"。
  ⇒ 修法是把前提**保持成立**（每拍把 `controllerProgressChangedAt` 按回过去），不是把断言改成"看运气有没有条目"。
  验证：单跑该文件 3 遍 4/4 全绿、整目录 30 文件 239 例全绿、typecheck 0。
  **带走的口径**：a) 凡"注入一个条件然后等它产生后果"的用例，注入必须**每拍维持**，否则后果可能被系统自己抹掉；
  b) 断言一律按幂等键取，不按列表位置取；c) 本地"整目录绿"不等于对 —— **单跑一遍**才算排除顺序依赖。
- 2026-10-02 13:5xZ **#62 线上生效，功能签名到手**（顺带撤回我自己刚升起的一个假警报）：
  CI 在 13:41 那笔（测试修复）后转绿，线上 sha 切到 `0191c735e6a9`；换码后**只孵出两只 creep，两只都是序号名**：
  `distributor-W37S58-1-83379497-1`、`hauler-W38S56-2-83379502-2`，且 `Memory.kernel.creepSeq === 2` 严格对齐（一 spawn 一步）。
  其余 30 只仍是 4 字符随机后缀 ⇒ 它们是**换码前**孵出的（寿命 1500 拍，约一小时内的自然排空，不是"还有第二个命名点"）。
  ⚠️我 13:5xZ 一度据此怀疑 `remote/demand.ts` 有第二处命名点 —— 查了 `toString(36)` 的全部出现处 + 按"序号名 vs 随机名"分桶计数后**排除**：
  那些 remote 名字的 spawn tick 全在切换之前。**"发现可疑样本先查时间戳，别急着立新案"**。
  ⇒ #62 至此闭环：代码在跑、计数在走、无撞名、命名不再消耗 `Math.random`；长 soak 的可复现性由本地孪生（同 seed 玩法状态逐字一致）背书。
  下一批 e2e 若再出现"同 seed 两遍玩法状态不同"，那才是第三个源（首要嫌疑仍是引擎侧按墙钟的 CPU 计量）。
- 2026-10-02 14:1xZ **#62 拿到教科书级 PASS；#68 出现判别实例并已把判据写在结果之前**：
  · **孪生（`22-war-ledger`，7/7/11，归一后）**：同 seed 两遍逐字一致；**异 seed 真分叉**
    （`firstWar=5003 vs 5002`、`minWarStorage=225330 vs 179427`、band/entry 行也不同）
    ⇒ 这条同时补上了我在 `17-multi-room-soak` 上缺的那半边：**场景里确有 seed 消费者时，序列确实随 seed 变**，
      而同一 seed 的世界完全可复现。#62 到此无保留结案（此前的 INSENSITIVE 是场景不消费随机，不是渠道坏）。
  · **#68 的判别实例自己上门**：tick **83379766** 调优把 `upgrader.maxCount` **2→3**，而那一刻 storage 在**上行**
    （68,251 → 68,123 → 68,405 → 70,005 → 70,705）⇒ 旧判据"库存必须转跌"在本窗按构造难以成立。
    验证点 = adjustTick + 1,500 ≈ **tick 83381266（约 15:4xZ）**。
    **预先登记三态**（`tmp/tools/official/upgrader-raise-verify.sh` 头部，已挂 20 轮 × 300s）：
      PASS=到点后 `maxCount` 仍 3 且 storage 未跌 ⇒ 豁免生效，#68 结案；
      REFUTED=到点后回到 2（或 lastAdjusted 变小）而 storage 未跌 ⇒ 我的机制解释被否证，回去找别的路径，**不许改口径救它**；
      UNKNOWN=中途 storage 真跌超容差 ⇒ 本例不区分两种解释，等下一个实例，不判成败。
  · 顺带的健康读数：`degradeGateClosed=1,383` 持续涨、`tier` 已从部署税回到 `tight`、
    幼房 2 只 upgrader、升速 ≈+15/拍、progress 110,907 ⇒ **RCL5 ETA 约 20 小时**（清晨估的 43 小时已被这两批修复压缩掉一半以上）。
- 2026-10-02 14:2xZ **一条被自己立起来又当场撤掉的 CPU 疑点（差分做对了才撤得掉）**：
  14:15:33 读 `Memory.kernel.skipReasons` 见到 `system/construction-manager/budget`、`tactical-runtime-pipeline/budget`、
  `layout-planner/budget`、`room-observer/budget` **四个都恰好 65** ⇒ 我按"四个系统每次到期都被 CPU 闸拒"读成了
  一个真问题（那会直接压住施工与布局 = 发展轴）。**134 拍后再读，四个键全部消失（null）**
  ⇒ `skipReasons` 是**会被清空/轮换的窗口计数**，不是自 boot 的累计量：那 65 属于 boot 窗（换码后不采信输入的那段），
  当前窗零次 ⇒ **无系统被 CPU 闸持续拒绝**，疑点撤销。
  ⚠️这条把已有口径收紧一层：`skipReasons` 这类"看起来像累计"的 map **连差分都不够**——键可能在两次采样之间被整体清掉，
    差分会读出"负增长"。用之前必须先确认它的**生命周期**（谁清、多久清）。判"系统在被饿"要用**同一窗内**的
    `system/<name>/budget` 与 `capacity.tier/since` 同时看，而不是跨窗比数。
  另附当时的真读数（都是健康的）：`tier=tight@83379815`（部署税 ~21 分钟自解）、`bucket=10000`、`tickLimit=500`、
  幼房 2 只 upgrader、progress 差分 **+16.0/拍**（编制上限已到 3，第三只待孵）、storage 70k 量级平稳。
  #68 的判定点 `tick≈83381266`（约 15:4xZ）由 `upgrader-raise-verify.sh` 记录中，三态判据已预先写死。
- 2026-10-02 14:3xZ **一次"看着像 bug"的追查，最后收成两件小事**（mark LG2/LG3）：
  `layoutGaps` 里有 `W38S58`（我们不拥有、不远矿、只在视野），幼房 W38S56 反而没条目。
  · 我先提的假设是**键写错**（W38S56→W38S58 数字转置）—— 被自己的下一条读数**否证**：幼房 extension=20（RCL4 满）、
    tower/storage 齐、**0 个在建 site** ⇒ 它本来就无缺口，"没条目"是正确状态；若真是错键，缺口内容会跑到 W38S58 名下且幼房该有条目。
  · 真问题小得多但同样该修：`recordLayoutGaps` 只在"同一房再次产出空缺口"时回收键 ⇒ **永不规划的房把键留成历史残值**，
    且值里没有 `tick`，消费者无法分辨新旧。**另立 #69**（修法：落盘带新鲜度 + 写时删掉非自有房名；不动 shouldPlan/缺口审计）。
  · 核心房那条 `linkHub:2` 是**真缺口**，不要顺手"清理"掉它。
  顺带：`expectations.violations=[]`、两房 `colonyState=normal`、stale site 计数 0、`lostRooms={}`、
  幼房 RCL4 满配 extension + storage + tower ⇒ 发展轴目前没有新伤，主要瓶颈仍是 RCL5（≈20 小时）与 CPU 档。

- 2026-10-02 14:5xZ **#74 立案并本地修复：`linkHub:2` 不是真缺口，而是"把剩余容量当缺结构"的不可满足期望——它把核心房的布局规划器永久钉在 500 拍慢速重试**（全部带 mark，LH1/LH2/LH3/LH4）：
  · **先撤上一条我写的话**：14:0xZ 那条"核心房 `linkHub:2` 是真缺口，不要顺手清理"——**撤的是"真缺口"这一支**，
    "不要去 Memory 里手工删键"这条操作纪律保留（事实修正后依然不该手删）。
  · **现场形状（LH1@83380289）**：W37S58 RCL8、`linkCnt=6`（CONTROLLER_STRUCTURES 的 link 名额在 RCL8 就是 6）
    ⇒ **一个都不缺**；`buildQueue=[]`、`sites=0`、`state=building`、`revision=20`、`nptAhead=422`、`nextGapPlanTick` 存在。
  · **机制（LH2@83380298，逐只实测到锚点的 Chebyshev 距）**：6 只 link 里 2 只贴 source（`minS=1`、能量 290/270 在流）、
    1 只贴 storage（`dSt=1`）、**3 只全落在 controller range≤2 内**（`dC=2/2/2`，能量 140/0/0）。
    `classifyLinkRole` 是"最近锚获胜"，所以这 3 只都叫 controller ⇒ `have={source:2,controller:3,storage:1,hub:0}`，
    而 `expectedLinkRoleCounts(8,2)` 旧表给 `hub=2` ⇒ `auditLinkRoleGaps` 把三个有创建器的角色都算成 0 缺口
    （`Math.max(0,…)` 把超配截掉），剩下的期望余额只能从 hub 这个**没有任何 actuator 的角色**冒出来。
  · **hub 为什么不可满足（读码，不是推测）**：放置侧只有 `createSourceLinkTasks / createControllerLinkTask /
    createStorageLinkTask` 三个创建器（`planner.ts:505-563`）；传输侧 `planLinkTransfers` 只路由 source→controller/storage
    （`links.ts:100-102`，controller/storage 各 `find` 单只）；role "hub" 只出现在 `classifyLinkRole` 的兜底分支。
    更要紧的是 `dumpToNearbyLink` 只按"距离+有空位"选目标 ⇒ 真建一只 hub link 会成**只进不出的能量陷阱**。
    ⇒ 所以 `hub:2` 不是"待实现的能力"，是把 6 个名额里没被三个角色占走的**剩余容量**误登记成缺口。
  · **代价的符号我一开始搞反了，实测定标**：我先假设"虚缺口⇒反复重规划⇒烧 CPU"，读了 `CONFIG.layout.planInterval=50`
    才发现 `GAP_RETRY_INTERVAL=500` 比常态**慢 10 倍** ⇒ 这条 pin 是**降速**不是烧 CPU。真正的代价是延迟：
    **核心房任何真实新缺口（塔被拆、controller link 被打掉）都要等 ~500 拍才被排产**，而设计意图是 ~50 拍。
    控制组在同一次二进制里现成（LH3@83380337）：无缺口的幼房 W38S56 `nptAhead=79`、`nextGapPlanTick=null`；
    有虚缺口的核心房 `nptAhead=422`。两个读数同拍取得 ⇒ 不是口径差。
  · **节奏从同一拍的两个字段反推自证**：`ngpt = T+500 = 83380638`、`npt = T+500+roomPhase = 83380759`
    ⇒ 上一次规划收尾在 **T=83380138**（phase=121），而 `revision=20` 到 83380337 仍未动 ⇒ 核心房实测就是
    **~1 次/500 拍**的钉死节奏；解钉后设计节奏 ~1 次/50–100 拍，所以部署后除了三态判据还要看 `revision` 增速。
  · **严重度按第二发读数写，不夸**：`upgrade.ts:69` 取能带 `energy>0` 门禁 ⇒ 那 2 只超配 controller 角色 link **不会饿到 upgrader**，
    只是 10,000 能量已沉没的空位 ⇒ 本条**不是物流事故**，是审计层的类目错 + 一次降速。**不做拆除/重建**（毁资产属人工排产）。
  · **修法（`gaps.ts`，期望表一行）**：`expectedLinkRoleCounts` 的 `hub` 恒 0，注释写清"无创建器+无消费者⇒剩余容量≠缺口"
    与这条虚期望曾经造成的降速。三个有创建器的角色的缺口口径**一行未动**，`shouldPlan`/阈值/`GAP_RETRY_INTERVAL` 都没碰。
  · **测试**：拆掉两条给旧期望背书的夹具（`hub=2`），改成"RCL8 双/单 source 期望 hub=0" + "任意 RCL 都不期望 hub"，
    把"远离锚点仍分类为 hub"的行为保留但断言**不产生缺口**；新增 **W37S58 指纹回归**（6 只 link、3 只 controller 角色 ⇒
    `auditLinkRoleGaps` 全 0 且 merge 后 `gaps={}`，即 `shouldPlan` 实际消费的那个对象）。
    **反向实验**：把期望临时改回 `rcl>=8?2:0` ⇒ 恰好 5 例转红（全是我新写的），24 例全绿——**其中含 W3N7 死资产那组**
    ⇒ 证明角色感知审计仍能抓真缺口，我没有为了让计数器好看而把它弄瞎。
    全量：unit 375 文件/5146 例、integration 30 文件/239 例、typecheck 干净。
  · **判效三态（在部署之前写死）**：部署后取 `Game.time=T0`，看核心房下一次规划收尾（`revision` +1）那一刻——
    ①**PASS**：`layoutGaps.W37S58` 条目**消失**（`recordLayoutGaps` 对空缺口删键）且 `nextGapPlanTick` 被删
      且 `nptAhead ≤ ~100`（回到 50+相位带）；
    ②**REFUTED**：键消失但 `nptAhead` 仍 ~400 ⇒ 我的"是 gap-force 在钉它"被否证，回去读 `shouldPlan` 的其它分支，**不改口径救它**；
    ③**UNKNOWN**：`layoutGaps` 出现别的键（例如 `deadAssetLink` 或 #69 那类历史残值）⇒ 本例不区分，另案。
    控制组：幼房 `nptAhead` 应继续 ≤~100、`ngpt` 仍为空 ⇒ 若它也变了，说明我动的不是核心房专属路径。
  · **一笔要盯着的副作用（不粉饰）**：解钉后核心房规划频率 ×10 ⇒ 布局规划那部分的每拍成本会**上升**（幅度未测——
    `Memory.kernel.cpuRate` 本次是空字典，仪器在 heap、被上一次换码清掉了）。G6 已经恒红，这笔不会翻任何闸，
    但部署后要看一次 `tier`/`since` 与每房 CPU 读数，别把它写成"免费"。

- 2026-10-02 15:0xZ **#74 的节奏拿到第二发读数，同时否证了我自己刚写的判据触发器；#69 的来源也取证到手**（mark LH6/LH7）：
  · **第二发读数（自洽）**：83380641 那拍 `ngpt=83381141`、`npt=83381262` ⇒ 反推收尾拍 `T₂ = ngpt−500 = 83380641`，
    与上一次 `T₁=83380138` 相差 **503 拍**，且两次的 `roomPhase = npt−ngpt−… = 121` **完全一致**
    ⇒ "核心房被钉在 ~500 拍节奏"从推算升级为两拍实测，`gap-force` 于 83380638 到点即触发也当场看到。
  · **我自己那条判据被当场否证**：我在 `gap-unpin-verify.sh` 头写"只在核心房 `revision` 比首行大的行上判"——
    这次收尾 `revision` **仍是 20**（它只在布局真变化时递增，不随规划周期递增）⇒ 触发器**按构造永不发火**，
    判效器会一直"没到点"而我可能误读成"改动没生效"。已改成可观测的 **`core.ngpt` 首次转 null 那一行**，
    并把 `T_收尾 = ngpt − 500` 这条反推写进脚本（属我记过的第 5 类/"判据对自己要测的东西失明"同族，第 16 次）。
  · **#69 取证（LH7）**：`W38S58` 在 Memory 共 5 处 —— `layoutGaps` / `layoutMetrics` / `stats.cpuPerTickByRoom` 三处残留 +
    `expansionPlans.3`（`pid="W38S58@82908984"`、`ex="Plan …: resource…"`＝**一次流产扩张**）+ `expansionCandidates.1.rn`。
    `Memory.rooms` 只剩 W37S58/W38S56 ⇒ 扩张中止删了房 Memory 却没删 kernel 侧三张表；
    **年龄可算**：83380652−82908984 ≈ **471,668 拍（≈5.4 天）**——被任何控制台采样者读成"当前缺口"。
  · 顺带把 `gaps.ts` 注释里我写重的一句话改掉（已提交）：hub link 的能量陷阱是**潜在**而非现行（harvester 站桩在
    source，hub 按定义离三个锚都 >2，只有离岗移动时 `dumpToNearbyLink` 才可能撞上），并补全三只 link 各自的排空通道。

- 2026-10-02 15:0xZ **上一条里"#69 三处残留"要说清哪几处才算**（mark LH8@83380672）：
  `stats.cpuPerTickByRoom` 现键集 = `{W37S58:1.031, W38S56:0.699, W36S58, W37S57, W38S57, W38S58:0.041}`
  ⇒ W38S58 那格是**活的**（非零、且与两个远矿 + 另一候选房 W38S57 并列）⇒ 它不是扩张中止的残留，
  而是"按现场房归因 CPU"的口径本来就把**候选房/远矿房**算进来。量级 0.04/拍×2 房＝可忽略，
  但记下来有两用：①G6 归因时这张表的分母含非自有房，别把它们当"帝国房成本"；②#69 的真正残留只有
  **`layoutGaps.W38S58` 与 `layoutMetrics.W38S58` 两格**（planRoom 需 `Memory.rooms.<r>.layout` 才写得进去，
  而该房 Memory 早被中止流程删掉 ⇒ 这两格是 471k 拍前的冻值，20 拍内两次读数一字不差亦相符）。

- 2026-10-02 15:2xZ **#76 立案并本地修复：交易运费只有一个合计格 ⇒ "卖能量是不是净亏"在账上无法回答**（观察通道，阈值一个没动）（mark P48A/LH11）：
  · **触发读数是误读出来的**：核心房本窗 `economy.bk = {harvested:1000, sold:1000, imported:490, tradeFee:841}` ⇒ 我脱口而出
    "运费占货量 84%"。**分母不对**：`executeDeal` 有 **11 个调用点**（卖能量 1 / 买能量 1 / 卖 home mineral / 买缺口料 ×2 /
    卖 compound / 卖 battery / 卖 commodity / 买 power / 买 ghodium）+ `terminal-selfaid` 3 处，全部只进 `tradeFee` 一格，
    而 `sold` 只有卖能量那一格 ⇒ `tradeFee/sold` 是**混通道的比值**，当"卖能量的烧穿率"读就是错的。
  · **但运费本身的量级是真的，而且是当场测的**（LH11@83380783，本服 `Game.market.calcTransactionCost(1000, …)`）：
    **同房 0 / 邻房 W36S58 = 33 / 远房 W20N5 = 856 / 极远 W1N1 = 865** ⇒ 运费占货量 **0%~87% 随对手房变化**。
    而闸门 `CONFIG.energy.minEnergySellPrice = 0.02`（买回上限 `maxEnergyBuyPrice = 0.05`，`maxDealAmount = 1000`）
    **不含任何距离/运费项**。按"卖完再把烧掉的能量买回来"这个口径算：卖 1000 收 `1000·P` 信用、烧 `f` 能量，
    买回 f 需 `0.05·f` 信用 ⇒ 净正要求 `P > 0.00005·f`；`f=865` 时门槛是 **0.043**，而现闸门放到 **0.02**
    ⇒ **对远手的卖出可以在这个闸门口径下净亏近一倍**。**这不等于"该改阈值"**：如果那 865 能量本来只会堆在
    `energySellFloor=100000` 之上无处可去，机会成本就近似 0，0.02 仍是白捡——**两种估价的差正是"该由人定"的部分**，
    我只把可判的读数做出来，不动 `minEnergySellPrice`。
  · **修法（纯观测）**：`RoomEnergyCounters`/`EnergyLedger` 新增 `tradeFeeEnergySell`、`tradeFeeEnergyBuy` 两格，
    `executeDeal` 多一个可选 `feeChannel` 形参，卖能量/买能量两个调用点标上；**`tradeFee` 合计格的写入位置与语义一字未动**
    （"每笔成功 deal 都计费"仍是结构不变量），两新键**不进** `CONSUMPTION_FIELDS` ⇒ `ledgerIncome`/`ledgerConsumption`
    口径不变（这条我专门写了用例挡"同一笔运费被记两次"）。恒等式：`tradeFee ≥ sell桶 + buy桶`，只跑能量通道时取等。
  · **测试**：新增 `tests/unit/trade/trade-fee-channel.test.ts` 6 例。**反向实验**：把两行分桶写入钉掉 ⇒
    **恰好 3 例转红**（sell 桶 / buy 桶 / 不变式），3 例控制组全绿（未标通道仍进合计、deal 失败两格都不进、
    新键不改收支合计）⇒ 新用例确实在测被改的那条分支。全量：unit 376 文件/**5152** 例（+1 文件 +6 例）、
    integration 30/**239**、typecheck 干净。
  · **同一窗读数的另一条副产品**：`imported=490` 而两房 `exported` 皆无 ⇒ 在场 9 只跨房 creep 全是远矿角色
    （home=W37S58、现场 W36S58/W37S57），**没有一个"自有房→自有房"的交付** ⇒ **#48 的触发事件本窗仍未发生**，
    幼房 `bk` 是 `{harvested:1000, upgraded:800, towerSpent:500}`（自给中）⇒ #48 继续保持"挂在一次真实供给事件上"，
    不写 PASS 也不写 FAIL。
  · **写者审计把 #74 的因果从"相关"抬成"唯一通路"**：`layout.nextPlanTick` 全仓只有一个运行期写者
    （`layout-planner.ts:696`，`ctx.tick + interval + roomPhase`，`interval = gapsOpen ? 500 : 50`），
    `nextGapPlanTick` 也只有 `:698` 一处且整体包在 `if (gapsOpen)` 里 ⇒ **`gapsOpen` 是节奏的唯一决定量**。
    副作用：REFUTED 态在代码上几乎不可达，于是判效器新增**第四态"未上线"**——
    "键还在 + 节奏没变"是新码没生效（要先 `check-code` 认 sha），**不能**当成我的机制被否证；
    这条区分不写下来，我下一轮就会把一次部署失败读成一次科学否证。

- 2026-10-02 15:3xZ **扩张轴扫出 #77（只读一次，mark EX1@83381038；立案未修，判据先写死）**：
  · `expansionPlans` **4 条全 `WAITING_EXECUTION`**，`ua=83380684` 说明每轮仍在被重评，而最老一条
    `ca=82544684` ⇒ **38 天前的 plan 还在队列里**；两条的 `rn` 竟是我们**已在远矿的 W36S58/W37S57**（占为自有＝把远矿升格，
    方向说得通，但要确认这是有意的第二级扩张，不是把远矿房误当候选）。
  · `expansionCandidates` 10 条里 ①`W38S56` 标 `QUALIFIED` 而**这房我们已经拥有**（`ls=83308989`＝受领前的旧记录），
    ②`W37S54`/`W38S54` 的 `sr` 仍是**已放弃的 W37S55** ⇒ 与 #13 老现象同类。
  · 代码面 `expansion-planner.ts:105-124` 已把 `ownedRoomNames` 与 `releasedRooms` 传给 `discoverCandidates`
    ⇒ 二选一：**排除表没登记**（真缺陷：释放过的房能重新进池）或**存量记录不被重过滤**（残值，与 #69 同族）。
    裁决读数＝`Memory.kernel.releasedRooms` 是否存在且含 W37S55 —— 挂到下一次探针一起取，不另开一路。
  · 另记一条要人定的语义：**`WAITING_EXECUTION` 是否该有有效期**（38 天的 plan 一旦资源放开就去 claim 一个可能已无视野的房）。
  · 并行会话已把 **#48 记为 PASS**（03:4xZ 累计 `exported=3600 == imported=3600`），与我 15:1xZ 的"本窗无自有→自有交付"
    不矛盾（事件稀发、`bk` 是窗口值）⇒ 我这边 §3.6 那条"等外部事件"改为引用他们的累计额证据。

- 2026-10-02 15:3xZ **#68 的判据在我自己的脚本里被当场作废重写（结果还没出来就改）+ 我违反了一条自己立过的操作纪律**：
  · **判据错在哪**：原三条写的是"到点 `maxCount` 仍 3 且 **storage 未跌** ⇒ 豁免生效"。但
    `isImprovedMultiSignal` 的开头是 `|Δ| < tol ⇒ return true`（**无显著变化就不回滚**）⇒ "未跌"这一支
    **旧代码本来也会放过**，我的那一支是否参与**不可判**——这正是并行会话 R95 认过的同一个错，我抄判据时把它继承了。
  · **还漏了一个必要量**：`getRoleCount` → `countRolesByHome(Game.creeps)` 是**即时计数**，我的豁免条件是
    `alive ≥ preAdjust+1 = 3`，而 URU1..16 每行 `alive` 恒为 **2** ⇒ 豁免前提可能压根没满足。
    重写后只有四种判决，且**只有一种能归因于我**：PASS=跌幅>tol(≈3,535) 且 alive≥3 且仍为 3；
    INSENSITIVE=|Δ|≤tol（旧代码的 noChange 放过的）；不可归因=跌幅>tol 但 alive=2（真问题挪到 #47 补员道）；
    REFUTED=跌幅>tol 且 alive≥3 却被回滚。现场速率 −10/拍、距 tol 差 ~195、距 verify 拍 ~216 ⇒ **大概率是可判实例**。
  · **我犯的操作性错误**：为了改判据去**编辑了正在运行的 `upgrader-raise-verify.sh`** —— 这正是我记过的
    "绝不编辑运行中的 bash"。这次侥幸没炸（PID 57877 还活着，推测 bash 已把小文件整体缓冲），
    但**不能把侥幸当方法**：正确做法是新写一个文件、让旧进程自然结束，或只改尚未启动的克隆。
    已把 `verify2`（15:52Z 起跑、14 行覆盖到 17:02Z，且它启动时才读文件）立为**权威仪器**；
    poller1 若下一跳崩掉，丢的只是 due 拍之前的行，不影响判决。也不新挂第三个并发采样器——
    `__evalResult` 是单一共享通道，并发只会互相打死。

- 2026-10-02 15:3xZ **#77 收窄 + 挖出 #78（重占排除项永不过期），并记一条我的预测失败**（mark EX2@83381120）：
  · **#77 的第一分支已被读数否证**：`releasedRooms={"W37S55":83293528}` **存在且含 W37S55** ⇒ 排除登记表是接通的，
    那两条 `sr:W37S55` 的候选只是**存量记录不被重过滤**（与 #69 同族的残值），不是"闸坏了"。
    `W38S56` 已自有却仍挂 `QUALIFIED` 同理（`dropReleasedRooms` 只管释放房，不管"已自有"）。
  · **#78 才是真缺陷（读码定死）**：`territory-manager.ts:101` 的 `pruneReleasedExclusions(ctx.tick)` 写在
    `:46 if (!directives) return;` **之后** ⇒ 只有"正在释放某房"的轮次才跑得到清理；W37S55 早已 finalize ⇒
    `kernel.roomRelease` 空 ⇒ 每轮提前返回 ⇒ **清理永不执行**。实测该键年龄 **87,592 拍 > TTL 50,000** 仍在，正面印证。
    同一文件 `:37-41` 的注释已经记过这个教训（把 `voidContractsOutsideEmpire`/`sweepHomelessCreeps` 挪到提前返回之前，
    "ghost 合同正是在这些没有在途指令的轮次里活下来的"）——`pruneReleasedExclusions` 是**漏掉的第三个**；
    `releasedRoomsCap=16` 那条容量帽同在一个函数里 ⇒ 也从未生效。
  · **两层语义在打架**：池侧 `dropReleasedRooms`（`candidate.ts:191-192`）**只看键在不在、完全忽略时间戳**；
    计划侧 `plan-adapter.ts:154-155` 才按 `tick - releasedAt < 50000` 判。池在计划上游 ⇒
    键永存 = 池侧永久排除 = **计划侧那段 TTL 判断永远读不到候选**，声明的 50,000 拍窗口在实践中是死的。
  · **为什么这一条我不自己动手**：把清理挪上去，**上线后的第一个副作用就是删掉 W37S55 的排除项**，
    于是我们**主动放弃过的房重新变得可占**。#1 那次放弃是既定决定，不该被一次"生命周期修正"静默重开。
    已按两个选项写进 §3.5 请示：①承认永久放弃（把语义与代码对齐，行为不变）②承认有界排除（挪清理，
    并接受"满 50,000 拍后可被重新考虑"，建议同时要求新视野/新 intel 才允许再进计划）。默认不动。
  · **我的预测失败，且是新判据接住的**：15:3xZ 我按 URU14→16 的 −10/拍 外推"本例大概率跨过 tol、是可判实例"。
    实际 URU15→16 只跌 **−20/79 拍**，跌势在 tol 内**停了**（基线 70,705 → 67,365，Δ=−3,340 < tol≈3,535）
    ⇒ 这一例按重写后的口径是 **INSENSITIVE**；而**按我原来的错判据它会被记成 PASS**（"storage 未跌 ⇒ 豁免生效"）。
    判据重写起作用了：它把一个假归因改成了"不可判"。速率外推的错法也记一笔——`bk`/storage 这种带脉冲的量，
    两点斜率不能当常态（同 §"外推前先标样本出处"）。
  · **上一条的"这例是 INSENSITIVE"也只成立了一行就被否证**：URU17@83381130 storage=66,665 ⇒
    Δ 从基线 70,705 变 **−4,040 > tol 3,535** ⇒ 跌势重新跨过容差，本例**又回到可判**。
    教训同族但方向相反：我上一条用"单行持平"去否证前一条的外推，本身又是**一行定趋势**。
    判 `bk`/storage 这类带脉冲的量，**至少两行同向**才算趋势（今天第三次为同一件事付学费）。
    到 verify 拍（83381266，还有 ~136 拍）若 Δ 仍 > tol 且 `alive` 仍 =2 ⇒ 按重写口径记**不可归因**
    （回滚属预期，真问题挪 #47 补员道）；若 `alive` 补到 3 而仍为 3 ⇒ 才是唯一可归因的 PASS。

- 2026-10-02 15:4xZ **#68 的更深一层：我那一支豁免在"能触发回滚的房"里按构造不可达**（mark RB1@83381220，与 URU18 同窗）：
  · 现场四连读：`spawnQueue` **只剩一条 `hauler:24`，没有任何 upgrader 请求**；在场 creep 的 role 直方图
    = `distributor×3 / harvester×2 / hauler×1 / upgrader×1` ⇒ **alive upgrader = 1**（URU18 那行 2→1 就是死了一只没补）；
    6 个 bay 里 3 个在孵 ⇒ **不是槽位不够**；`spawnBlacklist={}` ⇒ **不是黑名单挡的**；
    `spawnRejects = {budget:2756(早已冻结), reserveOnly:4896, noDegrade:234, floor:0, degradeGateClosed:1618}`。
  · 为什么"没请求"才是正解：`demand.ts` 的 storage 低水位阶梯写的是
    `upgraderTarget = pressure <= 0.5 ? 1 : 0`（本房 storage 65,265 且在跌，低于 sustained），
    而 alive 已经 =1 ⇒ **编制已满 ⇒ 不发请求是设计行为**。
    ⇒ 调优把 `upgrader.maxCount` 从 2 抬到 3，**对孵化数量零影响**：`maxCount` 只是天花板，需求侧根本没要到 3。
  · **这直接打到我自己的修正上**（必须写清）：我 #68 的效果豁免条件是
    `isUp && roleCount >= pv.preAdjustValue + 1`（这里 = alive ≥ 3），而 `getRoleCount` 取的是
    `countRolesByHome` 的**在场即时数**。可需求侧在低水位房里最多只要 1 只 ⇒
    **只要本房低库存（会跌、会触发旧判据回滚），alive 就不可能到 3 ⇒ 我那一支永不点着**；
    反过来若本房库存充裕（能涨到 3 只 upgrader），旧判据开头 `|Δ| ≤ tol ⇒ 不回滚` 本来就放过 ⇒
    **我的豁免同样是惰性的**。两个前提互反 ⇒ **#68 的修法在实践里近乎不可证伪**——它没有解决它想解决的问题，
    只是把回滚条件加了一条几乎永不满足的旁路。这是"判据对被测机制自身失明"的又一例，这次被测量是我的补丁。
  · **下一步方向（先摆数，不擅自改判据语义）**：要么把效果信号换成**需求侧的目标数**
    （`upgraderTarget`/队列里 upgrader 条目数，机制真能动的量），要么承认"低水位房里调 maxCount 无意义"、
    让调优在 `storage < sustained` 时对 upgrader 系参数**不参与探索/调整**（这是收窄调优的作用域，不是放宽回滚）。
    两者都不动阈值/护栏；选哪个属设计取向，下一轮按取证再定。
  · #68 本实例按重写口径预计记 **不可归因**（跌幅 > tol 且 alive < 3），等 URU19/20 落账；
    不写 PASS，也不写"我的补丁被否证"——被否证的是**它可被验证**这件事。

- 2026-10-02 15:4xZ **#68 判决落账：本例 INSENSITIVE（不可归因），而且我 20 分钟前的预判连符号都弄反了**（URU19@83381288，due 拍 83381266 之后 22 拍）：
  · 读数：`maxCount` 仍为 3、`lastAdjusted` 仍是 83379766（没有新的撤销写入）⇒ **没有发生回滚**；alive=1；storage 65,655。
  · 为什么"没回滚"不能记到我头上：`getExpectedDirection` 对 **upgrader ↑ 的期望方向是 worsen＝库存下跌**
    （多几只 upgrader 就该多烧库存）。本例基线 70,705 → verify 窗 65,655，**Δ = −5,050，跌幅越过 tol(≈3,535)**
    ⇒ **旧判据自己要的那个证据已经成立了**，它本来就会放过 ⇒ 我的豁免分支参不参与**不可判**。
  · **我预判写反的地方**：15:3xZ 我写"跌幅>tol 且 alive<3 ⇒ 预计不可归因（回滚属预期）"。
    错在把"跌"当成了旧判据会**失败**的条件——实际"跌"正是旧判据**通过**的条件（方向对 upgrader↑ 是反的）。
    结论方向没变（仍不可归因），但推理里那一步是蒙的；记一笔：**判"某条判据会怎么判"要把它对每个方向的
    期望符号列全再判**，不能只看"量在跌/在涨"（同族：`getExpectedDirection` 里 harvester 是 up=improve、
    upgrader 是 up=worsen、builder 是 up=improve —— 一个减号三种方向语义）。
  · 口径警告照旧适用：探针里的 storage 是**即时读数**，而判据吃的是 `avgStorageEnergy`（窗量）。
    这里只用它判**符号**（跌 vs 涨），符号在两种口径下一致 ⇒ 结论稳；不要拿 −5,050 这个数值去和 tol 做精确比较。
  · **与 RB1 那条合起来的最终状态**：#68 的补丁**已上线、无害、但在实践里是惰性的**——
    能让旧判据失败的状态（库存上行/充裕）里，`alive ≥ 3` 又受需求侧阶梯 `pressure≤0.5?1:0` 限制而难以满足；
    反之能满足 `alive≥3` 的状态，旧判据本来就放过。**下一轮按 §4.0-pre 的"补员道"取证走，
    并在这条线上二选一**：①效果信号换成需求侧目标数/队列条目数；②让调优在 `storage < sustainedStorage` 时
    不参与 upgrader 系参数。两者都不动阈值/护栏。**任务单 #68 记为"未解决：补丁 inert，待重设计"**，不写结案。

- 2026-10-02 16:0xZ **批次 8 已上线并被字节确认；#74 拿到判效的前半，#78/#77 的现场态也被同一发读数钉住**：
  · **推送与生效**：`607c819..faf9944`（19 笔）；闸门①/①½/②/③ 全过（unit 376 文件/5152 例、integration 30/239、
    typecheck、工作树 src/tests 与 HEAD 一致）；CI `success`；**线上 `sha=f7c382cd2972` == 本地 dist sha**
    ⇒ 这次不是"已上线"而是**字节级确认生效**（顺带再证 CI 构建确定；API 报的 779551B 与本地 781376B 之差是取数包装，
    sha 相同即内容相同）。推送前当场取的旧基线是 `0191c735e6a9`。
  · **#74 第一半到手（MANUAL1@83381536，部署后约几十拍）**：`layoutGaps.W37S58` **键已消失**（`cg:"GONE"`）。
    这只有新码做得到——旧期望表会一直把 `linkHub:2` 写回去。后半按预先登记的判据等下一次规划收尾
    （`nextPlanTick=83381765` ⇒ 约 16:16Z）：要看 **`ng` 转 null 且 `np` 落进 ≤~100 带**。
    注意这次的读数里 `ng=108/np=229` 仍是**部署前那一轮**留下的（`T_收尾 = ngpt−500 = 83381144`，早于换码），
    不能当"没解钉"——这正是我给它补第四态的原因。
  · **控制面同一发读数还白拿了两个数**：`cpuPerTickByRoom` = 核心 **1.148** / 幼房 0.634（部署前基线核心 1.03~1.06）
    ⇒ 解钉后规划频率 ×10 的代价**第一次有了量级**（约 +0.09/拍 ≈ +8%），但这是换码后几十拍的读数，
    boot 窗口本身会抬高它 ⇒ 判"贵不贵"要等 16:16Z 之后同表再取一发对比，别现在就写"×10 只花 8%"。
    `releasedRooms={"W37S55":83293528}` 仍在（年龄 87,992 拍 > TTL 50,000）⇒ **#78 在生产里成立**；
    `expansionPlans` 仍 4 条 ⇒ **#77 成立**。（两条都是我有意不动的：一个重开领土决定，一个属排产语义。）
  · **我自己又踩了一次已记录的坑并当场修掉**：判效器的 EXPR 里我塞了中文注释 ⇒ 首轮就返回
    `expression size is too large`（上限此前实测过：912 拒 / 620~692 通），仪器会连瞎 2 小时。
    修法：注释全部搬回脚本头，EXPR 压到 **534 字节**，手工先验一发通了才重新挂上（旧进程 76575 已 kill，
    且**先 kill 再改文件**——避开我今天已经犯过一次的"编辑运行中的 bash"）。
    这条纪律的形状是：**注释属于脚本，不属于探针表达式**；任何新探针都要先单发验通再挂循环。

- 2026-10-02 16:0xZ **#68 的"inert"结论补上完整枚举，从而从"近乎不可证伪"升级为"可证明不改变任何结果"**（读 `demand.ts:902-936` 全阶梯）：
  · 我 15:4xZ 那条只用了"低水位房 target ≤ 1"一支，结论方向对但证据不足。现在把**需求侧能填满 maxCount 的状态全列出来**
    （只有三处把 `upgraderTarget` 交给 `maxCount`）：
    ①`hasDowngradeRisk || crisisNeedsGuard` ⇒ 拉满保级；
    ②冲刺：`hasStorage && storage ≥ sprintStorageGate && pressure ≤ sprintPressureGate` ⇒
      `storageNearFull ? maxCount : min(maxCount, 2)` —— **非满仓时最多只要 2 只**，我的豁免要 3，仍然够不着；
    ③`!hasStorage` 早期猛冲且 `stationUpgradeOnline` ⇒ `fullTarget = maxCount`（但这类房**根本没有 storage**，
      `avgStorageEnergy` 无从上行）。
  · 再逐一比旧判据在这三种状态下会不会失败：①保级＝库存被大量消耗 ⇒ 跌或持平 ⇒ 方向满足或 `|Δ|≤tol` 放过；
    ②满仓冲刺＝库存已在 cap 上、**涨幅被容量压死** ⇒ `|Δ| ≤ tol` 放过；③无 storage 房＝该量恒 0/持平 ⇒ 同样放过。
    ⇒ **不存在"我的豁免改变结果"的状态**：豁免点着的必要条件（alive ≥ 新上限）与旧判据失败的条件（库存显著上行）互斥。
  · 所以正确的自我裁决是：**#68 那个补丁是 outcome-neutral 的死代码**，不是"生效但未证明"，也不是"被否证"。
    它上线没有坏处（只多一条放行路径），但也**没有解决它想解决的问题**——真正的问题在别处：
    **调优把搜索预算花在"天花板根本不被需求触及"的参数上**（今天这一例：`maxCount` 2→3 而需求只要 1，
    孵化数零变化，还要我花一整轮取证去发现这件事）。
  · 下一轮的替换（不动阈值/护栏）：给 upgrader 系参数加一条 **binding 判据**——
    只有当需求侧请求数**超过旧上限**（即天花板真的卡过）才允许探索该方向；否则跳过该参数。
    这是把 #60/#68 那条线从"事后豁免"改成"事前不浪费"，比继续给判据打补丁更接近根因。
    ⚠️这条替换与 §4.0-pre 的"幼房补员道"是同一条链：先取证 `alive` 为何停在 1（RB1 已证"不发请求是设计行为"），
    再决定 binding 判据取哪个量。

- 2026-10-02 16:0xZ **#68 的第三次也是最后一次改判——前两次的结论都被我自己读出来的代码否证，这里把"撤的是哪一支"写清**：
  · **撤第一判**（"补丁已生效但未证明"）：撤的是"未证明"里的归因方向——URU19 的库存是**跌**的，
    而 `getExpectedDirection` 对 upgrader ↑ 期望的就是跌 ⇒ 旧判据自行放过 ⇒ 不能归因于我（这条 15:4xZ 已写）。
  · **撤第二判**（"补丁是 outcome-neutral 的死代码"）：**整条撤掉**，错因是我当时没读 D.3 的实现，
    只按"需求侧最多要 1 只"外推。实际 `isContractMet`（`evaluator.ts:587-592`）对 `"up"` 的判据是
    `currentRoleCount >= pv.preAdjustValue + 1` —— **与我那条豁免逐字相同**；而 `verifyPendingAdjustments`
    是**先过 D.3 才进效果判据**。⇒ 凡能走到效果判据的 upgrader ↑，我的豁免**必然为真**
    ⇒ 它不是死代码，而是**把 ↑ 的效果检验折叠进了 D.3 的前置条件**：库存证据此不再被查询。
  · **不是我发明的放宽**：`builder.` 分支（既有代码，`evaluator.ts:676-679`）本来就是同一形状
    （`isUp && roleCount >= preAdjust+1 ⇒ return true`，与 backlog↓ 并列 OR）。我 #68 的注释写的是
    "与 builder 同构、同一证据标准"——**这句是对的**；错的是我随后据此断言它"不改变任何结果"。
  · **真正的风险要说准**：↑ 方向现在**无法被效果否证**——只要编制填满新上限就永久接受。
    线上指纹与此一致：`83377266` 的 1→2、`83379766` 的 2→3，`rollbackCount` 始终 0 ⇒ **调优对 ↑ 是单向棘轮**，
    会一路抬到需求或护栏拦住为止。今天的实际伤害≈0（RB1 证明需求只要 1 只，天花板不 binding），
    但**它让"自动调优"在 ↑ 这一半上不再自我纠错**——这与 L0 的"持续优化"直接冲突，属机制完整性问题，不是性能问题。
  · **下一轮该做的不是回滚我的补丁**（回滚会把 #68 原本要修的"盈余房永远被撤销"再放回去，且对 ↑ 也并未更有意义），
    而是**让 ↑ 可被效果否证**：把验证信号从"库存方向"换成机制真能动的量——
    需求侧请求数是否超过旧上限（binding 事件），以及 binding 期间的产出证据（升级速率/ backlog 消化）。
    这条与 §4.0-pre 的补员道同链；两个角色（upgrader/builder）应一起改，避免再造一次"同构但不同验证"的分叉。
    ⚠️批次 8 刚上线、#74 的判效窗正跑到 16:16Z ⇒ **这条改动不在本批插队**（换码会清 heap、把 #74 的
    `ng→null` 那发读数搅掉），先出规格，随下一个自然批次走。

- 2026-10-02 16:1xZ **#74 判效 = PASS（三条预先登记的判据全中，且解钉的 CPU 代价被实测否证为"不可测"）**：
  · 决定性读数 UPU4@83381788：`core.ng = null` ⇒ **`nextGapPlanTick` 已被删除**（`layout-planner.ts:700` 的
    `gapsOpen===false` 分支跑了）；`core.np = 62` ⇒ 落在 **50 + roomPhase** 的设计带内（解钉前连续三行是 216/136/57 且 `ng` 在）；
    `cg = "GONE"` 从 UPU1 起就为真 ⇒ `layoutGaps.W37S58` 的虚缺口 `linkHub:2` 已被清除且未再写回。
  · 控制组同时成立：幼房 `young.np = 73`、`ng = null` ⇒ 与它解钉前一样在 50–100 带里，**没有被我动的路径波及**。
  · 节奏反推自洽：`T_收尾 = 83381850 − 50 − 62+...`（np=62 时 nextPlanTick=83381850）⇒ 这一轮收尾在 ~83381738，
    距上一轮 83381144/83380641 那种 ~500 拍间隔**变成 ~600 拍内完成两次**……更直接的说法是：
    UPU1→UPU4 之间核心房已从"每 500 拍一次"改为"每 ~50–100 拍一次"，`rev` 仍 20 属正常（它只在布局变化时递增，
    这条我 15:0xZ 已经为判据翻过一次车，这次不再用它当触发器）。
  · **解钉的 CPU 代价：实测没有上升**。`cpuPerTickByRoom.W37S58` 序列
    1.148(UPU1, 换码后约 50 拍) → 1.037(UPU2) → 1.011(UPU3/UPU4)，部署前基线带是 1.03–1.06。
    ⇒ UPU1 那个 1.148 就是我怀疑的 **boot 窗口读数**，稳态后核心房每拍 CPU **不升反略降**；
    诚实的说法是"**在仪器分辨率（±0.1）内测不出上升**"，不能说"×10 频率是免费的"——
    只是这笔成本小于当前噪声，且被幼房/远矿的波动盖住了。幼房同列 0.634 → 0.458 → 0.527 也说明这张表本身在摆。
  · **收尾状态**：#74 结案（本地→线上→判效三格齐）；批次 8 的 #76 判效改挂下一次卖单（`sold` 有增量时看
    `tradeFeeEnergySell` 是否同步 > 0；整窗无增量记 UNASSESSABLE）；#77/#78 两条现场态在同批发数里再次确认
    （`rl` 里 W37S55 仍在、`pn=4`）⇒ 都仍是"等人排产"，不是我漏修。

- 2026-10-02 16:2xZ **本会话收尾盘点（TJ1@83381868）**：
  · **上线面**：批次 8（`607c819..faf9944`，19 笔）线上 sha `f7c382cd2972` == 本地 dist ⇒ 本会话所有**功能改动都已生效**；
    本地领先的剩余提交经 `git diff --name-only origin/dev..HEAD` 核过**全是 docs**（含本条）⇒ 随下一自然批次走，不单独换码。
  · **#74 已结案**（见 16:1xZ 条）。第二次收尾会由仍在跑的判效器（PID 76628，24 轮）自动记录，`np` 若持续落 50–100 带即为节奏复证。
  · **#76 判效 = UNASSESSABLE（第三态，不算成败）**：当前窗 `bk={harvested:1000, spawned:1950, towerSpent:1790, imported:2000}`
    ——**`sold` 与 `tradeFee` 都不在** ⇒ 换码后**一笔交易都没发生** ⇒ 分桶键没出现是"没事件"，不是"键坏了"。
    这正是我预先登记 ③ 的用意（否则我会像 #64 那次一样把"缺键"读成失败）。挂判效：下一次 `sold` 有增量的行上判，
    同房 `tradeFeeEnergySell` 同步 > 0 ＝ PASS；`sold` 增而该桶恒 0 ＝ 我的标注没接上（REFUTED，不改口径）。
  · 同一发读数再次确认 **#78/#77 的生产态**：`releasedRooms` 里 W37S55 仍在、`expansionPlans` 仍 4 条 ⇒ 等人工排产，非漏修。

- 2026-10-02 18:1xZ **#79 实施完成（本地），并修正了规格里我自己带偏的方向**；两条收尾读数也到手：
  · **#74 复证**：判效器跑到 UPU24/24 收工——`core.ng` 从 83381788 起**一路 null**（跨 ~1,600 拍到 83383393），
    `np` 反复落 11–79（设计带 50+相位），`cg` 全程 `GONE` ⇒ 解钉不是单点读数而是持续状态；
    核心房每拍 CPU 稳态 1.066（基线带 1.03–1.06）⇒ **代价仍在噪声内**。
  · **#68 的最终读数**：verify2 跑到 V14@83382452 仍是 `maxCount=3 / adjustTick=83379766`（未回滚）、alive=2、
    storage 60,325 ⇒ 与 INSENSITIVE 判决一致（旧判据在库存下跌时本来也放过）。
  · **规格方向被我自己读出来的事实纠正**：原 #79 说"要加事前 binding 判据"。读 `evaluator.ts:230-238` 发现
    **提案侧早就写了 binding**（hauler ↑ 要求 `s.haulerCount >= current`，即"顶到天花板才提"）⇒ 缺的从来不是
    binding 检测，而是**提上去之后无法被证据否决**。所以本轮改的是**上行护栏**，不动提案门。
  · **改动**（`evaluator.ts`）：`isUpwardHarmful(before, current)` ＝ `avgReserveDelta` 转负**且**比调整前更坏
    （超出既有 `computeTolerance`）；upgrader ↑ 与 builder ↑ 两处"人口到位即 return true"改成
    `return !isUpwardHarmful(...)`。**不新增任何阈值**（复用 D.4 下调护栏的"且更坏"形状与既有容差），
    D.3 人口合同、D.4 下调护栏、提案门、所有阈值一字未动。刻意不用 `avgPressure`：它不在
    `AdjustSignalsSnapshot` 里，给持久化的 preAdjustSignals 加键该留给单独一批。
  · **为什么这才是 #68 的正解**：#68 的病是"盈余房里 ↑ 必被撤销"。旧判据吃的是 storage **方向**，
    而盈余房多养 upgrader 也可能让库存继续涨 ⇒ 方向信号按构造失效；但它**不能反过来**说明
    "只要人头到位就没烧坏家底"。新护栏把"到位"降回必要条件，把"有没有抽干储备"变成可否证的那一半。
  · **测试**：`upgrader-up-verification.test.ts` 从 3 例改写成 5 例（含旧的现场形状 (a) 与两条控制组）：
    (a) 到位+旧记录没有储备快照 ⇒ 保守接受；(d) 到位但储备被抽干 ⇒ **回滚**（这条就是原先不存在的出路）；
    (e) 到位、储备变小但仍为正 ⇒ 接受（不在"只是变慢"上误触发）；(b) 没到位 ⇒ 仍走 D.3 blocked；
    (c) hauler ↑ ⇒ 仍按原判据回滚（证明没连带放宽）。
    **反向实验**：把守卫退回 `return true` ⇒ **恰好 (d) 一例转红、4 例绿**。
    全量：typecheck 干净、unit 376 文件/**5154** 例、integration 30/**239**、红行数 0。
  · **上线判据（现在就写死）**：新回滚路径只有在一次 ↑ 验证恰好撞上"储备抽干"时才会显形 ⇒
    PASS＝下一次 upgrader/builder ↑ 的验证里出现 `rollbackCount` 增加或 `roleBounds` 回落，
    且该窗 `avgReserveDelta` 确实为负且比调整前更坏；
    UNASSESSABLE＝窗口内没有 ↑ 验证事件（**别把没事件读成没生效**，这是 #64 那一类）；
    REFUTED＝出现了 ↑ 验证且储备被抽干却仍无撤销 ⇒ 我的接线没到位（去看调用点与快照字段），不改口径。
    本地证明是主要证据（5 例 + 反向实验），线上这一发是自然实例复证，可能要等几天。

- 2026-10-02 18:3xZ **#79 已上线（字节确认）并挂上复证采样器**：
  · 推送 `faf9944..9da1670`（6 笔：5 docs + `9da1670` #79）；CI success；**线上 `sha=673e7fb6b884` == 本地 dist**；
    推送前当场取的基线是上一批的 `f7c382cd2972`（⇒ 换码确实发生，不是"以为推了"）。
  · 采样器 `upguard-verify.sh`（PID 89832，22 轮 ×300s）首行即部署后基线 W1@83383895，读数值得记：
    **核心房 `upgrader.maxCount=2`、幼房 `=3`**（#68 那个实例本来就在幼房）；
    `frozenParams` 里 **`hauler.maxCount:rc2`（核心）/ `rc1`（幼房）** ⇒ 回滚路径对其他参数**确实会触发并计数**
    ⇒ #79 新增的 ↑ 回滚一旦发生，就落在这同一个可读计数上，不需要新仪器。
    两房 `bk` 都没有 `sold`/`tradeFee` ⇒ **#76 至今仍是"没事件"**（部署后零交易），继续按 UNASSESSABLE 处理。
  · 本轮没有为 #79 的上线付额外代价：#74/#68 的两个判效窗都已自然收工（UPU24/24、V2V14+DONE），
    所以"判效窗在跑就不换码"这条没有被我破。

- 2026-10-02 18:4xZ **#80 立案并实施（幼房"防线吃掉一半收入"这条账原先根本读不出来）**：
  · **观察**（YD1/YD2@83383931/83383942）：幼房 W38S56 `rcl4 / 161970-405000`、2 个 source、
    `ei=19.4/t`（**两源物理上限 ≈20/t，已贴顶**）、`nf=-5.31/t`、storage 70K→54.9K 在掉、
    窗内 `spawned 12/t + upgraded 8/t + towerSpent 10/t` ⇒ 消耗 ≈30/t 而收入 ≈20/t；
    现场结构 `44 ramparts / 0 walls`，最低六只血量 10,001~36,821（`hitsMax 3,000,000`），
    `buildQueue=0`、`cont=0` ⇒ **RCL4 满配之后这房唯一的大额可变量就是升级**。
  · **根因不是"塔在花钱"**：`tower-defense.ts:202-241` 的维护档**有门**（`colonyState==="normal"` + 塔能量比 >0.7），
    但门里**没有任何净流/储备趋势条件** —— 一房可以既 `normal` 又长期入不敷出。
    而账面上 `countedTowerAction` 把 **开火 / 补被拆的结构 / 和平期维护墙盾** 全记进一格 `towerSpent`，
    `ledgerP0P1Consumption` 又把整格当**常供侧** ⇒ "该不该为发展让路"只能靠"此刻没敌人"推断。
  · **实施（纯观测，门与阈值一字未动）**：`towerSpent` 之外新增精确划分
    `towerSpendCombat / towerSpendStructures / towerSpendWalls`（五个调用点各归各桶，和恒等于合计），
    **不进** `CONSUMPTION_FIELDS` 也不进 `ledgerP0P1Consumption` ⇒ 净流与配给序口径不变。
  · 测试：新增 4 例（三桶归属 + 划分不变式 + 纯观测不变式）；**反向实验**（钉掉分桶写入）⇒ 恰好 3 例转红、
    纯观测那例绿。unit 377/**5158**、integration 30/239、typecheck 干净（第一版我留了个 unused import，被 tsc 抓到）。
  · **随附的请示（§3.5 的 #81 项，我不自批）**：幼房防御外壳 vs 发展速度。三个方向：
    ①给维护档加一条经济条件（储备在掉/净流为负时把 rampart 维护目标降到衰减地板）⇒ **是防御回归**；
    ②给幼房开一条远矿（+10~20/t 新收入，防线与发展都要）⇒ 顶级答案，但要占帝国 CPU 预算（G6 已红）；
    ③接受 ~33 小时爬 RCL5。未定则默认③（现状），我只把账做清楚。

- 2026-10-02 19:0xZ **#80 上线并当场拿到决定性的那张读数**（TWR1/TWR2@83384300/83384400）：
  · 部署：批次10 `9da1670..d32ee93` 上线，CI success，**线上 `sha=a5bdb4770862` == 本地 dist**。
  · **中间有一次我自己差点读错的形状**：第一次采样看到幼房 `towerSpent:500` 而三桶全缺 ⇒ 看起来像"我的不变式被否证"。
    真相是 **`bk` 住在 Memory、跨部署存活**，而换码后还没有一个核算窗关掉 ⇒ 那一行是**部署前**的窗。
    等 ~300s 让窗关上再读才有意义。**这正是我今天记过的"累计/窗量读数必带 boot 基线"的同族**，只是这次差点让我把
    "仪器没接线"当结论写出去。（也顺手确认了 `toLedger` 是 passthrough、`ledgerDelta` 按 `emptyLedger()` 的键遍历 ⇒ 新键会流过。）
  · **决定性读数（幼房 W38S56，一整个 50 拍窗）**：`{harvested:980, towerSpent:500, towerSpendWalls:500}`
    ⇒ 塔支出 **100% 落在墙/盾**（划分不变式成立：500 == 500 + 0 + 0），
    而同一窗 **`upgraded` 键缺席 = 这一窗对 controller 的贡献是 0**。
    对照收入：`harvested 980/50 ≈ 19.6/t`（两源物理上限 ≈20/t）⇒ **这房把一半收入花在维持 44 只 rampart 的外壳上，
    而升级在同一个窗里颗粒无收。** 核心房同窗没有任何 towerSpend 键（塔这一窗没开火）⇒ 缺键=没动作，与幼房正例互证。
  · 这条把 §3.5 的 #81 项从"感觉分配不对"变成了**可以直接算的账**：
    ①若把维护档降到衰减地板，可回收 ≈10/t ⇒ 升级速率有望从 ~4/t 回到 ~10/t 量级（RCL5 ETA 从 ~33h 缩到 ~13h），
      代价是防线回归（44 只 rampart 血量会往 10k 地板掉）；
    ②给幼房一条远矿 ⇒ +10~20/t 新收入，防线与发展都不让步，但吃帝国 CPU（G6 已红）；
    ③维持现状。**我不自批**：默认仍是③，我只是现在把①②的代价写成了可核对的数。

- **R104（10-02 19:1xZ）· #82 重新接线 layoutMetrics —— 一条"写在 Memory 里但从未被编译进去"的观测通道**
  · **发现方式**：#74/#75 判效时去读 `Memory.kernel.layoutMetrics`，看到 W37S58/W38S58 两条形似完好的记录，
    但 `grep -o "layoutMetrics" dist/main.js | wc -l` = **0**，而 `computeLayoutMetrics` 的调用点 `grep -rn` = **0**。
    ⇒ **这条通道的写者不存在，Memory 里那两行是化石**（与 `overflow_loss` 全仓无写者、只被初始化成 0 完全同族）。
    我上一轮差点把它当"已有仪器"用——**这次把"静态调用点 + 打包产物 grep"设成了新增写者的固定收尾检查**：
    一条通道的证据必须出现在**要跑的那个二进制**里，不是出现在 src 里。
  · **处置：重新接线而不是删掉**（删掉会连带丢掉 #75 的缺口，且所有输入都已存在：
    `getDeadAssetLinks`、`isLinkConstrained`、`MINCUT_ALGO_VERSION`、`roomMem.minCut`）。
    写点放在规划器收尾步 `recordLayoutMetrics(snapshot, gapsAfter, ctx.tick, roomMem)`，**只在内容变化时写 Memory**
    （这条通道每次规划都会跑，无条件写会让 Memory 增量与 CPU 都白付）。
  · **顺手把 #75 补上**：新增 `auditLinkRoleSurplus(snapshot, queue)` —— 把已建 link + `queued/blocked` 的 link
    按 `classifyLinkRole` 归类，与 `expectedLinkRoleCounts` 逐角色比对，返回**超额数**。
    缺陷 #75 的原始形状就是这个数：W37S58 六只 link 里 **3 只被归成 controller 角色 ⇒ surplus 2**，
    而 `getDeadAssetLinks` 只看 `role=source`，所以**超配角色对死资产检测全盲**。现在它至少有读数。
  · **一条不许越界的红线（写成用例钉住）**：surplus **只进 metrics，绝不进 `gaps` 字典**。
    `gaps` 是 `shouldPlan` 的缺口强制输入，把 surplus 塞进去等于把 #74 刚拆掉的钉钉回去
    （超配结构永远"补不满"⇒ 规划器永久钉在 500 拍慢速重试）。
    用例直接断言 `mergeLinkRoleGaps(...)` 在那张快照上 `gaps === {}`。
  · 新增字段：`linkRoleSurplus`、`defenseCutComplete`（后者的用途是区分"断点算法版本变更前后"的墙线，
    让 #81 那类防线讨论有历史口径）；`roomMem.dismantleCount` 为新的持久计数。
  · **可达性证明（这一轮的结论必须长这样）**：`dist/main.js` 内 `layoutMetrics` ×2、`linkRoleSurplus` ×3（改前都是 0），
    `recordLayoutMetrics` 恰好 1 个调用点 + 1 个定义。门：typecheck 净；**单测 378 文件 / 5164 例**、
    **集成 30 / 239** 全绿；新增用例文件 `tests/unit/layout/link-surplus-metrics.test.ts`（6 例）。
  · **判效（部署后才读，按老规矩）**：owned 房的 `layoutMetrics` 条目必须**带 `linkRoleSurplus` 键**
    —— 化石条目不可能带这个键，所以这是"写者真的在跑"的直接签名；同时 W38S58 那条化石应当**继续缺键**
    （它没有规划器在跑），两形相对就是仪器接通的证据。化石本体属 #69 的残留，本轮不删（删 Memory 属破坏性动作）。

- **R105（10-02 19:2xZ）· 批次 11 已推（`7323c33`，dist sha `c93e6d695670`，推送前基线 `a5bdb4770862`）；判效窗里 upguard 环同时送来三件事**
  · **#76 运费分桶 = PASS（有真实卖出事件了）**：同一条 50 拍窗里两次出现
    `sold:1000, tradeFee:452, tradeFeeEnergySell:452`（t=83384138）与
    `sold:1000, tradeFee:785, tradeFeeEnergySell:785`（t=83384535）。
    ⇒ 分桶键**有写者、非零、且与总额在同一窗逐笔相等**（`tradeFeeEnergyBuy` 键缺席＝那两窗没有买单手续费，与"缺键=没动作"口径一致）。
    **上一轮我判 UNASSESSABLE 的理由（换码后零交易）已不成立，现改判 PASS。**
  · **这两笔顺手把 §3.5 的 #76 项（卖能量该怎么估价）从公式变成了实测**：卖出 1000 能量这一手，
    运费分别烧掉 **452 / 785 能量（货量的 45% 与 79%）**，同一房同一数量级、两个不同对手房 ⇒
    这正是"定价闸门不看距离"的代价形状。**价格/门槛我一个没动，仍待人定。**
  · **#79 上行护栏 = 仍不可判（但不是坏）**：幼房 `upgrader.maxCount` 出现一次完整闭环——
    `la` 由 83379766→83384266、`fr` 的 `upgrader.maxCount:rc0→rc1`、在场 upgrader 3→2 并稳定 4 个窗。
    形状是 ↑ 后上限回落（v1 的 `upgrader` 列其实是 **roleBounds 上限**，不是在场数——我当场把它读成"在场 3→2"，
    已在 R106 更正；verify 落在 83384266，与旧值 83379766 相差 4,500 拍 = 3×verifyDelay，
    这本身就把"到底是哪个 push 点 fired"进一步推向不可定。）
    **问题是这条回滚事件区分不了两种成因**：旧判据（storage 必须转跌）与我新加的上行护栏
    （reserve 转负且更坏）走的是同一个 push 点、同一个 `reason` 文本
    （`evaluator.ts:848` "signal not improved"），而 `TuningRollback` 事件只带
    `[paramCode, rolledBackValue, preAdjustValue]`（`tuning-engine.ts:309`）——**带原因的 `log.info` 那句落不进 Memory**。
    幼房 reserve 近一小时实测 ≈−0.76/拍（R103），所以"护栏合法否证掉了这次 ↑"完全讲得通，
    但"旧判据撤的"与"D.3 合同超时撤的"（`evaluator.ts:823` 那个独立 push 点，需要编制始终没到位）同样讲得通
    ⇒ 三成因而非两成因，**我不写 PASS 也不写 FAIL**。
    改判用的**可否证预测**（仪器已在跑：`upguard-verify.sh` 的 `la`+`fr`+编制三列）：
    下一次 `upgrader.maxCount` ↑ 若在编制到位且 reserve 未恶化的情况下被 rc+1，则 #79 被否证；
    若 rc 不动而 `la` 前移，则闭环第一次拿到成功出口。
  · **新立 #83（可归因债，非判据补丁）**：把回滚**成因**编码进事件（第 4 个元素），
    让"效果未达标 / 上行护栏 / 合同超时 / 冻结复位"四类在事后可以区分。
    这不是给判据再加一条，而是让已存在的 `reason` 字符串不再只活在 `log.info` 里。
    本轮不动 src（部署窗内工作树必须等于被测二进制）。
  · 同一条环里还有一次 **#48 的成对入账**：t=83384458 那一窗核心房 `exported:1200`、幼房 `imported:1200`
    **同窗、同额**——这是"自有房→自有房交付两侧成对入账"第一次被采到（此前所有判据都卡在"没有事件"）。
    仍按老规矩留一发复核：单次成对是**证据**，不是速率；#42/#48 的债单结案要配一次跨房投递的持续性读数。
  · **读码补上一条二阶代价（把 §3.5 的 #81 项的账算大了一档）**：`reserveDelta` 的定义是**存量差分**
    （`room-state.ts:44-52`：reserve = energyAvailable + containers + storage + terminal + creepEnergy，
    `phase.ts:372`：`reserveDelta = reserve − prevReserve`）⇒ **塔修墙从 storage 出的每一笔能量都会把
    `avgReserveDelta` 往负方向推**，而 #79 的上行护栏正是拿这个数否证 ↑ 的。
    连起来的链条是：**44 只 rampart 的维护 ⇒ 幼房 reserve 微跌（R103 实测 ≈−0.76/拍）⇒ 每一次（若走护栏那条路）
    `upgrader.maxCount` ↑ 被撤销 ⇒ 升级编制被防线外壳间接钉住。**
    ⇒ 防线的作用不止"吃掉一半收入"这一阶，它还**通过调优闭环压制编制上限**。
    ⚠️本轮**只算机制不算定罪**：19:0xZ 那次 ↑ 被回滚的成因无法归因（#83），
    所以这条链条目前是"读码成立 + 形状吻合"，等 #83 落成因码后才有第一发证据。
    可否证预测（同 #79）：若维护降档使 reserve 转正，则下一次 ↑ 应当"la 前移而 rc 不动"；
    若 reserve 转正后 ↑ 仍被 rc+1，则这条链条被我否证。
  · **#83 的规格被读码收窄了一次（比"加成因码"更小、更够用的判据浮出来）**：
    `evaluator.ts:661` 现在的形状是 `if (roleCount >= preAdjustValue+1) return !isUpwardHarmful(...)`，
    而 #79 之前那一行是 `return true` ⇒ **"编制到位却被回滚"在旧码里按构造不可能发生**。
    于是判别量根本不需要读成因字符串，**只要知道 verify 那一拍的 roleCount 就够了**：
    roleCount ≥ pre+1 且 rc+1 ⇒ 只能是我的护栏 fired；roleCount < pre+1 ⇒ 走的是旧 storage 判据那条路。
    这一发之所以定不了案，正是因为 `roleCount` 是**瞬时值且不落盘**：
    它在 t=83384218 采到 3、t=83384299 采到 2，而 verify 落在 83384266 —— **加密采样也救不了**
    （轮询间隔 81 拍只是把区间夹得更紧，落在夹区间内的那个瞬时值仍然取不到）。
    ⇒ #83 的正解因此是"把 verify 时的 roleCount 随回滚事件一起落盘"（第 4/5 个元素），
    成因字符串反而不是必需项。**不动任何判据、不加阈值。**

- **R106（10-02 19:4xZ）· #82 判效 = PASS（两形相对），并顺手把 #79 那发撤销归到 D.3 那条路**
  · 19:42:06Z 那一读（批次 11 上线后第一个完成规划窗）：
    `W37S58:{surplus:2, dcut:true, keys:8→10}`、`W38S56:{surplus:0, dcut:true, keys:10}`（**该房条目是新建的，以前根本没有这一行**）、
    `W38S58:{keys:8}`（**化石照旧缺两把新键**）。
    ⇒ 三条预测同时命中：owned 房拿到新键 = 写者真在跑；幼房首次出现条目 = 写点每房都走；
    无规划器的化石房不动 = 这些写不是别的路径顺手造的。**#75 的指纹 surplus=2 也按预测落地**
    （六只 link 里 3 只归 controller 角色）。这条通道从"src 里有、dist 里没有"变成可核对的仪器。
  · **`upguard-verify.sh` v2 补上在场列之后，第一读就把 #79 那一发的归因往前推了一步**：
    `W38S56:{ub:2, au:2, la:83384266}`、`W37S58:{ub:2, au:0, la:83229266}`、两房都无 `pp/pt`（当前无在途 pending）。
    幼房 **上限 2 / 在场 2 = 编制到位**；而 83379766→83384266 那一段是**上限被抬到 3、在场仍是 2**
    （15:4xZ 那发探针实测"恒为 2 达 ~1,270 拍"，与现在这一读首尾夹住同一件事）。
    ⇒ **那次撤销大概率走的是 D.3 那条路（编制没到位 ⇒ 旧效果判据 / 合同超时），不是我新加的上行护栏**
    —— 护栏的前提是"编制到位"，而它的前提在这房里从未成立。
    ⚠️措辞按证据强度收着写：我只有窗口两端两发在场读数（起点 2、现在 2），**不是连续覆盖**，
    所以这是"最合理解释"，不是定罪；定罪由 v2 的逐 5 分钟 `au` 列在下一发 ↑ 上完成。
  · **真正的产能缺口因此回到 §4.0-pre 原来那条**：`cap=3` 时第三只 upgrader **为什么不落地**
    （四选一：请求没发 / 被拒 / 孵化槽被占 / 归属口径没算进编制）。
    这条现在**第一次有了能夹住它的仪器**（v2 同时带 `ub`/`au`/`la`/`pp`/`pt`）。
  · 核心房 `au:0` **不是缺陷**：RCL8 保级带（`enter=10000`）设计如此，#52/#63 已结过一次案；
    这一读只是说明它此刻在带内、没在保级。
  · 工具侧收尾：`layout-metrics-verify.sh`（PID 698）判据到手后已停手，不再占 `__evalResult` 单通道；
    `upguard-verify.sh` 升级为 v2（先 kill 再改，不编辑运行中的 bash；EXPR 收到 528B 并单发验过）。

- **R107（10-02 19:4xZ）· 撤回"补员道缺口"这条主目标 —— 读码把它答完了，而且答案是"没有缺陷"**
  · 我把 §4.0-pre 那张"四选一"当待办去取证，**但代码已经给出确定解，属于第①支（需求侧根本没发第三只的请求），
    且原因不是 bug**：`demand.ts:910-915` 的冲刺档写的是
    `upgraderTarget = storageNearFull ? maxCount : Math.min(maxCount, 2)`，
    维持档 `=1`、低水位档 `=1 或 0`、只有**保级/crisis** 才 `= maxCount`。
    ⇒ **幼房在非满仓的冲刺态里，需求阶梯物理上最多只要 2 只**；`upgrader.maxCount=3` 那个 3 在这一态**根本不参与计算**。
  · 这条把今天两处读数**一次性解释干净**（不需要任何孵化侧故障假设）：
    `au:2` 且 `ub:2` ⇒ 编制到位（v2 首读）；`ub` 被抬到 3 的那段里 `au` 恒 2 ⇒ 阶梯照样 clamp 到 2（15:4xZ 探针）。
    反过来若它在维持档，`au` 会是 1 ⇒ 观测排除该支。
  · 于是 **调优器在这一态提出的 ↑ 是"按构造不可绑定"的**：
    `evaluator.ts:377-381` 的 ↑ 门槛是 `avgStorageEnergy > surplus && economyHealthy && upgraderCount >= current && current < ceiling`
    —— 它拿**在场数 vs 当前上限**（2≥2）当"该扩容"的证据，但扩了也不会改变需求；
    到验证时 D.3 读的是 `roleCount >= preAdjustValue+1 = 3`（`:661`/`:823`）⇒ **必然 blocked、必然被撤**，
    每 4,500 拍重演一次。这正是 a570e7c/9f0aa98 我自己写过两遍的那条方向：
    **别给判据打补丁，给 upgrader 系参数加"事前 binding 判据"。**
  · 两条出路（下一轮定一条实施，命名以"谁持有事实"为准）：
    (A) **让需求侧自己回答可绑定上限**：暴露一个纯函数（例如"给定当前档位状态，本角色的有效上限"），
        调优器问它 ⇒ 单一事实源；代价是要把 `demand.ts` 的档位判定抽成可复用函数。
    (B) 在 `TuningSignals` 补 `storageNearFull`/`hasDowngradeRisk` 两路输入，让 ↑ 门槛自己复算绑定条件；
        ⚠️**这条会把同一个谓词抄到第二处** —— #68 那次"豁免与判据同谓词、判据被折叠掉"就是同类错误，
        如果选 (B)，必须加用例证明两处判定不会分叉（或让 (B) 直接调用 (A) 的纯函数）。
  · 判据（事前写死）：修复后幼房在**非满仓冲刺态**不应再出现 `upgrader.maxCount` 的 ↑ 提案
    （`la` 不再每 ~4,500 拍前移、`frozenParams...rc` 不再涨）；而**满仓态或保级态**仍应能提 ↑
    （否则就是我把一条正常通路焊死了 —— 这条控制组必须同时看）。
  · 顺带结案：**#68/#79 那条"单向棘轮"在幼房的现场表现由此解释完** —— 不是判据太严，也不是护栏太松，
    是**提案条件与验证条件绑的不是同一个量**。#79 的护栏依然该留（它管的是"编制真到位却烧穿储备"那一型），
    只是这一房里它的前提从未成立。

- **R108（10-02 19:5xZ）· #85 规格落地成可执行文件，并撤对我自己早前的一条"作废"判词**
  · 规格写进 **`tmp/observe/pending-85-patch.md`**（下一步只差照着动手）：
    需求侧 `demand.ts` 报出**结构钳位** `upgraderClamp`（`DemandResult` 已有同族先例 `haulerTarget`/`sourceBacklog`），
    经 **heap**（`globalCache().demandClamps`，同仓惯例：`roomTraffic`/`repairRooms`/`roleCpuEma`…）
    交给 `aggregateSignals` 填进 `TuningSignals`，↑ 门槛只加一条 `current+step <= clamp`（clamp 为 undefined=未钳位）。
    关键取舍三条已写进注释要求：**弹性不进这个数**（浮动的数当资格会振荡）、**只闸 ↑ 不闸 ↓**（↓ 必然绑定）、
    **字段缺失时默认许可**（宁可放行一次错误提案，也不把升级道焊死；这条有用例钉）。
  · **撤销我早前的判词（撤的是哪一支要写清）**：`pending-79-patch.md` 里我写过"事前 binding 判据方向作废，
    因为提案侧已经绑了（`evaluator.ts:232`）"。**`:232` 是 hauler 的提案门槛**（读 `containerFillRatio`/
    `consumerSaturated`），不是 upgrader 的 —— upgrader 的门槛在 `:377`，里面没有任何绑定检查。
    ⇒ 那条"作废"是**行号张冠李戴**造成的错杀，本规格把它复活。同族教训：**"因果句/作废句也要自己 grep 到具体行"**
    —— 我用行号印象否证过自己的方向，这一次是同一个毛病的第二次发作。
  · 唯一调用点当场核实：`evaluateDemand(` 全仓只有 `spawn-manager.ts:177` 一处 ⇒ 报事实只需改一处，不会漏第二家。

- **R109（10-02 19:5xZ）· 换码后一发体检：扩张闸只剩 G0+G6，且两道都不在我自批范围内**
  · `failedGates = [G0 posture.expansionAllowed=false, G6 CPU tier=tight]`
    ⇒ **G3/G4/G7 已全部离红**（同一天早前是四道齐红）。这条值得记：自给度符号修正与能量账本那几笔
    语义修复，在 dashboard 口径上确实把红转掉了，不是我把判据改了（阈值一个没动）。
  · `capacity = {tier:"tight", since:83384635, upgradeTicks:0}`
    —— `since` 对到的墙钟是 ~19:18Z，**早于本次 19:32Z 换码** ⇒ 这一发还没吃到部署税；判 tier 只看 tier+since 的老口径不变。
    `upgradeTicks:0` 是设计（`target===prevTier` 时强制归零），不是停滞。
  · **#74 的修复仍然成立**：`layoutGaps` 只剩 `W38S58` 一个键（化石，属 #69），**核心房 W37S58 无缺口条目**。
  · **#82 的仪器稳定**：`layoutMetrics` 键数 = `{W37S58:10, W38S56:10, W38S58:8}`
    —— 两个 owned 房都带新键、化石房仍是旧形状。这条控制组以后每次体检都值得复读一眼（成本一次读取）。
  · `releasedRooms=1`（W37S55）、`escalations=2`、`Memory.kernel.tier="healthy"`（注意这是另一套 tier，别与 CPU tier 混读）。
  · 结论留给下一轮：**"要不要扩张"在我这边已经没有可自主修的代码项**，G0 是姿态开关、G6 是人的排产决定（§3.5 的 #50 项）。
    我这轮能自主推进的仍是 #85（调优提案的一致性修复）与 #83（归因落盘）。

- **R110（10-02 20:0xZ）· 批次 12 上线 #83 —— 回滚事件带 `roleCountAtVerify`；另有一条环寿命的事实**
  · 推送 `7323c33..4eaae17`（1 笔 src/tests + 7 笔 docs 一批），门实录：
    typecheck 净、**unit 379 文件 / 5168 例**、**integration 30 / 239**、build 出 `dist sha 65fa054a6668`
    （pre-push 钩子重建后与闸门②记下的**同一个 sha** ⇒ 构建字节确定这条又一次成立），推送前线上基线 `c93e6d695670`。
  · **可达性按 #82 立的规矩查过**：`grep -o roleCountAtVerify dist/main.js | wc -l` = 非零（改前为 0）。
    这条改动如果只活在 src 里，我下次读事件环还是会拿到 3 元素 —— 那正是今天无法归因的形状。
  · **新增一条硬事实（决定以后所有"事后取证"类计划）**：段 2 的事件环 500 条只覆盖 **~755 拍**，
    而 `verifyDelay = 1,500 拍` ⇒ **一次调优验证的"因"和"果"不可能同时留在环里**。
    今天那次撤销之所以永远定不了案，不是采样不够密，是**按构造取不到**（我先前把它记成"仪器没接线/没落盘"，
    这只说对了一半：另一半是环寿命本身比验证周期短一半）。
    ⇒ 以后凡是"等事件再回看环"的取证计划，必须先算环寿命够不够；不够就挂边跑边捞的 watch
    （本次已挂 `tuning-events-watch.sh`，PID 5122，1,500s/轮 × 10 轮 < 755 拍的窗口）。
  · 顺带纠正我本轮早些时候的一处说法：**`TuningBlocked(22)` 其实是有写者的**
    （`tuning-engine.ts:374`），所以"人口合同超时"与"效果验证失败"在 kind 层面本来就分得开；
    真正分不开的是 `TuningRollback(20)` 内部的"旧效果判据 vs #79 上行护栏"——这一发由 `roleCountAtVerify` 解决。
  · 判效状态：**结构上已确认（dist 有该字段 + 单测 4 例 + 反向一致性用例）**，
    现场要等**下一次真实回滚**才看得到 4 元素载荷 ⇒ 未发生前记 UNASSESSABLE，不写 PASS。
    判据：`ring-dump.mjs TuningRollback` 里 `d.length === 4`；归因规则 =
    `roleCount >= preAdjustValue+1` 而仍被撤 ⇒ 效果判据/护栏；`<` ⇒ 人口合同那条。

- **R112（10-02 20:2xZ）· 批次 13 上线 #85 —— ↑ 的事前绑定判据（需求侧报事实，调优器只做一次比较）**
  · 推送 `4eaae17..c986dab`（1 docs + 1 src/tests），门实录：typecheck 净、
    **unit 380 文件 / 5173 例**（新增 1 文件 5 例）、**integration 30 / 239**、本地 dist `8262da1e2c35`、
    推送前线上基线 `65fa054a6668`（= 批次 12，先确认上一批真在线上）。
  · 实现走的是规格里的 (A) 单一事实源：`demand.ts` 逐分支报出**结构钳位**
    （保级=不钳 / 冲刺非满仓=2 / 维持=1 / 低水位=1 / 无站桩 container=minCount /
    **RCL8 还叠加 WORK 部件限速**——这一支是我动手时才发现的，RCL8 核心房同样存在"抬了也落不了地"），
    经 `Memory.kernel.demandClamps` 进 `TuningSignals.upgraderClamp`，↑ 门槛多比一次
    `current + step <= clamp`。**钳位缺省 = 不钳 = 照常放行**（不把正常通路焊死）。
  · 三条纪律落地：**只闸 ↑ 不闸 ↓**（用例 (d)）、**弹性不参与钳位**（浮动值当资格会振荡，注释写死）、
    **观测不掺决策**（`roleCountAtVerify` 与 `upgraderClamp` 都只在写侧/提案侧各用一次，判据与阈值一个没动）。
  · 覆盖诚实声明：**需求侧那张"分支→钳位"表目前没有 demand 级用例**（只在 evaluator 级验了钳位的消费行为）。
    下一批补 `evaluateDemand` 的直接断言；在那之前，若线上看到"所有房再也不抬 maxCount"，
    第一嫌疑是这张表某个分支算错，而不是判据本身。
  · 判效（两半都要看）：①幼房 `upgrader.maxCount` 不再被抬到 3（`la` 停止每 ~4,500 拍前移、`rc` 不再涨）；
    ②**控制组**：某房在满仓/保级态（钳位解除）时仍要能抬 —— 若两房都不再抬 = 我砍掉的是通路不是无效提案，立即回查。
  · **上线后第一读就取到形状证据（20:3xZ，t=83385829，批次 13 字节确认 == `8262da1e2c35`）**：
    `demandClamps` 键存在（写者跑过）+ 内容 `{W38S56: 2}` ⇒ 幼房确实走在**冲刺非满仓**那支、结构钳位 = 2，
    与 `#78` 读码预测的分支**逐字对上**；同一读里 `roleBounds.upgrader.maxCount` = `{W37S58:2, W38S56:3}`
    ⇒ **幼房此刻正带着一个"上限 3、需求只到 2"的在途 ↑** —— 这就是这条通道要拦的形状，被当场抓到现行。
    核心房没有 `dc` 键：RCL8 无降级风险时 `allowUpgrader=false`，整个阶梯不跑 ⇒ 按"缺省=不钳"放行，
    这正是控制组该有的形状（**没有把正常通路误焊**）。
  · ⚠️措辞要准：#85 拦的是**下一次提案**，不撤销已在途的那一发 ⇒ 预期序列是
    现在的 ↑(→3) 仍会被撤一次（`ub` 回到 2），**然后不再出现新的 ↑ 脉冲**。
    判据 = `la["upgrader.maxCount"]` 此后停止每 ~4,500 拍前移；这要等 ~3 小时墙钟，属事件型判效。

- **R114（10-02 20:4xZ）· 补上 #85 的诚实空白，同时撤回我自己写的一句"RCL8 也是钳位"**
  · 空白 closes：`tests/unit/spawn/demand.test.ts` 末尾新增一组 `upgraderClamp` 表（7 例，走文件里既有的
    `stationSnapshot`/`normalCtx`/`livingHarvester` 夹具，不新开 fixture 文件）：
    冲刺非满仓=2、冲刺满仓=不钳、维持=1、低水位=1、保级=不钳、**无站桩 container=minCount**、
    **RCL8 满级无风险=留空（读作放行）**。typecheck 净 + 该文件与 tuning 目录 **131 例全绿**。
  · **撤的是哪一支**：批次 13 的提交信息与 §6 R112 里我都写过"RCL8 还受 WORK 部件限速 ⇒ 同属结构钳位"。
    写用例时该断言直接红了（`expected undefined to be 1`），读码回头一对才看清：
    `snapshot.rcl >= 8` 那个 `min(maxCountByWork)` 块**只在 `allowUpgrader` 为真时才跑得到**，
    而 RCL8 无降级风险时 `rcl8NoUpgrade` 早已把 `allowUpgrader` 关成假；有降级风险时走保级分支、
    后面的保级覆盖又把钳位写回 undefined ⇒ **那一支按构造观测不到 = 死码**。已删除，不"留着以防万一"。
    ⇒ 同一处顺带删掉保级覆盖里的 `upgraderClamp = undefined`（与保级分支同谓词、永远是无操作）。
  · **行为影响：零**。批次 13 上线的那两行本来就是不可观测的赋值，删它们不改变任何线上读数
    （已核：`demandClamps` 的键形状/值都由那几支之外的代码决定）。所以本批属"清理 + 补测"，
    不需要重跑 #85 的判效，只是把 RCL8 那一型改记在**提案侧的 `upgraderCount >= current`** 上
    （满级房里 upgrader 为 0 ⇒ 提案自己就不成，注释里写清了"两道条件叠出来的覆盖面"）。
  · 教训入册：**注释里的"这也是一个钳位"必须能被一条断言检验**；我这次是先写进注释和提交信息、
    后补用例，顺序反了 ⇒ 用例把主张证伪。正确顺序是"分支表 → 立刻写用例 → 再写注释"。

- **R115（10-02 20:4xZ）· #85 的判效时刻表被现场数据钉死了，另外看见一个我自己设计里自带的漏口**
  · upguard v2 的完整序列（我把 24 行原始读数解出来看的，不是扫尾几行）：
    `ub=2 / au=2 / la=83384266` **从 19:43 一路稳到 20:29（11 发，46 分钟）**，
    然后 20:34 那一发变成 `ub=3 / la=pt=83385766` ⇒ **新 ↑ 提案落在 tick 83385766**，
    区间夹在 83385736（20:29:05）与 83385816（20:34:10）之间。
  · ⚠️这一发**不能算 #85 失败**：批次 13 的生效时刻本身落在同一个 20:29–20:34 窗里
    （20:29 我查 CI 还是 in_progress，20:34:06 才 completed + 线上 sha 认到 `8262da1e2c35`），
    按 ~3.8 秒/拍插值那一拍约在 20:31 ⇒ **谁先谁后按构造分不出来**（又是"部署生效时刻不能靠墙钟插值"这条老账）。
  · 取而代之的是两条**无歧义的预约读数**（下一轮照着做，别再插值）：
    ①在途这一发将在 `pt + verifyDelay = 83385766 + 1500 = **83387266**` 被验证 ——
      届时应看到 `TuningRollback` 且 **`d[3] = roleCountAtVerify = 2 < pre+1 = 3`** ⇒ #83 第一次拿到载荷、
      同时把 #79/#68 那次撤销归因彻底钉死（这一发注定走 D.3 那条）。
    ②回滚后若 `demandClamps.W38S56` 仍是 2（已实测为 2），则**下一次提案时刻（≈83388766，间隔 1500）不该再出现新的 `pt`**；
      出现了 = 我的闸没拦住，那就是真失败，直接去查钳位有没有被读进 signals。
  · **我自己设计里自带的一个漏口（写清楚免得下轮当新案查）**：钳位缺省=放行是刻意的，
    但它意味着**每次换码后的头几拍**（`spawn-manager` 还没给这房跑过第一拍 ⇒ `demandClamps` 无键）
    会放过至多一次注定落空的 ↑。这是"宁可放行也不焊死"的定价，代价上限 = 每部署一次一发；
    若日后想收紧，正解是让 `TuningSignals` 区分"没钳位"与"还没测到钳位"两种 undefined，
    而不是把默认改成阻塞。本轮不动。

- **R117（10-02 20:5xZ）· 新立 #86：自有房一直留在候选池里，还带着 `QUALIFIED` 状态**
  · 观察（一次只读探针，mark EX7A3，t=83386099）：`expansionCandidates` 满 10 格里
    **`W38S56 st=QUALIFIED`——那是我自己的幼房**（claim 成功在 8.5h 前，`lastExpansionCompletedTick=83328457`）。
    同池里 `W37S56/W37S54 age=841,415 拍`（≈38 天）仍是 `UNKNOWN` ⇒ #77 那句"候选池含自有房 + 陈年记录"
    第一次被当场证实（**plans 那半句仍未证实**：我第一次探针把字符串拼接写成了 `|`，读回 `[0,0,0,0]`，
    改用数组键后仍没读到 `status` 字段名 ⇒ 那 4 条计划的状态本轮没有读数，别当成已核）。
  · 根因（读码，不是猜）：`discovery.ts:55-58` 把 `existingCandidates` 原样灌进 `candidateMap`，
    `ownedRoomNames` 只在"新建候选"那条路上用 ⇒ **占领成功不会让那条候选失效**（候选只在 Intel 刷新时重建）。
    这与 `dropReleasedRooms` 注释里写的病理**是同一个洞的另一半**，所以修复也放在同一层。
  · 处置：新增 `dropOwnedRooms(candidates, ownedRoomNames)`，接在 planner 步 2 的池子组合里
    （`dropInsufficientSources(dropOwnedRooms(dropReleasedRooms(...)))`）。
    语义**对状态不敏感是刻意的**——`QUALIFIED` 正是这条缺陷的载体，按状态豁免就等于留着它。
    这不是"降闸"：自有房永远不是待占领目标，执行期本来也有自有房复检，这里只是不让池子说谎、
    不白占 10 格中的一格、不让 dashboard 的 `candidateCount` 读高。
  · 门实录：typecheck 净；unit `tests/unit/expansion/` **14 文件 / 262 例**（新增 5 例，含一条
    "(e) 与重占排除叠加时两条语义互不吞掉"的交叉控制——单独走排除表时自有房仍在，
    证明这两道闸确实是两件事）；**integration 30 / 239 全绿**。
  · **本轮不部署**（刻意）：#83/#85 的两条预约读数在 ~85/175 分钟后才落地，再插一次换码会
    清 heap、加 ~400 拍 G6 税，把判效窗搅浑。本地现压 **6 笔**（1 笔补测/死码删除 + 4 docs + 本批 #86），
    随下一次没有判效在跑的批次一起走。

- **R123（10-02 21:2xZ）· 批次 14 上线 #86，判据两半当场到手**
  · 字节确认：CI success + 线上 sha `ea4c69da6f8b` == 本地 dist（推送前基线 `8262da1e2c35`）；
    门实录 unit **381 文件 / 5186 例**、integration **30 / 239**。推的理由也记了：预约读数依赖的是
    Memory 里的 `pendingValidation` 与段 2 的事件环，这两样都不随换码清零，且 `demandClamps` 键已在 Memory ⇒
    不会再开"boot 窗放行"那个漏口。
  · **判据①（主）**：`t=83386606` 候选池 `n=10`，**自有房一条都不在**（探针自己比对 `Memory.rooms` 的
    `W37S58 / W38S56` ⇒ `owned_present=false`）。今天上线前它是 `W38S56 st=QUALIFIED`。
  · **判据②（控制组）**：原先在池里的 **9 条非自有候选一条没少**
    （`W38S57 / W38S58 / W38S55 / W38S59 / W37S56 / W36S57 / W39S55 / W37S54 / W38S54`），
    而且腾出来的那一格**立刻被一条真实目标补上**（`W37S57` 重新入池）⇒
    代价不只是"少一条谎"，`MAX_ACTIVE_PLANS=5` 之外的那格容量**实际恢复了**。
  · ⇒ **#86 结案**（PASS 两半齐）。#77 的队列那半句仍按 §3.5 留在人那边（G0/G6），本轮没动任何阈值。
  · 待收（仪器在跑，不靠我盯）：tick **83387266** 的 `TuningRollback.d[3]`（#83 首发载荷 + #79/#68 归因）
    与 ≈**83388766** 的"不再有新的 `pt`"（#85）。

- **R129（10-02 21:3xZ）· 纠正一条世界假设，并据此改写 #85 的控制组要求**
  · 实测（mark CL9A1，t=83386770）：幼房 `rcl=4 / storage 57,336 / **capacity 1,000,000** / ext 20 / progressTotal 405,000`。
    ⇒ **本服 storage 容量不按 RCL 分级**。我先前拿官服"RCL4=30,000"去推，会把这行读数当成不可能；
    错的是我的假设，不是数据。（核心房早就是 1M，两条一致。）
  · 推论一：`storageNearFull` 在 57k 这种水位下**几乎永不触发** ⇒ 需求阶梯里"满仓才不钳位"那条分支在本服近乎不可达
    ⇒ `demandClamps` 会长期是 2 ⇒ 预约判据②**预期走 PASS**，不是 UNASSESSABLE。
  · 推论二（更重要，防止下一轮误判）：#85 的**控制组不能只在幼房身上找**——"钳位解除后仍能提 ↑"这一半
    需要一个 storage 冲近 1M 的房才会自然出现。看不到它 **不等于** 我把通路焊死了；
    那属**测量条件不足**，不属改动缺陷。真要主动验它，只有两条正路：等满仓，或写一条 e2e/单测覆盖那条分支
    （单测已有：`upgrader-proposal-binding.test.ts` 的 (b)/(c) 就是"无钳位⇒照常放行"那半）。

- **R131（10-03 01:3xZ）· #83 判效到手 = PASS，并据此把 #79/#68 那条"↑ 被撤销"的归因彻底钉死**
  · 事件环实证（段 2，跨度 83389413→83390485）：
    `83389766 TuningBlocked r=W38S56 d=[3,2,2500]` → **`83390266 TuningRollback r=W38S56 d=[3,2,2,2]`**
    ⇒ 第 4 元素存在且 = **2**（#83 的 `roleCountAtVerify` 第一次随事件落盘成功）。
  · 整条 D.3 算术严丝合缝：adjust `pt=83385766` → 首次 blocked `83387266`（= +verifyDelay 1,500）→
    `TuningBlocked` 的 duration 递增 1500/2000/2500 → **超时回滚 = 83387266 + 2×1,500 = 83390266**（分毫不差）。
  · 于是这发的成因**唯一确定**：`roleCountAtVerify=2 < preAdjustValue+1=3` ⇒
    **是"人口合同超时"撤的，不是旧效果判据、也不是 #79 的上行护栏**。
    ⇒ #79 的护栏**至今未被行使**（前提"编制到位"在本房从未成立），这是证据而非推测；
    同时反证 #85 抓到的形状成立：上限 3、需求被钳在 2 ⇒ 编制到不了 3 ⇒ 合同必超时。
  · **#85 的最终判据仍未收**：要看 `83390266 之后不再出现新的 TuningAdjust`（基线写死进工具）。
    已挂 `watch-85-after-rollback.sh`（零 console，走 Memory API + 段读，不抢 `__evalResult`）；
    刚读到 `demandClamps={"W38S56":2}` ⇒ 钳位仍在 ⇒ 若再现新提案就是**闸没拦住**，按分支只查接线、不放宽判据。
  · 另记：`peek.mjs` 的正确用法是裸点路径（`kernel.demandClamps`），**不吃 `--path`**；
    我按 `--path` 写会静默读出"`--path = ?（不存在）`"——失败形状长得像"键不存在"，已在工具内改正。

- **R134（10-03 01:4xZ）· 给 §3.5 的 #50（要不要关远矿换 CPU）补一发它缺的输入**
  · 核心房一个 50 拍窗的账本（`rooms.W37S58.economy.bk`，t=83390629）：
    `harvested 900 + imported 2,900`（本窗**没有** spawned/upgraded/towerSpent 键＝没发生，不是坏了）
    ⇒ **收入里 76% 是远矿交付**（`imported` 2,900/3,800），而远矿 ops 此刻 2/2 在役、`newRemote=true`。
    这正是 #50 那道决定缺的量：**关远矿省下 2.27 CPU/拍的同时，砍的是本房收入的四分之三**（先前我记的"19.9/t 能量"
    是另一窗口的毛值；这次给的是同窗结构比，不是速率——**单次成对是证据不是速率**，取速率要连续多窗）。
  · ⚠️同时把 G4 那条判据的仪器分歧登记下来（防止下一轮拿它当"钱不够"的定论）：
    同拍核心房快仪 `economy.nf = 2,829`（×100 口径 ⇒ **+28.3/t**）、
    长视界 `netFlowMean_d = **-38.4/t**`、`ws = [-1352, -9558, 950]`（**两拍之间摆了一万**）。
    ⇒ 两台仪器**连符号都不一致**，而 G4 读的是 2.7（第三种口径）。老账（G4/G7 会在 200 拍之间自己翻）今天再复现一次：
    **判"买不买得起"不许用单发快照**，要连续多次 dashboard 取交集。
  · 另两件当场可见的健康事实，只登记：①刚有一次入侵走完闭环
    （`EnemyInvasion` → `TowerVolley×6` → `EnemyCleared`，核心房 `hostileAt=83389593`）⇒ 防御链在真实敌情下工作，
    这条给 #20/#41 的"作战轴只有 e2e 覆盖"补了一发线上小样本；②`AccountingDrift W38S56 d=[88,2]` 出现一次
    （幼房那条恒等式自检报警 ⇒ 它 +62.8/t 的长视界净流要按老口径**差分后再信**）。

### R135（10-03 01:5xZ）#85 判据窗：先把"我自己的工具差点造出一个假结论"这件事记下，再把 PASS 的最早读数时刻写死

**线上二进制已现场认回**：`check-code` ⇒ 本地 `dist/main.js` 与线上一字不差 = `ea4c69da6f8b`（783,330B）。
⇒ 下面所有读数与 83390266 那条基线**同码可比**，且这一轮没有换码 = 没有新增 G6 那笔 400 拍税。

· **新硬事实（此前没量过）：tuning 引擎的评估节拍 = 500 拍。**
  证据是三个刻度的差：`TuningBlocked@83389766` → `TuningRollback@83390266` → 探针当时读到的 `Game.time=83390766`，
  两两相差 500、且全部 ≡ 766。**这把 #85 的判据窗从"按小时等"变成"按提案机会数等"**：
  一个 24,000 拍的窗 ≈ 48 次评估机会，不是"大约一晚上"这种模糊量。
  上一轮我按 `pendingValidation` 反推的周期（提 83385766 → 撤 83390266 = 4,500 拍）现在有了下层的机械解释。
· **一次工具口径错，差点生成一条假结论（记下来，这类错只在"读自己写的东西"时才犯）**：
  我用 `peek kernel.tuning.rooms.W38S56.frozenParams.upgrader.maxCount` 读到 **`?（不存在）`**，
  于是一度判定"`frozenParams` 里根本没有这条 ⇒ D.3 超时撤销**不进**冻结计数 ⇒ 我上一轮'再来一发就冻结'是错的"。
  按父级 `...frozenParams` 重读，键在，且值就是 `rollbackCount=2`。
  根因很简单也很难查：**`peek` 按 `.` 切路径，而这个 Memory 的键名自己含点**（`"upgrader.maxCount"`）
  ⇒ 它去找 `frozenParams.upgrader` 这个不存在的中间层。**含点键名一律读到父级再看，别用点号往下钻。**
  ⇒ 那条"D.3 不进冻结计数"的假结论**没有写进任何判据/代码**（当场被父级读数否掉），代价是一发读数。
· **顺带更正我自己 R134 的证据来源**（数值对、来源错）：上一轮记的"幼房 `upgrader.maxCount.rollbackCount=2`"
  是从 `peek kernel.tuning.rooms` 的**截断输出**里读的，而那 900 字符里装的全是**核心房 W37S58**
  （W37S58 恰好也有 `upgrader.maxCount` 条目、`rollbackCount=0`，`hauler.maxCount` 才是 2）。
  这次按 `...W38S56.frozenParams` 读回才算独立确认。**结论没变，但那条记录的取证当时不成立。**
· **冻结后果精确化**（读 `applyFreezePolicy`，不靠印象）：`rollbackCount` 达阈值 3 才冻 ——
  并且冻结**把值复位到 CONFIG 基线**（不是钉死当前值），事件走 `TuningFreeze`。
  ⚠️计数不是累计：`applyFreezePolicy` 开头会把"本轮验证通过且未回滚"的参数 `rollbackCount` 清零。
  线上直接证据就在同一条读数里 —— 幼房 `hauler.minCount.rollbackCount=0`（它 `lastAdjusted` 是 83368766，说明被调过、也被清过）。
  ⇒ 所以"再来一发撤销就冻结"**只在下一发仍是撤销时成立**；中间夹一次成功验证，计数就回 0。
· **#85 判据窗（这一条是给下一轮读的，别改口径）**：
  现场 regime 已经和"两度诱发 ↑"那一刻**逐量相同** ——
  `dc=2`（钳位）、`up=2`（在场 upgrader，按 home 现场数）、`rb.maxCount=2`、`la=83390266`。
  ⇒ 窗内不出 `code 3` 的 `TuningAdjust` 是**有效负证据**（不是"没机会提"）。
  但 **PASS 的最早读数时刻 = `t - 83390266 ≥ 9,000 拍`**（≈两个自然复提案周期）；此前一律记 PENDING。
  ⚠️并且**不许**拿"这个窗里别的参数也没被调"当"回路死了"的证据：其它参数的提案间隔实测 8k–14k 拍，
  比评估节拍大一到两个数量级（`lastAdjusted` 四条差值：14,000 / 8,000 / 13,500）。
  FAIL 只有一种形状：**出现 `t > 83390266` 的 `code 3` TuningAdjust** ⇒ 只查接线
  （`aggregateSignals` 是否真拿到 `kernel.demandClamps[room]`），**不放宽判据**。
· 轮询器 `watch-85-after-rollback.sh`（PID 34779）10 轮×1200s ⇒ 末轮 ≈04:37Z，覆盖 ~24,000 拍 ≈ 48 个评估节拍，够用。
  ⚠️它有个已知缺陷（我这轮才发现、**不改运行中的脚本**）：`head -c 900` 恰好切在 `W38S56` 那条上，
  所以它日志里的 `la`/`frozenParams` 只有核心房。判据主体靠环内事件 + `dc`（都在截断点之前）⇒ 不受影响，
  但要 `la` 的备证就按上面那条父级 peek 手工补一发。

· **R135 续（01:53Z，一次父级 peek，零 console）：#86 拿到第二发读数。**
  `Expansion Dashboard @83390784`：`Candidates=12(Q=2,R=6,U=4)`、`Plans=4 active, 4 waiting`、
  `Top=W37S56(WAITING_EXECUTION)`、`Blocked=G0+G4+G6`、`Budget=347990/940512`。
  ⇒ 距 #86 判效 PASS（09-30 那批发现在 10→12）**~2.5 小时后池子仍是 12 且没有自有房条目回灌** ——
  这条不是新证据形状，但把"剔一次就够"和"每轮又被塞回来"两种未来行为区分开了（后者本该让计数往下掉或重复抖动）。
  ⚠️同时 `G4 v=3.5`（一小时前读的是 2.7，门槛 5）⇒ R134 那条"三台仪器连符号都不一致"继续成立：
  **G4 在门槛下方自己摆 0.8，正好是它离门槛的距离**，所以判"扩张买不起"仍然不许用单发快照。
  本轮**没有任何新的可自主修的阻塞**：G0 属人（`posture.expansionAllowed=false`）、G6 属人（`tier=tight`，
  出路只有砍远矿 ops，代价已算过），G4 属仪器分歧。

· **R135 再续：#85 这条 PASS 的强度分两层，别把它们混成一句"闸生效了"。**
  ①**回路活着**（窗内出现**任意 code** 的 `TuningAdjust`）—— 这只否证"引擎整体不再提案"，
  它是 `ring-dump` 现有日志里免费带的（事件行有 `r=` 与 code）。
  ②**本参数本房本来会提**（否证"这里根本没机会"）—— ⚠️**窗内拿不到**：唯一证据是**历史基线**，
  即同一 regime（`dc=2 / up=2 / rb.maxCount=2`）下已经真实发生过**两次** `↑ → 合同超时撤销`
  （`frozenParams.upgrader.maxCount.rollbackCount=2`）。这是"系统自己演示过的倾向"，不是对照实验。
  ⇒ **正确的结案措辞**：窗内 ≥9,000 拍、`dc` 全程 =2、无 `code 3` 新提案 ⇒ "与历史基线一致，且未见提案被重新触发"，
  **而不是**"证明没有闸就一定会提"。若①也整窗不出现，则这一轮连一致性都算不上证据，只能记 PENDING 继续等。
  （为什么不给核心房当正对照：核心房 RCL8 走 `rcl8NoUpgrade`、在场 upgrader=0 ⇒ 人口合同多半同样不满足，
  它"不提"不代表我的闸，拿它当对照会把两个不同的原因读成同一个。）

### R137（10-03 02:0xZ）**撤回一条我 repeated 了很久的错误请示：G0 不是人给的开关**

**触发**：趁 #85 窗在飞，回到挂着未结案 #34（"G0 要 RCL5"），去代码里核 `expansionAllowed` 到底由谁写。
· `posture.ts:247`：`expansionAllowed = expandHealth && !liveThreat && posture !== "war"`；
  `posture.ts:150`：`expandHealth` = 七个**机器每拍算出来的**合取项。
  **没有任何人工开关写这个标志。**（人能给的是 CONFIG 阈值，不是这个布尔值。）
  ⇒ 我在 R120 之后的路线图、#77 的结案语、以及 **20 分钟前刚写的 AGENT.lock 交接卡**里都写了
  "G0 属人 / 等人类解锁 expansionAllowed" —— 那是**误归因**，而且方向有害：它把"能自主推进的一项"
  登记成了"等人回复的东西"，于是没人去量它什么时候自己满足。**本文与锁都要更正。**
· 现场量了七个合取项（探针 `mk=R136A/R136B`，读数里带标记、已回读确认是我自己的结果）：
  bucket **10,000** ≥7000 ✓ ｜两房 `colonyState=normal` ⇒ `allNormal` ✓ ｜两房 `economyPressure=0`
  ⇒ `avgPressure` 0 ≤0.4 ✓ ｜sponsor `W37S58` RCL8 + storage **882,314** ≥8,000 ✓ ｜GCL **5** > 自有房 **2** ✓
  ｜`liveThreat=false`、`posture=fortify`（fortify 记忆不封锁扩张，代码注释明确）✓
  ｜⚠️**`youngestMature` = 假**：`colonizeYoungestFloorRcl = 5`，而 `W38S56` 实测 **RCL4**。
  `cpuRatioOk` 没单独测到（它要 `totalCreepCpu`，探针拿到的 12.9 是含系统的 `Game.cpu.getUsed()`，不是同一个量）——
  **留作未验项**，别当已过关。
· **RCL4→5 还差多少、多久**（两点差分，列序已从 `upgrader-raise-verify.sh` 源码核回：
  `[tick, alive, storage, roleBounds, lastAdjusted, controller.progress, mark]`）：
  `progress 131,867 @83381368` → `255,559 @83390897` ⇒ **Δ123,692 / 9,529 拍 ≈ 13.0/拍**；
  其中 83381288→83381368 那 80 拍子窗是 **8.0/拍**（那一刻在场 upgrader=1、`maxCount=3` 还没被撤）。
  门槛 `progressTotal = 405,000` ⇒ 余 **149,441** ⇒ 按 13.0/拍 ≈ 11,500 拍 ≈ **1.6 小时**，按 8.0/拍 ≈ **2.6 小时**。
  ⚠️这两个速率是**同一段历史的两端**，中间经历过 `maxCount 3→2` 的撤销与人口变化 ⇒ 只当区间用，不当标定用。
· **可否证预测（写死时刻，供下一轮直接判）**：`W38S56` 升 RCL5 应落在 **03:3xZ–04:4xZ**。
  若 **05:0xZ** 仍未升 ⇒ 升级功率低于 8/拍，那才是 #81（幼房一半收入养 rampart、同窗升级零进账）的实锤输入；
  若提前升了 ⇒ 说明 `dc=2` 这一档（冲刺档 2 只大 body）就够到 13/拍，#81 的"发展"侧代价比我报的小。
· **请示面因此收窄**（这条是给人类看的，措辞改了）：
  原来写"G0 + G6 属人"。现在：**G0 会自己满足**（唯一假项是幼房 RCL，几个小时内到 RCL5 就翻），
  真正的阻塞只剩 **G6 `tier=tight`**（出路只有砍 `CONFIG.remote.maxOperations`，代价已算过：省 2.27 CPU/拍、
  赔 19.9 能量/拍 + 已建 120 段路 ⇒ 属人的排产）与 **G4**（`netFlow 3.5 < 5`，但这台仪器三读三符号，
  R134 已登记 ⇒ 判"买不起"不许用单发快照）。
  ⚠️**不许**据此去降 `colonizeYoungestFloorRcl` 或任何 `expand*` 阈值——降门槛换绿灯是自败，且这一条根本不需要降：
  它自己会在几小时内满足。

· **R137 自纠（写完 3 分钟内）**：我在那条预测里写的检查点是"05:0xZ 若还没 RCL5 ⇒ 功率 <8/拍 = #81 实锤"。
  写完后从 `Memory.rooms.W38S56` 又读到两个可用量：`lastRclLevel=4`、`lastRclChangeAt=83349339`
  ⇒ **整级均值速率 = 255,559 /（83390897−83349339=41,558）= 6.15/拍**。
  这条把 ETA 上界推到 **≈05:3xZ**，于是我那个 05:0xZ 检查点**会把"预测取窄了"误判成"新缺陷"**。
  ⇒ 判据改成：**"到点没升"本身不是证据**；要定罪必须另取两点差分测**当窗**速率，`<8/拍` 才算 #81 的实锤。
  ⚠️三个速率的来源各不相同（当窗 13.0 含一次 `maxCount 3→2` 的过程、子窗 8.0 是"在场 1 只"的时刻、整级 6.15 是均值），
  **不能挑一个当标定**——这正是我记忆里"外推前先标样本出处"那一类。
· 好消息：RCL 与变化时刻**在 Memory 里**（`lastRclLevel` / `lastRclChangeAt`）⇒ 判效器零 console，
  不与在飞探针抢 `__evalResult`。已挂 `tmp/tools/official/rcl5-watch.sh`（PID 38141，26 轮×600s ⇒ 覆盖到 ~06:2xZ），
  它只报"命中/未命中"，不替我下"功率不足"的结论（那条要人工差分）。

· **R137 第三次读数（同轮，02:03Z）——当窗速率比上面三个都高，方向对发展有利**：
  探针 `mk=R137C`：`t=83390960, progress=256,567`，与 63 拍前那次（`83390897 → 255,559`）差分
  ⇒ **16.0/拍**；同次还取到在场 `up=2`、`WORK 部件合计 16` ⇒ 16.0 = **1×WORK×满功率**，
  即此刻两只 8W upgrader 都在站内连续升级（占空比≈100%，对比整级均值 6.15、9.5k 拍窗均值 13.0）。
  ⇒ 按当窗速率重算 ETA：余 `405,000−256,567 = 148,433` / 16.0 ≈ **9,277 拍 ≈ 77 分钟** ⇒ **RCL5 ≈ 03:2xZ**。
  ⚠️样本只有 63 拍（≈1 分钟），是"当刻占空比"不是稳态速率；**真正的时间戳由 `rcl5-watch.sh` 落盘**，
  预测只是给它一个可否证的位置（若它在 04:4xZ 之后才命中 ⇒ 中间有掉线/饿等，那才值得查）。
· 对 #81 的含义因此变了（这是给人看的部分）：幼房此刻**没有**被发展侧挤压的读数——
  `dc=2`（冲刺档 2 只大 body）正在跑满 16/拍，`economyPressure=0`、storage 61,238 且在涨。
  ⇒ #81 里"同窗升级零进账"那一半**不该再当作现状引用**，它当时是另一种档位/停摆态；
  要不要为防御再加投入，请按"RCL5 已在 ~1 小时内自达"来定价。

· **R137 结案（02:04Z，零 console）：七个合取项全部量完，`cpuRatioOk` 也过了。**
  `sumCpuByHome()` 读的是 `Memory.kernel.stats.cpuByHome` ⇒ 可直读：`{"W37S58":3.592,"W38S56":2.791}`
  ⇒ `totalCreepCpu = 6.383`；`effectiveCpuLimit = min(limit=20, tickLimit)`（探针实测 `limit=20`）
  ⇒ **ratio = 0.319 < 0.6 ✓**。至此 R137 那句"唯一假项 = `youngestMature`"从推断升为**逐项实测**。
· **顺带量到一件结构差（这条比上面那条更值得记）**：G0 的 CPU 项和 G6 的 CPU 项**测的不是同一个量** ——
  G0 只看 **creep CPU**（`cpuByHome` 加总 = 6.38/t），G6 看**每拍总负载**（`cpuAvg10=17.1`、
  真实尾数口径 ~13–15/t）对 `comfortable ≤ 12`。两者差 ≈2.3 倍，差的那部分正是"模块/系统 CPU"，
  而新房间主要增加的是 creep CPU。
  ⇒ 含义：**幼房升到 RCL5 后 G0 会自己翻**，而 **G6 仍会红**；解 G6 的杠杆（砍 `CONFIG.remote.maxOperations`）
  减的是系统侧不是 creep 侧 ⇒ 它跟 G0 不共享成因，别指望"顺手也把 G0 解了"。
  ⚠️`cpuAvg10=17.1` 是老认识的偏高仪器（每 10 拍采一次、采到 flush 重活拍），只当上界读。

### R138（10-03 02:0xZ）G4 根因结案：我把"仪器分歧"交给人看了一年，其实它有一条可以算死的算术

**观察**（全部零 console，除注明外）：G4 的输入不是 `economy.nf`，而是**第四台仪器**——
`empire-economy.ts:278-286` 在每 100 拍（`interval: 100`）把每房 `profile.netFlow`
（= `economy.ts:173` 的 `mem.nf/100`，即快 EMA）再过一层 `α = netFlowGateAlpha = 0.02` 的慢 EMA，
存进 `Memory.kernel.gateNetFlow`，`gateView.totalNetFlow = Σ` 各房慢 EMA。⇒ 代码注释明确写着"只给 G3/G4 用"。

**现场四读数（02:07Z）**：`gateNetFlow = {W37S58: 3.131, W38S56: 0.841}` ⇒ **Σ = 3.97**（门槛 5）；
同一时刻底层快 EMA `nf = {W37S58: −206 ⇒ −2.06/t, W38S56: +186 ⇒ +1.86/t}` ⇒ **Σ = −0.20/t**。
⇒ 时间常数 = 1/0.02 × 100 拍 = **5,000 拍 ≈ 42 分钟**。
⚠️**方向判反的旧说法要撤**：我之前写"G4 在门槛下自己摆 0.8，也许一会儿就过"。实际是
**门这台仪器现在高于真实流量（3.97 vs −0.20），所以它只会向下衰减** ⇒ G4 不会自己变绿，不改变消费结构的话会更红。

**根因（一条算术，不是口径之争）**：`R129` 已测本服 storage 容量不按 RCL 分级（两房实测都是 1,000,000）。
核心房现有 `882,314`（= 88%）⇒ **剩余余量 117,686**。
若真按 G4 要求的"净流 ≥ +5/t"持续积累，`117,686 / 5 ≈ 23,537 拍 ≈ 3.3 小时`就把核心房 storage 填满。
⇒ **G4 的 ≥5/t 是一个"物理上只能瞬时满足"的条件**：一个库存接近上限的帝国不可能长期保持正向净流入，
它要么停采（那 `nf` 变负）、要么把盈余花掉（那 `nf` 归零）。而核心房已 RCL8，controller 侧的消费被 15/拍引擎上限钉死，
唯一的大额出口就是"再开一房"——正是这把闸所挡的那件事。**这是一条闭环，不是测量噪声。**
（我此前把它报成"三台仪器连符号都不一致"，那是**症状**；上面这条是本因。R134 那条"别用单发快照"仍然成立，但它不该替这条结论背书。）

**因此给人类的判断面变了**（措辞照此改）：G4 红不是"钱不够"——`Budget=347,990/940,512`、帝国存量 `882K+61K=943K`；
G4 红是**"要求继续积累"这一条在饱和库存上不可长期成立**。可选面只有三种，**全都属人**：
①把 G4 的输入/门槛换成"存量 + 流量"的合取（改判据语义）；②开一个消费出口（扩张本身、或工业线 `#16`/`#51`）；
③承认"净流 ≥5/t"作为常设条件不妥、接受它只在未满仓时才有意义。**我没有动任何阈值**——
按本项目的规矩，降门槛换绿灯是自败，且这把闸的语义归人。

· 已立案 **#88**（台账见任务表与 §3.5）：`G4 净流门槛在饱和库存帝国上不可长期满足`，属排产/判据语义决策。
· 顺带一条读数警告：`rooms.*.economy.netFlowMean_d` 这次按 `rooms.W37S58.economy.netFlowMean_d` **取不到**
  ⇒ 我记忆里那句"`netFlowMean_d = −38.4/t`"的取数路径不是这个（可能挂在别处或 heap-only）；
  **别再拿那条数字与本行的 3.97/−0.20 混算**，取不到出处就按未验处理。

· **R138 补正（02:13Z，两处，都是往"少怪仪器、多怪算术"的方向）**：
  ①**"三台仪器连符号都不一致"这件事是设计，不是缺陷**——`empire-economy.ts:308-313` 的注释写得很清楚：
    就绪度**刻意**用长视界的 `gateView/gateHealth`（步 8），预算与健康度仍用快的 `resourceView`（步 5/7/9），
    理由是 plan 晋升要**连续 500 拍成立**（`plan-lifecycle.ts:41`），而快仪"同一量相隔 100 拍
    17.7 → 0.4 → −2.8 → 12.1 → 17.2"地翻符号。⇒ 我 R134 把那台仪器的分歧当"要谨慎"的警示交上去，
    其实它早就被回答过了；**#88 里不许再留"仪器可疑"这一支论证**。
  ②顺带把我第一反应想验证的那个"新房间起步被低估"的猜想**否证掉**：
    `accounting.ts:316` 的 `updateNetFlowEma(undefined, x, α)` 直接 `return windowPerTick`（首拍落种子，不是 α·x）
    ⇒ 没有"新房间前几小时贡献被读成 0"的问题。**这条不是缺陷，别去改。**
  ⇒ **#88 因此只剩一条硬论证**（就是那条算术）：近满仓（核心房 882,314 / 1,000,000，本服不按 RCL 分级）下
    "净流 ≥ 5/t 且连续 500 拍成立"只能瞬时满足；且**方案①（改 G4 判据语义）等于推翻上面那条已写进代码的设计决定**，
    人类在权衡时要把这层代价算进去——它不是"修一台坏仪器"，是"改一次口径"。
    ⚠️另记一条口径：连续 500 拍的持久性要求 + τ≈5,000 拍的输入 ⇒ **G4 从"真实流量转正"到"门翻绿"最快也要小时级**，
    谁要是按分钟级等它翻，会误判成"没生效"。

### R139（10-03 02:14Z）趁窗取一次"仓库当前是绿的"基线（并写清我没测什么）
· `typecheck rc=0`｜`test:unit` **381 文件 / 5,186 例全过**｜`test:integration` **30 文件 / 239 例全过**。
  ⇒ 今天的 12 笔本地提交（全是 `EVOLUTION-ROADMAP.md`）背后，**HEAD 的代码与线上那份是同一份且测试全过**，
  下一批带行为的改动可以放心站在这个基线上。
· **两条刻意没做，别把这条读数读大**：
  ①**没跑 e2e** —— 已知 E2E-016 是"按世界实现而变"的真停摆类（私服/官服差异），跑一次红一次并不可比
  （债单里有案），要动 e2e 时按那条口径单独判；
  ②**没跑 `npm run build`** —— 构建会重写 `dist/main.js`，而我现在的本地 dist 与线上**逐字节同号**（`ea4c69da6f8b`），
  这份可比性正是 #85 判据窗成立的前提（A/B 必须证明被测二进制没变）。所以本窗结束前不 build。
· 顺带一条窗完整性读数：`git fetch origin dev` ⇒ `HEAD..origin/dev` **为空** ⇒ 并行会话没有在我身后推过码
  ⇒ 这个判据窗是**单二进制窗**（线上仍是 `ea4c69da6f8b`，与 01:48Z 认回的那次一致）。

### R140（10-03 02:18Z）把一条"被我写进注释的常数"改回它本来的形状（注释级，零行为改动）
· 起因：`event-log.ts:61` 写着"环寿命 ~755 拍 < verifyDelay 1,500 拍 ⇒ **事后取证取不到**"。
  今天 `ring-dump` 打出的是"**500 条，跨度 83389604→83390727 = 1,123 拍**" ⇒ 与那条常数对不上。
· 核到根：环的容量是**按事件数**定义的（`segment-store.ts:42 EVENT_RING_CAPACITY = 500`）
  ⇒ 时间跨度 = 500 ÷ 事件密度，实测两发 755 / 1,123 拍 ⇒ 密度 0.66 与 0.445 条/拍。
  ⇒ "**取不到**"是当时那发密度的产物，不是构造性质：密度低于 ~0.33 条/拍时环就能回看一整个 verifyDelay。
· 这条注释是有消费者的：它决定下一轮**要不要尝试事后取证**。留着"取不到"就会让人直接放弃一条本来可行的路
  （与"注释里不再声称某阈值触发某评估"那次同族 —— 未核实的数字一旦被写进注释，就会被当事实引用）。
· 已改注释并在里面留下两个实测样本与算法；`typecheck rc=0`，diff 逐行确认只碰注释行。
  **不单独部署**（注释级、随下一个带行为的批次走；且 build 会剥注释 ⇒ dist 大概率逐字节不变，
  这正好保住"#85 单二进制窗"依赖的本地 dist == 线上一条）。
· 顺带把两条"读码结论"升级成"有用例背书"（同一轮里查的）：`tests/unit/economy/tuning-closed-loop.test.ts`
  `:537` 断言"连续 3 次回滚 → 冻结 + 复位 CONFIG 基线"、`:580` 断言"验证通过（cleared 无回滚）→ 重置 rollbackCount"
  ⇒ 我在 R135 讲的冻结后果与"计数会被一次成功验证清零"不再是读码推断。

### R141（10-03 02:2xZ）两件：R137 补完最后一层，另开 **#89 自进化 L1 的 override 是单向的**

· **R137 的阈值来源补核（我之前只读了 DEFAULT，这是一层漏核）**：`empire-strategy.ts:83-92` 的合并链是
  `DEFAULT_POSTURE_OPTIONS → CONFIG.posture → selectEnvBaseline(...) → resolveStrategyOverrides(...)`。
  逐层查：`CONFIG.posture` 里 `colonizeYoungestFloorRcl=5`、`colonizeSponsorRcl=7`（`config/index.ts:1179,1184`，与 DEFAULT 同值）；
  全仓 `grep` 只有 `posture.ts` 与 `config/index.ts` 出现 `colonize*` 两个键 ⇒ **环境基线层不可能改它**；
  运行时层实测 `kernel.tuning.strategyOverrides = {posture.minDwell:1400@82993339, posture.warPatience:8000@83287039}`
  —— **没有任何 `colonize*`/`expand*` 键**。
  ⇒ "唯一假项 = `youngestMature`（要 5、幼房 4）"这条现在是**四层全核过**的结论，不是默认值推断。
  顺带把输入口径也核了：姿态的 `rcl`/`storageEnergy`/`hasLiveThreat` 取 **snapshot**、
  `economyPressure`/`colonyState` 取 **Memory**（`empire-strategy.ts:47-62`）⇒ 我探针里那两处正是按这个分法读的，
  没有"读的不是同一个量"。
· **#89（新案，属自进化层的形状缺陷，不是阈值问题）**：`strategyOverrides` **只进不出**。
  证据三条：①`StrategyOverrideEntry` 形状只有 `{value, adjustedAt, reason}`（`global.d.ts:1064-1071`）**没有到期字段**；
  ②全仓唯一删除是 `migrations/late.ts:285`（一次性迁移），③`strategy-reviewer.ts` 里读 `currentOverrides` 的**两处**
  （`:179`、`:191-193`）都只服务**冷却判断**（`STRATEGY_COOLDOWN_TICKS`，防重写），没有任何"复核后撤销/回退基线"的分支。
  ⇒ 一个因"姿态 1000 拍内切换 4 次"而抬上去的 `minDwell`、或一个因"thrashing"而抬到 8000 的 `warPatience`，
  **会永久生效**，即使造成它的那个瞬时状态早就没了。
  ⚠️严重度按第二发读数说：**今天没有坏结果**（`posture=fortify`、`since=83389159` ⇒ 切换照常在发生），
  立案的是**通路风险**——`expansionAllowed` 的三个合取项之一正是 `posture !== "war"`，
  而"能不能退出 war"由 `warPatience`/`minDwell` 决定 ⇒ **一条永不撤销的自改可以让扩张授权长期为假**。
  这与 `roleBounds` 不同：那套有 `pendingValidation` + verify + rollback + freeze；这套**只有护栏没有闭环**。
  同一族的第三次（#60 产能棘轮、#68/#79 ↑ 棘轮、本条 override 棘轮）⇒ **值得在 L1 里升一条通则**：
  凡自进化写的量，必须与"写它的哪个瞬时条件"同时被撤销；否则撤销条件要写进立案判据。
  修法规格（**未动码**，按规矩不单独换码）：给 entry 加 `expiresAt`（或 `validWhile` 谓词的数值化条件），
  在 `empire-health-system.ts:263-268` 写入循环之前做一次过期摘除；测试要有一条"过期后回落 DEFAULT/CONFIG 值"。
· **一处记忆与实测冲突，标出来免得下一轮引用错的那条**：`design-lens-double-meaning-collapses` 案例 19
  写的是"G4 仪器 τ≈2,500 拍 ⇒ 扩张期 G4 **永久显绿**"。今天读的是当前码：`α=0.02 × interval=100` ⇒ **τ=5,000 拍**，
  且现读门 3.97 > 底层 −0.20 ⇒ **门在向下衰减、当前是红**。两说法不能同时成立（案例 19 早于 `6325d96` 那台长视界仪器）。
  ⇒ 判 G4 一律以 R138/R141 为准；"扩张期它会滞后显绿"这个方向性提醒仍可保留，但**数字要按 5,000 拍重算**。

### R142（10-03 02:2xZ）**撤掉我今晚所有墙钟 ETA：拍长实测是 2.3~3.8 秒/拍，不是我一路用的 2 拍/秒**
· 触发：`window2` 的第一读与 `pass85` 的历史行两两点差出来 ——
  `83390784@01:56:23Z → 83391184@02:21:32Z` = 400 拍 / 1,509 s ⇒ **3.77 s/拍**；
  再过四分钟 `83391284@02:25:24Z` = 100 拍 / 232 s ⇒ **2.32 s/拍**。
  ⇒ 拍长**本身就摆**（老口径早就写过"同一进程内 2.4~4.8 秒/tick 都会摆"），
  而我 R135/R137 里每处"几小时/几点几分"都是**按 2 拍/秒心算的**（快 5~7 倍）。
  ⚠️这属于我记忆里那一族的**第三次**：拿一个没测过的常数去换算自己判据的时间轴。
· **受影响并被本节作废的说法**（tick 口径全部不变，只有墙钟错）：
  ①"#85 最早 PASS 读数 ≈03:07Z" ⇒ 目标 tick `83399266` 不变，**实际 ≈07:0x–10:5xZ**（按 2.3~3.8 s/拍）。
  ②"幼房 RCL5 ≈03:2xZ（16/拍）/ 05:3xZ（6.15/拍）" ⇒ 同法换算 ⇒ **最好 ≈08:0x–12:0xZ，均值情形要到明天**。
  ③"轮询器盯到 ~04:37Z 够用" ⇒ **不够**：`pass85-at-9000`(40×300s) 与 `rcl5-watch`(26×600s)
    都会在目标 tick 之前收工，**留下的会是 PENDING 而不是结论**。
· 处置（**不编辑运行中的脚本**，另挂后继）：`tmp/tools/official/window2-85-rcl5.sh`（PID 41487）
  合并两案，46 轮 × 900 s ≈ **11.5 小时** ⇒ 覆盖到 ≈13:5xZ，两种拍长下都够；
  判据**逐字沿用**（#85 三态 + RCL5 命中即 `youngestMature` 自摘），日志 `tmp/observe/window2.log`。
  ⚠️它的 EXIT 行会写 `done85/doneRcl` ⇒ **看到"没读数"要区分"没到 tick"与"没发生"**，前者要续接不是结案。
· 带走一条通则（进 §4 的规矩）：**凡把 tick 换算成"几点"，必须先用两次 `Game.time` 现场标定拍长，
  并把换算写成区间而不是时刻**；单次心算的墙钟时刻一旦进了判据/交接卡，就会成为别人"以为窗过期了"的理由。

### R143（10-03 02:3xZ）#89 落地（读时过期）——**未部署**，随下一个带行为批次走
· 实现（选了最小形状）：**不改 Memory 结构、不加 `expiresAt`、不动写路径**，
  只在消费侧过期：`strategy-reviewer.ts` 导出 `STRATEGY_OVERRIDE_TTL_TICKS = 3 × 复盘冷却(5,000) = 15,000 拍`
  与判别式 `isStrategyOverrideLive(entry, tick)`；`empire-strategy.ts:resolveStrategyOverrides(overrides, ctx.tick)`
  跳过过期条目 ⇒ 有效值回落 `CONFIG.posture`/`DEFAULT`。
  为什么不加字段：加字段要给已存在的持久对象补形状（`??=` 那类静默 NaN/失效风险，我踩过），
  而 `adjustedAt` **本来就在** ⇒ 一个减法就能表达"自改必须被持续重新争取"。
  为什么取 3 个冷却而不是 1：条件间歇成立时不该在两次复核之间闪断（复核按 ≥1 冷却重写 ⇒ 会自动续期）。
· **反向实验（不跳过这个就不算测过）**：把判别式改成恒 `true` 后只跑本用例 ⇒
  **恰好 3 红**（越界即失效、线上那条 397k 拍前的 `minDwell`、畸形/缺失条目），
  **3 绿**（刚写入生效、边界 `<=` 仍生效、TTL=15,000 常数不变式——它测常数不测判别式，
  变异下必须仍绿，否则说明那条断言放错了位置）。还原后全量：`tests/unit/tuning/` **8 文件 53 例全过**、
  `typecheck rc=0`。
· ⚠️**别把这条当"已生效"**：它只在本地提交里，**线上那份二进制不含它**（本窗是 #85 的单二进制窗，
  我不动部署）。生效后能在现场看到的第一件事：`strategyOverrides` 那两条（`minDwell@82993339`、
  `warPatience@83287039`）会被判过期 ⇒ 姿态参数回落基线 ⇒ 观察点＝`Memory.kernel.strategy.posture`
  的切换节奏是否回到 `minDwell` 的 CONFIG 值所允许的范围（**别期待 Memory 里的条目被删除**，那是写路径的事，本条不删）。
· 端到端未覆盖处（诚实记）：`resolveStrategyOverrides` 是模块私有函数，不为测试导出 ⇒
  "合并链末端真的回落基线"这一步靠代码走查 + 边界判别式，**没有**一条跑 `empire-strategy` 的集成用例。
  要补的话应该走 e2e/集成层，不要为此导出私有函数。

### R144（10-03 02:3xZ）#89 的**机制说错了**，当场改：`warPatience` 管的是"进 war"，不是"退 war"
· 我在 R141/#89 里写的是：「`expansionAllowed` 含 `posture!=="war"`，而『能否退出 war』由
  `warPatience`/`minDwell` 决定 ⇒ 一条永不撤销的自改可长期钉住扩张授权」。把两个参数各自的消费者读完后：
  - **`warPatience` 只出现在"升级"那一侧**：`posture.ts:183-188`，`prevPosture==="fortify" && dwellElapsed >= warPatience
    && avgPressure <= warMaxPressure && !anyRecovery` ⇒ 它是**从 fortify 进入 war 的最短忍耐**。
    调大它 = **更难宣战**（更 pacifist），不是更久作战。
  - **退出 war 走的是另一条**：`posture.ts:173-178`，靠 `warExitPatienceTicks` + `warMaxPressure`（经济止损），
    且注释明写"**不等 minDwell**"。⇒ `warPatience` 与"退不出 war"无关。**这句我说错了。**
  - **真正能钉住 `posture==="war"` 的是 `minDwell`**：`posture.ts:193-197`（威胁消退分支）
    `if (dwellElapsed < minDwell) return finalize(prevPosture …)` ⇒ 若上一态是 war 且驻留未满，
    **敌人已经走了它还留在 war** ⇒ 这才是掐住 `expansionAllowed` 的那条路。
· **严重度因此重排，不是取消**：
  ①`minDwell`（线上现值 1400，写在 82,993,339）——机制成立，但**量级小**：1,400 拍 ≈ 1.5~2 小时（按实测拍长），
    不至于"长期"。⇒ #89 的"长期钉住扩张"这句要降格成"**可延长 de-escalation 一段有界时间**"。
  ②`warPatience`（现值 8000，写在 83,287,039）——不影响扩张，但**影响竞争轴**：
    被反复骚扰时要 **8,000 拍 ≈ 8.5~17 小时**才授权宣战（防御侧 `threatRecent` 立即转 fortify，不受影响）。
    ⇒ 真正该记的风险是"**一条永不撤销的自改让帝国系统性低升级**"，不是"扩张被钉死"。
  ③两条都还在**有界**范围内：`bounds.ts:146-150` 给 `warPatience` 的 ceiling=10,000、floor=2,000
    ⇒ 棘轮的"幅度"被边界卡住，问题只剩"**永久化**"这一维（这正是我 #89 的修法处理的那一维）。
· **代码不用改**：`isStrategyOverrideLive` 的 TTL 处理的是"永久化"这一维，与上面哪条路径被影响无关 ⇒
  `1bc67c9` 的修法仍然对症；**要改的是我给它的论证**（错论证会在下一轮把人引去查"退出 war"那侧，白跑一趟）。
· 带走一条（同一族的第四次自我修正，规则已写在记忆里，这里只是又犯了一次）：
  **写"参数 X 通过路径 Y 影响结果 Z"之前，必须把 X 的每个消费者读一遍**——我这次只读了 `finalize`
  与合并链，没读 `warPatience` 的两处调用点，就把它安到了"退出"上。

### R145（10-03 02:3xZ）#90：**对手可以用"抖"来驯化我的宣战闸**（登记为观察项，不是缺陷）
· 机制（全部来自刚读完的代码，非推测）：`strategy-reviewer.ts` 的规则 1「姿态振荡 → 抬 `minDwell`」
  与规则 3「Thrashing（姿态振荡型）→ 抬 `warPatience`」；振荡判据是 `POSTURE_OSCILLATION_WINDOW=1000` 拍内
  切换 ≥ `POSTURE_OSCILLATION_THRESHOLD=3` 次（`strategy-reviewer.ts:61-64`）。
  而 R144 已确认 `warPatience` 是**从 fortify 进入 war 的最短忍耐**（调大 = 更难宣战）。
· ⇒ 一条**被动反馈**：来犯者若用"打一下就走"的脉冲式骚扰，姿态会在 fortify/war(或 develop) 之间反复切换
  → 判为 thrashing → 复盘抬升宣战门槛（现值 8000，默认 5000，ceiling 10000）→ 我更不容易授权反击。
  **骚扰者不需要打赢，只需要让我频繁切换，就能把我调成不反击。**
· 但要公平地记下**这条设计的正面**：战争很贵（R4 止损、`warMaxPressure`、危机撤资都在），
  "被抖就不轻易宣战"多数时候是**对的**；防御侧完全不受影响（`threatRecent` 立即 `fortify`，塔照打——
  10-02 那次真实入侵 10 拍清除就是这条路径）。所以危害面只在"**该反击时不反击**"这一维。
· 现状与边界（别夸大）：①`#89` 的 TTL（`1bc67c9`）**已经把"永久化"这一维关掉**了——
  最迟 15,000 拍（≈11~26 小时）回落到 `CONFIG.posture=5000`，除非骚扰持续、被复核重新争取；
  ②幅度有硬顶 `ceiling=10,000` ⇒ 最坏是"多忍 5,000 拍"，不是"永不宣战"。
  ⇒ 所以 **#90 不立案修改**，只登记为**观察 + 判据**：
  · **要看什么**：下一次敌情窗口里 `kernel.strategy.posture` 的**切换次数/千拍**与
    `strategyOverrides["posture.warPatience"].value` 是否同时上抬（同向 = 反馈在被触发）。
  · **什么时候才算真问题**：出现"某房持续被同一对手拆（有战损或 `warPressureTicks` 长期 >0）
    而 war 从未被授权"——那才是门槛被驯坏的证据；只是"切换多了、忍得久了"不定罪。
  · **若将来定罪**：正确的修法方向是给振荡判据加"**是否伴随真实战损**"这一维（有战损的切换不是抖动，
    是交战），而不是去调 `warPatience` 的数（那又变成降门槛换绿灯）。

· **R146（02:39Z）#89 的那处"未覆盖"补掉了**：`resolveStrategyOverrides` 加了 `export`（带注释说明为什么导出来），
  新用例 `tests/unit/strategy/override-merge.test.ts` 断言的是**合并链真实形状**
  `{...DEFAULT, ...CONFIG.posture, ...resolved}`，不是我手拼的夹具。
  反向实验（去掉那条 live 检查）⇒ **恰好 3 红**（过期回落／混合只摘过期／线上那两条在本拍都判过期）、
  **3 绿=控制组**（新鲜 override 仍生效并剥前缀、畸形条目跳过、无 override 逐字不变）。
  ⚠️为什么不走集成/e2e：`empire-strategy` 被 `safeRun` 包住会吞异常 ⇒ 那种用例可能"绿着什么也没断言"。
  全量 unit 与 typecheck 见本笔提交；**仍未部署**（#85 单二进制窗没结束）。

### R147（10-03 02:4xZ）#88 的第二发读数：净流≈0 **不是"没盈余"，是盈余正在被幼房吃掉**
· 先记一个仪器陷阱（我这次差点又被它骗）：`rooms.*.phase.storageEnergyPrev` 相隔 30 秒两读**一字不差**
  ⇒ 它是**锁存值**（按房核算节拍写，不是每拍写），所以"两读相同"不等于"这两分钟没动"。
  ⇒ 真正可用的两点是：`01:58:48Z 探针（console 直读 storage）882,314 / 61,238`
  与 `02:41:50Z 锁存值 877,828 / 64,660`，分母用 `window2` 自带的拍钟（`83390883 → 83391484` ≈ 601 拍）。
· **方向（这才是 #88 缺的那一块）**：核心房 storage **−4,486 ≈ −7.5/拍**、幼房 **+3,422 ≈ +5.7/拍**，
  两边量级相近 ⇒ 帝国的存量正在**从核心房搬到幼房去建设**，不是"堆满不动"。
  ⇒ 所以 G4 读的 `净流 ≈ 0`（门 Σ=3.97、底层 Σ=−0.20）的成因是：**盈余正在被花掉**。
  我 R138 那句"近满仓 ⇒ 只能瞬时满足"结论不变，但**理由要换掉一半**：
  关键不是"库存快满了"，而是"**这个帝国正处在第二房的建设期，建设期净流为负是正常且正确的**"。
· ⇒ 给 #88 的可选面补第 ④ 项（**属人，我没动任何阈值**）：
  **给"幼房建设期"一个 G4 口径豁免/或改成"扣除在建投入后的净流"** ——
  现在的门槛等于要求"一边给幼房砸能量、一边还在往上攒"，这两件事在物理上互相抵消。
  ⚠️先例只当**判断形状**引用，别当"已经有这个机制"：`System.budgetExempt`（`kernel.ts:143`）处理的是
  **CPU 调度**层"把让位闸挂在观测活动上=自败回路"，与能量净流不同域；**经济侧今天没有任何建设期豁免**。
· 顺带两条第二样本级的确认：
  ①**快仪又摆了一次符号**：核心房 `economy.nf` 从 01:58 的 **−206（−2.06/拍）** 到 02:41 的 **+999（+9.99/拍）**，
    幼房 +186 → +797。⇒ R134 那条"三台仪器连符号都不一致"今天在同一对房上复现第二次，
    也再次说明**判"买得起"必须看长视界那台（G4 吃的 `gateNetFlow`），别看 `nf`**。
  ②**拍长第三次标定**：`83391284@02:25:24Z → 83391484@02:40:27Z` = 200 拍 / 903 s ⇒ **4.52 秒/拍**
    （此前 3.77、2.32）。⇒ R142 的"按实测拍长换算"要按 **2.3~4.5 秒/拍**这个带用，
    #85 的目标 tick 83399266 换算到墙钟是 **≈06:3x–12:3xZ**（比 R142 给的带再宽一档）。

### R148（10-03 02:4xZ）**#89 生效后会把帝国调得更"敢打"——先把这件事摆出来，别让它成为部署后的意外**
· 现场两条 override 与人类设定值逐项对比（值都读自代码/`Memory`，不是推算）：

  | 参数 | 线上 override（写入拍） | `CONFIG.posture` / DEFAULT | 过期后的**方向** |
  |---|---|---|---|
  | `posture.minDwell` | **1400**（@82,993,339） | **1000**（`config/index.ts:1168`、`posture.ts:61`；另 `:1155` 的 200 是 agenda 的，刻意解耦，别拿错） | 姿态驻留**缩短 400 拍** ≈ 15~30 分钟（按 2.3~4.5 秒/拍）⇒ **降级更快、阻尼更小** |
  | `posture.warPatience` | **8000**（@83,287,039） | **5000**（`config/index.ts:1164`） | 从 fortify 进 war 的最短忍耐**降 3,000 拍** ≈ 1.9~3.8 小时 ⇒ **更早授权进攻性战争** |

· ⇒ **两个方向都是"更活跃/更具攻击性"**。这不是我在调人的闸：两条 override 都是**自进化层自己抬上去的收紧**，
  我的 TTL 只是把**人设定的 CONFIG 值恢复**回来。但效果上确实让 bot 更可能先动手，所以按规矩（不制造战争证据、
  战争很贵）把它写成部署前须知，而不是部署后解释。
· **如果人类其实更想要那份克制**：正确动作是把 `CONFIG.posture.warPatience` 直接调高（人的决定、进配置、可读可diff），
  **而不是**依赖一条"永不撤销的自改"当代替人的决定 —— 后者正是 #89 的病。
· **预期副作用（设计如此，别当回归）**：`minDwell` 会呈锯齿——抬到 1400 → 过期回落 1000 → 再被振荡判据抬回去。
  这就是"自改必须被持续重新争取"的代价。若锯齿的抖动不可接受，说明该改的是**振荡判据本身**
  （R145/#90 已预留方向：加"是否伴随真实战损"那一维），不是把 TTL 取消。
· **部署后可读到的签名**（给下一个推批次的人，一句话即可验收）：
  `Memory.kernel.tuning.strategyOverrides` 两条**键仍在**（本改动不删条目）；
  有效值改为 `minDwell=1000 / warPatience=5000` ⇒ 要看的是行为（切换节奏、war 授权时机），
  别拿"键还在"当"没生效"，也别拿"键还在"当"我改了写路径"。

### R149（10-03 02:4xZ）#81 的第二发读数：**它此刻不是"防线 vs 发展"的取舍**，别让它留在人的决策清单上
· 起因：#81 挂着"幼房一半收入维持 44 只 rampart 外壳、同窗升级零进账"已经一天多，
  而这条一直在人的请示表上占一格。按"旧缺陷标题会引去修已经修好的东西"的规矩，我回去重测。
· 两窗实测（`rooms.W38S56.economy.bk`，注意 **`bk` 只列非零键** ⇒ 缺键=该窗为 0，不是"没记"）：
  `01:58Z {harvested:1000, upgraded:800}`、`02:41Z {harvested:910, upgraded:800}`
  ⇒ **两窗都没有 `repaired` 键**（`resource-ledger.ts:26` 的桶名就是 `repaired`）
  ⇒ 幼房此刻把 booked 收入的 **~80% 给了 controller，creep 修筑记账为 0**。
  ⇒ 所以此刻"发展 vs 防御"这架天平**是偏向发展的**，#81 描述的那个冲突今天不在场。
· ⚠️两堵我自己差点撞上的墙（都是本项目已定案的口径，写下来防止下一轮再撞）：
  ①**`min()` 血量下降不能当"没在修"的证据**——筑防探针里那个最低值是**维修队列的队尾**，是结构不是症状
    （R126-128 已为此翻过一次判断）。我看到 `8501→7601` 就想说"rampart 在衰减 ⇒ 没预算修"，那是**同一把错第二次**。
  ②**塔修墙记 `towerSpent` 不记 `repaired`** ⇒ "creep 修筑为 0"证不了"外墙没被维护"，
    只能证"builder/upgrader 这一路的能量没花在修筑上"。所以本条结论停在**账本口径**，不升到"物理维护状态"。
· ⇒ **改判**（措辞按此换，别按旧标题动手）：#81 从"请拍防线 vs 发展"降为
  **条件观察项**：当某窗 `bk` 里 `repaired`（或核心房 `towerSpent`）重新占上收入的大头、**且同期 `upgraded` 掉到 0** 时，
  那条取舍才回到场上；届时它才配占人的一格。今天它不配。
  ⚠️不要为了验证这条去**制造**修筑开销，也不要因此动任何防御/维修阈值。
· **指针（不改历史条目，避免与并行会话抢同一段文本）**：§3.5 里 **#81 那一格自 10-03 02:4xZ 起按 R149 作废**——
  请示面因此只剩 **G6**、**#88（四选项）**、**#76 卖能定价**、**#61 孵化预留语义**、**#73 G2 输入**、
  **#77 计划 TTL / wall-vs-rampart 模板**、**#78 重占排除项**。读到 §3.5 的 #81 时请直接跳到 R149。

### R151（10-03 02:5xZ）摘掉一个**幽灵仪器**：`netFlowMean_d` 在当前代码里根本不存在
· 触发：R147 我在 #88 里留了一句"`netFlowMean_d` 这次取不到 ⇒ 按未验处理"。刚才把这条收口：
  `grep -rn "netFlowMean|nfm|Mean_d" src/` ⇒ **零命中**；`global.d.ts` 的 room economy 块只声明了
  `bk`（:177）与 `ws`（:186）（外加运行时确实在的 `nf`）。
  ⇒ **`netFlowMean_d` 不是"取不到"，是"当前代码没有这个字段"**。
· 它大概是 **#14 那次换装前的旧名**（老单原文：「就绪度改用独立长视界净流仪器（`6325d96`）」）——
  今天的长视界那台叫 `Memory.kernel.gateNetFlow`（R138 已定死：每房 `mem.nf/100` 再过 `α=0.02×100 拍` 的慢 EMA）。
  ⚠️这是**推测的谱系**，不是我证出来的：要坐实只能去翻 `6325d96` 的 diff（本轮不做，留给需要时一次性核）。
· ⇒ **连带改两条已在流通的说法**：
  ①**"三台仪器连符号都不一致"里的"第三台"是幽灵**：今天真实存在的只有
    **快仪 `economy.nf`（×100 存储）** 与 **门 `kernel.gateNetFlow`（G4 吃的那台）**，
    外加 `economy.ws` 那个漂移数组（不是净流读数）。R134/R138/R147 里凡引 `−38.4/拍` 那个数，
    **出处都不可复现 ⇒ 从 #88 的证据链里撤掉**（#88 的论证本来就不靠它：靠的是门 Σ=3.97 vs 底层 Σ=−0.20 + 那条满仓算术）。
  ②我记忆里那句"`nf` 与 `netFlowMean_d` 不可互换用于 G4"（同一族的旧口径）**要改写成
    "`economy.nf` 与 `kernel.gateNetFlow` 不可互换"**——名字记错会让下一轮去 grep 一个不存在的键、
    再把"grep 不到"读成"仪器没接线"（这一族我今年犯过两次：`overflow_loss` 全仓无写者那次同理）。
· **纪律带走一条**：引用一个读数之前，先 `grep` 它**在当前 src 里的写者**；
  只在自己记忆里存在、代码里查无此键的数字，**等于没有出处**，不该出现在请示面的证据列里。

### R152（10-03 02:5xZ）**撤回 R151 的过头部分**：`netFlowMean_d` 不是幽灵，是**观测器算出来的量**
· R151 我说"当前代码没有这个键 ⇒ 出处不可复现 ⇒ 从 #88 撤掉"。后半句**错了**：
  `grep -rn netFlowMean tmp/tools/` 命中 **`tmp/tools/official/observe.mjs:319`**
  ```
  netFlowMean_d = round1(mean(最近 20 个经济环样本的 s.d))   // 按房，数据来自 RawMemory **段 3** 的 economy 环
  ```
  ⇒ 它**从来就不是 `Memory.rooms.*` 的键**，所以 `peek rooms.<r>.economy.netFlowMean_d` 取不到是**必然的**——
  我把它读成"这仪器不存在"，是**在错的地方找对的量**（同族：拿 heap 的名字去 Memory 里找）。
· **仍然成立的两条**（这才是 #88 真正需要的口径）：
  ①它**不可与 G4 的输入互换**：`netFlowMean_d` = 段 3 经济环最近 20 个样本的均值；
    G4 吃的是 `kernel.gateNetFlow`（每房慢 EMA，α=0.02、interval=100 ⇒ τ≈5,000 拍）。两个视界不同、算法不同、存放位置也不同。
  ②引用它**必须带上"观测器派生 + 按房 + 20 样本窗口"这三段出处**，且**不能靠 peek 取**（只能跑 `observe.mjs`）。
· ⇒ **净结论**：`−38.4/拍`、`56.8` 这类数**不必作废**，但每次引用要重跑 `observe.mjs` 现场取，别引记忆里的旧值
  （段 3 环会滚，值会随窗口走）。R151 里"从 #88 撤掉"改为"**保留为对照读数，但注明它是观测器派生的中视界均值，不是 G4 那台**"。
· ⚠️纪律升级（把 R151 那条改对）：判"某个读数没有出处"之前，**grep 范围要覆盖 `tmp/tools/`（观测器与探针也算代码）**——
  只 grep `src/` 就断言"不存在"，会把我**自己写的工具**里的量当成幽灵，进而误删一条合法证据。

### R153（10-03 03:0xZ）**撤掉我今晚另一处过头断言**：#88 的方向"门只会向下衰减"不成立
· 现取（`observe.mjs` 跑通，`rc=0`；前两次的解析失败是因为**我误当它输出单个 JSON 文档**，
  它其实是人读报表里嵌 JSON 片段 ⇒ 只能 grep 字段，别 `json.loads` 整份）：
  `netFlowMean_d` 两间房 = **23.4** 与 **4.5**（⚠️这次没抽到房名标签 ⇒ **不作归属**，
  更**不要**拿这两个数去算 G4 的 Σ——归属未定的读数不进判据）；`secondsPerTick = 2.63`（第 4 发，仍在我 2.3~4.5 带内）。
  另：报表头给出 **`G6档位=tight@83387005`** ⇒ `since` 已从 09-30 的 `83323796` 更新过（tier 判读只看 `tier`+`since`）。
· **为什么要撤 R138 的那句**：R138 我写"门 Σ=3.97 > 底层 Σ=−0.20 ⇒ 只会向下衰减 ⇒ **G4 不会自己变绿**"。
  但底层快仪在两读之间**翻了正号**：02:07Z `nf = 核心 −2.06 / 幼房 +1.86`，02:41Z `nf = 核心 +9.99 / 幼房 +7.97`
  ⇒ Σ 由 −0.20 变 **+17.96/拍**。τ≈5,000 拍的慢 EMA 面对这个方向**是会往上走的**。
  ⇒ 正确说法：**G4 的方向不确定**——取决于净流能否在 τ 的时间尺度上（≈3.7~6.3 小时）持续为正；
  我原来的"只会向下"是把**一个采样相位**当成了趋势（正是我自己记过的那一族：被闸筛过/单相位的样本≠常态）。
· **不变的部分**（#88 仍然成立，靠的是算术不是相位）：门现值 3.97 在门槛 5 之下；本服 storage 不随 RCL 分级
  （1,000,000）+ 核心房已 88% ⇒ 余量 117,686 ⇒ **持续 ≥5/拍 积累 3.3 小时就满仓**；RCL8 controller 被 15/拍钉死
  ⇒ 建设期净流与"继续积累"这两件事互相抵消。**所以 #88 的四选一照旧要人拍**，只是我不能再预言"它不会自己变绿"。
· **留给下一轮的可检验读法**（判方向而不是猜）：连续 ≥3 次、每次隔 ≥1,500 拍取 `kernel.gateNetFlow` 的 Σ，
  看**差分符号是否稳定为正**；稳定为正且量级 ≳18/拍（=当前底层 Σ）⇒ 门会在数小时内翻绿，届时 #88 的紧迫性下降；
  来回翻 ⇒ 印证"建设期与门槛互斥"，走第④个可选面。**别用单发 gateNetFlow 判趋势。**

### R154（10-03 04:1xZ）**G4 现场翻绿了**：`Blocked=G0+G6` —— #88 的紧迫性要按这个重排，但先别当成"门槛被满足"
· 权威判定（不是我的推算，是 `failedGates` 本身）：`tick=83392984` 的 dashboard ⇒
  **`Blocked=G0+G6`**，`failedGates` 只剩 `G0: posture expansionAllowed(v=false)` 与 `G6: CPU tier(v=tight)`。
  对照 01:53Z 同字段是 **`Blocked=G0+G4+G6`** ⇒ **G4 在这两个多小时之间从红翻绿**。
  仪器侧吻合：门 `gateNetFlow Σ = 4.007 + 1.078 = 5.085` ≥ 门槛 5（02:07Z 那发是 3.97）。
· ⚠️**当场又抓到我自己一次**：我上一条命令里说"底层快仪 Σ=−4.93/拍"，**22 秒后**再读幼房 `nf` 已经从
  `260`（+2.6/拍）跳到 `1742`（**+17.4/拍**）。⇒ 快仪在**秒级**被一次孵化/脉冲改写，
  这正是我自己记过的那一族（"一次 2000 能量的孵化落进被采样的 50 拍窗就让净流掉 ~40/拍"）。
  ⇒ **今晚第三次**：凡拿 `nf` 单发当速率的句子都不作数；只有 `gateNetFlow` 与 `failedGates` 才是判定面。
· ⇒ **#88 的状态改判（不是撤销）**：
  ①"G4 不会自己变绿"我已在 R153 撤掉；现在更进一步——**它已经绿了**，所以 #88 不再是"扩张的当前阻塞"，
    而是"**这条门槛在被裁决量的噪声上翻，因而不能当'买得起'的证据**"。
  ②真正挡着扩张的只剩两件：**G0**（幼房 RCL4<5，≈12:1x–14:0xZ 自达，R137/R141）与
    **G6**（`tier=tight@83387005`，杠杆只有 `CONFIG.remote.maxOperations`）——**G6 因此是唯一一件"非自达、且属人"的阻塞**，
    请示优先级应当升到最前（它现在一个人扛着扩张）。
  ③"满仓 3.3 小时"那条算术**不变**（它不依赖门是红是绿），但它现在的作用变了：
    它说明的是"门为什么会在 5 上下反复翻"，而不是"为什么过不了"。
· **耐久性判据（已挂，不靠我在场）**：`tmp/tools/official/g4-durable-watch.sh`（PID 54198，
  6 发 × 5,700 秒 ⇒ 发间隔 ≈1,500 拍，覆盖到 ≈12:1xZ，日志 `tmp/observe/g4-durable.log`）。
  三态预先写死：**DURABLE-GREEN**（≥5/6 发不含 G4 ⇒ 上面①要再改，净流确实撑得起来，交回 owner 重排 #88）/
  **OSCILLATING**（交替 ⇒ #88 成立，走第④个可选面：建设期口径）/ **RED-AGAIN**（≥5/6 含 G4 ⇒ 04:15Z 这发是相位产物）。
· **顺带把判据窗续上了**：`window2`（末轮 ≈13:5xZ）之后又按实测拍长 3.76 秒/拍挂了后继
  `window3-85-rcl5.sh`（PID 54116，48×900s ⇒ 覆盖到 ≈16:1xZ）——
  因为 RCL5 的估计已滑到 12:1x–14:0xZ，**原来那一支可能刚好采不到**（"末行是否覆盖 due tick"这条规矩又救了一次）。

### R156（10-03 04:2xZ）路径失败监视项收口：此刻是**干净负例**；顺带记下我连错两发的探针形状
· 结论（判据是我自己早先立的："同一只 `consec > 100` 才去查寻路/traffic"）：
  `global.pathFailureTracker` 在 `tick=83393108` **size=9、`consecutiveFailures>0` 的条目 0 条、最大失败数 0**；
  最"旧"的一条是 `W38S56:carrier-W37S58-0-83392073-89`，`lastSuccessTick` 距今 **75 拍**——
  **低于 100 拍的门槛**，且它 `consecutiveFailures=0`（没有失败在累积，只是这 75 拍没记到成功路径 ⇒ 像静态往返/待命，不像卡住）。
  ⇒ **不立案**。这条一直挂在巡检备注里的"期望自检 pathFailure 5 条"到今天是**消退的**，不需要人。
· ⚠️**过程里我连错两发，形状没先验**（第三次犯同一族，写死以免再犯）：
  ①第一发 `Object.keys(tracker)` ⇒ 得到 `keys:0` 我差点当成"全清"——但它**是 `Map`**（`global-cache.ts:503`），
    `Object.keys(Map)` 恒为 `[]` ⇒ 那是**测量假负**；
  ②第二发字段名用了 `.consec`/`.failAge`（老名字），真名是 `.consecutiveFailures`/`.lastSuccessTick`
    ⇒ 又得到 `maxFail:0` 这种"看着像结论"的 0。
  救回来的是我在第二发里顺手多打了一个 `sample`（把前 3 条原样 JSON 打出来）⇒ 才看见真形状。
  **规矩**：读 heap 里的容器**先读类型**（`Map`/`Set` ⇒ `.size`+`.forEach`，不是 `Object.keys`），
  **再打 1–3 条原样样本**确认字段名，然后才做聚合计数；
  凡是"聚合结果全是 0"的读数，**默认怀疑形状错**，直到样本证明字段名对。
· 一句诚实话：前两发的错误如果我没回读样本，就会把"仪器读法坏了"记成"帝国此刻没有寻路问题"——
  那是一条**看起来很好消息的假阴性**，比坏消息更容易被留在台账里。

### R157（10-03 04:2xZ）G6 的算法算清了：**我此前给的"唯一杠杆"单独不够**（并修掉记忆里一条已过时的"驻留不可达"）
· 权威读数（`Memory.kernel.stats.cpuRate`，路径我前一次猜错过——按消费者读才对）：
  `total=14.47/拍`、`windowTicks=6619`、`unsampledTicks=0` ⇒ `pickCpuUsagePerTick` 取的是**逐拍均量**（可信分支），
  不是那台偏高的 `cpuAvg10=18.4`。`cpuByHome` 此刻 `3.669 + 2.489 = 6.16/拍`（creep 侧）。
· 分档公式（`capacity.ts:104-110` + `CONFIG.capacity`）：`limit = min(Game.cpu.limit, tickLimit)`，
  `headroom = 1 − usage/limit`；comfortable 要 `usage ≤ 0.6·limit`，tight 上界 `0.8·limit`。
· **不用探 tickLimit 就能把它夹出来**：现态 `tier=tight` ⇒ `0.6 < usage/limit ≤ 0.8` 且 `usage=14.47`
  ⇒ **`limit ∈ (18.1, 24.1]`**；又 `limit = min(20, tickLimit) ≤ 20` ⇒ **`limit ∈ [18.1, 20]`**
  ⇒ comfortable 门槛 = `0.6·limit ∈ [10.86, 12.0]` ⇒ **需要砍掉的量 = 14.47 − 门槛 ∈ [2.47, 3.61]/拍**。
· ⚠️**因此更正 #50**：我此前写"唯一杠杆是 `CONFIG.remote.maxOperations`"，而它的实测节省是 **≈2.27/拍**
  ⇒ **落在所需区间的下界之外**（2.27 < 2.47）——**单靠它解不开 G6**，还差 **0.2~1.34/拍**。
  可行的组合（全属人）：砍 ops + 另一处系统侧（`bySystem` 现读 `traffic-manager 2.54`、`snapshots 1.47`，
  这两台占 bySystem 的 64%，而我此前"低于总负载 5% 不立案"的门槛是**单根**的判据，不是"合起来不能动"）；
  或者**接受 G6 与第三房互斥**：加一房至少再吃 `≥2.5/拍 creep + 若干系统侧` ⇒ 14.47 → ~18
  ⇒ **G6 不是"长进去就能过"的闸，是"要么砍负载、要么不开房"的排产决定**。
· ⚠️两条诚实限定：①`total` 是 6,619 拍的均值，砍完之后**它自己要花同量级的窗**才反映变化（别砍完立刻判"没生效"）；
  ②2.27/拍 是我先前单次估的节省，真要按它做决定应重取一发（同一条"速率必标出处"的规矩）。
· **修掉记忆里一条过时结论**：`cpu-total-was-mid-tick.md` 的"300 拍驻留**按构造不可达**（cpuAvg10 是 10 拍一跳的阶梯）"
  —— 那是**换 gate 输入之前**的形态。现输入走 `pickCpuUsagePerTick`（可信分支取逐拍 `total`），
  且 `empire-strategy` 的 `interval: 1` ⇒ **300 拍驻留 ≈ 19 分钟**（按实测 3.76 秒/拍），
  条件是**连续** 300 拍都 ≤ 门槛（任一拍反弹回 tight 就归零，因为代码在 `target===prevTier` 时把 `upgradeTicks` 写 0）。
  ⇒ 判"要不要为 G6 动手"时，**滞回不再是理由**，负载本身才是。

### R158（10-03 04:3xZ）把 R157 的区间换成**实测**：`limit=20` ⇒ G6 要砍的量是确定的 **2.47/拍**
· 探针 `mk=R158A`（tick 83393230）：`Game.cpu.limit=20`、`Game.cpu.tickLimit=500`、`bucket=10000`、
  `generatedAmount=0` ⇒ `capacity.ts` 里 `limit = min(20, 500) = `**20**（我上一发是"由 tier 反推的区间 [18.1,20]"，
  现在是量到的定值）。
· ⇒ **comfortable 门槛 = 0.6 × 20 = 12.00（定值）**，现用 `14.47/拍` ⇒ **需砍 2.47/拍（17.1%）**，不再是区间。
· ⇒ 对 owner 的那句建议就此收紧：**`CONFIG.remote.maxOperations` 的 ≈2.27/拍 节省能覆盖 2.47 里的 92%，
  还差 ≈0.20/拍**（不是我 R157 写的"差 0.2~1.34"）。所以组合方案里"第二块"可以很小——
  但**这块具体从哪来仍属人**（`bySystem` 的 `traffic-manager 2.54`/`snapshots 1.47` 是最大两台；
  我此前"低于总负载 5% 不立案"是**单根**判据，不否决"两台合起来出一小部分"）。
· **顺带一条设计确认（好事，记下免得被误当 bug）**：G6 用 `min(limit, tickLimit)` 而不是 `tickLimit`
  ⇒ **借 bucket（此刻 tickLimit=500、bucket=10,000）不会把扩张闸洗成绿色**。也就是说扩张的 CPU 判据
  是"稳态养得起吗"，不是"这一拍刷得起吗"——与我早前那条"观测挂让位闸上=自败回路→budgetExempt"是同一种自我克制。
· ⚠️同发读数里 `Game.cpu.getUsed()=12.72` 是**单拍瞬时值**，别拿它当速率（今晚第三次提醒自己在这一点上）；
  判 G6 只认 `stats.cpuRate.total`（逐拍均量）+ `tier`/`since`。

### R159（10-03 04:3xZ）把"部署税 400 拍"从口口相传算成两个常数之和——顺带发现它**会污染 #85 的判据**
· 之前我一路引用"每次部署给 G6 加 ~400 拍税"，但没写下它的**构造**。现在两个常数都对上了：
  `capacity.ts:37 MIN_RATE_WINDOW_TICKS = 100`（换码后 heap 里的累计量清零 ⇒ `rateWindowTicks < 100`
  ⇒ `pickCpuUsagePerTick` 退回偏高的 `cpuAvg10`）＋ `CONFIG.capacity.upgradeWindowTicks = 300`
  （要 **连续** 300 拍 target≠prev 才升档，而退回期间 `target===prevTier` 会把 `upgradeTicks` 写 0）
  ⇒ **100 + 300 = 400 拍**。⇒ 这笔税是**结构量**，不是经验值，以后引用可给出处。
· **方向是安全的（记下来，免得误以为"换码可能把扩张洗绿"）**：退回的那 100 拍用 `avg10`（现读 18.4 > 真值 14.47）
  ⇒ 只会让档位**更保守**，不会误开闸。
· ⚠️**真正的新发现（对我正在等的判据窗有后果）**：`evaluator.ts:904` 的
  `const explorationState = { stableCount: 0, lastExplored: {} }` 是**模块级堆状态** ⇒ **每次换码归零**；
  而 `:925` 是 `if (stableCount < EXPLORATION_STABLE_THRESHOLD) return null;` —— 探索式提案在归零后
  要重新攒够 `THRESHOLD` 个稳态周期才会再出现。
  ⇒ **含义**：若在 #85 的窗内换码，则"窗内没有 `code 3` 的 `TuningAdjust`"这件事
  **既可能是我的 binding 闸生效，也可能只是探索通道被换码重置了** ⇒ 空窗变成不可归因。
  这不是"要不要省一次部署"的排产问题，而是**判据有效性**问题 ⇒ 我把 R143/R150 的"本窗不部署"
  从纪律升级成**方法论必需**（且这一条要写进下一个类似判据窗的脚本头）。
  ⚠️两个未量的数：`EXPLORATION_STABLE_THRESHOLD` 的真值、以及那两次 ↑ 提案究竟来自探索通道还是确定性通道——
  后者若查清，可能让"换码污染"的影响面从"全部"缩到"仅探索型"。**别把本条当成已完全定量的结论。**

### R160（10-03 04:3xZ）#85 的判据窗可能**按构造采不到反例**：探索通道被 `tier=tight` 硬性关掉
· 刚读到的硬事实（`evaluator.ts:925-931`，`exploreParameter` 的前置）：
  ```
  if (explorationState.stableCount < EXPLORATION_STABLE_THRESHOLD) return null;   // =3
  if (signals.tierRank >= 2) return null;      // ⚠️ TIER_RANK: comfortable=1 / tight=2 / constrained=3
  if (signals.crisisRatio >= 0.1) return null;
  ```
  而现态 `Memory.kernel.capacity = {tier:"tight", since:83387005}` ⇒ **`tierRank=2` ⇒ 探索式提案今天根本不可能产生**，
  与我 R159 担心的"换码归零"无关——它早就被档位关着了。
· ⇒ **对 #85 判据的后果（这是今晚最该被抓到的一条）**：
  我等的 PASS 证据是"基线 83390266 之后窗内不再出现 `code=3` 的 `TuningAdjust`"。
  但在 `tier=tight` 期间，**就算我的 binding 闸不存在，探索通道也不会提案** ⇒
  **空窗不能归因于闸** —— 这正是我自己记过的那一族（"别写被测机制自身前提永远满足不了的判效判据"）。
· ⇒ **判据补一条必要共条件**（已写进 #79 任务，窗口的读者必须同时看它）：
  只有当窗内**至少满足下列之一**时，"无 `code=3` 提案"才算我的闸的证据：
  (a) `capacity.tier ∈ {comfortable, abundant}`（`tierRank < 2` ⇒ 探索通道活着）；
  (b) 或确定性 ↑ 通道的前置成立过（同房同参数出现 `lastTrend="up"` 方向的连续确认，即 trend 侧真的想抬）。
  否则 **一律记 `UNASSESSABLE-BY-CONSTRUCTION`**，**不是** PASS、也**不是** FAIL。
· 一个反而说明问题的时间线：那次 ↑ 提在 `83385766`，而 `tight` 的 `since=83387005` ⇒
  **提案发生在档位还是 comfortable 的时候，撤销发生在 tight 之后**。
  所以"它当时能提、现在不会再提"里，**档位变化本身就足以解释**——我的闸是否起作用，这条窗回答不了。
· ⇒ **#85 该怎么结案（诚实版）**：
  ①**代码级证明已有**：`tests/unit/tuning/upgrader-proposal-binding.test.ts` 5 例含控制组（clamp 缺失时仍提案）；
  ②**线上形状证据已有**：`kernel.demandClamps={"W38S56":2}` 与 `roleBounds.upgrader.maxCount` 同值 ⇒ 派生量在跑；
  ③**自然实例复证 = 取不到**（本 regime 下按构造不可得）⇒ 结案写成
  "**已上线 + 单测/控制组背书；线上复证在当前 `tight` 档位下不可观测，非否证**"，
  并留一个**可观测的替代判据**：等 G6 解档（tier 回 comfortable）后跑一发同样例，或
  在 `demandClamps=2` 且 `tierRank<2` 同时成立的那一刻盯 `lastAdjusted` 是否被顶到 3。
  ⚠️**不要为了拿到证据去动档位/阈值**（那是自败），也不要因为"窗里没事"就宣布闸被线上证实。

### R161（10-03 04:4xZ）#85 的**副作用被算清了**：它把 ↑ 事件只剩三条通道 —— #79 该去哪等，写死
· 读 `demand.ts` 钳位分支（`upgraderClamp` 全部赋值点，`:923/:927/:935/:939/:945/:958`）：
  `undefined`（= 我的闸**放行** ↑）只出现在 **三种 regime**：
  ①**保级/危机档**（`:923`，降级风险或 `crisisNeedsGuard` 且 ttd 低 ⇒ 直接用 `maxCount`）；
  ②**冲刺且 `storageNearFull`**（`:935` 的三元左支）；
  ③**没有 controller container**（`:945`，站桩升级未上线的早期/损房态）。
  其余分支给 `1` 或 `2` ⇒ 我的闸把"抬到 3"直接挡掉。**最常发生的那条（冲刺非满仓 ⇒ clamp=2）正是被挡的一条**。
· ⇒ **两条结论**：
  (a) **#85 不是"关掉 ↑"，是把 ↑ 收缩到三种 regime** —— 这句话该跟着 #85 的结案一起走，
      否则下一轮会误以为"窗里没 ↑ = 闸过头了/把功能掐死了"。
  (b) **#79（上行护栏的自然实例）仍然结构可达，但事件密度被我下调了**：它要等 ①②③ 之一成立后
      真出现一次 ↑ 且新编制到位。所以它的正确等待姿势是**盯这三个前置**，不是泛泛"以后总会有一次"：
      `storageNearFull` 在本服尤其稀有（R129 实测 storage 容量 1,000,000 不随 RCL 分级 ⇒ 满仓比例难达到），
      **②基本可以排除**；剩下 **①保级档**（核心房 RCL8 在 `[10000,15000]` 带里会自动进出 ⇒ **最可能的一次**）
      与 **③无 container**（幼房 container 被打掉/未建时）。
· ⚠️我**没有**为验证这些去制造条件（保级档靠它自然进出，container 不许去拆）；
  也**没有**因为"现在难采到"就宣布 #79 结案 —— 它已有单测 + 反向实验背书，线上复证只是加分项。

### R163（10-03 04:4xZ）**撤回 R160 的机制**：我把两套同名 `tierRank` 当成了一套（正是我记过的那一族）
· R160 我说"`exploreParameter` 的 `tierRank >= 2` ⇒ 因为 `capacity.tier=tight`（rank 2）⇒ 探索通道今天关着 ⇒ #85 窗不可归因"。
  顺着消费者读下去才发现** scale 用错了**：
  - `tuning-engine.ts:571` 的 `tierRank = round(avg(samples.ti))`，而 `ti` 由 `timeseries.ts:177-183` 写自
    **`budget.tier ∈ {healthy=0, guarded=1, conserve=2, recovery=3}`**（调度器的 CPU 档，`scheduler.ts:54/86`）；
  - `capacity.ts` 的 `TIER_RANK` 是**另一套**：`abundant=0, comfortable=1, tight=2, constrained=3`（扩张档位）。
  ⇒ `tierRank>=2` 说的是"**运行期 CPU 预算进入 conserve/recovery**"，与 `capacity.tier=tight` **无关**。
  ⇒ **R160 的"探索已被档位关掉"没有依据**（同理 `checkVerifyGate` 的 `>=2` 也是预算档，不是扩张档）。
· **R160 里仍然活着的部分**：方法论那条没错——判效窗前必须确认**探索/确定性通道当时是活的**。
  但共条件要换成**对的量**：`ti` 的评估窗均值（`EVAL_WINDOW_SIZE` 个采样，取自 `readCpuSegment()` 的 ring）
  **< 2** ⇒ 探索通道活着；≥2 ⇒ 窗不可归因。
  ⚠️我按这个去读时踩了第三个坑：**段号搞错**——探针读 `RawMemory.segments[3]` 只有 `economy` 一个键，
  CPU ring 不在段 3（`segment-store.ts` 的 `cpuSeg` 另有段号）。⇒ **"读到空/缺键"第三次被我差点当成"没有"**，
  这次是靠 `keys:[economy]` 的显式回读拦住的。
· **当前判定**：`#85` 窗是否不可归因 = **未决**（既不是 R160 说的"必然不可"，也不是"必然可"）。
  要收口只需两步：①`grep readCpuSegment` 定出段号；②对那一段算 `avg(ti)`（`EVAL_WINDOW_SIZE` 尾窗）。
  **在拿到它之前，任何 PASS/FAIL 都不要宣布**——这一条已同步改到锁与 #85 任务里。
· 给自己留的一句：**同名不同域的枚举是这个仓库的惯犯**（`nf` vs `gateNetFlow` vs `netFlowMean_d`、
  `agenda.minDwell=200` vs `posture.minDwell=1000`、`consec` vs `consecutiveFailures`、这次的两套 `tierRank`）。
  ⇒ 凡是"某个 rank/阈值 ⇒ 某结论"的句子，**先读写者那行代码确认它写的是哪套枚举**，再下结论。

### R165（10-03 04:4xZ）R163 留的【未决】当场关掉：`avg(ti)=0` ⇒ 探索通道**活着**，#85 窗**可归因**
· 探针 `mk=R164A`（tick 83393504）：`SEGMENT_CPU = segId("cpu",1)` ⇒ 段 **1**（顶层键 `cpu, population, heap`；
  段 0=房态、2=events、3=economy、5=epoch/players，顺手记下来免得再猜）。
  取 `cpu.d` 尾窗 **20** 个采样（= `EVAL_WINDOW_SIZE`）的 `ti`：**avgTi = 0、maxTi = 0、n = 20**。
  ⇒ `tuning-engine.ts:571` 的 `tierRank = round(avg(ti)) = 0 = healthy` ⇒ `exploreParameter` 的
  `tierRank >= 2` **不成立**，`checkVerifyGate` 同理 ⇒ **探索与验证通道当时都是活的**。
· ⇒ **对 #85 的判定**：R160 的"窗不可归因"作废（机制错，见 R163），但**共条件本身是对的、现在已被满足**。
  所以 `window*/pass85` 到点打出的 **"无 `code=3` 提案 ⇒ binding 闸起作用"重新具备证据价值**，
  条件是**读数时再测一次 `avg(ti)`**（<2）：`tierRank` 是 20 采样滚动窗，会随 CPU 压力变；
  若那一刻 ≥2 ⇒ 那一段仍记 `UNASSESSABLE-BY-CONSTRUCTION`。
  ⚠️另外两条不在 `ti` 管辖内的前提照旧：探索还要 `stableCount ≥ 3`（堆状态，**换码即归零**）与 `crisisRatio < 0.1`；
  本窗内不换码（R150 的 `HEAD..origin/dev` 为空已确认），所以前者不受影响 —— 这一条仍是"本窗不部署"的方法论理由。
· **带走的方法**（这次三步都算数）：①怀疑自己用错枚举 ⇒ 去读**写者那一行**（R163）；
  ②不留【未决】给人，能测就测（R165）；③测之前先列**哪些段是活的**（`active:[0..6]`）再取数，
  免得又拿"读不到"当"没有"（今晚第三次踩同一坑，前两次的教训都写在案）。

### R166（10-03 04:5xZ）弃掉一个半成品工具（记下来，免得下一轮以为有它可用）
· 我想给 #85 的判据配一支"读数前自动重测 `avg(ti)`"的零 console 工具（`cpu-ti-ring.mjs`，走段 1）。
  它连错四发才跑起来，而**第五步还没做**：段数据不是 JSON 而是 **base64 + 3 字节前缀 + gzip**
  （`observe.mjs:73` 那行 `zlib.gunzipSync(Buffer.from(data.slice(3),"base64"))` 才是正确解码法），
  我当时漏了这步 ⇒ `JSON.parse` 抛 Unterminated string。
  ⇒ **已删除该文件**，没挂进任何判据器：让下一轮依赖一支我自己没跑通过的工具，比没有工具更坏。
· **替代做法（已验证可用，写进 #85 任务与锁）**：读数前用一次**带标记的 console 探针**取段 1 尾窗 20 个采样的 `ti`
  （形如 `mk=R164A` 那发：`RawMemory.segments[1]` 在 bot 进程里**是已加载的**，`JSON.parse` 直接可解，
  拿到 `avgTi=0 / maxTi=0 / n=20`）。代价是一发探针、且要与对端的 `__evalResult` 竞争 ⇒ 只在宣布 PASS/FAIL 前用一次。
· 带走的规矩（同今晚那条"形状要先验"的另一半）：**工具要端到端跑通一次才允许变成判据的一环**；
  照抄现成工具时，把它**每一行前置处理**（解码、解压、重试、429 分支）都抄全 —— 我只抄了 URL 和 header，
  就漏掉了唯一一个不可省的 `gunzip` 步骤。

### R170（10-03 04:5xZ）**#88 的承重数字是错的**：那个"3.3 小时满仓"用的正是我 R142 已撤回的拍长假设
· 第三发 storage 读数（`phase.storageEnergyPrev`，`kernel.expansionDashboard.tick=83393684`，04:58Z）：
  核心房 **889,610**（01:58Z 882,314 → 02:41Z 877,828 → 现在 **889,610**）、幼房 **65,920**（61,238 → 64,660 → 65,920，单调升）。
  ⇒ **R147 的"核心房正在被抽干"不到两小时就反向**：此刻两房都在涨。⇒ "净流≈0 是因为盈余正被花掉"
  和 R154 的"门在向下衰减"是同一类错——**拿一个相位当常态**（今晚第四次）。
· ⚠️**真正的承重错误**：我从 R138 起反复写"余量 117,686 ⇒ 按 ≥5/拍 持续积累 **3.3 小时**就满仓"。
  重算：`117,686 / 5 = 23,537 拍`；**按实测拍长 2.3~4.5 秒/拍 ⇒ 15~30 小时**（3.76 秒那一发 ≈ 24.6 小时）。
  ⇒ **"3.3 小时"是拿 2 拍/秒（=0.5 秒/拍）心算的**，正是 R142 已经作废并写进记忆的假设——
  **而我在 R147/R153/R157/R169 里又重复引用了四次都没重算**。这就是"改一处常数要回查所有派生数"的反例。
· ⇒ **#88 的论证强度必须诚实下调**（不是撤销）：
  ①"净流 ≥5/拍 只能**瞬时**满足"这句**说过头了**：以 5/拍 积累能撑 **十几到二十几小时**，
    而同一条门的 τ≈5,000 拍 ≈ **5~6 小时** ⇒ **门完全可能在一次真实盈余里连续绿好几个 τ**（今天 04:15Z 的翻绿就是这种情形）。
  ②仍然成立的部分：**长期**（>15~30 小时）保持 ≥5/拍 会把核心房 storage 顶到 1M 上限，
    且 RCL8 的 controller 消费被 15/拍钉死 ⇒ 它是**有界可满足**的闸，不是**按构造不可满足**的闸。
    ⇒ 请示措辞要从"物理上不可能"改成"**可满足但需要盈余持续约一天，且满仓后必翻转**"。
  ③四个可选面不变（①改语义 / ②开出口（工业线已标不可得）/ ③只在未满仓/非建设期成立 / ④建设期扣投入），
    但**紧迫感下降**：G4 现在就是绿的，所以 #88 是"判据可靠性"问题，不是"本周扩张被它卡住"的问题；
    **卡住扩张的是 G6（需砍 2.47/拍）与 G0（待 RCL5 自达）**。
· 带走两条：**凡引用派生数字，改动它依赖的任一常数后要回查重算**（我一个拍长假设错，连带四个数字错）；
  **判据窗的时长要和 τ 比大小再说"瞬时"**（这次我把 5,000 拍的 τ 当成了几秒级的噪声）。

### R171（10-03 05:0xZ）**时间换算勘误表**：R170 那个错不是孤例，一次性把同批残留列完（就地不涂改，只加此表）
按实测拍长 **2.3~4.5 秒/拍**（三发标定 2.32 / 3.76 / 4.52）重算，凡本文件 R13x~R14x 里"拍→墙钟"的换算，
**以本表为准**：

| 出现处 | 原写法 | 重算 | 影响 |
|---|---|---|---|
| R138 | τ=5,000 拍「**≈42 分钟**」 | **≈3.2~6.3 小时** | ⚠️**最要紧的一条**：这正是"要等多久 G4 才可能翻"的那个量，读成 42 分钟会让人在错误的时刻判"没生效" |
| R138 | 「谁要是按**分钟级**等它翻」 | 该按**小时级**（τ 之上） | 该建议的方向反了；R153/R154 的"看 3 发、隔 ≥1,500 拍"才是对的读法 |
| R137 | 63 拍样本「≈1 分钟」 | ≈2.4~4.7 分钟 | 只是把短窗说短了，不影响"当窗占空比"的结论 |
| R144 | `warPatience=8000` 拍「≈8.5~17 小时」 | ≈5.1~10 小时 | 高估约 1.7 倍；**结论不受影响**（R148/R158 用的是"降回 5000 ⇒ 早 3,000 拍 ≈1.9~3.8 小时"，那条算法正确） |
| R145 | TTL「最迟 15,000 拍 ≈11~26 小时」 | ≈9.6~18.8 小时 | 高估约 35%，量级不变 |
| R137 | 「RCL5 已在 ~1 小时内自达」 | 由 R142/R147 作废，现估 **12:1x–14:0xZ** | 已覆盖，此处仅登记 |
| R159/R165 | 300 拍「≈19 分钟」 | ✅ 正确（300×3.76s=18.8min） | 无需改 |

· **为什么用"加一张表"而不是逐行涂改**：这些条目是对端与 cron 每小时要读的同一段文本，改行=抢编辑；
  勘误表可追加、可引用、且保留"我当时怎么错的"这条方法证据。
· **规矩补一条（R170 的后半）**：撤回一个常数假设时，**必须立刻列出所有引用它的派生量**并逐条重算——
  我 R142 撤了"2 拍/秒"，但只顺手重算了我自己当场在用的三个 ETA，
  剩下四个派生数（3.3 小时 / 42 分钟 / 1 分钟 / 8.5~17 小时）在文档里**活了两个小时**没人回查。

### R172（10-03 05:0xZ）本轮（10-03 夜）**当前真相表**——被改过六次的东西不该让下一轮自己重建
（只列"我现在信什么 + 它的出处"；被否证的说法留在各自条目里当方法证据，**别再引用旧句**。）

| 项 | 现在的结论 | 出处/判据 |
|---|---|---|
| **G0** | **机器算出来的**（`posture.ts:247` 七个合取项，无人工写者）。四层阈值链已核穿；唯一假项 `youngestMature`（幼房 RCL4<5），**会自达** | R137/R141；命中时刻由 `window3` 落盘（估 12:1x–14:0xZ） |
| **G4/#88** | **有界可满足**的闸（≥5/拍 可撑 15~30 小时；门 τ≈5,000 拍≈5~6 小时），**不是按构造不可满足**；04:15Z **已翻绿** ⇒ 它现在是"判据可靠性"问题，不是当前阻塞。四选一属人（工业线那支**不可得**：60 倍倒挂） | R154/R157/R158/R170/R169；耐久性 `g4-durable-watch.sh` 三态 |
| **G6** | 扩张链上**唯一"非自达且属人"**的阻塞。门槛**定值 12.00**（`limit=min(20,500)`），现用 **14.47/拍** ⇒ **要砍 2.47/拍**；`maxOperations` 只省 ≈2.27 ⇒ **单独不够**（差 ≈0.20）。滞回不是借口（300 拍≈19 分钟） | R157/R158（旧"42 分钟 τ""3.3 小时满仓"等换算见 **R171 勘误表**） |
| **#85** | 闸已上线；**窗可归因**（04:4xZ 实测 `avg(ti)=0` ⇒ 探索/验证通道活着）。宣布前**必须再测一次** `avg(ti)<2`（20 采样滚动窗）。基线 `83390266`，读数 tick `83399266` ≈10:5xZ | R160 的"必然不可归因"是拿错枚举说的，已由 R163 撤、R165 实测关掉；命令在锁里 |
| **#89** | 已实现 + 两层反向实验（各恰好 3 红/3 绿），**未部署**。上线=**松绑**：`warPatience 8000→5000`（早 ≈1.9~3.8 小时授权宣战）、`minDwell 1400→1000`。**推前须交代 owner** | `1bc67c9`/`e4dae12`；R144（我原"warPatience 钉住扩张"是错的）、R148 |
| **#81** | **从请示面摘掉**：两窗 `bk` 无 `repaired`、升级占 8 成 ⇒ 取舍此刻不在场；回归条件已写。⚠️结论只停在**账本口径**（塔修墙记 `towerSpent`；`min()` 是队列队尾） | R149 |
| **#90** | 观察项（不是缺陷）：振荡→抬 `warPatience/minDwell` ⇒ 脉冲骚扰可驯化宣战闸；TTL 已把"永久化"这一维关掉、`bounds` 卡住幅度 ⇒ 定罪要"持续战损却从未授权 war" | R145/R144 |
| **仪器口径** | G4 只两台可比：`economy.nf`（×100 快 EMA）与 `kernel.gateNetFlow`（门吃这台）；`ws` 是漂移数组。`netFlowMean_d` **存在但是观测器派生**（`observe.mjs:319`），现取才有效。`storageEnergyPrev` 是**锁存值**。`Object.keys()` 读不了 `Map` | R151→R152、R147、R156 |
| **拍长** | **2.3~4.5 秒/拍**（三发 2.32/3.76/4.52）。凡拍→墙钟一律按此区间，**别用 2 拍/秒**；说"瞬时"前先与 τ 比大小 | R142/R147/R154、R171 |

### R173（10-03 05:0xZ）G4 的读数口径终于从代码里读正（并差点误立案一台"孤儿仪器"）＋ #42 第二次现场复现到手

两件都是零 console、纯读码/读环，不改变任何阈值，也不动 src。

**① G4 到底吃的是什么（读码，出处逐行）**
- `readiness.ts:192` `const g4 = view.totalNetFlow >= options.minNetFlow`，`readiness.ts:86` `minNetFlow: 5`，`:87` `stronglyMinNetFlow: 15`（⇒ STRONGLY_READY 的 G11 在同一条总线上要 ≥15，是现值的约 3 倍）。
- 传进 G4 的那个 view 是 `empire-economy.ts:283-293` 的 **gateView**：每房 netFlow 先过一台慢 EMA 再重新聚合。慢 EMA 的 α=`CONFIG/index.ts:504` `netFlowGateAlpha: 0.02`，system `interval:100` ⇒ **τ≈5,000 拍**；`accounting.ts:311-318` `updateNetFlowEma` 在 `prev===undefined` 时**直接取当窗值播种**（⇒ 失房即 `delete`（`:291-293`），同名房再回来会从零重播，不继承旧 EMA）。
- **所以 `Memory.kernel.gateNetFlow` 里的数是"每台 EMA 的状态"，G4 判的是它们的和。** 我之前几轮写的"门 3.97<5""涨到 5.085 ⇒ 翻绿"其实一直是 Σ（这次才算把口径读正）：**单房值不能当门读**。04:15Z 那发：W37S58=4.007 + W38S56=1.078 ⇒ Σ=5.085，**余量只有 0.085/拍（1.7%）**。
- 更要紧的是这台是**跨房相加**，因此一房的正 EMA 可以掩掉另一房的负 EMA。当前形状正好是掩蔽方向：核心房慢 EMA 4.007 而它自己的快仪 `nf=−753/100=−7.53/拍`；幼房慢 EMA 1.078 而快仪 `+17.42/拍` ⇒ **此刻是幼房的脉冲把 Σ 顶在门槛上方**。我不写"会往下走"也不写"会往上走"（R153 刚为这句话道过歉）：方向由 `g4-durable-watch.sh` 的 6 发裁决，判据已写死（≥5 发不含 G4=DURABLE-GREEN／交替=OSCILLATING／≥5 发含 G4=RED-AGAIN）。
- **给 #88 的措辞更正**：请示面说的是"**帝国 Σ 净流 ≥5/拍**"，不是每房 ≥5。饱和库存对它的限制照旧成立（盈余只能变成存量或卖出），但那条论证要按 Σ 重述，别再引用任何单房数。

**② 差点立案的假缺陷（记下来，这一族已经第三次了）**
- grep `gateNetFlow` 在 `src/` 只命中类型声明 + 一次写入 ⇒ 我第一反应是"G4 的输入根本没有读者，仪器没接线"——和 `overflow_loss` 同一个形状。**不成立**：EMA 在同一个块里通过局部别名 `gateStore` 被读（`empire-economy.ts:283` 取别名、`:285` `gateStore[p.roomName]` 读）。
- 规则补一条：**判"某持久键没有消费者"之前，必须先把写入点那一段整块读完，并把写入时用的局部别名一起 grep。**（前两次同族：只 grep `src/` 漏了 `tmp/tools/observe.mjs`；把 `Map` 的 `Object.keys()` 空结果读成"没有数据"。）

**③ #42（帝国吃自己的幼房 hauler）第二次现场复现——到手，且是免费样本**
- `ring-dump.mjs CreepDeath` 尾 20 发，tick **83393001~83393758（757 拍）**：`d=[roleCode,x,y,age,natural]`（编码出处 `event-log.ts:48-51`，本次按写者核对过列义，没照采样器列名猜）。**20/20 的 `natural` 都是 1**，age 落在 1523~1625；三发 age=617 且同为 roleCode 9 是**正确的**——`event-log.ts:284` `lifespan = reserver/claimer ? 600 : 1500`、`:285` `natural = age >= lifespan-60`，617 ≥ 540 ⇒ 寿终标记成立。
- 量级：坏时候的基线是 **24 次死亡/1,336 拍且全部落在 spawn 邻格、age 很小** ⇒ 同一速率下 757 拍里约期望 **13 发**非寿终，**实测 0**。够第二发了（严重度判错会让人去动不该动的安全闸，所以之前不结案；现在结）。
- 诚实边界两条：环按**事件数**计（500 条），我这 20 行只代表尾部 757 拍，不代表整段 boot；且 `natural` 是**由名字里的出生拍反推**的名义寿命判定，**打满名义寿命才被杀死同样记 1** ⇒ 这一发封住的是"提前死亡/回收"这一类（#42 的形状），不是"全部战损"（那正是 #40 的一维缺陷，别混）。
- 结论：这条**此前已经结案**（`tmp/observe/hauler-cull-fix.log` + 那 8 发 age 1520~1529、位置散布的满寿命死亡），本发只是**第三个独立窗口**，不是"把它从待判效抬上来"的那一次。我刚才把它写成"升为已通过"——**那是把已结案的说成新结案**，同 R151→R152 那一族（判"某条还欠证据"之前先查债单现状，`pending-observability-debts.md` 里它本来就挂在"已修且判效彻底了结"）。`edfdfd7` 不再为它取证。
- 真正新增的不是"#42 通过了"，而是**roleCode 9 / age 617 这一类现在有了可读的寿命口径**（`event-log.ts:284-285`：reserver/claimer 名义寿命 600、寿终判定线 540）。下一轮看到"很年轻却记 natural=1"不要再当 #40 的新证据——它是这条**按角色分档**的常数；#40 的一维缺陷仍然成立，但成立的形式是"名义寿命内被杀 vs 寿终分不开"，不是"所有短命死亡都读成 0"。

### R174（10-03 05:1xZ）R173 只改了一半：**G3/G4 早就不是那台 100 拍翻符号的仪器了**——我把"当时的观测"当成了"今天的机制"

R173 读完传参链后回头看才发现，`empire-economy.ts:308-312` 的注释本身就把这件事写死了，而我一直没引它：

> 就绪度**刻意**用 `gateView / gateHealth`（长视界），而步 5/7/9 用快的 `resourceView`：就绪度要求「连续 500 拍成立」才让 plan 晋升（`plan-lifecycle.ts:41`），拿一台 100 拍就能翻符号的仪器去满足一个连续判据，等于把扩张交给采样相位决定。实测：同一量在相隔 100 拍的读数里 **17.7 → 0.4 → −2.8 → 12.1 → 17.2**，Blocked 跟着翻。

那段"实测序列"就是债单里已完成那条（`6325d96`「就绪度改用独立长视界净流仪器」）的**立案证据**。⇒ 我今晚好几轮引的纪律「G4/G7 会在 200 拍之间自己翻，所以单次快照不算数」**对 G4 已经作废**：那条经验属于换装前的仪器，我把它的适用范围一路拖到了今天。

**逐闸归属（按传进去的那个参数读，不按名字猜）**：`evaluateExpansionReadiness(gateView, gateHealth.health, budget, cpuTier, …, computeTieredBudget(budget).availableExpansion)`
- **慢（τ≈5,000 拍）**：G3、G4、G8、G9、G11 —— 用的是 `gateView`/`gateHealth`。
- **快（100 拍级，仍会翻符号）**：**G7** —— `availableExpansion` 来自 `allocateEmpireBudget(resourceView, health)`（步 5/7），走的是快视图。
- 算术（不是推算，是 α=0.02 的定义）：一次比当前 EMA 低 40/拍 的单窗冲击，只把该房 EMA 推 **0.8/拍**；要挪动 5 个单位需 ~6 个 100 拍步 ⇒ **≥600 拍**，真实尺度是 τ 级。

**这改变了三件事的读法（都可直接检验）**
1. **单次 G4 读数的分量比我此前允许的大**。R153/R154 那两次"别用单发判趋势"的自我约束在 G4 这里是**过度**的——它自己已经是一台 ~5,000 拍的积分器；那条纪律该留在 **G7 和 `economy.nf`** 上。
2. 反过来：**G4 一旦转红，几小时内不会自己回来**（要一整段 τ 的正净流才能把 Σ 抬过 5）。⇒ #88 的"要不要放宽门槛"请示多了一条时间代价：**关掉它不等于会自己开回来**；这一条只陈述仪器行为，**不自批、不动阈值**。
3. `g4-durable` 若真判成 **OSCILLATING**，振源**不可能**是 G4 自己的仪器（它按构造滤掉了 100 拍噪声）。只剩两种可能：Σ 真越过 5，或**房 profile 集合变了**——失房会把该房 EMA `delete`（`:291-293`），同名房回来时 `updateNetFlowEma` 以 `prev===undefined` **按当窗值重播种**（`accounting.ts:316`），Σ 可以一步跳掉十几。⇒ **届时先查房集合/播种，不要去查净流噪声。**

诚实边界：本轮**没有动任何阈值**，没有下"该绿/该红"的结论，只是把"哪台闸吃哪台仪器"这件事按代码核清并写回台账（`selfsufficiency-punishes-surplus.md` 的 ③ 已就地改口）。方法带走一条：**凡我复述"某条纪律"时，它当初立案的那个机制如果已经被换掉，纪律本身要重新划适用范围**——经验不会随换装自动续期。

### R175（10-03 05:1xZ）G4 的 Σ 在 900 拍里涨了 +2.58，而我唯一那台"独立对照"**量的是别的物理量**——当场收回，不把它当确认

**实测（两次 peek，都在 700 字符截断之外，字段完整）**
| 时刻 | tick | `gateNetFlow` Σ（G4 判定量） | `economy.nf` 两房和（快仪） |
|---|---|---|---|
| 04:15:56Z | 83392984 | 4.0071 + 1.0784 = **5.0854**（余量 0.085） | −7.53 + 17.42 = **+9.89** |
| 05:11Z | 83393884 | 6.4357 + 1.2302 = **7.6659**（余量 2.67） | −2.48 + −3.15 = **−5.63** |

`failedGates` 两次都只有 **G0+G6**（G3/G4/G7 均不红）。

**拍长标定（这是第 4 发，且这次是从数据里拿的，不是心算）**：dashboard tick 83392984→83393884 = **900 拍**，墙钟 04:15:56→05:11:39 = 3,343 秒 ⇒ **3.71 秒/拍**（落在 2.3~4.5 区间内）。⇒ 之前那条纪律继续有效，且 `pass85` 的 `ahead=5,582`（05:02Z）现在可以写成**带区间的 ETA：5,582 拍 ≈ 3.6~7.0 小时 ⇒ ≈10:4xZ~12:0xZ**（不是"10:5xZ"这种假精度）。

**算式对不上的地方（这是本条的全部内容）**
- α=0.02、900 拍 = 9 个采样步。要把 EMA 抬 2.580，需要 Σ(x_i − prev_i) ≈ 129 ⇒ **平均输入比当时 EMA 高约 +14.3/拍**，即那 9 窗的 profile netFlow 大致在 **+18~+22/拍**。
- 可我读得到的快仪在同一拍是 **−5.63/拍**，且 04:15 那发核心房也是负的。**"两头负、中间必须强正"在数学上不矛盾（脉冲），但目前只是唯一省事的说法，不是被证实的**。
- 我去找对照仪器时犯了 R152 那一族的新变体：抓了 `netFlowMean_d = 24.6 / 1.3`（两房）想确认"+18~22/拍"。**它不是对照**——`timeseries.ts:68` 写明 `d` 是 **`phase.reserveDelta`（储备变化率）**，`:256` 就是它。名字里的 `netFlow` 是我在观测器里给它起的标签，不是引擎语义。⇒ **24.6 既不能证实也不能否证那 9 窗的净流**，这条数不进判据。

**对 R174 的自我约束（重要，别只看好消息）**
- R174 第 1 点说"单次 G4 读数比我旧写法允许的更有意义"——**这句话仍然成立，但要加半句**：它成立的是"G4 现在是绿的"这个**状态**（积分器过了门槛就是过了），**不包含**"我理解它为什么涨"。涨了 +2.58 而我无法用任何在读仪器复现，这不是好消息，这是一条**未闭合的仪器缺口**。
- 因此 **#88 的前提不得由这一发改写**：不能说"净流已被证明能长期维持"。判据留在 `g4-durable` 的 6 发（第 2 发约 05:3xZ）与 #85 窗之后；在那之前 G4 只按"绿、余量 2.67、涨幅来源未解释"三条一起报。

**下一发该读什么（零部署、可执行，写给下一轮也写给我自己）**
- 唯一能直接复现那 9 个输入的东西是**每次 100 拍 EMA 更新时的 `p.netFlow`**（`empire-economy.ts:285` 的 `profiles.map` 那个）。它**没有落盘**——慢 EMA 只存结果、不存输入序列。⇒ 想闭合就得加一个**只进仪表**的输入小环（不改任何判定、不动阈值）。这是一条**观测缺口**，属可自批的取证类，不是策略变更；本轮**没有动手**（窗口在飞、且我不在无判据支撑时加代码）。
- 通则带走：**"有一台仪器读数很大"不等于"那台仪器在读我正在解释的量"**——名字是观测器给的，语义只在 `timeseries.ts` 的字段注释里。

### R176（10-03 05:2xZ）R175 那个"无法解释的涨幅"**就地关掉**：链读完发现门吃的是"EMAs 的 EMA"，τ 的记忆本来就够到 5 小时前——另外第一次拿到 G4 所门控那个量的**物理对照**

**A. 仪器链（逐行读，全部可复算）**
- `systems/room/economy.ts:173` `netFlow: mem.nf / 100` ⇒ **G4 慢 EMA 的输入就是每房快 EMA `nf/100`**（R175 我怀疑它不是，这里确认是）。
- `accounting.ts:422` `nf: Math.round(netFlowEma * 100)`，而 `netFlowEma` 在 `economy.ts:229` 由 `updateNetFlowEma(st.netFlowEma, netPerTick, acc.netFlowAlpha)` 更新、`:211-212` 部署后从 Memory 播种。
- ⇒ **G4 = EMA(EMA(每拍净流))**：`α_gate=0.02` 套在 `netFlowAlpha` 之上。它的记忆跨度是 **τ≈5,000 拍 ≈ 5 小时**（3.71 秒/拍标定见 R175）。
- **这就是 R175 缺的解释**：慢 EMA 在 04:15→05:11 涨 +2.58，**不需要任何"中间藏着 +18/拍脉冲"**——它只要还在吸收 5 小时窗里早先的正值就会涨，哪怕此刻输入已经转负。核心房 `nf` 自己就在往零爬（−7.53→−2.48），方向恰好一致。**我 R175 把"α=0.02×9 步 ⇒ 输入必须高出 14/拍"当成了矛盾，其实那个反推只约束单步，而我把 τ 的量级忘在算式外面了。**
- 顺手又抓到一个**同名不同量**（这一族第 4 例）：`empire-economy.ts:379` 往 **EmpireEconomySnapshot** 写的 `nf` 是 `resourceView.totalNetFlow×100`（帝国级、且吃**快视图**），与每房 `Memory.rooms[r].economy.nf`（房级、慢一档）**同名不同物**。⇒ 读 `timeseries` 里的 `nf` 不要当房读数用。

**B. 物理对照（第一次拿到，segment 3 的绝对量，不是速率仪器）**
`econ-ring.mjs` 尾 14 对采样（每 50 拍一条，tick 83393255→83393955 = **700 拍**）：
- 核心房 W37S58：`rs` 914,057→919,930 ⇒ **+8.4/拍**；`se`（storage）883,917→892,423 ⇒ **+12.1/拍**。
- 幼房 W38S56：`rs` 72,569→70,102 ⇒ **−3.5/拍**；`se` 66,878→65,436 ⇒ −2.1/拍。
- **帝国物理累积 ≈ +4.9/拍**（两房 `rs` 差分之和）。
⇒ 意义：G4 门控的那个量，我第一次能用与账本无关的口径估它——**+4.9/拍 对门槛 5**，即"帝国确实几乎 exactly 卡在门槛上"，而不是仪器把它捧上去的。这同时给 #88 一条**新的、非噪声的**证据形状：门槛之紧是物理的（累积速率≈门槛），而**幼房正在净消耗（−3.5/拍）**这一条也是第一次量到。
- 边界（写死，免得我下一轮又飘）：`rs` 差分含**跨房搬运**（carrier 投递会同时抬一房降另一房），所以帝国和只在**没有外部买卖**时等于真累积；`sold=1000` 确实出现在核心房当前窗（见 C）。

**C. 明确不追的线索（记下来，别当已用证据）**
核心房 `economy.bk` 当前子窗列了 `harvested:1000, spawned:600, sold:1000, tradeFee:689, tradeFeeEnergySell:689`。我**没有**据此算任何速率：`bk` 的窗长与更新口径我今晚没核过（已知它"只列非零键"），而 tradeFee 689 对 sold 1000 正是 #76 测过的远房运费量级（856~865/1000 的邻域）。⇒ 留给下一轮的**只有一件事**：先读 `bk` 的窗长定义（在 `accounting.ts` 的 `toMemorySnapshot` 里，`w` 参数），再决定"卖能量是否在拿盈余买信用顺路烧盈余"这条老问题要不要重开。

**D. #91 降级（我自己上一轮刚开的单）**
上一轮我为"慢 EMA 不存输入序列"开了 #91，判据是"涨幅无法复现"。**本条把那个判据抽掉了**：涨幅可由 τ 跨度解释，而输入序列的**替代量**（物理累积）已经存在且更好用（segment 3 的 `rs`/`se` 绝对量）。⇒ **#91 从"观测缺口"降为"不必建"**；真要说残留，是"看不到 `nf` 的输入序列"，而那条**从来就不是 G4 判读的必要条件**。这是今晚第二次为上一轮自己开的单撤案（前一次是 R166 删工具）——**方向是对的：证据到手就撤，不等别人指出。**

### R177（10-03 05:2xZ）`bk` 的窗长终于核到（**50 拍**）⇒ 核心房那笔卖能量第一次有了正确单位，而它**比 G4 的门槛还大**

**A. 单位（这是 R176 留给下一轮的那件事，本轮关掉）**
- `CONFIG/index.ts:472` `windowTicks: 50`；`systems/room/economy.ts:196` 按 `(tick + roomHash) % 50` 错峰、`:206` 要求两窗间隔**恰好** 50 拍否则视为断点。
- ⇒ **`economy.bk` 里的每个数是"最近一个 50 拍窗"的增量**，不是累计、不是每拍。之前几轮我偶尔把 `bk` 的数直接当速率读，那是**单位错**（同一族的"列名≠列义"，只是这次错在分母）。

**B. 那一窗现场（05:16Z peek，核心房 W37S58）**
`harvested:1000, spawned:600, sold:1000, tradeFee:689, tradeFeeEnergySell:689` ⇒ 换算成每拍：**采 20/拍、孵化 12/拍、卖出 20/拍、运费 13.8/拍**。
幼房同窗 `harvested:670, pickedUp:590, upgraded:768, towerSpent:120, towerSpendCombat:120`（升级 15.4/拍、塔 2.4/拍）。

**C. 关键在账本语义（三条都是读码，不是推断）**
1. `accounting.ts:33/131`：`sold` 在**恒等式侧属消费**（所以 drift 能闭合）。
2. `accounting.ts:50`：**净流仪器故意把 `sold` 从消耗里摘掉**（这是 #43 定的口径）⇒ 卖掉的那 1,000 能量**不压 G4**。
3. 但 `tradeFee` 是**真销毁**，且按 #43 的设计**只进消费侧**⇒ **它压 G4**。
⇒ 合起来：**每一笔落进核算窗的卖单，把该房净流按 −13.8/拍 拖下去**，而 G4 的门槛是 **+5/拍**。也就是说**这一笔的运费是门槛的 ~2.8 倍**，随后被 τ≈5,000 拍的慢 EMA 摊到几小时（R176）。

**D. 为什么这条值得摆到人面前（而不只是记着）**
- 现场 `kernel.stats.trade`：`credits=11,515,708`（⚠️按老口径这是**余额含 escrow，不是盈亏**）、`myOrders:1`（此刻挂着卖单）、`runs:37`、`terminalEnergy:8951`。
- 配置：`maxDealAmount:1000`、`minEnergySellPrice:0.02` ⇒ 按**下限**成交，一笔 1,000 能量卖单收入约 **20 信用**，代价是 **689 能量销毁**（#76 实测的远房运费档 856~865/1000 与这里 689 同量级）。
- 于是 **#88 多了一条我此前没摆过的出路**：G4 现在 ≈+4.9/拍（R176 物理口径）贴着门槛 5，而**只要不在"不需要信用"的时候付 69% 的运费卖能量，门槛就不是紧的**。这条**不是**"把门槛调低"（那是自败，我不动），也**不是**"砍营收"的 unilateral 决定——它是**关掉一条按配置下限成交即净毁能量的通道**，属人的产品决策，所以**我只摆数、不自批、不改 `minEnergySellPrice`、不动任何阈值**。
- 反向也要说清（免得我只报好消息）：**卖出本身在净流里不记消耗**，所以停卖对 G4 的**唯一**增益是省掉运费，不会把 `sold` 那 20/拍"加回来"；而 storage 正在涨（R176：+12.1/拍），停卖不会造成无处可去的能量——**除非**卖单存在的理由正是"给幼房 bootstrap 腾手"，这个动机我无法从现场判断，属人。

**E. 边界（写死）**：以上是**一窗 n=1** 的现场，不是速率。`runs:37` 与 `myOrders:1` 说明成交是**稀发脉冲**，摊到长时间轴上运费对净流的平均拖累必然 < 13.8/拍。**要把这条变成定罪证据，需要按窗取 `bk.tradeFeeEnergySell` 的序列**（`econ-ring.mjs` 走段 3、零 console、零部署），而不是再引这一发。

### R178（10-03 05:2xZ）单二进制窗**重新确认有效**（顺带识破一个我自己造的"字节数不一致"幽灵）＋ 量化到今晚最大的一个孵化脉冲

**A. 窗完整性（#85 判定的前提，必须每轮重认一次）**
- `git fetch` 后 `HEAD..origin/dev = 0` ⇒ 对端今晚没有再推 ⇒ **A/B 窗没有被别人的换码打断**。
- `check-code.mjs`：`modules: {main: <783330B sha=ea4c69da6f8b>}`（无参与带 shard 两次一致）⇒ **线上 == 本地 dist**，sha 仍是今晚早先认定的那个。**本轮未 build**，所以这条等式是我自己造成的、不是巧合。
- ⚠️我差点在这里立一条假缺陷：`ls` 报 `dist/main.js` **785,155** 而 check-code 报 **783,330**。当场验了单位：
  `node -e` 同一文件 `bytes=785155 chars=783330` ⇒ check-code 与 API 都报**字符数**，差的那 1,825 是 CJK 多字节。
  **同一文件的两种单位不是"版本不一致"**——这条记下来，因为"文件大小对不上"是我最容易误判成"有人换过码"的形状之一。

**B. `imported`/`exported` 的语义读正（R177 末尾那条"白捡的"不算白捡，得先把写者指认）**
- `creeps/roles/carrier.ts:57` `bumpEnergyCounter(ac.creep.room.name, "imported", amount)` ⇒ 记在**现场房**（creep 当下所在房），不是 `home`。
- `creeps/actions/fill.ts:25-29`：只有 `destRoom !== source` 才返回 `"imported"`（`0c478a` 收紧的那支），且 `accounting.ts:40/47` 写明 **`exported` 是 `imported` 的对偶项**、`imported` 计入 `ledgerIncome`。
- ⇒ 现场那一窗（核心房 `imported:1200` 与 `exported:1200` 同现，幼房另有一笔 `imported:1200`）是**两笔方向相反的跨房流**，且**成对**：核心房那笔 exported 与幼房那笔 imported 是**同一次投递的两端**。**净流上两者相消**（一入一出），所以 **G4 没被这条通道抬高**——这正是 #48/#59 要的"按现场房成对入账"的行为形状。仍是 **n=1**，不进判据，但形状对。

**C. 今晚最大的一个孵化脉冲（这是"快仪为什么翻符号"的承重数字）**
同一窗核心房 `spawned:4250`（=50 拍窗 ⇒ **85/拍**），`harvested:1000`(20/拍)、`towerSpent:30`。
按 `accounting.ts` 的口径把这一窗的账列全再加总（先列全再相加——这条纪律是 R149/R153 用两次误算换来的）：
`+harvested 1000 +imported 1200 −spawned 4250 −exported 1200 −tower 30 = −3,680 每 50 拍 = **−73.6/拍**`。
而同一时刻 `rooms.W37S58.economy.nf` 只报 **−2.48/拍**，慢门 `gateNetFlow` 报 **+6.44/拍**。
⇒ 三个数**同向不矛盾**，只是三层阻尼：单窗 −73.6 → 快 EMA −2.5 → 慢 EMA +6.4。这条把 R174 的结论从"推理"变成"有数"：
**G4 之所以不会被一次孵化脉冲打翻，正是因为一个 85/拍 的脉冲在 τ≈5,000 拍的积分器里只剩零头**；反过来也提醒：**任何拿"某一窗净流"当决策输入的系统都会被这种脉冲骑翻**（`sold`/`spawned` 的窗就是它的路径）。

**D. 本轮没有动 src、没有动阈值、没有 build、没有 push。** 挂着的第 6 只（sell-fee 占空比，pid 62024）跑到约 09:5xZ；#85 到点约 10:47Z。

### R179（10-03 05:2xZ）R177 那条不对称**不是漏洞，是 `economy.ts:220-229` 刻意做的**——但刻意只做到"货"，没做到"运费"

我把净流的分子读到底了（`systems/room/economy.ts:206-232`）：

```
const soldEnergy = Math.max(0, cum.sold - st.lastLedger.sold);
const netPerTick = (w.income - (w.consumption - soldEnergy) + w.refunds) / w.ticks;
```
注释原文给的理由：卖能量是「能量→信用」的**换算**不是价值销毁，记成消耗会造成**"卖盈余越成功、G4 越红"**的反向激励，并留了立案时的实测形状（14:4x：`credits +142k` 的同时 G4 被压到 `−9.6/t`）。这与 `accounting.ts:50` 的警告（运费**不可**记进 `sold`）正好配成一套。

**⇒ 三条结论，都是 R177 的直接后果而不是新事**
1. R177 的不对称**成立且是被设计的**：`sold`（20/拍 那笔货）**被摘出净流**，`tradeFee`（13.8/拍）**留在消费侧**。所以 G4 被运费拖而**不**被卖量拖，不是口径漂移，是这套代码的本意。
2. 于是"卖能量在压 G4"这个说法要**精确到运费**才是对的。向人摆这条时如果写成"卖出压 G4"，等于指控一个**已经修过的反向激励**复发——那是 R151→R152 那类"撤对了东西"的错。R177 的措辞我核过：它写的是运费，没写错，**但我要在 #88/#76 的请示面里把这条界限写明**，否则读的人（包括下一轮的我）会以为整条卖通道都在被惩罚。
3. 真正剩下的、有分量的问题因此是**纯定价问题**，不是账本问题：既然货不计消耗，那么**卖得越勤、净流只掉运费那一块**——按 #76 实测的远房档（1,000 货付 689~865 运费），**运费单独就能吃掉货值的 69%~87%**，而 `minEnergySellPrice=0.02` 里**没有任何距离项**。⇒ 这条属人的定价决定（我不改），但它现在有了**净流口径的代价**：不止销毁能量，还在**逐窗拖 G4**。

**顺带读到两条读 `bk`/`nf` 时必须记住的行为**（`economy.ts:206-215`）
- **断档即跳过结算**：`ctx.tick - st.lastTick !== 50` 时只重播种窗口起点、**不写快照**（防跨断口假漂移），EMA 保留。⇒ **换码/停摆造成的拍缝会让某一窗在 `bk` 里"缺席"**，"键不在"又一次不等于"没发生"（R149 同族第 N 次坐实）。
- **基线必须是拷贝**（`:208-210` `{...cum}`，注释说明别名会让窗差值恒为 0）⇒ 历史上真有这个 bug；读任何"某窗恒 0"的现象时，先怀疑这一族。

### R180（10-03 05:2xZ）**R172 当前真相表的增补表**：R173~R179 改掉了四行、新增一行（涂改旧条目不如给下一轮一张对表）

R172 那张表仍是入口，但**下面这几行以本表为准**（旧行不删，因为它们记录了"我当时为什么那样想"，是方法证据）：

| 项 | **现在的结论（取代 R172 对应行）** | 出处/判据 |
|---|---|---|
| **仪器口径**（改动最大） | 净流是**同一信号的三层阻尼**，不是"两台可比的独立仪器"：单窗 `netPerTick` → 快 EMA `economy.nf`（×100 存）→ 慢 EMA `kernel.gateNetFlow`。⇒ **`nf` 就是门的输入**（`economy.ts:173`），拿它"对照"门是**同源自比、不算独立验证**（我 R175 想干的事，方向本来就错）。**独立**的那台是 segment 3 的 `rs`/`se` **绝对量差分**（R176 实测 700 拍：核心房 rs +8.4/拍、se +12.1/拍；幼房 rs −3.5/拍 ⇒ 帝国物理累积 ≈ **+4.9/拍**，G4 门槛 5）。另两条：G4 判的是**各房慢 EMA 之和 Σ**（`readiness.ts:192`，`minNetFlow=5`、G11 要 15），**单房值不能当门读**；`empire-economy.ts:379` 的 `EmpireEconomySnapshot.nf` 是**帝国级**同名不同物 | R173/R176/R178；α=0.02、`interval:100` ⇒ τ≈5,000 拍 |
| **`bk` 的单位**（R172 完全缺这行） | `economy.bk` 每个数 = **最近一个 50 拍窗**的增量（`CONFIG/index.ts:472 windowTicks:50`；`economy.ts:196` 按 `(tick+roomHash)%50` 错峰、`:206` 间隔须恰 50）。⇒ 当每拍读**分母差 50 倍**。⚠️且**断档只重播种、不写快照** ⇒ 某窗"键缺席"不等于"没发生"；基线必须拷贝（`:208-210`，别名曾让窗差恒 0） | R177/R179 |
| **卖通道与 G4**（新行） | 净流分子是 `(income −(consumption − soldEnergy)+refunds)/ticks`（`economy.ts:220-229`）⇒ **`sold` 被刻意摘出净流**（注释含立案实测：14:4x credits +142k 而 G4 压到 −9.6/t，那个"卖得越成功 G4 越红"的反向激励**已修**），而 `tradeFee` 留在消费侧（`accounting.ts:50` 禁止并入 sold）。⇒ 卖能量对 G4 的拖累**只有运费**；现场一窗运费 13.8/拍（=门槛 2.8 倍）但下一窗即无 ⇒ **稀发脉冲**，占空比由 `sell-fee-duty`(pid 62024) 到 ~09:5xZ 裁决；**<1/拍 就不配进 #88 选项面** | R177/R179 |
| **G4/#88**（改 R172 那行） | 保持"有界可满足"，但**换了两条腿**：①现在绿的是 **Σ=7.666（余量 2.67）**、`failedGates` 只有 G0+G6；②**G4 转红后几小时不会自回**（要 τ 级正净流才抬过 5）⇒ "要不要放宽门槛"这笔请示多了一条**时间代价**（不自批、不动阈值）。⚠️"G4/G7 会在 200 拍之间自己翻"**对 G4 作废**（自 `6325d96` 起就绪度吃长视界视图，`empire-economy.ts:308-312` 注释即理由）；**只有 G7 仍快**（`availableExpansion` 走快视图）⇒ 那条"看连续多次 dashboard 交集"的纪律**只留给 G7 与快仪** | R173/R174/R176/R177 |
| **#85 窗**（补 R172 那行） | 窗**已重新确认有效**：`HEAD..origin/dev=0` 且 `check-code` 两次一致 `ea4c69da6f8b`（783330）**== 本地 dist**（本轮起未 build）。到点 **≈10:47Z**（区间按拍长报）。⚠️"体积对不上"先辨单位：`ls` 785,155 **bytes** vs API/check-code 783,330 **chars**（同一文件，差的是 CJK 多字节）——**别把它读成"有人换过码"** | R178 |
| **拍长**（更新 R172 那行） | 第 4 发标定 **3.71 秒/拍**（dashboard tick 差 900 / 墙钟 3,343 秒，现场两读）。区间仍写 **2.3~4.5**，凡拍→墙钟一律写区间并注明拍长；`sell-fee-duty` 与 `pass85` 的续接都按 3.71 算 | R175/R178 |

**这张表自己的一处不可复现，先说明白**：以上全部是**读码 + Memory/segment 直读**得到的，**没有一次 console 探针**，因此与 `__evalResult` 无争用；但也因此**没有任何一条经过"第二发不同工具"的交叉验证**——除了物理累积那条（它本身就是账本之外的对照）。下一轮若要用 #88/G4 的结论做决策，缺的第二发是 `g4-durable` 的 6 发（第 2 发约 05:3xZ 起）。

### R181（10-03 06:5xZ）**进犯把闸门表污染成 5 条**：`colonyState=defense` 一个标志同时判出 G2+G3+G5 三条红（机制读到底、实测到手、严重度按数据压住）

现场（零 console，peek×2 + observe×1）：核心房 W37S58 `EnemyInvasion@83395415` → `EnemyCleared@83395425` ⇒ 敌在场 **≈13 拍**、**0 战损**（邻近三条 `CreepDeath` 全 `natural=1`）、姿态仍 `fortify`。这是今夜第 4 次进犯、第一次落在核心房。同一件事在闸门表上留下五次投影：

- 链条（逐环读码）：`phase.ts:559` `hasHostiles ⇒ "defense"` → `room-profile.ts:207` defense 归 **struggling**（优先级 `struggling>candidate>production>core`）→ `resource-view.ts:159-170` 计数 ⇒ `coreRooms −1`、`strugglingRooms +1` → `readiness.ts` **G2**（`hasStruggling`）+ **G5**（`coreRooms≥1`）+ **G3**（`economic-health.ts:105` 有 struggling 就 `health="critical"`）。
- 实测：dashboard@83395384（进犯前）`Blocked=G0+G6` → **dashboard@83395484 `Blocked=G0+G2+G3+G5+G6`**，明细 `struggling=1 / core=0 / critical(netFlow=6.2)`。⚠️**G4 是绿的**、G3 自己的 evidence 就写着净流够（6.2 ≥ 5）⇒ 三条红不是三次独立失守，是同一个标志的三次投影；一间 RCL8 主房因为"敌方进过场"同时被判定"不是核心房"且"经济困难"。
- 时长算死：`colonyStateSince=83395462 = lastHostileAt+50`（`CONFIG.defense.defenseExitHysteresis=50`，`config/index.ts:630`；`threatStaleTicks=100` `:626`）⇒ defense ≈50 拍；而 `colonyState` 已回 normal 之后那次 dashboard 写仍读到 5 条 ⇒ 视图/计划各 `interval:100`（`empire-economy.ts:224`、`expansion-planner.ts:44`）⇒ **最坏 ≈50+100+100 ≈ 250 拍的污染窗**（本次实测 ≥72 拍）。
- **登记的是读数口径，不是防线漏洞**：以当前骚扰频率这不构成可用杠杆（污染 ~1 个仪表盘周期，而扩张本来被 G0+G6 钉着）。但**任何进犯之后 ≤250 拍内读到的 G2/G3/G5 红都不得当经济证据**——这正是 R173 那次"G3 恒红"追了两天的形状。⇒ 建议 **#90 的观察条件加一列**（骚扰期闸门表被单标志污染），G3/G5 的判效器**顺手读一发 `colonyStateSince`**。
- 真代价的形状（写死条件，不作现状）：若对手让一只 creep 常驻房内、每 <100 拍刷新 `lastHostileAt` ⇒ defense 不退 ⇒ `remote-mining-manager.ts:521` `crisisPaused` 含 defense（新矿推送停）+ `construction-manager.ts:508` 拆改计划停 + G2/G3/G5 恒红。今夜四次都是 ≤13 拍清空 ⇒ **只登记条件**。
- 下一轮该核的：dashboard 若已回到 `G0+G6` 则本条结案为"有界污染"；若 G2/G3/G5 仍在，说明滞后另有来源，本条机制没读到底。

**同时更正 R180 那张表的两行（旧行留着当方法证据）**：
1. **仪器交叉验证那一行**：表末"缺的第二发是 `g4-durable` 的 6 发"——第 2 发已到（05:51Z Σ=**5.615**@83394484），与本轮那发 peek（Σ=**5.639**@83394425）相距 59 拍、差 0.4% ⇒ 读数层面的第二发已补齐；本轮第四点 **Σ=6.208**@83395479，对 round2 跨 **1,995 拍 +0.59**（方向向上）。⚠️仍不叫稳态（慢 EMA 的本性就是慢）。同拍核心房 `nf=−16.19/拍` 而门读 5.18 ⇒ 三层阻尼又一例。
2. **卖通道那一行的期望值正在反方向**：`sell-fee-duty` 10 发里 **3 发有费**（846/846/452，`sold` 恒 1000）⇒ 占空比 0.3、feeMean≈715 ⇒ **平均拖累 ≈4.3/拍 对门槛 5**，按脚本头写死的判据（≥2.5 ⇒ 摆给人）**这条会到线**，不是 R180 期望的"<1/拍 ⇒ 不进 #88 选项面"。⚠️两个必须一起摆出去的前提：**①工具的"两房同费"是伪形**——脚本 `tr -d '\n'` 后 `head -1`/`tail -1` 在只有一房命中时取到同一个匹配（`raw=` 列那两个键其实在同一房内），所以**哪间房在卖仍未证**（修法：按 `rooms.<r>.economy.bk` 前缀分房取，但**不去改运行中的脚本**，否则一份日志混两种口径）；**②平均拖累的算式不受此影响**（去重看核心房 `economy.t`，读间隔 ≈150 拍 > 2×50 拍窗 ⇒ 不会双计）。节奏若不变，停卖的净收益＝"每 ≈600 拍省 846 能量、少收约 3 信用"——**属定价，不动门槛、不自批**。

**其余（都在预期内）**：CPU `cpuRate.total=14.41/拍` 对 comfortable 门槛 12.00 ⇒ **仍差 2.41/拍**（与 R158 的 2.47 同量级、没动），`tier=tight@83387005` ≈8,470 拍；`credits=11,751,469`（余额含 escrow 非盈亏）、`myOrders=1`、`demandsPublished=0`（工业线仍被 ROI 闸按住）。`siteStale:W36S58:*road age=noProg=8956` **不立案**（锁 3792 行已结案"在建、只是慢"，这批属 W36S58 `射程外=9573` 那一族的常驻挂起）。

**判效器纪律第四次踩点并当场补上**：`rcl5-watch`(38141) 06:23Z 轮次用完 EXIT，26 发全程 lvl=4 —— 覆盖 ≈4,000 拍 < 剩余 **4,970 拍**，属"下班时刻没按 due tick 算"，**不是"到点没升"**。已续接 pid=**69079**（`ROUNDS=45 GAP=600` ⇒ 6,000~9,200 拍），同一份日志、起点写了人工 NOTE 行。ETA：`progress 308,543@83394425`、15.7/拍 ⇒ 命中 ≈**83400570**；拍长两发新标定自看门狗日志时间戳自取 **3.93**（window3：2,300 拍/9,032 秒）与 **3.89**（sell-fee：1,300 拍/5,054 秒），observe 现场那发 2.64（10 拍瞬时窗）⇒ 命中带 **10:1xZ~12:3xZ**，判据留拍号。命中那一刻核 `Blocked` 是否塌回 **G0+G6**。

**本轮边界**：零 src 改动、零 push、零 build（#85 单二进制窗继续有效）、零 console（5 台看门狗全走 Memory API）。属人项一个没动（§3.5 那 7 项）。

### R181 补（10-03 07:0xZ，同轮当场闭合）污染窗量到了上界：**正好一个仪表盘周期（100 拍），不是我推的最坏 250 拍**

`kernel.expansionDashboard.tick=83395584` 已回到 `Blocked=G0+G6`（`failedGates` 只剩这两条），两房 `colonyState=normal`。三次写序列：`83395384` 干净 → `83395484` 污染（G2+G3+G5）→ `83395584` 干净。⇒ 从进犯（83395412）到闸门表干净共 **172 拍**，其中**只有 1 次仪表盘写被污染**。
· 所以 R181 那句"最坏 ≈50+100+100 ≈250 拍"是**按构造的上界**，现场给的是**一个周期**：视图（`interval:100`）与计划（`interval:100`）在本房同相，defense 的 50 拍迟滞**落在同一个 100 拍写窗内**，没有跨到第二次写。**别把这条当普遍结论**——若进犯发生在视图写之后、计划写之前，就会污染连续两次写（≈200 拍）；本轮只是运气好的一次实测。
· 结论不变、且更硬：**一次 13 拍的进犯 ⇒ 扩张闸门表有 1 个周期（实测 100 拍）显示五条红，而经济侧同刻 netFlow=6.2 是绿的**。⇒ 口径纪律保留：进犯后 ≤200 拍内的 G2/G3/G5 红不作经济证据；G3/G5 判效器顺手读 `colonyStateSince`。
· 同拍顺带一条对照（不是新案）：核心房当窗 `bk={harvested:1000, repaired:48, towerSpent:660, towerSpendWalls:660}` ⇒ `towerSpent==towerSpendWalls` 正是 #80 结案的形状（塔能记在修墙桶），且这一窗起点已晚于那次齐射（83395416 结束），**所以这 660 不是战斗消耗**——别在下一轮把它记成"进犯的弹药账单"，本场齐射的消耗落在更早、已被覆盖的那一窗，取不到了。

### R182（10-03 07:4xZ）**G4 翻红了**：`Blocked=G0+G4+G6`（v=4.2 对门槛 5），三台仪器同向、且这次不是 R181 那一型的状态伪影；顺带把卖通道归属定案并按两法量成 **3.7/拍**

**闸门状态**（权威集合只认 `Memory.kernel.expansionDashboard.failedGates`）：dashboard@83396284 = `G0:posture(v=false)` + **`G4: net flow(v=4.2|netFlow ≥ 5)`** + `G6: CPU tier(v=tight)`。G2/G3/G5 全绿、两房 `colonyState=normal`、`lastHostileAt` 仍是 83395412 ⇒ **不是进犯污染**（R181 那一型有 G2/G3/G5 同红，这发没有），是门自己的输入跌破。

- 慢 EMA 序列（`kernel.gateNetFlow` 两房求和）：`5.457@83392545 → 7.185@83393485 → 5.639@83394425 → 6.208@83395479 → 4.240@83396360`（核心房 5.183→**3.102**）；`g4-durable` round3 独立打 Σ=5.139@83395984 ⇒ 380 拍内 5.14→4.24。
- 物理面（账本之外）：核心房 `roomTotal_rs 921,728@06:5x → 914,010@07:47` = **−8.7/拍**（900 拍差分），幼房 `rs` **+2.8/拍** ⇒ R176 那条"帝国累积 +4.9/拍"**符号已翻面**，帝国现在在净消耗。快 EMA 同拍 `nf=−9.96/拍`。三层同向。
- **后果按 R174 讲清**：τ≈5,000 拍的积分器 ⇒ G4 转红**几小时不会自回**。所以"B 路线（幼房 RCL5）是必要非充分"今天有了具体的新形状：**RCL5 命中即便消掉 G0 的 `youngestMature` 假项，G4 会单独把扩张挡住**（G6 也仍在）。#88 的紧迫性从"绿但余量薄"改成"红且不自回"。

**卖能量通道的归属与量级（R181 留的伪形当场带走）**：按子键点名读 `kernel.stats.energyLedger.rooms.<r>`（**不拼行就没有 head/tail 伪形**）——核心房 `sold=49,000 / tradeFee=36,627 / tradeFeeEnergySell=36,627`，幼房三项全 **0**；第二发独立佐证：当窗 `bk`（`economy.t=83396329`）核心房 `sold:1000, tradeFee:846` 而幼房整块无 trade 键；结构面 `roomsWithTerminal=1` ⇒ **只有核心房能卖，"哪间房在卖"没有悬念了**。
- 运费对 G4 的拖累**两法互校同为 3.7/拍**：①占空比法（采样器 16 发中 4 发有费、feeMean≈734 ⇒ `734×0.25/50`）；②累计差分法（`36,627 ÷ 自 boot 9,912 拍`）。⇒ R180 期望的"<1/拍 ⇒ 不进 #88 选项面"**不成立**；写死的判据（≥2.5 摆给人）已越过。
- 交叉校验：`stats.trade.runs=49 == sold/1000` ⇒ 每笔恒 1000 能量共 49 笔；**运费占货量 74.8%**（#76 实测带 69%~87% 内）。按 `minEnergySellPrice=0.02` 上界，这 49 笔至多换 980 信用。
- 但收入侧**不写成结论**：`credits` 差分 +127,986/980 拍（11,751,469@06:5x → 11,879,456@07:47）、上一段 +235,761 ⇒ 另有量大得多的信用流入线（卖矿/escrow？两发差分不足以定罪）。给 #88 的口径只到这里：**帝国自己的门（G4）说稀缺的是能量/拍，而这条通道正以 74.8% 的税把稀缺物换成不稀缺物**。`terminal-market.ts:85` 的注释已写明"`minEnergySellPrice` 不含运费项"、`:117` 走 `pickBestBuyOrder`（吃单）⇒ **修法（运费项进卖出判据）是现成缺口，但那是砍交易行为=属人**，不动门槛、不自批。

**净流构成第一次有整张表**（核心房，自 boot 9,912 拍 ⇒ 每拍）：`harvested 19.1 / spawned 25.6 / towerSpendWalls 6.9 / repaired 0.8 / sold 4.9 / tradeFee 3.7`。⇒ **塔修墙（当窗 30/拍、均值 6.9/拍）+ 运费 3.7/拍 两项就已数倍于 G4 门槛 5/拍**，而修墙是 #53/#80 结案的"非缺陷"（今夜 13 拍清空靠的就是这 6 塔）⇒ **不砍，把构成摆出来**。当窗 `towerSpent:1500==towerSpendWalls:1500` 仍是 #80 桶形，别记成弹药账单。

**仪器口径新发现（全仓可用）**：`global-cache.ts:806-809` 里 `g.energyLedger.tick` **只在对象创建时赋值**（`if (g.energyLedger === undefined)`）⇒ 它是 **boot 时刻**、之后永不更新。第一眼把它读成"数据过期 9,912 拍"差点立案；正确用法是 `kernel.stats.energyLedger` = 自 boot 累计 + 自带 boot 基线 ⇒ 要速率直接 `值 ÷ (Game.time − tick)`，不必另找仪器。

**两条顺带登记（不升案）**：①今夜**第一个 `natural=0` 战损** `CreepDeath@83396301 W37S57 role=reserver age=365` ⇒ #90 的条件仍未凑齐（n=1、非本房、姿态仍 fortify），但"零战损→一战损"按时序记下。②`escalations` 里 `{global/mineral/terminal_trade, lastAt 83396042, repeats=3, terminal:true}` 有新动作（环内 `RecoveryEscalation=1`）⇒ 与 #51/#44 同族（缺料/行情倒挂后反复烧 attempt），形状记为"mineral 域会重复升级"。

**下一轮（R115）第一件事比 G4 更近**：`core-downgrade-band` round17 `flag=false pred=83396623`（距现拍 ~250 拍）⇒ 按 #52/R149 的预写分支，flag 翻真后 **≤600 拍内应看到核心房队列出 upgrader**（[10000,15000] 锯齿带的设计救援）。

**本轮边界**：零 src 改动、零 push、零 build、零 console（5 台看门狗 54116/54198/59191/62024/69079 全走 Memory API）；探针 peek×3 + observe×1。§3.5 那 7 项属人决定一个没动，也没为制造证据做任何事。

### R183（10-03 08:5xZ）**#52 保级锯齿整圈闭环（+71 拍出 upgrader，creep 名自带出生拍）**；G4 塌到 Σ=0.057，于是把那台积分器的常数与**恢复下界**读死；并第一次给出帝国收支整张表（10 小时均值 ≈+2/拍 对门槛 5）

**一、#52 线上第二次样本，且第一次拿到"响应"那一半的实锤**：`core-downgrade-band` 判 `flag=true@83396584`（预测 83396623，**差 39 拍**）→ `false@83396784` ⇒ **ENGAGE-PASS**（一圈 200 拍，环内有 `ControllerDowngradeRisk=1`）。我 R114 写死的判据是"flag 翻真后 ≤600 拍出 upgrader"——本轮用一发带 mark 的 console 读到 `Memory.creeps` 里核心房唯一 upgrader 的名字 **`upgrader-W37S58-0-83396655`** ⇒ **出生拍 = engage 后 +71 拍**，落在 flag-true 区间内；RCL8 设计上不养 upgrader，所以这只只能是救援产物。⇒ 链条"进入救援→孵 upgrader→退出"第一次有时刻戳。**取证口径**：creep 名嵌出生拍 ⇒ 判"某拍孵出过什么"不必抓现行，事后过滤角色前缀即可（本轮 engage 后 683 拍仍取得到）。

**二、G4 现场：Σ 从 4.240 塌到 0.057**（`gateNetFlow = {W37S58: −0.840, W38S56: +0.897}`），dashboard@83397184 仍 `Blocked=G0+G4+G6`，G2/G3/G5 绿、无新进犯 ⇒ **不是 R181 那型状态伪影**。常数这次从码里读死（不再引记忆值）：`netFlowGateAlpha=0.02`（`config/index.ts:504`）× 更新节奏 `interval:100`（`empire-economy.ts:224`）⇒ **τ≈5,000 拍成立**；快档 `netFlowAlpha=0.3` × 50 拍核算窗 ⇒ τ≈165 拍。
· **算术闭合（这条同时否掉"仪器坏了"）**：920 拍 ≈ 9 次更新，要从 3.102 落到 −0.840 需要输入均值 **≈−20.6/拍**；物理面同段核心房 `rs 914,010→892,802` = **−24.1/拍**，构成法给的净流也在 −20 量级 ⇒ 三方互洽，门在如实积分。
· **恢复下界（把"几小时不自回"换成常数算的数，并且它比"慢"更强）**：从 −0.84 抬过 5，若输入持续 +20/拍 需 `n=−ln(1−5.84/20.8)/0.02 ≈ 16.3 次更新 ≈ 1,630 拍` ⇒ **≈1.2~2.0 小时**（当前拍长 3.65 秒 ⇒ ≈99 分钟）。⚠️更要紧的一条：EMA 渐近于输入值 ⇒ **输入均值必须严格大于 5，光等于 5 永远够不到门槛**（"5 对 5"是渐近不可达，不是慢）。这条请和 #88 一起摆，它决定"放宽门槛"到底买的是什么。
· （自纠：我锁里那一发把 1,630 拍错换算成 43~74 分钟，已当场按拍长重算并保留错行，见锁 R115 补。）

**三、帝国收支整张表（核心房，自 boot 10,862 拍，第一次完整）**：收入 `harvested 19.24/拍` + `imported 23.33/拍`（远矿交付记在这里）= **42.6/拍**；消费（仪器口径，`sold` 按设计摘出）`spawned 26.43` + `towerSpendWalls ≈6.3` + `tradeFee 3.67` + `exported 2.76` + `repaired 0.75` = **≈40/拍** ⇒ **10 小时均值净流 ≈ +2/拍，而门槛是 5/拍**。最大单项是**孵化 26.4/拍（占消费 62%）**，那是维持 24 只本房编制 + 远矿编制的更替成本（24×~1,300÷1,500 TTL ≈ 21/拍）⇒ **不是可砍的浪费**。⇒ 诚实结论：G4 红既不是噪声也不是偏负，而是"产出 62% 花在维持现有体量，均值离门槛差 3/拍"；要常年绿得靠**收入侧**上台阶，而 A 路线（关远矿）方向相反——这句请进 #50/#88 同表。
· **两个假设证否（下一轮别再去找）**：①"G4 漏记远矿收入"否——核心房 `imported 253,403 ≫ exported 30,000`，且 `ledgerIncome = harvest+bought+imported`；②"`tradeFee ≥ sell桶+buy桶` 被破"否——`39,849 vs 38,265+0`，**残差 1,584 是第三通道存在的正向证据**（`terminal-selfaid.ts:134/183` 与 `terminal-market.ts:82` 的非能量成交都只记 `tradeFee` 不分桶）。归属仍是推断（n=1 段）：本段 `runs +4` 而能量卖单只 +2 ⇒ 2 笔非能量成交（矿）最可能。**#88 的拖累按总格重算 = 3.67/拍**（与占空比法 3.7 同数，结论不变）。

**四、三条登记**：①**#48 成对入账第二次、且量级大 8 倍**：核心房 `exported=30,000` **恰等**幼房 `imported=30,000`（自 boot 累计，非单窗）。②`credits` **第三发同向差分**：+235,761 → +127,986 → **+161,352**（≈130~240/拍）⇒ "存在一条与能量卖单无关的大信用流入"由假设升为事实（来源仍未证到，矿卖单是头号候选，与③的运费残差互指同一通道）。⇒ "停卖会不会伤收入"可按"49 笔能量卖单至多 980 信用 vs 六位数流入"来摆，但我**不据此自批任何砍法**。③幼房爬级仍 `lvl=4`（`rcl5-watch` round11）、`terminalEnergy 6,393→917`（卖单在吃 terminal 存量）。

**本轮边界**：零 src 改动、零 push、零 build；探针 observe×1 + peek×2 + **console×1**（mark=`R115A`，先认 mark 再取值；5 台看门狗都走 Memory API，不抢 `__evalResult`）。§3.5 那 7 项属人决定一个没动。

### R184（10-03 09:4xZ）**G4 的回升是回声**：核心房慢 EMA 已到 +2.122 而它的输入 `nf=−14.99` ⇒ 按构造必回落（写成可驳预测）；运费拖累改由累计差分给 = **4.38/拍**（占空比采样器结构性漏 3 倍，那条 2.46 是下界）；停卖的代价读死并**撤掉我自己"饱和会关远矿"那句**

· **回声判据**：`gateNetFlow={W37S58:+2.1221, W38S56:−0.1988}` ⇒ Σ=1.924（上一点 0.438@83397484）。核心房 695 拍涨 +2.69 反推那 7 次更新输入均值 **≈+19.8/拍**，与物理面同段 `rs +17.7/拍`（892,802→909,659）对得上 ⇒ R183 那个"+20/拍"本段真出现过；**但同拍输入已翻负**（`nf −9.96→+16.07→−14.99`；当窗核心房 `bk={harvested:960, spawned:4100}` ⇒ 单窗 −62.8/拍，孵化压穿）。`accounting.ts:317` 的符号是定的 ⇒ **EMA>输入 ⇒ 回落**。
  **可驳预测（R117 核）**：①`nf` 续负则 Σ 已见顶、83399000 前后应落回 1.0~1.9；②跨线必须**输入均值 >5**（等于 5 渐近够不到）；③**若 `nf<0` 而 G4 转绿 ⇒ 我的模型错**，回头重读 `empire-economy.ts:281-291` 的输入链路。
· **运费口径统一（重要，别再拿占空比当估计值）**：829 拍差分 `tradeFee +3,629` ⇒ **4.38/拍**（自 boot 均值 3.67/拍），且 `tradeFeeEnergySell` 增量**同为 +3,629** ⇒ 本段运费全在卖能量桶、**残差冻结在 1,584 ⇒ R115 的"第三通道"本段没复现，归属仍是 n=1 推断**。`sold +5,000`（5 笔×1,000）与 `runs +5` **第三次 1:1**；本段税率 72.6%。
  采样器为什么必然漏：`GAP=560 秒 ≈152 拍/发` 而 `bk` 只留**最近一个 50 拍窗** ⇒ 有费窗被采到的概率 ≈1/3；那 829 拍里 17 个窗有 5 个带费、采样器只打中 1 发 ⇒ 它的 `2.46/拍` 是**下界**。⇒ **#88 一律用 ledger 差分。**
· **算术后果（第一次能这么说）**：门槛 5、现缺 3.08/拍，而运费 4.38/拍 ⇒ **停卖单独足以把 G4 抬过线**。⚠️这句只讲符号与量级，是否停卖属人。
· **停卖的代价读死 + 我自己一句旧话作废**：`storageFullThreshold=0.9` ⇒ 触发线 900,000，核心房 storage 现 882,323 ⇒ 余 **117,677**；涨速 +9.1/拍，停卖后 ≈+15/拍 ⇒ **≈7,800 拍 ≈8 小时**（带 7~9.5 小时）。到线的真实后果（读消费者集合，不是引记忆）：`demand.ts` 限采+加速消费、**`factory-manager.ts:58`/`industry.ts:459` 要 near-full 才开工业线**、`spawn-manager.ts:157`、`power-creep-manager.ts:190`；**`remote-mining-manager.ts` 里没有 `storageNearFull` 消费者** ⇒ **"满仓会关掉远矿、赔 19.9/拍"那句在本场景作废**（这是同一句话第二次被否，上一次是 09-30 现场否证）。
· **其余**：`credits` 第四发差分 **+222,040/≈1,000 拍**（流入稳定 ≈130~240/拍，来源仍未证到写者；`demandsPublished=0` ⇒ 不是工业需求）；`terminalEnergy 917→10,287`（卖单没跟上采集，与"停卖会更快攒满"同向）；幼房在孵化潮（人口 8→12、`rs −6.6/拍`、环内 `AccountingDrift W38S56[34,2]`）；`Blocked` 仍 `G0+G4+G6`、`tier=tight@83387005`、无新进犯、`CreepDeath` 全寿终；RCL5 未到（ETA≈83400570，带 11:5xZ~12:4xZ）；#85 `done85=0`（到点≈10:47Z）。拍长第 7、8 发标定 **3.61 / 3.80 秒**。

**本轮边界**：零 src 改动、零 push、零 build、零 console；探针 observe×1 + peek×1（5 台看门狗在飞，全走 Memory API）。§3.5 那 7 项属人决定一个没动，也没为制造证据做任何事。

### R184 补（10-03 09:5xZ 自纠）**near-full 余量我算错了一个数量级，代价那一侧的结论要跟着改**：真实余量是 **17,677（0.5% 容量）**不是 117,677 ⇒ 触发线 ≈1,200~1,900 拍（**约 72~120 分钟**）之后，不是"8 小时"

· 错法：`1,000,000 − 882,323 = 117,677` 是**到绝对满仓**的距离，而我那句话配的是 `storageFullThreshold=0.9` ⇒ 触发线 **900,000** ⇒ 正确余量 **900,000 − 882,323 = 17,677**。按当前涨速 +9.1/拍 ⇒ ≈1,943 拍；停卖后 ≈+15/拍 ⇒ ≈1,178 拍；拍长 3.6~3.8 秒 ⇒ **约 1.2~2 小时**。
· 且今天 storage 序列 `894,877 → 892,678 → 873,636 → 882,323`（最高发 ratio **0.8949**）⇒ 这房**已经在触发线下面摆**，不是"几小时后到线"。
· ⇒ R184 §二 那句"停卖单独足以把 G4 抬过线"**符号与量级不变**（现缺 3.08/拍、运费 4.38/拍），但**代价被我低估**：停卖 ⇒ ≈1,200 拍内进 near-full ⇒ 既定响应是 `room-state.ts:302` 的"**限采 + 加速消费**"（并且 `factory-manager.ts:58`/`industry.ts:459` 的工业线开工条件正好满足）⇒ **收入↓ + 消费↑ 都压 G4 输入 ⇒ 停卖买到的余量可能被饱和响应吃掉一块**。
· 但不写成"必然撤销"（按我自己那条"断言改动会被系统自己撤销之前，先量两道闸的门槛间距有没有交集"）：near-full 的响应强度与出口容量我没读全（RCL8 升级出口受 [10000,15000] 保级带限、建造出口受工地数限）。**给 #88 的最终口径**：停卖 = 净流 +4.38/拍；代价不是"赔 19.9/拍远矿"（该说法已在 R184 作废），而是"约 1,200 拍后触发 near-full，之后改由限采+加速消费+工业线消化盈余，G4 收益被侵蚀多少**未量**"。是否停卖、是否愿让工业线以"烧盈余"为目的开工，属人。
· **通则（值得进记忆）**：写"距阈值还剩多少"之前先把**阈值本身乘出来**再减——我用错了被减数（拿容量 1,000,000 当阈值），把 2 小时说成 8 小时。

### R181（10-03 10:1xZ）三发判定同时到手，其中**两条把我上一轮给 owner 的话打回去了**（含一条我自己差点读错尾巴）

**① `sell-fee-duty` 跑完 30 发（覆盖 4,528 拍）——先记我的读数错**
- 我最初 `tail -6` 只看到 1 发带运费，据此差点写成"负结果、平均拖累 <1/拍、这条 thread 关掉"。**全量一数是 7/31 发**：
  `round 3/7 → 846`、`round 10 → 452`、`round 14/18/25 → 792`、`round 29 → 633`，`sold` 每次都是 `[1000,]`，其余 24 发 `absent`。
  ⇒ **`tail` 截断把下界当成了估计**（同族：peek 700 字符上的计数只是下界）。**判据类读数必须全量重数，不许用尾几行。**
- 按脚本头**事先写死**的式子算：`feeMean×dutyCycle/50 = 736×0.226/50 ≈ **3.3/拍**`（feeMean=(846+846+452+792+792+792+633)/7=736）。
  门槛是"≥2.5/拍 才值得摆给人" ⇒ **本条达标**，不是负结果。R177 那句"瞬时 13.8/拍"确实被摊薄成 **3.3/拍**，但**没有小到可以忽略**（=G4 门槛的 ~66%）。
- ⚠️**我脚本的 `feeYoung` 字段是坏的**：`grep -o …tradeFeeEnergySell… | tail -1` 取的是**同一房的第二个键**，不是幼房 ⇒ 日志里 `feeCore=feeYoung` 恒等是伪形。
  **房归属改用结构证据而不是它**：`kernel.stats.trade.roomsWithTerminal=1` ⇒ 全场只有核心房有 terminal ⇒ 卖单人只能是 W37S58。**工具侧字段作废，结论靠另一条独立证据支撑**（这条纪律写进记忆）。
- 采样口径两条边界：发间隔实测 **27 次恰为 150 拍** = 3 个核算窗 ⇒ 每 3 窗只看到 1 窗，占比 0.226 是**在被观测窗上的无偏估计**（模 3 相位），但若成交周期恰好是 150 的整数倍会**走样（aliasing）**——同一数值重复出现（792×3、846×2）与此相容但不足以定罪。

**② `core-downgrade-band`：ENGAGE-PASS，而且预测时刻第一次被量到误差**
- `flag=true @tick=83396584`，我 R172 前后写的预测是 **83396623** ⇒ **差 39 拍**（≈2.4 分钟按 3.7 秒/拍）。
- 随后 `flag=false @83396784` ⇒ 进入与退出**各一次**＝保级锯齿**整圈复证（第二次）**。#52 的"非缺陷、设计如此"再确认，无需任何改动。

**③ `g4-durable`：G4 **真的转红了**，而它回头的速度**否证了我上一轮给 owner 的"几小时"**
| 时刻 | tick | 核心房慢 EMA | 幼房慢 EMA | **Σ（G4 判定量）** | G4 |
|---|---|---|---|---|---|
| 04:15:56Z | 83392984 | 4.0071 | 1.0784 | **5.0854** | green（余量 0.085） |
| 05:51:00Z | 83394484 | 4.5803 | 1.0354 | 5.6157 | green |
| 07:26:05Z | 83395984 | 4.0363 | 1.1028 | 5.1391 | green |
| 09:01:10Z | 83397484 | **−0.5695** | 1.0081 | **0.4384** | **RED** |
| 10:13Z | 83398584 | 3.4136 | 0.0389 | **3.4525** | **RED**（`failedGates` 明写 `G4: net flow(v=3.5|netFlow ≥ 5)`）|
- 现状 **Blocked = G0 + G4 + G6**（`HEAD..origin/dev=0`，本轮未换码 ⇒ 不是部署伪影；两房键数仍是 2 ⇒ **不是失房/delete 重播种**，R174 第 3 点里那条分支已被观测排除）。
- **撤回（这次打的是我自己给 owner 的口径）**：R174 我写的"G4 一旦转红，**几小时**不会自己回来"。**实测被打回**：09:01→10:13 的 1,100 拍里 Σ 从 0.438 抬到 3.453（**+3.0/1,100 拍**）⇒ 照此速率**约再 600 拍（≈35~40 分钟）就自己跨过 5**。
  机制上我错在哪：把"τ≈5,000 拍的 EMA"当成了"输入近似平稳"的滤波器。实际上它的输入是 `nf`——**一台自己也在被 50 拍孵化/卖单脉冲（±20~85/拍）驱动的 EMA**，脉冲串里有大量**低频成分**，两级阻尼**滤不掉**，Σ 照样在 ~1,000 拍尺度上翻。
  ⇒ 连带更正 R174 的第 2 条推论（"G3/G4 单次读数有意义"）**方向仍成立、代价那一侧作废**：**红不是几小时的税，是几十分钟的税**。#88 那条"要不要放宽门槛"的请示**时间代价要重写**，别让 owner 按我错的量级权衡。
- `g4-durable` 原判据（≥5/6 绿=DURABLE-GREEN；≥5/6 含红=RED-AGAIN；交替=OSCILLATING）：**目前 3 绿 + 2 红**，剩两发（约 10:36Z、12:11Z）⇒ 大概率判成 **OSCILLATING**，即"门槛在被裁决量的振荡上翻"这一支成立；而我 R174 说"振源只可能是房集合或 Σ 真越 5"——**是后者**（Σ 真越），房集合那条已被排除。
- 与之并置的一条**尚未处理**的对照：同拍 `nf` 是核心房 **−1.53**、幼房 **+3.94**（Σ_fast=+2.4）而门 Σ=+3.45——这次两者**同号**，不再是 R175 那种"两头负"形状。**别急着据此说仪器对齐了**：单发对齐不证明对齐。

**④ 本轮没动 src、没动阈值、没 build、没 push**；#85 仍未到点（tick 83398584，基线目标 83399266 ⇒ 还差 **682 拍 ≈ 25~48 分钟**，`window2/3` 在盯）。市场只读——**没下过单也没撤单**，停不停卖是人的决定。

> **勘误（R181③，10-03 10:1xZ）——R180 表里 "G4/#88" 那一行的时间代价是错的，以本条为准**：
> 原写"**G4 转红后几小时不会自回**（要 τ 级正净流才抬过 5）"。实测 **09:01Z Σ=0.438 → 10:13Z Σ=3.453**，1,100 拍抬了 **+3.0** ⇒ 约再 **600 拍（≈35~40 分钟）**就自己跨过门槛。
> **错因**：我把"τ≈5,000 拍的 EMA"当成了"输入近似平稳"的滤波器；它的输入 `nf` 自己就是被 ±20~85/拍的孵化/卖单脉冲驱动的 EMA，脉冲串含大量低频成分，两级阻尼**滤不掉**。
> ⇒ 给 owner 的口径改成：**红是"几十分钟"的税，不是"几小时"的税**；R180 同表"G3/G4 单次读数有意义"那一支方向仍成立，只是**代价那一侧作废**。

### R182（10-03 10:2xZ）**扩张此刻被冻住的真正原因**：不是 G4/G6，是 `posture=war`；而把它撑到 war 的门槛，正是 #89 那条"永不过期的自改值"**（本轮最有价值的一条，且它打的是我上一轮的话）

**A. 现场链（全部直读，零 console、零部署）**
- `kernel.strategy = {posture:"war", since:83397159, expansionAllowed:false, warPressureTicks:0}`（现在 tick≈83398684 ⇒ **war 已持续 ≈1,525 拍**）。
- `kernel.expansionPlans`：4 条 `st="WAITING_EXECUTION"`，`rd`(=readySince) **83313484** ⇒ **早就晋升过了**，队列不是空的。
- `plan-adapter.ts:67` `isEmpireReady: Memory.kernel!.strategy?.expansionAllowed === true` ⇒ **执行侧的经济检查只有这一个标志**；
  `execution-gate.ts` 的门禁集合是 `GATE_EMPIRE_READY / GATE_TARGET_CLAIMABLE / GATE_PLAN_VALID / GATE_CANDIDATE_VALID / GATE_NOT_OWNED / GATE_NO_CONCURRENT_OP …`——**里面没有 G4，也没有 G6**。
- ⇒ 链条闭合：**war ⇒ `expansionAllowed=false` ⇒ `GATE_EMPIRE_READY` 失败 ⇒ 4 张已晋升的 Plan 原地不消费**。这是设计（`posture.ts:141` 注释："有活敌 / 战争中不打殖民"），**不是缺陷**。

**B. 更正我上一轮给 owner 的话（这次错在归因）**
我 10:1xZ 写的是"扩张被 **G0+G4+G6** 三钉"。对**待执行的 4 张 Plan** 而言这是错的：**G4/G6 根本不在执行门禁里**，它们只挡*新 Plan 的晋升*（以及 posture 自己的 expand 合取项）。
⇒ 正确口径：**今天的扩张阻塞 = 战争姿态一条**（外加"若 G0/G6 恢复后仍需 Σ 净流 >5 才能晋升新 Plan"）。#88 的紧迫性因此**低于**我昨天夜里的描述——先把敌情这条读完再说。

**C. #89 的下场第一次被量到（而且是反向的）**
`kernel.tuning.strategyOverrides` 现值：
- `posture.warPatience = 8000`，`adjustedAt=83287039` ⇒ **已经生效 111,645 拍**；
- `posture.minDwell = 1400`，`adjustedAt=82993339` ⇒ **405,345 拍**（就是我单测里那条"397k 拍仍存活"的用例，今天证实它真的还挂在线上）。
CONFIG 基线是 `warPatience=5,000 / minDwell=1,000`（`config/index.ts:1164/1168`）。
⇒ 也就是说：**这场 war 是在"自己抬高的门槛"下仍然跨过去的**——fortify 必须在敌情新鲜（`threatWindow=3,000` 内有目击）的状态下**撑满 8,000 拍**才升 war。换算 ≈ **4.9~8.3 小时**（按 3.7~1.8… 取实测 3.71 秒/拍 ≈ **8.2 小时**）的持续设防压力。
⇒ 与 R148 的预言对上了方向：**#89 上线 = 松绑 ⇒ 同样压力下 war 会提前 3,000 拍（≈3 小时）发生**。这条现在是**有现场实例的**，但 **#89 仍未部署**，我不自批。

**D. 我读不到的那一个量（写给下一轮，别重复我的失败 peek）**
`rooms.W37S58.phase.lastHostileAt` / `rooms.W38S56.phase.lastHostileAt` ⇒ **都不存在**（`kernel.stats.population` 同样不存在）。
但 `posture.ts:117-122` 要求 war 必须 `threatRecent`（某房 `lastHostileAt` 距 `tick < 3,000`）⇒ 由"war 已在 83397159 成立"反推：**目击时刻 ≥ 83394159**（与台账早前那条 `lastHostileAt=83395412` 相容）。
⇒ 这是**推导不是读数**。`lastHostileAt` 的真实宿主（snapshot/heap 还是别的 Memory 路径）需要下一轮先 grep 写者再读，**不要照我这两个路径试**。
另外 `kernel.escalations` 里有 `mineral/terminal_trade repeats=3 lastAt=83396042` 与 `colony/population_rebuild terminal:true @83369862`——**与敌情同期**，这是 #51/#44 同族那条线，别混成战损。

### R183（10-03 10:2xZ）**我们现在处在"零活敌的战争姿态"**——把它撑住的是威胁记忆窗口，而且我能报出退出时刻（可驳）

**读数（全部现取，`rooms.X.lastHostileAt` 的正确宿主是 `Memory.rooms[X]` 本身，不是 `phase`——我 R182 那两个路径是错的，已纠正）**
| 量 | 值 | 距今（tick 83398684） |
|---|---|---|
| `rooms.W37S58.lastHostileAt` | **83395412** | **3,272 拍前** |
| `rooms.W38S56.lastHostileAt` | **83393907** | **4,777 拍前** |
| `kernel.strategy` | `posture=war, since=83397159, expansionAllowed=false, warPressureTicks=0` | war 已驻留 **1,525 拍** |

**关键：`newRemoteOpsAllowed=true` 说明 `liveThreat` 现在是 false**（`posture.ts:120-122` 那条"零滞回、只读当下视线"，注释原话"敌人撤离即清零，自治立即恢复"）。
⇒ **敌人已经走了，但帝国还泡在 war 里**。把 war 撑住的只剩 `threatRecent` 那条**记忆窗口**。

**窗口有多长——不是我猜的，是被现场反推出来的**（合并链 `DEFAULT → CONFIG.posture → selectEnvBaseline → strategyOverrides`，`empire-strategy.ts:87-92`）：
- 若 `threatWindow` 是 CONFIG 的 **3,000**（`config/index.ts:1162`）⇒ 核心房 3,272 拍已过期 ⇒ `threatRecent=false` ⇒ 走 `posture.ts:195-200`，而 dwell 1,525 ≥ `minDwell` 1,400（override 值）⇒ **早该回落 develop**。它没有。
- ⇒ 生效的窗口必须 **> 4,777** ⇒ 环境画像只能是 `posture-baseline.ts:44-46` 的 **"low"（空旷安全区）：`threatWindow=5,000`**。
- 同 profile 还给 `warPatience=3,000`、`expandMinBucket=6,000`、`expandMaxPressure=0.5`——但 `warPatience` 被自改值 **8,000** 覆盖（R182C）⇒ **进门槛被自己抬高，出门槛没被抬高**。

**两条可驳预测（写死，别事后编）**
- **P1**：`threatRecent` 变 false 的时刻 = `83395412 + 5,000 =` **tick 83400412**（核心房是较晚那一个；幼房 83398907 已过）。dwell 早已 ≥ `minDwell` ⇒ **posture 应在 ≈83400412 落回 `develop`**；按实测 3.71 秒/拍即 **≈12:05Z**。**若它更早翻 ⇒ 我的 "low" 反推错了**（窗口不是 5,000）；**若到点不翻 ⇒ 有一条我没读到的分支在维持 war**（下一站查 `warExitPatienceTicks`/`anyRecovery`/`liveThreat` 的宿主）。
- **P2**：回落 `develop` **不等于解锁扩张**。`expansionAllowed` 由 `expandHealth` 七个合取项算（`posture.ts:150`），其中 `youngestMature` 要求每房 RCL≥5，而 W38S56 **RCL4 已持续 49,245 拍**（`lastRclChangeAt=83349339`）⇒ **扩张的真正长期阻塞是幼房 RCL5**，war 只是这 1,728 拍里的临时顶盖。
  ⇒ 给 owner 的口径合并成一句：**今天挡住那 4 张已晋升 Plan 的，先是一个"零活敌的 war"（预计 ≈12:05Z 自解），随后是幼房没到 RCL5（无到期时间，rcl5-watch 在盯）**。G4/G6 在这条路上**都不在执行门禁里**（R182A）。

**这条为什么值得记（不是八卦）**：设计注释（`config/index.ts:1162` 上方）明确说缩短窗口的理由是"窗口过长会令扩张近乎永久冻结"。但 **"low" 环境反而把窗口拉长到 5,000**，而 invader 目击在低压力区也会周期性发生 ⇒ **每次目击缴 5,000 拍的扩张税（≈5 小时）**，且其中大部分时间是**敌人已经不在场**的纯记忆税。这是 #90 那条"恐吓税/振荡驯化"家族的**同族新形状**（不是振荡，是**单次目击的尾税**），修法方向属人（改 profile 的窗口值 = 改策略），我只立案不改。

### R185（10-03 10:3xZ）**"幼房 RCL4 停了 49,515 拍"不是停摆**（读数否证），以及一条更要紧的结构性发现：**G4 与 RCL5 在构造上互相拉扯**

**A. 停摆假设被现场读数否证**（我 R183 把它写成"无到期时间的长期阻塞"，那半句是错的）
- `rooms.W38S56.controllerProgressChangedAt = 83398876` ⇒ 距今 **~70 拍刚动过**。
- `controllerProgressSeen`：10:2xZ **375,319** → 10:30:32Z **375,591**（两次读，Δ=272）。
- ⇒ 升级在跑。RCL4 之所以"久"，是因为**需求值本身就大**（见 C）。#57 那条"发展停摆"检测器**不该被本条触发**，若它触发了反倒是误报。

**B. 速率两口径互校（我自己的规矩：速率必须两法对上才敢往外报）**
- **现速（差分实测）**：`Δ96 / Δ12 拍 = **8.00 进度/拍**`（工具首发验证，`rcl5-eta-watch.sh`）。
- **长期均速**：375,319 ÷ (83398854−83349339=49,515 拍) = **7.58 进度/拍**。
- ⇒ 两口径差 **5.5%**，互洽。所以 ETA 对速率的敏感度低，**不确定性主要不在速率，在需求值**。

**C. 需求值我现在读不到——这是个仪器缺口，不是我不算**
- `controller.progressTotal` **不落盘**：`room-state.ts:98-101` 只存 `controllerProgressSeen` 与 `controllerProgressChangedAt`；`economy.ts:78` 那个 `progressTotal` 是**工地**的，别混。
- ⇒ 只能给**严格下界**：`REQ > 375,591`（它此刻还在 RCL4 且 progress 已到 375,591）。
- `tower-defense.ts:26` 注释提到"爬 405k"——与下界相容，但**注释不是读数，不当事实用**。
- **两个 session 的 ETA 分歧就是这个未知数**：若 `REQ=405,000` ⇒ 余 29,409 ⇒ @8.00/拍 ≈ **3,676 拍 ≈ 3.8 小时 ⇒ ≈14:1xZ**；而对端 R184 记的 `ETA≈83400570` 反推 `REQ≈389,300`。**别再各算各的**——已由 `rcl5-eta-watch.sh`（pid 82755，40 发×420 秒，判据 RCL5-HIT / STALL-COUNT 写死）**直接观测命中时刻结案**。

**D. 真正的收获：`G4` 和 `youngestMature` 不是两把独立的闸，它们在抢同一笔能量**
- 幼房在升级上的花费：`bk.upgraded = 800` 每 50 拍窗 ⇒ **16 能量/拍**（注意单位：这是**能量**，而 8.00 是**进度**，两者比值 ≈2:1，**不是一回事，别互相换算着定罪**）。
- 幼房的物理净流：R176 实测 `rs` 差分 **−3.5/拍**（帝国累积 +4.9/拍 全靠核心房 +8.4/拍 顶着）。
- 而 `posture.ts:150` 的 `expandHealth` 同时要求：**① 帝国 Σ 净流 ≥5（G4）② 每房 RCL≥5（`youngestMature`）**。
- ⇒ **结构性拉扯**：幼房越认真升级 ⇒ 它的净流越负 ⇒ 帝国 Σ 越贴近/跌破 5 ⇒ G4 越容易挡晋升；**但不升级就永远过不了 `youngestMature`**。这不是测量噪声、也不是我 R181 说的"脉冲恰好压线"，**是两条要求在同一能量预算上对冲**。
- ⇒ 对 #88 的影响（比"门槛紧"更准的说法）：**门槛 5 与"幼房正在被鼓励做的事"方向相反**。可选面因此不是我之前列的那四个形状，而是"要不要为幼房的升级期单独算一笔投资豁免/或把 G4 的口径改成不含幼房升级"——**都属改策略，我不自批**；我只把对冲关系摆清楚，并给一个**可否证的观测钩子**：RCL5 命中之后（预计 ≈14:1xZ），若幼房 `bk.upgraded` 归零、`rs` 差分转负为正的速率跳上来，则 Σ 应显著越过 5 并稳住 ⇒ 本条对冲成立；若 Σ 仍贴 5 摆，则对冲不是主因，回头重读核心房的孵化脉冲（R178 实测 85/拍）。

**E. 现场修正我上一条报告里的一处口径**：我说 W38S56 停 RCL4 是"无到期时间的阻塞"。改为：**有倒计时，量级 ~3.7 千拍，需求值待观测**。同时 `war` 那层临时顶盖预计 ≈12:05Z 自解（R183 P1）⇒ **今天 12:0xZ–14:1xZ 之间扩张可能连续解开两层**，届时 `GATE_EMPIRE_READY` 通过后是否还有第三层，由 `window2/3` 与 #85 之后的读数决定。零 src、零阈值、零 build、零 push。

### R186（10-03 10:3xZ）#93 落地：**RCL 余量从此可直接算**（附反向实验，且**未部署**）

改动很小但缺口是真的（R185 C 段）：`room-state` 只存 `controller.progress`，不存 `progressTotal`，
于是现场只能报速率报不出"还有多久"——同一份读数下两个会话的 RCL5 ETA 差出 ~2,000 拍。

- `src/systems/room/room-state.ts`：在**进度变化的那一拍**顺带落 `controllerProgressTotalSeen`
  （`snapshot.controller` 就是活的 `StructureController`，`progressTotal` 已在手 ⇒ **零额外读盘**），
  并保留旧值兜底（引擎没给分母时不写 `undefined`/NaN）。`src/types/global.d.ts` 加键 + 写明为什么单独存。
- `tests/unit/systems/controller-progress-total.test.ts`（7 条）：写那一拍、余量可算（375,591/405,000 ⇒ 29,409，正是今天的现场数）、
  **进度不动则不刷新**（锁"写在分支内"）、继续爬则跟随、无 controller / 无私服分母时**不得写 NaN**、新房首拍即有分母。
- **反向实验**（这条必须做，否则"绿"不证明覆盖）：`grep -v controllerProgressTotalSeen` 临时摘掉改动 ⇒ **7/7 全红**；还原 ⇒ 全绿。
  ⚠️诚实边界：这证的是"写入被覆盖到"，**不**单独证明第 ②/③ 条能抓住"把写挪到分支外"——那两条的靶心是**位置**，要靠那次挪动才会红。
- 回归：`npx tsc --noEmit` rc=0；`tests/unit/systems` **42 文件 / 430 用例全绿**。
- **部署状态：未 build、未 push**（`dist/main.js` mtime 仍是 05:10、785,155 B ⇒ #85 单二进制窗没被我打断）。
  随下一个带行为批次走。**上线后的现场判效口径**（写死，免得下轮猜）：
  `peek rooms.W38S56.controllerProgressTotalSeen` 必须有值、`Number.isFinite` 为真、且 **> `controllerProgressSeen`**
  （同级内余量为正）；读不到键 = **未上线**，不是"没升级"。核心房 RCL8 那条预期是**保级带口径**（`[10000, >15000]` 是 `ticksToDowngrade` 的带，
  不是 progressTotal）⇒ **别拿那个带去验这个键**，引阈值必写口径。

### R187（10-03 10:4xZ）扩张链**逐合取项重算一遍**：war 退出之后，`expansionAllowed` 只剩 `youngestMature` 一项为假（现场读数，不是沿用 R172 的断言）

R172 说过"唯一假项是 `youngestMature`"，但那是**当时**的。我的规矩是"旧结论会引你去修已经修好的东西"⇒ 本轮用现场读数把七项全重算（出处：`empire-strategy.ts:48-64` 的 rooms 输入映射 + 各 `Memory` 键）：

| 合取项（`posture.ts:150` 一带） | 现场输入（**全部读数**） | 判定 |
|---|---|---|
| `allNormal` | `colonyState`：核心房 `"normal"`、幼房 `"normal"` | ✅ |
| `avgPressure ≤ expandMaxPressure` | `economyPressure`：两房都 **0**；生效上限在 "low" profile 下是 **0.5**（`posture-baseline.ts:47`） | ✅（余量极大） |
| `sponsorReady` | 核心房 `rcl=8 ≥ 7`、`colonyState=normal`、storage **885,923 ≥ 8,000** | ✅ |
| `cpuRatioOk < 0.6` | `kernel.stats.cpuByHome = {W38S56:2.976, W37S58:3.528}` ⇒ Σ=**6.504/拍**；`effectiveLimit=min(20, tickLimit)`=20 ⇒ ratio **0.325** | ✅ |
| `youngestMature`（每房 RCL≥5） | W38S56 `lastRclLevel=4`（进度 375,591，现速 **8.00/拍**） | ❌ **唯一假项** |
| `gclHeadroom`（GCL > 房数） | `kernel.gcl` **不在 Memory** ⇒ 读不到；靠 GCL 单调不降 + R172 当时核穿为真 | ⚠️ 沿用，非本次读数 |
| `bucket ≥ 7000`（`expandMinBucket`，"low"=6,000） | `Game.cpu.bucket` 不落盘；proxy：`stats.trade.bucket=10000` @09:43Z | ⚠️ 间接 |

**两个读数口径的坑，本轮抓到并写死**
1. **`Pressure=HIGH(0.63)`（dashboard）≠ `economyPressure`（合取项用的那台）**。段 3 的 `p` 此刻是 **0**，`Memory.rooms.*.economyPressure` 也是 **0** ⇒ 那句 `0.63` 是另一个量（同名不同物的**第 5 例**）。**差点据此误判"压力项在挡扩张"。**
2. `kernel.capacity.tier="tight"`（since 83387005）是 **G6 用的档位**，与 `cpuRatioOk` **不是同一个判据**——后者只看 creep CPU 占 limit 的比例（0.325），所以 **G6 红并不等于 `expansionAllowed` 的 CPU 项假**。

**于是预测收紧成一句**：war 于 ≈83400412（≈12:05Z，R183 P1）自解之后，**`expansionAllowed` 的真假几乎只取决于幼房 RCL5**（现速 8.00/拍，需求值待 `rcl5-eta-watch` 观测）⇒ 一旦命中，那 4 张 `WAITING_EXECUTION` 的 Plan 应当被消费（执行门禁里没有 G4/G6，R182A）。
**可驳的两条**：①若 war 已退出而 `expansionAllowed` 仍 false ⇒ 我上面某项判错了，优先复核 `gclHeadroom`/`bucket` 这两个"沿用而非读数"的项；②若 RCL5 命中后 Plan 仍未被消费 ⇒ 阻塞在执行侧（视野 `invisible` 跳过、`GATE_TARGET_CLAIMABLE`、或 `hasOtherExpansion`），那要去读 `plan-adapter.ts:39-51` 的按序试跑日志，**不要回来动 posture**。

**顺手记一条与 #93 同族的观测缺口**（不新建单，写在 #93 的延长线上）：`GCL` 与 `Game.cpu.bucket` 都不落盘 ⇒ 凡是想**事后**回答"当时是哪一项在挡"的人，只能靠 posture 自己的当拍读数。修法同上：把**决策那一拍**用到的 `gclLevel`/`bucket` 两个标量随 `kernel.strategy` 一起落盘（零额外读盘，同处刷新），**属取证类、不改判定**；本轮没做（`#93` 已占掉这批改动的额度，且窗内不部署）。

### R188（10-03 10:4xZ）G6 的缺口与唯一杠杆**都用现读数重算了一遍**：杠杆比我 R158 报的更接近够用（2.43 对 2.48，差 0.05 不是 0.2）

`kernel.stats.cpuRate` 现读（`windowTicks=12,519`、`sampledTicks=12,519`、**`unsampledTicks=0`** ⇒ 这台是可信的每拍均值口径）：

- **`total = 14.48/拍`**，而 G6 要 `comfortable` ⇒ 门槛 = `0.6 × min(limit 20, tickLimit 500) = 12.00` ⇒ **缺口 = 2.48/拍**（与 R158 的 2.47 同量级，没漂）。
- **`byPhase` 能闭合**：creeps 7.02 + systems 2.56 + post 2.55 + snapshots 1.46 + segments-flush 0.07 + observability 0.03 + flush-skips 0.01 = **13.70**；`14.48 − 13.70 = 0.78` **恰等 `unphased=0.78`** ⇒ **没有隐藏的 1.2/拍漏账**。
  那条 `unexplained=1.2` 是**截顶减法的产物**（`byRole` 前 10 项 Σ=6.55 而 `byPhase.creeps=7.02`，差 0.47 就是没进前 10 的角色）——**这正是我先前结案过的那件事，本轮用新数复证了一次，别再去追它**。
- **远矿可归因的 creep CPU（三项点名）**：`remoteHarvester 1.37 + remoteHauler 0.60 + reserver 0.46 = **2.43/拍**`。
  ⇒ 这与 R150/R158 当时估的"关远矿省 ≈2.27/拍"**同一量级但略高**，而缺口是 **2.48/拍** ⇒ **`CONFIG.remote.maxOperations` 这一根杠杆单独就差 0.05/拍**，不再是"差 0.20 所以按构造不够"。
  ⚠️三条边界，别让这条被读成"那就关了吧"：
  1. `2.43` 只是**角色侧**；关掉远矿还会连带降 `traffic-manager`（2.54/拍）里属于远矿路径的那部分（**我没拆分它**），所以实际可省量是 `2.43 + x`，`x` 未测。
  2. 代价侧同样重：能量收益 **19.9/拍**（远矿收入）与已建的 **120 段路**，且 `maxOperations` 的超额收缩**会真退役现役 op**（按 pathCost 远的先砍），**不会自撤销**。
  3. 层级口径：G6 判的是 `capacity.tier`（现 `tight` since **83387005** ⇒ 已紧 **~12,000 拍**），而 `tier` 的翻档要 `upgradeWindowTicks=300` 驻留 + `α` 那套，**不是**"降到 12.00 以下当拍就翻绿"。⇒ 报给 owner 的形态应该是：**这杠杆把均值压到 ≈12.05 或略低，翻档还要一段驻留**。
- **归因侧仍无出路（复述以免下轮重查）**：`traffic-manager` 2.54/拍 与 `snapshots` 1.45/拍 已被逐条否证为**结构性成本**（五条"能省"嫌疑全否，`snapshots` 被 role-runner 每拍读、parking 跨拍缓存只占 1~2%），`post` 2.55/拍 也不是内核家务。**低于总负载 5% 的可省项不立案**这条仍在。
- ⇒ **给人的一句话更新**：G6 的杠杆数量级现在对得上了（2.43+x 对 2.48），**决定点从"够不够"变成"要不要为 ≈2.4/拍的 CPU 余量放弃 19.9/拍的远矿能量与 120 段路"** —— 这纯属排产取舍，我不自批。

### R190（10-03 10:5xZ）#94 落地：`expansionAllowed=false` 从此**能被归因到具体哪一合取项**（未部署）

R187 的尾巴——七项里恰好喂给 `gclHeadroom` 与 `bucket` 的两个标量只活在决策那一拍的 heap，
所以事后永远答不出"是哪一项在挡"。现在把**判定实际用到的那两个值**随结果同拍落进 `Memory.kernel.strategy`。

- `src/systems/empire/empire-strategy.ts`：把 `Game.gcl?.level ?? 1` / `Game.cpu.bucket ?? 10000` **取一次存成局部量**，
  同一份值既喂 `evaluateEmpirePosture` 的入参、又写进 `Memory.kernel.strategy` ⇒ **"记录值 = 判定值"是结构保证，不是两次读数碰巧一致**。
  （这条比"再读一遍"重要：分两次读就可能记到一个和判定不同的值，而那正是这类仪表最容易被质疑的地方。）
- `src/types/global.d.ts`：`StrategyMemory` 加 `gclLevel?` / `bucket?`，注释里写清**为什么偏偏是这两项要落盘**（其余五项已可从 `colonyState`/`economyPressure`/`rcl`/`storage`/`stats.cpuByHome` 复算）。
- `tests/unit/systems/empire-strategy.test.ts`（扩到 9 条）：两键等于判定值、`Game.gcl` 缺失记 **1**（兜底值=判定值，不留 undefined）、
  `bucket` 缺失记 **10000** 且有限、以及**加键不吞旧字段**（`posture/since/expansionAllowed/newRemoteOpsAllowed` 仍在）。
- **反向实验（这次是带控制组的）**：只摘掉 `Memory.kernel.strategy` 里那两行 ⇒ **恰好 4 红 / 5 绿**。
  比 #93 那次"全摘全红"更有说服力：控制组（既有 5 条）证明我没碰到判定路径以外的东西。
- 回归：`tsc --noEmit` rc=0；**`tests/unit` 384 文件 / 5209 用例全绿**（日志里那些 `econGuard=FAIL` 是 war-planning 用例故意走的负路径，不是失败）。
- **未 build、未 push**（`dist/main.js` 仍 05:10 / 785,155 B ⇒ #85 窗没断）。⇒ 待推的含 src 提交现在 **5 笔**：
  `8980e00` / `1bc67c9` / `e4dae12` / `4087fc2`（#93）/ **本次**。
- **上线判效口径**（写死）：第一次 `peek kernel.strategy` 必须看到 `gclLevel` 与 `bucket` 两键且有限；
  **读不到 = 未上线，不是"没挡"**。核对口径：`expandMinBucket` 在此环境（"low" profile）是 **6,000**，不是 CONFIG 的 7,000 —— 拿错阈值会把"其实过了"读成"被挡着"。

### R189（10-03 10:5xZ）**G4/G6 不在执行门禁里**（阻塞链路我自己走到底：R187 对、我 R183/R184 错）⇒ **#50 的回报要下调**；G4 红段实测 ≈2,900 拍，而"我上一条预测被推翻"是前提输、模型没输

**一、撤我上一轮的说法。** 我在 R182/R183 写过"RCL5 命中即便消掉 G0 的 `youngestMature` 假项，G4（和 G6）仍会单独挡住扩张"。**逐行核完是错的**：
- `plan-adapter.ts:69` ⇒ `isEmpireReady = Memory.kernel.strategy.expansionAllowed === true`；`execution-gate.ts:102-108` 的 `GATE_EMPIRE_READY` 吃的就是这个布尔，**不是** `evaluateExpansionReadiness` 的 G1..G11。
- `posture.ts:247` `expansionAllowed = expandHealth && !freeze && posture!=="war"`；`expandHealth`（`:150-158`）= `gclHeadroom ∧ allNormal ∧ bucket≥expandMinBucket ∧ avgPressure≤expandMaxPressure ∧ sponsorReady ∧ youngestMature ∧ cpuRatioOk` ⇒ **没有净流项、没有 `capacity.tier` 项**（`cpuRatioOk` 是 creep CPU/limit，R187 现算 0.325 ✅）。
⇒ 正确口径：**dashboard 的 `Blocked` 是"规划就绪度"；那 4 张 `WAITING_EXECUTION` 只等 `expansionAllowed`。**

**二、`capacity.tier=tight` 究竟挡了什么（消费者逐个读，这决定 #50 值不值得做）**
1. `empire-economy.ts:310-318` ⇒ 只喂 readiness 的 **G6** ⇒ 经 `plan-lifecycle.ts:126-150` `applyHysteresis` 挡 **EVALUATED→READY 晋升**（`upgradeTicks:500`）。但同函数 `:132` `if (status!=="EVALUATED" && status!=="READY") return plan` ⇒ **已到 `WAITING_EXECUTION` 的 Plan 不会被降档、也不受 G6 影响**。
2. `remote-mining-manager.ts:131`：只有 **abundant** 才 +1 远矿点，注释明写"constrained/tight 不额外收紧"。
3. 侦察 `prospect-manager.ts:39-40`：要 `expansionAllowed` + **`ctx.budget.tier` ∈ {healthy, guarded}** —— 那是**调度器 CPU 预算档**（同族 `builder.ts:26`/`repair.ts:142` 的 `recovery/conserve` 就是它），现场 observe 打 **"调度tier=healthy"** ⇒ **侦察并没有被 G6 冻住**。
4. `empire-strategy.ts:230-241`：仅落盘/日志。
⇒ **同族第 6 例：两个同名 `tier`**。我 prompt/旧轮那句"G6 与侦察同闸 ⇒ tight 时侦察与扩张一起冻"**机制写错**——一起停是因为**同一个 posture 标志**，不是容量档（R163 当年已为 `exploreParameter` 纠过同一把坑，这是第二处）。
⇒ **#50 的回报按此重写**：砍远矿换来 `comfortable`，对**眼前这 4 张 Plan 的那一次 claim 零加速**；它买到的是"新候选晋升通道 + dashboard 少一条红 + 余额安全边际"，而 `abundant` 的 +1 工业/远矿槽要的是 abundance 不是 comfortable。**同时作废我自己 R111 加进 #50 的代价③**（"tight 冻结自进化可观测性"——探索门用的是调度档，现场 healthy）。⇒ 现在挡扩张的是 **`war`（≈12:0xZ 自解）与 `youngestMature`（RCL5）**，不是 CPU。

**三、G4：我上一条预测的下场 + 红段时长换成实测**
- 我 R184/R116 写"Σ 已见顶、83399000 前后应落回 1.0~1.9"，依据是一发 `nf=−14.99`。**现场**：`nf` 700 拍内翻到 `+11.92`、再到 `+30.06`；Σ `1.924@83398179 → 4.144@83398884 → 5.214@83399204` ⇒ dashboard@83399184 已回到 `Blocked=G0+G6`，**G4 转绿**。**错在把瞬时读数当稳态输入**（我记忆里那一族的又一发，这次是我自己的判效器）；模型的三条都活着：EMA 朝输入走、α=0.02/100 拍、**输入必须 >5 才够得到门槛**（这发正是输入先转正门才绿）。
- **红段实测**：83396284（第一次记 G4 红）→ 83399184（转绿）= **≈2,900 拍 ≈ 2.6~3.0 小时**（拍长 3.6~3.8 秒）；最后那 1 千拍靠一次输入转正收尾。⇒ 以后 #88 的措辞按这个写，不要写"几小时不自回"这种无限期句子。
- **更要的一条**：这次转绿**与停卖无关**（孵化潮过去 + 输入转正）。今晨净流实测摆幅 **−15 ~ +30/拍**，而门槛是 5 ⇒ **门槛 5 落在正常摆幅之内**，G4 注定红红绿绿。⇒ **#88 的问法要改**：不是"要不要放宽门槛"，而是"想让净流稳定在哪个分位、为此愿意少花多少投资"。（R184 那条"饱和响应会吃净流"同时得到反向复证：吃与喂都不需要人动手。）

**四、两个 1 小时内到点的事件（判据现在就写死）**
- **war 尾税 ≈83400412（≈12:0xZ）**：现场 `kernel.strategy.since=83397159`、核心房 `lastHostileAt=83395412`（06:5xZ 那次 **13 拍**目击）⇒ `83395412+5,000=83400412` **与预测时刻逐字相同** ⇒ 出处对上 R184 那笔"单次目击缴 5,000 拍记忆税（low profile）"。**判效**：`G0` 应在此刻前后从 `failedGates` 消失；若 83400412+300 仍在，查 `minDwell`/新目击，**不动 posture**。
- **`storageNearFull` ≈83400250（≈11:5xZ）**：storage `882,323@09:45 → 890,827@10:49` = **+8.63/拍**，触发线 `0.9×1,000,000=900,000` ⇒ 余 **9,173** ⇒ ≈1,060 拍；现读 `false`（ratio 0.8908）。到点后看：①`factory-manager.ts:58`/`industry.ts:459` 的开工条件正好满足 ⇒ 工业线是否出现活动；②`demand.ts` 的"限采+加速消费"是否把 `nf`（+30/拍）压回去 ⇒ 若 G4 随之再红，就是 R184 那条机制的现场复现（不用停卖就能看到）。
- **RCL5 两带并列（`REQ` 仍读不到）**：`controllerProgressSeen=380,599`、`changedAt=83399204` 同拍在动、段内 `+5,008/704 拍 = 7.11 进度/拍` ⇒ 若 `REQ=405,000` 命中 ≈**83402600**（≈13:2x–14:1xZ），若 REQ≈391,305 则 ≈83400570。**出处冲突照实记**：prompt 称"本服 @RCL4=405,000 已现场更正过"，而 R185 判同一数字为"`tower-defense.ts:26` 注释、与下界相容但不当事实" ⇒ 按"锁与路线图优先于 prompt"，本轮**不引 405k 为事实**，结案交给 `rcl5-eta-watch`（pid 82755）与 #93 上线后的 `controllerProgressTotalSeen`。

**五、收尾与边界**：`sell-fee-duty` 30 发已 EXIT（有费窗 5/30 ⇒ 它自己的 `2.46/拍` 按 R116 的结构性漏采**是下界**，运费一律用 `kernel.stats.energyLedger` 差分 3.67~4.38/拍）⇒ **该采样器不要再续接**。#85 到点 ≈10:47Z 仍归对端宣布。本轮零 src、零 push、零 build、零 console（5 台看门狗在飞，全走 Memory API）；探针 observe×1 + peek×2。§3.5 那 7 项一个没动，但 **#50 与 #88 的表述都要按本条重写**。

### R191（10-03 10:5xZ）待推批次的**决策包**（要把"推不推"交给人，就得把风险摊成一张表，而不是留一句"等你点头"）

批次里含 src 的 **5 笔**，按"行为后果"分层（证据链：`tsc --noEmit` rc=0、`tests/unit` 384 文件/5209 用例、`tests/integration` 30 文件/239 用例、两次反向实验）：

| 提交 | 它改的是**行为**还是**仪表** | 上线后会看到什么 | 风险方向 |
|---|---|---|---|
| `c86dd94` #94 | **纯仪表**（多写两个标量进 `kernel.strategy`） | `peek kernel.strategy` 多出 `gclLevel`/`bucket`；判定一字未动 | 极低：Memory 体积 +2 键 |
| `4087fc4` #93 | **纯仪表**（`controllerProgressTotalSeen`） | 幼房 RCL 余量可直接算；判定未动 | 极低 |
| `e4dae12` #89 | **⚠️ 行为，且是战争方向** | 自改参数 15,000 拍后过期 ⇒ `warPatience` 从现场现值 **8,000 回到 CONFIG 5,000** ⇒ **同样的压力会提前 ~3,000 拍（≈3 小时）宣战**；`minDwell` 1,400→1,000 ⇒ 回落更快 | **中：这是"更容易开打"**，且 R183 已有现场实例（当前就是靠 8,000 这道自抬门槛撑着的零活敌 war） |
| `8980e00` / `1bc67c9` | 本会话早前两笔（见各自 commit message 与 R173 前的条目） | 需按 commit 逐笔复核——**我没有在本表里替它们担保** | 未在本次重验 |

**为什么我不自己推**：#89 落在"作战"这一域，改的是开战意愿的时间常数，属于**领域平衡 + 难以当场回收**的那类（推上去=换码=清堆+~400 拍 G6 税，且自改值一旦过期就回不来）。按我的既定权限边界这类必须你点头。
**给你的两个可分开的选项**（都可执行，不是假选项）：
- **A｜只推仪表**：`c86dd94`+`4087fc4` 两笔先上（行为零变化，风险极低），#89 留在本地等你单独裁。技术上需要一次 cherry-pick 出临时分支再推——**要你明确授权我才动历史**。
- **B｜整批推**：一次部署三笔（+另两笔），代价是立刻承担 #89 的"提前 3 小时宣战"效应，收益是自调参系统恢复"必须被持续重新争取"的语义。
- ⚠️**共同前提**：#85 的窗尾 tick 83399266 约 **11:00Z** 到点。**先收 #85 判定再推**，否则一次部署会把那次验证的归因彻底洗掉（这是我自己定过且守了一整夜的规矩：窗内不换码）。

### R192（10-03 10:5xZ）一次**差点把 G6 说成"按构造不可达"**的误读，就地拦下（记下来，这台仪器专门骗这个）

起因是正经的上线前自检：#85 的判定要读 segment 1 的 `ti`，我不想在宣布那一刻才发现读不了 ⇒ 先跑 `capacity-reach.mjs`。工具是好的（`样本数=300 tick 跨度=83396275→83399265`、采样间隔 `{"10":299}`），但它吐出来的东西差点骗了我：

- 它对门槛 **12.00**（`comfortable` 边界）报的是「整条环里最长连续 <12 的 tick 数 = **0**，达标采样步数 **0/291**」，
  且样本列 `cpu` 是 `min=14.2 p50=17.4 max=24.3`。
- 我读到这句的第一反应是："**那 G6 根本不是砍 2.48/拍能开的，得砍 ~5.4**（17.4→<12）" —— 如果我顺着这句写进台账，你看到的选项表就是**假象**（"这闸按构造打不开"），而那只闸恰恰是我这两轮一直说"只差 0.05/拍"的那个。
- **拦住我的是一行代码**：`capacity.ts:52-59` `pickCpuUsagePerTick()` **优先用逐拍均量 `rateTotal`**，只有"窗未建立 / 窗长 < `MIN_RATE_WINDOW_TICKS=100` / 窗内有漏采拍"三种情况才退回 `avg10`。
  现读 `cpuRate.windowTicks=12,519`、**`unsampledTicks=0`** ⇒ **走的是可信那条**：分档输入 = **14.48/拍**，不是 16.6。
- 而 `avg10` 偏高是**这台仪器自己的已知病**，`capacity.ts:41-48` 的注释把它写死了：10 个采样点恰好落在"遥测+刷段都在跑"的重活拍上，官服实测**稳定偏高约 2.6/拍**（同一帝国 avg10=13.2 vs 逐拍=10.6），
  当年正因为这件事**有余量 47% 的帝国被判成 tight**、升档滞回在边界上被反复重置回 0 —— 那次修复才是 `pickCpuUsagePerTick` 存在的原因。
- ⇒ **`capacity-reach.mjs` 的 `cpu` 列量的是"退回仪器"的世界，不能拿来判 G6 可达性。** R188 的口径不变：缺口 **2.48/拍**，杠杆（远矿角色点名 **2.43/拍** + 未拆分的 traffic 份额）**接近够用**。
- **规则带走**（这是"同名不同物"家族的**第 6 例**，但形状新）：前几例是**两个键同名不同义**；这次是**同一个工具输出的两列（样本 cpu 与门槛判定）口径不同**——
  **判"某个闸按不按构造可达"之前，先读那把闸实际的输入选择函数**（`pick*`），别拿"离它最近的那台仪器"当它的眼。
- ⚠️诚实补一句：`avg10=16.6` 与 `rateTotal=14.48` 的**差是 2.12**，与注释里那个"约 2.6/拍"同量级但**不相等**，所以那个偏高量不是常数——
  也就是说如果哪天窗内出现漏采拍而退回 `avg10`，**同一个帝国会立刻被读高 ~2/拍**。这条值得留作 G6 的**仪器风险**，不是今天的结论。

### R193（10-03 10:5xZ）**#85 判效窗收满，判 PASS**——把"我规定的两道前置"都跑到了，也把它覆盖不到的地方写清

**判据原文**（`window2/3` 脚本头写死的唯一 FAIL 形状）：出现 `t > 83390266` 且 `code=3` 的 `TuningAdjust` ⇒ **FAIL**，且 FAIL 只允许指向一件事：事前 binding 判据没接上（去查 `aggregateSignals` 是否真拿到 `Memory.kernel.demandClamps[room]`），**不许放宽判据**。

**到手读数**：`2026-10-03T10:57:31Z [#85 判据] PASS 候选（dc=2 且无 code=3 新提案）` ⇒ 窗尾之后没有那形状的事件。
**我自己在 R135/R178 加的两道前置，这次都真跑了**：
1. **单二进制**：`check-code` ⇒ 线上 = 本地 = `ea4c69da6f8b`（R178 认回，本会话 `remote_ahead=0`，全程未 build）⇒ 窗内**没有第二份代码**混进读数。
2. **通道活着**（防"没提案 ≠ 修好了"那种假 PASS）：`capacity-reach.mjs` 现读 **`ti`（budget.tier rank）n=300、avg=0.000、分布 `{0:300}`** ⇒ 探索/验证通道 `tierRank>=2` 那道推迟闸整段从未生效。
   这条是**加了输出并当场验证过的工具**（先跑通再进判据链——R166 的教训，那次我宁可删工具也没挂未验证的仪器）。

**PASS 能证明什么、不能证明什么（这段是本条的全部意义）**
- ✅ 能证：在 **83390266→83399266 这 9,000 拍 ≈ 18 次评估机会**（R135 量到 tuning 节拍 = 500 拍）里，**"不可绑定的 ↑ 提案"一次都没有存活到被应用** ⇒ #85 的事前 binding 判据**在线上确实拦住了那一类提案**。
- ❌ 不能证：(a) 调优循环整体正确；(b) binding 判据不会误伤**可绑定**的 ↑（那要看有没有 ↑ 被放行，而本窗没有 ↑，所以这条**连方向都还没被测过**）；(c) `dc=2` 是冻结计数旁证，不是本判据的一部分。
- ⚠️**覆盖率的诚实话**：`ti` 来自 segment 1 的环，**只有最近 2,990 拍**，即窗口的**尾 1/3**。窗前端（83390266→83396315）的通道状态我**只能沿用 R165 当时那发**（`avg(ti)=0`）。⇒ 严格说这次是"尾段独立复证 + 头段旧读数"，**不是整窗连续覆盖**。这不推翻 PASS，但请把 PASS 读成"没有 FAIL 形状 + 尾段通道确证活着"。

**由此解锁的是部署决策，不是部署本身**：窗一关，`#93`/`#94`/`#89` 这三笔（含 src 共 5 笔）就**可以**推了——但 **#89 会让 bot 更早宣战**（R183 有现场实例），按我的权限边界这一下归你：**推 / 只推两笔仪表 / 不推**。R191 那张表就是为这个决定写的。

### R195（10-03 11:0xZ）第一次拿到"作战"这一腿的**现场读数**：`posture=war` 打了 2,233 拍，**编队 0 只、战争计划 0 条**——而且这很可能不是 bug，是一个**层次错配**

**读数（带标记的只读探针，`mk:"R194B"` 已核对回读，`tick=83399392`）**
- `total=31` 只 creep，**`combat=0`**（口径：`attacker/rangedAttacker/dismantler/defender` 四类，`COMBAT_ROLES` 出处 `war-planner.ts`）。
- **`warKeys=[]`** ⇒ `Memory.kernel` 里**没有 `warPlan`、没有 `warStandDownUntil`**、没有任何 war/operation/military/threat 键。
- 而 `kernel.strategy.posture` 自 **83397159** 起就是 `war` ⇒ 已经挂着战争姿态 **≈2,233 拍**（≈2.3 小时按 3.71 秒/拍）。

**为什么我把它写成"错配"而不是"坏了"（这是本条的纪律部分）**
- 姿态层的进入条件是**"被打过"**：`threatRecent` 来自 `Memory.rooms[r].lastHostileAt`（本次是 **83395412 / 83393907** 两发目击）。**invader / reserver 这类 NPC 也算目击。**
- 执行层的选目标条件却是**"有一个可信的玩家目标"**：`CONFIG.war` 现读 `interval:10`、**`targetFreshness:1500`**（超过 1,500 拍没更新的视野视为不可信，**不选**）、**`maxTowers:3`**（超过视为不可破）。
- ⇒ 两边口径不同：**把帝国推进 war 的东西（NPC 骚扰），永远不能成为 war 的靶子（要玩家房 + 新鲜情报）**。于是这段时间它既没开一枪，又**照付战争姿态的全部代价**——R182/R183 已经量到 `expansionAllowed=false` 冻住那 4 张已晋升 Plan，而 #92 那条"单次目击缴 ≈5,000 拍扩张税"正是这笔钱。
- ⚠️**我没有证明这是缺陷**：要定罪还差两步，都已写进 #95 的判别量——
  ①读目标选择谓词本身（`war-planning-system` 选靶那段）确认它**只接受玩家房**，不接受 NPC/neutral；
  ②查现场**到底有没有**任何满足 `freshness≤1500 / towers≤3` 的玩家目标（segment 0 的 room intel / segment 5 的 players）。
  若②的答案是"根本没有玩家邻居"，那 `warPlan` 缺席就是**正确行为**，问题只剩"代价该不该由 NPC 骚扰来触发"——那是 **#92 的口径问题**，不是 war 模块的 bug。

**这条对终局目标的意义**：作战这一腿此前只有 e2e 覆盖、**没有任何现场证据**（#20 一直这么记着）。现在有了第一发现场读数：**姿态→计划→编队** 这条链的第二环（计划）与第三环（编队）在真实战争姿态下**从未产出过任何东西**。不管是缺陷还是正确行为，这都是一条必须写进路线图的**能力事实**，而不是"e2e 绿了所以会打仗"。

### R196（10-03 11:0xZ）R195 是**第二发独立复证**，不是新发现（对端记忆里已有 §八）——两发都指向"设计如此"，我的定罪冲动就此收住

查项目记忆时发现 `silent-inert-mechanisms.md` §八 已经记过一件事：**第一次现场观察到 `posture=war` 而执行层一动不动**（他们的读数是全域 0 敌、`adversaries={}`、`agendas=[]`、军事编制 0），并且当场下的判断是 **"别动 posture、别当扩张链坏"**、`#20` 的设计判断被正向确认。

⇒ 我 R195 那发（`mk:R194B`、tick 83399392、`combat=0`、`warKeys=[]`）与它是**同一件事的第二个独立样本**，不是新缺陷。两发的口径差异也记下来免得被读成矛盾：
- 对端的探针集合覆盖 `adversaries`/`agendas`；我的正则 `/war|oper|mil|threat/i` **匹配不到 `adversaries` 这个键名** ⇒ 我的 `warKeys=[]` **不能**被当成"对端那两项也不存在"的证据。两边各说各的，别互相加强。
- 我这边新增的只有**门槛常数**：`CONFIG.war` 现读 `interval:10`、`targetFreshness:1500`、`maxTowers:3`、`squadBase:3`、`squadPerTower:2`、`healerSquadRatio:2`。⇒ 它们给"为什么没有 warPlan"提供了**可核对的候选闸**，但也仅此而已。

**因此 #95 的定性下调为**：*复证中的设计行为*，不是断链。真正留下来的只有 R195 那条**层次错配的观察**（进入 war 靠 NPC 目击，选靶要玩家情报）+ **#92 的代价问题**（≈5,000 拍扩张税买到一个打不了的仗）。这两条都不需要动战争模块。
**这条自我下调的价值**：我今天夜里已经三次差点把"已结案/别人已判过"的东西写成新案（#42 那次、`overflow_loss` 那次、以及这次）。**规矩：立案前先搜项目记忆与债单里同一现象的第二种说法，尤其是当对端会话在跑同一套房的时候。**

### R198（10-03 11:0xZ）我在写下"目击零战损"之前先量了仪器的覆盖范围，**那句话当场不成立**（这条比结论有用）

**我想证的事**（为了给 #92 加一条"这份税白缴"的证据）：两次目击（`lastHostileAt` 83393907 / 83395412）之后帝国升到了 war，但**到底有没有因此掉过一只 creep**。

**第一发读数长这样**：`ring-dump CreepDeath` 过滤 `tick ≥ 83393907` ⇒ **19 条，全部 `natural=1`，非寿终 0** ⇒ 看着像"目击没造成任何战损"。

**但我先去查了覆盖范围**（同一条工具、换个 awk），于是拿到决定性的一行：
```
显示条数=19  首=83398569  末=83399415  跨=846
```
⇒ 环里**保留下来的 CreepDeath 只回溯到 83398569**，距两次目击还差 **2,642 / 5,508 拍**。环容量是按**事件总数 500** 算的（不是按拍），而 CreepDeath 只占其中一小片，所以它的时间跨度被别的类目吃掉了。
⇒ **那句"目击零战损"不成立**：我的 0 不是"那段时间没死"，而是"**仪器没覆盖那段时间**"。这正是我自己记过两次的陷阱（"工具侧截断上的计数只是下界"、"残差只能提假设不能定罪"），第三次是**换成环容量的形状**再来一遍。

**能站住的只剩这句**：**war 姿态期间**（`since=83397159`，覆盖 83398569→83399415 这 846 拍）**19 只 creep 全部寿终、0 只非寿终** ⇒ 这段战争姿态**既没产出战力（R195/R196：`combat=0`、无 `warPlan`），也没消耗战力**。这句话的强度就到这里，别替它加戏。

**下次要真回答"目击有没有造成战损"，正确的仪器是这台**（本轮没读，因为需要一发 console）：
`event-log.ts` 里 M11 的 **fleet-loss fuse 计数**——代码明写"**仅非自然死亡入账**"，且累计在 **`globalCache()`（heap）**上，按 `CONFIG.defense.fleetLossFuse.windowTicks` 惰性清理。
⇒ 它覆盖 **boot 以来**（本 boot 已 ≈12,000+ 拍，**包含两次目击**）⇒ 那才是能直接给答案的读数；代价是 **heap ⇒ `peek` 读不到，必须走一发带标记的 console 探针**，而且**换码就清零**（所以要在下一次部署前读）。

### R199（10-03 11:1xZ）想补读那台"长程战损"仪器，结果**先抓到自己的两个错**：窗口量级读错、超时的形状读错

**错一（写下来才算数）**：我在 R198 的锁里说 M11 的 fleet-loss 计数"**覆盖 boot 以来**"。读了 `CONFIG` 才发现不是：
`config/index.ts:607` `fleetLossFuse: { windowTicks: 200, deaths: 3 }`，而 `event-log.ts:303-306` 的清理保留 **2×窗口 = 400 拍**。
⇒ 它**只覆盖最近 400 拍**，离两次目击（2,642 / 5,508 拍前）更远。**我本来正准备用它去补 R198 那个洞**——幸好先去读了常数而不是先去读结果。
⇒ 连带的正确结论：**帝国现在没有任何"长程战损"仪器**。`CreepDeath` 环只回溯 ≈846 拍（R198）、fuse 数组只 400 拍且住 heap、`Memory.kernel` 里没有累计战损计数器。

**错二（形状问题）**：为读它发了两发探针。
- 第一发 `mk:"R199A"` 回 `ReferenceError: CONFIG is not defined` ⇒ **运行时 bundle 的模块内符号在 console 里不可见**（`CONFIG` 是模块作用域）。这条值得记：以后探针只准用 `Game/Memory/RawMemory/globalThis`。
- 第二发 `mk:"R199B"`（走 `globalThis.recentCombatDeaths`，因为 `globalCache()===globalThis`）**读回 32 秒超时**。按我自己的规矩：**超时 ≠ 返回 null ≠ "没有战损"** —— 它就是**没读到**，不进任何结论。我没有重发第三发（同一时刻连发只会和别的会话抢 `__evalResult`）。

**于是真正留下来的是一条能力缺口**（不是今天能靠读数解决的那种）：
**#90 的定罪判据"持续战损却从未授权 war"按现有仪器根本不可测** —— 它的"持续战损"半边需要的是一条**跨 boot 的战损累计线**，而我们现在只有 400 拍的保险丝和 846 拍的环。
⇒ 已开 **#96**：在 `event-log.ts` 记非寿终死亡的那一处，顺手往 `Memory.kernel.stats` 累加一个 `{natural, combat}` 计数（**只增不减、跨部署存活**），零判定改动、零新读盘，**上线判效就是"下次目击之后这个计数会不会 +1"**。这是本轮唯一"想做但没做"的事，因为它属于取证类可自批，但我选择不在同一批里再塞第三笔 src 改动（窗刚关、待推批次已经压着 owner 一个决定）。

### R200（10-03 11:1xZ）#96 落地：战损线现在**跨部署存活**了（附我那条写错的断言，以及一次作废的反向实验）

**改动**（零判定影响，纯取证）：`event-log.ts` 的 `recordCreepDeath()` 里，紧挨着既有的 `deathAnchor` 写入，
往 `Memory.kernel.stats.deathByCause` 累加 `{ natural, combat }`（只增不减）。类型加在 `global.d.ts` 同一族键旁。
这补上了 R198/R199 量出来的洞：事件环只回溯 ≈846 拍、M11 保险丝只 400 拍且住 heap ⇒ **#90 判据的"持续战损"半边此前不可测**。

**我写错的一条断言（改的是测试不是代码）**：第 4 条用例我原本断"既有 `deathAnchor.hauler` 不受影响 = 81999000"，
红了之后读代码才明白 —— **`deathAnchor[role] = Game.time` 本来就是每拍刷新**（它是 P1 补位时延的起点锚）。
⇒ 期望值写错，正确断言是"锚被推进到 `Game.time`"。**代码没问题；差点把正确行为测成回归。**

**一次作废的反向实验（也记下来，因为它差点被我当成证据）**：
- 第一次我用 `node` 按"整段块"摘代码，切点找错 ⇒ 文件语法断了，`vitest` 报 `Test Files 1 failed / Tests no tests`。
  这形状是**编译失败**，不是"用例变红"。**我差点把它写成"5 条全红"**。
- 第二次改成**按行摘掉那三行写入** ⇒ 干净结果：**4 红 / 8 绿**。
  逐条归因：4 条红正是断言计数器的那 4 条；**第 5 条新用例（`stats` 缺席不抛错）两种代码下都绿** ⇒ 它是**既有守卫的回归锁，不证明我的改动**。
  ⇒ 所以本单的反向实验结论是"**4 条钉住了写入**"，不是"5 条"。

**回归**：`tsc --noEmit` rc=0；`tests/unit` **384 文件 / 5214 用例全绿**（比 #94 那轮 +5，正是这批新用例）。
**部署**：仍未 build 未 push（`dist/main.js` 05:10 / 785,155B）⇒ 待推含 src 的批次现在是 **6 笔**。
**上线判效（写死）**：下一次**非寿终**死亡后 `peek kernel.stats.deathByCause` 的 `combat` 应 **+1**；
若整段没有非寿终死亡，`combat` **保持不动是正确读数**（不是坏了）⇒ 判据必须挂在"一次目击"上而不是挂在时间上。
⚠️别用 `globalCache()`/`CONFIG` 在 console 里验（R199：模块内符号在 console 不可见）。

### R201（10-03 11:2xZ）批次组成的**勘误**：我几轮来一直说"6 笔含 src"，其中**只有 2 笔真的改行为**

R191 里我留了一句"另两笔我没重验、不替它们担保"。这笔账现在补上了，而且补的过程本身纠正了一个我反复引用的口径：

| 提交 | 它到底改了什么 | 判定 |
|---|---|---|
| `8980e00` | `event-log.ts` 里**纯注释**（把"环寿命 ~755 拍"改成"环按事件数 500 封顶 ⇒ 跨度=500÷密度"，实测两发 755/1,123） | **零行为**（我按 `git show -U0` 逐行核过，新增行全在注释块内） |
| `1bc67c9` | **#89 的行为**：`strategy-reviewer.ts` 加 `isStrategyOverrideLive`/`TTL=15,000`，`empire-strategy.ts` 消费侧过滤 ⇒ `warPatience 8000→5000`、`minDwell 1400→1000` | **改行为，且方向是"更早宣战"** |
| `e4dae12` | 把 `resolveStrategyOverrides` 导出 + 新增**合并链末端**的 6 条用例 | 行为中性（重构+测试） |
| `4087fc4` #93 | `controllerProgressTotalSeen` 落盘 | **纯仪表** |
| `c86dd94` #94 | `kernel.strategy` 多落 `gclLevel`/`bucket` | **纯仪表** |
| `8c9b4e3` #96 | `stats.deathByCause` 累计线 | **纯仪表** |

**验证状态（不是推断，是刚跑的）**：#89 那两支测试文件**单独跑过 ⇒ 12/12 绿**（`override-ttl` + `override-merge`）；三笔仪表包含在刚才 `tests/unit` **384 文件 / 5214 用例全绿**里；`tsc --noEmit` rc=0；`tests/integration` 30 文件 / 239 用例绿（#93/#94 那轮跑的，此后我只加了 #96 这笔纯写入）。

**于是"推不推"这件事被削掉一半不确定性**：这一批的**净行为变化 = 一条**，就是 #89 让"更早授权进攻性战争"；其余 5 笔要么注释、要么只多写几个数。
⇒ R191 那三个选项的含义因此更清楚了：**整批推**与**只推仪表**的差别，**恰好就是那一条战争授权时机的改变**，不再混杂"六笔未知改动"的焦虑。
⚠️仍然不变的两点：①一次部署 = 清堆 + ~400 拍 G6 税 + `recentCombatDeaths`/慢 EMA 类 heap 仪器归零（#96 就是为了不再受这个约束而加的）；②推的决定权在你，不在我。

### R203（10-03 11:2xZ）发现并补上一个**一直缺失的 L0 交付物**：§2.3 要求的能力矩阵从未存在 ⇒ 已建 `CAPABILITY-MATRIX.md`

**这不是"顺手整理文档"**。L0 §2.3 明文要求：为 Screeps 核心能力建一份**可持续更新的能力矩阵**，每条 11 个字段（名称／机制依据／实现状态／代码入口与调用链／依赖／现有测试／线上验证情况／已知缺陷／CPU 成本／优先级／验收标准），状态只用七档 `NOT_STARTED→DESIGNED→IMPLEMENTED→INTEGRATED→TESTED→LIVE_VALIDATED→STABLE`，且"**只有满足相应证据要求才能推进状态**"。

**核查结果**：全仓 `grep -rl "LIVE_VALIDATED"` **只命中 L0 文档自己** ⇒ 这份矩阵**从未被建立**。我今夜一直在维护 `EVOLUTION-ROADMAP.md`（事故＋优先级＋更正），它满足的是 L1 的"优先事项／缺口／验收标准"，**不满足 §2.3 那份按能力组织、带证据档位的东西**。这是 completion audit 意义上的**真缺口**，不是我风格偏好。

**已建 `CAPABILITY-MATRIX.md`，并且按 L0 的证据纪律只填今夜能引用证据的 11 条**。三处刻意保守：
- **军事只给 `TESTED`**（e2e 有：22-war-ledger／21-decoy-auth；但"能打仗"无现场证据，反倒有两发"零编队零计划"的读数）⇒ **不给 `LIVE_VALIDATED`**，其前置是需要真实敌情，而**我不制造敌人**。
- **Power Creeps 给 `IMPLEMENTED` + 明写"线上未核查"**（核心房已 RCL8，前置满足但没取过读数）⇒ 不猜状态，登记为下一件事。
- **文末单列"尚未入矩阵的能力 = 本文件的已知不完整性"**：L0 §3.1–3.8 覆盖面远多于 11 条，其余我**没逐条核过代码入口就不填**（填了就是伪造），并给了补齐次序（情报体系排第二，因为它直接连着 #95 的选靶闸）。
**推进规则也写进文件头**：`TESTED` 要给出得绿的测试路径；`LIVE_VALIDATED` 要给 sha／读数时刻／判据；`STABLE` 额外要**同一现象的第二发独立复证** —— 这一条是今夜三次"只有一发读数就下结论"换来的。

**顺带一条 L0 对账**：§1.5 明文把"生产代码部署、主动战争、改变外交关系"划入须授权行为 ⇒ 我今夜**没有** 自批推那批（含 #89）、没有下过/撤过市场单、没有制造敌情，边界与此前记忆一致。**该条不需要改代码，只需要一直守着。**

### R207（10-03 11:4xZ）#95 到底了：**战争候选漏斗有五道闸，五道全不留痕** ⇒ 结案为"不可归因"，并立 **#99**

先记一次差点踩到的坑：`war-planning-system.ts` §3 的**函数注释写着"从 `Memory.rooms[].intel` 采集候选"**，而我今夜实测过那个键**不存在**。照注释读就会得出"战争系统读的是一个空键 ⇒ 永久无目标"这条**假根因**。真实数据源是 `queryRoomIntel()`（heap，见 §12），注释是旧的。⇒ **注释只当线索，判数据源要读函数体。**

**实际的闸（`buildTargetCandidates`，`:269-291`）**，逐条列出：
1. `!intelActionUsable(entry.subject, tick)` ⇒ **非 fact 级情报直接不进候选**（注释引 `INTELLIGENCE §5`）；
2. `!e.owner || e.owner === myUsername` ⇒ 无主房 / 我方房；
3. `e.kind !== "normal"` ⇒ 非 normal 房；
4. 结构化打标：`occupied`（= 我方房 ∪ **远矿目标** ∪ 扩张目标）、`blacklisted`；
5. 下游阈值：`freshness=CONFIG.war.targetFreshness(1500)`、`maxTowers(3)`、`maxDistance(10)`。

**关键观察：1/2/3/4 全是裸 `continue`，一行日志都不留。**
⇒ 结合现场数（`intelCoverage={rooms:7, players:2}`，`combat=0`，段 5 从未写入，`Candidates=12(Q=2,R=6,U=4)` 是扩张侧），最可能的解释是：**我们能看见的房要么无主/NPC 占据（被 2、3 挡），要么正被我们自己当远矿用（被 4 挡）**，于是候选恒空。
**但这仍然只是"最可能"，不是被证明的** —— 因为**五道闸都不计数**，事后谁也分不清是"没有情报"、"情报不是 fact 级"、"被 occupied 挡了"还是"tower 太多"。

⇒ **#95 结案方式改为：不可归因（非缺陷、非健康，是盲区）**。矩阵 §8（军事）的 `LIVE_VALIDATED` 前置因此不是"等一场真仗"，而是**先有漏斗计数**。
⇒ 立 **#99**：把这五道闸各加一个**每拍清零、按 tick 落一次**的计数器（形如 `stats.warFunnel={intel,notFact,noOwner,notNormal,occupied,blacklisted,stale,tooManyTowers,candidates}`，写在与 `intelCoverage` 同一个 100 拍批处理里，成本≈0、零判定改动）。**这才是我今夜该立的那笔观测缺口**——它由读码得到、由现场数支持、且#95 的整条判断链都依赖它。

### R209（10-03 11:4xZ）#95 的归因**不用改码也能先削两类**：blacklist 贡献 0，`occupied` 已吞掉我们自己的远矿房

R207 说"五道闸零计数 ⇒ 不可归因"是对的，但其中**两道的答案本来就在 Memory 里**，不必等 #99：

- **`kernel.warBlacklist` ⇒ 不存在** ⇒ 第 4 道里的 blacklist 这一支**贡献 0 个排除**。⇒ "**被黑名单挡光**"这条假设**当场排除**。
- **`kernel.expansion` ⇒ 不存在**（CP5 字段已退役）⇒ `occupied` 里**没有扩张目标**这一支。
- **`rooms.W37S58.remoteOps` 实读：`W37S57` state=active**（`createdAt 82983625`、`dangerUntil 83398545`、`roadSiteCount 3`、`ledger.d=3,930,341`）
  ⇒ `occupied` **至少含 W37S57**（幼房的远矿列表被 700 字符截断，未计）。
- 结合 `intelCoverage={rooms:7}`：漏斗粗算 **7 − 我方 2 − 自家远矿目标 ≥1** ⇒ 进入 owner/kind/fact 三道筛子的顶多 **3~4 个**，而那三道任一不过就归零。**这仍不是定罪**，但把"是不是被自己占掉了"从猜测变成了**有下界的算式**。

**另一条不该被读成好消息的观察**：`W37S57` 那个 op 上挂着 **`dangerUntil=83398545`**，比 `lastHostileAt=83395412` 晚 **3,133 拍** ⇒ **敌意在"war 已挂起"之后仍在刷新**，而且刷的是远矿房。
⇒ 这把 #92 的图景补全了：**我们挨打的是远矿线，而 war 的靶子却必须是玩家房**；`players=2` 说明"认识玩家"，但被打的那间房（W37S57）在我方 `occupied` 里 ⇒ **挨打的位置恰好是不可打击的位置**。#99 的计数会告诉我们这是全部原因还是部分原因。
（`war-planner` 的存续期证据复核 `war-planner.ts:135` 也已读到：`planTimeout(6000) ≫ targetFreshness(1500)` 是**已修的**旧问题，不是本次嫌疑。）

### R208（10-03 11:5xZ，巡检侧 R118）**战争链第一次在现场出计划**：`kernel.warPlan` 落盘（DEFENSIVE／DEFEND／目标=被侵的自家幼房，`spawned=0`、`a5ForceReq.total=0`）⇒ R195/R196 的"零编队"不再是谜；幼房 `towerSpendCombat` 第一次非零；"零战损"这次是**可判的负结论**（环覆盖够住整场 44 拍的战斗）

**现场（零 console）**：`EnemyInvasion@83399845 W38S56` → `TowerVolley` 38 发（单塔，83399840~83399862+）→ `EnemyCleared@83399888` ⇒ 在场 **≈44 拍**；`ColonyStateChange [2,3]@83399845` / `[3,2]@83399895` ⇒ defense 段 50 拍，与 R113 的 `defenseExitHysteresis=50` 自洽。今夜第 5 次目击、幼房第 3 次。

- **计划侧读数**：`kernel.warPlan={targetRoom:W38S56, sponsor:W38S56, squadSize:9, since:83399844, towersSeen:0, phase:"advance", spawned:0, operationId:OP-83399874-0, warPosture:"DEFENSIVE", operationType:"DEFEND", warPlanHash:4e5d7372, a5ForceReq:{attacker:0,healer:0,tank:0,dismantler:0,total:0}}`；环里 `WarPlanCreated` 5 发 = **4 发战略**（`war-planning-system.ts:74`，payload=`[status码, priority.score]` ⇒ 0 与 ≈53）+ **1 发战术增援需求**（`tactical-runtime-system.ts:786`，payload=`[urgency,count]`=`[0,50]`，注释写明"只声明需求，孵化由 war-planner 的 submitSquadRequest 执行"）。
- **对 R195/R196/#95 的补件（不是推翻）**：①**"零计划"被现场否证**——计划真落盘了，带 sponsor/hash/优先级 ≈53。②**"零编队"成立但原因可见**：`a5ForceReq.total=0`、`spawned=0`、`W38S56.spawnQueue=[]` ⇒ 战术喊了 `[urgency=0,count≈50]` 而战略没把它变成兵力请求；结合"敌 44 拍被塔清空 + urgency=0"，这是**威胁先于兵力消失的良性收敛**，不是断链。⚠️**要定罪得等一次"敌在场 > war-planner 一个 interval 而 `a5ForceReq` 仍 0"**——今天没有，我也不制造。③**"层次错配"被加强**：唯一一次真进犯产出的计划目标是**我们自己的幼房**（DEFEND），不是任何玩家房 ⇒ "把帝国推进 war 的东西打不到人"这句话现在有正面样本。
- **代价与战损**：`W38S56.towerSpendCombat=900`（累计 `towerSpent=8,630` 的 10.4%）⇒ 幼房塔第一次有"打敌人"的能量记录。战损：环覆盖 `83399093→83400091` **包含整场战斗**，其间 `CreepDeath` 全 `natural=1` ⇒ **本场零战损是可判的负结论**（R198 抱怨的"环只回溯 846 拍"在此不构成障碍；也别把它推广成"目击零战损"，那是已撤的过头话）。`kernel.stats.deathByCause` **不存在** ⇒ #96 未上线（与 R201"未 build 未 push"自洽）。
- **两问留给 #80 域（不立案）**：①`warPlan.towersSeen=0` 与同场 38 发 TowerVolley 的口径关系（敌塔 vs 自家塔可见数）——没读到写者不猜；②核心房 `towerSpendCombat=660` 从 07:47Z 到 11:4xZ 一字未动，而 06:5xZ 核心房有 6 塔 5 轮齐射 ⇒ **我没有战前基线，因此既不能说漏记也不能说记对**；要判只能抓下一次齐射的**前后两发**。

**G4 / 满仓 / RCL5 当前位置**
- **G4 绿，且核心房单房已过线**：`gateNetFlow={W37S58:5.5817, W38S56:0.4869}` ⇒ **Σ=6.069**@83400065（R189 那发 5.214@83399204）。⚠️**幼房那一台在跌**（0.719→0.487）而它的升级功率刚从 8 涨到 **16.00 进度/拍**（`rcl5-eta-watch` round8-11 四发同值）⇒ **R185-D 的对冲第一次在现场看得见**：幼房越认真爬级，对 Σ 的贡献越小，现在全靠核心房一台顶。
- **`storageNearFull` 仍未翻**（false；storage 896,514 ⇒ ratio 0.8965，距 0.9 触发线余 **3,486**）。我 R189 预测 ≈83400250 翻真，按现涨速（+6.3/拍而非 +8.63）实际要到 **≈83400615** ⇒ **晚 ≈365 拍，错因是速率不是模型**。判据保留：翻真后看 `demand` 的"限采+加速消费"是否把 `nf`（现 +30/拍）压回去 = R184"饱和响应吃净流"的现场复现。
- **RCL5 落在两个 war 退出时刻之间**：progress 392,247、rate 16.00 ⇒ 到 405,000 需 797 拍 ⇒ **≈83400800**（≈12:2xZ，前提 `REQ=405,000` 仍待 #93 上线后证实）。war：`strategy.since=83397159`，而 **83399840 又有一次目击** ⇒ 退出取决于窗口键：①首次目击 `83395412+5,000=83400412`（R189 押的就是它）②最近目击 `83399840+5,000=83404840`（≈14:5xZ）。**判别式**：若 ≈83400412 退 ⇒ 按首次/按房各自计；若挺到 ≈83404840 ⇒ 按 `max(lastHostileAt)`，则**每次目击把扩张再推 5,000 拍**，#90 的"骚扰税"就有定量口径（今天两次目击已足够把 RCL5 之后的门再推一次）。⚠️届时我这条预测被否**多半是前提变了而不是模型错**，按那一类写。
- 其余：`Blocked=G0+G6`@83399984、`tier=tight@83387005`（≈13,000 拍）、调度 tier=healthy、`Budget 355,293/960,248`、候选 Q2/R6/U4、`errorsPerTick=0`；`credits 12,642,148`（第五发差分 **+381,339/≈1,000 拍**）、`runs=67`、`terminalEnergy 10,343`。

**边界**：零 src、零 push、零 build、**零 console**（对端 R207 刚写过 11:4xZ，我刻意不碰 `__evalResult`）；探针 observe×1 + `ring-dump`×2（段道）+ peek×1。§3.5 属人 7 项一个没动，也没为制造证据做任何事。**下一轮第一件事：war 按哪条退出（①/②）；第二：RCL5 是否命中 ≈83400800 并核 `expansionAllowed` 与那 4 张 WAITING_EXECUTION（执行门禁只认 expansionAllowed，见 R189）。**

---

## R211 · 2026-10-03 12:3xZ（#99 漏斗计数落地 + 一场真进犯把 #95 的前提改写了）

### 本轮主目标：#99 战争候选漏斗计数（可自批的观测缺口）

按锁里 11:47Z 的规格落地，**零门槛改动**（`CONFIG.war.maxTowers/targetFreshness/maxDistance` 一个没碰）。

**计数点（`war-planning-system.ts`）**：`buildTargetCandidates(tick, funnel)` 里原先的三个裸 `continue` 各留一位，
并按现场需要拆细——① `notFact`（`intelActionUsable` 拒）② `unowned` 与 ②′ `mine`（**规格里是一条 `noOwner`，我拆成两条**：
"看不到归属"与"视野里只有自家"是两种相反的现场，合并会把"侦察不足"读成"没有敌人"）③ `notNormal`，
外加 `intelEntries`（池子规模）与 `candidates`（活过前三道的条数）。终局四位数 `noInput|noThreats|noPlan|plans` 恰有一项为 1
（闭合不变式，写进用例）；另加 `noSponsor`（有计划但孵主解析失败 ⇒ 计划不落笔）。
**后四道闸不在这里计**：它们在 domain 的 `selectTarget` 里、拒因已随 `rejectedAlternatives` 进计划，
在系统层复制一份判据只会与真判据漂移（规格里那"各留一位"我按这条撤了）。

**落盘点**：`globalCache().warFunnelScratch`（每 pass 换新对象）→ `intelligence.ts` 老化批（100 拍）与
`stats.intelCoverage` **同拍**快照进 `Memory.kernel.stats.warFunnel`（`{...funnel}` 拷贝）；
`scratch` 为 undefined 时**不写** ⇒ 缺键是"war-planning 自 boot 没跑过"这一态，写成全零会被读成"跑过且每道筛子都空"。
类型落 `global.d.ts`（含 `tick` 语义警告：**被计量那一拍**，不是快照时刻，也不是 `energyLedger.tick` 那种 boot 时刻）。
`tests/support/factories.ts` 补 `delete g.warFunnelScratch`（漏清会让"本 pass 候选为 0"读到上一条用例的残影）。

### 写单测时读码撞出来的结构事实（比计数器本身值钱）

**`buildTargetCandidates()` 的产物今天根本不在决策路径上。** 链条逐环读死：
`deriveOperationType()` 对 10 个 `ThreatIntent` 的全部分支只返回 `DEFEND | ESCORT | RETREAT` ⇒ `isOffensive()` 恒 false
⇒ `deriveTarget()` 必走防御支、目标＝**受威胁房本身**（`roomName: threat.roomName`），
`selectTarget()`（连同 `occupied/blacklist/targetFreshness:1500/maxTowers:3/maxDistance:10`）在生产链上**进不到**，
唯一调用者是手递进攻夹具的 `tests/unit/military/war-planning-a5-3.test.ts`。
三条推论：①**帝国今天没有进攻能力**（不会主动打任何一间房），这比 #95 更上游；②我 09-30 记在能力矩阵里的
"层次错配（进 war 靠 NPC 目击、选靶要玩家房+新鲜情报）"**两边都不在路径上，咬不到** ⇒ 已当场在 §8/§12 更正；
③#95 的"零计划"只可能由 `noThreats` 解释，"候选被筛光"不是它的解释。
⇒ 用例里我把这条写成断言（候选池为空仍 `plans=1` 且 `warPlan.targetRoom===HOST`），不是写成注释。

### 线上第一读（本轮零 console；observe×1 + ring-dump×1 + peek×1）

**①#95 的前提被现场否证：计划不是零。** 事件环 83399850→83400720（870 拍）里 `WarPlanCreated=8`、`WarOutcome=2`。
归属按写者逐条对上（同一 kind 三个写者 ⇒ 只按 kind 计数会混）：war-planning-system 7 条（W38S56×3、W37S58×3、
一条被 tactical-runtime 复用的 `tac-W38S56-83399844`），`recovery-execution:1238` 用 `d[0]=-1` 那条是"止损被消费"不是战果。
两条真 `WarOutcome` 全是 `d=[2,0,5]` ⇒ outcome=**unknown**、**spawned=0**、reason=**5=TARGET_SWITCH**。

**②围困 30 拍，税 5,000 拍（167 倍），#92 第一次量到比值。** W38S56 目击@83399840（`EnemyCleared`@83399885）；
W37S58 目击@83400215→`EnemyCleared`@83400245 ⇒ 两波现场各 **≤45 拍**，而 `hostileAt` 之后帝国要在
`posture=war` 里挂 `threatWindow=5000` 拍。`strategy={posture:war since:83397159 expansionAllowed:false warPressureTicks:0}`。
**我自己的预测要当场改**：R210 那发把退出时刻锚在 83395412+5000=83400412，实际 `posture-exit-watch` round13@83400684 仍 war
——不是判据坏，是**新目击把计时器重置了**（现按 `max(hostileAt)=83400220` ⇒ 退出 **≈83405220，≈14:2xZ**）。
⇒ 纪律进记忆：**"事件后 N 拍"型的预测，锚必须是同型事件的最新一发，且每次读数先复查锚点有没有被刷新**（这是第 6 类样本出处错）。

**③零编队的机制读死（不算新案，留可检验预测）**：`warPlan={targetRoom:W37S58 sponsor:W37S58 operationType:DEFEND
squadSize:32 a5ForceReq:{attacker:0,…,total:0} spawned:0 phase:advance since:83400214}`。
`squadSize=32` 与 `a5ForceReq.total=0` 是 FINDING-08 注释里点名的那对两 producer（`decideSquadSize` vs A5 编制），
`spawned=0` 与"波次只活 30~45 拍 < 一次孵化+通勤"两个解释同时成立 ⇒ 本轮不立案。
**留下可驳预测**：下次出现**持续 >200 拍**的围困时读这两处——若 `a5ForceReq.total` 仍 0 而 `spawned` 仍 0，
则两 producer 分歧是真的在挡补员（立案并查 war-planner 用哪一侧）；若 `spawned>0`，则 32/0 分裂只是和平期残影（结案）。

**④战损**：环内 18 条 `CreepDeath` 末位全 `1`=寿终（`d[3]` 617/1523~1643 都贴着名义寿命线）⇒ **两波进犯 0 战损**，
#90 的"持续战损"半边仍凑不齐；`deathByCause` 未推 ⇒ 线上无处可查（`peek kernel.stats.deathByCause = ?`）。

**⑤其余**：`intelCoverage={rooms:7,players:2,tick:83400703}` 新鲜 ⇒ 老化批活着，#99 上线后 `warFunnel` 会紧挨着它出现，
**判据：`warFunnel.tick` 落后读数 <20 拍**（超过即 war-planning 没跑）；`warBlacklist` 不存在=从未拉黑过任何房；
G4=green@83400384（`g4-durable` round6，Σ=4.851+0.798=5.649 对门槛 5）**而同一拍核心房快仪 nf=−16.31/拍** ⇒
这是 R184 说的"回声"第二发实例（慢 EMA 高于输入必回落，可驳）；`Blocked=G0+G6`、`tier=tight@83387005`（≈13,700 拍）、
cpuRate.total=**14.44/拍** 对 12.00 ⇒ G6 缺口 2.44/拍未变；核心房 storage 891,913（R210 那发 896,514 ⇒ **在跌 −6.6/拍**）
、幼房 `rcl=4` progress≈402.4k/405k、rate 16/拍 ⇒ **RCL5 落点 ≈83400900（≈12:3xZ，`rcl5-eta-watch` 在看）**；
`credits 12,820,813`（自 R210 差分 **+178,665/≈700 拍 ≈255/拍**）、`runs=71`（+4）、`terminalEnergy 10,233`。

### 交付与边界

新增 `tests/unit/military/war-funnel.test.ts` 8 用例；`npx tsc --noEmit` rc=0；`tests/unit` **385 文件/5222** 全绿
（基线 384/5214 ⇒ +1 文件 +8 用例）、`tests/integration` 30/239 全绿；`lint` 0 error、`format:check` 仅剩
`tests/unit/movement/traffic-cost-scaling.test.ts` 一条**非本轮引入**（我没碰那文件，`git status` 干净）。
**反向实验逐条剥除（`tmp/tools/official/rev-99.sh`）**：`notFact`/`unowned`/`mine`/`notNormal` 各 ⇒ 恰 1 条红；
`candidates` ⇒ 3 条红；`intelEntries/noInput/noThreats` ⇒ 各 1 条红；`plans` ⇒ 2 条红；剥落盘快照 ⇒ 1 条红，
而"未上线"那条**仍绿**（缺席断言的固有盲区，写在这里免得下轮把它当成有效判据）；全部还原后 8/8 绿。
⚠️工具坑一条：**会把文件改坏的脚本别接 `head`/`tail`**——`rev-99.sh` 第二遍跑 `| head -28` 时被 SIGPIPE 在
cleanup 之前杀掉，`funnel.candidates=…` 那一行留在被剥除状态（`  ;`）；是 `git diff` 抓出来的，已复原并复跑全绿。
⇒ 纪律：**反向实验脚本自己也要"改完立刻 `git diff` 核对"**，判"改动生效"之前先判"工具没被半路杀死"。

**零 push、零 build**（`dist/main.js` 不动，本轮 4 个 src 文件改动随批走；批仍等人对 #89 的裁决）、**零 console 探针**、
§3.5 属人 7 项一个没动。#99 的状态改为"已实现+单测+反向实验·待随批推"，并新增两条待办：
**#100 能力矩阵 §8 已改口但"进攻链未接线"要不要修属人**（要么给 `deriveOperationType` 增加进攻分支＝动战争能力，
要么把 `selectTarget` 那 200 行判据标为"未接线的储备"），**#101 观察项：warPlan 两 producer 分歧（32 vs 0）**。

### R211 勘误与并案（写完才看见对端 `6c96aab` = 巡检 R208 已记同一场战斗）

**我上面"③#95 的零计划被现场否证"那一条不是新发现**——对端 R208 已先记下，且比我多两半：
第一个计划是 `warPlan={targetRoom:W38S56 squadSize:9 spawned:0 operationType:DEFEND}`@83399844
（我读到的 32 是**第二个**计划 W37S58@83400214），以及幼房 `towerSpendCombat` 第一次非零 **900**（占 towerSpent 10.4%）。
⇒ 按"同一现象先搜有没有第二家记"的纪律撤重复立案；留下的净收益是**一次独立复证**：
两个计划（幼房 9、核心房 32）**都 `spawned=0`、都是 `DEFEND`、目标都是自家房** ⇒
"只防不攻 + 兵力未落地"两条各有两发样本，比单发可信。

**war 退出锚点现在有三个数，别再各引各的**：83400412（R210 用 83395412+5000）／83404840（对端用 83399840+5000）／
83405220（我用 `max(hostileAt)=83400220`+5000）。判据统一成一句话：**退出时刻 = 最新一次 `hostileAt` + `threatWindow(5000)`**，
读数前先从 `Memory.rooms.*.hostileAt`（或 observe 的 `hostileAt` 列）取最大值再算，不许沿用上一轮的锚。
**按 `posture.ts:167-200` 核过没有附加项**：`threatRecent` 一 false 就走"威胁消退"分支，
那里的 `minDwell=1000` 量的是**姿态驻留**（`since=83397159` ⇒ 到点已驻留 ≈8,000 拍，早已满足、不 binding），
而 `warExitPatienceTicks=1000` 是另一条出口（`avgPressure > warMaxPressure` 才累加，现读 `warPressureTicks=0` ⇒ 从未累加）
⇒ 若到 83405220 没退，只有两种解释：又有一次新目击（先看 `hostileAt`），或压力那条被踩到（那时 `warPressureTicks` 会非 0）。
⇒ 这也把 #92 的代价口径钉成"每次目击把扩张再推 5,000 拍"，与对端"若挺到 83404840 则成立"的判别式是同一件事。

本轮**独有**且未被记的：#99 计数落地（4 src+1 测试，反向实验逐条归因）、
`deriveOperationType` 的 10 分支穷举 ⇒ 进攻选靶链**无产线调用者**（升 #100 请示）、
`warPlan.squadSize` vs `a5ForceReq.total` 两 producer 分歧留 #101、
以及工具坑一条（会改文件的脚本不接 `head`/`tail`，SIGPIPE 会在 restore 前杀死它）。

---

## R212 · 2026-10-03 12:4xZ（RCL5 命中——它没打开扩张闸，原因读死了）

### 里程碑与它没兑现的那一半

`rcl5-eta-watch` round19@12:37:46Z ⇒ **W38S56 level=5**，命中参考 tick=83400860，新级别已累 935 进度；脚本按 ROUNDS 正常下班（不是未到点退出）。这是 #88 那条对冲里"每房 RCL≥5"这一项**第一次为真**。

但 24 拍后的现场读数（`kernel.expansionDashboard@83400884`）：`Readiness=NOT_READY`、
`failedGates=["G0: posture expansionAllowed(v=false|posture.expansionAllowed === true)","G6: CPU tier(v=tight|tier ≤ comfortable)"]`
⇒ **RCL5 落地对扩张没有任何即时效果**。根因是一条合取式（`posture.ts:247`，本轮读死）：

```
expansionAllowed = expandHealth && !liveThreat && posture !== "war"
```

### 七个合取项逐个对上现场读数（`expandHealth`，posture.ts:142-157）

| 合取项 | 门槛（活 profile） | 现场 | 判定 |
|---|---|---|---|
| `gclHeadroom` | `gclLevel > rooms.length`（=2） | GCL 在 Memory 里**读不到**（`kernel.environment.gclProgress=6,174,486` 只是量级暗示，语义未证） | **未知** |
| `allNormal` | 两房 colonyState=normal | observe@83400705 两房 normal | ✓ |
| `bucket` | ≥ 7000（DEFAULT）／6000（low） | 10,000 | ✓ |
| `avgPressure` | ≤ 0.4（DEFAULT）／0.5（low） | **`rooms.*.economyPressure=[0,0]`** | ✓ |
| `sponsorReady` | RCL≥7、normal、无活敌、storage≥8000 | W37S58 RCL8 / 891,913 / Cleared@83400245 | ✓ |
| `youngestMature` | 每房 RCL≥5 | 刚命中 | ✓ |
| `cpuRatioOk` | `totalCreepCpu/20 < 0.6` | 角色 6.6/拍 ⇒ 0.33 | ✓ |
| **`posture !== "war"`** | — | `posture=war since=83397159` | **✗ ← 唯一在挡的那一项** |

⚠️**同名不同源第 5 次踩点，这次拦住了我**：dashboard 写 `Pressure=HIGH(0.65)`，第一眼像"压力项在挡"。
但 `expandHealth` 吃的是 `rooms[].economyPressure` 的均值，observe 那列 `pressure=0` 才是决策路径上的量，
一 peek 精确路径就证伪了（`rooms.W37S58.economyPressure=0`）。⇒ 纪律：**看到"Pressure"先问是哪一位消费者的**。

### 由此得到一条很硬的可驳预测

**到 tick ≈83405220（≈17:2xZ 本地 / 12:4xZ+4.6h）war 尾税自然到期，若 `gclHeadroom` 为真，`expansionAllowed` 会在同一拍翻 true，
执行闸（`plan-adapter.ts:67` 只看 `expansionAllowed`）会真的去 claim 第一张 WAITING_EXECUTION 的 W37S56。**
锚算法：`max(lastHostileAt)=83400220`（W37S58，EnemyInvasion@83400215）+ `threatWindow=5000`
（`kernel.environment.neighborPressure="low"` ⇒ `posture-baseline.ts:46` 那条分支覆盖 DEFAULT 的 3000）。
已核 `minDwell=1000` 不 binding（姿态已驻留 ≈3,700 拍且到期时 ≈8,000 拍），`warPressureTicks=0` ⇒ R4 止损那条也没走。
判效器：**`posture-exit-watch2.sh` pid=7182**，GAP=600s、ROUNDS=45 ⇒ 覆盖 ≈7,290 拍（到 ≈83408300），
每轮自带 `Blocked=` / `pressure=[…]` / `hostileAt=[…]` / `newSighting=` 四列，判据 P-A / P-B / G6-ALONE / STUCK / ANCHOR-MOVED。
旧那支（pid=82202，EXIT_TICK=83400412）留着不动，但我已在其日志里手写一行 NOTE 标明**它的锚过期**——
它随后打出的"超容差仍 war"不是预测失败，是计时器被 83400220 那次目击整段重置。

**这条预测最锋利的下游**：七项里唯一未证的是 `gclHeadroom`，而那正是 **#94 要回答的问题**
（`strategy.gclLevel` 落盘，未推）。⇒ 给"要不要推这批"添一条具体论据：
P-B 若发生，第一个要排除的就是这项，而没有 #94 就只能靠 console 现抓（本会话已刻意不打 console）。

### 其余现场

`gateNetFlow={W37S58:5.146, W38S56:0.832}` ⇒ Σ=**5.978** 对门槛 5（G4 绿），而**同拍核心房 `economy.nf=−9.45/拍`**
⇒ R184"回声"第三次实例：慢 EMA 高于输入必回落，回落前 G4 的绿不能当余量用。
核心房 storage 891,913→**在跌**；`warPlan` 仍挂着 `targetRoom:W37S58 spawned:0 squadSize:32 a5ForceReq.total:0`（#101 的原样）。

### 边界

零 src、零 push、零 build、**零 console**；探针全走 REST：peek×5（精确 dotted path）+ 手工一发先验新判效器形状。
新增 1 个看门狗（7182），旧 3 个在飞（41487/54116/82202）；`rcl5-eta`(82755) 与 `rcl5-watch`(69079) 已按 round 正常下班。
L0 §2.3 的 #97 与 §3.5 的属人 7 项本轮未动。

### R212（10-03 12:4xZ，巡检 R119）**RCL5 命中 @≈83400860 之后的 50 拍里，幼房自己开了远矿点 W38S55、把 tower+extension 排进工地**（"自主成长"这条腿第一次有行为证据）；另用一发战前基线结掉两桩口径疑问，并给 **#101 指出判据失明点**（`warPlan.spawned` 切靶即归零，而现场有 defender）

**一、命中与即时后果（全是现场键，不是推断）**
· `W38S56.lastRclLevel=5`；`rcl5-eta` round19 判 **RCL5-HIT@83400860**（progress 从 404,175 跨级）。我 R189/R208 那条"≈83400800"差 **60 拍**兑现（速率 15.85~16.00/拍守住；`REQ=405,000` 仍只是"与命中相容"，`controllerProgressTotalSeen` 未上线 ⇒ 不当读数）。
· 命中后 ≤50 拍的三个自主动作：①`remoteOps` 新增 **W38S55**（`state:"active"`、`createdAt:83400805`、`sources:1`、`siteCount:1`、`ledger.i:5000`）⇒ **幼房开了自己的远矿点**；②修路车道 `W38S56→W38S55 state=active 合表@83400865`；③`buildQueue` 出现 `constraint.tower.31.13` 与多个 `extension.*`，**均 `state:"site"`、`queuedAt:83400803`**（幼房 `site=1`、人口 8→11、`queue=5/17`）⇒ RCL5 之后布局立刻推进到"塔+extension 在施"。
· ⇒ **这条腿以前只会爬级，现在同拍群出现"开矿＋开路＋放塔"** ⇒ `CAPABILITY-MATRIX` 的 bootstrap/扩张行可按这三条读数提档（矩阵是对端的，我只给出处：`rooms.W38S56.remoteOps / buildQueue / 修路车道`）。

**二、两桩口径疑问被一发战前基线结掉（对端 R208 当时因缺基线而不敢判）**
· **核心房 `towerSpendCombat` 记对了**：我 11:4xZ 读 **660**，12:4xZ 读 **2,460** ⇒ **+1,800 恰好落在 `EnemyInvasion@83400215 → EnemyCleared@83400245`（≈30 拍、6 塔）** ⇒ 战斗桶在场、量级 ≈60/拍；`towerSpent=90,520`（累计）⇒ 战斗占比第一次可算。**#80 家族的"漏记/记对"就此结案。**
· **`warPlan.towersSeen=0` 不是缺陷**：写者 `war-planning-system.ts:531-534` 注明它是"进场要拆掉几座塔"的**新鲜敌情塔数**；DEFEND 计划 objective 是自家房 ⇒ `undefined→0` 属按构造。我 R208 那条疑问作废。
· **给 #101 的失明点（新）**：现读 `warPlan={targetRoom:W37S58, squadSize:32, since:83400214, spawned:0, a5ForceReq.total:0, warPlanHash:7a3184a7}`（上一发是 W38S56/9/4e5d7372 ⇒ **一小时内两次切靶**），而 500 拍 skip 环里 **`creep/defender/idle-cadence=792`** ⇒ **场上确有 defender 在 idle**（`agenda=defense-readiness`）。码侧：`war-planner.ts:310 spawned+=1`，但 `:536/:110` 在 **不 keep（换靶/换 plan id）时重置为 0** ⇒ **`spawned` 是"本 plan id 期间加了几次"，不是"有没有兵"**。⚠️今天这场只有 ≈30 拍，**没到 #101 的 200 拍门槛 ⇒ 不构成否证**，只是判据会在"围困期间切靶"这一型读回 0 而场上有兵。建议把"兵力是否落地"的判据换成**扫 `Memory.creeps` 键名前缀**（R115 的同一手法）或用 skip 环的 `creep/defender/*` 计数。
· 顺带一条找路的坑：**`kernel.stats.byRole` 不在 Memory**（我这发读空）⇒ 要角色在场别去那儿找。

**三、我自己两条预约的下场（写清是速率还是模型）**
· **`storageNearFull` 连两轮没兑现 ⇒ "满仓 imminent"归入失败预测类**：预测 83400250（R189 口径）→ 修正 83400615（R208 口径）→ 现读 83400995 仍 `false`（storage **896,431** ⇒ ratio 0.8964，差 3,569）。下午轨迹 `882,323@09:45 → 890,827@10:49 → 896,514@11:46 → 891,913@R211 → 896,431@12:4x`：**在 0.890~0.897 的带里摆了约 3 小时、越近线越涨不动** ⇒ 显然有我未读到的自限。⇒ **R184 补那句"停卖 ⇒ ≈1,200 拍触发 near-full"降级为"仅当该房确实持续上涨时成立"**；而"饱和响应吃净流"这条机制至今**没被现场检验过**（没触发就看不到）。我不再为它发拍号，只留一条挂表判据：**翻真那一拍同时读 `nf` 与 `demandsPublished`/factory 活动**。
· **war 退出锚改了**：我 R208 押的"首次目击+5,000=83400412"被现场否掉——`W37S58.hostileAt=83400220`（新目击）刷新锚 ⇒ **现算 ≈83405220（≈14:2xZ）**，对端 R211 已改锚并挂 `posture-exit-watch`(pid 82202)。⇒ **"最近一次目击 + 5,000"胜出** ⇒ **#90 的"骚扰税"拿到定量口径：每次目击把扩张往后推 5,000 拍（≈5 小时）**，RCL5 之后已被推过两次。被否形态是"前提被新事件改写"，不是模型错。
· **G4 第三次"回声"实例**：`gateNetFlow={W37S58:4.854, W38S56:0.648}` ⇒ **Σ=5.502 绿**，而同拍 `nf=−9.08`（幼房 `−1.12`）⇒ EMA 高于输入必回落；幼房那台 0.798→0.648 正是它 RCL5 后的建设潮（`ea=664/1300`、5 个工地、`queue=5/17`）⇒ **R185-D 的对冲连续第二轮现场可见**。

**四、其余**：`Blocked=G0+G6`@83400984（**RCL5 之后没有新增红项**）、`Pressure=HIGH(0.61)`、候选 `Q2/R7/U3`（R 档 +1，与幼房成熟相符）、`tier=tight@83387005`、调度 healthy、300 拍环 CPU avg 18.6/max 23.8（防御+建设潮，非新态势）、`errorsPerTick=0`；`credits 12,864,355`（第六发差分 **+43,541/≈700 拍**，远低于前几发的 130~240/拍 ⇒ **速率不是常数**，别拿来定势）、`runs=72`、`demandsPublished=0`；`kernel.stats.deathByCause` 仍不存在（#96 未上线，`ahead=89/behind=0`）。

**边界**：零 src、零 push、零 build、零 console（对端 12:4xZ 刚写 R211，我不碰 `__evalResult`）；探针 observe×1 + peek×2。**下一轮**：①war 是否在 ≈83405220 退出 ⇒ 那才是 RCL5 之后第一次真 claim 的机会（看 `Memory.rooms` 是否变 3 房 / plan 被消费）；②幼房 W38S55 与塔工地的推进斜率（自主成长的第二发样本）；③再来围困且 >200 拍时，用键名前缀扫 defender 在场代替 `warPlan.spawned`。§3.5 属人 7 项未动，本轮唯一新增"待你拍"的是对端 #100（要不要给战争进攻支路接线），我补的事实是：**"打不到玩家房"是结构（选靶链无产线调用者），不是情报不够**。

---

## R213 · 2026-10-03 13:0xZ（扩张执行链整张图落进能力矩阵 §13，并核出两道永真闸）

主目标是 L0 §2.3 的 #97：把 P0 的"扩张"腿的**执行半边**逐行核成可引用的能力行。
派 Explore 出一张地图后，**三处关键论断我自己逐行复看**（子代理的死码报告默认不可信，这条纪律是踩过一次记下的）：

**① G4/G6 不参与执行**（我只需确认，代码写得清楚）：`execution-gate.ts:7-19` 那 11 道闸里没有净流与 CPU 档，
它们在 `readiness.ts:191-216` 只挡"晋升到 WAITING_EXECUTION"。⇒ 今天 `Blocked=G0+G6` 里那条 G6
**挡不住已晋升的 4 张 plan 执行**——这条口径对 #88/#50 的读法有直接影响（G6 红 ≠ 解不了闸就不能动工）。
另有一条**独立**执行门 `expansion-manager.ts:56-57`：`budget.tier ∈ {healthy,guarded}` + `bucket≥5000`
——注意这是**另一条 tier 轴**，不是 G6 的 `capacity.tier`，混了就会得出错误结论。

**② 两道执行闸按构造永真通过 ⇒ 新案 #102**：`execution-gate.ts:136-142` 读 `hasConcurrentOp`、
`:160-166` 读 `threatEscalated`，而唯一产线调用点 `plan-adapter.ts:71/:74` 把它们**写成字面量 `false`**
（作者自己的注释是"简化：检查…"）。`threat-escalation.ts` 全仓无产线 importer（只被同样没人引用的
`execution-dashboard.ts` type-import）。⇒ **帝国可以开进一间威胁刚刚升级的房而不会被任何一道闸拦下**。
**本轮故意不动手**，理由写进案里：P-A 实验（≈83405220 尾税到期 ⇒ `expansionAllowed` 翻 true ⇒ 真去 claim W37S56）
是几小时难求的自然复证，而给一个执行闸喂真数据是**收紧**行为——喂错源就会把这次实验钉成"没开闸"，
归因会错到我头上而不是系统。时序＝先拿 P-A/P-B 读数，再动这两道闸。修法规格已写到"只差一次形参读取"。

**③ sponsor 的真实弱点（#13 的机制解释）**：sponsor = `discovery.ts:64-73` 的"哪个自有房的侦察兵持有这条 Intel"，
**没有 spawn/RCL 校验**；`CONFIG.expansion.sponsorMinRcl:5` 只被 `bootstrap-lane.ts:50` 消费，claim 路径不查。
失败时 `state-machine.ts:672-673` 与 `spawn-manager.ts:406` 都是**静默返回**——没有"sponsor 孵不出兵"这个信号。
⇒ 若 P-A 那一次 claim 卡住，第一嫌疑就是这条（而不是"闸没开"）。

顺带两处按量级结案（不单独立部署）：`getExecutionProgress` 的表键大写 vs Memory 状态小写 ⇒ `progress` 恒 0，
但 `executionDashboard` 除写者外零消费者；`reservedEnergy` 从不落账（`:601-603/:653` 注释自认），是装饰数。

**测试覆盖的真相**（这条最该被记住）：`tests/integration/expansion/a3-*/a3-4-e2e` 与 `tests/unit/expansion/a3-*-contract`
**只 import domain 函数、从不跑系统**；唯一真多拍引擎跑 `tests/e2e/scenarios/20-claim-chain.test.ts`
**断言的只有"无 JS 错误 + Memory 体积"**，状态转换是打日志。⇒ **殖民执行链的"能跑完"至今没有自动化作证**，
只有一次现场自然完成（#32）。矩阵 §13 里我把这句写成了 `STABLE` 缺口的正式前置。

边界：零 src、零 push、零 build、零 console；探针只有源码 grep/Read + 前面那 5 发 REST peek。
在飞看门狗 4 支（41487/54116/82202/**7182**）。#97 前进 2 行（§8b 与 §13），余下待补次序不变。

---

## R214 · 2026-10-03 13:0xZ（我挂的预测落了；我自己一发读数又被第二发否掉）

**① "回声必回落"命中，但只命中合计那一半。**
R212 写下"Σ=5.978 而核心房快仪 nf=−9.45/拍 ⇒ 这格绿不能当余量"。落到 `G4` 转红用了约 200 拍：
`Blocked=G0+G4+G6@83401084`，`failedGates` 里 `G4: net flow(v=4.6|netFlow ≥ 5)`。
⚠️但**机制不是我点的那间房**：掉的是**幼房**那台慢 EMA（`gateNetFlow` W38S56 +0.832 → **−0.0986**），
而核心房快仪随后**转正**（`rooms.W37S58.economy.nf=+28.48/拍@83401184`），它自己的慢 EMA 只从 5.146 松到 4.877。
⇒ 记法：预测的**方向与量级**成立（绿没撑住、几十分钟内回落），"哪一台在掉"这一半我猜错了。

**② 落回阈值之上——G4 今天第 5–6 发样本，判语可以钉死了。**
`v` 序列（同一把 G4 闸）：4.6@83401084 → 4.8@83401284，而 `empireEconomy.nf=+11.57/拍`（合计快仪已转正）。
配合 R211–R212 的两发：Σ 5.978(绿) → 4.6(红) → 4.8(趋绿)，跨度不到 400 拍。
⇒ **#88 那条"放宽门槛买的是什么"现在有数据可以回答**：门槛 5 正好落在这条振荡带的正中，
输入端 ±10~30/拍的摆动足以反复翻 flag ⇒ **用 G4 当新 plan 的晋升门，按构造就是间歇性的**，
一次红/绿都不是"经济好不好"的证据。（措辞仍是给 owner 的口径，不自批改阈值。）

**③ 我自己的一发读数被第二发否掉——记下这个形状。**
看到 `Budget=357,818 → 210,337`（300 拍掉 147k，≈492/拍）时我几乎要立案"扩张预算在排干，
会在尾税到点前把 G7 踩到 2,000 门槛"。按同速率算只剩 ≈424 拍到阈值——**如果成立，P-A 会被 G7 钉死**。
第二发（100 拍后）`Budget=354,145` ⇒ 它是 `computeTieredBudget` 随健康度档位的**抖动**，不是流水。
⇒ 纪律：**派生切片型读数（随档位重算的量）单发不能判趋势，至少两发同向才算**；
这与我已有的"累计型要看差分"是同一族的两面——累计型不能看单点，抖动型不能看单点。
（另：`readiness.ts:218-229` 早就写明这个量"一个名字两套公式"，本次是它的第三次现场体现。）

**④ 判效器在干活**（这是挂它的全部理由）：`posture-exit2.log` round1@83400984 / round2@83401084 都带
`Blocked= / pressure=[0,0] / hostileAt=[83400220,83399840] / newSighting=no` ⇒ 锚至今未被刷新，
退出预测仍按 **83405220** 走。pid=7182 存活确认。

边界：零 src、零 push、零 build、零 console；本轮探针＝peek×3 + 源码 Read/grep。属人 7 项未动。

---

## R215 · 2026-10-03 13:2xZ（房间运营审计：子代理的头号结论是反的，我把它撤了）

按 #97 的次序审计房间运营/防御工事族，落 `CAPABILITY-MATRIX.md §15`（那一行开始用**核验等级标注**：
`[我核]` / `[注释自证]` / `[未复看]`——审计越深，把"我验过的"和"我听说过的"混在一起的风险越大，标注是给下一轮的免疫）。

**被撤的两条过头结论（都是子代理报的，我自己复看源码后否掉）**
① **"没有任何系统发 `STRUCTURE_WALL` 任务 ⇒ 防御线缺墙"是反的**：`construction-manager.ts` 的
`isRuntimeDefenseWallTask` 把 `defense.mincut.*` 的墙任务**全部拒绝**，注释写明理由"防止不可逆围城继续扩大"；
`defense-planner.ts` 现在发 `defense.mincut.rampart.<x>.<y>`，且自己注释"旧格式 wall 键由 construction-manager 阻断"。
⇒ 不建墙是**故意的安全设计**，不是能力缺口。若照那份报告立案，我会去补一条"发墙任务"的功能，
正好把系统刻意关掉的不可逆风险重新打开——这是本仓最贵的一类错（换个名字复发的"修法即破坏"）。
② **"segment `overrides` 无产线写者"错**：`layout-planner.ts` 把 `planCoreStage` 的 `result.overrideWrites`
写回 segment 并 `markLayoutDirty()`。同一条报告说 `template` 分支不可达所以"整套是死码"也不对：
`domain/layout/planner.ts` 确实被 import，只是 `CONFIG.layout.mode="constraint"` 让那条分支按配置休眠。

**核出来的真问题只有一条，而且是最便宜的那种**：`CONFIG.construction.maxWallSitesPerRoom` 的注释还写着
"min-cut v3 割集顶点改用 wall（阻挡通行）"，与上面的代码**正好相反** ⇒ 照配置推理的人会得出"防御线用墙"。
本轮把注释改成指向真实行为（并说明那个名额今天是**惰性的**：没有任务类能走到它）。
**零行为改动**，按纪律不单独部署，随下一批走。⇒ 这一族的形状值得记：真正的风险不在代码里，在"两份真相互相矛盾"里。

**现场静止态**（13:19Z peek）：`rooms.W37S58.buildQueue=[] spawnQueue=[] phase=steady rcl=8 reserve=924,215
reserveDelta=+414` ⇒ 建造管线是**没活可干**，不是被什么卡住。这条对下一轮有用：如果之后读到 `buildQueue` 长期非空
而 site 数为 0，那才是新问题（名额/优先级/能量），现在不是。

**验证**：`tsc` rc=0 ｜ `check:docs` 通过（注释改的是代码行为，不引用文档路径）｜ construction+layout
20 文件 / 294 用例全绿 ｜ prettier 干净。判效器 `pid=7182` 仍在飞，退出预测仍按 **83405220**（`newSighting=no` 至今）。

边界：零 push、零 build、零 console；探针 peek×4 + 源码 Read/grep。属人 7 项未动；`#100/#102` 仍等裁决。

---

## R216 · 2026-10-03 13:2xZ（§15 三条待核复看完：全是"看着像缺陷，其实是命名/历史残留"）

**①`developmentGate()` 不是第二套门禁**：`construction-manager.ts:248` 那个导出函数在 `:255` 直接转调
domain 纯函数 `evaluateDevelopmentGate`，`:242` 的注释自己写明"逻辑已下沉"；活路径（`:109`）本来就走 domain 那条。
⇒ 只有**命名漂移**：全仓十余处注释（builder.ts:30/95、config:427、queue.ts:197/216、phase.ts:598、downgrade-risk.ts:31）
仍以 `developmentGate` 称这道闸，照注释找真判据的人会先找不到。**不改代码**——改名牵动 10+ 处注释而零行为收益。

**②`dismantleCount` 确实有两份宿主，但只有一份活着**：产线是 `roomMem.dismantleCount`
（`layout-planner.ts:502` 写 ⇒ `:879` 读进 layoutMetrics，即 #82 那条 PASS 通道）；
`link-system.ts:252` 写的 `globalCache().dismantleCount`（Map）**无任何读者**，而它自己的注释（`:244-248`）
声称"layout-metrics 消费此计数"。⇒ 注释说谎 + 孤立仪表，不在决策路径 ⇒ 按量级结案（与 #17 的
drift/industrialSpend 同处置）。**要清就清仪表，别把它当缺陷去改行为。**

**③link "hub"** 那条与已结案 #74/#75 同族，留 `[未复看]` 标记并写明"下轮先读那两条再决定是不是新案"。

⇒ 这一族的共同点值得单独记：**三个候选缺陷没有一个需要改代码**。审计的价值在于把"能力缺口"和
"命名/历史残留"分开——前者要补，后者要忍（动了反而制造风险或纯 churn）。同轮另一例见 R215（"防线缺墙"
其实是系统自己关掉的不可逆风险）。

边界：零 src 改动（R215 那条注释改口的提交 `f1aef08` 是本轮唯一 src 侧文件，且零行为）、零 push、零 build、零 console。
判效器 `pid=7182` 继续盯 83405220，`newSighting=no` 至今。

---

## R217 · 2026-10-03 13:2xZ（一条口径更正：判效器那列 `tick=` 是量化过的，别拿它算拍长）

round3→round4 打出 `tick 83401284 → 83401384`（墙钟 616 秒）⇒ 心算会得到 **6.16 秒/拍**，与今夜所有标定（3.58~3.93）差一倍。
**是口径错，不是掉速**：那一列取 `kernel.expansionDashboard.tick`，而 dashboard 由扩张 planner 每
`CONFIG.expansion.interval=100` 拍写一次 ⇒ 它**按 100 量化**，相邻两发的差只能是 100 或 200。
独立时钟源复核（同一拍内两次取不同写者）：`rooms.W37S58.economy.t` 从 83400929@12:46:30Z 走到 **83401579@13:25:20Z**
⇒ 650 拍 / 2,330 秒 = **3.58 秒/拍**，与 R184 那两发标定（3.61/3.80）同带。⇒ 拍长换算一律用
`rooms.*.economy.t` 或 `kernel.stats.intelCoverage.tick`（老化批每 100 拍写，但它是 `ctx.tick` 现值，不受 planner 间隔影响）。
**后果已核**：判效器把 `EXIT_TICK±600` 容差作用在这列上，量化误差 ≤100 被容差吸收 ⇒ 判据不用改；
但**别用相邻两行的 tick 差推速率**（这是"拍长换算"那一类错的第 6 次，只是这次错源是自家工具的列选择）。

顺带把等待中的那张 plan 读全了（P-A 那一刻要动的就是它）：
`expansionPlans[0] = {pid:"W37S56@82544684", rn:W37S56, sr:W37S58, st:WAITING_EXECUTION, tc:61300, roi:4.08, rk:0.37, rl:MEDIUM, sc:0.6, ca:82544684, ua:83401184}`
⇒ 这张单**开了 856,500 拍 ≈ 34 小时**（`ua` 每轮 planner 被刷，等于 dashboard 那一拍，不是"进展"），
成本 61,300 能量、`empireEconomy.eb=143,572 / fb=210,573` 都盖得住。
⇒ 对 P-A 的含义：解闸后**不缺预算、不缺候选**，缺的只有那一次 `expansionAllowed=true`。

边界：零 src、零 push、零 build、零 console；探针 peek×2。看门狗 4 支在飞（含 pid=7182 盯 83405220）。

---

## R218 · 2026-10-03 13:2xZ（把"要不要推这批"写成可决态：逐提交分类后，批次是可切的）

`git log origin/dev..HEAD -- src/` 一共 10 条，我逐条读完分类：**改变判定行为的只有 `1bc67c9`（#89 读时过期，方向是松绑）**；
**纯仪表 4 条**（#93 `controllerProgressTotal`、#94 `strategy.gclLevel/bucket`、#96 `deathByCause`、#99 `warFunnel`）；
**注释级 3 条**；test-only 1 条（#89 的合并形状覆盖）。⇒ 由此得到一条我之前没讲清的可选项：
**只推仪表+注释（不含 #89 两条）是行为中性的**，代价只有一次部署（清堆 + ≈400 拍 G6 税）。

为什么这一项在今天有时点意义：P-A 预测里唯一未证的合取项是 `gclHeadroom`，而那正是 **#94 要落盘的键**——
推仪表批就能把"这一项到底真不真"变成一条 `peek` 可读的事实，不用靠 console 现抓。
代价也要写明：换码期间 G4 振荡读数会掺进一次部署事件，归因要多做一次判别；P-A 的二元结果不受影响（状态都在 Memory）。

我没有动手，立场不变：`remote_ahead=0 / unpushed=98`（含对端提交，我一推就一起上线），且 #89 属"改变战争倾向"需授权。
⇒ 请示从"要不要推"收窄成三选一：**A 全推 / B 只推仪表与注释 / C 不推**。

---

## R219 · 2026-10-03 13:2xZ（§15 最后一条待核复看完：不是新案，是 #75 的完整链条）

**hub link 的四环机制**（逐行看完，全部 `[我核]`）：`classifyLinkRole`（`domain/economy/links.ts:201-228`）只在
距所有 source/controller/storage 锚 **都 >2** 时回落到 `"hub"` ⇒ ①`planLinkTransfers` 按角色配对，hub 既不在 from 也不在 to，**不被路由**；
②hauler 的排空是**具名动作** `withdrawStorageLink()`（`roles/hauler.ts:162`），upgrader 抽 controller link ⇒ hub **没有任何排空消费者**；
③灌入侧 `dumpToNearbyLink`（`actions/dump.ts:6-20`）**只看距离与空位、不看 role** ⇒ 矿工在几何上可以把它灌满；
④死资产检测只认 `role==="source"`（`link-system.ts:113`）⇒ 连"被判定为闲置"都不会发生。
⇒ 我原本准备立案的"hub 可被填不可被排"**就是已结案 #75 的下游**（"无处可计"只是这条链的最后一环）。
按"立案前先搜同一现象的第二种说法"的纪律撤下，改为把机制补写进 #75 与 §15，并留**升级立案条件**：
读到某房确有 `role==="hub"` 且能量长期非零的 link ⇒ 从"无处可计"升级为"在压能量"，届时重开。
**今天是否存在这样的 link：未证**（需要布局锚点数据或一次 console，本会话刻意不打 console）。

至此 §15 的三条待核全部结完，**没有一条需要改代码**（命名漂移、孤立仪表、旧案的机制补全）。
本轮审计的实际产出是三件：能力矩阵多了 §13/§14/§15、两道永真执行闸（#102）、防线"缺墙"被证为故意设计（R215）。

边界：零 src、零 push、零 build、零 console；探针只有源码 Read/grep。判效器 pid=7182 继续盯 83405220。

---

## R220 · 2026-10-03 13:4xZ（#102 落了：`GATE_THREAT_UNCHANGED` 接上真数据——并把 A/B/C 的账改了一遍）

R218 那份"要不要推"的分类里我数了**一笔**行为改动（#89）。本轮做完 #102 之后这个数字变了，写在这里更正：
**现在未推批里有两笔改变判定行为的提交**（`1bc67c9` #89 松绑、`58b1efa` #102 收紧执行闸），
纯仪表仍是 4 笔、注释级 3 笔、test-only 1 笔。⇒ 选项 B 的定义要跟着改：**"只推仪表与注释"现在必须同时排除 #89 与 #102**。

**改了什么**：`plan-adapter.ts` 的 `threatEscalated` 从字面量 `false` 换成 `isTargetThreatEscalation(ctx, plan)`，
它调用 domain 里一直备着、有单测、零产线调用者的 `evaluateThreatEscalation()`。生效的是三件 RED：
目标房有威胁 creep / 目标房有敌方塔 / sponsor 正被打。

**两个设计决定都不是凭口味，是从代码里读出来的**：
① 判据取 `shouldAbort`（RED）而不是 `level!=="GREEN"`——预约这一路 YELLOW **已经被更硬的 `GATE_TARGET_CLAIMABLE` 取消整条计划**
  （`isTargetClaimable`：`reservation && !my ⇒ false`，且它在硬失败名单里），在这层再判会把同一件事同时做成"取消"和"暂缓"；
  而候选房周围有预约/过境单位是常态，要求 GREEN 等于造一把**几乎不可满足**的闸——那与"永真通过"是同等糟糕的另一种错。
② 不给 `ExpansionPlanMemory` 加基线键：调用方 `tryConsumePlan` 已保证目标房此刻在视野内（不可见的直接 continue），
  所以全部输入都是现拍世界读数。给已存在的持久对象补形状是我踩过的静默失效坑，而这里根本用不上它。
  威胁口径用 `classifyThreats`（剔盟友与非战斗部件），不是裸 `hostileCreeps`。

**验证**：`tsc` rc=0；`tests/unit` **386 文件/5229** 全绿（基线 385/5222 ⇒ +1 文件 +7 用例）；`tests/integration` 30/239；
prettier/eslint 由 pre-commit 钩子跑过。**反向实验**（把 wiring 摘回 `false`）：恰好 4 条红（三条 RED + "同盟表为空"那条），
两条控制组（干净目标必须消费、只有 move 的过境单位必须消费）**与既有 `plan-status-ledger` 全部仍绿**；
摘除态 `tsc` 另报 `isTargetThreatEscalated` 未被引用 ⇒ 结构上证明这个 helper 只有那一个调用点。
⚠️过程中我给 4 处旧夹具补了 `find: () => []`：**是夹具不完整而不是生产代码要防御**（引擎保证 Room 有 find），
所以改测试不改代码去容忍残缺对象。另外我原本写的一条用例"盟友单位不算威胁"是**我的假设不是现场事实**
（`CONFIG.defense.allies=[]`），当场改成"陌生名字的战斗单位就算威胁"。

**没做的两件事，都有理由**：`hasConcurrentOp` 仍写死 `false`（语义与真读 `Memory.kernel.expansion` 的
`hasOtherExpansion` 高度重叠 ⇒ 要么删闸要么补生产者，两种都是政策改动，属人）；`getExecutionProgress` 的大小写错配不动
（`executionDashboard` 零消费者 ⇒ 不在决策路径，按量级结案）。

边界：**未 push、未 build**（`dist/main.js` 仍 05:10/785,155B == 线上 `ea4c69da6f8b`）、零 console。
判效器 pid=7182 仍盯 83405220；**若 A/B/C 选了含 #102 的推送，上线判据**：一次带敌情的窗口里读到
`Gate failed … GATE_THREAT_UNCHANGED` 才算这道闸活了；和平期它恒不触发是正确读数，不是坏了。

### 巡检 R120（10-03 13:5xZ；按 R212 里那条编号隐患，我不占 R 号）**#61 的预留拒绝重新有量**（幼房 RCL5 落了 storage ⇒ `cr>0` ⇒ 预留那条支第一次有作用面：跨 ≈4,700 拍 `reserveOnly +482 / budget +7 / degradeGateClosed +489`，**1:1 包含式第十次成立**）；`storageNearFull` 终于翻真但**我写死的配套判据没兑现**；对端 `posture-exit` 那声 **STUCK 是假警报**（现算 ≈83405220，两个独立交叉验证都指向 "low" 档的 5,000）

**一、#61（孵化预留语义）现场更新**
· 幼房 `spawnRejects`：`{survivalBlock:0, budget:2763, reserveOnly:5976, noDegrade:234, floor:0, degradeGateClosed:2705}`；R116 基线 `{2756, 5494, 2216}` ⇒ 跨 ≈4,700 拍 **budget +7、reserveOnly +482、degradeGateClosed +489**，且 `489 = 482 + 7` **逐位相等**（批次 5 那个包含式第十次成立）。
· **为什么停摆四天后又开始涨**：RCL5 之后幼房有 storage（`storage_se 63,847`）⇒ `economy.cr = round(reserve) > 0` ⇒ 预留的**触发条件 2**（`cr>0 && rb/10<400`）第一次具备资格。与我记忆里"storage 落地把 `cr` 从 0 抬起来 ⇒ 98% 的拒绝拍变成只有预留挡得住"同型。
· **后果仍只是延迟不是饿死**（维持我当初把 `size-vs-reserve` 自降级为 latency 的判断）：同期幼房人口 8→**14**、`queue=1/19`、远矿点 W38S55 在跑、塔/extension 工地在施、`ea=1300/1300` 满。⇒ **#61 的账现在是**："RCL5 后 ≈每 10 拍 1 次预留拒绝（482/4,700），代价是建设与升级的排队时延，收益是孵化预留保住替补采集者；无饿死证据。" **我没动阈值、没动预留语义。**
· ⚠️顺手记一条自误：我第一发读 `rooms.W37S58.spawnRejects` 拿到"不存在"，几乎去立"计数器丢了"。实际这套计数器 `??=` **惰性创建**，只在真发生过拒绝的房才有对象（幼房有、核心房从未有）⇒ 属"键不在≠没发生"的**反向**用法：这里等义于"没建过"，不是"丢了"。

**二、`storageNearFull` 翻真了，但机制那一半没兑现**
· `W37S58.storageNearFull = **true**`（storage 902,298 ≥ `0.9×1,000,000`）。这是我对同一事件的**第三次**拍号估计（83400250 → 83400615 → 实际 ≈83401935）⇒ 事件成立、**拍号连错三次 ⇒ 以后"贴线慢涨"类只登记方向、不登记拍号**（速率不是常数，第 7 族）。
· 我写死的配套判据（"翻真那一拍同时读 `nf` 与 `demandsPublished`/factory 活动"）**当场没有响应可看**：同拍核心房 `nf = **+14.14/拍**`、`gateNetFlow.W37S58=6.466`（还在涨）、`demandsPublished=0`。⇒ **"饱和响应吃净流"（R184 补）至今既未证实也未否证**；下一轮先判 `near-full` 是否**还在 true**——掉回 false 就是判据窗口关了，要等下一次翻真。
· **G4 的形状变硬了**：`gateNetFlow={W37S58:6.466, W38S56:**−0.616**}` ⇒ Σ=5.850，**幼房那台第一次转负**，整个门槛余量由核心房一台承担 ⇒ **R185-D 的对冲拿到最强形态**：RCL5 的建设潮把幼房变成净消耗者；若持续，G4 会自己再红，这比"要不要放宽门槛"更早发生。

**三、war 退出：对端 STUCK 是假警报（算式与两处交叉验证）**
· 现场：`posture=war`、`since=83397159`、`lastHostileAt` 核心 **83400220**／幼房 83399840（**无更新目击**）。
· 链：`posture.ts:117-118` `threatRecent = 任一房 tick−lastHostileAt < threatWindow`；`CONFIG.posture.threatWindow=3000`（`config/index.ts:1151`）而 `posture-baseline.ts:46` 在 **neighborPressure="low"** 覆盖为 **5,000**。**"low" 是生效档**，两处独立交叉验证：`expandMinBucket=6000` 与 `expandMaxPressure=0.5`（R187 实测生效值恰好是这两个，只有 "low" 支会给）。
· ⇒ 退出在 **83400220 + 5,000 = 83405220（≈14:2xZ）**；`minDwell=1000` 早已满足（dwell≈4,776）。对端 `posture-exit-watch` 在 83401784 判 STUCK 用的阈值 **83401612 无论按 3,000（83403220）还是 5,000（83405220）都算不出来** ⇒ 那一步（查 liveThreat 宿主 / anyRecovery / R4 止损）**现在不必做**；watch2（pid 7182）的判据应改为 83405220。
· **#90 的口径钉牢**：一次目击 = **5,000 拍扩张税（≈5.2 小时 @3.75 秒/拍）**；今夜已 5 次目击。若骚扰间隔 <5,000 拍，扩张可被**永久**冻结 ⇒ 仍属观察项，我不动任何战争闸。

**四、其余**：核心房 `controllerDowngradeRisk=true`（RCL8 保级带第 3 次进入，落在 83400995~83401935 之间；engage 准确拍号不落盘）⇒ 此刻 `spawnQueue` 只有 1 条 `reserver` 替补（`createdAt 83401945`），**这还不算偏差**；R121 的读法写死为**扫 `Memory.creeps` 的 `upgrader-W37S58-*` 键名（名字嵌出生拍）**，别读瞬时队列形状。`Blocked=G0+G6`@83401884、`tier=tight@83387005`、调度 healthy、300 拍环 CPU avg 17/max 26.3、`errors=0`；`credits 12,952,791`（差分 +88,436/1,240 拍 ⇒ **≈71/拍**，比前几发 130~240/拍低 3 倍 ⇒ 流入线速率极不稳，来源仍未证）、`runs=76`。幼房成长第二发样本：车道 `W38S56→W38S55 active/挂起0/热度41`、`ops=1/1`、`site=1`、人口 14、`rs 70,930→69,611`。

**边界**：零 src、零 push、零 build、**零 console**（对端正持有未提交 src：`plan-adapter.ts`、`plan-status-ledger.test.ts`、新增 `threat-escalation-gate.test.ts` ⇒ 我没碰、没 stage、没 build）。探针 observe×1 + peek×4（含一次我自己读错房的空读）。**R121**：①`near-full` 是否仍在；②war 是否 ≈83405220 退出 ⇒ RCL5 后第一次真 claim 窗口（`Memory.rooms` 变 3 房 / 4 张 plan 被消费）；③保级带这轮有没有孵出 upgrader（键名法）；④幼房 `reserveOnly` 差分继续给 #61 供量。§3.5 属人 7 项未动。

---

## R221 · 2026-10-03 13:5xZ（#102 补了一次真引擎跑，并把它的证明边界写死）

顺手纠正一条我自己带错的口径：**e2e 并不读 dist 的内容**——`tests/e2e/setup.ts:110-112` 只断言
`dist/main.js` **存在**（不存在就报错要求先 build），而场景本身 `import { CONFIG } from "../../../src/config"`，
跑的是**源**。⇒ 我之前记的"e2e 跑 dist"是错的（准确说法：`npm run test:e2e` 脚本前面挂了 `&& npm run build`，
所以日常跑法会重build，但**引擎里执行的是源**）。既然脚本里的 build 只是习惯而非必需，我用
`npx vitest run <场景> --config vitest.e2e.config.ts` **跳过 build** 跑，`dist/main.js` 保持 05:10/785,155B
⇒ 本地==线上这个免费仪器没被我自己弄丢（这是 #85 那类单二进制窗的根基）。

**跑的结果**：`tests/e2e/scenarios/20-claim-chain.test.ts` rc=0、1 例通过。
⚠️**它能证明的和不能证明的要写清**：该场景的断言只有"无 JS 错误 + Memory 体积"（§13 里我记过这条），
状态转换是打日志。所以这一次跑**只证明"把 GATE_THREAT_UNCHANGED 接上真数据之后，15,200 拍的建城链不炸"**，
不证明闸门语义——语义由 #102 的 7 条单测（含 2 条控制组与反向实验 4 红）负责。
另注：`npx vitest run <路径>` 用默认 config 会命中 `exclude: tests/e2e/**` ⇒ "No test files found" + rc=1，
那是**过滤器形状不是红条**（本会话第 3 次把工具形状误读成结论的风险，记下来免得下轮再当成回归）。

边界：零 push、零 build、零 console。#102 与 #89 都仍未推，等 A/B/C。

---

## R222 · 2026-10-03 14:1xZ（恢复腿审计：又一个"子代理说坏了、其实是设计"，但这次底下真有一个洞）

派 Explore 审计 recovery/crisis 链，头号结论是"四种恢复动作永远过不了自己的第一道房名守卫 ⇒ 缺陷"。
**逐行复看后又一次规范性反转**（继"防线缺墙""template 分支是死码"之后第三次）：
`recovery-execution-system.ts:25` 的文件头注释明确写着
"无房间维度的动作带 GLOBAL_ROOM：需要具体房才能行动的地方**必须显式跳过**，不能默认'买/建/孵'"，
而 `:20-24` 记着这条政策的来历——上一版按 `targetFailureId.split(":")[1]` 取房名把**维度名当房名**，
于是 storage 已有 90 万时照买能量，实测 credits 457,666 → 331,398（−126K/40 分钟）。
⇒ **跳过是安全设计，不是 bug**；"half the actions die" 这种说法会把修法变成重开一个烧过钱的洞。

**但设计合理不等于可以看不见**，这就是本轮真正落地的东西（#105）：
`recoveryActionTable`（含 `attempts/maxAttempts`）**住 heap ⇒ 每次部署归零**，于是"某类动作一直被拒"
在读数里从不显形，而且一个跨部署反复失败的动作**永远走不到** `non_retryable` 的告警面。
⇒ 新增 `Memory.kernel.stats.recoveryRejections`（key=`type:classification`，值 `{count,lastAt,lastReason}`），
写在拒绝分支里。**零判定影响、零消费者**，键集合有限（11 动作 × 5 分类）⇒ Memory 有界。
读到的第一个问题就该是：物流/网络/健康维度这三类失败节点（`empire-health-system.ts:405/456/468` 三处 push 都不带 `room`）
的动作是不是真的**一直在被跳过**——那是"帝国级故障到底产出过几次可执行动作"的第一份证据。

**测试的形状**（7 例）：5 例测写入路径（建表/累加分键/截断/已有条目不被 `??=` 吞/stats 缺席不抛），
外加 **2 例源码接线锁**——因为我先写完发现"摘掉调用点它们全绿"，那就是"绿色但什么也没断言"；
本文件所属的系统没有系统级夹具（沿用 `recovery-record-room-source.test.ts` 的坦白写法），
所以接线用源码形状作最强可得证据，语义复核留给线上读数。**反向实验证实了这个区分**：
摘掉调用点 ⇒ 恰好接线那 1 例红（`expected 1 to be 2`），其余 6 例仍绿（正是我给它加锁的理由）。

**顺带核出第二条真洞（#104）**：`g.recoveryCooldowns` 每轮都被读来判 `isOnCooldown`，
但它唯一的写者 `recordRecoveryAttempt`（`recovery-priority.ts:129`）**全仓零调用者**
⇒ 冷却门**按构造恒假**。这条与 #105 是同一族证据：上线后若同一 key 的 `count` 持续上涨，
就同时证明了"重复尝试没有被冷却挡住"。修法（接上冷却 or 承认幂等表已够）涉及行为改动，**属人**。

**没动的**：`roomMem.defenseState.safeModeRequested` 与 `stats.crisisCount` 都只有写者没有读者（注释还声称有消费者）
——不在决策路径，按量级结案；heap 里的 5 个恢复计时器（`recoveryActionTable/recoveryBeforeStates/recoveryCooldowns/__consecutiveStableTicks` 等）
是 #13 类老坑的又一实例，**要判效得先问它住哪**。

验证：`tsc` rc=0；`tests/unit` **387 文件/5236** 全绿（基线 386/5229 ⇒ +1 文件 +7 例）；integration 30/239；
**未 push、未 build**（`dist/main.js` 仍 05:10/785,155B == 线上 `ea4c69da6f8b`）、零 console。
判效器 pid=7182 仍盯 war 退出 83405220。

---

## R223 · 2026-10-03 14:1xZ（"快满仓了"这条时间压力今天不成立——我把它从推理里摘掉）

去等第一次 `storageNearFull` 翻真的现场（R184 曾推算"≈1,200 拍后进入 near-full，之后由限采+加速消费+工业线消化盈余"）。
到了门前先核语义，两条差点读错：

**① `economy.pl` 不是 storage。** 类型注释写明它是**窗口池快照** `[trackedStart, trackedEnd, otherStart, otherEnd, looseDelta]`
（`global.d.ts:178`）。当前 `pl=[931157, 927123, 4274, 5674, 0]` —— 把 `pl[1]=927,123` 当库存就会得出
"已越过 900k 触发线而标志仍 false ⇒ 标志坏了"这条**假缺陷**。真实库存走 `room-state.ts:307-315` 的直算
（`storage.store.getUsedCapacity/getCapacity ≥ CONFIG.economy.storageFullThreshold`，每轮 room-state 现算，无滞后），
而它报 **`storageNearFull=false`（两房都是）**。旁证：`roomTotal_rs ≈ storage_se + 约 30k` 的差额正是容器/背包/terminal。
⇒ 结论：**没翻，阈值判定没坏**；`pl` 从今天起在我这里只能当"池快照对"读，不能当库存。

**② 更要紧的是趋势反了。** R184 那条推算的前提是"当前涨速 +9.1/拍、余量 17,677 ⇒ ≈1,178 拍进 near-full"。
把今天的三个读数排开：896,514@83399984 → 891,913@83400705 → ≈892k@83402379
⇒ 跨 **2,395 拍净变化 ≈ −4.5k**，即 **−1.9/拍（朝下）**。0.9 触发线是 900,000，现值 ratio≈**0.892**，
按今天的方向**不会自己到达**。⇒ 摘掉一条我一直挂在嘴边的前提：
**"#76 定价是否含运费"与"#50 关远矿换 CPU"的取舍里，"快满仓了、马上要被迫处置盈余"这一支今天不成立**——
没有逼近中的强制事件，这两个决定都是**纯选择**而不是被库存逼出来的应急。写进 §3.5 的请示措辞里。

**③ 这一窗 G4 的输入是孵化脉冲，不是趋势**（同 #88 的机制，第一次拍到完整数字）：
`economy.bk@83402379 = {harvested:860, spawned:4650, towerSpent:780, towerSpendWalls:780, imported:2290}`
⇒ 这 50 拍里收入 17.2/拍、孵化消耗 **93/拍**、塔修墙 15.6/拍，而 `nf=−30.29/拍`。
一次编队更替潮就能把一个 50 拍窗打成深负 ⇒ 慢 EMA 上的 G4 摆动是**采样脉冲的积分**，
不是"经济在恶化"。#88 的口径按这条再收一次：门槛 5 与"单窗孵化 4,650"是同一量级，两者放在一起比较本身就是问题。

其余现场：`spawnQueue` 只有 1 条且是 **remoteHarvester 的 replacement**（W36S58 位，8 派生件 body，`createdAt=83402395`）
⇒ 远矿编制在正常回补；`industry={idleUntil:83402418}` ⇒ 工业线仍在 idle 窗口（与 #51"行情合闸就不发布需求"一致）；
G4 已随这批读数再次翻红（R214 的振荡判语继续成立）。

边界：零 src、零 push、零 build、零 console；探针 = peek×3（精确 dotted path）+ 源码 Read/grep。
pid=7182 仍在盯 war 退出 83405220。属人 7 项一个没动。

---

## R224 · 2026-10-03 14:2xZ（撤 R221 的那条引擎级证据——我拿一行 import 反推了整条装载链）

**R221 说错在哪**：我当时写"e2e 并不读 dist 的内容，`setup.ts:110-112` 只断言它存在，而场景
`import { CONFIG } from 'src/config'` ⇒ 跑的是源"。前半句对，后半句**推过头了**：那行 import 只是
**测试自己**要拿 CONFIG 算期望值；被送进 mock 服务器执行的 bot 代码来自
`tests/e2e/framework/BotHarness.ts:5,12` —— `readFileSync(resolve(cwd,"dist/main.js"))`。
⇒ 我那次 `20-claim-chain` 跑的是 **05:10 那份 == 线上的旧二进制**，**根本没有 #102 的代码在里面**。

**因此作废的结论**：#102/#105 的"引擎级不炸"证据**不存在**，那次 rc=0 只证明了旧产物照常工作
（本来也没人怀疑）。这正是我自己记着的纪律——**"A/B 前必须证明被测二进制变了"**——被我用一行 import 破掉了：
形状上像证据（同一个文件、同一个 rc），实质上是**同一份旧码的复跑**。

**还成立的部分**（这些不依赖 e2e）：`tsc` rc=0；`tests/unit` 387 文件/5236 全绿；#102 的 7 例
（含 2 例源码接线锁）与反向实验"摘调用点 ⇒ 恰 1 例红、其余仍绿"；#105 的 7 例 + 同样的摘除差异。
⇒ #102/#105 的证据等级停在 **`TESTED`**，不是"引擎级"。

**要拿到真引擎级证据的正确做法与代价**：必须先 `npm run build` 再跑 `--config vitest.e2e.config.ts`。
本轮**不做**，两个理由：①build 会把 `dist/main.js` 换掉 ⇒ 我今夜一直靠"本地 dist 字节 == 线上"这条免费仪器
判断有没有人部署过（R221 的动机正是想保住它，结果反而证明了它不能被想当然）；②任何误推会把**未经裁决的
#89（进攻倾向）**一起上线。⇒ 记成一句判据：**要验 #102/#105 的引擎行为，先确认 dist 是新的（比对 sha/大小），
再跑 e2e；两件事的顺序不能反**，否则测的是上一版。

---

## R225 · 2026-10-03 14:3xZ（补上 R224 欠的那一步：先证明二进制变了，再跑引擎）

R224 撤证据之后正确的顺序做了：**`npm run build` → 比对产物 → 再跑 e2e**。
· `dist/main.js`：md5 `e31cd0aed797ac6be2ce362533b11e5c`（785,155B，05:10，== 线上 `ea4c69da6f8b`/783,330 字符）
  → **`51e4768a9c197f0032bbd78a7a3061dd`（787,613B，22:23 本地）**。⇒ 这次引擎里跑的代码**确实含** #102/#105（以及未推的 #89）。
· 跑的是 `tests/e2e/scenarios/20-*` 到 `22-*` 三张（claim-chain 建城链 + 两张战争授权场景），`--config vitest.e2e.config.ts`；
  这三张是多拍引擎跑，**超出单轮时限**，已转后台（输出 `/tmp/e2e-real.log`）。⇒ 本轮**不宣布结果**，
  结论只在建/跑顺序成立时才算：`dist` 变了 → 场景通过 → 才允许把 #102/#105 从 `TESTED` 升一级。
· 顺带把我今夜一直依赖的那条免费仪器交代清楚：本地 dist 与线上不再字节相等**不构成部署风险**
  （本仓是 push 触发 CI 重建，线上产物来自仓库而非本地 `dist/`），代价只是"本地==线上"这个
  一行就能验证的探测器在本会话内失效；线上的 sha 我已记下，随时可用 `check-code.mjs` 复对。
· `dist/main.js` 不在 git 跟踪内 ⇒ 这次构建不产生任何待提交内容。

边界：零 src 改动（本轮只有构建产物 + 文档）、零 push、零 console。

---

## R226 · 2026-10-03 14:4xZ（R225 欠的结果回来了：三张场景在全新产物上 3/3 绿）

后台那批引擎跑完成：**`Test Files 3 passed (3) / Tests 3 passed (3)`，Duration 674.15s**
（`20-claim-chain` 建城链 + 两张战争授权场景），且这次满足 R224 定的顺序——**先证明产物变了再跑**
（build 后 `dist/main.js` 从 md5 `e31cd0ae…`/785,155B 变到 `51e4768a…`/787,613B）。
⇒ #102（`GATE_THREAT_UNCHANGED` 接真数据）与 #105（拒因表）**从"只有单测"升一级：真引擎多拍跑不炸**。

⚠️**它证明什么、不证明什么，边界照旧写死**：这三张的断言是"无 JS 错误 + Memory 体积"（§13 记过），
状态转换只打日志 ⇒ 这条证据的含义是"接上闸之后建城链在 15,200 拍预算内仍走通、没触发异常路径"，
**不是**"闸的语义对"——语义仍只有 #102 那 7 例（2 控制组 + 2 源码接线锁）与反向实验在担。
矩阵里 #102/#105 的等级我记作 `TESTED`+引擎不炸，**不升 `LIVE_VALIDATED`**：那要有 sha、有时刻、有判据的线上读数。

**顺带两条核对（都是老坑，值得再记一次形状）**：
①`check-code.mjs` 报的"本地 785,786 / 线上 783,330"是**字符数**，`ls -l` 的 787,613 是**字节数**——
   不是有人偷偷换了构建，也不是体积异常（今夜第二次踩这条，来源都是我自己顺手把两个口径并排看）。
②线上仍是 `ea4c69da6f8b` 未变、`remote_ahead=0`、unpushed=**109** ⇒ **没人部署过**，
   我对"本地==线上"那条仪器的破坏是**我自己这次 build 造成的**，且完全可复对（sha 已记在这里）。
   含 src 提交仍是 9 笔：行为改动 2（#89、#102）+ 仪表 5 + 注释 2。

边界：**本轮零 src 改动、零 push、零 console**；唯一的非文档副作用就是那次 build（产物不入库，`dist` 在 gitignore 内）。

---

## R227 · 2026-10-03 14:4xZ（把"要不要推"写成一张可执行的单子，并补跑全量 e2e）

约束没变：**目标今天被"9 笔含 src 提交未推"卡着**，而推是你的一句话。所以本轮做两件不需要权限也能推进部署质量的事。

① **全量 e2e 在新产物上后台跑起来**（34 张，`/tmp/e2e-full.log`，vitest pid=32674；产物 md5 `51e4768a…` 已先证明与线上不同）
 ⇒ 这是今夜第一次在**含 5 笔新仪表 + #102 的构建**上做全量引擎回归；出红时按 #62 的不可复现判据先分诊再立案。

② **写了一张推批风险与验证单**（进锁，因为它是并行会话与 cron 的第一读）：推下去改变什么（heap 清空 / ≈400 拍 G6 税 / 5 个新 Memory 键 /
 只有 2 笔行为改动：#89 松绑 = 早约 3,000 拍授权进攻性战争，#102 收紧 = 带敌情的目标房暂缓消费），
 以及 **8 步推后验证顺序**——每步都带"未上线 vs 没发生"的判别（#99 和平期 `noThreats=1` 是正确态；
 #105 缺键=未上线、全零=从未被拒，两种含义相反；#102 恒不触发是设计后果）。

**顺带把一个你可能没看到的时序冲突摊开**：P-A 窗口（tick≈83405220，约 2 小时后）的**结果**不受推送影响（状态都在 Memory），
但那段的**经济读数**会掺进一次部署事件。⇒ (甲) 等 P-A 落地再推＝白拿一次几小时才有一次的干净自然复证；
(乙) 现在就推＝早拿到 #94 的 `gclHeadroom`（恰是 P-A 唯一未证项），代价是这段窗不可归因。
我倾向 (甲)，理由写在锁里：P-A 免费且稀缺，仪表读数每 100 拍就有新一份。**决定权在你，我只是把两种排法的代价摆平。**

边界：零 src 改动、零 push、零 console；本轮唯一的线上侧动作是**读**（且都在 REST 上）。

---

## R228 · 2026-10-03 14:4xZ（#11 最后一处待核实核完：planId 只有一个生产者，但夹具形状与产线不同）

**核完的三件**：① 产线只有一处造 id —— `plan.ts:107` `planId = \`${candidate.roomName}@${candidate.discoveredAt}\``，
与现场实读的 `expansionPlans[0].pid = "W37S56@8254684"` 形状一致（**分隔符是 `@`**）；
② 按 id 查找的两处字段名一致（`plan-adapter.ts:332` 用 `p.pid === planId`、`plan-lifecycle.ts:65` 用 `p.planId === newPlan.planId`），
domain 侧 `planId` 与 Memory 侧 `pid` 由序列化层桥接，不存在"按 A 写按 B 查"；
③ 同 id 孪生的危害（同房重新立项会拿到同一个 `discoveredAt` ⇒ 终态回写会写进那条早已终态的孪生、真在执行的永远停在 EXECUTING）
**已有守卫**：`plan-lifecycle.deduplicatePlans` 的同房在途互斥 + `tests/unit/expansion/plan-status-ledger.test.ts` 里那条孪生用例。

**顺带一条要写下来的偏差**：那份测试自建的 pid 用的是 `${roomName}#${tick}`（**`#`**），产线是 `@`
⇒ 测试覆盖的是**相等匹配这段逻辑**（成立），但它造的形状产线永不发出。
⇒ 别把 `#` 当现场形状去 grep；按现场形状排查时用 `@`。这正是"测自己手拼的夹具"那一族的轻量版，记一句免得下轮误判"产线 id 形状有两种"。

⇒ **#11 的四项待核实到此全部有归属**：执行期复检（§13 已核）、视野依赖（`tryConsumePlan` 的 invisible-skip 已核）、
  planId 碰撞（本节）、"经验账无人读"（属无主仪表那族，已按量级结案，见 `silent-inert-mechanisms` 的 §八注）。

边界：零 src、零 push、零 build、零 console；全量 e2e 仍在后台（34 张，`/tmp/e2e-full.log`）。

---

## R229 · 2026-10-03 14:4xZ（P-A 前置全部复核通过；工业链第一次发布了一条 GH2O 需求，但买入侧还没走）

**① P-A 前置（约 1.9 小时后 tick≈83405220 到期）**：四张 `WAITING_EXECUTION` 的 sponsor 仍是 **W37S58 一间**
（RCL8、自有 spawn、storage 889,323）⇒ §13 查到的那条"sponsor 不查 spawn/RCL"弱点**今天不构成风险**
（没有哪张单挂在不孵兵的房上）。`ready` 从 87,231 涨到 89,391 拍（继续累加，未被 G0 复位 ⇒ 与"晋升门与执行门是两套"一致）。
人口 34（W37S58 22 / W38S56 12）、`credits 13,125,191`（自 R211 的 12.82M ≈ **+304k/2,000 拍 ≈152/拍**）、
storage 889,323（ratio 0.8893，仍在触发线 0.9 之下且方向朝下，与 R223 一致）。

**② 新事实：工业链第一次发布了 lab-reaction 需求。** `trade` 账本读到
`demandTop="GH2O:115/p20/lab-reaction"、demandsPublished=2、publishedAt=83402318` —— 这是 #44/#51 那条
"缺料自锁已拆但行情合闸⇒行为零变化"之后，**第一次看到 lab 真的发需求**（爬 T2 经济线的动作，与 #49 的 `reactionTarget="G"` 同向）。
⚠️但**不能说买入已跑**：同一份账本里 `buyTried=0 / buyOk=0 / buyBlockedBy=""` ⇒ 需求发布了、采购动作没执行。
而 `demandsLive=0` **不是**"需求消失了"——那正是 `lab-system.ts:441` 注释点名过的读侧形状
（"demandsLive=0 而 reactionPlan 明明在账上"），与 `demandTop` 非空自相矛盾 ⇒ 计数口径不可信，别用它下结论。
⇒ 下一轮的读法：先看 `buyTried` 是否 >0 与 `buyGatePrice/buyBestAsk`（决定这条需求会不会真买到东西），
再看 `factory-commodity` 有没有条目（#51 的判据是"看到条目要查行情是否翻正"）。**别用 demandsLive 判有无。**

**③ 全量 e2e 仍在后台**（pid=32674，34 张，产物 md5 `51e4768a…`）；本轮没有结果可报，只有进度。

边界：零 src、零 push、零 build、零 console；探针 = observe×1 + 源码 grep。属人 7 项未动。

### 巡检 R121（10-03 14:4xZ，不占 R 号）**工业腿第一次发需求，但它走的是没有 ROI 闸的那条路** ⇒ "`demandsPublished>0` = 行情翻正"这个读法是错的；G4 第四次回声、振幅量出（940 拍跌 4.04）；near-full 自己退回去（0.9 只是一次 <1,000 拍的越界）；**#90 的账现在算得齐**：对手 10 拍在场 + 我方 360 能量 ⇒ 我扩张冻 5,000 拍

· **产地判读（重要，#51 的判据要改）**：现场 `demandTop="GH2O:115/p20/lab-reaction"`、`demandsPublished=2`、`publishedAt=83402318`、`buyGatePrice=370`、**`buyTried=0 / buyOk=0 / buyBestAsk=0`、`demandsLive=0`**。码侧：正 ROI 闸 `commodityBatchRoi` **只有 `factory-manager.ts:164` 一个调用者**（注释"行情倒挂时一条需求都不发"），而 `reason="lab-reaction"` 出自 **`procurement.ts:109-141 expandReactionDemands`**——那里只有 `deficit=need−have>0`，**没有价值闸**；价格侧只有 `terminal-market.ts:245` 的动态上限 `min(adjustMaxPrice(均价+premium, priority), fallbackMaxBuyPrice)`。⇒ **口径改为：只有 `reason=factory-commodity` 的需求发布才代表 ROI 过了；`lab-reaction` 只代表实验室缺料。** 买 GH2O 是否价值为正今天无从判断、且一分钱没花（`buyTried=0`）⇒ **只报形状不定罪、不动它**（工业/贸易属对端 + 政策侧）。矩阵记法建议：industry 行 = "需求已发布、成交未观测"，别跨到 LIVE_VALIDATED。
· **G4**：`gateNetFlow={3.792, −1.743}` ⇒ Σ=**2.049** 再红（dashboard@83402784 `v=2.0`）。同段输入 `nf +14.14→−9.35`、Σ `5.850@83401935→2.049@83402875` ⇒ **940 拍跌 4.04**，与 α=0.02/100 拍自洽。⇒ **写 G4 必须同时给 Σ 与同拍 `nf`**；幼房那台连续恶化（−0.616→−1.743，其 RCL5 建设潮 storage −10.6k）⇒ 帝国余量全靠核心房一台（R185-D 逐轮可见）。
· **near-full 退了**：`storageNearFull=false`（889,512，ratio 0.8895；峰值 902,298 只维持 <1,000 拍，核心房 storage 940 拍里 −12,786=−13.6/拍）⇒ ①我写死的"翻真当拍读响应"窗口关闭，**"饱和响应吃净流"至今 0 次现场检验**；②对 #88 是双向收敛：**停卖既不会很快顶满仓，"卖单是泄压阀"这个反对意见也站不住**，而收益侧（运费 3.67~4.38/拍）不变 ⇒ 决定仍属人，两边量级都已给实。
· **#90 齐账**：第 5 次目击 `EnemyInvasion@83402215 → EnemyCleared@83402225`（**10 拍**、6 塔）；我用两发基线定价：核心房 `towerSpendCombat 2,460→2,820` ⇒ 本场 **+360 能量**（上场 30 拍 +1,800 ⇒ ≈60/拍，两处一致）。环覆盖含全部五场，`CreepDeath` 末位全 `1` ⇒ **五场零战损（可判的负结论）**。目击间隔实测 **380 / 1,995 拍 < 生效窗口 5,000**（`posture-baseline.ts:46` 的 "low" 档；交叉验证=`expandMinBucket 6000` 与 `expandMaxPressure 0.5`）⇒ `threatRecent` 永不清零 ⇒ war 已连续 ≈5,700 拍、退出时刻被推到 **83407214（≈16:0xZ）**（这是我第三次被新事件改写预测）。⇒ **给 owner 的一句话：下一把钥匙不在幼房（RCL5 已到手）、不在 CPU（执行门禁不看 G4/G6），而在"目击间隔 > 5,000 拍"**；免费可观测，我不制造敌情、不动任何战争闸。修法方向仍是给威胁记忆/宣战加"战损维"（#90，属对端+属人）。
· **幼房自主成长第二发（带增量）**：`ec 1300→**1450**`（3 块 extension 落地）、`ea=1450/1450` 满、`queue=0/10`、仍有 3 块 extension `state=site` 在施；远矿 `W38S55 state=active ledger{d:7879,s:9700,i:5000}`、`roadHeatTiles=37`（24~56）而 `roadSiteCount=0`、`siteCount 1→0` ⇒ 路在算但还没有路工地（与核心房 `无site` 那一族同型，不是停摆）。
· **边界**：零 src、零 push、零 build、零 console；探针 observe×1 + peek×3 + ring-dump×1。**R122**：①两房 `lastHostileAt` 间隔是否终于 >5,000（war 退 ⇒ G0 消失 ⇒ 第一次真 claim 窗口，核 `Memory.rooms` 是否 3 房）；②`buyTried/buyOk` 是否变、storage 是否出现 GH2O ⇒ 只有 `buyTried>0` 才谈得上这条无 ROI 路的花费；③G4 回绿必带同拍 `nf`；④幼房 `reserveOnly` 差分继续给 #61 供量。§3.5 属人 7 项未动。

---

## R230 · 2026-10-03 14:5xZ（R226 把证据说小了：21/22 两张是有断言的，但那不覆盖 #102 那条路）

**纠正自己上一条的过度保守**：R226 我写"那三张只断言 无 JS 错误 + Memory 体积"——那是把 §13 里对 **20-claim-chain** 的观察
错误地推广到全部三张。实读结果行显示：**E2E-021 断言"stale 诱饵情报不触发 warPlan、全程存活"、E2E-022 断言
"war 授权真目标、编队孵化、全程经济不越红线"**，两张都在新产物上通过（185s / 252s）。
⇒ 更正后的准确版本（**证据要按"覆盖了哪条路"分，不按"跑了几张"分**）：
· **#99 / #105**（战争漏斗计数、恢复拒因表）：由 21/22 的**有断言**跑法背书 ⇒ 从"只有单测"升到"引擎级带断言不回归"。
· **#102**（扩张执行闸）：仍然只有 **20-claim-chain** 那张薄断言覆盖（它走的是 claim 消费路径，21/22 走的是 war 授权路径，
  **不经过 `GATE_THREAT_UNCHANGED`**）⇒ 等级维持 `TESTED + 引擎不炸`，不许升。
⇒ 通用一条：**宣布"某改动被 e2e 覆盖了"之前，先说清哪张场景真的穿过那段代码**。

**R229 那条 sponsor 判断从"间接"升成"原始"**：给 `peek.mjs` 加了 `PEEK_FULL=1`（关掉 700 字符截断），
原文件默认行为**逐字不变**（对端看门狗按行 grep 这份输出，不能动默认）。用它直读 `kernel.expansionPlans`：
四条 `"rn"/"sr"/"st"` 全列出 ⇒ **W37S56 / W36S58 / W37S57 / W38S58 的 sponsor 都是 W37S58，四张都是 WAITING_EXECUTION**
（此前那句只来自 observe 的排版，现在是原始 Memory 读数）。⇒ #13 那条"sponsor 会不会是不孵兵的房"在 P-A 前排除。

全量 e2e 仍在后台（其余 31 张）。边界：零 src、零 push、零 build、零 console；本轮唯一代码级改动在 `tmp/`（未跟踪）。

## R231 · 2026-10-03 15:0xZ（#35/#48 定案：合同台账**按构造不可能**给出交付证据，我原先挂的判据测的是它自己测不到的东西）

**这轮把最长的一条 pending（#35/#48 跨房供给）读到结案，结论是撤我自己的判据，不是判系统坏。**

**① 读侧修复确实已上线**（不是"未部署"这一态）：`git log -S deserializeContract -- src/systems/room/logistics-planner.ts`
= `e50ef36`（2026-09-30），`git merge-base --is-ancestor e50ef36 origin/dev` 通过，且 `origin/dev..HEAD` 里
**没有任何一笔碰过这个文件** ⇒ 读侧反序列化在线上跑了 3 天。

**② 但 `td=0 / ua 冻结` 不是交付失败的证据，而是"这条台账永远不动"**。三次 grep 各自独立指向同一处：
`recordDelivery` 在 `src/` 只有定义（`supply-contract.ts:291`）+ 一处注释（`contract-lifecycle.ts:284`），**零调用者**；
`contract-node-bridge.ts` 与 `contract-lifecycle.ts` 的导入者**只有 tests**（`tests/unit/economy/supply-contract.test.ts`、
`tests/unit/logistics/a4-4-convergence.test.ts`），`src/` 里零导入 ⇒ 桥接与状态机（activate/degrade/complete/cancel）是
**测过但从未接进产线**的代码。后果写死：合同被创建时写入 `ua=ac=ca=83316316`，此后没有任何路径能改 `td/cs/ua/st`
⇒ 现场读数 `{"td":0,"cs":0,"ua":83316316}` 与"物理上交付了 5 万能量"可以同时为真，**互不矛盾**。
这正是记忆里第 14 类错（判据里放了改动物理上碰不到的读数）的又一发：我为 #35 挂的判据是"看 `td` 涨"，
而 `td` 的唯一写者不存在。撤这条判据，并把它换成下面 ③ 那条独立结构证据。

**③ 物理面用累计账本读（一次成对、一次差分口径）**：`kernel.stats.energyLedger.rooms`（tick=83386488 是 boot 时刻，
一律按"值 ÷ (Game.time − tick)"理解，不当时点值）
- 幼房 W38S56：`imported=59,079`、`exported=0`
- 核心房 W37S58：`exported=50,400`、`imported=403,457`
⇒ 跨房供给**真的在跑**（两量同量级），只是不经过合同台账记账。成对入账机制（`07d0be4`）判为**在工作**。
59,079 − 50,400 = **8,679 的差不立案为漏账**，因为有现成解释且方向对得上：写 `imported` 的
`fill.ts:22-29 importedFieldFor()` 只比"交付房 ≠ 来源房"就记 `imported`，远矿流入天然算进去；
而写 `exported` 的只有 `carrier.ts`/`terminal-selfaid.ts`（自家房流出）。⇒ 两键**不是恒等式对**，
`exported == imported` 只在"两房之间的净配对"意义下成立（幼房 exported=0 ⇒ 全部 50,400 都可能是核心房那侧）。
残留：8,679 未逐笔拆到"远矿 vs 配对"，不写成结论，也不配当缺陷（无受害者）。

**④ 给 #35/#48 的最终口径**：#35 读侧半支 = 已上线已生效；**写回半支 = 从未接线，拆成新条 #106**。
#48 = 判据换到物理配对（上面 ③），**任何以 `td/ua/cs` 为判据的验证一律作废**，包括我自己 R 系列里那句
"看到合同 `li` 出现就算交付"。重开 #35 的条件也写死：只有当出现一个**能改合同键的写者**（新 PR 里 `recordDelivery`
有 src 调用者）时，`td` 才重新成为证据；在那之前它是创建时刻的化石。

**⑤ 顺带一条未决、且我明确不猜**：合同请求此刻到底发不发，取决于 `logistics-planner.ts:278` 那道
"两端都有 storage"安全闸，而**幼房有没有 storage 从 Memory 读不出来**（`storageNearFull` 两分支都写、`rb` 是缓冲拍数
×10 不是容量、`buildQueue` 里只有 extension/link/rampart 条目 ⇒ 只能说"没有在等的 storage 工地"）。
本轮零 console，所以这条留给下一发读数，不写成"闸开着"也不写成"闸关着"。

**⑥ 看门狗 ANCHOR-MOVED（#92 今晚第二次现场演示）**：`posture-exit2.log` round 9（14:09Z，tick 83402284）
`newSighting=W37S58:83402214` ⇒ 退出锚从 `83400220+5000=83405220` 推到 **`83402214+5000=83407214`**。
一次 ≤45 拍的目击又要走 5,000 拍，而且这次是**尾窗内第二次落锤**（第一次 83400220、第二次 83402214，间隔 1,994 拍 < 5,000）
⇒ #92 的形状从今天早上说的"单次目击缴 5,000 拍税"变成"**脉冲骚扰可以让 war 尾永不结束**"：只要目击间隔 < threatWindow，
锚就一直前移。这是观察结论、不改码（`threatWindow` 属人）。
覆盖检查按纪律做过：pid 7182 在 round 13/45、每轮约 100–200 拍 ⇒ 末轮覆盖到 ≈83409,284 > 83407214，
**不克隆、不编辑运行中的脚本**，读判据时按 `newSighting` 现算锚。

**⑦ 一条待读、不待结论**：幼房 `lastRclLevel=5`（`lastRclChangeAt=83400802`）⇒ RCL5 已命中，但 round 10–13 仍
`Blocked=G0+G4+G6`。这与 #34 那条"G0 要 RCL5"对不上，两种解释都还没证据（G0 的条件我本轮没重读，可能是 `coreRooms≥2 且 core=RCL≥6`
那一支，也可能是 G0 根本不是 RCL 项）。**下一轮第一件事：读 `readiness.ts` 里 G0 的判据原文再判"到点没解"是不是伪命题**，
不要在这里就把"G0 该绿"当成已证。

边界：零 src、零 push、零 build、零 console；只读 API 8 发 + grep。全量 e2e 仍在后台（跑到 31/34）。

## R232 · 2026-10-03 15:0xZ（R231 ⑦ 当场读结：G0 从来不是 RCL 项，"RCL5 命中消掉 G0 假项"是错的）

读 `readiness.ts:151-158` 原文：**G0 = `postureExpansionAllowed`**，条件字面写着 `posture.expansionAllowed === true`，
值就是布尔。RCL 走的是另两条：G3 的 evidence 里带 `core=${view.coreRooms}`，G5 = `coreRooms ≥ minCoreRooms`
（`readiness.ts:200-207`），而 `coreRooms` 是 `resource-view.ts` 按房分类算出来的 —— 也就是说**升 RCL 影响 G3/G5，
不直接动 G0**；G0 是**总授权**（posture 那七个合取项 + `!liveThreat` + `posture!=="war"` 折叠成的一个布尔）。

后果三条，都要带走：
1. **R182 那句"RCL5 命中消掉 G0 假项后 G4 仍单独挡"作废**，`3b7d7a3`（已推的 origin/dev head）里"请示面收窄到
   G0/G6 本身"这句**符号仍然对但理由要换**：G0 不是"假项"，它是**唯一被 war 尾税直接钉住的那一项**，
   所以今天 `Blocked=G0+G6` 的正确读法是"**war 尾 + CPU**"，两半都不是 RCL。
2. 于是"到点没解"这个疑问从"预测失败"降级为"**预测用错了闸**"：幼房 `lastRclLevel=5`（`lastRclChangeAt=83400802`）
   不欠任何 G0 账；G0 的解锁时刻**只由 `max(lastHostileAt)+threatWindow` 决定**，即 R231 ⑥ 那个 83407214
   （且每次新目击都会把它前移）。这把 #92 从"观察项"升成**今天扩张的第一阻塞本身**，而 G6 是第二。
3. 一条我没重读、因此不写成已证的：#34 那句"healthy 闸要 RCL6（coreRooms≥2 且 core=RCL≥6）"本轮**没有**再核常数。
   它影响的是 G3/G5 与 posture 的 `youngestMature`，不影响上面 ①②，但影响"RCL6 之前 G5 会不会一直红"——
   下一轮要引它就先读 `resource-view.ts` 的分类阈值。

边界：零 src、零 push、零 build、零 console；只读 API 一发 + 读码。

## R233 · 2026-10-03 15:0xZ（把 #106 的识别法当筛子用一遍：domain 层 **33/225** 个模块在生产线上零导入者）

`#106` 那条是"读现场读数读出来的"，这轮把它**反过来当筛查工具**：对 `src/domain/**` 每个非 `.d.ts` 模块，
grep `src/` 里按 basename 的导入者，零命中即候选。225 个里 **33 个命中**，分两档（差在有没有单测）：

**A. 有单测但产线进不到（16 个 = 真·"建了能力没接线"，与 §8b/§3b 同族）**
`economy/contract-lifecycle`、`economy/contract-node-bridge`、
`economy/resource-flow`、`economy/role-transition`、`economy/route-efficiency`、
`expansion/colony-dashboard`、`expansion/execution-dashboard`、`expansion/execution-operation`、`expansion/roi-tracker`、
`logistics/delivery-validation`、`operation/preemption`、`operation/replan`、`operation/stability`、
`operation/transport-planner`、`remote/container-lifecycle`、`remote/opportunity-ranking`

**B. 既没接线也没测试（17 个 = 纯死码）**
`logistics/adaptive-routing`、`backpressure`、`batch-sizing`、`death-recovery`、`demand-batching`、`emergency`、
`fairness`、`hauler-scaling`、`overdelivery`、`partial-delivery`、`reliability`、`request-lifecycle`、`rerouting`、
`route-suspension`、`starvation`、`economy/reconciliation`、`strategy/empire-balance`

**两条不许外推的方向**（我先把自己这一步按住）：
1. **不成立为性能问题**：这些文件没有导入者 ⇒ 打包器（esbuild）根本不会把它们带进 `dist/main.js`
   ⇒ 删与不删**对线上 CPU/内存零影响**。它们的代价是**维护与"验证真相"**：矩阵里任何一行如果把这类模块写成
   `TESTED`/`LIVE_VALIDATED`，都是在给下一轮发假信号（我今天就是被 `td=0` 那块化石骗了一次）。
2. **"零导入者"不等于"应该删"**：其中几组看起来是**故意留的下一阶段**（`expansion/execution-*` 与 `operation/*` 是殖民与运力执行的
   零件，`logistics/*` 一整片像 A4.x 的设计前置）。**接线还是删，属人**（拆 `#107`）。

**方法学留三条给下一轮（都是这次差点踩到的）**：
- 筛子的假阳性来源要当场排：本仓 `src/domain` 只有一个 barrel（`tactical/index.ts`），且它**不是**任何候选的父目录；
  另对 4 个候选（`route-suspension`/`backpressure`/`roi-tracker`/`container-lifecycle`）用**去后缀全文 grep** 复看，
  在自己文件与 tests 之外**零提及** ⇒ 这轮的 33 不靠"只匹配 import 语句"活着。
- 目录级 import（`from "../logistics"`）不会被 basename 匹配到 ⇒ 若哪天加了 barrel，这条筛子要一起改。
- **别把"有单测"读成"在跑"**：A 档 16 个全有单测，`recordDelivery` 甚至被测试断言过交付累加逻辑 ——
  它绿着，产线上却零调用者。**判 status 只看 `src/` 的调用者，不看 tests。**

边界：零 src、零 push、零 build、零 console；纯 grep。全量 e2e 仍在后台（31/34 那张长跑）。

## R234 · 2026-10-03 15:2xZ（war 尾税量到**上界形状**500 倍，并拆掉 #96 里一个会把回收算成战损的标签）

**① 尾税比值从 ≈110 倍改成 500 倍**：事件环里 `EnemyInvasion 83402215 → EnemyCleared 83402225` ⇒ 这一波在场 **恰好 10 拍**，
而它把退出锚推到 83407214（= 目击 + `threatWindow` 5,000）⇒ **10 拍的在场换 5,000 拍的扩张税 = 500 倍**。
方法学一条值得留：**在场时长不用新代码就能量** —— `telemetry-collector.ts:591-614` 这对事件是 `hadThreats` 的**边沿触发**
（进/出各一条），成对相减就是在场拍数；我此前引的"≤45 拍"来自另一处读数，那是上界不是实测。

**② 这一波不是"噪音"，是真武装单位**：payload 语义读自写者（`[threatCreeps, heals, ranged, melee]`）
⇒ `d=[1,0,3,2]` = **1 只 creep、3 个 RANGED_ATTACK、2 个 ATTACK、0 个 heal**。按 `isSquadThreat`（armed≥2 或 armed+heal）
它是**独狼**（单只带杀伤部件），所以"塔集火即可、不升级响应"这条分类也自洽。
⇒ 我本来想验的假设**"尾税被 work/claim 这类无杀伤单位缴掉"这一发不成立**。但 `CONFIG.defense.threatParts`
确实含 `work` 与 `claim`（`:589` 起：attack/ranged_attack/heal/work/claim），所以那支假设**只是未被本样本支持、没被否证**；
要判它得攒多次 `d` 里 `ranged+melee==0` 的入侵，而环只回溯 2,393 拍（本段 1 发入侵）⇒ **样本不够，不结案**。
顺带核掉一条我自己差点误立的"设计矛盾"：`threat.ts:42-46` 那句"纯 CLAIM 无杀伤"**属于 `isSquadThreat`**（窄判据），
不是给 `isThreat` 的注释 ⇒ broad/narrow 两把尺是**故意的分级**，不是缺陷。

**③ 计数按纪律全量重数**（不 tail）：环内 `CreepDeath` **65 条 = 63 寿终 + 2 非寿终**；两条非寿同签名
`r=W38S56 d=[8,26,11,age,0]` ⇒ **同一角色（roleCode 8 = remoteHauler）、同一格 (26,11)**，age 182 与 407。

**④ 由此发现 #96 的一个标签错，并在推之前拆掉它**：`natural` 的判据是"没活到寿终"（`event-log.ts:285`），
而**早逝不等于战死** —— `spawn-manager.ts:333 recycleCreep` + `creep-recycle.ts:74`（回收连随身货物一起销毁）
是**自家主动**的早逝通道，旧代码把它 `else` 记进 `deathByCause.combat`。#96 未推 ⇒ 现在改是免费的；
一旦上线，#90 的"持续战损"判据会把回收读成敌方杀伤、**凭空多出受害者**（那正是"计数器变大要配受害者才算缺陷"的反面教材）。
改法：三桶 `{natural, combat, recycled}`，`combat` 只收"早逝**且**未被 `memory.recycle` 标记"；
`recycle` 标记在死亡检测时仍可读（`memory.ts:52-55` 清的是 `Memory.creeps[name]` 本身，那一拍对象还在 ⇒ 是 **CreepMemory 本体**）。
增量一律 `?? 0` 写（加键到已存在持久对象那一族的靶心）。**它不参与任何判定**，只增不减。

**⑤ 反向实验 + 一次 tsc 救场**：把回收分支判据钉成不可能值 ⇒ **恰好 2 条转红、12 条绿**（含控制组"未标记仍进 combat"），
撤钉后 14/14 绿、`grep REV-EXPT` 无残留。⚠️过程中 tsc 先报错 `Property 'memory' does not exist on type 'CreepMemory'`
⇒ 我第一版写成 `Memory.creeps[name]?.memory?.recycle`，而**我的测试夹具写成同一个错形状**（`{memory:{recycle:true}}`）
⇒ 那条用例当时是**绿的**，但它测的是产线永远不会写的形状。**这是"测自己手拼的夹具"那一族的又一发，
差别只在于这次是 tsc 而不是现场读数抓住的** —— 类型检查在跑单测之前跑，等于免费的夹具校验。

**⑥ 对推批的影响（不改请示面）**：本笔属**纯仪表**（`deathByCause` 零消费者，已 grep 确认只有类型/写者/我的测试），
所以选项 B（只推仪表与注释）**仍包含它**，行为改动仍是 2 笔（`1bc67c9` #89 松、`58b1efa` #102 紧）。
但口径变了：**#96 的 `combat` 上线后才是"早逝且非回收"**，#90 的判据要按三桶读。

边界：src 2 行级改动 + 测试；零 push、零 build、零 console（dist 不动，仍等于我上轮建的那版）；
`npx tsc --noEmit` 干净、`creep-death-event.test.ts` 14/14。全量 e2e 仍在后台。

## R235 · 2026-10-03 15:2xZ（外交首次入矩阵：**"谁在打我"已经算出来并持久化了，但没有任何消费者**）

L0 §2.3 欠的那一行（外交/声明）补成矩阵 **§17**。结论不是"没有情报"，而是**情报齐、政策侧零接线**：

**① 在跑的一半（逐条核到调用者，按 R231/#106 立的规矩）**：`domain/intel.ts:437 upsertPlayerObservation`
被产线调两次 —— `systems/intelligence.ts:62`（活动信号）与 `:80`（`hostile=true`）⇒
每玩家记 `{owner, lastSeenAt, lastHostileAt（单调前移）, rooms{房→tick}}`，段 5 月级持久化。
**这不是化石计数器**：它有 `src/` 调用者，且写的是**按人归因**的敌意时刻。

**② 缺的一半**：grep 全仓 `lastHostileAt` 的消费者，**四个读的全是房级、不认人的 `Memory.rooms[].lastHostileAt`** ——
`empire-strategy.ts:57`（喂 posture ⇒ 就是那条 war 尾税）、`tower-defense.ts:223`、`fortification.ts:79-83`、`room-profile.ts:283`。
**零个**读 `PlayerIntelEntry.lastHostileAt`。⇒ 按人归因的数据写了、存了、没人用。
后果具体到今天的形状：一次 10 拍的武装访问（R234）缴 5,000 拍扩张税，而**换任何一个别的玩家来打也一样计**
—— 系统无法区分"正在被 X 持续攻击"与"三个月前 X 路过一次"，尽管后者就在段 5 里。

**③ 敌我名单是个人手编辑的空数组**：`CONFIG.defense.allies = []`（`config/index.ts:589`）是全帝国唯一的"非敌"机制，
消费者 6 处（`targeting.ts:23`、`room-snapshot.ts:64`、`plan-adapter.ts:203`、`state-machine.ts:322`、`blocker-intel.ts:29`、`threat.ts:13`）。
grep 确认**运行期无写者**，且 `resolveStrategyOverrides(...)` 只被 spread 进 posture options（`empire-strategy.ts:89-96`）
⇒ **自进化 L1 寻址不到它**（我先把这条写成"不能覆盖"，再回去读了合并链才敢这么说）。
⇒ 没有宣战/停战/中立声明，也没有"观察到长期和平的邻居"降级机制。

**④ 为什么这条不是学术条目**：§8b（帝国无进攻能力 #100）+ 本条 = **L0 §3.5 的"竞争"面只剩被动挨打**；
而 #92 的修法候选里**最便宜的一个恰好落在这里**：不是调 `threatWindow` 常数（那是把噪声和持续攻击一起放宽），
而是**让威胁记忆按行凶者计** —— 需要的原料已经在段 5，缺的只是消费方与一条到 posture 输入的接线。
**修法属人（#108）**，且我不自选：它会改变 war 的触发面（比 #89 更敏感），L0 §1.5 里"改变外交关系/主动战争"同族。

**⑤ 一条自我约束记下来**：这轮我先在矩阵里写了"不在 strategyOverrides 的可寻址路径里"，
那句话当时是**推断**（`strategyOverrides` 的类型确实是 `Record<string, ...>`，字面上像任意路径）。
回去读 `empire-strategy.ts:89-96` 才拿到机制级理由（overrides 只 spread 进 posture options）。
⇒ **"寻址不到"这类结构断言，必须读到那条合并链本身**，不能停在键的类型上。

边界：零 src、零 push、零 build、零 console；只读 + grep + 文档。全量 e2e 仍在后台（31/34 那张长跑）。

## R236 · 2026-10-03 15:3xZ（矩阵最后一行补齐：pixel 与 boost **两条链都接完线**，但"没在跑"的原因不同族）

L0 §2.3 欠的两行进矩阵成 **§18**。**关键是别把两种"没发生"混成一种**（三分法来自 R231/#106）：

**① Pixel = 配置切走（休眠实现），不是坏的。**
`pixelSystem` 在 `bootstrap.ts:172` 注册、interval 10，四道闸齐全（`CONFIG.pixel.enabled`、
`ctx.budget.tier === "healthy"`——用的是 **scheduler 那条 tier 轴**、`posture !== "war"`、`bucket ≥ CONFIG.pixel.cpuCost`）。
但 `enabled` **自 2026-09-27 就是 false**，判决原文在 `config/index.ts:170` 那段注释里，两条独立理由：
①放血吃光 bucket 时若逢 global reset ⇒ 每拍加载即被杀、bucket 永不回充（**线上实测 187+ 拍停摆**）；
②bucket 在本仓**首先是档位时钟**（healthy≥7000/guarded≥3000/conserve≥1000），借用额度只是附带 6 点。
**线上证据**：`kernel.pixelAt = 83270902` ⇒ 这链**真执行过**（≈132,000 拍前，按 3.06 秒/拍 ≈ 4.7 天），
此后静默与 `enabled=false` 完全一致 ⇒ **`pixelAt` 读成"最后一次成功放血"，不是"待生成进度"**。
顺手核了一个我差点误判的点：`stats.cpuMax10` **有写者**（`telemetry-collector.ts:731`）⇒ 那个闸不是 #106 那类化石。

**② Boost = 接线完整、被前置条件拒绝。**
全链我逐环 grep 过：`evaluateBoostRequests`(`lab-system.ts:385`) → `planLabs`(`:520`，boost 优先占 lab，
RCL6/7/8 分别 1/2/3 个 boost 位) → 报到拦截 `boost-report.ts` + `boostAssignments`(`:543-557`，
化合物与 lab 能量**都到位**才 `ready`) → `role-runner.ts:120`（在 flee 之后、正常工作之前等就位）→
**`lab.boostCreep(creep, parts)` 真的在 `:585`**，且 `parts` 被三重约束封顶（矿物存量 / lab 能量 / 匹配部件数 ——
注释写明不封顶必然 `ERR_NOT_ENOUGH_RESOURCES`），反向还有 `unboostCreep`(`:351`)。
⇒ 我 grep 到"boostCreep 只出现在注释里"时**差点按 §8b/#106 的形状立案 NOT_WIRED**，
区别在于我随后按 `boostCreep(` 带括号搜才命中调用点 ⇒ **"符号名命中"与"调用点命中"是两个不同的证据**，
前者会把已接线的东西报成没接线（反向也成立：#106 那次是零调用者是真的）。
当前不跑的卡点就是 **#49 那条算术**：`XGH2O = 0 < 门槛 130`、场上 **0 只战争角色**（没有可强化的 body）、
反应线才刚爬到 `reactionTarget="G"` ⇒ **"boost 零赋值"是正确态，别去"修"它**。

**③ 可否证预测（留给下一轮，不制造条件）**：首炉 T3（`GH2O`/`XGH2O`）进 lab **且**场上出现战争角色 ⇒
`industryMem.boostedCreeps` 应开始变长、`creep.body[i].boost` 应非空。
两者都在场而 `boostedCreeps` 仍空 ⇒ 才回到"接线缺口"这一族重查。

**④ 措辞纪律进矩阵**：`WIRED`（调用者存在）与 `EXERCISED`（线上跑过）**不许互替**，
所以本行标签是 `LIVE_WIRED_UNEXERCISED`（boost 当前）而不是 `TESTED`。

**矩阵至此覆盖**：§1–§15 + §16（零生产导入者清单）+ §17（外交）+ §18（pixel/boost）。
⇒ **#97 的逐条清单本体收口**（残留是每行的 `STABLE` 缺口，那是另一件事）。

边界：零 src、零 push、零 build、零 console；只读 API 3 发 + grep + 文档。全量 e2e 仍在后台（31/34）。

## R237 · 2026-10-03 15:3xZ（全量 e2e 第一次 34/34 绿；同时 G3 新红，根因是**RCL5 自己触发的基建消费**）

**① 全量 e2e 收口：`Test Files 34 passed (34)` / `Tests 72 passed (72)`**（`/tmp/e2e-full.log`，含此前一直红的 E2E-016 与 E2E-031）。
⚠️**覆盖率要说清，别把 34/34 读成"我这轮改的东西过了"**：e2e 的被测物是 `dist/main.js`（`BotHarness.ts:12`），
现盘 `787,613 B`、mtime **22:23（本地 +08）**，而 #96 三桶那笔 `63e2484` 落在 **23:21** ⇒
**那次运行不含 `63e2484`**（它只有单测覆盖，14/14 + 反向实验 2 红/12 绿）。按纪律我**故意没重 build**（窗内 build 会换掉被测二进制）。
⇒ 正确口径：**全量绿 = 树在 22:23 那个 build 上全绿**；`63e2484` 之后没有任何引擎级证据。

**② G3 新红，而且和 G4 是同一个输入**：dashboard（tick 83403484）
`Blocked=G0+G3+G4+G6`，`G3: economic health(v=deficit(netFlow=-0.6, core=1)|health ≥ growing)`、`G4: v=-0.6`
⇒ **G3 的 evidence 里就带着 netFlow**，所以这不是两件事，是**同一个净流读数的两次投影**（与 R181 那条"一个标志三次投影"同族）。
帝国慢 EMA 现已 **−0.6/拍**（对门槛 5）：今天从 +4.24（R182）一路走到负。

**③ 根因链逐环对上，而且方向是"里程碑自己压自己的闸"**：
`rooms.W38S56.lastRclChangeAt=83400802`（RCL5 命中）⇒ **同一拍** `buildQueue` 落 6 个 extension（3 个 `state:site`）+ 2 个 link 工地
（`queuedAt=83400803/83400804`）⇒ 幼房当窗 `bk={harvested:980 | spawned:650, upgraded:400, built:1084, repaired:88}`
⇒ 收入 980 vs 支出 2222 ⇒ **窗内 −1,242/50 拍 ≈ −24.8/拍**，其中 `built` 一项就 ≈ **21.7/拍**
⇒ 幼房快 EMA `nf=-2027` ⇒ **−20.3/拍**（核心房 `nf=747` ⇒ +7.5/拍）⇒ 慢 EMA 幼房 **−2.32**、核心 **+1.38**
⇒ Σ 落到 −0.6 一侧 ⇒ **G4 红 + G3 随 netFlow 一起红**。
⚠️两个数要说清：dashboard 打印 −0.6 是它自己那拍（83403484），我随后读到的 `1.3836 + (−2.3180) = −0.934` 是**稍后的第二发**，
方向一致、幅度还在恶化（不是矛盾，是两次采样）。
⇒ 给 **#88 的口径要换**：门槛 5 现在不是"余量薄"，而是**被 RCL5 解开的基建消费压成负**；
放宽 G4 在这拍等于"净消耗时授权下一次扩张"。这不是我该决定的，但选项的意义变了：**它的代价现在可指认为"幼房在建工地"**，
不是抽象的阈值数字。
顺带一条不被消费的读数：`core=1` ⇒ 幼房 RCL5 仍不算 core（#34 那条"core 要 RCL≥6"的口径，本轮没再读分类阈值）。

**④ §18 的 pixel 闸有第二发了**：`kernel.stats.cpuMax10 = 19.8`（写者 `telemetry-collector.ts:731` 活着）
⇒ `peak <= 0 || peak >= limit(20)` 这道闸**今天是过的**（19.8 < 20 且 > 0）。所以 pixel 静默的**首要**原因确实是
`CONFIG.pixel.enabled=false`；但**别顺手把它写成"只差开关"** —— `ctx.budget.tier === "healthy"` 那一道在当前 `tier=tight` 下**同样过不了**
⇒ 重开 pixel 需要两处同时成立，属人已定过一次的理由（187+ 拍 reload 停摆 + bucket 是档位时钟）仍然在。

边界：零 src、零 push、零 build、零 console；只读 API 2 发 + 文档。看门狗 round 17/45、`newSighting` 自 round 9 后未再出现。

## R238 · 2026-10-03 15:3xZ（撤我自己 R235 那句"段 5 月级持久化"：线上段 5 是空的 ⇒ 按人归因的敌意记忆**不跨部署**）

**触发点**：我要为 #108 量"当前活跃行凶者有几个"，跑 `tmp/tools/official/intel-players.mjs` ⇒
`EMPTY: 段 5 未写入 …（状态未知，不等于 players=0）`。

**三条排除做完才敢撤自己的话**（这一步是本条的全部价值）：
1. **不是鉴权伪影**：我另写一发临时脚本用 `Cookie: token=` 读段 2/3/5/6 ⇒ **全部 401**，
   而对端可用工具用 **`X-Token`**（`ring-dump.mjs:35`）⇒ 我这发的 401 只证明**我的 header 错**，不证明服务器没数据。
   `intel-players.mjs` 自己把 **`FAIL: HTTP n` 与 `EMPTY` 分成两条输出**（`:35` vs `:41`），它报的是 EMPTY ⇒ **HTTP 200 且该段缺席**。
2. **不是读错段号**：`CONFIG.segments.intelPlayers.id = 5`（`config/index.ts:54`），且 5 在 `ALL_SEGMENT_IDS`（`segment-store.ts:95-103`）里被 `setActiveSegments` 请求。
3. **不是"还没到节拍"**：boot 在 83386488、现读约 83403,500 ⇒ 已跑 ≈17,000 拍，`intelCoverage={rooms:7,players:2}` 每 100 拍在落 ⇒
   heap 侧确有 2 个玩家，老化批处理（`intelligence.ts:183-192`，含 `persistPlayersToSegment()`）不可能一次没跑。

**机制上为什么可能是空的（候选，未定罪）**：写回闸是 `if (cache.intelPlayersDirty && cache.intelPlayersSeg)`（`segment-store.ts:531`），
而 `readIntelPlayersSegment()` 在 `segmentUnavailable()` 为真时**故意返回临时对象且不缓存**（`:337`，注释写明"防空数据覆盖历史"）⇒
`persistPlayersToSegment()` 把数据写进临时对象、只把 dirty 置真，flush 那侧 `cache.intelPlayersSeg` 仍是 undefined ⇒ **整段跳过写入且不落缓存**。
只要 `segmentUnavailable(5)` 持续为真（例如激活宽限/观察判据与实际投递不符），这条链就**每拍自我复读而不落地**。
候选解释还有"服务端只投递了清单里的一部分段"。**我不在这里选一个当结论** —— 定罪需要一次能区分两者的读数（按 `#109` 的判据做）。

**要撤的话（我自己上一轮写的）**：§17 那句"经段 5 月级持久化。这是'谁在打我'的完整原料"⇒ 已就地改成
"按人归因**只在 heap、每次部署归零**；冷存路径存在但线上未落地（#109）"。
**这条对 #108 的代价评估有直接影响**：按行凶者计的威胁记忆如果建在未落地的冷存上，
那么"三个月前 X 路过一次"这类跨部署证据**根本不存在** ⇒ 任何"按人降税"的修法要么先把段 5 写通，要么换持久面（Memory 侧）。

**同时成立、不必撤的两条**：`upsertPlayerObservation` 确有产线调用者（R235 的接线判定是对的）；
四个威胁消费者仍读房级不认人的键（#108 的缺口判定也是对的）。撤的只有"持久化"那一半。

边界：零 src、零 push、零 build、零 console；只读 API 若干 + 一发我自己的 header 错的探测（已记为伪影）。

## R239 · 2026-10-03 15:4xZ（二次反转：**段 5 不是空的**——我上一轮撤了一条本来正确的结论，因为读数器路径恒 undefined）

**发生了什么**：R238 我写"线上段 5 为空 ⇒ 按人归因的敌意记忆不跨部署"，并据此拆了 #109、改了 §17。
那一轮的**三条排除**（header 伪影／段号对／节拍已过）都做过了，但**漏了第四条，也是唯一要命的一条**：
**读数器读的键路径本身对不对**。`intel-players.mjs:39` 写的是 `body?.segments?.["5"]`，
而这个端点的真实形状是 **`{ok, data:{"0":…,"2":…,"5":…}}`** ——载荷在 `data` 下、**以段号为键**
⇒ 那个路径**恒为 undefined** ⇒ 无论服务器上有没有数据，它**每次都打印 EMPTY**。
它把"HTTP 失败"和"EMPTY 状态未知"分得很清楚（这点我信了），但**EMPTY 自己就是假的**。

**证据与修法**：同一张请求换成 `body.data["5"]` ⇒ **段 5 存在，191 字节**；
另外我那一发"全 7 段 present=false"的探测同样是这个路径错（不是服务器没数据）。
已就地改读数器：改成 `body.data[seg]`（旧形状容错），**并且**把"存在性"和"内容解码"分成两条出口——
`PRESENT: 有数据 字节数=…` / `FAIL-DECODE: 载荷不是裸 JSON ⇒ 不得据此判冷存未落地`。
因为 191 字节**还没解出来**（gzip/base64/3 字节前缀的长度没标定；我试了整段 gunzip、去前缀 gunzip、裸 JSON 三种都失败）。

**要带回的真实结论（这次有证据）**：
1. `§17` 恢复"玩家域冷存**在落盘**"——但强度降一级：**存在性已证，内容未读出**，所以我**不能**说"跨部署可查"到字段级。
2. **#109 撤案**（其"从未落地"的立论就是这条假阴性），改成一条**工具债**：标定段载荷的解码链。
3. **"活跃行凶者有几个"这个数，本段拿不到**：唯一可得的仍是 `kernel.stats.intelCoverage={rooms:7,players:2}`（Memory 侧，非段内）。
   ⇒ **#108 的代价评估回到 R235 的口径**，不要被 #109 的错误版本带跑（我在锁里也写了撤回）。

**方法学（这条是本份记录的价值所在）**：
- **"撤证据"和"撤解释"要用不同的证据**：R231 我撤的是"td=0 的**解释**"（键有值但没人写）；
  这次我撤掉的是**事实本身**，而依据是一条**从未在已知有数据的段上验证过的读数器**。
  规矩应当是：**任何"某存储为空"的结论，必须先在同一个工具上跑通一个已知非空的样本**（段 2 的环我当天读成功过，
  但那是**另一个工具**——我没让 `intel-players.mjs` 先读段 2 证明自己）。
- 我把这条写进工具注释与记忆：**没在已知正样本上跑通的读数器，不得进入判据链**（已有同族纪律是"新写的工具没端到端跑通就别进判据链"，
  这次是它的**反向**：**旧**工具也可能从未端到端跑通过——"存在过"不等于"验证过"）。

边界：零 src、零 push、零 build、零 console；改动只在 `tmp/`（未跟踪）与文档。

**R239 补记（同轮，路径终于标定对）**：`memory-segment` 在**单段请求**下把内容放在 **`body.data.segments["<id>"]`**；
一次请求带多个 `segment=` ⇒ 每段退化成 **1 个字符的桩**（`seg=2 len=1 head="e"`、`seg=5 len=1 head="n"`）。
所以我这轮**连错两次**：先是 `body.segments[5]`（恒 undefined ⇒ 假 EMPTY），后是 `body.data[5]`（拿到桩 ⇒ 假"1 字节"）。
正确路径下同批读通：**段 2=22,414 / 段 3=26,970 / 段 5=191 字符** ⇒ **段 5 确在落盘**，R238 的撤案作废、#109 撤案（改记工具债：解出这 191 字符）。
⚠️规矩由此收紧成一句可执行的：**任何"某存储为空"的结论，必须先用同一个工具、同一条请求形状，读通一个已知非空的邻居样本**
（这次已知非空的是段 2/3 的环，而我校准用的却是另一条路径）。

## R241 · 2026-10-03 15:4xZ（段 5 解码成功 ⇒ **按人敌意字段恒为 0**：#108 缺的不是消费者，是那一列数据本身）

**先解掉 R239 那笔工具债（两条形状错都归位）**：`/api/user/memory-segment` 的 **`body.data` 就是内容字符串**
（`Object.keys(一个字符串)` 返回**字符下标** ⇒ 我上一轮看到的 `dataKeys=0,1,2,…` 是我自己造的幻影，
而 `data["5"]` 取的是**第 6 个字符**，所以"1 字节"也是假的）。载荷是**裸 JSON**，没有 gzip/base64。
按正确形状读：**段 2 = 22,476 字符、段 5 = 191 字符**，两者都 `JSON.parse` 通过。

**内容（原始读数，段 5）**：
```
{"epoch":83403803,"players":{
  "Aguia":      {"lastSeenAt":82657950, "lastHostileAt":0, "rooms":["W38S58"]},
  "haha233jpg": {"lastSeenAt":83285446, "lastHostileAt":0, "rooms":["W39S53"]}}}
```
⇒ **冷存确在落盘**（`epoch=83403803` 就在当下几百拍内，R238 的"未落地"到此彻底作废），
**但两个已知玩家的 `lastHostileAt` 都是 0**。

**而这正是 #108 要的那个数**：今天房级 `lastHostileAt` 有三次落锤（83399840 / 83400220 / 83402214，
其中 83402215→83402225 那波在场 10 拍、编队 3 RANGED + 2 ATTACK），**可段 5 里没有任何一个玩家被记为敌对**。
⇒ 按人归因这条链**不是"写了没人读"**那么简单：**敌对那一列在源头就没被填**。

两个候选解释（**我不动码、不定罪**，取证判据写在 #108 里）：
①行凶者的 owner 从来不是 `playerEntries` 的键 ⇒ 活动信号只从"看到房里有他的 creep"这类通道 upsert，
  而 `intelligence.ts:80` 那条 `hostile=true` 分支的前置（遍历的是**已在册**的玩家还是**当拍威胁清单**）我没读到底；
②`hostile=true` 那条分支今天根本没进（例如它挂在别的相位/条件上）。
判别式只需一次读数：**下一次目击当拍/当窗，段 5 的 `players` 键集与对应 `lastHostileAt` 是否出现非零**
——看门狗本来就挂着 `hostileAt` 列，段 5 这条读数是免费的复证。

**这条对请示面的实际改动**：#108 原话是"情报齐、政策侧零接线"。**前半现在要降级**：
情报侧只有**活动**归因齐（谁在哪、何时见过），**敌对**归因恒 0 ⇒
"按行凶者计威胁记忆"这个修法目前**建不到数据上**，要么先修敌对那一列（小、可测），要么退回到
只按"在场时长/杀伤"给尾税分档（不需要按人数据）。**#92 的取舍因此少一条可行支路**，请与 #88 同表读。

边界：零 src、零 push、零 build、零 console；只读 API 两发（同一端点，逐段单请求）。
`intel-players.mjs` 的形状错**已定位但还没回改成 `body.data` 字符串读法** ⇒ 那条工具债仍在，别用它做判断。

### 巡检 R122（10-03 15:4xZ，不占 R 号）**幼房那波建设的钱已经停了，而两台仪器还在负 ⇒ 对端 R237 的复看判据此刻不可裁**；Σ 首次整台为负（−1.274），回绿代价按常数算成三档（+6/拍≈10.7 小时／+20/拍≈1.9 小时／**≤+5/拍 无限等**）；无 ROI 闸的采购通道一小时后仍未花钱（价格上限在挡）；#61 第十一发 1:1 且与"里程碑压自己的闸"合成一条

· **建设停了，仪器还在负（这是对端 R237 #18 的下半场）**：幼房 `economy.t=83403768` 的 `bk={harvested:1000, upgraded:400, repaired:304}` ⇒ **`built` 缺席 = 本 50 拍窗建造支出 0**，物理单窗 ≈ **+5.9/拍**；而 `nf=−12.57/拍`、慢 EMA `W38S56=−3.086`。不是仪器说谎，是它们的 τ 本来如此（快 ≈165 拍、慢 ≈5,000 拍）。⇒ **"工地清空后 Σ 是否回正"不能现在裁。**
  **可检验版（R123 直接核）**：①若 `built` 继续缺席，**≈450 拍后（≈tick 83404220）幼房 `nf` 应回到 ≥0**；若届时 `nf<−5` 而 `built` 仍缺席 ⇒ **负值另有来源**，要回头查幼房 `exported`/跨房交付那一侧。②慢 EMA 在 ≈1,750 拍内不会自正 ⇒ **"Σ 还负 = 还在烧"这种读法一律作废**。
· **Σ 首次整台为负 + 回绿算术**：`gateNetFlow={1.812, −3.086}` ⇒ **Σ=−1.274**（全天最低此前是 +0.057@83395479），G3 从 15:2xZ 起与 G4 同红（对端已指认同因：RCL5@83400802 同拍落 6 extension + 2 link ⇒ built ≈21.7/拍 ⇒ 快 EMA −20.3/拍）。按 `accounting.ts:317`、α=0.02/100 拍从 −1.274 抬到 ≥5：输入 **+6/拍 ⇒ ≈9,940 拍（10.7 小时，且只是刚刚够）**；**+20/拍 ⇒ ≈1,750 拍（1.9 小时）**；**≤+5/拍 ⇒ 渐近线在门槛上或以下，永远够不到**。⇒ #88 的措辞改用这一句：**"绿不了"的时长几乎完全由输入超出 5 多少决定**；我不动门槛。
· **无 ROI 闸的采购通道现状**：`buyTried=0`、`buyOk=0`、`buyBestAsk=0`、**`buyNoMatch=4`**、`buyGatePrice=370`、`demandTop=GH2O:115/p20/lab-reaction`。写者语义（`trade-ledger.ts:67`）= "有需求但在价格门禁下找不到任何一张卖单" ⇒ **没花钱是被 ≤370/单位 的价格上限挡住，不是需求消失** ⇒ 我 R121 那条"只有 `reason=factory-commodity` 才代表 ROI 过了"不变，但今天可以补一句：**这条不过 ROI 的路目前被价格护栏有效约束着**。未验问题留人/对端：370 对反应输入是否合理（`computeDynamicBuyPrice` 只含均价+premium 再夹 `fallbackMaxBuyPrice`，**不含产出价值**；我没有行情读数，不据 370 判贵贱）。
· **#61 第十一发 1:1，并与上一条合成**：幼房 `spawnRejects` 差分 `reserveOnly +145 / degradeGateClosed +146 / budget +0` ⇒ **+146=+145+0 逐位相等**；窗口 ≈1,830 拍 ⇒ **≈0.08 次/拍（每 12 拍 1 次被"只有预留"挡住）**，与上一窗 0.102 同量级。⇒ 同一笔能量预算两头收税：**建设期支出把净流压红（G3+G4）＋孵化预留掐掉同一波的补员**，而本窗 `budget` 增量 0、`ea=1450/1450` 满 ⇒ **现在挡人的只有预留，不是能量真的不够**。#61 的账请按两栏读；我没有改任何预留语义或阈值。
· **我自己的错当场记**：R121 把退出拍 **83407214 换算成"≈16:0xZ"是错的**。标定取自对端看门狗日志（零探针）：round11 `83402584@14:29:44Z` → round18 `83403684@15:41:20Z` ⇒ **1,100 拍 / 4,296 秒 = 3.905 秒/拍** ⇒ 还剩 ≈3,530 拍 ⇒ **≈3.8 小时 ⇒ ≈19:3xZ**。这是"拍→墙钟心算"这一类今夜第 5 次：**凡写时刻，必须用当轮实测拍长乘出来，不许估**。
· war 现场（对端日志代取）：`posture=war`、`hostileAt=[83402214, 83399840]`、`newSighting=no` 连续 8 发 ⇒ 间隔累计 ≈1,550 拍（<5,000 仍冻），无目击则退出 ≈83407214；`pressure=[0,0]` 恒 0 ⇒ 与 R181 那型状态伪影无关。`Blocked=G0+G3+G4+G6`。批状态 `behind=0 / ahead=124` ⇒ **无人推码**，#102/#99/#96/#105/#93/#94 仍未部署（A/B/C 仍等你）。
· **另一条探针纪律（从对端 R239 收回来的同族坑）**：一次请求带多个 `segment=` 会让每段退化成 1 字符桩 ⇒ **断言"某个存储为空"之前，必须用同一工具、同一请求形状先读通一个已知非空的邻居样本**。我本轮的 `deathByCause 不存在`、`byRole 不存在` 这类读数都按这条重验过（是"未部署/该房从未建过"，不是"空即没有"）。
· **边界**：零 src、零 push、零 build、零 console；探针 peek×2 + 一次 grep（observe 的对端字段我从 `posture-exit2` 日志代取，省一次 API 也避开 429/竞争）。**R123**：①`built` 是否仍缺席 + 幼房 `nf` 是否回 ≥0；②`buyTried>0` 才谈花费；③#61 三键差分（1:1 破了立刻报）；④war 退出时刻按实测拍长换算。

## R242 · 2026-10-03 15:5xZ（#108 的根因读到底：**按人敌意那一列对 NPC/Invader 按构造永远是 0** ⇒ 尾税是为 NPC 打的，而"按行凶者计"没有可挂的键）

**读到的机制**（`intelligence.ts`，全部现读不靠记忆）：
- `adoptPassiveThreats(ctx)` **确实在跑**（`run()` 里 `:177`，与 `adoptHandoff` 同批）；
  它对自有房的 `snapshot.threatCreeps` 逐只取 `creep.owner?.username`，
  **`if (!owner || owner === INVADER_USERNAME) continue;`**（`:79`）⇒ **Invader（NPC）与无 owner 的形态被有意跳过**，
  剩下的真玩家一律 `hostile=true` 落 `lastHostileAt`。
- `INVADER_USERNAME = "Invader"`（`domain/intel.ts:11`）。
- 另一条 upsert 路径（`adoptHandoff`，`:62-68`）传的是 `isBlacklistedRoom(...)` —— 即**只有该房在战争黑名单里**才记敌对。

**和现场读数对起来只有一个自洽解释**：段 5 里两个在册玩家 `lastHostileAt` 都是 0，
而今天房级落了三次武装目击（83399840 / 83400220 / 83402214，其中一波在场 10 拍、3 RANGED + 2 ATTACK）
⇒ **这些目击的 owner 不是"玩家"就是"无 owner"**（NPC/Invader 或被跳过的那一类）
—— 也就是说：**挡着扩张的 war 尾税，是为按构造不进玩家域的那类单位打的。**

**这条把 #108/#92 的支路筛掉了最被看好的那条**：
- ❌ **"让威胁记忆按行凶者计"目前不可行** —— 不是数据没写，是**这类行凶者根本没有可挂的键**
  （`Invader` 被有意排除，且排除是对的：把它当成一个"玩家"去记，会把所有 NPC 汇成一个假人）。
- ✅ **剩下唯一不需要按人数据的支路：按在场时长/杀伤给尾税分档**
  （`EnemyInvasion → EnemyCleared` 这对边沿事件已经在给在场拍数，R234 实测 10 拍；杀伤可由 `deathByCause.combat` 给，等 #96 上线）。
  ⇒ **给 #92 的最终口径**：修法只剩"按强度分档"这一族，"按人降税"这条要先解决**键的存在性**而不是消费者的接线。

**两条不许外推**：①这不是 bug —— 跳过 Invader 是 `intel.ts:11` 处的显式设计，我不动它；
②"目击都是 NPC"目前只有**一次一致性推理**（读数与机制互洽）+ **一发消息（10 拍那波）的编队证据**，
**没有** owner 级直接读数 ⇒ 定罪成"今天全是 NPC 打的"还不够，写成**强假设**、留免费复证：
下次目击当窗读段 5 是否出现第三个键或非零 `lastHostileAt`（出现 ⇒ 真玩家也打过，本推论降级）。

**工具债状态（诚实交代，别当成已修好）**：`intel-players.mjs` 我这轮改到
`body.data` 字符串读法后**仍没跑通**（`PRESENT 191 字符` 却 `FAIL: incorrect header check`
⇒ 它还在往 gunzip 分支走，说明这个文件里的解包顺序/残留与我手工那发不一致）。
**可用路径是我手工那一发**：单段请求 `?segment=5&shard=…`、`X-Token`、`typeof body.data === "string"` 时直接 `JSON.parse(body.data)`。
⇒ 规矩照旧：**这条读数器不进判据链**，段 5 的读数一律用手工那一发的形状。

边界：零 src、零 push、零 build、零 console。

## R243 · 2026-10-03 15:5xZ（工具债清掉：`intel-players.mjs` 三态验证通过 ⇒ 段 5 读数**可以进判据链**了）

**两个自造的错**（都不是服务器状态）：
①**多余的解包块**：`JSON.parse(content)` 已经成功之后，代码还**无条件**再跑一次
`zlib.gunzipSync(Buffer.from(content.slice(3),"base64"))` ⇒ 拿"已解出的对象"去 gunzip 必抛
`incorrect header check` ⇒ 工具把自己的**成功**读数打印成"解码异常"。删掉该块（载荷已证是裸 JSON）。
②**暂时性死区**：我把 `const SEG` 放在 `fetch` **之后**，而 URL 模板里已经用它 ⇒ `ReferenceError: Cannot access 'SEG' before initialization`
⇒ 整个工具跑不起来。把声明提到 `fetch` 之前。

**三态验证（这是关键，之前缺的就是它）**——同一份代码路径、同一个请求形状：
| 用例 | 输出 | 含义 |
|---|---|---|
| 段 5（目标） | `PRESENT 191 字符`、`topKeys=epoch,players`、`epoch=83403803 players 键数=2` | 玩家域冷存在落盘 |
| 段 2（**阳性对照**，已知非空） | `PRESENT 22,486 字符`、`topKeys=events` | 证明这条路径**能取出内容**，EMPTY 不是因为读不出 |
| 段 7（阴性对照，未使用） | `EMPTY: 段 7 未落盘` | 证明它**不会**把有数据的段报成空 |

⇒ **"EMPTY"这个输出从这一刻起才有语义**。反过来说：R238 那次 EMPTY 之所以是假阴性，正是因为
当时**既没有阳性对照也没有阴性对照**——只有我一个人信了它。这条已经补进记忆。

**残留的一个已知小错（不许当已修好）**：逐玩家的打印行显示 `Aguia: rooms=1 lastAt=?` ——
它的字段名与真实记录不符（真字段是 `lastSeenAt` / `lastHostileAt`，见 R241 的原始 JSON 读数）。
⇒ **段 5 的存在性/键数/epoch 可以信这个工具；`lastAt` 那一列要读原始 JSON，别读这行打印。**

**由此解锁的复证**（R242 留的那条）：下次房级 `lastHostileAt` 落锤后的下一个老化批窗口跑
`node tmp/tools/official/intel-players.mjs 5` ⇒ 若 `players 键数` 变 3 或某玩家的 `lastHostileAt`（用原始 JSON 看）非零，
则"今天的武装目击都来自被有意跳过的 NPC/Invader 类"这个强假设**降级**；保持 2 且全零 ⇒ **升级**为已证。
这条不花部署、不造条件，是免费复证。

边界：零 src、零 push、零 build、零 console；改动只在 `tmp/`（未跟踪）+ 文档。

## R244 · 2026-10-03 15:5xZ（收车：今天的**当前真相表** + 在飞判定与交付物的位置，只追加不涂改）

### A. 今天被推翻的旧断言（派生量勘误表——引这些数字前先看这张表）
| 曾被写成 | 现状 | 更正处 |
|---|---|---|
| `G0` 是 RCL 项，"升到 RCL5 会消掉 G0 假项" | ❌ 作废。`readiness.ts:151-158`：G0 = `posture.expansionAllowed` 一个布尔；RCL 走 G3/G5 | R232 |
| war 尾税 ≈110 倍（在场 ≤45 拍 vs 5,000 拍） | ⚠️ 改 **500 倍**（实测在场**恰好 10 拍**：`EnemyInvasion 83402215 → EnemyCleared 83402225`） | R234 |
| 退出锚 tick **83405220** | ❌ 作废。新目击 ⇒ 现算锚 **`max(rooms[].lastHostileAt)+5000` = 83407214**（每次新目击整段重置） | R231/R234 |
| 合同 `td=0` ⇒ 跨房供给从未运行 | ❌ 作废。写回链零写者 ⇒ 台账是创建时刻化石；物理面交付了 **5 万量级** | R231/#106 |
| 判据"看合同 `td`/`li` 涨没涨" | ❌ 作废，改判物理配对（`energyLedger.*.imported/exported`） | R231 |
| `exported == imported` 是恒等式 | ❌ 不是。`imported` 含远矿流入、`exported` 只记自家流出 ⇒ 那 8,679 差额**不是漏账** | R231/§3 |
| "boost 链没接线（`boostCreep` 只在注释里）" | ❌ 是我 grep 形状太松；调用在 `lab-system.ts:585` | R236 |
| "段 5 为空 ⇒ 按人敌意记忆不跨部署"（#109） | ❌ 读数器路径错造成的假阴性；**段 5 在落盘（191 字符裸 JSON）** | R239/R241/R243 |

### B. 当下为真、且会影响决策的几条
1. **扩张今天的阻塞 = war 尾税 + G6**，两半都不是 RCL。`Blocked=G0+G3+G4+G6`，G3/G4 是**同一个读数两次投影**。
2. **帝国慢 EMA Σ 已落负**（核心 +1.384 / 幼房 −2.318）；根因可指认：**RCL5 于 83400802 命中 ⇒ 同拍落 6 extension + 2 link 工地 ⇒ 幼房 `built 1084/50拍 ≈ 21.7/拍 ⇒ 快 EMA −20.3/拍`** ⇒ "里程碑自己压自己的闸"。**#88 的代价现在是"幼房在建工地"，不是抽象阈值**；放宽它这拍＝净消耗时授权扩张。回归判据：工地清空后 Σ 是否回正。
3. **G6**：门槛定值 12.00/拍，现读 ~14.5/拍；唯一杠杆 `maxOperations` 点名省 ≈2.43 ⇒ 缺口刚好覆盖，代价 19.9/拍远矿能量 + 120 段路 + 翻档需 300 拍驻留（≈19 分钟）。**属人。**
4. **竞争面三件事叠加**：无进攻选靶链（#100，`deriveOperationType` 只产 DEFEND/ESCORT/RETREAT）；敌我政策零消费者（#108）；且 **NPC/Invader 类行凶者按构造不进玩家域**（`intelligence.ts:79` 显式跳过）⇒ #108 最被看好的"按行凶者计"目前**无键可挂**，#92 只剩"按在场时长/杀伤分档"一族。
5. **仪表与代码的真相分层**：`WIRED`（`src/` 有调用者）≠ `EXERCISED`（线上跑过）≠ `TESTED`（有单测）。domain 层 **33/225 个模块零生产导入者**（#107），合同写回链是其中已定案的一条（#106）。

### C. 在飞判定的状态（都挂在**已有**仪器上，不需要我造条件）
| 判据 | 到点/条件 | 读法 | 状态 |
|---|---|---|---|
| **P-A / P-B**（`expansionAllowed` 是否翻 true / `Blocked` 是否收到只剩 G6） | 现算锚 **83407214** ≈18:3xZ（拍长今标 3.06 秒） | `tail -1 tmp/observe/posture-exit2.log`，**按该行 hostileAt 现算锚**，别引字面值 | 挂表中（pid 存活，round 19/45，覆盖到新锚） |
| **#108 的 NPC 强假设升降级** | 下次房级目击后的老化批窗口 | `node tmp/tools/official/intel-players.mjs 5` 看 `players 键数`；字段值要读原始 JSON（工具的逐玩家打印行字段名仍错） | 工具已三态验证（段2 阳性 / 段7 阴性）⇒ **可进判据链** |
| **#96 三桶上线后的战损口径** | 随批部署后首个 boot 段 | `Memory.kernel.stats.deathByCause = {natural, combat, recycled}`；**`recycled` 不算战损** | 未部署，读数尚不可得 |

### D. 交付物与未推的东西（交接位置）
- 今天提交（全部 docs/instrument）：`7f07572 7067214 028c192 63e2484 6e50b32 680ee6e 5725549 4e75cda 83be47a 2dc14c9 30be47c 0830c07 702b28d`。
  其中**唯一含 src 的是 `63e2484`**（#96 三桶，tsc 干净 + 14/14 + 反向实验恰好 2 红/12 绿）。
- 未推批：**ahead 121、behind 0**；线上 `ea4c69da6f8b` ≠ 本地 dist `18cb6e03e233` ⇒ #102/#99/#96/#105/#93/#94 **全部未部署**。
  **A 全推 / B 只推仪表与注释（须同时排除 `1bc67c9` #89 与 `58b1efa` #102）/ C 不推** —— 等你。
- 文档面：`CAPABILITY-MATRIX.md` 已覆盖 §1–§18（#97 的逐条清单本体收口）；`tmp/observe/AGENT.lock` 记到 #32；
  `tmp/tools/official/` 新增 `rev-99.sh`、`posture-exit-watch2.sh`、修好的 `intel-players.mjs`（`tmp/` 未跟踪，不会随推上库）。
- 今天全程 **零 console、零 push、零 build**；对端的 `.gitignore` 与未跟踪的 L0 文档我没有动、没有 stage。

### E. 一句话审计
**目标未达成**：长期自主"生存/发展"今天有实证（两房在跑、工业线在爬、全量 e2e 首次 34/34 绿），
但"扩张"仍被 war 尾 + CPU 钉着、"竞争"缺进攻与政策面、"恢复"仍有无键可执行的一类（#103），
且**部署环节这一周卡在我无权做的"推"上**。不调 `UpdateGoal`。

### 巡检 R123（10-03 16:4xZ，不占 R 号）**把 Σ 的爬升速率反解成输入，得到今天对 #88 最硬的一句：现场有效输入 I≈+2.45/拍 < 门槛 5 ⇒ G4 现在不是"慢"，是"照这个收支永远够不到"**；R122 那条仪器滞后预约兑现（幼房 `nf` −12.57→**+7.98**）；我自己那句"1:1"说过头了（**结构只承诺 ⊆，这一窗等号破 2**）；#61 反向：**这窗预留一次都没挡，挡的是真实预算**

· **R122 可检验式判定**：`rooms.W38S56.economy.nf=+7.98/拍`（R122 为 −12.57；Δ1,018 拍；预约点 ≈83404220 之后 ~500 拍判，方向与量级都在模型内）⇒ **PASS**；"nf 仍 <−5 则另找来源"那支**没触发**。但前提改了一半：当窗 `bk` 里 **`built:438` 又回来了**（8.76/拍，对 RCL5 那拍的 21.7/拍是降一档）⇒ 准确说法是"**工地没清空、只是回落，而快仪仍转正**"。⇒ 对端 R237 的复看判据（"工地清空后 Σ 是否回正"）要按此改写：**快仪已正、慢仪 `−2.712` 仍在滞后，两者同时为真** ⇒ "慢仪还负"读不成"还在烧"。
· **反解输入 ⇒ #88 的核心数**：`gateNetFlow={2.068, −2.712}` ⇒ **Σ=−0.644**，对 R122 的 −1.274 ⇒ **ΔΣ=+0.630/1,018 拍 = 0.0619/次更新**；按写者算式 `Σ'=Σ+α(I−Σ)`（α=0.02、`interval:100`）⇒ **I = Σ + 0.0619/0.02 = −0.644 + 3.10 ≈ +2.45/拍**。⇒ **I < 门槛 5 ⇒ Σ 的渐近线就在 2.45 ⇒ 等多久都到不了 5**（这比 R122 的"9,940 拍"更本质：那条假定 I≈+6）。交叉核对：两房的 Δ 方向都与各自 I−Σ 同号；⚠️I=+2.45 是两房**加权等效值**，不与单房 `nf` 对表。
· **把"停卖"这一支算完**（我 §里先只给了符号，补算如下）：I_new = 2.45 + 3.98 = **6.43** ⇒ 从 −0.644 到 5 需 `n≈80 次更新 ≈7,990 拍` ⇒ 拍长 2.65~4.58 秒 ⇒ **≈5.9~10.2 小时**，且前提是 I 一路守住 6.43（实测两小时内 I 走过 +14 → −9 → +2.45）。⇒ **#88 完整摆法：现状 I≈2.45 ⇒ 永远绿不了；停卖 ⇒ I≈6.43 ⇒ ≈8 千拍后勉强够到；两条都不需要动门槛。**
· **#61 两处自我收紧**：差分 `budget +51 / reserveOnly +0 / degradeGateClosed +49` ⇒ **⊆ 成立（49≤51），等号破 2**；码注 `spawn-manager.ts:356-366` 本来就只承诺 `degradeGateClosed ⊆ (budget ∪ reserveOnly)` ⇒ **我前十一轮写的"1:1"是把历史巧合说成结构**，以后只报 ⊆ 与两侧增量。实质：**这窗 `reserveOnly` 增量为 0 ⇒ 挡幼房补员的是真实预算不足**（`built 438/50拍`、capacity 涨到 **1750**、`ea` 满），而 R120/R122 两窗预留是唯一挡手（+145/+482）⇒ **"预留什么时候掐人"取决于该房此刻是真缺能量还是只被扣一档**；我没动语义与阈值。
· **两条通道**：无 ROI 闸的采购路 `buyTried/buyOk/buyNoMatch/publishedAt` **四个读数一字未动**（≈3,000 拍跨度）⇒ 形状是"发布一次 → 按 ≤370/单位 匹配 4 次全空 → 之后不再动作"，**既没花钱也不是每拍重试**（任务 #8 判据仍是 `buyTried>0`）。卖能量在**加密**：`sold +30 单`、`tradeFee +21,965 ⇒ 3.98/拍`、费率 73.2%、`runs 76→89` ⇒ **≈1 单/200 拍**（此前 ≈1/600）⇒ 收益侧坐实 4/拍。`credits +737,391/2,990 拍 ≈246/拍`（六发最高）⇒ **确定不是能量卖单**（30 单至多 ≈90 信用），也非买料（`buyOk=0`），来源仍未证到写者。
· **war（按对端纪律现算锚，不引字面）**：round24 `83404584@16:42:36Z`，`newSighting=no` 连续 13 发 ⇒ 间隔累计 ≈2,500 拍（<5,000 仍冻）；锚 = `max(lastHostileAt)+5000 = 83407214`，剩 2,630 拍 ⇒ 拍长三发标定 **2.65 / 4.08 / 4.58 秒** ⇒ **时刻只写带：≈18:3xZ–19:4xZ**（对端 C 表 18:3xZ 与我 R122 的 19:3xZ 都在带内，谁都别当闹钟）。批状态 `behind=0 / ahead=129` ⇒ 无人推码，A/B/C 仍等。
· **边界**：零 src、零 push、零 build、零 console；探针 observe×1 + peek×1 + 码 grep×2；看门狗字段全部从 `posture-exit2.log` 代取（零 API）。**R124**：①Σ 是否仍按 ≈+0.6/1,000 拍爬（I 若上 5，爬升会自己加速 = 免费仪表）；②`buyTried>0`；③#61 只报 ⊆ 与增量；④war 到点看 `expansionAllowed`/`Blocked` 是否只剩 `G6`（与对端 P-A/P-B 同一发数据，不抢它判据）。§3.5 属人 7 项未动。

### 巡检 R124（10-03 17:4xZ，不占 R 号）**#88 的最终措辞：今天全天 Σ 序列均值只有 ≈+3.2、峰 7.19、谷 −1.96 ⇒ 门槛 5 高于均值、低于峰值 ⇒ "绿"必然只是波；要常绿得把均值抬过 5，而"停卖 +4/拍"恰好是抬均值的量级**。另：活锚已移 **83409813** 而 `posture-exit-watch2` 的 `EXIT_TICK` 不会自己重算（会在 83405820 后喊 EXIT-LATE，那是锚移不是预测失败）；R181 那型拿到**第二次独立复证**（这发红的是 **G1+G2**）；#61 拿到最硬的一发算术：**body 1,400 vs energyAvailable 1,405 ⇒ 能量够，拒它的是预留**

· **先撤我自己本轮中途的错判**：我看到 rounds 28-30 打 `newSighting=no` 而同列 `hostileAt` 第二槽已经从 83399840 变成 83404813，**当场怀疑判据器漏报**。读完脚本 + `grep -n "round=2[5-7]"` 才看到 **round25（16:52:51Z）明确打了 `newSighting=no W38S56:83404813`** ⇒ 工具行为正确、我的"漏报"作废。**教训复用**：`tail -N` 上的任何"没出现"都是下界，要判某列变没变必须全量 grep 那一列（这是我记过的同一族的又一次，代价是一次误判冲动而零读数成本——当场撤回比留下假案便宜）。
· **锚移与脚本的字面值**：活锚 = `max(83402214, 83404813) + 5000 = **83409813**`（第 6 次目击，幼房 17:0xZ）。而 `posture-exit-watch2.sh:27 EXIT_TICK="${EXIT_TICK:-83405220}"` ⇒ 脚本头第 19 行要求"ANCHOR-MOVED 就重算 EXIT_TICK"，但代码里只重算了 `BASE_*` ⇒ **约 83405820 之后会打 `EXIT-LATE`，那是锚移的正常后果**。⇒ 处置（我不改运行中的脚本）：重启带 `EXIT_TICK=83409813`，或在 `NEWH != no` 那支里 `EXIT_TICK = max(H1,H2)+5000`；读表的人一律按 `hostileAt` 现算（对端 D 表本来也这么要求，只是脚本自己引了字面）。**#90 账再涨**：6 次目击、间隔 380/1,995/≈2,600 拍，全部 <5,000 ⇒ `threatRecent` 自 83397159 从未清零。
· **R181 型第二发**：`round26 tick=83404884 Blocked=G0+**G1+G2**+G3+G4+G6`，同发 `pressure=[0,0]`，round25/27 都回到 `G0+G3+G4+G6` ⇒ 一次仪表盘写内出现、下一写消失。机制比 R113 更直接：**G1=`hasLiveThreat`（真敌在视线）与 G2=defense 归 struggling 同源自同一次"敌在场"**，而两房 `economyPressure` 都是 0 ⇒ 那两格红与经济无关。⇒ 口径保留：**目击当窗与其后 ≤1 个仪表盘写周期内的 G1/G2/G3/G5 不作经济证据**，判 G3/G5 顺手读 `colonyStateSince`/`lastHostileAt`。
· **Σ 全天序列 + #88 最终措辞**（同一台慢 EMA，两房求和）：`5.46 → 7.19 → 5.64 → 6.21 → 4.24 → 0.06 → 5.21 → 5.85 → 2.05 → −1.27 → −0.64 → −1.96` ⇒ **均值 ≈+3.2、峰 7.19、谷 −1.96**。本轮 Σ=**−1.955**（`{0.0613, −2.0167}`），ΔΣ=−1.311/≈955 拍 ⇒ 反解 α=0.02 得**窗口均值 I≈−8/拍**。⇒ 于是 R123 那句"I≈+2.45"和 R122 那句"9,940 拍回绿"都收进这一条：**Σ 自己就是积分器，它的长期均值≈输入的长期均值 ≈+3/拍**；门槛 5 **高于均值、低于峰值** ⇒ ①"绿"必然只是波（今天已 4 次 ≥5）；②**要常绿得抬均值而不是等一波**；③"停卖"抬的是均值（+4/拍 ⇒ 3.2→约 7.2 > 5）⇒ **这才是量级对得上的一条出路**。⚠️全部是陈述，我没动门槛、没停任何通道。同拍幼房 `nf=+6.72` 与核心房慢 EMA 0.061 同框 ⇒ 帝国没有单一控制点，"某房在烧"必须带房号与仪器层级。
· **#61 最硬的一发算术**：差分 `budget +14 / reserveOnly +49 / degradeGateClosed +62` ⇒ **⊆ 成立且首次有余量**（62 ≤ 63）；三窗记录 `(0,+145,+146)` / `(+51,0,+49)` / `(+14,+49,+62)` ⇒ **挡手种类在两栏间来回摆**（所以"预留掐人"是 regime-dependent，不是恒常）。**可点名**：当窗队列里 `distributor:W38S56:1` 的 body=8×carry+4×move ⇒ **成本 1,400**，而 `energyAvailable=1405 ≥ 1,400` ⇒ **能量本身够，拒它的是"预算先扣预留"那一步**（`recoveryEnergyReserve=200` ⇒ 可用 ≈1,205）。⚠️本拍 `cr/rb` 被 peek 截断没读到 ⇒ **是哪一条武装条件在起作用仍未证**，不许写成条件 2；我也没动 `recoveryEnergyReserve`、阈值或预留语义。
· **其余**：采购路第 4 次读数仍 `buyTried=0 / buyOk=0 / buyNoMatch=4 / publishedAt=83402318`（≈5,500 拍既没花钱也没再发布）；`credits 13,855,622` ⇒ 六发差分序列 `235k/128k/161k/88k/737k/165k`（每千拍）⇒ **方差大到不能报速率**，来源仍未证到写者；幼房 `ec 1450→1800`、人口 14、`ops 1/1`、`road=5`；核心房 `netFlowMean_d=−91.5` 是观测器 `reserveDelta` 口径（**不是净流**）。
· **边界**：零 src、零 push、零 build、零 console；探针 observe×1 + peek×2 + 脚本读×2；看门狗字段全部从 `posture-exit2.log` 代取（零 API）。**R125**：①war 是否 ≈83409813 退（预期 watch2 先喊一次 EXIT-LATE）；②Σ 回到 ≥3 还是继续 <0（直接检验"抬均值"这条）；③`buyTried>0`；④#61 三栏差分 + 把当窗 `cr/rb` 读到。§3.5 属人 7 项未动。

## R245 · 2026-10-03 17:5xZ（锚第三次被推走 ⇒ 尾税"永不清零"已有三个数据点；并续接了看门狗 + #88 的回归读数到手一半）

### ① 尾税锚第三次重置：#92 的"脉冲骚扰可让 war 尾永不结束"现在有 **3 个数据点**
`posture-exit2.log` round 25（16:52:51Z）`hostileAt=[83402214,83404813]` ⇒ 幼房 W38S56 落了新敌意锚。
今晚三个锚：`83400220 → 83402214 → 83404813`，**相邻间隔 2,000 / 2,599 拍，两段都 < `threatWindow=5,000`**
⇒ 每次落锤都把整段 5,000 拍税**归零重计**，前一次已经付掉的税直接作废。
现行退出预测：**`max(83402214,83404813) + 5000 = 83409813`**；拍长用本轮实测标定
（round 19 @15:51:30Z tick 83403784 → round 30 @17:43:50Z tick 83405584 ⇒ 1,800 拍 / 6,740 秒 = **3.744 秒/拍**）
⇒ 距 83405584 还差 4,229 拍 ≈ **4.4 小时 ≈ 22:1xZ**（±30%；写时刻一律按实测拍长乘，不许心算）。
旁证：round 26（17:03Z）`Blocked` 多出 **G1+G2**（活威胁 + 困难房）⇒ 与幼房那次目击同相位，目击在场约 70 拍。

### ② 看门狗续接（不编辑运行中的脚本）
watch2 只剩 15 轮 × ≈161 拍 ≈2,415 拍 ⇒ 覆盖到 ≈83408,000，**比新锚短约 1,800 拍**。
新建 `tmp/tools/official/posture-exit-watch3.sh`（pid 55858，日志 `tmp/observe/posture-exit3.log`，ROUNDS=40 ≈6,400 拍 ⇒ 覆盖到 ≈83416,000），三处修正：
- **锚每轮现算并打印** `anchor=…（=max+5000）`，读数的人不必再自己加，也不会引到旧字面值；新目击时额外打 `ANCHOR-MOVED`。
- ⚠️**纠正我对自己工具的一句错话**：我起初以为 watch2 的 `newSighting` **漏检**了这一发 —— 读代码才发现
  它**检出了**（同 imprimis 那行末尾就印着 `W38S56:83404813`），只是标签写法是 `newSighting=no W38S56:83404813`
  （第二支路把还没前缀过的 `"no"` 直接拼在后面）⇒ **检测对、标签误导**。
  按"自己写的工具字段坏了要先证伪再声明作废"的规矩：这里作废的是**我的读法**，不是那条判据。watch3 改成 `none` / `W38S56:…`。
- 独立日志文件，两支不交错写同一个文件。
干跑验证通过（单轮、GAP=1）：`round=1 tick=83405684 posture=war … newSighting=none anchor=83409813（=max+5000）`。

### ③ #88 的回归判据到手一半 —— **拖拽换了身份，从"在建工地"变成"孵化脉冲"**
15:3xZ 那次读数（R237）：幼房快 EMA `nf=-2027`（**−20.3/拍**）、`built=1084/50拍`（≈21.7/拍）、6 个 extension 工地；Σ≈−0.93。
本轮（tick 83405668）：**extension 工地全部消失**（`buildQueue` 只剩 2 个 link `state:site`），
幼房快 EMA 收到 `nf=-352`（**−3.5/拍**）⇒ **R231/R237 预测的那一支命中了：建设期支出撤掉，幼房净流立刻回收。**
**但帝国 Σ 反而更负**：`gateNetFlow={W37S58:+0.4197, W38S56:−1.8419}` ⇒ **Σ=−1.42**（dashboard `netFlow=-1.4`，G3/G4 同红）。两件事都要解释：
- **幼房慢 EMA 的 τ≈5,000 拍** ⇒ 快仪已经回到 −3.5，慢仪还挂着 −1.84 的滞后（这是仪器常数，不是新支出）；
- **核心房慢 EMA 从 +1.384 掉到 +0.42**，而它当窗 `bk={harvested:980, imported:440 | repaired:110, exported:1200}`（窗内 +110）
  且快 EMA `nf=+13.25/拍` ⇒ 核心房此刻**不欠钱**；掉的是**过去那一段**（建设期 + 卖能量运费）在慢仪里的记忆。
- **幼房当窗的真实新支出是孵化**：`bk.spawned=2500`（50 拍窗 ⇒ **50/拍**，是 G4 门槛 5 的 **10 倍**），
  同期 `upgraded=750`、`built=300`、`imported=1200`（核心房同窗 `exported=1200` ⇒ **成对入账第三次现场再见**，`07d0be4` 继续在工作）。
⇒ **#88 的原措辞（"G4 门槛 5 与孵化脉冲同量级"）重新成为在场的那条拖拽**，而"基建消费"那半已经按预测消退。
⇒ 回归判据现在可以更新成可裁决的形式：**看 Σ 回到 ≥0 需要幼房的孵化波退潮 + 幼房慢 EMA 走完一个 τ**，
而不是"工地清空就该回正"。我不动门槛。
物理面参照（不作决策输入、只作对照）：核心房 `cr=885,745`（1M 容量、未到 near-full 阈），`pl` 首尾 +690 ⇒ 库存仍在缓慢累积，
而净流仪器读 −1.4 —— 这个背离是**已记录的设计后果**（`sold` 被刻意摘出净流 + 慢 τ），别当漏账追。

### ④ 批状态（推与否仍在你手上）
`git fetch` 后 **behind=0 / ahead=130**（我 R244 写的 129 已过时，对端又落了一笔）；
线上仍是 `ea4c69da6f8b`（783,330B）≠ 本地 dist `51e4768a…`（787,613B）⇒ **#102/#99/#96/#105/#93/#94 依旧全部未部署**，
今天全程零 console、零 push、零 build；对端 `.gitignore` 与未跟踪的 L0 文档我没碰。

边界：零 src；新增 `tmp/tools/official/posture-exit-watch3.sh` + 一条干跑日志（`tmp/` 不入库）。

## R246 · 2026-10-03 17:5xZ（#108 的 NPC 假设**升级成已证（对 70 拍那一发）**，同时挖出一条更硬的仪器限制：短于采样相位的入侵根本不进按人域）

### ① 免费复证到手（这条判据在 R241/R245 里挂着，现在关窗）
同一批发自两个独立面：
- 段 5：`epoch=83405703`（**比 83404813 那次目击晚 ≈900 拍 ⇒ 那次目击所在窗口至少被持久化过一轮**）、
  `players=2`、`len=191`、`Aguia lastHostileAt=0`、`haha233jpg lastHostileAt=0`。
- Memory：`rooms.W37S58.lastHostileAt=83402214`、`rooms.W38S56.lastHostileAt=83404813`、
  `kernel.stats.intelCoverage={rooms:7,players:2,tick:83405703}`（与 epoch 同拍 ⇒ 两套读数互相印证）。
⇒ **今天两次武装进犯都没能在按人域留下任何痕迹**，而按人那条链（`adoptPassiveThreats`，每 10 拍一次）在期间至少跑过一轮持久化。

### ② 关键区分：**"排除"与"采样漏"是两件事，我按在场时长把它们拆开裁**
`intelligenceSystem` 的节律是 `PARENT_INTERVAL = 10`（`intelligence.ts:41`）⇒ 威胁采样每 10 拍一次，
而 `adoptPassiveThreats` 的过滤是 `if (!owner || owner === INVADER_USERNAME) continue`（`:79`）。
- **W38S56 那发（83404813）**：round 26 的 `Blocked` 多出 G1（活威胁）与 round 25 相隔约 **70 拍** ⇒ 70 ≫ 10，
  采样**至少有 6 次机会**命中它，却仍然没有新键进 `players` ⇒ **只能用"owner 被排除"解释**：
  它是 Invader/NPC（或无 owner）类单位。**这一发按"已证"记**。
- **W37S58 那发（83402215，在场恰好 10 拍）**：10 拍 vs 10 拍节律 ⇒ **可能被相位错开而完全没被采样**。
  ⇒ 这一发**不判**，写成"两种解释都还活着"。

### ③ 由此挖出的那条更硬的结论（比 #108 原话更值钱）
**即使把按人政策的消费者全接上，≤10 拍的突袭也进不了按人域** —— 因为按人那条链本身是 10 拍采样的。
⇒ 任何"按行凶者降 war 尾税"的方案，对**今晚这种 10 拍就走的武装单位**都拿不到输入；
而尾税恰恰是按 `lastHostileAt + 5,000` 给的（R234/R245：**10 拍在场换 5,000 拍税 = 500 倍**）。
⇒ **#92 的分档不能建在按人域上**，只能建在**房级威胁记忆自己的属性**上（在场时长 / 是否造成损伤）。

### ④ 给 #92 的**决策就绪规格**（我不实现：它改的是 war 触发面，L0 §1.5 属人）
今晚已有的三发素材（全部来自现有仪器，零新增代码）：
| 目击 tick | 房 | 在场拍数 | 编队 | 造成的损伤 | 房级税 |
|---|---|---|---|---|---|
| 83400220 | W37S58 | 未量（环已滚走） | 未量 | `pressure=[0,0]` | 5,000（作废） |
| 83402215 | W37S58 | **10** | 1 只：3 RANGED + 2 ATTACK，0 heal | `pressure=[0,0]`、无战损 | 5,000（作废） |
| 83404813 | W38S56 | ≈70（G1 与下一次读数之间） | 未量（`newSighting` 只给时刻） | `pressure=[0,0]` | 5,000（现行） |

**可谈的分档维度（三条，都不动"被真围攻时的行为"）**：
1. **在场时长分档**：在场 < K 拍的目击只缴 K′ 拍税（K/K′ ≪ 5,000）；≥ K 拍或伴随损伤才走满 `threatWindow`。
   —— 时长可从 `EnemyInvasion→EnemyCleared` 边沿对直接取（R234 方法），**不需要按人数据**。
2. **损伤门**：用 #96 的 `deathByCause.combat`（已改三桶，回收不算战损）作"是否真挨打"的旁证；**未上线，读不到**。
3. **只读不写**：把 `intelPlayers`（段 5）当"真玩家敌意"的加严条件（有非零 `lastHostileAt` ⇒ 一律走满），
   当"NPC 骚扰"的放宽条件（无键 ⇒ 允许短税）。⚠️注意 ② 的采样相位限制会让 NPC 突袭也落到"无键"，这正是我们要的语义，但要写清它不是"确认是 NPC"。
**代价与方向必须一起交代**：任何放宽都会让"多个对手轮流低强度骚扰"更便宜地被打成"永不授权扩张"之外的另一种失败——
即**在真被打时更容易去殖民**。所以我给的不是推荐值，而是**维度 + 现有数据**，阈值留给你。
**我没有动 `threatWindow`、`warPatience`、`minDwell` 中的任何一个。**

### ⑤ 顺带一条边界
`Aguia` 的 rooms 记的是 **W38S58**（我流产的那次扩张的目标房，`lastSeenAt=82657950` ≈ 747,000 拍前），
`haha233jpg` 记的是 **W39S53** ⇒ 按人域里现在只有"很久以前在别的房见过"这两条，**与今晚的两次进犯无关**。
这轮之后 #108 的取证就闭合了：政策侧确实零消费者，而**输入侧对 NPC 类根本没有键**——两个缺口叠加，不是"接一下就好"。

边界：零 src、零 push、零 build、零 console；只读 API 两发（段 5 单段请求 + Memory peek）。

## R247 · 2026-10-03 18:0xZ（审计"恢复"这条动词：**能检测、能升级、能宣告不可行，但三条判定都不回流到自己的行为** ⇒ 立 #110）

矩阵 §10 之外的这条我一直没查到底：恢复子系统**判完不用**。逐条按"调用形状"grep（不是符号名），全部 `[我核]`：

1. **有一条阈值按构造不可达。** `evaluateRecoveryUnviability`（`recovery-lifecycle.ts:626`）要求
   `totalInvested > 5000 && totalRecoveryTime > 5000`，但**全仓没有任何"恢复投入能量"的测量者/累加者**——
   `invested` 在整条恢复链里只有 4 处：接口字段 `:590`、阈值 `:626`、reason 文案 `:629`、
   以及唯一调用方传的**字面量 `totalInvested: 0`**（`recovery-execution-system.ts:1072`）⇒ `0 > 5000` 恒假。
   顺带一条注释与实现不一致：文档写"累计投入 > 5000 能量**且无改善**"，代码里**没有"无改善"这条**。
2. **另一条阈值实际够不到。** `totalAttempts` 取自 **heap 决策表**（每次部署归零）；现场台账 `attempts` 只有 2 和 3，
   而同一动作已经 `repeats=5` ⇒ 计数每 boot 从头再来，">10 次"这条基本不会命中（与记忆里"时长型判据的计时器住 heap"那一族同源）。
3. **判定只落日志。** `if (unviability.unviable) log.info("recovery: UNVIABLE …")` —— 不写状态、不抑制后续、不持久化；
   那句 `recommendation`（"abandon recovery for room:domain — mark as permanently degraded"）**没有任何消费者**。
4. **台账零读者。** `Memory.kernel.escalations` 唯一写者是 `:1042/:1050`；`src/` 里没有任何地方读它
   （唯一提到它的 `tmp/tools/official/batch2-gate-and-push.sh` 是我离线用的推送门，不是 bot）⇒ 与 #106 同族的"写了没人看"，
   但这条更疼：它记的正是"哪项恢复反复失败"。

**为什么这不是学术问题（现场代价，非假想）**：
`kernel.escalations = [{W38S56, colony, population_rebuild, firstAt=83369862, attempts=2, terminal:true}, {global, mineral, terminal_trade, firstAt=83363952, lastAt=83403762, repeats=5, attempts=3, terminal:true}]`
⇒ 同一个 `mineral` 域动作在 **≈39,800 拍**里被反复升级 5 次、从不被抑制；
而 `TERMINAL_TRADE` 这条通道**正是历史上 credits −126K/40 分钟 那次烧钱事故的那条**（记忆 silent-inert-mechanisms §十一③）。
那次事故之后落地的是"**按缺口闸收窄 amount**"，**不是**"按重复次数收窄提交"——本条补的正是后者这一面。

**我没有直接修，这是方向性决策**：抑制恢复尝试本身就两头危险（抑制过头＝该救的不救；不抑制＝资源被拖死），属 L0 §1.5。
但**最便宜的第一刀不需要任何新数据**：`repeats` 已经持久化在 Memory ⇒ "同 `(room,domain,actionType)` 的 `repeats ≥ N` 就不再提交"可直接实现。
三种形态列在 **#110** 供选：①纯抑制（N 给你）；②先补"投入能量"计量再谈 ROI 型判据（工作量最大，且要让阈值跨部署可达就必须落 Memory）；
③零行为变化——只把 `recommendation` 落进 `escalations` 供离线看。依赖 **#104**（冷却恒假是同族的另一半）、**#105**（拒因取证，未部署）、**#103**（GLOBAL_ROOM 类动作全跳过）。

**顺带一条对上一轮的自我更正**：我在 #110 的草稿里一度把"投入为 0"写成"调用方忘了传参"。读完实现才知道
**根本没有可传的数**（没有任何累加者）⇒ 那是**测量缺口**而不是**接线缺口**，修法与工作量都不同（②要新建计量）。
⇒ 归因句式"X 没被传"必须先问"**有没有东西生产 X**"，这是我今天第 N 次在同一族上受益。

边界：零 src、零 push、零 build、零 console；只读 API 一发 + grep + 文档。

## R248 · 2026-10-03 18:0xZ（审计「持续优化」：**调优环真的闭合（有现场回滚计数），期望环只检测不处置**；顺带抓到一条现场异常：活跃远矿里 8 个路 site 整 boot 零进度）

### ① 好消息先说：调优（tuning-engine）这一环**不是摆设**，现场可证
`kernel.tuning`（`lastTuned=83405766`）里三条独立读数构成一条完整闭环：
- **回滚发生过**：`frozenParams` 中 `hauler.maxCount.rollbackCount=2`（W37S58）、`upgrader.maxCount=2`、`hauler.maxCount=1`（W38S56）
  ⇒ 代码路径 `applyRollbacksAndClearPending`（`tuning-engine.ts:292-320`）+ `recordEvent(TuningRollback)` 确实被走到过；
- **事前 binding 在跑**：W38S56 `pendingValidation["builder.maxCount"] = {preAdjustSignals:{roleCount:2,buildQueueBacklog:0}, expectedDirection:"worsen", adjustDirection:"down", preAdjustValue:2, adjustTick:83404766}`
  ⇒ 这就是 **#85 的"事前绑定判据"**在线上的样子（提案前先把"预期会变差"记下来，验证时比对）；
- **趋势有值**：`lastTrend["hauler.minCount"]="down"`（W38S56）。
`frozenUntil` 全 0 ⇒ **冻结从未行使**（`rollbackCount` 最高 2）——这与 #79/#85 的口径一致：**护栏存在但未被触发**，
不是"护栏坏了"。要判它有没有用，得等第 3 次回滚（阈值方向我不动）。

### ② 期望自检（expectations）这一环**只检测、不处置**
`E7 siteStale`（`expectations.ts:462-477`）在线上确实打中了东西（见 ③），但违例的全部去向是
`kernel.ts:582-598`：写 `Memory.kernel.expectations.violations` + 按签名去重后 `recordEvent(ExpectationViolation, [条数])`。
⇒ **没有任何按 id 的处置**：不生成失败节点、不删 site、不触发恢复。（对比：E2 有旁路、E3 有快照记录。）
⇒ 与 #110 同族但**不是同一条**：#110 是"恢复判定不回流"，这条是"观测判定不回流"。

### ③ 现场异常（可读、可复证，不是假想）
`kernel.expectations.violations` 现有 8 条，全部同形：
`siteStale:W36S58:<siteId>(type=road prog=0/300 age=19465 noProg=19465)`（8 个不同 siteId，age/noProg 完全相同）
- **W36S58 不是废房**：`rooms.W37S58.remoteOps.W36S58 = {state:"active", sources:2, haulerNeed:3, lastSeen:83405955, roadSiteCount:17, roadHeatTiles:96, roadLaid:1, roadReaped:0, ledger:{d:4,824,691, s:3,277,550, i:90,700}}`
  ⇒ 这是一个**正在产出的活跃远矿**（已收 482 万能量）。
- 但 8 个路 site 自 **boot（≈83386488）以来零进度**（`noProg=19,465` ≈ 20 小时按 3.744 秒/拍），
  且 `roadLaid=1 / roadReaped=0` 配 `roadSiteCount=17` ⇒ **路的"放置"远快于"建成"**。
- ⚠️**我差点把这条说成"没人去建"**：`builderVisits` 的写者是 `kernel.ts:704-710`，
  它是**从 `site.progress` 反推的**（`progress>0 ⇒ visits=1`）⇒ **`builderVisits===0` 与 `progress===0` 是同一件事的两种写法**，
  不构成独立证据。所以 E7 的两个条件实际退化成一个，**分不开"没派人去建"与"人到了但干不动（缺能量/无路/被挡）"**。
  ⇒ 这正是 R247 刚写进记忆的那条规矩的**第二次命中**：用"同源计数器"当第二条判据等于没有第二条。
- **该判的下一步（取证，不改码）**：看 `remoteHauler`/`remoteHarvester`/`builder` 里到底谁有资格在**远矿房**建路
  （`actions/build` 的房域限制 + `road-planner.ts:322 s.remove()` 的触发条件），
  而不是先给 E7 加处置——**先确认这是"没编制"还是"有编制但取不到活"**。已写进 **#111** 的判据。

### ④ 顺带一条与推送决策直接相关的读数
`kernel.tuning.strategyOverrides` 里那两条自改仍在：`posture.minDwell=1400 (adjustedAt=82993339)`、`posture.warPatience=8000 (adjustedAt=83287039)`
⇒ 已分别存在 **≈413,000 / ≈119,000 拍**，都 ≫ #89 的 TTL 15,000 ⇒ **#89 一上线这两条就会被读时过期**，
即"推 #89"的**实际行为后果**是 `minDwell 1400→1000`、`warPatience 8000→5000`（**都等于松绑、更爱开战**）。
这条不是我今天的发现（记忆里已记），但**第一次有了现场拍数**，写进推送风险单更硬。

边界：零 src、零 push、零 build、零 console；只读 API 三发 + grep + 读码。

## R249 · 2026-10-03 18:1xZ（#111 取证收口：**只有 `builder` 会建**，而角色表里没有远建工种 ⇒ 远矿路 site 的进度全靠"家里来的 builder 恰好在场"）

**证据链（全部现读，按调用形状）**
1. 建造动作只有一个入口家族：`buildNearestSite` / `buildAssignmentSite`，
   而它的**唯一使用者是 `src/creeps/roles/builder.ts`**（`:93`、`:96`）——`grep buildNearestSite|buildAssignmentSite src/creeps/roles` 只命中这一个文件 ⇒
   **没有第二个工种能建**（remoteHauler / remoteHarvester / reserver / remoteDefender / dismantler 都不带建造动作）。
2. 它的候选集是 `ac.snapshot.myConstructionSites`（`actions/build.ts:59-62`）⇒ **房域 = 该 creep 当下所在房的快照**。
3. `ROLE_CODES`（`event-log.ts:168-183`）里**没有 remoteBuilder**：harvester/hauler/distributor/upgrader/builder/worker/defender/
   remoteHarvester/remoteHauler/reserver/claimer/remoteDefender/mineralMiner/attacker。
⇒ **三条合起来**：远矿房（本例 W36S58）里的 road site 要前进，必须有一个**家房 `builder` 恰好出现在那个远矿房**；
   帝国**没有以"在远矿施工"为职责的工种**。这与现场症状自洽：8 个 site 整 boot `prog=0/300`。

**为什么回收器也没救场（这条我原来猜错了，读完才改）**
`road-planner.ts:295-330` 的回收判据不是"零进度"，而是**"冻住多久 + 是否在线外"**：
`offCorridor = 路 site 且 `!nearEvidence(walked, pos)``，只有**线外**格才计时、连续冻满 `roadStaleReapTicks=2000` 才删（注释里点名的正是 W36S58 那 14 格历史残骸）。
⇒ **热度走廊上的 site 被这条判据保护着**（设计意图：线外＝铺错了，线内＝还没轮到）；
   而"线内却永远轮不到"这种形状**恰好落在回收器的保护伞下**，于是既不删也不建 ⇒ `roadReaped:0` 与 8 条 `siteStale` 并存。
   注释里那句"500 点封顶的成本换回整条通勤走廊的铺路权"说明作者想解决的是**车道被占**，不是**车道没人铺**。

**仍然没证完的那一件事（诚实标出来 + 给出判别式）**：**"从没派 builder 去过"还是"派去过但太少/被能量卡住"**。
现有仪器分不开——`builderVisits` 是从 `progress>0` 反推的（`kernel.ts:704-710`），**同源**；
`roadLaid:1 / roadReaped:0 / roadSiteCount:17` 只给总量不给"谁建的"。
**可用的判别式（零新仪器）**：读 `domain/logistics/road-build` 那条"建成侧账本"（`coldCounters.roadsBuilt`，判据是 `roadsBuilt` 与 progress 和）
——**隔一个 boot 段做差分**：`roadsBuilt` 在动 ⇒ 有 builder 到场、是"量不足"；整段为 0 而 `roadSiteCount>0` ⇒ **就是"没有编制"**。
（本次读到的 `W36S58.roadLaid=1`、`roadReaped=0` 尚不足以判它——那是放置侧计数，不是建成侧。）

**修法方向（属人，我不动）**：
①给远矿配**施工编制**——最自然是让 `remoteHauler` 在"空载回程 + 现场有能量"时兼建路（它本来就在那条路上，边际成本最低），
   代价是搬运量下降与 `traffic-manager` 的 CPU；
②把 E7 的处置接上（`siteStale ≥ N` ⇒ 停止在该房铺新 site 或回收线内残骸）——**先做上面那条差分再决定**，
   否则"有 builder 但太慢"的情形下加处置会**误删正在建的东西**；
③接受现状：路铺不完＝远矿通勤成本高（这条要算钱：远矿 hauler 无路的移动代价 × 通勤次数，与①的成本对比）。
**依赖**：#110（期望/恢复都是"检测了不处置"那一族，本条是它在施工侧的实例）、#5（远矿道路账本判案的前作）。

边界：零 src、零 push、零 build、零 console；读码 + 只读 API 若干。看门狗 round 2/40、锚未再移动。

## R250 · 2026-10-03 18:1xZ（**撤我上一轮的根因**：远矿**有**施工编制 —— `remoteHauler` 边走边建；同时落一条真修：E7 的假阴性 + 同源判据）

### ① 撤回 R249 的结论（那条说"只有 builder 会建 ⇒ 帝国没有远矿施工编制"）
现读反证：`src/creeps/roles/remote-hauler.ts:38 buildRoadSiteUnderfoot(creep)`，**被自己的动作管线在 `:100` 调用**；
`road-planner.ts:155` 有"通勤 hauler 的建路半径"常量、`:174` 注释直写"**施工不归本函数：通勤 hauler 经 buildRoadSiteUnderfoot 边走边建（range≤3）**"。
⇒ **远矿路是有编制的**，R249 那句"没有以远矿施工为职责的工种"**作废**；#111 的根因回到**未定**。
（对端的记忆册也独立记着同一口径：三把锁已线上判效过、`roadReaped=10` 后 W36S58 `roadsBuilt 0→1`，判别式同样是"隔 boot 段做 `coldCounters.roadsBuilt` 差分"。⇒ 我不与它争，把 #111 改回"停滞现场已记、根因待差分判定"。）

### ② 我是**怎么**得出那个错结论的（这才是可复用的部分，两条）
1. **用"我搜过的那几个符号"支撑了一句全称命题**：我搜的是 `buildNearestSite|buildAssignmentSite`，
   得到"唯一使用者是 `roles/builder.ts`" —— 这个结论**在它搜的符号范围内成立**，我却说成了"谁都不能在远矿建"。
   远矿走的是**第三个函数名**（`buildRoadSiteUnderfoot`），完全在我的检索词之外。
   ⇒ 全称断言要么穷举"能做的动作"这一族（这次的正确搜法是 `\.build\(` / `ConstructionSite` 的消费方），要么把措辞降级成"这两个入口只被 builder 用"。
2. **一条 grep 报错被我当成"查无"**：`grep ... src/creeps/roles/remoteHauler.ts` 返回 `No such file or directory`
   （真文件名是 kebab 的 `remote-hauler.ts`），而我在下一步照常用了"roles 里没有远建动作"这个**由失败查询得到的空结果**。
   ⇒ 同一条纪律的第二次命中：**空结果 ≠ 没有，尤其当命令本身报了错**；这一族我在 #36/#106 上都记过。

### ③ 落一条**真修**（与上面那个错结论无关，独立成立）：E7 的两处仪器缺陷
`src/kernel/expectations.ts` + `src/kernel/kernel.ts`，纯检测口径、**零行为变化**（违例清单在 `src/` 内没有任何按 id 的消费者 ⇒ 改它不可能改动作，这是本条的安全边界，也再次印证 #110"检测了不处置"）：
1. **假阴性类**：旧条件带 `sp.builderVisits === 0`，而 `builderVisits` 是**从 `site.progress` 反推**的（`kernel.ts:704-706`）
   ⇒ **"有进度后冻住"的残骸被整体豁免**。这一类线上真实存在：`road-planner.ts:300-307` 的注释写着 W36S58 曾有"14 格进度和恒为 970"的残骸在锁车道，
   作者当时只能在回收侧自己绕。⇒ 停滞判据现在只看 `noProgressAge`。
2. **同源当独立**：新增**独立观测量 `buildersInRoom`**（一次遍历 `Game.creeps` 得到每房我方 builder 数，O(creeps) 一遍、不是每 site 一遍），
   E7 据此把停滞拆成互斥且各自可行动的读数：`siteStaleNoBuilder`（该房此刻没 builder ⇒ 编制/派遣侧）vs `siteStaleBuilderIdle`（有 builder 却不推进 ⇒ 能量/取活/可达侧）。
   ⇒ 顺带给 #111 造出它缺的那条判别仪器：**"远矿到底有没有 builder 去过"从下一次部署起是直读的**（此前只有 progress 反推）。
3. 另一条**当场发现并写进注释**：`siteAge` 实际是 `tick - lastProgressTick` 的副本（首次见到该 site 时为 0）
   ⇒ 它**不能**用来推断"site 是哪一拍放下的"。我 R248 里那句"8 个 site 是 boot 时放下的"因此降级为**无依据**；
   成立的只有 `noProg=19,465 拍`（≈20 小时按实测 3.744 秒/拍）。命名保留旧字段、语义在注释里写死，等真接入放置时刻再改。

**测试**：`tests/unit/kernel/e7-e8-wiring.test.ts` 的 E7 段重写 —— 原来那条**给缺陷背书的用例**"有 builder 到达 ⇒ 不违例"
（它断言的正是 `builderVisits>0` 豁免行为）拆成两条：①"有进度但冻住且无 builder ⇒ 仍违例（旧判据在这里漏报）"、
②"停滞但房内有 builder ⇒ `siteStaleBuilderIdle`，且不得同时出现 NoBuilder"。其余夹具改为工厂函数 + `buildersInRoom`。
⇒ `npx tsc --noEmit` 干净；`e7-e8-wiring + expectations + expectations-e4-e9 + expectation-event-rate` **63/63 通过**。
反向对照内建在①里：把条件还原成带 `builderVisits===0` 的旧形，①必红。

**部署边界**：这笔 src 改动**不单独换码**（一次部署＝清堆 + ≈400 拍 G6 税），随 130 笔那一批走；线上仍是 `ea4c69da6f8b`。
判效方式（上线后第一读）：`kernel.expectations.violations` 里前缀应从 `siteStale:` 变成 `siteStaleNoBuilder:` / `siteStaleBuilderIdle:` 两类；
若整窗只见 NoBuilder 不见 BuilderIdle ⇒ 支持"派遣/编制不足"那一侧；反之支持"到场干不动"。**这一读也顺手把 #111 的根因判掉。**

边界：零 push、零 build、零 console；src 2 文件 + 测试 1 文件 + 文档。

## R251 · 2026-10-03 18:2xZ（新仪器**自己**也带着我刚撤掉的那个错：只数 `builder` ⇒ 远矿会被误判"没派人"。撤前一轮的教训在 24 小时内复发一次）

R250 落了 `buildersInRoom` 之后，我按自己刚写进记忆的规矩去穷举"谁能建"，结果 **推翻了我自己十分钟前那个字段**：
`grep -rn "\.build(" src` 全量命中 6 处 —— `remote-hauler.ts:89`、`remote-harvester.ts:390`、`actions/dump.ts:90`、
`actions/build.ts:38/81`、`assignment/service.ts:71`（注释还专门讲"builder 只收 build"的边界）。
⇒ **能施工的角色不止 builder**，而我的字段按 `role === "builder"` 计数 ⇒ **远矿路 site 会被系统性误报成 `siteStaleNoBuilder`**
（那里施工的是通勤 hauler），也就是把我上一轮撤掉的那个错，原封不动装进了新仪器里。

**改法**：字段换成 **`workerCreepsInRoom`** =「该房内带 ≥1 个 `WORK` 部件的我方 creep 数」——**能力谓词**，不是角色名谓词；
前缀随之改成 `siteStaleNoWorker` / `siteStaleWorkerIdle`。计数是 `Game.creeps` 一遍（O(creeps)，不是每 site 一遍）。

**分工也当场划清**（避免与对端已有的仪器重复）：`domain/logistics/road-build`（每房每次尝试的分桶 `calls/noEnergy/noWork/noSiteAtAll/roadsBuilt`）
**要有 creep 尝试施工才有读数**；`workerCreepsInRoom` **不需要有人尝试**，所以它补的正是 road-build 答不了的那一半：
"这个 site 所在的房里，此刻**根本没有任何能施工的人**吗"。⇒ 两者合起来才把 #111 的两个分支（编制/派遣 vs 到场干不动）分开。

**验证**：`npx tsc --noEmit` 干净；`npx vitest run tests/unit` 全量 **387 files / 5239 tests 全绿**；
`grep -rn "buildersInRoom|NoBuilder|BuilderIdle" src tests` 零残留（改名是我自己那把 python 脚本做的，
它顺手把三行 `it("…")` 的收尾引号删掉了 ⇒ 我分两次修回来，教训：**批量改名要么用 Edit 要么改完必跑 tsc**，别信脚本的"成功输出"）。

**这条为什么值得单独一段**：我上一轮的结论错在"用我搜过的符号支撑全称命题"；这一轮的错是**同一个**——
差别只在于这次我在**提交前**用穷举把它抓出来了。⇒ 规矩要长成一问：**"我刚定义的那个筛选谓词，是我搜过的集合，还是能力集合？"**

边界：零 push、零 build、零 console；src 2 文件 + 测试 1 文件 + 文档。

### R252（10-04 02:30Z，本会话）integration 层抓到我自己写进去的回归，E7 的假阴性主张补上反向实验
**①回归归因（我这几轮唯一的 src 缺陷，且只在测试层）**：`collectSiteProgressSnapshots` 里我加的
`if (Object.keys(Game.constructionSites).length === 0) return result;` 在 integration 夹具里抛
`TypeError: Cannot convert undefined or null to object (kernel.ts:695)`，抛出被 `safeRun("expectations")`
吞掉 ⇒ 整条 expectations（E2+E7）静默死亡 ⇒ `npx vitest run tests/integration` = **5 files / 9 tests 红**
（`p3-bypass-loop`：「E2 应检出 P3 饥饿，实际违例: []」＋ 4 个 `rcl2-*` 建造场景）。
修法：先取 `sites`/`siteIds` 判空，空集分支里**仍然清理 tracker**（顺手补掉"全部 site 消失后条目永久留在 Map"的旧漏），
循环改遍历 `siteIds`。复跑 `tsc --noEmit` 退出 0、integration **30 files / 239 tests 全绿**（9 红清零）。
**边界（不外推）**：引擎线上 `Game.constructionSites` 恒为对象 ⇒ 这**不是**一次线上风险，E7 在产线一直在跑；
它兑现的代价是"我用 unit 全绿冒充过门禁全绿"，而钩子只跑 unit + `tsc`。⇒ 记法不变：**"门禁全绿"必须自己补 integration**。

**②E7 假阴性主张的反向实验（R251 欠的那一发）**：把条件临时改回旧式 `noProgressAge > E7_STALE_TICKS && sp.builderVisits === 0`，
`e7-e8-wiring` + `expectations` 同跑 = **2 红 / 36 绿**。两条红恰好都钉在新覆盖的那一类
（`siteStaleNoWorker`「有进度但冻住」与 `siteStaleWorkerIdle`），控制组（23 条 expectations 用例＋其余 E7/E8 用例）全绿
⇒ "旧判据整体豁免了'有进度后冻住的残骸'"由推算升为实测。已当场改回，`git diff src/kernel/expectations.ts` 为空。

**③状态**：#111 的仪器侧到 `WIRED+TESTED`（unit/integration 两层都绿）仍**未部署**，
`EXERCISED`（线上真的按 `siteStaleNoWorker`/`siteStaleWorkerIdle` 分过桶）只能等一次换码批；
零 src 行为改动、零 push、零 build、零 console。批 ahead=130 / behind=0，仍等 owner 对 A/B/C（含 `1bc67c9` #89）授权。

### R253（10-04 02:37Z，本会话）G4 输入实测翻倍、幼房物理 storage 确认存在、以及一条我自己配错了的跨房配对口径
**①G4 现在有可直接读的真值**（`peek kernel.gateNetFlow`，零 console）：`{W37S58:+3.4173, W38S56:-1.2908}` ⇒ **Σ=+2.126**。
序列：R122 −1.274 → R123 −0.644 → 今天 +2.126（首次整台转正，且核心房单台已 +3.42）。
两台快仪同拍都在正区（`economy.nf`：核心 +6.57/拍、幼房 +6.02/拍，出口 = mem.nf/100）⇒ 写者算式
`Σ'=Σ+α(I-Σ)`（α=0.02、interval=100）里 **I_total ≈ +12.59/拍 > 门槛 5**，所以这次不是"渐近线够不到"那一支。
按"总和"口径解穿越时刻：n = ln((I−5)/(I−Σ))/ln(1−α) = ln(7.59/10.464)/ln(0.98) ≈ **15.9 次更新 ≈ 1,590 拍**；
拍长实测带 2.65~4.58 秒（本轮 round3→4 = 200 拍/613 秒 = 3.07 秒/拍）⇒ **≈1.2~2.0 小时带**，比 R123 的 5.9~10.2 小时近一个量级，
差别就在输入：R123 反解出的 I≈+2.45（还要靠"停卖"才抬到 6.43），今夜这一窗两房各 +6。
**前提写死**：I 一路守住 +12.6/拍。实测两小时内 I 走过 +14→−9→+2.45，快仪 τ≈165 拍，一次孵化脉冲（本窗核心房 `spawned:4800`）就能把它打回去。
⇒ 这条**不新建表**：`posture-exit-watch3.sh` 每轮已经打印 `Blocked=…`，G4 翻没翻由它免费记录（pid 55858，round4 18:23Z）。
即便 G4 自绿，扩张仍被 G0（war 尾税，锚 83409813 ⇒ ≈21:1xZ–00:0xZ 带）和 G6（负载 14.5/拍 vs 门槛 12.00，#50 属人）挡着。
**②幼房 storage 的落点问题按量级结案**：`se` 的写者是 `snapshot.storageEnergy`（`timeseries.ts:261`；`rs` 是 `phase.reserve`＝账务量不是仓库，
这是本轮第二次撞到"同一支工具两列口径不同"）。W38S56 的 `se` 在 1,200 拍里 47,347→50,551、Memory 侧 `cr≈50,551 / rb=1,000,000`、
`storageNearFull=false` ⇒ **#42/#48 的"幼房 RCL4 storage"前置条件成立**，且 `bk.imported=800` 本窗仍在流。
但"交付物理落点是 storage 还是 container"用现有仪器**分不开**：同窗 `harvested=920` 与 imported 同量级，环只有 50 拍采样、
单笔 carrier 卸能 1,000~2,000 落在 ±1,000 抖动里 ⇒ 这是**分辨率不够**而不是机制缺失。该量不在决策路径上（入账已由 `imported/exported` 成对验过 3 次）
⇒ 按量级结案，不再追。
**③我自己配错的一条口径**（当场记）：本窗 W38S56 `economy.t=83406418`、W37S58 `economy.t=83406379`，相差 39 拍 ⇒
**两房的 `bk` 是不同的 50 拍窗**。所以"A 房本窗 imported>0 ⇒ B 房本窗 exported>0"这种逐窗配对按构造不成立；
我之前引的配对证据是**累计总量**（59,079 vs 50,400）那一支，仍然成立，但今后跨房配对必须先核两行的 `t` 是否同窗，
否则就用累计差分。核心房这一窗出现 `imported:1000` 而幼房无 `exported` 键，正是这个错位的样子，**不是新流向的证据**。

### R254（10-04 02:41Z，本会话）#104 撤案改判：不是"缺一个写者"，而是"一层按构造永不生效的重复阻尼"——我在写码前把方向读回来了
**我上一轮留给自己的规格是"只差一次 grep 就能补 `recordRecoveryAttempt`"。按规矩先读消费方，结论反过来：**
1. 表的两端都活着：`empire-health-system.ts:105` 读 `g.recoveryCooldowns ?? new Map()`、`:208` 原样写回 ⇒ **只回写空表**；
   `recordRecoveryAttempt`（`recovery-priority.ts:129`）src 零调用者（只有 `tests/unit/strategy/a4-5-autonomy.test.ts`）⇒ 表恒空 ⇒ `isOnCooldown` 恒假。
2. **真正的重试阻尼在别处且更完整**：`recovery-execution-system.ts:124-135` 用
   `shouldSubmitAction(g.recoveryActionTable, action, tick, getRetryPolicy(action.type).cooldownDuration)` + `maxAttempts` +
   `maxSubmitPerTick=3` 做**按动作类型**的冷却与尝试上限。⇒ 我先前把 #110 的"同一动作重复升级"分一半给 #104 是错的：那条已有阻尼。
3. **方向核实（不写码就得改口的第二理由）**：`isOnCooldown` 的条件是
   `currentTick < entry.lastAttemptTick + entry.cooldownDuration`（`:99-110`），**完全不看 `lastSuccess`**；
   而 key 是 `domain:room` 不是动作 id ⇒ 一旦把写者接上，同一个 `domain:room` 下**任何**别的恢复动作都会被那个
   硬编码 200 拍统一年轻抑制掉，叠在已有的按类型 policy 之上。那是在引入缺陷，不是修缺陷。
4. 所以 #104 的正确处置是"**删或并**"：(a) 删掉 `CooldownTable` 这条支路（**今天行为零变化**，因为它按构造恒空），
   让 `recoveryActionTable`+`getRetryPolicy` 当唯一真相；或 (b) 把执行侧的 policy 上收进 domain 表（大工程）。
   两者都属 #107 那一类"接线 or 删除"的属人决定，**我没有动任何 src**。
5. 顺带一条同类残骸：`selectNextRecovery`（`:401`）src 零调用者。
**可复用的规矩（这次救了我一次改口成本）**：给"某机制没接线"立案要修之前，必须①找到**同职责的第二处实现**（这里是执行侧重试 policy），
②读那个谓词自己的条件字符串核**方向**（`isOnCooldown` 不看成功与否），③确认 key 的**粒度**（domain:room vs 动作 id）。
三条里任何一条跳过，"补写者"就会变成"叠第二道闸"。

### R255（10-04 02:42Z，本会话）R253 的单步预测当场复验：公式对，喂给它的那个数不对
**取数**（同一次 peek，零 console）：`gateNetFlow={W37S58:+3.57316, W38S56:−1.14462}` ⇒ **Σ=+2.4285**（R253 的 2.1265，Δ=+0.3021）；
两房 `economy.t` 各自 +100 拍 ⇒ **每房恰好走了一次 interval=100 的更新**，这是最干净的一步复验窗口。
**①公式成立，但要靠反解而不是代入**。逐房用写者式 `Σ'=Σ+α(I−Σ)`（α=0.02）反解当时的输入 I：
- 幼房：I = −1.29083 + 0.14621/0.02 = **+6.0197** ⇒ 与我 5 分钟前采到的 `nf=602`（6.02/拍）**四位小数吻合**；
- 核心房：I = 3.41731 + 0.15585/0.02 = **+11.210** ⇒ 我采到的是 6.57/拍，而现在存的是 13.66/拍，**11.21 正好落在这段轨迹中间**。
⇒ 结论：`Σ'=Σ+α(I−Σ)` 这个模型是对的；**错的是"把我采样到的那一拍 nf 直接当 I 代进去"**——快仪自己每 50 拍跳一次，
采样值与更新时刻的真实输入可以差整整一个步长（这里核心房差 70%：6.57 vs 11.21）。⇒ 今后凡用慢仪做单步复验，
**一律先反解 I 再判**，别用代入式对表。
**②输入比我 R253 假设的高，ETA 因此再缩一档**：I_total 反解 ≈17.23/拍、当前两台快仪之和 23.67/拍（R253 用的 12.59 已过期）。
`n = ln((I−5)/(I−Σ))/ln(0.98)` ⇒ I=17.23 时 n≈9.4 次更新 ≈940 拍；I=23.67 时 n≈6.4 次 ≈640 拍。
拍长今夜标定带 2.65~4.58 秒/拍（R253 实测 3.07）⇒ **G4 自绿的时刻 ≈17~49 分钟带**（不是 R253 写的 1.2~2.0 小时）。
**③但这个上升里有相当一部分是"没有支出的窗"造出来的**（当场把机制写清，免得下轮把伪影当盈余）：
核心房本窗 `bk={harvested:1000, repaired:31}`——**spawned/build/upgraded 三个键都不在**（上一窗它刚记过 `spawned:4800`），
收入照记 1,000 而支出≈0 ⇒ `nf` 从 6.57 跳到 13.66 主要是采样窗换了，不是收支结构变好。这正是我 R253 那句
"I 历来守不住"的机制面：**50 拍窗的 `bk` 只列非零键，所以一个空支出窗能把净流抬到与一次孵化脉冲同样多的反向偏差上**。
⇒ 判读纪律：凡引用 `nf` 的绝对水位，先看同窗 `bk` 少了哪几个键（`spawned/built/upgraded/repaired`），而不是只看它正负。
**④扩张链现状不变**：watch3 round5 18:34Z 仍 `posture=war / Blocked=G0+G4+G6 / newSighting=none / anchor=83409813`，
G3 连续两轮不在列（R246 那次转绿保持）。⇒ 即便 G4 在几十分钟内自绿，仍剩 G0（尾税，≈21:1xZ–00:0xZ 带）+ G6（#50 属人）。
幼房 `bk` 本轮 `built:150 / imported:429` ⇒ 建设与跨房导入同时在场，与 #111 的"工地没清空只是回落"一致。

### R256（10-04 02:46Z，本会话）#112 立案：自治度指标（L0「长期自主」的自报数）有 60/100 权重按构造不反映事实
读的是 `computeAutonomyScore`（`domain/strategy/autonomy-metrics.ts`）的**每一条输入的写者**，不是它的输出。三条独立结论：
**①`recoveryRate` 的分子被快照重复累加（新缺陷，方向=偏乐观，最硬的一条）**
- `recovery-execution-system.ts:203`：`g.__autoRecoveredFailures = (… ?? 0) + stats.succeededCount`，本系统 `interval: 10` ⇒ **每 10 拍执行一次**；
- `stats.succeededCount` 来自 `computeRecoveryStats`（`recovery-lifecycle.ts:815-845`）里 `for (const record of table.values())` 的
  **整表快照计数**（不是"本次新成功数"）；
- `cleanupRecoveryTable`（同文件 `:747`）给 `succeeded` 的 `RETENTION = 500` ⇒ 一条成功记录在表里**存活 500 拍**。
⇒ 同一次成功被累加 **≈500/10 = 50 次**；而分母 `__totalFailuresDetected += submittedThisTick` 每次提交只加 1。
⇒ `recoveryRate = autoRecovered / totalDetected` 只要历史上有一次成功落在近 500 拍内就会饱和到 ≥1 ⇒
`failureRecoveryScore = round(rate×100 − min(30, activeFailures×5))` **长期贴着上限**，这 **25 分权重不反映恢复能力**。
**②`perturbationRecoveryScore` 的 15 分按构造恒为满分**：`__perturbationCount` 与 `__totalRecoveryTime` 在 src 里**只有读者**
（`empire-health-system.ts:173-174`），零写者 ⇒ 永远 0 ⇒ 走 `autonomy-metrics.ts:185` 那支 `perturbationCount === 0 → 100`（作者自己的注释都写着"但可能意味着没有挑战"）。
讽刺的是**恢复时长数据其实算得出来**：`recovery-lifecycle.ts:828` 已经在累加 `record.updatedAt − record.submittedAt`、`:839` 已有 `avgRecoveryTime`，
只是从没写进那两个 heap 计数器 ⇒ 属 #106 那一族"**半接线**：生产侧算完落进别的形状，消费侧读一个永不写出的键"。
**③`manualInterventionScore` 的 20 分是硬编码**：`:171` 传 `manualInterventions: 0`，旁注"自治框架不追踪人工干预（需要 console hook）"⇒ 声明式已知盲区，按原样保留但计入"未覆盖"。
**合起来：25 + 15 + 20 = 60/100 的权重不携带证据。**等级映射 full≥90 / high≥70 ⇒ 真实 55 也能报成 "high"，
而这是 L0 那句"长期自主生存"唯一的自报指标，也是我给 owner 写能力矩阵时会被引用的数 ⇒ 属**报表诚实度**缺陷。
**边界（不夸大）**：`autonomyStatus` 的消费者只有 `empire-health-system.ts:219` 那行日志（grep 全 src 无闸读它）⇒
**它不在决策路径上，不挡任何闸、不解任何 #88/#50**，所以别把它当成"修了就能扩张"的路；危害是它会误导 owner 与我的下轮判读。
**修法形状（一次形参读取即可起手，我这轮没有码）**：把增量从"整表快照"改到"**状态跃迁那一处**"——
`recovery-lifecycle.ts:243` 的 `transitionAction(record, "succeeded", …)` 是唯一的成功跃迁点，在那儿 `+1` 并顺手
`__perturbationCount += 1; __totalRecoveryTime += record.updatedAt − record.submittedAt`，三个问题一次解决且不改语义。
⚠️这是**行为改动**（改完 autonomy 数会**下降**，因为虚高被撤）⇒ 按我记过的"诚实化指标会缩下游消费者"纪律：
改前写死阈值+控制组，且**先确认没有别的消费者**（现在只有日志，故风险低）。线上虚高的量级**未证**：那两个计数器住 heap，
`__autoRecoveredFailures` 现值要一次 console 才读得到 ⇒ 本会话零 console，留给下轮一发取证。

### 巡检 R125（10-03 18:4xZ UTC，不占 R 号）**#61 第一次拿到完整武装条件归因：拒掉那只 1,400 成本物流的，是"某只采集者进入 600 拍替换窗"这条预留——而该房的风险缓冲是 4,140 拍**；watch2 的 STUCK 是对旧字面量算的，作废（watch3 已按我 R124 的补救每轮现算 `anchor=83409813`）；G4 自绿预登记 ≈19:2x~19:5xZ，但**爬升里含一块"修墙账没到期"**

> ⚠️**时刻口径**：本会话一律 `date -u`（UTC）。对端条目尾缀写 "Z" 但用的是本机 CST（=UTC+8，例：R255 标 "10-04 02:42Z" = UTC 03 日 18:42）⇒ **跨会话比对时刻前先换算，别按字面 Z 排序**（对时区不敏感的安全做法：一律引用 tick）。

· **#61 的归因（本轮最硬）**：差分 `budget +6 / reserveOnly **+227** / degradeGateClosed +232` ⇒ ⊆ 成立（232≤233）、速率三倍于上一窗。武装条件这次读全了：`economy.cr=53,820`（=round(reserve)，**不是危机比例**）、`economy.rb=41,400` ⇒ `rb/10=4,140` ⇒ 条件 2（`cr>0 && rb/10<400`）**假**；`harvesters_hc=2` ⇒ 条件 1 **假** ⇒ **只剩条件 3**（采集者进入 `replacementHorizonTicks=600` ⇒ 抬 `recoveryEnergyReserve=200`）。⇒ **一个 P0/P1 续航 4,140 拍的房，因一只采集者快到期，拒掉 `energyAvailable=1,405 ≥ 1,400` 的物流请求**，而它要保护的采集者本来就在场（hc=2）。⇒ 修法应对准"替换窗预留何时抬、物流类是否豁免"，**不是 `riskBuffer`、不是那 200 这个数**——两者我都没动。
· **war 锚**：对端已把我 R124 的补救落地：`posture-exit-watch3.sh:12-13` 写死 5,000/`max+5000`，`:17` 每轮现算并打印 ⇒ round6 `anchor=83409813`。而 **`watch2` 仍在跑并在同一拍打 `STUCK：超 83406420`——那比活锚早 3,393 拍，是字面量不是证据** ⇒ 读表以 watch3 为准；那一步（查 liveThreat/anyRecovery/R4 止损）现在不必做。我不停对端的进程。
· **G4 的爬升 + 一个天花板**：`gateNetFlow={4.0707, −0.9215}` ⇒ **Σ=3.149**（对端 18:42 读 2.4285 ⇒ +0.72/≈400 拍）。预登记：按其反解式 `n=ln((I−5)/(I−Σ))/ln0.98`，I≈17.2 时 `n≈940 拍` ⇒ **自绿 ≈83407200~83407500（UTC 19:2x~19:5x）**；到点未到 ⇒ 回来重读 `empire-economy.ts:281-291` 的输入链。⚠️**但核心房当窗 `bk={harvested:890, spawned:1100, imported:1000}` ⇒ `towerSpent/repaired/upgraded/built` 四键全缺**，而 R118/R119 实测修墙曾达 **30/拍**（自 boot 均值 6.9/拍）⇒ **这部分"输入变高"是维护账单没到期，不是收支结构变好**；rampart 衰减后维修会再点火、`nf` 那时再掉。⇒ **#88 谈"抬均值过 5"必须用含维护轮的均值**，别拿这种空支出窗当基线（与对端 R255"空支出窗能抬高净流"同源，我把它接到维护周期上）。
· **幼房第一次演示"危险退役 + 重选目标"**（自主成长第 4 种行为）：`remoteOps.W38S55={state:"abandoned", stateSince:83405805, dangerUntil:83415805, ledger.d:31,848, roadLaid:1}` ⇒ `dangerUntil=stateSince+10,000` ⇒ **走的是"危险"那条退役（对应 83404813 那次进犯），不是 `maxOperations` 超额收缩**；同拍开出 `W39S56 active`、车道 `W38S56→W39S56 合表@83406425`、`Plans 4→5`、候选 R 档 8。该 op 5,000 拍里交付 31,848（≈6.4/拍）= 幼房自己远矿的第一笔真实产出。⇒ 链条"开点→交付→被危险退役→重选"全程零人工；**R126 判别：83415805（≈UTC 22:2xZ）之后它回 W38S55 还是留在 W39S56**——别拿 `abandoned` 这个词推"永久放弃"（R188 已记它不自撤销）。
· **其余**：采购第 5 次读数仍 `buyTried=0/buyOk=0/buyNoMatch=4/publishedAt=83402318`（距发布 ≈7,000 拍未花钱）；核心房 `risk=false`（保级带这圈已退出）；调度 healthy、`tier=tight@83387005`、300 拍环 CPU avg 20.7/max 25.6、`errorsPerTick=0`；两房 `imported` 都很大 ⇒ 跨房供给满负荷（配对不按同窗核，R231 定案）。
· **边界**：零 src、零 push、零 build、零 console；探针 observe×1 + peek×3 + 脚本读×2；对端看门狗字段一律从日志代取（零 API）。**R126**：①Σ 是否 ≥5（时刻带在上，且同拍读核心房四个消费键，判"过线窗是不是空支出窗"）；②war 活锚 83409813（读 watch3）；③#61 三栏差分；④`dangerUntil` 到点后幼房 op 去向；⑤`buyTried>0`。§3.5 属人 7 项未动。

### R257（10-04 02:51Z，本会话）#112 落码：恢复统计改吃"同拍增量"，并把两个零写者的 autonomy 键接上
**先红后绿**（顺序即证据）：夹具先只对既有 API 断言 ⇒ 修复前实测 **1 failed / 1 passed**，失败值正是我 R256 推算的那个
`- 1 / + 50`（= `RETENTION.succeeded 500` ÷ `interval 10`）。⇒ **虚高的倍率从推算升为实测**。
**改动**（`recovery-lifecycle.ts` + `recovery-execution-system.ts:200-208`）：
- `computeRecoveryStats` 新增 `succeededThisTick` / `recoveryTimeThisTick`（`record.updatedAt === currentTick` 的记录才算），
  并把参数 `_currentTick`（此前**根本没被用**）改为真用；`succeededCount` **语义不动**、只把接口注释从"（累计）"改成
  "**整表快照**，不能当事件增量累加"——那行写错的注释就是这次虚高的入口。
- 消费侧三处：`__autoRecoveredFailures` 改吃 `succeededThisTick`；`__perturbationCount` / `__totalRecoveryTime`
  **第一次获得写者**（此前恒 0 ⇒ `autonomy-metrics.ts:185` 一直走"无扰动=满分"那支）。
**delta 口径的前提，已读码证**：`verifyPendingActions` 只在 `recovery-execution-system.ts` 内定义并被自己调用（88/112/193 三处），
⇒ succeeded 跃迁必然发生在本系统自己的运行 tick 上 ⇒ `updatedAt === currentTick` 不会漏计。
**复跑**：`tsc --noEmit` OK；新夹具 4 例 + 既有 `a4-5-autonomy` = **32 passed**；`tests/integration` **30 files / 239 tests 全绿**。
**边界**：①这是**报表口径**改动，不改任何闸——`autonomyStatus` 的消费者仍只有那行日志；改完这个数会**下降**（撤虚高），
按我记过的"诚实化指标会缩下游消费者"，这里没有下游消费者可缩，唯一影响是 owner 看到的自报自治度变低，这是**预期**。
②`manualInterventions: 0` 那 20 分未动（需 console hook，作者已声明）。
③仍未部署 ⇒ `WIRED+TESTED`，不是 `EXERCISED`；线上 `__autoRecoveredFailures` 现值住 heap，要一次 console 才能给出"今夜到底虚高了多少次"，
本会话零 console，留给下轮（这一发也顺便是我这条修复的第二样本）。

### R258（10-04 02:53Z，本会话）Σ 升到 +3.913（离门槛 5 只差 1~2 次更新）＋ 我自己两处口径当场纠
**①G4 又快到了**：`gateNetFlow={W37S58:+4.5481, W38S56:−0.6351}` ⇒ **Σ=+3.913**（R255 的 2.4285 → 现在 3.913）。
两台快仪现值：核心 **27.94/拍**、幼房 **7.85/拍** ⇒ I_total≈35.8 ⇒ `n=ln((I−5)/(I−Σ))/ln(0.98)` ≈ **1.7 次更新 ≈ 170 拍** ⇒ 按拍长带 ≈**9~13 分钟**。
反解核对（同拍增量的更新次数按 `economy.t` 差分定）：核心 `t` 83406479→83406629 = +150 拍 ⇒ 1~2 次更新，
反解 I 在 28~52/拍之间——**次数不确定时 I 的绝对值就不可信**，这是 R255"先数更新次数"的再一次应用。
**②我纠自己 R253 的一条**：幼房 `rb` 从 1,000,000 变成 **16,201**，而 `cr` 仍 55,407（> rb）⇒ **`rb` 不是 storage 容量**，
我 R253 写的"容量 1,000,000"是把一个恰好等于已知容量的键当成了容量。"幼房有 storage"这条结论**不受影响**——
它站得住是因为来自 `se`（写者 `snapshot.storageEnergy`，`timeseries.ts:261`，读码定过），不是来自 `rb`。
⇒ 规矩复述：字段的**语义只认写者**，别拿"数值恰好等于我已知的常数"当定义。
**③核心房同一窗同时出现 `imported:2000` 与 `exported:1200`** ⇒ 帝国内部存在双向流（此前我只见过单向）。
幼房同窗只有 `imported:800`、无 `exported` 键，但按 R253 更正两房窗口不同对齐（`t` 差 39~180 拍），
**所以"谁把这 2,000 送进核心房"仍不能由本窗判定**；可判的是累计总量差分（#35/#48 用的那支）。
**④一条新的、按正确测法设计的疑点**（不当结论用）：幼房本窗 `bk` 收入 1,800（harvested 1,000 + imported 800）、
支出 2,055（spawned 1,650 + upgraded 345 + repaired 60）⇒ 窗口均值 **−5.1/拍**，而同拍 `nf=+7.85/拍`，差约 **13/拍**。
⚠️这**不能**由单窗定罪：快 EMA τ≈165 拍，一个窗的值不是它的输入均值（前几窗幼房在 +6~+10）。
正确测法写死：取 ≥3τ（≈500 拍）内连续多个 `bk` 窗的均值序列，与同期 `nf` 轨迹比；若 EMA 均值系统性高于窗均值，
才是"分子/分母口径不一致"（`nf` 此前已知把 `sold` 加回、把 `pickedUp` 算收入）。**我这轮没有下任何结论**，只把测法留下。
**⑤扩张链不变**：watch3 round6 18:44Z 仍 `war / Blocked=G0+G4+G6 / newSighting=none / anchor=83409813`
⇒ 6 轮连续无新目击，P-A/P-B 判据仍按原锚有效；G3 继续不在列。

### R259（10-04 02:55Z，本会话）计量诚实性入矩阵（§19），并撤掉我自己"G4 本会话内可验"的暗示
`gateNetFlow` 18:52 与 18:54 **逐字节相同**（`{4.548085573674993, -0.6350940881608296}`），其间 watch3 round7 tick 已 83406484→83406684（+200）。
最合理解释是 **Memory 端点 flush 门控**（我此前为 `ws`/`bk` 记过同一条），而不是写者停：慢仪输入 27.9/拍 vs 现值 4.55 必然要动。
⇒ 当场撤一条我会顺手写下的话：**R258 的"≈9~13 分钟带"在本会话内无法证实**，它只能交给 `posture-exit3.log` 的 `Blocked=` 在往后一小时记录；
凡"读数两次相同"先问 flush 节奏再问机制，别急着否证趋势（这条也进了矩阵 §19b）。
矩阵 §19 新角记的是：#112 的三条证据与修复状态（③未修）、#104 旧标签作废与"接写者反而引入缺陷"的理由、以及上面 (a)(b) 两条读数护栏。

### R260（10-04 02:58Z，本会话）#112 的现场量级到手：线上 recoveryRate≈21.9，且那两个键在线上根本没被定义过
一发带 mark 的 console（`mark=R260-A1` 回读校验命中，非对端结果；读的是**未部署的旧二进制**的 heap）：
`tick=83406770`、`boot=82414952`、`__autoRecoveredFailures=612`、`__totalFailuresDetected=28`、`recoveryActionTable.size=3`，
而 **`__perturbationCount` 与 `__totalRecoveryTime` 从 JSON 里消失** ⇒ 它们是 `undefined`（`JSON.stringify` 会丢掉 undefined 值）。
**①②两半当场证实**：
- ②的"零写者"不再只是读码结论——**线上从未写过这两个键** ⇒ `?? 0` 恒 0 ⇒ `autonomy-metrics.ts:185` 每一次都走"无扰动=满分"那支（15 分白送）。
- ①的虚高有了现场倍率：`autoRecovered / detected = 612 / 28 ≈ 21.9` ⇒ `recoveryRate` 远大于 1 ⇒ `failureRecoveryScore` 长期贴 100（那 25 分不反映恢复能力）。
  结构推算给的单条记录重复率是 ≈50（保留 500 拍 ÷ interval 10），现场整段累计比值 21.9——**两者不必相等**：
  分母也在涨、表里当下只有 3 条记录、且成功记录并非同时在场。所以现场数是"综合结果"，推算数是"单条上限"，不冲突但也不互证。
- ⚠️一条我**不越口**的边界：`boot` 来自 `Memory.kernel.bootTick`，跨部署存活，而那两个计数器住 heap（换码即清）⇒
  **不能用 `tick-boot` 当 heap 寿命**，因此我不给"每次成功被计了几次"的现场精确解，只把 612/28 当既成读数入账。
**③部署后怎么复核（免费判据，不必再造条件）**：换码批落地后同一表达式应出现 `perturb`/`recTime` **有值**、
且 `autoRecovered` 的增长率按"每次成功 +1"走；这两条只要读到一次即算 `EXERCISED`，读不到就是"未上线/该键从未建过"第三态，按我的规矩分开记。

### 巡检 R126（10-03 19:4xZ UTC，不占 R 号）**批次已推并已部署（boot=83407220，线上 sha `d2f0b0cd00ad` == 本地 dist）⇒ #93 第一次被用就改掉一个量级：幼房 RCL5→RCL6 真实需求 = `1,215,000`（RCL4 的 3 倍）⇒ 下一级是 3~6 天不是几小时**；同时我自己"G4 于 83407200~83407500 自绿"的预约**落空（Σ=4.313）**，而打断它的正是我 R125 写下的机制（当窗 `spawned:2400`＝48/拍的部署重建波）

·**部署取证三条独立证据（不用 `bootTick`）**：①`git status -sb` 出 `## dev...origin/dev`、`HEAD==origin/dev==1bcfae341d`（上轮 ahead=145）；②**boot 标记** `kernel.stats.energyLedger.tick=83407220`（该键只在 `global-cache.ts:806-809` 创建对象时赋值 ⇒ 它=heap 清空时刻，我 R114 读死过的性质第一次派上用场）；③`check-code.mjs` ⇒ 线上 `modules:{main:<786453B sha=d2f0b0cd00ad>}` 两路一致且 **== 本地 dist**（`ls` 788,280 **bytes** vs 工具 786,453 **chars** 是同一文件，别再读成"有人换码"）。⇒ **#85 的 A/B 窗自然结束（已 PASS，不受损）**；#102/#99/#96/#105/#93/#94 与 **#89** 同时上线——**"更早授权进攻性战争"（warPatience 8000→5000、minDwell 1400→1000）从这一拍起是既成事实**，#90 的观察项从此有部署后样本。
·**仪表翻转即判效**：我 R122 写的"键不存在=未上线"两个键现在都在——`deathByCause={natural:9,combat:0,recycled:0}`、`controllerProgressTotalSeen=1,215,000` ⇒ **这两键从此可当部署指纹用**。
·**#93 第一次被用就改数量级**：`controllerProgressSeen=70,051 / total=1,215,000 / lvl=5` ⇒ RCL6 需要 **1,215,000 = RCL4 那 405,000 的 3.0 倍**；剩余 1,144,949，按今夜速率带 8.00~16.00 进度/拍 ⇒ **≈71,600~143,000 拍 = 52~183 小时 ⇒ 中位口径 3~6 天**。⇒ 凡"幼房再升一级就能…"的推理都要按这个尺度重写（今夜之前我们连分母都读不到，只能引 `tower-defense.ts:26` 的注释）。免费复证挂上：**RCL6 那一拍该键要跳到下一档**，读一次即证"它真跟随分母"而非一次巧合。
·**我的预约 MISS、机制 HOLD（分开记账）**：预约"Σ≥5 于 ≈83407200~83407500"；现读 `gateNetFlow={4.699, −0.386}` ⇒ **Σ=4.313<5**（watch3 round12 同拍 `Blocked=G0+G4+G6`）⇒ 落空。原因正是我 R125 写下的那条：核心房当窗 `bk={harvested:980, **spawned:2400**, imported:1000}` ⇒ 孵化 48/拍（部署后重建编制），而我当时就写"输入历来守不住、空支出窗抬高 nf"。⇒ **数字错、模型没错**（对端 R255 已用两位小数复验反解式，错的是把 I 当常量）；另"boot 后 ~400 拍不采信输入"同窗生效。**下一版预约改条件式**："若 I_total 在 10 次更新内守住 ≥12/拍 ⇒ ≈3,000 拍内过 5"，并把**部署/孵化波列为显式否证条件**（这次就是它打断的）。
·**部署后的新基线**：#61 的 `spawnRejects` 在 Memory 里存活（`budget` 仍 2834），`reserveOnly +237 / degradeGateClosed +238` ⇒ **⊆ 成立**，速率 0.40/拍（部署前 0.227，翻倍，与 TTL 波+队列重建同因，暂不立案）；`buyTried` 第 6 次读数仍 0（部署后需求表是否重发布要看下轮 `publishedAt`，我这次没读）；`tier=tight@83387005` 未变；300 拍环 CPU avg 12.9/max 26.5、`skippedPerTick 18.7`（部署后形状，非新缺陷）、`errorsPerTick=0`；war 活锚仍 **83409813**（watch3 现算；watch2 19:35 又喊了一次 STUCK，仍按旧字面量作废）。
·**边界**：零 src、零 push、零 build（**部署不是我做的，我只取证**）、零 console；探针 observe×1 + peek×3 + check-code×1。**R127**：①Σ 是否过 5（先读同窗 `bk` 四个消费键再谈输入）；②RCL6 那一跳 `controllerProgressTotalSeen` 是否变档；③某次目击后 `deathByCause.combat` 是否 +1（判据挂事件不挂时间）；④`dangerUntil=83415805` 到点后幼房 op 去向；⑤war 锚。§3.5 属人 7 项未动；**A/B/C 那笔已执行，后续差分一律从"含 #102/#89/#93/#94/#96/#99/#105 的线上"重算**。

### R261（10-04 04:38Z，本会话）批已上线并第一次拿到 EXERCISED；一次 13 拍的入侵把 #92/#108 量化到底，同时我撤两条自己起的疑
**①部署链（本会话唯一一次走完）**：`git fetch` 后 `behind=0` 才推 ⇒ `3b7d7a3..1bcfae3`，**149 笔**；pre-push 跑完整门禁（vitest + `tsc --noEmit` + rollup）；
CI run `37147430349` **exit 0**；线上 `modules:{main:<786453B sha=d2f0b0cd00ad>}` **与本地 dist 逐字节相等**（无参与 `?shard=shard3` 两处一致）
⇒ "生效"而非"已提交待构建"。**对端未提交的 `.gitignore` 与未跟踪 L0 文档没有被带走**。
**②R255/R258 的模型被独立仪器兑现**：watch3 round14 起 `Blocked` 从 `G0+G4+G6` 变成 **`G0+G6`** ⇒ **G4 自绿**，
方向与我给的"Σ 按 `n=ln((I−门槛)/(I−Σ))/ln(1−α)` 收敛"一致；但**到达时刻比我 19:52 的"9~13 分钟带"晚**（round13 19:55 仍红、round14 20:05 才绿），
⇒ 那条带的错误不在公式而在**我把 flush 门控的采样当成"更新次数=1"**（R259 记过同一条，这次是它的代价现场）。
**③P-A/P-B 有答案：尾税会整段重置**。`20:05:36Z ANCHOR-MOVED：83404813 → 83407782 ⇒ 新 EXIT_TICK=83412782`（第三次重置）。
**④一次真实入侵的完整事件迹（这是今天最有价值的战/竞读数，全部来自已上线仪器）**：
`83407782 TowerVolley W37S58 ×5`（我的塔在打）→ `83407784 WarPlanCreated W37S58 d=[0,43.7]` →
`83407790 WarPlanCreated tac-W37S58-83407784 d=[0,50]` → `83407791 warIntelLost{room:W37S58}` → **`83407795 EnemyCleared`** ⇒ **全程 13 拍**。
之后环内每一条 `CreepDeath` 尾标都是 `1`（自然死亡），且线上 `deathByCause={natural:31,combat:0,recycled:0}` ⇒ **零战损**。
⇒ **#92 由"推算 500× 放大"升为"现场一次"**：13 拍、零战损、已 EnemyCleared，换到 **5,000 拍扩张税**（20:25 还剩 4,698 拍 ⇒ 按拍长带 ≈4.0~6.0 小时）。
⇒ **#108 的代价也被具体化**：`warIntelLost` 与 `deathByCause` 都不带"是谁"，房级键 `lastHostileAt` 只记房不记人 ⇒ 按人归因在此完全缺席。
**⑤我自己撤回两条疑（都撤在写进判据之前）**：
- `towersSeen:0` **不是丢失**：源码注释写明它是"进去要拆几座塔"，A5 只产防御型目标（自有房/远矿房），自家房本无从谈起——那 5 发 TowerVolley 是**我的塔在打进来的人**。
- `warPlan.squadSize=9` 与 `a5ForceReq.total=0` 并存 **不是矛盾、是设计**：`war-planning-system.ts:565-575` 对
  `defensiveOwnTarget`（非进攻 + 目标房 controller.my）**显式清零编队需求**，注释里带着旧事故（编队从未出击即被回收、自有房反被拉进黑名单）。
  ⇒ **#101 从"观察项·疑似停滞"改判为"设计如此"**；残留只是**命名**：`squadSize` 存的是清零前的需求合计，容易被下一轮再读成停滞。
  ⚠️我一度要按"零调用者"记 `decidePhase` —— 搜 `decidePhase(` 无命中**包括定义行本身也没命中** ⇒ 是函数名与我猜的不符，**不构成任何证据**（同"搜符号名不搜调用形状"那条老错）。
**⑥两台仪器的诚实状态**：`kernel.expectations={tick:83408287,violations:[],e3:{}}` ⇒ 换码把 E7 的 `lastProgressTick` 播种回 boot，
`noProgressAge>5000` 尚未到 ⇒ **空违例是"未到"不是 PASS**（判据留了第三态才对得上）。
`exercised-112-watch.sh` **9/9 轮全部"读回超时"**（而手工同形状一发秒回 `perturb:0`）⇒ 是与对端撞 `__evalResult`，**已从判据链撤下并停进程**；
#112 的最低档 EXERCISED 靠那一发手工读数成立（`__perturbationCount` 从"键不存在"变成"=0 有定义"⇒ 我新加的写语句在线上被执行过，旧二进制按构造做不到），
第三档（随成功单调 +1）改挂到"下一次有真实成功恢复时手工读一次"，不再交给争用中的轮询器。
**⑦下一轮的第一读**：`posture-exit3.log` 尾部（看 EXIT_TICK=83412782 到点时 posture 是否离开 war）＋ `kernel.stats.deathByCause.combat` 是否仍 0。
G6（14.5 vs 12.00/拍，#50）现在成了扩张链上**唯一还红的非自达闸**。

### R262（10-04 04:43Z，本会话）换码批的其余四台仪器全部 EXERCISED，三条立案当场拿到实数
决策记录本身开始带条件字符串 ⇒ `kernel.expansionDashboard.failedGates` 现读：
`G0: posture expansionAllowed(v=false|posture.expansionAllowed === true)`、`G6: CPU tier(v=tight|tier ≤ comfortable)`，
`Readiness=NOT_READY / Pressure=HIGH(0.68) / Budget=356074/962359 / Candidates=12(Q=3,R=6,U=3) / Plans=5 active, 4 waiting / Top=W37S56(WAITING_EXECUTION)`，
`kernel.capacity={tier:"tight", since:83387005, upgradeTicks:0}`。⇒ **G4 已从决策记录里消失**（与 watch3 独立同向），扩张现在只挡在
"战争姿态"与"CPU 档位"两项上，而候选与计划都在队列里等着。

**①#103 由推断升为现场证实，且带原因与次数**（`kernel.stats.recoveryRejections`，#105 那台跨部署仪器）：
`defense_response:non_retryable ×5`、`logistics_fix ×3`、`energy_redirect ×2`，**三条的 lastReason 全是 `"room memory not found: global"`**。
代码侧对应 `recovery-execution-system.ts:314/370/425/665/730/807` —— 六个下发动作各自先按房名取 room memory，
帝国级节点带的是字面量 `"global"` ⇒ **每种动作都在同一个 guard 上死掉**，且被标成 `non_retryable`（不再重试）。
⇒ 一个 boot 段内 10 次"检测到了、动作发不出去"。修法属人（要么把帝国级节点解析成真实 sponsor 房，要么给 global 一条专门通道），
⚠️`non_retryable` 这一标会让"同一问题永不再试"，改时要一并核重试语义。

**②#99 的战争漏斗第一次给出出口分布**：`intelEntries:7 → notFact:1 → unowned:6 → candidates:0 → plans:0`，另有 `noThreats:1`。
⇒ 7 条情报里 6 条过了"非我方"这关却**没有任何一条成为候选**，而当前唯一记录的拒因只有 `noThreats:1` ⇒ 差额 5 条**落在哪一格还没读我的分桶实现**
（不许把"桶里没有"读成"没发生"，这是我记过的截断/键序类错）。⇒ #100（只防不攻）第一次有了可定位的入口。

**③#111 的根因被这台账本自己的判据钉死，且两房不同因**（`kernel.stats.roadBuild`）：
- `W36S58`：`calls 1848 → outOfRange 1399（76%）`，其中 `near 176 / mid 635 / far 588` ⇒ 按 `road-build.ts` 自己的边界
  （≤5 放宽射程即可、6–10 同走廊铺错段、≥11 根本在另一条线上）**87% 的落空在 6 格外**；`noEnergy 431（23%）`、`noWork 0`。
  ⇒ 情形①「落点与通勤线不相交」是主因，**不是**"没派编制"（noWork=0 直接否证）也不是"没能量"（只占 23%）。
- `W37S57`：`calls 926 → noEnergy 764（82%）`、`outOfRange 161` ⇒ **同帝国另一间房的主因是③有力气没能量**。
⇒ 结论要按房下：任何"一刀切放宽施工射程"或"一刀切加车道"都会错一半；而这正是我给自己定的"取证在前、处置在后"的理由。
- 另一条变化：`built 18 / roadsBuilt 16 / roadSitesPending 16 / roadProgressSum 944` ⇒ 与 2026-09-23 那次"建成道路恒为 0"相比**现在真的在建成**，
  缺陷形状已从"永远建不成"变成"铺错段、建成速率远低于铺设计"。

**④#96/#112 已记于 R261；#93/#94 的落盘键这次在 dashboard/capacity 侧可见**（`Budget`、`tier/since`），
但 `gclLevel/bucket` 的专门键仍需在 `--keys` 全列里定位一次才能宣布 EXERCISED ⇒ 不当已验。
**⑤本轮未动任何 src**（全在读与记）；e2e 首次对已部署的同一份码补跑，挂在后台。

### R263（10-04 04:45Z，本会话）#100 的缺口从"选靶链没接线"改指到**情报输入侧**——我先读反了一个谓词方向，当场纠
读 `war-planning-system.ts:305-330` 的真实走向（不是桶名）：
`intelEntries = queryRoomIntel().length` → 逐条
`if (!intelActionUsable(...)) notFact++ / continue` → **`if (!e.owner) unowned++ / continue`** → `if (e.owner === myUsername) mine++ / continue`
→ `if (e.kind !== "normal") notNormal++ / continue` → 否则 `candidates.push(...)`。
⇒ **`unowned` 是"被剔除"不是"过了筛"**：战争目标必须是**有主且非我方**的房，`!e.owner` 直接跳过。
第一版我把 R262 那句写成"6 条过了非我方这一关"，**方向读反**（同我记过的"引任何一把闸之前先读它那行的条件字符串"），当场纠在这里。

**于是漏斗没有残差，且结论换了位置**：`intelEntries 7 = notFact 1 + unowned 6`，`mine/notNormal = 0`，`candidates 0`，`plans 0`。
⇒ 帝国现在**手上没有任何"有主敌方房"的 fact 级情报**——`queryRoomIntel()` 给的 7 条全是无主房（远矿/中立观察对象）。
⇒ **#100 的缺口在情报输入侧**（没有对他人有主房做 fact 级侦察这条能力），**不是**选靶/授权/ponsor 链没接线：
那几级这次实测**按设计正确地把每一条都拒了**。`war-planning.ts:153` 也写明终局四项 `noInput|noThreats|noPlan|plans` 恰有一项为 1、
每条计数只在本 pass 内有效（每次 pass 从零计）⇒ 读到的 `warFunnel` 是**最后一趟 pass 的快照**，不是累计量，别拿它做跨拍差分。

顺带一条同类小事实（不当缺陷用）：这里读的 `Memory.kernel.warBlacklist` 在 `--keys kernel` 全列里**不存在** ⇒ 止损黑名单当前为空
（可能是"从未写入"也可能是"没有事件时不建对象"，两者都还不足以立案；要立案得先按 R254 那三条读码规矩来）。

**动作方向（属人，我不自批）**：要长出"竞争/作战"的攻击面，缺的第一步是**敌方有主房的 fact 级观察**（以及 #108 的按人归因域），
而不是去动选靶阈值——动阈值会在**没有候选**的前提下把"只防不攻"读成"已能攻"。

### 巡检 R127（10-03 20:4xZ UTC，不占 R 号）**G4 绿了而它自己的输入是负的**（Σ=**7.719** vs 同拍核心房 `nf=−14.12/拍`）⇒ "门比的是 τ 尺度均值，不是此刻收支"这一发最干净；**同时撤回我 R126 给预约落空找的解释**（单个 125/拍的孵化窗动不了 τ≈5,000 的积分器）；**#96 第一次在真事件上读数通过**（`{natural:33, combat:0, recycled:0}`，环含整场战斗 ⇒ 零战损是正确答案不是计数器坏）；战争锚第三次移动 **83412782**

·**第 7 次目击，形状与前六次逐字相同**：`EnemyInvasion@83407785 → EnemyCleared@83407795`＝**在场 10 拍**，6 塔 6 发；`ColonyStateChange [2,3]@83407785 / [3,2]@83407835` ⇒ **defense 段恰好 50 拍**（`defenseExitHysteresis=50` 第三次复证）；`WarPlanCreated` 两写者再现（战略 `r=W37S58 d=[0,43.7]`、战术 `r=tac-W37S58-83407784 d=[0,50]`）。**锚第三次移动**：`watch3` 现算 `anchor=83412782`，序列 83400412→83405220→83409813→**83412782**。⇒ **#90 不需要再攒样本**：目击间隔 380/1,995/≈2,600/≈3,000 拍全部 <5,000 ⇒ `threatRecent` 自 83397159 从未清零 ⇒ 扩张被零成本 10 拍骚扰无限期冻住，我方每次只烧塔里几百能量。⚠️**这不算 #89 的效果**：退出走 `threatWindow=5000`，`warPatience` 管进战 ⇒ #89 要等"下一次从 fortify 升 war"才看得见。
·**撤回我 R126 的归因（数字对、解释错）**：我说过预约落空是因为当窗 `spawned:2400`（48/拍）"打断"了爬升。**不成立**——同一拍本轮 `bk={harvested:970, **spawned:6250**, repaired:95}`＝孵化 **125/拍**，Σ 照样 4.313→**7.719**。⇒ 正确解释是**多小时均值还没积够**（17:4xZ Σ=−1.955，之后三小时输入均值为正才推上来），不是"某窗有支出"。⇒ **`bk` 单窗解释只对 `nf`（τ≈165 拍）有效，对 Σ（τ≈5,000 拍）无效，判 G4 别拿单窗去说它的走向**（两层差 30 倍）。
·**"绿而输入为负"的最干净样本**：Σ=7.719（`{W37S58:6.892, W38S56:0.827}`，watch3 round15 起 `Blocked=G0+G6`）对同拍核心房 `nf=−14.12/拍` ⇒ R117/R124 那型"回声"的极端版：**门绿是因为它记着过去三小时**。⇒ #88 的含义不变且更硬：**门槛 5 与"此刻收支"无关，它比的是 τ 尺度均值**；拿"现在绿了"去授权扩张＝拿过去的账做现在的决定（我不动门槛）。
·**#96 首次真事件读数＝通过**：`deathByCause={natural:33, combat:0, recycled:0}`（boot=83407220，≈1,160 拍内 natural 33 是部署后 TTL 潮，量级正常）；环覆盖 `83406378→83408423` **含整场战斗**且其间 deaths 全 `natural=1` ⇒ **"combat 保持 0"是正确答案**（我 R126 写死的挂事件判据在"无事件"分支上也算验过形状）。⇒ #90 缺的"持续战损"半边从今天起可测，但反例只能等不能造。`recycled` 不算战损（别并进 combat）。
·**#61 的 regime 摆动量级**：`budget +4 / reserveOnly +8 / degradeGateClosed +9` ⇒ ⊆ 成立（9 ≤ 12），**速率从 0.40/拍回落到 ≈0.009/拍**；四窗对照 `(0,+145)→(+51,0)→(+237,+8→)…` ⇒ **"预留掐人"的强度在几十倍之间摆 ⇒ 任何基于它写的请示都必须带"哪一窗"**。
·**其余**：`expansionAllowed=false`、`tier=tight@83387005`（部署 3 小时后仍未翻档，与 R188"翻档要驻留+采信输入"一致；`cpuRate.total` 本轮未读 ⇒ R128 补）；`errorsPerTick=0`；git `领先 3 / behind 0` ⇒ 无人再推码，部署仍是 83407220 那次。
·**边界**：零 src、零 push、零 build、零 console（对端 watch3 在飞、刚写 R262）；探针 observe×1 + `ring-dump`×1 + peek×1。**R128**：①Σ 是否守住（核心房 `nf` 继续为负则应回落，可反推均值）；②`cpuRate.total`+`tier/since` 的新基线真值；③是否再来目击（锚 83412782；`combat` 仍应 0）；④`dangerUntil=83415805` 到点后幼房 op 去向；⑤#61 只报 ⊆ 与增量。§3.5 属人 7 项未动。

### R265（10-04 04:52Z，本会话）仪器账收尾：#94/#93 现场 EXERCISED、#102 窗口内未见、并补一件"检测也要留身份"
**#94 现场 EXERCISED**：`kernel.strategy = {posture:"war", since:83397159, expansionAllowed:false, newRemoteOpsAllowed:true, warPressureTicks:0, gclLevel:5, bucket:10000}`
⇒ 决策那拍的 `gclLevel/bucket` 落了盘，`expansionAllowed=false` 现在可归因到合取项。顺带一条独立结论：`gclLevel:5 > 拥有房数` ⇒ **GCL 不是挡扩张的那一项**，
`posture:"war"` 才是（与 `failedGates` 里 `G0` 的自述条件字符串同向）。另 `warPressureTicks:0` 对 `posture:"war"` ⇒ **#92 的"零压力也打长仗"第一次有直接数**。
**#93 现场 EXERCISED（带条件）**：`rooms.W38S56.controllerProgressTotalSeen = 1,215,000`（正是 RCL6 的分母 ⇒ RCL 余量可直接算）；
而 `rooms.W37S58.controllerProgressSeen = 0` 且 `...TotalSeen` **不存在**。读写者即懂：`room-state.ts:99-105` 把 TotalSeen 的赋值放在
`if (controllerProgressSeen !== controllerProgress)` **分支里面** ⇒ 进度不变的房（RCL8 顶格）永远不建这个键 ⇒ **"缺键≠坏了"**，
这条按我自己的老规矩先证"被写过"再证"该房本来就不该有"。
**#102 窗口内未观测**：事件环跨度 83406402→83408462（2,060 拍）的类型普查里**没有 GateThreatUnchanged** ⇒ 只能说"本窗口没发生"，不能据此判它坏。
**顺带普查到的形状**：`AssignmentAssigned 236 / AssignmentExpired 182 / CreepDeath 59 / AccountingDrift 8 / TowerVolley 5 / WarPlanCreated 2 / ExpectationViolation 2 / ColonyStateChange 2 / ControllerDowngradeRisk 1(d=9991，RCL8 带内自救复证) / EnemyInvasion 1(d=[1,0,3,2]) / EnemyCleared 1 / L2Intake 1`。

**新立缺陷并当场修（#113，可观测性）**：`ExpectationViolation` 事件**只带总数**（`kernel.ts:598` 记 `[res.violations.length]`，限流后逐拍不重报），
而 `Memory.kernel.expectations.violations` 是**当前 pass 快照** ⇒ 我实测到的"83407125 那一发 8 条违例"**事后无法归因到 id**（现在 `violations:[]`）。
注释里"可读的违例明细始终留在 Memory"这句**只对当下为真**，不留历史。
修：`expectations.ts` 加纯函数 `mergeViolationTraces(prev, violations, tick, cap=24)`（按 id 累计 `seenAt/lastAt/count`，超容量淘汰 `lastAt` 最旧，畸形旧条目丢弃），
`kernel.ts` 在写快照处调用，落 `kernel.expectations.recent`；只增可读性，**不改任何判据、不新增消费者**（违例清单在 src 内仍无按 id 消费者）。
验证：`tsc` OK；新夹具 5 例 + `e7-e8-wiring` + `expectations` 共 **43 passed**；`tests/integration` **30/239 全绿**（与后台 e2e 并发跑的，
并发只会带来假红风险而非假绿，故这条通过可用）。**未推**（owner 授权的批次是 `1bcfae3`，这笔新改动要单独批准；且 e2e 正在用当前 dist）。

### R266（10-04 04:54Z，本会话）#114 立案：核算漂移在烧（|drift| 最大 1,554/窗），但"禁带病发展"这句话说的是一个不存在的闸
**①检测侧现场**：事件环跨度 83406558→83408545（≈1,990 拍）里 `AccountingDrift` **7 发**，两房都中：
`W38S56 d=[81,2] / [370,2] / [1166,2] / [1554,2] / [-188,2]`、`W37S58 d=[-436,2] / [222,2]`（`d=[drift, driftStreak]`）。
⇒ 恒等式（income/consumption/refunds 对池子差分）与物理池子最多差到 **1,554 能量/窗**。这台仪器是 09-28 那条
"先修核算再发展"留下的，现在**第一次现场量到它在响**。
**②判"来回摆 vs 单向漏记"的现成量**：`economy.ws = [Σdrift, ΣflowBalance, Σticks]`（`economy.ts:250` 注释写明就是为这个分别设计的，跨换码不清零）。
同段两次读数：核心房 `ws` 由 `[3139,10949,700]` → `[4069,17737,950]` ⇒ **Σdrift/ΣflowBalance ≈ 23%**，且两次都为**正**；
幼房 `[1975,2576,500]` → `[1548,4029,600]` ⇒ Σdrift/Σticks ≈ **2.6/拍**、同向。
⇒ 形状是**单向漏记**，不是两窗来回摆（来回摆的话 Σdrift 会被抵消回零）。但注意符号：单窗里既有 +1554 也有 −188 ⇒
"单向"只在滚动和的尺度上成立，**单窗级仍有双向**，所以这条只到"漏项方向为正"，不足以指认是哪个桶。
要指认得把逐桶差分对着 `bk` 全列做（我记过的老错：`towerSpent` 类"记在别的桶"就是这种凭空残差的来源）。
**③关键否证（这才是立案的理由）**：`grep drift` 在 `domain/strategy/`、`domain/expansion/`、`systems/empire/expansion/`、
`kernel/scheduler.ts` **零命中** ⇒ `drift` 只进 `room-profile.ts`（显示），`driftStreak` 只喂那一发事件。
⇒ **注释"（先修核算，禁带病发展）"承诺了一个不存在的闸**：漂移不拦扩张、不拦发展、不拦预算。
⇒ 与 #104/#106 同族但方向相反：那是"接上会引入缺陷"，这是"纸面承诺了拦截、实际只记账"。危害不是性能，是**读注释的人会以为有保护**。
**④三条出路（属人，我一条都没动）**：(a) 只把注释与事件语义改诚实（零行为变化，最便宜）；
(b) 真把漂移接成发展侧的闸（行为改动 ⇒ 扩张会更保守，且必须先有 ②的逐桶归因，否则是在噪声上设闸）；
(c) 先修核算本身（把 ±1,554/窗 的漏项按桶找出来），(b) 才有意义。
我的建议顺序是 (c) → (a) → 视情况 (b)，但 (b) 涉及改变扩张门槛，我不会自批。

### R267（10-04 04:58Z，本会话）#114 归因推进：我排除了两条假线索，剩下的嫌疑人是"入账那一拍 vs 池子动的那一拍"
**排除①（我自己的符号疑虑）**：`trackedPoolsOf` **含 `loose`**（`accounting.ts:196-205`：spawnExt+containers+storage+terminal+links+carry+towers+**loose**），
所以 `drift = Δtracked − flowBalance − Δloose + Δother` 里那一项是自洽的：
衰减时 `Δtracked=−X`、`looseDelta=−X` ⇒ 相消为 0；捡拾时 `Δtracked=0`、`Δloose=0` ⇒ 也是 0。
⇒ 我一度怀疑"loose 处理会把衰减算成 +X"，**读码否证了自己的读法**（注释与那条不变量测试都是对的）。
**排除②**：`industrialSpend` 缺失这个已知局限（`accounting.ts:262-266` 明写）**不会造成 drift**——工业池内部烧掉的能量在快照上表现为 0 而不是负 drift，
所以它不是 ±1,554 的来源（它是**另一条**已有的、按量级结案的账外消耗，任务 #15）。
**仍然成立的硬结论**：`drift`/`driftStreak` 不进 `domain/strategy/`、`domain/expansion/`、`systems/empire/expansion/`、`kernel/scheduler.ts` 任何一处 ⇒
**"先修核算，禁带病发展"没有实现为闸**，只实现为一发事件（#114 的立案理由不变）。
**剩下的嫌疑（缩小了但没有定罪）**：单窗 drift 在幼房是 `+81/+370/+1166/+1554/−188`、核心房 `−436/+222`，
且两房**窗边界本就错位**（R253：`economy.t` 相差 39~180 拍）⇒ 凡"计数器在某拍 bump、池子在另一拍动"或
"来源房与目标房各自按自己的窗记 `exported`/`imported`"，单窗里都会呈现为**与单笔交付同量级（1,000~2,000）的正负摆动** —— 量级完全对得上，方向也对得上（正负都有）。
⇒ 下一次的**定罪读法**（一次即可，不用长窗）：挑一发跨房交付，取交付前后同一房**相邻两拍**的 `池快照(pl) + bk 增量`，
看 `imported` 的 bump 与 `storage/containers` 的上涨是否同拍；若不同拍，drift 的正负号就会按窗边界翻转（可用 `ws` 的滚动和确认它**不**是单向漏记）。
⚠️在定罪之前，不碰容差（`driftFloor/driftRatio`）、不把 drift 接成任何闸。
**顺带一条小的文档漂移**：`tests/unit/economy/drift-identity.test.ts:4` 的立案注释仍写 `… − Δother`（`ba18a6b` 之前的旧符号），
代码已是 `+ Δother` ⇒ 夹具里 `other` 应为常量所以测试仍过，但**读测试的人会被带偏**（记一笔，不单独为它换码）。

### R269（10-04 05:01Z，本会话）#111 量到 throughput 与车道饱和；我自己的两个假设都被读码否证，剩下的解释是"热度化石走廊"
**差分实测**（同房间 `kernel.stats.roadBuild.W36S58`，20:43Z → 20:59Z，约 16 分钟 / 数百拍）：
`calls 1848→2178（+330）`、`outOfRange 1399→1552（+153）` 其中 **`far 588→709（+121）`、`mid +23`、`near +9`**、
`noEnergy 431→607（+176）`、`built 18→19（+1）`、`roadProgressSum 944→949（+5）`、**`roadsBuilt 16→16`、`roadSitesPending 16→16`**。
⇒ 吞吐 ≈ **1 次成功 build / 330 次尝试、16 分钟只涨 5 点进度、0 格建成、0 格被回收**；按 `progressTotal` 量级推，一格路要几十小时 ⇒ **实际等于永不建成**。
**饱和确认**：跨主房上限是 `CONFIG.remote.roadSitesPerOpTotal = 20`（**全帝国**待建 road 求和，`getRemoteRoadSiteTotal`；
`road-planner.ts:204-212` 明写"车道已满不是跳过本房的理由 —— 越满越要先扫，预算判定挪到清扫之后"）。
现读 `W36S58 pending 16 + W37S57 pending 5 = 21 ≥ 20` ⇒ **车道已被占死，任何新落点都铺不出去**，而清扫每轮都在跑却清不掉这些格。
**我否证了自己的两个假设（都写在案里，免得下轮重复走）**：
1. ❌"16 个 pending 是 09-28 之前的化石、还没到 `roadStaleReapTicks=2000`" —— 回收判据是"**不在被走过的线上**且冻满 2000 拍"，
   而 `far +121` 说明它们事实上不在当前通勤线上，那它们早该被扫；没被扫 ⇒ 是**判据认为它们"在线上"**。
2. ❌"`op.roadHeat` 永不过期" —— `mergeWalkHeat` 每 `roadHeatMergeTicks=500` 拍做 `decay=0.7` 并只留 `roadHeatCap=96` 个最热格，
   所以热度**会**遗忘；而且合并闸带了"本进程已跑满一个窗口"的护栏（`:267-277`，作者专门用来防"部署比窗口快 ⇒ 白扣一次遗忘"）。
**剩下的、与两次读数自洽的机制**：衰减是**相对**的、没有"每格最近被踩时刻"这种**绝对**新鲜度要求 ⇒
一次换线之后，旧走廊的格子靠多年攒下的热度基数**仍然排在前面**（仍进 `walkedHeatKeys`），
于是旧线上的 site 被判"在线上、不许回收"，而 hauler 现在走的是新线（`far` 桶持续增长正是这个形状）
⇒ **旧走廊化石同时挡住回收与新铺 ⇒ 全帝国车道 21/20 饱和 ⇒ 修路事实上停摆**。
**修法三条（我不自批，因为任一条都会改变"删谁的工地"的行为）**：
(i) 给 `op.roadHeat` 加**绝对新鲜度**（每格带 lastSeen，超过 K 个窗口没被踩就不算证据）—— 最贴根因，但 `roadHeat` 现在是 `Record<string, number>`，
要加一列时间戳是 **Memory schema 决定**（体积换正确性）；
(ii) 用已有账本做交叉判据：`outOfRangeFar` 连续占多数 ⇒ 视同"不在线上"直接回收 —— 不改 schema，但把删除权交给一个统计量；
(iii) 调 `roadHeatDecay`/`roadHeatCap` —— 最便宜也最像症状级修法，我**不建议**（同一族的"调阈值"我今晚已经否证过一次：#114 定罪前不碰容差）。
**判效已备好，不用再造条件**：动完之后只看三列 —— `roadSitesPending` 是否跌破 20、`near` 份额是否上升、
`roadsBuilt` 是否开始按分钟级增长；同时 `roadProgressSum` 的差分是现成的施工速率。
⚠️仍然不许：把 `UNDERFOOT_BUILD_RANGE_LIMIT` 放宽（`far +121` 表示差 11+ 格，放宽射程治不了它，反而会让 hauler 绕路）。

### R270（10-04 05:06Z，本会话）#114 归因：恒等式能逐位复现，但两台物理仪器对不上号——因此今晚"G4 绿了"这条要挂保留
**①恒等式不是坏的**：用同拍的 `pl=[trackedStart,trackedEnd,otherStart,otherEnd,looseDelta]` 与 `bk` 手算 `drift = Δtracked − (income − consumption + refunds) − Δloose + Δother`
- 幼房（t=83408718）：Δtracked = 76740−76596 = **+144**，`bk` income 980、consumption = spawned 1200 + upgraded 360 + repaired 12 + towerSpent 240 = **1812**
  ⇒ flowBalance = −832 ⇒ drift = 144 −(−832) = **+976** == 现读 `dr:976` **逐位吻合**；
- 核心房（t=83408679）：Δtracked = 935746−937682 = **−1936**，Δother = 4574−4524 = **+50**，
  income = harvested 980 + imported 1000 = 1980（**`pickedUp:152` 不算收入**，#40 之后的口径），consumption = spawned 1800 + towerSpent 1800 = 3600
  ⇒ flowBalance = −1620 ⇒ drift = −1936 + 1620 + 50 = **−266** == 现读 `dr:−266` **逐位吻合**。
  两处都要小心：`towerSpendWalls`/`towerSpendStructures` 是 `towerSpent` 的**子拆分**（加进去就重复计），`pickedUp` 已不入收入。
⇒ **drift 不是公式错，是"账与池确实不等"**：幼房账面说少 832，池子实际涨 144 ⇒ **有 976 能量进池而账面没有收入项**。

**②但 `ws` 的滚动读数触发了代码自己写的警语**：核心房 `ws = [−9133, 7871, 950]` ⇒ Σdrift −9,133（**−9.6/拍**）对 ΣflowBalance 7,871（8.3/拍）**同量级**，
而 `accounting.ts:390-395` 的明文规则是："**Σdrift 与 ΣflowBalance 同量级 ⇒ 单向漏记（此时 `nf`/G4 不可信，必须先修账再谈扩张）**"。
⇒ 直接含义：**今晚 G4 转绿所吃的那个输入（`nf`/`gateNetFlow`），按这个系统自己的判据属于"不可信"状态**。这条不能反过来用成"G4 是假的"——见 ③。

**③我自己拦住了这个结论：两台物理仪器方向不一致**
段 3 `se`（写者 `snapshot.storageEnergy`，读码定过）给出核心房 `83408055→83408705` 的 storage **上涨** 899,474→905,984 = **+6,510 / 650 拍 ≈ +10.0/拍**；
而 ②里 `pl` 的 Δtracked 在同一时间尺度上是 **负的**（−1936/窗）。`tracked` 含 spawnExt/containers/storage/terminal/links/carry/towers/loose，
所以两者不同号只有两种解释：**(a) 非 storage 的池（links/terminal/containers/carry）在那一窗大幅回落**，或 **(b) 两台仪器的窗端点根本不对齐**
（`pl` 是"最近一窗"的起止，econ-ring 是每 50 拍的采样，而我并没有 `pl` 的 t0/t1）。
⇒ 在 (a)/(b) 分辨之前，**既不能说 G4 是账面假象，也不能说它是实物流**。这条保留必须写在这里，因为它是今晚最容易被顺手夸大的一句结论。

**④下一次的单一分辨读法**（一次即可，无需 console）：取同一房的 `pl` 起止与 `ce`（carry 起止）+ 段 3 的 `se/cte/te`，
把 Δtracked 拆成 `Δse + Δcontainers + Δcarry + Δlinks + Δterminal + Δtowers`；
若拆出来的分项里非 storage 项确实回落 ⇒ (a)，drift 与实物**同号**、②的警语按字面成立（G4 输入不可信，须先修账）；
若拆完仍不同号 ⇒ 窗端点错位 (b)，改读法为"同一拍内取 `pl` 与 `se`，再等下一拍"，并顺手量 `econ` 与 ring 的采样相位差。
⚠️不许跳过这一步去动 `driftFloor/driftRatio` 或把 drift 接成闸（#114 的 (a) 出路仍是"先把注释与事件语义改诚实"）。

### R271（10-04 05:09Z，本会话）R270 的 (a)/(b) 分辨有了结果：drift 由"快池子在 50 拍窗内的时序错位"主导，不是收入项缺失；但我的探针自己有一处 0 是坏形状不是空池
一次带 mark 的 console（`mark=R271-A1`，回读命中；只读、零写操作），tick 83408775、窗 `t=83408729`：
`storage=905,586`、`terminal=10,110`、`links=0`、`towers=0`、`spawnExt=0`，`pl=[935746, 932500, 4574, 3374, 0]`，`dr=−1076`。

**①窗端点是接续的**：上一读（18:52 之后那次）的 `trackedEnd=935,746` **正好等于**本窗 `trackedStart=935,746`，`t` 从 83408679→83408729 ⇒ **50 拍窗**，
所以 `accounting.ts:390` 那句"端点接不上、不能做差分"在这一对读数上**不成立** ⇒ 端点差分可用（这是运气还是普遍？至少本对可用）。
**②drift 的量级对不上"收入缺项"这个解释**：本窗 Δtracked = 932,500 − 935,746 = **−3,246**（≈ −65/拍），Δother = **−1,200**，
而**同段 storage 几乎没动**（ring：`se` 906,076@83408655 → 905,984@83408705 → 905,586@83408775，≈ −0.7/拍）。
⇒ 那 −3,246 只能落在**其它 tracked 池**（spawn/extensions、towers、containers、carry）——恰是 `bk` 里同窗记着的 `spawned:1800`、`towerSpent:1800` 这类**快进快出**项。
恒等式反推也自洽：−1,076 = −3,246 − flowBalance − 0 + (−1,200) ⇒ flowBalance = **−3,370**，与"一窗里孵化 + 塔射 3,600"同量级。
⇒ 结论换成：**这是"计数器在意图那拍记账、池子在结算那拍动"的 50 拍窗内时序错位（measurement phase skew），不是一个没人记的桶**。
`ws` 之所以累积成 −9.6/拍的"同量级"读数，是这种错位的净偏置在滚动和里没抵消完——**它照样触发了警语，但警语指向的正确出路是"窗口长度/快池是否入 tracked"，而不是"再补一个收入桶"**。
⚠️这两个出路都会改变 G4 的输入口径 ⇒ 明确属人，我没动。

**③探针的坏形状（写下来，别让下一个人在这里翻车）**：`links/towers/spawnExt` 打回 **0** 不代表池子空——
`Game.rooms.<r>.towers/links/extensions` 在该求值上下文里可能是 `undefined`，`for (k in undefined)` 静默不循环 ⇒ 得到 0。
现场旁证：段 3 同拍 `ea=12,470/12,900`（spawn+extensions 能量）、此前实测塔内存 ~5,070，
而我这次算出的 tracked 与"storage+terminal+containers"之差 ≈ **14.9k** 恰与这两项同量级 ⇒ **0 是读法错，不是真空**。
⇒ 规矩复述：**新探针必须先证明自己能读到非零邻居**（同一次求值里打印 `Object.keys(r.towers||{}).length` 这类形状列），
   否则一个静默 0 会被当成物理事实——这正是 R270 里我差点犯的错。
**④对今晚扩张判断的最终表述**（替换 R270 里那句更模糊的保留）：G4 已绿，但它吃的输入在 50 拍窗尺度上被快池时序错位污染，
`ws` 的"同量级"警语因此成立；在把窗口长度或快池归属这两项**由人定下来**之前，不能把"G4 已过"当作可扩张的依据，也不能反过来宣布它是假象。

### R272（10-04 05:10Z，本会话）我把 #103 的说法改回来：那条"检测得到、发不出"是**已文档化的设计**，我今晚新看到的只是"拒因字符串说谎"
触发这次自纠的是项目记忆 §十一（"审计三次把『设计』报成『缺陷』，照做就是把修法变成破坏"）与任务 #19。核对文件头与守卫点之后：

**设计侧证据（早就写在代码里）**
- `recovery-execution-system.ts:19-25` 文件头明写：**"无房间维度的动作带 GLOBAL_ROOM：需要具体房才能行动的地方必须显式跳过，不能默认『买/建/孵』"**，
  并记下来历事故：房名一度按 `split(":")` 从 `targetFailureId` 位置解析，把**维度名当房名** ⇒ 按房查 storage 永远落空 ⇒ "缺能量才买"的缺口恒等于整条买入地板，
  实测 13:0x→13:4x credits 457,666 → 331,398，**买的是已有 90 万存量的能量**。
- `:232-235` 进一步写明"这一族里有**故意**的拒绝（`GLOBAL_ROOM` 显式跳过）……它们的动作今天**按构造**全部落在 GLOBAL_ROOM 分支上被跳过"。
⇒ 所以我 R262 那句"六种恢复动作全在 room-memory guard 上死掉 ⇒ 检测得到、动作发不出（能力缺口）"**把设计说成了缺陷**，撤回。
  真正的"只处理能量 / 帝国级需求没有可执行房"这条**已经**记在 #19，不是我今晚的新发现。

**今晚真正新增的两条（都成立，且都不是"补守卫"）**
1. **现场频次**：`stats.recoveryRejections`（#105 那台跨部署仪器）在一个 boot 段里记到
   `defense_response ×5 / logistics_fix ×3 / energy_redirect ×2 = 10 次`，全部 `non_retryable` ⇒ 设计在生效，但它生效得**很频繁且从此不再重试**，
   这本身就是"帝国级失败反复出现却无人处置"的量度（这才是 #110 该用的数，不是"发不出"）。
2. **拒因字符串说谎**：显式策略的拒因应当是 `:571` 那句 `"action has no room dimension (GLOBAL_ROOM)"`；
   而我现场读到的三条拒因全是 **`"room memory not found: global"`** —— 那是六个下发点各自的**防御性查房守卫**（`:314/370/425/665/730/807`）的话。
   ⇒ 说明**显式 GLOBAL_ROOM 检查只在其中一条路径上**，其余路径是靠"查不到房 memory"这条意外守卫把同一政策兜住的。
   后果不是错行为，而是**账本分不清"故意跳过"与"房名查找真的坏了"** —— 这两种情况在 `recoveryRejections` 里长同一个样。
   修法（小、纯可观测性，不改行为）：六个点统一在查房之前先判 `room === GLOBAL_ROOM` 并记 `:571` 那句 reason。
   ⚠️但这是 `src/` 改动 ⇒ 仍要随批推、且我不在你们对 #111/#50/#100 有决定之前偷偷塞进下一批。

**自我规矩再复述一遍**：**"没人做 X / X 恒被拒"先 grep 拒绝侧函数 + 文件头注释**，分清 无写者 / 被闸拒绝（设计）/ 配置切走 三种"没发生"；
我这轮就是靠项目记忆而不是靠现场读数把方向扳回来的——**跨渠道冗余第二次救了我**。

### R273（10-04 05:13Z，本会话）#103 那条"拒因字符串说谎"的最小修复落码（行为不变，只让账本分得清故意跳过与真坏）
一处机械改动覆盖六个下发点（`recovery-execution-system.ts` 的 `:314/370/425/665/730/807`，六处文本完全相同 ⇒ 一次 `allow_multiple` 全替换）：
`submitted:false` 的 reason 改为 `room === GLOBAL_ROOM || room === undefined ? "action has no room dimension (GLOBAL_ROOM)" : \`room memory not found: ${room}\``。
- **行为严格不变**：两条分支都返回 `submitted:false`，跳过与否、幂等记录、`non_retryable` 归类一个没动；变的只有 reason 字符串。
- **修的是可观测性**：此前 GLOBAL_ROOM 的动作在五条路径上是被"查不到房 memory"这条意外守卫兜住的，于是 `stats.recoveryRejections` 里
  **设计性跳过**与**房名查找真坏了**长得一模一样（我 R262 就是这么读错方向的）。现在两句话分开，#110 要用的"帝国级失败反复出现却无人处置"
  才有干净的计数可用。
- 验证：`tsc --noEmit` OK；`tests/unit/strategy` + `tests/unit/systems` 共 **61 files / 752 tests 全绿**；`tests/integration` **30/239 全绿**。
  `recovery-rejection-tally.test.ts` 里出现的旧字符串是**夹具输入**（喂给计数函数的一条 reason），不是对生产字符串的断言 ⇒ 不冲突、无需改。
- **仍未推**。⚠️和 #113 一样：这是共享分支上的本地提交（`behind=0`），**任何人下一次 push 都会把它带上线**。
  今晚未推的本地 src 提交累计三笔：`27a8a51`(#113 违例身份留痕)、本笔(#103 reason 分离)，加对端的混合提交一起排队。

### R276（10-04 05:19Z，本会话）R269 的"化石走廊"机制被我自己量的数**否证**了；新机制：热度不分角色
一次带 mark 的只读探针（`mark=R275-A3`，回读命中）把 16 个待建 road site 的位置与 `op.roadHeat` 的 96 个热格做切比雪夫距离：
`{n:16, k:96, at:83408725（50 拍前刚合并过 ⇒ 合并是活的）, tiles:96（96 格全部过 minWalks）,
 rows:[[3,25,215,3],[2,26,144,2],[3,30,90,0],[2,28,70,0],[5,31,195,0],[4,31,0,0],[5,29,45,0],[2,29,0,0]]}`
末列 = 该 site 到最近热格的距离。**每一个 site 都距热格 0–3 格**。
⇒ R269 的机制（"旧走廊凭多年热度基数仍算证据 ⇒ site 不在当前线上却不被回收"）**不成立**：site 就在热格旁边，
`nearEvidence` 判"在线上、不许回收"是**正确的**（这一半我之前推对了，但对的原因不是我以为的那个）。
⇒ 我上一条"化石 heat"的修法方向（给 `op.roadHeat` 加绝对新鲜度）**方向错**，不能修这个问题。

**新的、能同时解释两组读数的机制**：`recordTraffic`（`creeps/movement/traffic.ts:15-24`）在**任何** creep 每次成功移动后按 `creep.room.name` 记账，
调用点在 `movement/pathfinding.ts` 与 `movement/intent.ts` —— **不分角色**。所以一个远矿房的 `roadHeat` 混着
**通勤 hauler 的走廊** + **远矿 harvester 在矿位的站立格** + reserver/melee 的活动格。
于是：①铺路器按"最热"下 site ⇒ 热区可能落在**非 hauler** 的站位（本例 site 全挤在 x≈2–5、y≈25–31 一小片）；
②haul er 自己**几乎不经过那一小片** ⇒ 脚下建路时 `minRange` 常年 11+ ⇒ 账本里 `far +121` 主导、330 次尝试 1 次建成；
③而 `nearEvidence` 说"在线上"，回收不碰它 ⇒ 车道 16+5 ≥ 20 饱和。
⇒ 三组独立读数（site 到热格 0–3、haul er 到 site 11+、回收不动）在这一条机制下**同时成立**，
而在"化石 heat"下无法解释①（热格明明就在 site 旁边）。

**下一次定罪读法（一次即可，零改动）**：把 `op.roadHeat` 的热格按"谁踩的"拆开——
`recordTraffic` 是角色无关的单点写者 ⇒ 要么在写侧加一个 `role` 维度（或只让 hauler/carrier 记路用热度），
要么在读侧比对 `roomTraffic` 与 `hauler 实测路径`。判据：**只保留 hauler 的走廊做证据后，site 到热格距离分布应从 0–3 变成与 hauler 射程一致**，
而 `far` 桶应塌到 near 桶以下。
⇒ 修法方向随之改变：**不是热度新鲜度，而是热度归因（谁的脚步算数）**。这条仍是属人（会改变删/铺哪些格），但它现在有了**被两组读数共同约束**的落点。

**同轮撞到的两条探针错，都记下来当规矩用**：
①我在探针里写了 `CONFIG` ⇒ 服务端返回 `ReferenceError`（模块内符号在 console 不可见，这条我记过又犯）；
②修掉后表达式又超服务端大小上限（`expression size is too large`）⇒ **探针要按字符数预算写**，
   双假设解码改单假设（本例 x*50+y 与 `packPos` 一致且量出合理坐标，故够用）。

### R279（10-04 05:22Z，本会话）#111 再否证一条（我自己的第二条假设也死了）；现在排除清单比结论更有价值
先把我上一轮用来做几何判断的解码验掉：`domain/layout/types.ts:43` **`packPos(x,y)=x*50+y`**，`walk-heat` 沿用同键 ⇒ R275 的"site 距热格 0–3"**不是解码假象**，几何读数成立。

**新读数**（`mark=R278-A1`，同室在场 creep）：
`remoteHarvester (23,16) energy 5 / (16,40) energy 10`、`reserver (23,15)`、
`remoteHauler (9,33) carry 0`、`remoteHauler (18,24) carry 460`、`remoteHauler (14,29) carry 615`（各 1 个 WORK）。
另有世界锚点：sources `(22,15)`、`(15,41)`；containers `(23,16)`、`(16,40)`；controller `(22,14)`。

⇒ **R276 的机制（"铺路跟着非 hauler 的矿位站立格"）也被否证**：site 带在 **x≈2–5、y≈25–31**（房间西缘），
而矿位/容器/控制器全在 **x≈15–23**——两拨位置根本不重叠，站着不动的那几类 creep（harvester/reserver）在 x15–23，**不在** site 带附近。
⇒ 唯一可能建成 site 的就是 hauler；三台 hauler 此刻在 x9–18，即**位于"经济锚"与"西缘 site 带"之间**。
它们到西缘 site 的切比雪夫距离是 **4–7**，而脚下建路的闸是 `range < 4` ⇒ 现在这一刻**没有一台在射程内**。
**所以现在能说的是排除清单，不是结论**：
①❌ 化石热度（R275：site 紧挨热格 ⇒ "不在线上"不成立）
②❌ 非 hauler 站立格带偏铺路（R278：站立者在 x15–23，site 在 x2–5）
③❌ 没派编制 / 没 WORK（`noWork=0`）
④ 未定：为什么铺路器把 site 下到西缘、而 hauler 的回环停在 x9 一侧 ——
   候选有三个：**(a)** 通勤线确实穿过西缘出房口（去邻房/回主房），site 在线上但 hauler 每趟只在 x9–18 之间往返；
   **(b)** 热度是"曾经穿过西缘"的路线留下的（回到①的弱版本，但机制不是 cap 排序而是 hauler 改道）；
   **(c)** 铺路用的热区与 hauler 当前回环是**同一批格子但采样时刻错开**（我这一发是单时刻快照，不能区分）。
**唯一能分辨的测量（下一轮做，一次即可）**：把 `roomTraffic` 按角色拆开采样两拍——
最小做法是在 `recordTraffic` 旁挂一份 `role → packed → count` 的 heap 影子表（不影响任何决策，纯观测，和 #113/#103 同族），
两拍后读：若 **hauler 专属热区** 覆盖 x2–5 ⇒ 是 (c)/正常链推进，#111 不是缺陷；若 hauler 热区只到 x9 ⇒ 是 (a)/(b)，
**缺陷在"铺路器允许把 site 下到 hauler 回环之外"**，修法就变成"site 只能下在 hauler 专属热度上"（仍属人，但落点唯一）。
⚠️在此之前不许：加自动处置、放宽 `UNDERFOOT_BUILD_RANGE_LIMIT`、或按我任一旧假设去改 `roadHeat` 结构（我已经错过两次方向）。

### R277（10-04 05:31Z，本会话）e2e 对**已部署那份码**跑完：34 files / 72 tests 全绿（E2E_EXIT=0）
`tmp/observe/e2e-post-deploy.log`：`BUILD_EXIT=0` → `Test Files 34 passed (34)`、`Tests 72 passed (72)`、`Duration 2971s`、`E2E_EXIT=0`，
失败/异常与 V8 snapshot 版本错配都为零（那条 `rebuild-driver-snapshot.js not found` 只是设置告警，没导致崩）。
**口径要写准（这是本案的全部价值所在）**：这份 dist 是我在 20:4xZ 由 `1bcfae3` 建的，sha `d2f0b0cd00ad` **与线上逐字节相同**
⇒ 所以这轮 e2e 证的是"**线上正在跑的引擎级行为**"，**不含**我之后那两笔未推 src（`27a8a51` #113、`b20a67b` #103）——
那两笔目前只有 unit（43 例 + 全量 5487）与 integration（30/239）覆盖。
⇒ 今晚"三层测试"的账因此第一次齐了，但**分层归属要写清**：
线上码 = unit+integration+e2e 全绿；本地未推码 = unit+integration 绿、**e2e 未跑**（跑它要先重建 dist，
那会把"本地==线上"这台免费仪器作废，而它正是我刚用来解释 sha 的那件东西）。
另外一条环境事实（记下来免得下轮误判）：`npx vitest run`（全量 unit）现在会被 `tmp/observe/pending-62-files/creep-naming-determinism.test.ts`
这个**搬进 gitignored `tmp/` 的在途文件**拖成"1 file failed / 5487 tests 全过"（套件加载失败，非断言红）。
仓内测试是真绿的；那批文件是谁的、要不要归位，由对端或 owner 定，我不动。

### R278（10-04 05:33Z，本会话）#111 出现一条能同时解释两房读数的假设，而它要求我**撤掉自己上一条"两房不同因"**
把已在手的读数摆在一起（都是本会话量的，不是推的）：
- 差分桶：`calls +330` 里 `noEnergy +176（53%）`、`far +121（37%）`、`mid +23`、`near +9`、`built +1`、`progressSum +5`、`roadsBuilt 16→16`、`pending 16→16`；
- 在场快照（`mark=R278-A1`）：三台 `remoteHauler` 分别在 `(9,33) carry=0`、`(18,24) carry=460`、`(14,29) carry=615`，各 1 个 WORK；
  harvester `(23,16)/(16,40)`、reserver `(23,15)`；sources `(22,15)(15,41)`、containers `(23,16)(16,40)`、controller `(22,14)`；
- 几何（`mark=R275-A3`）：16 个待建 site 全在 **x≈2–5、y≈25–31**，且**全部距热格 0–3**。
⇒ **site 带在房间西缘、而满载的 hauler 在 x14–18**。一条腿上有货、另一条腿为空，而 `(9,33) carry=0` 说明**空腿确实往西缘走**。
`buildRoadSiteUnderfoot` 的早退顺序是**先判能再判人**（`remote-hauler.ts:47-56` 明写），所以走空腿经过 site 时只会记 `noEnergy`。

**这条假设（情形③的"落点方向"版）能同时解释三件前面解释不了的事**：
①为什么 `noEnergy` 占 53% 而 `noWork=0`；②为什么 site 距热格 0–3（**真的有人走**，走的正是空腿）；
③为什么 `roadsBuilt` 恒 16、进度和只涨 5 —— 有货的那条腿根本不经过西缘。
⇒ 于是 **R276 的邻房 `W37S57`（`noEnergy` 82%）与本案不是"两房不同因"，而是同一机制的两种占比**。
**我上一条把"同帝国两房不同因"当成硬结论，这里撤回**：那是把"哪个桶占多数"当成"哪种机制"，桶是症状、不是原因。

**它仍是假设，因为我没有直接观测"同一条腿的方向"**。可判的读法（零改码、一次即可）：
同一房内隔 10~20 拍取两次 `hauler → (位置, carry)` 样本，把 site 带（x≤6）与 carry>0 的样本对撞——
若 **site 带只被 carry=0 的腿经过** ⇒ 情形③坐实，修法落点是"施工预算"（让 hauler 留一小份能量专门用于脚下建路，或在满载腿经过的格上铺 site）；
若满载腿也经过 x2–5 却不建 ⇒ 回到 `far` 分支，说明是**落点与真实路径错位**，修法在铺路器。
⚠️在坐实之前照旧不许：放宽施工射程、给 E7 加处置、改 `roadHeat` 结构（这三条我各错过一次方向）。
候选修法"预留能量建路"会动**物流**（满载交付量下降），属排产决定 ⇒ 大概率仍要请示，但这次至少有了**一个能先做的判据**。

### R279（10-04 05:35Z，本会话）#111 由假设升为**实测**：空腿经过 site 带，满载腿往反方向走
两拍对撞（间隔 16 拍，`mark=S1`→`mark=S2`，同房 `W36S58` 在场 creep 的 `(role,x,y,carry)`）：
- S1 `t=83409171`：`remoteHauler (15,39) carry=650`（其余两台不在房内）+ harvester `(23,16)/(16,40)` + reserver `(23,15)`。
- S2 `t=83409187`：`remoteHauler (21,23) carry=650`、`remoteHauler (15,23) carry=0`、**`remoteHauler (5,31) carry=0`** + 同上两类。
⇒ 满载那台 16 拍里从 `(15,39)` 走到 `(21,23)`：**向东北走，远离 x≈2–5 的 site 带**；
而此刻在 site 带里出现的 `remoteHauler (5,31)` 正是 **carry=0** —— 与我 R278 假设的形状**逐字对上**（此前 R278-A1 也抓到 `(9,33) carry=0` 在西缘内侧）。
⇒ 情形③坐实为**落点与腿方向错配**：铺路证据用的是"任意 creep 的热度"，而 `buildRoadSiteUnderfoot` 早退顺序是先判能再判人，
所以 site 被下到**只有空腿经过**的格上 ⇒ 53% `noEnergy`、`noWork=0`、`built +1/330`、`roadsBuilt 16→16`、车道 21/20 饱和，全部一次解释。
⇒ 邻房 `W37S57`（82% `noEnergy`）是**同一机制的另一占比** —— 我上一条撤掉的"两房不同因"就此确认撤对了。

**修法落点随之唯一（仍属人，但不再是猜）**：铺路证据要按**载重状态**分腿 ——
让 `recordTraffic` 旁挂"carry>0 时才算的路用热度"（或给路用热度打载重标签），`nearEvidence` 只认**满载腿**经过的格。
这条比"预留能量建路"好：不动物流交付量、不改施工射程、不删任何已建路，只改变**未来 site 落在哪条腿上**。
⚠️但它仍会改变铺路结果（旧 site 由既有回收路径处理），且属排产口径 ⇒ 请示；
且**现有 16 个 site 不会因为这条修法自动变好**，要不要一并回收是另一个决定。
禁令继续有效：不放宽 `UNDERFOOT_BUILD_RANGE_LIMIT`（差 11+ 格不是射程问题）、不给 E7 加处置、不改 `roadHeat` 的衰减结构。
**成本提醒**：这是多文件改动（traffic + walk-heat + road-planner + Memory schema + 测试），本会话剩余轮次不足以做完并验证 ⇒ 只留规格不动码。

### R280（10-04 05:37Z，本会话）三分钟前我写"坐实"，第三发读数就把它削回"部分成立"——当场降级
新工具 `tmp/tools/official/creep-legs-sample.sh`（端到端跑通，mark 校验命中）第三发：
`t=83409218`，房内 5 只：`remoteHauler (1,28) carry=1000 WORK=1`、`remoteHauler (15,27) carry=500`、`remoteHauler (11,33) carry=410`、两台 harvester、reserver。
⇒ **一台满载（1000）的 hauler 正站在 site 带内**（x=1、y=28），而 site `(2,28)` 与它距离 = 1 < 4 ⇒ **此刻它有能量、有 WORK、在射程内**。
所以 R279 那句"site 带**只**被 carry=0 的空腿经过"**过强，撤回**。

**改回账本本身能撑住的表述**（差分 `calls +330`）：`noEnergy +176（53%）`、射程外 `far+mid+near = +153（46%）`、
`built +1` ⇒ **"在射程内且有能量"这件事每 ~330 次尝试只发生 ~1 次**。
三种腿向都存在（空腿带内、满载腿带内、满载腿在别处），但**带内有能量的时刻极稀** ⇒
"落点与腿方向错配"至多是**部分成因**；主症状是**任何腿在此刻都很少同时满足"有能量+在射程"**，
这与 `far 46%` 同样重要 —— 也就是说 R276 被否证的"路径/落点错位"分支**并没有被 R279 排除掉**。
⇒ **#111 回到"未定案"**，且现在缺的是**分布**不是猜测：单时刻快照 × 3 次不足以定因，
需要**连续采样**（同一房内按 5~10 拍节奏采 30 次，统计 `带内 × (carry>0|carry=0)` 的占比与 `far` 时刻的 carry 分布）。
工具已备好（`creep-legs-sample.sh <房> <mark>`），跑法与判据都在案里；在它跑出来之前，
"按载重分腿"与"落点重排"两条修法**都不该被批准**——我这次差点因为三条快照就交出一条修法。
教训（同族第四次）：**单次/少次快照 ≠ 分布**；本案的账本桶已经给出分母（330 次尝试），任何机制解释必须同时容纳
`noEnergy 53%` 与 `far 46%` 两块，只解释一块的假设我今晚已有两个被推翻。

### R281（10-04 05:43Z，本会话）#111 第一次拿到**分布**（30 次 hauler 观测 / 15 次采样 / ~140 拍），它同时否定我 R279 与 R280 的各自一半
`tmp/observe/legs-w36s58.log`（工具 `creep-legs-sample.sh`，15 次 ×10 秒，tick 83409250→≈83409390）：
**带内(x≤6,y22–34) 3 次 = 10%**（其中**有载 2、空载 1**）；带外 27 次（有载 20、空载 7）；x 覆盖 2–24。

⇒ 三条结论，每条都有读数支撑：
1. **R279 "site 带只被空腿经过" 彻底死**：带内 3 次里 2 次是满载。
2. **我 R280 用来否证 R269 的那步也过头了**：我当时说"site 距热格 0–3 ⇒ 不是旧走廊"——但热度**包含空腿**（`recordTraffic` 角色/载重无关），
   所以"紧邻热格"与"落在**空腿**走廊上"完全可以同时成立。⇒ 化石/分腿这一族**没有被排除**，我 R280 的降级方向对、理由错。
3. **现在唯一同时容纳所有读数的机制**：hauler 的**满载**回流主要走 x9–24（20/27 在带外），
   而 16 个待建 site 集中在 **x1–6、y25–31 的西缘角落**；该角落的热度里**空腿也计一票** ⇒ 铺路器把 site 下到"会被走到、但走那时背包是空的"的格上，
   于是 `noEnergy 53%` + `far 46%` 两块**同时**被解释（满载者远离角落 ⇒ far；空载者路过角落 ⇒ noEnergy；带内满载仅 ~1/330 次 ⇒ built≈1）。

**这不还是"假设"**——它比前两条强的地方是：唯一同时满足 53%/46%/10% 三个数，且每条数字都可复核。
**可判下一步（成本极低）**：把 `roomTraffic` 按 `carry>0 / =0` 分两桶各采一轮（同一工具改 1 个字段），
判据：若满载桶的热格集中在 x9–24、空载桶才覆盖 x1–6 ⇒ 机制坐实，修法＝**路用热度只认满载腿**（或按满载腿加权）。
若两桶覆盖相似 ⇒ 回到"角落本就是必经之路、只是 site 排期过密"的另一分支（那要靠限速/回收，不是分腿）。
⚠️禁令不变：不放宽施工射程、不给 E7 加处置、不改 `roadHeat` 衰减结构；采完这轮之前**仍不批修法**。
方法账：本轮我先得出"样本数=0"，那是**解析器被转义骗了**（`\"` 与 shell 折叠），不是世界空 —— 全零先怀疑读法，这条今晚第 N 次救我。

### 巡检 R128（10-03 21:4xZ UTC，不占 R 号）**"绿"这次不是回声：Σ=8.357 且反解这 7,000 拍的输入均值 ≈+10.4/拍 > 5**（同拍核心房 `nf` 已从 −14.12 翻回 **+21.72** ⇒ **我 R127 那句"EMA>输入必回落"又被超车——"把瞬时读数当稳态"这一族第 6 次，我改口成可判形式**）；**#61 的计数器单位我读错了**（码证：每拍×每请求×每 spawn 累加 ⇒ 是"排队时长"不是"拒绝次数"，且同一对象里混两种单位）；**部署后 G6 新基线：缺口 2.93/拍、远矿三项 2.98/拍 ⇒ A 路线又回到 razor-thin（两侧数字都变大）**

·**判 Σ 只剩一种合法问法**：α=0.02/100 拍 ⇒ **半衰期 ≈3,400 拍**，一个 50 拍窗（哪怕孵化 125/拍）对 Σ 的权重 ≈0.3% ⇒ **别用某一拍的 `nf` 符号预测 Σ**（我 R127 就是这么错的，约 1 小时被超车）。反解今天 `−1.955@83406484 → 8.357@83409330` ⇒ 每次更新 +0.147 ⇒ `I ≈ Σ_avg + 7.35 ≈ +10.4/拍 > 5` ⇒ **这两三小时的绿是均值过线，不是回声**。⇒ #88 的措辞定型：**"Σ 高 ≠ 此刻有盈余"与"连续几小时 Σ 单调升 + I 反解 >5 = 真在攒"两种情形都出现过，判时必须分开**（分开的方法就两点：Σ 两点差分反解 I、看同窗 `bk` 里 `spawned/built/upgraded/towerSpent` 在不在）。⚠️也别把 +10.4 当稳态：今天 `nf` 实测在 **−15~+30** 摆、周期 1~2 小时。
·**`storageNearFull=false` 而 ratio=0.8995（差 502）** ⇒ 自 13:5xZ 起**第 4 次贴线不落**（唯一越界那次 <1,000 拍就退回去）⇒ "0.9 像天花板"继续加强；R122/R184 补那句"满仓 imminent"保持作废。
·**#61：单位纠正（数不改，说法改）**：`spawn-manager.ts:506` 的 `budget/reserveOnly` 在"每空闲 spawn × 每队列请求"循环里 **+1** ⇒ 单位是**请求-拍（累计等待）**；`:468` 的 `survivalBlock` 却按 `amount=skipped` 批量加 ⇒ **同一对象两种单位**。⇒ `reserveOnly +400/≈1,000 拍` 的正解是"约 400 个请求-拍的等待"（例：4 个排队请求 × 100 拍），**不是 400 次拒绝**；我前几轮"每 12 拍 1 次""0.009→0.40/拍"这类频次式说法**一律作废**，R127 那句"regime 摆动量级"也要重读为**大半是队列深度在摆**。⊆ 包含式本轮仍成立（406 ≤ 8+400，第 13 次）；而"能量够却被预留拒"那一发（`ea=1,405 ≥ body 1,400`、`rb/10=4,140`、只剩条件 3）是**单拍直读**，不受单位问题影响。
·**G6 新基线（#50 输入表更新）**：`cpuRate={windowTicks:2087, unsampledTicks:0, total:14.93}` ⇒ **缺口 2.93/拍**（门槛定值 12.00）；`byRole` 现读 `remoteHarvester 1.92 + remoteHauler 0.82 + reserver 0.24 = **2.98**` ⇒ **杠杆又"刚好够"，差 −0.05，与 R188 同形状但两侧都变大**。三条不变边界：`byRole` 只列前 10（榜外约 0.8/拍，截顶差额不是漏账也不当新证据）、`traffic-manager=3.11` 里的远矿份额仍未拆、代价侧还是 **19.9/拍远矿能量 + 120 段路 + 超额收缩会真退役现役 op 且不自撤销 + 翻档要 300 拍驻留**。⇒ **纯排产取舍，属人。**
·**事件与工具现场**：`deathByCause={natural:59, combat:0, recycled:0}`（≈1,000 拍 natural +26 = 部署后 TTL 潮；`combat` 仍 0 且无新目击 ⇒ 按"没有非寿终死亡时保持 0 是正确读数"解释）；锚仍 **83412782**（距 ≈3,430 拍 ⇒ 只写带 **≈00:1xZ~02:1xZ UTC**）。⚠️对端两条：`pgrep` 见**两个 `posture-exit-watch3` 实例**（14259/55858）写同一份日志 ⇒ 轮次会串；round23 `NOREAD` 是失败形状（疑 `/api/user/memory` 429；我 observe 也出现一次 25 秒未推进）。都只登记不动。
·**其余**：人口 42（27+15，核心 `hc=3`）、`Plans=5/4 waiting`、`Budget 357,656/966,636`、`skippedPerTick 13.2`（部署后偏高）、`errorsPerTick=0`、git `领先 20/behind 0`（无人再推码）。
·**边界**：零 src、零 push、零 build、零 console；探针 observe×1 + peek×2 + 码 grep×1。**R129**：①Σ 反解 I 是否仍 >5（掉回 <5 而 Σ 仍高 ⇒ 又进"回声段"，分开写）；②war 是否退（锚 83412782，注意双实例）；③`dangerUntil=83415805` 到点后幼房 op 去向；④#61 一律改报"排队时长"。§3.5 属人 7 项未动。

### R282（10-04 05:50Z，本会话）#111 机制由假设转为**测量成立**：满载/空载与 site 带的距离不对称（8 倍）
25 次采样、**50 次 hauler 观测**（`tmp/observe/legs2-w36s58.log`，工具 `creep-legs-sample.sh`）；
"距带"= 到 R275 实测 site 包围盒（x1–5、y25–31，注：该盒由当时列出的 8 行 site 推得，非全部 16 行）的切比雪夫距离：
- **满载 (carry>0)：n=40，平均距带 10.7 格，距带 ≤3 的份额 5%**
- **空载 (carry=0)：n=10，平均距带 4.2 格，距带 ≤3 的份额 40%**
⇒ 8 倍不对称，方向正是 R281 预测的那一侧：**待建 site 落在"空载腿"的走廊上，能施工的满载腿长期在 x9–24 之外**。
于是账本三块一次闭合：近带时通常无能量（`noEnergy 53%`）、满载时通常远（`far 46%`）、
两者同时满足的概率≈满载×近带≈5% ⇒ 每 ~330 次尝试才 1 次 `built`（实测 `built +1`）——**量级对得上，不是拟合出来的巧合**。

**证据等级与边界（必须一起读）**：单房、单向 ~40 分钟窗口；空载样本仅 10；site 盒用了我当时打印的前 8 行。
⇒ 结论强度：机制成立（不再是候选），但**修法仍未验证**——
"路用热度只认满载腿"会把 site 拉到 x9–24 一带，那条走廊是否**真的缺路**（可能那里早就有路，铺了是浪费）我还没测。
下一轮的判据：把满载热区与**已建成 road** 的格集合做差集，若差集非空 ⇒ 修法有地方可下；若满载热区基本已被路覆盖 ⇒
本案真正的问题是"该铺的路已经铺完了，剩下的 16 格是低价值尾巴"——那就不该改铺路证据，而是回收/停止铺它们。
**禁令**：在跑完这个差集之前，两条修法都别批（不放宽射程、不给 E7 加处置、不改 `roadHeat` 衰减结构，全部继续有效）。

### R284（10-04 05:52Z，本会话）#111 差集跑完：满载走廊**早就有路**，所以我上一条偏好的修法被这个读数挡下了
`mark=R283-A1`，t=83409461，同房 `W36S58`：**已建 road 16 格，x ∈ {6,9,10,11,11,15,16,16,17,20,21,22,23,24,24,24}**；
**待建 road site 16 格，x ∈ {1,1,1,2,2,2,2,3,3,3,3,4,4,5,5,6}**（全在西缘 x1–6）。
⇒ 满载流量所在的 x6–24 **已被路网覆盖**，待建的 16 格全在路网西端之外。
⇒ 所以 R282 里我准备的两个分支中，**第二个更可能是真的**："路用热度只认满载腿"并不会把 site 拉到 x9–24——**那里已经有路**（且会被铺路器自己的 `blockedKeys` 挡掉），
它只是会把 site 往**已建成位置**堆，属于无效改动。真正在发生的是：**主干已铺完，剩下西缘 x1–6 这段"出口尾巴"因为 hauler 到此处时通常空载而永远建不完**
（R282：空载时距带 4.2 格 / 40% 近带；满载时 10.7 格 / 5%）。
**于是修法候选换成两条，都需要人判：**
(A) **回收/停止铺西缘尾巴**（承认主干已够，把这 16 个 site 收掉、释放车道给别的房）——零风险但要先回答"这段路有没有价值"；
(B) **让 hauler 在空载腿保留少量能量施工**（例如留 200–300）——能动，但直接**降低每趟交付量**，属物流排产；
(C) 我之前偏好的"按载重分腿改证据来源" ⇒ **本读数不支持**，先搁置（若将来要做，理由也不是"site 落错腿"，而是"热度语义不该混入空载腿"这种命名/口径层面的事）。
**价值判断的缺口（下一轮补，一次即可）**：西缘 x1–6 是不是**出境口的必经段**——查出口方向与 hauler 去程路径即可。
若是必经段 ⇒ 这段路对**去程（空载）**有用（省载重无关的移动成本？路只降移动代价，与载重无关 ⇒ 有价值），那 (B) 才有意义；
若不是必经段 ⇒ (A) 直接收。⚠️在这一点定下来前不动铺路器、不动回收阈值。
禁令继续：不放宽施工射程、不给 E7 加处置、不改 `roadHeat` 结构。

---

### 巡检 R130（2026-10-03 23:0xZ，本会话）#115 立案：第三次扩张的 W38S58 趴窝——**spawn 工地 670 拍零工时**，而门禁正拿"缺 spawn"当拒绝理由

> 归并说明：**#115 尚未折进 §3 的 P0 列表**（并行会话今晚在同时改 §3/§4，避让编辑冲突），下一轮由先动 §3 的一方把它排进去；本节即出处。

**现象（全部现场读数，时刻 83410375→83410537，拍长实测 2.62s/拍）**
- 扩张时间线：`ExpansionOutcome W38S58 @83409757`（claim 成功）→ `ColonyStateChange [1→0]@83409845`、`[0→1]@83409865` ⇒ **`colonyStateSince=83409859` 起连续 ~650 拍停在 `recovery`**（编码 0=bootstrap/1=recovery/2=normal/3=defense，现读 `telemetry-collector.ts:799`）。RCL2 于 `lastRclChangeAt=83410102`，controller `472/45,000`。
- 房内结构（console B3/B6）：`constructedWall 11`、`controller 1`、`storage 1`（**23 能量**）；**无 spawn / extension / tower / container**。工地只有 `container 128/5,000 @31,14` 与 **`spawn 0/15,000 @28,28`**（本服 spawn 造价 15,000）。
- 房内 creep（两拍 83410515/83410537）：**`builder ×2`（body 14W4C12M，搬运容量 200）恒 `mode=acquire`、`store(ENERGY)=0`，且 assignment 完全相同 = 那个 container 工地**（`assignedAt=83410105` 432 拍未变、`leaseUntil=83410587` 在滚动）；`worker 3W3C3M e150 work`、`worker 2W1C2M e36 acquire`。**spawn 工地无任何 creep 指向。**
- 门禁自述（heap `globalThis.constructionSkips.rooms.W38S58`）：`p0-spawn 81`、`lane:p0-spawn 81`、`per-room-site-cap:container 86`、`tick-quota 5`。⇒ **系统把"缺 spawn"认成 P0 阻塞并据此拒绝一切新 site，而那个已经存在的 spawn 工地拿不到工时**——这不是"闸太严"，是闸与工时分配互相不认识。
- 仪器含义要更正一条：`spawnStarvationCount=689`（单调）判据在 `room-state.ts:362-369`＝`hasSurvivalPending && (ea<200 ‖ allSpawnsBusy)`；**对没有 spawn 的房按构造恒真**（`ea` 恒 0）。所以它此刻的含义是"**这房没有 spawn**"，不是"紧急 body 付不起"。它的消费方是 `empire-health-system.ts:373` ⇒ 会进 health/G3 输入，**不是纯观测**。

**为什么这条值得单独立案（而不是并入 #111）**
- 与 #111 是**同一物理形状的两条通道**：空载的腿 / 取不到能的 builder，都把工地停在半路。#115 只主张"自家新房 bootstrap"这一段，且它的后果是**扩张链整体**：这房现在正在供给 `G2 struggling=1` 与 `G3(core=1)`，`failedGates` 实测 `G0+G2+G3+G6`，`G0` 那行的条件串本轮是 `posture.expansionAllowed === true` 为假（`state=bootstrapping`）。⇒ **R129 的"下一次 claim 等 W38S58 长到 RCL5"要再降一级**：先要有个能用的 spawn。
- 规模：15,000 ÷ 现场建造吞吐（container 670 拍推 128 ⇒ 上界 ≈0.19/拍）≈ **79,000 拍 ≈ 2~3 天**，而且这上界还全给了 container——**spawn 的实际吞吐是 0**。

**两个候选限流器与预写判别（R131 一发 console 就够，不许临场发明）**
- **L1 工位黏性**：`domain/assignment/service.ts:156-181` 把 spawn 与"source 相邻的 container"都判 `priority=1 / maxWorkers=2`，同档 tie-break 是 D1「剩余量升序先完工一个」(`:268-300`) ⇒ container 剩 4,872 恒压 spawn 剩 15,000。**但两 builder 已占满 container 工位** ⇒ 严格走 `chooseTaskForRole` 时新一次选择本该轮到 spawn；现场是租约滚动而 `assignedAt` 不动 ⇒ 真嫌疑是"**续约绕过选择函数**"。⚠️**这一条我没读码证实（W1）**，未闭合前不许写成"assignment 缺陷"。
- **L2 取能地板**：`builder.ts:44-51` `builderStorageLimit` 按绝对阈值 `low=2,000` 给额，本房 storage 只有 23 ⇒ 限额 0（按设计拒绝）；房里没有已建成 container ⇒ 链尾只剩 `harvestSource()`，两拍连采都 `e0/acquire` ⇒ 交付环节确实断，**断在哪一步未测**。
- 判别：spawn 仍 0 而 container 在涨 ⇒ **L1**；两者都冻 ⇒ **L2**；spawn 已 >0 ⇒ #115 降级为"慢"而非"停"，按 #111 口径重读。
- 状态等级：**待验证**（现象=已验证，线上有出处；机制=两个候选都未定罪；修复=未设计，本会话不起手，多文件且属排产语义）。

**本轮其余读数（不另立案，只登记）**
- Σ=`kernel.gateNetFlow` 三房和 `6.424+1.305+0.003=7.732`（`economy.t=83410420`）对 R129 的 7.662@83410255 ⇒ Δ=+0.070/≈165 拍，按 α=0.02/100 拍反解 **I≈+9.8/拍**（R129 是 +4.4）。⚠️**两次都是单样本级反解，都不许当稳态**；#88 的措辞仍按 R128 那两种情形分开判。
- 满仓：`storageNearFull=false` 与同窗 `se=898,837`（ratio 0.8988）**本轮同向** ⇒ R129 那对矛盾按"值自己掉回来"解释（−2,472/≈1,100 拍 ≈ −2.2/拍）；"滞后 vs 回落"仍没用同拍双读区分过（本轮两读差 65 拍），但已无需区分。**"满仓 imminent"继续作废**（第 5 次贴线不落）。
- CPU：累计账 `window=3087t / total=15.24/拍` ⇒ 对 G6 门槛 12.00 **缺口 3.24/拍**；A 路线杠杆（remoteHarvester 1.95 + remoteHauler 0.85 + reserver≈0.3）≈ **2.8~3.1 ⇒ 仍差 0.1~0.4**。每房现读 `{W38S58:0.371, W37S58:3.956, W38S56:3.705}`。⚠️**§3.5 的 #50 框架本轮要换**：新房一旦有 spawn 就开始长编制，A 路线的取舍从"换不换"变成"**要不要在第三房开始花钱之前换**"。
- `dangerUntil` 住在 `rooms.W38S56.remoteOps.W38S55`（该 op `abandoned`，`stateSince=83405805`）＝`83415805`，距今 ≈5,300 拍；到期后 abandoned 车道能否被重新选中**未验**（`targeting.ts:196`、`remote-mining-manager.ts:301-308` 只证窗口内不选/不孵）。
- `spawnRejects` **绝对量**基线（今后一律记绝对值）：W38S56 `{survivalBlock 0, budget 2894, reserveOnly 7223, noDegrade 234, floor 0, degradeGateClosed 4074}`；W37S58/W38S58 **键不存在**（惰性创建）——单位仍是"请求-拍"。
- 事件：W38S56 `defense` 窗 83410025→83410075（第 9 次目击，50 拍）；`RecoveryEscalation global@83410352` 属 `mineral/terminal_trade` 旧条目（`attempts=3 terminal=true`），**不是新房的**。`deathByCause.combat` 本轮未读。
- 工具侧两条（省下轮一次撞墙）：本服 **`Room.lookFor()` 不存在**（`room.find(FIND_STRUCTURES)` 可用）；console 表达式（含包装）**约几百字符上限**，1,100 字符那发被 `expression size is too large` 拒 ⇒ 探针按 ≤500 字符起草。
- 边界：零 src、零 push、零 build；探针 `observe×1 + peek×4 + ring-dump×1 + console-eval×4（成功 3 发，全只读，mark=B2/B3/B5/B6）`，取探针前 pgrep 确认零在飞；git 领先 23 / behind 0 未变。

---

### 巡检 R131（2026-10-03 23:4xZ，本会话）#115 定罪到规则行：**D1「剩余量升序」对存在性阻塞工地没有豁免** ⇒ spawn 工地 1,380 拍零工时；同时核心房第一次真进满仓态，代价可标价了

**判别按 R130 预注册的分支跑完，没有临场发明**
- 现场读数：`spawn 0/15,000` 在 **83410489 / 83410515 / 83410537 / 83411233 / 83411242 五次恒 0**（跨 753 拍；工地自 `queuedAt=83409861` 已挂 ≈1,380 拍）；同窗 `container 128 → 288 /5,000`（+160/≈700 拍 ⇒ **≈0.23 进度/拍**）；两只 builder 仍同绑那个 container 工地、`assignedAt=83410105` **1,137 拍不动**，其中一只 `work e32` ⇒ **工时确实在交付，只是全给了 container**。
- ⇒ 命中预写判别「**spawn 仍 0 而 container 在涨 ⇒ L1**」。L2（取能地板：storage 只有 23 < `builderStorageLimit.low=2,000`、无已建成 container ⇒ 自采 + 200 载重来回走）**解释速率，不解释"哪个工地拿到工时"** ⇒ 降级为次要项。

**W1 闭合（读码，行级出处；两条都成立，而根因在第二条）**
1. **续约绕过选择函数**：`assignment-adapter.ts:36-70` 对现有 assignment 只要 `validateAssignmentRules` 过就 `leaseUntil = tick + leaseDuration` 直接返回，**不走 `chooseTaskForRole`**；`service.ts:216-235` 的失效条件只有"lease 过期 / revision 变 / target·source 消失"⇒ 工地对象还在就永远续 ⇒ 与"assignedAt 恒旧 + leaseUntil 滚动"逐字对上。
2. **但真根因更靠前**：`assignedAt=83410105` 恰是 RCL2 那次布局 revision 抬升（R130 读到 `revision:2`）⇒ **那一次是全新选择，仍然两只都选了 container**。因为 `service.ts:156-181` 把 spawn 与"source 相邻的 container"**同判 `priority=1 / maxWorkers=2`**（`isPriorityContainerSite:28-37`），同档 tie-break 是 D1「剩余量升序先完工一个」(`:268-300`) ⇒ `container 剩 4,872` 恒压 `spawn 剩 15,000`，而它那两个工位**正好把两只 builder 全吃掉**。
- 佐证"代码本来就该认这件事"：`:241-245` 的道路预留注释里已写明触发条件是"**无 critical（spawn/tower，priority≤1）缺口**"⇒ critical 缺口是既有概念，**却没有任何规则把一个 0 工时的 critical 工地优先喂上**；storage 抢占（`assignment-system.ts:239`）也帮不上——它只在 RCL4+ 缺 storage 时拽人，且豁免集本身就含 priority-container（本例那个 4,872 的源旁 container 正在豁免集里）。
- 状态等级：机制=**已验证（线上五次读数 + 行级读码）**；修复=**已设计，未实现，未排产顺序**。

**修复规格（本轮刻意不起手：共享核心 + 对端 #111 同域，须随批带走）**
- 最小改动：`chooseTaskForRole` 的候选排序里给 **`isCritical`（spawn/tower）开"存在性阻塞"豁免**——先按"critical 且 `assignedCreeps.length < maxWorkers`"取，其余仍走 D1。可选加强：续约时若存在"priority≤1 且 0 工时"的 build 任务，则**不续约、强制重选**（成本是重新排序的抖动，收益是租约不再能冻住错误选择）。
- 验收：unit 造 `spawn 剩 15,000` + `源旁 container 剩 4,872`、两只 builder 的夹具 ⇒ 断言其中一只落到 spawn；**反向实验**=关掉豁免必须恰好红一例、控制组全绿；integration + e2e 全量（钩子只跑 unit）。**不动任何阈值**（这不是"调参数"能解的，是排序语义缺一列）。
- 线上判效签名：`W38S58` 的 spawn 工地进度离开 0 **且** `assignedAt` 出现新值（只看到进度涨不够——container 本来就在校验通过的租约上爬）。

**#115 的代价从今天起可标价：核心房第一次真进满仓态**
- `rooms.W37S58.storageNearFull = **true**`（R130 及以前恒 false），`se=904,154` ⇒ **ratio 0.9041**，方向**在涨**（898,837@83410355 → 904,154@83411205 ⇒ **+5,317/≈850 拍 ≈ +6.3/拍**）⇒ 这次是"存不下"，不是 R113/R122 那种"标志翻了但库在掉"。**"满仓 imminent"这条我此前连续作废的预报，今天兑现了**（作废记录保留，别当我说错过）。
- 满仓的消费方（现读，全部第一次上线跑）：`demand.ts:432`（harvester 限档）、`:931-935`（upgrader 目标/`upgraderClamp` 改档）、`factory-manager.ts:58` 与 `industry.ts:459`（**只在 near-full 才动作**）、`power-creeps.ts:303`（发电前提）。
- 同框对照：新房只需 **15,000** 能量却零工时，`home=W38S58` 的人口 850 拍**一只没加**（仍 4），`spawnStarvationCount 689 → 1,533`（+844≈每拍 ⇒ R130 那条"无 spawn 的房按构造恒真"被二次证实）。⇒ **帝国正在"限采集"的同时把唯一能花钱的地方冻住**：15,000 ≈ 当前 +6.3/拍 累积的 ≈2,400 拍，而按现场 0.23/拍 的建造速率是 ≈65,000 拍。**这条比"G6 差 3.58/拍"更该进 §3.5 的请示正文。**
- 顺带把 §3.5 的 #50 框架再挪一格：满仓态下关远矿（A 路线）省的是 CPU，但**收入已经存不下了** ⇒ A 路线此刻的代价侧不再只是"19.9/拍能量"，还包括"把正在涨的盈余源头掐掉"——两列数都要摆，取舍仍属人。

**仪器口径纠正（新增一条，写死别再用错）**
- heap `globalThis.constructionSkips` 是 **100 拍窗口计数、每次上报后清零**（`construction-manager.ts:322-324` + `skipReportInterval=100`@`config/index.ts:339`）⇒ **R130 写的"`p0-spawn` 81 次"正确读法是"某一个 ≤100 拍窗口内 ≤81 次"**，不是累计；本轮 32→40（9 拍）是同一窗口的增长，而两轮之间 86→43 的"变小"**不是部署**（独立证据：`cpuRate` 窗口 3087→3987=+900 对 Δtick 850、`tier=tight@83387005` 未动）。

**其余读数（不另立案）**
- Σ=`kernel.gateNetFlow` 三房和 `6.213+2.387+(−0.034)=8.566` 对 R130 的 7.732 ⇒ Δ+0.834/≈870 拍、n≈8.7 ⇒ **I≈+12.9/拍**，且**与物理面同向**（storage 绝对量 +5,317/≈850 拍）⇒ 按 #88 的定型措辞属"连续多窗 Σ 单调升且 I>5 ⇒ 真在攒"那一型；**仍不是稳态**（I 是 EMA 的输入均值）。
- #61（单位=请求-拍，首次用绝对量基线做差分）：W38S56 `budget 2894→2936(+42) / reserveOnly 7223→7345(+122) / degradeGateClosed 4074→4236(+162)` ⇒ **⊆ 第十五次成立**（162 ≤ 164），≈**0.19 请求-拍/拍**；`noDegrade 234`、`floor 0`、`survivalBlock 0` 不动。
- 扩张闸集合未变：`failedGates=G0+G2+G3+G6`、`state=bootstrapping target=W38S58`、`claimSecure=false`、W38S58 `pressure 0.1→0.6`、`ea/ec=0`。⚠️R129/R130 那句"下一次 claim 等 RCL5"仍不作数——**现在连"能自孵"都没成立**。
- `dangerUntil=83415805`（`W38S56.remoteOps.W38S55`，op `abandoned`）到期的真实含义：`targeting.ts:190,196` ⇒ 到期后该房**重新可选**（注释明写"否则 abandoned 远矿永远重不开"），而 `shouldPauseOp:233-239` 仍按 abandoned 暂停 ⇒ **eligible≠selected，没有定时器会自己复活它**。同窗车道在动：`W38S56→W39S56` active→**abandoned**（挂起 2→0）、新开 `W38S56→W37S56`=active（W37S56 是 `WAITING_EXECUTION` 的下一个目标）；环内死亡 W39S56 reserver@83411207 / remoteHauler@83411213、W37S57 reserver@83411213。
- CPU：`window=3987t / total=15.58/拍` ⇒ 缺口 **3.58/拍**（R130 3.24）；A 路线杠杆 remoteHarvester 2.01 + remoteHauler 0.88 +（10 拍板 reserver 0.4）≈ **3.3**，仍差 ≈0.3；每房 `W38S58 0.371→0.636` ⇒ "第三房开始花钱"已在数上。人口 46（26/16/4）、`skippedPerTick 9.4`、`errorsPerTick 0`。
- 边界：**零 src、零 push、零 build、零 npm**；`observe×1 + peek×1 + console-eval×2`（mark=B7/B8，同值复采是为防我把读数记错，全只读）；取探针前 pgrep `console-eval/vitest/tsc/rollup` 全空（对端不在跑测试或构建，`dist/main.js` 仍是 20:41Z 本地产物）；git 领先 24 / behind 0。

---

### 巡检 R132（2026-10-04 01:1xZ，本会话）#115 修复落码（本地 `c58ff9d`，**未推送**）；R131 那条"真嫌疑=租约黏性"被下一发读数否证

**状态等级变化**：#115 从「机制已验证 / 修复未设计」→ **「已实现、已测试（unit+integration+e2e），未集成到线上」**。上线之后才允许写 `已验证`。

**一、机制收口（新证据把根因换了位置）**
- `spawn 0/15,000` 七次读数恒 0（83410489/515/537、83411233/242、83412168/177，跨 1,688 拍）；container 288→384（+96/≈926 拍）。
- **决定性一条**：两只 builder 的 `assignedAt` 由 R131 的 `83410105` 变成 **83411701 / 83411717** ⇒ 全新孵化、全新选择（与 revision 抬升无关），**仍双双落到源旁 container**。⇒ R131 写的"真嫌疑是续约绕过 `chooseTaskForRole`"**作为主因作废**（续约只起"冻住"作用）；根因是 **D1「同档剩余量升序」对存在性阻塞结构没有豁免列**。L2（取能地板）保留为**速率**成因，不是目标选择成因。

**二、改动本体（一个纯函数 + 一条同源谓词，零阈值改动）**
- `src/domain/assignment/service.ts`：新增 `isBlockingStructureType()`（spawn/tower），**与 `buildRoomTasks` 的 `isCritical` 判定同源共用**（本文件既有口径"判据写两处就会漏一处"）；`chooseTaskForRole` 在**同一 best priority 档内**先接阻塞结构，多个阻塞结构之间仍按剩余量升序（**D1 原意保留**）。
- 影响面：`ROLE_TASK_KINDS:75-83` ⇒ worker/harvester 只接 fill、upgrader 只接 upgrade，**只有 builder 接 build**；成熟房没有 spawn/tower 工地 ⇒ 改动按构造不进场。**不动 priority、maxWorkers、任何 CONFIG 阈值。**
- **反向实验（自改自测也要）**：把豁免短路成 `false` ⇒ **恰好 1 例转红** `expected 'src-c' to be 'spawn'`（正是线上那次选择），其余 49 例含 D1 控制组（storage 30,000 vs 站桩 container 5,000）全绿。第二例新用例（tower 5,000 vs spawn 15,000 先做 tower）**两种代码下都绿 ⇒ 只算既有守卫，不算本次改动的证明力**。
- 门禁：unit **389 files / 5,250 tests** 绿；integration **30 files / 239 tests** 绿；`npm run test:e2e`（含 `tsc --noEmit` + rollup）**退出码 0**。
- ⚠️取证自记两条缺陷：①`test:e2e` 的输出被我 `| tail -30` 后转后台 ⇒ 当场只拿到退出码；**计数在后台任务落盘文件里事后捞回来了：e2e = 34 files / 72 tests 全绿，Duration 2,752s（≈46 分钟），退出码 0** ⇒ 与对端 R277 在旧码上测得的 34/34、72/72 **同计数**，"无回归"这句现在是有出处的，不是推的。教训改写成：长任务**别接 `| tail`**，直接落日志文件再读；②console payload 我两发只看了开头就凭印象写数，改判为"重跑一发整块打印"，为此多花 2 发探针——**宁可重跑也不要把读数写错**。
- ⚠️**副作用要记账**：`test:e2e` 自带 build ⇒ 本地 `dist/main.js` 已在 08:53:50 重建，**"本地 dist==线上"这台免费仪器从现在起失效**（线上仍是旧码），下一轮第一件事是 `check-code` 认线上 sha。
- **未推送的理由（属人决策点）**：这批 push 会连带对端两笔未推 src（#113 `27a8a51`、#103 `b20a67b`）一起上线，且一次部署 = 清堆 + ≈400 拍 G6 税。**门禁已全绿，随时可推**；修复的价值窗口在下面这条 wave3 之前（`kernel.bootstrap.W38S58.until=83414757`，≈2,600 拍）。

**三、两条挂了多轮的旧账结案（都不是我此前给的任一种解释）**
- **"0.9 贴线不落"**：同房同时读到 `phase.storageEnergyPrev=898,744`（ratio 0.8987）与 `se=903,541`（0.9035）⇒ **库存在阈值上下逐拍穿越**，`storageNearFull` 时真时假都是正确读数。⇒ R129 那对"901,309 却 false"和 R131 的"true 却在跌"**不需要任何机制**（不是写节拍滞后、不是采样坏）。第 5/6 次"贴线不落"到此结案。
- **reserver"早逝却算寿终"是我读错常数**：`event-log.ts:284-286` 写死 `lifespan = reserver/claimer ? 600 : 1500`、`natural = age ≥ lifespan−60` ⇒ 环内 `age≈611~617` 的 reserver 死亡**确实按构造是寿终**。⇒ "战损被误分类"这个怀疑作废（第 N 次被"**阈值/常量也算读数**"救回来）。
- **方法撤一条**：α 与间隔读死（`netFlowGateAlpha=0.02`@`config/index.ts:506`、`empire-economy interval:100`@`:224`、`updateNetFlowEma prev+α(input−prev)`@`accounting.ts:311-318`）后，按 R128 的两点反解本轮得 **I≈+25.3/拍**，而**物理面**（两房 `rs` 差分）只有 **≈+7.5/拍**；且 `empire-economy` 会被 budget 跳过 ⇒ 两次读之间到底走了几步是**假设不是读数**。⇒ **"I 反解"自本轮起不作决策输入**，R128/R130/R131 引过的 +10.4 / +4.4 / +9.8 / +12.9 全部降级为"当时那发的产物"。Σ 本身照旧（它是 G4 的直接输入），跨仪器对照改用物理差分。**遗留线索（不立案）**：EMA 输入均值与物理累积之间 ≈17~18/拍 的缺口与长期挂着的"核心房 ≈25/拍残差"同族，可能同源。

**四、第一次有非自然死亡（#90 的账要改一行，§2 的战争行要加一条边界）**
- `deathByCause = {natural:152, **combat:3**, recycled:2}`（R128 {59,0,0}、R129 {85,0,1}）⇒ **combat 首次非零**。非自然事件 4 条：`83411678 W38S56(age 413)` + `83411924/83411963/83411985 W39S56(age 1115/1007/1377)`；口径 `natural=0 且 memory.recycle≠true ⇒ combat` ⇒ **+3 combat / +1 recycled 对齐**（⚠️环里哪条是 recycled 分不出，别给 recycled 指派房与角色）。
- 上下文：`W38S56.remoteOps.W39S56` `state=abandoned`、`stateSince=lastSeen=83410905`、`dangerUntil=83420905`（+10,000，只在威胁目击时写）⇒ **先有目击并弃道，之后 ≈1,000 拍里 3 只死在房里** ⇒ 弃道时留在里面的编制没被收干净。**本轮不立案**（要抓到 recyclePass 为什么没带走它们），但 §2「战争：线上无敌情可采」得加边界：**远房敌情这台仪器是空的**——环内 `EnemyInvasion/EnemyCleared/TowerVolley` 一条都没有，却死了 3 只。
- `W38S56→W39S56` 车道由此 active→abandoned；新开 `W38S56→W37S56`=active（`热度格=96 / 挂起=0 / W37S56 机会=645 无能量=533 无WORK=112 sites=0`）⇒ 与 **#111 同族，不双立案**。
- ⚠️只登记给对端的一条：`W37S57 roadsBuilt 38→34`、`W36S58 sites 16→15 且 progSum 989→839` ⇒ **已建路在掉、工地进度和被抹平**（衰减或拆除，本轮未归因）。

**五、满仓态的第二发（将 §3.5 的 #50/#88 措辞再收紧）**
- 语义读死：`demand.ts:431-433` 满仓 ⇒ `harvesterTarget=min(sources, minCount)`（**限采这一支真的会跑**）；`:928-935` 满仓解除升级上限那一支**要 `allowUpgrader` 为真才到得了**，而 RCL8 无降级风险时它为假 ⇒ **核心房现在只有"少采"生效、没有"多花"出口**。唯一能吃盈余的是幼房（W38S56 `se +5,714/≈900 拍 ≈ +6.3/拍`），而最该吃盈余的第三房被 #115 冻着。
- 新房仍冻结：`recovery` 未变、`ea/ec=0`、`spawnQueue=6/buildQueue=13`、home 人口**仍 4**（又 930 拍没增）、`spawnStarvationCount 1,533→2,437`。⚠️我一度把 `kernel.bootstrap.W38S58.until=83414757` 读成弃房期限，读码否证：`domain/expansion/bootstrap.ts:64-88` 的 `until` **只是每波冷却**（过期 ⇒ `waves+1` 再发一波），真正弃房只有 `ttd<阈值 且 hostileCount>0` ⇒ **83414757 是 wave3，不是止损**（当前 `waves=2`）。
- 闸集合未变 `G0+G2+G3+G6`；`Pressure` 标签 MEDIUM→**HIGH 而数值仍是 0.60** ⇒ 判读要连阈值一起读，别拿标签当斜率。
- CPU：`window=4887t / total=15.77/拍` ⇒ 缺口 **3.77/拍**（R131 3.58），A 路线杠杆 ≈**3.1**（remoteHarvester 2.03 + remoteHauler 0.87 + 榜上 reserver 0.2）⇒ **缺口在涨、杠杆没跟上**；每房 `{W38S58:0.381, W37S58:2.866, W38S56:2.163}`；人口 42（21/17/4）、`skippedPerTick 11.4`、`errorsPerTick 0`、`tier=tight@83387005`。
- #61（请求-拍）：`budget 2936→2958(+22) / reserveOnly 7345→7855(+510) / degradeGateClosed 4236→4767(+531)` ⇒ **⊆ 第十六次成立**（531 ≤ 532）；≈0.60/拍（R131 0.19）⇒ 仍是队列深度在摆。
- 边界：**动了 src**（本轮唯一一次，1 src + 1 test，本地 `c58ff9d`）、**零 push**、`.gitignore` 未 stage、提交后 `git stash list` 为空、钩子未跳过；探针 `observe×1 + peek×3 + ring-dump×1 + console-eval×4`；`check:docs` 通过；git 领先 26 / behind 0。

---

### 巡检 R133（2026-10-04 02:0xZ，本会话）**#115 自我降级**：现场证据支持的是"每次扩张多花 1~2 小时"，不是"停摆"；满仓 episode 也已自行结束（措辞收回一半）

**一、撤的是"无界"这一支，不是"排序错"那一支**
- 仍然成立的：`spawn` 工地第八次读数恒 0（`83413120`，siteId `6ac17f2c32019b86d4b0775a`），且**第三次独立的全新重选**（两只 builder `assignedAt=83413010/83413010`，序列 83410105 → 83411701/83411717 → 83413010/83413010）仍落到源旁 container ⇒ D1 排序缺"存在性阻塞"这一列，`c58ff9d` 修的就是它。
- **过头的那句要收回**：R131/R132 我写过"spawn 永远拿不到工时 / 帝国把唯一能花钱的地方冻住"。实际结构是：`buildQueue` 13 条里那 11 条新 site **被 `p0-spawn / lane:p0-spawn` 挡着开不出来**，所以 container（现 2,197/5,000）完工后场上**只剩 spawn 一个候选**，D1 无从竞争 ⇒ **#115 的现实代价 ≈ container 剩余 2,803 ÷ 1.9/拍 ≈ 1,475 拍 ≈ 64 分钟**（拍长实测 2.62s，且这速率本轮刚从 0.10/拍 跳到 1.9/拍、**未归因**，别当稳态斜率）。
- **自然实验（零改码、下一轮就能收，写成互斥两支）**：① container 到 5,000 后 spawn 开始进进度 ⇒ #115 定性为"**每次扩张约 1~2 小时的额外延迟**"，修复的价值是去延迟 + 修通用规则（同档并存 storage 30,000 与 tower 5,000 那类，见 R131 读码注释）；② container 已满而 spawn 仍 0 ⇒ "停摆"恢复原判并**升级**。⚠️在①/②分出来之前，**不建议为这条催一次部署**（部署会连带对端 #113/#103 上线 + ≈400 拍 G6 税）。
- 第三方仪器会独立签字：`E7_STALE_TICKS=5,000`@`expectations.ts:126`，spawn site 现龄 ≈3,260 拍 ⇒ **≈83414861 起**期望自检应出现 `siteStaleWorkerIdle:W38S58:6ac17f2c32019b86d4b0775a`（若届时仍无进度）。⚠️口径提醒：该 detail 里 `workers=` 是 **`workerCreepsInRoom`＝房内带 WORK 的我方 creep 数**，不是"指派到该 site 的工人数"（我差点据此读成超派）。

**二、满仓那一章：episode 结束，两处措辞按此改**
- `W37S58.storageNearFull` 本轮 **false**（`se=887,766`，ratio 0.8878）⇒ 从 R131 首次 true 起只维持 ≈1,000~2,000 拍。⇒ ①"0.9 像天花板"这条继续成立但**性质是边界振荡**；②R132 那句"帝国正在限采集"**降级为分钟级 episode，不是 regime**；③§3.5 里凡是拿"饱和 imminent / 持续限采"当时间压力的论据，一律按"分钟级事件"重写。
- 本轮**刻意不做收支闭合**：`bk={harvested:900, towerSpent:1500, towerSpendWalls:1500, imported:1970}` 是"每核算窗口"的量，而这一发没有窗口长度 ⇒ 拿它算 /拍 就是凭空造残差（#53 那次 25/拍"漏账"同族错误）。
- **RCL8 迟滞带本轮翻真**：`controllerDowngradeRisk=true`，但 `spawnQueue=[]`、`bk` 无 `upgraded`。⇒ 项目记忆 #52 的预写签名"**标志翻真后 ≤600 拍出 upgrader**"进入待验状态：出=设计在跑；不出=要去读 `allowUpgrader` 那一支被哪把闸挡着（`skip creep/upgrader/budget=225` 只是嫌疑不是证据）。

**三、E7 自己响了：`siteStaleWorkerIdle` 首次可见（属对端 #111，我只登记数字）**
- 期望自检 `0% → 0.6%（3 条事件）`，内容全是 `siteStaleWorkerIdle:W36S58:*`，**10 个 site**：`type=road prog=215/300 noProg=5868 workers=5`、`prog=90/300`、`prog=70/300`，另有多条 `prog=0/300` ⇒ `noProg=5868` 说明它们 ≈868 拍前刚跨过 5,000 阈值（本轮才首次可见）。
- 同族：`W36S58 roadsBuilt 13→11`、`W37S57 34→32`（R132 已见 38→34）、`W36S58 progSum 839` 冻住 ⇒ **已建路在消失、停滞工地不推进**。⚠️不立案、不碰 `roadHeat`/回收阈值（对端 `e7-prefix-watch.sh` PID 22299 在跑同一件事，同域别双改）。
- 判据侧读到的两条口径（写给下一轮，别再重读）：`P3_BOOT_GRACE_TICKS=1500`@`expectations.ts:8`、`E7_STALE_TICKS=5000`@`:126`；`siteProgresses` 由 `kernel.ts:577` 收集，**远房 site 也在内**（W36S58 不是我方房）。

**四、其余差分与锚**
- **线上 sha 重认（新基线）**：`modules:{main:<786,453B sha=d2f0b0cd00ad>}`；本地 `dist/main.js=789,460B sha=33e78bd675db` ⇒ **不等 ⇒ `c58ff9d` 未上线**（本地 dist 是 08:53:50 `test:e2e` 自带 build 的产物，"本地==线上"这台仪器仍作废，判上线只认 `d2f0b0cd00ad` 有没有被换走）。
- `deathByCause={natural:175, combat:3, recycled:3}` ⇒ **combat 没再涨**：R132 那 +3 是**一批性事件**（全在弃道后的 W39S56），不是持续战损。#90 的账不变。
- `kernel.bootstrap.W38S58={until:83414757, waves:2}` ⇒ wave3 ≈1,637 拍后；`home=W38S58` 人口 **4→3**（83413069 worker 寿终 age 1,511）⇒ 编制在代孵冷却之间**净减**。
- 闸与扩张：`G0+G2+G3+G6` 未变、`state=bootstrapping`、`Pressure` 本轮 MEDIUM(0.58)（R132 曾 HIGH(0.60) ⇒ **标签与数值都会摆，别看标签推趋势**）、`Budget=167,410/973,308`、`Top=W37S56(WAITING_EXECUTION)`。
- 幼房花钱了：`W38S56 se 84,529→85,519`（+990/≈930 拍，比 R132 的 +6.3/拍 慢一个量级）、`ea 1800→1039`、`site 1`、`cte 2,340` ⇒ §3.5 一直缺的"盈余有没有去处"这一列现在有数了。
- CPU：`window=5787t / total=15.88/拍` ⇒ 缺口 **3.88/拍**（R132 3.77，仍在涨）；榜上 remote 角色 1.99+0.85≈**2.84** ⇒ **A 路线杠杆追不上缺口**；每房 `{W38S58:0.362, W37S58:3.562, W38S56:3.422}`；人口 44（26/15/3）、`errorsPerTick 0`、`tier=tight@83387005`。
- 边界：**零 src、零 push、零 build、零 npm**；探针 `check-code×1 + observe×1 + peek×1 + console-eval×1`（mark=B11；其 payload 的 `n`/`sk` 两列被显示截断 ⇒ **本轮不引用**，要用就拆小表达式）；读码 3 处；`.gitignore` 未 stage；git 领先 28 / behind 0。

---

### 巡检 R134（2026-10-04 02:4xZ，本会话）#115 第三次修订（最终措辞）：**不是死锁，也不是"一次 site 的量"——阻塞工地拿到工时靠的是"人数碰巧超过竞争工位的 maxWorkers"，实测冻结 3,695 拍**

**一、自然实验的结（比预写的两个分支都拧）**
- 读数：`container 2,197 → 3,029/5,000`（+832/≈902 拍 ≈0.92/拍）；**`spawn 0 → 64/15,000`**；房内 `worker×2 + builder×2`，两只 builder 分别绑 `…4c`(container，`assignedAt=83413331`) 与 **`…5a`(spawn，`assignedAt=83413556`)**。
- 时间轴：site `queuedAt=83409861` ⇒ **恒 0 到 83413556 ≈ 3,695 拍 ≈ 2.7 小时**（拍长 2.62s），之后 466 拍只推进 64（≈**0.14/拍**）。
- **解锁的因不是排序变对**：D1 下 container（剩 ≈2,400）仍然压 spawn（剩 14,936）；动是因为 container 的 `maxWorkers=2` 被占满，**新到的第三只 builder 只剩 spawn 可选**。⇒ R133 的降级方向对（撤"无界"），但"完工后场上只剩 spawn"说得太顺：那 11 条 queued 请求确实被 `p0-spawn` 挡着开不出 site，所以**编制 ≤2 时 spawn 只能等 container 完工；编制 =3 才提前解锁**。
- **#115 定稿措辞**：`阻塞性工地能否拿到工时取决于随机到达的人数；实测冻结 3,695 拍；解锁后以 0.14/拍 爬行（15,000 ⇒ 单 builder ≈107,000 拍 ≈ 2.7 天）`。`c58ff9d` 去掉的是"等人数"那一段，并让 spawn 一开始就能拿到 2 个工位。**仍不催推**——理由见 §三。
- ⚠️**撤回一条预注册判据**：`siteStaleWorkerIdle:W38S58:6ac17f2c…5a`（原预测 ≈83414861 起出现）**被它自己预测的事件打断**——spawn 的 `noProg` 在 83413556 归零 ⇒ 期望层不会再响。别再把它当"将来的独立定罪"。

**二、第二段瓶颈（L2）现在是主限制，且量出来了**
- spawn 上那只 builder 是 14W4C12M（**载重只有 200**）：`storage=23 < builderStorageLimit.low=2,000` ⇒ withdraw 按设计给 0；房里无已建成 container；源旁 container 还差 1,971。⇒ 交付侧就是新上界。**这是一个每环都有出口的串行链条，不是死锁**：源旁 container 完工（0.92/拍 ⇒ ≈2,140 拍）后取能不必再自采，spawn 建成后容量与编制一起解。
- 与 `kernel.bootstrap={until:83414757, waves:2}` 对齐 ⇒ **下一件事是看 waves 是否 =3、spawn 工位是否 =2**（这是 L1 修复"本该起的作用"的自然对照，零改码）。

**三、RCL8 迟滞带那条签名：判据本身坏掉（记进方法论）**
- `controllerDowngradeRisk` true(≈83413055) → false(83414005) ⇒ 风险窗 **≈950 拍**自解（与 #52 [10000,>15000] 锯齿带一致）。
- 但"≤600 拍出 upgrader"**无法证真也无法证假**：`bk` 本轮 `{harvested:1000, imported:2820}` 无 `upgraded` 键，而**这在 RCL8 按构造不可观测**（`upgraded`＝progress 差分、保级能量不入账——项目记忆第 5 类）；`controllerProgressChangedAt=83361266` ⇒ progress **52,739 拍未变**，同样测不到救援动作。
- ⇒ **该签名作废并写清替代方案**：要证这类"短时窗内的编制响应"必须有**请求侧计数器/事件**，不能靠每小时采一发（950 拍的窗采不到），也不能拿标志回落当"已救援"。**不因此改任何阈值。**

**四、读数方法论新增三条**
- **`skip(500t)` 是滚动窗且会归零**：R133 `reserver 227/upgrader 225/builder 150` → 本轮 `12/12/8` **不是骤降**，是窗刚重启。跨轮比 skip 榜之前先确认窗位（旁证用 `tier=tight@83387005` 与 `cpuRate` 窗长）。
- **Σ 与物理面这窗方向相反**：`gateNetFlow` 三房和 `4.210+4.007+(−0.150)=**8.067**`（R132 是 11.238，**在跌**），而帝国 storage 物理量 `972,318 → 990,594` = **+19.7/拍（在涨）**。⇒ **不做反解**（R132 已把"I 反解"撤出决策输入），只登记：**G4 吃的是 Σ，该盯的是 Σ 会不会跌破 5**；方向相反要同窗再取一次才谈机制。
- **"单样本就改判"第三次现形**：R133 说 W38S56"开始花钱了"（`ea 1800→1039`），本轮它 `se 85,519→95,984`（**+11.3/拍**）、`ea 1800/1800`、`hc 2→3` ⇒ 又变回净攒。饱和同理：`storageNearFull` 仍 false 但 ratio 已 `0.8878 → 0.8946` **往回爬** ⇒ R133 的"episode 结束"不许读成"问题消失"。

**五、其余（对端域只登记）**
- E7/#111：`siteStaleWorkerIdle:W36S58:*` 仍 10 条，`noProg 5,868→6,786`（**每拍都加 ⇒ 真冻死**），`workers 5→3`（房内带 WORK 的我方 creep 在减）；`roadsBuilt W36S58 11→8、W37S57 32→28`；新车道 `W38S56→W37S56` 出现 `无site=94` 而 `sites=0`。⚠️不动 `roadHeat`/回收阈值，`e7-prefix-watch.sh`(PID 22299) 在跑同一件事。
- W38S58 状态：`ColonyStateChange [0,1]`@83413965（bootstrap→recovery）、`PhaseTransition [0,3]` 同拍、`ea/ec=0`、`queue=5/13`、`roomTotal_rs 275→127`、home 人口 3→4（**wave3 还没发**）。
- 闸与贸易：`G0+G2+G3+G6` 未变、`Readiness=NOT_READY`、`Budget=170,039/988,594`、`Candidates=11(Q=1,R=7,U=3)`；`demandsPublished=0/demandsComputed=0`（满仓入口条件本轮又是假 ⇒ #51"继续不发需求"仍是正确态）、`credits=14,505,346`。
- 边界：**零 src、零 push、零 build、零 npm**；探针 `observe×1 + console-eval×1`（mark=B12，payload 刻意压到 2 列 ⇒ 无截断）`+ peek×1`；`.gitignore` 未 stage、`git stash list` 空、git 领先 29 / behind 0；`tier=tight@83387005`、`errorsPerTick 0`。

### R286（10-04 11:0xZ，本会话）#111 价值判断落地：(A) 回收被**否证**，(B) 是唯一与账本相容的方向——但它的收益今天无法定价，缺的那个数是我自己的观测口径挡住的
先接 R284 留下的那一问（「西缘 x1–6 是不是出境口的必经段」）。当时我用 `Room.exitLeft/…` 取回全空并判为**不确定**，
那是对的处置（那是惰性缓存）。本轮换了三个互不相干的仪器，方向一致：

**一、落点身份（`mark=R286-A1`，t=83414261，零写）**
- W36S58 的非路/非墙结构只有三个：`controller (22,14)`、`container (16,40)`、`container (23,16)` ⇒ **两口源容器，房内没有 storage/spawn** ⇒ 交付必须出房。
- 待建 road site **15 格**（不是 16 格，有一条已被收掉），全部 `x∈1–5, y∈25–31`，progress 0–220。
- `Game.map.getRoomTerrain('W36S58')` 边界可走列（`mark=R286C1`）：**西侧 x=0 在 y28–38 连续可走**（另有 T28–34/T41–45、B8–15/B29–46）。
  自家核心房 W37S58 在本房的**西**侧 ⇒ 西侧那张口就是交付口。
⇒ 这 15 格紧贴西口，是**交付车道的出口段**，不是"铺完主干剩下的尾巴"。

**二、legs 全量重数（两日志 40 次采样 / 150 拍 / 80 条 hauler 观测，工具 `tmp/tools/official/analyze-legs.cjs`）**
- 满载 n=62：`x≤6` 只有 4 次（6.5%）；空载 n=18：`x≤6` 有 5 次（28%）。方向与 R282 同向，样本量从 10/40 升到 18/62。
- 西口附近实测到的坐标：满载 `(6,31)`、`(2,28)carry=1000`；空载 `(3,31)`、`(2,31)`、`(6,31)`。**满载确实带着满包经过 y28–31 这段**。

**三、账本闭合（`Memory.kernel.stats.roadBuild.W36S58`，boot 以来累计，走 Memory API 零 console）**
`calls 11,186 = noEnergy 3,216 + outOfRange 7,912 + built 58`；`noWork 0`、`noSiteAtAll 0`、`buildRejected 0`；
射程分桶 `near(4–5)=633 / mid(6–10)=2,833 / far(≥11)=4,446`；`roadsBuilt 7 / pending 15 / progressSum 839`。
⇒ **两项等式同时成立**：① `noWork=0` ⇒ 远矿 hauler 人人带 WORK；② 射程内且满载的那 58 次调用**全部**转成 `build OK`（`buildRejected=0`）
⇒ 引擎侧没有暗闸、`classifyRoadBuildAttempt` 也没被绕过。**卡死的唯一事实是：满载调用里只有 0.73%（58/7,970）落在射程内。**

**四、于是本轮要撤的正是我自己 R284 选的那一支**
R284 写「第二个分支更可能是真的：主干已铺完，剩下西缘 16 格是低价值尾巴」。**被第三节的配对读数否证**：
新工具 `tmp/tools/official/site-vs-legs.cjs` 把 15 格 site 与 80 条观测逐格配对，**15/15 的 `nearestLoaded ≤ 3`**（最低 0）。
⇒ site 落在车道上、也落在施工射程内 ⇒ **(A) 回收没有依据**（路只降移动代价、与载重无关，而这段两条腿都走）。
⚠️口径边界要说清：`nearestLoaded≤3` 是"样本里出现过"，账本说"这种时刻只占满载调用的 0.73%"。两者不矛盾（4/62 次采样 vs 按 creep-tick 计的 0.73%），
但**它共同指向的图景是 R275 那条"摊薄反例"的另一种成因**：不是选择不稳定，而是**射程内事件太稀**——
15 格 ×300 点 = 4,500 点，靠 0.73% 的调用密度要摊 ≈5,400 次满载调用才凑得满一格的零头，实测 11,186 次调用只攒出 `progressSum 839`。

**五、修法排序（只排序，不起手）**
- (A) 回收/停铺 ⇒ **否证**，不再列为选项。
- (B) 让 hauler 在空载腿留 200–300 能量 ⇒ **唯一与账本相容**（空载 28% 走 `x≤6`、`nearestEmpty` 有 0，那 3,216 次 `noEnergy` 里落在射程内的部分可直接转成 built），
  代价＝每趟交付量减 200–300（远矿 hauler 容量 ~1000 ⇒ 交付率约降 20–30%）⇒ **属物流排产，要你判**。
- (C) 把 site 往满载密度高的位置挪 ⇒ 前提不成立：`recordTraffic` 与载重/角色无关（`creeps/movement/traffic.ts:15-24`），而热度已经把这 15 格落在了真实出口车道上；**热度语义"不该混入空载腿"是命名/口径层面的事，不是本案的因**。
- **本案现在挡住的不是决定，是一个数**：`classifyRoadBuildAttempt` 先判能后判人（`road-build.ts:86-89`，注释自己就承认 `noEnergy` 会盖住双重缺陷），
  所以 **3,216 次 `noEnergy` 里有多少本来在射程内，账本答不出来** ⇒ (B) 的收益无法定价。
  规格（**行为严格不变的纯观测补丁**，等下一批随带走、不单独换码）：在 `energyInStore<=0` 那一支也做一次 site 扫描，
  把 `minRange≤3` 的次数记成新桶 `noEnergyInRange`（复用已缓存的 `findMySitesCached`，成本＝一次数组遍历，不新开寻路）；
  上线后第一次读数即可给出 `(B) 的收益 = noEnergyInRange × 每格 300 点的缺口`，届时要不要付那 20–30% 交付率才是有价格的取舍。
  ⚠️这条与对端 #115 同域（都在 builder/road 施工侧），**我不在轮次不足时起手共享核心**；规格已细到"只差一次形参读取"。
**禁令继续有效**：不动铺路器、不动回收阈值（`roadStaleReapTicks=2000`）、不放宽施工射程（`UNDERFOOT_BUILD_RANGE_LIMIT`）、不改 `roadHeat` 衰减结构。
**边界**：单房（W36S58）；账本是 boot 以来累计、无窗口长度，所以只用于**同段内**的比例比较（R282 与本节同段，可比）；本轮零 src、零 push、零 build，
用了 console×2（结构坐标、边界地形，均只读）+ Memory-API×1 + 本地重数×1。

### R287（10-04 11:1xZ，本会话）#114 的"反号"第一次有已知机制可解释：Δtracked 的一半是在途背包，而警语没把它扣掉
零 console（`peek.mjs` + `econ-ring.mjs`），两把仪器都是现读、同刻对齐：

**读数（核心房 W37S58，`economy.t=83414379`）**
- `pl=[929985, 931171, 7028, 7028, 0]` ⇒ **Δtracked=+1,186**、Δother=0、Δloose=0。
- `ce=[4297, 4907]` ⇒ **Δcarry=+610**。按 `accounting.ts:191-202`，`loose` 在 tracked 内而 drift 公式又单减 Δloose（`:269-270`），
  两项**精确相消**⇒ `Δtracked − Δcarry − Δloose = +576` 才是"库存六池"（spawnExt/containers/storage/terminal/links/towers）的变化。
  ⇒ **Δtracked 的 51.4% 是"在途背包"**，而 `:222-224` 的注释自己写明了机制：carry 按 `memory.home` 立刻计、`imported` 要等投递成功那拍才计。
- `ws=[1542, 2121, 650]` ⇒ Σdrift 1,542 对 ΣflowBalance 2,121（比值 0.73）⇒ 触发代码自己的警语「同量级 ⇒ 单向漏记 ⇒ nf/G4 不可信」。
- 段 3 物理面同房：`se` 898,923@83414105 → 895,197@83414355 ⇒ **−14.9/拍（storage 在这一窗是在掉的）**。

**于是"两把仪器方向相反"这件事第一次不需要机制**
`se` 是**一个池**，`Δtracked` 是**八个池的合计**，其中一半由一个已写明的跨窗时序噪声构成。
把 `drift=+610` 级别的窗间残差归到"漏账"之前，至少要先把 `Δcarry` 扣掉——而 `ws` 的警语用的正是**没扣**的那个合计。
⇒ **#114 现在的状态：由"疑似单向漏记"降级为"有一项已知、可解释、且代码早已单独落盘的分项"**。
⚠️这不等于结案，也不等于 G4 可信，理由两条：
1. 剩下 **+576** 的库存侧仍未逐池拆开（Memory 只存合计，拆开要对同一窗 bracketing 两次 console 快照，本轮零 console 就没做）；
2. 时序噪声能解释 Σdrift 的**多少**取决于窗数：1,542 对单窗 610 只够摊 ~2.5 个窗，若 ws 聚合了几十个窗，那就还有别的东西。
   ⇒ 缺的读数是 `ws` 聚合了多少个窗（`Σticks=650` 提示是短聚合，但这是推断不是读数）。

**登记一条与对端的冲突（不裁决）**：对端 R134 写"Σ=8.067 在跌而物理 storage **+19.7/拍** 在涨"，
我这一窗同房读到 **−14.9/拍**。两边都是差分、窗不同 ⇒ 谁都不必错，
但**任何用它做的方向判断之前必须先对齐窗起止**，否则下一轮又会把一次符号翻转读成一次 regime 变化。

**处置**：#88 那条请示（"G4 绿在被系统自己的警语标为不可信的输入上"）的措辞要跟着更新——
警语现在**既不能证明不可信、也不能证明可信**；改警语（把 Δcarry 从合计里扣掉）会动 nf/G4 的输入，属决策路径 ⇒ 属人，我不起手。
**边界**：单房、单窗；本轮零 src、零 push、零 console、零 build。

**R287 附记（台账更正，非读数）**：本文件的巡检标签 **R279 被我写过两次**（05:22Z「#111 再否证一条」= `e76a91a`，
05:35Z「#111 由假设升为实测」= `5cb69c5`），且 R278 排在第一个 R279 之后、第二个 R279 之前 ⇒ 编号序在本段是乱的。
文件是 append-only，不回改历史；引用 R279 时必须带提交号。**后续我起的号只按提交时间单调追加，并在追加前先 `grep -c "^### R<号>"`。**

### R288（10-04 11:2xZ，本会话）#111 缺的那一列装上落了码（本地 `0d8e1db`，未推送）——(B) 从此可定价
R286 把修法收窄到只剩 (B)（空载腿留能），但当场卡在"收益算不出来"：`classifyRoadBuildAttempt` 先判能后判人，
`noEnergy` 会把「空手但脚下就有自己的 site」那一类整个盖住（该文件注释自己承认这是已接受的盲区）。本轮把这一列补齐。

**改动（4 文件，+59 行）**：`noEnergy` 那一支里，`workParts>0` 时按 `UNDERFOOT_BUILD_RANGE_LIMIT` 数一次射程内的 site，
>0 则 `counters.noEnergyInRange++`。site 走 `findMySitesCached`（按 tick 缓存，不新开 `find`、不新开寻路），
**动作零变化**：那一支仍然早退、不发 `build`、不放宽射程、不动回收阈值。新列进 `RoadBuildCounters` 类型 + `global-cache` 建行零值。
⚠️口径：**子集不是并列桶** ⇒ 不变式 `noEnergyInRange ≤ noEnergy`，两者**不可相加**（写进了类型注释）。

**门禁与反向实验（两次独立短路，各恰好 1 例转红、18 例控制组全绿）**
- A 摘掉整个新分支 ⇒「背包空但脚下有格且带 WORK → 追加记 noEnergyInRange」`expected +0 to be 1`；
- B 摘掉 `workParts` 闸门 ⇒「无 WORK 不记」`expected 1 to be +0`（这一条证明的是**闸门语义**，不是分支存在性）；
- 两次改完都用备份 `cmp` 逐字节还原，避免"改回去时留下我的理解"。
- `tsc --noEmit` 退出 0；`tests/unit/remote` 33 files/492 全绿；`tests/integration` 30 files/239 全绿；
  全量 unit **419 files/5,493 通过**，唯一红文件是**对端放在 gitignored `tmp/observe/pending-62-files/` 的未跟踪夹具**
  （`import ../../support/factories` 解析不到 ⇒ 套件加载错误，与本次改动无关）⇒ **我不写"全量 unit 全绿"这句话**，也不代删他人的在制品。
- 提交时 prettier 改写过 staged 文件 ⇒ 提交后**重跑**该测试文件确认 19/19 仍绿（不是复用提交前的读数）。

**判效签名（零新增仪器）**：`noEnergyInRange` 就在 `Memory.kernel.stats.roadBuild.<房>` 里 ⇒ 现有巡检读那一行就能看到，不必另挂表。
- 未上线态先说清：本列**在部署前必然读不到**（键不存在 ≠ 键为 0），别把"没有这个键"读成"收益为零"。
- 上线后判据：① 某房 `noEnergyInRange > 0` ⇒ 本列有写者、(B) 有价格 = `noEnergyInRange × 每次 WORK·点` 对 `剩余 4,500−progressSum` 的比值；
  ② 一整段 boot 内 `noEnergy>0` 而 `noEnergyInRange` 恒 0 ⇒ **(B) 按构造收益为零**，本案结案为"不该做"，
  下一动作回到 (C)（热度语义与落点）或维持现状，而不是去调射程。
**未推送的理由（不变）**：一次部署＝清堆 + ≈400 拍 G6 税，且会把 `27a8a51`(#113)/`b20a67b`(#103)/`c58ff9d`(#115) 一起带走 ⇒ 属人。
本批现在含 **4 笔含 src 的未推提交**（ahead=33）；本笔的边际部署成本为零（同批走），但**它增加了对端那两笔的上线风险敞口**，
所以推不推仍由你定，我不催。

### R289（10-04 11:2xZ，本会话）#114 的"反号"拿到数值分解：ΔspawnExt(+1,600) 与 Δcarry(+610) 掩掉了 Δstorage(−1,236)
R287 只做到"覆盖项集合不同 ⇒ 不必矛盾"，本轮把它落成**加减式**。零 console，三处现读：
`CONFIG.economy.accounting.windowTicks = 50`（`src/config/index.ts:474`，所以 `pl` 那一对快照跨 `[t−50, t]`，t=83414379）。

| 项 | 来源 | 读数 |
|---|---|---|
| Δtracked | `economy.pl` 差分 | **+1,186** |
| Δcarry | `economy.ce` 差分 | **+610** |
| Δloose / Δother | `pl[4]` / `pl[3..4]` | 0 / 0（且 loose 在恒等式里被加又被减 ⇒ 精确相消） |
| ⇒ Δ(其余六池) | 上式相减 | **+576** |
| Δstorage | 段3 `se` 896,433@83414305 → 895,197@83414355 | **−1,236**（≈ −24.7/拍） |
| Δcontainers | 段3 `cte` 2000 → 2000 | **0** |
| ΔspawnExt | 段3 `ea` 10,400 → 12,000 | **+1,600**（`availableEnergy` 只含 spawn+extension ⇒ 这项是**精确对应**不是近似） |
| 已知三项合计 | | **+364**，对 +576 的残差 **+212** |

⇒ 残差 +212 只能落在 `terminal + links + towers` 三项，而**对齐误差本身就 ±24 拍**（storage 单拍 24.7 ⇒ ±593）
⇒ **符号与量级成立、逐拍闭合不成立**：要真闭合得对同一窗做两次 bracketing 快照（本轮零 console，未做，留作下一手）。
**但结论已经够硬**：`Δtracked` 为正与 `storage 在掉` 是**同一件事的两面**，不需要任何漏账机制——
被采集灌满的 spawn/extension（+1,600）加上在途背包（+610）就把 storage 的流出（−1,236）掩过去了。

**R287 留的第二半也顺带有数**：`ws[2]=Σticks=650` ÷ windowTicks 50 ⇒ **13 个窗** ⇒ Σdrift 1,542 的均值是 **+119/窗**，
而单窗 `Δcarry` 实测 **610** ⇒ 那个"同量级 ⇒ nf/G4 不可信"的警语输入，**一根时序项就足以解释全部**。
⚠️这一支的口径前提（`ws=[Σdrift, ΣflowBalance, Σticks]`）来自本项目 telemetry 的写入点，**本轮没有重读那一行** ⇒ 标为待复核，不当已证。
**于是 #114 的处置**：不再追"神秘残差"；下一步是①重读 `ws` 写入行确认三元语义，②（要真闭合才做）对同一窗 bracketing 两次池快照拆掉那 +212。
G4 的措辞维持 R287：既不能证不可信，也不能证可信。
**边界**：单房（W37S58）、单窗（50 拍）；段3 环与核算窗是两套错峰采样（`tick+roomHash)%50`），所以表里三行 `se/cte/ea` 都带 ±24 拍对齐差；
本轮零 src、零 push、零 console、零 build。

### R289 更正（同会话，10-04 11:2xZ）：「一根时序项足以解释全部」是过头的——重算后它是单窗的 60%、总和的 40%
先把口径前提核掉（这一条**已证**，不再是待复核）：`economy.ts:250` 写明 `ws = [Σdrift, ΣflowBalance, Σticks]`，
`accounting.ts:453` 的 `WS_HORIZON_TICKS = 2000`（≈40 个 50 拍窗，超界滚动重开）。⇒ `Σticks=650` 是 13 个窗，**这一步成立**。

但我接着写的「Σdrift 均值 +119/窗，而单窗 Δcarry=610 ⇒ 时序项足以解释全部」把**均值当成了本窗**，重算：
- 本窗 flowBalance 未单独落盘，用均值近似：`2,121 ÷ 13 = +163/窗`。
- 本窗 drift = Δtracked − flowBalance = `1,186 − 163 ≈ +1,023`。
- ⇒ **本窗一窗就占了 Σdrift(1,542) 的 ≈66%**，其余 12 窗合计才 +519。
- ⇒ 时序项 `Δcarry=610` 解释的是**这一窗 drift 的 ≈60%**、**整个 Σdrift 的 ≈40%**。
所以正确的表述是：**警语被最近这一窗 dominate，而这一窗的大头是 carry 时序项**——
这不等于"Σdrift 全是时序"，剩下 ~413 与 R289 表里那 +212 库存残差同源（且同样受 ±24 拍错峰对齐影响）。
撤的是"足以解释全部"这一支；**"se 与 Δtracked 反号不需要漏账机制"那一支不在撤的范围里**（它由表里的加减式独立支撑）。
连带含义：判断 `ws` 该不该触发警语，**不能只看 Σ 的比值**——一个窗就能把比值推到"同量级"。
这条属于对端 #114/#88 的口径，处置仍属人：要么把 `Δcarry` 从警语输入里扣掉，要么把警语的分母从 Σ 换成"连续 N 窗同向"。

### R290（10-04 11:28Z，本会话）#111 严重度升级：这不是"停摆"，是**净衰减**——两房桶形相反，而我刚补的那一列正好落在未知的那一侧
线上仍未换码（`main sha=d2f0b0cd00ad`、`kernel.stats.roadBuild.*` **没有** `noEnergyInRange` 键 ⇒ 那是"未上线"，不是"为零"，与 R288 预写的三态一致）。
`roadProgressSum` 的语义这次读了写入行才算数：`road-planner.ts:244-247` 是对 **allSites 里 structureType=road 的 progress 求和**
（`roadsBuilt` 则数 `FIND_STRUCTURES` 里的 road，`:240-242`）⇒ 下面两行的差分可以直读。

**同一批累计计数器在 ≈400 拍内的差分（R286 读数 @t≈83414261 → 现读 @t≈83414655）**
- `W36S58`：calls +231、noEnergy +79、outOfRange +152、**built +0**、near +0 / mid +1 / **far +151**、
  `roadProgressSum 839 → 724`（**−115**）、`pending 15 → 10`（**−5 格被收**）、roadsBuilt 7 → 7。
  ⇒ 闭合：`231 = 79 + 152 + 0` ✓（逐位对上，同 R286 的口径）。
- `W37S57`：calls +246、**noEnergy +233（95%）**、outOfRange +12、**built +1**、`pending 5 → 8`、**`roadsBuilt 27 → 26`**。
  ⇒ 闭合：`246 = 233 + 12 + 1` ✓。

**三点新事实（都不是上一轮有的）**
1. **两房第一因相反**：W36S58 卡在 `outOfRange`（而且是 far：+151/152 ⇒ site 与当前线差 ≥11 格），
   W37S57 卡在 `noEnergy`（95%）。⇒ 上一轮"15/15 都在射程内"是 **W36S58 的形状**，不能外推到 W37S57；
   我 R286 里"唯一与账本相容的是 (B)"这句**只在 W36S58 那一侧成立**，在 W37S57 侧反而是**支持 (B) 的更强证据**，
   但它的可行动子集（那 233 次里有多少脚下有格）**正是 `noEnergyInRange` 才能回答的问题** ⇒ 这一列的必要性从"定价"升为"两房都需要"。
2. **路面在净衰减**：W37S57 一窗内 **建成 +1、已建 −1**（27→26）。道路按 tick 衰减，而施工速率 1/246 拍 ≈ 0.004 格/拍，
   低于衰减 ⇒ 这条车道的路**正在净减少**，不是"停在原地"。⇒ 成本口径要换：从"新建一条路的机会成本"换成"能不能维持现有路网"。
3. **回收器已经在替我们做 (A)，而且是带损耗地做**：W36S58 被收 5 格、连带丢掉 115 点已投进度（引擎不退款）。
   ⇒ (A)"回收西缘尾巴"作为**建议**已被否证（R286），但作为**现状**它正在发生 —— 于是真正的缺陷是
   **"铺 site 的一侧不看施工可行性、收 site 的一侧不看已投进度"**：两头都在动，中间没有闭环，能量被反复摊进建不成的格。

**预注册的可否证预测（下一次巡检读，同一批累计计数器）**
- P1：若 `W37S57.roadsBuilt` 继续按 ≤0 走（27→26→…）而 `built` 每窗 <2 ⇒ "净衰减"成立，本案从"发展缺陷"改判为"维护缺陷"，
  动作是把 site 生成量按 `built` 速率收敛（属人，因它会少铺路）。
- P2：`noEnergyInRange` 上线后，若 W37S57 那一房 `noEnergyInRange / noEnergy` **高**（≫ W36S58）⇒ (B) 只对 W37S57 有意义；
  若两房都低 ⇒ (B) 结案为"不该做"，回到 P1 的收敛方向。
- 反向自证：`calls` 若在下一读仍等于 `noEnergy + outOfRange + built` 之和 ⇒ 记账没漏；**若不等，先怀疑我读的是两次部署之后的混合段**。
**边界**：heap 累计、boot 以来同一段（本轮已证无部署：线上 sha 未变）；单窗差分 ~400 拍；`mid +1` 这种 1 次级别的差分只用于闭合，不当趋势。
本轮零 src、零 push、零 build，用了 Memory-API×2 + 读码×2。

### R291（10-04 11:3xZ，本会话）#114 的逐拍闭合改用**已经存在的**仪器（`cr`），并把两个工具失败形状记死
原计划是"对同一核算窗做两次 bracketing console 快照"。**先跑 dry-run，两个形状都坏了，所以那条路作废**：
1. `console-eval` 这一发 **读回超时 37s**（≠ 返回 null，也≠ 没有结果）——与并行会话共用 `__evalResult` 的已知争用形状；
   在这种形状下我既拿不到值也不知道有没有值，**不进判据链**。
2. `peek.mjs` **多路径**（三条一起）会直接报错退出，单路径正常 ⇒ 任何要进自动化链的读数一律单路径逐次取。
⇒ 新工具 `tmp/tools/official/roll-poll.sh`（**零 console**，纯 Memory-API）已改挂这条，日志 `tmp/observe/roll-poll.log`。

**为什么不需要探针：闭合残差的仪器早就在 Memory 里，而且是按窗对齐写的**
`accounting.ts:182-184` `contractReserveOf(pools) = storage + terminal + links`，而 `economy.ts:237` 每窗把它落成 `mem.cr`，
与 `pl`（`:436-442`）、`ce`（`:443`）**同一个 `economy.t`（= 该窗结算拍）** ⇒ 相邻两次 roll 的 `Δcr` 正好对上后一窗的 `Δtracked`：

  Δ(spawnExt + containers + towers) = Δtracked − Δcarry − Δcr − Δloose

这一支是**逐拍精确**的（不像 R289 用段 3 环，那套是错峰采样、±24 拍对齐差）。再用环里的 `ea`(=spawnExt 精确对应)
与 `cte`(containers) 做近似替代，就把 towers 单独夹出来 ⇒ R289 那个"残差 +212 无法分"的边界可以被收掉，
**代价只是等两个窗（~50 拍/窗）**。

**预注册（读数落盘后再判，不事后调形状）**
- 若 `Δtracked − Δcarry − Δcr − Δloose` 落在 `[−200, +900]` ⇒ R289 的分解成立，#114 的"残差"结案为口径问题（分项叠加），
  警语的处置回到"扣 Δcarry 或改成连续 N 窗同向"这一条属人选择。
- 若它显著为负（例如 < −1,000）⇒ **towers/containers 之外还有东西在 tracked 里动**，那就是真缺陷，按 #114 重开。
- 若 `Δcr` 与环的 `Δse` 同号且量级接近 ⇒ 说明 terminal+links 这两项在这一窗几乎没动，分解退化成 R289 的三行表；
  这条也算"闭合失败但无罪"，要写清是**仪器分辨力**不够而不是账对不上。
**边界与归属**：本工具读的是 W37S58（核心房），单房；roll 节奏由 `(tick + roomHash) % 50 == 0` 决定 ⇒ 等待时长按实测拍长给区间，
不心算成"分钟"。本轮零 src、零 push、零 build、**零 console**（因为那一发超时了，我不重复发）。

### R292（10-04 11:3xZ，本会话）#114 找到机制：**孵化被记成消耗，但那份能量还留在 tracked 里** ⇒ drift 的正项 ≈ 本窗 `spawned`
零 console（`peek.mjs` 单路径 ×2 + 读码 ×2）。核心房 W37S58 一次完整结算窗（`economy.t=83414729`）：
`pl=[929336,926854,6828,6828,0]` ⇒ **Δtracked=−2,482**；`ce=[2465,2667]` ⇒ Δcarry=+202；`dr=+1,324`；
`bk={"harvested":980,"pickedUp":1190,"spawned":1800,"towerSpent":1140,"towerSpendWalls":1140,"sold":1000,"tradeFee":846,"tradeFeeEnergySell":846}`。

**恒等式逐位闭合（这一条同时把两个口径问题解决掉）**
按 `CONSUMPTION_FIELDS`（`accounting.ts:67-77`：spawned/upgraded/built/repaired/towerSpent/sold/exported/tradeFee）
取 `bk` 的非零交集：`consumption = 1,800 + 1,140 + 1,000 + 846 = 4,786`。
按 income 取 `harvested = 980`（**`pickedUp` 不在 income 里** —— #40 那笔"拾取自己掉的能不能当新收入"的修复在字段层生效）。
⇒ `flowBalance = 980 − 4,786 = **−3,806**`，而由 `dr` 反解的 flowBalance = `Δtracked − dr = −2,482 − 1,324 = **−3,806**` ⇒ **两处独立对上同一数**。
⇒ 顺带证死一条口径：`bk` 是**本窗增量**、不是 boot 累计（否则四位数字不可能吻合）。

**机制（不是漏账，是语义）**：孵化那 1,800 点能量并没有离开这房的受踪面 —— 它只是从 `spawnExt` 变成 creep 的 `carry`，
而 `carry` 在 `trackedPoolsOf` 里（`:191-201`，注释还写明把 carry 放进来就是为了消除跨窗错位）。
于是同一份能量：**恒等式左侧没掉、右侧被当消耗扣了一次** ⇒ 每发生一次孵化就凭空产生一个**正向 drift ≈ 本窗 spawned**。
实测比值 `1,324 / 1,800 = 0.74`，同量级、同方向；余下 ~476 的差可由"孵化后当窗就离开本房的 carry / 池间归属用 memory.home"解释，
但**这半个残差我没有独立仪器去拆**，所以只写量级吻合，不写成闭合。

**于是 #114 的"同量级 ⇒ nf/G4 不可信"警语有了具体缺陷**：
`ws[0]=Σdrift` 吃的是同一个 drift，而它正比于**孵化脉冲**——房越忙孵、drift 越大，与"账实不符"无关。
⇒ 上一轮我撤掉"时序项足以解释全部"时低估了这一支：真正的解释项是 `spawned`，不是 `Δcarry`
（本窗 Δcarry 只有 +202，连 drift 的 1/6 都不到）。**R287/R289 那两节把矛头指向 carry 的部分要按本节改口径**。

**处置（仍然属人，我不起手）**：三条都可写，但都动 G4 的输入 ⇒
① drift 里把 `spawned` 剔出 flowBalance（保留它在 P0/P1 配给与 netflow 分子里的位置，`ledgerP0P1Consumption` 一行不动）；
② 或者把 carry 的归属从 `memory.home` 改成**消耗发生的那一房**（更贴物理，但会改 #42/#48 那条成对入账的判据）；
③ 或者只改警语：判"漏记"用 `drift − spawned`，或改成"连续 N 窗同向"。
**可证伪**：若①/③ 落地，`Σdrift` 应显著下降且与 `Σ spawned` 的比例消失；若降不下来，则 `spawned` 不是主项，本节机制被否证、#114 重开。
**边界**：单房单窗（50 拍）；`dr` 与 `pl/ce/bk` 同一 `economy.t`（这次逐字核过写入序列）；`roll-poll.sh` 仍在跑，它给的 `Δcr` 拆解是**另一条独立仪器**，两节判据不互替。

### R293（10-04 11:3xZ，本会话）#114：逐窗拆账工具**验证通过**（两窗都把 flowBalance 复现到单位），同时**反证了 R292 我自己刚写的主项**
`tmp/tools/official/roll-poll.sh` 零 console 抓到两个**窗对齐**的结算（W37S58）：

| 窗 | `economy.t` | Δtracked | Δcarry | Δcr(=storage+terminal+links) | Δloose/Δother | `dr`(=drift) |
|---|---|---|---|---|---|---|
| 1 | 83414729 | **−2,482** | +202 | —（起点 905,487） | 0 / 0 | **+1,324** |
| 2 | 83414779 | **−4,124** | **−1,017** | **−789** | 0 / 0 | **−639** |

**一、工具算通过了（这才是这节的主要交付）**
- 窗 2 的分解：`Δ(spawnExt+containers+towers) = Δtracked − Δcarry − Δcr − Δloose = −4,124 +1,017 +789 = **−2,318**` —— 每一项都与同一个 `economy.t` 对齐，**没有 R289 那种 ±24 拍错峰误差**。
- 独立回验（两窗各一次）：用 `bk` 现成的桶按 `INCOME/CONSUMPTION_FIELDS` 组一遍 flowBalance，与由 `dr` 反解的值比：
  窗 1 `980 − 4,786 = −3,806` vs `Δtracked − dr = −3,806` ✓；
  窗 2 `(harvested 1,000 + imported 635) − (spawned 3,950 + towerSpent 1,170) = **−3,485**` vs `−4,124 −(−639) = **−3,485**` ✓
  ⇒ 两次都是**到单位吻合** ⇒ ①公式与字段清单读对了；②`pickedUp` 确实不在 income（#40 的修复在字段层）；③`imported` 确实在 income；④`bk` 确为本窗增量。

**二、R292 那条"机制"被窗 2 直接否证，当场撤回**
R292 写的是「孵化被记成消耗而能量仍在 tracked ⇒ **drift 的正项 ≈ 本窗 `spawned`**」。
- 窗 1：`spawned=1,800`、`drift=+1,324` —— 我当时把它当成支持证据（比值 0.74）。
- 窗 2：`spawned=3,950`（**2.2 倍**）、`drift=**−639**`（**符号翻转**）。
⇒ 若 `spawned` 是主项，窗 2 的 drift 应更大更正；实际为负。**撤的是"主项/可解释警语输入"这一支**，
保留的是"孵化这一项在恒等式里方向存疑"这个**未定量的观察**（它现在既没被证也没被否，只是不能再当结论引用）。
教训落回旧规矩：**单窗支持一个比例，不构成机制**；两窗就该够，而这次是第二窗把它打掉的。

**三、#114 现在的位置（比 R287 更具体，但仍然没结案）**
`drift` 在 50 拍尺度上**没有稳定主项**（+1,324 → −639），而它的候选来源至少三条并存：
孵化（+，留在 carry）、跨房入账与 carry 的 `memory.home` 归属（`imported` 在 income 而能量可能落在他房的池 ⇒ −）、
携带能量随 creep 死亡灭失（不计任何账 ⇒ −）。⇒ **本案的正确下一步不是再猜单项，是连采 5~10 窗取 drift 的分布**，
看它是不是零附近双向抖动（那就是窗太短）还是单边偏（那才是漏记）。工具已经可用，成本只是等待。
**G4 的措辞维持不变**：既不能证不可信，也不能证可信。
**边界**：两窗同为 W37S58、同一段 boot（本轮线上 sha 未变 ⇒ 无部署污染）；`Δcr` 是 storage+terminal+links 的**合计**，
三项之间仍未拆（要拆需 `cr` 的分项，代码里没有 ⇒ 这是一个真实的仪器缺口，可提但**不是**本轮结案条件）。

### R294（10-04 11:4xZ，本会话）#111 的因换了一层：E7 自己把 W36S58 从"有人不干活"改判成"没人能干"，而该房建路流量同时冻结
**直读 `kernel.expectations.violations`（不是推断，是那一行的原文）**
- `siteStaleNoWorker:W36S58:…(type=road prog=215/300 noProg=7669 workers=0)`
- `siteStaleNoWorker:W36S58:…(type=road prog=0/300 noProg=7669 workers=0)`
- `siteStaleNoWorker:W36S58:…(type=road prog=0/300 noProg=7669 workers=0)`
- `siteStaleWorkerIdle:W37S57:…(type=road prog=0/300 noProg=6661 workers=3)`
⇒ 我的 E7 分叉（`workerCreepsInRoom===0 ⇒ NoWorker`，否则 `WorkerIdle`）**第一次真的把两类分开**：
W36S58 = **一个带 WORK 的我方 creep 都没有**；W37S57 = 有 3 个却不推进。两类要修的地方不同（前者编制/派遣，后者能量/射程/取活）。
⚠️`violations` 是 `slice(0,10)` 的人读截断列表 ⇒ 这里的"4 条"**只是下界**，计数一律以轮询器的 `siteStaleTotal` 为准（round37=5，其中 noWorker=4/workerIdle=1）。

**配套的第二发（同刻现读 `kernel.stats.roadBuild`）**：W36S58 `calls 11,417 → 11,419`（**约 90 秒只 +2**），
`built 58 → 59`。上一节同一房还是 ~230 次/400 拍 ⇒ **这不是"稀有事件"，是这条车道的交通停了**。
⇒ R290 的"净衰减"在 W36S58 侧现在有了直接成因：**没人在那条线上走**，所以 (B)"空载腿留能"在这一房此刻是**空转命题**
（没有腿可留能）。**这是对我自己 R290 结论的一次限缩**，不是推翻：W37S57 那侧（workers=3、noEnergy 占 95%）仍然成立。

**第三条差分（`kernel.stats.deathByCause`，#96 后跨部署存活）**：`{natural:234, combat:8, recycled:4}`。
对端 R132/R133 记的是 **combat=3** ⇒ 本段 **+5**。⚠️两件事没证：这 5 只死在哪一房（环里没有远房敌情事件，对端已写"远房敌情仪器是空的"）、
是不是**持续**战损（+5 完全可能又是一批性事件 —— 我自己在 R133 前后就把"一批性"当过结论，判严重度必须再要一发差分）。
⇒ 所以本节**不立案**为"战损持续"，只登记两条待验：
- V1：下一次巡检读 `deathByCause`，若 combat 再 +≥3 ⇒ 持续战损成立，动作属"为什么远矿编成在掉且没补"（连 #46/#47 的价格弹性补员链与对端 #115 的排序）；
  若停在 8 ⇒ 是一批性事件，撤掉这条线。
- V2：读 `kernel.expectations` 里 W36S58 的 `workers` 是否回到 >0 ⇒ 若回了而 `siteStaleNoWorker` 仍不消失，是我的判据有问题；若没回 ⇒ 编制侧真没补人。

**对 #50 的影响（只登记，不重算）**：#50 的代价那一栏写的是"关远矿赔 ≈19.9/拍远矿能量"，而 W36S58 这条线**此刻已在停摆边缘**
⇒ 那个 19.9 是"历史满编"的数，不是"现在还能拿到"的数。**在重新量到每房远矿收入之前，不要把 19.9 当作现状引用**（对端 R131 也独立指出过这条收入的重要性，同一口径风险）。
**边界**：单房原文读数 + 三处差分，全部 Memory-API 现读、零 console、零写；`peek` 在这轮出现过 **connect timeout（UND_ERR_CONNECT_TIMEOUT）** 两发，
重试即通 ⇒ 记成"瞬时网络失败形状"，不要读成"键不存在"（我第一发差点这么读）。

### R295（10-04 11:4xZ，本会话）分布判据**未成立**，因为采样器自己有三处缺陷——先把失败形状记死，不给它出结论的机会
`drift-dist.sh` 跑起来后（`tmp/observe/drift-dist-W37S58.log`），我写了配套解析器 `drift-dist-report.cjs`，第一发解析结果就不可信，
原文日志给出三条独立缺陷：
1. **API 中途在抛错**：块里出现 5 行 `Node.js v24.18.0`（= `peek.mjs` 的 `UND_ERR_CONNECT_TIMEOUT` 崩栈被 `tail -1` 原样写进日志），
   且 `baseline_t=0`（开局第一发 `rd t` 就失败）。⇒ 失败被当成"一个读数"存进了判据链的形状，必须在工具侧拒收（崩栈行 ≠ 数据行）。
2. **相邻两个窗口的记录逐字段相同**：`pl=[921441,923617]`/`ce=[4815,7105]`/`cr=896900`/`dr=1986`/`bk{harvested:1000,spawned:700,towerSpent:110}`
   在 t=…829 与 t=…879 两行**完全一致**。一个活房的采集量不可能两窗同数 ⇒ 这是**落盘/缓存相位**（Memory 只在 flush 那拍变），
   与本项目早就记过的口径「`ws`/`bk` 只在 flush 才变 ⇒ 轮询器要 flush-aware」同族。⇒ 判据必须按 flush 去重，否则我把一个窗当两个窗计数。
3. **解析器对坏行没有防御**：`num()/arr()` 把崩栈行读成 `undefined/NaN`，于是 `Δcr` 出现 `NaN`、`t` 出现 `undefined`，
   而 `SUMMARY` 照常用这 2 个"窗"算出了 `mean/meanAbs=1.00 ⇒ 单边`。
   ⇒ **这正是我给自己立过的规矩要拦的那一类**：`head`/解析把坏样本喂进统计，出来的数字看着最"干净"（n=2 还正好给 ±1），
   但它既不是分布也不是判据。**所以我没有把 R294 预注册的 V 判据写成结论**，也没有引用那个 1.00。

**当前状态**：R294 挂的"取 5~10 窗 drift 分布以分『窗太短的双向抖动』与『单边漏记』"这条**仍未成立**；
已成立的只有 R293 的三窗恒等式自校（`drift(由 bk 组) == 读数 dr` 逐位 OK，含本轮 `+1,986` 这一窗）。
下一手的规格（照抄即可，不需要重新设计）：
- 工具侧：`rd()` 里拒收含 `Node.js v`/`fetch failed` 的输出，读到坏行就**重试同一字段**而不是写进日志；
  快照带 `t` 去重（连续两行 `t` 相同 ⇒ 判为同一窗，丢弃后一行），并记录"本次是否跨过 flush"。
- 判据侧：分布至少 **6 个去重后的窗**，报 `mean/meanAbs` 的**同时报 n 与 pos/neg 计数**；
  `n<6` 时无论算出什么一律标 `INSUFFICIENT`，不许出"单边/抖动"的判断。
**边界**：本轮零 console、零 src、零 push、零 build；采样器仍在后台跑（8 窗），跑完后的原始日志按上面两条清理再判。

### R296（10-04 11:50Z，本会话）#114 判据链加固完成：五窗 drift 已有正有负，但**按我自己写的 n≥6 闸门，仍然不出判决**
`drift-dist-report.cjs` 这轮又抓出并修掉两处**我自己刚写下的**缺陷（都是"看着能算"的那种）：
1. **拼来的日志不按 t 排序** ⇒ 差分把不相邻的两窗相减，造出 `Δcr=+10,650` 这种荒谬数；现在先 `sort((a,b)=>a.t-b.t)`。
2. **排序还不够**：中间丢过一块（坏行被拒收）时，前后两块不相邻，`Δcr` 会跨窗相减 ⇒ 实测造出 `−7,798`。
   现在要求 `t` 差恰为 `windowTicks=50` 才给 `pools` 列，否则输出 `N/A`（drift 本身来自读数、不受影响，所以不整体丢窗）。
3. 无 `bk` 的窗（`roll-poll.sh` 压根没读那一列）以前被算成"不闭合"，现在记 `no-bk` 并从自校分母里摘出去。
4. 崩栈行（`Node.js v` / `fetch failed`）从数据流里拒收，本轮日志里 **6 行**全是这类。

**现有可用窗（去重、拒坏行后）**：`drift = +1,324 / −639 / +1,986 / −1,248 / +1,726`（W37S58，t=83414729…83414979）。
- 正负各半（3 正 2 负），`mean=+630`、`meanAbs=1,385` ⇒ `mean/meanAbs ≈ 0.45`，**贴着**我 0.4 的"抖动"阈值但没有余量。
- `n=5 < 6` ⇒ 输出 **`VERDICT=INSUFFICIENT`**，不写"单边"也不写"窗太短"。**这一条是 R295 自己立的规矩在起作用**：
  上一轮 n=2 时它算出过 `1.00 ⇒ 单边`，那一行现在被证明是坏样本喂出来的，不是现象。
- 自校仍在工作：本轮新增的两窗（83414929/83414979）`drift` 都由 `bk` **逐位复现**（−1,248、+1,726），
  累计已有 **5 个窗**做到这一点 ⇒ 恒等式与字段清单（`INCOME=harvested/bought/imported/recycled`、
  `CONSUMPTION=spawned/upgraded/built/repaired/towerSpent/sold/exported/tradeFee`、`pickedUp 不在 income`）是可靠的。
**判决条件（不变，等窗数够）**：≥6 个相邻去重窗后，`|mean/meanAbs| ≤ 0.4` ⇒ 判"50 拍窗对 drift 太短、`ws` 的同量级警语在该窗长上先天不可分辨"；
`> 0.4` ⇒ 按符号找"被记成消耗却仍在 tracked 池"（正）或"未记账的实际流出"（负）。
采样器（后台 `drift-dist.sh W37S58 8`）仍在跑；日志与工具都是只读产物，谁都能重跑：
`bash tmp/tools/official/drift-dist.sh <房> <窗数>` 然后 `node tmp/tools/official/drift-dist-report.cjs tmp/observe/drift-dist-<房>.log`。
**边界**：本轮零 console、零 src、零 push、零 build；改动只落在 `tmp/tools/official/`（不进产线，不影响 A/B 窗）。

### R297（10-04 11:5xZ，本会话）#114 的 n 从"等窗"变成"救窗"：链式相邻性 + 内容去重，现有 5 窗（阈值 6）
把解析器的相邻性判据从 `Δt==50` 换成**池面链**：`前一窗的 trackedEnd === 本窗的 trackedStart` 才是紧接的一窗。
这比 `t` 相减更强，直接带来三件事：
1. **救回缺 `t` 的窗**：某窗只有 `t` 那一行是崩栈行，旧版整窗作废；新版按日志原序挂链，`t` 缺失也能用
   （表里那一行的标签是 `83414779+链`）。合并 `roll-poll.log` + `drift-dist.log` 后 usable 从 3 → **5**。
2. **去重不再依赖 `t`**：改用 `(pl 两端, dr)` 作内容键，实测 **`duplicateSnapshots=1`**
   ⇒ R295 里我怀疑的"相邻两行逐字段相同 = flush/缓存相位"**第一次被工具自己确认**（而不是我的解释）。
3. **链不上的窗自动降级**：`Δcr`/`pools` 标 `N/A`（本批 5 窗里有 1 窗就是这种"能用但不相邻"的，只贡献 drift 不贡献分项）。

**当前 5 窗（W37S58）**：`drift = −639 / +1,986 / −1,248 / +1,726 / +931` ⇒ 3 正 2 负，
`mean=+551`、`meanAbs=1,306`、`mean/meanAbs = 0.42` —— **贴着我 0.4 的阈值但没越过**，且 `n=5 < 6` ⇒
工具输出仍是 `VERDICT=INSUFFICIENT`。**我不因为数字"看起来像抖动"就提前判决**：上一轮 n=2 时它给过 1.00 的"单边"，
那一行现在正是被这套加固否掉的对象。
**自校状态**：有 `bk` 的窗 **4/4 逐位复现 drift**（链式相邻 4/5）。这条是本轮最硬的收获——
它意味着 `INCOME/CONSUMPTION` 字段清单、`pickedUp 不在 income`、`bk=本窗增量` 三件事在 4 个独立窗上都成立，
所以 **#114 无论最后判成哪一边，都不会是"公式读错了"**。
**判据（原样不动）**：第 6 个窗到位后，`|mean/meanAbs| ≤ 0.4` ⇒ "50 拍窗太短、ws 的同量级警语在该窗长上先天不可分辨"；
`> 0.4` ⇒ 按符号去追分项（正=被记成消耗却仍在 tracked 池；负=未记账的实际流出）。
**边界**：单房；`t` 缺失窗的定位靠日志原序（若两份日志拼接顺序错，链会验不上并自动 N/A，不会污染判决）；
采样器仍在跑（8 窗上限），官服 API 这几分钟在抖（6 行崩栈）。本轮零 console、零 src、零 push、零 build。

### R298（10-04 11:5xZ，本会话）#114 **判决成立**：drift 在 50 拍窗上是双向抖动（n=6，3 正 3 负，mean/meanAbs=0.17）⇒「同量级 ⇒ nf/G4 不可信」这把警语在该窗长上没有分辨力
第 6 个窗落进来后，加固过的解析器自己越过了 R295 立的 `n≥6` 闸门并出判：

```
n=6  pos=3  neg=3  mean=+230  meanAbs=1,317  mean/meanAbs=0.17
VERDICT: 双向抖动 ⇒ 50 拍窗对 drift 太短，ws 的「同量级⇒不可信」在该窗长上先天不可分辨
自校：5/5 窗 drift 由 bk 逐位复现（另 1 窗无 bk，不计入）；链式相邻 5/6 窗
```
六个窗的 `drift`：`−639 / +1,986 / −1,248 / +1,726 / +931 / −1,374`（W37S58，t=83414779→83415079，同一段 boot、线上未换码）。

**这条判据自己站得住吗——做了敏感性核算（不是"看着稳"）**：阈值 0.4，现值 0.17。再加一个窗 `x`：
`ratio = (1,380 + x) / (7,902 + |x|)`。
- `x = +1,300` ⇒ 0.29；`x = +2,600` ⇒ 0.38；`x = +4,000` ⇒ 0.51 ⇒ **要翻判，需要一窗 |drift| ≥ ~3,000**，
  而六窗实测最大 `|drift| = 1,986`。⇒ 判决对"再来一窗"是稳的，除非出现历史上没见过的量级。

**于是 #114 的定性改了**：从"疑似单向漏记（账实不符）"改为**判据分辨力不足**——
`ws` 拿 Σdrift 与 ΣflowBalance 的比值报警，而 drift 本身在 50 拍尺度上是零附近双向抖动，
所以"同量级"这件事**不需要任何漏账就能发生**。⇒ **我此前几轮追的那个"+212 / −639 残差"不是一个待解释的物理量，
而是短窗噪声**（R289→R297 那条线索到此收口；R292 的 `spawned` 主项说法早在 R293 就被窗 2 否证了）。
**保留的边界**：这只说明"该窗长证不出漏账"，**不等于证明没有漏账** ⇒ 要真排除，得把 `ws` 的聚合从"6 个短窗"拉到长视界
（现成候选：`Memory.kernel.gateNetFlow` 那条 τ≈5,000 拍的慢 EMA，或把判据改成"连续 N 窗同向"）。两者都动 G4 的输入 ⇒ **仍属人**，我不起手。

**对 #88 请示的措辞影响（更具体了）**：原来写"G4 绿在被警语标为不可信的输入上"；
现在能说的是：**那条警语在这个窗长上给不出"不可信"的证据**，所以"不可信"三个字不该继续挂在 G4 上，
但它也不能反过来当"已验证可信"—— 准确措辞是**未验证**。#88 的两个选项因此收敛成一个：把判据从比值改成同向性（或拉长窗），
而不是去补一个并不存在的漏账。

**下一步（按优先级）**：① #114 结案文书（本案可标"判据分辨力不足"结案，留一条"长视界复测"的可否证尾巴）；
② #88/#111 都等一次上线才能收现场读数（四笔含 src 的提交仍未推）。
**边界**：单房（核心房）、6 窗、同一 boot 段；幼房与远矿房的 `drift` 分布**没测**，
所以这条结论**不可外推到全帝国**——幼房的窗里 `spawned`/`imported` 结构不同，需要另采。

**R298 附（同会话，复测确认）**：第 7 个窗落进来后判决不变 —— `n=7 pos=4 neg=3 mean=+212 meanAbs=1,144 ratio=0.19`，
自校升到 **6/6 窗逐位复现 drift**。敏感性核算当时预测"再一窗只会把 0.17 推到 ~0.19"，实测正是 0.19 ⇒ **判据的稳健性这一条也被复测到了**。
仍未变的边界：只有 W37S58、只有这一段 boot；幼房/远矿不可外推（要判决换房，重跑同一个工具即可，成本 ~3 分钟）。

### R299（10-04 12:0xZ，本会话）**撤掉我自己 R298 的"判决稳"**：八窗后 ratio 爬到 0.35，翻判只需一窗 >+826；正确说法是"这个窗长没有分辨力"
`drift-dist.sh` 跑满后合并两日志得 **8 个窗**（自校：有 `bk` 的 **7/7 窗逐位复现 drift**，链式相邻 7/8）：
`−639 / +1,986 / −1,248 / +1,726 / +931 / −1,374 / +101 / +2,039` ⇒ 5 正 3 负。

- `mean = +440`，`sd = 1,427`，`se = 505` ⇒ **`mean` 的 95% 置信区间 = [−549, +1,429]**。
- `mean/meanAbs` 的轨迹：**0.17（n=6）→ 0.19（n=7）→ 0.35（n=8）**，阈值 0.4。
- 翻判所需的最小下一窗：解 `(8·440 + x)/(8·1,256 + x) = 0.4` ⇒ **`x > +826`**，
  而**八窗里已经有 4 窗超过 +826**（1,986 / 1,726 / 931 / 2,039）。

⇒ **R298 附里"判决对再来一窗是稳的"这句话作废**：那时 n=6 的余量靠的是均值接近零，而均值随样本爬到了 +440。
按我自己的规矩（过头的撤回同罪），要撤的是**"稳"这一支**，不是判决本身。

**现在能负责地说出口的版本**（这是**判据能力**的陈述，不是现象的陈述）：
50 拍窗的 `drift` 均值**既与 0 不可区分，也与 +1,400 量级的一边偏不可区分**（同一区间覆盖两者）
⇒ `ws` 的「Σdrift 与 ΣflowBalance 同量级 ⇒ nf/G4 不可信」在这台仪器的窗长与样本量下**给不出结论**；
它同样**不能**被反过来用来宣布"没有漏账"。R298 里"双向抖动"这四个字容易被读成"证明了没有漏账"——**那是不该的读法**，本节予以限定。
**要真出结论只有两条路**（都动 G4 输入 ⇒ 属人）：①把判据换成长视界（`Memory.kernel.gateNetFlow`，τ≈5,000 拍，现成）；
②把"比值"改成"同向性"（连续 N 窗同号才报警），并按上面这个 se 反推：要把 `mean` 的 CI 收到 ±300 需要 `n ≈ (1.96·1427/300)² ≈ 87` 个窗
⇒ **~4,300 拍（按 3.7 秒/拍 ≈ 4.5 小时）**。这个代价先算出来，再决定值不值得为它改一次判据。

**顺带把 R294 的 V2 收掉**：`kernel.expectations.violations` 现读
`siteStaleWorkerIdle:W36S58:*` ×3（`workers=2`，`noProg=8,012`）与 `siteStaleWorkerIdle:W37S57:*`（`workers=4`，`noProg=7,004`）
⇒ W36S58 的带 WORK 编制**回来了**（0→2），而 `noProg` 继续每拍上涨 ⇒ 那一房的"交通停"是 ~20 分钟的**瞬态**（R294 的"此刻空转命题"随之过期），
而**有人在场却不推进**这一类继续成立 —— 这正是我那把 `workerCreepsInRoom` 分叉要区分的两件事之一。
`noProg` 增量 +343 对 1,260 秒 ⇒ **实测拍长 3.7 秒/拍**，与本项目"换算一律写区间并按实测拍长"的旧规矩一致。
**边界**：仍是单房（W37S58 的 drift 分布 + 两房 violations）；幼房 W38S56 的分布采样器仍在跑，出数另记。

---

### 巡检 R135（2026-10-04 04:2xZ，本会话）**分支 A 命中：wave3 之后 spawn 拿到两个工位、速率 0.14 → 1.22/拍**；同日两件新事件：**G4 转红**与**持续战损成立**（我 R134 的"一批性"当场撤回）

**第 0 步与协议记账（本轮是新口径第一条完整跑完的轮）**
- `PATROL-PROMPT.md` 全文已读：**16,264 字节，当前 UNTRACKED**（`git status` = `??`，而文件自称 tracked）⇒ 口径正文此刻**不可 diff、不可回滚**，与其同步协议不符，属需要人处置的一条（我没有替它提交：不是我的文件，且纪律是只按显式路径 add 自己的文件）。本轮当时 HEAD=`a8bde65`。
- 一次虚惊换成一条纪律：HEAD 从我的 `6dafd9f` 变成 `a8bde65` 时我先查"是否丢动作"而非继续干活 ⇒ `merge-base --is-ancestor` 为真、`git show HEAD:src/...` 里 `isBlockingStructureType` 命中 3 次 ⇒ **我的 `c58ff9d` 与 R130–R134 docs 全在链上**，对端只是又叠了 `R286→R299` 十几笔。工作树只剩他们的 `.gitignore`（未 stage）+ 两个未跟踪 md。
- **动了哪些层（逐层归因）**：只有 **②选目标层**（新增 `### 4.0（10-04 04:0xZ 改写，R135）`，旧 `4.0-pre` 原样保留）。**没有 ①**（PATROL-PROMPT.md 未改 ⇒ 不需要方向声明）、**没有 ③**（src 未改）。
- ⚠️为什么必须重写 §4.0：协议规定 goal 取 §4.0 第一小节的原文，而那里躺着的是 10-02 21:3xZ 的 `#83/#85 两条预约 verdict`——早已结案/否证、四路 watch 脚本没在跑。**照字面读就会去追不存在的数据**。⇒ 建议对端也走同一节奏：**每轮如果改了下一轮主目标，就动 §4.0，而不是只写在文件末尾**（否则新协议会把人钉在两天前的目标上）。
- 按协议**删除**了我上一轮的预约型任务（self-scheduling 被禁止），判效预约改挂本节 + `AGENT.lock` R135 §六。

**一、goal 的 verdict：预写分支 A 成立**
- `kernel.bootstrap.W38S58` 由 `{until:83414757, waves:2}` → **`{until:83417257, waves:3}`**，home 人口 4→5 ⇒ **wave3 已发**。
- spawn 工地 `6ac17f2c…5a` 进度 **64（83414022）→ 1,850（83415491）** ⇒ +1,786/1,469 拍 ≈ **1.22/拍**（R134 是 0.14/拍，约 9 倍）；creep 侧**两只 builder 同绑 `…5a`**（`assignedAt=83414516` 与 `83415257`）= `maxWorkers=2` 用满。⇒ "spawn 拿到第二个工位"与"进度离开 0.14/拍"**两半都到手**。
- ⚠️两条不许越界的边界：①第二只 builder `83415257` 才到 ⇒ 1.22/拍 是**合计均值**，**不是双人瞬时速率**，我没拆人均（无读数支撑）；②`container` 这次读 2,084 而 R134 是 3,029 ⇒ 工地进度不可能倒退 ⇒ 判为**原 site 被 `stale-evict` 撤后重建**（第三个 creep 绑的 targetId 是新的 `…ba`，与 `…4c` 不同）⇒ **"c 变小"不是施工倒退**；同一机制很可能就是 #111 里 `progSum` 跳动的因（值得对端一次核）。
- ⇒ **`c58ff9d` 的收益定稿**：省掉"等人数超过对手工位"那段，实测 **3,695 拍**（当前拍长下 ≈2.6~4 小时）。剩余 `13,150` 按 1.22/拍 ≈ **10,800 拍 ≈ 11~12 小时**（拍长见 §三，别当常数）。
- ⇒ **给您的决定（不催推）**：这房已自走正轨，修复买来的是"以后每次扩张少等约 3,700 拍"，不是"这次能不能活"；而 push 会连带对端 `27a8a51`/`b20a67b`/`c58ff9d`/`0d8e1db` 四笔一起上线，且一次部署 = 清堆 + ≈400 拍 G6 税，**此刻 G6 正缺 3.93/拍**。四笔要不要一起走属排产决定 ⇒ 不自办，保持 `c58ff9d` 在本地。

**二、新事件：G4 转红（我 R134 说"该盯 Σ 会不会跌破 5"，本轮跌破）**
- `failedGates` 本轮逐字五条：`G0 + G2 + G3(critical netFlow=4.5,core=1) + **G4: net flow(v=4.5|netFlow ≥ 5)** + G6(tier=tight)`；`kernel.gateNetFlow` = `1.690 + 3.402 + (−0.409) = 4.683`（R134 = 8.067）⇒ **掉的主要是核心房（4.210 → 1.690）**。
- **R134 的"仪器方向相反"本轮按房一比就收敛**：核心房 storage `894,587 → 879,988` = **−10.1/拍**，与 Σ_core 同向 ⇒ 上一轮的"相反"是**跨房合计的 EMA vs 跨房合计的物理量不同源**造成的假象（幼房在攒、核心房在掉）。⇒ 方法论进 §读数口径：**比较净流要按房比，不要拿帝国合计比。**
- 仍然不做：不 I 反解（R132 已撤出决策输入）、不因此说"账本坏了"（对端 R298/R299 已判 50 拍窗 drift 是双向抖动、该仪器无分辨力）、**不动阈值解闸**。

**三、新事件：持续战损成立（撤回我自己 R134 那句"一批性事件"）**
- `deathByCause` = `{natural:247, **combat:10**, recycled:4}`；序列：我 R134 combat=3 → 对端 R294 combat=8（03:44Z）→ 本轮 **10** ⇒ **约 1.5 小时 +7**。对端 R294 的 V1 门槛（"再 +≥3 才算持续战损"）**已越线**。
- ⇒ **§2 矩阵里"战争：和平期线上无敌情可采"和 #90 的"9 次目击、0 战损"两条从此作废**，应改为"线上有敌情且已产生持续战损"。**本轮我没动 §2 正文**（与对端同段、避免并发改写；下一轮带读码一起改）。旁证：`W38S56.hostileAt 83410016 → 83414733`。
- ⚠️仪器缺口第二次撞上：环内**仍采不到** `EnemyInvasion/EnemyCleared/TowerVolley` ⇒ "谁在打"无出处。下一轮一发读码：该事件的发射条件是否要求自家房视野。不做的事：不改防御阈值、不制造敌情、不动 posture。

**四、其余差分（本轮带一条拍长漂移）**
- **拍长 ≈3.78 s/拍**（Δtick 1,443 / Δ墙钟 ≈93 分钟；R134 是 2.62s），且 observe 的 10 拍测速本轮报 **"不可测（25 秒内未推进）"** ⇒ 官服在抖（对端 R295 也报 peek `UND_ERR_CONNECT_TIMEOUT`）⇒ **本轮全部 ETA 都带"拍长 3.8s 且不稳"**。
- CPU：`窗口=8187t 总=15.93/拍` ⇒ **缺口 3.93/拍**（R133 3.77 → R134 3.88 → 本轮 3.93，三窗连涨）；A 路线杠杆 remoteHarvester 1.89 + remoteHauler 0.79 ≈ **2.68**（比 R134 的 2.84 又缩）⇒ **缺口涨、杠杆缩**。⚠️代价栏按对端更正：**"19.9/拍远矿收入"是历史满编数，不再当现状引用**（W36S58 此刻在停摆边缘）。§3.5 正文我未改（同段避免双改）。
- 每房 CPU `{W38S58:0.601, W38S56:1.846, W37S58:2.56}`；人口 44（24/15/5）；`skippedPerTick 10.6`、`errorsPerTick 0`、`tier=tight@83387005` 未翻；扩张 `state=bootstrapping`、`Readiness=NOT_READY`、`Pressure=MEDIUM(0.57)`、`Budget=168,878/981,842`、`Plan W37S56 ready=101,981t`。
- #111 侧只登记：`W36S58 roadsBuilt 8→6 sites=4 progSum=355`、`W37S57 roadsBuilt=26 sites=11 progSum=270 建成intent 174→298`、`W37S56 sites=8 progSum=145 建成intent 0→29`。
- 探针与边界：`observe×1 + peek×2 + console-eval×1`（mark=C1，payload 未截断），取探针前 pgrep 无并发 console 探针；**零 src、零 push、零 build、零 npm**；`.gitignore` 未 stage、`git stash list` 空、git 领先 48 / behind 0。

### R300（10-04 12:2xZ，本会话）#114 跨房对照完成：幼房给出**带排除界限的正结论**，核心房只是噪声大 ⇒ 本案可结案为"无跨房一致漏账"
两台仪器同跑（`drift-dist.sh`，零 console），两房的 `bk` 结构确实不同（幼房以 `upgraded/repaired/imported` 为主，核心房以 `spawned/towerSpent/sold/tradeFee` 为主）
—— 这正是 R299 里"不可外推"那条边界的检验，所以必须分开算。

| 房 | n 窗 | drift 序列 | mean | sd | se | 95%CI | mean/meanAbs |
|---|---|---|---|---|---|---|---|
| W37S58 核心房 | 8 | −639 +1,986 −1,248 +1,726 +931 −1,374 +101 +2,039 | **+440** | 1,427 | 505 | **[−549, +1,429]** | 0.35（贴阈 0.4） |
| W38S56 幼房 | 7 | +727 −720 +40 −55 −50 +5 +10 | **−6** | 459 | 187 | **[−490, +473]** | −0.03 |

**幼房这一行才是有内容的结论**：它的 drift 幅度比核心房小一个数量级（`meanAbs` 230 vs 1,256），
7 窗的均值置信区间是 **[−490, +473]** ⇒ **在幼房，任何 |一边偏| > ~490/窗 的漏账被 95% 排除**。
这不是"没分辨力"，是**一条带界限的排除**。核心房则相反：大脉冲（单窗 `spawned` 到 7,450）把 scatter 撑到 sd=1,427，
所以它的 +440 既不能确认也不能否认 —— 与 R299 的判定一致。

**两房合读 ⇒ #114 可以这样结案**：
1. **没有跨房一致的一边偏**。若真有"单向漏记"，它必须满足：幼房 < ~490/窗、核心房可到 ~1,400/窗 ⇒ 那只能是**与核心房大脉冲同源**的效应，
   而不是通用的记账缺口（幼房同样在孵化、同样在采集，却没这个量级）。
2. **R292 的"孵化 = drift 正项"第三次被否**：核心房内 `corr(spawned, drift)` 现算 **r = −0.47（n=7）** ——
   不仅不是正相关，方向还是**反的**（`spawned` 最大的那一窗 7,450，drift = −1,248；`spawned=0` 的两窗 drift = +1,726 与 +101）。
   r=−0.47 在 n=7 上不显著（p≈0.3），所以我只说"**没有正相关证据**"，不说"有负相关"。
3. **残留问题被限定成一句话**：核心房那个 +440 的均值到底是噪声还是真小偏，**当前仪器答不了**；
   要答只有两条：把 CI 收到 ±300 需 `n≈87` 窗 ≈ 4,300 拍 ≈ 4.5 小时，或换长视界 `kernel.gateNetFlow`（τ≈5,000，现成）。
   ⇒ 改判据/加长视界都动 G4 输入，**属人**；而"什么都不做"现在有了量化理由：幼房侧已排除大漏账。
**自校**：幼房 **7/7 窗 drift 由 `bk` 逐位复现**、链式相邻 7/7 ⇒ 跨房比较的分子分母口径一致（护栏 §19(a) 说的"跨房逐窗配对不成立"这里没违反：
两房的窗是各自独立分布，我只比统计量，不配对同一拍）。
**边界**：两房、同一 boot 段（线上 sha 未变）；W38S58 危机房**没测**（它的池子几乎为空，drift 定义仍在但量级由孵化预留主导，另说）。

### R305（10-04 12:4xZ，本会话）#109 被现场否证：**按人归因的冷存在线上是活的**（段 5 非空、epoch 新鲜），整条侦察→持久化链读码闭合
先说撤什么：**"#109 情报玩家域冷存从未落地：段 5 线上为空 ⇒ 按人归因的敌意记忆不跨部署"这条作废**（它此前被我用作 #108 修法的前置依据）。
现场读数（`/api/user/memory-segment`，零 console，同一请求形状逐段取，避免多段请求退化成 1 字符桩）：
```
segment 2: len=22428  {"events":{"d":[{"t":83414869,"k":17,"r":"W38S56",...
segment 3: len=26353  {"economy":{"d":[{"t":83414755,"r":"W37S58","rs":921405,...
segment 4: len=58580  # HELP screeps_runtime_cpu_used ...
segment 5: len=  292  {"epoch":83415703,"players":{"Aguia":{"lastSeenAt":82657950,...
segment 6: len=    0
```
⇒ **段 5 有内容**，且 `epoch=83415703` 就在当前 boot 段内（本文件上一节读到的 tick 是 83415179）⇒ **写者真的跑过**，不是初始化桩。

**链的三段现在都是读码确认的，不是推测**（我把"没接线"这个判法收回来，因为它正是我这两天犯过的错）：
1. 采集：`room-observer.ts:142` `observer.observeRoom(target)` ⇒ 下一 tick 捕获（`:37/:148`，系统 `interval=1` 即为此约束）；靶子取自 `Game.map.describeExits` 的 8 邻居，按"未知 > 陈旧"排序。
2. 采用：`intelligence.ts:54-70 adoptHandoff()` 把 `globalCache().intelHandoff` 转成 `IntelEntry`，**并对带 owner 的观测调 `upsertPlayerObservation(...)`**（跳过 `INVADER_USERNAME`、带 `isBlacklistedRoom` 标记），随后清空缓冲。
3. 持久化：`segment-store.ts:529-546` 在 `intelPlayersDirty && intelPlayersSeg` 时把玩家域写进 `RawMemory.segments[5]`，带**容量守卫**（超 `SEGMENT_SIZE_LIMIT` 时按 `lastSeenAt` 裁掉最旧一半）；`:177` `RawMemory.setActiveSegments(ALL_SEGMENT_IDS)` 注册；`:108` 注明激活要下一 tick 才生效。
⇒ 所以"冷存没落地"从来不是结构缺陷。真正的问题是**数据薄**：段里只有 1 个玩家，且 `lastSeenAt=82,657,950`——比现在旧约 **75.7 万拍**（≈ 按 3.7 秒/拍折 32 小时以上）。

**这把 #100/#108 的取舍改写回另一个方向**（对照我 40 分钟前的两条错误表述）：
- #100：不是"缺侦察能力"也不是"缺持久化"——两者都有；**缺的是让靶子按敌情价值排序**，
  否则 Observer 只会刷"没见过的邻房"，玩家房一旦有了初次视野就再不被刷新（`INTEL_STALE_AFTER` 只按陈旧）。
- #108（按人归因的敌意记忆在写、四个威胁消费者全读房级不认人的键）：**这条不受本次更正影响**，因为它说的是"消费者读哪个键"，
  而存储侧现在确认是活的 ⇒ 接线的**前置条件已具备**，#108 从"等冷存落地"变成"纯消费者改造"。
- #109 结案为：**非缺陷**，改判为"低频/薄数据"现象；留一条可否证的尾巴——
  若后续读到段 5 的 `players` 键数长期 =1 且 `lastSeenAt` 最值不推进，那说明写入虽通但**采集面太窄**（回到 #100 的权重问题），而不是持久化坏。
**自纠记录**：本轮我在这个主题上连错两次（`.observe(` → 假"没接线"；`intelHandoff` → 假"只在 heap 会丢"），
两次的成因相同：**只搜了一个我脑中的名字/只看了链路的一段就下结论**。规矩已升级为前置闸门（负向结论必须带确切搜索串与名字来源），
这次再加一条：**判链路要看"写者 + 采用方 + 持久化"三段，缺一律不许说"整链不存在"**。
**边界**：段 5 内容我只读了前 292 字节里的头部（键名与一个玩家条目），没有逐字段核 `playerEntries` 的完整结构；
本轮零 console、零 src、零 push、零 build。

### R306（10-04 12:4xZ，本会话）#100 卡住的真正原因是**侦察链自我不可见**：`observeRoom` 成功与否既没有事件也没有 gauge
把"零 console 能不能判定核心房有没有 Observer"这条路走到尽头，结论是**不能**，而理由本身就是一条缺陷：
- 段 4（prometheus，58,568 字节）里与 observer 有关的只有内核调度 histogram：
  `screeps_kernel_process_execution_seconds_*{process_type="room-observer"}`（bucket 到 `le=0.5` 是 **4058**）
  ⇒ 这**只证明这个系统被调度跑过**，不证明它真发出过 `observeRoom`，更不证明房里有那栋楼。
- 段 2（事件环，本轮读到 41 条 `k=0` 等 13 个类目）里 **`observ` 文本命中 = 0**
  ⇒ `room-observer.ts` 全程没有任何 `recordEvent`：`:140 if (!target) return;`、`:120 if (!exits) return;`、
  `:142` 成功后也只是写 `pendingSlot().pending`（heap），**没有留痕**。
- `Memory.rooms.W37S58.layout` 的键只有 `version/templateId/state/revision/nextPlanTick/anchor/anchorScore/planStage`
  ⇒ 计划态不携带"某类结构是否已建成"，所以从 Memory 侧也**推不出**楼在不在。
⇒ 三处都读空之后，**"这条侦察链是否在真产出视野"是一个无法从落盘数据回答的问题**，
而它恰好卡住 #100 与 #109 尾巴的判决（段 5 只有 1 个玩家：是"没采集"还是"采到但没人"？现在两种解释都证不了）。
这正是 §19「自度量器的诚实性」该收的一条：**能力存在 ≠ 能力被观测到在运行**。
本会话我在这上面已经付过一次学费（`intelHandoff` 我一次读成"会丢"、一次读成"活着"），所以这次不落一个计数器就别再靠推断过案。

**修法规格（三行，纯观测、零行为改动，与 `noEnergyInRange` 同族，可随下一批一起走）**
1. `room-observer.ts:142` 分支上按返回码记两个桶：`ok / errBusy / errOther`（放 heap `globalCache().observeCounters`，随 telemetry 落 `Memory.kernel.stats.observe`）。
2. `:140 if (!target) return;` 记一次 `noTarget` ⇒ 区分"没楼 / 有楼但无靶"，因为 `!observer` 与 `!target` 现在都静默。
   （更干脆的做法：在系统入口区分三种早退 `noObserver / noExits / noTarget`，各一个计数。）
3. telemetry 侧顺手出一个 gauge `screeps_observe_total{result="ok|busy|noObserver"}` ⇒ 段 4 里就能直接读到，巡检零 console。
判据（上线后）：`observe{ok} > 0` ⇒ 楼在且能用，#100 就只剩"权重/半径"两件事；
`noObserver` 占多数 ⇒ **楼没盖出来**，#100 的第一动作变成"让布局把 observer 排进建造队列"（那是 §15 的施工优先级，不是侦察逻辑）。
**边界**：本轮零 console、零 src、零 push、零 build；`4058` 是 boot 以来的累计调度数，不代表成功观察数——这正是本案的要害。

## R307（10-04 12:4xZ，本会话）L1 优先级重排：把本轮十处更正压成一张"按依赖排序"的下一轮清单
本节**只排序与给验收标准**，不改前面任何一节的读数（append-only）。排序依据是"做完它能为别的决定买到证据"，不是工作量。

**P0｜一次部署（当前唯一的硬阻塞）**
- 状态：`27a8a51`(#113 违例留痕) + `b20a67b`(#103 拒因分离) + `c58ff9d`(对端 #115 排序) + `0d8e1db`(#111 `noEnergyInRange`) 四笔含 src 停在本地，ahead=57；线上 `d2f0b0cd00ad`。
- 为什么排第一：**四条判决都卡在"上线后读一次"**，而它们分别锁着 #111、#100、#108、#114 的取舍。部署一次 ≈400 拍 G6 税 + 清堆。
- 验收（部署后第一读，全部零 console）：①`kernel.stats.roadBuild.<房>.noEnergyInRange` 出现且 `>0` ⇒ #111(B) 有价格；恒 0 而 `noEnergy>0` ⇒ (B) 结案为"不该做"。
  ②`kernel.expectations.recent`（#113 的新键）有条目 ⇒ 违例可跨拍归因；缺键 ⇒ 说明 telemetry 那侧没落，属部署失败而非判据失败。
- 归属：**授权属你**（L0 §1.5 把生产部署列为须授权项）。

**P1｜给侦察链装"自证痕迹"（三行，纯观测）——它是 #100 与 #108 的共同前置**
- 依据：R306 证明"核心房有没有 Observer 楼 / 是否真发出过 `observeRoom`"当前**无法从落盘数据判定**（段 4 只有调度 histogram、段 2 无事件、`Memory.layout` 无建成态）。
- 规格与判据见 R306：入口区分 `noObserver/noExits/noTarget`、`:142` 按返回码分桶、遥测出 `screeps_observe_total{result}`。
- 做完能买到什么：`ok>0` ⇒ #100 只剩"靶子加敌情权重 + 候选池扩到射程内"两条纯逻辑改动；`noObserver` 占多数 ⇒ 第一动作变成 §15 的施工优先级（让 observer 进建造队列），**侦察逻辑根本不该动**。
- 我本轮没落它的原因（写清以免被当已做）：完整改动跨 4 个文件（domain 纯函数 + room-observer 三处 + telemetry 落 Memory/段4 + 单测），轮次不足以做完；**只做纯函数或只做 heap 计数器会造出一个没人读的死件**，而 heap 计数器不可见正是 R306 的要害。
- 归属：代码不属授权项，可直接做；但**要随 P0 那一批走**，所以实际生效仍需你点头。

**P2｜#111 远矿道路：从"停摆"改判为"净衰减"，动作分两房**
- 依据：R290（差分闭合到单位 + W37S57 `roadsBuilt 27→26`、W36S58 回收丢 115 点进度）+ R294（E7 把 W36S58 切成 `workers=0`，随后 R305 前一读又见 `workers=2` ⇒ 那次是 ~20 分钟瞬态）。
- 下一动作：P0 上线后读 `noEnergyInRange/noEnergy` 的**分房比值** ⇒ (B) 只对哪一房成立就此定案；(A) 回收早被 R286 否证，别再列。
- 验收：给出"每房 (B) 的预期建成点数 = `noEnergyInRange × WORK·点/拍`"对照"缺口 `roadSitesPending×300 − roadProgressSum`"，再让你判交付率 −20~30% 换不换。

**P3｜#114/#88：警语形状改动（动 G4 输入，属人，我不动手）**
- 已成立：跨房无一致漏账（幼房七窗 mean −6、95%CI[−490,+473] ⇒ 排除 |>490/窗| 的一边偏；核心房 mean +440 CI[−549,+1,429] 未决）。
- 剩余动作二选一：把 `ws` 判据改"连续 N 窗同向"，或改用现成长视界 `gateNetFlow`(τ≈5,000) 当输入；第三条"补一个并不存在的漏账"已被排除。
- 验收：改后 `Σdrift` 与 `Σ spawned` 的比例关系消失，且 G4 的绿/红不因单窗孵化脉冲翻转。

**P4｜L0 §2.3 的 §3.8 八项记录：1/8 已做，别把"有入口图"当成"有矩阵"**
- 已做全：Observer（R305/R306 给出前置、输入输出、失败条件、射程与造价，其中 CPU/冷却在官方页未列 ⇒ 留空而不是编）。
- 待做七项建议顺序（都按"先取真名再搜调用形状"的规矩，见 R303/R304 的两条教训）：Safe Mode 激活链 → Nuker 发射链 → 矿物—终端—实验室链 → Power Creep 生命周期 → 市场订单 → Boost 链 → 跨 Shard（已知 `InterShardMemory` 零使用，是唯一一条**核过名字**的负向结论）。
- 每项的完成定义：**八栏齐**，其中"CPU 成本"与"失败条件"必须来自引擎返回值或 docs，不接受我脑补；负向结论必须同时给"搜的字符串"与"名字来源的声明处"。

**本轮明确不做的事**（避免下一轮误读进度）：不动 #50（G6 CPU 档，缺 2.4/拍，唯一杠杆 `CONFIG.remote.maxOperations`，代价 ≈19.9/拍远矿能量 + ~120 段已建路，且 R294 已标注那个 19.9 是历史满编数、勿当现状）；不开战造证据；不删 domain 零导入者（#107 属人）；不推任何提交。

### R308（10-04 12:4xZ，本会话）第四条路也读空：**"楼在不在"目前没有任何落盘答案**，P1 的必要性就此封死
继 R306 的三条（段 4 只有调度 histogram、段 2 无 observer 事件、`Memory.layout` 无建成态）之后，本轮试了第四条我认为最可能成的：
**段 0 是布局段**，若它记已建/待建格与结构类型，就能直接答"observer 盖了没"。
现读：`segment 0 len=157`，全文只有
`{"W37S58":{"overrides":{},"blocked":{}},"W38S58":{...},"W36S58":{...},"W38S56":{...}}`
⇒ 段 0 只存 **overrides/blocked 两类覆盖项且全空**，不含任何结构清单；`observ` 命中 0；按 JSON 递归找 `type|structure` 字段得到的计数集是 `{}`。
**结论（写死以免下一轮重复踩）**：当前落盘数据里**没有**能回答"核心房是否存在 StructureObserver"的位置，
四个独立来源都是空。所以这不是"我还没找到"，而是**这条能力自我不可见**——R306 的定性成立。
⇒ 因此 P1（R307 里那条三行观测补丁）不是"锦上添花"，而是 **#100/#108 唯一的解锁动作**；
在此之前，任何关于"该加侦察权重还是该先让布局把楼盖出来"的讨论都是在没有读数的情况下选路，我不做那种决定。
顺带一条**新口径**（记进 §19）：`segment-store` 的段 0 只承载覆盖项 ⇒ 判"布局是否已建成"不能靠段 0；
而 `screeps_kernel_process_execution_seconds_*{process_type=...}` 的 bucket 值 = **被调度次数**，
与"该逻辑是否真的发出过引擎调用"之间**没有任何等式关系**（本案实测：4058 次调度 vs 落盘零痕迹）。

### R309（10-04 12:5xZ，本会话）危机房给出本会话**唯一一次"先预测后读数"的命中**：`loose` 的双重处理在线上精确相消
W38S58（危机房、bootstrap 中）第一次读就有内容，因为它的窗里 **`Δloose` 非零**（前两房一直是 0，所以那条分支从未在线上被跑到过）：
`pl=[133, 1321, 0, 0, 1200]` ⇒ `Δtracked=+1,188`、`Δother=0`、**`Δloose=+1,200`**；`ce=[98,201]` ⇒ `Δcarry=+103`；`cr=23`（只有 storage）；
`bk={"harvested":130,"upgraded":78,"built":64}`。
**先算后读**（这一步是我自己要求的可证伪形式）：
`income = harvested 130`；`consumption = upgraded 78 + built 64 = 142` ⇒ `flowBalance = −12`；
`drift = Δtracked − flowBalance − Δloose + Δother = 1,188 + 12 − 1,200 + 0 = **0**`。
现读 **`economy.dr = 0`** ⇒ **预测命中**。
**这条为什么值得记**：`loose` 既在 `trackedPoolsOf()` 里、又在 drift 公式里被单独减掉（`accounting.ts:191-201 / 269-270`），
注释声称"散落能量自然衰减单独报告、不影响 drift"，而此前它只在**单测夹具**里被验证过；
本轮它在一个 `Δloose` 达到 1,200 的真实窗里精确相消 ⇒ **该不变式第一次拿到线上证据**（也是 #40 那族"拾取/掉落记账"改动的下游一致性证据）。
顺带三个便宜但可靠的事实：危机房的桶形是 `{harvested, upgraded, built}`（没有 spawned/towerSpent/tradeFee）
⇒ 用同一套字段清单去算**任何房**的 flowBalance 都成立（现已在三种桶形上各自对单位：核心房 3 窗、幼房 6 窗、危机房 1 窗）。
**边界**：危机房只有 1 个窗，不构成分布；它的 `pendingHarvesters/low ea` 与 #115 同源（属对端域，我只登记）。
**方法留档**：本轮 #114 全程我错判三次（`spawned` 主项、`Δcarry` 解释、`ZERO` 缺口），
唯一一次"先写数再读数"的命中就是这条 ⇒ 后续凡是能提前算出期望值的判据，**先把期望值落进文件再取读数**。

### R310（10-04 12:5xZ，本会话）台账完整性更正：我这边有一处编号重复、四处编号缺席正文
自检命令与结果（可复跑）：
  重复：R135
  重复：R181
  重复：R182
  重复：R183
  重复：R184
  重复：R279
  重复：R289
  - 本轮我造成的重复：**R289** 被两个标题使用；位置如下：
    5300:### R289（10-04 11:2xZ，本会话）#114 的"反号"拿到数值分解：ΔspawnExt(+1,600) 与 Δcarry(+610) 掩掉了 Δstorage(−
    5328:### R289 更正（同会话，10-04 11:2xZ）：「一根时序项足以解释全部」是过头的——重算后它是单窗的 60%�
    5338:这不等于"Σdrift 全是时序"，剩下 ~413 与 R289 表里那 +212 库存残差同源（且同样受 ±24 拍错峰对齐影响�
    5388:这一支是**逐拍精确**的（不像 R289 用段 3 环，那套是错峰采样、±24 拍对齐差）。再用环里的 `ea`(=spawn
  - 早于本会话的重复（非我所为，不回改）：R135 / R181 / R182 / R183；另 R279 的双用我已记在 R287 附记里。
  - **编号有记录但正文缺席**：R301、R302、R303、R304 这四条更正写在 `CAPABILITY-MATRIX.md` 的 §20（含两次自我推翻 Observer 判定），只以括号号出现在提交信息里 ⇒ 只读 EVOLUTION-ROADMAP.md 的人拿不到它们。映射（供追溯）：
    R301=矩阵§20 首次覆盖对照(9603101)；R302=矩阵§20 第一次更正(2589471)；R303=矩阵§20 第二次更正，Observer 判错两次的错因(6be22bc)；R304=矩阵§20 附 ZERO 列大面积假缺口(9bfb37b)。
**规矩（对我自己）**：append 前先 `grep -c '^### R<号>'`；跨文件记录时，在两边各留一行指针，别只靠提交信息。

---

### 巡检 R136（2026-10-04 05:2xZ，本会话）**G4 转红只活了 ≈870 拍：H1「盈余真被花掉」被反号读数否证，控制组同样反号 ⇒ 是仪器口径，不是经济事件**；真正的坏消息在 G6

**第 0 步与协议记账**
- `PATROL-PROMPT.md` 全文再读 = **16,264 字节（与上轮同版）**，状态仍 **UNTRACKED** ⇒ 口径正文不可 diff/不可回滚，属人处置项（我没代提交）。本轮当时 HEAD=`fa8ec95`。
- **动的层：只有 ②**（新增 `### 4.0（10-04 05:1xZ 改写，R136）`，旧条保留）；①未改（故无需方向声明）、③未改（**src 零改动**）。objective 原文＝「按房差分 G4 的输入：核心房 Σ 从 4.210 掉到 1.690 是"盈余真被花掉"还是"仪器无分辨力"，结论交给 §3.5 的 #88/#50」。
- ★**方法一次升级**（执行对端 R309 的结论）：**期望值先写进 §4.0 再取读数**，并预先声明"单 span 符号不算趋势"。本轮 H1 就是被这条纪律当场否证的——若边读边解释，我会把"红了一发"讲成"经济在失血"。

**一、verdict（三条都有出处）**
- **G4 自己回绿**：权威 `failedGates` 四条 `G0+G2+G3(critical netFlow=5.5,core=1)+G6`；R135 逐字读到的 `G4: net flow(v=4.5|netFlow ≥ 5)` 在 83416284 变成 **v=5.5** ⇒ **红 ≈870 拍**。`gateNetFlow` 核心房 `1.690→3.248`、三房和 `4.683→**5.051**` ⇒ **帝国合计距门槛只剩 0.051**，字面贴线抖。
- **H1 反号否证**：核心房本窗 `bk={harvested:1000, repaired:48, imported:1450}`（`t=83416379`）按对端自校过的字段清单算 ⇒ INCOME 2,450 vs CONSUMPTION 48 ⇒ 净 **+2,402**，同窗 `nf/100=+12.31/拍`、storage `879,988→890,326`（**+11.9/拍**）。我写下的 H1 期望是"CONSUMPTION−INCOME≈+505/窗"——**方向反了**。
- **物理序列**：核心房相邻两跨 `−10.1/拍` 与 `+11.9/拍`，合并均值 ≈**−1.8/拍** ⇒ 近平坦均值上 ±11/拍 的摆，**不是趋势**。
- **控制组（决定性）**：幼房同窗 INCOME 900 vs CONSUMPTION 1,996 = 净 **−1,096**，而其 storage 在涨（`95,984→101,123`，+5.7/拍）⇒ **同一处"账面 vs 物理反号"在控制房里以相反方向出现** ⇒ 属仪器/口径性质，与对端 R298/R299"50 拍窗无分辨力"同调。⇒ 我不立账本案，也不追 2,402 与 11.9/拍 为何不等（缺窗口长度，且那是 #114 的工具域）。
- ⇒ **§3.5 的 #88 措辞**：**不该松** —— G4 不是稳定阻塞，贴线抖动会反复自红/自绿；今后引用它必须写成"第 N 窗读数 v=x"，不写"绿了/红了"。

**二、★本轮真正变坏的是 G6（且部署税这条解释被排除了）**
- `kernel.capacity={tier:**constrained**, since:83416306}`，距读数仅 ≈90 拍；`check-code` 两发都返回 `main:<786,453B sha=d2f0b0cd00ad>`（与对端 04:54 记录一字不差）⇒ **无人推码 ⇒ 不是 boot 税，是真实负载**。
- 累计账四轮连涨 `15.77→15.88→15.93→16.02/拍` ⇒ 对 12.00 门槛**缺口 4.02/拍**，而 A 路线杠杆 remoteHarvester 1.89 + remoteHauler 0.79 ≈ **2.68** ⇒ **缺口已超出杠杆约 1.3/拍**。⇒ **#50 的问题从"够不够"变成"关掉远矿也不够"**，第二条腿在哪属人排产；`traffic-manager 3.46/拍`、`snapshots 1.73/拍` 已被定性为结构性成本（"低于总负载 5% 不立案"仍挡着）。

**三、两条自我撤回（都是第二发读数打的）**
- **R135 的"持续战损成立"撤回一半**：`deathByCause={natural:274, combat:10, recycled:5}` ⇒ combat **10→10（≈1,100 拍 +0）**。序列是 `3 →(+7 集中一跨)→ 8 → 10 →(+0)10` ⇒ 正确说法是"**一次集中的 +7 爆发**（W39S56 弃道后滞留 creep），此后一跨零增长"。对端 V1 门槛（再 +≥3）本跨不满足 ⇒ 若下跨再 +≥3 才立"持续"。敌情仪器仍空（第三次撞上：环内无 `EnemyInvasion/EnemyCleared/TowerVolley`）。
- **R133 的"dangerUntil 到期不会复活车道"结果判错**：`remoteOps.W38S55` 本轮 = `{state:"active", createdAt:83415925}`，而 `dangerUntil=83415805` ⇒ **到期后 120 拍就新建了 op**（机制描述对、预测错）。同跨 `W38S56→W37S56` 由 active→abandoned。⇒ 含义登记：**危险冷却一过帝国会立刻把编制投回同一批远房**，若敌情仍在，这就是战损复发通道（要不要"连续损失后冷却加倍"属**安全语义，须请示**，不自办）。

**四、其余与边界**
- `bootstrap.W38S58={until:83417257, waves:3}` 未变（wave4 差 ≈840 拍）；`home=W38S58` 人口 **5→4**、`pressure=0.8`（最高）、`buildQueue 13→11`、`site=0` ⇒ #115 侧本轮无新判决性读数。
- 人口 48（26/18/4）；`errorsPerTick 0`；`skippedPerTick 6.2`；每房 CPU `{W38S58:0.423, W37S58:2.895, W38S56:3.186}`；拍长回到 **2.64s/拍**。
- 边界：**零 src、零 push、零 build、零 npm**；探针 `observe×2 + peek×2 + check-code×1`，**本轮零 console**（所需字段全在 Memory）；`.gitignore` 未 stage、`git stash list` 空、git 领先 61 / behind 0、线上仍 `d2f0b0cd00ad`。

---

### 巡检 R137（2026-10-04 06:2xZ，本会话）**G6 拆完了：增量不在编制（人口 48→43，creep 项 ≈−0.095/t），也不在任何单列；新的真实事实是"当前 17.43/t"比"窗均 16.16/t"差 ≈1.3/t**

**第 0 步与协议记账**
- `PATROL-PROMPT.md` 全文第三次读 = **16,264 字节，同版未变**，状态仍 **UNTRACKED**（自称 tracked）⇒ 口径正文不可 diff/不可回滚这条属人处置项继续挂着。本轮当时 HEAD=`6c8a53a`。
- **动的层：②**（新增 `### 4.0（R137）` 主目标 + 本条 + §3.5 #50 追加可决态一行）；**①③未动**（`src` 零改动、PATROL-PROMPT 未改 ⇒ 无需方向声明）。goal objective 原文＝「拆 G6 缺口四连涨的去向：`15.77 → 16.02/t` 的增量落在哪一列（房数 / 编制 / 远矿角色 / 系统侧），并把"关远矿也不够"摆成可决态」。
- ★**期望值先写后读**（R136 起的纪律，本轮第二次生效）：E1 里我预先算死"`+6` 只 creep 只值 ≈0.11/t，所以编制按构造解释不了 +0.25/t 的涨"，并预写"若我把涨幅读成人口导致，就是判我错"。实际读到的方向更强：**人口在跌**（48→43），连符号都不支持。

**一、拆解（全部来自 `kernel.stats.cpuRate`，windowTicks=10,087 / sampledTicks=10,087 / unsampledTicks=0）**
- 五连涨 `15.77 → 15.88 → 15.93 → 16.02 → **16.16/t**`。**差分后才见当前**：跨 A(900 拍)=**16.84/t**、跨 B(1,000 拍)=**17.43/t** ⇒ 对 12.00 门槛**缺口 5.43/t（当前口径）或 4.16/t（窗均口径）**；用窗均会把问题低估 ≈1.3/t。
- **E1 编制：否证**（人口 −5 ⇒ creep 项 ≈**−0.095/t**）。第三房本身也只吃 `0.324/t`（`cpuPerTickByRoom` 现读）。
- **E2 杠杆：没长**（remoteHarvester 1.89 + remoteHauler 0.78 = **2.67**，加 reserver 0.32 = **3.00**）⇒ **"关远矿也不够"继续成立**，且按当前口径**仍缺 ≈2.4~2.8/t**。⚠️两把尺互不同：**角色口径 2.67~3.00/t vs `cpuPerTickByRoom` 五个非自有远房合计只有 1.09/t** ⇒ 差 ≈1.6~1.9/t，取决于"关掉远矿"是删 op / 删角色 / 删车道，**这个边界我不替人定**（已作为待决问题写进 §3.5 #50）。
- **E3 系统侧：无新出路**（traffic-manager 3.46→3.49、snapshots 1.73→1.73、systems 相位列 2.43→2.52；**没有任何单列动 ≥0.5/t**）⇒ 涨幅是"到处都涨一点"，"低于总负载 5% 不立案"这条规矩仍然挡着。
- **E4 第二发到手**：`kernel.capacity={tier:"constrained", since:**83416306**}` 与 R136 **同一个 since** ⇒ 持续 **1,029 拍 > 300 拍驻留**、`tierTransitions=0` ⇒ 真实状态，R136 那句"constrained 非部署税"（依据：`check-code` 两发均 `d2f0b0cd00ad`）**保留**。

**二、顺带收到两条**
- **G4 第三次翻红**：`failedGates` 五条含 `G4`、`Pressure=HIGH(0.60)`。序列 `红(v=4.5)@83415384 → 绿(v=5.5)@83416284 → 红@83417284` ⇒ R136 写进 §3.5 的"**贴门槛抖动、引用只能写第 N 窗 v=x**"拿到第三个样本，不是巧合。
- **combat 第三样本不涨**：`deathByCause={natural:305, **combat:10**, recycled:5}`（R136 274/10/5）⇒ 连续两跨 +0，"持续战损"维持 R136 的降级说法。敌情仪器本轮未再取证（零 console）。
- #115 侧自然推进（无需改码）：wave4 已过（`until=83417257`）、home 人口 **4→6**、`spawnQueue` 里**首次出现 hauler 请求** ⇒ 新房需求侧正常化。⚠️未重取 spawn 工地进度（R135 的 1,850 已是出处），本轮不为凑数开探针。
- 对端域只登记：`siteStaleWorkerIdle:W36S58:*` 的 `noProg` 到 **10,110**（R134 是 5,868）且**新增 W37S57 条目** ⇒ 停滞工地在扩散；`skippedPerTick 6.2 → 9.5`（+53%）。
- ⚠️**唯一没测过的把手＝签发量**（定标式 `0.193×签发` 是最大变动项，而"动作需求涨 + 编制跌"两个旁证都指向它）：**Memory 里没有 intent 计数器**（`kernel.stats` 全部键名本轮现读：cpuRate/roadBuild/warFunnel/recoveryRejections/logisticsHealth/intelCoverage…，无 intent）⇒ 要证它需要 heap telemetry 或对端那批 room-observer 观测补丁（他们 #100/#108 域）。**属观测立项，不是本轮判据**，我没有据此下任何结论。
- 边界：**零 src、零 push、零 build、零 npm、零 console**；探针 `observe×1 + peek×3`；`.gitignore` 未 stage、`git stash list` 空、git 领先 63 / behind 0；线上 sha 本轮**未重取** ⇒ "非部署税"那句只覆盖 R136 的两次读数。

---

### 巡检 R138（2026-10-04 07:2xZ，本会话）**人均施工速率拆出来了（≈0.64/拍，ETA ≈5.5 小时带前提）**；同日更重要的一条：**核心房净流翻成大负号、G4 第四次采样深红（v=−1.0），且物理面同向**

**第 0 步与协议记账**
- `PATROL-PROMPT.md` 第四次全文读 = **16,264 字节、同版未变**，仍 **UNTRACKED**（自称 tracked）⇒ 属人处置项继续挂着。本轮当时 HEAD=`477ce75`；对端自我 R137 起未追加过锁。
- **动的层：只有 ②**（新增 `### 4.0（R138）` + 本条记录）；**①③未动**（PATROL-PROMPT 未改 ⇒ 无需方向声明；`src` 零改动）。
- ★**goal 跨轮存活的用法**：objective（拆人均速率、判能否无人干预走完 15,000）**本轮不标 complete 也不标 blocked**——终态判据（自有 spawn 出现 / `bootstrap` 条目被删 / `state` 离开 `bootstrapping`）还没发生，而我 §4.0 的 P3 预先写的正确输出就是"闭环未合"。协议里"'已提交'≠'已生效'"是同一条规矩的另一面：**算出 ETA 不等于验证过闭环**。下一轮 §4.0 第一小节仍是本条 ⇒ 续用同一 goal。

**一、速率与 ETA（都有同拍出处）**
- 同一 siteId `6ac17f2c32019b86d4b0775a` 三发进度：**64@83414022 → 1,850@83415491 → 5,392@83418284**；段 A 1.22/拍、段 B **1.27/拍**，段 B 现读**两只 builder 同时绑 `…5a`**（`assignedAt=83418247` 同值）⇒ **人均 ≈0.64/拍**（R135 当时我拒绝拆人均，这轮有绑定人数同拍读数才拆）。
- **ETA**：剩余 9,608 ÷ 1.27 ≈ **7,566 拍 ≈ 5.5 小时**（实测拍长 2.63s）；速率 1.5 ⇒ ≈4.7h，1.0 ⇒ ≈7.0h。**前提：代孵车道继续补 builder**——本跨 home 人口 **6→4**（自然死亡为主）、wave5 的 `until=83419757` ⇒ **这不是承诺，是带前提的区间**。
- **P1 判"混淆未判"**：源旁 container 已从 `Game.constructionSites` 消失（**确实完工**），但按它自身 0.92/拍 外推完工时刻 ≈83417,630 ⇒ 段 B 的 2,793 拍里**只有末 ≈650 拍是"有 container 的"** ⇒ 合计速率被前段拖住，分不出后段。硬假设前段恒 1.22 ⇒ 反推后段 ≈1.3~1.5/拍 ⇒ **">2.5/拍"倾向否证，但没有干净读数**；下一轮整段（2 人 + container 都在位）才是 P1 的检验。
- ⚠️**这条同时回头修正我 R136/R137 的"L2（取能地板）是第二段瓶颈"**：container 建成**没带来可见速率跃升** ⇒ 限制更像**载重与往返节拍**（14W4C12M 只有 200 载重；0.64/拍 与"一趟 200、来回几十拍"同量级）。本轮**未改任何码**，这是给下一发的假设。
- 顺带收到 #57 响应链的一条现场签名：新房 `spawnQueue` 5 条含 **hauler×2、distributor×1**，其中一条带 **`recoveryCorrelationId="rcv-recovery:failure:colony:W38S58:83417939-83417942"`** ⇒ 恢复系统在替这房发请求（仍**不等于**判效）。

**二、★本轮最重要的事实：核心房流量翻大负号，G4 深红——且这次两台仪器同向**
- `gateNetFlow` 核心房 **+3.248@83417345 → −3.492@83418284**（≈940 拍内掉 6.74，对一个 τ≈5,000 拍的慢 EMA 意味着输入强负）；`failedGates` 逐字含 `G3: critical(netFlow=-1.0,core=1)` 与 **`G4: net flow(v=-1.0|netFlow ≥ 5)`**（Σ门三房和 = **−0.977**）。
- **物理面同向**：核心房 `se 890,326@83416355 → 850,643@83418255` = **−39,683/1,900 拍 ≈ −20.9/拍**；`ea 12,488 < ec 12,900`（本会话核心房孵化池第一次不满）；对照幼房 `se 101,123 → 108,851`（**+4.1/拍**）。
- ⇒ **给 §3.5 #88 补一句关键限定**：我 R136 说的"账面 vs 物理反号是仪器口径"在**强流量下不成立为'坏'**——本轮真实流量强负时**两把尺同向**（Σ −3.49 / 物理 −20.9/拍），说明反号只发生在**流量近零**处（绝对误差主导）。⇒ **#88 今后只能这样引用：近零段不许用 Σ 判方向；强负/强正段 Σ 与物理同向可用。**
- **未归因**：−21/拍 花在哪（候选：RCL8 降级锯齿的 upgrader 救援、`towerSpent` 修墙(#53)、32 只/千拍自然死亡的补员开销、向新房的 `exported`）——**本轮不猜**，因为 `bk` 是"每窗增量"而我没取窗口长度（#53 那次 25/拍"漏账"就是漏项造出来的）。环内 `ControllerDowngradeRisk=1`、`AccountingDrift=5`。
- 另一条新事实：**姿态 `fortify → develop`（本会话第一次）**，但 `G0` 那行文本仍是 `posture.expansionAllowed === true` 为假 ⇒ **换姿态没开 G0**，卡在哪一项本轮没取（下一轮一发读码/dashboard 细字段，不猜）。

**三、其余与边界**
- `deathByCause={natural:337, combat:**11**, recycled:5}` ⇒ combat **+1**（上一跨 +0），仍在对端 V1"+≥3"之下 ⇒ "持续战损"维持未证。敌情仪器本轮未取。
- `tier=constrained@83416306` **第三次同 since**（持续 1,978 拍）⇒ R136/R137 的"真实状态、非部署税"继续成立；`Pressure=MEDIUM(0.57)`、`Budget=164,920/958,827`、`Readiness=NOT_READY`、`errorsPerTick 0`、`ExpectationViolation=0.6%`。
- 边界：**零 src、零 push、零 build、零 npm**；探针 `observe×1 + console-eval×1`（mark=D1，整块打印不接 `tail` ⇒ 无截断；R132 自记的两条取证缺陷本轮都规避）`+ peek×1`；pgrep 无并发 console/测试进程；`.gitignore` 未 stage、`git stash list` 空；线上 sha 本轮未重取（上次读数 `d2f0b0cd00ad` 属 R136）。

---

### 巡检 R138 续（2026-10-04 07:3xZ，本会话）**速率判完了：施工是双峰的（喂能 3.9/拍、饿着 0/拍），死线在 tick 83429857 —— 判定"能走完，余量 ≈55%，但由占空比而非 builder 数量决定"**

**读到的东西（同一 siteId `…5a`，六发，全部整块打印无截断）**
- 进度：`64@83414022 → 1,850@83415491 → 5,392@83418284 → 5,392@83418347 → 5,392@83418430 → 5,392@83418482 → **5,686@83418557**`（最后 75 拍 +294 ⇒ **3.9/拍**，同拍只有 **1 只 builder 在 `work` 且携带 146、assignment=`…5a`**）。
- 中间出现过**连续 ≈200 拍零推进**，期间房内 **builder×4（2 只 `idle` + 2 只 `acquire`，全部携带 0、无 assignment）**，而 **两处 source 都是满的 3,000/3,000、container 能量 `[2, 0]`**。
- ⇒ **人均速率不再是 0.64/拍那种"平均数"**：喂到能的 builder ≈3.9/拍，没能的 0/拍。R138 上文我用"段 B 合计 1.27/拍 ÷ 2 人"推的 0.64（以及 1.05 的另一端）**被 D5/D6 这组直接观测取代**：限制是**占空比**。

**机制（读码 + 现场，零 src 改动）**
- `state-machine.ts:745-748` 的拓荒编队 = `worker(pioneerWorkers=2) + builder(pioneerBuilders=2)`（`config/index.ts:939-940`），**编队里没有采集角色** ⇒ 现场表现为 source 恒满、container 恒空 ⇒ builder 只能自采（14W 采得快但只有 **200 载重**），于是"灌一波 294 → 走一趟 → 空窗"。这就是双峰的来源，也是 **#116 的实体**。
- 补给闸：`advanceBootstrapping` 末尾 `if (hostiles.length === 0 && spawningAllowed) submitPioneers()`（`:359-362`）；`hostiles` 只数带 ATTACK/RANGED_ATTACK 且非盟友（`:322-329`）；`spawningAllowed = budget.tier ∈ {healthy,guarded} && bucket ≥ 5000`（`expansion-manager.ts:81-83`）。本轮现读 **敌意 0 / tier healthy / bucket≈10,000 ⇒ 两闸都开**（我先前怀疑"hostiles 挡住补给"，被自己的读数否证）。
- ⚠️口径边界（我差点踩）：这里的 `ctx.budget.tier` **不是** `kernel.capacity.tier`（后者现在是 `constrained`）。两把尺不同源，**别拿 G6 的档位去推 `spawningAllowed`**。
- 死线：`startedAt=83409857 + pioneerTimeout=20,000 ⇒ tick 83429857`；超时且 `spawns.length===0` ⇒ `abortExpansion(TIMED_OUT)`；若届时 squad 无 worker/builder 且有武装敌意 ⇒ `LOST`。距 D6 **≈11,300 拍 ≈ 8.2 小时**。

**判定（objective 要的"判能否无人干预走完 15,000"）**
- 剩余 `15,000 − 5,686 = 9,314`，死线前可用 ≈11,300 拍 ⇒ **所需持续速率 ≥ 0.82/拍**；观测长段合计 **1.27/拍**、喂能瞬时 **3.9/拍**、实测空窗 ≈200 拍。
- ⇒ **能走完，余量约 55%，但成败系于占空比（builder 能否拿到能量），不系于 builder 数量**——本轮 4 只 builder 在场照样 200 拍零推进。三条会吃掉余量的条件都点名可测：①占空比恶化；②武装敌意出现 ⇒ 补给停 + squad 空 ⇒ `LOST`；③`budget.tier` 跌出 healthy/guarded 或 bucket<5,000 ⇒ 补给停。
- **这不是"已验证"**：终态三读数（`FIND_MY_SPAWNS ≥ 1`、`kernel.bootstrap` 条目被 `bootstrap-lane.ts:46-48` 删除、`kernel.expansion.state` 离开 `bootstrapping`）**尚未发生**。按 1.27/拍 外推完成点 ≈ **83425,900（≈5.4 小时）**，按 3.9/拍 ≈ 2,388 拍 ⇒ 下一轮应能收到终态（闭环成立，或死线前未建成）。
- **#116（候选缺陷，等终态再定，本轮不改码）**：拓荒编队缺采集角色 ⇒ 新房补能链不存在、施工双峰化。若最终 `TIMED_OUT`，第一嫌疑人是 #116，不是 #115（#115 的排序问题在 wave4 之后已被"两只 builder 同绑 spawn"绕开）。两个修法方向代价不同（编队加 harvester / 让 builder 取用 sponsor 运来的能量），**都不自办**。
- 顺带第三次坐实：`FIND_MY_SPAWNS=0` + `ea/ec=0` + `spawnStarvationCount` 恒增 ⇒ R130 那条"无 spawn 的房该计数器按构造恒真"继续成立。
- 另记一次**超额补给现象**：D5 一度 4 只 builder（>pioneerBuilders=2）。注释称编队读数按"驻地"（那间房里的我的 creep）计 ⇒ 若按物理在场计，通勤中的不算 ⇒ 过供是可预期后果。**未证实**（要看通勤途中 creep 的 room 归属），只登记。
- 边界：**零 src、零 push、零 build、零 npm**；本轮（R138 全轮）探针 `observe×1 + peek×2 + ring-dump×1 + console-eval×6`（D1–D6，全只读、整块打印）；`.gitignore` 未 stage、`git stash list` 空；线上 sha 未重取（上次 `d2f0b0cd00ad`）。

---

### 巡检 R139（2026-10-04 08:2xZ，本会话）**先写的期望被现场证伪：R138 的"1.27/拍"低估了 2.6 倍**（实测近段 3.34/拍）；低估的原因这轮查到代码级——**`colonyCreeps` 按物理在场计数 ⇒ 通勤中的 pioneer 不计 ⇒ 编队被系统性补成 4 只**

**方法意义（本轮最值得留的一条）**：R138 我把外推**在取数之前**写进 §4.0（期望 ≈6,880、带 6,700~7,912），这轮读回 **7,990@83419247** ⇒ 落在带外（高侧）。⇒ **这是本会话第一次"预写期望 vs 现场"当场把我的模型打死**，而且死得有意义：如果不是先写了带，我会把"进度看着还行"读成"模型没错"。规矩照旧——**只写读数与带，不事后挪带**。

**一、判定与差分**
· 进度：`5,686@83418557 → 7,990@83419247 → 7,990@83419383` ⇒ **近段 +2,304/690 拍 = 3.34/拍**（R138 长段是 1.27/拍）；随后 **136 拍零推进**（占空比第二次抓到：当时 1 只 builder 已绑 `…5a`、在 `work` 模式、只带 6 能量）。
· 剩余 7,010；死线 `startedAt 83409857 + pioneerTimeout 20,000 = 83429857` 距今 **10,474 拍** ⇒ **只需 0.66/拍**。⇒ **判：能建成，余量 ≥1.9 倍（取最保守那段）；R138 的"余量 55%"是低估。**
· ⚠️但**这不等于闭环已验证**：终态三读数 `FIND_MY_SPAWNS≥1` / `kernel.bootstrap` 条目被 `bootstrap-lane.ts:46-48` 删除 / `kernel.expansion.state` 离开 `bootstrapping` **本轮全部未到**（与预写一致）。两算完成点 ≈**83421,480（3.34/拍）~ 83424,770（1.27/拍）**，都在死线前 ⇒ 留给下一发见证。
· **对 #116 的代价形态要改写**：我 R138 说"缺采集角色 ⇒ 施工双峰化、可能建不完"。实际是**双峰为真、但净效果被"过供"抵掉还有余**：房里的 builder 是 4 只不是 2 只 ⇒ 快，代价变成**能量/CPU 的浪费与占空比不稳**，不是建不完。

**二、过供机制（从"现象"升为"已证实"）**
· 代码：`state-machine.ts:377-381` `colonyCreeps() = room.find(FIND_MY_CREEPS).filter(home===room)` ⇒ **物理在场**；`submitPioneers`（`:732-770`）用 `living + pending` 与 `pioneerWorkers=2 / pioneerBuilders=2` 比较后补齐。从 sponsor 孵化、还在路上的 pioneer **不在目标房** ⇒ 不计 ⇒ 反复补。
· 现场：R138 `D5` 与本轮 `F1` **两次都读到 builder=4**（F2 仍 4 只在场，其中 1 只 `work` 携 6、1 只 `acquire` 带 assignment `…5a`、1 只 `acquire` 无 assignment）。
· ⚠️修法不属本轮也不属我：`colonyCreeps` 改按 `home` 计数会**连带改变 squad-wiped 判据与 pending 去重**（同一函数还用于"被敌意清空 ⇒ LOST"那条），不是纯增益 ⇒ **摆数请示，不改码**。

**三、★第一次采到敌情事件（挂了三周的仪器缺口，在自有房一侧通了）**
· `83418925 EnemyInvasion r=W38S56 d=[2,0,21,2]` → `83418955 EnemyCleared d=[]`（30 拍清除）。字段现读（`telemetry-collector.ts:606-613`）＝ `[threatCreeps.length, heals, ranged, melee]`。
· ⚠️**读数不自洽，我不写解释**：`threatCreeps=2` 而 `ranged=21 / melee=2` ⇒ 要么字段顺序我读错、要么这个聚合有 bug（下轮一发读码定性，别当"21 个远程兵"用）。
· 含义两条：①§2「战争：和平期线上无敌情可采」**从本日起有反例**；②R136/R137 我说的"敌情仪器是空的"要**限定到远房**（那 3+1 只战损所在的 W39S56 仍无任何敌情事件）。
· 与扩张的边界：补给闸只看**目标房**（W38S58，本轮 `FIND_HOSTILE_CREEPS=0`）里的武装敌意 ⇒ **W38S56 被入侵不会停 W38S58 的补给**，别把两件事并成一条风险。

**四、E4 常规**
· `tier=constrained@83416306` 第四次同 since（2,929 拍）；CPU 六连涨至 **16.19/拍**（窗口 11,987t），本跨差分 **16.35/拍** ⇒ 对 12.00 缺口 ≈4.35/拍（与 R137 的"17.43"分属不同跨，别混用）。
· `failedGates=G0+G2+G3+G4+G6`（G4 第五次采样仍红，序列 红→绿→红→…）；**姿态在 `develop`↔`fortify` 之间摆** ⇒ G0 不会稳定开，`expansionAllowed` 卡哪一项**连续两轮未取**（挂账）。
· W38S58：home 人口 6、`pressure=0.8`、`queue=5/11`、`container=[24,0]`（开始有人往里灌但仍是几十量级）；`bootstrap={until:83419757, waves:4}` ⇒ wave5 约 370 拍后。
· 对端域只登记：`siteStaleWorkerIdle:W36S58:*` `noProg 12,012`、`workers 5→3`；`AccountingDrift=6`、`RequestExpired=1`。
· 边界：**零 src、零 push、零 build、零 npm**；探针 `observe×1 + console×2（F1/F2 整块打印无截断）+ ring-dump×2`；`git stash list` 空、`.gitignore` 未 stage、git 领先 66 / behind 0；§4.0 已改写为 R139 主目标（**只动 ②层**）。

---

### 巡检 R140（2026-10-04 09:2xZ，本会话）**终态三读数全为"否"（spawn 9,139/15,000、车道条目仍在、state 仍 bootstrapping）；预写的带落在下方 ⇒ 单段差分第三次骗人，改用最跨度 1.38/拍**

**第 0 步与层归因**：`PATROL-PROMPT.md` 第六次全文读 **16,264 字节、同版、仍 UNTRACKED**（自称 tracked；属人处置项第 4 次登记）；HEAD=`50b84a6`。**只动 ②层**（§4.0 改写为 R140 主目标 + 本条），**①③未动**。探针 `observe×1 + console×1(G1) + peek×2 + ring-dump×1 + 读码×4`；**零 src、零 push、零 build**。

**一、E1 终态（objective 主判据）：三者全部未到 ⇒ 闭环仍未验证**
- `G1@83420192`：`FIND_MY_SPAWNS=0`；`kernel.bootstrap` 仍含 `W38S58`；`kernel.expansion.state="bootstrapping"`；房内只剩 1 个工地（spawn）进度 **9,139/15,000**；`W38S58` 敌意 0、`rcl=2`、`recovery`。
- ⇒ 长期目标主轴上"自主扩张闭环"的**第一次直接验证仍未到手**；不得用"快了"顶替。

**二、E2 带检验：低估的相反方向——落在两条分支下方**
- 预写期望（取数前）：**11,900~13,200**（R139 的 3.34/拍 分支）或 **≈10,550**（1.27/拍 分支）；实读 **9,139** ⇒ **两条都在上方**，比保守那条还低约 13%。
- 差分事实：`5,686@83418557 → 7,990@83419247 → 7,990@83419383 → 9,139@83420192`；最近 809 拍 = **1.42/拍**。
- ⇒ **R139 的"R138 低估 2.6 倍"要打折**：那个 3.34/拍 是局部爆发。**最长可用跨度**（首次施工 83413556=0 → 9,139@83420192，6,636 拍）= **1.38/拍**，与 R138 的 1.27 同量级。
- **按允许的"只重算一次"**：剩余 5,861 ÷ 1.38 ⇒ ≈4,247 拍 ⇒ 完成点 ≈ **83424,439**；死线 83429,857 还剩 9,665 拍 ⇒ **只需 0.61/拍，余量 ≈2.3 倍**。结论仍是赶得上，但依据换成**长跨速率**。
- ★方法论（第三次同族付学费，写进规矩）：**同一栋工地在 700~2,800 拍的窗里给出 0 / 1.42 / 3.34 三种"速率"** ⇒ 单段差分不可用于 ETA，**只有从首次施工起的最长跨度可用**；R138（1.27）与 R139（3.34）分别朝两个方向错过。

**三、E3 两条欠账（各含一次自纠）**
- **撤回**我 R139 的"`EnemyInvasion` 读数不自洽"：`telemetry-collector.ts:592-611` 的 `heals/ranged/melee` 是**全部威胁 creep 的部件求和** ⇒ `d=[2,0,21,2]`（2 只、0 治疗、21 远程部件、2 近战）完全自洽。又一次"拿标准 body 大当前验"（同 reserver 寿命 600 那一族）。
- **G0 卡点答出来了**：`posture.ts:150-159` 的 7 个合取项 + `config` 现读 `expandMinBucket=7,000 / expandMaxPressure=0.4 / colonizeSponsorRcl=7 / colonizeYoungestFloorRcl=5` + `kernel.strategy={posture:"fortify",since:83418917,expansionAllowed:false,gclLevel:5,bucket:10000}` 对照三房实况 ⇒ **确定失败的是 `allNormal`（新房 recovery）与 `youngestMature`（要求每房 RCL≥5，现 RCL2）**。⇒ **§3.5 的硬结论（这次带配置数）：放宽 G6/G4 换不来第四张 claim**，要等 W38S58 从 RCL2 长到 RCL5（45,000→135,000→405,000 三段，按幼房历史 0.7~2.7/拍 = **以天到周计**）。⚠️边界：`kernel.strategy` 只落 7 项中的 2 个标量（#94），所以这是"**两项已足以解释 false**"，不是逐项归因。

**四、E4 常规与一条正证**
- **敌袭≠战损（首次拿到正证）**：环内 `EnemyInvasion r=W38S56@83418925 → 5×TowerVolley(83418946~50) → EnemyCleared@83418955`（30 拍清除、2 只敌 creep），而 `deathByCause.combat` **11→11 未动** ⇒ 防线处理掉一次入侵且零战损；"持续战损"至今无证据。姿态 `since=83418917` 与入侵同拍 ⇒ R139 说的"develop↔fortify 摆"**成因是这次入侵**，不是随机。
- Σ=`gateNetFlow` = `−6.921 + 3.621 − 0.493 = **−3.793**` ⇒ G4 第 6 次采样仍深红；核心房物理 `se 850,643 → 822,144` = **−15/拍**，与 Σ_core **同向**（再次印证：强流量下同向、近零才反号）。**−15/拍 仍未归因**（`bk` 缺窗长）。
- **#116 的代价升级为硬信号**：`W38S58.spawnQueue` 内 **harvester 请求在持续创建又到期**（`createdAt=83419269 → expiresAt=83420269`），而该房无 spawn 服务自己队列、`submitPioneers` 只补 worker/builder ⇒ 房内 roster 是 `b×4 + w×3`、**没有 harvester**，4 只 builder 全 0 能量（2 只 `idle`）且无 assignment。⇒ 采集这条通道在空转（仍不改码：加角色属安全/排产语义，须请示）。
- `tier=constrained@83416306` 第五次同 since（**3,900 拍**）；`errorsPerTick 0`。⚠️**线上 sha 连续 4 轮未认**（上次 `d2f0b0cd00ad`@R136）⇒ 下一轮第一件事 `check-code`。

**五、下一件事**：①完成点预计 83424,439（≈4,250 拍后）⇒ 收三件套；若 `state` 前进，**先读它进入那一态的判据（`advanceEconomicStartup` 的 cp2）并预写期望再验**，绝不把"标志变了"当"经济活了"。②`check-code`。③−15/拍 归因（先取窗长）。④#116 摆数（形状已齐）。

---

### 巡检 R141（2026-10-04 10:2xZ，本会话）**核心房那 −18/拍：三条"设计内消费"全部被现读排除，而三个房的账本以三种不同方向对不上 ⇒ 判"结构性看不见"，不判"漏账"；并顺带认了欠 4 轮的线上 sha**

**第 0 步 / 层归因 / 通道**：`PATROL-PROMPT.md` 第七次全文读 **16,264 字节、同版、仍 UNTRACKED**（第 5 次登记这条差异），HEAD=`621fb1e`。**只动 ②层**（§4.0 改 R141 + 本条）。探针 `check-code×1 + observe×1 + console×3（H1/H3 成功，H2 因 API 形状失败）+ peek×1`；**零 src、零 push、零 build**。
★ **欠 4 轮的码终于认了**：`check-code` 两发都返回 `modules:{main:<786,453B sha=d2f0b0cd00ad>}`，**与 R136 一字不差 ⇒ 本会话期间线上从未换过码**（本地 `33e78bd675db` 含 `c58ff9d` 仍未部署）。这几轮所有"非部署税"的推断一次性坐实。

**一、E0：窗长读死了**（这是"每拍"类读数的地基）
- `CONFIG.economy.accounting.windowTicks = 50`（`config/index.ts:474`）+ `economy.ts:196` `(tick + roomHash) % 50 === 0` 错峰结算 ⇒ **`bk` 每列 = 一个 50 拍窗的增量**（÷50 即每拍）；`economy.ts:206` 还有一条"跨窗不连续就丢样本"的守卫。⇒ 从此 `bk` 与物理差分**第一次有共同分母**。

**二、E1：三条候选消费，逐条现读排除**
- 核心房该窗 `bk={harvested:980, imported:120}` ⇒ **账面 INCOME +22.0/拍、CONSUMPTION 零项**（无 spawned/upgraded/built/repaired/towerSpent/sold/exported/tradeFee）。
- ①**RCL8 保级**：`controller.progress=0`、`ttd=12,140`（#52 带内）、**房内根本没有 upgrader 角色**（`remoteHauler2/mineralMiner1/labTender1/hauler1/harvester2/builder1/distributor1`）⇒ 排除。
- ②**塔修墙(#53)**：该窗无 `towerSpent` 且两塔 `energy=6,000`（满）⇒ 本窗排除（口径本身仍有效）。
- ③**工业/lab/提取**：`11 lab + extractor + factory`，**矿物合计 0**，能量只是停在 `lab 1,766 / factory 3,762` ⇒ **没有在跑的反应或提取**；⚠️附带发现：**本服至少一种工业结构 `.store` 为 undefined**（H2 那发因此报 `Cannot read properties of undefined (reading 'getUsedCapacity')`）——请工业域记一笔，别拿它当"结构不存在"。

**三、控制组把结论定死：三房三样错法 ⇒ 账本口径，不是核心房一条漏账**
- 幼房同窗：`{harvested:1000, upgraded:129, towerSpent:1000}` ⇒ 账面 **−22.6/拍**，而它 storage **+5.6/拍**（涨）⇒ 与核心房**同量级、反方向**。
- 新房同窗：`{pickedUp:200, built:800}` ⇒ 账面消费 16/拍，而全房 `roomTotal_rs=225`、`se=23` ⇒ 账面"花掉的"超过该房拥有过的总量 ⇒ 这三个房的 `bk` 不是同一套闭环口径。
- 核心房长跨度（4 个样本同向，非单窗噪声）：`se 890,326@83416355 → 804,488@83421105` = **−85,838 / 4,750 拍 = −18.1/拍**。
- ⇒ **判定**：这 −18/拍 **不在任何已入账的设计内消费里**（三条候选全排除），**也不能被判定为"某条具体漏账"**；它属于**账本结构性看不见**的一类。措辞纪律：**既不写"有漏账"，也不写"账本可信"**。

**四、为什么按现有仪器判不到底（缺的是累计位，不是再取几发）**
- 单窗残差 `dr=1,676`（**33.5/拍**）与要看的东西同量级；对端 R298/R299 已判"50 拍窗无分辨力"，本轮是**第三方独立复现**。
- 更关键：**`bk` 只保留最后一个窗**，没有按 key 的累计计数 ⇒ **想追溯这 3.5 小时谁花的，按构造不可能**（不是我没取够样本）。⇒ 唯一前瞻形状：**按 key 的累计计数器**（与对端 #100/#108 的 room-observer 观测补丁同族；他们 R309 自校的 `bk=本窗增量` 可直接复用为回归对照）。

**五、给 §3.5 的两条直接影响**（我只摆数，不动阈值）
- **#88/G4 的引用规则加一条硬限定**：凡拿"/拍净流"当证据的句子都要标"来自 50 拍窗、单窗残差 ≈±1,700"；可引用的只有长跨度物理面。
- ★**今天帝国的物理面是净减，不是净攒**：核心房 −18.1/拍、幼房 +5.6/拍、新房 ≈+0.02/拍 ⇒ **合计 ≈ −12/拍**（≈3.5 小时）。这与 `gateNetFlow`（Σ门 −3.793@R140、本轮核心房 `nf/100=0.08`）**同向** ⇒ **G4 深红不是仪器错觉**。⇒ 之前"A 路线要不要在盈余存不下时做"的框架要反过来问：**现在还有没有盈余**（这条比 #50 的 CPU 取舍更该先看）。
- 台账词表（16 个 key，`bumpEnergyCounter` 字面量）：**没有工业/link/落地衰减的入账位**；`repaired` 经别的 helper 写入 ⇒ 那份清单是**下界**不是全集（我按下界用）。

**六、其余**：新房 `pressure=1`（最高）、`queue=5/11`、home 人口 6，进度本轮未重取（不在 objective 上，不占探针），R140 外推完成点 ≈83424,439、死线 83429857；`tier=constrained@83416306` 第六次同 since（4,819 拍）；人口 42；`errorsPerTick` 未取同列。
**下一件事**：①若人批准"按 key 累计计数"的观测补丁，**与 `c58ff9d` 同批推**（一次部署抵两笔税）；②新房完成点那一发在 83424,439 附近等；③`extractor.store===undefined` 转告工业域。

---

### 巡检 R143（2026-10-04 11:1xZ，本会话）**扩张终态三读数全否但性质变了：工地 13,016/15,000；★CP2/CP3 判据从代码原文读出，暴露"②先走③不动"的按构造分叉，并把 #116 升为决策级**
（R142 那一轮没有单独尾条——它的结论落在 §3.5 #88 的"★★R142 结案"与 §4.0 的改写里，细节在 lock R142。）

**一、第 0 步**：`PATROL-PROMPT.md` 第九次全文读 = 16,264 字节（同版）、仍 **UNTRACKED**（第八次登记属人）；HEAD=`e12cfaf`；`.gitignore` 未 stage、stash 空、lock 最近 12KB 无对端条目。

**二、E4 先证伪，结果撤了自己上一轮的一条"事实"**：哨兵 `JSON.stringify({m:"R143P",t:Game.time})` **秒落**，而 `var r=…;JSON.stringify(…)` 形式的两发（R142J1、R143E1）**永不落 `__evalResult`**（同请求形状的控制邻居 `kernel.expansion.state` 非空 ⇒ 不是下载坏）⇒ 2×2 对照，唯一变量是"语句 vs 表达式"。**根因在工具包装里**：`console-eval.mjs` 把输入塞进 `return ((EXPR) ?? null)`，而 `return` 的表达式位置不能含语句 ⇒ 整条编译失败，而 `/api/user/console` 在 POST 阶段就回 `ok=1`。⇒ **R142 写的"新失败形状=通道可疑"撤回**；这是我两天里第二次把**自己的调用形状**记成**线上仪器故障**（第一次是 R141 的"仪器不存在"）——**共同点：都是没读仪器/工具自己的文本就下结论**。

**三、E1/E2**：`sp=0`、`bootstrap` 条目在、`state=bootstrapping`（同拍 83422080）；工地 **13,016/15,000**。E2 那条带**失效原因记账**：我把带写在 `T≈83423,8xx`，是按 ~2,100 拍/小时估的，实测 2.77s/拍 ⇒ ~1,300 拍/小时 ⇒ 真实 T 早 ≈1,700 拍（第 5 类"拍长没标定"，这次是在**写预期之前**犯的）。用允许的一次重算：1.38/拍 期望 11,744，实读 13,016（**+10.8%**），本段 **2.05/拍**，最长跨度 1.38→**1.53/拍** ⇒ 形态结论改为"**速率随在场 builder 数走，不是稳态**"，落点只报区间 **83423,048~83423,642**。

**四、★E3（objective 明确要求"先读代码再写判据"，本轮做在事件之前）**
- 车道撤销（`bootstrap-lane.ts:44-49`）只看 `FIND_MY_SPAWNS>0`，**不看能不能孵化**；`:66` 自己警告"车道一清，途中减员不再有替补"。
- **CP2** = `spawnBuilt && (ea ≥ 300 || hatchInProgress)`（`MIN_VIABLE_BODY_ENERGY=300`@`checkpoint.ts:126`）。当前 `ea=0, ec=0`，建成后 RCL2 bay 上限恰 300 ⇒ **预写分叉：建成那一拍若 `ea<300` 且没在孵 ⇒ ②先走、③不动，"三件套全中"按构造不会同时成立**。
- **下一态第一道判据 = CP3** = `harvesterActive && transporterActive(=hauler||distributor，carrier 不算) && spawnCanSpawn`，且按 **`memory.role` 字符串**筛；现场在场 5 只是 `carrier×1+worker×2+builder×2` ⇒ **两个合取项现在都不满足**。CP4 要 `extensions≥5 && container>0`；CP3∧CP4 才进 `integrating`。
- **时间语义更正**：CP2 过会 `startedAt=ctx.tick` ⇒ **83429857 不是这房的最终死线**；`economic_startup` 超时 = `pioneerTimeout*2 = 40,000 拍 ≈30.7 小时`，到期 **CP3 过 ⇒ FORCED_ADVANCE，不过 ⇒ `abortExpansion(TIMED_OUT)`**（释放 claim）。⇒ **#116 升为决策级**（已进 §3.5）：这房命运取决于新房 own-spawn 能否交付 harvester + hauler/distributor。

**五、E5 顺带（含对 R142 的一条降级）**：`energyLedger` 两点差分（`Δtick≈646`）给核心房 **净 +2.5/拍**（INCOME 39.7 / CONSUME 37.1，`spawned 31.5/拍` ≈ 寿命均速 30.6）⇒ **R142 的"G4=真赤字"里"稳态"那一半撤掉**，赤字是 **episode 形态**；同区间 `se −8.1/拍` 与 `rs +7.5/拍` **反号**（差额是房内搬运，#58 边界）⇒ 引物理面必须写明 `se`/`rs`。`ws` 视界已**重开**（核心房 `Σticks` 1,750→350，比值读起来像"单向漏记"）⇒ **新纪律：`ws` 比值只在 `Σticks≥1,500` 时用**。幼房 `ColonyStateChange→bootstrap` **自愈回 normal**；姿态 `fortify→develop`（threatWindow 有界自解，我没动 posture）；G6 未动（`constrained@83416306` 第八次、16.27/t、缺口 4.27）；credits 32 分钟 +600,000 而该区间能量 `sold` 仅 +1,000 ⇒ 有非能量收入通道在跑（只登记，归贸易域）。

**六、边界**：只动 ②层（§4.0 保同一 objective 换正文 + §3.5 两条更正/升级 + 本尾条）；**零 src、零 push、零 build、零 npm**；探针 `observe×1 + console-eval×4（含 1 发哨兵、1 发语句式作废）+ peek×3`，全只读；读码 `bootstrap-lane.ts:36-60`、`state-machine.ts:256-340/385-520`、`checkpoint.ts:126-200`、`console-eval.mjs` 包装段。goal **不标 complete**（终态事件未发生）也不标 blocked（是没到点，不是阻塞）。

### R311（10-04 20:0xZ，本会话）闭环第一次跑完：部署→读数→**给 #111 定了价**，同时抓到我自己 #113 里的一个真缺陷
**部署确认**：线上 `sha=649eb94b9784`（787,752B），此前整场是 `d2f0b0cd00ad`。堆确实清了（`roadBuild.*.calls` 从万级回到几百），
`kernel.bootTick=82414952` **没跟着重置** ⇒ 再次证明"bootTick 不能用来给部署定日"（判部署只认 sha + 堆内累计量归零）。
连带后果：**所有 boot 以来累计的账本从此重新计**，凡与 04:5x 之前对比的差分（#114 的 drift 序列、roadBuild 的累计）
都要标"跨部署不可直比"，只比同段内。对端 #115 的 `c58ff9d` 也在这次上线 ⇒ **它的判效窗从此刻起算**。

**一、#111 拿到价格（`noEnergyInRange` 上线后的第一读，boot 后 ~15k 拍）**
| 房 | calls | noEnergy | **noEnergyInRange** | 占比 | noWork | outOfRange | noSiteAtAll |
|---|---|---|---|---|---|---|---|
| W37S57 | 384 | 291 | **269** | **92%** | 0 | 93 | 0 |
| W39S56 | 436 | 286 | **0** | 0% | 150 | 0 | 0 |
| W37S58 | 479 | 0 | 0 | — | 0 | 0 | 479 |
⇒ R290 猜的"两房第一因相反"**被这一列证实**：W37S57 的空手调用里 **92% 脚下就有自己的工地** ⇒ (B)（空载腿留能）在这条车道上不是"也许有用"，而是**高密度可施工**；
W39S56 则是 `noWork 150`（body 不带 WORK）+ 射程内 0 ⇒ 同一列把它从 (B) 的受众里**排除**，它的动作属 body/编制；
W37S58 `noSiteAtAll 479` 是自家核心房没排工地，正常。
⚠️**别把 269 读成"能建 269 格"**：它是**机会计数**（空手且射程内有 site 的拍次）。要换算成点数还缺两个数——该房的 `built` 与 `roadSitesPending×300 − roadProgressSum`（本次读数被截断，下一读补齐）。
定价算式已写死：`(B) 预期点数 ≈ noEnergyInRange × WORK 部件数 × 1 点/拍`，对照"缺口点数"，再判每趟交付量 −20~30% 换不换 ⇒ **现在是有数可依的属人决定，不再是方向之争**。

**二、#113 抓到我自己的真缺陷（已修 `c76aad4`，未推）**
现场：`kernel.expectations = {tick, violations: [], e3: {}}` —— **`recent` 键整个不见**。
根因不是"没上线"（sha 已变）也不是"没到节拍"（`tick=83422856` 在推进），而是我 `27a8a51` 的写法：
`if (violations.length>0)` 分支带 `recent`，**else 分支用对象字面量整体覆写、没带走 `recent`** ⇒
违例是**间歇状态**（工地被回收、饥饿一拍缓解都会让 violations 变空），于是**一次干净拍就把整段留痕抹掉**——
而"事后归因"恰恰要在违例已经不在了之后才做。我上一轮宣布"这是实现缺陷"方向对了，但**当时给的理由（"recent 没写"）是猜的**；读码后正确理由是"写了却被干净一拍覆写"。
修法一行：else 分支 `recent: kernelMem.expectations?.recent`。门禁：tsc 0、`tests/unit/kernel` 30 files/299 绿。
**如实记的测试缺口**：这个 bug 是"对象字面量少一个键"，`runExpectations` 是私有方法、没有可测缝；我没有为塞一个用例把整块（含 P3 跟踪与事件限流）重构出来 ⇒ 该分支**当前无单测**，
以线上判据代替：部署后经历一次 `violations` 由非空变空，`recent` 应仍存在且含变空之前的 id。
**方法**：这次是"判据设计里预写的第三种态（未上线/未执行/实现缺陷）"救了我——若只写"缺键=没部署"，我会把这条真缺陷误读成部署失败，然后**去重推一次同样有 bug 的码**。

### R312（10-04 20:1xZ，本会话）#111 定价收口：**射程内的施工机会 100% 落在空载腿上**——两房的 `built` 在整段 boot 内都是 0
现读（`kernel.stats.roadBuild.*`，逐字段单路径取；整行 JSON 会被 `peek` 的 ~700 字符截断，那是一台已知会骗人的仪器）：

| 房 | calls | noEnergy | **noEnergyInRange** | noWork | outOfRange | **built** | rejected | pending | progSum | roadsBuilt |
|---|---|---|---|---|---|---|---|---|---|---|
| W37S57 | 468 | 375 | **348** | 0 | 93 | **0** | 0 | 18 | 505 | 14 |
| W36S58 | 516 | 321 | **82** | — | — | **0** | — | 4 | 405 | 4 |

**算术把结论钉死（W37S57）**：`calls − noEnergy − outOfRange − built − rejected = 468 − 375 − 93 − 0 − 0 = 0`
⇒ **满载（或有能）调用共 93 次，全部在射程外；射程内的机会 348 次，全部空手**。
也就是说这条车道上**没有一次"带着能却够不着工地"**，反过来也成立：**够得着工地的拍一次都没带着能**。
`noEnergyInRange` 的口径已含 `workParts>0` 闸门，而该房 `noWork=0` ⇒ 这 348 次机会**每一次都落在有 WORK 的身上**，
所以 (B)（空载腿留 200–300）不是"也许能省"，而是把 `built` 从 0 变成非零的**唯一已知路径**。

**给 (B) 定价还差的那一格，我不编**：`预期点数 = 机会次数 × WORK 部件数 × 每 WORK 每拍的 build 点数` —— 后两项我没从 docs/@types 取到就**不填数字**（这次学乖了，见 §20 的两次假缺口）。
校准法是现成的：缺口点数已知（W37S57 `18×300 − 505 ≈ 4,895`；W36S58 `4×300 − 405 = 795`；合计 ≈ **5,690 点**），
一旦 (B) 上线，`built` 就成了天然分母 ⇒ **`每拍点数 = ΔroadProgressSum / Δbuilt`**，一次 boot 内即可标定，不用猜引擎常数。
代价侧仍是每趟交付 −20~30%（远矿 hauler 容量 ~1,000、留 200–300）——**这是有数可依的属人取舍**：拿 20~30% 交付率去换"一条车道从 0 施工变满施工 + 约 5,690 点缺口"。

**一条被两房同时支持、但我不定案的反常读数**：`roadsBuilt` 相对部署前**同向大跌**（W37S57 26/27 → 14；W36S58 7 → 4）。
两房独立同向 ⇒ 不像单房视野抖动；且该计数只在**有视野**时更新（无视野时冻结，不会自己变小），所以"变小"要求**真的看到路消失**。
但 `built=0` 意味着这一整段**没有任何新建**，衰减是唯一的免费解释——可我仍不写"路网在净衰减已定罪"，因为：
①跨 boot 段比较本身有口径风险（ roadsBuilt 是快照不是累计，理论上可比，但我的基线取自不同 boot 的两次读数）；
②敌方拆除与天然衰减在结构上不可分，而本会话远房敌情仪器被记过"是空的"。
**下一手的便宜检验（零 console）**：连续两读 `roadsBuilt` + `roadProgressSum` + `pending`，
若 `roadsBuilt` 单调下降而 `pending`/`progSum` 不动 ⇒ 是**存量在掉**（衰减或拆除），本案性质从"发展慢"升为"维护赤字"；
若它企稳 ⇒ 我这次读到的是跨 boot 的口径噪声，撤回该疑点。

**方法论**：这一轮的两处"整行读数被工具截断"（JSON 解析失败、字段缺失）都靠**退到逐字段单路径读**救回来，
没有把截断当"值为空"——那正是我这天在第 100 号缺陷上犯过的错形状。
**边界**：两房、同一 boot 段（部署后 ~7 小时）；`noEnergyInRange` 是机会计数不是点数；`built=0` 只在本 boot 段成立（部署前该两房分别有 175/58 次）。
本轮零 console、零 src 改动、零 push。

### R313（10-04 20:1xZ，本会话）#107 定案为"自然衰减是真的"，但同一把尺子**量出了我自己 (B) 推荐的不成立**
一次 console（`mark=R107A1`，t=83422998，只读）取回 W37S57 全部路的 `(hits, ticksToDecay, x, y)`：14 段，**与 `roadsBuilt=14` 吻合**（计数器与真实世界交叉核对通过）。
`ticksToDecay` 排序：`14, 27, 107, 258, 281, 281, 530, 555, 590, 619, 682, 739, 783, 869`。

**两个独立估计给出同一个流失率**
- 由读数史：`26/27 → 14` 跨 ≈6,800 拍 ⇒ 一段 / ≈570 拍。
- 由现存样本：中位 `ticksToDecay = 555` 拍/段 ⇒ 一段 / 555 拍。
⇒ **#107 结案：路网净衰减是真的，机制是自然衰减**，不需要引入"敌方拆除"假设（也没有证据支持它）；
  维持需求 = `300 点 ÷ 560 拍 ≈ **0.54 点/拍**`（短期更凶：≤110 拍内有 3 段到寿 ⇒ 上界 `3×300/110 ≈ 8.2 点/拍`）。

**(B) 的机会密度撑不起这个需求——这是对我自己上一节推荐的否证**
R312 数出的机会密度：`348 次 ÷ 6,800 拍 = 0.051 次 build 拍/拍`。
- 每次 build 拍若产 1 点 ⇒ 供给 0.05，需求 0.54 ⇒ **差 10.6 倍**；产 5 点 ⇒ **仍差 2.1 倍**；
  要补上中位需求，需要每次约 **10.6 个 WORK 部件当量**。
⇒ 所以"空载腿留能"能**开工**（把 `built` 从 0 变非零），但**保不住路**：铺完还会以每 ~560 拍一段的速度掉光。
⚠️我没填"每 WORK 每拍几点"（docs/@types 未取，见 §20 教训），但**结论对该常数不敏感**：在 1～5 点的整个区间里 (B) 都不够，差距 2～10 倍。

**(A) 因此以新的依据部分回归 —— 但不是同一句话**
R286 我否证 (A)（回收西缘 site 带）的依据是"那 15 格在真实车道上、也在施工射程内"，**那部分证据没有被推翻**。
现在新增的、独立的一条是：**就算把它们建完，维持成本 0.54 点/拍也远超这条车道能提供的施工密度** ⇒ "建完"不是终点而是负债的开始。
⇒ 所以取舍从"(B) 做不做"换成"**这条车道还该不该持有路网**"，三个可选面（都属人，我不动手）：
① 把路当**耗材**：只保关键格（源旁/高热度），接受其余自灭 ⇒ 需要给回收器加"值不值得续命"的判据；
② 提高**每次施工产出**：远矿 hauler 的 body 加 WORK（拿载重换施工，动排产，正是我此前排除的那类代价）；
③ 降低**存量**：`roadSitesPerOpTotal=20`、`roadStaleReapTicks=2000` 这些"铺多少"的参数收紧，把车道预算让给别的房。
**方法论**：我上一节的措辞是"(B) 是把 built 从 0 变非零的唯一已知路径"——这句仍然对；**错的是我由此暗示"B 值得做"**。
机会密度和维持成本是两件事，只量前者会系统性高估任何"多创造施工机会"类修法的价值。规矩：**今后凡是"提高施工/产出机会"的修法，先量维护需求再谈收益**（已写进长期记忆）。
**边界**：单房 W37S57 的衰减分布 + 一次跨 boot 的历史差；`hits` 与 `ticksToDecay` 关系非单调（3500  hits 只剩 281 拍、1800 还有 783 拍）⇒ 衰减不只由 hits 决定，所以我把中位数当**估计**而不是常数用。零 src、零 push。

### R314（10-04 20:2xZ，本会话）上一节那个"我拒绝猜的常数"取到了：`BUILD_POWER = 5` ⇒ #111 的缺口从"2~10 倍"收成**确定的 2.1 倍**
- 常数来源（不再是我脑内的）：`node_modules/@types/screeps/index.d.ts:174` → `declare const BUILD_POWER: 5;`（类型字面量，即本构建针对的引擎口径）。
- 路造价 300 点的来源也不是我推的：本会话多次现读 `kernel.expectations.violations` 里的原文
  `type=road prog=215/300`、`prog=0/300` ⇒ `progressTotal=300` 是**现场读数**；`roadProgressSum=505` 对 18 个 pending 也在这个量纲上自洽。
  ⚠️别和 `hits` 混：同一批路的 `hits` 实测到 3500，说明**建成后命值远大于 300**，衰减到零是慢过程 —— 这正是"铺得完、保不住"能同时成立的原因。
- 于是维持经济学全部闭合（W37S57，本 boot 段）：
  · 需求 = `300 ÷ 555 ≈ 0.54 点/拍`（中位剩余寿命；短期上界 8.2 点/拍）
  · 供给 = `0.051 次 build 拍/拍 × 5 × W`，`W = 该 hauler 的 WORK 部件数`
  · **`W=1` ⇒ 0.255 点/拍 ⇒ 差 2.1 倍**；`W≥3` 才在纯 (B) 下自洽（`0.051×5×2.1≈0.54`）。
  · `W` 的下界已知（该房 `noWork=0` ⇒ 每台至少 1 个 WORK），**准确值我没测**：`ticksToDecay` 那发只读探针没顺带取 body。
    ⇒ 所以"差 2.1 倍"是 **W=1 情形**的值；若实测 `W=2`，缺口刚好被 (B) 抹平（0.51 vs 0.54），`W≥3` 则有富余。
**这条把 #111 的取舍变简单了**：真正要回答的不是"(B) 值不值"，而是
**"把远矿 hauler 的 WORK 从 1 提到 2–3（拿载重换施工），还是承认这条路是耗材"**——
而 `W` 只要 **2** 就基本打平维持成本，这个门槛比我上一节写的"2~10 倍"低得多，值得重新判一次。
**下一手（一条只读探针即可定案）**：读 W37S57 的 `remoteHauler` body（`getActiveBodyparts(WORK)` + `store.getCapacity(RESOURCE_ENERGY)`），
把 `W` 和载重上限填进去 ⇒ 直接算出"加 1 个 WORK 换掉多少载重、够不够 0.54 点/拍"。本轮未做（刚发过一次 console，避免与对端撞 `__evalResult`），
**已写成可照抄的一次读数**，不靠推断过案。
**边界**：仍是单房（W37S57）与同一 boot 段；W36S58 的机会密度更低（82 次），那边缺口更大，别把这条当全帝国结论。

### R315（10-04 20:2xZ，本会话）body 实测到了：W37S57 的远矿 hauler 是 `1W 20C 21M / 载重 1000` ⇒ 缺口 2.1 倍是**现实值**，而补上它只要 **−5% 载重**
只读探针（`mark=R314B1`，t=83423073，房内 2 台 remoteHauler，两只同形）：
`[WORK=1, CARRY=20, MOVE=21, capacity=1000, bodyLen=42, ttl=458/1218]`
⇒ R314 里"W=1 情形差 2.1 倍"**不是假设，就是现状**：供给 `0.051 × 5 × 1 = 0.255 点/拍` 对需求 `0.54 点/拍`。

**把代价算成部件级（引擎单价：WORK 100 / CARRY 50 / MOVE 50，均按本构建可用的 @types 口径与现场容量反推）**
- 现 body 造价：`1×100 + 20×50 + 21×50 = 2,150`；载重 `20×50 = 1,000` ✓ 与实测 capacity 一致（这条自洽顺带证明我的单价没搞错）。
- 改成 **2 WORK**：`2W + 19C + 20M = 200 + 950 + 1,000 = 2,150`（**造价不变**，只从 42 件变 41 件）⇒ 载重 `19×50 = 950`，**−5%**；MOVE/CARRY 比从 21/20 变 20/19（≈0.95→1.05），平地速度不受损。
- 收益：施工供给 **0.255 → 0.51 点/拍**，对需求 0.54 ⇒ **94%，基本打平**（不再是"差 2.1 倍"）。
⇒ 所以 #111 的实际选择题被压到很小的一句话：**"远矿 hauler 少带 50 能量（−5%），换这条车道的路能自维持"**。
（前提仍是 (B) 一起做：留能在空载腿上——没有 (B)，这 348 次机会一次都抓不到。）
- 短期上界那 3 段（≤110 拍到寿）**无论如何保不住**：突发需求 8.2 点/拍远超 0.51，稳态打平不等于能抢救。⇒ 建完新 site 之前，已有路网会先掉几段，这是既成事实，别当成 (B) 失效。

**诚实标注：这条判决我已经是第三次改（R312 "唯一已知路径" → R313 "不足以求值" → R315 "只要 −5% 载重就打平"）。**
前两次翻案都不是推理出错，而是**新仪器进场**（第一次是 `noEnergyInRange` 上线，第二次是 `ticksToDecay`，第三次是 body 组成）。
⇒ 我把这条定为**定案候选**：除非出现这三类之外的新证据（例如 W36S58/幼房的实测、或真实衰减率与中位数不符的长窗），不再凭现有读数继续翻。
下一手的**新证据类型**只剩两种，都不是再想一遍：
①跨一段（≥1 天）实测 `roadsBuilt` 与 `roadProgressSum` 的联合轨迹，检验"中位剩余寿命 = 稳态流失率"这条假设；
②W36S58 与 W37S57 的 body 对比（那边机会密度只有 82 次、缺口更大，可能连 −5% 载重都换不来打平）。
**边界**：两只 hauler、同一房、同一 boot 段；`ttl` 分别 458/1218 ⇒ 其中一只快到寿，**body 组成会随孵化时的容量上限变**（我不是拿一个样本外推整机队，只是拿它确定"当前值"）。零 src、零 push。

### R316（10-04 20:2xZ，本会话）远矿施工能力是**能量档位的副产物**：0-WORK 的那几条车道，路永远建不成，而我的新计数在那里是瞎的
只读探针（`mark=R316A1`，t=83423107，帝国全部 10 台 `remoteHauler` 的 body 组成，按房聚合）：
```
W36S58 3 台  [1W 20C 21M] cap 1000
W37S57 2 台  [1W 20C 21M] cap 1000
W37S58 1 台  [1W 20C 21M] cap 1000     （在自家核心房，属在途）
W38S56 3 台  [0W 16C 16M] cap  800
W39S56 1 台  [0W 16C 16M] cap  800
```
⇒ **两套模板**：1000 档带 1 个 WORK，800 档**一个 WORK 都没有**。
读码确认 0-WORK 不是异常：`src/config/bodies.ts:1668-1691` 的档位选择里，远矿 hauler 的目录本来就含**无 WORK 的档**
（如注释里点名的 `[24C,12M]` idx0 与 `[16C,8M]` idx3 是 2:1 道路档，其余 1:1 平原档由 `roadlessIndices=[1,2,4,5,6,7,8]` 挑选），
选择依据只有一个：`energyCapacityAvailable >= minCapacity && bodyCost <= energyCapacityAvailable`（`:1665-1666`）。
而 `remote-mining-manager.ts:159-165` 明确用 `hasRoad` 在 2:1/1:1 档之间切档。
⇒ **所以"这条远矿车道的路能不能被建起来"不是设计选择，而是"那房当时孵得出哪一档 body"的副产物**；
  能量越差的房（W38S56 幼房、W39S56）越容易落在 0-WORK 档 ⇒ 那里 `built` 恒 0 是**结构必然**，不是懒。

**两个直接后果（都要现在写死，否则下一轮会被读数骗）**
1. **我的 `noEnergyInRange` 在 0-WORK 房是盲的**：那一列的口径带 `workParts > 0` 闸门（R288 设计如此），
   所以 W39S56 的 `noEnergyInRange = 0` **不能读成"没有机会"**，正确读法是"这台 body 根本没资格施工，扫描都没跑"。
   ⇒ R313 我写"W39S56 被排除在 (B) 受众外、动作属 body"——方向对，但当时给的是**推测**（`noWork=150` 只说明有 WORK 缺失这事实），
   现在才有机制：0-WORK 是 body 目录的合法档，由能量档位决定。
2. **可能的正反馈**：穷 ⇒ 孵 0-WORK 档 ⇒ 路建不成/保不住 ⇒ 通勤疲劳更高 ⇒ 更穷。
   本会话没有量过疲劳代价，**所以我只把它标为待验的怀疑，不当结论**；验法便宜：
   对比同一条车道 `roadsBuilt` 高/低时期的 `remoteHauler` 单趟往返拍数（`bodyLen` 与位置序列现成）。

**建议的仪表修法（1 行，纯观测，和 `noEnergyInRange` 同批）**：0-WORK 时也扫一次射程，把那种拍记进新桶 `noWorkInRange`。
这样"施工机会有但没手"和"根本没机会"在账本上第一次可分；不加这一列，(B) 的定价在 0-WORK 车道上永远缺一个分母。

**对 #111 决策的实际影响**：R315 那句"少带 50 能量换 2W"只适用于**已经带 WORK 的 1000 档**；
若 (B) 要推行，前提是 **body 目录给远矿 hauler 保证 ≥1 个 WORK**（否则能量差的房直接出局，而恰恰是那些房最需要同一条车道更快）。
⇒ 这条属人，且它现在是"**要不要给远矿 hauler 设 WORK 下限**"，比"要不要留能"更前置。我不改 `bodies.ts`。
**边界**：10 台一次快照、5 个房；`byRoom` 里 W37S58 那台是在自家房的在途单位，不代表该房有远矿点。零 src、零 push。

---

## 巡检 R317（12:2xZ，tick 窗 ~83423xxx）——把 R316 自己点名的盲区补成仪器：`noWorkInRange` 落地（纯观测，带反向实验），并**作废本仓一句已失效的注释**

### 一、做了什么（只动我自己的车道，零 push 零部署）
R316 的结论是「远矿施工能力是能量档位的副产物」，而我当时指出自己的 `noEnergyInRange` 在 0-WORK 走廊恒为 0、**那是盲区不是读数**。本轮就补那一列：

- `domain/logistics/road-build.ts`：新增 `noWorkInRange`（口径=「`noWork` 那一拍射程内确实有自己的 site」＝「body 补一个 WORK 就会真建上」）。
- `creeps/roles/remote-hauler.ts:63-76`：`workParts === 0` 分支扫一次已缓存的 site 数组、命中即 `break`。**不发 `find`、不发寻路、不发 build**，早退顺序不变（先判能、再判人）。
- `kernel/global-cache.ts:944`：建行处补 `noWorkInRange: 0`（体检脚本据此分清「从未执行」与「读到 0」）。
- 单测：4 条新用例 + 零值形状补键 ⇒ 该文件 **22/22 绿**；`tsc --noEmit` 无输出；prettier 全过；eslint 0 error（9 条 warning 全是该测试文件既有的 `any`/非空断言）。

### 二、反向实验（这次是新列自己咬自己，不是"全摘全红"）
把新分支的条件钉成 `false`（其余一律不动）后重跑：**恰好 2 条红**——「有能但无 WORK、脚下有格 → 记 noWorkInRange」与「两列新桶互斥、可相加」；
**20 条全绿**，包括三条控制组：「射程外不记」「又空手又无 WORK 不记」「满载那一拍 built=1 且两列新桶恒 0」。
⇒ 这一列确实由「有能 + 无 WORK + 脚下有格」这一个合取决定，不是顺带被别的分支抬起来的。钉完已原样复原并复跑 22 绿。

### 三、撤回一条**写在代码里**的过期结论（这是本轮唯一改变既有文本的动作）
`road-build.ts` 对 `noWork` 的原注释是「因 body 无 WORK 早退的次数（本次线上实测：应为 0 —— **该归因已被证伪**）」——**那句话现在作废**并已就地改写：
R316 普查 10 台 remoteHauler ⇒ W36S58/W37S57/W37S58 是 `[1W 20C 21M]`，W38S56(3 台)/W39S56(1 台) 是 `[0W 16C 16M]`，且 0-WORK 是 `bodies.ts:1668-1691` 按 `energyCapacityAvailable` affordable 出来的**合法档位**。
首轮读到 `noWork=0` 只说明**那两条走廊当时带 WORK**，不说明这条通道不存在。留着那句「已被证伪」，下一轮会把一个真读数（某房 noWork 很大）当成仪器坏了。
**方法论**：一条否证性注释的作用域是**它采样过的那几个房**；写「已被证伪」时必须同时写清在哪个样本上证的，否则它会变成全仓的免检牌。

### 四、口径与不变式（下一轮读账本前先记住）
- `noWorkInRange ≤ noWork`（子集，**不可与父桶相加**）；
- 与 `noEnergyInRange` **互斥**（前置分别是 `workParts === 0` / `> 0`）⇒ **两列可以相加**，和的含义是「这一拍只差一样（能量或 WORK），且脚下就有格」＝可行动机会总数；
- 「既无能量又无 WORK」故意两列都不记：那一拍换 body 或留能量单独都不构成一次施工机会（这条口径有一条用例钉住）。

### 五、上线判据（**当前状态=WIRED 未 EXERCISED**，零部署所以零线上读数）
判据按现读口径写死，不等上线后再解释：
1. 部署后第一读（`Memory.kernel.stats.roadBuild.<房>`，零 console）：**W38S56/W39S56 应出现 `noWorkInRange > 0`**，且同两房的 `noEnergyInRange` 仍为 0 ⇒ 新列有写者、盲区确实存在过。
2. 若在 0-WORK 房读到 `noWorkInRange = 0` 而 `noWork > 0` ⇒ **这些走廊连"脚下有格"都没有**，那么 (B) 与 WORK 下限对这两房都无收益，本案在此房结案于「落点」而非「力气」。
3. `noEnergyInRange + noWorkInRange` × 每格 300 点 ⇒ 与缺口 `roadSitesPending×300 − roadProgressSum` 对照，才是 #111 完整价格（上一轮只量到 WORK 档那一半：≈5,690 点缺口对 348 次机会）。
**反例自查**：若某房 `calls` 在涨而两列新桶恒 0 且 `noWork` 也恒 0 ⇒ 说明该房 body 带 WORK、腿也不空，新列本就不该动，不算失效。

### 六、范围与边界
只动 3 个 src 文件 + 1 个测试文件；**未改 `bodies.ts`、未改任何阈值/车道参数**（WORK 下限属人的决定，仍挂在 #111 待裁决）；`git status` 只有对端的 ` M .gitignore` 与两份未跟踪文档，一律未 stage；stash 空；本批含 `c76aad4`(#113) 共 **21 笔未推**（我的 R31x 与对端 R14x/R15x 两套编号交错、各自递增，已数过不撞号）；**未 push、未 build、未 npm、零 console 探针**（本轮全部结论来自代码与既有单测）。goal 保持 active。

---

## 巡检 R318（12:3xZ）——P1 观测补丁落地：`observeCounters` 把「Observer 楼在不在」从推理变成落盘读数（#100 的解锁件，未推）

**为什么现在做**：#100 卡在四源全空（R307/R308 核过 intel 段、Memory、日志、代码，仍答不出「本帝国到底有没有 Observer 结构、请求发没发出去」）。根因是形状问题不是取证不够：`room-observer.ts` 原来写 `if (snapshot.observer && ctx.tick % OBSERVE_INTERVAL === 0)`——**楼不存在时整条分支一声不响**，与「楼在但选不出目标」「楼在但引擎回 ERR_RCL_NOT_ENOUGH」**三种形状同形**，而这三种要的动作互相矛盾（盖楼 / 改选靶权重 / 改 RCL 前提）。

**改了什么（5 个文件，纯观测、零决策接入）**
- `domain/intel.ts`：`ObserveCounters` 类型契约（含立案理由与自洽式）。
- `kernel/global-cache.ts`：`observeCounters(room)` 唯一建行处 + `GlobalCache.observeLedger` 字段（照 `roadBuildLedger` 同一条路，不发明新机制）。
- `systems/room-observer.ts`：把顺序改成**先判到点再判有没有楼**（到点判断只是取模，CPU 曲线不变），四个桶落盘：`gate`/`noObserver`/`noTarget`/`ok`/`codes[原始码]`/`captured`/`lostVision`/`staleSlot`。返回码**按 String(code) 建直方图、不写枚举名**——本服码集合按记忆造会错（R316 同族的第三次）。
- `systems/telemetry-collector.ts`：flush 到 `Memory.kernel.stats.observe`（与 roadBuild 同一处、同一写法）。
- `tests/unit/systems/room-observer-ledger.test.ts`：新文件 7 条，**跑真实 `roomObserverSystem.run(ctx)`**（不是测我自己手拼的形状），每个桶各由一条真实分支写出。

**取证**：7/7 绿、`tsc --noEmit` 空。反向实验：把 `counters.noObserver++` 摘掉 ⇒ **恰好 2 红**（「没有楼」那条 + 「按房分桶」那条，两者都断言 noObserver），其余 5 条（gate 分母 / ok / codes / noTarget / staleSlot+lostVision 闭合）全绿 ⇒ 归因干净，不是"全摘全红"。复原后复跑 7 绿。

**仪器自带的谎警器**：`ok === captured + lostVision + staleSlot`。有一条用例就在真实两次 run 序列上断这个闭合（第一拍 OK、第二拍无视野 ⇒ lostVision=1）——所以「左端有写者、右端全 0」这种 #106 型失效（计数器存在但从未被写）在本文件里当场可见。

**★上线前的预报（先写死，再读数，不许事后解释）**
1. `stats.observe.W37S58.noObserver === 0`（核心房 RCL8，楼应存在）。**若它 >0** ⇒ 不是"没有楼"，而是 `snapshot.observer` 这个字段没被快照填上 —— 那是另一个缺陷，且是这台仪器第一次读数就能区分的两种形状之一。
2. `stats.observe.W38S56.noObserver > 0`（幼房 RCL<8，楼按构造不存在）。这一列第一次给"幼房没有楼"一个正面读数而不是推测。
3. 核心房 `ok > 0` 且闭合式成立；若 `codes` 里出现 `-15`（RCL 不够）或 `-12`（超出 10 房）⇒ #100 的两个候选答案当场二选一，不必再猜。
4. `gate === 0` 而房在自己手里 ⇒ 与本补丁无关的另一件事（系统被 CPU 档拒 / interval 没轮到），届时按 G6 那条线查，别算到这台仪器账上。

**边界**：未推（`c76aad4`/`c2e3e30`/本笔共 **3 笔含 src 未推**，与对端的 R14x/R15x 文档批同在一个 `origin/dev..HEAD` 里 ⇒ 报"我未推几笔"时别把他们的算进来）；**没改 `bodies.ts`、没改 OBSERVE_INTERVAL、没接任何决策**；本笔只给 #100 提供读数入口，「加权重 vs 盖楼」仍属人；commit 前 `git diff --cached --name-only` 为空（共享索引检查过）；`.gitignore`(对端) 与两份未跟踪文档未 stage；零 console 探针、零 build、零 npm。goal active。

---

## 巡检 R319（12:4xZ，t=83423379→83423399）——三条现场真相：#100 的"盖楼"选项**有据摘除**、#111 的两条杠杆**分属不同房**（并否证我上一轮那句话）、W37S55 有 2 只**无人认领的我方 spawn**

### 一、#100：Observer 楼**已经在**，所以"盖楼"不再是可选项
只读探针 `mark=R318A2`（t=83423379）普查 9 个有视野房：
```
W37S58 rcl=8 spawns=3 observer=1 obsSite=0   ← 全帝国唯一一座，且已在
W38S56 rcl=5 spawns=1 observer=0 obsSite=0
W38S58 rcl=2 spawns=0 observer=0 obsSite=0
其余 6 房 rcl=0（远矿视野房，非自有）
```
`statKeys` 只有 `roadBuild` ⇒ `observe` 键不存在 = R318 那台仪器确实还没上线（预期之内，不是失效）。
⇒ **#100 的两个候选动作当场二选一**：楼存在，缺的不是楼。剩下的真实上限是「一座 RCL8 房的 observer 每 25 拍只刷一个邻房、候选只有 4 个出口」+「幼房要 RCL8 才可能有楼，按构造短期无解」。
⇒ 交给人的清单因此**收窄为一条**：observer 的稀缺配额要不要按"扩张候选优先"来选靶（现在只按 未知>陈旧 排）。**"先盖楼"这一支从今天起不要再列**——它是已有能力。

### 二、★撤回我 R317 写的一句话（同族第四次：又是只读了链的一半）
R317 我写「0-WORK 房是 WORK 下限的主要受众」。**这句错了**，同一探针的 `roadBuild` 快照（本 boot 段累计）给出反证：
```
房        calls  noEnergy noWork  built  pending prog roadsBuilt
W37S57      853      601      0      0     18    505      13
W36S58      728      461      0      0      4    405       4
W38S56      488        0    488      0      0      0       0
W39S56     1347      882    465      0      0      0       2
W37S58      994        0      0      0      0      0       0
```
`roadSitesPending`（规划器那一侧写的，不是 creep 侧）**只在 W37S57/W36S58 非零**；W38S56/W39S56 是 **0 个待建路 site、progSum 0**。⇒ 那两条 0-WORK 走廊**压根没有路可建**，换 body 也建不出东西；我假定它们"有力气没手"，实际上它们"连格都没铺"。
**方法**：判"某房缺哪种力气"之前，先读规划器那一侧的 `pending`，别只读 creep 侧的早退桶 —— 这是 `noEnergy` 盖住射程、`noWorkInRange` 盖住 pending 之后的第三次同一形状。

**于是 #111 的两条杠杆现在分属两房、不是一件事**：
- **W37S57 / W36S58**（有 site、body 已带 WORK，`noWork=0`）⇒ 堵的是**空腿没能量**（`noEnergy` 占 calls 的 70% 与 63%）。正确动作是 (B)「空载腿留 200-300 能量」；而它们的精确价格仍要等 `noEnergyInRange` 上线（现在只有 348 次那个旧估计）。
- **W38S56 / W39S56**（0-WORK 档，`noWork` 分别 488/488=**100%** 与 465/1347）⇒ 但它们 `pending=0` ⇒ 今天的动作不是换 body，而是"这两条车道要不要铺路"。**WORK 下限的收益面因此比我上一轮说的小得多**，且不在最穷的房。
（两房的桶闭合：`882+465=1347=calls`、`0+488=488=calls` ⇒ 早退顺序读得通，没有第四种去向。）
- 另一条照实记：**`built` 全帝国为 0**（本 boot 段一次被接受的 build() 都没有），而 `roadsBuilt` 有 13/4/2 ⇒ 存量路是更早建的，此后只进不出。**不据此定案**：boot 段短、且 pending 的 18/4 格进度在动（progSum 505/405），下一段要差分着读。

### 三、L0 §3.4「失守房与资产损失」第一次有现场例证：**#118** — W37S55 留着 2 只无人认领的我方 spawn
两发独立读数（`R318A2` 与 `R318A4`，t 相差 20 拍）：
`Memory.rooms` = `["W37S58","W38S56","W38S58"]`（自有房三口，`controller.my` 同集合）；而 **W37S55 不在 Memory、controller `my=false`/owner null/level 0，却仍有 2 只 `my===true`、owner=`yintianyan` 的 spawn**（Spawn4 内存能 300、Spawn3 0；`FIND_HOSTILE_SPAWNS=0`、我方 site=0）。
⇒ 这不是"读数怪"，是链的形状：**任何按 `Memory.rooms` / `ctx.snapshots()` 遍历的机制都天然看不见它** ⇒ 无人计账、无人使用、无人拆除。两只 spawn 的建造成本是 2×15,000 能量量级（口径：这是**造价推算**，不是现场读数，别当实测）。
三个处置都属人，我不自办：**留着并让它可被管理**（要给该房补 Memory 条目＝状态改写）、**拆走回收**（本会话政策禁止我单方面拆除）、**忽略并接受其自衰减/被攻击**（不建 owner 的房没有维护链）。我只把它的存在与"看不见它的机制是哪些"记进台账。

**边界**：探针 console-eval ×3（其中一发因我按记忆造名 `my(...)` 被 ReferenceError 拦下——本会话第 N 次同族，**表达式里只用引擎真名，未验证的名字不进探针**；该发零副作用）、全部只读；本轮**零 src、零 push、零 build、零 npm**；`roadBuild` 读数是 heap 本 boot 段累计（起点=对端 R143 那次部署 ≈83422285），跨段不可直接比；`.gitignore`(对端) 与两份未跟踪文档未 stage、stash 空、索引检查过为空；3 笔含 src 未推（`c76aad4`/`c2e3e30`/`994bf54`）。goal active。

---

## 巡检 R320（12:4xZ）——推送前的完整证据集：单元+集成+docs 全绿，**e2e 故意不跑**（跑它会毁掉对端正在用的那台免费仪器）

**这一轮只做事实验证，零 src 改动**（三笔未推的代码就是 R317/R318 那两批 + `c76aad4`）。

| 门禁 | 命令 | 结果 |
|---|---|---|
| 文档体检 | `npm run check:docs` | 通过（无注释引用文档路径） |
| 单元 | `npx vitest run tests/unit` | **390 文件 / 5264 用例全绿**（45.7s） |
| 集成 | `npx vitest run tests/integration` | **30 文件 / 239 用例全绿**（9.5s） |
| 类型 | `tsc --noEmit` | 空输出 |
| **e2e** | `npm run test:e2e` | **未跑 —— 有意为之**，理由见下 |

**为什么故意不跑 e2e**：`test:e2e` 的 script 是 `npm run build && vitest run tests/e2e`，而 e2e 读的是 **dist**。本工作区多路会话共用同一份 dist，且"**本地 dist == 线上二进制**"是 A/B 判效窗里唯一免费的那台仪器（台账里已写过"单二进制 A/B 窗内故意不 build"）。对端此刻正跑 W38S58 的判效窗（`energyLedger.tick=83422285` 那次部署起算）⇒ 我 build 一次就会把该仪器清掉，且让他们的 sha 锚点读到"本地≠线上"而误判成有人换了码。**要么等他们的窗关（预写的自然观测点 `bootstrap.until=83424757`，wave7）之后再 build+跑 e2e，要么由我决定在窗内不跑。**
另一个更糟的选项是"不 build 直接跑 e2e" ⇒ 那是在测旧二进制，绿灯是假绿（这条我 10-01 就写过：e2e 读 dist、terser 下要搜规则文本而不是变量名）。

**因此这批的验证状态要说准**：`#113 修复`+`noWorkInRange`+`observeCounters` = **unit/integration/typecheck 已覆盖并全绿**，**e2e 未覆盖**（不是失败，是没跑）。三笔合起来对 dist 的净改动都是"新增列/新增计数/少抹一个键"，不新增系统、不改节拍。

**推送侧的机械条件已核**：`git fetch` 后 `behind=0 / ahead=27`，且 origin 自 merge-base 起 `src/` 零改动 ⇒ 纯 fast-forward、不会连带对端未完成的东西。commit 前索引两次为空（共享索引检查过）。

**边界**：本轮零 src、零 push、零 build、零 npm install、零 console 探针；`.gitignore`(对端) 与两份未跟踪文档未 stage、stash 空；新立案 **#118**（W37S55 两只无人认领 spawn）编号已数过全集、与对端 #115/#116/#117 不撞。goal 保持 active——三笔仪器仍是 WIRED+单测 EXERCISED、线上未 EXERCISED，终局未达成。

---

## 巡检 R322（12:5xZ）——#106 被我自己重述：不是"忘了调 `recordDelivery`"，是**整层合同生命周期从未接进产线**（而 §3.3 要的闭环另有一条活路）

起因是我想按 L0 §3.3「需求→计划→实际运输→**接收确认**→经济记账形成闭环」把 #106 接上。读到底之后，**这个修法本身不成立**，证据如下（全部现读 `src/`，零探针、零改码）：

**一、死的不是"一个调用"，是三个模块**
```
domain/economy/contract-lifecycle.ts   ← src 导入者：0
domain/economy/route-efficiency.ts     ← src 导入者：0
domain/economy/contract-node-bridge.ts ← src 导入者：0
domain/economy/supply-contract.ts      ← src 导入者：2（logistics-planner / specialization-planner）
```
而这两个导入者只用了 `contractEndpointsHaveStorage()`（两端 storage 安全闸）+ `deserializeContract()`（#35 那条反序列化修复）+ `SupplyContract` 类型 ⇒ **`recordDelivery()`、状态机、路线效率判定全都不在任何调用路径上**。`logistics-planner.ts:261` 的注释自己写着："Contracts 由 supply-contract-manager（**未来模块**）或 empire-economy 写入"——那个 manager 从没被建。

**二、按构造不可达的东西，现在能点名（这才是严重度，不是"台账是化石"）**
- `supply-contract.ts:291 recordDelivery()` 是 `consecutiveShortfall` 与 `lastInjectionTick` 的**唯一写者**（`updatedAt` 同），零调用者 ⇒ 两字段自创建起恒 `0` / `undefined`。
- `contract-lifecycle.ts:298/:311`：`ACTIVE→DEGRADED`、`DEGRADED→…` 都要 `consecutiveShortfall >= producerShortfallThreshold` ⇒ **按构造永不触发**。
- `contract-lifecycle.ts:320`：`!producerShortfall && consecutiveShortfall === 0` 的"恢复"分支同理，只是它恰好恒真——**这条不是不可达，是恒可达**（`>=0` 那个判断也恒真，见 `:269`）：状态机一边有按构造不发生的转移，一边有按构造必发生的转移。
- `route-efficiency.ts:210`：`grade==="fair" && consecutiveShortfall > 2` 的降级规则同样不可达。
⇒ 所以「合同级」的接收确认与状态流转，今天**整片不在产线**；这与 #107（domain 层 33/225 零生产导入者）是同一件事，不是新缺陷。

**三、重要的反向发现：§3.3 要的闭环并非全断，活的那条不叫 contract**
`logistics-planner.ts:22-28` 导入 `domain/logistics/transport-accounting` 的 `createAccounting / recordDelivered / recordLost / summarizeAccounting`，并在 `:252` 真把 `req=…/del=…` 打进日志 ⇒ **运输级（Operation 级）的"投递确认+损耗记账"是活的**。合同级是设计过但没接线。
⇒ 这条区分很关键：如果按"闭环断了"去大动，会拆掉一个本来在工作的机制；正确的问题只是「**合同这一层要不要存在**」。

**四、为什么我这一轮不起手改码（不是求稳，是会引入缺陷）**
1. 只把 `recordDelivery()` 接进某处**没有意义**：它的消费者（状态机、route-efficiency）本身零导入者 ⇒ 接完仍然没人读，且给一个"未来模块"补一份现在无人负责的行为。
2. 真接法要先回答**归属口径**，而这是个设计决策：现场唯一的交付信号是 `carrier.ts:57 bumpEnergyCounter(room, "imported", amount)`（按**房**记账，且 #48 已证 `imported` 含**远矿流入**，不只合同交付）。把房级 `imported` 直接喂给某个合同的 `deliveredAmount` ⇒ **合同会拿到不是它送出的能量**，而那份读数今天会喂给 `producerShortfallThreshold` 与"consumer 自给自足"两把判定 ⇒ 一旦接线就把错账变成错决定。
   出路两条都属人：**A 加一个按合同/Operation 归属的交付计数**（`recordDelivery(contract, opDelivered, tick)`，Operation 级才有正确分母——活着的 `transport-accounting` 正是这一级的数据源，接法是把合同的 `key` 与 operation 关联起来）；**B 删/休眠合同这一层**（承认 §3.3 由 transport-accounting 满足），并摘掉 `#35/#48` 挂在合同台账上的判据。
3. 另外 `:269` 的 `consecutiveShortfall >= 0` 恒真、`:320` 恒可达这两处**是缺陷而不是设计**（注释自己说"简化：…调用方应自行追踪"）⇒ 真要接，得先修这两把恒真/恒假的判据。

**边界**：零 src、零 push、零 build、零探针（本轮全在读码）；`#106` 的标题已按本轮结论重述，`#107` 的清单里可据此把这三本记为「同一族的合同层」；`.gitignore`(对端) 与两份未跟踪文档未 stage、commit 前索引为空、含 src 未推仍 3 笔。goal active。

---

## 巡检 R325（13:0xZ）——批次与线上状态的机械核对：部署这一步现在是"单动作、无歧义"的

**为什么这轮只做核对**：剩下的是授权问题不是工程问题。核对的目的是让"推"这一句落下时不需要任何人再现场查任何东西。

| 核对项 | 命令 | 结果 |
|---|---|---|
| 我的 3 笔是否已随对端批次偷偷上线 | `git fetch` + `merge-base --is-ancestor` | **全部 NO**（`c76aad4`/`c2e3e30`/`994bf54` 都不在 `origin/dev`）⇒ `behind=0 ahead=33`，纯 fast-forward |
| 线上跑的是哪一份码 | `node tmp/tools/official/check-code.mjs` | 本地 `dist/main.js` **787,752B sha=`649eb94b9784`**；`GET /api/user/code` 与 `?shard=shard3` **两处同值同尺寸** ⇒ **本地 dist == 线上** |
| 该 sha 里有没有我的改动 | 上一条 + 上一条第一行 | **没有**（三笔未推）⇒ `stats.observe`/`noWorkInRange`/`expectations.recent` 三处线上必然仍缺，任何"键不存在"的读数**不算否证**，只算未部署 |
| 这批的门禁覆盖 | 已在 R320 记录 | unit 390/5264 + integration 30/239 + `tsc` + `check:docs` 全绿；**e2e 未跑**（它自带 `npm run build`，会毁掉上面那行"本地==线上"这台免费仪器——而这台仪器现在正在被对端的判效窗使用） |

**一条纪律上的自纠**：本轮我又一次敲了 `timeout …`（macOS 没有 `timeout`，这条在我的记忆里就写着）。同族的错今天还有一次：探针里写了不存在的 `my(...)` 辅助函数 ⇒ `ReferenceError`。**共同点是我在用"手感"而不是"已核过的形状"**——工具层和引擎层各犯一次，代价都很小，但形状是同一个。

**授权落下时的完整链路（照此执行，不需再判断）**
1. `export PATH=$HOME/.nvm/versions/node/v24.18.0/bin:$PATH` 后 `git push origin dev`（pre-push 钩子会跑 typecheck+unit+**build** ⇒ 本地 dist 会随推送变成"我的树"，这**正是部署**，不是意外）。
2. CI 绿 + `check-code` 认新 sha（锚 `modules: {main: …}` 那一行；`/api/user/code` 可能 429，体为 `null` 按失败形状处理）。
3. 三个先写死的读数（零 console）：① `kernel.expectations.recent` 在违例转空后仍存活（#113）；② `stats.roadBuild.<W38S56/W39S56>.noWorkInRange > 0`，同两房 `noEnergyInRange` 恒 0 属预期（#111）；③ `stats.observe` 出现且**预报 `noTarget/gate ≈ 1`**（#100 的射程 vs 权重二选一，闭合式 `ok === captured+lostVision+staleSlot` 必须成立）。
4. 若 ①③ 的键存在但全 0 ⇒ 先证"这段窗口没发生对应事件"，再谈失效（`guardMiss`/`staleSlot` 这类桶在和平期本就应为 0）。

**边界**：本轮零 src、零 push、零 build、零 npm；探针 0 次（只用 HTTP 只读 API 两次）；`.gitignore`(对端) 与两份未跟踪文档未 stage、stash 空；含 src 未推 **3** 笔（不是 4——`0d8e1db` 已随对端批次上线，这条对端已更正过，我照实沿用）。goal active：目标未达成，部署与线上验证这两步仍卡在授权上。

---

## 巡检 R326（13:0xZ，t≈83423750）——**#111 拿到价格了**：`noEnergyInRange=831`、上限 ≈13 段路、缺口 4,895 点；顺带我的子集不变式在真数据上第一次自证，以及 #113 的读数**证实不了也否证不了**（诚实记）

只读 `peek.mjs kernel.stats.*` 三次（控制组+两待验），零 console、零 src、零 push。**关键副产物：`noEnergyInRange` 是已上线的**（`c58ff9d` 那批），而 `noWorkInRange` 缺键（`c2e3e30` 未推）⇒ 这发读数同时是"哪一批在线上"的形状证据。

**一、线上实读（本 boot 段累计）**
```
W37S57  calls 1212 | noEnergy 912 | noEnergyInRange 831 | noWork 0    | outOfRange 300(near296/mid4/far0) | built 0 | prog 505 | pending 18
W39S56  calls 2001 | noEnergy 1318| noEnergyInRange 0   | noWork 683  | outOfRange 0                      | built 0 | prog 0   | pending 0 | roads 2
W37S58  calls 1278 | noEnergy 0   | noEnergyInRange 0   | noWork 0    | noSiteAtAll 1278                  | built 0
```
① **我自己写的不变式在真数据上成立**：`noEnergyInRange(831) ≤ noEnergy(912)`，且 W39S56 那行 `noWork=683>0` 而 `noEnergyInRange=0` —— 正是 R317 预言的**结构性失明**（0-WORK 档扫描根本不跑），不是我读错。
② W37S57 的失明比例是决定性的：**912 次空腿里有 831 次脚下就有自己的格（91%）**，而该房 `built=0`、`roadProgressSum` 在 370 拍里纹丝不动（505→505）。⇒ "空腿把能量先交出去了"不是猜，是这条走廊的主要止步原因，而且**机会几乎不缺货**（不是落点问题：`outOfRange` 只 300 次，其中 296 次差 4-5 格）。

**二、(B)「空载腿留 200-300 能量」的价格，第一次可以算成段数**
- 单次机会的产能 = `WORK 部件 × BUILD_POWER`。口径都有出处：W37S57 的 remoteHauler 实测 `[1W 20C 21M]`（R315 body 现读、R316 普查复证），`BUILD_POWER=5`（`@types/screeps:174`，R314 现读）。⇒ **5 点/次**。
- 产能上界 = `831 × 5 = 4,155` 点；对照缺口 = `pending 18 × 300 − prog 505 = 4,895` 点 ⇒ **约 85%**。
- ⚠️但产能 ≠ 建成。**每段路要 60 个施工拍**（300÷5），而 `300 点/段` 与"46 拍/段"的分散度意味着：831 次机会按 60 拍/段折算 ⇒ **上限约 13 段**（对 18 个 pending）。这条折算就是 R311 那份"摊薄反例"（一串永远建不满的 site）现在能算出来的版本——**别把 4,155 点读成 13 段，13 段是上界**，实际取决于选择键能否把 60 拍集中在同一格（现行规则已是"射程内进度高者优先"，R146 之前的摊薄 bug 已修）。
⇒ **给 #111 的决策口径**：(B) 在 W37S57 一条走廊上值"最多 13 段路 / 缺口的 85% 产能"，代价是该房 hauler 每次空腿少运 200-300 能量（载重 1000 的 20-30%，**不是** R315 那句 −5%——那句是 1W→2W 换 body 的代价，两件事别再混）。W39S56/W38S56 两条 0-WORK 走廊**不在受众内**（`pending=0`，R319 已更正）。

**三、#113 的读数：证实不了，也否证不了——按实记**
`kernel.expectations = {"tick":83423712,"violations":[],"e3":{}}`，**`recent` 键不存在**。但这**不能**当成"旧缺陷仍在线上"的证据：本 boot 段若从未出现过违例，`violations` 一直是 `[]`，那么按**新**代码写出的 `recent: undefined` 也会被 Memory 原样丢掉 ⇒ 两种代码给出**同一个形状**。
⇒ 判据必须挂在"**违例由非空转空**"那一沿上，而不是挂在"键不存在"上（这正是我记忆里那条"判效前逐条问这个读数可达吗"的用法）。本轮线上没有违例 ⇒ #113 的验证仍未开始，`c76aad4` 继续等推。

**四、#100 的仪器同次核对**：`kernel.stats.observe` → **不存在**，与"三笔未推"完全一致 ⇒ 这是"未部署"，不是"没写者"，也不是"坏了"。

**边界**：本轮全部结论来自 `peek.mjs` 三次单路径读（控制组 `roadBuild` 先读通，再判 `observe` 缺键——这条"判空前先读通已知非空邻居"的规矩今天救过我两次）；`roadBuild` 是 heap 本 boot 段累计，跨段不可比；`pending/prog` 只 W37S57 有值（其余房为 0）；零 src、零 push、零 build、零 npm、零 console 探针；`.gitignore`(对端) 与两份未跟踪文档未 stage、索引为空。goal active。

---

## 巡检 R327（13:0xZ）——#113 的线上判据**当前按构造不可达**：违例沿在环内 1,042 拍里零命中，所以"推上去之后读不到 `recent`"将是**预期**而不是失败

**取数**（零 src、零 push、零 build、零 console）：写侧先读码定名 ⇒ `kernel.ts:600` `recordEvent(EventKind.ExpectationViolation, "kernel", [res.violations.length])`；读侧用**已核过的** `death-count.mjs` 取段 2 事件环，然后**枚举** `Object.entries` 全表（不是正则命中 ⇒ 零是完整计数，不是下界）。

**现场**：环内 500 条、跨度 `83422710→83423752`（**1,042 拍**，密度 0.48 条/拍），11 种 kind：
```
AssignmentAssigned=212  AssignmentExpired=195  CreepDeath=34  PhaseTransition=28
TowerVolley=17  ColonyStateChange=6  AccountingDrift=4  RecoveryEscalation=1
ControllerDowngradeRisk=1  EnemyInvasion=1  EnemyCleared=1
ExpectationViolation = 0   ← 完整枚举，非采样
```

**三条结论，都要按实说**
1. **#113 的判据不能挂在"有没有 `recent` 键"**（R326 已记：本 boot 段 `violations` 恒 `[]` ⇒ 新代码写出的 `recent: undefined` 也会被序列化丢掉，两版同形）。现在进一步：**违例这一沿在可观测跨度内从未发生** ⇒ 部署后我大概率**仍然读不到可判形状**。所以汇报口径必须是"**#113 线上验证未开始**"，既不是 PASS 也不是 FAIL。（这是记忆里那条"判效前逐条判这个读数可达吗"的第五次命中。）
2. **严重度随之降级但缺陷不变**：这个 else 分支抹掉留痕，只有在**真出过违例**之后才造成损失 ⇒ 今天的影响面是 0，修复的价值是**条件性的**（下次真违例时能不能留下现场）。我不把它报成"已修的现役故障"，也不报成"无关紧要可回退"。
3. **免费复证挂在触发器上，不必制造条件**（不能为了证据去改期望值——那是造假）：把判据写成"环里**第一次**出现 `ExpectationViolation` 之后，紧邻的干净一拍读 `kernel.expectations.recent` 必须仍存在且含该 id"。这条判据一旦触发就是硬证据；不触发就长期记 PENDING，**不许把 PENDING 读成结论**。

**顺带两条本次读数里长出来的可用事实**（留给下一轮，不用重新取）：
- 环密度 0.48 条/拍 ⇒ **环跨度只有约 1,000 拍**，任何"整个 boot 段有没有发生过 X"的问题都不能靠段 2 回答（本 boot 段是 83422285 起，已 1,400+ 拍）⇒ 判"从未发生"要说成"环内跨度未发生"。
- `TowerVolley=17` 与 `EnemyInvasion=1/Cleared=1`（`83423485@W38S56 → 83423505` ⇒ **在场 20 拍**）：幼房又挨了一次波，20 拍清除、塔打了 17 轮；这与 #41/#92 那条"在场时长 vs 5,000 拍尾税"的比值直接相关，**但税收不属我这条车道**（对端在跑 W38S58 扩张），只登记读数不动作。

**边界**：本轮零 src、零 push、零 build、零 npm、零 console 探针（只用只读 API 的现成脚本）；含 src 未推仍 3 笔；`.gitignore`(对端) 与两份未跟踪文档未 stage、commit 前索引为空、stash 空。goal active。

---

## L1 优先级重排（R328，10-04 13:0xZ）——今天四条新事实改变了序列，其余不动

**改变序列的事实**（都有本轮/本日出处，不重述细节）：① #100 的"盖楼"选项被现场读数摘除（楼已在 W37S58），只剩射程 vs 权重；② #111 拿到价格且**受众更正**（(B) 属于 W37S57/W36S58，WORK 下限今天买不到东西）；③ #106 从"缺一行调用"重述为"整层合同生命周期零导入者"，与 #107 同族；④ #118（W37S55 两只无主 spawn）与 #119（safe mode 返回码被丢弃）新立；⑤ `test:e2e` 的 script 自带 build ⇒ 判效窗内 e2e 不可用（这是排期约束，不是偏好）。

### T0 —— 解锁一切的一步（**属人：一句授权**）
推 `c76aad4` + `c2e3e30` + `994bf54`（纯 fast-forward、`behind=0`、origin 自 merge-base 起 `src/` 零改动；unit 390/5264 + integration 30/239 + `tsc` + `check:docs` 已绿；**e2e 未覆盖**）。
验收＝R325 的第 3 步三处读数（`expectations.recent` 挂在违例沿上，未触发就记"验证未开始"／0-WORK 房 `noWorkInRange>0`／`stats.observe` 出现且 `noTarget/gate≈1`）。
**为什么是 T0**：#100 的"射程 vs 权重"、#111 的完整价格、#113 的验证**全部只在等这三笔上线**，不是等分析。

### T1 —— 上线后立即做的两个判定（**机器给数，人拍板**）
1. **#100 选路**：用 `noTarget/gate` 比值二选一（≈1 ⇒ 扩靶到 10 房射程；小 ⇒ 给靶加敌情/扩张权重）。两条都是小改，但**选错方向就是把 A 的活儿花在 B 上**。
2. **#111 裁 (B)**：收益上限 13 段路 / 85% 产能，代价＝该腿运力 20-30%。同批可顺带把 #119（1 行返回码计数）一起走——它和 #111 的下一步判读共用同一把尺子。

### T2 —— 同一批"要不要存在"的合并裁决（**属人，且必须一起裁**）
`#106 + #107 + #104 + #110`：合同层三本零导入者、domain 层 33/225 零导入者、恢复链的不可达阈值与零读者 escalations。共同形状是**接上去只会制造没人读的读数**，所以裁决单位是"这一层的存在价值"，不是"某一行的接线"。
⚠️裁之前先读 §3.3 那条反向发现（transport-accounting 已部分满足闭环）——**别按"闭环断了"拆掉在工作的机制**。

### T3 —— 领土与资产的两笔账（**属人，彼此纠缠**）
`#118`（W37S55 两只 `my===true` 的 spawn，房不在 `Memory.rooms` ⇒ 全帝国机制看不见）必须与 `#78`（重占排除项永不过期）、`#13` 一起裁：**修 #78 的清理会静默重开"放弃 W37S55"这个决定**。单挑一条 = 互相撤销。

### T4 —— 排期约束（不是任务，是"什么时候才能做什么"）
- **对端判效窗关闭之前**：不 build、不跑 e2e、不单独推文档。自然观测点 `bootstrap.until=83424757`（wave7）。
- **一次部署＝清堆 + ~400 拍 G6 税** ⇒ 攒批走；heap 类计数器（`roadBuild`/`observe`/`expectations`）跨部署归零 ⇒ 判趋势一律差分，且"键存在但全 0"要先证该窗内对应事件没发生。
- **G6/#50 仍卡在属人**：唯一杠杆 `CONFIG.remote.maxOperations`，代价约 19.9/拍远矿收入 + 120 段已建路 —— 这条不会"长进去就过"。

### T5 —— L0 §2.3 交付物（**慢工，不阻塞上面任何一层**）
`#97`：§3.8 八项目前 2 格（Observer 7/8、Safe Mode 6/8）。下一格建议 §3.6 的 **Nuker/Ghodium** 或 §3.3 的 **Link/Storage 协作**，规矩不变：名字与字段一律先取 `@types`/docs 行号，未记录的（CPU 成本、冷却、造价数值）就写"未记录"，不引口头数。

**这一层不新增任何事实**，只把已核过的东西排序；所有编号沿用现有序列（#1xx，本轮数过不撞号）。goal active——L1 排序完成不等于目标达成，T0 仍需授权。

---

## 巡检 R329（13:1xZ）——完成审计抓到一条我自己从没登记过的缺口：**L0 §7 点名的 7 件产物，实际只有 2 件有真身**

按本轮的 prompt-to-artifact 核对（现读 L0 原文 `Long-Term Mission…md:1024-1040` + `ls` 根目录，不靠记忆）：L0「建议维护」列出 `docs/evolution/` 下 **ROADMAP / BASELINE / CAPABILITY_MATRIX / KNOWN_ISSUES / EXPERIMENT_LOG / ITERATION_LOG / CPU_BENCHMARKS** 七件，并写「如果项目已有对应文档，优先更新原有文件」。

| L0 点名 | 仓内真身 | 判定 |
|---|---|---|
| `ROADMAP.md` | `EVOLUTION-ROADMAP.md`（已跟踪，本文件） | ✅ 按"优先更新原有文件"满足 |
| `CAPABILITY_MATRIX.md` | `CAPABILITY-MATRIX.md`（已跟踪，§1–§21） | ✅ 同上（连字符差异，语义同一件） |
| `KNOWN_ISSUES.md` | `audit/FINDINGS.md` + `audit/VERIFIED.md` + 本文件的 #1xx 台账 | ⚠️ **半满足**：内容在，但没有"当前已知问题"单一入口（分散在三处，新会话要先学一遍坐标） |
| `ITERATION_LOG.md` | 本文件的「巡检 R###」序列 | ⚠️ **半满足**：每轮日志在这里，但它同时是 roadmap（一根时钟两用，正是 §19 点过的形状） |
| `CPU_BENCHMARKS.md` | 无文件；实测散在 `RawMemory.segments[1]` + 记忆 `cpu-calibration-harness` + 提交信息 | ❌ **缺件**：定标数据有真读数，但没有可引用的一份产物 |
| `BASELINE.md` | 无 | ❌ **缺件**（影响最直接：本会话反复"跨段不可比"，因为没有基线快照可对照） |
| `EXPERIMENT_LOG.md` | 无；`tmp/observe/*.log` 是未纳管的临时通道 | ❌ **缺件**：反向实验/判效窗的结论只活在 commit 信息里，不可检索 |

**为什么本轮不就地补三份文件**：这三件缺的不是"文件"，是**内容口径**——`BASELINE` 需要一次新鲜的全帝国快照（房/RCL/资产/CPU/账本速率）作为锚点，`CPU_BENCHMARKS` 需要现测拍长与负载而不是引用我一天里作废过两次的常数，`EXPERIMENT_LOG` 需要把散在 commit 信息里的判效结论按"预期→实测→裁决"重排。用今天已有的读数硬拼一份，就是把**推算当实测**——那是本文件最反对的动作（§19 与记忆"提交里的数字不能是推算"同一条）。**所以本轮只登记，不造件。**

**登记后的处置建议（属人，一次决定）**：要么认可"roadmap + matrix + audit/ 三件即 L0 §7 的实现"并在 L0 里写明这个映射（最省，且不新增维护面）；要么补三件、并明确 `KNOWN_ISSUES` 收敛到一处。**不要**长期停在"语义满足、文件名不满足"的中间态——那是每个新会话都要重新考古一次的代价（今天的我就是这样，`audit/` 的存在直到 R323 才发现）。

**边界**：零 src、零 push、零 build、零探针；`.gitignore`(对端) 与两份未跟踪文档（L0 本身 + `PATROL-PROMPT.md`）仍未 stage、来历不由我判定；commit 前索引为空。goal active——这条缺口是审计产物，不是完成项。

---

## 巡检 R330（10-04 19:5x–20:0xZ，t=83429964→83429971）——三条自我更正：#113 现在**有真实受害者**、#111 的分母大 3 倍、"路永不施工"在今天的段里**不成立**

同段确认：`check-code` 线上仍是 `649eb94b9784`（与 13:0xZ 那发同值）⇒ 这 7 小时没部署过，下面的读数都是**同一 boot 段的累计**（起点 83422285）。全部只读（`peek` 单叶子路径 9 次 + `observe` 2 次；其中一次 `ConnectTimeout` 我按"网络失败"处理、没当成"键不存在"）。

### 更正一：R327 说"违例这一沿按构造不可达"——**错了，撤回**；#113 现在抹掉的是真历史
`kernel.expectations.tick=83429971`、`violations` **非空**（7+ 条 `siteStaleWorkerIdle`），且叶子 `kernel.expectations.recent` **存在**，内容形如：
```
{"id":"siteStaleWorkerIdle:W36S58:6aa86a54…","seenAt":83427283,"lastAt":83429970,"count":2688}
```
⇒ 违例不仅可达，而且**已连续 2,688 次评估成立**（同一条从 t=83,427,283 起没断过）。事件环里 `ExpectationViolation` 占比约 1.2%（6/500）。
⇒ **#113 的严重度从"影响面 0、价值条件性"升为"有现役受害者"**：现在这份 2,688 计的历史在**下一次违例清空的那一拍**就会被老代码整个抹掉（else 分支不带 `recent`）。我的 `c76aad4` 保住的正是这份记录，判据也变简单了：**部署后等一次"非空→空"的沿，读 `recent` 是否仍存活**——今天这个状态下一次沿随时会来，不用制造条件。
（R327 的错因：我只核了"本 boot 段可观测跨度内环里为 0"，就把结论外推成"按构造不可达"。环只回溯约 1,000–1,600 拍，而违例是 83427283 起持续性的 ⇒ **"环内没有"≠"没发生"，这条我自己写过两次，第三次踩。**)

### 更正二：#111 的分母比我 6 小时前报的大约 3 倍，而且**施工确实在发生**
| 房 | calls | noEnergy | **noEnergyInRange** | **built** | pending | progSum |
|---|---|---|---|---|---|---|
| W36S58 | 4,911 | 2,799 (57%) | **1,077**（占 noEnergy 38%） | **311** | 18 | 760 |
| W37S57 | — | — | **2,379**（13:0xZ 时是 831） | — | 18(早前) | 505(早前) |
⇒ 三条结论要改口径：
1. **`built=311` 否证了"远矿路建成 0／永远建不成"这类旧说法在今天这一段里的适用性** —— 施工在被接受，只是**转化远低于机会**（1,077 次"脚下有格却空手" vs 311 次成功 build）。今后措辞一律用"机会/转化比"，不用"从不施工"。
2. (B) 的价格上界随之上移：两房合计 `1,077 + 2,379 = 3,456` 次机会 ⇒ ×5 点 = **约 17,280 点产能**（W36S58 缺口 `18×300−760 = 4,640`）。**但这是"全都能转化成进度"的上界**，不是承诺——每段 60 拍的聚合格才是实际数（口径见 R326）。
3. W36S58 的 `noEnergyInRange/noEnergy = 38%` 明显低于 W37S57（831/912=91%，早前）⇒ **两条走廊的病不同**（这条更像"落点/射程"混合，那条是"空腿先交能"）⇒ 一刀切的修法依旧被否证，且这正好是 `noWorkInRange`/`noEnergyInRange` 两列分开后才看得见的差别。

### 未结案、但登记下来的新形状
`siteStaleWorkerIdle` 报 W36S58 有 **4 个路 site：workers=5、noProg=7,682 拍零进度**（另 W37S57 一格 workers=4/noProg=5,059、W38S58 extension/road workers=2-3/noProg≈5,091）。同房 `built=311` ⇒ 不是"没人施工"，是**这 4 格被反复施工却没进账**——候选解释有 摊薄（同射程多格轮换）／线外不可达／能量分配 三种，**要的动作不同**，本轮证据不足不定案（且"工人在场却零进度"与对端 #127 那条是同一形状，立案前先与其对齐，别重复）。
⇒ 判别式留给下一轮：读这 4 格的 `progress` 差分 + 同房 `built` 差分；若 `built` 在涨而这 4 格不涨 ⇒ 指向"摊薄/落点"，若同房 `built` 也停 ⇒ 指向"供能/编制"。

**边界**：本轮零 src、零 push、零 build、零 npm；含 src 未推仍是 3 笔（`c76aad4`/`c2e3e30`/`994bf54`，`994bf54` 经 `merge-base` 复核确实不在 `origin/dev`）；`stats.observe` 与 `noWorkInRange` 两处"不存在"都有同形状控制组（先读通 `expectations.tick`/`roadBuild.*` 已知非空叶子）⇒ 记为未部署，不记为否证；`.gitignore`(对端) 与两份未跟踪文档未 stage、commit 前索引为空。goal active。

---

## 巡检 R331（20:0x–20:1xZ）——#119 落地：safe mode 的返回码与「该响没响」从此可归因（第 4 笔未推，纯观测）

R330 把 #113 的严重度抬上去之后（`recent` 里真有一份 `count=2688` 的历史在等下一次"非空→空"被抹掉），推送仍要授权；于是本轮做了唯一不依赖授权就有价值的实作：**#119 从规格变成代码**。

**改了什么（4 文件，零行为改动）**：`kernel/global-cache.ts` 加 `SafeModeCounters{tried, guardMiss, codes}`（就地声明，注释写明为什么不进 domain——避免再造一个没人读的领域类型，#106/#107 那一族的教训）+ `safeModeCounters()` 唯一建行处 + `GlobalCache.safeModeLedger`；`systems/military/tower-defense.ts` 的 `tryActivateSafeMode()` 记两路（发出去：`tried++`，非 OK：`codes[String(code)]`；前置不齐：`guardMiss++`），**四前置与三个触发场景一个都没动**，并按本仓既有约定 `@internal 导出仅供单元测试`；`systems/telemetry-collector.ts` flush 到 `Memory.kernel.stats.safeMode`（照 roadBuild/observe 那条现成的路）。

**取证**：新文件 7 条（跑真实 `tryActivateSafeMode`，含 `controller` 缺失不抛、按房分桶、零值形状）；**全量 unit 391 文件 / 5271 用例全绿**（基线 390/5264 ＝ 恰 +1 文件 +7 用例，无一增一减之外的漂移）；`integration 30/239` 全绿；`tsc --noEmit` 空。
**反向实验（最小干预）**：只摘掉直方图那一行 ⇒ **恰好 1 红**（`ERR_RCL_NOT_ENOUGH(-15)` 那条），其余 6 条控制组全绿 ⇒ "码没被吞"这个断言确实由那一行撑起。复原后复跑 7/7。
（本轮又踩一次自己的老坑：`it()` 标题里嵌双引号 ⇒ 语法错，当场改 `「」`；同一族今天第三次——标题里用引号一律 `「」`。）

**上线判据（写死，部署后第一读，零 console）**：和平期应见 `stats.safeMode.<房>` 三列都是初始值 —— **那不是仪器坏了**；`tried>0 且 codes 为空` ＝ 防线真响过；**`guardMiss>0 而 tried=0` 才是"该响没响"**，届时同拍的 `controller.safeModeAvailable`/`safeModeCooldown` 分辨是没次数还是在冷却。⚠️这三列都住 heap ⇒ 每次部署归零，判趋势一律差分。

**批次现状**：含 src 未推 **4** 笔（`c76aad4` #113 / `c2e3e30` noWorkInRange / `994bf54` observeCounters / 本笔 #119）。仍是 `behind=0`、origin 自 merge-base 起 `src/` 零改动 ⇒ 纯 fast-forward；一次部署=清堆+约 400 拍 G6 税，所以四笔一起走不多付代价。**e2e 仍未跑**（自带 build 会毁对端的"本地==线上"仪器；线上 sha 本轮复核仍是 `649eb94b9784`）。

**边界**：零 push、零 build、零 npm install、零探针（本轮全是本地）；commit 前索引为空（共享索引检查过）；`.gitignore`(对端) 与两份未跟踪文档未 stage；`docs/evolution/BASELINE.md` 已于本轮补上（R329 三缺件之一）。goal active。

---

## 巡检 R332（20:1xZ）——第二件 L0 §7 缺件落地：`docs/evolution/CPU_BENCHMARKS.md`，并**把 #50 的问法拆成两个目标位**

现读 `capacity.ts` 的阶梯（不是记忆）：`abundantRatio 0.35 / tightRatio 0.6 / constrainedRatio 0.8`、`limit = max(1, min(cpuLimit, tickLimit)) = 20`、`headroom = 1 − usage/limit` ⇒ 用率四段对应每拍 **≤7.00 / 7.00–12.00 / 12.00–16.00 / >16.00**。
**闭合自检**：线上 `cpuRate.total=16.25` ⇒ `16.25/20 = 0.8125 > 0.8` ⇒ **应判 constrained**，实测 `kernel.capacity.tier="constrained"`（`since=83425106`，约 4,900 拍）⇒ **算式与状态机两个独立出口互证**。

★ **这直接改掉 #50 的问法**（台账原来只给了一个目标位）：
- 只要**退出 constrained**（回 tight，恢复常规雄心）：`usage ≤ 16.00` ⇒ **砍 0.25/拍**；
- 要回 **comfortable**（扩张 G6 吃的那条线）：`usage ≤ 12.00` ⇒ **砍 4.25/拍**。
⇒ 两个动作量差 **17 倍**。早前的"缺 2.44~2.48/拍"用的是当时 `total≈14.5`——**方法一样、输入变了** ⇒ 引用旧缺口前必须重采。

**同时写进文档的三条读数纪律**：①`byPhase` 之和加三个残差 **不等于** `total`（15.23+2.98=18.21 vs 16.25）⇒ **这不是漏账**，是不同分母/归属规则的切法（"其余 4.4/t 未归因"那类减法产物的同族）；②`cpuRate.bySystem` 与 `stats.cpuBySystem` 是**两台仪器**（`traffic-manager` 3.48 vs 3.71）⇒ 不相加不互校；③夹具标定只能给"单价"不能给排序（第四次定标：变量项对到 4% 内，但夹具截距 2.94 vs 实测固定项 ≈6.7/t ⇒ **低估 2.3 倍**），排序只能在真负载上做差分。
另记 `snapshots`+`traffic-manager ≈ 5.24/拍` 是已核过的**结构性成本**（五条"能省"嫌疑全被否），低于总负载 5% 的可省项不立案。

**边界**：零 src、零 push、零 build、零 npm；探针 0 次（只读 API：`peek` 叶子 7 次 + `check-code`）；`docs/evolution/` 下两件（`BASELINE.md`、`CPU_BENCHMARKS.md`）为**本轮新建**，L0 §7 七件产物从"2 件有真身"变"4 件"（剩 `EXPERIMENT_LOG` 缺、`KNOWN_ISSUES` 半满足散在三处、`ITERATION_LOG` 由 roadmap 兼任）；commit 前索引为空；`.gitignore`(对端) 与两份未跟踪文档未 stage。goal active。

---

## 巡检 R333（20:1xZ）——第三件 L0 §7 缺件落地：`docs/evolution/EXPERIMENT_LOG.md`（12 条「预期→实测→裁决」，其中 4 条是被我自己否证的）

**为什么补这件**：判效窗内的结论此前只活在 commit 信息里，不可检索；而"先写死预期再读数"正是本会话唯一命中过的那条方法（记忆里的"最强证据=先把期望值写进文件再读"）。规则写死四条：①预期必须在读数之前且必须可证伪；②实测必须带出处（tick/mark/叶子路径/提交号）；③裁决只有 `命中/否证/未定/未开始` 四种，**`未开始` 不许读成 FAIL、`未定` 不许读成命中**；④**被推翻的自己照原样保留**。
**收了什么**：E-01 两半分母与子集不变式（命中）、E-02 那句"noWork 已被证伪"的免检注释（否证我自己）、E-03 施工资格随能量档位漂移（命中）、E-04 机会全在空载腿（方向命中、一刀切否证）、**E-05 "0-WORK 房是 WORK 下限主要受众"（否证我自己，判据=排产侧 `pending`）**、E-06 (B) 折算成段数（命中+旧措辞"永远建不成"被 `built=311` 否证）、E-07 道路自然衰减两口径互证（命中）、E-08 Observer 楼在场（命中，并撤"不持久化=缺口"）、**E-09 #100 三读数（`未开始`）**、**E-10 #113（R327 的"按构造不可达"被否证、主判据仍 `未开始`、严重度改判为有现役受害者）**、E-11 CPU 算式与状态机闭合（命中，并作废旧缺口数字）、E-12 释放后资产残留（命中，立 #118）。
**末尾单列 4 条"挂着的 `未开始`"**（#100/#113/#111 完整价格/#119），每条都写清触发条件——**不为取证制造条件**（不动阈值、不发动战争、不销毁资产）。
**L0 §7 七件产物的现状**：`ROADMAP`✅ `CAPABILITY_MATRIX`✅ `BASELINE`✅(R331) `CPU_BENCHMARKS`✅(R332) `EXPERIMENT_LOG`✅(本件) ⇒ **5/7 有真身**；剩 `KNOWN_ISSUES`（内容散在 `audit/`+roadmap #1xx+矩阵，无单一入口，半满足）与 `ITERATION_LOG`（由 roadmap 的 R### 序列兼任，已知一根时钟两用）。
**边界**：零 src、零 push、零 build、零 npm、零探针（本件全部来自本会话已有出处）；commit 前索引为空；`.gitignore`(对端) 与两份未跟踪文档未 stage；含 src 未推仍 4 笔。goal active。

---

## 巡检 R334（20:1xZ）——§7 的另两件**刻意不补件**，改为一张坐标表（`docs/evolution/README.md`）

R329 我给 §7 缺件开的两条路是"补件"或"写明映射"。对 `KNOWN_ISSUES` 与 `ITERATION_LOG` 选了后者，理由是**防漂移**：同一内容长两处必然过期（本仓已出现过同一缺口在 `audit/` 与 roadmap 各一份的情况），而这两个概念各自已有真身——`KNOWN_ISSUES` ＝ roadmap 的 #1xx 台账 + `audit/`（`FINDINGS.md` 唯一入口、`VERIFIED.md` 的 K 编号、`units/W**.md` 六步判定）；`ITERATION_LOG` ＝ 本文件的「巡检 R###」序列（**已知代价是一根时钟两用，我没掩饰，只把它写进表里**）。
表里另加了三条"该往哪儿写"的判据与两条纪律：**只有文件搬家才动这张表**；**在 ⚠️ 两项被补件或在 L0 里写明映射之前，任何文件都不许声称 §7 已完成**（后者属人——我不单方改 L0，且该文件来历未定、一直未 stage）。
**§7 现状**：5 件真身（ROADMAP/CAPABILITY_MATRIX/BASELINE/CPU_BENCHMARKS/EXPERIMENT_LOG）+ 2 件明确由既有文件兼任并登记了代价。
**边界**：零 src、零 push、零 build、零探针；含 src 未推仍 4 笔；commit 前索引为空；`.gitignore`(对端) 与两份未跟踪文档未 stage。goal active。

---

## 巡检 R335（20:2x–20:3xZ）——想验 #42/#48 的成对入账，结果**先撞到一个未定案的仪器异常**；本轮只立案不定罪

**动机**：#48 的判据是"两侧在同一拍成对入账"，而其前提（幼房有 storage）今天已满足（W38S56 RCL5、`storage_se=123,548`）⇒ 这本该是一次零授权的线上验证。

**先拿到的事实（可作为 #48 的部分判据）**：`kernel.stats.energyLedger`（boot 起累计，`tick=83422285`）
```
W38S56  imported 81,585   exported 0        W37S58  imported 136,885  exported 26,400  sold 26,000  tradeFee 17,653
W38S58  imported 0（该房无 storage ⇒ carrier 分支按构造不记，结构控制组）
```
⇒ **两侧都有写者、且开过火**（收端 81,585 > 0），但**这还不足以判 #48 PASS**：判据要的是"一次交付事件上两键同拍同额"，累计值只能证明"都存在过非零"。⚠️另外 `exported 26,400 ≈ sold 26,000` ⇒ 发端这块**主要是 terminal 交易**（`terminal-selfaid.ts:68/133` 也写 `exported`），**别把 26,400 读成 carrier 线路的量** —— 一条 `exported` 混两个通道，这与 #76「`tradeFee` 有 11 个写者所以别当比率读」同族。

**撞到的异常（本轮唯一新发现，未定罪）**：两次读数相隔 **154 秒 ≈ 40–67 拍**，`W38S56` 整行、`W38S58.imported`、`W37S58.exported` **逐字节相同**（含 `harvested 147,560`）。
- 我先怀疑"是自己的采样跨度短于 flush 节拍"——**这条被代码否掉**：`telemetry-collector` 的 `interval = CONFIG.telemetry.cpuSampleInterval = 10`（`config:96`），40–67 拍理论上应跨 4–6 次 flush。
- 也不该用 `tick` 判新鲜度：`global.d.ts:490` 明确 `energyLedger.tick` 是**"创建时赋一次"**（与 `warFunnel.tick` 那种"被计量的那一拍"不同类），`logisticsHealth` 才写 `Game.time` ⇒ **`tick` 不动是正常的，别拿它当"停止刷新"的证据**（我一开始就差点这么读）。
⇒ 两个都还活着的假设，动作完全相反：
 **H1 写入侧停了**：`globalCache().energyLedger` 的 mutator 不再被调（同 #104/#106 那一族：有建行处、没有稳定写者）。
 **H2 落盘侧被闸住**：heap 在涨，但 `Memory.kernel.stats.*` 这段 flush 实际比 10 拍稀疏（我没读完 `run()` 顶部的提前返回/`safeRun` 边界，不能排除）。
**判别式（一次即分，零改动）**：连读 **heap** 两次（`peek` 读不到 heap，走一次 console：`JSON.stringify(globalThis.energyLedger?.rooms?.W38S56)` 隔 ≥200 拍两发，mark 各自唯一）⇒ **heap 在涨而 Memory 不涨 = H2**；**heap 也不涨 = H1**。别先动代码。
**为什么现在不动它**：这条真起来会影响**两件正在被引用的东西**——(a) 对端 #127 用过"`upgraded=2,500` 与更早一次逐字相同"作零升级的证据（那是 595 拍跨度，若 H1 成立则该证据的形状要重看）；(b) 我的 `#114` 用的是核算窗 `ws/bk`，**不是这台 ledger** ⇒ 本轮结论不波及 #114。定罪之前这两处都别改口径，也别据此说谁的证据作废。

**边界**：零 src、零 push、零 build、零 npm；探针 0 次（全是 `peek` 单叶子 + 读码）；#48 状态由"待事件"改为**"部分到手、判据未满足"**（见任务条目）；`.gitignore`(对端) 与两份未跟踪文档未 stage、commit 前索引为空；含 src 未推 4 笔。goal active。

---

## 巡检 R337（20:3xZ）——#129 当场结案为**非缺陷**，并留下一条比"等 200 拍"便宜得多的判别式

R335 立的 `#129` 挂着 H1（写入侧停）／H2（落盘侧被闸住）。原计划的判别式要隔 ≥200 拍两发 heap 读，**实际一发就够了**——因为 heap 与 Memory 在**同一瞬间**就可以不同：

```
mark R336H1  t=83430467
heap : energyLedger.rooms.W38S56 = { harvested 150,680 , imported 81,585 }   （tick 83422285 = 建行拍）
mem  : stats.energyLedger.rooms.W38S56 = { harvested 149,460 , imported 81,585 }
```
⇒ **heap 比 Memory 多 1,220 点采集量** ⇒ **writer 在跑**（H1 死），差异只可能来自"落盘比写入粗"（H2 的温和版本）。
⇒ R335 那次"154 秒 ≈ 40–67 拍逐字节相同"**是采样跨度短于落盘节拍**，不是仪器坏。我上一轮用 `collector interval = 10` 把"节拍粗"这个解释否掉了——**那个否证本身是错的**：系统 `interval=10` 只说明 `run()` 被调用，**不等于这一段 Memory 写入每 10 拍都真正落到 Memory**（我没读完 `run()` 顶部就断言，正是不该断言的地方）。

**留下的判别式（比等 200 拍便宜，且方向性要说清）**：
- **同一瞬间 heap ≠ Memory ⇒ writer 活着、落盘有滞后**（单向可用，本次就是这么结的）。
- **同一瞬间 heap = Memory ⇒ 不可判**（可能都新鲜，也可能都停了）⇒ 那种情形才需要跨 ≥200 拍两读。
- 读 heap 用 `globalThis.energyLedger`（console 里 `globalCache()` 是 undefined，但对象本身可直读）；一发探针同时取 `t`、heap、mem 三列，自带唯一 mark。

**顺带把 #48 的可达性说准**：`imported` 两侧同值（81,585）⇒ 自上次 flush 起没有新的跨房交付 ⇒ 想抓"同拍同额"的那一次成对增量，**得按落盘节拍以外的口径**——直接在 heap 上对比 `W38S56.imported` 与 `W37S58.exported` 两读之间的增量（≥300 拍跨度），或承认"**同拍由代码结构保证**"（`carrier.ts:57-61` 在同一个 `if (result === OK)` 块里成对记账）+ 两侧累计皆非零，即为本条可达的最强证据。⚠️`exported` 仍混 terminal 交易（`≈ sold`），差分法必须**只看 W37S58.exported 的增量是否等于某次 W38S56.imported 增量**，别用累计比率。

**边界**：本轮探针 1 发（只读、带 mark、无副作用）、零 src、零 push、零 build、零 npm；`#129` 关闭、`#48` 措辞收紧（见任务行）；`.gitignore`(对端) 与两份未跟踪文档未 stage、commit 前索引为空；含 src 未推 4 笔。goal active。

---

## 巡检 R340（20:5xZ）——上线前自我审查：把 `origin/dev..HEAD` 的 `src/` 全量 diff 逐块读完，**抓到 1 处我自己写下的过度声明**

`git diff --stat` = 8 文件 **+194/−11**。逐块核对的结论（"纯仪表"这句到底成不成立）：
- **`room-observer.ts` 的守卫换序**：旧 `if (snapshot.observer && tick%25===0)` → 新 `if (tick%25===0){ gate++; if(observer) request(...) else noObserver++ }`。⇒ **`requestObservation` 的调用条件逐字不变**，新增只有一次取模与一次 heap 取行。唯一意图内行为改动是 `kernel.ts` 那一行 `recent`（#113）。
- `captureObservedIntel` 的 `slot.pending = undefined` 在两条路径前都已置，语义未变；`tower-defense` 只是把返回码接进变量并计数、`tryActivateSafeMode` 加 `export`（既有约定：仅供单测）。
- **★抓到的问题在注释不在代码**：我在 `remote-hauler.ts` 两处写了"不发 find / 只补一次数组遍历"，但 `findMySitesCached`（`room-scans.ts:146-152`）在**按房按 tick 缓存未命中时真的会 `room.find(FIND_MY_CONSTRUCTION_SITES)`**。⇒ 两处注释已改成实话：**代价上界 = 每房每拍最多多 1 次 find（缓存按房共享，不随该房 creep 数放大）**，不是"零 find"。
  为什么值得较真：这正是我自己定过的规矩——**"账本不能改变 CPU 曲线"，写"代价/浪费/止血"之前必须先量**；注释过度声明会让下一轮把"确实多了一次 find"当成仪器坏了，或者反过来拿"零成本"去说服自己加更多列。
  ⇒ 顺带记一条**部署后的自证项**：若 `cpuRate.byRole` 里 remoteHauler 相对 boot 前明显上升，**第一个嫌疑就是这两处新扫描**（不是"仪表免费"）。
**边界**：本轮只改注释（`src` 2 行注释文本），零逻辑改动、零 push、零 build；测试与类型由钩子（prettier/eslint/tsc）在提交时代跑；含 src 未推仍 4 笔（本笔只是注释，随批走，不单独换码）。goal active。

---

## 巡检 R343（21:0xZ）——**#42/#48 判效到手**：一次真实跨房交付被挂好的仪器抓到，两侧等量、通道已被排除法唯一化

判效器（R338 挂上，`paired-imported-watch.log`）第 9 个样本给出第一次 `^★CHANGE`（行首锚定读法——R341 那条更正正是为了这一刻）：
```
20:49–20:55Z  W38S56.imported=81,585   W37S58.exported=26,400   W38S58.imported=0
★CHANGE 20:58:50Z  W38S56.imported=82,785  W37S58.exported=27,600  W38S58.imported=0
                （+1,200）              （+1,200）                （0）
```
**为什么这次能定罪为"carrier 通道"而不是"两侧记账恰好都涨"**（三重排除，全部现读）：
1. **收端没有终端**：`terms=[W37S58:term1:stg1, W38S56:term0:stg1, W38S58:term0:stg1]`（mark `R343T1`@t=83430906）⇒ `terminal-selfaid` 那条同样"两侧成对记账"的路**按构造进不了 W38S56**（它需要两端 terminal）。
2. **量级是一只满载背包**：+1,200 恰好等于一只 carrier 的载重（本服 `CARRY=50/部件`，24 件），不是市场批量。
3. **落点与代码一致**：`carrier.ts:57-61` 只在 `result===OK` 那一拍写 `imported@所在房` + `exported@memory.home` ⇒ home=W37S58、所在房=W38S56，与读到的两房完全对应；而 `W38S58.imported` 全程为 0（该房 `storage` 在场但 carrier 线未指向它）——**这条"该动的动了、不该动的没动"就是控制组**。

**判据满足到什么程度，就写到什么程度（不多写）**：
- ✅ **"一次真实跨房交付上，收端 `imported` 与发端 `exported` 同窗等量记账"**——已由现场观测证明，且通道经排除法唯一化。⇒ **#42 下半场 / #48 判效 PASS**。
- ⚠️ **"同一拍"** 仍不是我观测到的，是**代码结构保证**的（同一个 `if` 块内两次 `bumpEnergyCounter`）。我这台仪器只能给"同一 flush 窗内等量"（R337 查明 Memory 落盘比写入粗 ⇒ 窗内等量是它的分辨上限，别把这个说成拍级）。
- ⚠️ 同窗另有 `tradeFeeEnergySell 19,223 → 19,789`（市场卖单在跑，与 #76 的分桶仪器一致）——**它不是这笔交付的运费**（W38S56 无终端），列在这里只为免下轮把它误算进来。

**顺带**：`#129` 的"落盘比写入粗"结论在这里反过来帮了忙——正因为我知道 Memory 是粗窗，才会去补终端排除这一步，而不是拿"两侧同涨"直接定罪。
**边界**：本轮零 src、零 push、零 build；探针 2 发（`R343T1` 只读、带 mark）；判效器继续跑到 40 次收工。含 src 未推 5 笔（逻辑）+2 笔注释/文档，`behind=0`。goal active。

## 巡检 R344（10-05 05:12Z / 21:12Z）——本轮没动 src，动的是"下一轮能不能读懂现状"那条通道；顺手把待推批次核到可一键执行

**一、发现并修掉的问题：项目记忆索引自己超限了，而且超限的方式正好会误导人。**
`projects/.../memory/MEMORY.md` 实测 **78,172 字节**，而该系统只加载 25,000 字节以内 ⇒ 过去若干轮每一轮开头看到的都是**被截断的任意一片**，
不是"索引"而是"随机目录"。更要命的是内容形态：条目把"当前判定"和"这条判定被推翻的过程"塞进同一行，
所以任何被截到前半段的会话都会读到**已被自己否证过的旧结论**（这不是假想：本轮就看到 "§十八 已作废" 那种整行警告散落在条目之间）。
处置：逐字全文存档 `memory-index-archive-2026-10-05.md`（78,599 字节，含全部历史长句），索引重写为 49 条一行钩子 + 一句"当前状态一律去主题文件读"。
现读 **9,836 字节、49 条、零丢失**（条目数与标题集两边各数过一遍）。

**二、本轮自抓的一个错（写下来，因为它很容易再犯）**：第一版瘦身脚本跑完打印
`entries=49 bytes=7809` ——两个统计都对，**内容却是废的**：分段循环的首个片段判断写反，40 条钩子退化成 "…（含更正链）"，
等于把一份"过长但可读"的索引换成一份"合规但无信息"的索引。是**看产物**才发现的，不是看打印。
⇒ 规矩：任何"改写我自己生产资料"的脚本，验收口径必须包含一次人眼读产物；统计数只用来证明没丢条目。

**三、为什么这件事算 L2 的一轮而不算家务**：本项目的推进方式是把判定链写进文件、下一轮从文件恢复。
索引坏掉时，坏的不是排版，是**恢复质量**——过去几轮里"同一现象第二次立案""编号撞车"这类开销，成因之一就是恢复时看到的是截断片。
本轮把这条通道修回可用，直接服务"持续优化"，且不越权（不碰产线、不动阈值）。

**四、待推批次现状（核到能一键执行）**：含 src/tests 的未推提交 **6 笔**——
`c76aad4`(#113 expectations.recent 不再被干净一拍抹掉) / `c2e3e30`(#111 noWorkInRange) / `994bf54`(#100 observeCounters) /
`1ac133d`(#119 safeMode 出口账本) / `1f9cd03`(§3.4 strayAssets 普查) / `7553710`(注释级：更正两处过度声明)。
文件面：`src/` 8 个 + `tests/` 4 个，**+562 / −13**。`git fetch` 后 **ahead=132 behind=0** ⇒ 无人推码 ⇒ 单二进制 A/B 仪器仍然有效
（本轮也因此**没跑 build**：e2e 的 script 自带 build，跑了就毁掉"本地 dist==线上"）。
门禁（同一条命令串，`tmp/observe/r344-gate.log`，EXIT=0）：`typecheck` **通过**、`test:unit` **392 文件 / 5,277 用例全绿**、
`test:integration` **30 文件 / 239 用例全绿**（pre-push 钩子只跑前两项，"门禁全绿"历来要自己补 integration）。
**e2e 未覆盖——是没跑，不是失败**（`test:e2e` 的 script 自带 build，窗内跑了就毁掉"本地 dist==线上"那台免费仪器）。

**五、五件先写死的线上签名仍在表上，位置已核**：`EVOLUTION-ROADMAP.md:6845/6846`（observe 的 noObserver 两列：核心房应=0、幼房按构造>0）、
`:6970`（三读数：expectations.recent 挂违例转空沿 / noWorkInRange / stats.observe 且预报 `noTarget/gate≈1`、闭合式 `ok===captured+lostVision+staleSlot`）、
`:7126`（safeMode 和平期三列形态）、`:7106`（noEnergyInRange 两走廊 38% vs 91% 的对照）。
判读口径不变：**触发事件没发生就记"验证未开始"**，不许把"读不到"写成"坏了"，也不许为拿读数去制造条件。

**六、边界**：本轮零 src 改动、零 push、零 build、零 npm install、零阈值改动、零线上写动作；只动 L1 文档与自己的记忆文件；
`.gitignore` 仍未 stage（并行会话的未提交物）；`git stash list` 未新增。
**唯一恢复动作仍然是一个字：「推」**——它触发的是既定的四步（push→CI 绿+check-code 认 sha→上表五件签名第一读→按命中/否证/未开始三态回报）。
其余全部属人：#50（两条目标位 −0.25/拍出 constrained、−4.25/拍到 comfortable）、#111 (B)、#118+#78+#13、#106/#107/#104/#110（"这层要不要存在"）、#130、#88/#114、#97（八项记录 R344 时 2 项／R345 已 4 项／**R348 已 5 项**：§20 Observer、§21 Safe Mode、§22 Power-PC、§23 衰减与遗留物、§24 供给合同链）。

## 巡检 R345 补（10-05 05:2xZ）新立 **#131**：寿命量在决策面缺席——`ticksToDecay` 四个来源、`src/` 零属性读；`Deposit` 整条未用。**立案时点是编号唯一性现取（最高已用 #130），且本轮先要读数、不要修法**

**这条从哪来**：矩阵 §23（§3.1/§3.2 交点「衰减与遗留物回收」八项记录，`51571dc3`/`a93fe3a3`）的两条负向结论。
现读证据两条都在：①`grep -n "ticksToDecay" src/` 只回到 `core-clearer.ts:31` 的一句**注释**（属性读 0 次），而 `@types` 把寿命交到了四个对象手上（`Resource`/`Ruin`/`Tombstone`/`Deposit`，另加 `StructurePortal.ticksToDecay: number | undefined`——稳定门是 `undefined`，"别把 undefined 读成 0"的既有坑位就在同一族）；
②`grep -rn "FIND_DEPOSITS\|Deposit" src/` 命中 0（名字取自 `@types:1670-1682`）。

**必须先声明的一条口径修正（否则 #107 会被读成矛盾）**：**#107 用过 `ticksToDecay`，而且用得对**——它是 **console 探针**（`mark=R107A1`，现读 14 段的 `(hits, ticksToDecay)` 分布、中位 555 拍）拿到的，不是代码里的属性读。
⇒ 本条**不是**"我们不会用这个量"，而是"这个量在**离线分析**里救过一次案，在**在线决策**里一次都没参与"。两者别混，混了就会有人去拆 #107 的结论。

**为什么现在只是立案、不是修法**：影响面**没有读数**。今天无法回答"该不该按寿命排序"，因为两个必要计数都不存在：
- **C1 零头回收计数**：`lootRemains(minAmount)` 的"链尾无阈值实例顺手清理零头"这一支有没有真跑过（`pickup.ts:49` 注释是设计意图，不是执行证据）。⇒ 引擎定律 `ceil(amount/1000)/拍`（`@types:4501-4502`）是**相对速率与小堆成正比**的，"最多者优先"恰好把相对最紧急的排在后面；缓解是否存在，取决于 C1。
- **C2 快照过滤掉的盲点**：`room-snapshot.ts:96-97` 先按 `store>0` 过滤 ⇒ "被选中后被他人取空/衰减殆尽"这类竞态在本仓**看不见**（零容量目标根本不入决策面）。⇒ 记 `UNOBSERVABLE`，不是"没发生"。
两个计数都属**只加读数、零行为改动**那一档，形状照本轮批次里已上线的四件（`observeCounters`/`noWorkInRange`/`safeModeCounters`/`strayAssets`）：heap 账本 + 单一零行构造 + 自洽闭合式（C1 建议 `looted = lootedEnergy + lootedMineral`，且 `looted ≤ lootCalls`）。

**归属**：C1/C2 的**读数**我可以自办（属观测，不动产线判定）；**"要不要为此花 CPU 做寿命感知排序"属人**，且必须先有 C1。
本轮不起手改排序，也不起手加计数器——预算只够把这条立案到"只差一次形参读取"的程度，规格已经在这里。

## 巡检 R346（10-05 05:2xZ）——**预部署对照读数已取**，五件签名因此从"待读"升级成"挂在状态沿上"
动机是自家用过的规矩：**判据要挂状态沿而不是状态值**，而"新键在不在"恰好是"这批代码真上线了"的直接签名（比 sha 更直接证明生效而非只换了字节）。
工具本轮**端到端跑通一次**（此前它只出现在判据文本里）：`node tmp/tools/official/peek.mjs <leaf>`，Node 24，只读。

现读 `t=83,431,205`（`kernel.stats.lastSample`）：
| 签名 | 预部署真相（叶子路径逐个取，**不靠 700 字符截断的整对象**） | 上线后判据形状 |
|---|---|---|
| #111 `noWorkInRange` | `stats.roadBuild.W39S56` **整行在**（14 键：calls,noEnergy,noEnergyInRange,noWork,noSiteAtAll,outOfRange×4,built,buildRejected,roadProgressSum,roadSitesPending,roadsBuilt），**但 `noWorkInRange` 叶子="不存在"** | 键**出现**（absent→present）＝`c2e3e30` 上线；随后才谈 >0 |
| #100 `stats.observe` | 不存在 | absent→present，且预报 `noTarget/gate≈1`、闭合式 `ok===captured+lostVision+staleSlot` |
| #119 `stats.safeMode` | 不存在 | absent→present；只有 `guardMiss>0 && tried===0` 才说明末线没炸 |
| §3.4 `stats.strayAssets` | 不存在 | absent→present（同时是 #118 的免费复证） |
| #113 `kernel.expectations.recent` | **在且非空**：`[{"id":"siteStaleWorkerIdle:W36S58:6aa86a54…","seenAt":834272xx}…]` | 判据是**沿**："违例转空的那一拍之后 recent 仍存活"；非空基线今天已到手 |

**同一次取数顺手到的旁证**（都不是本轮的判据，记下来免得下轮重新问）：`crisisCount=1762`、`tierTransitions=0`、`skipHotspot="creep/upgrader/colony-state"`（＝#127 那把冻结仍是当前热点）、
`cpuAvg10=16.3 / cpuMax10=20.8 / bucketMin10=10000`、`cpuByHome {W38S58 0.769, W37S58 1.754, W38S56 2.731}`、`memorySize=47709`；
`energyLedger.tick=83,422,285` 比 lastSample 旧 ~8,900 拍 ⇒ 与既有口径一致（**那是创建戳不是新鲜度**，别读成"写入停了"，#129 的 H1/H2 仍未分）。

**这次自办为什么算推进而不算家务**：如果五件里任何一件的读法本身是坏的（路径写错、工具没跑通），部署后那一轮会把"仪器坏了"误读成"改动没生效"，
而这两种情形的处置方向相反（前者要修仪器、后者要查上线）。对照已经取完 ⇒ 推之后**只需看键的出现与沿**，不需要临场猜。
边界：零 src、零 push、零 build、零 npm install、零线上写动作（本轮全是只读 API）；`.gitignore` 与对方 R168 那行仍未 stage。

## 巡检 R347（10-06 07:4xZ）——**#131 的两个读数已实现并带反向实验**（`07b38f92`，含 src 未推升到 7 笔）；顺带撤我自己一条被 #139 否证的旧说法

**一、这一轮做了什么**：上一轮把 #131 立案到"只差一次形参读取"，本轮就把它读完了。
零行为改动，两件仪器：
- `stats.remainsLoot.<房>.buckets.<minAmount>` ＝ `seen/belowThreshold/eligible/resolved/executed/skippedMineralNoBank/skippedNoResource`。
  分桶是因为要问的句子问不出来：`pickup.ts` 那句「零头由链尾无阈值实例顺手清理」是**设计意图不是执行证据**，
  而引擎 `ceil(amount/1000)/拍` 让小堆**相对**衰减最快、排序键却是"最多者优先"——两档混一列时，
  「阈值档什么都没筛掉」与「兜底档从没跑过」形状相同。闭合式三条（`seen === belowThreshold + eligible`、`resolved ≤ eligible`、
  `executed + 两支放弃 === resolved`）让读侧能自证仪器没坏。成功侧**不另造仪器**（`pickedUp` 已在账本里），免得又欠一次对账。
- `stats.remainsBlind.<房>` ＝ `snapshotTicks`(分母) + `inSnapshot` + `blindFiltered`。
  `room-snapshot` 的 `store>0` 前置过滤 ⇒ 零容量遗留整个不进决策面，"选中后又空了/衰减殆尽"结构性看不见；
  本轮**不改过滤口径**（那是另一笔权衡），只把被挡掉的量与分母记下来。

**二、验收（含反向实验）**：新单测 8 例；把两处 `belowThreshold++` 摘掉 ⇒ **恰好 2 例转红**（正是钉这一列的那两例），其余 6 例与控制组全绿，文件 `cmp` 逐字节还原；
全量 unit **393 文件 / 5,285 用例**、integration **30 / 239**、typecheck 退 0（prettier/eslint 在钩子里重排过一遍，重排后 8 例仍绿）。
e2e **没跑＝不是失败**（`test:e2e` 自带 build，窗内跑就毁掉"本地 dist==线上"）。

**三、撤我自己一条说法（#110 的第三支）**：我在 #110 里写的是「`Memory.kernel.escalations` **零读者**」。
本轮读到对方的 **#139**：`RecoveryEscalation` 报表**第三列读的就是 `escalations[0].repeats`**——那是一个真读者，
而且它的错正是"取了 `[0]`"（global 事件打 17、它自己那行 27，两列对不上）。
⇒ **撤的是"零读者"这一支，不撤 #110 的其余两支**（不可行阈值按构造不可达、判定只落日志）。
改判后的说法：台账**有一个读者，且读错了条目**——这条比"零读者"更值得修，因为读错的数会被人当证据引用。
处置仍属人（与 #104/#106/#107 同一簇）。

**四、上线后可判读的签名（零改动，已按"缺键＝未部署"的口径预写）**：
`stats.remainsLoot` 与 `stats.remainsBlind` **出现**＝`07b38f92` 真上线；
出现之后才谈读数——**正面读数形状**：阈值档 `belowThreshold>0 而 resolved=0`（＝零头不是它清的），
同时兜底档（键 `"0"`）`resolved>0`（＝链尾确实在干活）。若两档 `resolved` 全 0 而 `seen>0`，
那才是"注释骗人"——缓解不存在，排序问题升级为真问题。
`remainsBlind.blindFiltered / snapshotTicks` 给出盲点率，>0 就说明"选中后落空"这一类确有体量、值得单独归因。

**五、边界**：本轮零决策改动、零阈值改动、零 push、零 build、零 npm install、零线上写动作；`.gitignore` 未 stage。
`ahead/behind` 与 7 笔待推的清单见交接文件。**唯一恢复动作仍是一个字：「推」**。

## 巡检 R348（10-06 07:4xZ）——矩阵 **§24** 做成（#97 的八项记录升到 **5/8**）；#106 由此拿到"证据版"，未另立新案
记录对象＝跨房供给合同链（L0 §3.3）。三条现读结论：
1. **三处零生产导入者**：`contract-node-bridge` / `contract-lifecycle` / `route-efficiency` 在 `src/` 内**没有任何导入者**；`recordDelivery` 只有 3 个测试调用点、`src/` 内 0 个。
   而这两处的**设计承诺都写在文件头**（"每周期通过 contract-node-bridge 注入 SupplyNode"、"每周期由系统侧薄壳调用 recordDelivery"）⇒ 不是遗漏了一次调用，是承诺的调用方从未存在。
2. **线上台账自证**（`t≈83,455,155`，控制组＝同工具同形状先读到 `rooms.W37S58.phase=steady/reserve=854,002`）：两条合同 `st=A` 而 `td=0`、`ca===ua===ac`，
   分别冻结 **138,839 拍（≈150h）**与 **44,939 拍（≈49h）**。第二条的年龄说明**创建侧今天还在干活**，死的只是记账。
   口径守住：`td=0` 本身兼容"从没交付"与"交付了没人记"两种世界；判成后者靠**两条独立证据**（#42/#48 的现场 `+1,200/+1,200` 同窗等量 + 零写者），单看 `td=0` 会定反。
3. **登记一名两义**：`recordDelivery` 在 `domain/economy/supply-contract.ts:291` 与 `domain/operation/remote-mining-op.ts:342` **各定义一次**，签名与口径不同 ⇒ 以后 grep 这个词必须分两处读。

**不另立新案**：以上正是 **#106** 的同一现象（我先搜了"第二种说法"再决定），本轮只把它的证据补齐——
所以 #106 的处置从"缺接线缺陷"正式改写为**"这层要不要存在"**：补写回＝台账第一次产生数、状态机（`degraded/终态`）才有意义；
不补＝它与三个兄弟模块构成"只有单测在跑的平行宇宙"（同 **#107** 的 domain 33/225 零导入者一族）。两个方向都改变代码规模，**属人**。
**#97 计数**：5/8（§20/§21/§22/§23/§24），§23 里那句"4 项"自 §24 起作废。
边界：本轮零 src、零 push、零 build、零 npm install、零阈值改动、零线上写动作（取数全走只读 API）；`.gitignore` 与对方未提交物不 stage；`git stash` 里那条 lint-staged 自动备份不属于我，未动。

## 巡检 R349（10-06 07:5xZ）——矩阵 **§25** 做成（#97 → **6/8**）：扩张层三枚引擎 API 全在产线，但 `domain/expansion` 32 个模块里 **8 个层外零导入者**（含一簇 4 个互为孤儿）
**引擎面（名字取自 @types 现读）**：`claimController` 返回码含专用 `ERR_GCL_NOT_ENOUGH`（`:1269`）、`reserveController` 只有 `ERR_ACCESS_DENIED`（`:1531`）、`unclaim()` 只有通用 `ScreepsReturnCode`（`:6032`）⇒ **释放的归因面天生比 claim 窄**，这与当年释放链踩过的坑同向。`CONTROLLER_CLAIM_DOWNGRADE`/`CONTROLLER_RESERVE(_MAX)`/`GCL_POW`/`GCL_MULTIPLY` 全被声明成裸 `number` ⇒ **本服未标定**，一律不许引用成已知数（§20 的错案就是这么来的）。`attackController`（`:1223`）无调用点＝能力未用，不是缺陷。

**这层的实质发现（口径先说清，因为它差点是假阳性）**：`domain/expansion` 共 **32** 个模块，**8 个在层外零导入者**。
第一遍我按 `expansion/<名>` 搜 ⇒ 同目录的 `from "./autonomy"` 一类引用被漏掉、把活的报成死的；改成"层外引用者"口径后才成立。**层内互引不算接进产线**——这是本节的关键判据。
· **一簇 4 个整体死着**：`colony-dashboard`（层外 0 引用）是 `autonomy`、`colony-failure`、`stability-score` 的唯一引用者 ⇒ 四者互为孤儿。
· **4 个彻底零引用**：`evaluator`、`execution-dashboard`、`execution-operation`、`roi-tracker`。
· ⚠️ 命名陷阱登记：注释里的"扩张评估器"活在 `discovery`/`candidate` 一侧，**不是** `evaluator.ts`；照注释去改就是改一个死文件。

**现场（含控制组）**：`kernel.capacity={"tier":"constrained","since":83,425,106}`、`kernel.situation.tick=83,455,501`（`adversaries={}`，与 #108 一致）⇒ **扩张今天被 CPU 档按住 30,395 拍 ≈ 33 小时**（按实测拍长 3.92 s/拍），不是被候选池按住。`kernel.expansion` 不存在——**但本轮不据此下结论**：历史上扩张端到端跑通过两次（键应是阶段性的），"谁在什么条件下创建它"我没读完 ⇒ 记 **待查**（§20 换来的规矩：读不到痕迹 ≠ 不存在）。

**属人意义**：#107 现在有精确抓手（该层 32/8 分母 + 上面 8 个名字）。"先解 CPU 还是先修可见性"是取舍不是 bug；删除或接线都不该我代做。
**#97 计数**：6/8（§20–§25），§24 的"5 项"自本节起作废。边界：零 src、零 push、零 build、零 npm install、零线上写动作；`.gitignore` 与对方未提交物不 stage；`git stash` 里那条 lint-staged 自动备份不属于我。

## 巡检 R350（10-06 08:0xZ）——CPU 切面重采（第二次，同窗标定拍长）；**差点把一个低频系统错定成大户**，以及 #50 现在有算法不是有口号
现场（`sha=649eb94b9784` 前后两次同值 ⇒ 窗内无人换码）：`cpuRate.total=16.14`（10-04 是 16.25）、byPhase `creeps 7.18 / post 3.34 / systems 2.92 / snapshots 1.56`、Σ=15.11、残差 1.03 ⇒ **结构与 26 小时前同形，不是新退化**。
补齐了 CPU_BENCHMARKS §5 欠的两项：**同窗拍长 4.2 s/拍**（跨 26h 均值 3.83，换算一律写 3.8–4.2 区间）、**每房 CPU 现值**（W37S58 1.201 / W38S56 0.921 / W36S58 0.418 / W37S57 0.277 / W38S58 0.214，文档已注明它是**下界**）。
**相位归属核到底**：`traffic-manager.ts:40` 是全仓**唯一** `phase:"post"` 的系统 ⇒ `post 3.34` ≈ 它自己的 `2.81`（+0.53 未归因），`systems 2.92` 是 main 相位、**不含** traffic-manager；main 榜去掉 traffic 后合计 2.76，与 2.92 差 0.16 闭合。

**自抓的一条口径误判（本轮最值钱的一课，已写进文档 §7）**：我先读 `stats.cpuBySystem` 看到 `remote-mining-manager=4.78`（10-04 同键 0.32），当场写下"新大户"。
读代码才发现那台仪器是 `systemBudgetEma`（`telemetry-collector.ts:402`），而**它自己的注释写着"EMA 排出来的榜会把低频系统错当成大户"**；权威 per-tick 表 `cpuPerTickBySystem` 给的是 **0.48/拍**。
⇒ 低频系统的 EMA 值可以是真值的 ~10 倍。**定罪前问的不是"数大不大"，而是"这个键是哪台仪器、什么口径"**——本仓同名 CPU 仪器已有四份（§2），这次的 15 倍间距就是它们之间的间距。

**#50 的算术（把"差多少"变成"从哪来才够"**：`constrained` 按 §1 是 >16.00/t，现场已钉 **30,489 拍 ≈ 32–36 小时**。
- **两个目标位必须分开**（这里过去一直混着）：**脱离 constrained 只需 −0.14/t**（在噪声里，可能自己就翻）；**进到 comfortable 要 −4.14/t**——而扩张闸认的是后者（#10）。
- 系统侧天花板：`cpuSystemTotal` 全量只 **6.03**，其中 traffic-manager 2.81 与 snapshots 1.56 都已判为**结构性成本**（#45 五条"能省"嫌疑全被实读否掉）。
  ⇒ **把 main 相位那 2.76 全砍光也够不到 4.14**。差额只可能来自 `creeps 7.18`（动作数/编制）或 `post`，或接受档位。
- 所以 #50 的真实形状不是"找一个大户"，是**"要不要缩活动量"**。取舍仍属人，但选项集现在是量出来的。
边界：零 src、零 push、零 build、零 npm install、零阈值改动、零线上写动作（全只读 API；含一次 40 秒的拍长标定等待）；`.gitignore` 与对方未提交物不 stage。

## 巡检 R351（10-06 08:1xZ）——**把 #139 修掉了**（对方定案、我这轮落地）：`RecoveryEscalation` 的第三列不再读 `escalations[0]`
**错因（读码闭合，不是推断）**：`upsertEscalation` 对**已存在**条目是原地更新、不移位，而新条目走 `unshift` ⇒ `list[0]` 只代表"最近**新建**的那条"。
调用方两处（事件 payload 与日志）都读 `esc.list[0]?.repeats ?? 1` ⇒ **升级非队首条目时报的是别房/别域的次数**。对方的天然实验读数（`d=[3,1,17]`，global 那条自己 27）与此完全吻合。
**修法放在函数侧而不是调用侧**：结果里新增 `repeats`（两个分支各自本来就知道该给什么），调用方改读 `esc.repeats`。
理由：清单身份判据是 `(room, domain, actionType)`，让调用方自己找回"刚更新那条"就是**重述一遍判据**——那正是本次出错的地方；取一次、两处用。
**回归用例**（`recovery-escalation-list.test.ts`）：建 A、建 B（B 抢到队首）、再连升 A 三次 ⇒ `A.repeats=4`、`list[0].repeats=1`（B，无关条目）、`result.repeats=4`。
**反向实验**：把 `repeats` 改回旧来源 `list[0]?.repeats ?? 1` ⇒ **恰好 1 例转红**，且报错就是 `expected 1 to be 4`（这个 bug 的签名），其余 6 例绿；还原后 `grep list\[0\]?.repeats src/` ＝ **0 处**。
**我自己这轮也红过一次，且是好事**：新用例第一次跑失败在 `shouldEmit`——我**猜**了 100 拍的间隔，而它落在心跳窗内。
改成用导入的常数 `ESCALATION_EVENT_HEARTBEAT_TICKS` 推间隔后全绿。⇒ 写判据不许硬猜节拍常数，能 import 就 import。
**影响面（照对方口径压住，不夸大）**：这条只改**观测通道**（事件第三列＋日志一列），不改任何决策；`EventKind.RecoveryEscalation` 在 `src/` 仍零消费者 ⇒ 今天受益的是事后复盘读得对不对，不是行为。
门禁：unit **393 文件 / 5,286 用例**、integration **30 / 239**、typecheck 退 0。**含 src 未推升到 8 笔**。
边界：零 push、零 build、零阈值改动、零线上写动作；`.gitignore` 与对方未提交物不 stage。

## 巡检 R352（10-06 08:2xZ）——**#140 落地**：姿态转换那一拍现在自带"走了哪条分支"；顺手抓到一个更硬的第二缺陷
**做了什么**：`posture.ts` 的 `finalize` 新增 `reason: PostureBranch`（8 枚字面量，**命名对齐分支条件而非注释意图**），八个 return 各自标注；
结果与 `Memory.kernel.strategy.branch` 一起落盘，并在**转换那一拍**写 `Memory.kernel.postureTransition={from,to,reason,tick}`。零决策改动——只加可读性。

**★顺手抓到的第二缺陷（比 #140 原报的更硬）**：`empire-strategy.ts` 里原先有
```
if (Memory.kernel.strategy?.posture !== undefined) { Memory.kernel.postureChangedAt = Game.time; }
```
而 `Memory.kernel.strategy` 在**同一次 run 的更早处**（`:113`）已被覆写成当前姿态 ⇒ 这个条件**恒真**，
`postureChangedAt` **每拍被覆写**——它从来就不是"变更时刻"，而是"本拍时刻"。
⇒ 这解释了对方为什么只能靠 console 考古：**不是缺列，是那列一直在撒谎**。修法＝把写戳移进真正的转换分支（`:101` 那个 `prev?.posture !== result.posture`），并删掉每拍覆写。

**验收**：新增 8 例分支标签用例（和平/威胁内未达止损/止损到顶/危机撤资/进攻授权/驻留未到/静默期满/威胁内维持），
全部从 `DEFAULT_POSTURE_OPTIONS` 推节拍、**不写死数字**（#139 那轮我刚为猜常数红过一次）。
**反向实验**：把止损分支错标成 `war-sustain` ⇒ **恰好 1 例转红**、错文正是 `expected 'war-sustain' to be 'war-exit-patience'`，其余 44 例绿；文件还原。
全量 unit **393 文件 / 5,294 用例**（+8）、typecheck 退 0；integration 待下轮随批复跑（本改动纯观测面，未触碰引擎调用）。
**上线后的免费复证（不制造条件）**：`kernel.strategy.branch` 应每拍有值、`kernel.postureTransition.tick` 应**只在姿态变化时跳变**
——后者就是"那列不再撒谎"的直接证明；下一次自然进/出 war 时一并复证 #92/#101 的推断。
边界：零 push、零 build、零阈值/决策改动、零线上写动作；`.gitignore` 与对方未提交物不 stage。**含 src 未推 9 笔。**

## 巡检 R353（10-06 08:2xZ）——矩阵 **§26** 做成（#97 → **7/8**）：市场不是只读，资本也不是约束；外加**我自己差点第三次造出假缺口**
**读到的三件事实（都有出处）**：
1. **`stats.trade.myOrders = 1`** ⇒ 我们此刻在市场上有**自己的挂单**——这条线是**双向**的（`createOrder` `:382`、`changeOrderPrice` `:322`、`cancelOrder` `:328`、`deal` `:77/:586`），不是"只读行情"。
2. **credits ≈ 19,833,159**（同 flush 窗两次读数逐字相同 ⇒ 只算**一个样本**，不写成"两次一致"）。⇒ **#130（要不要买 POWER）的权衡里，"买不买得起"不是变量**；真正在称的是要不要开这条链。
3. **`demandsLive=0 / demandsPublished=0 / gatedBy=""`** ⇒ 工业需求从未发布过一条，且**不是被闸挡住的**——是正 ROI 条件本身没满足（与 #44/#51 同向，行为零变化不是故障）。
本版本 `@types` 的 `Market` 只有 13 枚成员、**没有** `calcCommission/calcPrice/estimateOrder/bestOrders/skills` ⇒ 那些名字不可引用；`MARKET_FEE=0.05`、`MARKET_MAX_ORDERS=300` 是字面量可信，`TERMINAL_COOLDOWN/SEND_COST` 声明为裸 `number` ⇒ **本服未标定**。CPU 只有代码自陈"`getAllOrders` 是 CPU 大户"＋每 100 拍低频采样，**没有数值**。

**★自抓的第三次假缺口（这条比上面三件更重要，因为它是方法论）**
我第一轮搜 `\.cancelOrder(` 得 **0 命中**，于是写下"注释说超龄撤单、代码从不撤单 ⇒ 注释与代码不符"。
真相：`terminal-manager.ts:328` 是 **`market.cancelOrder?.(order.id) === OK`**——**可选调用 `name?.(` 不含子串 `name(`**。
⇒ **规矩升级（写进矩阵与记忆）：判"某 API 没接线"之前，调用形状必须同时搜 `name(`、`name?.(`、`name!(` 三种；
只搜一种得到的 0，只能记成"我没搜到"，永远不能记成"不存在"。** 本仓 `src/` 里 `name?.(` 形状有 **9 处**，不是罕见写法。
（同族前两次：`.observe(` 漏 `observeRoom(`、`.extract(` 根本没有这个方法。三次同一个根：**用脑内的搜索形状去裁决外部世界的存在性**。）

**边界**：零 src、零 push、零 build、零 npm install、零阈值改动、零线上写动作；**市场仍是只读取证**——我没有、也不会下任何单。
`.gitignore` 与对方未提交物不 stage。含 src 未推仍是 **9 笔**，`behind=0`；唯一恢复动作仍是一个字「推」。

## 巡检 R354（10-06 08:3xZ）——矩阵 **§27** 做成：§3.1–3.8 **八个领域的八项记录到此做齐**；但 `#97` 的判据被改写、**不宣布完成**
`launchNuke(` 按三种形状计数 **1/0/0**（`war-planner.ts:266`），前置是 `shouldLaunchNuke` 的射程/塔数/同目标在途预检＋`CONFIG.nuker` 五参数；战斗动作 `attack 10/0/0`、`rangedAttack 6/0/0`、`dismantle 3/0/0`、`heal 2/0/0`。
**两处按新规矩避免的错**：①四个"层外零导入"的战术运行时模块**不是死码**——它们由 `tactical-runtime-pipeline`（层外=1，活）编排 ⇒ 判死必须两步：层外引用者 + 引用者自身是否活；②`kernel.nukeLedger` 这个**键名是我猜的**（`src/` 里 grep 不到它），所以"键不存在"只证明我没找对名字 ⇒ 核弹的历史记 **`UNOBSERVABLE`**，绝不写"从未发射过"。控制组同形状读到 `kernel.capacity` 非空，证明工具形状可用。
`NUKE_RANGE=10` 是**代码注释自称**、本轮未在 @types 复核 ⇒ 标未核实；一发 50k 能量＋5k ghodium 同理（代码内声明，未从引擎文档独立复核）。
**#97 为什么不宣布完成**：八个领域各有第一份记录，只把"每个领域都能被问住"变成"有出处可查"。仍欠两类具体的东西——①§3.1 列了 13 个机制、§3.2 九个、§3.3 十一个，各自没有独立八项记录；②§26/§27 同一形状的欠账：**"资源成本/CPU 成本"两列大量是"未标定/未核实"**。八项里三列空着的记录是**地图不是收据**。
⇒ 判据换成可核的形式：**每个 §3.x 列出的机制都要有一条含标定过成本列的记录**。这条替换本身就是本轮的产出（旧判据"补完八个领域"会被我错误地标成完成）。
边界：零 src、零 push、零 build、零 npm install、零阈值改动、零线上写动作（全只读）；`.gitignore` 与对方未提交物不 stage。含 src 未推 **9 笔**，`behind=0`，唯一恢复动作仍是一个字「推」。

## 巡检 R355（10-06 08:3xZ）——creep 侧单价标定到手，**#50 的两个名义杠杆被算掉**（`e48d2e78`）
样本（`console-eval`，mark `R355P2` 回读一致）：`t=83,456,134`、`getUsed 18.55`、`limit 20`、`tickLimit 500`、人口 **42 只**（十二档角色全列，remote/自有搬运端占大头）。
creep 相位 `7.18 ÷ 42 ≈ **0.171 CPU/只·拍**`。口径限制写在数字前：分母瞬时、分子窗口均值，采样时间不同 ⇒ 只当数量级；历史夹具 `0.21 CPU/签发` 是**每动作**口径，同数量级但**不是复现**，不许混写。
分角色：**harvester ≈0.52、remoteHarvester ≈0.32 vs hauler/remoteHauler ≈0.12** ⇒ 省 CPU 最狠的一刀正好落在收入来源上。

**于是 #50 的真实形状变了**（要 −4.14/t 才进 comfortable）：系统侧整榜砍光也不够（§7）；creep 侧 4.14/t ≈ **削掉 24/42 只＝57% 编制**。
⇒ 剩下的是三选一，且都不是"调参数"：**(a) 接受 constrained 档并改扩张闸的 CPU 判据**（改判据 ≠ 降门槛，须 owner 明确认）；**(b) 抬 `Game.cpu.limit`**（`min(limit,tickLimit)=20` ⇒ 借 bucket 改不了档位，非代码可控）；**(c) 降固定项**——而固定项实测 ≈6.7/t 与 `cpuSystemTotal 6.03` 同量级，等于回到 (a)。
**本轮零代码、零阈值改动、零 push。** 它的价值是把一个"好像还有路"的请示，变成一个只有一个真选择的决定。

## 巡检 R356（10-06 08:4xZ）——新立 **#141**：人口普查只数 5 个角色＝现场 11/42 只，**拿它当分母的一切"人均"都虚高约 4 倍**（先登记，本轮不改码）
**证据两路，互不依赖**：①写者口径 `telemetry-collector.ts:287-291` 只枚举 `harvester/hauler/upgrader/builder/worker`；
②现场同刻对照——段 1 `population` 快照 `{t:83456205, hv:4, ha:5, up:2, bd:0, wk:0}`＝**11 只**，而 console 样本 `Object.keys(Game.creeps).length`＝**42 只**（remote 系 12、carrier 4、distributor 4、attacker 4、reserver 3、healer 2、labTender 1 全部不在普查里）。
**"窄"不是"错"**：普查的 `hv/ha/up`＝4/5/2 与 console 逐角色计数**完全相等** ⇒ 在它负责的范围内仪器是准的，缺的是覆盖面。
**为什么现在只登记不改**：修它要动 `src`（一行——把角色枚举换成对全部 creep 计数），而**这批已有 9 笔未推**、且改动会让"人均 CPU/闲置率"这类既有叙述的分母**当场换定义**（同一批里既有读数的口径要重述）。这不是我单方该定的事：
①口径变更会让别人写过的比值失效（G6/#45、#112 都用过人口相关数）；②改完必须在判效窗前重取基线。**故列为 #141，标"待随批推前先定口径"**。
**顺带拿到的两个硬数**（同一份段 1，纯只读 GET）：`avg10<12` 在 2,990 拍环里**驻留 0 tick**、单样本 cpu `min 14.6 / p50 19.2 / max 24.5` ⇒ #50 的"再等等看"不成立；`mi=6` 这类模式数同样只覆盖那 11 只口径，**不许当全帝国闲置率读**。
边界：零 src、零 push、零 build、零 npm install、零阈值改动、零线上写动作（只读取数 + 一次已核 mark 的 console 样本）。含 src 未推仍是 9 笔、`behind=0`；唯一恢复动作是一个字「推」。

## 巡检 R357（10-06 08:4xZ）——#141 用"只增不改"的方式落地，绕开了我上一轮卡住自己的那个理由
上一轮我把 #141 挂成"待定分母口径"，理由是改分母会让既有叙述失效。**这个理由是错的**：不必改 `hv/ha/up/bd/wk`，
段 1 的快照里**加两列**就够了——`n`（全体存活 creep 数）与 `rl`（角色→数量，按量降序截前 10，段体积有界）。
既有五列语义不动 ⇒ 历史读数继续可比；"人均"从此有正确分母；`counts` 本来就已枚举全部角色，**没有新增遍历成本**。
写者证据：`timeseries.ts:96` 的接口注释里直写"某刻五列之和=11 而真实人口=42 ⇒ 任何人均必须除以 `n`"。
**验收与诚实边界**：typecheck 退 0、unit **393 文件/5,294 用例**、integration **30/239** 全绿（我专门跑了它们，怕的是既有断言用 `toEqual` 钉死快照形状——实测没有）。
**但没有专项单测**：`samplePopulationData` 是模块私有函数，为它开测试口需要新导出一个仅供测试的符号，不值这一轮的钱。
⇒ 真实证明押在上线后的两行读法上：`population.n` **出现**＝这批真上线；且 `n ≥ hv+ha+up+bd+wk`、`n` 与 `Object.keys(Game.creeps).length` 同量级（现场基准 42 vs 11）。若 `n` 出现而 `rl` 缺，说明我只改了一半——那是我自己的错，不是世界的错。
含 src 未推升到 **10 笔**。边界：零 push、零 build、零阈值/决策改动、零线上写动作；`.gitignore` 与对方未提交物不 stage。

## 巡检 R358（10-06 08:5xZ / 00:5xZ UTC）——**war 在预报那一拍复发**；#140 的第二缺陷拿到三发现场直证；五件新签名的预部署对照全部取完
（取号说明：现 grep 到的最大号是 R357，本节取 R358；若与并行会话撞号，以本文件行序为准。）

**一、一条预报命中（本会话第一次"先写进文件、再读回来"）**：R191 补52 写的可否证预报是「war 最早 ≈83,456,360 复发」。
现读 `kernel.strategy` = `{"posture":"war","since":83456360,"warPressureTicks":0,"expansionAllowed":false,"gclLevel":5}` ⇒
**`since` 恰为 83,456,360**。命中就记命中，但它只证明"威胁窗+驻留闸的算术"对得上，不证明 war 里的执行链能出兵（见第二节）。

**二、#140 的第二缺陷（`postureChangedAt` 每拍被覆写、从来不是"变更时刻"）拿到三发直证**：
同一叶子连续三次读＝`83456491 → 83456502 → 83456503`（间隔几秒的三次只读请求），而 `strategy.since=83456360` 一动不动。
⇒ 这不是推断，是"读数每拍 +1、而真转换时刻固定"的形状。**上线判据因此是一条沿**：换码后 `postureChangedAt` 在姿态稳定期**不再推进**，
且 `kernel.postureTransition` 从"不存在"变为"存在且 `tick==strategy.since`"。当前基线（08:5xZ 现读）：`kernel.postureTransition` **不存在**。

**三、#138 的复验条件现在满足了，但读数还没满足**——这一条必须写清，否则下轮会把它读成否证：
- 现读 `kernel.stats.warFunnel` = `{"tick":83456294,"intelEntries":11,"notFact":2,"unowned":9,"mine":0,"noThreats":1,"candidates":0,"plans":0,"noSponsor":0}`，
  三房 `rooms.*.warPlan` 全部**不存在**。
- 但 `tick=83456294` **早于 war 起点 83456360**（差 66 拍）⇒ 这枚漏斗是 war **之前**那趟 pass 的快照（#99 已定案：桶是每 pass 从零计，不可跨拍差分）。
- ⇒ 今天的这批读数**既不能证也不能否** #138，只能记"尚未在 war 期内采到 pass"。**下一次采到 `warFunnel.tick > 83456360` 才算复验开始**；
  读法固定为 `node tmp/tools/official/peek.mjs kernel.stats.warFunnel`（Node 24、只读、本会话端到端跑通）。
  战争窗已开（且 `warPressureTicks=0`＝打得起），这一发不需要人为制造条件。

**四、五件新签名的预部署对照取完了**（沿 R346 的规矩：先把读法本身跑通，免得部署后把"仪器坏了"读成"改动没生效"）。08:5xZ 现读，全部**不存在**＝"缺键＝未上线"签名：
`kernel.stats.remainsLoot`（#131 回收漏斗）、`kernel.stats.remainsBlind`（#131 零容量盲点）、`kernel.stats.observe`（#100）、
`kernel.stats.safeMode`（#119）、`kernel.stats.strayAssets`（§3.4 残留资产）；另加 `population.n`（#141，段 1 走 memory-segment API，peek 读不到段）。
R346 表里那五件的预部署对照（含 `stats.roadBuild.W39S56` 无 `noWorkInRange`、`expectations.recent` 非空基线）仍在原处有效，本节不覆写。

**五、本轮唯一代码动作**：`0e435d32` 给 #141 的**汇总算术**补了单测（抽出纯函数 `summarizeRoles`）。两处第一次跑就红都已归因，
且**写快照那一半仍无测试**（要动 RawMemory 段与 Game.creeps，手拼假夹具测到的是夹具）。⚠ 记一名同类的坑：
`tests/unit/systems/telemetry-tier-recovery.test.ts` / `telemetry-recovery-flush.test.ts` 也整体 `vi.mock` 了 `kernel/timeseries`，
今天只是没走到普查分支才没炸——下次往 timeseries 加**值**导出会同样集体报错，改法照 `0e435d32` 的 `importOriginal` 透传。

**门与边界**：`tsc` 退出 0／unit 394 files·5298 tests 全绿／integration 30·239 全绿；**e2e 没跑**（script 自带 build，会毁"本地 dist==线上"这台免费仪器）＝没跑，不是失败。
含 src 未推 **11 笔 / 16 个文件**（`git rev-list --count origin/dev..HEAD`=210，其余是文档批）——**唯一恢复动作仍是一个字：「推」**，本轮零 push、零 build、零线上写动作（全部只读 API）。

## 巡检 R359（10-06 09:0xZ / 01:0xZ UTC）——**先撤我自己上一轮的一条"事实"**：warPlan 的键路径写错了；用正确路径重读，#138 的定性反而更硬（且拿到了零残差的算术解释）

**一、撤证（撤的是"事实"不是"解释"，所以按规矩要更强证据）**：R358 第三节写「三房 `rooms.*.warPlan` 全部不存在」。
现读码：写者是 `src/systems/military/war-planning-system.ts:525` 与 `src/systems/military/war-planner.ts:99`，两处都写 **`Memory.kernel.warPlan`（全局、单数）**，
`Memory.rooms.<房>.warPlan` 这个键**在 src 里从未存在** ⇒ 我那三发读的是错路径，其"不存在"是**工具形状**不是数据缺失。
同形重读（同一工具、同一批、并带一个已知非空的邻居做控制）：`kernel.warPlan` **不存在** ＋ `kernel.warBlacklist` 不存在 ＋ 控制 `kernel.strategy` 非空（posture=war）。
⇒ 上一条作废，替换为下面这条更硬的读法。规矩我早写过（猜键名的恒 undefined 会把仪器坏了读成数据为空），这次是自己踩回去的。

**二、war 期内的漏斗第一发到手，且算术闭合到零残差**：`kernel.stats.warFunnel` 现读 `{"tick":83456494,"intelEntries":11,"notFact":5,"unowned":6,"mine":0,"notNormal":0,"candidates":0,"noThreats":1,"plans":0,"noSponsor":0}`。
`tick=83456494` 在 war 起点 83456360 **之后 134 拍** ⇒ 这才是"war 期内的计划"那一发（R358 里我说 83456294 早于 war、既不能证也不能否，那句话本身是对的，只是我当时还没等到 pass）。
闭合式对得上：`intelEntries 11 === notFact 5 + unowned 6`，`mine/notNormal/candidates` 皆 0 ⇒ **没有残差**，零计划完全由上游筛除解释：
- `notFact=5`：`war-planning-system.ts:310` 的授权硬门槛 `intelActionUsable(entry.subject, tick)`（非 fact 级情报不得进候选）；
- `unowned=6`：`payload.owner` 为空（NPC/无主房），本就不该是打击目标。

**三、#138 的定性由此改写（不是撤销）**：今天线上真正发生的不是"计划生成了却没变成兵"，而是**"根本没有任何一个可打的候选房"**——
war 姿态开着（`warPressureTicks=0`＝打得起），而事实级敌情为 **0 条**。所以：
- 「spawned=0 / 计划没变成兵」这一支：本轮**未开始验证**（没有计划可跟，物理上证不了也否不了）。
- 新立的问题（更上游、可现在动手）：**侦察覆盖面**不足以满足战争授权门 ⇒ 与 #100（Observer 账本，`stats.observe` 尚未上线）、
  §25 扩张层的 `intelActionUsable` 是同一条链的两端。这条我不在本轮改码：判据要等 `stats.observe` 上线后按 `noTarget/gate` 读，才能分清"没盖楼"与"盖了没请求"。

**四、留给下一轮的读法（已端到端跑通、形状已核）**：
`node tmp/tools/official/peek.mjs kernel.warPlan`（正确路径，配 `kernel.strategy` 当控制）；
`node tmp/tools/official/peek.mjs kernel.stats.warFunnel`（要看 `notFact` 是否随侦察刷新下降——那是覆盖面改善的直接签名）。
边界：本轮零 src、零 push、零 build、全只读 API；`.gitignore` 与两份未跟踪文档仍未 stage。

## 巡检 R360（10-06 09:0xZ / 01:0xZ UTC）——`notFact` 读到根：**"fact 级"对战争候选来说是物理量，不是数据量**（本轮纯读码，零改码）
接 R359 的立案（task #114：war 开着、`intelEntries 11 === notFact 5 + unowned 6`、`kernel.warPlan` 不存在）。这一轮把那条授权门读到底。

**一、门的确切形状（逐行读到，非推断）**
- `src/systems/military/war-planning-system.ts:310` 用 `intelActionUsable(entry.subject, tick)` 筛候选，注释自陈是"授权硬门槛：非 fact 级情报不进入战争目标候选"。
- `src/domain/intel.ts:328-336` → `isActionUsable`：`if (confidenceAt(entry, tick) !== "fact") return false;`（外加可选 `maxAge`）。
- `src/domain/intel.ts:315-321` → `confidenceAt`：**先问来源**`if (!isDirectSource(entry.source)) return "inferred";` 再按龄判 `fact/stale/unknown`。
- `src/domain/intel.ts:249` → `DIRECT_SOURCES = {"passive", "scout", "observer"}` ⇒ **ally/derived 来源永远是 inferred，永远不会成为打击候选**（这是设计，不是缺陷：`intel.ts:323-327` 写明"不可逆行动只接受 fact 级"）。
- `src/domain/intel.ts:303-308` → `ttlForPayload`：payload 只要带 `towers` 或 `enemySpawns`，TTL 取 `ROOM_THREAT_TTL`；
  `src/domain/intel.ts:255` → **`ROOM_THREAT_TTL = 200`**（动态字段才是 `ROOM_DYNAMIC_TTL = 10_000`）。

**二、由此得到的结论（比"侦察覆盖面不足"更硬）**：一次敌方房的"威胁级"情报，fact 期只有 **200 拍**。
所以战争候选**不是靠攒情报攒出来的**，而是要求**过去 200 拍内持续有直接视野落在同一个有主敌房上**
（passive=恰好看见、scout=专门去看、observer=Observer 楼）。这三条现在都不在场：漏斗里 6 条是 unowned（远矿/NPC），
5 条非 fact ⇒ `candidates=0`。**"war 姿态 + 打得起 + 0 候选"是同一套安全设计的必然产物**，不是某个 bug 的症状。

**三、本轮没读到的那一个数（不许含糊过去）**：`war-planning-system.ts:32` 的 `interval: CONFIG.war.interval` ——
配置文件不叫 `src/config.ts`（`grep` 打空是我路径猜错，不是数据缺失），我没读到它到底是多少。
它重要是因为：若 `CONFIG.war.interval` ≥ 200，则 pass 与 fact 窗会撞成 knife-edge（`age <= 200` 恰好压线），
`notFact` 会**按构造**接近全数；若远小于 200，则 5 条非 fact 更多反映"真的没看见过"。
⇒ 下一轮第一读：`grep -rn -A 6 "war:" src/config/*.ts`（或 `git grep -n "interval" src/config/`），拿到数之后再谈要不要动采集侧。

**四、可现在验证、不需要改码的判据**（都不许人为制造条件）：
1. `warFunnel.notFact` 随敌情新鲜度变化：若某趟 pass 前正好有 creep 路过有主敌房，`notFact` 应下降、`candidates` 应 >0。命中即证第二节的机制在跑，也顺手给 #138 的"计划→兵"那一支拿到第一个计划。
2. `kernel.stats.observe`（#100，未上线）上线后读 `noTarget` vs `gate`：分清"Observer 楼不在"与"楼在但没请求"——这正是第三节那三条直接来源里唯一帝国能主动买的一条。
3. 反向边界（写明不做的处置）：**不降低 `isActionUsable` 这道门来让 war 能出兵**——它是不可逆行动的属人安全闸；要动只能动"采集侧"（scout/observer），且属扩张/侦察政策，不属本轮。

边界：零 src、零 push、零 build、全只读；`.gitignore` 与两份未跟踪文档仍未 stage。

## 巡检 R361（10-06 09:0xZ / 01:0xZ UTC）——把 R360 留的那个数读到：**`CONFIG.war.interval = 10`**，我上一条 knife-edge 假设因此自撤
数出处：`src/config/index.ts:694` 起 `war: { … interval: 10 }`（`git grep -n -A 10 "war: {"`；R360 里我 `grep src/config.ts` 打空是**路径猜错**，配置在 `src/config/index.ts`——不是数据缺失，别把工具的错读成世界没有）。

**自撤的内容（撤的只有 R360 第三节那一条假设）**：我写过"若 `interval ≥ 200`，pass 与 fact 窗会撞成 knife-edge，`notFact` 会按构造接近全数"。
实测 `interval=10` 远小于 `ROOM_THREAT_TTL=200` ⇒ **一次直接目击能给 20 趟 pass 用**，门根本不会自己饿死。
⇒ `candidates=0` 的解释随之收紧为一句可引的话：**过去 200 拍内，没有任何一个"有主非我方"的房被直接来源（passive/scout/observer）看见过。**
`notFact=5` 不是采样节奏问题，是采集**落点**问题（我们的直接视野只落在远矿/NPC 房——与漏斗里 `unowned=6` 同源）。

**同一次读到的、要提防的第二形状**：`warFunnel.tick` 两次现读相差正好 200（00:58:52Z 的 83456294 → 01:01:18Z 的 83456494），
而 `kernel.postureChangedAt` 同窗推进 12 拍/44 秒（≈3.7 s/拍，与既有拍长标定一致）⇒ 若 pass 真按 10 拍跑，漏斗戳理应只落后个位数拍，
却落后了约 50 拍。**最可能是仪器延迟**（`stats.*` 是 heap 账本经 telemetry flush 落 Memory，落盘节拍≠写节拍），
但这条我这轮**没验**：它是"读数滞后"还是"pass 被档位闸跳过"两种解释都吃得下，处置方向不同。
下一读：同批取 `kernel.stats.lastSample` 与 `kernel.stats.warFunnel.tick` 的差，再与 flush 间隔对比——**别拿这个差去动 `CONFIG.war.interval`**。

**净结论（本轮零改码）**：R360 第二节不变——战争门槛是属人安全设计，要动只能动采集侧；
而 R361 把"动采集侧"具体到了一句话：**要有 scout/observer 把直接视野落到有主敌房上**，其中 Observer 那条正是 #100 等 `stats.observe` 上线才能分清"楼不在"与"楼在没请求"的那一支。

## 巡检 R362（10-06 09:0xZ / 01:0xZ UTC）——把 R361 那句"要动只能动采集侧"落到**哪一侧、有几条路、各堵在什么上**（纯读码，零改码）
R361 的结论是"过去 200 拍没有任何有主敌房被直接来源看见"。这一轮回答：直接来源一共三条，逐条查它**写者是谁、任务从哪来、今天为什么不覆盖敌房**。

**一、三条直接来源全部有活写者（WIRED 全成立；EXERCISED 只有一条半）**——`git grep -n -E '"(passive|scout|observer)"'`：
1. **`"observer"`**：`src/systems/room-observer.ts:203`（对一个 `pending.targetRoom` 发请求）、`:228` 与 `:360`（**对 homeRoom 的邻居房**发请求）。
   ⇒ 覆盖面天然等于"各自住房的八邻域"。它能不能真发出去，取决于 Observer 楼在不在、以及有没有被排进 pending——
   **这正是 #100 卡住的那一点**（"楼在不在"当前无落盘答案），而那把钥匙就是本批未推的 `994bf542`（`stats.observe`，含 `noTarget`/`gate` 两列）。
2. **`"scout"`**：`src/systems/room-observer.ts:322`（收 scout creeps 的观测）。scout 的**任务来源**是
   `src/systems/empire/prospect-manager.ts:108/142/148`（扩张探矿 mission），而扩张候选**按定义是无主房** ⇒
   这条车道产出的正是战争漏斗里 `unowned` 那一桶（现读 6 条）。**它不是"漏了敌房"，是它的使命就不是敌房。**
3. **`"passive"`**：`src/systems/intelligence.ts:59` `upsertRoomEntry(roomEntries, adoptRoomIntel(obs))`，喂入口按 `:172` 的注释是
   「观察交接采用 + 被动威胁信号」⇒ 我方视野/敌方入侵经过时**会**留下直接来源条目。漏斗里 `notFact=5` 最可能就是这类条目过了 200 拍（威胁字段 TTL）后落到 stale。
   ⚠ 这条我**没定罪**：`notFact` 的分桶只告诉我"不是 fact"，没告诉我是 `inferred`（来源不直接）还是 `stale`（来源直接但过期）——
   两者处置完全不同（前者要加采集面，后者只要把 observer 刷新上）。**要区分就得上账**：`war-planning-system.ts:310` 那一支现在只 `funnel.notFact++`，
   没记 `confidenceAt` 的原值。这是一个**新增列就够**的观测补丁，但它属于采集侧决策，我不在授权之外顺手改码。

**二、依赖关系写死成一句**：作战能力（L0 §3.6/§2.3 的"竞争/作战"那一柱）当前**唯一能由帝国自己买到的直接视野是 Observer**；
scout 那条买的是扩张，passive 那条是运气。而"能不能确认 Observer 该买不该买"这件事的前置，就是 `stats.observe` 上线——
**本会话攒的 11 笔未推 src 里就有这一笔**（`994bf542`）。⇒ 推这一批不再只是"多几个读数"，它直接决定 #100/#138 与战争线能不能从"不可判"变成"可判"。

**三、本轮明确不做**（免得下轮误读成我在选路）：不改 `isActionUsable` 的门槛、不给 `notFact` 顺手加列、不派 scout 去敌房、不盖楼——
四件都属人。边界照旧：零 src、零 push、零 build、全只读；`.gitignore` 与两份未跟踪文档未 stage。

## 巡检 R363（10-06 09:0xZ / 01:0xZ UTC）——**R361 那条"未验的第二形状"就地结案**：漏斗落后是**兄弟采样器的节拍**，不是 pass 被跳过；同时给今天所有漏斗结论加一条时效性上限
**为什么会去追这条**：同一叶子里连着三读 `warFunnel.tick` 全等于 `83456494`，而 `kernel.stats.lastSample=83456645`、`kernel.postureChangedAt=83456652` 都在往前走 ⇒ 看上去像"仪器或 pass 死了"。R361 我把它写成"最可能是 flush 延迟、但也可能是档位闸跳过 pass"，两解处置相反，于是按规矩去读写者那一行。

**读到的机制（`src/systems/military/war-planning-system.ts:42-46`，是 #99 自己留的注释，不是我的推测）**：
每趟 pass 都 `newWarFunnel(tick)` **换一个 heap scratch 对象**，`Memory.kernel.stats.warFunnel` 里那份快照**不由 pass 改写**，
而是「**由 intelligence 的老化批（每 100 拍）与 `intelCoverage` 同拍快照进 Memory**」。
⇒ 落盘节拍是 **100 拍的兄弟采样器**，与 `CONFIG.war.interval=10` 无关。R361 里"落后约 50 拍"因此不是异常：
按 100 拍采样 + 记录的是 pass 戳（不是采样戳），落后量天然在 0～~110 拍之间。**"pass 被档位闸跳过"这一支可以撤**——
它需要一个"100 拍采样器也没跑"的额外假设，而 `lastSample` 正好往前走、没有任何独立证据支持第二个假设。

**残留没扫干净的那一格（写清，别读成已全部结案）**：现读落后 **158 拍**（83456494 vs 83456652），比"一个采样周期 + pass 戳误差"略超；
可能的解释是老化批自身被门挡住（它的 phase/条件我没读）。**一发的判别读**就够：
`node tmp/tools/official/peek.mjs kernel.stats.intelCoverage` —— 同一批写入的兄弟键若已越过 83456494，则批在跑、漏斗那条是有条件写；
若同样冻在 83,456,4xx，则要去看 intelligence 老化批的 due-tick 条件。**不许**由此去动 `CONFIG.war.interval`（今天两次独立否证都指向"节拍不是问题"）。

**⇒ 对今天全部战争结论加一条时效上限（这是本节的实际用处）**：R359/R360/R362 用的 `candidates=0 / notFact=5 / unowned=6 / plans=0`
是「**截至 tick 83456494 那次快照**」的读数，不是"planner 此刻的判定"。三条推论的强度因此分开计：
- **不依赖漏斗新鲜度**的：授权门的形状（`DIRECT_SOURCES`、`isActionUsable`、`ROOM_THREAT_TTL=200`、`interval=10`）——纯读码，结论不受影响。
- **依赖一次快照**的：「过去 200 拍没有有主敌房被直接看见」。快照最坏可落后 ~110 拍，所以这句话实际覆盖的是
  "截至 83456494 的那趟 pass"。⇒ 它**足以立案**（#114 已立）但**不足以定罪成"永久无候选"**；定罪要第二发快照落在战争窗内更晚的拍上。
- 三度强调过的禁忌再记一次：桶是每 pass 从零计，**不可跨拍差分**（#99 定案）。

**顺带一条与恢复链有关的现读**（同一批发到，不当判据只当基线）：`kernel.escalations` 三条**全部 `terminal:true`**，
`repeats` 分别是 W38S58=17、W38S56=1、global/mineral/terminal_trade=27，且 global 那条 `firstAt=83363952 / lastAt=83453052`（跨 89,100 拍）。
⇒ 这正是 #139 定罪用的那个天然实验的**原始形状**：条目顺序与各自 `repeats` 已在此留档，上线后按 `esc.repeats` 读，
若事件里的数字与"被升级的那一条"对上（而不是恒等于第 0 条的 17），#139 即为命中。**这是基线，不是判效**（修复未推）。

## 巡检 R364（10-06 09:1xZ / 01:1xZ UTC）——R363 残留就地翻案：漏斗那条拷贝**按设计是对的**，可疑的是"老化批自己那一拍的门"；顺带两份独立仪器互证到个位
**一、把机制读到底（`src/systems/intelligence.ts:38-42` 与 `:183-205`，逐行）**：
`PARENT_INTERVAL=10`（系统每 10 拍跑一次）、`AGING_INTERVAL=100`、老化门是**相对相位**写法
`if ((ctx.tick - PARENT_PHASE) % AGING_INTERVAL === 0)`（`:42` 的 `PARENT_PHASE = systemPhase("intelligence", 10)` ——这正是本仓踩过的"绝对 `tick % N` 会饿死下游采样器"之后改成的相位式规范）。
落盘顺序：`intelCoverage={rooms,players,tick:ctx.tick}` 与 `warFunnel={...globalCache().warFunnelScratch}` **同一拍写**；
`scratch` 为 undefined（boot 后 war-planning 还没跑过）时**故意不写**，注释写明"写成全零会被读成'跑过且每道筛子都空'"——这条设计我上一轮该先读到。

**二、算术正好闭合，所以 R363 剩下的那格换了方向**：现读 `intelCoverage.tick=83456503`、`warFunnel.tick=83456494`、`lastSample=83456675`。
war-planning 自有相位，pass 戳落在 …494/…504；老化批在 83456503 那一拍拷贝时，"≤83456503 的最后一趟 pass"正是 **83456494** ⇒
两个读数不是"谁旧了"，而是**同一次写入的两个字段**，落后量 = 两把相位之差。**"漏斗仪器坏了"这一支正式结案为否证。**
但同一处也暴露出新的、更硬的一格：按 100 拍周期，**下一拍应在 83456603**；到 `lastSample=83456675`（晚 72 拍）两把键仍冻在 83,456,5xx ⇒
**那一整批没落盘**。最可能的结构性原因：相位取模门只在**唯一一拍**为真，而调度器不保证系统恰好在那一拍跑到
（`cpuAvg10` 现读 **15.5**＝tight 档，本仓既有 skip 计数机制；错过那一拍就要再等 100 拍）。
⇒ 与 `>= lastAged + 100` 这种"错过也能补"的写法相比，**取模门在可选调度下会整批丢失**。这条我今天**不定罪**：
判别只要两发——跨过下一个批沿（≈83456703）再读 `intelCoverage.tick`，**若一次跳 +200（或 100 的整数倍）即定罪**，若恰好 +100 则是我多虑、结案为仪器正常。
修法规格留在这里、不动手：把 :183 的取模门换成"距上次老化 ≥100 拍"的补跑式；属采集侧决策，且今天有 11 笔未推码排队，**不再加第 12 笔**。

**三、两份独立仪器互证到个位**（这是今天最干净的一条一致性证据）：`intelCoverage.rooms=11` **恰好等于** `warFunnel.intelEntries=11`——
两者一为池子规模、一为漏斗入口计数，口径不同却同值 ⇒ `queryRoomIntel()` 的入口就是整个 room 池，**漏斗没有额外的隐藏筛除**。
`players=3` 与 #109 当时记录的"1 玩家"是两个不同时刻的样本（不写成趋势）。
⚠ 同批还读到 `crisisCount=1848`，而 R346 读到 1762——**我没先分类这个计数器**（累计？每窗？heap 复位？），
所以这里只登记两个原始样本，**不引成趋势、不引成"危机在恶化"**；要引得先读它的写者那一行。

**四、给 R363 的时效上限补一句可执行的**：既然两份读数由同一次批写入产生，**下一次刷新时刻完全由老化批决定**（不是 10 拍，也不保证 100 拍）。
⇒ 战争漏斗的任何"第二发复证"都必须先确认 `intelCoverage.tick` 变了；否则两发其实是同一发。这条加进 #114 的判读前置。

## 巡检 R365（10-06 09:1xZ / 01:1xZ UTC）——**两件事同一发读数里都到手了**：老化批"整批丢失"定罪（+200），且 #114 的候选为零拿到**第二发复证**
判别读法是我上一轮**先写进文件**才去读的（`预写判据`命中，本会话第二次），所以这发不是"看着像"：
> 「跨过下一个批沿（≈83456703）再读 `intelCoverage.tick`，**若一次跳 +200（或 100 的整数倍）即定罪**，若恰好 +100 则是我多虑、结案为仪器正常。」

**一、定罪（n=1 次丢失，两处独立时刻）**：`intelCoverage.tick` 从 `83456503` → **`83456703`**，正好 **+200**。
而更早那发（01:10:53Z）里 `lastSample` 已到 `83456675`、两把键仍冻在 83,456,5xx ⇒ **83456603 那一批确实没落盘**，不是采样时机没赶上。
机制与 R364 猜的一致：`intelligence.ts:183` 的 `(ctx.tick - PARENT_PHASE) % 100 === 0` 只在**唯一一拍**为真，
调度不保证系统恰好在那一拍跑到（当时 `cpuAvg10=15.5`＝tight 档），错过就要再等一整个周期；换成 `>= lastAged + 100` 的补跑式则不会整批丢。
**严重度如实压低**：受影响的是①`intelCoverage`/`warFunnel` 两列读数的新鲜度（复证节奏由 ~100 拍变成 ~200 拍）
与②`ageRooms/capRooms` 的剪枝延后一拍——**都不是决策输入**，不构成存活或扩张风险。值得修，不值得为它插队换码。

**二、#114 由"单发"升级为"复证"**：`warFunnel.tick` 现在是 **`83456694`**（比上一发晚 200 拍、仍在同一场 war 里，`since=83456360`），
而 `intelEntries=11 / notFact=5 / unowned=6 / mine=0 / candidates=0 / plans=0 / noThreats=1` **逐列同值**。
⇒ R363 给"candidates=0"挂的那条时效上限（"足以立案、不足以定罪成永久无候选"）**这一发正好把它补上了**：
war 期内两趟 pass、间隔 200 拍，都是零候选零计划。按 #114 的措辞就是——**过去 200 拍内没有任何有主敌房被直接来源看见，这句话现在成立两次**。
仍**不是**"战争模块坏了"：授权门的形状（`DIRECT_SOURCES`、`ROOM_THREAT_TTL=200`、`interval=10`）是纯读码结论，两条路各自堵在采集面（R362 表）。

**三、两把仪器这发不一致，且不一致本身可解释**（不是矛盾）：`intelCoverage.rooms=8` 而 `warFunnel.intelEntries=11`。
前者是**批沿 83456703 上 `ageRooms`/`capRooms` 跑完之后**的池子规模，后者是**pass 沿 83456694**（早 9 拍）读的池子入口数 ⇒
差值 3 ＝ 那一拍刚老化掉的条目。**新的、更重要的量跟着到手：整个 room 情报池只有 8～11 个房。**
⇒ "选不出靶"的第二层解释不是筛选太严，而是**池子本身就这么小**（远矿＋邻域＋被动目击的并集）。
这条比 R361 那句"采集落点问题"更具体，直接给 #100/#107 那条"采集面"待办一个分母：**要候选，先得让池子里出现有主敌房**。
⚠ 别把它读成趋势：8 与 11 都是单次读数，`crisisCount` 那种没分类的计数器我这轮仍然不引。

**四、下一轮（零部署即可做）**：`peek kernel.stats.intelCoverage` 再取两发批沿——
若连续两次都是 +200（或 100 的倍数），就把"取模门在可选调度下整批丢"正式立案为缺陷（带修法规格，R364 已写）；
若出现恰好 +100，则今天的 n=1 定性降级为"偶发跳过"。**同时**读 `warFunnel` 是否出现 `candidates>0`——那是 #138"计划→兵"那一支的第一发。

## 巡检 R366（10-06 09:4xZ / 01:4xZ UTC）——**两件事各自到手**：老化批的取模门连续丢三批（+400）；war 里的漏斗换了形状——`notFact` 归零，因为**情报池里已经一个有主房都没有了**
01:42:08Z 只读现读（同一批、同工具）：
`kernel.strategy` = posture **仍为 war**、`since=83456360`（本场已 **≈734 拍**）、`warPressureTicks=0`、`bucket=10000`；
`kernel.stats.intelCoverage` = `{"rooms":7,"players":3,"tick":83457103}`；
`kernel.stats.warFunnel` = `{"tick":83457094,"intelEntries":7,"notFact":0,"unowned":7,"mine":0,"notNormal":0,"candidates":0,"noThreats":1,"plans":0,"noSponsor":0}`；
`kernel.stats.lastSample` = `83457165`。

**一、R365 的复判条件到手，且答案比我预写的更糟**：预写判据是"跳 +200 即定罪、恰好 +100 则结案为仪器正常"。
`intelCoverage.tick` 从 `83456703` → **`83457103`＝+400**（三把键全部 ≡ 03 mod 100 ⇒ **相位是稳的**，不是相位漂）。
按 `AGING_INTERVAL=100` 的门，中间 `83456803 / 83456903 / 83457003` **三批连续没落盘**；加上 R365 定罪的 `83456603`，
本窗共 **4 次丢失 / 7 个到期沿**。机制仍是 `intelligence.ts:183` 的 `(tick-PARENT_PHASE)%100===0` 只在唯一一拍为真、
而调度器不保证跑到那一拍（`cpuAvg10` 15.5＝tight）。
**严重度按"同批还干了什么"重算，不再只说"非决策输入"**：那一个分支里同时跑着 `ageRooms`、`capRooms`、
`restorePlayersToSegment()`、`persistPlayersToSegment()` ⇒ 批延后 400 拍意味着
①两列读数新鲜度只有设计值的 ~1/4；②**段冷存的玩家情报最长晚 400 拍才落盘**，而部署会清 heap ⇒ 这是一段**真实的数据丢失窗口**（不是纯展示问题）；
③`capRooms` 延后无影响（池子 7，离 `INTEL_ROOMS_CAP=256` 远得很）。
⇒ 立案为缺陷（带修法：取模门 → `>= lastAged + 100` 补跑式；规格 R364 已写）。**本轮仍不动码**：已有 11 笔未推，且修法要跑的判别量已经全部留档。

**二、war 漏斗的第三发复证到手，且这一发把结论换了个层级**：三趟 war 期内的 pass
（`83456494` → `83456694` → `83457094`，跨 600 拍）**全部 `candidates=0 / plans=0`**，R365 那条"复证要第二发"的要求已经满足并超出。
但这一发的读数形状变了：`intelEntries 11→7`、`notFact 5→0`、`unowned 6→7`——
**那 5 条非 fact 条目不是变成了 fact，是被 `ageRooms` 老化掉了**（与 R364 的 11 vs 8 差值解释同一机制，这次是正面确认：
7 == 7，池子与漏斗入口重新对齐）。
⇒ 于是句子从"过去 200 拍没有有主敌房被直接看见"**升级成更硬的一句**：
**当前情报池里的 7 个房全部是无主房（`unowned=7 / mine=0`）——我们对"有主的别人房"一无所知，一条都没有。**
战争授权门当然筛不出靶：不是筛得严，是**池子里根本没有可筛的对象**。
这给 #100/#107/#138 那条"采集面"待办一个可执行的最小问题：**先让任何一个有主房进入情报池**（八邻域的 observer 请求，或一次敌房方向 scout），
而不是去动 `isActionUsable`（属人安全闸，不动）。

**三、新抓到一条与"恢复/持续优化"直接有关的形状**（本轮只登记，不推断成因）：三趟 pass 都有 **`noThreats=1`**
（`war-planning-system.ts:53`：`input.threatAssessments.length===0` 才置 1），而姿态仍是 war、`warPressureTicks=0`。
⇒ 姿态与"当前威胁评估"是**两把不同的量**：war 由滞回/驻留记忆维持，而此刻威胁集为空。
这正是 #90/#92 预言过的形状（脉冲骚扰换来长扩张税）的**第三个实例**，但它今天**只到"形状在场"这一档**——
`threatAssessments` 的输入键名我这轮没有逐一核（不猜键名是规矩），所以**不引成"war 是无来由的"**，也不据此动 `warPatience`。
判别量已写明：真要有主敌房进入池子后 `notFact/candidates` 是否随之动；以及威胁集为空时 war 还能驻留多久（读 `strategy.since` 与退出沿）。

边界：本轮零 src、零 push、零 build、全只读 API；`.gitignore` 与两份未跟踪文档仍未 stage。

## 巡检 R367（10-06 09:4xZ / 01:4xZ UTC）——**先改我自己两分钟前的说法**：老化批是**间歇丢沿**，不是"常态 1/4 速"；顺带把 `mine=0` 读到底（room 池只有两条进水管）
**一、第四次读数推翻了我上一节写重的话（这就是"同批发完再取一发"的价值）**：
`intelCoverage.tick` 序列＝`83456503` → `83456703`（+200）→ `83457103`（+400）→ **`83457203`（+100）**。
⇒ 那一拍的门**确实会按 100 拍的节奏落盘**，R366 里"新鲜度只剩设计值的 ~1/4"是拿最坏一段当常态，**就地作废**；
站得住的说法是：**间歇性丢沿**——本窗 3 次丢沿（一次 +200、一次 +400 跨度），随后恢复 +100。
缺陷仍成立（+400 那一段是真实的 400 拍失明窗，且同批的 `persistPlayersToSegment` 一起被延后），
但档位从"系统性慢 4 倍"降到"偶发整批延后"，修法（取模门→`>= lastAged+100` 补跑式）不变、优先级也相应下调。
教训照记：**速率类结论要至少两拍同形复现，取到最坏一段不能当分母。**

**二、我把自己的 `bootTick` 陷阱又踩了一遍（写下来专防下轮）**：
为了判"池子只有 7 个房"是采集缺口还是刚复位没攒起来，我第一读拿了 `kernel.bootTick=82414952`，
差点就此写成"heap 连续活了 1,042,243 拍"。**`bootTick` 是创建戳不是新鲜度**（本仓老规矩，我自己记过好几次），
heap 复位的见证器是 `kernel.stats.energyLedger.tick`——现读 **83431816**，而 `lastSample=83457205`
⇒ **当前 heap 只活了 ≈25,389 拍**，约 `ROOM_DYNAMIC_TTL=10,000` 的 2.5 个周期。
结论方向没变（2.5 个 TTL 足够一个在跑的 observer 把 24 个邻域房刷进池子），
但**依据换了**：从"1M 拍都没攒出来"改成"2.5 万拍里没攒出来"。两句话分量不同，别引错。

**三、`mine=0` 读到底：room 情报池只有两条进水管**。读码：
`intelligence.ts:55-69` `adoptHandoff()` 只吃 `globalCache().intelHandoff` 这一个 heap 缓冲（外加被动威胁信号），
而往缓冲里写 `submitObservation` 的**一共四个点**（`room-observer.ts:203` observer 目标房、`:228` 与 `:360` **住房八邻域**、`:322` scout）。
⇒ 能往池子里放"有主房"的**只有** observer 的邻域扫描和 scout 的顺带目击；
我方自己的房虽然每拍被看见，但**没有一条管道把它写成 room 条目**（所以漏斗里 `mine=0` 不是"筛掉了自家房"，
而是**自家房压根没进池子**——这条口径值得记，`mine` 那一列读起来容易误成前者）。
现读池子 7 个全是 unowned ⇒ 这 7 条对得上 scout/远矿那条道，**observer 那条道在这 2.5 万拍里一条都没产**。
⚠ **但这一步是"聚合推断"不是"直接读数"**：`intelCoverage` 只有 `rooms/players/tick` 三个数，**没有按来源分桶**，
所以"observer 产 0"是从总数与形状反推的，可能被 `ageRooms` 的淘汰节奏影响。
⇒ 这正是 #100 要的那枚仪表该长的形状：`stats.observe` 上线后按 `ok/noTarget/gate/lostVision/staleSlot` 直读，
再加一列"按 source 分桶的池子增量"就能把这条推断升成读数。**记为可还项，本轮不动码。**

## 巡检 R368（10-06 11:3xZ / 03:3xZ UTC）——**war 自己退场了，而且退场方式否证了一条我引过很多次的"尾税"说法**
03:32–03:34Z 只读现读（同工具、同批，控制读数 `kernel.strategy`/`kernel.stats.*` 均非空）：
`kernel.strategy` = **posture=fortify、`since=83458051`、`expansionAllowed=true`**、`warPressureTicks=0`、`bucket=10000`、`gclLevel=5`；
`warFunnel.tick=83458794`（`intelEntries 11 = notFact 2 + unowned 9`、`mine=0`、`candidates=0`、`plans=0`、`noThreats=1`）；
`intelCoverage` = `{"rooms":10,"players":3,"tick":83458803}`；`lastSample=83458845`。

**一、war 结束于 `83,458,051`，全程 `1,691 拍`**（起于 83456360，即 R191 补52 那发预报的拍）。
**二、★"退出 war 还要吃 ≥5,000 拍 fortify 尾税"这条被现场否证**：退出后仅 **794 拍**，`expansionAllowed` 就已经是 `true`。
读码给出机制（不是巧合）：`posture.ts:440-446` 的 `expansionPreserve = (prevPosture !== "war") || (warExitTicks ?? 0) >= minDwell`
——**前一拍不是 war 就短路为真**；而 war→fortify 那一拍本身走 `finalize(..., true, "war-*-exit")`，`expansionAllowed` 直接给真。
⇒ `minDwell=5000` 只把**姿态标签**按在 fortify（要 5,000 拍静默才回 develop），**不锁扩张授权**。
连带否证 task #7 那句"扩张今天的唯一阻塞是 war 尾税（`posture!==war` 这一项）"：**`posture` 现在就不是 war 了**，
所以如果扩张仍不推进，卡点在别处（G4/G6/队列重建），不在这条尾税上。
（诚实边界：这条"尾税"说法是我自己从 09-30 起反复引用的，包括 R345 那句"到 ≈83,422,856 才可能开工"。它当时被当成退出侧的算术，
而算术里我把 `minDwell` 用错了地方——`minDwell` 在退出侧管的是**姿态显示**，不是 `expansionAllowed`。）
**三、war 是怎么退的，今天只能推、不能读**——因为**能回答它的 `a2e90f02`（#140 分支标签）还没上线**。
首要嫌疑是**危机撤资**分支（`posture.ts:452`：`prevPosture==="war" && anyRecovery && !liveThreat → fortify`）：
`rooms.W38S58.colonyState="recovery"` 此刻在场（同批读到，且该房 `spawnQueue` 里有 upgrader 请求），
而漏斗三趟都 `noThreats=1`（`threatAssessments` 为空）。两把条件都对得上，**但这是推断不是读数**——
上线后同一问直接读 `kernel.postureTransition.reason` 即可，这也是本批 11 笔未推码最具体的价值之一。
**四、我自己的两次路径错，当场纠正、绝不当数据用**：
①我读 `kernel.stats.lastExpansionAttemptTick` 得"不存在"——**【R369 更正：这句也是错的，见 R369 第一节】**
我当时断言"正确键是 `kernel.lastExpansionAttemptTick`"，而 `git grep lastExpansionAttemptTick` 在**全仓只命中我这一行路线图文字**、`src/` 里 0 处
⇒ 那个键名压根不存在，真实存在的只有 `kernel.lastExpansionCompletedTick`（写者 `expansion/state-machine.ts:598`、读者 `expansion-manager.ts:65`、类型 `global.d.ts:820`）；
②我读 `rooms.W38S58.rcl` 得"不存在"，而同批 `rooms.W38S58.colonyState` 非空 ⇒ 是**我在猜 `Memory.rooms.X` 的字段名**，不是这房没了。
③`kernel.expansion` 的"不存在"倒是有真实代码解释：`expansion-manager.ts:39-45` 会把 state 不在 `EXECUTION_STATES` 里的旧版残留记录整枚置 `undefined`（防 `hasOtherExpansion` 恒真钉死管道）。⇒ 这条**留一次复判**：`kernel.expansion` 会在下一回 intel 刷新重建队列时重新出现；若长期不出现，再回来读这个清理闸。
**五、一个新事实（对本轮的两条线都关键）**：`cpuByHome` 现读只剩两枚 `{W37S58:4.416, W38S56:2.832}`，**W38S58 不在榜上**，
而 W38S58 的 Memory 条目与孵化请求都活着 ⇒ **不是丢房**。为什么它掉出按房 CPU 榜（EMA 只计有 assignment 的房？recovery 期不计？）**我没读写者就不下结论**，记为待判读。
另记一条对称：**同一个 10 房池子对 war 是全空（0 个有主房），对 expansion 却是全可用（扩张只要无主房）**
⇒ 池子的问题不是"小"，是**只朝一个方向有用**。

## 巡检 R369（10-06 11:3xZ / 03:3xZ UTC）——**撤我 R368 里那条"更正"**（它自己更错）；同时到手一条真正的生存级读数：**CPU 已经贴顶 ~33,700 拍**
**一、撤证（本会话第三次同族错，这次撤的是我用来撤别人的那条）**：R368 第四节①我写"正确键是 `kernel.lastExpansionAttemptTick`（`expansion-manager.ts:65` 读的就是这个形状）"。
现 grep：**`lastExpansionAttemptTick` 这个标识符全仓只命中我自己那行路线图文字，`src/` 里 0 处** ⇒ 那个键名从来不存在。
真实存在的只有 **`kernel.lastExpansionCompletedTick`**（写者 `expansion/state-machine.ts:598`、读者 `expansion-manager.ts:65`、类型声明 `global.d.ts:820`），现读 **83,328,457**（第三次扩张 W38S58 完成那一拍）。
**错法有名**：我是**凭半记忆的代码行**去"纠正"一个路径错，而不是先 grep 那个标识符。同族三错分别是
「猜引擎 API 名」「猜 `name(` 调用形状」「**猜 Memory 键名**」——第三种最阴，因为它由"我记得那行代码"支撑，读起来比猜更像读过。
已在原行就地标注（不覆写演变过程）。

**二、生存级读数（这条是本会话第一次读到 CPU 贴顶）**：
`kernel.capacity` = **`{"tier":"constrained","since":83425106,"upgradeTicks":0}`**，`lastSample≈83458845`
⇒ **`constrained` 档已持续 ≈33,739 拍**；同窗 `kernel.stats.cpuAvg10` = **19.5**（`limit=20` ⇒ **贴到 97.5%**），
而我 20 分钟前读到的是 15.5、R350 的切面总耗是 16.14。
**更要紧的是时序**：这个读数是 **war 结束后 ≈800 拍**取的（war 于 83458051 退场）——
不是战争期间的临时挤压，**仗打完了 CPU 反而更高**。⇒ 我上一轮那句"war 结束会松开约束"的隐含预期，被这一发否证了一半：
松开的只有扩张授权（`expansionAllowed=true`），**约束本身没松**。
（口径纪律照做：`cpuAvg10` 是每 10 拍采一次的滚动均值，`constrained` 是档位不是速率，两把都不当"每秒"引。）

**三、扩张今天为什么没动，仍然**不可归因**——而且现在能说清"为什么不可归因"）**：
候选供给不是问题（池子 10 个房、`warFunnel.unowned=9`，扩张只要无主房）；`expansionAllowed` 已是 true；`kernel.expansion` 不存在（`expansion-manager.ts:39-45` 会清理旧残留记录）。
闸的正文是 `expansion-manager.ts:56`：`if (ctx.budget.tier !== "healthy" && ctx.budget.tier !== "guarded") return;`
⇒ 但它吃的是 **`ctx.budget.tier`（词表 healthy/guarded/conserve/recovery）**，**与 `kernel.capacity.tier`（abundant/comfortable/tight/constrained）是两套轴**——
我**没定位到 `ctx.budget.tier` 的生产者**（两次 grep 都打空），所以**不能说"因为 constrained 所以扩张被挡"**，只能说两把都在收紧的方向上。
而且 :56 这一支的早退**在 Memory 里不留拒因**（同族问题＝#64"第 6 档拒因无处可计"、R341"六个拒因计数器是 heap-only"）：
⇒ 今天"扩张没发生"在 **(a) budget 档 (b) 队列重建还没跑 (c) 旧残留清理闸 (d) 别的合取项** 之间**四者都能吃下这个读数**。
这就是 #94（`994bf542`，未推）与 #97 那条"标定/拒因列"要买的东西——**它不是加分，是把这四选一变成读数**。

**四、下一读（零部署、有名字、别再凭记忆）**：
1. 先 grep 生产者再读数：`git grep -nE "budget\.tier *=|tier: (\"|')" -- src/kernel src/systems/kernel`（把 `ctx.budget.tier` 的**来源文件**钉住，然后看它有没有落 Memory/段）；
2. `peek kernel.expansion` 复判：`expansionAllowed=true` 之后它会不会在下一次 intel 刷新时重新长出记录（长期不出现→回去读 :39-45 那把清理闸是否误杀活记录）；
3. `cpuAvg10` 与 `capacity.since` 各再取两发，看 19.5 是 war 尾波还是稳态（**没两发同形之前不做趋势**，`capacity.since` 是档位沿、可直接判"何时进入 constrained"）。

边界：本轮**不改任何阈值**（贴顶不是降闸的理由，恰恰是 #50 那条属人选择被现场量实了）；零 src、零 push、零 build、全只读 API。

## 巡检 R370（10-06 11:4xZ / 03:4xZ UTC）——**扩张为什么不推进，第一次有读数而不是推断**：唯一失败的门是 **G6（CPU 档位）**，全链逐环核完
03:45Z 只读现读（同工具、同批）：
`kernel.expansionDashboard.failedGates` = **`["G6: CPU tier(v=constrained|tier ≤ comfortable)"]`**
`kernel.expansionDashboard.summary` = `"Expansion Dashboard @83458984 | Pressure=HIGH(0.69) | Readiness=NOT_READY | Blocked=G6 | Budget=372183/1005900 | Candidates=13(Q=4,R=8,U=1) | Plans=4 active, 0 waiting | Top=W39S56(EVALUATED)"`
`kernel.expansionPlans.length=5`（1 张 `CANCELLED`＋**4 张 `EVALUATED`**，`rd`（=`readySince`）**四张全部不存在**）、`kernel.expansionCandidates.length=10`、`kernel.capacity={"tier":"constrained","since":83425106}`。

**一、逐环闭合的因果链（每一环都有位点或读数，不再有任何"我猜"）**
1. `expansion-manager.ts:56/57/59/62/63` **五把早退闸今天全开**：`CpuTier` 是 **bucket 阈值表**（`config/index.ts:121-124`：healthy≥7000 / guarded≥3000 / conserve≥1000），现读 bucket=**10000** ⇒ 档 = `healthy` ⇒ :56 通过、:57（bucket≥5000）通过；
   `expansionPausedUntil=83341372`（已过期 ≈117,700 拍）⇒ :59 通过；`strategy.expansionAllowed=true`（R368）⇒ :62 通过；
   冷却 `cooldownTicks=10000`、`lastExpansionCompletedTick=83,328,457`（早 ≈130,500 拍）、`activeExpansionCount=0`（`kernel.expansion` 不存在）⇒ :63 通过。
2. 于是执行侧唯一该干活的是 `tryConsumePlan`（`plan-adapter.ts:33`），它只消费 **`WAITING_EXECUTION`** 的 Plan ⇒ **现读 `0 waiting`，队列里没有任何可消费的 Plan** ⇒ 阻塞点根本不在执行侧。
3. 往上：`WAITING_EXECUTION` 只由 `expansion-planner.ts:218-230` 从 **`READY`** 晋升（`explainDecision` 判 APPROVE），而我那 4 张 Plan 停在 **`EVALUATED`**。
4. 再往上：`EVALUATED → READY` 由 `applyHysteresis(p, isReady, tick)`（`plan-lifecycle.ts:132-141`）驱动，需要 `isReady` 连续攒够 **`upgradeTicks=500`**（`:39-44`）。
   **`rd`（=`readySince`，序列化位 `expansion-planner.ts:318`）四张全不存在 ⇒ `isReady` 此刻为假、且每趟 pass 都从零重来**（累计从未开始，不是"攒到一半"）。
   同一条也解释了那行"ready 已累计 …t/500t"的停摆可见性日志为何沉默：它的过滤条件正是 `readySince !== undefined`。
5. `isReady = extendedReadiness.allPassed && readiness.readiness !== "NOT_READY"`（`:200`）⇒ 读数直接点名：**`Readiness=NOT_READY`、`Blocked=G6`**，且 `failedGates` 数组里**只有 G6 一枚**。

**二、今天的读数同时纠正我这两天两次说法（两个方向都错了一点，分开记）**
- R368 说"war 尾税不是阻塞" ⇒ **成立**（五把早退闸全开、`expansionAllowed=true`），但当时我只证到"授权没被锁"，没找到真闸在哪。
- R369 说"不能说 constrained 挡扩张，因为 `ctx.budget.tier` 与 `capacity.tier` 是两套轴" ⇒ **那句 hedge 是对的、结论却是低的**：挡扩张的确实**不是** :56 那把 bucket 档闸，
  而是**就绪度里的 G6 直接吃 `capacity.tier`**（`tier ≤ comfortable`）。⇒ 同一个 `constrained` 走的是**另一扇门**进决策。
  这正是本仓反复出现的那族错：**一名两义/一量多门**——我按"哪把闸用哪个词表"去排除，排得对，但据此把 CPU 这条因排除掉了，就是过头了。

**三、可执行的含义（属人，我不选路，但把数算出来）**：G6 要 `tier ≤ comfortable`（`avg10 ≤ 12` 那档），现读 `cpuAvg10=19.5`、`capacity.since=83425106`（constrained 已 ≈33,900 拍）。
⇒ 以 `cpuAvg10` 为口径，进入 comfortable 需 **−7.5/t**；而 R350 量过的系统侧**整榜砍光**才 ≈−2.9/t（traffic-manager 那 5.62/t 是 G6 定案的结构性成本）。
**缺口比最大可得节省大 ~2.6 倍** ⇒ 这不是"再省一点"能过的门，是 #50 那条属人选择（接受长期 constrained 并换判据 / 或买 CPU 槽、或结构性缩编制）。
**我不会为了过 G6 去降任何闸**（自败回路）。

**四、两条留给下一发的自核项（都别当已证）**：
①`summary` 说 `Candidates=13(Q=4,R=8,U=1)`，而 `kernel.expansionCandidates.length=10`——两个数不同刻、且 dashboard 的 13 可能含别的桶 ⇒ **先读 `Candidates` 的分桶口径再判是不是仪表说谎**（本仓这类"同一屏两个数"错过两次）。
②`Pressure=HIGH(0.69)`：压力高与我今天读到的 recovery 房（W38S58）是否同源，未读 `pressure.dimensions` ⇒ 不下结论。

## 巡检 R371（10-06 11:5xZ / 03:5xZ UTC）——**本会话第一条生存级读数：W38S58 已经不再是我们owned的房了，而领土机器从头到尾没参与**
**起点是一个"仪表停了"的旁证**：R369 读到 `cpuByHome` 只剩 `{W37S58, W38S56}`，W38S58 掉榜。当时我写下"不读写者就不下结论"。这一轮按纪律把它查到底。

**一、Memory 侧（只读 peek，控制组同批）**：
`rooms.W38S58.colonyState="recovery"`、`colonyStateSince=`**`83431754`**（⇒ 已 **≈27,351 拍**）；
`rooms.W38S58.economy.t=`**`83444420`**（⇒ 经济快照**已 14,685 拍没被写过**）；`spawnQueue.length=3`（首条是 `upgrader/priority=1/home=W38S58`）。
**控制组**（同工具同形状）：`W37S58.economy.t=83459079`、`W38S56.economy.t=83459068`（都只落后二三十拍、`colonyState="normal"`）
⇒ **仪器在全帝国范围内是活的，只有 W38S58 这一路停了**——不是 `energyLedger` 那种"创建戳被误读成新鲜度"的假案。

**二、线上侧（一发只读 console 探针，两次独立表达式互证）**：
`Game.rooms.W38S58.controller` → **`my:false`、`level:0`、`owner:false`**（第一次探针 `ctrlOwner="undefined"` 同向）；
`spawnsInW38S58=1`（**我们的 spawn 还在里面**）、`creepsHomeW38S58=`**`0`**、全局 `creepsTotal=33`；
`Memory.rooms` 只有 **`W37S58,W38S56,W38S58`** 三枚；`Game.gcl.level=5`、我方 spawn 总数 7。
⇒ **这个房现在无主**：控制器掉到 RCL0、没有 owner，而我方建筑还留在场内。

**三、"是不是我们主动放弃的"——已否证**：`releaseAt` 这个标记**只有领土机器主动释放时才写**
（`src/systems/empire/territory-manager.ts:112-114`：`releaseAt` 是下游"别再为这房花钱"的标记；`migrations/late.ts:430` 只清洗非有限值）。
现读 **`rooms.W38S58.releaseAt` 不存在** ⇒ **不是一次有记录的释放**。
对照 W37S55（那是走完释放链、房已从 Memory 摘掉的形态）。
⇒ 所以形状是：**claim 掉了，而帝国的"哪些房归我"模型仍然把 W38S58 当自有房在维护**（recovery 态、孵化队列都还挂着）。

**四、与恢复链对上（这条把 #139/#110 从"读数形状"接到了一个真实结局上）**：
本会话早些时候读到的 `kernel.escalations[0]` = `{room:W38S58, actionType:population_rebuild, repeats:17, terminal:true}`（另一条 global 的 `repeats=27`）
⇒ **恢复系统为这个房反复补员 17 次、最终判 terminal**。今天看到的 `creepsHomeW38S58=0` 就是那个 terminal 之后的稳态：
没有 creep、没有经济写入、房无主、spawn 留下。

**五、能证明的与不能证明的，分开写**：
✔ 已证：**此刻** W38S58 无主（两次探针同向）；Memory 仍把它当自有房（无 `releaseAt`、队列在跑、recovery 态）。
✔ 已证：经济仪器对这一路已停 14,685 拍，而全局仪器正常（控制组）。
✘ **未证**：claim **具体何时**丢的。`economy.t` 停在 83444420 只给一个上界假设（"写入停是因为不再 owned"），
  两者相关性合理但没独立证据；`colonyStateSince=83431754` 是"进入 recovery"的时刻，不是"丢房"的时刻。
✘ **未证**：`cpuByHome` 掉榜的确切口径（EMA 只计有 creep 的房？还是 recovery 期不计？）——现在有了自然解释候选（0 creep ⇒ 无归属 CPU），
  但我仍没读写者那一行，不当结论。

**六、下一轮该问的问题（属人，我不代答）**：领土机器只处理"主动释放指令"，**没有任何一条路径处理"claim 意外消失"**
⇒ 后果是三件：①留在无主房的 spawn 是死资产（还占 `Game.gcl.usedSpaces`）；②`Memory.rooms` 里挂着一个永不满足的 recovery/孵化队列；
③它同时还在给扩张让路（G6 因为 CPU 被这些结构性开销占住而判 `constrained`，见 R370/#50）。
要不要现在回收这枚 spawn、要不要给"丢房"补一条检测与清算路径，属 L0 的资产处置与领土政策——**我只把形状与账目摆出来**。

边界：本轮**零改码、零 push、零 build、零拆除动作**（探针是纯读表达式；未对任何结构做 destroy/dismantle）；
`.gitignore` 与两份未跟踪文档仍未 stage。

## 巡检 R372（10-06 11:5xZ / 03:5xZ UTC）——把 R371 那笔"死资产"换成清单，并**把因果从假设升成代码行**：丢 claim 会让这个房对自己的收支仪器当场隐形
**一、清单（一发纯读探针，全 `FIND_MY_STRUCTURES`，未做任何拆除）**：
`W38S58` 里我方建筑 = **`{storage:1, spawn:1}`**；
`Spawn7`：**`busy:false`（闲置）**、背包/`store[RESOURCE_ENERGY]=292`（连一次像样的孵化都凑不齐）、`hits 5000/5000`；
`storage`：**`store[RESOURCE_ENERGY]=0`（空）**、`hits 10000/10000`；`mySites=0`（无在建）；`controller.level=0 / my=false`；
`Game.creeps` 在该房：**两次探针分别 1 只与 0 只** ⇒ 那是路过，不是驻守（与 `creepsHomeW38S58=0` 一致）。
⇒ 满血＋无在建 ⇒ **不是被打掉的痕迹**（PvP 拆毁这条今天没有证据），形状更像"没人升级控制器 ⇒ 降级到无主"。

**二、我自己两条没撑住的话，当场撤**：
①我上一轮写完清单立刻推了一句"RCL0 ⇒ storage 该开始 decay"——**读回来是 `ticksToDecay = undefined`（两枚都是 null）** ⇒ **当前没有任何衰变计时**，那句撤。
（顺带说明我为什么会推错：这是 `#131` 那族"寿命量不在决策面"的镜像——**我自己也没读那个属性就下了结论**。）
②"该房有 1 只我方 creep"在下一发探针里变成 0 只 ⇒ 路过不是驻守；引它当"驻守证据"不成立。

**三、★因果闭合（这条是本轮真正的收获，且它是"自遮蔽"的形状）**：
`src/systems/room/economy.ts:62-63` 逐字为
`const owned = room.controller?.my === true; if (!owned && !remoteTargets?.has(room.name)) continue;`
⇒ W38S58 现在 `controller.my=false` 且不是远矿目标 ⇒ **收支采样循环直接跳过它** ⇒ `roomMem.economy` 不再被写。
这正是 R371 里我标为"相关性合理但没独立证据"的那一环——**现在它有了出处**：
`economy.t` 停在 83444420 与"claim 消失"不是巧合，而是**同一个条件成立的两面**。
⇒ 系统性的说法：**帝国的资产观察口径挂在"控制器归我"上，所以 claim 一消失，这个房立刻对自己的收支仪器隐形**——
仪器停写的时刻恰好是异常开始的时刻，**这条路径天生不会报警**。
领土侧也没有"意外丢房"分支（R371：`releaseAt` 只由主动释放写，`territory-manager.ts:112-114`）。
两处合成一个缺口：**丢房这个事件在机器内部既不被检测、也不被记账，只表现为"某房的仪器安静了"**。

**四、这改变了 #116 那笔账的形状（但我不改处置建议——那属人）**：
既然无衰变计时，那枚 spawn＋storage 目前**不会自己消失**，会长期占着 `Game.gcl.usedSpaces`（现读我方 spawn 共 7 枚 vs `gcl.level=5`）；
而它的收支、孵化队列（`Memory.rooms.W38S58.spawnQueue.length=3`，首条 `upgrader/p1/home=W38S58`）与 `colonyState=recovery`
都还留在 Memory 里被"自有房"口径处理 ⇒ **模型把它当房，仪器已经不当它算账**。
下一发要补的读数（零部署）：①`Spawn7` 是否仍在被 `spawn-manager` 派单（读该房队列条目的 `createdAt` 式字段是否推进）；
②`remoteTargetRooms` 里有没有 W38S58（决定它是否还能被任何循环看见）；③`storage` 空＋满血——它归谁维护。

边界：零改码、零 push、零 build、零拆除动作；探针全是纯读表达式；`.gitignore` 与两份未跟踪文档未 stage。

### 3.0 附表（R373 续，04:03Z）——**孤儿建筑普查：我方 7 枚 spawn 里有 3 枚在"控制器不归我"的房**，顺带把我自己两个仪器错一次修掉
**★一发纯读探针（`orphanSpawns` 直接按 `s.room.controller.my!==true` 过滤算出）**：
`orphanSpawns = **Spawn4@W37S55, Spawn3@W37S55, Spawn7@W38S58**`；`spawnsTotal=7`、`gclLevel=5`。
⇒ **帝国 43% 的 spawn 产能在不属于自己的房里**。两种丢法各占一半：
W37S55 那两枚是**主动释放**留下的（项目记忆 `territory-release-single-room-core` 记那次释放线上验证过，本会话未重读——按"文档记着"引，不按"我今天读到"引），
W38S58 这枚是 R371-R372 证的**非主动丢 claim**。
⇒ 系统性说法（比 #116 原文更准）：**两种"房不再归我"的路径都不带资产清算**——一条走完释放链仍把 spawn 留在场内，另一条连释放都没发生。
`#118`（W37S55 那 2 枚无人认领的 spawn，pending 属人）今天拿到的不是新证据而是**同一件事的第二例＋一份带名字的普查**：
现在可以一次决定"这三枚怎么办"，不必分两次。

**★两个我自己的仪器错，同轮修掉（这正是我上一节撤证要买的账）**：
①上一发我写 `Game.ConstructionSite` 取到 **0**——**那是名字错的产物**：正确全局名是 `Game.constructionSites`
（本轮 `typeof` 出 `"object"`、`Object.keys(...).length=`**`21`**）。我把 `||{}` 写进探针让它"不报错"，
于是**一个错名被涂成了可信的 0**——这类"防御性写法把名字错降级成读数"的shape，比抛异常更危险，记进方法论。
⇒ 真实值：**帝国在建工地 21 个**（这与 G6 挡扩张并不矛盾：工地消耗能量与 CPU，是"发展"侧的活账）。
②`Game.gcl.usedSpaces` 本服**不存在**：`Object.keys(Game.gcl)` = **`level,progress,progressTotal`**。
⇒ 我上一轮那句"占 `gcl.usedSpaces`"不只是没测，是**引了这台机器上没有的属性名**；
要算"建造名额"得换量（工地数 21 / `gcl.level` 5），不能用 `usedSpaces`。
③再自纠一发：本轮探针里我把字段命名成 `orphanStructs` 而表达式其实是 `Object.keys(Game.structures).length`＝**我方全部建筑 345 枚**（不是孤儿数）。
名字又不等于量——**同一族错我在 60 秒内犯了第三次**，所以这条一律写"名与量必须逐条对"，不靠自觉。

**边界**：全只读表达式（未 destroy/dismantle/reclaim/改 Memory）；零 src、零 push、零 build。
**下一发（若仍零部署）**：给这三枚 spawn 出一份资产账（`hits`、`store` 能量、是否仍被派单、其房内我方建筑清单），
把"43% 产能搁浅"从计数变成可拍板的处置清单——仍**不代做处置决定**。

## 巡检 R374（10-06 12:0xZ / 04:0xZ UTC）——**处置清单补齐，同时把我自己 ticket 里的量级错翻了 34 倍**：主动释放那房留下的是 69 枚建筑，不是"2 枚 spawn"
一发纯读探针（逐枚过滤 `controller.my!==true` 的 spawn 并带上其房内我方建筑数），三枚全齐：

| spawn | 房 | 控制器 | `hits` | 自身能量 | 孵化中 | **该房我方建筑数** | 该房 creep |
|---|---|---|---|---|---|---|---|
| `Spawn4` | W37S55 | `my=false / level=0 / owner=null` | 5000/5000 | 300 | 否 | **69** | 0 |
| `Spawn3` | W37S55 | 同上 | 5000/5000 | 0 | 否 | **69** | 0 |
| `Spawn7` | W38S58 | 同上 | 5000/5000 | 292 | 否 | **2**（spawn＋storage） | 0 |

**一、★翻自己的案（量级错，不是结论错）**：#118/#108 的标题一直写"W37S55 留有 **2 只**无人认领的我方 spawn"。
"2 只 spawn"是对的，但**该房实际留着 69 枚我方建筑**——按本会话早先读到的全帝国土木 `Game.structures` 总数 345 枚算，
**≈20% 的帝国建筑在一个我们已经主动放弃的房里**，而这条账此前**从没人记过**（包括我）。
⇒ 结论没变（释放链不清算资产），**数量级错了一个半到两个数量级**。凡是拿"2 枚"去估回收价值的，都偏低到没有意义。

**二、两种丢法在"看得见/看不见"上正好互补（这条比总量更要紧）**：
- **W37S55（主动释放）**：`Memory.rooms` 里**没有这枚房**（现读只有 `W37S58,W38S56,W38S58`）⇒ **69 枚实体资产在模型里完全隐形**，
  不消耗 CPU、不产生决策，但也不会计价——它是一笔"账外资产"，好坏都无人知晓。
- **W38S58（非主动丢 claim）**：`Memory.rooms` 里**还在**（recovery 态＋3 条孵化队列），但收支写者 `economy.ts:62-63` 已把它跳过
  ⇒ **模型说它是房、仪器说它不算账**——它是一笔"记在错科目上的资产"，仍在被决策引用（这也是它比 W37S55 更危险的原因）。
⇒ 同一句"没有资产清算"在两边表现为相反的失败形状：**一边是漏记，一边是错记**。要补的机器也不同
（前者需要"离场房的实体清单"，后者需要"claim 消失事件"）。

**三、可立刻算的成本（不是推测）**：三枚 spawn 全部 `busySpawning=false`、能量 300/0/292（都低于任何可用 body），
`hits` 满血 ⇒ 既不产 creep 也没被打；W37S55 那 69 枚按本服常量（storage 一律 1M 容量、extension 等各自造价）
若要估回收/复占价值，**必须先拿到那 69 枚的类型分布**（本探针只数了个数，没分类——别拿 69 直接当 69 枚 extension）。

**四、下一发（零部署，都带名字）**：①`Game.rooms.W37S55.find(FIND_MY_STRUCTURES)` 按 `structureType` 分组计数，把 69 拆开；
②W38S58 的 `Spawn7` 是否仍被派单（`Memory.rooms.W38S58.spawnQueue` 条目时间戳是否推进）；③`Game.gcl` 无 `usedSpaces`（R373 已证），
建造侧改用 `Object.keys(Game.constructionSites).length`（现读 **21**）。
**处置仍属人**：拆 / re-claim / 留着，我一件都不代做；本轮全只读、零改码、零 push、零 build。

## 巡检 R375（10-06 12:0xZ / 04:0xZ UTC）——69 枚分类到手，结论比"20% 土木"严重得多：**帝国的工业与防御骨干有 3～5 成搁浅在一个模型里已经不存在的房**
两发纯读探针（①按 `structureType` 分组数 W37S55/W38S58；②按 `controller.my===true` 数自有房同表＋`Game.structures` 全帝国总量）。

| 类型 | 全帝国 | 自有房（W37S58 / W38S56） | **搁浅 W37S55** | **搁浅 W38S58** | 搁浅占比 |
|---|---|---|---|---|---|
| terminal | 2 | 1 / 0 | **1** | 0 | **1/2 = 50%** |
| factory | 2 | 1 / 0 | **1** | 0 | **1/2 = 50%** |
| extractor | 2 | 1 / 0 | **1** | 0 | **1/2 = 50%** |
| lab | 16 | 10 / 0 | **6** | 0 | **6/16 = 38%** |
| link | 12 | 6 / 2 | **4** | 0 | **4/12 = 33%** |
| tower | 11 | 6 / 2 | **3** | 0 | **3/11 = 27%** |
| storage | 4 | 1 / 1 | **1** | **1** | **2/4 = 50%** |
| extension | 143 | 60 / 30 | **50** | 0 | 50/143 = 35%（另有 **3 枚未归位**，见下） |
| spawn | 7 | 3 / 1 | **2** | **1** | 3/7 = 43% |

**一、闭合式自核（这类总量差必须当场对）**：`lab 10+6=16 ✓`、`link 8+4=12 ✓`、`tower 8+3=11 ✓`、`storage 2+1+1=4 ✓`、`spawn 4+2+1=7 ✓`、
`terminal/factory/extractor 1+1=2 ✓` ⇒ **每一类都对得上**，不是"两边各数一半"的口径错。
**唯一没闭合的是 extension**：自有 90 ＋ 搁浅 50 ＝ **140**，而全帝国 **143 ⇒ 尚差 3 枚没有归位**。
可能去处（**都没验，不许当解释**）：无视野房里的我方建筑、或某房 `find` 未覆盖。**留下一发**：按 `Game.structures` 逐条打 `pos.roomName` 做全清单，那 3 枚自然现形。
（另记一笔形状：`Game.structures` 的类型表里出现 `controller:2`——控制器通常不在 `Game.structures` 里，本服这条我**没核**，不据它推任何东西。）

**二、这条为什么比"20% 土木"严重**：搁浅的不是零散杂物，而是**唯一的第二套工业复合物**（terminal/factory/extractor 各占帝国一半、labs 38%、links 33%），
外加 **3 座塔（防御 27%）**。而 W37S55 **不在 `Memory.rooms` 里**（现读只有 `W37S58,W38S56,W38S58`）
⇒ **这些产能对帝国模型完全不可见**：既不会被调度使用，也不会被算进任何"我有多少工业/防御"的判断。

**三、⚠️这是一条要回炉旧结论的线索，不是新结论**：#44（factory 不产商品＝缺基础矿＋level undefined）、#51（缺料自锁已拆但发布需求以正 ROI 合闸）、
#111(B)（留能靠 terminal）、#130（市场线双向、credits ≈19.83M）——这些判据当年默认"帝国的那套工业设备在自有房里"。
现在知道**一半的 terminal/factory/extractor 与 6 个 lab 在一个已放弃的房里、模型看不见它**
⇒ 若某条"设备没跑起来"的结论当初是靠"设备清单"推的，**分母可能一直是错的**（例如把 W37S58 的 1 套当成帝国唯一 1 套）。
**本轮不去翻案**：W37S58 那套是否真在跑、这些搁浅设备历史上是否曾为帝国产出，都要现读与账本核对才敢说。
下一发该做的：**给 #44/#51 各补一条"工业产能分母"的读数**（自有房内 lab/factory/terminal 的 `store`、`myCooldown`、`level` 与产出计数），
先确认"帝国的可用工业面"到底有多大，再谈要不要把搁浅的那半捡回来。

**四、处置仍然属人**（一件都不代做）：这三枚 spawn／69 枚建筑要拆、要 re-claim、还是留着；
以及领土/扩张政策要不要因此改（W37S55 是**主动释放**却没人清算，W38S58 是**被动丢房**且模型还当它是房）。
本轮零改码、零 push、零 build、全只读表达式（未 destroy / 未 re-claim / 未清 Memory）。

## 巡检 R376（10-06 12:1xZ / 04:1xZ UTC）——**资产账闭合**：帝国实际只控制 2 个房，却有 21% 的建筑躺在 3 个不属于自己的房里，而 Memory 说我们有 3 个家
两发短探针（上一发因表达式过长被服务器拒收：`{"error":"expression size is too large"}`——记一条工具形状：**探针要拆短，别把三件事塞进一次求值**）。

| 房 | `controller.my` | level | 我方建筑 | spawn | 在 `Memory.rooms` |
|---|---|---|---|---|---|
| W37S58 | **true** | 8 | 178 | 3 | ✅ |
| W38S56 | **true** | 5 | 93 | 1 | ✅ |
| W37S55 | false | 0 | **69** | 2 | ❌ |
| W38S58 | false | 0 | **2** | 1 | ⚠️ **在**（幻影房） |
| W38S59 | false | 0 | **3** | 0 | ❌ |

**一、账闭合（这次真的闭合了）**：`178+93+69+2+3 = 345` ＝ 早先 `Game.structures` 全帝国总数 ✓；
extension `60+30+50+3 = 143` ✓（**R375 那 3 枚未归位的 extension 全部在 W38S59**）；spawn `3+1+2+1+0 = 7` ✓。
⇒ R375 留下的唯一残差**就地清零**，不用再留判读位。

**二、读出来的三句话**：
1. **真正控制的房＝2 个**（W37S58 RCL8、W38S56 RCL5），`gcl.level=5` ⇒ 名义上限 5、实有 2。
2. **21.4%（74/345）的我方建筑在 3 个不属于自己的房里**，且三类各不相同：W37S55 是主动释放留下的成套工业复合物（R375 表：工业三件套各半、lab 6、塔 3）；
   W38S58 是被动丢 claim（spawn＋storage）；**W38S59 是第三型——3 枚 extension、0 spawn、无 Memory 条目**，
   正是 `expansion-manager.ts:47-50` 注释里点名的"W38S59 事故（owned 无 spawn 的房不在扩张状态机覆盖内）"——**如今它连 owned 都不是了**，
   而那场事故的现场还留在地图上。
3. **Memory 与实际差一**：`Memory.rooms` 有 3 枚（含 W38S58），实际自有 2 枚 ⇒ 有一处**幻影房**仍在被 recovery／孵化队列逻辑引用（#116）。

**三、为什么这条比"丢了个房"更值钱**：它同时给出三件事的**分母**——
①工业可用面（自有房内：ext 90、lab 10、塔 8、terminal/factory/extractor 各 1；搁浅的那半见 R375）；
②GCL 余量（2/5 用）；③领土机器的真实输入（它以为自己是 3 房帝国）。
⇒ #44/#51/#111(B)/#130 的"工业/终端"判据若要重算，**分母就是这一行**；本轮不去翻案（见 R375 第三节的界线）。

**关联票**：#116（W38S58 丢 claim＋自遮蔽仪器）、#108（孤儿 spawn 普查，量级已翻案成 69/3 型）、#50（G6 挡扩张）、#114（war 无候选）。
边界：零改码、零 push、零 build、全只读表达式；未 destroy / 未 re-claim / 未清 Memory。

## 巡检 R377（10-06 12:1xZ / 04:1xZ UTC）——R375 那条"分母可能要重算"的线索就地收口：**自有房的工业设备同样是闲着的**，所以"捡回搁浅那半"不再是产能问题
一发短探针（W37S58，`FIND_MY_STRUCTURES` 内取 factory/lab）：
`factory.store` = **只有 `energy`**、`process` = **`null`**（没在产任何商品）；
`labs` = **10 枚里只有 1 枚有内容物、0 枚在冷却**；`factory.level` 这一发**没有序列化出来**（值为 undefined ⇒ JSON 直接丢键）。

**一、结论（对处置账的直接影响）**：R375 我留了一句"若某条'设备没跑起来'的结论是靠设备清单推的，分母可能一直是错的"。
现在答案有了，而且方向相反于"丢了房才没工业"：**自有房内那套 terminal/factory/extractor/10 lab 同样处于闲置**。
⇒ 搁浅在 W37S55 的那半工业复合物（R375：终端/工厂/萃取各半、6 lab、3 塔）是**闲置的冗余**，不是"缺的那半产能"。
⇒ **re-claim 的正当理由不再是"恢复工业"**——要恢复工业，得先让**已经在手的那套**跑起来（那是 #9/#44/#51 的老问题：缺基础矿与正 ROI 闸）。
这条同时给 #44/#51 补一发复证：**当下现场仍是"零产出"**（1/10 lab 有内容、0 在冷却、factory `process=null`）。

**二、一个新冒出来的疑问（不定罪，交给 #51）**：本发里 `factory.level` 取不到值（undefined）。
#51 那支当初定的是"**私服** factory level undefined"并已修（`c6cceb2`/`7274bb4` 两支已上线）。
⇒ 要么本服这个属性也不存在（引擎形状）、要么那次修复的假设在这里同样成立——
**我没读 `@types` 里 `StructureFactory.level` 是否存在就下不了判断**，所以只登记现象、不改 #51 的结论。
下一发该做的：先 `grep @types` 核属性名，再决定要不要把 #51 的"已修"重开。

**三、这一串（R371→R377）在客观上说了什么**：丢了一房没人察觉（#116）、21% 建筑与一半工业复合物搁浅在三个非自有房（R375-376）、
自有工业闲置（本发）、扩张被 G6 单点挡死（R370/#50）、战争开过三轮却从未有过一个有主敌房的情报（#114）。
⇒ 五件事互相独立成账，共同的根只有一条：**这台机器对"资产与领土的实际状态"没有可靠的账本**——
不是某个闸调错，而是"我们到底有什么、还剩下什么"这一问当前只能靠人到线上读。
本轮起我给的每一份数（345/74/21.4%/143/69/3）都是这样读来的，都带票号。

边界：零改码、零 push、零 build、全只读；未 destroy / 未 re-claim / 未清 Memory（三枚 spawn 与 69＋3 枚建筑的处置仍属人）。

## 巡检 R378（10-06 12:1xZ / 04:1xZ UTC）——**#51 的前提被 @types 掀掉**：`factory.level`  undefined 不是引擎异常，是契约里的可选字段，语义是"这台工厂从未被 `PWR_OPERATE_FACTORY` 操作过"
**一、逐字读到的契约**（`node_modules/@types/screeps/index.d.ts:6698-6712`，`interface StructureFactory extends OwnedStructure<STRUCTURE_FACTORY>`）：
`level?: number` ——**可选**；注释原文："*The level of the factory. Can be set by applying the `PWR_OPERATE_FACTORY` power to a newly built factory. Once set, the level cannot be changed.*"
同接口的 `produce(...)` 返回码表里明写 **`ERR_BUSY: The factory is not operated by the PWR_OPERATE_FACTORY power.`**
（另注：我前两发 grep 用了 `class StructureFactory` 去打，所以打空——**这个类型是 `interface` 不是 `class`**，同族"形状错"第四次，记进探针纪律。）

**二、这条为什么把两票接上了**：项目记忆与本表 §3.7/#130 都记着 **`gpl=0`**（全球功率为零，"机器全在、缺的是第一次跑通"）。
按上面的契约，`gpl=0` 不只是"Power 那一柱没成绩"——**它把工业柱的一条具体路径直接锁死**：
没有 `PWR_OPERATE_FACTORY` 操作过的工厂**永远没有 level、`produce()` 永远 `ERR_BUSY`**。
⇒ 于是 R377 那条"自有房 factory 只有 energy、`process=null`、1/10 lab 有内容"的现场读数，**至少有一个不依赖市场行情的解释**：
不是"行情不合闸所以不产"，而是**引擎层面就不可能产**（除非先有 GPL）。
⇒ **#51 的原判语要改**：它当年把"私服 `level` undefined"当成待修异常并判"已修（`c6cceb2`/`7274bb4`）"。
`level` 可缺是契约态；代码能修的只是"别把缺 level 当成可生产"，**修不出 level 本身**。
本轮**不重开 #51 的结论**（要重开得先读那两笔改动到底改了什么），只把"undefined 属正常态"这一条钉在这里，
防止下一次有人拿 `level` 当回归判据。

**三、跨柱依赖（这条最该进 L1 的排序）**：`#130 Power（gpl=0）` → `#44/#51 工业商品线` → `#111(B)/#130 变现与留能`。
⇒ 若确实如此，**"要不要打 Power Bank / 开 POWER"就不再是 §3.7 一柱的独立选项，而是工业线的前置**。
这条我**没有**用现场证据证明"我们从没操作过工厂"（那要读 `Game.powerCreeps`/历史事件环），
下一发该做的：现读 `Object.keys(Game.powerCreeps)` 与其 level/ops，和 `#130` 的"第一次跑通"判据对上；对不上就撤本条第三节。

**四、#115 的判据本身被我这轮证伪了一半（方法论，不是读数）**：
`intelCoverage.tick` 现读 **83459503**（上一发 R367 是 83457203，`lastSample=83459505` ⇒ 距沿仅 2 拍）。
跨度 +2300＝23 个周期，但**这个仪器只存最后一次落盘值** ⇒ **+2300 既可能是 23 发全中、也可能是前 22 发全丢、只有最后一发落地——两者读数完全相同**。
⇒ 我用"两次读数之差是 100 的几倍"数丢沿的方法，**只在跨度小于一个周期时成立**；跨度一大就瞎。
所以今天所有"+400＝丢三批"这类话只能算**下界**（丢的次数 ≥ 可见跨度/周期 − 1），不能当计数。修法（补跑式）不变，立案强度按这个下界读。

边界：零改码、零 push、零 build；线上动作只有只读 API 与两发纯读表达式。

## 巡检 R379（10-06 12:1xZ / 04:1xZ UTC）——R378 第三节的跨柱依赖**由推断升成读数**：`powerCount=0`、`gpl={level:0,progress:0,progressTotal:1000}`
04:19Z 一发只读探针：`Game.gpl` = **`{level:0, progress:0, progressTotal:1000}`**；`Object.keys(Game.powerCreeps).length` = **`0`**。

**一、这条把三件事钉住了**（都是读数，不再是推理）：
1. 我方**从未拥有过任何 power creep**（`powerCount=0`）⇒ `PWR_OPERATE_FACTORY` 从未可操作过任何工厂。
2. 接 R378 的契约（`level?` 只能由该功率设定）⇒ **`factory.level` 为 undefined 不是"异常已被修好"也不是"私服形状"，
   而是在 GPL=0 下唯一可达的状态**；`produce()` 在此状态下按定义返回 `ERR_BUSY`。
3. ⇒ **#44/#51 的"工厂不产商品"由此有了一条引擎级根因**，它**既不由行情闸控制、也不由任何代码修复**：
   要通，先得有 GPL 与一枚 power creep。R377 现场（自有房 factory 只有 energy、`process=null`、1/10 lab 有内容）与此完全自洽。
   ⇒ #130（§3.7 Power）不再是一柱的独立选项，而是**工业商品线的前置**——这条现在可引用（有出处：本发探针＋`@types:6698-6712`）。

**二、并上的资产账**（接 R375/R376）：全帝国建筑里有 `powerSpawn:1`、`observer:1`、`nuker:1`（R375 第二发的类型总量表）
⇒ **功率机器在场、GPL 为零**：拥有需要功率才能运转的设施，却从未产生过功率。

**三、我**不**解释的部分（写清楚，别让它长成故事）**：W37S58 是 **RCL8**，而 `gpl.progress=0/1000`。
本服的 GPL 产生条件（哪些结构/等级会产 GPL、是否需要 `observer`/`powerSpawn` 参与、是否按拍累加）**我没查过 @types/官方规则**
⇒ 只登记"高 RCL 与零 GPL 并存"这一对读数，**不推断"哪台机器该产而没产"**，也不据此动任何配置。
下一发（零部署）：读 `@types` 与官方文档里 GPL 的产生条件，再判这 0/1000 是"从未有来源"还是"有来源但被闸停"。

边界：零改码、零 push、零 build、线上动作只有只读 API 与纯读表达式；未 destroy / 未 re-claim / 未清 Memory。

## 巡检 R380（10-06 12:2xZ / 04:2xZ UTC）——"工厂为什么不出商品"的**完整依赖链**，其中最后一段是代码缺口、与 GPL 无关
R379 把"Power 是工业前置"升成了读数。这一轮把这条链逐环核完，结果是：**链上有三环，前两环等外部条件，第三环是我们自己没写。**

1. **GPL > 0** —— 现读 `Game.gpl = {level:0, progress:0, progressTotal:1000}`（R379）。外部/账号态，非代码可控。
2. **造出一枚 power creep 并把 `OPERATE_FACTORY` 升到可用** —— **代码已有**：
   `systems/empire/power-creep-manager.ts:34` 读 `Game.gpl?.level ?? 0` 交给 `planGplSpending(...)`，
   规划到 `action==="create"` 时执行 `PowerCreep.create(name, "operator")`（`:35-40`）；
   `domain/strategy/power-creeps.ts:11-16` 的功率表里 **`OPERATE_FACTORY: 14`** 在册（含各级所需点数的表 `:22-23`）。
   ⇒ 这一环是 `WIRED`（调用点在），`EXERCISED` 不成立（GPL=0 ⇒ `freeLevels=0`，规划不会给 create）。
3. **真的去操作工厂** —— **全仓零调用者**：`git grep operateStruct -- src` **0 命中**。
   （按本仓三次踩过的形状规矩：这里搜的是裸标识符 `operateStruct`，`x(`／`x?.(`／`x!(` 三种写法都包含在内，
   所以"0 命中"覆盖全部调用形状，不是漏搜。）

**⇒ 结论（这条改变 #130 的问法）**：即便主人决定投入 Power（打 Power Bank / 攒 GPL），
**工业商品线仍然不会通**——因为第 3 环没人写：有了能操作的 power creep，也没有任何代码去 `pc.operateStruct(factory)`。
⇒ #130 那句"缺的是第一次跑通"要补一半：**跑通需要三环全闭，前两环是条件、第三环是代码**。
这条不是我该顺手补的第 12 笔（补它要先定"哪个工厂、何时操作、操作冷却怎么排"——那是工业策略，属人），
但**它使得"要不要上 Power"这个决策必须知道：单上 Power 不够**。

**没解释的（照 R379 的界线）**：`@types` 只声明 `Game.gpl`（注释还把 global 拼成 "clobal"），**不写产生条件**；
本服的 GPL 从哪些结构/等级按什么速率累计，我**没有权威出处**，所以"W37S58 是 RCL8 而 progress=0/1000"这对读数**保持不解释**。
要查得读官方手册的 Power 章节（不在本仓内），不是我该猜的引擎事实——这条留作下一轮的一件事。

边界：零改码、零 push、零 build；线上只有只读 API 与纯读表达式；未 destroy / 未 re-claim / 未清 Memory。

## 巡检 R381（10-06 12:2xZ / 04:2xZ UTC）——**GPL 到底卡在哪一环：不是钱、不是代码、不是 RCL，而是本服市场上"功率"这件商品零供给**
R379/R380 把链条画到"第三环没写"，本轮核完前两环与真实卡点，**结论比那条更具体也更硬**（五发只读探针＋官方文档一句）。

**逐环核（每环给出处）**：
1. **RCL8 前提满足**：W37S58 `controller.level=8`（R376 表）。官方文档原文：*"An 8-level room is required to access a Power Spawn."*
2. **功率孵化场在场且是我的**：`{room:W37S58, my:true, energy:1300, power:0}`，`typeof s.processPower === "function"`。
3. **`processPower` 的调度代码存在**：纯函数 `src/domain/economy/power-processing.ts`（含单次耗能量注释＝引擎 `POWER_SPAWN_ENERGY_RATIO`），
   执行层在 `systems/factory-manager.ts`（该文件自述注释），搬运路径的来历写在 `creeps/engine/actions/industry.ts:720`
   （原文："processPower 消耗 1 power + 50 energy/次，**此前两样都无搬运通道**"）；
   配置侧 `CONFIG` 有 `powerSpawnEnergyTarget:1000`、`powerSpawnPowerTarget:100`（注明＝**市场买入目标量**）与一条 storage 地板注释
   （"GPL 是投资不是生存，余裕不足时暂停烧"）。⇒ **这一环不是零调用者**（我 R380 对"第三环"的判断只适用于 `operateStruct`，不适用于 `processPower`）。
4. **★真实卡点＝没有 RESOURCE_POWER 可用**：功率孵化场 `store[RESOURCE_POWER]=0`，而文档写明 GPL 进度来自 *"Merging 1 power with 50 energy"*
   ⇒ 没功率就一次也合不了，`gpl={level:0,progress:0,progressTotal:1000}` 因此**与代码无关**。
5. **★市场买不到（这条否证掉 #130 里"买"这条路的当下可行性）**：
   `Game.market.getAllOrders` 两种过滤形状都跑通并各自返回 **0 条卖单**——
   `{type:"sell",resourceSymbol:RESOURCE_POWER}` → `ok, sellCount=0`；`{type:"sell",resourceAsset:RESOURCE_POWER}` → `ok n=0`。
   同拍 `Game.market.credits = 20,342,247.575`（比 §26 记的 19.83M 还多）。
   ⇒ **20.34M 信用买不到功率，不是买不起，是本服此刻没人挂卖单**——
   这同时把 #130 那句"缺的是第一次跑通（打 Power Bank／开 POWER 买入口）"里**"买"这一支按现场行情判为当前不可行**，
   并且再次坐实我记忆里那条：**credits 从来不是变量**（且我的"市场只读"是自我约束，不是引擎限制）。

**六、于是 #130 的真实选择收窄成一条**：在本服此刻，通往 GPL>0 的**唯一可行动路径是 Power Bank（战斗获取功率）**，
而 Power Bank 位于无主房——**恰好落在我们情报池唯一有的那一类房里**（R366：池子里 7～11 个房全是 unowned、`intelCoverage` 现读 9）。
⇒ 两条线在这里合成一条：**同一个"只认得无主房"的情报面，既让战争选不出靶（#114），也仍是功率唯一可能的来源。**
**我不会去打 Power Bank**：L0 §1.5 把主动战斗列为须授权项，且"为造证据而开战"是本仓明令禁止的回路。

**七、诚实边界**：①`getAllOrders` 只反映**这一拍**的挂单，功率市场供需会变 ⇒ 判语要带"此刻"，下一轮若要引用必须重读；
②官方文档那句"Set the level of the factory to the level of the power"我只取到摘要，**没核**它对 R380 第 3 环（`operateStruct` 零调用者）有无影响——
那条结论不受本节影响，但真要补第 3 环前得先把原文读全。

边界：零改码、零 push、零 build、线上只有只读 API／纯读表达式／公开文档；未 destroy、未 re-claim、未清 Memory、未下任何市场单。

## 巡检 R382（10-06 12:4xZ / 04:4xZ UTC）——**我今天给"功率买不到"少说了一半原因，现按矩阵自己的记录补回**（并附一条我自己的流程错）
**流程错先行**：写 R379–R381 时我**没有先读 `CAPABILITY-MATRIX.md` §22**（10-04 已做的 §3.7 八项记录），
于是把一条**仓库里早就写明的事实**重新发现了一半。这正是我自己在 §3.0 末尾立的规矩——"立案前先搜同一现象的第二种说法"——这次轮到我自己违反。

**补回的那一半（出处是现成记录，不是新推断）**：功率买不到其实是**两个独立原因叠加**：
1. **市场此刻零卖单**（R381 两发：`getAllOrders` 的 `resourceSymbol` 与 `resourceAsset` 两种形状各跑通一次，均 0 条卖单；第二发 `{type:"buy"}` 也是 0 ⇒ 双向无市）；
2. **我们自己把 POWER 的市场买入入口关着** —— §22 早已记录：`terminal-selfaid.ts:85` 对 `resourceType === RESOURCE_POWER` 直接 `return 0`（优先级置零），
   `terminal-market.ts:445` 在自采循环里对 POWER `continue`。⇒ **即便明天有人挂卖单，当前代码也不会去买。**

**⇒ 对 #130 决策的含义因此变了（这才是本节的实际用处）**：我 R381 写的"唯一可行动路径是 Power Bank（战斗）"**要降级为两条之一**——
另一条是**打开一个已存在、被显式关闭的开关**（把 POWER 的买入优先级从 0 抬起、允许自采循环处理它），
它**不需要战斗、不需要等市场供给出现**（虽然仍需市场真有卖单），代价是花信用（现读 `credits=20,418,295`，18 分钟里 +76,048 说明我方卖单在成交）。
两条都属人；我不代开这个关（它会真花钱），也仍不打 Power Bank（会真发生战斗）。

**同时挂上 §22 已经说过而我没引的三点**（避免下轮再重新发现一次）：
①`power-creep-manager.ts:49` 那句"帝国尚无 powerSpawn"的注释**是过期的**（§22 已判：楼已在，别把 `gpl=0` 归因成"没楼"）；
②`processPower` 的 **1 power + 50 energy** 配比在 §22 里明确标为**口头数、未经 docs 复核**——我 R381 引用官方摘要句才把它坐实（*"Merging 1 power with 50 energy increases GPL progress"*），这条算是把 §22 的一个"未核"改成了"已核"；
③§22 已列**下一次可判读签名**：`Game.gpl.level > 0`、事件环出现 `PowerCreepMilestone`（编码可分 create/upgrade/spawn）、
三处 POWER 库存（`storage/terminal/powerSpawn`）由 0 变正。⇒ 这三条比我今天新写的更该被引用，我不另立一套。

**边界与状态**：本轮零改码、零 push、零 build、全只读；未开买入开关、未下单、未战斗。
三门于 HEAD 重跑（04:43Z）：`tsc` 0、unit 5298 全绿、integration 239 全绿；含 src 未推 **11 笔/16 文件**（总 242，余为对端文档批）。

## 巡检 R383（10-06 12:4xZ / 04:4xZ UTC）——**我这条"否证"本身要收窄：文件里"war 尾税"是两个不同机制共用的名字**
R368 否证了"退出 war 还要吃 ≥5,000 拍 fortify 尾税才放行扩张"。刚才 grep 全库"尾税"发现：**这个词在本文件指两件事**，
而我的否证只打掉其中一件。不写清就会被下轮当成"尾税家族整体作废"，那是用一个正确的翻案制造一个错误的排除。

**两个机制，出处与现状各不同：**
- **甲｜威胁窗把姿态钉在 war**（`lastHostileAt` + profile 窗口；R184 在 `EVOLUTION-ROADMAP.md:3713` 立案：low 环境窗口 5,000 拍 ⇒ "单次目击缴 5,000 拍记忆税，且多数时间敌人已不在场"；
  R234 `:4850-4852` 量过比值；R216 系 `:3840` 把某次到期时刻算到 `83,400,412`）。
  **这一支今天没有被否证，也仍然成立**：它作用在"进入/停留在 war"这一段，而 `posture==="war"` 直接把 `expansionAllowed` 关成 false。
- **乙｜离开 war 之后 fortify 还要再押 `minDwell=5,000` 拍才放行扩张**（我今早在 R345/#137 语境里用的那层意思）。
  **这一支才是 R368 打掉的那条**：`posture.ts:440-446` 的 `expansionPreserve = (prevPosture !== "war") || (warExitTicks ?? 0) >= minDwell`
  在前一姿态不是 war 时**短路为真**，而 war→fortify 那一拍 `finalize(..., true, ...)` 直接给真 ⇒ 现读**退出后 794 拍 `expansionAllowed` 已为 true**。
  `minDwell` 按住的只是**姿态标签**（fortify→develop），不是扩张授权。

**今天现场如何同时容纳两者**：本场 war 从 `83,456,360` 起、`83,458,051` 止，只活了 **1,691 拍**（≈3 个短威胁窗都不到），
且退出很可能走的是**危机撤资早退**分支（`posture.ts:452`，同窗 `rooms.W38S58.colonyState="recovery"`；能确证它的 `postureTransition.reason` 在未推的 `a2e90f02` 里）
⇒ 这说明甲的 5,000 拍**是上界不是必然**（经济撤资可以把刀提前落下），**不等于甲不存在**。
**判据留一发**：下次出现"某拍有敌情目击、之后 `posture` 长期停在 war 而场上无敌"时，甲就是那条被引用的机制——**别拿本节 R368 的否证去拒读它**。

**规矩再记一次**（本会话第四次同名之祸）：**翻案要写清打掉的是哪一支，并顺手标出同名的另一支仍然有效**；
否则一次正确的否证会在两轮之后变成一次错误的排除。

## 巡检 R384（10-06 12:5xZ / 04:5xZ UTC）——**我把"5,000"安错了参数**：现读 `CONFIG.posture` 与 `posture-baseline.ts`，并补上 #97 欠的那格**标定成本列**
**错在何处（本会话第五次"名字/数字要现读"）**：R368 与 R383 里我都写了 `minDwell=5,000`（`:8297`、`:8745`）。
现读：`src/config/index.ts:1170` **`minDwell: 1000`**（agenda 侧 `:1157` 是 200），而 **5,000 是 `warPatience`**（`:1166`），
另外 `threatWindow` 默认 **3,000**（`:1164`）、`warExitPatienceTicks` **1,000**（`:1168`）。⇒ 那两个 5,000 我是从今天的旧巡检文字里继承的，**没有现读 CONFIG**。
结论本身不受影响（`expansionPreserve` 在 `prevPosture!=="war"` 时短路这条是读码得到的），但**数字错了就是错了**：被 R368 否证的那条说法连它的数字都是我编的。
**§3.0 第 ① 项里的"≥5,000 拍"同样按本节读法理解**（那行是"被否证的旧说法"的引文，保留原文不改写，但取代说明在此）。

**一、环境基线覆盖（`domain/strategy/posture-baseline.ts:33-51`，逐字；合并链在 `:21`：`DEFAULT → CONFIG.posture → 本函数 → strategyOverrides`，后者被 `STRATEGY_BOUNDS` clamp）**
| `neighborPressure` | `threatWindow` | `warPatience` | `expandMinBucket` | `expandMaxPressure` |
|---|---|---|---|---|
| **high** | 1500 | 7000 | 8000 | 0.3 |
| medium | 保持 CONFIG（3000 / 5000 / 7000 / 0.4） | ← | ← | ← |
| **low** | **5000** | 3000 | 6000 | 0.5 |
⇒ 注释原文的意图很清楚：**低压区把威胁记忆拉长**（"少被打扰"），高压区缩短（"快速恢复扩张"）。
所以 R184 当年那句"low 环境一次目击缴 5,000 拍记忆税"**用的是 `threatWindow`，指的就是甲机制——那个数字对它是对的**；
错的是我今天把同一个 5,000 搬去当 `minDwell` 说。**两个数分属两个机制，别再串。**

**二、#97 欠的"标定成本列"，这一格现在能填（甲机制）**
- **代价定义**：一次敌情目击把 `posture` 按在 war 最多 `threatWindow` 拍，而 war 期间 `expansionAllowed=false` ⇒ **目击税＝最多 threatWindow 拍的发展停摆**。
- **标定值**：high 1,500 拍／medium 3,000 拍／low **5,000 拍**。
- **换算成墙上时间**（用本会话两次独立标定的拍长 3.7–4.0 s/拍，见 R350/R363）：≈ **1.6 h / 3.1 h / 5.2–5.6 h**。
- **现场上界被证实过一次**：今天这场 war 实际只活了 **1,691 拍 ≈ 1.7–1.9 h** 就退出（早退分支，见 R383）⇒ **5,000 是上界不是必然**，
  经济分支（`warExitPatienceTicks=1000`、危机撤资）可以把刀提前落下。
- **未核（诚实边界）**：本服**当前生效的 `neighborPressure` 是哪一档我没读到**——它决定税是 1,500 还是 5,000 拍。
  下一发先读它的写者（环境画像在生产者处命名，不猜），再引用本表；`strategyOverrides` 这一层今天也没读（#89 那条单向棘轮）。

**三、这一格同时解释了 #90/#92 为什么一直结不了案**：他们的"脉冲骚扰驯化 warPatience/恐吓税"要成立，税必须**接近 threatWindow 上界**发生；
而今天这一发是 1,691/5,000 ⇒ 至少这一例是**经济分支提前放血**，不是记忆税吃满。⇒ **#90/#92 的定罪判据应改成比值式**：
`实际 war 时长 / 生效 threatWindow`，只有接近 1 才是"记忆税"，接近 0 是"经济撤资"——**这一格正是 #97 说的"机制补深"该有的形状**。

边界：零改码、零 push、零 build；线上只有只读 API 与纯读表达式；未开任何开关、未下单、未战斗。

## 巡检 R385（10-06 12:5xZ / 04:5xZ UTC）——R384 留的两个未知都读到了，而且**#89 那条"单向棘轮"第一次拿到现行犯**
**一、生效环境档（`kernel.environment` 现读，写者 `domain/strategy/environment.ts:66-86`）**：
`{"marketActivity":"active","neighborPressure":"low","gclProgressRate":7.65,"tick":83460000}`
⇒ 分级条件是读码得到的：`ownedRatio>0.5→high / >0.2→medium / 其余→low`，`marketActivity` 按 `totalOrders>100 && credits>1M → active`。
⇒ **生效 `threatWindow` = 5,000（low 档）**，所以 #90 的比值分母定了：**今天 war 时长 1,691 / 5,000 ⇒ r ≈ 0.34 ⇒ 这一例属经济撤资，不是记忆税吃满**。

**二、★`kernel.tuning.strategyOverrides` 不是空的——里面有两条，且其中一条已经生效 ≈20 天**
（键是**扁平的**字面名 `"posture.minDwell"`，不是嵌套路径；我第一次按 `kernel.tuning.strategyOverrides.posture.minDwell` 去走，读到"不存在"——**那是路径形状错，不是数据缺失**，同族第六次。）
- **`posture.minDwell = 1400`**，`adjustedAt = 82,993,339` ⇒ 距今 **≈466,761 拍 ≈ 20.9 天**（按 3.85 s/拍）；
  `reason` 原文：**"Posture oscillation: 4 switches in 1000t → raise minDwell"**。
- **`posture.warPatience = 10000`**，`adjustedAt = 83,419,739` ⇒ 距今 **≈40,361 拍 ≈ 42 小时**（reason 以 "Thr…" 开头，被截断）。
- **没有 `threatWindow` 覆盖** ⇒ 生效值就是 R384 表里的档位值。
⇒ **合并链的顶盖层今天有货**：`DEFAULT(1000) → CONFIG.posture(minDwell 1000) → env low(不改 minDwell) → strategyOverrides(1400)`；
  `warPatience` 更是 **CONFIG 5,000 → low 档 3,000 → 覆盖 10,000**（比默认值高出一倍、比 low 档高 3.3 倍）。
  ⇒ **R384 那张表如果不接这一层就是错的**：我在同一节里已写"strategyOverrides 层今天没读"是未核项，这轮补上了。

**三、这就是 #89 立案的那台棘轮的现行犯**（项目记忆：条目无到期字段、运行期无撤销路径、合并链最顶 ⇒ 自改必须被持续重新争取）：
一条 20.9 天前因"1000 拍内抖 4 次"而抬上去的 `minDwell`，**至今仍在改变姿态机的退出行为**，
而它服务的是一次**早已过去的抖动事件**。#89 的修复（读时过期 TTL=15,000 拍）**已实现但未部署** ⇒
⇒ **本条把 #89 从"已实现·未部署"升成"有现行犯在跑"**：20 天 ≫ 15,000 拍 TTL，上线即过期，这条覆盖当场失效——
这是今天最有分量的一条"该推"的理由（另一条是 `postureTransition.reason` 能确证 R383/R384 那次 war 到底走哪条退出分支）。

**四、顺带把 #90 结了半个案**：它的机制（"振荡→抬门槛"的被动反馈）**不必再等预测兑现——它已经发生过并且留在 Memory 里**，
连 `reason` 字符串都带着一手判据（4 switches in 1000t）。
剩下未决的是**价值判断**而非存在判断：抬 `minDwell`/`warPatience` 到底让帝国变稳了还是变得更不抵抗（今天 r≈0.34 那次早退属经济撤资，说明战争决策主要由经济门决定，
门槛这条腿可能根本没在关键路径上）——**改哪个值属人**。

边界：零改码、零 push、零 build、全只读；未清任何 override（**删覆盖＝改行为，属人**）；不为造证据而开战。

## 巡检 R386（10-06 13:0xZ / 05:0xZ UTC）——**撤 R385 的第③点：那条"棘轮现行犯"根本不在跑**（用线上产物自证，不是用推断）
**先说结论**：R385 我写"20.9 天 ≫ TTL ⇒ 上线即过期，这是今天最有分量的'该推'理由"——**错在两处**：
①**TTL 过滤器早就在线上**，不存在"等这次部署才生效"；②因此那两条覆盖**此刻已经是惰性数据**，没有在约束今天的宣战与扩张节奏。

**证据链（本轮现取，全只读）**：
- 引入 TTL 的提交是 **`1bc67c9c`（2026-10-03，"#89 给 strategyOverrides 加读时过期 TTL=3×复盘冷却=15,000 拍"）**，
  且 `git grep isStrategyOverrideLive origin/dev` **命中**（`strategy-reviewer.ts` 1 处、`empire-strategy.ts` 2 处）⇒ **已在已推基线里**，不在我那 11 笔未推 src 中（我没碰过这文件）。
- 消费点也是现成的：`empire-strategy.ts:96` `...resolveStrategyOverrides(Memory.kernel?.tuning?.strategyOverrides, ctx.tick)`，
  `resolveStrategyOverrides`（`:356-369`）内 `:364` 用 `isStrategyOverrideLive(entry, currentTick)` 过滤；TTL = `STRATEGY_COOLDOWN_TICKS(5000) × 3 = 15,000`（`strategy-reviewer.ts:59/81`）。
- **决定性一步是查线上产物而不是读代码**：`dist/main.js` 与线上 `GET /api/user/code` 的 **sha 同为 `649eb94b9784`**（本地 dist mtime 仍是 Oct 4 19:21，**没有发生过部署**），
  而在这份产物里 grep：`isStrategyOverrideLive` **命中 1**、`resolveStrategyOverrides` **命中 1**、`selectEnvBaseline` **命中 1**、`summarizeRoles` **命中 0**
  ⇒ 线上跑的代码**含 TTL 过滤与 env 基线**、**不含**我今天写的 `#141` 重构 —— 一台仪器同时答了两问（这正是"本地 dist == 线上 sha"这台免费仪器的用处）。

**算术**：`posture.minDwell` 的 `adjustedAt=82,993,339`，距 `Game.time≈83,460,1xx` 已 **≈467,000 拍 ≫ 15,000**；
`posture.warPatience` 的 `adjustedAt=83,419,739`，距 约 **40,400 拍，也 >15,000**
⇒ **两条都被读时过滤掉**，生效值回到 `minDwell=1000` 与 low 档 `warPatience=3000`。
⇒ **R385 的"现行犯"作废**；`kernel.tuning.strategyOverrides` 里那两条只是**未清理的残留记录**（占字节、不占行为）。
⇒ 连带动 **R384 的表**：我当时把"生效值"写成覆盖后的 1400/10000——**那是"如果没过期才成立"的值**；真正生效的仍是 R384 表里的 CONFIG/env 层。
⇒ **#90 的分母**也要按这个改：`warPatience` 生效是 low 档 **3,000**（不是被覆盖的 10,000）。

**为什么这仍然支持"该推"，但理由换了一条**：#89 的修复**已实现且已部署**（状态应从"已实现·未部署"改成"已上线"），
它缺的是**判效**——判据现成：`minDwell` 覆盖被过滤后，行为侧回到默认 1000；但**这条不需要等我那 11 笔**，
它今天就可以判。⇒ 我从 R385 收回"该推的最强理由"这个说法；**该推的理由仍是那 10 条边沿签名**（`stats.observe`/`population.n`/`remainsLoot`/…），
不包括这条。顺带 #141 的 `summarizeRoles` 在产物里缺失＝**"缺键＝未部署"形状的又一发基线**。

**一条没查清的（不当已知）**：`ls -l` 报 `dist/main.js` 789,579 字节，而 check-code 两次都报 787,752（sha 一致）。
差 1,827 字节**我没能解释**——不影响本轮结论（sha 相同、mtime 未变、无部署），但记下来：
若哪天"sha 相同而字节不同"再出现，先怀疑仪器口径而不是世界变了。

边界：零改码、零 push、零 build、线上只读；**没有清那两条 override**（删覆盖＝改行为，虽然推断上惰性，仍属人）。

### 巡检 R387（10-06 13:1xZ / 05:1xZ UTC）**把 R386 的更正落进两份下游工件，结果在落的过程中抓到 R386 自己又错了一处**
本轮只做"传播更正"这一件事（tracker #83＝roadmap #90、handoff 部署清单第 10 条），**但传播要求我先读懂被我传播的那句话** ⇒ 现读 `CONFIG.posture` 与 `selectEnvBaseline`，于是发现：

**一、R386 末节那句"#90 的分母也要按这个改：`warPatience` 生效是 low 档 3,000"是错的——#90 的分母从来不是 `warPatience`。**
R384/R385 的判据写的是 `r = 实际 war 时长 / 生效 threatWindow`（目击税＝姿态被按在 war 的最长时间），分母属 `threatWindow`；
`warPatience` 是**另一条腿**（fortify→war 的**进入**耐心，`config/index.ts:1166`），那条 10,000 的旧覆盖改的是它，与"税吃满没有"无关。
⇒ 我把两件事叠在了一句话里。**数值本身没错，错的是它挂在哪一问上。**

**二、现读到的 posture 参数表（写死在此，后续引用以此为准）：**

| 键 | CONFIG（`config/index.ts`） | env `high` | env `medium` | env `low` | `strategyOverrides` 残留 |
| --- | --- | --- | --- | --- | --- |
| `threatWindow`（#90 分母） | 3,000（:1164） | 1,500 | 不覆盖⇒3,000 | **5,000** | — |
| `warPatience`（进入 war 的耐心） | 5,000（:1166） | 7,000 | 不覆盖⇒5,000 | 3,000 | 10,000（**已被读时 TTL 过滤**） |
| `warExitPatienceTicks` | 1,000（:1168） | — | — | — | — |
| `minDwell` | 1,000（:1170） | — | — | — | 1,400（**同上，已惰性**） |

**三、第二处命名错（R384 留下的，本轮一并改）**：旧文写"`neighborPressure` high→1500 / medium→3000 / low→5000 拍"——
`neighborPressure` 是 `selectEnvBaseline` 里 **switch 的输入**（`posture-baseline.ts:32`），不是被覆盖的键；那三个数属于 `threatWindow`。
⇒ **"输入名当输出名"是我这轮抓到的第 N 次变量名替我做了我没做的测量**（同一族：`orphanStructs`、`Game.ConstructionSite`、`kernel.lastExpansionAttemptTick`）。

**四、这条更正的实际收益**：既然 `strategyOverrides` 层整层被过滤（R386 的产物 grep 自证），**#90 的分母就降为一个可确定性读码的量**，
不再是"要现场读 Memory 才知道"的量。唯一剩下的未知只有一个：**当前生效的是哪一档 `neighborPressure`** ⇒ 分母取 1,500 / 3,000 / 5,000。
读它的**写者**（环境画像落盘处），**不要**从"今天被打了几次"反推——那正是把仪器读数当原因。

**五、教训（要留在台账上，因为它打在我自己刚写下的纪律上）**：handoff 第 364 行是我 R386 亲手写的
"引用任何 posture 参数前先现读 `CONFIG.posture` + `kernel.environment` + `kernel.tuning.strategyOverrides` 三层"，
而同一轮末尾我就把 R384 散文里的"分母＝warPatience"照抄了一次 ⇒ **写纪律不能防住"引 inherited prose 的数"**，
只有"落笔前重新读码"能防住。**判据句里的每一个键名都应当场对一次代码**，尤其是从上一轮散文里继承来的那一个。

已落地：tracker **#83**（roadmap #90）描述按本节重写（含两处作废说明）、tracker **#82** 标题从"未部署"改"已部署·缺判效"、
handoff 部署清单第 10 条**从签名池移出** ⇒ **部署签名由 10 条降为 9 条**（第 10 条的问题不推就能答，且"键应消失"那句也作废：读时过期不删条目，只是不采用）。

边界：零改码、零 push、零 build、线上只读（本轮没发任何 console 探针）；动的是三份我自己在写的台账/工件。

### 巡检 R388（10-06 13:1xZ / 05:1xZ UTC）**#90 的分母由假设转为实读 ⇒ 今天这一例判为"经济撤资"**
R387 留下的唯一未知是"当前生效哪一档 `neighborPressure`"。写者核到 `empire-strategy.ts:320-326`（**落 Memory，字段精简**），
⇒ 一次只读 API peek 就能答（**不是 console 探针**）：
`Memory.kernel.environment = {marketActivity:"active", neighborPressure:"low", gclProgressRate:19.5, tick:83,460,400, gclProgress:6,701,943}`
—— 拍号与当下同量级 ⇒ **写者活着、读数新鲜**（这条判断必须先做，否则"键有值"可能只是化石）。

**一、分母定死**：low 档 ⇒ 生效 `threatWindow` = **5,000**（`posture-baseline.ts:46`，medium 会保 CONFIG 3,000、high 会收到 1,500）。
⇒ 今天那一发 war 1,691 拍 ÷ 5,000 ＝ **r ≈ 0.34** ⇒ **判为经济分支提前放血**（`warExitPatienceTicks=1000` 或危机撤资 `posture.ts:452`），
**不是**记忆税吃满 ⇒ **#90 的"脉冲骚扰驯化宣战闸"在这一例上不被支持**；同一把力度的问题归到 #50/#137 的经济承受力线上。
⚠ 这是**一例**判读，不是本条结案：观察项的定罪要**多次目击事件凑齐 r 的分布**，而反例只能等不能造。

**二、同一份 env 输入顺带定死三个生效值**（今后引用 posture 直接从这读，别再逐层推）：
`warPatience` = **3,000**（low 覆盖 CONFIG 5,000；那条 10,000 的旧 override 惰性）、
`expandMinBucket` = **5,500**（low 先给 6,000，再被 `gclProgressRate=19.5 > 0.0001` 那一支减 500，`posture-baseline.ts:74-79`）、
`expandMaxCpuRatio` = **0.65**（market `active`）。

**三、一条防混淆**：`posture.expandMinBucket`（姿态层，现算 5,500）与 `expansion-manager.ts:57` 的硬编码 `bucket ≥ 5,000`（执行层）是**两处两个值**，
名字相近而不同源 ⇒ 扩张的 CPU 门槛被两道门分别管着，**别把"5,500"当成执行层那道门的数**。

已落地：tracker **#83** 标题与描述按本节重写（含作废引用清单）。

边界：零改码、零 push、零 build、线上只读（一次 memory-segment/`peek` 只读请求，无探针、无写操作）；不改任何阈值。

### 巡检 R389（10-06 13:1xZ / 05:1xZ UTC）**我 R386 给 #89 写的"行为判效"判据对自己要测的东西失明 ⇒ 现场否证并改成判别条件式**
想做一次**不依赖部署**的 #89 行为判效（量 fortify→develop 的静默拍数是 ≈1,000 还是 ≈1,400），一次只读 peek 就把它否了：

**读数**：`kernel.strategy = {posture:"fortify", since:83,458,051, expansionAllowed:true, newRemoteOpsAllowed:true, warPressureTicks:0, gclLevel:5, bucket:10,000}`、
`kernel.postureChangedAt = 83,460,448`、`kernel.lastExpansionCompletedTick = 83,328,457`、`kernel.expansion` **不存在**（旧键确认已摘，`expansion-manager.ts:39-45`）。
⇒ fortify 已驻留 **2,397 拍**（83,460,448 − 83,458,051）。

**一、2,397 落在 1,400 之外 ⇒ 这一发对 1,000/1,400 没有任何判别力。** 写死在判据里的"静默拍数 ≈1,000 而不是 ≈1,400"要成立，
退出必须**恰好**发生在 `[1000, 1400)` 这 400 拍带里；而读码（`posture.ts:266-272`）表明回落要**同时**满足
①`!threatRecent`（`posture.ts:144-146`：所有房的 `lastHostileAt` 距今 ≥ `threatWindow`＝实读 5,000）与 ②`dwellElapsed ≥ minDwell`。
⇒ **只要 war 退出时威胁记忆还没过期（今天正是这支：经济分支 `warExitPatienceTicks=1000` 先触发、威胁窗 5,000 还没走完），
①就比②晚得多，minDwell 永远不是绑定约束** ⇒ 我那条判据测的是"多数场合根本不起作用的那个参数"。⇒ **属"判据对自己要测的东西失明"这一族，本轮第 N 次犯在同一处。**

**二、但 minDwell 并非永不可观——把唯一能分辨的场合写死（这才是可执行的判别条件）**：
**war 因经济分支退出、且退出那一拍威胁记忆已经过期**（`lastHostileAt ≤ 退出拍 − 5,000`）⇒ 下一拍①即满足、②挡住 ⇒
**fortify 会被钉整整 `minDwell` 拍再落 develop ⇒ 观测值直接等于生效值（1,000 或 1,400），一次即判。**
今天的形状不是这一支（dwell 2,397 且仍未落 ⇒ 把 fortify 钉住的不是 minDwell，而是①或危机早退支，**本轮不指认哪一支**，指认要 `postureTransition.reason`＝未推的 #140）。
⇒ 判据改法：**等这个沿**，而不是"多取几次切换样本求均值"（取多少次都落在同一段，因为约束不是它）。

**三、实践结论（对"该不该清那两条 override"）**：override 改的 `minDwell` **本身在常见形状下就不 binding**，
叠加 R386 的"读时 TTL 已把它过滤"⇒ **那条 20.9 天前的旧覆盖是双重无害**；`warPatience=10000` 那条则不同——它管 war 的**进入**，
`warPatience` 生效 3,000（low 档）与 10,000 差 7,000 拍，一旦 live 就会实打实推迟宣战 ⇒ **惰性化它的正是同一个 TTL**。
（删条目仍属人：直接改行为，且此刻删与不删观测上等价。）

**四、顺带第 4 发确认 #140 的缺陷形状**：姿态稳定期 `postureChangedAt` 仍在每拍推进（83,460,448）而 `strategy.since` 固定（83,458,051）
⇒ 上线后"changedAt 不再每拍推进"这条签名**基线成立且仍未被满足**（这正是 #140 该随批推的理由之一）。

**五、扩张侧同拍读数**：`expansionAllowed=true`、`newRemoteOpsAllowed=true`、`bucket=10,000`、`warPressureTicks=0`
⇒ 姿态层的门**是全开的**，扩张仍未推进的瓶颈**不在 posture 层**（与 tracker #7 的"唯一失败门是 G6"一致，本轮不复测 G6）。

边界：零改码、零 push、零 build；两次只读 API 请求（`peek`），无 console 探针、无写操作；不改任何阈值、不清 override。

### 巡检 R390（10-06 13:2xZ / 05:2xZ UTC）**#116 是一条假缺口：意外丢房的检测路径存在、且已经打过 W38S58 的卡**
本想做"让丢房可检测"的观测补丁（#116 的原文是"领土机器无『意外丢房』路径"）。搜代码前我先假设自己可能错——**这一假设有救**：

**一、写者与数据都在**：`src/kernel/memory.ts:82-105` 就是意外失守通道（`Memory.rooms` 里的条目不在"当前拥有集合"即记 `lostRooms[name] ??= Game.time`，宽限 `LOST_ROOM_GRACE=20,000` 拍，届满 `recordLostRoomPurge` + 连 `tuning` 一起抹）。
线上实读 **`kernel.lostRooms = {"W38S58": 83,444,422}`** ⇒ **它不但存在，而且真的为 W38S58 触发过**。
更硬的交叉：83,444,422 与 roadmap 里我早前算出的"RCL1 降级容忍走完、progress 归零那一拍"**逐字相同** ⇒ 失守由**降级到 0**（无主）造成，机器在同一拍记下了它。
⇒ **#116 那句"无路径"作废**（这是本会话第 ~7 次假缺口，同族教训见 `diplomacy-hostile-attribution-gap`/`contract-layer-dead-2026-10-04`）。
我 R3xx 那句"丢房瞬间对自己账本隐形"只对了一半：隐形的是**收支账本**（`economy.ts:62-63` 按 `controller.my` 过滤），**kernel 的内存维护道不隐形**。

**二、真缺口比原命题窄、也不同**：`lostRooms` 的**读者是零**（全仓搜：只有自己的写者、`territory-manager.ts:194` 的清账、两处文档注释）。
⇒ 宽限期内没有任何决策系统把该房当"已失守"：实读 `rooms.W38S58.colonyState="recovery"`（冻在失守那一刻的状态）、
`spawnQueue` 里 `createdAt=83,444,337 / expiresAt=83,445,337` 的条目**过期已 ≈1,000 拍仍躺在数组里**（TTL 摘除由该房自己的 spawn 道驱动，而那道已不认它）、
`buildQueue` 还留着 `constraint.extension.29.27`（`state:"site"`）⇒ 幻影房**占着未完成的工单**，但**没在孵兵**（队列无人消费）。
⇒ 所以欠的是"**把 lostRooms 接进决策面**（谁该停止为它排产/计数）"，**不是**"建一台检测器"。修法属人（这会直接改变 W38S58 的处置），本轮**只立案不改**。

**三、写死一条可否证预报（约 3,900 拍后到场，≈2.5 小时）**：判定式是 `Game.time - lostAt > 20,000` ⇒ 最早在 **tick 83,464,423**（+ 该维护道的下一拍）应同时看到：
①`rooms.W38S58` **消失**；②`kernel.lostRooms` 变 **`{}`**；③`kernel.tuning.rooms.W38S58` 与 `kernel.tuning.lastEval.W38S58` 消失；
④段 2 事件环出现 `LostRoomPurge`，`r="W38S58"`，载荷按现读结构应为 **`[0, 0,0,0,0, ≈20,001]`**（reasonCode=0 唯一出口；`roleBounds={}`⇒0；无 `pendingValidation`/`frozenParams`⇒0/0；无 `remoteOps`⇒0）。
**否证条件**：若 83,464,423 之后条目仍在 ⇒ 说明维护道没跑或 `lostAt` 被改写（那就是缺陷，且这条预报直接把它钉出来）。
⚠ 早退分支已排除：`:140` 的"三本账全空就不发事件"要求 `state || lastEval || remoteOps` 至少一本在场，而 `tuning.rooms.W38S58` 与 `lastEval.W38S58` **都实读到有值** ⇒ 事件应当发出。

边界：零改码、零 push、零 build、线上只读（本轮 3 次 `peek`，无探针）；#116 的修法（接决策面 / 是否重占 / 是否拆房）一律属人。

### 巡检 R391（10-06 13:3xZ / 05:3xZ UTC）**我把 batched 键当钟用了一次，差点写下"shard 变慢 2.5 倍"**
起因：R390 的清退预报要换算成墙钟，而我看到 `intelCoverage.tick=83,460,503` 相对 `environment.tick=83,460,400` 只前移 ~100 拍、
却隔了 ≈10 分钟 ⇒ 脑内成句"拍长 ≈9 s，世界变慢"。**现测否证**：用每拍推进的键直接量——
`postureChangedAt` 两次 `peek` 跨 **101.775 s / 25 拍 ⇒ 4.07 s/拍**；对照 05:17→05:30 的 83,460,448→83,460,639（191 拍 / ≈770 s）⇒ ≈4.0 s/拍。
⇒ **拍长在正常带内（3.7–4.1 s），没有任何 shard 变慢**。

**错因（这条比结论值钱）**：`kernel.stats.intelCoverage.tick` 由**老化批**写，而那道取模门会整批丢沿（**#115**）——
我用一个**已知会丢沿的仪器的时间戳**去推世界速率，于是把"#115 的滞后"读成了"服务器变慢"。
⇒ **给 #115 的副作用清单再加一条：它不只让情报读数陈旧，还会把用它当钟的人骗去怀疑平台。**
⇒ 规矩（写死）：**任何"多少拍之后"的墙钟 ETA，只用每拍推进的键**（本仓现成两把：`kernel.postureChangedAt`——拜 **#140** 缺陷所赐每拍写、
`kernel.environment.tick`——按 100 拍采样）；batched/事件类时间戳的滞后**先按仪器缺陷解释**，其次才考虑世界。
（同族教训见 user 记忆 `feedback-instrument-damping-and-units`：分类仪器速率/窗口/EMA/累计之后再引用。）

**重锚后的两个 ETA（按 4.0 s/拍 换算，别再用 3.75 硬乘）**：
①R390 的清退点 **83,464,423** ⇒ 距 05:31Z 约 **3,784 拍 ≈ 4.2 小时（≈09:4xZ）**；
②对端 R197/R198 的 war 复发点 **83,461,051** ⇒ **≈412 拍 ≈ 26 分钟**（那条判据归对端轨，我不重复取数）。

**已把①交给后台只读轮询器**：`tmp/tools/official/lostroom-purge-watch.sh`，**pid 37021**，`GAP=900s`（≈230 拍 < 事件环寿命 ≈846 拍 ⇒ 抓得到那条事件）、`ROUNDS=40`、
判据行首锚定 `★PURGE-DONE / ★PURGE-LATE / NOREAD`，日志 `tmp/observe/lostroom-purge.log`，已在 `tmp/observe/AGENT.lock` 登记（零 console、零写操作、钟只吃 `kernel.environment.tick`）。
**部署侧确认**：`grep LostRoomPurge dist/main.js` 命中 **`LostRoomPurge=46`** ⇒ 事件写者**已经在线上**，判据④不是"等上线"而是"等到期"。

**同批两条顺带读数**：`kernel.warPlan` 现读**不存在**——这次用的是 R359 更正后的**对的键**，且同批控制组 `kernel.strategy` 非空
⇒ "不存在"是证据不是工具形状，与 **#114**（war 姿态下零候选）一致；`bucket` 由 10,000 → **9,999**（单拍借用 1）⇒ **不构成档位变化**，判档只看 `tier`+`since`。

边界：零改码、零 push、零 build、线上只读（5 次 `peek` + 1 次 `ring-dump` 就绪后由轮询器自行调用）；新增的只有 `tmp/` 下一支只读脚本与一行锁记录。

### 巡检 R392（10-06 13:3xZ / 05:3xZ UTC）**推前审计：这一批 12 笔 src 里唯一改语义的那一笔，消费者是零**
「推」是下一道闸,所以我把"批内是否夹带未申报的行为改动"当作本轮主目标审了一遍（看 diff,不靠提交信息）。

**一、清单对得上号（本行的数字已在 R393 更正过：`13/14/14` 是**截断产物**，真值 **16 src / 11 test / 12 笔**）**
（`git diff --name-only origin/dev..HEAD -- src tests` 不带 `tail` 重取：**27 文件、1,246 增 / 53 删**，与同一命令的 `--shortstat` 自洽）：
`road-build.ts`(111) `posture.ts`(140) `recovery-lifecycle.ts`+`recovery-execution-system.ts`(139) `global-cache.ts`+`kernel.ts`(注册/暂存结构)
`timeseries.ts`+`telemetry-collector.ts`(141) `empire-strategy.ts`(140 消费侧) `tower-defense.ts`(131/119 侧) `room-observer.ts`(100) `room-snapshot.ts`(§3.4 残留普查)
`types/global.d.ts`(声明) ⇒ **每笔都能落到一张票上,没有"顺手改"的孤儿文件**。

**二、最大的一块（`posture.ts` +107）逐行看完是纯加法**：八个 `finalize(...)` 调用各多带一个 `reason` 字面量,分支条件、返回值、顺序一字未动
⇒ 姿态判定结果与批前**逐支同形**。`empire-strategy.ts` 只加了两处：日志尾部 `branch=${result.reason}`,与把戳记写进真正的转换支。

**三、批内唯一"改语义"的一笔（也是我最初怀疑会牵动行为的那一笔）**：`postureChangedAt`
旧 `if (Memory.kernel.strategy?.posture !== undefined) postureChangedAt = Game.time`（`strategy` 本拍已被覆写 ⇒ 条件恒真 ⇒ 每拍刷）
新：只在转换那一拍写。**安全性论证不靠"看起来无害",靠消费者计数**：全仓搜 `postureChangedAt|postureTransition` ⇒
命中只有 **写者 `empire-strategy.ts:110-111`、类型 `global.d.ts:413/418`、一条注释 `:248`** ⇒ **读者 0 个** ⇒ 改语义不可能改变任何一拍的实际行为。
⇒ 顺带得到 #140 判效的形状学：**上线后 `postureChangedAt` 会"停止每拍推进",这本身就是签名**（R389 已量到基线 83,460,448/83,460,639 每拍动）。

**四、审计中我差点误判的一处**：过滤后的 diff 里 `export type PostureBranch` 前出现一行裸 `/**`,像未闭合注释 ⇒ 直接看 `sed -n '86,94p'` 才知是**我的 `grep -v '^ \*'` 把注释正文吃了**,原文是完整的一段 `/** … */`。
⇒ 教训同族：**被我自己过滤过的 diff 不能当原文引用**,凡"看起来坏了"的第一反应是去看未过滤的那几行（tsc 全绿当时已经是反证,但我没先想到）。

**五、批的剩余前置（诚实清单,不在我权限内）**：
①本窗只重跑过 `tsc`(0) + unit(5298) + integration(239)，**e2e 没跑**（它自带 build，且此刻有判效窗在跑 ⇒ 不许 build）；
②`dist/main.js` 仍是 Oct 4 那份（sha 与线上一致 ⇒ **本地 dist 里没有这批新代码**）,推之前必须 rebuild——走仓里既有 `tmp/tools/official/batchNN-gate-and-push.sh` 那条路（下一支应编号 **15**）,别裸推；
③推 = 部署 = L0 §1.5 属人授权类,**我不自作**。

边界：零改码（本轮只读 diff 与源码）、零 push、零 build、线上只读。

### 巡检 R393（10-06 13:3xZ / 05:3xZ UTC）**我自己写的闸门把我的审计数字打回来了：16 个 src 文件，不是 13**
为了把「推」变成一条有依据的命令，我从 batch14 那套闸门派生了 `tmp/tools/official/batch15-gate-and-push.sh`（**只写不跑**），
并把"批内 src 文件数"做成闸门①¾（对不上就**拒绝推**）。基线我填了 R392 的 **13** ⇒ 脚本先自检时跑出 **`src 文件数=16`、`src+tests 提交数=12`**。

**错因（这条比数字值钱）**：R392 我用的是 `git diff --stat … -- src tests | tail -25`——**27 个文件被 `tail` 吃了头两行**，
而我把截断后的清单当成了全部，**同一命令的 `--shortstat` 明明就写着 `27 files changed`**，我没对那次闭合式。
⇒ 同族第 N 次：**我的命令形状本身就是读数的一部分**；清单类结论要么用不带截断的 `--name-only`，要么把 `--shortstat` 同批读回来做闭合式（**这次是"名数 ≠ 文件数"没对上**）。
⇒ **派生脚本里的"审计基线"必须由脚本自己现取，不能由我抄散文里的数**——这条闸门存在的意义正是拦我这种抄数。

**补审那三个没看过的 src**（`pickup.ts` / `remote-hauler.ts` / `intel.ts`，都是 R392 漏列的）：
①`pickup.ts`（#131）：加 heap 计数。**唯一一处结构改写**是把 `if (richestAdjacent) return…; return findClosest??[0]` 合成
`const picked = richestAdjacent ?? findClosestByRange(candidates) ?? candidates[0]` ⇒ `??` 链与原两支**同 precedence、同语义**，逐字核过。
⚠ 但 `bucket.executed++` 落在 `runCountedAction` **之前** ⇒ **`executed` 数的是"发起"不是"成功"** ⇒
闭合式 `executed + skips === resolved` 会**把 ERR_* 失败也算进 executed**（判读 #131 时不许把它当战果率）。
②`remote-hauler.ts`（#111）：0-WORK 支新增一次 `findMySitesCached` 遍历 ⇒ 纯计数，不动动作；成本上界＝每房每拍 1 次 `find`（缓存按房共享，不随 creep 数放大）。
③`intel.ts`（#100）：**纯 `interface`，零运行时**。
⇒ 结论仍成立但**措辞要收窄**：这批**不改任何决策**（除 postureChangedAt 的语义、其读者为 0），
**不是**"零成本"——两处新增遍历/计数是真增量，推后要看 CPU 档位是否跟着动（判档只看 `tier`+`since`）。

**脚本状态**：`bash -n` 语法通过（**未运行**）；闸门含①无在飞 e2e/build/push、①½ src/tests 工作树干净、①¾ src 文件数＝16、
②typecheck+unit+integration+build、③快进＋推送前现取线上 sha 作基线（取不到就停，"读失败"≠"没上线"）；红线沿用 batch14：不 `--no-verify`、不 force、不 reset。
**跑不跑它 = 「推」的授权决定，仍属人。**

边界：零改码（只写 `tmp/` 下未跟踪的工具）、零 push、零 build、线上只读。

### 巡检 R394（10-06 13:3xZ / 05:3xZ UTC）**闸门补上"本批从未跑过 e2e"这一格：默认开,跳要显式**
R392 的诚实清单里那条"e2e 未跑"不能只当注脚留着——它是我目前**唯一还没消掉的已知空白**（其余都被读数或属人决定挡住了）。

**为什么不能"先推了让 CI 跑"（写死理由,下一轮别再重新论证）**：CI 的 e2e 发生在**上线之后**,
出红之前这批码已经在官服活跑一段;而本批动的是 **`pickup.ts` / `remote-hauler.ts` 这类 creep 动作层**,
正是 e2e 引擎级场景覆盖的那一层（22-war-ledger 授权/战损界、21-decoy-auth 拒诱饵、road-build 落点那族）。
⇒ 给"这一层没被 e2e 验过"上生产,是把回归的发现权让给生产环境。

**实现（`tmp/tools/official/batch15-gate-and-push.sh` 新增闸门②½,默认开）**：
`RUN_E2E`（默认 `1`）⇒ 跑 `npm run test:e2e`,失败**不推**并 `tail -25` 进日志;显式 `RUN_E2E=0` 才跳过,且跳过会在日志里留一行**"以'从未跑过 e2e'的状态上线"**（跳过必须是署名决定,不能静默）。
⚠ 一条易读反的点：`test:e2e` 里含 `build` ⇒ 会**重写 `dist/main.js`**,**这不影响判据**——闸门③比的是**线上** sha（`check-code.mjs` 现取），
本地 dist 本来就会被 pre-push 重建;**"本地 dist 变了"永远不等于"上线了"**（这一句是同族事故的固化：R-曾量过"sha 相同而字节不同"的未解释项,判版本一律用 sha 不用 mtime/字节）。

**顺带把 R393 的错因写进脚本头**（基线 src=16 现取,不抄散文）:闸门①¾用 `git diff --name-only … | wc -l` 现算,
与 R392 那句被 `tail -25` 截断的"13"分手。

**验证到什麼程度**：`bash -n` 语法通过、`grep '!= "16"'` 命中、`src/tests` 工作树脏行数 0；**脚本未运行、未 push、未 build**（跑 e2e 会换 dist,而此刻并行轨的判效窗状态我没有逐条确认过——
真要跑 e2e 请在闸门①自己报"无在飞 e2e/build/push"之后再走,这正是它存在的用途）。

边界：零改码（只写 `tmp/` 下未跟踪工具）、零 push、零 build、零线上写操作；判效轮询器 pid 37021 未受影响。
