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

### 4.0-pre（10-02 21:3xZ 改写）下一轮 L2 主目标：**收两条预约 verdict，按预写分支走**

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
