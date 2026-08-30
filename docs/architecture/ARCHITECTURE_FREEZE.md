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
| 冻结效力 | 蓝图与代码冲突时，以本合同为目标、代码为待迁移现状（AGENT.md 裁决规则） |
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
| R10 | 2026-08-27 | 现状治理（放宽+合并计划） | **System 上限从 15+3 调整为 36**（以 `bootstrap.ts` 实际 `registerSystem` 调用数为唯一真相源），合并前 43 个 System 分三批合并：(1) A6 智能层 6→1 `intelligence-pipeline`（Shadow-Only post 系统，无 Game API、无执行行为，按内部分频串行 6 阶段）→ R11 裁决后从生产路径移除；(2) A5.4 战术运行时 4→1 `tactical-runtime-pipeline`（P2 main，仅在 war 姿态下运行，按内部分频串行 4 阶段）✅ 已完成；(3) 非蓝图 System 3→0 合并（specialization-planner→empire-strategy，logistics-planner→logistics，empire-health→self-healing）⏳ 后置。批 2 完成后 `bootstrap.ts` 实际 34 个 `registerSystem` 调用（R11 正式修正为 34）。批 3 可后置。**追记 2026-08-28**：第 (3) 项中 empire-health→self-healing 合并已被后续 ADR 取代——ENGINEERING_BLUEPRINT §5-4 裁决 empire-health-system 与 recovery-execution-system 保留分离，`self-healing.ts` 为概念性落点；批 3 有效范围收敛为 specialization-planner→empire-strategy、logistics-planner→logistics 两项（登记为重构 backlog B1，见 docs/STATUS.md）。**追记 2（2026-08-28）：批 3 已完成（B1）**——两系统注册移除、注册数 34→32；规划逻辑转为父系统（empire-strategy / logistics）内部门控 helper（systemPhase 绝对相位门保持原调度节律、独立 safeRun 错误隔离、P1 预算车道语义逐项保留），行为保持四件套全绿。 | SYSTEM_BOUNDARIES §2 |
| R11 | 2026-08-28 | 现状治理（删减式重构登记 + 正式裁决） | **intelligence-pipeline / decision-trace / evaluation-system 从生产路径移除**：删减式重构移除了 `src/kernel/decision-trace.ts`、`src/systems/evaluation-system.ts`、`src/telemetry/EvaluationRegistry.ts` 及对应 barrel export。`bootstrap.ts` 不再注册这三个系统，实际注册数从 36 降为 34。globalCache 中相关字段降级为 `unknown` 或保留为观测槽位。**正式裁决（B）**：从冻结目标正式删除 intelligence-pipeline / decision-trace / evaluation-system 的注册要求。`bootstrap.ts` 注册数从 R10 的 36 正式修正为 34。`src/domain/intelligence/` 源码和对应测试标记为 Shadow-Only 孤岛（不进入生产 bundle、不被任何 src 文件导入），后续分批清理。恢复条件：仅当 P0 运行时收口全部完成后，且有明确的消费者需求和 CPU/Memory 预算证明时，才可走新 ADR 恢复注册。**追记（2026-08-29）：Shadow-Only 孤岛清理已完成（backlog B5）**——`src/domain/intelligence/`（46 文件）与 `src/domain/strategy/decision-trace.ts` 已删除，仅验证设计源码的 24 个测试文件同步移除；R14 裁决 A6 智能层不恢复，本条恢复条件条款继续有效。**追记 2（2026-08-29）：E2E-011 冲突对齐完成（backlog B3）**——`tests/e2e/scenarios/11-decision-trace.test.ts` 移除（裁决移除而非重定向：生产唯一 outcome 发射点为扩张完成路径，单房 E2E 场景不可达，重定向即空断言；通用长稳断言由 E2E-006 覆盖），E2E 全套件跑通。 | SYSTEM_BOUNDARIES §2 · ENGINEERING_BLUEPRINT §5 |
| R12 | 2026-08-28 | 现状治理（自动化守卫追认登记） | **生产 bundle parity 守卫**：`tests/unit/architecture/compliance.test.ts` 新增三组守卫——①系统间值导入审计（禁止未登记的跨系统值导入）；②`dist/main.js` 必须包含 `bootstrap.ts` 全部系统 name 字面量（防注册丢失）；③bundle 禁止出现已裁决删除的模块标识（intelligence-pipeline / decision-trace / evaluation-system / EvaluationRegistry）。dist 不存在时 skip（CI 中 build 先于 test）。本行是对该已落地守卫的追溯登记；src 内其他遗留「R12/R13」字样为历史任务编号（如 movement intent v33-R12、TAC-R12 测试标签），与本 ADR 序列无关。 | TEST_ARCHITECTURE §2 · ENGINEERING_BLUEPRINT §4-⑤ |
| R13 | 2026-08-28 | 现状治理（合同修正：量级锚追认重置） | **现状规模追认 + 量级锚重置**：ENGINEERING_BLUEPRINT §2 各模块量级锚自冻结日（~160 文件 / 36k 行、domain ~60 文件）后随 Phase 实施扩张至 398 文件 / 103,242 行（domain 260 / 65.9k，含 Shadow-Only 46 文件），跳档已发生且未按本 §15 登记——违反「数量级跳档须 ADR」纪律。**裁决**：跳档为实施期正当扩张，予以追认、不回退规模；§2 量级锚列按现状重置为追认带（±25% 容差），此后超出锚带或跳档须新 ADR。规模唯一快照入口 = docs/STATUS.md（§7 刷新程序维护）。 | ENGINEERING_BLUEPRINT §2 / §4-⑦ · STATUS §2 |
| R20 | 2026-08-30 | 现状治理（测试基建统一脚手架立项 · backlog T1–T6） | **tests/support 统一脚手架内核 + 常量唯一真相源**：测试系统审计（2026-08-30）确认脚手架平行重复建设与孤儿设施——e2e `isJsError` 过滤逻辑 26 处重复、unit `makeSnapshot`×16 / `makeContext`×10 / `makeCreep`×6 复制工厂、`fixtures/inject.ts` 整文件 7 导出零引用、integration `Assertions` 类 10/15 方法零调用、两 barrel 共 22 个死 re-export、`tests/e2e/setup.ts` 与 `scripts/rebuild-driver-snapshot.js` 整段双实现；且 §1 Simulation「fake 只钉死官方文档＋引擎常量」条款无执行机制——`tests/setup.ts` 与 TestWorld 手写常量表已实际漂移（私有 FIND 编码 `FIND_SOURCES=1` vs 官方 105；`BUILD_COST.spawn=30000` vs 官方 `CONSTRUCTION_COST.spawn=15000`）。**裁决**：①立项 `tests/support/` 统一脚手架内核（constants/terrain/errors/snapshot/assertions/factories，零引擎依赖，unit/integration/e2e 三层共用；fake 世界模拟器与真引擎 harness 保持分层不合并）；②常量 SSOT = `@screeps/driver` constants（423 官方键，升为显式 devDependency 锁版本）+ e2e parity 哨兵场景（玩家可见常量逐键比对运行时全局），setup 私有编码与 TestWorld 本地常量表退役——此为 §1 Simulation 条款的执行机制落地；③bundle parity 守卫唯一实现收敛于 `tests/integration/framework/bundle-parity.test.ts`（dist 仅在 build 后存在），TEST_ARCHITECTURE §2 登记位置同步修订，`compliance.test.ts` 的 dist-skip 分支删除；④TEST_ARCHITECTURE §7 行为保持豁免条款：修正被假常量污染的 integration 断言预期值（如 spawn 建造成本相关）不视为「删断言转绿」，逐例登记于 T1 验收记录；⑤孤儿治理与 R19⑥「触摸即迁移」注入收编按 STATUS §6 T1–T6 执行，不追溯全量。 | TEST_ARCHITECTURE §1/§2/§4/§7 · E2E_ENV_BASE_CONTRACT · AGENT.md 质量门槛 · STATUS §6 |
| R19 | 2026-08-30 | 契约冻结（E2E 环境基座与注入架构） | **测试基建分层契约冻结**（[E2E_ENV_BASE_CONTRACT.md](../implementation/E2E_ENV_BASE_CONTRACT.md) 转正式）：①L0 基座 = t0 真实环境唯一标准答案（canonical 2 源平原房，fixtures/base.ts 全仓唯一构造器），变体环境一律 L1 具名注入；②注入分级 = 白名单注入（引擎合法语义）vs 测试后门（仅限构造前提，禁入断言路径），逐条具名登记；③证据效力矩阵铁律 = 自举轨为动态/历史结论唯一来源，注入轨不得外推速率/演化（SOAK_START_RCL 预置当自然解读的失真教训制度性堵死）；④基座变更走本 §15 ADR + 版本绑定；⑤自举轨一次铸全程（t0→RCL8 + 分阶段 census 对照 layout 契约）为版本证据工件；⑥存量场景触摸即迁移。 | TEST_ARCHITECTURE · E2E_ENV_BASE_CONTRACT · CANARY_SOAK_PROCEDURE §5 |
| R18 | 2026-08-29 | 能力实现（war 轨立项 · backlog W1–W5） | **war 轨立项**：把 IntelQuery 硬门槛接入战争授权的实战消费，并以对抗性场景验证 Phase 9 合同四验收门槛。工作项：**W1** 授权硬门槛接入——war-planner/war-planning-system 目标选择从 lastSeen 阈值口径切换到 `intelActionUsable`（fact 级 ∧ `CONFIG.war.targetFreshness` 年龄上限，INTELLIGENCE §5），demobilize 战后核验只信 fact 级复核（非 fact 降级 unknown）；**W2** 诱饵对抗场景（Scenario F：空城伪装/诱饵塔）验证「诱饵不触发授权」；**W3** war 账本证据——战争全程经济不越红线；**W4** 止损链实测——spawned 超限收摊 / warBlacklist 冷却 / 满编才 advance 的 e2e 战例；**W5** 战后核验战例——evaluateWarOutcome 只信战后新鲜 fact 级观察。验收门槛（Phase 9 合同）：战争全程经济不越红线；止损触发即收摊；满编才推进；诱饵不触发授权。前置：B7（IntelQuery 迁移）✅、P8 防御体系 ✅。风险：R-15 对抗演化、R-04 war↔fortify 振荡（退出滞回 ≥ 波次周期）。 | MILITARY_ARCHITECTURE · INTELLIGENCE_ARCHITECTURE §5 · IMPLEMENTATION_PHASES Phase 9 · DEFENSE_ARCHITECTURE |
| R17 | 2026-08-29 | 能力实现（Emergency Survival Mode · RELEASE_GATE §5.2 设计态落地） | **ESM 从设计态转为已实现**（内核行为变化，按 §5.2 要求登记）：①状态机在 `createBudget` 内按 tick 求值——进入 `bucket<100`、退出 `bucket≥500`（保命态无恢复滞回）；带内 `[100,500)` 保持，不抖动退出；②CpuTier 保持四档——ESM 是 Recovery 档内的再收缩层（`Budget.emergency` 旁路标志，非档位枚举成员）；③允许集收缩：`canStart` 在 emergency 时仅放行 P0 车道（spawn/快照/room-state/塔防/交通），`runCreeps` 仅 harvester 最小采集，其余角色与 P1+ 系统全部让位；④进入/退出沿各记一条 `EmergencySurvival` 遥测事件（EventKind=35）+ kernel log；⑤活动标志存 globalCache（heap 可重建），**不新增 Memory schema 字段**；⑥与人工灾难接管的边界不变（bucket<100 持续 500+ tick 升级人工信号，§6.1）。验证：单测（canStart 收缩/四档不变/非 ESM recovery 照常）+ E2E-018 确定性注入全链（进入→带内保持→退出，mockup driver 记账语义与 E2E-015 同源）。 | CPU_EXECUTION_MODEL · RELEASE_GATE_AND_ROLLBACK §5.2 · KERNEL_ARCHITECTURE §3 |
| R16 | 2026-08-29 | 缺陷修复（E5 rclStale 数据源语义错位） | **期望自检 E5 的数据源字段语义错位修复**：`RoomMemory.lastRcl` 由 layout-planner 写 **RCL 等级**（布局版本化用），E5 期望自检却将其当 **tick** 读（`age = tick − 3`）→ `rclStale` 对所有 rcl<8 房间**永久误报** + 每 tick `ExpectationViolation` 事件刷写。发现渠道：B6 验证轨新产物 P3 饥饿旁路整环集成测试（E2 闭环断言被该误报阻塞）。修复：①room-state（RoomState 唯一写者）维护专用 `lastRclLevel`（变化检测）+ `lastRclChangeAt`（变化 tick）；②E5 改读 `lastRclChangeAt`，undefined（无观测基准）诚实跳过——无数据 ≠ 停滞；③layout-planner 的 lastRcl 语义不变。新增 E5 单测 5 例（skip/阈值内/超阈/RCL8 豁免/boot 宽限）+ 整环集成测试 `p3-bypass-loop`。 | KERNEL_ARCHITECTURE §3 · FAILURE_RECOVERY 自愈横切 · TEST_ARCHITECTURE §2 |
| R15 | 2026-08-29 | 能力实现（IntelQuery 消费者迁移 · backlog B7） | **legacy 情报桥退役，全部消费者走 IntelQuery**：①`IntelEntry` 新增 `observedBy`（采集归属房——sponsor 归属与按房评分依据；同 subject 多房重复观测按 observedAt 最新归并）；②观察采集改为交接通道——room-observer 采集管线（observer 捕获 / 邻房刷新 / scout 视野 / pathCost 补算）写入 `globalCache.intelHandoff`（有界），`intelligence` 系统采用为 IntelEntry 并清空（IntelState 唯一写者不变，观察方不直写状态）；③查询 API 扩充 `queryRoomIntel()`（枚举，对应本文 IntelQuery `query(domain, filter)` 概念签名）与 `intelPayloadView()`（subject → RoomIntel 字段集视图）；④11 个消费者文件迁移 IntelQuery（B7 行列名的 6 系统 + 考古增补的 war-planning-system / expansion-planner / tactical-runtime-system / specialization-planner / room-observer）；⑤`Memory.rooms[].intel` 写侧下线，v43 迁移一次性清理存量（schemaVersion 42→43）；R11 白名单新增 11 条 IntelQuery 公开查询边。已知语义收敛（本 ADR 追认）：subject 全局去重后多房重复观测不再按房嵌套保留，pathCost 取最新观测房口径（单房行为不变；多房语义由多房 soak 验证，见 Blocked 登记）。 | STATE_OWNERSHIP §3.8 · INTELLIGENCE_ARCHITECTURE §0/§2.1 · RUNTIME_API_DESIGN §2 · SYSTEM_BOUNDARIES §1.12 · ENGINEERING_BLUEPRINT §5-14 · TEST_ARCHITECTURE §2 |
| R14 | 2026-08-29 | 能力实现（情报架构完整版 · backlog B4 裁决） | **Intelligence 系统注册为 IntelState 唯一写者**：新注册 `intelligence` 系统（P2 / 10t，注册数 32→33），实现 INTELLIGENCE_ARCHITECTURE 完整版核心合同——①三分置信度 fact/stale/inferred（来源信任 × 时效窗读侧派生，ally/derived 永远 inferred）；②TTL 分档（威胁短窗 / 动态中窗 / 资源长窗 + expiry jitter）；③房间域 heap 活跃层（256 容量环形覆盖 + 超期清理）；④玩家域威胁记忆 segment 5 冷存（月级衰减不删除，配额表 5–9 预留启用一位）；⑤§5 硬门槛查询落地（不可逆行动只认 fact 级 + 年龄上限；stale/inferred 只驱动两段式侦察）；⑥legacy `Memory.rooms[].intel` 为**只读输入桥**（room-observer 写侧保持运行至消费者迁移 IntelQuery，两状态各自唯一写者不变）。消费者迁移列为 war 轨前置。A6 智能层（src/domain/intelligence/）仍为 Shadow-Only，本裁决不恢复之。 | SYSTEM_BOUNDARIES §1.12 · INTELLIGENCE_ARCHITECTURE §0 · STATE_OWNERSHIP §3.8 · RUNTIME_API_DESIGN §2/§6 · DATA_FLOW 图一 · ENGINEERING_BLUEPRINT §2/§5-14 · docs/README |
| R0 | 2026-08-23 | 初始冻结 | 36 份冻结蓝图整体生效（本文 §2–§14） | 全部 |

**完成标准回执**（任务书 §39）：把 FREEZE+ENGINEERING_BLUEPRINT+
IMPLEMENTATION_PHASES 交给任何 coding agent，其只应问「Phase N 的实现要求」，
不应再问架构怎么设计——若仍需重决 Empire/Goal/Task/Room/Spawn/Logistics/Agent
边界，视为本 Phase 未完成。
