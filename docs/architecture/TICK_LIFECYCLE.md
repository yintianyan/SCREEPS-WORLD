# TICK_LIFECYCLE · Tick 生命周期（冻结蓝图）

> 本文件是**单 tick 相位序契约**：十相位的执行者、输入输出、CPU 档位与失败语义
> 以此为准。结构性修订必须走 ADR 并登记 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)
> §15。本序是 research/26 §3 八步数据流的冻结层重定义（对照表见 §3），与
> [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2 管线序、[DATA_FLOW.md](DATA_FLOW.md)
> 三图严格一致。依据：research/19 §10、research/26 §3、research/20 §10.1、
> 红队 A1/A5/A8/A12。

## 1. 十相位总表

| # | 相位 | 执行者 | CPU 档 | 一步话契约 |
| --- | --- | --- | --- | --- |
| ① | Kernel 启动 | Kernel | P0 · O(1) | 迁移检查、看门狗求值、档位广播、激活 segment 读取 |
| ② | 感知增量 | World Model | P0 · O(rooms) | 快照重建 + 增量归一化（全量每 N） |
| ③ | Policy 求值 | Empire | P1 · O(1) | 态势分频；过期沿用 |
| ④ | Agenda 复核 | Agenda 管理器 | P2 · 低频 | 分频窗口内复核；非窗口零成本 |
| ⑤ | Demand 生成 | 各业务系统 | P0/P1/P2 分层 | 缺口推导 + 请求池登记 |
| ⑥ | 分配 | 分配服务 + SpawnManager | P0 · O(queue) | intent 合并排序、租约匹配、队列消化 |
| ⑦ | 执行 | Execution Runtime | P0 · O(creeps) | RolePolicy 钩子管线；非移动直发 + 意图登记 |
| ⑧ | 交通仲裁 | TrafficResolver | P1 · 近似 O(n)/房 | tick 末按房分桶统一签发 move |
| ⑨ | 遥测与自愈 | Observability + Self-Healing | P3 聚合 + P0 伴生 + P1 对账 | L1 伴生采样、低频聚合、分档对账 |
| ⑩ | 写回与请求 | Kernel + 各 owner | 近零 | owner 写入截止、segment 请求（下 tick 激活） |

通用失败语义（适用于全部相位，以下不重复）：每相位错误边界独立（safeRun 隔离，
单点异常不得中断整 tick）；**半 tick 幂等**——任意 tick 可能在任意动作后被切断，
重复 tick / 部分失败不得产生重复对象（幂等键、先写后删、租约 TTL、site 唯一写者，
KERNEL §7.2；红队 A12）。

## 2. 相位合同

### ① Kernel 启动

| 项 | 契约 |
| --- | --- |
| 执行者 | Kernel（组合根 `bootstrap.ts` 在首 tick 构建静态注册表，tick 内只遍历） |
| 输入 | RawMemory（schemaVersion + 迁移游标）、`Game.cpu` 采样（每 tick ≤2–4 次）、上 tick 末请求的 segment 激活结果 |
| 输出 | 迁移后的 Memory（游标续跑，分 tick）；本 tick 预算档位（只读广播） |
| 失败语义 | 迁移任何一步失败保持旧 `schemaVersion` 下 tick 重试（[MEMORY_ARCHITECTURE.md](MEMORY_ARCHITECTURE.md) §3）；P0 生存链路照常运行；注册表构建失败 = 启动即失败（fail-fast，不静默降级） |

### ② 感知增量

| 项 | 契约 |
| --- | --- |
| 执行者 | World Model（感知层，最上游 System） |
| 输入 | Game 可见对象；Memory 瘦状态；heap 缓存校验（TTL/结构版本） |
| 输出 | RoomSnapshot（每 tick 每房一次）；RoomState 增量（每 tick）+ 全量（每 N tick，※A1 分频）；派生索引刷新 |
| 失败语义 | 单房快照失败由 safeRun 隔离，该房按上 tick RoomState 降级运行并记异常；**禁止**跨 tick 复用 Snapshot |

### ③ Policy 求值

| 项 | 契约 |
| --- | --- |
| 执行者 | Empire（战略层；`evaluatePosture(situation)` 纯函数） |
| 输入 | EmpireSituation（②的分频聚合产物；快照未刷新则**沿用上次决策**，※A1） |
| 输出 | PostureDecision（posture + 五域预算 + 原因码；仅切换 tick 写 Memory） |
| 失败语义 | 求值异常由 safeRun 隔离并沿用上次 PostureDecision；posture 卡死由最大持续期兜底强制复评（research/06 §8） |

### ④ Agenda 复核

| 项 | 契约 |
| --- | --- |
| 执行者 | Agenda 管理器 |
| 输入 | Empire 授权（只读）；各 AgendaItem 复核快照；属地母房 Report |
| 输出 | 状态变更（终态三选 / 续期）；生命周期内维持的 Demand 流声明 |
| 失败语义 | 复核超成本上限按项分片顺延；Guarded 暂停新建；Conserve/Recovery 冻结常规复核仅评估取消（[PLANNING_ARCHITECTURE.md](PLANNING_ARCHITECTURE.md) §5） |

### ⑤ Demand 生成

| 项 | 契约 |
| --- | --- |
| 执行者 | 各业务系统（Logistics 请求池、Economy、Defense 威胁分级、census 人口推导、Intelligence 观察写入） |
| 输入 | 派生索引、RoomState、Agenda 声明流（双源汇流，[DATA_FLOW.md](DATA_FLOW.md) 图二） |
| 输出 | Demand（瞬时，聚合粒度＝房间×资源×用途）；intel 写入（segment，事件式） |
| 失败语义 | Demand 失败＝下一 tick 自然消失（不持久化）；Defense 应答属 P0，本相位不可被 Guarded 以下档位跳过 |

### ⑥ 分配

| 项 | 契约 |
| --- | --- |
| 执行者 | 分配服务（domain 纯函数）+ SpawnManager（队列消化） |
| 输入 | Demand 池；census（有效供给＝在役 + spawning + 已提交 intent）；租约簿 |
| 输出 | SpawnIntent 合并排序（车道 P0>P1>P2>P3 → Agenda 优先级 → 饥饿老化，※A12 幂等 key 去重）；`spawnCreep` 签发；Task 租约绑定 |
| 失败语义 | 合并在提交时按稳定 key 幂等（重复 tick 无 double-spawn，红队 A12）；SpawnManager 永不熔断，异常时由内核级紧急直通兜底（KERNEL §6，※A5：≥200 能量 `[WORK,CARRY,MOVE]`，本相位内可触发） |

### ⑦ 执行

| 项 | 契约 |
| --- | --- |
| 执行者 | Execution Runtime（role-runner 统一驱动 RolePolicy 钩子管线 gate/acquire/work/hold/onFlee/park/combat） |
| 输入 | creep 列表与注册的 RolePolicy；RoomSnapshot（只读）；租约与 targetId 缓存 |
| 输出 | 非移动动作直发（harvest/transfer/build/attack…，经唯一写者或角色动作出口）；移动**意图**登记进 TrafficState |
| 失败语义 | 单 creep 错误由 safeRun 隔离不中断同房其他 creep；连续失败 3 次进冷却（P0 永不冷却）；intent 税自检义务在本相位执行（[CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md) §4） |

### ⑧ 交通仲裁

| 项 | 契约 |
| --- | --- |
| 执行者 | TrafficResolver（tick 末，按房分桶，※A8） |
| 输入 | TrafficState 意图账本（⑦登记）；房间占据网格 |
| 输出 | 唯一 `move` 签发（房内意图网格索引近似 O(n)，房间间独立）；未获签发者的 park / 让位 |
| 失败语义 | 单房仲裁失败不影响他房；仲裁账本 tick 末整体销毁（不持久化）；卡位信号交 stuck-recovery 自愈 |

### ⑨ 遥测采样与自愈检查

| 项 | 契约 |
| --- | --- |
| 执行者 | Observability（L2/L3 聚合 P3）+ Self-Healing（分档对账 P1）+ L1 伴生采集（各系统，随相寄生，近零） |
| 输入 | 各系统 L1 计数器；Kernel 采样；错误签名（safeRun）；对账差（预期态 vs 实际态） |
| 输出 | L2 快照（每 N tick）；L3 TelemetryFrame（每 N×M tick，写 segment）；WARN/TAKEOVER 信号（P0 伴生，不因降级静默）；有界恢复动作 |
| 失败语义 | 聚合失败丢一个采样窗口（可接受）；TAKEOVER 输出与内核错误隔离同源、恒为 P0 伴生 |

### ⑩ Memory 写回与 segment 请求

| 项 | 契约 |
| --- | --- |
| 执行者 | Kernel 收尾（各 owner 在其相位内完成自有写入；引擎于 tick 末统一 stringify Memory） |
| 输入 | 本 tick 全部 owner 写入；segment 读需求（intel 页 / 市场档案 / 遥测 flush 队列） |
| 输出 | segment 激活请求（**本 tick 请求、下 tick ①可读**）；L3 flush；deadline 过期项的撤销登记 |
| 失败语义 | 被切断 = 半 tick 幂等语义兜底（owner 写入均幂等）；segment 请求丢失仅延迟一 tick 的冷数据读，不影响生存链路 |

## 3. 与 research/26 §3 八步的对照（细化关系）

| research/26 §3 八步 | 本契约十相位 |
| --- | --- |
| 1 感知（快照） | ①② |
| 2 归一化（分频） | ② |
| 3 战略（posture×budget） | ③ |
| 4 议程复核 | ④ |
| 5 分配（spawn intent / 租约） | ⑤⑥ |
| 6 执行（RolePolicy） | ⑦ |
| 7 仲裁（交通） | ⑧ |
| 8 反馈（遥测 / 自愈 / 调参） | ⑨⑩ |

差异说明：八步的「感知」被拆出 Kernel 启动相位（迁移与看门狗必须先于一切）；
「反馈」被拆出写回相位（segment 异步语义要求请求先于读取一个 tick）。实现层的
segments-request 前置形态（`src/kernel/segment-store.ts`：请求先于迁移执行，
reset 首 tick segment 未加载时守卫等待）与本序的差异属实现顺序登记：蓝图要求
**请求在 ⑩ 发出、① 读取**，任何「请求即读」的形态都违反 segment 异步合同。

## 4. 一致性声明

本相位序与 [KERNEL_ARCHITECTURE.md](KERNEL_ARCHITECTURE.md) §2（P0→P3、同优先级按
注册序；人口普查先于 spawn 消化）、[DATA_FLOW.md](DATA_FLOW.md) 三图、
[CPU_EXECUTION_MODEL.md](CPU_EXECUTION_MODEL.md) §1–§2（频带与看门狗联动）、
[SYSTEM_BOUNDARIES.md](SYSTEM_BOUNDARIES.md) §1 各模块 Tick Frequency 行同一时刻必须
一致；相位增删或顺序调整必须同步其余各处并走 ADR。
