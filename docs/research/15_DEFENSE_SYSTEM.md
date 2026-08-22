# 15 · 防御系统（Defense System）

> 研究文档 · 结论等级：**设计裁决**（社区战例证据 + 官方数值核查 + bot 对照）。
> 战斗数值/safemode/nuke 机制以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
> §6/§8 为基准；裁决依据 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> ADR-009（授权链）；布局约束见 [13_CONSTRUCTION_SYSTEM.md](13_CONSTRUCTION_SYSTEM.md)。
> 核查日：2026-08-22。

## 1. Problem

自治帝国无法人工判断「这次攻击要不要紧」。防御系统的本质不是击杀敌人，而是
**保住恢复能力**（controller、spawn、能源、撤退通道——strategy-playbook Defense
节）。社区战例证明真正打垮人的不是正面战斗而是**围城耗能**：老玩家停在房间
边缘不进来，等你 tower+spawn 把能量（含 storage）烧干再推进（reddit 55aapi，
2016，CONFIRMED）。因此防御必须当作**能量与 CPU 的持久消耗战管理问题**，用
会计而不是反应堆来设计。

本文裁决：威胁检测/分级/响应全链、防御 policy 状态机、tower 目标策略、
safemode 决策表、rampart 策略、invader 骚扰响应、防御与 posture 的关系。

## 2. Research Questions

1. 威胁如何从「可见敌 creep」升级为「分级威胁评估」？分几级、各自响应？
2. 防御状态机（normal→alert→siege→recovery→stabilizing）的转移条件与配额？
3. tower 目标策略如何避免浪费（0.2 CPU/intent 失败也收费）与被 heal 抵消？
4. safemode 何时开：每 shard 一房 + 拦不住 nuke 的双重约束下的决策表？
5. rampart 策略：min-cut 理想与版本化模板现实如何调和？nuke 预警如何响应？
6. invader（NPC 骚扰）与敌 claimer/reserver 如何分级处理？
7. 房间级防御状态与帝国 posture 如何互相供给而不抖动？

## 3. Existing Solutions（方法论参照）

strategy-playbook：把 safe mode、tower、rampart、defender、资源撤离、spawn
配额和 CPU 降级编成 **policy 状态机**；每次警报记录事实、置信度、预计持续
时间、消耗上限、退出条件和失败后的 rebuild/evacuate 行为；先保护恢复能力再
优化击杀数。pvp-and-intelligence 参考：Response policy 按 normal/alert/siege/
recovery 给出防御、spawn、资源与 CPU 配额；决策顺序是 detect → identify →
estimate confidence → protect survival chain → …。两者共同指向：防御=带预算
的状态机，不是事件-动作反射。

## 4. Screeps Community Practice

- **围城耗能是头号破防手段**（reddit 55aapi，2016）：攻击方在房外游走让塔
  空烧，能量（含 storage）耗干后推进；2026-08-22 复核另获 tanjera/screeps
  战术库直接记载 **Tower Drain** 战术（tank+healer 在敌房外集结，tank 进房
  吸塔火力后轮换治疗）——攻方视角证实这是标准战术，防御设计必须按「对手
  就是来耗能的」建模（CONFIRMED）。
- **Safemode 常规**：社区自动化触发惯例为 spawn 血量 <50% 或敌人贴近任一关键
  建筑时开；约束为每 shard 同时一房、20,000 tick 时长、50,000 tick 冷却、
  可用 ghodium 补充（03 §6）；**拦不住已发射的 nuke**，对 nuke 的唯一答案是
  厚 rampart（1M+ hits）+ 50k tick 飞行时间内移走/加盖内部结构（reddit
  662flg、wiki Combat/StructureController，CONFIRMED，与 03 §8 引擎常量一致）。
- **防御墙演进终点是 min-cut rampart**（最大流最小割）：用算法求出封死基地
  的最小 rampart 集合（clarkok gist、sy-harabi 教程、screeps-min-cut-wall
  脚本、screepspl.us Defensive Structures 的 shrink-wrap 技术，
  2026-08-22 复核 CONFIRMED）。
- **塔机制事实**（03 §8）：攻击 600/治疗 400/修理 800，每次 10 能量，≤5 格
  满效、5→20 格线性衰减至 25%——防御纵深与 bunker 布局（13 §5）由此而来；
  塔是主力 DPS 但每 tick 每 intent 有 0.2 CPU 固定成本且**失败也收费**。
- **SK keeper/invader**：NPC 威胁分两型——invader 在远矿房随机骚扰（中期
  主要敌情）、SK keeper 是中心房常驻（16 号文档准军事处理）。

## 5. Existing Bot Analysis

| Bot | 防御形态 | 可迁移点 | 备注 |
| --- | --- | --- | --- |
| TooAngel | 塔控 + defender + **towerdrainer**（自己也会吸塔） | 攻防同构：塔耗模型双向可用 | 声誉分级防守资源（见 16 号文档 §5） |
| KasamiBot | borderwall + fortresswall **双层墙**；safemode 自动触发；跨房支援请求 | 多层防御纵深；防御协作协议 | 长期存活 |
| Quorum | conflict.js / defense / fortify 独立进程 | 防御为主的完整生命周期（防御 bot 范本） | 进攻能力有限 |
| The International | README 自评战斗代码 dysfunctional 但**防御强** | 防御可先于进攻成熟（27 号文档 P8→P9 顺序的实证） | fastFiller 保塔弹 |
| Overmind | bunker + autoSiege 类 directive 攻防一体 | 布局即防御（tower 覆盖优先） | 顶级战绩 |
| hivemind | 刻意不防核（限武哲学） | 反例：防核是被牺牲的选项而非必然 | 防御范围是决策项 |

**收敛点**：塔控自动化 + 防御结构纵深 + safemode 触发逻辑三件套是标配；
分歧在防御协作（跨房支援）与防御范围（是否防核）。

## 6. Advantages（状态机 + 能量会计的优势）

1. **可测试**：威胁注入（模拟敌编队快照）可直接验证分级与状态转移（27 号
   文档 P8 验收即此形态），反射式防御无法回归测试。
2. **「守住」被量化**：能量会计把防御胜负定义成可计算不等式（§10.4），不
   再依赖「塔在打就以为安全」的错觉。
3. **safemode 从按钮变资产**：预算化决策表避免把每 shard 唯一名额浪费在
   骚扰上。
4. **与降级链正交**：防御属 P0 优先级（19 号文档），Recovery 档下不砍——
   但其内部仍有配给序（塔弹 > defender 补位 > 修复）。

## 7. Disadvantages（代价）

- 状态机与分级的复杂度：误判（把骚扰当围城）会过度动员烧能量，反向误判
  （把围城当骚扰）致命——只能靠滞回 + 分级阈值保守化缓解。
- 能量会计需要准确的敌情输入（heal 量/boost 检测），依赖 14 号文档 fact 级
  情报，情报盲区即会计盲区。
- min-cut 理想形态与版本化模板（ADR-007）存在张力：离线生成固化是折中，
  意味着模板换版才更新防线。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 塔能量枯竭（围城耗能，R-08） | 防线全失、被拆家 | 能量会计（§10.4）：siege 配给 + storage 底线 + 补给 SLA + 认输条件 |
| safemode 误用（骚扰触发/占用名额） | 真围城时无牌可打（R-09） | 决策表（§10.5）+ 每决策记账；nuke 落点已宣布时不开（拦不住） |
| 塔空发 intent（目标已死/不可达） | 0.2 CPU×塔数×tick 白烧 | 发前自检：目标存在、射程/衰减区、能量充足 |
| 塔火力被 heal 完全抵消仍持续开火 | 纯耗能（正中 Tower Drain 战术） | 会计判定：敌有效 heal > 塔净伤时转「停火蓄能/等 defender」策略 |
| rampart 断档（衰减 300 hits/100 tick 未维护） | 防线缺口 | rampart 完整度进房间防御闭环（09 §10.2）低频巡检 |
| invader 骚扰拖垮远矿经济 | 远矿 ROI 转负 | 远矿车道威胁响应：撤/守分级（P5 已定：敌袭自动暂停 N tick 恢复） |
| recovery 后虚假稳定 | 复盘未完成就回 normal，二次打击失守 | stabilizing 态滞回 + 战后核验（16 号文档）通过才归 normal |
| 防御动员级联（一房 alert 全帝国惊动） | CPU/能量错配 | 防御状态是房间级的；帝国级输入经报告聚合（09 §10.3） |

## 9. CPU Implications

- 威胁评估**分频 + 事件驱动**：无威胁房每 tick 近零成本（只查威胁缓存
  时间戳）；敌可见期升频到每 tick 轻量（从威胁缓存取目标，不重扫）。
- 塔控成本 = 塔数 ×（决策 + intent 0.2 CPU）：RCL8 六塔每 tick 全动作约
  1+ CPU——**停火策略**本身是 CPU 节约手段（被 heal 抵消时停火即省钱又蓄能）。
- siege 期防御系统优先级上调（P0），但看门狗仍然兜底：bucket 进 Recovery
  时只保塔控与最小 defender 车道，修复/建造让位。
- 修复（repair 100/part）与加固是低频批处理，不与塔争 tick 末时间片。

## 10. Recommended Design

### 10.1 威胁检测与分级链

```text
可见敌 creep → identify（body 解析：attack/ranged/heal/dismantle/claim 计数
+ tough/boost 检测 + 玩家 vs NPC）→ 量级估计（编队 heal 总量、有效 HP、
补给距离——pvp-and-intelligence 的 Economic estimate）→ 分级 → 匹配 policy
```

分级表（房间级枚举）：

| 等级 | 判据（例） | 响应要点 |
| --- | --- | --- |
| 0 无威胁 | 无可见敌 | normal：零成本巡检 |
| 1 骚扰（invader/单只游猎） | NPC 或 1–2 只低价值 | 塔自动处理；远矿房走撤退预案 |
| 2 raid（小队突入） | 编队含 attack/dismantle，heal 弱 | alert：塔集火 + defender 补位 + 配给启动 |
| 3 siege（围城/吸塔） | 敌在房外游走或 heal ≥ 塔净伤 | siege：能量会计接管（§10.4） |
| 4 拆家/占领（dismantler 群/claimer） | dismantle 编队或 claim 动作 | 保命序：关键结构优先 + safemode 候选 |

### 10.2 防御 policy 状态机

`normal → alert → siege → recovery → stabilizing`（与 27 号文档 P8 交付
一致）：

- 每态绑定配额包：能量配给序（tower > spawn > repair > upgrade≈0）、defender
  孵化车道、非战斗人口冻结项、CPU 频率。
- 转移条件带滞回（alert 需威胁消失 N tick 才回 normal；siege 需能量会计
  转正 + 无可见敌双条件）；recovery 的出口是六闭环健康（09 §10.2），不是
  「敌人走了」。
- 每次状态转移写遥测事件（时间、触发事实、置信度、预计消耗上限、退出条件）
  ——skill 参考的警报记录契约。

### 10.3 tower 目标策略与 intent 纪律

1. 目标价值排序：**dismantler/attack 对关键结构的即时威胁 > healer > 高
   DPS ranged/attack > 残血收割**（先断奶妈是社区微操共识的塔控版本）。
2. 发前自检：目标仍存在、在有效射程（优先 ≤5 格满效区）、本塔能量够一次
   动作——三查不过不发（0.2 CPU 失败税纪律，R-06 同源）。
3. 集火协调：同房多塔同 tick 打同一优先目标（分摊 intent 前统一仲裁），
   避免伤害摊薄被 heal 逐个抵消。
4. 停火策略：当敌编队有效 heal ≥ 全塔净伤害（Tower Drain 判定）时按会计
   转停火/蓄能/退守内圈，绝不陪烧。
5. 塔修理（800/次）仅在非战斗期用于 rampart/关键结构维护批处理。

### 10.4 能量会计（防御的胜负判定式）

围城战本质是吞吐竞赛。定义：

```text
防御可持续时间 T = (tower 可用能量 + storage 水位×转化率 + 补给速率×t) / 塔耗速率
塔耗速率 ≈ 动作塔数 × 10 能量/tick（满频）
敌方成本 ≈ tank 血量损耗 + heal 消耗（其自身能量补给受距离惩罚）
```

- 守得住判据：T > 敌方可持续威胁时间（依 PlayerIntel 历史估计）且补给链
  不被切断 → 继续 alert/siege 配给。
- 守不住判据：T 低于阈值 → 转保命模式：能量转移（terminal 撤资）、保
  spawn/controller、**safemode 时机进入决策表**。
- 该账本每低频 tick 更新，是 siege 态的核心循环（比「塔还打得到人」可靠）。

### 10.5 safemode 决策表（战略资源预算）

| 条件 | 动作 |
| --- | --- |
| 敌贴关键建筑或 spawn <50% 血量，且等级 ≥2（非骚扰） | 允许开 |
| 本 shard 名额已被占用 | 禁开（换保命模式） |
| nuke 已宣布落点本房 | 禁开（拦不住，纯浪费——转 nuke 预案：加固/移资产） |
| 骚扰级（invader/单只） | 禁开（塔足够） |
| 冷却未过 / 能量即将耗干到无法反击 | 记入账本，依赖撤离与战后重建 |

每次决策记录进战争账本（ADR-009 遥测），Novice 区例外：无冷却（03 §9），
决策表按区域属性放宽。

### 10.6 rampart 与 nuke 预案

- **离线 min-cut + 版本化固化**：防线位置由 min-cut 工具（clarkok 类算法）
  离线对模板生成，作为模板部件固化（templateId 版本化，ADR-007）；线上只
  做维护（修复/加固批处理）与冲突标记，**不在线上跑图算法**。
- 分层：外圈 min-cut rampart + 关键结构内圈（KasamiBot borderwall+
  fortresswall 双层先例）；wall 上限 300M、rampart 按 RCL 上限（03 §8），
  加固目标值按威胁分级调档。
- **nuke 预案**：observer/scout 发现 `Game.nukes` 落点 → 50,000 tick 窗口
  内：加固落点半径内 rampart 至 1M+、转移/加盖内部结构、评估撤离成本；
  nuke 落地会取消 safemode 并清其充能（03 §8）——防御侧永远把 safemode 与
  nuke 预案视为两条独立轨道。

### 10.7 invader 与占领骚扰

- invader（NPC）：等级 1 处理——自有房塔自动清；远矿房触发该远矿车道暂停
  （P5 行为），高频出现则远矿 ROI 核算计入骚扰损失。
- 敌 reserver/claimer：中立缓冲房被预约→远矿收益减半（source 满容量被
  取消）；自有房被 claim 动作→等级 4 响应（claim 是占房语义，优先级最高）。
- 骚扰性 attacker 单杀 worker：按经济损失（非战斗损失）计入威胁记忆
  （14 号文档 PlayerIntel），持续骚扰可成为 posture 升格输入。

### 10.8 与 posture 的关系（双向供给）

- 上行：房间防御状态聚合进帝国态势（持续 siege/多房 alert → fortify 或
  war 的候选信号——posture 是唯一进攻授权，防御系统永不自行反打出门）。
- 下行：posture 决定防御预算基准（fortify：加固与塔能储备上调；war：边缘
  房预置 defender；evacuate：防御让位于撤离）。
- 防抖：两级都带滞回，且「防御动员不改变 posture、posture 不因单房单次
  事件切换」（ADR-003 同族纪律）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| 反射式防御（见敌即塔+defender） | 无分级即无预算；被 Tower Drain 耗死；不可测试 |
| 纯 creep 防御（不依赖塔） | 塔是唯一自动 DPS 且无 pop 成本；社区零先例 |
| safemode 当万能按钮（一有敌就开） | 每 shard 一房 + 50k 冷却；骚扰耗掉名额即战略失败（R-09） |
| 在线运行 min-cut 算法 | 重图算法进 tick 路径违反 CPU 预算原则；离线固化进模板（ADR-007） |
| 防御系统自动反击出门 | 违反 ADR-009 唯一进攻授权；防线只到房间边界 |
| 亡命升级（一房被袭全帝国总动员） | 错配 CPU/能量；防御状态保持房间级，帝国只读聚合报告 |

## 12. Open Questions

1. 分级阈值（heal 总量 vs 塔净伤的具体比较式）与 T 的止损阈值需故障注入
   校准（27 号文档 P8 验收场景）。
2. 跨房支援（KasamiBot 先例）是否引入：临近房 defender/能量驰援的响应
   时间 vs 母房暴露风险，推迟到 A4 数据后裁决。
3. 塔目标启发式的实战有效性（healer 优先序）需对抗模拟验证。
4. rampart 加固目标值随威胁分档的具体数值表（当前只有方向性裁决）。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://www.reddit.com/r/screeps/comments/55aapi/（围城耗能） | 社区 | 房外游走耗干 tower+storage 再推进是头号破防手段 | CONFIRMED |
| https://github.com/tanjera/screeps（Tower Drain 战术） | 源码 | tank+healer 轮换吸塔的标准攻方战术 | CONFIRMED（2026-08-22 复核） |
| https://www.reddit.com/r/screeps/comments/662flg/ + wiki Combat/StructureController | 社区/官方 | safemode 触发惯例；不拦 nuke；nuke 对策=厚 rampart+移资产 | CONFIRMED |
| min-cut 算法族：https://gist.github.com/clarkok/25b3e6e2c7cde42f9678d05db498fbee · https://sy-harabi.github.io/Automating-base-planning-in-screeps/ · https://www.reddit.com/r/screeps/comments/xyxy2p/ · https://wiki.screepspl.us/Defensive_Structures/ | 社区 | min-cut rampart 是防御墙演进终点；shrink-wrap 实践 | CONFIRMED（2026-08-22 复核） |
| 03_SCREEPS_GAME_CONSTRAINTS.md §6/§8 | 官方事实 | 塔数值/衰减、safemode/nuke 常量、rampart 上限 | CONFIRMED |
| Bot 调研摘要 2026-08-22（TooAngel towerdrainer/KasamiBot 双层墙+safemode/Quorum defense 进程/TI 防御强/hivemind 不防核） | 源码 | 塔控+纵深+safemode 三件套收敛 | CONFIRMED |
| skill 参考 strategy-playbook（Defense）+ pvp-and-intelligence（Response policy） | 方法论 | policy 状态机与警报记录契约 | 设计输入 |
