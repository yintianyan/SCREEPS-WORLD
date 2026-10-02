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
| 每拍 CPU | 差分实测 ≈15.1/t（舒适线 ≤12.00）。10-01 21:00 复核：`tier=tight`、`since=83363555` 两次采样（隔 15 分钟）稳定；20:40 那次读到的 `constrained` 是**部署税**（boot 后不采信输入 ⇒ 档位归零），已自解。**10-02 04:5xZ**：`tier=tight@83364706`（换码没挪动 `since` ⇒ 这批的税落在输入不可信窗而非档位翻转）；300t 环 `avg=14.8 / max=18.5`。**累计账 `12.67/t` 是 boot 均值，不可当速率**（要差分） | 已验证（档位）/ 待差分（速率） |
| 扩张 | 17:1xZ 实读 `failedGates=G0+G6`（不是四道：G3/G4 已随 #40/#41/#21 那批修复转绿）。G0 此刻 bind 的是 `posture=war`，而它有真实基础（环内 5 轮 TowerVolley、`lastHostileAt` 在 `threatWindow` 内）⇒ 有界自解，**别动 posture**；链路上没有第三道隐藏闸。**10-02 04:5xZ 复读=四道**：`G0 + G2(struggling=1) + G3(critical, core=1) + G6(tight)`，其中 `core=1` 是**结构性的**（第二间房才 RCL4，爬到 RCL6+ 之前 `coreRooms` 永远是 1）⇒ 属闸的构成问题，**不动阈值**；G3 在 `netFlow` 为正（+5.7）时仍报 critical，需按 `empire-health` 输入读，不能据此推"账本坏了" | 已验证（四道=两次快照，单次不算稳态） |
| 经济账本 | 净流口径四处语义已修（pickedUp / 无 storage 不 drop / exported+tradeFee 只进消费侧 / carrier 卸能成对入账）；**#48 判效到手**：同 boot 段两次配平 `3600/3600` → `4800/4800`（核心 `exported` == 幼房 `imported`，差分各 +1200）——记为**金额配平**，不是"同拍成对" | 已验证（#43/#48 判效到手） |
| 自主防御 | 幼房有塔后进犯 10 拍清除、0 战损；无塔时 ≥1000 拍停摆 | 已验证（单次对照） |
| 战争 | 授权链与诱饵拒绝由引擎级 e2e 覆盖；线上无敌情可采 | 已测试，**未线上验证**（不可制造） |
| 贸易 | terminal 自发交易在跑，运费入账可见（boot 段 tradeFee=794）；买料产商品单价倒挂 ≈60 倍 ⇒ 需求发布被 ROI 闸正确按住 | 已验证 |
| 工业 | factory 等级回退已上线；商品需求 ROI 闸已上线；lab 经济线未稳定产出 | 部分已验证 |
| 自我诊断 | 期望自检 E1–E9 + 定长事件环 + dashboard/peek 工具链；**恢复烧穿第一次留下可查痕迹**（10-02 04:5xZ `Memory.kernel.escalations` 首条真实条目 `W38S56/colony/population_rebuild, attempts=2, terminal=true`，环内同段 `RecoveryEscalation=2`）⇒ #59 的"等一次真实烧穿"结束；`manual_intervention` 仍是死枚举（无生产者） | 已集成；E5 本轮修复（见 §4）；升级侧响应惰性仍未判效 |

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
2. **检出→响应闭环**（设计已定形，待一次前置核实后即可实施）：
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

## 4. 当前迭代（最近三轮）

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
