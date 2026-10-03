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
- **线上验证**：**第一次自主扩张端到端自然完成**（`outcome=COMPLETED`，开单→完成 13,300 拍，债单 #32）；七合取项逐项现读唯一假项 `youngestMature`（R187）。
- **已知缺陷**：**#88 属人**（G4 的 ≥5/拍 与 `youngestMature` 在同一能量预算上对冲，R185）；**#92 属人**（零活敌的 war 靠 `threatWindow=5,000` 记忆撑住 ⇒ 单次目击缴 ≈5 小时扩张税）；#94 上线前 `gclLevel`/`bucket` 两项不可事后归因。
- **优先级**：P0。**验收标准**：解闸后必须真落地一次 claim（已满足一次）；**`STABLE` 缺口**：同一串闸的**第二次**端到端自然完成还没有。

## 3. 跨房物流与成对入账（`creeps/roles/carrier.ts`、`actions/fill.ts`）

- **实现状态**：`LIVE_VALIDATED`（入账）/ `TESTED`（供给合同触发）
- **线上验证**：`exported == imported` 成对累计（#48 PASS：`3600==3600`）；R177 现场再见同窗 `imported:1200/exported:1200`。
- **已知缺陷**：#35/#48 判据三次更正——幼房无 storage 前不发单是设计；跨房交付是**稀发事件**，不能按时间窗判"坏"。
- **优先级**：P1。**`STABLE` 缺口**：一次真实跨房交付 + 一次回收的成对第二发。

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
- **层次错配（真发现）**：进 war 靠 NPC 目击，选靶要玩家房 + 新鲜情报（`targetFreshness:1500`、`maxTowers:3`）。
- **已知缺陷**：#95（复证中的设计行为）、#92（代价属人）、**#96 上线前战损不可长程归因**（环 846 拍 / 保险丝 400 拍）。
- **优先级**：P1。**`LIVE_VALIDATED` 的前置**：需要**真实敌情**，而我不制造敌人（L0 §1.5 + 我的既定禁令）。

## 9. 工业链（lab / factory / boost，`systems/industry*`）

- **实现状态**：`LIVE_VALIDATED`（第一次跑通并入库：`storage.XGH2O=100`、累计 ≈195）
- **已知缺陷**：`factory.level` 本服 `undefined` 已修（`?? snapshot.rcl`，`c6cceb2`）；**买料产 `wire` 单价倒挂 ~60 倍** ⇒ "继续不发布需求"是**正确态**（判效方向曾被我读反）；boost 零赋值也是正确态（要 `compound ≥ 130`）。
- **优先级**：P2（收益被行情卡住，不是被代码卡住）。

## 10. 恢复（recovery / crisis / 灾后备建）

- **实现状态**：`TESTED` + 局部 `LIVE_VALIDATED`
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
- **实现状态**：`TESTED`（**线上未证实** —— 见下）
- **代码入口 / 调用链**：`room-observer.ts`（每 50 拍刷新邻居情报，C2）→ `domain/intel.ts` 的 `getRoomIntel()`（**宿主我本轮没查到定义位置**，见"下一件事"）→ 两个消费者；另有 `segment-store.ts:31` `SEGMENT_INTEL_PLAYERS = segId("intelPlayers", 5)`，形状 `{epoch, players}`（`:337` 段不可用时退化成 `{epoch:0, players:{}}`）。
- **⚠️两个新鲜度阈值，别混（口径纪律）**：
  - **扩张执行侧**：`plan-adapter.ts:166-171` `isIntelStale()` 用**硬编码 10,000 拍**，且注释规定"**从未观测过 = 不算过期**"（把判断让给后面的 claim 闸）。
  - **战争选靶侧**：`CONFIG.war.targetFreshness = 1,500 拍`。
  ⇒ 同一条情报在两条链上"新鲜度"差 **6.7 倍**；引阈值必写消费者是谁。
- **依赖模块**：`RawMemory` 段调度、`expansion/plan-adapter`（`GATE_INTEL_STALE`，`execution-gate.ts:155-156`）、`military/war-planning-system`（选靶）。
- **现有测试**：`tests/unit/intel/intel-state.test.ts`、`tests/unit/intel/confidence.test.ts`、`tests/unit/systems/intelligence.test.ts`、`tests/unit/economy/intel.test.ts`（均在 `tests/unit` 5214 用例全绿内）。
- **线上验证情况**：**未取得**。`peek rooms.W37S58.intel` ⇒ **不存在**；所以"Memory 路径"这个假设先被否掉（大概率在段 0/段 5，或该键已换名）。**不给 `LIVE_VALIDATED`。**
- **已知缺陷 / 疑点**：**#95 的选靶闸正卡在这里** —— 若段 5 的 `players` 为空，则"war 却没有 warPlan"是**正确行为**（无合格玩家目标），而这条**只能读段 5 来定**。
- **CPU 成本**：`room-observer` 每 50 拍一次（历史归因里不是大头项）。
- **优先级**：**P1**（它是"作战"与"扩张"两条腿共同的上游；情报缺失会让两条腿同时静默，而静默看起来像健康）。
- **验收标准 / 下一件事（写死，别靠记忆）**：
  1. `grep -rn "getRoomIntel" src/domain/intel.ts` 找到**定义行**，确认它读的是段几（我本轮只确认了段 5 的名字与形状）。
  2. 用一发**带标记 console 探针**读 `RawMemory.segments[5]` 的 `players` 键数（段不在 heap 里，`peek` 走 Memory 端点读不到）。
  3. 若 `players` 非空 ⇒ 回 #95 查 war 选靶为何仍不产 `warPlan`；若为空 ⇒ #95 结为"正确行为"，本行升 `LIVE_VALIDATED` 的条件改成"观察到一次跨房情报被扩张或军事消费"。

## 尚未入矩阵的能力 = 本文件的已知不完整性

L0 §3.1–3.8 列出的覆盖面**远不止上面 11 条**（房间运营/基础设施、资源网络、殖民管理的全部子项、宣言/联盟/外交、符号与 boost 全链、CPU 调度本身、侦查与情报体系…）。
**当前只登记了我今夜能引用证据的条目。**其余按 L0 的纪律**必须标 `NOT_STARTED/DESIGNED` 才诚实**，而我没有逐条核过代码入口与调用链 ⇒ 所以**不填**（填了就是伪造）。
补齐次序建议（每轮 3–5 条，先核代码再落状态）：①殖民/房间运营子项 → ②侦查与情报（`segment 0/5`，它与 #95 的选靶闸直接相关）→ ③CPU 调度与预算（tier 与 `pick*` 已有底子）→ ④外交/宣言（很可能整块 `NOT_STARTED`，那本身就是重要结论）。
