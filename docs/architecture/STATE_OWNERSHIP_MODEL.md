# STATE_OWNERSHIP_MODEL · 状态所有权模型（冻结蓝图）

> 本文件是**状态所有权契约**：帝国全部运行时状态的唯一写者（Owner）、读者（Reader）、
> 生命周期（Lifecycle）、持久化层级（Persistence）与更新频率以本表为准。结构性修订
> 必须走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15，禁止
> 静默改表。概念定义见 [EMPIRE_SYSTEM_MODEL.md](EMPIRE_SYSTEM_MODEL.md)；决策权
> 与 [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1 权力总表严格
> 一致；数据类型学与 research/26 §5 八表一致；存储机制依据 research/18。

## 1. 红线：一个状态一个写者

1. **每个状态字段必须有且仅有一个 Owner（唯一写者）。** 任何模块写入不属于自己的
   状态即为架构违规（依据 research/26 §3；调和 §7）。
2. Reader 默认任意（全系统只读）；表中「Writer」列仅当执行载体与 Owner 分离时标注，
   本模型不承认 Owner 之外的决策写者。
3. 唯一写者是幂等的充要条件：重复 tick、global reset、部分失败**不得**产生重复
   对象（依据 research/26；红队 A12）。
4. Demand（瞬时候选）与 Task（租约）不是持久状态：Demand 每 tick 重导出、不持久化；
   Task 六态（offered→claimed→succeeded/failed/expired/cancelled）生命周期归执行
   层契约（见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md)），不入本表。

**违规示例（全部非法）**：

| 违规示例 | 违反的后果 |
| --- | --- |
| Defense 绕过队列直接 `spawnCreep` | 第二 spawn 写者，幂等与全局核算破坏（DECISION_AUTHORITY Q3） |
| 角色 work 钩子直接 `createConstructionSite` | 绕过 site 唯一写者，全局 site 上限失控 |
| 两个系统同 tick 写 `posture` | 姿态撕裂；posture 只归 Policy 纯函数 |
| Self-Healing 直接改 Memory 结构 | 绕过迁移器（research/22 §10.3 不可越权清单） |
| 系统 A 深读系统 B 的 Memory 内部字段 | 边界腐化；跨系统只允许经 Public Interface |

## 2. 三级存储准入判据（依据 research/18 §10.1）

| 层 | 准入（仅当满足才允许进入） | 禁止进入 | 失效条件 |
| --- | --- | --- | --- |
| **Memory**（版本化真相） | 跨 tick 必须存活的**决策状态**：ID、枚举、少量数字、短 key | 完整路径、运行时索引、历史日志、对象引用、长字符串 | 显式删除或迁移；永不被 heap 依赖 |
| **heap/global**（可重建缓存） | 丢失后可从 Memory + Game 重建的派生索引、快照、路径、累加器 | 任何「丢了就无法重建」的状态 | TTL 到期 / 结构版本变化 / global reset（随时发生） |
| **RawMemory segment**（冷数据） | 低频写、低频读的档案：intel、遥测聚合、战争账本、市场档案 | 生存决策的当前值；高频写数据 | 各类自带 TTL + 容量上限；分页轮换 |

一句话判据：**Memory 答「帝国决定过什么」，heap 答「帝国这 tick 算得快不快」，
segment 答「帝国记住了什么」**（research/18 §10.1）。Memory 值类型白名单：
短 string / number / boolean / 枚举 / ID 引用 / 浅层数组；RoomPosition 一律拍平为
`roomName+x+y` 复合短 key（research/18 §10.2）。

## 3. 状态所有权总表

六列定义：Owner=唯一写者；Reader=合法读者；Writer=执行载体（仅当与 Owner 分离）；
Lifecycle=创建→更新→归档→清理；Persistence=存储层级；Frequency=更新频率。

### 3.1 EmpireState（posture / 预算 / 房间注册 / GCL）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| posture + 各域 budget（PostureDecision） | Empire 战略系统（Policy 纯函数求值） | 任意（只读） | — | 首次求值创建；态势分频刷新；切换必须带滞回（hysteresis）+ minDuration（war 退出窗口 ≥ 一个波次周期，红队 A3） | Memory 瘦字段（枚举 + 短数字 + 切换原因码） | 态势分频；快照未刷新则沿用上次决策（红队 A1） |
| 房间注册（自有房名单）+ GCL 管理 | Empire | 任意 | — | claim / 放弃事件创建；失守归档入遥测后清理；GCL 数值由 `Game.gcl` 派生，不落 Memory | Memory（房间名短 key 数组） | 事件式（房间增减） |
| EmpireSituation（威胁 / 净流 / CPU 健康 / 扩张机会） | Empire | Policy、Agenda 复核 | — | 每轮聚合重建；不归档（历史走遥测） | heap 派生（N tick 全量 + 每 tick 增量） | 分频聚合（research/26 §3） |

### 3.2 RoomState（phase / 能量收支 / 人口 / 建造 / 防御 / 健康度）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| phase（能力门槛相位） | World Model（房间状态归一化系统） | 任意 | — | 归一化时判定，锚定结构相变点（storage/link/terminal/factory/双 spawn）；只升不降除失守重置 | Memory 瘦字段（枚举） | 全量每 N tick + 增量每 tick |
| 能量收支 / 人口 / 建造 / 防御 / 健康度 | World Model | 任意 | — | 每 tick 增量更新；曲线与历史不入 Memory（走遥测 segment）；房间注销时整节删除 | Memory 瘦字段（水位 / 计数）+ heap 派生索引 | 增量每 tick / 全量每 N tick |
| RoomSnapshot（本 tick 只读快照） | World Model | 角色、各系统 | — | 每 tick 重建，tick 末作废；禁止跨 tick 假设 | 瞬时（heap） | 每 tick |

### 3.3 AgendaItem 状态（承诺生命周期：立项→执行→核验→完成/取消/降级）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| AgendaItem（类型 / 预算 / 期限 / 取消条件 / 属地 / 状态） | Agenda 管理器（立项授权仅来自 Empire Policy） | 任意（只读）；属地母房读执行参数 | — | 立项（authorized）→执行（active）→核验（verifying）→终态三选：completed / cancelled / degraded（降级=收缩承诺或回池）；终态归档进遥测 segment 后从 Memory 删除 | Memory（仅活跃项，O(active agendas)，research/26 §7） | 低频复核（每 100+ tick 级）；立项 / 取消事件式 |
| 触发立项的 Demand 转译字段 | Agenda 管理器 | — | — | 立项时一次性转译（Demand 持久化的唯一例外，调和 §2） | 并入 AgendaItem 字段 | 事件式 |

### 3.4 CreepState（identity / targetId / 心跳 / 失败计数——Memory 瘦规范）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| identity（role 枚举 / home 房名 / 诞生 tick） | 执行运行时（role-runner 代角色） | Spawn census、分配服务 | — | 孵化时创建一次；死亡由低频清理钩子删除（两阶段，research/18 §10.4） | Memory 瘦字段（每角色固定契约，禁止自由生长） | 孵化时写一次 |
| targetId 缓存 | 执行运行时 | — | — | acquire 相位写；目标消失即失效重取 | Memory（ID 引用） | 事件式（相位切换） |
| 心跳 / 失败计数 / 卡位计数 | 执行运行时 | Self-Healing（对账） | — | 每 tick 顺带更新；任务完成或恢复动作归零 | Memory（短数字） | 每 tick（顺带） |

### 3.5 SpawnState（队列 / 幂等 key / 黑名单 / 车道）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| 孵化队列（车道 / 优先级 / deadline） | SpawnManager（全局唯一 spawnCreep 写者） | 提交方（查询自身请求状态） | 提交方仅经 Public Interface 登记请求 | 提交创建（幂等 key 合并去重）；`spawning` 与已提交请求计入人口；成交 / 撤销 / 过期即清理 | Memory（队列） | 每 tick 消化 |
| 幂等 key / 黑名单冷却（SP-2）/ 车道占用 | SpawnManager | — | — | 提交时登记；成交后释放；黑名单冷却到期必须复评 | Memory（短 key + 计数） | 每 tick / 冷却到期事件式 |

### 3.6 EconomyState（净流 / 储备 / 预算——多为派生）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| 净流 / 储备水位 / 预算配额 | Economy 系统 | Policy、房间、Logistics | — | 从 RoomState 与快照派生重算；仅断档判定所需的关键水位快照落 Memory | heap 派生为主 + Memory 瘦快照 | 每 N tick（10–100，错峰散列） |
| 三指标平滑值（cpuIdle / heapFree / memoryFree） | Economy（观测寄生） | 扩张门控、Policy | — | 指数平滑滚动更新；不归档（聚合进遥测） | heap（L2 聚合） | 采样每 N tick（research/20 §10.4） |

### 3.7 MilitaryState（war 授权 / 账本 / 止损计数）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| war 授权 | Policy（war posture 唯一授权链） | war-planner、任意 | — | 随 posture 切换（滞回 ≥ 波次周期）；退出经止损链或核验 | Memory（并入 EmpireState.posture） | 态势分频 |
| 止损计数 / warBlacklist / 波次账本（spawned / 损失） | war-planner（唯一进攻执行决策者） | Policy（压力评估） | — | 授权时开账；spawned 超限强制收摊；黑名单冷却到期复评；战后归档 | Memory 瘦（计数 + 短 key） | 战时每 tick 计数 / 复核低频 |
| WarOutcome 事件（战后核验） | war-planner（evaluateWarOutcome 纯函数产出，只信新鲜 intel） | 遥测、复盘 | — | 战后核验时写一次；滚动窗口保留 | segment（经遥测管线） | 事件式 |

### 3.8 IntelState（四域 / TTL / 置信度——segment）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| IntelEntry（四域：房间 / 玩家 / 资源 / 市场；TTL；置信度 fact / stale / inferred） | Intelligence 系统（唯一写者） | 扩张尽调、战争授权、市场决策（查询） | — | 观察触发写入；无视野随龄降级（fact→stale→inferred），超 TTL 清为「未知」；超容量环形覆盖 | segment（分页哈希 + 压缩；激活预算集中管理，research/18 §10.5） | 写事件式；老化低频；读按需（异步：本 tick 请求下 tick 可读，禁止进生存链路） |
| 威胁记忆（玩家级） | Intelligence | Policy、Defense | — | 被攻击刷新；月级长 TTL | segment（独立 1–2 段） | 战略层低频 |

### 3.9 TrafficState（意图账本——瞬时 tick 内）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| 移动意图账本 + 仲裁结果 | TrafficResolver（tick 末按房仲裁，唯一 move 签发者） | 仲裁器自身 | 角色仅登记「自己那条意图」；仲裁与签发仅 Owner | 每 tick 重建；仲裁签发后 tick 末整体销毁 | 瞬时（tick 内 heap，禁止持久化） | 每 tick |

### 3.10 TelemetryState（聚合——segment 低频）

| 字段组 | Owner | Reader | Writer | Lifecycle | Persistence | Frequency |
| --- | --- | --- | --- | --- | --- | --- |
| L1 计数器 | 各系统自有（各自唯一写者，仅累加） | Observability | — | 每 tick 累加；L2 快照后清零 | heap（reset 即丢，可接受） | 每 tick（近零） |
| L2 聚合值（分位数 / 平滑值） | Observability | 仪表盘、自治算法（一鱼两吃） | — | 每 N tick 快照计算 | heap + 并入 L3 | 每 N tick |
| L3 TelemetryFrame | Observability | 体外平面（只读） | — | 批量压缩写 segment；滚动窗口 + 降采样（新密旧疏） | segment | 每 N×M tick（research/21 §10.2） |

## 4. 迁移规范（引用）

Memory 结构变更**必须**遵守（规范正文与步骤细节见
[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md)；依据 research/18 §10.2–10.3、
红队 A6）：

1. 每次结构变更升 `schemaVersion`；迁移注册为 `n → n+1` 链，禁止跨版本跳跃。
2. 每步幂等：重放不产生副作用（先检查目标态再动手）。
3. 顺序铁律：先写新字段 → 读到有效值 → 才删旧字段；任何一步失败保持旧
   `schemaVersion`，下 tick 重试。
4. 大迁移按 cursor 分 tick，**游标与完成标记必须存 Memory（非 heap）**；
   `schemaVersion` 仅在全部步骤成功后更新。
5. 旧版代码遇更高 `schemaVersion`：只读、不写、输出告警。
6. 迁移期间 P0 生存链路照常运行；任何系统不得绕过迁移器写新结构字段
   （DECISION_AUTHORITY §1 末行）。
7. 新增字段必须同步三件：类型定义、默认值工厂、迁移步骤——以 `CONFIG.memory`
   为单一真相源，数字仅为快照。

## 5. 派生状态重建语义（global reset 后）

1. **不变量**：heap 全部状态必须可从 Memory + Game 对象全量重建；生存链路（P0）
   只依赖 Memory + Game，heap 仅加速（research/22 §10.4）。
2. **惰性重建**：reset 后不集中全量重建；消费者先读先建（按使用顺序分摊成本），
   reset 后首 tick 预留重建预算，超额度部分顺延（research/20 §10.3）。
3. 缓存条目契约：`{ value, seed(结构版本), created, ttl }`；结构版本变化立即失效，
   不等 TTL；TTL 写在 get 侧（research/18 §3）。
4. **禁止**把 heap 状态「抢救」进 Memory——那是把缓存升级成持久层，违反 §2 分层
   （research/22 §11）。
5. reset 事件记 `globalResetCount` 与重建耗时进遥测（research/18 §12）。

## 6. 一致性声明

本表与 [DECISION_AUTHORITY_MODEL.md](DECISION_AUTHORITY_MODEL.md) §1 权力总表、
[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) 各模块 State Ownership 行、
research/26 §5 数据契约**同一时刻必须一致**；任何一处修订必须同步其余各处并走
ADR。
