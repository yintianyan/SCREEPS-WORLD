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
  bootstrap.ts                    # 唯一插件组合入口
  config/
    index.ts                      # 集中策略、CPU 阈值、功能开关
    bodies.ts                     # body 模板和生成约束
  kernel/
    kernel.ts                     # tick 生命周期与调度
    contracts.ts                  # System、CreepRole、TickContext
    registry.ts                   # 显式注册表
    scheduler.ts                  # 优先级、预算与降级层
    memory.ts                     # 清理与版本化迁移
    safe-run.ts                   # 错误边界与日志限流
    telemetry.ts                  # 轻量指标
  domain/
    economy/                      # 配额、body、需求等纯逻辑
    spawn/                        # SpawnRequest、队列、替换计算
    construction/                 # 建造优先级和计划校验
    movement/                     # 路径键与缓存失效规则
  systems/
    room-snapshot.ts              # 每房每 tick 一次扫描
    spawn-manager.ts              # 需求、队列、孵化、重试
    construction-manager.ts       # 建造队列与 site 限流
    room-observer.ts              # 房间策略入口
    defense.ts                    # 未来防御，属于 critical
  creeps/
    harvester.ts
    hauler.ts
    upgrader.ts
    builder.ts
    repairer.ts
    worker.ts                     # 仅早期/灾后混合角色
  types/
    global.d.ts
tests/
  unit/
  fixtures/
~~~

### 2.3 数据所有权

| 数据 | 唯一写入者 | 消费者 | 位置 |
| --- | --- | --- | --- |
| 本 tick 房间快照、对象索引 | room-snapshot | 所有系统与角色 | TickContext / global |
| 房间长期战略和建造意图 | 房间或建造系统 | Spawn、角色 | Memory.rooms |
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
| Guarded | 3,000 至 6,999 | 16 / 18.5 | P0 至 P3，后台频率减半 | P4 |
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
- 非关键插件连续报错时冷却 50 至 200 tick；P0 只限流日志，不盲目禁用。
- 开发环境可打开 throwOnError，官服生产默认隔离；长堆栈不重复写入 Memory。

### 3.4 版本化 Memory

建议根 Memory 保持如下形态：

~~~ts
interface RootMemory {
  schemaVersion: number;
  migration?: { from: number; to: number; cursor?: string; startedAt: number };
  rooms: Record<string, RoomMemory>;
  creeps: Record<string, CreepMemory>;
}
~~~

迁移规范：

1. 每次持久化结构变更增加版本，提供从旧版本到新版本的函数。
2. 迁移必须幂等：重复运行不会重复建队列、丢失数据或改变完成结果。
3. 先写新字段，验证完成后删除旧字段；只有所有步骤成功后才更新 schemaVersion。
4. 大迁移按 cursor 分 tick，每 tick 仅处理固定数量条目；Recovery 时暂停非关键迁移。
5. 死亡 creep Memory 小帝国可每 tick 清；规模变大后按 cursor 每 10 tick 清理。
6. 每次版本升级必须有空 Memory、旧版本、重复执行和中断恢复的 Vitest 用例。

## 4. 插件注册规范

bootstrap.ts 是唯一组合根。新增角色或系统时，只改 bootstrap 和新增模块，不改 Kernel。

~~~ts
const registry = new Registry()
  .registerSystem(roomSnapshotSystem)
  .registerSystem(spawnManagerSystem)
  .registerSystem(constructionManagerSystem)
  .registerRole(harvesterRole)
  .registerRole(haulerRole)
  .registerRole(upgraderRole);

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

孵化优先级：

1. P0 灾后恢复：没有存活或正在生成的可采集且可送能 creep 时，暂停一切非 P0；可用能量达到 200 就立即生成 [WORK,CARRY,MOVE]。
2. P1 能量入口：每个安全本地 source 至少有采集覆盖；container 未就绪前采集者必须带 CARRY。
3. P1 能量配送：当 miner 正常但 spawn/extension 长时间缺能时，补充最小 hauler。
4. P2 保级与关键维修：只保留避免控制器降级和关键结构失效的能力。
5. P3 发展：upgrader、常规 builder 只在 P0/P1 齐备、无敌袭、CPU 非 Recovery 且留有紧急 body 能量时生成。
6. P4 战略：侦察、远矿、reserve、战斗和实验角色只在长期健康后开放。

队列和替换规则：

- 请求按 key 幂等合并，spawn.spawning 和已提交请求必须计入人口，避免重复孵化。
- body 不能超过 energyCapacityAvailable。P0 可以按 energyAvailable 降级立即出生；普通角色可等待合理体型，但有最长等待时间。
- 关键替换在 ticksToLive 不大于 body.length 乘 3、预计路程与 15 tick 安全缓冲之和时入队。
- 同类 creep 生成需错峰，避免同 tick 集体寿终。普通请求不得侵占关键替补的最晚开工窗口。
- ERR_BUSY 不算失败；能量不足保留请求；body 不合法等配置错误隔离该请求并限流报警。
- colony 状态由 Spawn/Room 服务统一计算：BOOTSTRAP、RECOVERY、NORMAL、DEFENSE。角色只读取状态。

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

- 初始全局活跃 site 不超过 5；每房每阶段只创建一个依赖满足的 site。推荐 1 个 critical 加 2 个 normal 的并发上限。
- 队列项包含 priority、依赖、重试次数、失败原因、冷却和完成判定。地形冲突、RCL 不足、不可达等错误必须退避或删除。
- 规划器仅在 RCL 变化、关键建筑完成、布局失效或每 25 至 50 tick 执行；执行器每 tick 只消费已有队列。
- builder 早期最多一名。没有高优先级 site、P0/P1 不足、能量低于生存水位或 CPU Recovery 时，停止新 builder。
- builder 无可建目标时按顺序回退为 spawn/extension 填能、关键维修、控制器升级；不得空转。
- 维修顺序为 spawn/extension/container/tower、高流量道路、其他结构。墙和 rampart 只进入防御插件的明确计划。
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
      compact-core-v1.ts      # 与锚点相对的静态核心
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
  id: string;                          // 例：compact-core-v1
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

1. 以主 spawn 作为 anchor，加载 compact-core-v1。
2. 将每个相对单元转为绝对坐标，过滤越界、墙、source、controller、mineral 和不可兼容建筑。
3. 对于可小范围移动的 extension、road、container，按预定义 fallback offset 列表寻找第一个合法格；不可移动的核心单元直接标记 blocked。
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
): "ok" | "rcl" | "terrain" | "occupied" | "site-limit" | "dependency" {
  // 1. 使用 CONTROLLER_STRUCTURES 检查当前 RCL 可建数量
  // 2. room.getTerrain 检查墙和边界
  // 3. 使用 snapshot 检查 source/controller/mineral 与已有结构/site
  // 4. 检查 BuildTask 的前置 key 是否为 done
  // 5. 检查 per-room / global 活跃 site 上限
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
5. 全局每 tick最多创建一个 site；每房最多同时 1 个 critical 和 2 个 normal site。若低 CPU 或发展门禁未通过，保持队列但不创建。
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
| L1 类型与模板 | M2 | 新增 layout 类型、compact-core-v1、坐标 packing、静态校验 | 纯函数测试覆盖越界、冲突、RCL 和依赖 |
| L2 快照与验证器 | L1 | RoomSnapshot 中加入 terrain、结构、site 索引；实现 validateBuildCell | 同一格不会被重复入队或重复建 site |
| L3 队列执行器 | L2、Spawn Manager | BuildTask 状态机、退避、site 限流、发展门禁 | P0 缺口时不创建普通 site；错误不刷屏 |
| L4 builder 接入 | L3、assignment-service | builder lease、建造回退、低 CPU 释放任务 | 空队列 builder 正确填能/待命 |
| L5 动态道路 | L2、L3 | global 交通采样与有限道路候选 | 100 tick 内不出现全图铺路；只有高频路径建 road |
| L6 新房候选规划 | L1 至 L5 稳定后 | 增量候选评分与人工确认开关 | 候选计算可暂停/恢复，不超过规划 CPU 预算 |

布局测试除纯函数外，必须覆盖：初始 spawn 造成模板冲突、RCL 变化、site 已存在、controller 结构数量上限、建筑被毁、低 CPU 冻结、global reset、任务重试和人工 manual 状态。

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

Kernel 将角色调用逐步从 run(creep) 升级为 run(creep, ctx)。迁移期间 ctx 可选，待所有角色切换后再将其设为必填；不得一次性破坏现有 harvester。

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
  // 本地任务默认 maxRooms: 1，reusePath: 5 到 20
  // 目标、移动模式、房间道路修订组成缓存 key
  // 检测 lastPos；不因 ERR_TIRED 误判卡住
  // 连续 2 到 3 tick 未移动才尝试有限重算
  return creep.moveTo(target, options);
}
~~~

移动规则：

- 角色只在主动作返回 ERR_NOT_IN_RANGE 时调用移动，不在一个 tick 反复选目标和重算。
- 本地路径设置 maxRooms 为 1；远程路径由 route/remote 插件低频预计算，角色只消费 route waypoint。
- PathFinder 仅可由 movement service 或低频 planner 调用，并有 maxOps、maxRooms、缓存 key 和失败冷却；禁止 role 直接调用。
- 缓存 key 包含目标、移动类型、room 路网 revision；道路或关键阻塞变化后递增 revision 使旧缓存自然失效。
- creep Memory 仅保存 packed lastPos、stuckTicks 和短 pathKey；完整路径放 global。global reset 后回退一次原生 moveTo。
- 停滞时先等待一个 tick或调整优先级，再有限重寻路；连续失败进入 idle/flee，不能持续消耗 CPU。

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

首个版本的成功标准不是扩张速度，而是在 global reset、低 bucket、单模块异常和全员死亡边缘时，始终先守住采能、孵化、供能、保级的最小闭环，并把扩张安全地降级。
