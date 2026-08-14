# Screeps: World 长稳 AI 开发计划

> 目标服务器：官服；初始配额：20 CPU；技术栈：Rollup + TypeScript + Vitest。  
> 设计信条：生存闭环优先于发展速度。任何昂贵工作必须有 CPU 上限、缓存、失效条件和可跳过的降级路径。

## 1. 项目目标

### 短期目标（第 0 至 3 周）

1. 在单房 RCL1 至 RCL4 稳定运行，global reset、单模块错误、低 bucket 或单角色异常均不会导致停摆。
2. 建成稳定内核：内存维护、版本迁移、错误隔离、20 CPU 看门狗、系统和角色插件注册。
3. 跑通最小经济闭环：采能、孵化、填充 spawn 与 extension、保级、关键建造。
4. 常态 CPU 目标低于 12 CPU/tick，99 分位低于 17 CPU/tick，不把 20 CPU 当成正常可用预算。
5. Spawn、建造和角色均由明确队列/状态机驱动，不依赖命名约定或 import 副作用。

### 长期目标（第 4 周起）

1. 支持多房、本地与远程经济、物流、防御、市场等能力；每一项均可作为插件加入，无需修改内核。
2. 形成核心生存层永远优先、发展层可降级、战略层可暂停的调度模型。
3. 以低 Memory 占用、增量规划、路径缓存和按房轮询为基础，长期适配 20 CPU。
4. 策略与执行彻底分离：系统做跨 creep 的决策，角色只执行已分配的短任务。
5. 对 CPU 枯竭、全员死亡、迁移中断、敌袭和错误风暴提供可测的恢复策略。

### 首期非目标

- 不做冲榜级全局最优调度、全图扫描、全房自动铺路或复杂市场套利。
- 不把大型路径、完整历史、运行时索引写进 Memory。
- 不依赖 prototype 污染、隐式模块初始化或由 creep 名称推断角色。

## 2. 整体架构设计

### 2.1 分层原则

- 内核只维护运行秩序，不知道 harvester、建筑或经济策略。
- 系统负责跨 creep / 跨房的决策，例如快照、孵化、建造、物流和防御。
- 角色是单 creep 的小状态机，只读取任务并发出动作，不进行全局规划。
- 领域层尽量是纯 TypeScript 逻辑，便于用 Vitest 测试。
- Memory 只保存跨 tick 真相和意图；global 只保存可丢失、可重建的索引与路径缓存。

### 2.2 目录结构与职责

当前骨架中的 kernel、creeps、systems、domain、config 可演化为：

~~~
src/
  main.ts                         # 仅导出 loop
  bootstrap.ts                    # 唯一插件组合入口（注册 13 系统 + 5 角色）
  config/
    index.ts                      # 集中策略、CPU 阈值、功能开关
    bodies.ts                     # body 模板和生成约束
    tuned.ts                      # 运行时参数覆盖层（tuning-engine 写入）
  kernel/
    kernel.ts                     # tick 生命周期与调度
    contracts.ts                  # System、CreepRole、TickContext、RoomSnapshot
    registry.ts                   # 显式注册表
    scheduler.ts                  # 优先级、预算与降级层
    memory.ts                     # 清理与版本化迁移
    safe-run.ts                   # 错误边界与日志限流
    telemetry.ts                  # 轻量指标
    global-cache.ts               # global 对象类型安全访问器
    segment-store.ts              # RawMemory segment 管理
    timeseries.ts                 # 时序数据 ring buffer
    event-log.ts                  # 事件日志
    ring-buffer.ts                # 环形缓冲区实现
  domain/
    economy/                      # 经济信号、link 规划、phase 计算
    spawn/                        # SpawnRequest、队列、需求评估、回收
    construction/                 # 建造优先级和计划校验
    layout/                       # 蓝图、约束推导、min-cut 防御
    assignment/                   # 任务分配、槽位、lease
    defense/                      # 威胁分级、tower 目标选择
    industry/                     # lab/boost/terminal 工业逻辑
    tuning/                       # 参数自调优纯逻辑
    intel.ts                      # 邻居房情报类型定义（RoomIntel）
  systems/
    room-snapshot.ts              # 每房每 tick 一次扫描（函数，非 System）
    room-state.ts                 # P0：每房 ColonyState + ColonyPhase 迟滞
    spawn-manager.ts              # P0：需求、队列、孵化、重试、回收
    tower-defense.ts              # P0：塔防 + safe mode
    assignment-service.ts         # P1：任务列表生成 + 紧急抢占
    link-system.ts                # P1：link 能量瞬移
    lab-system.ts                 # P1：lab 反应 + boost
    construction-manager.ts       # P2：建造队列与 site 限流
    layout-planner.ts             # P3：低频布局规划
    defense-planner.ts            # P3：防御布局规划（rampart/wall）
    room-observer.ts              # P3：低频房间策略
    pixel-system.ts               # P3：pixel 生成
    telemetry-collector.ts        # P3：遥测采集
    tuning-engine.ts              # P3：参数自调优
  creeps/
    engine/                       # 角色引擎（RolePolicy + Action-Candidate）
    movement/                     # 寻路、交通热度、卡位恢复
    roles/                        # harvester、hauler、upgrader、builder、worker
    support/                      # 公共辅助（维修目标查找等）
  types/
    global.d.ts
tests/
  *.test.ts                       # 单元测试
  integration/                    # 场景/边界测试
~~~

### 2.3 数据所有权

| 数据 | 唯一写入者 | 消费者 | 位置 |
| --- | --- | --- | --- |
| 本 tick 房间快照、对象索引 | room-snapshot | 所有系统与角色 | TickContext / global |
| 房间长期战略和建造意图 | 房间或建造系统 | Spawn、角色 | Memory.rooms |
| 邻居房情报（出口/房态/SK 分类/资源） | room-observer | 未来远矿/扩张选址 | Memory.rooms 的 intel |
| Spawn 请求及状态 | spawn-manager | Spawn、遥测 | Memory.rooms 的 spawnQueue |
| creep 的 role、home、状态、目标 | Spawn 初始化和对应角色 | 对应角色 | CreepMemory |
| 路径、CostMatrix、临时索引 | movement 缓存 | 角色 | global，可丢失 |
| schema 和迁移 cursor | memory 模块 | 内核 | 根 Memory |

任何模块均不得顺手改写其他模块拥有的数据。跨模块协作通过 TickContext 中的快照和拥有者消费的请求完成。

### 2.4 Tick 数据流

~~~
main.loop
  -> Kernel：global 缓存恢复、Memory 迁移/清理、创建 TickContext
  -> P0：威胁检查、房间快照、Spawn 紧急恢复
  -> P1/P2：常规经济、角色需求、建造队列
  -> Creep roles：执行已分配的目标
  -> P3/P4：侦察、布局、远矿、市场、统计
  -> telemetry：预算、跳过数、错误摘要
~~~

系统输出意图与任务；角色输出 Screeps intent。角色不能反向重算房间战略或直接创建 Spawn 请求。

## 3. 内核实现细节

### 3.1 固定调度流程

1. 建立轻量 TickContext，读取 CPU、bucket 和当前降级模式。
2. 初始化/验证最小 Memory，执行死亡 creep 清理与小批量迁移。
3. 每个自有可见房间只扫描一次，生成本 tick 的 RoomSnapshot。
4. 执行 P0：防御、紧急 Spawn、最小能量链。
5. 执行 P1 和 P2：常规孵化、经济角色、保级、有限建造。
6. 按房间和角色优先级运行 creeps，而不是按对象枚举的偶然顺序。
7. 有剩余预算才运行 P3/P4：侦察、重型规划、远矿、市场、分析。
8. 以 best effort 方式写入轻量 telemetry。

建议把现有 System 契约扩展为：

~~~ts
type Priority = 0 | 1 | 2 | 3 | 4;

interface System {
  readonly name: string;
  readonly priority: Priority;
  readonly interval?: number;
  run(ctx: TickContext): void;
}
~~~

新增元数据只能改变调度行为，不改变 bootstrap 的注册模式。

### 3.2 20 CPU 看门狗与降级执行

有效硬上限取 Game.cpu.limit 和 Game.cpu.tickLimit 中的较小值。硬上限是最后防线，绝不是日常目标；不要依赖 bucket 透支维持常态。

| 模式 | bucket 条件 | 20 CPU 下软截止 / 硬截止 | 允许工作 | 跳过工作 |
| --- | ---: | ---: | --- | --- |
| Healthy | 不低于 7,000 | 17.5 / 19.2 | P0 至 P3，P4 仅剩余预算 | 全局重规划 |
| Guarded | 3,000 至 6,999 | 16 / 18.5 | P0 至 P3（interval 系统按名称哈希错峰） | P4 |
| Conserve | 1,000 至 2,999 | 14 / 17 | P0 至 P2，限制升级/建造 | P3、P4 |
| Recovery | 低于 1,000 | 12 / 15.5 | 防御、孵化、能源链、必要移动 | 建造、升级、侦察、分析 |

规则：

- 每个系统和每个 creep 之前都检查预算；执行后再次检查，硬熔断只停止尚未开始的工作。
- P0 是塔防、威胁响应、紧急孵化和关键 Memory 修复；它也必须廉价，不能包含大规模寻路或无上限循环。
- 低 bucket 降级立即生效；恢复升级需 bucket 比下一档阈值高至少 500，且持续 20 tick，避免频繁抖动。
- 所有批处理必须有数量上限或持久化 cursor。不得因“本 tick 做完”而写无界循环。
- Red/Recovery 下每房只保留采能、向 spawn/extension 送能、最小防御和恢复孵化链；暂停所有发展性工作。
- 跳过任务记录 skip reason 与次数，不能静默丢失。后续任务需在 nextRun 或 cursor 上可恢复。

示意实现：

~~~ts
function runGuarded(job: Job, budget: Budget): void {
  if (!budget.canStart(job.priority, job.costHint)) return;
  try {
    job.run();
  } catch (error) {
    errors.capture(job.id, error);
  } finally {
    budget.record(job.id);
  }
}
~~~

### 3.3 错误边界

- 系统、每个 creep role、以及可选的单 creep 执行均走 safeRun。一个错误不能结束剩余 tick。
- 日志格式为 [tick] stage/name: message；相同 label 和错误签名每 25 tick 最多输出一次。
- 预期返回码，例如不在范围、目标耗尽，不是异常；它们驱动状态机转移。
- 未知角色、失效 target ID、无效建造请求先尝试自愈：清理目标、标记请求失败、应用 body 回退。
- 非关键插件连续报错时冷却 80 至 200 tick（错误计数跨冷却轮次累积，时长真递增）；冷却跳过必须记 skip reason 并写 PluginCooldown 事件；P0 只限流日志，不盲目禁用。
- 生产默认错误隔离（safeRun 捕获 + 限流日志）；长堆栈不重复写入 Memory。

### 3.4 版本化 Memory

建议根 Memory 保持如下形态：

~~~ts
interface RootMemory {
  schemaVersion?: number;           // 首次 tick 可能不存在，迁移后补设
  rooms: Record<string, RoomMemory>;
  creeps: Record<string, CreepMemory>;
  kernel?: KernelMemory;            // 内核跟踪：skipReasons、tuning 等
}
~~~

> 注意：plan.md 早期设计中有 `migration` 字段，但实际实现中迁移状态由 `schemaVersion` 隐式管理，无需独立字段。`kernel` 字段在实际代码中已存在（v2 迁移引入）。

迁移规范：

1. 每次持久化结构变更增加版本，提供从旧版本到新版本的函数。
2. 迁移必须幂等：重复运行不会重复建队列、丢失数据或改变完成结果。
3. 先写新字段，验证完成后删除旧字段；只有所有步骤成功后才更新 schemaVersion。
4. 大迁移按 cursor 分 tick，每 tick 仅处理固定数量条目；Recovery 时暂停非关键迁移。
5. 死亡 creep Memory 小帝国可每 tick 清；规模变大后按 cursor 每 10 tick 清理。
6. 每次版本升级必须有空 Memory、旧版本、重复执行和中断恢复的 Vitest 用例。

当前版本：v27（R4 战争自治升级 — warPlan.phase/spawned、kernel.warBlacklist、strategy.warPressureTicks 建档自愈；v26 R3 战时闭环 warPlan 建档；v25 prevThreatCount 建档；v24 storageDrainAccum 建档；v23 churnFreezeUntil 建档；v22 srcStallTicks/storageEnergyPrev 建档；v21 目标清单布局闭环 — kernel.layoutGaps + layout.nextGapPlanTick 建档自愈。更早：v20 tuning pendingValidation/frozenParams 建档；v19 demand 纯度收口自愈；v18 tuning.baselineVersion 建档；v17 layout.planStage 回填；v16 dangerUntil 搬家；v15 remoteOps.siteCount 自愈；v14 phase.bandTicks 回填；v13 kernel.strategy 自愈；v12 lastHostileAt 与 intel 自愈；v11 expansion/lostRooms 自愈；v10 remoteOps 自愈；v9 phase.liquidityScore 回填；v8 删除遗留 working；v7 tuning 结构；v6 核心模板 v2；v5 recycle/intel）。

## 4. 插件注册规范

bootstrap.ts 是唯一组合根。新增角色或系统时，只改 bootstrap 和新增模块，不改 Kernel。

~~~ts
const registry = new Registry()
  // P0
  .registerSystem(roomStateSystem)
  .registerSystem(spawnManagerSystem)
  .registerSystem(towerDefenseSystem)
  // P1
  .registerSystem(assignmentServiceSystem)
  .registerSystem(linkSystem)
  .registerSystem(labSystem)
  // P2
  .registerSystem(constructionManagerSystem)
  // P3
  .registerSystem(layoutPlannerSystem)
  .registerSystem(defensePlannerSystem)
  .registerSystem(roomObserverSystem)
  .registerSystem(pixelSystem)
  .registerSystem(telemetryCollectorSystem)
  .registerSystem(tuningEngineSystem)
  // Roles
  .registerRole(workerRole)
  .registerRole(harvesterRole)
  .registerRole(haulerRole)
  .registerRole(upgraderRole)
  .registerRole(builderRole);

export const kernel = new Kernel(registry);
~~~

规范：

1. 名称采用全局唯一的 kebab-case，例如 spawn-manager 或 harvester；重复注册启动即失败。
2. 模块顶层不得访问 Game、Memory 或启动计算；运行时行为只发生在 run。
3. 系统声明 priority、运行间隔和估计成本；角色声明前置条件、状态机和失效策略。
4. 策略参数只从 config 读取，不在角色中散落魔法数字。
5. 删除插件前先提供兼容读取或 Memory 迁移，防止旧 creep 永久成为未知 role。

## 5. Creep 行为约束与紧急发展

### 5.1 全角色硬约束

1. 每个角色是明确小状态机，例如 collecting 到 delivering；只在背包空/满或任务完成时切换，防止反复抖动。
2. Memory 最小化：只存 role、home、state、targetId、assignment、pathKey 等。所有 creep 必须有 home。
3. 首选缓存 targetId；只有目标不存在、不可达、资源耗尽/已满或 TTL 失效时才重新选取。
4. 每 tick 最多一个主资源动作，加一次必要移动；先操作，遇到不在范围再移动，成功后尽早返回。
5. 角色禁止全房 find、全局扫描、创建 Spawn 请求、重新规划建筑，禁止在每 tick 调用 PathFinder.search。
6. RoomSnapshot 每房每 tick 建一次；角色复用 source、container、spawn、extension、hostile 的索引。
7. moveTo 使用稳定目标和短期 reusePath；只有目标变化、缓存过期或连续卡位 2 至 3 tick 才重寻路。
8. global 路径/CostMatrix 缓存可随 global reset 丢失，必须可惰性重建；任务唯一状态不能只放 global。
9. target 失效时清空字段并进入安全待命或重新分配，不能抛错、死循环或刷日志。

### 5.2 角色优先级

| 优先级 | 角色 | Recovery 行为 | 常态边界 |
| --- | --- | --- | --- |
| P0 | recovery worker、harvester、关键 hauler | 必须运行 | 只保证采能和 spawn/extension 供能 |
| P1 | miner、hauler、保级 upgrader | 有预算运行 | 先守 source 和物流，再升级 |
| P2 | builder、repairer | 仅关键任务 | 仅能量盈余时存在 |
| P3 | scout、reserver、remote、战斗扩张 | 停止 | 有明确任务、TTL、撤退条件才运行 |
| P4 | 可视化和实验性角色 | 停止 | 不能影响生存预算 |

执行顺序为房间后按 P0 至 P4；同优先级再按紧急程度和距离排序。后期可为每类角色设置每 tick 最大执行数，并轮转剩余 creep。

### 5.3 harvester 与经济演进

| 阶段 | 角色组合 | 条件与约束 |
| --- | --- | --- |
| 灾后 / RCL1 | worker 或基础 harvester | 没有可工作 creep 时，使用 [WORK,CARRY,MOVE]，成本 200，直接采集并填 spawn |
| RCL1 稳定 | 1 至 2 混合 harvester | 先保证 spawn 持续供能，不能等待理想大 body |
| RCL2 | source worker、hauler、少量 upgrader | container 和基础 extension 可用后，采能与搬运开始分离 |
| RCL3 至 RCL4 | 固定 miner、hauler、upgrader、按需 builder/repairer | worker 仅为恢复保险，不再是主力 |
| 多房 | 本地经济角色与显式 remote 角色 | 只在本地存量和 CPU 预算达标后解锁 |

当前基础 harvester 的改造目标：

- 不再每 tick 通过路径式搜索选择 source；出生或房间服务分配 sourceId。
- 无 source container 时执行 harvest 到直接填 spawn/extension，防止新房能源死锁。
- source container 和 hauler 都已就绪后，切为固定矿位 miner，由 hauler 完成物流。
- 切换前保留直接送能能力；不得先转 miner 再发现没有 hauler。
- source、container、交付 target 都有 TTL 与失效检测；空闲时低成本待命。

### 5.4 Spawn 孵化：唯一入口与紧急恢复

Spawn Manager 是唯一能够调用 spawnCreep 的模块。角色不得自行孵化。请求需有稳定去重键，例如 harvester:W1N1:source-id:0：

~~~ts
interface SpawnRequest {
  key: string;
  role: string;
  home: string;
  priority: 0 | 1 | 2 | 3 | 4;
  body: BodyPartConstant[];
  memory: CreepMemory;
  createdAt: number;
  expiresAt?: number;
  replaceBy?: number;
  retries: number;
}
~~~

孵化优先级（实现映射：P0 恢复 worker / P1 defender·harvester·hauler·distributor·远矿经济 / P2 upgrader·builder·reserver·claimer；P3/P4 保留在类型中供未来战略角色使用）：

1. P0 灾后恢复：没有存活或正在生成的可采集且可送能 creep 时，暂停一切非 P0；可用能量达到 200 就立即生成 [WORK,CARRY,MOVE]。威胁在场时先入队 P0 defender 清场（W-3）。低优先级孵化不得侵占恢复能量：采集链濒临断裂（存活采集者 ≤1）时非 P0 请求按 energyAvailable − recoveryEnergyReserve 校验（采集角色豁免 — 它们本身是恢复路径）。
2. P1 能量入口：每个安全本地 source 至少有采集覆盖；container 未就绪前采集者必须带 CARRY。
3. P1 能量配送：当 miner 正常但 spawn/extension 长时间缺能时，补充最小 hauler。
4. P2 保级与关键维修：只保留避免控制器降级和关键结构失效的能力。
5. P2 发展：upgrader、常规 builder 只在 P0/P1 齐备、无敌袭、CPU 非 Recovery 且留有紧急 body 能量时生成（饥饿超时降级见 trySpawn 三层降级）。
6. 远矿/扩张角色由 remote-mining-manager / expansion-manager 独立评估后直接入队（P1/P2），受 empire-strategy 姿态与止损链门禁。

队列和替换规则：

- 请求按 key 幂等合并，spawn.spawning 和已提交请求必须计入人口，避免重复孵化。
- body 不能超过 energyCapacityAvailable。P0 可以按 energyAvailable 降级立即出生；普通角色可等待合理体型，但有最长等待时间。
- 关键替换在 ticksToLive 不大于 body.length 乘 3、预计路程与 15 tick 安全缓冲之和时入队（harvester 计入 spawn→source 通勤估算，其余角色路程为 0）。
- 普通请求不得侵占关键替补的最晚开工窗口（sortQueue 的 replaceBy 优先规则 X-17）。
- ERR_BUSY 不算失败；能量不足保留请求；body 不合法等配置错误达重试上限后隔离 — key 进入黑名单冷却（1 个 TTL 窗口），期间 demand 不得重建，防止「失败 → 删除 → 重建」翻炒。
- colony 状态由 room-state P0 系统每 tick 计算：BOOTSTRAP、RECOVERY、NORMAL、DEFENSE。角色只读取状态。状态机使用 ColonyPhase 迟滞（bootstrap/growth/steady/crisis/recovery），避免在阈值附近频繁切换。
- economyPressure 是 0.0 至 1.0 的梯度信号（存储在 RoomMemory），由 room-state 每 tick 写入。各子系统消费此信号实现平滑缩放：construction-manager 用作建造门禁、demand 用作 upgrader/builder 数量缩放、tuning-engine 用作调优输入。梯度信号取代了二值 crisis/normal 开关，避免抖动。
- 升级功率由 storage 水位驱动：storage ≥ 50k 且经济健康时冲刺（2 个大 body 站桩烧库存换 RCL）；≥ 10k 时 1 个大 body 满功率（≈15/tick）；低水位按 pressure 停升级攒库存；无 storage 时保留早期猛冲梯度。RCL8 显式封顶 15 WORK（官方 15 energy/tick 上限）。
- body 模板随 RCL 容量放大：upgrader 至 15W@1650、builder 至 8W4C6M@1300、hauler 道路变体至 16C8M@1200；P0/bootstrap/recovery 降级路径不变。
- 回收通道：废弃角色与富余 worker（harvester 满编后超出 1 只）由 spawn-manager 标记 recycle 并引导至最近 spawn recycleCreep，回收残值并释放 CPU；被标记 creep 的角色逻辑短路 idle。

官服中若全员死亡且 spawn 无法再积累 200 能量，通常无法自救。因此提前替补最后一名采集者和保留恢复能源是不可妥协的硬约束。

### 5.5 建筑建造和维修：服务经济，不反噬经济

construction-manager 是唯一创建 construction site 的模块。它消费版本化 BuildQueue 或蓝图，而不是每 tick 重遍历地图。

| 阶段 | 必须优先 | 有余力才做 | 明确禁止 |
| --- | --- | --- | --- |
| RCL1 生存 | 采能、送能、尽快升级 | 关键地块预留 | 铺路和批量建造 |
| RCL2 吞吐 | extension、source container | controller 短路径 | 多 site 并行和远处道路 |
| RCL2 至 RCL3 物流 | source container 与明确 miner/hauler 方案 | 高频短路维修 | 孤立 container 投资 |
| RCL3 防御 | tower 与持续供能、关键 extension | 必要核心维修 | 墙/rampart 堆量 |
| RCL4 稳态 | storage、核心物流、受控维修 | 具回报的道路 | 全房铺路 |
| RCL5 以上 | link、分区防御、远矿配套 | 按 ROI 扩张 | 未验证的大规模布局 |

强制规则：

- 初始全局活跃 site 上限 7（3 extension + 2 road + 关键 container 并行，紧急重建豁免）；每房五类独立计额：critical(tower/spawn) 1、storage 1、road 2、source container 1、normal 3。
- 队列项包含 priority、依赖、重试次数、失败原因、冷却和完成判定。地形冲突、RCL 不足、不可达等错误必须退避或删除。
- 规划器仅在 RCL 变化、关键建筑完成、布局失效或每 25 至 50 tick 执行；执行器每 tick 只消费已有队列。
- builder 早期最多一名。没有高优先级 site、P0/P1 不足、能量低于生存水位或 CPU Recovery 时，停止新 builder。
- builder 无可建目标时按顺序回退为 spawn/extension 填能、关键维修、控制器升级；不得空转。
- 维修顺序为 spawn/extension/container/tower、高流量道路、其他结构。墙和 rampart 只进入防御插件的明确计划。
- 维修权归属：日常结构与工事维修由 creep（builder/worker）承担；本房存在维修 creep 时塔只开火，不做结构/工事维修（塔修成本高且占用防御弹药）；无维修 creep 时塔保留维修作灾后安全网。
- builder 的防御工事维修（wall/rampart 至 RCL 分级血量）必须同时满足：tier 非 recovery/conserve、无威胁 creep、storage 能量 ≥ 10k（真盈余）。
- extractor 由 layout-planner 以动态任务生成（RCL6+，矿位上，优先级 3），不走静态模板。
- 道路依据实测交通热度逐段添加，绝不预铺全房或远程路线。

### 5.6 布局与建造的技术实施方案

本项目不在第一阶段编写“全自动最优布局搜索器”。在 20 CPU 下，可靠方案是“代码内版本化蓝图 + 低频局部适配 + 队列化执行”：静态部分由经过验证的紧凑核心模板定义，房间特有部分只在必要时增量计算。这样既能持续演进，又不会在每个 tick 为布局付费。

#### 5.6.1 布局设计决策

1. **锚点优先于完美模板**。已有主 spawn 的房间以主 spawn 为核心锚点；它不能移动，因此模板必须围绕实际 spawn 做局部适配。新 claim 房在决定第一个 spawn 位置前才允许执行候选点评分。
2. **核心与外圈分离**。spawn、extension、tower、storage、link 属于紧凑核心；source container、controller container、道路、矿物设施和防御外圈是房间特有的附属区。不可要求一个固定 11 乘 11 模板解决全部问题。
3. **蓝图是声明，不是立即施工命令**。每个格子只有在 RCL、前置结构、能量和 CPU 条件满足时，才会变为 BuildTask。
4. **布局不可自动破坏性重排**。一旦核心结构已经建成，冲突只会标记 blocked 并报警，不会自动拆建筑或改变锚点。重规划需要显式 feature flag 或人工确认。
5. **道路是证据驱动的稀疏覆盖**。先建 source、spawn、controller 之间的关键短路；只有高频通行被持续观察到才物化新道路，绝不因为模板空格而铺满房间。

推荐的功能目录：

~~~
src/
  domain/layout/
    types.ts                  # Blueprint、LayoutState、BuildTask、packing
    templates/
      compact-core-v2.ts      # 与锚点相对的静态核心
    candidate-score.ts        # 新房锚点评分，纯函数
    validation.ts             # 地形/RCL/占位/依赖校验，纯函数
    task-factory.ts           # 蓝图单元转 BuildTask
    road-policy.ts            # 交通热度转道路候选，纯函数
  systems/
    layout-planner.ts         # 低频生成或修复布局计划
    construction-manager.ts   # 高频消费 BuildQueue，创建 site
  creeps/
    builder.ts                # 只执行已分配 BuildTask
~~~

#### 5.6.2 蓝图和持久化数据模型

静态蓝图保存在代码中，而不是每房复制到 Memory。每个模板单元通过相对坐标定位；Memory 只保存模板 ID、锚点、修订号、少量覆盖项和任务状态。这样一个房间不会因为布局数据增长成大对象。

~~~ts
type BuildPriority = 0 | 1 | 2 | 3;
type LayoutPhase = "bootstrap" | "rcl2" | "rcl3" | "rcl4" | "late";

interface BlueprintCell {
  key: string;                         // 例：core.extension.01
  dx: number;
  dy: number;
  structureType: BuildableStructureConstant;
  minRcl: number;
  phase: LayoutPhase;
  priority: BuildPriority;
  requires?: readonly string[];        // 依赖其他 blueprint key
  tags: readonly ("core" | "logistics" | "defense" | "road")[];
}

interface Blueprint {
  id: string;                          // 例：compact-core-v2
  anchorKind: "primary-spawn" | "planned-spawn";
  cells: readonly BlueprintCell[];
}

interface LayoutMemory {
  version: number;
  templateId: string;
  state: "proposed" | "accepted" | "building" | "blocked" | "manual";
  anchor: number;                      // packed position: x * 50 + y
  revision: number;
  nextPlanTick: number;
  overrides?: Record<string, number>;  // 仅保存偏移/替代位置
  blocked?: Record<string, { code: number; retryAt: number }>;
}

interface BuildTaskMemory {
  key: string;                         // 蓝图 key，动态道路才带独立坐标
  state: "queued" | "site" | "done" | "blocked";
  attempts: number;
  retryAt: number;
  assignedTo?: string;
  leaseUntil?: number;
}
~~~

坐标编码使用 x 乘 50 加 y，范围为 0 至 2499。结构类型、RCL、优先级等可由代码里的 BlueprintCell 反查，避免重复写入 Memory。动态道路和人工覆盖只存稀疏差异。

核心模板的最小内容应按阶段编码：

| phase | 典型单元 | 设计理由 |
| --- | --- | --- |
| bootstrap | 已有 primary spawn，不新建核心 site | 先恢复能量链，避免无谓施工 |
| rcl2 | 第一批 extension、source container、短物流路 | 解锁可用 body 和稳定采集 |
| rcl3 | tower、剩余高价值 extension、塔供能路线 | 防御先于美化和大规模道路 |
| rcl4 | storage、核心物流位、必要 container/道路 | 形成可控能量缓冲 |
| late | link、terminal、实验室、防御外圈 | 必须由独立经济和 CPU 指标解锁 |

模板必须在代码评审中被视作版本化协议。模板改动需要递增 templateId 或 layout.version，并写迁移逻辑；不能悄悄改变已建房间的含义。

#### 5.6.3 规划器：何时规划、如何选点

layout-planner 是 P3 工作；只有 Green 或 Guarded 且房间不处于 BOOTSTRAP、RECOVERY、DEFENSE 时运行。触发条件限定为：

- 房间第一次获得可见性或第一次拥有 spawn；
- controller 等级变化；
- 关键 blueprint cell 完成、丢失或被标记 blocked；
- layout.version / templateId 升级；
- nextPlanTick 到期，初始间隔为 50 tick；
- 人工显式设置 layout.state 为 manual/proposed。

现有 spawn 房的算法：

1. 以主 spawn 作为 anchor，加载 compact-core-v2（偶校验棋盘格：结构只落在 dx+dy 偶数格，奇数格永远留作走道，几何上不可能形成密封）。
2. 将每个相对单元转为绝对坐标，过滤越界、墙、source、controller、mineral 和不可兼容建筑。
3. 对于可移动结构（extension），墙/占用/密封失败时按同 parity（偶校验）的 Chebyshev-2 fallback offset 列表寻找第一个通过完整验证（含密封守卫）的替代格，替代坐标持久化到 segment overrides，后续周期直接复用；不可移动的核心单元（spawn/storage/tower/link）直接标记 blocked。
4. 为 source 和 controller 生成外圈任务：container 坐标优先选相邻 walkable 格，且路线成本、现有道路和安全性评分更好。
5. 只把当前 RCL 和 phase 允许的任务送入 BuildQueue，其余留在蓝图中等待。

新 claim 房的算法仅在可选择初始 spawn 时使用。候选格采用 3 格步长的有限网格，单次最多处理 5 个候选，跨 tick 保存 cursor；评分只计算一次并存入 LayoutMemory。建议分数为：

~~~ts
score =
  4 * buildableCoreTiles
  - 2 * averageDistanceToSources
  - 1 * distanceToController
  - 3 * exitRisk
  - 4 * blockedTemplateCells;
~~~

候选位置需满足：核心矩形不越界、关键格不是墙、距出口保留安全距离、不会占 source/controller/mineral。不要在每 tick 遍历 2500 格；大扫描只能在 Green 下增量完成。

#### 5.6.4 位置验证和队列生成

所有位置在创建 site 前必须经过同一验证器，避免 planner 和 executor 逻辑不一致：

~~~ts
function validateBuildCell(
  room: Room,
  cell: BlueprintCell,
  pos: RoomPosition,
  snapshot: RoomSnapshot,
): "ok" | "rcl" | "terrain" | "occupied" | "site-limit" | "dependency" | "seal" {
  // 1. 使用 CONTROLLER_STRUCTURES 检查当前 RCL 可建数量
  // 2. room.getTerrain 检查墙和边界
  // 3. 使用 snapshot 检查 source/controller/mineral 与已有结构/site
  // 4. 密封守卫（v1 实心块教训）：障碍结构出生即密封、或夺走邻居最后一个
  //    可站格时返回 "seal"（permanent → blocked）。transfer/spawnCreep 射程为 1，
  //    每个障碍结构必须保留 ≥1 个相邻可站格。
  // 5. 检查 BuildTask 的前置 key 是否为 done
  // 6. 检查 per-room / global 活跃 site 上限
  return "ok";
}
~~~

BuildTask 的优先级由以下稳定序列产生，避免 builder 随机选择：

1. 被摧毁 spawn 的重建、关键 tower、关键 container；
2. 解除 Spawn 体型或能量吞吐瓶颈的 extension；
3. source container 和配套短路；
4. storage 与已验证的核心物流；
5. 高流量道路和普通维修；
6. 墙、装饰、远矿配套和其他 late 内容。

若返回 rcl 或 dependency，任务保留 queued，并在 RCL/依赖变化时重新检查；若返回 terrain 或永久 occupied，设为 blocked、记录原因，并将 retryAt 设为较长冷却。只有人工确认或布局修订才解封永久冲突。临时 API 错误采用指数退避，不可每 tick 重试。

#### 5.6.5 施工执行器和 builder 的协作

construction-manager 是每 tick 运行但成本受限的执行器；layout-planner 是低频规划器。执行器的固定流程：

1. 从 RoomSnapshot 同步 queued、site、done、blocked 状态；一次扫描得到所有 construction site 和结构。
2. 清理失效 lease，移除已完成或已不存在的目标。
3. 检查 colony 状态、CPU tier、P0/P1 Spawn 缺口和紧急能量地板。
4. 仅选择一个最高优先级、验证通过、到期可重试的 queued task。
5. 全局每 tick 最多创建 1 个紧急 + 1 个普通 site（紧急重建独立计额，不被普通建造挤占）；每房限额见 §5.5 五类独立计额。若低 CPU 或发展门禁未通过，保持队列但不创建。P0 孵化缺口（紧急恢复 worker 在队）时阻塞普通建造。
6. 创建成功后标记 site；创建失败写入标准失败码和 retryAt。

发展门禁必须同时满足：

- 无 P0/P1 Spawn 请求缺口，且没有敌对威胁；
- colony 为 NORMAL，CPU 不低于 Guarded；
- 已预留一个 200 能量恢复 body 的能力；
- 当前任务属于 critical，或房间能源/物流达到配置中的盈余门槛；
- active site 数量在上限以内。

builder 不是规划器。它向 assignment-service 请求一个有 lease 的 BuildTask，优先执行当前 task；操作失败时通过返回码改变 task 状态，而不是直接搜索全房。builder 的每 tick 流程：

~~~ts
if (needsEnergy(creep)) return acquireFromAssignedSource(creep, ctx);
const task = getValidBuildTask(creep, ctx);
if (task) return buildOrMoveToTask(creep, task, ctx);
return fallbackBuilder(creep, ctx); // 填 spawn/extension -> critical repair -> upgrade -> idle
~~~

当 CPU 为 Conserve 时，只允许 builder 执行 priority 0/1 的已存在 site；Recovery 时 builder 释放普通 task lease，转为送能或待命。这样低 bucket 不会留下大量过期 assignment。

#### 5.6.6 道路和交通热度

初版不创建完整热力图。每个执行移动的角色只向 global 的 roomTrafficMap 增加当前位置的轻量计数；global reset 后自然清零，不影响正确性。每 50 tick 且 Green 时，road-policy 只取每房前 3 至 5 个候选：

- 只有连续两个采样窗口都超过阈值；
- 不在核心保留格、出口、墙、已有 road 或 site 上；
- 至少连接 source、spawn、storage、controller 中的两个高价值端点；
- 当前没有 P0/P1 缺口且 site 预算允许。

被选中的道路以动态 BuildTask 存入 Memory；未达阈值的统计不持久化。该策略使道路建设由真实交通证明，而不是 CPU 高昂的全图路径分析驱动。

#### 5.6.7 布局建造实施顺序与验收

| 步骤 | 前置 | 实施内容 | 验收 |
| --- | --- | --- | --- |
| L1 类型与模板 | M2 | 新增 layout 类型、compact-core-v2、坐标 packing、静态校验 | 纯函数测试覆盖越界、冲突、RCL 和依赖 |
| L2 快照与验证器 | L1 | RoomSnapshot 中加入 terrain、结构、site 索引；实现 validateBuildCell | 同一格不会被重复入队或重复建 site |
| L3 队列执行器 | L2、Spawn Manager | BuildTask 状态机、退避、site 限流、发展门禁 | P0 缺口时不创建普通 site；错误不刷屏 |
| L4 builder 接入 | L3、assignment-service | builder lease、建造回退、低 CPU 释放任务 | 空队列 builder 正确填能/待命 |
| L5 动态道路 | L2、L3 | global 交通采样与有限道路候选 | 100 tick 内不出现全图铺路；只有高频路径建 road |
| L6 新房候选规划 | L1 至 L5 稳定后 | 增量候选评分与人工确认开关 | 候选计算可暂停/恢复，不超过规划 CPU 预算 |

布局测试除纯函数外，必须覆盖：初始 spawn 造成模板冲突、RCL 变化、site 已存在、controller 结构数量上限、建筑被毁、低 CPU 冻结、global reset、任务重试和人工 manual 状态。

#### 5.6.8 约束推导布局模式（Phase 6 新增）

Phase 6 引入了基于 Distance Transform + 约束推导的布局模式（`constraint`），作为默认布局策略。原有的固定模板模式（`template`，compact-core-v2）保留为极端地形下的回退选项。

~~~ts
// config/index.ts
layout: {
  mode: "constraint" as "template" | "constraint",
}
~~~

**constraint 模式**（`domain/layout/constraint-placer.ts`）：
- 使用 Distance Transform 找到最大空闲区域，从地形推导最优放置位置
- 约束驱动：source 位置、controller 位置、mineral 位置、出口距离、地形墙
- 适应不同房间地形，无需人工调参
- 比固定模板更灵活，但计算成本更高（已通过预计算 structureCounts/occupiedSet 优化）

**template 模式**（`domain/layout/templates/compact-core-v2.ts`）：
- 固定蓝图偏移 + relocation（§5.6.1-5.6.7 描述的方案）
- 计算成本低，适合标准地形
- 极端地形下可能产生过多 blocked 格

**min-cut 防御规划**（`domain/layout/min-cut-defense.ts`）：
- 基于最小割算法计算最优 rampart 覆盖
- 独立于核心布局，由 `defense-planner.ts` P3 系统驱动
- 目标：用最少的 rampart 覆盖所有可攻击路径

模式切换通过 `CONFIG.layout.mode` 配置，模板改动须递增 `templateId`/`layout.version` 并写迁移。

### 5.7 Creep 行为约束的技术实施方案

角色实现采用“角色壳 + 任务分配 + 任务执行 + 移动服务”四层。这样新增角色只需注册新的 role 壳和任务执行器，而无需复制一套扫描、移动、错误处理和状态清理逻辑。

~~~
CreepRole.run
  -> lifecycle guard：home、TTL、威胁、CPU tier
  -> assignment-service：验证/续租/分配紧凑任务
  -> role state machine：选择当前动作分支
  -> action helper：尝试一个主要 intent
  -> movement service：仅在 ERR_NOT_IN_RANGE 时移动
  -> result handler：更新状态、lease 或清理失效目标
~~~

#### 5.7.1 契约、任务和 Memory

角色调用签名为 `run(creep: Creep, ctx: TickContext): void`，ctx 已为必选参数（迁移已完成）。

~~~ts
type CreepMode = "acquire" | "work" | "idle" | "flee";
type TaskKind =
  | "harvest"
  | "haul"
  | "fill"
  | "upgrade"
  | "build"
  | "repair"
  | "reserve";

interface CreepAssignment {
  id: string;                  // 稳定任务 key，而非大对象
  kind: TaskKind;
  targetId?: string;
  sourceId?: string;
  revision: number;            // 房间计划修订号
  assignedAt: number;
  leaseUntil: number;
}

interface ManagedCreepMemory extends CreepMemory {
  home: string;
  mode: CreepMode;
  assignment?: CreepAssignment;
  lastPos?: number;            // packed x * 50 + y
  stuckTicks?: number;
}

interface CreepRole {
  readonly name: string;
  readonly priority: 0 | 1 | 2 | 3 | 4;
  run(creep: Creep, ctx: TickContext): void;
}
~~~

Memory 中不保存 path 字符串、Room 对象、Task 完整副本或搜索结果。assignment 只存 ID、少量 ID 引用、版本和 lease。任务详细信息由 room 的 BuildQueue、物流计划和本 tick 快照解析。

#### 5.7.2 任务分配、槽位和 lease

assignment-service 是房间系统的一部分，在 creep role 执行之前运行。它根据 RoomSnapshot、colony 状态、CPU tier 和当前人口计算可用任务；角色只请求已验证的任务。

任务分配规则：

1. **source 槽位显式化**：Spawn 为 miner/harvester 写入 sourceId；每个 source 的目标 work parts 与容器状态决定槽位数，禁止所有采集者竞争最近 source。
2. **物流任务确定性化**：hauler 读取 room logistics plan，按能量缺口、距离、creep 名称哈希或稳定序号分配 pickup/delivery；避免每个 hauler 自己找最近目标。
3. **建造/维修可限额**：BuildTask/RepairTask 带 maxWorkers 与 lease；同一小 site 在 early 阶段通常只分配一个 builder。
4. **短 lease，明确续约**：本地任务租约 15 至 30 tick；每次成功操作或仍满足条件才续约。lease 过期、revision 变化、目标失效、CPU Recovery 或威胁出现时立即释放。
5. **紧急抢占由系统完成**：P0 fill、flee 或 tower 填能可使普通 assignment 失效；角色不自行在不同战略之间争抢。
6. **无任务是合法状态**：角色进入 idle 或定义的回退行为，不进行无界搜索。idle creep 靠近 home 的低拥堵待命点。

为避免在 Memory 中维护昂贵的全局 claim 表，早期采用“每 creep assignment + 系统每房一次汇总”的方式计算占用。规模增长后再为高竞争任务增加小型 task owner 字段，不能预先引入复杂分布式锁。

#### 5.7.3 通用生命周期和状态机

每个角色先经过统一 guard：

1. 若 creep 没有 home 或 home 不可见，进入保守返回/待命；不向未知房间盲走。
2. 若存在 hostile 且角色非战斗单位，按 room defense policy 进入 flee，释放普通 lease。
3. 若 CPU 为 Recovery 且角色属于 P2 以上，执行角色定义的降级动作或 idle。
4. 验证 assignment 的 revision、lease、targetId、sourceId 和可达性；无效时清理并向 service 请求新任务。
5. 根据 store 为空/满以及任务阶段切换 mode。只有阈值翻转时写 Memory，不能每 tick 写相同状态。

所有角色共享以下有限状态，而不是为每个角色发明不兼容的布尔字段：

| mode | 进入条件 | 允许动作 | 离开条件 |
| --- | --- | --- | --- |
| acquire | 能量为空或任务需要资源 | harvest、withdraw、移动 | 背包满或资源不可用 |
| work | 有任务资源或角色无需资源 | transfer、build、upgrade、repair、harvest | 背包空、任务完成或失效 |
| idle | 无有效任务或等待 | 短暂待命、低成本回 home | 分配到任务或出现 P0 |
| flee | 威胁/撤退命令 | 仅移动到安全位置 | threat policy 解除 |

动作结果处理必须是显式表，而不是散落 if：

| 返回码 | 处理 |
| --- | --- |
| OK | 更新任务进度，续 lease，必要时切状态 |
| ERR_NOT_IN_RANGE | 交给 movement service，当前 tick 不再换目标 |
| ERR_NOT_ENOUGH_RESOURCES 或目标耗尽 | 清空对应 target，进入 acquire 或请求重分配 |
| ERR_FULL | 切到 work/delivery 或换明确下一目标 |
| ERR_INVALID_TARGET / ERR_NO_BODYPART | 释放 assignment，限流记录配置错误 |
| ERR_NO_PATH | 增加失败计数；一次受控重寻路后释放目标并回退 |

#### 5.7.4 角色实现蓝图

| 角色 | 主要 assignment | 状态机 | 必须回退 | 禁止事项 |
| --- | --- | --- | --- | --- |
| recovery worker | source + fill target | acquire 到 work | 直接填 spawn/extension | 等待大 body、建普通 road |
| harvester | 固定 source + 临时 delivery | harvest 到 deliver | 无 container 时直接送能 | 重新选最近 source |
| miner | 固定 source + container | mine | container 毁坏时切 harvester 模式 | 跨房找矿或自建 container |
| hauler | pickup + delivery 对 | acquire 到 work | 无 pickup 时优先关键 fill/idle | 每 tick findClosestByPath |
| upgrader | 能源 source + controller | acquire 到 work | Conserve 时限额，Recovery 时停工 | 抢占 P0 能源 |
| builder | BuildTask | acquire 到 work | fill -> critical repair -> upgrade -> idle | 创建 site 或扫描房间 |
| repairer | RepairTask | acquire 到 work | critical repair -> fill/idle | 修墙/rampart，除非防御任务 |
| scout/remote | route + target room | travel 到 observe/flee | Recovery 时撤回/停工 | 在本地能源紧张时继续远行 |

每一个角色必须把 role 专属策略限制在本文件定义的 assignment 范围内。公用行为，例如 move、清 target、错误限流、状态转移、home 返回，必须复用基础 helper。

#### 5.7.5 移动服务与路径预算

第一版优先封装原生 moveTo，而不是马上自写 PathFinder。只有遥测确认 moveTo 是热点，才引入 global 路径缓存；任何优化都必须可回退到原生路径。

~~~ts
function moveToTarget(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  options: MoveToOpts,
  ctx: TickContext,
): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET | ERR_NOT_FOUND {
  // 本地任务默认 maxRooms: 1，reusePath 自适应（近 3 / 中 5 / 远 15）
  // 目标、移动模式、房间道路修订组成缓存 key
  // 检测 lastPos；不因 ERR_TIRED 误判卡住
  // 连续 2 到 3 tick 未移动才尝试有限重算
  return creep.moveTo(target, options);
}
~~~

移动规则：

- 角色只在主动作返回 ERR_NOT_IN_RANGE 时调用移动，不在一个 tick 反复选目标和重算。
- 本地路径设置 maxRooms 为 1（CONFIG.movement.localMaxRooms，配置化以便 remote 角色未来经 route/waypoint 跨房而不动内核）；远程路径由 route/remote 插件低频预计算，角色只消费 route waypoint。
- PathFinder 仅可由 movement service 或低频 planner 调用，并有 maxOps、maxRooms、缓存 key 和失败冷却；禁止 role 直接调用。
- 缓存 key 包含目标、移动类型、room 路网 revision；道路或关键阻塞变化后递增 revision 使旧缓存自然失效。
- creep Memory 仅保存 packed lastPos、stuckTicks 和短 pathKey；完整路径放 global。global reset 后回退一次原生 moveTo。
- 停滞时先等待一个 tick或调整优先级，再有限重寻路；连续失败进入 idle/flee，不能持续消耗 CPU。

Traffic Manager（意图集中解算，`CONFIG.movement.trafficManager` 开关）：

- 开启时 movement 层所有移动出口不直发引擎指令，改为把「本 tick 想走哪一格」登记到 per-tick 意图账本（`creeps/movement/intent.ts`）；站桩矿工/等 boost/站桩 upgrader 登记「锚定」声明拒绝被推挤（同 tick 存在移动意图时锚自动失效）。
- 所有 creep 角色执行完毕后，`traffic-manager` 后置系统（System.phase = "post"，kernel 在 runCreeps 之后运行 post 阶段，复用同一 budget/safeRun 管线）按房调用纯函数解算器（`traffic-resolver.ts`）：同格仲裁（高优先级胜）→ 跟车放行 → 对向换位 → 推挤静止者（链深上限 2，落格复用 parking 的关键格/road 口径）→ 疲劳与敌方 creep 视为硬墙；解算后统一签发 `creep.move` 并记录交通热度。
- 移动优先级表在 `CONFIG.movement.trafficPriority`：flee 100 > 站桩矿工锚 90 > work/站桩锚 60 > acquire 40 > 通勤 30 > parked 0。
- 开启期间旧 yield/pull 让路机制与前置绕路检测短路禁用（双仲裁并存会互相打架）；stuckTicks/Level-3 弃标保留为不可达目标安全网。关闭开关即整体回退旧行为（登记函数直通引擎 move），是唯一回滚通道。

#### 5.7.6 Creep 实施顺序与验收

| 步骤 | 前置 | 实施内容 | 验收 |
| --- | --- | --- | --- |
| C1 公共类型 | M2 | TickContext、RoomSnapshot、CreepMode、assignment 类型 | 类型检查通过，旧 harvester 可经兼容适配运行 |
| C2 生命周期 helper | C1 | home/威胁/CPU guard、状态转换、target 清理、动作返回码表 | 目标失效和低 CPU 不会抛错或刷日志 |
| C3 assignment-service | C1、RoomSnapshot | source 槽位、fill、建造任务的每房汇总与 lease | 同一 source/site 不发生超额分配 |
| C4 harvester/worker 重构 | C2、C3、Spawn Manager | 固定 source、混合送能、container 迁移、恢复回退 | 全员死亡后的第一 creep 可重建经济闭环 |
| C5 hauler/upgrader | C3、C4 | logistics plan、保级配额、CPU 限额 | spawn 持续被填能，控制器不因普通建造降级 |
| C6 builder/repairer | C3、BuildQueue | BuildTask lease、回退序列、critical repair | 空队列或 Recovery 时不会空转/抢能源 |
| C7 movement service | C2 至 C6 | 原生 moveTo 封装、卡位检测、路径遥测 | 无路径或 global reset 时能安全回退，CPU 有界 |

角色测试应至少覆盖：满/空切换、目标消失、source 暂时耗尽、目标满、无路径、卡位、assignment 过期、revision 变化、威胁、低 bucket、TTL 替换和 global reset。每个测试断言角色只产生允许的动作或移动，且不会调用未授权的全房搜索。

## 6. 开发阶段与里程碑

估时按一名熟悉 TypeScript 与 Screeps 的开发者的有效工作日估算。并行表示接口冻结后可由不同人推进，不能绕过前置依赖。

| 优先级 | 阶段与依赖 | 估时 | 可并行 | 验收标准 |
| --- | --- | ---: | --- | --- |
| P0 | M0 工程基线；无前置 | 0.5 至 1 天 | mock 基础、目录规范、README | build、typecheck、test 全绿；构建可上传为 main |
| P0 | M1 内核与扩展契约；依赖 M0 | 2 至 3 天 | 迁移测试、插件契约、遥测 | 系统或单 creep 报错不阻塞其他任务；迁移重复执行一致；只修改 bootstrap 即可新增插件 |
| P0 | M2 看门狗、TickContext、房间快照；依赖 M1 | 2 至 3 天 | budget 单测、快照缓存 | 四种 bucket 下正确跳过任务；单房核心循环目标低于 12 CPU |
| P0 | M3 紧急恢复、harvester、Spawn 队列；依赖 M2 | 3 至 4 天 | body builder、队列测试、角色实现 | 清空 creep 后有 200 能量可自动恢复采能和 spawn 供能；无重复请求 |
| P1 | M4 hauler、upgrader、替换与需求配额；依赖 M3 | 3 天 | 各角色状态机和测试 | RCL2 连续运行，source、配送、保级的优先级正确，关键角色不发生断代 |
| P1 | M5 建造/维修队列与 RCL2 至 RCL4；依赖 M3，建议与 M4 并行实现 | 3 至 4 天 | builder FSM、建造纯函数、规划器 | container、extension、tower、storage 顺序正确；site 限流；低 CPU 自动冻结发展 |
| P1 | M6 压测、可观测性与回归；依赖 M4、M5 | 2 至 3 天 | dry tick、故障注入、文档 | 500 至 1,000 mock tick 无未捕获错误或无界 Memory；低 bucket 保留生存链 |
| P2 | M7 多房、侦察、远矿；依赖 M6 | 5 至 7 天 | 侦察、remote logistics、风险模型 | 单房故障不拖垮其他房；Recovery 自动收缩远程业务 |
| P2 | M8 链接、塔防、市场和扩张；依赖 M7 | 迭代 | 独立插件可并行 | 每项满足注册、预算、迁移、测试、回滚清单 |

依赖关系：

~~~
M0 -> M1 -> M2 -> M3 -> M4 -> M6 -> M7 -> M8
                       \-> M5 --/

M1 后可并行：迁移测试、插件契约、telemetry。
M3 后可并行：body/Spawn 队列、角色状态机、builder FSM、建造规划。
M4 与 M5 可并行实现；两者均完成后才宣称 RCL2 至 RCL4 稳定闭环。
~~~

## 7. 性能优化指南

### 必做规则

1. 每房每 tick 只构建一次快照，集中所有 find；角色消费快照或缓存 ID。
2. 本地物流使用稳定目标、reusePath 和 global 短缓存；目标变更、TTL 过期、连续卡位才重寻路。
3. 大型工作按房轮询，例如 roomIndex 对 interval 取模，不让所有房间同 tick 做规划。
4. 所有缓存有 TTL 和失效条件。无 TTL 的缓存最终会变成逻辑错误和 CPU 洞。
5. Memory 只存 ID、枚举、少量数字和短 key；采样统计使用有界环形数组或聚合值。
6. bucket 不健康时减少工作，不通过更激进计算修复 CPU；远矿、道路、市场和复杂 planner 使用 feature flag。
7. 测量后优化：采样记录模块 CPU 和缓存命中，优先处理 top 3 热点。

### 初始阈值

| 项目 | 初始规则 |
| --- | --- |
| 常态 CPU 目标 | 不超过 12 CPU |
| Healthy 软截止 | 17.5 CPU |
| Guarded / Conserve / Recovery 软截止 | 16 / 14 / 12 CPU |
| active normal site | 每房 2 个，另允许 1 个 critical |
| creep Memory 清理 | 小帝国每 tick；扩张后每 10 tick 增量 |
| 非关键房间决策 | 每房 5 至 25 tick，随 bucket 调整 |
| 路径缓存 | global 短 TTL；global reset 可安全重建 |
| 相同错误日志 | 每 label 至少间隔 25 tick |

所有阈值是待验证默认值。每次调整应记录调整前指标、调整后指标和回退条件。

## 8. 测试策略

### 单元测试范围

| 模块 | 必测场景 |
| --- | --- |
| Registry 与 Kernel | 唯一性、排序、错误隔离、hard stop、优先级跳过 |
| Memory | 空 Memory、旧版本、重复迁移、cursor、中断恢复 |
| Scheduler | 四档 bucket、不同已用 CPU、P0 不被普通任务阻塞 |
| SpawnQueue | key 去重、P0 压过 P4、body 降级、能量不足、TTL 替补、spawn 忙碌 |
| 角色状态机 | 背包满/空、目标失效、无目标待命、低 CPU 回退 |
| 建造维修 | RCL 优先级、site 上限、无效位置、低 CPU 暂停、关键 site 优先 |
| 纯领域层 | body 生成、需求配额、路径 key/TTL、队列排序 |

### 模拟方案

- 以 Vitest factory 创建最小 Game、Memory、Creep、Room、StructureSpawn mock，只模拟模块实际使用的 API。
- Game.cpu.getUsed 使用可控序列，验证在系统和 creep 边界立即降级。
- 建立 fixtures：rcl1-recovery、rcl2-steady、rcl3-low-bucket、global-reset、migration-vN。
- 每个里程碑在私服或官服低风险房 smoke test，记录至少 100 tick CPU 采样。
- M6 后提供 dry tick 集成测试，连续运行 500 至 1,000 tick，验证 Memory、队列、错误环和跳过数都有上限。

### 质量门槛

- 合并前执行 npm run typecheck、npm test、npm run build。
- 每个新插件至少具备注册、正常路径、低 CPU 降级、失效数据或异常四类测试。
- 新增 Memory 字段必须同时更新类型、迁移与本计划。

## 9. 风险与应对措施

| 风险 | 信号 | 应对 |
| --- | --- | --- |
| CPU 死亡螺旋 | 连续 10 tick Conserve/Recovery，bucket 下降 | 强制暂停发展和远程；只留 P0/P1；检查 telemetry 热点 |
| 全员死亡 / spawn 断能 | 没有 P0 creep，spawn 长期无能量 | P0 恢复 body 最高优先；提前替补最后采集者；禁止发展角色抢能源 |
| 集体寿终 | 同类 TTL 集中 | replaceBy 预孵化和生成错峰 |
| Memory 膨胀或迁移损坏 | 体积增长或 schema 卡住 | 小型字段、cursor 清理、幂等迁移、成功后才升级版本 |
| 路径和扫描尖峰 | CPU 突刺，多次 find/PathFinder | 快照、global 缓存、分房轮询、按 tier 跳过 |
| 建造挤占经济 | spawn 等能量，builder 长期活跃 | site 上限、紧急能量地板、builder 只从盈余产生 |
| 远程扩张拖垮本土 | bucket 低、本房断能、敌袭 | remote feature flag、撤回 home、先守 P0/P1 |
| 错误风暴 | 同错误连续出现 | 错误签名限频、非关键插件冷却、有界错误环 |
| global reset | 路径和索引消失 | 所有 global 缓存可从 Game/Memory 惰性重建 |

### 9.1 边界场景清单

下列场景必须在设计、单元测试或官服 smoke test 中覆盖。原则是：先让状态恢复到可解释、可继续执行的最小闭环，再谈最优策略；不能因为一个异常输入使本 tick 或整房停摆。

| 类别 | 边界场景 | 预期行为 / 降级策略 | 验证方式 |
| --- | --- | --- | --- |
| CPU | Game.cpu.tickLimit 临时低于 20 | 预算以 limit 和 tickLimit 的较小值计算，立即切换更低 tier | mock 不同 tickLimit，断言 P3/P4 被跳过 |
| CPU | 单个系统或 creep 的耗时突刺 | 当前工作完成后熔断后续低优先级任务；记录模块 CPU 摘要 | 人工增加 getUsed 序列，验证 hard stop 前停止 |
| CPU | bucket 在阈值附近反复波动 | 降级立即生效，恢复须满足滞回条件，避免任务一开一关 | 连续输入 900/1,100/900 等 bucket 序列 |
| CPU | global reset 后缓存全部消失 | 重建必要 global 索引；只多花有限初始化成本，不依赖缓存正确性 | 清空 global 后连续运行多个 dry tick |
| Memory | 根 Memory 为空、字段部分缺失或类型错误 | 初始化安全默认值；不假设 rooms、creeps、队列必定存在 | 空对象和畸形 fixture |
| Memory | 迁移运行中 server 重启或代码回滚 | cursor 可重复执行；未完成前不提升 schemaVersion；旧字段仍可读 | 在迁移中途重启 fixture |
| Memory | 大量死亡 creep 或旧远矿数据残留 | 分批清理且有上限，不在一个 tick 全量 delete | 上千条旧记录 + CPU 受限 mock |
| Memory | CreepMemory 的 role 已被删除或改名 | 限流记录未知 role；将 creep 置为安全待命或兼容映射，后续迁移清理 | 旧 role fixture |
| Spawn | 没有 creep，且 spawn 终于积累到 200 能量 | P0 立即生成 [WORK,CARRY,MOVE]；所有非 P0 请求暂停 | 冷启动和全员死亡 fixture |
| Spawn | 没有 creep，且 spawn 无法获得 200 能量 | 报告不可自救状态；不浪费 CPU 创建无效请求；依赖提前替补预防 | 0 能量、无资源输入 smoke case |
| Spawn | spawn 正在孵化低优先级 creep 时出现 P0 缺口 | 不常规取消当前孵化；记录最晚恢复时间，现有角色优先送能，孵化完成后立即补 P0 | busy spawn + P0 请求 fixture |
| Spawn | P0 body 不满足当前 energyAvailable，但容量足够 | P0 使用最小合法降级 body；普通请求等待或过期 | 200、300、550 等能量档位测试 |
| Spawn | 同一 source 的多个请求在多 tick 重复创建 | 根据稳定 key 合并，计入 spawning 与已提交请求 | 连续 50 tick 运行队列断言长度有界 |
| Spawn | 关键 creep 即将死亡，但 spawn 队列被普通角色占据 | 替换请求在 replaceBy 前提升优先级；普通请求不能侵占其最晚开工窗口 | TTL 和长 body 组合测试 |
| Creep | targetId 指向已拆除、耗尽或敌占目标 | 清空 target 和 assignment，回到房间服务分配或安全待命 | 目标从 mock 中移除 |
| Creep | creep 满背包但所有交付结构已满 | 不反复 findClosestByPath；短暂待命或按明确溢出策略转交容器 | 所有 spawn/extension 满的 fixture |
| Creep | creep 空背包但 source 暂无 active energy | 保留 source 绑定并有限频重试，不扫全房；有替代策略时由系统分配 | source regen 前状态测试 |
| Creep | 多个 creep 争抢同一 source、container 或 construction site | 房间服务分配槽位/任务；角色不得各自重新抢最近目标 | 两个以上同角色竞争 fixture |
| Creep | 连续卡位、边界抖动或跨房出口不可达 | 记录卡位计数，2 至 3 tick 后有限次重寻路；随后回退/撤退，不无限搜索 | blocker 与无路径 mock |
| Creep | builder、upgrader 在 Recovery 模式仍有任务 | 立即停止发展性动作，回退为关键送能或待命 | 低 bucket 状态机测试 |
| 建造 | RCL 不足、地形冲突、site 已存在或达到 site 上限 | 将请求标记失败原因并退避/删除；不能每 tick createConstructionSite | 对应 API 返回码 fixture |
| 建造 | builder 已生成但队列为空 | 回退为填能、关键维修、升级；禁止无目标移动 | 空 BuildQueue fixture |
| 建造 | 新房升级后一次出现大量可建项目 | 仅创建队首且满足依赖的少数 site；规划分 tick 进行 | RCL 升级后队列长度和 site 上限断言 |
| 建造 | 关键 container 被拆或毁坏 | 暂时回到混合 harvester 直接送能策略，重建请求升为 critical | container 丢失 + hauler 存活 fixture |
| 可见性 | home 房或 remote 房暂时不可见 | 不删除长期意图；本地 creep 回家/待命，remote 任务延后而非盲走 | Game.rooms 缺失 fixture |
| 可见性 | controller、source 或结构因敌对/权限变化不可用 | 任务失效，停止对应角色；不向无权限目标反复发 intent | 控制权切换 mock |
| 防御 | 出现 hostiles 且 bucket 很低 | P0 威胁检查和 tower 仍运行；builder/远矿等立即停工 | hostile + Recovery fixture |
| 防御 | tower 无能量而普通 builder 正在消耗能量 | 调整为塔/Spawn 填能优先，冻结普通建造 | tower 能量不足场景 |
| 经济 | storage/容器满、资源无处可放 | 停止或限速采集，避免掉落资源和无效搬运；生成消费/转运任务 | 满仓 fixture |
| 经济 | source 一侧矿工死亡而 hauler 仍在运行 | hauler 清空无效 assignment 后转为关键送能或待命，Spawn 优先补 miner | miner 死亡 fixture |
| 多房 | 一个房间的规划或迁移异常 | 错误隔离到房间，其他房和全局 P0 继续运行 | 两房，单房抛错 fixture |
| 外部状态 | 新代码部署后角色 body、配置或 Memory 语义变更 | migration + feature flag 逐步启用；保留兼容读取和回退配置 | 从前一 schema 升级 smoke test |
| 战争 | war 姿态下经济压力持续超标（消耗战信号） | 压力计数达 warExitPatienceTicks → 立即降 fortify（不等驻留期）；压力恢复计数清零 | posture 单测（连续超标序列 + 恢复序列） |
| 战争 | 消耗战：spawned 超编队 × casualtyMultiplier | war-planner 收摊 + 目标黑名单冷却，换目标重打 | war-planner 止损用例 |
| 战争 | 战后情报过期 / 塔网未破 / 敌主仍在 | 核验 unknown/failure → 黑名单；success（塔清零/弃房）免黑名单 | evaluateWarOutcome 纯函数用例 |
| 战争 | 波次被打残（live < squadSize × regroupRatio） | advance 回落 build，幸存者归建，补满编再推进 | nextWavePhase 迟滞用例 |
| 战争 | 集结中的攻击者被导航直送目标（添油路径） | hold 钩子在 ensureHome 之前接管：home 停驻 / 在外归建 | attackerHold 决策矩阵用例 |

边界场景增加规则：

- 每一项新增的“可持久化状态”至少补充一个缺失、过期和跨版本的场景。
- 每一项新增角色至少补充目标失效、无资源、无路、低 CPU、即将死亡五类场景。
- 每一个会调用 createConstructionSite 或 spawnCreep 的分支必须覆盖幂等、忙碌、资源不足和权限/上限失败。
- 不能用日志替代恢复：日志仅辅助诊断，业务逻辑必须有明确的安全状态或队列回退。

## 10. 文档与运维规范

### 配置和模块文档

- config 是 CPU、角色人数、body、并发建造和功能开关的唯一入口。
- 每个系统说明职责、输入输出、priority、间隔、Memory 字段、CPU 成本和降级行为。
- 每个角色说明前置条件、状态机、目标选择、body、替换和撤退策略。
- 每个持久化字段标注 schema 版本；每个高成本操作注明缓存与上限。

### 运行手册

- 每次部署检查 bucket、错误摘要、Spawn 队列、Memory 体积、模块 CPU 采样。
- 每周复盘 P95/P99 CPU、降级次数、替补成功率、队列等待时间；仅依据数据调阈值。
- 先在低风险房运行 100 至 500 tick，再推广；保留前一构建和可回退配置。
- 迁移、Spawn 策略和路径规划变更必须附 dry tick 用例与手动回退步骤。

### plan.md 更新节奏

1. 每个里程碑开始前，更新实际范围、依赖和验收标准。
2. 每个里程碑完成后，记录完成状态、真实耗时、CPU 指标和偏差。
3. schema、CPU tier、Spawn 优先级或功能开关改变时，同一提交更新本文件。
4. 至少每两周复核一次风险表、非目标和 20 CPU 阈值，删除失效假设。

## 11. 首次实施清单

1. 将现有 Kernel 扩展为 P0 至 P4 分级调度，并实现四档 bucket 看门狗与滞回。
2. 增加 TickContext 与 RoomSnapshot，替换 harvester 的每 tick 路径式 source 搜索。
3. 实现 Spawn Manager 的 P0 恢复 worker、请求去重、body 降级和提前替补。
4. 完成 harvester/worker 状态机和测试，再引入 hauler 与保级 upgrader。
5. 实现严格限流的 construction-manager，先覆盖 RCL2 container/extension，再覆盖 RCL3 tower 和 RCL4 storage。
6. 完成 500 tick dry simulation 和官服 smoke test。只有 CPU、恢复和无界 Memory 验收通过后，才开始远矿或多房。

## 12. 二期实施清单（M7-M8 完成状态）

首次实施清单（§11）已全部完成。以下记录 M7-M8 阶段的实际完成情况：

### 已完成

| 功能 | 实现文件 | 说明 |
| --- | --- | --- |
| Link 能量传输 | `systems/link-system.ts` + `domain/economy/links.ts` | source→controller/storage 瞬移，替代 hauler 往返 |
| Lab 反应 + boost | `systems/lab-system.ts` + `domain/industry/` | 化合物生产、creep 强化 |
| Tower 防御 | `systems/tower-defense.ts` + `domain/defense/` | 攻击、维修、safe mode、集火逻辑 |
| 防御布局规划 | `systems/defense-planner.ts` + `domain/layout/min-cut-defense.ts` | 最小割 rampart 覆盖 |
| 约束推导布局 | `domain/layout/constraint-placer.ts` | Distance Transform + 约束推导，替代纯模板 |
| Pixel 生成 | `systems/pixel-system.ts` | bucket 满载时生成 pixel |
| 遥测系统 | `systems/telemetry-collector.ts` + `kernel/timeseries.ts` + `kernel/event-log.ts` | CPU/经济时序采样、事件日志 |
| 参数自调优 | `systems/tuning-engine.ts` + `domain/tuning/` + `config/tuned.ts` | 遥测驱动角色边界调整 |
| ColonyPhase 迟滞 | `domain/economy/phase.ts` + `systems/room-state.ts` | 殖民相位状态机，防止频繁切换 |
| economyPressure 梯度 | `systems/room-state.ts` → `RoomMemory.economyPressure` | 0.0-1.0 梯度信号，替代二值开关 |
| 回收通道 | `domain/spawn/recycle.ts` + `systems/spawn-manager.ts` | 废弃角色/富余 worker 回收 |
| 邻居情报 | `systems/room-observer.ts` → `RoomMemory.intel` | 出口/房态/SK 分类 |
| RawMemory segment | `kernel/segment-store.ts` | layout 冷数据外迁，减少 Memory 体积 |
| 声明式角色引擎 | `creeps/engine/` | RolePolicy + Action-Candidate，新增角色只需声明 policy |
| 移动系统重构 | `creeps/movement/` | 路径持久化、走廊共享、跨房间缓存、卡位恢复 |
| 远矿运营 | `systems/remote-mining-manager.ts` + `domain/remote/` + `creeps/roles/remote-*.ts` | 目标评选、remoteOps 生命周期、远矿角色（remoteHarvester/remoteHauler/reserver）跨房作业，详见 §12.1 |

### 架构演进记录

1. **防御系统拆分**：原 `defense.ts` 拆分为 `tower-defense.ts`（P0 攻击/维修）+ `defense-planner.ts`（P3 布局）+ `domain/defense/`（纯逻辑），优先级分离更合理。
2. **布局双模式**：从纯模板演化为 constraint（默认）+ template（回退），适应不同地形。
3. **梯度信号**：economyPressure 取代二值 crisis/normal，各子系统平滑缩放避免抖动。
4. **声明式角色**：从独立状态机演化为 RolePolicy 声明式引擎，新增角色无需复制生命周期代码。
5. **升级功率控制**：从固定数量梯度改为 storage 水位 + RCL8 限速 + 大 body 站桩。
6. **参数自调优**：tuning-engine 基于遥测数据自动调整角色边界，系统自适应不同房间/经济状态。
7. **远矿威胁检测前置**：role-runner 管线将威胁检测重排到 `ensureHome` 导航之前。远矿角色在过境中间房遇袭时，`ensureHome` 会短路导航（返回 false 提前 return），威胁检测若在其后则永不触发——故必须先检测威胁再导航（详见 §12.1）。

首个版本的成功标准不是扩张速度，而是在 global reset、低 bucket、单模块异常和全员死亡边缘时，始终先守住采能、孵化、供能、保级的最小闭环，并把扩张安全地降级。

### 12.1 远矿运营架构（Remote Mining）

远矿运营已实现（`remote-mining-manager.ts` + `domain/remote/` + `creeps/roles/remote-*.ts`），schema v10。本节记录其 Memory 结构与关键架构决策。

#### 基础约束：快照仅覆盖自有房

`kernel.buildSnapshots` 仅为 `controller.my` 的房间构建 `RoomSnapshot`（`kernel.ts` 的 `if (!room.controller?.my) continue`）。**远矿房无快照**——这是整个远矿架构的根本约束，决定了：

- 远矿角色在远矿房**绕过快照**，直接读 `Game.rooms[...]` / `creep.room.find(...)`。
- 威胁检测在外部房间直接扫 `Game.rooms`（`shouldFleeForeignRoom`），不依赖快照。
- `role-runner` 始终按 `creep.memory.home`（自有房）取快照，远矿角色只在 home 房消费快照（如 remoteHauler 回 home 存能）。

#### home / remoteTarget 二元分离

| 字段 | 归属 | 含义 | 写入方 |
| --- | --- | --- | --- |
| `CreepMemory.home` | `CreepMemory` | 孵化房 / 服务房（恒为自有房，必有快照） | spawn 时由 `createRequest` / `createRemoteRequest` 显式写入 |
| `CreepMemory.remoteTarget` | `CreepMemory` | 远矿作业房（无快照） | `createRemoteRequest` 写入 |

**没有任何角色把 `home` 设为非孵化房。** `ensureHome` 的 `home = creep.room.name` 回退仅在 `home` 缺失时触发（正常孵化的 creep 不会走到）。远矿 creep 的物理位置与 `home` 解耦：它可能站在 `remoteTarget` 或过境中间房，但 `home` 始终指向孵化房。

#### Memory 结构

```ts
// RoomMemory.remoteOps — 从本房管理的远程采矿运营，key = 目标房名。
// 由 remote-mining-manager 每 10 tick 评估/更新。遵循 Memory 规范：短字段、有界。
interface RemoteOp {
  state: "scout" | "active" | "paused" | "abandoned";  // 运营生命周期
  sources?: number;     // 源数量（有视野时记录）
  haulerNeed?: number;  // 动态 hauler 编制（评选期按通勤成本算出，1-haulersMax）
  createdAt: number;    // 创建 tick
  lastSeen: number;     // 最近可见 tick（creep 进入或 observer 扫描时更新）
}
```

生命周期：`active`（采集中）→ 超期无 creep → `paused`（暂停）→ 长期废弃 → `abandoned` → 超过 `staleThreshold × 6` 从 Memory 删除（防膨胀）。`paused` 期间有新视野/creep 到达则恢复 `active`。

#### 性价比评选与容量感知（远矿 2.0）

评选从「数 source」升级为**净收益评分**（`domain/remote/targeting.ts`）：

```
pathCost   = intel.pathCost ?? roomLinearDistance × 70   // room-observer 逐 tick 补算，PathFinder swampCost:5 计入沼泽
demand     = sources × 10                                // reserve 后单 source 10 e/tick
perHauler  = haulerCapacity / (2 × pathCost)             // 单只往返运力
haulerNeed = clamp(ceil(demand / perHauler), 1, haulersMax)
throughput = min(demand, haulerNeed × perHauler)
netScore   = throughput − (0.4×sources + 0.4×haulerNeed + 2.2)  // 减编队摊销（reserver 2.2 最贵）
```

- `netScore < minNetScore(3)` 的候选**剔除**（沼泽/超远房占名额比空置更亏）；排序按 netScore 降序 > 有视野 > 房名字母序。
- `intel.pathCost`（`domain/intel.ts`）：home 锚点（storage 优先，无则 spawn）到邻房中心 range 15 的 PathFinder 实测成本，地形静态一次性缓存，room-observer 每次 intel 刷新至多补算 1 个（分摊 CPU），刷新不冲掉（与 dangerUntil 同待遇）。
- **动态 hauler 编制**：评选算出的 `haulerNeed` 写入 `RemoteOp`，`demand.ts` 消费（缺失回退 `haulersPerTarget=1`，存量运营兼容）。
- **无 storage 开点节流**：`effectiveMaxOperations(hasStorage)` — 无 storage 时开点上限收缩为 `maxOperationsNoStorage(1)`，本房 sink（≈4300 容量）消化有限防背压空转；storage 建成自动放开到 `maxOperations(2)`。现役运营不砍。
- **跨房去重**：`globalActiveTargets`（manager 汇总全帝国非 abandoned 目标）传入评选，防双主房抢同一 source（双编队收益不变成本翻倍）。

#### 威胁检测（transit 盲区修复）

`role-runner` 管线顺序：**威胁检测先于 `ensureHome` 导航**。

```
getSnapshot(home) → recycle 检查 → 威胁检测 → ensureHome 导航 → updateMode → ...
```

- **外部房间**（`creep.room.name !== home`，含 remoteTarget 与过境中间房）：`shouldFleeForeignRoom(creep)` 直接扫 `Game.rooms[当前房]` 的 hostile（带攻击部件 + 非联盟白名单），per-tick per-room 缓存（`__remoteThreats`）。触发则 `fleeToHome`（释放 assignment + `moveTowardRoom(home)`）。
- **home 房**：`shouldFlee(creep, snapshot)` 用 home 快照的 `threatCreeps`，触发则 `flee`（塔防/出口策略）。

**为何必须前置**：远矿角色在过境中间房时，`ensureHome` 会调用 `moveTowardRoom` 并返回 false（未达目的地），role-runner 提前 return。若威胁检测排在 `ensureHome` 之后，过境 creep 永远轮不到威胁检测——遇袭不逃跑。生存优先于导航，故威胁检测前置。

#### ensureHome 远程导航规则

`remoteTarget` 存在时，按 mode 决定导航目的地：

| mode | 目的地 | 说明 |
| --- | --- | --- |
| `idle` / `flee` | home | 回安全区 |
| `work`（仅 remoteHauler） | home | 回 home 存能 |
| 其余（acquire/work） | remoteTarget | 去远矿作业 |

到达目的地返回 true（进入候选评估），否则 `moveTowardRoom` 并返回 false（本 tick 仅移动）。

#### 孵化与计数归属

- `collectCreepSummaries`：`home = memory.home ?? room.name`。远矿 creep 的 `home` 由 `createRemoteRequest` 显式设为孵化房。
- `countCreepsByRole`：按 `home` + 角色名过滤。远矿角色名（`remoteHarvester` / `remoteHauler` / `reserver`）与本地角色名（`harvester` / `hauler`）**不冲突**，远矿 creep 不会虚增本地角色计数。
- `recyclePass` / `creepsByRoom`：按 `home` 索引，远矿 creep 在其孵化房的回收轮次处理；远矿角色在 `CONFIG.roles`（非废弃），且富余回收规则只针对 `worker`，远矿 creep 不会被误回收。
- 远矿需求由 `remote-mining-manager`（P2，每 10 tick）按 `remoteTarget` 独立评估（`evaluateRemoteDemand`），不走本地任务池。

#### 安全门禁

- RCL ≥ `CONFIG.remote.minRcl` 才启动远矿。
- `colonyState !== "normal"` 暂停新远矿孵化。
- CPU tier conserve 以下不孵化远矿。
- 远矿目标数 ≤ `CONFIG.remote.maxOperations`。
- 远矿 creep 必须有 TTL 与撤退条件；`recovery` 时经 `ensureHome`（flee→home）撤回（约束 R5-05 / R8-06）。

### 12.2 扩张系统架构（Expansion，schema v11）

扩张已实现（`expansion-manager.ts` + `domain/expansion/evaluator.ts` + `creeps/roles/claimer.ts`）。

#### Memory 结构（v11 新增，均为 `Memory.kernel` 下可选字段）

| 字段 | 含义 | 生命周期 |
| --- | --- | --- |
| `kernel.expansion` | 当前扩张行动状态机（`claiming` → `pioneering`），同一时刻至多一个 | 行动结束/中止即清除 |
| `kernel.expansionBlacklist` | 失败目标冷却表（房名 → 到期 tick） | 到期由 pruneBlacklist 清除 |
| `kernel.lostRooms` | 失守房间首次检测 tick | 重新拥有或条目清除时移除 |

迁移 v10→v11 仅做畸形数据自愈（字段惰性创建，幂等）。

#### 关键架构决策

- **殖民复用灾后恢复机器**：占领成功后只写入 `layout.anchor`（约束推导：distance field + `selectAnchors`），
  其余交给既有链路 — layout-planner 的 spawn 重建路径推 P0 任务 → construction-manager 紧急豁免建 site →
  拓荒 builder 建造 → spawn 建成后新房 demand/bootstrap 闭环自治。不新建第二条建造管线。
- **claim 禁止盲选**：候选必须有过视野（intel.sources 已知）。与远矿的盲选自举刻意不同 —
  远矿失败损失一只 creep，扩张失败损失一个 GCL 窗口。
- **sponsor 代孵不污染本房预算**：拓荒请求 `home` 指向新房、寄宿 sponsor 队列，
  `countPending` 的 home 过滤（demand 全部调用点）将其排除在 sponsor 人口预算之外。
- **失守清理带宽限期**：`maintainMemory` 对不在拥有集合的 `Memory.rooms` 条目记录失守 tick，
  20000 tick 宽限后连同 tuning 覆盖值一并清除 — 防边界抖动误删，也防失守房数据慢性泄漏。

### 12.3 威胁情报与防御姿态（schema v12）

Phase 4 防御切片已实现（boost 映射修正 + defender boost + 威胁情报 + 动态墙体）。

#### Memory 结构（v12 新增，均为可选字段，惰性写入）

| 字段 | 含义 | 写入方 | 消费方 |
| --- | --- | --- | --- |
| `RoomMemory.lastHostileAt` | 最近一次房内出现威胁的 tick（受袭记忆） | room-state（每 tick） | getWallTargetHits 的受袭升档（tower-defense / repairFortifications） |
| `RoomIntel.towers` | 邻房敌方 tower 数 | room-observer（有视野时） | expansion evaluator（有塔房不 claim） |
| `RoomIntel.dangerUntil` | 危险冷却到期 tick | remote-mining-manager（远矿房出现威胁时） | selectRemoteTargets / expansion evaluator（冷却期内不选） |

迁移 v11→v12 仅做畸形数据自愈（幂等）。

#### 关键决策

- **boost 化合物映射与引擎对齐**：BOOST_EFFECTS 原表半数线路错位（UH 线是 attack 而非 harvest、
  ZH 线是 dismantle 而非 attack 等），roleBoosts 的 harvester 因此指向攻击强化 — 已全表按引擎
  BOOSTS 常量修正；defender 接入 XUH2O（attack ×4），boost 优先级防御最高。
- **boost 报到只在备料就位后触发**（ready 标记）：creep 在 lab 旁等 supplyLabs 搬运是浪费，
  对 defender 这类威胁窗口角色等待即战力真空。
- **危险标记跨刷新存活**：scanNeighborIntel 增加 prev 参数 — dangerUntil 由威胁事件独立管理，
  常规情报刷新不得冲掉；无视野刷新不再前移 lastSeen（视野新鲜度语义修正）。
- **防御深度用真实威胁校准**：墙体目标血量平时按 RCL 分级，受袭记忆窗口（10000 tick）内 ×5 —
  和平期修墙的能量就是少升的 RCL。
- **进攻编队明确押后**：无第二房间与 boost 生产线支撑前，进攻是负期望投资（战争即经济）。

### 12.4 帝国姿态层（Empire Strategy，schema v13）

Strategy 层已实现（`empire-strategy.ts` + `domain/strategy/posture.ts`）— 补齐 6 层模型中
此前缺位的战略层：「何时扩张 / 何时收缩 / 何时备战」由统一姿态状态机裁决，
执行系统只消费指令，功能上线不再等于行为开启。

#### Memory 结构（v13 新增）

`Memory.kernel.strategy = { posture, since, expansionAllowed, newRemoteOpsAllowed }`
— empire-strategy 每 tick 重建（reset 安全），迁移仅畸形自愈。

#### 姿态状态机

| 姿态 | 进入条件 | 指令效果 |
| --- | --- | --- |
| develop（默认） | 兜底 | 不扩张；允许新远矿点 |
| expand | GCL 余量 + 全房 normal + bucket≥7000 + 平均压力≤0.4 | 允许扩张与新远矿点 |
| fortify | 任一房近期受袭（**立即生效，紧急旁路**） | 关停扩张与新远矿点 |
| war | fortify 持续超耐心窗口（5000 tick）且敌情未消且平均压力≤0.4 | 同 fortify；未来进攻执行器的唯一授权来源 |

降级（fortify/war → develop）需静默 + 最短驻留期 1000 tick（滞回防抖）；
war 回落不直接跳 expand，先经 develop 确认经济节奏。

#### 关键决策

- **执行器不得自行裁决战略**：expansion-manager 的「是否开启新行动」、remote-mining-manager
  的「是否铺新点」均改为消费姿态指令；局部安全门禁（RCL/bucket）只能收紧不能放宽。
- **进行中的行动不因姿态回落中断**：claimer/拓荒编队是沉没投资，半途而废比完成更贵。
- **war 的授权来自证据链**（持续被打 + 打得起），与进攻代码是否存在无关 —
  进攻执行器必须从此姿态取授权，禁止「代码写完即开战」。R3 已接线 war-planner
  作为唯一进攻执行决策者（姿态消费 + 编队孵化 + 收摊）；R4 战争自治升级
  （波次集结 / 战损止损 / 战后核验 / war 可持续退出）见 §12.6。
- **姿态未就绪默认固本**：reset 首 tick 无 strategy 时扩张不启动 — 安全缺省。

### 12.5 相位极限环治理（TD-003，schema v14）

colonyState 在 recovery↔normal 间高频振荡的根因不是阈值抖动，而是负反馈极限环：
drainScore 把「刻意消费」（孵化/升级/建造）与「生产崩溃」同等计为赤字 —
进 recovery 收缩支出 → 盈余 → 秒退 → normal 恢复支出 → 再入。两道闸修复：

- **主动消费豁免**（`drainSpendableFloor: 0.5`）：仅当储备下降**且** spendableRatio
  低于地板时才计赤字；spawn 口袋健康时的储备下降是投资。采集者死绝的场景
  由 understaffed → bootstrap 兜底，不依赖本分数。
- **危机带最短驻留**（`minBandTicks: 100`）：进入 crisis/recovery 后至少驻留
  100 次评估才能回 normal；分数清零后停在 recovery 攒能量缓冲，
  同时保证 crisis 退出必经 recovery 带（修复 recoveryStep 过大导致的 30→0 直切）。

#### Memory 结构（v14 新增）

`RoomMemory.phase.bandTicks?: number` — 危机带驻留计数，room-state 每 tick 写入；
迁移 v13→v14 仅当字段缺失时回填 0（幂等）。

#### 配套：spawn 请求撤销通道

队列请求原本只能靠孵化/TTL/重试隔离出队 — 需求前提消失后的幽灵请求
在 TTL 窗口（最长 1000 tick）内仍被孵化。`removeRequestsByRole` 在
spawn-manager 每 tick 需求评估前撤销：威胁清除后的 defender、
非 normal 且无降级风险时的 upgrader（与 demand 的 allowUpgrader 门禁对称）。

### 12.6 战争自治升级（R4，schema v27）

R3 战时闭环（姿态授权 → 选题 → 孵化 → 攻击 → 收摊）跑通后，报复性战争语义内
仍缺四个自治闭环：**无战损止损**（打不穿就无限添油）、**无编队纪律**（散兵逐个送）、
**无战后核验**（收摊即忘，失败目标下轮重选）、**无经济退出**（war 一旦进入，
经济压力不再参与裁决）。R4 补齐这四个闭环，全部决策为纯函数（`domain/war/planning.ts`、
`domain/strategy/posture.ts`），执行层只消费指令。

#### 1. 波次集结（杜绝添油战术）

- `warPlan.phase = build | advance` 双阈值迟滞（`nextWavePhase`）：
  build 满编（live ≥ squadSize）才 advance；advance 被打残
  （live < squadSize × `CONFIG.war.waveRegroupRatio`）才回落 build 重组。
- 执行端：RolePolicy 新增 `hold` 钩子（`role-runner` 在 **ensureHome 导航之前**
  执行）— attacker 在 build 相位于 home 停驻待命（parkIdleCreep）、在外归建
  （fleeToHome）。此前集结中的攻击者会被 ensureHome 直接导航进目标房，
  「散兵逐个送」正源于此路径。
- 同价值档内残血结构优先（`attackStructures` 评分加入 hitsMax − hits 项），
  集火加速摧毁。

#### 2. 战损止损（消耗战熔断）

- `warPlan.spawned` 累计每个新孵化请求 key（幂等，每 key 计一次）。
  `isAttritionLost`：spawned > squadSize × `CONFIG.war.casualtyMultiplier`（2.5）
  → 判消耗战失败立即收摊。提交受 live+pending < squadSize 约束 —
  队列被能量门禁卡住时 pending 封顶 squadSize，spawned 不会因空转膨胀。
- 止损后整军休战：`kernel.warStandDownUntil`（`CONFIG.war.standDownTicks`）—
  黑名单只挡单目标，休战闸挡「A 止损 → 立刻打 B → 再止损 → 打 C」的
  跨目标添油循环；姿态退出 war 时清除休战闸。

#### 3. 战后核验与失败记忆（战后验收闭环）

- 收摊时以 sponsor 记录的最新目标房 intel 判定战果（`evaluateWarOutcome`）：
  情报过期 → unknown；敌人弃房（owner 消失）→ success；本有塔网且已清零 → success；
  其余 → failure。
- failure/unknown → 目标进 `kernel.warBlacklist` 冷却（`CONFIG.war.warBlacklistTicks`），
  冷却期内 `selectWarTarget` 剔除 — 防止「打不过 → 收摊 → 下一轮又选中 → 再送」。
  success 免黑名单。到期条目由 war-planner 每次运行时清理（防膨胀）。
- 收摊结论记录 `WarOutcome` 事件（EventKind 23，d = [outcome, spawned, reason]），
  战斗黑匣子（M9）可完整复盘：投入多少孵化请求、因何收摊、核验结论如何。
- 黑匣子角色归因补齐：`ROLE_CODES` 追加 mineralMiner/attacker（此前战死记录为
  unknown code，无法区分战损来源）。

#### 4. war 姿态经济可持续退出（Strategy 层止损）

- 原状态机漏洞：war 一旦进入，只要威胁仍在（threatRecent）就无条件维持 —
  经济压力不再参与裁决，消耗战无自动出口。
- 修复：posture 评估新增跨 tick 计数 `warPressureTicks`（empire-strategy 持久化于
  `kernel.strategy`，纯函数只算下一步计数）。war 下经济压力持续超过
  `warMaxPressure` 达到 `warExitPatienceTicks`（1000）→ **立即**降 fortify
  （与经济止损同待遇，不等 minDwell 驻留期）；压力恢复即清零。
- 降级后重新升 war 仍需 fortify 耐心窗口（warPatience）— 既有升级链不破坏。

#### 5. 边界与测试

- 迁移 v26→v27 仅畸形自愈（建档不写值，与 v20/v21 同风格）；
  缺失语义：phase → build（保守：满编才推进）、spawned → 0、warPressureTicks → 0。
- 回归测试：war-planner 系统测试 14 例（姿态消费/编队孵化/收摊核验/止损/相位/
  黑名单）、war-planning 纯函数 21 例、attacker 角色 13 例（hold 决策矩阵 +
  撤退边界 + 目标选择）、posture 21 例（含 war 可持续退出五场景）、迁移 8 例。
- 明确不做（本阶段）：healer/squad 编成、boost 战备、主动开战姿态 —
  维持报复性战争语义；下一阶段以黑匣子实测战报（Wave 存活率、止损触发率）
  作为编成升级的证据门槛。

## 13. 三期计划（M9-M12：双房帝国与韧性建设）

制定于 stable-2026-07-29 里程碑之后。当时态势：主房 W37S58（RCL5）稳定运行，
W38S58 已占领进入拓荒期（RCL2，spawn 在建，由主房代孵编队），W37S57 远矿
active。防御短板经自测演习（heal + ranged 小队）确认存在——反应式 defender
冷启动必然迟到、经济 creep 各自逃命易被逐个点名、safe mode 仅近核触发不保
舰队——但主房有双塔集火（healer 优先）+ safe mode 兜底，实际风险敞口可控，
故防御列为韧性线而非紧急线。

> 实施状态（2026-08 复核）：M9 战斗黑匣子（event-log 的 CreepDeath/TowerVolley
> 事件 + tools/private 收集链）、M11 防御 L1（role-runner 集结避险 + defender
> 双编制 + fleetLossFuse 熔断）、M12 RCL6（terminal-manager / lab-system /
> factory-manager / mineral-miner）均已落地；M12 的「双房互济」验收项
> （双房 terminal 互通、主房向新房输血）由 R5 补齐（§13.1）；
> R3 战时闭环（war-planner + attacker）与其 R4 升级（§12.6）为三期后新增阶段，
> 本节未及回写 — 战争相关硬约束以 §12.4/§12.6 与代码内联注释为准。

### 13.1 帝国能量网络（R5，M12 双房互济验收项补齐）

跨房能量互济与能量市场交易已实现（`domain/economy/energy-logistics.ts` +
`systems/terminal-manager.ts`），补齐 M12 验收项「双房 terminal 互通、
主房可向新房输血能量」。

#### 跨房能量互济（terminal.send）

- **决策纯函数** `planEnergyAid`：救助候选 = storage < `aidRecipientFloor`（20k），
  按缺口降序（最饿者先救）；捐赠候选 = storage > `aidDonorFloor`（50k）且
  terminal 冷却结束，按盈余降序（最富者先捐）；量 = min(缺口, 盈余,
  `aidMaxTransfer`)，低于 `aidMinTransfer` 不送。每轮至多一笔。
- **结构性滞回防震荡**：捐赠地板 > 救助地板 — 受助方被补到 20k 后仍远低于
  50k 捐赠线，单笔救助不可能让受助方翻转为捐赠方；决策无状态，因此
  **不新增 Memory 字段、schema 版本不变**。
- **发送预算**：发送方 terminal 须同时承担 货量 + 能量运费（calcTransactionCost）
  + 储备地板（terminalEnergyReserveFloor）；不足则本轮不发送，等 distributor
  回补 terminal 后下轮再试。
- **执行优先级**：互济排在市场交易之前（殖民生存 > 交易收入），但仅
  healthy/guarded + bucket 门禁内运行（与 terminal-manager 同款节流）。
- **边界**：受助房必须有 terminal（RCL6+ 门槛）— RCL4-5 新房仍走本地自举
  （M10 路径），互济只服务 RCL6+ 房之间的能量调度。
- **可观测**：成交记录 `EnergyTransfer` 事件（EventKind 24，d=[amount]，
  r=受助房），黑匣子可复盘帝国能量流向。

#### 能量市场交易（credits 闭环）

- **溢出卖**：storage > `energySellFloor`（100k，真实盈余出口）→ 向市场卖能量，
  价格底线 `minEnergySellPrice`（0.02）— RCL8 满级后能量是最大财富引擎。
- **危机买**：storage < `energyBuyFloor`（5k）且 credits 高于信用地板 → 买入，
  价格上限 `maxEnergyBuyPrice`（0.05）— 市场是最后救助通道，高于此价宁可
  压缩运营。
- **执行顺序**（每房每窗口至多 1 单）：能量溢出卖 → 矿物卖 → 危机能量买 →
  缺口矿物买；价格底线/上限与 credits 地板全部配置化。

#### 测试

纯函数 12 例（`tests/unit/economy/energy-logistics.test.ts`）+ 系统级 11 例
（`tests/unit/systems/terminal-manager-energy.test.ts`：互济成交/预算不足/冷却/
单房/无交易费 API/能量买卖价格门槛）。

### 主线排序与理由

经济主线优先于防御改造：RCL6 解锁 terminal/lab 是质变节点（跨房物流、
boost、矿物开采），且冲级只需维持 upgrader 吞吐、不占工程资源；防御 L1
在观测基建（黑匣子）就位后实施，避免盲改。扩张（第三房/远矿扩容）在
防御 L1 落地前冻结——远矿采集量与 invader raid 频率正相关，先装甲后扩张。

| 优先级 | 阶段与依赖 | 内容 | 验收标准 |
| --- | --- | --- | --- |
| P0 | M9 战斗黑匣子；无前置 | 复用 event-log：creep 死亡事件（角色/位置/tick/死亡年龄，从 Memory.creeps 清理钩子解析，creep 名自带出生 tick）+ 战斗期塔行为记录（目标/能量/伤害输出） | 下一次战斗后可完整重建杀伤链：谁死的、死在哪、塔打了谁、敌方构成 |
| P0 | M10 新房自治爬坡；依赖 W38S58 spawn 建成 | 拓荒编队停补后新房 demand/bootstrap 闭环接管；RCL3 时塔优先于一切建筑；受袭时拓荒编队撤回主房保人（人比进度值钱） | W38S58 无人工干预升至 RCL4；期间无编队团灭事故 |
| P1 | M11 防御 L1 三件套；依赖 M9（验收需杀伤链数据） | ① 战时集结避险：多单位/带 HEAL 威胁在场时，非战斗 creep 停止各自 flee，统一撤向核心集结区（塔射程内，rampart 格优先）；② 威胁分级：≥2 武装或含 HEAL 判为小队 → defense 姿态 + defender P0 双编制（定位为清剿残敌与护航复工，不是救火）；③ safe mode 舰队伤亡熔断：短窗口死亡 ≥N 且威胁在场才触发——消耗品经济学要求触发条件保守到「不烧就真团灭」 | 集成测试：模拟 3 单位 heal 小队入侵，经济 creep 存活率与 safe mode 触发时序符合预期；下次实战黑匣子复盘验证 |
| P1 | M12 RCL6 解锁与双房互济；依赖主房 RCL6 | terminal 建设与 terminal-policy 接线（能量互济、矿物外卖）；lab 链从摆设转生产；mineral 开采角色 | 双房 terminal 互通；主房可向 W38S58 输血能量 |
| P2 | 远矿扩容（W36S58 复活）；依赖 M11 | remote-mining-manager 自然复活即可，无需开发 | 防御 L1 落地后解除冻结 |
| P2 | 第三房评估；依赖 GCL≥3 + M11 | expansion-manager 既有机器复用 | GCL 余量出现后再评估 |

依赖关系：

~~~
M9 ──► M11 ──► 远矿扩容 / 第三房
M10 ─┘（M10 与 M9 并行；M11 的集结避险优先于熔断）
M12 独立推进（RCL6 到手即开工，不等 M11）
~~~

### 明确拒绝项（本期不做）

- **和平期常备军**：每 1500 tick 白烧 600-1300 能量，塔 + 集结阵已覆盖
  NPC 小队场景；出现玩家持续敌对行为再重估。
- **squad 反击 / boost 战备**：当前规模过度工程，无实战需求牵引。
- **CPU 治理专项**：bucket 健康无痛点，观测到降级频发再立项。

### 反证条件（触发重排）

- M9 上线前遭真实入侵且损失惨重 → M11 集结避险跳过前置直接实施（止血优先于测量）；
- W38S58 spawn 建成后主房孵化队列仍持续拥挤 → 优先排查 expansion 状态机收尾；
- GCL 提前到 3 且防御 L1 未完成 → 第三房仍冻结，GCL 余量不是绕过装甲的理由。


## 14. 四期计划（R6：主动自治 — 从被动反应到目标驱动）

### 14.1 现状诊断（哪些已主动、哪些仍被动）

帝国已具备的主动能力：参数自调优（tuning-engine 每 500 tick 按遥测调边界）、
战略姿态（empire-strategy 主动冻结扩张/远矿）、布局与道路（低频主动规划）、
市场与互济（按阈值主动交易）、战争止损（战损/经济双熔断）。

仍为被动反应的缺口：

1. **情报被动**：扩张「不见不选」——候选房 intel 靠 observer/过境顺带获得，
   情报过期就干等。没有「为决策主动获取情报」的行动（prospect 侦察）。
2. **无目标声明**：帝国没有一个地方回答「我现在在干什么」——升级功率由
   storage 水位驱动（条件反应），而非「帝国决定冲刺 RCL7」这一目标驱动。
   目标声明缺失 → 跨域优先级只能靠各系统本地阈值拼凑，不可解释。
3. ~~防御设防与姿态脱节~~（复核修正）：fortification 已消费姿态 —
   war 姿态全局备战（本房未受袭也按受袭目标维护墙体），fortify 不全局升档
   是有意决策（单房 invader 目击不应烧全帝国墙血预算）。此缺口不成立。

### 14.2 主动自治三层设计

| 层 | 内容 | 落地形态 |
| --- | --- | --- |
| 目标议程层 | 帝国显式短期目标：recovery（恢复）> defense-readiness（备战）> rcl-push（冲级）> develop（兜底）；纯函数决策 + 滞回 + 事件观测 | `domain/strategy/agenda.ts` + `Memory.kernel.agenda`（schema v28）+ empire-strategy 发布 + telemetry 事件 |
| 主动情报层 | 议程/姿态驱动的侦察行动：expand 或 rcl-push 时对高分候选房主动获取视野（决策就绪情报），过期即续 | prospect 议程项 + reserver 侦察模式（或 observer 主动扫描） |
| 姿态消费补齐 | fortify/war 时防御投资升档：防御工事建造优先级提升、塔弹战备线抬升（叠加于现有受袭记忆升档之上） | tower-defense / construction-manager 消费 posture |

### 14.3 实施顺序与验收

| 序 | 阶段 | 内容 | 验收 |
| --- | --- | --- | --- |
| R6a | 目标议程层（核心） | agenda 纯函数 + 发布 + 事件观测 + 首个消费接线（rcl-push → upgrader 冲刺功率升档）；schema v28 幂等迁移 | 议程切换可观测可解释；单测覆盖选择规则/滞回/边界；全绿 |
| R6b | 主动情报 | prospect 议程项：候选房主动侦察（选择/派出/撤退/止损），新鲜 intel 供扩张与战争选题 | 情报过期候选房被主动续视野；侦察失败有止损；全绿 |
| R6c | ~~姿态消费补齐~~（复核后取消：fortification 已消费姿态，见 §14.1） | — | — |

> R6a 已实施（schema v28）：`domain/strategy/agenda.ts` 纯函数 + empire-strategy
> 发布 + AgendaChange 事件（EventKind 25）+ demand 的 rcl-push 冲刺放宽接线
> （spawn-manager 适配层注入 agendaInitiative）。测试：agenda 11 例 + 迁移 5 例。
>
> R6b 已实施（schema v29）：`domain/strategy/prospect.ts` 纯决策（claimable 过滤 +
> 视野新鲜判定，镜像 expansion/evaluator 口径）+ prospect-manager P3 任务状态机
> （expansionAllowed 授权 → 选目标 → 派 scout → 成功/超时/死亡/中止四态收摊，
> 失败进 prospectCooldown）+ scout 角色（[MOVE] 50 能量一次性侦察兵）+
> room-observer captureScoutVision 接线（侦察兵视野 → sponsor intel 落库，
> 扩张评估器零改动消费）+ ProspectOutcome 事件（EventKind 26）。
> 测试：prospect 7 例 + prospect-manager 9 例 + scout/视野捕获 3 例 + 迁移 6 例。
> 边界：v1 候选范围 = 各房 intel 已登记房（自有房邻房）— 更远候选需 map 扫描，
> 待多房阶段再扩。

R6a 是「主动运行」的最小闭环：帝国首次拥有可解释、可观测的短期目标，
行为从「状态阈值反应」升级为「目标驱动的主动运行」。R6b 补上「决策就绪
情报」闭环：扩张候选不再干等视野 — 姿态允许时帝国主动派侦察兵取回情报。
R6c 经复核取消（防御姿态消费已存在）。
