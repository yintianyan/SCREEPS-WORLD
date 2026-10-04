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

### 4.0（10-04 04:0xZ 改写，R135）下一轮主目标：**收 #115 自然实验的第二发：wave3 之后 spawn 工地是否拿到第二个工位、进度是否离开 0.14/拍，据此决定 `c58ff9d` 要不要催推**

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
