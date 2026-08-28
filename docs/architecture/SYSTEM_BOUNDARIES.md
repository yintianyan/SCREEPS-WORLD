# SYSTEM_BOUNDARIES · 系统边界契约（冻结蓝图）

> 本文件是**模块边界契约**：每个模块的职责（Responsibility）、输入 / 输出、依赖、
> 公开接口、状态所有权、CPU 档位与节奏以此为准；注册新插件前必读（AGENT.md）。
> 结构性修订必须走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。
> 决策权与 [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1 权力总表
> 严格一致；模块概念定义见 [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md)；
> 管线运行秩序见 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md)。

## 1. 模块边界总表（八项 / 模块）

通用约束（适用于全部模块，表内不重复）：Input 一律只读消费，Output 一律经公开接口或唯一写者；Dependencies 仅列运行时依赖（允许 / 禁止全表见 [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md)，本文件 §2.3 只保留最高禁令）；CPU Profile 给量级与档位（P0–P3 语义见 KERNEL_ARCHITECTURE §2），P 序是降级牺牲序而非重要度排名。

### 1.1 Kernel（内核 · engine 类 · P0 · 每 tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 仅四职能：固定顺序调度、safeRun 错误隔离、四档看门狗（watchdog）、Memory 迁移。不感知角色 / 经济 / 房间语义（详见 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md)） |
| Input | 组合根注入的 System / Role 注册表；`Game.cpu` 采样（每 tick ≤2–4 次）；RawMemory |
| Output | 本 tick 预算档位（只读广播）；错误签名→Self-Healing；迁移后的 Memory |
| Dependencies | 禁止 import 任何业务模块（唯一已登记例外见 KERNEL_ARCHITECTURE §8） |
| Public Interface | `loop()` / `Registry.register*` / `safeRun()` / `budgetTier()` |
| State Ownership | 看门狗档位、熔断 / 冷却计数、`schemaVersion`（Memory 瘦，见 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md)） |
| CPU Profile | P0；O(1)/tick（静态注册表遍历；禁止每 tick 重建闭包或排序，research/19 §9） |
| Tick Frequency | 每 tick |

### 1.2 Execution Runtime（执行运行时：role-runner + 交通仲裁 · engine 类 · P0/P1 · 每 tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 统一驱动 RolePolicy 钩子管线（gate/acquire/work/onFlee/hold/park/combat）与共享 FSM；tick 末按房仲裁统一签发 `move`。不做目标选择 |
| Input | creep 列表与 RolePolicy 注册；RoomSnapshot（只读）；移动意图登记 |
| Output | 非移动动作直发；唯一 `move` 签发；卡位自愈信号 |
| Dependencies | Kernel（safeRun）；World Model（快照，只读）；禁止直连 Spawn / Construction |
| Public Interface | `runCreep(policy, creep)` / `registerIntent()` / `resolveRoomTraffic()` |
| State Ownership | TrafficState（瞬时 tick 内）；CreepState（identity/targetId/心跳/失败计数） |
| CPU Profile | P0（creep 执行，O(creeps)，intent 税 ≈0.2 CPU/creep 为不可优化地板）+ P1（tick 末仲裁，意图网格索引近似 O(n)，红队 A8） |
| Tick Frequency | 每 tick |

### 1.3 World Model（世界模型：快照 + 房间状态归一化 · System 类 · P0 · 每 tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 每 tick 只读快照（RoomSnapshot / WorldSnapshot）；房间状态归一化（phase / 能量收支 / 人口 / 建造 / 防御 / 健康度）；构建派生索引（目标池 / 需求池）供全系统复用 |
| Input | Game 可见对象（被观察世界）；Memory 瘦状态 |
| Output | RoomSnapshot、RoomState、派生索引 |
| Dependencies | 无上游业务依赖（感知层，最上游） |
| Public Interface | `getSnapshot(roomName)` / `getRoomState(roomName)` |
| State Ownership | RoomState（唯一写者）；RoomSnapshot 瞬时 |
| CPU Profile | P0；O(rooms)；每房每 tick 一次快照构建，角色层全房 `find` 因此非法（research/20 §10.6） |
| Tick Frequency | 快照 / 增量每 tick；归一化全量每 N tick（分频 + 增量，红队 A1） |

### 1.4 Empire（帝国：战略 / 调拨 · Agent 载体 · P1 · 态势分频）

| 项 | 契约 |
| --- | --- |
| Responsibility | posture × budget 纯函数求值（唯一目标选择权）；跨房调拨令（terminal 网络 + 门控）；房间注册 / GCL 垄断。**Planner 组件不存在**——规划职责已解散为 Policy（战略方向）+ Agenda 管理器（中期承诺）+ 各系统确定性推导（即时派工），见调和 §4 |
| Input | EmpireSituation（分频聚合）；Intelligence 查询结果；各房 Report（净流 / 缺口 / 风险） |
| Output | PostureDecision（posture + 预算 + 切换原因）；调拨令；Agenda 立项授权 |
| Dependencies | World Model（只读）；Intelligence（只读） |
| Public Interface | `evaluatePosture(situation)`（纯函数，禁止 Game / Memory 引用——research/28 纯函数律） |
| State Ownership | EmpireState（posture / 预算 / 房间注册 / GCL） |
| CPU Profile | P1；求值 O(1)（态势已分频聚合，禁止每 tick 全量聚合） |
| Tick Frequency | 态势分频刷新；未刷新则沿用上次决策（决策幂等，红队 A1） |

### 1.5 Economy（能量收支核算 · System 类 · P1 · 每 N tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 净流 / 储备 / 预算三指标核算；扩张门控三指标平滑值（cpuIdle / heapFree / memoryFree）。不做调拨（调拨权在 Empire） |
| Input | RoomState；快照能量计量；遥测 L2 聚合 |
| Output | EconomyState；门控判定（供 Expansion / Empire 消费） |
| Dependencies | World Model |
| Public Interface | `computeEconomy(roomStates)`（纯函数） |
| State Ownership | EconomyState（派生为主） |
| CPU Profile | P1；O(rooms)/轮 |
| Tick Frequency | 每 N tick（10–100，错峰散列） |

### 1.6 Logistics（物流：请求池 + link + terminal 均衡 · System 类 · P0/P1/P2 分层 · 混合节奏）

| 项 | 契约 |
| --- | --- |
| Responsibility | 供需请求池维护与租约（lease）分配；link 网传输；terminal 均衡。市场订单与 terminal 交易签发由 TerminalManager（唯一写者，Manager 类，生产入口 `src/systems/terminal-manager.ts`）承担，下单决策输入来自 Economy / Empire |
| Input | Demand（搬运请求）；水位快照 |
| Output | LogisticsRequest（租约，六态）；link / terminal 动作；市场订单 / `Game.market.deal`（TerminalManager 唯一，幂等键） |
| Dependencies | 分配服务（domain 纯函数）；World Model |
| Public Interface | `submitRequest()` / `claimLease()` |
| State Ownership | 请求池（运行时瞬时，不持久化）；水位 Memory 瘦快照 |
| CPU Profile | 请求池与基础搬运 P0（生存链）；link P1；terminal 均衡 / 市场 P2（research/19 §10.2、research/26 §6） |
| Tick Frequency | 请求池每 tick；link 每 tick（冷却内跳过）；terminal 每 N tick |

### 1.7 Spawn（SpawnManager · Manager 类 · P0 · 每 tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 全局唯一 `spawnCreep` 写者；车道制排队（P0>P1>P2>P3 + Agenda 优先级序 + 饥饿老化，先来先得非法）；幂等 key 合并；黑名单冷却；请求撤销与 recycle 通道 |
| Input | SpawnIntent（各系统提交，必带幂等 key + deadline） |
| Output | `spawnCreep` 调用；孵化 / 失败 outcome（禁止静默丢单） |
| Dependencies | 无上游（被全体依赖） |
| Public Interface | `submit(intent)` / `cancel(key)` |
| State Ownership | SpawnState（队列 / 幂等 key / 黑名单 / 车道） |
| CPU Profile | P0；**永不熔断、永不冷却**（红队 A5）；O(queue)/tick |
| Tick Frequency | 每 tick 消化队列 |

### 1.8 Construction（建造，含远矿 site · Manager×2 类 · P2 · 每 10–50 tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | site 创建仅两写者：ConstructionManager（自有房）+ RemoteMiningManager（远矿房）；蓝图队列推进；全局 / 每房 site 上限执行；角色层申请标记（`needContainer`）的唯一消费者。核心结构建成后冲突只标 `blocked`，不自动拆改 |
| Input | 版本化布局蓝图（`templateId`/`layout.version`）；角色申请标记；实测交通热度 |
| Output | `createConstructionSite`（全系统唯二调用点）；blocked 标记 |
| Dependencies | layout domain（纯函数）；World Model |
| Public Interface | `requestSite()` / `getQueue()` |
| State Ownership | 建造队列 / 热度计数 |
| CPU Profile | P2；Guarded 档降频、Conserve 档暂停 |
| Tick Frequency | 每 10–50 tick；emergency site 事件式（优先于远矿 site） |

### 1.9 Defense（防御：威胁 + 塔 · System 类 · P0 · 每 tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 威胁分级评估（四级）与防御状态机（normal→alert→siege→recovery→stabilizing）；塔动作唯一签发；safemode 决策表执行（多房候选优先序，红队 A11） |
| Input | 房间敌情快照；Intel 威胁记忆 |
| Output | 塔动作；P0 孵化请求（经 Spawn 车道，不绕过）；防御状态 |
| Dependencies | World Model；Spawn（仅提交请求） |
| Public Interface | `assessThreat(snapshot)`（纯函数）/ 塔决策表 |
| State Ownership | 威胁状态 / 防御 FSM（房间域） |
| CPU Profile | P0（应答）；分级评估分频 |
| Tick Frequency | 应答与状态机步进每 tick；分级评估每 N tick |

### 1.10 Military（war-planner · Manager 类 · P2 · 低频）

| 项 | 契约 |
| --- | --- |
| Responsibility | 唯一进攻执行决策者；波次集结（build 相位 hold 归建，满编才 advance）/ 推进 / 止损链 / 战后核验（`evaluateWarOutcome` 纯函数，只信新鲜 intel）。仅 war 姿态活动；attacker 仅由本系统经 Spawn 请求孵化 |
| Input | war 授权（posture，只读）；新鲜 Intel；波次账本 |
| Output | attacker 孵化请求（车道优先级由 Policy 赋权）；WarOutcome 事件 |
| Dependencies | Empire（授权，只读）；Spawn（提交）；Intelligence（查询） |
| Public Interface | `planWave(intel)`（纯函数） |
| State Ownership | MilitaryState（账本 / 止损计数 / warBlacklist；war 授权字段归 Policy） |
| CPU Profile | P2；非 war 收摊近零；战时 O(squad) |
| Tick Frequency | 低频复核 + 战时事件式 |

### 1.11 Expansion（扩张 · System 类 · P2 · 每 100+ tick）

| 项 | 契约 |
| --- | --- |
| Responsibility | 扩张候选搜索与尽调（G1–G5 门控、多源新鲜度硬门槛——红队 A7）；殖民自举支持。**立项权在 Empire**：本模块只评估与建议，禁止自行 claim / 立项 |
| Input | Intelligence 查询；Economy 三指标；GCL / 房间注册 |
| Output | 候选评分与尽调报告（→ Empire 立项）；殖民 AgendaItem 属地执行支持 |
| Dependencies | Intelligence（只读）；Economy（只读） |
| Public Interface | `evaluateCandidates(intel)`（纯函数） |
| State Ownership | 候选评估记录（瞬时；低频归档进 segment） |
| CPU Profile | P2；评估 O(candidates)；Guarded 档降频 |
| Tick Frequency | 每 100+ tick |

### 1.12 Intelligence（情报 · System 类 · P2 · 事件式）

> **当前生产状态（R14 裁决，2026-08-29）**：本节概念合同已由 R14 落地——
> `intelligence` 系统（`src/systems/intelligence.ts`，P2/10t）注册为 **IntelState
> 唯一写者**：三分置信度 + TTL 分档 + 房间域 heap 活跃层（环形覆盖）+ 玩家域
> segment 冷存（月级威胁记忆）+ §5 硬门槛查询。legacy `Memory.rooms[].intel`
> 为**只读输入桥**（room-observer 写侧保持运行至消费者迁移 IntelQuery——迁移为
> war 轨前置，两状态各自唯一写者不变）。A6 智能层 `intelligence-pipeline` /
> `decision-trace` / `evaluation-system` 仍为 R11 裁决的 Shadow-Only 孤岛
> （`src/domain/intelligence/`、`src/domain/strategy/decision-trace.ts`），本裁决
> 不恢复之。详见 [INTELLIGENCE_ARCHITECTURE.md](INTELLIGENCE_ARCHITECTURE.md) §0。

| 项 | 契约 |
| --- | --- |
| Responsibility | intel 采集与写入（四域：房间 / 玩家 / 资源 / 市场）；TTL 老化与置信度分级（fact / stale / inferred）；segment 分页与激活预算管理 |
| Input | scout / room-observer 观察；战报；市场快照 |
| Output | IntelEntry 查询接口（异步激活语义：本 tick 请求下 tick 可读） |
| Dependencies | World Model（观察源） |
| Public Interface | `record(observation)` / `query(domain, filter)` |
| State Ownership | IntelState（唯一写者，segment 冷数据） |
| CPU Profile | P2；写事件式近零；老化低频 |
| Tick Frequency | 写事件式；TTL 老化低频；读按需（禁止进生存链路） |

### 1.13 Agenda / Operations 管理（System 类 · P2 · 低频）

| 项 | 契约 |
| --- | --- |
| Responsibility | AgendaItem 全生命周期：立项登记→低频复核（预算 / 期限 / 取消条件）→结果核验→归档；复核时生成 / 维持 Demand 流（如人口缺口）。**立项授权来自 Empire Policy**，本管理器不自行立项战略承诺 |
| Input | Empire 授权；各 AgendaItem 复核快照；属地母房 Report |
| Output | AgendaItem 状态变更；维持的 Demand 流；完成 / 失败记录（→遥测） |
| Dependencies | Empire（授权，只读）；Observability |
| Public Interface | `review(agenda)` / `archive(itemId)` |
| State Ownership | AgendaItem 状态（唯一写者） |
| CPU Profile | P2；O(active agendas)/轮 |
| Tick Frequency | 低频复核（每 100+ tick 级）；立项登记事件式 |

### 1.14 Observability（观测 · System 类 · P3 聚合 + P0 伴生采集）

| 项 | 契约 |
| --- | --- |
| Responsibility | 三级遥测管线（L1 计数 / L2 采样聚合 / L3 segment 持久化）；告警分级（INFO / WARN / TAKEOVER）；Memory 体积遥测 |
| Input | 各系统自有 L1 计数器（只读）；Kernel 采样 |
| Output | TelemetryFrame（segment）；WARN / TAKEOVER 信号（console 限量，相同告警 25 tick 限流） |
| Dependencies | Kernel（采样，只读）；segment-store |
| Public Interface | `counter()` / `snapshot()` / `export()` |
| State Ownership | TelemetryState |
| CPU Profile | 采集寄生近零（总预算 ≤3% limit，research/21 §9）；聚合 P3（Guarded 档暂停）；TAKEOVER 输出为 P0 伴生（内核错误隔离同源），不因降级静默 |
| Tick Frequency | L1 每 tick；L2 每 N tick；L3 每 N×M tick；告警事件式 |

### 1.15 Self-Healing（自愈 · System 类 · P1 · 分档对账）

| 项 | 契约 |
| --- | --- |
| Responsibility | Monitor→Anomaly→Diagnosis→Recovery→Verification 闭环；有界恢复动作（六动作清单）与不可越权清单执行；超界升级 TAKEOVER。监测寄生既有遥测 / 对账，禁止独立扫描帝国 |
| Input | 错误签名（safeRun）；遥测异常；对账差（预期态 vs 实际态） |
| Output | 有界恢复动作（带冷却 / 配额 / 两阶段删除）；TAKEOVER 信号 |
| Dependencies | Kernel（错误签名）；Observability；处置表（只读查表，未登记签名走默认安全动作） |
| Public Interface | `reconcile()` / `dispatch(signature)` |
| State Ownership | 无自有业务状态（恢复动作计数入遥测） |
| CPU Profile | P1；<1% limit（research/22 §9） |
| Tick Frequency | 对账分档：creep 级每 tick（顺带）/ 任务级每 N tick / 房间级每 100 tick / 帝国级每 1000 tick |

## 2. Module Boundary Rules（模块边界规则）

### 2.1 命名规约（五个允许后缀，依据调和 §5）

| 后缀 | 判据（仅当满足才允许） | 例 |
| --- | --- | --- |
| **Agent** | 拥有运行时目标选择权的组件——仅帝国战略层，受限且确定性 | Empire 战略（Policy） |
| **System** | 组合根注册的 tick 管线成员（P0–P3 优先级类） | room-state、tower-defense |
| **Service** | 无状态纯逻辑集合（domain 层分配 / 评分纯函数） | assignment-service |
| **Manager** | 唯一写者资源代理——仅当存在独占写权需要代理时 | SpawnManager、ConstructionManager、RemoteMiningManager、TerminalManager |
| **engine** | 执行框架 | role-runner、traffic resolver |

- **禁止**后缀：Coordinator / Handler / Controller 及一切空转命名。
- 名称必须全局唯一 kebab-case；bootstrap 注册时查重，重复注册启动即失败。
- 模块顶层禁止访问 `Game` / `Memory`（AGENT.md）。

### 2.2 删除判据

1. 一个模块若**只是转发、只是调用、只是 if-else 分派**，必须删除（调和 §5）。
2. **一个问题一个 Manager 禁止**：Manager 仅当存在独占写权；无写权的「管理」必须
   降为 System / Service 或删除。
3. 新增模块必须能在 §1 登记完整八项；登记不完整（无独立 State Ownership 亦无唯一
   写权）者不予合并。

### 2.3 依赖最高禁令（三条；允许 / 禁止全表见 [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md)）

1. **禁止绕过唯一写者直接写游戏世界**：`spawnCreep`、`createConstructionSite`、
   move 签发、市场 `deal` 各只有一个合法调用点（DECISION_AUTHORITY §1）。
2. **禁止系统间运行时横向 import 直读内部状态**：跨系统只经 Public Interface；
   Kernel 禁止 import 业务模块（research/19 §8；风险 R-13）。
3. **禁止 domain / 决策函数引用 `Game` / `Memory`**：决策必须是
   `situation + state + policy → decision` 纯函数（research/28 纯函数律）；
   Game 动作只允许出现在唯一写者与执行运行时。

## 3. 一致性声明

本文件与 [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1、
[STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) §3、
[KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2 必须同一时刻一致；新增 /
删除模块必须三处同步并走 ADR。
