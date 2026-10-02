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
| 领土 | 核心房 W37S58（RCL8）+ 幼房 W38S56（自主扩张所得）+ 远矿若干；W37S55 已放弃 | 已验证 |
| 每拍 CPU | 差分实测 ≈15.1/t（舒适线 ≤12.00）。10-01 21:00 复核：`tier=tight`、`since=83363555` 两次采样（隔 15 分钟）稳定；20:40 那次读到的 `constrained` 是**部署税**（boot 后不采信输入 ⇒ 档位归零），已自解。**10-02 04:5xZ**：`tier=tight@83364706`（换码没挪动 `since` ⇒ 这批的税落在输入不可信窗而非档位翻转）；300t 环 `avg=14.8 / max=18.5`。**累计账 `12.67/t` 是 boot 均值，不可当速率**（要差分）。**10-02 07:2xZ 复核**：换码后 `tier` 落 `constrained`（= 部署税，boot 后不采信输入）， 之后读回 **`tight`、`since=83372945`** ⇒ 档位自解，与 10-01 那次同形；**判 tier 只看 `tier`+`since`**，每次部署自带 ~400 拍税 | 已验证（档位）/ 待差分（速率） |
| 扩张 | 17:1xZ 实读 `failedGates=G0+G6`（不是四道：G3/G4 已随 #40/#41/#21 那批修复转绿）。G0 此刻 bind 的是 `posture=war`，而它有真实基础（环内 5 轮 TowerVolley、`lastHostileAt` 在 `threatWindow` 内）⇒ 有界自解，**别动 posture**；链路上没有第三道隐藏闸。**10-02 04:5xZ 复读=四道**：`G0 + G2(struggling=1) + G3(critical, core=1) + G6(tight)`，其中 `core=1` 是**结构性的**（第二间房才 RCL4，爬到 RCL6+ 之前 `coreRooms` 永远是 1）⇒ 属闸的构成问题，**不动阈值**；G3 在 `netFlow` 为正（+5.7）时仍报 critical，需按 `empire-health` 输入读，不能据此推"账本坏了" | 已验证（四道=两次快照，单次不算稳态） |
| 经济账本 | 净流口径四处语义已修（pickedUp / 无 storage 不 drop / exported+tradeFee 只进消费侧 / carrier 卸能成对入账）；**#48 判效到手**：同 boot 段两次配平 `3600/3600` → `4800/4800`（核心 `exported` == 幼房 `imported`，差分各 +1200）——记为**金额配平**，不是"同拍成对" | 已验证（#43/#48 判效到手） |
| 自主防御 | 幼房有塔后进犯 10 拍清除、0 战损；无塔时 ≥1000 拍停摆 | 已验证（单次对照） |
| 战争 | 授权链与诱饵拒绝由引擎级 e2e 覆盖；线上无敌情可采 | 已测试，**未线上验证**（不可制造） |
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

### 4.0-pre（10-02 19:4xZ 再改写）下一轮 L2 主目标：**#85 —— 给调优器的 ↑ 加「事前绑定判据」**

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
