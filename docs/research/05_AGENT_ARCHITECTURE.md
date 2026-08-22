# 05 · Agent 架构：判据、Model A–E 裁决与 Multi-Agent 否决

> 研究文档 · 结论等级：**设计裁决**（总任务书 Model A–E 之争的最终答案；ADR-003 /
> ADR-011 的深度论证）。Agent 判据与 LLM 边界以
> [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md) 为单一真相源，本文与其
> 严格一致并交叉引用。

## 1. Problem

「完全自治帝国」的目标在 LLM 时代极易滑向概念污染：把每个 Manager 命名为 Agent、
在架构图上画一群会协商的方框、引入「Agent Runtime」（信念系统/规划器/协商总线）。
**但「Agent」在工程上有严格含义**——运行时目标选择权（23 号 §10.1）。本文要回答：
Screeps 帝国的控制架构应该长什么样？总任务书给出的 Model A–E 五个候选架构哪个正确
（或如何杂交）？哪些组件配得上「Agent」这个词？Multi-Agent 社会为什么被否决？

## 2. Research Questions

- Model A–E 各自的结构、CPU 成本、稳定性、可解释性、可调试性、扩展性如何？
- 「Agent」的工程判据是什么？本架构里哪些组件满足？
- Multi-Agent 社会（协商/拍卖/合同网）在 Screeps 有无可辩护的用途？
- 为什么裁决落在「修订版 Model D」？修订了什么？

## 3. Existing Solutions（Agent 范式谱系）

游戏 AI 与分布式 AI 的主要 Agent 范式，及其在 Screeps 的适配性：

| 范式 | 核心机制 | 在 Screeps 的适配性 |
| --- | --- | --- |
| BDI（Belief-Desire-Intention） | 信念库 + 愿望集 + 意图栈，周期性审议 | 信念=Memory/heap、意图=任务——**概念可用，审议机制过重**；无已知 bot 实现 |
| GOAP（Goal-Oriented Action Planning） | 每次规划用 A* 在动作空间搜索满足目标条件的动作序列 | 规划成本随动作数增长；**本次核查：无知名 Screeps bot 使用 GOAP**（社区主流是规则/FSM/行为树，如 choreographer 用 BT） |
| HTN（Hierarchical Task Networks） | 任务递归分解为子任务直到原子动作 | bonzAI 的 Operation→Mission 是**手工 HTN**（分解表写死在代码里），不是运行时求解器 |
| Utility AI | 每 tick 对所有 (动作,目标) 对算效用分竞拍 | 社区教训：决策抖动 + 竞拍 CPU；TooAngel 用三个平滑指标达成同等资源裁决（ADR-003 Reasoning） |
| 行为树（BT） | 反应式优先级树，tick 驱动 | 单 creep 行为可用（choreographer）；但 18+ 角色共享树会退化成 18 套 FSM 的另一种写法（ADR-004 已裁决为声明式 RolePolicy） |
| 合同网协议（Contract Net） | 招标-投标-中标-租约的任务分配 | **语义正确、协商部分多余**：TI 的请求认领（responder/abandon）就是去协商化的合同网 |
| Subsumption / 分层 Agent 社会 | 多个完整 Agent 分层抑制 | 多 Agent 否决论证见 §11 |

## 4. Screeps Community Practice

- **命名泛滥但实质是控制器**：Overmind 的 Overlord/Overseer/Directive 名字最像
  Agent 社会，但本次核查作者博客（bencbartlett.com）确认：Directive 只是「游戏 flag
  的包装，条件挂载点，几乎无逻辑」；Overseer 是「按优先级运行 overlord 并响应刺激
  放置 directive」的确定性巡查器；Overlord 用**决策树**给空闲 Zerg 派 Task。全部
  确定性，零学习、零协商、零信念系统。
- **社区架构演进轨迹**（2026-08-22 社区调研）：一年级玩家的典型演化是「过程树 →
  进程 + 优先队列 + 事件流」——复杂度从「更多智能」流向「更多结构」，与 Agent
  框架方向相反。
- 唯一带「Agent」标签的实践在体外（Overmind-RL 把游戏当 RL 训练环境；derek 的
  LLM 大脑架构是纯规划无运行数据——23 号 §3.2）。
- choreographer bot（ryanrolds）用 OS 进程 + 消息队列 + 事件流 + 行为树——「分布式
  结构」可以存在，但节点仍是确定性代码，不是自治 Agent。

## 5. Existing Bot Analysis（总任务书 Model A–E 逐一裁决）

**Model A：房间自决**——每个房间是独立决策单元，帝国不存在（或仅是通信总线）。
先例：无（最接近的是 TooAngel 的弱全局，但仍保留全局扩张/外交决策）。
问题：跨房资源死锁无仲裁者（04 号 §8-2）；扩张/战争无授权链；GCL 作为全局预算
无人管理。**否决**（ADR-001 Options A）。

**Model B：帝国→房间→creep 严格命令链**——集中式逐层下达。
先例：无纯形态（Quorum 的 empire 进程最接近，已停更）。
问题：帝国层信息带宽与 CPU 不可承受（要读所有房间细节才能指挥）；本地闭环被
远端决策延迟拖垮；帝国层 bug 全局放大。**否决**（ADR-001 Options B）。

**Model C：战略→计划→房间**——战略层产出计划序列，房间按计划执行。
问题：「计划」是脆断点：世界是对抗性的（敌对玩家、市场波动、respawn），全量
计划序列的保鲜期极短；社区六大 bot 无一保存全量可执行计划（详见
[07_PLANNING_SYSTEM.md](07_PLANNING_SYSTEM.md) §5）。**否决**，但「战略层独立存在」
的正确内核被吸收进 Model D。

**Model D：Goal→Policy→Plan→Operation→Task 五级语义链**——目标、策略、计划、
作战、任务逐层细化。方向正确（与 bonzAI Operation–Mission、TI requests、Overmind
directive-overlord-task 的存活先例同构），但原版有三处失配：
1. Plan 层若指「全量可执行计划序列」→ 脆断（同 Model C）；应降格为低频 Agenda
   （中期承诺带预算/期限/取消条件）；
2. Goal 层若做每 tick 效用竞拍 → CPU 与抖动（ADR-003）；应改为 posture 允许集 ∩
   预算门控 ∩ 优先级序；
3. 缺少 Demand 层（缺口信号）——每 tick 执行的推导入口（见 08 号）。

**Model E：分层 Agent 社会**——每层都是 Agent，通过消息/协商解决冲突。
先例：零。问题见 §11 完整否决论证。**否决**。

**裁决 = 修订版 Model D**：Goal→Policy→Demand→Agenda/Operation→Task/Intent→
Action→Outcome（数据流细节见 08 号 §10）。

**Model A–E 对照总表**：

| 维度 | A 房间自决 | B 帝国集中 | C 战略→计划→房间 | D 原版五级链 | **D 修订版（裁决）** | E 分层 Agent |
| --- | --- | --- | --- | --- | --- | --- |
| 结构 | 对等节点 | 单根命令树 | 三层流水 | 五级语义链 | 五级语义链+瞬时 Demand | 多 Agent 协商网 |
| CPU | 低（无中心）但重复计算多 | 极高（中心全读） | 计划重算贵 | 竞拍/计划贵 | **O(1) 战略 + 低频 Agenda + 每 tick 派生** | 协商轮次×节点数，最高 |
| 稳定性 | 死锁/冲突频发 | 单点放大错误 | 计划脆断 | 抖动（竞拍） | **滞回+承诺防抖** | 涌现行为不可控 |
| 可解释性 | 局部可解释 | 全局可解释 | 计划即文档 | 高（但竞拍卖态难读） | **posture/budget/Agenda 全显式** | 低（结果依赖消息时序） |
| 可调试性 | 难（无全局视角） | 难（全走中心） | 中（计划失效难查） | 中 | **纯函数单测 + 决策快照** | 差（不可复现） |
| 扩展性 | 房间数↑死锁↑ | 房间数↑带宽爆炸 | 计划规模爆炸 | 中 | **房间线性、帝国 O(1)** | 节点数↑协商爆炸 |
| 社区先例 | 无 | 无 | 无 | bonzAI/TI 弱先例 | **六大 bot 的收敛形态** | 无 |

## 6. Advantages（修订版 Model D）

1. **每层一个生命周期量级**：Goal 10^3–10^5 tick、Agenda 10^3–10^4、Demand/Task
   1–10^2——各层频率天然解耦，不互相拖累（映射表见
   [06_GOAL_AND_POLICY_SYSTEM.md](06_GOAL_AND_POLICY_SYSTEM.md) §10.4）。
2. **唯一的自主性集中在最小、最可测的层**：战略层是纯函数，自治契约的全部
   「智能」都装在一个可单测、可快照、可回放的黑盒边界内。
3. **术语与存活先例一一对应**：Goal≈战略意图、Operation≈bonzAI Operation/TI
   request、Task≈Overmind Task/creep-tasks——每个抽象都有十年级存活证据。
4. 执行层薄（RolePolicy），新增行为不动架构（ADR-004）。

## 7. Disadvantages

- 五级语义链的概念成本：开发者必须清楚「一段逻辑属于哪一级」——放错层级是此架构
  特有的 bug 形态（如角色层直接写 Goal 判断）。
- 修订点 2（posture 化 Goal）牺牲了「目标组合的任意性」——同时追求多个非正交
  目标（又扩张又打仗又囤 boost）需要 posture 语义足够丰富，表达力上限低于效用
  系统。
- Demand 层的引入是本套件的原创修正（相对任务书原模型），无直接社区先例背书
  （TI requests 是部分同构），需要 A3 阶段验证。

## 8. Failure Modes

| 失败模式 | 症状 | 防线 |
| --- | --- | --- |
| Agent 命名污染 | Manager 冠名 Agent，评审失去判据，有人往里塞「智能」 | 23 号 §10.1 判据 + 命名纪律（禁止 Agent 后缀）写进评审清单 |
| 层级穿透 | 角色层读/改 posture；Task 直接改 Goal | 边界违例即架构 bug（26 号 §2）；类型上 Goal/Policy 类型不出现在执行层 import 面 |
| 每 tick 重规划复发 | Agenda 每tick推翻重建（thrashing） | 最低持续期 + 承诺机制（[07_PLANNING_SYSTEM.md](07_PLANNING_SYSTEM.md) §10.4） |
| 目标抖动 | peace/war 高频切换 | posture 滞回（06 号 §10.2） |
| 战略层纯函数被偷偷做成有状态 | 决策不可复现、测试失效 | 战略层输入=态势快照（值类型），禁止读 Game 全局；单测强制快照回放 |
| 「智能幻觉」需求回流 | 「为什么不能加个 LLM 帮它决策？」 | 23 号 §11 禁止清单 + ADR-011 |

## 9. CPU Implications

- **Agent Runtime 的 CPU 恒为零——因为它不存在**（ADR-011）。所有「Agent 性」
  （目标选择）压缩进战略纯函数：O(态势快照) 每 tick 一次，输入是摘要级数据，
  成本 <0.5 CPU（26 号 §7 固定项）。
- 协商式 Multi-Agent 的 CPU 下界估算：N 个节点 × 每 tick k 轮消息处理 × 序列化
  成本——在 30 房规模下仅消息路由就超过多数系统的全部预算；这是结构性否决而非
  实现优化问题。
- GOAP per creep 的成本下界：每次规划 A* 搜索 × 动作空间；Overmind 用决策树+
  任务链达成同等行为灵活性，成本恒定（§4）。

## 10. Recommended Design

### 10.1 裁决数据流（修订版 Model D）

```text
Goal（战略意图，声明式谓词，常量集合）
  ↓ 约束（允许集）
Policy（posture × budget，战略纯函数 = 唯一受限 Agent）
  ↓ 授权与配额
Agenda / Operation（中期承诺：预算/期限/取消条件，低频创建复核）
  ↓ 生命周期内持续声明
Demand（每 tick 缺口信号，瞬时派生） ──房间稳态缺口也在此汇入──┐
  ↓ 消费                                                     │
Task / Intent（执行者绑定：租约/幂等键/超时）                  │
  ↓ 执行                                                     │
Creep Action（RolePolicy 声明式驱动）                         │
  ↓ 结果                                                     │
Outcome 反馈（核验→Agenda 完成/失败→战略指标修正）←────────────┘
```

### 10.2 组件判据盘点（与 23 号 §10.1 一致）

> 判据：**组件是 Agent ⟺ 它在运行时拥有目标选择权**（能改变「帝国现在追求什么」，
> 而不仅是「如何执行既定目标」）。

| 组件 | 判定 | 理由 |
| --- | --- | --- |
| 帝国战略层（posture×budget 决策器） | **受限 Agent（全架构唯一）** | 拥有目标选择权（peace/fortify/war、扩张/收缩），但本身是确定性纯函数——自主性被「纯函数 + 滞回 + 遥测」三重约束 |
| 议程管理（Operation 生命周期） | 确定性系统 | 只执行创建/复核/取消规则，Goal 已由战略层选定 |
| 房间状态/分配/建造/远矿/塔控/交通/市场/情报/调参 | 确定性系统 | 全部是「如何执行既定目标」 |
| Spawn Manager | 确定性系统 | 幂等合并与优先级车道是规则，不是选择 |
| RolePolicy / creep | 确定性执行器 | 声明式策略驱动的 FSM（ADR-004） |
| 物流请求池 | 确定性系统 | 评分认领是查表+排序（合同网的去协商化） |
| 自愈系统 | 确定性系统 | 签名→处置表查表（22 号 §10.1），不做猜测性修复 |
| 体外 LLM 顾问 | 工具，非 Agent | 无运行时目标选择权；建议采纳权在护栏/canary（23 号 §10.2） |

**结论：全架构仅一个受限 Agent，且它是确定性纯函数。「Agent」是职责描述，
不是运行时设施——本架构不需要 Agent Runtime。**

### 10.3 实施纪律

1. 命名：任何新组件禁止 Agent 后缀；评审时对「智能」「学习」「自适应」词汇要求
   证据（哪个指标驱动、什么护栏）。
2. 战略层测试：posture 决策函数必须可用快照回放单测（同输入同输出）。
3. 层级归属检查：新代码 PR 自答「这段逻辑属于哪一级」；跨级直连需在注释中声明
   紧急旁路理由与回归路径（skill 参考 grandmaster-theory.md §1）。

## 11. Alternatives Rejected

**Multi-Agent 社会的完整否决论证**（Model E 及一切变体——房间 Agent 协商、
creep Agent 自组织、帝国-Agent 谈判）：

1. **无先例**：全部调研对象（Overmind/TooAngel/TI/Quorum/bonzAI/KasamiBot/hivemind，
   2026-08-22 源码级核查）零家采用多 Agent 协商；社区「一年级轨迹」也远离该方向（§4）。自治帝国领域
   十年级存活样本全部是确定性分层。
2. **CPU 结构性爆炸**：协商语义（招标-投标-仲裁）每 tick 每节点都要消息处理；
   在 CPU 是硬通货的运行时（03 号 §3），这等于用生存资源换取架构美感。
3. **不确定性爆炸**：协商结果依赖消息时序与轮次，同一态势可能产出不同决策——
   直接摧毁「决策可单测、可回放、可审计」的根基，而可审计性是自治契约
   （AGENTS.md：完全自治）的前提。
4. **解决的问题不存在**：协商解决的是「多个自主主体的目标冲突」；本架构通过
   posture 允许集 ∩ 预算门控 ∩ 优先级序（ADR-003）在**决策之前**就消解了目标
   冲突——不需要事后谈判机制。
5. **涌现行为不可审计**：自治契约要求每个行为可追溯到决策快照；多 Agent 涌现
   行为天然不可追溯，故障归因成本随节点数超线性增长。
6. **保留其合理内核**：合同网的「招标-认领-租约」**语义**（不协商、只认领）保留
   在请求池物流与 TI 式请求经纪中（ADR-006；08 号 §10.5）。

其余否决项：BDI（审议循环 CPU + 无先例）、GOAP per creep（规划成本 + 无社区
实现——本次核查确认）、Utility 竞拍（ADR-003）、在线 RL（23 号 §11）、
「Agent Framework」式的通用自主层（职责描述 ≠ 运行时设施）。

## 12. Open Questions

1. posture 语义的表达力上限：当目标组合确实非正交（扩张期遇袭要同时 war+继续
   供应殖民地）时，posture 是加「复合姿态」还是允许 posture 带参数化子状态？
2. 战略纯函数的快照单测覆盖率标准（每条 posture 转换至少几组态势夹具）——
   待 [28_TESTING_STRATEGY.md](28_TESTING_STRATEGY.md) 定稿后对齐。
3. Demand 层原创修正的验证节奏：A1/A2 单房阶段 Demand 池极小，真正的验证在
   A3 多房（27 号门槛表）。
4. 若未来引入 L2 体外顾问（23 号 §10.2），其建议入口是否只限 Policy 参数——
   当前裁决是是；待 A5 后复核。

## 13. Evidence / Sources

| URL / 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://bencbartlett.com/blog/screeps-1-overlord-overload/（2026-08-22 核查） | 作者博客 | Directive=flag 包装的条件挂载点；Overseer 确定性巡查；Overlord 决策树派 Task；build/init/run 相位分离；拒绝「一 flag 一进程」 | CONFIRMED |
| https://github.com/ryanrolds/screeps-bot-choreographer | 源码 | 社区最接近「分布式结构」的 bot：BT + 消息队列 + 事件流，节点仍为确定性代码 | CONFIRMED |
| Web 检索（2026-08-22）："screeps GOAP planner bot" | 检索 | 无知名 Screeps GOAP bot；主流为规则/FSM/BT；GOAP 讨论仅限通用游戏 AI | CONFIRMED（负结果） |
| https://github.com/bonzaiferroni/bonzAI | 源码 | Operation–Mission 手工 HTN（分解表写死）；Guru 观察者类无验证闭环 | CONFIRMED |
| [23_LLM_AND_AGENT_RUNTIME.md](23_LLM_AND_AGENT_RUNTIME.md) §10/§11 | 本套件 | Agent 判据、组件盘点、Multi-Agent 否决（本文与其一致） | — |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) ADR-001/003/004/011 | 本套件 | 两级模型、战略纯函数、RolePolicy、Agent 边界 | — |
| [26_FINAL_ARCHITECTURE.md](26_FINAL_ARCHITECTURE.md) §4/§8 | 本套件 | 决策流与任务书 §31 对照（Model D 修订的既有裁决） | — |
| screeps-grandmaster-perspective/references/grandmaster-theory.md §1/§9 | 领域经验 | State-First 级联、架构演化由压力触发 | LIKELY |
