# ARCHITECTURE_RECONCILIATION · 架构调和记录

> Phase 1 §3：严禁直接接受 Phase 0 的 FINAL_ARCHITECTURE——必须主动寻找所有概念
> 张力并逐一裁决。每条张力按 Problem / Options / Trade-offs / Decision / Reason
> 格式裁决。输入：[RESEARCH_SYNTHESIS.md](RESEARCH_SYNTHESIS.md)（含已裁决的
> 数据/出处冲突清单，本文不重复）+ 35 份研究文档。
> 裁决结果若与 Phase 0 的 ADR 冲突，以本文为准并回写 ADR 修订（见 §11）。

## 1. Empire vs Room Autonomy（帝国集权 vs 房间自治）

**Problem**：目标选择权与资源处分权如何分割？
**Options**：A 房间全自治；B 帝国全集中（逐 creep 指挥）；C 双级：帝国持有目标
选择权与跨域仲裁，房间持有本地执行闭环。
**Trade-offs**：A 扩展性好但资源死锁无仲裁；B 简单但 CPU/带宽不可扩展；C 边界
维护成本。
**Decision**：**C**，且精确化：房间对「能量、人口、物流、建造、升级、本地防御」
六闭环自治；帝国对「扩张、远矿立项、战争、市场、跨房调拨、GCL、全局优先级」
垄断。房间不得越过预算消耗共享资源；帝国不得逐 creep 指挥。
**Reason**：7 家 bot 全收敛于两级（02 号 C1）；红队 A11（多房战时争抢）验证仲裁
必须上收。与 ADR-001 一致。

## 2. Goal vs Demand（战略目标 vs 瞬时需求）

**Problem**：两者是同一事物的两个抽象层，还是两种不同生命周期的对象？
**Options**：A Goal 分解为 Demand（层级推导链）；B 两种独立对象：Goal=声明式
谓词（无实例、无竞拍），Demand=每 tick 由确定性系统从缺口推导的瞬时候选。
**Trade-offs**：A 概念统一但需要 Goal 引擎与分解规则（CPU+复杂度）；B 零竞拍
成本但「为什么做」与「做什么」的因果链变隐式。
**Decision**：**B**。Goal 只存在于战略层谓词与文档语义中（如「本土净流为正」），
不实例化、不入 Memory；Demand 是运行时真对象但**瞬时态**（不持久化，由源系统
每 tick 重导出；唯一例外是触发 Agenda 立项的 Demand 转译为 AgendaItem 字段）。
**Reason**：TooAngel 三指标门控十年验证「谓词式 Goal」足够；06/08 号一致；持久化
Demand 是 Memory 税与状态漂移源（18 号）。

## 3. Task vs Directive（执行单元 vs 中期承诺）

**Problem**：任务书模型中 Directive 与 Task 并存，边界模糊（Overmind 的 Directive
实际是轻量意图标记）。
**Options**：A 两者并存各自生命周期；B 收编：Directive → **AgendaItem**（中期
承诺：远矿车道/扩张殖民/战争波次/重建，带预算、期限、取消条件），Task →
**带租约的执行单元**（认领-执行-回报-超时回收）；C 只留 Task。
**Trade-offs**：A 概念冗余；B 两层各司其职但需要明确转译点；C 丢失中期承诺语义
（远矿/战争无法表达为单 Task）。
**Decision**：**B**。系统中不存在名为「Directive」的运行时类型——术语统一为
AgendaItem（Phase 0 之 08 号裁决维持）。转译点：AgendaItem 复核时生成/维持
Demand 流（如人口缺口），Demand 被执行者认领即为 Task（租约）。
**Reason**：bonzAI Operation–Mission 与 TI request 双先例；六态生命周期（08 号）
已覆盖 Task 全程；「Directive」一词在社区语义过载（flag 包装/军事命令/政治指令）。

## 4. Planner vs Policy（规划器 vs 策略层）

**Problem**：任务书暗示独立 Planner 层；Phase 0 结论是「战略=纯函数、规划=低频
议程」——是否还需要「Planner」这个组件？
**Options**：A 三层 Planner（strategic/operational/tactical 组件）；B 无 Planner
组件：Policy（posture×budget 纯函数）+ Agenda 复核器（低频）+ 确定性需求推导
（每 tick，散布在各系统）。
**Trade-offs**：A 集中可审计但每 tick 成本与振荡风险；B 零额外组件但「规划逻辑」
分散（复核器+各系统推导函数）。
**Decision**：**B**。「Planner」不作为运行时组件存在；其职责被三处吸收：
① 战略方向=Policy 纯函数；② 中期承诺=Agenda 管理器（低频复核：预算/期限/取消
条件/结果核验）；③ 即时派工=各系统的确定性推导（census→spawn intent、供需池→
租约）。防振荡三防线（滞回/minDuration/重建冷却）挂在 Policy 与 Agenda 上。
**Reason**：07 号四论据（CPU/振荡/可测性/社区零先例——无 GOAP/在线规划器 bot）；
红队 A3 验证 minDuration 约束必要。

## 5. Manager vs Agent（模块命名与概念污染）

**Problem**：XXXManager/XXXAgent/XXXService 泛滥（任务书 §9「Manager 地狱」）。
**Options**：A 按问题命名 Manager；B 按领域边界命名组件 + Agent 判据收窄。
**Trade-offs**：A 零思考成本但边界腐化；B 需要领域审查纪律。
**Decision**：**B**。术语规约：**Agent**=拥有运行时目标选择权的组件（仅帝国
战略层，受限、确定性）；**System**=组合根注册的 tick 管线成员（P0–P3 优先级类）；
**Service**=无状态纯逻辑集合（分配/评分纯函数，domain 层）；**Manager** 仅保留
给「唯一写者资源代理」（SpawnManager/ConstructionManager/RemoteMiningManager/
MarketManager——名实相符：管理独占写权）；**引擎/engine**=执行框架（role-runner/
traffic resolver）。禁止 Coordinator/Handler/Controller 等空转命名；一个模块若
只是转发/调用/if-else 必须删除。
**Reason**：05 号判据 + 26 号模块清单；「一个模块只调另一个模块=删除」是任务书
§9 明令。

## 6. Kernel vs Event-driven（调度中枢之争）

**Problem**：Quorum 式进程内核 vs 事件驱动架构（EventBus 中枢）vs 固定管线。
**Options**：A EventBus 为中枢（系统订阅事件）；B 固定顺序管线 + 分频 + 事件仅
作触发器；C 完整进程内核。
**Trade-offs**：A 解耦好但执行顺序不可推理（调试灾难）+ 订阅风暴；B 确定性可
回归但「事件」响应有延迟；C 已裁决否决。
**Decision**：**B**。事件**不是一等公民**：不建全局 EventBus 中枢；「事件」仅
存在两种形态——① 分频触发器（如「storage 水位越过阈值→本 tick 顺便复核均衡」
内联于系统的 cadence 判断）；② AgendaItem 的立项/取消条件（低频复核时评估）。
执行顺序永远由管线序+优先级类决定，事件只影响「做多少/是否立项」，不影响
「谁在何时运行」。
**Reason**：19 号确定性论证（同输入同行为可回归）；红队 A1/A8 的修复都依赖可
推理的固定顺序；Quorum stormtracker 类工具可体外监测而非体内中枢。

## 7. Centralized vs Distributed（集中式 vs 分布式）

**Problem**：决策、状态、执行三个维度各自集中还是分布？
**Options**：A 全集中；B 全分布；C 分维：决策集中（帝国纯函数唯一）、状态分区
（每状态唯一 owner，见 STATE_OWNERSHIP_MODEL）、执行分布（房间+RolePolicy）。
**Decision**：**C**，且明确「集中的最小集」：posture 决策、spawn 排产、site
签发、市场下单、跨房调拨、战争授权——六项全局唯一；其余全部下放。
**Reason**：写者唯一性是幂等的充要条件（26 号）；红队 A12 确认。

## 8. Deterministic vs Agentic（确定性 vs 自主智能）

**Problem**：自治程度与确定性的张力——越自治越像 Agent，越像 Agent 越难测试。
**Options**：A 尽量 Agentic（组件自主决策）；B 尽量确定性（一切规则化）；
C 确定性运行时 + 单点受限 Agent（战略层纯函数）+ 体外智能（LLM 研究员）+
演化闭环（有界参数调节）。
**Decision**：**C**。自治的来源是**闭环完整性**（生存/能量/人口/知识/演化五环
互相供养），不是组件智能。
**Reason**：05/23 号；红队元结论（自适应自身是振荡源）要求「自治升级必须带
承诺期与预期状态核对」。

## 9. LLM vs Deterministic Runtime（外部智能边界）

**Problem**：LLM 在系统中的合法位置。
**Options**：A 线上决策成员；B 体外三层（开发研究员/低频有界参数顾问/灾难接管
辅助）；C 完全不用。
**Decision**：**B**。tick 路径物理不可达（无出站网络）且架构禁止；参数建议走
白名单+护栏+canary；禁止清单五条（不碰事实裁决/代码直上/schema/自部署）。
**Reason**：23 号三重裁决（物理/零先例/可靠性）；ADR-011 维持。

## 10. 补充张力（研究过程中发现、任务书未列）

### 10.1 Energy 归属：Room 还是 Empire？
**Decision**：能量**属 Room**（本地储备与预算），帝国持有**调拨权**（terminal
网络 + 战时征调）而非所有权。调拨受门控（本土净流为正、异常房例外策略）。
**Reason**：12 号「把加工搬到能量处」铁律 + 15 号围城能量会计需要本地储备归属
明确；全集中能量池违反故障域隔离（04 号）。

### 10.2 Remote Mining 归属：Room 能力还是 Empire Operation？
**Decision**：**Operation**（AgendaItem），属地=母房（执行挂母房人口与物流），
立项权=帝国（ROI 与 CPU 定价是帝国口径）。远矿房不是房间层单元。
**Reason**：09/17 号一致裁决；远矿的 CPU-能量交换定价必须帝国统一（20 号）。

### 10.3 Spawn 竞争：先来先得还是优先级？
**Decision**：车道制（P0 灾后/防御 > P1 生存维持 > P2 发展 > P3 增长）+ 同车道
内 Agenda 优先级序 + 饥饿老化；**先来先得非法**。
**Reason**：红队 A11；ADR-005；详见 DECISION_AUTHORITY_MODEL.md。

### 10.4 事件驱动的 Spawn：Defense 紧急孵化是否绕过队列？
**Decision**：不绕过——占用 P0 车道（队列内最高优先级），但 P0 车道有**紧急
直通路径**（内核级 ≥200 能量最小单元，不依赖 P1+ 系统健康）。红队 A5 修订。
**Reason**：绕过=第二个 spawn 写者=幂等破坏；直通路径保住灾后下限。

## 11. 与 Phase 0 的差异清单（ADR 修订记录）

| # | Phase 0 表述 | 本调和后 | 性质 |
| --- | --- | --- | --- |
| 1 | 26 号模块清单含「议程管理（Operation 生命周期）」 | 维持，但术语统一 AgendaItem，禁止 Directive 作为运行时类型 | 术语收紧 |
| 2 | 08 号「Task 租约」 | 维持，明确认领即 Task（无独立创建步骤） | 精化 |
| 3 | 21 号遥测「事件」 | 收窄：无 EventBus 中枢，事件=分频触发器+Agenda 条件 | 结构收紧 |
| 4 | 26 号「战略层是受限 Agent」 | 维持，Agent 判据从 05 号正式升格为命名规约（§5） | 升格 |
| 5 | 能量归属未显式 | Room 所有 + Empire 调拨权（§10.1） | 新增裁决 |
| 6 | 紧急车道表述 | 明确为内核级直通路径（P0 车道内语义，非队列外绕过） | 精化 |

无任何 ADR 被推翻；以上修订全部登记入 [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)
§15 修订记录。
