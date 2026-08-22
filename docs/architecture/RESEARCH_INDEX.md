# RESEARCH_INDEX · Phase 0 研究文档索引

> Phase 1 第一步：完整消化 Phase 0 的 35 份研究文档（[docs/research/](../research/)，
> 提交 f4d5fa3）后的结构化索引。列为：Topic / Key Findings / Important Decisions /
> Conflicts（与其他研究文档或社区实践的冲突）。本文是 Phase 1 综合与调和的输入，
> 不是新的研究结论。

## A. 生态与事实层

| Document | Topic | Key Findings | Important Decisions | Conflicts |
| --- | --- | --- | --- | --- |
| [01](../research/01_SCREEPS_AI_LANDSCAPE.md) | AI 生态全景 | 半自动玩家是主流、全自动是孤例（TooAngel 十年无人值守）；ML/LLM 只存在于体外生态位；生态级项目死因（维护力衰减>技术失败）；社区十教训（移动是 CPU 大头/死亡循环头号死因/围城耗能破防/safemode 约束…） | 定位：全自动自治为目标，但按验收门槛分级诚实交付 | 无（汇总层） |
| [02](../research/02_EXISTING_BOT_ANALYSIS.md) | 7 家 bot 源码考古 | 谱系六分类（Role/Task/Manager/Kernel-Process/Directive-Operation/Hybrid）；**六条收敛**：两级分离、孵化解耦、miner-hauler+link、情报缓存、terminal+市场、quad+boost；五条分歧；Overmind 7 层 vs TooAngel 平铺的本质权衡 | 取「4 层 + 组合根」中间态 | KasamiBot 按房孵化队列长期存活 vs 全局队列（→11 号裁决） |
| [03](../research/03_SCREEPS_GAME_CONSTRAINTS.md) | 机制事实基准 | 引擎常量级核查：CPU/bucket、segments 100×100KB 异步、寻路 1 op≈0.001 CPU、RCL 门禁表、boost 分类别倍率、战斗数值、GCL 1e6×L^2.4 | 裁决序：引擎常量 > 官方散文 > 社区 wiki | **10 条已裁决**：pixel=10000、link 冷却=切比雪夫距离、boost 倍率表、power bank=5000、downgrade 表、运费指数公式、订单 300、tower 25%、global reset 无频率承诺、tick 2.5–5.5s |

## B. 大脑层（04–08）

| Document | Topic | Key Findings | Important Decisions | Conflicts |
| --- | --- | --- | --- | --- |
| [04](../research/04_EMPIRE_ARCHITECTURE.md) | 帝国层 | 七项职责（注册/跨房供需/扩张/市场/军事资源/全局优先级/GCL）；empire↔room 三向接口（报告/请求/下发）；8 类帝国级失败（援助雪崩/死锁/影子通道…）；GCL 1→30 演进压力 | 请求牵引为主、配额为辅的混态经济信号 | 与配额式（KasamiBot/hivemind 先例）的分歧已记录并裁决 |
| [05](../research/05_AGENT_ARCHITECTURE.md) | Agent 判据 | Model A–E 七维对照；Multi-Agent 社会六点否决；合同网「认领+租约」合理内核 | 裁决=修订版 Model D；**仅战略层是受限 Agent**（确定性纯函数） | 无硬冲突；与「Manager 都叫 Agent」的命名污染划界 |
| [06](../research/06_GOAL_AND_POLICY_SYSTEM.md) | Goal/Policy | Goal=声明式常量谓词不竞拍；posture 四态（进入/退出/滞回表）；budget=五域 EMA（TooAngel 三指标源码级形式化推广）；三层目标映射；Goal 五终态 | 「Goal 竞争」= posture 允许集 ∩ 预算门控 ∩ 优先级序 | 三指标出处修正：Design.html 不含、在 main.js/brain_nextroom.js（源码级） |
| [07](../research/07_PLANNING_SYSTEM.md) | 规划系统 | 五种规划逐一裁决：reactive 保留 / scheduled 仅维护 / strategic=纯函数 / operational=低频 Agenda / tactical 禁序列规划；防振荡三防线（滞回+minDuration+重建冷却） | **Planner 产出 Intent/Demand 与低频 Agenda，不产出计划序列、不进每 tick 路径** | 与任务书「三层 Planner」假设冲突（裁决：简化为战略纯函数+议程复核） |
| [08](../research/08_DEMAND_TASK_DIRECTIVE_MODEL.md) | 四概念模型 | 数据流是**环非链**（Policy 授权开 Agenda，Agenda 与房间稳态共同生成 Demand）；对任务书原模型 5 处修正；幂等键规范+六态生命周期；Demand 是瞬时候选不持久化 | Directive 收编为 AgendaItem；Task=带租约执行单元 | 与 26 号早期链式表述已调和（环模型为准） |

## C. 经济域（09–13）

| Document | Topic | Key Findings | Important Decisions | Conflicts |
| --- | --- | --- | --- | --- |
| [09](../research/09_ROOM_ARCHITECTURE.md) | 房间层 | 能力门槛 phase 四层论证（本体论/状态维护代价/社区零先例/目标选择权归帝国）；六闭环清单；Report/Request 接口；灾后恢复=独立 phase | **不用静态 room role 标签**；远矿房不是房间层单元 | 远矿归属留 Open Question（→17 号裁决为 Operation 属地） |
| [10](../research/10_ROOM_DEVELOPMENT.md) | 房间发展 | 六 phase 锚定 RCL 相变点（4 storage/5 link/6 terminal+lab/7 factory+双spawn/8 军事）；RCL7→8 纯升级 ≥72,900 tick；RCL8 后能量 sink 清单（GCL farm/temple/power） | 发展节奏锚定能力相变而非均匀分级 | 「RCL8 约 3 周」为 LIKELY（Reddit 个案） |
| [11](../research/11_SPAWN_SYSTEM.md) | 孵化 | 唯一写者；census 双口径（creep 数+部件数）→demand→replacement horizon 管道；5W 矿工数学复核；P0–P3 车道+紧急车道（≥200 能量 [W,C,M]）；幂等 key/黑名单/撤销/recycle | **全局唯一写者**（帝国核算需要全局口径） | KasamiBot 按房队列可行（存活证据）——裁决为框架选择非社区共识 |
| [12](../research/12_LOGISTICS_SYSTEM.md) | 物流 | 请求池+租约+aging；link 固定路由+阈值；terminal 阈值制+运费指数核算（d=5→15.4%、d=30→63.2%）；顺路投递；断链 fallback 链 | hauling 取近似解（NP-hard 论证）；远距调拨走市场不走搬运 | link 冷却勘误回写 03 号（引擎源码复核） |
| [13](../research/13_CONSTRUCTION_SYSTEM.md) | 建造布局 | 三流派存活证据不对称（模板阵营全存活、算法阵营停更/实验）；版本化蓝图+迁移；全局 100 site 官方上限+每房 3+2+1 限额；交通热度铺路；blocked 不自动拆 | **模板+约束适配**（否决逐房算法生成主布局） | 道路热度阈值（主干 200/支线 500）为 SPECULATION 初值待 soak 校准 |

## D. 安全域（14–17）

| Document | Topic | Key Findings | Important Decisions | Conflicts |
| --- | --- | --- | --- | --- |
| [14](../research/14_INTELLIGENCE_SYSTEM.md) | 情报 | 四域数据模型+IntelEntry 契约；TTL 分档表；fact/stale/inferred 三分置信度；被动/observer/scout 三通道；segment 分片 schema | Information value per CPU：低价值情报不占高优先级 CPU | observer「无 cooldown」为常量级复核（散文页未确认） |
| [15](../research/15_DEFENSE_SYSTEM.md) | 防御 | 威胁四级分级链；normal→alert→siege→recovery→stabilizing 状态机；能量会计胜负判定式；tower 自检/停火；safemode 决策表；**离线 min-cut 固化进模板**；nuke 预案 | 防御本质=能量会计（围城耗能是头号破防手段） | min-cut 自动生成（社区演进终点）vs 工程现实——裁决离线固化 |
| [16](../research/16_MILITARY_SYSTEM.md) | 军事 | 授权链；战争账本（打得起=预期损失≤战争基金）；quad/duo+boost SLA；集结 FSM；目标新鲜度硬门槛；power/SK=准军事 Operation（ROI 门控、非 war 授权）；十条「不应攻击」清单 | **war posture 唯一进攻授权+止损链不可绕过** | power bank 数值冲突（wiki 10k vs 引擎 5000，已裁决） |
| [17](../research/17_EXPANSION_SYSTEM.md) | 扩张 | 四类动机；七因子评分公式；G1–G5 资源门控；**先 remote 尽调后 colonize 决策序**；自举车道全流程+失败降级表；GCL 节奏联动；Novice 窗口 | 扩张=投资决策（评分+门控+可撤离）；远矿=母房 Operation 属地 | 「GCL 到即扩」社区惯例被批判性采纳（需门控） |

## E. 平台层（18–22）

| Document | Topic | Key Findings | Important Decisions | Conflicts |
| --- | --- | --- | --- | --- |
| [18](../research/18_MEMORY_ARCHITECTURE.md) | Memory | 三级存储契约（准入判据+owner+失效条件）；幂等分 tick 迁移规范（先写新验证后删旧、游标入 Memory）；冷数据 TTL 表；九种膨胀失败模式 | 否决 TooAngel 存路径反例与 MemHack 极端形态 | Memory 2048KB 上限=贡献文档口径（LIKELY，不赌上限） |
| [19](../research/19_SCHEDULER_KERNEL.md) | 内核 | Screeps 与传统 OS 六维差异；Quorum（有内核 2021 停更）vs 平铺阵营（战绩更好）裁决表；P0–P3 降级牺牲序；四档看门狗；饥饿老化；紧急车道 | **轻量内核四职能**（调度/隔离/预算/迁移）；否决 process/PID/sleep/抢占 | hivemind 证明轻量进程可长期维护——语义对、载体错 |
| [20](../research/20_CPU_OPTIMIZATION.md) | CPU | intent≈0.2 CPU 且失败也收费→先检后发；三档节奏判据 N≈变化时间尺度÷4；寻路三档限频+两级；build/refresh 缓存；每房预算公式 B=U−F−C；pixel 仅 Healthy 档 | 移动是 CPU 第一大头——减少走动（静态矿工/link/紧凑布局）优先于算法优化 | 每房 3–5 CPU 为玩家数据点（优化后 10 CPU 跑 1–2 房）——预算公式需实测校准 |
| [21](../research/21_OBSERVABILITY.md) | 观测 | 十域仪表盘最小完备清单；三级遥测管线（L1 计数器→L2 聚合→L3 segment）预算 ≤3% limit；TI/Quorum Grafana 先例；告警三级+人工接管触发清单 | 指标「一鱼两吃」：自治输入与人类观测共用一份 | 无 |
| [22](../research/22_SELF_HEALING.md) | 自愈 | Monitor→Anomaly→Diagnosis→Recovery→Verification 闭环（诊断=签名查表非推理引擎）；故障域三级；有界六动作 vs 六禁令；global reset 惰性重建；熔断器（3 次→50–200 tick 冷却、P0 永不、到期必复评） | 自愈只做有界动作；超界升级人工 | 无 |

## F. 横切与交付物（23–30 + ADR/SOURCES）

| Document | Topic | Key Findings | Important Decisions | Conflicts |
| --- | --- | --- | --- | --- |
| [23](../research/23_LLM_AND_AGENT_RUNTIME.md) | LLM/Agent | 运行时无出站网络（物理否决）；Agent 判据=目标选择权；无 Agent Runtime；LLM 三层体外位置；禁止清单 | LLM 永不进 tick 路径 | derek 方案纯规划无实测（诚实降级引用） |
| [24](../research/24_FAILURE_MODES.md) | 失败模式 | 五大类 34 条（E1–E6/P1–P6/X1–X6/M1–M8/A1–A8）带机理+案例+防线；级联断闸图；三层防线 | 失败是设计输入不是附录 | 无 |
| [25](../research/25_ARCHITECTURAL_TRADEOFFS.md) | 取舍台账 | T-01…T-14（张力→证据→选择→代价→回旋余地）；四个元取舍否决（含「两头下注」） | 取舍全部显式化、带回旋余地标注 | 无 |
| [26](../research/26_FINAL_ARCHITECTURE.md) | 最终架构 | 分层总图/八步 tick 数据流/决策流/核心数据契约八表/模块清单/规模化分析/与任务书 §31 对照 | Phase 0 架构结论总纲（Phase 1 的再检验对象） | — |
| [27](../research/27_IMPLEMENTATION_ROADMAP.md) | 路线图 | A0–A5 验收门槛 × P1–P12 Phase；MVP=A1+A2（空帝国自举）；非显然依赖（防御先于军事/远矿先于扩张/自愈横切） | 验收制交付 | — |
| [28](../research/28_TESTING_STRATEGY.md) | 测试 | L1–L6 层级（静态/纯函数/fake adapter/私服/soak/canary）；S1–S10 场景矩阵；**纯函数律：决策函数出现 `Game.` 即架构违规** | hivemind mock 目录为现实先例 | — |
| [29](../research/29_RISK_REGISTER.md) | 风险 | R-01…R-18；三大高风险详解（死亡循环/自适应振荡/PvP 对抗演化）；防线↔风险映射；残余风险声明 | 概率/影响为 SPECULATION 待 soak 回填 | — |
| [30](../research/30_RED_TEAM_REVIEW.md) | 红队 | 12 向量攻击；6 条成立均修复（战略分频/远矿恢复节流/war 滞回≥波次周期/spawn P0 永不熔断/仲裁分桶/停滞白名单）；无 ADR 推翻 | 元结论：**自适应机制自身是头号振荡源** | — |
| [ADR](../research/ARCHITECTURE_DECISIONS.md) | 决策记录 | ADR-001…012 + 依赖图 | 全部裁决的规范表述 | — |
| [SOURCES](../research/RESEARCH_SOURCES.md) | 来源台账 | A–G 分层；10 条冲突裁决记录；未证实名单（Acorn/SIV/Moose）；公认六大经典库 | 证据纪律 | — |
