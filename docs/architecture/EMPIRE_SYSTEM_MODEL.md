# EMPIRE_SYSTEM_MODEL · 系统核心模型

> Phase 1 §4：从系统抽象（不是类和文件）定义 Screeps AI Empire。概念清单来自
> 任务书 §4，定义依据 Phase 0 研究与 [ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md)
> 裁决。**每个概念：是什么 / 拥有什么责任 / 不拥有什么。**

## 0. 一句话系统定义

> Screeps AI Empire 是一个运行在确定性 tick 运行时上的**闭环集合**：五条互相供养
> 的闭环（生存/能量/人口/知识/演化）由一个轻量内核维持秩序，由唯一的受限 Agent
> （帝国战略层）选择目标，由唯一写者们把目标落到游戏世界。

## 1. 核心概念定义（17 项）

### World（世界）
**是什么**：Screeps 引擎呈现的全部客观事实——可见房间对象、地形、资源、他者
行为、市场、CPU/时间。**责任**：无（它是被观察对象，不是系统成员）。系统内
对应物是**只读快照**（WorldSnapshot/RoomSnapshot），每 tick 重建，禁止跨 tick
假设。

### Empire（帝国）
**是什么**：跨房决策与仲裁单元，本系统唯一的受限 Agent 载体。**责任**：七项
垄断权（房间注册、扩张/远矿立项、战争授权、市场下单、跨房调拨、GCL 管理、
全局优先级）；维护 posture 与预算。**不拥有**：本地执行细节、creep 指挥权、
能量所有权（只有调拨权）。

### Room（房间）
**是什么**：本地经济闭环单元，以**能力门槛 phase**（非静态 role）描述状态。
**责任**：六闭环——能量（source 产能→buffer→消费）、人口（census→缺口）、
物流（请求池属地）、建造（蓝图推进）、升级（15×WORK 预算）、本地防御（塔/
威胁响应属地）。**接口**：向上报告（Report：净流/缺口/风险）、向上请求
（Request：援助/授权）、接受下发（Directive-channel：AgendaItem/预算/调拨令）。
**不拥有**：目标选择权、跨房资源处分权。

### Operation（行动）＝ AgendaItem
**是什么**：中期承诺对象（唯一运行时形态是 AgendaItem；「Directive」与
「Operation」作为运行时类型**不存在**，见调和 §3）。**责任**：承载预算、期限、
取消条件、属地（母房）、结果核验；低频复核（分频，不进每 tick 路径）。**类型集**：
远矿车道 / 扩张殖民 / 战争波次 / 重建 / 准军事（power bank、SK farming——ROI
门控，非 war 授权）。

### Goal（目标）
**是什么**：**声明式常量谓词**，描述「可接受状态」（如「本土能量净流 ≥ 0」「威胁
清零」）。**责任**：作为战略层输入与验收语义。**不拥有**：实例、内存占用、
竞拍参与权（无 Goal 引擎）。「现在追求什么」的答案是 posture 允许集 ∩ 预算门控
∩ 优先级序的求值结果，不是 Goal 对象竞争的结果。

### Policy（策略）
**是什么**：posture（peace/fortify/war/evacuate 四态，滞回切换）× budget
（CPU/能量/人口/物流/军事五域配额）的**确定性纯函数**及其参数表。**责任**：
每 tick（或态势分频刷新时）由态势快照求值；授权哪些 AgendaItem 类别可立项、
各域预算多少。**不拥有**：执行、直接 Game 调用。

### Plan（计划）
**是什么**：**收窄概念**——仅指 AgendaItem 内的里程碑描述与预算分解（如殖民
自举的五个阶段）。**不是**：可执行动作序列（tactical 层禁序列规划，07 号裁决）。
系统不存在独立的「Plan 对象/Planner 组件」。

### Directive（指令）
**是什么**：**已收编**——历史术语，运行时统一为 AgendaItem 字段（帝国→房间的
下发通道叫 Directive-channel，但载体是 AgendaItem/调拨令/预算，见调和 §3）。

### Demand（需求）
**是什么**：每 tick 由确定性系统从缺口推导的**瞬时候选对象**（spawn intent、
搬运请求、建造申请、防御响应）。**责任**：表达「谁需要什么、多急、多久过期」；
被认领即成 Task。**不拥有**：持久化（不入 Memory；例外：触发立项的 Demand
转译进 AgendaItem 字段）。

### Task（任务）
**是什么**：Demand 被执行者认领后的**租约形态**（认领-执行-回报-超时回收，
六态生命周期：offered→claimed→succeeded/failed/expired/cancelled）。**责任**：
绑定执行者与目标；超时自动回收防死锁。**不拥有**：战略语义（Task 不知道
为什么存在）。

### Creep（爬虫）
**是什么**：声明式 RolePolicy 的执行载体。**责任**：按钩子（gate/acquire/
work/hold/onFlee/park/combat）响应；移动登记意图；缓存 targetId；心跳与失败
计数。**不拥有**：目标选择、spawn 请求权、全房扫描权、直发建造权。

### Structure（结构）
**是什么**：世界对象（spawn/tower/link/storage/terminal/lab/factory/...）。
系统内被**唯一写者**封装为资源代理：SpawnManager 包 spawn、ConstructionManager/
RemoteMiningManager 包 site、TrafficResolver 包移动。**责任**：无自主行为，
全部动作来自所属系统。

### Event（事件）
**是什么**：**收窄概念**（调和 §6）——两种合法形态：① 分频触发器（系统内
cadence 判断，如水位越阈）；② AgendaItem 立项/取消条件（低频复核时评估）。
**不是**：全局 EventBus、订阅/发布中枢。执行顺序永远由管线序决定。

### State（状态）
**是什么**：分区所有的持久/派生数据，每项状态有唯一 owner/reader/writer/
lifecycle/persistence/frequency——详见 [STATE_OWNERSHIP_MODEL.md](STATE_OWNERSHIP_MODEL.md)。
**责任**：系统成员不得读写不属于自己的状态。

### Resource（资源）
**是什么**：四类可支配量的抽象——energy、mineral/commodity、credits、**CPU/预算**
（后者是第一公民资源，与能量同等参与门控）。**责任**：一切消耗决策必须同时过
能量账与 CPU 账（20 号 B=U−F−C）。能量属 Room、帝国持调拨权（调和 §10.1）。

### Threat（威胁）
**是什么**：分级评估对象（四级：骚扰/入侵/围城/灭国级），输入=可见敌情+intel。
**责任**：驱动防御状态机（normal→alert→siege→recovery→stabilizing）与 safemode
决策表；置信度随情报新鲜度衰减。

### Intel（情报）
**是什么**：segment 冷存的观察记录（四域：房间/玩家/资源/市场），带 TTL 与
三分置信度（fact 亲见 / stale 过期 / inferred 推断）。**责任**：供扩张尽调、
战争授权、市场决策查询；**禁止**把 stale/inferred 当 fact 使用（多源新鲜度硬门槛）。

## 2. 概念关系图（运行时视角）

```text
World ─(只读快照每tick)→ WorldSnapshot/RoomSnapshot
                                │
              Policy 纯函数（posture×budget，态势分频求值）
                                │ 立项授权+预算
              AgendaItem（低频复核：预算/期限/取消/核验）
                                │ 生成/维持 Demand 流
   房间六闭环稳态 ──(缺口)──→ Demand（瞬时候选，每tick）
                                │ 认领即 Task（租约，六态）
              Creep(RolePolicy) / 唯一写者们(Spawn/Site/Move/Market)
                                │ 动作
              World（下一 tick 由快照确认结果）
                                │
              Telemetry/Outcome ─→ 自愈监视/演化闭环/Intel 更新 ─→ Policy 输入
```

## 3. 责任三原则（全部概念的共同约束）

1. **目标选择权唯一**：只有 Policy（帝国战略层）能改变「帝国追求什么」。
2. **写权收敛**：六项全局唯一写者（spawn/site/自有房+远矿/move/market/跨房调拨），
   其余一切系统只读世界、写自己的状态。
3. **不确定性零进入**：tick 路径上不存在学习、随机决策、外部智能；「适应」只
   发生在演化闭环的有界参数层。
