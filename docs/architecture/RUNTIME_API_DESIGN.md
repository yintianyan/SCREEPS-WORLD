# RUNTIME_API_DESIGN · 运行时 API 设计（冻结蓝图）

> 本文件是**运行时接口契约**：系统间通信只允许出现的接口概念、语义与调用权限以
> 本文为准；**本文只定义接口概念与调用权限，不写实现**（签名是概念级，方法名 /
> 文件布局归实现层）。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。依据：调和 §5–§7、
> [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1 公开接口列、research/26 §5、
> research/08 §10.4、research/28 §10.3。概念定义见
> [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md)。

## 1. 总则

1. 接口分四组：**查询组**（只读）、**服务组**（domain 纯函数集合）、**执行组**
   （唯一写者入口）、**平台组**（内核与横切设施）。
2. 三条不变量贯穿全部接口：
   - 查询组**全部只读**，经 World Model / Intelligence 的公开接口取数；
   - 执行组**全部经唯一写者**；Service 是 domain 纯函数层，**不是** System
     （无 tick 管线成员资格，无自有状态，调和 §5）；
   - 平台组不承载业务语义（Kernel 无业务调用，见 §6）。
3. 接口语义统一遵循回执律：一切 Intent / Request 必有 outcome
   （accepted/rejected/completed/failed/expired），**禁止静默丢单**（research/08 §8）。
4. 新增接口 = 同时修订 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1 对应模块的
   Public Interface 行与本文 §7 权限矩阵，缺一不予合并。

## 2. 查询组（全部只读）

| 接口 | 概念签名 | 输入 → 输出 | 语义合同 |
| --- | --- | --- | --- |
| `WorldQuery` | `getSnapshot(roomName)` | 房名 → RoomSnapshot | 本 tick 只读快照；角色与系统感知的唯一入口，**替代**一切全房 `find`（research/20 §10.6） |
| `EmpireQuery` | `getEmpireState()` | — → posture / 预算 / 房间注册 / 活跃 Agenda 摘要 | EmpireState 只读视图；快照未刷新则返回上次决策（红队 A1） |
| `RoomQuery` | `getRoomState(roomName)` | 房名 → phase / 能量收支 / 人口 / 建造 / 防御 / 健康度 | RoomState 归一化结果只读；全量每 N tick + 增量每 tick |
| `ResourceQuery` | `queryStock(domain, room?)` | 资源域（能量/矿物/credits/CPU 预算）→ 水位与余量 | 供给任何门控判定的读侧；能量属 Room、帝国只有调拨权（调和 §10.1） |
| `IntelQuery` | `query(domain, filter)` | intel 域 + 过滤器 → IntelEntry 列表（含置信度） | **异步激活语义**：本 tick 请求下 tick 可读；stale/inferred 禁当 fact（多源新鲜度硬门槛，红队 A7）。**当前生产状态（R14）**：`intelligence` 系统已注册为 IntelState 唯一写者，查询 API 落地（`getRoomIntel`/`getPlayerIntel`/`intelActionUsable`/`intelNeedsRescout`，[INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §0）；legacy 消费者迁移中（war 轨前置） |

## 3. 服务组（domain 纯函数层）

| 接口 | 概念签名 | 输入 → 输出 | 语义合同 |
| --- | --- | --- | --- |
| `GoalService` | `evaluate(predicate, metrics)` | Goal 常量谓词 × 指标快照 → 布尔 / 终态判定 | 谓词求值器；Goal 不实例化、不入 Memory、无竞拍（调和 §2）；「是否生效」＝posture 允许集 ∩ 预算余量 ∩ 优先级序的静态合取 |
| `PlanningService` | `review(agenda)` | AgendaItem 复核快照 → 状态变更建议 | Agenda 复核的纯函数核：预算余量 / 期限 / 取消条件 / 里程碑验收（行为证据）；防振荡三防线挂载点 |
| `OperationService` | `authorize / register / archive(item)` | 授权 × AgendaItem 草案 → 登记项 / 归档事件 | AgendaItem 生命周期通道；**立项授权仅来自 Empire Policy**，本服务不自行立项战略承诺；Recovery 档禁止新建 |
| `DemandService` | `submit(demand)` / `claim(key)` | 需求声明 / 幂等 key → 池中登记 / 认领 | 请求池登记与认领；聚合粒度强制「房间 × 资源 × 用途」；Demand 瞬时不持久化 |
| `TaskService` | `bind / renew / release / expire(lease)` | 租约操作 → 六态转移（offered→claimed→succeeded/failed/expired/cancelled） | 租约管理；TTL + heartbeat 到期自动回池防泄漏；高优抢占仅 P0 且带成本记录 |

## 4. 执行组（全部经唯一写者）

| 接口 | 概念签名 | 输入 → 输出 | 语义合同 |
| --- | --- | --- | --- |
| `SpawnService` | `submit(intent)` / `cancel(key)` | SpawnIntent（幂等 key + deadline）→ 回执 / 撤销 | `spawnCreep` 唯一入口（SpawnManager）；车道制 P0>P1>P2>P3 + Agenda 优先级 + 饥饿老化；先来先得非法 |
| `LogisticsService` | `submitRequest()` / `claimLease()` | LogisticsRequest → 租约 | 供需池与租约分配；link / terminal 是独立低频通道，不进 creep 物流池 |
| `ConstructionService` | `requestSite()` / 标记 `needContainer` | 蓝图段 / 申请标记 → site 签发回执 | `createConstructionSite` 唯二入口（ConstructionManager 自有房 + RemoteMiningManager 远矿）；角色层只写申请标记 |
| `MilitaryService` | `planWave(intel)` / `evaluateWarOutcome(intel)` | 新鲜 intel → 波次计划 / 战后核验结论 | war-planner 决策纯函数；仅 war 姿态活动；attacker 孵化经 `SpawnService` 提交；止损链不可绕过 |
| `TerminalService` | `deal(orderId, amount, roomName)` / `send(resourceType, amount, dest, roomName)` | 市场订单 / 跨房调拨令 → 成交回执 / 发货回执 | `Game.market.deal` 与 terminal `send` 唯一入口（**TerminalManager**，生产入口 `src/systems/terminal-manager.ts`；不存在 `MarketManager`）；幂等键 + 成交核验（红队 A12）；下单决策输入来自 Economy / Empire，调拨令决策权在 Empire |

## 5. 平台组

| 接口 | 概念签名 | 语义合同 |
| --- | --- | --- |
| `Scheduler` | `loop()` / `Registry.register*` / `budgetTier()` | Kernel 管线的公开面；`register*` **仅组合根 `bootstrap.ts` 可调**；`budgetTier()` 是档位只读广播 |
| `EventBus` | **不存在** | 调和 §6 裁决：**本系统没有 EventBus 中枢，没有 publish/subscribe 运行时 API**。「事件」只存两种形态——① 分频触发器（系统内联 cadence 判断，如水位越阈）；② AgendaItem 立项 / 取消条件（低频复核时评估）。任何 PR 引入 `emit/on/subscribe` 形态即架构违规（[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §1.1 否决清单） |
| `StateStore` | `get(key)` / `set(key, value)`（owner 校验） | [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) 的访问器：`set` 仅当调用方是该字段 Owner 才生效，否则抛错；跨系统读经查询组，禁止深读他系统 Memory 内部 |
| `Metrics` | `counter()` / `snapshot()` / `export()` | 遥测管线三级入口（L1/L2/L3，research/21 §10.2）；采集预算 ≤3% limit；TAKEOVER 信号为 P0 伴生不因降级静默 |

## 6. 调用权限矩阵

行 = 调用方（按 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1 模块归类），
列 = 被调接口组。✔=允许；△=条件允许（见脚注）；✖=禁止。

| 调用方 \ 接口组 | 查询组 | Goal/Planning/Operation | Demand/Task | 执行组 | Scheduler | StateStore / Metrics |
| --- | --- | --- | --- | --- | --- | --- |
| Kernel | ✖（不读业务）¹ | ✖ | ✖ | ✖² | 自身 | StateStore（schemaVersion / 熔断计数） |
| World Model | ✖（它是查询组的**数据源**，不消费查询组） | ✖ | ✖ | ✖ | — | Metrics |
| Empire（战略） | ✔ 全部只读 | ✔（授权 / 复核） | ✔（读聚合摘要） | △³ | ✖ | StateStore（EmpireState）+ Metrics |
| Agenda 管理器 | ✔ | Planning/Operation ✔ | Demand ✔（生命周期内声明） | ✖（不直接派单） | ✖ | StateStore（AgendaItem）+ Metrics |
| 业务系统（Economy/Logistics/Defense/Military/Expansion/Intelligence） | ✔ | Military ✔（授权只读）⁴；其余 △⁵ | Demand ✔（推导登记） | 各自对应者 ✔⁶；其余 ✖ | ✖ | StateStore（自有状态）+ Metrics |

> 注：Intelligence 行已由 R14 落地（`intelligence` 系统注册，IntelState 唯一写者；[INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §0）——查询走其只读 API；legacy 消费者迁移 war 轨前置。
| 唯一写者（SpawnManager 等） | ✔（队列核算所需） | ✖ | ✔（消化请求池） | 写者间 ✖ | ✖ | StateStore（自有队列）+ Metrics |
| Execution Runtime / RolePolicy | ✔（经快照） | ✖ | Task ✔（认领 / 续约）+ Demand △⁷ | Construction ✔（仅申请标记）⁸；Spawn ✖ | ✖ | StateStore（CreepState）+ Metrics |
| Observability / Self-Healing | ✔（只读对账） | ✖ | ✖ | ✖（恢复动作经对应 owner 公开接口） | Kernel 采样只读 | Metrics ✔；StateStore ✖⁹ |
| 体外平面（Grafana / LLM 顾问） | segment 只读（经 REST） | ✖ | ✖ | ✖ | ✖ | ✖ |

脚注：
1. Kernel 不感知业务；唯一已登记例外是 R9 维护钩子直接 import（KERNEL §8）。
2. 紧急直通由内核**触发判定与放行**，`spawnCreep` 仍唯一经过 SpawnManager 执行
   （KERNEL §6；调和 §10.4）。
3. Empire 对执行组没有直调权：其输出是授权（posture）、调拨令与预算，由 Military /
   Logistics 等系统消费后经写者落地（[DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1）。
4. Military 读 war 授权（EmpireState 的一部分）是只读消费，不反向改 posture。
5. Economy / Expansion 只消费查询组与 GoalService 门控判定，不触碰 Operation 生命周期。
6. Defense→SpawnService 仅提交 P0 请求（不绕过队列）；Logistics→LogisticsService、
   Construction 消费申请标记、Military→SpawnService 提交 attacker。
7. RolePolicy 对 DemandService **只能认领，不能创建战略 Demand**——人口 / 车道级
   Demand 由系统从缺口推导（research/08 §10.3；AGENT.md 角色禁令）。
8. 角色写 `needContainer` 等申请标记是唯一例外，site 签发权恒在两个 Construction
   写者（AGENT.md 建造条款）。
9. Self-Healing 无自有业务状态；恢复动作计数进 Metrics，处置走 owner 接口
   （research/22 §10.3 不可越权清单）。

## 7. 演进规则

1. 新增接口必须先答三问：调用方是谁（矩阵行）、是否引入第二写者（违 §1-2）、
   是否可用既有查询组 + 唯一写者组合表达（能用则不新增）。
2. 接口改名 / 语义收紧不算结构性修订；权限矩阵任何 ✔↔✖ 翻转**是**结构性修订，
   走 ADR。
3. 本文与 [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) §2 允许依赖表互为镜像：
   import 权限即调用权限，运行时权限即 import 权限，两处必须同一时刻一致。
