# KERNEL_ARCHITECTURE · 内核架构（冻结蓝图）

> 本文件是**内核契约**：Kernel 的职能边界、系统管线、看门狗、熔断器、饥饿老化、
> 紧急直通与崩溃恢复以此为准。结构性修订必须走 ADR 并登记
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md) §15。裁决依据 research/19
> （Quorum vs 平铺证据）、research/20（预算模型）、research/22（熔断 / 恢复）、
> 红队 A5/A6；模块八项边界见 [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1.1。

## 1. 裁决：轻量内核，仅四职能

Kernel **必须**存在，且**仅当**以下四职能归其所有（research/19 §10.1）：

| # | 职能 | 契约 |
| --- | --- | --- |
| 1 | 固定顺序调度 | 按 System 注册表以 P0→P3、同优先级按注册序遍历执行 |
| 2 | 错误隔离 | 所有系统与 creep 走 `safeRun`；单点异常不得中断整 tick |
| 3 | 四档看门狗 | Healthy / Guarded / Conserve / Recovery；阈值按 `Game.cpu.limit` 比例化 |
| 4 | Memory 迁移 | 版本化、幂等、分 tick（规范见 [MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md)） |

内核只维护运行秩序，**禁止**感知具体角色、经济策略或房间语义。新业务 = 组合根
注册新 System，**不改 Kernel**。

### 1.1 否决清单（OS 式语义，永久否决）

| 否决项 | 否决理由 |
| --- | --- |
| process / PID 进程抽象 | 战绩证据不对称：平铺阵营战绩更好、Quorum（唯一完整 OS 内核）2021 停更——进程载体是结构税非必要条件（research/19 §5） |
| sleep / wake / 消息传递 | 单线程 tick 无并发语义：无中断、无抢占点，进程间消息退化为同 tick 顺序调用（research/19 §3） |
| 抢占式调度 | 单线程顺序执行中不存在抢占时机（research/19 §3） |
| EventBus 中枢 | 执行顺序不可推理 + 订阅风暴；事件仅存两种合法形态——分频触发器与 AgendaItem 条件（调和 §6） |
| 每 tick 动态优先级重排 | 破坏确定性可回归；固定牺牲序 + 饥饿老化已覆盖需求（research/19 §11） |
| 效用竞拍式调度 | 决策抖动 + 拍卖自身 CPU 成本（research/19 §11） |

裁决性质：Quorum/hivemind 证明的**语义**（cadence / budget / qos / 熔断）全部
收编；被否决的只是**载体**（research/19 §5）。

## 2. 系统管线

### 2.1 组合根注册制

1. `src/bootstrap.ts` 是**唯一组合根**：新增角色 / 系统只改此文件与新模块，
   不改 Kernel（AGENT.md）。
2. 注册名全局唯一 kebab-case；重复注册**启动即失败**。
3. 模块顶层禁止访问 `Game` / `Memory`（AGENT.md）。
4. 注册表为启动期构建的静态结构，tick 内只遍历调用；禁止每 tick 重建闭包 / 排序
   （research/19 §9）。
5. 注册顺序即同优先级执行顺序；写组合根者必须理解顺序依赖（如人口普查先于
   spawn 消化），顺序注释与集成测试锁定执行序（research/19 §8）。

### 2.2 优先级语义表（P0–P3 = 降级牺牲序）

| 档 | 语义 | 典型系统 | 降级行为 |
| --- | --- | --- | --- |
| P0 生存 | 缺它帝国立刻死 | 错误隔离本身、spawn（灾后恢复）、基础采集 / 物流、防御应答、房间快照 | **永不跳过、永不熔断、永不冷却、永不降级** |
| P1 稳定 | 缺它帝国慢性失血 | 帝国战略、任务分配、Economy、link、Self-Healing、交通仲裁 | Conserve 档降频（每 2–5 tick） |
| P2 发展 | 缺它帝国停滞 | 建造、远矿、扩张评估、议程复核、war-planner、Intel | Guarded 档降频，Conserve 档暂停 |
| P3 增长 | 锦上添花 | 遥测聚合、tuning、pixel | Guarded 档即暂停 |

P 序是**降级牺牲序而非重要度排名**：P0 的量永远最小，预算大头在 P1
（research/19 §10.2；分配公式归 [CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md)）。

## 3. 四档看门狗（watchdog）

### 3.1 比例化合同

1. 所有软 / 硬上限与档位阈值**必须**定义为 `Game.cpu.limit` 与 bucket 水位比例的
   函数：`threshold = Game.cpu.limit × k`（k 为无量纲系数），**禁止**在任何代码或
   配置中写死账户级数字（research/19 §10.3；AGENT.md）。
2. 系数 k 与恢复滞回的 N 值集中定义于 `CONFIG`（单一真相源），初值保守、由
   tuning 引擎按 soak 数据调整（research/19 §12）。
3. `Game.cpu.getUsed()` 采样每 tick 限制在档位点（2–4 次）——采样不是免费 API
   （research/19 §9）。

### 3.2 升降档铁律

- **降级立即生效**：越线当 tick 内即裁剪（P3 停、P2 降频），不等下一轮。
- **恢复必须滞回（hysteresis）**：仅在健康条件稳定 N tick 后逐档回升，禁止越线
  即升（research/19 §8）。
- 看门狗档位每 tick 对全部系统只读广播（见 SYSTEM_BOUNDARIES §1.1 Output）。

### 3.3 各档允许动作表

| 档 | 进入条件（比例化） | 允许动作 | 禁止动作 |
| --- | --- | --- | --- |
| Healthy | bucket 充裕 且 用量 < 软上限 | 全系统全频；桶满时 tick 末空闲可 `generatePixel`（war / 恢复姿态熔断） | — |
| Guarded | bucket 越软线 或 用量连续超软上限 | P0/P1 全频；P2 降频；寻路限频收紧一档 | P3 运行；pixel 生成 |
| Conserve | bucket 逼近硬线 | 仅 P0 + P1 降频（每 2–5 tick）；移动复用缓存路径 | P2/P3 运行；扩张立项 |
| Recovery | bucket 触底 / 前一 tick 超时被切断 | 最小生存集（P0 + 能量自给），停一切中长程工作 | 一切发展 / 增长类工作；饥饿老化「必跑」标记（见 §5） |

> 术语注记：看门狗**只有四档** `CpuTier`（`healthy/guarded/conserve/recovery`，
> 阈值唯一真相源 `CONFIG.cpu.tiers`）。发布运行态中的 Emergency Survival Mode
> （bucket < 100 级紧急安全状态）是 Recovery 档内的再收缩层，**不是第五档 CpuTier**；
> 定义见 [RELEASE_GATE_AND_ROLLBACK.md](../implementation/RELEASE_GATE_AND_ROLLBACK.md) §5.2。

## 4. 熔断器（circuit breaker）

1. 同一错误签名**连续失败 3 次** → 进入冷却 50–200 tick（时长按时长表，P 级越高
   越短）（research/22 §10.5）。
2. **P0 永不冷却**：错误隔离照常，冷却跳过，仅降频重试（红队 A5）。
3. 冷却期内：该系统跳过执行；**相同错误每 25 tick 限流记录一次**（防刷屏）。
4. 冷却到期**必须复评**（再执行并观察），禁止「到期默认恢复」掩盖间歇故障
   （research/22 §10.5）。
5. 熔断 / 冷却状态必须存 Memory（小枚举 + 计数），禁止存 heap——防 reset 后冷却
   失效反复撞墙（research/19 §9）。
6. 熔断事件与恢复结果全部进遥测；实现细节与自愈闭环的关系见
   [FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md)。

## 5. 饥饿老化（starvation aging）

1. 被跳过计数随 tick 增长；超阈值后该系统获得一次「必跑」标记——在当前预算允许
   的最高档内执行（research/19 §10.5）。
2. 适用范围：P2 / P3——防「永远在降级、永远不发展」的僵死（风险 R-05）。
3. **Recovery 档不生效**（保命优先）；Recovery 持续超阈值必须升级为人工接管信号
   （research/19 §12）。

## 6. 内核级紧急直通路径（红队 A5）

1. 触发条件：灾后 / 防御孵化需求成立，且可用能量 ≥200，且普通 P0 车道通道不可用
   （SpawnManager 异常 / 人口断档）。**不依赖任何 P1+ 系统健康**。
2. 动作：立即孵化最小单元 `[WORK, CARRY, MOVE]`。
3. 车道语义：直通路径是 **P0 车道内的最高优先级直通位**，不是队列外绕过——
   `spawnCreep` 调用仍唯一经过 SpawnManager，**不存在第二个写者**（调和 §10.4；
   DECISION_AUTHORITY Q3）。内核仅负责触发判定与放行。
4. 每次直通必须记录越权原因进遥测（research/19 §10.5）。
5. 官方兜底事实：房间 spawn+extension 总能量 <300 时每 tick 自回 1 能量——灾后
   最小重建在数学上总是可行（research/29 R-01）。

## 7. 崩溃恢复

### 7.1 global reset

1. 检测：heap 哨兵变量消失即判定 reset（research/22 §10.4）。
2. **惰性重建**：不集中全量重建；消费者先读先建，按使用顺序分摊成本；reset 后
   首 tick 预留重建预算，超额度顺延（research/20 §10.3）。
3. **不变量**：生存链路（P0）只依赖 Memory + Game 对象，heap 仅加速——reset 后
   第一 tick 帝国可运行（慢）是设计不变量，不是优化目标（research/22 §10.4）。
4. 禁止把 heap 状态抢救进 Memory（违反三级存储分层）。
5. reset 事件记 `globalResetCount` 与重建耗时进遥测。

### 7.2 半 tick 幂等

1. 任意 tick 可能在任意动作后被切断——**所有写动作必须幂等**：重复 tick、tick
   重放、部分失败不得产生重复对象（research/26 §3）。
2. 幂等手段按写者契约执行：spawn 幂等 key、site 唯一写者、市场订单幂等键 +
   成交核验、Memory 迁移「先写新→验证→删旧」。
3. 迁移中断（分 tick cursor 半途 reset）由迁移规范兜底：游标入 Memory、每步幂等、
   全部成功才升 `schemaVersion`（红队 A6；research/18 §10.3）。

## 8. 内核不感知业务

1. `src/kernel/` **禁止** import `src/systems`、`src/creeps`、`src/domain` 的业务
   符号；内核不直接调 `spawnCreep` / `createConstructionSite`（research/19 §10.6；
   §6 紧急直通由内核触发、SpawnManager 执行，不构成例外）。
2. **已登记例外（R9，AGENT.md）**：kernel 直接 import 业务侧
   `pruneDeadCreepCache`（100 tick 低频维护钩子）。处理方式：
   - 该例外**仅此一项**，新维护钩子不得再以直接 import 形式进入内核；
   - 维护钩子总数达到 **3 个**时，必须提取统一 registry 钩子机制并撤销直接
     import——「3 个」即重构触发器，不是容忍上限（research/19 §8；research/18
     §10.4）。
3. 钩子注册后内核仅遍历调用注册表，不感知钩子语义（与 §2.1 组合根注册制同构）。

## 9. 与其他契约的关系

| 契约 | 分工 |
| --- | --- |
| [CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md) | 预算分配公式、三档节奏判据、k 系数表 |
| [FAILURE_RECOVERY_ARCHITECTURE.md](FAILURE_RECOVERY_ARCHITECTURE.md) | safeRun / 熔断实现细节与自愈闭环五阶段 |
| [MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) | 迁移规范正文、三级存储准入 |
| [SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) / [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md) | 模块八项边界 / 状态所有权 |
| [DATA_FLOW.md](DATA_FLOW.md) | 单 tick 八步数据流与写者唯一性落点 |
