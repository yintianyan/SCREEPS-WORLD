# 技术债清单

> 来源：线上遥测诊断（tick ~81,796,500–81,797,400）+ 全模块深度审计（2026-07-27）
> 最后更新：2026-07-27（第二轮盲区审计追加 TD-023 ~ TD-052；TD-023~028/052 已修复；
> 编号勘误：原重复的 TD-012/TD-013 后者重编号为 TD-053/TD-022）

## P0 — 立即修

### TD-001: Builder 全压 Storage site，Extension 无人建造
- **文件**: `src/domain/assignment/service.ts`, `src/systems/assignment-service.ts`
- **现象**: 3 个 builder 全部分配到 storage site（10,000 progress），extension site（200 progress）无人建造
- **根因**: `releaseNonStorageBuilderAssignments` 每 tick 强制释放所有非 storage builder assignment；storage maxWorkers=3 吸纳全部 builder
- **影响**: energyCapacityAvailable 卡在 300，builder body 只能 [1W,1C,2M]，建造效率极低
- **状态**: ✅ 已修复（storage maxWorkers=2 + 保留 extension builder）

### TD-002: P2 Spawn 降级缺失（已修复）
- **文件**: `src/systems/spawn-manager.ts`
- **现象**: P2 请求在 colonyState 振荡时无法降级 body → 人口死锁
- **修复**: 双条件降级（waitTicks >= 10× spawnTime AND economyPressure > 0.5）
- **状态**: ✅ 已修复（725/725 测试通过）

## P1 — 本周修

### TD-003: colonyState 振荡（recovery↔normal 219 次/500 事件）
- **文件**: `src/domain/economy/phase.ts`
- **现象**: drainScore 在阈值边界抖动导致 colonyState 频繁切换
- **根因**（审计修正）: 不是阈值抖动而是负反馈极限环——drainScore 把刻意消费与生产崩溃同等计为赤字，recovery 收缩支出→盈余→秒退→normal 恢复支出→再入
- **修复**: 双闸——①主动消费豁免（spendableRatio ≥ 0.5 时储备下降不计赤字）；②危机带最短驻留 100 评估（schema v14 新增 `phase.bandTicks`），同时消除 crisis 30→0 直切 normal
- **状态**: ✅ 已修复（826/826 测试通过），待线上遥测验证切换频率 < 5 次/500 事件

### TD-007: assignment 紧急抢占空转 no-op（审计新发现）
- **文件**: `src/systems/assignment-service.ts`
- **根因**: invalidate 在 generateRoomTasks 之前调用，读到每 tick 重建的空 TaskPool → 抢占静默失效；纯函数测试全绿掩盖接线断裂
- **修复**: invalidate 移到任务生成之后 + 接线级测试（assignment-preempt-wiring.test.ts）
- **状态**: ✅ 已修复

### TD-008: spawn 请求无撤销通道（审计新发现）
- **文件**: `src/domain/spawn/queue.ts`, `src/systems/spawn-manager.ts`
- **根因**: removeRequest 全仓 0 调用；需求前提消失后的幽灵请求在 TTL 窗口（最长 1000 tick）内仍被孵化
- **修复**: 新增 `removeRequestsByRole`，spawn-manager 每 tick 撤销威胁清除后的 defender、非 normal 且无降级风险时的 upgrader 请求
- **状态**: ✅ 已修复

### TD-009: v4 迁移绕过 segment 可用性守卫（审计新发现）
- **文件**: `src/kernel/kernel.ts`, `src/kernel/memory.ts`, `src/kernel/segment-store.ts`
- **根因**: maintainMemory 先于 requestSegments 执行，reset 首 tick 撞上 v4 迁移时 layout 冷数据写入临时空结构后丢失；migrateMemory 无条件盖章掩盖断链
- **修复**: requestSegments 前置 + 迁移链就绪门禁（ready() 未就绪停在断点下 tick 续跑）+ 去除无条件盖章
- **状态**: ✅ 已修复

### TD-010: remote-hauler 空窗期每 tick 全房 find（审计新发现）
- **文件**: `src/creeps/roles/remote-hauler.ts`
- **根因**: findRemoteContainer 缓存失效路径直接 room.find，违反「角色禁止全房 find」硬约束（同文件 findDroppedEnergy 已做共享缓存，一严一漏）
- **修复**: per-tick per-room 共享缓存，同房多 hauler 每 tick 只 find 一次
- **状态**: ✅ 已修复

### TD-011: 配置双源真相（审计新发现）
- **文件**: `src/kernel/scheduler.ts`, `src/config/index.ts`, `src/domain/layout/road-planner.ts`
- **根因**: scheduler 硬编码 bucket 阈值与 CONFIG.cpu.tiers.min 并存（后者为死配置）；CONFIG.layout.road 无人消费（road-policy 内置默认生效，阈值差一倍）
- **修复**: scheduler 从 CONFIG 取值；road-planner 显式传入 CONFIG.layout.road（值对齐实际生效的 minTraffic 5）
- **状态**: ✅ 已修复

### TD-012: constraint 布局代际漂移（灾后重建 extension 落位与队列不一致）
- **文件**: `src/domain/layout/constraint-placer.ts`, `src/domain/layout/validation.ts`, `src/systems/layout-planner.ts`
- **现象**: 全拆重建期间（锚点未变）少数 extension 实际建造位置与 buildQueue 任务位置不一致；伴随幽灵 extension 任务 ERR_RCL_NOT_ENOUGH → blocked → 黑名单 churn
- **根因**: placeStructures 是无状态贪心，每周期放置 RCL 累计全量且不抵扣已建数量——已建结构把格子占掉后放置顺延到次优格；key 用递增计数器命名与坐标零绑定，同一 key 代际间指向不同格子
- **修复**: ①key 坐标绑定（`constraint.<type>.<x>.<y>`）；②承诺抵扣（committed = 已建 + 在建 site + queued/blocked 任务，必选参数防断链），只为真实缺口放置；③锚点 spawn 豁免抵扣；④lab 集群续接既有位置。固化不变量：已建为首代前缀时重推导输出与首代剩余部分 key/pos 全等
- **兼容性**: 旧计数器 key 的存量任务无需迁移——计入承诺抵扣防重复放置、位置去重防同格双任务，建成后自然出队；旧 key 黑名单条目到期自清
- **状态**: ✅ 已修复（833/833 测试通过），待线上验证：重建期 buildQueue 中 blocked extension 任务数应归零

### TD-013: InvaderCore 压制远矿房完全漏报（线上实证）
- **文件**: `src/systems/remote-mining-manager.ts`, `src/domain/remote/demand.ts`, `src/creeps/roles/reserver.ts`
- **现象**: 远矿房只有一个 InvaderCore、无 Invader creep 时，harvester 采集受压制（source 被敌方预约压在 1500 容量）、reserver 空耗整个生命周期，运营持续送兵不止损
- **根因**: 威胁检测只扫 `FIND_HOSTILE_CREEPS`——InvaderCore 是敌对结构不是 creep，全链路（dangerUntil / defender / 撤回）对其零感知；且 reserver 的 attackController（-1/次，1 CLAIM）永远磨不过核心的预约续期（+2/tick，INVADER_CORE_CONTROLLER_POWER），defender [2A,2M] 20 dmg/tick 对 100,000 hits（INVADER_CORE_HITS）核心需 5000 tick > 1500 寿命，硬扛全是负期望
- **修复**（止损而非硬扛）: ①`collectRemoteBlockers` 检测 active 房的 InvaderCore；②压制房写 dangerUntil（targeting 不选新点）+ `blockedRooms` 传入 demand 暂停一切孵化（含 defender）+ 回收现役远矿 creep；③reserver 自检核心即放弃回家（manager 10-tick 间隔内的即时兜底，per-tick per-room 缓存 find）；核心自然 decay 后孵化自动恢复，remoteOps/intel 保留不重建
- **状态**: ✅ 已修复（841/841 测试通过），待线上验证：压制房 creep 应在 1-2 个评估周期内全部标记 recycle，spawnQueue 无该房新请求


### TD-004: 事件检测不追踪 Storage 被毁
- **文件**: `src/systems/telemetry-collector.ts`
- **现象**: StructureDestroyed 事件只检测 spawn/tower/container，不检测 storage
- **影响**: Storage 被摧毁时无事件记录，诊断困难
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: telemetry-collector 增加 storage 追踪（structureTypeCode=3），含 3 条单测

### TD-005: Remote 人口畸重 + Remote Creep 通勤死锁（已修复）
- **文件**: `src/creeps/engine/role-runner.ts`, `src/systems/remote-mining-manager.ts`
- **现象**: 6 remoteHarvester + 4 remoteHauler 全部卡在 home room W37S58，mode=idle，从未到达 remoteTarget W38S58
- **根因**: `role-runner.ts` 第 107 行 `ensureHome` 返回 false 时强制 `mode="idle"`，但 `ensureHome` 对 idle 模式的 remote creep 导航回 home → 振荡死循环（acquire→导航→idle→回 home→acquire→...）
- **影响**: 10 只 remote creep 占 25% 人口，全浪费 CPU 发呆；远矿能量收益为 0
- **修复**: 
  1. `role-runner.ts`: remote creep（有 `remoteTarget`）通勤中不切 idle，保持原 mode
  2. `remote-mining-manager.ts`: 新增 `recycleExcessRemoteCreeps` 回收超过配置上限的远矿 creep
- **状态**: ✅ 已修复（725/725 测试通过）

## P1 — 本周修（剩余）

### TD-053: Terminal 能量遗漏导致 RCL6+ 假性危机误判（原编号 TD-012，与布局条目冲突，重编号；TD-021 已被 Distributor 水位分级条目占用）
- **文件**: `src/systems/room-state.ts`（reserve 计算）, `src/domain/economy/phase.ts`（下游消费）
- **根因**: `reserve` 计算 = `energyAvailable + containers + storage + creepEnergy`，未计入 `snapshot.terminal` 中的能量。RCL6 解锁 terminal 后，一个正常运营房间 terminal 常囤积 2-5 万能量应对市场/远矿支援。遗漏此项导致 `reserveDelta` 系统性偏负 → `drainScore` 持续增高 → 假性 crisis 误判
- **影响**: RCL6+ 房间相位判准降低；信用良好的房间可能被错误收缩，浪费产能
- **修复**: 在 reserve 计算中加一行 `+(snapshot.terminal?.getUsedCapacity(RESOURCE_ENERGY) ?? 0)`
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: reserve 计算增加 terminal 能量，含 4 条单测

### TD-022: Hauler 通过 assignment 回退路径隐蔽从 storage 取能（原编号 TD-013，与 InvaderCore 条目冲突，重编号）
- **文件**: `src/creeps/roles/hauler.ts`（`withdrawAssignmentContainer`）, `src/systems/assignment-service.ts`（`buildRoomTasks` 的 haul 任务回退）
- **根因**: `assignment-service` 在「无 container 但有 storage」时生成指向 **storage** 的 `haul` 任务（第 135-146 行）。`hauler.ts` 的 `withdrawAssignmentContainer` 用双重 `as` 断言将 storage id 当作 `Id<StructureContainer>` 处理（第 55 行）——JS 运行时 store 接口同构不报错，hauler 静默从 storage 取能。打破「hauler 收集、distributor 分发」的核心架构约束
- **影响**: 在 container 全空 + storage 有能量的边缘场景下，hauler 与 distributor 形成低烈度能量循环（storage→hauler→?→distributor→storage），浪费 CPU 和 creep 寿命
- **修复**: 方案 A（推荐）——禁止 assignment 生成指向 storage 的 haul 回退任务，container 为空时 hauler 等待 harvester 产出的正确行为由相位系统检测采集瓶颈来驱动；方案 B——保留回退但让 hauler 显式检查并记录约束降级事件
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: 移除 assignment 回退 storage 路径 + hauler 增加运行时类型守卫，含测试更新

### TD-014: controllerDowngradeRisk 布尔信号无迟滞
- **文件**: `src/systems/room-state.ts`（第 139-142 行）
- **根因**: `ticksToDowngrade < 10000` 硬阈值，无进入/退出迟滞。Screeps 中 `ticksToDowngrade` 每 tick 减 1（upgrader 工作则增加），在 10001↔9999 边界单 tick 穿越，导致降级风险信号每 tick 翻转一次
- **影响**: 下游消费方（demand 中 upgrader 配额、construction-manager 开发门禁）在阈值附近来回切换，产生不必要的决策抖动
- **修复**: 引入迟滞带——进入阈值 10000，退出阈值 15000（类似 PhaseOptions 的非对称步长设计），配合 `roomMem.phase` 中新增 `downgradeRiskEntered` 时间戳
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: 引入非对称迟滞带（进入 10000/退出 15000），含 6 条单测

### TD-015: economyPressure 连续信号仅影响消费角色，物流角色无感知
- **文件**: `src/domain/spawn/demand.ts`（`evaluateDemand` 全函数）
- **根因**: `economyPressure`（0.0-1.0 连续信号）只用于 upgrader 目标数（第 348-387 行）、builder 梯度缩放（第 429-437 行）和 spawn-manager 的 P2 饥饿降级门禁（第 216 行）。harvester/hauler/distributor 的配额仅通过二值 `inCrisis` 开关控制。经济紧张（pressure=0.6 但未到 crisis）时，消费端已收缩但物流端照常孵化
- **影响**: 经济压力上升时 hauler/distributor 可能过度孵化，把紧张的 container 能量搬入 storage 再搬出，形成低烈度能量循环；多出的物流 creep 挤占 spawn 队列和 CPU 预算
- **修复**: 在 `dynamicHaulerTarget` 和 `distTarget` 中引入 `economyPressure` 衰减因子——pressure>0.6 时开始降低物流配额，线性缩放到 minCount
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: hauler/distributor 增加 economyPressure 衰减因子（>0.6 线性缩放到 minCount），含 4 条单测

## P2 — 计划修

### TD-016: builder pressure 梯度在 threshold=0.3 处跳变振荡
- **文件**: `src/domain/spawn/demand.ts`（第 429-437 行）
- **根因**: `pressure <= 0.3` 满目标 vs `pressure > 0.3` 线性收缩——单一阈值无迟滞。pressure 在 0.29↔0.31 波动时 builder 目标在满与收缩之间反复跳变。对比 upgrader（第 373-387 行）使用三段梯度双阈值（0.3/0.7），builder 的单阈值更脆弱
- **影响**: builder 孵化请求（正常需求 pass，第 438-447 行）会因 `builderTarget` 波动走 `submitRequest` 同 key merge 更新 body/priority——虽不产生重复请求，但每 tick 更新增加 Memory 写入抖动。**注：替换请求（replacement pass，第 484-487 行）走独立 TTL 门禁，不受此影响——原清单中「替换请求每 tick 重建」经核实不成立**
- **修复**: 对 builder pressure 梯度引入迟滞窗（进入 0.35 / 退出 0.25）或使用最近 N tick 的 EMA 平滑
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: 引入迟滞窗（进入 0.35/退出 0.25），含 4 条单测

### TD-006: Builder body 在低 energyCapacity 下退化为 [1W,1C,2M]
- **文件**: `src/config/bodies.ts`
- **现象**: energyCapacityAvailable=300 时 builder 只有 1 WORK，建造速率 5 progress/tick
- **关联**: TD-001 的下游效应——extension 建成后容量提升，body 自动升级
- **状态**: 随 TD-001 解决

### TD-017: CONFIG.spawn.recoveryEnergyReserve 死配置未被引用（❌ 假阳性 — 已核实撤销）
- **文件**: `src/config/index.ts`（第 91 行定义）, `src/systems/construction-manager.ts`（第 125 行引用）
- **核实结果**: `recoveryEnergyReserve` **并非零引用**——`construction-manager.ts` 第 125 行将其加入 `buildThreshold` 计算：`CONFIG.economy.buildEnergySurplus + CONFIG.spawn.recoveryEnergyReserve`，用于紧急恢复期间限制建造行为以留出能量空间
- **误报原因**: 初次审计时仅在 spawn-manager 和 config 中搜索，遗漏了 construction-manager 中的交叉引用
- **状态**: ✅ 撤销（非技术债）

## P3 — 观察/低优先级

### TD-018: assignment 紧急抢占边沿触发无冷却计数器
- **文件**: `src/systems/assignment-service.ts`（第 233-234 行）
- **根因**: 紧急上升沿触发 `invalidateAssignments`，仅靠 `wasEmergency` 存储上一 tick 状态实现边沿检测。若房间能量在阈值附近快速振荡（如 energyAvailable 在 threshold±1 波动），每 2 tick 触发一次抢占
- **影响**: 频繁的 Memory.assignment 清除/重写增加序列化开销；实际触发概率低（需要精确的能量边界振荡），降级为 P3
- **修复**: 添加冷却计数器——抢占后至少间隔 20 tick 才能再次触发
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: 增加 20 tick 冷却计数器，含 7 条单测

### TD-019: demand 与 targeting 的 source 分配协调不完备
- **文件**: `src/domain/spawn/demand.ts`（第 209-238 行）, `src/creeps/support/targeting.ts`（第 6-54 行）
- **根因**: demand 通过 `creep.memory.sourceId` 将分配的 source 写入 creep memory（第 524 行），targeting 运行时优先读取 `creep.memory.sourceId`（第 8 行）——**存在基本协调，非完全无协调**。但协调不完备有两个泄漏点：① `snapshot.sourceOccupancy` 只反映存活 creep，不包含队列中 pending spawn 的跨 tick 分配，同一 source 可能被超额分配；② targeting 有独立公平份额迁移逻辑（第 13-28 行，当前 source 超公平份额且存在更空闲 source 时清空 memory 重分），可直接推翻 demand 分配
- **影响**: source 负载可能偏离预期均衡，但幅度小（demand→memory→targeting 的默认路径生效），降级为 P3
- **状态**: ⚠️ Known Limitation — 不修
- **评估说明**: 经大师视角评估：demand→memory→targeting 默认路径在多数场景生效，偏离幅度小；修复需引入 pending spawn 计数和统一分配权威，复杂度与收益不成比例。标记为已知限制。

### TD-020: economyPressure 分界点 40/60 硬编码（且 CONFIG.economy.crisis 为死配置）
- **文件**: `src/systems/room-state.ts`（第 121-124 行）, `src/config/index.ts`（第 202-204 行）, `src/domain/economy/phase.ts`（第 112-134 行）
- **根因**: `room-state.ts` 的 economyPressure 分段计算使用字面量 40 和 60（语义上 = exitScore 和 enterScore-exitScore）。**但更严重的是：** `CONFIG.economy.crisis.enterScore: 100` 和 `exitScore: 40`（config/index.ts:202-204）本身是全库死配置——零引用。真正的相位危机阈值来自 `PhaseOptions` 默认值 `drainEnterScore: 150` 和 `drainExitScore: 30`（phase.ts:112-134）。存在三重脱节：①硬编码 40/60 无编译期关联；② config 的 crisis 分数是死的；③真正的相位逻辑用着完全不同的默认值（150/30）
- **影响**: 修改 config 中 crisis 进出分数不会自动同步 economyPressure 分段点；也不会同步 PhaseOptions（需改 phase.ts 默认值或 runtime 传入）。不过当前 40 与 `drainExitScore: 30` 接近（误差 10 分），影响有限
- **修复**: ①在 `room-state.ts` 中将 40/60 改为引用 `PhaseOptions` 的默认值；②在 config 中给 `crisis.enterScore/exitScore` 加注释说明实际生效位置在 phase.ts；或③统一单真相源——让 phase.ts 从 CONFIG 读取阈值
- **状态**: ✅ 已修复（873/873 测试通过）
- **修复补充**: 新增 CONFIG.economy.economyPressure 常量（midpoint/range），6 个死字段标记 @deprecated，含 3 条单测

### TD-021: Distributor 水位分级用容量比例口径，发展期永久锁死 tier 3（线上实证）
- **文件**: `src/creeps/support/targeting.ts`（computeDistributorTier）, `src/config/index.ts`, `tests/unit/role/distributor.test.ts`
- **现象**: distributor 只填 spawn 不填 extension（用户线上观察）
- **根因**: 水位分级用 `energy / storage.getCapacity()` 比例，而 STORAGE_CAPACITY = 1,000,000——tier 3 的「<10%」= 10 万能量，发展期房间（线上实测库存均值 138）永久处于 tier 3「仅填 spawn」模式。测试未暴露：mock storage 用 capacity:100000，与引擎常量脱节 10 倍，比例口径在测试世界里看似合理
- **修复**: 分级改为绝对能量阈值（CONFIG.economy.distributorTiers: full 50k / sustained 10k / low 2k），与 upgrade 调度（sprintStorage/sustainedStorage）同一参照系；tier 边界不加迟滞（仅影响单车取量与目标类型，抖动代价小）；测试 mock 容量对齐 1,000,000，边界断言引用 CONFIG 防双源漂移，新增「5k 库存 = tier 2、extension 恢复服务」的用户症状回归用例
- **状态**: ✅ 已修复（890/890 测试通过），待线上验证：storage ≥ 2000 后 extension 应恢复被 distributor 填充

---

# 盲区定向审计追加（2026-07-27 第二轮：移动/缓存/防御/工业/扩张）

> 来源：三路并行只读审计，专攻历史审计低覆盖区。方法：缺陷指纹迁移 + 决策-消费者链追踪 + 极端 tick 模拟。

## P0 — 立即修

### TD-023: supplyLabs 的 lab 空位判断在受限 store 上恒为 0 — 工业链总闸断路
- **文件**: `src/creeps/engine/actions/industry.ts`（L85、L91）
- **根因**: 对 lab store 调用**无参数**的 `getFreeCapacity()`——lab 是受限 store，无参调用返回 `null`，经 `?? 0` 变 0 → 「lab 有空位」恒 false → resolve 永远 undefined → 化合物永远进不了任何 lab
- **影响**: boost 与 lab 反应两大功能自上线以来事实性零产出；terminal 买入的反应原料滞留 storage 成死投入；纯函数测试的 mock store 不复现受限 store 的 null 语义，测试全绿掩盖断路
- **状态**: ✅ 已修复（909/909 测试通过，与 TD-024/025/026 一并接线）
- **修复补充**: 全部容量判断改为带资源参数调用；新增接线测试的 lab store mock 显式复现「无参 getFreeCapacity 返回 null」的引擎语义（industry-chain-wiring.test.ts），防同型回归

## P1 — 本周修

### TD-024: supplyLabs 与 LabPlan 零耦合 — 盲搬任意化合物到任意 lab 且无卸载通道
- **文件**: `src/creeps/engine/actions/industry.ts`, `src/systems/lab-system.ts`
- **根因**: planLabs 的 input1/input2/output/boost 角色分配只存在于当 tick 局部变量，从未发布「哪个 lab 需要哪种化合物」；供料 action 取「第一个非能量资源」倒进「第一个有空位的 lab」；全库无 lab 取出/清空 action，错矿占位后永久死锁
- **修复**: lab-system 每 tick 发布 lab 需求表（computeLabDemands → globalCache.labDemands，loads/unloads 两类）；supplyLabs 重写为需求表驱动的四相搬运（deposit 送料 / dump 无主化合物回 storage 解堵 / unload 错矿清位与产物回收 / withdraw 按需取料，storage 优先 terminal 回退）；错矿 lab 清位完成前不发装料需求防 ERR_FULL 空转。另修一处审计漏报：supplyLabs 原只挂 work 链，而 work 模式要求满载进入——空载取料相永不可达，已补挂 distributor acquire 链
- **状态**: ✅ 已修复（909/909 测试通过，含 12 条需求表/搬运相单测）

### TD-025: lab 能量无人补给 + boost 执行不校验能量与部件数
- **文件**: `src/creeps/engine/actions/industry.ts`, `src/systems/lab-system.ts`（L291-297）
- **根因**: 供料显式跳过能量、fill 链无 lab；boostCreep 每部件需 30 化合物 + 20 能量，lab 能量恒 0 时必然 ERR_NOT_ENOUGH_RESOURCES；执行时不带部件数（尝试 boost 全部匹配部件），就绪阈值仅 30 化合物
- **影响**: boost 永不成功；ready 曾为 true 时 creep 在 lab 旁罚站至报到窗口过期（对 defender 是战力真空）
- **修复**: 需求表纳入 boost lab 能量缺口（parts×20），supplyLabs 增加携能投喂相（排在 fill/stock 之后不与 spawn 抢血，另设 storage 能量地板 1000）；boost 执行按三重约束封顶部件数（矿物存量/能量存量/creep 未强化的匹配部件，经 BOOST_EFFECTS→部件类型映射），`boostCreep(creep, parts)` 显式传数；报到 ready 判定同时要求矿物 ≥30 且能量 ≥20
- **状态**: ✅ 已修复（909/909 测试通过）

### TD-026: 反应「可执行」判定用房间总库存，执行要求原料已在指定 lab — 决策与执行脱节
- **文件**: `src/domain/industry/reactions.ts`（L75-105）vs `src/systems/lab-system.ts`（L315-318）
- **根因**: 两者之间唯一搬运桥梁是 supplyLabs（TD-023/024 断路）；规划器认为「可以反应」而执行层永远等不到原料就位
- **状态**: ✅ 已修复（随 TD-023/024 供料链接通闭环：input lab 按需求表持续装料至批次量 300，执行阈值 ≥5 在装料到位后自然满足；决策用总库存 + 执行看 lab 实仓的分层判定保留为设计——总库存是「值不值得开反应」，lab 实仓是「本 tick 能不能反应」）

### TD-027: 拓荒编队在扩张失守后无回收机制 — creep 永久静默呆立
- **文件**: `src/systems/expansion-manager.ts`（advancePioneering abort 路径）, `src/creeps/engine/role-runner.ts`（L55）
- **根因**: abort 只清 Memory.kernel.expansion 不触碰存活 creep；拓荒者 home=新房，失守后 getSnapshot(home) 为 undefined → role-runner 每 tick 静默 return；spawn-manager recyclePass 按自有房遍历也覆盖不到
- **影响**: 整支编队（sponsor 高 RCL 房大身体孵化）原地呆立至寿终，能量与 CPU 双浪费
- **修复**: 新增 `reclaimExpeditionCreeps`——四条 abort 路径（无锚点/被抢占/claim 超时/拓荒失守）均召回编队：home 改回 sponsor + 标记 recycle + 清 remoteTarget/assignment + 清 sponsor 队列中目标房 pending 请求；recyclePass 补跨房归航（不在 home 房时 moveTowardRoom，修复 findClosestByRange 跨房返回 null 的卡死缺口，远矿回收同受益）。claimer 一并召回，TD-052（残留双 claimer）随之闭环
- **状态**: ✅ 已修复（909/909 测试通过，含 3 条召回单测）

### TD-028: min-cut rampart 建成后任务无法转 done + 再生成不查已建 — 幽灵任务 churn 循环
- **文件**: `src/domain/construction/queue.ts`（syncTaskStates）, `src/systems/defense-planner.ts`（L233-250）
- **根因**: ①syncTaskStates 的 builtStructures 不含 rampart/wall/road，建成后 site 消失 → 任务回退 queued → 重复建 site 失败 → blocked → purge → 缓存割集再生成整批；②min-cut 再生成路径不对照 snapshot.ramparts 去重（core 覆盖路径有，一严一漏）；③builtPositions 用 pos→单类型 Map，rampart 与共格建筑互相覆盖
- **影响**: 每周期最多 30 个幽灵任务的入队/失败/清除循环（与 TD-012 同型，防御路径独立缺口）
- **修复**: ①syncTaskStates 的建成集合补齐 rampart/wall/road/lab/terminal/extractor 全部可入队类型；②判定 key 改为「位置:类型」集合（rampart 与建筑共格互不覆盖）；③defense-planner 的 min-cut 缓存再生成路径对照 snapshot.ramparts 去重（与 core 覆盖路径对齐）
- **状态**: ✅ 已修复（909/909 测试通过，含 4 条建成判定单测）

## P2 — 计划修

### TD-029: per-creep 持久路径缓存只写不清 + targetKey 不含房间名
- **文件**: `src/creeps/movement/pathfinding.ts`（L341-364、L398、L624）
- **根因**: 以 creep.name 为 key 写入 globalCache，唯一删除点是 moveByPath 失败；死 creep 条目永久残留 heap。targetKey 仅 `x*50+y` 不含房名，跨房同坐标 + 结构数巧合时命中陈旧路径
- **状态**: ⏳ 待修复

### TD-030: 跨房间出口缓存按「房间对」全局共享 — 首算者位置绑架所有后续 creep
- **文件**: `src/creeps/movement/pathfinding.ts`（L418-440、L477-489）
- **根因**: key 仅 `from:to`，首个 creep 按自身位置选出口写缓存，后续所有 creep 被导航到同一格；无 TTL，仅严重卡位时清除；另 moveTowardRoom 固定 swampCost:10 与 fatigueSwampCost 双标，满载 hauler 跨房被引入沼泽
- **影响**: 绕远路 + 出口格漏斗拥堵 + 卡位清缓存后被另一 creep 位置重新绑架的振荡
- **状态**: ⏳ 待修复

### TD-031: 走廊/同 tick 路径共享对不在路径上的 creep 全部退化为重算并互相覆盖缓存
- **文件**: `src/creeps/movement/pathfinding.ts`（L292-296、L324-328、L206-213、L644-653）
- **根因**: moveByPath 仅当 creep 恰好站在缓存路径上才成功；NOT_FOUND 后落入「首个 creep」分支重算并覆盖缓存。散布的 N 个 creep = N 次 PathFinder.search
- **影响**: 宣称的「主干共享」只对纵队成立；CPU 收益与实际不符
- **状态**: ⏳ 待修复

### TD-032: 前方阻挡检测以直线方向误判 — 静止 creep 在直线上即触发每 tick 全量重算
- **文件**: `src/creeps/movement/pathfinding.ts`（L596-620）
- **根因**: stuckTicks=0 时查直线下一格有无 creep，命中即跳过全部缓存走 reusePath:0 的 moveTo；但缓存路径实际次步未必是直线格——绕行成功位置在变，永远满足触发条件
- **影响**: 队形保持期间每 tick 完整 PathFinder，通勤走廊经过停车区时 CPU 放大
- **状态**: ⏳ 待修复

### TD-033: worker fillAssignmentTarget 目标满载时 assignment 不失效 — 卡死至 lease 过期
- **文件**: `src/creeps/roles/worker.ts`（L29-47）, `src/creeps/support/assignment-adapter.ts`
- **根因**: resolve 不查剩余容量；ERR_FULL 时仅在自身空载才切 acquire——目标满、creep 有能量时每 tick 重复无效 transfer；assignment 续约只查 targetExists
- **状态**: ⏳ 待修复

### TD-034: war/fortify 姿态裁决无实际消费者 — 姿态系统半装饰
- **文件**: `src/domain/strategy/posture.ts`, `src/systems/empire-strategy.ts`
- **根因**: posture 字符串除自身读写与日志外零消费者；注释宣称的「防御强度联动」不存在。war 态与 develop 被威胁压制态行为无差别（都只是 expansionAllowed/newRemoteOpsAllowed=false）
- **修复方向**: 要么接入防御强度（墙体目标/塔策略/spawn 配额），要么删掉 war 态并修正注释——不许注释承诺代码没有的能力
- **状态**: ⏳ 待修复

### TD-035: 全房 HEAL 悲观估算 + 无「结构受损强制开火」信号 — 低成本编队可无损啃边缘墙
- **文件**: `src/systems/tower-defense.ts`（L49-52）, `src/domain/defense/tower-engagement.ts`（L90-92）
- **根因**: 治疗按近战满效率 12/部件估算且统计全房（不问能否奶到焦点目标）；停火时仅 breachingCore 兜底 safe mode。单塔房 13 个 HEAL 部件即可恒停火，拆迁队在核心区外啃 rampart/wall 塔不开火
- **修复方向**: 引入防御结构 hits 下降检测作为强制交战信号
- **状态**: ⏳ 待修复

### TD-036: 市场卖出无运费盈亏核算、订单挑选忽略距离
- **文件**: `src/systems/terminal-manager.ts`（executeDeal）, `src/domain/industry/terminal-policy.ts`（pickBestBuyOrder）
- **根因**: 只校验 terminal 能量够付运费不核算净收益；挑单只比价格与量不看距离。minSellPrice 0.3 时跨大半地图订单可能净亏
- **状态**: ⏳ 待修复

### TD-037: lab-system idleUntil 休眠期间 boost 需求无法唤醒
- **文件**: `src/systems/lab-system.ts`（L180-182、L252-255）
- **根因**: 休眠长达 500 tick 且无事件唤醒；期间新孵化 defender 的 boost 请求不被评估，威胁战斗通常几十 tick 内结束
- **影响**: boost 优先级最高的 defender 线路在最需要时失效
- **状态**: ⏳ 待修复

## P3 — 观察/低优先级

### TD-038: claimer 占领成功后被导航回 home，与设计注释矛盾
- **文件**: `src/creeps/roles/claimer.ts`, `src/creeps/engine/role-runner.ts`（L197）
- **根因**: 占领成功后零候选 → role-runner 切 idle → ensureHome 对 idle+remoteTarget 导航回 home；注释宣称「原地待机自然到期」
- **状态**: ⏳ 待修复

### TD-039: remote-defender 每 tick 全房 find 且不做威胁分级 — 追打无害 scout 永不撤收
- **文件**: `src/creeps/roles/remote-defender.ts`（L42-51）
- **根因**: resolve 内 room.find 全部敌对 creep 仅过滤联盟（TD-010 同款漏网）；仅 MOVE 的过境 scout 使其永不 idle、不回收
- **状态**: ⏳ 待修复

### TD-040: 过境/远矿房 roomTraffic 只写不清（含 ERR_TIRED 计数偏差）
- **文件**: `src/creeps/movement/traffic.ts`, `src/domain/layout/road-planner.ts`（rotateTraffic 仅自有房调用）
- **根因**: recordTraffic 对当前所在房无差别累加；过境房条目永不轮换清零，数据无消费方；ERR_TIRED（原地未动）也计数使疲劳格热度放大
- **状态**: ⏳ 待修复

### TD-041: yield 让路请求无 tick 戳 — 陈旧请求延迟任意 tick 后仍被执行
- **文件**: `src/creeps/movement/stuck-recovery.ts`（L34-56）
- **根因**: 只存方向数字；blocker 长期 idle 后恢复移动的第一步是历史方向的无意义移动；死 creep 请求条目残留
- **状态**: ⏳ 待修复

### TD-042: packRoomName 对 0 号经纬线房间符号折叠碰撞
- **文件**: `src/creeps/movement/pathfinding.ts`（L185-195）
- **根因**: W0/E0、N0/S0 折叠为同一 hash，路径共享 key 跨房碰撞；当前 W37S58 不触发，扩张跨 0 线后生效
- **状态**: ⏳ 待修复

### TD-043: moveToTarget Level 3 直接写 mode="idle" — 与 role-runner 形成模式双权威
- **文件**: `src/creeps/movement/pathfinding.ts`（L581-585）
- **根因**: 绕过 TD-005 修复确立的 role-runner 权威；远矿 creep 在 remote 房内严重卡位 → idle → 回 home → 可能重现低频版通勤振荡
- **状态**: ⏳ 待修复

### TD-044: range≤1 短路分支绕过整条卡位/脱困链
- **文件**: `src/creeps/movement/pathfinding.ts`（L568-574）
- **根因**: 直接 move(dir) 不经 updateStuckTicks；目标格被静止 creep 占据时每 tick 发无效 intent + recordTraffic 刷假热度，永不升级脱困
- **状态**: ⏳ 待修复

### TD-045: 同 tick 双调用 updateStuckTicks 双倍计数 — 跳过 Level 1 pull 的相等判定
- **文件**: `src/creeps/movement/stuck-recovery.ts`, `src/creeps/movement/pathfinding.ts`（L454、L577、L588）
- **根因**: moveTowardRoom 与 moveToTarget 各自调用；Level 1 用严格相等 `=== stuckThreshold`，双增从 1 跳 3 越过触发点
- **状态**: ⏳ 待修复

### TD-046: 结构缓存回退路径 count 相等即续期 — 等量替换时 CostMatrix 永久陈旧
- **文件**: `src/creeps/movement/pathfinding.ts`（L121-137）
- **根因**: 非预热房（remote 房恒走此路径）count 相等只续 checkedTick 不重建 positions；「拆一个 rampart 同 tick 出一个 InvaderCore」等量替换后路径成本错误
- **状态**: ⏳ 待修复

### TD-047: room-observer 遇首个无 intel 房即 break — 可阻塞其他陈旧房刷新
- **文件**: `src/systems/room-observer.ts`（L100-113）
- **根因**: 首个 sources=undefined 的房间被无限重选，若其 observeRoom 持续失败，其余陈旧房永远轮不到刷新，扩张候选池隐性缩小
- **状态**: ⏳ 待修复

### TD-048: flushSkips 的 500-tick 窗口重置发生在当 tick 累加之后
- **文件**: `src/kernel/memory.ts`（L411-421）
- **根因**: 先累入再整体清空——刚写入数据同 tick 被丢；诊断工具在 500 整数倍附近读到近乎空表
- **状态**: ⏳ 待修复

### TD-049: safe-run 错误 Map 以含 creep 名的 label 为 key 且无清理
- **文件**: `src/kernel/safe-run.ts`, `src/kernel/kernel.ts`（L289-291）
- **根因**: 曾报错的死 creep 在 errorLog/errorCounts/pluginCooldowns 三张 Map 中残留到 global reset；慢性小泄漏
- **状态**: ⏳ 待修复

### TD-050: 战时无工业熔断 — 被攻击时 terminal/factory 备货照常抽取 storage
- **文件**: `src/systems/terminal-manager.ts`（L32-37）, `src/creeps/engine/actions/industry.ts`（stockTerminalEnergy/stockFactoryEnergy）
- **根因**: 只看 budget tier 与 bucket，不看 colonyState/威胁；defense 态下 distributor 仍可能把能量搬向 terminal/factory，与塔装填、spawn 补员竞争
- **状态**: ⏳ 待修复

### TD-051: safe mode 锚点单一 — 远离 spawn 的 storage/terminal 被拆不触发兜底
- **文件**: `src/systems/tower-defense.ts`（isCoreBreached，L158-163）
- **根因**: 锚点仅 spawns[0]；storage/terminal 距 spawn 超 5 格时敌方直拆经济核心 breachingCore 恒 false
- **状态**: ⏳ 待修复

### TD-052: 扩张 abort 后残留旧 claimer 未清理 — 短暂双 claimer
- **文件**: `src/systems/expansion-manager.ts`（abort 路径与 submitPioneers 计数）
- **根因**: abort 不清理存活旧 claimer；新一轮扩张按新目标名计数，旧 claimer 不计入 → 再孵化一只。CLAIM 600 tick 寿命自愈，影响小
- **状态**: ✅ 已修复（随 TD-027 闭环 — reclaimExpeditionCreeps 在全部 abort 路径召回 claimer 并标记 recycle）
