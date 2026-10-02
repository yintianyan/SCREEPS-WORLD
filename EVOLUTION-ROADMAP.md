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

## 4. 当前迭代（最近三轮）

### 4.0-pre 下一轮 L2 主目标（10-02 06:09Z 改写）：**给"为什么什么都没发生"补第 6 档出口**（#64）

- **一句话**：`countSpawnReject` 现在有五档（`survivalBlock/budget/reserveOnly/noDegrade/floor`），但**降级许可从未打开**
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
