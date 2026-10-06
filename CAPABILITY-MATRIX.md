# 能力矩阵（L0 §2.3 要求的交付物）

> **本文件是 L0 §2.3 指定的"可持续更新的能力矩阵"。它此前从未存在**（2026-10-03 核查：全仓只有 L0 文档自己出现 `LIVE_VALIDATED` 字样）。
> 每条能力按 L0 规定的 11 个字段记录，状态只用 L0 的七档：
> `NOT_STARTED → DESIGNED → IMPLEMENTED → INTEGRATED → TESTED → LIVE_VALIDATED → STABLE`
> **推进规则（写死，不许凭印象升档）**：`TESTED` 要有能跑绿的测试文件路径；`LIVE_VALIDATED` 要有**线上读数出处**（sha / 读数时刻 / 判据）；
> `STABLE` 额外要求**同一现象的第二发独立复证**（我今夜为此撤过三条只有一次读数就下结论的话）。
> 证据等级不可互替：读码 ≠ 测试 ≠ 线上读数 ≠ 复证。

---

## 1. 房间能量核算与净流（`domain/economy/accounting.ts`）

- **游戏机制依据**：能量是有限资源；任何"买不买得起扩张"的判断都要先有可信的收支账。
- **实现状态**：`LIVE_VALIDATED`
- **代码入口 / 调用链**：`accounting.ts` → `systems/room/economy.ts`（每 50 拍结算一窗）→ `Memory.rooms[r].economy.{nf,bk,ws}` → `empire-economy.ts` 两级 EMA → `readiness.ts` G3/G4。
- **依赖模块**：`resource-view`、`room-profile`、`empire-economy`、`readiness`。
- **现有测试**：`tests/unit/economy/*`（含 drift/恒等式用例）；全量 `tests/unit` 384 文件 / 5214 用例绿（10-03 11:1xZ）。
- **线上验证**：#40 修二次入账、#43 运费入账（boot 段 `tradeFee=794` 有写者且非零）；`bk` 窗口口径实测 = **50 拍窗增量**（`CONFIG/index.ts:472`）；三层阻尼链（单窗→`nf`→`gateNetFlow`）逐行读码 + 现场读数双向对上（R173/R176/R178）。
- **已知缺陷 / 边界**：`sold` 被**刻意**摘出净流（`economy.ts:220-229`）⇒ 卖量不压 G4、运费压；物理对照只能靠段 3 `rs`/`se` 绝对量差分（实测帝国累积 ≈+4.9/拍）。
- **CPU 成本**：`empire-economy` 每 100 拍一次（低峰）；核算窗每房 50 拍一次。
- **优先级**：P0（它是所有扩张/危机决策的分母）。
- **验收标准**：任一 `drift` 超容差连续 2 窗 ⇒ `AccountingDrift` 事件（已有，线上出现过 `[34,2]` 形状）。**升 `STABLE` 的缺口**：净流涨幅的来源仍无独立仪器复现（R175/R176 只到"由 τ 解释"）。

## 2. 扩张就绪度与门控（`domain/strategy/readiness.ts` + `posture.ts`）

- **机制依据**：扩张是长承诺投资，误判会触发死亡螺旋。
- **实现状态**：`LIVE_VALIDATED`
- **入口 / 链**：`readiness.ts` G0–G11 → `empire-economy.ts:308-321`（刻意用长视界视图）→ `kernel.expansionDashboard`；`posture.ts:150` 七个合取项 → `expansionAllowed` → **执行侧唯一认的门禁**（`plan-adapter.ts:67`，`execution-gate.ts` 里**没有** G4/G6）。
- **线上验证**：**第一次自主扩张端到端自然完成**（`outcome=COMPLETED`，开单→完成 13,300 拍，债单 #32）。
  ⚠️R187 那句"七合取项逐项现读唯一假项 `youngestMature`"**已被 R212 取代**：RCL5 于 tick≈83400860 命中后
  `youngestMature` 翻 true，而 `expansionAllowed` 仍 false —— 因为它是 `expandHealth && !liveThreat && posture!=="war"`
  （`posture.ts:247`），**war 尾税是七项之外的独立合取项**。R212 现场逐项：bucket✓ allNormal✓ avgPressure=[0,0]✓
  sponsorReady✓ youngestMature✓ cpuRatioOk✓(0.33<0.6) **gclHeadroom 未证** **posture=war ✗（唯一在挡）**。
  ⚠️坑：dashboard 的 `Pressure=HIGH(0.65)` 不是 posture 吃的那个量（决策路径用 `rooms[].economyPressure` 均值）。
- **已知缺陷**：**#88 属人**（G4 的 ≥5/拍 与 `youngestMature` 在同一能量预算上对冲，R185；RCL 侧现已满足，剩 G4 单挡）；**#92 属人**（零活敌的 war 靠 `threatWindow=5,000` 记忆撑住 ⇒ **每次目击**缴 ≈5 小时扩张税，R212 现场量到比值：波次在场 ≤45 拍 vs 税 5,000 拍 ≈ **110 倍**；**R231 升形：脉冲骚扰可让尾永不结束** —— 今晚两发目击 83400220 与 83402214 间隔 1,994 拍 < 5,000 ⇒ 锚被整个前移，第一发的 2,000 拍税作废重计）；#94 上线前 `gclLevel`/`bucket` 两项不可事后归因。
  ⚠️**G0 口径（R232 读原文定死）**：`readiness.ts:151-158` 的 G0 = **`posture.expansionAllowed === true` 这一个布尔**，
  **不是 RCL 项**。RCL 走 G3/G5（`coreRooms`，`resource-view.ts` 分类）。⇒ 我 R182 那句"RCL5 命中消掉 G0 假项"作废；
  `Blocked=G0+G6` 的正确读法是"**war 尾 + CPU**"，与升到几级无关。
- **优先级**：P0。**验收标准**：解闸后必须真落地一次 claim（已满足一次）；**`STABLE` 缺口**：同一串闸的**第二次**端到端自然完成还没有。
  **在飞的可驳预测（R212 立、R231 改锚，判效器 pid=7182）**：尾税原算 tick≈83405220 到期，但 round 9 出现新目击
  （`W37S58:83402214`）⇒ **现算锚 = `max(rooms[].lastHostileAt) + 5000` = 83407214**；读判据时一律按当轮 hostileAt 现算，
  不要引这两个字面值。到期 ⇒ `expansionAllowed` 同拍翻 true（P-A），执行闸只看这一个标志 ⇒ 会真去 claim W37S56；
  若不翻（P-B）⇒ 首查 `gclHeadroom`。**命中前提：连续 5,000 拍无新目击。**

## 3. 跨房物流与成对入账（`creeps/roles/carrier.ts`、`actions/fill.ts`）

- **实现状态**：`LIVE_VALIDATED`（入账）/ 合同**读侧** `LIVE_VALIDATED`（`e50ef36`，2026-09-30 上线）/ 合同**写回链 `NOT_WIRED`**（见 §3b）
- **线上验证**：累计账本 R231 一发（`kernel.stats.energyLedger.rooms`，boot tick=83386488）——幼房 `imported=59,079 / exported=0`，
  核心房 `exported=50,400 / imported=403,457` ⇒ 两量同量级、方向与合同一致，成对入账判为在工作。
  更早两发：#48 `3600==3600`、R177 同窗 `1200/1200`。
- **⚠️判读纪律（第四次更正后定死）**：`exported` 与 `imported` **不是恒等式对**。写 `imported` 的
  `fill.ts:22-29 importedFieldFor()` 只判"交付房≠来源房"⇒ 远矿流入天然计入；写 `exported` 的只有
  `carrier.ts`/`terminal-selfaid.ts`（自家房流出）。所以"两房差额"（现 8,679）**不能**读成漏账，
  要定罪必须逐笔拆到远矿 vs 核心房，且需有受害者。**也不许用合同台账判交付** —— 理由见 §3b。
- **优先级**：P1。**`STABLE` 缺口**：一次真实跨房交付的**成对第二发**（同一窗口两侧同拍动），及交付落点是否 storage（Memory 读不出，待一发现场读数）。

## 3b. 供给合同域（`domain/economy/supply-contract.ts` + `contract-lifecycle.ts` + `contract-node-bridge.ts`）

- **实现状态**：**`NOT_WIRED`**（写回与状态机）/ `TESTED`（整个 domain 层单测覆盖）—— 与 §8b 同类：**不是"没测过"，是"产线上进不到"**。
- **证据（R231，三次独立 grep 指向同一处）**：`recordDelivery` 在 `src/` **零调用者**（只有定义 `supply-contract.ts:291` 与
  `contract-lifecycle.ts:284` 一处注释）；`contract-node-bridge.ts` 与 `contract-lifecycle.ts` 的导入者**只有 tests**
  （`tests/unit/economy/supply-contract.test.ts`、`tests/unit/logistics/a4-4-convergence.test.ts`）。
- **后果**：合同被创建时写入 `ca=ua=ac=<创建拍>`，此后**没有任何路径能改 `td/cs/ua/st`** ⇒ `Memory.kernel.supplyContracts`
  是创建时刻的化石。线上实证：`contract:W37S58:W38S56:energy` `{"td":0,"cs":0,"ua":83316316}` 在 ≈86,900 拍里恒不变，
  而同期物理面交付了 5 万量级能量 —— **两者同时为真、互不矛盾**。
  ⇒ 任何以 `td/ua/cs/li` 为判据的验证**按构造失效**（我 R231 前挂的就是这条错判据）。
- **仍在生效的部分**：`logistics-planner.ts:276-278` 读侧反序列化 + 两端-storage 安全闸；`planner.ts:68-104` 由合同派生
  `scope:"empire"` 请求；`agenda-manager.ts:481-526` 把请求建成 Operation（含 `transferable ≥ amount` 的 TOCTOU 闸）。
  ⇒ 合同**能发活**，只是**永不记账**，也没有降级/完成/取消状态流转。
- **已知缺陷**：#106（接线 or 删除，**属人**；删前须确认无别的读者）。
- **优先级**：P2。

## 4. 市场与运费分桶（`domain/market/*`、`accounting` 桶）

- **实现状态**：`LIVE_VALIDATED`（分桶）；**净亏与否属人**
- **线上验证**：#76 分桶上线并判效；**30 发占空比实测**：7/31 窗有费、`feeMean=736` ⇒ 平均拖累 **≈3.3/拍**（=G4 门槛 66%）。
- **已知缺陷 / 风险**：`minEnergySellPrice=0.02` **无距离项**，而运费占货值 69%~87%；`credits≈1,150 万` 时仍在卖 ⇒ **#76 属人**。市场对我**只读**：从不下单、从不撤单。
- **优先级**：P1（可回收净流，但不该由我擅自动营收线）。

## 5. 控制器保级与升级（`room-state` 锚点、`upgrader`、`demand.upgraderClamp`）

- **实现状态**：`LIVE_VALIDATED`（含**两次**整圈复证）
- **机制依据**：RCL8 设计上不常驻 upgrader；`[10000, >15000]` 迟滞带自动救援。
- **线上验证**：#52 第一次预测差 17 拍命中；**第二次 flag true@83396584 / false@83396784，预测差 39 拍**（`core-downgrade-band.log` ENGAGE-PASS）。
- **已知缺陷**：#93 上线前**算不出"离下一级还差多少"**（`progressTotal` 不落盘）；`upgraded` 桶是**能量**、进度是**进度**，比值 ≈2:1，不可互相换算定罪。
- **优先级**：P0（幼房 RCL5 是当前扩张的长期闸）。

## 6. 调优引擎与参数自调（`systems/empire/tuning-engine.ts`）

- **实现状态**：`LIVE_VALIDATED`（限"↑ 不可绑定必被撤"这一条）
- **线上验证**：**#85 判效窗收满 = PASS**（9,000 拍 ≈18 次评估机会内无 `code=3` 存活；判据唯一 FAIL 形状未出现）。前置检查：单二进制 `ea4c69da6f8b`==本地；通道活着 `ti n=300 avg=0.000`。
- **已知缺陷 / 诚实边界**：PASS **不能**证"binding 没误伤**可绑定**的 ↑"（本窗一次 ↑ 都没放行 ⇒ 那条连方向都没测）；`ti` 只覆盖窗口尾 2,990 拍（1/3）。
- **优先级**：P1。**下一问**：等一次被放行的 ↑ 活过验证（#79/#68 同族）。

## 7. 自进化 L1：strategyOverrides（`strategy-reviewer.ts`）

- **实现状态**：`IMPLEMENTED`（修复未部署）；**现场风险已量化**
- **线上现状**：`warPatience=8000`（生效 **111,645 拍**）、`minDwell=1400`（**405,345 拍**）vs CONFIG `5000/1000` ⇒ 无过期机制时**永不自撤销**。
- **修法**：消费侧读时过期 `TTL=15,000 拍`（`1bc67c9`+`e4dae12`）；测试 12/12 绿 + 两层反向实验（各恰好 3 红 / 3 绿）。
- **⚠️部署含义（必须写清方向）**：撤销自改 = **松绑** ⇒ 同样压力下**提前 ≈3,000 拍授权进攻性战争**。R183 已有现场实例。
- **优先级**：P1；**决定权在 owner**（L0 §1.5：主动战争属须授权行为）。

## 8. 防御与军事执行链（`military/*`）

- **实现状态**：`TESTED`（**不是** LIVE_VALIDATED）
- **现有测试**：引擎级 e2e —— 22-war-ledger（授权 + 战损界）、21-decoy-auth（拒诱饵）。
- **线上验证**：塔在修墙被误判为"漏账"→ 已结案为设计（#53/#80）；**但**"能打仗"至今无现场证据：`posture=war` 挂 2,233 拍期间 `combat=0`、`warPlan` 不存在（`mk:R194B`，第二发复证，判为设计行为）。
- **层次错配（09-30 记）**：进 war 靠 NPC 目击，选靶要玩家房 + 新鲜情报（`targetFreshness:1500`、`maxTowers:3`）。
  ⚠️**这条已被下一条取代**——错配要两边都在路径上才咬得到。
- **⚠️进攻选靶链从生产链上进不到（#99 写单测时实证）**：`deriveOperationType()` 对 10 个 `ThreatIntent`
  只返回 `DEFEND | ESCORT | RETREAT` ⇒ `isOffensive()` 恒 false ⇒ `deriveTarget()` 必走防御支、
  目标＝**受威胁房本身**；`selectTarget()`（连同 `occupied/blacklist/targetFreshness:1500/maxTowers:3/maxDistance:10`
  四道进攻闸）唯一调用者是手递进攻夹具的 `tests/unit/military/war-planning-a5-3.test.ts`。
  推论三条：①上一条的"错配"今天咬不到，因为根本没有选靶发生；②帝国今天**没有进攻能力**
  （不会主动打任何一间房）——这比 #95 更上游；③#95 的"零计划"只可能由 `noThreats` 解释，
  "候选被筛光"不是它的解释。
- **已知缺陷**：#95（复证中的设计行为；按上条更正后它连"选靶失败"这一支都没有）、#92（代价属人）、
  **#96 上线前战损不可长程归因**（环 846 拍 / 保险丝 400 拍）、**#99 漏斗计数已实现但随批未推 ⇒ 线上还没有这份读数**。
- **优先级**：P1。**`LIVE_VALIDATED` 的前置**：需要**真实敌情**，而我不制造敌人（L0 §1.5 + 我的既定禁令）。

## 8b. 进攻性打击与选靶（`domain/military/target-selection.ts` + `war-planning.deriveTarget`）

- **实现状态**：**`NOT_WIRED`**（domain 有完整实现与单测，**生产链上进不到** —— 这不是"未验证"，是"未接线"）
- **入口 / 链**：`scoreTarget()`（7 维加权）+ `selectTarget()`（硬过滤 `occupied`/`blacklisted`/`intelAge>targetFreshness`/`towers>=maxTowers`/无主）→ 由 `deriveTarget()` 的**进攻支**调用，而进攻支的进入条件是 `isOffensive(opType)`。
- **为什么进不到（R211 逐分支穷举）**：`deriveOperationType()` 对 10 个 `ThreatIntent` 在"核心房/远矿房"两条 switch 里**只返回 `DEFEND | ESCORT | RETREAT`**；`isOffensive()` 要求 `ASSAULT/RAID/SIEGE/CONTROLLER_ATTACK/REMOTE_DENIAL/CLAIM` ⇒ 恒 false。`war-posture.ts:226-228` 的授权表里**有**这些进攻类型（说明设计意图存在），但没有生产者会产它们。
- **线上同向证据**：两波真进犯产出的计划都是 `operationType=DEFEND`、`targetRoom=` **自家受威胁房**（W38S56@83399844 squadSize=9；W37S58@83400214 squadSize=32；`spawned` 都是 0）。
- **现有测试**：`tests/unit/military/war-planning-a5-3.test.ts` 手递进攻夹具 ⇒ 支路本身有覆盖，**但夹具不是产线调用者**；`tests/unit/military/war-funnel.test.ts`（#99）把"候选池为空仍出计划"钉成断言，防的就是我把这条链当成在跑。
- **已知缺陷 / 待裁决**：**#100 属人**——要么给 `deriveOperationType` 增加进攻分支（=新增战争能力，L0 §1.5 需授权，会真改变对外行为并引入战损风险），要么承认它是储备并把状态标在这里。我不自批，也不为取证制造敌情。
- **`LIVE_VALIDATED` 的前置**：出现一次 `warPlan.operationType ∈ {ASSAULT,RAID,…}` 且 `targetRoom` 非我方房。

## 9. 工业链（lab / factory / boost，`systems/industry*`）

- **实现状态**：`LIVE_VALIDATED`（第一次跑通并入库：`storage.XGH2O=100`、累计 ≈195）
- **已知缺陷**：`factory.level` 本服 `undefined` 已修（`?? snapshot.rcl`，`c6cceb2`）；**买料产 `wire` 单价倒挂 ~60 倍** ⇒ "继续不发布需求"是**正确态**（判效方向曾被我读反）；boost 零赋值也是正确态（要 `compound ≥ 130`）。
- **优先级**：P2（收益被行情卡住，不是被代码卡住）。

## 10. 恢复（recovery / crisis / 灾后备建）

- **R222 补（本轮审计）**：入口/出口都活着（`phaseToColonyState` + `Memory.rooms[].phase.bandTicks` 住 Memory ⇒ 部署安全），
  但动作侧有两个洞：**#103** 物流/网络/健康维度三类失败节点不带 `room` ⇒ 它们的动作按构造全部走 `GLOBAL_ROOM` 显式跳过
  （跳过本身是 `recovery-execution-system.ts:25` 写明的安全政策，来历是 :20-24 那次 −126K credits 的烧钱事故 ⇒ 别改守卫）；
  **#104** 恢复冷却的唯一写者 `recordRecoveryAttempt` 零调用者 ⇒ `isOnCooldown` 恒假（缓解项是住 heap 的幂等表，部署归零）。
  两者取证都靠新落的 **#105** `stats.recoveryRejections`（拒因跨部署存活，本地 `8cb8b5f` 未推）。/
  另记 5 个住 heap 的恢复计时器（`recoveryActionTable/recoveryBeforeStates/recoveryCooldowns/__consecutiveStableTicks/__totalFailuresDetected`）＝#13 类老坑又一实例。

- **实现状态**：`TESTED` + 局部 `LIVE_VALIDATED`；**判定回流侧 `NOT_WIRED`（#110，R247）**
- **⚠️"恢复的三条反馈全断"（R247 逐条 grep 到调用形状，全部 `[我核]`）**：能检测、能升级、能宣告"不可行"，但三条判定**都不回流到自己的行为**——
  ①**阈值不可达（按构造）**：`evaluateRecoveryUnviability` 的"投入 > 5000"要求 `totalInvested > 5000`，而**全仓没有任何"投入能量"的测量者**：
    `invested` 在恢复链只出现 4 处 = 接口字段(`recovery-lifecycle.ts:590`) + 阈值(`:626`) + reason 文案(`:629`) + 唯一调用方传的**字面量 `totalInvested: 0`**
    (`recovery-execution-system.ts:1072`) ⇒ `0 > 5000` 恒假。且注释写"且无改善"、代码里没有"无改善"这条 ⇒ 注释与实现不一致。
  ②**判定只落日志**：`if (unviability.unviable) log.info(…)` —— 不写状态、不抑制、不持久化；`recommendation`（"abandon recovery … mark as permanently degraded"）**零消费者**。
  ③**台账零读者**：`Memory.kernel.escalations` 唯一写者 `:1042/:1050`，`src/` 里没有任何地方读它（只有我离线的 `batch2-gate-and-push.sh` 提到）。
  ④**跨部署遗忘**：`totalAttempts` 取 heap 决策表（每 boot 归零）⇒ 阈值">10 次"实际够不到；现场 `attempts` 只有 2 和 3，而同一动作已 `repeats=5`。
  **现场代价（非假想）**：`terminal_trade`（global/mineral）`firstAt=83363952 → lastAt=83403762, repeats=5` ⇒ ≈39,800 拍里重复升级同一动作从不被抑制；
  而 `TERMINAL_TRADE` 正是那次 **credits −126K/40 分钟** 事故的通道（那次之后落地的是"按缺口闸收窄"，**不是**"按重复次数收窄"）。
  **最便宜的第一刀不需要新数据**：`repeats` 已在 Memory 持久化 ⇒ "同 (room,domain,actionType) `repeats ≥ N` 就不再提交"可直接实现；
  但**抑制恢复尝试本身是方向性安全决策**（抑制过头＝该救的不救），属人，我没动（三种形态列在 #110）。
- **线上**：幼房被推平道路后从 crisis 自愈（#30/#37 判效）；`recoveryEligible` 让 war 下军事规划不被 CPU 档位筛掉（读码）。
- **已知缺陷**：#55 已撤销（recovery 掐掉出口那判被现场反证）；#57 等一次真停摆收全判据。
- **优先级**：P1（官服挨打是常态，恢复就是生存）。

## 11. Power Creeps 与高级实体（L0 §3.7）

- **实现状态**：`IMPLEMENTED`（`power-creep-manager.ts` 在场），**线上状态未核查**
- **诚实标注**：本会话**没有**为它取过任何读数 ⇒ 不升档、不猜状态。**下一轮该做的**：核心房已 RCL8（Power 生成前置满足），去核 `GCL/Power` 是否积累、`powerCreeps` 是否有实例、管理器是否被 CPU 档位筛掉。
- **优先级**：P2（不卡生存，但它是 L0 明列的覆盖项，不能被"经济忙碌"挤掉）。

---

## 12. 侦查与情报体系（`domain/intel.ts`、`systems/room-observer.ts`、段 5）

- **游戏机制依据**：视野外的房间不可判断；扩张与打击都建立在"这份情报还新不新"之上。
- **实现状态**：`TESTED` + **采集/落盘侧已 `LIVE_VALIDATED`**（`stats.intelCoverage` 实测可读）；**消费侧仍 `TESTED`**（war 选靶与扩张候选池如何筛这份数据，线上无证据）
- **代码入口 / 调用链**：`room-observer.ts`（每 50 拍刷新邻居情报，C2）→ `domain/intel.ts` 的 `getRoomIntel()`（**宿主我本轮没查到定义位置**，见"下一件事"）→ 两个消费者；另有 `segment-store.ts:31` `SEGMENT_INTEL_PLAYERS = segId("intelPlayers", 5)`，形状 `{epoch, players}`（`:337` 段不可用时退化成 `{epoch:0, players:{}}`）。
- **⚠️两个新鲜度阈值，别混（口径纪律）**：
  - **扩张执行侧**：`plan-adapter.ts:166-171` `isIntelStale()` 用**硬编码 10,000 拍**，且注释规定"**从未观测过 = 不算过期**"（把判断让给后面的 claim 闸）。
  - **战争选靶侧**：`CONFIG.war.targetFreshness = 1,500 拍`。
  ⇒ 同一条情报在两条链上"新鲜度"差 **6.7 倍**；引阈值必写消费者是谁。
- **依赖模块**：`RawMemory` 段调度、`expansion/plan-adapter`（`GATE_INTEL_STALE`，`execution-gate.ts:155-156`）、`military/war-planning-system`（选靶）。
- **现有测试**：`tests/unit/intel/intel-state.test.ts`、`tests/unit/intel/confidence.test.ts`、`tests/unit/systems/intelligence.test.ts`、`tests/unit/economy/intel.test.ts`（均在 `tests/unit` 5214 用例全绿内）。
- **线上验证情况**：**未取得**。`peek rooms.W37S58.intel` ⇒ **不存在**；所以"Memory 路径"这个假设先被否掉（大概率在段 0/段 5，或该键已换名）。**不给 `LIVE_VALIDATED`。**
- **已知缺陷 / 疑点**：~~**#95 的选靶闸正卡在这里**~~ —— **已被 §8 下一条否证**（选靶链今天进不到，段 5 有主无主都不改变 warPlan 的有无）。
  仍成立的一半：段 5 的 `players` 决定的是**扩张与侦察**侧对玩家房的判断，与 war 选靶无关。
- **⚠️本轮把这条推进了一大步，但结论是"不可诊断"，不是"没有敌人"**（11:3xZ，两处读码 + 一次实测）：
  1. **房情报完全活在 heap**：`intelligence.ts:34` 是模块作用域的 `roomEntries`/`playerEntries` **Map**，由 `:54-58 adoptHandoff()` 从 `globalCache().intelHandoff` 采纳（`room-observer` 是生产者），`:187-188` 还会 `ageRooms` + `capRooms(INTEL_ROOMS_CAP)` 裁剪。
     ⇒ 段表里**根本没有"房情报"这一段**（`segId` 序列：0=**layout**、1=cpu、2=eventLog、3=economy、4=prometheus、5=**intelPlayers**、6=l2Intake）⇒ **"段 0 存房情报"这个我此前一直在用的假设是错的**。
  2. **`intelStats()`（`:149` 返回 `{rooms, players}`）不落盘、也没人调**（grep 只命中它自己的定义）⇒ `peek` 读不到（不在 Memory）、console 也读不到（模块作用域，同 `CONFIG` 那发 `ReferenceError`）。
  3. **实测段 5：从未写入**（新工具 `intel-players.mjs`，失败形状与空值分开报）。⇒ **这既可能是"从没见过玩家房"**（`adoptHandoff` 只在 `payload.owner` 存在且非 `INVADER_USERNAME` 时才 upsert 玩家），**也可能是持久化路径从未触发**——**两者读数上不可区分，所以现在不能给 #95 定罪，也不能给它结案**。
  ⇒ **净结论（本块前半段作废，以这里为准）**：**情报层是有事后观测的** —— `intelligence.ts:183-196` 在老化批处理里每 **`AGING_INTERVAL=100` 拍**把 `{rooms, players, tick}` 写进 **`Memory.kernel.stats.intelCoverage`**。
  现场实测（tick 83399903）：**`{rooms: 7, players: 2}`** ⇒ 这层**活着、在恢复、可读**。
  ⚠️**我上一条("零事后观测")是错的，且错因值得记**：我 grep 的是 `intelStats()` 这个**函数名**（确实没人调），但持久化是**内联**写的（`const statsAny = (Memory as any).Kernel?.stats` 直接赋 `intelCoverage`）⇒ **"grep 函数名找不到调用者" ≠ "没有落盘"**。这与 `gateStore` 别名、`tmp/tools/` 观测器是同族第三次。
  仍然成立的两点：①**房情报本体只在 heap**（模块级 Map + `ageRooms`/`capRooms` 裁剪 ⇒ 部署清零，只有 `intelCoverage` 这三个数跨部署）；②`segId` 序列里**没有房情报段**（0=layout、5=intelPlayers），所以我"段 0 存房情报"的旧假设确实错了。
  一处小气味：这段落盘用的是 `(Memory as any)` 绕过类型（本仓别处已按 E-FINDING-09 清掉这种写法），且 `intelStats()` 成了**零调用者的重复实现** ⇒ 值得合并（不是缺陷，是债）。
- **对 #95 的直接影响**：`players=2` ⇒ "**war 却没有 warPlan**"**不再能用"根本没玩家情报"解释**。剩下的候选收窄成三条具体筛子：`CONFIG.war.targetFreshness=1500` 内是否新鲜、`maxTowers:3` 是否超、以及那 2 个玩家的房是否在我们的可打集合里。⇒ #95 保持 open，但**方向从"数据缺失"改判为"选择谓词"**。
- **CPU 成本**：`room-observer` 每 50 拍一次（历史归因里不是大头项）。
- **优先级**：**P1**（它是"作战"与"扩张"两条腿共同的上游；情报缺失会让两条腿同时静默，而静默看起来像健康）。
- **验收标准 / 下一件事（写死，别靠记忆）**：
  1. `grep -rn "getRoomIntel" src/domain/intel.ts` 找到**定义行**，确认它读的是段几（我本轮只确认了段 5 的名字与形状）。
  2. 用一发**带标记 console 探针**读 `RawMemory.segments[5]` 的 `players` 键数（段不在 heap 里，`peek` 走 Memory 端点读不到）。
  3. 若 `players` 非空 ⇒ 回 #95 查 war 选靶为何仍不产 `warPlan`；若为空 ⇒ #95 结为"正确行为"，本行升 `LIVE_VALIDATED` 的条件改成"观察到一次跨房情报被扩张或军事消费"。

## 13. 殖民执行链（`systems/empire/expansion/plan-adapter.ts` → `state-machine.ts`）

- **实现状态**：`LIVE_VALIDATED`（**一次**端到端自然完成，#32：开单→`COMPLETED` 13,300 拍）；`STABLE` 缺口＝第二次没有。
- **入口 / 链**：`expansionAllowed` 的唯一消费者是 `plan-adapter.ts:69` 的 `isEmpireReady`；执行侧一共 11 道闸
  （`execution-gate.ts:7-19`：plan_valid / candidate_valid / target_claimable / empire_ready / budget≥cost / core_safe /
  not_owned / no_concurrent_op / no_other_expansion / intel_fresh / threat_unchanged）。
  ⚠️**G4（净流）与 G6（CPU 档）不参与执行** —— 它们只在 `readiness.ts:191-216` 挡晋升到 WAITING_EXECUTION
  （`empire-economy.ts:314-321` → `expansion-planner.ts:200-202,228-231`）。⇒ "G6 红着也能执行已晋升的 plan"是设计，不是漏洞。
  另一条独立的执行门：`expansion-manager.ts:56-57` 要求 `ctx.budget.tier ∈ {healthy,guarded}` 且 `bucket ≥ 5000`
  （⚠️这与 G6 用的 `capacity.tier` 是**两个不同的 tier 轴**，别混）。
- **状态机现场形状**（`state-machine.ts`）：`plan-adapter.ts:123` 直接以 `"preparing"` 建档 ⇒ `:51` 的 `validating` 分支无写者、不跑；
  `:209-233` claiming→claimed 靠 `controller.my`，abort 走 STOLEN/TIMED_OUT(6000)；CP2 `:283-317` 要 `FIND_MY_SPAWNS`；
  CP3/CP4 `:416-474` 要 harvester+hauler/distributor（由**新房自己的** spawn 出，`spawn-manager.ts:406`；
  `submitPioneers:745-748` 只请求 worker/builder）；CP5+`canHandover` `:586-611`→completed。
  `:153-160` 的 `reservedEnergy` **从不落账**（代码注释自己承认）⇒ 是个装饰数，不是预算承诺。
- **sponsor 的真实弱点（本轮新证）**：sponsor = `plan.sponsorRoom` ← `discovery.ts:64-73` = **"哪个自有房的侦察兵持有这条 Intel"**，
  没有 spawn/RCL 校验；`CONFIG.expansion.sponsorMinRcl:5`（`config/index.ts:935`）**只被 `bootstrap-lane.ts:50` 消费，claim 路径不查**。
  失败形状：`state-machine.ts:672-673` 静默返回、`spawn-manager.ts:406` 无 spawn 直接返回 ⇒ **没有"sponsor 不能孵兵"这个信号**；
  有记录的只有 `abortExpansion:645-668`（UOEM 事件 + 20,000 拍拉黑 + 3 次失败后节奏暂停）。
  ⇒ 与 #13（已释放房当过 sponsor）同族，这条是它的机制解释。
- **执行期复检**：`plan-adapter.ts:66-98` 消费时重验 11 闸（TOCTOU）；在途**故意不再查** `posture/expansionAllowed`
  （`expansion-manager.ts:79-86`），只查视野/归属/威胁（`state-machine.ts:264-281,320-338,388-396,508-515`）
  ⇒ 开闸瞬间放行后，姿态回摆不会撤单（这是"长承诺"的设计代价，不是 bug）。
- **⚠️两道闸按构造永真通过（#102，我逐行核过）—— 一道已于 R220 接上真数据（本地提交 `58b1efa`，未推）**：
  `execution-gate.ts:136-142` 读 `hasConcurrentOp`、`:160-166` 读 `threatEscalated`，而唯一产线调用点
  `plan-adapter.ts:71/:74` **写死 `false`**（作者注释"简化"）。
  **现状**：`threatEscalated` 改由 `isTargetThreatEscalation(ctx, plan)` 提供 ⇒ 三件 RED 生效
  （目标房威胁 creep / 目标房敌方塔 / sponsor 正被打），7 条用例钉住，含两条控制组（干净目标、只有 move 的
  过境单位都必须是放行）。判据取 `shouldAbort`（RED）而不是 `level!=="GREEN"`，两条理由都来自读代码：
  预约这类 YELLOW 已被更硬的 `GATE_TARGET_CLAIMABLE` **取消整条计划**（用例已断言），在这层再判会把同一件事
  同时做成"取消"和"暂缓"；而候选房周围有预约/过境是常态，要求 GREEN 等于造一把几乎不可满足的闸。
  **`hasConcurrentOp` 仍写死 `false`**：它的语义"同类 Operation"与真读 `Memory.kernel.expansion` 的
  `hasOtherExpansion` 高度重叠 ⇒ 要么删闸要么补生产者，两种都是政策改动，**属人，我没顺手删**。
  同处第三件小事：`getExecutionProgress` 表键是大写而 Memory 状态是小写 ⇒ `progress` 恒 0，
  但 `executionDashboard` 除写者外**零消费者** ⇒ 按"不在决策路径上的读数"结案，不单独立部署。
- **测试覆盖**：纯夹具（`tests/integration/expansion/a3-3/a3-4-e2e.test.ts`、`tests/unit/expansion/a3-*-contract.test.ts`
  —— 只 import domain 函数，**不跑系统**）；单拍系统级（`tests/unit/systems/expansion-outcome.test.ts` 等，手拼 Memory）；
  **唯一真多拍引擎跑**是 `tests/e2e/scenarios/20-claim-chain.test.ts`，但它断言的只有"无 JS 错误 + Memory 体积"，
  状态转换是打日志不是断言 ⇒ 与 e2e-known-red 那条纪律同源：**这条链的"能跑完"没有自动化作证，只作过一次现场自然完成**。
- **优先级**：P0（扩张腿的执行半边）。**升级 `STABLE` 的前置**：第二次自然完成 + 把 `GATE_THREAT_UNCHANGED` 接上真数据（属人，且要等 P-A 实验落地后再动）。

## 14. CPU 调度与预算：两条同名不同物的 tier 轴（`kernel/scheduler.ts` vs `domain/strategy/capacity.ts`）

- **实现状态**：`LIVE_VALIDATED`（两条轴都在跑且读数可引）；**命名隐患记入本行，不单独立部署**。
- **轴 A｜实时预算档** `ctx.budget.tier`：词汇 `healthy|guarded|conserve|recovery`（`contracts.ts:6`），
  生产者是 `scheduler.ts`（阈值单一真相源 `CONFIG.cpu.tiers[*].min`，`:10-13`；`voluntaryDrain` 会把 recovery 抬成 conserve，`:39-40`）。
  消费者是**动作级**与**恢复级**：`builder.ts:26`、`repair.ts:142/336-337`、`build.ts:22/26/57`、`telemetry-collector.ts:133/145/526`，
  以及**扩张执行门** `expansion-manager.ts:56-57`（`∈{healthy,guarded}` + `bucket≥5000`）。
- **轴 B｜帝国容量档** `Memory.kernel.capacity.tier`：词汇 `abundant|comfortable|tight|constrained`（`capacity.ts:3`）——
  **与轴 A 一个字都不重叠**，所以混淆的后果是"查错档位"而不是"读错值"。
  生产者 `empire-strategy.ts:169`（输入由 `pickCpuUsagePerTick` 选：优先 `cpuRate.total`，否则回退偏高的 `cpuAvg10`），
  转换处 `:230-241` 会打日志。消费者：`empire-economy.ts:310` ⇒ **就绪度 G6 就是这一轴**、
  `remote-mining-manager.ts:131/283`（远矿运营档）。
- **为什么这条值得单独一行**：同一天里两条轴**正在取不同的值**（现场：轴 B `capacity=tight since=83387005` ≈13,700 拍，
  轴 A `调度 tier=healthy`）。⇒ 任何"CPU 不够了，所以 X 被挡"的句子都必须写明是**哪一轴**：
  G6 挡晋升用轴 B，plan 执行门用轴 A，远矿扩档也用轴 B。日志里裸写 "tier=" 的三处分属两轴。
- **依赖模块**：`cpuRate`（拍尾每拍采样，`windowTicks/unsampledTicks` 决定可用性与累计口径）、bucket、`CONFIG.cpu.borrow`。
- **已知缺陷 / 疑点**：①G6 的门槛是 `0.6×min(limit,tickLimit)=12.00` 定值，现场 `cpuRate.total=14.44/拍` ⇒ **缺 2.44/拍**，
  而唯一杠杆 `CONFIG.remote.maxOperations` 约省 2.27–2.43/拍（#50 属人，代价＝19.9/拍远矿收入 + 120 段已建路）；
  ②加第三房 ⇒ 固定项按房走 ⇒ 缺口变大（#45 的结构性成本结论）；③累计型读数必须**差分**（`cpuRate.total` 是 boot 以来累计，直接读会把趋势抹平——已踩过三次）。
- **优先级**：P1。**`STABLE` 前置**：一次 G6 由红转绿的完整观测（tier 翻 + `since` 前进 + 缺口的独立差分核算三者同拍成立）。

## 15. 房间运营与防御工事（`construction-manager` / `layout-planner` / `defense-planner` / `repair`）

> **核验等级标注**（本行的诚实口径）：`[我核]`=今夜逐行看过源码；`[注释自证]`=代码注释自己写明；
> `[未复看]`=子代理报告、我未逐行验证 ⇒ 只可当线索，不可当结论。

- **实现状态**：`LIVE_VALIDATED`（建造管线本身：幼房从 3 只到 RCL5 全程由它产出结构，#32/#37/#39 都经过它）；
  防御工事半边是 `[我核]` 的**设计澄清**而非验证。
- **入口 / 链**：任务由 `layout-planner`（核心/物流/道路）与 `defense-planner`（rampart）**两个作者**写入 `Memory.rooms[].buildQueue`；
  唯一创建 site 的地方是 `construction-manager`（全仓只有它调 `createConstructionSite`）`[我核]`。
  现场静止态：`rooms.W37S58.buildQueue=[] spawnQueue=[] phase=steady rcl=8`（13:19Z peek）⇒ 今天队列是空，不是被饿住。
- **⚠️防御工事的关键事实：这个 bot 不建墙，只建 rampart，而且这是**故意的**（三条一起读）**`[我核 + 注释自证]`：
  1. `construction-manager.ts` 的 `isRuntimeDefenseWallTask` 把**所有** `STRUCTURE_WALL` 且键以 `defense.mincut.` 开头的任务**拒绝创建**，
     注释理由是"防止不可逆围城继续扩大"（把自己的通行权砌死是不可逆动作）。
  2. `defense-planner.ts` 现在发的是 `defense.mincut.rampart.<x>.<y>` 键，并且自己的注释写明
     "旧格式 `defense.mincut.wall.*` 也匹配前缀检查，由 construction-manager 阻断"。
  3. 但 `CONFIG.construction.maxWallSitesPerRoom: 2` 的注释原本写着"min-cut v3 割集顶点改用 wall（阻挡通行）"
     ⇒ **配置注释与代码相反**，照它推理会得出"防御线用墙"的错结论。今夜已把该注释改成指向真实行为（**零行为改动**，随批走，不单独部署）。
  ⇒ 遗留的惰性面：墙名额仍在配额函数里按 `structureType===STRUCTURE_WALL` 生效，但今天没有任何任务类能走到它，
  只有历史/人工留下的墙任务才会被它统计——**不是缺陷，是死名额**。
- **布局模式**：`CONFIG.layout.mode="constraint"` 的**唯一消费者**是 `layout-planner.ts` 把它传进 `planCoreStage` `[我核]`
  ⇒ `template` 那条分支（`domain/layout/planner.ts` 的固定模板路径）是**按配置休眠**，不是没接线：
  `domain/layout/planner.ts` 确实被 `layout-planner.ts:47` import。
  ⚠️我撤了子代理两条过头结论：①"segment `overrides` 无产线写者"错——系统侧 `layout-planner.ts` 会把
  `result.overrideWrites` 写回 segment 并标脏；②"template 分支不可达⇒整套是死码"错——它是 mode 选中的备选实现。
  ⇒ 纪律再确认：**子代理的"无写者/无调用者"报告必须自己复看**，这是第二次它把活的说成死的（第一次是 #98 的 `intelStats` 内联写者）。
- **已知缺陷 / 待办**：#69（`layoutGaps/layoutMetrics` 留着流产扩张的 471k 拍冻值）、#75（超配 link 只认 source 角色）、
  #82（layoutMetrics 通道已重接线 PASS）。
  **三条待核已复看结案（都是"看着像缺陷，其实是命名/历史残留"）**`[我核]`：
  ①`developmentGate()` **不是第二套门禁**——它是对 domain 纯函数 `evaluateDevelopmentGate` 的薄封装
  （`construction-manager.ts:248` 的 `:255` 就是转调，`:242` 的注释自己写明"逻辑已下沉"），
  活路径直接调 domain 那条（`:109`）。⇒ 只有**命名漂移**：全仓十余处注释仍写 `developmentGate`，
  读注释找门禁的人会先找不到真判据。不改代码（改名会牵动 10+ 处注释且零行为收益）。
  ②`dismantleCount` 确有**两份宿主**：产线走的是 `roomMem.dismantleCount`（`layout-planner.ts:502` 写、`:879` 读进 layoutMetrics，
  即 #82 那条 PASS 的通道）；而 `link-system.ts:252` 写的 `globalCache().dismantleCount`（Map）**无任何读者**，
  它自己的注释（`:244-248`）却声称"layout-metrics 消费此计数"。⇒ **注释说谎 + 孤立仪表**，不在决策路径上，
  按量级结案（与 #17 的 drift/industrialSpend 同一处置）。要清就清仪表，别把它当缺陷去改行为。
  ③**link "hub" 可被填不可被排——复看完，结案为 #75 的机制解释，不另立案**`[我核]`：
  `classifyLinkRole`（`domain/economy/links.ts`）只在**距所有 source/controller/storage 锚都 >2** 时才回落到 `"hub"`；
  传输规划 `planLinkTransfers` 按角色配对（source→controller/storage、storage→controller），**hub 既不在 from 也不在 to 名单**；
  hauler 的排空动作是具名的 `withdrawStorageLink()`（`roles/hauler.ts:162` 那条"永远最先"），upgrader 抽的是 controller link
  ⇒ **hub 没有任何排空消费者**。而灌入侧 `dumpToNearbyLink`（`actions/dump.ts:6-20`）**只看距离与空位、不看 role**
  ⇒ 几何上矿工可以把它灌满。死资产检测又只认 `role==="source"`（`link-system.ts:113`）⇒ 这种 link 连"被判定为闲置"都不会发生。
  ⇒ 这正是 **#75「超配 link 无处可计」**的下游机制（超配的 link 若落在 hub 类：不被路由、不被排空、不被检测），
  所以**这是同一个案，不是新案**。今天两房是否存在这样的 link：**未证**（需要布局锚点数据或一次 console，本会话刻意不打）。
  回归立案条件：若读到某间房有 link 且 `role==="hub"` 且其能量长期非零，则 #75 从"无处可计"升级为"无处可计且真的在压能量"。
- **优先级**：P2（管线本身活着；风险集中在"文档/配置与代码相反"这一族）。

## 16. 零生产导入者的 domain 模块（R233 筛出的 33/225，状态标签的对照表）

- **筛法**：对 `src/domain/**` 每个非 `.d.ts` 模块 grep `src/` 里按 basename 的导入者，零命中即候选。
  假阳性当场排过两次：本仓 `src/domain` 只有一个 barrel（`tactical/index.ts`，不是任何候选的父目录），
  且对 4 个候选做了"去后缀全文 grep"复看（自身与 tests 之外零提及）。
- **A 档 · 有单测但产线进不到（16）**：`economy/contract-lifecycle`、`economy/contract-node-bridge`、`economy/resource-flow`、
  `economy/role-transition`、`economy/route-efficiency`、`expansion/colony-dashboard`、`expansion/execution-dashboard`、
  `expansion/execution-operation`、`expansion/roi-tracker`、`logistics/delivery-validation`、`operation/preemption`、
  `operation/replan`、`operation/stability`、`operation/transport-planner`、`remote/container-lifecycle`、`remote/opportunity-ranking`
- **B 档 · 未接线也未测试（17）**：`logistics/{adaptive-routing,backpressure,batch-sizing,death-recovery,demand-batching,emergency,fairness,hauler-scaling,overdelivery,partial-delivery,reliability,request-lifecycle,rerouting,route-suspension,starvation}`、
  `economy/reconciliation`、`strategy/empire-balance`
- **⚠️对矩阵本身的含义（这是本节的唯一用途）**：**判 status 只看 `src/` 调用者，不看 tests。**
  A 档全部有单测、`recordDelivery` 甚至被断言过交付累加逻辑，但它绿着而产线零调用者 —— 写进矩阵就成了 `TESTED`，
  给下一轮发假信号（R231 我就被这块化石骗了一次，见 §3b）。
- **两条不许外推**：①**不是性能问题** —— 无导入者 ⇒ 打包器不带进 `dist/main.js` ⇒ 删与不删对线上 CPU/内存零影响，
  代价只在维护与验证真相；②**"零导入者"≠"该删"** —— `expansion/execution-*`、`operation/*`、整片 `logistics/*`
  像是后续阶段的设计前置。**接线 or 删除属人（#107）**；若删，按纪律先存 diff。
- **优先级**：P3（真相维护），但**排在任何一次矩阵刷新之前** —— 不先剔掉这类标签，矩阵会继续对外冒充能力。

## 17. 外交与敌我判定（L0 §3.5 的"竞争"面，R235 首次入矩阵）

- **实现状态**：情报侧 heap **`LIVE_VALIDATED`（在写，10 拍采样）** / 冷存侧 **`LIVE_VALIDATED`（落盘且内容已解出，R246：epoch 在推进、players=2、敌意列全 0）** / 政策侧 **`NOT_WIRED`**（没有任何消费者读它）
- **在跑的一半**：`domain/intel.ts:437 upsertPlayerObservation` 被产线调用两次 —— `systems/intelligence.ts:62`（活动信号）与
  `:80`（敌对信号 `hostile=true`）⇒ 每个玩家记 `{owner, lastSeenAt, lastHostileAt(单调前移), rooms{房→tick}}`，
  经代码设计应落段 5（`config/index.ts:54` id=5、在 `ALL_SEGMENT_IDS` 里）——
  ⚠️**R239 二次更正**：上一轮我据"段 5 为空"撤过这条，**那次撤销本身是错的** ——
  `intel-players.mjs` 读的是 `body.segments["5"]`，而端点在**单段请求**下把内容放在
  **`body.data.segments["<id>"]`**（一次请求带多个 `segment=` 会退化成每段 1 个字符的桩，这是我这轮踩到的第二个坑）
  ⇒ 原路径恒 undefined ⇒ 无论有无数据都打印 EMPTY。改成正确路径后：**段 5 存在，191 字符**（段 2=22,414、段 3=26,970 当次同批读通）。
  ⇒ **冷存在落盘、内容已解出（R246）**：载荷就是**裸 JSON**（`{epoch, players:{owner:{lastSeenAt,lastHostileAt,rooms}}}`），
  正确路径是**单段请求 + `body.data` 本身就是内容字符串**（`Object.keys(字符串)` 会给字符下标、`data["5"]` 会给第 6 个字符 —— 我这两处都错过）。
  实测 `epoch=83405703 players=2`、两个 owner 的 `lastHostileAt` **都是 0**。⚠️`intel-players.mjs` 的逐玩家打印行字段名仍错（`lastAt=?`），
  **字段值要读原始 JSON**；存在性/键数/epoch 可信该工具（它已过段 2 阳性 + 段 7 阴性对照）。
- **⚠️采样相位上限（R246，引"按人数据"前必读）**：`intelligenceSystem` 节律 `PARENT_INTERVAL=10`（`intelligence.ts:41`）
  ⇒ 被动威胁采样每 **10 拍**一次。今晚两发武装进犯（`83402215` 在场**恰好 10 拍**、`83404813` 约 **70 拍**）之后按人域仍无新键：
  70 拍那发至少 6 次采样机会却仍无键 ⇒ **只能由 `intelligence.ts:79` 的 owner 排除解释**（`!owner || owner === "Invader"`，按构造跳过 NPC）——按已证记；
  10 拍那发**可能与相位错开而根本没被采样** ⇒ 不判。
  ⇒ **两条后果**：①按人域对 NPC/Invader 类行凶者**没有键**；②即使补上键，**≤10 拍的突袭仍会漏采**。
  而尾税是按 `lastHostileAt + threatWindow(5,000)` 给的（10 拍在场换 5,000 拍税 = **500 倍**）
  ⇒ **#92 的分档不能建在按人域上**，只能建在房级威胁记忆自己的属性（在场时长 / 是否造成损伤）。
- **缺的一半（逐条 grep 过，不是推断）**：**所有**威胁记忆消费者读的都是**房级、不认人**的 `Memory.rooms[].lastHostileAt` ——
  `empire-strategy.ts:57`（喂 posture ⇒ war 尾税）、`tower-defense.ts:223`、`fortification.ts:79-83`、`room-profile.ts:283`。
  **零个消费者**读 `PlayerIntelEntry.lastHostileAt`。⇒ 按人归因的数据写了、存了，然后没人用。
- **敌我名单**：`CONFIG.defense.allies = []`（`config/index.ts:589`）是全帝国唯一的"非敌"机制，
  消费者 `room-scans/targeting.ts:23`、`room-snapshot.ts:64`、`plan-adapter.ts:203`、`state-machine.ts:322`、`blocker-intel.ts:29`、
  `threat.ts:13` —— 但它**运行期无写者**（grep 只有读），也不在 `strategyOverrides` 的可寻址路径里 —— `resolveStrategyOverrides(...)` 只被 **spread 进 posture options**
  （`empire-strategy.ts:89-96` 那条 DEFAULT→CONFIG.posture→环境基线→overrides），而 `allies` 是上面那六个消费者
  **各自直接读 CONFIG** ⇒ 自进化 L1 没有任何路径能把某个玩家移出"敌对"集合（不是"还没学会"，是**寻址不到**）。
  ⇒ **外交 = 人编辑一个空数组**：没有宣战/停战/中立声明，没有"观察到的和平邻居"降级机制。
- **与本文件其它条的关系（为什么这条不是学术问题）**：§8b（无进攻能力 #100）+ 本条合起来 = **帝国的"竞争"只剩被动挨打**；
  而 §2/#92 那条尾税的形状是"不认人"：一次 10 拍的武装访问（R234 实测）⇒ 5,000 拍扩张税，
  **且换任何一个别的玩家来打也一样计**。修法所需的数据已经在了，缺的只是一个消费者 —— 属人（#108）。
- **优先级**：P1。

## 18. Pixel 与 Boost 链（L0 §3.7/§3.8 的最后两行，R236 补齐）

- **一句话**：**两条链都接完了线**，两条都不在当前活跃执行，而且**原因不同族**——
  按 R231/#106 立的三分法：pixel = **配置切走（休眠实现）**，boost = **被前置条件拒绝（缺料 + 缺消费者）**。
  两者都**不是**无写者、不是接线缺口。
- **Pixel（`systems/empire/pixel-system.ts`，`bootstrap.ts:172` 已注册，interval 10）**：
  `CONFIG.pixel.enabled` **自 2026-09-27 起为 false**（`config/index.ts:170` 那段注释就是判决原文）——
  ①`generatePixel` 吃光 bucket 时若逢 global reset，bundle 加载成本 > tickLimit ⇒ 每拍加载即被杀、bucket 永不回充
  （**线上实测 187+ 拍停摆**）；②bucket 在本仓**首先是档位时钟**（healthy≥7000 / guarded≥3000 / conserve≥1000），
  借用额度只是附带的 6 点，一次放血 = 10000 全清。⇒ **这条"能力"是被有来历的决定关掉的，不是坏的**。
  闸链本身还有四道：`tier === "healthy"`（用的是 **scheduler 那条 tier 轴**，见 §14）、`posture !== "war"`、
  `stats.cpuMax10` 有写者（`telemetry-collector.ts:731`，不是化石）、`bucket ≥ CONFIG.pixel.cpuCost`。
- **线上证据**：`Memory.kernel.pixelAt = 83270902` ⇒ 该链**曾真的执行过一次**（约 132,000 拍前，按 3.06 秒/拍 ≈ 4.7 天），
  此后静默与 `enabled=false` 完全一致。⇒ `pixelAt` 是**最后一次成功放血的时刻**，不是"待生成"进度。
  `kernel.stats.pixelSold` **键不存在** ⇒ 卖出侧（`terminal-market.ts:564-588`）在本 boot 段没有成交记录（缺键 ≠ 坏了，见 §3 判读纪律）。
- **Boost（`lab-system.ts` 全链）**：请求 `evaluateBoostRequests`(`:385`) → `planLabs`(`:520`，
  boost 优先占 lab，RCL6/7/8 = 1/2/3 个 boost 位) → 报到拦截 `boost-report.ts`（写 `globalCache().boostAssignments`，
  `:543-557` 只在**化合物与 lab 能量都到位**时置 `ready`）→ `role-runner.ts:120` 让 creep 在 flee 之后、工作之前等就位 →
  **`lab.boostCreep(creep, parts)`（`:585`）真的存在**，且 `parts` 被**三重约束封顶**（矿物存量 / lab 能量 / 匹配部件数）——
  注释写明不封顶必然 `ERR_NOT_ENOUGH_RESOURCES`。反向还有 `unboostCreep`（`:351`）。
  ⇒ **接线完整**。当前不跑的卡点是 **#49 那条算术**：库存 `XGH2O = 0 < 门槛 130`、场上 **0 只战争角色**（没有可强化的 body），
  且反应线才刚爬到 `reactionTarget="G"`。**"boost 零赋值"是正确态**，别当缺陷去修。
- **可否证预测（留给下一轮）**：首炉 T3 化合物（`GH2O`/`XGH2O`）进 lab 且场上出现战争角色 ⇒
  `industryMem.boostedCreeps` 应开始变长、`creep.body[i].boost` 应非空。
  若两者都在场而 `boostedCreeps` 仍空 ⇒ 才回到"接线缺口"这一族重查。
- **状态标签**：两条均为 **`LIVE_VALIDATED`（曾执行）** / **`TESTED`+休眠（pixel 当前）** / **`LIVE_WIRED_UNEXERCISED`（boost 当前）**
  —— 用 §16 的措辞纪律：`WIRED` 说的是调用者存在，`EXERCISED` 说的是线上跑过；两者不许互替。
- **优先级**：P3（pixel 的开关属人已定过一次；boost 等首炉 T3）。

## 尚未入矩阵的能力 = 本文件的已知不完整性

L0 §3.1–3.8 列出的覆盖面**远不止上面 14 条**（§1–§14，含今夜补的 §8b 与 §13/§14；房间运营/基础设施、资源网络、宣言/联盟/外交、符号与 boost 全链…）。
**当前只登记了我能引用证据的条目。**其余按 L0 的纪律**必须标 `NOT_STARTED/DESIGNED` 才诚实**，而我没有逐条核过代码入口与调用链 ⇒ 所以**不填**（填了就是伪造）。
⚠️§8b 是第一条**状态为 `NOT_WIRED`** 的行——它是好消息式的诚实：不是"没测过"，是"产线上根本进不到"。后续若再核出这类，优先用它而不是 `TESTED`。
**§3b（供给合同写回链，R231/#106）是第二条**，且这一条比 §8b 更阴：它**半接线** —— 读侧与派单在产线上跑（合同能发活），
只有记账与状态流转进不到，所以现场看起来"功能存在但台账恒 0"。这类形状的识别方法记在该节：**先 grep `src/` 里的调用者，
零调用者 + tests 有导入 = `NOT_WIRED`，而不是"还没判效"**。
补齐次序建议（每轮 3–5 条，先核代码再落状态）：①殖民后的**房间运营子项**（construction/layout/link/distributor 那一族，最大的一块空白）→ ②外交/宣言（很可能整块 `NOT_STARTED`，那本身就是重要结论）→ ③符号与 boost 全链。（原②"情报"已落 §12、原③"CPU 调度"已落 §14、殖民执行链已落 §13。）

## 19. 自度量器的诚实性（R254/R256–R259 汇总，L0 §2.3 交付物的补角）
状态标签一律按**写者/消费者**判，不按符号名或注释。
- **自治度指标 = 60/100 权重此前不携带证据，已修一半**（`#112`，`37e7aa2`，`WIRED+TESTED` 非 `EXERCISED`）：
  ①`__autoRecoveredFailures` 此前每 10 拍累加**整表快照** `succeededCount`（succeeded 记录保留 500 拍）⇒ 一次成功被计 ≈50 次，
    `recoveryRate`（25 分）长期饱和；修复＝`computeRecoveryStats` 增 `succeededThisTick`/`recoveryTimeThisTick` 并让消费侧吃同拍增量。
  ②`__perturbationCount`/`__totalRecoveryTime` 零写者 ⇒ `autonomy-metrics.ts:185` 恒走"无扰动=满分"（15 分）；**本修复首次给它们接上写者**。
  ③`manualInterventions` 硬编码 0（需 console hook）⇒ 20 分仍按构造满，**未修**（作者声明的盲区，未起手）。
  消费者只有 `empire-health-system.ts:219` 的日志 ⇒ **不挡任何闸**；改完自报自治度会**下降**（撤虚高），不可读成"恢复能力退步"。
- **#104 的旧标签作废**（本文件 §10 仍带"恢复冷却唯一写者零调用者"那行，以本条为准）：
  `recovery-priority` **在生产路径上**，执行侧已有 `shouldSubmitAction(…, getRetryPolicy(action.type).cooldownDuration)` + `maxAttempts` 的按类型阻尼；
  那张 `CooldownTable` 是**第二处、且按构造恒空**的重复阻尼层。⇒ 处置是"删恒空支路（今天行为零变化）或上收 policy"，属人；
  **接写者会引入缺陷**（`isOnCooldown` 不看 `lastSuccess`、key 是 `domain:room` 而非动作 id ⇒ 硬编码 200 拍会连带抑制同房同域的其他动作）。
- **计量读数的两条通用护栏**（今夜各撞过一次）：
  (a) `economy.bk` 每房是**各自的 50 拍窗**（看 `economy.t`），逐窗跨房配对按构造不成立 ⇒ 跨房成对只用累计差分；
      `bk` 只列非零键 ⇒ **缺支出键的窗会把净流抬高**（核心房实测 6.57→13.66→27.94/拍，主因是采样窗换了）。
  (b) **Memory 端点是 flush 门控的**：18:52 与 18:54 两次读 `kernel.gateNetFlow` 逐字节相同（其间 watch3 tick 已 +200）
      ⇒ "读数没动"≠"仪器没在算"，凡慢仪判据都要按 flush 采样多次，别用一次相同值否证趋势。
      推论：R258 那条"G4 ≈9~13 分钟带"**本会话无法确认**（会话只有几分钟），它只能由 `posture-exit3.log` 的 `Blocked=` 在往后一小时内免费记录；
      我不把它当已证结论，也不在任何地方引用它当"已翻绿"。

### §19 补（10-04 R290–R299，本会话）：三台自度量器拿到了现场证据，另一台写进了**分辨力上限**
状态一律按写者/消费者与现读判定，不按符号名。
- **E7 的两类分裂 = `EXERCISED`**（原 `WIRED+TESTED`，本会话首次在线上同时读到两类并看到它们各自翻转）：
  `kernel.expectations.violations` 原文 03:42 为 `siteStaleNoWorker:W36S58:*`（`workers=0`）×3 +
  `siteStaleWorkerIdle:W37S57:*`（`workers=4`），04:03 同一房翻回 `siteStaleWorkerIdle:W36S58:*`（`workers=2`、`noProg=8,012`）。
  ⇒ 两类的**可行动性不同**已被证实：`NoWorker` 那一支后来自己消失（编制回来），而 `WorkerIdle` 留在原地不推进；
  所以看到 `WorkerIdle` 不要去动编制，看到 `NoWorker` 不要去动射程/取活。
  ⚠️列表是 `slice(0,10)` 的人读截断 ⇒ 其中的条数只能当下界，计数一律取轮询器的 `siteStaleTotal`。
- **脚下建路账本 = 可信的第一因读数（两次闭合到单位）**：`W36S58 calls 11,186 = noEnergy 3,216 + outOfRange 7,912 + built 58`，
  ~400 拍后差分 `+231 = +79 + +152 + 0` 仍逐位闭合；`W37S57 +246 = +233 + +12 + +1`。
  ⇒ "这一拍为什么不施工"现在是可以读、不必再推理的。新列 `noEnergyInRange`（`0d8e1db`）状态 = **`WIRED+TESTED`，未上线**
  ⇒ 线上读不到那个键是**未部署**，不是"收益为零"（本轮亲验：`kernel.stats.roadBuild.*` 无此键而线上 sha 未变）。
- **drift 逐窗拆账 = 已验证 + 带分辨力上限**（这条是本节的重点，因为它把"能不能信"变成可算的东西）：
  仪器 `tmp/tools/official/drift-dist.sh` + `drift-dist-report.cjs`（零 console）；核心房 8 窗里
  **有 `bk` 的 7/7 窗 `drift` 由 `harvested/bought/imported/recycled − spawned/upgraded/built/repaired/towerSpent/sold/exported/tradeFee` 逐位复现**
  ⇒ 三条口径自此可靠：字段清单、`pickedUp 不在 income`（#40 修复在字段层）、`bk = 本窗增量`。
  但**分辨力必须一起写**：`mean=+440`、`sd=1,427`、`se=505` ⇒ 95%CI **[−549, +1,429]**；
  要把 CI 收到 ±300 需 `n≈87` 窗 ≈ 4,300 拍（实测拍长 3.7 秒 ≈ 4.5 小时）。
  ⇒ 结论级别到此为止：**50 拍窗的 drift 既证不出"漏账"，也证不出"没漏账"**；
  谁要用 `ws` 那条「同量级 ⇒ nf/G4 不可信」下结论，得先付上面那个样本量，或改用长视界 `kernel.gateNetFlow`（τ≈5,000 拍，现成）。
- **护栏 (a) 加强一条**（本会话实测）：Memory 端点不只是"flush 之间不变"，**同一次 flush 内两次读数会逐字段完全相同**
  ⇒ 判据必须按**内容键**去重（我用 `(pl 两端, dr)` 作键，实测抓到 1 个真重复），
  相邻性也不要靠 `Δt==N`，要靠池面链（上一窗 `trackedEnd === 本窗 trackedStart`）——
  后者还能在 `t` 那行恰好是坏读数时救回整个窗（八窗里有两窗是这样回来的）。

## 20. L0 §3.1–3.8 覆盖对照（R301 首次做成"可核的表"，状态只按调用形状判）
方法：`grep -rF '<name>('`（调用形状），不是符号命中。符号命中只算"存在文本"，**不进状态**。
三档：`WIRED`=有生产调用点；`ZERO`=调用形状零命中（缺口）；`UNRESOLVED`=两条模式给出不同答案、必须人读那一行才能定性。
- **ZERO（本轮可负责的缺口，§3.5/§3.6/§3.7）**
  · `InterShardMemory` **0** ⇒ §3.7 的跨 Shard 机制**完全没有**（不是没接线，是没有调用形状）。
  · `generatePowerCreepFromSpawns` **0** ⇒ Power Creep 的**生成/升级链不存在**；但 `processPower` 有 9 处命中且 `domain/economy/power-processing.ts` 在册
    ⇒ 形状是"**收 Power 而不造 Power 单位**"，这条要么是有意的政策、要么是缺口，**本轮不裁决**（政策应有注释或 CONFIG 记录，我没找到）。
  · `StructurePortal` **0**、`clone(` **0** ⇒ Portal 与复制类行动完全未覆盖（§3.7）。
  · `.extract(` **0** ⇒ 矿物开采链不存在；`extractor` 有 53 处文本命中、`mineral` 423 处 ⇒ **是"围着它搬运/存储但不采"的形状**，与 §3.5"Lab/Mineral"的部分覆盖一致。
- **WIRED（有调用点，不代表线上跑过）**
  · `activateSafeMode(` 2 处（`systems/room/recovery-execution-system.ts`、`systems/military/tower-defense.ts`）⇒ Safe Mode 接线；线上是否激活过属另一档。
  · `createOrder(` 1 处（`systems/trade/terminal-manager.ts`）⇒ 市场下单接线（本 bot 对市场是**只读**策略，见 §4）。
  · `boostCreep(` 2 处（`systems/room/lab-system.ts`）⇒ Boost 接线（先前一轮我按 `boost(` 搜到 0 就差点把它记成缺口——**搜错形状会造出一个假缺口**，这条按规矩记在这里）。
  · `.launchNuke(` 1 处 ⇒ 核弹发射**有调用点**（先前按符号看以为只是备料）；战争授权链是否允许它走到这一步属 §8/§3.6 的事。
- **UNRESOLVED（诚实标注，不当结论用）**
  · Observer：`grep -rF '.observe('` 给 **0**，而 `grep -rnE 'observer\.observe|\.observe\('` 给 **1**
    ⇒ 说明那一行不是标准的 `x.observe(` 形状（可能是属性访问或不同拼写）。**我没读那一行，所以不定性。**
    这条之所以重要：#100（攻击面缺"他人有主房的 fact 级侦察"）的候选修法里就有"用已排进 RCL8 模板的 Observer 侦察"——
    若那 1 处其实是活的，修法就从"新写"变成"接上"；若不是，`STRUCTURE_OBSERVER` 在 `layout/templates/compact-core-v2.ts:155` 与
    `constraint-placer.ts:85` 有槽位却无人调用，就是**建了也不用的死槽位**（属 §16 那一族）。**下一个人读那一行即可结案。**
- **§3.8 的"八项记录"仍未逐机制做**（官方规则/前置/输入输出/资源成本/CPU 成本/API/失败条件/模块关系）。
  本表只做到"覆盖与否"，**没有**做到八项 ⇒ §2.3 交付物里 §3.8 那一半**仍是未完成**，这条不粉饰。

### §20 更正（同会话，R302）：Observer 那条 `UNRESOLVED` 现在**读过了那一行** ⇒ 改判 `ZERO`，并直接改写 #100 的取舍
两处命中都不是调用：`creeps/engine/actions/harvest.ts:227` 是把 `s.observer` 当**存储容器**遍历（与 storage/terminal/factory/powerSpawn 并列），
`systems/room/room-state.ts:222-229` 的 `observerSightings` 是**我方侦察 creep 的目击计数**——同名不同物（本项目 §14 那族"两条同名轴"的形状）。
⇒ `StructureObserver.observe()` **确认零调用**，而 `STRUCTURE_OBSERVER` 在 `layout/templates/compact-core-v2.ts:155`（rcl8 槽位）
与 `constraint-placer.ts:85`（priority 2）在册 ⇒ **形状是"楼会盖，盖好没人用"**，属 §16 那一族的实例。
**这条把 #100 的取舍改写了一半**（原三条：给他人有主房加 fact 级侦察 / 先修情报持久化 #109 / 接受无攻击面）：
Observer 是**不派 creep 就能拿到目标房视野**的机制（引擎侧 1 拍 CPU、无移动成本、无战损风险），
而它的建筑槽位已经在 RCL8 模板里 ⇒ 修法的性质从"**新写一条侦察能力**"降级为"**接上已有楼的一个调用**"。
⚠️仍未验证的两件事，别当成已就绪：①核心房**是否真的盖出了 Observer**（模板有槽位 ≠ 已建成，需一次 `FIND_MY_STRUCTURES` 或
`Memory` 侧读数；本轮零 console 没取）；②Observer 视野只进**当拍快照**还是要落段 5/冷存才够 fact 级——后者连着 #109（段 5 线上为空，
按人归因的敌意记忆不跨部署）。⇒ **#100 仍属人**，但现在能给出一条更便宜的候选路径和它缺的那两块砖。
（记法照旧：`UNRESOLVED` 不是结论，读完那一行才升档；这次升档同时把一个 pending 请示的选项集缩小了。）

### §20 第二次更正（R303）：Observer 那条**我判错了两次**，正确结论是"能力在、持久化与射程不在"
错因：`StructureObserver` 的方法名是 **`observeRoom(roomName)`**（docs.screeps.com/api/StructureObserver 已核），
而我按 `observe(` / `.observe(` 去搜 ⇒ 命中 0，于是先把"没接线"当候选、又"确认"成 `ZERO`。
**同一条假缺口我造了两次**（§16 族、上一轮 `boost(` 也是同形错误），所以规矩要升级：**先拿到引擎真实方法名（docs 或 `@types/screeps`），再搜调用形状**。
实际代码（现读）：
- `src/systems/room-observer.ts:142` `if (observer.observeRoom(target) === OK)` ⇒ **调用点存在**；
  `:37` 与 `:148` 写明"视野只存续下一 tick"，系统 `interval` 必须为 1，并有下一 tick 的捕获分支。
- `:118-140 requestObservation()`：靶子来自 `Game.map.describeExits(homeRoom)` ⇒ **只打 8 个邻房**，
  优先级＝"从未有视野（sources 未知）> 陈旧超阈"，公路房跳过；**没有按"是否他人有主房"加权**。
- `:102-113 submitObservation()`：结果进 `globalCache().intelHandoff`（heap，满则 `shift()` 丢最旧）。
⇒ 所以 `ZERO` 撤消，正确分档是：
| 环节 | 状态 |
|---|---|
| Observer 楼与 `observeRoom()` 调用 | **WIRED**（`room-observer.ts:142`） |
| 下一 tick 视野捕获 | WIRED（同一文件，interval=1 的注释即为此约束） |
| 侦察结果**持久化到按人归因的记忆** | **缺口**：只进 heap 环形缓冲，部署即清（与 #109 段 5 线上为空同源） |
| 邻房以外的目标（2+ 房外） | **缺口**：`describeExits` 只给 8 邻居；引擎射程是 **10 房**（docs 已核），代码只用 1 层 |
| 玩家有主房的**优先级** | **缺口**：靶子按"未知/陈旧"排，不按"敌情价值"排 |
**引擎事实（docs 已核，写进矩阵以免再猜）**：`hits 500`、建造需 **controller level 8**、造价 **8,000**、射程 **10 rooms**、
`observeRoom(roomName: string)` 返回 `OK`；错误码 `ERR_NOT_OWNER / ERR_BUSY(区域内有敌人) / ERR_NOT_IN_RANGE / ERR_INVALID_ARGS / ERR_RCL_NOT_ENOUGH`；
**该页未给 CPU 成本与冷却** ⇒ 这两项仍是未记录项，不许引用成"已知便宜"（我上面写"1 拍 CPU"属未经核实的口头数，一并撤回）。
**对 #100 的净影响**：原候选"接上已有楼的一个调用"**作废**（调用早就在）；剩下的实质是
①把 `intelHandoff` 落到段 5/冷存（连 #109）②把靶子扩到射程内非邻房并给敌情权重。两条都比"新写侦察"小，但都比"加一个调用"大。

### §20 的 `ZERO` 列**自绑一条纪律**（R303 附）：未经 docs/@types 核过方法名的行，一律降级为"待复核"
`Observer` 那次错案的根因是**我猜了方法名**。同一批 `ZERO` 里有几条用的是我脑内的名字，必须按同一规矩重核后才准引用：
- `.extract(` ⇒ **待复核**：现代引擎里矿物是 `creep.harvest(mineral)` + `Extractor` 的组合，**未必存在 `extract()` 这个方法**；
  若如此，"矿物开采缺口"就是我又一次假缺口。要判得搜 `harvest(` 对矿物目标的用法与 `STRUCTURE_EXTRACTOR` 的建造/存在性。
- `generatePowerCreepFromSpawns` ⇒ **待复核**：引擎侧名字在不同版本里变过（`spawnPowerCreepFromSpawns` 等），须先定名再定档。
- `clone(` ⇒ **待复核**（Power Creep 的复制 API 名同样需要核）。
- `InterShardMemory` / `StructurePortal` ⇒ **相对可靠**：前者是全局对象名、后者是结构常量名，都不是"方法调用"，
  但它们的**能力判定**还应看 `getShardRules`/`findExit`+portal 移动这类实际入口，不能只凭这一行。
- 可靠的只有一条：`observeRoom(` 命中 1（`room-observer.ts:142`）——因为它的名字是从 docs 取来的，不是猜的。
⇒ 本节因此**不产出任何"能力缺口清单"级别的结论**，只产出"该用什么名字去查"的待办；
`§3.1–3.8 覆盖对照` 的完成度也据此下调：**当前只做完了"有调用点"那一半，"没有调用点"那一半大多还没核名**。

### R304：`§20` 的 `ZERO` 列**大面积是假缺口**——按真名重搜后，矿物开采与 Power Creep 生成都已接线
我上一节刚写下"先取真名再搜形状"，这一节就用它推翻了自己两条 `ZERO`。证据都是现读的：
- **矿物开采链存在且完整**（我先前搜 `.extract(` 得 0 就记成"不存在"，而引擎根本没有 `extract()`：docs 的 `StructureExtractor` 页写明
  采集靠 **`harvest`** 动作、每次附 **5 tick 冷却**，由 `cooldown` 属性表达；`@types/screeps` 里也只有 `harvest(`，没有 `extract(`）：
  · `src/creeps/roles/mineral-miner.ts:16-19` —— 专门的采矿 role，注释还处理了 `extractor` 冷却返回 `ERR_TIRED` 时"置 idle 而非卡死"；
  · `src/creeps/engine/actions/harvest.ts:271-272` —— 从 `snapshot.minerals[0]` 取靶子；
  · `src/systems/room/layout-planner.ts:268-269` —— 布局把矿物点当规划输入；
  · `src/creeps/roles/hauler.ts:183` —— 能量装完后有余量再补矿（接力到 `extractor` 旁 container）；
  · `terminal-manager.ts:337`、`terminal-selfaid.ts:155`、`terminal-market.ts:162,431` —— 市场侧按 `mineralType` 决策。
  ⇒ 这条不是"缺口"，是**已实现并在被下游消费**。`harvester.ts:27` 还特意**不**让主力采油者离岗去采矿物（经济断流的防护），
  这说明"谁去采"是被想过的，不是遗漏。
- **Power Creep 生成存在**（我搜的是 `generatePowerCreepFromSpawns` / `createPowerCreep`，真名是静态方法 **`PowerCreep.create`**）：
  `src/systems/empire/power-creep-manager.ts:23` 有引擎能力守卫
  （`if (!Game.powerCreeps || typeof PowerCreep?.create !== "function") return;`），`:37` 调 `PowerCreep.create(plan.pcName, "operator")`，
  `:39` 成功即记 `EventKind.PowerCreepMilestone`。⇒ 分档 **WIRED**（是否在线上真跑出过单位是另一档，本会话未验）。
- **`InterShardMemory` 这条 `ZERO` 站得住**：名字在 `@types/screeps` 里确认存在（6 处声明），而 `src/` 内 0 命中 ⇒ 跨 Shard 机制确实未用。
  这是本节**唯一**一条我用"真名 + 零调用"两个条件同时卡过的负向结论。
- **仍待复核**（不再当缺口引用）：`StructurePortal`/portal 移动、`clone(`、Observer 的"射程只打邻房/无持久化"三条里，
  只有"结果只进 heap 的 `intelHandoff`"和"靶子取自 `describeExits`"是读码得到的，其余需要按同一流程先定名。
### ⇒ `§2.3`/`§3.1–3.8` 覆盖对照的真实完成度（把话说到底）
**我先前那张"缺口清单"里，能留下的只有 `InterShardMemory` 一条。**
其余所谓缺口全是我用错方法名造的假阳性，而它们本来会被拿去影响 #100（攻击面）和 §3.5（高级经济）的判断。
所以这一节现在的价值不是"发现了缺口"，而是**给出了一张可用的入口图**：`observeRoom()`/`harvest()`/`PowerCreep.create()`/`boostCreep()`/
`launchNuke()`/`processPower()`/`activateSafeMode()`/`createOrder()` 都在，且我知道该去哪个文件读它们的消费者。
八项记录（§3.8）只做了 Observer 一项，其余七项未做 ⇒ **§2.3 交付物仍远未完成**，这个判断不因本轮更正而改变。

---

## §20 第三次更正（R321，10-04 12:4x–12:5xZ）：§20 第二次更正点名的**两件"仍未验证、别当成已就绪"**，一件现已取到现场读数、另一件被代码**否证**

### ① 「核心房是否真的盖出了 Observer」⇒ **已验证：有，且全帝国只有一座**
矩阵在 R302 写的原话是"模板有槽位 ≠ 已建成，需一次 `FIND_MY_STRUCTURES` 读数；本轮零 console 没取"。这一发现在有了（mark `R318A2`，t=83423379，表达式只用引擎真名 `FIND_MY_STRUCTURES` + `STRUCTURE_OBSERVER`）：

| 房 | RCL | 我方 spawn | **Observer** | Observer 工地 |
|---|---|---|---|---|
| W37S58 | **8** | 3 | **1** | 0 |
| W38S56 | 5 | 1 | 0 | 0 |
| W38S58 | 2 | 0 | 0 | 0 |
| 其余 6 房（远矿视野房，非自有） | 0 | 0 | 0 | 0 |

⇒ `compact-core-v2.ts:155` 的 rcl8 槽位**确实建成了**；`WIRED` 那一行现在升为 **`EXERCISED` 的最低档以上**（楼在现场存在）。
同时给 #100 定死一条边界：帝国的另外两口房是 **RCL5/RCL2**，而 Observer 的前置是 **controller level 8**（docs 已核，见 R303 那节的引擎事实块）⇒ **"多几个观察源"不是今天的选项**，它是"把某口房推到 RCL8"的副产品，不是独立动作。今天帝国在侦察上就是一个观察源。

### ② 「侦察结果持久化 = 缺口（只进 heap 环形缓冲，部署即清）」⇒ **这条判断错了，撤**
我把**交接缓冲**当成了**存储**。现读三段（都是本轮/上一轮的读码，不是记忆）：
- `domain/intel.ts:243` `IntelSource` 里就有 `"observer"`，而 `:249` 的 `DIRECT_SOURCES` 把 **`observer` 列为可直接进入 fact 通道的来源**（注释原文："本源直接观测来源（可进入 fact 通道）"），`:316` 是读侧消费者（`isDirectSource(entry.source)` ⇒ 否则降 `inferred`）。**⇒ "observer 视野只进当拍快照、够不上 fact 级"这个怀疑被否证。**
- `systems/intelligence.ts:54-70 adoptHandoff()` 消费 `globalCache().intelHandoff` ⇒ `upsertPlayerObservation()`；`kernel/segment-store.ts:529-546` 再把 `segments[5]` 带脏标记落盘（含容量守卫）。⇒ heap 环只是**跨系统的一次性交接**，不是终点。
- #109 的结案与此一致：**段 5 线上非空、epoch 新鲜、三段链路读码闭合**，真问题是"数据薄（1 个玩家、`lastSeenAt` 旧 75.7 万拍）与采集面窄"，不是"没落盘"。
⇒ 所以 §20 那张分档表里 **"侦察结果持久化"一行从 `缺口` 改为 `WIRED（链闭合 + 段 5 线上非空）`**；剩下的短板是**输入侧的量**（一个观察源 × 4 邻房），不是存储侧的形。

### 净结论：#100 只剩两条实质出路，且我先把新仪器的**可证伪预报**写下（先写再读数）
射程那条仍然成立：引擎射程 **10 房**（docs 已核）而 `requestObservation` 的靶子取自 `Game.map.describeExits` ⇒ **代码只用了 1 层（4 个出口）**；权重那条也成立（按"未知>陈旧"排，不按敌情/扩张价值排）。
R318 的 `observeCounters`（未推）上线后，第一读要撞的是这个**现在就写死的**判据：
1. **预报 `noTarget / gate` 接近 1（≫0.5）**。理由按口径算：`OBSERVE_INTERVAL=25` ⇒ 一个观察源每 25 拍最多发一次；而 `INTEL_STALE_AFTER=2000` 且 `lastSeen` 只在**真有视野**时才前移 ⇒ 4 个邻房各约 2,000 拍才"变陈旧"一次 ⇒ 绝大多数到点拍次应当"无事可做"。
   ⇒ **若实测确实 `noTarget≈gate`**：诊断是**采集面被射程限死**，出路是"把靶子扩到 10 房射程内的非邻房"，**提权重几乎无用**（没活可排）。
   ⇒ **若实测 `ok` 频繁、`noTarget` 很小**：说明还有别的机制在制造陈旧（视野衰减/新房加入），那么**权重**才有意义，出路二优先。
2. `noObserver` 应只在 W38S56/W38S58 两房 >0；**若 W37S58 也 >0** ⇒ 不是"没楼"（楼已被 ① 证明存在），而是 `snapshot.observer` 这个字段没被快照填上 —— 那是另一个缺陷，且是这台仪器第一次读数就能分开的两种形状。
3. `codes` 若出现 `-15`(RCL 不够) / `-12`(超出射程) ⇒ 直接指到 ① ②两条里的一条，不必再猜。
**引擎侧仍未记录的两项**（照 R303 的诚实边界，不许引用成"已知便宜"）：`observeRoom` 的 **CPU 成本**与**冷却**在该 API 页没给 ⇒ 仍属未记录，别拿"1 拍 CPU"这类口头数去算扩容收益。

### §3.8 八项记录的完成度（本轮动了哪几项）
Observer 这一格的八项现在是：官方规则✔（docs：hits500/RCL8/造价8000/射程10房/返回码集）· 前置条件✔（RCL8 + 本帝国只有 1 座，实测）· 输入输出✔（靶子=describeExits 4 邻居；输出=intelHandoff→adoptHandoff→段5，链闭合）· 资源成本✔（造价 8,000，已建成⇒沉没）· **CPU 成本✘仍未记录**· 相关 API✔（`observeRoom(`，名字来自 docs/@types 不是猜的）· 失败条件✔（返回码集 + "视野只存续下一 tick" + `staleSlot/lostVision` 两桶已建）· 与现有模块关系✔（intelligence / segment-store / 扩张候选池 / 战争选靶）。
⇒ **八项里 7 项有据、1 项仍缺**；但 §3.1–3.8 的**机制覆盖面**仍远未完成（Observer 只是其中一格），`#97` 这条交付物继续挂着，不因本轮更正而宣布完成。

---

## §21 L0 §3.6「Safe Mode」的八项记录（R323，10-04）：唯一真出口在 `tower-defense.ts`，分层授权由架构守卫强制；**两处仍属未记录项**

> 名字与字段一律取自本地 `node_modules/@types/screeps/index.d.ts`（行号随本轮），不靠记忆造名。

| §3.8 要求 | 本轮记录 |
|---|---|
| **官方规则** | `Controller.activateSafeMode(): ScreepsReturnCode`（`@types:6025`）；相关属性 `safeMode?: number`（`:5993`，激活后的剩余生效拍数）、`safeModeAvailable: number`（`:5997`，可用次数）、`safeModeCooldown?: number`（`:6001`）。⚠️**本地 @types 不含数值规则**（造价、冷却时长、RCL 前置、每级可用次数）⇒ 这些仍是未记录项，**不许引用口头数**（与 §20 里 `observeRoom` 的 CPU 成本同一处理方式）。 |
| **前置条件** | 代码侧 4 条齐（`tower-defense.ts:380-385`）：`controller?.my && !controller.safeMode && !controller.safeModeCooldown && controller.safeModeAvailable > 0`。引擎侧数值前置：未核。 |
| **输入与输出** | 输入＝`RoomSnapshot.controller` + 三类触发场景（注释原文：①无塔且核心被突破；②有塔且核心结构正被拆毁／塔全空被突入；③**M11 舰队伤亡熔断**）+ 距离门 `CONFIG.defense.safeModeTriggerRange = 5`（`config/index.ts:599`，`tower-defense.ts:309/315/343` 用它挡掉无害过境 scout）。输出＝引擎返回码（**代码丢弃，见"失败条件"那行**）＋引擎侧状态变化（消耗 `safeModeAvailable`、置 `safeMode` 计时）。 |
| **资源成本** | 引擎侧：未记录（@types 无）。可现场读的代理量＝`controller.safeModeAvailable`，已被 `room-state.ts:447` 落进快照（`safeModeTicks` 同，`:448`）。 |
| **CPU 成本** | **未记录**（API 与本地类型都没给）。⇒ 若将来要把 safe mode 排进防御预算，这条得先补。 |
| **相关 API** | 除上四则外，`@types:1314` 另有 `generateSafeMode(target: StructureController): CreepActionReturnCode`（**其所属 interface 与在本服是否可用，本轮未核** ⇒ 不据它立任何"能力存在/缺失"的结论，这正是 §20 那条纪律的用法）。 |
| **失败条件** | 返回码是 `ScreepsReturnCode`，而 `tryActivateSafeMode()` **不读返回值** ⇒ `ERR_RCL_NOT_ENOUGH` / `ERR_BUSY` / 冷却未清之类失败**今天无处可计**：现象会是"防线被突破却什么都没发生"，事后读不出原因。这与 R318 给 `observeRoom` 建 `codes[String(code)]` 直方图是**同一个修法形状**（1 行计数，零行为改动），我没有顺手改码——本轮只做记录。 |
| **与现有模块的关系** | ①**唯一真出口**＝`systems/military/tower-defense.ts:386`。②`recovery-execution-system.ts:873-894` 只写 `defenseState.safeModeRequested/…Tick/…Reason` 三字段并注释"由 kernel 层在下…"，而**这三字段全仓零读者**——这不是新发现：**已立案为 `audit/` 的 K6**（`audit/VERIFIED.md:23`「✅成立，且更糟」、`audit/units/W23.md` 六步判定、`audit/MANIFEST.md:82`、`W07.md:236/242`）。⇒ 本轮**不重复立案**，只在矩阵里把两条出口连起来（真出口在防御层，恢复层的标志是惰性的）。③**分层授权由测试强制**：`tests/unit/tactical/a5-4-4-architecture-guards.test.ts:149`（Guard 5）禁止 `domain/tactical/*.ts` 出现 `activateSafeMode(` 调用（同条还禁 `move/spawnCreep/submitRequest/recycle`）⇒ 这就是 L0 §3.6「不得让战术代码直接绕过战略授权」的机制化实现，不是口头约定。 |

**为什么这条"最后防线"今天值得记**：扩张正在把幼房推到 RCL5/RCL2（`R318A2` 现场读数），而 safe mode 的可用次数与前置按引擎规则走 RCL 阶梯——**数值前置未核**就意味着：幼房挨打时这套机制会不会响，本矩阵答不了。补法两条都在记录里点名了（读返回码建计数；从 docs 核数值前置），都不属我这一轮能顺手做完的事。

**§3.8 八项的完成度（把话说准）**：目前做成 **2 项**——Observer（§20，7/8 项有据、CPU 成本缺）与 Safe Mode（本节，6/8 项有据、资源成本与 CPU 成本缺）。
`§3.1–3.8` 的**机制覆盖面**仍远未完成 ⇒ `#97` 继续挂着，本轮不宣布完成。

---

## §22 L0 §3.7「Power Creep 与高级实体」八项记录（R339，10-04 20:4xZ）：**机器全在、产出为零**——问题不是接线，是"链条从没跑通过一次"

现场读数（只读探针 mark `R339P2`，t=83430632）：`Game.gpl.level = 0`、`Object.keys(Game.powerCreeps).length = 0`、**`W37S58(RCL8) 有 powerSpawn 1 座`**（另两房 0）。
⇒ 顺带**作废代码里一句过期前提**：`power-creep-manager.ts:49` 注释写"帝国尚无 powerSpawn（RCL8 前）⇒ 全部运营无从谈起"——楼已经有了，那句话现在是**错的**（留着它会让下一轮把 gpl=0 归因成"没楼"，然后去等一个已经存在的东西）。

| §3.8 | 记录（全部现读，含文件行号） |
|---|---|
| 官方规则 | 本地 `@types` 有常量而无数值语义：`POWER_CREEP_MAX_LEVEL 25`、`POWER_CREEP_LIFE_TIME 5000`、`POWER_CREEP_SPAWN_COOLDOWN 28,800,000`（8h 毫秒）、`POWER_CREEP_DELETE_COOLDOWN 86,400,000`（24h）、`POWER_LEVEL_MULTIPLY/POW`、`POWER_INFO`(:860)、`POWER_CLASS`(:805)、`GlobalPowerLevel`(:1900)、`POWER_SPAWN_*`(:356-359)。⚠️**GPL 的增长公式、processPower 的 1 power+50 energy 配比在 @types 里无数值**（代码注释 `industry.ts:720` 写的是"1 power + 50 energy/次"，属读来的口头数，未经 docs 复核 ⇒ 记为未核）。 |
| 前置条件 | ①**结构**：powerSpawn（布局 `compact-core-v2.ts:157` 槽位、RCL8；`constraint-placer.ts:86` `phaseFor "rcl8"`）→ **已满足**（现场 1 座）。②**资源**：`RESOURCE_POWER` 库存（来源只有 Power Bank 掉落或市场买）→ **不满足（0）**。③**API 存在性守卫**：`power-creep-manager.ts:23` `!Game.powerCreeps \|\| typeof PowerCreep?.create !== "function"` → 私服安全，本服通过。④`Game.gpl.level` → **0**，而 create 需要 GPL ⇒ 链条从上游就断。 |
| 输入与输出 | 输入：intel 的 `powerBank` 布尔（`room-observer.ts:267/292` 采集，随 `STRUCTURE_POWER_BANK` 存在性；TTL 走威胁窗 `intel.ts:307`）。输出：`processPower()`（`factory-manager.ts:25-35`，守卫 `typeof powerSpawn.processPower === "function"`）→ GPL → `PowerCreep.create(name,"operator")`(:37)/`pc.upgrade(power)`(:44) → 事件 `PowerCreepMilestone`（**编码可分**：`[0]`create、`[1,power]`upgrade、`[2]`spawn，见 :39/:46/:60）。 |
| 资源成本 | POWER 本体（每房 `storage/terminal/powerSpawn` 三处库存由 `terminal-market.ts:487-489` 汇总）；`CONFIG.factory.powerSpawnPo…` 装填水位（`industry.ts:736`）；powerSpawn 能量地板 `config:987/992`（注释明说"GPL 是投资不是生存，余裕不足时让路"）。⚠️**买 POWER 的定价路径存在但优先级被置 0**（`terminal-selfaid.ts:85` `if (resourceType === RESOURCE_POWER) return 0;`，`terminal-market.ts:445` 在自采循环里 `continue` 掉 POWER）⇒ **市场这条腿是有意关着的**，不是漏接。 |
| CPU 成本 | **未记录**（无实测；`cpuRate.bySystem` 里 `power-creep-manager` 未进前 10 ⇒ 现值低于 ~0.12/拍，属推论不是读数）。 |
| 相关 API | `PowerCreep.create(`、`pc.upgrade(`、`pc.spawn(powerSpawn)`、`powerSpawn.processPower(`、`Game.gpl`、`Game.powerCreeps`、`STRUCTURE_POWER_BANK`、`RESOURCE_POWER`、`mission:"powerBank"/"powerCollect"`（`global.d.ts:105`）。⚠️名字全部取自现读代码或 `@types`；**没有一条是猜的**（§20 那三次假缺口的教训）。 |
| 失败条件 | `create` 返回非 OK（GPL 不足／同名存在）⇒ 静默，只有 `=== OK` 才记事件；`upgrade` 对未孵化 PC 有效、失败"静默等下轮"（注释原文）；`spawn` 的 `ERR_TIRED`＝死亡冷却；`resolveHomes` 为空 ⇒ 整个 ③④ 段 early-return（:49）；`pb-collector.ts:18/48` 背包满/空即退出该动作。**这些返回码今天都不进计数**——与 #119 同族（发出去了但没人知道成没成）。 |
| 与现有模块的关系 | 六段链条**都有消费者**：`power-farm-manager.ts:150` 据 `payload.powerBank` 选靶 → :196/:243 发 `attacker/healer`（mission=powerBank）与 `pbCollector`（powerCollect）→ `attacker.ts:207` PB 打击专用候选、`pb-collector.ts:33` 从 **ruin** 里 withdraw POWER（PB 被打死后落废墟，符合引擎语义）→ `industry.ts:755-760` 从 storage/terminal 取 POWER 装填 → `factory-manager.ts:35` 调 `processPower()`。战术层对 PB 编队**跳过集结语义**（`combat-micro-runtime.ts:125`、`tactical-runtime-system.ts:284/661`、`squad-movement-runtime.ts:289` 都显式过滤 `mission !== "powerBank"`）⇒ 这条链是被认真接过的，不是残骸。 |

**分档**：`WIRED`（六段全接、有守卫、有事件编码）／**`EXERCISED = 否`**（`gpl=0` 是聚合证据：这条链一次都没交付过 GPL）。
**因此 #3.7 的真问题被重新表述**（原来问"要不要接 Power Creep"）：链在，缺的是**第一次跑通**——上游是"帝国范围内有没有 Power Bank 可打"（外因，服务器刷）与"要不要开 POWER 的市场买入口"（现被 `terminal-selfaid:85`/`terminal-market:445` 显式关着，属人）。**两个都不是我能替的决定**，也不该为它造证据（去打 PB 会真发生战斗；开买入口会真花钱）。
**可判读的下一次签名（零改动）**：`Game.gpl.level > 0` ⇒ 链条至少跑通一次；`kernel` 事件环出现 `PowerCreepMilestone` 任意编码 ⇒ 相应分支真被执行；`storage/terminal/powerSpawn` 三处 POWER 库存（`terminal-market.ts:487-489` 那个和式）由 0 变正 ⇒ 上游回收或买入开始流动。

---

## §23 L0 §3.1/§3.2 交点「衰减与遗留物回收」八项记录（**标题经 R345 更正，原判归属见本节末**）（R345，10-05 05:1xZ）：**回收链四段齐全，但整条链不知道"寿命"这个量存在**

> 名字与常数一律取自本轮 `node_modules/@types/screeps/index.d.ts`（行号为现读），不靠记忆造名。
> 本节 **计数已由 §24 取代（5 项）**，原文保留：本节 **计数以 §23 为准**：§3.8 的八项记录当时为 **4 项**（§20/§21/§22/§23），**现由 §24 记为 5 项**；
> §21 末那句「目前做成 2 项」**自本节起作废**（它写在 §22 之前，属陈旧行而非我新造的结论）。撤的只有"计数"，§21 的八项内容不动。

| §3.8 要求 | 本轮记录 |
|---|---|
| **官方规则** | 掉落堆：`Resource` 注释（`@types:4501-4502`）「pile decays for **`ceil(amount/1000)` units per tick**」⇒ 是**绝对量随堆大小变、相对速率随堆大小反比**的非线性定律（100 单位堆＝1%/拍，5,000 单位堆＝0.1%/拍）。<br>坟墓：`TOMBSTONE_DECAY_PER_PART: 5`（`:767`，每具尸体按 body part 数扣 5 拍）＋`TOMBSTONE_DECAY_POWER_CREEP: 500`（`:768`）。<br>废墟：注释「**Usually decays in 500 ticks** except some special cases」（`:5439`）＋`ticksToDecay`（`:5458`）＋`RUIN_DECAY_STRUCTURES`（`:771`）。<br>建筑侧常数：路 `ROAD_DECAY_AMOUNT: 100 / ROAD_DECAY_TIME: 1000`（`:149-150`）、壁垒 `RAMPART_DECAY_AMOUNT: 300 / RAMPART_DECAY_TIME: 100`（`:107-108`）、容器 `CONTAINER_DECAY_TIME{,_OWNED}` **只声明为 `number`**（`:426-427`）、矿脉 `DEPOSIT_DECAY_TIME: number`（`:415`）、要塞 `STRONGHOLD_DECAY_TICKS: 75000`（`:858`）。 |
| **前置条件** | 目标必须**在快照里存在**：`room-snapshot.ts:96-97` 把 `FIND_TOMBSTONES/FIND_RUINS` **先按 `store.getUsedCapacity()>0` 过滤**再入快照 ⇒ 空坟墓/空废墟根本不进决策面（省 CPU 的口径，代价见"失败条件"）。<br>取矿物额外一条：`pickup.ts:86-88` 门禁——**无 storage 且无 terminal 时直接放弃矿物**（注释给出理由：唯一卸货出口 `haulMineralsToStorage` 需要二者，否则捡了无处倒、且配 `updateMode` 总量口径会把 hauler 冻住）。 |
| **输入与输出** | 输入＝`contracts.ts:194/198/201` 三列（`droppedResources / tombstones / ruins`，由 `room-scans.ts:59/78/94/105` 按拍缓存产出）。<br>输出＝`lootRemains(minAmount)`（`pickup.ts:49`）选出一个 `Tombstone|Ruin`，执行侧走 **`withdraw`（坟墓/废墟不能 `pickup`）**，取货量 `min(可用, 空闲)`。<br>排序键：range≤1 内**存量最多**优先，否则 `findClosestByRange`。 |
| **资源成本** | 引擎侧无造价。本仓的"成本"体现在**放弃的场景**：`minAmount` 过滤零头（注释原文：大额遗留值得专程，零头由链尾无阈值实例顺手清理）。⇒ 这条设计正好**顶在**上面那条非线性定律上（见"为什么值得记"）。 |
| **CPU 成本** | **未记录**——`@types` 没给 `FIND_TOMBSTONES/FIND_RUINS/FIND_DROPPED_RESOURCES` 的成本，本轮也没做线上标定 ⇒ 不许引用成"已知便宜"。已知的只有"三处 find 都在 `room-scans` 的按拍缓存里"（同拍复用，不重复发 find）。 |
| **相关 API** | `Resource.ticksToDecay`、`Ruin.ticksToDecay`、`Tombstone.ticksToDecay`、`Deposit.ticksToDecay`、`StructurePortal.ticksToDecay: number \| undefined`（`:6688`，**稳定门为 `undefined`**——这一条是防"把 undefined 读成 0"的既有坑位）。 |
| **失败条件** | ①执行侧有防护：取货量截到 `min(可用,空闲)`，注释写明是为了**避免 `ERR_NOT_ENOUGH_RESOURCES` 竞态把 creep 置 idle**。②矿物分支的 `return` 是**有意的空操作**，不是漏码。③真实盲区＝快照的 `store>0` 过滤与 creep 实际到达之间有拍差：遗留物可能在"被选中"与"到手"之间被他人取空或衰减殆尽，此时本轮决策无从归因（**过滤在前 ⇒ 事后看不见零容量目标**）。 |
| **与现有模块的关系** | ①`economy.ts:121-122` 把坟墓+废墟里的能量**算进 `loose`**（松散能量口径）——所以 #41「地上常年 ~1,000 能量」这一读数里含尸体存量，不含则低估。②`core-clearer.ts:35-75` 在远矿房 loot 废墟（`loot-ruin` 动作）——invader core 被毁必留 ruin。③`repair.ts:250` 是**全仓唯一**引用引擎衰减常数的地方（RAMPART 族），且只在注释里。 |

**两条负向结论（带搜过的确切形状＋名字来源，供复核）**
- `ticksToDecay` 的**属性读**在 `src/` 命中 0：本轮 `grep -n "ticksToDecay" src/` 只回到 `core-clearer.ts:31` 的一句注释（"资源随 ticksToDecay 灭失"）。名字取自 `@types`（上面五处声明）。
  ⇒ **本仓没有任何"按剩余寿命排序/择时"的机制**：回收优先级只有"最多"和"最近"两个键，引擎明明把寿命交到了手上（`Resource/Ruin/Tombstone/Deposit` 四个 `ticksToDecay`），我们一次都没读。
- `FIND_DEPOSITS` 与 `Deposit` 在 `src/` 命中 0（名字取自 `@types:1670-1682` 的 `interface Deposit`，含 `cooldown/lastCooldown/ticksToDecay`）⇒ **守护者矿脉（source-keeper 的 deposit）整条能力未用**。这与 #130（Power 线机器全在、产出为零）是**同形**的：能力存在、入口未接。

**⚠️ 一名两义陷阱（记下来，因为它就在本轮的 grep 结果里）**：`domain/logistics/walk-heat.ts:39` 的 `const decayed = Math.floor(value * options.decay)` 是**我们自己修路热度的 EMA 衰减**，与引擎对象衰减无关。
以后凡是 grep `decay` 得出的结论，必须先分清这两族，否则会把"热度冷却"读成"道路寿命"（这正是债单里"一个数据结构两种语义"那一族）。

**为什么这条今天值得记（不是为记而记）**：#41 与 #107 的口径都压在 §3.4 这层，而引擎定律是**反比**的——小堆相对衰减最快。
我们现在的"最多者优先"恰好把**相对最紧急的小堆**排在后面；设计里那句"零头由链尾无阈值实例顺手清理"是有意的缓解，
但**这条缓解没有读数**（回收成功率／零头是否真被清掉，本轮零取证）。⇒ 本节只到"知道有权衡、且权衡不可测"，不产出"该改排序"的结论。

**分档**：`WIRED`＝生产/快照/决策/执行四段都有调用点（上表逐行给位）。`EXERCISED`＝**本轮未取证**。
可区分两者的间接证据只有"掉落与衰减确实在发生"（#41 地面能量、#107 路 1 段/570 拍），那**不是**"回收成功过"的证据 ⇒ 按矩阵规矩记 **`UNOBSERVABLE-THIS-ROUND`**。

**零改动的下一发签名（挂表等，不制造条件）**：取一次已按 `name` 逐字锚定的 creep 死亡（事件环里有 `CreepDeath`），
比较死亡那一拍之后 `stats.energyLedger` 的 `pickedUp` 是否出现一次≈该尸存量（本服 CARRY=50×parts）的跳增。
命中 ⇒ `lootRemains` 判为 EXERCISED 一次；不出现 ⇒ 只能记"该次遗留无人回收"，**不能**记"回收机制坏了"（因为目标房可能压根没有具备空余载重 hauler，这一列今天无处区分这两种成因——那才是要不要给 §3.4 补计数器的真问题）。

**R345 更正（同轮）：本节原判"L0 §3.4"是错的。** 按 L0 原文核对 §3.1–3.8 列表时发现：§3.4 原文＝「扩张与帝国管理」，
而 §3.1 含「能量收支、资源库存及经济可持续性」「建筑规划、施工与维修」、§3.2 含「建筑损坏、资源耗尽和基础设施故障」⇒ 本节的掉落/尸体/废墟/路-墙-容器衰减**属 §3.1 与 §3.2 的交点**。
**成因值得记**："§3.4 掉落物与衰减"是我自己在交接文件里给选题起的**内部标签**，下一轮把它当成 L0 的正式编号引用，于是**我自己造的名字反过来给我自己的记录归了档**——与 §20 那三条假缺口（我按脑内方法名去搜）是同族错误，只是这次发生在**编号**而不是方法名上。
⇒ 规矩追加一条：**引用任何外部文档的编号前，回到那份文档把那一节标题读一遍**；自拟标签一律加"（自拟）"前缀。
**本节的证据、内容与两条负向结论都不因这次更正而改变**——错的只有归属标签。（计数另算：本节的 4/8 已被 §24 的 **5/8** 取代。）

---

## §24 L0 §3.3「跨房资源网络 / 供给合同层」八项记录（R348，10-06 07:4xZ）：**创建链活着、记账链整条死着——合同台账的 0 不是"没交付"，是"没人写"**

> 本节记录的是**本仓自研机制**（不是引擎 API）。引擎侧字段一律标"无引擎规则项"或"未记录"，
> 不许把口头数写进成本列。线上数字全部现读（`peek.mjs`，控制组同工具同形状先读通）。

| §3.8 要求 | 本轮记录 |
|---|---|
| **官方规则** | **无引擎规则项**——`SupplyContract` 是领域层自定义对象（`src/domain/economy/supply-contract.ts:60+` 的字段设计原则自述：瘦快照、只存 ID+数字+枚举、终态后归档）。物理交付靠 carrier/terminal，引擎侧对应关系见 §3.3 的搬运记录（`#42/#48` 已线上判效：两侧同窗等量入账）。 |
| **前置条件** | 文件头写明：`Contract 的 source 房每周期通过 **contract-node-bridge** 适配器注入为 SupplyNode、target 房注入为 DemandNode`；`recordDelivery` 的注释写明：`每周期由**系统侧薄壳**调用——传入本周期 deliveredAmount 之和`。⇒ **这两句都是"设计承诺"，本轮现读结论是：承诺的两个调用方在 `src/` 里都不存在**（见"失败条件"）。 |
| **输入与输出** | 输入＝房级净流/储备评选（创建者两处：`systems/room/logistics-planner.ts`、`systems/empire/specialization-planner.ts`，均真导入）。输出＝`Memory.kernel.supplyContracts`（缩写列 `i/s/t/r/tr/mr/p/st/ca/ua/ac/td/cs/dm/rs`，读侧 `logistics-planner.ts:263 collectContracts()`）。 |
| **资源成本** | 内存：每条 14 键、当前 2 条 ⇒ 可忽略。能量：本合同层本身不消耗。**CPU：未记录**（本轮没做标定，`route-efficiency.ts` 里 PathFinder 相关开销未测）。 |
| **相关 API** | 领域纯函数六枚：`isContractActive` / `isContractTerminal` / `recordDelivery` / `findActiveContract` / `computeCycleAmount` / 快照编解码；兄弟模块 `contract-node-bridge.ts`、`contract-lifecycle.ts`、`route-efficiency.ts`。 |
| **失败条件** | **三处零生产导入者**（本轮现跑 `grep -rln 'from "...<模块>"' src/`）：`contract-node-bridge` **0**、`contract-lifecycle` **0**、`route-efficiency` **0**。`recordDelivery` 的调用点只有 `tests/unit/economy/supply-contract.test.ts`（3 处），**`src/` 内 0 个写者**。⇒ 状态机（`active/degraded/completed/cancelled`）无人推进、交付字段无人累加。**这不是缺一次调用，是整条写回链从未接线**（`#106` 的重述）。 |
| **与现有模块的关系** | ①**同一名字两种语义（登记）**：`recordDelivery` 在 `domain/economy/supply-contract.ts:291` 与 `domain/operation/remote-mining-op.ts:342` **各定义一次**，签名不同、口径不同——以后 grep 这个词必须分两处读。②物理流另有其账：真实跨房交付由 carrier 完成并落进能量账本（`#42/#48` PASS），**与合同台账并行存在、互不相通**。③读侧存在但拿到的是零值输入 ⇒ 任何"按合同收紧供给"的下游今天拿到的都是创建时快照。 |

**线上读数（现读，`t≈83,455,155`；控制组＝同工具同形状先读到 `rooms.W37S58.phase = steady / reserve=854,002` 才承认下面的"零"有意义）**
```
contract:W37S58:W38S56:energy  st=A  td=0  cs=0  ca=ua=ac=83,316,316  ⇒ 冻结 138,839 拍（≈150 小时）
contract:W37S58:W38S58:energy  st=A  td=0  cs=0  ca=ua=ac=83,410,216  ⇒ 冻结  44,939 拍（≈49 小时）
```
`tr=180/340`、`mr=200,000`、`rs=network-surplus-deficit-pair`。⇒ **创建活着（第二条只有 4.5 万拍的年龄，说明今天还在生成新合同），台账死着（三条时间戳恒等、`td` 恒 0）**。
读侧要防的错：`td=0` 同时兼容"从没交付"和"交付了没人记"两种世界——**本次是靠两条独立证据把它判成后者**：`#42/#48` 的现场 `+1,200/+1,200` 同窗等量入账 + `recordDelivery` 零 src 写者。单看 `td=0` 会定成前者。

**分档**：`WIRED` ＝ 创建（两系统）、持久化（Memory 快照）、读侧（planner 消费）。`NOT WIRED` ＝ node 注入、交付写回、生命周期推进、route-efficiency。`EXERCISED` ＝ "合同被创建并落盘"为**真**（上表读数）；"合同台账反映真实交付"为**假**（结构性不可能，无写者）。

**对 #106 的意义（属人决定的证据版）**：这层的处境不是"补一行接线"，而是**"要不要留着它"**——
补写回（让 carrier 的实交付回流到 `td`）会第一次产生数、并使 `consecutiveShortfall→degraded→终态` 那套状态机有意义；
不补则这层连同它的三个兄弟模块是**只有单测在跑的平行宇宙**（同 `#107` 的 domain 层 33/225 零导入者那一族）。
两个方向都改变代码规模，都不该我代做；本轮把证据与判据摆齐。

---

## §25 L0 §3.4「扩张与帝国管理」八项记录（R349，10-06 07:5xZ）：**三枚引擎 API 都真在产线，而"扩张"这一层的仪表盘整簇无人调用**

> 名字一律取自本轮 `node_modules/@types/screeps/index.d.ts`（行号现读）。
> **计数以 §25 为准**：§3.8 八项记录已完成 **6 项**（§20 Observer／§21 Safe Mode／§22 Power-PC／§23 衰减与遗留物／§24 供给合同层／§25 扩张层）；§24 里那句"5 项"自本节起作废（撤的只有计数）。

| §3.8 要求 | 本轮记录 |
|---|---|
| **官方规则** | `Creep.claimController(target): CreepActionReturnCode \| ERR_FULL \| ERR_GCL_NOT_ENOUGH \| ERR_ACCESS_DENIED`（`@types:1269`）；`Creep.reserveController(target): CreepActionReturnCode \| ERR_ACCESS_DENIED`（`:1531`）；`StructureController.unclaim(): ScreepsReturnCode`（`:6032`，**没有专用错误码族**，与 claim 不对称）。相关常数族存在但**类型只声明为 `number`**：`CONTROLLER_CLAIM_DOWNGRADE`（`:325`）、`CONTROLLER_RESERVE`/`CONTROLLER_RESERVE_MAX`（`:326-327`）、`CONTROLLER_DOWNGRADE`（`:322`，是 level→数值 的映射）、`GCL_POW`/`GCL_MULTIPLY`（`:372-373`）。⇒ **本服取值一律记"未标定"**，不许引用成已知数（§20 那次错案就是把口头数当事实）。 |
| **前置条件** | 引擎侧：GCL 决定可 claim 数、`ERR_GCL_NOT_ENOUGH` 是硬失败。本仓侧四道（读码＋现场）：①候选池（intel 驱动的 `discovery`/`candidate`）；②执行门禁 `expansionAllowed`（G0 类，`#34` 已核其口径＝RCL/核心房）；③CPU 档（**现场＝`kernel.capacity.tier="constrained"`，`since=83,425,106`**）；④姿态（war/fortify 期关扩张，`#7`/`#92`）。 |
| **输入与输出** | 输入＝`domain/intel` 的邻房载荷（sources/owner/towers/enemySpawns，见 §20 更正后的口径）＋房级净流与储备。输出＝三条真动作：`claimer.ts:24` 发 claim、`reserver.ts:47` 发 reserve、`territory-manager.ts:161` 发 unclaim（释放链已线上判效）。中间态写 `Memory.kernel.expansion.*`（6 处引用点）。 |
| **资源成本** | **未标定**：`CLAIM` 零件造价、claim/reserve 的每次能量扣减（引擎按 body part 扣）本轮没读现场值。已知的只有一条**实测**事实：扩张的代价以"拍"计而非能量——历史上两次自然扩张各耗 ~13,300 拍量级（`#32` 端到端判效记录）。 |
| **CPU 成本** | **未记录**（没做标定）。但**档位是决策面读数**：现读 `constrained` 已持续 `83,455,501 − 83,425,106 = 30,395` 拍（按实测拍长 3.92 s/拍 ≈ **33 小时**）⇒ 扩张今天是被 CPU 档按住的，不是被候选按住。 |
| **相关 API** | `attackController`（`:1223`，本仓**未用**：本轮 `grep` 无调用点——记为能力未用，不记为缺陷）；`Controller` 上的 `safeMode*` 见 §21；`GCL` 相关只声明未消费。 |
| **失败条件** | 三条动作里只有 `claimController` 有专用码（`ERR_GCL_NOT_ENOUGH` 等），`unclaim()` 返回通用 `ScreepsReturnCode` ⇒ **释放失败的归因面比 claim 窄**（历史上确实踩过，见"释放已线上走完"那条判效）。层内更大的失败是**结构性的**：见下行。 |
| **与现有模块的关系**（本节的实质发现） | **`domain/expansion` 32 个模块中 8 个"层外零导入者"**（口径＝只算 `src/domain/expansion/` 之外的引用者，层内互引**不算**接进产线——这条口径是本节自抓的，第一遍我按 `expansion/<名>` 搜，`from "./autonomy"` 这类同目录引用被漏成假零）。其中：<br>· **一簇 4 个模块整体死着**：`colony-dashboard`（层外 0 个导入者）是 `autonomy`、`colony-failure`、`stability-score` 的**唯一**引用者 ⇒ 这四个互为孤儿。<br>· **4 个彻底零引用**：`evaluator`、`execution-dashboard`、`execution-operation`、`roi-tracker`（连层内都没人 import）。<br>· ⚠️ **命名陷阱（当场登记）**：`evaluator.ts` 零导入，但注释里"扩张评估器"确实在消费情报——那指的是 `discovery`/`candidate` 一侧。**别按注释去找 `evaluator.ts`，会去改一个死文件**（本仓老错：注释里的数据源只当线索）。 |

**现场读数（含控制组，先证同形状可读才承认"不存在"）**：`kernel.capacity={"tier":"constrained","since":83425106,"upgradeTicks":0}`、`kernel.situation.tick=83,455,501`（`adversaries={}`，与 #108 的"按人敌意恒 0"一致）、`kernel.expansion` **不存在**、`kernel.claims` 不存在。
⇒ 关于 `kernel.expansion` 缺席**本轮不下结论**：历史上扩张端到端跑通过两次（键应是阶段性的），而"谁在什么条件下创建它"我没读完 ⇒ 记 **待查**，不推成"扩张链没跑"。这正是 §20 错案换来的规矩：**读不到痕迹 ≠ 不存在**。

**分档**：`WIRED`＝三条引擎动作（claim/reserve/unclaim 都有生产调用点）＋门禁链。`EXERCISED`＝claim 路径**有过线上成功**（两次自然扩张，`#32` 判效）；`reserve` 在远矿场景真发过（reserver 角色在线）；`unclaim` 已线上判效（释放链）。**8 个层外零导入模块＝NOT WIRED**，与 #107（domain 33/225 零导入）同一族，且本节给出该层的**精确分母 32/8**。

**对属人决定的意义**：#107 现在多了一个具体抓手——`domain/expansion` 里**先处理那 4 个彻底零引用的模块**（`evaluator`/`execution-dashboard`/`execution-operation`/`roi-tracker`）与**那簇 4 个互为孤儿的仪表盘**（`colony-dashboard`+3）。
删除还是接线，仍属人：接线的代价是给"扩张仪表盘"补一条产线读者，而扩张当下被 CPU 档按住（`constrained` 33 小时）——**先解 CPU 还是先修可见性，是取舍不是 bug**。

---

## §26 L0 §3.5「市场、资源与高级经济」八项记录（R353，10-06 08:2xZ）：**市场不是"只读"——线上有我们自己的挂单；资本也不是约束（credits ≈19.83M）**

> 名字取自本轮 `node_modules/@types/screeps/index.d.ts`（行号现读）。
> **计数以 §26 为准**：§3.8 八项记录 **7/8**（§20/§21/§22/§23/§24/§25/§26）；§25 里那句"6 项"自本节起作废（撤的只有计数）。

| §3.8 要求 | 本轮记录 |
|---|---|
| **官方规则** | 本版本 `interface Market` 声明的成员只有这些：`credits / orders / incomingTransactions / outgoingTransactions / calcTransactionCost / cancelOrder / changeOrderPrice / createOrder / deal / extendOrder / getAllOrders / getHistory / getOrderById`。⇒ **没有 `calcCommission`/`calcPrice`/`estimateOrder`/`bestOrders`/`skills`** ⇒ 那些"引擎后来加的"名字在本仓**不可引用**（引了就又是 §20 族错案）。常数：`MARKET_FEE: 0.05`（`:759`，字面量、可信）、`MARKET_MAX_ORDERS: 300`（`:760`）、`TERMINAL_COOLDOWN: number`（`:418`）、`TERMINAL_SEND_COST: number`（`:420`）⇒ 后两枚**本服未标定**。 |
| **前置条件** | 有 terminal（现场 `roomsWithTerminal=1`）、terminal 不在冷却才可 `deal`（现场 `roomsOnCooldown=0`）；`createOrder` 前有引擎能力守卫（`terminal-manager.ts:265` `if (typeof market.createOrder !== "function") return;`）；挂单条件写在 `:254`——**自有大宗盈余且无在途挂单**才 `createOrder`。 |
| **输入与输出** | 输入＝`getAllOrders`（**18 处调用**，分布 `terminal-manager`/`terminal-market`/`domain/strategy/environment`）＋库存与价格环境（`kernel.environment.marketActivity`）。输出＝`deal`（2 处：`:77` 带 `roomName`、`:586` 不带 ⇒ 两个入口，一个跨房收货一个本房）、`createOrder`（1 处）、`changeOrderPrice`（1 处，`:322` 注释"改价成功—不撤单，等新价成交"）、`cancelOrder`（1 处 `:328`）、pixel 变现（`:245` 吃最优 buy 单）。 |
| **资源成本** | 现场：`stats.trade.credits ≈ **19,833,159**`、`storageEnergy 827,428`、`terminalEnergy 10,139`。⚠️ 口径：**两次读数逐字相同**，那是同一个 flush 窗的同一份快照 ⇒ 记 **一个样本**，不记"两次一致"。 |
| **CPU 成本** | **未标定**。已知的只是代码自己的认定与规避动作：`empire-strategy.ts:246` 「环境画像低频采样（每 100 tick），`getAllOrders` 是 CPU 大户」⇒ 承认贵、给了采样间隔，但**没有数值**，不许写成"便宜/已优化完"。 |
| **相关 API** | 用了的：`getAllOrders/deal/createOrder/changeOrderPrice/cancelOrder/calcTransactionCost(5 处)/orders(读 `Object.keys(...).length` 做 myOrders)`。**本仓零调用的**：`extendOrder`、`getHistory`、`getOrderById`（后两枚只在类型里存在）。 |
| **失败条件** | `createOrder`/`deal`/`cancelOrder` 都返回 `ScreepsReturnCode`；现场仪器 `gatedBy=""`（没有闸挡住交易）、`demandsPublished=0` 且 `demandsLive=0` ⇒ **工业需求从未发布过一条**（这与 #44/#51 一致：发布以正 ROI 为闸，当前行情合闸 ⇒ 行为零变化，不是崩）。 |
| **与现有模块的关系** | ①运费口径：`#71/#43` 的 `tradeFee*` 桶记的是成交侧成本，与 `MARKET_FEE 0.05` 不是同一个数（一个是引擎手续费、一个含 `calcTransactionCost` 的跨房运费）⇒ 别把两列相加。②`#130`（Power 线）：买 `POWER` 与打 Power Bank 是两条入口，**资本不构成约束**（credits 近两千万），所以那条属人决定真正在权衡的是"要不要开买入这条链"，不是"买不买得起"。③`#44/#51`：`demandsPublished=0` 就是那把 ROI 闸的现场证据。 |

**⚠️ 本节自抓的一次"我自己造的假缺口"（务必留着，这是 §20 那族错误的第三次复现，而且这次是当场抓住）**
我第一轮用 `grep -rn "\.cancelOrder("` 得到 **0 命中**，于是写下"注释说超龄撤单、代码从不撤单 ⇒ 生命周期注释与代码不符"。
真相是 `terminal-manager.ts:328` 写的是 **`market.cancelOrder?.(order.id) === OK`**——**可选调用形状 `name?.(` 不含 `.name(`**。
⇒ 规矩升级：**判"某 API 没接线"之前，搜索形状必须同时覆盖 `name(`、`name?.(`、`name!(` 三种**；
只搜一种得到的 0，只能记成"我没搜到"，不能记成"不存在"。本节因此把这条能力记为 **WIRED**，而我的第一版结论是 ZERO——差一点又是一个假缺口。

**分档**：`WIRED` ＝ 市场六枚 API 全有调用点（上表逐行给位，含 `:328` 的可选调用）。`EXERCISED` ＝ **有线上自证**：
`stats.trade.myOrders = 1` ⇒ 我们的挂单此刻真在市场里；`deal` 的成交在 `tradeFee*` 桶里有非零历史（#43 判效）。
`NOT WIRED` ＝ `extendOrder`/`getHistory`/`getOrderById`（未使用；这是**选择**，不是缺口——挂单维护用改价代替撤单重挂，见 `:322`）。

**这一节没有裁决任何事**：买不买 POWER、要不要开工业需求、卖能量是否净亏，仍全部属人（#130/#44/#51/#71）。
本节只把"它到底是只读还是双向"、"资本是不是约束"、"哪条闸在合着"三件事变成有出处的读数。

---

## §27 L0 §3.6「防御与军事」八项记录（R354，10-06 08:3xZ）：**八个 §3.x 领域记录到此做齐**；战斗链全线 WIRED，而"打过一仗没有"这件事今天**仍无自证**

> **计数以 §27 为准**：§3.8 的八项记录已覆盖 **§3.1–§3.8 全部八个领域**（§20/§21/§22/§23+§3.1-2/§24+§3.3/§25+§3.4/§26+§3.5/§27+§3.6，§3.8 本身是"覆盖原则"即这八节）。
> ⚠️ 但**"八个领域都有记录"≠"每个机制都有记录"**：§3.1 一项就列了 13 个机制。所以 `#97` 的剩余定义从"补领域"改写成"补机制深度"，**不宣布完成**（理由见本节末）。

| §3.8 要求 | 本轮记录 |
|---|---|
| **官方规则** | 本轮按**三种调用形状**（`name(` / `name?.(` / `name!(`，§26 之后的新规矩）在 `src/` 计数：`Creep.attack` **10/0/0**、`rangedAttack` **6/0/0**、`dismantle` **3/0/0**、`heal` **2/0/0**、`reserveController` **1/0/0**、`activateSafeMode` **2/0/0**（详 §21）、`launchNuke` **1/0/0**（`war-planner.ts:266`）。⚠️ 代码注释自称"引擎 `NUKE_RANGE=10`"（`config/index.ts:1036`）——**本轮未在 @types 复核 ⇒ 未核实项**，不许当已知数引用。 |
| **前置条件** | 进攻侧要 `posture==="war"` 且有 war plan（现场 `kernel.warPlan` **不存在**）；nuker 链另有 `CONFIG.nuker`：`ghodiumStockpile:5000`、`launchTowerThreshold:2`、`maxRange:10`、`fallbackGhodiumBuyMaxPrice:300`、`ghodiumBuyCreditFloor:10000`。纯函数预检 `shouldLaunchNuke`（`domain/war/planning.ts:137+`）：**超射程→false、同目标在途期间不重复发射**（注释原文），细判交给引擎返回码。 |
| **输入与输出** | 输入＝`squad-state`/`tactical-*` 运行时（见"与现有模块的关系"）＋敌情（§20 的 intel）＋`war-planner` 的计划；输出＝编制/移动/交战三类动作意图，与 `launchNuke(pos)` 这一枚不可逆动作。 |
| **资源成本** | 代码内声明：一发核弹＝**50,000 energy + 5,000 ghodium**（`planning.ts:139` 注释口径）⇒ **属"代码内声明"，未从引擎文档独立复核**。ghodium 备料链另有买入兜底（价≤300、信用≥10,000）。 |
| **CPU 成本** | **未标定**（战术运行时是 per-tick 系统，但本会话没有它的分档读数）。 |
| **相关 API** | 未使用：`nukeRange`（本版本无此名）、`findHostileStructures`（0/0/0）；`attackController` 未用（§25）。 |
| **失败条件** | `launchNuke` 的返回码只被拿去比 `=== OK`，**不入直方图、不留拒因** ⇒ 与 #119 修复前的 safe mode **同形**（那次已证明：拒因与"没试"事后分不开）。记为**观测缺口**而非缺陷：今天没有"为什么没炸成"的读数。 |
| **与现有模块的关系** | **一次被避免的假阳性（值得记）**：`combat-micro-runtime`、`squad-movement-runtime`、`squad-state`、`tactical-runtime-system` 四个模块"层外零导入者"，若照 §25 的第一遍口径就会被记成死码；实为 `tactical-runtime-pipeline`（层外=1，活）在编排它们——**簇是活的**。⇒ 判死必须做**两步**：①层外引用者 ②引用者自身是否活。 |

**分档**：`WIRED` ＝ 战斗/防御/核威慑三条链的调用点齐（上表逐枚给位）。`EXERCISED` ＝ **不成立也不否证**：
我探了 `kernel.warPlan`／`kernel.nukeLedger`／`kernel.stats.war` 三个键名，全部"不存在"，而控制组同形状读到 `kernel.capacity` 非空——
但 `nukeLedger` 这个**键名是我猜的**（`src/` 里 grep 不到它，只有 `pruneNukeLedger` 函数），所以"键不存在"只说明**我没找对名字**，
⇒ 结论只能是 **`UNOBSERVABLE`（本轮未定位到落盘点）**，绝不能写成"从未发射过核弹"。
线上确有 war 姿态进出（对方 R183/R187 的实测），但**姿态进入 ≠ 交战发生**，两者不许互替。

**为什么 `#97` 不在此宣布完成**：八个领域的第一份记录做完，只是把"每个领域都能被问住"变成"每个领域都有出处可查"。
仍欠的两类是具体的：①**§3.1 的 13 个机制**、**§3.2 的 9 个**、**§3.3 的 11 个**各自没有独立八项记录（我只做了其中相交的几块：Observer／Safe Mode／Power／decay／供给合同／扩张／市场／军事）；
②本节与 §26 都出现同一形状的欠账——**"资源成本/CPU 成本"两列大量是"未标定/未核实"**。一份八项里有三列空着的记录，是**地图**不是**收据**。
所以 `#97` 继续挂着，判据换成可核的：**每个 §3.x 列出的机制都要有一条含"标定过的成本列"的记录**。

## §27 增补（R362，10-06 01:0xZ）——战争"输入与输出"那一行的**采集面**补深一层；顺带摘掉本节一条"键名是我猜的"欠账
本节原有两处在 R359–R362 之后需要更正/加深，逐条给位：

**① 「前置条件」里 `kernel.warPlan` 不存在——现在这条是**已核**而不是猜**（旧文里同形状的键名怀疑只适用于 `nukeLedger`）。
读据：写者两处、同一个全局键 `Memory.kernel.warPlan`（`src/systems/military/war-planning-system.ts:525`、`src/systems/military/war-planner.ts:99`）；
现读用**同一工具、同批、带已知非空控制**（`kernel.strategy` 非空、`kernel.warBlacklist` 同形读到不存在）⇒ 这个"不存在"是数据缺失。
（对照记录：我自己先在 `rooms.*.warPlan` 上错过三发，那个键在 `src/` 从未存在，已在 R359 当场撤。）

**② 「输入与输出」的敌情那一侧，按 §3.6 的机制补深为"三条直接来源各自覆盖什么"**（`DIRECT_SOURCES={"passive","scout","observer"}`，`domain/intel.ts:249`；非直接来源**永远**是 inferred，`intel.ts:315-321` 先问来源再问龄）：

| 直接来源 | 写者（位点） | 任务/覆盖面从哪来 | 今天能不能喂出战争候选 |
|---|---|---|---|
| `observer` | `systems/room-observer.ts:203`（pending 目标房）、`:228`+`:360`（**住房八邻域**） | 需 Observer 楼 + 排进 pending | **不可判**——"楼在不在"无落盘答案（#100）。钥匙是本批未推的 `994bf542`（`stats.observe` 的 `noTarget`/`gate` 两列） |
| `scout` | `systems/room-observer.ts:322` | `systems/empire/prospect-manager.ts:108/142/148` 的**扩张探矿** mission | **不覆盖敌房**：扩张候选按定义无主 ⇒ 它产的就是漏斗里 `unowned` 那一桶。不是漏了，是使命不同 |
| `passive` | `systems/intelligence.ts:59`（`adoptRoomIntel`），喂入口见 `:172` 注释「观察交接采用 + 被动威胁信号」 | 我方视野恰好看见、敌方路过 | 理论上会留 fact 条目，但威胁字段只活 `ROOM_THREAT_TTL=200` 拍（`intel.ts:255`）⇒ 必须是**持续**视野 |

**③ 本节「失败条件」那条观测缺口，现在有了一个具体形状**（比"拒因不留存"更窄、也更好还）：
`war-planning-system.ts:310` 筛掉候选时只 `funnel.notFact++`，**不落 `confidenceAt` 的原值** ⇒ 现读 `notFact=5` 分不清两支：
`inferred`（来源不直接 ⇒ 要加采集面）与 `stale`（来源直接但过了 200 拍 ⇒ 只要把 observer 刷新上）。**两者处置相反。**
⇒ 记为 #97 的一条**可还项**：一个新增列的量级、零决策接入。本轮不改码（属采集侧决策），也不据此调任何门槛。

**④ 分档更正**：`observer` 这条车道今天只能标 **WIRED（调用点在）+ UNOBSERVABLE（有没有真发过请求，无落盘答案）**；
不要因为它出现在上表就把它读成 EXERCISED。`#97` 继续挂着，欠的两类（逐机制八项记录、标定过的成本列）一条没少。
