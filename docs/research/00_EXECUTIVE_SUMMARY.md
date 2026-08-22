# 00 · 研究套件导航与总结论（EXECUTIVE SUMMARY）

> 总任务书（Screeps AI Empire 前期调研与总体架构研究）执行产物。
> 执行日：2026-08-22。执行方式：Phase 0 全量调研（官方机制引擎常量级核查 +
> 7 家 bot 源码级考古 + 社区经验挖掘 + 冲突裁决）→ 架构设计与 ADR → 红队评审
> → 修订闭环。**顶层答案见 [../RESEARCH_EXECUTIVE_SUMMARY.md](../RESEARCH_EXECUTIVE_SUMMARY.md)
> （只回答「今天开始开发该采用什么架构」的 14 点）**；本文是套件导航与结论索引。

## 1. 总结论（三句话）

1. **世界观**：帝国 AI 是一组互相供养的确定性闭环（生存/能量/人口/知识/演化），
   跑在轻量内核上；不是 Manager 堆，不是分层 Agent 社会，不让任何不确定性进入
   tick 路径。
2. **决策模型**：帝国层姿态×预算（确定性纯函数、滞回切换）+ 低频议程
   （Agenda/Operation 中期承诺）；房间层能力门槛 phase 本地闭环；执行层声明式
   RolePolicy + 唯一写者（spawn/site/订单）。Goal 不竞拍、Planner 不做每 tick
   规划、LLM 只在体外。
3. **交付模型**：验收制路线（A0–A5 门槛 × P1–P12 Phase）；MVP = 空帝国自举 +
   产能闭环，用「零人工指令从 1 spawn 300 能量到 RCL4+ 稳定经济」验证自治。

## 2. 文档地图（34 份）

| 板块 | 文档 | 一句话结论 |
| --- | --- | --- |
| **生态与事实** | [01](01_SCREEPS_AI_LANDSCAPE.md) 生态全景 | 半自动是主流，全自动孤例（TooAngel 十年）；十教训 |
| | [02](02_EXISTING_BOT_ANALYSIS.md) bot 考古 | 7 家源码级解剖；六条收敛（两级分离/孵化解耦/miner-hauler/情报缓存/terminal/quad）五条分歧 |
| | [03](03_SCREEPS_GAME_CONSTRAINTS.md) 机制事实 | 引擎常量级基准；10 条文档/社区错误裁决（boost 倍率/pixel/link 冷却…） |
| **大脑层** | [04](04_EMPIRE_ARCHITECTURE.md) 帝国 | 帝国七职责+三向接口；单房故障域隔离 |
| | [05](05_AGENT_ARCHITECTURE.md) Agent | Model A–E 裁决=修订版 D；仅战略层是受限 Agent；无 Agent Runtime |
| | [06](06_GOAL_AND_POLICY_SYSTEM.md) Goal/Policy | Goal=声明式谓词不竞拍；posture 四态滞回；EMA 预算门控 |
| | [07](07_PLANNING_SYSTEM.md) 规划 | 五种规划裁决；Planner 产出 Intent/Demand 非计划序列；防振荡三防线 |
| | [08](08_DEMAND_TASK_DIRECTIVE_MODEL.md) 四概念模型 | 数据流是环非链；幂等键+租约+六态生命周期 |
| **经济域** | [09](09_ROOM_ARCHITECTURE.md) 房间 | 能力门槛 phase 而非静态 role；六闭环；Report/Request 接口 |
| | [10](10_ROOM_DEVELOPMENT.md) 房间发展 | 六 phase 锚定 RCL 相变点；RCL8 后能量 sink 清单 |
| | [11](11_SPAWN_SYSTEM.md) Spawn | 唯一写者+需求驱动；census→demand→replacement horizon；紧急车道 |
| | [12](12_LOGISTICS_SYSTEM.md) 物流 | 请求池+租约+近似解（hauling NP-hard）；link 网固定路由；terminal 阈值制 |
| | [13](13_CONSTRUCTION_SYSTEM.md) 建造 | 模板+适配三流派裁决；版本化蓝图；交通热度铺路 |
| **安全域** | [14](14_INTELLIGENCE_SYSTEM.md) 情报 | 四域 intel+TTL 分档+三分置信度；Information value per CPU |
| | [15](15_DEFENSE_SYSTEM.md) 防御 | 威胁四级分级+五态状态机；能量会计胜负观；safemode 决策表 |
| | [16](16_MILITARY_SYSTEM.md) 军事 | war 唯一授权+止损链；quad/duo+boost SLA；十条「不应攻击」清单 |
| | [17](17_EXPANSION_SYSTEM.md) 扩张 | 七因子评分+G1–G5 门控；先 remote 尽调后 colonize；自举车道 |
| **平台层** | [18](18_MEMORY_ARCHITECTURE.md) Memory | 三级存储契约；幂等分 tick 迁移；九种膨胀失败模式 |
| | [19](19_SCHEDULER_KERNEL.md) 内核 | 轻量内核四职能（Quorum vs 平铺战绩裁决）；否决 OS 进程模型 |
| | [20](20_CPU_OPTIMIZATION.md) CPU | 三档节奏判据；intent 0.2 CPU 税先检后发；每房预算公式 |
| | [21](21_OBSERVABILITY.md) 观测 | 十域仪表盘；三级遥测 ≤3% 预算；人工接管触发清单 |
| | [22](22_SELF_HEALING.md) 自愈 | Monitor→…→Verification 闭环；有界六动作六禁令；熔断器 |
| **横切** | [23](23_LLM_AND_AGENT_RUNTIME.md) LLM/Agent | 运行时无出站网络（物理否决）；LLM 三层体外位置 |
| | [24](24_FAILURE_MODES.md) 失败模式 | 五大类 34 条（E/P/X/M/A）带案例与防线；级联断闸图 |
| | [25](25_ARCHITECTURAL_TRADEOFFS.md) 取舍台账 | T-01…T-14 张力→证据→选择→代价→回旋余地 |
| **交付物** | [26](26_FINAL_ARCHITECTURE.md) 最终架构 | 分层总图/数据流/决策流/数据契约/规模化分析 |
| | [27](27_IMPLEMENTATION_ROADMAP.md) 路线图 | A0–A5 × P1–P12 验收制；MVP 重定义；依赖图 |
| | [28](28_TESTING_STRATEGY.md) 测试 | L1–L6 层级+S1–S10 场景矩阵；纯函数可测性律 |
| | [29](29_RISK_REGISTER.md) 风险 | R-01…R-18 + 高风险详解 + 防线映射 |
| | [30](30_RED_TEAM_REVIEW.md) 红队 | 12 向量攻击；6 条成立均修复；无 ADR 推翻 |
| **台账** | [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) | ADR-001…012 + 决策依赖图 |
| | [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md) | 来源台账（A–G 分层）+ 10 条冲突裁决 + 未证实名单 |

## 3. 关键裁决速查

| 问题（任务书章节） | 裁决 | 出处 |
| --- | --- | --- |
| Empire 的核心抽象？谁有最终决策权？（§34） | 闭环集合；帝国层（posture×budget 纯函数）持有目标选择权 | 26/ADR-001/003 |
| AI 如何知道现在最重要的是什么？ | posture 允许集 ∩ 预算门控 ∩ P0–P3 优先级序 | 06 |
| Planner 生成什么、多久跑？ | Intent/Demand + 低频 Agenda；不进每 tick 路径 | 07 |
| Spawn 听谁的？ | 唯一写者+需求驱动+比例化 body | 11/ADR-005 |
| 房间是否自治？ | 本地闭环自治、目标不自治（无目标选择权） | 09/ADR-001 |
| 为什么扩张、何时停？ | 投资决策（评分+G1–G5 资源门控）；本土净流转负即停 | 17/ADR-008 |
| 为什么战争、何时撤？ | war 授权（持续被打+打得起）；止损链三闸 | 16/ADR-009 |
| 扩张后如何不 CPU 爆炸？ | 四档看门狗+分频+降级牺牲序（远矿先砍）+扩张门控 | 19/20 |
| 如何避免 Memory 膨胀？ | 三级存储准入契约+O(rooms) 上限+迁移清理 | 18/ADR-010 |
| 什么才是真 Agent？LLM 在哪？ | 目标选择权判据；LLM 体外三层 | 23/ADR-011 |
| MVP 是什么？ | 空帝国零人工自举到 RCL4+ 稳定经济（A1+A2） | 27/ADR-012 |

## 4. 证据纪律声明

- 全部关键结论可溯源至 [RESEARCH_SOURCES.md](RESEARCH_SOURCES.md)（含 10 条
  「社区/文档 vs 引擎常量」冲突的裁决记录与 3 个任务书点名但无法证实的 bot）。
- 置信度四级（CONFIRMED/LIKELY/UNCERTAIN/SPECULATION）贯穿全部文档；未证实
  推测绝不写成事实。
- 本次执行**未参考上一轮研究存档**（按总任务书要求从头执行）；与仓库冻结蓝图
  （docs/architecture/）的一致性属于研究结论的自然收敛，差异项应走 ADR 流程
  处理（见 26 号 §8 与 ADR 修订记录机制）。
