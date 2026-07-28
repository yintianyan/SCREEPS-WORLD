# Creep 角色全链路审查记录

逐角色审查工作模式（生产/消费/限制/RCL 演化）过程中发现的问题清单。
审查完所有角色后统一排期修复；修复完成的条目标记 ✅ 并注明落地方式。

严重度口径：
- **P2** — 会造成实际资源损失或行为卡死的缺陷，修复优先
- **P3** — 特定场景下的效率损失或风险敞口，需评估后修复
- **P4** — 注释/文档/测试与代码漂移，不影响运行，批量清理

状态：`待修` / `已修 ✅` / `暂缓（附原因）`

---

## Worker（审查于 2026-07-28）

### W-1 [P2] fillAssignmentTarget 的 ERR_FULL 携能活锁 — 待修

- 位置：`src/creeps/roles/worker.ts` fillAssignmentTarget 的 execute
- 现象：transfer 返回 ERR_FULL 时仅在空载（used===0）时切回 acquire；
  携能状态下什么都不做 → 下一 tick resolve 仍返回同一 target →
  每 tick 重试 ERR_FULL，卡到 assignment lease 过期为止。
- 对比：`fill.ts` 的通用 fillTarget 在 ERR_FULL 时会清缓存 + updateMode。
- 修复方向：ERR_FULL 且携能时 releaseAssignment，让 work 链 fallthrough
  到 repairCritical / fillTarget / upgradeController。
- 回归测试：携能 + assignment 目标已满 → 断言 assignment 被释放且执行后续候选。

### W-2 [P3] 成熟房团灭恢复无视 storage 储备 — 待修

- 位置：`src/creeps/roles/worker.ts` acquire 链（仅 pickup + harvest）
- 现象：高 RCL 房带大量 storage 能量团灭时，P0 worker 仍去 source
  慢速直采，不会从 storage 取能填 spawn/extension。
- 影响：成熟房灾后恢复窗口被不必要拉长（正规军孵化延迟）。
- 修复方向：acquire 链在 harvestSource 之前加「storage 有能量则 withdraw」
  候选。worker 永不回填 storage，无循环风险。
- 验证：集成场景 — 团灭 + 满 storage，对比恢复到首个正规 harvester 的 tick 数。

### W-3 [P3] P0 恢复短路无视 defense 态 — 待评估

- 位置：`src/domain/spawn/demand.ts` P0 短路（livingHarvesters===0 时
  push worker 后 return，阻塞包括 defender 在内的所有请求）
- 风险：团灭由敌袭造成且敌人仍在（无塔窗口期）时，worker 被孵进
  威胁房 → flee → 可能被杀 → 再孵，持续放血。invader 有 TTL，
  实际发生概率低。
- 处置：先补边界测试（livingHarvesters===0 && threatCreeps 非空）确认
  现状行为（flee 是否保命），再决定是否需要「威胁贴 spawn 时延迟 P0」。
- defender 审查补充（2026-07-28）：已确认 P0 短路（demand.ts L259-262
  return）排在 defender 块（L265-281）之前 — defense 态 + 采集团灭时
  defender 请求根本不会生成，直至 worker 孵出。阻塞事实成立，
  风险评估维持原判（invader 有 TTL，概率低但存在）。

### W-4 [P4] 注释/文档/测试三处漂移 — 待修（批量清理）

1. `src/creeps/roles/worker.ts` 头注释写「acquire: getSource > 拾取掉落能量」，
   实际代码顺序是 pickup 优先于 harvest。
2. `docs/creep-behavior-constraints.md` W-01 写「body 固定 [WORK,CARRY,MOVE]
   成本 200」，实际 bodies.ts 已有 300 容量档 [W,W,C,M]；W-04 工作链缺
   repairCritical 环节。
3. `tests/unit/role/worker.test.ts` 注入 kind:"harvest" 的 assignment，
   但 ROLE_TASK_KINDS 中 worker 仅接受 ["fill"]，生产环境不存在该路径 —
   测试断言的是死路径，应改为验证 memory.sourceId 直驱或删除。

---

## Harvester（审查于 2026-07-28）

### H-1 [P3] harvestMineral 被 stationaryMine 拦截，成熟房矿物采集不可达 — 待修

- 位置：`src/creeps/roles/harvester.ts` acquire 链顺序；
  `src/creeps/engine/actions/harvest.ts` stationaryMine.resolve
- 现象：stationaryMine.resolve 只要「分配到 source + 旁有 container/link」
  就返回目标，**不检查 source.energy > 0**。source 再生期间它仍然命中
  （execute 里 harvest 返回 ERR_NOT_ENOUGH_RESOURCES 被静默忽略），
  短路了 acquire 链后面的 harvestMineral。
- 后果：harvestMineral 注释声明的「source 再生期间的空闲利用（RCL6+）」
  对站桩矿工（成熟房常态）永远不可达 — 恰好是 extractor 存在的阶段。
  房间矿物收入实际为零（除非市场买入）。
- 修复方向二选一：
  a) stationaryMine.resolve 在 source.energy===0 且背包空时返回 undefined，
     放行后续候选（注意保持 P2-7 不离岗语义：有 extractor 才放行）；
  b) 承认站桩矿工不采矿物，引入独立 mineralHarvester 角色（extractor+
     storage 存在时按需孵化）— 通勤成本与 regen 窗口错配问题一并解决。
- 验证：线上查 storage/terminal 矿物库存增量；离线场景测试 regen 窗口行为。

### H-2 [P2·潜伏] hauler haulMineralsToStorage 满载取矿活锁（跨角色，随 H-1 联动） — 待修

（hauler 审查复核确认，且比初判更严重：该候选位于 work 链首位，
withdraw 相命中后 ERR_FULL 静默忽略并消费掉本 tick 候选 —
**排他性阻塞整条 work 链**，fillStorage/haulFillTarget 全部不可达，
能量卸不出、mode 永不翻转。）

- 位置：`src/creeps/engine/actions/industry.ts` haulMineralsToStorage.resolve
  （withdraw 相不检查 creep 剩余容量）；hauler work 链首位
- 现象：hauler 满载能量进入 work 模式时，若任一 container 含矿物，
  resolve 返回 withdraw 相 → withdraw 返回 ERR_FULL 被 runAction 静默忽略 →
  候选已消费、work 链终止 → **所有满载 hauler 每 tick 卡死**，
  直到矿物被外部移除（而搬矿物的正是这些 hauler，自锁）。
- 当前未爆发的原因：矿物进 container 依赖 harvester 的矿物链，
  而该链被 H-1 挡死 — 两个缺陷互相掩护。修 H-1 时必须同时修 H-2。
- 修复方向：withdraw 相要求 creep.store.getFreeCapacity() > 0，
  否则返回 undefined 放行后续候选。
- 回归测试：满载能量 hauler + 含矿 container → 断言 fallthrough 到 fillStorage。

### H-3 [P3] dumpMineralsToNearbyContainer 不区分 container 用途 — 待评估

- 位置：`src/creeps/engine/actions/dump.ts` L55-74
- 现象：矿物倒入 range≤2 最近的有空位 container，多数情况就是
  source container（能量物流枢纽），占用能量缓冲容量。
- 缓解因素：下游 hauler 的 haulMineralsToStorage 会回收（H-2 修复后成立）。
- 处置：随 H-1 方案定 — 若走独立 mineralHarvester 路线，此动作应
  限定为 extractor 旁 container 或直接携回 storage。

### H-4 [P4] 注释/文档/测试漂移 — 待修（批量清理）

1. `src/creeps/roles/harvester.ts` L6 策略注释写 work 链末尾「> 建造 > 升级」，
   但同文件 L52-54 明确声明不 fallback 建造/升级（park 待命）— 同文件自相矛盾。
2. `docs/creep-behavior-constraints.md` R1-03/R1-04/R2-03/R4-03 均写
   「harvester 结构全满时回退升级控制器」，与代码（park、绝不升级）不符。
3. `harvester.ts` L48 注释写 fillTarget「直接送 spawn/extension/tower」，
   实际 snapshot.fillTargets 还含 controllerContainer。
4. `tests/unit/role/harvester.test.ts` 用例注释的优先级编号（1/1.5/2/3/4/5）
   与 harvester.ts 的编号（2/3/3.5/4/5）不一致（语义匹配，编号漂移）。
5. `estimateTravelTicks` 仅用 spawns[0] 估距，多 spawn 房有轻微偏差（观察项，
   不单独修）。

---

## Hauler（审查于 2026-07-28）

### HL-1 [P2] 战时 fillStorage 抢在 tower 补给之前 — 待修

- 位置：`src/creeps/roles/hauler.ts` work 链顺序（fillStorage 在
  haulFillTarget 之前）；`src/creeps/support/targeting.ts` getHaulFillTarget
  的威胁时 tower 置顶逻辑
- 现象：getHaulFillTarget 精心实现了「威胁时 tower 最高优先」（P1-3），
  但 RCL4+ 只要 storage 有空位（常态恒真），work 链在 haulFillTarget
  之前就被 fillStorage 短路 — **战时 tower 优先级实际不可达**，
  hauler 携能路过缺弹的 tower 去填 storage。
- 缓解因素：distributor tier 0（storage ≥50k）会填 tower；但储量 <50k 的
  战时（恰是最脆弱期）tower 补给无人负责 — distributor tier≥1 跳过 tower，
  hauler 被 fillStorage 短路，形成战时补给真空。onFlee 的防御圈充能
  只在 hauler 已 flee 且已在圈内时触发，覆盖不了主动补给。
- 修复方向：fillStorage 的 resolve 增加威胁门禁 — threatCreeps 非空且
  存在缺能 tower 时返回 undefined，放行 haulFillTarget（其内部已有
  威胁时 tower 置顶）。
- 回归测试：威胁 + storage 未满 + tower 缺能 → 断言 transfer 到 tower
  而非 storage。

### HL-2 [P3] acquire 链首位候选的 idle 置位破坏链式回退 — 待评估

- 位置：`src/creeps/roles/hauler.ts` withdrawAssignmentContainer 与
  withdraw.ts 各 capped 动作的 ERR_NOT_ENOUGH_RESOURCES → mode="idle"
- 现象：resolve 已按「container 有能量」过滤，execute 中 ERR 仅为同 tick
  竞态（多 hauler 同时抽同一 container）。竞态时置 idle 使 creep 本 tick
  后续无动作、下一 tick 经 updateMode 恢复 acquire — 损失 1-2 tick。
  对比 harvest.ts 的竞态处理哲学（「保持 acquire 自动重试比切 idle 更快」）
  口径不一致。
- 影响：多 hauler 抢同一富 container 的高峰期累积性吞吐损耗，非卡死。
- 处置：低优先级。若修，统一为「竞态不置 idle，保持 mode 自然重试」。

### HL-3 [P4] 文档 HA 约束大面积过时 — 待修（批量清理）

docs/creep-behavior-constraints.md 的 hauler 段描述的是「hauler 可从
storage 取能」的旧架构，与现行「hauler 永不从 storage 取能」直接矛盾：
1. G-EN-08 / HA-04 / HA-08：写「无 container 时回退 storage 取能」—
   代码三重阻断（链设计、TD-013 类型守卫、任务源过滤），单测明确断言不回退。
2. HA-05：写 work 链末位「升级控制器」— hauler 无 WORK 部件不可能升级，
   实际链为 minerals → fillStorage → haulFillTarget → supplyLabs → 待命。
3. HA-01/HA-10 body 数值过时：文档写 3C3M@300 顶档，实际默认档最高
   6C6M@600、道路档 16C8M@1200。
4. HA-03「harvester 达 minCount 后才孵 hauler」在代码中无对应门禁
   （仅隐式依赖 hasLogistics）— 要么补文档要么补代码，需决策。
5. bodies.ts 道路优化档注释写「核心物流路已铺设时使用」，实际切换条件
   只看 RCL≥4，并不检测道路存在 — 注释与代码语义差距。

### HL-4 [P4·观察] withdrawCapped 类型签名允许 storage — 暂缓

- 位置：`src/creeps/engine/actions/withdraw.ts` withdrawCapped 签名
  （StructureContainer | StructureStorage）
- 「hauler 永不取 storage」目前靠调用方自律（hauler 只传 container 选择器）。
  收紧签名可把架构约束变成编译期保证，但影响其他调用方，随批量清理评估。

---

## Distributor（审查于 2026-07-28）

### D-0 [P2] tier 3 排除 extension 的自锁吸收态 — 已修 ✅

- 已于本日修复并部署上线：所有档位服务 spawn/extension（节流靠取能限额），
  取能门禁 hasDistributorFillDemand 与投放过滤同一 tier 口径。
- 落地：targeting.ts / distributor.ts / config 注释 / 10 个单测，线上验证
  eA 586→1341（详见当日部署记录）。

### D-1 [P3] stockTerminalEnergy deposit 相无水位门禁（注释与实现不符） — 待修

- 位置：`src/creeps/engine/actions/industry.ts` stockTerminalEnergy
- 现象：withdraw 相有 storageEnergyFloor(20000) 地板，但 deposit 相只看
  terminal 缺口（<10000 即收）。低水位场景：tier 2/3 distributor 限取
  400/200 后，fillTarget 被其他 creep 中途补满 → work 链落到
  stockTerminalEnergy deposit 相 → 保命能量漏进 terminal（变成贸易运费
  储备，低水位期实质冻结）。
- 函数头注释「仅在 storage 能量高于地板值时搬运」与实现不符 —
  地板只约束取、不约束投。
- 修复方向：deposit 相同样要求 storage ≥ storageEnergyFloor（或
  distributorTier ≤ 1），否则返回 undefined，让 creep 携能待命，
  下一波 fillTarget 需求出现时正常投放。
- 回归测试：tier 3 携能 + terminal 缺口 + fillTargets 空 → 断言不 transfer
  到 terminal。

### D-2 [P3] supplyLabs 能量地板 1000 与水位口径脱节 — 待评估

- 位置：`src/creeps/engine/actions/industry.ts` LAB_ENERGY_STORAGE_FLOOR=1000
- 现象：distributor acquire 链尾挂 supplyLabs，lab 能量装料需求在
  storage >1000 时就放行抽血 — 低于 distributorTiers.low(2000)，
  更远低于 market 地板(20000)。低水位时 boost 能量与孵化保命能量抢血。
- 张力：boost 常用于战时，而战时可能恰是低水位 — 一刀切抬高地板会
  削弱战时 boost 能力。需决策：地板对齐 sustained(10000)，或引入
  「防御态豁免」。
- 处置：待评估，与 HL-1（战时能量分配）一并定方案。

### D-3 [P3] distTarget 需求信号与 tier 服务范围口径不一致 — 待评估

- 位置：`src/domain/spawn/demand.ts` distributor 段（fillCount =
  snapshot.fillTargets.length）
- 现象：编制折算按全量 fillTargets（含 tower、controllerContainer），
  但 tier≥1 的 distributor 不服务 tower/cc — 低水位期需求信号虚高，
  孵出的编制却不服务那些目标。spawn-manager 撤销通道以
  「fillTargets 为空」为条件，tower 长期缺能时永不触发。
- 与 HL-1 联动：低水位 + tower 缺能 → 无人填 tower（HL-1）+ distributor
  编制虚高维持（本条）— 双重浪费。
- 缓解因素：150 tick 趋势确认 + maxCount=3 封顶，实际过量有限。
- 修复方向：fillCount 改按当前 tier 可服务的目标数统计（复用
  hasDistributorFillDemand 的过滤口径做计数版本）。

### D-4 [P4] supplyLabs 双角色消费同一需求表，无认领机制 — 暂缓

- 位置：hauler work 链与 distributor acquire/work 链都挂 supplyLabs，
  共读 globalCache.labDemands，load.amount 不随认领递减。
- 后果：同/邻 tick 内两角色可能为同一 load 重复取料；自愈路径存在
  （装不下走 dump 相倒回 storage），代价是白跑一趟，不会错矿占位。
- 处置：暂缓 — 引入 fillReservations 式的每 tick 认领集收益有限，
  等 lab 吞吐成为瓶颈再做。

### D-5 [P4] getRoleBounds 对无映射角色跳过 clampParam — 待修（批量清理）

- 位置：`src/config/tuned.ts` getRoleBounds（ROLE_PARAM_MAP 无
  distributor/defender/claimer 行）
- 现象：Memory 中的 roleBounds 覆盖值先无条件应用、再查映射表钳制 —
  无映射行的角色跳过 clampParam，任何渠道（控制台误操作/bug）写入的
  越界值直接生效，仅剩 min≤max 不变式兜底。
- tuning-engine 目前不产出这些角色的覆盖（evaluator 清单里没有），
  风险是防御性缺口而非现行 bug。
- 修复方向：getRoleBounds 对无映射角色拒绝应用 Memory 覆盖（保守），
  或补齐映射行与 TUNING_BOUNDS 条目。

### D-6 [P4] constraints 文档缺 distributor 章节 — 待修（批量清理）

- docs/creep-behavior-constraints.md 全文 0 次提及 distributor —
  第 11 节「各角色详细行为约束」未收录。角色代码注释中的架构约束
  （永不 fillStorage、assignment-free 设计、tier 水位分级）均未沉淀
  到约束文档。随 HL-3 文档债一并补齐。

---

## Upgrader（审查于 2026-07-28）

### U-1 [P3] gate 的「替代能量源」判定被 acquire 链顺序旁路，storage 低水位保护形同虚设 — 待修

- 位置：`src/creeps/roles/upgrader.ts` upgraderGate（hasNonSourceContainerEnergy /
  hasLinkEnergy 放行分支）与 acquire 链顺序（storageCapped 排在
  richestNonSourceContainer 之前）；`withdraw.ts` withdrawStorageCapped.resolve
  （只查 storage > 0，无 floor）
- 现象：gate 的 upgradeEnergyFloorStorage(1000) 地板只在「无任何替代源」时
  才检查。但放行后 acquire 链先命中 withdrawStorageCapped（storage > 0 即取），
  实际取的是 storage 而非触发放行的那个 container/link。只要房里任一
  非 source container 或任一 link（含 source/storage link — 判定不区分类型）
  有一点能量，upgrader 就能在 storage < 1000 时继续抽 storage。
- 影响：低水位「停升级攒库存」意图被部分挫败。量级受限：当前 body 全系
  1 CARRY（每趟 50），且 demand 在 storage < sustained 时编制 ≤1 —
  是持续渗漏而非抽干，但方向性错误且与 D-0 修复同型（门禁与实际取能
  口径分裂）。
- 修复方向（二选一）：
  a) withdrawStorageCapped.resolve 增加 floor：storage <
     upgradeEnergyFloorStorage 且非紧急时返回 undefined，放行链上后续候选 —
     把地板下沉到 action，gate 旁路自然失效（推荐，与 D-0 手法一致）；
  b) gate 的替代源判定改为精确匹配 acquire 链中排在 storage 之前的候选
     （controller link / controller container / 近身掉落）。
- 回归测试：storage 800 + 远处 container 有能量 + 非紧急 → 断言不从
  storage withdraw。

### U-2 [P4] dynamicStorageLimit 是惰性代码（被 1 CARRY body 形态掩盖） — 待修（批量清理）

- 位置：`src/creeps/roles/upgrader.ts` dynamicStorageLimit（比例阈值
  0.5/0.15 → 绝对 50 万/15 万）
- 现象一：比例阈值 — 与 distributorTiers 修掉的同型缺陷，发展期房间
  永远落在最低档 200。
- 现象二（更根本）：所有 upgrader body 档位只有 1 CARRY（50 容量），
  取量 = min(available, carryFree=50, limit≥200) — **limit 从不生效**。
  「P1-1 动态限额防 storage 突降」的保护实际由 1C 小背包天然提供，
  函数是死旋钮，注释宣称的机制并不存在。
- 处置：随 U-1 的方案 a 一并简化 — floor 下沉后动态限额可直接删除或
  改为绝对阈值（若未来 body 加大 CARRY 才有意义）。

### U-3 [P4] upgradeControllerGated 死代码 — 待修（批量清理）

- 位置：`src/creeps/engine/actions/upgrade.ts` L28-41
- 全库无调用点；且其地板只用 upgradeEnergyFloor(300)，无 RCL4+/storage
  变体，与 G-EN-03 双地板描述不一致。删除或补齐调用方，二选一。

### U-4 [P4·观察] gate 紧急判定与 Memory risk 迟滞口径差 — 暂缓

- gate 直接比 ticksToDowngrade < 10000（无迟滞），room-state 的
  controllerDowngradeRisk 用 10000/15000 非对称迟滞带。10000-15000
  区间内两者判定不同（gate 已解除、Memory 仍在风险态）。影响仅为
  gate 放行策略的边界抖动，方向安全（Memory 态更保守）。

### U-5 [P4] 文档漂移 + 一项待核实 — 待修（批量清理）

1. R4-04 写「upgrader 优先从 storage 取能」— 实际 storage 排第 4
   （dropped → link → cc → storage）。
2. 4.2 / 7.2 body 表写 upgrader 350 成本 2W body — 实际主力档
   15W@1650 / 8W@950。
3. G-EN-03 未提 RCL1-3 地板的 min(300, 容量×0.4) 缩放项，也未提
   「有替代源即放行」前置分支。
4. ~~待核实：G-CPU-03 运行时跳过~~ **已核实一致**：kernel.ts runCreeps
   （L259-279）有按 colonyState 的逐 creep 门禁 — recovery/bootstrap 跳过
   P2+，builder 有 recovery 豁免（P1 等效优先级，早于 budget 检查，
   P1-2 死亡螺旋修复）。文档 G-CPU-03 与代码一致，无需修改。

---

## Builder（审查于 2026-07-28）

### B-1 [P3] builderStorageLimit 比例阈值 — 发展期建造吞吐被掐死 — 待修

- 位置：`src/creeps/roles/builder.ts` builderStorageLimit（比例阈值
  0.2/0.1 → 绝对 20 万/10 万）
- 现象：storage < 10%（即 < 10 万能量 — 发展期房间常态）时取能限额 50/趟。
  RCL4 主力 body 8W4C6M：8 WORK 烧 40 能量/tick — 50 能量只够 ~1.25 tick
  建造，随后整趟往返取能。建造 duty cycle 掉到个位数百分比。
- 口径错乱佐证：demand 在 storage ≥ 50k 时已判定为「冲刺水位」（2 个
  upgrader 烧库存），而同一水位 builder 被按「低水位」掐到 50/趟。
- 注释漂移：函数注释宣称「与 distributor 水位分级对齐」— distributor
  已改绝对阈值（D-0），builder 仍是比例制。这是比例阈值缺陷第三次
  出现（distributor 已修 / upgrader U-2 死旋钮 / builder 本条活着且咬人）。
- 修复方向：改绝对阈值并挂入统一水位刻度（sustained 10k / sprint 50k
  参照系）；例如 ≥10k 满载、2k-10k 限 200、<2k 限 50。
- 回归测试：storage 30k（发展期健康水位）→ 断言 builder 满载取能。

### B-2 [P4] fill 回退不参与 fillReservations — 暂缓

- 位置：builder work 链的 fillTarget()（通用版，getFillTarget 纯最近距离）
- 现象：builder 的填充回退不参与 hauler/distributor 共享的 fillReservations
  预约集，三角色可能同 tick 挤向同一 spawn/extension；靠 ERR_FULL
  清缓存 + updateMode 自愈，代价是白跑。
- 触发面窄（builder 仅在无 site、无衰减 container、无 critical 维修时
  才走到 fill），暂缓；若改，让 builder 复用 getHaulFillTarget 即可。

### B-3 [P4] 注释/文档漂移 + 死配置 — 待修（批量清理）

1. `builder.ts` L7 头注释链序「... > fill > critical repair > 升级」与
   实际代码（repair 在 fill 前、无升级回退、遗漏 freshRampart/容器衰减/
   修路/修墙四层）不符 — 同文件自相矛盾（与 harvester H-4.1 同型）。
2. 文档 G-EN-05 / R2-10 / 4.5 表「回退链 ... → 升级 → idle」过时 —
   builder 已明确不升级（L115-116 注释）。
3. 文档 G-CPU-06 前半句 /2.2 tier 表「conserve 下 builder 只执行 P0/P1
   site」过时 — 现行为 conserve 不过滤（builder.test.ts 三例验证新行为），
   门禁职责已上移 construction-manager developmentGate（L99）。
4. `build.ts` conserveCriticalOnly 选项 + isCriticalSite 为该旧机制残留，
   builder 未启用 — 与 U-3 同类死代码，删除或注明保留原因。
5. 观察项：acquire 链尾 harvestSource 直采兜底无采位排他，可能与
   harvester 争位（低频边界，不单独修）。

### B-4 [P3] 直采兜底全员涌向同一 source（跨角色：builder/upgrader） — 待修

- 位置：`src/creeps/support/targeting.ts` getSource（平局严格小于 →
  偏向 sources[0]）；`src/kernel/kernel.ts` L138（sourceOccupancy 只统计
  harvester/worker — 刻意设计，注释明确「其他角色仅寻路不占位」）
- 现象：双 source 房各 1 harvester → occupancy 平局 → 每个走直采兜底的
  builder/upgrader 都分到 sources[0]；它们的 sourceId 不计入占用 →
  互相不可见 → 后续同伴仍选同一 source；公平份额迁移基于同一张
  不含它们的表 → 永不触发。与 buildHarvesterOccupancy 注释记载的
  「平局偏向 sources[0] 双矿工挤同源」实测事故同型 — 孵化侧已修，
  运行时侧残留。
- 叠加：5W harvester 使 source 长期贴零，harvestSource.resolve 过滤
  energy===0 → 直采 builder 大部分 tick 落空 → park/重试振荡 —
  移动 CPU + 零产出。
- 修复方向：getSource 对非计数角色（非 harvester/worker）改为
  「有能量的最近 source」或按距离破平局 — 不触碰 kernel 的占用排除
  决策（有事故背书），临时工按地理就近分散即可。
- 回归测试：双 source + 2 builder 直采 → 断言分配到不同 source
  （或各自最近者）。

### B-5 [P3] builder 编制不感知取能供给 — 存量 site 撑住编制、全员直采空转 — 待评估

- 位置：`src/domain/spawn/demand.ts` builder 段（target 由 site 数驱动，
  供给侧仅有 economyPressure 迟滞收缩 + economyCap 头数代理）
- 缺口场景：存量 site 仍在 + 能量转差但未触发 pressure 收缩（滞后）+
  无 storage 或 storage 空 → site 数维持编制，builder 无能可取，
  全员落直采兜底（与 B-4 叠加放大）。site 创建端的 developmentGate
  能量门禁只管新 site，管不住存量。
- 修复方向（复用统一水位表，不引入新信号）：
  a) 有 storage：storage < sustained(10000) 时 builder 目标钳到 1
     （与 B-1 的绝对阈值取能节流同一把尺子）；
  b) 无 storage：用快照现成数据做供给地板（如 container 总能量 <
     单趟载量 × 现有编制时不再补员）。
- 拒绝路径：为直采兜底加占位预约系统 — 兜底路径不值得跨 creep
  协调状态；饥荒期正确形态是「少编制慢慢干」而非「多编制高效分矿」。
- 验证：集成场景 — 存量 3 site + container 全空 + 无 storage，
  断言 builder 编制收缩且不出现多 builder 同源振荡。

---

## Defender（审查于 2026-07-28）

### DF-1 [P3] 追击无边界 — exit 边缘 kiting 双重振荡 — 待修

- 位置：`src/creeps/roles/defender.ts` attackNearestThreat（无 exit
  距离检查、无追击滞回）；`src/systems/spawn-manager.ts` L57-59
  （威胁清零 tick 即撤 defender 单）
- 现象：敌人在 exit 边缘反复进出时 — 出房 tick 从 FIND_HOSTILE_CREEPS
  消失 → threatCreeps 空 → defender 无候选转 park + spawn-manager 撤掉
  pending 单；再进房 → 重新追击 + 重新入队。行为侧与孵化侧双重振荡
  （孵化侧受 spawnKey 去重与存活计数缓解，行为侧无缓解）。
- 叠加局限：defender 纯 ATTACK+MOVE（无 RANGED），对 ranged kiter
  本就打不着 — 追击只是被风筝放血；塔是对 kiter 的正确回答。
- 修复方向：attackNearestThreat.resolve 过滤「距任一 exit ≤2 且自身
  距目标 >3」的目标（不值得追到门口）；或 defender 只在核心区半径内
  接战（守点不追击），出圈目标交给塔。
- 回归测试：目标在 exit 边缘（x=1）+ defender 距离 5 → 断言不移动追击。

### DF-2 [P3] 塔盈亏判定不计 boost 治疗 — 注释宣称的「情报层」不存在 — 待评估

- 位置：`src/domain/defense/tower-engagement.ts` L16-17（注释：「不计
  boost 倍率 — boost 编队的识别属于情报层职责」）；防御链路全域
- 现象：expectedHeal = HEAL 部件数 × 12，不读 body[].boost。T3 boost
  （XLHO2）治疗 ×4 → 真实治疗量被低估 4 倍 → boosted heal-tank 编队
  可骗过盈亏线让塔「误判打得动」持续开火喂能量；反向场景（低估后
  误判打不动）不存在 — 低估只会高估己方净伤。实际危害：塔对 boosted
  编队白耗能量。缓解：breachingCore 无条件开火不受影响。
- 关键事实：注释把职责推给「情报层」，但 grep 防御域无任何 boost 感知
  消费者 — 项目有 BOOST_EFFECTS 表（Phase 4 已按引擎常量修正）却未在
  engagement 中消费。承诺的接线缺失。
- 修复方向：towerSummaries 构造处按 body[].boost 查 BOOST_EFFECTS
  折算有效 HEAL 部件数（约 10 行）；threat.ts 的 isThreat 不需要变。
- 触发面：PvP boosted 编队（NPC Invader boost 等级低）。优先级取决于
  所在 shard 的邻居敌意，暂记 P3 待评估。

### DF-3 [P4] 威胁清除后存量 defender 无回收 — 暂缓

- 现象：威胁清除后 defender park 待命至 TTL 自然耗尽 — 满配 1300 能量
  defender 纯损耗。对照：remote 系有 recycleExcessRemoteCreeps 回收，
  recycle 机制（memory.recycle → spawn-manager 接管）已存在，defender
  未接线。
- 修复方向：威胁清除持续 N tick（如 200，防敌人回马枪）后标记
  recycle，回收残值。收益 = 剩余 TTL 比例 × body 成本 × 回收率，
  中等；暂缓至批量清理。

### DF-4 [P4] 防御文档漂移 + defender 角色零单测 — 待修（批量清理）

1. G-DF-01 写 shouldFlee 条件为「hostileCreeps.length > 0」— 实际为
   threatCreeps（P0-2 分类修复后口径），过境 scout 不再触发。
2. G-DF-05 只写「无塔+有敌人 → safe mode」— 实现更严（要求核心区
   突破 ≤5 格）且多一条路径（有塔但全塔哑火 + 突破，tower-defense
   L72-74）。文档滞后于改进。
3. G-DF-08 只写 RCL 三档目标血量 — 已升级为 fortification 三层分层 +
   受袭 5 倍 + core 0.3 折扣。
4. G-CPU-04「所有角色先 shouldFlee」未注明 combat 角色豁免。
5. 测试盲区：tests/unit/role/ 无 defender 测试文件 — 追击/park/威胁
   消失转换零覆盖（孵化侧与塔防侧覆盖良好）。DF-1 修复时一并补。

---

## Claimer / 扩张链（审查于 2026-07-28）

### C-1 [P3] CPU 门禁冻结整个扩张状态机 — 超时钟表停走、失败不召回 — 待修

- 位置：`src/systems/expansion-manager.ts` L40-41（budget tier 非
  healthy/guarded 或 bucket<5000 时 run 整体提前 return）
- 现象：CPU 门禁本意是「扩张是纯发展行为，紧张时挂起」，但 return 位置
  在状态机分发之前 — 冻结的不只是新行动，还包括：claiming 超时判定
  （钟表停走）、claimer 阵亡重派、被抢占检测、失败召回
  （reclaimExpeditionCreeps）、pioneering 补员。CPU 长期紧张时
  Memory.kernel.expansion 单例无限滞留 — 卡住的不只是本次行动，
  还堵死未来一切扩张（单例即互斥锁）。
- 修复方向：门禁下沉 — 「开新行动」与「补员/重派」受 CPU 门禁，
  「超时判定 / 被抢占检测 / abort 召回」是廉价的止损操作，始终运行。
  约 5 行调整。
- 回归测试：bucket=3000 + claiming 已超时 → 断言状态被清、目标入黑名单。

### C-2 [P3] 拓荒期威胁止损缺失 — 送兵循环最长 20000 tick — 待修

- 位置：`src/systems/expansion-manager.ts` advancePioneering（仅四分支：
  失守/建成/硬超时/补员，无威胁检测）
- 现象：新房 claim 后无 spawn、无塔、无 defender 供给路径（demand 为
  新房生成的 defender 请求进新房自己的队列，但新房无 spawn 永远孵不出；
  sponsor 不会代孵防御）。invader 进入新房 → 拓荒编队被杀 →
  submitPioneers 每 100 tick 继续补员 → 再被杀 — 直到 20000 tick
  硬超时，sponsor 持续放血送兵。
- 对照缺口：evaluator 选目标时查 dangerUntil/towers，但 dangerUntil
  由 remote-mining-manager 写（只覆盖远矿房）— pioneering 期间新出现
  的威胁没有任何写入者，止损信号链断裂。项目已有同型解法
  （InvaderCore 压制止损链：dangerUntil 冷却 + 暂停孵化 + 回收现役）。
- 修复方向：advancePioneering 增加威胁分支 — 目标房有视野且
  threatCreeps 非空时暂停 submitPioneers 并写 intel.dangerUntil；
  威胁持续超窗口则 abort（黑名单 + 召回）。复用 InvaderCore 链模式。
- 回归测试：pioneering 中目标房出现威胁 → 断言不再补员。

### C-3 [P4·观察] evaluator 无距离校验 — 依赖「候选=一跳邻居」的隐式纪律 — 暂缓

- 位置：`src/domain/expansion/evaluator.ts`（输入接口不限制候选房与
  sponsor 的距离）；候选池目前来自 room-observer 的 describeExits
  一跳邻居 + observer 回填（同一张 intel 表）
- 风险：claimer 600 tick 寿命与拓荒编队通勤预算依赖数据来源纪律而非
  显式校验。observer 补视野的目标范围若未来扩大（或其他系统向 intel
  写入远房条目），会静默突破预算。当前非现行 bug。
- 处置：暂缓；若做，evaluator 加 Game.map.getRoomLinearDistance ≤ 2
  的过滤（纯函数需把距离作为输入传入）。

### C-4 [P4] 文档漂移 + 状态机零测试 — 待修（批量清理）

1. constraints L759 / L1048 写「claimer claim 后转为 builder 建造 spawn」
   — 实现为原地待机至寿终（刻意决策，头注释明示），建 spawn 由独立
   拓荒 builder 承担。
2. R8-04「claimer recovery 时撤回」— 无对应实现（失败兜底是 manager
   侧 reclaimExpeditionCreeps 召回，与 recovery 态无关）。
3. L530 / L1087 写 claimer body [CLAIM,MOVE] 成本 700 — 实际
   [CLAIM,MOVE]=650；700 是 [CLAIM,MOVE,MOVE] 档。
4. 测试缺口：evaluator 与 reclaimExpeditionCreeps 覆盖良好，但
   expansion-manager 状态机本身（claiming 超时/被抢占/重派、
   pioneering 完成/超时）零单测 — C-1/C-2 修复时一并补。

---

## 远矿三件套：reserver / remote-harvester / remote-hauler（审查于 2026-07-28）

### RM-1 [P3] 远矿 container 全链路是死路径 — 实际运行是无文档声明的 drop-mining — 待决策

- 位置：`src/creeps/roles/remote-harvester.ts`（无 build/repair 动作）；
  `src/systems/construction-manager.ts` L33（只遍历自有房快照，
  buildQueue/layout 不触达远矿房）
- 现象：远矿房 container 无人建、无人修 — remote-harvester 的
  findSourceContainer/倒能分支、remote-hauler 的 withdrawRemoteContainer
  双层缓存，在当前体系下几乎恒为死路径（除非前任房主遗留 container，
  且衰减塌毁后无人修）。实际运行形态是 drop-mining：harvester 满载
  drop → hauler pickupRemoteDropped。
- 代价：掉落能量按 ceil(amount/1000)/tick 衰减 — 堆积到 1000+ 后每趟
  hauler 往返周期损耗约 5-10% 远矿收入的隐性税；且 container 相关
  代码（含专门的共享缓存与测试）是持续维护的死重。
- 两条修复路线（需决策）：
  a) 补全 container 链：remote-harvester 到岗后自建 container site
     （reserved 房可 createConstructionSite）+ 空闲时建造/维修 —
     消除衰减税 + 站桩倒能生效，代价是给角色加建造职责；
  b) 承认 drop-mining：删除 container 死路径与缓存，文档声明设计现状 —
     省维护，保留衰减税（1 hauler 及时往返时损耗可控）。
- 验证（先测后决策）：线上统计远矿房掉落堆峰值与衰减损耗占比，
  损耗 >5% 选 a，否则选 b。

### RM-2 [P3] 普通威胁无失明持久化 — 团灭即重新送兵（InvaderCore 已修，creep 威胁没修） — 待修

- 位置：`src/systems/remote-mining-manager.ts` collectRemoteThreats
  （L334-349，仅对有视野房检测）；dangerUntil 写入依赖同一视野
- 现象：威胁在 10-tick 评估间隔内团灭我方远矿 creep → 该房失明 →
  threats 无键、dangerUntil 不写 → demand 按缺员继续孵化 → 新兵进房
  再被杀。与 InvaderCore 的 blockedUntil 双轨机制（瞬时视野 + Memory
  冷却，注释明写就是为修「回收后失明 → 孵化恢复 → 再送兵」死循环）
  形成精确对照 — 同一个死角，核心修了，普通 creep 威胁没修。
- 缓解：threats 检测到时会先派 remoteDefender（2A@520）；但威胁强于
  它（玩家骚扰队 / 多 Invader）时送兵循环成立。
- 修复方向：复用 blockedUntil 模式 — remoteThreats 检测到时写
  op.threatUntil；失明期内 threatUntil 未到期则暂停该房孵化
  （defender 除外或含 defender 需推演）；有视野确认清空则提前解除。
- 回归测试：威胁检测 → 全员死亡失明 → 断言下一评估周期不生成
  harvester/hauler 请求。

### RM-3 [P3] 远矿房被自己 claim 后运营僵死 — reserver 对自有 controller 空转 — 待修

- 位置：`src/systems/expansion-manager.ts`/evaluator（扩张评选不排除
  已有 remoteOps 房 — 远矿房恰好满足全部条件且 2 source 高分，
  是最优先扩张候选）；`remote-mining-manager.ts` maintainExistingOps
  L180（归属校验只查 owner && !my，自有房不 abandon）
- 现象：远矿房被自己 claim（合理演化路径）后：运营继续挂 active
  占据 maxOperations=2 的稀缺席位；reserver 对自有 controller
  reserveController → ERR_INVALID_TARGET → attackController 亦无效 —
  空转至寿终且持续补孵。
- 修复方向：maintainExistingOps 加分支 — targetRoom.controller.my →
  运营转 abandoned（不入黑名单，这是升格不是失败）+ 回收该房远矿
  creep。约 8 行。
- 回归测试：remoteOps 目标房 controller.my=true → 断言运营 abandoned
  且不再生成请求。

### RM-4 [P4] 零利润模型 + 文档/注释/配置漂移群 — 待修（批量清理）

1. 无任何利润/距离核算：选点仅「视野新鲜度 > source 数 > 房名字母序」，
   与决策纪律「远矿先算收益、路程、维护、风险」相悖。当前
   maxOperations=2 粗预算下可接受，多房规模化前需引入路程成本项
   （演进项，不算现行缺陷）。
2. plan.md L1019 RemoteOp state 含 "scout" — 代码从不写此状态。
3. plan.md L1063 /manager 头注释「colonyState 非 normal 暂停」— 实际
   仅 recovery/bootstrap 暂停，**defense 态不暂停远矿孵化**（文档漂移
   兼设计疑点：本房被袭时远矿 P1 请求与 defender P1 抢孵化窗口，
   与战时收缩原则相悖 — 需决策补代码或改文档）。
4. R5-04「budget.tier >= guarded 才考虑」— 实际 conserve 档 P2 系统
   照常运行（tierMaxPriority(conserve)=2），仅 recovery 冻结；
   demand.ts L18 注释同样失真。
5. CONFIG.roles 的 remote 三角色 minCount/maxCount 是死配置 — demand
   不消费（数量由 perTarget 常量控制），tuned.ts 却把它们暴露给
   tuning 覆盖通道。删除或接线，二选一。
6. demand.test.ts L94 标题「crisis 状态」— 传入的是 "recovery"，
   "crisis" 非合法 ColonyState。
7. distributor-target.test.ts 位于 tests/unit/remote/ — 与远矿无关，
   放错目录。

---

# 系统层审查

## 孵化控制系统：spawn-manager / queue / recycle（审查于 2026-07-28）

### SP-1 [P3] recoveryEnergyReserve 是幽灵护栏 — 宣称的硬约束在孵化侧无实现 — 待修

- 位置：`src/config/index.ts` L120-121（注释「为 P0 恢复 body 预留的
  最低能量」）；`src/systems/spawn-manager.ts` trySpawn（energyBudget
  从 energyAvailable 起算，无任何保留扣减）
- 现象：全 src 唯一消费者是 construction-manager L125（建造门槛的
  封顶项）— 孵化侧不预留。plan.md L354 明写「保留恢复能源是不可妥协
  的硬约束」，但非 P0 请求可把 energyAvailable 花到 0。
- 风险场景：低优先级孵化把能量清零的同一窗口内发生团灭 → P0 worker
  请求生成时能量 ≈0 → 等 spawn 被动回能 ~200 tick。概率低，但这正是
  plan 宣称「不可妥协」要防的场景 — 宣称与实现脱节。
- 修复方向：trySpawn 对非 P0 请求的预算校验改为
  `cost > energyBudget - recoveryEnergyReserve`（当房内存活采集者
  ≤1 时启用保留，常态不启用避免浪费容量）。约 5 行 + 单测。

### SP-2 [P3] maxRetries「隔离」实为删除-重建翻炒循环 — 待修

- 位置：`src/domain/spawn/queue.ts` cleanQueue（retries ≥ maxRetries
  直接删除）+ demand 每 tick 同 key 重建（retries=0）
- 现象：持久性配置错误（如 body exceeds capacity）的请求：5 次失败 →
  删除 → 下 tick demand 以同 key 重建（retries 归零）→ 再 5 次失败 —
  无限翻炒，每轮 5 条日志。plan.md L347「隔离该请求并限流报警」
  不成立 — 没有隔离态，报警是周期性重复。
- 修复方向：cleanQueue 删除达上限请求时把 key 记入短期黑名单
  （RoomMemory 短 key + 冷却，如 1000 tick），demand 的 hasKey 守卫
  扩展为「队列存在或黑名单冷却中」。与 construction 的 blocked
  黑名单同型（现成先例）。
- 回归测试：请求连续失败 5 次 → 断言冷却期内不重建、期满恢复。

### SP-3 [P4] trySpawn 的 ERR_BUSY 分支注释与代码不符 + 疑似死分支 — 待修（批量清理）

- 位置：`src/systems/spawn-manager.ts` L283-287
- 注释写「换下一个空闲 spawn 重试当前请求」，代码是 `spawnIdx++;
  continue` — 跳到下一条请求，当前请求本 tick 被跳过（下 tick 重试，
  影响轻微）。且 freeSpawns 已过滤 !spawning、成功后 spawnIdx++
  不复用 spawn — ERR_BUSY 几乎不可达（疑似死分支）。
- 同类：recyclePass L166 注释称 recycleCreep 返回 ERR_BUSY 时静默
  等待 — [事实核查] 官方 API recycleCreep 无 ERR_BUSY 返回码，
  注释虚构了引擎行为（代码不查返回值，行为无害）。

### SP-4 [P4] plan.md §5.4 漂移群 + 测试缺口 — 待修（批量清理）

1. 6 级优先级阶梯（P3 发展/P4 战略）与实现不符 — upgrader/builder
   实际 P2，remote 角色 P1/P2，P3/P4 在类型中存在但主管线未使用。
2. 「同类 creep 生成需错峰，避免同 tick 集体寿终」— 全管线无对应
   实现（demand/queue/trySpawn 均无错峰逻辑）。
3. cleanQueue 文档注释「createdAt + TTL < now」— 实际检查 expiresAt
   字段（语义等价，描述漂移）。
4. 测试缺口：sortQueue 的 X-17（replaceBy 优先）规则无单测；
   trySpawn 本体（多 spawn 并行、energyBudget 逐次扣减、P0 阻塞、
   降级三层触发条件）与 recyclePass 在 tests/unit/spawn/ 零覆盖 —
   管线最核心的消费逻辑裸奔。
5. 观察项（演进）：队列每房独立、无帝国级 spawn 配额仲裁；队列无
   大小上限（防膨胀靠 key 幂等 + TTL + maxRetries 三重间接约束）。
   当前 1-2 房规模无害，多房规模化时需帝国仲裁层。

### 正面确认（系统层资产，修复时不得破坏）

- submitRequest 合并保留 createdAt/retries — 饥饿计时器跨 tick 存活，
  是 W37S58「等满配永远凑不够」死锁修复的关键，有单测。
- requestTtl(1000) > 饥饿降级窗口（P1≈100/P2≈540）的硬约束有完整
  注释论证 — 动 TTL 或饥饿倍率前必读。
- 人口计数无双计窗口：spawning creep 从 collectCreepSummaries 排除、
  由 collectSpawningSummaries 单独收集；孵化成功同 tick 出队。
- energyBudget 本地记账解决同 tick 多 spawn 意图超支。
- cleanQueue 必须先于 evaluateDemand（stale pending 死锁防护，
  L47-49 注释）— 顺序敏感，重构时保持。

---

## 移动系统：pathfinding / traffic / parking / stuck-recovery（审查于 2026-07-28）

### MV-1 [P3] stuckTicks 无疲劳豁免 — 直接违反自家硬约束 G-MV-06/G-MEM-07 — 待修

- 位置：`src/creeps/movement/stuck-recovery.ts` updateStuckTicks
  （L83-98，纯位置比较，无 fatigue 检查）
- 现象：文档两处明写「ERR_TIRED 不递增卡位计数」（G-MV-06、G-MEM-07），
  实现完全没有豁免。疲劳等待的重载 creep 照常累积：2 tick →
  关 ignoreCreeps + 逼近 reusePath 0（每 tick 重算），4 tick →
  Level 3 弃目标 + 释放 assignment + 转 idle。
- 实际危害场景：满载 hauler（6C6M 平衡体）过沼泽 — 沼泽疲劳 60 vs
  MOVE 抵扣 12 → 等 ~5 tick → 必然触发 Level 3，携满货弃任务。
  fatigueSwampCost(255) 只保护新算路径，moveTo 回退与既有路径仍可
  踩沼；早期无路房间是高发区。任务 churn + 重寻路 CPU 双重浪费。
- 修复方向：updateStuckTicks 开头 `if (creep.fatigue > 0) return
  creep.memory.stuckTicks ?? 0;`（疲劳期不增不减）。3 行 + 单测。

### MV-2 [P3] structCount 失效风暴 — 建造期全房路径同 tick 集体失效 — 待评估

- 位置：`src/creeps/movement/pathfinding.ts` tryPersistedPath
  （structCount 不等即失效）
- 现象：持久化路径的失效键是「全房结构+工地总数」— 任一 site 创建/
  完工/结构增减，**全房所有 creep** 的持久化路径同 tick 失效 →
  下一移动 tick 集体重算 PathFinder。建造期 construction-manager
  每 tick 可建 1 site → 高频全量失效，缓存命中率骤降。
- 附带边界：count 相等但结构换位（一拆一建）不失效 — 路径可能穿过
  新结构（被 moveByPath 撞墙后自愈，代价一次卡位周期）。
- 修复方向：失效键从「总数」改为「递增 revision」（结构变化时 bump，
  与 plan.md L763「路网 revision」的原设计对齐 — 文档早就写了正确
  方案，实现用了简化版）；或按目标路径涉及区域做局部失效（复杂，
  不推荐）。
- 验证：actionProfiling 开启对比建造期 PathFinder 调用次数。

### MV-3 [P3] parked creep 不响应 yield + 请求无过期 — 让路机制对静止目标失效 — 待修

- 位置：`src/creeps/movement/parking.ts` parkIdleCreep（走 creep.move，
  不经 moveToTarget）；stuck-recovery.ts __yieldRequests（无 tick 过期）
- 现象：checkAndExecuteYield 只在 moveToTarget 开头执行 — 被 park 的
  idle creep 不调用它，让路请求永不生效，挡路只能靠移动方
  ignoreCreeps:false 绕行。且滞留请求无过期：creep 若干 tick 后恢复
  移动时会突然执行一次**过期让路**（方向早已无意义，无落点安全检查，
  可能被推向关键格）。
- 修复方向：a) parkIdleCreep 开头先 checkAndExecuteYield（parked creep
  本就该让路 — 它没有任务）；b) __yieldRequests 值改为 {dir, tick}，
  执行时超过 2 tick 即丢弃。
- 回归测试：parked creep 收到 yield → 断言下 tick 移动；过期请求 →
  断言不执行。

### MV-4 [P3] moveTowardRoom 跨房缺陷群 — 待修（合并处理）

1. **单一出口缓存永不过期**：`__interRoomCache` 按房间对缓存一个
   exit 格，所有 creep 无论自身位置共享 — 远端 creep 绕路到缓存
   出口而非最近出口；出口格被新建结构/敌方封堵时仅靠严重卡位
   （Level 2）才清缓存。
2. **无 edge-tile 弹回防护**：抵达目标房边界格后若角色当 tick idle，
   引擎弹回原房 → ensureHome 再跨房 — 横跳。已有的 Bug 2 修复只治
   mode 振荡，不治边界弹回。
3. **swampCost 固定 10**：不用 fatigueSwampCost，与 moveToTarget
   不一致 — 重载跨房 creep（remote-hauler 满载回家）不避沼泽，
   与 MV-1 叠加放大。
4. 注释漂移：L455 宣称 Level 0 是 ignoreCreeps:true，代码未传
   （引擎默认 false）。
- 修复方向：出口缓存加 creep 位置分桶或 TTL；到达目标房后强制
  离开边界格一步再返回 true；swampCost 换 fatigueSwampCost。

### MV-5 [P4·观察] staticBlockers 无条件封锁空站桩格 — 暂缓

- room-snapshot L123-132 无条件把 source container/controllerContainer
  格标 255，不检查是否真有 creep 站桩 — 矿工死亡/未孵化窗口期，
  空 container 格仍是虚墙，过路路径被迫绕行（小效率损耗）。
  站桩者自己上格不受影响（range≤1 短路 creep.move 不经 PathFinder）。
  若改：blocker 采集时查 lookForAt 有 creep 才推入（每 tick 每格
  一次 lookForAt 的代价 vs 绕行损耗，需权衡后定）。

### MV-6 [P4] 移动层文档/注释漂移群 + 测试缺口 — 待修（批量清理）

1. G-MV-03「reusePath 默认 5」— 实际自适应 3/5/15；plan.md「5 到 20」
   下限也不符。
2. plan.md §5.7.5「creep Memory 仅存 packed lastPos/stuckTicks/短
   pathKey；完整路径放 global」— 无 pathKey 实现；moveTo 回退路径由
   引擎写 creep.memory._move（完整序列化路径进 Memory）。
3. stuck-recovery 头注释 Level 2 描述与实现差 1 tick（ignoreCreeps
   在 threshold 关闭，reusePath 0 在 threshold+1 生效）。
4. recordTraffic 记录的是移动前原点而非落点（原点也是路径格，
   对 road-planner 影响轻微 — 语义注释应写明）。
5. 测试缺口：tests/unit/movement/ 仅 parking 有测试（7 用例质量好）—
   pathfinding 五级缓存链、stuck-recovery 四级脱困、traffic 零覆盖。
   MV-1/MV-3 修复时一并补。

### 正面确认（移动层资产，修复时不得破坏）

- 五级路径策略（持久化 → 走廊共享 → 同 tick 共享 → 新算 → moveTo
  回退）与「回退到原生 moveTo」的 G-MV-08 韧性设计。
- rampart/road/container site 不加成本 — 「rampart site 曾标 255 →
  虚假实墙 → 全房停滞」的事故修复（L45-48 注释），动成本表前必读。
- Level 3 弃目标必须重置 stuckTicks — 「吸收态全房静止」线上事故
  修复（L590-594 注释）。
- 前置绕路检测（前方一格有 creep 即绕，不等卡位累积）— 火车排队
  根因修复。
- parking 两阶段逃离（防 core 距离牵引振荡）+ 每 tick 预约集防聚堆，
  7 种地形矩阵测试。

---

## 约束层：scheduler / safe-run / memory / kernel 主循环（审查于 2026-07-28）

### K-1 [P3] buildSnapshots 非 critical — 单房快照可被冷却 80 tick，整房对所有系统隐身 — 待修

- 位置：`src/kernel/kernel.ts` L162-164（safeRunBuild 未传 critical，
  默认 false）
- 现象：单房快照构建连续 throw 3 次 → 进入 80 tick 冷却 → 冷却期间
  该房无快照 → spawn-manager/tower-defense/所有角色（getSnapshot
  失败即 return）对该房全部停摆。快照构建失败通常是代码 bug
  （确定性持续失败）→ 80 tick 瘫痪-3 次失败-再瘫痪循环。
- 快照是 plan「每房每 tick 只扫描一次」的 P0 级基础设施，却被
  当作可冷却插件对待 — 与 maintainMemory/segments（critical=true）
  的待遇不一致。
- 修复方向：safeRunBuild 传 critical=true（1 行）；快照构建 bug
  靠错误日志限流暴露而非静默冷却。

### K-2 [P3] safeRun 冷却三缺陷：静默跳过 + 恒 80 tick + 零事件记录 — 待修

- 位置：`src/kernel/safe-run.ts` isCoolingDown（L24-30 直接 return，
  无 recordSkip）、handleError（L53-58）
- 三项事实：
  a) 冷却期间被跳过的系统不记 skipReason — 违反 plan §3.2
     「跳过任务记录 skip reason 与次数，不能静默丢失」。P1 系统
     （assignment-service/link/lab/empire-strategy）被冷却 80 tick
     期间，遥测完全看不见。
  b) 进入冷却时 errorCounts 清零（L57）→ 每轮从 3 重新触发 →
     cooldownTicks = min(50+3×10, 200) **恒为 80**。注释与 plan
     宣称的「50-200 tick 递增」是死代码。
  c) EventKind.PluginCooldown 枚举存在（event-log L48）但 handleError
     从未 recordEvent — 冷却事件在事件日志中不存在，观测链断。
- 修复方向：isCoolingDown 命中时 recordSkip(label+"/cooldown")；
  错误计数不清零改记轮次实现真递增；进入冷却时 recordEvent。
  约 10 行 + 单测（safe-run 目前零单测）。

### K-3 [P4·已确认设计] 极端低 tickLimit 时 P0 也被硬上限拦截 — 仅修文档

- canStart 先查 isExhausted（hardLimit 含 tickLimit 收缩项），
  P0 例外只豁免软上限 — 注释「P0 始终尝试」只在软上限语境成立。
- 判定：这是正确取舍（超 hardLimit 被引擎杀死比跳过 P0 更糟），
  不改代码；注释与 plan 措辞应改为「P0 豁免软上限，硬上限对
  一切生效」。

### K-4 [P4] plan.md §3.2-3.4 漂移群（约束层文档债） — 待修（批量清理）

1. 「Guarded 后台频率减半」— 无任何实现（仅 maxPriority=3）。
2. 「冷却 50 至 200 tick」— 恒 80（见 K-2b）。
3. 错误限流指纹仅 label，缺「错误签名」维度 — 同 label 的不同错误
   互相吞日志（25 tick 窗口内只见第一种）。
4. 「throwOnError 开发开关」— 未实现。
5. **plan.md L226「当前版本：v7」— 实际 schemaVersion=14**，
   v8-v14 七个版本未入文档。
6. 「大迁移按 cursor 分 tick」— 无先例实现（现有迁移均为小迁移，
   可接受，但首个大迁移到来前需先建 cursor 基建）。
7. 「所有步骤成功后才更新 schemaVersion」— 实现为逐步盖章
   （更安全的语义，文档应随实现改）。
8. config 采样窗口注释「500 条=5000 tick / 300 条=15000 tick」与
   segment-store 实际容量 300/200 不符。
9. bootstrap 头注释注册清单缺 empire-strategy/terminal/factory/
   expansion 等，与注册体不同步。

### K-5 [P4] 迁移 throw 连带跳过 maintainMemory 后半段 — 待修（批量清理）

- safeRun("memory") 包裹整个 maintainMemory — 迁移中途 throw 时
  死 creep 清理/房间兜底/lostRooms 清理整 tick 跳过；迁移持续失败
  会造成 Memory.creeps 慢性泄漏。
- 修复方向：kernel 拆两个 safeRun（"memory-migrate" 与
  "memory-maintain"），迁移失败不连坐日常清理。

### K-6 [P4] interval 取模扎堆 + 计划内跳过污染 skipReasons — 待修（批量清理）

- shouldRunSystem 用 tick % interval === 0 — 同 interval 系统全在
  同一 tick 扎堆运行（每 10 tick 一个 CPU 尖峰节律），plan「错峰」
  精神未落实到系统层。修复：按 hash(name) % interval 偏移相位。
- interval 跳过（计划内）与 budget 跳过（异常）混入同一
  skipReasons 表 — 线上遥测 skipHotspot 长期被 system/xxx/interval
  的百级计数占据，真实异常信号被淹没。修复：interval 跳过不记或
  单独前缀。

### 正面确认（约束层资产，修复时不得破坏）

- tier 滞回状态机：降级立即 / 升级逐档爬升（+500 滞回 × 20 tick
  驻留），测试覆盖完整（scheduler.test 12 用例 + config 对齐测试）。
- pixel 自愿放血宽限协议：recovery 地板抬 conserve、不影响滞回
  记账 — reload death loop 与 creep 周期性停摆两次事故的产物，
  pixel.enabled 默认关闭的注释含完整事故复盘。
- segment 可用性守卫（P1-2）：reset 首 tick 不用空数据覆盖历史，
  5 场景测试；v4 迁移的 ready() 门禁与之配套（segments-request
  必须先于 maintainMemory 的顺序依赖，kernel L76-79 注释）。
- 迁移链断号暴露语义：版本停在缺口处而非盖章掩盖。
- colonyState 门禁先于 budget 检查（P1-2 CPU 死亡螺旋修复）。
- skipReasons 有界（单键 100k 封顶 + 500 tick 清零）；segment
  size guard（90KB + 0.75 裁剪）；ring buffer null 空洞过滤。

---

## Tier C 补充审查：engine 本体 / construction / empire-strategy / intel / remote-defender（审查于 2026-07-28）

### EN-1 [P3·机制确认] execute 一经调用即终止候选链 — 口径分裂病理的机制根源 — 随病理①修

- 位置：`src/creeps/engine/role-runner.ts` L178-184（execute 后无条件
  return）+ `actions/helpers.ts` runAction（未注册错误码仅返回结果码，
  全仓库 execute 均不检查返回值）
- 全仓库错误码注册表（穷尽 grep）：ERR_NOT_IN_RANGE（内建移动）、
  ERR_FULL（pickup×3/fill×3）、ERR_INVALID_TARGET（repair×3/build×2）、
  ERR_NOT_ENOUGH_RESOURCES（harvest/withdraw×3）、ERR_TIRED（harvest）。
  **其余错误码（ERR_NO_BODYPART/ERR_BUSY/ERR_NOT_OWNER…）= 该 tick
  完全空转**。
- 机制语义：resolve undefined → 链条继续；execute 失败 → 链条已终止。
  「resolve 命中但 execute 必败」的候选每 tick 抢占且零产出 —
  W-1/H-2 的机制温床，正式确认。
- 修复公理（病理①包执行时遵守）：**execute 内的任何资格检查必须
  前置到 resolve** — resolve 是唯一的放行闸门，execute 只许失败于
  瞬时竞态（同 tick 他人抢先），不许失败于可预判条件。

### EN-2 [P4] updateMode 只看能量 — 携矿 creep 的 mode 口径漂移 — 待修（并入 H-2 修复验证）

- `lifecycle.ts` updateMode 只查 RESOURCE_ENERGY：满载矿物的 hauler
  used(energy)=0 → work 被翻回 acquire，与 H-2 的满载取矿相互作用。
  H-2 修复时用总容量口径（getFreeCapacity() 无参）一并验证。

### EN-3 [P4] ActionCandidate.resolve 可选 — 无 resolve 候选永不触发的契约陷阱 — 待修（批量清理）

- `action-types.ts` L45 resolve 可选 + role-runner 可选链调用 —
  无 resolve 的候选永远 undefined、静默死亡。当前无受害者，
  但契约层零防护。修复：resolve 改必填（编译期防护，一次性改动）。

### EN-4 [P4] 注释漂移（批量清理）

- status-light.ts L42 宣称半径 0.35，代码 L57 为 0.2。

### CM-1 [P4] 建造限额文档漂移 — AGENTS.md/plan.md 与实现三处不符 — 待修（批量清理）

- 文档宣称「全局每 tick 最多 1 site；每房 1 critical + 2 normal」。
  实现：全局每 tick **1 紧急 + 1 普通**（双额度）；每房 critical 1 +
  storage 1 + road 2 + source container 1 + **normal 3** 五类独立计额；
  P0 孵化缺口阻塞建造（文档写 P0/P1，实现仅 P0）。
- 附：construction 域 queue.ts 四个纯函数（syncTaskStates/cleanTasks/
  assessEmergencyRebuild/isEmergencyTask）零单测。

### ES-1 [P3] fortify/war 是半死信号 — 宣称的防御消费者不存在 — 待决策

- 位置：`src/domain/strategy/posture.ts` L13-15 注释宣称「fortify
  防御投资升档」「war 当前唯一消费者是防御强度」
- 事实：posture 的真实消费点仅两个 — expansion-manager L50
  （expansionAllowed）与 remote-mining-manager L55（newRemoteOpsAllowed）。
  defense-planner/tower-defense/fortification **无人读取** Memory.kernel
  .strategy — fortify/war 的正向防御效果是幽灵宣称，两姿态实际只有
  「关扩张、关新远矿」的负向效果。
- 决策项：a) 诚实化 — 删幽灵注释，fortify/war 语义降级为「收缩姿态」；
  b) 真接线 — fortification 维护目标档位读 posture 升档（与病理④
  「宣称即契约」原则一致，但需设计防御投资的具体升档规则）。
- 附：empire-strategy 系统层接线（写 Memory → 消费方读）零集成测试。

### RD-1 [P3] remote-defender 无护栏群 — 站桩互殴至死 — 待修

- 位置：`src/creeps/roles/remote-defender.ts`
- 三项事实：无血量撤退（combat 豁免 flee 且无 hits 检查）、无 HEAL、
  注释 L22「NPC reserver 无攻击能力 → defender 不会受伤」只对 reserver
  成立 — 对带 ATTACK/RANGED_ATTACK 的 Invader（demand 触发场景就
  包含它）不成立，2A2M@520 会站桩互殴至死。
- 缓解面：demand 上限 1 只、body 520 能量、InvaderCore 房已有止损链 —
  损失有界，P3 而非 P2。
- 修复方向：execute 前加 hits 检查（如 hits < 0.5×hitsMax 且非斩杀
  窗口 → 退回 home 治疗/回收）；观察项：敌人贴出口反复进出时的
  边缘振荡。零专属测试，修复时补。

### Tier C 正面确认（资产）

- **blocked 黑名单全链路闭环**（现场核实，SearchAgent 误报排除）：
  construction-manager 写入（L48-55）→ layout-planner 读取+冷却期
  拒绝入队（L219-232 isBlacklisted）→ 到期顺手清理 — 这正是 SP-2
  修复该抄的范本。
- remote-defender **无 DF-1 式跨房追击**：resolve 限定 remoteTarget
  房内 — 本地 defender 修 DF-1 时参照此模式（房界即追击边界）。
- intel 天然有界（出口邻房封闭集，每房 ≤4 条 ≤8 标量）、dangerUntil
  跨刷新保留、observer 调度（从未见过 > 最陈旧、highway 跳过、
  请求-下 tick 捕获）设计正确 — 仅 pending 时序零测试。
- boost 报到自限性防呆（TTL 窗口被动到期）、role-runner 威胁检测
  先于导航（transit 盲区修复）、flee mode 残留重置（Bug 注释齐全）。

---

# 全量审查收官统计（2026-07-28，含 Tier C 补充）

- 覆盖：11 角色 + 5 编排系统（expansion/remote/construction/
  empire-strategy/room-observer）+ 3 系统层（孵化 / 移动 / 约束层）+
  engine 本体。未审（Tier A，与修复合并进行）：room-state/phase、
  assignment 全量、tuning、room-snapshot 全量；未审（Tier B，改到哪
  审到哪）：layout 域、defense 域、link、industry。
- 发现总数：76 项。已修 ✅ 1（D-0），设计确认 2（U-5.4、K-3）。
- P2 待修 3：W-1 / H-2 / HL-1。
- P3 待修/评估 27（新增 EN-1 机制项 / ES-1 / RD-1）。
- P4 批量清理 ~43（文档债 / 死代码 / 测试缺口 / 注释漂移）。
- 五条贯穿性病理（修复按主题打包）：
  ① 口径分裂（resolve 放行 ≠ execute 可做）：W-1/H-1×H-2/HL-1/U-1/D-1
  ② 水位刻度碎片化：统一水位权限表收编 8 项
  ③ 止损豁免缺失：C-1/C-2/RM-2/RM-3 +「止损豁免于门禁」公理化
  ④ 宣称 vs 实现脱节：SP-1/MV-1/MV-2/K-2/K-4 — 建议关键硬约束
    升级为断言/单测（「没有测试的约束就是没有约束」）
  ⑤ 核心管线测试裸奔：trySpawn/recyclePass/pathfinding 缓存链/
    stuck-recovery/safe-run 冷却 — 五处零单测的复杂逻辑

---

# Tier A 收尾审查：assignment / tuning / room-snapshot（审查于 2026-07-28，Batch 5）

## assignment 全量

### AS-1 [P2·已修✅] 无条件续约 + 校验不含「任务在池」— HL-2 机制根源

- 位置：`src/creeps/support/assignment-adapter.ts` requestAssignment
- 现象：四条失效规则都不查池 — haul 任务只为「含能量 container」生成，
  container 被抽空后任务出池，但持有者校验仍过（对象还在）→ 每 tick
  无条件续约 → 僵尸 assignment 永不释放，且逃逸抢占（invalidate 只清
  池内任务）。修复：续约前置「任务仍在本 tick 池中」校验（failReason 4），
  池缺失（reset 首 tick）保守放行。回归测试 tier-a-regression.test.ts。

### AS-2 [P3] harvester 接受 fill 任务但站桩矿工无离位送能行为 — 待评估
### AS-3 [P3] releaseNonStorageBuilderAssignments 在 allCreepRefs 采集后清 memory — 单 tick 幽灵占位
### AS-4 [P3] 池重建不裁剪超编（maxWorkers 收敛缺失）
### AS-5 [P4] wasEmergency 依赖 roomMem，缺条目时边沿检测退化；测试标题 maxWorkers=3 vs 实现 2

## tuning 全量

### TU-1 [P2·已修✅] upgrader 降编把「storage 未解锁」误判为「storage 枯竭」

- `src/domain/tuning/evaluator.ts` evaluateUpgraderMaxCount：无 storage 的
  RCL2-3 房 avgStorageEnergy 恒 0 → 降编永久成立 → 每 2000 tick 棘轮压到
  地板 1。修复：storage 低位分支加 rcl >= 4 门禁；经济高压分支不变。
  回归测试 tier-a-regression.test.ts。

### TU-2 [P3] builder.maxCount 的 backlog=0 降编棘轮（成熟房恢复迟滞 ≥2000 tick）— 待评估
### TU-3 [P3] containerFillRatio 计入 controllerContainer（刻意填满的目标污染取能侧信号）
### TU-4 [P3] ROLE_PARAM_MAP 声明的多数参数无 TUNING_BOUNDS 条目（幽灵钳制）；applyAdjustment 无白名单校验
### TU-5 [P3] 覆盖值无 TTL/衰减回基线 — 被污染信号推到边界后永久驻留
### TU-6 [P4] 注释宣称「持续满/空」，实现为瞬时快照 + 两点趋势近似

## room-snapshot 全量

### SN-1 [P2·已修✅] fillTargets 含 controllerContainer → distributor 撤单/编制口径失效

- controllerContainer（容量 2000）几乎恒有空位 → fillTargets 几乎永不为
  空 → spawn-manager 撤单条件「fillTargets 为空」近乎永不成立；demand
  的 distTarget 被常量抬高。修复：撤单口径改「spawn/extension/tower
  维度为空」；编制信号（非 servesTower 时）只计 spawn/extension。

### SN-2 [P3] tower 缺 1 能量即入列 fillTargets（990/1000 触发微量补给往返）— 待评估（缓冲带）
### SN-3 [P3] threatCreeps 任意威胁即触发全房抢占（无强度分级）— 观察
### SN-4 [P4] buildRoomSnapshot 零专属单测（fillTargets/threat 分类/criticalRepairTarget 口径裸奔）；FIND_CONSTRUCTION_SITES 双 find 微优化；criticalRepairTarget 取首个非最危者

## RM-1 决策记录（已定案·已修✅）

- 探针实测（tick 81849xxx）：active 远矿房 W37S57 无 container、地面
  堆积 3302 能量（衰减 ~4/tick ≈ 单源产出 40%）；已废弃房 W38S58 残留
  4206。40% ≫ 5% 阈值 → **补建造链**。
- 实施：remote-harvester 新增 buildSourceContainer 候选（work 链首位）—
  满载 + 站桩 + 无 container 时建 site/投建造；建成后既有 container
  倒能路径与 hauler withdraw 链自动接管。远矿房不在 construction-manager
  管辖域（只遍历自有房快照），此为 source container 的唯一豁免点。
  回归测试 remote-container-build.test.ts（4 用例）。

---

# 修复进度台账（Batch 1-5，全部已部署上线）

- Batch 1 止血包 ✅：W-1、H-2、HL-1、MV-1、K-1、SP-1（含采集角色豁免）、
  K-2（a/b/c 三修）。
- Batch 2 水位权限表 ✅：U-1、U-2、B-1、D-1、D-2、D-3、B-4、B-5、
  RS-1（新发现：economyPressure 无 clamp 可达 ~1.42，已封顶 1.0）。
  config 水位权限表总注释落位。
- Batch 3 止损与防御包 ✅：C-1、C-2、RM-2（threatUntil 双轨 + 威胁期
  暂停经济孵化）、RM-3、DF-1、RD-1（含 collectRemoteCreeps 跳过
  recycle）、W-3。
- Batch 4 移动残项包 ✅：MV-2（revision 指纹失效键）、MV-3（yield TTL +
  parked 响应）、MV-4（出口缓存 TTL/swampCost/边界弹回防护/注释）。
  MV-5 维持暂缓。
- Batch 5 Tier A ✅：AS-1、TU-1、SN-1、RM-1（建造链）。
- Batch 6 文档与契约包 ✅：SP-2（spawn 黑名单，照抄 construction 范本，
  cleanQueue 返回 purged keys + roomMem.spawnBlacklist 冷却）、K-5（拆
  memory-migrate/memory 双错误边界）、K-6（interval 按名称哈希相位错峰 +
  计划内跳过不再污染 skipReasons）、EN-3（resolve 改必填，编译期契约）、
  EN-4、SP-3、ES-1 诚实化（posture 幽灵注释删除，fortify/war 降级为
  收缩姿态语义）；X-17/SP-2 单测补齐；plan.md 修订（schemaVersion v14、
  §3.2 频率减半→错峰、§3.3 冷却真递增+删 throwOnError、§5.4 优先级
  实现映射+黑名单隔离、§5.5 建造五类计额、§5.7.5 reusePath 自适应）；
  constraints 修订（G-MV-03、附录 C 三处过时值、附录 D Distributor
  八条约束补章）。
- 累计：1051 测试全绿（审查起点 971，+80），六批全部部署上线，
  每批心跳正常、无 error hotspot。
- 审查修正批次（Batch 7，三视角代码审查驱动）✅：
  - Critical①：K-6 相位偏移曾使 telemetry 经济/人口采样永久失效
    （collector 错峰到 tick≡5 mod 10，内部 %50/%100 门不可达 →
    tuning 输入断供）。修复：systemPhase 提为零依赖纯函数
    （kernel/phase.ts），collector 内部采样门改相位相对判定；
    锁定测试 edge-and-phase.test（1000 tick 交集断言）。
  - Critical②：SP-2 黑名单半应用（flaky save 吞掉写入链，门禁查
    永空表且无到期比较）。修复：写入 + prune + 到期比较三环接通；
    采集角色豁免隔离（能量不足烧穿 ≠ 配置错误，防 bootstrap 死锁 —
    集成测试再次拦下首版）；闭环测试入 revoke-wiring.test。
  - Warning 群：RM-1 建 site 失败 100 tick 冷却放行 dropEnergy；
    stepOffEdge 改扫内侧可走格（内侧全墙交还角色管线）；MV-2
    fallback 删 count 短路；C-1 孵化补充（pioneers/claimer 重派）
    恢复 tier 门禁、C-2 威胁分支不再吞超时判定；RM-2 盲持改独立
    threatBlindHold(300)（防 enableDefender=false 时 2000 tick
    收入黑洞）；K-6 后半落地（interval 跳过不再记 skipReasons）；
    AS-1 增加「本房任务列表缺失」保守放行；plan.md 冷却区间改
    80-200。
  - 终态：1053+ 测试全绿（90 文件），typecheck/build 绿，已部署，
    心跳与 CPU 采样推进正常。
- 未修余量（后续迭代）：AS-2~5、TU-2~6、SN-2~4、MV-5、HL-2 残余口径、
  EN-2、CM-1 附带纯函数测试、RM-4 观察项、帝国仲裁层（演进项）；
  审查 Suggestion 遗留：K-1 接线直测、K-2b 冷却再触发阈值（判定为
  设计取舍暂不改）。





