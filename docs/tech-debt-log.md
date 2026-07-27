# 技术债清单

> 来源：线上遥测诊断（tick ~81,796,500–81,797,400）+ 全模块深度审计（2026-07-27）
> 最后更新：2026-07-27（经济模块深度审计追加 TD-012 ~ TD-020）

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
- **状态**: 待修

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

### TD-012: Terminal 能量遗漏导致 RCL6+ 假性危机误判
- **文件**: `src/systems/room-state.ts`（reserve 计算）, `src/domain/economy/phase.ts`（下游消费）
- **根因**: `reserve` 计算 = `energyAvailable + containers + storage + creepEnergy`，未计入 `snapshot.terminal` 中的能量。RCL6 解锁 terminal 后，一个正常运营房间 terminal 常囤积 2-5 万能量应对市场/远矿支援。遗漏此项导致 `reserveDelta` 系统性偏负 → `drainScore` 持续增高 → 假性 crisis 误判
- **影响**: RCL6+ 房间相位判准降低；信用良好的房间可能被错误收缩，浪费产能
- **修复**: 在 reserve 计算中加一行 `+(snapshot.terminal?.getUsedCapacity(RESOURCE_ENERGY) ?? 0)`
- **状态**: 待修

### TD-013: Hauler 通过 assignment 回退路径隐蔽从 storage 取能
- **文件**: `src/creeps/roles/hauler.ts`（`withdrawAssignmentContainer`）, `src/systems/assignment-service.ts`（`buildRoomTasks` 的 haul 任务回退）
- **根因**: `assignment-service` 在「无 container 但有 storage」时生成指向 **storage** 的 `haul` 任务（第 135-146 行）。`hauler.ts` 的 `withdrawAssignmentContainer` 用双重 `as` 断言将 storage id 当作 `Id<StructureContainer>` 处理（第 55 行）——JS 运行时 store 接口同构不报错，hauler 静默从 storage 取能。打破「hauler 收集、distributor 分发」的核心架构约束
- **影响**: 在 container 全空 + storage 有能量的边缘场景下，hauler 与 distributor 形成低烈度能量循环（storage→hauler→?→distributor→storage），浪费 CPU 和 creep 寿命
- **修复**: 方案 A（推荐）——禁止 assignment 生成指向 storage 的 haul 回退任务，container 为空时 hauler 等待 harvester 产出的正确行为由相位系统检测采集瓶颈来驱动；方案 B——保留回退但让 hauler 显式检查并记录约束降级事件
- **状态**: 待修

### TD-014: controllerDowngradeRisk 布尔信号无迟滞
- **文件**: `src/systems/room-state.ts`（第 139-142 行）
- **根因**: `ticksToDowngrade < 10000` 硬阈值，无进入/退出迟滞。Screeps 中 `ticksToDowngrade` 每 tick 减 1（upgrader 工作则增加），在 10001↔9999 边界单 tick 穿越，导致降级风险信号每 tick 翻转一次
- **影响**: 下游消费方（demand 中 upgrader 配额、construction-manager 开发门禁）在阈值附近来回切换，产生不必要的决策抖动
- **修复**: 引入迟滞带——进入阈值 10000，退出阈值 15000（类似 PhaseOptions 的非对称步长设计），配合 `roomMem.phase` 中新增 `downgradeRiskEntered` 时间戳
- **状态**: 待修

### TD-015: economyPressure 连续信号仅影响消费角色，物流角色无感知
- **文件**: `src/domain/spawn/demand.ts`（`evaluateDemand` 全函数）
- **根因**: `economyPressure`（0.0-1.0 连续信号）只用于 upgrader 目标数（第 348-387 行）、builder 梯度缩放（第 429-437 行）和 spawn-manager 的 P2 饥饿降级门禁（第 216 行）。harvester/hauler/distributor 的配额仅通过二值 `inCrisis` 开关控制。经济紧张（pressure=0.6 但未到 crisis）时，消费端已收缩但物流端照常孵化
- **影响**: 经济压力上升时 hauler/distributor 可能过度孵化，把紧张的 container 能量搬入 storage 再搬出，形成低烈度能量循环；多出的物流 creep 挤占 spawn 队列和 CPU 预算
- **修复**: 在 `dynamicHaulerTarget` 和 `distTarget` 中引入 `economyPressure` 衰减因子——pressure>0.6 时开始降低物流配额，线性缩放到 minCount
- **状态**: 待修

## P2 — 计划修

### TD-016: builder pressure 梯度在 threshold=0.3 处跳变振荡
- **文件**: `src/domain/spawn/demand.ts`（第 429-437 行）
- **根因**: `pressure <= 0.3` 满目标 vs `pressure > 0.3` 线性收缩——单一阈值无迟滞。pressure 在 0.29↔0.31 波动时 builder 目标在满与收缩之间反复跳变。对比 upgrader（第 373-387 行）使用三段梯度双阈值（0.3/0.7），builder 的单阈值更脆弱
- **影响**: builder 孵化请求（正常需求 pass，第 438-447 行）会因 `builderTarget` 波动走 `submitRequest` 同 key merge 更新 body/priority——虽不产生重复请求，但每 tick 更新增加 Memory 写入抖动。**注：替换请求（replacement pass，第 484-487 行）走独立 TTL 门禁，不受此影响——原清单中「替换请求每 tick 重建」经核实不成立**
- **修复**: 对 builder pressure 梯度引入迟滞窗（进入 0.35 / 退出 0.25）或使用最近 N tick 的 EMA 平滑
- **状态**: 待修

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
- **状态**: 待修

### TD-019: demand 与 targeting 的 source 分配协调不完备
- **文件**: `src/domain/spawn/demand.ts`（第 209-238 行）, `src/creeps/support/targeting.ts`（第 6-54 行）
- **根因**: demand 通过 `creep.memory.sourceId` 将分配的 source 写入 creep memory（第 524 行），targeting 运行时优先读取 `creep.memory.sourceId`（第 8 行）——**存在基本协调，非完全无协调**。但协调不完备有两个泄漏点：① `snapshot.sourceOccupancy` 只反映存活 creep，不包含队列中 pending spawn 的跨 tick 分配，同一 source 可能被超额分配；② targeting 有独立公平份额迁移逻辑（第 13-28 行，当前 source 超公平份额且存在更空闲 source 时清空 memory 重分），可直接推翻 demand 分配
- **影响**: source 负载可能偏离预期均衡，但幅度小（demand→memory→targeting 的默认路径生效），降级为 P3
- **状态**: 待修

### TD-020: economyPressure 分界点 40/60 硬编码（且 CONFIG.economy.crisis 为死配置）
- **文件**: `src/systems/room-state.ts`（第 121-124 行）, `src/config/index.ts`（第 202-204 行）, `src/domain/economy/phase.ts`（第 112-134 行）
- **根因**: `room-state.ts` 的 economyPressure 分段计算使用字面量 40 和 60（语义上 = exitScore 和 enterScore-exitScore）。**但更严重的是：** `CONFIG.economy.crisis.enterScore: 100` 和 `exitScore: 40`（config/index.ts:202-204）本身是全库死配置——零引用。真正的相位危机阈值来自 `PhaseOptions` 默认值 `drainEnterScore: 150` 和 `drainExitScore: 30`（phase.ts:112-134）。存在三重脱节：①硬编码 40/60 无编译期关联；② config 的 crisis 分数是死的；③真正的相位逻辑用着完全不同的默认值（150/30）
- **影响**: 修改 config 中 crisis 进出分数不会自动同步 economyPressure 分段点；也不会同步 PhaseOptions（需改 phase.ts 默认值或 runtime 传入）。不过当前 40 与 `drainExitScore: 30` 接近（误差 10 分），影响有限
- **修复**: ①在 `room-state.ts` 中将 40/60 改为引用 `PhaseOptions` 的默认值；②在 config 中给 `crisis.enterScore/exitScore` 加注释说明实际生效位置在 phase.ts；或③统一单真相源——让 phase.ts 从 CONFIG 读取阈值
- **状态**: 待修
