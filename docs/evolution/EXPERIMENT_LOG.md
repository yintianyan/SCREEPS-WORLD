# EXPERIMENT_LOG — 「预期 → 实测 → 裁决」台账（L0 §7 点名的产物之一）

> **本文件的规则**（每条都必须满足才算一条记录）：
> ① **预期写在读数之前**，且写的是能证伪的形状（数值/键/方向），不是"看看会怎样"；
> ② 实测必须带**出处**（tick、探针 mark、`peek`/`observe` 叶子路径，或提交号）；
> ③ 裁决只有四种：`命中` / `否证` / `未定（样本不足）` / `未开始（条件没到）`——**`未开始` 不许读成失败，`未定` 不许读成命中**；
> ④ 我自己被推翻的预期**照原样保留**（这才是这份台账的主要价值）。
>
> 条目按时间序；编号沿用 `EVOLUTION-ROADMAP.md` 的「巡检 R###」，细节以那一轮为准（此处只留判据链，不重复长文）。

---

## E-01 · 远矿施工的两半分母必须分开（R286→R317）
- **预期（写死）**：`noEnergy` 先于射程判定 ⇒ 新列 `noEnergyInRange` 只记「有 WORK 且脚下有格」，因此 **0-WORK 走廊里它恒为 0 是仪器失明，不是没机会**；补 `noWorkInRange` 后两房应分别有数。
- **实测**：线上 `roadBuild`（`peek` 逐叶子，t≈83423379 / 83430000 两次同段）—— W37S57 `noEnergy 912 → noEnergyInRange 831`；W39S56 `noWork 683` 而 `noEnergyInRange = 0`；W38S56 `noWork 488 = calls`（100%）。
- **裁决**：**命中**。子集不变式 `noEnergyInRange ≤ noEnergy` 在真数据上成立（831 ≤ 912）；0-WORK 失明按预测形状复现。
- **出处**：`c2e3e30`（列）、roadmap R317/R319/R326。

## E-02 · 「noWork 应为 0，该归因已被证伪」这句代码注释
- **预期（隐含在旧注释里）**：任何房读到 `noWork > 0` 都不该发生。
- **实测**：body 普查 10 台 remoteHauler ⇒ W38S56(3 台)/W39S56(1 台) 是 `[0W 16C 16M]`，且 `bodies.ts` 按 `energyCapacityAvailable` 选档 ⇒ **0-WORK 是合法档位**。
- **裁决**：**否证**（否证的是我自己写在代码里的结论）。注释已就地改写并补上采样范围。
- **带走的规矩**：写在代码里的否证性注释必须带"在哪个房、哪档 body、哪段 boot 证的"，否则它变成全仓免检牌。
- **出处**：roadmap R316（探针 mark `R316A1`）、`road-build.ts` 注释（`c2e3e30` 同批）。

## E-03 · 一条走廊能不能施工，是"买得起哪档 body"的副产物
- **预期（写死）**：`bodies.ts` 的选档只看 `energyCapacityAvailable`，**不看要不要施工** ⇒ 同帝国不同房会用不同 WORK 数，施工资格随能量档位漂移。
- **实测**：两房 `[1W 20C 21M] cap 1000` vs 两房 `[0W 16C 16M] cap 800`，与它们当时是否需要同一条车道无关。
- **裁决**：**命中**。⇒ 提出 #111 的前置问题「远矿 hauler 要不要设 ≥1 WORK 下限」（属人）。
- **后续被收窄（E-05）**：该问题今天的受众比我想的小得多。

## E-04 · 施工机会计在"哪一腿"
- **预期（写死）**：若施工机会 100% 落在**空载腿**（背包已交能），则动作是"留能"(B) 而不是"换 body"。
- **实测**：W37S57 空腿 912 次里 831 次脚下有格（91%）；W36S58 2,799 次里 1,077 次（38%）。
- **裁决**：**方向命中、但一刀切被否证**——同一机制在两房的占比差 2.4 倍 ⇒ 落点与能量两种瓶颈在不同房占主导，**不能统一修法**。

## E-05 · ★我自己撤的一条受众判断（R317→R319）
- **预期（R317 写死）**：「0-WORK 房（W38S56/W39S56）是 WORK 下限的主要受众」。
- **实测**：规划器侧 `roadSitesPending` **只在 W37S57(18)/W36S58(4) 非零**，那两间 0-WORK 房是 **0 个待建路 site、`roadProgressSum=0`** ⇒ 它们**压根没铺路**。
- **裁决**：**否证**（否证我自己）。⇒ 两条杠杆分属两房：有 site 的房堵在"空腿没能量"（动作是 (B)），0-WORK 房的问题是"这条车道要不要铺路"（换 body 买不到东西）。
- **带走的规矩**：**判"谁缺 X"要同时读产出侧与排产侧两张兄弟表**；只读 creep 侧的早退桶必然把受众判错（同族第四次）。
- **出处**：roadmap R319、任务 #111 描述。

## E-06 · (B) 的价格能否算成"段数"（R313→R326）
- **预期（写死）**：`机会 × WORK × BUILD_POWER` 对照缺口 `pending×300 − progSum`，且**必须**声明"这是上界，实际取决于能否把 300 点聚在同一格"。
- **实测**：`BUILD_POWER=5`（`@types:174` 现读）、路 `progressTotal=300`（线上 site 实读）；W37S57 早前段 `831×5=4,155` vs 缺口 `18×300−505=4,895` ⇒ 85%、按每段 60 拍折算**上限约 13 段**。
- **裁决**：**命中（口径正确）**，但**随段长变化必须重采**：同房 7 小时后同一列变 2,379 ⇒ 引用旧数即错。
- **同时被本条否证的说法**：`built=311`（W36S58）在线上 ⇒ **"远矿路永远建不成/建成 0"这类旧措辞在本段不成立**，一律改成"机会/转化比"。

## E-07 · 道路维持需求 vs 自然衰减（#107）
- **预期**：若建成路在无施工的情况下按引擎衰减线性减少，则"段/拍"应能由两个独立口径互证。
- **实测**：两估计同值（约 1 段/570 拍 vs `ticksToDecay` 中位 555）。
- **裁决**：**命中** ⇒ 定案为自然衰减，"被敌方拆"这一假设不需要引入。

## E-08 · Observer 楼到底在不在（R302→R319）
- **预期（写死两次）**：矩阵自己点名"模板有 rcl8 槽位 ≠ 已建成，需一次 `FIND_MY_STRUCTURES` 读数"。
- **实测**：mark `R318A2`，t=83423379 ⇒ **W37S58 有 1 座、全帝国唯一、无 obsSite**；另两口自有房 RCL5/RCL2，按 RCL8 前置不可能有。
- **裁决**：**命中** ⇒ #100 的"先盖楼"选项**有据摘除**；同时否证我自己更早前用错方法名造的假缺口（`.observe(` → 真名 `observeRoom(`）。
- **同轮另撤一条**：我说"侦察结果不持久化=缺口"也错了——`DIRECT_SOURCES` 含 `observer`（可进 fact 通道）、handoff→adopt→`segments[5]` 链闭合，与 #109 结案一致 ⇒ **短板是输入的"量"，不是存储的"形"**。

## E-09 · #100 上线后的第一个可证伪读数（**未开始**）
- **预期（写在部署之前，R318/R321）**：`noTarget / gate ≈ 1`（按 `OBSERVE_INTERVAL=25` 与 `INTEL_STALE_AFTER=2000`、`lastSeen` 只在真有视野时前移算出）；`W37S58.noObserver === 0`；闭合式 `ok === captured + lostVision + staleSlot` 必须成立。
- **实测**：`Memory.kernel.stats.observe` **不存在**（同形状控制组 `roadBuild` 读通后才判此"缺键"）⇒ 仪器未上线，**没有任何一次读数**。
- **裁决**：**`未开始`**（不得读成 FAIL）。⇒ 判据、证伪形状、反例读法都已就位，等 T0 部署。

## E-10 · #113 违例留痕：从"读不到"到"有现役受害者"（R311→R327→R330）
- **预期（写死）**：部署后经历一次 `violations` 非空→空，`recent` 应仍存在且含变空之前的 id。
- **中途误判**：R327 我据事件环（跨度仅约 1,000–1,600 拍）报"该沿按构造不可达"。
- **实测**：R330 直接读到 `recent` 存在，条目 `{"seenAt":83427283,"lastAt":83429970,"count":2688}`，环内 `ExpectationViolation` 占比约 1.2% ⇒ 违例**持续发生**。
- **裁决**：**R327 被否证**（我自己的）；主判据仍 **`未开始`**（要的是"转空"那一沿，本段未观测到转空）。严重度改判为**有现役受害者**：修复要保住的是这份 2,688 计历史。
- **带走的规矩**：**"环内为 0"≠"没发生"**（这条我已写进记忆两次，第三次仍踩）。

## E-11 · CPU 档位算式与状态机是否互证（R332）
- **预期（写死）**：现读阶梯 `0.35/0.6/0.8` + `limit=min(20,500)=20` ⇒ `total=16.25` 应判 `constrained`。
- **实测**：`16.25/20 = 0.8125 > 0.8`；`kernel.capacity.tier = "constrained"`（`since=83425106`）。
- **裁决**：**命中**（两出口闭合）。⇒ 顺带纠正台账旧数：#50 有两个目标位（回 tight 砍 **0.25/拍**；回 comfortable 砍 **4.25/拍**），旧的"缺 2.44~2.48"是当时 `total≈14.5` 的产物，**不要再引用**。

## E-12 · 释放自有房之后资产去哪了（#118，R319）
- **预期（写死）**：若释放链只清「管控 + 账本」，则现场仍可能有我方结构而 `Memory.rooms` 里没有该房——特征是"按 `Memory.rooms`/`snapshots()` 遍历的机制全部看不见它"。
- **实测**：两发独立读数（`R318A2`@83423379、`R318A4`@83423399）：W37S55 不在 `Memory.rooms`、controller 无主，却有 **2 只 `my===true`、owner=本账号的 spawn**。
- **裁决**：**命中** ⇒ 立 #118（三处置均属人，且必须与 #78/#13 同裁：修 #78 的清理会静默重开"放弃 W37S55"的决定）。

---

## 目前挂着的 `未开始`（等一次部署即可判，全部不制造条件）
1. **E-09** #100：`stats.observe` 三读数 + `noTarget/gate≈1`。
2. **E-10** #113：一次"违例非空→空"的沿上 `recent` 是否存活。
3. **#111 完整价格**：W36S58 的 `noEnergyInRange/noEnergy` 分房比值 + `noWorkInRange` 是否如 E-01 形状出现。
4. **#119**：和平期 `stats.safeMode` 三列皆初始值；**只有 `guardMiss>0 且 tried=0` 才叫"该响没响"**。

## 这份台账**不记录**什么
- 不记录"看过但没写死预期"的读数（那种只能算观察，事后不可判）；
- 不记录为取证而制造的条件（本会话政策：不为造证据动阈值、不发动战争、不销毁资产）；
- 不把 `未定` 与 `未开始` 合并进"通过"。

---

## 增补（R343 / R346 / R347，10-05→10-06）——三条新实验与一条"未开始"清单的更新

## E-13 · carrier 卸能是否两侧成对入账（#42/#48，R343）
- **预期（上线前写死）**：若配对记账生效，则**一次真实跨房交付**上，收端 `imported` 与发端 `exported` 在同一个 flush 窗内**等量**；控制房应持平。
- **实测**：挂好的只读轮询器抓到 `20:58:50Z W38S56.imported=82,785 / W37S58.exported=27,600`，与上一行相比**两侧同时 +1,200**，控制房 W38S58 全程为 0。+1,200＝一只 carrier 满载（本服 `CARRY=50×24`）。
- **通道唯一化**：用**排除法**而非直接观测——`R343T1@83,430,906` 现读 `terms=[W37S58:有终端, W38S56:无, W38S58:无]` ⇒ 收端没有终端，`terminal-selfaid.ts:68/133` 那条"也成对记账"的路按构造进不来，只剩 `carrier.ts:57-61`。
- **裁决**：**命中**，但口径写死两条限制：①**"同一拍"不是我观测到的**，是代码结构（同一 `if` 块）保证的，仪器上限是"同 flush 窗等量"；②同段 `tradeFeeEnergySell +566` 是市场卖单，**不是这笔的运费**。

## E-14 · 预部署对照会不会自己失效（R346→R347，跨 26 小时）
- **预期（写死）**：只要无人 push，四把新键应恒 absent（`stats.observe`/`safeMode`/`strayAssets` + `roadBuild.<房>.noWorkInRange`），而 `roadBuild` 整行应已在场（旧批上线）；`expectations.recent` 非空。
- **实测**：两次读数（`t=83,431,205` 与 `t=83,455,155`）形状**逐字一致**：四键不存在、roadBuild 14 键在场唯独缺 `noWorkInRange`、`recent` 非空。
- **裁决**：**命中**（"缺键＝未部署签名"这条判据自己通过了；它也再次证明 26 小时里真没人换码）。
- **本轮自抓的错（收益最大的一条）**：我想用 `peek.mjs Memory.rooms.W37S58` 验证，工具回"不存在"，**差点把"工具形状不对"记成"数据为空"**。该工具路径根是 `rooms.X` / `kernel.X`（不带 `Memory.` 前缀），控制组（同形状读一个已知非空邻居 `rooms.W37S58.phase`）一发的代价就把方向纠回来了。⇒ 规矩：**断言"某存储为空前，必须用同一工具、同一请求形状先读通一个已知非空邻居"**。

## E-15 · remainsLoot 的反向实验（#131，R347）
- **预期（写死）**：摘掉 `pickup.ts` 里两处 `else bucket.belowThreshold++` ⇒ **恰好 2 例**转红（正是钉这一列的那两例），其余 6 例绿，且全库控制组不得转红；还原后 `cmp` 必须逐字节相同。
- **实测**：`2 failed | 6 passed (8)`，红例名＝「阈值档把零头记进 belowThreshold…」与「兜底档与阈值档分开计…」；`RESTORED-IDENTICAL`。
- **裁决**：**命中**——这份账本不是"绿色但什么也没断言"。⚠️ 但它只证明**单测覆盖**：`stats.remainsLoot`/`remainsBlind` 的**线上判读仍是"未开始"**，前提是这批先上线。

## 更新后的"未开始"清单（等一次部署即可判，全部不制造条件）
1–4 同上（E-09 observe／E-10 #113 的违例转空沿／#111 完整价格／#119 safeMode 三列）。
5. **§3.4 残留资产**：`stats.strayAssets` 出现，并顺带确认 W37S55 那两只无主 spawn（＝#118 的免费复证）。
6. **#131（本轮新增）**：`stats.remainsLoot` 与 `stats.remainsBlind` **出现**＝`07b38f92` 真上线；**正面读数形状**＝阈值档 `belowThreshold>0 且 resolved=0`、兜底档（键 `"0"`）`resolved>0`；若两档 `resolved` 全 0 而 `seen>0` ⇒ 注释里"链尾兜底"不成立，排序问题升级为真问题。`remainsBlind.blindFiltered/snapshotTicks` 给出盲点率，>0 才值得为"选中后落空"单独归因。

---

## E-16 · R2 canary 红因：测试窗口还是早期房升级冻结（R697→R698，11-05）
- **预期（R697 登记，写死）**：canary 的 `rcl2` 采样 16<30 是"房间更快离开 RCL2"导致的测试窗口假设失效。**实测**：`/tmp/rcl2-canary.json`（R697 产物）与 `E2E_RANDOM_SEED=42` 第二发**逐字同形**：`rcl1=88/rcl2=16`、RCL2 首次 4,402、全程未到 RCL3、controller progress 552→4,052 卡 50。**裁决：否证**（更晚到达，不是更快离开）。
- **预期（R698 诊断，写死）**：若冻结因是 `ΣgateNetFlow<0` 的角色闸，则 upgrader 的 work/idle 应与 gate 符号逐拍相关；修复（早期房豁免）后同 seed canary 必须 `rcl2≥30`。**实测**：t=600–4,000 `gate<0` ⇒ upgrader 全 idle（ea=300、spawn 队列空），t=4,100 转正后 300 拍 progress 50→150；修复后同 seed `rcl1=21/rcl2=83`、RCL2@1,052、canary 9/9。**裁决：命中**（立 #200 并修复）。
- **口径边界**：两条世界线的 `rcl>=3` 采样均为 0（5,200 拍内未到 RCL3），故本实验只裁 RCL1→RCL2 段；RCL2→RCL3 的速率未测。

## E-17 · bundle 预算修复与 10-27 以来整批上线（R699，11-05）
- **预期（上线前写死，15:3xZ）**：CI run 42056910649 的 Bundle size budget 步骤打印 **811,577B**（本地同 commit 构建 `dist/main.js` 811,577B、sha256 前 12 位 `0bf73b74ab2d`），且 **Upload 步骤真的执行**；部署生效后 `check-code.mjs` 的 live sha 应等于 `0bf73b74ab2d`；boot 拍后 100–200 拍内三房（W37S58/W38S56/W39S55）`state=normal`、`capacity.tier` 不跌到 `constrained`（部署前 `tight@84090604`、usage 15.93）、`errorsPerTick≤1`、无房失守/失联。
- **口径边界**：#200 的早期房豁免在线上**不可直接复读**——现无 RCL<4 的房（8/7/5），只能靠 R697/R698 的 canary（9/9）与本次同批代码上线作为间接证据，不得写成"线上已复读 #200"。
- **裁决**：**部分命中（15:5xZ 读回）**——CI `42056910649` 的 Bundle size budget 打印 **811,577B** 且 Upload 执行；`check-code` 无参数与 shard3 两问 live sha 均 **`0bf73b74ab2d`** ＝本地同 commit 构建；boot≈84,090,908；boot 后 176 拍三房 `state=normal`、`errorsPerTick=0`、无失守/失联 ⇒ 四项命中。**但 `capacity.tier` 在 boot 拍 `84,090,909` 由 tight 跌到 constrained**（`upgradeTicks` 160/500）⇒ `tier 不跌到 constrained` 一项**否证**，成因是既有的部署税（boot 首拍重活抬高自 boot 起的累计均值），不是本批回归。口径边界：#200 仍不可线上直接复读（现无 RCL<4 房）。

## E-18 · #205 帝国级能量守恒残余（R708，11-06）
- **预期（11-06 09:24Z 写死，出处 `tmp/observe/AGENT.lock` R708 目标卡；此后才开窗）**：在同一 ≥620 拍窗内，`ε = ΔP_total − [Σ_all_keys(Δharvested+Δbought−Δsold−Δspawned−Δupgraded−Δbuilt−Δrepaired−ΔtowerSpent−ΔtradeFee)]`；`P` 含每个可见房的 container／storage·terminal·link·tower·spawn·extension／lab·factory·powerSpawn·nuker／dropped／tombstone·ruin，再加**全部 creep 携带**；`pickedUp/imported/exported` 作为内部项剔除。**PASS＝|ε| ≤1/t 且逐房残差可归到「跨房调拨相位/远矿库存」具名项；FAIL＝仍 >1/t 且无具名汇；UNKNOWN＝端点缺一房或窗内 boot。** 不改阈值、不部署、不动 src。
- **实测**：窗 84,105,642→84,106,264（622 拍、36 发、boot 84,090,865 未变）；`ΔP_total=−35,056`、`ΣnetFlow=−5,673` ⇒ **ε=−29,383（−47.24/t）**。物理分项 `Δcontainers +3,739`／`Δgeneral −17,988`／`Δindustrial −17,711`／`Δloose −400`／`Δcarry −2,696`。主通道＝**W38S56 工厂电池压缩**：`COMMODITIES.battery = {amount:50, cooldown:10, components:{energy:600}}`，工业池 20,381→2,070（−18,311＝≈30.5 批×600），前 256 拍 −15,000＝25 批×600（≈58.6/t＝满速）。逐房 ε：W37S58 +8,741（import 剔除后 epsClosed −2,020）／W38S56 −20,848（epsClosed −28,148）／W39S55 −295／远矿三房 −16,981（调拨相位）。bot 自身 drift 同向：W38S56 −39.49/t、Σdr −36.80/t。扣除工厂池降与 loose 后仍剩 **≈−11,272（−18.1/t）** 未分离。
- **裁决**：**否证**（预注册 PASS 未命中；|ε| 47.24/t ≫ 1/t）。字面 FAIL；实质＝主通道是既知 `industrialSpend` 缺桶（工厂电池压缩满速 ≈59/t），不是新漏口；#205 升级为账本输入缺陷，下一轮加观测桶后同口径复判。

## E-19 · #206 工业消耗观测桶能否闭合 ε（R710，11-06）
- **预期（11-06 11:2xZ 写死，出处 `tmp/observe/AGENT.lock` R710 目标卡；部署 `f368e1d1` 之前）**：`EnergyLedger.industrialSpend` 由四个调用点的引擎返回码 `OK` 精确计数（factory produce / lab boost / powerSpawn process / nuker launch），且**不进** `CONSUMPTION_FIELDS` ⇒ `nf`/G4 口径不变；同一 ≥600 拍窗内，把 `industrialSpend` 从能量流中显式扣除后，R708 的帝国级 ε 应收敛到 **|ε| ≤1/t**，且 `industrialSpend` 与工业池下降＋补料对得上。**PASS＝|ε| ≤1/t 且具名对账；FAIL＝仍 >1/t 或无具名汇；UNKNOWN＝窗内 boot 或端点缺失。**
- **口径边界**：`nuker` 储能不在生产 `tracked/other` 池里 ⇒ `nukeSpend` 作为 `industrialSpend` 的子集单列，drift 解释项只加 `industrialSpend − nukeSpend`；`bk` 自动携带两列，只读 Memory 的人可复算 drift。decompress battery→energy 是能量产出，不记工业消耗。
- **实测**：窗 84,107,605→84,108,227（622 拍、93 发、boot 84,107,581 全程未变）。`industrialSpend` 合计 **12,000**（W37S58 7,200／W38S56 4,800），与工业池变化逐房闭合：W37S58 池 +760 ⇒ 喂入 7,960；W38S56 池 −176 ⇒ 喂入 4,624；合计喂入 12,584＝消耗 12,000＋池增 584。`bk.industrialSpend` 已随 Memory 快照落盘（W37S58 单窗 3,000/50t＝满速；W38S56 600/50t），`nf` 与 `CONSUMPTION_FIELDS` 未变（单测钉住）。**但帝国级 ε＝+6,943（+11.16/t）**：`ΔP_total=+10,426` 对含工业扣除的 `ΣnetFlow=+3,483`；R708 同式不含工业桶时为 −5,057（−8.13/t）⇒ 工业桶解释了 12,000，却把残余翻成正号。逐房 epsClosed Σ＝−9,602（−15.4/t），正残差集中在 W37S58(+4,457)/W39S55(+1,671)，远矿房为负（调拨相位）。bot 自身 `economy.dr` 三房同窗 Σ＝+3,795（+6.10/t），R708 为 −36.80/t。`recycledRefund` 本窗三房全 0（分析脚本未采该列，但不影响本窗）。
- **裁决**：**否证**（预注册 PASS 未命中：|ε| 11.16/t ≫ 1/t）。**实质＝工业桶本身正确且可复算**（12,000 与池降+补料逐房闭合、四写点单测全绿、`nf` 口径未变），**未闭合的是另一条正向残差**：候选为远矿 `harvested` 下界（economy 被 CPU 跳过时丢 bump，本窗 `skippedPerTick=9.2`）、一端可见房 W38S58、或未入账拾取/取消孵化退款；立 **#207** 交下一轮分解。不得写成"ε 已闭合"或"工业桶无效"。

## E-20 · #207 帝国 ε 剩余正向残差分解（R711，11-06）
- **预期（11-06 13:3xZ 写死，出处 `tmp/observe/AGENT.lock` R711 目标卡；此后才开窗）**：沿用 E-18/E-19 的闭式 `ε = ΔP_total − [Σ_all_keys Δ(harvested + bought + recycledRefund − sold − spawned − upgraded − built − repaired − towerSpent − tradeFee − industrialSpend)]`（`imported/exported/pickedUp` 为内部项或二次流，不进闭式；`nukeSpend` 是 `industrialSpend` 子集不重复减）。同一 ≥600 拍窗、同 boot、两端可见房集一致（W38S58 若单端可见则剔除并单列）。本轮新增两把尺：① `recycledRefund` 进入 led 列；② 逐发采 `Memory.kernel.skipReasons`/`prevSkipReasons`，精确差分 `system/economy/budget*` 跳拍数 S 与 `economy/window-slip`。**PASS＝|ε| ≤1/t 且残差归到具名通道；FAIL＝仍 >1/t 且无具名汇；UNKNOWN＝窗内 boot 或端点/可见集不稳。**
- **先验分支（写死，禁止事后改判）**：
  1. **H1 部署税跳拍**：若 S>0 且 ε ≈ 丢拍量×实测采集率（丢拍量上界 2S、下界 S），判「economy 跳拍丢 harvested」为具名通道；若 S=0 而 ε 仍 >1/t，H1 否证。
  2. **H2 recycledRefund**：若 ΔrecycledRefund>0 且计入后收敛，判具名通道；若恒 0，H2 否证。
  3. **H3 W38S58 单端**：单列该房两端可见性与其携带能量；若其不可见端对应能量变化 >1/t，判具名通道。
  4. **H4 未入账拾取**：`pickedUp` 不进闭式；若残差为正且 `pickedUp` 差分大，只登记为候选，不许直接定罪（二次流与 loot 同形）。
  5. **反向对照**：`upgraded` 在 RCL8/升级瞬间按 `max(0, Δprogress)` 采样，若窗内发生升级清零，预期产生**负** ε；出现正残差时它不能当解释。
- **口径边界**：`epsClosed`（ε−(imp−exp)）是 R708 遗留的逐房启发列，不是帝国闭式；本轮只以 `ε` 为判决数。`ws` 三元组是核算恒等式残差累计，不拿来当净流。
- **实测**：窗 84,109,241→84,109,644（403 拍、70 好样本、boot 84,107,581 未变；原始 `tmp/observe/r711-samples.jsonl`／`r711-analyze-final.txt`）。`ε=+715（+1.774/t）`：`ΔP=−1,242`、`ΣnetFlow=−1,957`；`harvested=38,680`、`spawned=20,600`、`upgraded=5,099`、`built=1,095`、`repaired=1,405`、`towerSpent=1,540`、`tradeFee=3,698`、`industrialSpend=7,200`、`recycledRefund=0`。**H1 否证**：skip 重建 `economyBudget=0／budgetCap=0／windowSlip=0／allSystemSkips=0`（lostTicks=[0,0]）；**H2 否证**：`recycledRefund` 全 0；**H3 无污染**：W38S58 仅早段可见 14 发、`P/D=0`、source 3000；远矿 outflow Σ16,415 对 imported 17,055（差 640，边界量级）。`pickedUp=4,448`（W39S55 3,150／W37S58 956／W38S56 342）只登记为候选，未定罪。bot `dr` 同窗 Σ **−670（−1.663/t）**，与本尺反号但同量级。
- **裁决**：**UNKNOWN**（预注册形状：good 跨度 403<600；`/api/user/memory` 自 14:20Z 起长 429、console 读回同时超时，探针端点随之中断）。**不得写成 PASS**（跨度不达标）；**也不得写成 FAIL**（预注册 FAIL 需要 ≥600 拍且无具名汇）。已到手的否证只有 H1/H2/H3 三条候选，本轮正残差本身既未复现到 11/t、也未被解释。**口径修正**：R708/R710 的物理池 `P`（probe B）与 carry `H`（probe A）相差 1 拍，单个 transfer 可在端点注入上千能量误差；本轮起物理侧（P/D/H）同拍、账本单发，端点边界误差降到约一拍流量。**口径债**：每周期 2 探针＋clear＋整份 Memory 读疑似 429 触发源，下一轮改 probe-only。

## E-21 · #207 观测通道解阻：segment-4 能量审计指标（R712，11-06）
- **预期（11-06 15:5xZ 写死，代码改动之前；出处 `tmp/observe/AGENT.lock` R712 目标卡）**：
  1. 部署后 ≥100 拍内，`/api/user/memory-segment?segment=4` 的文本出现 `screeps_economy_audit_tick`、全部 `screeps_economy_audit_<field>{room=...}` 与四项池指标（general／industrial／loose／carry），且段文本 <80KB、`screeps_runtime_cpu_used` 与部署前同量级（差 ≤0.5/t）。
  2. 同一 boot 内取 ≥600 拍两端样本，按 E-18/E-19 闭式 `ε = ΔP_total − ΣΔ(harvested + bought + recycledRefund − sold − spawned − upgraded − built − repaired − towerSpent − tradeFee − industrialSpend)` 计算；PASS＝|ε| ≤1/t 且具名；FAIL＝>1/t 无具名；UNKNOWN＝boot 变化／段缺样本／两端可见房集不一致。
  3. 若残差 >1/t，`pickedUp` 是首要候选（R711 唯一同量级未定罪项），但不得单凭同量级定罪；必须与 Δloose（掉落／墓碑／废墟）同向且量级差可解释。
- **口径边界**：segment 4 的 gauge 每 10 拍覆盖一次，样本 tick 由 `screeps_economy_audit_tick` 标注；`imported/exported` 为内部项不进闭式；`nukeSpend` 是 `industrialSpend` 子集不重复减；carry 按 `memory.home` 归房（与 R711 物理侧 H 同口径）；掉落／墓碑／废墟按房计。
- **实测（16:0xZ，部署后 ≥80 拍）**：commit `17eb882b`、CI `42247608760` success、live sha `8e4275d98d57`（813,086B，与本地同 commit dist 逐字一致）。segment 4 复读：`screeps_economy_audit_tick=84,111,201`；8 个可见房的四项池指标在场（W37S58 general 927,440／industrial 303,919／carry 4,340；W38S56 915,390／3,440／678；W39S55 57,401／0／465；远矿 W37S55 26,838 等）；账本 15 列在首个 economy 采样后出现（W37S58 harvested 840、towerSpent 1,500、imported 1,705；随后 10 拍 +200／+300 的连续增量）；`audit_seen` 全部为 1。段文本 55,746B（<80KB）；`screeps_runtime_cpu_used` 14.4–15.0（部署前 300t 环 avg 15.2）⇒ 仪器面三项验收全部命中。
- **裁决**：**命中（仅仪器面）＋ ε 窗口未开始**。第 2 条（≥600 拍 ε 闭式）本轮未跑，留给下一轮；不得写成 PASS/FAIL。
- **实测（R713，18:1xZ）**：窗 84,112,201→84,112,821（**620 拍、63 样本、10 拍间隔、同 boot**）；`ΔP=−10,186`、`ΣnetFlow=−13,248` ⇒ **ε=+3,062（+4.939/t）**。闭式 `harvested=53,780／spawned=35,380／upgraded=11,229／industrialSpend=15,600／repaired=2,277／towerSpent=2,170／tradeFee=372`；`pickedUp=2,204`（诊断项）、`imported=20,917`、`exported=1,650`。**具名通道＝账外 carry**：carrier 死亡 1,456＋hauler 死亡 548＋remoteHauler 死亡 161＋两笔无死亡卸货 510/826＝**+3,501 ≥ ε**；死亡区间承载净 ε 的 96.9%。code 根因＝`kernel.ts:358-362` 与 `EnergyAuditMetrics.ts:127-131` 仅在 `creep.memory.home` 存在时计 carry。H1（economy 跳拍）**未成立/未证**（低 harvest 区间 CPU `sk` 5/7 对均值 6.34，无尖峰；segment 4 无 skipReasons）；H2/H4–H8 否证或量级不足；窗内全量环无 EnergyTransfer/MineralTransfer/Market/Enemy/War。
- **裁决（R713）**：**FAIL（字面；|ε|=4.939/t > 1/t）＋正向具名通道**。残差不是游戏经济漏口，而是**账外 carry 的仪器/账本覆盖缺口**；净差 −439 的负向小项（Δloose −250、repair 同拍多计候选）未再分。另立 #208：下一轮先给 `EnergyAuditMetrics` 加 `audit_unhomed_carry`/`audit_unhomed_creeps` 与 unseen-home carry 导出，再取同 boot ≥620 拍窗复判；PASS＝纳入账外 carry 后 |ε|≤1/t 且具名；FAIL＝仍 >1/t；UNKNOWN＝boot/段缺失/样本不足。无 home 的 creep 身份/数量本轮不可得（memory 端点 429，retry ≈13.1h）。
