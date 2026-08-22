# ARCHITECTURE_FREEZE · 架构冻结总契约

> **本文件是 Screeps AI Empire 的架构合同**：Phase 1 全部 36 份冻结蓝图的收敛点。
> 后续开发（agent 与人类）必须以本文件 + [ENGINEERING_BLUEPRINT.md](ENGINEERING_BLUEPRINT.md)
> + [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md) 为合同开工，**不得重新裁决
> 架构问题**（Empire/Goal/Task/Room 边界/Spawn 权限/Logistics 权限/Agent 边界等
> 已全部冻结；实现期发现冲突 → 走 §15 修订记录，禁止静默改契约）。
> 冻结日：2026-08-23。证据链：[../research/](../research/)（Phase 0）；
> 调和：[ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md)；
> 红队：[ARCHITECTURE_RED_TEAM.md](ARCHITECTURE_RED_TEAM.md)（V1–V11，修复已入 §15）。

## §1 冻结声明

| 项 | 契约 |
| --- | --- |
| 冻结对象 | 本文件 §2–§14 所列全部结构性裁决 |
| 冻结效力 | 蓝图与代码冲突时，以本合同为目标、代码为待迁移现状（AGENTS.md 裁决规则） |
| 修订通道 | 仅 §15（ADR 制）；任何旁路修改视为违规 |
| 待验证参数 | 数值层参数（SYNTHESIS §5 清单）不属结构冻结——按标注时点校准，但**参数所在的结构不可变** |

## §2 Core Concepts（核心概念 · 详见 EMPIRE_SYSTEM_MODEL）

系统=**闭环集合**（生存/能量/人口/知识/演化）跑在确定性 tick 运行时。17 概念
合同速查：**World**=被观察对象（只读快照）；**Empire**=唯一受限 Agent 载体（七
垄断权）；**Room**=本地六闭环单元（能力门槛 phase，无目标选择权）；**AgendaItem**
=中期承诺（唯一运行时形态；Directive/Operation 作为类型不存在）；**Goal**=声明式
谓词（不实例化）；**Policy**=posture 四态×五域预算纯函数；**Plan**=收窄为
AgendaItem 里程碑；**Demand**=瞬时缺口候选（不持久化）；**Task**=租约（六态）；
**Creep**=RolePolicy 载体；**Structure**=唯一写者封装；**Event**=分频触发器（无
EventBus）；**State**=分区所有；**Resource**=四类（energy/mineral/credits/CPU，
CPU 是第一公民）；**Threat**=四级评估；**Intel**=TTL+三分置信度冷数据。

## §3 System Boundaries（模块边界 · 详见 SYSTEM_BOUNDARIES）

15 模块合同（Kernel / Execution Runtime / World Model / Empire / Economy /
Logistics / Spawn / Construction / Intelligence / Defense / Military / Expansion /
Agenda 管理 / Observability / Self-Healing），每模块八项（职责/输入/输出/依赖/
接口/状态所有权/CPU 档/节奏）以 SYSTEM_BOUNDARIES §1 总表为准。**Planner 组件
不存在**（职责三分：Policy+Agenda 复核+确定性推导）。命名规约五后缀
（Agent/System/Service/Manager/engine）与删除判据见 SYSTEM_BOUNDARIES §2。

## §4 State Ownership（状态所有权 · 详见 STATE_OWNERSHIP_MODEL）

十状态（Empire/Room/AgendaItem/Creep/Spawn/Economy/Military/Intel/Traffic/
Telemetry）每项唯一 Owner；**红线：任何状态不得有第二个写者**；三级存储准入
（Memory 瘦=ID/枚举/数字；heap=可重建缓存；segment=冷数据）；迁移五步（版本化/
幂等/先写新后删旧/分 tick/游标入 Memory）；global reset 惰性重建。

## §5 Decision Authority（决策权 · 详见 DECISION_AUTHORITY_MODEL）

目标选择权**唯一归 Policy 纯函数**；六项全局唯一写者（spawnCreep/site×2/move/
market deal/跨房调拨）；四考题答案冻结：①帝国赢但有生存保底线；②posture 分账
（战争基金）非竞争；③防御走 P0 车道+内核直通（让路不绕路）；④车道→Agenda 序→
饥饿老化三级仲裁（先来先得非法）。冲突升级五级路径（分配服务→房间→Agenda→
Policy→人工接管）。

## §6 Data Flow（数据流 · 详见 DATA_FLOW）

三张冻结主图：World→AI（快照→归一化→派生索引，分频增量）；Strategy→Execution
（Policy→Agenda→Demand→Task→唯一写者；**环语义**：Agenda 与房间稳态共同生成
Demand）；Execution→Strategy（Outcome→遥测→健康度/自愈→Intel→Policy 输入）。
红队修订位置（A1 分频/A8 分桶/A12 幂等）已在图内标注。

## §7 Tick Lifecycle（tick 生命周期 · 详见 TICK_LIFECYCLE）

十相位冻结顺序：①Kernel 启动（迁移/看门狗/预算广播）→②感知增量→③Policy 求值
（分频，过期沿用）→④Agenda 复核（分频窗口）→⑤Demand 生成→⑥分配（spawn 排产/
租约匹配/Reservation 同相位写入）→⑦执行（RolePolicy 管线，移动登记意图）→
⑧交通仲裁（按房分桶签发 move）→⑨遥测采样与自愈检查→⑩Memory 写回与 segment
请求。每相位失败语义=safeRun 隔离+半 tick 幂等。

## §8 Dependency Rules（依赖规则 · 详见 DEPENDENCY_GRAPH）

最高三禁令：**Execution 不得反向依赖 Strategy；Creep/RolePolicy 不得直达
SpawnManager/Construction（只经 Demand/申请标记）；任何模块不得 import Kernel
内部**（只经公开接口）。另：domain 层禁止访问 Game/Memory（纯函数律）；模块顶层
禁止访问 Game/Memory（组合根注入）；import 方向 lint 是合并门槛（六义务）。

## §9 CPU Rules（CPU 规则 · 详见 CPU_EXECUTION_MODEL）

六档频带（每 tick P0 链/高频/中频/低频/事件式分频触发/紧急）；四档看门狗按
`Game.cpu.limit` 比例化（禁写死账户数字），降级立即、恢复滞回，牺牲序 P3→P2→
P1（P0 永不）；每房预算 B=U−F−C 结构；intent 先检后发（0.2 CPU 税）；寻路三档
限频+两级；pixel 仅 Healthy；reset 后首 tick 用 500 bucket 透支余量。

## §10 Memory Rules（Memory 规则 · 详见 MEMORY_ARCHITECTURE）

三级存储准入契约；schema 版本化+幂等迁移五步；heap=TTL+惰性重建（禁 tick1 全量
风暴）；segment 分域布局+每 tick ≤10 段激活轮转；体积 O(rooms) 上限+孤儿清理；
禁止清单（路径/历史/运行时索引/完整对象入 Memory）；MemHack 极端形态否决。

## §11 Agent Rules（Agent 规则 · 详见 AGENT_ARCHITECTURE）

判据：**运行时目标选择权**。全系统唯一受限 Agent=帝国战略层（确定性纯函数）；
其余全部确定性系统。无 Agent Runtime；命名禁令（Agent 后缀滥用违规）；自治
交付必须按 A0–A5 门槛诚实分级报告（bonzAI 先例）。

## §12 LLM Boundary（LLM 边界 · 详见 LLM_BOUNDARY）

**LLM/外部控制平面禁止进入 tick 执行路径**（物理：运行时无出站网络）。三层允许：
L1 开发研究员 / L2 低频参数顾问（白名单+值域+统计窗口+canary+自动回滚，消费点=
tuning 覆盖层）/ L3 灾难接管辅助（人工在场）。五禁：tick 决策/事实裁决/未验证
代码直上/schema 绕过/自部署闭环。外部不可用时帝国必须照常安全运行。

## §13 Testing Strategy（测试策略 · 详见 TEST_ARCHITECTURE）

八类层级（Unit 纯函数律 / Simulation fake adapter / Integration / Scenario
RCL1→8 / Empire 多房 / Stress 10-50 房+soak / Failure S1–S10 注入 / PvP）；
验收指标与遥测共用（一鱼两吃）；CI 合并门槛=typecheck+test+build 全绿；canary
发布合同。

## §14 验收与验证

- 门槛：A0 可运行 / A1 生存闭环 / A2 产能闭环 / A3 多房自治 / A4 威胁下运营 /
  A5 长期不退化（research/27；EMPIRE_MVP=A1+A2）。
- 十场景推演（ARCHITECTURE_VALIDATION Scenario A–J）全部闭合。
- 双红队（research/30 结论攻击 + ARCHITECTURE_RED_TEAM 结构攻击）通过；元教训
  冻结为验收问题：**每类资源必须有显式上限与收敛机制**。

## §15 修订记录（ADR 制 · 唯一合法修订通道）

**流程**：提议（问题/选项/取舍）→ 论证（引证据）→ 登记（本表新增 R#）→ 受影响
契约文档同步标注「已被 R# 修订」。禁止静默修改。

| R# | 日期 | 性质 | 内容 | 受影响契约 |
| --- | --- | --- | --- | --- |
| R1 | 2026-08-23 | 红队 V2 修复（新增条款） | **半 tick 一致性**：一切预留类写入（Reservation/配额扣减）必须在产生决策的同一相位完成（⑥分配相位），禁止推迟到⑩写回相位；跨相位只读快照 | STATE_OWNERSHIP §6 |
| R2 | 2026-08-23 | 红队 V3 修复（新增条款） | **P0 保留容量**：spawn 队列 P0 车道保留位不被低车道长期占位；P0 存在等待时低车道让位或降档重排（叠加 KERNEL §6 紧急直通双保险） | SPAWN §2.2 |
| R3 | 2026-08-23 | 红队 V4 修复（新增条款） | **预算死区**：五域预算变更带 EMA 平滑与变更死区（小于死区不生效）；预算快照随 posture 滞回一起冻结（防 budget 抖动） | GOAL_POLICY_PLAN §4 |
| R4 | 2026-08-23 | 红队 V5 修复（新增条款） | **资源回购窗口**：被取消 AgendaItem 释放的预算在冷却期内优先保留给其恢复，不立即并入公共池（防 Agenda 间振荡） | PLANNING §5 |
| R5 | 2026-08-23 | 红队 V6 修复（新增条款） | **依赖环检测**：AgendaItem 预算互依赖必须显式声明（依赖字段）；复核时检测等待环，检出入环即自愈强制降级低优先级项破环 | DECISION_AUTHORITY §3 |
| R6 | 2026-08-23 | 红队 V7 修复（新增条款） | **指标注册表上限**：遥测核心指标为固定集；扩展指标须声明单指标成本与聚合档位；Recovery 档仅保留核心集（防遥测自身爆炸） | CPU_EXECUTION_MODEL 遥测节 |
| R7 | 2026-08-23 | 红队 V8 修复（新增条款） | **segment 总量预算+滚动窗口**：每域冷数据保留窗口外的记录聚合为摘要后删除；100×100KB 分配表带余量警戒线 | MEMORY §4 |
| R8 | 2026-08-23 | 红队 V9 修复（新增条款） | **AgendaItem 类型集=冻结枚举**（远矿/扩张/战争/重建/准军事五种）：新增类型须走本 §15 ADR 且证明无法用既有类型+参数表达；同类型实例数上限（远矿车道 ≤6 先例） | PLANNING §3 |
| R9 | 2026-08-23 | 红队 V10 修复（新增条款） | **System 注册表上限 15+3**：新 System 须 ADR 证明既有系统无法承载且不违反单一职责下限（防 System 碎片化增殖） | SYSTEM_BOUNDARIES §2 |
| R0 | 2026-08-23 | 初始冻结 | 36 份冻结蓝图整体生效（本文 §2–§14） | 全部 |

**完成标准回执**（任务书 §39）：把 FREEZE+ENGINEERING_BLUEPRINT+
IMPLEMENTATION_PHASES 交给任何 coding agent，其只应问「Phase N 的实现要求」，
不应再问架构怎么设计——若仍需重决 Empire/Goal/Task/Room/Spawn/Logistics/Agent
边界，视为本 Phase 未完成。
