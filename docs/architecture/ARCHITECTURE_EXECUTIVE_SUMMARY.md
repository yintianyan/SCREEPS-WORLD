# ARCHITECTURE_EXECUTIVE_SUMMARY · 架构执行摘要（15 问）

> Phase 1 §37 终报：只回答 15 个问题。合同正本：
> [ARCHITECTURE_FREEZE.md](ARCHITECTURE_FREEZE.md)。一页图：
> [EMPIRE_ARCHITECTURE.mmd](EMPIRE_ARCHITECTURE.mmd)。

**1. Screeps AI Empire 的核心抽象是什么？**
一组互相供养的**确定性闭环**（生存/能量/人口/知识/演化），由轻量内核维持秩序。
不是 Manager 堆、不是分层 Agent 社会。概念合同见 EMPIRE_SYSTEM_MODEL（17 概念）。

**2. Empire 的「大脑」是什么？**
**Policy 纯函数**（posture 四态 × 五域预算）：输入帝国态势快照，输出方向与配额。
它是全系统唯一受限 Agent（唯一拥有目标选择权的组件），且完全确定性、可单测。
无 Planner 组件、无 Goal 竞拍引擎、无 Agent Runtime。

**3. Room 的职责是什么？**
本地六闭环（能量/人口/物流/建造/升级/本地防御），能力门槛 phase 描述状态，
Report/Request 通道向上。不拥有目标选择权与跨房资源处分权。

**4. Operation 的职责是什么？**
运行时形态=**AgendaItem**（中期承诺）：远矿车道/扩张殖民/战争波次/重建/准军事
五种冻结类型；带预算、期限、取消条件、属地（母房）、结果核验；低频复核不进每
tick 路径。

**5. Goal / Policy / Plan / Demand / Task 如何协作？**
Goal=声明式谓词（不实例化）→ Policy 求值（分频，过期沿用）授权并预算 →
AgendaItem 立项 → **Agenda 与房间稳态共同生成 Demand**（每 tick 瞬时）→ 认领即
Task（租约六态）→ 执行 → Outcome 反馈 → Agenda 更新 → Goal 谓词终态判定。
环语义，非单向链（GOAL_POLICY_PLAN_MODEL §2）。

**6. 谁拥有最终决策权？**
目标选择权唯一归 Policy；六项全局唯一写者（spawnCreep/site×2/move/market/跨房
调拨）；四考题答案：帝国赢但有生存保底线 / posture 分账非竞争 / 防御走 P0 让路
不绕路 / 车道→Agenda 序→饥饿老化（DECISION_AUTHORITY_MODEL）。

**7. Economy 如何运行？**
能量**属 Room**、帝国持调拨权（门控：本土净流为正）；净流/储备/风险缓冲三指标
先于一切发展决策；五类消费者按 P 级×姿态双档配给；RCL8 后 sink 目标集消化富余
（ECONOMY_ARCHITECTURE）。

**8. Logistics 如何运行？**
请求池+租约+aging 的**近似解**系统（hauling NP-hard）；link 固定路由+阈值；
terminal 阈值制+运费指数核算（远距走市场）；四级断链 fallback 链
（LOGISTICS_ARCHITECTURE）。

**9. Spawn 如何运行？**
SpawnManager 全局唯一写者；census（双口径）→demand→replacement horizon 管道；
车道制 P0–P3+紧急直通（≥200 能量 [W,C,M]，内核级）；幂等 key+黑名单+撤销+
recycle；先来先得非法（SPAWN_ARCHITECTURE）。

**10. Planning 如何运行？**
无 Planner 组件——职责三分：战略=Policy 纯函数；中期=Agenda 低频复核（防振荡
三防线+资源回购窗口）；即时=各系统确定性推导。禁每 tick 竞拍/在线学习/GOAP
（PLANNING_ARCHITECTURE）。

**11. Military 如何运行？**
war posture 唯一进攻授权（持续被打+打得起=预期损失≤战争基金）；war-planner
唯一进攻执行者；止损链不可绕过（伤亡收摊/黑名单/经济超标退 fortify，滞回≥
波次周期）；quad/duo+boost SLA；power/SK=准军事 ROI 门控；战后只信新鲜 intel
（MILITARY_ARCHITECTURE）。

**12. CPU 如何控制？**
六档频带+四档看门狗（按 `Game.cpu.limit` 比例化、降级立即恢复滞回、牺牲序
P3→P2→P1、P0 永不）；每房预算 B=U−F−C；intent 先检后发；扩张门控用 EMA 指标；
10/20/50 房推演表在案（CPU_EXECUTION_MODEL）。

**13. Agent 的边界在哪里？**
判据=运行时目标选择权；唯一受限 Agent=帝国战略层；其余全部确定性系统；命名
禁令防概念污染；无 Agent Runtime；自治交付按 A0–A5 诚实分级
（AGENT_ARCHITECTURE）。

**14. LLM 的边界在哪里？**
禁入 tick 路径（物理：无出站网络）；三层体外位置（开发研究员/低频参数顾问/
灾难接管辅助）；五禁清单；外部不可用时帝国照常安全运行（LLM_BOUNDARY）。

**15. 明天开始开发，第一件事情应该做什么？**
按 IMPLEMENTATION_PHASES 开工 **P1 运行时基座 → A0 门槛**：内核四职能骨架
（管线/safeRun/看门狗/迁移）+ 三级存储骨架 + 唯一组合根 + 静态检查（依赖方向
lint/domain 纯函数律），验收=空/坏/旧 Memory 三场景恢复+错误隔离+降级滞回。
紧接 P2 空帝国自举（MVP 前半）。**不需要再问任何架构问题**——实现遇到冲突时
走 FREEZE §15 修订，不重决设计。
