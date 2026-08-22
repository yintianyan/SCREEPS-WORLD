# RESEARCH EXECUTIVE SUMMARY · 如果今天开始开发 Screeps AI Empire

> 总任务书 §36 交付物（2026-08-22 重新执行的全量调研：官方机制核查 + 7 家 bot
> 源码级考古 + 社区经验挖掘 + 红队评审）。只回答一个问题：**如果今天开始开发
> Screeps AI Empire，我们最终应该采用什么架构？** 套件导航见
> [research/00_EXECUTIVE_SUMMARY.md](research/00_EXECUTIVE_SUMMARY.md)。
> 一句话版本：**确定性闭环 + 轻量内核 + 两级决策（姿态×预算帝国 / 能力门槛
> phase 房间）+ 唯一写者执行层 + 验收制路线——不用 Agent Runtime，不用每 tick
> 规划器，不让任何不确定性进入 tick 路径。**

## 1. 核心架构

**感知→状态→战略→规划→分配→执行→反馈**的确定性闭环，跑在轻量内核上。帝国 AI
= 互相供养的五个闭环（生存/能量/人口/知识/演化），不是一个 Manager 堆，也不是
分层 Agent 社会。轻量内核四职能：固定顺序系统管线（P0 生存→P1 稳定→P2 发展→
P3 增长）、safeRun 错误隔离+熔断、四档 CPU 看门狗（按 `Game.cpu.limit` 比例化、
降级立即恢复滞回）、Memory 版本迁移。否决完整 OS 进程模型（Quorum 先例：内核
本身不产生游戏价值，2021 停更；战绩最好的进攻型 bot 全在平铺/轻调度阵营）。

## 2. 核心模块

组合根注册的系统集：帝国战略（posture×budget）· 议程/Operation 管理 · 房间状态
归一化+快照 · Spawn Manager（唯一 `spawnCreep` 写者）· 分配服务 · 建造/远矿
管理（`createConstructionSite` 仅有的两个写者）· 威胁评估+塔控 · 交通仲裁
（tick 末统一签发 move）· Terminal/市场（唯一订单写者）· 情报（TTL+置信度）·
调参引擎+自愈监视。执行层=声明式 RolePolicy（gate/acquire/work/hold/onFlee/
park/combat）+统一引擎+共享 FSM。

## 3. 数据流（每 tick）

只读快照 → 分频状态归一化 → 战略（态势过期则沿用上次决策）→ 议程复核（低频）
→ 需求推导（人口缺口→spawn intent / 供需池→物流租约 / 建造队列）→ RolePolicy
执行（非移动动作直发，移动登记意图）→ 按房交通仲裁 → 遥测/健康度/异常检测。
写者唯一的所有权模型保证幂等：重复 tick、global reset、部分失败都不产生重复
对象（spawn/site/订单）。

## 4. 决策流

帝国态势 → posture（peace/fortify/war/evacuate，滞回切换）+ 预算（CPU/能量/人口）
→ Agenda/Operation（中期承诺：远矿车道/扩张殖民/战争波次/重建，每项带预算、
期限、取消条件）→ Demand（每 tick 确定性推导的缺口请求）→ Task/Intent（租约
+幂等键）→ Action → Outcome 反馈。Goal 不做每 tick 效用竞拍——TooAngel 用三个
指数平滑指标门控一切决策维持十年无人值守，是对竞拍模型的实践否证。

## 5. Agent 边界

判据：组件是 Agent 当且仅当拥有运行时目标选择权。全架构**仅帝国战略层**是
受限 Agent（且为确定性纯函数）；其余全是确定性系统。**不建 Agent Runtime**；
LLM 永不进入 tick 路径（运行时物理上无出站网络），合法位置=体外开发研究员 /
低频有界参数顾问（白名单+护栏+canary）/ 灾难接管辅助。社区零先例 + 物理否决
+ 可靠性三重裁决。

## 6. CPU 策略

三档节奏（每 tick / 每 N tick / 事件触发；N≈变化时间尺度÷4）；两级寻路
（findRoute+房内 maxRooms:1）+ 三档限频 + CostMatrix 缓存；heap build/refresh
缓存（随时容忍 global reset）；先自检再发 intent（0.2 CPU/次失败也收费）；
移动是 CPU 第一大头——静态矿工+link 网+紧凑布局减少走动本身是最大优化；
pixel 仅 Healthy 档桶满生成；扩张门控用指数平滑 CPU/heap/memory 指标。

## 7. Memory 策略

三级存储：Memory 只存 ID/枚举/少量数字（schema 版本化+幂等迁移+分 tick 大迁移，
游标入 Memory）；heap=可重建缓存（TTL+惰性重建）；segment=冷数据（intel/市场
历史/遥测，低频读写）。膨胀上限按 O(rooms) 设计，历史永不进 Memory。

## 8. Empire 模型

帝国层拥有目标选择权与跨域仲裁：房间注册、跨房供需、扩张/远矿立项、市场、
军事资源、全局优先级。下发的是带预算与期限的 Agenda，不逐 creep 指挥。单房
故障域隔离——房间失守不拖垮帝国（援助有上限、可降级、可放弃）。

## 9. Room 模型

能力门槛 phase（锚定 RCL 相变点：RCL4 storage / RCL5 link / RCL6 terminal+lab /
RCL7 factory+双 spawn / RCL8 军事结构），**不用静态 room role 标签**。房间对
本地能量/人口/物流/建造/升级/防御闭环负责，向上报告需求/产能/风险；远矿房
不是房间层单元（属母房 Operation 属地）。灾后恢复是独立 phase 路径。

## 10. Economy 模型

静态矿工（5W 惯例体型）+container → 请求池物流（供给/需求请求+租约+近似解，
hauling 是 NP-hard 不求最优）→ link 网（source→storage/controller）→ terminal
阈值制帝国均衡（运费指数公式核算，近距离调拨近乎免费、远距离走市场）→ 市场
边际价值决策（5% 挂单税、getAllOrders 低频缓存、幂等键防重复成交）。能量收支
核算（净流/储备/预算）先于一切发展决策；RCL8 后能量过剩是常态，sink=GCL farm
房/temple/power spawn。

## 11. Military 模型

防御=能量会计+威胁分级状态机（normal→alert→siege→recovery）：围城耗能是社区
确认的头号破防手段，防守比的是储备与补给；min-cut rampart 方向、safemode 当
战略预算管理（每 shard 一房、拦不住 nuke）。进攻=war posture 唯一授权（持续
被打+打得起）+war-planner 唯一执行者+不可绕过的止损链（伤亡阈值收摊/黑名单
冷却/经济超标退 fortify）；quad/duo+boost 前置；战后只信新鲜 intel。

## 12. 实施顺序

验收制 A0→A5：P1 运行时基座 → P2 单房生存闭环（空 Memory 自举=MVP 前半）→
P3 产能闭环 → P4 房间发展自动化 → P5 远矿 → P6 帝国协调 → P7 扩张 → P8 防御
→ P9 军事 → P10 高级经济 → P11 自愈强化+soak。关键非显然依赖：防御先于军事、
远矿先于扩张（扩张门控需要远矿定价数据）、自愈横切每个 Phase。

## 13. 最大风险

① CPU 死亡循环（社区头号死因：超限→吸干 bucket→停机→creep 全灭）——防线：
降级链保 spawn 优先+滞回恢复。② 自适应机制自身成为振荡源（恢复风暴/姿态打摆/
停滞误诊）——防线：一切自动切换带承诺期与预期状态核对。③ PvP 对抗演化不可
静态根除——防线：止损链+战争账本复盘闭环。

## 14. 第一阶段应该做什么

P1 运行时基座 + P2 空帝国自举：内核骨架（调度/隔离/看门狗/迁移）+ 静态矿工+
请求池物流最小版 + 集中 spawn + 基础建造。**验收即测试自治**：从 1 spawn +
300 能量、空 Memory 开始，零人工指令，30 万 tick 内达 RCL3+ 且 tower 在建、
关键角色自动补位。做不到这个，后面的「帝国」都是空中楼阁。

---

证据与完整论证：[research/26_FINAL_ARCHITECTURE.md](research/26_FINAL_ARCHITECTURE.md)
（最终架构）· [research/ARCHITECTURE_DECISIONS.md](research/ARCHITECTURE_DECISIONS.md)
（ADR-001…012）· [research/30_RED_TEAM_REVIEW.md](research/30_RED_TEAM_REVIEW.md)
（红队评审与修订记录）· [research/RESEARCH_SOURCES.md](research/RESEARCH_SOURCES.md)
（来源台账与冲突裁决记录）。
