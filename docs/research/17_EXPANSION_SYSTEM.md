# 17 · 扩张系统（Expansion System）

> 研究文档 · 结论等级：**设计裁决**（社区死因证据 + TooAngel 十年先例 + ADR-008 展开）。
> GCL/世界结构/运费机制以 [03_SCREEPS_GAME_CONSTRAINTS.md](03_SCREEPS_GAME_CONSTRAINTS.md)
> §6/§9 为基准；裁决契约见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
> ADR-008；风险口径见 [29_RISK_REGISTER.md](29_RISK_REGISTER.md) R-03/R-16。
> 核查日：2026-08-22。

## 1. Problem

多房是帝国增长的主引擎（更多 source、矿物多样性、GCL 复利），但**过度扩张
掏空本土**是社区记录的高频死因（R-03）：殖民期是双房消耗窗口——新房只进
不出、母房要同时输血 5,000 能量建 spawn、维持自身边疆防务。人类玩家的社区
共识是「GCL 一到就 claim」（Steam/Reddit 讨论），那是有人工兜底与时间投入
前提下的经验；**自治框架没有人工兜底，扩张必须是投资决策（ADR-008）：先算
值不值、再算养不养得起、最后定义失败怎么退**。

本文裁决：扩张动机模型、候选评分公式、资源门控（TooAngel 三指标形式化）、
殖民自举车道全流程、失败降级与撤离、GCL 节奏、以及与远矿的决策序
（先 remote 尽调后 colonize）。

## 2. Research Questions

1. 扩张的动机有哪些？如何避免「为扩而扩」？
2. 候选评分应包含哪些因子？权重如何定？
3. 资源门控的指标形式化：TooAngel 三指数平滑指标 + 本土净流 + 运输余量 +
   可撤离如何合成一个开关？
4. 殖民自举车道全流程：评分→claim→输血→自续命→移交，失败降级怎么判？
5. GCL 投资节奏：升级公式（1e6×L^2.4）下何时主动刷 GCL、何时让 GCL 闲置？
6. 远矿与殖民的关系：什么信号触发 remote→colonize 升级？

## 3. Existing Solutions（方法论参照）

ADR-008 已裁决：扩张是 Agenda 项（预算/期限/取消条件），候选多因子评分 +
资源门控 + 殖民自举专门车道 + GCL 硬上限。strategy-playbook Empire 节给出
尽调清单：可见性与情报置信度、能量/矿物价值、路径与运输成本、防守难度、
spawn 与 population 缺口、现有房间净余量、恢复能力、对手压力、失败撤退
成本；四条件门（本土生存链不被掏空/跨房运输有余量/目标可建立最低防御/
失败可重建或撤离）全部满足才进 claim/reserve/colonize 计划。扩张必须改善
帝国的长期资源、位置、情报或军事选项——这是动机模型的骨架。

## 4. Screeps Community Practice

- **GCL 是硬门**：GCL=可 claim 房间数、升级 ≈1e6×L^2.4 控制点、永不丢失
  （03 §9）；claim 前可先 reserve 占位（官方 control 文档建议；claim creep
  每 CLAIM part 600 能量、寿命 600 tick）。社区普遍「GCL 一到就扩」
  （wiki Claiming_new_room 流程、Steam 讨论）——自治框架批判性采纳：GCL
  是**必要非充分**条件（2026-08-22 复核 CONFIRMED）。
- **先 remote 后 claim 的尽调序**：GCL 不够时 remote mine+reserve 邻房是
  标准操作（reddit 5jia18：claimer 650 能量即可占位；control 文档：目标
  需更高 GCL 前先 reserve）——remote 数据天然成为殖民尽调（收益实测、
  威胁频率、路权）。
- **殖民自举资源事实**：spawn 需 5,000 能量，靠老家跨房运送 + 建期间
  rampart 保护工地（reddit lzxzu1，2021，CONFIRMED；工地可被敌意 creep
  踩毁，13 号文档 §4 同源）。
- **GCL 注能机制**：RCL8 前可向 controller 无限注能（forum 513）；升级
  预算的口径见 10 号文档 §10.4（7→8 需 10.935M）。
- **紧邻房起步共识**（10 号文档 §4）：短补给线是殖民存活率的第一变量；
  terminal 运费指数衰减公式（03 §7）使近距离调拨近免费、远距离昂贵。
- **Novice/Respawn 窗口**：Novice 区 safemode 无冷却、禁 nuker、GCL≤3 限
  3 房（03 §9）——新服/重生期是激进扩张红利窗口（respawn 保留 GCL）。
- **远端砍单反例**：shard3 玩家完全砍 remote（CPU>能源排序，
  jonwinsley）——扩张/远矿在 CPU 贫瘠环境都是负项，门控必须含 CPU。

## 5. Existing Bot Analysis

| Bot | 扩张机制 | 可迁移点 | 备注 |
| --- | --- | --- | --- |
| TooAngel | **指数平滑三指标（cpuIdle/heapFree/memoryFree）门控 nextroom** | 资源门控的极简形式化，十年无人值守验证 | 门控先行、评分其次的秩序 |
| KasamiBot | 房间估值 + proximityscout 每 20,000 tick 按矿物/source 刷新估值 | 评分制先例；remote 上限 6 保留房+SK 房 | 扩张=估值驱动的投资 |
| bonzAI | AutoOperation 自动选建家点位；**扩张工人在目标 spawn 自续命** | 自举省孵化带宽（工人跨房走过去而非母房孵） | 实验性质但自举先例关键 |
| Overmind | Colony + outposts：远矿归 Colony 属地 | remote 与殖民同一属地管理的两种深度 | 帝国不直接管远矿房 |
| Quorum | 扩张进程（city 建立） | 生命周期化 | 停更 |
| hivemind / TI | 常规扩张 | —（无特殊机制） | 收敛于评分+门控 |

**收敛点**：无人「GCL 到即 claim」无人值守成活；全部有估值/门控成分。
分歧在自举形态（母房全孵 vs 工人自续命）。

## 6. Advantages（投资式扩张的优势）

1. **本土不被掏空**：净流为正 + 运输余量门控使殖民期消耗有上界（R-03
   防线）；TooAngel 十年先例证明可行。
2. **冷启动失败变可测试**：自举车道是一等公民流程（P7 交付），bootstrap
   超时→降级 remote→放弃撤离的判定链可在仿真注入验证（R-16 防线）。
3. **GCL 节奏与能量 sink 联动**：GCL farm 只在「将解锁扩张」时加速，避免
   GCL 积压（有位无资源）与能量浪费（10 号文档 §10.5 的反向约束）。

## 7. Disadvantages（代价）

- 保守门控错过窗口：邻接好房被抢——接受（错过的机会成本远低于掏空本土
  的帝国级风险，ADR-008 明示取舍）。
- 殖民期是帝国最脆弱窗口：双房同时高消耗且边疆防务稀释——需 fortify
  posture 的预警性覆盖（15 号文档）。
- 撤离决策有沉没成本陷阱：投入越多越舍不得撤——期限与止损线必须写死在
  Agenda 里，不许运行时重议。

## 8. Failure Modes

| 失败模式 | 后果 | 防线 |
| --- | --- | --- |
| 殖民地断血（运输被袭/母房自顾不暇） | 新房死在 bootstrap（R-16） | 输血计划带止损线（预算上限+期限）；本地自续命兜底（bonzAI 先例） |
| 新殖民地建期被打（工地被踩/claim 被反占） | 5,000 能量+工期全损 | 建期 rampart 保护工地；claim 时机看威胁记忆（PlayerIntel）；候选评分含邻接安全 |
| 扩张后 CPU 超预算 | 帝国滑向 Guarded/Recovery（R-01/R-03） | 三指标指数平滑门控；Recovery 档冻结新殖民车道 |
| 母房被抽干（输血无上限） | 本土净流转负、连锁断链 | 门控硬条件：本土净流连续为正才开车道；输血租约上限 |
| GCL 积压或浪费（盲刷 GCL 无扩张计划） | 能量 sink 错配 | GCL farm 与扩张候选池联动：有评分合格候选且门控接近通过才加速 farm |
| 撤离拖延（沉没成本） | 撤退窗口关闭资产全损 | Agenda 期限硬约束；降级判定自动化（§10.5），无人工重议路径 |
| 评分输入过时（估值基于过期 intel） | 买了「看起来好」的烂房 | 评分输入要求 fact/stale 级新鲜度（14 号文档）；未知按最保守计 |
| 同时开多条殖民车道 | 多房消耗叠加 | 同一时刻至多一条 colonize 车道（多候选排队，§12） |

## 9. CPU Implications

- 扩张决策本身低频事件化：触发器只有三类（GCL 接近解锁/新候选出现/
  威胁态势变化），无每 tick 成本。
- 门控指标 O(1)：cpuIdle/heapFree/memoryFree 的指数平滑在遥测系统里已
  计算（21 号文档），扩张只读结果。
- 殖民期增量是预算主要项：新房 3–5 CPU/房 + 新增 creep 项（09 号文档
  §9 口径）；开车道前按此预算做「扩张后仍不进 Guarded」的预演检查。
- proximityscout 类估值刷新复用 14 号文档巡检网，无独立扫描成本。

## 10. Recommended Design

### 10.1 动机模型（为什么扩张）

扩张必须显式声明收益类型（写入 Agenda 项），杜绝「为扩而扩」：

| 动机 | 收益度量 | 反例（不构成动机） |
| --- | --- | --- |
| 资源产能 | 新房净能量流 + 矿物种类的帝国缺口矩阵填补 | 单纯房数 +1 |
| GCL 复利 | 更多房→更多 upgrade 能力→更快 GCL→更多房位 | GCL 空转积压 |
| 战略位置 | 封锁走廊/包围宿敌/建立缓冲带（配合 ADR-009 防御纵深） | 纯声望性「帝国地图好看」 |
| 避险分散 | 单点故障（单房被 nuke/围城）的帝国韧性 | — |

### 10.2 候选评分公式（多因子线性加权）

```text
score = w1·sourceValue      // 2/3 source；SK 房 4,000×2 源潜力
      + w2·mineralValue     // 密度 × 帝国矿种缺口权重（KasamiBot 估值同源）
      + w3·distanceScore    // 距最近自有房跳数；terminal 指数运费（03 §7）
      + w4·neighborSafety   // 周边 2 房半径 owner 分布：中立/盟/宿敌
      − w5·rivalProximity   // 宿敌活动房距离（PlayerIntel 派生，14 号文档）
      + w6·defensibility    // 出口数、地形 min-cut 成本、可预置 tower 位
      + w7·layoutFitness    // 模板适配校验结果（13 号文档 §10.2 复用）
```

- 归一化到 [0,1] 后线性合成；权重初值 SPECULATION（§12），soak 校准。
- 硬否决项（不计分直接淘汰）：known 宿敌 owned/reserved 房、Novice 区
  之外被我方 nuke 污染过的房、无 fact 级房间归属情报的房（先侦察）。
- 候选池规模小（GCL 附近 ±1 房位的邻接窗 + 巡检发现的空房），评分是
  低频事件成本。

### 10.3 资源门控（TooAngel 三指标形式化）

全部通过才允许开车道（任一失败即等待，无人工覆盖路径）：

```text
G1 资源指标：expSmooth(cpuIdle) > τ1 ∧ expSmooth(heapFree) > τ2
             ∧ expSmooth(memoryFree) > τ3        // TooAngel nextroom 同款
G2 本土净流：帝国（不含新候选）能量净流连续 T tick > 0   // 不掏空本土
G3 运输余量：跨房 hauler 容量 × 频率的余量 > 殖民输血需求
             （含建期 rampart/道路建材与 5,000 spawn 能量的运输计划）
G4 可撤离：候选房撤离成本（terminal/creep 转移）预估 < 止损线，
           且母房→候选的资产暴露敞口有界
G5 预算预演：扩张后帝国 CPU 预测仍高于 Guarded 阈值（§9）
```

G1 三指标即 TooAngel 十年无人值守的原始形态；G2–G4 是 strategy-playbook
四条件门的账本化表达。

### 10.4 与远矿的决策序（先尽调后投资）

```text
巡检发现候选 → 开 remote 车道（reserve + 采集，P5 机制）
  → 实测数千 tick：净收益 / 敌袭频率 / 路权 / invader 密度
  → GCL 可用 + 门控全绿 + 评分超阈值
  → 升级为 colonize 车道（同一房从 remote 平滑过渡， hauler 队伍复用）
```

- remote 是**便宜的期权**：成本 creep 级、可随时撤退；colonize 是**重的
  承诺**：5,000 能量+数万 tick 工期。决策序保证重承诺永远建立在实测数据
  上（远矿 ROI 核算的复用，27 号文档 P5→P7 依赖链的数据理由）。
- 反向降级同样成立：colonize 失败降级回 remote（§10.5），远矿数据继续
  积累等待下次窗口。

### 10.5 殖民自举车道全流程

```text
1 评分与门控通过 → 创建 colonize Agenda 项（预算/期限/取消条件）
2 claim：claim creep（1 CLAIM+MOVE，~650 能量）出发，房内威胁复查
3 输血计划：母房专项能量租约（5,000 spawn 建造 + 建材 + 存量缓冲），
   建期 rampart 保护工地（reddit lzxzu1 先例；工地可被踩毁）
4 自续命：殖民工人从母房步行到达、以本地 source 自持孵化过渡
   （bonzAI 扩张工人先例——省母房孵化带宽）
5 spawn 落地 → 房间进 bootstrap phase（09/10 号文档自举序列）
   → 六闭环健康 → 移交房间层自治，车道关闭记账
```

**失败降级判定**（写死在 Agenda，自动执行）：

| 触发 | 动作 |
| --- | --- |
| claim 被反占/超时 | 车道取消，目标房回候选池并扣安全分 |
| spawn 未在期限内落地（输血断供/被拆） | 降级为 remote 车道（已有实测数据），或放弃 |
| bootstrap 期内净流持续为负超止损线 | 撤离：terminal/creep 资产回收，放弃房位（GCL 保留，03 §9） |
| 帝国进入 Guarded 以下 | 冻结车道（保存量，不追增量），恢复后重开 |

### 10.6 GCL 节奏

- 升级成本 ≈1e6×L^2.4（03 §9）指数增长：高 GCL 每一级都是大额能量投资
  （L8→9 约 1e6×8^2.4≈2.8×10^8 控制点量级），GCL farm 是长期 Agenda。
- 联动规则：候选池存在评分合格房 + 门控预测将绿 → 才把 GCL farm 的能量
  优先级上调（peak 房 sink 分配，10 号文档 §10.5）；否则 GCL 投资让位
  军事储备/生产链——避免「刷出房位却无资源可扩」的积压。
- Respawn 场景：GCL 保留（官方），重生优先重占原有房位而非探索新域
  （房位即资产）。

### 10.7 Novice / 新服窗口策略

Novice 区（safemode 无冷却、禁 nuker、限 3 房，系统签名可探测）是扩张
红利窗口：门控可以放宽安全类指标（G4），但 G1/G2（CPU 与净流）不放宽
——规则红利替代不了资源现实。窗口关闭前（区域开放 PvP）完成边疆 fortify
评估（15 号文档 posture 联动）。

## 11. Alternatives Rejected

| 方案 | 否决理由 |
| --- | --- |
| GCL 到即 claim（社区人类惯例） | 无预算视角；自治无人工兜底；R-03 直通 |
| 跳房扩张（远程殖民） | 补给线长（运费指数衰减+路权风险）；仅战略位置特殊值才可例外（当前不启用） |
| 先 colonize 后尽调（跳过 remote 期权） | 重承诺建立在未实测的估值上；远矿先行的尽调序更便宜 |
| 纯距离最近原则 | 忽略宿敌距离/防守难度/矿物缺口；评分因子不完整的退化形态 |
| 常驻扩张扫描（每 tick 找新房） | 决策低频事件化即可；扫描是纯浪费（§9） |
| 失败后无限重试（不降级） | 沉没成本陷阱+重复撞墙；降级链与黑名单式冷却强制存在 |

## 12. Open Questions

1. 评分权重 w1–w7 初值与门控阈值 τ1–τ3、T 的校准：需首个殖民周期与 soak
   数据回填（当前全部 SPECULATION 初值）。
2. 多候选并发：当前裁决「同时至多一条 colonize 车道」，GCL 高段位（10+ 房）
   帝国是否值得并行两条，推迟到 A5 数据。
3. 宿敌距离因子的量化函数（线性/阶梯）与威胁记忆衰减的耦合参数。
4. 撤离的资产回收率实测（terminal 容量 300k 的转移计划上限）与「保多少、
   弃多少」的最优停止点。
5. Respawn 场景的专门流程（重占 vs 新域）目前只有方向裁决，需沙盘推演。

## 13. Evidence / Sources

| 来源 | 类型 | 关键发现 | 置信度 |
| --- | --- | --- | --- |
| https://wiki.screepspl.us/Claiming_new_room/ + https://www.reddit.com/r/screeps/comments/5jia18/ + docs control.html | 社区/官方 | claim/reserve 流程与尽调序；GCL 硬门；「GCL 到即扩」惯例 | CONFIRMED（2026-08-22 复核） |
| https://www.reddit.com/r/screeps/comments/lzxzu1/ | 社区 | 殖民 spawn 5,000 能量+母房跨房运送+工地 rampart | CONFIRMED |
| TooAngel 源码（expSmooth 三指标门控 nextroom）+ Bot 调研摘要 2026-08-22（KasamiBot 估值+20k 刷新+remote 上限/bonzAI 自续命/AutoOperation/Overmind outposts） | 源码 | 评分制+门控+自举三件套收敛 | CONFIRMED |
| http://screeps.com/forum/topic/513/ | 论坛 | RCL8 前可无限注能 controller | CONFIRMED |
| 03_SCREEPS_GAME_CONSTRAINTS.md §6/§7/§9 | 官方事实 | GCL 公式/respawn 保留/Novice 规则/claim 数值/terminal 运费 | CONFIRMED |
| 29_RISK_REGISTER.md R-03/R-16 + ADR-008 | 本套件 | 过度扩张与冷启动风险的防线映射 | 设计输入 |
